from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "scripts/build_smokies_complete_private_candidate.py"
SPEC = importlib.util.spec_from_file_location(
    "build_smokies_complete_private_candidate", BUILDER_PATH
)
assert SPEC is not None and SPEC.loader is not None
builder = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = builder
SPEC.loader.exec_module(builder)


def load(relative: str | Path) -> dict:
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def manifest() -> dict:
    return load(builder.MANIFEST_PATH)


@pytest.fixture(scope="module")
def candidate() -> dict:
    return load(builder.CANDIDATE_PATH)


@pytest.fixture(scope="module")
def media() -> dict:
    return load(builder.MEDIA_ACCEPTANCE)


def canonical_sha(value: object) -> str:
    payload = json.dumps(
        value, separators=(",", ":"), sort_keys=True, ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def test_builder_check_and_py_compile() -> None:
    subprocess.run(
        [sys.executable, "-m", "py_compile", str(BUILDER_PATH)],
        cwd=ROOT,
        check=True,
    )
    result = subprocess.run(
        [sys.executable, str(BUILDER_PATH), "--check"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    summary = json.loads(result.stdout)
    assert summary["status"] == "verified"
    assert summary["network_accessed"] is False
    assert summary["external_media_accessed"] is False
    assert summary["database_accessed"] is False
    assert summary["upload_performed"] is False
    assert summary["trusted_validation_performed"] is False
    assert summary["deployment_performed"] is False
    assert summary["publication_performed"] is False
    assert set(summary["artifacts"]) == {
        str(builder.MANIFEST_PATH),
        str(builder.PROFILE_PATH),
        str(builder.ATTRIBUTION_PATH),
        str(builder.CANDIDATE_PATH),
    }


def test_all_pinned_inputs_and_readiness_pairs_are_exact() -> None:
    bindings = builder._checked_sources()
    assert set(bindings) == set(builder.PINNED_SHA256)
    for path, row in bindings.items():
        source = ROOT / path
        assert row == {
            "path": path,
            "byte_count": source.stat().st_size,
            "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        }
    pairs = builder._validate_readiness_pairs(bindings)
    assert set(pairs) == set(builder.READINESS_PATHS) == set(builder.TARGET_PATHS)
    assert len(pairs) == 5
    for key, (readiness, target) in pairs.items():
        readiness_path = builder.READINESS_PATHS[key]
        assert target["delivery_readiness_path"] == str(readiness_path)
        assert target["delivery_readiness_sha256"] == bindings[str(readiness_path)][
            "sha256"
        ]
        assert target["delivery_semantics_sha256"] == readiness[
            "delivery_semantics_sha256"
        ]
        assert target["geometry_sha256"] == readiness["route_binding"][
            "geometry_sha256"
        ]
        assert target["delivery_contract_binding"] == (
            "resolve_exact_normalized_manifest_v3_contract_at_validation_time_after_checked_readiness"
        )


def test_builder_fails_closed_on_any_pinned_source_drift(monkeypatch: pytest.MonkeyPatch) -> None:
    original = builder._file_sha

    def changed(path: Path) -> str:
        if path == builder.MEDIA_ACCEPTANCE:
            return "0" * 64
        return original(path)

    monkeypatch.setattr(builder, "_file_sha", changed)
    with pytest.raises(builder.CandidateBuildError, match="Pinned input drifted"):
        builder._checked_sources()


def test_manifest_is_normalized_v3_and_idempotent(manifest: dict) -> None:
    normalized, encoded = builder.normalize_original_manifest_v3(
        manifest,
        pack_id=builder.PRODUCT_ID,
        title=builder.TITLE,
        version=None,
        normalize_v1=builder._private_v1_normalizer,
        publishing=False,
    )
    assert normalized == manifest
    assert len(encoded.encode("utf-8")) <= 8 * 1024 * 1024
    assert manifest["schema_version"] == 3
    assert manifest["consumer_contract"] == {
        "schema_version": 1,
        "contract_id": "originals_long_form_delivery_v1",
        "required_capabilities": [
            "originals_capacity_scheduler_v1",
            "originals_manifest_v3",
            "originals_selectable_v1",
        ],
    }


def test_manifest_exact_inventory_and_order(manifest: dict, candidate: dict) -> None:
    assert [(row["sequence"], row["id"]) for row in manifest["chapters"]] == [
        (1, "mountain_crossing"),
        (2, "little_river_cades_cove"),
        (3, "roaring_fork"),
        (4, "foothills_parkway"),
    ]
    assert [
        (chapter["id"], variant["id"])
        for chapter in manifest["chapters"]
        for variant in chapter["variants"]
    ] == [
        ("mountain_crossing", "tn_to_nc"),
        ("mountain_crossing", "nc_to_tn"),
        ("little_river_cades_cove", "sugarlands_to_cades_cove_loop"),
        ("roaring_fork", "one_way"),
        ("foothills_parkway", "west_to_east"),
        ("foothills_parkway", "east_to_west"),
    ]
    assert len(manifest["stories"]) == 77
    assert sum(len(row.get("variant_overrides", [])) for row in manifest["stories"]) == 8
    assert len(manifest["assets"]) == 98
    assert sum(row["kind"] == "narration" for row in manifest["assets"]) == 85
    assert sum(row["kind"] == "image" for row in manifest["assets"]) == 13
    assert candidate["manifest"]["chapter_count"] == 4
    assert candidate["manifest"]["variant_count"] == 6
    assert candidate["manifest"]["base_entry_count"] == 77
    assert candidate["manifest"]["directional_substitution_count"] == 8
    assert candidate["manifest"]["content_asset_count"] == 98


def test_roaring_fork_historical_story_asset_and_delivery_bytes_are_preserved(
    manifest: dict, candidate: dict
) -> None:
    historical = load(builder.RF_MANIFEST)
    rf_story_ids = {row["id"] for row in historical["stories"]}
    candidate_stories = [row for row in manifest["stories"] if row["id"] in rf_story_ids]
    rf_asset_ids = {row["id"] for row in historical["assets"]}
    candidate_assets = [row for row in manifest["assets"] if row["id"] in rf_asset_ids]
    assert candidate_stories == historical["stories"]
    assert candidate_assets == historical["assets"]
    assert len(candidate_stories) == 13
    assert sum(row["kind"] == "narration" for row in candidate_assets) == 13
    assert sum(row["kind"] == "image" for row in candidate_assets) == 7

    source_chapter = historical["chapters"][0]
    candidate_chapter = next(
        row for row in manifest["chapters"] if row["id"] == "roaring_fork"
    )
    assert candidate_chapter["variants"] == source_chapter["variants"]
    assert builder._delivery_projection(candidate_chapter) == builder._delivery_projection(
        source_chapter
    )
    assert candidate_chapter["sequence"] == 3
    assert candidate_chapter["operational_readiness"]["alternate_chapter_ids"] == [
        "foothills_parkway"
    ]
    preserved = candidate["roaring_fork_preservation"]
    assert preserved["story_rows_sha256"] == preserved[
        "candidate_story_rows_sha256"
    ]
    assert preserved["asset_rows_sha256"] == preserved[
        "candidate_asset_rows_sha256"
    ]
    assert preserved["delivery_projection_sha256"] == preserved[
        "candidate_delivery_projection_sha256"
    ]
    assert preserved["source_manifest_or_historical_evidence_rewritten"] is False


def test_all_72_accepted_audio_rows_bind_exact_assets_and_transcripts(
    manifest: dict, media: dict
) -> None:
    assets = {row["id"]: row for row in manifest["assets"]}
    stories = {row["id"]: row for row in manifest["stories"]}
    rows = media["accepted_narration_set"]["items"]
    assert len(rows) == 72
    seen = set()
    for row in rows:
        asset_id = builder._audio_asset_id(row["provider_request_id"])
        assert asset_id not in seen
        seen.add(asset_id)
        assert assets[asset_id] == {
            "id": asset_id,
            "kind": "narration",
            "path": builder._asset_path(asset_id, row["audio_sha256"]),
            "mime_type": "audio/mpeg",
            "bytes": row["audio_bytes"],
            "sha256": row["audio_sha256"],
        }
        story = stories[row["entry_id"]]
        if row["request_kind"] == "base_entry":
            assert story["audio_asset_id"] == asset_id
            assert story["audio_duration_s"] == row["duration_s"]
            transcript = story["transcript"]
        else:
            matches = [
                override
                for override in story["variant_overrides"]
                if override["variant_id"] == row["override_variant_id"]
            ]
            assert len(matches) == 1
            assert matches[0]["audio_asset_id"] == asset_id
            assert matches[0]["audio_duration_s"] == row["duration_s"]
            transcript = matches[0]["transcript"]
        # OriginalManifestV3 applies its canonical whitespace normalization;
        # the builder separately verifies the pre-normalized editorial bytes
        # against raw_transcript_sha256 before constructing this manifest.
        assert hashlib.sha256(transcript.encode("utf-8")).hexdigest() == row[
            "normalized_transcript_sha256"
        ]
        assert hashlib.sha256(" ".join(transcript.split()).encode("utf-8")).hexdigest() == row[
            "normalized_transcript_sha256"
        ]
    assert len(seen) == 72


def test_exact_directional_substitutions(manifest: dict) -> None:
    actual = {
        (story["id"], override["variant_id"])
        for story in manifest["stories"]
        for override in story.get("variant_overrides", [])
    }
    assert actual == {
        ("fp_cue_01", "east_to_west"),
        ("fp_cue_05", "east_to_west"),
        ("fp_cue_07", "east_to_west"),
        ("mc_cue_01", "nc_to_tn"),
        ("mc_cue_02", "nc_to_tn"),
        ("mc_cue_04", "nc_to_tn"),
        ("mc_cue_08", "nc_to_tn"),
        ("mc_cue_09", "nc_to_tn"),
    }


def test_exact_six_image_assets_and_topic_mapping(manifest: dict, media: dict) -> None:
    stories = {row["id"]: row for row in manifest["stories"]}
    assets = {row["id"]: row for row in manifest["assets"]}
    for item in media["accepted_derivative_images"]["items"]:
        asset_id = builder.IMAGE_ASSET_IDS[item["candidate_id"]]
        assert assets[asset_id] == {
            "id": asset_id,
            "kind": "image",
            "path": builder._asset_path(asset_id, item["derivative_sha256"]),
            "mime_type": "image/png",
            "bytes": item["derivative_bytes"],
            "sha256": item["derivative_sha256"],
        }

    fp_ids = {story_id for story_id in stories if story_id.startswith("fp_")}
    assert {
        story_id
        for story_id in fp_ids
        if stories[story_id]["artwork_asset_id"] == "fp_art_engineering"
    } == set(builder.FOOTHILLS_ENGINEERING_IDS)
    assert all(
        stories[story_id]["artwork_asset_id"] == "fp_art_panorama"
        for story_id in fp_ids - builder.FOOTHILLS_ENGINEERING_IDS
    )

    mc_ids = {story_id for story_id in stories if story_id.startswith("mc_")}
    assert {
        story_id
        for story_id in mc_ids
        if stories[story_id]["artwork_asset_id"] == "mc_art_oconaluftee"
    } == set(builder.MOUNTAIN_OCONALUFTEE_IDS)
    assert all(
        stories[story_id]["artwork_asset_id"] == "mc_art_kuwohi"
        for story_id in mc_ids - builder.MOUNTAIN_OCONALUFTEE_IDS
    )

    cc_ids = {story_id for story_id in stories if story_id.startswith("cc_")}
    assert {
        story_id
        for story_id in cc_ids
        if stories[story_id]["artwork_asset_id"] == "cc_art_cable_mill"
    } == set(builder.CADES_CABLE_MILL_IDS)
    assert all(
        stories[story_id]["artwork_asset_id"] == "cc_art_cove"
        for story_id in cc_ids - builder.CADES_CABLE_MILL_IDS
    )


def test_all_story_claims_have_exact_checked_authoritative_sources(manifest: dict) -> None:
    dossiers = load(builder.DOSSIERS)
    expected_claims = {
        row["id"]: set(row["claim_ids"])
        for path in builder.EDITORIAL_PATHS.values()
        for row in load(path)["entries"]
    }
    for story in manifest["stories"]:
        if story["id"].startswith("rf_"):
            continue
        assert all(citation["role"] == "story" for citation in story["citations"])
        assert all(citation["authority"] == "official" for citation in story["citations"])
        assert all(citation["rights_status"] == "reference_only" for citation in story["citations"])
        actual_claims = {
            claim
            for citation in story["citations"]
            for claim in citation["affected_claims"]
        }
        assert actual_claims == expected_claims[story["id"]]
    assert dossiers["product_id"] == builder.PRODUCT_ID


def test_readiness_semantics_become_exact_manifest_refs_and_contracts(
    manifest: dict, candidate: dict
) -> None:
    chapters = {row["id"]: row for row in manifest["chapters"]}
    contract_rows = {
        (row["chapter_id"], row["variant_id"]): row
        for row in candidate["delivery_contracts"]
    }
    assert len(contract_rows) == 6
    for key, readiness_path in builder.READINESS_PATHS.items():
        readiness = load(readiness_path)
        target = load(builder.TARGET_PATHS[key])
        variant = next(
            row for row in chapters[key[0]]["variants"] if row["id"] == key[1]
        )
        combined = sorted(
            variant["cue_refs"] + variant["selectable_refs"],
            key=lambda row: row["sequence"],
        )
        expected = readiness["expected_delivery_semantics"]["entries"]
        assert [row["story_id"] for row in combined] == [row["id"] for row in expected]
        assert builder._geometry_sha(variant["route"]["geometry"]["coordinates"]) == target[
            "geometry_sha256"
        ]
        assert variant["delivery_contract_sha256"] == (
            builder.original_manifest_v3_delivery_contract_sha256(
                manifest, chapter_id=key[0], variant_id=key[1]
            )
        )
        assert contract_rows[key]["delivery_contract_sha256"] == variant[
            "delivery_contract_sha256"
        ]
        assert contract_rows[key]["validation_passed"] is False


def test_union_offline_region_contains_all_six_routes_and_refs(manifest: dict) -> None:
    offline = manifest["offline_map"]
    assert offline["region_id"] == "smokies_ridges_rivers_living_memory_union_private_v1"
    assert offline["min_zoom"] == 10
    assert offline["max_zoom"] == 16
    assert offline["estimated_bytes"] == 0
    bounds = offline["bounds"]
    variants = [
        variant
        for chapter in manifest["chapters"]
        for variant in chapter["variants"]
    ]
    assert len(variants) == 6
    for variant in variants:
        for lng, lat in variant["route"]["geometry"]["coordinates"]:
            assert bounds["west"] <= lng <= bounds["east"]
            assert bounds["south"] <= lat <= bounds["north"]
        for ref in variant["cue_refs"] + variant["selectable_refs"]:
            if "coordinates" not in ref:
                continue
            assert bounds["west"] <= ref["coordinates"]["lng"] <= bounds["east"]
            assert bounds["south"] <= ref["coordinates"]["lat"] <= bounds["north"]


def test_pack_profile_is_historical_profile_byte_exact_and_james_locked(
    manifest: dict, candidate: dict
) -> None:
    profile_bytes = (ROOT / builder.PROFILE_PATH).read_bytes()
    historical_bytes = (ROOT / builder.RF_PROFILE).read_bytes()
    assert profile_bytes == historical_bytes
    profile = json.loads(profile_bytes)
    assert manifest["narration_profile"] == profile
    assert profile["provider"] == "elevenlabs"
    assert profile["voice_id"] == "EkK5I93UQWFDigLMpZcX"
    assert profile["model_snapshot"] == "eleven_multilingual_v2"
    assert profile["generation"]["output_format"] == "mp3_44100_128"
    expected_settings = {
        "similarity_boost": 0.5,
        "speed": 1.0,
        "stability": 0.5,
        "style": 0.1,
        "use_speaker_boost": True,
    }
    for lock_path in builder.LOCK_PATHS.values():
        assert load(lock_path)["generation_profile"]["voice_settings"] == expected_settings
    assert candidate["narration_profile"][
        "byte_identical_to_historical_accepted_profile"
    ] is True
    assert candidate["narration_profile"][
        "profile_applied_to_all_85_narration_assets"
    ] is True


def test_pack_profile_fails_closed_on_settings_drift() -> None:
    profile = load(builder.RF_PROFILE)
    locks = {chapter: load(path) for chapter, path in builder.LOCK_PATHS.items()}
    locks["mountain_crossing"] = copy.deepcopy(locks["mountain_crossing"])
    locks["mountain_crossing"]["generation_profile"]["voice_settings"][
        "speed"
    ] = 1.01
    with pytest.raises(builder.CandidateBuildError, match="profile drifted"):
        builder._build_profile(profile, locks)


def test_attribution_set_has_exact_13_asset_coverage_and_rights(
    manifest: dict, media: dict
) -> None:
    attribution = load(builder.ATTRIBUTION_PATH)
    rows = attribution["artwork_attributions"]
    assert attribution["artwork_asset_count"] == len(rows) == 13
    image_assets = {
        row["id"]: row for row in manifest["assets"] if row["kind"] == "image"
    }
    assert {row["asset_id"] for row in rows} == set(image_assets)
    stories = {row["id"]: row for row in manifest["stories"]}
    for row in rows:
        assert row["sha256"] == image_assets[row["asset_id"]]["sha256"]
        assert row["story_ids"]
        assert all(stories[item]["artwork_asset_id"] == row["asset_id"] for item in row["story_ids"])
        assert row["exact_credit"]
        assert row["change_note"]
        if row["license_name"] == "CC BY 4.0":
            assert row["license_url"] == "https://creativecommons.org/licenses/by/4.0/"
        if row["rights_basis"] == "public_domain_us_government_work":
            assert row["required_commercial_notice"] == (
                "No claim to original U.S. Government works."
            )
    accepted = {
        builder.IMAGE_ASSET_IDS[row["candidate_id"]]: row
        for row in media["accepted_derivative_images"]["items"]
    }
    for row in rows:
        if row["asset_id"] in accepted:
            source = accepted[row["asset_id"]]
            assert row["exact_credit"] == source["exact_credit"]
            assert row["change_note"] == source["change_note"]
    rf_rights = {
        row["candidate_id"]: row
        for row in load(builder.RF_ARTWORK_REVIEW)["candidates"]
    }
    for row in rows:
        if row["asset_id"].startswith("rf_"):
            assert row["rights_basis"] == rf_rights[row["asset_id"]]["rights_basis"]
    highsmith = next(row for row in rows if row["asset_id"] == "rf_art_historic_cabin")
    assert highsmith["rights_basis"] == (
        "public_domain_dedication_no_known_restrictions"
    )
    assert highsmith["required_commercial_notice"] is None


def test_product_contract_is_one_bundle_900_explorer_no_standalone(candidate: dict) -> None:
    contract = candidate["product_contract"]
    assert contract["pack_scope"] == "one_premium_four_chapter_product"
    assert contract["chapter_ids"] == list(builder.CHAPTER_ORDER)
    assert contract["credit_type"] == "earned_credits"
    assert contract["permanent_credit_price"] == 900
    assert contract["explorer_included"] is True
    assert contract["public_catalog_product_count"] == 1
    assert contract["standalone_product_ids"] == []
    assert contract["standalone_chapter_products_approved"] is False
    assert contract["standalone_foothills_public_product_approved"] is False
    assert contract["standalone_roaring_fork_public_product_approved"] is False
    assert contract["changing_scope_or_price_requires_separate_product_decision"] is True


def test_candidate_binds_frozen_route_readiness_commit_and_tree(candidate: dict) -> None:
    assert candidate["source_revision"] == {
        "commit": "102fff55328f4d15ec5757f82f87d235508ebb2b",
        "tree": "3017790b491545559634c498612ce4a017a0d880",
        "frozen_route_readiness_slice_committed": True,
        "uncommitted_release_guard_work_bound": False,
    }
    tree = subprocess.run(
        ["git", "show", "-s", "--format=%T", builder.SOURCE_COMMIT],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    assert tree == builder.SOURCE_TREE
    assert candidate["private_candidate_assembly_authority"] == {
        "source_task_id": "019fe9fb-cafa-75d3-b663-1e5051731cd5",
        "workflow_checkpoint": 4,
        "trigger": "exact_checkpoint3_media_acceptance_complete",
        "automatic_network_free_private_candidate_step": True,
        "prior_media_overlays_rewritten_to_manufacture_manifest_authority": False,
        "authority_expands_to_upload_or_database_or_release": False,
    }


def test_all_downstream_gates_are_false_and_candidate_is_private(candidate: dict) -> None:
    assert candidate["status"] == (
        "complete_private_candidate_owner_dual_platform_preview_required"
    )
    assert candidate["gates"] == {
        "private_candidate_built": True,
        "owner_dual_platform_preview_accepted": False,
        "upload_allowed": False,
        "ingestion_allowed": False,
        "database_accessed": False,
        "database_mutation_allowed": False,
        "trusted_validation_allowed": False,
        "trusted_validation_passed": False,
        "deployment_allowed": False,
        "production_mutation_allowed": False,
        "publication_allowed": False,
        "public_release": False,
    }
    assert candidate["manifest"]["asset_upload_or_availability_claimed"] is False
    assert candidate["route_duration_estimates"] == {
        "basis": "deterministic_private_placeholder_at_36_mph_from_checked_route_distance",
        "owner_accepted": False,
        "real_audio_timing_passed": False,
        "trusted_validation_evidence": False,
        "publication_evidence": False,
    }
    assert all(row["validation_passed"] is False for row in candidate["delivery_contracts"])
    assert all(
        row["trusted_validation_passed"] is False
        for row in candidate["readiness_and_route_targets"]["pairs"]
    )


def test_strict_privacy_and_no_external_media_paths_are_serialized() -> None:
    paths = [
        BUILDER_PATH,
        Path(__file__),
        ROOT / builder.MANIFEST_PATH,
        ROOT / builder.PROFILE_PATH,
        ROOT / builder.ATTRIBUTION_PATH,
        ROOT / builder.CANDIDATE_PATH,
    ]
    forbidden = [
        "/" + "home" + "/" + "sean",
        "C:" + "\\" + "Users" + "\\" + "User",
        "wsl" + ".localhost",
        "\\\\" + "wsl",
        "client" + "_id",
        "provider" + "_key_id",
        "api" + "_key",
        "key" + "_preview",
    ]
    for path in paths:
        text = path.read_text(encoding="utf-8")
        for value in forbidden:
            assert value.lower() not in text.lower(), (path, value)

    candidate = load(builder.CANDIDATE_PATH)
    manifest = load(builder.MANIFEST_PATH)
    attribution = load(builder.ATTRIBUTION_PATH)
    assert candidate["privacy"] == {
        "absolute_local_paths_serialized": False,
        "external_media_root_serialized": False,
        "raw_exif_serialized": False,
        "provider_key_or_account_identity_serialized": False,
    }
    assert attribution["privacy"] == {
        "absolute_local_paths_serialized": False,
        "raw_exif_serialized": False,
        "provider_or_account_secret_serialized": False,
    }
    for asset in manifest["assets"]:
        assert re.fullmatch(
            rf"/api/original-assets/{builder.PRODUCT_ID}/{re.escape(asset['id'])}/[a-f0-9]{{64}}",
            asset["path"],
        )


def test_artifact_bindings_match_exact_bytes(candidate: dict) -> None:
    manifest_bytes = (ROOT / builder.MANIFEST_PATH).read_bytes()
    profile_bytes = (ROOT / builder.PROFILE_PATH).read_bytes()
    attribution_bytes = (ROOT / builder.ATTRIBUTION_PATH).read_bytes()
    assert candidate["manifest"]["byte_count"] == len(manifest_bytes)
    assert candidate["manifest"]["sha256"] == hashlib.sha256(manifest_bytes).hexdigest()
    assert candidate["narration_profile"]["byte_count"] == len(profile_bytes)
    assert candidate["narration_profile"]["sha256"] == hashlib.sha256(
        profile_bytes
    ).hexdigest()
    assert candidate["attribution_set"]["byte_count"] == len(attribution_bytes)
    assert candidate["attribution_set"]["sha256"] == hashlib.sha256(
        attribution_bytes
    ).hexdigest()


def test_manifest_contract_tamper_is_rejected(manifest: dict) -> None:
    tampered = copy.deepcopy(manifest)
    chapter = next(row for row in tampered["chapters"] if row["id"] == "mountain_crossing")
    chapter["variants"][0]["delivery_contract_sha256"] = "0" * 64
    with pytest.raises(Exception, match="delivery contract hash"):
        builder.normalize_original_manifest_v3(
            tampered,
            pack_id=builder.PRODUCT_ID,
            title=builder.TITLE,
            version=None,
            normalize_v1=builder._private_v1_normalizer,
            publishing=False,
        )
