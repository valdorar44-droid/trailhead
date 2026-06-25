# Live Upgrade Checkpoint 29 Audit: Route Builder Discovery Gas Provider Boundary

**Date:** 2026-06-25
**Commit target:** Route Builder gas-provider fan-out boundary.

## Scope Planned

- Add
  `docs/design-decisions/route-builder-discovery-gas-provider-boundary.md`
  before implementation.
- Review gas-provider fan-out in `runDiscovery` for leg and area searches.
- Use Mobbin fuel/search references and Figma design-system search as research
  inputs.
- Extract reusable point fan-out/provider failure handling for gas provider
  calls.
- Keep NREL, OSM fuel, Mapbox fuel, offline fuel/propane, Nominatim fallback,
  dedupe, merge order, route projection, result sorting, selected place sheets,
  add-place behavior, and route calculations unchanged.

## Research Reviewed

- Mobbin:
  - `https://mobbin.com/screens/4d6823cd-f9a1-4d26-b015-85404063bde4`
  - `https://mobbin.com/screens/d8884341-371c-4fa1-88bb-da9331a302aa`
  - `https://mobbin.com/screens/64097e75-573e-4f84-beb1-06dad650bdab`
- Figma:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile fuel stop route planner gas station search results itinerary map sheet`.
  - No reusable matching route/fuel components, variables, or styles were
    returned.
- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/lib/routeBuilder/discoveryProviders.ts`

## Implementation Notes

- Extended `mobile/lib/routeBuilder/discoveryProviders.ts` with
  `searchRouteBuilderProviderAtPoints`.
- The helper owns:
  - point fan-out
  - per-provider empty fallback behavior
  - optional dedupe after flattening provider batches
- Updated the gas branch of `runDiscovery` so leg and area searches use the
  helper for:
  - NREL gas
  - OSM fuel
  - Mapbox fuel
  - Nominatim fuel fallback
- Kept screen-owned behavior unchanged:
  - provider merge order
  - offline fuel/propane merge
  - route projection
  - result sorting
  - selected place sheets
  - add-place callbacks
  - route calculations

## Files Changed

- `mobile/app/(tabs)/route-builder.tsx`: 6069 lines after extraction.
- `mobile/lib/routeBuilder/discoveryProviders.ts`: 58 lines.
- `docs/design-decisions/route-builder-discovery-gas-provider-boundary.md`
- `docs/live-upgrade-checkpoint-29-route-builder-discovery-gas-provider-boundary-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `docs/live-upgrade-refresh-handoff.md`

## Figma Evidence

- File: `yP342OKFtUQ1J0RCwnzH6s`
- Frame: `39:2`, `Checkpoint 29 - Route Builder Discovery Gas Provider Boundary`
- Screenshot:
  `/tmp/trailhead-checkpoint-29-route-builder-discovery-gas-provider-boundary-figma.png`

## Playwright Evidence

- Local Expo web route: `http://127.0.0.1:8100/route-builder`
- Verified the Route Builder hub renders after the gas-provider boundary
  extraction with no current browser console errors.
- Screenshot:
  `/tmp/trailhead-route-builder-checkpoint-29-discovery-gas-provider-boundary-web.png`

## Validation

- `npx tsc --noEmit` passed.
- `npm run audit:copy` passed.
- `npm run audit:routes` passed 12 cases.
- `node scripts/user-facing-copy-audit.mjs "app/(tabs)/route-builder.tsx" lib/routeBuilder/discoveryProviders.ts`
  passed.
- `git diff --check` passed.

## Release

- Code commit: `23b8404` (`Extract route discovery gas providers`), pushed
  to `master`.
- Production OTA update group:
  `ddb09fbc-ef3b-44b7-a05a-92784a3808ff`
- Preview OTA update group:
  `5d2bffc5-4ff5-4ec4-83d8-fdb164c20950`
- Runtime: `native-20260614-sdk54-1`.
