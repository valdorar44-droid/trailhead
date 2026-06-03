# EXTREME Mapbox Runtime Validation

Status: native preview builds completed on June 2, 2026. Physical-device screenshot validation is still required.

## Preview Builds

- Android preview: https://expo.dev/accounts/danub44/projects/trailhead/builds/7ea202d2-6ee4-4dfc-8b2a-5fa0400a72f7
- iOS preview: https://expo.dev/accounts/danub44/projects/trailhead/builds/6a9c209e-42a4-4a20-8dd9-9604a631c55d

## Required Device Checks

- Sign in with an admin account and confirm EXTREME is unlocked in the Layers sheet.
- Select EXTREME and confirm Trailhead base style cards are visually deselected.
- Confirm the map renders Mapbox native styles without a black screen.
- Switch each premium style: Standard, Standard Satellite, Streets, Outdoors, Navigation Day, Navigation Night, Dawn, Dusk, Night, Satellite Streets.
- Toggle Globe / 3D and confirm camera pitch plus Mapbox Standard 3D configuration changes.
- Open Search Box in EXTREME and confirm results are labeled Mapbox Search.
- Pick a destination and confirm Directions draws a route whose source/debug label is EXTREME Mapbox Directions.
- Toggle Traffic and confirm the map switches to the navigation traffic style.
- Confirm Weather is locked unless `EXTREME_MAPBOX_WEATHER_ENABLED=true`.
- Confirm Trailhead camps, government/official places, Geoapify/OSM places, community pins, water, reports, and route overlays still render in EXTREME.
- On unsupported Android renderer hardware, confirm EXTREME falls back before initializing the native Mapbox map.

## Automated Checks Already Passed

- `npx tsc --noEmit`
- `python3 -m unittest tests.test_extreme_explorer`
- `npm run audit:routes`
- `git diff --check`
