# Adventure Readiness Stage 6 - Snap-to-Trail and Route Graph Audit

Date: 2026-06-18

## Scope

Stage 6 focused on making trail route building honest about routable graph coverage. The app now distinguishes visible trail/map lines from downloadable trail route graph availability, and failed snap attempts provide a next action instead of a generic route error.

## Implemented

- Added trail builder snap modes: Trail, Road, Dirt/4WD, Hybrid, and Straight Line.
- Added route-graph readiness probing for the selected trail area using the local `*.route.jsonl.gz` sidecar.
- Added readiness rows inside the trail builder for map tiles, trail graph, route line, nearby support context, and reports/weather context.
- Added clear snap failure copy for missing trail graphs, no graph coverage, route-segment gaps, far-away anchor snaps, and manual fallback mode.
- Added an explicit Straight Line mode that connects pins only and labels the route as low-confidence/manual.
- Updated offline trail-pack status language so complete packs mention visible trail lines, selection graph, and route graph sidecars separately.
- Added `scripts/qa_snap_trail_matrix.py` to guard the Stage 6 markers.

## Current Routing Behavior

- Pinned routes still use the existing online trail/connector engine stack first unless Straight Line mode is selected.
- Visible-map geometry remains the local fallback when online snap engines cannot connect the selected pins.
- iOS native trail route graph probing is wired to local sidecar presence; Android/native graph execution still needs native parity work before it can claim route-graph snapping.

## Verification

- `python3 scripts/qa_snap_trail_matrix.py`
- `npx tsc --noEmit`
- `npm run audit:routes`
- `git diff --check`

## Remaining Gaps

- Road and Dirt/4WD modes need dedicated provider-backed routing profiles before they should claim authoritative road or MVUM routing.
- Android needs native route-graph execution parity with iOS.
- Route-graph downloads are only useful where the trail sidecar has been published for that state/region.
- The current Stage 6 work is a foundation and UX honesty pass, not a full custom trail/offroad routing engine replacement.
