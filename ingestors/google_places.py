"""Server-only Google Places enrichment for rich place cards."""
from __future__ import annotations

import logging
import os
import asyncio
from typing import Iterable
from urllib.parse import quote

import httpx

GOOGLE_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
GOOGLE_DETAIL_URL = "https://places.googleapis.com/v1/places"
log = logging.getLogger(__name__)

GOOGLE_TYPE_MAP: dict[str, list[str]] = {
    "camp": ["campground", "rv_park"],
    "camps": ["campground", "rv_park"],
    "rv_park": ["rv_park"],
    "fuel": ["gas_station"],
    "propane": ["gas_station"],
    "food": ["restaurant", "cafe"],
    "grocery": ["grocery_store", "supermarket", "convenience_store"],
    "lodging": ["lodging"],
    "mechanic": ["car_repair"],
    "parts": ["auto_parts_store"],
    "parking": ["parking"],
    "attraction": ["tourist_attraction"],
    "hardware": ["hardware_store"],
    "camping": ["sporting_goods_store"],
    "medical": ["pharmacy", "hospital"],
    "laundromat": ["laundry"],
    "wifi": ["cafe", "library"],
    "trailhead": ["hiking_area"],
    "viewpoint": ["tourist_attraction"],
    "park": ["national_park", "park"],
    "historic": ["historical_landmark", "tourist_attraction"],
    "hot_spring": ["tourist_attraction"],
}

GOOGLE_CATEGORY_PRIORITY = {
    "trailhead": 0,
    "viewpoint": 1,
    "park": 2,
    "historic": 3,
    "hot_spring": 4,
    "attraction": 5,
    "camp": 6,
    "camps": 6,
    "rv_park": 7,
    "grocery": 8,
    "mechanic": 9,
    "food": 10,
    "camping": 11,
    "parking": 14,
    "water": 15,
    "fuel": 18,
    "propane": 19,
}

SUMMARY_FIELDS = ",".join([
    "places.id",
    "places.displayName",
    "places.location",
    "places.formattedAddress",
    "places.primaryTypeDisplayName",
    "places.types",
    "places.rating",
    "places.userRatingCount",
    "places.currentOpeningHours.openNow",
    "places.photos.name",
    "places.googleMapsUri",
    "places.websiteUri",
    "places.nationalPhoneNumber",
])

DETAIL_FIELDS = ",".join([
    "id",
    "displayName",
    "location",
    "formattedAddress",
    "primaryTypeDisplayName",
    "types",
    "rating",
    "userRatingCount",
    "currentOpeningHours.openNow",
    "currentOpeningHours.weekdayDescriptions",
    "regularOpeningHours.weekdayDescriptions",
    "photos.name",
    "photos.authorAttributions",
    "reviews.authorAttribution",
    "reviews.rating",
    "reviews.relativePublishTimeDescription",
    "reviews.text",
    "reviews.originalText",
    "googleMapsUri",
    "websiteUri",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
])


def google_places_enabled() -> bool:
    return bool(os.getenv("GOOGLE_PLACES_API_KEY", "").strip())


def _headers(fields: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": os.getenv("GOOGLE_PLACES_API_KEY", "").strip(),
        "X-Goog-FieldMask": fields,
    }


def _photo_url(photo_name: str | None, max_width: int = 900) -> str:
    if not photo_name:
        return ""
    return f"/api/places/google/photo?name={quote(photo_name, safe='')}&max_width={max_width}"


def _category_for_types(types: list[str], requested: str) -> str:
    type_set = set(types or [])
    if {"campground", "rv_park"} & type_set:
        return "camp"
    if "gas_station" in type_set:
        return "fuel"
    if {"grocery_store", "supermarket", "convenience_store"} & type_set:
        return "grocery"
    if "car_repair" in type_set:
        return "mechanic"
    if "pharmacy" in type_set or "hospital" in type_set:
        return "medical"
    if "laundry" in type_set:
        return "laundromat"
    if "lodging" in type_set:
        return "lodging"
    if "parking" in type_set:
        return "parking"
    if "hardware_store" in type_set:
        return "hardware"
    if "hiking_area" in type_set:
        return "trailhead"
    if "park" in type_set and requested in {"park", "hot_spring"}:
        return requested
    if {"restaurant", "cafe"} & type_set:
        return "food"
    return requested


def _normalize_place(place: dict, requested_category: str) -> dict | None:
    loc = place.get("location") or {}
    lat, lng = loc.get("latitude"), loc.get("longitude")
    name = str((place.get("displayName") or {}).get("text") or "").strip()
    place_id = str(place.get("id") or "").strip()
    if not name or not place_id or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    types = [str(t) for t in (place.get("types") or [])]
    photos = place.get("photos") or []
    photo_name = photos[0].get("name") if photos and isinstance(photos[0], dict) else ""
    category = _category_for_types(types, requested_category)
    type_label = str(((place.get("primaryTypeDisplayName") or {}).get("text")) or category.replace("_", " ").title())
    hours = place.get("currentOpeningHours") or {}
    return {
        "id": f"google:{place_id}",
        "provider_place_id": place_id,
        "place_id": place_id,
        "name": name,
        "lat": float(lat),
        "lng": float(lng),
        "type": category,
        "category": category,
        "source": "google",
        "source_label": "Google Places",
        "subtype": type_label,
        "address": place.get("formattedAddress") or "",
        "phone": place.get("nationalPhoneNumber") or "",
        "website": place.get("websiteUri") or "",
        "open_now": hours.get("openNow"),
        "rating": place.get("rating"),
        "rating_count": place.get("userRatingCount"),
        "photo_url": _photo_url(photo_name, 720),
        "google_maps_uri": place.get("googleMapsUri") or "",
        "attribution": "Google",
    }


