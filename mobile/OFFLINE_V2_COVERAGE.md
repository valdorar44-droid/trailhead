# Offline V2 coverage and migration contract

Offline V2 is additive. It does not replace, import, or delete a legacy pack in
1.0.10. The selected-area and trip UI reads both systems and uses the compatible
legacy Trailhead-vector path when V2 is unavailable or a trip exceeds the
current single-region preparation limit. It never substitutes that pack for an
exact Mapbox, satellite, hybrid, or 3D style.

| Existing surface / artifact | V2 coverage | Canonical owner | Compatibility behavior | Readiness evidence |
|---|---|---|---|---|
| RNMapbox selected-area map | Exact manifest style URI, immutable RNMapbox pack, bounds and zoom range | RNMapbox offline manager + V2 installation pointer | Existing packs remain listed. A complete compatible legacy pack is `Map saved`; incomplete, style-incompatible, coverage-incompatible, or renderer-mismatched packs are `Repair required`. Only verified V2 map plus its real consumers is `Ready offline`. | V2 uses native pack identity/percentage plus a render snapshot probe. Legacy packs use a style-coverage preflight and the active renderer's native status. |
| Saved trip and route geometry | Saved before V2 preparation; V2 adds map, places, trails, and search artifacts | Existing `TripRepository` and offline-trip cache | No second trip or route store. Long trips outside the 12-degree V2 region limit retain the corridor downloader. | Owned trip resolution and stored route geometry |
| Trip corridor map | V2 route-bound map when supported | V2 runtime, with existing corridor pack as fallback | Existing corridor pack remains usable and removable only by an explicit user action. | Same RNMapbox probe and manifest verification |
| Canonical places and compact sheets | Immutable `places` artifact containing every eligible intersecting canonical record | Server materializer; V2 repository on device | Existing trip/region place packs continue to load. V2 does not erase them. | SHA-256, exact byte count and manifest record count |
| Campgrounds and V1 place families | Included through the canonical places artifact, including compact campground details plus camps, essentials, services, outdoors, specialized water, and trek-place inventory supplied by the materializer | Canonical data plus redistribution-safe V1 place packs | Existing packs remain the fallback until a verified V2 artifact is installed. Pakistan curated fallback packs fail preparation explicitly until redistribution rights are documented. | Artifact hash/count; family-count, search-join, and place-sheet parity tests remain release gates |
| Trails and geometry | Immutable intersecting `trails` artifact | Canonical Trailhead trail data | Existing regional trail packs remain usable and contribute to current readiness. | SHA-256, bytes and exact record count |
| Offline text/spatial search | Prebuilt SQLite artifact with FTS5 and R-tree tables | V2 SQLite artifact plus the installed canonical place catalog | Additive. A pressed FTS row rejoins its full downloaded document before opening a sheet. Search is never reported ready merely because the file downloaded. | `PRAGMA quick_check`, exact table modules/schema and exact document count; canonical-document join test |
| Routing and contours | Not requested by the 1.0.10 V2 mobile flow | Existing native routing/contour stores | Existing regional routing and contour packs remain available. The saved trip route is the only V2-era directions signal until navigation has a verified artifact consumer. | Existing routing/contour store checks and saved route geometry |
| Licensed thumbnails | Deferred for the 1.0.10 client | Canonical source catalog | License and attribution metadata remain in source records, but the server does not publish and the phone does not download a thumbnail/media artifact until a verified local-photo consumer exists. | Manifest media capability remains false |
| Originals bundles and listening progress | Unchanged | Existing immutable Originals bundle, access and session stores | Plan aggregates the section but does not copy ownership, files, or progress into Offline V2. | Existing Originals bundle verification |
| Entitlements and ownership | Unchanged; backend preparation remains authenticated and feature-gated | Existing product feature and account scope | V2 jobs, manifests and installation pointers are account-scoped. Switching accounts does not reclassify another account's files. | Owner-scope checks on create/list and server authorization |
| Weather, fire, current reports, closures, availability and reservations | Online only | Existing live providers | Never advertised as available offline. | Live-source timestamp/availability UI |

## Atomic and repair behavior

- Downloads stage under a temporary immutable revision directory.
- Exact size and SHA-256 verification, SQLite validation, and the active
  renderer probe must all pass before the current pointer changes.
- The previous verified revision remains current while an update downloads.
- A corrupt stage is discarded, unsafe resume tokens are cleared, and the UI
  shows `Repair required`; repair writes a fresh stage.
- Removal requires an explicit user action. Inspection and classification have
  no deletion side effects.

## Automated evidence

- `npm run test:offline-v2` covers manifest immutability, exact hashes and
  counts, active-renderer probing, `Map only` / `Repair required` legacy labels,
  interrupted staging, 200/202 preparation, pause/resume, storage preflight,
  corrupt-transfer repair, and previous-good revision retention.
- `npm run test:plan-deep-links` proves external identifiers resolve only
  against canonical owned items and do not create a second ownership store.
- Physical airplane-mode and RNMapbox rendering tests remain required on the
  paired Android/iOS preview; a JavaScript unit test cannot prove native tile
  availability.
