#!/usr/bin/env python3
"""Build the offline Roaring Fork narration-profile evidence slice.

This builder is deliberately network-free and mutation-free. It binds the
accepted James narration lock, characterized and imported bytes, the immutable
private-import receipt, a redacted production readback, and thirteen
server-owned license-attestation hashes into a standalone profile plus evidence
overlay. It never writes the profile into the live draft and never rewrites the
historical packet, receipt, or Manifest V3.
"""

from __future__ import annotations

import argparse
import copy
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from dashboard.server import OriginalNarrationProfileV2  # noqa: E402
from db.original_manifest_v3 import normalize_original_manifest_v3  # noqa: E402
from db.store import _normalize_original_manifest_v1  # noqa: E402


ORIGINALS = REPOSITORY / "originals/smokies"
PROFILE_OUTPUT_PATH = ORIGINALS / "roaring_fork_narration_profile_v2.json"
EVIDENCE_OUTPUT_PATH = (
    ORIGINALS / "roaring_fork_narration_profile_evidence_v1.json"
)

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CHAPTER_ID = "roaring_fork"
VARIANT_ID = "one_way"
EVIDENCE_ID = "smokies_roaring_fork_narration_profile_evidence_20260810_v1"
LIVE_READBACK_OBSERVED_AT = "2026-08-10T20:37:52Z"
LIVE_MANIFEST_PROBE_ENSURE_ASCII_SHA256 = (
    "14523eab8c50c976b0bfc5598851d6c3c639b6541a7f81a7944f1e297ba17f81"
)
STORE_BASE_MANIFEST_CANONICAL_SHA256 = (
    "2fb77582811e28ef963f3018a8990a96612cfedee69f3b2329a73b87ac99d33a"
)
PROFILE_VERIFIED_AT = "2026-08-10T20:19:19Z"
ACCOUNT_CONFIRMED_AT = "2026-08-09T04:55:00Z"

ACCOUNT_SOURCE_SHA256 = (
    "90d963e93f4089acb228e717773ce2504f51c59fe3f4bae11d1dda586e8b31dd"
)
ACCOUNT_EVIDENCE_SHA256 = (
    "66abe3286df521222a936a7b260198352bc22a3c87d1485d172c1e03ca1715f4"
)
ACCOUNT_CLAIMS_REDACTED_SHA256 = (
    "a25244c99f5a23db859579b59318155a243418f24ad8b5e0e93f268757bdacc1"
)
AUDITION_LEDGER_SHA256 = (
    "15764fe7edc13df78614faecfaae5c3006fb0369735da4e683d378d216ba4465"
)
CHAPTER_RENDER_LEDGER_SHA256 = (
    "15537c5af0d351d4eb4102139bd6b1a0452075963e305242d1394a59e3db5804"
)


@dataclass(frozen=True)
class SourceSpec:
    path: Path
    byte_count: int
    sha256: str


SOURCE_SPECS = {
    "provider_account_claims_redacted": SourceSpec(
        ORIGINALS / "elevenlabs_james_account_claims_redacted_v1.json",
        706,
        ACCOUNT_CLAIMS_REDACTED_SHA256,
    ),
    "production_narration_lock": SourceSpec(
        ORIGINALS / "elevenlabs_james_roaring_fork_lock_v1.json",
        19_132,
        "4f8b2d9df467de6af3d5622dac10caae7c165d924e36449de30d507812ba7e3b",
    ),
    "real_audio_characterization": SourceSpec(
        ORIGINALS / "roaring_fork_real_audio_characterization_v1.json",
        18_883,
        "f34b7aa8df6c5270f7b93f98a5bb720cf9c95df7fc1751eaeb1c6b6899529d1b",
    ),
    "private_import_packet": SourceSpec(
        ORIGINALS / "roaring_fork_private_import_packet_v1.json",
        123_112,
        "15d3a10b3a387cd23e1271e2d07428772d8f60e4568cbd417ef292d627252c1f",
    ),
    "private_import_receipt": SourceSpec(
        ORIGINALS / "roaring_fork_private_import_receipt_v1.json",
        5_307,
        "8890c1e1431654a03feb1aa4ee4376ab50504e9841b4d8a06f0a3c003b0ebefd",
    ),
    "private_manifest_v3": SourceSpec(
        ORIGINALS / "roaring_fork_private_manifest_v3.json",
        171_413,
        "7e9cab7e0325c6124a2605c83867929780f575e5814c7fdc634c091a9c351467",
    ),
}

