import json
import inspect
from pathlib import Path

import pytest

import scripts.build_smokies_roaring_fork_private_packet as builder
import scripts.import_smokies_roaring_fork_private as importer


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
