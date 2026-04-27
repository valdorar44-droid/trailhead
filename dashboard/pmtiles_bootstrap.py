"""Self-hosted PMTiles bootstrap.

On startup we make sure we have a local US-extract PMTiles file at
/data/us.pmtiles. If missing, we download the protomaps go-pmtiles binary
and run `pmtiles extract` against the latest Protomaps planet build.

The extract takes ~30-60 minutes one time. While it's running, the tile
endpoint falls back to the Protomaps API (whose key is already configured).
After it finishes, future tile reads serve from the local mmap'd file in
single-digit ms — no upstream calls, no per-tile billing, no quotas.
"""
from __future__ import annotations
import asyncio
import io
import os
import tarfile
from pathlib import Path
from typing import Optional

import httpx

# Layout
DATA_DIR = Path("/data") if Path("/data").is_dir() else Path("./data")
DATA_DIR.mkdir(parents=True, exist_ok=True)
PMTILES_PATH = DATA_DIR / "us.pmtiles"
GO_PMTILES_BINARY = DATA_DIR / "go_pmtiles"

# CONUS bounding box (west, south, east, north) — same as the mobile download
CONUS_BBOX = "-125.0,24.5,-66.5,49.5"

# go-pmtiles release we pin to. Update as needed.
GO_PMTILES_VERSION = "1.22.3"
GO_PMTILES_TARBALL = (
    f"https://github.com/protomaps/go-pmtiles/releases/download/"
    f"v{GO_PMTILES_VERSION}/go-pmtiles_{GO_PMTILES_VERSION}_Linux_x86_64.tar.gz"
)

# Protomaps publishes daily planet builds at https://build.protomaps.com/{YYYYMMDD}.pmtiles.
# There is no directory listing or `latest` alias — we probe recent dates with
# HEAD requests and use the most recent one that exists. Builds are kept for ~6 days.
PROTOMAPS_BUILD_URL_TEMPLATE = "https://build.protomaps.com/{date}.pmtiles"

# Status flags accessible from the tile endpoint
_status: dict = {"ready": False, "extracting": False, "error": None, "progress": ""}


def status() -> dict:
    """Current bootstrap state — surfaced via /api/admin/pmtiles-status."""
    out = dict(_status)
    out["pmtiles_exists"] = PMTILES_PATH.exists()
    out["pmtiles_size_mb"] = (
        round(PMTILES_PATH.stat().st_size / 1_000_000, 1) if PMTILES_PATH.exists() else 0
    )
    return out


async def _download_go_pmtiles() -> None:
    """Download + extract the go-pmtiles binary into /data."""
    if GO_PMTILES_BINARY.exists() and os.access(GO_PMTILES_BINARY, os.X_OK):
        return
    _status["progress"] = "downloading go-pmtiles binary"
    async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
        r = await client.get(GO_PMTILES_TARBALL)
        r.raise_for_status()
    # The tarball contains a single binary named `pmtiles`
    tar = tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz")
    member = next((m for m in tar.getmembers() if m.name.endswith("pmtiles")), None)
    if member is None:
        raise RuntimeError("go-pmtiles binary not found in tarball")
    extracted = tar.extractfile(member)
    if extracted is None:
        raise RuntimeError("could not extract go-pmtiles binary")
    GO_PMTILES_BINARY.write_bytes(extracted.read())
    GO_PMTILES_BINARY.chmod(0o755)


async def _latest_planet_url() -> str:
    """Find the most recent dated planet PMTiles by probing the build server.

    Builds are daily and kept for ~6 days. We HEAD requests starting from
    yesterday backwards (today's build often isn't published until late UTC).
    """
    from datetime import datetime, timedelta, timezone
    today = datetime.now(timezone.utc).date()
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        for days_back in range(1, 10):
            d = today - timedelta(days=days_back)
            url = PROTOMAPS_BUILD_URL_TEMPLATE.format(date=d.strftime("%Y%m%d"))
            try:
                resp = await client.head(url)
            except httpx.HTTPError:
                continue
            if resp.status_code == 200:
                return url
    raise RuntimeError("no recent planet builds reachable on build.protomaps.com")


async def ensure_us_pmtiles() -> None:
    """Background task: ensure /data/us.pmtiles exists. Idempotent."""
    if _status["extracting"]:
        return
    if PMTILES_PATH.exists() and PMTILES_PATH.stat().st_size > 100_000_000:
        # Already have a substantial file — assume it's good
        _status["ready"] = True
        return
    _status["extracting"] = True
    _status["error"] = None
    try:
        await _download_go_pmtiles()
        _status["progress"] = "resolving latest planet build"
        planet_url = await _latest_planet_url()
        _status["progress"] = f"extracting CONUS from {planet_url} (this takes ~30-60 min)"

        # `go-pmtiles extract` reads byte-ranges from the planet URL and writes a local file.
        # Use a temp path so we never serve a half-written file.
        tmp_path = PMTILES_PATH.with_suffix(".pmtiles.tmp")
        if tmp_path.exists():
            tmp_path.unlink()

        # Discard stdout/stderr — go-pmtiles writes \r-terminated progress bars
        # that overflow asyncio's 64KB readline buffer. Track progress by
        # polling the temp file size + elapsed time instead.
        import time as _time
        start_t = _time.time()
        proc = await asyncio.create_subprocess_exec(
            str(GO_PMTILES_BINARY), "extract",
            planet_url,
            str(tmp_path),
            f"--bbox={CONUS_BBOX}",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )

        async def _heartbeat() -> None:
            while proc.returncode is None:
                size_mb = (tmp_path.stat().st_size / 1_000_000) if tmp_path.exists() else 0
                elapsed = int(_time.time() - start_t)
                _status["progress"] = (
                    f"extracting CONUS... {elapsed}s elapsed, {size_mb:.0f}MB written"
                )
                await asyncio.sleep(10)

        await asyncio.gather(_heartbeat(), proc.wait())

        if proc.returncode != 0:
            _status["error"] = f"go-pmtiles exited {proc.returncode}"
            if tmp_path.exists():
                tmp_path.unlink()
            return

        # Atomic move
        tmp_path.rename(PMTILES_PATH)
        _status["ready"] = True
        _status["progress"] = (
            f"ready ({round(PMTILES_PATH.stat().st_size / 1_000_000, 1)} MB)"
        )
    except Exception as exc:
        _status["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        _status["extracting"] = False


# ── Local PMTiles reader (mmap'd) ──────────────────────────────────────────────
_reader = None
_reader_lock = asyncio.Lock()


def _open_reader():
    """Open the PMTiles file via mmap. Returns None if file isn't ready."""
    global _reader
    if _reader is not None:
        return _reader
    if not PMTILES_PATH.exists() or PMTILES_PATH.stat().st_size < 100_000_000:
        return None
    try:
        from pmtiles.reader import Reader, MmapSource
        f = open(PMTILES_PATH, "rb")
        _reader = Reader(MmapSource(f))
        return _reader
    except Exception as exc:
        _status["error"] = f"reader open failed: {exc}"
        return None


async def get_local_tile(z: int, x: int, y: int) -> Optional[bytes]:
    """Read a tile from the local PMTiles file (or None if not available)."""
    reader = _open_reader()
    if reader is None:
        return None
    # PMTiles reader is sync — offload to a thread so the event loop stays free
    return await asyncio.to_thread(reader.get, z, x, y)
