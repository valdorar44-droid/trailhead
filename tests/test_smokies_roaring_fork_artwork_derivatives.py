from __future__ import annotations

import json
import subprocess
import sys

import scripts.build_smokies_roaring_fork_artwork_derivatives as builder


EXPECTED_DERIVATIVES = {
    "01-rf_art_road.png": {
        "bytes": 43_139_412,
        "sha256": "5442a2ee936f0c3a3e54c81a4be0550c2599465494214f5567d2bd1daf481086",
        "pixels": "46fa87fe9857c620cab5b61bdb8ce797247e6ba68bea8cc5352d762119247a6a",
        "dimensions": {"width": 4_284, "height": 5_712},
    },
    "02-rf_art_stream.png": {
        "bytes": 42_092_795,
        "sha256": "ff2671b29b7a0d2818f4a75c12b092e2640adf0306c9a645f7ed61c765e3d8f5",
        "pixels": "35d6f47e74b72053ac2c0b4058ad3ea5ff376888fef0c8b1f294c5f83a9ba5b3",
        "dimensions": {"width": 5_712, "height": 4_284},
    },
    "03-rf_art_forest.png": {
        "bytes": 22_742_999,
        "sha256": "b2aeb6ec1d315a2f19bd7871343a5e7ef7b083e61107d6157b2b0a3926a4d266",
        "pixels": "9c8ff2cdac3cb2bd1afefd6559031020aa06549561133695cb50cde733755239",
        "dimensions": {"width": 3_024, "height": 4_032},
    },
    "04-rf_art_ogle.png": {
        "bytes": 22_151_291,
        "sha256": "a300ccc802b810b8af3fbd14a1a487413a2c569ae5afe836d07fa1f2da1201b4",
        "pixels": "d50b18d8e02478e5f2a5afa6c4dc13993d76d5399b8ad6648760e2cba08b8501",
        "dimensions": {"width": 4_032, "height": 3_024},
    },
    "05-rf_art_historic_cabin.png": {
        "bytes": 73_289_752,
        "sha256": "5ab0ead6c1a826743a883dcba01664aba93848de1e04a5b4a1d3a95b5252ac67",
        "pixels": "f93c0ca6a6a4cd7b656b7eff969cf4da0a9c26efb3f1d5041c1793ff7b994a28",
        "dimensions": {"width": 8_416, "height": 5_611},
    },
    "06-rf_art_grotto_falls.png": {
        "bytes": 5_016_837,
        "sha256": "bf186d2fd61196ca7ec6196af2668200a1de43f140f5c574642e256a0452682a",
        "pixels": "68ab778f4cbe9447d521cf75aa804dff243f508400bf65fa1e8238ed0c03a169",
        "dimensions": {"width": 2_182, "height": 1_470},
    },
    "07-rf_art_thousand_drips.png": {
        "bytes": 5_154_704,
        "sha256": "479650107bf76599950bd05734221e69fcc74066d248b52fce21b5ca19f478b0",
        "pixels": "7dadbe69061783e56222092074dfe65eb9d0350e6e53edb4ce39d9e4b4a2a1ac",
        "dimensions": {"width": 1_489, "height": 2_180},
    },
}


def _tracked() -> dict:
    return json.loads(builder.OUTPUT_PATH.read_text(encoding="utf-8"))


def test_derivative_overlay_rebuild_is_deterministic_and_network_free() -> None:
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
    assert _tracked()["generation_contract"]["network_used"] is False


def test_overlay_binds_immutable_approved_originals() -> None:
    value = _tracked()
    assert value["source_binding"] == {
        "path": "originals/smokies/roaring_fork_artwork_approval_v1.json",
        "byte_count": 14_879,
        "sha256": builder.APPROVAL_SHA256,
    }
    assert builder._sha256_path(builder.APPROVAL_PATH) == builder.APPROVAL_SHA256
    approval = json.loads(builder.APPROVAL_PATH.read_text(encoding="utf-8"))
    assert approval["status"] == "approved_originals_verified_derivatives_pending"
    assert approval["approval_gate"]["user_visual_approval"] is True
    assert approval["approval_gate"]["ingestion_allowed"] is False


def test_all_seven_derivative_byte_pixel_and_dimension_identities_are_locked() -> None:
    rows = _tracked()["derivatives"]
    assert [row["stable_order"] for row in rows] == list(range(1, 8))
    assert [row["derivative_filename"] for row in rows] == list(
        EXPECTED_DERIVATIVES
    )
    assert len({row["derivative_sha256"] for row in rows}) == 7
    assert len({row["decoded_pixel_sha256"] for row in rows}) == 7
    for row in rows:
        expected = EXPECTED_DERIVATIVES[row["derivative_filename"]]
        assert row["derivative_bytes"] == expected["bytes"]
        assert row["derivative_sha256"] == expected["sha256"]
        assert row["decoded_pixel_sha256"] == expected["pixels"]
        assert row["dimensions"] == expected["dimensions"]


