#!/usr/bin/env python3
"""Static QA for Stage 10 audit agent prompt files."""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGENT_DIR = ROOT / ".agents"
AUDIT = ROOT / "docs/adventure-readiness-stage-10-audit-agents-audit.md"

REQUIRED_AGENTS = {
    "product-polish-agent.md": [
        "too much text",
        "missing source or freshness",
        "dead-end states",
        "tiny touch targets",
        "route-aware next step",
    ],
    "map-performance-agent.md": [
        "render thrash",
        "repeated API calls",
        "too many markers",
        "style reloads",
        "memory pressure",
    ],
    "data-trust-agent.md": [
        "source shown",
        "license and attribution",
        "No AllTrails",
        "No AI claim without supporting data",
        "confidence score sensible",
    ],
    "community-safety-agent.md": [
        "Report spam guard",
        "PII risk",
        "Home-location privacy",
        "Photo moderation",
        "Sensitive locations",
    ],
    "car-platform-agent.md": [
        "CarPlay entitlement",
        "Android Auto manifest",
        "Driver distraction",
        "Mapbox Navigation free-drive",
        "Real hardware test plan",
    ],
}


def read(path: Path) -> str:
    return path.read_text()


def main() -> int:
    failures: list[str] = []
    for filename, markers in REQUIRED_AGENTS.items():
        path = AGENT_DIR / filename
        if not path.exists():
            failures.append(f"Missing agent prompt: {path.relative_to(ROOT)}")
            continue
        text = read(path)
        lowered = text.lower()
        if "## Role" not in text or "## Checks" not in text or "## Output" not in text:
            failures.append(f"{filename} must include Role, Checks, and Output sections")
        for marker in markers:
            if marker.lower() not in lowered:
                failures.append(f"{filename} missing marker: {marker}")

    if not AUDIT.exists():
        failures.append(f"Missing audit note: {AUDIT.relative_to(ROOT)}")
    else:
        audit = read(AUDIT)
        for filename in REQUIRED_AGENTS:
            if filename not in audit:
                failures.append(f"Audit note missing agent: {filename}")

    print("Audit agents QA matrix")
    print("Checks: product polish, map performance, data trust, community safety, car platform prompts")

    if failures:
        print("")
        print("Failures")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: Stage 10 audit agent prompts are present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
