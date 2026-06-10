#!/usr/bin/env bash
set -euo pipefail

# Build and publish connected regional Valhalla artifacts.
#
# This must run on a host with Docker, zstd, curl, Python deps, and enough disk.
# It intentionally avoids a single full-US build. Each region is built from the
# state PBFs together so cross-state edges inside that region are connected.
#
# Required env for publishing:
#   R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
#
# Examples:
#   scripts/build_valhalla_region_artifacts.sh west
#   scripts/build_valhalla_region_artifacts.sh east
#   scripts/build_valhalla_region_artifacts.sh all

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_WORKDIR="${VALHALLA_REGION_WORKDIR:-/mnt/nvme/trailhead-valhalla-regions}"

declare -A REGION_STATES=(
  [west]="CA,NV,OR,WA,ID,MT,WY,UT,CO,AZ,NM"
  [great_lakes]="MN,WI,IL,IN,MI,OH"
  [plains]="ND,SD,NE,KS,OK,IA,MO,AR"
  [south_central]="TX,LA,MS,AL,TN,KY"
  [southeast]="FL,GA,SC,NC,VA,WV"
  [northeast]="ME,NH,VT,MA,RI,CT,NY,NJ,PA,MD,DE"
  [alaska]="AK"
  [hawaii]="HI"
)

ORDER=(west great_lakes plains south_central southeast northeast alaska hawaii)

usage() {
  echo "Usage: $0 {all|west|great_lakes|plains|south_central|southeast|northeast|alaska|hawaii} [...]" >&2
}

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

targets=()
for arg in "$@"; do
  if [[ "$arg" == "all" ]]; then
    targets=("${ORDER[@]}")
    break
  fi
  if [[ -z "${REGION_STATES[$arg]:-}" ]]; then
    echo "Unknown region: $arg" >&2
    usage
    exit 2
  fi
  targets+=("$arg")
done

mkdir -p "$BASE_WORKDIR"
cd "$ROOT_DIR"

for region in "${targets[@]}"; do
  states="${REGION_STATES[$region]}"
  workdir="$BASE_WORKDIR/$region"
  echo "=== Building Valhalla region: $region ($states)"
  "$ROOT_DIR/scripts/build_valhalla_artifact.sh" \
    --workdir "$workdir" \
    --states "$states" \
    --label "$region"
  artifact_path="$workdir/$region-valhalla.tar.zst"
  if [[ ! -s "$artifact_path" ]]; then
    echo "Missing expected artifact after build: $artifact_path" >&2
    exit 1
  fi
  echo "=== Publishing $artifact_path"
  python3 "$ROOT_DIR/scripts/publish_valhalla_artifact.py" \
    --artifact "$artifact_path" \
    --key "routing/valhalla/$region.tar.zst" \
    --label "$region"
done
