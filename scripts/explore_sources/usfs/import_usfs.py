from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from scripts.explore_sources.base.aliases import apply_aliases
from scripts.explore_sources.base.cards import build_card
from scripts.explore_sources.base.normalize import compact_text, line_distance_mi, representative_point, slugify, sorted_unique
from scripts.explore_sources.base.quality import quality_for_source, score_place
from scripts.explore_sources.base.schema import ExplorePlaceV3, SourceRecord, TrailGeometry
from scripts.explore_sources.base.source_policy import assert_source_allowed


USFS_LICENSE = (
    "USFS geospatial data; no warranty is expressed or implied. "
    "See the official dataset metadata for use constraints."
)
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
        pget(
            props,
            "GLOBALID",
            "OBJECTID",
            "TRAIL_CN",
            "SITE_CN",
            "SITE_ID",
            "NFFID",
            "TRAIL_NO",
            "ID",
        )
    )
    name = compact_text(
        pget(
            props,
            "PUBLIC_SITE_NAME",
            "TRAIL_NAME",
            "TRAILNAME",
            "NAME",
            "SITE_NAME",
            "RECAREANAME",
            "RECAREA_NAME",
            "ROAD_NAME",
            "FORESTNAME",
            "NFSLANDUNITNAME",
        )
    )
    dataset_id = slugify(compact_text(pget(props, "_trailhead_dataset_id")))
    if not source_id:
        source_id = slugify(name or json.dumps(geometry or {}, sort_keys=True))[:80]
    if dataset_id:
        source_id = f"{dataset_id}:{source_id}"
    if not name:
        return None
    if lat is None or lng is None:
        lat = as_float(pget(props, "LATITUDE", "LAT"))
        lng = as_float(pget(props, "LONGITUDE", "LNG", "LON"))
    if lat is None or lng is None:
        return None
    category, subcategory = category_for_props(props, geometry)
    url = compact_text(
        pget(props, "_trailhead_source_url", "SOURCE_URL", "URL")
        or "https://data.fs.usda.gov/geodata/"
    )
    return SourceRecord(
        id=f"usfs:{source_id}",
        source="usfs",
        source_id=source_id,
        source_url=url,
        license=compact_text(pget(props, "_trailhead_license")) or USFS_LICENSE,
        attribution=compact_text(pget(props, "_trailhead_attribution")) or USFS_ATTRIBUTION,
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
    text = " ".join(compact_text(pget(props, key)).lower() for key in (
        "_trailhead_feature_kind", "FEATURE_TYPE", "TYPE", "SITE_TYPE", "TRAIL_TYPE",
        "RECAREA_TYPE", "OPER_MAINT_LEVEL", "NAME", "TRAIL_NAME", "SITE_NAME",
    ))
    if "trailhead" in text or "trail head" in text or "staging area" in text:
        return "trailhead", "trailhead"
    if "camp" in text:
        return "campground", "campground"
    if "shelter" in text or "cabin" in text or "lookout" in text:
        return "shelter", "shelter"
    if "info site" in text or "information site" in text or "visitor center" in text or "fee station" in text:
        return "visitor_center", "visitor_center"
    if "observation site" in text or "overlook" in text or "viewpoint" in text:
        return "viewpoint", "overlook"
    if "interpretive" in text:
        return "historic_site", "interpretive_site"
    if "picnic" in text:
        return "place", "picnic_site"
    if "boating" in text or "boat ramp" in text:
        return "place", "boat_access"
    if "fishing" in text:
        return "place", "fishing_access"
    if "day use" in text:
        return "place", "day_use_area"
    if "sport site" in text or "snowplay" in text:
        return "activity", "recreation_activity"
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
    distance = as_float(pget(props, "LENGTH_MILES", "MILES", "LENGTH_MI", "GIS_MILES", "SEGMENT_LENGTH")) or line_distance_mi(record.geometry)
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
        elevation_gain_ft=as_float(pget(props, "ELEV_GAIN", "ELEVATION_GAIN_FT")),
        elevation_loss_ft=as_float(pget(props, "ELEV_LOSS", "ELEVATION_LOSS_FT")),
        route_type="Forest road" if category == "forest_road" else compact_text(pget(props, "ROUTE_TYPE")) or "Trail",
        activities=activities,
        difficulty=compact_text(pget(props, "TRAIL_DIFFICULTY", "DIFFICULTY")),
        surface=compact_text(pget(props, "SURFACE", "TRAIL_SURFACE")),
        access=clean_fact(pget(props, "ACCESS_STATUS", "STATUS", "ACCESS")),
        allowed_uses=allowed,
        seasonal_notes=clean_fact(pget(props, "SEASONAL", "SEASONAL_STATUS", "OPEN_SEASON", "SEASON_DESCRIPTION")),
        land_manager=compact_text(pget(props, "FORESTNAME", "FOREST_NAME", "_trailhead_destination_name", "OPERATED_BY")) or USFS_ATTRIBUTION,
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
        region=reader_region(pget(props, "STATE", "STATE_ABBR", "STATES_SPANNED", "REGION")),
        admin=compact_text(pget(props, "FORESTNAME", "FOREST_NAME", "_trailhead_destination_name", "DISTRICT")),
        summary=summary_from_record(record),
        description=reader_copy(pget(props, "DESCRIPTION", "RECAREA_DESCRIPTION", "IMPORTANT_INFO", "COMMENTS", "NOTES")),
        tags=sorted_unique([
            record.category,
            record.subcategory,
            "usfs",
            "forest service",
            pget(props, "FORESTNAME", "FOREST_NAME", "_trailhead_destination_name"),
            pget(props, "TRAIL_CLASS"),
            pget(props, "ACTIVITY_TYPE_LIST"),
        ]),
        access=clean_fact(pget(props, "ACCESS_STATUS", "STATUS", "ACCESS", "SEASONAL_OPERATIONAL_STATUS")),
        safety=clean_fact(pget(props, "HAZARD", "SAFETY", "RESTRICTIONS")),
        amenities=amenities_from_props(props),
        reservations=reservation_from_props(props),
        sources=[source_ref(record)],
        quality=quality_for_source("usfs"),
        last_seen_at=record.last_seen_at,
        updated_at=record.fetched_at,
    )
    source_summary = place.summary
    source_description = place.description
    place = apply_aliases(build_card(score_place(place)))
    place.summary = source_summary
    place.description = source_description
    place.card["summary"] = source_summary or source_description
    place.card["warnings"] = [place.safety] if place.safety else []
    place.card["best_for"] = []
    return place


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
    return reader_copy(
        pget(props, "DESCRIPTION", "RECAREA_DESCRIPTION", "IMPORTANT_INFO")
    )[:420]


