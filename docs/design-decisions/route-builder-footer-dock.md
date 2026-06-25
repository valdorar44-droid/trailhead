# Design Decision: Route Builder Footer Dock

**Date:** 2026-06-25
**Checkpoint:** 17 - Route Builder Footer Dock

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still owns the fixed bottom route
  summary and open-on-map action inline.
- The dock mixes route totals, fuel estimate copy, safe-area positioning,
  saving state, and primary action layout in the same screen block.
- The dock is visually important during active itinerary editing, but it is
  hard to audit separately from route computation and save/open-on-map logic.
- Long fuel/source text can compete with the primary action on small widths.
- The footer styles still live in the screen alongside unrelated route editor
  styles.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderActiveDayStop.tsx`
  - `mobile/components/routeBuilder/RouteBuilderLegActions.tsx`
- Mobbin route and travel references:
  - komoot route screens:
    `https://mobbin.com/screens/5acbb479-fac7-4813-8f8a-51ebdda53b20`
    `https://mobbin.com/screens/d4776023-5b74-4b50-8479-cfce2f66fe9f`
    `https://mobbin.com/screens/3ca15cf2-6742-4d73-a030-8334d185ef2c`
  - AllTrails route/trail screens:
    `https://mobbin.com/screens/fbb9b733-a59c-4c53-9447-4122f82bfe61`
    `https://mobbin.com/screens/aa6b2a26-585b-4fe8-89bd-f88e46751b15`
    `https://mobbin.com/screens/ab420019-f83d-4286-8c4f-b05dc91b1143`
  - Waze directions action screen:
    `https://mobbin.com/screens/b0586413-384e-48ef-a0d7-ec232350e829`
  - Transit route option screens:
    `https://mobbin.com/screens/3bccdcd5-99c6-41d0-bc36-fee04894a216`
    `https://mobbin.com/screens/d9da4f52-fb6d-4f90-826c-3270ff84354b`
- Figma design-system search:
  - Searched the Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s` for bottom dock,
    footer action bar, sticky footer, bottom app bar, and route summary
    components.
  - No reusable Trailhead, Material 3, Simple Design System, or iOS kit
    component match was returned for this exact dock pattern.

## Mobbin References

- Route-planning screens keep the main action in a persistent bottom region.
- Travel and trail screens make the primary route action visually stronger than
  secondary metadata.
- Directions screens keep distance/time summary close to the primary action but
  avoid multi-line instructional text in the sticky control.
- Sticky controls need predictable dimensions so list content and touch targets
  remain scannable behind or above them.

## Template References

- Existing Trailhead route editor colors, `mono`, Ionicons, and glass surface
  tokens remain the implementation base.
- The Figma checkpoint board remains the audit record; Checkpoint 17 should be
  added after code validation.
- No third-party UI kit component is imported or recreated.

## Patterns Extracted

- Summary text should be a compact block with the strongest metric first.
- Fuel and stop metadata should stay single-line and truncate before it crowds
  the primary action.
- The dock should receive already formatted strings from the screen rather than
  calculating route or fuel state.
- The primary action should be a stable icon-plus-label button with disabled
  opacity during saving.
- Safe-area and keyboard visibility remain controlled by the screen.

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

- It removes another presentation-only block from `route-builder.tsx`.
- It keeps save/open-on-map behavior unchanged while making dock layout auditable
  in isolation.
- It gives the summary text a truncation boundary so long fuel-source labels do
  not push or overlap the primary action.
- It sets up future footer and active-itinerary spacing work without moving
  route math, saved geometry, or readiness checks.

## Future Improvements

- Tune the route editor content padding against native iPhone and Android
  viewport screenshots.
- Add a secondary saved-state affordance after route saving is separated from
  map opening.
- Consider a compact footer variant for very small device widths.
