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

import httpx

from dashboard.pmtiles_bootstrap import DATA_DIR
from dashboard.pmtiles_states import STATE_BBOXES, REGION_BBOXES

PLACE_PACK_DIR = DATA_DIR / "place_packs"
PLACE_PACK_DIR.mkdir(parents=True, exist_ok=True)

PACK_DEFINITIONS = {
    "essentials": {
        "id": "essentials",
        "name": "Essentials",
        "description": "Core road-trip services, outdoor stops, lodging, and useful town stops.",
        "categories": [
            "fuel", "propane", "water", "dump", "shower", "laundromat",
            "lodging", "food", "grocery", "mechanic", "parking", "attraction",
            "trailhead", "viewpoint", "peak", "hot_spring",
        ],
    },
    "services": {
        "id": "services",
        "name": "Services",
        "description": "Fuel, propane, water, dump stations, showers, laundry, groceries, and mechanics.",
        "categories": ["fuel", "propane", "water", "dump", "shower", "laundromat", "grocery", "mechanic"],
    },
    "outdoors": {
        "id": "outdoors",
        "name": "Outdoors",
        "description": "Trailheads, viewpoints, peaks, and hot springs.",
        "categories": ["trailhead", "viewpoint", "peak", "hot_spring"],
    },
}

ALL_REGION_BBOXES = {**STATE_BBOXES, **REGION_BBOXES}

_status: dict[str, dict] = {}
_running = False
_batch: dict = {"running": False, "current": "", "completed": 0, "total": 0, "errors": []}

SMALLEST_FIRST_ORDER = [
    "RI", "DE", "CT", "HI", "NH", "VT", "MA", "NJ", "MD", "WV",
    "SC", "ME", "AL", "MS", "KY", "TN", "IN", "AR", "LA", "IA",
    "OH", "VA", "NC", "WI", "MO", "KS", "NE", "OK", "MN", "IL",
    "GA", "SD", "ND", "PA", "FL", "MI", "NY", "ID", "WA", "OR",
    "CO", "NM", "AZ", "UT", "NV", "WY", "MT", "AK", "CA", "TX",
]
SMALLEST_FIRST_RANK = {code.lower(): idx for idx, code in enumerate(SMALLEST_FIRST_ORDER)}


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


OVERPASS = "https://overpass-api.de/api/interpreter"
ZERO_OK_PACKS = {
    ("ct", "essentials"), ("ct", "services"), ("ct", "outdoors"),
    ("hi", "services"),
    ("nh", "services"),
    ("nj", "essentials"),
    ("ri", "outdoors"),
}


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


def _bbox_cells(bbox: tuple[float, float, float, float], step_deg: float = 1.5) -> list[tuple[float, float, float, float]]:
    west, south, east, north = bbox
    cells: list[tuple[float, float, float, float]] = []
    s = south
    while s < north:
        n = min(north, s + step_deg)
        w = west
        while w < east:
            e = min(east, w + step_deg)
            cells.append((w, s, e, n))
            w = e
        s = n
    return cells


def _cell_step_for_region(region: str) -> float:
    # CA/TX are dense enough that broad Overpass cells can time out or get throttled.
    if region in {"ca", "tx"}:
        return 0.75
    if region == "ak":
        return 1.5
    return 1.5


def _node_coord(el: dict) -> tuple[float, float] | None:
    if el.get("type") == "way":
        center = el.get("center") or {}
        lat, lng = center.get("lat"), center.get("lon")
    else:
        lat, lng = el.get("lat"), el.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        return float(lat), float(lng)
    return None


