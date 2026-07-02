#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
DB_PATH = PROCESSED_DIR / "trailhead_official_data.sqlite"


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def read_jsonl(path: Path, limit: int = 0) -> Iterable[dict[str, Any]]:
    count = 0
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            payload = json.loads(line)
            if isinstance(payload, dict):
                yield payload
                count += 1
            if limit and count >= limit:
                return


def source_record_id(source: str, endpoint: str, item: dict[str, Any]) -> str:
    if endpoint == "facilityaddresses":
        parts = [
            compact(item.get("FacilityAddressID")),
            compact(item.get("FacilityID")),
            compact(item.get("FacilityAddressType")),
            compact(item.get("FacilityStreetAddress1")),
        ]
        clean = ":".join(part for part in parts if part)
        if clean:
            return f"{endpoint}:{clean}"
    if endpoint == "campsites":
        parts = [compact(item.get("CampsiteID")), compact(item.get("FacilityID"))]
        clean = ":".join(part for part in parts if part)
        if clean:
            return f"{endpoint}:{clean}"
    if source == "padus":
        object_id = compact(item.get("OBJECTID") or item.get("objectid"))
        if object_id:
            return f"{endpoint}:{object_id}"
    candidates = (
        item.get("id"),
        item.get("parkCode"),
        item.get("CampsiteID"),
        item.get("FacilityAddressID"),
        item.get("FacilityID"),
        item.get("RecAreaID"),
        item.get("ActivityID"),
        item.get("OrganizationID"),
        item.get("GLOBALID"),
        item.get("GlobalID"),
        item.get("SITE_CN"),
        item.get("TRAIL_CN"),
        item.get("ID"),
        item.get("OBJECTID"),
        item.get("objectid"),
        item.get("Source_PAID"),
        item.get("Unit_Nm"),
    )
    for candidate in candidates:
        clean = compact(candidate)
        if clean:
            return f"{endpoint}:{clean}"
    raw = json.dumps(item, sort_keys=True, ensure_ascii=False)
    return f"{endpoint}:hash:{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]}"


def point_geom(item: dict[str, Any]) -> str:
    explicit = item.get("__geom_geojson")
    if isinstance(explicit, str) and explicit.strip():
        return explicit
    if isinstance(explicit, dict):
        return json.dumps(explicit, separators=(",", ":"))
    lat = item.get("latitude") or item.get("lat") or item.get("FacilityLatitude") or item.get("RecAreaLatitude")
    lng = item.get("longitude") or item.get("lng") or item.get("FacilityLongitude") or item.get("RecAreaLongitude")
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except Exception:
        return ""
    if not (-90 <= lat_f <= 90 and -180 <= lng_f <= 180):
        return ""
    return json.dumps({"type": "Point", "coordinates": [lng_f, lat_f]}, separators=(",", ":"))


