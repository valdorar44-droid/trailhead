"""Optional Foursquare Places enrichment for nearby/category search.

This module is server-only: the API key stays on Railway and mobile clients use
Trailhead's `/api/places/nearby` endpoint. Full Foursquare place attributes are
kept live/fallback-safe because Places usage rules can limit server-side
attribute caching.
"""
from __future__ import annotations

import os
import logging
import asyncio
from typing import Iterable
from urllib.parse import quote

import httpx

FSQ_SEARCH_URL = "https://places-api.foursquare.com/places/search"
FSQ_DETAIL_URL = "https://places-api.foursquare.com/places/{fsq_id}"
FSQ_LEGACY_DETAIL_URL = "https://api.foursquare.com/v3/places/{fsq_id}"
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

FSQ_SUMMARY_FIELDS = ",".join([
    "fsq_id",
    "fsq_place_id",
    "name",
    "geocodes",
    "location",
    "categories",
    "distance",
    "link",
    "closed_bucket",
    "tel",
    "website",
    "hours",
    "rating",
    "stats",
    "photos",
    "tips",
    "description",
    "venue_reality_bucket",
])

FSQ_DETAIL_FIELDS = ",".join([
    FSQ_SUMMARY_FIELDS,
    "email",
    "social_media",
    "features",
    "popularity",
    "price",
    "tastes",
    "timezone",
])

_FSQ_CAMP_ALLOW = (
    "campground",
    "camp ground",
    "camp site",
    "campsite",
    "camping",
    "rv park",
    "recreational vehicle",
    "caravan",
)
_FSQ_CAMP_DENY = (
    "college",
    "university",
    "school",
    "campus",
    "summer camp",
    "boot camp",
    "training camp",
    "camp store",
    "campus building",
    "stadium",
    "athletic field",
    "fraternity",
    "sorority",
)

def foursquare_enabled() -> bool:
    return bool(os.getenv("FOURSQUARE_API_KEY", "").strip())


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.getenv('FOURSQUARE_API_KEY', '').strip()}",
        "Accept": "application/json",
        "X-Places-Api-Version": "2025-06-17",
    }


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


def _fsq_place_id(place: dict) -> str:
    return str(place.get("fsq_place_id") or place.get("fsq_id") or place.get("id") or "").strip()


def _category_names(place: dict) -> list[str]:
    names: list[str] = []
    for cat in place.get("categories") or []:
        if isinstance(cat, dict):
            label = str(cat.get("name") or "").strip()
            if label:
                names.append(label)
    return names


def _is_camp_result(place: dict, requested_category: str) -> bool:
    if requested_category not in {"camp", "camps", "rv_park"}:
        return True
    text = " ".join([
        str(place.get("name") or ""),
        str(place.get("description") or ""),
        " ".join(_category_names(place)),
    ]).lower()
    if any(term in text for term in _FSQ_CAMP_DENY):
        return False
    return any(term in text for term in _FSQ_CAMP_ALLOW)


def _fsq_photo_url(photo: dict, size: str = "original") -> str:
    prefix = str(photo.get("prefix") or "").strip()
    suffix = str(photo.get("suffix") or "").strip()
    if not prefix or not suffix:
        return ""
    return f"{prefix}{size}{suffix}"


def _normalize_photos(place: dict, limit: int = 8) -> list[dict]:
    photos: list[dict] = []
    for photo in (place.get("photos") or [])[:limit]:
        if not isinstance(photo, dict):
            continue
        url = _fsq_photo_url(photo, "1000x1000")
        if not url:
            continue
        tip = photo.get("tip") if isinstance(photo.get("tip"), dict) else {}
        photos.append({
            "url": url,
            "caption": str(tip.get("text") or "").strip(),
            "credit": "Foursquare user photo",
            "source": "Foursquare",
        })
    return photos


