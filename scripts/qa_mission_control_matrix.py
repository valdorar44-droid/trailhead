#!/usr/bin/env python3
"""Static and contract QA for Mission Control v2."""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "dashboard/adventure_intelligence.py"
MOBILE_API = ROOT / "mobile/lib/api.ts"
PANEL = ROOT / "mobile/components/copilot/MissionControlPanel.tsx"
TESTS = ROOT / "tests/test_adventure_intelligence.py"
AUDIT = ROOT / "docs/adventure-readiness-stage-8-mission-control-audit.md"


def read(path: Path) -> str:
    return path.read_text()


def main() -> int:
    failures: list[str] = []
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    from dashboard.adventure_intelligence import build_mission_control

    backend = read(BACKEND)
    mobile_api = read(MOBILE_API)
    panel = read(PANEL)
    tests = read(TESTS)

    markers = {
        "schema version": '"schema_version": 2',
        "status summary": "status_summary",
        "next actions": "next_actions",
        "provider evidence": "provider_evidence",
        "reports score": "score_reports",
        "offline complete/partial/missing": "offline_status",
        "source quality registry use": "source_quality_summary",
        "mobile status type": "MissionStatusItem",
        "mobile provider evidence type": "MissionProviderEvidence",
        "status rows": "missionStatusRows",
        "evidence rows": "missionEvidenceRows",
        "v2 contract test": "test_partial_offline_pack_needs_review_without_silent_ready",
    }
    combined = "\n".join([backend, mobile_api, panel, tests])
    for label, marker in markers.items():
        if marker not in combined:
            failures.append(f"Missing marker for {label}: {marker}")

    payload = {
        "route": [[-109.55, 38.57], [-109.48, 38.63], [-109.4, 38.7]],
        "checkpoints": [
            {"id": "start", "type": "start", "title": "Moab", "lat": 38.57, "lng": -109.55, "day": 1, "source": "trailhead", "confidence": "high"},
            {"id": "camp", "type": "camp", "title": "Named Camp", "lat": 38.6, "lng": -109.6, "day": 1, "source": "nps", "confidence": "high"},
        ],
        "places": [
            {"id": "fuel", "type": "fuel", "title": "Fuel", "lat": 38.58, "lng": -109.56, "source": "trailhead", "confidence": "high"},
            {"id": "report", "type": "community_report", "title": "Gate report", "lat": 38.59, "lng": -109.57, "source": "trailhead_user", "confidence": "medium", "conflicting": True},
        ],
        "trip_memory": {"vehicle": {"type": "truck"}, "range": {"miles": 250}, "offline_readiness": {"maps": "downloaded", "route": True}},
        "metadata": {"days": 1},
    }
    brief = build_mission_control(payload)
    required_status = {"route_status", "overnights", "rig_fit", "legal_stay", "fuel_risk", "conditions", "offline_readiness", "reports"}
    if brief.get("schema_version") != 2:
        failures.append("Mission Control brief is not schema_version 2")
    if set((brief.get("status_summary") or {}).keys()) != required_status:
        failures.append("Mission Control status_summary keys do not match Stage 8 matrix")
    if brief.get("status_summary", {}).get("reports", {}).get("value") != "conflicting":
        failures.append("Conflicting reports are not surfaced in status_summary")
    if not isinstance(brief.get("next_actions"), list):
        failures.append("next_actions missing from Mission Control brief")
    if not brief.get("provider_evidence"):
        failures.append("provider_evidence missing from Mission Control brief")

    if not AUDIT.exists():
        failures.append(f"Missing audit note: {AUDIT.relative_to(ROOT)}")

    print("Mission Control v2 QA matrix")
    print("Checks: deterministic status matrix, staged actions, provider evidence, mobile card wiring")

    if failures:
        print("")
        print("Failures")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: Mission Control v2 markers and contract behavior are present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