def _classify_osm(el: dict) -> str | None:
    tags = el.get("tags") or {}
    if tags.get("amenity") == "fuel":
        if tags.get("fuel:propane") == "yes" and tags.get("fuel:diesel") != "yes":
            return "propane"
        return "fuel"
    if tags.get("natural") == "spring" or tags.get("amenity") in {"drinking_water", "water_point"}:
        return "water"
    if tags.get("highway") == "trailhead" or tags.get("trailhead") == "yes":
        return "trailhead"
    if tags.get("tourism") == "viewpoint":
        return "viewpoint"
    if tags.get("natural") == "peak":
        return "peak"
    if tags.get("natural") == "hot_spring" or (tags.get("amenity") == "public_bath" and tags.get("bath:type") == "hot_spring"):
        return "hot_spring"
    if tags.get("tourism") in {"hotel", "motel", "guest_house", "hostel"}:
        return "lodging"
    if tags.get("amenity") == "shower":
        return "shower"
    if tags.get("amenity") == "sanitary_dump_station" or tags.get("sanitary_dump_station") == "yes":
        return "dump"
    if tags.get("shop") == "laundry":
        return "laundromat"
    if tags.get("amenity") in {"restaurant", "cafe", "fast_food"}:
        return "food"
    if tags.get("shop") in {"supermarket", "convenience", "general"}:
        return "grocery"
    if tags.get("shop") in {"car_repair", "tyres"} or tags.get("craft") == "mechanic":
        return "mechanic"
    if tags.get("amenity") == "parking":
        return "parking"
    if tags.get("tourism") == "attraction":
        return "attraction"
    return None


def _normalize_overpass_element(el: dict) -> dict | None:
    coord = _node_coord(el)
    ptype = _classify_osm(el)
    if not coord or not ptype:
        return None
    tags = el.get("tags") or {}
    lat, lng = coord
    if tags.get("access") in {"private", "no"}:
        return None
    name = (
        tags.get("name") or tags.get("brand") or tags.get("operator") or
        ("Natural Spring" if tags.get("natural") == "spring" else ptype.replace("_", " ").title())
    )
    fuel_types: list[str] = []
    if ptype in {"fuel", "propane"}:
        if tags.get("fuel:diesel") == "yes":
            fuel_types.append("diesel")
        if tags.get("fuel:propane") == "yes":
            fuel_types.append("propane")
        if tags.get("fuel:octane_87") == "yes" or not fuel_types:
            fuel_types.append("gas")
    kind = el.get("type") or "node"
    return {
        "id": f"osm_{ptype}_{kind}_{el.get('id', '')}",
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": ptype,
        "category": ptype,
        "source": "osm",
        "subtype": tags.get("bath:type") or tags.get("tourism") or tags.get("shop") or tags.get("natural") or tags.get("amenity") or "",
        "address": ", ".join([v for v in [tags.get("addr:street"), tags.get("addr:city"), tags.get("addr:state")] if v]),
        "fuel_types": ", ".join(fuel_types),
        "elevation": tags.get("ele", ""),
    }


