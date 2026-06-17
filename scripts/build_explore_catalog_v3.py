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
from scripts.explore_sources.base.fetch import parse_headers, resolve_input_paths
from scripts.explore_sources.base.quality import score_place
from scripts.explore_sources.blm.import_blm import import_blm_fixture
from scripts.explore_sources.nps.import_nps import import_nps_fixture
from scripts.explore_sources.openbeta.import_openbeta import import_openbeta_fixture
from scripts.explore_sources.osm.import_geofabrik import import_osm_fixture, write_import_outputs
from scripts.explore_sources.ridb.import_ridb import import_ridb_fixture
from scripts.explore_sources.usfs.import_usfs import import_usfs_fixture
from scripts.explore_sources.wikidata.import_wikidata import import_wikidata_fixture


def build_catalog(
    source_fixtures: list[str] | None = None,
    import_out_dir: str | None = None,
    ridb_fixtures: list[str] | None = None,
    nps_fixtures: list[str] | None = None,
    usfs_fixtures: list[str] | None = None,
    blm_fixtures: list[str] | None = None,
    wikidata_fixtures: list[str] | None = None,
    openbeta_fixtures: list[str] | None = None,
    source_urls: list[str] | None = None,
    ridb_urls: list[str] | None = None,
    nps_urls: list[str] | None = None,
    usfs_urls: list[str] | None = None,
    blm_urls: list[str] | None = None,
    wikidata_urls: list[str] | None = None,
    openbeta_urls: list[str] | None = None,
    source_cache_dir: str = "data/explore/source_cache",
    http_headers: dict[str, str] | None = None,
    http_timeout: float = 30.0,
    force_fetch: bool = False,
) -> tuple[list, list, list]:
    all_records = []
    all_places = []
    all_trails = []
    fetched_at = int(time.time())
    source_paths = resolve_input_paths(source_fixtures, source_urls, source="osm", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    ridb_paths = resolve_input_paths(ridb_fixtures, ridb_urls, source="ridb", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    nps_paths = resolve_input_paths(nps_fixtures, nps_urls, source="nps", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    usfs_paths = resolve_input_paths(usfs_fixtures, usfs_urls, source="usfs", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    blm_paths = resolve_input_paths(blm_fixtures, blm_urls, source="blm", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    wikidata_paths = resolve_input_paths(wikidata_fixtures, wikidata_urls, source="wikidata", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    openbeta_paths = resolve_input_paths(openbeta_fixtures, openbeta_urls, source="openbeta", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    import_jobs = [
        ("osm", fixture, import_osm_fixture)
        for fixture in source_paths
    ] + [
        ("ridb", fixture, import_ridb_fixture)
        for fixture in ridb_paths
    ] + [
        ("nps", fixture, import_nps_fixture)
        for fixture in nps_paths
    ] + [
        ("usfs", fixture, import_usfs_fixture)
        for fixture in usfs_paths
    ] + [
        ("blm", fixture, import_blm_fixture)
        for fixture in blm_paths
    ] + [
        ("wikidata", fixture, import_wikidata_fixture)
        for fixture in wikidata_paths
    ] + [
        ("openbeta", fixture, import_openbeta_fixture)
        for fixture in openbeta_paths
    ]
    if not import_jobs:
        raise ValueError("at least one source fixture or source URL is required")
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
    parser.add_argument("--usfs-fixture", action="append", default=[], help="Prepared USFS FSGeodata fixture.")
    parser.add_argument("--blm-fixture", action="append", default=[], help="Prepared BLM recreation/public-land fixture.")
    parser.add_argument("--wikidata-fixture", action="append", default=[], help="Prepared Wikidata/Wikimedia landmark fixture.")
    parser.add_argument("--openbeta-fixture", action="append", default=[], help="Prepared OpenBeta climbing fixture.")
    parser.add_argument("--source-url", action="append", default=[], help="URL for prepared OSM-derived GeoJSON/JSON source data.")
    parser.add_argument("--ridb-url", action="append", default=[], help="URL for prepared RIDB/Recreation.gov JSON source data.")
    parser.add_argument("--nps-url", action="append", default=[], help="URL for prepared NPS JSON source data.")
    parser.add_argument("--usfs-url", action="append", default=[], help="URL for prepared USFS GeoJSON/JSON source data.")
    parser.add_argument("--blm-url", action="append", default=[], help="URL for prepared BLM GeoJSON/JSON source data.")
    parser.add_argument("--wikidata-url", action="append", default=[], help="URL for prepared Wikidata/Wikimedia JSON source data.")
    parser.add_argument("--openbeta-url", action="append", default=[], help="URL for prepared OpenBeta JSON source data.")
    parser.add_argument("--source-cache-dir", default="data/explore/source_cache", help="Directory for downloaded source payloads.")
    parser.add_argument("--http-header", action="append", default=[], help="Header for source URL requests, e.g. 'X-Api-Key: ...'.")
    parser.add_argument("--http-timeout", type=float, default=30.0, help="Source URL request timeout in seconds.")
    parser.add_argument("--force-fetch", action="store_true", help="Fetch source URLs even when a cached payload exists.")
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
        usfs_fixtures=args.usfs_fixture,
        blm_fixtures=args.blm_fixture,
        wikidata_fixtures=args.wikidata_fixture,
        openbeta_fixtures=args.openbeta_fixture,
        source_urls=args.source_url,
        ridb_urls=args.ridb_url,
        nps_urls=args.nps_url,
        usfs_urls=args.usfs_url,
        blm_urls=args.blm_url,
        wikidata_urls=args.wikidata_url,
        openbeta_urls=args.openbeta_url,
        source_cache_dir=args.source_cache_dir,
        http_headers=parse_headers(args.http_header),
        http_timeout=args.http_timeout,
        force_fetch=args.force_fetch,
    )
    generated_at = int(time.time())
    catalog = {
        "schema_version": 3,
        "catalog_id": "trailhead-explore-v3-real-data-foundation",
        "generated_at": generated_at,
        "source": "Prepared OSM/Geofabrik, RIDB/Recreation.gov, NPS, USFS, BLM, Wikidata, and OpenBeta fixtures; source attribution preserved",
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
