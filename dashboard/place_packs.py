"""Offline place pack generation and R2 upload.

The first pack is intentionally small and practical: region essentials
for fuel, water, trailheads, viewpoints, peaks, and hot springs. Packs are
plain JSON so the current Expo binary can download and render them OTA.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path

import httpx

from dashboard.pmtiles_bootstrap import DATA_DIR
from dashboard.pmtiles_states import STATE_BBOXES, REGION_BBOXES
from ingestors.blm import get_blm_campsites, get_blm_recreation_sites
from ingestors.nps import get_nps_places, nps_enabled
from ingestors.osm import get_osm_outdoor_stays
from ingestors.pakistan_curated import get_pakistan_curated_stays
from ingestors.ridb import get_campsites_search
from ingestors.usfs import get_usfs_recreation_sites

PLACE_PACK_DIR = DATA_DIR / "place_packs"
PLACE_PACK_DIR.mkdir(parents=True, exist_ok=True)

PACK_DEFINITIONS = {
    "essentials": {
        "id": "essentials",
        "name": "Essentials",
        "description": "Core road-trip services, outdoor stops, lodging, and useful town stops.",
        "categories": [
            "fuel", "propane", "water", "dump", "shower", "laundromat",
            "lodging", "food", "grocery", "mechanic", "parking", "attraction",
            "trailhead", "viewpoint", "peak", "hot_spring",
        ],
    },
    "services": {
        "id": "services",
        "name": "Services",
        "description": "Fuel, propane, water, dump stations, showers, laundry, groceries, and mechanics.",
        "categories": ["fuel", "propane", "water", "dump", "shower", "laundromat", "grocery", "mechanic"],
    },
    "outdoors": {
        "id": "outdoors",
        "name": "Outdoors",
        "description": "Trailheads, viewpoints, peaks, and hot springs.",
        "categories": ["trailhead", "viewpoint", "peak", "hot_spring"],
    },
    "camps": {
        "id": "camps",
        "name": "Camps",
        "description": "Downloaded campgrounds and campsites from official public sources plus OSM camp and caravan sites.",
        "categories": ["camp"],
    },
    "water": {
        "id": "water",
        "name": "Water Access",
        "description": "Boat ramps, paddle launches, marinas, docks, shore fishing access, water fill points, and mapped boating aids or hazards where source data exists.",
        "categories": ["water"],
    },
}

ALL_REGION_BBOXES = {**STATE_BBOXES, **REGION_BBOXES}

_status: dict[str, dict] = {}
_running = False
_batch: dict = {"running": False, "current": "", "completed": 0, "total": 0, "errors": []}

SMALLEST_FIRST_ORDER = [
    "RI", "DE", "CT", "HI", "NH", "VT", "MA", "NJ", "MD", "WV",
    "SC", "ME", "AL", "MS", "KY", "TN", "IN", "AR", "LA", "IA",
    "OH", "VA", "NC", "WI", "MO", "KS", "NE", "OK", "MN", "IL",
    "GA", "SD", "ND", "PA", "FL", "MI", "NY", "ID", "WA", "OR",
    "CO", "NM", "AZ", "UT", "NV", "WY", "MT", "AK", "CA", "TX",
]
SMALLEST_FIRST_RANK = {code.lower(): idx for idx, code in enumerate(SMALLEST_FIRST_ORDER)}


def pack_path(region: str, pack_id: str) -> Path:
    region = _region_id(region)
    pack_id = _pack_id(pack_id)
    return PLACE_PACK_DIR / f"{region}-{pack_id}.json"


def _region_id(region: str) -> str:
    return region.strip().lower()


def _pack_id(pack_id: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "-", pack_id.strip().lower()).strip("-") or "essentials"


def _bbox_for_region(region: str) -> tuple[float, float, float, float]:
    code = region.upper()
    if code in ALL_REGION_BBOXES:
        return ALL_REGION_BBOXES[code]
    raise ValueError(f"Unknown place pack region: {region}")


def _region_name(region: str) -> str:
    code = region.upper()
    if code == "KS":
        return "Kansas"
    if code == "CANADA":
        return "Canada"
    if code == "MEXICO":
        return "Mexico"
    if code == "FI":
        return "Finland"
    if code == "PK":
        return "Pakistan"
    return code


OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
OVERPASS = OVERPASS_URLS[0]
ZERO_OK_PACKS = {
    ("ct", "essentials"), ("ct", "services"), ("ct", "outdoors"),
    ("hi", "services"),
    ("nh", "services"),
    ("nj", "essentials"),
    ("ri", "outdoors"),
}
OFFICIAL_WATER_SOURCE_STATES = {
    "ak", "az", "ca", "co", "id", "mt", "nm", "nv", "or", "ut", "wa", "wy",
}


def _grid_samples(bbox: tuple[float, float, float, float], spacing_deg: float = 1.25) -> list[dict]:
    west, south, east, north = bbox
    samples: list[dict] = []
    lat = south + spacing_deg / 2
    while lat < north:
        lng = west + spacing_deg / 2
        while lng < east:
            samples.append({"lat": round(lat, 5), "lng": round(lng, 5)})
            lng += spacing_deg
        lat += spacing_deg
    # Include broad coverage around corners/center without relying only on grid.
    samples.extend([
        {"lat": round((south + north) / 2, 5), "lng": round((west + east) / 2, 5)},
        {"lat": round(south + 0.25, 5), "lng": round(west + 0.25, 5)},
        {"lat": round(north - 0.25, 5), "lng": round(east - 0.25, 5)},
    ])
    seen = set()
    out = []
    for sample in samples:
        key = (sample["lat"], sample["lng"])
        if key not in seen:
            seen.add(key)
            out.append(sample)
    return out


def _bbox_cells(bbox: tuple[float, float, float, float], step_deg: float = 1.5) -> list[tuple[float, float, float, float]]:
    west, south, east, north = bbox
    cells: list[tuple[float, float, float, float]] = []
    s = south
    while s < north:
        n = min(north, s + step_deg)
        w = west
        while w < east:
            e = min(east, w + step_deg)
            cells.append((w, s, e, n))
            w = e
        s = n
    return cells


def _cell_step_for_region(region: str) -> float:
    # CA/TX are dense enough that broad Overpass cells can time out or get throttled.
    if region in {"ca", "tx"}:
        return 0.75
    if region == "ak":
        return 1.5
    return 1.5


def _node_coord(el: dict) -> tuple[float, float] | None:
    if el.get("type") in {"way", "relation"}:
        center = el.get("center") or {}
        lat, lng = center.get("lat"), center.get("lon")
    else:
        lat, lng = el.get("lat"), el.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        return float(lat), float(lng)
    return None


def _classify_osm(el: dict) -> str | None:
    tags = el.get("tags") or {}
    if tags.get("tourism") in {"camp_site", "caravan_site", "camp_pitch", "alpine_hut", "wilderness_hut", "chalet", "guest_house", "hostel"}:
        return "camp"
    if tags.get("amenity") == "shelter" or tags.get("shelter_type") in {"basic_hut", "lean_to", "weather_shelter", "rock_shelter"}:
        return "camp"
    if tags.get("amenity") == "fuel":
        if tags.get("fuel:propane") == "yes" and tags.get("fuel:diesel") != "yes":
            return "propane"
        return "fuel"
    if tags.get("natural") == "spring" or tags.get("amenity") in {"drinking_water", "water_point"} or _water_access_subtype(tags):
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
    if tags.get("shop") in {"car_repair", "tyres"} or tags.get("craft") == "mechanic":
        return "mechanic"
    if tags.get("amenity") == "parking":
        return "parking"
    if tags.get("tourism") == "attraction":
        return "attraction"
    return None


WATER_NAVIGATION_SUBTYPES = {"navigation_aid", "channel_marker", "water_hazard", "anchorage", "lock"}


def _tag_text(tags: dict, *keys: str) -> str:
    for key in keys:
        value = tags.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def _pretty_token(value: object) -> str:
    text = str(value or "").replace("_", " ").replace(";", " / ").strip()
    return re.sub(r"\s+", " ", text).title()


def _float_value(value: object) -> float | None:
    if value in (None, ""):
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", str(value))
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _depth_ft(tags: dict) -> float | None:
    raw = _tag_text(
        tags,
        "depth",
        "seamark:depth",
        "seamark:rock:depth",
        "seamark:obstruction:depth",
        "seamark:wreck:depth",
    )
    value = _float_value(raw)
    if value is None:
        return None
    units = raw.lower()
    if "ft" in units or "feet" in units:
        return round(value, 1)
    return round(value * 3.28084, 1)


def _is_lake_of_the_woods(lat: float, lng: float, name: str = "") -> bool:
    text = name.lower()
    return (
        "lake of the woods" in text
        or "lac des bois" in text
        or (48.35 <= lat <= 49.55 and -95.65 <= lng <= -93.35)
    )


def _is_likely_canadian_water(lat: float, lng: float, name: str = "") -> bool:
    if _is_lake_of_the_woods(lat, lng, name):
        return True
    if -141.5 <= lng <= -52.0 and lat >= 49.0:
        return True
    if -67.5 <= lng <= -52.0 and lat >= 43.0:
        return True
    return False


def _official_chart_context(lat: float, lng: float, name: str = "") -> dict:
    if _is_likely_canadian_water(lat, lng, name):
        return {
            "chart_source": "CHS NONNA bathymetry (non-navigational) for Canadian waters; Lake of the Woods also has CHS chart 6201 official chart context.",
            "chart_url": "https://www.chs.gc.ca/data-gestion/nonna/index-eng.html",
            "safety_url": "https://tc.canada.ca/en/marine-transportation/marine-safety/boating-safety",
            "navigation_note": "NONNA bathymetry is not for navigation. Verify with official CHS charts, local markers, water levels, weather, and required safety gear before boating.",
        }
    return {
        "chart_source": "NOAA ENC chart layer where coverage exists; many inland waters may not have charted depth or hazard data.",
        "chart_url": "https://www.nauticalcharts.noaa.gov/charts/noaa-enc.html",
        "safety_url": "https://www.uscgboating.org/",
    }


def _water_navigation_subtype(tags: dict) -> str:
    seamark = str(tags.get("seamark:type") or "").lower().replace("-", "_")
    if seamark:
        if re.search(r"(rock|wreck|obstruction|shoal|reef|foul|hazard|seabed|depth_area)", seamark):
            return "water_hazard"
        if re.search(r"(fairway|recommended|route|track|traffic_separation|deep_water)", seamark):
            return "channel_marker"
        if re.search(r"(anchorage|mooring)", seamark):
            return "anchorage"
        if "lock" in seamark:
            return "lock"
        if re.search(r"(buoy|beacon|light|daymark|marker|signal|pile|post)", seamark):
            return "navigation_aid"
    hazard = " ".join(str(tags.get(k) or "").lower() for k in ("hazard", "seamark:hazard", "seamark:obstruction:category", "seamark:rock:water_level"))
    if re.search(r"(rock|rocks|shoal|submerged|obstruction|wreck|reef|danger|awash)", hazard):
        return "water_hazard"
    natural = str(tags.get("natural") or "").lower()
    if natural in {"reef", "shoal"}:
        return "water_hazard"
    waterway = str(tags.get("waterway") or "").lower()
    if waterway in {"lock_gate", "lock"} or str(tags.get("lock") or "").lower() == "yes":
        return "lock"
    if waterway in {"fairway"}:
        return "channel_marker"
    return ""


def _water_access_subtype(tags: dict) -> str:
    amenity = str(tags.get("amenity") or "").lower()
    leisure = str(tags.get("leisure") or "").lower()
    man_made = str(tags.get("man_made") or "").lower()
    waterway = str(tags.get("waterway") or "").lower()
    natural = str(tags.get("natural") or "").lower()
    tourism = str(tags.get("tourism") or "").lower()
    combo = " ".join(str(v).lower() for v in tags.values() if v)
    nav_subtype = _water_navigation_subtype(tags)
    if amenity in {"drinking_water", "water_point", "fountain"} or natural == "spring":
        return "spring" if natural == "spring" else "water_fill"
    if nav_subtype == "water_hazard":
        return nav_subtype
    if leisure == "slipway" or re.search(r"\b(boat\s*ramp|launch\s*ramp|slipway)\b", combo):
        return "boat_ramp"
    if str(tags.get("canoe") or "").lower() in {"yes", "designated", "put_in", "egress", "put_in;egress"} or re.search(r"\b(kayak|canoe|paddle|put[- ]?in|take[- ]?out)\b", combo):
        return "paddle_launch"
    if leisure == "marina" or amenity == "boat_rental" or "marina" in combo:
        return "marina"
    if man_made in {"pier"} or waterway in {"dock", "boatyard"} or "dock" in combo:
        return "dock"
    if tags.get("fishing") == "yes" or leisure == "fishing" or str(tags.get("sport") or "").lower() == "fishing":
        return "fishing_access"
    if tourism in {"beach"} or leisure in {"beach_resort", "swimming_area"} or str(tags.get("swimming") or "").lower() in {"yes", "designated"}:
        return "swimming"
    if waterway == "access_point" or re.search(r"\b(water access|river access|lake access|shore access|beach access)\b", combo):
        return "shore_access"
    if nav_subtype:
        return nav_subtype
    if str(tags.get("boat") or "").lower() in {"yes", "designated", "permissive"} or str(tags.get("motorboat") or "").lower() in {"yes", "designated", "permissive"}:
        return "shore_access"
    return ""


def _water_access_label(subtype: str) -> str:
    return {
        "water_fill": "Water fill",
        "spring": "Spring",
        "boat_ramp": "Boat ramp",
        "paddle_launch": "Paddle launch",
        "marina": "Marina",
        "dock": "Dock / pier",
        "fishing_access": "Fishing access",
        "swimming": "Swimming access",
        "shore_access": "Shore access",
        "gauge": "Water gauge",
        "navigation_aid": "Navigation aid",
        "channel_marker": "Channel / route marker",
        "water_hazard": "Water hazard",
        "anchorage": "Anchorage / mooring",
        "lock": "Lock / control structure",
    }.get(subtype, subtype.replace("_", " ").title() if subtype else "Water access")


def _water_access_access(tags: dict, text: str = "") -> str:
    access = str(tags.get("access") or "").lower()
    fee = str(tags.get("fee") or "").lower()
    if access in {"public", "yes", "designated", "permissive"}:
        return "fee" if fee == "yes" else "public"
    if fee == "yes":
        return "fee"
    if access in {"customers", "permit"}:
        return "permit"
    if re.search(r"\b(public|open to public)\b", text, re.I):
        return "public"
    if re.search(r"\b(fee|permit|reservation|day use pass)\b", text, re.I):
        return "fee"
    return "unknown"


def _water_access_craft(tags: dict, subtype: str, text: str = "") -> str:
    if subtype in WATER_NAVIGATION_SUBTYPES:
        return "boating context"
    if str(tags.get("motorboat") or "").lower() in {"yes", "designated", "permissive"} or re.search(r"\b(motorboat|motor boat|boat ramp|launch ramp)\b", text, re.I):
        return "motorboat"
    if str(tags.get("sailboat") or "").lower() in {"yes", "designated", "permissive"} or "sail" in text.lower():
        return "sail"
    if subtype == "paddle_launch" or str(tags.get("canoe") or "").lower() in {"yes", "designated", "put_in", "egress", "put_in;egress"} or re.search(r"\b(kayak|canoe|paddle)\b", text, re.I):
        return "paddle"
    if subtype in {"fishing_access", "shore_access", "dock", "swimming"}:
        return "shore"
    if subtype in {"boat_ramp", "marina"} or str(tags.get("boat") or "").lower() in {"yes", "designated", "permissive"}:
        return "motorboat"
    return "unknown"


def _water_fishing_score(tags: dict, subtype: str, access: str, official: bool = False) -> tuple[int, str]:
    score = 20
    if official:
        score += 20
    if subtype in {"fishing_access", "dock", "shore_access", "boat_ramp", "paddle_launch"}:
        score += 25
    if tags.get("fishing") == "yes" or str(tags.get("sport") or "").lower() == "fishing":
        score += 30
    if access in {"public", "fee", "permit"}:
        score += 15
    if any(tags.get(k) for k in ("species", "fish", "fish_species", "stocked")):
        score += 12
    score = max(0, min(score, 100))
    if score >= 70:
        label = "Strong evidence"
    elif score >= 50:
        label = "Good access"
    elif score >= 30:
        label = "Possible fishing"
    else:
        label = "Unverified"
    return score, label


def _waterbody_name(tags: dict, fallback: str = "") -> str:
    for key in ("waterbody", "waterbody_name", "water:name", "waterway:name", "lake:name", "river:name", "reservoir:name"):
        value = tags.get(key)
        if value:
            return str(value)
    return ""


def _water_navigation_metadata(tags: dict, subtype: str) -> dict:
    seamark = str(tags.get("seamark:type") or "").lower().replace("-", "_")
    feature = _water_access_label(subtype)
    if seamark:
        feature = _pretty_token(seamark)
    hazard = ""
    if subtype == "water_hazard":
        hazard = _pretty_token(
            _tag_text(tags, "seamark:obstruction:category", "seamark:wreck:category", "seamark:rock:water_level", "hazard", "natural")
            or seamark
            or "hazard"
        )
    mark_color = _pretty_token(
        _tag_text(
            tags,
            "seamark:buoy_lateral:colour",
            "seamark:buoy_cardinal:colour",
            "seamark:beacon_lateral:colour",
            "seamark:beacon_cardinal:colour",
            "seamark:light:colour",
            "colour",
        )
    )
    mark_shape = _pretty_token(
        _tag_text(
            tags,
            "seamark:buoy_lateral:shape",
            "seamark:buoy_cardinal:shape",
            "seamark:beacon_lateral:shape",
            "seamark:beacon_cardinal:shape",
            "seamark:topmark:shape",
            "shape",
        )
    )
    light = _tag_text(tags, "seamark:light:character", "seamark:light:colour", "seamark:light:range")
    note = (
        "Mapped boating aid or hazard from open seamark/source tags. Use it for awareness only; follow current official charts, local markers, water levels, and weather before entering shallow or rocky water."
        if subtype != "water_hazard"
        else "Mapped water hazard from open seamark/source tags. Treat as incomplete awareness only; verify rocks, shoals, wrecks, and safe channels on current official charts before boating."
    )
    meta = {
        "navigation_feature": feature,
        "hazard_type": hazard,
        "mark_color": mark_color,
        "mark_shape": mark_shape,
        "light_character": _pretty_token(light) if light else "",
        "depth_ft": _depth_ft(tags),
        "navigation_note": note,
    }
    return {k: v for k, v in meta.items() if v not in (None, "")}


def _water_access_metadata(tags: dict, name: str = "", *, official: bool = False) -> dict:
    subtype = _water_access_subtype(tags) or "shore_access"
    text = " ".join(str(v) for v in tags.values() if v)
    access = _water_access_access(tags, text)
    craft = _water_access_craft(tags, subtype, text)
    is_nav = subtype in WATER_NAVIGATION_SUBTYPES
    score, score_label = (None, "") if is_nav else _water_fishing_score(tags, subtype, access, official=official)
    waterbody = _waterbody_name(tags, name)
    tag_set = {"water_access", subtype}
    if is_nav:
        tag_set.update({"water_navigation", "boating", "safety"})
    if access != "unknown":
        tag_set.add(access)
    if craft != "unknown":
        tag_set.add(craft)
    if score is not None and score >= 50:
        tag_set.add("fishing")
    amenities = []
    if subtype in {"boat_ramp", "paddle_launch", "marina"}:
        amenities.append(_water_access_label(subtype))
    if tags.get("parking") == "yes" or "parking" in text.lower():
        amenities.append("Parking")
    if tags.get("toilets") == "yes" or "toilet" in text.lower():
        amenities.append("Restrooms")
    if tags.get("fee") == "yes":
        amenities.append("Fee area")
    if is_nav:
        amenities.insert(0, _water_access_label(subtype))
    meta = {
        "subtype": subtype,
        "tags": sorted(tag_set),
        "amenities": amenities[:12],
        "site_types": [_water_access_label(subtype)],
        "waterbody_name": waterbody,
        "waterbody_type": str(tags.get("water") or tags.get("waterway") or tags.get("natural") or ""),
        "access": access,
        "craft": craft,
        "fishing_score": score,
        "fishing_score_label": score_label,
        "fish_species": tags.get("species") or tags.get("fish") or tags.get("fish_species") or "",
        "stocking_notes": tags.get("stocked") or tags.get("stocking") or "",
        "regulations_url": tags.get("fishing:regulations") or tags.get("regulations") or "",
        "navigation_note": "Use this as access context only. Check current water levels, weather, hazards, closures, and official charts before boating.",
    }
    if is_nav:
        meta.update({
            "access": "chart context",
            "fishing_score": None,
            "fishing_score_label": "",
            "fish_species": "",
            "stocking_notes": "",
            "regulations_url": "",
        })
        meta.update(_water_navigation_metadata(tags, subtype))
    return meta


def _normalize_overpass_element(el: dict) -> dict | None:
    coord = _node_coord(el)
    ptype = _classify_osm(el)
    if not coord or not ptype:
        return None
    tags = el.get("tags") or {}
    lat, lng = coord
    if tags.get("access") in {"private", "no"}:
        return None
    name = (
        tags.get("name") or tags.get("brand") or tags.get("operator") or
        ("Natural Spring" if tags.get("natural") == "spring" else ptype.replace("_", " ").title())
    )
    fuel_types: list[str] = []
    if ptype in {"fuel", "propane"}:
        if tags.get("fuel:diesel") == "yes":
            fuel_types.append("diesel")
        if tags.get("fuel:propane") == "yes":
            fuel_types.append("propane")
        if tags.get("fuel:octane_87") == "yes" or not fuel_types:
            fuel_types.append("gas")
    amenities = []
    water_meta = _water_access_metadata(tags, str(name)) if ptype == "water" else {}
    chart_meta = _official_chart_context(lat, lng, str(water_meta.get("waterbody_name") or name)) if ptype == "water" else {}
    if ptype == "water" and str(name).strip().lower() in {"water", "mapped water", "water source"}:
        name = _water_access_label(str(water_meta.get("subtype") or "shore_access"))
    if ptype == "water" and str(name).strip().lower() in {"buoy", "beacon", "marker", "seamark"}:
        name = str(water_meta.get("navigation_feature") or _water_access_label(str(water_meta.get("subtype") or "navigation_aid")))
    if ptype == "camp":
        for key, label in (
            ("toilets", "Restrooms"),
            ("shower", "Showers"),
            ("drinking_water", "Water"),
            ("sanitary_dump_station", "Dump station"),
            ("electricity", "Electric"),
            ("internet_access", "WiFi"),
        ):
            if tags.get(key) in {"yes", "customers"}:
                amenities.append(label)
        raw_text = " ".join(str(tags.get(key) or "") for key in ("name", "operator", "description", "camp_site", "backcountry", "informal"))
        primitive = (
            tags.get("backcountry") == "yes"
            or tags.get("informal") == "yes"
            or tags.get("camp_site") in {"basic", "dispersed", "wild", "informal"}
            or re.search(r"\b(dispersed|primitive|boondock|backcountry)\b", raw_text, re.I) is not None
        )
        site_types = ["RV"] if tags.get("tourism") == "caravan_site" else ["Tent"]
        if primitive:
            site_types.append("Primitive")
        camp_tags = {tag.lower() for tag in site_types}
        camp_tags.add("rv" if tags.get("tourism") == "caravan_site" else "tent")
        if primitive:
            camp_tags.update({"primitive", "dispersed"})
        source_text = " ".join(str(tags.get(key) or "") for key in ("operator", "owner", "network", "description", "source"))
        if re.search(r"\b(blm|bureau of land management)\b", source_text, re.I):
            camp_tags.add("blm")
        if re.search(r"\b(usfs|forest service|national forest)\b", source_text, re.I):
            camp_tags.add("usfs")
        if re.search(r"\b(nps|national park)\b", source_text, re.I):
            camp_tags.add("nps")
        if re.search(r"\bstate park\b", source_text, re.I):
            camp_tags.add("state")
        camp_subtype = "RV/caravan site" if tags.get("tourism") == "caravan_site" else ("Primitive/dispersed camp" if primitive else "Tent camp")
        if str(name).strip().lower() in {"camp", "camp site", "camp_site"} or re.fullmatch(r"#?\d+", str(name).strip()):
            name = camp_subtype
    else:
        site_types = []
        camp_tags = set()
        camp_subtype = ""
    kind = el.get("type") or "node"
    return {
        "id": f"osm_{ptype}_{kind}_{el.get('id', '')}",
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": ptype,
        "category": ptype,
        "source": "osm",
        "subtype": camp_subtype if ptype == "camp" else water_meta.get("subtype") or tags.get("bath:type") or tags.get("tourism") or tags.get("shop") or tags.get("natural") or tags.get("amenity") or "",
        "address": ", ".join([v for v in [tags.get("addr:street"), tags.get("addr:city"), tags.get("addr:state")] if v]),
        "fuel_types": ", ".join(fuel_types),
        "elevation": tags.get("ele", ""),
        "official_url": tags.get("website") or tags.get("contact:website") or "",
        "booking_url": tags.get("reservation") if str(tags.get("reservation") or "").startswith("http") else "",
        "photo_url": "",
        "reservable": str(tags.get("reservation") or "").lower() in {"yes", "required"} or str(tags.get("reservation") or "").startswith("http"),
        "tags": water_meta.get("tags", sorted(camp_tags)),
        "amenities": water_meta.get("amenities", amenities),
        "site_types": water_meta.get("site_types", site_types),
        "source_badge": "OpenSeaMap / OSM" if ptype == "water" and water_meta.get("navigation_feature") else "OpenStreetMap",
        "source_freshness": (
            "OpenStreetMap/OpenSeaMap seamark data packaged by Trailhead; verify markers, hazards, depths, and routes on current official charts."
            if ptype == "water" and water_meta.get("navigation_feature")
            else "OpenStreetMap data packaged by Trailhead; verify fees, closures, and availability with the land manager."
        ),
        "last_checked": int(time.time()),
        **chart_meta,
        **{k: v for k, v in water_meta.items() if k not in {"subtype", "tags", "amenities", "site_types"}},
    }


def _failed_cell(cell: tuple[float, float, float, float], error: str) -> dict:
    west, south, east, north = cell
    return {
        "bbox": [round(west, 6), round(south, 6), round(east, 6), round(north, 6)],
        "error": error[:500],
    }


async def _post_overpass_json(query: str, *, user_agent: str, timeout_seconds: float = 45) -> tuple[dict, str, list[str]]:
    errors: list[str] = []
    timeout = httpx.Timeout(timeout_seconds, connect=6, read=timeout_seconds, write=10)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for url in OVERPASS_URLS:
            try:
                res = await client.post(url, data={"data": query}, headers={"User-Agent": user_agent})
                if res.status_code in {408, 429, 500, 502, 503, 504}:
                    errors.append(f"{url}: HTTP {res.status_code}")
                    continue
                res.raise_for_status()
                return res.json(), url, errors
            except Exception as exc:
                errors.append(f"{url}: {type(exc).__name__}: {exc}")
    raise RuntimeError("; ".join(errors[-4:]) or "Overpass unavailable")


async def _fetch_bbox_cell(cell: tuple[float, float, float, float], *, water_access: bool = False) -> dict:
    west, south, east, north = cell
    bbox = f"{south},{west},{north},{east}"
    water_access_query = f"""
  node["leisure"="slipway"]({bbox});
  way["leisure"="slipway"]({bbox});
  node["leisure"="marina"]({bbox});
  way["leisure"="marina"]({bbox});
  node["amenity"="boat_rental"]({bbox});
  way["amenity"="boat_rental"]({bbox});
  node["amenity"="ferry_terminal"]({bbox});
  way["amenity"="ferry_terminal"]({bbox});
  node["public_transport"="ferry_terminal"]({bbox});
  way["public_transport"="ferry_terminal"]({bbox});
  node["man_made"="pier"]({bbox});
  way["man_made"="pier"]({bbox});
  node["waterway"="dock"]({bbox});
  way["waterway"="dock"]({bbox});
  node["waterway"="access_point"]({bbox});
  way["waterway"="access_point"]({bbox});
  node["canoe"~"^(yes|designated|put_in|egress|put_in;egress)$"]({bbox});
  way["canoe"~"^(yes|designated|put_in|egress|put_in;egress)$"]({bbox});
  node["boat"~"^(yes|designated|permissive)$"]({bbox});
  way["boat"~"^(yes|designated|permissive)$"]({bbox});
  node["motorboat"~"^(yes|designated|permissive)$"]({bbox});
  way["motorboat"~"^(yes|designated|permissive)$"]({bbox});
  node["fishing"="yes"]({bbox});
  way["fishing"="yes"]({bbox});
  node["leisure"="fishing"]({bbox});
  way["leisure"="fishing"]({bbox});
  node["sport"="fishing"]({bbox});
  way["sport"="fishing"]({bbox});
  node["leisure"="swimming_area"]({bbox});
  way["leisure"="swimming_area"]({bbox});
  node["seamark:type"]({bbox});
  way["seamark:type"]({bbox});
  relation["seamark:type"]({bbox});
  node["natural"~"^(reef|shoal)$"]({bbox});
  way["natural"~"^(reef|shoal)$"]({bbox});
  node["hazard"~"rock|rocks|shoal|submerged|obstruction|wreck|reef|danger"]({bbox});
  way["hazard"~"rock|rocks|shoal|submerged|obstruction|wreck|reef|danger"]({bbox});
  node["waterway"~"^(lock_gate|lock|fairway)$"]({bbox});
  way["waterway"~"^(lock_gate|lock|fairway)$"]({bbox});