def _normalize_tips(place: dict, limit: int = 5) -> list[dict]:
    reviews: list[dict] = []
    for tip in (place.get("tips") or [])[:limit]:
        if not isinstance(tip, dict):
            continue
        text = str(tip.get("text") or "").strip()
        if not text:
            continue
        reviews.append({
            "authorName": "Foursquare tip",
            "relativeTime": str(tip.get("created_at") or "").strip(),
            "text": text,
            "profileUrl": str(tip.get("url") or "").strip(),
            "source": "Foursquare",
        })
    return reviews


def _normalize_place(place: dict, category: str) -> dict | None:
    coord = _coord(place)
    name = str(place.get("name") or "").strip()
    fsq_id = _fsq_place_id(place)
    if not coord or not name:
        return None
    if not _is_camp_result(place, category):
        return None
    closed_bucket = str(place.get("closed_bucket") or "").lower()
    if closed_bucket in {"very_likely_closed", "likely_closed"}:
        return None
    lat, lng = coord
    category_names = _category_names(place)
    subtype = category_names[0] if category_names else ""
    normalized_category = "camp" if category in {"camp", "camps", "rv_park"} else category
    photos = _normalize_photos(place, limit=3)
    stats = place.get("stats") if isinstance(place.get("stats"), dict) else {}
    rating = place.get("rating")
    try:
        rating = round(float(rating) / 2, 1) if rating is not None else None
    except Exception:
        rating = None
    return {
        "id": f"foursquare:{fsq_id or f'{category}_{lat:.5f}_{lng:.5f}'}",
        "provider_place_id": fsq_id,
        "place_id": fsq_id,
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
        "rating": rating,
        "rating_count": stats.get("total_ratings") or stats.get("total_tips"),
        "photo_url": photos[0]["url"] if photos else "",
        "photos": photos,
        "reviews": _normalize_tips(place, limit=3),
        "summary": str(place.get("description") or "").strip(),
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
        "fields": FSQ_SUMMARY_FIELDS,
    }

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(FSQ_SEARCH_URL, params=params, headers=_headers())
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


async def get_foursquare_place_detail(fsq_id: str) -> dict | None:
    """Return live Foursquare detail/photos/tips for a selected place.

    Search can return enough for a preview, but the full card should fetch a
    detail payload on demand so we do not have to persist rich Foursquare data.
    """
    clean_id = quote(str(fsq_id or "").replace("foursquare:", "").strip(), safe="")
    if not clean_id or not foursquare_enabled():
        return None

    params = {"fields": FSQ_DETAIL_FIELDS}
    body: dict | None = None
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(FSQ_DETAIL_URL.format(fsq_id=clean_id), params=params, headers=_headers())
            if res.status_code == 404:
                res = await client.get(FSQ_LEGACY_DETAIL_URL.format(fsq_id=clean_id), params=params, headers=_headers())
            if res.status_code in {400, 401, 403, 404, 429}:
                log.warning("Foursquare detail returned %s for %s: %s", res.status_code, clean_id, res.text[:240])
                return None
            res.raise_for_status()
            body = res.json()
    except Exception as exc:
        log.warning("Foursquare detail failed for %s: %s", clean_id, exc)
        return None
    if not isinstance(body, dict):
        return None

    normalized = _normalize_place(body, "poi")
    if not normalized:
        return None
    photos = _normalize_photos(body, limit=8)
    reviews = _normalize_tips(body, limit=5)
    hours = body.get("hours") if isinstance(body.get("hours"), dict) else {}
    display_hours = hours.get("display")
    if isinstance(display_hours, str):
        hours_list = [display_hours]
    elif isinstance(display_hours, list):
        hours_list = [str(v) for v in display_hours if str(v or "").strip()]
    else:
        hours_list = []
    return {
        **normalized,
        "photos": photos,
        "reviews": reviews,
        "hours": hours_list,
        "media_source": "foursquare" if photos else "",
        "source_footer": "Place information from Foursquare. Verify hours, access, and availability before relying on it.",
    }


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
