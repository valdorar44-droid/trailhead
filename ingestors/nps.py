"""National Park Service official place ingestor.

Uses the public NPS API for parks and park-scoped recreation records. Results
are cached in Trailhead's SQLite cache and intentionally exclude commercial
provider enrichment.
"""
from __future__ import annotations

import asyncio
import math
import re
import time
from typing import Any

import httpx

from config.settings import settings
from db.store import get_cached, set_cached


NPS_BASE = "https://developer.nps.gov/api/v1"


def nps_enabled() -> bool:
    return bool(settings.nps_api_key)


def _cache_key(prefix: str, *parts: object) -> str:
    clean = "_".join(str(p).replace(" ", "-")[:80] for p in parts)
    return f"nps_{prefix}_{clean}"


def _params(**extra: object) -> dict[str, object]:
    return {"api_key": settings.nps_api_key, **extra}


def _clean(value: object, limit: int = 500) -> str:
    return " ".join(str(value or "").split())[:limit]


_WEAK_ENDPOINT_TEXT = {
    "",
    "place",
    "places",
    "thingstodo",
    "things to do",
    "visitorcenter",
    "visitor center",
    "visitor centers",
    "campground",
    "campgrounds",
}


def _meaningful_text(*values: object, limit: int = 650) -> str:
    for value in values:
        clean = _clean(value, limit)
        normalized = re.sub(r"[^a-z0-9]+", " ", clean.lower()).strip()
        if normalized in _WEAK_ENDPOINT_TEXT:
            continue
        if len(normalized) < 16 and normalized in {"places", "attraction", "camp", "park"}:
            continue
        if clean:
            return clean
    return ""


def _latlng(item: dict[str, Any]) -> tuple[float, float] | None:
    lat = item.get("latitude") or item.get("lat")
    lng = item.get("longitude") or item.get("lng")
    try:
        if lat not in (None, "") and lng not in (None, ""):
            return float(lat), float(lng)
    except Exception:
        pass
    raw = str(item.get("latLong") or "")
    match = re.search(r"lat\s*:\s*(-?\d+(?:\.\d+)?).*long\s*:\s*(-?\d+(?:\.\d+)?)", raw, re.I)
    if match:
        return float(match.group(1)), float(match.group(2))
    return None


def _distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _image(item: dict[str, Any]) -> tuple[str | None, list[dict]]:
    photos: list[dict] = []
    for img in item.get("images") or []:
        url = img.get("url") or img.get("src")
        if not url:
            continue
        photos.append({
            "url": url,
            "caption": img.get("caption") or img.get("title") or "",
            "credit": img.get("credit") or "National Park Service",
            "source": "NPS",
        })
    return (photos[0]["url"] if photos else None), photos[:8]


async def _nps_get(path: str, params: dict[str, object], ttl_seconds: int = 86400) -> dict:
    if not nps_enabled():
        return {}
    key = _cache_key(path.replace("/", "_"), *sorted(params.items()))
    cached = get_cached("campsite_cache", key, ttl_seconds=ttl_seconds)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "TrailheadNPS/1.0"}) as client:
            resp = await client.get(f"{NPS_BASE}/{path.lstrip('/')}", params=_params(**params))
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        data = {}
    set_cached("campsite_cache", key, data)
    return data


async def _parks_catalog() -> list[dict]:
    data = await _nps_get("parks", {"limit": 600, "start": 0}, ttl_seconds=86400 * 7)
    return data.get("data") or []


def _park_record(park: dict, center_lat: float, center_lng: float) -> dict | None:
    coord = _latlng(park)
    if not coord:
        return None
    lat, lng = coord
    photo_url, photos = _image(park)
    park_code = str(park.get("parkCode") or "").lower()
    return {
        "id": f"nps_park_{park_code}",
        "source_place_id": f"parks:{park_code}",
        "name": park.get("fullName") or park.get("name") or "National Park Service Site",
        "lat": lat,
        "lng": lng,
        "type": "park",
        "category": "park",
        "subtype": park.get("designation") or "National Park Service",
        "summary": _clean(park.get("description") or park.get("directionsInfo"), 650),
        "description": _clean(park.get("description") or "", 1200),
        "photo_url": photo_url,
        "photos": photos,
        "activities": [a.get("name") for a in (park.get("activities") or []) if a.get("name")][:16],
        "official_url": park.get("url") or f"https://www.nps.gov/{park_code}/index.htm",
        "website": park.get("url") or "",
        "source": "nps",
        "source_label": "National Park Service",
        "verified_source": "National Park Service",
        "source_badge": "Official NPS",
        "source_freshness": "Official NPS API data cached by Trailhead; verify current closures, fees, and hours with NPS.",
        "last_checked": int(time.time()),
        "distance_mi": round(_distance_m(center_lat, center_lng, lat, lng) / 1609.344, 2),
        "nps_id": park_code,
    }


def _kind_for_endpoint(endpoint: str) -> str:
    if endpoint == "campgrounds":
        return "camp"
    if endpoint == "visitorcenters":
        return "visitor_center"
    if endpoint == "thingstodo":
        return "attraction"
    return "attraction"


