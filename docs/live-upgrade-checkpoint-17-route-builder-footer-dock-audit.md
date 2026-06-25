# Live Upgrade Checkpoint 17 Audit: Route Builder Footer Dock

**Date:** 2026-06-25
**Commit target:** Route Builder fixed footer dock extraction.

## Scope Completed

- Add `docs/design-decisions/route-builder-footer-dock.md` before
  implementation.
- Review Mobbin route/travel/directions footer patterns.
- Search the user-provided Figma board and subscribed libraries for bottom dock
  or footer action components before coding.
- Extract the fixed route summary / open-on-map dock from
  `mobile/app/(tabs)/route-builder.tsx`.
- Keep route totals, fuel estimate calculation, route saving, saved geometry,
  open-on-map behavior, keyboard visibility, and safe-area positioning
  unchanged.
- Added `mobile/components/routeBuilder/RouteBuilderFooterDock.tsx`.
- Removed the replaced inline footer styles from
  `mobile/app/(tabs)/route-builder.tsx`.
- `route-builder.tsx` is now 6,418 lines after this extraction.

## Files Changed

- `docs/design-decisions/route-builder-footer-dock.md`
- `docs/live-upgrade-checkpoint-17-route-builder-footer-dock-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `mobile/app/(tabs)/route-builder.tsx`
- `mobile/components/routeBuilder/RouteBuilderFooterDock.tsx`

## Research Reviewed

- Mobbin route/travel/directions screens:
  - `https://mobbin.com/screens/5acbb479-fac7-4813-8f8a-51ebdda53b20`
  - `https://mobbin.com/screens/fbb9b733-a59c-4c53-9447-4122f82bfe61`
  - `https://mobbin.com/screens/d4776023-5b74-4b50-8479-cfce2f66fe9f`
  - `https://mobbin.com/screens/3ca15cf2-6742-4d73-a030-8334d185ef2c`
  - `https://mobbin.com/screens/aa6b2a26-585b-4fe8-89bd-f88e46751b15`
  - `https://mobbin.com/screens/ab420019-f83d-4286-8c4f-b05dc91b1143`
  - `https://mobbin.com/screens/b0586413-384e-48ef-a0d7-ec232350e829`
  - `https://mobbin.com/screens/3bccdcd5-99c6-41d0-bc36-fee04894a216`
  - `https://mobbin.com/screens/d9da4f52-fb6d-4f90-826c-3270ff84354b`
- Figma board `yP342OKFtUQ1J0RCwnzH6s`:
  - Search terms: bottom dock, footer action bar, sticky footer, bottom app bar,
    route summary.
  - No exact reusable dock component was returned from Trailhead context or
    subscribed libraries.

## Validation

- `cd mobile && npx tsc --noEmit`
  - passed.
- `cd mobile && npm run audit:copy`
  - passed.
- `cd mobile && npm run audit:routes`
  - passed 12 Route Builder audit cases.
- `cd mobile && node scripts/user-facing-copy-audit.mjs 'app/(tabs)/route-builder.tsx' components/routeBuilder/RouteBuilderFooterDock.tsx`
  - passed for 2 files.
- `git diff --check`
  - passed.
- Figma checkpoint:
  - Checkpoint 17 frame `21:2` rendered cleanly.
  - Screenshot reviewed locally:
    `/tmp/trailhead-checkpoint-17-route-builder-footer-dock.png`
- Playwright web smoke:
  - Expo web served `http://localhost:8100/route-builder`.
  - Seeded temporary route-builder draft rendered the extracted footer dock.
  - Footer displayed `711 mi`, the compact stop/camp/fuel summary, and
    `OPEN ON MAP`.
  - Browser console: 0 errors, 6 warnings from existing Expo/web output.
  - Screenshot reviewed locally:
    `/tmp/trailhead-route-builder-checkpoint-17-footer-dock-web.png`
  - Temporary draft storage was cleared, Expo was stopped, and the Playwright
    daemon was stopped.

## Release

- GitHub commit: `bc83331` (`Extract route builder footer dock`), pushed to
  `master`.
- Production OTA:
  - Channel: `production`
  - Runtime: `native-20260614-sdk54-1`
  - Update group ID: `e707456e-fd48-4fef-9875-f4ede9cde94d`
  - Android update ID: `019eff99-9226-77ff-8a80-77a2edff9c52`
  - iOS update ID: `019eff99-9226-747a-8113-cec3f7334ad4`
  - Dashboard:
    `https://expo.dev/accounts/danub44/projects/trailhead/updates/e707456e-fd48-4fef-9875-f4ede9cde94d`
- Preview OTA:
  - Channel: `preview`
  - Runtime: `native-20260614-sdk54-1`
  - Update group ID: `cd4e38e3-b02c-453b-84d5-6087c8f9bdff`
  - Android update ID: `019eff9a-405c-7f28-ba99-d34de40b8f21`
  - iOS update ID: `019eff9a-405c-78ba-8e0f-eb268d0e3b77`
  - Dashboard:
    `https://expo.dev/accounts/danub44/projects/trailhead/updates/cd4e38e3-b02c-453b-84d5-6087c8f9bdff`

## Remaining Risks

- Native QA should confirm the dock does not cover the last stop or leg actions
  on iPhone and Android route editor screens.
- A later checkpoint should tune the route editor content padding with native
  screenshots, especially while the keyboard is open.
