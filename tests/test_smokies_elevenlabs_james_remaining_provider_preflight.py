from __future__ import annotations

import ast
import hashlib
import json
import re
from copy import deepcopy
from pathlib import Path

import pytest

from scripts import (
    build_smokies_elevenlabs_james_remaining_provider_preflight as builder,
)


REPOSITORY = Path(__file__).resolve().parents[1]

EXPECTED_CHAPTERS = [
    {
        "chapter_id": "foothills_parkway",
        "requests": 16,
        "reserved": 23_557,
        "renderer": 23_600,
        "key": 25_000,
        "dollar": "2.50",
    },
    {
        "chapter_id": "mountain_crossing",
        "requests": 33,
        "reserved": 65_938,
        "renderer": 66_000,
        "key": 70_000,
        "dollar": "7.00",
    },
    {
        "chapter_id": "little_river_cades_cove",
        "requests": 23,
        "reserved": 48_695,
        "renderer": 48_700,
        "key": 50_000,
        "dollar": "5.00",
    },
]


def _observation() -> dict:
    return json.loads(builder.OBSERVATION_PATH.read_text(encoding="utf-8"))


def _artifacts() -> dict:
    return builder._validated_frozen_artifacts()


def _walk(value):
    if isinstance(value, dict):
        yield from value.keys()
        for item in value.values():
            yield from _walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item)
    else:
        yield value


def test_builder_reproduces_checked_preflight_byte_for_byte() -> None:
    expected = builder.serialize(builder.build())
    assert builder.DESTINATION.read_text(encoding="utf-8") == expected
    assert builder.build() == json.loads(expected)


def test_frozen_locks_are_rebuilt_and_bound_before_assessment() -> None:
    artifacts = _artifacts()
    expected_paths = {
        *(spec.destination for spec in builder.locks_builder.CHAPTER_SPECS),
        builder.locks_builder.BATCH_DESTINATION,
    }
    assert set(artifacts) == expected_paths
    result = builder.build()
    bindings = result["source_bindings"]["frozen_lock_artifacts"]
    assert len(bindings) == 4
    for binding in bindings:
        path = REPOSITORY / binding["path"]
        raw = path.read_bytes()
        assert binding["byte_count"] == len(raw)
        assert binding["sha256"] == hashlib.sha256(raw).hexdigest()


def test_exact_credit_math_fails_closed_for_full_batch() -> None:
    result = builder.build()
    credit = result["account_and_credit_gate"]
    assert credit["total_provider_credits"] == 131_000
    assert credit["used_provider_credits"] == 14_510
    assert credit["available_provider_credits"] == 116_490
    assert credit["full_batch_reserved_provider_credit_ceiling"] == 138_190
    assert credit["full_batch_renderer_character_cap"] == 138_300
    assert credit["full_batch_key_quota_ceiling"] == 145_000
    assert credit["provider_credit_shortfall_against_reservations"] == 21_700
    assert credit["provider_credit_shortfall_against_renderer_caps"] == 21_810
    assert credit["key_quota_shortfall"] == 28_510
    assert credit["reservation_gate_passed"] is False
    assert credit["renderer_cap_gate_passed"] is False
    assert result["decision"]["overall_go"] is False
    assert result["status"] == "blocked_insufficient_credits_no_keys_or_tts"


def test_independent_chapter_envelopes_have_no_borrowing_or_rerender() -> None:
    result = builder.build()
    rows = result["chapter_envelopes"]
    assert [row["chapter_id"] for row in rows] == [
        expected["chapter_id"] for expected in EXPECTED_CHAPTERS
    ]
    for row, expected in zip(rows, EXPECTED_CHAPTERS, strict=True):
        assert row["provider_request_count"] == expected["requests"]
        assert row["reserved_provider_credit_ceiling"] == expected["reserved"]
        assert row["renderer_character_cap"] == expected["renderer"]
        assert row["proposed_one_day_key_credit_quota"] == expected["key"]
        assert row["dollar_cap_usd"] == expected["dollar"]
        assert row["cross_chapter_borrowing_allowed"] is False
        assert row["key_creation_authorized"] is False
        assert row["render_authorized"] is False
        assert row["spend_authorized"] is False
        assert row["current_account_can_cover_this_chapter_alone"] is True
    ledger = result["proposed_key_and_ledger_lifecycle"]["ledger_contract"]
    assert ledger["independent_ledger_per_chapter"] is True
    assert ledger["rerender_budget"] == 0
    assert ledger["accepted_bytes_never_regenerated"] is True


