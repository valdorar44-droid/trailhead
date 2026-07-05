#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent

import sys
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from import_raw_records import DB_PATH, init_db
from canonical_catalog_rules import normalize_official_search_category

PRIMARY_RV_FACILITY_RE = re.compile(
    r"\b(?:rv|r\.v\.|caravan|motorhome|motor\s+home|recreational\s+vehicle)\s*"
    r"(?:park|parks|resort|resorts|camp|campground|campgrounds|site|sites|stay|stays|area|areas)\b|"
    r"\b(?:park|resort|campground|camp)\s+for\s+"
    r"(?:rvs?|r\.v\.s?|caravans?|motorhomes?|motor\s+homes?|recreational\s+vehicles?)\b|"
    r"\b(?:rv|r\.v\.)[-_\s]?(?:park|resort|campground|site|sites)\b|"
    r"\bcaravan[-_\s]?park\b|\bmotorhome[-_\s]?park\b",
    re.I,
)


def compact(value: Any) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def slugify(value: Any) -> str:
    text = compact(value).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:100] or "place"


def as_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except Exception:
        return None


def load_record(raw_json: str) -> tuple[str, dict[str, Any]]:
    payload = json.loads(raw_json)
    return compact(payload.get("endpoint")), payload.get("record") if isinstance(payload.get("record"), dict) else {}


def source_url(item: dict[str, Any]) -> str:
    return compact(
        item.get("url")
        or item.get("FacilityReservationURL")
        or item.get("FacilityURL")
        or item.get("REC1STOP_URL")
        or item.get("USDA_PORTAL_URL")
        or ""
    )


def first_address(addresses: Any) -> str:
    if not isinstance(addresses, list):
        return ""
    physical = None
    for item in addresses:
        if isinstance(item, dict) and compact(item.get("type")).lower() == "physical":
            physical = item
            break
    item = physical or next((entry for entry in addresses if isinstance(entry, dict)), None)
    if not item:
        return ""
    return compact(", ".join(compact(item.get(key)) for key in ("line1", "line2", "line3", "city", "stateCode", "postalCode") if compact(item.get(key))))


def phone_from_contacts(contacts: Any) -> str:
    if not isinstance(contacts, dict):
        return ""
    for item in contacts.get("phoneNumbers") or []:
        if isinstance(item, dict) and compact(item.get("phoneNumber")):
            return compact(item.get("phoneNumber"))
    return ""


def point_geom(lat: float | None, lng: float | None) -> str:
    if lat is None or lng is None:
        return ""
    return json.dumps({"type": "Point", "coordinates": [lng, lat]}, separators=(",", ":"))


def geom_from_item(item: dict[str, Any], lat_keys=("latitude", "lat"), lng_keys=("longitude", "lng")) -> str:
    explicit = item.get("__geom_geojson")
    if isinstance(explicit, dict):
        return json.dumps(explicit, separators=(",", ":"))
    lat = next((as_float(item.get(key)) for key in lat_keys if as_float(item.get(key)) is not None), None)
    lng = next((as_float(item.get(key)) for key in lng_keys if as_float(item.get(key)) is not None), None)
    return point_geom(lat, lng)


def lat_lng_from_item(item: dict[str, Any], lat_keys=("latitude", "lat"), lng_keys=("longitude", "lng")) -> tuple[float | None, float | None]:
    lat = next((as_float(item.get(key)) for key in lat_keys if as_float(item.get(key)) is not None), None)
    lng = next((as_float(item.get(key)) for key in lng_keys if as_float(item.get(key)) is not None), None)
    return lat, lng


