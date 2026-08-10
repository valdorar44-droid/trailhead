#!/usr/bin/env python3
"""Build the fail-closed Roaring Fork derivative visual-approval overlay.

The overlay records the project owner's explicit approval of the seven exact,
verified derivative hashes. It does not ingest, upload, bind Manifest V3,
deploy, publish, or authorize public release.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REPOSITORY = Path(__file__).resolve().parents[1]
OUTPUT_PATH = (
    REPOSITORY
    / "originals/smokies/roaring_fork_artwork_derivative_approval_v1.json"
)
DERIVATIVE_PATH = (
    REPOSITORY / "originals/smokies/roaring_fork_artwork_derivatives_v1.json"
)

DERIVATIVE_SHA256 = "3287ba42f4d06a7733787659c8092feae89026a5194a60b9eeb342f57a98a305"
OVERLAY_ID = "smokies_roaring_fork_artwork_derivative_approval_20260810_v1"
APPROVED_AT = "2026-08-10T05:56:13Z"
APPROVAL_TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"

WSL_EVIDENCE_ROOT = Path(
    "/home/sean/.openclaw/evidence/roaring-fork-artwork-v1/derivatives"
)
WINDOWS_EVIDENCE_ROOT = Path(
    "/mnt/c/Users/User/Documents/Codex/evidence/trailhead/"
    "roaring-fork-artwork-v1/derivatives"
)


class DerivativeApprovalError(ValueError):
    """The derivative record, approval overlay, or evidence is invalid."""


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DerivativeApprovalError(f"unavailable JSON input: {path}") from error
    if not isinstance(value, dict):
        raise DerivativeApprovalError(f"expected JSON object: {path}")
    return value


def _sha256_path(path: Path) -> str:
    value = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                value.update(chunk)
    except OSError as error:
        raise DerivativeApprovalError(f"unavailable evidence input: {path}") from error
    return value.hexdigest()


def _derivative_record() -> dict[str, Any]:
    if _sha256_path(DERIVATIVE_PATH) != DERIVATIVE_SHA256:
        raise DerivativeApprovalError("verified derivative record binding drifted")
    value = _load_json(DERIVATIVE_PATH)
    if value.get("status") != "verified_derivatives_user_visual_review_required":
        raise DerivativeApprovalError("verified derivative review status drifted")
    gate = value.get("approval_gate", {})
    if gate.get("derivative_user_visual_approval") is not False:
        raise DerivativeApprovalError("verified derivative record was mutated")
    if gate.get("ingestion_allowed") is not False or gate.get("public_release") is not False:
        raise DerivativeApprovalError("verified derivative record no longer fails closed")
    rows = value.get("derivatives")
    if not isinstance(rows, list) or len(rows) != 7:
        raise DerivativeApprovalError("verified derivative inventory drifted")
    if [row.get("stable_order") for row in rows] != list(range(1, 8)):
        raise DerivativeApprovalError("verified derivative order drifted")
    return value


def build() -> dict[str, Any]:
    source = _derivative_record()
    derivatives = []
    for row in source["derivatives"]:
        derivatives.append(
            {
                "candidate_id": row["candidate_id"],
                "stable_order": row["stable_order"],
                "derivative_filename": row["derivative_filename"],
                "derivative_bytes": row["derivative_bytes"],
                "derivative_sha256": row["derivative_sha256"],
                "decoded_pixel_sha256": row["decoded_pixel_sha256"],
                "dimensions": row["dimensions"],
                "format": row["format"],
                "mode": row["mode"],
                "full_frame_preserved": row["full_frame_preserved"],
                "crop": row["crop"],
                "resize": row["resize"],
                "exact_credit": row["exact_credit"],
                "creator": row["creator"],
                "license_name": row["license_name"],
                "license_url": row["license_url"],
                "source_page_url": row["source_page_url"],
                "claim_limit": row["claim_limit"],
                "change_note": row["change_note"],
                "wsl_evidence_path": row["wsl_evidence_path"],
                "windows_mirror_path": row["windows_mirror_path"],
                "status": "visually_approved_verified_derivative_ingestion_pending",
                "user_visual_approval": True,
                "derivative_immutable": True,
                "ingestion_allowed": False,
            }
        )

    return {
        "schema_version": 1,
        "overlay_id": OVERLAY_ID,
        "product_id": source["product_id"],
        "chapter_id": source["chapter_id"],
        "variant_id": source["variant_id"],
        "status": "approved_verified_derivatives_ingestion_authorization_pending",
        "recorded_at": APPROVED_AT,
        "approval": {
            "approved_at": APPROVED_AT,
            "approved_by": "project_owner",
            "decision": "approve_all_derivatives",
            "decision_text": "approve all derivatives",
            "source_task_id": APPROVAL_TASK_ID,
            "scope": "all_seven_derivatives_in_bound_verified_review_record",
        },
        "source_binding": {
            "path": DERIVATIVE_PATH.relative_to(REPOSITORY).as_posix(),
            "byte_count": DERIVATIVE_PATH.stat().st_size,
            "sha256": DERIVATIVE_SHA256,
        },
        "derivatives": derivatives,
        "summary": {
            "approved_derivative_count": len(derivatives),
            "immutable_derivative_count": len(derivatives),
            "mirrored_derivative_count": len(derivatives),
            "total_derivative_bytes": sum(
                row["derivative_bytes"] for row in derivatives
            ),
        },
        "approval_gate": {
            "original_user_visual_approval": True,
            "derivative_generation_verified": True,
            "derivative_hashes_complete": True,
            "derivative_mirror_complete": True,
            "derivative_user_visual_approval": True,
            "exact_attribution_and_change_notes_complete": True,
            "admin_importer_complete": False,
            "verified_upload_evidence_complete": False,
            "private_manifest_v3_artwork_binding_complete": False,
            "authenticated_device_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "ingestion_allowed": False,
            "public_release": False,
            "next_action": (
                "await_explicit_authorization_for_bounded_admin_importer_"
                "and_private_manifest_v3_packet"
            ),
        },
    }


def verify_evidence(wsl_root: Path, windows_root: Path) -> dict[str, Any]:
    source = _derivative_record()
    expected_names = {row["derivative_filename"] for row in source["derivatives"]}
    for root in (wsl_root, windows_root):
        if not root.is_dir():
            raise DerivativeApprovalError(f"derivative evidence root unavailable: {root}")
        actual_names = {path.name for path in root.iterdir() if path.is_file()}
        if actual_names != expected_names:
            raise DerivativeApprovalError(f"derivative evidence membership drifted: {root}")

    for row in source["derivatives"]:
        for root in (wsl_root, windows_root):
            path = root / row["derivative_filename"]
            if path.stat().st_size != row["derivative_bytes"]:
                raise DerivativeApprovalError(f"derivative byte count drifted: {path}")
            if _sha256_path(path) != row["derivative_sha256"]:
                raise DerivativeApprovalError(f"derivative SHA-256 drifted: {path}")

    return {
        "verified_derivative_count": len(source["derivatives"]),
        "verified_copy_count": len(source["derivatives"]) * 2,
        "total_derivative_bytes": sum(
            row["derivative_bytes"] for row in source["derivatives"]
        ),
        "copies_match": True,
    }


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify-evidence", action="store_true")
    parser.add_argument("--wsl-evidence-root", type=Path, default=WSL_EVIDENCE_ROOT)
    parser.add_argument(
        "--windows-evidence-root", type=Path, default=WINDOWS_EVIDENCE_ROOT
    )
    args = parser.parse_args()

    rendered = serialize(build())
    if args.verify_evidence:
        verify_evidence(args.wsl_evidence_root, args.windows_evidence_root)
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Roaring Fork derivative approval overlay is stale; rebuild it")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
