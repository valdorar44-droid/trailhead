# Live Upgrade Stage A Audit

**Date:** 2026-06-25  
**Checkpoint:** 1 - Spec Import + Stage A Audit

## Spec Status

- PR #12 was imported as documentation only:
  - `docs/codex-master-live-app-upgrade-plan.md`
  - `docs/reference/trailhead-ui-reference-board.json`
- The reference manifest example in the master plan was aligned with the JSON
  contract: `target_surfaces` is an array and `source_type` uses the board
  taxonomy.
- These requested docs were not present on current master or in PR #12:
  - `docs/copilot-outdoor-commerce-upgrade-plan.md`
  - `docs/trailhead-ui-template-research-and-upgrade-plan.md`

## Current Repo Findings

- `mobile/app/(tabs)/map.tsx` is still the largest risk area, around 26k lines.
- `mobile/app/(tabs)/route-builder.tsx` remains large, around 6.8k lines.
- `mobile/app/_layout.tsx` still auto-shows `WelcomeOnboardingModal` on first
  open after a 900 ms delay.
- `TrailheadLaunchLoader` already uses the desired dark route/topo visual
  language and should be refined instead of replaced.
- Current tabs remain `PLAN`, `MAP`, `ROUTE`, `REPORT`, `EXPLORE`, `PROFILE`.
- Map mode/legend work is partially present through `MapModeGallery`,
  `MapLegendSheet`, and `mobile/lib/mapLegend.ts`.
- Mapbox search/context is already wired through map/planner surfaces, but some
  visible copy still exposes technical source names that need cleanup later.

## Research Reviewed

- Mobbin authenticated session was established and saved to
  `/home/sean/.cache/trailhead-mobbin-playwright-state.json`.
- Travel onboarding patterns reviewed:
  - Airalo: brand splash, concise value screen, account CTA plus browse path.
  - Booking.com: strong brand splash, but long compliance/onboarding sequence
    that Trailhead should not force.
- Figma access was confirmed for Untitled UI styles, Untitled UI variables,
  Nucleus UI Lite, and the imported Nucleus `.fig` copy.
- Nucleus Lite is useful as reference, but much of the editable depth is locked
  behind Pro previews.

## Checkpoint Decision

Proceed to Checkpoint 2 with a Welcome Gate implementation. The gate should
reuse Trailhead identity, avoid a forced carousel, and preserve app access for
signed-out users.

## Validation

- This checkpoint is docs/import only.
- Code validation will run after Checkpoint 2 changes app behavior.