def insert_source_link(db: sqlite3.Connection, canonical_type: str, canonical_id: str, source_dataset_id: str, source_record_id: str, url: str, confidence: float) -> None:
    link_id = f"{canonical_type}:{canonical_id}:{source_dataset_id}:{source_record_id}"
    db.execute(
        """
        INSERT OR REPLACE INTO source_link (
          id, canonical_type, canonical_id, source_dataset_id, source_record_id, source_url, confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (link_id, canonical_type, canonical_id, source_dataset_id, source_record_id, url, confidence),
    )


def insert_land_unit(db: sqlite3.Connection, row: dict[str, Any]) -> None:
    db.execute(
        """
        INSERT OR REPLACE INTO land_unit (
          id, name, slug, agency, designation, parent_land_unit_id, geom, centroid,
          source_confidence, attribution_text, last_verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            row["id"], row["name"], row["slug"], row.get("agency", ""), row.get("designation", ""),
            row.get("parent_land_unit_id", ""), row.get("geom", ""), row.get("centroid", ""),
            row.get("source_confidence", 0.8), row.get("attribution_text", ""), row.get("last_verified_at", int(time.time())),
        ),
    )


def insert_place(db: sqlite3.Connection, row: dict[str, Any]) -> None:
    db.execute(
        """
        INSERT OR REPLACE INTO place (
          id, canonical_name, slug, category, subcategory, managing_agency, land_unit_id,
          geom, address, phone, website, reservation_url, official_url, summary,
          description_source, season_text, fee_text, quality_score, popularity_score,
          safety_score, source_confidence, attribution_text, last_verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            row["id"], row["canonical_name"], row["slug"], row["category"], row.get("subcategory", ""),
            row.get("managing_agency", ""), row.get("land_unit_id", ""), row.get("geom", ""),
            row.get("address", ""), row.get("phone", ""), row.get("website", ""), row.get("reservation_url", ""),
            row.get("official_url", ""), row.get("summary", ""), row.get("description_source", ""),
            row.get("season_text", ""), row.get("fee_text", ""), row.get("quality_score", 0.5),
            row.get("popularity_score", 0.0), row.get("safety_score", 0.0), row.get("source_confidence", 0.8),
            row.get("attribution_text", ""), row.get("last_verified_at", int(time.time())),
        ),
    )


def insert_trail(db: sqlite3.Connection, row: dict[str, Any]) -> None:
    db.execute(
        """
        INSERT OR REPLACE INTO trail (
          id, name, slug, land_unit_id, managing_agency, route_geom, start_geom,
          distance_m, elevation_gain_m, difficulty, allowed_uses, surface, season_text,
          quality_score, source_confidence, attribution_text, last_verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            row["id"], row["name"], row["slug"], row.get("land_unit_id", ""), row.get("managing_agency", ""),
            row.get("route_geom", ""), row.get("start_geom", ""), row.get("distance_m", 0.0),
            row.get("elevation_gain_m", 0.0), row.get("difficulty", ""), row.get("allowed_uses", ""),
            row.get("surface", ""), row.get("season_text", ""), row.get("quality_score", 0.5),
            row.get("source_confidence", 0.8), row.get("attribution_text", ""), row.get("last_verified_at", int(time.time())),
        ),
    )


def insert_facility(db: sqlite3.Connection, row: dict[str, Any]) -> None:
    db.execute(
        """
        INSERT OR REPLACE INTO facility (
          id, place_id, facility_type, reservable, fee_required, season_start,
          season_end, amenities_json, attribution_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            row["id"], row.get("place_id", ""), row.get("facility_type", ""), row.get("reservable", 0),
            row.get("fee_required", 0), row.get("season_start", ""), row.get("season_end", ""),
            json.dumps(row.get("amenities", {}), separators=(",", ":")), row.get("attribution_text", ""),
        ),
    )


def insert_activity(db: sqlite3.Connection, place_id: str, activity_type: str) -> None:
    clean = compact(activity_type)
    if not place_id or not clean:
        return
    db.execute("INSERT OR IGNORE INTO activity (id, place_id, activity_type) VALUES (?, ?, ?)", (f"{place_id}:{slugify(clean)}", place_id, clean))


def insert_alert(db: sqlite3.Connection, row: dict[str, Any]) -> None:
    db.execute(
        """
        INSERT OR REPLACE INTO alert (
          id, source, place_id, land_unit_id, title, body, severity, effective_at,
          expires_at, source_url, last_checked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            row["id"], row.get("source", ""), row.get("place_id", ""), row.get("land_unit_id", ""),
            row.get("title", ""), row.get("body", ""), row.get("severity", ""), row.get("effective_at", ""),
            row.get("expires_at", ""), row.get("source_url", ""), int(time.time()),
        ),
    )


