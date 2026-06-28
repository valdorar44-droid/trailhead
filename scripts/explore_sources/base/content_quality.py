from __future__ import annotations

import math
import re
from copy import deepcopy
from typing import Any

from .normalize import compact_text


GENERIC_COPY_PATTERNS = (
    re.compile(r"\bmay refer to\b", re.I),
    re.compile(r"\b(disambiguation|wikimedia|wikidata)\b", re.I),
    re.compile(r"\b(undefined|null|nan)\b", re.I),
    re.compile(r"^\s*(lake|mountain|waterfall|glacier|island|hill|volcano|national park|former national park|marine reserve|animal sanctuary|locality|river|peak)\s+(in|on|near|of)\s+[^.]{1,80}\.?\s*$", re.I),
    re.compile(r"^\s*(mountain|waterfall|glacier|lake|peak|park|trail|campground|historic site|protected area)\s*$", re.I),
)

CATEGORY_COPY: dict[str, str] = {
    "camp": "Use {title} to compare overnight options around {region}. Check reservations, access roads, fees, fire rules, closures, and current conditions before you rely on it.",
    "campground": "Use {title} to compare overnight options around {region}. Check reservations, access roads, fees, fire rules, closures, and current conditions before you rely on it.",
    "dispersed_camp": "Use {title} as a camping research area around {region}. Verify legal overnight limits, land rules, road access, fire restrictions, and current closures.",
    "glamping": "{title} is a comfort-focused outdoor stay near {region}. Check booking rules, road access, check-in details, fees, and seasonal availability.",
    "hut": "{title} is a shelter or hut option near {region}. Check reservations, condition, access, weather, and seasonal rules before planning around it.",
    "trail": "{title} is a mapped trail area near {region}. Check distance, difficulty, route type, weather, daylight, permits, closures, and navigation before starting.",
    "trailhead": "{title} is a mapped trail access point near {region}. Confirm parking, road access, closures, daylight, and route details before starting.",
    "viewpoint": "{title} is a scenic stop near {region}. Check road access, weather, daylight, parking, and nearby trail options before routing there.",
    "peak": "{title} is a mountain landmark near {region}. Use it for route context, weather checks, access research, and nearby trail planning.",
    "waterfall": "{title} is a waterfall or cascade near {region}. Check trail access, seasonal flow, closures, water levels, and slippery terrain before visiting.",
    "lake": "{title} is a water stop near {region}. Verify access, seasonal conditions, water safety, local rules, and nearby services before planning around it.",
    "water": "{title} is a water or scenic stop near {region}. Verify access, seasonal conditions, safety, local rules, and nearby services before planning around it.",
    "hot_spring": "{title} is a thermal feature near {region}. Verify legality, access, temperature, water safety, and local rules before visiting.",
    "glacier": "{title} is a glacier or alpine landmark near {region}. Check access, weather, route conditions, guide requirements, permits, and seasonal risk.",
    "park": "{title} is a managed outdoor area near {region}. Check official access, fees, closures, permits, weather, and nearby services before committing dates.",
    "public_land": "{title} is a public-land or protected-area context near {region}. Verify land rules, camping limits, access roads, closures, and current restrictions.",
    "forest": "{title} is a forest or ranger-district context near {region}. Verify road access, fire restrictions, seasonal closures, and land-use rules.",
    "climbing_area": "{title} is a climbing area near {region}. Check access, closures, route information, land-manager rules, gear needs, and current conditions.",
    "bouldering_area": "{title} is a bouldering area near {region}. Check access, closures, landing conditions, pads, route information, local rules, and current conditions.",
    "historic_site": "{title} is a historic or cultural stop near {region}. Check access, hours, preservation rules, weather, and nearby route context before visiting.",
    "monument": "{title} is a landmark near {region}. Check access, hours, preservation rules, weather, and nearby route context before visiting.",
    "fuel": "{title} is a service stop near {region}. Verify hours, fuel availability, payment options, road access, and backup stops before depending on it.",
    "resupply": "{title} is a resupply stop near {region}. Verify hours, inventory, payment options, road access, and backup stops before depending on it.",
}

