# Live Upgrade Checkpoint 12 Audit: Map Navigation Stability

**Date:** 2026-06-25
**Commit target:** iOS navigation pan stability, native camera follow debounce,
recent map viewport cache, and map-layer QA documentation.

## Scope Completed

- Added `docs/design-decisions/map-navigation-stability.md` before documenting
  the implementation.
- Added a Figma checkpoint frame:
  - File: Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`
  - Frame: `Checkpoint 12 - Map Navigation Stability`
  - Node: `15:2`
- Hardened `NativeMap` camera gesture handling:
  - touch start now starts the gesture hold but does not notify the parent by
    itself
  - region-change and tracking-mode events notify the parent through one
    debounced breakaway path
  - repeated gesture events inside the cooldown window no longer repeatedly
    dispatch the same follow-off transition
- Added a small recent-viewport cache in `NativeMap`:
  - stores the last non-navigation viewport at most every 2.5 seconds
  - restores it for up to 5 minutes when the map remounts without route
    waypoints or a search marker
- Added a parent-side guard in `map.tsx` so native map gesture callbacks only
  flip `navCameraFollow` off once per pan burst.
- Cleaned visible map search and live-condition labels so map UI no longer
  falls back to `Geocode`, `Mapbox geocode`, or a raw provider label.
- Reconfirmed from Checkpoint 6 that:
  - Trailhead Topo is first in the layer sheet
  - Mapbox Outdoors is first in the Mapbox style rail, directly after
    Trailhead Topo in the layer workflow
  - Explorer wording is removed from the layer-sheet workflow
  - no new paid gate was added around Mapbox styles

## Research Reviewed

- Mobbin navigation patterns from Google Maps, Waze, Apple Maps, and Transit.
- User-provided Figma files:
  - Untitled UI Styles
  - Untitled UI Variables
  - Nucleus UI Lite
  - Sublima Mobile App PRO
  - dark style guide
- Current Trailhead map implementation and prior map-sheet checkpoint docs.

## Files Changed

- `docs/design-decisions/map-navigation-stability.md`
- `docs/live-upgrade-checkpoint-12-map-navigation-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `docs/live-upgrade-refresh-handoff.md`
- `mobile/app/(tabs)/map.tsx`
- `mobile/components/NativeMap/index.tsx`

## Audit Notes

- No route payloads, partner APIs, subscription rules, or planner contracts were
  changed.
- Navigation does not end when the user pans the map.
- The native route-progress engine can keep running while the camera is in
  free-camera mode.
- The locate/follow button remains the explicit return-to-follow action.
- The viewport cache is intentionally short-lived and is skipped during active
  navigation, route waypoint startup, or search-marker startup.
- This is a stability checkpoint, not the full unified Mapbox bridge.
- A strict raw copy scan of `map.tsx` was reviewed. The remaining blocked-term
  hits are existing internal report-source enum comparisons (`provider`) rather
  than visible UI copy; visible map labels were changed to Trailhead-facing
  wording.

## Validation

- `cd mobile && npx tsc --noEmit` - passed.
- `cd mobile && npm run audit:copy` - passed.
- `cd mobile && npm run audit:routes` - passed.
- `git diff --check` - passed.
- `cd mobile && node scripts/user-facing-copy-audit.mjs 'app/(tabs)/map.tsx'`
  - reviewed; remaining hits are internal report-source enum literals, not
    visible UI copy.
- Figma checkpoint screenshot reviewed at
  `/tmp/trailhead-checkpoint-12-figma-fixed.png`.

## Remaining Risks

- The reported iOS crash requires native-device smoke testing after OTA because
  web and TypeScript validation cannot reproduce RNMapbox/MapLibre gesture
  crashes.
- If the crash persists, capture iOS crash logs around `Camera`,
  `followUserLocation`, and gesture events before changing the navigation model.
