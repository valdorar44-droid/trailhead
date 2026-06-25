# Live Upgrade Checkpoint 27 Audit: Route Builder Discovery State Boundary

**Date:** 2026-06-25
**Commit target:** Route Builder discovery state boundary extraction.

## Scope Planned

- Add
  `docs/design-decisions/route-builder-discovery-state-boundary.md` before
  implementation.
- Review current route-builder discovery state, inline search state, result
  storage, and route discovery scan call sites.
- Use Mobbin route/search references and Figma design-system search as research
  inputs.
- Extract discovery state, active-key lookup, result merge, and clear helpers
  into a reusable route-builder hook.
- Keep provider calls, Mapbox fallback searches, offline fallback, ranking,
  camp replacement, add-place behavior, selected camp sheets, and route
  calculations unchanged.

## Research Reviewed

- Mobbin:
  - `https://mobbin.com/screens/968f348e-7233-4b8b-afb9-0cfd63ce7612`
  - `https://mobbin.com/screens/097b5b68-eb6b-4083-8a26-4d0f98689e14`
  - `https://mobbin.com/screens/85fcd62d-9867-43fa-9cde-827be0a9faaf`
  - `https://mobbin.com/screens/767217bc-b0c5-48a7-a959-abd598bb8ced`
  - `https://mobbin.com/flows/23c441df-12a9-46ab-a60e-19b43fcc65dd`
  - `https://mobbin.com/flows/b95095e8-89c9-41d5-8f81-d156c9f19f26`
  - `https://mobbin.com/flows/609c277f-7cba-45a8-83c3-9e26d0a921bc`
- Figma:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile route planner search result state itinerary segment bottom sheet travel place list`.
  - No reusable matching route/search components, variables, or styles were
    returned.
- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderInlineResults.tsx`

## Implementation Notes

- Added
  `mobile/components/routeBuilder/useRouteBuilderDiscoveryState.ts`.
- Moved discovery state into the hook:
  - active discovery tab
  - discovery loading state
  - active discovery key
  - keyed discovery result cache
  - inline search state
  - key builder
  - result merge helper
  - clear/reset helpers
- Updated `mobile/app/(tabs)/route-builder.tsx` to consume the hook while
  leaving `runDiscovery`, `resolveLegSearchContext`, provider calls, fallback
  searches, result ranking, camp replacement, add-place behavior, selected
  camp sheets, and route calculations in place.
- Replaced the full route reset's direct discovery cache mutation with the
  hook-level `resetDiscoveryResults` helper.

## Files Changed

- `mobile/app/(tabs)/route-builder.tsx`: 6057 lines after extraction.
- `mobile/components/routeBuilder/useRouteBuilderDiscoveryState.ts`: 134
  lines.
- `docs/design-decisions/route-builder-discovery-state-boundary.md`
- `docs/live-upgrade-checkpoint-27-route-builder-discovery-state-boundary-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `docs/live-upgrade-refresh-handoff.md`

## Figma Evidence

- File: `yP342OKFtUQ1J0RCwnzH6s`
- Frame: `37:2`, `Checkpoint 27 - Route Builder Discovery State Boundary`
- Screenshot:
  `/tmp/trailhead-checkpoint-27-route-builder-discovery-state-boundary-figma.png`

## Playwright Evidence

- Local Expo web route: `http://127.0.0.1:8100/route-builder`
- Seeded `trailhead_welcome_gate_seen_v1=1` in browser localStorage so the
  welcome gate did not cover the route-builder surface.
- Verified the Route Builder hub renders after the extraction with no current
  browser console errors in the final snapshot.
- Screenshot:
  `/tmp/trailhead-route-builder-checkpoint-27-discovery-state-boundary-web.png`

## Validation

- `npx tsc --noEmit` passed.
- `npm run audit:copy` passed.
- `npm run audit:routes` passed 12 cases.
- `node scripts/user-facing-copy-audit.mjs "app/(tabs)/route-builder.tsx" components/routeBuilder/useRouteBuilderDiscoveryState.ts`
  passed.
- `git diff --check` passed.

## Release

- Code commit: `345412c` (`Extract route builder discovery state`), pushed
  to `master`.
- Production OTA update group:
  `6acde002-4dd1-41ea-9245-10e6c67d7b85`
- Preview OTA update group:
  `c673e5b1-5ffb-4758-aa66-24e7f961c834`
- Runtime: `native-20260614-sdk54-1`.
