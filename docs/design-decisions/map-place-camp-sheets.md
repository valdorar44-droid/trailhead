# Map Place And Camp Sheets Checkpoint

## Current Problems

- Camp detail, nearby places, and edit flows are still mostly embedded in `map.tsx`.
- Camp cards have a public quick sheet and a fuller profile path that is effectively admin-only.
- Nearby content is split across repeated horizontal rails, so users do not get one clear "what is around this place" surface.
- Camp edit uses a long page sheet with implementation-facing wording and weak grouping.

## Research Reviewed

- Mobbin: Apple Maps place detail and report flows, Google Maps suggest edit, Swarm edit contribution, Komoot outdoor detail, AllTrails trail detail.
- Figma: Sublima detail page node `21627:21578`, Main Light style guide, Mobbin-to-Figma boards, Nucleus Lite cover/pro preview.
- Trailhead: `PremiumPlaceSheet`, `CampNearbyPlacesSection`, camp quick card and camp edit blocks in `mobile/app/(tabs)/map.tsx`.

## Patterns Extracted

- Use one draggable sheet model with peek, mid, and full states.
- Put media, title, source, distance, and primary actions above longer content.
- Keep nearby context inside the sheet with clear categories instead of scattered links.
- Use grouped edit sections with a sticky submit dock and public language.
- Keep destructive or admin-only actions out of the primary user path.

## New Component Tree

- `TrailheadSnapSheet`
  - shared handle
  - snap height logic
  - scroll area
  - optional fixed action dock
- `NearbyContextModule`
  - category tabs
  - horizontal premium cards
  - empty/loading/retry state
- `CampEditSheet`
  - identity/contact fields
  - stay/access fields
  - grouped option rows
  - submit dock

## Figma Checkpoint

- File: Mobbin copy board `7tHUNDl4Dg4UdrpjE8t1Jl`
- Page: `Page 1`
- Node: `5:2`, `Trailhead checkpoint / Map place and camp sheets`
- Purpose: records the original Trailhead camp snap sheet, nearby context, and edit sheet direction without editing purchased template frames.

## Why This Is Better

- Map sheet behavior becomes consistent across POIs, camps, and later trails.
- Camp details become available to normal users while admin controls stay gated.
- Nearby places read as one designed product surface instead of repeated rails.
- Edit flows become easier to scan and less technical.

## Future Improvements

- Move the entire public camp profile into a dedicated `CampDetailSheet`.
- Add one unified place edit sheet for non-camp POIs.
- Add Playwright screenshot baselines for POI sheet, camp sheet, nearby, and edit flows.
- Expand the Figma checkpoint into final component variants after the native map sheet is visually approved on device.
