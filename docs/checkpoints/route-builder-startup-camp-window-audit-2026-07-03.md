# Route Builder Startup / Camp Window Audit - 2026-07-03

## Issue
- Route Builder could enter a broken/blank-ish build state.
- Fast route builds sometimes fell back to a stale 3-day/1-day state after the user entered a different day count.
- Long camp-window searches could hang behind `/api/route/camp-windows`, causing Cloudflare 524 responses.

## Root Causes
- `findFuelStopsForRoute` referenced `placed` inside the async candidate search before `placed` was initialized, throwing `Cannot access 'd' before initialization` before the route was committed.
- The route camp-window backend waited for every window all-or-nothing, so one slow overnight search could block the whole response.
- The mobile caller used `Promise.race` timeouts without aborting the underlying request.
- Route pace inputs were vulnerable to fast-tap stale state during build.

## Changes
- Added abortable route camp-window requests and a server-side `response_deadline_s`.
- Downsampled long route spines before camp-window lookup.
- Backend now returns per-window review fallbacks for slow/failed overnight windows instead of failing the full route.
- Reduced camp-window lookup weight from full mode / 160 limit to light mode / 100 limit.
- Fixed fuel-stop async de-dupe so it cannot throw before route commit.
- Default new route drafts now start with 3 days instead of a single day.
- Pace inputs now mirror the latest typed values in refs for immediate build taps.
- Cleaned fuel-stop copy from "Auto-added..." to a clearer user-facing line.

## Validation
- `python3 -m py_compile dashboard/server.py`
- `cd mobile && npx tsc --noEmit --pretty false`
- `git diff --check`
- `EXPO_PUBLIC_API_URL=https://api.gettrailhead.app npx expo export --platform web --output-dir /tmp/trailhead-route-builder-web`
- Playwright web scenarios through Chromium:
  - `Moab, UT -> Big Sur, CA`, Wild, Public, 5 days / 5 hours: all Day 1-5 present, no blank state.
  - `Denver, CO -> Moab, UT`, Balanced, Developed, 4 days / 6 hours: all Day 1-4 present, no blank state.
  - `Zion National Park -> Bryce Canyon National Park`, There and back, Public, Same camp area, 3 days / 4 hours: all Day 1-3 present, return route shown.

## Notes
- Local web-export screenshots may show `/assets/explore/...` 404s because the static test server is not the backend. Production serves those files from `api.gettrailhead.app`.
- The Expo web export still prints the existing `react-native-webrtc/event-target-shim` warning.
