# Adventure Readiness Stage 2 Map Legend Audit

Date: 2026-06-18

## Scope

Stage 2 implements the map filter pictures, mode presets, and contextual legend called out in `docs/adventure-app-production-readiness-plan.md`.

This checkpoint stays inside the extracted map UI surface where possible. The only `map.tsx` changes are preset state, persistence, and layer/filter wiring.

## Baseline Read

- `MapFilterSheet.tsx` had a text-heavy preset chip row with five simple presets.
- `map.tsx` had a small preset handler for Default, Overland, Camps Only, Safe Water, and Hide Community.
- The layer sheet already had partial safe-water/offroad legend rows, but there was no dedicated legend model users could open from filters.
- Existing filter IDs already cover most Stage 2 modes: camps, stays, water access, trailheads, viewpoints, town services, community reports, MVUM, weather, and public land.

## Stage 2 Checklist

- [x] Add `mobile/components/map/MapModeGallery.tsx`.
- [x] Add `mobile/components/map/MapLegendSheet.tsx`.
- [x] Add `mobile/lib/mapLegend.ts`.
- [x] Replace text-only preset chips with visual mode cards.
- [x] Add contextual legend focus per mode.
- [x] Persist selected map mode with existing map filter preferences.
- [x] Expand presets into mode-level filter/layer changes.
- [x] Run mobile typecheck and route audit.

## Shipped

- Added a shared map legend library with:
  - 10 mode presets: Default, Tonight, Remote Route, Overland, Trail Day, Family Easy, Weather Risk, Water/Fish, Town Reset, Scenic.
  - 7 legend categories: Camps and Stays, Trails, Offroad and Access, Reports, Weather and Risk, Water and Fish, Sources and Trust.
- Added a horizontal visual mode gallery with illustrated mini map previews, icon signals, best-for labels, and trust/source labels.
- Added a dedicated map legend sheet that opens directly to the active mode context.
- Reworked `MapFilterSheet` header and body so users can open the legend without leaving filters.
- Expanded map preset behavior so modes update:
  - map style where appropriate
  - camp/place/community visibility
  - camp refinements
  - place and water filters
  - community pin filters
  - public land, USGS, POI, MVUM, radar, fire, avalanche, safe-water layers
  - expanded filter sections for the selected mode
- Added a guard for locked Explore service filters so mode presets do not silently pretend locked town categories are active.

## What Improved

- The filter sheet now explains map modes visually instead of presenting text chips.
- The legend explains camp pins, trail lines, offroad access, reports, weather risk, water symbols, and source/trust signals.
- Mode presets now behave like real map modes instead of a few narrow filter shortcuts.
- Users can inspect why they are seeing symbols and what source/trust language to expect.
- The selected mode survives restarts through the existing map preference object.

## What Still Feels Weak

- This pass does not add source lines to every individual map card or result. It creates the shared legend/source model and examples; later Explore/detail passes should wire per-result source cards more broadly.
- The mode gallery is React Native view art, not screenshots of live map layers. This is intentional for performance, but it should still get device visual review.
- Some town-service mode filters depend on the existing Explore unlock path, so locked categories show a toast instead of being applied automatically.
- No native-device tap audit was run in this checkpoint; the automated validation here is compile and route behavior.

## Validation Log

- `git diff --check` passed.
- `cd mobile && npx tsc --noEmit` passed.
- `cd mobile && npm run audit:routes` passed 12 cases.
- Route audit kept the expected unsupported Honolulu to Big Sur failure as expected.

## Decision

- complete

Reason:

Stage 2 requested visual mode presets and a better contextual legend. The filter sheet now has a visual preset gallery, a dedicated contextual legend, expanded mode wiring, persistence, and validation coverage. Stage 3 should move into Explore catalog polish and per-card source/freshness treatment.
