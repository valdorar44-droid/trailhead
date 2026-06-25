# Design Decision: Route Builder

**Date:** 2026-06-25  
**Checkpoint:** 4 - Activity Tokens + Route Builder Shell

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` is large enough that small UI changes
  increase regression risk.
- The animated build status card was embedded in the screen file even though it
  is a reusable planning pattern.
- The wizard progress header was shell UI mixed into the route setup flow.

## Research Reviewed

- PR #12 master live-app upgrade plan.
- Stage A repo audit.
- Existing Route Builder implementation.
- Mobbin travel onboarding reviewed earlier for progress hierarchy and concise
  step indicators.
- Untitled UI and Nucleus references for restrained stepper and status rhythm.

## Patterns Extracted

- Keep progress feedback compact and close to the active task.
- Use an explicit step track for setup flows.
- Extract presentational shell components before touching planning logic.
- Preserve existing labels and interaction behavior during extraction.

## New Component Tree

```txt
RouteBuilderScreen
  RouteWizardProgressHeader
  ActivityStatusCard
  existing route setup panes
  existing route timeline/editor
  existing camp/place/detail sheets
```

## Why The Redesign Is Better

- Route Builder loses local UI weight without changing behavior.
- Shared progress UI can be reused by Planner and Copilot later.
- The first extraction pass gives the screen clearer ownership boundaries before
  deeper route-builder redesign work.

## Future Improvements

- Move route setup panes into dedicated components.
- Replace inline option cards with shared selection controls.
- Add the copy audit target once Route Builder visible text is cleaned in its
  own checkpoint.
- Keep route computation and Mapbox bridge logic in library modules, not screen
  components.
