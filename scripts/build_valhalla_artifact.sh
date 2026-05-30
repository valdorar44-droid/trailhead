#!/usr/bin/env bash
set -euo pipefail

# Build a Valhalla routing artifact on a fast local/NVMe host.
#
# This script expects Docker and enough local disk. It does not need Railway.
# The output tar.zst is meant to be uploaded with publish_valhalla_artifact.py.
#
# Example:
#   scripts/build_valhalla_artifact.sh \
#     --workdir /mnt/nvme/valhalla-us \
#     --pbf-url https://download.geofabrik.de/north-america/us-latest.osm.pbf \
#     --label us-full

WORKDIR=""
PBF_URL=""
LABEL="us-full"
IMAGE="${VALHALLA_IMAGE:-ghcr.io/nilsnolde/docker-valhalla/valhalla:latest}"
THREADS="${VALHALLA_THREADS:-$(nproc)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workdir) WORKDIR="$2"; shift 2 ;;
    --pbf-url) PBF_URL="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --threads) THREADS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$WORKDIR" || -z "$PBF_URL" ]]; then
  echo "Usage: $0 --workdir /mnt/nvme/valhalla-us --pbf-url URL [--label us-full]" >&2
  exit 2
fi

mkdir -p "$WORKDIR"
cd "$WORKDIR"

PBF_NAME="$(basename "$PBF_URL")"
if [[ ! -s "$PBF_NAME" ]]; then
  curl -L --fail --retry 5 --retry-delay 10 -o "$PBF_NAME.tmp" "$PBF_URL"
  mv "$PBF_NAME.tmp" "$PBF_NAME"
fi

rm -rf valhalla_tiles
mkdir -p valhalla_tiles

docker run --rm \
  -v "$WORKDIR:/custom_files" \
  "$IMAGE" \
  /bin/bash -lc "
    valhalla_build_config \
      --mjolnir-tile-dir /custom_files/valhalla_tiles \
      --mjolnir-tile-extract /custom_files/${LABEL}-tiles.tar \
      > /custom_files/valhalla.json
    python3 - <<'PY'
import json
from pathlib import Path
path = Path('/custom_files/valhalla.json')
config = json.loads(path.read_text())
config.setdefault('mjolnir', {})['concurrency'] = int('${THREADS}')
config['mjolnir']['include_driveways'] = True
config['mjolnir']['include_construction'] = False
config['mjolnir'].setdefault('data_processing', {})['infer_turn_channels'] = True
config.setdefault('loki', {}).setdefault('actions', ['locate', 'route', 'sources_to_targets', 'optimized_route', 'isochrone'])
config.setdefault('thor', {})['source_to_target_algorithm'] = 'select_optimal'
config.setdefault('service_limits', {}).setdefault('auto', {})
config['service_limits']['auto']['max_distance'] = 12000000
config['service_limits']['auto']['max_locations'] = 80
path.write_text(json.dumps(config, indent=2))
PY
    valhalla_build_tiles -c /custom_files/valhalla.json /custom_files/${PBF_NAME}
  "

rm -f "${LABEL}-valhalla.tar" "${LABEL}-valhalla.tar.zst"
tar -C "$WORKDIR" -cf "${LABEL}-valhalla.tar" valhalla_tiles valhalla.json

if command -v zstd >/dev/null 2>&1; then
  zstd -T0 -19 "${LABEL}-valhalla.tar" -o "${LABEL}-valhalla.tar.zst"
else
  docker run --rm -v "$WORKDIR:/custom_files" ubuntu:24.04 \
    /bin/bash -lc "apt-get update && apt-get install -y zstd && zstd -T0 -19 /custom_files/${LABEL}-valhalla.tar -o /custom_files/${LABEL}-valhalla.tar.zst"
fi

echo "$WORKDIR/${LABEL}-valhalla.tar.zst"