EXPECTED_ASSET_SHA256 = {
    "rf_audio_cue_01": "d3e0796c436e4ffedb748bc08007f0661cea683eda3204df48b3639f70658bed",
    "rf_audio_cue_02": "6c99af44807f3fb78435f04da91ecc234e2c2e8f682df44ed943173a48bff107",
    "rf_audio_cue_03": "97236ccc1148d8f73d6cb20dc5447c9155bdcb4e825fbcae452007af5d12ae6c",
    "rf_audio_cue_04": "673941fe546cd1801e27d6dc9789c30ade0fc2dbe52050944cfa67a7974156c3",
    "rf_audio_cue_05": "a179f23a534976308e4fbfc20f45a428fe7f4e1bc1fd798be84e5e94cae67f1a",
    "rf_audio_cue_06": "0afae81566cf0a1ce1b220dfbe7c87b12d48235f7b3ec4149f5b9fba61a1539b",
    "rf_audio_story_01": "b9f0a21bd1afbfff8a1472e367502d50d931e339214e9cc5da01b7ba12e3e73c",
    "rf_audio_story_02": "a0f70a05d89f2318b3f99b8580bfdb93d5e626cc696dca9614c5bf3bc078006e",
    "rf_audio_story_03": "ca7ea9e8cd997ee1cf90cc0b4112f17cb8815754b6a2ccfdc0e1112e3696b1a7",
    "rf_audio_story_04": "89b8d5bb8c56e2ec15ce2e6ad82cdf298555edce4906bf2c51dcb1b91b26f4e4",
    "rf_audio_story_05": "879442f4087fb7d3fc9bf37f972eb750c17bfe33cd914a3aa9eea91c46985258",
    "rf_audio_story_06": "3bf8872d360e8e1850e7699171ec53944ca8da6f128b14d94bfd7a4613f0f4f6",
    "rf_audio_story_07": "2af7d496eb6aef7b58f585a382ec1deba301a83878c824df5b572dec6009340d",
}

ATTESTATION_ROWS = (
    ("rf_audio_cue_01", "2026-08-10T20:05:07Z"),
    ("rf_audio_cue_02", "2026-08-10T20:17:48Z"),
    ("rf_audio_cue_03", "2026-08-10T20:18:18Z"),
    ("rf_audio_cue_04", "2026-08-10T20:18:39Z"),
    ("rf_audio_cue_05", "2026-08-10T20:18:42Z"),
    ("rf_audio_cue_06", "2026-08-10T20:18:46Z"),
    ("rf_audio_story_01", "2026-08-10T20:18:55Z"),
    ("rf_audio_story_02", "2026-08-10T20:18:58Z"),
    ("rf_audio_story_03", "2026-08-10T20:19:02Z"),
    ("rf_audio_story_04", "2026-08-10T20:19:09Z"),
    ("rf_audio_story_05", "2026-08-10T20:19:12Z"),
    ("rf_audio_story_06", "2026-08-10T20:19:14Z"),
    ("rf_audio_story_07", "2026-08-10T20:19:19Z"),
)
ATTESTATION_SET_CANONICAL_SHA256 = (
    "465665e7313d661bb1ce6dcc79b3b41e0d89a5385fed204656fab29c126c5003"
)

COMMON_TERMS = {
    "terms_id": "elevenlabs_terms_of_service_non_eea_2026-03-31",
    "terms_url": "https://elevenlabs.io/terms-of-use",
    "terms_version": "31 March 2026",
    "reviewed_at": "2026-08-10",
}

VOICE_SETTINGS = {
    "similarity_boost": 0.5,
    "speed": 1.0,
    "stability": 0.5,
    "style": 0.1,
    "use_speaker_boost": True,
}


