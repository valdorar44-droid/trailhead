#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Any


KEEP_COLUMNS = {"Latitude", "Longitude", "Category", "Date verified", "Open"}
CATEGORY_MAP = {
    "wild camping": "wild_camp",
    "informal campsite": "informal_camp",
}
OPEN_VALUES = {"", "open_yes", "yes", "open", "true", "1"}
DEFAULT_SOURCE = "ioverlander_private_lead"


def normalize_category(value: object) -> str | None:
    normalized = re.sub(r"\s+", " ", str(value or "").strip().lower())
    return CATEGORY_MAP.get(normalized)


def parse_verified_date(value: object) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S %Z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", raw)
    if match:
        try:
            return datetime.strptime(match.group(1), "%Y-%m-%d").date()
        except ValueError:
            return None
    return None


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_m = 6_371_000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def source_record_hash(category: str, lat: float, lng: float, verified_at: str | None) -> str:
    stable = f"{DEFAULT_SOURCE}:{category}:{lat:.6f}:{lng:.6f}:{verified_at or ''}"
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def lead_key(category: str, lat: float, lng: float) -> str:
    stable = f"{DEFAULT_SOURCE}:{category}:{round(lat, 5):.5f}:{round(lng, 5):.5f}"
    return "dsl_" + hashlib.sha256(stable.encode("utf-8")).hexdigest()[:24]


def row_to_lead(
    row: dict[str, str],
    row_number: int,
    *,
    today: date,
    max_age_days: int,
) -> tuple[dict[str, Any] | None, str | None, list[str]]:
    category = normalize_category(row.get("Category"))
    if not category:
        return None, "unsupported_category", []

    open_value = str(row.get("Open") or "").strip().lower()
    if open_value not in OPEN_VALUES:
        return None, "not_open", []

    try:
        lat = float(str(row.get("Latitude") or "").strip())
        lng = float(str(row.get("Longitude") or "").strip())
    except ValueError:
        return None, "bad_coordinate", []
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None, "bad_coordinate", []

    flags: list[str] = []
    verified = parse_verified_date(row.get("Date verified"))
    capped_verified = verified
    if verified is None:
        flags.append("missing_verified_date")
    elif verified > today:
        flags.append("future_verified_date")
        capped_verified = today
    elif (today - verified).days > max_age_days:
        return None, "stale_verified_date", []

    verified_text = capped_verified.isoformat() if capped_verified else None
    stripped_columns = sorted(
        key
        for key, value in row.items()
        if key not in KEEP_COLUMNS and str(value or "").strip()
    )
    if stripped_columns:
        flags.append("source_content_stripped")

    lead = {
        "lead_key": lead_key(category, lat, lng),
        "source": DEFAULT_SOURCE,
        "source_batch": "",
        "source_record_hash": source_record_hash(category, lat, lng, verified_text),
        "lat": lat,
        "lng": lng,
        "rounded_lat": round(lat, 5),
        "rounded_lng": round(lng, 5),
        "category": category,
        "status": "needs_field_check" if "future_verified_date" in flags else "lead",
        "confidence": 20 if flags else 25,
        "source_verified_at": verified_text,
        "review_flags": sorted(set(flags)),
        "provenance": {
            "source_kind": "private_lead",
            "source_label": "private coordinate lead",
            "license_state": "permission_required_before_publication",
            "date_policy": "future_dates_capped_to_import_date",
            "raw_fields_stripped": True,
        },
    }
    return lead, None, stripped_columns


