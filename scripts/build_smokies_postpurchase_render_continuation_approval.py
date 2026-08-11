#!/usr/bin/env python3
"""Build the immutable post-purchase render-continuation approval overlay.

This network-free builder binds the exact owner event that reports completion
of one finite $10 prepaid purchase and authorizes continuation of the already
approved 72-request James batch.  It grants no new overage, rerender, budget
transfer, account-change, upload, database, validation, or publication power.
Live key creation and provider dispatch remain closed until a separately bound
post-purchase provider preflight and an audited renderer both pass.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REPOSITORY = Path(__file__).resolve().parents[1]
ORIGINALS = REPOSITORY / "originals/smokies"
OUTPUT_PATH = ORIGINALS / "postpurchase_render_continuation_approval_v1.json"

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
OVERLAY_ID = "smokies_postpurchase_render_continuation_approval_20260811_v1"

SOURCE_TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"
SOURCE_RESPONSE_ITEM_ID = "msg_019fef39-a58c-7742-9fe1-4f87e5388b4d"
APPROVED_AT = "2026-08-11T05:09:20.397Z"
DECISION_TEXT = "i bought the $10. your approved to continue \n"
DECISION_BYTE_COUNT = 45
DECISION_SHA256 = "74920d6d369286f77f2c48f248cf75cff0dab657a4b8a969a0476d241945ff05"

SOURCE_COMMIT = "3a9e883eddcd5ae9ceef2297f2301f2ad87ea846"
SOURCE_TREE = "1e092b2d69c0d86e1985a2f7e858027a9e9366cc"
SOURCE_PARENT = "c6193547336b30105152843d8078b9407bc541d8"

SOURCE_PATHS = {
    "checkpoint2_approval": ORIGINALS / "checkpoint2_owner_approval_v1.json",
    "prior_provider_observation": (
        ORIGINALS / "elevenlabs_james_remaining_provider_observation_v1.json"
    ),
    "prior_provider_preflight": (
        ORIGINALS / "elevenlabs_james_remaining_provider_preflight_v1.json"
    ),
}
EXPECTED_SOURCES = {
    "checkpoint2_approval": {
        "byte_count": 68_453,
        "sha256": "3cc18dad4d1b6a80f2259e58cbe50fba3804096d0c00437eca9103e626078d5c",
    },
    "prior_provider_observation": {
        "byte_count": 4_431,
        "sha256": "dfae2340fa82cb1d92e70e4d0af1d74f3e9666a72465ccbb51ec362b2b6c2e21",
    },
    "prior_provider_preflight": {
        "byte_count": 10_768,
        "sha256": "d6deaffbd86cc7b17e241ade7a28a48f07063bbb55dba43907d016da02735eb8",
    },
}

CHAPTER_ENVELOPES = (
    {
        "chapter_id": "foothills_parkway",
        "provider_request_count": 16,
        "reserved_provider_credit_ceiling": 23_557,
        "renderer_character_cap": 23_600,
        "one_day_key_credit_quota": 25_000,
        "dollar_cap_usd": "2.50",
    },
    {
        "chapter_id": "mountain_crossing",
        "provider_request_count": 33,
        "reserved_provider_credit_ceiling": 65_938,
        "renderer_character_cap": 66_000,
        "one_day_key_credit_quota": 70_000,
        "dollar_cap_usd": "7.00",
    },
    {
        "chapter_id": "little_river_cades_cove",
        "provider_request_count": 23,
        "reserved_provider_credit_ceiling": 48_695,
        "renderer_character_cap": 48_700,
        "one_day_key_credit_quota": 50_000,
        "dollar_cap_usd": "5.00",
    },
)


class PostpurchaseApprovalError(ValueError):
    """The approved event or its exact frozen source evidence drifted."""


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise PostpurchaseApprovalError(f"unavailable source: {path.name}") from error
    return digest.hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PostpurchaseApprovalError(
            f"unavailable JSON source: {path.name}"
        ) from error
    if not isinstance(value, dict):
        raise PostpurchaseApprovalError(f"expected JSON object: {path.name}")
    return value


def _binding(name: str, path: Path) -> dict[str, Any]:
    expected = EXPECTED_SOURCES[name]
    actual_hash = _sha256_path(path)
    try:
        actual_bytes = path.stat().st_size
    except OSError as error:
        raise PostpurchaseApprovalError(f"unavailable source: {path.name}") from error
    if actual_hash != expected["sha256"] or actual_bytes != expected["byte_count"]:
        raise PostpurchaseApprovalError(f"source binding drifted: {name}")
    try:
        display_path = path.relative_to(REPOSITORY).as_posix()
    except ValueError as error:
        raise PostpurchaseApprovalError("source escaped repository") from error
    return {
        "path": display_path,
        "byte_count": actual_bytes,
        "sha256": actual_hash,
    }


def _assert_checkpoint2(document: dict[str, Any]) -> None:
    approval = document.get("approval", {})
    scope = approval.get("scope", {})
    expected_scope = {
        "remaining_exact_script_count": 51,
        "mountain_direction_override_count": 5,
        "new_exact_original_artwork_count": 4,
        "sanitation_original_count": 6,
        "james_provider_request_count": 72,
        "reserved_provider_credit_ceiling": 138_190,
        "dollar_cap_usd": "14.50",
        "rerender_count": 0,
        "paid_overage_authorized": False,
        "cross_chapter_borrowing_allowed": False,
    }
    if scope != expected_scope:
        raise PostpurchaseApprovalError("Checkpoint 2 approval scope drifted")
    boundary = document.get("approval_boundary", {})
    required_true = (
        "exact_72_request_james_render_authorized",
        "exact_provider_credit_spend_authorized",
        "restricted_one_day_key_creation_authorized",
    )
    if any(boundary.get(field) is not True for field in required_true):
        raise PostpurchaseApprovalError("prior render authority drifted")
    expected_zero_or_false = {
        "restricted_one_day_keys_created": 0,
        "provider_requests_sent": 0,
        "provider_credits_spent": 0,
        "narration_generated": False,
        "ingestion_allowed": False,
        "upload_allowed": False,
        "database_accessed": False,
        "production_mutation_allowed": False,
        "trusted_validation_allowed": False,
        "publication_allowed": False,
        "public_release": False,
    }
    if any(boundary.get(field) != value for field, value in expected_zero_or_false.items()):
        raise PostpurchaseApprovalError("Checkpoint 2 downstream gate drifted")


def _assert_prior_no_go(document: dict[str, Any]) -> None:
    if document.get("status") != "blocked_insufficient_credits_no_keys_or_tts":
        raise PostpurchaseApprovalError("prior provider stop status drifted")
    credit = document.get("account_and_credit_gate", {})
    expected = {
        "total_provider_credits": 131_000,
        "used_provider_credits": 14_510,
        "available_provider_credits": 116_490,
        "top_up_balance_usd": "0.00",
        "full_batch_reserved_provider_credit_ceiling": 138_190,
        "full_batch_renderer_character_cap": 138_300,
        "full_batch_key_quota_ceiling": 145_000,
        "provider_credit_shortfall_against_reservations": 21_700,
        "provider_credit_shortfall_against_renderer_caps": 21_810,
        "key_quota_shortfall": 28_510,
        "paid_overage_authorized": False,
        "reservation_gate_passed": False,
        "renderer_cap_gate_passed": False,
    }
    if any(credit.get(field) != value for field, value in expected.items()):
        raise PostpurchaseApprovalError("prior credit stop evidence drifted")
    lifecycle = document.get("one_time_prepaid_purchase_capability", {})
    if lifecycle.get("automatic_top_up_enabled") is not False:
        raise PostpurchaseApprovalError("prior automatic top-up state drifted")
    if lifecycle.get("purchase_submitted") is not False:
        raise PostpurchaseApprovalError("prior observation unexpectedly made a purchase")
    authorization = document.get("authorization", {})
    if any(value is not False for value in authorization.values()):
        raise PostpurchaseApprovalError("prior NO-GO authorization escaped closed")


def _assert_prior_observation(document: dict[str, Any]) -> None:
    serialized = json.dumps(document, sort_keys=True, separators=(",", ":"))
    required_fragments = (
        '"auto_top_up_enabled":false',
        '"remaining_provider_credits":116490',
        '"top_up_balance_usd":"0.00"',
        '"purchase_submitted":false',
    )
    if any(fragment not in serialized for fragment in required_fragments):
        raise PostpurchaseApprovalError("prior provider observation drifted")


def build() -> dict[str, Any]:
    event_bytes = DECISION_TEXT.encode("utf-8")
    if len(event_bytes) != DECISION_BYTE_COUNT:
        raise PostpurchaseApprovalError("owner event byte count drifted")
    if hashlib.sha256(event_bytes).hexdigest() != DECISION_SHA256:
        raise PostpurchaseApprovalError("owner event hash drifted")
    if not DECISION_TEXT.endswith(" \n") or DECISION_TEXT.endswith("\r\n"):
        raise PostpurchaseApprovalError("owner event trailing bytes drifted")

    bindings = {name: _binding(name, path) for name, path in SOURCE_PATHS.items()}
    sources = {name: _load_json(path) for name, path in SOURCE_PATHS.items()}
    _assert_checkpoint2(sources["checkpoint2_approval"])
    _assert_prior_observation(sources["prior_provider_observation"])
    _assert_prior_no_go(sources["prior_provider_preflight"])

    return {
        "schema_version": 1,
        "overlay_id": OVERLAY_ID,
        "kind": "smokies_postpurchase_render_continuation_approval_overlay",
        "product_id": PRODUCT_ID,
        "recorded_at": APPROVED_AT,
        "status": (
            "finite_prepaid_purchase_completed_and_prior_render_continuation_"
            "authorized_live_effects_still_closed"
        ),
        "owner_event": {
            "approved_at": APPROVED_AT,
            "approved_at_source": "source_task_user_message_event_metadata",
            "approved_by": "project_owner",
            "source_task_id": SOURCE_TASK_ID,
            "source_response_item_id": SOURCE_RESPONSE_ITEM_ID,
            "corroborated_event_types": [
                "response_item.message",
                "event_msg.user_message",
            ],
            "decision_text_verbatim": DECISION_TEXT,
            "decision_message_hash_input": "exact_utf8_bytes_with_space_then_one_lf",
            "decision_message_byte_count": DECISION_BYTE_COUNT,
            "decision_message_sha256": DECISION_SHA256,
            "ephemeral_event_actor_identifier_retained": False,
        },
        "source_revision": {
            "commit": SOURCE_COMMIT,
            "tree": SOURCE_TREE,
            "parent": SOURCE_PARENT,
            "all_bound_sources_verified_at_commit": True,
        },
        "source_bindings": bindings,
        "purchase_and_continuation": {
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
        },
        "unchanged_render_contract": {
            "provider_request_count": 72,
            "base_request_count": 64,
            "direction_override_request_count": 8,
            "reserved_provider_credit_ceiling": 138_190,
            "renderer_character_cap": 138_300,
            "combined_one_day_key_credit_quota": 145_000,
            "dollar_cap_usd": "14.50",
            "automatic_rerender_count": 0,
            "rerender_authorized": False,
            "paid_overage_authorized": False,
            "automatic_top_up_authorized": False,
            "cross_chapter_borrowing_allowed": False,
            "unused_budget_transfer_allowed": False,
            "chapter_envelopes": list(CHAPTER_ENVELOPES),
            "safe_retry_only": "provider_confirmed_uncharged_429",
            "ambiguous_timeout_5xx_invalid_audio_or_billing_behavior": (
                "stop_and_reconcile_without_retry"
            ),
        },
        "continuation_boundary": {
            "owner_purchase_and_continue_event_bound": True,
            "prior_checkpoint2_render_authority_preserved": True,
            "postpurchase_provider_observation_bound": False,
            "postpurchase_credit_capacity_preflight_passed": False,
            "renderer_implementation_audited": False,
            "restricted_one_day_keys_created": 0,
            "live_api_key_creation_allowed": False,
            "live_provider_requests_allowed": False,
            "live_provider_credit_spend_allowed": False,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
            "narration_generated": False,
            "upload_allowed": False,
            "database_accessed": False,
            "production_mutation_allowed": False,
            "trusted_validation_allowed": False,
            "publication_allowed": False,
            "public_release": False,
            "next_action": (
                "bind_fresh_redacted_postpurchase_provider_observation_and_"
                "pass_independent_renderer_audit_before_any_live_effect"
            ),
        },
        "builder_effects": {
            "network_accessed": False,
            "provider_accessed": False,
            "api_keys_created": 0,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
            "purchases_submitted": 0,
            "media_files_created": 0,
            "database_accessed": False,
            "production_mutated": False,
        },
    }


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    rendered = serialize(build())
    if args.check:
        if not args.output.is_file() or args.output.read_text(
            encoding="utf-8"
        ) != rendered:
            raise SystemExit(
                "Post-purchase render-continuation approval is stale; rebuild it"
            )
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
