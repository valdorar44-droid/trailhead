# Live Upgrade Checkpoint 20 Audit: Route Builder Route Fit Cards

**Date:** 2026-06-25
**Commit target:** Route Builder route-fit card extraction.

## Scope Completed

- Add `docs/design-decisions/route-builder-route-fit-cards.md` before
  implementation.
- Review Mobbin travel/planner trip-status and saved-trip references.
- Search the user-provided Figma board and Nucleus file for reusable status
  card/list patterns before coding.
- Extract Route Builder route-fit/readiness assembly from
  `mobile/app/(tabs)/route-builder.tsx` into a typed route-builder helper.
- Keep route computation, fuel estimate formatting, offline readiness, saved
  geometry, Mapbox handoff, and current user-facing behavior unchanged.
- Split readiness card row rendering into small presentational rows while
  preserving the existing card API for the screen.

## Files Changed

- `mobile/lib/routeBuilder/routeFit.ts`
  - 86 lines.
- `mobile/lib/routeBuilder/index.ts`
  - exports the new route-fit helper.
- `mobile/components/routeBuilder/RouteBuilderReadinessCard.tsx`
  - 204 lines after row/pill split.
- `mobile/app/(tabs)/route-builder.tsx`
  - 6,299 lines after extraction.
- `docs/design-decisions/route-builder-route-fit-cards.md`
- `docs/live-upgrade-checkpoint-20-route-builder-route-fit-cards-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `docs/live-upgrade-refresh-handoff.md`

## Research Reviewed

- Mobbin:
  - `https://mobbin.com/screens/f496facd-5f9c-400b-ad8a-87bfb0659fa7`
  - `https://mobbin.com/screens/0446e033-81a1-4329-95a2-628bc25dc081`
  - `https://mobbin.com/flows/609c277f-7cba-45a8-83c3-9e26d0a921bc`
  - `https://mobbin.com/flows/ae67a9e6-0fb9-4528-8b23-2b3730126bab`
- Figma:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `route readiness checklist card status pill offline download trip planner`.
  - Nucleus file `O8XRegvq3i6WljYoJ3M72g`, search term:
    `status checklist card list item badge alert success trip planner mobile`.
  - No exact reusable design-system component was returned.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble were checked for
    mobile travel planner / itinerary / checklist patterns. Results were broad
    and not stronger than the Mobbin references for this narrow extraction.

## Implementation Notes

- Added `buildRouteFitCards` as a pure route-builder helper.
- Moved route-fit assembly for route, fuel, schedule, and offline rows out of
  `route-builder.tsx`.
- Kept fuel estimate copy formatting in the screen, matching the prior behavior
  and avoiding unit/currency logic inside the helper.
- Kept `RouteBuilderReadinessCard`'s public `checks` prop so the screen call
  site stays stable.
- Split `RouteBuilderReadinessCard` internals into `RouteBuilderRouteFitRow`
  and `OfflineReadinessPill`.
- Set touched row/badge letter spacing to `0` while preserving the component's
  existing density and hierarchy.

## Validation

- `cd mobile && npx tsc --noEmit`
  - passed.
- `cd mobile && npm run audit:copy`
  - passed.
- `cd mobile && npm run audit:routes`
  - passed 12 route-builder cases.
- `cd mobile && node scripts/user-facing-copy-audit.mjs "app/(tabs)/route-builder.tsx" components/routeBuilder/RouteBuilderReadinessCard.tsx lib/routeBuilder/routeFit.ts`
  - passed.
- `git diff --check`
  - passed.
- Route-fit helper scan:
  - passed; no `routeChecks` assembly remains in `route-builder.tsx`.
- Figma checkpoint:
  - frame `29:2` in file `yP342OKFtUQ1J0RCwnzH6s`.
  - screenshot saved to
    `/tmp/trailhead-checkpoint-20-route-builder-route-fit-cards.png`.
- Playwright web smoke:
  - passed on Expo web at `http://localhost:8100/route-builder`.
  - seeded a Moab to Big Sur route-builder draft and confirmed the readiness
    card rendered route, camp, fuel, schedule, offline, and offline-row pills.
  - confirmed the browser console had 0 errors for the final route-builder
    capture.
  - screenshot saved to
    `/tmp/trailhead-route-builder-checkpoint-20-route-fit-cards-web.png`.

## Release

- Pending code commit and OTA.

## Remaining Risks

- Native iOS/Android QA should still verify the readiness card in the real
  route-builder sheet because this checkpoint used Expo web for visual smoke.
- The route-builder screen still owns search/geocode result handling and draft
  import orchestration; those should be extracted in later checkpoints.
