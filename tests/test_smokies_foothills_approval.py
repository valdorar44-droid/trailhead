from __future__ import annotations

import hashlib
import json
import socket
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Callable

import pytest

import scripts.build_smokies_foothills_approval as builder


def _tracked() -> dict:
    return json.loads(builder.OUTPUT_PATH.read_text(encoding="utf-8"))


def _mutated_review(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    mutate: Callable[[dict], None],
) -> None:
    value = json.loads(builder.REVIEW_PACKET_PATH.read_text(encoding="utf-8"))
    mutate(value)
    path = tmp_path / "mutated-review.json"
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(builder, "REVIEW_PACKET_PATH", path)
    monkeypatch.setattr(
        builder,
        "EXPECTED_REVIEW_PACKET_SHA256",
        hashlib.sha256(path.read_bytes()).hexdigest(),
    )


def test_overlay_is_deterministic_network_and_database_free(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def denied(*args: object, **kwargs: object) -> None:
        raise AssertionError("approval builder attempted external state access")

    monkeypatch.setattr(socket, "create_connection", denied)
    monkeypatch.setattr(sqlite3, "connect", denied)
    value = builder.build()
    assert builder.OUTPUT_PATH.read_text(encoding="utf-8") == builder.serialize(value)
    result = subprocess.run(
        [sys.executable, str(builder.__file__), "--check"],
        cwd=builder.REPOSITORY,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


def test_exact_user_decision_and_authoritative_event_timestamp_are_bound() -> None:
    approval = _tracked()["approval"]
    assert approval == {
        "approved_at": "2026-08-11T03:09:33.129Z",
        "approved_at_source": "source_task_user_message_event_metadata",
        "approved_by": "project_owner",
        "decision": "approve_all_exact_items_in_preceding_review_gate",
        "decision_message_hash_input": "utf8_with_trailing_newline",
        "decision_message_sha256": builder.APPROVAL_MESSAGE_SHA256,
        "decision_text": "approved",
        "scope": "all_thirteen_exact_scripts_and_both_exact_original_artwork_candidates",
        "source_task_id": "019fe9fb-cafa-75d3-b663-1e5051731cd5",
    }
    assert hashlib.sha256(b"approved\n").hexdigest() == approval[
        "decision_message_sha256"
    ]


def test_review_packet_sheet_and_both_source_revisions_are_immutable_bindings() -> None:
    value = _tracked()
    assert value["source_revision"] == {
        "guarded_review_source_commit": builder.GUARDED_SOURCE_COMMIT,
        "review_gate_checkpoint_commit": builder.REVIEW_GATE_CHECKPOINT_COMMIT,
        "review_packet_and_sheet_unchanged_between_bound_commits": True,
        "review_packet_id": "smokies_foothills_parkway_review_20260810_v1",
    }
    assert value["source_bindings"] == [
        {
            "path": "originals/smokies/foothills_parkway_review_packet_v1.json",
            "byte_count": 55_719,
            "sha256": builder.EXPECTED_REVIEW_PACKET_SHA256,
        },
        {
            "path": "docs/originals/foothills-parkway-review-sheet-v1.md",
            "byte_count": 30_948,
            "sha256": builder.EXPECTED_REVIEW_SHEET_SHA256,
        },
    ]


def test_bound_review_files_match_both_recorded_git_revisions() -> None:
    expected = {
        "originals/smokies/foothills_parkway_review_packet_v1.json": (
            builder.EXPECTED_REVIEW_PACKET_SHA256
        ),
        "docs/originals/foothills-parkway-review-sheet-v1.md": (
            builder.EXPECTED_REVIEW_SHEET_SHA256
        ),
    }
    for commit in (
        builder.GUARDED_SOURCE_COMMIT,
        builder.REVIEW_GATE_CHECKPOINT_COMMIT,
    ):
        for path, expected_sha256 in expected.items():
            result = subprocess.run(
                ["git", "show", f"{commit}:{path}"],
                cwd=builder.REPOSITORY,
                check=False,
                capture_output=True,
            )
            assert result.returncode == 0, result.stderr.decode("utf-8")
            assert hashlib.sha256(result.stdout).hexdigest() == expected_sha256


def test_all_thirteen_exact_scripts_and_three_direction_overrides_are_approved() -> None:
    value = _tracked()
    scripts = value["approved_scripts"]
    review = json.loads(builder.REVIEW_PACKET_PATH.read_text(encoding="utf-8"))
    review_by_id = {row["id"]: row for row in review["scripts"]}
    assert [row["id"] for row in scripts] == list(builder.EXPECTED_TRANSCRIPT_SHA256)
    assert [row["stable_order"] for row in scripts] == list(range(1, 14))
    assert sum(row["kind"] == "story" for row in scripts) == 6
    assert sum(row["kind"] == "cue" for row in scripts) == 7
    assert all(row["exact_transcript_user_approved"] is True for row in scripts)
    assert all(row["narrator_approved"] is False for row in scripts)
    assert all(row["tts_or_render_authorized"] is False for row in scripts)
    for row in scripts:
        source = review_by_id[row["id"]]
        assert row["transcript_sha256"] == hashlib.sha256(
            source["transcript"].encode("utf-8")
        ).hexdigest()
        for override, source_override in zip(
            row["direction_overrides"], source.get("variant_overrides", []), strict=True
        ):
            assert override["transcript_sha256"] == hashlib.sha256(
                source_override["transcript"].encode("utf-8")
            ).hexdigest()
            assert override["narration_approved"] is False
    assert [row["id"] for row in scripts if row["direction_overrides"]] == list(
        builder.EXPECTED_OVERRIDE_SHA256
    )


def test_both_exact_public_domain_originals_are_visually_approved_only() -> None:
    artwork = _tracked()["approved_artwork_originals"]
    assert [row["candidate_id"] for row in artwork] == list(builder.EXPECTED_ARTWORK)
    assert [row["original_sha256"] for row in artwork] == [
        builder.EXPECTED_ARTWORK[candidate_id]["original_sha256"]
        for candidate_id in builder.EXPECTED_ARTWORK
    ]
    assert all(row["license_name"] == "Public domain" for row in artwork)
    assert all(
        row["rights_basis"] == "public_domain_us_government_work" for row in artwork
    )
    assert all(
        row["required_commercial_notice"] == builder.US_GOVERNMENT_WORK_NOTICE
        for row in artwork
    )
    assert all(row["exact_original_user_visual_approval"] is True for row in artwork)
    assert all(row["original_immutable"] is True for row in artwork)
    assert all(row["sanitation_authorized"] is False for row in artwork)
    assert all(row["sanitized_derivative_complete"] is False for row in artwork)
    assert all(row["derivative_user_visual_approval"] is False for row in artwork)
    assert all(row["ingestion_allowed"] is False for row in artwork)
    assert artwork[0]["original_has_unsanitized_gps_exif"] is True
    assert artwork[1]["original_has_unsanitized_gps_exif"] is False
    assert all(row["original_has_unsanitized_device_exif"] is True for row in artwork)


def test_every_downstream_capability_and_other_chapter_scope_remains_closed() -> None:
    boundary = _tracked()["approval_boundary"]
    assert boundary["foothills_exact_scripts_user_approved"] is True
    assert boundary["foothills_exact_original_artwork_user_approved"] is True
    for name, state in boundary.items():
        if name in {
            "foothills_exact_scripts_user_approved",
            "foothills_exact_original_artwork_user_approved",
            "network_accessed_by_builder",
            "database_accessed",
            "next_action",
        }:
            continue
        assert state is False, name
    assert boundary["network_accessed_by_builder"] is False
    assert boundary["database_accessed"] is False
    assert boundary["other_chapters_approved"] is False


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value["decision_gate"].__setitem__("publication_allowed", True),
        lambda value: value["review_scope"].__setitem__("other_chapters_approved", True),
        lambda value: value["scripts"][0].update(
            {
                "transcript": value["scripts"][0]["transcript"] + " drift",
                "transcript_sha256": hashlib.sha256(
                    (value["scripts"][0]["transcript"] + " drift").encode("utf-8")
                ).hexdigest(),
            }
        ),
        lambda value: value["artwork_candidates"][0].__setitem__(
            "original_sha256", "0" * 64
        ),
    ],
)
def test_structural_drift_fails_closed_even_if_outer_packet_hash_is_rebound(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    mutate: Callable[[dict], None],
) -> None:
    _mutated_review(monkeypatch, tmp_path, mutate)
    with pytest.raises(builder.FoothillsApprovalError):
        builder.build()


def test_review_sheet_byte_drift_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    path = tmp_path / "review-sheet.md"
    path.write_bytes(builder.REVIEW_SHEET_PATH.read_bytes() + b"\n")
    monkeypatch.setattr(builder, "REVIEW_SHEET_PATH", path)
    with pytest.raises(builder.FoothillsApprovalError, match="approval source drifted"):
        builder.build()


def test_overlay_preserves_privacy_and_contains_no_transcript_or_local_path() -> None:
    rendered = builder.serialize(_tracked())
    for forbidden in (
        "C:\\\\",
        "/home/",
        "/mnt/",
        "file://",
        "client_id",
        "rollout-",
        "@",
        '"transcript":',
        "gps_coordinates",
        "device_model",
    ):
        assert forbidden not in rendered
