from __future__ import annotations

import ast
import hashlib
import json
import socket
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Callable

import pytest

import scripts.build_smokies_checkpoint2_approval as builder


def _tracked() -> dict:
    return json.loads(builder.OUTPUT_PATH.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _mutated_json_source(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    source_name: str,
    mutate: Callable[[dict], None],
) -> None:
    value = json.loads(builder.SOURCE_PATHS[source_name].read_text(encoding="utf-8"))
    mutate(value)
    path = tmp_path / f"{source_name}.json"
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setitem(builder.SOURCE_PATHS, source_name, path)
    monkeypatch.setitem(
        builder.EXPECTED_SOURCE_SHA256,
        source_name,
        hashlib.sha256(path.read_bytes()).hexdigest(),
    )


def _all_keys(value: object) -> list[str]:
    if isinstance(value, dict):
        return [
            key
            for key, nested in value.items()
            for key in (key, *_all_keys(nested))
        ]
    if isinstance(value, list):
        return [key for nested in value for key in _all_keys(nested)]
    return []


def test_overlay_is_deterministic_network_and_database_free(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def denied(*args: object, **kwargs: object) -> None:
        raise AssertionError("approval builder attempted external state access")

    monkeypatch.setattr(socket, "create_connection", denied)
    monkeypatch.setattr(sqlite3, "connect", denied)
    source_hashes_before = {
        name: _sha256(path) for name, path in builder.SOURCE_PATHS.items()
    }
    value = builder.build()
    assert builder.OUTPUT_PATH.read_text(encoding="utf-8") == builder.serialize(value)
    assert source_hashes_before == {
        name: _sha256(path) for name, path in builder.SOURCE_PATHS.items()
    }
    result = subprocess.run(
        [sys.executable, str(builder.__file__), "--check"],
        cwd=builder.REPOSITORY,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""

    imports = {
        alias.name.split(".")[0]
        for node in ast.walk(
            ast.parse(Path(builder.__file__).read_text(encoding="utf-8"))
        )
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    }
    assert not imports & {"requests", "socket", "sqlite3", "subprocess", "urllib"}


def test_exact_authoritative_owner_message_event_is_bound() -> None:
    value = _tracked()
    approval = value["approval"]
    exact = (
        "Approve all Checkpoint 1 items; authorize the six-image sanitation job "
        "and 72 James renders, capped at 138,190 reserved credits and $14.50, "
        "with zero rerenders and no paid overage.\n"
    )
    assert approval["source_task_id"] == "019fe9fb-cafa-75d3-b663-1e5051731cd5"
    assert approval["approved_at"] == "2026-08-11T04:27:57.463Z"
    assert approval["approved_at_source"] == "source_task_user_message_event_metadata"
    assert approval["decision_text_verbatim"] == exact
    assert exact.endswith("\n")
    assert not exact.endswith("\r\n")
    assert len(exact.encode("utf-8")) == 181
    assert approval["decision_message_byte_count"] == 181
    assert approval["decision_message_hash_input"] == (
        "exact_utf8_bytes_with_one_trailing_lf"
    )
    assert hashlib.sha256(exact.encode("utf-8")).hexdigest() == (
        "f6a3e3bc71b2b76b5cf791f8fdf11c7084c9e02ce81e05f2d388e17f44569af3"
    )
    assert approval["decision_message_sha256"] == hashlib.sha256(
        exact.encode("utf-8")
    ).hexdigest()


def test_checkpoint1_commit_tree_parent_and_every_file_binding_are_exact() -> None:
    value = _tracked()
    revision = value["source_revision"]
    commit = "c6193547336b30105152843d8078b9407bc541d8"
    assert revision == {
        "all_bound_sources_verified_at_checkpoint1_commit": True,
        "checkpoint1_commit": commit,
        "checkpoint1_parent_review_source_commit": (
            "6cb0d4f480260e1789add4474054abd80be8c62c"
        ),
        "checkpoint1_tree": "2749d30dfd1951f75b20296eb059c36fb30a7a24",
    }
    tree = subprocess.run(
        ["git", "rev-parse", f"{commit}^{{tree}}"],
        cwd=builder.REPOSITORY,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    assert tree == revision["checkpoint1_tree"]
    parents = subprocess.run(
        ["git", "rev-list", "--parents", "-n", "1", commit],
        cwd=builder.REPOSITORY,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip().split()
    assert parents == [commit, revision["checkpoint1_parent_review_source_commit"]]

    assert set(value["source_bindings"]) == set(builder.SOURCE_PATHS)
    for name, binding in value["source_bindings"].items():
        assert not Path(binding["path"]).is_absolute()
        committed = subprocess.run(
            ["git", "show", f"{commit}:{binding['path']}"],
            cwd=builder.REPOSITORY,
            check=True,
            capture_output=True,
        ).stdout
        assert len(committed) == binding["byte_count"]
        assert hashlib.sha256(committed).hexdigest() == binding["sha256"]
        assert binding["sha256"] == builder.EXPECTED_SOURCE_SHA256[name]


def test_source_and_approved_set_canonical_bindings_are_exact() -> None:
    value = _tracked()
    assert value["source_set_bindings"] == {
        "artwork": "9433e4c7b43bed0579dbb6b9e2aae14b70a8f64d171015809044cbd643263b16",
        "james": "7c907ee636701c12fbcbfac712af6dbff6009106d537d7fc0254f06dc4cdb10f",
        "product_contract": "e5da010dbb06ec0252043a28cc6280dcedbaa3f35b18262e0b43da036f07f1aa",
        "public_record_scope": "d047c643d68d85dd34754f4865c2fea84020c2edf196e7cefdbe6a73ac6b2d76",
        "sanitation": "dd5bb122a4325a570ccd5fd75246c3cb4acdec4b6806e1ddbb3f70b4f316fda6",
        "scripts": "2744e75a4b72142117bfb950a3b304101514e5eeb5812ab55a745aa14d06f924",
    }
    approved = value["approval_set_bindings"]
    assert approved["approved_scripts_sha256"] == builder._canonical_sha256(
        value["approved_remaining_scripts"]
    )
    assert approved["approved_artwork_sha256"] == builder._canonical_sha256(
        value["approved_original_artwork"]
    )
    assert approved["authorized_sanitation_sha256"] == builder._canonical_sha256(
        value["authorized_six_image_sanitation_job"]
    )
    assert approved["authorized_james_sha256"] == builder._canonical_sha256(
        value["authorized_james_render_and_spend"]
    )


def test_exact_fifty_one_scripts_and_five_mountain_overrides_are_approved() -> None:
    scripts = _tracked()["approved_remaining_scripts"]
    assert len(scripts) == 51
    mountain = [row for row in scripts if row["chapter_id"] == "mountain_crossing"]
    cades = [
        row for row in scripts if row["chapter_id"] == "little_river_cades_cove"
    ]
    assert [row["id"] for row in mountain] == list(builder.MOUNTAIN_ENTRY_IDS)
    assert [row["id"] for row in cades] == list(builder.CADES_ENTRY_IDS)
    assert len(mountain) == 28
    assert len(cades) == 23
    assert cades[6]["id"] == "cc_story_10"
    assert cades[10]["id"] == "cc_story_13"
    assert all(row["exact_transcript_user_approved"] is True for row in scripts)
    assert all(row["accepted_james_profile_selected"] is True for row in scripts)
    assert all(row["tts_or_render_authorized"] is True for row in scripts)
    assert all(row["narration_generated"] is False for row in scripts)
    assert all("transcript" not in row for row in scripts)

    overrides = [
        (row["id"], override)
        for row in scripts
        for override in row["direction_overrides"]
    ]
    assert len(overrides) == 5
    assert {entry_id: row["transcript_sha256"] for entry_id, row in overrides} == (
        builder.EXPECTED_OVERRIDE_HASHES
    )
    assert all(row["variant_id"] == "nc_to_tn" for _, row in overrides)
    assert all(row["exact_transcript_user_approved"] is True for _, row in overrides)
    assert all(row["tts_or_render_authorized"] is True for _, row in overrides)
    assert all(row["narration_generated"] is False for _, row in overrides)
    assert all("transcript" not in row for _, row in overrides)


def test_four_exact_artwork_originals_are_approved_but_no_derivative_is() -> None:
    artwork = _tracked()["approved_original_artwork"]
    assert [row["candidate_id"] for row in artwork] == list(
        builder.EXPECTED_ARTWORK_IDS
    )
    assert {row["candidate_id"]: row["original_sha256"] for row in artwork} == (
        builder.EXPECTED_ARTWORK_HASHES
    )
    assert all(row["exact_original_user_visual_approval"] is True for row in artwork)
    assert all(row["sanitation_authorized"] is True for row in artwork)
    assert all(row["sanitized_derivative_complete"] is False for row in artwork)
    assert all(row["derivative_user_visual_approval"] is False for row in artwork)
    assert all(row["ingestion_allowed"] is False for row in artwork)
    assert all(row["upload_allowed"] is False for row in artwork)
    assert all(row["publication_allowed"] is False for row in artwork)

    kuwohi = artwork[0]
    assert kuwohi["source_format"] == "MPO"
    assert kuwohi["source_frame_count"] == 2
    assert kuwohi["selected_primary_frame_index"] == 0
    assert kuwohi["selected_primary_frame_type"] == "Baseline MP Primary Image"
    assert kuwohi["selected_primary_decoded_pixel_sha256"] == (
        "9a10631cbc0956ff74e985b1612b7945f58e433b90d1194d057968ca7ce2b2a9"
    )
    assert kuwohi["excluded_frame"]["included_in_proposed_derivative"] is False
    assert all(row["source_format"] == "TIFF" for row in artwork[2:])
    assert all(row["source_mode"] == "L" for row in artwork[2:])


def test_exact_six_image_sanitation_policy_is_authorized_not_executed() -> None:
    job = _tracked()["authorized_six_image_sanitation_job"]
    expected_hashes = {
        "media_fp_panorama": "92da599e63f7f2afabd81106d6649441b11b5406e7c94ec3ba448c643e6f19d8",
        "media_fp_engineering": "ed4f3bc69b7fd0f34040e3214a1633f410327c0deb3c0c04412d861760de78af",
        **builder.EXPECTED_ARTWORK_HASHES,
    }
    assert job["status"] == "exact_six_image_sanitation_authorized_not_executed"
    assert job["item_count"] == 6
    assert [row["candidate_id"] for row in job["items"]] == list(
        builder.EXPECTED_SANITATION_IDS
    )
    assert {
        row["candidate_id"]: row["source_original_sha256"] for row in job["items"]
    } == expected_hashes
    assert job["sanitation_authorized"] is True
    assert job["derivatives_created"] is False
    assert job["derivative_visual_approval"] is False
    assert job["ingestion_allowed"] is False
    assert job["upload_allowed"] is False
    assert job["publication_allowed"] is False
    for row in job["items"]:
        assert row["exact_original_user_visual_approval"] is True
        assert row["sanitation_authorized"] is True
        assert row["derivative_created"] is False
        assert row["derivative_user_visual_approval"] is False
        assert row["ingestion_allowed"] is False
        assert row["upload_allowed"] is False
        assert row["publication_allowed"] is False
        assert row["crop_allowed"] is False
        assert row["resize_allowed"] is False
        assert row["output_format"] == "PNG"
        assert row["output_mode"] == "RGB"
        assert row["metadata_retained"] is False
        assert row["png_allowed_chunk_types"] == ["IHDR", "IDAT", "IEND"]
        assert row["source_rights_credit_change_note_and_notice_bound"] is True
        assert row["exact_credit"]
        assert row["change_note"].startswith("Modified from the original:")
        if row["rights_basis"] == "public_domain_us_government_work":
            assert row["required_commercial_notice"] == (
                "No claim to original U.S. Government works."
            )

    kuwohi = job["items"][2]
    assert kuwohi["source_format"] == "MPO"
    assert kuwohi["source_frame_count"] == 2
    assert kuwohi["selected_source_frame_index"] == 0
    assert kuwohi["selected_source_frame_type"] == "Baseline MP Primary Image"
    assert kuwohi["frame_policy"] == (
        "preserve_full_selected_primary_frame_only; "
        "do_not_merge_or_retain_secondary_mpo_frame"
    )
    assert "excluded the secondary MPO frame" in kuwohi["change_note"]
    for grayscale in job["items"][4:]:
        assert grayscale["source_format"] == "TIFF"
        assert grayscale["source_mode"] == "L"
        assert grayscale["color_transform"] == (
            "untagged_l_to_srgb_rgb_equal_channel_replication"
        )


def test_exact_james_profile_envelopes_and_guardrails_are_authorized() -> None:
    james = _tracked()["authorized_james_render_and_spend"]
    assert james["status"] == "exact_preflight_render_and_spend_authorized_not_executed"
    assert james["voice"] == {
        "accepted_profile_selected_for_all_three_chapters": True,
        "model_id": "eleven_multilingual_v2",
        "output_format": "mp3_44100_128",
        "provider": "elevenlabs",
        "voice_id": "EkK5I93UQWFDigLMpZcX",
        "voice_name": "James - Husky, Engaging and Bold",
        "voice_settings": {
            "similarity_boost": 0.5,
            "speed": 1.0,
            "stability": 0.5,
            "style": 0.1,
            "use_speaker_boost": True,
        },
    }
    expected_aggregate = {
        "provider_request_count": 72,
        "base_entry_request_count": 64,
        "direction_override_request_count": 8,
        "payload_character_count": 125_595,
        "normalized_character_count": 125_328,
        "reserved_provider_credit_ceiling": 138_190,
        "renderer_character_cap": 138_300,
        "proposed_one_day_api_key_credit_quota": 145_000,
        "dollar_cap_usd": "14.50",
        "chapter_key_count": 3,
        "key_expiry_hours": 24,
        "cross_chapter_borrowing_allowed": False,
        "paid_overage_authorized": False,
        "rerender_budget": 0,
    }
    assert james["aggregate"] == expected_aggregate
    assert [row["chapter_id"] for row in james["chapter_envelopes"]] == list(
        builder.EXPECTED_CHAPTER_ENVELOPES
    )
    for row in james["chapter_envelopes"]:
        expected = builder.EXPECTED_CHAPTER_ENVELOPES[row["chapter_id"]]
        assert {field: row[field] for field in expected} == expected
        assert row["cross_chapter_borrowing_allowed"] is False
        assert row["paid_overage_authorized"] is False
        assert row["rerender_budget"] == 0
        assert row["restricted_one_day_key_creation_authorized"] is True
        assert row["provider_request_authorized"] is True
        assert row["provider_credit_spend_authorized"] is True
        assert row["render_authorized"] is True
        assert row["narration_generated"] is False

    assert james["fresh_authenticated_provider_preflight_authorized"] is True
    assert james["fresh_authenticated_provider_preflight_complete"] is False
    assert james["restricted_one_day_key_creation_authorized"] is True
    assert james["restricted_one_day_keys_created"] == 0
    assert james["provider_request_authorized"] is True
    assert james["provider_credit_spend_authorized"] is True
    assert james["render_authorized"] is True
    assert james["provider_requests_sent"] == 0
    assert james["provider_credits_spent"] == 0
    assert james["narration_generated"] is False
    assert james["automatic_rerender_count"] == 0
    assert james["rerender_authorized"] is False
    assert james["paid_overage_authorized"] is False
    assert james["cross_chapter_borrowing_allowed"] is False
    assert james["hard_reserved_provider_credit_ceiling"] == 138_190
    assert james["hard_renderer_character_cap"] == 138_300
    assert james["hard_combined_one_day_key_quota"] == 145_000
    assert james["hard_dollar_cap_usd"] == "14.50"
    assert james["execution_conditions"] == {
        "ambiguous_timeout_or_billing_behavior": "stop_and_reconcile_without_retry",
        "fresh_account_plan_terms_voice_model_settings_credit_and_key_preflight_required": True,
        "http_5xx_behavior": "stop_without_retry",
        "insufficient_included_credits_behavior": "stop_before_dispatch",
        "invalid_audio_behavior": "stop_without_retry",
        "safe_retry_only": "provider_confirmed_uncharged_429",
        "terms_or_account_drift_behavior": "stop_for_fresh_owner_review",
        "unused_budget_transfer_allowed": False,
    }


def test_four_chapter_earned_credit_contract_and_public_record_scope_remain_exact() -> None:
    value = _tracked()
    assert value["product_contract"] == {
        "changing_scope_or_price_requires_separate_product_decision": True,
        "chapter_ids": [
            "mountain_crossing",
            "little_river_cades_cove",
            "roaring_fork",
            "foothills_parkway",
        ],
        "credit_type": "earned_credits",
        "explorer_included": True,
        "pack_scope": "one_premium_four_chapter_product",
        "permanent_credit_price": 900,
        "route_variant_count": 6,
        "standalone_chapter_products_approved": False,
        "standalone_foothills_public_product_approved": False,
        "standalone_roaring_fork_public_product_approved": False,
    }
    assert value["public_record_scope"] == {
        "claim_count": 34,
        "classification": "public_record_factual",
        "ebci_approval_claimed": False,
        "external_outreach_performed": False,
        "external_outreach_required": False,
        "source_canonical_sha256": (
            "d047c643d68d85dd34754f4865c2fea84020c2edf196e7cefdbe6a73ac6b2d76"
        ),
    }


def test_all_delivery_and_release_gates_remain_false() -> None:
    value = _tracked()
    boundary = value["approval_boundary"]
    assert boundary["artwork_derivatives_created"] is False
    assert boundary["derivative_visual_approval"] is False
    assert boundary["fresh_authenticated_provider_preflight_complete"] is False
    assert boundary["restricted_one_day_keys_created"] == 0
    assert boundary["provider_requests_sent"] == 0
    assert boundary["provider_credits_spent"] == 0
    assert boundary["narration_generated"] is False
    for field in (
        "ingestion_allowed",
        "manifest_creation_or_mutation_allowed",
        "upload_allowed",
        "database_accessed",
        "production_mutation_allowed",
        "trusted_validation_allowed",
        "publication_allowed",
        "public_release",
    ):
        assert boundary[field] is False
    assert value["builder_effects"] == {
        "api_keys_created": 0,
        "database_accessed": False,
        "media_files_created": 0,
        "network_accessed": False,
        "production_mutated": False,
        "provider_accessed": False,
        "provider_credits_spent": 0,
        "provider_requests_sent": 0,
    }


def test_overlay_has_no_absolute_paths_raw_exif_transcripts_or_client_metadata() -> None:
    value = _tracked()
    rendered = builder.serialize(value)
    lowered = rendered.lower()
    for forbidden in (
        "/home/",
        "c:\\\\",
        "\\\\wsl",
        ".codex\\\\sessions",
        ".codex/sessions",
        "rollout-2026",
        "client_id",
    ):
        assert forbidden not in lowered
    keys = set(_all_keys(value))
    assert "transcript" not in keys
    assert "raw_exif" not in keys
    assert "exif_bytes" not in keys
    assert "exif_blob" not in keys
    assert "absolute_path" not in keys
    assert "original_path" not in keys
    assert all(not Path(binding["path"]).is_absolute() for binding in value["source_bindings"].values())


@pytest.mark.parametrize(
    "mutate",
    [
        lambda packet: packet["chapter_reviews"][0]["scripts"][0].__setitem__(
            "transcript_sha256", "0" * 64
        ),
        lambda packet: packet["artwork_candidates"][0].__setitem__(
            "original_sha256", "0" * 64
        ),
        lambda packet: packet["proposed_six_image_sanitation_job"]["items"][0].__setitem__(
            "change_note", "changed"
        ),
        lambda packet: packet["proposed_james_render_and_spend"]["aggregate"].__setitem__(
            "reserved_provider_credit_ceiling", 138_191
        ),
        lambda packet: packet["decision_gate"].__setitem__("upload_allowed", True),
    ],
)
def test_rebound_review_packet_still_fails_closed_on_semantic_drift(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    mutate: Callable[[dict], None],
) -> None:
    _mutated_json_source(monkeypatch, tmp_path, "review_packet", mutate)
    with pytest.raises(builder.Checkpoint2ApprovalError):
        builder.build()


@pytest.mark.parametrize(
    "field,value",
    [
        ("cross_chapter_borrowing_allowed", True),
        ("paid_overage_authorized", True),
        ("rerender_budget", 1),
    ],
)
def test_rebound_chapter_lock_fails_closed_on_budget_escape(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    field: str,
    value: object,
) -> None:
    _mutated_json_source(
        monkeypatch,
        tmp_path,
        "james_mountain_lock",
        lambda lock: lock["budget"].__setitem__(field, value),
    )
    with pytest.raises(builder.Checkpoint2ApprovalError):
        builder.build()


def test_rebound_preflight_fails_closed_if_any_provider_request_was_sent(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _mutated_json_source(
        monkeypatch,
        tmp_path,
        "james_batch_preflight",
        lambda preflight: preflight["builder_effects"].__setitem__(
            "provider_requests_sent", 1
        ),
    )
    with pytest.raises(builder.Checkpoint2ApprovalError):
        builder.build()


def test_rebound_historical_foothills_overlay_cannot_be_rewritten(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _mutated_json_source(
        monkeypatch,
        tmp_path,
        "foothills_approval",
        lambda overlay: overlay["approval_boundary"].__setitem__(
            "artwork_sanitation_authorized", True
        ),
    )
    with pytest.raises(builder.Checkpoint2ApprovalError):
        builder.build()
