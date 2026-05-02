"""Build and upload per-state Valhalla routing packs.

Outputs:
  /data/routing/{code}/{code}.osm.pbf
  /data/routing/{code}/valhalla_tiles/*
  /data/routing/{code}.tar
  R2: routing/{code}.tar
  R2: routing/manifest.json
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import tarfile
import time
from pathlib import Path
from typing import Optional

import httpx

from dashboard.pmtiles_bootstrap import DATA_DIR
from dashboard.pmtiles_states import STATE_BBOXES, REGION_BBOXES

ROUTING_DIR = DATA_DIR / "routing"
ROUTING_DIR.mkdir(parents=True, exist_ok=True)

GEofabrik_NAMES = {
    "AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas",
    "CA": "california", "CO": "colorado", "CT": "connecticut", "DE": "delaware",
    "FL": "florida", "GA": "georgia", "HI": "hawaii", "IA": "iowa",
    "ID": "idaho", "IL": "illinois", "IN": "indiana", "KS": "kansas",
    "KY": "kentucky", "LA": "louisiana", "MA": "massachusetts",
    "MD": "maryland", "ME": "maine", "MI": "michigan", "MN": "minnesota",
    "MO": "missouri", "MS": "mississippi", "MT": "montana",
    "NC": "north-carolina", "ND": "north-dakota", "NE": "nebraska",
    "NH": "new-hampshire", "NJ": "new-jersey", "NM": "new-mexico",
    "NV": "nevada", "NY": "new-york", "OH": "ohio", "OK": "oklahoma",
    "OR": "oregon", "PA": "pennsylvania", "RI": "rhode-island",
    "SC": "south-carolina", "SD": "south-dakota", "TN": "tennessee",
    "TX": "texas", "UT": "utah", "VA": "virginia", "VT": "vermont",
    "WA": "washington", "WI": "wisconsin", "WV": "west-virginia",
    "WY": "wyoming",
}
REGION_GEOFABRIK_URLS = {
    "CANADA": "https://download.geofabrik.de/north-america/canada-latest.osm.pbf",
    "MEXICO": "https://download.geofabrik.de/north-america/mexico-latest.osm.pbf",
}
ALL_REGION_CODES = {**STATE_BBOXES, **REGION_BBOXES}

# Approximate OSM PBF size order, smallest first. Running tiny states first
# gets useful packs into R2 quickly and avoids losing hours if Railway restarts
# while a huge state like CA/TX is building.
SMALLEST_FIRST_ORDER = [
    "RI", "DE", "CT", "HI", "NH", "VT", "MA", "NJ", "MD", "WV",
    "SC", "ME", "AL", "MS", "KY", "TN", "IN", "AR", "LA", "IA",
    "OH", "VA", "NC", "WI", "MO", "KS", "NE", "OK", "MN", "IL",
    "GA", "SD", "ND", "PA", "FL", "MI", "NY", "ID", "WA", "OR",
    "CO", "NM", "AZ", "UT", "NV", "WY", "MT", "AK", "CA", "TX",
]
SMALLEST_FIRST_RANK = {code: idx for idx, code in enumerate(SMALLEST_FIRST_ORDER)}

_status: dict[str, dict] = {
    code: {"status": "pending", "progress": "", "size_bytes": 0, "error": None}
    for code in ALL_REGION_CODES
}
_running = False
RUNNING_STATUSES = {"downloading", "building", "packing", "uploading"}


def _state_dir(code: str) -> Path:
    return ROUTING_DIR / code.lower()


def _pbf_path(code: str) -> Path:
    return _state_dir(code) / f"{code.lower()}.osm.pbf"


def pack_path(code: str) -> Path:
    return ROUTING_DIR / f"{code.lower()}.tar"


def all_status() -> dict[str, dict]:
    out = {}
    for code, s in _status.items():
        path = pack_path(code)
        size = path.stat().st_size if path.exists() else 0
        out[code] = {**s, "on_disk": path.exists(), "size_mb": round(size / 1_000_000, 1)}
    return out


def is_state_running(code: str) -> bool:
    return _status.get(code.upper(), {}).get("status") in RUNNING_STATUSES


def is_state_built(code: str) -> bool:
    return pack_path(code.upper()).exists()


def tool_status() -> dict:
    return {
        "valhalla_build_tiles": shutil.which("valhalla_build_tiles") or "",
        "valhalla_build_config": shutil.which("valhalla_build_config") or "",
        "valhalla_build_extract": shutil.which("valhalla_build_extract") or "",
    }


def ordered_codes(codes: Optional[list[str]] = None) -> list[str]:
    targets = [c.upper() for c in (codes or list(STATE_BBOXES.keys())) if c.upper() in ALL_REGION_CODES]
    return sorted(targets, key=lambda c: SMALLEST_FIRST_RANK.get(c, 999))


def _geofabrik_url(code: str) -> str:
    code = code.upper()
    if code in REGION_GEOFABRIK_URLS:
        return REGION_GEOFABRIK_URLS[code]
    name = GEofabrik_NAMES[code]
    return f"https://download.geofabrik.de/north-america/us/{name}-latest.osm.pbf"


async def download_osm_pbf(code: str) -> Path:
    code = code.upper()
    out = _pbf_path(code)
    tmp = out.with_suffix(".osm.pbf.tmp")
    out.parent.mkdir(parents=True, exist_ok=True)
    if tmp.exists():
        tmp.unlink()

    url = _geofabrik_url(code)
    _status[code].update(status="downloading", progress=url, error=None)
    downloaded = 0
    last = time.time()
    async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
        async with client.stream("GET", url) as res:
            res.raise_for_status()
            total = int(res.headers.get("content-length") or 0)
            with open(tmp, "wb") as fh:
                async for chunk in res.aiter_bytes(1024 * 1024):
                    fh.write(chunk)
                    downloaded += len(chunk)
                    now = time.time()
                    if now - last > 2:
                        pct = f"{round(downloaded / total * 100)}%" if total else f"{round(downloaded / 1_000_000)} MB"
                        _status[code]["progress"] = f"downloading {pct}"
                        last = now

    tmp.rename(out)
    _status[code].update(progress=f"downloaded · {round(out.stat().st_size / 1_000_000, 1)} MB")
    return out


def _write_valhalla_config(code: str, tiles_dir: Path) -> Path:
    config = {
        "mjolnir": {
            "tile_dir": str(tiles_dir),
            "tile_extract": str(pack_path(code)),
            "concurrency": max(1, min(4, os.cpu_count() or 2)),
            "include_driveways": True,
            "include_construction": False,
            "data_processing": {"infer_turn_channels": True},
        },
        "loki": {
            "actions": ["locate", "route", "sources_to_targets", "optimized_route", "isochrone"],
            "use_connectivity": True,
        },
        "thor": {"source_to_target_algorithm": "select_optimal"},
        "service_limits": {
            "auto": {"max_distance": 500000, "max_locations": 50},
        },
    }
    path = _state_dir(code) / "valhalla.json"
    path.write_text(json.dumps(config, indent=2))
    return path


async def build_pack(code: str) -> Optional[Path]:
    code = code.upper()
    if code not in ALL_REGION_CODES:
        raise ValueError(f"Unknown routing region code: {code}")
    if not shutil.which("valhalla_build_tiles"):
        _status[code].update(
            status="error",
            error="valhalla_build_tiles not installed on this server",
            progress="install Valhalla binary package in the build image",
        )
        return None

    pbf = _pbf_path(code)
    if not pbf.exists():
        pbf = await download_osm_pbf(code)

    state_dir = _state_dir(code)
    tiles_dir = state_dir / "valhalla_tiles"
    if tiles_dir.exists():
        shutil.rmtree(tiles_dir)
    tiles_dir.mkdir(parents=True, exist_ok=True)

    out_tar = pack_path(code)
    tmp_tar = out_tar.with_suffix(".tar.tmp")
    for path in (out_tar, tmp_tar):
        if path.exists():
            path.unlink()

    config_path = _write_valhalla_config(code, tiles_dir)
    _status[code].update(status="building", progress="valhalla_build_tiles", error=None)
    start = time.time()

    proc = await asyncio.create_subprocess_exec(
        "valhalla_build_tiles",
        "-c", str(config_path),
        str(pbf),
        cwd=str(state_dir),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    stderr_tail: list[str] = []

    async def _stderr():
        assert proc.stderr is not None
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            text = line.decode(errors="replace").strip()
            if text:
                stderr_tail.append(text)
                del stderr_tail[:-8]

    async def _heartbeat():
        while proc.returncode is None:
            elapsed = int(time.time() - start)
            count = sum(1 for _ in tiles_dir.rglob("*") if _.is_file()) if tiles_dir.exists() else 0
            _status[code]["progress"] = f"building {elapsed}s · {count} files"
            await asyncio.sleep(5)

    await asyncio.gather(_stderr(), _heartbeat(), proc.wait())
    if proc.returncode != 0:
        _status[code].update(status="error", error="\n".join(stderr_tail[-4:]) or f"valhalla exit {proc.returncode}")
        return None

    _status[code].update(status="packing", progress="creating tar")
    with tarfile.open(tmp_tar, "w") as tar:
        tar.add(tiles_dir, arcname="valhalla_tiles")
        tar.add(config_path, arcname="valhalla.json")
    tmp_tar.rename(out_tar)

    size = out_tar.stat().st_size
    _status[code].update(status="built", progress=f"built · {round(size / 1_000_000, 1)} MB", size_bytes=size)
    return out_tar


async def upload_pack_to_r2(code: str) -> bool:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    code = code.upper()
    path = pack_path(code)
    if not path.exists():
        _status[code].update(status="error", error="routing pack not found")
        return False

    _status[code].update(status="uploading", progress="starting upload")
    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        file_size = path.stat().st_size
        part_size = 64 * 1024 * 1024
        key = f"routing/{code.lower()}.tar"

        mpu = await asyncio.to_thread(
            r2.create_multipart_upload,
            Bucket=settings.r2_bucket,
            Key=key,
            ContentType="application/x-tar",
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
                    Key=key,
                    UploadId=upload_id,
                    PartNumber=part_num,
                    Body=chunk,
                )
                parts.append({"PartNumber": part_num, "ETag": resp["ETag"]})
                uploaded += len(chunk)
                _status[code]["progress"] = f"uploading {round(uploaded / file_size * 100)}%"
                part_num += 1

        await asyncio.to_thread(
            r2.complete_multipart_upload,
            Bucket=settings.r2_bucket,
            Key=key,
            MultipartUpload={"Parts": parts},
            UploadId=upload_id,
        )
        _status[code].update(status="done", progress=f"uploaded · {round(file_size / 1_000_000, 1)} MB", size_bytes=file_size)
        await update_routing_manifest_on_r2()
        return True
    except Exception as exc:
        _status[code].update(status="error", error=f"{type(exc).__name__}: {exc}")
        return False


async def update_routing_manifest_on_r2() -> bool:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    manifest: dict[str, dict] = {}
    for code in ALL_REGION_CODES:
        path = pack_path(code)
        if path.exists():
            manifest[f"{code.lower()}.tar"] = {"size": path.stat().st_size}

    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        await asyncio.to_thread(
            r2.put_object,
            Bucket=settings.r2_bucket,
            Key="routing/manifest.json",
            Body=json.dumps(manifest).encode(),
            ContentType="application/json",
        )
        return True
    except Exception:
        return False


async def remote_pack_size(code: str) -> Optional[int]:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    key = f"routing/{code.lower()}.tar"
    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        resp = await asyncio.to_thread(r2.head_object, Bucket=settings.r2_bucket, Key=key)
        return int(resp.get("ContentLength") or 0)
    except Exception:
        return None


async def build_and_upload_pack(code: str, *, force: bool = False) -> bool:
    code = code.upper()
    if is_state_running(code):
        return False
    if is_state_built(code) and not force:
        path = pack_path(code)
        _status[code].update(
            status="done",
            progress=f"already built · {round(path.stat().st_size / 1_000_000, 1)} MB",
            size_bytes=path.stat().st_size,
            error=None,
        )
        await update_routing_manifest_on_r2()
        return True
    remote_size = await remote_pack_size(code) if not force else None
    if remote_size:
        _status[code].update(
            status="done",
            progress=f"already uploaded · {round(remote_size / 1_000_000, 1)} MB",
            size_bytes=remote_size,
            error=None,
        )
        await update_routing_manifest_on_r2()
        return True
    path = await build_pack(code)
    if not path:
        return False
    return await upload_pack_to_r2(code)


async def build_all_task(codes: Optional[list[str]] = None):
    global _running
    _running = True
    try:
        targets = ordered_codes(codes)
        for code in targets:
            if code not in ALL_REGION_CODES:
                continue
            try:
                await build_and_upload_pack(code)
            except Exception as exc:
                _status[code].update(status="error", error=str(exc))
    finally:
        _running = False
