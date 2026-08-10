from __future__ import annotations

import json
import subprocess
import sys

import scripts.build_smokies_roaring_fork_artwork_derivative_approval as builder


def _tracked() -> dict:
    return json.loads(builder.OUTPUT_PATH.read_text(encoding="utf-8"))


def test_derivative_approval_rebuild_is_deterministic_and_network_free() -> None:
    assert builder.OUTPUT_PATH.read_text(encoding="utf-8") == builder.serialize(
        builder.build()
    )
    result = subprocess.run(
        [sys.executable, str(builder.__file__), "--check"],
        cwd=builder.REPOSITORY,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


def test_approval_binds_the_immutable_verified_derivative_record() -> None:
    value = _tracked()
    assert value["source_binding"] == {
        "path": "originals/smokies/roaring_fork_artwork_derivatives_v1.json",
        "byte_count": 22_622,
        "sha256": builder.DERIVATIVE_SHA256,
    }
    assert builder._sha256_path(builder.DERIVATIVE_PATH) == builder.DERIVATIVE_SHA256
    source = json.loads(builder.DERIVATIVE_PATH.read_text(encoding="utf-8"))
    assert source["status"] == "verified_derivatives_user_visual_review_required"
    assert source["approval_gate"]["derivative_user_visual_approval"] is False


def test_all_seven_exact_derivative_identities_are_approved() -> None:
    value = _tracked()
    rows = value["derivatives"]
    source_rows = json.loads(builder.DERIVATIVE_PATH.read_text(encoding="utf-8"))[
        "derivatives"
    ]
    assert value["approval"] == {
        "approved_at": builder.APPROVED_AT,
        "approved_by": "project_owner",
        "decision": "approve_all_derivatives",
        "decision_text": "approve all derivatives",
        "source_task_id": builder.APPROVAL_TASK_ID,
        "scope": "all_seven_derivatives_in_bound_verified_review_record",
    }
    assert [row["stable_order"] for row in rows] == list(range(1, 8))
    assert [row["candidate_id"] for row in rows] == [
        row["candidate_id"] for row in source_rows
    ]
    assert [row["derivative_sha256"] for row in rows] == [
        row["derivative_sha256"] for row in source_rows
    ]
    assert [row["decoded_pixel_sha256"] for row in rows] == [
        row["decoded_pixel_sha256"] for row in source_rows
    ]
    assert all(row["user_visual_approval"] is True for row in rows)
    assert all(row["derivative_immutable"] is True for row in rows)


def test_approval_preserves_attribution_change_notes_and_claim_limits() -> None:
    rows = {row["candidate_id"]: row for row in _tracked()["derivatives"]}
    assert all(row["exact_credit"] for row in rows.values())
    assert all(row["change_note"] for row in rows.values())
    assert all(row["license_name"] for row in rows.values())
    assert rows["rf_art_road"]["license_name"] == "CC BY 4.0"
    assert "no_old_growth_claim" in rows["rf_art_forest"]["claim_limit"]
    assert "no_structure_name_or_mill_claim" in rows[
        "rf_art_historic_cabin"
    ]["claim_limit"]
    assert "not_visible_from_road" in rows["rf_art_grotto_falls"]["claim_limit"]


def test_approved_derivative_evidence_is_present_in_both_roots() -> None:
    result = builder.verify_evidence(
        builder.WSL_EVIDENCE_ROOT, builder.WINDOWS_EVIDENCE_ROOT
    )
    assert result == {
        "verified_derivative_count": 7,
        "verified_copy_count": 14,
        "total_derivative_bytes": 213_587_790,
        "copies_match": True,
    }


def test_derivative_approval_does_not_open_ingestion_or_release() -> None:
    value = _tracked()
    assert value["status"] == (
        "approved_verified_derivatives_ingestion_authorization_pending"
    )
    assert value["summary"] == {
        "approved_derivative_count": 7,
        "immutable_derivative_count": 7,
        "mirrored_derivative_count": 7,
        "total_derivative_bytes": 213_587_790,
    }
    assert value["approval_gate"] == {
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
    }
    assert all(row["ingestion_allowed"] is False for row in value["derivatives"])


def test_approval_overlay_contains_no_derivative_binary() -> None:
    assert builder.OUTPUT_PATH.suffix == ".json"
    assert not builder.WSL_EVIDENCE_ROOT.is_relative_to(builder.REPOSITORY)
    assert not builder.WINDOWS_EVIDENCE_ROOT.is_relative_to(builder.REPOSITORY)
