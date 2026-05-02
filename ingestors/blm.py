"""BLM recreation site ingestor.

Uses public Bureau of Land Management ArcGIS FeatureServer layers. This is
government data intended for offline recreation apps, so it can legally enrich
Trailhead's camp and POI discovery without scraping competitor apps.
"""
from __future__ import annotations

import math
from typing import Any

import httpx

from db.store import get_cached, set_cached


BLM_RECREATION = "https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recreation_Offline/FeatureServer"

# Layer 1 is camping/cabins. Layer 2 is broader recreation sites and catches
# trailheads/access points that are often useful around overland routes.
_CAMP_LAYERS = (1,)


def _center(geometry: dict[str, Any]) -> tuple[float, float] | None:
    if not geometry:
        return None
    if geometry.get("x") is not None and geometry.get("y") is not None:
        return float(geometry["y"]), float(geometry["x"])
    rings = geometry.get("rings") or []
    pts = [pt for ring in rings for pt in ring if len(pt) >= 2]
    if pts:
        return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)
    paths = geometry.get("paths") or []
    pts = [pt for path in paths for pt in path if len(pt) >= 2]
    if pts:
        return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)
    return None


def _field(attrs: dict[str, Any], *names: str) -> str:
    lower = {str(k).lower(): v for k, v in attrs.items()}
    for name in names:
        value = lower.get(name.lower())
        if value not in (None, ""):
            return str(value)
    return ""


def _clean(value: str, limit: int = 300) -> str:
    return " ".join((value or "").split())[:limit]


def _tags(attrs: dict[str, Any]) -> list[str]:
    combo = " ".join(str(v).lower() for v in attrs.values() if v)
    tags = {"blm", "tent"}
    if any(k in combo for k in ["rv", "trailer", "vehicle", "drive-in", "car camping"]):
        tags.add("rv")
    if any(k in combo for k in ["primitive", "dispersed", "undeveloped"]):
        tags.add("dispersed")
    if any(k in combo for k in ["group"]):
        tags.add("group")
    if any(k in combo for k in ["equestrian", "horse"]):
        tags.add("equestrian")
    if any(k in combo for k in ["fee", "reservation", "reservable"]):
        tags.add("fee")
    if any(k in combo for k in ["accessible", "ada", "wheelchair"]):
        tags.add("ada")
    return sorted(tags)


def _amenities(attrs: dict[str, Any]) -> list[str]:
    combo = " ".join(str(v).lower() for v in attrs.values() if v)
    checks = [
        ("toilet", "Restrooms"),
        ("vault", "Vault toilets"),
        ("water", "Water"),
        ("potable", "Potable water"),
        ("picnic", "Picnic tables"),
        ("fire", "Fire rings"),
        ("trash", "Trash"),
        ("dump", "Dump station"),
        ("boat", "Boat ramp"),
        ("trail", "Trails"),
        ("parking", "Parking"),
    ]
    return [label for needle, label in checks if needle in combo][:14]


def _site_types(attrs: dict[str, Any]) -> list[str]:
    combo = " ".join(str(v).lower() for v in attrs.values() if v)
    types: list[str] = []
    if "campground" in combo or "camping" in combo:
        types.append("Campground")
    if "cabin" in combo:
        types.append("Cabin")
    if "primitive" in combo or "dispersed" in combo:
        types.append("Primitive")
    if "rv" in combo:
        types.append("RV")
    if "group" in combo:
        types.append("Group")
    return types or ["BLM recreation site"]


def _normalize(feature: dict[str, Any], layer: int) -> dict | None:
    coord = _center(feature.get("geometry") or {})
    if not coord:
        return None
    lat, lng = coord
    attrs = feature.get("attributes") or {}
    object_id = _field(attrs, "OBJECTID", "ObjectID", "FID") or f"{layer}_{round(lat, 5)}_{round(lng, 5)}"
    name = _field(attrs, "RECAREANAME", "SITE_NAME", "SITE_NM", "NAME", "FACILITYNAME", "RECSITENAME")
    if not name:
        name = "BLM Recreation Site"
    desc = _field(attrs, "DESCRIPTION", "DESCRIPTIO", "SITE_DESC", "COMMENTS", "DIRECTIONS", "RECAREADESCRIPTION")
    url = _field(attrs, "URL", "WEBSITE", "WEBLINK", "LINK")
    tags = _tags(attrs)
    return {
        "id": f"blm_{layer}_{object_id}",
        "name": _clean(name, 140),
        "lat": lat,
        "lng": lng,
        "tags": tags,
        "land_type": "BLM Land",
        "description": _clean(desc, 450),
        "photo_url": None,
        "reservable": "reservation" in " ".join(str(v).lower() for v in attrs.values() if v),
        "cost": "See BLM site" if "fee" in tags else "Check local rules",
        "url": url or "https://www.blm.gov/programs/recreation",
        "ada": "ada" in tags,
        "source": "blm",
        "verified_source": "BLM Recreation",
        "_attributes": attrs,
        "_layer": layer,
    }


