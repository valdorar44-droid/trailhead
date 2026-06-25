# Design Decision: Route Builder Discovery State Boundary

**Date:** 2026-06-25
**Checkpoint:** 27 - Route Builder Discovery State Boundary

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still owns discovery UI state,
  active-key lookup, inline search state, result merging, and scan provider
  logic in one large screen file.
- Discovery results are correctly keyed by itinerary segment, but the state
  boundary is buried next to provider calls and render helpers.
- Future search/sheet improvements need a stable state API before moving
  provider-specific route discovery code.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderInlineResults.tsx`
- Mobbin screens:
  - Wanderlog route/search screen:
    `https://mobbin.com/screens/968f348e-7233-4b8b-afb9-0cfd63ce7612`
  - Wanderlog place save/search screen:
    `https://mobbin.com/screens/097b5b68-eb6b-4083-8a26-4d0f98689e14`
  - Trip.com itinerary map/search screen:
    `https://mobbin.com/screens/85fcd62d-9867-43fa-9cde-827be0a9faaf`
  - Wanderlog itinerary map/detail screen:
    `https://mobbin.com/screens/767217bc-b0c5-48a7-a959-abd598bb8ced`
- Mobbin flows:
  - Wanderlog adding a place:
    `https://mobbin.com/flows/23c441df-12a9-46ab-a60e-19b43fcc65dd`
  - Trip.com creating an itinerary:
    `https://mobbin.com/flows/b95095e8-89c9-41d5-8f81-d156c9f19f26`
  - Wanderlog saving a location to a list:
    `https://mobbin.com/flows/609c277f-7cba-45a8-83c3-9e26d0a921bc`
- Figma design-system search:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile route planner search result state itinerary segment bottom sheet travel place list`.
  - No reusable matching route/search components, variables, or styles were
    returned.

## Mobbin References

- Travel planning screens keep search context attached to the active itinerary
  segment.
- Place-add flows preserve result state while the user opens detail and returns
  to the list.
- Compact result rows work best when the state layer is stable and the render
  layer only receives already-selected result sets.

## Patterns Extracted

- Keep discovery state keyed by route leg/day context.
- Keep the active inline search independent from provider loading state so it
  can survive result refreshes and detail-sheet opens.
- Keep provider calls in the screen for this checkpoint; move only the state
  boundary so behavior stays unchanged.

## New Component Tree

```txt
RouteBuilderScreen
  useRouteBuilderDiscoveryState
  RouteBuilderInlineResults
```

## Why The Redesign Is Better

- It creates a named state boundary without changing provider behavior,
  ranking, fallback searches, map focus, or result rendering.
- It makes later extraction of Mapbox/search provider orchestration safer
  because the state API is already centralized.
- It reduces repeated screen-local result merging and active-key lookup code.

## Future Improvements

- Move provider-specific scan logic into a route discovery service once the
  state boundary is proven stable.
- Add query/result cache timing for quick map exits and immediate returns to
  the same search context.
- Reuse the hook from planner/copilot route search once those screens share the
  route discovery interface.