def clear_canonical(db: sqlite3.Connection) -> None:
    for table in ("source_link", "land_unit", "place", "trail", "facility", "activity", "alert"):
        db.execute(f"DELETE FROM {table}")


def normalize_nps(db: sqlite3.Connection, rows: list[sqlite3.Row]) -> dict[str, int]:
    counts = {"land_unit": 0, "place": 0, "activity": 0, "alert": 0}
    park_land: dict[str, str] = {}
    for row in rows:
        endpoint, item = load_record(row["raw_json"])
        record_id = row["source_record_id"]
        if endpoint == "parks":
            code = compact(item.get("parkCode") or item.get("id")).lower()
            name = compact(item.get("fullName") or item.get("name"))
            if not code or not name:
                continue
            land_id = f"land:nps:{slugify(code)}"
            park_land[code] = land_id
            lat, lng = lat_lng_from_item(item, ("latitude",), ("longitude",))
            insert_land_unit(db, {
                "id": land_id,
                "name": name,
                "slug": slugify(name),
                "agency": "NPS",
                "designation": compact(item.get("designation")),
                "geom": point_geom(lat, lng),
                "source_confidence": 0.95,
                "attribution_text": "National Park Service",
            })
            insert_source_link(db, "land_unit", land_id, "nps-api", record_id, source_url(item), 0.95)
            counts["land_unit"] += 1
            place_id = f"place:nps:{slugify(code)}"
            insert_place(db, {
                "id": place_id,
                "canonical_name": name,
                "slug": slugify(name),
                "category": "park",
                "subcategory": compact(item.get("designation")),
                "managing_agency": "NPS",
                "land_unit_id": land_id,
                "geom": point_geom(lat, lng),
                "website": source_url(item),
                "official_url": source_url(item),
                "summary": compact(item.get("description")),
                "description_source": "official",
                "quality_score": 0.95,
                "source_confidence": 0.95,
                "attribution_text": "National Park Service",
            })
            insert_source_link(db, "place", place_id, "nps-api", record_id, source_url(item), 0.95)
            counts["place"] += 1
            for activity in item.get("activities") or []:
                if isinstance(activity, dict):
                    insert_activity(db, place_id, activity.get("name"))
                    counts["activity"] += 1

    for row in rows:
        endpoint, item = load_record(row["raw_json"])
        record_id = row["source_record_id"]
        if endpoint in {"parks", "articles", "newsreleases", "events"}:
            continue
        if endpoint == "alerts":
            code = compact(item.get("parkCode")).lower()
            alert_id = f"alert:nps:{slugify(item.get('id') or item.get('title'))}"
            insert_alert(db, {
                "id": alert_id,
                "source": "nps",
                "land_unit_id": park_land.get(code, ""),
                "title": compact(item.get("title")),
                "body": compact(item.get("description")),
                "severity": compact(item.get("category")),
                "source_url": source_url(item),
            })
            insert_source_link(db, "alert", alert_id, "nps-api", record_id, source_url(item), 0.95)
            counts["alert"] += 1
            continue
        title = compact(item.get("name") or item.get("title"))
        lat, lng = lat_lng_from_item(item, ("latitude",), ("longitude",))
        if not title or lat is None or lng is None:
            if endpoint == "thingstodo":
                for park in item.get("relatedParks") or []:
                    if isinstance(park, dict):
                        code = compact(park.get("parkCode")).lower()
                        if code and code in park_land:
                            insert_activity(db, f"place:nps:{slugify(code)}", title)
                            counts["activity"] += 1
                            break
            continue
        code = compact(item.get("parkCode")).lower()
        if not code:
            parks = item.get("relatedParks") or []
            if parks and isinstance(parks[0], dict):
                code = compact(parks[0].get("parkCode")).lower()
        category = {
            "campgrounds": "campground",
            "visitorcenters": "visitor_center",
            "thingstodo": "activity",
            "places": "place",
            "activities": "activity",
        }.get(endpoint, "place")
        place_id = f"place:nps:{endpoint}:{slugify(item.get('id') or title)}"
        insert_place(db, {
            "id": place_id,
            "canonical_name": title,
            "slug": slugify(title),
            "category": category,
            "subcategory": compact(item.get("category") or item.get("associatedIcon")),
            "managing_agency": "NPS",
            "land_unit_id": park_land.get(code, ""),
            "geom": point_geom(lat, lng),
            "address": first_address(item.get("addresses")),
            "phone": phone_from_contacts(item.get("contacts")),
            "website": source_url(item),
            "reservation_url": compact(item.get("reservationUrl")),
            "official_url": source_url(item),
            "summary": compact(item.get("description") or item.get("listingDescription") or item.get("shortDescription") or item.get("longDescription")),
            "description_source": "official",
            "fee_text": compact(item.get("feeDescription")),
            "season_text": compact(item.get("seasonDescription")),
            "quality_score": 0.9,
            "source_confidence": 0.95,
            "attribution_text": "National Park Service",
        })
        insert_source_link(db, "place", place_id, "nps-api", record_id, source_url(item), 0.95)
        counts["place"] += 1
    return counts


