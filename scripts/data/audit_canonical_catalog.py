#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

try:
    from .canonical_catalog_rules import (
        PUBLIC_COPY_FORBIDDEN_RE,
        TRAIL_SURFACE_CATEGORY_VALUES,
        classify_camp_kind,
        compact,
        is_non_overnight_camp_label,
        is_primary_rv_label,
        is_overnight_parking_label,
    )
except ImportError:
    from canonical_catalog_rules import (
        PUBLIC_COPY_FORBIDDEN_RE,
        TRAIL_SURFACE_CATEGORY_VALUES,
        classify_camp_kind,
        compact,
        is_non_overnight_camp_label,
        is_primary_rv_label,
        is_overnight_parking_label,
    )

ROOT = Path(__file__).resolve().parents[2]
APP_DB = ROOT / "trailhead.db"
OFFICIAL_DB = ROOT / "data" / "processed" / "trailhead_official_data.sqlite"
SERVING_DIR = ROOT / "data" / "processed" / "canonical_serving"
DANGLING_WORDS = {"as", "with", "and", "or", "the", "of", "to", "in", "for", "from", "by", "on", "at", "a", "an"}
CONFIRMED_CLIPPED_NAME_RE = re.compile(r"\b(?:Jacks Bra|Branc|Trai|Cree|Roa|Lak)$", re.I)
EXPLORE_CAMPING_MISROUTE_TITLE_RE = re.compile(
    r"\b(?:boat ramp|boat launch|boat access|boat landing|boat area|boat site|"
    r"rifle range|shooting range|day[-\s]?use|picnic shelter|picnic area|pavilion|"
    r"parking area|dump station|timed entry|entrance pass|parking tag|museum|nature center|"
    r"visitor center|contact station|lighthouse|battlefield|cemetery|historic site|"
    r"interpretive center|environmental education)\b",
    re.I,
)
EXPLORE_CAMPING_STAY_TITLE_RE = re.compile(r"\b(?:campgrounds?|campsites?|camp\s*sites?|rv park|rv resort|cabins?|huts?|lodges?|lodging|lookout)\b", re.I)


def load_json(raw: object, fallback: Any) -> Any:
    if raw in (None, ""):
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(str(raw))
    except Exception:
        return fallback


def connect(path: Path) -> sqlite3.Connection | None:
    if not path.exists():
        return None
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    return db


def public_text_from_place(place: dict[str, Any]) -> str:
    meta = load_json(place.get("display_metadata"), {})
    values: list[str] = [
        place.get("name"),
        place.get("category"),
        place.get("subtype"),
        place.get("source_label"),
    ]
    if isinstance(meta, dict):
        for key in (
            "summary", "description", "source_confidence_notes", "access_notes",
            "reservation_notes", "verified_source", "source_badge", "land_type",
        ):
            values.append(meta.get(key))
        for key in ("tags", "amenities", "site_types"):
            raw = meta.get(key)
            if isinstance(raw, list):
                values.extend(raw)
    return " ".join(compact(value) for value in values if compact(value))


def public_text_from_serving_item(item: dict[str, Any], kind: str) -> str:
    if kind == "camp":
        keys = ("name", "category", "kind", "label", "land_type", "summary")
    elif kind == "trail":
        keys = ("name", "category", "summary", "difficulty", "allowed_uses", "surface", "season_text", "display_quality")
    else:
        keys = ("title", "category", "group", "description")
    return " ".join(compact(item.get(key)) for key in keys if compact(item.get(key)))


def rough_public_copy(value: object) -> bool:
    text = compact(value)
    if not text:
        return False
    if re.search(r"\b(?:has overnight options around the area|is a managed recreation stop|check current access, fees, fire restrictions, reservations, and seasonal road conditions before you go)\b", text, re.I):
        return True
    if re.search(r"\bnear the area\b", text, re.I):
        return True
    if re.search(r"\bcheck distance,\s*current conditions\b", text, re.I):
        return True
    if re.search(r"(?<![\d.])0(?:\.0)?\s+miles?\b", text, re.I):
        return True
    if re.search(r"\bas\s+(?:a|an|the)[.!?]?$", text, re.I):
        return True
    if re.search(r"\bin\s+addition[.!?]?$", text, re.I):
        return True
    if text.endswith("...") or text.endswith("…"):
        return True
    stripped = text.rstrip(".!?").strip()
    words = stripped.split()
    if words and words[-1].lower() in DANGLING_WORDS:
        return True
    return False


