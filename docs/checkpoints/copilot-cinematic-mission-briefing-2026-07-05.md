# Co-Pilot Cinematic Mission Briefing (OTA-safe prototype) — 2026-07-05

## Goal

First full prototype of the Co-Pilot Cinematic Mission Briefing on the
Explorer screen (`mobile/app/extreme-explorer.tsx`): generate a storyboard
from the active trip, fly it in the 3D map, narrate the plan with captions,
highlight stops and risks, and end with a readiness-gated Mission Control
recap. Everything is JS/TS + WebView HTML — no native module changes, so the
whole feature ships over OTA.

## What was built

### `mobile/lib/copilotStoryboard.ts` (new)

Pure, side-effect-free storyboard generator.

- Types: `MissionSceneType` (intro, whole_route, day_flyover, drive_leg,
  trail_flythrough, monument_orbit, camp_arrival, fuel_stop, risk_focus,
  weather_focus, offline_readiness, mission_recap), `MissionScene` (camera
  mode fit/fly/orbit/follow, route slice, focus point, layers, narration,
  callouts), `MissionCinematic`.
- `buildMissionCinematic({ tripId, tripName, route, checkpoints, places,
  missionBrief })`:
  - Always emits `intro`, `whole_route`, and `mission_recap`. Recap wording is
    gated on `missionBrief.readiness` (ready / needs_review / blocked) and
    never claims the route is safe; with no brief it uses neutral wording.
  - `day_flyover` per distinct checkpoint day, with the route slice
    interpolated from checkpoint positions along the route.
  - `camp_arrival` from camp/stay places (falling back to
    `missionBrief.overnights`), `fuel_stop` from fuel places,
    `trail_flythrough` from trail/trailhead places, `monument_orbit` from
    monument/park/viewpoint/scenic places.
  - `weather_focus` / `offline_readiness` / `risk_focus` from
    `missionBrief.risks` grouped by risk type, ordered by severity, using the
    route midpoint when a risk has no coordinates.
  - Scene budget capped at 16 with per-category caps (3 camps, 2 fuel,
    2 trails, 2 monuments, 3 risks, 5 days) and priority ordering
    (severity/confidence first), then re-sorted into play order: days →
    stops → risks → offline → recap.

### New components in `mobile/components/copilot/`

- `CopilotPresenceOrb.tsx` — 9 states (idle, listening, thinking, building,
  flying, speaking, warning, paused, complete) with state-driven colors and a
  pulse loop built on plain `Animated` (no new dependencies), plus a small
  state label pill.
- `TripPreviewCaption.tsx` — scene title, narration caption, `Scene x/y`
  progress, optional `Day N` chip, amber warning styling for risk scenes.
- `TripPreviewControls.tsx` — replay, pause/resume, skip pill buttons with
  accessibility labels; replay grows a text label once playback completes.

### `mobile/app/extreme-explorer.tsx`

- The old no-op `speak()` now calls `playTrailheadVoice(text, 'guide', ...)`
  with presence transitions (speaking on start, back to flying/complete on
  finish) and `stopTrailheadVoice()` in unmount cleanup.
- New state: memoized `buildMissionCinematic` (wrapped in try/catch → null on
  failure), active scene/index, playing/paused/complete/error flags, and
  `copilotPresence`.
- `DemoPayload` extended with `cinematic` and `previewMode:
  'cinematic' | 'static'` (static when the route has < 2 points or generation
  throws).
- `handleMessage()` handles the new `cinematic_*` lifecycle events from the
  WebView: updates caption/orb, speaks each scene's narration, and logs
  non-blocking ledger events (`cinematic_opened`, `cinematic_scene_started`,
  `cinematic_complete`, `cinematic_error`, `cinematic_replay`,
  `cinematic_pause`, `cinematic_resume`).
- Controls drive the player through a WebView ref via `injectJavaScript`
  (`window.__cinematic.replay()/pause()/resume()/skip()`), guarded so
  failures are silent.
- Overlay layout: orb + caption row and a controls row stacked directly above
  the Mission Control panel in the same bottom wrap (`pointerEvents:
  box-none` so the map stays interactive). Mission Control stays visible the
  whole time.
