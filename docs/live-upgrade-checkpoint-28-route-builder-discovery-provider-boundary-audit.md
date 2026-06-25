# Live Upgrade Checkpoint 28 Audit: Route Builder Discovery Provider Boundary

**Date:** 2026-06-25
**Commit target:** Route Builder route-discovery fallback provider boundary.

## Scope Planned

- Add
  `docs/design-decisions/route-builder-discovery-provider-boundary.md` before
  implementation.
- Review `runDiscovery`, `resolveLegSearchContext`, and provider fallback
  branches after Checkpoint 27 isolated discovery state.
- Use Mobbin add-place/map search references and Figma design-system search as
  research inputs.
- Extract the duplicated POI fallback provider fan-out into a reusable helper.
- Keep Mapbox, Nominatim, offline fallback, camp ranking, route projection,
  result sorting, selected place sheets, add-place behavior, and route
  calculations unchanged.

## Research Reviewed

- Mobbin:
  - `https://mobbin.com/flows/23c441df-12a9-46ab-a60e-19b43fcc65dd`
  - `https://mobbin.com/flows/028f1d70-1d11-45fe-9e3b-8177ab4d5046`
  - `https://mobbin.com/flows/cdf38bab-ce89-4a69-ba09-e5b5cda28666`
- Figma:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile map bottom sheet search fallback place add itinerary provider route discovery results`.
  - No reusable matching route/search components, variables, or styles were
    returned.
- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/useRouteBuilderDiscoveryState.ts`

## Implementation Notes

- Added `mobile/lib/routeBuilder/discoveryProviders.ts`.
- Introduced a stable POI fallback query set:
  - trailhead
  - viewpoint
  - water
  - grocery
- Added `searchRouteBuilderFallbackPois` to fan out fallback provider calls
  across route sample points or an area target.
- Preserved per-query provider failure isolation by keeping each fallback
  provider call wrapped with an empty-result fallback.
- Updated the POI branch of `runDiscovery` so Mapbox and Nominatim fallback
  calls use the helper for both leg and area searches.
- Kept screen-owned behavior unchanged:
  - dedupe order
  - route projection
  - result ranking and sorting
  - offline fallback
  - selected place sheets
  - add-place callbacks
  - route calculations

## Files Changed

- `mobile/app/(tabs)/route-builder.tsx`: 6042 lines after extraction.
- `mobile/lib/routeBuilder/discoveryProviders.ts`: 39 lines.
- `mobile/lib/routeBuilder/index.ts`
- `docs/design-decisions/route-builder-discovery-provider-boundary.md`
- `docs/live-upgrade-checkpoint-28-route-builder-discovery-provider-boundary-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `docs/live-upgrade-refresh-handoff.md`

## Figma Evidence

- File: `yP342OKFtUQ1J0RCwnzH6s`
- Frame: `38:2`, `Checkpoint 28 - Route Builder Discovery Provider Boundary`
- Screenshot:
  `/tmp/trailhead-checkpoint-28-route-builder-discovery-provider-boundary-figma.png`

## Playwright Evidence

- Local Expo web route: `http://127.0.0.1:8100/route-builder`
- Verified the Route Builder hub renders after the provider-boundary extraction
  with no current browser console errors.
- Screenshot:
  `/tmp/trailhead-route-builder-checkpoint-28-discovery-provider-boundary-web.png`

## Validation

- `npx tsc --noEmit` passed.
- `npm run audit:copy` passed.
- `npm run audit:routes` passed 12 cases.
- `node scripts/user-facing-copy-audit.mjs "app/(tabs)/route-builder.tsx" lib/routeBuilder/discoveryProviders.ts`
  passed.
- `git diff --check` passed.

## Release

- Code commit: `606e365` (`Extract route discovery fallback providers`),
  pushed to `master`.
- Production OTA update group:
  `5c12de42-30db-4f0e-a228-61f53eaa5b1b`
- Preview OTA update group:
  `01480fc3-971c-417f-9a36-d0d576cc84a1`
- Runtime: `native-20260614-sdk54-1`.