async def _query_layer(layer: int, lat: float, lng: float, radius_m: int) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                f"{BLM_RECREATION}/{layer}/query",
                params={
                    "f": "json",
                    "where": "1=1",
                    "outFields": "*",
                    "returnGeometry": "true",
                    "outSR": "4326",
                    "geometry": f"{lng},{lat}",
                    "geometryType": "esriGeometryPoint",
                    "inSR": "4326",
                    "spatialRel": "esriSpatialRelIntersects",
                    "distance": radius_m,
                    "units": "esriSRUnit_Meter",
                    "resultRecordCount": 200,
                },
            )
            r.raise_for_status()
            return r.json().get("features", [])
    except Exception:
        return []


async def get_blm_campsites(lat: float, lng: float, radius_miles: float = 50) -> list[dict]:
    radius_m = int(min(max(radius_miles, 1), 120) * 1609.34)
    key = f"blm_camps_{lat:.2f}_{lng:.2f}_{radius_m}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 24 * 7)
    if cached is not None:
        return cached

    merged: list[dict] = []
    seen: set[str] = set()
    for layer in _CAMP_LAYERS:
        for feature in await _query_layer(layer, lat, lng, radius_m):
            site = _normalize(feature, layer)
            if not site or site["id"] in seen:
                continue
            seen.add(site["id"])
            site.pop("_attributes", None)
            site.pop("_layer", None)
            merged.append(site)
    merged.sort(key=lambda s: math.hypot((s["lat"] - lat) * 69, (s["lng"] - lng) * 54.6))
    set_cached("campsite_cache", key, merged)
    return merged


async def get_blm_campsite_detail(camp_id: str) -> dict | None:
    parts = camp_id.split("_", 2)
    if len(parts) < 3:
        return None
    try:
        layer = int(parts[1])
    except ValueError:
        return None
    object_id = parts[2]
    cache_key = f"blm_detail_{layer}_{object_id}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24 * 7)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                f"{BLM_RECREATION}/{layer}/query",
                params={
                    "f": "json",
                    "where": f"OBJECTID={object_id}",
                    "outFields": "*",
                    "returnGeometry": "true",
                    "outSR": "4326",
                    "resultRecordCount": 1,
                },
            )
            r.raise_for_status()
            features = r.json().get("features", [])
    except Exception:
        features = []
    if features:
        site = _normalize(features[0], layer)
        if site:
            attrs = site.pop("_attributes", features[0].get("attributes") or {})
            site.pop("_layer", None)
            detail = {
                **site,
                "photos": [],
                "amenities": _amenities(attrs),
                "site_types": _site_types(attrs),
                "activities": [x for x in [
                    "Camping",
                    "OHV" if "ohv" in " ".join(str(v).lower() for v in attrs.values() if v) else "",
                    "Hiking" if "trail" in " ".join(str(v).lower() for v in attrs.values() if v) else "",
                    "Boating" if "boat" in " ".join(str(v).lower() for v in attrs.values() if v) else "",
                ] if x],
                "phone": _field(attrs, "PHONE", "CONTACT_PHONE", "TEL"),
                "campsites_count": 0,
            }
            set_cached("campsite_cache", cache_key, detail)
            return detail
    return {
        "id": camp_id,
        "name": "BLM Recreation Site",
        "lat": 0,
        "lng": 0,
        "tags": ["blm", "tent"],
        "land_type": "BLM Land",
        "description": "Official BLM recreation record. Details may vary by field office; verify current access, fire restrictions, and stay limits before travel.",
        "photos": [],
        "photo_url": None,
        "amenities": [],
        "site_types": ["BLM recreation site"],
        "activities": ["Camping", "Public lands"],
        "reservable": False,
        "cost": "Check local rules",
        "ada": False,
        "phone": None,
        "url": f"{BLM_RECREATION}/{layer}/query?where=OBJECTID%3D{object_id}&outFields=*&f=html",
        "campsites_count": 0,
        "source": "blm",
        "verified_source": "BLM Recreation",
    }
