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
PBF_URLS=()
STATE_CODES=""
LABEL="us-full"
IMAGE="${VALHALLA_IMAGE:-ghcr.io/nilsnolde/docker-valhalla/valhalla:latest}"
THREADS="${VALHALLA_THREADS:-$(nproc)}"

declare -A STATE_GEOFABRIK_NAMES=(
  [AL]=alabama [AK]=alaska [AZ]=arizona [AR]=arkansas [CA]=california
  [CO]=colorado [CT]=connecticut [DE]=delaware [FL]=florida [GA]=georgia
  [HI]=hawaii [IA]=iowa [ID]=idaho [IL]=illinois [IN]=indiana
  [KS]=kansas [KY]=kentucky [LA]=louisiana [MA]=massachusetts
  [MD]=maryland [ME]=maine [MI]=michigan [MN]=minnesota [MO]=missouri
  [MS]=mississippi [MT]=montana [NC]=north-carolina [ND]=north-dakota
  [NE]=nebraska [NH]=new-hampshire [NJ]=new-jersey [NM]=new-mexico
  [NV]=nevada [NY]=new-york [OH]=ohio [OK]=oklahoma [OR]=oregon
  [PA]=pennsylvania [RI]=rhode-island [SC]=south-carolina
  [SD]=south-dakota [TN]=tennessee [TX]=texas [UT]=utah [VA]=virginia
  [VT]=vermont [WA]=washington [WI]=wisconsin [WV]=west-virginia [WY]=wyoming
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workdir) WORKDIR="$2"; shift 2 ;;
    --pbf-url) PBF_URLS+=("$2"); shift 2 ;;
    --states) STATE_CODES="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --threads) THREADS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -n "$STATE_CODES" ]]; then
  IFS=',' read -ra REQUESTED_STATES <<< "$STATE_CODES"
  for raw_code in "${REQUESTED_STATES[@]}"; do
    code="$(echo "$raw_code" | tr '[:lower:]' '[:upper:]' | xargs)"
    if [[ -z "$code" ]]; then
      continue
    fi
    name="${STATE_GEOFABRIK_NAMES[$code]:-}"
    if [[ -z "$name" ]]; then
      echo "Unknown US state code for --states: $code" >&2
      exit 2
    fi
    PBF_URLS+=("https://download.geofabrik.de/north-america/us/${name}-latest.osm.pbf")
  done
fi

if [[ -z "$WORKDIR" || ${#PBF_URLS[@]} -eq 0 ]]; then
  echo "Usage: $0 --workdir /mnt/nvme/valhalla-us (--pbf-url URL | --states CA,NV,UT) [--label us-full]" >&2
  exit 2
fi

mkdir -p "$WORKDIR"
cd "$WORKDIR"

PBF_FILES=()
for PBF_URL in "${PBF_URLS[@]}"; do
  PBF_NAME="$(basename "$PBF_URL")"
  if [[ ! -s "$PBF_NAME" ]]; then
    curl -L --fail --retry 5 --retry-delay 10 -o "$PBF_NAME.tmp" "$PBF_URL"
    mv "$PBF_NAME.tmp" "$PBF_NAME"
  fi
  PBF_FILES+=("/custom_files/${PBF_NAME}")
done
PBF_ARGS="${PBF_FILES[*]}"

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
    valhalla_build_tiles -c /custom_files/valhalla.json ${PBF_ARGS}
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
