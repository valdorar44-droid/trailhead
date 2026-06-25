# Live Upgrade Checkpoint 23 Audit: Route Builder Active Day Controls

**Date:** 2026-06-25
**Commit target:** Route Builder active-day control extraction.

## Scope Planned

- Add `docs/design-decisions/route-builder-active-day-controls.md` before
  implementation.
- Review Mobbin itinerary day editor and travel day-control references.
- Search the user-provided Figma board for reusable itinerary day controls
  before coding.
- Extract active-day itinerary header, rest-day toggle, max-hours input, and
  empty-day guidance from `mobile/app/(tabs)/route-builder.tsx`.
- Keep day mileage, rest-day state, drive-hour target updates, stop ordering,
  route computation, search behavior, and footer dock behavior unchanged.

## Research Reviewed

- Mobbin:
  - `https://mobbin.com/screens/1c192050-3980-4c8b-b4c7-fcad6d5a2ed0`
  - `https://mobbin.com/screens/1a878c89-0de4-4b2c-a99b-1520b65e2da4`
  - `https://mobbin.com/flows/88a3eab3-6cca-496f-a3cb-bca2011df206`
  - `https://mobbin.com/flows/1e4d7c7f-4909-4106-9b92-4f8b7cef117a`
- Figma:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile itinerary day editor rest day toggle schedule controls compact input empty day state`.
  - No matching reusable design-system component was returned.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches were broad
    and did not change the implementation plan.

## Implementation Notes

- Added
  `mobile/components/routeBuilder/RouteBuilderActiveDayControls.tsx`.
- Extracted the active-day itinerary header, rest-day toggle, max-hours input,
  and empty-day guidance into reusable components.
- Updated `mobile/app/(tabs)/route-builder.tsx` to pass existing state and
  callbacks into the new component:
  - `activeDay`
  - day mileage / estimated-hours meta
  - `restDays.includes(activeDay)`
  - `dayDriveTargets[activeDay] ?? driveHoursPerDay`
  - `toggleRestDay(activeDay)`
  - `setDayDriveTargets(...)`
- Removed the now-unused inline style entries for the active-day header,
  control row, rest-day toggle, day-hour box, and empty-day card.
- Preserved route math, stop ordering, route fit cards, footer dock behavior,
  search behavior, and saved geometry handoff.

## Files Changed

- `mobile/app/(tabs)/route-builder.tsx`: 6171 lines after extraction.
- `mobile/components/routeBuilder/RouteBuilderActiveDayControls.tsx`: 181
  lines.
- `docs/design-decisions/route-builder-active-day-controls.md`
- `docs/live-upgrade-checkpoint-23-route-builder-active-day-controls-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `docs/live-upgrade-refresh-handoff.md`

## Figma Evidence

- File: `yP342OKFtUQ1J0RCwnzH6s`
- Frame: `32:2`,
  `Checkpoint 23 - Route Builder Active Day Controls`
- Screenshot:
  `/tmp/trailhead-checkpoint-23-route-builder-active-day-controls-figma.png`

## Playwright Evidence

- Local Expo web route: `http://127.0.0.1:8100/route-builder`
- Seeded a two-day Moab to Big Sur draft through
  `trailhead_copilot_route_builder_draft_v1`.
- Verified the active-day control renders with max-hours input and no current
  browser console errors.
- Screenshot:
  `/tmp/trailhead-route-builder-checkpoint-23-active-day-controls-web.png`

## Validation

- `cd mobile && npx tsc --noEmit` passed.
- `cd mobile && npm run audit:copy` passed.
- `cd mobile && npm run audit:routes` passed 12 cases.
- `cd mobile && node scripts/user-facing-copy-audit.mjs "app/(tabs)/route-builder.tsx" components/routeBuilder/RouteBuilderActiveDayControls.tsx`
  passed.
- `git diff --check` passed.

## Release

- Pending commit, push, and OTA.
