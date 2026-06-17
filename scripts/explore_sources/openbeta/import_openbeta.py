from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from scripts.explore_sources.base.aliases import apply_aliases
from scripts.explore_sources.base.cards import build_card
from scripts.explore_sources.base.normalize import compact_text, representative_point, slugify, sorted_unique
from scripts.explore_sources.base.quality import quality_for_source, score_place
from scripts.explore_sources.base.schema import ExplorePlaceV3, SourceRecord, TrailGeometry
from scripts.explore_sources.base.source_policy import assert_source_allowed


OPENBETA_LICENSE = "OpenBeta open climbing data; verify current dataset terms before redistribution"
OPENBETA_ATTRIBUTION = "OpenBeta contributors"


def load_records(path: str | Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text())
    if isinstance(data, list):
        return data
    if data.get("type") == "FeatureCollection":
        return list(data.get("features") or [])
    if data.get("type") == "Feature":
        return [data]
    for key in ("areas", "crags", "records", "data", "features"):
        if isinstance(data.get(key), list):
            return data[key]
    raise ValueError(f"unsupported OpenBeta fixture shape: {path}")


def import_openbeta_fixture(path: str | Path, fetched_at: int | None = None) -> tuple[list[SourceRecord], list[ExplorePlaceV3], list[TrailGeometry]]:
    assert_source_allowed("openbeta")
    now = int(fetched_at or time.time())
    records: list[SourceRecord] = []
    places: list[ExplorePlaceV3] = []
    for item in load_records(path):
        record = source_record_from_item(item, now)
        if not record:
            continue
        records.append(record)
        place = place_from_record(record)
        if place:
            places.append(place)
    return records, places, []


def source_record_from_item(item: dict[str, Any], now: int) -> SourceRecord | None:
    props = properties_from_item(item)
    geometry = item.get("geometry") if isinstance(item.get("geometry"), dict) else props.get("geometry")
    lat, lng = representative_point(geometry)
    if lat is None or lng is None:
        lat = as_float(props.get("lat") or props.get("latitude"))
        lng = as_float(props.get("lng") or props.get("lon") or props.get("longitude"))
    if lat is None or lng is None:
        return None
    source_id = compact_text(props.get("uuid") or props.get("id") or props.get("_id") or props.get("area_id"))
    name = compact_text(props.get("area_name") or props.get("name") or props.get("title"))
    if not source_id:
        source_id = slugify(name or f"{lat},{lng}")[:80]
    if not name:
        name = source_id
    category, subcategory = category_for_props(props)
    url = compact_text(props.get("url") or props.get("source_url") or f"https://openbeta.io/crag/{source_id}")
    return SourceRecord(
        id=f"openbeta:{source_id}",
        source="openbeta",
        source_id=source_id,
        source_url=url,
        license=OPENBETA_LICENSE,
        attribution=OPENBETA_ATTRIBUTION,
        fetched_at=now,
        last_seen_at=now,
        raw=item,
        name=name,
        category=category,
        subcategory=subcategory,
        lat=lat,
        lng=lng,
        geometry=geometry or {"type": "Point", "coordinates": [lng, lat]},
        properties=props,
        confidence=0.74,
    )


def properties_from_item(item: dict[str, Any]) -> dict[str, Any]:
    props = dict(item.get("properties") or {})
    for key, value in item.items():
        if key not in {"type", "geometry", "properties"}:
            props.setdefault(key, value)
    metadata = props.get("metadata")
    if isinstance(metadata, dict):
        for key, value in metadata.items():
            props.setdefault(key, value)
    return props


def category_for_props(props: dict[str, Any]) -> tuple[str, str]:
    disciplines = [value.lower() for value in list_values(props.get("disciplines") or props.get("types") or props.get("climbing_type"))]
    text = " ".join(compact_text(value).lower() for value in [
        props.get("type"),
        props.get("category"),
        props.get("area_type"),
        props.get("climbing_type"),
        " ".join(props.get("disciplines") or []) if isinstance(props.get("disciplines"), list) else props.get("disciplines"),
        props.get("description"),
        props.get("name"),
    ])
    if disciplines == ["bouldering"] or "bouldering area" in text or "boulder field" in text:
        return "bouldering_area", "bouldering"
    return "climbing_area", "climbing_area"