async def get_google_places(
    lat: float,
    lng: float,
    radius_m: int = 40000,
    categories: Iterable[str] | None = None,
    limit_per_category: int = 10,
) -> list[dict]:
    if not google_places_enabled():
        return []
    requested = sorted(
        {c for c in (categories or []) if c in GOOGLE_TYPE_MAP},
        key=lambda c: (GOOGLE_CATEGORY_PRIORITY.get(c, 50), c),
    )
    if not requested:
        return []
    radius_m = max(1000, min(int(radius_m), 50000))
    merged: list[dict] = []
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=8) as client:
        async def fetch_category(category: str) -> list[dict]:
            body = {
                "includedTypes": GOOGLE_TYPE_MAP[category][:2],
                "maxResultCount": max(1, min(limit_per_category, 12)),
                "rankPreference": "DISTANCE",
                "locationRestriction": {
                    "circle": {
                        "center": {"latitude": lat, "longitude": lng},
                        "radius": radius_m,
                    }
                },
            }
            try:
                res = await client.post(GOOGLE_NEARBY_URL, json=body, headers=_headers(SUMMARY_FIELDS))
                if res.status_code in {400, 401, 403, 429}:
                    log.warning("Google Places nearby returned %s for category=%s: %s", res.status_code, category, res.text[:240])
                    return []
                res.raise_for_status()
                body_json = res.json()
            except Exception as exc:
                log.warning("Google Places nearby failed for category=%s: %s", category, exc)
                return []
            places = []
            for item in body_json.get("places") or []:
                normalized = _normalize_place(item, category)
                if normalized:
                    places.append(normalized)
            return places

        # Broad app discovery asks for many categories. Keep Google in the mix
        # across services so photo-capable results are not crowded out by
        # fallback providers that do not expose media through our detail path.
        batches = await asyncio.gather(*(fetch_category(category) for category in requested[:14]), return_exceptions=True)
        for batch in batches:
            if not isinstance(batch, list):
                continue
            for normalized in batch:
                key = normalized["id"]
                if key not in seen:
                    seen.add(key)
                    merged.append(normalized)
    return merged


async def get_google_place_detail(place_id: str) -> dict | None:
    if not google_places_enabled() or not place_id:
        return None
    clean_id = place_id.replace("google:", "").strip()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(f"{GOOGLE_DETAIL_URL}/{quote(clean_id, safe='')}", headers=_headers(DETAIL_FIELDS))
            if res.status_code in {400, 401, 403, 404, 429}:
                log.warning("Google Places detail returned %s for %s: %s", res.status_code, clean_id, res.text[:240])
                return None
            res.raise_for_status()
            place = res.json()
    except Exception as exc:
        log.warning("Google Places detail failed for %s: %s", clean_id, exc)
        return None
    summary = _normalize_place(place, "poi")
    if not summary:
        return None
    photos = []
    for photo in (place.get("photos") or [])[:8]:
        if not isinstance(photo, dict) or not photo.get("name"):
            continue
        credits = []
        for attr in photo.get("authorAttributions") or []:
            if isinstance(attr, dict):
                label = attr.get("displayName") or attr.get("uri")
                if label:
                    credits.append(str(label))
        photos.append({
            "url": _photo_url(photo.get("name"), 1000),
            "credit": ", ".join(credits),
            "source": "Google",
        })
    hours = place.get("currentOpeningHours") or place.get("regularOpeningHours") or {}
    reviews = []
    for review in (place.get("reviews") or [])[:5]:
        if not isinstance(review, dict):
            continue
        author = review.get("authorAttribution") or {}
        text_obj = review.get("text") or review.get("originalText") or {}
        text = text_obj.get("text") if isinstance(text_obj, dict) else ""
        reviews.append({
            "authorName": author.get("displayName") or "Google user",
            "rating": review.get("rating"),
            "relativeTime": review.get("relativePublishTimeDescription") or "",
            "text": text or "",
            "profileUrl": author.get("uri") or "",
            "photoUrl": author.get("photoUri") or "",
            "source": "Google",
        })
    return {
        **summary,
        "photos": photos,
        "reviews": reviews,
        "hours": hours.get("weekdayDescriptions") or [],
        "international_phone": place.get("internationalPhoneNumber") or "",
        "source_footer": "Place information from Google. Verify hours and availability before relying on them.",
    }


async def fetch_google_photo(photo_name: str, max_width: int = 900) -> tuple[bytes, str] | None:
    if not google_places_enabled() or not photo_name:
        return None
    max_width = max(120, min(int(max_width), 1600))
    url = f"https://places.googleapis.com/v1/{photo_name}/media"
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            res = await client.get(url, params={"maxWidthPx": max_width, "key": os.getenv("GOOGLE_PLACES_API_KEY", "").strip()})
            if res.status_code in {400, 401, 403, 404, 429}:
                log.warning("Google Places photo returned %s for %s", res.status_code, photo_name)
                return None
            res.raise_for_status()
            return res.content, res.headers.get("content-type", "image/jpeg")
    except Exception as exc:
        log.warning("Google Places photo failed for %s: %s", photo_name, exc)
        return None
