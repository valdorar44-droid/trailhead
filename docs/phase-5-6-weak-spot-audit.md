# Weak Spot Closure Audit

Date: 2026-06-12

## Scope

This checkpoint closes the remaining product weaknesses that were still worth fixing before deeper Phase 6 map work:

- Profile needed direct offline/cache controls
- Map downloads were still too hidden from Profile
- route alerts in `map.tsx` were still embedded in the giant screen file

## Shipped

Updated:

- `mobile/app/(tabs)/profile.tsx`
- `mobile/app/(tabs)/map.tsx`
- `mobile/lib/store.ts`
- `mobile/components/map/RouteAlertsPanel.tsx`

### 1. Profile now has real offline trip controls

What changed:

- Added an `OFFLINE MAPS` quick action in the Trips section.
- Added an `OPEN OFFLINE MAPS` action in the Trips summary card.
- Added an `OFFLINE TRIPS` card that shows cached trips directly from device storage.
- Users can now:
  - open an offline trip
  - remove an offline copy
  - see cached trips that are no longer in the saved trip list

### 2. Profile can now hand off directly to map downloads

What changed:

- Added a small cross-screen pending state in store.
- Opening `OFFLINE MAPS` from Profile now takes the user to Map and opens the offline downloads modal directly.

### 3. Route alerts are no longer embedded inline in `map.tsx`

What changed:

- Extracted the route alerts overlay into:
  - `mobile/components/map/RouteAlertsPanel.tsx`
- The map screen now prepares alert display data and handles telemetry.
- The panel UI and styles now live outside the main map file.

## What Improved

- Offline readiness is no longer just implied by badges.
- Profile can now act as a real trip/downloads hub instead of only a summary screen.
- The first new map extraction is in place without touching route computation or navigation state.

## Validation

Completed:

- `npx tsc --noEmit`
- `git diff --check`

## What Still Feels Weak

- `map.tsx` is still too large overall.
- Offline trip management is now usable, but region-level download management still lives in the Map flow where it belongs.

## Decision

- complete

Reason:

These were real usability and code-shape weaknesses. They are now handled well enough to stop carrying them forward as open product debt.
