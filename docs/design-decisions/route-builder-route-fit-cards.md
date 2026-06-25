# Design Decision: Route Builder Route Fit Cards

**Date:** 2026-06-25
**Checkpoint:** 20 - Route Builder Route Fit Cards

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still assembles route-readiness checks
  inline, mixing schedule, fuel, offline, and route-stop conditions into the
  screen body.
- `RouteBuilderReadinessCard` is extracted, but its rows do not have a
  route-builder domain helper that Planner/Copilot handoffs can reuse later.
- The screen must keep route computation, offline readiness, saved geometry,
  Mapbox handoff, and current user-facing copy behavior unchanged.
- The status rows should remain compact and close to the route controls instead
  of becoming a separate dashboard.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderReadinessCard.tsx`
  - `mobile/lib/routeBuilder/readiness.ts`
  - `mobile/lib/offlineReadiness.ts`
- Mobbin travel/planner references:
  - Turo trip-status reference:
    `https://mobbin.com/screens/f496facd-5f9c-400b-ad8a-87bfb0659fa7`
  - Wanderlog trip/itinerary reference:
    `https://mobbin.com/screens/0446e033-81a1-4329-95a2-628bc25dc081`
  - Wanderlog save-to-list flow:
    `https://mobbin.com/flows/609c277f-7cba-45a8-83c3-9e26d0a921bc`
  - Google Maps saved-trips flow:
    `https://mobbin.com/flows/ae67a9e6-0fb9-4528-8b23-2b3730126bab`
- Figma design-system search:
  - Searched the user-provided Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s` for
    route readiness checklist card, status pill, offline download, and trip
    planner patterns.
  - Searched the Nucleus UI Lite file `O8XRegvq3i6WljYoJ3M72g` for status
    checklist, badge, and mobile list-card patterns.
  - No exact reusable component or variable set was returned for this route-fit
    surface, so the implementation stays on Trailhead tokens and Ionicons.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble were checked for
    mobile travel planner / itinerary / checklist patterns. The results were
    broad and did not provide a stronger production pattern than the Mobbin and
    current Trailhead references for this narrow extraction.

## Mobbin References

- Trip-status surfaces keep the decisive status near the main action instead of
  burying it in settings.
- Travel itinerary surfaces rely on short rows with a leading icon, concise
  status text, and one visible state badge.
- Saved-trip flows keep save/readiness states compact and reusable across list
  and detail views.

## Template References

- Trailhead keeps the existing `RouteBuilderReadinessCard`, local theme tokens,
  and Ionicons.
- No external screen or component is copied. References inform hierarchy,
  density, row state, and placement only.

## Patterns Extracted

- Route-fit card assembly should be a pure route-builder helper.
- The visual card should render typed route-fit rows through a small row
  component.
- Fuel, schedule, route, and offline readiness should stay independent of the
  component's rendering details.
- Screen code should provide already formatted summary strings while the helper
  decides which cards appear and in what order.

## New Component Tree

```txt
RouteBuilderScreen
  buildRouteFitCards
  RouteBuilderReadinessCard
    RouteBuilderRouteFitRow
    OfflineReadinessPill
```

## Why The Redesign Is Better

- It removes another route-builder business-logic block from the screen without
  changing behavior.
- It gives Planner/Copilot route handoff work a typed helper for route-fit
  status rows.
- It keeps the active route controls dense, original, and consistent with the
  current Trailhead interface.
- It makes the readiness card easier to validate with unit-like route-builder
  helper inputs in a later checkpoint.

## Future Improvements

- Add focused helper tests once the route-builder logic is split further from
  the large screen file.
- Reuse the route-fit helper in Planner/Copilot route previews after those
  surfaces accept route-builder session inputs.
- Consider a one-tap "prepare downloads" action once offline pack orchestration
  is fully unified.
