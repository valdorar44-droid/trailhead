#!/usr/bin/env python3
"""Start a long-running owned DEM contour queue in the background."""
from __future__ import annotations

import argparse
import shlex
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = ROOT / "output"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("regions", nargs="*", help="Region ids, e.g. fi co ut")
    parser.add_argument("--all-states", action="store_true")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--publish", action="store_true", help="Publish finished packs after the build command exits")
    parser.add_argument("--unit", choices=["meters", "feet"], default="meters")
    parser.add_argument("--interval-meters", default="20")
    parser.add_argument("--index-interval", default="100")
    parser.add_argument("--min-zoom", default="9")
    parser.add_argument("--max-zoom", default="13")
    args = parser.parse_args()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    label = "all" if args.all else "all-states" if args.all_states else "-".join(args.regions or ["none"])
    log_path = LOG_DIR / f"dem-contours-{label}.log"
    cmd = [
        "python3",
        "scripts/build_contours_from_dem.py",
        "--skip-existing",
        "--unit", args.unit,
        "--interval-meters", args.interval_meters,
        "--index-interval", args.index_interval,
        "--min-zoom", args.min_zoom,
        "--max-zoom", args.max_zoom,
    ]
    if args.all:
        cmd.append("--all")
    elif args.all_states:
        cmd.append("--all-states")
    else:
        cmd.extend(args.regions)

    if args.publish:
        regions = [] if args.all or args.all_states else args.regions
        build_cmd = " ".join(shlex.quote(part) for part in cmd)
        publish_cmd = " ".join(shlex.quote(part) for part in ["python3", "scripts/publish_contour_packs.py", *regions])
        cmd = ["/bin/bash", "-lc", f"{build_cmd} && {publish_cmd}"]

    log = log_path.open("ab", buffering=0)
    proc = subprocess.Popen(
        cmd,
        cwd=ROOT,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    print(f"started pid={proc.pid} log={log_path}")


if __name__ == "__main__":
    main()
