# Live Upgrade Checkpoint 9 Audit: Reports + Mission Control

**Date:** 2026-06-25  
**Commit target:** Reusable field-report composer and Mission Control report signal.

## Scope Completed

- Added `docs/design-decisions/report-mission-control.md` before code changes.
- Created and inspected a Figma design pass:
  - File: Mobbin copy/inspiration board supplied by the user.
  - Page: `Trailhead Checkpoint 9 - Reports`.
  - Root frame: `Trailhead Report + Mission Control - Checkpoint 9`.
  - Node: `5:3`.
- Extracted camp/trail field-report form UI into:
  - `mobile/components/reports/FieldReportComposer.tsx`
- Replaced both map field-report entry points with the shared composer:
  - camp report sheet
  - trail report panel
- Removed the old camp form helper and dead form-only map styles.
- Added a compact Mission Control report-signal card derived from existing
  `status_summary.reports` data.
- Avoided backend, payload, report TTL, credit, and submit behavior changes.

## Research Reviewed

- PR #12 master live app direction and checkpoint list.
- `docs/adventure-app-production-readiness-plan.md` Reports 2.0 and Mission
  Control sections.
- Current Trailhead code:
  - `mobile/app/(tabs)/report.tsx`
  - `mobile/app/(tabs)/map.tsx`
  - `mobile/components/map/CampFieldReportsSection.tsx`
  - `mobile/components/copilot/MissionControlPanel.tsx`
  - `mobile/lib/api.ts`
- Figma / Mobbin references:
  - Waze report submit flow, node `2:2`.
  - Waze report validation flow, node `2:17`.
  - Wanderlog home/task rail flow, node `1:2`.
- Figma library search found Material, SDS, and iOS kits available, but no
  reusable inserted components/tokens in the reference file for this slice.

## Files Changed

- `docs/design-decisions/report-mission-control.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `docs/live-upgrade-checkpoint-09-report-mission-control-audit.md`
- `mobile/app/(tabs)/map.tsx`
- `mobile/components/copilot/MissionControlPanel.tsx`
- `mobile/components/reports/FieldReportComposer.tsx`

## Audit Notes

- `FieldReportComposer` is presentational only.
- Existing map state, photo picker, submit functions, API calls, and credit
  labels remain owned by `map.tsx`.
- The Mission Control card does not expose source IDs or backend terminology.
- The old duplicated form styles were removed from `map.tsx`.
- The full Report tab redesign is intentionally deferred until the shared
  primitives are stable.

## Validation

- `cd mobile && npx tsc --noEmit` - passed.
- `cd mobile && npm run audit:copy` - passed.
- `cd mobile && npm run audit:routes` - passed.
- `git diff --check` - passed.
- Figma screenshot inspection - passed.
- Playwright Expo web smoke pass:
  - opened `http://localhost:8091`
  - continued through Welcome Gate
  - rendered `/report`
  - rendered `/map`
  - captured ignored screenshots in `output/playwright/`

## Playwright Notes

- Installed the Playwright Chrome for Testing runtime because it was missing.
- Expo web showed existing unauthenticated API errors:
  - `analytics/event` returned 400.
  - contributions leaderboard returned 401.
- Expo web also showed existing web warnings for deprecated shadow props,
  `expo-av`, `expo-notifications`, and native-driver fallback.
- No new compile or route-render failure appeared during the browser pass.

## Remaining Risks

- The Report tab still has its own submit composer and should move to shared
  report primitives in a later checkpoint.
- Mission Control still depends on the existing brief shape; a richer report
  freshness model should come from the backend later.
- Expo web is a smoke check only for map/report route rendering. Native iOS
  interaction around report sheets still needs device validation.
