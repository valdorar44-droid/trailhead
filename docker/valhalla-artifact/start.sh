#!/usr/bin/env bash
set -euo pipefail

export VALHALLA_DATA_DIR="${VALHALLA_DATA_DIR:-/custom_files}"
PORT="${PORT:-8002}"

python3 /usr/local/bin/valhalla_artifact_bootstrap.py

CONFIG="${VALHALLA_DATA_DIR}/valhalla.json"
if [[ ! -f "$CONFIG" ]]; then
  echo "Missing Valhalla config at $CONFIG" >&2
  exit 2
fi

exec valhalla_service "$CONFIG" 1