def normalize_ridb(db: sqlite3.Connection, rows: Iterable[sqlite3.Row]) -> dict[str, int]:
    counts = {"land_unit": 0, "place": 0, "facility": 0}
    for row in rows:
        endpoint, item = load_record(row["raw_json"])
        record_id = row["source_record_id"]
        if endpoint == "recareas":
            rec_id = compact(item.get("RecAreaID"))
            name = compact(item.get("RecAreaName"))
            lat, lng = lat_lng_from_item(item, ("RecAreaLatitude",), ("RecAreaLongitude",))
            if not rec_id or not name:
                continue
            land_id = f"land:ridb:{slugify(rec_id)}"
            insert_land_unit(db, {
                "id": land_id,
                "name": name,
                "slug": slugify(name),
                "agency": "Recreation.gov",
                "designation": "recreation_area",
                "geom": point_geom(lat, lng),
                "source_confidence": 0.85,
                "attribution_text": "Recreation.gov",
            })
            insert_source_link(db, "land_unit", land_id, "ridb", record_id, source_url(item), 0.85)
            counts["land_unit"] += 1
        elif endpoint == "facilities":
            facility_id = compact(item.get("FacilityID"))
            name = compact(item.get("FacilityName"))
            lat, lng = lat_lng_from_item(item, ("FacilityLatitude",), ("FacilityLongitude",))
            if not facility_id or not name or lat is None or lng is None:
                continue
            kind_text = compact(item.get("FacilityTypeDescription") or item.get("FacilityName")).lower()
            category = "rv_park" if PRIMARY_RV_FACILITY_RE.search(kind_text) else "campground" if "camp" in kind_text else "facility"
            place_id = f"place:ridb:{slugify(facility_id)}"
            reservation_url = compact(item.get("FacilityReservationURL"))
            insert_place(db, {
                "id": place_id,
                "canonical_name": name,
                "slug": slugify(name),
                "category": category,
                "subcategory": compact(item.get("FacilityTypeDescription")),
                "managing_agency": "Recreation.gov",
                "land_unit_id": f"land:ridb:{slugify(item.get('ParentRecAreaID'))}" if compact(item.get("ParentRecAreaID")) else "",
                "geom": point_geom(lat, lng),
                "website": reservation_url or source_url(item),
                "reservation_url": reservation_url,
                "official_url": source_url(item),
                "summary": compact(item.get("FacilityDescription")),
                "fee_text": compact(item.get("FacilityUseFeeDescription")),
                "quality_score": 0.85,
                "source_confidence": 0.9,
                "attribution_text": "Recreation.gov",
            })
            insert_source_link(db, "place", place_id, "ridb", record_id, source_url(item), 0.9)
            insert_facility(db, {
                "id": f"facility:ridb:{slugify(facility_id)}",
                "place_id": place_id,
                "facility_type": category,
                "reservable": 1 if item.get("Reservable") else 0,
                "fee_required": 1 if compact(item.get("FacilityUseFeeDescription")) else 0,
                "amenities": {"keywords": compact(item.get("Keywords"))},
                "attribution_text": "Recreation.gov",
            })
            counts["place"] += 1
            counts["facility"] += 1
        elif endpoint == "campsites":
            site_id = compact(item.get("CampsiteID"))
            parent = compact(item.get("FacilityID"))
            if not site_id or not parent:
                continue
            insert_facility(db, {
                "id": f"facility:ridb:campsite:{slugify(parent)}:{slugify(site_id)}",
                "place_id": f"place:ridb:{slugify(parent)}",
                "facility_type": compact(item.get("CampsiteType") or "campsite"),
                "reservable": 1 if str(item.get("CampsiteReservable")).lower() in {"true", "1", "yes"} else 0,
                "amenities": {"name": compact(item.get("CampsiteName")), "loop": compact(item.get("Loop"))},
                "attribution_text": "Recreation.gov",
            })
            counts["facility"] += 1
    return counts


