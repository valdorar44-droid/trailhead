# Route Builder + Explorer Stay Audit - 2026-07-03

## Scope

- Route Builder and Co-Pilot route scout wording, route build latency, and trip overview handoff.
- Explorer hub "Where to Stay" / nearby camp fallback presentation.
- Live web app checks through Chromium/Playwright against `http://127.0.0.1:8051`.

## Changes

- Route Builder wizard copy now avoids rough/internal wording around vehicle setup, route building, camp media, and source labels.
- Route camp-window search now has a 12s client timeout and falls back to reviewable overnight areas instead of hanging.
- Backend route camp-window sampling was reduced for faster multi-day route builds.
- Route trip serialization now sanitizes raw camp labels before they reach the map trip overview.
- Explorer live camp/stay fallback cards now render as large top-down cards with an animated light skeleton while loading.
- Explorer source-pack "Where to Stay" visual pass confirmed stacked image cards for Yosemite hub.

## Live Checks

- Moab, Utah -> Big Sur, California, 5 days / 8 hours:
  - Built to trip overview in ~6.3s on final run.
  - No browser console/page errors.
  - Final text scan did not find `camp_site`, `search ·`, `Route destination`, `Photo backup`, `See site`, `SOURCE`, or `INSERT AFTER`.
  - Screenshot: `output/playwright/route-builder-clean-trip-overview.png`.
- Explorer Yosemite -> Where to Stay:
  - Renders top-down large cards.
  - No flagged wording found in the screen text.
  - Screenshot: `output/playwright/explorer-yosemite-where-to-stay.png`.

## Validation

- `python3 -m py_compile dashboard/server.py`
- `cd mobile && npx tsc --noEmit --pretty false`
- `npm run build`

## Notes

- Build still prints the known `react-native-webrtc` export warning from Metro. It did not block the bundle.
- The local browser audit used the web bundle served from `dashboard/site/dist`; rebuild before live visual checks after client edits.
