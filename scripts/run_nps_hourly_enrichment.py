#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.explore_sources.nps.fetch_nps import (
    NpsRequestBudget,
    NpsRequestBudgetExceeded,
    fetch_nps_source_pack_to_cache,
)


RICH_ENDPOINTS = [
    "places",
    "thingstodo",
    "campgrounds",
    "visitorcenters",
    "alerts",
    "articles",
    "events",
    "tours",
    "parkinglots",
    "feespasses",
]

MAX_NPS_API_CALLS = 700
DEFAULT_CANDIDATE_ROOT = Path("data/explore/audit_candidates/nps")
NPS_MODULE_KEYS = (
    "things_to_do",
    "guided",
    "things_to_see",
    "visitor_centers",
    "campgrounds",
    "events",
    "parking_lots",
    "fees",
    "passes",
    "alerts",
    "operating_hours",
)
NPS_DESTINATION_MODULE_KEYS = (
    "things_to_see",
    "things_to_do",
    "campgrounds",
    "visitor_centers",
    "events",
    "parking_lots",
    "guided",
)

AUDIT_ENV_BLOCKLIST = {
    "GEOAPIFY_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_MAPS_API_KEY",
    "GOOGLE_PLACES_API_KEY",
    "FOURSQUARE_API_KEY",
    "FSQ_API_KEY",
    "MAPBOX_TOKEN",
    "MAPBOX_ACCESS_TOKEN",
}

PRIORITY_PARK_CODES = [
    "yose",
    "zion",
    "grca",
    "yell",
    "glac",
    "acad",
    "olym",
    "grsm",
    "arch",
    "cany",
    "seki",
    "romo",
    "jotr",
    "ever",
    "dena",
    "hale",
    "havo",
    "bibe",
    "shen",
    "brca",
]

