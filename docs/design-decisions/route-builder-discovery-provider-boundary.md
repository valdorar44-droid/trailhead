# Design Decision: Route Builder Discovery Provider Boundary

**Date:** 2026-06-25
**Checkpoint:** 28 - Route Builder Discovery Provider Boundary

## Current Problems

- `runDiscovery` still repeats provider fallback fan-out in the POI branch.
- The same route-discovery fallback queries are declared four times for Mapbox
  and Nominatim across leg and area searches.
- Provider fallback behavior is currently correct but harder to audit because
  query selection, point fan-out, provider calls, and result flattening are
  inline with result ranking and sheet behavior.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/useRouteBuilderDiscoveryState.ts`
- Mobbin flows:
  - Wanderlog adding a place:
    `https://mobbin.com/flows/23c441df-12a9-46ab-a60e-19b43fcc65dd`
  - Wanderlog adding a restaurant:
    `https://mobbin.com/flows/028f1d70-1d11-45fe-9e3b-8177ab4d5046`
  - Tripadvisor adding places:
    `https://mobbin.com/flows/cdf38bab-ce89-4a69-ba09-e5b5cda28666`
- Figma design-system search:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile map bottom sheet search fallback place add itinerary provider route discovery results`.
  - No reusable matching route/search components, variables, or styles were
    returned.

## Mobbin References

- Add-place flows preserve the visible result list while provider/source
  fallback happens invisibly.
- Route and map planning flows benefit from stable categories even when the
  backing provider changes.
- Provider boundaries should not change card order, detail-sheet behavior, or
  user-facing labels.

## Patterns Extracted

- Keep provider fallback fan-out behind a named helper.
- Keep query categories stable across Mapbox and backup provider calls.
- Preserve result ranking, route projection, and sheet open/add callbacks in
  the Route Builder screen for this checkpoint.

## New Component Tree

```txt
RouteBuilderScreen
  useRouteBuilderDiscoveryState
  searchRouteBuilderFallbackPois
  RouteBuilderInlineResults
```

## Why The Redesign Is Better

- It removes duplicated provider fallback blocks from the largest screen while
  preserving behavior.
- It gives the next checkpoint a clear place to expand provider orchestration
  without touching UI rendering.
- It makes Mapbox/backup provider search easier to test and audit.

## Future Improvements

- Move gas and camp provider fan-out into the same provider-boundary module.
- Add short-lived result cache metadata for immediate map exits and returns to
  the same route-search context.
- Share the provider helper with Planner and Copilot route search after the
  route-builder path is stable.