def allowed_uses(props: dict[str, Any]) -> list[str]:
    values = []
    checks = [
        (("HIKER_PEDESTRIAN", "HIKER_PEDESTRIAN_MANAGED", "HIKER_PEDESTRIAN_ACCPT"), "hiking"),
        (("BICYCLE", "BICYCLE_MANAGED", "BICYCLE_ACCPT"), "bike"),
        (("PACK_SADDLE", "PACK_SADDLE_MANAGED", "PACK_SADDLE_ACCPT"), "horse"),
        (("MOTORCYCLE", "MOTORCYCLE_MANAGED", "MOTORCYCLE_ACCPT"), "motorcycle"),
        (("ATV", "ATV_MANAGED", "ATV_ACCPT"), "OHV"),
        (("FOURWD", "FOURWD_MANAGED", "FOURWD_ACCPT"), "4x4"),
        (("SNOWMOBILE", "SNOWMOBILE_MANAGED", "SNOWMOBILE_ACCPT"), "snowmobile"),
        (("E_BIKE_CLASS1_MANAGED", "E_BIKE_CLASS1_ACCPT", "E_BIKE_CLASS2_MANAGED", "E_BIKE_CLASS2_ACCPT", "E_BIKE_CLASS3_MANAGED", "E_BIKE_CLASS3_ACCPT"), "e-bike"),
    ]
    for keys, label in checks:
        if any(truthy(pget(props, key)) for key in keys):
            values.append(label)
    text = compact_text(pget(props, "ALLOWED_USES", "USES", "ACTIVITY_TYPE_LIST", "_trailhead_default_activity")).lower()
    for needle, label in [("hike", "hiking"), ("bike", "bike"), ("horse", "horse"), ("ohv", "OHV"), ("4x4", "4x4")]:
        if needle in text:
            values.append(label)
    return sorted_unique(values)