def dedupe_leads(leads: list[dict[str, Any]], radius_m: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if radius_m <= 0:
        return leads, []
    accepted: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    grid: dict[tuple[int, int], list[dict[str, Any]]] = {}
    cell_deg = max(radius_m / 111_000.0, 0.0001)

    for lead in leads:
        lat = float(lead["lat"])
        lng = float(lead["lng"])
        cell = (math.floor(lat / cell_deg), math.floor(lng / cell_deg))
        match: dict[str, Any] | None = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for existing in grid.get((cell[0] + dx, cell[1] + dy), []):
                    if haversine_m(lat, lng, float(existing["lat"]), float(existing["lng"])) <= radius_m:
                        match = existing
                        break
                if match:
                    break
            if match:
                break
        if match:
            dup = dict(lead)
            dup["duplicate_of"] = match["lead_key"]
            duplicates.append(dup)
            continue
        accepted.append(lead)
        grid.setdefault(cell, []).append(lead)
    return accepted, duplicates


def build_import(
    csv_path: Path,
    *,
    today: date,
    max_age_days: int = 366,
    dedupe_radius_m: float = 50.0,
    batch_id: str | None = None,
) -> dict[str, Any]:
    batch = batch_id or f"{DEFAULT_SOURCE}_{today.isoformat()}_{csv_path.stem}"
    rows_read = 0
    candidates: list[dict[str, Any]] = []
    skipped: Counter[str] = Counter()
    stripped_columns: Counter[str] = Counter()
    raw_categories: Counter[str] = Counter()
    flags: Counter[str] = Counter()
    earliest: str | None = None
    latest: str | None = None

    with csv_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for rows_read, row in enumerate(reader, start=1):
            raw_categories[str(row.get("Category") or "").strip() or "missing"] += 1
            lead, skip_reason, stripped = row_to_lead(row, rows_read, today=today, max_age_days=max_age_days)
            if skip_reason:
                skipped[skip_reason] += 1
                continue
            assert lead is not None
            lead["source_batch"] = batch
            for flag in lead.get("review_flags") or []:
                flags[str(flag)] += 1
            for column in stripped:
                stripped_columns[column] += 1
            verified_at = lead.get("source_verified_at")
            if verified_at:
                earliest = verified_at if earliest is None else min(earliest, verified_at)
                latest = verified_at if latest is None else max(latest, verified_at)
            candidates.append(lead)

    leads, duplicates = dedupe_leads(candidates, dedupe_radius_m)
    category_counts = Counter(str(lead["category"]) for lead in leads)
    status_counts = Counter(str(lead["status"]) for lead in leads)
    duplicate_flags = Counter(str(dup["category"]) for dup in duplicates)
    return {
        "source_file": str(csv_path),
        "source_batch": batch,
        "rows_read": rows_read,
        "candidate_rows": len(candidates),
        "accepted_leads": len(leads),
        "duplicates_skipped": len(duplicates),
        "skipped": dict(skipped),
        "raw_categories": dict(raw_categories),
        "categories": dict(category_counts),
        "statuses": dict(status_counts),
        "review_flags": dict(flags),
        "duplicate_categories": dict(duplicate_flags),
        "earliest_verified_at": earliest,
        "latest_verified_at": latest,
        "stripped_content_columns": dict(stripped_columns),
        "leads": leads,
    }


def _parse_today(value: str | None) -> date:
    if not value:
        return date.today()
    return datetime.strptime(value, "%Y-%m-%d").date()


def _print_report(report: dict[str, Any], include_leads: bool) -> None:
    payload = dict(report)
    if not include_leads:
        payload.pop("leads", None)
    print(json.dumps(payload, indent=2, sort_keys=True))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import private dispersed camp coordinate leads from a sanitized CSV export.")
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--today", help="Import date in YYYY-MM-DD. Defaults to system date.")
    parser.add_argument("--max-age-days", type=int, default=366)
    parser.add_argument("--dedupe-radius-m", type=float, default=50.0)
    parser.add_argument("--batch-id")
    parser.add_argument("--include-leads", action="store_true", help="Include sanitized lead rows in JSON output.")
    parser.add_argument("--commit", action="store_true", help="Write accepted leads to the private staging table.")
    parser.add_argument("--license-confirmed", action="store_true", help="Required with --commit.")
    args = parser.parse_args(argv)

    if args.commit and not (args.license_confirmed or os.environ.get("DISPERSED_LEADS_LICENSE_CONFIRMED") == "1"):
        parser.error("--commit requires --license-confirmed or DISPERSED_LEADS_LICENSE_CONFIRMED=1")
    if not args.csv_path.exists():
        parser.error(f"{args.csv_path} does not exist")

    report = build_import(
        args.csv_path,
        today=_parse_today(args.today),
        max_age_days=args.max_age_days,
        dedupe_radius_m=args.dedupe_radius_m,
        batch_id=args.batch_id,
    )
    if args.commit:
        from db import store

        store.init_db()
        write_result = store.upsert_dispersed_site_leads(report["leads"], report["source_batch"])
        report["db_write"] = write_result
        report["db_summary"] = store.get_dispersed_site_lead_summary(report["source_batch"])

    _print_report(report, args.include_leads)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
