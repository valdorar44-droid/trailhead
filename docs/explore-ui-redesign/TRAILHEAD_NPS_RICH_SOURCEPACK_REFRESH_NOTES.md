# TrailHead NPS Rich Source-Pack Refresh Notes

Date: 2026-06-19

## Completed

- Added a rich NPS source-pack path for Explore v3.
- Ran the live Railway-backed NPS import with `NPS_API_KEY` from Railway.
- Generated `dashboard/explore_catalog_v3.json` with 511 v3 places, including 474 official NPS park records.
- Generated `dashboard/explore_trail_geometries_v1.json` with 7 trail geometries.
- Cached the live NPS source pack under `data/explore/source_cache/nps/`.

Successful batch command:

```bash
railway run -- python3 scripts/build_explore_catalog_v3.py --source-fixture tests/fixtures/explore_sources/osm_yosemite_sample.geojson --source-fixture tests/fixtures/explore_sources/osm_pakistan_sample.geojson --ridb-fixture tests/fixtures/explore_sources/ridb_sample.json --nps-live --nps-rich --nps-max-records 500 --nps-related-max-records 100 --usfs-fixture tests/fixtures/explore_sources/usfs_sierra_sample.geojson --blm-fixture tests/fixtures/explore_sources/blm_moab_sample.geojson --wikidata-fixture tests/fixtures/explore_sources/wikidata_pakistan_landmarks_sample.json --openbeta-fixture tests/fixtures/explore_sources/openbeta_climbing_sample.json --source-cache-dir data/explore/source_cache --out dashboard/explore_catalog_v3.json --trails-out dashboard/explore_trail_geometries_v1.json --source-records-out dashboard/explore_source_records_sample.jsonl --imports-out data/explore/imports
```

## Audit Snapshot

- v3 places: 511
- NPS park records: 474
- v3 records with media: 481
- v3 records with source packs: 474
- Explore catalog matrix: passing with no dead-end scenarios.

## Rate-Limit Note

A forced per-park refresh for every park hit NPS HTTP 429 rate limiting while fetching `thingstodo`. Do not repeatedly run the full per-park refresh in one burst.

## One-Hour Batching Plan

NPS default limit is 1,000 requests/hour/key. Keep TrailHead refreshes below about 700 requests/hour so retries, probes, and other work do not trip the key.

Batch shape after the current rate-limit window clears:

- Use batches of about 50 parks.
- Fetch four high-value per-park endpoints first: `places`, `thingstodo`, `campgrounds`, `visitorcenters`.
- That is about 200 requests per 50-park batch, plus pagination and retries.
- Run at most three 50-park batches per hour, with a few minutes between batches.
- Prioritize parks already visible in Explore hubs/search: `yose`, `zion`, `grca`, `yell`, `glac`, `acad`, `olym`, `grsm`, `arch`, `cany`, `seki`, `romo`, `jotr`, `ever`, `dena`, `hale`, `havo`, `bibe`, `shen`, `brca`, then continue alphabetically.
- Do not force-refresh the full 474-park set in one command.

Targeted command shape for each batch:

```bash
railway run -- python3 scripts/build_explore_catalog_v3.py --nps-live --nps-rich --nps-park-code yose --nps-park-code zion --nps-park-code grca --nps-per-park-endpoint places --nps-per-park-endpoint thingstodo --nps-per-park-endpoint campgrounds --nps-per-park-endpoint visitorcenters --nps-related-max-records 100 --force-fetch
```

After each batch, audit:

```bash
python3 scripts/qa_explore_catalog_matrix.py
python3 -m unittest tests.test_explore_sources tests.test_official_place_enrichment
```

For targeted higher-fidelity child cards after the limit clears, use the new per-endpoint override sparingly, for example:

```bash
railway run -- python3 scripts/build_explore_catalog_v3.py --nps-live --nps-rich --nps-park-code yose --nps-park-code zion --nps-park-code grca --nps-per-park-endpoint places --nps-per-park-endpoint thingstodo --nps-per-park-endpoint campgrounds --nps-per-park-endpoint visitorcenters --nps-related-max-records 100 --force-fetch
```

Merge targeted refreshed source packs back into the normal v3 build once the API limit allows it.
