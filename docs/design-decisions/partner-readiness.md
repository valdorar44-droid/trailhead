# Design Decision: Partner Readiness

**Date:** 2026-06-25  
**Checkpoint:** 8 - Viator/Partner Readiness

## Current Problems

- The Explore experiences rail says `Book on Viator`, which can imply an
  in-app booking flow or Full Access readiness.
- The rail attribution says checkout is provided by Viator, but does not state
  clearly that Trailhead may earn from partner handoff links.
- Backend tests already save experiences with `status: needs_booking`, but the
  visible UI needs to match that external-checkout reality.
- Partner data can be fixture, sandbox, affiliate link, configured, live
  external checkout, or future booking; the UI should not assume every provider
  is live.

## Research Reviewed

- PR #12 master live-app upgrade plan, section 9.
- `docs/copilot-outdoor-commerce-upgrade-plan.md` partner/commerce direction.
- `dashboard/provider_registry.py` Viator metadata and constraints.
- `tests/test_viator_sourcepack.py`, especially the external booking planner
  save shape.
- Current Explore implementation:
  - `mobile/components/explore/ExploreExperiencesRail.tsx`
  - `mobile/app/(tabs)/guide.tsx`
- Figma:
  - Nucleus UI Lite compact row/card rhythm from node `2802:306`.
- Mobbin:
  - Authenticated session was unavailable during this checkpoint, so this slice
    uses prior saved/offline/action-card pattern research and the current
    Trailhead implementation.

## Patterns Extracted

- Use external handoff language, not in-app booking language.
- Keep source badges visible, but make the action generic enough for any
  partner.
- Show save-to-trip and map actions near checkout, because checkout may happen
  outside Trailhead.
- Disclose affiliate/partner relationship in plain user-facing copy.
- Keep empty/error states calm and avoid exposing provider failures.

## New Component Tree

```txt
GuideScreen / Explore
  ExploreExperiencesRail
    partner experience card
      source badge
      title/meta/summary
      Checkout with Partner
      Save to Trip
      Show Area
    partner disclosure
```

## First Implementation Slice

- Change the primary experience action to `Checkout with Partner`.
- Keep the action as an external URL handoff only.
- Add accessible labels for checkout, save-to-trip, and map actions.
- Change attribution/disclosure copy to state that Trailhead may earn when a
  user checks out with a partner.
- Do not change backend ingestion, fixtures, or planner save shape in this
  slice.

## Why This Is Better

- The UI matches current Viator Sandbox/Starter reality.
- Trailhead does not imply in-app booking or confirmed availability.
- The same rail can support future partners without hardcoding Viator as the
  only checkout action.
- Users get clear save and map actions even when they are not ready to leave the
  app for checkout.

## Future Improvements

- Add a typed `provider_state` field to `BookableExperience`.
- Add partner-state badges such as external checkout, fixture, or affiliate
  link where user-facing.
- Add click/save analytics for checkout handoffs and saved trip stops.
- Add an offline meeting-point preparation card after save-to-trip.
