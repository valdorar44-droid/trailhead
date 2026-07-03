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