def normalize_usfs(db: sqlite3.Connection, rows: Iterable[sqlite3.Row]) -> dict[str, int]:
    counts = {"land_unit": 0, "place": 0, "trail": 0}
    for row in rows:
        endpoint, item = load_record(row["raw_json"])
        record_id = row["source_record_id"]
        if endpoint in {"national-forest-system-land-units", "ranger-districts"}:
            if endpoint == "national-forest-system-land-units":
                name = compact(item.get("NFSLANDUNITNAME"))
                source_id = compact(item.get("NFSLANDUNITID") or item.get("OBJECTID"))
                designation = compact(item.get("NFSLANDUNITTYPE"))
            else:
                name = compact(item.get("DISTRICTNAME") or item.get("RANGERDISTRICTNAME") or item.get("ORG_NAME") or item.get("NAME"))
                source_id = compact(item.get("DISTRICTID") or item.get("OBJECTID") or item.get("GLOBALID"))
                designation = "ranger_district"
            if not source_id or not name:
                continue
            land_id = f"land:usfs:{endpoint}:{slugify(source_id)}"
            insert_land_unit(db, {
                "id": land_id,
                "name": name,
                "slug": slugify(name),
                "agency": "USFS",
                "designation": designation,
                "geom": geom_from_item(item),
                "source_confidence": 0.9,
                "attribution_text": "US Forest Service",
            })
            insert_source_link(db, "land_unit", land_id, "usfs-edw", record_id, source_url(item), 0.9)
            counts["land_unit"] += 1
        elif endpoint in {"recreation-sites", "recreation-opportunities"}:
            name = compact(item.get("PUBLIC_SITE_NAME") or item.get("SITE_NAME") or item.get("RECAREA_NAME") or item.get("REC_AREA_NAME") or item.get("NAME"))
            source_id = compact(item.get("SITE_CN") or item.get("GLOBALID") or item.get("OBJECTID"))
            lat, lng = lat_lng_from_item(item, ("LATITUDE",), ("LONGITUDE",))
            if not name or not source_id or lat is None or lng is None:
                continue
            kind = compact(item.get("SITE_TYPE") or item.get("ACTIVITY_TYPE_LIST") or item.get("RECAREA_DESCRIPTION")).lower()
            category = "campground" if "camp" in kind else "trailhead" if "trail" in kind else "place"
            place_id = f"place:usfs:{endpoint}:{slugify(source_id)}"
            insert_place(db, {
                "id": place_id,
                "canonical_name": name,
                "slug": slugify(name),
                "category": category,
                "subcategory": compact(item.get("SITE_TYPE") or item.get("ACTIVITY_TYPE_LIST")),
                "managing_agency": "USFS",
                "geom": point_geom(lat, lng),
                "website": source_url(item),
                "official_url": source_url(item),
                "summary": compact(item.get("RECAREA_DESCRIPTION") or item.get("IMPORTANT_INFO")),
                "season_text": compact(item.get("OPEN_SEASON") or item.get("SEASON_DESCRIPTION")),
                "fee_text": compact(item.get("FEE_DESCRIPTION") or item.get("FEE_CHARGED")),
                "quality_score": 0.8,
                "source_confidence": 0.9,
                "attribution_text": "US Forest Service",
            })
            insert_source_link(db, "place", place_id, "usfs-edw", record_id, source_url(item), 0.9)
            counts["place"] += 1
        elif endpoint == "trails":
            source_id = compact(item.get("TRAIL_CN") or item.get("GLOBALID") or item.get("OBJECTID"))
            name = compact(item.get("TRAIL_NAME") or item.get("TRAIL_NO") or source_id)
            if not source_id or not name:
                continue
            trail_id = f"trail:usfs:{slugify(source_id)}"
            miles = as_float(item.get("GIS_MILES") or item.get("SEGMENT_LENGTH"))
            uses = []
            for key, label in [("HIKER_PEDESTRIAN_ACCPT", "Hiking"), ("BICYCLE_ACCPT", "Biking"), ("FOURWD_ACCPT", "4x4"), ("MOTORCYCLE_ACCPT", "Motorcycle"), ("PACK_SADDLE_ACCPT", "Horse")]:
                if item.get(key):
                    uses.append(label)
            insert_trail(db, {
                "id": trail_id,
                "name": name,
                "slug": slugify(name),
                "managing_agency": "USFS",
                "route_geom": geom_from_item(item),
                "distance_m": (miles or 0) * 1609.344,
                "allowed_uses": ", ".join(uses),
                "surface": compact(item.get("TRAIL_SURFACE")),
                "difficulty": compact(item.get("TRAIL_CLASS")),
                "quality_score": 0.8,
                "source_confidence": 0.9,
                "attribution_text": "US Forest Service",
            })
            insert_source_link(db, "trail", trail_id, "usfs-edw", record_id, source_url(item), 0.9)
            counts["trail"] += 1
    return counts