BASE_CATALOG_ARGS = [
    "--source-fixture",
    "tests/fixtures/explore_sources/osm_yosemite_sample.geojson",
    "--source-fixture",
    "tests/fixtures/explore_sources/osm_pakistan_sample.geojson",
    "--ridb-fixture",
    "tests/fixtures/explore_sources/ridb_sample.json",
    "--usfs-fixture",
    "tests/fixtures/explore_sources/usfs_sierra_sample.geojson",
    "--blm-fixture",
    "tests/fixtures/explore_sources/blm_moab_sample.geojson",
    "--wikidata-fixture",
    "tests/fixtures/explore_sources/wikidata_pakistan_landmarks_sample.json",
    "--openbeta-fixture",
    "tests/fixtures/explore_sources/openbeta_climbing_sample.json",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one resumable NPS Explore rich-source enrichment batch.")
    parser.add_argument("--max-api-calls", type=int, default=MAX_NPS_API_CALLS, help=f"Hard cap for NPS HTTP requests in this invocation (maximum {MAX_NPS_API_CALLS}).")
    parser.add_argument("--estimated-calls-per-park", type=int, default=25, help="Conservative planning estimate used to pick batch size.")
    parser.add_argument("--batch-size", type=int, default=None, help="Optional park count cap for this run.")
    parser.add_argument("--park-code", action="append", default=[], help="Override target park code. May be repeated.")
    parser.add_argument("--force-fetch", action="store_true", help="Refetch selected park codes even if a rich cache exists.")
    parser.add_argument("--dry-run", action="store_true", help="Show the selected parks without fetching or rebuilding.")
    parser.add_argument("--rebuild-cache-only", action="store_true", help="Build and audit a candidate from the existing cache without making NPS API requests.")
    parser.add_argument("--skip-rebuild", action="store_true", help="Fetch cache files but do not build an audited candidate catalog.")
    parser.add_argument("--run-audits", action="store_true", help="Run the existing read-only Explore QA after the candidate audit passes.")
    parser.add_argument("--candidate-root", default=str(DEFAULT_CANDIDATE_ROOT), help="Root directory for candidate-only catalog builds.")
    parser.add_argument("--candidate-run-id", default="", help="Optional stable candidate directory name for CI or review.")
    parser.add_argument("--use-railway-env", action=argparse.BooleanOptionalAction, default=True, help="Re-exec under railway run when NPS_API_KEY is not local.")
    parser.add_argument("--source-cache-dir", default="data/explore/source_cache")
    parser.add_argument("--state", default="data/explore/nps_enrichment_state.json")
    parser.add_argument("--lock", default="data/explore/nps_enrichment.lock")
    parser.add_argument("--related-max-records", type=int, default=100)
    parser.add_argument("--nps-limit", type=int, default=50)
    parser.add_argument("--nps-max-records", type=int, default=500)
    parser.add_argument("--http-timeout", type=float, default=30.0)
    parser.add_argument("--_inside-railway-env", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    validate_api_call_limit(args.max_api_calls)

    if args.use_railway_env and not args.dry_run and not args.rebuild_cache_only and not args._inside_railway_env and not os.environ.get("NPS_API_KEY"):
        return rerun_with_railway_env(args)

    with single_process_lock(Path(args.lock)):
        return run_batch(args)


def rerun_with_railway_env(args: argparse.Namespace) -> int:
    if not shutil.which("railway"):
        raise SystemExit("NPS_API_KEY is not set and railway CLI is not available. Run with NPS_API_KEY or install/link Railway.")
    forwarded = [arg for arg in sys.argv[1:] if arg != "--use-railway-env"]
    cmd = ["railway", "run", "--", sys.executable, str(Path(__file__).resolve()), *forwarded, "--_inside-railway-env"]
    print("NPS_API_KEY not found locally; re-running under Railway environment.")
    return subprocess.run(cmd, cwd=ROOT).returncode


def run_batch(args: argparse.Namespace) -> int:
    cache_dir = Path(args.source_cache_dir)
    state_path = Path(args.state)
    targets = requested_or_default_targets(args.park_code, cache_dir)
    completed_before = completed_codes(cache_dir)
    if args.force_fetch:
        remaining = targets
    else:
        remaining = [code for code in targets if code not in completed_before]
    selected = select_batch(
        remaining,
        max_api_calls=args.max_api_calls,
        estimated_calls_per_park=args.estimated_calls_per_park,
        batch_size=args.batch_size,
    )
    summary = {
        "selected_codes": selected,
        "max_api_calls": args.max_api_calls,
        "estimated_calls": len(selected) * args.estimated_calls_per_park,
        "completed_before": len(completed_before),
        "remaining_before": len(remaining),
        "dry_run": args.dry_run,
    }
    print(json.dumps(summary, indent=2))
    if args.dry_run or (not selected and not args.rebuild_cache_only):
        write_state(state_path, args, selected, completed_before, request_count=0, status="dry_run" if args.dry_run else "complete")
        return 0

    budget = NpsRequestBudget(args.max_api_calls)
    fetched: list[str] = []
    fetched_codes: list[str] = []
    if args.rebuild_cache_only:
        print("Building an audited NPS candidate from the existing cache; no API requests will be made.")
    else:
        api_key = os.environ.get("NPS_API_KEY", "").strip()
        if not api_key:
            raise SystemExit("NPS_API_KEY is required for live NPS enrichment.")
        try:
            for code in selected:
                target = fetch_nps_source_pack_to_cache(
                    api_key=api_key,
                    cache_dir=cache_dir,
                    park_codes=[code],
                    limit=args.nps_limit,
                    max_records=args.nps_max_records,
                    related_endpoints=RICH_ENDPOINTS,
                    per_park_endpoints=RICH_ENDPOINTS,
                    related_max_records=args.related_max_records,
                    timeout=args.http_timeout,
                    force=args.force_fetch,
                    request_budget=budget,
                )
                fetched.append(str(target))
                fetched_codes.append(code)
                print(f"fetched {code}: {target} ({budget.used}/{args.max_api_calls} NPS requests used)")
        except NpsRequestBudgetExceeded:
            write_state(state_path, args, selected, completed_codes(cache_dir), request_count=budget.used, status="budget_exhausted")
            raise

    candidate_dir: Path | None = None
    audit_report: dict | None = None
    if not args.skip_rebuild:
        candidate_dir = resolve_candidate_dir(Path(args.candidate_root), args.candidate_run_id)
        outputs = rebuild_catalog(cache_dir, candidate_dir)
        audit_report = audit_candidate_catalog(
            **outputs,
            completed_park_codes=completed_codes(cache_dir),
        )
        write_json(candidate_dir / "audit-report.json", audit_report)
        if not audit_report["promotion_ready"]:
            write_state(
                state_path,
                args,
                selected,
                completed_codes(cache_dir),
                request_count=budget.used,
                status="candidate_audit_failed",
                fetched=fetched,
                candidate_dir=str(candidate_dir),
            )
            raise SystemExit(f"Candidate audit failed: {candidate_dir / 'audit-report.json'}")
    if args.run_audits:
        try:
            run_audits()
        except subprocess.CalledProcessError:
            write_state(state_path, args, selected, completed_codes(cache_dir), request_count=budget.used, status="audit_failed", fetched=fetched)
            raise
    completed_after = completed_codes(cache_dir)
    write_state(
        state_path,
        args,
        selected,
        completed_after,
        request_count=budget.used,
        status="success",
        fetched=fetched,
        candidate_dir=str(candidate_dir) if candidate_dir else "",
    )
    print(json.dumps({
        "status": "success",
        "fetched_codes": fetched_codes,
        "nps_requests_used": budget.used,
        "completed_after": len(completed_after),
        "remaining_after": len([code for code in requested_or_default_targets([], cache_dir) if code not in completed_after]),
        "candidate_dir": str(candidate_dir) if candidate_dir else None,
        "candidate_promotion_ready": audit_report["promotion_ready"] if audit_report else None,
    }, indent=2))
    return 0


def requested_or_default_targets(requested: Iterable[str], cache_dir: Path) -> list[str]:
    requested_codes = unique_codes(requested)
    if requested_codes:
        return requested_codes
    national_codes = national_park_codes(cache_dir)
    return unique_codes([*PRIORITY_PARK_CODES, *national_codes])


def national_park_codes(cache_dir: Path) -> list[str]:
    nps_dir = cache_dir / "nps"
    candidates = sorted(nps_dir.glob("source-pack_with-*.json"))
    if not candidates:
        candidates = sorted(nps_dir.glob("parks_*.json"))
    for path in candidates:
        try:
            payload = json.loads(path.read_text())
        except Exception:
            continue
        parks = payload.get("data") if isinstance(payload, dict) else []
        if not isinstance(parks, list):
            continue
        codes = unique_codes(str(park.get("parkCode") or park.get("id") or "") for park in parks if isinstance(park, dict))
        if codes:
            return codes
    return []


def completed_codes(cache_dir: Path) -> set[str]:
    out: set[str] = set()
    for path in (cache_dir / "nps").glob("source-pack_codes-*_with-*.json"):
        raw = path.name.split("_with-", 1)[0].replace("source-pack_codes-", "")
        for part in raw.split("-"):
            code = part.strip().lower()
            if code:
                out.add(code)
    return out


def select_batch(
    remaining: list[str],
    *,
    max_api_calls: int,
    estimated_calls_per_park: int,
    batch_size: int | None = None,
) -> list[str]:
    if max_api_calls <= 0:
        return []
    per_park = max(1, estimated_calls_per_park)
    budget_count = max(1, max_api_calls // per_park)
    if batch_size is not None:
        budget_count = min(budget_count, max(0, batch_size))
    return remaining[:budget_count]


def validate_api_call_limit(value: int) -> int:
    if value <= 0:
        raise SystemExit("--max-api-calls must be greater than zero.")
    if value > MAX_NPS_API_CALLS:
        raise SystemExit(f"--max-api-calls cannot exceed the source-controlled limit of {MAX_NPS_API_CALLS}.")
    return value


def resolve_candidate_dir(root: Path, run_id: str = "", *, now: int | None = None) -> Path:
    run_name = str(run_id or "").strip() or f"run-{int(time.time() if now is None else now)}"
    if run_name in {".", ".."} or "/" in run_name or "\\" in run_name:
        raise SystemExit("--candidate-run-id must be one directory name.")
    candidate = root / run_name
    resolved = (ROOT / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()
    dashboard = (ROOT / "dashboard").resolve()
    if resolved == dashboard or dashboard in resolved.parents:
        raise SystemExit("NPS candidates cannot be written inside dashboard/. Promote reviewed data separately.")
    return resolved


def rebuild_catalog(cache_dir: Path, candidate_dir: Path) -> dict[str, Path]:
    nps_fixtures = nps_fixture_args(cache_dir)
    if not nps_fixtures:
        raise SystemExit("No NPS fixtures found; cannot rebuild Explore catalog.")
    candidate_dir.mkdir(parents=True, exist_ok=True)
    catalog_path = candidate_dir / "explore_catalog_v3.json"
    trails_path = candidate_dir / "explore_trail_geometries_v1.json"
    source_records_path = candidate_dir / "explore_source_records.jsonl"
    imports_path = candidate_dir / "imports"
    cmd = [
        sys.executable,
        "scripts/build_explore_catalog_v3.py",
        *BASE_CATALOG_ARGS,
        *nps_fixtures,
        *wikidata_fixture_args(cache_dir),
        "--nps-rich",
        "--source-cache-dir",
        str(cache_dir),
        "--out",
        str(catalog_path),
        "--trails-out",
        str(trails_path),
        "--source-records-out",
        str(source_records_path),
        "--imports-out",
        str(imports_path),
    ]
    subprocess.run(cmd, cwd=ROOT, check=True)
    return {
        "catalog_path": catalog_path,
        "trails_path": trails_path,
        "source_records_path": source_records_path,
    }


def audit_candidate_catalog(
    *,
    catalog_path: Path,
    trails_path: Path,
    source_records_path: Path,
    now: int | None = None,
    completed_park_codes: set[str] | None = None,
) -> dict:
    checked_at = int(time.time() if now is None else now)
    catalog = json.loads(catalog_path.read_text())
    trails = json.loads(trails_path.read_text())
    places = catalog.get("places") if isinstance(catalog, dict) else None
    trail_rows = trails.get("trails") if isinstance(trails, dict) else None
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    if catalog.get("schema_version") != 3:
        errors.append({"code": "catalog_schema", "message": "Explore candidate schema_version must be 3."})
    if not isinstance(places, list):
        errors.append({"code": "catalog_places", "message": "Explore candidate places must be a list."})
        places = []
    if catalog.get("count") != len(places):
        errors.append({"code": "catalog_count", "message": "Explore candidate count does not match places length."})
    if not isinstance(trail_rows, list):
        errors.append({"code": "trail_rows", "message": "Trail candidate trails must be a list."})
        trail_rows = []

    ids: set[str] = set()
    nps_codes: set[str] = set()
    name_locations: set[tuple[str, float, float]] = set()
    module_counts = {key: {"places": 0, "items": 0} for key in NPS_MODULE_KEYS}
    nps_count = 0
    media_count = 0
    media_review_count = 0
    stale_editorial = 0
    stale_operational = 0
    cached_places = 0
    cached_without_destination_modules = 0
    remaining_places = 0
    remaining_with_destination_modules = 0
    completed = {str(code).strip().lower() for code in (completed_park_codes or set()) if str(code).strip()}

    for index, place in enumerate(places):
        if not isinstance(place, dict):
            errors.append({"code": "place_shape", "message": f"Place at index {index} is not an object."})
            continue
        place_id = str(place.get("id") or "").strip()
        if not place_id:
            errors.append({"code": "place_id", "message": f"Place at index {index} has no stable ID."})
        elif place_id in ids:
            errors.append({"code": "duplicate_place_id", "message": f"Duplicate place ID: {place_id}"})
        ids.add(place_id)

        name = str(place.get("name") or "").strip().casefold()
        try:
            location_key = (name, round(float(place.get("lat")), 4), round(float(place.get("lng")), 4))
        except (TypeError, ValueError):
            location_key = ("", 0.0, 0.0)
        if name and location_key in name_locations:
            errors.append({"code": "duplicate_name_location", "message": f"Duplicate place name and location: {place.get('name')}"})
        elif name:
            name_locations.add(location_key)

        source_pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
        sources = place.get("sources") if isinstance(place.get("sources"), list) else []
        nps_code = str(source_pack.get("nps_park_code") or "").strip().lower()
        is_nps = bool(nps_code or place_id.startswith("place:nps:") or any(
            isinstance(source, dict) and str(source.get("source") or "").lower() == "nps"
            for source in sources
        ))
        if not is_nps:
            continue
        nps_count += 1
        for subcategory in place.get("subcategories") or []:
            label = str(subcategory or "").strip()
            if re.fullmatch(r"[a-z0-9]+(?:_[a-z0-9]+)+", label):
                errors.append({"code": "raw_subcategory", "message": f"NPS place exposes an internal subtype: {place_id} ({label})"})
        if not nps_code:
            errors.append({"code": "nps_code", "message": f"NPS place lacks nps_park_code: {place_id}"})
        elif nps_code in nps_codes:
            errors.append({"code": "duplicate_nps_code", "message": f"Duplicate NPS park code: {nps_code}"})
        else:
            nps_codes.add(nps_code)
        has_destination_modules = any(source_pack.get(key) for key in NPS_DESTINATION_MODULE_KEYS)
        if completed_park_codes is not None and nps_code in completed:
            cached_places += 1
            if not has_destination_modules:
                cached_without_destination_modules += 1
        elif completed_park_codes is not None:
            remaining_places += 1
            if has_destination_modules:
                remaining_with_destination_modules += 1
        if not str(source_pack.get("official_url") or "").startswith("https://"):
            errors.append({"code": "official_url", "message": f"NPS place lacks an HTTPS official URL: {place_id}"})
        if not str(source_pack.get("license") or "").strip():
            errors.append({"code": "source_license", "message": f"NPS place lacks source licensing: {place_id}"})

        updated_at = int(place.get("updated_at") or place.get("last_seen_at") or 0)
        age = max(0, checked_at - updated_at) if updated_at else None
        if age is None or age > 180 * 86400:
            stale_editorial += 1
        if any(source_pack.get(key) for key in ("alerts", "fees", "passes", "operating_hours")) and (age is None or age > 30 * 86400):
            stale_operational += 1

        for key in NPS_MODULE_KEYS:
            value = source_pack.get(key)
            if isinstance(value, list) and value:
                module_counts[key]["places"] += 1
                module_counts[key]["items"] += len(value)
                for module_item in value:
                    if not isinstance(module_item, dict):
                        continue
                    image_url = str(module_item.get("image_url") or "").strip()
                    if image_url and not image_url.startswith("https://"):
                        errors.append({"code": "module_media_url", "message": f"{place_id} {key} media URL is not HTTPS."})
            elif key == "operating_hours" and value:
                module_counts[key]["places"] += 1
                module_counts[key]["items"] += 1

        media = place.get("media") if isinstance(place.get("media"), list) else []
        for item in media:
            if not isinstance(item, dict) or not item.get("url"):
                continue
            media_count += 1
            if not str(item.get("url") or "").startswith("https://"):
                errors.append({"code": "media_url", "message": f"{place_id} media URL is not HTTPS."})
            missing = [field for field in ("caption", "credit", "license") if not str(item.get(field) or "").strip()]
            if missing:
                errors.append({"code": "media_attribution", "message": f"{place_id} media is missing {', '.join(missing)}."})
            else:
                media_review_count += 1

    if stale_editorial:
        warnings.append({"code": "stale_editorial", "message": f"{stale_editorial} NPS places need a 180-day editorial freshness review."})
    if stale_operational:
        warnings.append({"code": "stale_operational", "message": f"{stale_operational} NPS places with operational modules need a 30-day freshness review."})

    artifacts = {}
    for label, path in {
        "catalog": catalog_path,
        "trails": trails_path,
        "source_records": source_records_path,
    }.items():
        artifacts[label] = {
            "path": str(path),
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }

    source_record_count = 0
    if source_records_path.exists():
        with source_records_path.open("r", encoding="utf-8") as handle:
            source_record_count = sum(1 for line in handle if line.strip())

    report = {
        "schema_version": 1,
        "checked_at": checked_at,
        "promotion_ready": not errors,
        "errors": errors,
        "warnings": warnings,
        "counts": {
            "places": len(places),
            "nps_places": nps_count,
            "trails": len(trail_rows),
            "source_records": source_record_count,
            "media": media_count,
        },
        "module_coverage": module_counts,
        "manual_reviews": {
            "image_identity": media_review_count,
            "duplicate_resolution": 0,
            "serving_index_promotion": 1,
        },
        "artifacts": artifacts,
    }
    if completed_park_codes is not None:
        report["data_depth"] = {
            "rich_cache": {
                "places": cached_places,
                "without_destination_modules": cached_without_destination_modules,
            },
            "remaining": {
                "places": remaining_places,
                "with_destination_modules": remaining_with_destination_modules,
            },
        }
    return report


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def nps_fixture_args(cache_dir: Path) -> list[str]:
    nps_dir = cache_dir / "nps"
    national = sorted(nps_dir.glob("source-pack_with-*.json"))
    rich = sorted(nps_dir.glob("source-pack_codes-*_with-*.json"), key=rich_fixture_sort_key)
    args: list[str] = []
    for path in [*national, *rich]:
        args.extend(["--nps-fixture", str(path)])
    return args


def rich_fixture_sort_key(path: Path) -> tuple[int, str]:
    name = path.name
    code = name.split("_with-", 1)[0].replace("source-pack_codes-", "").split("-")[0]
    try:
        priority = PRIORITY_PARK_CODES.index(code)
    except ValueError:
        priority = len(PRIORITY_PARK_CODES)
    return priority, name


def wikidata_fixture_args(cache_dir: Path) -> list[str]:
    wikidata_dir = cache_dir / "wikidata"
    args: list[str] = []
    for path in sorted(wikidata_dir.glob("*.json")):
        args.extend(["--wikidata-fixture", str(path)])
    return args


def run_audits() -> None:
    env = sanitized_audit_env()
    commands = [
        [sys.executable, "scripts/qa_explore_catalog_matrix.py"],
        [sys.executable, "-m", "unittest", "tests.test_explore_sources", "tests.test_official_place_enrichment"],
    ]
    for command in commands:
        subprocess.run(command, cwd=ROOT, env=env, check=True)


def sanitized_audit_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in AUDIT_ENV_BLOCKLIST:
        env.pop(key, None)
    return env


def write_state(
    path: Path,
    args: argparse.Namespace,
    selected: list[str],
    completed: set[str],
    *,
    request_count: int,
    status: str,
    fetched: list[str] | None = None,
    candidate_dir: str = "",
) -> None:
    targets = requested_or_default_targets([], Path(args.source_cache_dir))
    payload = {
        "schema_version": 1,
        "updated_at": int(time.time()),
        "status": status,
        "max_api_calls": args.max_api_calls,
        "estimated_calls_per_park": args.estimated_calls_per_park,
        "selected_codes": selected,
        "nps_requests_used": request_count,
        "fetched": fetched or [],
        "candidate_dir": candidate_dir,
        "completed_codes": sorted(completed),
        "completed_count": len(completed),
        "remaining_codes": [code for code in targets if code not in completed],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


class single_process_lock:
    def __init__(self, path: Path):
        self.path = path
        self.fd: int | None = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise SystemExit(f"Enrichment lock already exists: {self.path}")
        os.write(self.fd, str(os.getpid()).encode("utf-8"))
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.fd is not None:
            os.close(self.fd)
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass
        return False


def unique_codes(values: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        code = str(value or "").strip().lower()
        if not code or code in seen:
            continue
        seen.add(code)
        out.append(code)
    return out


if __name__ == "__main__":
    raise SystemExit(main())
