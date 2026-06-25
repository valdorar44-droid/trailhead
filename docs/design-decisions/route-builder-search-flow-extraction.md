# Design Decision: Route Builder Search Flow Extraction

**Date:** 2026-06-25
**Checkpoint:** 21 - Route Builder Search Flow Extraction

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still owns route-builder search scoring,
  result dedupe, online lookup fallback orchestration, and selected-place to
  route-stop mapping inline.
- The search box and result rows are already compact, but the screen still mixes
  route-stop creation with search-result preparation.
- Planner, Copilot, map search, and Route Builder need one route-friendly search
  boundary later, so this checkpoint should carve out the pure Route Builder
  pieces without changing provider calls.
- The active builder must keep Android lookup fallback, saved geometry, route
  calculations, offline search, and map handoff behavior unchanged.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/RouteSearchModal.tsx`
  - `mobile/lib/api.ts`
  - `docs/live-upgrade-checkpoint-20-route-builder-route-fit-cards-audit.md`
- Mobbin route/search references:
  - Lyft destination/search picker:
    `https://mobbin.com/screens/185a43b9-6710-4e23-8296-1e50a7db7401`
  - Lyft route destination result state:
    `https://mobbin.com/screens/4536f9d8-85c6-4d23-a04a-82a858fe7c47`
  - Wanderlog save-to-list flow:
    `https://mobbin.com/flows/609c277f-7cba-45a8-83c3-9e26d0a921bc`
  - Wanderlog adding-a-place flow:
    `https://mobbin.com/flows/23c441df-12a9-46ab-a60e-19b43fcc65dd`
- Figma design-system search:
  - Searched the user-provided Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s` for
    mobile travel search results, add-stop rows, destination picker, and route
    planner result patterns.
  - No exact reusable component, variable, or style was returned for this
    route-builder search slice.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches were
    checked for mobile travel planner / itinerary search result patterns.
    Results were broad and did not provide a stronger implementation pattern
    than Mobbin and Trailhead's current compact route-builder search surface.

## Mobbin References

- Destination pickers keep search results close to the active route decision.
- Place-add flows preserve the trip context while the user selects a result.
- Compact rows prioritize the name, one short metadata line, and the immediate
  action.
- Search surfaces avoid exposing provider or implementation details.

## Template References

- Trailhead keeps the existing search box, result row, type chips, Ionicons, and
  local route-builder styling.
- No external screen or component is copied. References inform hierarchy,
  context retention, and result-row density only.

## Patterns Extracted

- Search-result preparation should be a pure helper that combines offline and
  online candidates with stable dedupe rules.
- Provider calls should remain outside the helper so the checkpoint does not
  change network behavior.
- Selected search results should map through one typed function before entering
  the route-stop list.
- The screen should keep route insertion state and active-day selection, but not
  own search scoring and mapping details.

## New Component Tree

```txt
RouteBuilderScreen
  resolveRouteBuilderSearchResults
  buildRouteBuilderSearchStop
  Existing search box/result rows
  Existing route stop insertion
```

## Why The Redesign Is Better

- It removes search scoring and stop-mapping logic from the large screen while
  preserving user-visible behavior.
- It creates a narrow Route Builder search contract that Planner, Copilot, and
  map search can share in later checkpoints.
- It keeps provider selection and fallbacks in the screen for this slice, which
  lowers release risk.
- It makes route-builder search easier to validate independently of rendering.

## Future Improvements

- Extract the search box and result list into a presentational component after
  the helper boundary stabilizes.
- Move shared map search and route-builder search toward one Mapbox bridge once
  selected map state and route-corridor context are unified.
- Add focused tests for result dedupe, coordinate parsing, and stop mapping when
  the route-builder test harness is expanded.
