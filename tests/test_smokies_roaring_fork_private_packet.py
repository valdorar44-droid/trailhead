import hashlib
import inspect
import json
from pathlib import Path

import pytest

import scripts.build_smokies_roaring_fork_private_packet as builder
import scripts.import_smokies_roaring_fork_private as importer


RECEIPT_PATH = (
    builder.ROOT
    / "originals"
    / "smokies"
    / "roaring_fork_private_import_receipt_v1.json"
)


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_private_packet_rebuild_is_deterministic_and_network_free() -> None:
    authorization, manifest, packet = builder.build_bundle(
        require_local_evidence=False
    )
    assert authorization == _read(builder.AUTHORIZATION_PATH)
    assert manifest == _read(builder.MANIFEST_PATH)
    assert packet == _read(builder.PACKET_PATH)


def test_private_manifest_binds_exact_one_chapter_delivery_contract() -> None:
    _authorization, manifest, packet = builder.build_bundle(
        require_local_evidence=False
    )
    assert manifest["schema_version"] == 3
    assert "pack_id" not in manifest
    assert "narration_profile" not in manifest
    assert "route_evidence" not in manifest
    assert len(manifest["stories"]) == 13
    assert len(manifest["assets"]) == 20
    assert [chapter["id"] for chapter in manifest["chapters"]] == ["roaring_fork"]

    variant = manifest["chapters"][0]["variants"][0]
    combined = sorted(
        [*variant["cue_refs"], *variant["selectable_refs"]],
        key=lambda item: item["sequence"],
    )
    assert [item["sequence"] for item in combined] == list(range(1, 14))
    assert [item["story_id"] for item in combined] == [
        "rf_cue_02",
        "rf_story_03",
        "rf_cue_01",
        "rf_story_01",
        "rf_cue_04",
        "rf_cue_03",
        "rf_story_02",
        "rf_story_04",
        "rf_story_05",
        "rf_cue_05",
        "rf_story_06",
        "rf_story_07",
        "rf_cue_06",
    ]
    assert variant["delivery_contract_sha256"] == packet["manifest"][
        "delivery_contract_sha256"
    ]
    assert packet["scope"] == {
        "product_id": builder.PRODUCT_ID,
        "pack_id": builder.PRODUCT_ID,
        "chapter_id": "roaring_fork",
        "variant_id": "one_way",
        "private_draft_only": True,
    }


def test_private_packet_binds_all_exact_assets_and_rights() -> None:
    _authorization, manifest, packet = builder.build_bundle(
        require_local_evidence=False
    )
    assets = packet["assets"]
    assert len(assets) == 20
    assert len({item["asset_id"] for item in assets}) == 20
    narration = [item for item in assets if item["kind"] == "narration"]
    artwork = [item for item in assets if item["kind"] == "image"]
    assert len(narration) == 13
    assert len(artwork) == 7
    assert sum(item["bytes"] for item in assets) == 239_772_665
    assert all(item["generator"]["admin_license_attestation_required"] for item in narration)
    assert all(item["media"]["sample_rate_hz"] == 44_100 for item in narration)
    assert all(item["media"]["channels"] == 1 for item in narration)
    assert all(set(item["rights"]) == {
        "creator",
        "exact_credit",
        "license_name",
        "license_url",
        "source_page_url",
        "change_note",
        "claim_limit",
    } for item in artwork)
    assert {
        item["id"] for item in manifest["assets"]
    } == {item["asset_id"] for item in assets}


def test_authorization_does_not_open_preview_validation_or_release() -> None:
    authorization, _manifest, packet = builder.build_bundle(
        require_local_evidence=False
    )
    assert authorization["authorization"]["exact_asset_ingestion_after_preflight"] is True
    assert authorization["authorization"]["authenticated_device_preview"] is False
    assert authorization["authorization"]["trusted_publication_validation"] is False
    assert authorization["authorization"]["publication"] is False
    assert authorization["authorization"]["culturally_gated_material"] is False
    assert packet["gates"]["live_target_identified"] is False
    assert packet["gates"]["live_admin_attestation_complete"] is False
    assert packet["gates"]["public_release"] is False


def test_importer_cannot_fabricate_a_license_attestation() -> None:
    generator = importer._generator_metadata()
    assert generator["license_status"] == "unverified"
    assert "license_attestation" not in generator
    assert "attestation" not in str(inspect.signature(importer.apply_private))


def test_configured_import_receipt_is_exact_and_fail_closed() -> None:
    receipt = _read(RECEIPT_PATH)
    packet = _read(builder.PACKET_PATH)

    assert hashlib.sha256(RECEIPT_PATH.read_bytes()).hexdigest() == (
        "8890c1e1431654a03feb1aa4ee4376ab50504e9841b4d8a06f0a3c003b0ebefd"
    )
    assert receipt["status"] == "verified_configured_private_import"
    assert receipt["packet_sha256"] == hashlib.sha256(
        builder.PACKET_PATH.read_bytes()
    ).hexdigest()
    assert receipt["authorization_sha256"] == hashlib.sha256(
        builder.AUTHORIZATION_PATH.read_bytes()
    ).hexdigest()
    assert receipt["manifest_canonical_sha256"] == packet["manifest"][
        "canonical_sha256"
    ]
    assert receipt["delivery_contract_sha256"] == packet["manifest"][
        "delivery_contract_sha256"
    ]

    verified = {
        item["asset_id"]: item["sha256"]
        for item in receipt["assets"]["verified_sha256"]
    }
    expected = {item["asset_id"]: item["sha256"] for item in packet["assets"]}
    assert len(receipt["assets"]["verified_sha256"]) == len(verified) == 20
    assert verified == expected
    assert receipt["assets"] | {"verified_sha256": None} == {
        "artwork": 7,
        "bytes": 239_772_665,
        "narration": 13,
        "total": 20,
        "verified_sha256": None,
    }

    assert receipt["pack"] == {
        "draft_revision": 1,
        "id": builder.PACK_ID,
        "status": "draft",
    }
    assert receipt["post_import"] == {
        "current_asset_count": 20,
        "draft_revision": 1,
        "published_version_count": 0,
        "status": "draft",
    }
    assert receipt["narration_license"] == {
        "required_next_action": (
            "authenticated admin license-attestation endpoint for each narration"
        ),
        "server_owned_attestation_complete": False,
        "status": "unverified",
    }
    assert receipt["gates"] == {
        "admin_license_attestation_complete": False,
        "authenticated_device_preview_complete": False,
        "configured_private_byte_import_complete": True,
        "isolated_import_verified": False,
        "public_release": False,
        "trusted_publication_validation_complete": False,
        "verified_private_upload_complete": False,
    }
    assert receipt["target"] == {
        "asset_root_path_sha256": (
            "b56ed55026a5f435f30a0646a3c843209e089c51acd7418d401c19368abf5c97"
        ),
        "classification": "configured_private",
        "configured": True,
        "database_path_sha256": (
            "38a9d95c2b6aad468f1749d62625e1fb8e97cea361a5e009ab77548dce1c5eb5"
        ),
        "id": "railway.trailhead.production.private",
    }
    assert receipt["rollback"] == {"performed": False, "required": False}


def test_source_file_preflight_rejects_symlinks(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    source = root / "source.bin"
    source.write_bytes(b"verified")
    linked = root / "linked.bin"
    try:
        linked.symlink_to(source)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are unavailable")
    with pytest.raises(importer.PrivateImportError, match="non-symlink"):
        importer._assert_regular_contained(linked, root, "test asset")
