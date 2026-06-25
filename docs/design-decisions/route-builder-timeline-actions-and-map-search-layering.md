# Design Decision: Route Builder Timeline Actions and Map Search Layering

**Date:** 2026-06-25
**Checkpoint:** 15 - Route Builder Timeline Actions and Map Search Layering

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still owns the active timeline action
  strip and insert guidance, even after the workspace summary/readiness card
  extraction.
- The route-builder action strip is presentational, but it is mixed into the
  screen beside route orchestration and search state.
- Map search, drawer controls, status banners, cached-route notices, and route
  warnings compete for the same top lanes on the map.
- Android draw order is inconsistent because several overlays use `zIndex`
  without matching `elevation`, while some controls use elevation without a
  clear layer policy.
- The inline map search can open while the map drawer button remains eligible,
  leaving two controls in the same top-left lane.
- Planner toasts and the planner composer also rely on partial layer rules,
  which can allow transient banners to appear through the input area on Android.
- Route search should keep using Mapbox when available, but it still needs a
  dependable fallback place lookup when provider search is empty or unavailable.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/app/(tabs)/map.tsx`
  - `mobile/app/(tabs)/plan.tsx`
  - `mobile/components/RouteSearchModal.tsx`
  - `mobile/components/routeBuilder/RouteBuilderWorkspaceSummary.tsx`
  - `mobile/components/routeBuilder/RouteBuilderReadinessCard.tsx`
- Mobbin route/search references:
  - komoot map search and plan-new controls:
    `https://mobbin.com/screens/66021d4c-5727-4335-83a1-24b8db5d4739`
  - Pangea map search/tool controls:
    `https://mobbin.com/screens/458cf9f7-3942-4b09-8cf4-38ddb9a2d3a7`
  - Wanderlog itinerary map and selected-place sheet:
    `https://mobbin.com/screens/968f348e-7233-4b8b-afb9-0cfd63ce7612`
  - Citymapper route map and route action card:
    `https://mobbin.com/screens/c99b61db-c773-4403-befa-ef1a0fa2cef6`
  - Transit route decision sheet:
    `https://mobbin.com/screens/84d6aa6d-985d-437e-82fb-05ffed61557a`
  - Pangea itinerary timeline:
    `https://mobbin.com/screens/be9c7323-d039-4171-8e8e-312b9f3216d5`
  - Transit route detail:
    `https://mobbin.com/screens/4fd0d3aa-24b4-4303-9e85-73b1e9c78b3e`
  - Pangea wishlist itinerary:
    `https://mobbin.com/screens/1417b5e5-fd19-49db-abca-eaf283124ee5`
  - Transit route-planning map result:
    `https://mobbin.com/screens/f8ac1e75-749d-4bbc-877a-e01c897bc334`
  - komoot route-planning map result:
    `https://mobbin.com/screens/a12c00f8-58cf-4f65-96ce-32c5268f6210`
  - AllTrails route/map result:
    `https://mobbin.com/screens/fbb9b733-a59c-4c53-9447-4122f82bfe61`
  - Mercedes-Benz planning-a-route flow:
    `https://mobbin.com/flows/5e1bb19e-5b7e-41da-a880-2708fbc5ab90`
  - My BMW trip-planner flow:
    `https://mobbin.com/flows/9e2ba404-89b4-4204-95d1-29e0848469d5`
  - Pangea Charging route-preview flow:
    `https://mobbin.com/flows/5fae63ac-af62-48c9-8832-0d2444847892`
- User-provided Figma files:
  - Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`, page `0:1`, confirmed
    accessible with Wanderlog/Waze references and prior Trailhead checkpoint
    frames.
  - Untitled UI styles `a07B9pTYDR4VXVPNkI7RnW`, node `2195:443662`,
    confirmed accessible as a documentation/welcome frame.
  - Nucleus UI Lite `O8XRegvq3i6WljYoJ3M72g`, nodes `770:5839` and
    `2801:24068`, confirmed accessible; the inspected nodes are cover,
    upsell, and accordion documentation rather than route/search components.
  - Design-system search on the inspected Figma files did not expose reusable
    route/search/bottom-sheet components, so this slice maps patterns into
    Trailhead components and tokens.

## Mobbin References

- komoot keeps a single top search band and leaves map utility buttons in a
  separate side stack.
- Pangea separates trip filters from the floating action button and keeps the
  selected-place sheet below map content.
- Wanderlog treats selected places as a bottom sheet and keeps fit/map actions
  detached from search.
- Citymapper keeps route progress cards below the map route, away from top
  tools.
- Transit uses compact route decision sheets and leaves map controls outside
  the route card.
- Pangea itinerary screens keep timeline actions compact and scannable without
  instructional copy.

## Template References

- Existing Trailhead tokens, `TrailheadSheet`, and Ionicons remain the
  production implementation base.
- Untitled UI/Nucleus are used for card spacing and hierarchy cues only in this
  checkpoint because no directly reusable route/search component was exposed by
  the accessible nodes.
- The Figma Mobbin board remains the canonical checkpoint board. Checkpoint 15
  was added as frame `19:2` on page `0:1`.

## Patterns Extracted

- Search owns the top lane while active.
- Map tools own a side lane and should not sit over search inputs.
- Route/status banners need a reserved top lane that accounts for the drawer
  button when it is visible.
- Android overlays need paired `zIndex` and `elevation` for reliable ordering.
- Timeline utility actions should be a compact component separate from route
  math.
- Insert state should be a concise notice component above search, not inline
  screen JSX.
- Search should combine Trailhead results, Mapbox results, and fallback place
  lookup through one result ranking path.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderHub
  RouteBuilderWorkspaceSummary
  RouteBuilderTimelineActions
  RouteBuilderTimeline
  RouteBuilderInsertNotice
  RouteBuilderReadinessCard
  RouteBuilderFooterDock

MapScreen
  MapCanvas
  MapDrawerButton
  MapStatusLane
  InlineMapSearchLane
  SearchResultRail
  RouteSearchModal
  MapToolStack

PlannerScreen
  PlannerMessages
  PlannerComposer
  PlannerToastLayer
```

## Why The Redesign Is Better

- It removes more presentational JSX from `route-builder.tsx` without changing
  saved route data, trip math, offline readiness, or Mapbox route behavior.
- It gives map search and map tools explicit lanes, which reduces accidental
  overlap and makes Android draw order predictable.
- It keeps planner feedback above the background but below the composer.
- It makes route search more reliable by falling back to the existing place
  lookup when Mapbox search returns no usable results.
- It follows the researched hierarchy while producing original Trailhead UI.

## Checkpoint 15 Implementation Scope

- Extract `RouteBuilderTimelineActions`.
- Extract `RouteBuilderInsertNotice`.
- Add a map search/tool layer policy with Android-safe elevation.
- Hide or shift top map chrome while inline search owns the search lane.
- Move status banners away from the drawer button when both are present.
- Add Android keyboard/result padding to the route search modal.
- Add place lookup fallback to the route search modal when Mapbox search is
  empty or unavailable.
- Add planner composer/toast layer values.
- Run TypeScript, copy, route, and diff audits before committing.

## Future Improvements

- Extract route timeline day rows and stop rows after callback props are mapped.
- Move map overlay layer constants into a shared map chrome helper if another
  map screen adopts the same lane policy.
- Audit RouteSearchModal category chips against current usage and remove any
  categories that are not useful in real trips.
- Build a dedicated search service interface for Route Builder, Planner,
  Copilot, and Map once this UI-layer checkpoint is stable.
