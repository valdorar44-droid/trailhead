# Explorer + Map Visual Audit Checkpoint

Date: 2026-07-02
Branch: `codex/production-catchup-20260626`

## Completed

- Explorer official-cache detail pass:
  - Yosemite search no longer returns duplicate hub spam.
  - `Yosemite things to do` loads populated cards instead of an empty state.
  - Official text spacing is cleaned before it reaches cards.
  - Long official descriptions are clipped to cleaner sentence-aware card copy.
- Where to Stay pass:
  - Removed the duplicate horizontal campgrounds rail from the detail summary.
  - Where to Stay drill-in is vertical and image-led.
  - Camping/lodging child copy no longer says "Use the official..." as primary app text.
- Map camp pin pass:
  - Regular campgrounds render as `C`.
  - Dispersed spots render as `D`.
  - RV parks render as `RV`.
  - Overnight parking remains `P`.
  - Marker labels remain visible after switching to Satellite.
- Camp-card copy pass:
  - Removed "Community listing" from camp summary/source-note fallbacks.
  - Kept helpful agency badges such as BLM/Recreation.gov where they are specific.
- Filter/layer text pass:
  - Layer sheet uses plain style labels and outdoor terms.
  - Camp legend is reduced to `C`, `D`, `RV`, `P`, and review state.

## Live Audits

- Playwright local app:
  - `/app/guide` fresh load and onboarding continue.
  - `Yosemite things to do` Explorer search.
  - Yosemite park hub -> Where to Stay.
  - `/app/map` Moab search -> nearby camps.
  - Layer sheet -> Satellite style -> camp pins still labeled.
  - Regular camp card open from Goose Island Campground.
- Screenshots:
  - `.playwright-cli/page-2026-07-03T02-40-20-235Z.png`
  - `.playwright-cli/page-2026-07-03T02-43-36-495Z.png`
  - `.playwright-cli/page-2026-07-03T02-50-07-854Z.png`

## Validation

- `python3 -m py_compile dashboard/server.py`
- `cd mobile && npx tsc --noEmit --pretty false`
- `git diff --check`
- `npm run data:validate -- --dry-run`
- `npm run build`
- Targeted wording scan for old camp/route/empty-state copy returned no matches.

## Notes

- Build warning is the existing `react-native-webrtc` / `event-target-shim` export warning.
- No console errors appeared in the audited browser flows.
