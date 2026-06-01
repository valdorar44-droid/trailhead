"""Geoapify Places lightweight passive POI discovery.

Only list/search fields are normalized here. Rich detail, reviews, ratings,
photos, and AI-generated text are deliberately excluded from passive results.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Iterable

import httpx

from db.store import get_cached, set_cached
from ingestors.provider_guard import provider_budget_available, record_provider_call, runtime_cached_call

GEOAPIFY_PLACES_URL = "https://api.geoapify.com/v2/places"
GEOAPIFY_PERMISSION_BACKOFF_KEY = "geoapify_permission_backoff_v1"
GEOAPIFY_QUOTA_BACKOFF_KEY = "geoapify_quota_backoff_v1"
GEOAPIFY_BACKOFF_TTL_SECONDS = 15 * 60
GEOAPIFY_PLACES_TTL_SECONDS = int(os.getenv("GEOAPIFY_PLACES_CACHE_TTL_SECONDS", str(10 * 365 * 24 * 60 * 60)))
log = logging.getLogger(__name__)

GEOAPIFY_CATEGORY_MAP: dict[str, list[str]] = {
    "camp": ["camping.camp_site", "camping.caravan_site"],
    "camps": ["camping.camp_site", "camping.caravan_site"],
    "rv_park": ["camping.caravan_site"],
    "fuel": ["service.vehicle.fuel"],
    "propane": ["service.vehicle.fuel"],
    "dump": ["amenity.toilet", "camping"],
    "parking": ["parking"],
    "water": ["amenity.drinking_water", "natural.water"],
    "food": ["catering.restaurant", "catering.fast_food", "catering.cafe"],
    "grocery": ["commercial.supermarket", "commercial.food_and_drink", "commercial.convenience"],
    "lodging": ["accommodation.hotel", "accommodation.motel", "accommodation.hostel"],
    "farm_stay": ["accommodation.guest_house", "tourism.sights"],
    "ranch": ["accommodation.guest_house", "tourism.sights"],
    "winery": ["catering.restaurant", "tourism.sights"],
    "glamping": ["camping.camp_site", "accommodation.guest_house"],
    "private_camp": ["camping.camp_site", "camping.caravan_site"],
    "mechanic": ["service.vehicle.repair", "service.vehicle"],
    "parts": ["commercial.vehicle", "service.vehicle"],
    "hardware": ["commercial.houseware_and_hardware", "commercial.doityourself"],
    "camping": ["commercial.outdoor_and_sport", "commercial.sports"],
    "medical": ["healthcare.pharmacy", "healthcare.hospital", "healthcare.clinic"],
    "laundromat": ["service.cleaning.laundry"],
    "wifi": ["internet_access", "catering.cafe"],
    "trailhead": ["tourism.sights", "leisure.park"],
    "viewpoint": ["tourism.sights"],
    "park": ["leisure.park", "national_park"],
    "historic": ["heritage", "tourism.sights"],
    "attraction": ["tourism.attraction", "tourism.sights"],
    "hot_spring": ["tourism.sights"],
    "peak": ["natural.mountain.peak"],
}

GEOAPIFY_CATEGORY_PRIORITY = {
    "trailhead": 0,
    "viewpoint": 1,
    "park": 2,
    "historic": 3,
    "attraction": 4,
    "camp": 5,
    "camps": 5,
    "rv_park": 5,
    "private_camp": 6,
    "glamping": 6,
    "farm_stay": 7,
    "ranch": 7,
    "winery": 7,
    "grocery": 8,
    "mechanic": 9,
    "food": 10,
    "camping": 11,
    "parking": 14,
    "dump": 15,
    "fuel": 16,
    "propane": 17,
}


def geoapify_enabled() -> bool:
    return bool(os.getenv("GEOAPIFY_API_KEY", "").strip())


def geoapify_passive_places_enabled() -> bool:
    return (
        geoapify_enabled()
        and os.getenv("GEOAPIFY_PASSIVE_PLACES_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}
    )


def _blocked() -> bool:
    return (
        get_cached("campsite_cache", GEOAPIFY_PERMISSION_BACKOFF_KEY, ttl_seconds=GEOAPIFY_BACKOFF_TTL_SECONDS) is not None
        or get_cached("campsite_cache", GEOAPIFY_QUOTA_BACKOFF_KEY, ttl_seconds=GEOAPIFY_BACKOFF_TTL_SECONDS) is not None
    )


def _remember_block(status_code: int, text: str) -> None:
    payload = {"status_code": status_code, "message": text[:240], "empty": True}
    if status_code in {401, 403}:
        set_cached("campsite_cache", GEOAPIFY_PERMISSION_BACKOFF_KEY, payload)
    elif status_code == 429:
        set_cached("campsite_cache", GEOAPIFY_QUOTA_BACKOFF_KEY, payload)


def _feature_coord(feature: dict) -> tuple[float, float] | None:
    props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
    lat, lon = props.get("lat"), props.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return float(lat), float(lon)
    coords = (feature.get("geometry") or {}).get("coordinates") or []
    if isinstance(coords, list) and len(coords) >= 2 and all(isinstance(v, (int, float)) for v in coords[:2]):
        return float(coords[1]), float(coords[0])
    return None


def _raw_tags(props: dict) -> dict:
    datasource = props.get("datasource")
    if isinstance(datasource, dict) and isinstance(datasource.get("raw"), dict):
        return datasource["raw"]
    return {}


def _category_from_feature(props: dict, requested_category: str) -> str:
    categories = [str(c).lower() for c in (props.get("categories") or [])]
    raw = _raw_tags(props)
    raw_text = " ".join(f"{k}={v}" for k, v in raw.items()).lower()
    text = " ".join([requested_category, *categories, str(props.get("name") or ""), raw_text]).lower()
    if "camping.caravan_site" in categories or "camping.camp_site" in categories:
        return "camp"
    if "fuel:propane" in text or "propane" in text:
        return "propane" if requested_category == "propane" else "fuel"
    if "service.vehicle.fuel" in categories:
        return "fuel"
    if "sanitary_dump" in text or "dump_station" in text:
        return "dump"
    if "parking" in categories or requested_category == "parking":
        return "parking"
    if "amenity.toilet" in categories or "sanitary_dump" in text or "dump" in text:
        return "dump"
    if "amenity.drinking_water" in categories or "natural.water" in categories or requested_category == "water":
        return "water"
    if "commercial.supermarket" in categories or "commercial.food_and_drink" in categories or "commercial.convenience" in categories:
        return "grocery"
    if "service.vehicle.repair" in categories:
        return "mechanic"
    if "tourism.sights" in categories and requested_category in {"viewpoint", "trailhead", "hot_spring", "historic", "attraction"}:
        return requested_category
    if "tourism.sights" in categories:
        return "viewpoint"
    if "leisure.park" in categories:
        return "trailhead" if requested_category == "trailhead" else "park"
    if requested_category in {"camp", "camps", "rv_park"}:
        return "camp"
    return requested_category


def _normalize_feature(feature: dict, requested_category: str) -> dict | None:
    props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
    coord = _feature_coord(feature)
    name = str(props.get("name") or props.get("address_line1") or "").strip()
    place_id = str(props.get("place_id") or props.get("osm_id") or props.get("id") or "").strip()
    if not coord or not name:
        return None
    raw = _raw_tags(props)
    if str(raw.get("access", "")).lower() in {"private", "no"}:
        return None
    lat, lng = coord
    category = _category_from_feature(props, requested_category)
    contact = props.get("contact") if isinstance(props.get("contact"), dict) else {}
    return {
        "id": f"geoapify:{place_id or f'{category}_{lat:.5f}_{lng:.5f}'}",
        "provider_place_id": place_id,
        "place_id": place_id,
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": category,
        "category": category,
        "source": "geoapify",
        "source_tier": "hosted_lightweight",
        "source_label": "Geoapify Places",
        "subtype": str(props.get("category") or props.get("result_type") or category.replace("_", " ").title()),
        "address": props.get("formatted") or props.get("address_line2") or "",
        "phone": contact.get("phone", ""),
        "website": props.get("website") or contact.get("website", ""),
        "fuel_types": "propane" if category == "propane" else ("gas" if category == "fuel" else ""),
        "attribution": "Geoapify",
        "rich_detail_available": False,
        "rich_detail_locked": False,
    }


async def _search_category(lat: float, lng: float, radius_m: int, category: str, limit: int) -> list[dict]:
    api_key = os.getenv("GEOAPIFY_API_KEY", "").strip()
    if not api_key or _blocked() or not provider_budget_available("geoapify", "places"):
        return []
    categories = ",".join(GEOAPIFY_CATEGORY_MAP.get(category, []))
    if not categories:
        return []
    normalized_radius_m = max(1000, min(int(radius_m), 50000))
    params = {
        "categories": categories,
        "filter": f"circle:{lng:.6f},{lat:.6f},{normalized_radius_m}",
        "bias": f"proximity:{lng:.6f},{lat:.6f}",
        "limit": str(max(1, min(int(limit or 20), 80))),
        "apiKey": api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            t0 = asyncio.get_running_loop().time()
            res = await client.get(GEOAPIFY_PLACES_URL, params=params)
            record_provider_call(
                "geoapify",
                "places",
                status_code=res.status_code,
                duration_ms=round((asyncio.get_running_loop().time() - t0) * 1000),
                source_action="nearby_places",
                premium_fields=False,
                source_tier="hosted_lightweight",
                key=f"{category}:{lat:.3f}:{lng:.3f}:{normalized_radius_m}",
            )
            if res.status_code in {401, 403, 429}:
                log.warning("Geoapify Places returned %s for category=%s: %s", res.status_code, category, res.text[:240])
                _remember_block(res.status_code, res.text)
                return []
            res.raise_for_status()
            payload = res.json()
    except Exception as exc:
        log.warning("Geoapify Places failed for category=%s: %s", category, exc)
        return []
    places: list[dict] = []
    for feature in payload.get("features") or []:
        if isinstance(feature, dict):
            normalized = _normalize_feature(feature, category)
            if normalized:
                places.append(normalized)
    return places


def _cache_coord(value: float) -> float:
    return round(float(value) / 0.05) * 0.05


def _cache_radius(radius_m: int) -> int:
    radius = max(1000, min(int(radius_m), 50000))
    return int(round(radius / 10000) * 10000) or 10000


def _provider_categories_for_requested(requested: list[str]) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for category in requested:
        for provider_category in GEOAPIFY_CATEGORY_MAP.get(category, []):
            if provider_category not in seen:
                seen.add(provider_category)
                merged.append(provider_category)
    return merged


async def _search_category_pack(
    lat: float,
    lng: float,
    radius_m: int,
    requested: list[str],
    limit: int,
) -> list[dict]:
    api_key = os.getenv("GEOAPIFY_API_KEY", "").strip()
    if not api_key or _blocked() or not provider_budget_available("geoapify", "places"):
        return []
    provider_categories = _provider_categories_for_requested(requested)
    if not provider_categories:
        return []
    normalized_radius_m = max(1000, min(int(radius_m), 50000))
    params = {
        "categories": ",".join(provider_categories),
        "filter": f"circle:{lng:.6f},{lat:.6f},{normalized_radius_m}",
        "bias": f"proximity:{lng:.6f},{lat:.6f}",
        "limit": str(max(1, min(int(limit or 80), 120))),
        "apiKey": api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            t0 = asyncio.get_running_loop().time()
            res = await client.get(GEOAPIFY_PLACES_URL, params=params)
            record_provider_call(
                "geoapify",
                "places",
                status_code=res.status_code,
                duration_ms=round((asyncio.get_running_loop().time() - t0) * 1000),
                source_action="nearby_places_pack",
                premium_fields=False,
                source_tier="hosted_lightweight",
                key=f"{len(provider_categories)}cats:{lat:.3f}:{lng:.3f}:{normalized_radius_m}",
            )
            if res.status_code in {401, 403, 429}:
                log.warning("Geoapify Places returned %s for pack=%s: %s", res.status_code, requested[:8], res.text[:240])
                _remember_block(res.status_code, res.text)
                return []
            res.raise_for_status()
            payload = res.json()
    except Exception as exc:
        log.warning("Geoapify Places failed for pack=%s: %s", requested[:8], exc)
        return []
    places: list[dict] = []
    fallback_category = requested[0] if requested else "poi"
    requested_set = set(requested)
    for feature in payload.get("features") or []:
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        inferred = _category_from_feature(props, fallback_category)
        if inferred not in requested_set and inferred not in {"park"}:
            inferred = fallback_category
        normalized = _normalize_feature(feature, inferred)
        if normalized:
            places.append(normalized)
    return places


async def get_geoapify_places(
    lat: float,
    lng: float,
    radius_m: int = 40000,
    categories: Iterable[str] | None = None,
    limit_per_category: int = 20,
) -> list[dict]:
    requested = sorted(
        {str(c) for c in (categories or []) if str(c) in GEOAPIFY_CATEGORY_MAP},
        key=lambda c: (GEOAPIFY_CATEGORY_PRIORITY.get(c, 50), c),
    )
    if not requested or not geoapify_passive_places_enabled():
        return []

    category_key = ",".join(requested)
    cache_lat = _cache_coord(lat)
    cache_lng = _cache_coord(lng)
    cache_radius = _cache_radius(radius_m)
    limit = max(40, min(int(limit_per_category or 20) * max(1, min(len(requested), 6)), 120))
    cache_key = f"geoapify_places:v2:{cache_lat:.2f}:{cache_lng:.2f}:{cache_radius}:{category_key}:{limit}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=GEOAPIFY_PLACES_TTL_SECONDS)
    if cached is not None:
        record_provider_call(
            "geoapify",
            "places",
            cache_status="hit",
            source_action="nearby_places_pack",
            source_tier="hosted_lightweight",
            key=cache_key,
        )
        return cached

    async def fetch_pack() -> list[dict]:
        return await _search_category_pack(cache_lat, cache_lng, cache_radius, requested[:12], limit)

    result = await runtime_cached_call(
        cache_key,
        60 * 60,
        fetch_pack,
        provider="geoapify",
        endpoint="places",
        source_action="nearby_places_pack",
        source_tier="hosted_lightweight",
        cache_empty=False,
    )
    if result:
        set_cached("campsite_cache", cache_key, result)
    return result
