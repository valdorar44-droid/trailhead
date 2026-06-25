# Live Upgrade Checkpoint 14 Audit: Route Builder Workspace Extraction

**Date:** 2026-06-25
**Commit target:** active Route Builder workspace summary/readiness extraction.

## Scope Completed

- Added `docs/design-decisions/route-builder-workspace-extraction.md` before
  implementation.
- Confirmed Mobbin MCP access and reviewed route/navigation workspace patterns:
  - Transit route options:
    `https://mobbin.com/screens/84d6aa6d-985d-437e-82fb-05ffed61557a`
  - komoot route edit:
    `https://mobbin.com/screens/99150e4d-02e8-4d95-835c-d80bbdec4fa7`
  - komoot route detail/offline status:
    `https://mobbin.com/screens/34f4c989-7e74-48cd-806d-a7b309b98c67`
  - AllTrails custom route detail:
    `https://mobbin.com/screens/1cf38e7f-1d2e-403f-84aa-5d35738dfaaf`
- Confirmed Figma auth under the user's Pro team account.
- Confirmed user-provided Figma board access:
  - Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`
  - Nucleus UI Lite `O8XRegvq3i6WljYoJ3M72g`
  - Untitled UI styles `a07B9pTYDR4VXVPNkI7RnW`
  - Untitled UI variables `dAxE1C8nCXtC165yyf5HR3`
- Added a Figma checkpoint frame:
  - File: Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`
  - Frame: `Checkpoint 14 - Route Builder Workspace Extraction`
  - Node: `18:2`
  - Screenshot reviewed locally:
    `/tmp/trailhead-checkpoint-14-route-builder-workspace.png`
- Extracted active workspace summary into:
  - `mobile/components/routeBuilder/RouteBuilderWorkspaceSummary.tsx`
- Extracted active trip-readiness rendering into:
  - `mobile/components/routeBuilder/RouteBuilderReadinessCard.tsx`
- Removed the matching screen-local workspace/readiness styles from
  `mobile/app/(tabs)/route-builder.tsx`.

## Files Changed

- `docs/design-decisions/route-builder-workspace-extraction.md`
- `docs/live-upgrade-checkpoint-14-route-builder-workspace-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `docs/live-upgrade-refresh-handoff.md`
- `mobile/app/(tabs)/route-builder.tsx`
- `mobile/components/routeBuilder/RouteBuilderReadinessCard.tsx`
- `mobile/components/routeBuilder/RouteBuilderWorkspaceSummary.tsx`

## Audit Notes

- No route computation, Mapbox bridge calls, saved route geometry, camp scoring,
  API payloads, credits, subscription checks, or offline readiness calculations
  were changed.
- `route-builder.tsx` is now 6,500 lines.
- The extracted components are presentational and receive already-computed
  production data from the screen.
- Figma design-system search did not return reusable card/status/bottom-sheet
  assets for this board, so this checkpoint stayed on Trailhead's existing
  React Native tokens and components.
- The next route-builder extraction should target timeline actions and insert
  guidance before the stop-row/leg-action split.

## Validation

- `cd mobile && npx tsc --noEmit`
  - passed.
- `cd mobile && node scripts/user-facing-copy-audit.mjs 'app/(tabs)/route-builder.tsx'`
  - passed.
- `cd mobile && npm run audit:copy`
  - passed.
- `cd mobile && npm run audit:routes`
  - passed 12 Route Builder audit cases.
- `git diff --check`
  - passed.
- Playwright web smoke:
  - Expo web served on `http://localhost:8098`.
  - Route Builder hub rendered after dismissing the welcome gate.
  - Seeded a temporary local browser draft with two route stops to exercise the
    active workspace without external route/search calls.
  - Active workspace summary rendered with the extracted
    `RouteBuilderWorkspaceSummary`.
  - Trip readiness rendered with the extracted `RouteBuilderReadinessCard`.
  - Screenshots saved at:
    - `/tmp/trailhead-route-builder-checkpoint-14-web.png`
    - `/tmp/trailhead-route-builder-checkpoint-14-workspace-web.png`
    - `/tmp/trailhead-route-builder-checkpoint-14-readiness-web.png`
  - Temporary browser draft was cleared after capture.
  - No browser console errors were present after the workspace reload; warnings
    were non-blocking Expo/web warnings.

## Remaining Risks

- Needs native visual smoke for the active Route Builder workspace after
  extraction.
- Timeline stop rows, leg action rows, insert notice, and footer dock still live
  in `route-builder.tsx`.
- Native iOS navigation testing should continue to guide the next Mapbox/map
  changes.
