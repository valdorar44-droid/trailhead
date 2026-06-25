# Live Upgrade Checkpoint 22 Audit: Route Builder Search Surface Component

**Date:** 2026-06-25
**Commit target:** Route Builder search surface component extraction.

## Scope Planned

- Add `docs/design-decisions/route-builder-search-surface-component.md` before
  implementation.
- Review Mobbin route/destination picker, travel add-place, and add-stop
  references.
- Search the user-provided Figma board for reusable mobile route-search
  components before coding.
- Extract Route Builder stop-type chips, insert notice placement, search box,
  and search result rows from `mobile/app/(tabs)/route-builder.tsx` into a
  focused presentational component.
- Keep Checkpoint 21 search helper behavior, provider calls, Android lookup
  fallback, saved geometry, route computation, and selected-place mapping
  unchanged.
- Keep result selection callbacks screen-owned.

## Research Reviewed

- Mobbin:
  - `https://mobbin.com/screens/c97d9e5d-774c-4fc0-9b3b-79e62febb9a9`
  - `https://mobbin.com/screens/b9e0cc11-d7c1-4ed6-bf4f-029edf2ed948`
  - `https://mobbin.com/flows/23c441df-12a9-46ab-a60e-19b43fcc65dd`
  - `https://mobbin.com/flows/567ab5c5-b0c8-4b8d-bb3b-124a878d6cbe`
- Figma:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile route planner search field segmented chips result rows add stop destination picker`.
  - No matching reusable design-system component was returned.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble were checked for
    mobile route-planner search/add-stop patterns. Results were broad and did
    not change the implementation plan.

## Implementation Notes

- Added `mobile/components/routeBuilder/RouteBuilderSearchSurface.tsx`.
- Moved stop-type chips, insert guidance placement, search input, search action,
  and search result rows out of `mobile/app/(tabs)/route-builder.tsx`.
- Kept query state, result state, provider calls, Android fallback, and
  selected-place insertion callbacks screen-owned.
- Reused `RouteBuilderInsertNotice` inside the new component instead of
  rewriting its behavior.
- Moved result rows directly under the search box so candidates stay attached
  to the query that produced them.
- Removed old search/type/result styles from `route-builder.tsx`.

## Files Changed

- `mobile/app/(tabs)/route-builder.tsx`: 6203 lines after extraction.
- `mobile/components/routeBuilder/RouteBuilderSearchSurface.tsx`: 201 lines.
- `docs/design-decisions/route-builder-search-surface-component.md`
- `docs/live-upgrade-checkpoint-22-route-builder-search-surface-audit.md`

## Figma Evidence

- Figma auth was available through `whoami`.
- Added frame `31:2`, `Checkpoint 22 - Route Builder Search Surface Component`,
  to file `yP342OKFtUQ1J0RCwnzH6s`.
- Figma screenshot:
  `/tmp/trailhead-checkpoint-22-route-builder-search-surface-figma.png`

## Playwright Evidence

- Started Expo web on port `8100`.
- Marked the welcome gate as seen in browser storage.
- Seeded a valid Route Builder draft through
  `trailhead_copilot_route_builder_draft_v1`.
- Opened `/route-builder`, verified the active editor rendered, searched
  coordinates through the extracted search surface, and confirmed the result row
  rendered directly below the search box with `0` browser console errors in the
  final smoke state.
- Viewport screenshot:
  `/tmp/trailhead-route-builder-checkpoint-22-search-surface-web.png`
- Search box element screenshot:
  `/tmp/trailhead-route-builder-checkpoint-22-search-box-web.png`
- Result row element screenshot:
  `/tmp/trailhead-route-builder-checkpoint-22-search-result-row-web.png`

## Validation

- `cd mobile && npx tsc --noEmit`
- `cd mobile && node scripts/user-facing-copy-audit.mjs "app/(tabs)/route-builder.tsx" components/routeBuilder/RouteBuilderSearchSurface.tsx`
- `cd mobile && npm run audit:copy`
- `cd mobile && npm run audit:routes`
- `git diff --check`
- Result: passed.

## Release

- Pending OTA.

## Remaining Risks

- The full viewport screenshot still shows the fixed footer dock near the lower
  edge at some scroll positions; element screenshots were used to verify the
  search box and result row without the dock overlay.
- Next route-builder extraction should continue reducing timeline and active-day
  control markup before deeper search/Mapbox bridge work.
