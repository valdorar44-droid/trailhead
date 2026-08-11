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

import scripts.build_smokies_postpurchase_render_continuation_approval as builder


def _tracked() -> dict:
    return json.loads(builder.OUTPUT_PATH.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _mutated_source(
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
        builder.EXPECTED_SOURCES,
        source_name,
        {
            "byte_count": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        },
    )
    monkeypatch.setattr(
        builder,
        "_binding",
        lambda name, candidate: {
            "path": f"test-fixtures/{name}.json",
            "byte_count": candidate.stat().st_size,
            "sha256": hashlib.sha256(candidate.read_bytes()).hexdigest(),
        },
    )


def test_overlay_is_deterministic_and_effect_free(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def denied(*args: object, **kwargs: object) -> None:
        raise AssertionError("approval builder attempted external state access")

    monkeypatch.setattr(socket, "create_connection", denied)
    monkeypatch.setattr(sqlite3, "connect", denied)
    before = {name: _sha256(path) for name, path in builder.SOURCE_PATHS.items()}
    value = builder.build()
    assert builder.serialize(value) == builder.OUTPUT_PATH.read_text(encoding="utf-8")
    assert before == {
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
        for node in ast.walk(ast.parse(Path(builder.__file__).read_text("utf-8")))
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    }
    assert not imports.intersection(
        {"requests", "urllib", "httpx", "sqlite3", "socket", "subprocess"}
    )
    assert value["builder_effects"] == {
        "network_accessed": False,
        "provider_accessed": False,
        "api_keys_created": 0,
        "provider_requests_sent": 0,
        "provider_credits_spent": 0,
        "purchases_submitted": 0,
        "media_files_created": 0,
        "database_accessed": False,
        "production_mutated": False,
    }


def test_exact_owner_event_identity_is_bound() -> None:
    value = _tracked()
    event = value["owner_event"]
    expected = "i bought the $10. your approved to continue \n"
    encoded = expected.encode("utf-8")
    assert event["source_task_id"] == "019fe9fb-cafa-75d3-b663-1e5051731cd5"
    assert event["source_response_item_id"] == (
        "msg_019fef39-a58c-7742-9fe1-4f87e5388b4d"
    )
    assert event["approved_at"] == "2026-08-11T05:09:20.397Z"
    assert event["decision_text_verbatim"] == expected
    assert len(encoded) == event["decision_message_byte_count"] == 45
    assert encoded[-4:] == b"ue \n"
    assert b"\r" not in encoded
    assert hashlib.sha256(encoded).hexdigest() == event["decision_message_sha256"]
    assert event["decision_message_sha256"] == (
        "74920d6d369286f77f2c48f248cf75cff0dab657a4b8a969a0476d241945ff05"
    )
    assert event["corroborated_event_types"] == [
        "response_item.message",
        "event_msg.user_message",
    ]
    assert event["ephemeral_event_actor_identifier_retained"] is False


def test_exact_frozen_sources_and_revision_are_bound() -> None:
    value = _tracked()
    assert value["source_revision"] == {
        "commit": "3a9e883eddcd5ae9ceef2297f2301f2ad87ea846",
        "tree": "1e092b2d69c0d86e1985a2f7e858027a9e9366cc",
        "parent": "c6193547336b30105152843d8078b9407bc541d8",
        "all_bound_sources_verified_at_commit": True,
    }
    assert value["source_bindings"] == {
        "checkpoint2_approval": {
            "path": "originals/smokies/checkpoint2_owner_approval_v1.json",
            "byte_count": 68_453,
            "sha256": "3cc18dad4d1b6a80f2259e58cbe50fba3804096d0c00437eca9103e626078d5c",
        },
        "prior_provider_observation": {
            "path": (
                "originals/smokies/"
                "elevenlabs_james_remaining_provider_observation_v1.json"
            ),
            "byte_count": 4_431,
            "sha256": "dfae2340fa82cb1d92e70e4d0af1d74f3e9666a72465ccbb51ec362b2b6c2e21",
        },
        "prior_provider_preflight": {
            "path": (
                "originals/smokies/"
                "elevenlabs_james_remaining_provider_preflight_v1.json"
            ),
            "byte_count": 10_768,
            "sha256": "d6deaffbd86cc7b17e241ade7a28a48f07063bbb55dba43907d016da02735eb8",
        },
    }
    assert all(
        not binding["path"].startswith(("/", "\\"))
        and ":" not in binding["path"]
        for binding in value["source_bindings"].values()
    )


def test_purchase_authority_is_finite_and_does_not_expand_scope() -> None:
    purchase = _tracked()["purchase_and_continuation"]
    assert purchase == {
        "owner_reported_purchase_completed": True,
        "purchase_kind": "one_time_finite_prepaid_top_up",
        "purchase_amount_usd": "10.00",
        "purchase_amount_is_a_hard_finite_amount": True,
        "prior_observed_top_up_balance_usd": "0.00",
        "prior_credit_shortfall_against_reservations": 21_700,
        "owner_authorized_resume_of_previously_approved_render": True,
        "new_or_expanded_render_scope_authorized": False,
        "additional_purchase_authorized": False,
        "automatic_top_up_authorized": False,
        "paid_overage_authorized": False,
        "terms_acceptance_or_account_change_authorized": False,
    }


def test_render_contract_is_exact_and_independently_capped() -> None:
    contract = _tracked()["unchanged_render_contract"]
    assert contract["provider_request_count"] == 72
    assert contract["base_request_count"] == 64
    assert contract["direction_override_request_count"] == 8
    assert contract["reserved_provider_credit_ceiling"] == 138_190
    assert contract["renderer_character_cap"] == 138_300
    assert contract["combined_one_day_key_credit_quota"] == 145_000
    assert contract["dollar_cap_usd"] == "14.50"
    assert contract["automatic_rerender_count"] == 0
    assert contract["rerender_authorized"] is False
    assert contract["paid_overage_authorized"] is False
    assert contract["automatic_top_up_authorized"] is False
    assert contract["cross_chapter_borrowing_allowed"] is False
    assert contract["unused_budget_transfer_allowed"] is False
    chapters = contract["chapter_envelopes"]
    assert [row["chapter_id"] for row in chapters] == [
        "foothills_parkway",
        "mountain_crossing",
        "little_river_cades_cove",
    ]
    assert sum(row["provider_request_count"] for row in chapters) == 72
    assert sum(row["reserved_provider_credit_ceiling"] for row in chapters) == 138_190
    assert sum(row["renderer_character_cap"] for row in chapters) == 138_300
    assert sum(row["one_day_key_credit_quota"] for row in chapters) == 145_000
    assert [row["dollar_cap_usd"] for row in chapters] == ["2.50", "7.00", "5.00"]


def test_every_live_and_downstream_effect_remains_closed() -> None:
    boundary = _tracked()["continuation_boundary"]
    assert boundary["owner_purchase_and_continue_event_bound"] is True
    assert boundary["prior_checkpoint2_render_authority_preserved"] is True
    for field in (
        "postpurchase_provider_observation_bound",
        "postpurchase_credit_capacity_preflight_passed",
        "renderer_implementation_audited",
        "live_api_key_creation_allowed",
        "live_provider_requests_allowed",
        "live_provider_credit_spend_allowed",
        "narration_generated",
        "upload_allowed",
        "database_accessed",
        "production_mutation_allowed",
        "trusted_validation_allowed",
        "publication_allowed",
        "public_release",
    ):
        assert boundary[field] is False
    for field in (
        "restricted_one_day_keys_created",
        "provider_requests_sent",
        "provider_credits_spent",
    ):
        assert boundary[field] == 0


@pytest.mark.parametrize(
    ("source_name", "mutate", "message"),
    [
        (
            "checkpoint2_approval",
            lambda value: value["approval"]["scope"].__setitem__(
                "james_provider_request_count", 73
            ),
            "Checkpoint 2 approval scope drifted",
        ),
        (
            "prior_provider_preflight",
            lambda value: value["account_and_credit_gate"].__setitem__(
                "provider_credit_shortfall_against_reservations", 0
            ),
            "prior credit stop evidence drifted",
        ),
        (
            "prior_provider_observation",
            lambda value: value["account"].__setitem__(
                "auto_top_up_enabled", True
            ),
            "prior provider observation drifted",
        ),
    ],
)
def test_semantic_source_drift_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    source_name: str,
    mutate: Callable[[dict], None],
    message: str,
) -> None:
    _mutated_source(monkeypatch, tmp_path, source_name, mutate)
    with pytest.raises(builder.PostpurchaseApprovalError, match=message):
        builder.build()


def test_tracked_files_do_not_leak_paths_identity_or_secrets() -> None:
    paths = (Path(builder.__file__), builder.OUTPUT_PATH, Path(__file__))
    forbidden = (
        "/home/" + "sean",
        "C:" + "\\Users\\User",
        "wsl" + ".localhost",
        "client" + "_id",
        "xi-" + "api-key",
        "sk-" + "live",
    )
    for path in paths:
        text = path.read_text(encoding="utf-8")
        assert all(value not in text for value in forbidden)
