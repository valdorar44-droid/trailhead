# Live Upgrade Checkpoint 24 Audit: Route Builder Active Day Stop List

**Date:** 2026-06-25
**Commit target:** Route Builder active-day stop-list extraction.

## Scope Planned

- Add `docs/design-decisions/route-builder-active-day-stop-list.md` before
  implementation.
- Review Mobbin itinerary stop-list and reordering references.
- Search the user-provided Figma board for reusable itinerary stop-list
  components before coding.
- Extract active-day stop-list composition and leg-action wiring from
  `mobile/app/(tabs)/route-builder.tsx`.
- Keep stop ordering, insert-after selection, camp detail/swap callbacks,
  move/remove actions, leg fuel/camp/place scans, route computation, and footer
  dock behavior unchanged.

## Research Reviewed

- Mobbin:
  - `https://mobbin.com/screens/9722f766-60c3-4fcd-a7c2-7dfd4ff28513`
  - `https://mobbin.com/screens/39f48c99-a1ad-424a-b137-957cc0bc9f33`
  - `https://mobbin.com/screens/97bf2bc3-e5fc-4b30-ab03-29b6245ffe1c`
  - `https://mobbin.com/flows/88a3eab3-6cca-496f-a3cb-bca2011df206`
  - `https://mobbin.com/flows/7fee33b5-751b-425f-9848-208f6abe56ed`
- Figma:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile itinerary stop list route leg actions ordered stops day editor component`.
  - No matching reusable stop-list component, variables, or styles were
    returned.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches were broad
    and did not change the implementation plan.

## Implementation Notes

- Added
  `mobile/components/routeBuilder/RouteBuilderActiveDayStopList.tsx`.
- Extracted active-day stop-list composition into a generic reusable component
  that owns:
  - stop row rendering through `RouteBuilderActiveDayStop`
  - leg-action rendering through `RouteBuilderLegActions`
  - selected insert-after metadata
  - move/remove action binding
  - fuel/camp/place leg-action binding
- Kept route-specific behavior injected from
  `mobile/app/(tabs)/route-builder.tsx`:
  - distance and duration labels
  - leg measurement
  - fuel label calculation
  - stop labels and source labels
  - stop preview rendering
  - insert selection
  - camp detail and replacement callbacks
  - route discovery scans
- Removed direct `RouteBuilderActiveDayStop` and `RouteBuilderLegActions`
  composition from the screen.

## Files Changed

- `mobile/app/(tabs)/route-builder.tsx`: 6162 lines after extraction.
- `mobile/components/routeBuilder/RouteBuilderActiveDayStopList.tsx`: 93
  lines.
- `docs/design-decisions/route-builder-active-day-stop-list.md`
- `docs/live-upgrade-checkpoint-24-route-builder-active-day-stop-list-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`

## Figma Evidence

- File: `yP342OKFtUQ1J0RCwnzH6s`
- Frame: `33:2`,
  `Checkpoint 24 - Route Builder Active Day Stop List`
- Screenshot:
  `/tmp/trailhead-checkpoint-24-route-builder-active-day-stop-list-figma.png`

## Playwright Evidence

- Local Expo web route: `http://127.0.0.1:8100/route-builder`
- Seeded a two-day Moab to Big Sur draft through
  `trailhead_copilot_route_builder_draft_v1`.
- Verified the active-day stop-list block renders stop row, preview, leg
  summary, and fuel/camp/place actions with no current browser console errors.
- Screenshot:
  `/tmp/trailhead-route-builder-checkpoint-24-active-day-stop-list-web.png`

## Validation

- `cd mobile && npx tsc --noEmit` passed.
- `cd mobile && npm run audit:copy` passed.
- `cd mobile && npm run audit:routes` passed 12 cases.
- `cd mobile && node scripts/user-facing-copy-audit.mjs "app/(tabs)/route-builder.tsx" components/routeBuilder/RouteBuilderActiveDayStopList.tsx`
  passed.
- `git diff --check` passed.

## Release

- Code commit: `cf31f80` (`Extract route builder active day stop list`),
  pushed to `master`.
- Production OTA update group:
  `9f937769-fe5a-4642-9df9-19aedea9f2ca`
- Preview OTA update group:
  `55a49eea-e55e-4578-a7d3-975278c6bfbe`
- Runtime: `native-20260614-sdk54-1`.
