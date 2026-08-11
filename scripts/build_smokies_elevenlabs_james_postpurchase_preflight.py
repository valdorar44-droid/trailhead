#!/usr/bin/env python3
"""Build the fresh post-purchase green gate for the locked 72-file batch.

The checked result is point-in-time provider evidence plus a code-audit hold.
It is not by itself authority to create a key or send a TTS request.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Mapping


REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from scripts import build_smokies_checkpoint2_approval as approval_builder
from scripts import build_smokies_elevenlabs_james_remaining_locks as locks_builder
from scripts import (
    build_smokies_postpurchase_render_continuation_approval as continuation_builder,
)


ORIGINALS = REPOSITORY / "originals/smokies"
OBSERVATION_PATH = (
    ORIGINALS / "elevenlabs_james_remaining_provider_observation_v2.json"
)
DESTINATION = (
    ORIGINALS / "elevenlabs_james_remaining_postpurchase_preflight_v2.json"
)
PRIOR_OBSERVATION_PATH = (
    ORIGINALS / "elevenlabs_james_remaining_provider_observation_v1.json"
)
APPROVAL_PATH = ORIGINALS / "checkpoint2_owner_approval_v1.json"
CONTINUATION_APPROVAL_PATH = continuation_builder.OUTPUT_PATH

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
PREFLIGHT_ID = (
    "great_smoky_mountains_elevenlabs_james_remaining_postpurchase_preflight_v2"
)
VOICE_ID = "EkK5I93UQWFDigLMpZcX"
VOICE_NAME = "James - Husky, Engaging and Bold"
MODEL_ID = "eleven_multilingual_v2"
OUTPUT_FORMAT_ID = "mp3_44100_128"
VOICE_SETTINGS = {
    "similarity_boost": 0.5,
    "speed": 1.0,
    "stability": 0.5,
    "style": 0.1,
    "use_speaker_boost": True,
}
POLICY_TUPLE = {
    "beta_services_addendum": {
        "last_updated": "2024-11-13",
        "terms_id": "elevenlabs_beta_services_addendum_2024-11-13",
        "title": "Beta Services Addendum",
        "url": "https://elevenlabs.io/bsa",
    },
    "primary_terms": {
        "last_updated": "2026-03-31",
        "terms_id": "elevenlabs_terms_of_service_non_eea_2026-03-31",
        "title": "ElevenLabs Terms of Service (non-EEA)",
        "url": "https://elevenlabs.io/terms-of-use",
    },
    "prohibited_use_policy": {
        "last_updated": "2025-09-03",
        "terms_id": "elevenlabs_prohibited_use_policy_2025-09-03",
        "title": "ElevenLabs Prohibited Use Policy",
        "url": "https://elevenlabs.io/use-policy",
    },
    "voice_library_addendum": {
        "last_updated": "2026-03-06",
        "terms_id": "elevenlabs_voice_library_addendum_2026-03-06",
        "title": "ElevenLabs Voice Library Addendum",
        "url": "https://elevenlabs.io/vla",
    },
}
CHAPTER_ORDER = (
    "foothills_parkway",
    "mountain_crossing",
    "little_river_cades_cove",
)


class PostpurchasePreflightError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise PostpurchasePreflightError(message)


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PostpurchasePreflightError(f"unreadable_source:{path.name}") from exc
    _require(isinstance(value, dict), f"invalid_source:{path.name}")
    return value


def _binding(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    return {
        "byte_count": len(raw),
        "path": path.relative_to(REPOSITORY).as_posix(),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def _validated_sources() -> dict[Path, dict[str, Any]]:
    artifacts = locks_builder.build_all()
    for path, payload in artifacts.items():
        _require(
            path.read_text(encoding="utf-8") == locks_builder.serialize(payload),
            f"stale_lock:{path.name}",
        )
    approval = approval_builder.build()
    _require(
        APPROVAL_PATH.read_text(encoding="utf-8")
        == approval_builder.serialize(approval),
        "stale_checkpoint2_approval",
    )
    boundary = approval.get("approval_boundary", {})
    scope = approval.get("approval", {}).get("scope", {})
    _require(
        boundary.get("exact_72_request_james_render_authorized") is True
        and boundary.get("exact_provider_credit_spend_authorized") is True
        and boundary.get("remaining_exact_scripts_user_approved") is True
        and scope.get("james_provider_request_count") == 72
        and scope.get("reserved_provider_credit_ceiling") == 138_190
        and scope.get("dollar_cap_usd") == "14.50"
        and scope.get("paid_overage_authorized") is False
        and scope.get("rerender_count") == 0,
        "checkpoint2_approval_scope_drift",
    )
    continuation = continuation_builder.build()
    _require(
        CONTINUATION_APPROVAL_PATH.read_text(encoding="utf-8")
        == continuation_builder.serialize(continuation),
        "stale_postpurchase_continuation_approval",
    )
    continuation_boundary = continuation.get("continuation_boundary", {})
    unchanged = continuation.get("unchanged_render_contract", {})
    _require(
        continuation_boundary.get("owner_purchase_and_continue_event_bound")
        is True
        and continuation_boundary.get("prior_checkpoint2_render_authority_preserved")
        is True
        and unchanged.get("provider_request_count") == 72
        and unchanged.get("reserved_provider_credit_ceiling") == 138_190
        and unchanged.get("renderer_character_cap") == 138_300
        and unchanged.get("combined_one_day_key_credit_quota") == 145_000
        and unchanged.get("dollar_cap_usd") == "14.50"
        and unchanged.get("rerender_authorized") is False
        and unchanged.get("paid_overage_authorized") is False
        and unchanged.get("cross_chapter_borrowing_allowed") is False,
        "postpurchase_continuation_approval_scope_drift",
    )
    return artifacts


def _validate_observation(value: Mapping[str, Any]) -> None:
    _require(value.get("schema_version") == 2, "observation_schema_drift")
    _require(value.get("product_id") == PRODUCT_ID, "observation_product_drift")
    _require(
        value.get("source")
        == "authenticated_browser_visible_ui_and_official_public_terms",
        "observation_source_drift",
    )
    observed_at = value.get("observed_at")
    _require(
        isinstance(observed_at, str) and observed_at.endswith("Z"),
        "observation_timestamp_invalid",
    )

    account = value.get("account", {})
    expected_account = {
        "authenticated_session": True,
        "creator_plan_active": True,
        "plan": "creator",
        "commercial_use_eligible_under_current_terms": True,
        "total_provider_credits": 186_000,
        "used_provider_credits": 14_510,
        "remaining_provider_credits": 171_490,
        "top_up_balance_usd": "10.00",
        "auto_top_up_enabled": False,
        "paid_usage_overage_authorized": False,
        "account_identity_recorded": False,
        "workspace_identity_recorded": False,
    }
    for key, expected in expected_account.items():
        _require(account.get(key) == expected, f"account_drift:{key}")
    _require(
        account["total_provider_credits"] - account["used_provider_credits"]
        == account["remaining_provider_credits"],
        "account_credit_arithmetic_drift",
    )
    _require(
        account.get("next_billing_date") == "2026-09-08"
        and account.get("next_billing_date_basis")
        == "visible_ui_display_renews_on_september_8_year_inferred_from_observation_date",
        "account_billing_date_drift",
    )

    purchase = value.get("prepaid_purchase", {})
    _require(
        purchase
        == {
            "account_credit_increment_since_v1": 55_000,
            "owner_reported_purchase_complete": True,
            "preexisting_purchase_observed_read_only": True,
            "top_up_balance_usd": "10.00",
            "usage_based_overage_or_auto_top_up": False,
        },
        "prepaid_purchase_evidence_drift",
    )
    _require(
        value.get("provider_usage_baseline")
        == {
            "billable_request_count": 14,
            "observed_at": "2026-08-11T05:13:04.553Z",
            "total_usage_usd": "2.64",
            "usage_surface": "signed_in_usage_analytics_ui",
        },
        "provider_usage_baseline_drift",
    )
    prior = _load(PRIOR_OBSERVATION_PATH)
    prior_account = prior.get("account", {})
    _require(
        account["remaining_provider_credits"]
        - prior_account.get("remaining_provider_credits", 0)
        == 55_000
        and account["total_provider_credits"]
        - prior_account.get("total_provider_credits", 0)
        == 55_000
        and account["used_provider_credits"]
        == prior_account.get("used_provider_credits"),
        "prepaid_credit_delta_drift",
    )

    voice = value.get("voice_and_request_contract", {})
    expected_voice = {
        "voice_id": VOICE_ID,
        "voice_name": VOICE_NAME,
        "default_model_id_visible": MODEL_ID,
        "default_output_format_id_visible": OUTPUT_FORMAT_ID,
        "exact_request_voice_settings": VOICE_SETTINGS,
        "available_in_voice_library": True,
        "voice_id_live_binding_present": True,
        "model_supports_text_to_speech": True,
        "request_voice_settings_override_available": True,
        "stored_account_voice_settings_relied_on": False,
        "production_request_contract_requires_non_beta": True,
        "beta_service_designation_observed": False,
        "beta_services_planned": False,
        "notice_period_days": 730,
    }
    for key, expected in expected_voice.items():
        _require(voice.get(key) == expected, f"voice_contract_drift:{key}")

    terms = value.get("terms", {})
    _require(terms.get("jurisdiction") == "non_eea", "jurisdiction_drift")
    _require(
        terms.get("jurisdiction_confirmation_source")
        == "project_owner_confirmation_in_active_task",
        "jurisdiction_confirmation_missing",
    )
    for key, expected in POLICY_TUPLE.items():
        _require(terms.get(key) == expected, f"policy_tuple_drift:{key}")
    _require(
        terms.get("terms_acceptance_or_account_change_performed") is False,
        "terms_mutation_forbidden",
    )

    key = value.get("key_capability", {})
    for field in (
        "create_multiple_keys_available",
        "one_day_expiry_available",
        "per_key_credit_limit_available",
        "restrict_key_available_and_default_on",
        "auto_disable_if_leaked_available_and_default_on",
        "restricted_key_dialog_cancelled_without_submission",
    ):
        _require(key.get(field) is True, f"key_capability_missing:{field}")
    _require(
        set(key.get("endpoint_permissions_visible", []))
        == {"text_to_speech_access", "voices_read", "user_access"},
        "key_permission_surface_drift",
    )

    effects = value.get("builder_effects")
    _require(
        effects
        == {
            "account_or_billing_changed_by_preflight": False,
            "api_keys_created": 0,
            "api_keys_deleted": 0,
            "database_accessed": False,
            "media_files_created": False,
            "provider_credits_spent_by_preflight": 0,
            "provider_tts_requests_sent": 0,
            "purchase_submitted_by_preflight": False,
        },
        "preflight_side_effect_drift",
    )


def build() -> dict[str, Any]:
    artifacts = _validated_sources()
    observation = _load(OBSERVATION_PATH)
    _validate_observation(observation)
    rows: list[dict[str, Any]] = []
    by_chapter = {
        artifacts[spec.destination]["chapter_id"]: (
            spec,
            artifacts[spec.destination],
        )
        for spec in locks_builder.CHAPTER_SPECS
    }
    for chapter_id in CHAPTER_ORDER:
        spec, lock = by_chapter[chapter_id]
        budget = lock["budget"]
        rows.append(
            {
                "chapter_id": chapter_id,
                "provider_request_count": lock["aggregate"]["provider_request_count"],
                "reserved_provider_credit_ceiling": budget[
                    "reserved_provider_credit_ceiling"
                ],
                "renderer_character_cap": budget["renderer_character_cap"],
                "one_day_key_credit_quota": budget[
                    "proposed_one_day_api_key_credit_quota"
                ],
                "dollar_cap_usd": budget["dollar_cap_usd"],
                "source_lock": _binding(spec.destination),
            }
        )
    reserved = sum(row["reserved_provider_credit_ceiling"] for row in rows)
    renderer_caps = sum(row["renderer_character_cap"] for row in rows)
    key_quotas = sum(row["one_day_key_credit_quota"] for row in rows)
    requests = sum(row["provider_request_count"] for row in rows)
    remaining = observation["account"]["remaining_provider_credits"]
    _require((requests, reserved, renderer_caps, key_quotas) == (72, 138_190, 138_300, 145_000), "batch_budget_drift")
    credit_gate = remaining >= reserved and remaining >= renderer_caps
    _require(credit_gate, "postpurchase_credit_gate_not_green")

    return {
        "schema_version": 2,
        "preflight_id": PREFLIGHT_ID,
        "product_id": PRODUCT_ID,
        "observed_at": observation["observed_at"],
        "status": "fresh_provider_preflight_green_renderer_code_audit_required",
        "decision": {
            "fresh_provider_preflight_go": True,
            "credit_gate_passed": True,
            "all_non_credit_gates_passed": True,
            "live_apply_go": False,
            "live_apply_blocker": "independent_renderer_code_audit_and_stable_operator_required",
        },
        "account_and_credit_gate": {
            "available_provider_credits": remaining,
            "total_provider_credits": observation["account"]["total_provider_credits"],
            "used_provider_credits": observation["account"]["used_provider_credits"],
            "prepaid_top_up_balance_usd": "10.00",
            "full_batch_reserved_provider_credit_ceiling": reserved,
            "full_batch_renderer_character_cap": renderer_caps,
            "full_batch_key_quota_ceiling": key_quotas,
            "headroom_above_reservations": remaining - reserved,
            "headroom_above_renderer_caps": remaining - renderer_caps,
            "headroom_above_key_quotas": remaining - key_quotas,
            "auto_top_up_enabled": False,
            "paid_usage_overage_authorized": False,
            "point_in_time_only": True,
        },
        "provider_usage_baseline": observation["provider_usage_baseline"],
        "chapter_envelopes": rows,
        "provider_contract_gate": {
            "voice_id": VOICE_ID,
            "voice_name": VOICE_NAME,
            "model_id": MODEL_ID,
            "output_format_id": OUTPUT_FORMAT_ID,
            "voice_settings": VOICE_SETTINGS,
            "explicit_request_body_settings_required": True,
            "stored_provider_defaults_relied_on": False,
            "beta_services_used_or_planned": False,
            "production_non_beta_contract_required": True,
        },
        "terms_gate": {
            "jurisdiction": "non_eea",
            "commercial_use_eligible": True,
            "policy_tuple": POLICY_TUPLE,
            "verified_live_at": observation["terms"]["verified_live_at"],
            "point_in_time_only": True,
        },
        "key_lifecycle_gate": {
            "key_count": 3,
            "keys_created": 0,
            "active_keys_at_once": 1,
            "keys_created_sequentially": True,
            "expiry_hours": 24,
            "scopes": [
                "text_to_speech_access",
                "voices_read",
                "user_access_for_subscription_and_credit_read_only",
            ],
            "per_chapter_credit_limits": [
                {
                    "chapter_id": row["chapter_id"],
                    "credit_limit": row["one_day_key_credit_quota"],
                }
                for row in rows
            ],
            "cross_chapter_borrowing_allowed": False,
            "auto_disable_if_leaked_required": True,
            "key_material_policy": (
                "one_time_ui_copy_to_os_clipboard_then_stdin_immediate_"
                "clipboard_clear_never_file_log_or_git"
            ),
        },
        "authorization": {
            "checkpoint2_owner_render_and_spend_authorized": True,
            "fresh_preflight_passed": True,
            "independent_renderer_code_audit_passed": False,
            "api_key_creation_authorized_now": False,
            "live_provider_apply_authorized_now": False,
            "provider_request_authorized_now": False,
            "tts_authorized_now": False,
            "paid_usage_overage_authorized": False,
            "rerender_authorized": False,
        },
        "required_before_live_apply": [
            "independent_renderer_security_and_correctness_audit_passes",
            "renderer_and_tests_are_hash_bound",
            "fresh_credit_terms_voice_and_key_recheck_no_older_than_15_minutes",
            "one_exact_chapter_key_is_created_and_other_chapter_keys_are_absent",
            "fresh_short_lived_execution_evidence_binds_chapter_key_and_external_output_root",
        ],
        "source_bindings": {
            "authenticated_observation": _binding(OBSERVATION_PATH),
            "prior_observation": _binding(PRIOR_OBSERVATION_PATH),
            "checkpoint2_owner_approval": _binding(APPROVAL_PATH),
            "postpurchase_render_continuation_approval": _binding(
                CONTINUATION_APPROVAL_PATH
            ),
            "remaining_batch_lock": _binding(locks_builder.BATCH_DESTINATION),
        },
        "builder_effects": {
            "account_or_billing_changed": False,
            "api_keys_created": 0,
            "database_accessed": False,
            "media_files_created": False,
            "network_accessed": False,
            "provider_credits_spent": 0,
            "provider_tts_requests_sent": 0,
        },
    }


def serialize(value: Mapping[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = serialize(build())
    if args.check:
        if not DESTINATION.is_file() or DESTINATION.read_text(encoding="utf-8") != rendered:
            raise SystemExit(f"stale postpurchase preflight: {DESTINATION.relative_to(REPOSITORY)}")
        print(f"verified {DESTINATION.relative_to(REPOSITORY)}")
        return 0
    DESTINATION.write_text(rendered, encoding="utf-8")
    print(f"wrote {DESTINATION.relative_to(REPOSITORY)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
