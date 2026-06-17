from __future__ import annotations

from .normalize import compact_text, sorted_unique
from .schema import ExplorePlaceV3


CATEGORY_ALIASES = {
    "campground": ["camp", "camping", "campsite", "tent", "rv", "overnight"],
    "dispersed_camp": ["boondocking", "primitive camping", "free camping", "wild camping", "forest road camping"],
    "rv_park": ["rv", "motorhome", "camper", "hookups", "dump station"],
    "glamping": ["yurt", "dome", "safari tent", "luxury camping", "cabin stay"],
    "hut": ["shelter", "refuge", "mountain hut", "backcountry hut", "cabin"],
    "shelter": ["lean-to", "backcountry shelter", "wilderness shelter"],
    "trail": ["hike", "hiking", "trek", "trekking", "walk", "route"],
    "trailhead": ["start point", "parking", "hike start", "trail access"],
    "viewpoint": ["overlook", "scenic view", "lookout", "photo spot"],
    "peak": ["summit", "mountain", "ridge", "high point"],
    "waterfall": ["waterfalls", "falls", "cascade"],
    "hot_spring": ["thermal spring", "soak", "hot pool"],
    "climbing_area": ["rock climbing", "crag", "climb", "routes"],
    "bouldering_area": ["boulder", "bouldering", "problems"],
    "scenic_drive": ["road trip", "byway", "scenic road", "drive"],
    "offroad_route": ["4x4", "overland", "ohv", "jeep trail"],
    "water_source": ["drinking water", "water refill", "potable"],
    "fuel": ["gas", "diesel", "petrol", "service station"],
    "resupply": ["grocery", "outdoor store", "gear", "supplies"],
    "glacier": ["ice", "icefield", "glacier viewpoint", "trekking"],
    "historic_site": ["historic", "history", "heritage", "landmark"],
    "visitor_center": ["information", "ranger station", "park info"],
}


def aliases_for_category(category: str, subcategories: list[str] | None = None) -> list[str]:
    values = [category, *(subcategories or [])]
    aliases = []
    for value in values:
        aliases.extend(CATEGORY_ALIASES.get(value, []))
    return sorted_unique(aliases)


def apply_aliases(place: ExplorePlaceV3, linked_trail_names: list[str] | None = None) -> ExplorePlaceV3:
    aliases = aliases_for_category(place.category, place.subcategories)
    aliases.extend(place.search_aliases)
    aliases.extend(linked_trail_names or [])
    place.search_aliases = sorted_unique(aliases)
    place.search_blob = build_search_blob(place, linked_trail_names or [])
    return place


def build_search_blob(place: ExplorePlaceV3, linked_trail_names: list[str] | None = None) -> str:
    card = place.card or {}
    sources = place.sources or []
    source_names = []
    for source in sources:
        source_names.extend([source.get("source"), source.get("attribution"), source.get("url")])
    parts = [
        place.name,
        place.category,
        *place.subcategories,
        *place.tags,
        *place.search_aliases,
        place.country,
        place.region,
        place.admin,
        place.summary,
        place.description,
        card.get("headline"),
        card.get("summary"),
        *(linked_trail_names or []),
        *source_names,
    ]
    return compact_text(" ".join(compact_text(part) for part in parts if part)).lower()
