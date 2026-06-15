"""Canadian open-data campsite ingestor.

Canada's official campground data is fragmented by province/territory. This
module supports curated machine-readable GeoJSON feeds configured by env while
avoiding runtime scraping of PDFs or catalog-only metadata.
"""
from __future__ import annotations

import json
import math
import os
import re
import time
from typing import Any

import httpx

from config.settings import settings
from db.store import get_cached, set_cached
from ingestors.provider_guard import record_provider_call, runtime_cached_call


def _configured_feeds() -> list[dict]:
    feeds: list[dict] = []
    raw = os.environ.get("CANADA_CAMP_GEOJSON_URLS", "").strip()
    for idx, url in enumerate([u.strip() for u in raw.split(",") if u.strip()]):
        feeds.append({
            "id": f"ca_custom_{idx}",
            "source_badge": "Canada Open Data",
            "verified_source": "Canadian government open data",
            "url": url,
            "official_url": url,
            "camp_terms": ["camp", "campground", "campsite", "rv", "caravan"],
        })
    return feeds


def _haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 3958.7613
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _clean_text(value: object, limit: int = 420) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    text = re.sub(r"&nbsp;|&amp;", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


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
    return None


def _feature_records(payload: Any) -> list[dict]:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            return []
    if isinstance(payload, list):
        return [p for p in payload if isinstance(p, dict)]
    if not isinstance(payload, dict):
        return []
    features = payload.get("features")
    if isinstance(features, list):
        records = []
        for feature in features:
            if not isinstance(feature, dict):
                continue
            props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
            record = dict(props)
            geom = feature.get("geometry") if isinstance(feature.get("geometry"), dict) else {}
            coords = geom.get("coordinates") if isinstance(geom, dict) else None
            if isinstance(coords, list):
                if geom.get("type") == "Point" and len(coords) >= 2:
                    record.setdefault("lng", coords[0])
                    record.setdefault("lat", coords[1])
                elif coords and isinstance(coords[0], list):
                    point = coords[0][0] if coords and coords[0] and isinstance(coords[0][0], list) else coords[0]
                    if isinstance(point, list) and len(point) >= 2:
                        record.setdefault("lng", point[0])
                        record.setdefault("lat", point[1])
            records.append(record)
        return records
    for key in ("items", "results", "data", "records"):
        value = payload.get(key)
        if isinstance(value, list):
            return [p for p in value if isinstance(p, dict)]
    return []


def _looks_like_camp(record: dict, feed: dict) -> bool:
    text = " ".join(str(v or "") for v in record.values()).lower()
    if any(term in text for term in ("campus", "boot camp", "training camp")):
        return False
    return any(term in text for term in feed.get("camp_terms") or ["camp", "campground"])


def _normalize(record: dict, feed: dict) -> dict | None:
    lat = _float_value(record, "lat", "latitude", "y")
    lng = _float_value(record, "lng", "lon", "longitude", "x")
    if lat is None or lng is None or not _looks_like_camp(record, feed):
        return None
    name = _value(record, "name", "Name", "facility_name", "park_name", "title") or "Campground"
    subtype = _value(record, "type", "Type", "category", "class", "facility_type")
    text = " ".join(str(v or "") for v in record.values()).lower()
    tags = ["campground", "official", "canada"]
    site_types = ["Campground"]
    land_type = "Campground"
    if "rv" in text or "recreational vehicle" in text:
        tags.append("rv")
        site_types.append("RV")
    else:
        tags.append("tent")
    if "provincial" in text:
        tags.append("provincial")
        land_type = "Provincial Park Campground"
    elif "territorial" in text:
        tags.append("territorial")
        land_type = "Territorial Park Campground"
    amenities = []
    for needle, label in (
        ("toilet", "Restrooms"),
        ("water", "Water"),
        ("shower", "Showers"),
        ("dump", "Dump station"),
        ("electric", "Electric"),
        ("fire", "Fire rings"),
    ):
        if needle in text and label not in amenities:
            amenities.append(label)
    source_id = _value(record, "id", "objectid", "fid", "globalid") or f"{lat:.5f}:{lng:.5f}:{name}"
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "_", source_id)[:90]
    website = _value(record, "website", "url", "web", "link")
    description = _clean_text(_value(record, "description", "desc", "details", "address") or subtype)
    return {
        "id": f"{feed['id']}_{safe_id}",
        "name": name,
        "lat": float(lat),
        "lng": float(lng),
        "tags": tags,
        "land_type": land_type,
        "description": description or "Canadian government open-data campground record. Verify current access, fees, and booking rules.",
        "photo_url": "",
        "reservable": False,
        "cost": "",
        "url": website or feed.get("official_url") or "",
        "official_url": website or feed.get("official_url") or "",
        "booking_url": "",
        "ada": "accessible" in text,
        "source": feed["id"],
        "source_tier": "live_free",
        "verified_source": feed.get("verified_source") or "Canadian government open data",
        "source_badge": feed.get("source_badge") or "Canada Open Data",
        "source_confidence": "official",
        "source_freshness": f"{feed.get('verified_source') or 'Canadian government open data'} cached by Trailhead; verify current access, fees, and availability.",
        "link_label": "Official data",
        "rich_detail_available": False,
        "rich_detail_locked": False,
        "rich_detail_reason": "",
        "amenities": amenities,
        "site_types": site_types,
    }


async def _fetch_feed(feed: dict) -> Any:
    key = f"canada_open_data:{feed['id']}"
    cached = get_cached("campsite_cache", key, ttl_seconds=72 * 3600)
    if cached is not None:
        record_provider_call("canada_open_data", feed["id"], cache_status="hit", source_action="nearby_camps", key=key)
        return cached

    async def fetch():
        started = time.time()
        async with httpx.AsyncClient(timeout=18, follow_redirects=True) as client:
            res = await client.get(feed["url"], headers={"Accept": "application/json"})
            record_provider_call(
                "canada_open_data",
                feed["id"],
                status_code=res.status_code,
                duration_ms=round((time.time() - started) * 1000),
                source_action="nearby_camps",
                key=key,
            )
            res.raise_for_status()
            return res.json()

    payload = await runtime_cached_call(key, 600, fetch, provider="canada_open_data", endpoint=feed["id"], source_action="nearby_camps")
    set_cached("campsite_cache", key, payload)
    return payload


async def get_canada_open_data_campsites(
    lat: float,
    lng: float,
    radius_miles: float = 50,
    type_filters: list[str] | None = None,
) -> list[dict]:
    if not (settings.international_camp_providers_enabled and settings.canada_open_data_enabled):
        return []
    results: list[dict] = []
    for feed in _configured_feeds():
        try:
            payload = await _fetch_feed(feed)
        except Exception:
            continue
        for record in _feature_records(payload):
            camp = _normalize(record, feed)
            if not camp:
                continue
            if _haversine_miles(lat, lng, camp["lat"], camp["lng"]) <= radius_miles:
                results.append(camp)
    return results[:120]
