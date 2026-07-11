# Tomorrow Rebuild Plan

Date saved: July 9, 2026

## Current State

- Onboarding and profile visual polish are ready for OTA on the current native runtime.
- Current iOS production store build is still on runtime `native-20260614-sdk54-1`.
- Tonight's latest onboarding/profile OTA is on runtime `native-202607-mission-animator-1`, so the current iOS production store build cannot receive it.
- Preview builds on runtime `native-202607-mission-animator-1` can receive the latest redesign OTA.
- Android Auto native support is implemented as a first checkpoint, but it is native Android work and cannot ship by OTA.
- Desktop Head Unit is installed for local Android Auto testing.
- A debug-only Android package suffix is enabled so the local debug build can install beside the signed production app without wiping production app data.

## Tonight

- Production OTA: publish onboarding/profile visual polish to the current production builds.
- Reality check: production OTA published successfully, but the current iOS production store build is on the older `native-20260614-sdk54-1` runtime and will not see it.
- Do not publish Android Auto as OTA; it needs a native rebuild.
- Preview native rebuilds started after audit:
  - Android preview build `06427a54-2d71-4ed2-9089-d230e8f8194e`, app `1.0.5`, build `37`, runtime `native-202607-mission-animator-1`.
  - iOS preview build `5630b34b-8c68-4a1c-aec2-6b9b3017e1ab`, app `1.0.5`, build `34`, runtime `native-202607-mission-animator-1`.
- Preview native builds finished:
  - Android APK: https://expo.dev/artifacts/eas/K1OT-OZ95SztaUJKyX2iXQ9cycCNYF1Yzq1xPqz3qjc.apk
  - iOS IPA: https://expo.dev/artifacts/eas/cfELrU0xCh9avo68rQCVJ5s3N1_OIfFCHwQ7oicCxaA.ipa
- Preview OTA published after Co-Pilot flyover polish:
  - Update group `4737442f-2fc2-46e6-8393-ba2de2ac39da`
  - Runtime `native-202607-mission-animator-1`
  - Message `Co-Pilot flyover overview and camera controls`
  - Dashboard: https://expo.dev/accounts/danub44/projects/trailhead/updates/4737442f-2fc2-46e6-8393-ba2de2ac39da
- Audit checkpoint before preview builds:
  - `npm run audit:prepreview` passed.
  - `npm run audit:map-smoke` passed against local Expo web on `http://127.0.0.1:8081/map`.
  - Android `:app:assembleRelease` passed locally.
  - `npx expo-doctor` still reports known native-project warnings; review before production rebuilds.
- Audit checkpoint before preview OTA:
  - `npx tsc --noEmit` passed.
  - `npm run audit:mission` passed.
  - `npm run audit:prepreview` passed.
  - `npm run audit:map-smoke` passed against local Expo web on `http://127.0.0.1:8081/map`.

## Tomorrow

1. Build iOS preview.
2. Build Android preview.
3. Install/test Android preview on phone.
4. Test Android Auto through Desktop Head Unit.
5. Verify onboarding, profile, Google sign-in, route builder, map, and Co-Pilot on preview.
6. Build iOS production.
7. Build Android production.
8. Submit or stage production builds after preview smoke checks pass.

## Android Auto Notes

- Native package: `com.trailhead.app`
- Debug side-by-side package: `com.trailhead.app.debug`
- DHU path on Windows: `%LOCALAPPDATA%\Android\Sdk\extras\google\auto\desktop-head-unit.exe`
- APK path from WSL: `\\wsl.localhost\Ubuntu\home\sean\.openclaw\workspace\trailhead\mobile\android\app\build\outputs\apk\debug\app-debug.apk`
- Current car screen is a simple POI/template companion screen showing active trip, rig, and stops.
- Real map template work should be the next Android Auto checkpoint after preview install works.

## Rebuild Reminders

- The Android Auto service, Gradle dependencies, Android manifest metadata, and package signing all require native builds.
- OTA can update JS and assets only for builds with the matching Expo runtime version.
- Before production build, decide whether to keep debug-only package suffix only for debug builds and confirm production remains `com.trailhead.app`.