""" if water_access else ""
    if water_access:
        query = f"""[out:json][timeout:25];
(
  node["natural"="spring"]({bbox});
  node["amenity"="drinking_water"]({bbox});
  node["amenity"="water_point"]({bbox});
{water_access_query}
);
out body center 1800;
"""
    else:
        query = f"""[out:json][timeout:25];
(
  node["amenity"="fuel"]({bbox});
  way["amenity"="fuel"]({bbox});
  node["fuel:propane"="yes"]({bbox});
  way["fuel:propane"="yes"]({bbox});
  node["natural"="spring"]({bbox});
  node["amenity"="drinking_water"]({bbox});
  node["amenity"="water_point"]({bbox});
  node["amenity"="sanitary_dump_station"]({bbox});
  way["amenity"="sanitary_dump_station"]({bbox});
  node["sanitary_dump_station"="yes"]({bbox});
  way["sanitary_dump_station"="yes"]({bbox});
  node["amenity"="shower"]({bbox});
  node["shop"="laundry"]({bbox});
  node["tourism"~"hotel|motel|guest_house|hostel"]({bbox});
  way["tourism"~"hotel|motel|guest_house|hostel"]({bbox});
  node["amenity"~"restaurant|cafe|fast_food"]({bbox});
  node["shop"~"supermarket|convenience|general"]({bbox});
  node["shop"~"car_repair|tyres"]({bbox});
  way["shop"~"car_repair|tyres"]({bbox});
  node["craft"="mechanic"]({bbox});
  node["amenity"="parking"]({bbox});
  way["amenity"="parking"]({bbox});
  node["tourism"="attraction"]({bbox});
  way["tourism"="attraction"]({bbox});
  node["tourism"~"camp_site|caravan_site"]({bbox});
  way["tourism"~"camp_site|caravan_site"]({bbox});
  node["tourism"~"camp_pitch|alpine_hut|wilderness_hut|chalet|guest_house|hostel"]({bbox});
  way["tourism"~"camp_pitch|alpine_hut|wilderness_hut|chalet|guest_house|hostel"]({bbox});
  node["amenity"="shelter"]({bbox});
  way["amenity"="shelter"]({bbox});
  node["shelter_type"~"basic_hut|lean_to|weather_shelter|rock_shelter"]({bbox});
  way["shelter_type"~"basic_hut|lean_to|weather_shelter|rock_shelter"]({bbox});
  node["highway"="trailhead"]({bbox});
  node["trailhead"="yes"]({bbox});
  node["tourism"="viewpoint"]({bbox});
  way["tourism"="viewpoint"]({bbox});
  node["natural"="peak"]["name"]({bbox});
  node["natural"="hot_spring"]({bbox});
  way["natural"="hot_spring"]({bbox});
  node["amenity"="public_bath"]["bath:type"="hot_spring"]({bbox});
  way["amenity"="public_bath"]["bath:type"="hot_spring"]({bbox});
{water_access_query}
);
out body center 1800;
"""
    elements = []
    try:
        payload, _endpoint, _errors = await _post_overpass_json(
            query,
            user_agent="Trailhead/1.0 (offline place pack builder)",
            timeout_seconds=45,
        )
        elements = payload.get("elements") or []
    except Exception as exc:
        return {"points": [], "failed_cell": _failed_cell(cell, f"{type(exc).__name__}: {exc}")}
    points = []
    for el in elements:
        point = _normalize_overpass_element(el)
        if point:
            points.append(point)
    return {"points": points, "failed_cell": None}


def _normalize_camp_source(item: dict) -> dict | None:
    lat, lng = item.get("lat"), item.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    source = str(item.get("source") or item.get("verified_source") or "camp").lower()
    source_badge = item.get("source_badge") or item.get("verified_source") or item.get("source_label") or source.upper()
    official_url = item.get("official_url") or item.get("url") or item.get("website") or ""
    booking_url = item.get("booking_url") or (official_url if "recreation.gov" in str(official_url) else "")
    return {
        "id": str(item.get("id") or f"{source}_camp_{float(lat):.5f}_{float(lng):.5f}"),
        "name": str(item.get("name") or "Camp"),
        "lat": float(lat),
        "lng": float(lng),
        "type": "camp",
        "category": "camp",
        "source": source,
        "subtype": item.get("land_type") or item.get("subtype") or "",
        "address": item.get("address") or "",
        "fuel_types": "",
        "elevation": item.get("elevation") or "",
        "official_url": official_url,
        "booking_url": booking_url,
        "photo_url": item.get("photo_url") or "",
        "reservable": bool(item.get("reservable")),
        "tags": item.get("tags") if isinstance(item.get("tags"), list) else [],
        "amenities": item.get("amenities") if isinstance(item.get("amenities"), list) else [],
        "site_types": item.get("site_types") if isinstance(item.get("site_types"), list) else [],
        "source_badge": source_badge,
        "source_freshness": item.get("source_freshness") or "Camp source data packaged by Trailhead; verify current access, fees, closures, and availability with the source.",
        "last_checked": int(item.get("last_checked") or time.time()),
    }


async def _fetch_official_camp_cell(cell: tuple[float, float, float, float]) -> dict:
    west, south, east, north = cell
    lat = (south + north) / 2
    lng = (west + east) / 2
    radius_miles = max(12, min(80, max(abs(north - south), abs(east - west)) * 69 * 0.9))
    tasks = [
        get_campsites_search(lat, lng, radius_miles=radius_miles),
        get_blm_campsites(lat, lng, radius_miles=radius_miles),
        get_usfs_recreation_sites(lat, lng, radius_miles=radius_miles, categories={"camp", "camping"}),
    ]
    if nps_enabled():
        tasks.append(get_nps_places(lat, lng, radius_m=int(radius_miles * 1609.344), categories={"camp", "camping"}, limit=80))
    batches = await asyncio.gather(*tasks, return_exceptions=True)
    points: list[dict] = []
    for batch in batches:
        if not isinstance(batch, list):
            continue
        for item in batch:
            if str(item.get("type") or "camp").lower() not in {"camp", "federal_camp"} and "camp" not in str(item.get("category") or "").lower():
                continue
            normalized = _normalize_camp_source(item)
            if normalized:
                points.append(normalized)
    return {"points": points, "failed_cell": None}


PAKISTAN_CAMP_ANCHORS = (
    ("K2 / Concordia", 35.8808, 76.5158),
    ("Askole", 35.6806, 75.8178),
    ("Skardu", 35.2971, 75.6333),
    ("Hunza", 36.3167, 74.6500),
    ("Upper Hunza / Passu", 36.4828, 74.8825),
    ("Fairy Meadows / Nanga Parbat", 35.3525, 74.5774),
    ("Khaplu / Hushe", 35.4519, 76.3582),
)


async def _build_pakistan_camp_pack() -> Path:
    region = "pk"
    pack_id = "camps"
    key = f"{region}:{pack_id}"
    _status[key] = {
        "status": "building",
        "progress": f"0/{len(PAKISTAN_CAMP_ANCHORS)} corridors",
        "error": None,
        "size_bytes": 0,
        "failed_cells": [],
        "failed_cell_count": 0,
    }
    points: list[dict] = []
    failed_cells: list[dict] = []
    seen: set[str] = set()

    def add_items(items: list[dict]) -> None:
        for item in items:
            normalized = _normalize_camp_source(item)
            if not normalized:
                continue
            normalized["source_freshness"] = item.get("source_freshness") or "Pakistan mountain stay data packaged by Trailhead; verify permits, access, guide requirements, safety, and current local conditions."
            normalized["tags"] = sorted(set([*(normalized.get("tags") or []), "pakistan", "trekking"]))
            point_key = normalized.get("id") or f"{normalized.get('name')}:{normalized.get('lat'):.4f}:{normalized.get('lng'):.4f}"
            if point_key in seen:
                continue
            seen.add(point_key)
            points.append(normalized)

    completed = 0
    for label, lat, lng in PAKISTAN_CAMP_ANCHORS:
        try:
            add_items(get_pakistan_curated_stays(lat, lng, radius_miles=65))
            live = await asyncio.wait_for(get_osm_outdoor_stays(lat, lng, radius_m=80_000, profile="pakistan_karakoram"), timeout=28)
            add_items(live)
        except Exception as exc:
            failed_cells.append({"label": label, "lat": lat, "lng": lng, "error": f"{type(exc).__name__}: {exc}"})
        completed += 1
        _status[key]["progress"] = f"{completed}/{len(PAKISTAN_CAMP_ANCHORS)} corridors"
        _status[key]["failed_cells"] = failed_cells
        _status[key]["failed_cell_count"] = len(failed_cells)

    points.sort(key=lambda p: (str(p.get("name", "")), float(p.get("lat") or 0), float(p.get("lng") or 0)))
    if not points:
        raise RuntimeError("pk:camps returned 0 places")
    payload = {
        "schema_version": 1,
        "pack_id": "pk-camps",
        "region_id": "pk",
        "region_name": "Pakistan",
        "name": "Pakistan Camps",
        "generated_at": int(time.time()),
        "source": "Trailhead curated + OpenStreetMap mixed outdoor stay data",
        "categories": PACK_DEFINITIONS[pack_id]["categories"],
        "failed_cells": failed_cells,
        "failed_cell_count": len(failed_cells),
        "points": points,
    }
    path = pack_path(region, pack_id)
    path.write_text(json.dumps(payload, separators=(",", ":")))
    _status[key].update(
        status="built",
        progress=f"built · {len(points)} places" + (f" · {len(failed_cells)} failed corridors" if failed_cells else ""),
        size_bytes=path.stat().st_size,
        point_count=len(points),
        failed_cells=failed_cells,
        failed_cell_count=len(failed_cells),
    )
    return path


def _water_subtype_from_text(*values: object) -> str:
    text = " ".join(str(v or "").lower() for v in values)
    if re.search(r"\b(boat\s*ramp|launch\s*ramp|boat launch|slipway)\b", text):
        return "boat_ramp"
    if re.search(r"\b(kayak|canoe|paddle|put[- ]?in|take[- ]?out)\b", text):
        return "paddle_launch"
    if "marina" in text:
        return "marina"
    if re.search(r"\b(dock|pier)\b", text):
        return "dock"
    if "fish" in text:
        return "fishing_access"
    if re.search(r"\b(beach|swim)\b", text):
        return "swimming"
    if re.search(r"\b(water access|river access|lake access|shore access)\b", text):
        return "shore_access"
    return "shore_access"


def _normalize_water_source(item: dict) -> dict | None:
    lat, lng = item.get("lat"), item.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    source = str(item.get("source") or item.get("verified_source") or "official").lower()
    source_badge = item.get("source_badge") or item.get("verified_source") or item.get("source_label") or source.upper()
    subtype = item.get("subtype") or _water_subtype_from_text(
        item.get("name"),
        item.get("description"),
        item.get("summary"),
        item.get("land_type"),
        " ".join(item.get("amenities") or []),
        " ".join(item.get("activities") or []),
    )
    tags = {
        "water_access",
        str(subtype),
        source.replace("official ", "").replace(" ", "_"),
    }
    text = " ".join(str(v or "") for v in [
        item.get("name"), item.get("description"), item.get("summary"), item.get("land_type"), item.get("source_label")
    ])
    access = "public" if source in {"blm", "usfs", "nps", "ridb", "recreation.gov"} else _water_access_access({}, text)
    craft = _water_access_craft({}, str(subtype), text)
    score, score_label = _water_fishing_score({}, str(subtype), access, official=True)
    chart_meta = _official_chart_context(float(lat), float(lng), str(item.get("waterbody_name") or item.get("name") or ""))
    return {
        "id": str(item.get("id") or f"{source}_water_{float(lat):.5f}_{float(lng):.5f}"),
        "name": str(item.get("name") or _water_access_label(str(subtype))),
        "lat": float(lat),
        "lng": float(lng),
        "type": "water",
        "category": "water",
        "source": source,
        "subtype": str(subtype),
        "address": item.get("address") or "",
        "fuel_types": "",
        "elevation": item.get("elevation") or "",
        "official_url": item.get("official_url") or item.get("url") or item.get("website") or "",
        "booking_url": "",
        "photo_url": item.get("photo_url") or "",
        "reservable": False,
        "tags": sorted(tags),
        "amenities": item.get("amenities") if isinstance(item.get("amenities"), list) else [_water_access_label(str(subtype))],
        "site_types": [_water_access_label(str(subtype))],
        "source_badge": source_badge,
        "source_freshness": item.get("source_freshness") or "Official/open water access data packaged by Trailhead; verify closures, fees, water levels, and local rules with the source.",
        "last_checked": int(item.get("last_checked") or time.time()),
        "waterbody_name": item.get("waterbody_name") or "",
        "waterbody_type": item.get("waterbody_type") or "",
        "access": access,
        "craft": craft,
        "fishing_score": score,
        "fishing_score_label": score_label,
        "fish_species": item.get("fish_species") or "",
        "stocking_notes": item.get("stocking_notes") or "",
        "regulations_url": item.get("regulations_url") or "",
        "navigation_note": "Use this as access context only. Check current water levels, weather, hazards, closures, and official charts before boating.",
        **chart_meta,
    }


async def _fetch_official_water_cell(cell: tuple[float, float, float, float]) -> dict:
    west, south, east, north = cell
    lat = (south + north) / 2
    lng = (west + east) / 2
    radius_miles = max(12, min(80, max(abs(north - south), abs(east - west)) * 69 * 0.9))
    batches = await asyncio.gather(
        get_blm_recreation_sites(lat, lng, radius_miles=radius_miles, categories={"water"}),
        get_usfs_recreation_sites(lat, lng, radius_miles=radius_miles, categories={"water"}),
        return_exceptions=True,
    )
    points: list[dict] = []
    for batch in batches:
        if not isinstance(batch, list):
            continue
        for item in batch:
            if str(item.get("type") or "").lower() != "water":
                continue
            normalized = _normalize_water_source(item)
            if normalized:
                points.append(normalized)
    return {"points": points, "failed_cell": None}


def _normalize_pack_point(item: dict, category: str) -> dict | None:
    lat, lng = item.get("lat"), item.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    ptype = str(item.get("type") or category or "poi")
    return {
        "id": str(item.get("id") or f"{ptype}_{lat:.5f}_{lng:.5f}"),
        "name": str(item.get("name") or ptype.replace("_", " ").title()),
        "lat": float(lat),
        "lng": float(lng),
        "type": ptype,
        "category": ptype,
        "source": str(item.get("source") or "osm"),
        "subtype": item.get("subtype") or "",
        "address": item.get("address") or "",
        "fuel_types": item.get("fuel_types") or "",
        "elevation": item.get("elevation") or "",
    }


def status() -> dict:
    out = {}
    for key, data in _status.items():
        region, pack_id = key.split(":", 1)
        path = pack_path(region, pack_id)
        out[key] = {
            **data,
            "on_disk": path.exists(),
            "size_bytes": path.stat().st_size if path.exists() else data.get("size_bytes", 0),
        }
    return {"running": _running, "batch": _batch, "packs": out}


def ordered_regions(regions: list[str] | None = None) -> list[str]:
    targets = [r.lower() for r in (regions or STATE_BBOXES.keys()) if r.upper() in ALL_REGION_BBOXES]
    return sorted(targets, key=lambda r: SMALLEST_FIRST_RANK.get(r, 999))


async def build_region_pack(region: str, pack_id: str = "essentials") -> Path | None:
    region = _region_id(region)
    pack_id = _pack_id(pack_id)
    if pack_id not in PACK_DEFINITIONS:
        raise ValueError(f"Unknown place pack: {pack_id}")
    if region == "pk" and pack_id == "camps":
        return await _build_pakistan_camp_pack()
    bbox = _bbox_for_region(region)
    key = f"{region}:{pack_id}"
    cells = _bbox_cells(bbox, _cell_step_for_region(region))
    _status[key] = {
        "status": "building",
        "progress": f"0/{len(cells)} cells",
        "error": None,
        "size_bytes": 0,
        "failed_cells": [],
        "failed_cell_count": 0,
    }
    semaphore = asyncio.Semaphore(1 if region in {"ca", "tx"} else 2)
    points: list[dict] = []
    failed_cells: list[dict] = []
    seen = set()
    completed = 0

    async def run_cell(cell: tuple[float, float, float, float]) -> dict:
        async with semaphore:
            try:
                result = await _fetch_bbox_cell(cell, water_access=pack_id == "water")
                if pack_id == "camps":
                    official = await _fetch_official_camp_cell(cell)
                    result["points"] = [*(result.get("points") or []), *(official.get("points") or [])]
                if pack_id == "water" and region in OFFICIAL_WATER_SOURCE_STATES:
                    official = await asyncio.wait_for(_fetch_official_water_cell(cell), timeout=18)
                    result["points"] = [*(result.get("points") or []), *(official.get("points") or [])]
                return result
            except Exception as exc:
                return {"points": [], "failed_cell": _failed_cell(cell, f"{type(exc).__name__}: {exc}")}

    tasks = [asyncio.create_task(run_cell(cell)) for cell in cells]
    for task in asyncio.as_completed(tasks):
        result = await task
        completed += 1
        _status[key]["progress"] = f"{completed}/{len(cells)} cells"
        failed_cell = result.get("failed_cell")
        if failed_cell:
            failed_cells.append(failed_cell)
            _status[key]["failed_cells"] = failed_cells
            _status[key]["failed_cell_count"] = len(failed_cells)
        for point in result.get("points") or []:
            point_key = point.get("id") or f"{point.get('type')}:{point.get('lat'):.4f}:{point.get('lng'):.4f}"
            if point_key in seen:
                continue
            seen.add(point_key)
            points.append(point)

    priority = {"fuel": 0, "water": 1, "hot_spring": 2, "trailhead": 3, "viewpoint": 4, "peak": 5}
    subtype_priority = {
        "boat_ramp": 0,
        "paddle_launch": 1,
        "marina": 2,
        "dock": 3,
        "fishing_access": 4,
        "navigation_aid": 5,
        "channel_marker": 6,
        "water_hazard": 7,
        "anchorage": 8,
        "lock": 9,
        "shore_access": 10,
        "swimming": 11,
        "water_fill": 12,
        "spring": 13,
    }
    allowed_categories = set(PACK_DEFINITIONS[pack_id]["categories"])
    points = [p for p in points if str(p.get("type") or p.get("category")) in allowed_categories]
    points.sort(key=lambda p: (priority.get(str(p.get("type")), 9), subtype_priority.get(str(p.get("subtype") or ""), 99), str(p.get("name", ""))))
    if not points and (region, pack_id) not in ZERO_OK_PACKS:
        existing = pack_path(region, pack_id)
        existing_count = 0
        if existing.exists():
            try:
                existing_count = len((json.loads(existing.read_text()).get("points") or []))
            except Exception:
                existing_count = 0
        if existing.exists() and existing_count > 0:
            _status[key].update(
                status="error",
                progress="0 places returned; kept existing pack",
                error="Overpass returned no usable places",
                size_bytes=existing.stat().st_size,
                point_count=existing_count,
                failed_cells=failed_cells,
                failed_cell_count=len(failed_cells),
            )
            return existing
        raise RuntimeError(f"{region}:{pack_id} returned 0 places")
    payload = {
        "schema_version": 1,
        "pack_id": f"{region}-{pack_id}",
        "region_id": region,
        "region_name": _region_name(region),
        "name": f"{_region_name(region)} {PACK_DEFINITIONS[pack_id]['name']}",
        "generated_at": int(time.time()),
        "source": "OpenStreetMap" if pack_id != "water" else "OpenStreetMap + OpenSeaMap seamark tags + official public water access sources",
        "categories": PACK_DEFINITIONS[pack_id]["categories"],
        "failed_cells": failed_cells,
        "failed_cell_count": len(failed_cells),
        "points": points,
    }
    path = pack_path(region, pack_id)
    path.write_text(json.dumps(payload, separators=(",", ":")))
    _status[key].update(
        status="built",
        progress=f"built · {len(points)} places" + (f" · {len(failed_cells)} failed cells" if failed_cells else ""),
        size_bytes=path.stat().st_size,
        point_count=len(points),
        failed_cells=failed_cells,
        failed_cell_count=len(failed_cells),
    )
    return path


async def upload_pack_to_r2(region: str, pack_id: str = "essentials") -> bool:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    region = _region_id(region)
    pack_id = _pack_id(pack_id)
    key = f"{region}:{pack_id}"
    path = pack_path(region, pack_id)
    if not path.exists():
        _status.setdefault(key, {}).update(status="error", error="place pack file not found")
        return False
    _status.setdefault(key, {}).update(status="uploading", progress="uploading")
    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        await asyncio.to_thread(
            r2.put_object,
            Bucket=settings.r2_bucket,
            Key=f"places/{region}-{pack_id}.json",
            Body=path.read_bytes(),
            ContentType="application/json",
        )
        failed_count = int(_status.get(key, {}).get("failed_cell_count") or 0)
        _status[key].update(
            status="done",
            progress="uploaded" + (f" · {failed_count} failed cells" if failed_count else ""),
            size_bytes=path.stat().st_size,
        )
        await update_manifest_on_r2()
        return True
    except Exception as exc:
        _status[key].update(status="error", error=f"{type(exc).__name__}: {exc}")
        return False


async def update_manifest_on_r2() -> bool:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        manifest: dict[str, dict] = {"definitions": PACK_DEFINITIONS, "packs": {}}
        listed_keys: set[str] = set()
        token = None
        while True:
            kwargs = {"Bucket": settings.r2_bucket, "Prefix": "places/"}
            if token:
                kwargs["ContinuationToken"] = token
            page = await asyncio.to_thread(r2.list_objects_v2, **kwargs)
            for item in page.get("Contents") or []:
                key = item.get("Key") or ""
                if key == "places/manifest.json" or not key.endswith(".json"):
                    continue
                name = key.rsplit("/", 1)[-1]
                stem = name[:-5]
                if "-" not in stem:
                    continue
                region, pack_id = stem.split("-", 1)
                if pack_id not in PACK_DEFINITIONS:
                    continue
                listed_keys.add(name)
                point_count = 0
                failed_cells: list[dict] = []
                size = int(item.get("Size") or 0)
                try:
                    obj = await asyncio.to_thread(r2.get_object, Bucket=settings.r2_bucket, Key=key)
                    body = await asyncio.to_thread(obj["Body"].read)
                    payload = json.loads(body.decode())
                    point_count = len(payload.get("points") or [])
                    failed_cells = payload.get("failed_cells") or []
                except Exception:
                    pass
                manifest["packs"][name] = {
                    "region_id": region,
                    "pack_id": pack_id,
                    "size": size,
                    "point_count": point_count,
                    "failed_cell_count": len(failed_cells),
                    "failed_cells": failed_cells,
                    "url": f"/api/places/packs/{region}/{pack_id}",
                }
            if not page.get("IsTruncated"):
                break
            token = page.get("NextContinuationToken")

        # Include freshly generated local files when the pack has not reached R2 yet.
        for path in PLACE_PACK_DIR.glob("*.json"):
            name = path.name
            if name in listed_keys:
                continue
            stem = path.stem
            if "-" not in stem:
                continue
            region, pack_id = stem.split("-", 1)
            if pack_id not in PACK_DEFINITIONS:
                continue
            try:
                payload = json.loads(path.read_text())
                point_count = len(payload.get("points") or [])
                failed_cells = payload.get("failed_cells") or []
            except Exception:
                point_count = 0
                failed_cells = []
            manifest["packs"][name] = {
                "region_id": region,
                "pack_id": pack_id,
                "size": path.stat().st_size,
                "point_count": point_count,
                "failed_cell_count": len(failed_cells),
                "failed_cells": failed_cells,
                "url": f"/api/places/packs/{region}/{pack_id}",
            }

        await asyncio.to_thread(
            r2.put_object,
            Bucket=settings.r2_bucket,
            Key="places/manifest.json",
            Body=json.dumps(manifest).encode(),
            ContentType="application/json",
        )
        return True
    except Exception:
        return False


async def remote_manifest() -> dict:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        obj = await asyncio.to_thread(r2.get_object, Bucket=settings.r2_bucket, Key="places/manifest.json")
        body = await asyncio.to_thread(obj["Body"].read)
        return json.loads(body.decode())
    except Exception:
        return {"definitions": PACK_DEFINITIONS, "packs": {}}


async def fetch_remote_pack(region: str, pack_id: str = "essentials") -> dict | None:
    import boto3
    from botocore.config import Config
    from config.settings import settings

    region = _region_id(region)
    pack_id = _pack_id(pack_id)
    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        obj = await asyncio.to_thread(
            r2.get_object,
            Bucket=settings.r2_bucket,
            Key=f"places/{region}-{pack_id}.json",
        )
        body = await asyncio.to_thread(obj["Body"].read)
        return json.loads(body.decode())
    except Exception:
        path = pack_path(region, pack_id)
        if path.exists():
            return json.loads(path.read_text())
    return None


async def build_and_upload(region: str, pack_id: str = "essentials") -> bool:
    global _running
    if _running:
        return False
    _running = True
    try:
        path = await build_region_pack(region, pack_id)
        if not path:
            return False
        return await upload_pack_to_r2(region, pack_id)
    finally:
        _running = False


async def build_all_task(regions: list[str] | None = None, pack_ids: list[str] | None = None, *, skip_existing: bool = True) -> None:
    global _running
    if _running:
        return
    selected_regions = ordered_regions(regions)
    selected_packs = [_pack_id(p) for p in (pack_ids or list(PACK_DEFINITIONS.keys())) if _pack_id(p) in PACK_DEFINITIONS]
    targets = [(region, pack_id) for region in selected_regions for pack_id in selected_packs]
    _running = True
    _batch.update(running=True, current="", completed=0, total=len(targets), errors=[])
    try:
        for region, pack_id in targets:
            _batch["current"] = f"{region}:{pack_id}"
            if skip_existing and pack_path(region, pack_id).exists():
                _status.setdefault(f"{region}:{pack_id}", {}).update(status="done", progress="already on disk")
                _batch["completed"] += 1
                continue
            try:
                path = await build_region_pack(region, pack_id)
                if not path:
                    _batch["errors"].append(f"{region}:{pack_id}: build failed")
                    continue
                ok = await upload_pack_to_r2(region, pack_id)
                if not ok:
                    _batch["errors"].append(f"{region}:{pack_id}: upload failed")
            except Exception as exc:
                _batch["errors"].append(f"{region}:{pack_id}: {type(exc).__name__}: {exc}")
            finally:
                _batch["completed"] += 1
        await update_manifest_on_r2()
    finally:
        _batch["running"] = False
        _batch["current"] = ""
        _running = False
