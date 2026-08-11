from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

import scripts.build_smokies_remaining_artwork_derivatives as builder


EXPECTED = {
    "media_fp_panorama_sanitized_v1.png": {
        "bytes": 10_144_630,
        "sha256": "75e7605dfd26db71a8fb1877c7195e8f1df18c41d1cc9342041c6f34d5dbaba1",
        "pixels": "aefcc7e4e6fed1cb0c9b8bb93ade3fe9185f3399e8aa9bdd78c00f46ece2b3e6",
        "dimensions": {"width": 4_032, "height": 3_024},
        "idat": 155,
    },
    "media_fp_engineering_sanitized_v1.png": {
        "bytes": 11_042_083,
        "sha256": "f96f1e5143e116e042916ec3f40cd4120454bfa579e9782639c5b2b672271c5e",
        "pixels": "6be15ca5db35336ee346160d312bf1bea55d1a6152a8aa9493cc845cee72798d",
        "dimensions": {"width": 4_320, "height": 3_240},
        "idat": 169,
    },
    "media_mc_kuwohi_sanitized_v1.png": {
        "bytes": 9_018_850,
        "sha256": "956fad4e641b7abe498908e70f0b108f6363fe833f640f6cc02583e1a5713b32",
        "pixels": "7a66bec70f98e4bdcc83e9e0b45543902e2ee4a752bb6a6437fd2cf4d8931ba8",
        "dimensions": {"width": 3_996, "height": 2_775},
        "idat": 138,
    },
    "media_mc_oconaluftee_sanitized_v1.png": {
        "bytes": 12_711_812,
        "sha256": "9dff31bfd0c3e4417b2a67685e5fa3cb67bba8605a3099eb377de197904afd13",
        "pixels": "172d4a2f88f8363fd2e660ffc157ee9265a1fe55c6ae3d9f90a6599b8c08fdd1",
        "dimensions": {"width": 4_032, "height": 3_024},
        "idat": 194,
    },
    "media_cc_cove_sanitized_v1.png": {
        "bytes": 12_819_811,
        "sha256": "80a82ae8ee7353b46ec24105ab80b2e651cd38375f50d9d64a346d092a99652c",
        "pixels": "f54d50976dc1c1b6b477c160b0193263b4bc451b3264324f0c5594cffe7f8232",
        "dimensions": {"width": 5_000, "height": 3_956},
        "idat": 196,
    },
    "media_cc_cable_mill_sanitized_v1.png": {
        "bytes": 13_326_710,
        "sha256": "3540935d92ae2d48a6b2ce15c37da653bd32ec371fb1249191625ce10addcd9b",
        "pixels": "6df57c5b652b3ee7f53421c4bd35b87e90357d513296a6ebbc03431f2c551a71",
        "dimensions": {"width": 5_000, "height": 3_611},
        "idat": 204,
    },
}


def _tracked() -> dict:
    return json.loads(builder.OUTPUT_PATH.read_text(encoding="utf-8"))


