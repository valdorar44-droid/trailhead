#!/usr/bin/env python3
"""Build the exact pre-CAS Smokies field-drive/source-review artifact.

The real output remains absent until a separate field-drive review record and
the additive publication route-evidence artifact both exist. This builder is
offline and never creates or infers either source fact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.originals_route_evidence import (
    OriginalRouteEvidenceError,
    SMOKIES_PUBLICATION_ROUTE_EVIDENCE,
    canonical_sha256,
    validate_smokies_publication_route_evidence_document,
)
from db.originals_smokies_final_readiness import (
    CONTENT_PROJECTION_SHA256,
    EXPECTED_AFTER_DRAFT_REVISION,
    EXPECTED_BEFORE_DRAFT_REVISION,
    FINAL_ACCESSIBILITY_NOTE,
    FINAL_DISCLAIMER,
    FINALIZATION_REVIEW_ID,
    FINALIZATION_REVIEW_KIND,
    FINALIZATION_REVIEW_PATH,
    EXPECTED_OFFLINE_MAP_BYTES,
    OPERATIONAL_POLICY_CANONICAL_SHA256,
    PRODUCT_ID,
    PUBLICATION_ROUTE_EVIDENCE_ID,
    canonical_bytes,
    validate_finalization_review_artifact,
)


FIELD_REVIEW_KIND = "smokies_full_bundle_field_drive_source_review"
FIELD_REVIEW_STATUS = "field_drive_and_source_review_complete"
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
TIMESTAMP_RE = re.compile(
    r"^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T"
    r"(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$"
)


class FinalizationReviewBuildError(RuntimeError):
    """Required independently reviewed source evidence is absent or drifted."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise FinalizationReviewBuildError(message)


def _load_canonical(path: Path, label: str) -> tuple[dict[str, Any], bytes]:
    _require(path.is_file(), f"{label} is required")
    _require(not path.is_symlink(), f"{label} must not be a symlink")
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise FinalizationReviewBuildError(f"{label} is invalid") from exc
    _require(isinstance(value, dict), f"{label} must be an object")
    _require(raw == canonical_bytes(value), f"{label} is not canonical JSON")
    return value, raw


