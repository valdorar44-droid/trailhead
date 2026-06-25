# Live Upgrade Checkpoint 8 Audit: Partner Readiness

**Date:** 2026-06-25  
**Commit target:** First Viator/partner external-checkout readiness slice.

## Scope Completed

- Added `docs/design-decisions/partner-readiness.md` before implementation.
- Updated `ExploreExperiencesRail` to use partner/external checkout language:
  - `PARTNER EXPERIENCES`
  - `Checkout with Partner`
  - affiliate/partner disclosure: Trailhead may earn
  - partner-site availability/payment wording
- Added accessibility labels for:
  - external checkout handoff
  - save to trip
  - show area on map
- Updated Explore save-to-trip fallback copy:
  - generic partner experience description
  - `Status: checkout with partner`

## Research Reviewed

- PR #12 master live-app upgrade plan section 9.
- `docs/copilot-outdoor-commerce-upgrade-plan.md`.
- `dashboard/provider_registry.py` Viator metadata and derivative constraints.
- `tests/test_viator_sourcepack.py` external booking save shape.
- Current Explore experience rail and Guide save-to-trip flow.
- Figma Nucleus card/list rhythm from node `2802:306`.
- Mobbin authenticated research was not available during this checkpoint, so
  prior saved/offline/action-card patterns were reused.

## Files Changed

- `docs/design-decisions/partner-readiness.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `mobile/components/explore/ExploreExperiencesRail.tsx`
- `mobile/app/(tabs)/guide.tsx`

## Audit Notes

- No in-app booking was added.
- No Full Access assumptions were added.
- Backend fixture/import behavior was not changed.
- Planner save shape remains external booking via existing backend tests.
- The rail still opens the partner URL directly through `Linking.openURL`.

## Validation

- `cd mobile && npx tsc --noEmit` - passed.
- `cd mobile && npm run audit:copy` - passed.
- `cd mobile && npm run audit:routes` - passed.
- `python3 -m py_compile dashboard/provider_registry.py` - passed.
- `python3 -m unittest tests.test_viator_sourcepack` - passed.
- `git diff --check` - passed.
- Targeted scan for old Viator booking rail copy - passed.

## Remaining Risks

- `BookableExperience` does not yet expose a typed `provider_state`.
- Checkout click/save analytics should be added in a follow-up backend/UI slice.
- Offline meeting-point preparation after save-to-trip is not yet implemented.
