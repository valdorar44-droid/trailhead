# Design Decision: Route Builder Stop Rows

**Date:** 2026-06-25
**Checkpoint:** 16 - Route Builder Stop Rows

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still owns active-day stop cards,
  stop action icons, and leg action cards inline.
- Stop rows mix presentational layout with route callbacks such as insert,
  move, remove, camp detail, camp replacement, and leg scanning.
- The active-day itinerary is visually important, but its rendering is hard to
  audit because it lives beside route calculation, camp scoring, discovery, and
  save/open-on-map logic.
- Leg action buttons are compact but screen-local, which makes it harder to
  reuse the same route segment pattern when the footer dock and route timeline
  are extracted later.
- The current screen has duplicate stop-row style names that are easy to confuse
  during future Route Builder work.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderHub.tsx`
  - `mobile/components/routeBuilder/RouteBuilderWorkspaceSummary.tsx`
  - `mobile/components/routeBuilder/RouteBuilderReadinessCard.tsx`
  - `mobile/components/routeBuilder/RouteBuilderTimelineActions.tsx`
  - `mobile/components/routeBuilder/RouteBuilderInsertNotice.tsx`
- Mobbin itinerary and route-row references:
  - Viator itinerary/timeline list:
    `https://mobbin.com/screens/7d351a4c-1707-494f-a580-80fdf1a881d8`
  - BlaBlaCar trip stop list:
    `https://mobbin.com/screens/1903ead2-ab32-44fc-abed-3e1f6b6e79d0`
  - BlaBlaCar route detail:
    `https://mobbin.com/screens/4b45e1ac-676e-4b91-b47b-8332402d0c4b`
  - Airbnb trip itinerary row:
    `https://mobbin.com/screens/7f73e378-793a-4583-8fbd-eef9e719ea8a`
  - Wanderlog itinerary:
    `https://mobbin.com/screens/9722f766-60c3-4fcd-a7c2-7dfd4ff28513`
  - Apple Maps route detail:
    `https://mobbin.com/screens/1347bc42-8168-4c3b-bc3b-5ae431e47877`
  - Citymapper route detail:
    `https://mobbin.com/screens/a9a7c3aa-1aa1-4081-86c1-cd1eb35b7a11`
  - My BMW editing-a-route flow:
    `https://mobbin.com/flows/321f9e71-4970-4dbc-a03c-1e2f5e56c677`
  - Google Maps adding-a-stop flow:
    `https://mobbin.com/flows/567ab5c5-b0c8-4b8d-bb3b-124a878d6cbe`
  - Wanderlog itinerary flow:
    `https://mobbin.com/flows/88a3eab3-6cca-496f-a3cb-bca2011df206`
- User-provided Figma files:
  - Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`, page `0:1`, confirmed
    accessible with Checkpoint 15 as frame `19:2`.
  - Design-system search for itinerary, stop row, route leg, and timeline card
    did not expose reusable components, variables, or styles.

## Mobbin References

- Itinerary screens keep the stop title and the segment/action controls visually
  separate.
- Route detail screens show time/distance between stops as a lightweight segment
  row rather than another full stop card.
- Editing flows keep reorder/add actions close to the stop row but secondary to
  the destination name.
- Trip planning flows use concise action labels for fuel, overnight, and places,
  avoiding instructional copy inside each row.

## Template References

- Existing Trailhead colors, `mono`, Ionicons, and card radii remain the
  production implementation base.
- The Figma checkpoint board remains the audit board; Checkpoint 16 should be
  added to the right of frame `19:2` after implementation validation.
- Untitled UI and Nucleus assets are not directly mapped in this checkpoint
  because no reusable itinerary row component was exposed by design-system
  search.

## Patterns Extracted

- Stop cards should present the numbered stop, destination name, stop type, and
  source in one compact row.
- Stop actions should be icon-only buttons with familiar symbols and stable
  dimensions.
- Leg cards should sit between stops, summarize distance/time/fuel, and expose
  compact action buttons for fuel, camp, and places.
- The screen should pass route callbacks into presentational components rather
  than letting the components calculate route state.
- Route math, discovery queries, stop ordering, and saved route behavior should
  remain unchanged.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderHub
  RouteBuilderWorkspaceSummary
  RouteBuilderTimelineActions
  RouteBuilderTimeline
  RouteBuilderInsertNotice
  RouteBuilderActiveDayStop
    StopPreviewSlot
    RouteBuilderLegActions
  RouteBuilderReadinessCard
  RouteBuilderFooterDock
```

## Why The Redesign Is Better

- It removes another presentational block from `route-builder.tsx` while leaving
  route behavior in the screen where the current state and callbacks live.
- It makes the active itinerary easier to test because stop rows and segment
  actions have typed props and local styles.
- It keeps action hit areas stable across mobile widths.
- It sets up a later route timeline extraction without moving camp scoring,
  discovery, or save/open-on-map behavior prematurely.

## Checkpoint 16 Implementation Scope

- Add `RouteBuilderActiveDayStop` for each active day stop row.
- Add `RouteBuilderLegActions` for the between-stop distance/time/fuel/action
  segment.
- Keep `renderStopPreview`, `scanBetweenStops`, `moveStop`, `removeStop`,
  `replaceCampStop`, and `openCampDetail` in the screen and pass them as
  callbacks/render slots.
- Remove only the screen-local styles replaced by the new components.
- Run TypeScript, copy, route, diff, Figma, and Playwright checks before any
  release decision.

## Future Improvements

- Extract the active-day control row after stop-row behavior is stable.
- Extract route timeline day rows separately from active-day stop rows.
- Extract the footer dock after save/open-on-map state is mapped into typed
  props.
- Revisit whether the wizard search field and full Route Builder search should
  share a route-search service.
