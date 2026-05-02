# Trail Discovery Roadmap

Goal: make Trailhead feel like an overlanding app that also handles hiking and trail discovery cleanly, without crowding the main map controls.

## OTA cleanup pass

- Keep the main map controls lean.
- Move Public Lands, USGS Trails/Topo, MVUM, weather, and trusted condition overlays into the Map Layers drawer.
- Do not use a separate Trail Mode button that duplicates adjacent trail/topo controls.
- Do not auto-open the filter drawer when enabling trail-related layers.
- Keep trail community pins available through normal filters.
- In the current native map, only expose overlay rows that are actually wired and useful:
  - Public Land Tint,
  - USGS Topo + Trails,
  - Trailheads + Water POIs,
  - Active Wildfires,
  - Avalanche Zones,
  - Rain Radar,
  - MVUM.
- Hide unfinished native rows such as 3D terrain, NAIP, and OSM road-surface overlay until they are truly wired.
- MVUM queries must use a JSON ArcGIS envelope and lowercase GeoJSON field names such as `passengervehicle` and `highclearancevehicle`.

## Product direction

- Treat trails as a discovery and route-planning workflow, not only a visual overlay.
- Search should support parks, trails, trailheads, viewpoints, waterfalls, hot springs, and hiking areas.
- Tapping a trail or trailhead should open a polished trail card with:
  - trailhead navigation,
  - nearby camps,
  - nearby fuel/water,
  - community trail condition reports,
  - save/add note/report actions,
  - later: length, elevation, estimated time, difficulty, surface, photos, and offline status.
- Route Builder should let users build drive-and-hike days:
  - camp or start,
  - fuel/resupply,
  - trailhead or POI,
  - camp/motel/end.

## Later native/data work

- Build or import real trail route geometry, not just visual overlay lines.
- Add routable hike/trail mode with exact trail-line navigation where data supports it.
- Add elevation profile, distance markers, off-route alerts, and track recording.
- Add downloadable trail packs that live alongside state map/routing packs.
- Consider community heat/activity signals after privacy rules are designed.
- Add visible loading/error states for condition overlays so failed feeds do not look like silent no-op toggles.
