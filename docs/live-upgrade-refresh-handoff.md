# Trailhead Live Upgrade Refresh Handoff

**Date:** 2026-06-25
**Branch:** `master`
**Status at save time:** Checkpoint 22 implemented, pushed, and OTA released.

This note is the restart point for the next Codex session after refreshing MCP
tools. It captures what is already complete and what should happen next.

## Current State

- Checkpoints 1-22 are complete through the Route Builder Search Surface
  Component slice in `docs/live-upgrade-execution-checkpoints.md`.
- Last shipped implementation batch: Planner composer and copy cleanup.
- Last implementation commit recorded in the prior session:
  `8ff520a Polish planner composer checkpoint`.
- Latest shipped implementation batch: Map Navigation Stability.
- Latest implementation commit: `d2d5739 Stabilize map navigation pan handling`.
- Latest production OTA: `8d04336f-dc1a-4c6c-b429-c3d64a998339`.
- Latest preview OTA: `bde39339-21c9-47be-b277-845ebf8fe2eb`.
- Latest route-builder implementation commit:
  `7b35225 Extract route builder workspace checkpoint`.
- Latest route-builder production OTA:
  `7379c0a5-fcdf-48a3-ba5a-5744815b8a86`.
- Latest route-builder preview OTA:
  `1b7b6b96-367d-4916-b30e-6bfbdf0797bc`.
- Latest route/search implementation commit:
  `b3699c7 Extract route search layering checkpoint`.
- Latest route/search production OTA:
  `121ff29d-88da-4d4f-98e0-04f633a729fb`.
- Latest route/search preview OTA:
  `f579cc32-ab38-4a82-b1ae-63ed7baac40c`.
- Latest shipped route-builder checkpoint:
  Checkpoint 22 extracted the Route Builder search surface into
  `mobile/components/routeBuilder/RouteBuilderSearchSurface.tsx`.
- Current repo check before this handoff: Checkpoint 22 validation, push, and
  OTA release passed.

## MCP / Research State

- `codex mcp login mobbin` succeeded after running outside the sandbox.
- `codex mcp list` showed:
  - `figma` enabled with OAuth.
  - `mobbin` enabled with OAuth.
- After refreshing Codex, Mobbin tools were visible and were used for
  Checkpoint 12 navigation research.

Suggested first commands after refresh:

```bash
codex mcp list
```

Then use tool discovery for Mobbin before each design checkpoint that needs
fresh shipped-app references.

## Completed Live-Upgrade Checkpoints

1. Spec Import + Stage A Audit.
2. Welcome Gate + Launch Cleanup.
3. User-Facing Copy Guardrail.
4. Activity Tokens + Route Builder Shell.
5. Library + Offline Readiness.
6. Map Sheets + Mapbox Layer Polish.
7. Planner/Copilot Structured Cards.
8. Viator/Partner Readiness.
9. Reports + Mission Control Signal Polish.
10. Explore Control Surface.
11. Planner Composer + Copy Cleanup.
12. Map Navigation Stability + Mapbox Native QA.
13. Route Builder Deeper Redesign first slice.
14. Route Builder Workspace Extraction.
15. Route Search Layering.
16. Route Builder Stop Rows.
17. Route Builder Footer Dock.
18. Route Builder Timeline Day Rows.
19. Route Builder Inline Discovery Results.
20. Route Builder Route Fit Cards.
21. Route Builder Search Flow Extraction.
22. Route Builder Search Surface Component.

## Remaining Work Queue

### 1. Native iOS QA For Checkpoint 12

Highest production risk. The first code slice for the reported iOS navigation
pan crash is implemented, but it still needs device smoke testing after OTA.

Verify:

- Start navigation, pan the map, and confirm the app does not crash.
- Confirm navigation guidance continues while the camera is in free mode.
- Tap locate/follow and confirm the route view recenters.
- Repeat the pan/follow cycle several times.
- Open Layers and confirm Mapbox Outdoors sits near Trailhead Topo.

### 2. Route Builder Deeper Redesign

Checkpoint 13 extracted the hub and cleaned first Route Builder copy hits.
Checkpoint 14 extracted the active workspace summary and trip-readiness card.
Checkpoint 15 extracted timeline actions and insert guidance, and fixed the
map search/tool/banner layer policy.
Checkpoint 16 extracted active-day stop rows and leg actions.
Checkpoint 17 extracted the fixed footer dock.
Checkpoint 18 extracted route timeline day cards.
Checkpoint 19 extracted inline discovery result rows and added footer scroll
clearance.
Checkpoint 20 extracted route-fit card assembly.
Checkpoint 21 extracted route-builder search flow helpers.
Checkpoint 22 extracted the search surface component.
Still
needed:

- Active-day controls extraction.
- Recent/saved strip.
- Smart suggestions drawer.
- More extraction from `mobile/app/(tabs)/route-builder.tsx`.

Keep route computation and Mapbox bridge logic outside the screen.