def init_db(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS source_dataset (
          id TEXT PRIMARY KEY,
          agency TEXT,
          source_name TEXT,
          source_type TEXT,
          source_url TEXT,
          download_url TEXT,
          attribution_text TEXT,
          license_note TEXT,
          refresh_type TEXT,
          refresh_frequency TEXT,
          last_checked_at INTEGER,
          last_success_at INTEGER,
          enabled INTEGER
        );
        CREATE TABLE IF NOT EXISTS raw_record (
          id TEXT PRIMARY KEY,
          source_dataset_id TEXT NOT NULL,
          source_record_id TEXT NOT NULL,
          source_updated_at TEXT,
          source_hash TEXT,
          raw_json TEXT NOT NULL,
          geom TEXT,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          deleted_at INTEGER,
          FOREIGN KEY(source_dataset_id) REFERENCES source_dataset(id)
        );
        CREATE TABLE IF NOT EXISTS source_link (
          id TEXT PRIMARY KEY,
          canonical_type TEXT,
          canonical_id TEXT,
          source_dataset_id TEXT NOT NULL,
          source_record_id TEXT NOT NULL,
          source_url TEXT,
          confidence REAL,
          FOREIGN KEY(source_dataset_id) REFERENCES source_dataset(id)
        );
        CREATE TABLE IF NOT EXISTS land_unit (
          id TEXT PRIMARY KEY,
          name TEXT,
          slug TEXT,
          agency TEXT,
          designation TEXT,
          parent_land_unit_id TEXT,
          geom TEXT,
          centroid TEXT,
          source_confidence REAL,
          attribution_text TEXT,
          last_verified_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS place (
          id TEXT PRIMARY KEY,
          canonical_name TEXT,
          slug TEXT,
          category TEXT,
          subcategory TEXT,
          managing_agency TEXT,
          land_unit_id TEXT,
          geom TEXT,
          address TEXT,
          phone TEXT,
          website TEXT,
          reservation_url TEXT,
          official_url TEXT,
          summary TEXT,
          description_source TEXT,
          season_text TEXT,
          fee_text TEXT,
          quality_score REAL,
          popularity_score REAL,
          safety_score REAL,
          source_confidence REAL,
          attribution_text TEXT,
          last_verified_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS trail (
          id TEXT PRIMARY KEY,
          name TEXT,
          slug TEXT,
          land_unit_id TEXT,
          managing_agency TEXT,
          route_geom TEXT,
          start_geom TEXT,
          distance_m REAL,
          elevation_gain_m REAL,
          difficulty TEXT,
          allowed_uses TEXT,
          surface TEXT,
          season_text TEXT,
          quality_score REAL,
          source_confidence REAL,
          attribution_text TEXT,
          last_verified_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS facility (
          id TEXT PRIMARY KEY,
          place_id TEXT,
          facility_type TEXT,
          reservable INTEGER,
          fee_required INTEGER,
          season_start TEXT,
          season_end TEXT,
          amenities_json TEXT,
          attribution_text TEXT
        );
        CREATE TABLE IF NOT EXISTS activity (
          id TEXT PRIMARY KEY,
          place_id TEXT,
          activity_type TEXT
        );
        CREATE TABLE IF NOT EXISTS alert (
          id TEXT PRIMARY KEY,
          source TEXT,
          place_id TEXT,
          land_unit_id TEXT,
          title TEXT,
          body TEXT,
          severity TEXT,
          effective_at TEXT,
          expires_at TEXT,
          source_url TEXT,
          last_checked_at INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_record_source ON raw_record(source_dataset_id, source_record_id);
        """
    )


def upsert_sources(db: sqlite3.Connection, selected: str) -> list[str]:
    registry = read_json(ROOT / "data-sources" / "registry.json")
    now = int(time.time())
    ids: list[str] = []
    for source in registry.get("sources") or []:
        source_id = compact(source.get("id"))
        if not source_id:
            continue
        if selected != "all" and selected not in source_id and not source_id.startswith(selected):
            continue
        ids.append(source_id)
        db.execute(
            """
            INSERT INTO source_dataset (
              id, agency, source_name, source_type, source_url, download_url,
              attribution_text, license_note, refresh_type, refresh_frequency,
              last_checked_at, last_success_at, enabled
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              source_name=excluded.source_name,
              source_type=excluded.source_type,
              source_url=excluded.source_url,
              download_url=excluded.download_url,
              attribution_text=excluded.attribution_text,
              license_note=excluded.license_note,
              refresh_type=excluded.refresh_type,
              refresh_frequency=excluded.refresh_frequency,
              last_checked_at=excluded.last_checked_at,
              enabled=excluded.enabled
            """,
            (
                source_id,
                source.get("agency") or source_id.split("-")[0].upper(),
                source.get("source_name") or source_id,
                source.get("source_type") or "",
                source.get("source_url") or source.get("api_base") or source.get("metadata_url") or "",
                source.get("download_url") or source.get("metadata_url") or "",
                source.get("attribution_text") or "",
                source.get("license_note") or "",
                source.get("refresh_type") or "",
                source.get("refresh_frequency") or "",
                now,
                None,
                0 if source.get("enabled") is False else 1,
            ),
        )
    return ids


def insert_raw(db: sqlite3.Connection, dataset_id: str, endpoint: str, item: dict[str, Any], limit_seen: int) -> None:
    now = int(time.time())
    record_id = source_record_id(dataset_id, endpoint, item)
    raw = json.dumps({"endpoint": endpoint, "record": item}, ensure_ascii=False, sort_keys=True)
    raw_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    geom = point_geom(item)
    db.execute(
        """
        INSERT INTO raw_record (
          id, source_dataset_id, source_record_id, source_updated_at, source_hash,
          raw_json, geom, first_seen_at, last_seen_at, deleted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          raw_json=excluded.raw_json,
          geom=excluded.geom,
          last_seen_at=excluded.last_seen_at
        """,
        (
            f"{dataset_id}:{record_id}",
            dataset_id,
            record_id,
            compact(item.get("lastUpdatedDate") or item.get("lastIndexedDate") or item.get("DateLastModified")),
            raw_hash,
            raw,
            geom,
            now,
            limit_seen or now,
        ),
    )


def import_jsonl_dir(db: sqlite3.Connection, dataset_id: str, base_dir: Path, limit: int) -> int:
    total = 0
    for path in sorted(base_dir.glob("*.jsonl")):
        endpoint = path.stem
        for item in read_jsonl(path, limit=max(0, limit - total) if limit else 0):
            insert_raw(db, dataset_id, endpoint, item, int(time.time()))
            total += 1
            if limit and total >= limit:
                return total
    return total


def import_arcgis_chunks(db: sqlite3.Connection, dataset_id: str, base_dir: Path, limit: int) -> int:
    total = 0
    for path in sorted(base_dir.glob("*/features-*.json")):
        layer_id = path.parent.name
        payload = read_json(path)
        for feature in payload.get("features") or []:
            if not isinstance(feature, dict):
                continue
            attrs = feature.get("attributes") if isinstance(feature.get("attributes"), dict) else {}
            item = {**attrs, "geometry": feature.get("geometry")}
            insert_raw(db, dataset_id, layer_id, item, int(time.time()))
            total += 1
            if limit and total >= limit:
                return total
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description="Import official Trailhead raw records into a local SQLite cache.")
    parser.add_argument("--source", default="all")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    if args.dry_run:
        print(f"DRY import raw records -> {DB_PATH.relative_to(ROOT)}")
        return 0
    if args.force and DB_PATH.exists():
        DB_PATH.unlink()
    db = sqlite3.connect(DB_PATH)
    try:
        init_db(db)
        selected = upsert_sources(db, args.source)
        counts: dict[str, int] = {}
        if "nps-api" in selected or args.source in {"all", "nps", "nps-api"}:
            counts["nps-api"] = import_jsonl_dir(db, "nps-api", RAW_DIR / "nps" / "api", args.limit)
        if "ridb" in selected or args.source in {"all", "ridb"}:
            counts["ridb"] = import_jsonl_dir(db, "ridb", RAW_DIR / "ridb" / "api", args.limit)
        if "nps-national-spatial" in selected or args.source in {"all", "nps-national-spatial"}:
            counts["nps-national-spatial"] = import_arcgis_chunks(db, "nps-national-spatial", RAW_DIR / "nps" / "spatial", args.limit)
        db.commit()
        summary = {"database": str(DB_PATH.relative_to(ROOT)), "counts": counts, "sources": selected}
        (PROCESSED_DIR / "raw-import-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps(summary, indent=2))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
