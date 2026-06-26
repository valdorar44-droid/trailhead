# Map Place And Camp Sheets Native QA Checkpoint

## Current Branch

- Branch: `codex/map-place-camp-sheets-redesign`
- PR: #16, stacked on #15
- Latest implementation commit: `95ba126`

## Best Next Order

1. Keep PR #16 focused on map camp/place sheet stabilization.
2. Run native-device QA for the camp sheet before adding more map surfaces.
3. Fix any sheet drag, keyboard, or detail-modal issues on this same branch.
4. Merge PR #15 first, then retarget PR #16 to `master`.
5. Only after native QA passes, decide whether to OTA preview or production.

## Native QA Targets

- iOS physical device or TestFlight/internal preview build.
- Android internal preview build if iOS passes or if Android map/search regressions are suspected.
- Use production API URL with no secret values in the mobile bundle.

## Queued Builds

- iOS preview build queued from this branch:
  `https://expo.dev/accounts/danub44/projects/trailhead/builds/230469d9-a674-45fb-a068-16ae2c97a1be`

## Camp Pin Flow

- Open Map.
- Select a camp pin.
- Confirm the compact camp sheet appears above the map.
- Drag compact to half, half to full, full back to half, and half back to compact.
- Confirm map panning still works after closing the sheet.
- Confirm the sheet does not open during active navigation mode.

## Camp Sheet Actions

- Favorite/unfavorite from the compact header.
- Navigate.
- Nearby camps.
- Report full.
- Details.
- Suggest edit.
- Source link when present.
- Check availability/reserve when present.

## Detail Flow

- Open Details as a normal signed-in or signed-out user.
- Confirm full camp details are visible.
- Confirm admin controls are hidden for normal users.
- Confirm photos, sites, reviews, field reports, and nearby modules scroll cleanly.
- Confirm closing Details returns to a stable map state.

## Edit Flow

- Open Suggest edit.
- Confirm keyboard behavior on iOS.
- Scroll through grouped sections.
- Toggle multiple amenities.
- Type in long notes.
- Submit or cancel without layout jumps.
- Confirm public copy avoids implementation wording.

## Nearby Context

- Confirm tabs switch between available groups.
- Confirm empty state copy is friendly.
- Confirm retry/wider search does not block the sheet.
- Confirm existing nearby cards still open/save/route as before.

## Known Local Validation Completed

- `cd mobile && npx tsc --noEmit`
- `cd mobile && npm run audit:routes`
- `cd mobile && npm run audit:copy -- components/map/CampEditSheet.tsx components/map/NearbyContextModule.tsx components/map/CampNearbyPlacesSection.tsx components/map/TrailheadSnapSheet.tsx`
- `cd mobile && npx expo config --type public`
- Expo web smoke rendered `/map`; screenshot: `output/playwright/map-place-camp-sheets-smoke.png`

## Known Limitations

- This checkout has no generated `ios/` directory, so local iOS simulator testing requires prebuild or EAS.
- Expo web cannot exercise native MapLibre/Mapbox gesture behavior.
- Dev web logs existing analytics 400s unrelated to this branch.
