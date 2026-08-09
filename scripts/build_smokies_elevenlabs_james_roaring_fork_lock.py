#!/usr/bin/env python3
"""Build the deterministic internal Roaring Fork James narration lock.

This lock is intentionally separate from the three-audition lock. It binds the
complete Roaring Fork editorial and delivery packet, but authorizes generation
for only the eleven assets which do not already have accepted James audio.
Public release remains explicitly out of scope.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

_BOOTSTRAP_REPOSITORY = Path(__file__).resolve().parents[1]
if str(_BOOTSTRAP_REPOSITORY) not in sys.path:
    sys.path.insert(0, str(_BOOTSTRAP_REPOSITORY))

from scripts.build_smokies_elevenlabs_james_audition_lock import (
    MODEL_ID,
    OUTPUT_FORMAT_ID,
    VOICE_ID,
    VOICE_NAME,
    VOICE_SETTINGS,
)

REPOSITORY = _BOOTSTRAP_REPOSITORY
DESTINATION = (
    REPOSITORY
    / "originals/smokies/elevenlabs_james_roaring_fork_lock_v1.json"
)
EDITORIAL_PATH = REPOSITORY / "originals/smokies/editorial_roaring_fork_v1.json"
DOSSIER_PATH = REPOSITORY / "originals/smokies/source_dossiers_v1.json"
PREFLIGHT_PATH = (
    REPOSITORY / "originals/smokies/roaring_fork_trigger_preflight_v1.json"
)
READINESS_PATH = (
    REPOSITORY / "originals/smokies/roaring_fork_delivery_readiness_v1.json"
)
AUDITION_LOCK_PATH = (
    REPOSITORY / "originals/smokies/elevenlabs_james_audition_lock_v1.json"
)

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CHAPTER_ID = "roaring_fork"
VARIANT_ID = "one_way"
CHARACTER_CAP = 18_100
KEY_CREDIT_QUOTA = 20_000
DOLLAR_CAP_USD = "2.00"
MAX_ASSUMED_USD_PER_1000_CHARACTERS = "0.10"
CONTINGENCY_PERCENT = 10
EXPECTED_VOICE_LIBRARY_RATE = "1"
EXPECTED_WITHDRAWAL_NOTICE_PERIOD = "730"
EXPECTED_VOICE_SHARING_STATUS = "copied"

GENERATION_ALLOWLIST = frozenset({
    "rf_story_01",
    "rf_story_04",
    "rf_story_05",
    "rf_story_06",
    "rf_story_07",
    "rf_cue_01",
    "rf_cue_02",
    "rf_cue_03",
    "rf_cue_04",
    "rf_cue_05",
    "rf_cue_06",
})
REUSE_ALLOWLIST = frozenset({"rf_story_02", "rf_story_03"})

S4C_AUDITION_LEDGER_SHA256 = (
    "15764fe7edc13df78614faecfaae5c3006fb0369735da4e683d378d216ba4465"
)
S4C_ACCEPTANCE_PHRASE_SHA256 = hashlib.sha256(
    b"love it continue on"
).hexdigest()
S4C_PREFLIGHT = {
    "voice_metadata_sha256": (
        "9873d1cf64317bdf61dbdcfb23c103b812c4d275b677d62e6113e7a73f61a1e7"
    ),
    "voice_settings_sha256": (
        "679f3e4ded90633b2d7a3060de485f79e276ac9eb7621263c8cd66e28204b0e4"
    ),
    "voice_library_rate": EXPECTED_VOICE_LIBRARY_RATE,
    "withdrawal_notice_period": EXPECTED_WITHDRAWAL_NOTICE_PERIOD,
    "custom_credit_multiplier": "not_reported",
}
ACCEPTED_AUDIO = {
    "rf_story_02": {
        "source_file": "01-rf_story_02.mp3",
        "audio_sha256": (
            "a0f70a05d89f2318b3f99b8580bfdb93d5e626cc696dca9614c5bf3bc078006e"
        ),
        "audio_bytes": 3_441_937,
        "duration_s": 215.118367,
        "character_cost": 1_568,
    },
    "rf_story_03": {
        "source_file": "02-rf_story_03.mp3",
        "audio_sha256": (
            "ca7ea9e8cd997ee1cf90cc0b4112f17cb8815754b6a2ccfdc0e1112e3696b1a7"
        ),
        "audio_bytes": 3_184_893,
        "duration_s": 199.053061,
        "character_cost": 1_506,
    },
}


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"expected object in {path}")
    return value


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_path(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _normalized(transcript: str) -> str:
    return " ".join(transcript.split())


def _objects_by_id(
    rows: object,
    label: str,
    identity_key: str = "id",
) -> dict[str, Mapping[str, Any]]:
    if not isinstance(rows, list):
        raise ValueError(f"{label} rows are unavailable")
    result: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError(f"{label} row is invalid")
        row_id = str(row.get(identity_key) or "")
        if not row_id or row_id in result:
            raise ValueError(f"{label} identity is invalid")
        result[row_id] = row
    return result


def _source_row(path: Path) -> dict[str, str]:
    return {
        "path": path.relative_to(REPOSITORY).as_posix(),
        "sha256": _sha256_path(path),
    }


def _validate_packet_sources(
    editorial: Mapping[str, Any],
    dossier: Mapping[str, Any],
    preflight: Mapping[str, Any],
    readiness: Mapping[str, Any],
    audition_lock: Mapping[str, Any],
) -> tuple[
    dict[str, Mapping[str, Any]],
    dict[str, Mapping[str, Any]],
    dict[str, Mapping[str, Any]],
]:
    if any((
        editorial.get("product_id") != PRODUCT_ID,
        editorial.get("chapter_id") != CHAPTER_ID,
        editorial.get("editorial_status") != "draft_review_required",
        preflight.get("product_id") != PRODUCT_ID,
        preflight.get("chapter_id") != CHAPTER_ID,
        preflight.get("variant_id") != VARIANT_ID,
        preflight.get("publication_status")
        != (
            "blocked_pending_consumer_delivery_runtime_real_audio_durations_"
            "and_fifo_validation"
        ),
        readiness.get("product_id") != PRODUCT_ID,
        readiness.get("chapter_id") != CHAPTER_ID,
        readiness.get("variant_id") != VARIANT_ID,
        readiness.get("consumer_runtime_status")
        != "ready_for_real_audio_validation",
        readiness.get("real_audio_required") is not True,
        readiness.get("authoring_estimates_accepted") is not False,
        readiness.get("preflight_sha256") != _sha256_path(PREFLIGHT_PATH),
        audition_lock.get("product_id") != PRODUCT_ID,
        audition_lock.get("lock_status") != "internal_audition_only",
    )):
        raise ValueError("Roaring Fork source contract drifted")

    cultural = dossier.get("cultural_review")
    if not isinstance(cultural, dict) or any((
        cultural.get("status") != "public_record_only",
        cultural.get("blocked_entry_ids") != [],
        "tts_rendering_of_gated_content"
        not in set(cultural.get("prohibited_until_approved") or []),
    )):
        raise ValueError("Roaring Fork cultural gate is unavailable")

    editorial_entries = _objects_by_id(editorial.get("entries"), "editorial")
    dossier_entries = _objects_by_id(dossier.get("entries"), "dossier entry")
    claims = _objects_by_id(dossier.get("claims"), "claim")
    sources = _objects_by_id(dossier.get("sources"), "source")
    preflight_entries = _objects_by_id(preflight.get("entries"), "preflight")
    audition_entries = _objects_by_id(
        audition_lock.get("auditions"),
        "accepted audition",
        "entry_id",
    )
    expected_ids = GENERATION_ALLOWLIST | REUSE_ALLOWLIST
    if any((
        set(editorial_entries) != expected_ids,
        set(preflight_entries) != expected_ids,
        not expected_ids.issubset(dossier_entries),
        not REUSE_ALLOWLIST.issubset(audition_entries),
        len(expected_ids) != 13,
        len(claims) != 47,
    )):
        raise ValueError("Roaring Fork entry inventory drifted")

    audition_profile = audition_lock.get("generation_profile")
    if not isinstance(audition_profile, dict) or any((
        audition_profile.get("provider") != "elevenlabs",
        audition_profile.get("voice_id") != VOICE_ID,
        audition_profile.get("model_id") != MODEL_ID,
        audition_profile.get("voice_settings") != VOICE_SETTINGS,
        audition_profile.get("output_policy", {}).get("format_id")
        != OUTPUT_FORMAT_ID,
    )):
        raise ValueError("Accepted audition profile drifted")

    for claim_id, claim in claims.items():
        claim_source_ids = claim.get("source_ids")
        if any((
            claim.get("status") != "source_verified",
            not isinstance(claim_source_ids, list),
            not claim_source_ids,
        )):
            raise ValueError(f"Dossier claim gate drifted: {claim_id}")
        for source_id in claim_source_ids:
            source = sources.get(str(source_id))
            if source is None or any((
                source.get("authority") != "official",
                source.get("publisher") != "National Park Service",
                source.get("role") != "story",
            )):
                raise ValueError(f"Dossier source gate drifted: {source_id}")

    stable_orders = sorted(
        int(row.get("stable_order") or 0) for row in preflight_entries.values()
    )
    if stable_orders != list(range(1, 14)):
        raise ValueError("Roaring Fork delivery order drifted")

    for entry_id, entry in editorial_entries.items():
        outline = dossier_entries[entry_id]
        delivery = preflight_entries[entry_id]
        if any((
            entry.get("script_status") != "draft_review_required",
            outline.get("script_status") != "outline_only",
            outline.get("chapter_id") != CHAPTER_ID,
            entry.get("chapter_id") != CHAPTER_ID,
            delivery.get("audio_duration_s") is not None,
            delivery.get("audio_duration_status")
            != "awaiting_immutable_rendered_asset",
            not isinstance(delivery.get("transcript_word_count"), int),
            int(delivery.get("transcript_word_count") or 0) <= 0,
        )):
            raise ValueError(f"Roaring Fork entry gate drifted: {entry_id}")
        claim_ids = entry.get("claim_ids")
        source_ids = entry.get("source_ids")
        if not isinstance(claim_ids, list) or not claim_ids:
            raise ValueError(f"Roaring Fork claims missing: {entry_id}")
        if not isinstance(source_ids, list) or not source_ids:
            raise ValueError(f"Roaring Fork sources missing: {entry_id}")
        claim_source_ids: set[str] = set()
        for claim_id in claim_ids:
            claim = claims.get(str(claim_id))
            cultural_scope = (
                claim.get("cultural_scope")
                if isinstance(claim, dict)
                else None
            )
            if claim is None or any((
                claim.get("chapter_id") != CHAPTER_ID,
                claim.get("status") != "source_verified",
                claim.get("cultural_gate") != "not_required",
                not isinstance(cultural_scope, dict),
                cultural_scope.get("classification")
                != "public_record_factual",
            )):
                raise ValueError(f"Roaring Fork claim gate drifted: {claim_id}")
            claim_source_ids.update(str(value) for value in claim["source_ids"])
        if sorted(str(value) for value in source_ids) != sorted(claim_source_ids):
            raise ValueError(f"Roaring Fork source binding drifted: {entry_id}")
        for source_id in claim_source_ids:
            source = sources.get(source_id)
            if source is None or any((
                source.get("authority") != "official",
                source.get("publisher") != "National Park Service",
                source.get("role") != "story",
            )):
                raise ValueError(f"Roaring Fork source gate drifted: {source_id}")
        if entry_id in REUSE_ALLOWLIST:
            audition = audition_entries[entry_id]
            transcript = str(entry.get("transcript") or "")
            normalized = _normalized(transcript)
            if any((
                audition.get("transcript_sha256")
                != _sha256_bytes(transcript.encode("utf-8")),
                audition.get("payload_character_count") != len(transcript),
                audition.get("normalized_character_count") != len(normalized),
            )):
                raise ValueError(
                    f"Accepted audition transcript drifted: {entry_id}"
                )
    return editorial_entries, claims, preflight_entries


def build() -> dict[str, Any]:
    editorial = _load_json(EDITORIAL_PATH)
    dossier = _load_json(DOSSIER_PATH)
    preflight = _load_json(PREFLIGHT_PATH)
    readiness = _load_json(READINESS_PATH)
    audition_lock = _load_json(AUDITION_LOCK_PATH)
    editorial_entries, claims, preflight_entries = _validate_packet_sources(
        editorial, dossier, preflight, readiness, audition_lock
    )

    entries: list[dict[str, Any]] = []
    for entry_id, delivery in sorted(
        preflight_entries.items(), key=lambda pair: int(pair[1]["stable_order"])
    ):
        source = editorial_entries[entry_id]
        transcript = str(source["transcript"])
        normalized = _normalized(transcript)
        disposition = "generate" if entry_id in GENERATION_ALLOWLIST else "reuse"
        claim_rows = [claims[str(claim_id)] for claim_id in source["claim_ids"]]
        row: dict[str, Any] = {
            "stable_order": int(delivery["stable_order"]),
            "entry_id": entry_id,
            "kind": source["kind"],
            "title": source["title"],
            "editorial_sequence": int(delivery["editorial_sequence"]),
            "delivery_mode": delivery["delivery"]["mode"],
            "generation_disposition": disposition,
            "script_status": source["script_status"],
            "raw_transcript_sha256": _sha256_bytes(transcript.encode("utf-8")),
            "normalized_transcript_sha256": _sha256_bytes(
                normalized.encode("utf-8")
            ),
            "payload_character_count": len(transcript),
            "normalized_character_count": len(normalized),
            "word_count": len(normalized.split(" ")),
            "claim_ids": list(source["claim_ids"]),
            "source_ids": list(source["source_ids"]),
            "source_gate": "source_verified",
            "cultural_gate": "not_required",
            "cultural_scope": sorted({
                str(claim["cultural_scope"]["classification"])
                for claim in claim_rows
            }),
        }
        if disposition == "generate":
            # Keep the established per-asset reservation calculation exactly.
            # Its conservative floating-point ceiling gives this corrected
            # packet the reviewed 18,016-credit bound.
            row["reserved_character_ceiling"] = math.ceil(
                len(transcript) * 1.1
            )
        else:
            row["accepted_audio"] = {
                **ACCEPTED_AUDIO[entry_id],
                "raw_transcript_sha256": row["raw_transcript_sha256"],
                "normalized_transcript_sha256": (
                    row["normalized_transcript_sha256"]
                ),
                "audition_lock_sha256": _sha256_path(AUDITION_LOCK_PATH),
                "accepted_audition_ledger_sha256": (
                    S4C_AUDITION_LEDGER_SHA256
                ),
            }
        entries.append(row)

    generated = [row for row in entries if row["generation_disposition"] == "generate"]
    reused = [row for row in entries if row["generation_disposition"] == "reuse"]
    generated_payload = sum(row["payload_character_count"] for row in generated)
    generated_normalized = sum(
        row["normalized_character_count"] for row in generated
    )
    reserved_total = sum(row["reserved_character_ceiling"] for row in generated)
    if (
        len(generated) != 11
        or len(reused) != 2
        or generated_payload != 16_373
        or generated_normalized != 16_337
        or reserved_total != 18_016
        or reserved_total > CHARACTER_CAP
    ):
        raise ValueError("Roaring Fork production budget drifted")

    source_files = sorted(
        (
            _source_row(EDITORIAL_PATH),
            _source_row(DOSSIER_PATH),
            _source_row(PREFLIGHT_PATH),
            _source_row(READINESS_PATH),
            _source_row(AUDITION_LOCK_PATH),
        ),
        key=lambda row: row["path"],
    )
    return {
        "schema_version": 1,
        "lock_id": "great_smoky_mountains_james_roaring_fork_lock_v1",
        "lock_status": "internal_production_candidate",
        "product_id": PRODUCT_ID,
        "chapter_id": CHAPTER_ID,
        "variant_id": VARIANT_ID,
        "authorization": {
            "scope": "roaring_fork_internal_narration_only",
            "user_selected_narrator": True,
            "public_release_approved": False,
            "studio_upload_approved": False,
            "other_chapters_approved": False,
        },
        "editorial_gate": {
            "source_status": "draft_review_required",
            "lock_scope": "exact_hash_bound_internal_candidate",
            "accepted_copy_changes_require_new_lock": True,
        },
        "cultural_gate": {
            "status": "passed_for_roaring_fork_public_record_factual_scope",
            "blocked_entry_ids": [],
            "ebci_public_release_gate_unchanged": True,
        },
        "narrator_acceptance": {
            "source": "direct_user_decision_in_codex_task",
            "decision": "james_selected_continue",
            "decision_phrase_sha256": S4C_ACCEPTANCE_PHRASE_SHA256,
            "accepted_audition_ledger_sha256": S4C_AUDITION_LEDGER_SHA256,
            "audition_lock_sha256": _sha256_path(AUDITION_LOCK_PATH),
            "accepted_audio_entry_ids": sorted(REUSE_ALLOWLIST),
            "accepted_audio_bindings": {
                row["entry_id"]: {
                    "raw_transcript_sha256": row["raw_transcript_sha256"],
                    "normalized_transcript_sha256": (
                        row["normalized_transcript_sha256"]
                    ),
                    "audio_sha256": row["accepted_audio"]["audio_sha256"],
                }
                for row in reused
            },
            "accepted_preflight": dict(S4C_PREFLIGHT),
        },
        "generation_profile": {
            "provider": "elevenlabs",
            "voice_id": VOICE_ID,
            "voice_name": VOICE_NAME,
            "model_id": MODEL_ID,
            "api_contract": "elevenlabs_text_to_speech_v1",
            "language_code": "en",
            "voice_settings": dict(VOICE_SETTINGS),
            "voice_settings_source": "provider_preflight_exact_match_required",
            "voice_metadata_contract": {
                "resolved_and_original_voice_id": VOICE_ID,
                "sharing_status": EXPECTED_VOICE_SHARING_STATUS,
                "voice_library_rate": EXPECTED_VOICE_LIBRARY_RATE,
                "withdrawal_notice_period": EXPECTED_WITHDRAWAL_NOTICE_PERIOD,
                "custom_credit_multiplier": "not_reported_or_one",
                "removal_state": "none",
            },
            "output": {
                "format_id": OUTPUT_FORMAT_ID,
                "container": "mp3",
                "mime_type": "audio/mpeg",
                "sample_rate_hz": 44_100,
                "bitrate_kbps": 128,
                "channels": 1,
                "provider_native_lossy_source": True,
                "lossless_or_wav_claimed": False,
                "transcoding_for_delivery": False,
            },
            "provider_retention": {
                "mode": "standard_logging",
                "zero_retention_claimed": False,
                "model_training_contribution_required": False,
            },
        },
        "budget": {
            "billing_unit": "provider_credits",
            "generated_payload_character_count": generated_payload,
            "generated_normalized_character_count": generated_normalized,
            "reserved_character_ceiling": reserved_total,
            "renderer_character_cap": CHARACTER_CAP,
            "renderer_headroom_credits": CHARACTER_CAP - reserved_total,
            "api_key_credit_quota": KEY_CREDIT_QUOTA,
            "contingency_percent": CONTINGENCY_PERCENT,
            "max_assumed_usd_per_1000_characters": (
                MAX_ASSUMED_USD_PER_1000_CHARACTERS
            ),
            "dollar_cap_usd": DOLLAR_CAP_USD,
            "rerender_budget": 0,
        },
        "aggregate": {
            "entry_count": len(entries),
            "generate_count": len(generated),
            "reuse_count": len(reused),
            "all_payload_character_count": sum(
                row["payload_character_count"] for row in entries
            ),
            "all_normalized_character_count": sum(
                row["normalized_character_count"] for row in entries
            ),
            "generated_payload_character_count": generated_payload,
            "generated_normalized_character_count": generated_normalized,
            "generated_reserved_character_ceiling": reserved_total,
        },
        "delivery_evidence": {
            "preflight_sha256": _sha256_path(PREFLIGHT_PATH),
            "readiness_sha256": _sha256_path(READINESS_PATH),
            "status": readiness["consumer_runtime_status"],
            "real_audio_validation_required": True,
            "speed_fixtures_mph": readiness["gates"]["speed_fixtures_mph"],
        },
        "entries": entries,
        "source_files": source_files,
    }


def serialize(value: Mapping[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the checked-in lock instead of writing it",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    rendered = serialize(build())
    if args.check:
        if not DESTINATION.is_file() or DESTINATION.read_text(
            encoding="utf-8"
        ) != rendered:
            raise SystemExit(
                "Roaring Fork James lock is missing or stale; rebuild it"
            )
        print(f"verified {DESTINATION.relative_to(REPOSITORY).as_posix()}")
        return 0
    DESTINATION.write_text(rendered, encoding="utf-8")
    print(f"wrote {DESTINATION.relative_to(REPOSITORY).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
