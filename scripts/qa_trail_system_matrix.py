#!/usr/bin/env python3
"""Static/data QA for the Trailhead real trail system foundation."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "dashboard/server.py"
API_TS = ROOT / "mobile/lib/api.ts"
MAP_TSX = ROOT / "mobile/app/(tabs)/map.tsx"
DISPLAY_TS = ROOT / "mobile/lib/trailProfileDisplay.ts"
TRAIL_GEOMETRIES = ROOT / "dashboard/explore_trail_geometries_v1.json"

REQUIRED_MARKERS = {
    "discover endpoint": '@app.get("/api/trails/discover")',
    "profile endpoint": '@app.get("/api/trails/{trail_id}")',
    "edit suggestion endpoint": '@app.post("/api/trails/{trail_id}/suggest-edit")',
    "community trail endpoint": '@app.post("/api/trails/community")',
    "field reports endpoint": '@app.get("/api/trails/{trail_id}/field-reports")',
    "mobile trail profile type": "export interface TrailProfile",
    "mobile discover client": "discoverTrails:",
    "normalizer export": "normalizeTrailheadTrailProfile",
    "display model type": "TrailheadTrailProfile",
    "source rows": "trailProfileSourceRows",
    "stat rows": "trailProfileStatRows",
    "map source panel": "trailSourcePanel",
    "difficulty basis": "DIFFICULTY BASIS",
    "condition pills": "trailConditionPills",
}

MODEL_FIELDS = [
    "distance_mi",
    "elevation_gain_ft",
    "difficulty_reason",
    "route_type",
    "activities",
    "access",
    "source",
    "confidence",
    "recent_conditions",
]


def read(path: Path) -> str:
    return path.read_text()


def trail_geometry_count() -> int:
    try:
        data = json.loads(TRAIL_GEOMETRIES.read_text())
    except Exception:
        return 0
    trails = data.get("trails") if isinstance(data, dict) else None
    return len(trails or [])


def main() -> int:
    server = read(SERVER)
    api = read(API_TS)
    display = read(DISPLAY_TS)
    map_tsx = read(MAP_TSX)
    combined = "\n".join([server, api, display, map_tsx])
    failures: list[str] = []

    for label, marker in REQUIRED_MARKERS.items():
        if marker not in combined:
            failures.append(f"Missing {label}: {marker}")

    for field in MODEL_FIELDS:
        if not re.search(rf"\b{re.escape(field)}\b", display):
            failures.append(f"Trail display model missing field: {field}")

    count = trail_geometry_count()
    if count <= 0:
        failures.append("No generated trail geometries found in dashboard/explore_trail_geometries_v1.json")

    print("Trail system QA matrix")
    print(f"Generated trail geometries: {count}")
    print("Checks: endpoints, mobile API, display model, map source/confidence UI")

    if failures:
        print("")
        print("Failures")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: trail system foundation markers are present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
