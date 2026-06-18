#!/usr/bin/env python3
"""Static QA for snap-to-trail and route-graph readiness."""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAP_TSX = ROOT / "mobile/app/(tabs)/map.tsx"
OFFLINE_FILES = ROOT / "mobile/lib/useOfflineFiles.ts"
TRAIL_GRAPH = ROOT / "mobile/lib/trailGraph.ts"
AUDIT_DOC = ROOT / "docs/adventure-readiness-stage-6-snap-trail-audit.md"

REQUIRED_MAP_MARKERS = {
    "snap mode type": "type TrailSnapMode",
    "snap mode options": "TRAIL_SNAP_MODE_OPTIONS",
    "trail mode": "id: 'trail'",
    "road mode": "id: 'road'",
    "dirt mode": "id: 'dirt'",
    "straight mode": "id: 'straight'",
    "hybrid mode": "id: 'hybrid'",
    "failure normalizer": "normalizeTrailSnapFailure",
    "graph readiness state": "TrailGraphReadiness",
    "readiness rows": "trailRoutingReadinessRows",
    "readiness panel": "trailRoutingReadinessPanel",
    "manual fallback": "Straight line mode only connects your pins",
    "missing graph message": "Trail routing graph is not downloaded for this area",
    "gap message": "Gap between trail segments",
    "route graph path": "trailRouteGraphLocalPath(stateId)",
}

REQUIRED_OFFLINE_MARKERS = {
    "selection graph copy": "selection graph",
    "route graph copy": "route graph",
    "sidecar repair": "Trail graph sidecars repaired",
    "missing route graph copy": "route graph not published yet",
}

REQUIRED_GRAPH_MARKERS = {
    "graph selection builder": "buildOfflineTrailGraphSelection",
    "junction adjacency": "buildAdjacency",
    "component selection": "componentFrom",
}


def read(path: Path) -> str:
    return path.read_text()


def main() -> int:
    map_tsx = read(MAP_TSX)
    offline = read(OFFLINE_FILES)
    graph = read(TRAIL_GRAPH)
    failures: list[str] = []

    for label, marker in REQUIRED_MAP_MARKERS.items():
        if marker not in map_tsx:
            failures.append(f"Missing map marker for {label}: {marker}")

    for label, marker in REQUIRED_OFFLINE_MARKERS.items():
        if marker not in offline:
            failures.append(f"Missing offline marker for {label}: {marker}")

    for label, marker in REQUIRED_GRAPH_MARKERS.items():
        if marker not in graph:
            failures.append(f"Missing trail graph marker for {label}: {marker}")

    if not AUDIT_DOC.exists():
        failures.append(f"Missing audit note: {AUDIT_DOC.relative_to(ROOT)}")

    print("Snap-to-trail QA matrix")
    print("Checks: snap modes, route graph readiness, failure copy, offline sidecar status")

    if failures:
        print("")
        print("Failures")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: snap-to-trail readiness markers are present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
