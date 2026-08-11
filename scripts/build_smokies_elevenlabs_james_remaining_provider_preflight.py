#!/usr/bin/env python3
"""Build the redacted authenticated preflight for 72 locked James requests.

This operator consumes an identity-free browser observation and the four
deterministic network-free lock artifacts. It validates the live facts,
recalculates independent chapter envelopes, and fails closed. It cannot
contact ElevenLabs, create keys, render audio, spend credits, or touch a DB.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping


REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from scripts import build_smokies_elevenlabs_james_remaining_locks as locks_builder


ORIGINALS = REPOSITORY / "originals/smokies"
OBSERVATION_PATH = (
    ORIGINALS / "elevenlabs_james_remaining_provider_observation_v1.json"
)
DESTINATION = ORIGINALS / "elevenlabs_james_remaining_provider_preflight_v1.json"

SCHEMA_VERSION = 1
PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
PREFLIGHT_ID = (
    "great_smoky_mountains_elevenlabs_james_remaining_provider_preflight_v1"
)
EXPECTED_PLAN = "creator"
EXPECTED_VOICE_ID = "EkK5I93UQWFDigLMpZcX"
EXPECTED_VOICE_NAME = "James - Husky, Engaging and Bold"
EXPECTED_MODEL_ID = "eleven_multilingual_v2"
EXPECTED_OUTPUT_FORMAT = "mp3_44100_128"
EXPECTED_VOICE_SETTINGS = {
    "similarity_boost": 0.5,
    "speed": 1.0,
    "stability": 0.5,
    "style": 0.1,
    "use_speaker_boost": True,
}
EXPECTED_PRIMARY_TERMS = {
    "last_updated": "2026-03-31",
    "terms_id": "elevenlabs_terms_of_service_non_eea_2026-03-31",
    "title": "ElevenLabs Terms of Service (non-EEA)",
    "url": "https://elevenlabs.io/terms-of-use",
}
EXPECTED_VOICE_LIBRARY_ADDENDUM = {
    "last_updated": "2026-03-06",
    "terms_id": "elevenlabs_voice_library_addendum_2026-03-06",
    "title": "ElevenLabs Voice Library Addendum",
    "url": "https://elevenlabs.io/vla",
}
EXPECTED_PROHIBITED_USE_POLICY = {
    "last_updated": "2025-09-03",
    "terms_id": "elevenlabs_prohibited_use_policy_2025-09-03",
    "title": "ElevenLabs Prohibited Use Policy",
    "url": "https://elevenlabs.io/use-policy",
}
EXPECTED_BETA_SERVICES_ADDENDUM = {
    "last_updated": "2024-11-13",
    "terms_id": "elevenlabs_beta_services_addendum_2024-11-13",
    "title": "Beta Services Addendum",
    "url": "https://elevenlabs.io/bsa",
}
EXPECTED_VISIBLE_KEY_PERMISSIONS = {
    "text_to_speech_access",
    "voices_read",
    "user_access",
}
EXPECTED_CHAPTER_ORDER = (
    "foothills_parkway",
    "mountain_crossing",
    "little_river_cades_cove",
)


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path.name}")
    return value


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _relative(path: Path) -> str:
    return path.relative_to(REPOSITORY).as_posix()


def _binding(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    return {
        "byte_count": len(raw),
        "path": _relative(path),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def _validated_frozen_artifacts() -> dict[Path, dict[str, Any]]:
    """Rebuild and byte-verify every lock before trusting its budget."""
    artifacts = locks_builder.build_all()
    expected_paths = {
        *(spec.destination for spec in locks_builder.CHAPTER_SPECS),
        locks_builder.BATCH_DESTINATION,
    }
    _require(set(artifacts) == expected_paths, "Frozen lock inventory drifted")
    for path, payload in artifacts.items():
        expected_text = locks_builder.serialize(payload)
        _require(path.is_file(), f"Missing frozen artifact: {_relative(path)}")
        _require(
            path.read_text(encoding="utf-8") == expected_text,
            f"Frozen artifact is stale or non-deterministic: {_relative(path)}",
        )
    return artifacts


def _validate_observation(observation: Mapping[str, Any]) -> None:
    _require(observation.get("schema_version") == 1, "Observation schema drifted")
    _require(observation.get("product_id") == PRODUCT_ID, "Observation product drifted")
    observed_at = observation.get("observed_at")
    _require(
        isinstance(observed_at, str) and observed_at.endswith("Z") and "T" in observed_at,
        "Observation time must be an exact UTC instant",
    )
    _require(
        observation.get("source")
        == "authenticated_browser_visible_ui_and_official_public_terms",
        "Observation source is not the approved redacted live surface",
    )

    account = observation.get("account")
    _require(isinstance(account, Mapping), "Missing observed account facts")
    _require(account.get("authenticated_session") is True, "Session was not authenticated")
    _require(account.get("creator_plan_active") is True, "Creator plan is not active")
    _require(account.get("plan") == EXPECTED_PLAN, "Paid plan identity drifted")
    _require(
        account.get("commercial_use_eligible_under_current_terms") is True,
        "Commercial-use eligibility was not confirmed",
    )
    _require(account.get("account_identity_recorded") is False, "Account identity leaked")
    _require(account.get("workspace_identity_recorded") is False, "Workspace identity leaked")
    for field in (
        "total_provider_credits",
        "used_provider_credits",
        "remaining_provider_credits",
    ):
        _require(
            isinstance(account.get(field), int) and account[field] >= 0,
            f"Invalid {field}",
        )
    _require(
        account["total_provider_credits"] - account["used_provider_credits"]
        == account["remaining_provider_credits"],
        "Provider credit arithmetic does not reconcile",
    )
    _require(account.get("auto_top_up_enabled") is False, "Auto Top Up must remain off")
    _require(account.get("top_up_balance_usd") == "0.00", "Top-up balance drifted")
    _require(
        account.get("paid_overage_authorized") is False,
        "Paid overage must remain unauthorized",
    )
    _require(
        account.get("next_billing_date") == "2026-09-08",
        "Visible next billing date drifted",
    )
    _require(
        account.get("next_billing_date_basis")
        == "visible_ui_display_renews_on_september_8_year_inferred_from_observation_date",
        "Billing-date evidence basis drifted",
    )

    pricing = observation.get("pricing")
    _require(isinstance(pricing, Mapping), "Missing pricing observation")
    _require(
        pricing.get("price_usd_per_1000_characters") == "0.10",
        "Observed model pricing drifted",
    )
    _require(
        pricing.get("character_limit_per_request") == 40_000,
        "Observed provider request limit drifted",
    )

    purchase = observation.get("purchase_capability")
    _require(isinstance(purchase, Mapping), "Missing prepaid purchase capability")
    _require(
        purchase.get("one_time_prepaid_credit_purchase_available") is True,
        "One-time prepaid purchase capability was not observed",
    )
    _require(
        purchase.get("purchase_dialog_inspected_without_submission") is True,
        "Prepaid purchase dialog evidence is incomplete",
    )
    _require(purchase.get("automatic_top_up_enabled") is False, "Auto Top Up drifted")
    _require(
        purchase.get("visible_exchange_rate_credits") == 10_000
        and purchase.get("visible_exchange_rate_usd") == "1.82",
        "Visible one-time prepaid exchange-rate evidence drifted",
    )

    terms = observation.get("terms")
    _require(isinstance(terms, Mapping), "Missing terms observation")
    _require(terms.get("jurisdiction") == "non_eea", "Terms jurisdiction drifted")
    _require(
        terms.get("jurisdiction_confirmation_source")
        == "project_owner_confirmation_in_active_task",
        "Non-EEA owner confirmation is missing",
    )
    _require(
        terms.get("commercial_use_rule")
        == "paid_user_commercial_use_permitted_subject_to_terms_and_policies",
        "Commercial-use terms rule drifted",
    )
    expected_policy_tuples = {
        "primary_terms": EXPECTED_PRIMARY_TERMS,
        "voice_library_addendum": EXPECTED_VOICE_LIBRARY_ADDENDUM,
        "prohibited_use_policy": EXPECTED_PROHIBITED_USE_POLICY,
        "beta_services_addendum": EXPECTED_BETA_SERVICES_ADDENDUM,
    }
    for field, expected in expected_policy_tuples.items():
        _require(terms.get(field) == expected, f"Current policy tuple drifted: {field}")
    _require(
        terms.get("terms_acceptance_or_account_change_performed") is False,
        "Terms/account mutation was not allowed during preflight",
    )

    voice = observation.get("voice_and_request_contract")
    _require(isinstance(voice, Mapping), "Missing live James contract")
    exact_voice_facts = {
        "voice_id": EXPECTED_VOICE_ID,
        "voice_name": EXPECTED_VOICE_NAME,
        "default_model_id_visible": EXPECTED_MODEL_ID,
        "default_output_format_id_visible": EXPECTED_OUTPUT_FORMAT,
        "exact_request_voice_settings": EXPECTED_VOICE_SETTINGS,
    }
    for field, expected in exact_voice_facts.items():
        _require(voice.get(field) == expected, f"Live James contract drifted: {field}")
    for field in (
        "available_in_my_voices",
        "voice_id_live_binding_present",
        "fine_tuned_multilingual_v2_available",
        "model_supports_text_to_speech",
        "request_voice_settings_override_available",
        "production_request_contract_requires_non_beta",
    ):
        _require(voice.get(field) is True, f"Live James capability missing: {field}")
    _require(
        voice.get("stored_account_voice_settings_relied_on") is False,
        "Stored provider defaults must not control a locked request",
    )
    _require(voice.get("notice_period_days") == 730, "James notice period drifted")
    _require(
        voice.get("beta_service_designation_observed") is False
        and voice.get("beta_services_planned") is False,
        "Production narration must not use a Beta Service",
    )

    key = observation.get("key_capability")
    _require(isinstance(key, Mapping), "Missing restricted-key capability")
    for field in (
        "create_multiple_keys_available",
        "one_day_expiry_available",
        "per_key_credit_limit_available",
        "restrict_key_available_and_default_on",
        "auto_disable_if_leaked_available_and_default_on",
        "restricted_key_dialog_inspected_without_submission",
    ):
        _require(key.get(field) is True, f"Restricted-key capability missing: {field}")
    _require(
        set(key.get("endpoint_permissions_visible", ()))
        == EXPECTED_VISIBLE_KEY_PERMISSIONS,
        "Restricted-key permission inventory drifted",
    )

    effects = observation.get("builder_effects")
    expected_effects = {
        "account_or_billing_changed": False,
        "api_keys_created": 0,
        "api_keys_deleted": 0,
        "database_accessed": False,
        "media_files_created": False,
        "provider_credits_spent": 0,
        "provider_tts_requests_sent": 0,
        "purchase_submitted": False,
    }
    _require(effects == expected_effects, "Authenticated preflight had a forbidden side effect")


def _chapter_envelopes(
    artifacts: Mapping[Path, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    by_chapter: dict[str, Mapping[str, Any]] = {}
    path_by_chapter: dict[str, Path] = {}
    for spec in locks_builder.CHAPTER_SPECS:
        payload = artifacts[spec.destination]
        _require(payload.get("chapter_id") == spec.chapter_id, "Chapter lock identity drifted")
        by_chapter[spec.chapter_id] = payload
        path_by_chapter[spec.chapter_id] = spec.destination

    rows: list[dict[str, Any]] = []
    for chapter_id in EXPECTED_CHAPTER_ORDER:
        lock = by_chapter[chapter_id]
        budget = lock["budget"]
        aggregate = lock["aggregate"]
        authorization = lock["authorization"]
        _require(budget.get("cross_chapter_borrowing_allowed") is False, "Cross-borrowing drifted")
        _require(budget.get("unused_budget_transfer_allowed") is False, "Budget transfer drifted")
        _require(budget.get("rerender_budget") == 0, "Rerender budget drifted")
        _require(budget.get("paid_overage_authorized") is False, "Lock overage policy drifted")
        _require(authorization.get("provider_request_authorized") is False, "Lock dispatch opened")
        _require(
            authorization.get("provider_credit_spend_authorized") is False,
            "Lock spend opened",
        )
        rows.append(
            {
                "chapter_id": chapter_id,
                "dollar_cap_usd": budget["dollar_cap_usd"],
                "provider_request_count": aggregate["provider_request_count"],
                "proposed_one_day_key_credit_quota": budget[
                    "proposed_one_day_api_key_credit_quota"
                ],
                "renderer_character_cap": budget["renderer_character_cap"],
                "reserved_provider_credit_ceiling": budget[
                    "reserved_provider_credit_ceiling"
                ],
                "source_lock": _binding(path_by_chapter[chapter_id]),
            }
        )
    return rows


def _assess(
    observation: Mapping[str, Any],
    artifacts: Mapping[Path, Mapping[str, Any]],
) -> dict[str, Any]:
    """Validate a redacted point-in-time observation and return the decision."""
    _validate_observation(observation)
    chapters = _chapter_envelopes(artifacts)
    batch = artifacts[locks_builder.BATCH_DESTINATION]
    _require(
        batch.get("scope", {}).get("new_provider_request_count") == 72,
        "Frozen batch is not the exact 72-request set",
    )
    _require(
        batch.get("status")
        == "network_free_review_ready_authenticated_preflight_not_run",
        "Frozen batch status drifted",
    )
    _require(
        all(value is False for value in batch.get("authorization", {}).values()),
        "A downstream frozen-batch authorization is unexpectedly open",
    )

    reserved = sum(row["reserved_provider_credit_ceiling"] for row in chapters)
    renderer_caps = sum(row["renderer_character_cap"] for row in chapters)
    key_quotas = sum(row["proposed_one_day_key_credit_quota"] for row in chapters)
    requests = sum(row["provider_request_count"] for row in chapters)
    remaining = observation["account"]["remaining_provider_credits"]
    reserved_shortfall = max(0, reserved - remaining)
    renderer_shortfall = max(0, renderer_caps - remaining)
    key_quota_shortfall = max(0, key_quotas - remaining)
    credit_gate_passed = remaining >= reserved and remaining >= renderer_caps

    for row in chapters:
        row["current_account_can_cover_this_chapter_alone"] = (
            remaining >= row["renderer_character_cap"]
        )
        row["cross_chapter_borrowing_allowed"] = False
        row["key_creation_authorized"] = False
        row["render_authorized"] = False
        row["spend_authorized"] = False

    non_credit_gates = {
        "authenticated_creator_commercial_gate": True,
        "current_supporting_policy_tuple_gate": True,
        "exact_james_voice_available_gate": True,
        "exact_model_output_and_explicit_settings_gate": True,
        "frozen_72_request_source_gate": True,
        "no_beta_services_gate": True,
        "no_paid_overage_policy_gate": True,
        "three_restricted_one_day_keys_capability_gate": True,
    }
    overall_go = all(non_credit_gates.values()) and credit_gate_passed
    status = (
        "go_requires_separate_owner_render_and_spend_authorization"
        if overall_go
        else "blocked_insufficient_credits_no_keys_or_tts"
    )

    lock_bindings = [
        _binding(spec.destination) for spec in locks_builder.CHAPTER_SPECS
    ] + [_binding(locks_builder.BATCH_DESTINATION)]
    account = observation["account"]
    purchase = observation["purchase_capability"]
    voice = observation["voice_and_request_contract"]
    terms = observation["terms"]

    return {
        "schema_version": SCHEMA_VERSION,
        "preflight_id": PREFLIGHT_ID,
        "product_id": PRODUCT_ID,
        "observed_at": observation["observed_at"],
        "status": status,
        "decision": {
            "credit_gate_passed": credit_gate_passed,
            "non_credit_gates": non_credit_gates,
            "non_credit_gates_passed": all(non_credit_gates.values()),
            "overall_go": overall_go,
            "reason": (
                "all_non_credit_gates_passed_but_current_credits_do_not_cover_"
                "the_full_independent_batch_envelopes"
                if not credit_gate_passed
                else "all_live_preflight_gates_passed_but_dispatch_remains_unapproved"
            ),
        },
        "account_and_credit_gate": {
            "account_identity_recorded": False,
            "available_provider_credits": remaining,
            "credit_snapshot_point_in_time_only": True,
            "full_batch_key_quota_ceiling": key_quotas,
            "full_batch_renderer_character_cap": renderer_caps,
            "full_batch_reserved_provider_credit_ceiling": reserved,
            "key_quota_shortfall": key_quota_shortfall,
            "minimum_additional_credits_before_renderer_cap_repreflight": renderer_shortfall,
            "next_billing_date": account["next_billing_date"],
            "next_billing_date_year_inferred_from_observation_date": True,
            "paid_overage_authorized": False,
            "provider_credit_shortfall_against_renderer_caps": renderer_shortfall,
            "provider_credit_shortfall_against_reservations": reserved_shortfall,
            "renderer_cap_gate_passed": remaining >= renderer_caps,
            "reservation_gate_passed": remaining >= reserved,
            "top_up_balance_usd": account["top_up_balance_usd"],
            "total_provider_credits": account["total_provider_credits"],
            "used_provider_credits": account["used_provider_credits"],
        },
        "chapter_envelopes": chapters,
        "provider_contract_gate": {
            "beta_services_used_or_planned": False,
            "explicit_request_body_settings_required": True,
            "model_id": voice["default_model_id_visible"],
            "output_format_id": voice["default_output_format_id_visible"],
            "production_non_beta_contract_required": True,
            "provider_request_count": requests,
            "stored_provider_defaults_relied_on": False,
            "voice_id": voice["voice_id"],
            "voice_name": voice["voice_name"],
            "voice_notice_period_days": voice["notice_period_days"],
            "voice_settings": deepcopy(voice["exact_request_voice_settings"]),
        },
        "terms_gate": {
            "beta_services_addendum": deepcopy(terms["beta_services_addendum"]),
            "beta_services_addendum_applicable_to_planned_request": False,
            "commercial_use_rule": terms["commercial_use_rule"],
            "jurisdiction": terms["jurisdiction"],
            "primary_terms": deepcopy(terms["primary_terms"]),
            "prohibited_use_policy": deepcopy(terms["prohibited_use_policy"]),
            "supporting_policy_tuple_matches_review": True,
            "terms_point_in_time_only": True,
            "verified_live_at": terms["verified_live_at"],
            "voice_library_addendum": deepcopy(terms["voice_library_addendum"]),
        },
        "restricted_key_capability_gate": {
            "auto_disable_if_leaked_default_on": True,
            "capability_confirmed_without_key_creation": True,
            "create_multiple_keys_available": True,
            "one_day_expiry_available": True,
            "per_key_credit_limit_available": True,
            "restrict_key_default_on": True,
            "visible_permissions": sorted(EXPECTED_VISIBLE_KEY_PERMISSIONS),
        },
        "proposed_key_and_ledger_lifecycle": {
            "active_keys_at_once": 1,
            "chapter_execution_order": list(EXPECTED_CHAPTER_ORDER),
            "create_only_after": [
                "fresh_credit_and_terms_repreflight_passes",
                "separate_exact_owner_render_and_spend_authorization",
                "empty_or_fully_reconciled_chapter_ledger_is_verified",
            ],
            "cross_chapter_borrowing_allowed": False,
            "key_count": 3,
            "key_expiry_hours": 24,
            "key_material_storage": (
                "process_memory_or_ephemeral_environment_only_"
                "never_disk_log_git_or_clipboard"
            ),
            "key_permissions": [
                "text_to_speech_access",
                "voices_read",
                "user_access_for_subscription_and_credit_read_only",
            ],
            "keys_created_sequentially_not_simultaneously": True,
            "ledger_contract": {
                "accepted_bytes_never_regenerated": True,
                "ambiguous_response_behavior": (
                    "retain_reservation_stop_and_reconcile_without_retry"
                ),
                "append_only_per_request_evidence": True,
                "independent_ledger_per_chapter": True,
                "rerender_budget": 0,
                "safe_retry_only": "provider_confirmed_uncharged_429",
                "status": "not_initialized_credit_gate_blocked",
            },
            "per_chapter_key_quotas": [
                {
                    "chapter_id": row["chapter_id"],
                    "credit_limit": row["proposed_one_day_key_credit_quota"],
                }
                for row in chapters
            ],
            "post_chapter_sequence": [
                "reconcile_provider_usage_and_request_ledger",
                "delete_chapter_key",
                "clear_ephemeral_key_material",
                "verify_key_deletion_before_next_chapter",
            ],
        },
        "one_time_prepaid_purchase_capability": {
            "automatic_top_up_enabled": False,
            "capability_only_not_authorization": True,
            "one_time_purchase_available": purchase[
                "one_time_prepaid_credit_purchase_available"
            ],
            "purchase_submitted": False,
            "quick_purchase_amounts_usd": deepcopy(
                purchase["quick_purchase_amounts_usd"]
            ),
            "visible_exchange_rate": {
                "credits": purchase["visible_exchange_rate_credits"],
                "usd": purchase["visible_exchange_rate_usd"],
            },
        },
        "authorization": {
            "api_key_creation_authorized": False,
            "chapter_render_authorized": False,
            "one_time_prepaid_purchase_authorized": False,
            "partial_batch_render_authorized": False,
            "paid_overage_authorized": False,
            "provider_credit_spend_authorized": False,
            "provider_request_authorized": False,
            "rerender_authorized": False,
            "terms_acceptance_or_account_change_authorized": False,
        },
        "next_owner_decision": {
            "allowed_paths": [
                "wait_for_visible_renewal_or_credit_reset_then_run_a_fresh_read_only_preflight",
                "separately_authorize_a_one_time_prepaid_purchase_then_run_a_fresh_"
                "read_only_preflight",
            ],
            "current_batch_must_not_start": not overall_go,
            "partial_render_is_not_an_authorized_workaround": True,
            "purchase_amount_selected": False,
        },
        "source_bindings": {
            "frozen_lock_artifacts": lock_bindings,
            "redacted_authenticated_observation": _binding(OBSERVATION_PATH),
        },
        "builder_effects": {
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
        },
    }


def build() -> dict[str, Any]:
    artifacts = _validated_frozen_artifacts()
    observation = _load_json(OBSERVATION_PATH)
    return _assess(observation, artifacts)


def serialize(payload: Mapping[str, Any]) -> str:
    return json.dumps(
        payload,
        indent=2,
        sort_keys=True,
        ensure_ascii=False,
    ) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = serialize(build())
    if args.check:
        if not DESTINATION.is_file() or DESTINATION.read_text(encoding="utf-8") != rendered:
            raise SystemExit(f"stale provider preflight: {_relative(DESTINATION)}")
        print(f"verified {_relative(DESTINATION)}")
        return
    DESTINATION.write_text(rendered, encoding="utf-8")
    print(f"wrote {_relative(DESTINATION)}")


if __name__ == "__main__":
    main()
