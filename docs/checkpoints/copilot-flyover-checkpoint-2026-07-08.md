# Co-Pilot Flyover Checkpoint - 2026-07-08

## Product Contract

- Co-Pilot builds the route first, then asks whether to fly the plan.
- The flyover is deterministic playback: the app engine moves the camera, marker, progress line, and controls.
- The director can choose beats and short narration, but the app sanitizes the visible copy before it reaches the flyover.
- Camps, fuel, and route places are collected before playback and remain available when the flyover closes.
- Closing the flyover returns to the route overview. Do not show the Mission Control sheet after playback.

## Copy Rules Locked In This Pass

- Visible flyover text says flyover, trip recap, trip overview, route, camps, fuel, and current conditions.
- Avoid visible wording such as Mission Control, mission briefing, mission recap, AI, planning visualization, green light, route pack, and planned corridor.
- Remote storyboard text is sanitized locally before display.

## Gates Run

- `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit`
- `node scripts/mission-briefing-smoke.mjs`
- `python -m py_compile dashboard/server.py dashboard/mission_storyboard.py`
- `python -m unittest tests.test_mission_storyboard tests.test_copilot_tool_bridge`
- `node scripts/user-facing-copy-audit.mjs`
- `node scripts/route-builder-audit.mjs`
- `git diff --check`

## Build Gate

No new EAS preview build was started in this pass. Preview builds should wait until local checks stay clean and the next live visual pass confirms the route overview -> flyover -> route overview flow.
