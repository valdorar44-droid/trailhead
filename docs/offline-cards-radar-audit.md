# Offline Cards and Radar Audit

## Offline Card Contract

- Camp cards must render cached name, coordinates, source badge, source freshness, reservable flag, amenities, site types, official URL, and booking URL from downloaded camp packs.
- Place cards must render cached name, type, subtype, source, address, coordinates, and route placement when provider photos, hours, ratings, weather, or live rich details are unavailable.
- Trail cards must render downloaded trail geometry/profile fields and avoid live-only dependencies for the saved trail line, title, activities, difficulty, and distance.
- Downloaded place-pack results must be distinguishable from temporary cache by `source=offline` or a source badge from the pack.
- Trip timeline place events must keep cached point/source/route-position fields even when live cards cannot refresh.

## Current Implementation Notes

- Region place packs are explicit downloads in Offline Downloads. `camps` is a dedicated pack beside Essentials, Services, and Outdoors when published in the manifest.
- Route Builder loads all downloaded place packs and uses camp packs as offline camp search fallback/augmentation.
- Place-pack retention is raised for multiple state packs, with active trip and selected-region packs protected during saves.
- Optional side stops use `route_point_type=side_stop`; they remain visible as pins/timeline items and are excluded from required navigation pairs unless promoted.

## Radar

- Radar remains live-only for this pass.
- RainViewer is a best-effort live tile/source feed with no Trailhead offline guarantee or SLA.
- Do not cache radar tiles for offline v1.
- When radar is unavailable, the UI should show an empty/unavailable state rather than implying stale offline radar coverage.
