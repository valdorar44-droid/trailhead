# Android Permission Review Audit

Date: 2026-06-13

## Scope

Audit the current Android permission surface and compare it to the app's in-product disclosure and Play review expectations.

Files reviewed:

- `mobile/app.config.js`
- `mobile/app/(tabs)/map.tsx`
- `mobile/lib/backgroundTasks.ts`
- `docs/app-store-copy.md`

Reference guidance:

- Android Developers: Request background location  
  https://developer.android.com/develop/sensors-and-location/location/permissions/background
- Play Console Help: Understanding location in the background permissions  
  https://support.google.com/googleplay/android-developer/answer/9799150
- Play Console Help: Provide information for Google Play's Data safety section  
  https://support.google.com/googleplay/android-developer/answer/10787469

## Current Permission Surface

Declared in `mobile/app.config.js`:

- `ACCESS_FINE_LOCATION`
- `ACCESS_COARSE_LOCATION`
- `ACCESS_BACKGROUND_LOCATION`
- `FOREGROUND_SERVICE`
- `FOREGROUND_SERVICE_LOCATION`
- `RECORD_AUDIO`
- `MODIFY_AUDIO_SETTINGS`
- `RECEIVE_BOOT_COMPLETED`
- `VIBRATE`
- `com.android.vending.BILLING`

Relevant copy in config:

- Foreground location text says map position, turn-by-turn, nearby camps, and route hazards.
- Background location text says auto-play audio guides and landmark narration while driving / with phone in pocket.
- Microphone text says Co-Pilot voice.

## What The Code Actually Does

### Foreground location

This is clearly justified.

- Map asks for foreground location.
- Routing and nearby search use foreground location.
- The in-app location disclosure on map explains foreground use.

### Background location

This is the risky area.

Observed behavior:

- `map.tsx` starts background location updates when `navMode` turns on.
- `backgroundTasks.ts` registers `AUDIO_LOCATION_TASK`.
- That task writes the latest location and fires local notifications for nearby trip waypoints that have guide narration content.

So the current product story is not just "turn-by-turn continues in background." It is closer to:

- active navigation/background trip mode
- plus background audio-guide waypoint notifications

### Microphone

This is in better shape.

- Voice is user-triggered from Co-Pilot.
- The app does not request microphone at startup.
- The voice session asks for the mic when the user starts voice.

## Review Risks

### 1. Background location is not defensible as-is

The issue is not only the permission. The issue is the mismatch across product surfaces.

Play's current guidance asks whether background location is important to the app's core functionality, whether users would expect it, whether the same experience could be delivered without it, and whether the app clearly documents it in-app and on the store listing.

Current problems:

1. The in-app disclosure says:
   - "Location is only used while the app is open"
   - that directly conflicts with `ACCESS_BACKGROUND_LOCATION`

2. The in-app disclosure shown before permission is foreground-only.
   - It does not clearly say the app collects location when closed or not in use.
   - It does not explain the specific background feature in the way Play asks for.

3. The disclosure currently has only a continue path in the rendered UI.
   - Play guidance for background location educational UI expects a clear explanation and a decline path.

4. The store listing copy reviewed in `docs/app-store-copy.md` does not currently disclose background location use.
   - It mentions audio guides and current-location narration.
   - It does not say location is used when the app is closed or not in use.

5. The declared reason is narrower and cleaner than the actual implementation story.
   - Config copy says landmark narration while driving.
   - Code also runs a waypoint notification task off active trip data.

### 2. Microphone is probably acceptable, but disclosure still needs Console alignment

This looks reviewable because:

- it is user-initiated
- it is clearly tied to voice Co-Pilot
- it is not requested on first launch

Still required:

- Play Data safety answers must match microphone collection/transmission behavior
- store listing should not imply passive listening or always-on voice if that is not true

## Recommendation

## Recommendation A: safest route for first Android production

Remove `ACCESS_BACKGROUND_LOCATION` for the Play submission and ship foreground-only location.

Reason:

- the app is already strong enough without background location for first approval
- foreground routing, nearby camps, route reports, and Co-Pilot all remain usable
- this removes the highest-risk review issue immediately

This is my recommendation unless you are prepared to do the full Play background-location package correctly now:

- one clearly declared core feature
- updated in-app prominent disclosure
- updated store listing copy
- permission declaration form
- review video showing the feature and the disclosure flow

## Recommendation B: keep background location only if you rebuild the review story

If you keep it, you should not submit as-is.

You need to change at least:

1. In-app disclosure:
   - must explicitly say the app collects location even when closed or not in use
   - must name the concrete background feature
   - must include a decline path

