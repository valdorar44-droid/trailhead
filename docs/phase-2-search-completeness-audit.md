# Phase 2 Audit

Date: 2026-06-12

## Scope

This pass covers Phase 2 from `docs/production-improvement-execution-plan.md`:

- search completeness
- empty-state hardening
- fallback behavior on sparse live data

## Shipped

### 1. Explore place detail no longer dead-ends as easily

Updated:

- `mobile/app/(tabs)/guide.tsx`

What changed:

- Explore place campground rails now supplement thin official results with nearby camp search.
- If the direct campground endpoint fails, the client falls back to nearby camp search around the place anchor.
- Cached campground rails now preserve whether the result came from the direct source or the fallback path.
- Empty state copy now points the user to the area map instead of stopping at a dead message.

### 2. Map nearby-place rails now use downloaded place packs as backup

Updated:

- `mobile/app/(tabs)/map.tsx`

What changed:

- Nearby place feeds still prefer smart-pack, nearby-place, and OSM results first.
- If those results are thin, downloaded offline place packs are merged in behind them.
- If live results fail completely, the rail can now show downloaded place-pack results instead of going blank.
- The UI now labels when the rail was expanded with downloaded packs or powered only by downloaded packs.
- Empty rails now include a retry action for a wider search.

### 3. Route Builder inline empty states now have actions

Updated:

- `mobile/app/(tabs)/route-builder.tsx`

What changed:

- Day-segment discovery no longer stops at plain “No X found” text.
- Empty results now explain the next move and offer a retry action.
- Camp searches with `photo-only` enabled can now fall back to a one-tap “allow no-photo” rerun.

### 4. Report tab did not require a code change in this phase

What changed:

- Re-audited the nearby empty state.
- It already had explanatory copy plus an `ADD REPORT` action.
- Left unchanged in this phase.

## What Improved

- Explore detail is less likely to show an empty campground rail.
- Map place rails can stay useful when live place providers are thin or temporarily unavailable.
- Empty states now move the user somewhere actionable instead of ending the task.
- Live and official results still rank first; downloaded packs stay secondary.

## Validation

Completed:

- `npx tsc --noEmit`
- `git diff --check`
- `python3 -m py_compile dashboard/server.py ingestors/conditions.py ingestors/tomtom_traffic.py`

## Under-Covered Categories Still Obvious In The Current Catalog

Based on current repo inventory and provider coverage:

- state and provincial park campground systems outside federal sources
- county and regional parks
- trailheads and day-use lots in non-federal land systems
- dump stations, water fills, and service POIs outside dense offline packs
- cabins, huts, and backcountry lodges outside the current NZ/Canada/Australia additions
- historic sites and monuments outside NPS-strength regions

These are content-density gaps, not empty-state handling failures.

## What Still Feels Weak

- Explore campground fallback is client-side. The dedicated endpoint still does not emit fallback results itself.
- Map nearby-place fallback depends on downloaded place packs being present for the region.
- Some categories still rely on broad OSM/open data coverage rather than stronger official feeds.
- Search ranking is more resilient now, but not yet personalized or feedback-trained.

## Checkpoint Status

### Checkpoint: no major search surface returns a dead empty state without a next action

- Explore: yes
- Map nearby rails: yes
- Route Builder day discovery: yes
- Report: already yes before this pass

### Checkpoint: seeded fallback is visible but clearly secondary to live/official data

- yes for Explore campground rails
- yes for Map nearby-place rails via explicit downloaded-pack labels

## Decision

- complete

Reason:

Phase 2’s main product job was to stop obvious dead ends on major search surfaces and keep fallback data behind live results. That is now in place. The remaining work is catalog density and ranking depth, which belongs to later phases rather than leaving this phase open.
