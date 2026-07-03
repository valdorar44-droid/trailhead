# Mapbox Camp Pin Visual Audit - 2026-07-03

## Scope

- Mapbox standard/outdoors/satellite camp markers were visually behind Trailhead topo.
- Close zoom could look like plain dots or lose readable camp type.
- Farther zoom needed visible site type, especially C, D, RV, and P.

## Reference Notes

- Mobbin travel/map references favored compact, high-contrast pin badges with clear category marks and minimal text.
- Figma design-system search in the Trailhead file did not find an existing reusable camp pin component, so the restyle stayed in code using the existing Trailhead camp color/category model.

## Changes

- Native vector map camp clusters now carry dominant camp type and show C, D, RV, or P inside the cluster badge.
- Native unclustered camp pins now have a white casing, colored body, dark inner plate, and readable type text from wider zooms.
- Legacy WebView map layers now use the same C/D/RV/P cluster and pin treatment, with cluster taps zooming in.
- Browser web map DOM markers now use cased badges instead of flat dots and allow more camp markers in the current view.
- Camp discovery subtitle was shortened to avoid clipped text beside weather and filter controls.

## Visual Audit

Playwright ran against the exported web app with production API calls proxied locally.

- Runtime: Mapbox GL.
- Moab wide view at zoom 9.6: 118 visible markers after camp search loaded.
- Close zoom stayed visible in Mapbox standard, outdoors, and satellite.
- Marker codes observed: G, P, T, W, RV, D, C.
- Screenshots:
  - `output/playwright/camp-pins-mapbox-moab-standard-region.png`
  - `output/playwright/camp-pins-mapbox-moab-standard-close.png`
  - `output/playwright/camp-pins-mapbox-moab-outdoors-close.png`
  - `output/playwright/camp-pins-mapbox-moab-satellite-close.png`

## Validation

- `npx tsc --noEmit --pretty false` passed in `mobile`.
- `git diff --check` passed.
- `EXPO_PUBLIC_API_URL=https://api.gettrailhead.app npx expo export --platform web --output-dir /tmp/trailhead-map-pin-web` passed.

## Notes

- Browser console noise was limited to known web warnings and static asset 404s from the local export server.
- Local login did not complete in the development web session because the local API base was not production; the visual pass used the exported app with production API proxying for the map workflow.
