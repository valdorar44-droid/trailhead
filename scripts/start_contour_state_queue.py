#!/usr/bin/env python3
"""Start the long-running state contour extraction queue in the background."""
from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = ROOT / "output"
LOG_PATH = LOG_DIR / "contours-all-states.log"


def main() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log = LOG_PATH.open("ab", buffering=0)
    cmd = [
        "python3",
        "scripts/extract_contours_pmtiles.py",
        "--all-states",
        "--skip-existing",
        "--min-zoom",
        "8",
        "--max-zoom",
        "12",
        "--workers",
        "16",
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
