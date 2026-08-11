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

import scripts.build_smokies_remaining_media_acceptance as builder


def _tracked() -> dict:
    return json.loads(builder.OUTPUT_PATH.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _mutated_json(
    source: Path, target: Path, mutate: Callable[[dict], None]
) -> Path:
    value = json.loads(source.read_text(encoding="utf-8"))
    mutate(value)
    target.write_text(
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return target


def _allow_mutated_tracked_binding(
    monkeypatch: pytest.MonkeyPatch,
    source_name: str,
    path: Path,
) -> None:
    monkeypatch.setitem(builder.TRACKED_SOURCE_PATHS, source_name, path)
    monkeypatch.setitem(
        builder.EXPECTED_TRACKED_SOURCES,
        source_name,
        {"byte_count": path.stat().st_size, "sha256": _sha256(path)},
    )
    original = builder._tracked_binding

    def binding(name: str, candidate: Path) -> dict:
        if name == source_name:
            expected = builder.EXPECTED_TRACKED_SOURCES[name]
            assert candidate.stat().st_size == expected["byte_count"]
            assert _sha256(candidate) == expected["sha256"]
            return {
                "path": f"test-fixtures/{name}.json",
                "byte_count": expected["byte_count"],
                "sha256": expected["sha256"],
            }
        return original(name, candidate)

    monkeypatch.setattr(builder, "_tracked_binding", binding)


def _allow_mutated_qa(
    monkeypatch: pytest.MonkeyPatch, source: Path, target: Path, mutate: Callable[[dict], None]
) -> Path:
    path = _mutated_json(source, target, mutate)
    monkeypatch.setattr(builder, "QA_REPORT_BYTES", path.stat().st_size)
    monkeypatch.setattr(builder, "QA_REPORT_SHA256", _sha256(path))
    return path


def test_overlay_is_deterministic_read_only_and_network_free(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def denied(*args: object, **kwargs: object) -> None:
        raise AssertionError("media-acceptance builder attempted external state access")

    monkeypatch.setattr(socket, "create_connection", denied)
    monkeypatch.setattr(sqlite3, "connect", denied)
    before = {
        name: _sha256(path) for name, path in builder.TRACKED_SOURCE_PATHS.items()
    }
    value = builder.build()
    assert builder.serialize(value) == builder.OUTPUT_PATH.read_text(encoding="utf-8")
    assert before == {
        name: _sha256(path) for name, path in builder.TRACKED_SOURCE_PATHS.items()
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
        for node in ast.walk(ast.parse(Path(builder.__file__).read_text("utf-8")))
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    }
    assert not imports.intersection(
        {"requests", "urllib", "httpx", "sqlite3", "socket", "subprocess"}
    )
    assert all(value is False or value == 0 for value in _tracked()["builder_effects"].values())


def test_authoritative_owner_event_is_exact_and_verbatim_scope_is_separate() -> None:
    document = _tracked()
    event = document["owner_event"]
    exact = (
        "Approve the six displayed derivative hashes and the exact 72-file "
        "narration set bound to QA SHA "
        "94812375b47c62d96352f46c6adc0929f0483485a5c171174a4a30fce0995d97\n"
    )
    encoded = exact.encode("utf-8")
    assert event == {
        "approved_at": "2026-08-11T17:42:52.645Z",
        "approved_at_source": "authoritative_source_task_response_item_metadata",
        "approved_by": "project_owner",
        "decision_message_byte_count": 161,
        "decision_message_hash_input": "exact_utf8_bytes_including_one_trailing_lf",
        "decision_message_sha256": "25ae45080fb4d6dcfc82da7845e7b9aed3097e8e7e17f2d3bcdf02a1be5c0605",
        "decision_text_verbatim": exact,
        "ephemeral_client_or_actor_identifier_retained": False,
        "source_content_type": "input_text",
        "source_payload_type": "message",
        "source_record_type": "response_item",
        "source_response_item_id": "msg_019ff1eb-87e5-7383-a8f0-b9b69e537626",
        "source_role": "user",
        "source_task_id": "019fe9fb-cafa-75d3-b663-1e5051731cd5",
        "source_turn_id": "019ff1eb-864b-7e31-b996-66293e382553",
    }
    assert len(encoded) == 161
    assert hashlib.sha256(encoded).hexdigest() == event["decision_message_sha256"]
    assert exact.endswith("\n") and not exact.endswith("\r\n")

    normalized = document["normalized_approval_scope"]
    assert normalized["normalization_is_separate_from_verbatim_hash_input"] is True
    assert normalized["exact_six_derivative_hashes_owner_visual_accepted"] is True
    assert normalized["exact_72_file_narration_set_owner_accepted"] is True
    assert normalized["scope_additions_inferred"] is False
    assert normalized["exhaustive_listening_claim_inferred"] is False
    assert normalized["rerender_or_revision_authority_inferred"] is False


def test_frozen_source_revision_and_exact_evidence_hashes_are_bound() -> None:
    document = _tracked()
    assert document["source_revision"] == {
        "commit": "8e2a116a9f21ec4fb4b140eb5076d331acc42cae",
        "tree": "f017eb87e57f097c75a953d6a22fec50f1ed6c08",
        "parent": "4da66ef668efa0e542cd7b39d4cc42511984bfb0",
        "tracked_sources_verified_at_commit": True,
        "external_media_verified_by_exact_size_and_sha256": True,
    }
    bindings = document["source_bindings"]
    for name, expected in builder.EXPECTED_TRACKED_SOURCES.items():
        assert bindings[name]["byte_count"] == expected["byte_count"]
        assert bindings[name]["sha256"] == expected["sha256"]
        assert not Path(bindings[name]["path"]).is_absolute()
    assert bindings["remaining_audio_qa"] == {
        "absolute_path_serialized": False,
        "byte_count": 200_097,
        "external_evidence_locator": (
            "trailhead-smokies-james-remaining-v1:remaining-audio-qa-v1.json"
        ),
        "sha256": "94812375b47c62d96352f46c6adc0929f0483485a5c171174a4a30fce0995d97",
    }
    assert bindings["qa_transitive_source_bindings"]["renderer_audit"][
        "sha256"
    ] == "f06f4667e968c062e5818363c68ff78fdf6d4503036e6aaf9de9235fcccf8bef"


def test_six_exact_derivatives_and_rights_evidence_are_bound() -> None:
    accepted = _tracked()["accepted_derivative_images"]
    items = accepted["items"]
    assert accepted["count"] == 6 == len(items)
    assert [row["stable_order"] for row in items] == list(range(1, 7))
    assert accepted["derivative_sha256_ordered"] == [
        row["derivative_sha256"] for row in builder.EXPECTED_DERIVATIVES
    ]
    assert len(set(accepted["derivative_sha256_ordered"])) == 6
    assert accepted["derivative_sha256_set_sha256"] == builder._canonical_sha256(
        accepted["derivative_sha256_ordered"]
    )
    for actual, expected in zip(items, builder.EXPECTED_DERIVATIVES, strict=True):
        assert all(actual[key] == value for key, value in expected.items())
        assert actual["exact_derivative_hash_owner_visual_accepted"] is True
        assert actual["source_rights_credit_change_note_and_notice_bound"] is True
        assert actual["exact_credit"]
        assert actual["license_name"]
        assert actual["rights_basis"]
        assert actual["change_note"].startswith("Modified from the original:")
        if actual["rights_basis"] == "public_domain_us_government_work":
            assert actual["required_commercial_notice"] == (
                "No claim to original U.S. Government works."
            )
    kuwohi = next(row for row in items if row["candidate_id"] == "media_mc_kuwohi")
    assert kuwohi["source_format"] == "MPO"
    assert kuwohi["source_frame_count"] == 2
    assert kuwohi["selected_source_frame_index"] == 0
    assert kuwohi["selected_source_frame_type"] == "Baseline MP Primary Image"
    grayscale = [row for row in items if row["candidate_id"].startswith("media_cc_")]
    assert {row["source_format"] for row in grayscale} == {"TIFF"}
    assert {row["mode"] for row in grayscale} == {"RGB"}


def test_exact_72_audio_hashes_bind_transcripts_directions_and_technical_qa() -> None:
    accepted = _tracked()["accepted_narration_set"]
    items = accepted["items"]
    assert accepted["count"] == 72 == len(items)
    assert accepted["base_request_count"] == 64
    assert accepted["direction_override_request_count"] == 8
    assert [row["set_order"] for row in items] == list(range(1, 73))
    assert len({row["audio_sha256"] for row in items}) == 72
    assert len({row["provider_request_id"] for row in items}) == 72
    assert len({row["request_fingerprint"] for row in items}) == 72
    assert accepted["audio_sha256_ordered"] == [
        row["audio_sha256"] for row in items
    ]
    assert accepted["audio_sha256_set_sha256"] == builder._canonical_sha256(
        accepted["audio_sha256_ordered"]
    )
    assert {row["chapter_id"] for row in items} == {
        "foothills_parkway",
        "mountain_crossing",
        "little_river_cades_cove",
    }
    assert {
        chapter: len([row for row in items if row["chapter_id"] == chapter])
        for chapter in {
            "foothills_parkway",
            "mountain_crossing",
            "little_river_cades_cove",
        }
    } == {
        "foothills_parkway": 16,
        "mountain_crossing": 33,
        "little_river_cades_cove": 23,
    }
    for row in items:
        assert len(row["audio_sha256"]) == 64
        assert len(row["raw_transcript_sha256"]) == 64
        assert len(row["normalized_transcript_sha256"]) == 64
        assert row["technical_profile"] == {
            "all_bytes_accounted_for": True,
            "bitrate_kbps": 128,
            "channels": 1,
            "container": "mp3",
            "sample_rate_hz": 44_100,
        }
        assert not Path(row["master_file"]).is_absolute()
        assert ".." not in Path(row["master_file"]).parts
    assert accepted["provider_attempt_count"] == 72
    assert accepted["retry_count"] == 0
    assert accepted["rerender_count"] == 0
    assert accepted["duplicate_count"] == 0
    assert accepted["ambiguous_response_count"] == 0
    assert accepted["provider_credit_cost_total"] == 69_074
    assert accepted["locked_billable_input_character_count_total"] == 125_595
    assert accepted["locked_input_usage_usd_unrounded"] == "12.5595"
    assert accepted["projected_total_cost_usd"] == "12.56"
    assert accepted["hard_dollar_cap_usd"] == "14.50"


def test_closeouts_are_exact_chained_reconciled_and_keys_are_closed() -> None:
    closeouts = _tracked()["provider_closeouts"]
    items = closeouts["items"]
    assert closeouts["count"] == 3 == len(items)
    assert closeouts["chapter_order"] == [
        "foothills_parkway",
        "mountain_crossing",
        "little_river_cades_cove",
    ]
    assert closeouts["closeout_sha256_ordered"] == [
        expected["closeout_sha256"] for expected in builder.EXPECTED_CHAPTER_CLOSEOUTS
    ]
    for actual, expected in zip(
        items, builder.EXPECTED_CHAPTER_CLOSEOUTS, strict=True
    ):
        assert all(actual[key] == value for key, value in expected.items())
        assert actual["all_reconciliations_passed"] is True
        assert actual["key_deleted_and_verified_no_other_active_render_keys"] is True
    assert closeouts[
        "all_usage_request_credit_and_dollar_reconciliations_passed"
    ] is True
    assert closeouts[
        "all_keys_deleted_verified_and_no_other_render_keys_active"
    ] is True


def test_representative_and_flagged_owner_review_set_is_bound_without_overclaim() -> None:
    review = _tracked()["owner_review_set_binding"]
    assert review["selection_policy"] == (
        "one_exact_master_per_chapter_and_direction_plus_every_automated_flag"
    )
    assert review["owner_listening_is_representative_not_exhaustive"] is True
    assert review["flag_count"] == 38
    assert review["unique_flagged_clip_count"] == 36
    assert review["representative_item_count"] == 38
    assert review["counts_by_type"] == {
        "duration_outlier": 1,
        "pacing_outlier": 2,
        "pronunciation_review": 35,
    }
    assert len(review["all_flagged_provider_request_ids"]) == 36
    assert set(review["required_chapter_directions"]) == set(
        review["covered_chapter_directions"]
    )
    assert review["approval_does_not_assert_exhaustive_listening"] is True


def test_historical_roaring_fork_media_is_hash_bound_and_not_reopened() -> None:
    document = _tracked()
    historical = document["protected_historical_media"]
    assert historical == {
        "checkpoint2_protected_prior_evidence_preserved": True,
        "historical_evidence_rewritten_by_builder": False,
        "historical_media_bytes_regenerated": False,
        "historical_release_or_validation_gate_changed": False,
        "historical_scope_reopened": False,
        "roaring_fork_derivative_image_count": 7,
        "roaring_fork_narration_entry_count": 13,
    }
    sources = document["source_bindings"]
    for name in (
        "roaring_fork_artwork_derivative_approval",
        "roaring_fork_real_audio_characterization",
    ):
        assert sources[name]["sha256"] == builder.EXPECTED_TRACKED_SOURCES[name][
            "sha256"
        ]


def test_acceptance_does_not_open_any_downstream_gate() -> None:
    boundary = _tracked()["acceptance_boundary"]
    assert boundary["owner_derivative_image_acceptance"] is True
    assert boundary["owner_media_acceptance"] is True
    assert boundary["exact_media_acceptance_complete"] is True
    assert boundary["technical_qa_complete"] is True
    for key in (
        "narration_revision_authorized",
        "rerender_authorized",
        "upload_allowed",
        "ingestion_allowed",
        "database_accessed",
        "database_mutation_allowed",
        "manifest_creation_or_mutation_allowed",
        "trusted_validation_allowed",
        "deployment_allowed",
        "production_mutation_allowed",
        "publication_allowed",
        "public_release",
    ):
        assert boundary[key] is False


def test_owner_event_drift_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(builder, "DECISION_TEXT", builder.DECISION_TEXT.rstrip("\n"))
    with pytest.raises(builder.MediaAcceptanceError, match="owner event bytes drifted"):
        builder.build()


@pytest.mark.parametrize(
    ("source_name", "mutate", "message"),
    [
        (
            "checkpoint2_owner_approval",
            lambda value: value["protected_prior_evidence"].__setitem__(
                "roaring_fork_evidence_rewritten", True
            ),
            "protected prior evidence drifted",
        ),
        (
            "remaining_artwork_derivatives",
            lambda value: value["approval_gate"].__setitem__(
                "derivative_user_visual_approval", True
            ),
            "derivative evidence gate drifted",
        ),
        (
            "roaring_fork_artwork_derivative_approval",
            lambda value: value["summary"].__setitem__(
                "approved_derivative_count", 6
            ),
            "historical Roaring Fork artwork drifted",
        ),
        (
            "roaring_fork_real_audio_characterization",
            lambda value: value["delivery_inventory"].__setitem__(
                "entry_count", 12
            ),
            "historical Roaring Fork audio drifted",
        ),
    ],
)
def test_semantic_tracked_evidence_drift_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    source_name: str,
    mutate: Callable[[dict], None],
    message: str,
) -> None:
    source = builder.TRACKED_SOURCE_PATHS[source_name]
    changed = _mutated_json(source, tmp_path / source.name, mutate)
    _allow_mutated_tracked_binding(monkeypatch, source_name, changed)
    with pytest.raises(builder.MediaAcceptanceError, match=message):
        builder.build()


def test_audio_qa_semantic_and_media_hash_drift_fail_closed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    source = builder.DEFAULT_RENDER_ROOT / builder.QA_FILENAME
    changed = _allow_mutated_qa(
        monkeypatch,
        source,
        tmp_path / "aggregate-drift.json",
        lambda value: value["aggregate"].__setitem__("mp3_count", 71),
    )
    with pytest.raises(builder.MediaAcceptanceError, match="audio QA aggregate drifted"):
        builder.build(qa_report=changed)


def test_audio_master_hash_drift_fails_closed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    source = builder.DEFAULT_RENDER_ROOT / builder.QA_FILENAME

    def mutate(value: dict) -> None:
        value["audio_assets"][0]["audio_sha256"] = "0" * 64

    changed = _allow_mutated_qa(
        monkeypatch, source, tmp_path / "master-drift.json", mutate
    )
    with pytest.raises(builder.MediaAcceptanceError, match="audio bytes drifted"):
        builder.build(qa_report=changed)


def test_external_path_escape_fails_closed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    source = builder.DEFAULT_RENDER_ROOT / builder.QA_FILENAME

    def mutate(value: dict) -> None:
        value["audio_assets"][0]["master_file"] = "../escaped.mp3"

    changed = _allow_mutated_qa(
        monkeypatch, source, tmp_path / "path-escape.json", mutate
    )
    with pytest.raises(builder.MediaAcceptanceError, match="unsafe external path"):
        builder.build(qa_report=changed)


def test_tracked_files_do_not_leak_paths_identity_secrets_or_transcripts() -> None:
    paths = (Path(builder.__file__), builder.OUTPUT_PATH, Path(__file__))
    forbidden = (
        "/home/" + "sean",
        "C:" + "\\Users\\User",
        "wsl" + ".localhost",
        "client" + "_id",
        "xi-" + "api-key",
        "sk-" + "live",
        "provider" + "_key_name",
        "key" + "_preview",
    )
    for path in paths:
        text = path.read_text(encoding="utf-8")
        assert all(value not in text for value in forbidden)

    document = _tracked()
    serialized = json.dumps(document, sort_keys=True, ensure_ascii=False)
    assert '"transcript":' not in serialized
    assert '"raw_transcript":' not in serialized
    assert '"normalized_transcript":' not in serialized
    assert '"absolute_path"' not in serialized
    assert document["source_bindings"]["remaining_audio_qa"][
        "absolute_path_serialized"
    ] is False
