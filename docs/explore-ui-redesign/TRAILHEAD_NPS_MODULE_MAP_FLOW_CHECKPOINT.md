# TrailHead NPS Module Map Flow Checkpoint

Date: 2026-06-19

## Scope

This checkpoint covers the Explorer place-detail flow where a source-backed place keeps its main photo hero, then opens focused modules such as Where to Stay, What to See, Things to Do, Visitor Centers, Calendar, and Map & Directions inside Explorer before sending the user to the main map.

## Implemented

- Added source-pack child detail pages inside `ExploreDetailSheet`.
- Added module map-preview heroes for source-backed module pages.
- Added child `Map & Directions` sections with `Show on Map`, `Directions`, and `Reserve` actions where data exists.
- Added NPS `events`, `tours`, `parkinglots`, and `feespasses` fetch/import support.
- Added richer NPS child fields: directions, hours, amenities, address, reservation URL, event date/time/location/tags.
- Added NPS HTML cleanup so event/card descriptions render as plain text.
- Added NPS relative media handling for `/common/uploads/...` URLs in Guide, Map, and Route Builder.
- Preserved source-pack events, parking lots, and passes through source-pack dedupe.
- Hid the legacy nearby campground rail when official/source-pack campground records already exist.
- Hardened Explore source freshness helpers for detail records that omit `facts`.

## Yosemite Proof Seed

Rebuilt the catalog from the national NPS cache plus the Yosemite rich source-pack cache:

```bash
python3 scripts/build_explore_catalog_v3.py --source-fixture tests/fixtures/explore_sources/osm_yosemite_sample.geojson --source-fixture tests/fixtures/explore_sources/osm_pakistan_sample.geojson --ridb-fixture tests/fixtures/explore_sources/ridb_sample.json --nps-fixture data/explore/source_cache/nps/source-pack_with-places-thingstodo-campgrounds-visitorcenters-alerts-articles_max-500.json --nps-fixture data/explore/source_cache/nps/source-pack_codes-yose_with-places-thingstodo-campgrounds-visitorcenters-alerts-articles-events-tours-parkin_max-500.json --nps-rich --usfs-fixture tests/fixtures/explore_sources/usfs_sierra_sample.geojson --blm-fixture tests/fixtures/explore_sources/blm_moab_sample.geojson --wikidata-fixture tests/fixtures/explore_sources/wikidata_pakistan_landmarks_sample.json --openbeta-fixture tests/fixtures/explore_sources/openbeta_climbing_sample.json --source-cache-dir data/explore/source_cache --out dashboard/explore_catalog_v3.json --trails-out dashboard/explore_trail_geometries_v1.json --source-records-out dashboard/explore_source_records_sample.jsonl --imports-out data/explore/imports
```

Result:

- `dashboard/explore_catalog_v3.json`: 511 places.
- `dashboard/explore_trail_geometries_v1.json`: 7 trail geometries.
- `dashboard/explore_source_records_sample.jsonl`: 500 source records.
- Yosemite source pack: 23 things to do, 96 things to see, 15 campgrounds, 4 visitor centers, 48 events, 12 parking lots.

## Browser Audit

Viewport: 430 x 932, matching a 6.5-6.9 inch phone reference.

The running app still pulls the deployed API by default, so the audit used a Playwright route mock for `/api/explore/places/place%3Anps%3Ayose` to validate the new seeded detail shape before backend deployment.

Screenshots:

- `output/playwright/explore-yosemite-stay-module-map-430x932.png`
- `output/playwright/explore-yosemite-campground-child-detail-430x932.png`

Figma:

- Added page `Explore NPS Module Map Flow - 2026-06-19` to file `apfcPdlGh5qhZJRKxQEEjn`.

Verified:

- Search opens the official Yosemite detail sheet.
- `Where to Stay` opens an in-Explorer module page with a map-preview hero and mapped campground pins.
- Source-pack campground cards open child detail pages instead of jumping straight to the map.
- Child detail shows details, hours, directions, amenities, map preview, `Show on Map`, and `Directions`.
- `Show on Map` transitions to `/map` without console errors.

## Next Batch Notes

- Use the same pattern for the next NPS park batches: national cache plus per-park rich source-pack cache, then rebuild with both fixtures.
- Keep per-park live rich fetches small to avoid NPS API pressure.
- Prefer source-pack official child records over fallback nearby rails. Use fallback rails only when source-pack records are missing.
- Before shipping a new park batch, sample at least one park with stays, one with events, one with visitor centers, and one with weak/no child media.
