# Great Smoky Mountains Original — Official Route Evidence V1

Reviewed: 2026-08-05  
Status: authoring evidence only; public release remains blocked

## Source decision

Trailhead uses the National Park Service `NPS Public Roads Geographic` layer as
the primary durable reference source for route display, story-cue projection,
bounds, and future offline coverage. The checked snapshot contains only records
marked:

- `UNITCODE = GRSM`
- `RDSTATUS = Existing`
- `ISEXTANT = True`
- `PUBLICDISPLAY = Public Map Display`
- `DATAACCESS = Unrestricted`
- `XYACCURACY = >=1m and <5m`

The geometry is public-domain U.S. Government data. Trailhead must retain
source attribution and a no-endorsement notice. NPS names, marks, and the
Arrowhead are not treated as public-domain artwork.

This source is not a live closure feed and is not the turn-by-turn navigation
engine. At runtime:

1. NPS evidence supplies the durable reference line and cue projections.
2. Trailhead/Mapbox supplies current routable maneuvers.
3. A separate current-road readiness check controls whether a chapter may
   start.

No Mapbox candidate geometry is persisted in this evidence.

The Mountain Crossing extension from the NPS Oconaluftee edge into Cherokee is
from the official NC OneMap NG911 Centerlines service. Its selected 23 records
have stable `nguid` identities under `ebcinctb1.swain.nc.us`; both municipality
fields identify the Eastern Band of Cherokee Indians. NC OneMap's checked terms
state that partner content follows a free and unrestricted use policy and that
written release agreements are not required. Trailhead retains the source
terms snapshot, exact query, source hashes, EBCI lineage, and attribution. The
4.2–4.9 metre NPS/NC OneMap centerline offset is recorded as an explicit,
reviewed cross-source handoff and is not allowed to widen beyond 10 metres.

## Reproducible snapshot

- Source records in GRSM: 1,926.
- Reviewed chapter-road records: 639.
- Excluded as unrelated to the four chapters: 1,287.
- Source CRS: NAD83(2011), NPS WKID 104145.
- Output CRS: EPSG:4326 using the pinned ArcGIS transformation 108363 in reverse.
- Coordinate precision: seven decimal places.
- Geometry simplification: none.
- Endpoint merge tolerance: one metre.
- Reviewed NPS/NC OneMap handoff maximum: 10 metres.
- Snapshot SHA-256: `667962182156619a6f24b836d5fc8d036bff8117b93a0137956e902d9b702027`.
- Supplemental-source SHA-256: `64e4617f24c2c22908dbfee4b4da8b8d80500e25edf5326d21e6adcc44d20684`.
- Route-spec SHA-256: `025db561e9cd1cc77e65f6a738e96548943a031d0f14d90b0fc1d6685af1a65b`.
- Compiler version: `1.2.0`.
- Compiler-source SHA-256: `ba9c2957684631c693b6a5147921486f9eefd5b8baf6d21ce6df1189a08890a9`.
- Algorithm-contract SHA-256: `4a826d6209dce92bdb7928ed961acaead1069c320cbc504b037bb9381bbffadc`.
- Route-evidence SHA-256: `95f199551ac949b081f0a8a55d46e0bf261987b211be08835f93387258844159`.

The refresh process retrieves sorted GRSM object IDs first, then downloads
pinned batches of 500 with an exact field list. It hashes layer metadata before
and after retrieval and aborts if the layer changes mid-snapshot. Object IDs are
retrieval handles only; persisted identities use `GEOMETRYID` and `FEATUREID`.

The normalizer rejects unknown facilities, hidden or restricted records,
changed maintainers/classes, missing stable IDs, coordinates outside the
reviewed park envelope, implausible internal jumps, unexpected counts, source
hash drift, or unreviewed seams.

### Supplemental evidence sources

- NC OneMap NG911 Centerlines layer:
  `https://services.nconemap.gov/secure/rest/services/NC1Map_Transportation/FeatureServer/0`
- NC OneMap item information:
  `https://services.nconemap.gov/secure/rest/services/NC1Map_Transportation/FeatureServer/0/iteminfo`
- NC OneMap terms:
  `https://www.nconemap.gov/pages/terms`
- Checked terms-data hash:
  `658e20ec4cb792d4b0a713d2c5cfda12622a33a17f6d5848f062338de97be134`
- Checked connector query hash:
  `0628a72f02b604a791b72966f3696d3becdf2dd2159e97ab934334550bb12771`
- Checked normalized connector hash:
  `b771cf89c50445c4686f50d7753a30a092c1d0bdfe7de5955eb2d05c2c58f925`
- Current park-specific GRSM roads layer:
  `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/GRSM_ROADS/FeatureServer/0`
- Current GRSM item:
  `https://www.arcgis.com/sharing/rest/content/items/cbe5d107b9bf451fa9e1ca903d7a9f48`