GROUP_CATEGORY_HINTS = (
    ("camp", "campground"),
    ("glamp", "glamping"),
    ("hut", "hut"),
    ("cabin", "hut"),
    ("lodg", "hut"),
    ("trailhead", "trailhead"),
    ("trail", "trail"),
    ("waterfall", "waterfall"),
    ("lake", "lake"),
    ("water", "water"),
    ("spring", "hot_spring"),
    ("peak", "peak"),
    ("mountain", "peak"),
    ("view", "viewpoint"),
    ("overlook", "viewpoint"),
    ("climb", "climbing_area"),
    ("park", "park"),
    ("monument", "monument"),
    ("historic", "historic_site"),
    ("land", "public_land"),
    ("forest", "forest"),
    ("fuel", "fuel"),
    ("resupply", "resupply"),
)

SOURCE_PACK_LIST_KEYS = (
    "things_to_do",
    "things_to_see",
    "visitor_centers",
    "campgrounds",
    "campgrounds_nearby",
    "trip_services",
    "parking_lots",
    "trails",
    "events",
)


def valid_lat_lng(lat: Any, lng: Any) -> bool:
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except Exception:
        return False
    return math.isfinite(lat_f) and math.isfinite(lng_f) and -90 <= lat_f <= 90 and -180 <= lng_f <= 180


def distance_mi(lat1: Any, lng1: Any, lat2: Any, lng2: Any) -> float | None:
    if not valid_lat_lng(lat1, lng1) or not valid_lat_lng(lat2, lng2):
        return None
    lat1_f = float(lat1)
    lng1_f = float(lng1)
    lat2_f = float(lat2)
    lng2_f = float(lng2)
    radius_mi = 3958.7613
    phi1 = math.radians(lat1_f)
    phi2 = math.radians(lat2_f)
    d_phi = math.radians(lat2_f - lat1_f)
    d_lam = math.radians(lng2_f - lng1_f)
    h = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return 2 * radius_mi * math.asin(min(1.0, math.sqrt(h)))


def category_key(category: Any = "", group: Any = "", title: Any = "") -> str:
    hay = " ".join(compact_text(value).lower().replace("&", "and").replace("_", " ") for value in (category, group, title))
    for needle, key in GROUP_CATEGORY_HINTS:
        if needle in hay:
            return key
    return compact_text(category).lower().replace(" ", "_") or "park"


def is_weak_description(text: Any, *, title: Any = "", category: Any = "", group: Any = "") -> bool:
    clean = compact_text(text)
    if not clean:
        return True
    if len(clean) < 58:
        return True
    if any(pattern.search(clean) for pattern in GENERIC_COPY_PATTERNS):
        return True
    title_text = compact_text(title)
    if title_text and clean.lower() in {title_text.lower(), f"{title_text.lower()}."}:
        return True
    key = category_key(category, group, title)
    if key in {"peak", "lake", "glacier", "waterfall", "park"} and len(clean) < 92 and re.search(r"\b(in|on|of|near)\b", clean, re.I):
        return True
    return False


def fallback_description(*, title: Any, category: Any = "", group: Any = "", region: Any = "") -> str:
    clean_title = compact_text(title) or "This stop"
    clean_region = compact_text(region) or "the area"
    key = category_key(category, group, clean_title)
    template = CATEGORY_COPY.get(key) or CATEGORY_COPY["park"]
    return template.format(title=clean_title, region=clean_region)


def clean_description(text: Any, *, title: Any, category: Any = "", group: Any = "", region: Any = "") -> str:
    clean = compact_text(text)
    if is_weak_description(clean, title=title, category=category, group=group):
        return fallback_description(title=title, category=category, group=group, region=region)
    return clean


def map_child_radius_mi(category: Any = "", group: Any = "") -> float:
    key = category_key(category, group)
    if key in {"park", "public_land", "forest", "glacier"}:
        return 90.0
    if key in {"campground", "camp", "trail", "trailhead", "lake", "water", "viewpoint", "waterfall", "peak", "climbing_area"}:
        return 45.0
    return 60.0


