# Offline V2 coverage and V1 compatibility

Offline V2 is additive. It does not delete, rewrite, or silently mark an existing
`offline_downloads` record, saved trip, route, Trailhead Original, or V1 map pack
as ready/invalid. The mobile coordinator retains the last verified revision until
the replacement revision has fully downloaded and passed its renderer probe.

| Existing capability | V2 artifact / owner | Compatibility rule |
|---|---|---|
| V1 map authorization and existing packs | Existing `/api/offline/authorize` and `offline_downloads` | Endpoint and ownership store remain available during migration. |
| Active map style | RNMapbox `renderer_style_pack` descriptor | The client sends only `renderer_style_id`; the server resolves it through the approved allowlist, binds ID/URI/revision into bundle hashes, and echoes `renderer.style_id`. Arbitrary client URIs are rejected. The phone performs and probes the native style-pack install. Older clients retain the server default. |
| Map tiles in the selected area | RNMapbox `renderer_tile_region` descriptor with exact tile count, bounds, and zoom range | The phone performs the native tile-region install. Missing style/token provisioning fails explicitly. |
| Canonical places and compact sheets | Immutable `places` JSON | Includes every eligible, redistribution-compatible canonical record intersecting the box. Exact total, category, and source counts are embedded in the artifact. |
| Existing camps, essentials, services, outdoors, water, and trek-place packs | Merged into immutable `places` JSON by stable source/ID | Existing V1 packs remain untouched. V2 adds only intersecting OSM or official/public-data records, records each contributing pack's SHA-256 revision, deduplicates overlap, and excludes unknown providers and bare/unlicensed photo URLs. Pakistan curated fallbacks currently fail preparation explicitly because their checked-in packs do not document redistribution rights; they cannot produce a false Ready bundle. |
| Campground details | `places` JSON | Preserves site/camp types, amenities, campsite rows/counts, rig/vehicle/trailer/RV lengths and suitability, durable access/reservation fields, and official/booking URLs. Canonical and packaged fields merge instead of replacing one another. |
| Trail details and geometry | Immutable `trails` GeoJSON | Requires real intersecting geometry; an anchor-only trail cannot claim coverage. |
| Search | Prebuilt SQLite `search_index` with FTS5 and R-tree | Additive. It is marked ready only after SQLite integrity/schema/count validation. |
| Licensed thumbnails | Deferred for the 1.0.10 client | Canonical source records keep image URL, license, and attribution metadata, but the manifest does not publish a thumbnail/media artifact or capability until mobile can atomically install it and resolve verified local photo paths. |
| Saved trip and route linkage | Existing `trip_documents_v2`, trip graph, and route stores | Unchanged by area-bundle preparation; route-linked downloads keep their current ownership and progress. |
| Trailhead Originals | Existing version-pinned Originals manifests/assets/progress | Unchanged and not duplicated into the area bundle. Originals keep their dedicated immutable downloader. |
| Entitlements | Existing `authorize_offline_download` check | Rechecked for every non-ready preparation; account details and balances are not disclosed by failures. |
| Interrupted downloads | V2 immutable URL, SHA-256, ETag, Range, and If-Range | A stale `If-Range` receives a complete `200`, preventing bytes from different revisions being appended. |

Weather, fire, current reports, closures, reservation inventory, current
availability, and current conditions are deliberately online-only. They are not
represented as cached facts inside a V2 place artifact.

The focused contract and end-to-end coverage lives in
`tests/test_offline_bundles_v2.py`, including campground field parity, volatile
field exclusion, GeoJSON geometry, SQLite FTS5/R-tree integrity, deferred media,
exact hashes/counts/bytes, background preparation, private delivery, Range,
ETag, stale-resume behavior, rich campground parity, UT/CA/TX family-count
fixtures, and explicit Pakistan rights-failure behavior.
