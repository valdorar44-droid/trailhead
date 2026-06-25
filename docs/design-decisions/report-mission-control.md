# Design Decision: Reports + Mission Control

**Date:** 2026-06-25  
**Checkpoint:** 9 - Reports + Mission Control Signal Polish

## Current Problems

- `mobile/app/(tabs)/map.tsx` renders camp and trail field-report forms inline,
  duplicating sentiment, access, crowd, tag, note, photo, and submit controls.
- The map field-report form works, but it is not reusable enough for the next
  Report and Mission Control passes.
- Mission Control already receives a `reports` status row, but report freshness
  is visually buried inside the same generic status list as fuel, route, and
  offline readiness.
- The Report tab has route, tonight, nearby, submit, offline retry, TTL, and
  confirmation behavior, but the next major redesign needs extracted report
  primitives before the screen is safe to reshape.

## Research Reviewed

- PR #12 master live app plan:
  - Reports can remain accessible from Map and Mission Control.
  - Offline readiness should include report cache status.
  - Mission Control should show route readiness and report trust.
- `docs/adventure-app-production-readiness-plan.md`:
  - Waze lane: current/stale/conflicting reports, confirmations, decay, TTL,
    and offline queue.
  - Mission Control should fuse route hazards, offline readiness, and community
    reliability.
- Current Trailhead implementation:
  - `mobile/app/(tabs)/report.tsx`
  - `mobile/app/(tabs)/map.tsx`
  - `mobile/components/map/CampFieldReportsSection.tsx`
  - `mobile/components/copilot/MissionControlPanel.tsx`
  - `mobile/lib/api.ts`
- Figma / Mobbin copy board:
  - `Submitting a report on Waze (iOS)` node `2:2`
  - `Liking a report on Waze (iOS)` node `2:17`
  - `Home on Wanderlog (iOS)` node `1:2`
- New Trailhead Figma design pass:
  - Page: `Trailhead Checkpoint 9 - Reports`
  - Root frame: `Trailhead Report + Mission Control - Checkpoint 9`
  - Node: `5:3`
- Figma library search:
  - Checked available libraries and design-system search for buttons, cards,
    variables, spacing, and radii.
  - The reference file is mostly screenshot-based, so this checkpoint uses
    Trailhead's own React Native styles and local tokens.

## Patterns Extracted

- Keep map context visible before opening the report sheet.
- Use compact segmented choices for sentiment, access, crowd, and detail tags.
- Treat report confirmation as a trust signal, not a social feed.
- Surface report freshness near route readiness.
- Keep the first production slice small: extracted components first, screen
  reshape later.

## New Component Tree

```txt
MapScreen
  camp/trail detail sheets
    CampFieldReportsSection
    FieldReportComposer
      sentiment choice row
      access choice row
      crowd choice row
      tag chips
      notes input
      photo action
      cancel/send actions

MissionControlPanel
  header
  summary
  MissionReportSignalCard
  status rows
  scores
  risks
  source confidence
  staged actions
```

## First Implementation Slice

- Extract the duplicated camp/trail field-report form into
  `mobile/components/reports/FieldReportComposer.tsx`.
- Use the extracted composer from map camp and trail report surfaces without
  changing backend payloads or submit behavior.
- Add a compact Mission Control report-signal card when the brief includes a
  report status item.
- Keep user-facing copy product-oriented:
  - `Reports`
  - `Route reports`
  - `Source updated`
  - `Route Ready`
- Do not change the Report tab routing or backend APIs in this slice.

## Why This Is Better

- `map.tsx` loses duplicated field-report UI instead of gaining more screen
  logic.
- Camp and trail field reports now share one tested control surface.
- Mission Control makes report trust easier to scan without requiring a new
  backend response.
- The next Report tab redesign can reuse the same composer and signal patterns
  instead of creating another one-off report flow.

## Future Improvements

- Move the Report tab submit flow onto shared report primitives.
- Add route-aware report cache status to offline readiness.
- Add a dedicated report freshness model so Mission Control can distinguish
  current, stale, and conflicting signals more explicitly.
- Add visual regression screenshots once Expo web can render the map/report
  surfaces reliably in CI.