def test_only_credit_gate_blocks_the_live_contract() -> None:
    result = builder.build()
    assert result["decision"]["non_credit_gates_passed"] is True
    assert all(result["decision"]["non_credit_gates"].values())
    assert result["decision"]["credit_gate_passed"] is False

    hypothetical = _observation()
    hypothetical["account"]["total_provider_credits"] = 153_000
    hypothetical["account"]["remaining_provider_credits"] = 138_490
    reassessed = builder._assess(hypothetical, _artifacts())
    assert reassessed["decision"]["credit_gate_passed"] is True
    assert reassessed["decision"]["overall_go"] is True
    assert not any(reassessed["authorization"].values())
    assert reassessed["builder_effects"]["provider_tts_requests_sent"] == 0


def test_exact_james_request_contract_is_explicit_and_non_beta() -> None:
    contract = builder.build()["provider_contract_gate"]
    assert contract == {
        "beta_services_used_or_planned": False,
        "explicit_request_body_settings_required": True,
        "model_id": "eleven_multilingual_v2",
        "output_format_id": "mp3_44100_128",
        "production_non_beta_contract_required": True,
        "provider_request_count": 72,
        "stored_provider_defaults_relied_on": False,
        "voice_id": "EkK5I93UQWFDigLMpZcX",
        "voice_name": "James - Husky, Engaging and Bold",
        "voice_notice_period_days": 730,
        "voice_settings": {
            "similarity_boost": 0.5,
            "speed": 1.0,
            "stability": 0.5,
            "style": 0.1,
            "use_speaker_boost": True,
        },
    }
    artifacts = _artifacts()
    request_lengths = [
        request["payload_character_count"]
        for spec in builder.locks_builder.CHAPTER_SPECS
        for request in artifacts[spec.destination]["requests"]
    ]
    assert len(request_lengths) == 72
    assert max(request_lengths) < _observation()["pricing"]["character_limit_per_request"]


def test_full_current_supporting_policy_tuple_is_bound() -> None:
    terms = builder.build()["terms_gate"]
    assert terms["jurisdiction"] == "non_eea"
    assert terms["primary_terms"] == builder.EXPECTED_PRIMARY_TERMS
    assert terms["voice_library_addendum"] == builder.EXPECTED_VOICE_LIBRARY_ADDENDUM
    assert terms["prohibited_use_policy"] == builder.EXPECTED_PROHIBITED_USE_POLICY
    assert terms["beta_services_addendum"] == builder.EXPECTED_BETA_SERVICES_ADDENDUM
    assert terms["beta_services_addendum_applicable_to_planned_request"] is False
    assert terms["supporting_policy_tuple_matches_review"] is True
    assert terms["terms_point_in_time_only"] is True


def test_restricted_keys_are_capability_only_and_sequential() -> None:
    result = builder.build()
    capability = result["restricted_key_capability_gate"]
    assert capability["capability_confirmed_without_key_creation"] is True
    assert capability["one_day_expiry_available"] is True
    assert capability["per_key_credit_limit_available"] is True
    assert capability["visible_permissions"] == [
        "text_to_speech_access",
        "user_access",
        "voices_read",
    ]
    lifecycle = result["proposed_key_and_ledger_lifecycle"]
    assert lifecycle["key_count"] == 3
    assert lifecycle["active_keys_at_once"] == 1
    assert lifecycle["key_expiry_hours"] == 24
    assert lifecycle["keys_created_sequentially_not_simultaneously"] is True
    assert lifecycle["cross_chapter_borrowing_allowed"] is False
    assert [row["credit_limit"] for row in lifecycle["per_chapter_key_quotas"]] == [
        25_000,
        70_000,
        50_000,
    ]
    assert result["builder_effects"]["api_keys_created"] == 0
    assert result["builder_effects"]["api_keys_deleted"] == 0


def test_billing_date_and_one_time_prepaid_option_are_not_authority() -> None:
    result = builder.build()
    credit = result["account_and_credit_gate"]
    assert credit["next_billing_date"] == "2026-09-08"
    assert credit["next_billing_date_year_inferred_from_observation_date"] is True
    purchase = result["one_time_prepaid_purchase_capability"]
    assert purchase["one_time_purchase_available"] is True
    assert purchase["automatic_top_up_enabled"] is False
    assert purchase["capability_only_not_authorization"] is True
    assert purchase["purchase_submitted"] is False
    assert purchase["visible_exchange_rate"] == {"credits": 10_000, "usd": "1.82"}
    assert result["authorization"]["one_time_prepaid_purchase_authorized"] is False
    assert result["next_owner_decision"]["purchase_amount_selected"] is False


