# Trail System Rebuild

Trailhead cannot treat trails as only rendered map paint. Rendered vector tiles are clipped to the current tile and screen, so a selected trail can stop early even when the underlying trail continues offscreen or across tile boundaries. The rebuild separates trail rendering from trail identity and trail navigation.

## Product Direction

- Trail discovery behaves like camp discovery: it searches the current map area, flies to the selected trail, opens a collapsible trail card, and keeps the selected trail highlighted while the user explores.
- The trail card can collapse to a small tab. A separate close affordance clears the highlight.
- A saved trail is a first-class object, not just a note pin. It should keep name, trail system id, geometry id, stats, offline state, nearby camps, and navigation entry points.
- Offline downloads should show base map, contours, routing, and trail graph/overlay as separate capabilities. A state can have maps without trails, or contours without trail graph, and the UI should say that plainly.

## Reference Patterns

- AllTrails treats a selected trail as a full route object with offline maps, navigation, saved lists, reviews/photos, and trail-specific details.
- Trailforks centers trail discovery around trail systems, status, allowed uses, offline regions, and map line selection rather than generic POIs.
- Gaia GPS separates map layers, offline downloads, route planning, track recording, waypoints, and folders. The map can display many layers, but routes/tracks remain explicit user objects.
- OSM hiking and MTB data should come from both way tags and route relations. Useful tags include `route=hiking`, `route=mtb`, `highway=path`, `highway=track`, `sac_scale`, `trail_visibility`, `surface`, `smoothness`, `access`, `bicycle`, `foot`, `horse`, `operator`, `network`, `ref`, and `name`.

## Pack Format

Each trail-capable region should ship two files:

1. `trails/<region>.pmtiles`
   - Vector layer name: `trails`
   - Geometry: line strings for display
   - Required properties: `trail_id`, `system_id`, `segment_id`, `name`, `route_class`, `source`, `allowed_uses`, `surface`, `difficulty`
   - Optional properties: `ref`, `network`, `operator`, `sac_scale`, `trail_visibility`, `seasonal`, `status`, `mvum_symbol`

2. `trail_graph/<region>.jsonl` or compact sqlite/binary graph
   - Node table: id, lng, lat
   - Segment table: segment id, from node, to node, length meters, encoded polyline, metadata id
   - System table: system id, relation ids, display name, bounds, total length, loop/out-and-back/point-to-point classification
   - Spatial index: tile id or R-tree cell to segment ids

The PMTiles file makes the map fast. The graph file makes selection complete.

## Extraction Pipeline

The source-of-truth trail packs should be generated from open line data, not from rendered map tiles. Mapbox can remain an excellent online basemap/navigation provider, but Trailhead should not extract, repackage, or resell Mapbox tile data unless we have a specific commercial agreement that grants those rights.

The first extraction script is:

```bash
python3 scripts/extract_trail_graph.py colorado-latest.osm.pbf --region co --out-dir dist/trail-packs
python3 scripts/extract_trail_graph.py mvum-co.geojson --region co --out-dir dist/trail-packs
```

Outputs:

- `dist/trail-packs/<region>/trails.geojson`
- `dist/trail-packs/<region>/trail_graph.json`
- optionally `dist/trail-packs/<region>/trails.pmtiles`

If `osmium` and `tippecanoe` are installed, the production flow is:

```bash
python3 scripts/extract_trail_graph.py <state>.osm.pbf --region <state> --out-dir dist/trail-packs
tippecanoe -o dist/trail-packs/<state>/trails.pmtiles -zg --drop-densest-as-needed --extend-zooms-if-still-dropping -l trails dist/trail-packs/<state>/trails.geojson
```

The repo-local Python extraction path does not need system `sudo`:

```bash
python3 -m venv .venv-trails
.venv-trails/bin/pip install osmium mapbox-vector-tile shapely pmtiles
.venv-trails/bin/python scripts/extract_trail_graph.py --region co --download-geofabrik --pmtiles --out-dir data/trails
.venv-trails/bin/python scripts/start_trail_state_queue.py co ut az ca
python3 scripts/publish_trail_packs.py co
```

Published R2/Worker contract:

- `GET /api/trail-packs/manifest.json`
- `GET /api/trail-packs/<region>.pmtiles`
- `GET /api/trail-packs/<region>.graph.json`

Mobile downloads store:

- `FileSystem.documentDirectory/offline/trails/<region>.pmtiles`
- `FileSystem.documentDirectory/offline/trails/<region>.graph.json`

Data priorities:

- OSM/Geofabrik extracts for hiking, MTB, track, path, footway, bridleway, and route relation coverage.
- USFS MVUM/public agency data for motorized access legality and road/trail status.
- Trailhead community edits as an app-owned overlay.
- Optional Mapbox services for premium online basemap/navigation experiences, not offline graph extraction.

## Selection Algorithm

1. Snap tap or discovery point to the nearest graph segment within a tolerance that scales by zoom.
2. Prefer matching name/ref/relation id when the selection came from a trail list.
3. Expand from the snapped segment through connected graph edges while metadata remains compatible.
4. Stop at named intersections, access/class changes, or when length and topology indicate a separate system.
5. Return a complete `TrailSystem` object:
   - `id`, `name`, `bounds`, `center`
   - `geometry` as GeoJSON MultiLineString
   - `stats`: distance, elevation when available, estimated time, loop type
   - `segments`: segment ids and sources
   - `support`: camps, water, fuel, reports nearby

## Navigation

Trail navigation should be a two-part route:

1. Drive or ride route to trailhead using the existing route engine.
2. On-trail follow mode using the selected trail graph geometry.

The native navigation session can already track progress against coordinates. Trail follow mode should start with graph geometry, lower off-route thresholds, and show trail-specific warnings such as wrong fork, closed segment, or leaving the corridor.

## Single-Trail Offline Download

A selected trail must be downloadable without forcing a full state pack. The app now treats the selected highlight as an offline trail object:

- `Download` stores the selected trail metadata plus highlighted geometry in `offline_trails/<trail_id>.json`.
- `Follow` starts navigation against that saved/highlighted geometry when at least two line coordinates are available.
- If only a trailhead point is available, the app falls back to road navigation to the trailhead and explains that a graph pack is needed for full offline trail follow.

The production version should replace highlight-derived geometry with graph-pack geometry:

1. User taps trail.
2. App snaps to nearest `trail_graph/<region>` segment.
3. App expands the complete loop/system geometry.
4. User taps `Download`.
5. App saves:
   - selected trail geometry
   - graph edge ids
   - trail metadata and stats
   - nearby camps/water/fuel/report support
   - minimal map corridor tiles or the state trail PMTiles dependency marker
6. `Follow` runs on-trail navigation from that local object with no signal.

## Current Implementation Bridge

The current app now has:

- A native tile-server lane for `/api/trails/{z}/{x}/{y}.pbf`
- Local trail PMTiles loading hooks in `NativeMap`
- Dedicated trail overlay styling in `mapStyle`
- A rendered-feature highlighter as fallback preview only
- Single-trail offline object saving/follow mode from the selected highlight

The fallback highlighter is not the final trail engine. It stays useful for online/base-map trails until graph packs are generated, but complete loops require the graph pack.
