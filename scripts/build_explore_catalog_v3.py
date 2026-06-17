#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.explore_sources.base.aliases import apply_aliases
from scripts.explore_sources.base.cards import build_card
from scripts.explore_sources.base.dedupe import dedupe_places, link_trailheads_to_trails
from scripts.explore_sources.base.quality import score_place
from scripts.explore_sources.nps.import_nps import import_nps_fixture
from scripts.explore_sources.osm.import_geofabrik import import_osm_fixture, write_import_outputs
from scripts.explore_sources.ridb.import_ridb import import_ridb_fixture


def build_catalog(
    source_fixtures: list[str] | None = None,
    import_out_dir: str | None = None,
    ridb_fixtures: list[str] | None = None,
    nps_fixtures: list[str] | None = None,
) -> tuple[list, list, list]:
    all_records = []
    all_places = []
    all_trails = []
    fetched_at = int(time.time())
    import_jobs = [
        ("osm", fixture, import_osm_fixture)
        for fixture in (source_fixtures or [])
    ] + [
        ("ridb", fixture, import_ridb_fixture)
        for fixture in (ridb_fixtures or [])
    ] + [
        ("nps", fixture, import_nps_fixture)
        for fixture in (nps_fixtures or [])
    ]
    if not import_jobs:
        raise ValueError("at least one source fixture is required")
    for _source, fixture, importer in import_jobs:
        records, places, trails = importer(fixture, fetched_at=fetched_at)
        all_records.extend(records)
        all_places.extend(places)
        all_trails.extend(trails)
    places = dedupe_places(all_places)
    link_trailheads_to_trails(places, all_trails)
    trail_names = {trail.id: trail.name for trail in all_trails}
    for place in places:
        linked_names = [trail_names[tid] for tid in place.linked_trail_ids if tid in trail_names]
        score_place(place)
        build_card(place)
        apply_aliases(place, linked_names)
    if import_out_dir:
        write_import_outputs(all_records, places, all_trails, import_out_dir)
    return all_records, places, all_trails


def write_json(path: str | Path, payload: dict | list) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def write_jsonl(path: str | Path, records: list) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(json.dumps(item.to_dict(), ensure_ascii=False) for item in records) + ("\n" if records else ""))


def main() -> int:
    parser = argparse.ArgumentParser(description="Build TrailHead ExplorePlace v3 catalog from source fixtures.")
    parser.add_argument("--source-fixture", action="append", default=[], help="Prepared OSM-derived GeoJSON/JSON fixture.")
    parser.add_argument("--ridb-fixture", action="append", default=[], help="Prepared RIDB/Recreation.gov fixture.")
    parser.add_argument("--nps-fixture", action="append", default=[], help="Prepared NPS fixture.")
    parser.add_argument("--out", default="dashboard/explore_catalog_v3.json")
    parser.add_argument("--trails-out", default="dashboard/explore_trail_geometries_v1.json")
    parser.add_argument("--source-records-out", default="dashboard/explore_source_records_sample.jsonl")
    parser.add_argument("--imports-out", default="data/explore/imports")
    args = parser.parse_args()

    records, places, trails = build_catalog(
        source_fixtures=args.source_fixture,
        import_out_dir=args.imports_out,
        ridb_fixtures=args.ridb_fixture,
        nps_fixtures=args.nps_fixture,
    )
    generated_at = int(time.time())
    catalog = {
        "schema_version": 3,
        "catalog_id": "trailhead-explore-v3-real-data-foundation",
        "generated_at": generated_at,
        "source": "Prepared OSM/Geofabrik, RIDB/Recreation.gov, and NPS fixtures; source attribution preserved",
        "count": len(places),
        "places": [place.to_dict() for place in places],
    }
    trail_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "count": len(trails),
        "trails": [trail.to_dict() for trail in trails],
    }
    write_json(args.out, catalog)
    write_json(args.trails_out, trail_payload)
    write_jsonl(args.source_records_out, records[:500])
    print(f"wrote {len(places)} places to {args.out}")
    print(f"wrote {len(trails)} trail geometries to {args.trails_out}")
    print(f"wrote {min(len(records), 500)} source records to {args.source_records_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
