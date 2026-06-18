# Adventure Readiness Stage 1 Audit

Date: 2026-06-18

## Scope

Stage 1 starts the Trailhead Adventure OS production-readiness program from `docs/adventure-app-production-readiness-plan.md`.

This checkpoint focuses on smoothness and baseline polish before bigger map visuals, reports, trails, or native navigation work.

## Baseline Read

- `map.tsx`: 25,167 lines. Still the highest-risk surface, but Phase 6 extracted the major map panels.
- `guide.tsx`: 2,188 lines. Explore has source/freshness work, but first load can still feel blank while catalog pages hydrate.
- `report.tsx`: 1,594 lines. Route/camp/nearby report lanes exist, but loading states are mostly count-only.
- `MapFilterSheet.tsx`: 651 lines. Filter UI is extracted and stable enough for Stage 2 visual mode work.
- `RouteScoutPanel.tsx`: 269 lines. Progressive state exists; skeleton/progress copy can be clearer.

## Stage 1 Checklist

- [x] Import production readiness plan into repo docs.
- [x] Add reusable skeleton/loading primitives.
- [x] Replace obvious blank or spinner-only surfaces.
- [x] Audit common screens for repeated work and network churn.
- [x] Run mobile typecheck and route audit.
- [x] Save final decision for Stage 1.

## Initial Performance Notes

- Map performance risk remains concentrated in `map.tsx`; Stage 1 should avoid broad refactors and only make low-risk UI/loading changes.
- Explore already caches catalog pages, but the initial catalog hydration uses a basic spinner instead of card-shaped placeholders.
- Report route/camp lanes fetch on tab open and need clearer loading bodies.
- Premium place detail shows related-context loading as a small header spinner; the body should show what is being loaded.
- Route Scout has progress percentage, but preview stops can be absent while the user waits.

## Shipped

- Imported `docs/adventure-app-production-readiness-plan.md`.
- Added shared loading primitives in `TrailheadUI`:
  - skeleton line
  - loading row
  - card skeleton
  - horizontal rail skeleton
- Replaced spinner-only or sparse loading states in:
  - map filter sheet unlock/opening state
  - Explore catalog first load
  - Explore live nearby rows
  - Explore trail-area and campground hydration
  - Report route/camp/nearby feeds
  - Premium place nearby context
  - Route Scout early progress state

## What Improved

- Common slow surfaces now keep their layout shape while data loads.
- Loading copy is more specific to the task instead of generic “Loading”.
- Report “Near Me” now tracks its own loading state instead of hardcoding `loading: false`.
- Route Scout no longer looks empty while it is still plotting stops.
- Stage 2 can build visual map modes on top of an existing extracted filter sheet.

## What Still Feels Weak

- `map.tsx` remains too large for broad performance guarantees; later stages should continue extraction rather than adding logic there.
- This pass did not instrument actual frame timing, cold start, or pan jank metrics.
- Explore first load still pulls large catalog pages; skeletons improve perception but do not reduce payload cost.
- No native/per-device visual pass was completed in this checkpoint.

## Validation Log

- `git diff --check` passed.
- `cd mobile && npx tsc --noEmit` passed.
- `cd mobile && npm run audit:routes` passed 12 cases.
- Route audit expected unsupported Honolulu to Big Sur failure remained expected.

## Decision

- complete

Reason:

Stage 1 was intended to create a baseline and improve smoothness without risky refactors. The repo now has the readiness plan, a checkpoint audit trail, shared loading primitives, and safer loading states across the target surfaces. Stage 2 should start the map visual preset gallery and contextual legend.