def test_orientation_color_and_full_frame_contract_is_explicit() -> None:
    rows = _tracked()["derivatives"]
    rotated = {
        row["candidate_id"]
        for row in rows
        if row["orientation_operation"]
        == "exif_transpose_rotate_90_degrees_clockwise"
    }
    assert rotated == {"rf_art_road", "rf_art_forest"}
    assert sum(row["source_icc_profile"]["embedded"] is True for row in rows) == 5
    assert all(row["full_frame_preserved"] is True for row in rows)
    assert all(row["crop"] == "none" for row in rows)
    assert all(row["resize"] == "none" for row in rows)
    assert all(row["output_color_space"] == "sRGB" for row in rows)
    assert _tracked()["generation_contract"]["source_originals_mutated"] is False


def test_png_derivatives_contain_no_exif_gps_device_or_ancillary_metadata() -> None:
    rows = _tracked()["derivatives"]
    for row in rows:
        assert row["format"] == "PNG"
        assert row["mode"] == "RGB"
        assert row["bit_depth"] == 8
        assert row["png_chunk_types"] == ["IHDR", "IDAT", "IEND"]
        assert row["png_chunk_count"] == row["idat_chunk_count"] + 2
        assert row["ancillary_chunk_count"] == 0
        assert row["exif_tag_count"] == 0
        assert row["gps_exif_present"] is False
        assert row["device_metadata_present"] is False
        assert row["metadata_policy"] == "structural_png_chunks_only"


def test_wsl_and_windows_evidence_reconstruct_to_the_same_records() -> None:
    wsl_records = builder.audit_root(builder.WSL_DERIVATIVE_ROOT)
    windows_records = builder.audit_root(builder.WINDOWS_DERIVATIVE_ROOT)
    assert wsl_records == windows_records
    assert [row["derivative_sha256"] for row in wsl_records] == [
        EXPECTED_DERIVATIVES[name]["sha256"] for name in EXPECTED_DERIVATIVES
    ]


def test_attribution_change_notes_and_claim_limits_are_carried_forward() -> None:
    rows = {row["candidate_id"]: row for row in _tracked()["derivatives"]}
    assert all(row["exact_credit"] for row in rows.values())
    assert all(row["license_name"] for row in rows.values())
    assert all("Full frame preserved" in row["change_note"] for row in rows.values())
    assert all("metadata removed" in row["change_note"] for row in rows.values())
    assert rows["rf_art_road"]["license_name"] == "CC BY 4.0"
    assert "no_old_growth_claim" in rows["rf_art_forest"]["claim_limit"]
    assert "no_structure_name_or_mill_claim" in rows[
        "rf_art_historic_cabin"
    ]["claim_limit"]
    assert "not_visible_from_road" in rows["rf_art_grotto_falls"]["claim_limit"]
    assert "no claim to original U.S. Government work" in rows[
        "rf_art_thousand_drips"
    ]["exact_credit"]


def test_derivative_stage_stops_at_visual_review_gate() -> None:
    value = _tracked()
    assert value["status"] == "verified_derivatives_user_visual_review_required"
    assert value["summary"] == {
        "derivative_count": 7,
        "mirrored_derivative_count": 7,
        "total_derivative_bytes": 213_587_790,
        "orientation_rotated_count": 2,
        "embedded_profile_to_srgb_count": 5,
        "structural_png_only_count": 7,
        "metadata_sanitized_count": 7,
    }
    assert value["approval_gate"] == {
        "original_user_visual_approval": True,
        "immutable_originals_verified": True,
        "orientation_normalized_derivatives_complete": True,
        "gps_device_exif_stripped_derivatives_complete": True,
        "licensed_derivatives_complete": True,
        "derivative_hashes_complete": True,
        "derivative_mirror_complete": True,
        "derivative_user_visual_approval": False,
        "verified_upload_evidence_complete": False,
        "private_manifest_v3_artwork_binding_complete": False,
        "ingestion_allowed": False,
        "public_release": False,
        "next_action": "obtain_explicit_derivative_visual_approval",
    }
    assert all(row["user_visual_approval"] is False for row in value["derivatives"])
    assert all(row["ingestion_allowed"] is False for row in value["derivatives"])


def test_derivative_binaries_remain_outside_the_repository() -> None:
    assert not builder.WSL_DERIVATIVE_ROOT.is_relative_to(builder.REPOSITORY)
    assert not builder.WINDOWS_DERIVATIVE_ROOT.is_relative_to(builder.REPOSITORY)
    for filename in EXPECTED_DERIVATIVES:
        assert not (builder.REPOSITORY / filename).exists()
        assert not (builder.REPOSITORY / "originals/smokies" / filename).exists()
