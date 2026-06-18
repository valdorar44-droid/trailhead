#!/usr/bin/env python3
"""Static QA for provider registry and source-confidence scoring."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "dashboard/server.py"
REGISTRY = ROOT / "dashboard/provider_registry.py"
QUALITY = ROOT / "scripts/explore_sources/base/quality.py"
SCHEMA = ROOT / "scripts/explore_sources/base/schema.py"
MOBILE_CONFIDENCE = ROOT / "mobile/lib/sourceConfidence.ts"
EXPLORE_DISPLAY = ROOT / "mobile/components/explore/exploreDisplay.ts"
AUDIT = ROOT / "docs/adventure-readiness-stage-7-data-sources-audit.md"

REQUIRED_PROVIDERS = {
    "nps",
    "ridb",
    "recreation.gov",
    "usfs",
    "blm",
    "usgs",
    "osm",
    "geofabrik",
    "overpass",
    "wikidata",
    "wikipedia",
    "openbeta",
    "viator",
    "mapbox",
    "nws",
    "airnow",
    "firms",
    "trailhead_curated",
    "trailhead_user",
}

REQUIRED_FIELDS = {
    "source_type",
    "update_cadence",
    "storage_rules",
    "attribution_text",
    "license_url",
    "freshness_label",
    "confidence_default",
    "allowed_surfaces",
    "offline_allowed",
    "derivative_constraints",
}


def read(path: Path) -> str:
    return path.read_text()


def main() -> int:
    failures: list[str] = []
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    module = importlib.import_module("dashboard.provider_registry")
    registry = module.PROVIDER_REGISTRY
    missing = sorted(REQUIRED_PROVIDERS.difference(registry))
    if missing:
        failures.append(f"Registry missing providers: {', '.join(missing)}")

    for provider_id, metadata in registry.items():
        payload = metadata.to_dict()
        missing_fields = sorted(field for field in REQUIRED_FIELDS if field not in payload)
        if missing_fields:
            failures.append(f"{provider_id} missing fields: {', '.join(missing_fields)}")

    official_summary = module.source_quality_summary([{"source": "nps", "source_id": "yose"}], last_seen_at=9999999999, now=9999999999)
    if official_summary["score"] < 75 or "official" not in official_summary["factors"]:
        failures.append("Official source confidence scoring is too weak")

    inferred_summary = module.source_quality_summary([{"source": "osm", "source_id": "way/1"}], inferred=True, unknown_access=True)
    if inferred_summary["score"] >= official_summary["score"]:
        failures.append("Inferred/unknown-access scoring should be lower than official scoring")

    server = read(SERVER)
    quality = read(QUALITY)
    schema = read(SCHEMA)
    mobile = read(MOBILE_CONFIDENCE)
    explore = read(EXPLORE_DISPLAY)
    registry_text = read(REGISTRY)

    markers = {
        "provider endpoint": '@app.get("/api/providers/registry")',
        "server import": "list_provider_metadata",
        "source quality summary function": "source_quality_summary",
        "official scoring factor": "official",
        "recent scoring factor": "recent",
        "multiple source factor": "multiple_sources",
        "stale penalty": "stale",
        "inferred penalty": "inferred",
        "unknown access penalty": "unknown_access",
        "catalog schema field": "source_quality:",
        "catalog scorer assignment": "place.source_quality = summary",
        "mobile helper": "sourceConfidenceFromRecord",
        "explore confidence row": "label: 'Confidence'",
    }
    combined = "\n".join([server, quality, schema, mobile, explore, registry_text])
    for label, marker in markers.items():
        if marker not in combined:
            failures.append(f"Missing marker for {label}: {marker}")

    if not AUDIT.exists():
        failures.append(f"Missing audit note: {AUDIT.relative_to(ROOT)}")

    print("Provider registry QA matrix")
    print(f"Providers: {len(registry)}")
    print("Checks: metadata fields, scoring factors, API endpoint, catalog/mobile wiring")

    if failures:
        print("")
        print("Failures")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: provider registry and source-confidence markers are present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
