# Discovery Bridge Caller Migration Audit

Date: 2026-06-27

## Scope

Move the main camp and stay discovery callers onto `/api/discovery/context` so Route Builder, Explorer, map context, planner context, and map cards pull from the same cached source blend before falling back to older endpoints.

## Completed

- Added `api.getDiscoveryCamps(...)` in `mobile/lib/api.ts`.
  - Uses `/api/discovery/context` first.
  - Keeps `nearby-camps` as the final fallback.
  - Preserves limit, light/full mode, stays, force refresh, zoom, and stale refresh hints.
- Route Builder now uses the bridge helper for:
  - leg camp fallback
  - overnight endpoint camp fallback
  - area discovery fallback
  - camp-aware route anchor fallback
- Map now uses the bridge helper for:
  - search route context camps
  - community pin context camps
  - day camp picker candidates
  - camp discovery center fallback
  - tile/map camp match upgrades
- Explorer camp rails now use the bridge helper before falling back to stored official cards.
- Route search modal camp and private stay categories now use the bridge helper.
- Backend planner context uses `discovery_context(...)` for camp/stay data and keeps `nearby_camps(...)` as an empty/error fallback.
- Backend route camp-window selection uses `discovery_context(...)` for each route sample and falls back to `nearby_camps(...)`.
- Backend smart packs use `discovery_context(...)` for camp/stay categories, which moves route intelligence and co-pilot-style nearby context onto the same source blend.
- Backend map card/place context now uses `discovery_context(...)` through `_discovery_context_smart_places(...)`, converting camp pins into related place rails and retaining the smart-pack fallback.
- Backend overnight map-card matching uses `discovery_context(...)` before the older nearby matcher.

## Audit Notes

- Mobile direct `getNearbyCamps(...)` callers are now limited to `api.getDiscoveryCamps(...)` fallback internals.
- Backend direct `nearby_camps(...)` calls remain only for endpoint internals, bridge fallbacks, campsite detail/search flows, and offline trip essentials pack generation.
- Provider names remain backend/internal; no new user-facing Mapbox, Geoapify, OSM, or cache wording was added.
- Existing filter semantics are preserved: selected camp filters determine visible results, and the bridge receives the same normalized filter set as the prior endpoints.
- Existing UI copy and sheet behavior were not changed in this checkpoint.

## Next Checkpoint

- Build generated camp/stay bbox packs from Geofabrik/official sources so wide map views can load dense pins without live provider scans.
- Add admin/source refresh controls for stale camp records.
- Add source-specific quota/backoff metrics to the bridge response logs, not app UI.
- Consider Geoapify Places as a secondary backend source for lodging/private stay category gaps after the generated packs are in place.
