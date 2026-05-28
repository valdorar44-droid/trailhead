"""Server-only Google Places enrichment for rich place cards."""
from __future__ import annotations

import logging
import os
import asyncio
from typing import Iterable
from urllib.parse import quote

import httpx
from db.store import get_cached, set_cached
from ingestors.provider_guard import provider_budget_available, record_provider_call, runtime_cached_call

GOOGLE_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
GOOGLE_TEXT_URL = "https://places.googleapis.com/v1/places:searchText"
GOOGLE_DETAIL_URL = "https://places.googleapis.com/v1/places"
GOOGLE_PERMISSION_BACKOFF_KEY = "google_places_permission_backoff_v1"
GOOGLE_NEARBY_QUOTA_BACKOFF_KEY = "google_places_nearby_quota_backoff_v1"
GOOGLE_TEXT_ERROR_TTL_SECONDS = 15 * 60
GOOGLE_TEXT_EMPTY_TTL_SECONDS = 12 * 3600
GOOGLE_QUOTA_BACKOFF_TTL_SECONDS = 5 * 60
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
    "dump": ["rv_park"],
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
    "peak": ["tourist_attraction", "park"],
    "climbing": ["tourist_attraction"],
    "ohv": ["tourist_attraction"],
}

GOOGLE_RICH_SUMMARY_CATEGORIES = {
    "camp", "camps", "trailhead", "viewpoint", "peak", "hot_spring", "park",
    "historic", "attraction", "climbing", "ohv",
}
GOOGLE_LIGHTWEIGHT_CATEGORIES = {
    "fuel", "propane", "dump", "parking", "grocery", "food", "mechanic",
    "parts", "hardware", "medical", "laundromat", "wifi", "lodging", "camping",
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

RICH_SUMMARY_FIELDS = ",".join([
    "places.id",
    "places.displayName",
    "places.location",
    "places.formattedAddress",
    "places.primaryTypeDisplayName",
    "places.types",
    "places.currentOpeningHours.openNow",
    "places.googleMapsUri",
    "places.websiteUri",
    "places.nationalPhoneNumber",
])

LIGHTWEIGHT_SUMMARY_FIELDS = ",".join([
    "places.id",
    "places.displayName",
    "places.location",
    "places.formattedAddress",
    "places.primaryTypeDisplayName",
    "places.types",
    "places.currentOpeningHours.openNow",
    "places.googleMapsUri",
    "places.websiteUri",
    "places.nationalPhoneNumber",
])

SUMMARY_FIELDS = RICH_SUMMARY_FIELDS

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
    "googleMapsUri",
    "websiteUri",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
])


def google_places_enabled() -> bool:
    return bool(os.getenv("GOOGLE_PLACES_API_KEY", "").strip())