class NarrationProfileEvidenceError(ValueError):
    """A bound source or deterministic profile assertion drifted."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise NarrationProfileEvidenceError(message)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise NarrationProfileEvidenceError(
            f"unavailable JSON input: {path}"
        ) from error
    if not isinstance(value, dict):
        raise NarrationProfileEvidenceError(f"expected JSON object: {path}")
    return value


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise NarrationProfileEvidenceError(
            f"unavailable source input: {path}"
        ) from error
    return digest.hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
    )


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def _verified_sources() -> dict[str, dict[str, Any]]:
    values: dict[str, dict[str, Any]] = {}
    for name, spec in SOURCE_SPECS.items():
        _require(spec.path.is_file(), f"{name} source is unavailable")
        _require(
            spec.path.stat().st_size == spec.byte_count,
            f"{name} byte count drifted",
        )
        _require(_sha256_path(spec.path) == spec.sha256, f"{name} SHA-256 drifted")
        values[name] = _load_json(spec.path)
    return values


def _validate_provider_account_evidence(
    sources: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    account = sources["provider_account_claims_redacted"]
    _require(
        set(account)
        == {
            "schema_version",
            "provider",
            "source",
            "observed_at",
            "plan",
            "account_status",
            "commercial_use",
            "model_training_contribution",
            "standard_logging_acknowledged",
            "output_format_id",
            "zero_retention",
            "private_source",
            "omitted_field_groups",
        },
        "redacted account-claim fields drifted",
    )
    _require(account.get("schema_version") == 1, "account evidence schema drifted")
    _require(account.get("provider") == "elevenlabs", "account provider drifted")
    _require(
        account.get("source") == "authenticated_browser",
        "account evidence source drifted",
    )
    _require(
        account.get("observed_at") == ACCOUNT_CONFIRMED_AT,
        "account evidence observed_at drifted",
    )
    _require(account.get("plan") == "creator", "account plan drifted")
    _require(account.get("account_status") == "active", "account status drifted")
    _require(account.get("commercial_use") is True, "commercial-use evidence drifted")
    _require(
        account.get("model_training_contribution") is False,
        "training-contribution evidence drifted",
    )
    _require(
        account.get("standard_logging_acknowledged") is True,
        "standard-logging evidence drifted",
    )
    _require(
        account.get("output_format_id") == "mp3_44100_128",
        "account output-format evidence drifted",
    )
    _require(
        account.get("zero_retention") is False,
        "zero-retention evidence drifted",
    )
    _require(
        account.get("private_source")
        == {
            "byte_count": 885,
            "sha256": ACCOUNT_EVIDENCE_SHA256,
            "browser_source_sha256": ACCOUNT_SOURCE_SHA256,
        },
        "private account-source binding drifted",
    )
    _require(
        account.get("omitted_field_groups")
        == [
            "available_credit_balance",
            "overage_and_billing_controls",
            "api_key_policy",
        ],
        "redacted account omission list drifted",
    )
    redacted_serialized = _canonical_json(account).lower()
    for forbidden in (
        "admin_user_id",
        "access_token",
        "refresh_token",
        "authorization",
        "bearer ",
    ):
        _require(
            forbidden not in redacted_serialized,
            f"redacted account evidence exposes {forbidden}",
        )
    return account


def _narration_maps(
    sources: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    lock = sources["production_narration_lock"]
    characterization = sources["real_audio_characterization"]
    packet = sources["private_import_packet"]
    receipt = sources["private_import_receipt"]
    manifest = sources["private_manifest_v3"]

    _require(lock.get("lock_status") == "internal_production_candidate", "lock status drifted")
    _require(lock.get("chapter_id") == CHAPTER_ID, "lock chapter drifted")
    _require(lock.get("variant_id") == VARIANT_ID, "lock variant drifted")
    _require(lock.get("aggregate", {}).get("entry_count") == 13, "lock count drifted")
    generation = lock.get("generation_profile")
    _require(isinstance(generation, dict), "lock generation profile is invalid")
    _require(generation.get("provider") == "elevenlabs", "lock provider drifted")
    _require(
        generation.get("voice_id") == "EkK5I93UQWFDigLMpZcX",
        "lock voice drifted",
    )
    _require(
        generation.get("voice_name") == "James - Husky, Engaging and Bold",
        "lock voice name drifted",
    )
    _require(
        generation.get("model_id") == "eleven_multilingual_v2",
        "lock model drifted",
    )
    _require(
        generation.get("api_contract") == "elevenlabs_text_to_speech_v1",
        "lock API contract drifted",
    )
    _require(generation.get("language_code") == "en", "lock language drifted")
    _require(generation.get("voice_settings") == VOICE_SETTINGS, "voice settings drifted")
    _require(
        lock.get("narrator_acceptance", {}).get("accepted_audition_ledger_sha256")
        == AUDITION_LEDGER_SHA256,
        "accepted audition ledger binding drifted",
    )
    _require(
        generation.get("provider_retention")
        == {
            "mode": "standard_logging",
            "model_training_contribution_required": False,
            "zero_retention_claimed": False,
        },
        "provider retention evidence drifted",
    )
    output = generation.get("output")
    _require(
        output
        == {
            "bitrate_kbps": 128,
            "channels": 1,
            "container": "mp3",
            "format_id": "mp3_44100_128",
            "lossless_or_wav_claimed": False,
            "mime_type": "audio/mpeg",
            "provider_native_lossy_source": True,
            "sample_rate_hz": 44_100,
            "transcoding_for_delivery": False,
        },
        "lock output contract drifted",
    )

    source_binding = characterization.get("source_bindings", {}).get(
        "production_narration_lock", {}
    )
    _require(
        source_binding.get("sha256")
        == SOURCE_SPECS["production_narration_lock"].sha256,
        "characterization lock binding drifted",
    )
    renderer = characterization.get("renderer_evidence")
    _require(isinstance(renderer, dict), "renderer evidence is invalid")
    _require(renderer.get("asset_count") == 13, "renderer asset count drifted")
    _require(
        renderer.get("render_ledger", {}).get("sha256")
        == CHAPTER_RENDER_LEDGER_SHA256,
        "chapter render ledger binding drifted",
    )
    _require(renderer.get("provider") == "elevenlabs", "renderer provider drifted")
    _require(
        renderer.get("model_id") == "eleven_multilingual_v2",
        "renderer model drifted",
    )
    _require(
        renderer.get("voice_id") == "EkK5I93UQWFDigLMpZcX",
        "renderer voice drifted",
    )
    _require(
        renderer.get("output_format_id") == "mp3_44100_128",
        "renderer output drifted",
    )

    packet_rows = [
        row for row in packet.get("assets", []) if row.get("kind") == "narration"
    ]
    _require(len(packet_rows) == 13, "packet narration count drifted")
    packet_by_asset = {row["asset_id"]: row for row in packet_rows}
    _require(len(packet_by_asset) == 13, "packet narration ids are not unique")
    _require(
        set(packet_by_asset) == set(EXPECTED_ASSET_SHA256),
        "packet narration membership drifted",
    )

    characterization_by_entry = {
        row["entry_id"]: row for row in renderer.get("assets", [])
    }
    lock_by_entry = {row["entry_id"]: row for row in lock.get("entries", [])}
    _require(len(characterization_by_entry) == 13, "characterization identities drifted")
    _require(len(lock_by_entry) == 13, "lock identities drifted")

    receipt_assets = receipt.get("assets")
    _require(isinstance(receipt_assets, dict), "receipt asset summary is invalid")
    receipt_rows = receipt_assets.get("verified_sha256", [])
    receipt_by_asset = {
        row["asset_id"]: row["sha256"]
        for row in receipt_rows
        if str(row.get("asset_id", "")).startswith("rf_audio_")
    }
    _require(receipt_by_asset == EXPECTED_ASSET_SHA256, "receipt narration map drifted")
    _require(
        receipt.get("packet_sha256") == SOURCE_SPECS["private_import_packet"].sha256,
        "receipt packet binding drifted",
    )
    _require(
        receipt.get("status") == "verified_configured_private_import",
        "receipt status drifted",
    )

    manifest_by_asset = {
        row["id"]: row
        for row in manifest.get("assets", [])
        if row.get("kind") == "narration"
    }
    _require(len(manifest_by_asset) == 13, "manifest narration count drifted")
    _require(
        set(manifest_by_asset) == set(EXPECTED_ASSET_SHA256),
        "manifest narration membership drifted",
    )
    _require("narration_profile" not in manifest, "historical manifest was rewritten")

    for asset_id, expected_sha256 in EXPECTED_ASSET_SHA256.items():
        packet_row = packet_by_asset[asset_id]
        entry_id = packet_row.get("entry_id")
        characterized = characterization_by_entry.get(entry_id)
        locked = lock_by_entry.get(entry_id)
        _require(characterized is not None, f"{asset_id} characterization is missing")
        _require(locked is not None, f"{asset_id} lock identity is missing")
        _require(packet_row.get("sha256") == expected_sha256, f"{asset_id} packet SHA drifted")
        _require(
            characterized.get("audio_sha256") == expected_sha256,
            f"{asset_id} characterized SHA drifted",
        )
        _require(
            manifest_by_asset[asset_id].get("sha256") == expected_sha256,
            f"{asset_id} manifest SHA drifted",
        )
        _require(
            packet_row.get("transcript_sha256")
            == locked.get("normalized_transcript_sha256"),
            f"{asset_id} transcript binding drifted",
        )
        _require(
            packet_row.get("bytes") == characterized.get("audio_bytes"),
            f"{asset_id} byte count drifted",
        )
        _require(
            packet_row.get("generator")
            == {
                "admin_license_attestation_required": True,
                "lossless_master_claimed": False,
                "model_id": "eleven_multilingual_v2",
                "output_format": "mp3_44100_128",
                "provider": "elevenlabs",
                "provider_native_master": True,
                "transcoded": False,
                "voice_id": "EkK5I93UQWFDigLMpZcX",
            },
            f"{asset_id} generator provenance drifted",
        )
        _require(
            packet_row.get("media")
            == {
                "bitrate_kbps": 128,
                "channels": 1,
                "duration_s": characterized.get("probed_duration_s"),
                "format": "mp3",
                "sample_rate_hz": 44_100,
            },
            f"{asset_id} media evidence drifted",
        )

    _require(
        sum(row["bytes"] for row in packet_rows) == 26_184_875,
        "aggregate narration bytes drifted",
    )
    _require(
        renderer.get("total_audio_bytes") == 26_184_875,
        "characterized aggregate narration bytes drifted",
    )
    return packet_by_asset, characterization_by_entry


def _validate_historical_fail_closed_state(
    sources: dict[str, dict[str, Any]],
) -> None:
    packet = sources["private_import_packet"]
    receipt = sources["private_import_receipt"]
    manifest = sources["private_manifest_v3"]
    _require(
        packet.get("manifest", {}).get("narration_profile_status")
        == "awaiting_real_admin_license_attestation",
        "historical packet narration-profile status drifted",
    )
    _require(
        packet.get("generator_license_attestation", {}).get("byte_import_license_status")
        == "unverified",
        "historical packet license state drifted",
    )
    for gate in (
        "live_admin_attestation_complete",
        "verified_private_upload_complete",
        "authenticated_device_preview_complete",
        "trusted_publication_validation_complete",
        "public_release",
    ):
        _require(packet.get("gates", {}).get(gate) is False, f"packet gate opened: {gate}")
    _require(
        receipt.get("narration_license", {}).get("status") == "unverified",
        "historical receipt license state drifted",
    )
    _require(
        receipt.get("manifest_canonical_sha256")
        == STORE_BASE_MANIFEST_CANONICAL_SHA256,
        "historical receipt manifest hash drifted",
    )
    for gate in (
        "admin_license_attestation_complete",
        "verified_private_upload_complete",
        "authenticated_device_preview_complete",
        "trusted_publication_validation_complete",
        "public_release",
    ):
        _require(receipt.get("gates", {}).get(gate) is False, f"receipt gate opened: {gate}")
    _require("narration_profile" not in manifest, "historical Manifest V3 was rewritten")


def _validated_attestations(
    packet_by_asset: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    canonical_rows = [
        {
            "asset_id": asset_id,
            "attested_at": attested_at,
            "redacted_attestation_sha256": _canonical_sha256(
                {**COMMON_TERMS, "attested_at": attested_at}
            ),
        }
        for asset_id, attested_at in ATTESTATION_ROWS
    ]
    _require(
        _canonical_sha256(canonical_rows) == ATTESTATION_SET_CANONICAL_SHA256,
        "live attestation set drifted",
    )
    _require(len(canonical_rows) == 13, "live attestation count drifted")
    _require(
        {row["asset_id"] for row in canonical_rows} == set(EXPECTED_ASSET_SHA256),
        "live attestation membership drifted",
    )
    _require(
        len({row["redacted_attestation_sha256"] for row in canonical_rows}) == 13,
        "live redacted attestation hashes are not unique",
    )
    for row in canonical_rows:
        _require(
            re.fullmatch(r"[0-9a-f]{64}", row["redacted_attestation_sha256"])
            is not None,
            f"{row['asset_id']} redacted attestation hash is invalid",
        )
        parsed = datetime.fromisoformat(row["attested_at"].replace("Z", "+00:00"))
        _require(parsed.tzinfo is not None, f"{row['asset_id']} attested_at is naive")
    _require(
        max(row["attested_at"] for row in canonical_rows) == PROFILE_VERIFIED_AT,
        "profile verified_at is not the latest live attestation",
    )

    result = []
    for row in canonical_rows:
        packet_row = packet_by_asset[row["asset_id"]]
        result.append(
            {
                **row,
                "entry_id": packet_row["entry_id"],
                "narration_sha256": EXPECTED_ASSET_SHA256[row["asset_id"]],
                "stable_order": packet_row["stable_order"],
            }
        )
    return result


def build_profile() -> dict[str, Any]:
    return {
        "schema_version": 2,
        "provider": "elevenlabs",
        "voice_id": "EkK5I93UQWFDigLMpZcX",
        "model_snapshot": "eleven_multilingual_v2",
        "api_version": "elevenlabs_text_to_speech_v1",
        "language": "en",
        "generation": {
            "output_format": "mp3_44100_128",
            "mime_type": "audio/mpeg",
            "sample_rate_hz": 44_100,
            "bitrate_kbps": 128,
            "channels": 1,
            "provider_native": True,
            "lossless": False,
        },
        "archival_master": {
            "mime_type": "audio/mpeg",
            "sample_rate_hz": 44_100,
            "bitrate_kbps": 128,
            "channels": 1,
            "provider_native": True,
            "immutable": True,
            "lossless": False,
        },
        "mobile_delivery": {
            "mime_type": "audio/mpeg",
            "sample_rate_hz": 44_100,
            "bitrate_kbps": 128,
            "channels": 1,
            "lossless": False,
            "transcoded": False,
            "byte_identical_to_archival_master": True,
        },
        "commercial_license": {
            "status": "verified",
            "plan": "creator",
            "commercial_use_allowed": True,
            **COMMON_TERMS,
            "verified_at": PROFILE_VERIFIED_AT,
        },
        "training_contribution": {
            "status": "disabled",
            "confirmed_at": ACCOUNT_CONFIRMED_AT,
        },
        "provider_data_retention": {
            "status": "provider_standard",
            "zero_retention": False,
            "confirmed_at": ACCOUNT_CONFIRMED_AT,
        },
    }


def _validate_profile_on_manifest(
    profile: dict[str, Any],
    source_manifest: dict[str, Any],
) -> dict[str, Any]:
    original = copy.deepcopy(source_manifest)
    validated = OriginalNarrationProfileV2.model_validate(
        copy.deepcopy(profile)
    ).model_dump(mode="json", exclude_none=True)
    _require(validated == profile, "server Pydantic profile normalization drifted")

    baseline, _ = normalize_original_manifest_v3(
        copy.deepcopy(source_manifest),
        pack_id=PRODUCT_ID,
        title=str(source_manifest["title"]),
        version=None,
        normalize_v1=_normalize_original_manifest_v1,
        publishing=False,
    )
    enriched_source = copy.deepcopy(source_manifest)
    enriched_source["narration_profile"] = copy.deepcopy(profile)
    enriched, encoded = normalize_original_manifest_v3(
        enriched_source,
        pack_id=PRODUCT_ID,
        title=str(source_manifest["title"]),
        version=None,
        normalize_v1=_normalize_original_manifest_v1,
        publishing=False,
    )
    _require(source_manifest == original, "source Manifest V3 was mutated in memory")
    _require(enriched.get("narration_profile") == profile, "V3 profile normalization drifted")
    without_profile = copy.deepcopy(enriched)
    without_profile.pop("narration_profile", None)
    _require(
        without_profile == baseline,
        "V3 profile slice changed fields outside narration_profile",
    )
    return {
        "normalized_manifest_with_profile_canonical_sha256": hashlib.sha256(
            encoded.encode("utf-8")
        ).hexdigest(),
        "normalized_manifest_with_profile_byte_count": len(encoded.encode("utf-8")),
        "profile_schema": "OriginalNarrationProfileV2",
        "server_pydantic_validated": True,
        "v3_normalization_validated_on_copy": True,
        "source_manifest_mutated": False,
    }


def build_bundle() -> tuple[dict[str, Any], dict[str, Any]]:
    sources = _verified_sources()
    account_evidence = _validate_provider_account_evidence(sources)
    packet_by_asset, _characterization_by_entry = _narration_maps(sources)
    _validate_historical_fail_closed_state(sources)
    attestations = _validated_attestations(packet_by_asset)
    profile = build_profile()
    validation = _validate_profile_on_manifest(
        profile, sources["private_manifest_v3"]
    )
    profile_serialized = serialize(profile).encode("utf-8")

    source_bindings = {
        name: {
            "path": spec.path.relative_to(REPOSITORY).as_posix(),
            "byte_count": spec.byte_count,
            "sha256": spec.sha256,
        }
        for name, spec in SOURCE_SPECS.items()
    }
    evidence = {
        "schema_version": 1,
        "evidence_id": EVIDENCE_ID,
        "recorded_at": LIVE_READBACK_OBSERVED_AT,
        "status": "deterministic_profile_evidence_ready_live_write_not_authorized",
        "scope": {
            "product_id": PRODUCT_ID,
            "chapter_id": CHAPTER_ID,
            "variant_id": VARIANT_ID,
            "private_evidence_only": True,
        },
        "source_bindings": source_bindings,
        "private_provider_evidence_bindings": {
            "account_browser_source_sha256": ACCOUNT_SOURCE_SHA256,
            "account_private_source_byte_count": 885,
            "account_private_source_sha256": ACCOUNT_EVIDENCE_SHA256,
            "accepted_audition_ledger_sha256": AUDITION_LEDGER_SHA256,
            "chapter_render_ledger_sha256": CHAPTER_RENDER_LEDGER_SHA256,
            "account_claims_tracking": "tracked_redacted_immutable_derivation",
            "account_claims_source_binding": "provider_account_claims_redacted",
            "account_evidence_observed_at": account_evidence["observed_at"],
            "provider": account_evidence["provider"],
            "source": account_evidence["source"],
            "plan": account_evidence["plan"],
            "account_status": account_evidence["account_status"],
            "commercial_use": account_evidence["commercial_use"],
            "model_training_contribution": account_evidence[
                "model_training_contribution"
            ],
            "standard_logging_acknowledged": account_evidence[
                "standard_logging_acknowledged"
            ],
            "output_format_id": account_evidence["output_format_id"],
            "zero_retention": account_evidence["zero_retention"],
            "omitted_field_groups": copy.deepcopy(
                account_evidence["omitted_field_groups"]
            ),
            "administrator_identity_present": False,
            "access_token_present": False,
        },
        "accepted_generator_contract": {
            "provider": "elevenlabs",
            "voice_id": "EkK5I93UQWFDigLMpZcX",
            "voice_name": "James - Husky, Engaging and Bold",
            "model_id": "eleven_multilingual_v2",
            "api_version": "elevenlabs_text_to_speech_v1",
            "language": "en",
            "voice_settings": copy.deepcopy(VOICE_SETTINGS),
            "output_format": "mp3_44100_128",
            "mime_type": "audio/mpeg",
            "sample_rate_hz": 44_100,
            "bitrate_kbps": 128,
            "channels": 1,
            "provider_native_master": True,
            "lossless_master_claimed": False,
            "transcoded": False,
            "creator_plan_observed": account_evidence["plan"] == "creator",
            "commercial_use_observed": account_evidence["commercial_use"],
            "training_contribution_observed": account_evidence[
                "model_training_contribution"
            ],
            "standard_provider_logging_acknowledged": account_evidence[
                "standard_logging_acknowledged"
            ],
            "zero_retention_claimed": False,
        },
        "common_license_terms": copy.deepcopy(COMMON_TERMS),
        "live_readback": {
            "observed_at": LIVE_READBACK_OBSERVED_AT,
            "target": {
                "pack_id": PRODUCT_ID,
                "status": "draft",
                "draft_revision": 1,
                "current_published_version": None,
                "narration_profile_present": False,
            },
            "manifest_probe_ensure_ascii_sha256": (
                LIVE_MANIFEST_PROBE_ENSURE_ASCII_SHA256
            ),
            "store_base_manifest_canonical_sha256": (
                STORE_BASE_MANIFEST_CANONICAL_SHA256
            ),
            "private_import_receipt_sha256": SOURCE_SPECS[
                "private_import_receipt"
            ].sha256,
            "current_asset_count": 20,
            "receipt_exact_asset_count": 20,
            "current_narration_count": 13,
            "rehashed_exact_narration_count": 13,
            "license_attestation_count": 13,
            "single_admin_identity_confirmed": True,
            "admin_identity_count": 1,
            "admin_identity_redacted": True,
            "published_version_count": 0,
            "validation_report_count": 0,
            "production_mutation_performed": False,
        },
        "attestations": attestations,
        "attestation_summary": {
            "count": len(attestations),
            "asset_membership_complete": True,
            "attestation_set_canonical_sha256": ATTESTATION_SET_CANONICAL_SHA256,
            "earliest_attested_at": min(row["attested_at"] for row in attestations),
            "latest_attested_at": max(row["attested_at"] for row in attestations),
            "profile_verified_at_rule": "maximum_server_owned_attested_at",
            "profile_verified_at": PROFILE_VERIFIED_AT,
            "common_terms_exact": True,
        },
        "profile_artifact": {
            "path": PROFILE_OUTPUT_PATH.relative_to(REPOSITORY).as_posix(),
            "byte_count": len(profile_serialized),
            "sha256": hashlib.sha256(profile_serialized).hexdigest(),
            "canonical_sha256": _canonical_sha256(profile),
            **validation,
        },
        "historical_state_preserved": {
            "private_import_packet_rewritten": False,
            "private_import_receipt_rewritten": False,
            "private_manifest_v3_rewritten": False,
            "live_draft_profile_written": False,
            "live_draft_revision_changed": False,
        },
        "gates_before_and_after_evidence_build": {
            "live_draft_validation_metadata_admin_license_attestation_complete": False,
            "server_owned_attestation_evidence_complete": True,
            "deterministic_narration_profile_evidence_complete": True,
            "verified_private_upload_complete": False,
            "authenticated_device_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
        "limitations": [
            (
                "live_readback_is_a_redacted_point_in_time_observation_not_a_"
                "network_query_by_this_builder"
            ),
            "administrator_identity_is_counted_but_not_exposed",
            "profile_is_not_attached_to_the_live_draft",
            (
                "voice_name_and_voice_settings_are_bound_in_this_evidence_overlay_"
                "but_are_not_fields_in_profile_v2"
            ),
            "historical_packet_receipt_and_manifest_gate_values_remain_unchanged",
            "no_preview_trusted_validation_readiness_regeneration_or_publication_was_performed",
        ],
        "next_action": (
            "separately_review_and_authorize_a_revision_checked_profile_only_"
            "live_draft_attachment_then_read_back_every_identity"
        ),
    }
    return profile, evidence


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-output", type=Path, default=PROFILE_OUTPUT_PATH)
    parser.add_argument("--evidence-output", type=Path, default=EVIDENCE_OUTPUT_PATH)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)

    profile, evidence = build_bundle()
    rendered = {
        args.profile_output: serialize(profile),
        args.evidence_output: serialize(evidence),
    }
    if args.check:
        stale = [
            path
            for path, expected in rendered.items()
            if not path.is_file() or path.read_text(encoding="utf-8") != expected
        ]
        if stale:
            raise SystemExit(
                "Roaring Fork narration-profile evidence is stale: "
                + ", ".join(path.name for path in stale)
            )
        return 0
    for path, content in rendered.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
