# Design Decision: Route Builder Search Surface Component

**Date:** 2026-06-25
**Checkpoint:** 22 - Route Builder Search Surface Component

## Current Problems

- Route Builder still renders stop-type chips, insert guidance, search input,
  and search result rows inline in `mobile/app/(tabs)/route-builder.tsx`.
- Search results are visually separated from the query field by the readiness
  card, so a result can feel detached from the action that created it.
- Checkpoint 21 created a typed search helper, but the screen still owns the
  search surface markup and styles.
- The next route-builder slices need smaller UI components so the large screen
  can stop accumulating presentation logic.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderInsertNotice.tsx`
  - `mobile/components/routeBuilder/RouteBuilderTimelineActions.tsx`
  - `mobile/components/routeBuilder/RouteBuilderInlineResults.tsx`
  - `mobile/lib/routeBuilder/searchFlow.ts`
- Mobbin screens:
  - Trip.com itinerary destination picker:
    `https://mobbin.com/screens/c97d9e5d-774c-4fc0-9b3b-79e62febb9a9`
  - Rivian road-trip add-stop timeline:
    `https://mobbin.com/screens/b9e0cc11-d7c1-4ed6-bf4f-029edf2ed948`
- Mobbin flows:
  - Wanderlog adding a place:
    `https://mobbin.com/flows/23c441df-12a9-46ab-a60e-19b43fcc65dd`
  - Google Maps adding a stop:
    `https://mobbin.com/flows/567ab5c5-b0c8-4b8d-bb3b-124a878d6cbe`
- Figma design-system search:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile route planner search field segmented chips result rows add stop destination picker`.
  - No matching reusable component, variable, or style was returned.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches were
    checked for mobile route-planner search/add-stop patterns. Search results
    were broad and did not produce a stronger pattern than Mobbin plus the
    existing Trailhead route-builder component set.

## Mobbin References

- Destination pickers keep the search field and candidates in one decision
  group.
- Route editors keep add-stop actions close to the current route timeline.
- Add-place flows use concrete action labels and avoid exposing implementation
  terms.
- Bottom-sheet option lists are useful for route actions, but this checkpoint
  should stay inline because Trailhead already has a working active-day route
  workspace.

## Template References

- Trailhead keeps the existing theme, Ionicons, stop colors, and compact search
  controls.
- No external screen is copied. References inform grouping, proximity, and
  result-row density only.

## Patterns Extracted

- Keep stop-type selection and search entry in one reusable surface.
- Keep search results directly below the query field so the search action and
  candidates read as one flow.
- Leave result generation, provider calls, and selected-place mapping in the
  screen/helper boundary created in Checkpoint 21.
- Reuse the existing `RouteBuilderInsertNotice` inside the surface rather than
  rewriting its copy or behavior.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderSearchSurface
    stop type chips
    RouteBuilderInsertNotice
    TourTarget(routeBuilder.search)
    search input
    result rows
  RouteBuilderReadinessCard
  active day itinerary
```

## Why The Redesign Is Better

- It removes another focused UI surface from the large Route Builder screen.
- It keeps search results next to the search field, which improves scan and tap
  flow without changing lookup behavior.
- It makes the next Mapbox/search bridge work easier because search UI props
  become explicit.
- It preserves the existing route computation, Android fallback, saved geometry,
  and stop-add behavior.

## Future Improvements

- Move search result row metadata to richer route-aware labels once map search,
  route corridor context, and downloaded place metadata share one interface.
- Add a dedicated active-day insertion control after the route timeline
  component is reduced further.
- Retry Figma checkpoint-frame creation after Figma MCP write auth is refreshed.
