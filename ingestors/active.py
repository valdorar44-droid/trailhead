"""ACTIVE Network campground and activity adapters.

Live calls are disabled unless the relevant API key is configured. Trailhead
normalizes results as planning/handoff cards only; registration and checkout
remain with ACTIVE/ReserveAmerica.
"""
from __future__ import annotations

import asyncio
import hashlib
import html
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx

from config.settings import settings
from db.store import get_cached, set_cached
from ingestors.provider_guard import provider_budget_available, record_provider_call, runtime_cached_call


CAMPGROUND_BASE = "http://api.amp.active.com/camping/campgrounds"
ACTIVITY_BASE = "https://api.amp.active.com/v2/search"
RESERVE_AMERICA_BASE = "http://www.reserveamerica.com"

CAMPGROUND_SITE_TYPES = {
    "rv": "2001",
    "trailer": "2002",
    "tent": "2003",
    "group": "9002",
    "group_site": "9002",
    "boat": "2004",
    "horse": "3001",
    "cabin": "10001",
}


def active_campground_enabled() -> bool:
    return bool(settings.active_campground_api_key)


def active_activity_enabled() -> bool:
    return bool(settings.active_activity_search_api_key)


def _clean(value: object, limit: int = 500) -> str:
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, dict):
                parts.append(str(item.get("description") or item.get("text") or item.get("name") or ""))
            else:
                parts.append(str(item))
        value = " ".join(parts)
    text = html.unescape(re.sub(r"<[^>]+>", " ", str(value or "")))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _first(record: dict[str, Any], *keys: str) -> str:
    lowered = {str(k).lower(): v for k, v in record.items()}
    for key in keys:
        value = lowered.get(key.lower())
        if value not in (None, "", []):
            return str(value).strip()
    return ""


