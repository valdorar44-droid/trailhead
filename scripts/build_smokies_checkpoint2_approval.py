#!/usr/bin/env python3
"""Build the immutable Checkpoint 2 owner-approval overlay.

The overlay binds the exact Checkpoint 1 review snapshot and the exact owner
message that approves all 51 remaining scripts, five Mountain direction
overrides, four original artwork candidates, the six-image sanitation job,
and the guarded 72-request James render envelopes.  This builder is network-
and database-free.  It creates no derivative or narration bytes and cannot
upload, ingest, deploy, validate, or publish anything.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REPOSITORY = Path(__file__).resolve().parents[1]
ORIGINALS = REPOSITORY / "originals/smokies"
OUTPUT_PATH = ORIGINALS / "checkpoint2_owner_approval_v1.json"

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
OVERLAY_ID = "smokies_checkpoint2_owner_approval_20260810_v1"
SOURCE_TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"
APPROVED_AT = "2026-08-11T04:27:57.463Z"
DECISION_TEXT = (
    "Approve all Checkpoint 1 items; authorize the six-image sanitation job "
    "and 72 James renders, capped at 138,190 reserved credits and $14.50, "
    "with zero rerenders and no paid overage.\n"
)
DECISION_BYTE_COUNT = 181
DECISION_SHA256 = "f6a3e3bc71b2b76b5cf791f8fdf11c7084c9e02ce81e05f2d388e17f44569af3"

CHECKPOINT1_COMMIT = "c6193547336b30105152843d8078b9407bc541d8"
CHECKPOINT1_TREE = "2749d30dfd1951f75b20296eb059c36fb30a7a24"
CHECKPOINT1_PARENT = "6cb0d4f480260e1789add4474054abd80be8c62c"

SOURCE_PATHS = {
    "review_packet": ORIGINALS / "remaining_chapters_review_packet_v1.json",
    "review_sheet": (
        REPOSITORY / "docs/originals/mountain-crossing-cades-cove-review-sheet-v1.md"
    ),
    "foothills_approval": ORIGINALS / "foothills_parkway_approval_v1.json",
    "james_foothills_lock": (
        ORIGINALS / "elevenlabs_james_foothills_parkway_lock_v1.json"
    ),
    "james_mountain_lock": (
        ORIGINALS / "elevenlabs_james_mountain_crossing_lock_v1.json"
    ),
    "james_cades_lock": ORIGINALS / "elevenlabs_james_cades_cove_lock_v1.json",
    "james_batch_preflight": (
        ORIGINALS / "elevenlabs_james_remaining_batch_preflight_v1.json"
    ),
}

EXPECTED_SOURCE_SHA256 = {
    "review_packet": "3ef71377c9e347cd53335cbf487d039ff973b8c28f9628b622fcee74c714b015",
    "review_sheet": "bb7665770d0f651be4b6b961f6a1a8de2f9b94b1c6edf18a457c2fafd02752ce",
    "foothills_approval": "a301c702155512c66df60e819274271fc9a6001b398266be5d9a6329a82592bb",
    "james_foothills_lock": "eac2d636c4c26fd55fbc4ebe7b7be25882ffd51e6064703924d96d89fa71c119",
    "james_mountain_lock": "561a8a8bf62f534d485df0ebf523d13a9defd962af136240fd46e1ca5aacec25",
    "james_cades_lock": "6c6fecdaa85d91f4e29cd08ea9c46f20d404dba8ed72962390b8d8d8dc5b6a04",
    "james_batch_preflight": "e396aff7b495f087838cfb284a5d9e6a7ac43c9b873550e2a71a5527a41379b4",
}

EXPECTED_SOURCE_SET_SHA256 = {
    "scripts": "2744e75a4b72142117bfb950a3b304101514e5eeb5812ab55a745aa14d06f924",
    "artwork": "9433e4c7b43bed0579dbb6b9e2aae14b70a8f64d171015809044cbd643263b16",
    "sanitation": "dd5bb122a4325a570ccd5fd75246c3cb4acdec4b6806e1ddbb3f70b4f316fda6",
    "james": "7c907ee636701c12fbcbfac712af6dbff6009106d537d7fc0254f06dc4cdb10f",
    "product_contract": "e5da010dbb06ec0252043a28cc6280dcedbaa3f35b18262e0b43da036f07f1aa",
    "public_record_scope": "d047c643d68d85dd34754f4865c2fea84020c2edf196e7cefdbe6a73ac6b2d76",
}

MOUNTAIN_ENTRY_IDS = (
    *(f"mc_story_{index:02d}" for index in range(1, 19)),
    *(f"mc_cue_{index:02d}" for index in range(1, 11)),
)
CADES_ENTRY_IDS = (
    "cc_story_01",
    "cc_story_02",
    "cc_story_03",
    "cc_story_04",
    "cc_story_05",
    "cc_story_06",
    "cc_story_10",
    "cc_story_07",
    "cc_story_08",
    "cc_story_09",
    "cc_story_13",
    "cc_story_11",
    "cc_story_12",
    "cc_story_14",
    *(f"cc_cue_{index:02d}" for index in range(1, 10)),
)
EXPECTED_OVERRIDE_HASHES = {
    "mc_cue_01": "b86b8b1cd7bdf268e5c39823d534992ed54e15c0fdba0eb0ae023f97f5e67df9",
    "mc_cue_02": "495fdcd6b85e8cf5bd706719f7bee12c81cc9885499b090e77560a0936b91ca9",
    "mc_cue_04": "8ec1ecdc7587a666e05531001862c1de38a4a7cb01d31b062e9b94ffc55b8694",
    "mc_cue_08": "431beed19885a1db7bd1cd7a2242c0cbbe99a98f9bad298fedf0497fc235dfa1",
    "mc_cue_09": "95cb13414d2f35338c74134f4971a152482ca4732294abf6f03811ff0359129f",
}
EXPECTED_ARTWORK_IDS = (
    "media_mc_kuwohi",
    "media_mc_oconaluftee",
    "media_cc_cove",
    "media_cc_cable_mill",
)
EXPECTED_ARTWORK_HASHES = {
    "media_mc_kuwohi": "023e027f74aff09bacbec01e89c144248cf3e633f33faa0413e41518d7157c02",
    "media_mc_oconaluftee": "33a44dea4f933f68af8d6e9cc70aaf68ede2ef418f675b87ef3d51cfd8bc21c5",
    "media_cc_cove": "c01e63f283a7b8b63d721792172ffcc772c168a4f6e32c788e9f4344308de476",
    "media_cc_cable_mill": "6b9d41b9ce8599d17fe94d478866d2d0384d6f0b8dd005ee5183e41abe5549cd",
}
EXPECTED_SANITATION_IDS = (
    "media_fp_panorama",
    "media_fp_engineering",
    *EXPECTED_ARTWORK_IDS,
)

ARTWORK_PROJECTION_FIELDS = (
    "stable_order",
    "candidate_id",
    "chapter_id",
    "intended_use",
    "subject",
    "creator",
    "license_name",
    "rights_basis",
    "asset_url",
    "license_record_url",
    "source_page_url",
    "exact_credit",
    "required_commercial_notice",
    "identity_match",
    "dimensions",
    "original_bytes",
    "original_sha256",
    "rights_record_format",
    "source_format",
    "source_mode",
    "source_frame_count",
    "selected_primary_frame_index",
    "selected_primary_frame_type",
    "selected_primary_decoded_pixel_sha256",
    "excluded_frame",
    "exif_orientation",
    "gps_metadata_present",
    "device_metadata_present",
    "date_or_identity_metadata_present",
    "icc_profile_bytes",
    "icc_profile_sha256",
)

EXPECTED_CHAPTER_ENVELOPES = {
    "foothills_parkway": {
        "provider_request_count": 16,
        "payload_character_count": 21_408,
        "normalized_character_count": 21_369,
        "reserved_provider_credit_ceiling": 23_557,
        "renderer_character_cap": 23_600,
        "proposed_one_day_api_key_credit_quota": 25_000,
        "dollar_cap_usd": "2.50",
    },
    "mountain_crossing": {
        "provider_request_count": 33,
        "payload_character_count": 59_928,
        "normalized_character_count": 59_801,
        "reserved_provider_credit_ceiling": 65_938,
        "renderer_character_cap": 66_000,
        "proposed_one_day_api_key_credit_quota": 70_000,
        "dollar_cap_usd": "7.00",
    },
    "little_river_cades_cove": {
        "provider_request_count": 23,
        "payload_character_count": 44_259,
        "normalized_character_count": 44_158,
        "reserved_provider_credit_ceiling": 48_695,
        "renderer_character_cap": 48_700,
        "proposed_one_day_api_key_credit_quota": 50_000,
        "dollar_cap_usd": "5.00",
    },
}


class Checkpoint2ApprovalError(ValueError):
    """The exact approved snapshot is missing, altered, or over-authorized."""


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise Checkpoint2ApprovalError(f"unavailable source: {path.name}") from error
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise Checkpoint2ApprovalError(f"unavailable JSON source: {path.name}") from error
    if not isinstance(value, dict):
        raise Checkpoint2ApprovalError(f"expected JSON object: {path.name}")
    return value


def _binding(name: str, path: Path) -> dict[str, Any]:
    actual = _sha256_path(path)
    if actual != EXPECTED_SOURCE_SHA256[name]:
        raise Checkpoint2ApprovalError(f"source binding drifted: {name}")
    try:
        display_path = path.relative_to(REPOSITORY).as_posix()
    except ValueError:
        display_path = f"external_fixture/{path.name}"
    return {
        "path": display_path,
        "byte_count": path.stat().st_size,
        "sha256": actual,
    }


def _script_projection(packet: dict[str, Any]) -> list[dict[str, Any]]:
    chapters = packet.get("chapter_reviews")
    if not isinstance(chapters, list) or len(chapters) != 2:
        raise Checkpoint2ApprovalError("review chapter inventory drifted")
    expected = {
        "mountain_crossing": MOUNTAIN_ENTRY_IDS,
        "little_river_cades_cove": CADES_ENTRY_IDS,
    }
    projected = []
    for chapter in chapters:
        chapter_id = chapter.get("chapter_id")
        scripts = chapter.get("scripts")
        if chapter_id not in expected or not isinstance(scripts, list):
            raise Checkpoint2ApprovalError("review chapter identity drifted")
        if tuple(row.get("id") for row in scripts) != expected[chapter_id]:
            raise Checkpoint2ApprovalError("approved script order or membership drifted")
        for row in scripts:
            if row.get("decision_status") != "user_approve_or_revise_required":
                raise Checkpoint2ApprovalError("source review script gate drifted")
            if row.get("rendering_allowed") is not False:
                raise Checkpoint2ApprovalError("source review already authorized rendering")
            transcript_hash = row.get("transcript_sha256")
            if not isinstance(transcript_hash, str) or len(transcript_hash) != 64:
                raise Checkpoint2ApprovalError("source transcript hash is invalid")
            overrides = []
            for override in row.get("variant_overrides", []):
                if override.get("decision_status") != "user_approve_or_revise_required":
                    raise Checkpoint2ApprovalError("source override gate drifted")
                if override.get("rendering_allowed") is not False:
                    raise Checkpoint2ApprovalError("source override already authorized rendering")
                overrides.append(
                    {
                        "variant_id": override.get("variant_id"),
                        "transcript_sha256": override.get("transcript_sha256"),
                        "title_sha256": override.get("title_sha256"),
                    }
                )
            projected.append(
                {
                    "chapter_id": chapter_id,
                    "base_variant_id": row.get("base_variant_id"),
                    "stable_order": row.get("stable_order"),
                    "id": row.get("id"),
                    "kind": row.get("kind"),
                    "title": row.get("title"),
                    "transcript_sha256": transcript_hash,
                    "direction_overrides": overrides,
                }
            )
    if len(projected) != 51:
        raise Checkpoint2ApprovalError("expected exactly 51 remaining scripts")
    overrides = [
        (row["id"], override)
        for row in projected
        for override in row["direction_overrides"]
    ]
    if len(overrides) != 5:
        raise Checkpoint2ApprovalError("expected exactly five direction overrides")
    if {entry_id: row["transcript_sha256"] for entry_id, row in overrides} != (
        EXPECTED_OVERRIDE_HASHES
    ):
        raise Checkpoint2ApprovalError("direction override identity drifted")
    if any(row["variant_id"] != "nc_to_tn" for _, row in overrides):
        raise Checkpoint2ApprovalError("direction override variant drifted")
    if _canonical_sha256(projected) != EXPECTED_SOURCE_SET_SHA256["scripts"]:
        raise Checkpoint2ApprovalError("script approval set drifted")
    return projected


def _artwork_projection(packet: dict[str, Any]) -> list[dict[str, Any]]:
    artwork = packet.get("artwork_candidates")
    if not isinstance(artwork, list) or len(artwork) != 4:
        raise Checkpoint2ApprovalError("artwork review inventory drifted")
    if tuple(row.get("candidate_id") for row in artwork) != EXPECTED_ARTWORK_IDS:
        raise Checkpoint2ApprovalError("artwork order or membership drifted")
    projected = []
    for row in artwork:
        candidate_id = row["candidate_id"]
        if row.get("original_sha256") != EXPECTED_ARTWORK_HASHES[candidate_id]:
            raise Checkpoint2ApprovalError("artwork original identity drifted")
        if row.get("status") != "candidate_only_user_visual_approval_required":
            raise Checkpoint2ApprovalError("source artwork review gate drifted")
        for field in (
            "exact_original_user_visual_approval",
            "sanitation_authorized",
            "sanitized_derivative_complete",
            "derivative_user_visual_approval",
            "ingestion_allowed",
            "upload_allowed",
            "publication_allowed",
        ):
            if row.get(field) is not False:
                raise Checkpoint2ApprovalError(f"source artwork escaped gate: {field}")
        projected.append({field: row[field] for field in ARTWORK_PROJECTION_FIELDS})
    if _canonical_sha256(projected) != EXPECTED_SOURCE_SET_SHA256["artwork"]:
        raise Checkpoint2ApprovalError("artwork approval set drifted")
    return projected


def _sanitation_source(packet: dict[str, Any]) -> list[dict[str, Any]]:
    job = packet.get("proposed_six_image_sanitation_job")
    if not isinstance(job, dict) or job.get("item_count") != 6:
        raise Checkpoint2ApprovalError("sanitation proposal inventory drifted")
    items = job.get("items")
    if not isinstance(items, list) or tuple(
        row.get("candidate_id") for row in items
    ) != EXPECTED_SANITATION_IDS:
        raise Checkpoint2ApprovalError("sanitation proposal order drifted")
    if _canonical_sha256(items) != EXPECTED_SOURCE_SET_SHA256["sanitation"]:
        raise Checkpoint2ApprovalError("sanitation proposal identity drifted")
    if job.get("sanitation_authorized") is not False:
        raise Checkpoint2ApprovalError("source sanitation proposal already authorized")
    if job.get("derivatives_created") is not False:
        raise Checkpoint2ApprovalError("source sanitation proposal already executed")
    if job.get("derivative_visual_approval") is not False:
        raise Checkpoint2ApprovalError("source derivative visual gate drifted")
    if job.get("ingestion_allowed") is not False:
        raise Checkpoint2ApprovalError("source sanitation ingestion gate drifted")
    for row in items:
        if row.get("sanitation_authorized") is not False:
            raise Checkpoint2ApprovalError("source sanitation item already authorized")
        for field in (
            "derivative_created",
            "derivative_user_visual_approval",
            "ingestion_allowed",
            "upload_allowed",
            "publication_allowed",
        ):
            if row.get(field) is not False:
                raise Checkpoint2ApprovalError(f"sanitation item escaped gate: {field}")
    return items


def _assert_chapter_lock(
    chapter_id: str,
    lock: dict[str, Any],
) -> dict[str, Any]:
    expected = EXPECTED_CHAPTER_ENVELOPES[chapter_id]
    if lock.get("product_id") != PRODUCT_ID or lock.get("chapter_id") != chapter_id:
        raise Checkpoint2ApprovalError("James chapter-lock identity drifted")
    aggregate = lock.get("aggregate")
    budget = lock.get("budget")
    authorization = lock.get("authorization")
    profile = lock.get("generation_profile")
    if not all(
        isinstance(value, dict)
        for value in (aggregate, budget, authorization, profile)
    ):
        raise Checkpoint2ApprovalError("James chapter lock is incomplete")
    if aggregate.get("provider_request_count") != expected["provider_request_count"]:
        raise Checkpoint2ApprovalError("James chapter request count drifted")
    for field in (
        "payload_character_count",
        "normalized_character_count",
        "reserved_provider_credit_ceiling",
        "renderer_character_cap",
        "proposed_one_day_api_key_credit_quota",
        "dollar_cap_usd",
    ):
        if budget.get(field) != expected[field]:
            raise Checkpoint2ApprovalError(f"James chapter budget drifted: {field}")
    if budget.get("cross_chapter_borrowing_allowed") is not False:
        raise Checkpoint2ApprovalError("cross-chapter borrowing became allowed")
    if budget.get("paid_overage_authorized") is not False:
        raise Checkpoint2ApprovalError("source lock authorized paid overage")
    if budget.get("rerender_budget") != 0:
        raise Checkpoint2ApprovalError("source lock rerender budget drifted")
    false_authorizations = (
        "api_key_creation_authorized",
        "chapter_render_authorized",
        "database_mutation_authorized",
        "ingestion_authorized",
        "manifest_mutation_authorized",
        "network_access_authorized",
        "production_mutation_authorized",
        "provider_credit_spend_authorized",
        "provider_request_authorized",
        "public_release_authorized",
        "rerender_authorized",
        "upload_authorized",
    )
    if any(authorization.get(field) is not False for field in false_authorizations):
        raise Checkpoint2ApprovalError("source James lock escaped review-only gate")
    if profile.get("provider") != "elevenlabs":
        raise Checkpoint2ApprovalError("James provider drifted")
    if profile.get("voice_id") != "EkK5I93UQWFDigLMpZcX":
        raise Checkpoint2ApprovalError("James voice identity drifted")
    if profile.get("model_id") != "eleven_multilingual_v2":
        raise Checkpoint2ApprovalError("James model identity drifted")
    if profile.get("voice_settings") != {
        "similarity_boost": 0.5,
        "speed": 1.0,
        "stability": 0.5,
        "style": 0.1,
        "use_speaker_boost": True,
    }:
        raise Checkpoint2ApprovalError("James voice settings drifted")
    return {
        "chapter_id": chapter_id,
        **expected,
        "cross_chapter_borrowing_allowed": False,
        "paid_overage_authorized": False,
        "rerender_budget": 0,
        "insufficient_included_credits_behavior": "stop_before_dispatch",
    }


def _assert_james_source(
    packet: dict[str, Any],
    documents: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    proposal = packet.get("proposed_james_render_and_spend")
    if not isinstance(proposal, dict):
        raise Checkpoint2ApprovalError("James proposal is missing")
    if _canonical_sha256(proposal) != EXPECTED_SOURCE_SET_SHA256["james"]:
        raise Checkpoint2ApprovalError("James proposal identity drifted")
    if proposal.get("status") != "owner_render_and_spend_authorization_required":
        raise Checkpoint2ApprovalError("James proposal status drifted")
    for field in (
        "fresh_authenticated_provider_preflight_complete",
        "api_key_creation_authorized",
        "provider_request_authorized",
        "provider_credit_spend_authorized",
        "render_authorized",
        "narration_generated",
    ):
        if proposal.get(field) is not False:
            raise Checkpoint2ApprovalError(f"source James proposal escaped gate: {field}")

    locks = (
        ("foothills_parkway", documents["james_foothills_lock"]),
        ("mountain_crossing", documents["james_mountain_lock"]),
        ("little_river_cades_cove", documents["james_cades_lock"]),
    )
    envelopes = [_assert_chapter_lock(chapter_id, lock) for chapter_id, lock in locks]
    aggregate = proposal.get("aggregate")
    if aggregate != {
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
    }:
        raise Checkpoint2ApprovalError("combined James envelope drifted")

    preflight = documents["james_batch_preflight"]
    if preflight.get("status") != (
        "network_free_review_ready_authenticated_preflight_not_run"
    ):
        raise Checkpoint2ApprovalError("James batch preflight status drifted")
    scope = preflight.get("scope")
    if not isinstance(scope, dict):
        raise Checkpoint2ApprovalError("James batch scope is missing")
    if scope.get("new_provider_request_count") != 72:
        raise Checkpoint2ApprovalError("James batch request count drifted")
    if scope.get("new_base_entry_count") != 64:
        raise Checkpoint2ApprovalError("James base request count drifted")
    if scope.get("new_directional_override_count") != 8:
        raise Checkpoint2ApprovalError("James override request count drifted")
    effects = preflight.get("builder_effects")
    if not isinstance(effects, dict):
        raise Checkpoint2ApprovalError("James preflight effects are missing")
    if effects.get("provider_requests_sent") != 0:
        raise Checkpoint2ApprovalError("James preflight sent provider requests")
    if effects.get("provider_credits_spent") != 0:
        raise Checkpoint2ApprovalError("James preflight spent credits")
    return proposal, envelopes


def _assert_packet(
    packet: dict[str, Any],
    documents: dict[str, dict[str, Any]],
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any],
    list[dict[str, Any]],
]:
    if packet.get("product_id") != PRODUCT_ID:
        raise Checkpoint2ApprovalError("review packet product identity drifted")
    if packet.get("packet_id") != (
        "smokies_mountain_crossing_cades_cove_review_20260810_v1"
    ):
        raise Checkpoint2ApprovalError("review packet identity drifted")
    if packet.get("status") != (
        "explicit_remaining_script_artwork_and_sanitation_decisions_required"
    ):
        raise Checkpoint2ApprovalError("review packet status drifted")
    if _canonical_sha256(packet.get("product_contract")) != (
        EXPECTED_SOURCE_SET_SHA256["product_contract"]
    ):
        raise Checkpoint2ApprovalError("product contract drifted")
    if _canonical_sha256(packet.get("public_record_scope")) != (
        EXPECTED_SOURCE_SET_SHA256["public_record_scope"]
    ):
        raise Checkpoint2ApprovalError("public-record scope drifted")
    scope = packet.get("review_scope")
    if not isinstance(scope, dict):
        raise Checkpoint2ApprovalError("review scope is missing")
    if scope.get("script_count") != 51 or scope.get("direction_override_count") != 5:
        raise Checkpoint2ApprovalError("script review counts drifted")
    if scope.get("artwork_original_candidate_count") != 4:
        raise Checkpoint2ApprovalError("artwork review count drifted")
    if scope.get("proposed_sanitation_original_count") != 6:
        raise Checkpoint2ApprovalError("sanitation review count drifted")
    if scope.get("proposed_new_narration_request_count") != 72:
        raise Checkpoint2ApprovalError("narration review count drifted")
    gate = packet.get("decision_gate")
    if not isinstance(gate, dict):
        raise Checkpoint2ApprovalError("review decision gate is missing")
    if gate.get("accepted_james_profile_selected_for_remaining_chapters") is not True:
        raise Checkpoint2ApprovalError("accepted James selection drifted")
    false_source_gates = (
        "remaining_script_decisions_recorded",
        "remaining_override_decisions_recorded",
        "remaining_artwork_original_decisions_recorded",
        "six_image_sanitation_authorized",
        "artwork_derivatives_created",
        "derivative_visual_approval",
        "exact_james_render_and_spend_envelopes_approved",
        "fresh_authenticated_provider_preflight_complete",
        "one_day_provider_keys_created",
        "tts_or_render_authorized",
        "provider_spend_authorized",
        "narration_generated",
        "ingestion_allowed",
        "manifest_creation_or_mutation_allowed",
        "upload_allowed",
        "database_accessed",
        "production_mutation_allowed",
        "trusted_validation_allowed",
        "publication_allowed",
        "public_release",
    )
    if any(gate.get(field) is not False for field in false_source_gates):
        raise Checkpoint2ApprovalError("source review decision gate drifted")

    scripts = _script_projection(packet)
    artwork = _artwork_projection(packet)
    sanitation = _sanitation_source(packet)
    james, envelopes = _assert_james_source(packet, documents)

    foothills = documents["foothills_approval"]
    foothills_boundary = foothills.get("approval_boundary")
    if not isinstance(foothills_boundary, dict):
        raise Checkpoint2ApprovalError("Foothills approval boundary is missing")
    if foothills_boundary.get("foothills_exact_scripts_user_approved") is not True:
        raise Checkpoint2ApprovalError("Foothills script approval drifted")
    if foothills_boundary.get(
        "foothills_exact_original_artwork_user_approved"
    ) is not True:
        raise Checkpoint2ApprovalError("Foothills artwork approval drifted")
    if foothills_boundary.get("artwork_sanitation_authorized") is not False:
        raise Checkpoint2ApprovalError("historical Foothills overlay was rewritten")
    return scripts, artwork, sanitation, james, envelopes


def _approved_scripts(source: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for row in source:
        overrides = [
            {
                **override,
                "exact_transcript_user_approved": True,
                "accepted_james_profile_selected": True,
                "tts_or_render_authorized": True,
                "narration_generated": False,
            }
            for override in row["direction_overrides"]
        ]
        rows.append(
            {
                **row,
                "direction_overrides": overrides,
                "exact_transcript_user_approved": True,
                "accepted_james_profile_selected": True,
                "tts_or_render_authorized": True,
                "narration_generated": False,
            }
        )
    return rows


def _approved_artwork(source: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            **row,
            "exact_original_user_visual_approval": True,
            "sanitation_authorized": True,
            "sanitized_derivative_complete": False,
            "derivative_user_visual_approval": False,
            "ingestion_allowed": False,
            "upload_allowed": False,
            "publication_allowed": False,
        }
        for row in source
    ]


def _authorized_sanitation(source: list[dict[str, Any]]) -> dict[str, Any]:
    items = []
    for row in source:
        items.append(
            {
                **row,
                "exact_original_user_visual_approval": True,
                "sanitation_authorized": True,
                "derivative_created": False,
                "derivative_user_visual_approval": False,
                "ingestion_allowed": False,
                "upload_allowed": False,
                "publication_allowed": False,
            }
        )
    return {
        "status": "exact_six_image_sanitation_authorized_not_executed",
        "item_count": 6,
        "items": items,
        "sanitation_authorized": True,
        "derivatives_created": False,
        "derivative_visual_approval": False,
        "ingestion_allowed": False,
        "upload_allowed": False,
        "publication_allowed": False,
    }


def _authorized_james(
    proposal: dict[str, Any], envelopes: list[dict[str, Any]]
) -> dict[str, Any]:
    voice = proposal["voice"]
    aggregate = proposal["aggregate"]
    return {
        "status": "exact_preflight_render_and_spend_authorized_not_executed",
        "source_proposal_canonical_sha256": EXPECTED_SOURCE_SET_SHA256["james"],
        "voice": voice,
        "chapter_envelopes": [
            {
                **row,
                "restricted_one_day_key_creation_authorized": True,
                "provider_request_authorized": True,
                "provider_credit_spend_authorized": True,
                "render_authorized": True,
                "narration_generated": False,
            }
            for row in envelopes
        ],
        "aggregate": aggregate,
        "fresh_authenticated_provider_preflight_authorized": True,
        "fresh_authenticated_provider_preflight_complete": False,
        "restricted_one_day_key_creation_authorized": True,
        "restricted_one_day_keys_created": 0,
        "network_access_authorized_only_for_exact_provider_preflight_and_render": True,
        "provider_request_authorized": True,
        "provider_credit_spend_authorized": True,
        "render_authorized": True,
        "provider_requests_sent": 0,
        "provider_credits_spent": 0,
        "narration_generated": False,
        "automatic_rerender_count": 0,
        "rerender_authorized": False,
        "paid_overage_authorized": False,
        "cross_chapter_borrowing_allowed": False,
        "hard_reserved_provider_credit_ceiling": 138_190,
        "hard_renderer_character_cap": 138_300,
        "hard_combined_one_day_key_quota": 145_000,
        "hard_dollar_cap_usd": "14.50",
        "execution_conditions": {
            "fresh_account_plan_terms_voice_model_settings_credit_and_key_preflight_required": True,
            "insufficient_included_credits_behavior": "stop_before_dispatch",
            "terms_or_account_drift_behavior": "stop_for_fresh_owner_review",
            "safe_retry_only": "provider_confirmed_uncharged_429",
            "ambiguous_timeout_or_billing_behavior": "stop_and_reconcile_without_retry",
            "http_5xx_behavior": "stop_without_retry",
            "invalid_audio_behavior": "stop_without_retry",
            "unused_budget_transfer_allowed": False,
        },
    }


def build() -> dict[str, Any]:
    decision_bytes = DECISION_TEXT.encode("utf-8")
    if len(decision_bytes) != DECISION_BYTE_COUNT:
        raise Checkpoint2ApprovalError("approval message byte count drifted")
    if hashlib.sha256(decision_bytes).hexdigest() != DECISION_SHA256:
        raise Checkpoint2ApprovalError("approval message hash drifted")
    if not DECISION_TEXT.endswith("\n") or DECISION_TEXT.endswith("\r\n"):
        raise Checkpoint2ApprovalError("approval message newline identity drifted")

    bindings = {name: _binding(name, path) for name, path in SOURCE_PATHS.items()}
    documents = {
        name: _load_json(path)
        for name, path in SOURCE_PATHS.items()
        if path.suffix == ".json"
    }
    packet = documents["review_packet"]
    scripts_source, artwork_source, sanitation_source, james_source, envelopes = (
        _assert_packet(packet, documents)
    )
    scripts = _approved_scripts(scripts_source)
    artwork = _approved_artwork(artwork_source)
    sanitation = _authorized_sanitation(sanitation_source)
    james = _authorized_james(james_source, envelopes)

    return {
        "schema_version": 1,
        "overlay_id": OVERLAY_ID,
        "kind": "smokies_checkpoint2_owner_approval_overlay",
        "product_id": PRODUCT_ID,
        "recorded_at": APPROVED_AT,
        "status": (
            "checkpoint2_exact_review_sanitation_and_james_render_approved_"
            "downstream_delivery_blocked"
        ),
        "approval": {
            "approved_at": APPROVED_AT,
            "approved_at_source": "source_task_user_message_event_metadata",
            "approved_by": "project_owner",
            "source_task_id": SOURCE_TASK_ID,
            "decision": (
                "approve_all_checkpoint1_items_authorize_exact_six_image_"
                "sanitation_and_exact_72_request_james_envelopes"
            ),
            "decision_text_verbatim": DECISION_TEXT,
            "decision_message_hash_input": "exact_utf8_bytes_with_one_trailing_lf",
            "decision_message_byte_count": DECISION_BYTE_COUNT,
            "decision_message_sha256": DECISION_SHA256,
            "scope": {
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
            },
        },
        "source_revision": {
            "checkpoint1_commit": CHECKPOINT1_COMMIT,
            "checkpoint1_tree": CHECKPOINT1_TREE,
            "checkpoint1_parent_review_source_commit": CHECKPOINT1_PARENT,
            "all_bound_sources_verified_at_checkpoint1_commit": True,
        },
        "source_bindings": bindings,
        "source_set_bindings": EXPECTED_SOURCE_SET_SHA256,
        "approval_set_bindings": {
            "approved_scripts_sha256": _canonical_sha256(scripts),
            "approved_artwork_sha256": _canonical_sha256(artwork),
            "authorized_sanitation_sha256": _canonical_sha256(sanitation),
            "authorized_james_sha256": _canonical_sha256(james),
        },
        "product_contract": packet["product_contract"],
        "public_record_scope": {
            "source_canonical_sha256": EXPECTED_SOURCE_SET_SHA256[
                "public_record_scope"
            ],
            "claim_count": packet["public_record_scope"]["claim_count"],
            "classification": "public_record_factual",
            "external_outreach_required": False,
            "external_outreach_performed": False,
            "ebci_approval_claimed": False,
        },
        "approved_remaining_scripts": scripts,
        "approved_original_artwork": artwork,
        "authorized_six_image_sanitation_job": sanitation,
        "authorized_james_render_and_spend": james,
        "protected_prior_evidence": {
            "foothills_s4u_approval_file_sha256": EXPECTED_SOURCE_SHA256[
                "foothills_approval"
            ],
            "foothills_exact_script_count": 13,
            "foothills_exact_original_artwork_count": 2,
            "roaring_fork_status": (
                packet["protected_roaring_fork_evidence"]["status"]
            ),
            "roaring_fork_current_asset_count": (
                packet["protected_roaring_fork_evidence"]["current_asset_count"]
            ),
            "roaring_fork_evidence_rewritten": False,
        },
        "approval_boundary": {
            "remaining_exact_scripts_user_approved": True,
            "mountain_direction_overrides_user_approved": True,
            "remaining_exact_original_artwork_user_approved": True,
            "six_image_sanitation_authorized": True,
            "artwork_derivatives_created": False,
            "derivative_visual_approval": False,
            "accepted_james_profile_selected_for_all_new_narration": True,
            "fresh_authenticated_provider_preflight_authorized": True,
            "fresh_authenticated_provider_preflight_complete": False,
            "restricted_one_day_key_creation_authorized": True,
            "restricted_one_day_keys_created": 0,
            "exact_72_request_james_render_authorized": True,
            "exact_provider_credit_spend_authorized": True,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
            "narration_generated": False,
            "ingestion_allowed": False,
            "manifest_creation_or_mutation_allowed": False,
            "upload_allowed": False,
            "database_accessed": False,
            "production_mutation_allowed": False,
            "trusted_validation_allowed": False,
            "publication_allowed": False,
            "public_release": False,
            "next_action": (
                "create_the_exact_six_sanitized_derivatives_and_run_the_guarded_"
                "provider_preflight_then_render_only_if_every_exact_condition_matches"
            ),
        },
        "builder_effects": {
            "network_accessed": False,
            "provider_accessed": False,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
            "api_keys_created": 0,
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
            raise SystemExit("Checkpoint 2 owner-approval overlay is stale; rebuild it")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
