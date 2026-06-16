# Remaining Weakness Audit

Date: 2026-06-12

## Scope

This checkpoint closes the explicit weak spots left behind after Phase 3 and Phase 4 before moving fully into Phase 5:

- Trips & Downloads needed a clearer offline/download state in Profile
- Tonight routing in Report needed a more route-progress-aware anchor

## Shipped

Updated:

- `mobile/app/(tabs)/profile.tsx`
- `mobile/app/(tabs)/report.tsx`

### 1. Profile now has a real Trips & Downloads summary

What changed:

- Added top-level trip metrics for:
  - saved trips
  - offline copies
  - GPX route previews
- Added a `DOWNLOAD STATUS` card that tells the user how many trips are ready offline and how many still need a cached copy.
- Added imported GPX route and pin counts so imports are visible even before the user drills into the GPX list.

### 2. Tonight mode now follows route progress better

What changed:

- Replaced the old nearest-overnight-only logic with a waypoint-order heuristic.
- The app now:
  - finds the closest point on the saved trip waypoint chain
  - prefers the first overnight stop at or after that point in route order
  - falls back to nearest overnight only if the user is far off the saved route
- This is still a waypoint heuristic, but it is materially better than simply picking whichever overnight is geographically nearest.

## What Improved

- Profile now answers the operational question of “what is actually downloaded?” without making the user infer it from badges.
- Report Tonight mode is less likely to jump backward to an already-passed stop in multi-night trips.

## Validation

Completed:

- `npx tsc --noEmit`
- `git diff --check`

## What Still Feels Weak

- Profile still does not have a dedicated offline management subpage for clearing, refreshing, or inspecting cache storage.
- Tonight mode still uses trip waypoints rather than exact routed progress or ETA-based camp forecasting.

## Decision

- complete

Reason:

These were quality weaknesses, not full phase-sized projects. They are now improved enough that they no longer justify blocking Phase 5.