def _float(record: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = _first(record, key)
        if not value:
            continue
        try:
            return float(value)
        except Exception:
            continue
    return None


def _xml_record_to_dict(el: ET.Element) -> dict[str, Any]:
    result: dict[str, Any] = dict(el.attrib)
    for child in list(el):
        tag = child.tag.split("}", 1)[-1]
        if list(child):
            value: Any = _xml_record_to_dict(child)
        else:
            value = child.text or ""
        if tag in result:
            current = result[tag]
            if not isinstance(current, list):
                result[tag] = [current]
            result[tag].append(value)
        else:
            result[tag] = value
    return result


def parse_campground_xml(xml_text: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_text)
    records: list[dict[str, Any]] = []
    for el in root.iter():
        tag = el.tag.split("}", 1)[-1].lower()
        if tag in {"result", "campground", "facility", "park"} and (el.attrib or list(el)):
            record = _xml_record_to_dict(el)
            if _first(record, "facilityID", "facilityId", "facilityName", "contractID", "facilityName"):
                records.append(record)
    if records:
        return records
    # Some ACTIVE XML responses use item-like child names. Fall back to leaf
    # groups with a name and coordinate.
    for el in list(root):
        record = _xml_record_to_dict(el)
        if _first(record, "facilityName", "facilityNameLower", "name", "contractID"):
            records.append(record)
    return records


def _active_photo_url(value: object) -> str:
    photo = str(value or "").strip()
    if not photo:
        return ""
    if photo.startswith("//"):
        return f"https:{photo}"
    if photo.startswith("http://") or photo.startswith("https://"):
        return photo
    if photo.startswith("/"):
        return f"{RESERVE_AMERICA_BASE}{photo}"
    return photo


def _active_url(value: object) -> str:
    url = str(value or "").strip()
    if not url:
        return ""
    if url.startswith("//"):
        return f"https:{url}"
    if not url.startswith(("http://", "https://")):
        return f"https://{url}"
    return url


def _active_price(value: object) -> str:
    if isinstance(value, list):
        prices: list[float] = []
        labels: list[str] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            for key in ("priceAmt", "amount", "feeAmount", "price"):
                raw = item.get(key)
                try:
                    if raw not in (None, ""):
                        prices.append(float(raw))
                        break
                except Exception:
                    pass
            label = _clean(item.get("name") or item.get("priceName") or item.get("description"), 80)
            if label:
                labels.append(label)
        if prices:
            low, high = min(prices), max(prices)
            return f"${low:.0f}" if low == high and low.is_integer() else f"${low:.0f}-${high:.0f}" if high.is_integer() else f"${low:.2f}-${high:.2f}"
        return ", ".join(labels[:2])
    return _clean(value, 80)


def normalize_campground(record: dict[str, Any], center_lat: float | None = None, center_lng: float | None = None) -> dict | None:
    lat = _float(record, "latitude", "lat", "facilityLatitude", "facilityLat")
    lng = _float(record, "longitude", "lng", "lon", "facilityLongitude", "facilityLong")
    if lat is None or lng is None:
        return None
    facility_id = _first(record, "facilityID", "facilityId", "facilityid", "contractID", "contractId")
    name = _clean(_first(record, "facilityName", "facilityname", "name", "parkName"), 180)
    if not name:
        return None
    photo = _active_photo_url(_first(record, "facilityPhoto", "photo", "photoURL", "photoUrl"))
    combined = " ".join(str(v).lower() for v in record.values() if isinstance(v, (str, int, float)))
    tags = ["active", "campground"]
    if "rv" in combined:
        tags.append("rv")
    if "tent" in combined:
        tags.append("tent")
    if "group" in combined:
        tags.append("group")
    if "pet" in combined:
        tags.append("pets")
    amenities = []
    for needle, label in (
        ("electric", "Electric"),
        ("hookup", "Hookups"),
        ("water", "Water"),
        ("sewer", "Sewer"),
        ("shower", "Showers"),
        ("dump", "Dump station"),
        ("pet", "Pets OK"),
    ):
        if needle in combined and label not in amenities:
            amenities.append(label)
    url = _active_url(_first(record, "contractUrl", "reservationUrl", "facilityURL", "url"))
    if not url and facility_id:
        url = f"https://www.reserveamerica.com/explore/-/{facility_id}/overview"
    out = {
        "id": f"active_camp:{facility_id or f'{lat:.5f}:{lng:.5f}'}",
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": "camp",
        "category": "camp",
        "tags": sorted(set(tags)),
        "land_type": "ACTIVE Campground",
        "description": _clean(_first(record, "facilityDescription", "description", "shortName", "sitesWithAmps"), 420),
        "photo_url": photo or None,
        "photos": [photo] if photo else [],
        "photo_status": "facility" if photo else "placeholder",
        "reservable": True,
        "cost": "Verify price with ACTIVE / ReserveAmerica",
        "amenities": amenities[:12],
        "site_types": ["RV"] if "rv" in tags else ["Group"] if "group" in tags else ["Tent", "Campground"],
        "url": url,
        "official_url": url,
        "booking_url": url,
        "source": "active",
        "verified_source": "ACTIVE / ReserveAmerica",
        "source_label": "ACTIVE",
        "source_badge": "ACTIVE",
        "source_freshness": "ACTIVE Campground Search API data cached by Trailhead; verify current fees and availability with the official provider.",
        "reservation_notes": "Trailhead links to ACTIVE / ReserveAmerica for availability. Checkout, tickets, permits, and reservations stay with the official provider.",
        "last_checked": int(time.time()),
    }
    if center_lat is not None and center_lng is not None:
        out["distance_mi"] = round(_distance_mi(center_lat, center_lng, lat, lng), 2)
    return out


def parse_activity_json(data: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        return []
    results = data.get("results")
    if isinstance(results, list):
        return [r for r in results if isinstance(r, dict)]
    if isinstance(results, dict):
        items = results.get("result") or results.get("items")
        if isinstance(items, list):
            return [r for r in items if isinstance(r, dict)]
    items = data.get("items") or data.get("data")
    return [r for r in items if isinstance(r, dict)] if isinstance(items, list) else []


def normalize_activity(record: dict[str, Any], center_lat: float | None = None, center_lng: float | None = None) -> dict | None:
    asset = record.get("asset") if isinstance(record.get("asset"), dict) else record
    place = asset.get("place") if isinstance(asset.get("place"), dict) else {}
    lat = _float(asset, "latitude", "lat") or _float(place, "latitude", "lat")
    lng = _float(asset, "longitude", "lng", "lon") or _float(place, "longitude", "lng", "lon")
    if lat is None or lng is None:
        return None
    name = _clean(_first(asset, "assetName", "name", "title"), 180)
    if not name:
        return None
    activity_id = _first(asset, "assetGuid", "assetId", "id")
    registration_url = _active_url(_first(asset, "registrationUrlAdr", "preferredUrlAdr", "urlAdr", "url", "homePageUrlAdr"))
    start_date = _first(asset, "activityStartDate", "startDate", "start_date", "date")
    end_date = _first(asset, "activityEndDate", "endDate", "end_date")
    price = _active_price(asset.get("assetPrices") or _first(asset, "price", "fees", "fee"))
    photo = _active_photo_url(_first(asset, "logoUrlAdr", "imageUrl", "photoUrl"))
    description = _clean(
        asset.get("assetDescriptions")
        or _first(asset, "description", "assetDsc", "summary", "shortDescription"),
        5000,
    )
    details = _clean(
        _first(asset, "details", "programDescription", "activityDescription", "longDescription", "registrationInfo"),
        5000,
    )
    summary = _clean(description or details, 420)
    out = {
        "id": f"active_activity:{activity_id or f'{lat:.5f}:{lng:.5f}:{name[:32]}'}",
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": "event" if start_date else "attraction",
        "category": "event" if start_date else "attraction",
        "subtype": _clean(_first(asset, "activityName", "assetType", "category"), 120),
        "summary": summary,
        "description": description,
        "details": details,
        "photo_url": photo or None,
        "photos": [photo] if photo else [],
        "photo_status": "open_photo" if photo else "placeholder",
        "start_date": start_date,
        "end_date": end_date,
        "price": price,
        "registration_url": registration_url,
        "official_url": registration_url,
        "booking_url": registration_url,
        "source": "active",
        "source_label": "ACTIVE",
        "verified_source": "ACTIVE",
        "source_badge": "ACTIVE",
        "source_freshness": "ACTIVE Activity Search API data cached by Trailhead; verify current registration, prices, and schedules with ACTIVE.",
        "reservation_notes": "Trailhead links to ACTIVE for registration. Checkout stays with the official provider.",
        "last_checked": int(time.time()),
    }
    if center_lat is not None and center_lng is not None:
        out["distance_mi"] = round(_distance_mi(center_lat, center_lng, lat, lng), 2)
    return out


def _distance_mi(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    import math
    r = 3958.7613
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _campground_params(lat: float, lng: float, radius_miles: float, filters: dict[str, Any] | None = None) -> dict[str, Any]:
    filters = filters or {}
    params: dict[str, Any] = {
        "landmarkName": "true",
        "landmarkLat": f"{lat:.6f}",
        "landmarkLong": f"{lng:.6f}",
        "xml": "true",
        "api_key": settings.active_campground_api_key,
    }
    site_type = filters.get("site_type")
    if site_type:
        params["siteType"] = CAMPGROUND_SITE_TYPES.get(str(site_type).lower(), site_type)
    if filters.get("group_site"):
        params["siteType"] = CAMPGROUND_SITE_TYPES["group"]
    if filters.get("pets"):
        params["pets"] = "3010"
    if filters.get("rv"):
        params["siteType"] = CAMPGROUND_SITE_TYPES["rv"]
    if filters.get("tent"):
        params["siteType"] = CAMPGROUND_SITE_TYPES["tent"]
    # ACTIVE does not document a radius parameter for campground landmark
    # lookup; it returns nearest-first. Trailhead applies radius filtering.
    return params


async def get_active_campgrounds(lat: float, lng: float, radius_miles: float = 35, filters: dict[str, Any] | None = None, limit: int = 40) -> list[dict]:
    if not active_campground_enabled() or not provider_budget_available("active", "campgrounds"):
        return []
    radius_miles = max(1, min(float(radius_miles or 35), 70))
    params = _campground_params(lat, lng, radius_miles, filters)
    params_hash = hashlib.sha1(urlencode(sorted(params.items())).encode()).hexdigest()[:16]
    cache_key = f"active_campgrounds:v2:{lat:.3f}:{lng:.3f}:{radius_miles:.1f}:{params_hash}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24)
    if cached is not None:
        record_provider_call("active", "campgrounds", cache_status="hit", source_action="nearby_campgrounds", key=cache_key)
        return cached

    async def fetch() -> list[dict]:
        started = time.time()
        try:
            async with httpx.AsyncClient(timeout=16, headers={"User-Agent": "TrailheadActive/1.0"}) as client:
                res = await client.get(CAMPGROUND_BASE, params=params)
                record_provider_call("active", "campgrounds", status_code=res.status_code, duration_ms=round((time.time() - started) * 1000), source_action="nearby_campgrounds", key=cache_key)
                res.raise_for_status()
                records = parse_campground_xml(res.text)
        except Exception:
            return []
        out = [normalize_campground(record, lat, lng) for record in records]
        filtered = [
            item for item in out
            if item and float(item.get("distance_mi") or 0) <= radius_miles
        ]
        filtered.sort(key=lambda item: float(item.get("distance_mi") or 9999))
        return filtered[:limit]

    results = await runtime_cached_call(cache_key, 60, fetch, provider="active", endpoint="campgrounds", source_action="nearby_campgrounds")
    set_cached("campsite_cache", cache_key, results)
    return results


async def get_active_activities(
    lat: float,
    lng: float,
    radius_miles: float = 35,
    start_date: date | None = None,
    end_date: date | None = None,
    category: str = "",
    limit: int = 40,
) -> list[dict]:
    if not active_activity_enabled() or not provider_budget_available("active", "activities"):
        return []
    radius_miles = max(1, min(float(radius_miles or 35), 100))
    start_date = start_date or date.today()
    end_date = end_date or (start_date + timedelta(days=90))
    params: dict[str, Any] = {
        "lat_lon": f"{lat:.6f},{lng:.6f}",
        "radius": int(radius_miles),
        "show_distance": "true",
        "sort": "distance",
        "current_page": 1,
        "per_page": max(1, min(int(limit), 50)),
        "start_date": f"{start_date.isoformat()}..{end_date.isoformat()}",
        "api_key": settings.active_activity_search_api_key,
    }
    if category:
        params["category"] = category
    cache_key = f"active_activities:v4:{lat:.3f}:{lng:.3f}:{radius_miles:.1f}:{category}:{start_date.isoformat()}:{end_date.isoformat()}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 6)
    if cached is not None:
        record_provider_call("active", "activities", cache_status="hit", source_action="nearby_activities", key=cache_key)
        return cached

    async def fetch() -> list[dict]:
        started = time.time()
        try:
            async with httpx.AsyncClient(timeout=16, headers={"User-Agent": "TrailheadActive/1.0"}) as client:
                res = await client.get(ACTIVITY_BASE, params=params)
                record_provider_call("active", "activities", status_code=res.status_code, duration_ms=round((time.time() - started) * 1000), source_action="nearby_activities", key=cache_key)
                res.raise_for_status()
                records = parse_activity_json(res.json())
        except Exception:
            return []
        out = [normalize_activity(record, lat, lng) for record in records]
        filtered = [item for item in out if item]
        filtered.sort(key=lambda item: float(item.get("distance_mi") or 9999))
        return filtered[:limit]

    results = await runtime_cached_call(cache_key, 60, fetch, provider="active", endpoint="activities", source_action="nearby_activities")
    set_cached("campsite_cache", cache_key, results)
    return results


async def polite_active_campground_pause() -> None:
    await asyncio.sleep(0.5)


async def polite_active_activity_pause() -> None:
    await asyncio.sleep(0.2)
