from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from scripts.explore_sources.base.aliases import apply_aliases
from scripts.explore_sources.base.cards import build_card
from scripts.explore_sources.base.normalize import compact_text, line_distance_mi, representative_point, slugify, sorted_unique
from scripts.explore_sources.base.quality import quality_for_source, score_place
from scripts.explore_sources.base.schema import ExplorePlaceV3, SourceRecord, TrailGeometry
from scripts.explore_sources.base.source_policy import assert_source_allowed


USFS_LICENSE = "USFS public geospatial data; verify current dataset terms before redistribution"
USFS_ATTRIBUTION = "USDA Forest Service"


def load_features(path: str | Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text())
    if data.get("type") == "FeatureCollection":
        return list(data.get("features") or [])
    if data.get("type") == "Feature":
        return [data]
    if isinstance(data, list):
        return data
    for key in ("features", "data", "records"):
        if isinstance(data.get(key), list):
            return data[key]
    raise ValueError(f"unsupported USFS fixture shape: {path}")


def import_usfs_fixture(path: str | Path, fetched_at: int | None = None) -> tuple[list[SourceRecord], list[ExplorePlaceV3], list[TrailGeometry]]:
    assert_source_allowed("usfs")
    now = int(fetched_at or time.time())
    records: list[SourceRecord] = []
    places: list[ExplorePlaceV3] = []
    trails: list[TrailGeometry] = []
    for feature in load_features(path):
        record = source_record_from_feature(feature, now)
        if not record:
            continue
        records.append(record)
        if record.category in {"trail", "forest_road", "offroad_route"} and is_line_geometry(record.geometry):
            trail = trail_from_record(record)
            trails.append(trail)
            if record.category == "forest_road" and not should_make_road_card(record, trail):
                continue
        place = place_from_record(record)
        if place:
            places.append(place)
    return records, places, trails


def source_record_from_feature(feature: dict[str, Any], now: int) -> SourceRecord | None:
    props = dict(feature.get("properties") or feature)
    geometry = feature.get("geometry") if isinstance(feature.get("geometry"), dict) else props.get("geometry")
    lat, lng = representative_point(geometry)
    source_id = compact_text(
        props.get("TRAIL_NO")
        or props.get("TRAIL_CN")
        or props.get("OBJECTID")
        or props.get("GLOBALID")
        or props.get("ID")
        or props.get("id")
    )
    name = compact_text(
        props.get("TRAIL_NAME")
        or props.get("TRAILNAME")
        or props.get("NAME")
        or props.get("SITE_NAME")
        or props.get("RECAREANAME")
        or props.get("ROAD_NAME")
        or props.get("FORESTNAME")
    )
    if not source_id:
        source_id = slugify(name or json.dumps(geometry or {}, sort_keys=True))[:80]
    if not name:
        name = category_for_props(props, geometry)[0].replace("_", " ").title()
    if lat is None or lng is None:
        lat = as_float(props.get("LATITUDE") or props.get("lat"))
        lng = as_float(props.get("LONGITUDE") or props.get("lng") or props.get("lon"))
    if lat is None or lng is None:
        return None
    category, subcategory = category_for_props(props, geometry)
    url = compact_text(props.get("SOURCE_URL") or props.get("URL") or "https://data.fs.usda.gov/geodata/")
    return SourceRecord(
        id=f"usfs:{source_id}",
        source="usfs",
        source_id=source_id,
        source_url=url,
        license=USFS_LICENSE,
        attribution=USFS_ATTRIBUTION,
        fetched_at=now,
        last_seen_at=now,
        raw=feature,
        name=name,
        category=category,
        subcategory=subcategory,
        lat=lat,
        lng=lng,
        geometry=geometry,
        properties=props,
        confidence=0.88,
    )


def category_for_props(props: dict[str, Any], geometry: dict[str, Any] | None) -> tuple[str, str]:
    text = " ".join(compact_text(props.get(key)).lower() for key in (
        "FEATURE_TYPE", "TYPE", "SITE_TYPE", "TRAIL_TYPE", "RECAREA_TYPE", "OPER_MAINT_LEVEL", "NAME", "TRAIL_NAME"
    ))
    if "trailhead" in text:
        return "trailhead", "trailhead"
    if "camp" in text:
        return "campground", "campground"
    if "shelter" in text or "cabin" in text or "lookout" in text:
        return "shelter", "shelter"
    if ("road" in text or "route" in text) and is_line_geometry(geometry):
        return "forest_road", "forest_road"
    if "forest" in text or "boundary" in text or "ranger district" in text:
        return "forest", "national_forest"
    if is_line_geometry(geometry):
        return "trail", "trail"
    return "public_land", "usfs_recreation"


