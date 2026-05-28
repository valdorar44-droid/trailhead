"""US Forest Service official recreation site ingestor."""
from __future__ import annotations

import math
from typing import Any

import httpx

from db.store import get_cached, set_cached


USFS_RECREATION_SITES = "https://apps.fs.usda.gov/fsgisx05/rest/services/wo_nfs_gtac/GTAC_IVMCartography_02/MapServer/1"


def _center(geometry: dict[str, Any], attrs: dict[str, Any]) -> tuple[float, float] | None:
    if geometry.get("x") is not None and geometry.get("y") is not None:
        return float(geometry["y"]), float(geometry["x"])
    lower = {str(k).lower(): v for k, v in attrs.items()}
    lat = lower.get("latitude") or lower.get("lat")
    lng = lower.get("longitude") or lower.get("lon") or lower.get("lng")
    try:
        if lat not in (None, "") and lng not in (None, ""):
            return float(lat), float(lng)
    except Exception:
        return None
    return None


def _field(attrs: dict[str, Any], *names: str) -> str:
    lower = {str(k).lower(): v for k, v in attrs.items()}
    for name in names:
        value = lower.get(name.lower())
        if value not in (None, ""):
            return str(value)
    return ""


def _clean(value: object, limit: int = 500) -> str:
    return " ".join(str(value or "").split())[:limit]


def _type(attrs: dict[str, Any]) -> str:
    combo = " ".join(str(v).lower() for v in attrs.values() if v)
    if any(k in combo for k in ("campground", "camping", "campsite", "cabin")):
        return "camp"
    if any(k in combo for k in ("trailhead", "trail head", "trail access")):
        return "trailhead"
    if "ohv" in combo or "off-highway" in combo:
        return "ohv"
    if "boat" in combo or "water access" in combo:
        return "water"
    if "picnic" in combo or "day use" in combo:
        return "picnic"
    if "visitor" in combo or "information" in combo:
        return "visitor_center"
    return "attraction"


def _amenities(attrs: dict[str, Any]) -> list[str]:
    combo = " ".join(str(v).lower() for v in attrs.values() if v)
    checks = [
        ("toilet", "Restrooms"),
        ("water", "Water"),
        ("picnic", "Picnic tables"),
        ("fire", "Fire rings"),
        ("parking", "Parking"),
        ("boat", "Boat ramp"),
        ("trail", "Trails"),
        ("accessible", "Accessible"),
    ]
    return [label for needle, label in checks if needle in combo][:12]


def _normalize(feature: dict[str, Any]) -> dict | None:
    attrs = feature.get("attributes") or {}
    coord = _center(feature.get("geometry") or {}, attrs)
    if not coord:
        return None
    lat, lng = coord
    object_id = _field(attrs, "OBJECTID", "GLOBALID", "ID") or f"{lat:.5f}_{lng:.5f}"
    name = _field(attrs, "RECAREA_NAME", "RECAREANAME", "SITE_NAME", "NAME", "FACILITYNAME", "RECSITENAME", "TITLE") or "USFS Recreation Site"
    desc = _field(attrs, "DESCRIPTION", "DESCRIPTIO", "COMMENTS", "RECAREADESCRIPTION", "SITE_DESC")
    url = _field(attrs, "URL", "WEBSITE", "WEBLINK", "LINK")
    ptype = _type(attrs)
    return {
        "id": f"usfs_{str(object_id).replace('{', '').replace('}', '')}",
        "source_place_id": str(object_id),
        "name": _clean(name, 160),
        "lat": lat,
        "lng": lng,
        "type": ptype,
        "category": ptype,
        "subtype": _field(attrs, "RECAREA_TYPE", "SITE_TYPE", "FACILITYTYPE", "TYPE") or "USFS recreation site",
        "summary": _clean(desc, 650),
        "description": _clean(desc, 1200),
        "land_type": "National Forest",
        "amenities": _amenities(attrs),
        "official_url": url or "https://www.fs.usda.gov/visit",
        "website": url or "https://www.fs.usda.gov/visit",
        "url": url or "https://www.fs.usda.gov/visit",
        "source": "usfs",
        "source_label": "US Forest Service",
        "verified_source": "US Forest Service",
        "source_badge": "Official USFS",
        "source_freshness": "Official Forest Service visitor map recreation layer cached by Trailhead; verify current closures and forest orders with USFS.",
    }


async def _query(lat: float, lng: float, radius_m: int) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{USFS_RECREATION_SITES}/query",
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
            resp.raise_for_status()
            return resp.json().get("features", [])
    except Exception:
        return []


async def get_usfs_recreation_sites(lat: float, lng: float, radius_miles: float = 50,
                                    categories: set[str] | None = None) -> list[dict]:
    radius_m = int(min(max(radius_miles, 1), 120) * 1609.344)
    category_key = ",".join(sorted(categories or [])) or "all"
    key = f"usfs_recreation_{lat:.2f}_{lng:.2f}_{radius_m}_{category_key}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 24 * 3)
    if cached is not None:
        return cached
    wanted = {str(c).lower() for c in (categories or set())}
    out: list[dict] = []
    seen: set[str] = set()
    for feature in await _query(lat, lng, radius_m):
        site = _normalize(feature)
        if not site or site["id"] in seen:
            continue
        ptype = str(site.get("type") or "").lower()
        if wanted and ptype not in wanted and not (ptype in {"picnic", "visitor_center"} and "attraction" in wanted):
            continue
        seen.add(site["id"])
        out.append(site)
    out.sort(key=lambda s: math.hypot((s["lat"] - lat) * 69, (s["lng"] - lng) * 54.6))
    set_cached("campsite_cache", key, out[:120])
    return out[:120]