def google_passive_places_enabled() -> bool:
    return (
        google_places_enabled()
        and os.getenv("GOOGLE_PASSIVE_PLACES_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}
    )


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


def _google_permission_blocked() -> bool:
    return get_cached("campsite_cache", GOOGLE_PERMISSION_BACKOFF_KEY, ttl_seconds=GOOGLE_TEXT_ERROR_TTL_SECONDS) is not None


def _google_nearby_quota_blocked() -> bool:
    return get_cached("campsite_cache", GOOGLE_NEARBY_QUOTA_BACKOFF_KEY, ttl_seconds=GOOGLE_QUOTA_BACKOFF_TTL_SECONDS) is not None


def _remember_google_block(status_code: int, text: str, scope: str) -> None:
    payload = {"status_code": status_code, "scope": scope, "message": text[:240], "empty": True}
    if status_code in {401, 403}:
        set_cached("campsite_cache", GOOGLE_PERMISSION_BACKOFF_KEY, payload)
    elif status_code == 429:
        set_cached("campsite_cache", GOOGLE_NEARBY_QUOTA_BACKOFF_KEY, payload)


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
    if requested == "peak" and ({"natural_feature", "tourist_attraction", "park", "hiking_area"} & type_set):
        return "peak"
    if {"restaurant", "cafe"} & type_set:
        return "food"
    return requested


def is_lightweight_google_category(category: object) -> bool:
    return _clean_category(category) in GOOGLE_LIGHTWEIGHT_CATEGORIES


def _clean_category(category: object) -> str:
    return str(category or "").strip().lower().replace(" ", "_")


def _summary_fields_for_category(category: str) -> str:
    return LIGHTWEIGHT_SUMMARY_FIELDS if is_lightweight_google_category(category) else RICH_SUMMARY_FIELDS


def mark_google_rich_detail_gate(item: dict) -> dict:
    if str(item.get("source") or "").lower() == "google":
        item["rich_detail_available"] = True
        item["rich_detail_locked"] = True
        item["rich_detail_reason"] = "paid_provider_detail"
    return item


def strip_lightweight_google_rich_fields(item: dict) -> dict:
    """Keep practical Google list fields for town services without rich media/review data."""
    if str(item.get("source") or "").lower() != "google":
        return item
    for key in ("photo_url", "photos", "reviews", "rating", "rating_count"):
        item.pop(key, None)
    return mark_google_rich_detail_gate(item)


def _normalize_place(place: dict, requested_category: str) -> dict | None:
    loc = place.get("location") or {}
    lat, lng = loc.get("latitude"), loc.get("longitude")
    name = str((place.get("displayName") or {}).get("text") or "").strip()
    place_id = str(place.get("id") or "").strip()
    if not name or not place_id or not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    types = [str(t) for t in (place.get("types") or [])]
    category = _category_for_types(types, requested_category)
    type_label = str(((place.get("primaryTypeDisplayName") or {}).get("text")) or category.replace("_", " ").title())
    hours = place.get("currentOpeningHours") or {}
    normalized = {
        "id": f"google:{place_id}",
        "provider_place_id": place_id,
        "place_id": place_id,
        "name": name,
        "lat": float(lat),
        "lng": float(lng),
        "type": category,
        "category": category,
        "source": "google",
        "source_tier": "paid_gated",
        "source_label": "Google Places",
        "subtype": type_label,
        "address": place.get("formattedAddress") or "",
        "phone": place.get("nationalPhoneNumber") or "",
        "website": place.get("websiteUri") or "",
        "open_now": hours.get("openNow"),
        "google_maps_uri": place.get("googleMapsUri") or "",
        "attribution": "Google",
        "rich_detail_available": True,
        "rich_detail_locked": False,
    }
    return strip_lightweight_google_rich_fields(normalized)


async def get_google_places(
    lat: float,
    lng: float,
    radius_m: int = 40000,
    categories: Iterable[str] | None = None,
    limit_per_category: int = 10,
) -> list[dict]:
    if not google_passive_places_enabled():
        return []

    async def fetch_nearby_pack() -> list[dict]:
        if not provider_budget_available("google", "nearby"):
            return []
        if _google_permission_blocked() or _google_nearby_quota_blocked():
            return []
        requested = sorted(
            {c for c in (categories or []) if c in GOOGLE_TYPE_MAP},
            key=lambda c: (GOOGLE_CATEGORY_PRIORITY.get(c, 50), c),
        )
        if not requested:
            return []
        normalized_radius_m = max(1000, min(int(radius_m), 50000))
        merged: list[dict] = []
        seen: set[str] = set()
        async with httpx.AsyncClient(timeout=8) as client:
            async def fetch_category(category: str) -> list[dict]:
                if not provider_budget_available("google", "nearby"):
                    return []
                body = {
                    "includedTypes": GOOGLE_TYPE_MAP[category][:2],
                    "maxResultCount": max(1, min(limit_per_category, 12)),
                    "rankPreference": "DISTANCE",
                    "locationRestriction": {
                        "circle": {
                            "center": {"latitude": lat, "longitude": lng},
                            "radius": normalized_radius_m,
                        }
                    },
                }
                try:
                    t0 = asyncio.get_running_loop().time()
                    res = await client.post(GOOGLE_NEARBY_URL, json=body, headers=_headers(_summary_fields_for_category(category)))
                    record_provider_call(
                        "google",
                        "nearby",
                        status_code=res.status_code,
                        duration_ms=round((asyncio.get_running_loop().time() - t0) * 1000),
                        source_action="nearby_places",
                        premium_fields=False,
                        source_tier="paid_gated",
                        key=f"{category}:{lat:.3f}:{lng:.3f}:{normalized_radius_m}",
                    )
                    if res.status_code in {400, 401, 403, 429}:
                        log.warning("Google Places nearby returned %s for category=%s: %s", res.status_code, category, res.text[:240])
                        _remember_google_block(res.status_code, res.text, "nearby")
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

            # Broad app discovery asks for many categories. Keep Google in the
            # mix, but runtime-cache/coalesce the whole pack by center/radius.
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

    category_key = ",".join(sorted({c for c in (categories or []) if c in GOOGLE_TYPE_MAP}))
    cache_key = f"google_nearby:{lat:.3f}:{lng:.3f}:{max(1000, min(int(radius_m), 50000))}:{category_key}:{limit_per_category}"
    return await runtime_cached_call(
        cache_key,
        20 * 60,
        fetch_nearby_pack,
        provider="google",
        endpoint="nearby",
        source_action="nearby_places",
        source_tier="paid_gated",
        cache_empty=False,
    )


async def search_google_places_text(
    query: str,
    lat: float | None = None,
    lng: float | None = None,
    radius_m: int = 50000,
    limit: int = 5,
) -> list[dict]:
    """Search Google Places by free-form text for rich selected-search cards."""
    if not google_places_enabled() or not query.strip():
        return []
    if _google_permission_blocked():
        return []
    normalized_query = " ".join(query.strip().lower().split())
    cache_suffix = f"{normalized_query}:{float(lat or 0):.3f}:{float(lng or 0):.3f}"
    empty_key = f"google_text_empty_v1:{cache_suffix}"
    error_key = f"google_text_error_v1:{cache_suffix}"
    if get_cached("campsite_cache", empty_key, ttl_seconds=GOOGLE_TEXT_EMPTY_TTL_SECONDS) is not None:
        return []
    if get_cached("campsite_cache", error_key, ttl_seconds=GOOGLE_TEXT_ERROR_TTL_SECONDS) is not None:
        return []
    async def fetch_text() -> dict | None:
        body: dict = {
            "textQuery": query.strip(),
            "maxResultCount": max(1, min(int(limit or 5), 10)),
        }
        if lat is not None and lng is not None:
            body["locationBias"] = {
                "circle": {
                    "center": {"latitude": float(lat), "longitude": float(lng)},
                    "radius": max(1000, min(int(radius_m), 50000)),
                }
            }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                t0 = asyncio.get_running_loop().time()
                res = await client.post(GOOGLE_TEXT_URL, json=body, headers=_headers(SUMMARY_FIELDS))
                record_provider_call(
                    "google",
                    "text_search",
                    status_code=res.status_code,
                    duration_ms=round((asyncio.get_running_loop().time() - t0) * 1000),
                    source_action="submit_search",
                    premium_fields=False,
                    source_tier="paid_gated",
                    key=cache_suffix,
                )
                if res.status_code in {400, 401, 403, 429}:
                    log.warning("Google Places text search returned %s for %r: %s", res.status_code, query, res.text[:240])
                    set_cached("campsite_cache", error_key, {"status_code": res.status_code, "empty": True})
                    _remember_google_block(res.status_code, res.text, "text")
                    return None
                res.raise_for_status()
                return res.json()
        except Exception as exc:
            log.warning("Google Places text search failed for %r: %s", query, exc)
            set_cached("campsite_cache", error_key, {"error": str(exc)[:120], "empty": True})
            return None

    payload = await runtime_cached_call(
        f"google_text:{cache_suffix}:{limit}",
        10 * 60,
        fetch_text,
        provider="google",
        endpoint="text_search",
        source_action="submit_search",
    )
    if not isinstance(payload, dict):
        return []
    places = []
    for item in payload.get("places") or []:
        normalized = _normalize_place(item, "poi")
        if normalized:
            places.append(normalized)
    if not places:
        set_cached("campsite_cache", empty_key, {"empty": True})
    return places


async def get_google_place_detail(place_id: str) -> dict | None:
    if not google_places_enabled() or not place_id:
        return None
    if _google_permission_blocked():
        return None
    if not provider_budget_available("google", "detail"):
        return None
    clean_id = place_id.replace("google:", "").strip()
    async def fetch_detail() -> dict | None:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                t0 = asyncio.get_running_loop().time()
                res = await client.get(f"{GOOGLE_DETAIL_URL}/{quote(clean_id, safe='')}", headers=_headers(DETAIL_FIELDS))
                record_provider_call(
                    "google",
                    "detail",
                    status_code=res.status_code,
                    duration_ms=round((asyncio.get_running_loop().time() - t0) * 1000),
                    source_action="place_detail",
                    premium_fields=True,
                    source_tier="paid_gated",
                    key=clean_id,
                )
                if res.status_code in {400, 401, 403, 404, 429}:
                    log.warning("Google Places detail returned %s for %s: %s", res.status_code, clean_id, res.text[:240])
                    _remember_google_block(res.status_code, res.text, "detail")
                    return None
                res.raise_for_status()
                return res.json()
        except Exception as exc:
            log.warning("Google Places detail failed for %s: %s", clean_id, exc)
            return None

    place = await runtime_cached_call(
        f"google_detail:{clean_id}",
        15 * 60,
        fetch_detail,
        provider="google",
        endpoint="detail",
        source_action="place_detail",
        premium_fields=True,
        source_tier="paid_gated",
    )
    if not isinstance(place, dict):
        return None
    summary = _normalize_place(place, "poi")
    if not summary:
        return None
    photos = []
    for photo in (place.get("photos") or [])[:1]:
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
    return {
        **summary,
        "rating": place.get("rating"),
        "rating_count": place.get("userRatingCount"),
        "photos": photos,
        "photo_url": photos[0]["url"] if photos else summary.get("photo_url", ""),
        "reviews": [],
        "hours": hours.get("weekdayDescriptions") or [],
        "international_phone": place.get("internationalPhoneNumber") or "",
        "source_footer": "Place information from Google. Verify hours and availability before relying on them.",
    }


async def fetch_google_photo(photo_name: str, max_width: int = 900) -> tuple[bytes, str] | None:
    if not google_places_enabled() or not photo_name:
        return None
    if _google_permission_blocked():
        return None
    if not provider_budget_available("google", "photo"):
        return None
    max_width = max(120, min(int(max_width), 1600))
    url = f"https://places.googleapis.com/v1/{photo_name}/media"
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            t0 = asyncio.get_running_loop().time()
            res = await client.get(url, params={"maxWidthPx": max_width, "key": os.getenv("GOOGLE_PLACES_API_KEY", "").strip()})
            record_provider_call(
                "google",
                "photo",
                status_code=res.status_code,
                duration_ms=round((asyncio.get_running_loop().time() - t0) * 1000),
                source_action="photo_proxy",
                premium_fields=True,
                source_tier="paid_gated",
                key=photo_name,
            )
            if res.status_code in {400, 401, 403, 404, 429}:
                log.warning("Google Places photo returned %s for %s", res.status_code, photo_name)
                _remember_google_block(res.status_code, f"photo {photo_name}", "photo")
                return None
            res.raise_for_status()
            return res.content, res.headers.get("content-type", "image/jpeg")
    except Exception as exc:
        log.warning("Google Places photo failed for %s: %s", photo_name, exc)
        return None
