# Design Decision: Map Sheets

**Date:** 2026-06-25  
**Checkpoint:** 6 - Map Sheets + Mapbox Layer Polish

## Current Problems

- The layer sheet already places Trailhead Topo first and Mapbox cards directly
  after it, but the implementation uses `slice()` inline, making the priority
  easy to regress.
- Mapbox layer access is visually mixed with an `EXPLORER TOOLS` section, which
  keeps the old Explorer mental model in the map-layer workflow.
- Disabled map tools currently show `Explorer` as supporting copy, which does
  not tell users what action or state matters.
- The map screen owns the option data, while the extracted
  `MapLayerSheetContent` should own presentation grouping and labels.

## Research Reviewed

- PR #12 master live-app upgrade plan and reference board.
- Current `MapLayerSheetContent`, `MapModeGallery`, and `map.tsx` layer data.
- Production readiness plan section 1.2 and 1.3, which direct map polish into
  extracted components and call for clearer layer/mode previews.
- Mobbin, authenticated session:
  - Search: `map filter layers`.
  - Reviewed map/filter examples from Lyft, Booking.com, and komoot.
  - Pattern extracted: keep map actions compact, task-first, and grouped by
    purpose instead of mixing base-map choices with utility tools.
- Figma:
  - Nucleus UI Lite Accordion List node `2802:306`.
  - Pattern extracted: compact row rhythm, 16px spacing, clear dividers, and
    disclosure states without overloading the card text.

## Patterns Extracted

- Start the sheet with the most important base-map choices.
- Keep Mapbox Outdoors adjacent to Trailhead Topo because both are route/outdoor
  base-map decisions.
- Separate overlays from trip tools so users can scan "what the map looks like"
  before "what the map can do."
- Disabled utility cards need plain availability copy, not a branded bucket.
- Preserve the existing card previews and horizontal rails because they already
  fit Trailhead's compact map controls.

## New Component Tree

```txt
MapScreen
  layer data and actions
  MapLayerSheetContent
    primary map rail
      Trailhead Topo
      Mapbox Outdoors
      other Mapbox map styles
      remaining built-in map styles
    layer overlay rail
    map tools rail
    legends
```

## Why This Is Better

- Users see Trailhead Topo and Mapbox Outdoors together without hunting through
  an Explorer-labelled area.
- The layer sheet reads as one map-control surface rather than a paywall-era
  feature launcher.
- Explicit grouped arrays make the product ordering intentional and easier to
  audit.
- The implementation stays inside the extracted map-sheet component instead of
  growing the map screen.

## Future Improvements

- Extract the map-style cards into a small reusable component once the Planner
  and Route Builder map previews need the same presentation.
- Add route-aware defaults so Offroad, Public Land, Weather, and Offline Ready
  states can be suggested from the active trip.
- Add source/freshness badges to overlays after the copy audit expands to map
  surfaces.
- Consider a vertical compact mode for smaller iPhones if the horizontal rails
  become too dense after more tools land.
