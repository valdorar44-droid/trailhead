# Stage 9 Navigation Surfaces Audit

Date: 2026-06-18

## Checkpoint

Stage 9 prepares Trailhead for CarPlay, Android Auto, Live Activities, and Dynamic Island without pretending those can ship through OTA. The current app has Android native output but no checked-in `mobile/ios` tree, so iOS native work must start as a binary-build branch or Expo prebuild lane.

## CarPlay Entitlement Request Package

CarPlay entitlement request package: prepared for native review, not enabled in OTA.

Bundle ID: `com.trailhead.app`

Requested capability: Apple CarPlay navigation app entitlement.

Product purpose:

- Trailhead is an outdoor trip, route, and camp-planning app for overland, road-trip, and trail travel.
- The first CarPlay mode should be read-only route preview: saved drivable routes, route line, current location, route warnings, and Mission Control readiness.
- The first build must not start active guidance automatically.

Initial CarPlay mode:

- saved drivable routes
- route preview
- current location
- map layers appropriate for driving
- Mission Control warnings
- safe action buttons only
- no free-drive mode
- no Mapbox trip session by default

Mapbox guardrail:

- If Mapbox Navigation SDK is added, `startFreeDriveAutomatically` must be disabled.
- Active guidance must require explicit Start Guidance from a user action.
- Backend authorization must call `/api/extreme/navigation/authorize` with `acknowledged_billing: true`.
- Free drive remains blocked and `free_drive_authorized` remains false.

Required validation:

- Apple entitlement approval before shipping CarPlay.
- real hardware test in a vehicle/head unit.
- review with Apple Human Interface Guidelines for CarPlay templates.
- no free-text Co-Pilot entry while driving.

## Live Activity / Dynamic Island Spike

Technical path:

- Add an iOS WidgetKit extension with ActivityKit.
- Define a small Trailhead activity payload.
- Update from the app while foregrounded or navigating.
- Use APNs for server-driven updates only after token registration and privacy review.

Payload sketch:

```json
{
  "next": "Fuel before remote stretch",
  "eta_minutes": 42,
  "distance_miles": 28.4,
  "risk": "Smoke watch",
  "offline": "ready"
}
```

Constraints:

- ActivityKit extensions cannot fetch network data directly.
- ActivityKit extensions cannot access live location directly.
- Payloads must stay small and avoid trip-private details unless the user starts the activity.
- The app or APNs must feed updates.

Recommended first activities:

- active route preview
- route scout running
- trip download progress
- approaching checkpoint
- severe route hazard
- offline readiness progress

## Android Auto Plan

Current status:

- Android background location and foreground service remain blocked for Play-review safety.
- `mobile/android/app/src/main/AndroidManifest.xml` does not declare `androidx.car.app.category.NAVIGATION`.
- Android lock-screen/background navigation is deferred.

Native lane:

- Add Android for Cars App Library in a separate native branch.
- Declare `androidx.car.app.category.NAVIGATION` only in that native lane.
- Use approved navigation templates.
- Keep route preview separate from active guidance.
- Do not restore `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, or `FOREGROUND_SERVICE_LOCATION` without a Play policy package and review video.

## Implemented Guardrails

- Added a backend test that verifies navigation authorization requires confirmation, blocks free drive, and returns `free_drive_authorized: false`.
- Added `scripts/qa_navigation_surfaces_matrix.py` to check native-surface guardrails.
- Confirmed `mobile/app.config.js` keeps Android background location and foreground service disabled.
- Confirmed Android manifest removes background location, foreground service, foreground location service, and the Expo location task service.

## Validation

- `python3 scripts/qa_navigation_surfaces_matrix.py`
- `python3 -m unittest tests.test_extreme_explorer`
- `python3 -m py_compile dashboard/server.py`
- `(cd mobile && npx tsc --noEmit)`
- `git diff --check`

## Decision

Stage 9 is a native-readiness checkpoint. Native work is separated from OTA until entitlement, manifest, policy, and real hardware validation are ready; native work is separated from OTA.
