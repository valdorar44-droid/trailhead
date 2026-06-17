from __future__ import annotations

from .normalize import coord_pair, haversine_m, normalize_name, sorted_unique
from .quality import score_place
from .schema import ExplorePlaceV3, TrailGeometry


COMPATIBLE_CATEGORIES = {
    ("campground", "rv_park"),
    ("hut", "shelter"),
    ("public_land", "park"),
    ("wildlife_area", "public_land"),
}

NO_AUTO_MERGE = {
    frozenset(("trail", "trailhead")),
    frozenset(("visitor_center", "park")),
    frozenset(("peak", "viewpoint")),
    frozenset(("peak", "trail")),
    frozenset(("viewpoint", "trail")),
    frozenset(("waterfall", "trail")),
    frozenset(("waterfall", "viewpoint")),
}


def same_source_key(a: ExplorePlaceV3, b: ExplorePlaceV3) -> bool:
    return bool(set(a.source_ids) & set(b.source_ids))


def category_compatible(a: str, b: str) -> bool:
    if a == b:
        return True
    return (a, b) in COMPATIBLE_CATEGORIES or (b, a) in COMPATIBLE_CATEGORIES


def should_merge(a: ExplorePlaceV3, b: ExplorePlaceV3) -> bool:
    if same_source_key(a, b):
        return True
    if a.lat is None or a.lng is None or b.lat is None or b.lng is None:
        return False
    categories = frozenset((a.category, b.category))
    if categories in NO_AUTO_MERGE:
        return False
    distance = haversine_m(a.lat, a.lng, b.lat, b.lng)
    same_name = normalize_name(a.name) == normalize_name(b.name)
    if same_name and a.category == b.category and distance <= 150:
        return True
    if same_name and category_compatible(a.category, b.category) and distance <= 75:
        return True
    if same_name and {a.category, b.category} <= {"campground", "rv_park"} and distance <= 250:
        return True
    return False


def merge_places(a: ExplorePlaceV3, b: ExplorePlaceV3) -> ExplorePlaceV3:
    primary, secondary = (a, b) if a.quality_score >= b.quality_score else (b, a)
    primary.source_ids = sorted_unique([*primary.source_ids, *secondary.source_ids])
    primary.sources = [*primary.sources, *[src for src in secondary.sources if src not in primary.sources]]
    primary.subcategories = sorted_unique([*primary.subcategories, secondary.category, *secondary.subcategories])
    primary.tags = sorted_unique([*primary.tags, *secondary.tags])
    primary.search_aliases = sorted_unique([*primary.search_aliases, *secondary.search_aliases])
    primary.media = [*primary.media, *[item for item in secondary.media if item not in primary.media]]
    primary.linked_trail_ids = sorted_unique([*primary.linked_trail_ids, *secondary.linked_trail_ids])
    primary.linked_place_ids = sorted_unique([*primary.linked_place_ids, *secondary.linked_place_ids])
    if not primary.summary:
        primary.summary = secondary.summary
    if not primary.description:
        primary.description = secondary.description
    if not primary.country:
        primary.country = secondary.country
    if not primary.region:
        primary.region = secondary.region
    if not primary.admin:
        primary.admin = secondary.admin
    return score_place(primary)


def dedupe_places(places: list[ExplorePlaceV3]) -> list[ExplorePlaceV3]:
    merged: list[ExplorePlaceV3] = []
    for place in places:
        for idx, existing in enumerate(merged):
            if should_merge(existing, place):
                merged[idx] = merge_places(existing, place)
                break
        else:
            merged.append(place)
    return merged


def link_trailheads_to_trails(places: list[ExplorePlaceV3], trails: list[TrailGeometry], radius_m: float = 350.0) -> None:
    for place in places:
        if place.category != "trailhead" or place.lat is None or place.lng is None:
            continue
        for trail in trails:
            start = trail_start_point(trail)
            if not start:
                continue
            distance = haversine_m(place.lat, place.lng, start[0], start[1])
            if distance <= radius_m:
                if trail.id not in place.linked_trail_ids:
                    place.linked_trail_ids.append(trail.id)
                if place.id not in trail.linked_place_ids:
                    trail.linked_place_ids.append(place.id)


def trail_start_point(trail: TrailGeometry) -> tuple[float, float] | None:
    geometry = trail.geometry_line or {}
    coords = geometry.get("coordinates") or []
    if geometry.get("type") == "LineString" and coords:
        return coord_pair(coords[0])
    if geometry.get("type") == "MultiLineString" and coords and coords[0]:
        return coord_pair(coords[0][0])
    if trail.representative_lat is not None and trail.representative_lng is not None:
        return trail.representative_lat, trail.representative_lng
    return None
