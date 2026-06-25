# Design Decision: Route Builder Inline Discovery Results

**Date:** 2026-06-25
**Checkpoint:** 19 - Route Builder Inline Discovery Results

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still owns the inline discovery result
  shell and all camp/fuel/place/side-trip row layout inline.
- The result block mixes visual card structure with discovery state, active day,
  camp add/swap callbacks, route place open callbacks, loading state, and empty
  state selection.
- The fixed footer dock can cover lower day content on a small phone viewport,
  making the active day's lower action rail harder to reach.
- Inline result rows should be compact, scannable, and consistent with Route
  Builder's day cards without turning into a separate full-screen search flow.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderTimelineDayCard.tsx`
  - `mobile/components/routeBuilder/RouteBuilderFooterDock.tsx`
- Mobbin route/travel/search references:
  - Wanderlog nearby itinerary/search results:
    `https://mobbin.com/screens/75150e9b-b871-4758-8901-15367d84304f`
    `https://mobbin.com/screens/1a4e3acc-6645-4b75-b8d3-26fa69ee6401`
    `https://mobbin.com/screens/767217bc-b0c5-48a7-a959-abd598bb8ced`
    `https://mobbin.com/screens/39f48c99-a1ad-424a-b137-957cc0bc9f33`
  - Map/route stop suggestion references:
    `https://mobbin.com/screens/c4979fa6-e6e1-49b0-a0c2-7bcd9be61ec7`
    `https://mobbin.com/screens/17fe7533-feb6-496a-a17b-ee91a9236e2c`
    `https://mobbin.com/screens/b9e0cc11-d7c1-4ed6-bf4f-029edf2ed948`
    `https://mobbin.com/screens/c8b8ef66-639c-4a5b-9fe4-43035b5920f8`
- Figma design-system search:
  - Searched the Trailhead Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s` for
    mobile route suggestion lists, search result cards, itinerary inline result
    cards, and add-to-trip rows.
  - Scoped Material 3, Simple Design System, and iOS library searches did not
    return an exact reusable Trailhead-fit component.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches were
    checked for mobile travel planner / route planner search-result card
    patterns. Results were broad and did not provide a stronger production
    pattern than the Mobbin references for this narrow component extraction.

## Mobbin References

- Itinerary result surfaces keep the current day context visible while showing
  nearby candidates beneath it.
- Map search results use compact rows with a leading category icon, concise
  metadata, and a row-level tap target.
- Route stop suggestions avoid large explanatory text; they prioritize the
  place name, distance/relevance metadata, and the next action.
- Result lists remain near the user's current planning context rather than
  forcing a mode switch for every camp/fuel/place lookup.

## Template References

- Trailhead keeps its existing tokens, typography, Ionicons, and route-builder
  card language.
- No external layout is copied. References inform hierarchy, metadata density,
  row actions, and bottom content clearance only.

## Patterns Extracted

- Inline result shell should be a reusable presentational component with title,
  subtitle, close, loading, and child content slots.
- Camp result cards need photo/fallback support and a small add/swap action.
- Fuel/place/side-trip results can share one compact row component with icon,
  title, metadata, and optional source/status tag.
- Discovery state, result filtering, empty-state copy, callbacks, and analytics
  remain in `route-builder.tsx`.
- Footer clearance should be handled by route-builder content padding, not by
  changing the footer dock behavior.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderTimeline
    RouteBuilderTimelineDayCard
    RouteBuilderInlineResults
      RouteBuilderInlineCampCard
      RouteBuilderInlineResultRow
      ExistingInlineEmptyStateSlot
  RouteBuilderFooterDock
```

## Why The Redesign Is Better

- It removes another repeated visual block from `route-builder.tsx` without
  changing route discovery behavior.
- It gives camp/fuel/place/side-trip result rows typed props and reusable
  layout rules.
- It keeps empty states and data-specific callbacks in the screen where the
  route-builder state already lives.
- It makes the small-phone footer overlap visible in validation and addresses it
  through explicit content clearance.

## Future Improvements

- Extract active discovery state and result mapping into route-builder domain
  helpers after the UI components stabilize.
- Add native iOS/Android screenshots for long camp names and dense side-trip
  metadata.
- Consider a compact "save to day" affordance for place rows once the trip-save
  flow is finalized.