def sanitize_source_pack_item(item: dict[str, Any], *, parent: dict[str, Any]) -> dict[str, Any]:
    clean = dict(item)
    parent_summary = parent.get("summary") if isinstance(parent.get("summary"), dict) else {}
    parent_title = parent_summary.get("title") or parent.get("name") or parent.get("title") or "Area"
    title = clean.get("title") or clean.get("name") or parent_title
    category = clean.get("category") or clean.get("kind") or parent_summary.get("category") or parent.get("category")
    group = parent_summary.get("explore_group") or parent.get("category") or ""
    region = parent_summary.get("region") or parent_summary.get("state") or parent.get("region") or parent.get("admin") or parent.get("country") or ""
    description = clean_description(clean.get("description") or clean.get("summary") or "", title=title, category=category, group=group, region=region)
    clean["description"] = description

    parent_lat = parent_summary.get("lat", parent.get("lat"))
    parent_lng = parent_summary.get("lng", parent.get("lng"))
    item_lat = clean.get("lat")
    item_lng = clean.get("lng")
    item_distance = distance_mi(parent_lat, parent_lng, item_lat, item_lng)
    if item_distance is not None:
        clean["distance_mi"] = round(item_distance, 1)
        radius = map_child_radius_mi(parent_summary.get("category") or parent.get("category"), parent_summary.get("explore_group"))
        if item_distance > radius:
            clean["map_hidden"] = True
            clean["map_hidden_reason"] = f"{round(item_distance, 1)} mi from parent"
    return clean


def sanitize_place_profile(place: dict[str, Any]) -> dict[str, Any]:
    clean = deepcopy(place)
    summary = clean.get("summary") if isinstance(clean.get("summary"), dict) else {}
    profile = clean.get("profile") if isinstance(clean.get("profile"), dict) else {}
    card = clean.get("card") if isinstance(clean.get("card"), dict) else {}
    title = summary.get("title") or card.get("title") or clean.get("name") or clean.get("title") or "Explore stop"
    category = summary.get("category") or clean.get("category") or card.get("category") or ""
    group = summary.get("explore_group") or ""
    region = summary.get("region") or summary.get("state") or clean.get("region") or clean.get("admin") or clean.get("country") or ""
    source_text = (
        summary.get("short_description")
        or profile.get("summary")
        or card.get("summary")
        or clean.get("summary")
        or clean.get("description")
        or profile.get("story")
        or ""
    )
    description = clean_description(source_text, title=title, category=category, group=group, region=region)

    summary = dict(summary)
    profile = dict(profile)
    card = dict(card)
    if is_weak_description(summary.get("short_description"), title=title, category=category, group=group):
        summary["short_description"] = description
    if is_weak_description(summary.get("hook"), title=title, category=category, group=group):
        summary["hook"] = compact_text(title)
    if is_weak_description(profile.get("summary"), title=title, category=category, group=group):
        profile["summary"] = description
    if is_weak_description(profile.get("why_it_matters"), title=title, category=category, group=group):
        profile["why_it_matters"] = description
    if is_weak_description(profile.get("story"), title=title, category=category, group=group):
        profile["story"] = description
    if is_weak_description(card.get("summary"), title=title, category=category, group=group):
        card["summary"] = description
    if is_weak_description(card.get("highlight"), title=title, category=category, group=group):
        card["highlight"] = description

    clean["summary"] = summary
    clean["profile"] = profile
    clean["card"] = card
    if is_weak_description(clean.get("audio_script"), title=title, category=category, group=group):
        clean["audio_script"] = profile.get("story") or description

    pack = clean.get("source_pack") if isinstance(clean.get("source_pack"), dict) else {}
    if pack:
        pack = dict(pack)
        if is_weak_description(pack.get("extract"), title=title, category=category, group=group):
            pack["extract"] = profile.get("story") or description
        for key in SOURCE_PACK_LIST_KEYS:
            values = []
            for item in pack.get(key) or []:
                if isinstance(item, dict):
                    values.append(sanitize_source_pack_item(item, parent=clean))
            if values:
                pack[key] = values
        clean["source_pack"] = pack
    return clean

