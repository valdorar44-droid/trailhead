# Water Navigation Context Research and Audit

Date: 2026-05-27

## Product Pattern

Marine and fishing apps/devices split boating support into distinct layers:

- Official or licensed chart display for depth soundings, contours, rocks, obstructions, aids to navigation, channels, and shoreline context.
- Downloaded POIs for ramps, marinas, docks, fishing access, and services.
- Marked channels, recommended tracks, fairways, range or leading lines, and lateral aids to navigation such as red/green buoys and daymarks.
- Tracks/routes/markers for user or community knowledge, clearly separated from certified chart data.
- Weather, tides/currents, and safety links as live context, with offline chart availability shown explicitly.

References reviewed:

- NOAA ENC Direct to GIS: https://nauticalcharts.noaa.gov/learn/encdirect/
- NOAA ENC charts: https://www.nauticalcharts.noaa.gov/charts/noaa-enc.html
- NOAA Tides and Currents: https://tidesandcurrents.noaa.gov/
- USCG boating safety: https://www.uscgboating.org/
- Canadian Hydrographic Service chart 6201: https://www.charts.gc.ca/charts-cartes/charts-cartes-eng.asp?img=01&num=6201
- Canadian Hydrographic Service Digital Data Portal: https://charts.gc.ca/charts-cartes/gckey/index-eng.html
- CHS NONNA bathymetric data: https://charts.gc.ca/data-gestion/nonna/index-eng.html
- Transport Canada boating safety: https://tc.canada.ca/en/marine-transportation/marine-safety/boating-safety
- Minnesota Geospatial Commons lake bathymetry: https://www.mngeo.state.mn.us/chouse/water_lakes.html
- NDBC Lake of the Woods station 45148: https://www.ndbc.noaa.gov/station_page.php?station=45148

## Implemented In This Pass

- Added a backend `MarineChartProvider` abstraction for Safe Water sources so OpenSeaMap/OSM, NOAA, CHS NONNA, Minnesota DNR bathymetry, and future licensed providers can be selected without rewriting map UI code.
- Added `GET /api/water/chart-sources` for viewport source disclosure and `GET /api/water/conditions` for Lake of the Woods buoy context from NDBC station 45148 where available.
- Water-navigation line responses now include provider profile metadata plus counts for lines, aids, hazards, and recommended tracks.
- Recommended tracks now get a cyan glow and hazards get a red halo in both native MapLibre and WebView map paths.
- Water packs now include OSM/OpenSeaMap seamark-tagged aids to navigation, marked channels or recommended tracks, anchorages, locks, and water hazards where source data exists.
- Safe Water now has a live follow-line endpoint for OSM/OpenSeaMap `seamark:type` ways: marked channels, recommended tracks, fairways, range/leading lines, traffic lanes, and deep-water routes.
- The same live endpoint now returns seamark point features too: red/green lateral buoys and beacons, daymarks, lights, anchorages, locks, rocks, wrecks, shoals, and obstructions where OpenSeaMap/OSM tags exist.
- Native MapLibre and WebView maps render those open chart lines and point aids/hazards separately from camp pins, and tapping them opens a water-navigation card instead of a camp card.
- The layer sheet now labels the overlay as Safe Water: Depth + Chart Lines and shows a legend plus an empty-state note when the current viewport has depth imagery but no open seamark linework.
- Water pack cards carry navigation fields: feature, hazard type, marker color/shape, light character, depth in feet, chart source, chart URL, safety URL, and a caution note.
- Map filters now include Buoys / Markers, Marked Channels, Rocks / Hazards, Anchorages, and Locks alongside fishing, ramps, paddle launches, docks, marinas, and shore access.
- The layer sheet enables matching water-navigation filters when toggled on.
- Safe Water now uses live NOAA chart tiles for U.S. coverage and live CHS NONNA bathymetry tiles for Canadian coverage, with NONNA labeled as non-navigational bathymetry.
- Waterbody tap cards now pick chart context:
  - Lake of the Woods points use CHS NONNA bathymetry context plus CHS chart 6201 reference.
  - Canadian waters use CHS NONNA context and Transport Canada safety context.
  - Other points use NOAA ENC context where coverage exists.

## Safety Boundaries

Trailhead does not provide turn-by-turn boat routing or certified navigation. The v1 behavior is chart and hazard awareness only. NOAA chart imagery and CHS NONNA bathymetry are live-only and not included in offline v1. NONNA is explicitly non-navigational. Downloaded water-navigation pins are useful for awareness but can be incomplete or stale, especially in rocky inland waters.

## Remaining Gaps

- Official CHS navigational chart products for Canada need a licensing and distribution pass before any in-app official chart pack. Do not redistribute CHS S-57 ENC, RNC BSB, PDF chart imagery, or chart 6201 imagery as offline packs until that is handled.
- Lake of the Woods still needs licensed official/commercial nautical chart linework for the “red/green lines people follow” experience if open seamark data is sparse. Preferred paths are Garmin/Navionics marine SDK/API, CHS VAR/licensed S-57/RNC distribution, or a licensed ENC SDK/provider.
- Offline CHS NONNA bathymetry packs need a separate index-selection, tiling, sizing, and storage policy pass.
- True water-follow lines should be sourced from official chart features such as recommended tracks, fairways, channels, and range/leading lines, or from user/imported GPX/KML tracks with source, age, and confidence labels.
- Depth contours for inland lakes need a separate bathymetry pipeline; CHS NONNA may help for Canada but is not a certified navigation chart.