def test_observation_and_result_are_redacted_and_transcript_free() -> None:
    for payload in (_observation(), builder.build()):
        strings = [item for item in _walk(payload) if isinstance(item, str)]
        joined = "\n".join(strings).lower()
        assert "@" not in joined
        assert re.search(r"(?:^|[\\s:=])sk[_-][a-z0-9]", joined) is None
        assert "xi-api-key" not in joined
        assert "/home/" not in joined
        assert "\\wsl" not in joined
        assert "c:\\" not in joined
        assert "transcript" not in joined
        assert "local_path" not in joined
    assert _observation()["account"]["account_identity_recorded"] is False
    assert _observation()["account"]["workspace_identity_recorded"] is False


def test_all_mutation_and_dispatch_authority_remains_false() -> None:
    result = builder.build()
    assert result["authorization"]
    assert not any(result["authorization"].values())
    assert result["next_owner_decision"]["current_batch_must_not_start"] is True
    assert result["next_owner_decision"]["partial_render_is_not_an_authorized_workaround"] is True
    assert result["builder_effects"] == {
        "account_or_billing_changed": False,
        "api_keys_created": 0,
        "api_keys_deleted": 0,
        "database_accessed": False,
        "media_files_created": False,
        "network_accessed": False,
        "provider_accessed": False,
        "provider_credits_spent": 0,
        "provider_tts_requests_sent": 0,
        "purchase_submitted": False,
    }


@pytest.mark.parametrize(
    ("mutator", "message"),
    [
        (lambda value: value["account"].update(plan="free"), "Paid plan"),
        (
            lambda value: value["account"].update(remaining_provider_credits=116_491),
            "arithmetic",
        ),
        (lambda value: value["account"].update(auto_top_up_enabled=True), "Auto Top Up"),
        (
            lambda value: value["voice_and_request_contract"].update(voice_id="drift"),
            "voice_id",
        ),
        (
            lambda value: value["voice_and_request_contract"].update(
                exact_request_voice_settings={"stability": 1}
            ),
            "exact_request_voice_settings",
        ),
        (
            lambda value: value["voice_and_request_contract"].update(
                beta_services_planned=True
            ),
            "Beta Service",
        ),
        (
            lambda value: value["terms"]["primary_terms"].update(
                last_updated="2026-04-01"
            ),
            "primary_terms",
        ),
        (
            lambda value: value["terms"]["prohibited_use_policy"].update(
                last_updated="2025-09-04"
            ),
            "prohibited_use_policy",
        ),
        (
            lambda value: value["terms"]["beta_services_addendum"].update(
                last_updated="2024-11-14"
            ),
            "beta_services_addendum",
        ),
        (
            lambda value: value["key_capability"].update(
                per_key_credit_limit_available=False
            ),
            "per_key_credit_limit_available",
        ),
        (
            lambda value: value["builder_effects"].update(api_keys_created=1),
            "forbidden side effect",
        ),
        (
            lambda value: value["builder_effects"].update(purchase_submitted=True),
            "forbidden side effect",
        ),
        (
            lambda value: value["builder_effects"].update(
                provider_tts_requests_sent=1
            ),
            "forbidden side effect",
        ),
    ],
)
def test_observation_drift_fails_closed(mutator, message: str) -> None:
    observation = _observation()
    mutator(observation)
    with pytest.raises(ValueError, match=message):
        builder._assess(observation, _artifacts())


def test_synchronized_lock_source_drift_fails_closed(monkeypatch) -> None:
    artifacts = builder.locks_builder.build_all()
    changed = deepcopy(artifacts)
    first_path = builder.locks_builder.CHAPTER_SPECS[0].destination
    changed[first_path]["budget"]["reserved_provider_credit_ceiling"] += 1
    monkeypatch.setattr(builder.locks_builder, "build_all", lambda: changed)
    with pytest.raises(ValueError, match="stale or non-deterministic"):
        builder._validated_frozen_artifacts()


def test_builder_imports_no_network_provider_database_or_media_client() -> None:
    source = Path(builder.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imports = {
        alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    }
    assert imports.isdisjoint(
        {
            "aiohttp",
            "boto3",
            "elevenlabs",
            "httpx",
            "pydub",
            "requests",
            "socket",
            "sqlite3",
            "sqlalchemy",
            "urllib",
        }
    )
    assert "text-to-speech/" not in source
    assert "api.elevenlabs" not in source