def trail_from_record(record: SourceRecord) -> TrailGeometry:
    props = record.properties
    category = record.category
    distance = as_float(props.get("LENGTH_MILES") or props.get("MILES") or props.get("length_mi")) or line_distance_mi(record.geometry)
    allowed = allowed_uses(props)
    activities = activities_for_record(record, allowed)
    return TrailGeometry(
        id=f"trail:usfs:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        geometry_line=record.geometry,
        representative_lat=record.lat,
        representative_lng=record.lng,
        distance_mi=round(distance, 2) if distance else None,
        elevation_gain_ft=as_float(props.get("ELEV_GAIN") or props.get("elevation_gain_ft")),
        elevation_loss_ft=as_float(props.get("ELEV_LOSS") or props.get("elevation_loss_ft")),
        route_type="Forest road" if category == "forest_road" else compact_text(props.get("ROUTE_TYPE") or "Point or route"),
        activities=activities,
        difficulty=compact_text(props.get("TRAIL_DIFFICULTY") or props.get("DIFFICULTY") or ""),
        surface=compact_text(props.get("SURFACE") or props.get("TRAIL_SURFACE") or ""),
        access=compact_text(props.get("ACCESS_STATUS") or props.get("STATUS") or props.get("ACCESS") or ""),
        allowed_uses=allowed,
        seasonal_notes=compact_text(props.get("SEASONAL") or props.get("SEASONAL_STATUS") or props.get("OPEN_SEASON") or ""),
        land_manager=compact_text(props.get("FORESTNAME") or props.get("FOREST_NAME") or props.get("ADMIN_ORG") or "USDA Forest Service"),
        source_quality=quality_for_source("usfs"),
        sources=[source_ref(record)],
    )


def place_from_record(record: SourceRecord) -> ExplorePlaceV3 | None:
    if record.lat is None or record.lng is None:
        return None
    props = record.properties
    place = ExplorePlaceV3(
        id=f"place:usfs:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        category=record.category,
        subcategories=sorted_unique([record.subcategory]),
        lat=record.lat,
        lng=record.lng,
        geometry=record.geometry,
        country="US",
        region=compact_text(props.get("STATE") or props.get("STATE_ABBR") or props.get("REGION") or ""),
        admin=compact_text(props.get("FORESTNAME") or props.get("FOREST_NAME") or props.get("DISTRICT") or ""),
        summary=summary_from_record(record),
        description=compact_text(props.get("DESCRIPTION") or props.get("COMMENTS") or props.get("NOTES") or ""),
        tags=sorted_unique([
            record.category,
            record.subcategory,
            "usfs",
            "forest service",
            props.get("FORESTNAME") or props.get("FOREST_NAME"),
            props.get("TRAIL_CLASS"),
        ]),
        access=compact_text(props.get("ACCESS_STATUS") or props.get("STATUS") or props.get("ACCESS") or ""),
        safety=compact_text(props.get("HAZARD") or props.get("SAFETY") or ""),
        amenities=amenities_from_props(props),
        sources=[source_ref(record)],
        quality=quality_for_source("usfs"),
        last_seen_at=record.last_seen_at,
        updated_at=record.fetched_at,
    )
    return apply_aliases(build_card(score_place(place)))


def source_ref(record: SourceRecord) -> dict[str, Any]:
    return {
        "source": "usfs",
        "source_id": record.source_id,
        "url": record.source_url,
        "license": record.license,
        "attribution": record.attribution,
        "quality": quality_for_source("usfs"),
    }


def summary_from_record(record: SourceRecord) -> str:
    props = record.properties
    if props.get("DESCRIPTION"):
        return compact_text(props["DESCRIPTION"])[:420]
    readable = record.category.replace("_", " ")
    manager = compact_text(props.get("FORESTNAME") or props.get("FOREST_NAME") or "USFS")
    return f"{record.name} is an official {manager} {readable} record. Verify access, seasonal closures, fire restrictions, road conditions, and local rules before relying on it."


def allowed_uses(props: dict[str, Any]) -> list[str]:
    values = []
    checks = [
        ("HIKER_PEDESTRIAN", "hiking"),
        ("BICYCLE", "bike"),
        ("PACK_SADDLE", "horse"),
        ("MOTORCYCLE", "motorcycle"),
        ("ATV", "OHV"),
        ("FOURWD", "4x4"),
        ("SNOWMOBILE", "snowmobile"),
    ]
    for key, label in checks:
        if truthy(props.get(key)):
            values.append(label)
    text = compact_text(props.get("ALLOWED_USES") or props.get("USES")).lower()
    for needle, label in [("hike", "hiking"), ("bike", "bike"), ("horse", "horse"), ("ohv", "OHV"), ("4x4", "4x4")]:
        if needle in text:
            values.append(label)
    return sorted_unique(values)


def activities_for_record(record: SourceRecord, allowed: list[str]) -> list[str]:
    if record.category == "forest_road":
        return sorted_unique([*allowed, "overland"])
    return sorted_unique(allowed or ["hiking"])


def amenities_from_props(props: dict[str, Any]) -> list[str]:
    values = []
    for key, label in [
        ("WATER", "water"),
        ("TOILET", "toilets"),
        ("PICNIC", "picnic"),
        ("FEE", "fee"),
        ("PARKING", "parking"),
    ]:
        if truthy(props.get(key)):
            values.append(label)
    return sorted_unique(values)


def should_make_road_card(record: SourceRecord, trail: TrailGeometry) -> bool:
    return bool(record.name and (trail.distance_mi or 0) >= 0.5)


def is_line_geometry(geometry: dict[str, Any] | None) -> bool:
    return bool(geometry and geometry.get("type") in {"LineString", "MultiLineString"})


def truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return compact_text(value).lower() in {"yes", "y", "true", "1", "designated", "open", "allowed"}


def as_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except Exception:
        return None
