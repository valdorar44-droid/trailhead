# Live Upgrade Checkpoint 6 Audit: Map Sheets + Mapbox Layer Polish

**Date:** 2026-06-25  
**Commit target:** Map layer sheet polish, Mapbox ordering, and adjacent map copy cleanup.

## Scope Completed

- Added `docs/design-decisions/map-sheets.md` before implementation.
- Confirmed the existing layer sheet already places Trailhead Topo first and
  Mapbox Outdoors directly after it when Mapbox is available.
- Made the layer-sheet grouping explicit in `MapLayerSheetContent`:
  - primary built-in map style
  - Mapbox style cards
  - remaining built-in map styles
  - overlays
  - map tools
- Replaced the visible `EXPLORER TOOLS` layer-sheet section with `MAP TOOLS`.
- Replaced disabled map-tool support copy from `Explorer` to
  `Not available yet`.
- Renamed the map style option array feeding the sheet from premium wording to
  Mapbox wording at the call site.
- Cleaned adjacent map/filter user-facing copy:
  - old Explorer plan copy now says credits or a plan
  - old Provider detail copy now says photos/source notices
  - filter locked-services alert now points to map search instead of Explorer

## Research Reviewed

- PR #12 master live-app upgrade plan and reference board.
- `docs/adventure-app-production-readiness-plan.md` map modularization and
  filter sheet notes.
- Mobbin authenticated session:
  - search: `map filter layers`
  - reviewed Lyft, Booking.com, and komoot map/filter examples
  - extracted compact, task-first map action grouping only
- Figma:
  - Nucleus UI Lite node `2802:306`
  - extracted compact row, 16px spacing, divider, and disclosure rhythm

## Files Changed

- `docs/design-decisions/map-sheets.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `mobile/app/(tabs)/map.tsx`
- `mobile/components/map/MapLayerSheetContent.tsx`
- `mobile/components/map/MapFilterSheet.tsx`
- `mobile/components/map/CampReviewsSection.tsx`

## Audit Notes

- No new feature logic was added to `map.tsx`.
- Mapbox styles remain available wherever `extremeMapboxSupported` and
  `mapboxToken` allow them; no new paid gate was introduced.
- The old Explorer-labelled layer-sheet entry point is removed from the map
  layer workflow.
- The separate `MapStyleSheet` still accepts legacy prop names internally, but
  the data it receives now comes from `mapboxStyleItems`. A future cleanup can
  rename that API after all map style entry points are consolidated.

## Validation

- `cd mobile && npx tsc --noEmit` - passed.
- `cd mobile && npm run audit:copy` - passed.
- `cd mobile && npm run audit:routes` - passed.
- `git diff --check` - passed.
- Targeted text scan for old map-surface Explorer/provider copy - passed.

## Remaining Risks

- This checkpoint did not run a device-level map sheet smoke test because the
  current work is OTA-safe React Native UI/copy and TypeScript-validated.
- Mapbox Navigation mode pan stability remains a separate native/runtime
  concern and should be handled in the navigation checkpoint, not through this
  layer-sheet polish.
