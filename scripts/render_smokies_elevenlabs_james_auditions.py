#!/usr/bin/env python3
"""Render the three locked Smokies auditions with ElevenLabs James.

The command is a network-free dry run unless ``--apply`` is present. Apply
mode requires the dedicated audition key and an explicit confirmation of the
authenticated Creator-safe output format. Provider-native MP3 files are kept
as the comparison masters; this tool never relabels lossy audio as WAV and
never uploads an audition to Originals Studio.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_UP, Decimal, InvalidOperation
from pathlib import Path
from typing import Any

_BOOTSTRAP_REPOSITORY = Path(__file__).resolve().parents[1]
if str(_BOOTSTRAP_REPOSITORY) not in sys.path:
    sys.path.insert(0, str(_BOOTSTRAP_REPOSITORY))

from scripts.build_smokies_elevenlabs_james_audition_lock import (
    CHARACTER_CAP,
    DOLLAR_CAP_USD,
    MAX_ASSUMED_USD_PER_1000_CHARACTERS,
    MODEL_ID,
    OUTPUT_FORMAT_ID,
    VOICE_ID,
    VOICE_NAME,
    VOICE_SETTINGS,
)
from scripts.build_smokies_elevenlabs_james_audition_lock import build as build_lock
from scripts.build_smokies_elevenlabs_james_audition_lock import (
    serialize as serialize_lock,
)

REPOSITORY = _BOOTSTRAP_REPOSITORY
DEFAULT_LOCK = (
    REPOSITORY / "originals/smokies/elevenlabs_james_audition_lock_v1.json"
)
DEFAULT_OUTPUT = (
    REPOSITORY / "output/smokies-original/elevenlabs-james-auditions-v1"
)
ENDPOINT_ROOT = "https://api.elevenlabs.io/v1/text-to-speech"
VOICE_ENDPOINT_ROOT = "https://api.elevenlabs.io/v1/voices"
SUBSCRIPTION_ENDPOINT = "https://api.elevenlabs.io/v1/user/subscription"
API_KEY_ENV = "ELEVENLABS_ORIGINALS_AUDITION_API_KEY"
RENDERER_CONTRACT = "smokies_elevenlabs_james_audition_renderer_v1"
MAX_PROVIDER_ATTEMPTS = 3
MAX_RETRY_AFTER_SECONDS = 60.0
MIN_PLAUSIBLE_WPM = 75.0
MAX_PLAUSIBLE_WPM = 240.0
MIN_MP3_BYTES = 8_192
ACCOUNT_EVIDENCE_MAX_AGE = timedelta(hours=24)
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class AuditionError(RuntimeError):
    """A fixed-code, non-sensitive renderer failure."""


@dataclass(frozen=True)
class AuditionScript:
    order: int
    role: str
    entry_id: str
    chapter_id: str
    source_file: str
    transcript: str
    transcript_sha256: str
    word_count: int
    payload_character_count: int
    normalized_character_count: int
    reserved_character_ceiling: int


@dataclass(frozen=True)
class LockedPacket:
    path: Path
    lock_id: str
    lock_sha256: str
    product_id: str
    output_format_id: str
    scripts: tuple[AuditionScript, ...]
    payload_character_count: int
    reserved_character_ceiling: int


@dataclass(frozen=True)
class ProviderResponse:
    status_code: int
    headers: Mapping[str, str]
    body: bytes


@dataclass(frozen=True)
class Mp3Probe:
    byte_count: int
    sha256: str
    sample_rate_hz: int
    bitrate_kbps: int
    frame_count: int
    duration_s: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "bytes": self.byte_count,
            "sha256": self.sha256,
            "sample_rate_hz": self.sample_rate_hz,
            "bitrate_kbps": self.bitrate_kbps,
            "frame_count": self.frame_count,
            "duration_s": round(self.duration_s, 6),
            "container": "mp3",
        }


@dataclass(frozen=True)
class AccountEvidence:
    file_sha256: str
    source_evidence_sha256: str
    observed_at: str
    available_credits: int

    def public_summary(self) -> dict[str, Any]:
        return {
            "source": "authenticated_browser",
            "plan": "creator",
            "commercial_use": True,
            "available_credits": self.available_credits,
            "output_format_id": OUTPUT_FORMAT_ID,
            "observed_at": self.observed_at,
            "source_evidence_sha256": self.source_evidence_sha256,
            "evidence_file_sha256": self.file_sha256,
        }


class UrllibProviderTransport:
    def get(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        timeout: float,
    ) -> ProviderResponse:
        request = urllib.request.Request(url, headers=dict(headers), method="GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return ProviderResponse(
                    status_code=int(response.status),
                    headers=dict(response.headers.items()),
                    body=response.read(),
                )
        except urllib.error.HTTPError as exc:
            return ProviderResponse(
                status_code=int(exc.code),
                headers=dict(exc.headers.items()) if exc.headers else {},
                body=b"",
            )

    def post(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes,
        timeout: float,
    ) -> ProviderResponse:
        request = urllib.request.Request(
            url,
            data=body,
            headers=dict(headers),
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return ProviderResponse(
                    status_code=int(response.status),
                    headers=dict(response.headers.items()),
                    body=response.read(),
                )
        except urllib.error.HTTPError as exc:
            return ProviderResponse(
                status_code=int(exc.code),
                headers=dict(exc.headers.items()) if exc.headers else {},
                body=b"",
            )


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _load_json(path: Path, code: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise AuditionError(code) from exc
    if not isinstance(value, dict):
        raise AuditionError(code)
    return value


def _inside_repository(raw: object, code: str) -> tuple[str, Path]:
    relative = Path(str(raw or "").strip())
    if not relative.as_posix() or relative.is_absolute():
        raise AuditionError(code)
    repository = REPOSITORY.resolve()
    candidate = (repository / relative).resolve()
    try:
        candidate.relative_to(repository)
    except ValueError as exc:
        raise AuditionError(code) from exc
    if not candidate.is_file():
        raise AuditionError(code)
    return relative.as_posix(), candidate


def _find_entry(source: Mapping[str, Any], entry_id: str) -> Mapping[str, Any]:
    entries = source.get("entries")
    if not isinstance(entries, list):
        raise AuditionError("lock_source_entries_invalid")
    matches = [
        row for row in entries
        if isinstance(row, dict) and str(row.get("id") or "") == entry_id
    ]
    if len(matches) != 1:
        raise AuditionError("lock_source_entry_unavailable")
    return matches[0]


def load_locked_packet(lock_path: Path) -> LockedPacket:
    """Load only the checked, deterministic lock and its exact transcripts."""
    raw = _load_json(lock_path, "audition_lock_unreadable")
    expected = build_lock()
    if raw != expected or lock_path.read_text(encoding="utf-8") != serialize_lock(
        expected
    ):
        raise AuditionError("audition_lock_drift")
    if raw.get("authorization") != {
        "scope": "three_internal_auditions_only",
        "full_pack_render_approved": False,
        "public_release_approved": False,
    }:
        raise AuditionError("audition_lock_authorization_invalid")
    if raw.get("cultural_gate") != {
        "status": "passed_for_selected_non_cultural_auditions",
        "public_release_approval_implied": False,
    }:
        raise AuditionError("audition_lock_cultural_gate_blocked")
    profile = raw.get("generation_profile")
    if not isinstance(profile, dict) or any((
        profile.get("provider") != "elevenlabs",
        profile.get("voice_id") != VOICE_ID,
        profile.get("voice_name") != VOICE_NAME,
        profile.get("model_id") != MODEL_ID,
        profile.get("language_code") != "en",
        profile.get("voice_settings_source")
        != "provider_preflight_exact_match_required",
        profile.get("voice_settings") != VOICE_SETTINGS,
    )):
        raise AuditionError("audition_lock_generation_profile_drift")
    output = profile.get("output_policy")
    if output != {
        "selection_status": "authenticated_creator_account_verified",
        "format_id": OUTPUT_FORMAT_ID,
        "container": "mp3",
        "sample_rate_hz": 44_100,
        "bitrate_kbps": 128,
        "provider_native_master": True,
        "lossless_master_claimed": False,
        "transcoding_for_comparison_forbidden": True,
    }:
        raise AuditionError("audition_output_format_unverified")

    source_hashes: dict[str, str] = {}
    source_rows = raw.get("source_files")
    if not isinstance(source_rows, list):
        raise AuditionError("audition_lock_source_files_invalid")
    for row in source_rows:
        if not isinstance(row, dict):
            raise AuditionError("audition_lock_source_files_invalid")
        source_file, source_path = _inside_repository(
            row.get("path"), "audition_lock_source_path_invalid"
        )
        source_hash = str(row.get("sha256") or "").lower()
        if not SHA256_RE.fullmatch(source_hash) or source_file in source_hashes:
            raise AuditionError("audition_lock_source_hash_invalid")
        if _sha256_file(source_path) != source_hash:
            raise AuditionError("audition_lock_source_hash_drift")
        source_hashes[source_file] = source_hash

    scripts: list[AuditionScript] = []
    rows = raw.get("auditions")
    if not isinstance(rows, list) or len(rows) != 3:
        raise AuditionError("audition_lock_selection_invalid")
    for row in rows:
        if not isinstance(row, dict):
            raise AuditionError("audition_lock_selection_invalid")
        source_file, source_path = _inside_repository(
            row.get("source_file"), "audition_lock_source_path_invalid"
        )
        if source_file not in source_hashes:
            raise AuditionError("audition_lock_source_binding_drift")
        entry_id = str(row.get("entry_id") or "")
        entry = _find_entry(
            _load_json(source_path, "audition_lock_source_unreadable"),
            entry_id,
        )
        transcript = entry.get("transcript")
        if not isinstance(transcript, str) or not transcript.strip():
            raise AuditionError("audition_lock_transcript_drift")
        transcript_sha = _sha256_bytes(transcript.encode("utf-8"))
        normalized = " ".join(transcript.split())
        if any((
            transcript_sha != row.get("transcript_sha256"),
            len(transcript) != row.get("payload_character_count"),
            len(normalized) != row.get("normalized_character_count"),
            len(normalized.split(" ")) != row.get("word_count"),
            entry.get("script_status") != "draft_review_required",
            row.get("cultural_gate") != "not_required",
            row.get("source_gate") != "source_verified",
        )):
            raise AuditionError("audition_lock_transcript_drift")
        scripts.append(AuditionScript(
            order=int(row["order"]),
            role=str(row["role"]),
            entry_id=entry_id,
            chapter_id=str(row["chapter_id"]),
            source_file=source_file,
            transcript=transcript,
            transcript_sha256=transcript_sha,
            word_count=int(row["word_count"]),
            payload_character_count=int(row["payload_character_count"]),
            normalized_character_count=int(row["normalized_character_count"]),
            reserved_character_ceiling=int(row["reserved_character_ceiling"]),
        ))
    scripts.sort(key=lambda item: item.order)
    if [item.order for item in scripts] != [1, 2, 3]:
        raise AuditionError("audition_lock_order_invalid")

    budget = raw.get("budget")
    aggregate = raw.get("aggregate")
    if not isinstance(budget, dict) or not isinstance(aggregate, dict):
        raise AuditionError("audition_lock_budget_invalid")
    payload_total = sum(item.payload_character_count for item in scripts)
    reserved_total = sum(item.reserved_character_ceiling for item in scripts)
    if any((
        payload_total != aggregate.get("payload_character_count"),
        reserved_total != aggregate.get("reserved_character_ceiling"),
        payload_total != budget.get("payload_character_count"),
        reserved_total != budget.get("reserved_character_ceiling"),
        budget.get("character_cap") != CHARACTER_CAP,
        budget.get("dollar_cap_usd") != str(DOLLAR_CAP_USD),
        budget.get("rerender_budget") != 0,
        reserved_total > CHARACTER_CAP,
        projected_cost_usd(reserved_total) > DOLLAR_CAP_USD,
    )):
        raise AuditionError("audition_lock_budget_drift")
    return LockedPacket(
        path=lock_path.resolve(),
        lock_id=str(raw["lock_id"]),
        lock_sha256=_sha256_file(lock_path),
        product_id=str(raw["product_id"]),
        output_format_id=OUTPUT_FORMAT_ID,
        scripts=tuple(scripts),
        payload_character_count=payload_total,
        reserved_character_ceiling=reserved_total,
    )


def projected_cost_usd(character_count: int) -> Decimal:
    value = Decimal(character_count) / Decimal(1000)
    return (value * MAX_ASSUMED_USD_PER_1000_CHARACTERS).quantize(
        Decimal("0.0001"), rounding=ROUND_UP
    )


_FORBIDDEN_EVIDENCE_KEY_PARTS = (
    "api_key", "token", "secret", "email", "account_id", "user_id",
    "full_name", "address", "phone", "raw_response",
)


def _reject_sensitive_evidence_fields(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            folded = str(key).casefold()
            if any(part in folded for part in _FORBIDDEN_EVIDENCE_KEY_PARTS):
                raise AuditionError("account_evidence_sensitive_field_forbidden")
            _reject_sensitive_evidence_fields(child)
    elif isinstance(value, list):
        for child in value:
            _reject_sensitive_evidence_fields(child)


def _parse_observed_at(value: object, now: datetime) -> str:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise AuditionError("account_evidence_observed_at_invalid") from exc
    if parsed.tzinfo is None:
        raise AuditionError("account_evidence_observed_at_invalid")
    parsed = parsed.astimezone(timezone.utc)
    if parsed > now + timedelta(minutes=5):
        raise AuditionError("account_evidence_from_future")
    if now - parsed > ACCOUNT_EVIDENCE_MAX_AGE:
        raise AuditionError("account_evidence_stale")
    return _iso(parsed)


def load_account_evidence(path: Path, now: datetime) -> AccountEvidence:
    raw = _load_json(path, "account_evidence_unreadable")
    _reject_sensitive_evidence_fields(raw)
    if any((
        raw.get("schema_version") != 1,
        raw.get("provider") != "elevenlabs",
        raw.get("source") != "authenticated_browser",
        str(raw.get("plan") or "").casefold() != "creator",
        raw.get("commercial_use") is not True,
        raw.get("output_format_id") != OUTPUT_FORMAT_ID,
    )):
        raise AuditionError("account_evidence_contract_invalid")
    available = raw.get("available_credits")
    if isinstance(available, bool) or not isinstance(available, int):
        raise AuditionError("account_evidence_balance_invalid")
    if available < CHARACTER_CAP:
        raise AuditionError("account_evidence_balance_insufficient")
    source_hash = str(raw.get("source_evidence_sha256") or "").lower()
    if not SHA256_RE.fullmatch(source_hash):
        raise AuditionError("account_evidence_source_hash_invalid")
    return AccountEvidence(
        file_sha256=_sha256_file(path),
        source_evidence_sha256=source_hash,
        observed_at=_parse_observed_at(raw.get("observed_at"), now),
        available_credits=available,
    )


def _provider_json(response: ProviderResponse, code: str) -> dict[str, Any]:
    if response.status_code != 200 or len(response.body) > 2_000_000:
        raise AuditionError(code)
    try:
        value = json.loads(response.body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AuditionError(code) from exc
    if not isinstance(value, dict):
        raise AuditionError(code)
    return value


def _numeric_equal(left: object, right: object) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return left is right
    try:
        return Decimal(str(left)) == Decimal(str(right))
    except (InvalidOperation, TypeError, ValueError):
        return False


def _decimal_text(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _validate_voice_metadata(metadata: Mapping[str, Any]) -> dict[str, str]:
    resolved_id = str(metadata.get("voice_id") or metadata.get("voiceId") or "")
    if resolved_id != VOICE_ID:
        raise AuditionError("provider_voice_identity_mismatch")
    sharing = metadata.get("sharing")
    sharing = sharing if isinstance(sharing, dict) else {}
    original_id = str(sharing.get("original_voice_id") or resolved_id)
    if original_id != VOICE_ID:
        raise AuditionError("provider_voice_lineage_mismatch")
    supported = metadata.get("high_quality_base_model_ids")
    if not isinstance(supported, list) or MODEL_ID not in supported:
        raise AuditionError("provider_voice_model_unsupported")
    for container in (metadata, sharing):
        if container.get("disable_at_unix") not in (None, 0, "", False):
            raise AuditionError("provider_voice_removal_pending")
    status = str(sharing.get("status") or "enabled").casefold()
    if status in {
        "disabled", "removed", "pending", "pending_removal", "removal_pending",
    }:
        raise AuditionError("provider_voice_unavailable")
    raw_rate = sharing.get("rate", metadata.get("rate"))
    try:
        voice_library_rate = Decimal(str(raw_rate))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise AuditionError("provider_voice_library_rate_invalid") from exc
    if not voice_library_rate.is_finite() or voice_library_rate <= 0:
        raise AuditionError("provider_voice_library_rate_invalid")

    raw_multiplier = sharing.get(
        "credit_multiplier", metadata.get("credit_multiplier")
    )
    if raw_multiplier is not None and not _numeric_equal(raw_multiplier, 1):
        raise AuditionError("provider_voice_custom_multiplier_forbidden")
    notice_period = sharing.get("notice_period", metadata.get("notice_period"))
    if notice_period in (None, ""):
        notice_period_text = "not_reported"
    else:
        try:
            notice_period_value = Decimal(str(notice_period))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise AuditionError("provider_voice_notice_period_invalid") from exc
        if not notice_period_value.is_finite() or notice_period_value < 0:
            raise AuditionError("provider_voice_notice_period_invalid")
        notice_period_text = _decimal_text(notice_period_value)
    return {
        "voice_library_rate": _decimal_text(voice_library_rate),
        "voice_library_rate_semantics": "provider_reported_credit_rate",
        "custom_credit_multiplier": (
            "not_reported" if raw_multiplier is None else "1"
        ),
        "withdrawal_notice_period": notice_period_text,
    }


def _validate_voice_settings(settings: Mapping[str, Any]) -> None:
    if set(VOICE_SETTINGS) - set(settings):
        raise AuditionError("provider_voice_settings_incomplete")
    for key, expected in VOICE_SETTINGS.items():
        if not _numeric_equal(settings.get(key), expected):
            raise AuditionError("provider_voice_settings_drift")


def _validate_api_subscription(subscription: Mapping[str, Any]) -> None:
    tier = str(subscription.get("tier") or subscription.get("plan") or "").casefold()
    if tier != "creator":
        raise AuditionError("provider_subscription_plan_mismatch")
    used = subscription.get("character_count", subscription.get("credits_used"))
    limit = subscription.get("character_limit", subscription.get("credits_limit"))
    if (
        isinstance(used, bool) or not isinstance(used, (int, float))
        or isinstance(limit, bool) or not isinstance(limit, (int, float))
        or int(limit - used) < CHARACTER_CAP
    ):
        raise AuditionError("provider_subscription_balance_insufficient")


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
        "User-Agent": "Trailhead-Originals-Audition/1",
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
    except Exception:  # noqa: BLE001 - every preflight transport failure is fail-closed
        raise AuditionError("provider_preflight_transport_failed") from None
    metadata = _provider_json(metadata_response, "provider_voice_metadata_unavailable")
    settings = _provider_json(settings_response, "provider_voice_settings_unavailable")
    voice_contract = _validate_voice_metadata(metadata)
    _validate_voice_settings(settings)
    subscription_source = "authenticated_browser_evidence"
    if subscription_response.status_code == 200:
        subscription = _provider_json(
            subscription_response, "provider_subscription_unavailable"
        )
        _validate_api_subscription(subscription)
        subscription_source = "api_and_authenticated_browser_evidence"
    elif subscription_response.status_code not in {401, 403}:
        raise AuditionError("provider_subscription_unavailable")
    return {
        "voice_metadata_sha256": _sha256_bytes(_canonical_bytes(metadata)),
        "voice_settings_sha256": _sha256_bytes(_canonical_bytes(settings)),
        "voice_lineage": "resolved_and_original_id_match",
        "model_support": MODEL_ID,
        "removal_state": "none",
        **voice_contract,
        "voice_settings": dict(VOICE_SETTINGS),
        "subscription_source": subscription_source,
        "account_evidence": account_evidence.public_summary(),
    }


def _skip_id3v2(content: bytes) -> int:
    if not content.startswith(b"ID3"):
        return 0
    if len(content) < 10 or any(byte & 0x80 for byte in content[6:10]):
        raise AuditionError("provider_audio_invalid")
    size = (
        (content[6] << 21)
        | (content[7] << 14)
        | (content[8] << 7)
        | content[9]
    )
    return 10 + size + (10 if content[5] & 0x10 else 0)


def _mp3_frame(header: bytes) -> tuple[int, int, int]:
    if len(header) < 4 or header[0] != 0xFF or header[1] & 0xE0 != 0xE0:
        raise AuditionError("provider_audio_invalid")
    version_bits = (header[1] >> 3) & 0x03
    layer_bits = (header[1] >> 1) & 0x03
    bitrate_index = (header[2] >> 4) & 0x0F
    sample_index = (header[2] >> 2) & 0x03
    padding = (header[2] >> 1) & 0x01
    if version_bits != 0x03 or layer_bits != 0x01:
        raise AuditionError("provider_audio_format_mismatch")
    bitrates = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
    sample_rates = (44_100, 48_000, 32_000, 0)
    bitrate = bitrates[bitrate_index]
    sample_rate = sample_rates[sample_index]
    if bitrate <= 0 or sample_rate <= 0:
        raise AuditionError("provider_audio_invalid")
    frame_length = math.floor(144 * bitrate * 1000 / sample_rate) + padding
    return frame_length, sample_rate, bitrate


def probe_mp3_bytes(content: bytes) -> Mp3Probe:
    """Strictly validate a provider-native MPEG-1 Layer III response."""
    if len(content) < MIN_MP3_BYTES:
        raise AuditionError("provider_audio_too_short")
    prefix = content[:64].lstrip().lower()
    if prefix.startswith((b"{", b"[", b"<html", b"<!doctype")):
        raise AuditionError("provider_audio_invalid")
    offset = _skip_id3v2(content)
    scan_limit = min(len(content) - 4, offset + 8192)
    while offset <= scan_limit:
        try:
            _mp3_frame(content[offset:offset + 4])
            break
        except AuditionError:
            offset += 1
    else:
        raise AuditionError("provider_audio_invalid")

    frame_count = 0
    sample_rate = 0
    bitrate = 0
    cursor = offset
    while cursor + 4 <= len(content):
        if content[cursor:cursor + 3] == b"TAG" and len(content) - cursor == 128:
            cursor = len(content)
            break
        try:
            frame_length, current_rate, current_bitrate = _mp3_frame(
                content[cursor:cursor + 4]
            )
        except AuditionError:
            break
        if cursor + frame_length > len(content):
            break
        if sample_rate and current_rate != sample_rate:
            raise AuditionError("provider_audio_format_mismatch")
        if current_bitrate != 128:
            raise AuditionError("provider_audio_format_mismatch")
        sample_rate = current_rate
        bitrate = current_bitrate if not bitrate else bitrate
        frame_count += 1
        cursor += frame_length
    if frame_count < 10 or sample_rate != 44_100:
        raise AuditionError("provider_audio_format_mismatch")
    if len(content) - cursor > 1024:
        raise AuditionError("provider_audio_trailing_data")
    duration = frame_count * 1152 / sample_rate
    return Mp3Probe(
        byte_count=len(content),
        sha256=_sha256_bytes(content),
        sample_rate_hz=sample_rate,
        bitrate_kbps=bitrate,
        frame_count=frame_count,
        duration_s=duration,
    )


def validate_duration(script: AuditionScript, probe: Mp3Probe) -> None:
    minimum = script.word_count / MAX_PLAUSIBLE_WPM * 60
    maximum = script.word_count / MIN_PLAUSIBLE_WPM * 60
    if not minimum <= probe.duration_s <= maximum:
        raise AuditionError("provider_audio_duration_implausible")


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, raw_path = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(raw_path)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _atomic_json(path: Path, value: object) -> None:
    _atomic_write(
        path,
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False).encode("utf-8")
        + b"\n",
    )


def _new_ledger(packet: LockedPacket, now: datetime) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "renderer_contract": RENDERER_CONTRACT,
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "provider": "elevenlabs",
        "voice_id": VOICE_ID,
        "model_id": MODEL_ID,
        "output_format_id": packet.output_format_id,
        "created_at": _iso(now),
        "updated_at": _iso(now),
        "caps": {
            "characters": CHARACTER_CAP,
            "dollars_usd": str(DOLLAR_CAP_USD),
            "reserved_characters": packet.reserved_character_ceiling,
        },
        "items": {
            script.entry_id: {
                "state": "pending",
                "order": script.order,
                "transcript_sha256": script.transcript_sha256,
                "payload_character_count": script.payload_character_count,
                "reserved_character_ceiling": script.reserved_character_ceiling,
                "attempts": [],
            }
            for script in packet.scripts
        },
    }


def _load_ledger(path: Path, packet: LockedPacket, now: datetime) -> dict[str, Any]:
    if not path.exists():
        return _new_ledger(packet, now)
    ledger = _load_json(path, "render_ledger_unreadable")
    if any((
        ledger.get("schema_version") != 1,
        ledger.get("renderer_contract") != RENDERER_CONTRACT,
        ledger.get("lock_id") != packet.lock_id,
        ledger.get("lock_sha256") != packet.lock_sha256,
        ledger.get("voice_id") != VOICE_ID,
        ledger.get("model_id") != MODEL_ID,
        ledger.get("output_format_id") != packet.output_format_id,
        ledger.get("caps", {}).get("characters") != CHARACTER_CAP,
        ledger.get("caps", {}).get("dollars_usd") != str(DOLLAR_CAP_USD),
    )):
        raise AuditionError("render_ledger_identity_drift")
    items = ledger.get("items")
    if not isinstance(items, dict) or set(items) != {
        item.entry_id for item in packet.scripts
    }:
        raise AuditionError("render_ledger_items_drift")
    return ledger


def _save_ledger(path: Path, ledger: dict[str, Any], now: datetime) -> None:
    ledger["updated_at"] = _iso(now)
    _atomic_json(path, ledger)


def _request_payload(script: AuditionScript) -> dict[str, Any]:
    return {
        "text": script.transcript,
        "model_id": MODEL_ID,
        "language_code": "en",
        "voice_settings": dict(VOICE_SETTINGS),
    }


def _request_fingerprint(packet: LockedPacket, script: AuditionScript) -> str:
    return _sha256_bytes(_canonical_bytes({
        "renderer_contract": RENDERER_CONTRACT,
        "lock_sha256": packet.lock_sha256,
        "entry_id": script.entry_id,
        "voice_id": VOICE_ID,
        "output_format_id": packet.output_format_id,
        "payload": _request_payload(script),
    }))


def _header(headers: Mapping[str, str], name: str) -> str | None:
    target = name.casefold()
    for key, value in headers.items():
        if str(key).casefold() == target:
            return str(value)
    return None


def _character_cost(headers: Mapping[str, str]) -> int | None:
    raw = _header(headers, "character-cost")
    if raw is None:
        return None
    try:
        value = int(raw.strip())
    except ValueError:
        return None
    return value if value > 0 else None


def _retry_after(headers: Mapping[str, str], attempt: int) -> float:
    raw = _header(headers, "retry-after")
    if raw:
        try:
            return min(MAX_RETRY_AFTER_SECONDS, max(0.0, float(raw)))
        except ValueError:
            pass
    return min(MAX_RETRY_AFTER_SECONDS, float(2 ** (attempt - 1)))


def _jitter(value: float) -> float:
    return value * random.uniform(0.85, 1.15)


def _completed_master_valid(
    item: Mapping[str, Any],
    master: Path,
    script: AuditionScript,
    probe_audio: Callable[[bytes], Mp3Probe],
) -> bool:
    try:
        if not master.is_file():
            return False
        content = master.read_bytes()
        probe = probe_audio(content)
        validate_duration(script, probe)
    except (OSError, AuditionError):
        return False
    return any((
        probe.sha256 != item.get("audio_sha256"),
        probe.byte_count != item.get("audio_bytes"),
    )) is False


def run_renderer(
    *,
    lock_path: Path = DEFAULT_LOCK,
    output_dir: Path = DEFAULT_OUTPUT,
    apply: bool = False,
    verified_output_format: str | None = None,
    account_evidence_path: Path | None = None,
    environ: Mapping[str, str] | None = None,
    transport_factory: Callable[[], Any] = UrllibProviderTransport,
    probe_audio: Callable[[bytes], Mp3Probe] = probe_mp3_bytes,
    sleep: Callable[[float], None] = time.sleep,
    retry_jitter: Callable[[float], float] = _jitter,
    now: Callable[[], datetime] = _utc_now,
    timeout: float = 120.0,
) -> dict[str, Any]:
    packet = load_locked_packet(lock_path)
    summary = {
        "apply": apply,
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "provider": "elevenlabs",
        "voice_id": VOICE_ID,
        "model_id": MODEL_ID,
        "output_format_id": packet.output_format_id,
        "script_count": len(packet.scripts),
        "payload_character_count": packet.payload_character_count,
        "reserved_character_ceiling": packet.reserved_character_ceiling,
        "projected_cost_ceiling_usd": str(
            projected_cost_usd(packet.reserved_character_ceiling)
        ),
        "character_cap": CHARACTER_CAP,
        "dollar_cap_usd": str(DOLLAR_CAP_USD),
        "network_used": False,
    }
    if not apply:
        summary["status"] = "dry_run_ready"
        summary["apply_requires_verified_output_format"] = packet.output_format_id
        return summary

    if verified_output_format != packet.output_format_id:
        raise AuditionError("audition_output_format_confirmation_required")
    if account_evidence_path is None:
        raise AuditionError("account_evidence_required")
    account_evidence = load_account_evidence(account_evidence_path, now())
    environment = os.environ if environ is None else environ
    api_key = str(environment.get(API_KEY_ENV, "")).strip()
    if not api_key:
        raise AuditionError("audition_api_key_missing")
    if packet.reserved_character_ceiling > CHARACTER_CAP:
        raise AuditionError("audition_character_cap_exceeded")
    if projected_cost_usd(packet.reserved_character_ceiling) > DOLLAR_CAP_USD:
        raise AuditionError("audition_dollar_cap_exceeded")

    transport = transport_factory()
    preflight = provider_preflight(
        transport,
        api_key=api_key,
        account_evidence=account_evidence,
        timeout=timeout,
    )
    output_dir = output_dir.resolve()
    ledger_path = output_dir / "render-ledger.json"
    ledger = _load_ledger(ledger_path, packet, now())
    ledger["preflight"] = preflight
    output_dir.mkdir(parents=True, exist_ok=True)
    _save_ledger(ledger_path, ledger, now())
    rendered: list[str] = []
    skipped: list[str] = []

    for script in packet.scripts:
        item = ledger["items"][script.entry_id]
        master_name = f"{script.order:02d}-{script.entry_id}.mp3"
        master = output_dir / master_name
        state = str(item.get("state") or "")
        if state == "completed":
            if not _completed_master_valid(item, master, script, probe_audio):
                raise AuditionError("completed_master_drift")
            skipped.append(script.entry_id)
            continue
        if state in {
            "reserved", "request_sent", "ambiguous_transport",
            "ambiguous_audio", "completed_cost_unverified",
            "completed_cost_violation",
        }:
            raise AuditionError("manual_provider_reconciliation_required")
        if state == "failed_definitive":
            raise AuditionError("provider_request_failed_definitive")
        if state not in {"pending", "pending_retry"}:
            raise AuditionError("render_ledger_state_invalid")

        item["state"] = "reserved"
        item["request_fingerprint"] = _request_fingerprint(packet, script)
        item["reserved_at"] = _iso(now())
        _save_ledger(ledger_path, ledger, now())
        payload = _canonical_bytes(_request_payload(script))
        query = urllib.parse.urlencode({
            "output_format": packet.output_format_id,
        })
        url = f"{ENDPOINT_ROOT}/{VOICE_ID}?{query}"
        response: ProviderResponse | None = None
        for attempt in range(1, MAX_PROVIDER_ATTEMPTS + 1):
            item["state"] = "request_sent"
            item["attempts"].append({
                "number": attempt,
                "state": "sent",
                "at": _iso(now()),
            })
            _save_ledger(ledger_path, ledger, now())
            try:
                response = transport.post(
                    url,
                    headers={
                        "Accept": "audio/mpeg",
                        "Content-Type": "application/json",
                        "xi-api-key": api_key,
                        "User-Agent": "Trailhead-Originals-Audition/1",
                    },
                    body=payload,
                    timeout=timeout,
                )
            except Exception as exc:  # noqa: BLE001 - billing state becomes ambiguous
                item["state"] = "ambiguous_transport"
                item["attempts"][-1]["state"] = "ambiguous_transport"
                item["attempts"][-1]["exception_type"] = type(exc).__name__
                _save_ledger(ledger_path, ledger, now())
                raise AuditionError("provider_transport_ambiguous") from None

            status = int(response.status_code)
            item["attempts"][-1]["http_status"] = status
            if status == 429:
                item["attempts"][-1]["state"] = "retryable_response"
                if attempt == MAX_PROVIDER_ATTEMPTS:
                    item["state"] = "pending_retry"
                    _save_ledger(ledger_path, ledger, now())
                    raise AuditionError("provider_retry_exhausted")
                delay = retry_jitter(_retry_after(response.headers, attempt))
                item["attempts"][-1]["retry_delay_s"] = round(delay, 3)
                item["state"] = "pending_retry"
                _save_ledger(ledger_path, ledger, now())
                sleep(delay)
                continue
            if 500 <= status <= 599:
                item["state"] = "ambiguous_transport"
                item["attempts"][-1]["state"] = "ambiguous_provider_5xx"
                _save_ledger(ledger_path, ledger, now())
                raise AuditionError("provider_server_response_ambiguous")
            if not 200 <= status <= 299:
                item["state"] = "failed_definitive"
                item["attempts"][-1]["state"] = "failed_definitive"
                _save_ledger(ledger_path, ledger, now())
                raise AuditionError("provider_request_failed_definitive")
            item["attempts"][-1]["state"] = "response_received"
            break

        if response is None:
            raise AuditionError("provider_response_missing")
        content_type = (_header(response.headers, "content-type") or "").lower()
        if not content_type.startswith("audio/"):
            item["state"] = "ambiguous_audio"
            _save_ledger(ledger_path, ledger, now())
            raise AuditionError("provider_content_type_invalid")
        try:
            probe = probe_audio(response.body)
            validate_duration(script, probe)
        except AuditionError:
            item["state"] = "ambiguous_audio"
            _save_ledger(ledger_path, ledger, now())
            raise

        _atomic_write(master, response.body)
        cost = _character_cost(response.headers)
        item.update({
            "master_file": master_name,
            "audio_sha256": probe.sha256,
            "audio_bytes": probe.byte_count,
            "audio": probe.as_dict(),
            "content_type": content_type.split(";", 1)[0],
            "completed_at": _iso(now()),
        })
        if cost is None:
            item["state"] = "completed_cost_unverified"
            _save_ledger(ledger_path, ledger, now())
            raise AuditionError("provider_character_cost_missing")
        item["character_cost"] = cost
        committed = sum(
            int(row.get("character_cost") or 0)
            for row in ledger["items"].values()
        )
        if (
            cost > script.reserved_character_ceiling
            or committed > CHARACTER_CAP
            or projected_cost_usd(committed) > DOLLAR_CAP_USD
        ):
            item["state"] = "completed_cost_violation"
            _save_ledger(ledger_path, ledger, now())
            raise AuditionError("provider_character_cost_cap_exceeded")
        item["state"] = "completed"
        _atomic_json(output_dir / f"{script.order:02d}-{script.entry_id}.json", {
            "schema_version": 1,
            "renderer_contract": RENDERER_CONTRACT,
            "lock_id": packet.lock_id,
            "lock_sha256": packet.lock_sha256,
            "entry_id": script.entry_id,
            "transcript_sha256": script.transcript_sha256,
            "provider": "elevenlabs",
            "voice_id": VOICE_ID,
            "voice_name": VOICE_NAME,
            "model_id": MODEL_ID,
            "output_format_id": packet.output_format_id,
            "voice_settings": dict(VOICE_SETTINGS),
            "character_cost": cost,
            "audio": probe.as_dict(),
            "provider_native_master": True,
            "lossless_master_claimed": False,
        })
        _save_ledger(ledger_path, ledger, now())
        rendered.append(script.entry_id)

    summary.update({
        "status": "complete",
        "network_used": bool(rendered),
        "rendered": rendered,
        "skipped": skipped,
        "committed_character_cost": sum(
            int(item.get("character_cost") or 0)
            for item in ledger["items"].values()
        ),
        "ledger_sha256": _sha256_file(ledger_path),
    })
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--verified-output-format")
    parser.add_argument("--account-evidence", type=Path)
    parser.add_argument("--timeout", type=float, default=120.0)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run_renderer(
            lock_path=args.lock,
            output_dir=args.output,
            apply=args.apply,
            verified_output_format=args.verified_output_format,
            account_evidence_path=args.account_evidence,
            timeout=args.timeout,
        )
    except AuditionError as exc:
        print(str(exc), file=os.sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
