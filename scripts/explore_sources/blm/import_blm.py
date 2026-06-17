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


BLM_LICENSE = "BLM public geospatial data; verify current dataset terms before redistribution"
BLM_ATTRIBUTION = "Bureau of Land Management"


def load_features(path: str | Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text())
    if isinstance(data, list):
        return data
    if data.get("type") == "FeatureCollection":
        return list(data.get("features") or [])
    if data.get("type") == "Feature":
        return [data]
    for key in ("features", "data", "records"):
        if isinstance(data.get(key), list):
            return data[key]
    raise ValueError(f"unsupported BLM fixture shape: {path}")


def import_blm_fixture(path: str | Path, fetched_at: int | None = None) -> tuple[list[SourceRecord], list[ExplorePlaceV3], list[TrailGeometry]]:
    assert_source_allowed("blm")
    now = int(fetched_at or time.time())
    records: list[SourceRecord] = []
    places: list[ExplorePlaceV3] = []
    trails: list[TrailGeometry] = []
    for feature in load_features(path):
        record = source_record_from_feature(feature, now)
        if not record:
            continue
        records.append(record)
        if record.category in {"trail", "offroad_route", "scenic_drive"} and is_line_geometry(record.geometry):
            trail = trail_from_record(record)
            trails.append(trail)
            if not should_make_route_card(record, trail):
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
        props.get("BLM_ID")
        or props.get("OBJECTID")
        or props.get("GLOBALID")
        or props.get("SITE_ID")
        or props.get("ROUTE_ID")
        or props.get("ID")
        or props.get("id")
    )
    name = compact_text(
        props.get("NAME")
        or props.get("SITE_NAME")
        or props.get("AREA_NAME")
        or props.get("ROUTE_NAME")
        or props.get("REC_AREA_NAME")
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
    url = compact_text(props.get("SOURCE_URL") or props.get("URL") or "https://www.blm.gov/maps/georeferenced-PDFs")
    return SourceRecord(
        id=f"blm:{source_id}",
        source="blm",
        source_id=source_id,
        source_url=url,
        license=BLM_LICENSE,
        attribution=BLM_ATTRIBUTION,
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
        confidence=0.86,
    )


def category_for_props(props: dict[str, Any], geometry: dict[str, Any] | None) -> tuple[str, str]:
    text = " ".join(compact_text(props.get(key)).lower() for key in (
        "FEATURE_TYPE",
        "TYPE",
        "SITE_TYPE",
        "AREA_TYPE",
        "ROUTE_TYPE",
        "DESIGNATION",
        "MANAGEMENT",
        "NAME",
        "SITE_NAME",
        "ROUTE_NAME",
    ))
    if "trailhead" in text or "access point" in text:
        return "trailhead", "trailhead"
    if "dispersed" in text or "primitive camp" in text:
        return "dispersed_camp", "dispersed_camp"
    if "campground" in text or "camp site" in text or "campsite" in text:
        return "campground", "campground"
    if any(term in text for term in ("ohv", "off-highway", "off highway", "jeep", "4x4", "four wheel", "atv")):
        return "offroad_route", "ohv_route"
    if "scenic byway" in text or "scenic drive" in text or "backway" in text:
        return "scenic_drive", "scenic_drive"
    if "viewpoint" in text or "overlook" in text or "vista" in text:
        return "viewpoint", "overlook"
    if "historic" in text or "heritage" in text or "petroglyph" in text:
        return "historic_site", "historic_site"
    if "trail" in text and is_line_geometry(geometry):
        return "trail", "trail"
    if any(term in text for term in ("monument", "conservation", "wilderness", "recreation area", "public land", "national landscape")):
        return "public_land", public_land_subcategory(text)
    if is_line_geometry(geometry):
        return "offroad_route", "blm_route"
    return "public_land", "blm_recreation"


def trail_from_record(record: SourceRecord) -> TrailGeometry:
    props = record.properties
    distance = as_float(props.get("LENGTH_MILES") or props.get("MILES") or props.get("length_mi")) or line_distance_mi(record.geometry)
    allowed = allowed_uses(props)
    return TrailGeometry(
        id=f"trail:blm:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        geometry_line=record.geometry,
        representative_lat=record.lat,
        representative_lng=record.lng,
        distance_mi=round(distance, 2) if distance else None,
        elevation_gain_ft=as_float(props.get("ELEV_GAIN") or props.get("elevation_gain_ft")),
        elevation_loss_ft=as_float(props.get("ELEV_LOSS") or props.get("elevation_loss_ft")),
        route_type=route_type_for_record(record),
        activities=activities_for_record(record, allowed),
        difficulty=compact_text(props.get("DIFFICULTY") or props.get("TECHNICAL_RATING") or ""),
        surface=compact_text(props.get("SURFACE") or props.get("ROAD_SURFACE") or ""),
        access=compact_text(props.get("ACCESS_STATUS") or props.get("STATUS") or props.get("ACCESS") or ""),
        allowed_uses=allowed,
        seasonal_notes=compact_text(props.get("SEASONAL") or props.get("SEASONAL_STATUS") or props.get("OPEN_SEASON") or ""),
        land_manager=compact_text(props.get("FIELD_OFFICE") or props.get("DISTRICT") or props.get("MANAGER") or BLM_ATTRIBUTION),
        source_quality=quality_for_source("blm"),
        sources=[source_ref(record)],
    )


def place_from_record(record: SourceRecord) -> ExplorePlaceV3 | None:
    if record.lat is None or record.lng is None:
        return None
    props = record.properties
    place = ExplorePlaceV3(
        id=f"place:blm:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        category=record.category,
        subcategories=sorted_unique([record.subcategory]),
        lat=record.lat,
        lng=record.lng,
        geometry=record.geometry,
        country="US",
        region=compact_text(props.get("STATE") or props.get("STATE_ABBR") or props.get("REGION") or ""),
        admin=compact_text(props.get("FIELD_OFFICE") or props.get("DISTRICT") or props.get("MANAGER") or ""),
        summary=summary_from_record(record),
        description=compact_text(props.get("DESCRIPTION") or props.get("COMMENTS") or props.get("NOTES") or ""),
        tags=sorted_unique([
            record.category,
            record.subcategory,
            "blm",
            "public land",
            props.get("DESIGNATION"),
            props.get("MANAGEMENT"),
            props.get("FIELD_OFFICE"),
        ]),
        access=compact_text(props.get("ACCESS_STATUS") or props.get("STATUS") or props.get("ACCESS") or ""),
        safety=compact_text(props.get("HAZARD") or props.get("SAFETY") or props.get("TRAVEL_NOTES") or ""),
        amenities=amenities_from_props(props),
        sources=[source_ref(record)],
        quality=quality_for_source("blm"),
        last_seen_at=record.last_seen_at,
        updated_at=record.fetched_at,
    )
    return apply_aliases(build_card(score_place(place)))


def source_ref(record: SourceRecord) -> dict[str, Any]:
    return {
        "source": "blm",
        "source_id": record.source_id,
        "url": record.source_url,
        "license": record.license,
        "attribution": record.attribution,
        "quality": quality_for_source("blm"),
    }


def summary_from_record(record: SourceRecord) -> str:
    props = record.properties
    if props.get("DESCRIPTION"):
        return compact_text(props["DESCRIPTION"])[:420]
    readable = record.category.replace("_", " ")
    manager = compact_text(props.get("FIELD_OFFICE") or props.get("DISTRICT") or "BLM")
    return f"{record.name} is an official {manager} {readable} record. Verify access, seasonal closures, fire restrictions, route status, and local rules before relying on it."


def allowed_uses(props: dict[str, Any]) -> list[str]:
    values = []
    checks = [
        ("HIKING", "hiking"),
        ("BICYCLE", "bike"),
        ("EQUESTRIAN", "horse"),
        ("HORSE", "horse"),
        ("OHV", "OHV"),
        ("ATV", "OHV"),
        ("MOTORCYCLE", "motorcycle"),
        ("FOUR_WHEEL_DRIVE", "4x4"),
        ("FOURWD", "4x4"),
    ]
    for key, label in checks:
        if truthy(props.get(key)):
            values.append(label)
    text = compact_text(props.get("ALLOWED_USES") or props.get("USES") or props.get("ACTIVITIES")).lower()
    for needle, label in [
        ("hike", "hiking"),
        ("bike", "bike"),
        ("horse", "horse"),
        ("ohv", "OHV"),
        ("atv", "OHV"),
        ("motorcycle", "motorcycle"),
        ("4x4", "4x4"),
        ("four wheel", "4x4"),
    ]:
        if needle in text:
            values.append(label)
    return sorted_unique(values)


def activities_for_record(record: SourceRecord, allowed: list[str]) -> list[str]:
    if record.category == "offroad_route":
        return sorted_unique([*allowed, "overland"])
    if record.category == "scenic_drive":
        return sorted_unique([*allowed, "driving"])
    return sorted_unique(allowed or ["hiking"])


def route_type_for_record(record: SourceRecord) -> str:
    props = record.properties
    if record.category == "offroad_route":
        return compact_text(props.get("ROUTE_TYPE") or "OHV route")
    if record.category == "scenic_drive":
        return compact_text(props.get("ROUTE_TYPE") or "Scenic drive")
    return compact_text(props.get("ROUTE_TYPE") or "Mapped route")


def amenities_from_props(props: dict[str, Any]) -> list[str]:
    values = []
    for key, label in [
        ("WATER", "water"),
        ("TOILET", "toilets"),
        ("PICNIC", "picnic"),
        ("FEE", "fee"),
        ("PARKING", "parking"),
        ("TRASH", "trash"),
    ]:
        if truthy(props.get(key)):
            values.append(label)
    return sorted_unique(values)


def public_land_subcategory(text: str) -> str:
    if "monument" in text:
        return "national_monument"
    if "conservation" in text:
        return "national_conservation_area"
    if "wilderness" in text:
        return "wilderness_area"
    if "recreation area" in text:
        return "recreation_area"
    return "public_land"


def should_make_route_card(record: SourceRecord, trail: TrailGeometry) -> bool:
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