def activities_for_record(record: SourceRecord, allowed: list[str]) -> list[str]:
    if record.category == "forest_road":
        return sorted_unique([*allowed, "overland"]) if allowed else []
    return sorted_unique(allowed)


def amenities_from_props(props: dict[str, Any]) -> list[str]:
    values = []
    for keys, label in [
        (("WATER", "WATER_AVAILABILITY"), "water"),
        (("TOILET", "RESTROOM_AVAILABILITY"), "toilets"),
        (("PICNIC",), "picnic"),
        (("FEE", "FEE_CHARGED"), "fee"),
        (("PARKING",), "parking"),
    ]:
        if any(truthy(pget(props, key)) for key in keys):
            values.append(label)
    values.extend(split_list(pget(props, "SERVICE_TYPE_LIST")))
    return sorted_unique(values)


def should_make_road_card(record: SourceRecord, trail: TrailGeometry) -> bool:
    return bool(record.name and (trail.distance_mi or 0) >= 0.5)


def is_line_geometry(geometry: dict[str, Any] | None) -> bool:
    return bool(geometry and geometry.get("type") in {"LineString", "MultiLineString"})


def truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = compact_text(value).lower()
    if not text or text in {"no", "n", "false", "0", "none", "unknown", "no data", "not available", "unavailable", "closed"} or text.startswith(("no ", "not ")):
        return False
    return text in {"yes", "y", "true", "1", "designated", "open", "allowed", "accepted", "managed"} or bool(text)


def pget(props: dict[str, Any], *keys: str) -> Any:
    folded = {str(key).casefold(): value for key, value in props.items()}
    for key in keys:
        value = folded.get(key.casefold())
        if value not in (None, ""):
            return value
    return None


def clean_fact(value: Any) -> str:
    text = reader_copy(value)
    if text.casefold() in {"", "none", "no data", "unknown", "not available", "n/a"}:
        return ""
    status_labels = {
        "open": "Open",
        "closed": "Closed",
        "seasonal": "Seasonal",
        "temporarily closed": "Temporarily closed",
        "restricted": "Restricted",
    }
    if text.casefold() in status_labels:
        return status_labels[text.casefold()]
    return text


def reader_region(value: Any) -> str:
    """Keep a reader-facing state/region and omit internal numeric region codes."""
    text = compact_text(value)
    if not text or re.fullmatch(r"\d{1,3}", text):
        return ""
    return text


def reader_copy(value: Any) -> str:
    """Repair spacing artifacts in agency prose without changing factual wording."""
    text = compact_text(value)
    if not text:
        return ""
    text = re.sub(r"(?<=[A-Za-z])(?=\d[\d,]*(?:\s|$))", " ", text)
    text = re.sub(r"\b([A-Za-z]+)\s+['’]s\b", r"\1's", text)
    text = re.sub(
        r"(?<=[a-z0-9])(?=(?:All|Campers|Maximum|Minimum|No|Pets|Reservations|The|This|Visitors)\b)",
        ". ",
        text,
    )
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return compact_text(text)


def split_list(value: Any) -> list[str]:
    text = clean_fact(value)
    if not text:
        return []
    for separator in ("|", ";"):
        text = text.replace(separator, ",")
    return [item.strip() for item in text.split(",") if clean_fact(item)]


def reservation_from_props(props: dict[str, Any]) -> dict[str, Any]:
    url = compact_text(pget(props, "REC1STOP_URL", "USDA_PORTAL_URL"))
    return {"url": url} if url.startswith("https://") else {}


def as_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except Exception:
        return None
