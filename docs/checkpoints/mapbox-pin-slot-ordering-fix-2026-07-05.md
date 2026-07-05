# Mapbox Pin Slot-Ordering Fix — 2026-07-05

## Scope

Following the native Mapbox SDK restore (`map-tab-native-cluster-crash-2026-07-03.md`),
user reported that pins render inconsistently between map modes on the native app:
Trailhead Topo (MapLibre) pins look correct, but in Mapbox mode ("extreme") some pins
show as plain colored dots ("blank dots") and others appear to hover/shift, unlike the
camp pins which already looked right.

## Root Cause

`mobile/components/NativeMap/index.tsx` renders all custom map data — camps, gas,
POIs, water nav aids, safe-water spots, and trail preview/trace/capture markers — as
`MapGL.ShapeSource` + `CircleLayer`/`SymbolLayer` GL layers shared between the
MapLibre (Topo) and Mapbox (`@rnmapbox/maps`) renderers.

Mapbox Standard (v3) styles use a **slot** system (`bottom`/`middle`/`top`) to control
where custom layers are inserted relative to the basemap's own 3D buildings, terrain,
and POI/label layers. A `mapboxTopSlotProps = { slot: 'top' }` helper already existed
and was applied to the `camp-*` layers only. Every other custom overlay — gas
stations, POIs, water navigation aids, safe-water spots, trail preview/capture pins —
was missing this prop entirely.

Effect: on Mapbox Standard style only (MapLibre has no slot system, so it was
unaffected), those un-slotted layers could render underneath 3D buildings/terrain or
get reordered relative to Mapbox's own basemap layers, producing the reported "blank
dot" / inconsistent look. Camps already had the fix from the crash-recovery work, but
the same fix was never extended to the other marker families, so the map looked
inconsistent — good camp pins next to degraded gas/POI/water/trail pins.

## Fix

- Added `{...mapboxTopSlotProps}` to every remaining custom point/line GL layer in
  `mobile/components/NativeMap/index.tsx`: `gas-circle`, `gas-code`, `gas-label`,
  `poi-circle`, `poi-code`, `poi-label`, all `water-nav-*` layers, all
  `safe-water-corridor-*` and `safe-water-spot-*` layers, `trail-preview-marker-halo`,
  `trail-preview-marker-dot`, `trail-capture-pin-dot`, `trail-capture-pin-label`.
- `mapboxTopSlotProps` evaluates to `{}` on MapLibre/Topo mode, so this is a no-op
  there — purely additive, zero behavior change outside Mapbox Standard mode.
- Considered also disabling Mapbox Standard's own built-in POI/landmark labels
  (`showPointOfInterestLabels`, `showLandmarkIcons`, etc.) to remove the competing
  built-in pins, but reverted that change: `NativeMap/index.web.tsx`'s
  `selectFeatureAtScreenPoint` / `queryVisibleFeatures` / `getVisibleMapCandidates`
  and the native `mapboxStandardInteractions` tap-to-select flow both depend on
  querying those same rendered POI/place layers to resolve real-world places tapped
  on the map. Hiding the layers would have silently broken that existing feature, so
  the config was left unchanged.

## Validation

- `cd mobile && npx tsc --noEmit` — clean.
- `npm run audit:copy` — passed (1 file).
- `npm run audit:routes` — passed 13/13 cases against production API.
- `node scripts/map-smoke-playwright.mjs --url http://127.0.0.1:8082/map` — PASS,
  `hasMapCanvas: true`, 0 console/page errors.
- Manual Playwright pass against `npx expo start --web` on `http://127.0.0.1:8082`:
  - Searched "Moab, Utah", loaded 100+ camp/trail/BLM pins with correct C/T/W/D codes.
  - Cycled Map → Explore → Route → Report → Profile → Map: 0 console errors on every
    tab, map survived the round trip.
- Web renderer (`index.web.tsx`) always draws camp/gas/poi/community pins as
  `mapboxgl.Marker` DOM elements regardless of Topo/Mapbox style, so this specific
  slot-ordering bug is native-only and cannot be reproduced in the browser. The fix
  was verified by code audit (matching the already-proven-correct `camp-*` layer
  pattern) rather than a literal side-by-side native screenshot.

## Remaining

- Confirm the fix on a physical iOS/Android binary in Mapbox mode: gas stations,
  OSM POIs, water nav aids, and trail preview pins should now render fully (not as
  bare dots) and stay stable during pitch/zoom, matching camp pins.
