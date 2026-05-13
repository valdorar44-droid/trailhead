# Trailhead Launch Ops Checklist

## First Install Smoke Test

Use the public App Store build, not TestFlight.

- Create a fresh account and verify login persists after killing the app.
- Open Map, pan/zoom, and confirm map buttons are readable in dark and light mode.
- Build a short route, save it, reopen Route Builder, and delete it.
- Open Guide, play a featured Explore card summary, then a full story.
- Trigger an Explorer paywall and confirm Apple products load.
- Buy or restore Explorer, kill the app, reopen it, and confirm Explorer stays active.
- Use the admin dashboard to switch the same account to Free, reopen the app, and confirm Explorer clears.
- Switch the account back to Explorer from admin and confirm it returns after foreground sync.
- Download one offline map/routing region and confirm it remains ungated.
- Submit a report pin and confirm it appears on the map.

## Production Subscription Checks

- Railway env must include `APPLE_BUNDLE_ID`, `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, and either `APPLE_PRIVATE_KEY` or `APPLE_PRIVATE_KEY_PATH`.
- Admin Overview should show `APPLE VALIDATION` as `ON`.
- If Apple validation is `OFF`, purchases still use the compatibility activation path, but that should only be temporary.
- In App Store Connect, set App Store Server Notifications v2 to `https://trailhead-production-2049.up.railway.app/api/apple/notifications`.
- A customer saying "Apple says subscribed but Trailhead says Free" should first try Restore Purchases, then you can use admin Users to verify the backend Plan column.
- Admin `Free` clears only Trailhead backend access. It does not cancel the user's Apple subscription.

## Day-One Support Replies

### Paid but Explorer is not active

Ask the user to open Profile, tap Get Explorer Plan, then Restore Purchases. If that fails, find the user in Admin > Users and check the Plan column.

### Audio guide is slow

First generation can take up to a minute. Replays should be faster because the generated text/audio path is cached where available.

### Map or offline download issue

Confirm they are on Wi-Fi or strong cellular, then try one state/region at a time. Downloads are currently ungated for all users.

### Route builder snapped wrong

Ask for the approximate trail/location and a screenshot. Trail routing depends on available graph data, and some forest roads/trails may be missing or misclassified.

## Monitoring

- Railway logs: backend errors, Apple verification failures, AI/voice timeouts.
- App Store Connect: crashes, conversion, subscription status.
- Expo/EAS: OTA update history and build runtime versions.
- ElevenLabs, Anthropic, Mapbox, Stadia/GraphHopper: daily usage and spend.
