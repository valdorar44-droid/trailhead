# Phase 0 Baseline Audit

Date: 2026-06-12

## Scope

This pass starts Phase 0 from `docs/production-improvement-execution-plan.md`.

The goal of this pass was to:

- wire baseline analytics for core production flows
- save a durable baseline note
- identify the main empty-state and wording problems before Phase 1 trust work

## Instrumentation Added

Backend:

- `dashboard/server.py`
  - `/api/analytics/event` now accepts `phase0_` event names in addition to the earlier contest-only events.

Mobile helper:

- `mobile/lib/telemetry.ts`
  - `trackPhase0Event(...)`
  - `trackPhase0Once(...)`

Event coverage added:

- `phase0_profile_opened`
- `phase0_saved_trip_opened`
- `phase0_camp_card_opened`
- `phase0_route_alerts_opened`
- `phase0_route_brief_generated`
- `phase0_route_brief_opened`
- `phase0_search_no_results`
- `phase0_empty_state_seen`

## Current Coverage

### Covered now

- Profile screen open
- Saved trip open from Profile
- Camp card open on Map
- Route alerts panel open
- Route brief generated
- Route brief opened
- Copilot camp search no-results case on Map
- Report nearby empty state
- Guide Explore campground rail empty state

### Still missing in Phase 0

- no dedicated “ignore alert” action exists yet, so row-tap telemetry is the current interaction proxy
- map nearby-place rail empty-state analytics is still thinner than route-builder and guide coverage

## Baseline Findings

### 1. Screen overload

Current high-risk files:

- `mobile/app/(tabs)/profile.tsx` — `2944` lines
- `mobile/app/(tabs)/report.tsx` — `1374` lines
- `mobile/app/(tabs)/guide.tsx` — `1620` lines
- `mobile/app/(tabs)/map.tsx` — `26323` lines

This confirms the earlier product read: the issue is not just polish. Several primary screens carry too many jobs.

### 2. Important empty states already present

Examples found during audit:

- `mobile/app/(tabs)/report.tsx`
  - `No active reports nearby`
- `mobile/app/(tabs)/guide.tsx`
  - `No campground cards found nearby yet.`
- `mobile/app/(tabs)/map.tsx`
  - `No camps found near ...`
  - `No camps found near this day yet.`
  - `No official or open places found near this day yet.`
  - `No nearby camps, trails, or useful places loaded yet.`
  - `No nearby discovery loaded yet`
- `mobile/app/(tabs)/route-builder.tsx`
  - `No camps found for this day segment.`
  - `No fuel found for this day segment.`
  - `No side trips found for this day segment.`
  - `No places found for this day segment.`

### 3. Repeated wording patterns

The same fallback phrasing appears across multiple surfaces:

- `No ... yet`
- `... unavailable`
- `... right now`
- `Be the first to ...`

This is not catastrophic, but it does create a generic, repetitive feel across the app. It also makes real failure cases and ordinary empty states sound too similar.

### 4. Trust-critical issue remains unchanged

The TomTom route-alert filtering problem is still the highest-priority correctness issue for production trust:

- `ingestors/conditions.py`
- `ingestors/tomtom_traffic.py`
- `mobile/app/(tabs)/map.tsx`
- `ai/planner.py`

Phase 0 does not fix it. Phase 0 only makes the surrounding behavior easier to measure.

## Checkpoint Status

### Checkpoint: baseline metrics doc or notes saved

- yes

### Checkpoint: top empty-state surfaces listed

- yes

### Checkpoint: top repeated wording templates listed

- yes

## What improved

- The repo now has a dedicated Phase 0 telemetry helper instead of ad hoc calls.
- Core product flows are measurable enough to compare before and after later polish.
- Phase 0 now has a saved audit note instead of living only in conversation context.
- A simple analytics readout script now exists:
  - `scripts/report_phase0_analytics.py`
- Route brief dismissals and route alert row interactions are now tracked.
- Route-builder day-segment empty states are now tracked.

## What still feels weak

- The current analytics are intentionally narrow and still not a full product telemetry system.
- Row-tap telemetry is only a proxy until route alerts have richer interaction states.
- The product can now measure some trust and empty-state issues, but it still does not correct them.

## Metrics Or Spot Checks

Validation completed:

- `npx tsc --noEmit`
- `python3 -m py_compile dashboard/server.py`
- `git diff --check`

## Decision

- complete

Reason:

Phase 0 now has enough baseline instrumentation, saved audit context, and a working readout path to support Phase 1 trust work.
