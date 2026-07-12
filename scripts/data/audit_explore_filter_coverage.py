#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.data.build_canonical_serving_indexes import explore_filter_coverage


DEFAULT_ARTIFACT = ROOT / "dashboard" / "explore_serving_index_v2.json"
DEFAULT_CONTRACT = ROOT / "scripts" / "data" / "explore_filter_contract.json"
DEFAULT_DISPLAY = ROOT / "mobile" / "components" / "explore" / "exploreDisplay.ts"
DEFAULT_SERVER = ROOT / "dashboard" / "server.py"


class ExploreFilterCoverageError(ValueError):
    pass


def visible_filter_keys(display_source: str) -> list[str]:
    try:
        chip_source = display_source.split("export const EXPLORE_CATEGORY_CHIPS", 1)[1].split("];", 1)[0]
    except IndexError as exc:
        raise ExploreFilterCoverageError("could not find EXPLORE_CATEGORY_CHIPS") from exc
    return list(dict.fromkeys(re.findall(r"\bkey:\s*'([a-z_]+)'", chip_source)))


def usable_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    return [
        item
        for item in items
        if isinstance(item, dict)
        and item.get("reviewable") is True
        and not item.get("rejection_reasons")
        and len(item.get("planning_facts") or []) >= 2
        and bool((item.get("provenance") or {}).get("primary"))
        and item.get("media_kind") in {"photo", "map_preview"}
    ]


def endpoint_is_declared(server_source: str, endpoint: str) -> bool:
    escaped = re.escape(endpoint)
    return bool(re.search(rf"@app\.(?:get|post)\(\s*[\"']{escaped}[\"']", server_source))


def audit_payload(
    payload: dict[str, Any],
    *,
    visible_keys: list[str],
    contract: dict[str, Any],
    server_source: str,
) -> dict[str, Any]:
    controls = {str(value) for value in contract.get("non_category_controls") or []}
    dynamic = contract.get("dynamic_filters") if isinstance(contract.get("dynamic_filters"), dict) else {}
    filters = [key for key in visible_keys if key not in controls]
    items = usable_items(payload)
    indexed_counts, _ = explore_filter_coverage(items)
    declared_counts = payload.get("filter_counts") if isinstance(payload.get("filter_counts"), dict) else {}
    failures: list[str] = []

    if len(items) != len(payload.get("items") or []):
        failures.append("serving artifact contains items that do not meet the usable enrichment contract")
    if declared_counts != indexed_counts:
        failures.append("artifact filter_counts do not match usable serving items")
    unknown_dynamic = sorted(set(dynamic) - set(filters))
    if unknown_dynamic:
        failures.append(f"dynamic allowlist contains non-visible filters: {', '.join(unknown_dynamic)}")

    dynamic_report: dict[str, dict[str, Any]] = {}
    for key in filters:
        count = int(indexed_counts.get(key) or 0)
        if count > 0:
            continue
        spec = dynamic.get(key) if isinstance(dynamic.get(key), dict) else None
        if not spec:
            failures.append(f"visible filter '{key}' has zero usable indexed results and no live endpoint")
            continue
        endpoint = str(spec.get("endpoint") or "").strip()
        if not endpoint or not endpoint_is_declared(server_source, endpoint):
            failures.append(f"visible filter '{key}' points to an undeclared live endpoint: {endpoint or 'missing'}")
            continue
        if not spec.get("categories") or not spec.get("source_policy"):
            failures.append(f"visible filter '{key}' has an incomplete dynamic source contract")
            continue
        dynamic_report[key] = {
            "endpoint": endpoint,
            "required_query": list(spec.get("required_query") or []),
            "categories": list(spec.get("categories") or []),
        }

    if failures:
        raise ExploreFilterCoverageError("; ".join(failures))
    return {
        "visible_filters": filters,
        "usable_count": len(items),
        "indexed_counts": {key: int(indexed_counts.get(key) or 0) for key in filters},
        "dynamic_filters": dynamic_report,
    }


def audit_files(artifact: Path, contract_path: Path, display_path: Path, server_path: Path) -> dict[str, Any]:
    payload = json.loads(artifact.read_text())
    contract = json.loads(contract_path.read_text())
    return audit_payload(
        payload,
        visible_keys=visible_filter_keys(display_path.read_text()),
        contract=contract,
        server_source=server_path.read_text(),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit every visible Explorer filter against usable indexed or documented live data.")
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--display", type=Path, default=DEFAULT_DISPLAY)
    parser.add_argument("--server", type=Path, default=DEFAULT_SERVER)
    args = parser.parse_args()
    try:
        report = audit_files(args.artifact, args.contract, args.display, args.server)
    except (OSError, json.JSONDecodeError, ExploreFilterCoverageError) as exc:
        print(f"Explorer filter coverage failed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
