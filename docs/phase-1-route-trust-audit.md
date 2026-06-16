# Phase 1 Audit

Date: 2026-06-12

## Scope

This pass covers Phase 1 from `docs/production-improvement-execution-plan.md`:

- route trust
- TomTom/provider relevance
- AI brief input quality

## Shipped

### 1. TomTom route matching is no longer waypoint-box based

Updated:

- `ingestors/tomtom_traffic.py`
- `ingestors/conditions.py`

What changed:

- TomTom incidents are still fetched by route corridor bbox.
- They are no longer accepted just because they fall inside a loose latitude/longitude box around any waypoint.
- They are now filtered by nearest distance to route segments built from ordered trip waypoints.
- The matcher uses incident geometry when available and falls back to point coordinates only when needed.
- Matched alerts now carry `route_distance_m`.

### 2. Provider-specific route gating is stricter

What changed:

- TomTom traffic incidents now use tighter route-match radii than closures/hazards.
- Low/moderate traffic is treated more aggressively than closures and hard hazards.
- Weather, smoke, fire, and other broad-area alerts still use the looser nearby-waypoint model.

### 3. Route-alert ranking prefers route relevance

Updated:

- `dashboard/server.py`
- `mobile/app/(tabs)/map.tsx`

What changed:

- When severity is equal, lower `route_distance_m` now ranks earlier.
- This keeps route-matched incidents above equally severe but less corridor-relevant alerts.

### 4. AI route brief payload is tighter

Updated:

- `mobile/app/(tabs)/map.tsx`

What changed:

- TomTom low-value traffic summary noise is no longer sent into `/api/ai/route-brief`.
- Low/moderate TomTom traffic is not sent to the brief payload.
- The route brief now sees a narrower, higher-value alert set.

## What Improved

- Town-wide TomTom clutter should drop substantially.
- On-route closures and severe incidents are now favored over generic nearby traffic.
- The route brief is less likely to mention irrelevant traffic noise.
- Alert ordering is more corridor-aware.

## Spot Checks

Synthetic checks run locally:

- route-matched closure near corridor: kept
- route-matched moderate traffic near corridor: kept by geometry filter, then still subject to existing route-alert suppression rules
- off-corridor moderate traffic around ~900m+: dropped
- off-corridor closures around ~2km: dropped

Validation completed:

- `npx tsc --noEmit`
- `python3 -m py_compile ingestors/tomtom_traffic.py ingestors/conditions.py dashboard/server.py`
- `git diff --check`

## What Still Feels Weak

- The backend still filters against ordered trip waypoints, not the exact routed polyline.
- That means the corridor is much better than before, but still an approximation.
- Community reports along route still use the older waypoint-radius approach.
- There is still no dedicated user-facing “ignore this alert” interaction to feed better relevance data later.

## Checkpoint Status

### Checkpoint: a route through a town only shows alerts actually along the traveled road corridor

- partially verified through synthetic corridor tests
- materially improved versus previous waypoint-box behavior

### Checkpoint: AI route brief no longer mentions irrelevant town closures

- improved by stricter TomTom corridor filtering and narrower brief payload
- needs real-trip production spot checks after live usage

### Checkpoint: route alert summary is shorter and more useful

- yes, by keeping off-corridor traffic out earlier and preferring lower `route_distance_m`

## Decision

- complete

Reason:

Phase 1’s main trust fix is in place and validated locally. The biggest remaining gap is architectural: the backend still does not receive full route geometry. That is a follow-on refinement, not a reason to leave the phase open.