def looks_like_misrouted_explore_camping(item: dict[str, Any]) -> bool:
    title = compact(item.get("title"))
    description = compact(item.get("description"))
    if re.search(r"\bnot a public campground\b", description, re.I):
        return True
    if EXPLORE_CAMPING_STAY_TITLE_RE.search(title):
        return False
    return bool(EXPLORE_CAMPING_MISROUTE_TITLE_RE.search(title))


def audit_app_db(path: Path) -> dict[str, Any]:
    db = connect(path)
    if not db:
        return {"path": str(path), "exists": False}
    report: dict[str, Any] = {"path": str(path), "exists": True}
    try:
        report["places"] = db.execute("SELECT COUNT(*) AS c FROM places").fetchone()["c"]
        report["places_by_source"] = {
            row["source"] or "unknown": row["c"]
            for row in db.execute("SELECT source, COUNT(*) AS c FROM places GROUP BY source ORDER BY c DESC").fetchall()
        }
        report["places_by_category"] = {
            row["category"] or "unknown": row["c"]
            for row in db.execute("SELECT category, COUNT(*) AS c FROM places GROUP BY category ORDER BY c DESC").fetchall()
        }
        report["dispersed_leads"] = db.execute("SELECT COUNT(*) AS c FROM dispersed_site_leads").fetchone()["c"]
        report["dispersed_leads_by_status"] = {
            row["status"] or "unknown": row["c"]
            for row in db.execute("SELECT status, COUNT(*) AS c FROM dispersed_site_leads GROUP BY status ORDER BY c DESC").fetchall()
        }
        report["dispersed_leads_by_category"] = {
            row["category"] or "unknown": row["c"]
            for row in db.execute("SELECT category, COUNT(*) AS c FROM dispersed_site_leads GROUP BY category ORDER BY c DESC").fetchall()
        }

        suspect_parking: list[dict[str, Any]] = []
        suspect_rv: list[dict[str, Any]] = []
        forbidden_copy: list[dict[str, Any]] = []
        public_kind_counts: Counter[str] = Counter()
        duplicate_names: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
        rows = db.execute(
            """SELECT trailhead_place_id, source, source_label, source_place_id, name, lat, lng,
                      category, subtype, display_metadata
               FROM places
               ORDER BY updated_at DESC"""
        ).fetchall()
        for row in rows:
            place = dict(row)
            meta = load_json(place.get("display_metadata"), {})
            if isinstance(meta, dict):
                place.update(meta)
            text = public_text_from_place(place)
            kind = classify_camp_kind(place) if str(place.get("category") or "").lower() == "camp" else ""
            if kind:
                public_kind_counts[kind] += 1
            if kind == "dispersed_camp" and is_overnight_parking_label(text):
                suspect_parking.append(sample_place(place, text))
            if str(place.get("subtype") or place.get("land_type") or "").lower() in {"rv park", "rv"} and not is_primary_rv_label(
                place.get("name"), place.get("subtype"), place.get("land_type"), place.get("type")
            ):
                suspect_rv.append(sample_place(place, text))
            if PUBLIC_COPY_FORBIDDEN_RE.search(text):
                forbidden_copy.append(sample_place(place, text))
            key = normalized_name_key(place.get("name"))
            if key and place.get("category"):
                duplicate_names[f"{place.get('category')}:{key}"].append(sample_place(place, text, include_text=False))

        report["public_camp_kind_counts"] = dict(public_kind_counts)
        report["suspect_dispersed_parking"] = suspect_parking[:40]
        report["suspect_rv_labels"] = suspect_rv[:40]
        report["forbidden_public_copy"] = forbidden_copy[:40]
        duplicates = [
            {"key": key, "count": len(items), "samples": items[:5]}
            for key, items in duplicate_names.items()
            if len(items) > 1
        ]
        duplicates.sort(key=lambda item: item["count"], reverse=True)
        report["duplicate_name_clusters"] = duplicates[:40]
    finally:
        db.close()
    return report