2. Store listing copy:
   - must mention the background-location feature plainly

3. Declaration package:
   - choose one core feature to declare
   - likely "active navigation with route guidance / landmark narration while driving"
   - prepare the Play review video showing:
     - user entering that feature
     - prominent disclosure
     - permission flow
     - visible background behavior

4. Code/wording alignment:
   - make sure the declared feature and actual behavior match cleanly

## Final Call

Current status:

- foreground location: defensible
- microphone: likely defensible
- background location: not defensible as-is

If the goal is the highest-probability Android approval, downgrade to foreground-only location for this submission.

## Action Taken

Implemented on 2026-06-14:

- removed `ACCESS_BACKGROUND_LOCATION` from Android app config
- removed `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, and `RECEIVE_BOOT_COMPLETED` from Android app config because they were only supporting the Android background location flow
- removed the same permissions from `mobile/android/app/src/main/AndroidManifest.xml`
- disabled Android background-location startup in `map.tsx`
- disabled background guide task registration on Android in `backgroundTasks.ts`
- removed `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, and `SYSTEM_ALERT_WINDOW` from the Android release manifest after verifying current photo/report flows use scoped camera and media picker APIs instead

Result:

- the next Android bundle should present as foreground-location only
- the next Android bundle should also avoid unnecessary broad storage and overlay permissions
- a fresh Android AAB is required; OTA does not change reviewed manifest permissions

Built on 2026-06-14:

- EAS Android production build `3f81a545-9e12-4380-8b7d-f9756b620e77`
- `versionCode 27`
- store distribution AAB generated after permission cleanup

## Follow-up Review Findings

### Android 16 orientation / resizability

Play warning source was the explicit portrait lock on `MainActivity`.

Action taken:

- removed `android:screenOrientation="portrait"` from `mobile/android/app/src/main/AndroidManifest.xml`

This addresses the specific large-screen orientation restriction Play flagged in the reviewed Android manifest.

### Android 15 edge-to-edge deprecation warning

The flagged callsites are mostly dependency-owned:

- `react-native-screens` (`ScreenWindowTraits`)
- React Native status bar internals
- Material bottom sheet internals

Current local dependency versions:

- React Native `0.76.3`
- Expo `52.0.49`
- `react-native-screens` `4.4.0`

This warning is not a simple app-level manifest fix. It is mostly a framework / library migration issue and should be handled in a controlled React Native / Expo dependency upgrade pass.

### 16 KB native library alignment

The warning is real for this bundle.

Inspection of the generated AAB showed mixed ELF segment alignment in native libraries:

- some libraries use `0x4000`
- many still use `0x1000`

Examples that still show `0x1000` page alignment:

- `libc++_shared.so`
- `libexpo-av.so`
- `libexpo-modules-core.so`
- `libfbjni.so`
- `libgifimage.so`
- `libhermes.so`
- `libjsi.so`

Examples already at `0x4000`:

- `libmapbox-common.so`
- `libmapbox-maps.so`
- `libjingle_peerconnection_so.so`
- `libandroidx.graphics.path.so`

Conclusion:

- this is not just a Play Console false positive
- fixing it will require a newer toolchain and/or rebuilt native dependencies, not a manifest tweak

## SDK 54 Upgrade Checkpoint

Implemented on 2026-06-14:

- upgraded the native platform stack to Expo SDK 54 / React Native 0.81
- moved Android compile/target SDK to 36
- moved Android NDK to `27.1.12297006`
- moved Kotlin to `2.1.20`
- moved the checked-in Gradle wrapper to `8.13` after EAS reached Gradle and failed on the older `8.10.2` wrapper
- added explicit Android `blockedPermissions` in Expo config for removed background location, foreground service, boot, broad storage, and overlay permissions so future native regeneration does not reintroduce them
- switched app code that still uses legacy Expo FileSystem APIs to `expo-file-system/legacy`
- added `react-native-worklets`, `expo-modules-core`, and `babel-preset-expo` after the SDK 54 JavaScript bundle gate exposed missing runtime/build dependencies
- pinned npm legacy peer resolution in `mobile/.npmrc` because the existing WebRTC plugin stack still has peer metadata lagging the Expo SDK 54 line
- enabled React Native New Architecture in `mobile/android/gradle.properties` and Expo config after EAS build `b9ed8b3b-1638-4548-acd3-c9d2740374a4` failed on `:react-native-reanimated:assertNewArchitectureEnabledTask`
- upgraded Android payments from `react-native-iap` 12.x to the Nitro-backed 15.x line after EAS build `4bdd738d-5f63-4750-91f1-ade7ab96f5d4` failed compiling `:react-native-iap:compilePlayReleaseKotlin`
- updated the subscription wrapper from `getSubscriptions` / `requestSubscription` to `fetchProducts({ type: 'subs' })` / `requestPurchase({ type: 'subs', request: ... })`
- removed the obsolete `react-native-iap+12.16.4` patch after EAS build `1ebd97e0-c11a-463c-afe6-6fd23cb31949` failed during `npm ci` trying to apply it to IAP 15.x

