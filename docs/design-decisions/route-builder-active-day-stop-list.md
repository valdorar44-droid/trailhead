# Design Decision: Route Builder Active Day Stop List

**Date:** 2026-06-25
**Checkpoint:** 24 - Route Builder Active Day Stop List

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still assembles the active-day stop
  list inline after the active-day controls.
- The inline block mixes stop rows, insert-after state, camp detail/swap
  actions, move/remove callbacks, leg distance math, and leg discovery actions.
- `RouteBuilderActiveDayStop` and `RouteBuilderLegActions` are already
  reusable, but the screen still owns the list composition between them.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderActiveDayStop.tsx`
  - `mobile/components/routeBuilder/RouteBuilderLegActions.tsx`
- Mobbin screens:
  - Wanderlog ordered itinerary day:
    `https://mobbin.com/screens/9722f766-60c3-4fcd-a7c2-7dfd4ff28513`
  - Wanderlog day stop list:
    `https://mobbin.com/screens/39f48c99-a1ad-424a-b137-957cc0bc9f33`
  - Wanderlog autofilled itinerary list:
    `https://mobbin.com/screens/97bf2bc3-e5fc-4b30-ab03-29b6245ffe1c`
- Mobbin flows:
  - Wanderlog itinerary:
    `https://mobbin.com/flows/88a3eab3-6cca-496f-a3cb-bca2011df206`
  - Wanderlog reordering days:
    `https://mobbin.com/flows/7fee33b5-751b-425f-9848-208f6abe56ed`
- Figma design-system search:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile itinerary stop list route leg actions ordered stops day editor component`.
  - No matching reusable stop-list component, variables, or styles were
    returned.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches were
    broad and did not change the implementation plan.

## Mobbin References

- Ordered itinerary lists keep the stop marker, stop content, preview media,
  and route leg timing visually close.
- Leg details sit between the two stops they describe.
- Reorder and edit affordances should remain compact so the day list stays
  scannable.

## Patterns Extracted

- The stop-list component should own composition of stop row plus following leg
  actions.
- Route-specific helpers should stay injected from the screen so route math and
  discovery behavior do not move.
- The selected insert-after marker should remain attached to stop metadata.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderActiveDayControls
  RouteBuilderEmptyDayGuidance
  RouteBuilderActiveDayStopList
    RouteBuilderActiveDayStop
    RouteBuilderLegActions
```

## Why The Redesign Is Better

- It removes another behavior-heavy render block from the large Route Builder
  screen.
- It keeps stop row and leg action composition reusable without moving route
  state ownership.
- It preserves all existing stop mutation, insert, camp detail, and discovery
  callbacks.

## Future Improvements

- Add a dedicated drag/reorder mode if route editing moves beyond up/down
  buttons.
- Move stop preview rendering once camp/place/fuel preview cards share a stable
  adapter.
- Reuse the component in saved-route editing if that flow adopts the active-day
  workspace.
