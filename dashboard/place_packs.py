"""Offline place pack generation and R2 upload.

The first pack is intentionally small and practical: region essentials
for fuel, water, trailheads, viewpoints, peaks, and hot springs. Packs are
plain JSON so the current Expo binary can download and render them OTA.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path

from dashboard.pmtiles_bootstrap import DATA_DIR
from dashboard.pmtiles_states import STATE_BBOXES, REGION_BBOXES
from ingestors.osm import (
    get_fuel_stations,
    get_hot_springs,
    get_peaks,
    get_trailheads,
    get_viewpoints,
    get_water_sources,
)

PLACE_PACK_DIR = DATA_DIR / "place_packs"
PLACE_PACK_DIR.mkdir(parents=True, exist_ok=True)

PACK_DEFINITIONS = {
    "essentials": {
        "id": "essentials",
        "name": "Essentials",
        "description": "Fuel, water, trailheads, viewpoints, peaks, and hot springs.",
        "categories": ["fuel", "water", "trailhead", "viewpoint", "peak", "hot_spring"],
    },
}

ALL_REGION_BBOXES = {**STATE_BBOXES, **REGION_BBOXES}

_status: dict[str, dict] = {}
_running = False


def pack_path(region: str, pack_id: str) -> Path:
    region = _region_id(region)
    pack_id = _pack_id(pack_id)
    return PLACE_PACK_DIR / f"{region}-{pack_id}.json"


def _region_id(region: str) -> str:
    return region.strip().lower()


def _pack_id(pack_id: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "-", pack_id.strip().lower()).strip("-") or "essentials"


def _bbox_for_region(region: str) -> tuple[float, float, float, float]:
    code = region.upper()
    if code in ALL_REGION_BBOXES:
        return ALL_REGION_BBOXES[code]
    raise ValueError(f"Unknown place pack region: {region}")


def _region_name(region: str) -> str:
    code = region.upper()
    if code == "KS":
        return "Kansas"
    if code == "CANADA":
        return "Canada"
    if code == "MEXICO":
        return "Mexico"
    return code


def _grid_samples(bbox: tuple[float, float, float, float], spacing_deg: float = 1.25) -> list[dict]:
    west, south, east, north = bbox
    samples: list[dict] = []
    lat = south + spacing_deg / 2
    while lat < north:
        lng = west + spacing_deg / 2
        while lng < east:
            samples.append({"lat": round(lat, 5), "lng": round(lng, 5)})
            lng += spacing_deg
        lat += spacing_deg
    # Include broad coverage around corners/center without relying only on grid.
    samples.extend([
        {"lat": round((south + north) / 2, 5), "lng": round((west + east) / 2, 5)},
        {"lat": round(south + 0.25, 5), "lng": round(west + 0.25, 5)},
        {"lat": round(north - 0.25, 5), "lng": round(east - 0.25, 5)},
    ])
    seen = set()
    out = []
    for sample in samples:
        key = (sample["lat"], sample["lng"])
        if key not in seen:
            seen.add(key)
            out.append(sample)
    return out


def _normalize_pack_point(item: dict, category: str) -> dict | None:
    lat, lng = item.get("lat"), item.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    ptype = str(item.get("type") or category or "poi")
    return {
        "id": str(item.get("id") or f"{ptype}_{lat:.5f}_{lng:.5f}"),
        "name": str(item.get("name") or ptype.replace("_", " ").title()),
        "lat": float(lat),
        "lng": float(lng),
        "type": ptype,
        "category": ptype if ptype in PACK_DEFINITIONS["essentials"]["categories"] else category,
        "source": str(item.get("source") or "osm"),
        "subtype": item.get("subtype") or "",
        "address": item.get("address") or "",
        "fuel_types": item.get("fuel_types") or "",
        "elevation": item.get("elevation") or "",
    }


async def _fetch_sample(sample: dict) -> list[dict]:
    lat = sample["lat"]
    lng = sample["lng"]
    fuel, water, trailheads, viewpoints, peaks, hot_springs = await asyncio.gather(
        get_fuel_stations(lat, lng, radius_m=76000),
        get_water_sources(lat, lng, radius_m=70000),
        get_trailheads(lat, lng, radius_m=70000),
        get_viewpoints(lat, lng, radius_m=70000),
        get_peaks(lat, lng, radius_m=80000),
        get_hot_springs(lat, lng, radius_m=100000),
        return_exceptions=True,
    )
    out: list[dict] = []
    for category, batch in (
        ("fuel", fuel), ("water", water), ("trailhead", trailheads),
        ("viewpoint", viewpoints), ("peak", peaks), ("hot_spring", hot_springs),
    ):
        if isinstance(batch, list):
            for item in batch:
                point = _normalize_pack_point(item, category)
                if point:
                    out.append(point)
    return out


def status() -> dict:
    out = {}
    for key, data in _status.items():
        region, pack_id = key.split(":", 1)
        path = pack_path(region, pack_id)
        out[key] = {
            **data,
            "on_disk": path.exists(),
            "size_bytes": path.stat().st_size if path.exists() else data.get("size_bytes", 0),
        }
    return {"running": _running, "packs": out}


async def build_region_pack(region: str, pack_id: str = "essentials") -> Path | None:
    region = _region_id(region)
    pack_id = _pack_id(pack_id)
    if pack_id not in PACK_DEFINITIONS:
        raise ValueError(f"Unknown place pack: {pack_id}")
    bbox = _bbox_for_region(region)
    key = f"{region}:{pack_id}"
    samples = _grid_samples(bbox)
    _status[key] = {
        "status": "building",
        "progress": f"0/{len(samples)} cells",
        "error": None,
        "size_bytes": 0,
    }
    semaphore = asyncio.Semaphore(2)
    points: list[dict] = []
    seen = set()
    completed = 0

    async def run_sample(sample: dict) -> list[dict]:
        async with semaphore:
            return await _fetch_sample(sample)

    tasks = [asyncio.create_task(run_sample(sample)) for sample in samples]
    for task in asyncio.as_completed(tasks):
        try:
            batch = await task
        except Exception:
            batch = []
        completed += 1
        _status[key]["progress"] = f"{completed}/{len(samples)} cells"
        for point in batch:
            point_key = point.get("id") or f"{point.get('type')}:{point.get('lat'):.4f}:{point.get('lng'):.4f}"
            if point_key in seen:
                continue
            seen.add(point_key)
            points.append(point)

    priority = {"fuel": 0, "water": 1, "hot_spring": 2, "trailhead": 3, "viewpoint": 4, "peak": 5}
    points.sort(key=lambda p: (priority.get(str(p.get("type")), 9), str(p.get("name", ""))))
    payload = {
        "schema_version": 1,
        "pack_id": f"{region}-{pack_id}",
        "region_id": region,
        "region_name": _region_name(region),
        "name": f"{_region_name(region)} {PACK_DEFINITIONS[pack_id]['name']}",
        "generated_at": int(time.time()),
        "source": "OpenStreetMap",
        "categories": PACK_DEFINITIONS[pack_id]["categories"],
        "points": points,
    }
    path = pack_path(region, pack_id)
    path.write_text(json.dumps(payload, separators=(",", ":")))
    _status[key].update(
        status="built",
        progress=f"built · {len(points)} places",
        size_bytes=path.stat().st_size,
        point_count=len(points),
    )
    return path


async def upload_pack_to_r2(region: str, pack_id: str = "essentials") -> bool:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    region = _region_id(region)
    pack_id = _pack_id(pack_id)
    key = f"{region}:{pack_id}"
    path = pack_path(region, pack_id)
    if not path.exists():
        _status.setdefault(key, {}).update(status="error", error="place pack file not found")
        return False
    _status.setdefault(key, {}).update(status="uploading", progress="uploading")
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
            Key=f"places/{region}-{pack_id}.json",
            Body=path.read_bytes(),
            ContentType="application/json",
        )
        _status[key].update(status="done", progress="uploaded", size_bytes=path.stat().st_size)
        await update_manifest_on_r2()
        return True
    except Exception as exc:
        _status[key].update(status="error", error=f"{type(exc).__name__}: {exc}")
        return False


async def update_manifest_on_r2() -> bool:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    manifest: dict[str, dict] = {"definitions": PACK_DEFINITIONS, "packs": {}}
    for path in PLACE_PACK_DIR.glob("*.json"):
        stem = path.stem
        if "-" not in stem:
            continue
        region, pack_id = stem.split("-", 1)
        try:
            payload = json.loads(path.read_text())
            point_count = len(payload.get("points") or [])
        except Exception:
            point_count = 0
        manifest["packs"][f"{stem}.json"] = {
            "region_id": region,
            "pack_id": pack_id,
            "size": path.stat().st_size,
            "point_count": point_count,
            "url": f"/api/places/packs/{region}/{pack_id}",
        }

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
            Key="places/manifest.json",
            Body=json.dumps(manifest).encode(),
            ContentType="application/json",
        )
        return True
    except Exception:
        return False


async def remote_manifest() -> dict:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        obj = await asyncio.to_thread(r2.get_object, Bucket=settings.r2_bucket, Key="places/manifest.json")
        body = await asyncio.to_thread(obj["Body"].read)
        return json.loads(body.decode())
    except Exception:
        return {"definitions": PACK_DEFINITIONS, "packs": {}}


async def fetch_remote_pack(region: str, pack_id: str = "essentials") -> dict | None:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    region = _region_id(region)
    pack_id = _pack_id(pack_id)
    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        obj = await asyncio.to_thread(
            r2.get_object,
            Bucket=settings.r2_bucket,
            Key=f"places/{region}-{pack_id}.json",
        )
        body = await asyncio.to_thread(obj["Body"].read)
        return json.loads(body.decode())
    except Exception:
        path = pack_path(region, pack_id)
        if path.exists():
            return json.loads(path.read_text())
    return None


async def build_and_upload(region: str, pack_id: str = "essentials") -> bool:
    global _running
    if _running:
        return False
    _running = True
    try:
        path = await build_region_pack(region, pack_id)
        if not path:
            return False
        return await upload_pack_to_r2(region, pack_id)
    finally:
        _running = False
