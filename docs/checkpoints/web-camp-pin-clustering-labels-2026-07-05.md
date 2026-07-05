# Web Camp Pin Clustering + Name Labels — 2026-07-05

## Scope

User feedback while auditing Mapbox Standard/Outdoors modes: "one place will have a
huge grouping" of site pins, and "im not seeing the place names outside the pin /
master camp place." Reproduced against Sand Flats Recreation Area near Moab, UT.

## Root Cause

Two compounding issues, both isolated to the web renderer
(`mobile/components/NativeMap/index.web.tsx`):

1. **No clustering on web.** `syncWebMarkers` drew one full-size `mapboxgl.Marker`
   DOM pin per entry in `props.camps`, with zero grouping. RIDB (facility-level) and
   OSM (individual loop/site-level) camp data are both ingested into the same camps
   feed, so a single physical recreation area can surface as 8–10+ separate map
   entries: `Sand Flats Recreation Area Group Campsites` (RIDB) plus OSM sub-features
   `SFRA Loop A - Alcove Campground` … `SFRA Loop H - Hawk Campground`, several
   anonymous `Tent camp` nodes, and a lone `Site 1` node — all within ~1.5 km of each
   other. Each rendered as an identical unlabeled teal "C" dot, stacked directly on
   top of one another. (The **native** renderer already had `MapGL.ShapeSource
   cluster` support — see `map-tab-native-cluster-crash-2026-07-03.md` — so this was
   web-only.)
2. **No persistent name labels.** `markerElement()` only put a 1–2 letter code inside
   the circle; the real name lived solely in the `title`/`aria-label` attributes,
   which surface as a native browser hover tooltip — useless on touch devices and
   impossible to read when many pins overlap.
3. **Duplicate camp pins.** Verified via `/api/discovery/context` that several RIDB
   campgrounds (e.g. `Goose Island Campground`, `Jaycee Park Campground`) also show up
   in the app's separately-fetched `pois` feed (smart-pack / Foursquare-style nearby
   places), so the same campground drew twice: once correctly (teal "C" circle) via
   the camps loop, and once again via the POI loop (blue circle, no label, generic
   `poiMarkerCode` "C" code), compounding the clutter.

## Fix (`mobile/components/NativeMap/index.web.tsx`)

- **`clusterCampsForMap(camps, map)`** — new zoom-aware greedy clustering pass. Uses
  the current `map.getZoom()` to convert a ~42px on-screen radius into meters
  (`156543.03392 * cos(lat) / 2^zoom`), then unions camps whose great-circle-ish
  distance (`approxMetersBetween`, equirectangular approximation) falls inside that
  radius into a single cluster. Runs in `O(n²)` which is trivial at the existing
  `WEB_CAMP_MARKER_LIMIT` (360) cap.
- **`campClusterScore(camp)` / representative selection** — for each cluster, picks
  the most useful member to represent the group: prefers an official
  Recreation.gov/RIDB facility, then reservable/photographed listings, then
  non-generic names (rejecting `Tent camp`, `Site N`, `RV / caravan site`, etc. via
  `GENERIC_CAMP_NAME_RE`), so `Sand Flats Recreation Area Group Campsites` (the real
  facility) is chosen over its own anonymous OSM loop/site sub-features.
- **`campClusterLabel(cluster)`** — `"Up the Creek Campground · 4 sites"` for groups,
  or just the plain name for a single, unclustered camp.
- **`markerElement()` rewritten** to build a small wrapper `<div>` sized exactly to
  the circle (so Mapbox's `anchor: 'center'` math still pins the circle dot to the
  exact coordinate) plus an absolutely-positioned, non-interactive name-label pill
  floating to the right of the circle — visible at all times, not just on hover.
  Cluster pins get a darker teal (`#0f766e`) and a numeric count instead of a letter
  code.
- **Re-clustering on zoom** — added a `zoomend` map listener (using a `latestPropsRef`
  to avoid stale closures) that re-runs `syncWebMarkers`, so zooming in naturally
  shrinks the pixel-radius-in-degrees threshold and "expands" a cluster back into its
  individual named pins, matching normal map cluster UX.
- **POI/camp dedupe** — `syncWebMarkers` now skips any `props.pois` entry whose
  `poiMarkerCode(type) === 'C'` before drawing POI markers, since camp-shaped places
  are already fully handled (with grouping + labels) by the dedicated camp pass.
- Tapping a cluster calls `onCampTap(cluster.representative)` — identical to tapping
  a single camp today (opens the representative's existing detail card). No new UI/
  bottom-sheet was introduced; zooming in is still how a user reaches the individual
  sub-sites if they want them.

## Validation

- `cd mobile && npx tsc --noEmit` — clean, both before and after the POI-dedupe pass.
- `node scripts/map-smoke-playwright.mjs --url http://127.0.0.1:8082/map` — PASS, 0
  console/page errors, no blocked-copy hits.
- Manual Playwright pass against `npx expo start --web`:
  - Before the fix: Sand Flats area showed `Sand Flats Recreation Area Group
    Campsites`, `Sand Flats Recreation Area` (POI dupe), 8x `SFRA Loop *`, several
    `Tent camp`, and `Site 1` as separate unlabeled dots — confirmed via DOM
    inspection (`.mapboxgl-marker` had no label `<span>`, single circle only).
  - After the fix, running "Search camps and stays in this area" near Moab: every
    result renders exactly once, each with a visible name label, e.g.
    `Goose Island Group Sites · 4 sites`, `Grandstaff Campground · 2 sites`,
    `Sun Outdoors Arches Gateway · 3 sites`, `Up the Creek Campground · 2 sites`,
    `Dispersed tent site · 2 sites`, and standalone `Juniper Campground` /
    `Sand Flats Recreation Area Group Campsites` with no "· N" suffix.
  - Confirmed re-clustering on zoom: the same physical group read `4 sites` at one
    zoom level and `5 sites` after zooming out one step (pixel radius covering more
    ground), with no manual refresh needed.
  - Confirmed the POI-duplicate blue dots (e.g. a second, unlabeled "Goose Island
    Campground" circle) no longer appear alongside the labeled camp cluster pin.

## Remaining / Follow-ups

- This fix is web-renderer only (`index.web.tsx`). Native (`NativeMap/index.tsx`)
  already clusters via `MapGL.ShapeSource cluster` + `clusterRadius`, but that
  clustering is purely pixel-proximity based with no representative-name selection
  or generic-name filtering — a cluster bubble on native just shows a count, never a
  name. A native follow-up could reuse `campClusterScore`'s representative-picking
  logic (e.g. surfaced via a backend-side "primary site" flag) so a tapped/expanded
  native cluster also prioritizes the RIDB facility over anonymous OSM sub-sites.
- The underlying data duplication (facility + individual OSM loop/site nodes ingested
  as siblings, and camp-shaped entries also leaking into the generic POI/smart-pack
  feed) still exists upstream; this is a render-layer mitigation, not a data-pipeline
  fix. If OSM ingestion adds more sub-site node types, `GENERIC_CAMP_NAME_RE` may need
  new patterns to keep picking sensible representative names.

## Release

- Pending commit / OTA — see follow-up commit for hash and update-group IDs.