def normalize_padus(db: sqlite3.Connection, rows: Iterable[sqlite3.Row]) -> dict[str, int]:
    counts = {"land_unit": 0}
    for row in rows:
        endpoint, item = load_record(row["raw_json"])
        if endpoint not in {"fee", "proclamation", "designation"}:
            continue
        name = compact(item.get("Unit_Nm") or item.get("Loc_Nm"))
        object_id = compact(item.get("OBJECTID") or item.get("Source_PAID"))
        if not name or not object_id:
            continue
        land_id = f"land:padus:{endpoint}:{slugify(object_id)}"
        insert_land_unit(db, {
            "id": land_id,
            "name": name,
            "slug": slugify(name),
            "agency": compact(item.get("Mang_Name") or item.get("Own_Name")),
            "designation": compact(item.get("Loc_Ds") or item.get("Category")),
            "geom": geom_from_item(item),
            "source_confidence": 0.85,
            "attribution_text": "USGS PAD-US",
        })
        insert_source_link(db, "land_unit", land_id, "padus", row["source_record_id"], "", 0.85)
        counts["land_unit"] += 1
    return counts


def build_official_search(db: sqlite3.Connection) -> int:
    db.execute("DROP TABLE IF EXISTS official_search")
    db.execute(
        """
        CREATE TABLE official_search (
          id TEXT PRIMARY KEY,
          canonical_type TEXT,
          title TEXT,
          category TEXT,
          agency TEXT,
          terms TEXT
        )
        """
    )
    rows = 0
    for table, canonical_type, title_col, category_col, agency_col in [
        ("place", "place", "canonical_name", "category", "managing_agency"),
        ("trail", "trail", "name", "surface", "managing_agency"),
        ("land_unit", "land_unit", "name", "designation", "agency"),
    ]:
        where = " WHERE id NOT LIKE 'land:padus:%'" if table == "land_unit" else ""
        for item in db.execute(f"SELECT id, {title_col}, {category_col}, {agency_col} FROM {table}{where}"):
            title = compact(item[1])
            if not title:
                continue
            category = normalize_official_search_category(canonical_type, item[2])
            terms = " ".join(compact(part).lower() for part in item[1:] if compact(part))
            db.execute("INSERT OR REPLACE INTO official_search VALUES (?, ?, ?, ?, ?, ?)", (item[0], canonical_type, title, category, compact(item[3]), terms))
            rows += 1
    return rows


