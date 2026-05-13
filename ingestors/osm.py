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
  node["tourism"="camp_pitch"](around:{radius},{lat},{lng});
  node["tourism"="wilderness_hut"](around:{radius},{lat},{lng});
  node["tourism"="alpine_hut"](around:{radius},{lat},{lng});
  node["amenity"="camping"](around:{radius},{lat},{lng});
  node["shelter_type"="basic_hut"](around:{radius},{lat},{lng});
  way["tourism"="camp_site"](around:{radius},{lat},{lng});
  way["tourism"="caravan_site"](around:{radius},{lat},{lng});
  way["tourism"="camp_pitch"](around:{radius},{lat},{lng});
  way["tourism"="wilderness_hut"](around:{radius},{lat},{lng});
  way["tourism"="alpine_hut"](around:{radius},{lat},{lng});
  way["amenity"="camping"](around:{radius},{lat},{lng});
  way["shelter_type"="basic_hut"](around:{radius},{lat},{lng});
);
out center tags 60;
"""

_WATER_QUERY = """
[out:json][timeout:15];
(
  node["natural"="spring"](around:{radius},{lat},{lng});
  node["amenity"="drinking_water"](around:{radius},{lat},{lng});
  node["amenity"="water_point"](around:{radius},{lat},{lng});
  node["amenity"="fountain"](around:{radius},{lat},{lng});
  way["natural"="water"](around:{radius},{lat},{lng});
  way["waterway"~"^(river|stream|canal)$"](around:{radius},{lat},{lng});
);
out center tags 60;
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

_TRAIL_ROUTE_QUERY = """
[out:json][timeout:25];
(
  relation["route"~"^(hiking|foot|bicycle|mtb|horse)$"](around:{radius},{lat},{lng});
  way["highway"~"^(path|track|footway|bridleway|cycleway)$"](around:{radius},{lat},{lng});
  way["route"~"^(hiking|foot|bicycle|mtb|horse)$"](around:{radius},{lat},{lng});
);
out center tags 120;
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


def _osm_url(el: dict) -> str:
    kind = el.get("type") or "node"
    return f"https://www.openstreetmap.org/{kind}/{el.get('id', '')}"


def _osm_camp_id(el: dict) -> str:
    kind = el.get("type") or "node"
    return f"osm_{kind}_{el.get('id', '')}"


def _osm_tags_to_amenities(tags: dict) -> list[str]:
    checks = [
        ("toilets", "yes", "Restrooms"),
        ("drinking_water", "yes", "Drinking water"),
        ("shower", "yes", "Showers"),
        ("hot_water", "yes", "Hot water"),
        ("internet_access", "wlan", "WiFi"),
        ("internet_access", "yes", "Internet"),
        ("fireplace", "yes", "Fire rings"),
        ("bbq", "yes", "BBQ"),
        ("picnic_table", "yes", "Picnic tables"),
        ("waste_disposal", "yes", "Trash"),
        ("sanitary_dump_station", "yes", "Dump station"),
        ("power_supply", "yes", "Power"),
        ("electricity", "yes", "Electricity"),
    ]
    amenities: list[str] = []
    for key, expected, label in checks:
        value = str(tags.get(key, "")).lower()
        if value == expected or (expected == "yes" and value in {"designated", "customers"}):
            amenities.append(label)
    if str(tags.get("wheelchair", "")).lower() in {"yes", "designated"}:
        amenities.append("ADA")
    return amenities


def _osm_site_types(tags: dict) -> list[str]:
    tourism = tags.get("tourism", "")
    site_types: list[str] = []
    if tourism == "camp_site":
        site_types.append("Campground")
    if tourism == "camp_pitch":
        site_types.append("Camp pitch")
    if tourism == "caravan_site":
        site_types.append("RV / caravan")
    if tourism in {"wilderness_hut", "alpine_hut"} or tags.get("shelter_type") == "basic_hut":
        site_types.append("Backcountry shelter")
    if tags.get("tents") == "yes":
        site_types.append("Tent")
    if tags.get("caravans") == "yes":
        site_types.append("RV")
    if tags.get("backcountry") == "yes":
        site_types.append("Backcountry")
    return site_types or ["Camp"]


def _normalize_osm_camp(el: dict) -> dict | None:
    coord = _node_coord(el)
    if not coord:
        return None
    tags_raw = el.get("tags", {})
    elat, elng = coord
    name = _tag(el, "name") or _tag(el, "operator") or "Campsite"
    access = _tag(el, "access", "yes")
    if access in ("private", "no"):
        return None
    fee = _tag(el, "fee", "")
    tents = _tag(el, "tents", "")
    caravans = _tag(el, "caravans", "")
    tourism = _tag(el, "tourism", "")
    tags = []
    if tents in ("yes", "") and tourism not in {"caravan_site"}:
        tags.append("tent")
    if caravans == "yes" or tourism == "caravan_site":
        tags.append("rv")
    if tourism == "camp_pitch":
        tags.append("dispersed")
    if tourism in {"wilderness_hut", "alpine_hut"} or _tag(el, "shelter_type") == "basic_hut":
        tags.append("walk_in")
    if _tag(el, "backcountry", "") == "yes":
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
    if fee == "no":
        tags.append("free")
    if not tags:
        tags.append("tent")
    desc_bits = [
        _tag(el, "description", ""),
        _tag(el, "operator", ""),
        _tag(el, "website", ""),
    ]
    description = " · ".join([x for x in desc_bits if x])[:300]
    return {
        "id": _osm_camp_id(el),
        "name": name,
        "lat": elat,
        "lng": elng,
        "tags": sorted(set(tags)),
        "land_type": _osm_land_label(tags),
        "description": description,
        "photo_url": None,
        "reservable": _tag(el, "reservation", "") in ("required", "yes"),
        "cost": "Free" if fee == "no" else ("Fee Required" if fee == "yes" else "See site"),
        "url": _tag(el, "website", "") or _osm_url(el),
        "ada": _tag(el, "wheelchair", "") in ("yes", "designated"),
        "source": "osm",
        "verified_source": "OpenStreetMap",
        "_osm_type": el.get("type") or "node",
        "_osm_tags": tags_raw,
    }


async def _overpass(query: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            r = await client.post(
                OVERPASS,
                data={"data": query},
                headers={"User-Agent": "Trailhead/1.0 contact@gettrailhead.app"},
            )
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
        site = _normalize_osm_camp(el)
        if site:
            site.pop("_osm_tags", None)
            sites.append(site)

    set_cached("campsite_cache", key, sites)
    return sites


async def get_osm_campsite_detail(camp_id: str) -> dict | None:
    """Return a full campsite detail for OSM-backed camps.

    Older app caches may still have ids like osm_123, so try node and way.
    New ids include the element type: osm_node_123 or osm_way_123.
    """
    cache_key = f"osm_detail_{camp_id}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24 * 7)
    if cached is not None:
        return cached

    parts = camp_id.split("_")
    candidates: list[tuple[str, str]] = []
    if len(parts) >= 3 and parts[1] in {"node", "way", "relation"}:
        candidates.append((parts[1], parts[2]))
    elif len(parts) >= 2:
        candidates.extend([("node", parts[1]), ("way", parts[1]), ("relation", parts[1])])
    for kind, osm_id in candidates:
        q = f"""
