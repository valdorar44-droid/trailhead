# Valhalla Artifact Pipeline

Trailhead should not build continent-scale Valhalla graphs on Railway volumes.
Railway should serve completed graph artifacts; a temporary NVMe builder should
do the heavy `valhalla_build_tiles` work.

## Build On NVMe

Use a temporary Ubuntu VM with fast local SSD/NVMe, Docker, `curl`, and `zstd`.
For the US, use at least 16 vCPU, 64 GB RAM, and several hundred GB of local
disk. More disk I/O matters more than more memory after parsing.

```bash
git clone https://github.com/valdorar44-droid/trailhead.git
cd trailhead

scripts/build_valhalla_artifact.sh \
  --workdir /mnt/nvme/valhalla-us \
  --pbf-url https://download.geofabrik.de/north-america/us-latest.osm.pbf \
  --label us-full
```

For a smaller West-expanded service, build one combined graph from the western
state extracts instead of deploying separate per-state tar files:

```bash
scripts/build_valhalla_artifact.sh \
  --workdir /mnt/nvme/valhalla-west-expanded \
  --states CA,NV,UT,AZ,NM,CO,WY,MT,ID,OR,WA \
  --label west-expanded
```

The output is:

```text
/mnt/nvme/valhalla-us/us-full-valhalla.tar.zst
```

For the West-expanded example, the output is:

```text
/mnt/nvme/valhalla-west-expanded/west-expanded-valhalla.tar.zst
```

## Upload To R2

Set the same R2 variables used by the API service, then upload:

```bash
export R2_ACCOUNT_ID=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_BUCKET=trailhead-tiles

python3 -m pip install -r requirements.txt
python3 scripts/publish_valhalla_artifact.py \
  --artifact /mnt/nvme/valhalla-us/us-full-valhalla.tar.zst \
  --key routing/valhalla/us-full.tar.zst \
  --label us-full
```

For West-expanded:

```bash
python3 scripts/publish_valhalla_artifact.py \
  --artifact /mnt/nvme/valhalla-west-expanded/west-expanded-valhalla.tar.zst \
  --key routing/valhalla/west-expanded.tar.zst \
  --label west-expanded
```

This updates:

```text
routing/valhalla/us-full.tar.zst
routing/valhalla/manifest.json
```

## Serve On Railway

Deploy `docker/valhalla-artifact/Dockerfile` as a Valhalla service with a
mounted volume at `/custom_files`.

Required variables:

```text
PORT=8002
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=trailhead-tiles
VALHALLA_ARTIFACT_KEY=routing/valhalla/us-full.tar.zst
VALHALLA_DATA_DIR=/custom_files
```

Use `VALHALLA_ARTIFACT_KEY=routing/valhalla/west-expanded.tar.zst` for the
West-expanded service.

Optional integrity variable from the upload output:

```text
VALHALLA_ARTIFACT_SHA256=...
```

The service downloads the artifact once, extracts `valhalla_tiles/` and
`valhalla.json`, then starts:

```bash
valhalla_service /custom_files/valhalla.json 1
```

## Cutover Checks

Do not switch production until staging passes all of these:

```bash
curl -s https://trailhead-valhalla-us-production.up.railway.app/status
```

Route probes:

- Moab -> Big Sur
- Denver -> Moab
- Seattle -> Spokane
- Portland -> Eugene
- Seattle -> Boise
- Boise -> Missoula
- Salt Lake City -> Denver
- Phoenix -> Albuquerque
- Cheyenne -> Denver
- NYC -> Asheville

After the direct staging probes pass, switch API `VALHALLA_URL` to the staging
service private URL and verify:

```bash
curl -s https://api.gettrailhead.app/api/route/health
curl -s https://api.gettrailhead.app/api/admin/routing-coverage-diagnostic
cd mobile && npm run audit:routes
```
