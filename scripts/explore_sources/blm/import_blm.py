from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from scripts.explore_sources.base.aliases import apply_aliases
from scripts.explore_sources.base.cards import build_card
from scripts.explore_sources.base.normalize import compact_text, line_distance_mi, representative_point, slugify, sorted_unique
from scripts.explore_sources.base.quality import quality_for_source, score_place
from scripts.explore_sources.base.schema import ExplorePlaceV3, SourceRecord, TrailGeometry
from scripts.explore_sources.base.source_policy import assert_source_allowed


BLM_LICENSE = (
    "BLM public-domain geospatial data; provided as-is without warranty. "
    "Cite the Bureau of Land Management as the data source."
)
BLM_ATTRIBUTION = "Bureau of Land Management"
BLM_FEATURED_DATASET = "blm-moab-featured-sites"
BLM_NO_FEE_VALUES = {"$0", "0", "free", "no", "no fee", "none"}
BLM_PUBLIC_READER_HOSTS = {"blm.gov", "www.blm.gov"}


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
        pget(props, "BLM_ID", "GLOBALID", "SITE_ID", "ROUTE_ID", "OBJECTID", "ID")
    )
    name = compact_text(
        pget(
            props,
            "NAME",
            "SITE_NAME",
            "AREA_NAME",
            "ROUTE_NAME",
            "REC_AREA_NAME",
            "FET_NAME",
            "ROUTE_PRMRY_NM",
            "MBT_NAME",
            "RECSITENAME",
            "LABEL",
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
        lng = as_float(pget(props, "LONGITUDE", "LNG", "LONG", "LON"))
    if lat is None or lng is None:
        return None
    category, subcategory = category_for_props(props, geometry)
    url = compact_text(
        pget(props, "_trailhead_source_url", "SOURCE_URL", "URL")
        or "https://www.blm.gov/services/geospatial/GISData"
    )
    return SourceRecord(
        id=f"blm:{source_id}",
        source="blm",
        source_id=source_id,
        source_url=url,
        license=compact_text(pget(props, "_trailhead_license")) or BLM_LICENSE,
        attribution=compact_text(pget(props, "_trailhead_attribution")) or BLM_ATTRIBUTION,
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
    text = " ".join(compact_text(pget(props, key)).lower() for key in (
        "_trailhead_feature_kind",
        "FEATURE_TYPE",
        "TYPE",
        "SITE_TYPE",
        "FET_TYPE",
        "FET_SUBTYPE",
        "AREA_TYPE",
        "ROUTE_TYPE",
        "PLAN_ASSET_CLASS",
        "DESIGNATION",
        "MANAGEMENT",
        "NAME",
        "SITE_NAME",
        "ROUTE_NAME",
        "ROUTE_PRMRY_NM",
        "RECSITENAME",
        "FEATUREDACTIVITY",
    ))
    if "trailhead" in text or "trail head" in text:
        return "trailhead", "trailhead"
    if "dispersed" in text or "primitive camp" in text or ("primitive" in text and "camp" in text):
        return "dispersed_camp", "dispersed_camp"
    if "campground" in text or "camp site" in text or "campsite" in text:
        return "campground", "campground"
    if "parking area" in text:
        return "place", "parking"
    if "boat ramp" in text:
        return "place", "boat_ramp"
    if "toilet" in text or "restroom" in text:
        return "place", "restroom"
    if "visitor center" in text or "ranger station" in text or "field office" in text or "contact station" in text:
        return "visitor_center", "visitor_center"
    if "interpretive" in text:
        return "historic_site", "interpretive_site"
    if "staging area" in text:
        return "trailhead", "staging_area"
    if "access point" in text:
        return "place", "access_point"
    if any(term in text for term in ("ohv", "off-highway", "off highway", "jeep", "4x4", "four wheel", "atv")):
        return "offroad_route", "ohv_route"
    if "scenic byway" in text or "scenic drive" in text or "backway" in text:
        return "scenic_drive", "scenic_drive"
    if "viewpoint" in text or "overlook" in text or "vista" in text:
        return "viewpoint", "overlook"
    if "historic" in text or "heritage" in text or "petroglyph" in text:
        return "historic_site", "historic_site"
    if ("trail" in text or "mountain bike" in text) and is_line_geometry(geometry):
        return "trail", "trail"
    if any(term in text for term in ("monument", "conservation", "wilderness", "recreation area", "public land", "national landscape")):
        return "public_land", public_land_subcategory(text)
    if is_line_geometry(geometry):
        return "offroad_route", "blm_route"
    return "public_land", "blm_recreation"


def trail_from_record(record: SourceRecord) -> TrailGeometry:
    props = record.properties
    distance = as_float(pget(props, "LENGTH_MILES", "MILES", "LENGTH_MI", "GIS_MILES", "BLM_MILES")) or line_distance_mi(record.geometry)
    allowed = allowed_uses(props)
    return TrailGeometry(
        id=f"trail:blm:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        geometry_line=record.geometry,
        representative_lat=record.lat,
        representative_lng=record.lng,
        distance_mi=round(distance, 2) if distance else None,
        elevation_gain_ft=as_float(pget(props, "ELEV_GAIN", "ELEVATION_GAIN_FT")),
        elevation_loss_ft=as_float(pget(props, "ELEV_LOSS", "ELEVATION_LOSS_FT")),
        route_type=route_type_for_record(record),
        activities=activities_for_record(record, allowed),
        difficulty=compact_text(pget(props, "DIFFICULTY", "TECHNICAL_RATING", "TRAILDIFFICULTY")),
        surface=compact_text(pget(props, "SURFACE", "ROAD_SURFACE", "OBSRVE_SRFCE_TYPE")),
        access=access_from_props(props),
        allowed_uses=allowed,
        seasonal_notes=clean_fact(pget(props, "SEASONAL", "SEASONAL_STATUS", "OPEN_SEASON", "PLAN_SEASON_RSTRCT_CODE", "RECSITESEASON")),
        land_manager=compact_text(pget(props, "FIELD_OFFICE", "UNIT_NAME", "DISTRICT", "MANAGER", "_trailhead_destination_name")) or BLM_ATTRIBUTION,
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
        region=compact_text(pget(props, "STATE", "STATE_ABBR", "ADMIN_ST", "CONTACTSTATE", "REGION")),
        admin=compact_text(pget(props, "FIELD_OFFICE", "UNIT_NAME", "DISTRICT", "MANAGER", "_trailhead_destination_name")),
        summary=summary_from_record(record),
        description=compact_text(pget(props, "DESCRIPTION", "COMMENTS", "NOTES", "DESCRIPTIO")),
        tags=sorted_unique([
            record.category,
            record.subcategory,
            "blm",
            "public land",
            pget(props, "DESIGNATION", "ROUTE_SPCL_DSGNTN_TYPE"),
            pget(props, "MANAGEMENT", "PLAN_ASSET_CLASS"),
            pget(props, "FIELD_OFFICE", "UNIT_NAME", "_trailhead_destination_name"),
        ]),
        access=access_from_props(props),
        safety=clean_fact(pget(props, "HAZARD", "SAFETY", "TRAVEL_NOTES")),
        amenities=amenities_from_props(props),
        source_pack=featured_source_pack(props),
        sources=[source_ref(record)],
        quality=quality_for_source("blm"),
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
        "source": "blm",
        "source_id": record.source_id,
        "url": record.source_url,
        "license": record.license,
        "attribution": record.attribution,
        "quality": quality_for_source("blm"),
    }


def summary_from_record(record: SourceRecord) -> str:
    props = record.properties
    return compact_text(pget(props, "DESCRIPTION", "DESCRIPTIO"))[:420]


def public_blm_url(value: Any) -> str:
    """Return a reader-facing BLM URL only when its public origin is explicit."""
    url = compact_text(value)
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError:
        return ""
    host = (parsed.hostname or "").casefold()
    if (
        parsed.scheme.casefold() != "https"
        or host not in BLM_PUBLIC_READER_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or port is not None
    ):
        return ""
    return url


def featured_fee(value: Any) -> str:
    text = compact_text(value)
    if text.casefold() in BLM_NO_FEE_VALUES:
        return "No fee"
    return clean_fact(text)


def featured_season(value: Any) -> str:
    text = clean_fact(value)
    return re.sub(r"\bdecmeber\b", "December", text, flags=re.I)


def featured_source_pack(props: dict[str, Any]) -> dict[str, Any]:
    """Normalize cached BLM featured-site reader facts without importing media."""
    dataset_id = slugify(compact_text(pget(props, "_trailhead_dataset_id")))
    if dataset_id != BLM_FEATURED_DATASET:
        return {}

    official_url = public_blm_url(pget(props, "WEBLINK"))
    fee = featured_fee(pget(props, "RECSITEFEE"))
    season = featured_season(pget(props, "RECSITESEASON"))
    phone = clean_fact(pget(props, "CONTACTPHONENUMBER"))
    activity = clean_fact(pget(props, "FEATUREDACTIVITY"))
    pack: dict[str, Any] = {}
    if fee:
        pack["fees"] = [fee]
    if season:
        pack["operating_season"] = [season]
    if phone:
        pack["phone"] = phone
    if activity:
        pack["activities"] = [activity]
    if official_url:
        pack["official_url"] = official_url
    return pack


def allowed_uses(props: dict[str, Any]) -> list[str]:
    values = []
    checks = [
        (("HIKING",), "hiking"),
        (("BICYCLE",), "bike"),
        (("EQUESTRIAN", "HORSE"), "horse"),
        (("OHV", "ATV"), "OHV"),
        (("MOTORCYCLE",), "motorcycle"),
        (("FOUR_WHEEL_DRIVE", "FOURWD"), "4x4"),
    ]
    for keys, label in checks:
        if any(truthy(pget(props, key)) for key in keys):
            values.append(label)
    text = compact_text(pget(props, "ALLOWED_USES", "USES", "ACTIVITIES", "FEATUREDACTIVITY", "_trailhead_default_activity")).lower()
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
    designation = compact_text(pget(props, "OHV_ROUTE_DSGNTN_LIM")).lower()
    if designation and "closed" not in designation and designation not in {"none", "no", "unknown"}:
        values.append("OHV")
    return sorted_unique(values)


def activities_for_record(record: SourceRecord, allowed: list[str]) -> list[str]:
    if record.category == "offroad_route":
        return sorted_unique([*allowed, "overland"])
    if record.category == "scenic_drive":
        return sorted_unique([*allowed, "driving"])
    return sorted_unique(allowed)


def route_type_for_record(record: SourceRecord) -> str:
    props = record.properties
    if record.category == "offroad_route":
        return compact_text(pget(props, "ROUTE_TYPE")) or "OHV route"
    if record.category == "scenic_drive":
        return compact_text(pget(props, "ROUTE_TYPE")) or "Scenic drive"
    route_type = compact_text(pget(props, "ROUTE_TYPE", "PLAN_ASSET_CLASS"))
    return "Trail" if "trail" in route_type.lower() or not route_type else route_type


def amenities_from_props(props: dict[str, Any]) -> list[str]:
    values = []
    for keys, label in [
        (("WATER",), "water"),
        (("TOILET",), "toilets"),
        (("PICNIC",), "picnic"),
        (("FEE", "RECSITEEFEE"), "fee"),
        (("PARKING",), "parking"),
        (("TRASH",), "trash"),
    ]:
        if any(truthy(pget(props, key)) for key in keys):
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
    text = compact_text(value)
    if text.casefold() in {"", "none", "no", "no data", "unknown", "not available", "n/a"}:
        return ""
    return text


def access_from_props(props: dict[str, Any]) -> str:
    values = [
        clean_fact(pget(props, "ACCESS_STATUS", "STATUS", "ACCESS", "PLAN_ACCESS_RSTRCT")),
        clean_fact(pget(props, "OHV_DSGNTN_LIM_EXPLAIN")),
    ]
    return " · ".join(value for value in values if value)


def as_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except Exception:
        return None