async def _fetch_bbox_cell(cell: tuple[float, float, float, float]) -> list[dict]:
    west, south, east, north = cell
    bbox = f"{south},{west},{north},{east}"
    query = f"""[out:json][timeout:25];
(
  node["amenity"="fuel"]({bbox});
  way["amenity"="fuel"]({bbox});
  node["fuel:propane"="yes"]({bbox});
  way["fuel:propane"="yes"]({bbox});
  node["natural"="spring"]({bbox});
  node["amenity"="drinking_water"]({bbox});
  node["amenity"="water_point"]({bbox});
  node["amenity"="sanitary_dump_station"]({bbox});
  way["amenity"="sanitary_dump_station"]({bbox});
  node["sanitary_dump_station"="yes"]({bbox});
  way["sanitary_dump_station"="yes"]({bbox});
  node["amenity"="shower"]({bbox});
  node["shop"="laundry"]({bbox});
  node["tourism"~"hotel|motel|guest_house|hostel"]({bbox});
  way["tourism"~"hotel|motel|guest_house|hostel"]({bbox});
  node["amenity"~"restaurant|cafe|fast_food"]({bbox});
  node["shop"~"supermarket|convenience|general"]({bbox});
  node["shop"~"car_repair|tyres"]({bbox});
  way["shop"~"car_repair|tyres"]({bbox});
  node["craft"="mechanic"]({bbox});
  node["amenity"="parking"]({bbox});
  way["amenity"="parking"]({bbox});
  node["tourism"="attraction"]({bbox});
  way["tourism"="attraction"]({bbox});
  node["highway"="trailhead"]({bbox});
  node["trailhead"="yes"]({bbox});
  node["tourism"="viewpoint"]({bbox});
  way["tourism"="viewpoint"]({bbox});
  node["natural"="peak"]["name"]({bbox});
  node["natural"="hot_spring"]({bbox});
  way["natural"="hot_spring"]({bbox});
  node["amenity"="public_bath"]["bath:type"="hot_spring"]({bbox});
  way["amenity"="public_bath"]["bath:type"="hot_spring"]({bbox});
);
out body center 1800;
"""
    elements = []
    async with httpx.AsyncClient(timeout=55) as client:
        for attempt in range(3):
            try:
                res = await client.post(
                    OVERPASS,
                    data={"data": query},
                    headers={"User-Agent": "Trailhead/1.0 (offline place pack builder)"},
                )
                res.raise_for_status()
                elements = res.json().get("elements") or []
                break
            except Exception:
                if attempt == 2:
                    return []
                await asyncio.sleep(1.5 * (attempt + 1))
    points = []
    for el in elements:
        point = _normalize_overpass_element(el)
        if point:
            points.append(point)
    return points


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
        "category": ptype,
        "source": str(item.get("source") or "osm"),
        "subtype": item.get("subtype") or "",
        "address": item.get("address") or "",
        "fuel_types": item.get("fuel_types") or "",
        "elevation": item.get("elevation") or "",
    }


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
    return {"running": _running, "batch": _batch, "packs": out}


def ordered_regions(regions: list[str] | None = None) -> list[str]:
    targets = [r.lower() for r in (regions or STATE_BBOXES.keys()) if r.upper() in STATE_BBOXES]
    return sorted(targets, key=lambda r: SMALLEST_FIRST_RANK.get(r, 999))