def sample_place(place: dict[str, Any], text: str, *, include_text: bool = True) -> dict[str, Any]:
    sample = {
        "id": place.get("trailhead_place_id") or place.get("id"),
        "name": place.get("name") or place.get("canonical_name"),
        "category": place.get("category"),
        "subtype": place.get("subtype") or place.get("land_type"),
        "source": place.get("source"),
        "lat": place.get("lat"),
        "lng": place.get("lng"),
    }
    if include_text:
        sample["text"] = compact(text)[:220]
    return sample


def normalized_name_key(value: object) -> str:
    text = compact(value).lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\b(national park|national forest|campground|campgrounds|campsite|camp site|trailhead|trail)\b", " ", text)
    return re.sub(r"[^a-z0-9]+", "", text)[:80]


def audit_official_db(path: Path) -> dict[str, Any]:
    db = connect(path)
    if not db:
        return {"path": str(path), "exists": False}
    report: dict[str, Any] = {"path": str(path), "exists": True}
    try:
        for table in ("source_dataset", "raw_record", "land_unit", "place", "trail", "facility", "activity", "official_search"):
            try:
                report[table] = db.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"]
            except sqlite3.Error:
                report[table] = None
        bad_categories = []
        try:
            rows = db.execute(
                """SELECT id, canonical_type, title, category, agency
                   FROM official_search
                   WHERE canonical_type='trail'
                      OR UPPER(category) IN ({})
                   LIMIT 500""".format(",".join("?" for _ in TRAIL_SURFACE_CATEGORY_VALUES))
                ,
                tuple(TRAIL_SURFACE_CATEGORY_VALUES),
            ).fetchall()
            for row in rows:
                if row["canonical_type"] == "trail" and row["category"] != "trail":
                    bad_categories.append(dict(row))
                elif str(row["category"] or "").upper() in TRAIL_SURFACE_CATEGORY_VALUES and row["category"] != "trail":
                    bad_categories.append(dict(row))
        except sqlite3.Error:
            pass
        report["official_search_bad_categories"] = bad_categories[:40]
        report["official_search_bad_category_count"] = len(bad_categories)
    finally:
        db.close()
    return report


def load_serving_items(path: Path) -> tuple[bool, list[dict[str, Any]]]:
    if not path.exists():
        return False, []
    try:
        payload = json.loads(path.read_text())
    except Exception:
        return True, []
    items = payload.get("items") if isinstance(payload, dict) else []
    return True, [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def audit_serving_index(path: Path, kind: str) -> dict[str, Any]:
    exists, items = load_serving_items(path)
    report: dict[str, Any] = {"path": str(path), "exists": exists, "count": len(items)}
    forbidden_copy: list[dict[str, Any]] = []
    rough_copy: list[dict[str, Any]] = []
    suspect_rv: list[dict[str, Any]] = []
    suspect_parking: list[dict[str, Any]] = []
    non_overnight_camps: list[dict[str, Any]] = []
    misrouted_camping_records: list[dict[str, Any]] = []
    review_only_trails: list[dict[str, Any]] = []
    clipped_names: list[dict[str, Any]] = []
    duplicate_names: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)

    for item in items:
        text = public_text_from_serving_item(item, kind)
        if kind == "trail" and item.get("review_only"):
            review_only_trails.append(sample_serving_item(item, kind, text, include_text=False))
            continue
        if PUBLIC_COPY_FORBIDDEN_RE.search(text):
            forbidden_copy.append(sample_serving_item(item, kind, text))
        public_summary = item.get("summary") if kind in {"camp", "trail"} else item.get("description")
        if kind == "trail":
            public_summary = " ".join(compact(item.get(key)) for key in ("summary", "difficulty", "allowed_uses", "surface", "season_text") if compact(item.get(key)))
        if rough_public_copy(public_summary):
            rough_copy.append(sample_serving_item(item, kind, compact(public_summary)))
        if kind == "camp":
            if is_non_overnight_camp_label(item.get("name"), item.get("label"), item.get("kind")):
                non_overnight_camps.append(sample_serving_item(item, kind, text))
            if item.get("kind") == "dispersed_camp" and is_overnight_parking_label(text):
                suspect_parking.append(sample_serving_item(item, kind, text))
            if item.get("kind") == "rv_park" and not is_primary_rv_label(item.get("name")):
                suspect_rv.append(sample_serving_item(item, kind, text))
        elif kind == "explore":
            if str(item.get("group") or "").lower() == "camping" and is_non_overnight_camp_label(
                item.get("title"), item.get("category"), item.get("group")
            ):
                non_overnight_camps.append(sample_serving_item(item, kind, text))
            if str(item.get("group") or "").lower() == "camping" and looks_like_misrouted_explore_camping(item):
                misrouted_camping_records.append(sample_serving_item(item, kind, text))
            if str(item.get("category") or "").lower() == "rv_park" and not is_primary_rv_label(item.get("title")):
                suspect_rv.append(sample_serving_item(item, kind, text))
        name = item.get("name") if kind in {"camp", "trail"} else item.get("title")
        if CONFIRMED_CLIPPED_NAME_RE.search(compact(name)):
            clipped_names.append(sample_serving_item(item, kind, text, include_text=False))
        key = normalized_name_key(name)
        if key:
            try:
                lat = round(float(item.get("lat")), 3)
                lng = round(float(item.get("lng")), 3)
            except Exception:
                lat = None
                lng = None
            duplicate_names[f"{kind}:{key}:{lat}:{lng}"].append(sample_serving_item(item, kind, text, include_text=False))

    duplicates = [
        {"key": key, "count": len(values), "samples": values[:5]}
        for key, values in duplicate_names.items()
        if len(values) > 1
    ]
    duplicates.sort(key=lambda item: item["count"], reverse=True)
    report["forbidden_public_copy"] = forbidden_copy[:40]
    report["rough_public_copy"] = rough_copy[:40]
    report["non_overnight_camps"] = non_overnight_camps[:40]
    report["misrouted_camping_records"] = misrouted_camping_records[:40]
    report["suspect_dispersed_parking"] = suspect_parking[:40]
    report["suspect_rv_labels"] = suspect_rv[:40]
    report["review_only_trails"] = review_only_trails[:40]
    report["clipped_public_names"] = clipped_names[:40]
    report["duplicate_name_clusters"] = duplicates[:40]
    report["duplicate_public_trails"] = duplicates[:40] if kind == "trail" else []
    return report


