# Safe Water Hydro Pipeline

Safe Water hydro packs are separate from land contour packs. They are awareness
layers only, not certified navigation charts or turn-by-turn boat routing.

## Contract

- `GET /api/hydro/manifest.json`
- `GET /api/hydro/<region>.pmtiles`
- `GET /api/hydro/chart-profile?n&s&e&w`
- R2 keys: `hydro/<region>.pmtiles` and `hydro/manifest.json`

Vector layers:

- `depth_contours`
- `depth_areas`
- `reef_hazards`
- `hydro_labels`

## First Regions

Regions:

- `mn-lotw`: Minnesota-side Lake of the Woods candidate. Minnesota DNR Lake
  Bathymetry was downloaded and probed, but the published GeoPackage returned
  no Lake of the Woods features in the lake bounding box. Do not publish a
  synthetic PMTiles pack from this source.
- `ca-lotw`: Canadian-side Lake of the Woods bathymetry context. CHS NONNA is
  live-only and non-navigational in this tranche. Do not create or redistribute
  offline PMTiles from CHS data until licensing and an approved offline data
  path are solved.

## Build

```bash
python3 scripts/build_hydro_bathymetry.py mn-lotw
python3 scripts/publish_hydro_packs.py mn-lotw
```

The builder defaults to the Minnesota DNR GeoPackage ZIP. It writes
`data/hydro/mn-lotw.pmtiles` only when real source contours exist in the region.
For the current Minnesota DNR source, the Lake of the Woods probe exits without
writing PMTiles and leaves the manifest in a no-source-coverage/live-only state.

## Styling

The mobile style draws shallow-to-deep depth bands, 5 ft contour lines, heavier
10 ft index contours, depth labels, and reef/shoal/hazard glow. OpenSeaMap
buoys, aids, hazards, and recommended tracks remain above hydro layers.

## Safety Language

Every manifest/profile/tap-card path must preserve non-certified-navigation
language. CHS NONNA remains live-only non-navigational Canadian bathymetry
context until licensed offline distribution is explicitly solved.
