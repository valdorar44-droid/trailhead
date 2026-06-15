"""New Zealand Department of Conservation campsite ingestor."""
from __future__ import annotations

import math
import re
import time
from typing import Any

import httpx

from config.settings import settings
from db.store import get_cached, set_cached
from ingestors.provider_guard import record_provider_call, runtime_cached_call

DOC_BASE = "https://api.doc.govt.nz"


def nz_doc_enabled() -> bool:
    return bool(settings.international_camp_providers_enabled and settings.nz_doc_api_key)


def _haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 3958.7613
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _clean_text(value: object, limit: int = 520) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    text = re.sub(r"&nbsp;|&amp;", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _records(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("items", "results", "features", "data", "value"):
        value = payload.get(key)
        if isinstance(value, list):
            out = []
            for item in value:
                if isinstance(item, dict) and item.get("type") == "Feature":
                    props = item.get("properties") if isinstance(item.get("properties"), dict) else {}
                    geom = item.get("geometry") if isinstance(item.get("geometry"), dict) else {}
                    coords = geom.get("coordinates") if isinstance(geom, dict) else None
                    record = dict(props)
                    if isinstance(coords, list) and len(coords) >= 2:
                        record.setdefault("longitude", coords[0])
                        record.setdefault("latitude", coords[1])
                    out.append(record)
                elif isinstance(item, dict):
                    out.append(item)
            return out
    return [payload] if payload else []


def _value(record: dict, *keys: str) -> str:
    lower = {str(k).lower(): v for k, v in record.items()}
    for key in keys:
        value = record.get(key)
        if value not in (None, "", []):
            return str(value).strip()
        value = lower.get(key.lower())
        if value not in (None, "", []):
            return str(value).strip()
    return ""


def _float_value(record: dict, *keys: str) -> float | None:
    for key in keys:
        raw = _value(record, key)
        if not raw:
            continue
        try:
            return float(raw)
        except Exception:
            pass
    loc = record.get("location") or record.get("coordinates")
    if isinstance(loc, dict):
        for key in keys:
            if "lat" in key.lower():
                return _float_value(loc, "lat", "latitude", "y")
            if "lon" in key.lower() or "lng" in key.lower():
                return _float_value(loc, "lng", "lon", "longitude", "x")
    return None


def _normalize(record: dict, kind: str) -> dict | None:
    lat = _float_value(record, "latitude", "lat", "y")
    lng = _float_value(record, "longitude", "lng", "lon", "x")
    if lat is None or lng is None:
        return None
    name = _value(record, "name", "assetName", "campsiteName", "hutName", "title")
    if not name:
        return None
    doc_id = _value(record, "id", "assetId", "campsiteId", "hutId", "slug") or f"{lat:.5f}:{lng:.5f}"
    description = _clean_text(
        _value(record, "introduction", "description", "summary", "shortDescription", "overview")
        or ("DOC hut or shelter." if kind == "hut" else "DOC campsite.")
    )
    booking_url = _value(record, "bookingUrl", "booking_url", "bookingsUrl")
    official_url = _value(record, "url", "webUrl", "staticLink", "link") or booking_url
    tags = ["doc", "public", "official"]
    site_types = ["Hut"] if kind == "hut" else ["Tent", "Campground"]
    land_type = "DOC Hut" if kind == "hut" else "DOC Campsite"
    if kind == "hut":
        tags.extend(["hut", "backcountry"])
    else:
        tags.extend(["tent", "campground"])
    facilities = " ".join(str(record.get(k) or "") for k in record.keys()).lower()
    amenities = []
    for needle, label in (
        ("toilet", "Restrooms"),
        ("water", "Water"),
        ("shower", "Showers"),
        ("fire", "Fire rings"),
        ("booking", "Reservable"),
    ):
        if needle in facilities and label not in amenities:
            amenities.append(label)
    return {
        "id": f"nz_doc_{kind}_{re.sub(r'[^A-Za-z0-9_-]+', '_', str(doc_id))[:80]}",
        "name": name,
        "lat": float(lat),
        "lng": float(lng),
        "tags": tags,
        "land_type": land_type,
        "description": description,
        "photo_url": _value(record, "image", "imageUrl", "thumbnail", "photoUrl"),
        "reservable": bool(booking_url),
        "cost": _value(record, "fees", "price", "cost") or ("Book with DOC" if booking_url else ""),
        "url": official_url or "https://www.doc.govt.nz/parks-and-recreation/places-to-stay/",
        "official_url": official_url or "https://www.doc.govt.nz/parks-and-recreation/places-to-stay/",
        "booking_url": booking_url,
        "ada": "accessible" in facilities,
        "source": "nz_doc",
        "source_tier": "live_free",
        "verified_source": "New Zealand Department of Conservation",
        "source_badge": "NZ DOC",
        "source_confidence": "official",
        "source_freshness": "Official DOC source data cached by Trailhead; verify current access, fees, and availability with DOC.",
        "link_label": "DOC page",
        "rich_detail_available": False,
        "rich_detail_locked": False,
        "rich_detail_reason": "",
        "amenities": amenities,
        "site_types": site_types,
    }


async def _fetch_doc_endpoint(path: str) -> Any:
    key = f"nz_doc:{path}"
    cached = get_cached("campsite_cache", key, ttl_seconds=24 * 3600)
    if cached is not None:
        record_provider_call("nz_doc", path.strip("/"), cache_status="hit", source_action="nearby_camps", key=key)
        return cached

    async def fetch():
        started = time.time()
        async with httpx.AsyncClient(timeout=16) as client:
            res = await client.get(
                f"{DOC_BASE}{path}",
                headers={"x-api-key": settings.nz_doc_api_key, "Accept": "application/json"},
            )
            record_provider_call(
                "nz_doc",
                path.strip("/"),
                status_code=res.status_code,
                duration_ms=round((time.time() - started) * 1000),
                source_action="nearby_camps",
                key=key,
            )
            res.raise_for_status()
            return res.json()

    payload = await runtime_cached_call(key, 300, fetch, provider="nz_doc", endpoint=path.strip("/"), source_action="nearby_camps")
    set_cached("campsite_cache", key, payload)
    return payload


async def get_nz_doc_campsites(
    lat: float,
    lng: float,
    radius_miles: float = 50,
    type_filters: list[str] | None = None,
) -> list[dict]:
    if not nz_doc_enabled():
        return []
    filters = {str(t or "").lower() for t in (type_filters or [])}
    include_huts = bool(filters.intersection({"hut", "huts", "backcountry", "walk_in", "walk-in"}))
    endpoints = [("/v2/campsites", "camp")]
    if include_huts:
        endpoints.append(("/v2/huts", "hut"))
    results: list[dict] = []
    for path, kind in endpoints:
        try:
            payload = await _fetch_doc_endpoint(path)
        except Exception:
            continue
        for record in _records(payload):
            camp = _normalize(record, kind)
            if not camp:
                continue
            if _haversine_miles(lat, lng, camp["lat"], camp["lng"]) <= radius_miles:
                results.append(camp)
    return results[:120]