def sample_serving_item(item: dict[str, Any], kind: str, text: str, *, include_text: bool = True) -> dict[str, Any]:
    sample = {
        "id": item.get("id"),
        "name": item.get("name") or item.get("title"),
        "category": item.get("category"),
        "kind": item.get("kind") or item.get("group"),
        "lat": item.get("lat"),
        "lng": item.get("lng"),
    }
    if include_text:
        sample["text"] = compact(text)[:220]
    return sample


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Trailhead canonical/catalog data quality without changing data.")
    parser.add_argument("--app-db", default=str(APP_DB))
    parser.add_argument("--official-db", default=str(OFFICIAL_DB))
    parser.add_argument("--serving-dir", default=str(SERVING_DIR))
    parser.add_argument("--fail-on-findings", action="store_true")
    args = parser.parse_args()

    serving_dir = Path(args.serving_dir)
    report = {
        "app_db": audit_app_db(Path(args.app_db)),
        "official_db": audit_official_db(Path(args.official_db)),
        "serving_indexes": {
            "camps": audit_serving_index(serving_dir / "camps.candidate.json", "camp"),
            "explore": audit_serving_index(serving_dir / "explore.candidate.json", "explore"),
            "trails": audit_serving_index(serving_dir / "trails.candidate.json", "trail"),
        },
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    if args.fail_on_findings:
        app = report.get("app_db") or {}
        official = report.get("official_db") or {}
        failures = sum(
            len(app.get(key) or [])
            for key in ("suspect_dispersed_parking", "suspect_rv_labels", "forbidden_public_copy")
        ) + int(official.get("official_search_bad_category_count") or 0)
        serving = report.get("serving_indexes") or {}
        for index_report in serving.values():
            failures += sum(
                len(index_report.get(key) or [])
                for key in (
                    "forbidden_public_copy",
                    "rough_public_copy",
                    "non_overnight_camps",
                    "misrouted_camping_records",
                    "suspect_dispersed_parking",
                    "suspect_rv_labels",
                    "duplicate_public_trails",
                    "review_only_trails",
                    "clipped_public_names",
                )
            )
        return 1 if failures else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
