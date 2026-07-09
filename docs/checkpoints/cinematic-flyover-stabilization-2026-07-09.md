# Cinematic Flyover Stabilization Checkpoint

Timestamp: 2026-07-09T04:03:50Z

## Current Goal

Stabilize the Co-Pilot and Trail Builder flyover experience on preview builds before more cinematic features are added.

The current target is not a new story system. The target is a reliable route flyover:

- Smooth route-follow playback.
- Working voice on iOS and Android.
- Slower playback speeds, including very slow preview speeds.
- A scrubber that can manually move through the trip while staying centered on the route.
- Trail Builder panels hidden during flyover, then restored after closing.
- Android protected from the current native cinematic crash.
- Clean controls with no internal wording.

## User-Reported Issues

- iOS Co-Pilot flyover is smooth but too fast.
- Speed needs presets and a custom numeric input such as `0.1`, `0.5`, `1.4`, `2.0`.
- The scrubber/slider does not manually fly the trip while keeping the route centered.
- Free camera, play, and pause work.
- Audio does not start on iOS flyover.
- Android flyover is laggier.
- Android audio starts in Trail Builder but playback is laggy.
- iOS Trail Builder flyover is smoother but has no audio.
- Android Co-Pilot cinematic fly mode crashes.
- Trail Builder controls get in the way of flyover controls on both platforms.
- Mission Control-style post-flyover sheet is not needed.

## Decisions

- Keep iOS on the native animator path for Co-Pilot and Trail Builder flyovers.
- Gate Android away from the native animator for now; use the JS/native-map fallback until the Android native animator is hardened.
- Keep the AI as the director: it chooses scenes, route beats, and wording.
- Keep the flyover engine deterministic: camera, route progress, marker, speed, and scrub behavior belong to playback code, not live model output.
- Use compact bottom transport controls inspired by map/video playback flows.
- User-facing labels stay simple: `Flyover`, `Follow`, `Free`, `Speed`, `Replay`.
- Avoid visible wording such as AI, mission, debug, route engine, map layer, source, zero, unavailable, null, or dev-style labels.

## Files To Touch

- `mobile/components/copilot/TripPreviewControls.tsx`
  - Add speed presets: `0.1x`, `0.25x`, `0.5x`, `1x`, `1.5x`, `2x`.
  - Add custom speed input with clamp `0.1-3.0`.
  - Add seek lifecycle callbacks so dragging pauses playback, follows the route, and stays paused until play.

- `mobile/app/(tabs)/map.tsx`
  - Gate native mission animator to iOS for now.
  - Wire custom speed changes into native and fallback players.
  - Harden seek behavior.
  - Hide Trail Builder panels while flyover is visible.
  - Route flyover narration through a stronger fallback path.

- `mobile/lib/voice.ts`
  - Add a flyover narration helper with a quick fallback to device speech when Trailhead voice or realtime voice does not start.

- `mobile/lib/missionBriefNativePlayer.ts`
  - Support `0.1x` minimum speed in the JS fallback.

- `mobile/modules/mission-animator/src/index.ts`
  - Add optional `localProgress` to progress events.

- `mobile/modules/mission-animator/ios/TrailheadMissionAnimatorModule.swift`
  - Clamp native speed to `0.1-3.0`.
  - Emit whole-route progress, not only scene-local progress.

- `mobile/modules/mission-animator/android/src/main/java/expo/modules/missionanimator/TrailheadMissionAnimator.kt`
  - Clamp native speed to `0.1-3.0`.
  - Emit whole-route progress.
  - Keep Android native disabled from app routing until crash cause is fixed.

## Audit Checklist

- TypeScript passes.
- Native source changes do not break static checks.
- Scrubbing pauses narration and playback.
- Scrubbing updates marker/progress while remaining centered on the route.
- Play resumes from the scrubbed position.
- Speed can be set to `0.1x`.
- iOS native speed accepts the lower value.
- Android Co-Pilot flyover uses fallback instead of crashing native animator.
- Trail Builder sheets disappear during flyover and return after closing.
- Captions stay short and controls remain inside safe areas.
- No new visible internal wording is introduced.

## Validation Commands

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit`
- `git diff --check`
- `node scripts/mission-briefing-smoke.mjs`
- Native build checks only after the OTA path is clean.

## Implementation Update

Completed in this pass:

- Replaced the old three-state speed cycle with presets plus a custom numeric speed input.
- Added `0.1x`, `0.25x`, `0.5x`, `1x`, `1.5x`, and `2x` presets.
- Clamped preview speeds to `0.1-3.0` in JS and native animator paths.
- Changed scrub dragging to pause playback, stop voice, seek while dragging, and stay paused until play.
- Added a flyover narration helper with a quick device-speech fallback.
- Shortened the realtime speech-start fallback timeout.
- Made Trail Builder flyovers visual-only: no voice, no summary pacing.
- Hid Trail Builder panels while flyover controls are visible; state returns when flyover closes.
- Gated Android away from the native animator for now so Co-Pilot flyover uses the fallback path instead of the crash-prone Android native path.
- Changed native progress events to report whole-route progress with optional `localProgress`.
- Updated the mission smoke audit to protect the new speed/custom/silent Trail Builder behavior.

Validation results:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit`: passed.
- `git diff --check`: passed.
- `cd mobile && npm run audit:mission`: passed.
- `cd mobile && npm run audit:prepreview`: passed.
- `cd mobile/android && JAVA_HOME=/home/sean/.local/share/jdks/temurin-17 ./gradlew :app:assembleDebug`: passed.

Notes:

- Android native animator source was corrected for speed/progress, but app routing intentionally avoids it until the Android crash is separately investigated on device.
- Trail Builder flyover should now be treated as a simple preview tool: free cam, pause, scrub, speed.

## Current Worktree Note

Untracked items were already present before this checkpoint and should not be touched unless they become directly relevant:

- `.cursor/`
- `app.json`
- `mobile/scripts/live-walkthrough.mjs`
