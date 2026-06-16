# Phase 6 Audit

Date: 2026-06-13

## Scope

This is the first checkpoint for Phase 6 from `docs/production-improvement-execution-plan.md`:

- reduce `map.tsx`
- move isolated map UI out behind prop boundaries

## Shipped

Updated:

- `mobile/app/(tabs)/map.tsx`
- `mobile/components/map/RouteAlertsPanel.tsx`
- `mobile/components/map/MapDrawerSheet.tsx`
- `mobile/components/map/MapFilterSheet.tsx`
- `mobile/components/map/RouteScoutPanel.tsx`
- `mobile/components/map/MapStyleSheet.tsx`
- `mobile/components/map/MapWeatherPeek.tsx`
- `mobile/components/map/MapWeatherSheet.tsx`
- `mobile/components/map/MapLayerSheetContent.tsx`
- `mobile/components/map/CampReviewsSection.tsx`
- `mobile/components/map/CampCommentsSection.tsx`
- `mobile/components/map/CampFieldReportsSection.tsx`
- `mobile/components/map/CampCoordinatesSection.tsx`
- `mobile/components/map/CampInsightSection.tsx`
- `mobile/components/map/CampNearbyPlacesSection.tsx`
- `mobile/lib/campNearby.ts`

### 1. Route alerts are now their own map component

What changed:

- Moved the route alert overlay out of `map.tsx`.
- The new component owns:
  - alert header
  - alert list
  - severity styling
  - compact item layout
- `map.tsx` now only passes:
  - visibility
  - alert count
  - formatted alert rows
  - close handler
  - telemetry tap handler

### 2. The split stayed away from route logic

What changed:

- No routing, alert ranking, or trip state logic changed.
- This was a safe UI extraction, which is the right first move for a file this large.

### 3. Map tools drawer is now its own component

What changed:

- Moved the map tools drawer shell and list row UI out of `map.tsx`.
- `map.tsx` now only passes drawer items and actions.
- This removes another chunk of top-level overlay code from the main map screen without changing behavior.

### 4. Filter sheet is now its own map component

What changed:

- Moved the filter sheet modal, section rows, preset chips, toggle rows, and check rows out of `map.tsx`.
- `map.tsx` now keeps:
  - filter state
  - filter summaries
  - preset behavior
  - layer toggle behavior
- The new component owns the sheet presentation and grouped section layout.

Why this checkpoint matters:

- The filter sheet was one of the largest self-contained map overlays left in the file.
- It had a clear prop boundary and did not require touching route logic, trip state, or map math.

## What Improved

- `map.tsx` dropped below the previous line count and now has one less embedded overlay.
- The first extraction created a repeatable pattern for future map panel splits.
- The filter UI is now easier to scan, reason about, and adjust without opening the full map screen file.
- Route scout UI now lives behind a bounded prop surface instead of staying embedded in the map screen.

### 5. Route scout panel is now its own map component

What changed:

- Moved the route scout overlay card out of `map.tsx`.
- The new component owns:
  - header
  - progress bar
  - scout message
  - stat pills
  - stop rail
  - rescout and builder actions
- `map.tsx` now only passes:
  - the scout state
  - close/rescout/builder actions
  - stop focus callback

Why this checkpoint matters:

- Route scout is a distinct product surface.
- Pulling it out reduces clutter around the rest of the map overlays without changing scout behavior.

### 6. Map style sheet is now its own map component

What changed:

- Moved the map-style modal out of `map.tsx`.
- The new component owns:
  - sheet shell
  - style preview cards
  - extreme map style card
  - close behavior
- `map.tsx` now only passes:
  - active style
  - style options
  - extreme state
  - selection handlers

Why this checkpoint matters:

- This was another safe overlay extraction with a small behavior surface.
- It removes more duplicated presentation code from the map screen while keeping selection logic local.

### 7. Weather peek is now its own map component

What changed:

- Moved the weather crosshair overlay and peek card out of `map.tsx`.
- The new component owns:
  - map-center crosshair
  - weather peek shell
  - compact metrics row
  - open and close actions
- `map.tsx` now only passes:
  - formatted weather display values
  - loading state
  - icon choice
  - open and close handlers

Why this checkpoint matters:

- The weather peek was a clean display-only surface.
- This keeps the weather calculations local while removing another overlay block from the main map file.

### 8. Weather detail sheet is now its own map component

What changed:

- Moved the full weather detail sheet out of `map.tsx`.
- The new component owns:
  - sheet header
  - current conditions card
  - hourly rail
  - 7 day list
  - air and health cards
  - loading state
- `map.tsx` now only passes:
  - formatted current weather values
  - hourly rows
  - daily rows
  - health rows
  - close handler

Why this checkpoint matters:

- The weather surface is now fully split into dedicated components.
- This removes another large modal block from the map screen while keeping weather-fetch and formatting decisions in one place.

### 9. Main layer-sheet content is now its own map component

What changed:

- Moved the non-trail `LAYERS` pane out of `map.tsx`.
- The new component owns:
  - map-style cards
  - base layer toggles
  - premium map cards
  - EXTREME feature cards
  - safe-water legend
  - offroad / MVUM / avalanche legends
- `map.tsx` now only passes:
  - style options
  - layer state
  - action handlers
  - legend data

Why this checkpoint matters:

- This was the largest UI-only extraction so far in Phase 6.
- It clears a substantial block of map-layer presentation and preview code out of the main screen while keeping all actual behavior in `map.tsx`.

### 10. Camp community detail sections are now shared map components

What changed:

- Moved repeated camp detail UI out of `map.tsx` for:
  - reviews
  - comments and questions
  - field reports
- The new components now render both:
  - the quick camp detail surface
  - the full camp profile modal
- `map.tsx` still owns:
  - loaded review/comment/report data
  - comment form state
  - field report sheet state
  - paywall actions
  - submit handlers

Why this checkpoint matters:

- This removes another repeated block from the most crowded screen in the app.
- It also gives camp detail copy and interaction polish a single place to change instead of two separate surfaces drifting apart.

### 11. Camp coordinates and loaded insight are now shared map components

What changed:

- Moved repeated camp detail UI out of `map.tsx` for:
  - coordinates
  - loaded camp insight content
- The new components now render both:
  - the quick camp detail surface
  - the full camp profile modal
- `map.tsx` still owns:
  - insight loading state
  - locked insight upsell states
  - coordinate copy action

Why this checkpoint matters:

- This keeps the paid and non-paid camp surfaces aligned.
- It also removes more repeated presentation code while leaving the actual insight fetch and gating logic untouched.

### 12. Camp nearby discovery rails are now a shared map component

What changed:

- Moved repeated camp nearby-discovery UI out of `map.tsx`.
- The new component now renders both:
  - the quick camp detail nearby rails
  - the full camp profile nearby rails
- `map.tsx` still owns:
  - nearby feed loading and retry
  - nearby place ranking and grouping
  - nearby place card rendering

Why this checkpoint matters:

- This was the last large duplicated camp detail subsection worth extracting before deeper logic work.
- It leaves one place to adjust nearby fallback wording, source labeling, and rail structure.

### 13. Camp nearby filtering and bucketing moved into a shared logic helper

What changed:

- Moved camp nearby classification logic out of `map.tsx` into `mobile/lib/campNearby.ts`.
- The helper now owns:
  - low-value BLM filtering
  - trip-service classification
  - visitor-center classification
  - things-to-see classification
  - photo-first rail ranking
  - grouped camp nearby buckets for both camp detail surfaces
- `map.tsx` still owns:
  - nearby feed fetch state
  - retry triggers
  - actual card rendering

Why this checkpoint matters:

- This is the first Phase 6 split that reduces duplicated behavior, not just duplicated JSX.
- It lowers the chance that the quick card and full detail modal drift on nearby-place rules.

## Metrics or Spot Checks

- `map.tsx`: `26484` -> `26460` lines
- `map.tsx`: `26484` -> `26362` lines after the second extraction
- `map.tsx`: `26362` -> `26141` lines after the filter-sheet extraction
- `map.tsx`: `26141` -> `25993` lines after the route-scout extraction
- `map.tsx`: `25993` -> `25861` lines after the map-style extraction
- `map.tsx`: `25861` -> `25775` lines after the weather-peek extraction
- `map.tsx`: `25775` -> `25718` lines after the weather-sheet extraction
- `map.tsx`: `25718` -> `25150` lines after the layer-sheet content extraction
- `map.tsx`: `25150` -> `24931` lines after the camp community section extraction
- `map.tsx`: `24931` -> `24854` lines after the camp coordinates and insight extraction
- `map.tsx`: `24854` -> `24771` lines after the camp nearby rails extraction
- `map.tsx`: `24771` -> `24707` lines after the camp nearby logic extraction
- extracted files:
  - `mobile/components/map/RouteAlertsPanel.tsx` (`98` lines)
  - `mobile/components/map/MapDrawerSheet.tsx` (`118` lines)
  - `mobile/components/map/MapFilterSheet.tsx` (`651` lines)
  - `mobile/components/map/RouteScoutPanel.tsx` (`269` lines)
  - `mobile/components/map/MapStyleSheet.tsx` (`264` lines)
  - `mobile/components/map/MapWeatherPeek.tsx` (`158` lines)
  - `mobile/components/map/MapWeatherSheet.tsx` (`271` lines)
  - `mobile/components/map/MapLayerSheetContent.tsx` (`735` lines)
  - `mobile/components/map/CampReviewsSection.tsx` (`120` lines)
  - `mobile/components/map/CampCommentsSection.tsx` (`234` lines)
  - `mobile/components/map/CampFieldReportsSection.tsx` (`336` lines)
  - `mobile/components/map/CampCoordinatesSection.tsx` (`91` lines)
  - `mobile/components/map/CampInsightSection.tsx` (`143` lines)
  - `mobile/components/map/CampNearbyPlacesSection.tsx` (`127` lines)
  - `mobile/lib/campNearby.ts` (`92` lines)
- validation:
  - `npx tsc --noEmit`
  - `git diff --check`

## What Still Feels Weak

- The map file is still extremely large.
- The next good candidates are:
  - reservation or booking blocks if we want one more UI-only cut
  - route builder / nearby feed state helpers as the next logic-level cuts
  - deeper logic splits now that the last obvious camp-detail UI duplication is out
  - trail discovery mode inside the layer modal if we want to keep reducing modal weight

## Decision

- continue

Reason:

Phase 6 is in progress. The first split landed cleanly, but the file is still big enough that more extractions are required before calling the phase complete.
