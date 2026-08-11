#!/usr/bin/env python3
"""Build network-free James narration locks for the three remaining chapters.

The checked artifacts are review inputs, not executable render authority.  They
bind every base transcript and directional replacement to the already accepted
James profile, calculate independent chapter budgets, and describe the fresh
authenticated checks that must pass later.  This builder never imports a
network, provider, database, or media-writing client.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from copy import deepcopy
from dataclasses import dataclass
from decimal import ROUND_UP, Decimal
from pathlib import Path
from typing import Any, Mapping, Sequence

_BOOTSTRAP_REPOSITORY = Path(__file__).resolve().parents[1]
if str(_BOOTSTRAP_REPOSITORY) not in sys.path:
    sys.path.insert(0, str(_BOOTSTRAP_REPOSITORY))

from scripts.build_smokies_foothills_approval import (
    build as build_foothills_approval,
)
from scripts.build_smokies_foothills_approval import (
    serialize as serialize_foothills_approval,
)

REPOSITORY = _BOOTSTRAP_REPOSITORY
ORIGINALS = REPOSITORY / "originals/smokies"

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
SCHEMA_VERSION = 1
CONTINGENCY_PERCENT = 10
MAX_ASSUMED_USD_PER_1000_CHARACTERS = Decimal("0.10")
RENDERER_CAP_INCREMENT = 100
ONE_DAY_KEY_QUOTA_INCREMENT = 5_000

DOSSIER_PATH = ORIGINALS / "source_dossiers_v1.json"
ROUTE_VARIANTS_PATH = ORIGINALS / "route_variants_v1.json"
JAMES_LOCK_PATH = ORIGINALS / "elevenlabs_james_roaring_fork_lock_v1.json"
ACCOUNT_CLAIMS_PATH = (
    ORIGINALS / "elevenlabs_james_account_claims_redacted_v1.json"
)
PROFILE_EVIDENCE_PATH = (
    ORIGINALS / "roaring_fork_narration_profile_evidence_v1.json"
)
FOOTHILLS_APPROVAL_PATH = ORIGINALS / "foothills_parkway_approval_v1.json"

BATCH_DESTINATION = (
    ORIGINALS / "elevenlabs_james_remaining_batch_preflight_v1.json"
)


@dataclass(frozen=True)
class ChapterSpec:
    chapter_id: str
    short_id: str
    editorial_path: Path
    destination: Path
    expected_base_count: int
    expected_story_count: int
    expected_cue_count: int
    expected_override_count: int
    expected_variant_ids: tuple[str, ...]
    base_variant_id: str
    script_review_status: str
    exact_scripts_user_approved: bool
    expected_entry_ids: tuple[str, ...]
    expected_override_keys: tuple[tuple[str, str], ...]
    expected_payload_character_count: int
    expected_normalized_character_count: int
    expected_word_count: int
    expected_reserved_provider_credit_ceiling: int
    expected_renderer_character_cap: int
    expected_one_day_key_credit_quota: int
    expected_dollar_cap_usd: str


CHAPTER_SPECS = (
    ChapterSpec(
        chapter_id="foothills_parkway",
        short_id="foothills_parkway",
        editorial_path=ORIGINALS / "editorial_scripts_v1.json",
        destination=(
            ORIGINALS / "elevenlabs_james_foothills_parkway_lock_v1.json"
        ),
        expected_base_count=13,
        expected_story_count=6,
        expected_cue_count=7,
        expected_override_count=3,
        expected_variant_ids=("west_to_east", "east_to_west"),
        base_variant_id="west_to_east",
        script_review_status="exact_scripts_user_approved",
        exact_scripts_user_approved=True,
        expected_entry_ids=(
            *(f"fp_story_{index:02d}" for index in range(1, 7)),
            *(f"fp_cue_{index:02d}" for index in range(1, 8)),
        ),
        expected_override_keys=(
            ("fp_cue_01", "east_to_west"),
            ("fp_cue_05", "east_to_west"),
            ("fp_cue_07", "east_to_west"),
        ),
        expected_payload_character_count=21_408,
        expected_normalized_character_count=21_369,
        expected_word_count=3_431,
        expected_reserved_provider_credit_ceiling=23_557,
        expected_renderer_character_cap=23_600,
        expected_one_day_key_credit_quota=25_000,
        expected_dollar_cap_usd="2.50",
    ),
    ChapterSpec(
        chapter_id="mountain_crossing",
        short_id="mountain_crossing",
        editorial_path=ORIGINALS / "editorial_mountain_crossing_v1.json",
        destination=(
            ORIGINALS / "elevenlabs_james_mountain_crossing_lock_v1.json"
        ),
        expected_base_count=28,
        expected_story_count=18,
        expected_cue_count=10,
        expected_override_count=5,
        expected_variant_ids=("tn_to_nc", "nc_to_tn"),
        base_variant_id="tn_to_nc",
        script_review_status="pending_combined_owner_review",
        exact_scripts_user_approved=False,
        expected_entry_ids=(
            *(f"mc_story_{index:02d}" for index in range(1, 19)),
            *(f"mc_cue_{index:02d}" for index in range(1, 11)),
        ),
        expected_override_keys=(
            ("mc_cue_01", "nc_to_tn"),
            ("mc_cue_02", "nc_to_tn"),
            ("mc_cue_04", "nc_to_tn"),
            ("mc_cue_08", "nc_to_tn"),
            ("mc_cue_09", "nc_to_tn"),
        ),
        expected_payload_character_count=59_928,
        expected_normalized_character_count=59_801,
        expected_word_count=9_499,
        expected_reserved_provider_credit_ceiling=65_938,
        expected_renderer_character_cap=66_000,
        expected_one_day_key_credit_quota=70_000,
        expected_dollar_cap_usd="7.00",
    ),
    ChapterSpec(
        chapter_id="little_river_cades_cove",
        short_id="cades_cove",
        editorial_path=ORIGINALS / "editorial_cades_cove_v1.json",
        destination=(ORIGINALS / "elevenlabs_james_cades_cove_lock_v1.json"),
        expected_base_count=23,
        expected_story_count=14,
        expected_cue_count=9,
        expected_override_count=0,
        expected_variant_ids=("sugarlands_to_cades_cove_loop",),
        base_variant_id="sugarlands_to_cades_cove_loop",
        script_review_status="pending_combined_owner_review",
        exact_scripts_user_approved=False,
        expected_entry_ids=(
            *(f"cc_story_{index:02d}" for index in (1, 2, 3, 4, 5, 6, 10, 7, 8, 9, 13, 11, 12, 14)),
            *(f"cc_cue_{index:02d}" for index in range(1, 10)),
        ),
        expected_override_keys=(),
        expected_payload_character_count=44_259,
        expected_normalized_character_count=44_158,
        expected_word_count=6_911,
        expected_reserved_provider_credit_ceiling=48_695,
        expected_renderer_character_cap=48_700,
        expected_one_day_key_credit_quota=50_000,
        expected_dollar_cap_usd="5.00",
    ),
)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"required source is unreadable: {path}") from exc
    if not isinstance(value, dict):
        raise TypeError(f"expected an object in {path}")
    return value


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_text(value: str) -> str:
    return _sha256_bytes(value.encode("utf-8"))


def _sha256_path(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _source_binding(path: Path) -> dict[str, Any]:
    return {
        "path": path.relative_to(REPOSITORY).as_posix(),
        "byte_count": path.stat().st_size,
        "sha256": _sha256_path(path),
    }


def _normalized(transcript: str) -> str:
    return " ".join(transcript.split())


def _reserve_with_ten_percent(payload_characters: int) -> int:
    # Preserve the accepted Roaring Fork renderer's conservative calculation,
    # including its possible extra credit at binary-float boundaries.
    return math.ceil(payload_characters * 1.1)


def _round_up(value: int, increment: int) -> int:
    if value <= 0 or increment <= 0:
        raise ValueError("positive value and increment required")
    return ((value + increment - 1) // increment) * increment


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_UP))


def _objects_by_id(
    rows: object,
    label: str,
    *,
    key: str = "id",
) -> dict[str, Mapping[str, Any]]:
    if not isinstance(rows, list):
        raise ValueError(f"{label} rows are unavailable")
    result: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError(f"{label} row is not an object")
        identity = str(row.get(key) or "")
        if not identity or identity in result:
            raise ValueError(f"{label} identity is missing or duplicated")
        result[identity] = row
    return result


def _accepted_james_profile(
    james_lock: Mapping[str, Any],
    profile_evidence: Mapping[str, Any],
    account_claims: Mapping[str, Any],
) -> dict[str, Any]:
    profile = james_lock.get("generation_profile")
    contract = profile_evidence.get("accepted_generator_contract")
    terms = profile_evidence.get("common_license_terms")
    if not isinstance(profile, dict) or not isinstance(contract, dict):
        raise ValueError("accepted James profile evidence is unavailable")
    if not isinstance(terms, dict):
        raise ValueError("reviewed terms baseline is unavailable")

    output = profile.get("output")
    settings = profile.get("voice_settings")
    required_profile = {
        "provider": "elevenlabs",
        "voice_id": "EkK5I93UQWFDigLMpZcX",
        "voice_name": "James - Husky, Engaging and Bold",
        "model_id": "eleven_multilingual_v2",
        "api_contract": "elevenlabs_text_to_speech_v1",
        "language_code": "en",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.5,
            "style": 0.1,
            "use_speaker_boost": True,
            "speed": 1.0,
        },
    }
    if any(profile.get(key) != value for key, value in required_profile.items()):
        raise ValueError("accepted James voice, model, or settings drifted")
    if not isinstance(output, dict) or any((
        output.get("format_id") != "mp3_44100_128",
        output.get("container") != "mp3",
        output.get("mime_type") != "audio/mpeg",
        output.get("sample_rate_hz") != 44_100,
        output.get("bitrate_kbps") != 128,
        output.get("channels") != 1,
        output.get("provider_native_lossy_source") is not True,
        output.get("transcoding_for_delivery") is not False,
    )):
        raise ValueError("accepted James output contract drifted")

    contract_comparison = {
        "provider": profile["provider"],
        "voice_id": profile["voice_id"],
        "voice_name": profile["voice_name"],
        "model_id": profile["model_id"],
        "api_version": profile["api_contract"],
        "language": profile["language_code"],
        "voice_settings": settings,
        "output_format": output["format_id"],
        "mime_type": output["mime_type"],
        "sample_rate_hz": output["sample_rate_hz"],
        "bitrate_kbps": output["bitrate_kbps"],
        "channels": output["channels"],
        "provider_native_master": output["provider_native_lossy_source"],
        "transcoded": output["transcoding_for_delivery"],
        "lossless_master_claimed": output["lossless_or_wav_claimed"],
    }
    if any(contract.get(key) != value for key, value in contract_comparison.items()):
        raise ValueError("accepted generator contract and James lock disagree")
    if any((
        profile_evidence.get("status")
        != "deterministic_profile_evidence_ready_live_write_not_authorized",
        profile_evidence.get("attestation_summary", {}).get("count") != 13,
        account_claims.get("provider") != "elevenlabs",
        account_claims.get("plan") != "creator",
        account_claims.get("account_status") != "active",
        account_claims.get("commercial_use") is not True,
        account_claims.get("output_format_id") != output["format_id"],
        terms.get("terms_id")
        != "elevenlabs_terms_of_service_non_eea_2026-03-31",
        terms.get("terms_url") != "https://elevenlabs.io/terms-of-use",
        terms.get("terms_version") != "31 March 2026",
    )):
        raise ValueError("accepted account or terms baseline drifted")
    return deepcopy(profile)


def _validate_dossier(dossier: Mapping[str, Any]) -> tuple[
    dict[str, Mapping[str, Any]],
    dict[str, Mapping[str, Any]],
    dict[str, Mapping[str, Any]],
    dict[str, Mapping[str, Any]],
]:
    if dossier.get("product_id") != PRODUCT_ID:
        raise ValueError("Smokies dossier product drifted")
    cultural = dossier.get("cultural_review")
    if not isinstance(cultural, dict) or any((
        cultural.get("status") != "public_record_only",
        cultural.get("blocked_entry_ids") != [],
        "tts_rendering_of_gated_content"
        not in set(cultural.get("prohibited_until_approved") or []),
    )):
        raise ValueError("Smokies cultural gate drifted")
    return (
        _objects_by_id(dossier.get("entries"), "dossier entry"),
        _objects_by_id(dossier.get("claims"), "dossier claim"),
        _objects_by_id(dossier.get("sources"), "dossier source"),
        _objects_by_id(dossier.get("media_candidates"), "media candidate"),
    )


def _route_rows_for_chapter(
    spec: ChapterSpec,
    route_spec: Mapping[str, Any],
) -> list[Mapping[str, Any]]:
    if any((
        route_spec.get("product_id") != PRODUCT_ID,
        route_spec.get("kind") != "trailhead_original_route_spec",
        route_spec.get("expected_variant_count") != 6,
    )):
        raise ValueError("Smokies route specification drifted")
    rows = [
        row
        for row in route_spec.get("variants", [])
        if isinstance(row, dict) and row.get("chapter_id") == spec.chapter_id
    ]
    rows.sort(key=lambda row: int(row.get("sequence") or 0))
    if tuple(str(row.get("variant_id") or "") for row in rows) != (
        spec.expected_variant_ids
    ):
        raise ValueError(f"{spec.chapter_id} route variants drifted")
    if len(rows) == 2:
        if rows[0].get("reverse_pair_id") != rows[1].get("id") or (
            rows[1].get("reverse_pair_id") != rows[0].get("id")
        ):
            raise ValueError(f"{spec.chapter_id} reverse route binding drifted")
    return rows


def _validate_foothills_approval(
    editorial_entries: Sequence[Mapping[str, Any]],
    approval: Mapping[str, Any],
) -> None:
    boundary = approval.get("approval_boundary")
    if not isinstance(boundary, dict) or any((
        approval.get("product_id") != PRODUCT_ID,
        approval.get("chapter_id") != "foothills_parkway",
        approval.get("status")
        != "exact_scripts_and_original_artwork_approved_downstream_work_blocked",
        boundary.get("foothills_exact_scripts_user_approved") is not True,
        boundary.get("foothills_narrator_approved") is not False,
        boundary.get("foothills_narration_approved") is not False,
        boundary.get("tts_or_render_authorized") is not False,
        boundary.get("narration_generated") is not False,
        boundary.get("production_mutation_allowed") is not False,
        boundary.get("public_release") is not False,
    )):
        raise ValueError("Foothills approval boundary drifted")
    approved = _objects_by_id(approval.get("approved_scripts"), "approved script")
    if set(approved) != {str(row.get("id")) for row in editorial_entries}:
        raise ValueError("Foothills approved script inventory drifted")
    for row in editorial_entries:
        entry_id = str(row["id"])
        binding = approved[entry_id]
        transcript = str(row.get("transcript") or "")
        if any((
            binding.get("exact_transcript_user_approved") is not True,
            binding.get("transcript_sha256") != _sha256_text(transcript),
            binding.get("narrator_approved") is not False,
            binding.get("tts_or_render_authorized") is not False,
            binding.get("narration_generated") is not False,
        )):
            raise ValueError(f"Foothills base approval drifted: {entry_id}")
        source_overrides = {
            str(item.get("variant_id")): item
            for item in row.get("variant_overrides", [])
            if isinstance(item, dict)
        }
        approved_overrides = {
            str(item.get("variant_id")): item
            for item in binding.get("direction_overrides", [])
            if isinstance(item, dict)
        }
        if set(source_overrides) != set(approved_overrides):
            raise ValueError(f"Foothills override approval drifted: {entry_id}")
        for variant_id, source in source_overrides.items():
            decision = approved_overrides[variant_id]
            if any((
                decision.get("exact_transcript_user_approved") is not True,
                decision.get("transcript_sha256")
                != _sha256_text(str(source.get("transcript") or "")),
                decision.get("narration_approved") is not False,
            )):
                raise ValueError(
                    f"Foothills override approval drifted: {entry_id}/{variant_id}"
                )


def _editorial_contract(
    spec: ChapterSpec,
    editorial: Mapping[str, Any],
    dossier: Mapping[str, Any],
    route_rows: Sequence[Mapping[str, Any]],
    foothills_approval: Mapping[str, Any],
) -> tuple[list[Mapping[str, Any]], dict[str, Mapping[str, Any]]]:
    dossier_entries, claims, sources, _media = _validate_dossier(dossier)
    if any((
        editorial.get("product_id") != PRODUCT_ID,
        editorial.get("chapter_id") != spec.chapter_id,
        editorial.get("editorial_status") != "draft_review_required",
        editorial.get("locale") != "en-US",
        editorial.get("dossier_sha256") != _sha256_path(DOSSIER_PATH),
    )):
        raise ValueError(f"{spec.chapter_id} editorial contract drifted")
    rows = editorial.get("entries")
    if not isinstance(rows, list) or len(rows) != spec.expected_base_count:
        raise ValueError(f"{spec.chapter_id} base inventory drifted")
    if [str(row.get("id")) for row in rows if isinstance(row, dict)] != list(
        spec.expected_entry_ids
    ):
        raise ValueError(f"{spec.chapter_id} editorial order or identity drifted")
    if sum(row.get("kind") == "story" for row in rows) != spec.expected_story_count:
        raise ValueError(f"{spec.chapter_id} story inventory drifted")
    if sum(row.get("kind") == "cue" for row in rows) != spec.expected_cue_count:
        raise ValueError(f"{spec.chapter_id} cue inventory drifted")

    variant_ids = tuple(str(row["variant_id"]) for row in route_rows)
    override_keys: set[tuple[str, str]] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError(f"{spec.chapter_id} editorial row is invalid")
        entry_id = str(row.get("id") or "")
        dossier_entry = dossier_entries.get(entry_id)
        transcript = row.get("transcript")
        claim_ids = row.get("claim_ids")
        source_ids = row.get("source_ids")
        if any((
            not entry_id,
            row.get("chapter_id") != spec.chapter_id,
            row.get("kind") not in {"story", "cue"},
            row.get("script_status") != "draft_review_required",
            not isinstance(transcript, str),
            not transcript.strip(),
            not isinstance(claim_ids, list),
            not claim_ids,
            not isinstance(source_ids, list),
            not source_ids,
            dossier_entry is None,
            dossier_entry.get("chapter_id") != spec.chapter_id,
            dossier_entry.get("script_status") != "outline_only",
            dossier_entry.get("claim_ids") != claim_ids,
        )):
            raise ValueError(f"{spec.chapter_id} editorial gate drifted: {entry_id}")
        derived_source_ids: set[str] = set()
        for claim_id in claim_ids:
            claim = claims.get(str(claim_id))
            scope = claim.get("cultural_scope") if isinstance(claim, dict) else None
            if claim is None or any((
                claim.get("chapter_id") != spec.chapter_id,
                claim.get("status") != "source_verified",
                claim.get("cultural_gate") != "not_required",
                not isinstance(scope, dict),
                scope.get("classification") != "public_record_factual",
            )):
                raise ValueError(f"source claim drifted: {claim_id}")
            claim_sources = claim.get("source_ids")
            if not isinstance(claim_sources, list) or not claim_sources:
                raise ValueError(f"claim sources drifted: {claim_id}")
            derived_source_ids.update(str(value) for value in claim_sources)
        if sorted(str(value) for value in source_ids) != sorted(derived_source_ids):
            raise ValueError(f"source binding drifted: {entry_id}")
        for source_id in derived_source_ids:
            source = sources.get(source_id)
            if source is None or any((
                source.get("authority") != "official",
                source.get("publisher") != "National Park Service",
                source.get("role") != "story",
            )):
                raise ValueError(f"official source drifted: {source_id}")
        overrides = row.get("variant_overrides", [])
        if not isinstance(overrides, list):
            raise ValueError(f"variant overrides drifted: {entry_id}")
        for override in overrides:
            if not isinstance(override, dict):
                raise ValueError(f"variant override is invalid: {entry_id}")
            variant_id = str(override.get("variant_id") or "")
            key = (entry_id, variant_id)
            if any((
                row.get("kind") != "cue",
                override.get("chapter_id") != spec.chapter_id,
                variant_id not in variant_ids,
                variant_id == spec.base_variant_id,
                key in override_keys,
                not isinstance(override.get("transcript"), str),
                not str(override.get("transcript") or "").strip(),
            )):
                raise ValueError(f"variant override drifted: {entry_id}/{variant_id}")
            override_keys.add(key)
    if override_keys != set(spec.expected_override_keys):
        raise ValueError(f"{spec.chapter_id} override inventory drifted")

    direction_review = editorial.get("direction_review")
    if len(variant_ids) == 2:
        if not isinstance(direction_review, dict) or any((
            direction_review.get("base_variant_id") != spec.base_variant_id,
            direction_review.get("reviewed_variant_ids") != list(variant_ids),
            direction_review.get("reviewed_entry_ids")
            != [str(row["id"]) for row in rows],
        )):
            raise ValueError(f"{spec.chapter_id} direction review drifted")
    elif direction_review is not None:
        raise ValueError(f"{spec.chapter_id} unexpected direction review")

    if spec.exact_scripts_user_approved:
        _validate_foothills_approval(rows, foothills_approval)
    return rows, claims


def _request_row(
    *,
    stable_order: int,
    entry: Mapping[str, Any],
    transcript: str,
    title: str,
    transcript_pointer: str,
    request_id: str,
    request_kind: str,
    base_variant_id: str,
    effective_variant_ids: Sequence[str],
    review_status: str,
    exact_script_user_approved: bool,
    override_variant_id: str | None,
) -> dict[str, Any]:
    normalized = _normalized(transcript)
    payload_characters = len(transcript)
    return {
        "stable_order": stable_order,
        "provider_request_id": request_id,
        "entry_id": str(entry["id"]),
        "request_kind": request_kind,
        "content_kind": entry["kind"],
        "title": title,
        "title_sha256": _sha256_text(title),
        "base_variant_id": base_variant_id,
        "effective_variant_ids": list(effective_variant_ids),
        "override_variant_id": override_variant_id,
        "transcript_source": transcript_pointer,
        "raw_transcript_sha256": _sha256_text(transcript),
        "normalized_transcript_sha256": _sha256_text(normalized),
        "payload_character_count": payload_characters,
        "normalized_character_count": len(normalized),
        "word_count": len(normalized.split(" ")),
        "reserved_provider_credit_ceiling": _reserve_with_ten_percent(
            payload_characters
        ),
        "reservation_rule": "ceil_each_payload_character_count_times_1_10",
        "claim_ids": list(entry["claim_ids"]),
        "source_ids": list(entry["source_ids"]),
        "source_gate": "source_verified_official_nps_public_record",
        "cultural_gate": "not_required_public_record_factual",
        "script_review_status": review_status,
        "exact_script_user_approved": exact_script_user_approved,
        "provider_request_sent": False,
        "render_authorized": False,
        "spend_authorized": False,
        "narration_generated": False,
        "accepted_audio_sha256": None,
    }


def _chapter_lock(
    spec: ChapterSpec,
    *,
    dossier: Mapping[str, Any],
    route_spec: Mapping[str, Any],
    foothills_approval: Mapping[str, Any],
    james_profile: Mapping[str, Any],
) -> dict[str, Any]:
    editorial = _load_json(spec.editorial_path)
    route_rows = _route_rows_for_chapter(spec, route_spec)
    entries, _claims = _editorial_contract(
        spec, editorial, dossier, route_rows, foothills_approval
    )
    variant_ids = [str(row["variant_id"]) for row in route_rows]

    requests: list[dict[str, Any]] = []
    override_request_ids: dict[tuple[str, str], str] = {}
    for index, entry in enumerate(entries):
        override_variant_ids = {
            str(row["variant_id"])
            for row in entry.get("variant_overrides", [])
        }
        effective_variant_ids = [
            value for value in variant_ids if value not in override_variant_ids
        ]
        requests.append(_request_row(
            stable_order=len(requests) + 1,
            entry=entry,
            transcript=str(entry["transcript"]),
            title=str(entry["title"]),
            transcript_pointer=(
                f"{spec.editorial_path.relative_to(REPOSITORY).as_posix()}"
                f"#/entries/{index}/transcript"
            ),
            request_id=f"{entry['id']}__base",
            request_kind="base_entry",
            base_variant_id=spec.base_variant_id,
            effective_variant_ids=effective_variant_ids,
            review_status=spec.script_review_status,
            exact_script_user_approved=spec.exact_scripts_user_approved,
            override_variant_id=None,
        ))

    for entry_index, entry in enumerate(entries):
        for override_index, override in enumerate(entry.get("variant_overrides", [])):
            variant_id = str(override["variant_id"])
            request_id = f"{entry['id']}__{variant_id}"
            override_request_ids[(str(entry["id"]), variant_id)] = request_id
            requests.append(_request_row(
                stable_order=len(requests) + 1,
                entry=entry,
                transcript=str(override["transcript"]),
                title=str(override.get("title") or entry["title"]),
                transcript_pointer=(
                    f"{spec.editorial_path.relative_to(REPOSITORY).as_posix()}"
                    f"#/entries/{entry_index}/variant_overrides/"
                    f"{override_index}/transcript"
                ),
                request_id=request_id,
                request_kind="directional_override",
                base_variant_id=spec.base_variant_id,
                effective_variant_ids=[variant_id],
                review_status=spec.script_review_status,
                exact_script_user_approved=spec.exact_scripts_user_approved,
                override_variant_id=variant_id,
            ))

    delivery_variants: list[dict[str, Any]] = []
    for route in route_rows:
        variant_id = str(route["variant_id"])
        selections = []
        replacements = 0
        for entry in entries:
            entry_id = str(entry["id"])
            request_id = override_request_ids.get(
                (entry_id, variant_id), f"{entry_id}__base"
            )
            if request_id != f"{entry_id}__base":
                replacements += 1
            selections.append({
                "entry_id": entry_id,
                "provider_request_id": request_id,
            })
        delivery_variants.append({
            "route_spec_id": route["id"],
            "variant_id": variant_id,
            "reverse_pair_id": route.get("reverse_pair_id"),
            "entry_count": len(selections),
            "directional_replacement_count": replacements,
            "entry_audio_request_map": selections,
        })

    payload_total = sum(row["payload_character_count"] for row in requests)
    normalized_total = sum(
        row["normalized_character_count"] for row in requests
    )
    word_total = sum(row["word_count"] for row in requests)
    reserved_total = sum(
        row["reserved_provider_credit_ceiling"] for row in requests
    )
    renderer_cap = _round_up(reserved_total, RENDERER_CAP_INCREMENT)
    key_quota = _round_up(renderer_cap, ONE_DAY_KEY_QUOTA_INCREMENT)
    projected = Decimal(payload_total) * (
        MAX_ASSUMED_USD_PER_1000_CHARACTERS / Decimal(1000)
    )
    projected_reserved = Decimal(reserved_total) * (
        MAX_ASSUMED_USD_PER_1000_CHARACTERS / Decimal(1000)
    )
    dollar_cap = Decimal(key_quota) * (
        MAX_ASSUMED_USD_PER_1000_CHARACTERS / Decimal(1000)
    )

    expected_request_count = (
        spec.expected_base_count + spec.expected_override_count
    )
    if any((
        len(requests) != expected_request_count,
        len({row["provider_request_id"] for row in requests}) != len(requests),
        len(delivery_variants) != len(spec.expected_variant_ids),
        any(row["entry_count"] != spec.expected_base_count for row in delivery_variants),
        sum(
            row["directional_replacement_count"] for row in delivery_variants
        )
        != spec.expected_override_count,
        reserved_total > renderer_cap,
        renderer_cap > key_quota,
        payload_total != spec.expected_payload_character_count,
        normalized_total != spec.expected_normalized_character_count,
        word_total != spec.expected_word_count,
        reserved_total != spec.expected_reserved_provider_credit_ceiling,
        renderer_cap != spec.expected_renderer_character_cap,
        key_quota != spec.expected_one_day_key_credit_quota,
        _money(dollar_cap) != spec.expected_dollar_cap_usd,
    )):
        raise ValueError(f"{spec.chapter_id} render-lock aggregate drifted")

    source_paths = [
        spec.editorial_path,
        DOSSIER_PATH,
        ROUTE_VARIANTS_PATH,
        JAMES_LOCK_PATH,
    ]
    if spec.exact_scripts_user_approved:
        source_paths.append(FOOTHILLS_APPROVAL_PATH)
    return {
        "schema_version": SCHEMA_VERSION,
        "lock_id": (
            f"great_smoky_mountains_elevenlabs_james_{spec.short_id}_lock_v1"
        ),
        "lock_status": "review_proposal_render_and_spend_not_authorized",
        "product_id": PRODUCT_ID,
        "chapter_id": spec.chapter_id,
        "authorization": {
            "accepted_james_profile_reused": True,
            "exact_scripts_user_approved": spec.exact_scripts_user_approved,
            "chapter_render_authorized": False,
            "provider_request_authorized": False,
            "provider_credit_spend_authorized": False,
            "api_key_creation_authorized": False,
            "network_access_authorized": False,
            "rerender_authorized": False,
            "ingestion_authorized": False,
            "upload_authorized": False,
            "database_mutation_authorized": False,
            "manifest_mutation_authorized": False,
            "production_mutation_authorized": False,
            "public_release_authorized": False,
        },
        "editorial_gate": {
            "source_status": "draft_review_required",
            "script_review_status": spec.script_review_status,
            "exact_hash_bound": True,
            "copy_or_direction_change_requires_new_lock": True,
        },
        "generation_profile": deepcopy(james_profile),
        "provider_request_contract": {
            "endpoint_contract": (
                "/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
            ),
            "body_fields": [
                "text_from_bound_source",
                "model_id",
                "language_code",
                "voice_settings",
            ],
            "request_count": len(requests),
            "attempts_per_asset": 1,
            "automatic_rerender_count": 0,
            "safe_retry_only": "provider_confirmed_uncharged_429",
            "stop_without_retry": [
                "ambiguous_timeout",
                "http_5xx",
                "invalid_http_200_audio",
                "uncertain_billing",
                "process_interruption_after_dispatch",
            ],
        },
        "budget": {
            "billing_unit": "provider_credits",
            "payload_character_count": payload_total,
            "normalized_character_count": normalized_total,
            "word_count": word_total,
            "per_asset_contingency_percent": CONTINGENCY_PERCENT,
            "reserved_provider_credit_ceiling": reserved_total,
            "renderer_character_cap": renderer_cap,
            "renderer_headroom_credits": renderer_cap - reserved_total,
            "proposed_one_day_api_key_credit_quota": key_quota,
            "key_quota_increment": ONE_DAY_KEY_QUOTA_INCREMENT,
            "max_assumed_usd_per_1000_characters": str(
                MAX_ASSUMED_USD_PER_1000_CHARACTERS
            ),
            "projected_cost_usd": _money(projected),
            "projected_reserved_cost_usd": _money(projected_reserved),
            "dollar_cap_usd": _money(dollar_cap),
            "paid_overage_authorized": False,
            "rerender_budget": 0,
            "cross_chapter_borrowing_allowed": False,
            "unused_budget_transfer_allowed": False,
            "insufficient_included_credits_behavior": "stop_before_dispatch",
        },
        "aggregate": {
            "base_entry_count": spec.expected_base_count,
            "base_story_count": spec.expected_story_count,
            "base_cue_count": spec.expected_cue_count,
            "directional_override_count": spec.expected_override_count,
            "provider_request_count": len(requests),
            "delivery_variant_count": len(delivery_variants),
        },
        "direction_delivery": {
            "base_variant_id": spec.base_variant_id,
            "reviewed_variant_ids": variant_ids,
            "directional_override_count": spec.expected_override_count,
            "variants": delivery_variants,
        },
        "requests": requests,
        "source_files": sorted(
            (_source_binding(path) for path in source_paths),
            key=lambda row: row["path"],
        ),
        "builder_effects": {
            "network_accessed": False,
            "provider_accessed": False,
            "database_accessed": False,
            "media_files_created": False,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
        },
    }


def _chapter_lock_binding(spec: ChapterSpec, lock: Mapping[str, Any]) -> dict[str, Any]:
    encoded = serialize(dict(lock)).encode("utf-8")
    return {
        "chapter_id": spec.chapter_id,
        "path": spec.destination.relative_to(REPOSITORY).as_posix(),
        "byte_count": len(encoded),
        "sha256": _sha256_bytes(encoded),
        "provider_request_count": lock["aggregate"]["provider_request_count"],
        "render_authorized": lock["authorization"]["chapter_render_authorized"],
        "spend_authorized": lock["authorization"][
            "provider_credit_spend_authorized"
        ],
    }


def _batch_preflight(
    chapter_locks: Sequence[tuple[ChapterSpec, Mapping[str, Any]]],
    *,
    route_spec: Mapping[str, Any],
    profile_evidence: Mapping[str, Any],
    account_claims: Mapping[str, Any],
) -> dict[str, Any]:
    bindings = [_chapter_lock_binding(spec, lock) for spec, lock in chapter_locks]
    budgets = [lock["budget"] for _spec, lock in chapter_locks]
    total_requests = sum(
        int(lock["aggregate"]["provider_request_count"])
        for _spec, lock in chapter_locks
    )
    total_bases = sum(
        int(lock["aggregate"]["base_entry_count"])
        for _spec, lock in chapter_locks
    )
    total_overrides = sum(
        int(lock["aggregate"]["directional_override_count"])
        for _spec, lock in chapter_locks
    )
    total_reserved = sum(
        int(budget["reserved_provider_credit_ceiling"]) for budget in budgets
    )
    total_renderer_caps = sum(
        int(budget["renderer_character_cap"]) for budget in budgets
    )
    total_key_quotas = sum(
        int(budget["proposed_one_day_api_key_credit_quota"])
        for budget in budgets
    )
    total_dollar_cap = sum(
        Decimal(str(budget["dollar_cap_usd"])) for budget in budgets
    )
    if any((
        total_requests != 72,
        total_bases != 64,
        total_overrides != 8,
        len(bindings) != 3,
        sum(
            int(lock["aggregate"]["delivery_variant_count"])
            for _spec, lock in chapter_locks
        )
        != 5,
        len(route_spec.get("variants", [])) != 6,
        profile_evidence.get("attestation_summary", {}).get("count") != 13,
    )):
        raise ValueError("remaining James batch aggregate drifted")

    terms = profile_evidence["common_license_terms"]
    chapter_budget_rows = []
    for spec, lock in chapter_locks:
        budget = lock["budget"]
        chapter_budget_rows.append({
            "chapter_id": spec.chapter_id,
            "provider_request_count": lock["aggregate"]["provider_request_count"],
            "payload_character_count": budget["payload_character_count"],
            "normalized_character_count": budget["normalized_character_count"],
            "word_count": budget["word_count"],
            "reserved_provider_credit_ceiling": budget[
                "reserved_provider_credit_ceiling"
            ],
            "renderer_character_cap": budget["renderer_character_cap"],
            "proposed_one_day_api_key_credit_quota": budget[
                "proposed_one_day_api_key_credit_quota"
            ],
            "dollar_cap_usd": budget["dollar_cap_usd"],
            "cross_chapter_borrowing_allowed": False,
            "render_authorized": False,
            "spend_authorized": False,
        })

    return {
        "schema_version": SCHEMA_VERSION,
        "preflight_id": (
            "great_smoky_mountains_elevenlabs_james_remaining_batch_"
            "preflight_v1"
        ),
        "status": "network_free_review_ready_authenticated_preflight_not_run",
        "product_id": PRODUCT_ID,
        "scope": {
            "new_chapter_count": 3,
            "new_base_entry_count": total_bases,
            "new_directional_override_count": total_overrides,
            "new_provider_request_count": total_requests,
            "existing_accepted_roaring_fork_narration_count": 13,
            "final_product_base_entry_count": 77,
            "final_product_directional_replacement_count": 8,
            "final_product_narration_asset_count": 85,
            "full_product_route_variant_count": 6,
            "new_batch_route_variant_count": 5,
            "existing_roaring_fork_route_variant_count": 1,
        },
        "authorization": {
            "owner_media_and_spend_checkpoint_complete": False,
            "authenticated_provider_preflight_authorized": False,
            "one_day_key_creation_authorized": False,
            "provider_request_authorized": False,
            "provider_credit_spend_authorized": False,
            "narration_render_authorized": False,
            "rerender_authorized": False,
            "ingestion_authorized": False,
            "upload_authorized": False,
            "database_mutation_authorized": False,
            "manifest_mutation_authorized": False,
            "production_mutation_authorized": False,
            "public_release_authorized": False,
        },
        "chapter_lock_bindings": bindings,
        "budget_isolation": {
            "policy": "three_independent_chapter_ledgers_and_one_day_keys",
            "chapter_key_count": 3,
            "key_expiry_hours": 24,
            "key_permissions": [
                "text_to_speech",
                "voices_read",
                "subscription_read",
            ],
            "cross_chapter_borrowing_allowed": False,
            "unused_budget_transfer_allowed": False,
            "paid_overage_authorized": False,
            "rerender_budget": 0,
            "chapter_budgets": chapter_budget_rows,
            "aggregate_informational_only_not_interchangeable": {
                "payload_character_count": sum(
                    int(value["payload_character_count"]) for value in budgets
                ),
                "normalized_character_count": sum(
                    int(value["normalized_character_count"])
                    for value in budgets
                ),
                "word_count": sum(int(value["word_count"]) for value in budgets),
                "reserved_provider_credit_ceiling": total_reserved,
                "renderer_character_caps": total_renderer_caps,
                "proposed_one_day_key_credit_quotas": total_key_quotas,
                "dollar_caps_usd": _money(total_dollar_cap),
            },
        },
        "direction_preflight": {
            "route_spec": _source_binding(ROUTE_VARIANTS_PATH),
            "full_product_variant_ids": [
                {
                    "chapter_id": row["chapter_id"],
                    "variant_id": row["variant_id"],
                    "route_spec_id": row["id"],
                }
                for row in route_spec["variants"]
            ],
            "new_batch_directional_replacements": [
                {
                    "chapter_id": spec.chapter_id,
                    "entry_id": request["entry_id"],
                    "variant_id": request["override_variant_id"],
                    "provider_request_id": request["provider_request_id"],
                    "raw_transcript_sha256": request["raw_transcript_sha256"],
                }
                for spec, lock in chapter_locks
                for request in lock["requests"]
                if request["request_kind"] == "directional_override"
            ],
            "replacement_count": total_overrides,
            "all_directional_transcripts_hash_bound": True,
            "real_audio_duration_validation_required_after_render": True,
        },
        "accepted_profile_baseline": {
            "production_lock": _source_binding(JAMES_LOCK_PATH),
            "profile_evidence": _source_binding(PROFILE_EVIDENCE_PATH),
            "provider_account_claims_redacted": _source_binding(
                ACCOUNT_CLAIMS_PATH
            ),
            "provider": "elevenlabs",
            "voice_id": "EkK5I93UQWFDigLMpZcX",
            "voice_name": "James - Husky, Engaging and Bold",
            "model_id": "eleven_multilingual_v2",
            "output_format_id": "mp3_44100_128",
            "plan_last_observed": account_claims["plan"],
            "commercial_use_last_observed": account_claims["commercial_use"],
            "terms_last_reviewed": {
                "terms_id": terms["terms_id"],
                "terms_url": terms["terms_url"],
                "terms_version": terms["terms_version"],
                "reviewed_at": terms["reviewed_at"],
                "jurisdiction": "non_eea",
            },
            "point_in_time_only": True,
            "fresh_authenticated_recheck_required": True,
        },
        "fresh_authenticated_preflight_required": {
            "status": "not_performed_by_network_free_builder",
            "must_match_before_any_provider_request": [
                "active_creator_or_equivalent_paid_plan_with_commercial_use",
                "non_beta_james_voice_identity_and_availability",
                "exact_voice_model_settings_and_native_output_format",
                "current_non_eea_terms_tuple_and_distribution_rights",
                "available_included_credits_at_or_above_each_chapter_renderer_cap",
                "paid_overage_disabled_or_not_used",
                "one_separate_restricted_one_day_key_per_chapter",
                "zero_existing_or_ambiguous_requests_in_each_chapter_ledger",
            ],
            "terms_or_account_drift_behavior": "stop_for_fresh_owner_review",
            "insufficient_credit_behavior": "stop_without_cross_chapter_borrowing",
            "unknown_provider_response_behavior": (
                "retain_reservation_stop_and_reconcile_without_retry"
            ),
        },
        "builder_effects": {
            "network_accessed": False,
            "provider_accessed": False,
            "database_accessed": False,
            "media_files_created": False,
            "api_keys_created": 0,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
        },
    }


def build_all() -> dict[Path, dict[str, Any]]:
    """Return all four exact artifacts or fail closed on any source drift."""
    dossier = _load_json(DOSSIER_PATH)
    route_spec = _load_json(ROUTE_VARIANTS_PATH)
    foothills_approval = _load_json(FOOTHILLS_APPROVAL_PATH)
    expected_foothills_approval = build_foothills_approval()
    if foothills_approval != expected_foothills_approval or (
        FOOTHILLS_APPROVAL_PATH.read_text(encoding="utf-8")
        != serialize_foothills_approval(expected_foothills_approval)
    ):
        raise ValueError("Foothills approval overlay is stale or non-deterministic")
    james_lock = _load_json(JAMES_LOCK_PATH)
    profile_evidence = _load_json(PROFILE_EVIDENCE_PATH)
    account_claims = _load_json(ACCOUNT_CLAIMS_PATH)
    james_profile = _accepted_james_profile(
        james_lock, profile_evidence, account_claims
    )

    chapter_locks = [
        (
            spec,
            _chapter_lock(
                spec,
                dossier=dossier,
                route_spec=route_spec,
                foothills_approval=foothills_approval,
                james_profile=james_profile,
            ),
        )
        for spec in CHAPTER_SPECS
    ]
    result = {spec.destination: lock for spec, lock in chapter_locks}
    result[BATCH_DESTINATION] = _batch_preflight(
        chapter_locks,
        route_spec=route_spec,
        profile_evidence=profile_evidence,
        account_claims=account_claims,
    )
    return result


def serialize(payload: dict[str, Any]) -> str:
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
    artifacts = build_all()
    if args.check:
        stale = []
        for path, payload in artifacts.items():
            expected = serialize(payload)
            try:
                actual = path.read_text(encoding="utf-8")
            except OSError:
                stale.append(path.relative_to(REPOSITORY).as_posix())
                continue
            if actual != expected:
                stale.append(path.relative_to(REPOSITORY).as_posix())
        if stale:
            raise SystemExit(
                "remaining James narration lock artifacts are missing or stale: "
                + ", ".join(stale)
            )
        for path in artifacts:
            print(f"verified {path.relative_to(REPOSITORY).as_posix()}")
        return

    for path, payload in artifacts.items():
        path.write_text(serialize(payload), encoding="utf-8")
        print(path.relative_to(REPOSITORY).as_posix())


if __name__ == "__main__":
    main()