def place_from_record(record: SourceRecord) -> ExplorePlaceV3 | None:
    props = record.properties
    media = media_from_props(props)
    disciplines = list_values(props.get("disciplines") or props.get("types") or props.get("climbing_type"))
    grade_range = compact_text(props.get("grade_range") or props.get("grades") or "")
    route_count = as_int(props.get("route_count") or props.get("total_routes") or props.get("routes"))
    facts = sorted_unique([*disciplines, grade_range, f"{route_count} routes" if route_count else ""])
    place = ExplorePlaceV3(
        id=f"place:openbeta:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        category=record.category,
        subcategories=sorted_unique([record.subcategory, *disciplines]),
        lat=record.lat,
        lng=record.lng,
        geometry=record.geometry,
        country=compact_text(props.get("country") or props.get("country_code") or ""),
        region=compact_text(props.get("region") or props.get("state") or ""),
        admin=compact_text(props.get("area") or props.get("parent_area") or props.get("admin") or ""),
        summary=summary_from_record(record, facts),
        description=compact_text(props.get("description") or ""),
        tags=sorted_unique([
            record.category,
            record.subcategory,
            "openbeta",
            "climbing",
            *disciplines,
            grade_range,
            props.get("rock_type"),
        ]),
        difficulty=grade_range,
        access=compact_text(props.get("access") or props.get("access_notes") or ""),
        safety=compact_text(props.get("hazards") or props.get("safety") or ""),
        amenities=facts,
        media=media,
        sources=[source_ref(record)],
        quality=quality_for_source("openbeta"),
        last_seen_at=record.last_seen_at,
        updated_at=record.fetched_at,
    )
    return apply_aliases(build_card(score_place(place)))


def source_ref(record: SourceRecord) -> dict[str, Any]:
    return {
        "source": "openbeta",
        "source_id": record.source_id,
        "url": record.source_url,
        "license": record.license,
        "attribution": record.attribution,
        "quality": quality_for_source("openbeta"),
    }


def summary_from_record(record: SourceRecord, facts: list[str]) -> str:
    description = compact_text(record.properties.get("description"))
    if description:
        return description[:420]
    detail = compact_text(", ".join(facts))
    suffix = f" Known details: {detail}." if detail else ""
    readable = record.category.replace("_", " ")
    return f"{record.name} is an OpenBeta-linked {readable}.{suffix} Verify access, closures, grades, route condition, and local ethics before climbing."


def media_from_props(props: dict[str, Any]) -> list[dict[str, Any]]:
    media = []
    raw_items = props.get("media") or props.get("images") or []
    if isinstance(raw_items, dict):
        raw_items = [raw_items]
    if props.get("image_url") or props.get("image"):
        raw_items = [
            {
                "url": props.get("image_url") or props.get("image"),
                "caption": props.get("image_caption") or props.get("name") or props.get("area_name"),
                "credit": props.get("image_credit") or OPENBETA_ATTRIBUTION,
                "license": props.get("image_license") or OPENBETA_LICENSE,
            },
            *raw_items,
        ]
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        url = compact_text(item.get("url") or item.get("src"))
        if url:
            media.append({
                "url": url,
                "caption": compact_text(item.get("caption") or item.get("title") or props.get("name") or props.get("area_name")),
                "credit": compact_text(item.get("credit") or OPENBETA_ATTRIBUTION),
                "license": compact_text(item.get("license") or OPENBETA_LICENSE),
            })
    return media


def list_values(value: Any) -> list[str]:
    if isinstance(value, list):
        return sorted_unique(value)
    if isinstance(value, str):
        return sorted_unique(part.strip() for part in value.replace("|", ",").split(","))
    return []


def as_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except Exception:
        return None


def as_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except Exception:
        return None
