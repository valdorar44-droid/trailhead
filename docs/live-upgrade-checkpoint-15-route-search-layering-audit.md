# Live Upgrade Checkpoint 15 Audit: Route Search Layering

**Date:** 2026-06-25
**Commit target:** Route Builder timeline actions, map search layering, and search fallback reliability.

## Scope Completed

- Added `docs/design-decisions/route-builder-timeline-actions-and-map-search-layering.md`
  before implementation.
- Confirmed Mobbin MCP access and reviewed route/search/map-control patterns:
  - komoot map search:
    `https://mobbin.com/screens/66021d4c-5727-4335-83a1-24b8db5d4739`
  - Pangea map controls:
    `https://mobbin.com/screens/458cf9f7-3942-4b09-8cf4-38ddb9a2d3a7`
  - Wanderlog selected-place sheet:
    `https://mobbin.com/screens/968f348e-7233-4b8b-afb9-0cfd63ce7612`
  - Transit route decision:
    `https://mobbin.com/screens/84d6aa6d-985d-437e-82fb-05ffed61557a`
  - Transit route-planning result:
    `https://mobbin.com/screens/f8ac1e75-749d-4bbc-877a-e01c897bc334`
  - komoot route-planning result:
    `https://mobbin.com/screens/a12c00f8-58cf-4f65-96ce-32c5268f6210`
  - AllTrails route/map result:
    `https://mobbin.com/screens/fbb9b733-a59c-4c53-9447-4122f82bfe61`
  - Mercedes-Benz planning-a-route flow:
    `https://mobbin.com/flows/5e1bb19e-5b7e-41da-a880-2708fbc5ab90`
  - My BMW trip-planner flow:
    `https://mobbin.com/flows/9e2ba404-89b4-4204-95d1-29e0848469d5`
  - Pangea Charging route-preview flow:
    `https://mobbin.com/flows/5fae63ac-af62-48c9-8832-0d2444847892`
- Confirmed user-provided Figma board access and added a Figma checkpoint frame:
  - File: Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`
  - Frame: `Checkpoint 15 - Route Search Layering`
  - Node: `19:2`
  - Screenshot reviewed locally:
    `/tmp/trailhead-checkpoint-15-route-search-layering.png`
- Extracted timeline utility actions into:
  - `mobile/components/routeBuilder/RouteBuilderTimelineActions.tsx`
- Extracted insert guidance into:
  - `mobile/components/routeBuilder/RouteBuilderInsertNotice.tsx`
- Added a map top-lane policy so search, status banners, drawer tools, weather,
  sync, and route warnings do not compete for the same top-left space.
- Paired Android-relevant `zIndex` and `elevation` values on the changed map,
  search, planner composer, and toast layers.
- Added a route search fallback path in `RouteSearchModal` so non-extreme and
  low-result searches use the shared place lookup.

## Files Changed

- `docs/design-decisions/route-builder-timeline-actions-and-map-search-layering.md`
- `docs/live-upgrade-checkpoint-15-route-search-layering-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `mobile/app/(tabs)/map.tsx`
- `mobile/app/(tabs)/plan.tsx`
- `mobile/app/(tabs)/route-builder.tsx`
- `mobile/components/RouteSearchModal.tsx`
- `mobile/components/routeBuilder/RouteBuilderInsertNotice.tsx`
- `mobile/components/routeBuilder/RouteBuilderTimelineActions.tsx`

## Audit Notes

- No route computation, route geometry, saved trips, camp scoring, credits,
  subscription checks, or offline route readiness calculations were changed.
- Route Builder's full screen-local search already uses Map Context, shared
  place lookup, and OSM fallback; this checkpoint adds comparable fallback
  coverage to `RouteSearchModal`.
- The targeted copy audit flagged existing internal `provider` source literals
  in `map.tsx`; those are data-contract identifiers, not visible labels.
- Planner composer/toast changes are layer-only style changes. The signed-out
  web surface renders without opening the authenticated composer path.
- Native iOS/Android map behavior still needs physical-device smoke testing
  after OTA because web cannot reproduce RNMapbox/MapLibre draw and gesture
  behavior exactly.

## Validation

- `cd mobile && npx tsc --noEmit`
  - passed.
- `cd mobile && npm run audit:copy`
  - passed.
- `cd mobile && npm run audit:routes`
  - passed 12 Route Builder audit cases.
- `node scripts/user-facing-copy-audit.mjs 'app/(tabs)/map.tsx' 'app/(tabs)/route-builder.tsx' 'app/(tabs)/plan.tsx' components/RouteSearchModal.tsx components/routeBuilder/RouteBuilderTimelineActions.tsx components/routeBuilder/RouteBuilderInsertNotice.tsx`
  - flagged existing internal `provider` literals in `map.tsx`; no user-facing
    copy regression was found in the changed surfaces.
- `git diff --check`
  - passed.
- Figma screenshot:
  - Checkpoint 15 frame `19:2` rendered cleanly.
- Playwright web smoke:
  - Expo web served on `http://localhost:8099`.
  - Route Builder rendered after test-only welcome gate bypass.
  - Build New Route opened with zero browser console errors.
  - Map search returned Moab results with the search rail owning the top lane
    and map tools visually out of the way.
  - Planner signed-out surface rendered with zero browser console errors.
  - Screenshots saved at:
    - `/tmp/trailhead-route-builder-checkpoint-15-new-route-web.png`
    - `/tmp/trailhead-map-search-checkpoint-15-web.png`
    - `/tmp/trailhead-planner-checkpoint-15-web.png`
  - Console warnings were existing Expo/web warnings. Console errors were
    unauthenticated/external API health or analytics requests, not UI runtime
    exceptions.

## Release

- GitHub commit: `b3699c7` (`Extract route search layering checkpoint`)
- Production OTA:
  - Update group: `121ff29d-88da-4d4f-98e0-04f633a729fb`
  - Android update: `019efe5e-73bd-7e10-9c9e-8177a72cb1e5`
  - iOS update: `019efe5e-73bd-73fd-abfc-32021226b3a5`
  - Dashboard:
    `https://expo.dev/accounts/danub44/projects/trailhead/updates/121ff29d-88da-4d4f-98e0-04f633a729fb`
- Preview OTA:
  - Update group: `f579cc32-ab38-4a82-b1ae-63ed7baac40c`
  - Android update: `019efe5f-26ef-759d-9c08-233f07d24519`
  - iOS update: `019efe5f-26ef-71d9-9849-8d3d4208f04e`
  - Dashboard:
    `https://expo.dev/accounts/danub44/projects/trailhead/updates/f579cc32-ab38-4a82-b1ae-63ed7baac40c`

## Remaining Risks

- Native device QA should specifically test Android map search with keyboard,
  iOS navigation free-pan, and map drawer/layer controls while search is active.
- `route-builder.tsx` still owns stop rows, day itinerary rows, and several
  route action callbacks that should be extracted in later checkpoints.
- Route Builder's wizard step search is intentionally different from the full
  map result picker; a later checkpoint should decide whether those two flows
  should converge behind a shared service.
