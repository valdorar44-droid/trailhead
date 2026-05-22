"""Optional Foursquare Places enrichment for nearby/category search.

This module is server-only: the API key stays on Railway and mobile clients use
Trailhead's `/api/places/nearby` endpoint. Full Foursquare place attributes are
not persisted because pay-as-you-go/sandbox Places API usage does not permit
server-side attribute caching.
"""
from __future__ import annotations

import os
import logging
import asyncio
from typing import Iterable

import httpx

FSQ_SEARCH_URL = "https://places-api.foursquare.com/places/search"
log = logging.getLogger(__name__)

FSQ_CATEGORY_QUERIES: dict[str, str] = {
    "camp": "campground",
    "camps": "campground",
    "rv_park": "rv park",
    "fuel": "gas station",
    "propane": "propane",
    "food": "restaurant",
    "grocery": "grocery",
    "lodging": "hotel",
    "mechanic": "auto repair",
    "parts": "auto parts",
    "attraction": "attraction",
    "hardware": "hardware store",
    "camping": "camping gear",
    "medical": "pharmacy",
    "laundromat": "laundromat",
    "wifi": "wifi",
}

FSQ_BUSINESS_CATEGORIES = frozenset(FSQ_CATEGORY_QUERIES)

FSQ_CATEGORY_PRIORITY = {
    "attraction": 0,
    "camp": 1,
    "camps": 1,
    "rv_park": 1,
    "grocery": 2,
    "mechanic": 3,
    "food": 4,
    "camping": 5,
    "parking": 8,
    "fuel": 12,
    "propane": 13,
}

def foursquare_enabled() -> bool:
    return bool(os.getenv("FOURSQUARE_API_KEY", "").strip())


def _coord(place: dict) -> tuple[float, float] | None:
    lat, lng = place.get("latitude"), place.get("longitude")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        return float(lat), float(lng)
    main = (place.get("geocodes") or {}).get("main") or {}
    lat, lng = main.get("latitude"), main.get("longitude")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        return float(lat), float(lng)
    return None


def _address(location: dict) -> str:
    formatted = str(location.get("formatted_address") or "").strip()
    if formatted:
        return formatted
    bits = [
        location.get("address"),
        location.get("locality"),
        location.get("region"),
    ]
    return ", ".join(str(v).strip() for v in bits if str(v or "").strip())


def _normalize_place(place: dict, category: str) -> dict | None:
    coord = _coord(place)
    name = str(place.get("name") or "").strip()
    if not coord or not name:
        return None
    closed_bucket = str(place.get("closed_bucket") or "").lower()
    if closed_bucket in {"very_likely_closed", "likely_closed"}:
        return None
    lat, lng = coord
    cats = place.get("categories") or []
    subtype = ""
    if cats and isinstance(cats[0], dict):
        subtype = str(cats[0].get("name") or "")
    normalized_category = "camp" if category in {"camp", "camps", "rv_park"} else category
    return {
        "id": f"fsq_{category}_{place.get('fsq_place_id') or place.get('fsq_id') or f'{lat:.5f}_{lng:.5f}'}",
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": normalized_category,
        "category": normalized_category,
        "source": "foursquare",
        "source_label": "Foursquare",
        "subtype": subtype,
        "address": _address(place.get("location") or {}),
        "distance_m": place.get("distance"),
        "website": place.get("website") or "",
        "phone": place.get("tel") or place.get("phone") or "",
        "open_now": (place.get("hours") or {}).get("open_now"),
        "fuel_types": "gas" if category == "fuel" else ("propane" if category == "propane" else ""),
        "elevation": "",
    }


async def _search_category(lat: float, lng: float, radius_m: int, category: str, limit: int) -> list[dict]:
    api_key = os.getenv("FOURSQUARE_API_KEY", "").strip()
    if not api_key:
        log.info("Foursquare Places disabled: FOURSQUARE_API_KEY is not set")
        return []

    params = {
        "ll": f"{lat:.6f},{lng:.6f}",
        "radius": str(max(1000, min(radius_m, 72000))),
        "query": FSQ_CATEGORY_QUERIES[category],
        "limit": str(max(1, min(limit, 30))),
        "sort": "DISTANCE",
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "X-Places-Api-Version": "2025-06-17",
    }

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(FSQ_SEARCH_URL, params=params, headers=headers)
            if res.status_code in {401, 403, 429}:
                log.warning("Foursquare Places returned %s for category=%s: %s", res.status_code, category, res.text[:240])
                return []
            res.raise_for_status()
            body = res.json()
    except Exception as exc:
        log.warning("Foursquare Places request failed for category=%s: %s", category, exc)
        return []

    places = []
    for item in body.get("results", []) or []:
        normalized = _normalize_place(item, category)
        if normalized:
            places.append(normalized)
    return places


async def get_foursquare_places(
    lat: float,
    lng: float,
    radius_m: int = 40000,
    categories: Iterable[str] | None = None,
    limit_per_category: int = 12,
) -> list[dict]:
    """Return cached Foursquare places for selected business-like categories."""
    requested = sorted(
        {c for c in (categories or []) if c in FSQ_BUSINESS_CATEGORIES},
        key=lambda c: (FSQ_CATEGORY_PRIORITY.get(c, 50), c),
    )
    if not requested or not foursquare_enabled():
        return []

    merged: list[dict] = []
    seen: set[str] = set()
    batches = await asyncio.gather(
        *(_search_category(lat, lng, radius_m, category, min(limit_per_category, 10)) for category in requested[:6]),
        return_exceptions=True,
    )
    for batch in batches:
        if not isinstance(batch, list):
            continue
        for place in batch:
            key = str(place.get("id") or "")
            if key and key not in seen:
                seen.add(key)
                merged.append(place)
    return merged
