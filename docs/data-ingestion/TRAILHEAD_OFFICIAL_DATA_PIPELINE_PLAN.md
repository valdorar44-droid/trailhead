# Trailhead Official Data Pipeline Plan

Checkpoint created 2026-07-02.

## Goal

Download official outdoor data ahead of time, store raw records, normalize them
into Trailhead records, and keep normal app browsing on local processed data.
Live external calls should stay limited to short-cache safety, weather, fire,
alerts, and booking/availability.

## First Sources

- NPS API: parks, campgrounds, visitor centers, places, Things to Do,
  activities, alerts, events, articles, news.
- NPS spatial services: POIs, trails, roads, buildings, parking, wilderness.
- RIDB/Recreation.gov: rec areas, facilities, campsites, activities,
  organizations, media, links, addresses.
- USFS EDW: recreation sites, opportunities, activities, trails, roads, land
  units, ranger districts.
- PAD-US: land ownership and manager backbone.

## Rules

- Raw-first: no normalization directly from network responses.
- Preserve attribution in details/source surfaces.
- Keep internal wording out of normal app screens.
- Things to Do means free/source activity content, not bookable tours.
- Omit empty tabs instead of showing weak placeholders.

## Existing Repo Fit

The repo currently builds Explorer from Python source importers and static JSON
catalogs. V1 extends that path and does not introduce Postgres/PostGIS.

## Implemented Commands

Root `package.json` now exposes:

- `npm run data:download`
- `npm run data:import`
- `npm run data:normalize`
- `npm run data:dedupe`
- `npm run data:refresh-dynamic`
- `npm run data:build-search`
- `npm run data:build-tiles`
- `npm run data:validate`

Shared flags include `--source`, `--dry-run`, `--force`, `--promote`,
`--limit`, `--max-records`, `--bbox`, `--state`, `--skip-existing`, and
source-specific endpoint selection.

## Current Outputs

- Raw pages are written under `data/raw/{source}/...` with metadata sidecars.
- Local SQLite raw/canonical cache:
  `data/processed/trailhead_official_data.sqlite`.
- Candidate Explorer catalog:
  `data/processed/explore_catalog_v3.candidate.json`.
- Candidate trail output:
  `data/processed/explore_trail_geometries_v1.candidate.json`.
- Search index:
  `data/processed/explore_search_index.json`.
- Visual point GeoJSON:
  `data/processed/explore_places.geojson`.

## Current Limitation

Local shell env did not have `NPS_API_KEY` or `RIDB_API_KEY`, so live API
downloads were verified with dry-runs and the candidate catalog was built from
existing cached official source packs. Large PAD-US/USFS downloads were also
left as dry-runs because this laptop has had storage pressure.