def _sha256(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_evidence_rebuild_is_deterministic() -> None:
    result = subprocess.run(
        [sys.executable, str(builder.__file__), "--check", "--verify-evidence"],
        cwd=builder.REPOSITORY,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


def test_exact_owner_approval_and_frozen_packet_are_bound() -> None:
    value = _tracked()
    assert value["source_task_id"] == builder.SOURCE_TASK_ID
    assert value["source_bindings"]["owner_approval"] == {
        "path": "originals/smokies/checkpoint2_owner_approval_v1.json",
        "byte_count": 68_453,
        "sha256": builder.APPROVAL_SHA256,
        "status": (
            "checkpoint2_exact_review_sanitation_and_james_render_approved_"
            "downstream_delivery_blocked"
        ),
    }
    assert value["source_bindings"]["frozen_review_packet"]["sha256"] == (
        builder.PACKET_SHA256
    )
    assert _sha256(builder.APPROVAL_PATH) == builder.APPROVAL_SHA256
    assert _sha256(builder.PACKET_PATH) == builder.PACKET_SHA256
    approval = json.loads(builder.APPROVAL_PATH.read_text(encoding="utf-8"))
    assert approval["approval"]["source_task_id"] == builder.SOURCE_TASK_ID
    assert approval["approval_boundary"]["six_image_sanitation_authorized"] is True
    assert approval["approval_boundary"]["derivative_visual_approval"] is False


def test_all_six_byte_pixel_dimension_and_chunk_identities_are_locked() -> None:
    rows = _tracked()["derivatives"]
    assert [row["stable_order"] for row in rows] == list(range(1, 7))
    assert [row["derivative_filename"] for row in rows] == list(EXPECTED)
    assert len({row["derivative_sha256"] for row in rows}) == 6
    assert len({row["decoded_pixel_sha256"] for row in rows}) == 6
    for row in rows:
        expected = EXPECTED[row["derivative_filename"]]
        assert row["derivative_bytes"] == expected["bytes"]
        assert row["derivative_sha256"] == expected["sha256"]
        assert row["decoded_pixel_sha256"] == expected["pixels"]
        assert row["dimensions"] == expected["dimensions"]
        assert row["idat_chunk_count"] == expected["idat"]


def test_both_external_derivative_copies_are_byte_identical() -> None:
    assert builder.WINDOWS_DERIVATIVE_ROOT is not None
    assert not builder.WSL_DERIVATIVE_ROOT.is_relative_to(builder.REPOSITORY)
    assert not builder.WINDOWS_DERIVATIVE_ROOT.is_relative_to(builder.REPOSITORY)
    for filename, expected in EXPECTED.items():
        wsl = builder.WSL_DERIVATIVE_ROOT / filename
        windows = builder.WINDOWS_DERIVATIVE_ROOT / filename
        assert wsl.stat().st_size == windows.stat().st_size == expected["bytes"]
        assert _sha256(wsl) == _sha256(windows) == expected["sha256"]


def test_all_pngs_have_only_structural_chunks_and_no_metadata() -> None:
    for filename, expected in EXPECTED.items():
        path = builder.WSL_DERIVATIVE_ROOT / filename
        chunks = builder.png_guard._png_chunks(path)
        assert list(dict.fromkeys(chunks)) == ["IHDR", "IDAT", "IEND"]
        assert len(chunks) == expected["idat"] + 2
        with Image.open(path) as image:
            image.load()
            assert image.format == "PNG"
            assert image.mode == "RGB"
            assert image.info == {}
            assert len(image.getexif()) == 0
            assert hashlib.sha256(image.tobytes()).hexdigest() == expected["pixels"]


def test_kuwohi_uses_only_mpo_primary_frame_zero() -> None:
    row = next(
        row for row in _tracked()["derivatives"] if row["candidate_id"] == "media_mc_kuwohi"
    )
    assert row["source_frame_count"] == 2
    assert row["selected_source_frame_index"] == 0
    assert row["selected_source_frame_type"] == "Baseline MP Primary Image"
    assert row["selected_source_decoded_pixel_sha256"] == (
        "9a10631cbc0956ff74e985b1612b7945f58e433b90d1194d057968ca7ce2b2a9"
    )
    assert row["excluded_source_frame"] == {
        "index": 1,
        "mp_type": "Undefined",
        "mode": "L",
        "dimensions": {"width": 1_998, "height": 1_388},
        "decoded_pixel_sha256": (
            "e6a5bf9404280b65469fdfba99d8f9aeacbf021a4b1014fe87232399b6aa38a3"
        ),
        "included_in_derivative": False,
    }


def test_cades_grayscale_samples_are_replicated_equally_into_rgb() -> None:
    for filename in (
        "media_cc_cove_sanitized_v1.png",
        "media_cc_cable_mill_sanitized_v1.png",
    ):
        with Image.open(builder.WSL_DERIVATIVE_ROOT / filename) as image:
            image.load()
            red, green, blue = image.split()
            try:
                assert red.tobytes() == green.tobytes() == blue.tobytes()
            finally:
                red.close()
                green.close()
                blue.close()
    rows = {
        row["candidate_id"]: row for row in _tracked()["derivatives"]
    }
    assert rows["media_cc_cove"]["color_transform"] == (
        "untagged_l_to_srgb_rgb_equal_channel_replication"
    )
    assert rows["media_cc_cable_mill"]["color_transform"] == (
        "untagged_l_to_srgb_rgb_equal_channel_replication"
    )


def test_orientation_color_and_full_frame_contract_is_exact() -> None:
    rows = _tracked()["derivatives"]
    assert all(row["orientation_operation"] == "exif_transpose_identity" for row in rows)
    assert all(row["full_frame_preserved"] is True for row in rows)
    assert all(row["crop"] == "none" and row["resize"] == "none" for row in rows)
    assert all(row["output_color_space"] == "sRGB" for row in rows)
    assert sum(row["source_icc_profile"]["embedded"] is True for row in rows) == 3
    panorama = next(row for row in rows if row["candidate_id"] == "media_fp_panorama")
    assert panorama["decoded_pixel_sha256"] == panorama[
        "selected_source_decoded_pixel_sha256"
    ]


def test_rights_credit_change_notes_and_government_notices_are_exact() -> None:
    rows = {row["candidate_id"]: row for row in _tracked()["derivatives"]}
    assert all(row["exact_credit"] and row["change_note"] for row in rows.values())
    assert all(
        row["source_rights_credit_change_note_and_notice_bound"] is True
        for row in rows.values()
    )
    assert rows["media_mc_kuwohi"]["license_name"] == "CC BY 4.0"
    assert rows["media_mc_kuwohi"]["required_commercial_notice"] is None
    for candidate_id, row in rows.items():
        if candidate_id != "media_mc_kuwohi":
            assert row["required_commercial_notice"] == (
                "No claim to original U.S. Government works."
            )


def test_source_and_generation_effects_are_fail_closed() -> None:
    value = _tracked()
    assert value["source_mirror_audit"]["verified_source_copy_count"] == 12
    assert value["source_mirror_audit"]["copies_match"] is True
    assert value["source_mirror_audit"]["paths_serialized"] is False
    assert value["source_mirror_audit"]["raw_exif_values_serialized"] is False
    assert value["generation_contract"]["network_used"] is False
    assert value["generation_contract"]["provider_used"] is False
    assert value["generation_contract"]["database_accessed"] is False
    assert value["generation_contract"]["source_originals_mutated"] is False
    assert value["generation_contract"]["derivative_binaries_stored_outside_git"] is True


def test_summary_and_visual_review_gate_are_exact() -> None:
    value = _tracked()
    assert value["summary"] == {
        "derivative_count": 6,
        "embedded_profile_to_srgb_count": 3,
        "external_copy_count": 12,
        "grayscale_equal_channel_replication_count": 2,
        "metadata_sanitized_count": 6,
        "mpo_primary_frame_selection_count": 1,
        "structural_png_only_count": 6,
        "total_mirrored_derivative_bytes": 138_127_792,
        "total_unique_derivative_bytes": 69_063_896,
        "untagged_rgb_preserved_count": 1,
    }
    gate = value["approval_gate"]
    assert gate["derivatives_complete"] is True
    assert gate["metadata_sanitation_complete"] is True
    assert gate["derivative_user_visual_approval"] is False
    assert gate["ingestion_allowed"] is False
    assert gate["upload_allowed"] is False
    assert gate["manifest_creation_or_mutation_allowed"] is False
    assert gate["database_accessed"] is False
    assert gate["production_mutation_allowed"] is False
    assert gate["publication_allowed"] is False
    assert gate["public_release"] is False


def test_generation_refuses_repository_or_existing_roots(tmp_path) -> None:
    with pytest.raises(builder.RemainingArtworkDerivativeError, match="outside Git"):
        builder.generate_derivatives(builder.REPOSITORY / "forbidden", builder.WSL_SOURCE_ROOT)
    with pytest.raises(builder.RemainingArtworkDerivativeError, match="already exists"):
        builder.generate_derivatives(tmp_path, builder.WSL_SOURCE_ROOT)


def test_binding_drift_fails_closed(monkeypatch) -> None:
    monkeypatch.setattr(builder, "APPROVAL_SHA256", "0" * 64)
    with pytest.raises(builder.RemainingArtworkDerivativeError, match="SHA-256 drifted"):
        builder._contracts()


def test_tracked_evidence_contains_no_local_paths_raw_exif_or_secrets() -> None:
    combined = "".join(
        path.read_text(encoding="utf-8")
        for path in (Path(builder.__file__), builder.OUTPUT_PATH, Path(__file__))
    )
    forbidden = tuple(
        bytes.fromhex(value).decode("utf-8")
        for value in (
            "2f686f6d652f",
            "2f6d6e742f632f55736572732f",
            "433a5c55736572735c",
            "5c5c77736c",
            "7365616e",
            "4f50454e41495f4150495f4b4559",
            "454c4556454e4c4142535f4150495f4b4559",
            "736b2d",
            "6950686f6e652031342050726f",
            "6950686f6e652038",
            "323032343a30393a31392031373a31303a3334",
            "323031383a30373a32382030363a33303a3233",
        )
    )
    assert all(value not in combined for value in forbidden)
    for filename in EXPECTED:
        assert not (builder.REPOSITORY / filename).exists()
        assert not (builder.REPOSITORY / "originals/smokies" / filename).exists()
