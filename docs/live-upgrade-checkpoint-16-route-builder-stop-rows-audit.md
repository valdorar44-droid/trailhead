# Live Upgrade Checkpoint 16 Audit: Route Builder Stop Rows

**Date:** 2026-06-25
**Commit target:** Route Builder active-day stop rows and leg actions extraction.

## Scope Completed

- Added `docs/design-decisions/route-builder-stop-rows.md` before
  implementation.
- Confirmed Mobbin MCP access and reviewed itinerary, route row, edit-route,
  and add-stop patterns:
  - Viator itinerary/timeline list:
    `https://mobbin.com/screens/7d351a4c-1707-494f-a580-80fdf1a881d8`
  - BlaBlaCar trip stop list:
    `https://mobbin.com/screens/1903ead2-ab32-44fc-abed-3e1f6b6e79d0`
  - BlaBlaCar route detail:
    `https://mobbin.com/screens/4b45e1ac-676e-4b91-b47b-8332402d0c4b`
  - Airbnb trip itinerary row:
    `https://mobbin.com/screens/7f73e378-793a-4583-8fbd-eef9e719ea8a`
  - Wanderlog itinerary:
    `https://mobbin.com/screens/9722f766-60c3-4fcd-a7c2-7dfd4ff28513`
  - Apple Maps route detail:
    `https://mobbin.com/screens/1347bc42-8168-4c3b-bc3b-5ae431e47877`
  - Citymapper route detail:
    `https://mobbin.com/screens/a9a7c3aa-1aa1-4081-86c1-cd1eb35b7a11`
  - My BMW editing-a-route flow:
    `https://mobbin.com/flows/321f9e71-4970-4dbc-a03c-1e2f5e56c677`
  - Google Maps adding-a-stop flow:
    `https://mobbin.com/flows/567ab5c5-b0c8-4b8d-bb3b-124a878d6cbe`
  - Wanderlog itinerary flow:
    `https://mobbin.com/flows/88a3eab3-6cca-496f-a3cb-bca2011df206`
- Confirmed user-provided Figma checkpoint board access:
  - File: Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`
  - Latest prior checkpoint frame: `19:2`
  - Checkpoint 16 frame: `20:2`
  - Screenshot reviewed locally:
    `/tmp/trailhead-checkpoint-16-route-builder-stop-rows.png`
- Added active-day stop row extraction:
  - `mobile/components/routeBuilder/RouteBuilderActiveDayStop.tsx`
- Added between-stop leg action extraction:
  - `mobile/components/routeBuilder/RouteBuilderLegActions.tsx`
- Removed the replaced stop-row and leg-action styles from
  `mobile/app/(tabs)/route-builder.tsx`.
- Cleaned visible Route Builder copy from "POIs" / "Points of Interest" to
  "places."

## Files Changed

- `docs/design-decisions/route-builder-stop-rows.md`
- `docs/live-upgrade-checkpoint-16-route-builder-stop-rows-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `mobile/app/(tabs)/route-builder.tsx`
- `mobile/components/routeBuilder/RouteBuilderActiveDayStop.tsx`
- `mobile/components/routeBuilder/RouteBuilderLegActions.tsx`

## Audit Notes

- No route computation, route geometry, saved trips, camp scoring, discovery
  query behavior, credits, subscription checks, or offline route readiness
  calculations were changed.
- `renderStopPreview`, `scanBetweenStops`, `moveStop`, `removeStop`,
  `replaceCampStop`, and `openCampDetail` stay in the screen and are passed as
  callbacks or render slots.
- `route-builder.tsx` is now 6,430 lines after this extraction.
- Figma design-system search did not return reusable itinerary row or route leg
  components, so this checkpoint stayed on Trailhead React Native tokens and
  components.
- Browser smoke used a temporary Route Builder handoff draft with Moab, Green
  River Fuel Stop, San Rafael Camp, and Big Sur stops. Route Builder consumed
  the draft as expected and the temporary browser storage value was cleared
  after the smoke test.

## Validation

- `cd mobile && npx tsc --noEmit`
  - passed.
- `cd mobile && npm run audit:copy`
  - passed.
- `cd mobile && npm run audit:routes`
  - passed 12 Route Builder audit cases.
- `cd mobile && node scripts/user-facing-copy-audit.mjs 'app/(tabs)/route-builder.tsx' components/routeBuilder/RouteBuilderActiveDayStop.tsx components/routeBuilder/RouteBuilderLegActions.tsx components/routeBuilder/RouteBuilderInsertNotice.tsx`
  - passed for 4 files.
- `git diff --check`
  - passed.
- Figma checkpoint:
  - Checkpoint 16 frame `20:2` rendered cleanly.
- Playwright web smoke:
  - Expo web served `http://localhost:8100/route-builder`.
  - Seeded temporary route-builder draft rendered active-day stop rows through
    `RouteBuilderActiveDayStop`.
  - Between-stop distance/fuel/action rows rendered through
    `RouteBuilderLegActions`.
  - Visible day labels showed "Day 1 Places," "Day 2 Places," and
    "Day 3 Places."
  - Browser console: 0 errors, 6 warnings from existing Expo/web output.
  - Screenshot reviewed locally:
    `/tmp/trailhead-route-builder-checkpoint-16-stop-rows-web.png`
  - Temporary draft storage was cleared and the Expo server was stopped.

## Release

- GitHub commit: pending.
- Production OTA: pending.
- Preview OTA: pending.

## Remaining Risks

- Native QA should smoke-test move up/down, remove, camp replacement, camp
  photo/detail, and between-stop fuel/camp/place actions after OTA.
- The route timeline day rows and footer dock still live in
  `route-builder.tsx`.
- Route Builder's wizard search and active route search remain separate flows
  until a later shared-search checkpoint.