def build(
    *,
    field_review_path: Path,
    route_evidence_path: Path = SMOKIES_PUBLICATION_ROUTE_EVIDENCE,
) -> dict[str, Any]:
    field, _field_raw = _load_canonical(
        field_review_path, "Smokies field-drive/source-review record"
    )
    route, _route_raw = _load_canonical(
        route_evidence_path, "Smokies publication route evidence"
    )
    try:
        route = validate_smokies_publication_route_evidence_document(route)
    except OriginalRouteEvidenceError as exc:
        raise FinalizationReviewBuildError(str(exc)) from exc
    _require(
        set(field) == {
            "schema_version",
            "kind",
            "status",
            "product_id",
            "expected_before_draft_revision",
            "expected_before_manifest_sha256",
            "content_projection_sha256",
            "review",
            "offline_map_estimated_bytes",
            "publication_review_bindings",
            "effects",
        },
        "field-drive/source-review fields drifted",
    )
    _require(
        field.get("schema_version") == 1
        and field.get("kind") == FIELD_REVIEW_KIND
        and field.get("status") == FIELD_REVIEW_STATUS
        and field.get("product_id") == PRODUCT_ID
        and field.get("expected_before_draft_revision")
        == EXPECTED_BEFORE_DRAFT_REVISION
        and field.get("content_projection_sha256")
        == CONTENT_PROJECTION_SHA256,
        "field-drive/source-review identity drifted",
    )
    manifest_sha256 = str(field.get("expected_before_manifest_sha256") or "")
    _require(
        SHA256_RE.fullmatch(manifest_sha256) is not None,
        "field-drive/source-review predecessor hash is invalid",
    )
    review = field.get("review")
    _require(
        isinstance(review, dict)
        and set(review) == {
            "editorial_status",
            "field_drive_completed_at",
            "source_review_completed_at",
        }
        and review.get("editorial_status") == "approved"
        and TIMESTAMP_RE.fullmatch(
            str(review.get("field_drive_completed_at") or "")
        ) is not None
        and TIMESTAMP_RE.fullmatch(
            str(review.get("source_review_completed_at") or "")
        ) is not None,
        "field-drive/source-review approval is incomplete",
    )
    reviewed_bytes = field.get("offline_map_estimated_bytes")
    _require(
        reviewed_bytes == EXPECTED_OFFLINE_MAP_BYTES,
        "reviewed offline-map byte count drifted",
    )
    review_bindings = field.get("publication_review_bindings")
    _require(
        isinstance(review_bindings, dict)
        and set(review_bindings) == {
            "technical_field_drive_evidence_sha256",
            "source_review_evidence_sha256",
            "vehicle_source_policy_sha256",
        }
        and all(
            SHA256_RE.fullmatch(str(review_bindings.get(key) or "")) is not None
            for key in review_bindings
        )
        and review_bindings.get("vehicle_source_policy_sha256")
        == OPERATIONAL_POLICY_CANONICAL_SHA256,
        "field-drive/source/vehicle review bindings drifted",
    )
    effects = field.get("effects")
    _require(
        isinstance(effects, dict)
        and set(effects) == {
            "database_accessed",
            "database_mutated",
            "network_accessed",
            "provider_accessed",
            "provider_mutated",
            "publication_performed",
            "public_release",
        }
        and all(value is False for value in effects.values()),
        "field-drive/source-review record claims downstream effects",
    )
    _require(
        route.get("schema_version") == 1
        and route.get("kind")
        == "trailhead_original_official_route_evidence"
        and route.get("product_id") == PRODUCT_ID
        and route.get("publication_status") == "ready_for_publication"
        and route.get("publication_blockers") == [],
        "publication route evidence is blocked or drifted",
    )
    _require(
        route.get("publication_review_bindings") == review_bindings,
        "publication route review bindings drifted",
    )
    artifact = {
        "schema_version": 1,
        "kind": FINALIZATION_REVIEW_KIND,
        "review_id": FINALIZATION_REVIEW_ID,
        "status": FIELD_REVIEW_STATUS,
        "product_id": PRODUCT_ID,
        "expected_before_draft_revision": EXPECTED_BEFORE_DRAFT_REVISION,
        "expected_after_draft_revision": EXPECTED_AFTER_DRAFT_REVISION,
        "expected_before_manifest_sha256": manifest_sha256,
        "content_projection_sha256": CONTENT_PROJECTION_SHA256,
        "review": review,
        "offline_map_estimated_bytes": reviewed_bytes,
        "publication_review_bindings": dict(review_bindings),
        "route_evidence": {
            "schema_version": 1,
            "evidence_id": PUBLICATION_ROUTE_EVIDENCE_ID,
            "evidence_sha256": canonical_sha256(route),
            "product_id": route.get("product_id"),
            "route_spec_sha256": route.get("route_spec_sha256"),
            "source_snapshot_sha256": route.get("source_snapshot_sha256"),
        },
        "roaring_fork_final_disclaimer": FINAL_DISCLAIMER,
        "roaring_fork_final_accessibility_note": FINAL_ACCESSIBILITY_NOTE,
        "effects": dict(effects),
    }
    try:
        return validate_finalization_review_artifact(
            artifact, route_evidence_document=route
        )
    except ValueError as exc:
        raise FinalizationReviewBuildError(str(exc)) from exc


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    parser.add_argument("--field-review", type=Path, required=True)
    parser.add_argument(
        "--route-evidence",
        type=Path,
        default=SMOKIES_PUBLICATION_ROUTE_EVIDENCE,
    )
    parser.add_argument("--output", type=Path, default=FINALIZATION_REVIEW_PATH)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        artifact = build(
            field_review_path=args.field_review,
            route_evidence_path=args.route_evidence,
        )
        payload = canonical_bytes(artifact)
        if args.write:
            _require(
                args.output.resolve() == FINALIZATION_REVIEW_PATH.resolve(),
                "write output must be the exact registered finalization-review path",
            )
            _require(not args.output.exists(), "finalization-review output exists")
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_bytes(payload)
        else:
            _require(
                args.output.is_file() and args.output.read_bytes() == payload,
                "generated finalization-review artifact is absent or drifted",
            )
    except (FinalizationReviewBuildError, OSError) as exc:
        print(
            json.dumps({"status": "blocked", "reason": str(exc)}, sort_keys=True),
            file=sys.stderr,
        )
        return 1
    print(json.dumps({
        "status": "verified",
        "artifact": {
            "byte_count": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        },
        "database_accessed": False,
        "database_mutated": False,
        "network_accessed": False,
        "provider_accessed": False,
        "publication_performed": False,
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
