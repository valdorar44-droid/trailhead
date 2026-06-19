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
    data = load_payload(path)
    if isinstance(data, list):
        return data
    if isinstance(data.get("data"), list):
        return data["data"]
    if isinstance(data.get("parks"), list):
        return data["parks"]
    raise ValueError(f"unsupported NPS fixture shape: {path}")


def load_payload(path: str | Path) -> dict[str, Any] | list[dict[str, Any]]:
    return json.loads(Path(path).read_text())


def import_nps_fixture(path: str | Path, fetched_at: int | None = None) -> tuple[list[SourceRecord], list[ExplorePlaceV3], list[TrailGeometry]]:
    assert_source_allowed("nps")
    now = int(fetched_at or time.time())
    payload = load_payload(path)
    related = related_by_park_code(payload)
    records: list[SourceRecord] = []
    places: list[ExplorePlaceV3] = []
    for park in parks_from_payload(payload):
        record = source_record_from_park(park, now)
        if not record:
            continue
        records.append(record)
        places.append(place_from_record(record, related=related.get(record.source_id.lower(), {})))
    return records, places, []


def parks_from_payload(payload: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload.get("data"), list):
        return payload["data"]
    if isinstance(payload.get("parks"), list):
        return payload["parks"]
    return []


def related_by_park_code(payload: dict[str, Any] | list[dict[str, Any]]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("related"), dict):
        return {}
    out: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for park_code, endpoints in payload["related"].items():
        if not isinstance(endpoints, dict):
            continue
        endpoint_map: dict[str, list[dict[str, Any]]] = {}
        for endpoint, items in endpoints.items():
            if isinstance(items, list):
                endpoint_map[str(endpoint).strip().lower()] = [item for item in items if isinstance(item, dict)]
        out[str(park_code).strip().lower()] = endpoint_map
    return out


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


def place_from_record(record: SourceRecord, related: dict[str, list[dict[str, Any]]] | None = None) -> ExplorePlaceV3:
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
        media=media_from_park(park, related=related),
        source_pack=source_pack_from_park(park, record, related or {}),
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


def media_from_park(park: dict[str, Any], related: dict[str, list[dict[str, Any]]] | None = None) -> list[dict[str, Any]]:
    media: list[dict[str, Any]] = []
    for item in park.get("images") or []:
        if not isinstance(item, dict):
            continue
        add_media(media, item, fallback_title=compact_text(park.get("fullName") or park.get("name")))
    for items in (related or {}).values():
        for child in items:
            for image in child.get("images") or []:
                if isinstance(image, dict):
                    add_media(media, image, fallback_title=compact_text(child_title(child) or park.get("fullName")))
    return media[:20]


