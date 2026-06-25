# Design Decision: Route Builder Discovery Gas Provider Boundary

**Date:** 2026-06-25
**Checkpoint:** 29 - Route Builder Discovery Gas Provider Boundary

## Current Problems

- The gas branch in `runDiscovery` repeats point fan-out and empty-result
  provider failure handling for NREL, OSM fuel, Mapbox fuel, and Nominatim
  backup search.
- The branch is behaviorally correct but mixes provider orchestration with
  offline fuel merge, dedupe, route projection, sorting, and sheet behavior.
- Route Builder needs a stable provider boundary before sharing route-search
  logic with Planner and Copilot.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/lib/routeBuilder/discoveryProviders.ts`
- Mobbin screens:
  - Google Maps route fuel/search result:
    `https://mobbin.com/screens/4d6823cd-f9a1-4d26-b015-85404063bde4`
  - Upside gas station list/detail reference:
    `https://mobbin.com/screens/d8884341-371c-4fa1-88bb-da9331a302aa`
  - Apple Maps gas/search result reference:
    `https://mobbin.com/screens/64097e75-573e-4f84-beb1-06dad650bdab`
- Figma design-system search:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile fuel stop route planner gas station search results itinerary map sheet`.
  - No reusable matching route/fuel components, variables, or styles were
    returned.

## Mobbin References

- Fuel result flows prioritize reliability and proximity while provider/source
  details stay secondary.
- Search result sheets should keep the same add/select behavior regardless of
  which provider returned the stop.
- Provider fallbacks should not change visible labels or result row layout.

## Patterns Extracted

- Keep gas provider fan-out behind a named helper.
- Keep per-point provider failures isolated so one source failure does not hide
  other source results.
- Preserve merge order and dedupe in the screen for this checkpoint.

## New Component Tree

```txt
RouteBuilderScreen
  useRouteBuilderDiscoveryState
  searchRouteBuilderProviderAtPoints
  searchRouteBuilderFallbackPois
  RouteBuilderInlineResults
```

## Why The Redesign Is Better

- It removes repeated point fan-out plumbing from the gas branch.
- It keeps provider orchestration reusable without changing ranking, route
  projection, selected place sheets, or add-place behavior.
- It prepares the route-builder provider layer for later Planner/Copilot route
  search reuse.

## Future Improvements

- Move camp provider fan-out into the same provider-boundary module.
- Add short-lived cache metadata for fast map exits and immediate returns.
- Add focused unit coverage for provider fan-out helpers after the route
  discovery service boundary is complete.
