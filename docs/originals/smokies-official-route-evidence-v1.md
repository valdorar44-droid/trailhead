# Great Smoky Mountains Original — Official Route Evidence V1

Reviewed: 2026-08-05  
Status: authoring evidence only; public release remains blocked

## Source decision

Trailhead uses the National Park Service `NPS Public Roads Geographic` layer as
the durable reference source for route display, story-cue projection, bounds,
and future offline coverage. The checked snapshot contains only records marked:

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

## Reproducible snapshot

- Source records in GRSM: 1,926.
- Reviewed chapter-road records: 639.
- Excluded as unrelated to the four chapters: 1,287.
- Source CRS: NAD83(2011), NPS WKID 104145.
- Output CRS: EPSG:4326 using the pinned ArcGIS transformation 108363 in reverse.
- Coordinate precision: seven decimal places.
- Geometry simplification: none.
- Endpoint merge tolerance: one metre.
- Snapshot SHA-256: `667962182156619a6f24b836d5fc8d036bff8117b93a0137956e902d9b702027`.
- Route-spec SHA-256: `025db561e9cd1cc77e65f6a738e96548943a031d0f14d90b0fc1d6685af1a65b`.
- Compiler version: `1.1.0`.
- Compiler-source SHA-256: `2da05e38dccd52b5d4198523fa14d3d5c6c35b015456e5c638676087ed95b137`.
- Algorithm-contract SHA-256: `a616137a9637fa7649f22325ff0e6ab65655030806e50501d6762d21c91eab22`.
- Route-evidence SHA-256: `ce9e35b42f60d0eaa02b501dbc70a0d3973be0e4b49b0332ae761a75ceeeb9f2`.

The refresh process retrieves sorted GRSM object IDs first, then downloads
pinned batches of 500 with an exact field list. It hashes layer metadata before
and after retrieval and aborts if the layer changes mid-snapshot. Object IDs are
retrieval handles only; persisted identities use `GEOMETRYID` and `FEATUREID`.

The normalizer rejects unknown facilities, hidden or restricted records,
changed maintainers/classes, missing stable IDs, coordinates outside the
reviewed park envelope, implausible internal jumps, unexpected counts, source
hash drift, or unreviewed seams.

## Chapter results

| Variant | Reference length | Result | Notes |
|---|---:|---|---|
| Mountain Crossing, TN → NC | 69,101.1 m | Blocked | NPS geometry ends about two kilometres north of the Cherokee endpoint. The full chapter needs an authoritative EBCI or NCDOT extension. |
| Mountain Crossing, NC → TN | 68,831.7 m | Blocked | Independently resolved through source-directed lanes; it carries the same Cherokee blocker. |
| Little River and Cades Cove | 56,937.5 m | Blocked | Route and cue projections are useful, but five NPS loop segments conflict with the declared digitized one-way direction and require source review. |
| Roaring Fork | 8,561.4 m | Candidate | Continuous directed reference geometry. Seasonal/current availability still gates Start Tour. |
| Foothills Parkway, west → east | 50,816.7 m | Candidate | Includes the reviewed FHWA Missing Link and Wears Valley access-road records whose facility IDs are blank. |
| Foothills Parkway, east → west | 50,816.7 m | Candidate | Exact reverse of the accepted west-to-east reference line. |

“Candidate” means the static reference geometry passed this source packet. It
does not mean a road is currently open, safe for a particular vehicle, or ready
for public narration.

### Cades Cove direction conflict

The five source geometry IDs that require review are:

- `008ef10d-f967-4bd4-a210-2184dc1e85e1`
- `160be5ea-ae63-4498-bb61-900d174ae5b2`
- `20fd255b-e779-4922-bc39-fd663ea73ca3`
- `e165ffe3-8f56-47e4-902b-9937312df435`
- `f117d383-5e50-4e7f-95c3-8b862c38370e`

Trailhead pins this exact reviewed anomaly set. A source refresh that adds,
removes, or changes any of these conflicts fails the compiler rather than
silently promoting the route. Trailhead does not silently reverse those
records. The assembled line remains blocked until NPS data support or another
authoritative source resolves the direction discrepancy through a reviewed
source revision.

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

Rebuild route evidence from the checked snapshot without network access:

```bash
python scripts/build_smokies_official_routes.py --build
```

Verify deterministic checked artifacts without network access:

```bash
python scripts/build_smokies_official_routes.py --check
```

## Remaining route gates

- Add and review a permanent authoritative Cherokee connector or revise the
  Mountain Crossing endpoint through product/editorial approval.
- Resolve the five Cades Cove one-way source conflicts.
- Add a trusted current road/closure observation contract.
- Bind vehicle restrictions to the server-owned saved rig.
- Complete editorial and EBCI cultural review before narration.
- Create a new immutable snapshot and route revision whenever accepted source
  geometry changes; never edit a published pack in place.
