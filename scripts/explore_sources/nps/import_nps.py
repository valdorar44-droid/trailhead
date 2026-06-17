from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from scripts.explore_sources.base.aliases import apply_aliases
from scripts.explore_sources.base.cards import build_card
from scripts.explore_sources.base.normalize import compact_text, slugify, sorted_unique
from scripts.explore_sources.base.quality import quality_for_source, score_place
from scripts.explore_sources.base.schema import ExplorePlaceV3, SourceRecord, TrailGeometry
from scripts.explore_sources.base.source_policy import assert_source_allowed


NPS_LICENSE = "National Park Service public data"
NPS_ATTRIBUTION = "National Park Service"


def load_parks(path: str | Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text())
    if isinstance(data, list):
        return data
    if isinstance(data.get("data"), list):
        return data["data"]
    if isinstance(data.get("parks"), list):
        return data["parks"]
    raise ValueError(f"unsupported NPS fixture shape: {path}")


def import_nps_fixture(path: str | Path, fetched_at: int | None = None) -> tuple[list[SourceRecord], list[ExplorePlaceV3], list[TrailGeometry]]:
    assert_source_allowed("nps")
    now = int(fetched_at or time.time())
    records: list[SourceRecord] = []
    places: list[ExplorePlaceV3] = []
    for park in load_parks(path):
        record = source_record_from_park(park, now)
        if not record:
            continue
        records.append(record)
        places.append(place_from_record(record))
    return records, places, []


def source_record_from_park(park: dict[str, Any], now: int) -> SourceRecord | None:
    source_id = compact_text(park.get("parkCode") or park.get("id"))
    name = compact_text(park.get("fullName") or park.get("name"))
    lat = as_float(park.get("latitude") or park.get("lat"))
    lng = as_float(park.get("longitude") or park.get("lng"))
    if not source_id or not name or lat is None or lng is None:
        return None
    url = compact_text(park.get("url") or f"https://www.nps.gov/{source_id}/index.htm")
    return SourceRecord(
        id=f"nps:{source_id}",
        source="nps",
        source_id=source_id,
        source_url=url,
        license=NPS_LICENSE,
        attribution=NPS_ATTRIBUTION,
        fetched_at=now,
        last_seen_at=now,
        raw=park,
        name=name,
        category="park",
        subcategory=compact_text(park.get("designation") or "national_park"),
        lat=lat,
        lng=lng,
        geometry={"type": "Point", "coordinates": [lng, lat]},
        properties=park,
        confidence=0.95,
    )


def place_from_record(record: SourceRecord) -> ExplorePlaceV3:
    park = record.properties
    source_ref = {
        "source": "nps",
        "source_id": record.source_id,
        "url": record.source_url,
        "license": record.license,
        "attribution": record.attribution,
        "quality": quality_for_source("nps"),
    }
    place = ExplorePlaceV3(
        id=f"place:nps:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        category="park",
        subcategories=sorted_unique([record.subcategory]),
        lat=record.lat,
        lng=record.lng,
        geometry=record.geometry,
        country="US",
        region=compact_text(park.get("states") or park.get("state")),
        admin=compact_text(park.get("addresses", [{}])[0].get("city") if isinstance(park.get("addresses"), list) and park.get("addresses") else ""),
        summary=summary_from_park(park, record.name),
        description=compact_text(park.get("description")),
        tags=sorted_unique(["park", "official", "nps", record.subcategory, *(activity_names(park))]),
        amenities=activity_names(park),
        media=media_from_park(park),
        sources=[source_ref],
        quality=quality_for_source("nps"),
        last_seen_at=record.last_seen_at,
        updated_at=record.fetched_at,
    )
    return apply_aliases(build_card(score_place(place)))


def summary_from_park(park: dict[str, Any], name: str) -> str:
    desc = compact_text(park.get("description"))
    if desc:
        return desc[:420]
    return f"{name} is an official National Park Service place record. Check current access, fees, permits, alerts, road status, and weather before building a route around it."


def activity_names(park: dict[str, Any]) -> list[str]:
    values = []
    for item in park.get("activities") or []:
        if isinstance(item, dict):
            values.append(item.get("name"))
        else:
            values.append(item)
    return sorted_unique(values)


def media_from_park(park: dict[str, Any]) -> list[dict[str, Any]]:
    media = []
    for item in park.get("images") or []:
        if not isinstance(item, dict):
            continue
        url = compact_text(item.get("url"))
        if url:
            media.append({
                "url": url,
                "caption": compact_text(item.get("caption") or item.get("title") or park.get("fullName")),
                "credit": compact_text(item.get("credit") or NPS_ATTRIBUTION),
                "license": NPS_LICENSE,
            })
    return media


def as_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except Exception:
        return None