- Web-only shim: `react-native-webview` has no web implementation (it renders
  a "not supported" placeholder), so on `Platform.OS === 'web'` the screen
  now renders the same HTML in an iframe with a `postMessage` bridge and an
  `eval`-based `injectJavaScript`. Native platforms still use the real
  WebView. This is what made browser/Playwright verification possible.

### WebView storyboard player (inside `makeHtml()`)

`renderRoute()` is untouched and remains the fallback. The new `cine` player:

- On `map.load`: if `previewMode === 'cinematic'` with 2+ scenes, posts
  `cinematic_ready`/`cinematic_started` and plays scenes sequentially;
  otherwise calls `renderRoute()` exactly as before.
- Scene camera work: `fit` scenes reuse the existing fitBounds padding;
  `whole_route` animates the route-line reveal; `follow` scenes interpolate
  the camera along the scene's route slice with `jumpTo` per frame while the
  progress line grows; `fly` scenes flyTo the focus point (zoom capped at
  13.5, pitch clamped ≤ 70); `monument_orbit` adds a slow ~70° bearing
  rotation after the flyTo settles; terrain scenes enable the existing DEM
  source.
- Scene callout markers reuse the `.marker` styling with new `trail_stop` /
  `monument_stop` classes and a pulsing `callout-warning` ring for risk
  scenes; markers are cleared per scene and tappable (same `selectPlace`
  bridge as regular markers).
- Timing is one rAF loop per scene driven by a paused-time-aware clock, so
  `pause()` freezes mid-scene (plus `map.stop()`), `resume()` continues where
  it left off, `skip()` finishes the current scene, `replay()` restarts from
  scene 0. Exposed as `window.__cinematic`.
- Any player error posts `cinematic_error` and falls back to `renderRoute()`;
  the RN side hides the cinematic UI and resets presence to idle.
- Style switching mid-playback re-adds the route sources on `style.load` and
  keeps playing instead of restarting `renderRoute()`.
- On completion the full marker set (all places + checkpoints) is added so
  the map ends in the same state as the static preview.

## Fallbacks

- No trip / route < 2 points / generation throws → `previewMode: 'static'`,
  existing behavior untouched (verified).
- WebView playback error → `cinematic_error` → captions/controls hidden,
  `renderRoute()` fallback.
- Voice failure → `playTrailheadVoice` falls back to device speech; if that
  fails too, captions continue silently.
- `missionBrief` null → storyboard still builds without risk scenes; recap
  uses neutral wording.

## Validation

- `npx tsc --noEmit` — clean.
- `git diff --check` — clean.
- `node --check` on the extracted WebView script body — clean.
- Standalone harness (real `buildMissionCinematic` compiled via sucrase +
  the real `makeHtml` HTML with a Moab → Monument Valley trip): scenes
  advanced in order (intro → whole_route → day flyovers → camp → fuel →
  trail → monument orbit → weather → offline → recap) with correct lifecycle
  events; pause froze event flow, resume continued, skip advanced,
  `cinematic_complete` fired, replay restarted from scene 0; zero app console
  errors.
- Full app smoke test: ran the backend locally (`EXTREME_ENABLED=1`) with a
  seeded verified test user, second Expo web server pointed at it, and a
  seeded active trip in localStorage. Verified on the real Explorer screen:
  15 scenes generated (including live explore places and Mission Control
  risk scenes), captions/orb/controls rendered above a visible Mission
  Control panel, presence transitions (FLYING → PAUSED → READY), RN
  pause/resume/skip/replay buttons drove the player through the bridge,
  readiness-gated recap wording matched the brief (`needs_review` → "4 items
  need review before departure"), switching to 3D Terrain mid-playback kept
  playing, and deleting the trip fell back to the static preview with the
  screen fully usable.

## Files changed

- `mobile/app/extreme-explorer.tsx`
- `mobile/lib/copilotStoryboard.ts` (new)
- `mobile/components/copilot/CopilotPresenceOrb.tsx` (new)
- `mobile/components/copilot/TripPreviewCaption.tsx` (new)
- `mobile/components/copilot/TripPreviewControls.tsx` (new)

## Release

- Code commit: (filled in below after commit).
- OTA update groups: (filled in below after `npm run ota`).