def _endpoint_record(endpoint: str, item: dict, park: dict, center_lat: float, center_lng: float) -> dict | None:
    coord = _latlng(item) or _latlng(park)
    if not coord:
        return None
    lat, lng = coord
    photo_url, photos = _image(item)
    item_id = str(item.get("id") or item.get("url") or item.get("title") or item.get("name") or f"{lat:.5f}_{lng:.5f}")
    title = item.get("title") or item.get("name") or item.get("fullName") or "NPS place"
    kind = _kind_for_endpoint(endpoint)
    url = item.get("url") or park.get("url") or ""
    return {
        "id": f"nps_{endpoint}_{re.sub(r'[^A-Za-z0-9_.:-]+', '_', item_id)[:120]}",
        "source_place_id": f"{endpoint}:{item_id}",
        "name": _clean(title, 180),
        "lat": lat,
        "lng": lng,
        "type": kind,
        "category": kind,
        "subtype": endpoint.replace("thingstodo", "Things to do").replace("visitorcenters", "Visitor center").title(),
        "summary": _meaningful_text(item.get("shortDescription"), item.get("description"), limit=650),
        "description": _meaningful_text(item.get("description"), item.get("shortDescription"), limit=1200),
        "photo_url": photo_url,
        "photos": photos,
        "activities": [a.get("name") for a in (item.get("activities") or []) if isinstance(a, dict) and a.get("name")][:12],
        "official_url": url,
        "website": url,
        "source": "nps",
        "source_label": "National Park Service",
        "verified_source": "National Park Service",
        "source_badge": "Official NPS",
        "source_freshness": "Official NPS API data cached by Trailhead; verify current closures, fees, and hours with NPS.",
        "last_checked": int(time.time()),
        "distance_mi": round(_distance_m(center_lat, center_lng, lat, lng) / 1609.344, 2),
        "nps_id": item_id,
        "park_code": park.get("parkCode"),
    }


async def _park_children(endpoint: str, park_codes: list[str]) -> list[dict]:
    if not park_codes:
        return []
    data = await _nps_get(endpoint, {"parkCode": ",".join(park_codes), "limit": 100, "start": 0}, ttl_seconds=86400)
    return data.get("data") or []


async def _park_alerts(park_codes: list[str]) -> dict[str, list[dict]]:
    if not park_codes:
        return {}
    data = await _nps_get("alerts", {"parkCode": ",".join(park_codes), "limit": 50, "start": 0}, ttl_seconds=3600)
    grouped: dict[str, list[dict]] = {}
    for alert in data.get("data") or []:
        code = str(alert.get("parkCode") or "").lower()
        grouped.setdefault(code, []).append({
            "title": alert.get("title"),
            "category": alert.get("category"),
            "url": alert.get("url"),
        })
    return grouped


async def get_nps_places(lat: float, lng: float, radius_m: int = 80000,
                         categories: set[str] | None = None, limit: int = 80) -> list[dict]:
    if not nps_enabled():
        return []
    wanted = {str(c).lower() for c in (categories or set())}
    parks = []
    for park in await _parks_catalog():
        record = _park_record(park, lat, lng)
        if not record:
            continue
        if _distance_m(lat, lng, record["lat"], record["lng"]) <= radius_m:
            parks.append((park, record))
    parks.sort(key=lambda pair: pair[1]["distance_mi"])
    near_parks = parks[:8]
    park_codes = [str(p[0].get("parkCode") or "").lower() for p in near_parks if p[0].get("parkCode")]

    endpoints = []
    if not wanted or wanted.intersection({"park", "attraction", "historic", "tourism"}):
        endpoints.extend(["places", "thingstodo"])
    if not wanted or wanted.intersection({"camp", "camping"}):
        endpoints.append("campgrounds")
    if not wanted or wanted.intersection({"visitor_center", "attraction", "tourism"}):
        endpoints.append("visitorcenters")

    children_batches = await asyncio.gather(*[_park_children(endpoint, park_codes) for endpoint in endpoints], return_exceptions=True)
    alerts = await _park_alerts(park_codes)
    results: list[dict] = []
    if not wanted or wanted.intersection({"park", "attraction", "historic", "tourism"}):
        for park, record in near_parks:
            code = str(park.get("parkCode") or "").lower()
            record["alerts"] = alerts.get(code, [])[:5]
            results.append(record)
    park_lookup = {str(park.get("parkCode") or "").lower(): park for park, _ in near_parks}
    for endpoint, batch in zip(endpoints, children_batches):
        if isinstance(batch, Exception):
            continue
        for item in batch:
            park_code = str(item.get("parkCode") or "").lower()
            park = park_lookup.get(park_code) or (near_parks[0][0] if near_parks else {})
            record = _endpoint_record(endpoint, item, park, lat, lng)
            if not record:
                continue
            if _distance_m(lat, lng, record["lat"], record["lng"]) <= radius_m:
                results.append(record)
    results.sort(key=lambda r: (r.get("distance_mi", 9999), r.get("name", "")))
    return results[:limit]
