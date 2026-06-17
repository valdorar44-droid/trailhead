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


RIDB_LICENSE = "RIDB/Recreation.gov public API; verify current terms before redistribution"
RIDB_ATTRIBUTION = "RIDB / Recreation.gov"


def load_facilities(path: str | Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text())
    if isinstance(data, list):
        return data
    for key in ("RECDATA", "recdata", "data", "facilities"):
        if isinstance(data.get(key), list):
            return data[key]
    raise ValueError(f"unsupported RIDB fixture shape: {path}")


def import_ridb_fixture(path: str | Path, fetched_at: int | None = None) -> tuple[list[SourceRecord], list[ExplorePlaceV3], list[TrailGeometry]]:
    assert_source_allowed("ridb")
    now = int(fetched_at or time.time())
    records: list[SourceRecord] = []
    places: list[ExplorePlaceV3] = []
    for facility in load_facilities(path):
        record = source_record_from_facility(facility, now)
        if not record:
            continue
        records.append(record)
        place = place_from_record(record)
        if place:
            places.append(place)
    return records, places, []


def source_record_from_facility(facility: dict[str, Any], now: int) -> SourceRecord | None:
    source_id = compact_text(facility.get("FacilityID") or facility.get("facility_id") or facility.get("id"))
    name = compact_text(facility.get("FacilityName") or facility.get("name"))
    lat = as_float(facility.get("FacilityLatitude") or facility.get("latitude") or facility.get("lat"))
    lng = as_float(facility.get("FacilityLongitude") or facility.get("longitude") or facility.get("lng"))
    if not source_id or not name or lat is None or lng is None:
        return None
    source_url = compact_text(
        facility.get("FacilityReservationURL")
        or facility.get("ReservableURL")
        or facility.get("FacilityURL")
        or facility.get("url")
        or "https://www.recreation.gov/"
    )
    category = category_for_facility(facility)
    return SourceRecord(
        id=f"ridb:{source_id}",
        source="ridb",
        source_id=source_id,
        source_url=source_url,
        license=RIDB_LICENSE,
        attribution=RIDB_ATTRIBUTION,
        fetched_at=now,
        last_seen_at=now,
        raw=facility,
        name=name,
        category=category,
        subcategory=compact_text(facility.get("FacilityTypeDescription") or facility.get("facility_type")),
        lat=lat,
        lng=lng,
        geometry={"type": "Point", "coordinates": [lng, lat]},
        properties=facility,
        confidence=0.9,
    )


def category_for_facility(facility: dict[str, Any]) -> str:
    text = " ".join(compact_text(facility.get(key)).lower() for key in ("FacilityTypeDescription", "FacilityName", "FacilityDescription"))
    if "rv" in text:
        return "rv_park"
    if "camp" in text:
        return "campground"
    if "cabin" in text or "lookout" in text:
        return "hut"
    return "campground"


def place_from_record(record: SourceRecord) -> ExplorePlaceV3:
    props = record.properties
    source_ref = {
        "source": "ridb",
        "source_id": record.source_id,
        "url": record.source_url,
        "license": record.license,
        "attribution": record.attribution,
        "quality": quality_for_source("ridb"),
    }
    media = media_from_facility(props)
    place = ExplorePlaceV3(
        id=f"place:ridb:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        category=record.category,
        subcategories=sorted_unique([record.subcategory]),
        lat=record.lat,
        lng=record.lng,
        geometry=record.geometry,
        country=compact_text(props.get("CountryCode") or props.get("country")),
        region=compact_text(props.get("FacilityState") or props.get("state")),
        admin=compact_text(props.get("FacilityCity") or props.get("city")),
        summary=summary_from_facility(props, record.name),
        description=compact_text(props.get("FacilityDescription") or props.get("description")),
        tags=sorted_unique([record.category, record.subcategory, "official", "camping", "recreation.gov"]),
        amenities=amenities_from_facility(props),
        reservations=reservation_info(props),
        media=media,
        sources=[source_ref],
        quality=quality_for_source("ridb"),
        last_seen_at=record.last_seen_at,
        updated_at=record.fetched_at,
    )
    return apply_aliases(build_card(score_place(place)))


def summary_from_facility(facility: dict[str, Any], name: str) -> str:
    desc = compact_text(facility.get("FacilityDescription") or facility.get("description"))
    if desc:
        return desc[:420]
    return f"{name} is an official recreation facility record. Verify access, fees, fire restrictions, reservations, and seasonal road conditions before relying on it."


def amenities_from_facility(facility: dict[str, Any]) -> list[str]:
    values = []
    for key in ("FacilityUseFeeDescription", "FacilityAdaAccess", "Keywords", "ACTIVITY"):
        raw = facility.get(key)
        if isinstance(raw, list):
            values.extend(compact_text(item.get("ActivityName") if isinstance(item, dict) else item) for item in raw)
        elif raw:
            values.append(compact_text(raw))
    return sorted_unique(values)


def reservation_info(facility: dict[str, Any]) -> dict[str, Any]:
    url = compact_text(facility.get("FacilityReservationURL") or facility.get("ReservableURL"))
    reservable = facility.get("Reservable") or facility.get("reservable")
    return {
        **({"reservation_url": url} if url else {}),
        **({"reservable": bool(reservable)} if reservable not in (None, "") else {}),
    }


def media_from_facility(facility: dict[str, Any]) -> list[dict[str, Any]]:
    media = []
    raw_items = facility.get("MEDIA") or facility.get("media") or []
    if isinstance(raw_items, dict):
        raw_items = [raw_items]
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        url = compact_text(item.get("URL") or item.get("url"))
        if url:
            media.append({
                "url": url,
                "caption": compact_text(item.get("Title") or item.get("title") or facility.get("FacilityName")),
                "credit": compact_text(item.get("Credit") or item.get("credit") or RIDB_ATTRIBUTION),
                "license": RIDB_LICENSE,
            })
    return media


def as_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except Exception:
        return None
