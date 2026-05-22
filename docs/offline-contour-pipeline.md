# Offline Contour Pipeline

Trailhead contour packs should be generated from elevation source data, not
repackaged from a third-party rendered tile service. The app contract stays:

- `GET /api/contours/manifest.json`
- `GET /api/contours/<region>.pmtiles`
- local path `offline/contours/<region>.pmtiles`

## Source

The owned pipeline uses public Copernicus DEM COGs from AWS Open Data:

- GLO-30 Public where available
- GLO-90 fallback for missing 30 m tiles

Generated packs must carry attribution for Copernicus DEM / EU / ESA as
required by the Copernicus DEM license.

## Build

Required tools:

- `gdalbuildvrt`
- `gdal_contour`
- `tippecanoe`
- `pmtiles` CLI, `/data/go_pmtiles`, or repo `data/go_pmtiles`

Generated files default to `/data/contours` and temporary work files default to
`/data/contour-work`. Override with `TRAILHEAD_CONTOUR_OUT_DIR` and
`TRAILHEAD_CONTOUR_WORK_DIR` for local test runs.

Build one region:

```bash
python3 scripts/build_contours_from_dem.py fi --unit meters --interval-meters 20 --index-interval 100 --max-zoom 13
```

Build US state packs:

```bash
python3 scripts/start_dem_contour_queue.py --all-states --unit feet --interval-meters 12.192 --index-interval 200 --max-zoom 13 --publish
```

Build Finland with metric labels:

```bash
python3 scripts/start_dem_contour_queue.py fi --unit meters --interval-meters 20 --index-interval 100 --max-zoom 13 --publish
```

## Output Schema

Layer name: `contours`

Properties:

- `ele`: integer elevation in display units
- `idx`: boolean index-contour marker
- `unit`: `m` or `ft`

The mobile style labels `unit=m` contours as meters and falls back to feet for
legacy packs without a `unit` property.

## Publish

```bash
python3 scripts/publish_contour_packs.py fi
```

This uploads:

- `contours/fi.pmtiles`
- `contours/manifest.json`

Large files use S3 multipart upload directly against R2.

## Notes

The old `scripts/extract_contours_pmtiles.py` remains as a historical/dev
reference for the OSM US contour tiles, but it should not be the production
pipeline for offline redistribution.
