#!/usr/bin/env python3
"""Sequential trail pack extraction queue."""
from __future__ import annotations

import argparse
import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("states", nargs="+")
    parser.add_argument("--download-geofabrik", action="store_true")
    parser.add_argument("--pmtiles", action="store_true")
    parser.add_argument("--routing-graph", action="store_true")
    parser.add_argument("--min-zoom", type=int, default=8)
    parser.add_argument("--max-zoom", type=int, default=12)
    parser.add_argument("--out-dir", default="data/trails")
    parser.add_argument("--python", default=".venv-trails/bin/python")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    for state in args.states:
      started = time.time()
      cmd = [
          args.python,
          "-u",
          "scripts/extract_trail_graph.py",
          "--region",
          state.lower(),
          "--out-dir",
          args.out_dir,
          "--min-zoom",
          str(args.min_zoom),
          "--max-zoom",
          str(args.max_zoom),
      ]
      if args.download_geofabrik:
          cmd.append("--download-geofabrik")
      if args.pmtiles:
          cmd.append("--pmtiles")
      if args.routing_graph:
          cmd.append("--routing-graph")
      if args.force:
          cmd.append("--force")
      print(f"{state}: starting {' '.join(cmd)}", flush=True)
      env = {**os.environ, "PYTHONUNBUFFERED": "1"}
      proc = subprocess.run(cmd, cwd=ROOT, env=env)
      elapsed = int(time.time() - started)
      if proc.returncode != 0:
          print(f"{state}: failed exit={proc.returncode} elapsed={elapsed}s", flush=True)
      else:
          print(f"{state}: complete elapsed={elapsed}s", flush=True)


if __name__ == "__main__":
    main()
