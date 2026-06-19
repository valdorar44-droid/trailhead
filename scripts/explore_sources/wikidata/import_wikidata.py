from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from scripts.explore_sources.base.aliases import apply_aliases
from scripts.explore_sources.base.cards import build_card
from scripts.explore_sources.base.normalize import compact_text, representative_point, slugify, sorted_unique
from scripts.explore_sources.base.quality import quality_for_source, score_place
from scripts.explore_sources.base.schema import ExplorePlaceV3, SourceRecord, TrailGeometry
from scripts.explore_sources.base.source_policy import assert_source_allowed


WIKIDATA_LICENSE = "Creative Commons CC0 1.0 (Wikidata); verify media license per item"
WIKIDATA_ATTRIBUTION = "Wikidata contributors"


def load_records(path: str | Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text())
    if isinstance(data, list):
        return data
    if data.get("type") == "FeatureCollection":
        return list(data.get("features") or [])
    if data.get("type") == "Feature":
        return [data]
    for key in ("records", "items", "bindings", "data", "features"):
        if isinstance(data.get(key), list):
            return data[key]
    raise ValueError(f"unsupported Wikidata fixture shape: {path}")


def import_wikidata_fixture(path: str | Path, fetched_at: int | None = None) -> tuple[list[SourceRecord], list[ExplorePlaceV3], list[TrailGeometry]]:
    assert_source_allowed("wikidata")
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
        lat, lng = coordinates_from_props(props)
    if lat is None or lng is None:
        return None
    source_id = compact_text(props.get("qid") or props.get("id") or props.get("wikidata_id") or props.get("item"))
    if source_id.startswith("http://www.wikidata.org/entity/"):
        source_id = source_id.rsplit("/", 1)[-1]
    name = compact_text(props.get("label") or props.get("name") or props.get("title"))
    if not source_id:
        source_id = slugify(name or f"{lat},{lng}")[:80]
    if not name:
        name = source_id
    category, subcategory = category_for_props(props)
    url = compact_text(props.get("wikidata_url") or props.get("url") or f"https://www.wikidata.org/wiki/{source_id}")
    return SourceRecord(
        id=f"wikidata:{source_id}",
        source="wikidata",
        source_id=source_id,
        source_url=url,
        license=WIKIDATA_LICENSE,
        attribution=WIKIDATA_ATTRIBUTION,
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
        confidence=0.78,
    )


def properties_from_item(item: dict[str, Any]) -> dict[str, Any]:
    props = dict(item.get("properties") or {})
    for key, value in item.items():
        if key not in {"type", "geometry", "properties"}:
            props.setdefault(key, value)
    for key, value in list(props.items()):
        if isinstance(value, dict) and "value" in value and len(value) <= 3:
            props[key] = value.get("value")
    return props


def category_for_props(props: dict[str, Any]) -> tuple[str, str]:
    text = " ".join(compact_text(value).lower() for value in [
        props.get("category"),
        props.get("type"),
        props.get("instance_of"),
        props.get("instance_of_label"),
        props.get("P31"),
        props.get("description"),
        props.get("label"),
        props.get("name"),
        " ".join(props.get("tags") or []) if isinstance(props.get("tags"), list) else props.get("tags"),
    ])
    if "glacier" in text or "icefield" in text:
        return "glacier", "glacier"
    if "waterfall" in text or "cascade" in text:
        return "waterfall", "waterfall"
    if "mountain pass" in text or " pass" in text:
        return "viewpoint", "mountain_pass"
    if any(term in text for term in ("mountain", "peak", "summit", "eight-thousander", "eight thousander")):
        return "peak", "mountain"
    if "hot spring" in text or "thermal spring" in text:
        return "hot_spring", "hot_spring"
    if "lake" in text or "reservoir" in text:
        return "lake", "lake"
    if any(term in text for term in ("monument", "heritage", "archaeological", "historic", "fort", "ruins")):
        return "historic_site", "historic_site"
    if "viewpoint" in text or "overlook" in text or "scenic" in text or "valley" in text:
        return "viewpoint", "viewpoint"
    if "national park" in text or "park" in text:
        return "park", "park"
    if "protected area" in text or "conservation" in text:
        return "public_land", "protected_area"
    return "viewpoint", "landmark"


