#!/usr/bin/env python3
"""Build an immutable b08 Explore review candidate from cached inputs only.

The builder cannot write the public Explore catalog or serving index. It
combines accepted cached inputs, records their hashes, and writes an isolated
review bundle beneath ``data/explore/audit_candidates``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.data.build_canonical_serving_indexes import build_explore_index, merge_explore_indexes


DEFAULT_BASE_CATALOG = ROOT / "dashboard/explore_catalog_v3.json"
DEFAULT_BASE_SERVING = ROOT / "dashboard/explore_serving_index_v2.json"
DEFAULT_NPS = ROOT / "data/explore/audit_candidates/combined/live-20260731-b08/nps_catalog_scoped.json"
DEFAULT_AGENCY_DIR = ROOT / "data/explore/audit_candidates/agencies/live-20260801-b08-operational-r8"
DEFAULT_OUTPUT = ROOT / "data/explore/audit_candidates/combined/live-20260801-b08-operational-r8"
PROTECTED_OUTPUTS = {
    DEFAULT_BASE_CATALOG.resolve(),
    DEFAULT_BASE_SERVING.resolve(),
    (ROOT / "dashboard/explore_internal_preview_v1.json").resolve(),
}


def _review_readiness(serving: dict[str, Any]) -> dict[str, bool]:
    """Separate structural catalog readiness from final content promotion."""
    return {
        "catalog_gate_passed": bool((serving.get("gate") or {}).get("passed")),
        "promotion_ready": False,
    }


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError(f"expected a JSON object: {path}")
    return payload


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_ref(path: Path) -> dict[str, Any]:
    resolved = path.resolve()
    try:
        display = str(resolved.relative_to(ROOT))
    except ValueError:
        display = str(resolved)
    return {"path": display, "bytes": resolved.stat().st_size, "sha256": _sha256(resolved)}


def _places(payload: dict[str, Any], path: Path) -> list[dict[str, Any]]:
    places = [item for item in payload.get("places") or [] if isinstance(item, dict)]
    if len(places) != int(payload.get("count") or len(places)):
        raise ValueError(f"declared place count does not match records: {path}")
    ids = [str(item.get("id") or "") for item in places]
    if not all(ids) or len(ids) != len(set(ids)):
        raise ValueError(f"catalog contains missing or duplicate stable IDs: {path}")
    return places


def _merge_catalogs(
    base_path: Path,
    nps_path: Path,
    agency_path: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    base_payload = _read_json(base_path)
    nps_payload = _read_json(nps_path)
    agency_payload = _read_json(agency_path)
    base_places = _places(base_payload, base_path)
    nps_places = _places(nps_payload, nps_path)
    agency_places = _places(agency_payload, agency_path)

    merged = {str(item["id"]): item for item in base_places}
    nps_replacements = sum(str(item["id"]) in merged for item in nps_places)
    for item in nps_places:
        merged[str(item["id"])] = item
    agency_replacements = sum(str(item["id"]) in merged for item in agency_places)
    for item in agency_places:
        merged[str(item["id"])] = item

    generated_at = max(
        int(base_payload.get("generated_at") or 0),
        int(nps_payload.get("generated_at") or 0),
        int(agency_payload.get("generated_at") or 0),
    )
    catalog = {
        "schema_version": 3,
        "catalog_id": "trailhead-explore-v3-b08-r2-combined-review",
        "generated_at": generated_at,
        "source": "Trailhead isolated Explore review candidate",
        "count": len(merged),
        "places": list(merged.values()),
    }
    review = {
        "schema_version": 1,
        "generated_at": generated_at,
        "live_catalog_modified": False,
        "sources": {
            "base": _source_ref(base_path),
            "nps": _source_ref(nps_path),
            "agency": _source_ref(agency_path),
        },
        "counts": {
            "base": len(base_places),
            "nps": len(nps_places),
            "agency": len(agency_places),
            "merged": len(merged),
            "replaced_base_by_nps": nps_replacements,
            "replaced_existing_by_agency": agency_replacements,
            "added_by_agency": len(agency_places) - agency_replacements,
            "with_source_pack": sum(bool(item.get("source_pack")) for item in merged.values()),
            "with_media": sum(bool(item.get("media")) for item in merged.values()),
        },
        "unique_ids": len(merged) == len({str(item.get("id") or "") for item in merged.values()}),
    }
    return catalog, review


def _point(item: dict[str, Any]) -> tuple[float, float] | None:
    try:
        lat = float(item.get("lat"))
        lng = float(item.get("lng"))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lng) or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def _distance_m(left: dict[str, Any], right: dict[str, Any]) -> float | None:
    left_point = _point(left)
    right_point = _point(right)
    if not left_point or not right_point:
        return None
    lat1, lon1 = map(math.radians, left_point)
    lat2, lon2 = map(math.radians, right_point)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_008.8 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _title_tokens(value: Any) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", str(value or "").casefold())
        if token not in {"camp", "campground", "group", "sierra", "the"}
    }


def _displaced_records(base_index: dict[str, Any], merged_index: dict[str, Any]) -> list[dict[str, Any]]:
    base_by_id = {
        str(item.get("id") or ""): item
        for item in base_index.get("items") or []
        if isinstance(item, dict) and item.get("id")
    }
    merged_by_id = {
        str(item.get("id") or ""): item
        for item in merged_index.get("items") or []
        if isinstance(item, dict) and item.get("id")
    }
    added = [item for item_id, item in merged_by_id.items() if item_id not in base_by_id]
    displaced: list[dict[str, Any]] = []
    for old_id, old in base_by_id.items():
        if old_id in merged_by_id:
            continue
        old_tokens = _title_tokens(old.get("title"))
        matches: list[tuple[float, dict[str, Any]]] = []
        for candidate in added:
            candidate_tokens = _title_tokens(candidate.get("title"))
            if old_tokens and candidate_tokens and not (old_tokens & candidate_tokens):
                continue
            distance = _distance_m(old, candidate)
            if distance is not None and distance <= 75:
                matches.append((distance, candidate))
        matches.sort(key=lambda pair: (pair[0], str(pair[1].get("id") or "")))
        if not matches or (len(matches) > 1 and matches[1][0] - matches[0][0] < 25):
            choices = [(round(distance, 1), item.get("id")) for distance, item in matches]
            raise ValueError(
                f"could not identify one unambiguous replacement within 75 m for displaced record {old_id}: {choices}"
            )
        distance, replacement = matches[0]
        displaced.append({
            "old_id": old_id,
            "old_title": old.get("title"),
            "replacement_id": replacement.get("id"),
            "replacement_title": replacement.get("title"),
            "distance_m": round(distance, 1),
        })
    displaced.sort(key=lambda item: str(item["old_id"]))
    return displaced


def _build_serving_review(
    base_path: Path,
    nps_path: Path,
    agency_merged_path: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    base = _read_json(base_path)
    agency_merged = _read_json(agency_merged_path)
    nps_index = build_explore_index(nps_path, minimum_reviewable=1, enforce_enrichment_gate=True)
    if nps_index.get("rejections") or int(nps_index.get("count") or 0) == 0:
        raise ValueError("scoped NPS catalog did not pass the canonical serving gate")
    minimum = int((base.get("gate") or {}).get("minimum_reviewable") or 4000)
    merged = merge_explore_indexes([agency_merged, nps_index], minimum_reviewable=minimum)
    displaced = _displaced_records(base, merged)
    base_ids = {str(item.get("id") or "") for item in base.get("items") or [] if isinstance(item, dict)}
    merged_ids = {str(item.get("id") or "") for item in merged.get("items") or [] if isinstance(item, dict)}
    review = {
        "schema_version": 1,
        "generated_at": int(merged.get("generated_at") or 0),
        "live_serving_index_modified": False,
        "sources": {
            "base": _source_ref(base_path),
            "agency_merged": _source_ref(agency_merged_path),
            "nps_scoped": _source_ref(nps_path),
        },
        "counts": {
            "base": len(base_ids),
            "agency_plus_base": len(agency_merged.get("items") or []),
            "nps_scoped_places": int(nps_index.get("source_count") or 0),
            "nps_accepted": int(nps_index.get("count") or 0),
            "merged": len(merged_ids),
            "added_to_base": len(merged_ids - base_ids),
            "displaced_from_base": len(base_ids - merged_ids),
        },
        "displaced_records": displaced,
        "gate": merged.get("gate"),
        "filter_counts": merged.get("filter_counts"),
        "missing_filters": merged.get("missing_filters"),
    }
    return merged, review


def build(args: argparse.Namespace) -> dict[str, Any]:
    base_catalog = Path(args.base_catalog).resolve()
    base_serving = Path(args.base_serving).resolve()
    nps_catalog = Path(args.nps_catalog).resolve()
    agency_dir = Path(args.agency_dir).resolve()
    agency_catalog = agency_dir / "explore_catalog_v3.json"
    agency_merged = agency_dir / "serving_index_merged_review.json"
    out_dir = Path(args.out_dir).resolve()
    if out_dir == ROOT.resolve() or ROOT.resolve() not in out_dir.parents:
        raise ValueError("output must remain inside the Trailhead repository")
    if any(protected == out_dir or out_dir in protected.parents for protected in PROTECTED_OUTPUTS):
        raise ValueError("output may not target a protected live artifact")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise FileExistsError(f"immutable candidate directory is not empty: {out_dir}")
    for path in (base_catalog, base_serving, nps_catalog, agency_catalog, agency_merged):
        if not path.is_file():
            raise FileNotFoundError(path)

    catalog, catalog_review = _merge_catalogs(base_catalog, nps_catalog, agency_catalog)
    serving, promotion_review = _build_serving_review(base_serving, nps_catalog, agency_merged)
    out_dir.mkdir(parents=True, exist_ok=True)
    artifacts = {
        "explore_catalog_v3_review.json": catalog,
        "catalog_merge_review.json": catalog_review,
        "serving_index_review.json": serving,
        "promotion_review.json": promotion_review,
    }
    for name, payload in artifacts.items():
        _write_json(out_dir / name, payload)
    manifest = {
        "schema_version": 1,
        "generated_at": max(int(catalog.get("generated_at") or 0), int(serving.get("generated_at") or 0)),
        # This immutable bundle has passed structural catalog checks only.  A
        # bounded sidecar must still pass copy, link, source and media-rights
        # review before anything can be promoted.
        **_review_readiness(serving),
        "live_catalog_modified": False,
        "live_serving_index_modified": False,
        "inputs": {
            "base_catalog": _source_ref(base_catalog),
            "base_serving": _source_ref(base_serving),
            "nps_catalog": _source_ref(nps_catalog),
            "agency_catalog": _source_ref(agency_catalog),
            "agency_merged_serving": _source_ref(agency_merged),
        },
        "artifacts": [
            {"path": name, "bytes": (out_dir / name).stat().st_size, "sha256": _sha256(out_dir / name)}
            for name in sorted(artifacts)
        ],
    }
    _write_json(out_dir / "manifest.json", manifest)
    return {
        "out_dir": str(out_dir),
        "catalog_count": catalog["count"],
        "serving_count": serving["count"],
        "displaced_count": promotion_review["counts"]["displaced_from_base"],
        "manifest_sha256": _sha256(out_dir / "manifest.json"),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-catalog", default=str(DEFAULT_BASE_CATALOG))
    parser.add_argument("--base-serving", default=str(DEFAULT_BASE_SERVING))
    parser.add_argument("--nps-catalog", default=str(DEFAULT_NPS))
    parser.add_argument("--agency-dir", default=str(DEFAULT_AGENCY_DIR))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUTPUT))
    return parser.parse_args()


if __name__ == "__main__":
    print(json.dumps(build(parse_args()), indent=2))
