"""OSM Overpass API ingestor.
Fetches campsites, water sources, trailheads, and viewpoints from OpenStreetMap.
No API key required. Free, unlimited (be polite — results are cached).
"""
from __future__ import annotations
import asyncio
import httpx
from db.store import get_cached, set_cached

OVERPASS = "https://overpass-api.de/api/interpreter"

_CAMP_QUERY = """
[out:json][timeout:20];
(
  node["tourism"="camp_site"](around:{radius},{lat},{lng});
  node["tourism"="caravan_site"](around:{radius},{lat},{lng});
  node["amenity"="camping"](around:{radius},{lat},{lng});
  way["tourism"="camp_site"](around:{radius},{lat},{lng});
);
out center tags 60;
"""

_WATER_QUERY = """
[out:json][timeout:15];
(
  node["natural"="spring"](around:{radius},{lat},{lng});
  node["amenity"="drinking_water"](around:{radius},{lat},{lng});
  node["amenity"="water_point"](around:{radius},{lat},{lng});
);
out tags 40;
"""

_TRAILHEAD_QUERY = """
[out:json][timeout:15];
(
  node["highway"="trailhead"](around:{radius},{lat},{lng});
  node["trailhead"="yes"](around:{radius},{lat},{lng});
);
out tags 30;
"""

_VIEW_QUERY = """
[out:json][timeout:15];
(
  node["tourism"="viewpoint"](around:{radius},{lat},{lng});
);
out tags 30;
"""

_PEAK_QUERY = """
[out:json][timeout:20];
(
  node["natural"="peak"]["name"](around:{radius},{lat},{lng});
);
out tags 60;
"""

_HOT_SPRING_QUERY = """
[out:json][timeout:15];
(
  node["natural"="hot_spring"](around:{radius},{lat},{lng});
  node["amenity"="public_bath"]["bath:type"="hot_spring"](around:{radius},{lat},{lng});
  way["natural"="hot_spring"](around:{radius},{lat},{lng});
  way["amenity"="public_bath"]["bath:type"="hot_spring"](around:{radius},{lat},{lng});
);
out center tags 40;
"""

_FUEL_QUERY = """
[out:json][timeout:15];
(
  node["amenity"="fuel"](around:{radius},{lat},{lng});
  way["amenity"="fuel"](around:{radius},{lat},{lng});
);
out center tags 40;
"""


def _node_coord(el: dict) -> tuple[float, float] | None:
    if el.get("type") == "way":
        c = el.get("center", {})
        lat, lng = c.get("lat"), c.get("lon")
    else:
        lat, lng = el.get("lat"), el.get("lon")
    if lat and lng:
        return float(lat), float(lng)
    return None


def _tag(el: dict, key: str, default: str = "") -> str:
    return el.get("tags", {}).get(key, default)


