#!/usr/bin/env python3
"""Start a long-running place-pack queue in the background."""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = ROOT / "output"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("states", nargs="*", help="State ids to build. Defaults to every state missing the selected pack.")
    parser.add_argument("--pack", default="camps", help="Place pack id to build. Defaults to camps.")
    parser.add_argument("--force-state", action="append", default=[])
    args = parser.parse_args()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{args.pack.lower()}-place-pack-queue.log"
    log = log_path.open("wb", buffering=0)
    cmd = [
        "railway",
        "run",
        "python3",
        "-u",
        "scripts/camp_pack_queue.py",
        "--pack",
        args.pack.lower(),
        *[s.lower() for s in args.states],
    ]
    for state in args.force_state:
        cmd.extend(["--force-state", state.lower()])
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
