# Marine Chart Provider Evaluation

Date: 2026-05-27

## Decision

Trailhead v1 should ship Safe Water as awareness layers only:

- NOAA chart raster in U.S. coverage.
- CHS NONNA bathymetry in Canada, labeled non-navigational.
- OpenSeaMap/OSM seamark lines, aids, and hazards where tags exist.
- Downloaded water access and water-navigation place packs.

Do not market this as certified boat navigation, a chartplotter, or safe turn-by-turn water routing.

## Provider Paths

### Fastest Real Recreational Charts

Garmin/Navionics marine SDK/API is the likely fastest path to the Lake of the Woods experience users expect: contours, rocks, buoys, recommended tracks, and familiar recreational chart styling. This requires commercial approval and licensing, but avoids building a certified chart renderer from raw hydrographic products.

### Official Canadian Charts

Canadian Hydrographic Service data requires a licensed distribution path for in-app chart products. The engineering path is a provider abstraction that can consume licensed S-57/S-101 vector data or provider-rendered tiles, with offline entitlements and update/version tracking. Do not bundle or redistribute CHS chart imagery or ENC/RNC data without a license.

### Open Chart Context

OpenSeaMap/OSM seamarks are useful for a free/open overlay, but coverage is uneven on inland Canadian lakes. Treat it as supplemental context and show source/freshness/confidence in cards.

### U.S. Official Charts

NOAA ENC/GIS can power official U.S. chart context. The existing NOAA raster path is suitable for v1 display; a future vector path can add feature picking, offline packs, and cleaner styling.

## Current Build Step

`dashboard/marine_chart_provider.py` now provides the first `MarineChartProvider` abstraction with these capabilities:

- `tiles(bounds, zoom, mode)` for raster/vector chart display.
- `features(bounds)` for aids, hazards, channels, recommended tracks, contours, and soundings.
- `offlinePack(region)` with license, expiry, and update metadata.
- `sourceDisclosure(feature)` for card labels and safety notes.

The first implementation is source disclosure plus live Lake of the Woods conditions; licensed/vector providers can now be added without rewriting the map UI:

- `open_seamark`: current OpenSeaMap/OSM endpoint.
- `noaa_enc`: NOAA U.S. official data path.
- `chs_licensed`: future licensed CHS path.
- `navionics_or_commercial`: future commercial recreational charts.

## Safe Water Premium Prototype

Added a clickable Figma prototype page in the existing Trailhead file:

- File: `Trailhead Product Design System`
- Page: `Safe Water Marine Suite`
- Frames: premium marine map, layer drawer, depth/structure card, fishing spot card, suggested corridor planner, future nav HUD, offline coverage status, and no-licensed-chart state.
- Link: https://www.figma.com/design/FJUcMWAfsNyjsguCEp2dBe

The prototype follows Trailhead's premium dark theme, the provided Sublima/Argus-style screenshot cues, and marine-app capability references without visually copying Garmin/Navionics, onX Fish, or Fishing Points. Every chart/corridor surface keeps source disclosure and non-certified-navigation language.
