# Pakistan Road Confidence And Alert Plan

Trailhead should treat Pakistan as a mountain/overland confidence market, not
just a normal turn-by-turn routing market. The first live pass already covers
K2/Hunza/Skardu outdoor stays through OSM mixed-source search. The next step is
offline routing, road confidence, and alert overlays.

## Source Stack

- Roads/trails base: Geofabrik Pakistan OSM extract.
  - PBF for Valhalla import: `https://download.geofabrik.de/asia/pakistan-latest.osm.pbf`
  - Shape/GPKG exports for QA and offline pack helpers.
  - OSM update diffs can support refresh jobs later.
- Humanitarian comparison roads: HOTOSM Pakistan roads from HDX.
  - Use as QA/comparison only; OSM remains the routable graph source.
- Trekking/K2 POIs: OSM tags imported from Geofabrik and sampled with Overpass
  during development.
  - `highway=path`
  - `route=hiking`
  - `tourism=alpine_hut`
  - `tourism=wilderness_hut`
  - `amenity=shelter`
  - `natural=peak`
  - `place=locality`
  - `mountain_pass=yes`
- Disaster alerts: GDACS API/feeds for floods, earthquakes, cyclones, and other
  global hazards.
- Official Pakistan advisory source: NDMA Pakistan advisories and early-warning
  pages.
- Terrain: Open Topo Data or self-hosted elevation tiles for slope, ascent,
  descent, and road-difficulty scoring.

## Road Confidence Model

Expose `route_confidence` on Pakistan route segments:

- `high`: primary/secondary/tertiary roads with surface known as paved/asphalt
  or strong agreement between Valhalla and Mapbox.
- `medium`: unpaved roads, tracks, gravel/dirt, or missing surface but plausible
  vehicle routing.
- `low`: missing surface, poor smoothness, seasonal/ford/track hints, steep
  slope, recent OSM change, or disagreement between Valhalla and Mapbox.
- `trekking_only`: path, footway, hiking relation, glacier route, mountain pass,
  alpine hut/wilderness hut corridor, or any segment that should not be treated
  as vehicle navigation.

Confidence inputs:

- OSM road class: `highway`, `tracktype`, `access`, `motor_vehicle`,
  `4wd_only`, `sac_scale`, `trail_visibility`.
- Surface/smoothness: `surface`, `smoothness`, `incline`.
- Elevation/slope: grade, climb, descent, altitude exposure.
- Alert overlap: GDACS event polygons/buffers and NDMA advisories.
- Router agreement: Valhalla route vs Mapbox fallback route distance/geometry.
- Community reports: blocked road, washout, snow, landslide, flood, bridge,
  checkpoint, unsafe road, local guide required.
- Recency: OSM changeset/update age for roads in the segment.

## Implementation Phases

0. Live scaffold now in place.
   - Mixed-source K2/Hunza/Skardu camp and stay search is live.
   - GDACS global disaster alerts are part of the server conditions feed.
   - `/api/route-confidence/pakistan` returns conservative `medium`, `low`, and
     `trekking_only` confidence labels until segment tags are imported.
1. Build Pakistan Valhalla artifact from Geofabrik PBF.
   - Use the existing regional Valhalla artifact pattern.
   - Publish as `routing/valhalla/pakistan.tar.zst`.
   - Add Pakistan to the routing manifest only after route probes pass.
2. Add Pakistan road QA extraction.
   - Generate a road-segment table from the same PBF.
   - Store road class, surface, smoothness, access, tracktype, route/hiking tags,
     and geometry simplification.
   - Join elevation stats per segment.
3. Add `/api/route-confidence`.
   - Input: route geometry or waypoints.
   - Output: segment confidence, warnings, source notes, alert overlaps.
4. Add GDACS provider.
   - Cache recent global events.
   - Filter around route corridor and Pakistan AOI.
   - Surface only route-overlapping or nearby hazard alerts.
5. Add NDMA advisory provider.
   - Start with advisory page polling/scrape if no stable API/RSS is found.
   - Label as official advisory text and avoid precise geometry unless provided.
6. Mobile UI.
   - Show `High / Medium / Low / Trekking-only` on route preview and Route
     Builder.
   - Use warnings, not fear wording: `Surface unknown`, `Trekking-only segment`,
     `Flood alert nearby`, `Seasonal access likely`, `Verify locally`.
   - Let user hide warnings after acknowledging them.

## What Not To Do

- Do not route vehicles over OSM paths, hiking relations, glacier routes, or hut
  connectors.
- Do not imply NDMA/GDACS alerts are complete for local mountain hazards.
- Do not treat Mapbox success as proof of road safety.
- Do not call K2/Baltoro camps "legal campsites" unless a land manager or local
  authority source confirms it.

## Setup Needed

- No key required for Geofabrik, OSM import, HOTOSM download, or GDACS.
- Optional paid/approval sources:
  - Mapbox routing for comparison/fallback.
  - Google Weather API `publicAlerts` if enabled.
  - meteoblue Warnings API if a commercial plan is approved.
- Infrastructure:
  - Enough disk/CPU to build Pakistan Valhalla from a ~150 MB PBF.
  - R2 storage for the artifact.
  - Railway service or equivalent for the Pakistan Valhalla runtime.
