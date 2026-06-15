# Pakistan K2 Offline Validation Audit

Date: 2026-06-15

## What Was Added

- Built and published `pk-essentials` with 73 curated Pakistan/Karakoram points.
- Patched the Pakistan trail artifacts with a trek-only `Classic K2 Base Camp Trek`
  corridor.
- Republished Pakistan trail PMTiles, selection graph, and route graph.

## Public Artifact Sizes

- `pk-essentials.json`: 73 points, 0 failed cells.
- `trails/pk.pmtiles`: 26,754,487 bytes.
- `trails/pk.graph.json`: 70,356,129 bytes.
- `trails/pk.route.jsonl.gz`: 47,931,630 bytes.

## K2 Connectivity Probe

Before the patch, the dense Pakistan trail graph connected Paju to K2 Base Camp,
but did not connect the lower Askole to Paju approach. After the curated trek
corridor patch, all classic corridor waypoint legs connected:

- Askole to Korophon: connected.
- Korophon to Bardumal: connected.
- Bardumal to Paju: connected.
- Paju to Liligo: connected.
- Liligo to Urdokas: connected.
- Urdokas to Concordia: connected.
- Concordia to K2 Base Camp: connected.

## Safety Label

The patched route is a simplified offline trek-follow corridor. It must stay
labeled as trekking-only and should not be used as vehicle routing or as proof of
safe glacier travel. Users still need local guide, permit, bridge, weather,
glacier, and access verification.

## Remaining Work

- Add elevation and slope scoring for the K2 corridor.
- Add route confidence UI that surfaces `trekking_only` clearly in Route Builder
  and map follow mode.
- Add Pakistan contour/DEM overlay once a global contour source is selected.
