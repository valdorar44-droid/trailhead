from __future__ import annotations

import json
import subprocess
import sys

import scripts.build_smokies_roaring_fork_artwork_approval as builder


def _tracked() -> dict:
    return json.loads(builder.OUTPUT_PATH.read_text(encoding="utf-8"))


def test_approval_overlay_rebuild_is_deterministic_and_network_free() -> None:
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


def test_overlay_binds_immutable_review_and_source_dossier() -> None:
    value = _tracked()
    assert value["source_bindings"] == [
        {
            "path": "originals/smokies/roaring_fork_artwork_review_v1.json",
            "byte_count": 17_269,
            "sha256": builder.REVIEW_SHA256,
        },
        {
            "path": "originals/smokies/source_dossiers_v1.json",
            "byte_count": 85_708,
            "sha256": builder.SOURCE_DOSSIER_SHA256,
        },
    ]
    review = json.loads(builder.REVIEW_PATH.read_text(encoding="utf-8"))
    assert review["status"] == "user_visual_approval_required"
    assert review["approval_gate"]["user_visual_approval"] is False


def test_all_seven_approved_originals_have_exact_evidence() -> None:
    value = _tracked()
    originals = value["originals"]
    assert value["approval"] == {
        "approved_at": builder.APPROVED_AT,
        "approved_by": "project_owner",
        "decision": "approve_all",
        "decision_text": "approve all",
        "source_task_id": builder.APPROVAL_TASK_ID,
        "scope": "all_seven_candidates_in_bound_review_packet",
    }
    assert [row["stable_order"] for row in originals] == list(range(1, 8))
    assert [row["candidate_id"] for row in originals] == [
        row["candidate_id"] for row in builder.ORIGINALS
    ]
    assert all(row["user_visual_approval"] is True for row in originals)
    assert all(row["original_immutable"] is True for row in originals)
    assert all(row["original_sha256"] for row in originals)
    assert all(row["original_bytes"] > 0 for row in originals)
    assert len({row["original_sha256"] for row in originals}) == 7
    assert value["summary"] == {
        "approved_candidate_count": 7,
        "downloaded_after_approval_count": 6,
        "reused_prior_verified_original_count": 1,
        "immutable_original_count": 7,
        "mirrored_original_count": 7,
        "total_original_bytes": 174_757_789,
        "gps_exif_original_count": 5,
    }


def test_approval_does_not_open_ingestion_or_release() -> None:
    value = _tracked()
    assert value["status"] == "approved_originals_verified_derivatives_pending"
    assert value["approval_gate"] == {
        "user_visual_approval": True,
        "original_downloads_complete": True,
        "original_hashes_complete": True,
        "immutable_originals_mirrored": True,
        "orientation_normalized_derivatives_complete": False,
        "gps_device_exif_stripped_derivatives_complete": False,
        "licensed_derivatives_complete": False,
        "verified_upload_evidence_complete": False,
        "private_manifest_v3_artwork_binding_complete": False,
        "ingestion_allowed": False,
        "public_release": False,
        "next_action": (
            "build_separately_hashed_orientation_normalized_"
            "gps_device_exif_stripped_derivatives"
        ),
    }
    assert all(row["ingestion_allowed"] is False for row in value["originals"])
    assert "derivative" not in {row["format"].lower() for row in value["originals"]}


def test_original_identity_and_claim_limits_are_carried_forward() -> None:
    originals = {row["candidate_id"]: row for row in _tracked()["originals"]}
    assert originals["rf_art_road"]["display_dimensions"] == {
        "width": 4_284,
        "height": 5_712,
    }
    assert originals["rf_art_forest"]["exif_orientation"] == 6
    assert originals["rf_art_historic_cabin"]["format"] == "TIFF"
    assert originals["rf_art_historic_cabin"]["encoded_dimensions"] == {
        "width": 8_416,
        "height": 5_611,
    }
    assert "no_structure_name_or_mill_claim" in originals[
        "rf_art_historic_cabin"
    ]["claim_limit"]
    assert "not_visible_from_road" in originals["rf_art_grotto_falls"][
        "claim_limit"
    ]
    assert originals["rf_art_grotto_falls"]["gps_exif_present"] is False
    assert originals["rf_art_thousand_drips"]["gps_exif_present"] is False
