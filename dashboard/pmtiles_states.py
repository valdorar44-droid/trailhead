"""Per-state PMTiles extraction and R2 upload.

Extracts each US state from the local /data/us.pmtiles using go-pmtiles,
uploads the result to R2, and writes a manifest.json so the mobile app
can discover real file sizes.

Usage:
    POST /api/admin/extract-state/UT   — extract + upload Utah
    POST /api/admin/extract-all-states — queue all 50 states
    GET  /api/admin/states-status      — per-state status
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Optional

# Re-use the go-pmtiles binary and settings from the bootstrap module
from dashboard.pmtiles_bootstrap import GO_PMTILES_BINARY, DATA_DIR, PMTILES_PATH

STATES_DIR = DATA_DIR / "states"
STATES_DIR.mkdir(parents=True, exist_ok=True)

# Bounding boxes: (west, south, east, north)
STATE_BBOXES: dict[str, tuple[float, float, float, float]] = {
    "AK": (-168.0, 54.6,  -130.0, 71.4),
    "AZ": (-114.8, 31.3,  -109.0, 37.0),
    "CA": (-124.4, 32.5,  -114.1, 42.0),
    "CO": (-109.1, 37.0,  -102.0, 41.0),
    "HI": (-160.2, 18.9,  -154.8, 22.2),
    "ID": (-117.2, 42.0,  -111.0, 49.0),
    "MT": (-116.0, 44.4,  -104.0, 49.0),
    "NM": (-109.1, 31.3,  -103.0, 37.0),
    "NV": (-120.0, 35.0,  -114.0, 42.0),
    "OR": (-124.6, 41.9,  -116.5, 46.3),
    "UT": (-114.1, 36.9,  -109.0, 42.0),
    "WA": (-124.7, 45.5,  -116.9, 49.0),
    "WY": (-111.1, 41.0,  -104.1, 45.0),
    "KS": (-102.1, 36.9,   -94.6, 40.0),
    "MN": ( -97.2, 43.5,   -89.5, 49.4),
    "MO": ( -95.8, 35.9,   -89.1, 40.6),
    "ND": (-104.1, 45.9,   -96.6, 49.0),
    "NE": (-104.1, 40.0,   -95.3, 43.0),
    "OK": (-103.0, 33.6,   -94.4, 37.0),
    "SD": (-104.1, 42.5,   -96.4, 45.9),
    "TX": (-106.6, 25.8,   -93.5, 36.5),
    "AL": ( -88.5, 30.2,   -84.9, 35.0),
    "AR": ( -94.6, 33.0,   -89.6, 36.5),
    "FL": ( -87.6, 24.5,   -80.0, 31.0),
    "GA": ( -85.6, 30.4,   -80.8, 35.0),
    "KY": ( -89.6, 36.5,   -81.9, 39.1),
    "LA": ( -94.0, 28.9,   -88.8, 33.0),
    "MS": ( -91.7, 30.2,   -88.1, 35.0),
    "NC": ( -84.3, 33.8,   -75.5, 36.6),
    "SC": ( -83.4, 32.0,   -78.5, 35.2),
    "TN": ( -90.3, 35.0,   -81.6, 36.7),
    "VA": ( -83.7, 36.5,   -75.2, 39.5),
    "WV": ( -82.6, 37.2,   -77.7, 40.6),
    "CT": ( -73.7, 41.0,   -71.8, 42.1),
    "DE": ( -75.8, 38.4,   -75.0, 39.8),
    "MA": ( -73.5, 41.2,   -69.9, 42.9),
    "MD": ( -79.5, 37.9,   -75.0, 39.7),
    "ME": ( -71.1, 43.1,   -66.9, 47.5),
    "NH": ( -72.6, 42.7,   -70.6, 45.3),
    "NJ": ( -75.6, 38.9,   -73.9, 41.4),
    "NY": ( -79.8, 40.5,   -71.8, 45.0),
    "PA": ( -80.5, 39.7,   -74.7, 42.3),
    "RI": ( -71.9, 41.1,   -71.1, 42.0),
    "VT": ( -73.4, 42.7,   -71.5, 45.0),
    "IA": ( -96.6, 40.4,   -90.1, 43.5),
    "IL": ( -91.5, 36.9,   -87.0, 42.5),
    "IN": ( -88.1, 37.8,   -84.8, 41.8),
    "MI": ( -90.4, 41.7,   -82.4, 48.3),
    "OH": ( -84.8, 38.4,   -80.5, 42.0),
    "WI": ( -92.9, 42.5,   -86.2, 47.1),
}

# Per-state status: code → dict
_states: dict[str, dict] = {
    code: {"status": "pending", "progress": "", "size_bytes": 0, "error": None}
    for code in STATE_BBOXES
}
_extract_lock = asyncio.Lock()
_running = False


def all_status() -> dict[str, dict]:
    out = {}
    for code, s in _states.items():
        path = STATES_DIR / f"{code.lower()}.pmtiles"
        size = path.stat().st_size if path.exists() else 0
        out[code] = {**s, "on_disk": path.exists(), "size_mb": round(size / 1_000_000, 1)}
    return out


async def extract_state(code: str) -> Optional[Path]:
    """Extract a single state from the local us.pmtiles. Returns path on success."""
    code = code.upper()
    if code not in STATE_BBOXES:
        raise ValueError(f"Unknown state code: {code}")
    if not PMTILES_PATH.exists():
        raise RuntimeError("us.pmtiles not found — run pmtiles bootstrap first")
    if not GO_PMTILES_BINARY.exists():
        raise RuntimeError("go-pmtiles binary not found")

    w, s, e, n = STATE_BBOXES[code]
    bbox = f"{w},{s},{e},{n}"
    out_path = STATES_DIR / f"{code.lower()}.pmtiles"
    tmp_path = out_path.with_suffix(".pmtiles.tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    _states[code].update(status="extracting", progress="starting extraction", error=None)
    start = time.time()

    proc = await asyncio.create_subprocess_exec(
        str(GO_PMTILES_BINARY), "extract",
        str(PMTILES_PATH),
        str(tmp_path),
        f"--bbox={bbox}",
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )

    async def _heartbeat():
        while proc.returncode is None:
            size_mb = (tmp_path.stat().st_size / 1_000_000) if tmp_path.exists() else 0
            elapsed = int(time.time() - start)
            _states[code]["progress"] = f"extracting {elapsed}s · {size_mb:.0f} MB"
            await asyncio.sleep(5)

    await asyncio.gather(_heartbeat(), proc.wait())

    if proc.returncode != 0:
        _states[code].update(status="error", error=f"go-pmtiles exit {proc.returncode}")
        if tmp_path.exists():
            tmp_path.unlink()
        return None

    tmp_path.rename(out_path)
    size = out_path.stat().st_size
    _states[code].update(
        status="extracted",
        progress=f"done · {round(size / 1_000_000, 1)} MB",
        size_bytes=size,
    )
    return out_path


async def upload_state_to_r2(code: str) -> bool:
    """Upload the extracted state file to R2. Returns True on success."""
    import boto3
    from botocore.config import Config
    from config.settings import settings

    code = code.upper()
    path = STATES_DIR / f"{code.lower()}.pmtiles"
    if not path.exists():
        _states[code].update(status="error", error="file not found for upload")
        return False

    _states[code].update(status="uploading", progress="starting upload")
    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        r2_key = f"{code.lower()}.pmtiles"
        file_size = path.stat().st_size
        part_size = 64 * 1024 * 1024  # 64 MB parts

        mpu = await asyncio.to_thread(
            r2.create_multipart_upload,
            Bucket=settings.r2_bucket,
            Key=r2_key,
            ContentType="application/vnd.pmtiles",
        )
        upload_id = mpu["UploadId"]
        parts = []
        uploaded = 0

        with open(path, "rb") as fh:
            part_num = 1
            while True:
                chunk = fh.read(part_size)
                if not chunk:
                    break
                resp = await asyncio.to_thread(
                    r2.upload_part,
                    Bucket=settings.r2_bucket,
                    Key=r2_key,
                    UploadId=upload_id,
                    PartNumber=part_num,
                    Body=chunk,
                )
                parts.append({"PartNumber": part_num, "ETag": resp["ETag"]})
                uploaded += len(chunk)
                pct = round(uploaded / file_size * 100)
                _states[code]["progress"] = f"uploading {pct}%"
                part_num += 1

        await asyncio.to_thread(
            r2.complete_multipart_upload,
            Bucket=settings.r2_bucket,
            Key=r2_key,
            MultipartUpload={"Parts": parts},
            UploadId=upload_id,
        )
        size = path.stat().st_size
        _states[code].update(
            status="done",
            progress=f"uploaded · {round(size / 1_000_000, 1)} MB",
            size_bytes=size,
        )
        return True
    except Exception as exc:
        _states[code].update(status="error", error=f"{type(exc).__name__}: {exc}")
        return False


async def update_manifest_on_r2() -> bool:
    """Write manifest.json to R2 with sizes of all available files."""
    import boto3
    from botocore.config import Config
    from config.settings import settings

    manifest: dict[str, dict] = {}

    # CONUS
    from dashboard.pmtiles_bootstrap import PMTILES_PATH as US_PATH
    if US_PATH.exists():
        manifest["us.pmtiles"] = {"size": US_PATH.stat().st_size}

    # States
    for code in STATE_BBOXES:
        path = STATES_DIR / f"{code.lower()}.pmtiles"
        if path.exists():
            manifest[f"{code.lower()}.pmtiles"] = {"size": path.stat().st_size}

    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        body = json.dumps(manifest).encode()
        await asyncio.to_thread(
            r2.put_object,
            Bucket=settings.r2_bucket,
            Key="manifest.json",
            Body=body,
            ContentType="application/json",
        )
        return True
    except Exception:
        return False


async def extract_and_upload_state(code: str) -> bool:
    """Full pipeline: extract → upload → update manifest."""
    path = await extract_state(code)
    if not path:
        return False
    ok = await upload_state_to_r2(code)
    if ok:
        await update_manifest_on_r2()
    return ok


async def extract_all_states_task(codes: Optional[list[str]] = None):
    """Background task: extract + upload all (or specified) states sequentially."""
    global _running
    _running = True
    targets = [c.upper() for c in (codes or list(STATE_BBOXES.keys()))]
    for code in targets:
        if _states[code]["status"] == "done":
            continue
        try:
            await extract_and_upload_state(code)
        except Exception as exc:
            _states[code].update(status="error", error=str(exc))
    _running = False