def merge_counts(total: dict[str, int], update: dict[str, int]) -> dict[str, int]:
    for key, value in update.items():
        total[key] = total.get(key, 0) + int(value or 0)
    return total


def select_source(source: str, selected: str) -> bool:
    aliases = {source, source.split("-")[0]}
    if source == "nps-api":
        aliases.add("nps")
    if source == "usfs-edw":
        aliases.add("usfs")
    return selected == "all" or selected in aliases


def raw_batches(source: str, limit: int, batch_size: int) -> Iterable[list[sqlite3.Row]]:
    read_db = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    read_db.row_factory = sqlite3.Row
    try:
        last_rowid = 0
        remaining = int(limit) if limit else 0
        while True:
            page_size = min(batch_size, remaining) if remaining else batch_size
            rows = read_db.execute(
                """
                SELECT rowid AS raw_rowid, source_record_id, raw_json
                FROM raw_record
                WHERE source_dataset_id=? AND rowid>?
                ORDER BY rowid
                LIMIT ?
                """,
                (source, last_rowid, page_size),
            ).fetchall()
            if not rows:
                break
            last_rowid = int(rows[-1]["raw_rowid"])
            yield rows
            if remaining:
                remaining -= len(rows)
                if remaining <= 0:
                    break
    finally:
        read_db.close()


def normalize_source(
    db: sqlite3.Connection,
    source: str,
    normalizer: Any,
    limit: int,
) -> dict[str, int]:
    batch_size = 2000 if source in {"usfs-edw", "padus"} else 5000
    if source == "nps-api":
        rows = next(iter(raw_batches(source, limit, max(limit or 50000, 50000))), [])
        counts = normalizer(db, rows)
        db.commit()
        print(f"{source}: normalized {len(rows)} records", flush=True)
        return counts

    total: dict[str, int] = {}
    processed = 0
    for batch in raw_batches(source, limit, batch_size):
        processed += len(batch)
        merge_counts(total, normalizer(db, batch))
        db.commit()
        if processed % (batch_size * 5) == 0:
            print(f"{source}: normalized {processed} records", flush=True)
    print(f"{source}: normalized {processed} records", flush=True)
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize official raw records into Trailhead canonical tables.")
    parser.add_argument("--source", default="all")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--search-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.dry_run:
        print("DRY normalize official cache")
        return 0
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        init_db(db)
        if args.search_only:
            summary = {"database": str(DB_PATH), "search_rows": build_official_search(db), "search_only": True}
            db.commit()
            out = DB_PATH.parent / "official-normalize-summary.json"
            out.write_text(json.dumps(summary, indent=2) + "\n")
            print(json.dumps(summary, indent=2))
            return 0
        clear_canonical(db)
        db.commit()
        selected = args.source.strip().lower()
        summary: dict[str, Any] = {"database": str(DB_PATH), "sources": {}}
        for source, normalizer in [
            ("nps-api", normalize_nps),
            ("ridb", normalize_ridb),
            ("usfs-edw", normalize_usfs),
            ("padus", normalize_padus),
        ]:
            if not select_source(source, selected):
                continue
            summary["sources"][source] = normalize_source(db, source, normalizer, args.limit)
        summary["search_rows"] = build_official_search(db)
        db.commit()
        counts = {}
        for table in ("land_unit", "place", "trail", "facility", "activity", "alert", "source_link", "official_search"):
            counts[table] = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        summary["canonical_counts"] = counts
        out = DB_PATH.parent / "official-normalize-summary.json"
        out.write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps(summary, indent=2))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
