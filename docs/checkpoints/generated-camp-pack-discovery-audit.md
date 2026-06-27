# Generated Camp Pack Discovery Audit

Date: 2026-06-27

## Scope

Make camp discovery faster and denser by letting `/api/discovery/context` read generated regional camp packs first, then fall back to live sources only when pack coverage is missing, stale, or too thin.

## Completed

- Added pack metadata to generated place packs:
  - per-source counts
  - coverage status
  - generated timestamp
  - failed/total cell counts in the manifest
- Added a backend discovery pack reader with one-hour in-memory pack caching.
- Camp discovery now checks regional generated packs for the requested map bounds before running live provider fanout.
- Fresh, dense packs can satisfy camp discovery without calling RIDB, BLM, OSM, ACTIVE, Geoapify, or international live adapters.
- Thin, stale, or missing packs are merged with live source results, then deduped once before the response is cached.
- Added admin refresh controls:
  - invalidate discovery context cache and in-memory pack cache
  - queue a regional camp-pack rebuild
  - force-refresh one discovery bbox through live sources
- Kept provider names and cache internals out of mobile UI work in this checkpoint.

## Audit Notes

- This is backend-only. Mobile continues to call the existing discovery bridge and does not call Geoapify, OSM, RIDB, or other sources directly.
- Generated packs are treated as the fast path, not the only source. Live providers still fill gaps until pack coverage is good enough everywhere.
- The first production benefit depends on available uploaded regional `camps` packs. Missing regions still work through the existing live fallback.
- The pack refresh window is currently 14 days for discovery sufficiency. Admin refresh can rebuild a specific region sooner when source data looks old or sparse.

## Verification

- Added focused tests for region selection, pack filtering/normalization, pack sufficiency, pack-only endpoint behavior, and thin-pack live fallback.
- Validation commands for this checkpoint:
  - `python3 -m py_compile dashboard/server.py dashboard/place_packs.py scripts/camp_pack_queue.py`
  - `python3 -m unittest tests/test_discovery_pack_bridge.py tests/test_route_camp_windows.py`
  - `python3 -m unittest tests/test_official_place_enrichment.py`
  - `git diff --check`

## Next Checkpoint

- Build/upload priority US camp packs, starting with Utah and nearby western states.
- Add a lightweight production metric for pack hit, pack thin, pack stale, and live fallback rates.
- Use Geoapify Places as a backend-only supplemental fill source for private stays and service POIs where generated packs remain thin.
