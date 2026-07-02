# Explorer Data QA Checkpoint

Checkpoint created 2026-07-02.

## User-Facing Rules

Normal screens must not expose:

- AI, generated, developer, dev
- map layer, FeatureServer, API, endpoint
- database dump, raw, schema, scrape, import, sync
- undefined, null, N/A, unavailable, 0 results
- filler badges such as offline ready or rig aware

## Things to Do Rule

Things to Do shows only clean free activities from official/open sources. Guided
or bookable tours belong in Guided/Tours surfaces and must not create or fill
the Things to Do tab.

## 2026-07-02 Implementation Checkpoint

- `scripts/explore_sources/nps/import_nps.py` now keeps NPS `thingstodo` in
  `source_pack.things_to_do` and moves NPS `tours` into `source_pack.guided`.
- `mobile/components/explore/ExploreDetailSheet.tsx` no longer creates a
  Things to Do module from bookable/guided slots.
- `dashboard/server.py` no longer backfills tours into related Things to Do
  rails.
- `scripts/build_explore_catalog_v3.py` applies source-pack sanitizing before
  writing the catalog.
- Candidate build: `data/processed/explore_catalog_v3.candidate.json`.
- Candidate stats: 704 places, 285 Things to Do items, 30 guided items,
  0 bookable/guided items under Things to Do.
- Validation command passed: `npm run data:validate`.

## 2026-07-02 Official Cache Checkpoint

- Raw official records are stored in `data/processed/trailhead_official_data.sqlite`.
- Raw record count: 1,121,930.
- Normalizer was changed to stream Recreation.gov, USFS, and PAD-US in batches after WSL crashes from the earlier all-in-memory pass.
- Full normalized cache completed:
  - 318,234 land units.
  - 66,582 places.
  - 53,623 trails.
  - 150,534 facility/campsite rows.
  - 8,622 activity rows.
  - 662 alerts.
  - 471,551 source links.
  - 125,149 local search rows.
- PAD-US is kept as land context and excluded from normal Explorer search rows so protected-area polygons do not flood browse/search.
- Current generated Explorer candidate:
  - `data/processed/explore_catalog_v3.candidate.json`: 13,208 places.
  - `data/processed/explore_search_index.json`: 13,208 rows.
  - `data/processed/explore_places.geojson`: 13,208 features.
- Validation passed after rebuild: `npm run data:validate`.
- Remaining warning is on older promoted catalogs (`dashboard/explore_catalog_v1.json` and `dashboard/explore_catalog_v3.json`), not the rebuilt candidate. Promote/rebuild those before shipping this data set.

## 2026-07-02 Map Pin Checkpoint

- Backend camp source merge now merges by source IDs, official URLs, booking URLs, and cleaned name plus nearby coordinates.
- Mobile map camp pin merge now uses cleaned name plus nearby coordinates instead of trusting source ID first.
- Duplicate map pins now preserve better source data and carry alternate source labels internally.
- Local tile camp taps now open the camp card instead of a generic place card.
- Rendered camp-like basemap features now convert to camp pins and open the camp card.
- Rendered basemap visible badge was changed from provider wording to `Map data`.
- Checks passed after these changes:
  - `python3 -m py_compile dashboard/server.py`
  - `npx tsc --noEmit --pretty false` in `mobile/`
  - `npm run data:validate`

## Required Checks

- Explorer deep scroll.
- Things to Do on NPS-rich places.
- Cards with no activity data should omit the tab.
- International/low-list cards should not use old weak schema.
- Camp/dispersed map searches still show pins and usable cards.
- Live browser/mobile pass for camp clusters: tap cluster numbers, confirm zoom/fit, then tap a visible camp.
- Live pass for rendered camp icons: tap a camp/RV/campground icon from the base map and confirm camp card opens.
