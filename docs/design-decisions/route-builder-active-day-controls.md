# Design Decision: Route Builder Active Day Controls

**Date:** 2026-06-25
**Checkpoint:** 23 - Route Builder Active Day Controls

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still renders the active-day itinerary
  header, rest-day toggle, max-hours input, and empty-day guidance inline.
- The screen owns both day-control markup and route-stop rendering, which makes
  later route-day and Mapbox search work harder to isolate.
- The empty-day guidance is useful, but it should live with the active-day
  control surface instead of the large screen.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderSearchSurface.tsx`
  - `mobile/components/routeBuilder/RouteBuilderActiveDayStop.tsx`
- Mobbin screens:
  - Wanderlog itinerary day editor:
    `https://mobbin.com/screens/1c192050-3980-4c8b-b4c7-fcad6d5a2ed0`
  - Wanderlog day reorder editor:
    `https://mobbin.com/screens/1a878c89-0de4-4b2c-a99b-1520b65e2da4`
- Mobbin flows:
  - Wanderlog itinerary flow:
    `https://mobbin.com/flows/88a3eab3-6cca-496f-a3cb-bca2011df206`
  - Pangea accommodation edit flow:
    `https://mobbin.com/flows/1e4d7c7f-4909-4106-9b92-4f8b7cef117a`
- Figma design-system search:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile itinerary day editor rest day toggle schedule controls compact input empty day state`.
  - No matching reusable design-system component was returned.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches were
    broad and did not change the implementation plan.

## Mobbin References

- Itinerary day editors keep the day title, travel summary, and day actions
  close together.
- Day editing controls use compact rows and defer secondary actions to menus.
- Empty-day prompts stay short and action-oriented.

## Patterns Extracted

- The active-day control surface should own the day label, day meta, rest toggle,
  max-hours input, and compact empty state.
- Route math and state updates should remain screen-owned.
- The component should be reusable without knowing route geometry or stop data.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderActiveDayControls
  RouteBuilderEmptyDayGuidance
  RouteBuilderActiveDayStop[]
```

## Why The Redesign Is Better

- It removes another focused control surface from the large Route Builder
  screen.
- It keeps day-level controls and empty-day guidance grouped.
- It preserves stop ordering, day mileage, rest-day state, route computation,
  and footer behavior.

## Future Improvements

- Add richer day-level route warnings once route-day validation is centralized.
- Move active-day stop-list assembly into a dedicated list component after the
  control surface is stable.
- Reuse the active-day controls in saved route editing if that flow adopts the
  same Route Builder workspace.