[out:json][timeout:15];
{kind}({osm_id});
out center tags;
"""
        elements = await _overpass(q)
        if not elements:
            continue
        site = _normalize_osm_camp(elements[0])
        if not site:
            continue
        tags = site.pop("_osm_tags", elements[0].get("tags", {}))
        detail = {
            **site,
            "photos": [],
            "amenities": _osm_tags_to_amenities(tags),
            "site_types": _osm_site_types(tags),
            "activities": [x for x in [
                "Camping",
                "Hiking" if tags.get("hiking") == "yes" else "",
                "Fishing" if tags.get("fishing") == "yes" else "",
                "OHV" if tags.get("atv") == "yes" else "",
            ] if x],
            "phone": tags.get("phone") or tags.get("contact:phone"),
            "campsites_count": int(tags.get("capacity", "0")) if str(tags.get("capacity", "0")).isdigit() else 0,
        }
        set_cached("campsite_cache", cache_key, detail)
        return detail
    return None


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
        wtype = _tag(el, "waterway", "")
        name = _tag(el, "name") or ("Natural Spring" if ntype == "spring" else "Fountain" if atype == "fountain" else "Mapped Water" if ntype == "water" or wtype else "Water Source")
        results.append({
            "id": f"osm_water_{el.get('id', '')}",
            "name": name,
            "lat": elat, "lng": elng,
            "type": "water",
            "subtype": "spring" if ntype == "spring" else "fountain" if atype == "fountain" else wtype or "tap",
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


async def get_trails(lat: float, lng: float, radius_m: int = 30000) -> list[dict]:
    key = f"osm_trail_routes_v3_{lat:.2f}_{lng:.2f}_{radius_m}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 24)
    if cached is not None:
        return cached

    elements = await _overpass(_TRAIL_ROUTE_QUERY.format(lat=lat, lng=lng, radius=radius_m))
    results = []
    seen = set()
    for el in elements:
        coord = _node_coord(el)
        if not coord:
            continue
        tags = el.get("tags", {})
        access = str(tags.get("access", "")).lower()
        if access in {"private", "no"}:
            continue
        route = str(tags.get("route") or tags.get("highway") or "trail")
        surface = str(tags.get("surface") or "").replace("_", " ")
        tracktype = str(tags.get("tracktype") or "").lower()
        name = _tag(el, "name") or _tag(el, "ref")
        if not name:
            if route == "track":
                if surface:
                    name = f"Mapped {surface} track"
                elif tracktype in {"grade4", "grade5"}:
                    name = "Mapped rough track"
                else:
                    name = "Mapped backroad"
            elif route in {"path", "footway", "bridleway", "cycleway"}:
                name = "Mapped trail"
            else:
                name = "Mapped trail route"
        elat, elng = coord
        kind = el.get("type") or "way"
        key2 = f"{kind}:{el.get('id')}"
        if key2 in seen:
            continue
        seen.add(key2)
        results.append({
            "id": f"osm_{kind}_{el.get('id', '')}",
            "name": name,
            "lat": elat,
            "lng": elng,
            "type": "trail",
            "subtype": route,
            "source_label": "OpenStreetMap",
            "url": _osm_url(el),
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