Local validation completed before the next AAB attempt:

- `npx expo install --check`
- `npx tsc --noEmit`
- `npx expo export:embed --eager --platform android --dev false`

Remaining verification for the next successful AAB:

- inspect final manifest for background/overlay/storage/orientation regressions
- inspect native `.so` page alignment for 16 KB readiness
- confirm whether the Android 15 edge-to-edge warning clears or remains dependency-owned

Implemented on 2026-06-14:

- upgraded the mobile app to Expo SDK 54 / React Native 0.81.5 / React 19.1
- upgraded SDK-compatible Expo modules, Expo Router, Reanimated, Screens, Safe Area Context, WebView, and React types
- upgraded `@config-plugins/react-native-webrtc` to the Expo 54-compatible `13.x` line
- switched legacy offline file users to `expo-file-system/legacy`
- updated Expo Notifications handler shape for SDK 54
- updated Android compile/target SDK to 36, build tools to 36.0.0, Kotlin to 2.1.20, and NDK to 27.1.12297006
- bumped runtime version to `native-20260614-sdk54-1`

Validation at this checkpoint:

- `npx expo install --check` passed
- `npx tsc --noEmit` passed

Next checkpoint:

- build Android production AAB
- inspect native library ELF segment alignment again
- submit only if build succeeds and review warnings are acceptable / cleared

## EAS Install Failure Checkpoint

First SDK 54 Android EAS build:

- build id `ad6fc49b-bd9c-4c38-8818-cd056b99fb57`
- failed during the Install dependencies phase before native compilation

Local reproduction:

- `npm ci --legacy-peer-deps` succeeds
- plain install resolution is sensitive to peer dependency conflicts around the upgraded native stack

Action taken:

- added `mobile/.npmrc` with `legacy-peer-deps=true` so EAS uses the same dependency resolution that succeeds locally

## SDK 54 Bundling Checkpoint

Second SDK 54 Android EAS build:

- build id `dbb7d32c-1979-4931-b6c9-c54bc7371f95`
- passed dependency install
- failed during JavaScript bundling

Cause:

- Reanimated 4 requires `react-native-worklets`
- the app Babel config references `babel-preset-expo`, which needed to be a direct dependency under the SDK 54 install graph

Action taken:

- added `react-native-worklets`
- added direct `expo-modules-core`
- added direct dev dependency `babel-preset-expo`

Validation:

- `npx expo install --check` passed
- `npx tsc --noEmit` passed
- `npx expo export:embed --eager --platform android --dev false` passed

## Production AAB Checkpoint

Final SDK 54 Android production build:

- build id `84da8254-26a9-443d-8375-2e90a479ea8e`
- versionCode `36`
- AAB URL `https://expo.dev/artifacts/eas/k1Q2QD2o8tkbdZ-VHv87Lb8CZkq8zjFYzCn9gk44HXk.aab`
- local artifact `/tmp/trailhead-sdk54-v36.aab`

Final decoded manifest audit with bundletool:

- `targetSdkVersion="36"`
- no `ACCESS_BACKGROUND_LOCATION`
- no `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_LOCATION`
- no `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE`
- no `RECEIVE_BOOT_COMPLETED` permission
- no `SYSTEM_ALERT_WINDOW`
- no `screenOrientation`
- no Expo Android `LocationTaskService`
- no WebRTC `MediaProjectionService`

16 KB native library audit:

- bundle config has `uncompressNativeLibraries.alignment = PAGE_ALIGNMENT_16K`
- all `arm64-v8a` and `x86_64` ELF `LOAD` segments are `0x4000`
- 32-bit `armeabi-v7a` and emulator `x86` slices still include `0x1000` libraries, which is expected for legacy 32-bit targets and not the modern 16 KB device path

Submission checkpoint:

- `npx eas submit --platform android --profile production --latest --non-interactive` did not submit because EAS has no Google Play service account key configured for `com.trailhead.app`
- the AAB is ready for manual Play Console upload or for EAS submit after adding a Play service account JSON key