def source_pack_from_park(park: dict[str, Any], record: SourceRecord, related: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    photos = media_from_park(park, related=related)
    things_to_do = dedupe_items([
        source_pack_item(item, "thing_to_do", park_code=record.source_id)
        for item in related.get("thingstodo", [])
    ])
    things_to_see = dedupe_items([
        source_pack_item(item, "place", park_code=record.source_id)
        for item in [*related.get("places", []), *related.get("articles", [])]
    ])
    visitor_centers = dedupe_items([
        source_pack_item(item, "visitor_center", park_code=record.source_id)
        for item in related.get("visitorcenters", [])
    ])
    campgrounds = dedupe_items([
        source_pack_item(item, "campground", park_code=record.source_id)
        for item in related.get("campgrounds", [])
    ])
    source_ref = {
        "title": compact_text(park.get("fullName") or park.get("name") or record.name),
        "publisher": NPS_ATTRIBUTION,
        "url": record.source_url,
        "kind": "official",
    }
    return {
        "quality": "official",
        "primary": NPS_ATTRIBUTION,
        "official_url": record.source_url,
        "nps_park_code": record.source_id,
        "sources": [source_ref],
        "photos": photos,
        "activities": activity_names(park),
        "topics": topic_names(park),
        "things_to_do": things_to_do,
        "things_to_see": things_to_see,
        "visitor_centers": visitor_centers,
        "campgrounds": campgrounds,
        "fees": fee_lines(park),
        "operating_hours": operating_hours(park),
        "alerts": alert_items(related.get("alerts", [])),
        "source_note": "Official National Park Service data",
        "extract": summary_from_park(park, record.name),
        "license": NPS_LICENSE,
    }


def add_media(media: list[dict[str, Any]], item: dict[str, Any], fallback_title: str = "") -> None:
    url = compact_text(item.get("url"))
    if not url:
        return
    photo = {
        "url": url,
        "caption": compact_text(item.get("caption") or item.get("title") or fallback_title),
        "credit": compact_text(item.get("credit") or NPS_ATTRIBUTION),
        "license": NPS_LICENSE,
    }
    if all(existing.get("url") != url for existing in media):
        media.append(photo)


def source_pack_item(item: dict[str, Any], kind: str, park_code: str) -> dict[str, Any]:
    lat, lng = item_lat_lng(item)
    image = first_image(item)
    title = child_title(item)
    return {
        "kind": kind,
        "source": "nps",
        "source_id": compact_text(item.get("id") or item.get("url") or slugify(title)),
        "title": title,
        "description": child_description(item),
        "url": child_url(item, park_code),
        "lat": lat,
        "lng": lng,
        "image_url": image.get("url") or "",
        "image_caption": compact_text(image.get("caption") or image.get("title") or title),
        "image_credit": compact_text(image.get("credit") or NPS_ATTRIBUTION),
        "image_license": NPS_LICENSE,
    }


def child_title(item: dict[str, Any]) -> str:
    return compact_text(item.get("title") or item.get("fullName") or item.get("name") or item.get("listingTitle"))


def child_description(item: dict[str, Any]) -> str:
    return compact_text(
        item.get("shortDescription")
        or item.get("listingDescription")
        or item.get("description")
        or item.get("abstract")
    )[:320]


def child_url(item: dict[str, Any], park_code: str) -> str:
    url = compact_text(item.get("url"))
    if url:
        return url
    if park_code:
        return f"https://www.nps.gov/{park_code}/index.htm"
    return ""


def item_lat_lng(item: dict[str, Any]) -> tuple[float | None, float | None]:
    lat = as_float(item.get("latitude") or item.get("lat"))
    lng = as_float(item.get("longitude") or item.get("lng"))
    if lat is not None and lng is not None:
        return lat, lng
    lat_long = compact_text(item.get("latLong"))
    if lat_long:
        parts = {}
        for part in lat_long.replace(";", ",").split(","):
            if ":" not in part:
                continue
            key, value = part.split(":", 1)
            parts[key.strip().lower()] = value.strip()
        lat = as_float(parts.get("lat") or parts.get("latitude"))
        lng = as_float(parts.get("long") or parts.get("lng") or parts.get("longitude"))
    return lat, lng


def first_image(item: dict[str, Any]) -> dict[str, Any]:
    for image in item.get("images") or []:
        if isinstance(image, dict) and image.get("url"):
            return image
    return {}


def dedupe_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        title = compact_text(item.get("title"))
        if not title:
            continue
        key = "|".join([
            compact_text(item.get("source_id")),
            title.lower(),
            str(item.get("lat") or ""),
            str(item.get("lng") or ""),
        ])
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out[:12]


def topic_names(park: dict[str, Any]) -> list[str]:
    values = []
    for item in park.get("topics") or []:
        if isinstance(item, dict):
            values.append(item.get("name"))
        else:
            values.append(item)
    return sorted_unique(values)


def fee_lines(park: dict[str, Any]) -> list[str]:
    out = []
    for item in park.get("entranceFees") or []:
        if not isinstance(item, dict):
            continue
        title = compact_text(item.get("title") or item.get("description") or "Entrance")
        cost = compact_text(item.get("cost"))
        line = f"{title}: {format_cost(cost)}" if cost else title
        if line not in out:
            out.append(line)
    return out[:6]


def format_cost(value: str) -> str:
    try:
        cost = float(value)
    except Exception:
        return value
    if cost <= 0:
        return "Free"
    return f"${cost:.0f}" if cost.is_integer() else f"${cost:.2f}"


def operating_hours(park: dict[str, Any]) -> str:
    for item in park.get("operatingHours") or []:
        if not isinstance(item, dict):
            continue
        name = compact_text(item.get("name"))
        description = compact_text(item.get("description"))
        if description and name:
            return f"{name}: {description}"[:360]
        if description:
            return description[:360]
        standard = item.get("standardHours") if isinstance(item.get("standardHours"), dict) else {}
        open_days = [day.title() for day, value in standard.items() if compact_text(value).lower() not in ("", "closed")]
        if open_days and name:
            return f"{name}: open {', '.join(open_days[:7])}"
    return ""


def alert_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = compact_text(item.get("title"))
        if not title:
            continue
        out.append({
            "title": title,
            "category": compact_text(item.get("category")),
            "url": compact_text(item.get("url")),
        })
    return out[:8]


def as_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except Exception:
        return None
