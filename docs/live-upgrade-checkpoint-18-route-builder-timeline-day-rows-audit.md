# Live Upgrade Checkpoint 18 Audit: Route Builder Timeline Day Rows

**Date:** 2026-06-25
**Commit target:** Route Builder timeline day-card extraction.

## Scope Completed

- Add `docs/design-decisions/route-builder-timeline-day-rows.md` before
  implementation.
- Review Mobbin itinerary, route timeline, and travel planning references.
- Search the user-provided Figma board and subscribed libraries for reusable
  itinerary day-card components before coding.
- Extract the route day timeline card from
  `mobile/app/(tabs)/route-builder.tsx`.
- Keep route day planning, status calculation, discovery scans, camp preview
  rendering, inline discovery results, saved geometry, route saving, and
  readiness calculations unchanged.
- Add `RouteBuilderTimelineDayCard` as a typed presentational component and
  wire it from the existing route timeline loop.
- Remove stale inline route-day styles from `route-builder.tsx`.

## Files Changed

- `mobile/components/routeBuilder/RouteBuilderTimelineDayCard.tsx`
  - 258 lines.
- `mobile/app/(tabs)/route-builder.tsx`
  - 6,348 lines after extraction.
- `docs/design-decisions/route-builder-timeline-day-rows.md`
- `docs/live-upgrade-checkpoint-18-route-builder-timeline-day-rows-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`

## Research Reviewed

- Mobbin route/travel/timeline screens:
  - `https://mobbin.com/screens/2f8733ed-e350-42fb-860d-19ba73863526`
  - `https://mobbin.com/screens/0fc9803a-fc66-4844-87f7-69ab873b748e`
  - `https://mobbin.com/screens/767217bc-b0c5-48a7-a959-abd598bb8ced`
  - `https://mobbin.com/screens/1903ead2-ab32-44fc-abed-3e1f6b6e79d0`
  - `https://mobbin.com/screens/35b3e73d-4ca8-467e-af9d-f586e01f1d0d`
  - `https://mobbin.com/screens/56fe42c4-2c39-4007-bc21-0418082478f3`
  - `https://mobbin.com/screens/87476cc5-50b2-4e95-a9c7-db765c5d9b25`
  - `https://mobbin.com/screens/be9c7323-d039-4171-8e8e-312b9f3216d5`
  - `https://mobbin.com/screens/4e015b05-c82e-49bd-bcb6-afaaa90c7afd`
- Figma board `yP342OKFtUQ1J0RCwnzH6s`:
  - Search terms: itinerary day card, route timeline, status badge, action
    rail, list item timeline card.
  - No exact reusable component was returned from Trailhead context or
    subscribed libraries.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble were checked for
    mobile itinerary/timeline day-card patterns.

## Validation

- `cd mobile && npx tsc --noEmit`
  - passed.
- `cd mobile && npm run audit:copy`
  - passed.
- `cd mobile && npm run audit:routes`
  - passed 12 route-builder cases.
- `cd mobile && node scripts/user-facing-copy-audit.mjs "app/(tabs)/route-builder.tsx" components/routeBuilder/RouteBuilderTimelineDayCard.tsx`
  - passed.
- `git diff --check`
  - passed.
- Stale route-day style reference scan
  - passed; only the new component import/usage remains.
- Figma checkpoint:
  - frame `23:2` in file `yP342OKFtUQ1J0RCwnzH6s`.
  - screenshot saved to
    `/tmp/trailhead-checkpoint-18-route-builder-timeline-day-rows.png`.
- Playwright web smoke:
  - passed on Expo web at `http://localhost:8100/route-builder`.
  - seeded a 3-day Moab to Big Sur draft, confirmed Day 1/2/3 camp/place
    rows and camp/fuel/places/side-trip actions render with zero page console
    errors after the final reload.
  - screenshot saved to
    `/tmp/trailhead-route-builder-checkpoint-18-timeline-day-rows-web.png`.

## Release

- GitHub commit: `3938aff` (`Extract route builder timeline day rows`), pushed
  to `master`.
- Production OTA update group:
  `21ff72c3-a030-4e74-ac95-346cbfb09322`
- Preview OTA update group:
  `7099756b-4036-4f3b-8561-c2b67f235263`
- Runtime: `native-20260614-sdk54-1`.

## Remaining Risks

- Native QA should confirm long day titles, status text, and action rails fit on
  small iPhone and Android widths.
- The existing fixed footer dock can cover lower route-builder content near the
  bottom of the phone viewport; keep the bottom padding/content clearance pass
  in a later layout checkpoint.
- Inline discovery result extraction remains separate and should be audited in a
  later checkpoint.
