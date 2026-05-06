# Trailhead Route Engine Design

## Purpose

Trailhead needs one route model that supports AI planning, manual Route Builder edits, verified enrichment, offline packs, and native navigation without treating temporary planning anchors as real destinations.

## Core Model

The route engine has six layers:

1. **Intent**
   - Source: AI chat, Route Builder wizard, My Rig, saved preferences.
   - Owns: destination, duration, max daily drive, route style, rig limits, overnight style, must-see stops.
   - Does not own: verified camps, provider route geometry, turn-by-turn state.

2. **Base Geometry**
   - Source: Valhalla/Mapbox/OSRM/native offline Valhalla.
   - Owns: route coordinates, provider maneuvers, total distance, duration, cache metadata.
   - Must expose: proper route vs cached route vs no-route state.

3. **Day Anchors**
   - Source: AI waypoints or Route Builder generated day targets.
   - Owns: daily pacing scaffold.
   - Rule: generated `Day N target area` anchors are temporary and must never become GPS destinations.

4. **Durable Stops**
   - Source: user-selected camp/fuel/POI cards, AI geocodeable waypoints, map taps.
   - Owns: final navigation stops and saved trip route truth.
   - Rule: an overnight camp/motel is the day endpoint; the following day departs from it.

5. **Verified Enrichment**
   - Source: RIDB, BLM, OSM/offline place packs, NREL/gas, Trailhead camp edits.
   - Owns: real camps, fuel, water, trailheads, viewpoints, peaks, hot springs, route fit.
   - Must annotate every candidate with:
     - `route_distance_mi`
     - `route_fit`
     - `route_progress`
     - `route_progress_mi`
     - `route_segment_index`
     - `recommended_day`

6. **Navigation Session**
   - Source: native iOS navigation engine and JS/WebView fallback.
   - Owns: snapped progress, remaining distance, off-route state, reroute state, follow/free-pan camera.
   - Rule: navigation state should not mutate trip intent or saved stops unless the user explicitly edits the route.

## Day Rebalancing Contract

When a user selects or swaps an overnight camp for Day N:

- Replace that day's framework target or existing overnight waypoint.
- Keep the selected camp card visible under Day N.
- Day N ends at that camp.
- Day N+1 starts from that camp.
- Recompute generated future targets between the new camp and the final destination.
- If the new Day N becomes shorter, later days absorb the remaining route.
- If any non-rest day exceeds the user's max drive hours, show a warning but keep the route editable.

## Route Progress Semantics

`route_progress` is normalized from `0` to `1` across the full route geometry.

Route Builder labels:

- `< 0.34`: early leg
- `< 0.67`: mid leg
- otherwise: late leg

Server enrichment and local leg search should use the same semantics so candidates feel consistent whether they came from the backend, offline packs, or live day search.

## Fallback Behavior

Routing priority:

1. Exact keyed route cache.
2. Native offline Valhalla pack when offline or after online engines fail.
3. JS/offline PMTiles router when available.
4. Online Valhalla/Mapbox/OSRM in route-option priority order.
5. Matching last-route cache.
6. No drawable route state.

Trailhead should not draw a fake straight-line route as if it were navigable. A no-route state is better than false confidence.

## Figma Screens Needed

The first Figma file exists:

- `Trailhead Product Design System`
- https://www.figma.com/design/FJUcMWAfsNyjsguCEp2dBe

Already built:

- UI Kit
- Route Builder Wizard
- Trip Overview
- Trail Discovery
- Navigation Mode
- Offline Downloads

Still needs Figma expansion once the Starter MCP call limit clears:

- `AI Planning / Trail DNA Chat`
- `Profile / My Rig + Trips`
- `Map Layers / Controls`
- `Route Engine / Decision Model`
- `Route Candidate Cards / Camp Fuel POI`
- `Route Failure / No Drawable Route`
- `Route Rebalance Warning`
- `Route Briefing / Readiness`

## OTA Gate

Before the next OTA:

- Verify Figma additions or document the MCP blocker.
- Run `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit`.
- Run `python3 -m py_compile dashboard/route_enrichment.py ai/planner.py`.
- Run `git diff --check`.
- Use TestFlight for native navigation/map-layer validation, because web cannot prove iOS MapLibre touch/camera behavior.
