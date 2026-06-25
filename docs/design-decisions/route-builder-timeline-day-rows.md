# Design Decision: Route Builder Timeline Day Rows

**Date:** 2026-06-25
**Checkpoint:** 18 - Route Builder Timeline Day Rows

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still owns route day timeline cards
  inline.
- The day-card block mixes presentational layout with active-day selection,
  camp discovery actions, place scans, status calculation, and inline result
  placement.
- Day rows are large, visually important itinerary anchors, but their layout is
  difficult to audit while it lives beside route math, camp scoring, discovery,
  and save/open-on-map behavior.
- The screen still has stale route-day styles from earlier iterations.
- Action labels, status pills, and travel/empty camp states should have stable
  dimensions so timeline scanning does not shift as data changes.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderActiveDayStop.tsx`
  - `mobile/components/routeBuilder/RouteBuilderLegActions.tsx`
  - `mobile/components/routeBuilder/RouteBuilderFooterDock.tsx`
- Mobbin itinerary and route timeline references:
  - Tripsy itinerary:
    `https://mobbin.com/screens/2f8733ed-e350-42fb-860d-19ba73863526`
  - Wanderlog itinerary:
    `https://mobbin.com/screens/0fc9803a-fc66-4844-87f7-69ab873b748e`
    `https://mobbin.com/screens/767217bc-b0c5-48a7-a959-abd598bb8ced`
  - BlaBlaCar stop list:
    `https://mobbin.com/screens/1903ead2-ab32-44fc-abed-3e1f6b6e79d0`
    `https://mobbin.com/screens/35b3e73d-4ca8-467e-af9d-f586e01f1d0d`
  - Transit route timeline/status screens:
    `https://mobbin.com/screens/56fe42c4-2c39-4007-bc21-0418082478f3`
    `https://mobbin.com/screens/87476cc5-50b2-4e95-a9c7-db765c5d9b25`
  - Pangea trip planning cards:
    `https://mobbin.com/screens/be9c7323-d039-4171-8e8e-312b9f3216d5`
    `https://mobbin.com/screens/4e015b05-c82e-49bd-bcb6-afaaa90c7afd`
- Figma design-system search:
  - Searched the Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s` for itinerary day
    card, route timeline, status badge, and action rail components.
  - Scoped searches across Material 3, Simple Design System, and iOS libraries
    did not return an exact reusable day-card component.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches did not
    surface a stronger production-specific pattern than the Mobbin route and
    itinerary references for this narrow component extraction.

## Mobbin References

- Itinerary screens keep day title, route metadata, and status near the top of
  each row.
- Route/timeline screens use a left rail or visible sequence marker to support
  quick scanning.
- Action rows stay short and familiar: camp, fuel, places, and side trips map
  naturally to icon-plus-label controls.
- Missing choices are presented as direct actions instead of explanatory copy.

## Template References

- Existing Trailhead tokens, Ionicons, `mono`, and route card surfaces remain
  the implementation base.
- No third-party screen is copied; references only inform hierarchy, spacing,
  status placement, and action grouping.
- The Figma checkpoint board remains the design audit record.

## Patterns Extracted

- Day-card rendering should be a reusable presentational component.
- Status calculation remains in the screen because it depends on route state,
  day drive limits, rest days, and camp completion.
- Camp preview rendering remains a slot because the existing camp preview
  function is shared with active-day stop rows.
- Empty overnight and shared-travel states can live inside the component because
  they are visual states with callback props.
- Inline discovery results stay outside the card so the screen continues to own
  query state and result rendering.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderHub
  RouteBuilderWorkspaceSummary
  RouteBuilderTimelineActions
  RouteBuilderTimeline
    RouteBuilderTimelineDayCard
      CampPreviewSlot
      DayActionRail
    InlineDiscoveryResults
  RouteBuilderInsertNotice
  RouteBuilderActiveDayStop
    StopPreviewSlot
    RouteBuilderLegActions
  RouteBuilderReadinessCard
  RouteBuilderFooterDock
```

## Why The Redesign Is Better

- It removes another large presentational block from `route-builder.tsx`.
- It keeps route behavior unchanged while making the day-card UI auditable in
  isolation.
- It gives status, action buttons, empty camp, and shared-travel states typed
  props.
- It removes stale route-day styles that were no longer used by the current
  screen.

## Future Improvements

- Extract the inline discovery results after the timeline card props stabilize.
- Tune day-card density against native iPhone and Android screenshots.
- Consider a compact timeline variant for routes with many days.
