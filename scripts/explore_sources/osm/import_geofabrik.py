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


MAPPING_PATH = Path(__file__).with_name("tag_mapping.json")
OSM_LICENSE = "Open Database License (ODbL)"
OSM_ATTRIBUTION = "OpenStreetMap contributors"


def load_mapping(path: Path = MAPPING_PATH) -> dict[str, dict[str, Any]]:
    return json.loads(path.read_text())


def load_features(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text())
    if data.get("type") == "FeatureCollection":
        return list(data.get("features") or [])
    if data.get("type") == "Feature":
        return [data]
    if isinstance(data, list):
        return data
    raise ValueError(f"unsupported OSM fixture shape: {path}")


def match_tags(tags: dict[str, Any], mapping: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    for key, raw_value in tags.items():
        exact = f"{key}={raw_value}"
        wildcard = f"{key}=*"
        if exact in mapping:
            return dict(mapping[exact])
        if wildcard in mapping and raw_value not in (None, "", "no", "false"):
            return dict(mapping[wildcard])
    return None


def source_id_for(feature: dict[str, Any]) -> str:
    props = feature.get("properties") or {}
    raw = props.get("@id") or props.get("id") or props.get("osm_id") or feature.get("id")
    if raw:
        return str(raw)
    return slugify(props.get("name") or json.dumps(feature.get("geometry") or {}, sort_keys=True))[:80]


def source_url(source_id: str) -> str:
    if "/" in source_id:
        kind, ident = source_id.split("/", 1)
        if kind in {"node", "way", "relation"} and ident:
            return f"https://www.openstreetmap.org/{kind}/{ident}"
    return "https://www.openstreetmap.org/"


def tags_from_feature(feature: dict[str, Any]) -> dict[str, Any]:
    props = dict(feature.get("properties") or {})
    tags = dict(props.get("tags") or {})
    for key, value in props.items():
        if key not in {"@id", "id", "osm_id", "tags"} and isinstance(value, (str, int, float, bool)):
            tags.setdefault(key, value)
    return tags


def import_osm_fixture(path: str | Path, fetched_at: int | None = None) -> tuple[list[SourceRecord], list[ExplorePlaceV3], list[TrailGeometry]]:
    assert_source_allowed("osm")
    mapping = load_mapping()
    records: list[SourceRecord] = []
    places: list[ExplorePlaceV3] = []
    trails: list[TrailGeometry] = []
    now = int(fetched_at or time.time())
    for feature in load_features(Path(path)):
        tags = tags_from_feature(feature)
        meta = match_tags(tags, mapping)
        if not meta:
            continue
        geometry = feature.get("geometry") or {}
        lat, lng = representative_point(geometry)
        source_id = source_id_for(feature)
        name = compact_text(tags.get("name") or tags.get("official_name") or meta.get("category", "OSM place").replace("_", " ").title())
        category = meta["category"]
        source = "osm"
        source_ref = {
            "source": source,
            "source_id": source_id,
            "url": source_url(source_id),
            "license": OSM_LICENSE,
            "attribution": OSM_ATTRIBUTION,
            "quality": quality_for_source(source),
        }
        record = SourceRecord(
            id=f"osm:{source_id}",
            source=source,
            source_id=source_id,
            source_url=source_ref["url"],
            license=OSM_LICENSE,
            attribution=OSM_ATTRIBUTION,
            fetched_at=now,
            last_seen_at=now,
            raw=feature,
            name=name,
            category=category,
            subcategory=meta.get("subcategory", ""),
            lat=lat,
            lng=lng,
            geometry=geometry,
            properties=tags,
            confidence=0.72 if tags.get("name") else 0.55,
        )
        records.append(record)
        is_line = geometry.get("type") in {"LineString", "MultiLineString"}
        if meta.get("route") or (category == "trail" and is_line):
            trail = build_trail_geometry(record, meta, source_ref)
            trails.append(trail)
            if not should_make_representative_trail_card(record, trail):
                continue
        if meta.get("card_worthy"):
            place = build_place(record, meta, source_ref)
            if place:
                places.append(place)
    return records, places, trails


def build_trail_geometry(record: SourceRecord, meta: dict[str, Any], source_ref: dict[str, Any]) -> TrailGeometry:
    tags = record.properties
    distance = line_distance_mi(record.geometry)
    route_type = "Loop" if tags.get("roundtrip") in {"yes", "true", True} else "Point or route"
    activities = ["hiking"]
    if meta.get("subcategory") == "mtb":
        activities = ["mountain biking"]
    elif tags.get("horse") == "yes":
        activities.append("horseback")
    return TrailGeometry(
        id=f"trail:osm:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        geometry_line=record.geometry,
        representative_lat=record.lat,
        representative_lng=record.lng,
        distance_mi=distance,
        route_type=route_type,
        activities=activities,
        difficulty=compact_text(tags.get("sac_scale") or tags.get("difficulty") or ""),
        surface=compact_text(tags.get("surface") or ""),
        access=compact_text(tags.get("access") or ""),
        allowed_uses=allowed_uses(tags),
        seasonal_notes=compact_text(tags.get("seasonal") or tags.get("opening_hours") or ""),
        land_manager=compact_text(tags.get("operator") or tags.get("operator:type") or ""),
        source_quality=quality_for_source(record.source),
        sources=[source_ref],
    )


def should_make_representative_trail_card(record: SourceRecord, trail: TrailGeometry) -> bool:
    return bool(record.name and (trail.distance_mi or 0) >= 0.2)


def build_place(record: SourceRecord, meta: dict[str, Any], source_ref: dict[str, Any]) -> ExplorePlaceV3 | None:
    if record.lat is None or record.lng is None:
        return None
    tags = record.properties
    country = compact_text(tags.get("addr:country") or tags.get("country"))
    region = compact_text(tags.get("addr:state") or tags.get("is_in:state") or tags.get("region"))
    admin = compact_text(tags.get("addr:city") or tags.get("is_in") or tags.get("admin"))
    category = record.category
    place = ExplorePlaceV3(
        id=f"place:osm:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        category=category,
        subcategories=sorted_unique([record.subcategory]),
        lat=record.lat,
        lng=record.lng,
        geometry=record.geometry,
        country=country,
        region=region,
        admin=admin,
        summary=summary_from_tags(record, category),
        description=compact_text(tags.get("description") or tags.get("note") or ""),
        tags=sorted_unique([category, record.subcategory, tags.get("tourism"), tags.get("natural"), tags.get("amenity"), tags.get("route"), tags.get("sport")]),
        access=compact_text(tags.get("access") or ""),
        amenities=amenities_from_tags(tags),
        reservations={"required": tags.get("reservation") == "required"} if tags.get("reservation") else {},
        sources=[source_ref],
        quality=quality_for_source(record.source),
        last_seen_at=record.last_seen_at,
        updated_at=record.fetched_at,
    )
    place = score_place(place)
    place = build_card(place)
    place = apply_aliases(place)
    return place


def summary_from_tags(record: SourceRecord, category: str) -> str:
    tags = record.properties
    if tags.get("description"):
        return compact_text(tags["description"])
    readable = category.replace("_", " ")
    return f"{record.name} is mapped as {readable} in OpenStreetMap. Verify access, current conditions, and local rules before relying on it."


def allowed_uses(tags: dict[str, Any]) -> list[str]:
    out = []
    for key, label in [("foot", "foot"), ("bicycle", "bike"), ("horse", "horse"), ("motor_vehicle", "motor vehicle"), ("atv", "OHV")]:
        if tags.get(key) in {"yes", "designated", "permissive", True}:
            out.append(label)
    return sorted_unique(out)


def amenities_from_tags(tags: dict[str, Any]) -> list[str]:
    out = []
    for key in ["drinking_water", "toilets", "shower", "fee", "fireplace", "picnic_table"]:
        if tags.get(key) in {"yes", "true", True}:
            out.append(key.replace("_", " "))
    return sorted_unique(out)


def write_import_outputs(records: list[SourceRecord], places: list[ExplorePlaceV3], trails: list[TrailGeometry], out_dir: str | Path) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "source_records.jsonl").write_text("\n".join(json.dumps(item.to_dict(), ensure_ascii=False) for item in records) + ("\n" if records else ""))
    (out / "places_v3.json").write_text(json.dumps([item.to_dict() for item in places], indent=2, ensure_ascii=False) + "\n")
    (out / "trail_geometries.json").write_text(json.dumps([item.to_dict() for item in trails], indent=2, ensure_ascii=False) + "\n")

