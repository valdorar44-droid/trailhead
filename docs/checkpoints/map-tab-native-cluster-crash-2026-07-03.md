# Map Tab Native Cluster Crash - 2026-07-03

## Issue
- Opening the mobile Map tab could crash immediately after the camp pin polish.
- The likely trigger was native `ShapeSource.clusterProperties` plus cluster-style expressions that depend on those computed properties.
- TypeScript and web bundling do not catch this class of native style crash.

## Fix
- Removed the native `clusterProperties` path from `NativeMap`.
- Removed the cluster code label that depended on computed cluster dominance.
- Kept individual camp marker styling, including `C`, `D`, `RV`, and `P` codes.
- Kept cluster count bubbles on the older native-safe setup.

## Validation
- `npx tsc --noEmit --pretty false` passed from `mobile/`.
- `git diff --check` passed.
- `EXPO_PUBLIC_API_URL=https://api.gettrailhead.app npx expo export --platform web --output-dir /tmp/trailhead-map-crash-web` passed.

## Follow-Up
- If typed cluster bubbles are reintroduced, implement them without native `clusterProperties` or guard by native provider/version after device testing.

## 2026-07-05 Restore Native Map SDK

### Root cause
- Commit `55dc58a` re-added native `clusterProperties` and the `camp-cluster-code`
  layer after the Jul 3 crash fix. That combination crashes `@rnmapbox/maps` on
  device before React can fall back.
- `USE_NATIVE_MAP` was set to `false` in `map.tsx` as a temporary workaround,
  which forced all platforms onto the WebView HTML map instead of the native SDK.

### Fix
- Removed native `clusterProperties` and the derived cluster-code layer again in
  `mobile/components/NativeMap/index.tsx`.
- Restored `USE_NATIVE_MAP = true` in `mobile/app/(tabs)/map.tsx`.
- Kept simple count-based cluster styling and individual camp `C`/`D`/`RV`/`P`
  markers.

### Verification
- `cd mobile && npx tsc --noEmit`
- Expo web dev server on `http://127.0.0.1:8082/map`:
  - Mapbox GL canvas present (`mapboxgl-canvas`)
  - Mapbox Standard style + vector tile requests return HTTP 200
  - Explore → Map → Route → Map tab cycle keeps the canvas alive with no
    `MAP ERROR` banner
- Script: `node mobile/scripts/map-smoke-playwright.mjs --url http://127.0.0.1:8082/map`

### Remaining
- Ship OTA and confirm on a physical iOS/Android binary that the Map tab no
  longer terminates when camp clusters load.
