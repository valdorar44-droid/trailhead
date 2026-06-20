#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
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
    parser.add_argument("--max-api-calls", type=int, default=750, help="Hard cap for NPS HTTP requests in this invocation.")
    parser.add_argument("--estimated-calls-per-park", type=int, default=25, help="Conservative planning estimate used to pick batch size.")
    parser.add_argument("--batch-size", type=int, default=None, help="Optional park count cap for this run.")
    parser.add_argument("--park-code", action="append", default=[], help="Override target park code. May be repeated.")
    parser.add_argument("--force-fetch", action="store_true", help="Refetch selected park codes even if a rich cache exists.")
    parser.add_argument("--dry-run", action="store_true", help="Show the selected parks without fetching or rebuilding.")
    parser.add_argument("--skip-rebuild", action="store_true", help="Fetch cache files but do not rebuild dashboard catalog files.")
    parser.add_argument("--run-audits", action="store_true", help="Run Explore catalog QA after a successful rebuild.")
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

    if args.use_railway_env and not args.dry_run and not args._inside_railway_env and not os.environ.get("NPS_API_KEY"):
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
    if args.dry_run or not selected:
        write_state(state_path, args, selected, completed_before, request_count=0, status="dry_run" if args.dry_run else "complete")
        return 0

    api_key = os.environ.get("NPS_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("NPS_API_KEY is required for live NPS enrichment.")

    budget = NpsRequestBudget(args.max_api_calls)
    fetched: list[str] = []
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
            print(f"fetched {code}: {target} ({budget.used}/{args.max_api_calls} NPS requests used)")
    except NpsRequestBudgetExceeded:
        write_state(state_path, args, selected, completed_codes(cache_dir), request_count=budget.used, status="budget_exhausted")
        raise

    if not args.skip_rebuild:
        rebuild_catalog(cache_dir)
    if args.run_audits:
        try:
            run_audits()
        except subprocess.CalledProcessError:
            write_state(state_path, args, selected, completed_codes(cache_dir), request_count=budget.used, status="audit_failed", fetched=fetched)
            raise
    completed_after = completed_codes(cache_dir)
    write_state(state_path, args, selected, completed_after, request_count=budget.used, status="success", fetched=fetched)
    print(json.dumps({
        "status": "success",
        "fetched_codes": selected,
        "nps_requests_used": budget.used,
        "completed_after": len(completed_after),
        "remaining_after": len([code for code in requested_or_default_targets([], cache_dir) if code not in completed_after]),
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


def rebuild_catalog(cache_dir: Path) -> None:
    nps_fixtures = nps_fixture_args(cache_dir)
    if not nps_fixtures:
        raise SystemExit("No NPS fixtures found; cannot rebuild Explore catalog.")
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
        "dashboard/explore_catalog_v3.json",
        "--trails-out",
        "dashboard/explore_trail_geometries_v1.json",
        "--source-records-out",
        "dashboard/explore_source_records_sample.jsonl",
        "--imports-out",
        "data/explore/imports",
    ]
    subprocess.run(cmd, cwd=ROOT, check=True)


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
