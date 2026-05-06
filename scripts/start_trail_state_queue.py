#!/usr/bin/env python3
"""Start state trail-system extraction in the background.

This builds legal/offline trail packs from Geofabrik OSM extracts:
  data/trails/<state>/trails.pmtiles
  data/trails/<state>/trail_graph.json
"""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = ROOT / "output"
LOG_PATH = LOG_DIR / "trails-state-queue.log"

DEFAULT_STATES = [
    "co", "ut", "az", "ca", "wa", "or", "id", "mt", "wy", "nm", "nv",
    "ks", "tx", "ok", "sd", "mn", "wi", "mi", "ny", "pa", "nc", "tn",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("states", nargs="*", default=DEFAULT_STATES)
    parser.add_argument("--min-zoom", type=int, default=8)
    parser.add_argument("--max-zoom", type=int, default=12)
    parser.add_argument("--out-dir", default="data/trails")
    parser.add_argument("--python", default=".venv-trails/bin/python")
    args = parser.parse_args()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log = LOG_PATH.open("ab", buffering=0)
    cmd = [
        args.python,
        "-u",
        "scripts/trail_state_queue.py",
        *[s.lower() for s in args.states],
        "--download-geofabrik",
        "--pmtiles",
        "--routing-graph",
        "--min-zoom",
        str(args.min_zoom),
        "--max-zoom",
        str(args.max_zoom),
        "--out-dir",
        args.out_dir,
    ]
    proc = subprocess.Popen(
        cmd,
        cwd=ROOT,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    print(f"started pid={proc.pid} log={LOG_PATH}")


if __name__ == "__main__":
    main()
