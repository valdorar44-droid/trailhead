#!/usr/bin/env python3
"""Static QA for the Trailhead report system surface."""
from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT_TSX = ROOT / "mobile/app/(tabs)/report.tsx"
SERVER_PY = ROOT / "dashboard/server.py"

REQUIRED_UI_MARKERS = {
    "road washout": "Washout",
    "gate closed": "Gate closed",
    "camp full": "Camp full",
    "trail closed": "Trail closed",
    "water source dry": "Water source dry",
    "fuel unavailable": "Fuel unavailable",
    "dump closed": "Dump closed",
    "still there action": "Still there",
    "not there action": "Not there",
    "report more action": "Report more",
    "source confidence": "sourceConfidence",
    "offline queue": "OFFLINE_REPORT_QUEUE_KEY",
    "trust label": "reportTrustLabel",
    "distance label": "distanceLabelForReport",
    "confirm endpoint": "confirmReport",
    "dismiss endpoint": "downvoteReport",
}


def extract_valid_server_types(text: str) -> set[str]:
    match = re.search(r"VALID_REPORT_TYPES\s*=\s*\{(?P<body>.*?)\}", text, re.S)
    if not match:
        return set()
    return set(re.findall(r'"([^"]+)"', match.group("body")))


def extract_ui_types(text: str) -> set[str]:
    match = re.search(r"const REPORT_TYPES\s*=\s*\[(?P<body>.*?)\];\s*\n\s*const SEVERITY", text, re.S)
    if not match:
        return set()
    return set(re.findall(r"\{\s*type:\s*'([^']+)'", match.group("body")))


def main() -> int:
    report_text = REPORT_TSX.read_text()
    server_text = SERVER_PY.read_text()

    valid_types = extract_valid_server_types(server_text)
    ui_types = extract_ui_types(report_text)
    failures: list[str] = []

    if not valid_types:
        failures.append("Could not read VALID_REPORT_TYPES from dashboard/server.py.")
    unsupported = sorted(ui_types - valid_types)
    if unsupported:
        failures.append(f"Unsupported UI report types: {', '.join(unsupported)}")

    for label, marker in REQUIRED_UI_MARKERS.items():
        if marker not in report_text:
            failures.append(f"Missing {label}: {marker}")

    print("Report system QA matrix")
    print(f"Backend-valid types: {len(valid_types)}")
    print(f"UI report types: {len(ui_types)}")
    print(f"UI types: {', '.join(sorted(ui_types))}")

    if failures:
        print("")
        print("Failures")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: report taxonomy, trust actions, and offline queue hooks are present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
