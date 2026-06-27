"""OSM Overpass API ingestor.
Fetches campsites, water sources, trailheads, and viewpoints from OpenStreetMap.
No API key required. Free, unlimited (be polite — results are cached).
"""
from __future__ import annotations
import asyncio
import math
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
  node["amenity"="shelter"](around:{radius},{lat},{lng});
  node["shelter_type"="basic_hut"](around:{radius},{lat},{lng});
  node["shelter_type"="lean_to"](around:{radius},{lat},{lng});
  node["shelter_type"="weather_shelter"](around:{radius},{lat},{lng});
  node["shelter_type"="rock_shelter"](around:{radius},{lat},{lng});
  node["backcountry"="yes"](around:{radius},{lat},{lng});
  way["tourism"="camp_site"](around:{radius},{lat},{lng});
  way["tourism"="caravan_site"](around:{radius},{lat},{lng});
  way["tourism"="camp_pitch"](around:{radius},{lat},{lng});
  way["tourism"="wilderness_hut"](around:{radius},{lat},{lng});
  way["tourism"="alpine_hut"](around:{radius},{lat},{lng});
  way["amenity"="camping"](around:{radius},{lat},{lng});
  way["amenity"="shelter"](around:{radius},{lat},{lng});
  way["shelter_type"="basic_hut"](around:{radius},{lat},{lng});
  way["shelter_type"="lean_to"](around:{radius},{lat},{lng});
  way["shelter_type"="weather_shelter"](around:{radius},{lat},{lng});
  way["shelter_type"="rock_shelter"](around:{radius},{lat},{lng});
  way["backcountry"="yes"](around:{radius},{lat},{lng});
);
out center tags 60;
"""

_OUTDOOR_STAY_QUERY = """
[out:json][timeout:22];
(
  node["tourism"~"^(camp_site|caravan_site|camp_pitch|wilderness_hut|alpine_hut|chalet|guest_house|hostel)$"](around:{radius},{lat},{lng});
  way["tourism"~"^(camp_site|caravan_site|camp_pitch|wilderness_hut|alpine_hut|chalet|guest_house|hostel)$"](around:{radius},{lat},{lng});
  node["amenity"="shelter"](around:{radius},{lat},{lng});
  way["amenity"="shelter"](around:{radius},{lat},{lng});
  node["shelter_type"~"^(basic_hut|lean_to|weather_shelter|rock_shelter)$"](around:{radius},{lat},{lng});
  way["shelter_type"~"^(basic_hut|lean_to|weather_shelter|rock_shelter)$"](around:{radius},{lat},{lng});
);
out center tags 100;
"""

_WATER_QUERY = """
[out:json][timeout:15];
(
  node["natural"="spring"](around:{radius},{lat},{lng});
  node["amenity"="drinking_water"](around:{radius},{lat},{lng});
  node["amenity"="water_point"](around:{radius},{lat},{lng});
  node["amenity"="fountain"](around:{radius},{lat},{lng});
  way["natural"="water"](around:{radius},{lat},{lng});
  way["water"~"^(lake|pond|reservoir|river)$"](around:{radius},{lat},{lng});
  way["waterway"~"^(river|stream|canal)$"](around:{radius},{lat},{lng});
  relation["natural"="water"](around:{radius},{lat},{lng});
  relation["waterway"~"^(river|stream|canal)$"](around:{radius},{lat},{lng});
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
out geom 120;
"""

_FUEL_QUERY = """
[out:json][timeout:15];
(
  node["amenity"="fuel"](around:{radius},{lat},{lng});
  way["amenity"="fuel"](around:{radius},{lat},{lng});
);
out center tags 40;
"""

_SERVICE_QUERY = """
[out:json][timeout:18];
(
  node["amenity"="fuel"](around:{radius},{lat},{lng});
  way["amenity"="fuel"](around:{radius},{lat},{lng});
  node["fuel:propane"="yes"](around:{radius},{lat},{lng});
  way["fuel:propane"="yes"](around:{radius},{lat},{lng});
  node["natural"="spring"](around:{radius},{lat},{lng});
  node["amenity"="drinking_water"](around:{radius},{lat},{lng});
  node["amenity"="water_point"](around:{radius},{lat},{lng});
  node["amenity"="sanitary_dump_station"](around:{radius},{lat},{lng});
  way["amenity"="sanitary_dump_station"](around:{radius},{lat},{lng});
  node["sanitary_dump_station"="yes"](around:{radius},{lat},{lng});
  way["sanitary_dump_station"="yes"](around:{radius},{lat},{lng});
  node["amenity"="shower"](around:{radius},{lat},{lng});
  node["shop"="laundry"](around:{radius},{lat},{lng});
  node["tourism"~"hotel|motel|guest_house|hostel"](around:{radius},{lat},{lng});
  way["tourism"~"hotel|motel|guest_house|hostel"](around:{radius},{lat},{lng});
  node["amenity"~"restaurant|cafe|fast_food"](around:{radius},{lat},{lng});
  node["shop"~"supermarket|convenience|general"](around:{radius},{lat},{lng});
  node["shop"~"car_repair|tyres|car_parts|auto_parts|vehicle"](around:{radius},{lat},{lng});
  way["shop"~"car_repair|tyres|car_parts|auto_parts|vehicle"](around:{radius},{lat},{lng});
  node["craft"="mechanic"](around:{radius},{lat},{lng});
  node["shop"="hardware"](around:{radius},{lat},{lng});
  node["shop"="doityourself"](around:{radius},{lat},{lng});
  node["shop"~"outdoor|sports"](around:{radius},{lat},{lng});
  node["amenity"~"hospital|clinic|pharmacy"](around:{radius},{lat},{lng});
  node["amenity"="parking"](around:{radius},{lat},{lng});
  way["amenity"="parking"](around:{radius},{lat},{lng});
  node["amenity"="library"](around:{radius},{lat},{lng});
  node["tourism"="attraction"](around:{radius},{lat},{lng});
  way["tourism"="attraction"](around:{radius},{lat},{lng});
  node["highway"="trailhead"](around:{radius},{lat},{lng});
  node["trailhead"="yes"](around:{radius},{lat},{lng});
  node["tourism"="viewpoint"](around:{radius},{lat},{lng});
  way["tourism"="viewpoint"](around:{radius},{lat},{lng});
  node["natural"="peak"]["name"](around:{radius},{lat},{lng});
  node["natural"="hot_spring"](around:{radius},{lat},{lng});
  way["natural"="hot_spring"](around:{radius},{lat},{lng});
  node["amenity"="public_bath"]["bath:type"="hot_spring"](around:{radius},{lat},{lng});
  way["amenity"="public_bath"]["bath:type"="hot_spring"](around:{radius},{lat},{lng});
);
out center tags 160;
"""

SERVICE_CATEGORIES = {
    "fuel", "propane", "water", "dump", "shower", "laundromat",
    "lodging", "food", "grocery", "mechanic", "parking", "attraction",
    "trailhead", "viewpoint", "peak", "hot_spring", "hardware", "camping",
    "medical", "parts", "wifi",
}


def _node_coord(el: dict) -> tuple[float, float] | None:
    if el.get("type") == "way":
        c = el.get("center", {})
        lat, lng = c.get("lat"), c.get("lon")
    else:
        lat, lng = el.get("lat"), el.get("lon")
    if lat is not None and lng is not None:
        return float(lat), float(lng)
    return None


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _clean_overpass_line(raw_geometry: list | None, max_points: int = 1200) -> list[list[float]]:
    if not isinstance(raw_geometry, list):
        return []
    clean: list[list[float]] = []
    for node in raw_geometry[:max_points]:
        if not isinstance(node, dict):
            continue
        try:
            lat = float(node.get("lat"))
            lng = float(node.get("lon"))
        except Exception:
            continue
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        coord = [round(lng, 7), round(lat, 7)]
        if clean and clean[-1] == coord:
            continue
        clean.append(coord)
    return clean if len(clean) >= 2 else []


def _line_length_m(coords: list[list[float]]) -> float:
    return sum(
        _haversine_m(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])
        for i in range(1, len(coords))
    )


def _coord_distance_m(a: list[float], b: list[float]) -> float:
    return _haversine_m(a[1], a[0], b[1], b[0])


def _append_line(base: list[list[float]], segment: list[list[float]]) -> None:
    if not base:
        base.extend(segment)
        return
    base.extend(segment[1:] if base[-1] == segment[0] else segment)


def _stitch_lines(lines: list[list[list[float]]], tolerance_m: float = 35.0) -> list[list[list[float]]]:
    remaining = [list(line) for line in lines if len(line) >= 2]
    stitched: list[list[list[float]]] = []
    while remaining:
        current = remaining.pop(0)
        changed = True
        while changed and remaining:
            changed = False
            best: tuple[float, int, str] | None = None
            for idx, line in enumerate(remaining):
                checks = [
                    (_coord_distance_m(current[-1], line[0]), idx, "append"),
                    (_coord_distance_m(current[-1], line[-1]), idx, "append_reversed"),
                    (_coord_distance_m(current[0], line[-1]), idx, "prepend"),
                    (_coord_distance_m(current[0], line[0]), idx, "prepend_reversed"),
                ]
                nearest = min(checks, key=lambda item: item[0])
                if nearest[0] <= tolerance_m and (best is None or nearest[0] < best[0]):
                    best = nearest
            if not best:
                continue
            _, idx, mode = best
            line = remaining.pop(idx)
            if mode == "append":
                _append_line(current, line)
            elif mode == "append_reversed":
                _append_line(current, list(reversed(line)))
            elif mode == "prepend":
                current = line[:-1] + current if line[-1] == current[0] else line + current
            else:
                rev = list(reversed(line))
                current = rev[:-1] + current if rev[-1] == current[0] else rev + current
            changed = True
        stitched.append(current)
    return stitched


def _trail_geometry_from_element(el: dict) -> dict | None:
    direct = _clean_overpass_line(el.get("geometry"))
    if direct:
        return {"type": "LineString", "coordinates": direct}

    member_lines: list[list[list[float]]] = []
    for member in el.get("members") or []:
        line = _clean_overpass_line((member or {}).get("geometry"))
        if line:
            member_lines.append(line)
    if not member_lines:
        return None

    stitched = _stitch_lines(member_lines)
    stitched = [line for line in stitched if len(line) >= 2]
    if not stitched:
        return None
    if len(stitched) == 1:
        return {"type": "LineString", "coordinates": stitched[0][:2500]}

    capped: list[list[list[float]]] = []
    total_points = 0
    for line in sorted(stitched, key=_line_length_m, reverse=True):
        if total_points >= 4000:
            break
        take = line[: max(2, min(len(line), 4000 - total_points))]
        if len(take) >= 2:
            capped.append(take)
            total_points += len(take)
    return {"type": "MultiLineString", "coordinates": capped} if capped else None


def _geometry_length_m(geometry: dict | None) -> float:
    if not isinstance(geometry, dict):
        return 0.0
    if geometry.get("type") == "LineString":
        return _line_length_m(geometry.get("coordinates") or [])
    if geometry.get("type") == "MultiLineString":
        return sum(_line_length_m(line) for line in geometry.get("coordinates") or [])
    return 0.0


def _geometry_representative_coord(geometry: dict | None) -> tuple[float, float] | None:
    if not isinstance(geometry, dict):
        return None
    lines: list[list[list[float]]] = []
    if geometry.get("type") == "LineString":
        lines = [geometry.get("coordinates") or []]
    elif geometry.get("type") == "MultiLineString":
        lines = [line for line in geometry.get("coordinates") or [] if isinstance(line, list)]
    lines = [line for line in lines if len(line) >= 2]
    if not lines:
        return None
    line = max(lines, key=_line_length_m)
    coord = line[len(line) // 2]
    return float(coord[1]), float(coord[0])


def _service_category(tags: dict) -> str | None:
    if tags.get("amenity") == "fuel":
        if tags.get("fuel:propane") == "yes" and tags.get("fuel:diesel") != "yes":
            return "propane"
        return "fuel"
    if tags.get("fuel:propane") == "yes":
        return "propane"
    if tags.get("natural") == "spring" or tags.get("amenity") in {"drinking_water", "water_point", "fountain"}:
        return "water"
    if tags.get("highway") == "trailhead" or tags.get("trailhead") == "yes":
        return "trailhead"
    if tags.get("tourism") == "viewpoint":
        return "viewpoint"
    if tags.get("natural") == "peak":
        return "peak"
    if tags.get("natural") == "hot_spring" or (tags.get("amenity") == "public_bath" and tags.get("bath:type") == "hot_spring"):
        return "hot_spring"
    if tags.get("tourism") in {"hotel", "motel", "guest_house", "hostel"}:
        return "lodging"
    if tags.get("amenity") == "shower":
        return "shower"
    if tags.get("amenity") == "sanitary_dump_station" or tags.get("sanitary_dump_station") == "yes":
        return "dump"
    if tags.get("shop") == "laundry":
        return "laundromat"
    if tags.get("amenity") in {"restaurant", "cafe", "fast_food"}:
        return "food"
    if tags.get("shop") in {"supermarket", "convenience", "general"}:
        return "grocery"
    if tags.get("shop") in {"car_repair", "tyres", "car_parts", "auto_parts", "vehicle"} or tags.get("craft") == "mechanic":
        return "mechanic" if tags.get("shop") not in {"car_parts", "auto_parts"} else "parts"
    if tags.get("shop") in {"hardware", "doityourself"}:
        return "hardware"
    if tags.get("shop") in {"outdoor", "sports"}:
        return "camping"
    if tags.get("amenity") in {"hospital", "clinic", "pharmacy"}:
        return "medical"
    if tags.get("amenity") == "parking":
        return "parking"
    if tags.get("amenity") == "library" or tags.get("internet_access") in {"wlan", "yes"}:
        return "wifi"
    if tags.get("tourism") == "attraction":
        return "attraction"
    return None


def _normalize_service_place(el: dict) -> dict | None:
    coord = _node_coord(el)
    tags = el.get("tags", {})
    ptype = _service_category(tags)
    if not coord or not ptype:
        return None
    if str(tags.get("access", "")).lower() in {"private", "no"}:
        return None
    lat, lng = coord
    name = tags.get("name") or tags.get("brand") or tags.get("operator") or ptype.replace("_", " ").title()
    kind = el.get("type") or "node"
    fuel_types: list[str] = []
    if ptype in {"fuel", "propane"}:
        if tags.get("fuel:diesel") == "yes":
            fuel_types.append("diesel")
        if tags.get("fuel:propane") == "yes":
            fuel_types.append("propane")
        if tags.get("fuel:octane_87") == "yes" or not fuel_types:
            fuel_types.append("gas")
    return {
        "id": f"osm_{ptype}_{kind}_{el.get('id', '')}",
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": ptype,
        "category": ptype,
        "source": "osm",
        "subtype": tags.get("tourism") or tags.get("shop") or tags.get("amenity") or tags.get("natural") or tags.get("bath:type") or "",
        "address": ", ".join([v for v in [tags.get("addr:street"), tags.get("addr:city"), tags.get("addr:state")] if v]),
        "fuel_types": ", ".join(fuel_types),
        "elevation": tags.get("ele", ""),
    }


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
    if tourism in {"wilderness_hut", "alpine_hut"} or tags.get("shelter_type") in {"basic_hut", "lean_to", "weather_shelter", "rock_shelter"}:
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
    amenity = _tag(el, "amenity", "")
    shelter_type = _tag(el, "shelter_type", "")
    camp_tourism = {"camp_site", "caravan_site", "camp_pitch", "wilderness_hut", "alpine_hut"}
    overnight_shelters = {"basic_hut", "lean_to", "weather_shelter", "rock_shelter"}
    backcountry_yes = _tag(el, "backcountry", "") == "yes"
    if tourism not in camp_tourism and amenity != "camping" and shelter_type not in overnight_shelters:
        if not (backcountry_yes and (tents == "yes" or _tag(el, "camp_site", "") or _tag(el, "camping", ""))):
            return None
    tags = []
    if tents in ("yes", "") and tourism not in {"caravan_site"}:
        tags.append("tent")
    if caravans == "yes" or tourism == "caravan_site":
        tags.append("rv")
    if tourism == "camp_pitch":
        tags.append("dispersed")
    if tourism in {"wilderness_hut", "alpine_hut"} or shelter_type in {"basic_hut", "lean_to", "weather_shelter", "rock_shelter"}:
        tags.append("walk_in")
    if backcountry_yes:
        tags.append("dispersed")
        tags.append("backcountry")
    if _tag(el, "informal", "") == "yes":
        tags.append("dispersed")
    if _tag(el, "impromptu", "") == "yes":
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
        "amenities": _osm_tags_to_amenities(tags_raw),
        "site_types": _osm_site_types(tags_raw),
        "url": _tag(el, "website", "") or _osm_url(el),
        "ada": _tag(el, "wheelchair", "") in ("yes", "designated"),
        "source": "osm",
        "verified_source": "OpenStreetMap",
        "source_badge": "OSM",
        "source_confidence": "medium",
        "source_freshness": "Community-mapped OpenStreetMap camp data cached by Trailhead; verify current access, legality, fees, and conditions locally.",
        "source_tier": "free_community",
        "link_label": "Map source",
        "_osm_type": el.get("type") or "node",
        "_osm_tags": tags_raw,
    }


def _normalize_osm_outdoor_stay(el: dict, profile: str = "") -> dict | None:
    coord = _node_coord(el)
    if not coord:
        return None
    tags_raw = el.get("tags", {})
    access = str(tags_raw.get("access") or "yes").lower()
    if access in {"private", "no"}:
        return None
    tourism = str(tags_raw.get("tourism") or "").lower()
    amenity = str(tags_raw.get("amenity") or "").lower()
    shelter_type = str(tags_raw.get("shelter_type") or "").lower()
    lat, lng = coord
    name = tags_raw.get("name") or tags_raw.get("operator")
    tags = ["osm", "mixed_source"]
    site_types: list[str] = []
    if tourism in {"wilderness_hut", "alpine_hut"} or shelter_type in {"basic_hut", "lean_to", "weather_shelter", "rock_shelter"}:
        land_type = "Backcountry Hut"
        tags.extend(["hut", "walk_in", "backcountry"])
        site_types.append("Hut / shelter")
        name = name or "Backcountry hut"
    elif amenity == "shelter":
        land_type = "Trail Shelter"
        tags.extend(["shelter", "walk_in"])
        site_types.append("Shelter")
        name = name or "Trail shelter"
    elif tourism in {"guest_house", "hostel", "chalet"}:
        land_type = "Trekking Lodge" if profile == "pakistan_karakoram" else tourism.replace("_", " ").title()
        tags.extend(["lodging", "trekking_lodge" if profile == "pakistan_karakoram" else "stay"])
        site_types.append(land_type)
        name = name or land_type
    elif tourism == "caravan_site":
        land_type = "Caravan Site"
        tags.extend(["campground", "rv"])
        site_types.append("RV / caravan")
        name = name or "Caravan site"
    else:
        land_type = "Campground"
        tags.extend(["campground", "tent"])
        site_types.append("Campground")
        name = name or "Campsite"
    if profile == "pakistan_karakoram":
        tags.extend(["pakistan", "karakoram", "trekking"])
    if str(tags_raw.get("fee") or "").lower() == "no":
        tags.append("free")
    description_bits = [
        tags_raw.get("description"),
        tags_raw.get("operator"),
        tags_raw.get("website"),
    ]
    description = " · ".join([str(x).strip() for x in description_bits if str(x or "").strip()])[:320]
    if not description:
        description = (
            "Mapped outdoor stay or shelter from OpenStreetMap. Verify current access, safety, permits, and local conditions before relying on it."
        )
    kind = el.get("type") or "node"
    osm_id = el.get("id", "")
    return {
        "id": f"osm_outdoor_stay_{kind}_{osm_id}",
        "name": str(name).strip(),
        "lat": lat,
        "lng": lng,
        "tags": sorted(set(tags)),
        "land_type": land_type,
        "description": description,
        "photo_url": None,
        "reservable": str(tags_raw.get("reservation") or "").lower() in {"required", "yes"},
        "cost": "Free" if str(tags_raw.get("fee") or "").lower() == "no" else "Verify locally",
        "amenities": _osm_tags_to_amenities(tags_raw),
        "site_types": site_types,
        "url": tags_raw.get("website") or _osm_url(el),
        "official_url": tags_raw.get("website") or "",
        "booking_url": "",
        "ada": str(tags_raw.get("wheelchair") or "").lower() in {"yes", "designated"},
        "source": "osm_mixed_outdoor",
        "source_tier": "free_community",
        "verified_source": "OpenStreetMap + local review",
        "source_badge": "OSM mixed",
        "source_confidence": "mixed",
        "source_freshness": "Community-mapped outdoor stay data. Verify permits, access, safety, seasonal closures, and current availability locally.",
        "link_label": "Map source",
        "rich_detail_available": False,
        "rich_detail_locked": False,
        "rich_detail_reason": "",
        "_osm_type": kind,
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


async def get_osm_outdoor_stays(lat: float, lng: float, radius_m: int = 40000, profile: str = "") -> list[dict]:
    """Fetch camp, hut, shelter, and trekking-lodge style stays from OSM.

    This is used for international regions where official campsite geometry is
    limited or fragmented. Results are labeled mixed-confidence so the app does
    not imply legal availability or booking support.
    """
    radius_m = max(1000, min(int(radius_m), 96_000))
    key = f"osm_outdoor_stays_v1_{profile}_{lat:.2f}_{lng:.2f}_{radius_m}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 12)
    if cached is not None:
        return cached

    elements = await _overpass(_OUTDOOR_STAY_QUERY.format(lat=lat, lng=lng, radius=radius_m))
    seen: set[str] = set()
    sites: list[dict] = []
    for el in elements:
        site = _normalize_osm_outdoor_stay(el, profile=profile)
        if not site:
            continue
        site.pop("_osm_tags", None)
        dedupe = f"{site.get('name')}:{float(site.get('lat', 0)):.4f}:{float(site.get('lng', 0)):.4f}"
        if dedupe in seen:
            continue
        seen.add(dedupe)
        sites.append(site)

    set_cached("campsite_cache", key, sites[:120])
    return sites[:120]


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
    key = f"osm_water_v3_{lat:.2f}_{lng:.2f}_{int(radius_m / 1600)}"
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


async def get_trails(lat: float, lng: float, radius_m: int = 30000, refresh: bool = False) -> list[dict]:
    key = f"osm_trail_routes_v5_merged_{lat:.2f}_{lng:.2f}_{radius_m}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 24)
    if cached is not None and not refresh:
        return cached

    elements = await _overpass(_TRAIL_ROUTE_QUERY.format(lat=lat, lng=lng, radius=radius_m))
    results = []
    seen = set()
    for el in elements:
        kind = el.get("type") or "way"
        key2 = f"{kind}:{el.get('id')}"
        if key2 in seen:
            continue
        seen.add(key2)
        route = _normalize_trail_route(el)
        if route:
            results.append(route)
    results = _merge_route_fragments(results)
    results.sort(key=_route_sort_key)
    set_cached("campsite_cache", key, results)
    return results


def _generated_trail_name(name: str) -> bool:
    clean = str(name or "").strip().lower()
    return clean in {"mapped trail", "mapped trail route", "mapped rough track", "mapped backroad"} or clean.startswith("mapped ")


def _route_group_key(route: dict) -> str:
    name = str(route.get("name") or "").strip().lower()
    if not name or _generated_trail_name(name):
        return ""
    subtype = str(route.get("subtype") or "").strip().lower()
    return f"{name}:{subtype}"


def _route_geometry_lines(route: dict) -> list[list[list[float]]]:
    geometry = route.get("geometry") if isinstance(route, dict) else None
    if not isinstance(geometry, dict):
        return []
    if geometry.get("type") == "LineString":
        coords = geometry.get("coordinates") or []
        return [coords] if len(coords) >= 2 else []
    if geometry.get("type") == "MultiLineString":
        return [line for line in (geometry.get("coordinates") or []) if isinstance(line, list) and len(line) >= 2]
    return []


def _geometry_from_lines(lines: list[list[list[float]]]) -> dict | None:
    clean = [line for line in lines if len(line) >= 2]
    if not clean:
        return None
    if len(clean) == 1:
        return {"type": "LineString", "coordinates": clean[0]}
    return {"type": "MultiLineString", "coordinates": clean}


def _merge_route_group(routes: list[dict]) -> dict:
    if len(routes) == 1:
        return routes[0]
    base = max(routes, key=lambda r: _geometry_length_m(r.get("geometry")))
    lines: list[list[list[float]]] = []
    for route in routes:
        lines.extend(_route_geometry_lines(route))
    stitched = _stitch_lines(lines, tolerance_m=45.0)
    geometry = _geometry_from_lines(stitched)
    length_m = _geometry_length_m(geometry)
    coord = _geometry_representative_coord(geometry) or (base.get("lat"), base.get("lng"))
    source_ids = [str(r.get("id") or "") for r in routes if r.get("id")]
    merged = {
        **base,
        "id": base.get("id") or source_ids[0],
        "lat": float(coord[0]),
        "lng": float(coord[1]),
        "geometry": geometry,
        "length_mi": round(length_m / 1609.344, 2) if length_m > 0 else base.get("length_mi"),
        "source_ids": source_ids,
        "merged_segments": len(routes),
    }
    return merged


def _merge_route_fragments(routes: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    passthrough: list[dict] = []
    for route in routes:
        key = _route_group_key(route)
        if not key:
            passthrough.append(route)
            continue
        grouped.setdefault(key, []).append(route)
    merged = [_merge_route_group(group) for group in grouped.values()]
    return passthrough + merged


def _route_sort_key(route: dict) -> tuple:
    name = str(route.get("name") or "")
    generated = _generated_trail_name(name)
    try:
        length = float(route.get("length_mi") or 0)
    except Exception:
        length = 0.0
    previewable = 1 if route.get("geometry") else 0
    merged = int(route.get("merged_segments") or 1)
    # Named and longer routes should beat tiny OSM way fragments in discovery.
    score = 0.0
    score += 120 if previewable else 0
    score += 90 if not generated else -35
    score += min(length * 18, 80)
    score += min(max(merged - 1, 0) * 8, 32)
    if generated and length < 0.15:
        score -= 120
    return (-score, generated, -length, str(route.get("name") or ""))


def _normalize_trail_route(el: dict) -> dict | None:
    geometry = _trail_geometry_from_element(el)
    coord = _node_coord(el) or _geometry_representative_coord(geometry)
    if not coord:
        return None
    tags = el.get("tags", {})
    access = str(tags.get("access", "")).lower()
    if access in {"private", "no"}:
        return None
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
    length_m = _geometry_length_m(geometry)
    return {
        "id": f"osm_{kind}_{el.get('id', '')}",
        "name": name,
        "lat": elat,
        "lng": elng,
        "type": "trail",
        "subtype": route,
        "source_label": "OpenStreetMap",
        "url": _osm_url(el),
        "geometry": geometry,
        "length_mi": round(length_m / 1609.344, 2) if length_m > 0 else None,
    }


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


async def get_service_places(lat: float, lng: float, radius_m: int = 24000, categories: set[str] | None = None) -> list[dict]:
    """Fetch practical road-trip services from OSM with backend cache control."""
    allowed = {c for c in (categories or SERVICE_CATEGORIES) if c in SERVICE_CATEGORIES}
    if not allowed:
        return []
    radius_m = max(1000, min(int(radius_m), 72_000))
    key = f"osm_services_{lat:.2f}_{lng:.2f}_{radius_m}_{','.join(sorted(allowed))}"
    cached = get_cached("gas_cache", key, ttl_seconds=3600 * 24)
    if cached is not None:
        return cached

    elements = await _overpass(_SERVICE_QUERY.format(lat=lat, lng=lng, radius=radius_m))
    seen: set[str] = set()
    results: list[dict] = []
    for el in elements:
        point = _normalize_service_place(el)
        if not point or point.get("type") not in allowed:
            continue
        dedupe = f"{point.get('type')}:{point.get('name')}:{float(point.get('lat', 0)):.4f}:{float(point.get('lng', 0)):.4f}"
        if dedupe in seen:
            continue
        seen.add(dedupe)
        results.append(point)

    set_cached("gas_cache", key, results[:160])
    return results[:160]


def _osm_land_label(tags: list[str]) -> str:
    if "nps" in tags: return "National Park"
    if "usfs" in tags: return "National Forest"
    if "blm" in tags: return "BLM Land"
    if "state" in tags: return "State Park"
    return "Campground"
