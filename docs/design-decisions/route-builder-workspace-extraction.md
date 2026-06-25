# Design Decision: Route Builder Workspace Extraction

**Date:** 2026-06-25
**Checkpoint:** 14 - Route Builder Workspace Extraction

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still owns the active route workspace
  header, timeline controls, insert notice, readiness card, search, day
  controls, stop rows, leg actions, and footer dock.
- The previous checkpoint extracted the hub, but the active workspace still
  mixes rendering with route orchestration and Mapbox/offline readiness state.
- The readiness card is useful, but its JSX and styles are screen-local, making
  future Planner/Copilot route-readiness reuse harder.
- The workspace summary is a repeated bottom-sheet pattern that should be a
  component before deeper route timeline work starts.
- This checkpoint should not change route math, saved payloads, Mapbox behavior,
  or offline readiness computation.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderHub.tsx`
  - `mobile/lib/offlineReadiness.ts`
  - `docs/live-upgrade-checkpoint-13-route-builder-audit.md`
- Mobbin route/navigation references:
  - Transit route options:
    `https://mobbin.com/screens/84d6aa6d-985d-437e-82fb-05ffed61557a`
  - komoot route edit:
    `https://mobbin.com/screens/99150e4d-02e8-4d95-835c-d80bbdec4fa7`
  - komoot route detail/offline status:
    `https://mobbin.com/screens/34f4c989-7e74-48cd-806d-a7b309b98c67`
  - AllTrails custom route detail:
    `https://mobbin.com/screens/1cf38e7f-1d2e-403f-84aa-5d35738dfaaf`
- User-provided Figma files:
  - Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`, page `0:1`, confirmed
    accessible and containing Wanderlog/Waze references plus prior Trailhead
    checkpoint frames.
  - Nucleus UI Lite `O8XRegvq3i6WljYoJ3M72g`, node `770:5839`, confirmed
    accessible as metadata. The provided node is cover/upsell content, not a
    route-workspace component source.
  - Untitled UI styles `a07B9pTYDR4VXVPNkI7RnW` and variables
    `dAxE1C8nCXtC165yyf5HR3`, confirmed accessible as metadata. The directly
    referenced nodes are getting-started/documentation frames, so this
    checkpoint keeps using existing Trailhead tokens.
- Template/source search:
  - Figma design-system search on the Mobbin board and Nucleus file returned no
    reusable card/status/bottom-sheet assets for this specific screen.
  - Envato, Behance, and Dribbble are not used as concrete references in this
    slice because Mobbin and the accessible Figma boards already cover the
    needed interaction patterns.

## Mobbin References

- Transit keeps the map dominant and moves the immediate route choice into a
  compact status/action sheet.
- komoot uses a dense ordered-stop editor with clear reorder affordances and a
  persistent save/navigate action area.
- komoot route detail presents offline availability as a short status surface
  instead of a long explanatory panel.
- AllTrails custom route detail keeps route metrics and download/start actions
  near the thumb zone while preserving map context.

## Template References

- Trailhead's existing `TrailheadSheet`, `TrailheadCard`, token colors, and
  Ionicons are the implementation base for this checkpoint.
- Untitled UI/Nucleus access is confirmed, but no imported template component is
  mapped into Route Builder in this slice.
- The saved Figma Mobbin board remains the research board for later route
  timeline and map-sheet refinements.

## Patterns Extracted

- Keep the active map/workspace summary compact and persistent.
- Put route readiness into one short status card with direct labels.
- Avoid expanding the sheet with extra instructional copy.
- Preserve one-thumb access to add-day, loop/return, search, and footer actions.
- Keep status rendering separate from route/offline computation.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderHub
  RouteBuilderWorkspaceSummary
  RouteBuilderTimelineActions
  RouteBuilderInsertNotice
  RouteBuilderReadinessCard
  RouteBuilderTimeline
  RouteBuilderFooterDock
```

## Why The Redesign Is Better

- It reduces `route-builder.tsx` without touching production route behavior.
- It creates typed, reusable surfaces for the workspace summary and readiness
  state that can later support Planner/Copilot route handoff.
- It makes future timeline extraction safer because the simple surrounding
  surfaces are already isolated.
- It keeps user-facing language short and route-focused while avoiding
  implementation wording.

## Checkpoint 14 Implementation Scope

- Extract `RouteBuilderWorkspaceSummary`.
- Extract `RouteBuilderReadinessCard`.
- Leave timeline stop rows and leg actions in the screen for a later, dedicated
  extraction.
- Run TypeScript, copy, route, and diff audits before committing.

## Future Improvements

- Extract `RouteBuilderTimelineActions` and `RouteBuilderInsertNotice`.
- Extract timeline stop and leg-action rows once callback props are mapped.
- Build a Figma checkpoint frame beside Checkpoint 13 after code validation.
- Revisit copy in the active workspace after the component boundaries are stable.
