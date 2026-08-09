#!/usr/bin/env python3
"""Render the locked internal Roaring Fork James narration packet.

Dry run is the default and never reads a key, constructs a provider transport,
or writes output. Apply mode verifies fresh redacted account/key evidence,
strict live James metadata and settings, and the two accepted S4C MP3s before
issuing requests for only the eleven generation-allowlisted entries.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
from collections.abc import Callable, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_UP
from pathlib import Path
from typing import Any

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
from scripts.build_smokies_elevenlabs_james_roaring_fork_lock import (
    CHARACTER_CAP,
    DESTINATION as DEFAULT_LOCK,
    DOLLAR_CAP_USD,
    EXPECTED_VOICE_LIBRARY_RATE,
    EXPECTED_VOICE_SHARING_STATUS,
    EXPECTED_WITHDRAWAL_NOTICE_PERIOD,
    GENERATION_ALLOWLIST,
    KEY_CREDIT_QUOTA,
    MAX_ASSUMED_USD_PER_1000_CHARACTERS,
    REPOSITORY,
    REUSE_ALLOWLIST,
    S4C_AUDITION_LEDGER_SHA256,
    build as build_lock,
    serialize as serialize_lock,
)
from scripts.render_smokies_elevenlabs_james_auditions import (
    AuditionError as NarrationError,
    Mp3Probe,
    ProviderResponse,
    UrllibProviderTransport,
    _atomic_json,
    _atomic_write,
    _canonical_bytes,
    _character_cost,
    _header,
    _jitter,
    _mp3_frame,
    _numeric_equal,
    _provider_json,
    _retry_after,
    _skip_id3v2,
    probe_mp3_bytes,
)

DEFAULT_OUTPUT = (
    REPOSITORY
    / "output/smokies-original/elevenlabs-james-roaring-fork-v1"
)
DEFAULT_ACCEPTED_AUDIO = (
    REPOSITORY
    / "output/smokies-original/elevenlabs-james-auditions-v1"
)
ENDPOINT_ROOT = "https://api.elevenlabs.io/v1/text-to-speech"
VOICE_ENDPOINT_ROOT = "https://api.elevenlabs.io/v1/voices"
SUBSCRIPTION_ENDPOINT = "https://api.elevenlabs.io/v1/user/subscription"
API_KEY_ENV = "ELEVENLABS_ORIGINALS_ROARING_FORK_API_KEY"
RENDERER_CONTRACT = "smokies_elevenlabs_james_roaring_fork_renderer_v1"
MAX_PROVIDER_ATTEMPTS = 3
MAX_RETRY_AFTER_SECONDS = 60.0
MIN_PLAUSIBLE_WPM = 75.0
MAX_PLAUSIBLE_WPM = 240.0
ACCOUNT_EVIDENCE_MAX_AGE = timedelta(hours=24)
MIN_KEY_REMAINING = timedelta(hours=2)
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
EXPECTED_KEY_PERMISSIONS = frozenset({
    "text_to_speech",
    "voices_read",
    "subscription_read",
})


@dataclass(frozen=True)
class ProductionEntry:
    stable_order: int
    entry_id: str
    kind: str
    delivery_mode: str
    disposition: str
    transcript: str
    raw_transcript_sha256: str
    normalized_transcript_sha256: str
    word_count: int
    payload_character_count: int
    normalized_character_count: int
    reserved_character_ceiling: int
    accepted_audio: Mapping[str, Any] | None


@dataclass(frozen=True)
class LockedPacket:
    path: Path
    lock_id: str
    lock_sha256: str
    entries: tuple[ProductionEntry, ...]
    generated_payload_character_count: int
    generated_normalized_character_count: int
    reserved_character_ceiling: int


@dataclass(frozen=True)
class AccountEvidence:
    file_sha256: str
    source_evidence_sha256: str
    observed_at: str
    available_credits: int
    overage_status: str
    key_expires_at: str

    def public_summary(self) -> dict[str, Any]:
        return {
            "source": "authenticated_browser",
            "plan": "creator",
            "commercial_use": True,
            "model_training_contribution": False,
            "available_credits": self.available_credits,
            "overage_status": self.overage_status,
            "output_format_id": OUTPUT_FORMAT_ID,
            "api_key_expiry": "one_day",
            "api_key_expires_at": self.key_expires_at,
            "api_key_credit_quota": KEY_CREDIT_QUOTA,
            "observed_at": self.observed_at,
            "source_evidence_sha256": self.source_evidence_sha256,
            "evidence_file_sha256": self.file_sha256,
        }


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _load_json(path: Path, code: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise NarrationError(code) from exc
    if not isinstance(value, dict):
        raise NarrationError(code)
    return value


def _inside_repository(raw: object, code: str) -> Path:
    relative = Path(str(raw or "").strip())
    if not relative.as_posix() or relative.is_absolute():
        raise NarrationError(code)
    repository = REPOSITORY.resolve()
    candidate = (repository / relative).resolve()
    try:
        candidate.relative_to(repository)
    except ValueError as exc:
        raise NarrationError(code) from exc
    if not candidate.is_file():
        raise NarrationError(code)
    return candidate


def _find_editorial_entry(
    source: Mapping[str, Any], entry_id: str
) -> Mapping[str, Any]:
    rows = source.get("entries")
    if not isinstance(rows, list):
        raise NarrationError("production_lock_editorial_entries_invalid")
    matches = [
        row for row in rows
        if isinstance(row, dict) and str(row.get("id") or "") == entry_id
    ]
    if len(matches) != 1:
        raise NarrationError("production_lock_editorial_entry_unavailable")
    return matches[0]


def load_locked_packet(lock_path: Path = DEFAULT_LOCK) -> LockedPacket:
    raw = _load_json(lock_path, "production_lock_unreadable")
    expected = build_lock()
    if raw != expected or lock_path.read_text(encoding="utf-8") != serialize_lock(
        expected
    ):
        raise NarrationError("production_lock_drift")
    if raw.get("authorization") != {
        "scope": "roaring_fork_internal_narration_only",
        "user_selected_narrator": True,
        "public_release_approved": False,
        "studio_upload_approved": False,
        "other_chapters_approved": False,
    }:
        raise NarrationError("production_lock_authorization_invalid")
    if raw.get("cultural_gate") != {
        "status": "passed_for_roaring_fork_public_record_factual_scope",
        "blocked_entry_ids": [],
        "ebci_public_release_gate_unchanged": True,
    }:
        raise NarrationError("production_lock_cultural_gate_invalid")

    profile = raw.get("generation_profile")
    if not isinstance(profile, dict) or any((
        profile.get("provider") != "elevenlabs",
        profile.get("voice_id") != VOICE_ID,
        profile.get("voice_name") != VOICE_NAME,
        profile.get("model_id") != MODEL_ID,
        profile.get("voice_settings") != VOICE_SETTINGS,
        profile.get("output", {}).get("format_id") != OUTPUT_FORMAT_ID,
        profile.get("output", {}).get("provider_native_lossy_source") is not True,
        profile.get("output", {}).get("lossless_or_wav_claimed") is not False,
    )):
        raise NarrationError("production_lock_generation_profile_invalid")

    editorial_path: Path | None = None
    source_rows = raw.get("source_files")
    if not isinstance(source_rows, list):
        raise NarrationError("production_lock_source_files_invalid")
    for row in source_rows:
        if not isinstance(row, dict):
            raise NarrationError("production_lock_source_files_invalid")
        source_path = _inside_repository(
            row.get("path"), "production_lock_source_path_invalid"
        )
        source_hash = str(row.get("sha256") or "").lower()
        if (
            not SHA256_RE.fullmatch(source_hash)
            or _sha256_file(source_path) != source_hash
        ):
            raise NarrationError("production_lock_source_hash_drift")
        if source_path.name == "editorial_roaring_fork_v1.json":
            editorial_path = source_path
    if editorial_path is None:
        raise NarrationError("production_lock_editorial_source_missing")
    editorial = _load_json(editorial_path, "production_lock_editorial_unreadable")

    rows = raw.get("entries")
    if not isinstance(rows, list) or len(rows) != 13:
        raise NarrationError("production_lock_entries_invalid")
    entries: list[ProductionEntry] = []
    for row in rows:
        if not isinstance(row, dict):
            raise NarrationError("production_lock_entries_invalid")
        entry_id = str(row.get("entry_id") or "")
        source = _find_editorial_entry(editorial, entry_id)
        transcript = source.get("transcript")
        if not isinstance(transcript, str) or not transcript.strip():
            raise NarrationError("production_lock_transcript_invalid")
        normalized = " ".join(transcript.split())
        disposition = str(row.get("generation_disposition") or "")
        accepted_audio = row.get("accepted_audio")
        if disposition == "generate":
            if entry_id not in GENERATION_ALLOWLIST or accepted_audio is not None:
                raise NarrationError("production_lock_generation_allowlist_invalid")
            reserved = row.get("reserved_character_ceiling")
            if isinstance(reserved, bool) or not isinstance(reserved, int):
                raise NarrationError("production_lock_reservation_invalid")
        elif disposition == "reuse":
            if entry_id not in REUSE_ALLOWLIST or not isinstance(accepted_audio, dict):
                raise NarrationError("production_lock_reuse_allowlist_invalid")
            reserved = 0
        else:
            raise NarrationError("production_lock_disposition_invalid")
        if any((
            row.get("script_status") != "draft_review_required",
            row.get("source_gate") != "source_verified",
            row.get("cultural_gate") != "not_required",
            _sha256_bytes(transcript.encode("utf-8"))
            != row.get("raw_transcript_sha256"),
            _sha256_bytes(normalized.encode("utf-8"))
            != row.get("normalized_transcript_sha256"),
            len(transcript) != row.get("payload_character_count"),
            len(normalized) != row.get("normalized_character_count"),
            len(normalized.split(" ")) != row.get("word_count"),
        )):
            raise NarrationError("production_lock_transcript_drift")
        entries.append(ProductionEntry(
            stable_order=int(row["stable_order"]),
            entry_id=entry_id,
            kind=str(row["kind"]),
            delivery_mode=str(row["delivery_mode"]),
            disposition=disposition,
            transcript=transcript,
            raw_transcript_sha256=str(row["raw_transcript_sha256"]),
            normalized_transcript_sha256=str(
                row["normalized_transcript_sha256"]
            ),
            word_count=int(row["word_count"]),
            payload_character_count=int(row["payload_character_count"]),
            normalized_character_count=int(row["normalized_character_count"]),
            reserved_character_ceiling=int(reserved),
            accepted_audio=accepted_audio,
        ))
    entries.sort(key=lambda item: item.stable_order)
    if [item.stable_order for item in entries] != list(range(1, 14)):
        raise NarrationError("production_lock_delivery_order_invalid")
    generated = [item for item in entries if item.disposition == "generate"]
    reused = [item for item in entries if item.disposition == "reuse"]
    budget = raw.get("budget")
    aggregate = raw.get("aggregate")
    if not isinstance(budget, dict) or not isinstance(aggregate, dict):
        raise NarrationError("production_lock_budget_invalid")
    payload = sum(item.payload_character_count for item in generated)
    normalized_count = sum(item.normalized_character_count for item in generated)
    reserved_total = sum(item.reserved_character_ceiling for item in generated)
    if any((
        len(generated) != 11,
        len(reused) != 2,
        set(item.entry_id for item in generated) != GENERATION_ALLOWLIST,
        set(item.entry_id for item in reused) != REUSE_ALLOWLIST,
        payload != 16_373,
        normalized_count != 16_337,
        reserved_total != 18_016,
        budget.get("generated_payload_character_count") != payload,
        budget.get("generated_normalized_character_count") != normalized_count,
        budget.get("reserved_character_ceiling") != reserved_total,
        budget.get("renderer_character_cap") != CHARACTER_CAP,
        budget.get("renderer_headroom_credits")
        != CHARACTER_CAP - reserved_total,
        budget.get("api_key_credit_quota") != KEY_CREDIT_QUOTA,
        budget.get("dollar_cap_usd") != DOLLAR_CAP_USD,
        budget.get("rerender_budget") != 0,
        aggregate.get("generated_reserved_character_ceiling") != reserved_total,
    )):
        raise NarrationError("production_lock_budget_drift")
    return LockedPacket(
        path=lock_path.resolve(),
        lock_id=str(raw["lock_id"]),
        lock_sha256=_sha256_file(lock_path),
        entries=tuple(entries),
        generated_payload_character_count=payload,
        generated_normalized_character_count=normalized_count,
        reserved_character_ceiling=reserved_total,
    )


def projected_cost_usd(character_count: int) -> Decimal:
    value = Decimal(character_count) / Decimal(1000)
    return (
        value * Decimal(MAX_ASSUMED_USD_PER_1000_CHARACTERS)
    ).quantize(Decimal("0.0001"), rounding=ROUND_UP)


_FORBIDDEN_EVIDENCE_KEY_PARTS = (
    "api_key_value",
    "token",
    "secret",
    "email",
    "account_id",
    "user_id",
    "full_name",
    "address",
    "phone",
    "raw_response",
)


def _reject_sensitive_evidence_fields(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            folded = str(key).casefold()
            if any(part in folded for part in _FORBIDDEN_EVIDENCE_KEY_PARTS):
                raise NarrationError("account_evidence_sensitive_field_forbidden")
            _reject_sensitive_evidence_fields(child)
    elif isinstance(value, list):
        for child in value:
            _reject_sensitive_evidence_fields(child)


def _parse_utc_timestamp(value: object, code: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise NarrationError(code) from exc
    if parsed.tzinfo is None:
        raise NarrationError(code)
    return parsed.astimezone(timezone.utc)


def _parse_observed_at(value: object, now: datetime) -> datetime:
    parsed = _parse_utc_timestamp(
        value, "account_evidence_observed_at_invalid"
    )
    if parsed > now + timedelta(minutes=5):
        raise NarrationError("account_evidence_from_future")
    if now - parsed > ACCOUNT_EVIDENCE_MAX_AGE:
        raise NarrationError("account_evidence_stale")
    return parsed


def load_account_evidence(path: Path, now: datetime) -> AccountEvidence:
    raw = _load_json(path, "account_evidence_unreadable")
    _reject_sensitive_evidence_fields(raw)
    if any((
        raw.get("schema_version") != 1,
        raw.get("provider") != "elevenlabs",
        raw.get("source") != "authenticated_browser",
        str(raw.get("plan") or "").casefold() != "creator",
        str(raw.get("account_status") or "").casefold() != "active",
        raw.get("commercial_use") is not True,
        raw.get("model_training_contribution") is not False,
        raw.get("standard_logging_acknowledged") is not True,
        raw.get("output_format_id") != OUTPUT_FORMAT_ID,
    )):
        raise NarrationError("account_evidence_contract_invalid")
    available = raw.get("available_credits")
    if (
        isinstance(available, bool)
        or not isinstance(available, int)
        or available < CHARACTER_CAP
    ):
        raise NarrationError("account_evidence_balance_insufficient")
    overage = raw.get("overage")
    if not isinstance(overage, dict):
        raise NarrationError("account_evidence_overage_invalid")
    overage_status = str(overage.get("status") or "").casefold()
    if overage_status == "disabled":
        if set(overage) != {"status"}:
            raise NarrationError("account_evidence_overage_invalid")
    elif overage_status == "enabled":
        if any((
            str(overage.get("verified_rate_usd_per_1000_characters"))
            != MAX_ASSUMED_USD_PER_1000_CHARACTERS,
            str(overage.get("hard_dollar_cap_usd")) != DOLLAR_CAP_USD,
        )):
            raise NarrationError("account_evidence_overage_invalid")
    else:
        raise NarrationError("account_evidence_overage_invalid")
    key_policy = raw.get("api_key_policy")
    if not isinstance(key_policy, dict) or any((
        key_policy.get("expiry") != "one_day",
        key_policy.get("credit_limit") != KEY_CREDIT_QUOTA,
        set(key_policy.get("permissions") or []) != EXPECTED_KEY_PERMISSIONS,
        len(key_policy.get("permissions") or []) != len(EXPECTED_KEY_PERMISSIONS),
        key_policy.get("auto_disable_if_leaked") is not True,
    )):
        raise NarrationError("account_evidence_key_policy_invalid")
    observed_at = _parse_observed_at(raw.get("observed_at"), now)
    created_at = _parse_utc_timestamp(
        key_policy.get("created_at"), "account_evidence_key_expiry_invalid"
    )
    expires_at = _parse_utc_timestamp(
        key_policy.get("expires_at"), "account_evidence_key_expiry_invalid"
    )
    if any((
        expires_at - created_at != timedelta(days=1),
        created_at > observed_at + timedelta(minutes=5),
        observed_at > expires_at,
        expires_at - now < MIN_KEY_REMAINING,
    )):
        raise NarrationError("account_evidence_key_expiry_invalid")
    source_hash = str(raw.get("source_evidence_sha256") or "").lower()
    if not SHA256_RE.fullmatch(source_hash):
        raise NarrationError("account_evidence_source_hash_invalid")
    return AccountEvidence(
        file_sha256=_sha256_file(path),
        source_evidence_sha256=source_hash,
        observed_at=_iso(observed_at),
        available_credits=available,
        overage_status=overage_status,
        key_expires_at=_iso(expires_at),
    )


def _decimal_equal(value: object, expected: str) -> bool:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return False
    return parsed.is_finite() and parsed == Decimal(expected)


def _validate_voice_metadata(metadata: Mapping[str, Any]) -> dict[str, str]:
    resolved_id = str(metadata.get("voice_id") or metadata.get("voiceId") or "")
    sharing = metadata.get("sharing")
    if not isinstance(sharing, dict):
        raise NarrationError("provider_voice_metadata_drift")
    required_sharing_fields = {
        "original_voice_id",
        "status",
        "rate",
        "notice_period",
        "disable_at_unix",
    }
    if not required_sharing_fields.issubset(sharing):
        raise NarrationError("provider_voice_metadata_drift")
    original_id = str(sharing.get("original_voice_id") or "")
    supported = metadata.get("high_quality_base_model_ids")
    status = str(sharing.get("status") or "").casefold()
    if any((
        resolved_id != VOICE_ID,
        original_id != VOICE_ID,
        not isinstance(supported, list),
        MODEL_ID not in (supported or []),
        status != EXPECTED_VOICE_SHARING_STATUS,
        metadata.get("disable_at_unix") not in (None, 0, "", False),
        sharing.get("disable_at_unix") not in (None, 0, "", False),
        not _decimal_equal(
            sharing.get("rate", metadata.get("rate")),
            EXPECTED_VOICE_LIBRARY_RATE,
        ),
        not _decimal_equal(
            sharing.get("notice_period", metadata.get("notice_period")),
            EXPECTED_WITHDRAWAL_NOTICE_PERIOD,
        ),
    )):
        raise NarrationError("provider_voice_metadata_drift")
    raw_multiplier = sharing.get(
        "credit_multiplier", metadata.get("credit_multiplier")
    )
    if raw_multiplier is not None and not _numeric_equal(raw_multiplier, 1):
        raise NarrationError("provider_voice_credit_multiplier_drift")
    return {
        "sharing_status": EXPECTED_VOICE_SHARING_STATUS,
        "voice_library_rate": EXPECTED_VOICE_LIBRARY_RATE,
        "withdrawal_notice_period": EXPECTED_WITHDRAWAL_NOTICE_PERIOD,
        "custom_credit_multiplier": (
            "not_reported" if raw_multiplier is None else "1"
        ),
    }


def _validate_voice_settings(settings: Mapping[str, Any]) -> None:
    if set(VOICE_SETTINGS) - set(settings):
        raise NarrationError("provider_voice_settings_incomplete")
    for key, expected in VOICE_SETTINGS.items():
        if not _numeric_equal(settings.get(key), expected):
            raise NarrationError("provider_voice_settings_drift")


def _validate_subscription(subscription: Mapping[str, Any]) -> None:
    tier = str(subscription.get("tier") or subscription.get("plan") or "").casefold()
    used = subscription.get("character_count", subscription.get("credits_used"))
    limit = subscription.get("character_limit", subscription.get("credits_limit"))
    if any((
        tier != "creator",
        isinstance(used, bool),
        not isinstance(used, (int, float)),
        isinstance(limit, bool),
        not isinstance(limit, (int, float)),
    )):
        raise NarrationError("provider_subscription_invalid")
    if int(float(limit) - float(used)) < CHARACTER_CAP:
        raise NarrationError("provider_subscription_balance_insufficient")


def provider_preflight(
    transport: Any,
    *,
    api_key: str,
    account_evidence: AccountEvidence,
    timeout: float,
) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "xi-api-key": api_key,
        "User-Agent": "Trailhead-Originals-RoaringFork/1",
    }
    try:
        metadata_response = transport.get(
            f"{VOICE_ENDPOINT_ROOT}/{VOICE_ID}", headers=headers, timeout=timeout
        )
        settings_response = transport.get(
            f"{VOICE_ENDPOINT_ROOT}/{VOICE_ID}/settings",
            headers=headers,
            timeout=timeout,
        )
        subscription_response = transport.get(
            SUBSCRIPTION_ENDPOINT, headers=headers, timeout=timeout
        )
    except Exception:  # noqa: BLE001 - fail closed without private exception text
        raise NarrationError("provider_preflight_transport_failed") from None
    metadata = _provider_json(metadata_response, "provider_voice_metadata_unavailable")
    settings = _provider_json(settings_response, "provider_voice_settings_unavailable")
    subscription = _provider_json(
        subscription_response, "provider_subscription_unavailable"
    )
    voice_contract = _validate_voice_metadata(metadata)
    _validate_voice_settings(settings)
    _validate_subscription(subscription)
    return {
        "voice_metadata_sha256": _sha256_bytes(_canonical_bytes(metadata)),
        "voice_settings_sha256": _sha256_bytes(_canonical_bytes(settings)),
        "voice_lineage": "resolved_and_original_id_match",
        "model_support": MODEL_ID,
        "removal_state": "none",
        **voice_contract,
        "voice_settings": dict(VOICE_SETTINGS),
        "subscription_source": "api_and_authenticated_browser_evidence",
        "account_evidence": account_evidence.public_summary(),
    }


def _probe_mono_mp3(content: bytes) -> Mp3Probe:
    probe = probe_mp3_bytes(content)
    offset = _skip_id3v2(content)
    scan_limit = min(len(content) - 4, offset + 8192)
    while offset <= scan_limit:
        header = content[offset:offset + 4]
        try:
            _mp3_frame(header)
        except NarrationError:
            offset += 1
            continue
        break
    else:
        raise NarrationError("provider_audio_channel_mismatch")
    cursor = offset
    checked_frames = 0
    while checked_frames < probe.frame_count:
        header = content[cursor:cursor + 4]
        frame_length, _sample_rate, _bitrate = _mp3_frame(header)
        if ((header[3] >> 6) & 0x03) != 0x03:
            raise NarrationError("provider_audio_channel_mismatch")
        cursor += frame_length
        checked_frames += 1
    if checked_frames != probe.frame_count:
        raise NarrationError("provider_audio_channel_mismatch")
    return probe


def _validate_duration(entry: ProductionEntry, probe: Mp3Probe) -> None:
    minimum = entry.word_count / MAX_PLAUSIBLE_WPM * 60
    maximum = entry.word_count / MIN_PLAUSIBLE_WPM * 60
    if not minimum <= probe.duration_s <= maximum:
        raise NarrationError("provider_audio_duration_implausible")


def _validate_reused_audio(
    entry: ProductionEntry,
    content: bytes,
    probe_audio: Callable[[bytes], Mp3Probe],
) -> Mp3Probe:
    expected = entry.accepted_audio
    if not isinstance(expected, Mapping):
        raise NarrationError("accepted_audio_contract_invalid")
    if any((
        expected.get("raw_transcript_sha256")
        != entry.raw_transcript_sha256,
        expected.get("normalized_transcript_sha256")
        != entry.normalized_transcript_sha256,
        expected.get("accepted_audition_ledger_sha256")
        != S4C_AUDITION_LEDGER_SHA256,
    )):
        raise NarrationError("accepted_audio_transcript_binding_drift")
    probe = probe_audio(content)
    _validate_duration(entry, probe)
    if any((
        probe.sample_rate_hz != 44_100,
        probe.bitrate_kbps != 128,
        probe.sha256 != expected.get("audio_sha256"),
        probe.byte_count != expected.get("audio_bytes"),
        abs(probe.duration_s - float(expected.get("duration_s") or 0)) > 0.000001,
    )):
        raise NarrationError("accepted_audio_tampered")
    return probe


def _request_payload(entry: ProductionEntry) -> dict[str, Any]:
    return {
        "text": entry.transcript,
        "model_id": MODEL_ID,
        "language_code": "en",
        "voice_settings": dict(VOICE_SETTINGS),
    }


def _request_fingerprint(packet: LockedPacket, entry: ProductionEntry) -> str:
    return _sha256_bytes(_canonical_bytes({
        "renderer_contract": RENDERER_CONTRACT,
        "lock_sha256": packet.lock_sha256,
        "entry_id": entry.entry_id,
        "voice_id": VOICE_ID,
        "output_format_id": OUTPUT_FORMAT_ID,
        "payload": _request_payload(entry),
    }))


def _new_ledger(packet: LockedPacket, now: datetime) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "renderer_contract": RENDERER_CONTRACT,
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "provider": "elevenlabs",
        "voice_id": VOICE_ID,
        "model_id": MODEL_ID,
        "output_format_id": OUTPUT_FORMAT_ID,
        "created_at": _iso(now),
        "updated_at": _iso(now),
        "caps": {
            "provider_credits": CHARACTER_CAP,
            "api_key_credit_quota": KEY_CREDIT_QUOTA,
            "dollars_usd": DOLLAR_CAP_USD,
            "reserved_provider_credits": packet.reserved_character_ceiling,
        },
        "items": {
            entry.entry_id: {
                "state": (
                    "reuse_pending" if entry.disposition == "reuse" else "pending"
                ),
                "stable_order": entry.stable_order,
                "disposition": entry.disposition,
                "raw_transcript_sha256": entry.raw_transcript_sha256,
                "normalized_transcript_sha256": (
                    entry.normalized_transcript_sha256
                ),
                "payload_character_count": entry.payload_character_count,
                "normalized_character_count": entry.normalized_character_count,
                "reserved_character_ceiling": entry.reserved_character_ceiling,
                "attempts": [],
            }
            for entry in packet.entries
        },
    }


def _load_ledger(path: Path, packet: LockedPacket, now: datetime) -> dict[str, Any]:
    if not path.exists():
        return _new_ledger(packet, now)
    ledger = _load_json(path, "render_ledger_unreadable")
    ledger_fields = {
        "schema_version",
        "renderer_contract",
        "lock_id",
        "lock_sha256",
        "provider",
        "voice_id",
        "model_id",
        "output_format_id",
        "created_at",
        "updated_at",
        "caps",
        "items",
    }
    if "preflight" in ledger:
        ledger_fields.add("preflight")
    if set(ledger) != ledger_fields:
        raise NarrationError("render_ledger_fields_drift")
    caps = ledger.get("caps")
    if not isinstance(caps, dict) or set(caps) != {
        "provider_credits",
        "api_key_credit_quota",
        "dollars_usd",
        "reserved_provider_credits",
    }:
        raise NarrationError("render_ledger_caps_drift")
    if any((
        ledger.get("schema_version") != 1,
        ledger.get("renderer_contract") != RENDERER_CONTRACT,
        ledger.get("lock_id") != packet.lock_id,
        ledger.get("lock_sha256") != packet.lock_sha256,
        ledger.get("provider") != "elevenlabs",
        ledger.get("voice_id") != VOICE_ID,
        ledger.get("model_id") != MODEL_ID,
        ledger.get("output_format_id") != OUTPUT_FORMAT_ID,
        caps.get("provider_credits") != CHARACTER_CAP,
        caps.get("api_key_credit_quota") != KEY_CREDIT_QUOTA,
        caps.get("dollars_usd") != DOLLAR_CAP_USD,
        caps.get("reserved_provider_credits")
        != packet.reserved_character_ceiling,
    )):
        raise NarrationError("render_ledger_identity_drift")
    items = ledger.get("items")
    if not isinstance(items, dict) or set(items) != {
        entry.entry_id for entry in packet.entries
    }:
        raise NarrationError("render_ledger_items_drift")
    for entry in packet.entries:
        item = items.get(entry.entry_id)
        if not isinstance(item, dict) or any((
            item.get("stable_order") != entry.stable_order,
            item.get("disposition") != entry.disposition,
            item.get("raw_transcript_sha256")
            != entry.raw_transcript_sha256,
            item.get("normalized_transcript_sha256")
            != entry.normalized_transcript_sha256,
            item.get("payload_character_count")
            != entry.payload_character_count,
            item.get("normalized_character_count")
            != entry.normalized_character_count,
            item.get("reserved_character_ceiling")
            != entry.reserved_character_ceiling,
            not isinstance(item.get("attempts"), list),
        )):
            raise NarrationError("render_ledger_item_identity_drift")
        state = str(item.get("state") or "")
        base_fields = {
            "state",
            "stable_order",
            "disposition",
            "raw_transcript_sha256",
            "normalized_transcript_sha256",
            "payload_character_count",
            "normalized_character_count",
            "reserved_character_ceiling",
            "attempts",
        }
        if entry.disposition == "reuse":
            if state not in {"reuse_pending", "reused_verified"}:
                raise NarrationError("reuse_ledger_state_invalid")
            expected_fields = set(base_fields)
            if state == "reused_verified":
                expected_fields.update({
                    "master_file",
                    "audio_sha256",
                    "audio_bytes",
                    "duration_s",
                    "accepted_origin_character_cost",
                    "packet_character_cost",
                    "verified_at",
                })
                accepted = entry.accepted_audio
                duration = item.get("duration_s")
                if (
                    not isinstance(accepted, Mapping)
                    or isinstance(duration, bool)
                    or not isinstance(duration, (int, float))
                ):
                    raise NarrationError("reuse_ledger_evidence_drift")
                if any((
                    item.get("master_file") != _master_name(entry),
                    item.get("audio_sha256")
                    != accepted.get("audio_sha256"),
                    item.get("audio_bytes") != accepted.get("audio_bytes"),
                    abs(
                        float(duration)
                        - float(accepted.get("duration_s") or 0)
                    ) > 0.000001,
                    item.get("accepted_origin_character_cost")
                    != accepted.get("character_cost"),
                    item.get("packet_character_cost") != 0,
                )):
                    raise NarrationError("reuse_ledger_evidence_drift")
            if set(item) != expected_fields:
                raise NarrationError("reuse_ledger_fields_drift")
            continue
        allowed_states = {
            "pending",
            "pending_retry",
            "reserved",
            "request_sent",
            "ambiguous_transport",
            "ambiguous_audio",
            "completed_cost_unverified",
            "completed_cost_violation",
            "failed_definitive",
            "completed",
        }
        if state not in allowed_states:
            raise NarrationError("render_ledger_state_invalid")
        expected_fields = set(base_fields)
        if state != "pending":
            expected_fields.update({"request_fingerprint", "reserved_at"})
        if state in {
            "completed",
            "completed_cost_unverified",
            "completed_cost_violation",
        }:
            expected_fields.update({
                "master_file",
                "audio_sha256",
                "audio_bytes",
                "duration_s",
                "content_type",
                "completed_at",
            })
        if state in {"completed", "completed_cost_violation"}:
            expected_fields.add("character_cost")
        if set(item) != expected_fields:
            raise NarrationError("render_ledger_item_fields_drift")
        attempts = item["attempts"]
        if len(attempts) > MAX_PROVIDER_ATTEMPTS or any(
            not isinstance(attempt, dict)
            or attempt.get("number") != index
            for index, attempt in enumerate(attempts, start=1)
        ):
            raise NarrationError("render_ledger_attempts_invalid")
        allowed_attempt_states = {
            "sent",
            "retryable_response",
            "ambiguous_transport",
            "ambiguous_provider_5xx",
            "failed_definitive",
            "response_received",
        }
        for attempt in attempts:
            attempt_state = str(attempt.get("state") or "")
            if attempt_state not in allowed_attempt_states:
                raise NarrationError("render_ledger_attempts_invalid")
            expected_attempt_fields = {"number", "state", "at"}
            status = attempt.get("http_status")
            if attempt_state == "sent":
                if status is not None:
                    raise NarrationError("render_ledger_attempts_invalid")
            elif attempt_state == "ambiguous_transport":
                expected_attempt_fields.add("exception_type")
                if status is not None or not attempt.get("exception_type"):
                    raise NarrationError("render_ledger_attempts_invalid")
            elif isinstance(status, bool) or not isinstance(status, int):
                raise NarrationError("render_ledger_attempts_invalid")
            else:
                expected_attempt_fields.add("http_status")
                if any((
                    attempt_state == "retryable_response" and status != 429,
                    attempt_state == "ambiguous_provider_5xx"
                    and not 500 <= status <= 599,
                    attempt_state == "failed_definitive"
                    and (
                        200 <= status <= 299
                        or status == 429
                        or 500 <= status <= 599
                    ),
                    attempt_state == "response_received"
                    and not 200 <= status <= 299,
                )):
                    raise NarrationError("render_ledger_attempts_invalid")
            for hash_field in (
                "provider_request_id_sha256",
                "provider_trace_id_sha256",
            ):
                value = attempt.get(hash_field)
                if value is not None:
                    expected_attempt_fields.add(hash_field)
                    if not SHA256_RE.fullmatch(str(value)):
                        raise NarrationError("render_ledger_attempts_invalid")
            if "retry_delay_s" in attempt:
                retry_delay = attempt["retry_delay_s"]
                if (
                    attempt_state != "retryable_response"
                    or isinstance(retry_delay, bool)
                    or not isinstance(retry_delay, (int, float))
                ):
                    raise NarrationError("render_ledger_attempts_invalid")
                expected_attempt_fields.add("retry_delay_s")
            if set(attempt) != expected_attempt_fields:
                raise NarrationError("render_ledger_attempt_fields_drift")
        if state != "pending" and (
            item.get("request_fingerprint")
            != _request_fingerprint(packet, entry)
        ):
            raise NarrationError("render_ledger_request_drift")
        if state in {
            "completed",
            "completed_cost_unverified",
            "completed_cost_violation",
        }:
            audio_hash = str(item.get("audio_sha256") or "")
            audio_bytes = item.get("audio_bytes")
            duration = item.get("duration_s")
            if any((
                item.get("master_file") != _master_name(entry),
                not SHA256_RE.fullmatch(audio_hash),
                isinstance(audio_bytes, bool),
                not isinstance(audio_bytes, int),
                audio_bytes <= 0,
                isinstance(duration, bool),
                not isinstance(duration, (int, float)),
                duration <= 0,
                not attempts,
            )):
                raise NarrationError("render_ledger_completion_drift")
        if state == "completed":
            cost = item.get("character_cost")
            if (
                isinstance(cost, bool)
                or not isinstance(cost, int)
                or cost <= 0
                or cost > entry.reserved_character_ceiling
            ):
                raise NarrationError("render_ledger_cost_drift")
            if not attempts or attempts[-1].get("state") != "response_received":
                raise NarrationError("render_ledger_attempts_invalid")
        expected_terminal_attempt = {
            "pending_retry": "retryable_response",
            "request_sent": "sent",
            "ambiguous_audio": "response_received",
            "completed_cost_unverified": "response_received",
            "completed_cost_violation": "response_received",
            "failed_definitive": "failed_definitive",
        }.get(state)
        if expected_terminal_attempt and (
            not attempts or attempts[-1].get("state") != expected_terminal_attempt
        ):
            raise NarrationError("render_ledger_attempts_invalid")
        if state == "ambiguous_transport" and (
            not attempts
            or attempts[-1].get("state") not in {
                "ambiguous_transport",
                "ambiguous_provider_5xx",
            }
        ):
            raise NarrationError("render_ledger_attempts_invalid")
        if state in {"pending", "reserved"} and attempts:
            raise NarrationError("render_ledger_attempts_invalid")
    committed_cost = sum(
        int(item.get("character_cost") or 0)
        for item in items.values()
        if item.get("state") == "completed"
    )
    if (
        committed_cost > CHARACTER_CAP
        or projected_cost_usd(committed_cost) > Decimal(DOLLAR_CAP_USD)
    ):
        raise NarrationError("render_ledger_aggregate_cost_drift")
    return ledger


def _save_ledger(path: Path, ledger: dict[str, Any], now: datetime) -> None:
    ledger["updated_at"] = _iso(now)
    _atomic_json(path, ledger)


def _master_name(entry: ProductionEntry) -> str:
    return f"{entry.stable_order:02d}-{entry.entry_id}.mp3"


def _completed_master_valid(
    item: Mapping[str, Any],
    master: Path,
    entry: ProductionEntry,
    probe_audio: Callable[[bytes], Mp3Probe],
) -> bool:
    try:
        if not master.is_file():
            return False
        probe = probe_audio(master.read_bytes())
        _validate_duration(entry, probe)
    except (OSError, NarrationError):
        return False
    if not all((
        probe.sha256 == item.get("audio_sha256"),
        probe.byte_count == item.get("audio_bytes"),
        probe.sample_rate_hz == 44_100,
        probe.bitrate_kbps == 128,
    )):
        return False
    if entry.disposition == "reuse":
        accepted = entry.accepted_audio
        return isinstance(accepted, Mapping) and all((
            probe.sha256 == accepted.get("audio_sha256"),
            probe.byte_count == accepted.get("audio_bytes"),
            abs(
                probe.duration_s - float(accepted.get("duration_s") or 0)
            ) <= 0.000001,
        ))
    try:
        metadata = _load_json(
            master.with_suffix(".json"), "completed_metadata_unreadable"
        )
    except NarrationError:
        return False
    expected_audio = {**probe.as_dict(), "channels": 1}
    return all((
        metadata.get("schema_version") == 1,
        metadata.get("renderer_contract") == RENDERER_CONTRACT,
        metadata.get("entry_id") == entry.entry_id,
        metadata.get("raw_transcript_sha256")
        == entry.raw_transcript_sha256,
        metadata.get("normalized_transcript_sha256")
        == entry.normalized_transcript_sha256,
        metadata.get("provider") == "elevenlabs",
        metadata.get("voice_id") == VOICE_ID,
        metadata.get("voice_name") == VOICE_NAME,
        metadata.get("model_id") == MODEL_ID,
        metadata.get("output_format_id") == OUTPUT_FORMAT_ID,
        metadata.get("voice_settings") == VOICE_SETTINGS,
        metadata.get("character_cost") == item.get("character_cost"),
        metadata.get("audio") == expected_audio,
        metadata.get("provider_native_lossy_source") is True,
        metadata.get("lossless_or_wav_claimed") is False,
    ))


def _load_accepted_reuse_source(
    entry: ProductionEntry,
    accepted_audio_dir: Path,
    probe_audio: Callable[[bytes], Mp3Probe],
) -> tuple[bytes, Mp3Probe]:
    accepted = entry.accepted_audio
    if not isinstance(accepted, Mapping):
        raise NarrationError("accepted_audio_contract_invalid")
    source_name = str(accepted.get("source_file") or "")
    if Path(source_name).name != source_name or not source_name.endswith(".mp3"):
        raise NarrationError("accepted_audio_source_invalid")
    source_path = (accepted_audio_dir / source_name).resolve()
    try:
        source_path.relative_to(accepted_audio_dir)
        content = source_path.read_bytes()
    except (ValueError, OSError) as exc:
        raise NarrationError("accepted_audio_source_unavailable") from exc
    return content, _validate_reused_audio(entry, content, probe_audio)


def _validate_local_resume_state(
    packet: LockedPacket,
    ledger: Mapping[str, Any],
    output_dir: Path,
    accepted_audio_dir: Path,
    probe_audio: Callable[[bytes], Mp3Probe],
) -> dict[str, tuple[bytes, Mp3Probe]]:
    """Validate all local evidence before reading a key or using the network."""
    prepared_reuse: dict[str, tuple[bytes, Mp3Probe]] = {}
    for entry in packet.entries:
        item = ledger["items"][entry.entry_id]
        state = str(item.get("state") or "")
        master = output_dir / _master_name(entry)
        if entry.disposition == "reuse":
            if state == "reused_verified":
                if not _completed_master_valid(item, master, entry, probe_audio):
                    raise NarrationError("completed_master_drift")
                continue
            if state != "reuse_pending":
                raise NarrationError("reuse_ledger_state_invalid")
            prepared_reuse[entry.entry_id] = _load_accepted_reuse_source(
                entry,
                accepted_audio_dir,
                probe_audio,
            )
            continue
        if state == "completed":
            if not _completed_master_valid(item, master, entry, probe_audio):
                raise NarrationError("completed_master_drift")
            continue
        if state in {
            "reserved",
            "request_sent",
            "ambiguous_transport",
            "ambiguous_audio",
            "completed_cost_unverified",
            "completed_cost_violation",
        }:
            raise NarrationError("manual_provider_reconciliation_required")
        if state == "failed_definitive":
            raise NarrationError("provider_request_failed_definitive")
        if state not in {"pending", "pending_retry"}:
            raise NarrationError("render_ledger_state_invalid")
        if len(item["attempts"]) >= MAX_PROVIDER_ATTEMPTS:
            raise NarrationError("provider_retry_exhausted")
    return prepared_reuse


def _response_header_hash(headers: Mapping[str, str], name: str) -> str | None:
    value = _header(headers, name)
    if not value:
        return None
    return _sha256_bytes(value.encode("utf-8"))


@contextmanager
def _exclusive_apply_lock(output_dir: Path):
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    lock_path = output_dir.with_name(f".{output_dir.name}.apply.lock")
    try:
        descriptor = os.open(
            lock_path,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            0o600,
        )
    except FileExistsError:
        raise NarrationError("concurrent_apply_forbidden") from None
    try:
        os.write(descriptor, f"{RENDERER_CONTRACT}\n".encode("utf-8"))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    try:
        yield
    finally:
        lock_path.unlink(missing_ok=True)


def _run_renderer_unlocked(
    *,
    lock_path: Path = DEFAULT_LOCK,
    output_dir: Path = DEFAULT_OUTPUT,
    accepted_audio_dir: Path = DEFAULT_ACCEPTED_AUDIO,
    apply: bool = False,
    verified_output_format: str | None = None,
    account_evidence_path: Path | None = None,
    environ: Mapping[str, str] | None = None,
    transport_factory: Callable[[], Any] = UrllibProviderTransport,
    probe_audio: Callable[[bytes], Mp3Probe] = _probe_mono_mp3,
    sleep: Callable[[float], None] = time.sleep,
    retry_jitter: Callable[[float], float] = _jitter,
    now: Callable[[], datetime] = _utc_now,
    timeout: float = 120.0,
) -> dict[str, Any]:
    packet = load_locked_packet(lock_path)
    generated_entries = [
        entry for entry in packet.entries if entry.disposition == "generate"
    ]
    reused_entries = [
        entry for entry in packet.entries if entry.disposition == "reuse"
    ]
    summary: dict[str, Any] = {
        "apply": apply,
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "provider": "elevenlabs",
        "voice_id": VOICE_ID,
        "model_id": MODEL_ID,
        "output_format_id": OUTPUT_FORMAT_ID,
        "entry_count": len(packet.entries),
        "generation_count": len(generated_entries),
        "reuse_count": len(reused_entries),
        "generated_payload_character_count": (
            packet.generated_payload_character_count
        ),
        "generated_normalized_character_count": (
            packet.generated_normalized_character_count
        ),
        "reserved_character_ceiling": packet.reserved_character_ceiling,
        "projected_cost_ceiling_usd": str(
            projected_cost_usd(packet.reserved_character_ceiling)
        ),
        "renderer_character_cap": CHARACTER_CAP,
        "api_key_credit_quota": KEY_CREDIT_QUOTA,
        "dollar_cap_usd": DOLLAR_CAP_USD,
        "network_used": False,
    }
    if not apply:
        summary.update({
            "status": "dry_run_ready",
            "apply_requires_verified_output_format": OUTPUT_FORMAT_ID,
            "reuse_verification_required_on_apply": sorted(REUSE_ALLOWLIST),
        })
        return summary
    if verified_output_format != OUTPUT_FORMAT_ID:
        raise NarrationError("production_output_format_confirmation_required")
    if account_evidence_path is None:
        raise NarrationError("account_evidence_required")
    if packet.reserved_character_ceiling > CHARACTER_CAP:
        raise NarrationError("production_character_cap_exceeded")
    if projected_cost_usd(packet.reserved_character_ceiling) > Decimal(
        DOLLAR_CAP_USD
    ):
        raise NarrationError("production_dollar_cap_exceeded")
    account_evidence = load_account_evidence(account_evidence_path, now())
    output_dir = output_dir.resolve()
    accepted_audio_dir = accepted_audio_dir.resolve()
    ledger_path = output_dir / "render-ledger.json"
    ledger = _load_ledger(ledger_path, packet, now())
    prepared_reuse = _validate_local_resume_state(
        packet,
        ledger,
        output_dir,
        accepted_audio_dir,
        probe_audio,
    )
    environment = os.environ if environ is None else environ
    api_key = str(environment.get(API_KEY_ENV, "")).strip()
    if not api_key:
        raise NarrationError("production_api_key_missing")

    transport = transport_factory()
    preflight = provider_preflight(
        transport,
        api_key=api_key,
        account_evidence=account_evidence,
        timeout=timeout,
    )
    ledger["preflight"] = preflight
    output_dir.mkdir(parents=True, exist_ok=True)
    _save_ledger(ledger_path, ledger, now())
    reused: list[str] = []
    rendered: list[str] = []
    skipped: list[str] = []

    for entry in reused_entries:
        item = ledger["items"][entry.entry_id]
        master = output_dir / _master_name(entry)
        state = str(item.get("state") or "")
        if state == "reused_verified":
            if not _completed_master_valid(item, master, entry, probe_audio):
                raise NarrationError("completed_master_drift")
            skipped.append(entry.entry_id)
            continue
        if state != "reuse_pending":
            raise NarrationError("reuse_ledger_state_invalid")
        accepted = entry.accepted_audio
        if not isinstance(accepted, Mapping):
            raise NarrationError("accepted_audio_contract_invalid")
        content, probe = prepared_reuse[entry.entry_id]
        _atomic_write(master, content)
        item.update({
            "state": "reused_verified",
            "master_file": master.name,
            "audio_sha256": probe.sha256,
            "audio_bytes": probe.byte_count,
            "duration_s": round(probe.duration_s, 6),
            "accepted_origin_character_cost": accepted["character_cost"],
            "packet_character_cost": 0,
            "verified_at": _iso(now()),
        })
        _save_ledger(ledger_path, ledger, now())
        reused.append(entry.entry_id)

    for entry in generated_entries:
        item = ledger["items"][entry.entry_id]
        master = output_dir / _master_name(entry)
        state = str(item.get("state") or "")
        if state == "completed":
            if not _completed_master_valid(item, master, entry, probe_audio):
                raise NarrationError("completed_master_drift")
            skipped.append(entry.entry_id)
            continue
        if state in {
            "reserved",
            "request_sent",
            "ambiguous_transport",
            "ambiguous_audio",
            "completed_cost_unverified",
            "completed_cost_violation",
        }:
            raise NarrationError("manual_provider_reconciliation_required")
        if state == "failed_definitive":
            raise NarrationError("provider_request_failed_definitive")
        if state not in {"pending", "pending_retry"}:
            raise NarrationError("render_ledger_state_invalid")
        previous_attempts = item.get("attempts")
        if not isinstance(previous_attempts, list):
            raise NarrationError("render_ledger_attempts_invalid")
        if len(previous_attempts) >= MAX_PROVIDER_ATTEMPTS:
            raise NarrationError("provider_retry_exhausted")

        committed = sum(
            int(row.get("character_cost") or 0)
            for row in ledger["items"].values()
            if row.get("state") == "completed"
        )
        if committed + entry.reserved_character_ceiling > CHARACTER_CAP:
            raise NarrationError("production_character_cap_exceeded")
        item["state"] = "reserved"
        item["request_fingerprint"] = _request_fingerprint(packet, entry)
        item["reserved_at"] = _iso(now())
        _save_ledger(ledger_path, ledger, now())
        payload = _canonical_bytes(_request_payload(entry))
        query = urllib.parse.urlencode({"output_format": OUTPUT_FORMAT_ID})
        url = f"{ENDPOINT_ROOT}/{VOICE_ID}?{query}"
        response: ProviderResponse | None = None
        while len(previous_attempts) < MAX_PROVIDER_ATTEMPTS:
            attempt_number = len(previous_attempts) + 1
            attempt = {
                "number": attempt_number,
                "state": "sent",
                "at": _iso(now()),
            }
            previous_attempts.append(attempt)
            item["state"] = "request_sent"
            _save_ledger(ledger_path, ledger, now())
            try:
                response = transport.post(
                    url,
                    headers={
                        "Accept": "audio/mpeg",
                        "Content-Type": "application/json",
                        "xi-api-key": api_key,
                        "User-Agent": "Trailhead-Originals-RoaringFork/1",
                    },
                    body=payload,
                    timeout=timeout,
                )
            except Exception as exc:  # noqa: BLE001 - billing state is ambiguous
                item["state"] = "ambiguous_transport"
                attempt["state"] = "ambiguous_transport"
                attempt["exception_type"] = type(exc).__name__
                _save_ledger(ledger_path, ledger, now())
                raise NarrationError("provider_transport_ambiguous") from None

            status = int(response.status_code)
            attempt["http_status"] = status
            request_hash = _response_header_hash(response.headers, "request-id")
            trace_hash = _response_header_hash(response.headers, "x-trace-id")
            if request_hash:
                attempt["provider_request_id_sha256"] = request_hash
            if trace_hash:
                attempt["provider_trace_id_sha256"] = trace_hash
            if status == 429:
                attempt["state"] = "retryable_response"
                item["state"] = "pending_retry"
                _save_ledger(ledger_path, ledger, now())
                if len(previous_attempts) >= MAX_PROVIDER_ATTEMPTS:
                    raise NarrationError("provider_retry_exhausted")
                delay = retry_jitter(_retry_after(response.headers, attempt_number))
                attempt["retry_delay_s"] = round(
                    min(MAX_RETRY_AFTER_SECONDS, delay), 3
                )
                _save_ledger(ledger_path, ledger, now())
                sleep(min(MAX_RETRY_AFTER_SECONDS, delay))
                continue
            if 500 <= status <= 599:
                item["state"] = "ambiguous_transport"
                attempt["state"] = "ambiguous_provider_5xx"
                _save_ledger(ledger_path, ledger, now())
                raise NarrationError("provider_server_response_ambiguous")
            if not 200 <= status <= 299:
                item["state"] = "failed_definitive"
                attempt["state"] = "failed_definitive"
                _save_ledger(ledger_path, ledger, now())
                raise NarrationError("provider_request_failed_definitive")
            attempt["state"] = "response_received"
            break
        if response is None:
            raise NarrationError("provider_response_missing")
        content_type = (_header(response.headers, "content-type") or "").lower()
        if not content_type.startswith("audio/mpeg"):
            item["state"] = "ambiguous_audio"
            _save_ledger(ledger_path, ledger, now())
            raise NarrationError("provider_content_type_invalid")
        try:
            probe = probe_audio(response.body)
            _validate_duration(entry, probe)
        except NarrationError:
            item["state"] = "ambiguous_audio"
            _save_ledger(ledger_path, ledger, now())
            raise
        _atomic_write(master, response.body)
        cost = _character_cost(response.headers)
        item.update({
            "master_file": master.name,
            "audio_sha256": probe.sha256,
            "audio_bytes": probe.byte_count,
            "duration_s": round(probe.duration_s, 6),
            "content_type": content_type.split(";", 1)[0],
            "completed_at": _iso(now()),
        })
        if cost is None:
            item["state"] = "completed_cost_unverified"
            _save_ledger(ledger_path, ledger, now())
            raise NarrationError("provider_character_cost_missing")
        item["character_cost"] = cost
        committed = cost + sum(
            int(row.get("character_cost") or 0)
            for row in ledger["items"].values()
            if row is not item and row.get("state") == "completed"
        )
        if any((
            cost > entry.reserved_character_ceiling,
            committed > CHARACTER_CAP,
            projected_cost_usd(committed) > Decimal(DOLLAR_CAP_USD),
        )):
            item["state"] = "completed_cost_violation"
            _save_ledger(ledger_path, ledger, now())
            raise NarrationError("provider_character_cost_cap_exceeded")
        item["state"] = "completed"
        _atomic_json(output_dir / f"{entry.stable_order:02d}-{entry.entry_id}.json", {
            "schema_version": 1,
            "renderer_contract": RENDERER_CONTRACT,
            "lock_id": packet.lock_id,
            "lock_sha256": packet.lock_sha256,
            "entry_id": entry.entry_id,
            "raw_transcript_sha256": entry.raw_transcript_sha256,
            "normalized_transcript_sha256": entry.normalized_transcript_sha256,
            "provider": "elevenlabs",
            "voice_id": VOICE_ID,
            "voice_name": VOICE_NAME,
            "model_id": MODEL_ID,
            "output_format_id": OUTPUT_FORMAT_ID,
            "voice_settings": dict(VOICE_SETTINGS),
            "character_cost": cost,
            "audio": {
                **probe.as_dict(),
                "channels": 1,
            },
            "provider_native_lossy_source": True,
            "lossless_or_wav_claimed": False,
        })
        _save_ledger(ledger_path, ledger, now())
        rendered.append(entry.entry_id)

    summary.update({
        "status": "complete",
        "network_used": True,
        "provider_preflight_network_used": True,
        "tts_network_used": bool(rendered),
        "rendered": rendered,
        "reused": reused,
        "skipped": skipped,
        "committed_character_cost": sum(
            int(item.get("character_cost") or 0)
            for item in ledger["items"].values()
            if item.get("state") == "completed"
        ),
        "ledger_sha256": _sha256_file(ledger_path),
    })
    return summary


def run_renderer(
    *,
    lock_path: Path = DEFAULT_LOCK,
    output_dir: Path = DEFAULT_OUTPUT,
    accepted_audio_dir: Path = DEFAULT_ACCEPTED_AUDIO,
    apply: bool = False,
    verified_output_format: str | None = None,
    account_evidence_path: Path | None = None,
    environ: Mapping[str, str] | None = None,
    transport_factory: Callable[[], Any] = UrllibProviderTransport,
    probe_audio: Callable[[bytes], Mp3Probe] = _probe_mono_mp3,
    sleep: Callable[[float], None] = time.sleep,
    retry_jitter: Callable[[float], float] = _jitter,
    now: Callable[[], datetime] = _utc_now,
    timeout: float = 120.0,
) -> dict[str, Any]:
    arguments = {
        "lock_path": lock_path,
        "output_dir": output_dir,
        "accepted_audio_dir": accepted_audio_dir,
        "apply": apply,
        "verified_output_format": verified_output_format,
        "account_evidence_path": account_evidence_path,
        "environ": environ,
        "transport_factory": transport_factory,
        "probe_audio": probe_audio,
        "sleep": sleep,
        "retry_jitter": retry_jitter,
        "now": now,
        "timeout": timeout,
    }
    if not apply:
        return _run_renderer_unlocked(**arguments)
    with _exclusive_apply_lock(output_dir.resolve()):
        return _run_renderer_unlocked(**arguments)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--accepted-audio", type=Path, default=DEFAULT_ACCEPTED_AUDIO
    )
    parser.add_argument("--verified-output-format")
    parser.add_argument("--account-evidence", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run_renderer(
            lock_path=args.lock,
            output_dir=args.output,
            accepted_audio_dir=args.accepted_audio,
            apply=args.apply,
            verified_output_format=args.verified_output_format,
            account_evidence_path=args.account_evidence,
        )
    except NarrationError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
