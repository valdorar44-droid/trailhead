#!/usr/bin/env python3
"""Build the exact owner media-acceptance overlay for the remaining media.

This network-free builder binds one authoritative owner message to the six
reviewed image derivatives and the exact 72-file narration QA result.  It
reads and hashes immutable external media, but it never changes media,
provider state, a database, a manifest, validation state, deployment state,
or publication state.  All authority beyond exact media acceptance remains
closed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any


REPOSITORY = Path(__file__).resolve().parents[1]
ORIGINALS = REPOSITORY / "originals/smokies"
OUTPUT_PATH = ORIGINALS / "remaining_media_acceptance_v1.json"

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
OVERLAY_ID = "smokies_remaining_media_acceptance_20260811_v1"

SOURCE_TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"
SOURCE_RESPONSE_ITEM_ID = "msg_019ff1eb-87e5-7383-a8f0-b9b69e537626"
SOURCE_TURN_ID = "019ff1eb-864b-7e31-b996-66293e382553"
APPROVED_AT = "2026-08-11T17:42:52.645Z"
DECISION_TEXT = (
    "Approve the six displayed derivative hashes and the exact 72-file "
    "narration set bound to QA SHA "
    "94812375b47c62d96352f46c6adc0929f0483485a5c171174a4a30fce0995d97\n"
)
DECISION_BYTE_COUNT = 161
DECISION_SHA256 = (
    "25ae45080fb4d6dcfc82da7845e7b9aed3097e8e7e17f2d3bcdf02a1be5c0605"
)

SOURCE_COMMIT = "8e2a116a9f21ec4fb4b140eb5076d331acc42cae"
SOURCE_TREE = "f017eb87e57f097c75a953d6a22fec50f1ed6c08"
SOURCE_PARENT = "4da66ef668efa0e542cd7b39d4cc42511984bfb0"

QA_FILENAME = "remaining-audio-qa-v1.json"
QA_REPORT_SHA256 = (
    "94812375b47c62d96352f46c6adc0929f0483485a5c171174a4a30fce0995d97"
)
QA_REPORT_BYTES = 200_097
RENDER_ROOT_BASENAME = "trailhead-smokies-james-remaining-v1"
DEFAULT_RENDER_ROOT = (
    Path.home()
    / ".trailhead-smokies-james-private-v1"
    / RENDER_ROOT_BASENAME
)
DEFAULT_DERIVATIVE_ROOT = (
    Path.home()
    / ".openclaw/evidence/smokies-s4m-six-image-v1/derivatives"
)

TRACKED_SOURCE_PATHS = {
    "checkpoint2_owner_approval": ORIGINALS / "checkpoint2_owner_approval_v1.json",
    "remaining_artwork_derivatives": (
        ORIGINALS / "remaining_artwork_derivatives_v1.json"
    ),
    "renderer_audit": (
        ORIGINALS / "elevenlabs_james_remaining_renderer_audit_v1.json"
    ),
    "roaring_fork_artwork_derivative_approval": (
        ORIGINALS / "roaring_fork_artwork_derivative_approval_v1.json"
    ),
    "roaring_fork_real_audio_characterization": (
        ORIGINALS / "roaring_fork_real_audio_characterization_v1.json"
    ),
}
EXPECTED_TRACKED_SOURCES = {
    "checkpoint2_owner_approval": {
        "byte_count": 68_453,
        "sha256": "3cc18dad4d1b6a80f2259e58cbe50fba3804096d0c00437eca9103e626078d5c",
    },
    "remaining_artwork_derivatives": {
        "byte_count": 34_407,
        "sha256": "bbe38024d4d798673e9cd9684d26cf4f2620baf63ef6c230335a836cc443918a",
    },
    "renderer_audit": {
        "byte_count": 1_722,
        "sha256": "f06f4667e968c062e5818363c68ff78fdf6d4503036e6aaf9de9235fcccf8bef",
    },
    "roaring_fork_artwork_derivative_approval": {
        "byte_count": 14_276,
        "sha256": "e13c39785e90190e0dfb4db5c60c709568b68d3ecbd76910ab00799a721b951a",
    },
    "roaring_fork_real_audio_characterization": {
        "byte_count": 18_883,
        "sha256": "f34b7aa8df6c5270f7b93f98a5bb720cf9c95df7fc1751eaeb1c6b6899529d1b",
    },
}

EXPECTED_DERIVATIVES = (
    {
        "stable_order": 1,
        "candidate_id": "media_fp_panorama",
        "chapter_id": "foothills_parkway",
        "derivative_filename": "media_fp_panorama_sanitized_v1.png",
        "derivative_bytes": 10_144_630,
        "derivative_sha256": "75e7605dfd26db71a8fb1877c7195e8f1df18c41d1cc9342041c6f34d5dbaba1",
        "decoded_pixel_sha256": "aefcc7e4e6fed1cb0c9b8bb93ade3fe9185f3399e8aa9bdd78c00f46ece2b3e6",
        "source_original_sha256": "92da599e63f7f2afabd81106d6649441b11b5406e7c94ec3ba448c643e6f19d8",
    },
    {
        "stable_order": 2,
        "candidate_id": "media_fp_engineering",
        "chapter_id": "foothills_parkway",
        "derivative_filename": "media_fp_engineering_sanitized_v1.png",
        "derivative_bytes": 11_042_083,
        "derivative_sha256": "f96f1e5143e116e042916ec3f40cd4120454bfa579e9782639c5b2b672271c5e",
        "decoded_pixel_sha256": "6be15ca5db35336ee346160d312bf1bea55d1a6152a8aa9493cc845cee72798d",
        "source_original_sha256": "ed4f3bc69b7fd0f34040e3214a1633f410327c0deb3c0c04412d861760de78af",
    },
    {
        "stable_order": 3,
        "candidate_id": "media_mc_kuwohi",
        "chapter_id": "mountain_crossing",
        "derivative_filename": "media_mc_kuwohi_sanitized_v1.png",
        "derivative_bytes": 9_018_850,
        "derivative_sha256": "956fad4e641b7abe498908e70f0b108f6363fe833f640f6cc02583e1a5713b32",
        "decoded_pixel_sha256": "7a66bec70f98e4bdcc83e9e0b45543902e2ee4a752bb6a6437fd2cf4d8931ba8",
        "source_original_sha256": "023e027f74aff09bacbec01e89c144248cf3e633f33faa0413e41518d7157c02",
    },
    {
        "stable_order": 4,
        "candidate_id": "media_mc_oconaluftee",
        "chapter_id": "mountain_crossing",
        "derivative_filename": "media_mc_oconaluftee_sanitized_v1.png",
        "derivative_bytes": 12_711_812,
        "derivative_sha256": "9dff31bfd0c3e4417b2a67685e5fa3cb67bba8605a3099eb377de197904afd13",
        "decoded_pixel_sha256": "172d4a2f88f8363fd2e660ffc157ee9265a1fe55c6ae3d9f90a6599b8c08fdd1",
        "source_original_sha256": "33a44dea4f933f68af8d6e9cc70aaf68ede2ef418f675b87ef3d51cfd8bc21c5",
    },
    {
        "stable_order": 5,
        "candidate_id": "media_cc_cove",
        "chapter_id": "little_river_cades_cove",
        "derivative_filename": "media_cc_cove_sanitized_v1.png",
        "derivative_bytes": 12_819_811,
        "derivative_sha256": "80a82ae8ee7353b46ec24105ab80b2e651cd38375f50d9d64a346d092a99652c",
        "decoded_pixel_sha256": "f54d50976dc1c1b6b477c160b0193263b4bc451b3264324f0c5594cffe7f8232",
        "source_original_sha256": "c01e63f283a7b8b63d721792172ffcc772c168a4f6e32c788e9f4344308de476",
    },
    {
        "stable_order": 6,
        "candidate_id": "media_cc_cable_mill",
        "chapter_id": "little_river_cades_cove",
        "derivative_filename": "media_cc_cable_mill_sanitized_v1.png",
        "derivative_bytes": 13_326_710,
        "derivative_sha256": "3540935d92ae2d48a6b2ce15c37da653bd32ec371fb1249191625ce10addcd9b",
        "decoded_pixel_sha256": "6df57c5b652b3ee7f53421c4bd35b87e90357d513296a6ebbc03431f2c551a71",
        "source_original_sha256": "6b9d41b9ce8599d17fe94d478866d2d0384d6f0b8dd005ee5183e41abe5549cd",
    },
)

EXPECTED_CHAPTER_CLOSEOUTS = (
    {
        "chapter_id": "foothills_parkway",
        "request_count": 16,
        "provider_credit_cost": 11_775,
        "locked_billable_input_character_count": 21_408,
        "provider_reported_chapter_usage_usd": "2.14",
        "ledger_input_character_usage_usd_unrounded": "2.1408",
        "projected_chapter_cost_ceiling_usd": "2.15",
        "chapter_dollar_cap_usd": "2.50",
        "audio_inventory_sha256": "7e77e2a2224f40d5a298733b09b3ee5ee109cd6801e7b76b26caa7264b723ca1",
        "closeout_sha256": "61cc8f40fe00d37332ec57f75b862fa5141fe896e5104399446cb96b6fbe6f8d",
        "prior_closeout_sha256": None,
    },
    {
        "chapter_id": "mountain_crossing",
        "request_count": 33,
        "provider_credit_cost": 32_958,
        "locked_billable_input_character_count": 59_928,
        "provider_reported_chapter_usage_usd": "5.99",
        "ledger_input_character_usage_usd_unrounded": "5.9928",
        "projected_chapter_cost_ceiling_usd": "6.00",
        "chapter_dollar_cap_usd": "7.00",
        "audio_inventory_sha256": "9e0c531610324358dcbaa9a5b9fb384b8077b4099b7cb81da2ffd493b12ea762",
        "closeout_sha256": "91a5c435ae797952dd25d0b1e96a482288a3152b63ec043029504a763c16b653",
        "prior_closeout_sha256": "61cc8f40fe00d37332ec57f75b862fa5141fe896e5104399446cb96b6fbe6f8d",
    },
    {
        "chapter_id": "little_river_cades_cove",
        "request_count": 23,
        "provider_credit_cost": 24_341,
        "locked_billable_input_character_count": 44_259,
        "provider_reported_chapter_usage_usd": "4.43",
        "ledger_input_character_usage_usd_unrounded": "4.4259",
        "projected_chapter_cost_ceiling_usd": "4.43",
        "chapter_dollar_cap_usd": "5.00",
        "audio_inventory_sha256": "13c62c9f5162615eed81399f30ecf98fb769cde1d1de09ca0195470c71133c5a",
        "closeout_sha256": "290a53bb81653b664c05a4ae245d7469c5ebb1d1b52523e3eba55a6fb727160f",
        "prior_closeout_sha256": "91a5c435ae797952dd25d0b1e96a482288a3152b63ec043029504a763c16b653",
    },
)


class MediaAcceptanceError(ValueError):
    """An approved event, evidence record, or immutable media byte drifted."""


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise MediaAcceptanceError(f"unavailable evidence: {path.name}") from error
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
        raise MediaAcceptanceError(f"unavailable JSON evidence: {path.name}") from error
    if not isinstance(value, dict):
        raise MediaAcceptanceError(f"expected JSON object: {path.name}")
    return value


def _tracked_binding(name: str, path: Path) -> dict[str, Any]:
    expected = EXPECTED_TRACKED_SOURCES[name]
    try:
        byte_count = path.stat().st_size
    except OSError as error:
        raise MediaAcceptanceError(f"unavailable tracked source: {name}") from error
    if byte_count != expected["byte_count"] or _sha256_path(path) != expected["sha256"]:
        raise MediaAcceptanceError(f"tracked source drifted: {name}")
    return {
        "path": path.relative_to(REPOSITORY).as_posix(),
        "byte_count": byte_count,
        "sha256": expected["sha256"],
    }


def _safe_external_path(root: Path, serialized: str, label: str) -> Path:
    if not isinstance(serialized, str) or not serialized:
        raise MediaAcceptanceError(f"missing external path: {label}")
    if "\\" in serialized or ":" in serialized:
        raise MediaAcceptanceError(f"unsafe external path: {label}")
    relative = PurePosixPath(serialized)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise MediaAcceptanceError(f"unsafe external path: {label}")
    try:
        resolved_root = root.resolve(strict=True)
        candidate = root.joinpath(*relative.parts)
        if candidate.is_symlink():
            raise MediaAcceptanceError(f"symlink external evidence rejected: {label}")
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise MediaAcceptanceError(f"unavailable external evidence: {label}") from error
    if not resolved.is_relative_to(resolved_root) or not resolved.is_file():
        raise MediaAcceptanceError(f"external evidence escaped root: {label}")
    return resolved


def _assert_checkpoint2(document: dict[str, Any]) -> None:
    if document.get("overlay_id") != "smokies_checkpoint2_owner_approval_20260810_v1":
        raise MediaAcceptanceError("Checkpoint 2 approval identity drifted")
    if document.get("approval", {}).get("decision") != (
        "approve_all_checkpoint1_items_authorize_exact_six_image_sanitation_"
        "and_exact_72_request_james_envelopes"
    ):
        raise MediaAcceptanceError("Checkpoint 2 approval decision drifted")
    contract = document.get("product_contract", {})
    if (
        contract.get("pack_scope") != "one_premium_four_chapter_product"
        or len(contract.get("chapter_ids", [])) != 4
        or contract.get("route_variant_count") != 6
        or contract.get("explorer_included") is not True
        or contract.get("permanent_credit_price") != 900
        or contract.get("credit_type") != "earned_credits"
        or contract.get("standalone_chapter_products_approved") is not False
    ):
        raise MediaAcceptanceError("Checkpoint 2 product contract drifted")
    scope = document.get("approval", {}).get("scope", {})
    if (
        scope.get("remaining_exact_script_count") != 51
        or scope.get("mountain_direction_override_count") != 5
        or scope.get("new_exact_original_artwork_count") != 4
        or scope.get("sanitation_original_count") != 6
        or scope.get("james_provider_request_count") != 72
    ):
        raise MediaAcceptanceError("Checkpoint 2 approved scope drifted")
    protected = document.get("protected_prior_evidence", {})
    if protected != {
        "foothills_exact_original_artwork_count": 2,
        "foothills_exact_script_count": 13,
        "foothills_s4u_approval_file_sha256": "a301c702155512c66df60e819274271fc9a6001b398266be5d9a6329a82592bb",
        "roaring_fork_current_asset_count": 20,
        "roaring_fork_evidence_rewritten": False,
        "roaring_fork_status": "preserved_unchanged_and_excluded_from_this_review",
    }:
        raise MediaAcceptanceError("protected prior evidence drifted")


def _accepted_derivatives(
    document: dict[str, Any], derivative_root: Path
) -> list[dict[str, Any]]:
    if document.get("overlay_id") != "smokies_remaining_artwork_derivatives_20260811_v1":
        raise MediaAcceptanceError("derivative evidence identity drifted")
    gate = document.get("approval_gate", {})
    required_true = (
        "derivative_hashes_complete",
        "derivative_mirrors_complete",
        "derivatives_complete",
        "exact_originals_approved",
        "immutable_source_mirrors_verified",
        "metadata_sanitation_complete",
        "rights_credit_change_notes_and_notices_bound",
        "six_image_sanitation_authorized",
    )
    required_false = (
        "derivative_user_visual_approval",
        "ingestion_allowed",
        "manifest_creation_or_mutation_allowed",
        "production_mutation_allowed",
        "public_release",
        "publication_allowed",
        "upload_allowed",
    )
    if any(gate.get(key) is not True for key in required_true) or any(
        gate.get(key) is not False for key in required_false
    ):
        raise MediaAcceptanceError("derivative evidence gate drifted")
    if document.get("summary", {}).get("derivative_count") != 6:
        raise MediaAcceptanceError("derivative count drifted")

    rows = document.get("derivatives")
    if not isinstance(rows, list) or len(rows) != 6:
        raise MediaAcceptanceError("derivative inventory drifted")
    accepted: list[dict[str, Any]] = []
    for source, expected in zip(rows, EXPECTED_DERIVATIVES, strict=True):
        if any(source.get(key) != value for key, value in expected.items()):
            raise MediaAcceptanceError(
                f"derivative identity drifted: {expected['candidate_id']}"
            )
        if (
            source.get("derivative_user_visual_approval") is not False
            or source.get("upload_allowed") is not False
            or source.get("ingestion_allowed") is not False
            or source.get("publication_allowed") is not False
            or source.get("source_rights_credit_change_note_and_notice_bound")
            is not True
            or source.get("full_frame_preserved") is not True
            or source.get("crop") != "none"
            or source.get("resize") != "none"
        ):
            raise MediaAcceptanceError(
                f"derivative evidence semantics drifted: {expected['candidate_id']}"
            )
        media_path = _safe_external_path(
            derivative_root,
            source["derivative_filename"],
            expected["candidate_id"],
        )
        if (
            media_path.stat().st_size != expected["derivative_bytes"]
            or _sha256_path(media_path) != expected["derivative_sha256"]
        ):
            raise MediaAcceptanceError(
                f"derivative bytes drifted: {expected['candidate_id']}"
            )
        accepted.append(
            {
                **expected,
                "dimensions": source["dimensions"],
                "mode": source["mode"],
                "source_format": source["source_format"],
                "source_frame_count": source["source_frame_count"],
                "selected_source_frame_index": source["selected_source_frame_index"],
                "selected_source_frame_type": source["selected_source_frame_type"],
                "exact_credit": source["exact_credit"],
                "license_name": source["license_name"],
                "rights_basis": source["rights_basis"],
                "change_note": source["change_note"],
                "required_commercial_notice": source["required_commercial_notice"],
                "external_evidence_locator": source["external_evidence_locator"],
                "source_rights_credit_change_note_and_notice_bound": True,
                "exact_derivative_hash_owner_visual_accepted": True,
            }
        )
    if len({row["derivative_sha256"] for row in accepted}) != 6:
        raise MediaAcceptanceError("derivative hashes are not unique")
    return accepted


def _assert_historical_media(documents: dict[str, dict[str, Any]]) -> None:
    artwork = documents["roaring_fork_artwork_derivative_approval"]
    if (
        artwork.get("summary", {}).get("approved_derivative_count") != 7
        or artwork.get("approval_gate", {}).get("derivative_user_visual_approval")
        is not True
        or artwork.get("approval_gate", {}).get("ingestion_allowed") is not False
        or artwork.get("approval_gate", {}).get("public_release") is not False
    ):
        raise MediaAcceptanceError("historical Roaring Fork artwork drifted")
    audio = documents["roaring_fork_real_audio_characterization"]
    if (
        audio.get("delivery_inventory", {}).get("entry_count") != 13
        or audio.get("release_gate", {}).get("public_release") is not False
        or audio.get("release_gate", {}).get("trusted_publication_validation")
        is not False
        or audio.get("release_gate", {}).get("publication_status")
        != "blocked_missing_publication_evidence"
    ):
        raise MediaAcceptanceError("historical Roaring Fork audio drifted")


def _accepted_audio_and_closeouts(
    qa: dict[str, Any], render_root: Path
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    if (
        qa.get("schema_version") != 1
        or qa.get("report_id") != "smokies_remaining_72_audio_qa_v1"
        or qa.get("kind")
        != "internal_external_audio_qa_and_owner_listening_selection"
        or qa.get("product_id") != PRODUCT_ID
        or qa.get("status")
        != "technical_qa_passed_owner_media_acceptance_required"
    ):
        raise MediaAcceptanceError("audio QA identity drifted")
    if qa.get("render_root", {}).get("basename") != RENDER_ROOT_BASENAME or qa.get(
        "render_root", {}
    ).get("absolute_path_serialized") is not False:
        raise MediaAcceptanceError("audio QA root privacy drifted")

    expected_aggregate = {
        "mp3_count": 72,
        "unique_audio_sha256_count": 72,
        "provider_request_count": 72,
        "provider_attempt_count": 72,
        "audio_accepted_event_count": 72,
        "request_completed_event_count": 72,
        "base_request_count": 64,
        "direction_override_request_count": 8,
        "retry_count": 0,
        "rerender_count": 0,
        "duplicate_count": 0,
        "ambiguous_response_count": 0,
        "payload_character_count": 125_595,
        "actual_locked_billable_input_character_count": 125_595,
        "actual_provider_credit_cost": 69_074,
        "actual_locked_input_usage_usd_unrounded": "12.5595",
        "actual_projected_cost_usd": "12.56",
        "dollar_cap_usd": "14.50",
        "provider_usage_reconciled": True,
        "all_keys_deleted_and_verified": True,
        "ending_provider_credits": 102_416,
        "ending_billable_request_count": 86,
        "ending_total_usage_usd": "15.20",
    }
    aggregate = qa.get("aggregate", {})
    if any(aggregate.get(key) != value for key, value in expected_aggregate.items()):
        raise MediaAcceptanceError("audio QA aggregate drifted")

    boundary = qa.get("acceptance_boundary", {})
    if boundary.get("technical_qa_complete") is not True:
        raise MediaAcceptanceError("technical audio QA is not complete")
    closed_before_acceptance = (
        "database_accessed",
        "ingestion_allowed",
        "manifest_mutation_allowed",
        "narration_revision_authorized",
        "owner_derivative_image_acceptance",
        "owner_media_acceptance",
        "production_mutation_allowed",
        "public_release",
        "publication_allowed",
        "rerender_authorized",
        "trusted_validation_allowed",
        "upload_allowed",
    )
    if any(boundary.get(key) is not False for key in closed_before_acceptance):
        raise MediaAcceptanceError("pre-acceptance audio gate drifted")

    assets = qa.get("audio_assets")
    if not isinstance(assets, list) or len(assets) != 72:
        raise MediaAcceptanceError("audio asset inventory drifted")
    accepted_assets: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_hashes: set[str] = set()
    seen_files: set[str] = set()
    for set_order, asset in enumerate(assets, start=1):
        request_id = asset.get("provider_request_id")
        audio_hash = asset.get("audio_sha256")
        master_file = asset.get("master_file")
        if (
            not isinstance(request_id, str)
            or not isinstance(audio_hash, str)
            or len(audio_hash) != 64
            or not isinstance(master_file, str)
            or request_id in seen_ids
            or audio_hash in seen_hashes
            or master_file in seen_files
        ):
            raise MediaAcceptanceError("audio identity or uniqueness drifted")
        if any(character not in "0123456789abcdef" for character in audio_hash):
            raise MediaAcceptanceError(f"invalid audio hash: {request_id}")
        seen_ids.add(request_id)
        seen_hashes.add(audio_hash)
        seen_files.add(master_file)
        if (
            asset.get("channels") != 1
            or asset.get("sample_rate_hz") != 44_100
            or asset.get("bitrate_kbps") != 128
            or asset.get("all_bytes_accounted_for") is not True
            or asset.get("provider_attempt_count") != 1
            or asset.get("retry_count") != 0
            or asset.get("rerender_count") != 0
            or asset.get("ambiguous_response") is not False
        ):
            raise MediaAcceptanceError(f"audio QA semantics drifted: {request_id}")
        media_path = _safe_external_path(render_root, master_file, request_id)
        if (
            media_path.stat().st_size != asset.get("audio_bytes")
            or _sha256_path(media_path) != audio_hash
        ):
            raise MediaAcceptanceError(f"audio bytes drifted: {request_id}")
        accepted_assets.append(
            {
                "set_order": set_order,
                "chapter_id": asset["chapter_id"],
                "stable_order_within_chapter": asset["stable_order"],
                "provider_request_id": request_id,
                "entry_id": asset["entry_id"],
                "request_kind": asset["request_kind"],
                "base_variant_id": asset["base_variant_id"],
                "override_variant_id": asset["override_variant_id"],
                "effective_variant_ids": asset["effective_variant_ids"],
                "master_file": master_file,
                "audio_bytes": asset["audio_bytes"],
                "audio_sha256": audio_hash,
                "duration_s": asset["duration_s"],
                "raw_transcript_sha256": asset["raw_transcript_sha256"],
                "normalized_transcript_sha256": asset[
                    "normalized_transcript_sha256"
                ],
                "request_fingerprint": asset["request_fingerprint"],
                "provider_credit_cost": asset["provider_credit_cost"],
                "locked_billable_input_character_count": asset[
                    "locked_billable_input_character_count"
                ],
                "technical_profile": {
                    "container": "mp3",
                    "channels": 1,
                    "sample_rate_hz": 44_100,
                    "bitrate_kbps": 128,
                    "all_bytes_accounted_for": True,
                },
            }
        )

    closeout_source = qa.get("provider_closeouts", {}).get("chapters")
    if not isinstance(closeout_source, list) or len(closeout_source) != 3:
        raise MediaAcceptanceError("provider closeout inventory drifted")
    closeouts: list[dict[str, Any]] = []
    for source, expected in zip(
        closeout_source, EXPECTED_CHAPTER_CLOSEOUTS, strict=True
    ):
        checks = {
            "chapter_id": source.get("chapter_id"),
            "request_count": source.get("provider_reported_request_count"),
            "provider_credit_cost": source.get("ledger_provider_credit_cost_total"),
            "locked_billable_input_character_count": source.get(
                "ledger_billable_input_character_count_total"
            ),
            "provider_reported_chapter_usage_usd": source.get(
                "provider_reported_chapter_usage_usd"
            ),
            "ledger_input_character_usage_usd_unrounded": source.get(
                "ledger_input_character_usage_usd_unrounded"
            ),
            "projected_chapter_cost_ceiling_usd": source.get(
                "projected_chapter_cost_ceiling_usd"
            ),
            "chapter_dollar_cap_usd": source.get("chapter_dollar_cap_usd"),
            "audio_inventory_sha256": source.get("audio_inventory_sha256"),
            "closeout_sha256": source.get("sha256"),
            "prior_closeout_sha256": source.get("prior_closeout_sha256"),
        }
        if checks != expected:
            raise MediaAcceptanceError(
                f"provider closeout drifted: {expected['chapter_id']}"
            )
        required_true = (
            "account_credit_reconciliation_passed",
            "chapter_dollar_cap_passed",
            "credit_and_input_character_meters_independent",
            "dollar_reconciliation_passed",
            "key_deleted",
            "key_deleted_before_conservative_expiry",
            "key_deletion_verified",
            "no_other_active_render_keys",
            "request_count_reconciliation_passed",
            "usage_credit_reconciliation_passed",
        )
        if any(source.get(key) is not True for key in required_true):
            raise MediaAcceptanceError(
                f"provider closeout gate drifted: {expected['chapter_id']}"
            )
        closeout_path = _safe_external_path(
            render_root, source["path"], f"{expected['chapter_id']} closeout"
        )
        if (
            closeout_path.stat().st_size != source.get("byte_count")
            or _sha256_path(closeout_path) != source.get("sha256")
        ):
            raise MediaAcceptanceError(
                f"provider closeout bytes drifted: {expected['chapter_id']}"
            )
        closeouts.append(
            {
                **expected,
                "path": source["path"],
                "byte_count": source["byte_count"],
                "starting_provider_credits": source["starting_provider_credits"],
                "ending_provider_credits": source["ending_provider_credits"],
                "starting_billable_request_count": source[
                    "starting_billable_request_count"
                ],
                "ending_billable_request_count": source[
                    "ending_billable_request_count"
                ],
                "starting_total_usage_usd": source["starting_total_usage_usd"],
                "ending_total_usage_usd": source["ending_total_usage_usd"],
                "all_reconciliations_passed": True,
                "key_deleted_and_verified_no_other_active_render_keys": True,
            }
        )

    flags = qa.get("flagged_items", {})
    listening = qa.get("representative_owner_listening_set", {})
    if (
        flags.get("flag_count") != 38
        or flags.get("counts_by_type")
        != {
            "duration_outlier": 1,
            "pacing_outlier": 2,
            "pronunciation_review": 35,
        }
        or listening.get("item_count") != 38
        or listening.get("all_flags_included") is not True
        or listening.get("owner_listening_is_representative_not_exhaustive")
        is not True
        or len(listening.get("all_flagged_provider_request_ids", [])) != 36
    ):
        raise MediaAcceptanceError("owner listening selection drifted")
    review_binding = {
        "selection_policy": listening["selection_policy"],
        "owner_listening_is_representative_not_exhaustive": True,
        "flag_count": 38,
        "unique_flagged_clip_count": 36,
        "representative_item_count": 38,
        "counts_by_type": flags["counts_by_type"],
        "all_flagged_provider_request_ids": listening[
            "all_flagged_provider_request_ids"
        ],
        "required_chapter_directions": listening["required_chapter_directions"],
        "covered_chapter_directions": listening["covered_chapter_directions"],
        "flagged_items_sha256": _canonical_sha256(flags),
        "representative_owner_listening_set_sha256": _canonical_sha256(listening),
        "approval_does_not_assert_exhaustive_listening": True,
    }
    return accepted_assets, closeouts, review_binding


def build(
    *,
    derivative_root: Path = DEFAULT_DERIVATIVE_ROOT,
    render_root: Path = DEFAULT_RENDER_ROOT,
    qa_report: Path | None = None,
) -> dict[str, Any]:
    event_bytes = DECISION_TEXT.encode("utf-8")
    if (
        len(event_bytes) != DECISION_BYTE_COUNT
        or hashlib.sha256(event_bytes).hexdigest() != DECISION_SHA256
        or not DECISION_TEXT.endswith("\n")
        or DECISION_TEXT.endswith("\r\n")
    ):
        raise MediaAcceptanceError("owner event bytes drifted")

    bindings = {
        name: _tracked_binding(name, path)
        for name, path in TRACKED_SOURCE_PATHS.items()
    }
    documents = {
        name: _load_json(path) for name, path in TRACKED_SOURCE_PATHS.items()
    }
    _assert_checkpoint2(documents["checkpoint2_owner_approval"])
    _assert_historical_media(documents)
    accepted_derivatives = _accepted_derivatives(
        documents["remaining_artwork_derivatives"], derivative_root
    )

    qa_path = qa_report if qa_report is not None else render_root / QA_FILENAME
    try:
        qa_bytes = qa_path.stat().st_size
    except OSError as error:
        raise MediaAcceptanceError("audio QA report is unavailable") from error
    if qa_bytes != QA_REPORT_BYTES or _sha256_path(qa_path) != QA_REPORT_SHA256:
        raise MediaAcceptanceError("audio QA report bytes drifted")
    qa = _load_json(qa_path)
    accepted_audio, closeouts, review_binding = _accepted_audio_and_closeouts(
        qa, render_root
    )

    derivative_hashes = [row["derivative_sha256"] for row in accepted_derivatives]
    audio_hashes = [row["audio_sha256"] for row in accepted_audio]
    return {
        "schema_version": 1,
        "overlay_id": OVERLAY_ID,
        "kind": "smokies_exact_remaining_media_owner_acceptance_overlay",
        "product_id": PRODUCT_ID,
        "recorded_at": APPROVED_AT,
        "status": (
            "exact_six_derivatives_and_72_narration_files_owner_accepted_"
            "downstream_effects_closed"
        ),
        "owner_event": {
            "approved_at": APPROVED_AT,
            "approved_at_source": "authoritative_source_task_response_item_metadata",
            "approved_by": "project_owner",
            "source_task_id": SOURCE_TASK_ID,
            "source_response_item_id": SOURCE_RESPONSE_ITEM_ID,
            "source_turn_id": SOURCE_TURN_ID,
            "source_record_type": "response_item",
            "source_payload_type": "message",
            "source_role": "user",
            "source_content_type": "input_text",
            "decision_text_verbatim": DECISION_TEXT,
            "decision_message_hash_input": "exact_utf8_bytes_including_one_trailing_lf",
            "decision_message_byte_count": DECISION_BYTE_COUNT,
            "decision_message_sha256": DECISION_SHA256,
            "ephemeral_client_or_actor_identifier_retained": False,
        },
        "normalized_approval_scope": {
            "normalization_is_separate_from_verbatim_hash_input": True,
            "exact_six_derivative_hashes_owner_visual_accepted": True,
            "exact_72_file_narration_set_owner_accepted": True,
            "bound_audio_qa_sha256": QA_REPORT_SHA256,
            "derivative_count": 6,
            "narration_file_count": 72,
            "scope_additions_inferred": False,
            "exhaustive_listening_claim_inferred": False,
            "rerender_or_revision_authority_inferred": False,
            "downstream_mutation_or_release_authority_inferred": False,
        },
        "source_revision": {
            "commit": SOURCE_COMMIT,
            "tree": SOURCE_TREE,
            "parent": SOURCE_PARENT,
            "tracked_sources_verified_at_commit": True,
            "external_media_verified_by_exact_size_and_sha256": True,
        },
        "source_bindings": {
            **bindings,
            "remaining_audio_qa": {
                "external_evidence_locator": (
                    f"{RENDER_ROOT_BASENAME}:{QA_FILENAME}"
                ),
                "absolute_path_serialized": False,
                "byte_count": QA_REPORT_BYTES,
                "sha256": QA_REPORT_SHA256,
            },
            "qa_transitive_source_bindings": qa["source_bindings"],
        },
        "accepted_derivative_images": {
            "count": 6,
            "derivative_sha256_ordered": derivative_hashes,
            "derivative_sha256_set_sha256": _canonical_sha256(derivative_hashes),
            "accepted_rows_sha256": _canonical_sha256(accepted_derivatives),
            "items": accepted_derivatives,
        },
        "accepted_narration_set": {
            "count": 72,
            "base_request_count": 64,
            "direction_override_request_count": 8,
            "audio_sha256_ordered": audio_hashes,
            "audio_sha256_set_sha256": _canonical_sha256(audio_hashes),
            "accepted_rows_sha256": _canonical_sha256(accepted_audio),
            "technical_qa_complete": True,
            "provider_request_count": 72,
            "provider_attempt_count": 72,
            "retry_count": 0,
            "rerender_count": 0,
            "duplicate_count": 0,
            "ambiguous_response_count": 0,
            "provider_credit_cost_total": 69_074,
            "locked_billable_input_character_count_total": 125_595,
            "locked_input_usage_usd_unrounded": "12.5595",
            "projected_total_cost_usd": "12.56",
            "hard_dollar_cap_usd": "14.50",
            "items": accepted_audio,
        },
        "provider_closeouts": {
            "count": 3,
            "chapter_order": [row["chapter_id"] for row in closeouts],
            "closeout_sha256_ordered": [
                row["closeout_sha256"] for row in closeouts
            ],
            "closeout_rows_sha256": _canonical_sha256(closeouts),
            "all_usage_request_credit_and_dollar_reconciliations_passed": True,
            "all_keys_deleted_verified_and_no_other_render_keys_active": True,
            "items": closeouts,
        },
        "owner_review_set_binding": review_binding,
        "protected_historical_media": {
            "roaring_fork_derivative_image_count": 7,
            "roaring_fork_narration_entry_count": 13,
            "historical_scope_reopened": False,
            "historical_evidence_rewritten_by_builder": False,
            "historical_media_bytes_regenerated": False,
            "historical_release_or_validation_gate_changed": False,
            "checkpoint2_protected_prior_evidence_preserved": True,
        },
        "acceptance_boundary": {
            "owner_derivative_image_acceptance": True,
            "owner_media_acceptance": True,
            "exact_media_acceptance_complete": True,
            "technical_qa_complete": True,
            "narration_revision_authorized": False,
            "rerender_authorized": False,
            "upload_allowed": False,
            "ingestion_allowed": False,
            "database_accessed": False,
            "database_mutation_allowed": False,
            "manifest_creation_or_mutation_allowed": False,
            "trusted_validation_allowed": False,
            "deployment_allowed": False,
            "production_mutation_allowed": False,
            "publication_allowed": False,
            "public_release": False,
            "next_action": (
                "hand_off_exact_accepted_hashes_to_the_separately_guarded_"
                "private_candidate_build_without_upload_or_state_mutation"
            ),
        },
        "builder_effects": {
            "network_accessed": False,
            "provider_accessed": False,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
            "api_keys_created_or_deleted": 0,
            "media_files_created_or_modified": 0,
            "source_evidence_files_modified": 0,
            "database_accessed": False,
            "manifest_mutated": False,
            "validation_run_created": False,
            "deployment_performed": False,
            "production_mutated": False,
            "publication_performed": False,
        },
    }


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--derivative-root", type=Path, default=DEFAULT_DERIVATIVE_ROOT)
    parser.add_argument("--render-root", type=Path, default=DEFAULT_RENDER_ROOT)
    parser.add_argument("--qa-report", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    rendered = serialize(
        build(
            derivative_root=args.derivative_root,
            render_root=args.render_root,
            qa_report=args.qa_report,
        )
    )
    if args.check:
        if not args.output.is_file() or args.output.read_text(
            encoding="utf-8"
        ) != rendered:
            raise SystemExit("Remaining media-acceptance overlay is stale; rebuild it")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
