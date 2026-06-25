# Live Upgrade Checkpoint 10 Audit: Explore Control Surface

**Date:** 2026-06-25  
**Commit target:** Explore home control extraction and full category/status row wiring.

## Scope Completed

- Added `docs/design-decisions/explore-controls.md` before code changes.
- Created the Figma checkpoint frame:
  - File: Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`
  - Page: `Trailhead Checkpoint 10 - Explore Controls`
  - Root frame: `Trailhead Explore Controls - Checkpoint 10`
  - Node: `6:3`
- Added `ExploreHomeControls` to own the Explore mode, category, status, and
  sort controls.
- Wired the existing full `ExploreCategoryChips` row into the Explore feed.
- Wired `ExploreFilterRow` into the Explore feed with:
  - visible match count
  - `Official + community`
  - current sort label
- Moved sort cycling from the old standalone glyph into the status row.
- Made the `Near` category chip switch to nearby mode instead of behaving like
  an empty category.
- Kept Explore catalog loading, ranking, saved places, map actions, route
  actions, cached detail rails, and detail sheet behavior unchanged.

## Research Reviewed

- Current Explore implementation:
  - `mobile/app/(tabs)/guide.tsx`
  - `mobile/components/explore/*`
- Prior docs:
  - `docs/explore-ui-redesign/TRAILHEAD_EXPLORE_UI_REDESIGN_CODEX_DIRECTIONS.md`
  - `docs/phase-5-explore-audit.md`
  - `docs/profile-explore-campflare-followup-audit.md`
- Figma/Mobbin copy:
  - `Home on Wanderlog (iOS)` node `1:2`
  - Extracted pattern: visual entry first, then a clear browse/control strip
    before feed cards.
- Figma libraries:
  - Material 3, Figma Simple Design System, and iOS kit were available in the
    file; no Trailhead-specific component library entries were returned by MCP
    search.
- Nucleus UI Lite:
  - Provided node opened to accordion documentation. It was not used as an
    Explore layout source.

## Validation

- `cd mobile && npx tsc --noEmit`
- `cd mobile && npm run audit:copy`
- `cd mobile && npm run audit:routes`
- `git diff --check`
- Figma screenshot inspected:
  - `/tmp/trailhead-checkpoint-10-figma.png`
- Playwright web pass:
  - opened `http://localhost:8091/guide`
  - continued through Welcome Gate
  - confirmed full category rail, match count, source label, and sort row
  - clicked sort from `Best match` to `Nearest`
  - clicked `Near` chip and confirmed it switched mode without route failure
  - captured `mobile/output/playwright/checkpoint-10-explore-controls.png`

## Known Noise

- Expo web showed existing warnings for deprecated web shadow/text shadow props,
  `expo-av`, and push-token listener support on web.
- Browser console showed existing unauthenticated `analytics/event` 400
  responses. No new render or interaction error was observed from this change.

## Residual Risk

- The row is horizontally dense on web and expected to be horizontally scrollable
  on mobile. Playwright verified the web surface; native device visual QA should
  still be done during the next TestFlight pass.
- The source pill is informational only. A real source filter should wait for a
  stable catalog filter contract.

## Decision

Checkpoint 10 is complete. Explore has a production control surface that matches
the master plan without changing data contracts or adding temporary UI.
