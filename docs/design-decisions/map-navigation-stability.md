# Design Decision: Map Navigation Stability

**Date:** 2026-06-25
**Checkpoint:** 12 - Map Navigation Stability + Mapbox Native QA

## Current Problems

- iOS can crash when the user pans the native map during navigation mode.
- `NativeMap` already keeps one `Camera` instance alive, but touch, region, and
  tracking-mode events can still notify the parent repeatedly during one pan.
- `map.tsx` receives each native gesture callback and can repeatedly set
  `navCameraFollow` to false while the native camera is also leaving follow
  mode.
- Returning to the Map shortly after leaving it can start from the default
  camera instead of the area the user just viewed.

## Research Reviewed

- Current implementation:
  - `mobile/components/NativeMap/index.tsx`
  - `mobile/app/(tabs)/map.tsx`
- Prior map-sheet work:
  - `docs/design-decisions/map-sheets.md`
  - `docs/live-upgrade-checkpoint-06-map-sheets-audit.md`
- Mobbin references:
  - Google Maps navigation screen:
    `https://mobbin.com/screens/69f81453-0266-46d5-8164-74324547e634`
  - Waze navigation screen:
    `https://mobbin.com/screens/e14677e7-2496-4740-aad0-091c4c4f9925`
  - Apple Maps navigation screen:
    `https://mobbin.com/screens/0b6a3bc4-309d-4dbc-bddf-8177a7d27261`
  - Transit navigation/status screen:
    `https://mobbin.com/screens/c88b39a9-350c-4467-86ab-1baf574bc4f5`
- Figma sources:
  - Untitled UI Styles and Variables for token/layout discipline.
  - Sublima Mobile App PRO for mobile list, dock, and card rhythm.
  - Nucleus UI Lite, inspected but current link lands on cover/upsell content.
  - Dark style guide for low-glare map contrast.
- Figma checkpoint frame:
  - File: Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`.
  - Frame: `Checkpoint 12 - Map Navigation Stability`, node `15:2`.

## Patterns Extracted

- Navigation apps treat manual pan as an explicit free-camera state.
- Route guidance continues while the map is moved away from follow mode.
- Returning to follow is an intentional locate/recenter action, not automatic.
- Layer and map controls should stay task-first and avoid legacy plan labels.

## New Component Tree

```txt
MapScreen
  NativeMap
    one persistent native Camera
    debounced user camera breakaway
    recent viewport cache
  navigation HUD
  locate/follow button
  layer sheet
```

## Why This Is Better

- One pan creates one follow-off transition instead of several competing native
  and JS state updates.
- A plain touch does not immediately break follow mode unless the map actually
  starts moving or native tracking changes.
- Route progress, turn data, ETA, and alerts continue while the user inspects
  the map in free-camera mode.
- The explicit locate button remains the return-to-follow control.
- Recent viewport restore keeps the map near the same area after a quick return
  without changing route or partner data contracts.

## Future Improvements

- Add iOS native crash logs to the audit if the issue reproduces after this
  guard.
- Extract camera/follow state into a dedicated native-map helper if additional
  navigation behaviors land.
- Expand the later Mapbox bridge checkpoint to share map context with Planner,
  Route Builder, Copilot, and search.
