#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.data.build_canonical_serving_indexes import build_explore_index, merge_explore_indexes


DEFAULT_SOURCE = ROOT / "data" / "processed" / "explore_catalog_v3.candidate.json"
DEFAULT_SUPPLEMENTAL = ROOT / "dashboard" / "explore_catalog_v3.json"
DEFAULT_OUT = ROOT / "dashboard" / "explore_serving_index_v2.json"


def write_compact_json(path: Path, payload: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    temp = path.with_suffix(path.suffix + f".tmp-{time.time_ns()}")
    temp.write_bytes(encoded)
    temp.replace(path)
    return len(encoded)


def promote(
    source: Path,
    out: Path,
    *,
    supplemental: list[Path] | None = None,
    minimum_reviewable: int = 4000,
) -> dict:
    source_paths = [source, *(supplemental or [])]
    indexes = []
    for source_path in source_paths:
        index = build_explore_index(
            source_path,
            minimum_reviewable=0,
            enforce_enrichment_gate=True,
        )
        raw_catalog = json.loads(source_path.read_text())
        index["catalogs"] = [{
            "catalog_id": raw_catalog.get("catalog_id") or source_path.stem,
            "generated_at": int(raw_catalog.get("generated_at") or 0),
            "source_count": index["source_count"],
        }]
        indexes.append(index)
    payload = merge_explore_indexes(indexes, minimum_reviewable=minimum_reviewable)
    if not payload["gate"]["passed"]:
        reasons = json.dumps(payload.get("rejection_reason_counts") or {}, sort_keys=True)
        raise ValueError(
            f"explore promotion blocked: {payload['reviewable_count']} reviewable places; "
            f"minimum is {minimum_reviewable}; rejection reasons={reasons}"
        )
    byte_count = write_compact_json(out, payload)
    return {
        "sources": [str(path) for path in source_paths],
        "out": str(out),
        "source_count": payload["source_count"],
        "reviewable_count": payload["reviewable_count"],
        "grade_counts": payload["grade_counts"],
        "rejection_reason_counts": payload["rejection_reason_counts"],
        "bytes": byte_count,
        "gate": payload["gate"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Promote a gated, compact Explore serving index into the tracked app bundle.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--supplemental", action="append", type=Path, default=[DEFAULT_SUPPLEMENTAL])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--minimum-reviewable", type=int, default=4000)
    args = parser.parse_args()
    try:
        report = promote(
            args.source,
            args.out,
            supplemental=args.supplemental,
            minimum_reviewable=max(1, args.minimum_reviewable),
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
