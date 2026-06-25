# Live Upgrade Checkpoint 13 Audit: Route Builder Deeper Redesign

**Date:** 2026-06-25
**Commit target:** first Route Builder component extraction and visible copy
cleanup.

## Scope Completed

- Added `docs/design-decisions/route-builder-deeper-redesign.md` before
  implementation.
- Added a Figma checkpoint frame:
  - File: Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`
  - Frame: `Checkpoint 13 - Route Builder Redesign`
  - Node: `17:2`
  - Screenshot reviewed locally:
    `/tmp/trailhead-checkpoint-13-route-builder.png`
- Extracted the Route Builder hub into:
  - `mobile/components/routeBuilder/RouteBuilderHub.tsx`
- Kept behavior in `mobile/app/(tabs)/route-builder.tsx`:
  - route state and callbacks stay in the screen
  - saved route loading stays in the screen
  - active route shortcut stays wired through the existing router call
  - saved trail open/delete behavior stays unchanged
- Cleaned visible Route Builder copy:
  - removed `Provider` fallback text from camp review cards
  - replaced overnight `endpoint` wording with route-stop wording
  - replaced raw search-result coordinate display with `Map result`
  - replaced setup/search references to coordinates with `map point`
  - removed older Explorer/paywall phrasing from Route Builder campsite detail
    locks

## Research Reviewed

- Mobbin route/travel screens from Wanderlog, Google Maps, Pangea, Trip.com,
  Vrbo, Gojek, Uber, and My BMW.
- Mobbin flows:
  - Wanderlog saving a location
  - Tripadvisor creating an itinerary
  - Pangea adding a spot to a trip
  - Wanderlog adding a place
- User-provided Figma files:
  - Mobbin copy board with Wanderlog references
  - Sublima Mobile App PRO
  - Nucleus UI Lite
- Current Trailhead implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteWizardProgressHeader.tsx`
  - `mobile/lib/routeBuilder/*`

## Files Changed

- `docs/design-decisions/route-builder-deeper-redesign.md`
- `docs/live-upgrade-checkpoint-13-route-builder-audit.md`
- `mobile/app/(tabs)/route-builder.tsx`
- `mobile/components/routeBuilder/RouteBuilderHub.tsx`

## Audit Notes

- No route computation, Mapbox bridge calls, saved route geometry, camp scoring,
  API payloads, credits, or subscription checks were changed.
- This is the first extraction slice only. The active route timeline, readiness
  card, insert notice, and footer dock still need deeper component extraction.
- `route-builder.tsx` is smaller but still oversized; the next slice should
  extract active workspace sections rather than adding more screen-local UI.
- Route Builder now passes the targeted user-facing copy scan.

## Validation

- `cd mobile && node scripts/user-facing-copy-audit.mjs 'app/(tabs)/route-builder.tsx'`
  - passed.
- `cd mobile && npx tsc --noEmit`
  - passed after extraction.
- `cd mobile && npm run audit:copy`
  - passed.
- `cd mobile && npm run audit:routes`
  - passed 12 Route Builder audit cases.
- `git diff --check`
  - passed.
- Playwright web smoke:
  - Expo web served on `http://localhost:8097`.
  - Route Builder rendered with the extracted hub visible.
  - Screenshot saved at
    `/tmp/trailhead-route-builder-checkpoint-13-web.png`.
  - The welcome gate appeared over the route in the web session; the only
    console error seen was the existing analytics request returning `400`.

## Release

- GitHub commit: `1e6fad9` (`Extract route builder hub checkpoint`)
- Production OTA:
  - Update group: `06a76ac2-b091-4f43-9983-53c9d56c07e5`
  - Android update: `019efdf6-1435-7369-be3f-1fc2efc17c2b`
  - iOS update: `019efdf6-1435-7a1e-b7ed-9a7d7dcadf17`
  - Dashboard:
    `https://expo.dev/accounts/danub44/projects/trailhead/updates/06a76ac2-b091-4f43-9983-53c9d56c07e5`
- Preview OTA:
  - Update group: `db8a0eab-05ec-4618-870b-2b532f8c8a54`
  - Android update: `019efdf6-c203-745b-9dee-2eb895afb39b`
  - iOS update: `019efdf6-c203-7611-bb27-c5fd801a1d7c`
  - Dashboard:
    `https://expo.dev/accounts/danub44/projects/trailhead/updates/db8a0eab-05ec-4618-870b-2b532f8c8a54`

## Remaining Risks

- Needs native-device visual smoke testing for the Route Builder hub after the
  component extraction.
- The next deeper slice must avoid changing route behavior while extracting
  workspace/timeline components.