async def build_region_pack(region: str, pack_id: str = "essentials") -> Path | None:
    region = _region_id(region)
    pack_id = _pack_id(pack_id)
    if pack_id not in PACK_DEFINITIONS:
        raise ValueError(f"Unknown place pack: {pack_id}")
    bbox = _bbox_for_region(region)
    key = f"{region}:{pack_id}"
    cells = _bbox_cells(bbox, _cell_step_for_region(region))
    _status[key] = {
        "status": "building",
        "progress": f"0/{len(cells)} cells",
        "error": None,
        "size_bytes": 0,
    }
    semaphore = asyncio.Semaphore(1 if region in {"ca", "tx"} else 2)
    points: list[dict] = []
    seen = set()
    completed = 0

    async def run_cell(cell: tuple[float, float, float, float]) -> list[dict]:
        async with semaphore:
            return await _fetch_bbox_cell(cell)

    tasks = [asyncio.create_task(run_cell(cell)) for cell in cells]
    for task in asyncio.as_completed(tasks):
        try:
            batch = await task
        except Exception:
            batch = []
        completed += 1
        _status[key]["progress"] = f"{completed}/{len(cells)} cells"
        for point in batch:
            point_key = point.get("id") or f"{point.get('type')}:{point.get('lat'):.4f}:{point.get('lng'):.4f}"
            if point_key in seen:
                continue
            seen.add(point_key)
            points.append(point)

    priority = {"fuel": 0, "water": 1, "hot_spring": 2, "trailhead": 3, "viewpoint": 4, "peak": 5}
    allowed_categories = set(PACK_DEFINITIONS[pack_id]["categories"])
    points = [p for p in points if str(p.get("type") or p.get("category")) in allowed_categories]
    points.sort(key=lambda p: (priority.get(str(p.get("type")), 9), str(p.get("name", ""))))
    if not points and (region, pack_id) not in ZERO_OK_PACKS:
        existing = pack_path(region, pack_id)
        existing_count = 0
        if existing.exists():
            try:
                existing_count = len((json.loads(existing.read_text()).get("points") or []))
            except Exception:
                existing_count = 0
        if existing.exists() and existing_count > 0:
            _status[key].update(
                status="error",
                progress="0 places returned; kept existing pack",
                error="Overpass returned no usable places",
                size_bytes=existing.stat().st_size,
                point_count=existing_count,
            )
            return existing
        raise RuntimeError(f"{region}:{pack_id} returned 0 places")
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

    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        manifest: dict[str, dict] = {"definitions": PACK_DEFINITIONS, "packs": {}}
        listed_keys: set[str] = set()
        token = None
        while True:
            kwargs = {"Bucket": settings.r2_bucket, "Prefix": "places/"}
            if token:
                kwargs["ContinuationToken"] = token
            page = await asyncio.to_thread(r2.list_objects_v2, **kwargs)
            for item in page.get("Contents") or []:
                key = item.get("Key") or ""
                if key == "places/manifest.json" or not key.endswith(".json"):
                    continue
                name = key.rsplit("/", 1)[-1]
                stem = name[:-5]
                if "-" not in stem:
                    continue
                region, pack_id = stem.split("-", 1)
                if pack_id not in PACK_DEFINITIONS:
                    continue
                listed_keys.add(name)
                point_count = 0
                size = int(item.get("Size") or 0)
                try:
                    obj = await asyncio.to_thread(r2.get_object, Bucket=settings.r2_bucket, Key=key)
                    body = await asyncio.to_thread(obj["Body"].read)
                    payload = json.loads(body.decode())
                    point_count = len(payload.get("points") or [])
                except Exception:
                    pass
                manifest["packs"][name] = {
                    "region_id": region,
                    "pack_id": pack_id,
                    "size": size,
                    "point_count": point_count,
                    "url": f"/api/places/packs/{region}/{pack_id}",
                }
            if not page.get("IsTruncated"):
                break
            token = page.get("NextContinuationToken")

        # Include freshly generated local files when the pack has not reached R2 yet.
        for path in PLACE_PACK_DIR.glob("*.json"):
            name = path.name
            if name in listed_keys:
                continue
            stem = path.stem
            if "-" not in stem:
                continue
            region, pack_id = stem.split("-", 1)
            if pack_id not in PACK_DEFINITIONS:
                continue
            try:
                payload = json.loads(path.read_text())
                point_count = len(payload.get("points") or [])
            except Exception:
                point_count = 0
            manifest["packs"][name] = {
                "region_id": region,
                "pack_id": pack_id,
                "size": path.stat().st_size,
                "point_count": point_count,
                "url": f"/api/places/packs/{region}/{pack_id}",
            }

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


async def build_all_task(regions: list[str] | None = None, pack_ids: list[str] | None = None, *, skip_existing: bool = True) -> None:
    global _running
    if _running:
        return
    selected_regions = ordered_regions(regions)
    selected_packs = [_pack_id(p) for p in (pack_ids or list(PACK_DEFINITIONS.keys())) if _pack_id(p) in PACK_DEFINITIONS]
    targets = [(region, pack_id) for region in selected_regions for pack_id in selected_packs]
    _running = True
    _batch.update(running=True, current="", completed=0, total=len(targets), errors=[])
    try:
        for region, pack_id in targets:
            _batch["current"] = f"{region}:{pack_id}"
            if skip_existing and pack_path(region, pack_id).exists():
                _status.setdefault(f"{region}:{pack_id}", {}).update(status="done", progress="already on disk")
                _batch["completed"] += 1
                continue
            try:
                path = await build_region_pack(region, pack_id)
                if not path:
                    _batch["errors"].append(f"{region}:{pack_id}: build failed")
                    continue
                ok = await upload_pack_to_r2(region, pack_id)
                if not ok:
                    _batch["errors"].append(f"{region}:{pack_id}: upload failed")
            except Exception as exc:
                _batch["errors"].append(f"{region}:{pack_id}: {type(exc).__name__}: {exc}")
            finally:
                _batch["completed"] += 1
        await update_manifest_on_r2()
    finally:
        _batch["running"] = False
        _batch["current"] = ""
        _running = False
