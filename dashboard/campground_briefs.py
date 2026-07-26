"""Deterministic, source-owned campground briefs.

The public campground brief is assembled from normalized campground records.
It does not generate prose, infer suitability, or turn missing data into
assurance. Personalized planning remains a separate, explicitly requested
feature.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit


CAMPGROUND_BRIEF_SCHEMA_VERSION = "campground-brief-v3"

_SOURCE_LABELS = {
    "ridb": "Recreation.gov",
    "recreation.gov": "Recreation.gov",
    "nps": "National Park Service",
    "national park service": "National Park Service",
    "usfs": "USDA Forest Service",
    "usda forest service": "USDA Forest Service",
    "blm": "Bureau of Land Management",
    "blm recreation": "Bureau of Land Management",
    "osm": "OpenStreetMap contributors",
    "openstreetmap": "OpenStreetMap contributors",
    "trailhead": "Trailhead",
    "active": "ReserveAmerica",
}

_SERVICE_LABELS = {
    "fuel": "Fuel",
    "propane": "Propane",
    "water": "Water",
    "grocery": "Groceries",
    "mechanic": "Repairs",
    "parts": "Vehicle parts",
    "hardware": "Hardware",
    "medical": "Medical help",
    "trailhead": "Trailhead",
    "viewpoint": "Viewpoint",
    "dump": "Dump station",
    "parking": "Parking",
    "food": "Food",
    "wifi": "Wi-Fi",
}

_MATERIAL_UNAVAILABLE = (
    ("operating_season", "Operating season"),
    ("max_rig_length", "Maximum rig length"),
    ("road_surface", "Road surface"),
    ("mobile_coverage", "Mobile coverage"),
)


def _clean_text(value: object, limit: int = 500) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = text.replace("\u00c2\u00b7", " \u00b7 ").replace("\u00e2\u20ac\u201d", "\u2014")
    return text[:limit]


def _unique_text(values: object, *, limit: int = 30, item_limit: int = 120) -> list[str]:
    if not isinstance(values, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = _clean_text(value, item_limit)
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        result.append(text)
        if len(result) >= limit:
            break
    return result


def _safe_url(value: object) -> str | None:
    text = _clean_text(value, 700)
    if not text:
        return None
    try:
        parsed = urlsplit(text)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    if parsed.username or parsed.password:
        return None
    return text


def _source_label(value: object, fallback: str = "Camp listing") -> str:
    text = _clean_text(value, 100)
    if not text:
        return fallback
    mapped = _SOURCE_LABELS.get(text.casefold())
    if mapped:
        return mapped
    if re.search(r"\b(provider|internal|cache|api|slug)\b", text, re.I):
        return fallback
    return text


def _timestamp(value: object) -> int | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        number = int(value)
        if 946684800 <= number <= 4102444800:
            return number
        return None
    text = _clean_text(value, 80)
    if not text:
        return None
    if text.isdigit():
        return _timestamp(int(text))
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp())
    except ValueError:
        return None


def _positive_number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _fact(identifier: str, label: str, value: object, source_ids: list[str] | None = None) -> dict | None:
    text = _clean_text(value, 500)
    if not text:
        return None
    return {
        "id": identifier,
        "label": label,
        "value": text,
        "source_ids": source_ids or ["camp_listing"],
    }


def _site_records(detail: dict) -> list[dict]:
    return [item for item in (detail.get("campsites") or []) if isinstance(item, dict)]


def _site_surface(detail: dict) -> list[str]:
    return _unique_text([item.get("surface") for item in _site_records(detail) if item.get("surface")], limit=5)


def _site_driveway(detail: dict) -> list[str]:
    return _unique_text([item.get("driveway") for item in _site_records(detail) if item.get("driveway")], limit=5)


def _site_rig_length(detail: dict) -> str:
    explicit = _clean_text(detail.get("max_rig_length"), 100)
    if explicit:
        return explicit
    values: list[tuple[float, str]] = []
    for item in _site_records(detail):
        raw = _clean_text(item.get("equipment_length"), 80)
        match = re.search(r"(\d+(?:\.\d+)?)", raw)
        if not match:
            continue
        try:
            values.append((float(match.group(1)), raw))
        except ValueError:
            continue
    if not values:
        return ""
    return f"Up to {max(values)[1]} in listed site records"


def _coverage(detail: dict) -> dict | None:
    raw = detail.get("mobile_coverage")
    if not isinstance(raw, dict):
        return None
    records = []
    for item in raw.get("records") or []:
        if not isinstance(item, dict):
            continue
        provider = _clean_text(item.get("provider"), 80)
        technology = _clean_text(item.get("technology"), 50)
        availability = _clean_text(item.get("availability_class"), 80)
        if not provider and not technology:
            continue
        records.append({
            "provider": provider or "Mobile carrier",
            "technology": technology or "Mobile broadband",
            "availability": {
                "modeled_available": "Modeled coverage",
                "not_modeled_available": "Not shown in modeled coverage",
                "crowdsourced_good": "Crowdsourced: good",
                "crowdsourced_fair": "Crowdsourced: fair",
                "crowdsourced_weak": "Crowdsourced: weak",
            }.get(availability, "Availability not classified"),
            "data_date": _clean_text(item.get("data_date"), 40) or None,
        })
        if len(records) >= 6:
            break
    source = raw.get("modeled_source") if isinstance(raw.get("modeled_source"), dict) else {}
    if not records and not source:
        return None
    return {
        "records": records,
        "source_label": _source_label(
            raw.get("source_label") or source.get("source_label"),
            "FCC mobile coverage",
        ),
        "source_url": _safe_url(source.get("url")),
        "last_checked": _timestamp(raw.get("last_checked")),
        "notice": (
            "Coverage is modeled or observational and may differ at a campsite."
            if records or source else ""
        ),
    }


def _distance_miles(origin: tuple[float, float] | None, item: dict) -> float | None:
    explicit = _positive_number(item.get("distance_mi") or item.get("route_distance_mi"))
    if explicit is not None:
        return round(explicit, 1)
    if not origin:
        return None
    try:
        lat2 = float(item.get("lat"))
        lng2 = float(item.get("lng"))
    except (TypeError, ValueError):
        return None
    lat1, lng1 = origin
    if not all(math.isfinite(value) for value in (lat1, lng1, lat2, lng2)):
        return None
    radius = 3958.7613
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return round(2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 1)


def _nearby_rows(items: object, origin: tuple[float, float] | None, *, limit: int = 16) -> list[dict]:
    if not isinstance(items, list):
        return []
    rows: list[dict] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("name"), 140)
        kind = _clean_text(item.get("display_type") or item.get("type") or item.get("category"), 60).casefold()
        if not name:
            continue
        label = _SERVICE_LABELS.get(kind, _clean_text(item.get("display_type") or item.get("subtype") or kind, 60).title())
        label = label or "Place"
        distance = _distance_miles(origin, item)
        key = f"{kind}:{name.casefold()}:{distance}"
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "id": _clean_text(item.get("id") or key, 180),
            "name": name,
            "kind": kind or "place",
            "label": label,
            "distance_mi": distance,
            "source_label": _source_label(
                item.get("source_label") or item.get("source_badge") or item.get("source"),
                "Mapped place",
            ),
            "url": _safe_url(item.get("official_url") or item.get("url") or item.get("website")),
        })
    return sorted(
        rows,
        key=lambda row: (
            row["distance_mi"] is None,
            row["distance_mi"] if row["distance_mi"] is not None else 9999,
            row["label"].casefold(),
            row["name"].casefold(),
        ),
    )[:limit]


def _source_revision(evidence: dict) -> str:
    payload = json.dumps(evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_campground_brief_v3(
    detail: dict,
    *,
    requested_id: str = "",
    nearby_services: list[dict] | None = None,
    generated_at: int | None = None,
) -> dict:
    """Build a factual campground brief from source-owned detail."""
    if not isinstance(detail, dict):
        raise ValueError("Campground detail is required")

    name = _clean_text(detail.get("name"), 160) or "Campground"
    entity_id = _clean_text(detail.get("id") or requested_id, 180)
    if not entity_id:
        raise ValueError("Campground identity is required")

    source = _source_label(
        detail.get("verified_source")
        or detail.get("source_badge")
        or detail.get("source_label")
        or detail.get("source"),
    )
    source_url = _safe_url(detail.get("official_url") or detail.get("url"))
    booking_url = _safe_url(detail.get("booking_url"))
    last_checked = _timestamp(
        detail.get("last_checked")
        or detail.get("source_updated_at")
        or detail.get("fetched_at")
        or detail.get("updated_at")
    )
    origin = None
    try:
        lat = float(detail.get("lat"))
        lng = float(detail.get("lng"))
        if math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180:
            origin = (lat, lng)
    except (TypeError, ValueError):
        pass

    source_ids = ["camp_listing"]
    facts: list[dict] = []
    camp_type = _clean_text(detail.get("land_type") or detail.get("type"), 100)
    if item := _fact("camp_type", "Camp type", camp_type, source_ids):
        facts.append(item)
    site_count = int(_positive_number(detail.get("campsites_count")) or 0)
    if site_count:
        facts.append(_fact("site_count", "Sites", str(site_count), source_ids))
    if detail.get("reservable") is True:
        facts.append(_fact("reservability", "Reservations", "Available for listed inventory", source_ids))
    elif detail.get("reservable") is False:
        facts.append(_fact("reservability", "Reservations", "Not listed as reservable", source_ids))
    cost = _clean_text(
        (detail.get("price_summary") or {}).get("label")
        if isinstance(detail.get("price_summary"), dict)
        else "",
        180,
    ) or _clean_text(detail.get("cost"), 180)
    if cost and not re.fullmatch(r"check (?:local )?(?:rules|details|website)", cost, re.I):
        facts.append(_fact("fees", "Fees", cost, source_ids))
    season = _clean_text(
        detail.get("operating_season")
        or detail.get("season_text")
        or detail.get("season_window")
        or detail.get("best_season"),
        180,
    )
    if season:
        facts.append(_fact("operating_season", "Operating season", season, source_ids))

    site_types = sorted(_unique_text(detail.get("site_types"), limit=12), key=str.casefold)
    amenities = sorted(_unique_text(detail.get("amenities"), limit=24), key=str.casefold)

    access: list[dict] = []
    rig_length = _site_rig_length(detail)
    if item := _fact("max_rig_length", "Maximum rig length", rig_length, source_ids):
        access.append(item)
    surfaces = _site_surface(detail)
    if item := _fact("road_surface", "Site surface", ", ".join(surfaces), source_ids):
        access.append(item)
    driveways = _site_driveway(detail)
    if item := _fact("driveway", "Driveway", ", ".join(driveways), source_ids):
        access.append(item)
    site_records = _site_records(detail)
    if any(item.get("hookups") is True for item in site_records) or any("hookup" in item.casefold() for item in amenities):
        access.append(_fact("hookups", "Hookups", "Listed for some inventory", source_ids))
    if detail.get("ada") is True or any(item.get("accessible") is True for item in site_records):
        access.append(_fact("accessibility", "Accessibility", "Accessible features are listed", source_ids))
    if item := _fact("access_notes", "Access", detail.get("access_notes"), source_ids):
        access.append(item)

    booking_contact: list[dict] = []
    if item := _fact("reservation_notes", "Booking", detail.get("reservation_notes"), source_ids):
        booking_contact.append(item)
    if item := _fact("stay_limit", "Stay limit", detail.get("stay_limit"), source_ids):
        booking_contact.append(item)
    if item := _fact("phone", "Phone", detail.get("phone"), source_ids):
        booking_contact.append(item)
    if source_url:
        booking_contact.append({
            "id": "official_url",
            "label": "Official details",
            "value": source,
            "url": source_url,
            "source_ids": source_ids,
        })
    if booking_url and booking_url != source_url:
        booking_contact.append({
            "id": "booking_url",
            "label": "Booking",
            "value": "Open booking page",
            "url": booking_url,
            "source_ids": source_ids,
        })

    conditions: list[dict] = []
    for index, notice in enumerate(detail.get("provider_notices") or []):
        if not isinstance(notice, dict):
            continue
        label = _clean_text(notice.get("label"), 100) or "Operational note"
        if item := _fact(f"provider_notice_{index}", label, notice.get("text"), source_ids):
            conditions.append(item)
    if item := _fact("source_freshness", "Source status", detail.get("source_freshness"), source_ids):
        conditions.append(item)

    service_candidates = [
        *[item for item in (detail.get("trip_services") or []) if isinstance(item, dict)],
        *[item for item in (nearby_services or []) if isinstance(item, dict)],
    ]
    nearby_service_rows = _nearby_rows(service_candidates, origin, limit=18)
    nearby_place_rows = _nearby_rows([
        *[item for item in (detail.get("things_to_see") or []) if isinstance(item, dict)],
        *[item for item in (detail.get("things_to_do") or []) if isinstance(item, dict)],
        *[item for item in (detail.get("visitor_centers") or []) if isinstance(item, dict)],
        *[item for item in (detail.get("trails") or []) if isinstance(item, dict)],
    ], origin, limit=14)

    coverage = _coverage(detail)
    sources = [{
        "id": "camp_listing",
        "label": source,
        "url": source_url,
        "updated_at": last_checked,
        "freshness": _clean_text(detail.get("source_freshness"), 240) or None,
        "role": "campground facts",
    }]
    if coverage:
        sources.append({
            "id": "mobile_coverage",
            "label": coverage["source_label"],
            "url": coverage["source_url"],
            "updated_at": coverage["last_checked"],
            "freshness": None,
            "role": "mobile coverage",
        })
    if nearby_service_rows:
        sources.append({
            "id": "nearby_services",
            "label": "Mapped nearby services",
            "url": None,
            "updated_at": None,
            "freshness": "Nearby services are refreshed online.",
            "role": "nearby services",
        })

    present = {
        "operating_season": bool(season),
        "max_rig_length": bool(rig_length),
        "road_surface": bool(surfaces),
        "mobile_coverage": bool(coverage),
    }
    unavailable = [label for key, label in _MATERIAL_UNAVAILABLE if not present[key]]

    evidence = {
        "entity": {"id": entity_id, "name": name, "source_label": source, "source_url": source_url},
        "facts": facts,
        "site_types": site_types,
        "access": access,
        "amenities": amenities,
        "booking_contact": booking_contact,
        "conditions": conditions,
        "mobile_coverage": coverage,
        "nearby_services": nearby_service_rows,
        "nearby_places": nearby_place_rows,
        "sources": sources,
        "unavailable": unavailable,
    }
    richness = sum(bool(evidence[key]) for key in (
        "facts", "site_types", "access", "amenities", "booking_contact",
        "conditions", "mobile_coverage", "nearby_services", "nearby_places",
    ))
    status = "complete" if richness >= 7 else "partial" if richness >= 3 else "limited"
    return {
        "schema_version": CAMPGROUND_BRIEF_SCHEMA_VERSION,
        **evidence,
        "source_revision": _source_revision(evidence),
        "generated_at": int(generated_at or time.time()),
        "evidence_status": status,
        "personalized_planning": {
            "available": True,
            "access": "explorer_or_credits",
            "label": "Personalized planning note",
        },
    }
