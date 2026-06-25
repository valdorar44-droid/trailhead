# Live Upgrade Checkpoint 21 Audit: Route Builder Search Flow Extraction

**Date:** 2026-06-25
**Commit target:** Route Builder search flow helper extraction.

## Scope Planned

- Add `docs/design-decisions/route-builder-search-flow-extraction.md` before
  implementation.
- Review Mobbin route/destination picker and travel add-place references.
- Search the user-provided Figma board for mobile travel search result and
  add-stop patterns before coding.
- Extract Route Builder offline search scoring, result dedupe, lookup
  orchestration, and selected-place to route-stop mapping from
  `mobile/app/(tabs)/route-builder.tsx` into a typed helper.
- Keep provider calls, Android lookup fallback, saved geometry, route
  calculations, offline search behavior, and map handoff behavior unchanged.
- Keep the current visible search UI in place for this checkpoint.

## Research Reviewed

- Mobbin:
  - `https://mobbin.com/screens/185a43b9-6710-4e23-8296-1e50a7db7401`
  - `https://mobbin.com/screens/4536f9d8-85c6-4d23-a04a-82a858fe7c47`
  - `https://mobbin.com/flows/609c277f-7cba-45a8-83c3-9e26d0a921bc`
  - `https://mobbin.com/flows/23c441df-12a9-46ab-a60e-19b43fcc65dd`
- Figma:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile travel search results add stop destination picker route planner result row`.
  - No exact reusable design-system component was returned.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble were checked for
    mobile travel planner / itinerary search result patterns. Results were
    broad and not stronger than the Mobbin references for this narrow helper
    extraction.

## Implementation Notes

- Added `mobile/lib/routeBuilder/searchFlow.ts`.
- Exported the search helper through `mobile/lib/routeBuilder/index.ts`.
- Replaced the inline Route Builder search scoring and result dedupe with
  `resolveRouteBuilderSearchResults`.
- Replaced inline selected-place stop construction with
  `buildRouteBuilderSearchStop`.
- Kept the screen-owned live lookup call, Android fallback path, route math,
  saved geometry, camp scoring, and map handoff behavior unchanged.
- Kept the visible Route Builder search UI in place for this checkpoint.

## Files Changed

- `mobile/app/(tabs)/route-builder.tsx`: 6246 lines after extraction.
- `mobile/lib/routeBuilder/searchFlow.ts`: 132 lines.
- `mobile/lib/routeBuilder/index.ts`
- `docs/design-decisions/route-builder-search-flow-extraction.md`
- `docs/live-upgrade-checkpoint-21-route-builder-search-flow-audit.md`

## Figma Evidence

- Read the user-provided Mobbin copy board metadata in file
  `yP342OKFtUQ1J0RCwnzH6s`.
- Confirmed existing checkpoint frames through Checkpoint 20 on `Page 1`.
- Attempted to create a Checkpoint 21 frame beside Checkpoint 20 with
  `use_figma`, but the Figma write call returned `Auth required`.
- No Figma nodes were changed by the failed write call.
- Proceeded with repository docs and Playwright evidence rather than blocking
  the production checkpoint on Figma write auth.

## Playwright Evidence

- Started Expo web on port `8100`.
- Marked the welcome gate as seen in the browser storage for the smoke context.
- Seeded a valid Route Builder draft through
  `trailhead_copilot_route_builder_draft_v1`.
- Opened `/route-builder`, verified the active Route Builder editor rendered,
  searched coordinates through the visible search box, saw the result row, and
  selected a result into the route stop list.
- Final result-list screenshot:
  `/tmp/trailhead-route-builder-checkpoint-21-search-results-web.png`
- Final selected-stop screenshot:
  `/tmp/trailhead-route-builder-checkpoint-21-search-flow-web.png`
- Final smoke state had `0` browser console errors.

## Validation

- `cd mobile && npx tsc --noEmit`
- `cd mobile && npm run audit:copy`
- `cd mobile && npm run audit:routes`
- `cd mobile && node scripts/user-facing-copy-audit.mjs "app/(tabs)/route-builder.tsx" lib/routeBuilder/searchFlow.ts`
- `git diff --check`
- Result: passed.

## Release

- Code commit: `3bf477c` (`Extract route builder search flow helper`), pushed
  to `master`.
- Production OTA update group:
  `846b67d8-64af-40b3-9bf6-a2b0ef3587fe`
- Preview OTA update group:
  `bb64e724-0998-424c-b81e-4388fa793f28`
- Runtime: `native-20260614-sdk54-1`.

## Remaining Risks

- Figma checkpoint frame still needs a follow-up write after Figma MCP auth is
  refreshed.
- The next Route Builder slice should extract the search surface itself into a
  presentational component while preserving the helper and provider boundary.
