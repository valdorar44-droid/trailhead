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
from scripts.explore_sources.nps.fetch_nps import fetch_nps_parks_to_cache, fetch_nps_source_pack_to_cache
from scripts.explore_sources.nps.import_nps import import_nps_fixture
from scripts.explore_sources.openbeta.import_openbeta import import_openbeta_fixture
from scripts.explore_sources.osm.import_geofabrik import import_osm_fixture, write_import_outputs
from scripts.explore_sources.ridb.fetch_ridb import fetch_ridb_facilities_to_cache
from scripts.explore_sources.ridb.import_ridb import import_ridb_fixture
from scripts.explore_sources.usfs.import_usfs import import_usfs_fixture
from scripts.explore_sources.wikidata.fetch_wikidata import fetch_wikidata_places_to_cache
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
    nps_live: bool = False,
    nps_api_key: str = "",
    nps_park_codes: list[str] | None = None,
    nps_states: list[str] | None = None,
    nps_query: str = "",
    nps_limit: int = 50,
    nps_max_records: int = 500,
    nps_rich: bool = False,
    nps_related_endpoints: list[str] | None = None,
    nps_per_park_endpoints: list[str] | None = None,
    nps_related_max_records: int = 100,
    ridb_live: bool = False,
    ridb_api_key: str = "",
    ridb_states: list[str] | None = None,
    ridb_activities: list[str] | None = None,
    ridb_query: str = "",
    ridb_latitude: float | None = None,
    ridb_longitude: float | None = None,
    ridb_radius: float | None = None,
    ridb_limit: int = 50,
    ridb_max_records: int = 500,
    wikidata_live: bool = False,
    wikidata_class_qids: list[str] | None = None,
    wikidata_country_qids: list[str] | None = None,
    wikidata_limit: int = 500,
) -> tuple[list, list, list]:
    all_records = []
    all_places = []
    all_trails = []
    fetched_at = int(time.time())
    source_paths = resolve_input_paths(source_fixtures, source_urls, source="osm", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    ridb_paths = resolve_input_paths(ridb_fixtures, ridb_urls, source="ridb", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    if ridb_live:
        ridb_paths.append(str(fetch_ridb_facilities_to_cache(
            api_key=ridb_api_key,
            cache_dir=source_cache_dir,
            states=ridb_states,
            activities=ridb_activities,
            query=ridb_query,
            latitude=ridb_latitude,
            longitude=ridb_longitude,
            radius=ridb_radius,
            limit=ridb_limit,
            max_records=ridb_max_records,
            timeout=http_timeout,
            force=force_fetch,
        )))
    nps_paths = resolve_input_paths(nps_fixtures, nps_urls, source="nps", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    if nps_live:
        nps_fetcher = fetch_nps_source_pack_to_cache if nps_rich else fetch_nps_parks_to_cache
        nps_fetch_kwargs = {
            "api_key": nps_api_key,
            "cache_dir": source_cache_dir,
            "park_codes": nps_park_codes,
            "states": nps_states,
            "query": nps_query,
            "limit": nps_limit,
            "max_records": nps_max_records,
            "timeout": http_timeout,
            "force": force_fetch,
        }
        if nps_rich:
            nps_fetch_kwargs.update({
                "related_endpoints": nps_related_endpoints,
                "per_park_endpoints": nps_per_park_endpoints,
                "related_max_records": nps_related_max_records,
            })
        nps_paths.append(str(nps_fetcher(**nps_fetch_kwargs)))
    usfs_paths = resolve_input_paths(usfs_fixtures, usfs_urls, source="usfs", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    blm_paths = resolve_input_paths(blm_fixtures, blm_urls, source="blm", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    wikidata_paths = resolve_input_paths(wikidata_fixtures, wikidata_urls, source="wikidata", cache_dir=source_cache_dir, headers=http_headers, timeout=http_timeout, force=force_fetch)
    if wikidata_live:
        wikidata_paths.append(str(fetch_wikidata_places_to_cache(
            cache_dir=source_cache_dir,
            class_qids=wikidata_class_qids,
            country_qids=wikidata_country_qids,
            limit=wikidata_limit,
            timeout=http_timeout,
            force=force_fetch,
        )))
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
    parser.add_argument("--nps-live", action="store_true", help="Fetch live NPS parks API data into the source cache before importing.")
    parser.add_argument("--nps-api-key", default="", help="NPS API key. Defaults to NPS_API_KEY when omitted.")
    parser.add_argument("--nps-park-code", action="append", default=[], help="NPS park code to fetch, e.g. yose. May be repeated.")
    parser.add_argument("--nps-state", action="append", default=[], help="NPS stateCode filter, e.g. CA. May be repeated.")
    parser.add_argument("--nps-query", default="", help="NPS parks q search term.")
    parser.add_argument("--nps-limit", type=int, default=50, help="NPS API page size.")
    parser.add_argument("--nps-max-records", type=int, default=500, help="Maximum NPS parks to cache/import.")
    parser.add_argument("--nps-rich", action="store_true", help="Fetch NPS park source packs with places, things to do, visitor centers, campgrounds, alerts, and images.")
    parser.add_argument("--nps-related-endpoint", action="append", default=[], help="NPS related endpoint for --nps-rich, e.g. places or thingstodo. May be repeated.")
    parser.add_argument("--nps-per-park-endpoint", action="append", default=None, help="Fetch a related endpoint one park at a time for higher-fidelity grouping. Use sparingly to avoid NPS rate limits.")
    parser.add_argument("--nps-related-max-records", type=int, default=100, help="Maximum related records per NPS endpoint per park.")
    parser.add_argument("--ridb-live", action="store_true", help="Fetch live RIDB facilities API data into the source cache before importing.")
    parser.add_argument("--ridb-api-key", default="", help="RIDB API key. Defaults to RIDB_API_KEY or RECREATION_GOV_API_KEY when omitted.")
    parser.add_argument("--ridb-state", action="append", default=[], help="RIDB state filter, e.g. CA. May be repeated.")
    parser.add_argument("--ridb-activity", action="append", default=[], help="RIDB activity filter, e.g. CAMPING. May be repeated.")
    parser.add_argument("--ridb-query", default="", help="RIDB facilities query search term.")
    parser.add_argument("--ridb-latitude", type=float, default=None, help="RIDB latitude filter for nearby facility search.")
    parser.add_argument("--ridb-longitude", type=float, default=None, help="RIDB longitude filter for nearby facility search.")
    parser.add_argument("--ridb-radius", type=float, default=None, help="RIDB nearby radius filter.")
    parser.add_argument("--ridb-limit", type=int, default=50, help="RIDB API page size.")
    parser.add_argument("--ridb-max-records", type=int, default=500, help="Maximum RIDB facilities to cache/import.")
    parser.add_argument("--wikidata-live", action="store_true", help="Fetch live Wikidata SPARQL places into the source cache before importing.")
    parser.add_argument("--wikidata-class-qid", action="append", default=[], help="Wikidata class QID to fetch, e.g. Q35666 for glaciers. May be repeated.")
    parser.add_argument("--wikidata-country-qid", action="append", default=[], help="Wikidata country QID filter, e.g. Q843 for Pakistan. May be repeated.")
    parser.add_argument("--wikidata-limit", type=int, default=500, help="Maximum Wikidata SPARQL rows to cache/import.")
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
        nps_live=args.nps_live,
        nps_api_key=args.nps_api_key,
        nps_park_codes=args.nps_park_code,
        nps_states=args.nps_state,
        nps_query=args.nps_query,
        nps_limit=args.nps_limit,
        nps_max_records=args.nps_max_records,
        nps_rich=args.nps_rich,
        nps_related_endpoints=args.nps_related_endpoint,
        nps_per_park_endpoints=args.nps_per_park_endpoint,
        nps_related_max_records=args.nps_related_max_records,
        ridb_live=args.ridb_live,
        ridb_api_key=args.ridb_api_key,
        ridb_states=args.ridb_state,
        ridb_activities=args.ridb_activity,
        ridb_query=args.ridb_query,
        ridb_latitude=args.ridb_latitude,
        ridb_longitude=args.ridb_longitude,
        ridb_radius=args.ridb_radius,
        ridb_limit=args.ridb_limit,
        ridb_max_records=args.ridb_max_records,
        wikidata_live=args.wikidata_live,
        wikidata_class_qids=args.wikidata_class_qid,
        wikidata_country_qids=args.wikidata_country_qid,
        wikidata_limit=args.wikidata_limit,
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