def place_from_record(record: SourceRecord) -> ExplorePlaceV3 | None:
    props = record.properties
    aliases = aliases_from_props(props)
    place = ExplorePlaceV3(
        id=f"place:wikidata:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        category=record.category,
        subcategories=sorted_unique([record.subcategory]),
        lat=record.lat,
        lng=record.lng,
        geometry=record.geometry,
        country=compact_text(props.get("country") or props.get("country_code") or ""),
        region=compact_text(props.get("region") or props.get("state") or props.get("admin1") or ""),
        admin=compact_text(props.get("admin") or props.get("district") or props.get("located_in") or ""),
        summary=summary_from_record(record),
        description=compact_text(props.get("description") or ""),
        tags=sorted_unique([
            record.category,
            record.subcategory,
            "wikidata",
            "wikipedia",
            props.get("instance_of"),
            props.get("instance_of_label"),
            *(props.get("tags") if isinstance(props.get("tags"), list) else []),
        ]),
        search_aliases=aliases,
        media=media_from_props(props),
        sources=[source_ref(record)],
        quality=quality_for_source("wikidata"),
        last_seen_at=record.last_seen_at,
        updated_at=record.fetched_at,
    )
    return apply_aliases(build_card(score_place(place)))


def source_ref(record: SourceRecord) -> dict[str, Any]:
    return {
        "source": "wikidata",
        "source_id": record.source_id,
        "url": record.source_url,
        "license": record.license,
        "attribution": record.attribution,
        "quality": quality_for_source("wikidata"),
    }


def summary_from_record(record: SourceRecord) -> str:
    description = compact_text(record.properties.get("description"))
    if description:
        return sentence_safe_preview(description, 520)
    readable = record.category.replace("_", " ")
    return f"{record.name} is a Wikidata-linked {readable} landmark. Verify access, local conditions, restrictions, and route details before relying on it."


def sentence_safe_preview(value: Any, max_chars: int) -> str:
    text = compact_text(value)
    if not text or len(text) <= max_chars:
        return text
    boundaries = [match.end() for match in re.finditer(r'[.!?](?=(?:["\')\]]|\s|$))', text)]
    if not boundaries:
        return text
    min_chars = min(max(90, int(max_chars * 0.45)), max_chars)
    before = next((idx for idx in reversed(boundaries) if min_chars <= idx <= max_chars), None)
    after = next((idx for idx in boundaries if max_chars < idx <= int(max_chars * 1.45)), None)
    cut = before or after
    if not cut:
        return text
    return text[:cut].strip()


def aliases_from_props(props: dict[str, Any]) -> list[str]:
    aliases: list[Any] = []
    for key in ("aliases", "also_known_as", "aka", "alternate_names", "native_label"):
        value = props.get(key)
        if isinstance(value, list):
            aliases.extend(value)
        elif isinstance(value, str):
            aliases.extend(part.strip() for part in value.split("|"))
    return sorted_unique(aliases)


def media_from_props(props: dict[str, Any]) -> list[dict[str, Any]]:
    media = []
    raw_items = props.get("media") or props.get("images") or []
    if isinstance(raw_items, dict):
        raw_items = [raw_items]
    if props.get("image_url") or props.get("image"):
        raw_items = [
            {
                "url": props.get("image_url") or props.get("image"),
                "caption": props.get("image_caption") or props.get("label") or props.get("name"),
                "credit": props.get("image_credit") or "Wikimedia Commons",
                "license": props.get("image_license") or "Wikimedia Commons",
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
                "caption": compact_text(item.get("caption") or item.get("title") or props.get("label") or props.get("name")),
                "credit": compact_text(item.get("credit") or item.get("artist") or "Wikimedia Commons"),
                "license": compact_text(item.get("license") or props.get("image_license") or "Wikimedia Commons"),
            })
    return media


def coordinates_from_props(props: dict[str, Any]) -> tuple[float | None, float | None]:
    coord = props.get("coordinates") or props.get("coord")
    if isinstance(coord, dict):
        lat = as_float(coord.get("lat") or coord.get("latitude"))
        lng = as_float(coord.get("lng") or coord.get("lon") or coord.get("longitude"))
        if lat is not None and lng is not None:
            return lat, lng
    if isinstance(coord, str):
        parts = [part.strip() for part in coord.replace(",", " ").split()]
        if len(parts) >= 2:
            lat = as_float(parts[0])
            lng = as_float(parts[1])
            if lat is not None and lng is not None:
                return lat, lng
    return (
        as_float(props.get("lat") or props.get("latitude")),
        as_float(props.get("lng") or props.get("lon") or props.get("longitude")),
    )


def as_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except Exception:
        return None
