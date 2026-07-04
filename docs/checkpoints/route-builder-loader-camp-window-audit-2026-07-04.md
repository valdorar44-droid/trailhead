# Route Builder Loader And Camp Window Audit - 2026-07-04

## Scope
- Replaced the Route Builder build overlay with a centered Trailhead mark loader using the launch camo background.
- Kept loader status copy short: Starting route, Finding stays, Checking fuel, Checking stops, Opening route.
- Fixed local web testing so `localhost` uses `https://api.gettrailhead.app` unless `EXPO_PUBLIC_API_URL` is explicitly set.
- Updated route-window camp selection to trust the backend-selected or backend-ordered camp results instead of re-ranking them on the frontend.
- Removed the route status path that could surface `0 camp stops placed`.

## Verification
- `npx tsc --noEmit` passed from `mobile/`.
- `npm run audit:copy` passed from `mobile/`.
- Production API audit passed for Moab to Big Sur camp-window cases with `mobile/scripts/route-builder-audit.mjs`.
- Playwright live route pass:
  - Start: Moab, Utah
  - Destination: Big Sur, California
  - Style: Camp planner, Developed, 5 days, 8 hours/day
  - `/api/route/camp-windows` returned 5 strong windows.
  - Final map overview showed 5 camps and 2 fuel stops.
  - Day 4 now follows the backend window result: LA PANZA CAMPGROUND.
- Loader screenshots saved under `output/playwright/` during the pass; `output/` is ignored.

## Notes
- Remaining console messages in local web are framework/browser warnings from React Native Web, Expo web support, and Mapbox. The final hard reload had no failed asset responses.