### 3. Planner / Copilot Next Pass

Checkpoint 11 cleaned the composer and copy. Still needed:

- Trip draft card.
- Route timeline preview.
- Mission Control mini brief.
- Staged ready/confirm actions.
- Cleaner built-route summary.
- Map Copilot confirmation card rewired to shared card components.

Avoid user-facing implementation terms such as AI, model, prompt, provider,
sandbox, debug, geocode, lat/lng, endpoint, payload, and schema.

### 4. Unified Mapbox Bridge

Create a shared interface so Planner, Route Builder, Copilot, search, POIs,
pins, and route context use one Mapbox-facing layer where practical.

Design goals:

- Natural place search and POI lookup.
- Route corridor context.
- Map pins and selected map state available to planning surfaces.
- Tile/style availability handled without user-facing technical wording.
- Short-lived cache for returning to the same map area.
- Safe fallbacks when Mapbox context is unavailable.

### 5. Library / Saved / Downloads

First Profile Library pass is done. Still needed:

- Library search and filters.
- Reusable item rows.
- Offline-state details.
- Update/delete flows.
- Possible later tab replacement: `Report` to `Saved` or `Library`, only after
  usage/flow review.

### 6. Report / Mission Control

First shared field-report composer slice is done. Still needed:

- Full Report tab redesign.
- Richer report/source integration in Mission Control.
- Device validation for report sheets and map interactions.

### 7. Explore

Control surface is done. Still needed:

- Detail polish.
- Source filtering once backend contract is stable.
- Stronger save/download actions.
- Partner/tour rails where fixture data exists.

### 8. Partner / Viator Readiness

First external-checkout readiness pass is done. Still needed:

- Typed provider states.
- Click/save analytics.
- Offline meeting-point preparation.
- Adapter cleanup.
- Graceful empty states.

### 9. Figma Design Workflow

Continue passing major screens through Figma and Playwright. The full
`Trailhead Outdoor Trip OS - 2026 Refresh` Figma structure is not complete yet.

Use references only for hierarchy, spacing, card layout, button placement,
bottom sheets, navigation, onboarding, saved/recent organization, planner
workflows, and assistant interaction patterns. Do not copy shipped screens.

### 10. Native QA / Release

Before the next push or OTA batch, run relevant validation:

```bash
cd mobile && npx tsc --noEmit
cd mobile && npm run audit:copy
cd mobile && npm run audit:routes
python3 -m py_compile dashboard/server.py
python3 -m py_compile dashboard/provider_registry.py
python3 -m unittest tests.test_viator_sourcepack
git diff --check
```

Native smoke tests still needed:

- iOS navigation-mode pan crash.
- Planner keyboard placement.
- Map layer sheet.
- Explore horizontal controls.
- Offline/download flows.

## Latest Release Record

Checkpoint 22 - Route Builder Search Surface Component:

- Code commit: `67dfd1c` (`Extract route builder search surface`), pushed
  to `master`.
- Production OTA update group:
  `88dcf02d-445c-489f-9080-5b91c39f168f`
- Preview OTA update group:
  `b36e8539-2ec6-4b14-b3e0-f30c394a404d`
- Runtime: `native-20260614-sdk54-1`.
- Audit doc:
  `docs/live-upgrade-checkpoint-22-route-builder-search-surface-audit.md`.

## Current Checkpoint Record

Checkpoint 22 - Route Builder Search Surface Component:

- Code commit: `67dfd1c` (`Extract route builder search surface`), pushed
  to `master`.
- Production OTA update group:
  `88dcf02d-445c-489f-9080-5b91c39f168f`
- Preview OTA update group:
  `b36e8539-2ec6-4b14-b3e0-f30c394a404d`
- Runtime: `native-20260614-sdk54-1`.
- Audit doc:
  `docs/live-upgrade-checkpoint-22-route-builder-search-surface-audit.md`.
- Figma evidence:
  `/tmp/trailhead-checkpoint-22-route-builder-search-surface-figma.png`
- Playwright evidence:
  `/tmp/trailhead-route-builder-checkpoint-22-search-box-web.png`
  `/tmp/trailhead-route-builder-checkpoint-22-search-result-row-web.png`

## Repo Note

Two filenames from the earlier instruction were not present at the exact paths
during the final scan:

- `docs/copilot-outdoor-commerce-upgrade-plan.md`
- `docs/trailhead-ui-template-research-and-upgrade-plan.md`

Next session should either restore/import them if PR #12 expected them, or
update the plan references so the repo audit trail is consistent.

## Recommended Next Checkpoint

**Checkpoint 23 - Route Builder Active Day Controls**

Extract active-day itinerary header, rest-day toggle, day-hour input, and
empty-day guidance into reusable components. Keep day mileage, rest-day state,
drive-hour targets, stop ordering, route computation, and footer dock behavior
unchanged; audit against Mobbin travel day editors, route-day controls, and
compact schedule panels plus the existing Figma checkpoint board before code.