async def _overpass(query: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            r = await client.post(OVERPASS, data={"data": query})
            r.raise_for_status()
            return r.json().get("elements", [])
    except Exception:
        return []


async def get_osm_campsites(lat: float, lng: float, radius_m: int = 40000) -> list[dict]:
    key = f"osm_camp_{lat:.2f}_{lng:.2f}_{radius_m}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 12)
    if cached is not None:
        return cached

    q = _CAMP_QUERY.format(lat=lat, lng=lng, radius=radius_m)
    elements = await _overpass(q)

    sites = []
    for el in elements:
        coord = _node_coord(el)
        if not coord:
            continue
        elat, elng = coord
        name = _tag(el, "name") or _tag(el, "operator") or "Campsite"
        access = _tag(el, "access", "yes")
        if access in ("private", "no"):
            continue
        fee = _tag(el, "fee", "")
        tents = _tag(el, "tents", "")
        caravans = _tag(el, "caravans", "")
        tags = []
        if tents in ("yes", ""):
            tags.append("tent")
        if caravans == "yes":
            tags.append("rv")
        backpacking = _tag(el, "backcountry", "")
        if backpacking == "yes":
            tags.append("dispersed")
        operator = _tag(el, "operator:type", "")
        if "national_park" in operator.lower() or "nps" in _tag(el, "operator", "").lower():
            tags.append("nps")
        elif "forest" in _tag(el, "operator", "").lower():
            tags.append("usfs")
        elif "blm" in _tag(el, "operator", "").lower():
            tags.append("blm")
        elif "state" in _tag(el, "operator", "").lower():
            tags.append("state")
        if not tags:
            tags.append("tent")
        sites.append({
            "id": f"osm_{el.get('id', '')}",
            "name": name,
            "lat": elat,
            "lng": elng,
            "tags": tags,
            "land_type": _osm_land_label(tags),
            "description": _tag(el, "description", "")[:300],
            "photo_url": None,
            "reservable": _tag(el, "reservation", "") in ("required", "yes"),
            "cost": "Free" if fee == "no" else ("Fee Required" if fee == "yes" else "See site"),
            "url": f"https://www.openstreetmap.org/node/{el.get('id', '')}",
            "ada": _tag(el, "wheelchair", "") in ("yes", "designated"),
            "source": "osm",
        })

    set_cached("campsite_cache", key, sites)
    return sites


async def get_water_sources(lat: float, lng: float, radius_m: int = 30000) -> list[dict]:
    key = f"osm_water_{lat:.2f}_{lng:.2f}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 24)
    if cached is not None:
        return cached

    elements = await _overpass(_WATER_QUERY.format(lat=lat, lng=lng, radius=radius_m))
    results = []
    for el in elements:
        coord = _node_coord(el)
        if not coord:
            continue
        elat, elng = coord
        ntype = _tag(el, "natural", "")
        atype = _tag(el, "amenity", "")
        name = _tag(el, "name") or ("Natural Spring" if ntype == "spring" else "Water Source")
        results.append({
            "id": f"osm_water_{el.get('id', '')}",
            "name": name,
            "lat": elat, "lng": elng,
            "type": "water",
            "subtype": "spring" if ntype == "spring" else "tap",
        })
    set_cached("campsite_cache", key, results)
    return results


async def get_trailheads(lat: float, lng: float, radius_m: int = 30000) -> list[dict]:
    key = f"osm_trail_{lat:.2f}_{lng:.2f}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 24)
    if cached is not None:
        return cached

    elements = await _overpass(_TRAILHEAD_QUERY.format(lat=lat, lng=lng, radius=radius_m))
    results = []
    for el in elements:
        coord = _node_coord(el)
        if not coord:
            continue
        elat, elng = coord
        name = _tag(el, "name") or _tag(el, "trail_name") or "Trailhead"
        results.append({
            "id": f"osm_trail_{el.get('id', '')}",
            "name": name,
            "lat": elat, "lng": elng,
            "type": "trailhead",
        })
    set_cached("campsite_cache", key, results)
    return results


async def get_viewpoints(lat: float, lng: float, radius_m: int = 30000) -> list[dict]:
    key = f"osm_view_{lat:.2f}_{lng:.2f}_{radius_m}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 24)
    if cached is not None:
        return cached

    elements = await _overpass(_VIEW_QUERY.format(lat=lat, lng=lng, radius=radius_m))
    results = []
    for el in elements:
        coord = _node_coord(el)
        if not coord:
            continue
        elat, elng = coord
        name = _tag(el, "name") or "Viewpoint"
        results.append({
            "id": f"osm_view_{el.get('id', '')}",
            "name": name,
            "lat": elat, "lng": elng,
            "type": "viewpoint",
            "elevation": "",
        })
    set_cached("campsite_cache", key, results)
    return results


def _ele_to_ft(ele_str: str) -> str:
    """Convert OSM elevation string to feet. OSM standard is meters."""
    if not ele_str:
        return ""
    try:
        m = float(ele_str.replace("m", "").strip())
        # If value > 9000 it's likely already in feet (some old US tags)
        if m > 9000:
            return str(int(m))
        return str(int(m * 3.28084))
    except Exception:
        return ele_str


async def get_peaks(lat: float, lng: float, radius_m: int = 64000) -> list[dict]:
    key = f"osm_peaks_{lat:.2f}_{lng:.2f}_{radius_m}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 24)
    if cached is not None:
        return cached

    elements = await _overpass(_PEAK_QUERY.format(lat=lat, lng=lng, radius=radius_m))
    results = []
    for el in elements:
        coord = _node_coord(el)
        if not coord:
            continue
        elat, elng = coord
        name = _tag(el, "name") or "Peak"
        results.append({
            "id": f"osm_peak_{el.get('id', '')}",
            "name": name,
            "lat": elat, "lng": elng,
            "type": "peak",
            "elevation": _ele_to_ft(_tag(el, "ele", "")),
        })
    set_cached("campsite_cache", key, results)
    return results


async def get_hot_springs(lat: float, lng: float, radius_m: int = 48000) -> list[dict]:
    key = f"osm_hot_spring_{lat:.2f}_{lng:.2f}_{radius_m}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 24)
    if cached is not None:
        return cached

    elements = await _overpass(_HOT_SPRING_QUERY.format(lat=lat, lng=lng, radius=radius_m))
    results = []
    for el in elements:
        coord = _node_coord(el)
        if not coord:
            continue
        elat, elng = coord
        name = _tag(el, "name") or "Hot Spring"
        access = _tag(el, "access", "yes")
        if access in ("private", "no"):
            continue
        results.append({
            "id": f"osm_hot_spring_{el.get('id', '')}",
            "name": name,
            "lat": elat,
            "lng": elng,
            "type": "hot_spring",
            "subtype": _tag(el, "bath:type", "hot_spring"),
            "source": "osm",
        })
    set_cached("campsite_cache", key, results)
    return results


async def get_fuel_stations(lat: float, lng: float, radius_m: int = 24000) -> list[dict]:
    """Fetch normal gasoline/diesel stations from OSM.

    NREL is useful for propane/EV/alt-fuel, but it does not cover ordinary
    rural gas well enough for overland trip planning.
    """
    key = f"osm_fuel_{lat:.2f}_{lng:.2f}_{radius_m}"
    cached = get_cached("gas_cache", key, ttl_seconds=3600 * 24)
    if cached is not None:
        return cached

    elements = await _overpass(_FUEL_QUERY.format(lat=lat, lng=lng, radius=radius_m))
    results = []
    for el in elements:
        coord = _node_coord(el)
        if not coord:
            continue
        elat, elng = coord
        access = _tag(el, "access", "yes")
        if access in ("private", "no"):
            continue
        brand = _tag(el, "brand") or _tag(el, "operator")
        name = _tag(el, "name") or brand or "Fuel Station"
        fuel_types = []
        if _tag(el, "fuel:diesel", "") == "yes":
            fuel_types.append("diesel")
        if _tag(el, "fuel:propane", "") == "yes":
            fuel_types.append("propane")
        if _tag(el, "fuel:octane_87", "") == "yes" or not fuel_types:
            fuel_types.append("gas")
        results.append({
            "id": f"osm_fuel_{el.get('id', '')}",
            "name": name,
            "lat": elat,
            "lng": elng,
            "type": "fuel",
            "fuel_types": ", ".join(fuel_types),
            "address": ", ".join([v for v in [_tag(el, "addr:street"), _tag(el, "addr:city"), _tag(el, "addr:state")] if v]),
            "source": "osm",
        })

    set_cached("gas_cache", key, results)
    return results


def _osm_land_label(tags: list[str]) -> str:
    if "nps" in tags: return "National Park"
    if "usfs" in tags: return "National Forest"
    if "blm" in tags: return "BLM Land"
    if "state" in tags: return "State Park"
    return "Campground"
