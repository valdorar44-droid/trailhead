# Discovery Bridge V1 Audit

Date: 2026-06-27

## Checkpoint

Added a shared `/api/discovery/context` backend bridge for camp and stay discovery. The first mobile caller is map camp discovery; Route Builder, Explorer, AI Planner, and Co-pilot can move onto the same bridge next.

## Source Handling

- Keeps RIDB/Recreation.gov, BLM, OSM, ACTIVE, Geoapify private stays, and international camp hooks behind the backend.
- Caches viewport discovery responses in `campsite_cache` with a refresh window.
- Returns source counts and source errors to backend/client code without surfacing provider/debug wording in the map sheet.
- Uses Geoapify only for lightweight place-list coverage in this checkpoint. Place Details, Static Maps, Boundaries, Routing, Matrix, and Route Planner stay off until each has a specific product path and cache policy.

## OSM Camp Expansion

Expanded camp/stay OSM extraction to include additional backcountry shelter tags and guarded informal/backcountry camp indicators. Broad `amenity=shelter` results are filtered unless tags look overnight-relevant.

## Mobile Behavior

- Camp discovery now calls the bridge first.
- Existing bbox/radius camp endpoints remain as fallback.
- Loading and empty copy avoids zero-count titles while results are still warming up.

## Next Checkpoint

- Move AI Planner, Co-pilot, Route Builder, and Explorer area context to `/api/discovery/context`.
- Add a true generated camp/stay tile or bbox-pack job from Geofabrik/official source imports so far-zoom pins come from cached map-ready packs instead of live source fanout.
- Add admin/manual refresh controls for old cached camp records by area/source.
