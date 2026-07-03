# Route Builder Swap + Loader Audit - 2026-07-03

## Scope
- Route Builder camp replacement/swap flow.
- Camp preference filtering for dispersed, developed, RV, private, and any legal.
- Build loader visual polish.
- Live browser pass through local web export with API proxy to production.

## Fixed
- Camp replacement no longer demotes previously selected camp stops into regular waypoints during rebalance.
- Adding fuel, places, side trips, tours, or generic route places now clears stale camp replacement state.
- Dispersed preference is stricter and no longer treats RV/private results as acceptable matches.
- Developed preference excludes dispersed/free matches.
- Any legal backend camp-window search now fans out across public, developed, RV, and private sources before scoring.
- Route Builder build-time values read current state before ref fallbacks, preventing stale day/hour values in web input timing.
- Loader changed from bottom-card progress to a clean full-screen route-building screen with route, stays, and fuel progress rows.
- Route Builder empty result summaries no longer show numeric empty-state wording.
- Selected-stop descriptions no longer say "selected in Route Builder."

## Validation
- `git diff --check` passed.
- `cd mobile && npx tsc --noEmit --pretty false` passed.
- `python3 -m py_compile dashboard/server.py` passed.
- `cd mobile && EXPO_PUBLIC_API_URL=https://api.gettrailhead.app npx expo export --platform web --output-dir /tmp/trailhead-route-builder-flow-web` passed.
- Playwright Chromium pass used a local SPA fallback server with `/api/*` proxied to `https://api.gettrailhead.app`.
- Moab to Big Sur, dispersed, wild, one way:
  - Built through real `/api/route` and `/api/route/camp-windows`.
  - Rendered five-day map overview.
  - Returned 4 camps and 6 fuel stops.
  - Loader screenshot: `output/playwright/moab-big-sur-dispersed-loader.png`.
  - Result screenshot: `output/playwright/moab-big-sur-dispersed-result.png`.
- Zion to Bryce, developed, there-and-back:
  - Built through real `/api/route` and `/api/route/camp-windows`.
  - Rendered route overview without a blank state.

## Remaining Findings
- Production backend still returns review overnights for some developed/private/any scenarios until the backend patch is deployed.
- Map trip overview can show a repeated fuel stop line for the same station on the Moab route. Needs a follow-up dedupe pass in the map trip overview/timeline rendering.
- Day 1 manual "Choose overnight" on a long route searches the start area and can correctly show no dispersed camps nearby; later day camp windows are populated by the route camp-window call.

## Notes
- Earlier failed local browser passes were invalid because the static fallback server returned the app shell for `/api/*`. The test server now proxies API calls before serving `index.html` fallbacks.
