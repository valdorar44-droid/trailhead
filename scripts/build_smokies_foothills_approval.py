#!/usr/bin/env python3
"""Build the fail-closed Foothills Parkway script and artwork approval overlay.

The overlay records approval of the exact scripts and original artwork shown in
the bound review gate. It does not authorize artwork sanitation or derivatives,
narration, ingestion, manifest work, upload, production mutation, or release.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REPOSITORY = Path(__file__).resolve().parents[1]
ORIGINALS = REPOSITORY / "originals/smokies"
REVIEW_PACKET_PATH = ORIGINALS / "foothills_parkway_review_packet_v1.json"
REVIEW_SHEET_PATH = REPOSITORY / "docs/originals/foothills-parkway-review-sheet-v1.md"
OUTPUT_PATH = ORIGINALS / "foothills_parkway_approval_v1.json"

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CHAPTER_ID = "foothills_parkway"
OVERLAY_ID = "smokies_foothills_parkway_approval_20260810_v1"
APPROVAL_TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"
APPROVED_AT = "2026-08-11T03:09:33.129Z"
APPROVAL_DECISION_TEXT = "approved"
APPROVAL_MESSAGE_SHA256 = (
    "7f8518f7db5e9a55049f49c4ea6d6e8f509695231e60cbd607bcb36c88a75a14"
)

GUARDED_SOURCE_COMMIT = "7b37de90f8df9a5f9a04e6fda0a6fc276d4e3cd5"
REVIEW_GATE_CHECKPOINT_COMMIT = "b501dedcb381705a8c84328650f1bfc5db6afc19"
EXPECTED_REVIEW_PACKET_SHA256 = (
    "7a3217f0dc11c503f43ca12d82b339d5537de6365441f607eacfd7c3945ea926"
)
EXPECTED_REVIEW_SHEET_SHA256 = (
    "aef724ffa60792be57d2efeed3668c32127518787119f31b44243f211620d240"
)

EXPECTED_TRANSCRIPT_SHA256 = {
    "fp_story_01": "48769cc73c2984673775b3bf96f714c7577152aa383c0c4162cb155187f8fbf2",
    "fp_story_02": "36d1b5f218ad0dc0a7fe05827a40e4d7bbadbd85814ae503513b0f4efa987a01",
    "fp_story_03": "fadd566208b133389f9005345337b39d12d8de1f195f2cbbe81b6159295cd6fd",
    "fp_story_04": "0549301d81d4f9b17da862147e940782bfdd66d6871677b568a2e4cae7af814c",
    "fp_story_05": "e6d89f51c14c3333e867e0cb204b78597d93123c12f3fd9a62fcccbe2bdc1795",
    "fp_story_06": "2e64c4e31f03ebe54007f06749210b95e8b2f034a33b5d151537332241cf60e3",
    "fp_cue_01": "39eb2bfecfa2851aa19b32167adb7029c13182258cbe630a08328c5d7ef61c4d",
    "fp_cue_02": "50cc89fa960f2896f4897ea1256388845ebc4e191c2a28b0e9c5bcf6d133b4f1",
    "fp_cue_03": "3955b44ded4912c6726ce5037d06e2b1d5a23198aa1efd5ed7be8adca6ac02f0",
    "fp_cue_04": "57494b47b2a41ea3eca334a9e902b10efd60de699a30be277838dab574830171",
    "fp_cue_05": "55e5b68266498c13baca420a99480a31529c35d132dbcbec883b3bdbb529c7f1",
    "fp_cue_06": "cae6702b9820d943da22ccf77c37f45ac67738e139524da7474429e4c8e02c90",
    "fp_cue_07": "684e5befea32976be4c8f7cd354ddb76a80d0f6bee1fbed418b415a356e16194",
}
EXPECTED_OVERRIDE_SHA256 = {
    "fp_cue_01": "395b65fd135d43ebfde1ad4b66962030fcf4a659ade759860c52f7576a322939",
    "fp_cue_05": "1564cd72eab95fcb5f915ae1202099a88d2374449b7534f137ec83410292dfac",
    "fp_cue_07": "62ef3e77f6adeb8612a82bd9011e40e33c6bcb236f562da45e3e490ef301beac",
}
EXPECTED_ARTWORK = {
    "media_fp_panorama": {
        "original_bytes": 2_067_676,
        "original_sha256": "92da599e63f7f2afabd81106d6649441b11b5406e7c94ec3ba448c643e6f19d8",
        "gps_exif_present": True,
        "device_exif_present": True,
    },
    "media_fp_engineering": {
        "original_bytes": 1_650_379,
        "original_sha256": "ed4f3bc69b7fd0f34040e3214a1633f410327c0deb3c0c04412d861760de78af",
        "gps_exif_present": False,
        "device_exif_present": True,
    },
}
US_GOVERNMENT_WORK_NOTICE = "No claim to original U.S. Government works."


class FoothillsApprovalError(ValueError):
    """The review source or requested approval scope is incomplete or altered."""


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise FoothillsApprovalError(f"unavailable approval source: {path}") from error
    return digest.hexdigest()


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _load_review() -> dict[str, Any]:
    try:
        value = json.loads(REVIEW_PACKET_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise FoothillsApprovalError("review packet is unavailable") from error
    if not isinstance(value, dict):
        raise FoothillsApprovalError("review packet must be an object")
    return value


def _binding(path: Path, expected_sha256: str) -> dict[str, Any]:
    actual = _sha256_path(path)
    if actual != expected_sha256:
        raise FoothillsApprovalError(f"approval source drifted: {path.name}")
    try:
        display_path = path.relative_to(REPOSITORY).as_posix()
    except ValueError:
        display_path = path.as_posix()
    return {
        "path": display_path,
        "byte_count": path.stat().st_size,
        "sha256": actual,
    }


def _approved_scripts(review: dict[str, Any]) -> list[dict[str, Any]]:
    rows = review.get("scripts")
    if not isinstance(rows, list):
        raise FoothillsApprovalError("review script collection is invalid")
    if [row.get("id") for row in rows] != list(EXPECTED_TRANSCRIPT_SHA256):
        raise FoothillsApprovalError("review script order or membership drifted")

    approved: list[dict[str, Any]] = []
    observed_override_ids: list[str] = []
    for stable_order, row in enumerate(rows, start=1):
        script_id = row["id"]
        transcript = row.get("transcript")
        if not isinstance(transcript, str) or not transcript.strip():
            raise FoothillsApprovalError(f"missing transcript: {script_id}")
        transcript_sha256 = _sha256_text(transcript)
        if (
            transcript_sha256 != EXPECTED_TRANSCRIPT_SHA256[script_id]
            or row.get("transcript_sha256") != transcript_sha256
            or row.get("stable_order") != stable_order
            or row.get("decision_status") != "user_approve_or_revise_required"
            or row.get("rendering_allowed") is not False
        ):
            raise FoothillsApprovalError(f"review script drifted: {script_id}")

        overrides = row.get("variant_overrides", [])
        if not isinstance(overrides, list):
            raise FoothillsApprovalError(f"invalid direction overrides: {script_id}")
        approved_overrides = []
        for override in overrides:
            if not isinstance(override, dict):
                raise FoothillsApprovalError(f"invalid direction override: {script_id}")
            value = override.get("transcript")
            if (
                not isinstance(value, str)
                or override.get("chapter_id") != CHAPTER_ID
                or override.get("variant_id") != "east_to_west"
            ):
                raise FoothillsApprovalError(f"direction override drifted: {script_id}")
            observed_override_ids.append(script_id)
            override_hash = _sha256_text(value)
            if override_hash != EXPECTED_OVERRIDE_SHA256.get(script_id):
                raise FoothillsApprovalError(f"direction transcript drifted: {script_id}")
            approved_overrides.append(
                {
                    "variant_id": "east_to_west",
                    "transcript_sha256": override_hash,
                    "title_sha256": (
                        _sha256_text(override["title"]) if override.get("title") else None
                    ),
                    "exact_transcript_user_approved": True,
                    "narration_approved": False,
                }
            )

        approved.append(
            {
                "stable_order": stable_order,
                "id": script_id,
                "kind": row.get("kind"),
                "title": row.get("title"),
                "base_variant_id": "west_to_east",
                "transcript_sha256": transcript_sha256,
                "direction_overrides": approved_overrides,
                "exact_transcript_user_approved": True,
                "narrator_approved": False,
                "tts_or_render_authorized": False,
                "narration_generated": False,
            }
        )

    if observed_override_ids != list(EXPECTED_OVERRIDE_SHA256):
        raise FoothillsApprovalError("direction override inventory drifted")
    return approved


def _approved_artwork(review: dict[str, Any]) -> list[dict[str, Any]]:
    rows = review.get("artwork_candidates")
    if not isinstance(rows, list):
        raise FoothillsApprovalError("review artwork collection is invalid")
    if [row.get("candidate_id") for row in rows] != list(EXPECTED_ARTWORK):
        raise FoothillsApprovalError("review artwork order or membership drifted")

    approved = []
    for stable_order, row in enumerate(rows, start=1):
        candidate_id = row["candidate_id"]
        evidence = EXPECTED_ARTWORK[candidate_id]
        if any(
            (
                row.get("stable_order") != stable_order,
                row.get("original_bytes") != evidence["original_bytes"],
                row.get("original_sha256") != evidence["original_sha256"],
                row.get("gps_exif_present") is not evidence["gps_exif_present"],
                row.get("device_exif_present") is not evidence["device_exif_present"],
                row.get("rights_basis") != "public_domain_us_government_work",
                row.get("license_name") != "Public domain",
                row.get("required_commercial_notice") != US_GOVERNMENT_WORK_NOTICE,
                row.get("status") != "candidate_only_user_visual_approval_required",
                row.get("user_visual_approval") is not False,
                row.get("sanitized_derivative_complete") is not False,
                row.get("ingestion_allowed") is not False,
                row.get("rendering_allowed") is not False,
                row.get("upload_allowed") is not False,
                row.get("publication_allowed") is not False,
            )
        ):
            raise FoothillsApprovalError(f"review artwork drifted: {candidate_id}")
        approved.append(
            {
                "stable_order": stable_order,
                "candidate_id": candidate_id,
                "intended_use": row["intended_use"],
                "subject": row["subject"],
                "creator": row["creator"],
                "license_name": row["license_name"],
                "rights_basis": row["rights_basis"],
                "asset_url": row["asset_url"],
                "license_record_url": row["license_record_url"],
                "source_page_url": row["source_page_url"],
                "exact_credit": row["exact_credit"],
                "required_commercial_notice": row["required_commercial_notice"],
                "format": row["format"],
                "dimensions": row["dimensions"],
                "original_bytes": row["original_bytes"],
                "original_sha256": row["original_sha256"],
                "original_has_unsanitized_gps_exif": row["gps_exif_present"],
                "original_has_unsanitized_device_exif": row["device_exif_present"],
                "exact_original_user_visual_approval": True,
                "original_immutable": True,
                "sanitation_authorized": False,
                "sanitized_derivative_complete": False,
                "derivative_user_visual_approval": False,
                "ingestion_allowed": False,
                "rendering_allowed": False,
                "upload_allowed": False,
                "publication_allowed": False,
            }
        )
    return approved


def build() -> dict[str, Any]:
    bindings = [
        _binding(REVIEW_PACKET_PATH, EXPECTED_REVIEW_PACKET_SHA256),
        _binding(REVIEW_SHEET_PATH, EXPECTED_REVIEW_SHEET_SHA256),
    ]
    review = _load_review()
    if any(
        (
            review.get("product_id") != PRODUCT_ID,
            review.get("chapter_id") != CHAPTER_ID,
            review.get("status") != "explicit_script_and_artwork_decisions_required",
            review.get("recorded_from_task_id") != APPROVAL_TASK_ID,
        )
    ):
        raise FoothillsApprovalError("review identity or decision status drifted")
    scope = review.get("review_scope", {})
    product = review.get("product_contract", {})
    gate = review.get("decision_gate", {})
    if any(
        (
            scope.get("script_count") != 13,
            scope.get("story_count") != 6,
            scope.get("cue_count") != 7,
            scope.get("artwork_candidate_count") != 2,
            scope.get("other_chapters_approved") is not False,
            product.get("pack_scope") != "one_premium_four_chapter_product",
            product.get("permanent_credit_price") != 900,
            product.get("explorer_included") is not True,
            gate.get("script_decisions_recorded") is not False,
            gate.get("artwork_visual_decisions_recorded") is not False,
            gate.get("artwork_sanitation_allowed") is not False,
            gate.get("tts_or_render_authorized") is not False,
            gate.get("manifest_creation_or_mutation_allowed") is not False,
            gate.get("production_mutation_allowed") is not False,
            gate.get("publication_allowed") is not False,
        )
    ):
        raise FoothillsApprovalError("review gate or product contract drifted")

    scripts = _approved_scripts(review)
    artwork = _approved_artwork(review)
    return {
        "schema_version": 1,
        "overlay_id": OVERLAY_ID,
        "product_id": PRODUCT_ID,
        "chapter_id": CHAPTER_ID,
        "status": "exact_scripts_and_original_artwork_approved_downstream_work_blocked",
        "recorded_at": APPROVED_AT,
        "approval": {
            "approved_at": APPROVED_AT,
            "approved_at_source": "source_task_user_message_event_metadata",
            "approved_by": "project_owner",
            "decision": "approve_all_exact_items_in_preceding_review_gate",
            "decision_text": APPROVAL_DECISION_TEXT,
            "decision_message_sha256": APPROVAL_MESSAGE_SHA256,
            "decision_message_hash_input": "utf8_with_trailing_newline",
            "source_task_id": APPROVAL_TASK_ID,
            "scope": "all_thirteen_exact_scripts_and_both_exact_original_artwork_candidates",
        },
        "source_revision": {
            "guarded_review_source_commit": GUARDED_SOURCE_COMMIT,
            "review_gate_checkpoint_commit": REVIEW_GATE_CHECKPOINT_COMMIT,
            "review_packet_id": review["packet_id"],
            "review_packet_and_sheet_unchanged_between_bound_commits": True,
        },
        "source_bindings": bindings,
        "approved_scripts": scripts,
        "approved_artwork_originals": artwork,
        "approval_set_bindings": {
            "script_approval_set_sha256": _canonical_sha256(scripts),
            "artwork_approval_set_sha256": _canonical_sha256(artwork),
        },
        "summary": {
            "approved_script_count": 13,
            "approved_story_count": 6,
            "approved_cue_count": 7,
            "approved_reverse_override_count": 3,
            "approved_original_artwork_count": 2,
            "approved_original_artwork_bytes": sum(
                row["original_bytes"] for row in artwork
            ),
        },
        "approval_boundary": {
            "foothills_exact_scripts_user_approved": True,
            "foothills_exact_original_artwork_user_approved": True,
            "other_chapters_approved": False,
            "foothills_narrator_approved": False,
            "foothills_narration_approved": False,
            "tts_or_render_authorized": False,
            "narration_generated": False,
            "artwork_sanitation_authorized": False,
            "artwork_sanitation_complete": False,
            "artwork_derivatives_created": False,
            "derivative_visual_approval": False,
            "ingestion_allowed": False,
            "manifest_creation_or_mutation_allowed": False,
            "upload_allowed": False,
            "database_accessed": False,
            "network_accessed_by_builder": False,
            "production_mutation_allowed": False,
            "public_release": False,
            "publication_allowed": False,
            "next_action": "stop_before_sanitation_derivatives_or_narration_until_separately_authorized",
        },
    }


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = serialize(build())
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Foothills approval overlay is stale; rebuild it")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