- Official park map:
  `https://www.nps.gov/grsm/planyourvisit/upload/grsmmap_2024_reduced_508.pdf`
- Checked GRSM query hash:
  `a777de3c055f84a84c779d48c90a2cb43bed491acaec81fbb989881e89aa9d05`
- Checked map-PDF hash:
  `7cc2dc86a08f2b506f0900170e5e242247ca245e2c80dad44cdf037d0d27b933`

## Chapter results

| Variant | Reference length | Result | Notes |
|---|---:|---|---|
| Mountain Crossing, TN → NC | 73,505.4 m | Candidate | NPS reference geometry joins the pinned NC OneMap EBCI-lineage connector at a recorded 4.862 m source offset. |
| Mountain Crossing, NC → TN | 73,230.7 m | Candidate | Independently resolved through source-directed lanes, with a recorded 4.2 m source offset. |
| Little River and Cades Cove | 56,937.5 m | Candidate | Five source-direction anomalies are covered by the exact reviewed GRSM crosswalk and official-map override below. |
| Roaring Fork | 8,561.4 m | Candidate | Continuous directed reference geometry. Seasonal/current availability still gates Start Tour. |
| Foothills Parkway, west → east | 50,816.7 m | Candidate | Includes the reviewed FHWA Missing Link and Wears Valley access-road records whose facility IDs are blank. |
| Foothills Parkway, east → west | 50,816.7 m | Candidate | Exact reverse of the accepted west-to-east reference line. |

“Candidate” means the static reference geometry passed this source packet. It
does not mean a road is currently open, safe for a particular vehicle, or ready
for public narration.

### Cades Cove direction override

The five source geometry IDs that require review are:

- `008ef10d-f967-4bd4-a210-2184dc1e85e1`
- `160be5ea-ae63-4498-bb61-900d174ae5b2`
- `20fd255b-e779-4922-bc39-fd663ea73ca3`
- `e165ffe3-8f56-47e4-902b-9937312df435`
- `f117d383-5e50-4e7f-95c3-8b862c38370e`

Their current park-specific crosswalk is:

| National `GEOMETRYID` | Current GRSM `GlobalID` | Object ID |
|---|---|---:|
| `008ef10d-f967-4bd4-a210-2184dc1e85e1` | `9ee04325-3318-41d2-883a-1005f58cb29d` | 1255 |
| `160be5ea-ae63-4498-bb61-900d174ae5b2` | `f0000aca-f855-4196-86f2-23dbda878670` | 1270 |
| `20fd255b-e779-4922-bc39-fd663ea73ca3` | `ff5c1bc2-b513-4b80-98a2-0bd7295608c2` | 1271 |
| `e165ffe3-8f56-47e4-902b-9937312df435` | `77c44571-dbdc-45dd-873d-2cdf9abf9b35` | 1254 |
| `f117d383-5e50-4e7f-95c3-8b862c38370e` | `891458c4-694b-4f7f-b948-81700117a132` | 98 |

Trailhead pins this exact reviewed anomaly set and its current GRSM `GlobalID`
crosswalk. The official 2024 park map shows the northern leg westbound and the
southern leg eastbound, matching the authored counterclockwise traversal. The
current park-specific `GRSM_ROADS` layer still labels all five source records
`With Digitized`, so Trailhead preserves their geometry and applies a narrowly
scoped `CadesDirectionOverrideV1` only to these five reverse traversals.

A refresh that adds, removes, re-identifies, changes, or reorients any member
fails the compiler. The pinned GRSM layer, item, query, and map-PDF hashes must
also remain unchanged until reviewed. This static direction decision does not
control closures, vehicle-free Wednesdays, weather availability, or Start Tour
readiness.

John Oliver Place, Abrams Falls Trailhead, and Cable Mill are intentionally
projected story landmarks, not route waypoints. This removes the detours seen
in the temporary Mapbox authoring candidate. The official campground entrance
connector closes the drive near the authored Cades Cove exit without inventing
a straight-line bridge.

## Commands

Refresh the official snapshot only when a new source review is intended:

```bash
python scripts/build_smokies_official_routes.py --refresh-source
```

Refresh the reviewed NC OneMap and Cades evidence only after intentionally
reviewing all pinned source and terms changes:

```bash
python scripts/build_smokies_official_routes.py --refresh-supplemental-sources
```

Rebuild route evidence from the checked snapshot without network access:

```bash
python scripts/build_smokies_official_routes.py --build
```

Verify deterministic checked artifacts without network access:

```bash
python scripts/build_smokies_official_routes.py --check
```

## Remaining route gates

- Add a trusted current road/closure observation contract.
- Bind vehicle restrictions to the server-owned saved rig.
- Complete editorial and EBCI cultural review before narration.
- Create a new immutable snapshot and route revision whenever accepted source
  geometry changes; never edit a published pack in place.
