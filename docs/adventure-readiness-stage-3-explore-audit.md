# Adventure Readiness Stage 3 Explore Audit

Date: 2026-06-18

Scope: Stage 3 from `docs/adventure-app-production-readiness-plan.md`.

## Changes

- Added Explore home section chips for trip, nearby, trails, parks, camps, water, scenic, tours, services, and saved places.
- Added a saved-only Explore view and cleared saved mode when users change category or Explore mode.
- Added a card-level source line that combines source, freshness, and trust.
- Added a `Nearby` card action that opens the existing place detail nearby tab instead of acting like a dead button.
- Replaced the detail sheet source cards with a source/freshness panel that shows source, freshness, trust, source count, handoff, photo credit, and notes when available.
- Added `scripts/qa_explore_catalog_matrix.py` to audit major Explore searches against generated catalogs and seed context.
- Cleaned the K2 seed/catalog hook to avoid generic wording.

## QA Matrix

Command:

```bash
python3 scripts/qa_explore_catalog_matrix.py
```

Result: pass.

Coverage checked:

- Moab: 15 catalog matches
- Yosemite: 16 catalog matches
- Zion: 9 catalog matches
- Smoky Mountains: 5 catalog matches
- Big Bend: 7 catalog matches
- Glacier: 4 catalog matches
- Olympic: 5 catalog matches
- New Zealand trail area: 41 catalog matches
- Canadian Rockies: 9 catalog matches
- Iceland route town: 2 catalog matches
- Sparse rural area: 6 catalog matches
- No-service/offline pack only: 18 catalog matches

The script now fails hard only on true dead ends: no useful fallback, no map/source action path, or invalid catalog data. It reports enrichment gaps separately so data curation can continue without blocking app code.

## Verification

- `python3 scripts/qa_explore_catalog_matrix.py` - pass
- `npx tsc --noEmit` from `mobile/` - pass
- `npm run audit:routes` from `mobile/` - pass, 12 cases
- `git diff --check` - pass

## Notes

- Moab and Yosemite still have lower photo coverage than fully curated areas. They pass the no-dead-end gate, but photo enrichment remains worthwhile.
- International camp coverage still has sparse fallback windows in the route audit for Iceland and Paris-to-Chamonix lanes. That is existing data coverage, not a Stage 3 UI regression.
- Viator remains correctly placed in Explore/detail rails rather than as primary map clutter. Live provider quality depends on the production key becoming active.
