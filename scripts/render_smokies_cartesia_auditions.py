#!/usr/bin/env python3
"""Render the three locked Smokies Cartesia auditions, fail closed.

The command is a dry run unless ``--apply`` is present.  Dry runs never read
an API key and never construct a provider transport.  Apply mode requires a
checked script lock, current redacted account evidence, a pinned local encoder,
and enough room under both the packet and lifetime renderer caps.

This tool deliberately does not upload assets to Originals Studio.  Its output
is an internal listening packet whose WAV masters and local MP3 derivatives
remain under ``output/``.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_UP
from email.utils import parsedate_to_datetime
import hashlib
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path
import random
import re
import struct
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable, Iterable, Mapping, Sequence
import urllib.error
import urllib.request
import wave


REPOSITORY = Path(__file__).resolve().parents[1]
DEFAULT_LOCK = REPOSITORY / "originals/smokies/cartesia_audition_lock_v1.json"
DEFAULT_OUTPUT = REPOSITORY / "output/smokies-original/cartesia-auditions-v1"
TTS_ENDPOINT = "https://api.cartesia.ai/tts/bytes"

RENDERER_CONTRACT = "smokies_cartesia_audition_renderer_v1"
PROVIDER = "cartesia"
VOICE_ID = "f786b574-daa5-4673-aa0c-cbe3e8534c02"
VOICE_NAME = "Katie"
MODEL_SNAPSHOT = "sonic-3.5-2026-05-04"
API_VERSION = "2026-03-01"
LANGUAGE = "en"
OUTPUT_FORMAT = {
    "container": "wav",
    "sample_rate_hz": 44_100,
    "channels": 1,
    "encoding": "pcm_s16le",
}
GENERATION_CONFIG = {"volume": 1.0, "speed": 0.98}

PACKET_CREDIT_CAP = 12_000
PROVIDER_RECOVERY_CREDIT_CAP = 15_000
KNOWN_STREAMING_HEADER_INCIDENT_FINGERPRINT = (
    "8f37d7c2e7797ab3b9db378b5d87beda60cb85e1b362b3cc0e93770df4a1c7c5"
)
KNOWN_COMPLETED_STREAMING_RECOVERY_FINGERPRINTS = {
    "rf_story_02": "d9c7cfa3cbc8b445fcce7cd3c73c6ea18f912735ce2cc6fee400cf35dacd28d3",
    "rf_story_03": "5dd940a716c9af1104822b6ac9425d855da4a951eef950edbdcd7899f608e081",
    "mc_story_02": "1fb5fe44d2c4714c278f514b9997ec300ccc5147239480e937f67cd0b6803d0b",
}
LIFETIME_CREDIT_CAP = 225_000
LIFETIME_DOLLAR_CAP = Decimal("15.00")
MAX_PROVIDER_ATTEMPTS = 3
MAX_RETRY_AFTER_SECONDS = 60.0
MIN_PLAUSIBLE_WPM = 75.0
MAX_PLAUSIBLE_WPM = 240.0
BALANCE_MAX_AGE = timedelta(hours=24)
POLICY_MAX_AGE = timedelta(days=30)
ENCODER_DISTRIBUTION = "imageio-ffmpeg"
ENCODER_VERSION = "0.6.0"
BITRATES_KBPS = (64, 96, 128)
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")

EXPECTED_AUDITIONS = {
    "rf_story_02": {
        "role": "scenic_natural_history",
        "chapter_id": "roaring_fork",
        "source_file": "originals/smokies/editorial_roaring_fork_v1.json",
        "claim_ids": ["rf_stream"],
        "source_ids": ["nps_grsm_natural_features", "nps_grsm_roaring_fork"],
        "transcript_sha256": "2e6d73a5e4ce18bc80441d04e5e4ecca4a2144360024f68d3d67bcafac25ca8c",
        "normalized_character_count": 2844,
        "word_count": 476,
    },
    "rf_story_03": {
        "role": "human_history",
        "chapter_id": "roaring_fork",
        "source_file": "originals/smokies/editorial_roaring_fork_v1.json",
        "claim_ids": ["rf_ogle_farm"],
        "source_ids": ["nps_grsm_roaring_fork"],
        "transcript_sha256": "2dcb129294894980c17b231f92a36ed04f137da272e6ad20a2aaa567e1a0c643",
        "normalized_character_count": 2732,
        "word_count": 461,
    },
    "mc_story_02": {
        "role": "technical_pronunciation",
        "chapter_id": "mountain_crossing",
        "source_file": "originals/smokies/editorial_mountain_crossing_v1.json",
        "claim_ids": ["mc_deep_geology"],
        "source_ids": ["nps_grsm_geology"],
        "transcript_sha256": "f8eeeaeab269dec793b3769ce10882cc4f62880053ce73371b16e0b0af8ee693",
        "normalized_character_count": 4410,
        "word_count": 681,
    },
}


class AuditionError(RuntimeError):
    """A fixed-code, non-sensitive renderer failure."""


@dataclass(frozen=True)
class AuditionScript:
    order: int
    role: str
    entry_id: str
    chapter_id: str
    source_file: str
    source_sha256: str
    transcript: str
    transcript_sha256: str
    word_count: int
    raw_character_count: int
    normalized_character_count: int
    billing_ceiling_credits: int


@dataclass(frozen=True)
class LockedPacket:
    path: Path
    lock_id: str
    lock_sha256: str
    product_id: str
    scripts: tuple[AuditionScript, ...]
    projected_with_contingency: int
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class AccountEvidence:
    file_sha256: str
    balance_credits: int
    overage_enabled: bool
    overage_usd_per_1000: Decimal | None
    plan_evidence_sha256: str
    training_opt_out_evidence_sha256: str
    balance_evidence_sha256: str
    overage_evidence_sha256: str | None
    plan_observed_at: str
    training_opt_out_observed_at: str
    balance_observed_at: str
    overage_observed_at: str | None

    @property
    def balance_snapshot_id(self) -> str:
        """Identity of the immutable balance proof, independent of metadata edits."""
        return self.balance_evidence_sha256

    def public_summary(self) -> dict[str, Any]:
        return {
            "evidence_file_sha256": self.file_sha256,
            "plan": "pro",
            "commercial_use": True,
            "plan_evidence_sha256": self.plan_evidence_sha256,
            "plan_observed_at": self.plan_observed_at,
            "training_opt_out_status": "processed",
            "training_opt_out_enabled": True,
            "training_opt_out_evidence_sha256": (
                self.training_opt_out_evidence_sha256
            ),
            "training_opt_out_observed_at": self.training_opt_out_observed_at,
            "balance_credits": self.balance_credits,
            "balance_evidence_sha256": self.balance_evidence_sha256,
            "balance_observed_at": self.balance_observed_at,
            "balance_snapshot_id": self.balance_snapshot_id,
            "overage_enabled": self.overage_enabled,
            "overage_usd_per_1000": (
                str(self.overage_usd_per_1000)
                if self.overage_usd_per_1000 is not None
                else None
            ),
            "overage_evidence_sha256": self.overage_evidence_sha256,
            "overage_observed_at": self.overage_observed_at,
        }


@dataclass(frozen=True)
class AudioProbe:
    byte_count: int
    sha256: str
    sample_rate_hz: int
    channels: int
    sample_width_bytes: int
    frame_count: int
    duration_s: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "bytes": self.byte_count,
            "sha256": self.sha256,
            "sample_rate_hz": self.sample_rate_hz,
            "channels": self.channels,
            "sample_width_bytes": self.sample_width_bytes,
            "frame_count": self.frame_count,
            "duration_s": round(self.duration_s, 6),
            "encoding": "pcm_s16le",
            "container": "wav",
        }


@dataclass(frozen=True)
class EncoderProvenance:
    executable: str
    distribution: str
    package_version: str
    package_sha256: str
    binary_sha256: str
    version_text_sha256: str
    version_line: str

    def as_dict(self) -> dict[str, str]:
        return {
            "distribution": self.distribution,
            "package_version": self.package_version,
            "package_sha256": self.package_sha256,
            "binary_sha256": self.binary_sha256,
            "version_text_sha256": self.version_text_sha256,
            "version_line": self.version_line,
        }


@dataclass(frozen=True)
class ProviderResponse:
    status_code: int
    headers: Mapping[str, str]
    body: bytes


class UrllibProviderTransport:
    """Small synchronous transport used only after the apply gate passes."""

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
            # HTTPError is a definitive provider response and is therefore safe
            # to classify by status.  Its body is intentionally discarded.
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


def _canonical_sha256(value: Any) -> str:
    return _sha256_bytes(_canonical_bytes(value))


def _normalize_transcript(value: object) -> str:
    return " ".join(str(value or "").split())


def _require_sha256(value: object, code: str) -> str:
    normalized = str(value or "").strip().lower()
    if not SHA256_RE.fullmatch(normalized):
        raise AuditionError(code)
    return normalized


def _positive_int(value: object, code: str, *, allow_zero: bool = False) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise AuditionError(code)
    if value < (0 if allow_zero else 1):
        raise AuditionError(code)
    return value


def _load_json_object(path: Path, code: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise AuditionError(code) from exc
    if not isinstance(value, dict):
        raise AuditionError(code)
    return value


def _inside_repository(repository: Path, raw: object, code: str) -> tuple[str, Path]:
    relative = Path(str(raw or "").strip())
    if not relative.as_posix() or relative.is_absolute():
        raise AuditionError(code)
    repository = repository.resolve()
    candidate = (repository / relative).resolve()
    try:
        candidate.relative_to(repository)
    except ValueError as exc:
        raise AuditionError(code) from exc
    if not candidate.is_file():
        raise AuditionError(code)
    return relative.as_posix(), candidate


def _source_hashes(raw: object) -> dict[str, str]:
    result: dict[str, str] = {}
    if isinstance(raw, dict):
        iterable: Iterable[tuple[object, object]] = raw.items()
    elif isinstance(raw, list):
        pairs: list[tuple[object, object]] = []
        for item in raw:
            if not isinstance(item, dict):
                raise AuditionError("lock_source_files_invalid")
            pairs.append((item.get("path"), item.get("sha256")))
        iterable = pairs
    else:
        raise AuditionError("lock_source_files_invalid")
    for raw_path, raw_hash in iterable:
        path = Path(str(raw_path or "").strip()).as_posix()
        if not path or path in result:
            raise AuditionError("lock_source_files_invalid")
        result[path] = _require_sha256(raw_hash, "lock_source_hash_invalid")
    return result


def _validate_generation_profile(raw: object) -> None:
    if not isinstance(raw, dict):
        raise AuditionError("lock_generation_profile_invalid")
    expected = {
        "provider": PROVIDER,
        "voice_name": VOICE_NAME,
        "voice_id": VOICE_ID,
        "model_snapshot": MODEL_SNAPSHOT,
        "api_version": API_VERSION,
        "language": LANGUAGE,
        "output": OUTPUT_FORMAT,
        "generation_config": GENERATION_CONFIG,
    }
    if raw != expected:
        raise AuditionError("lock_generation_profile_drift")
    if "speed" in raw:
        raise AuditionError("deprecated_top_level_speed_forbidden")


def _find_entry(source: Mapping[str, Any], entry_id: str) -> Mapping[str, Any]:
    entries = source.get("entries")
    if not isinstance(entries, list):
        raise AuditionError("lock_source_entries_invalid")
    matches = [
        item for item in entries
        if isinstance(item, dict) and str(item.get("id") or "") == entry_id
    ]
    if len(matches) != 1:
        raise AuditionError("lock_source_entry_unavailable")
    return matches[0]


def load_locked_packet(
    lock_path: Path,
    *,
    repository: Path = REPOSITORY,
) -> LockedPacket:
    lock_path = lock_path.resolve()
    raw = _load_json_object(lock_path, "audition_lock_unreadable")
    if raw.get("schema_version") != 1:
        raise AuditionError("audition_lock_schema_unsupported")
    if raw.get("lock_status") != "internal_audition_only":
        raise AuditionError("audition_lock_not_approved")
    if raw.get("packet_script_status") != "draft_review_required":
        raise AuditionError("audition_lock_script_status_invalid")
    lock_id = str(raw.get("lock_id") or "").strip()
    product_id = str(raw.get("product_id") or "").strip()
    if not lock_id or not product_id:
        raise AuditionError("audition_lock_identity_invalid")
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
    _validate_generation_profile(raw.get("generation_profile"))

    pronunciation = raw.get("pronunciation_policy")
    if not isinstance(pronunciation, dict):
        raise AuditionError("audition_lock_pronunciation_policy_invalid")
    if pronunciation.get("mode") != "model_default_reviewed_terms":
        raise AuditionError("audition_lock_pronunciation_policy_invalid")
    if pronunciation.get("custom_phonetic_overrides") != []:
        raise AuditionError("audition_lock_phonetic_overrides_forbidden")
    reviewed_terms = pronunciation.get("reviewed_technical_non_cultural_terms")
    if not isinstance(reviewed_terms, list) or not all(
        isinstance(item, str) and item.strip() for item in reviewed_terms
    ):
        raise AuditionError("audition_lock_reviewed_terms_invalid")

    budget = raw.get("budget")
    if not isinstance(budget, dict):
        raise AuditionError("audition_lock_budget_invalid")
    if budget.get("renderer_credit_cap") != PACKET_CREDIT_CAP:
        raise AuditionError("audition_lock_packet_cap_drift")
    if budget.get("credits_per_normalized_character") != 1:
        raise AuditionError("audition_lock_credit_rate_drift")
    contingency = budget.get("contingency_percent")
    if isinstance(contingency, bool) or not isinstance(contingency, (int, float)):
        raise AuditionError("audition_lock_budget_invalid")
    if float(contingency) != 10.0:
        raise AuditionError("audition_lock_contingency_drift")

    source_hashes = _source_hashes(raw.get("source_files"))
    for source_file, expected_source_sha in source_hashes.items():
        _display, source_path = _inside_repository(
            repository, source_file, "audition_lock_source_path_invalid"
        )
        if _sha256_file(source_path) != expected_source_sha:
            raise AuditionError("audition_lock_source_hash_drift")
    source_gate = raw.get("source_gate")
    if not isinstance(source_gate, dict) or source_gate.get("status") != "passed":
        raise AuditionError("audition_lock_source_gate_invalid")
    dossier_file = Path(str(source_gate.get("dossier_file") or "")).as_posix()
    if (
        dossier_file != "originals/smokies/source_dossiers_v1.json"
        or source_hashes.get(dossier_file)
        != _require_sha256(
            source_gate.get("dossier_sha256"), "audition_lock_source_gate_invalid"
        )
    ):
        raise AuditionError("audition_lock_source_gate_invalid")
    audition_rows = raw.get("auditions")
    if not isinstance(audition_rows, list) or len(audition_rows) != 3:
        raise AuditionError("audition_lock_selection_invalid")
    scripts: list[AuditionScript] = []
    seen_ids: set[str] = set()
    seen_orders: set[int] = set()
    for row in audition_rows:
        if not isinstance(row, dict):
            raise AuditionError("audition_lock_selection_invalid")
        entry_id = str(row.get("entry_id") or "").strip()
        expected = EXPECTED_AUDITIONS.get(entry_id)
        if expected is None or entry_id in seen_ids:
            raise AuditionError("audition_lock_selection_invalid")
        seen_ids.add(entry_id)
        order = _positive_int(row.get("order"), "audition_lock_order_invalid")
        if order in seen_orders:
            raise AuditionError("audition_lock_order_invalid")
        seen_orders.add(order)
        role = str(row.get("role") or "").strip()
        if role != expected["role"]:
            raise AuditionError("audition_lock_role_drift")
        if row.get("script_status") != "draft_review_required":
            raise AuditionError("audition_lock_script_status_invalid")
        if row.get("cultural_gate") != "not_required":
            raise AuditionError("audition_lock_cultural_gate_blocked")
        if (
            row.get("source_gate") != "source_verified"
            or row.get("claim_ids") != expected["claim_ids"]
            or row.get("source_ids") != expected["source_ids"]
            or row.get("chapter_id") != expected["chapter_id"]
            or row.get("source_file") != expected["source_file"]
            or row.get("word_count") != expected["word_count"]
        ):
            raise AuditionError("audition_lock_source_binding_drift")

        source_file, source_path = _inside_repository(
            repository,
            row.get("source_file"),
            "audition_lock_source_path_invalid",
        )
        source_sha = source_hashes.get(source_file)
        if source_sha is None or _sha256_file(source_path) != source_sha:
            raise AuditionError("audition_lock_source_hash_drift")
        source = _load_json_object(source_path, "audition_lock_source_unreadable")
        entry = _find_entry(source, entry_id)
        raw_transcript = entry.get("transcript")
        if not isinstance(raw_transcript, str) or not raw_transcript.strip():
            raise AuditionError("audition_lock_transcript_drift")
        transcript = raw_transcript
        normalized_transcript = _normalize_transcript(transcript)
        transcript_sha = _sha256_bytes(transcript.encode("utf-8"))
        locked_sha = _require_sha256(
            row.get("transcript_sha256"), "audition_lock_transcript_hash_invalid"
        )
        characters = _positive_int(
            row.get("normalized_character_count"),
            "audition_lock_character_count_invalid",
        )
        payload_characters = _positive_int(
            row.get("payload_character_count"),
            "audition_lock_payload_character_count_invalid",
        )
        reserved_credit_ceiling = _positive_int(
            row.get("reserved_credit_ceiling"),
            "audition_lock_reserved_credit_ceiling_invalid",
        )
        expected_reserved_credit_ceiling = (
            max(len(transcript), len(normalized_transcript)) * 110 + 99
        ) // 100
        if (
            transcript_sha != locked_sha
            or transcript_sha != expected["transcript_sha256"]
            or len(normalized_transcript) != characters
            or len(transcript) != payload_characters
            or reserved_credit_ceiling != expected_reserved_credit_ceiling
            or characters != expected["normalized_character_count"]
            or entry.get("script_status") != row.get("script_status")
            or str(entry.get("chapter_id") or "")
            != str(row.get("chapter_id") or "")
        ):
            raise AuditionError("audition_lock_transcript_drift")
        scripts.append(AuditionScript(
            order=order,
            role=role,
            entry_id=entry_id,
            chapter_id=str(row.get("chapter_id") or ""),
            source_file=source_file,
            source_sha256=source_sha,
            transcript=transcript,
            transcript_sha256=transcript_sha,
            word_count=int(row["word_count"]),
            raw_character_count=payload_characters,
            normalized_character_count=characters,
            billing_ceiling_credits=reserved_credit_ceiling,
        ))

    if seen_ids != set(EXPECTED_AUDITIONS) or seen_orders != {1, 2, 3}:
        raise AuditionError("audition_lock_selection_invalid")
    scripts.sort(key=lambda item: item.order)
    total = sum(item.normalized_character_count for item in scripts)
    payload_total = sum(item.raw_character_count for item in scripts)
    billing_ceiling_total = sum(
        item.billing_ceiling_credits for item in scripts
    )
    with_contingency = math.ceil(total * 1.10)
    aggregate = raw.get("aggregate")
    if not isinstance(aggregate, dict) or any((
        aggregate.get("normalized_character_count") != total,
        aggregate.get("payload_character_count") != payload_total,
        aggregate.get("projected_credits_before_contingency") != total,
        aggregate.get("projected_credits_with_contingency") != with_contingency,
        aggregate.get("reserved_credit_ceiling") != billing_ceiling_total,
    )):
        raise AuditionError("audition_lock_aggregate_drift")
    if with_contingency > PACKET_CREDIT_CAP:
        raise AuditionError("audition_packet_credit_cap_exceeded")
    if billing_ceiling_total > PACKET_CREDIT_CAP:
        raise AuditionError("audition_packet_billing_ceiling_exceeded")
    return LockedPacket(
        path=lock_path,
        lock_id=lock_id,
        lock_sha256=_sha256_file(lock_path),
        product_id=product_id,
        scripts=tuple(scripts),
        projected_with_contingency=with_contingency,
        raw=raw,
    )


_FORBIDDEN_EVIDENCE_KEY_PARTS = (
    "api_key", "token", "secret", "email", "account_id", "user_id",
    "full_name", "address", "phone", "raw_response",
)


def _reject_sensitive_evidence_fields(value: object) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key).lower()
            if any(part in normalized for part in _FORBIDDEN_EVIDENCE_KEY_PARTS):
                raise AuditionError("account_evidence_contains_sensitive_fields")
            _reject_sensitive_evidence_fields(item)
    elif isinstance(value, list):
        for item in value:
            _reject_sensitive_evidence_fields(item)


def _parse_observed_at(
    raw: object,
    *,
    now: datetime,
    max_age: timedelta,
    code: str,
) -> str:
    value = str(raw or "").strip()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AuditionError(code) from exc
    if parsed.tzinfo is None:
        raise AuditionError(code)
    parsed = parsed.astimezone(timezone.utc)
    current = now.astimezone(timezone.utc)
    if parsed > current + timedelta(minutes=5) or current - parsed > max_age:
        raise AuditionError(code)
    return _iso(parsed)


def _evidence_component(
    value: object,
    *,
    now: datetime,
    max_age: timedelta,
    code: str,
) -> tuple[dict[str, Any], str, str]:
    if not isinstance(value, dict):
        raise AuditionError(code)
    evidence_sha = _require_sha256(value.get("evidence_sha256"), code)
    observed_at = _parse_observed_at(
        value.get("observed_at"), now=now, max_age=max_age, code=code
    )
    return value, evidence_sha, observed_at


def load_account_evidence(
    path: Path,
    *,
    now: datetime | None = None,
) -> AccountEvidence:
    now = now or _utc_now()
    raw = _load_json_object(path, "account_evidence_unreadable")
    _reject_sensitive_evidence_fields(raw)
    if raw.get("schema_version") != 1 or raw.get("provider") != PROVIDER:
        raise AuditionError("account_evidence_schema_invalid")
    plan, plan_hash, plan_observed_at = _evidence_component(
        raw.get("plan"), now=now, max_age=POLICY_MAX_AGE,
        code="account_plan_evidence_invalid",
    )
    if (
        str(plan.get("name") or "").lower() != "pro"
        or plan.get("status") != "active"
        or plan.get("commercial_use") is not True
    ):
        raise AuditionError("cartesia_pro_commercial_use_not_proven")
    training, training_hash, training_observed_at = _evidence_component(
        raw.get("training_opt_out"), now=now, max_age=POLICY_MAX_AGE,
        code="training_opt_out_evidence_invalid",
    )
    if training.get("status") != "processed" or training.get("enabled") is not True:
        raise AuditionError("training_opt_out_not_processed")
    balance, balance_hash, balance_observed_at = _evidence_component(
        raw.get("credit_balance"), now=now, max_age=BALANCE_MAX_AGE,
        code="credit_balance_evidence_invalid",
    )
    credits = _positive_int(
        balance.get("credits"), "credit_balance_evidence_invalid", allow_zero=True
    )
    overage_value = raw.get("overage")
    overage_rate: Decimal | None = None
    overage_hash: str | None = None
    overage_observed_at: str | None = None
    if overage_value is None:
        raise AuditionError("overage_state_evidence_required")
    overage, overage_hash, overage_observed_at = _evidence_component(
        overage_value, now=now, max_age=BALANCE_MAX_AGE,
        code="overage_evidence_invalid",
    )
    overage_enabled = overage.get("enabled")
    if not isinstance(overage_enabled, bool):
        raise AuditionError("overage_evidence_invalid")
    if overage_enabled:
        if overage.get("usd_per_1000_credits") in (None, ""):
            raise AuditionError("overage_rate_required")
        try:
            overage_rate = Decimal(str(overage.get("usd_per_1000_credits")))
        except (InvalidOperation, ValueError) as exc:
            raise AuditionError("overage_evidence_invalid") from exc
        if not overage_rate.is_finite() or overage_rate <= 0:
            raise AuditionError("overage_evidence_invalid")
    elif overage.get("usd_per_1000_credits") not in (None, ""):
        raise AuditionError("overage_evidence_invalid")
    return AccountEvidence(
        file_sha256=_sha256_file(path),
        balance_credits=credits,
        overage_enabled=overage_enabled,
        overage_usd_per_1000=overage_rate,
        plan_evidence_sha256=plan_hash,
        training_opt_out_evidence_sha256=training_hash,
        balance_evidence_sha256=balance_hash,
        overage_evidence_sha256=overage_hash,
        plan_observed_at=plan_observed_at,
        training_opt_out_observed_at=training_observed_at,
        balance_observed_at=balance_observed_at,
        overage_observed_at=overage_observed_at,
    )


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="wb", prefix=f".{path.name}.", suffix=".tmp",
        dir=path.parent, delete=False,
    )
    temporary = Path(handle.name)
    try:
        with handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
        except OSError:
            directory_fd = None
        if directory_fd is not None:
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


def _atomic_json(path: Path, value: object) -> None:
    _atomic_write(
        path,
        (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
        .encode("utf-8"),
    )


def _new_ledger(packet: LockedPacket, now: datetime) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "renderer_contract": RENDERER_CONTRACT,
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "generation_profile_sha256": _canonical_sha256(
            packet.raw["generation_profile"]
        ),
        "credit_accounting": "conservative_per_request_billing_ceiling",
        "created_at": _iso(now),
        "updated_at": _iso(now),
        "credits_committed_total": 0,
        "overage_usd_committed_total": "0.00",
        "entries": {},
    }


def _load_ledger(path: Path, packet: LockedPacket, now: datetime) -> dict[str, Any]:
    if not path.exists():
        return _new_ledger(packet, now)
    ledger = _load_json_object(path, "audition_ledger_unreadable")
    if (
        ledger.get("schema_version") != 1
        or ledger.get("renderer_contract") != RENDERER_CONTRACT
        or ledger.get("lock_id") != packet.lock_id
        or ledger.get("lock_sha256") != packet.lock_sha256
        or ledger.get("generation_profile_sha256")
        != _canonical_sha256(packet.raw["generation_profile"])
        or ledger.get("credit_accounting")
        != "conservative_per_request_billing_ceiling"
    ):
        raise AuditionError("audition_ledger_lock_drift")
    _positive_int(
        ledger.get("credits_committed_total"),
        "audition_ledger_invalid",
        allow_zero=True,
    )
    try:
        dollars = Decimal(str(ledger.get("overage_usd_committed_total")))
    except InvalidOperation as exc:
        raise AuditionError("audition_ledger_invalid") from exc
    if not dollars.is_finite() or dollars < 0:
        raise AuditionError("audition_ledger_invalid")
    if not isinstance(ledger.get("entries"), dict):
        raise AuditionError("audition_ledger_invalid")
    return ledger


def probe_wav_bytes(content: bytes) -> AudioProbe:
    if len(content) < 44 or content[:4] != b"RIFF" or content[8:12] != b"WAVE":
        raise AuditionError("cartesia_audio_not_riff_wave")
    if struct.unpack("<I", content[4:8])[0] != len(content) - 8:
        raise AuditionError("cartesia_audio_wav_invalid")
    try:
        with wave.open(io.BytesIO(content), "rb") as audio:
            channels = audio.getnchannels()
            sample_width = audio.getsampwidth()
            sample_rate = audio.getframerate()
            frames = audio.getnframes()
            compression = audio.getcomptype()
            frame_bytes = audio.readframes(frames)
    except (wave.Error, EOFError) as exc:
        raise AuditionError("cartesia_audio_wav_invalid") from exc
    if (
        channels != 1
        or sample_width != 2
        or sample_rate != 44_100
        or frames < 1
        or compression != "NONE"
        or len(frame_bytes) != frames * channels * sample_width
    ):
        raise AuditionError("cartesia_audio_pcm_profile_mismatch")
    return AudioProbe(
        byte_count=len(content),
        sha256=_sha256_bytes(content),
        sample_rate_hz=sample_rate,
        channels=channels,
        sample_width_bytes=sample_width,
        frame_count=frames,
        duration_s=frames / sample_rate,
    )


def canonicalize_streamed_wav(content: bytes) -> tuple[bytes, bool]:
    """Finalize only the unknown-length RIFF markers used by streamed WAVs.

    Cartesia's bytes endpoint streams the response body while it is generated.
    A streamed WAV may therefore carry 0xFFFFFFFF in the RIFF and data-size
    fields because the final byte count was not known when the header was sent.
    We replace only those explicit sentinel values after the complete HTTP body
    has been buffered. Arbitrary size mismatches and malformed chunk layouts
    remain fatal.
    """
    if len(content) < 44 or content[:4] != b"RIFF" or content[8:12] != b"WAVE":
        raise AuditionError("cartesia_audio_not_riff_wave")

    result = bytearray(content)
    repaired = False
    riff_size = struct.unpack("<I", result[4:8])[0]
    if riff_size == 0xFFFFFFFF:
        result[4:8] = struct.pack("<I", len(result) - 8)
        repaired = True
    elif riff_size != len(result) - 8:
        raise AuditionError("cartesia_audio_wav_invalid")

    offset = 12
    found_data = False
    while offset + 8 <= len(result):
        chunk_id = bytes(result[offset : offset + 4])
        chunk_size = struct.unpack("<I", result[offset + 4 : offset + 8])[0]
        payload_start = offset + 8
        if chunk_id == b"data" and chunk_size == 0xFFFFFFFF:
            # The data chunk must be last when its streamed length is unknown;
            # otherwise its boundary cannot be established safely.
            chunk_size = len(result) - payload_start
            result[offset + 4 : offset + 8] = struct.pack("<I", chunk_size)
            repaired = True
        payload_end = payload_start + chunk_size
        if payload_end > len(result):
            raise AuditionError("cartesia_audio_wav_invalid")
        if chunk_id == b"data":
            found_data = True
        offset = payload_end + (chunk_size & 1)

    if not found_data or offset != len(result):
        raise AuditionError("cartesia_audio_wav_invalid")
    return bytes(result), repaired


def probe_wav_file(path: Path) -> AudioProbe:
    try:
        return probe_wav_bytes(path.read_bytes())
    except OSError as exc:
        raise AuditionError("audition_master_unavailable") from exc


def validate_audition_duration(
    script: AuditionScript,
    probe: AudioProbe,
) -> None:
    minutes = probe.duration_s / 60.0
    if minutes <= 0:
        raise AuditionError("cartesia_audio_duration_implausible")
    words_per_minute = script.word_count / minutes
    if not MIN_PLAUSIBLE_WPM <= words_per_minute <= MAX_PLAUSIBLE_WPM:
        raise AuditionError("cartesia_audio_duration_implausible")


def _distribution_sha256(distribution_name: str) -> str:
    try:
        distribution = importlib.metadata.distribution(distribution_name)
    except importlib.metadata.PackageNotFoundError as exc:
        raise AuditionError("pinned_encoder_unavailable") from exc
    records: list[tuple[str, str]] = []
    for item in sorted(distribution.files or [], key=lambda value: str(value)):
        path = Path(distribution.locate_file(item))
        if path.is_file():
            records.append((str(item).replace("\\", "/"), _sha256_file(path)))
    if not records:
        raise AuditionError("pinned_encoder_unavailable")
    return _canonical_sha256(records)


def probe_pinned_encoder() -> EncoderProvenance:
    try:
        version = importlib.metadata.version(ENCODER_DISTRIBUTION)
    except importlib.metadata.PackageNotFoundError as exc:
        raise AuditionError("pinned_encoder_unavailable") from exc
    if version != ENCODER_VERSION:
        raise AuditionError("pinned_encoder_version_mismatch")
    try:
        import imageio_ffmpeg  # type: ignore[import-not-found]

        executable = Path(imageio_ffmpeg.get_ffmpeg_exe()).resolve(strict=True)
    except (ImportError, OSError) as exc:
        raise AuditionError("pinned_encoder_unavailable") from exc
    result = subprocess.run(
        [str(executable), "-version"], capture_output=True, check=False,
        timeout=10,
    )
    version_output = result.stdout + result.stderr
    if result.returncode != 0 or not version_output:
        raise AuditionError("pinned_encoder_probe_failed")
    version_line = version_output.decode("utf-8", errors="replace").splitlines()[0][:200]
    return EncoderProvenance(
        executable=str(executable),
        distribution=ENCODER_DISTRIBUTION,
        package_version=version,
        package_sha256=_distribution_sha256(ENCODER_DISTRIBUTION),
        binary_sha256=_sha256_file(executable),
        version_text_sha256=_sha256_bytes(version_output),
        version_line=version_line,
    )


def build_encoder_command(
    executable: str,
    master: Path,
    destination: Path,
    bitrate_kbps: int,
) -> list[str]:
    if bitrate_kbps not in BITRATES_KBPS:
        raise AuditionError("encoder_bitrate_unsupported")
    return [
        executable,
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        "-y",
        "-i", str(master),
        "-map_metadata", "-1",
        "-vn",
        "-ac", "1",
        "-ar", "44100",
        "-codec:a", "libmp3lame",
        "-b:a", f"{bitrate_kbps}k",
        "-write_xing", "0",
        "-fflags", "+bitexact",
        "-flags:a", "+bitexact",
        "-f", "mp3",
        str(destination),
    ]


def encode_derivatives(
    master: Path,
    directory: Path,
    encoder: EncoderProvenance,
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    directory.mkdir(parents=True, exist_ok=True)
    for bitrate in BITRATES_KBPS:
        destination = directory / f"delivery-{bitrate}.mp3"
        temporary = directory / f".delivery-{bitrate}.{os.getpid()}.mp3"
        temporary.unlink(missing_ok=True)
        command = build_encoder_command(
            encoder.executable, master, temporary, bitrate
        )
        completed = subprocess.run(
            command, capture_output=True, check=False, timeout=180,
        )
        if completed.returncode != 0 or not temporary.is_file():
            temporary.unlink(missing_ok=True)
            raise AuditionError("local_encoder_failed")
        content = temporary.read_bytes()
        if len(content) < 128 or not (
            content.startswith(b"ID3")
            or (content[0] == 0xFF and content[1] & 0xE0 == 0xE0)
        ):
            temporary.unlink(missing_ok=True)
            raise AuditionError("local_encoder_output_invalid")
        os.replace(temporary, destination)
        result[str(bitrate)] = {
            "path": destination.name,
            "bitrate_kbps": bitrate,
            "bytes": len(content),
            "sha256": _sha256_bytes(content),
        }
    return result


def _request_payload(script: AuditionScript) -> dict[str, Any]:
    return {
        "model_id": MODEL_SNAPSHOT,
        "transcript": script.transcript,
        "voice": {"mode": "id", "id": VOICE_ID},
        "language": LANGUAGE,
        "output_format": {
            "container": "wav",
            "sample_rate": 44_100,
            "encoding": "pcm_s16le",
        },
        "generation_config": dict(GENERATION_CONFIG),
    }


def _request_fingerprint(packet: LockedPacket, script: AuditionScript) -> str:
    return _canonical_sha256({
        "renderer_contract": RENDERER_CONTRACT,
        "renderer_source_sha256": _renderer_source_sha256(),
        "provider_endpoint": TTS_ENDPOINT,
        "accept": "audio/wav",
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "entry_id": script.entry_id,
        "source_file": script.source_file,
        "source_sha256": script.source_sha256,
        "transcript_sha256": script.transcript_sha256,
        "word_count": script.word_count,
        "request_payload_sha256": _canonical_sha256(_request_payload(script)),
    })


def _retry_after_seconds(
    headers: Mapping[str, str], now: datetime,
) -> float:
    raw = next(
        (value for key, value in headers.items() if key.lower() == "retry-after"),
        "",
    ).strip()
    if not raw:
        return 0.0
    try:
        seconds = float(raw)
    except ValueError:
        try:
            parsed = parsedate_to_datetime(raw)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            seconds = (parsed - now).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return 0.0
    return min(MAX_RETRY_AFTER_SECONDS, max(0.0, seconds))


def _redacted_attempt(number: int, state: str, now: datetime, **extra: Any) -> dict:
    allowed = {
        key: value for key, value in extra.items()
        if key in {"http_status", "retry_after_s"}
    }
    return {"number": number, "state": state, "at": _iso(now), **allowed}


def _master_matches(
    entry: Mapping[str, Any],
    *,
    fingerprint: str,
    master_path: Path,
) -> AudioProbe | None:
    if entry.get("request_fingerprint") != fingerprint:
        return None
    master = entry.get("master")
    if not isinstance(master, dict) or not master_path.is_file():
        return None
    try:
        probe = probe_wav_file(master_path)
    except AuditionError:
        return None
    if (
        master.get("sha256") != probe.sha256
        or master.get("bytes") != probe.byte_count
        or master.get("frame_count") != probe.frame_count
        or master.get("sample_rate_hz") != 44_100
        or master.get("channels") != 1
        or master.get("sample_width_bytes") != 2
    ):
        return None
    return probe


def _decimal_string(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.000001"))).rstrip("0").rstrip(".") or "0"


def _overage_cost(credits: int, rate: Decimal) -> Decimal:
    return (Decimal(credits) / Decimal(1000) * rate).quantize(
        Decimal("0.000001"), rounding=ROUND_UP
    )


def _renderer_source_sha256() -> str:
    return _sha256_file(Path(__file__).resolve())


def _provenance(
    *,
    packet: LockedPacket,
    script: AuditionScript,
    fingerprint: str,
    probe: AudioProbe,
    derivatives: Mapping[str, Any],
    encoder: EncoderProvenance,
    account: AccountEvidence,
    now: datetime,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "kind": "cartesia_internal_audition_provenance",
        "renderer_contract": RENDERER_CONTRACT,
        "renderer_source_sha256": _renderer_source_sha256(),
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "product_id": packet.product_id,
        "entry_id": script.entry_id,
        "role": script.role,
        "source_file": script.source_file,
        "source_sha256": script.source_sha256,
        "transcript_sha256": script.transcript_sha256,
        "payload_character_count": script.raw_character_count,
        "normalized_character_count": script.normalized_character_count,
        "reserved_credit_ceiling": script.billing_ceiling_credits,
        "request_fingerprint": fingerprint,
        "provider": PROVIDER,
        "voice_name": VOICE_NAME,
        "voice_id": VOICE_ID,
        "model_snapshot": MODEL_SNAPSHOT,
        "api_version": API_VERSION,
        "language": LANGUAGE,
        "generation_config": dict(GENERATION_CONFIG),
        "output_format": dict(OUTPUT_FORMAT),
        "commercial_plan": "pro",
        "commercial_use": True,
        "plan_evidence_sha256": account.plan_evidence_sha256,
        "plan_observed_at": account.plan_observed_at,
        "training_opt_out_status": "processed",
        "training_opt_out_enabled": True,
        "training_opt_out_evidence_sha256": (
            account.training_opt_out_evidence_sha256
        ),
        "training_opt_out_observed_at": account.training_opt_out_observed_at,
        "master": probe.as_dict(),
        "derivatives": dict(derivatives),
        "encoder": encoder.as_dict(),
        "created_at": _iso(now),
    }


def _save_ledger(path: Path, ledger: dict[str, Any], now: datetime) -> None:
    ledger["updated_at"] = _iso(now)
    _atomic_json(path, ledger)


def _commit_cost(
    ledger: dict[str, Any],
    credits: int,
    overage_usd: Decimal,
) -> None:
    ledger["credits_committed_total"] = (
        int(ledger["credits_committed_total"]) + credits
    )
    previous = Decimal(str(ledger["overage_usd_committed_total"]))
    ledger["overage_usd_committed_total"] = _decimal_string(
        previous + overage_usd
    )


def _release_cost(
    ledger: dict[str, Any],
    credits: int,
    overage_usd: Decimal,
) -> None:
    remaining_credits = int(ledger["credits_committed_total"]) - credits
    previous = Decimal(str(ledger["overage_usd_committed_total"]))
    remaining_overage = previous - overage_usd
    if remaining_credits < 0 or remaining_overage < 0:
        raise AuditionError("audition_ledger_reservation_invalid")
    ledger["credits_committed_total"] = remaining_credits
    ledger["overage_usd_committed_total"] = _decimal_string(
        remaining_overage
    )


def _default_retry_jitter(base_seconds: float) -> float:
    return random.SystemRandom().uniform(0.0, base_seconds * 0.25)


def run_renderer(
    *,
    lock_path: Path = DEFAULT_LOCK,
    output_directory: Path = DEFAULT_OUTPUT,
    account_evidence_path: Path | None = None,
    apply: bool = False,
    rerender_ids: Sequence[str] = (),
    approve_provider_recovery: bool = False,
    repository: Path = REPOSITORY,
    transport: Any | None = None,
    encoder: EncoderProvenance | None = None,
    encoder_runner: Callable[[Path, Path, EncoderProvenance], dict[str, dict[str, Any]]] = encode_derivatives,
    sleep: Callable[[float], None] = time.sleep,
    retry_jitter: Callable[[float], float] = _default_retry_jitter,
    duration_validator: Callable[
        [AuditionScript, AudioProbe], None
    ] = validate_audition_duration,
    now: datetime | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    now = now or _utc_now()
    packet = load_locked_packet(lock_path, repository=repository)
    output_directory = output_directory.resolve()
    ledger_path = output_directory / "ledger.json"
    ledger = _load_ledger(ledger_path, packet, now)
    requested_rerenders = tuple(dict.fromkeys(str(item) for item in rerender_ids))
    invalid_rerenders = set(requested_rerenders) - set(EXPECTED_AUDITIONS)
    if invalid_rerenders:
        raise AuditionError("rerender_id_not_locked")

    actions: list[dict[str, Any]] = []
    for script in packet.scripts:
        fingerprint = _request_fingerprint(packet, script)
        directory = output_directory / script.entry_id
        existing = ledger["entries"].get(script.entry_id, {})
        if not isinstance(existing, dict):
            raise AuditionError("audition_ledger_invalid")
        match_fingerprint = fingerprint
        known_completed_fingerprint = (
            KNOWN_COMPLETED_STREAMING_RECOVERY_FINGERPRINTS.get(script.entry_id)
        )
        if (
            existing.get("request_fingerprint") == known_completed_fingerprint
            and existing.get("transcript_sha256") == script.transcript_sha256
            and existing.get("payload_character_count") == script.raw_character_count
            and existing.get("normalized_character_count")
            == script.normalized_character_count
            and existing.get("reserved_credit_ceiling")
            == script.billing_ceiling_credits
        ):
            match_fingerprint = known_completed_fingerprint
        probe = _master_matches(
            existing,
            fingerprint=match_fingerprint,
            master_path=directory / "master.wav",
        )
        if script.entry_id in requested_rerenders:
            action = "rerender"
        elif probe is not None:
            action = "resume"
        elif existing.get("state") == "unknown_provider_state":
            raise AuditionError("unknown_provider_state_requires_reconciliation")
        elif existing:
            raise AuditionError("existing_audition_requires_explicit_rerender")
        else:
            action = "generate"
        actions.append({
            "script": script,
            "fingerprint": fingerprint,
            "directory": directory,
            "existing": existing,
            "probe": probe,
            "action": action,
        })

    chargeable = [item for item in actions if item["action"] in {"generate", "rerender"}]
    projected_credits = sum(
        item["script"].billing_ceiling_credits for item in chargeable
    )
    if projected_credits > PACKET_CREDIT_CAP:
        raise AuditionError("audition_packet_credit_cap_exceeded")
    committed_credits = int(ledger["credits_committed_total"])
    recovery_entry = ledger["entries"].get("rf_story_02", {})
    recovery_attempts = recovery_entry.get("attempts", []) if isinstance(
        recovery_entry, dict
    ) else []
    provider_recovery_allowed = (
        approve_provider_recovery
        and requested_rerenders == ("rf_story_02",)
        and recovery_entry.get("state") == "invalid_audio"
        and len(recovery_attempts) == 1
        and recovery_attempts[0].get("state") == "invalid_audio"
        and recovery_attempts[0].get("http_status") == 200
        and recovery_entry.get("request_fingerprint")
        == KNOWN_STREAMING_HEADER_INCIDENT_FINGERPRINT
        and recovery_entry.get("transcript_sha256")
        == next(
            item["script"].transcript_sha256
            for item in actions
            if item["script"].entry_id == "rf_story_02"
        )
        and recovery_entry.get("payload_character_count") == 2_850
        and recovery_entry.get("normalized_character_count") == 2_844
        and recovery_entry.get("reserved_credit_ceiling") == 3_135
        and not (output_directory / "rf_story_02" / "master.wav").exists()
    )
    if approve_provider_recovery and not provider_recovery_allowed:
        raise AuditionError("provider_recovery_not_eligible")
    cumulative_packet_cap = (
        PROVIDER_RECOVERY_CREDIT_CAP
        if provider_recovery_allowed
        else PACKET_CREDIT_CAP
    )
    if committed_credits + projected_credits > LIFETIME_CREDIT_CAP:
        raise AuditionError("renderer_lifetime_credit_cap_exceeded")
    if (
        projected_credits > 0
        and committed_credits + projected_credits > cumulative_packet_cap
    ):
        raise AuditionError("audition_packet_cumulative_credit_cap_exceeded")

    account: AccountEvidence | None = None
    if account_evidence_path is not None:
        account = load_account_evidence(account_evidence_path, now=now)
    if apply and account is None:
        raise AuditionError("account_evidence_required_for_apply")

    projected_overage = Decimal("0")
    overage_by_id: dict[str, Decimal] = {}
    if account is not None:
        # Treat every balance observation as pre-packet and conservatively
        # subtract all credits that this immutable audition ledger has put at
        # risk. A new screenshot/hash can therefore never reset the budget.
        already_reconciled = committed_credits
        remaining_balance = max(0, account.balance_credits - already_reconciled)
        if not account.overage_enabled and projected_credits > remaining_balance:
            raise AuditionError("verified_balance_insufficient_overage_disabled")
        for item in chargeable:
            script = item["script"]
            if account.overage_enabled:
                if account.overage_usd_per_1000 is None:
                    raise AuditionError("overage_rate_required")
                # The API key shares a live balance with other usage. Enforce
                # the dollar cap against the worst case where none of the
                # observed credits remain when this request reaches Cartesia.
                cost = _overage_cost(
                    script.billing_ceiling_credits,
                    account.overage_usd_per_1000,
                )
            else:
                cost = Decimal("0")
            overage_by_id[script.entry_id] = cost
            projected_overage += cost
        previous_overage = Decimal(str(ledger["overage_usd_committed_total"]))
        if previous_overage + projected_overage > LIFETIME_DOLLAR_CAP:
            raise AuditionError("renderer_lifetime_dollar_cap_exceeded")

    preflight = {
        "schema_version": 1,
        "kind": "cartesia_internal_audition_preflight",
        "renderer_contract": RENDERER_CONTRACT,
        "mode": "apply" if apply else "dry_run",
        "network_allowed": bool(apply),
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "generation_profile_sha256": _canonical_sha256(
            packet.raw["generation_profile"]
        ),
        "renderer_source_sha256": _renderer_source_sha256(),
        "limits": {
            "packet_credit_cap": PACKET_CREDIT_CAP,
            "provider_recovery_credit_cap": (
                PROVIDER_RECOVERY_CREDIT_CAP if provider_recovery_allowed else None
            ),
            "provider_recovery_authorized": provider_recovery_allowed,
            "lifetime_credit_cap": LIFETIME_CREDIT_CAP,
            "lifetime_dollar_cap_before_tax": str(LIFETIME_DOLLAR_CAP),
        },
        "lock_projected_credits_with_contingency": (
            packet.projected_with_contingency
        ),
        "lock_payload_character_count": sum(
            script.raw_character_count for script in packet.scripts
        ),
        "lock_normalized_character_count": sum(
            script.normalized_character_count for script in packet.scripts
        ),
        "lock_reserved_credit_ceiling": sum(
            script.billing_ceiling_credits for script in packet.scripts
        ),
        "credits_committed_before_run": committed_credits,
        "credits_reconciled_against_current_balance_snapshot": (
            committed_credits if account is not None else None
        ),
        "credits_projected_this_run": projected_credits,
        "payload_characters_projected_this_run": sum(
            item["script"].raw_character_count for item in chargeable
        ),
        "normalized_characters_projected_this_run": sum(
            item["script"].normalized_character_count for item in chargeable
        ),
        "credit_accounting": "conservative_per_request_billing_ceiling",
        "overage_usd_projected_this_run": (
            _decimal_string(projected_overage) if account is not None else None
        ),
        "account_evidence": account.public_summary() if account else None,
        "auditions": [{
            "order": item["script"].order,
            "entry_id": item["script"].entry_id,
            "role": item["script"].role,
            "transcript_sha256": item["script"].transcript_sha256,
            "word_count": item["script"].word_count,
            "payload_character_count": item["script"].raw_character_count,
            "normalized_character_count": item["script"].normalized_character_count,
            "reserved_credit_ceiling": item["script"].billing_ceiling_credits,
            "request_fingerprint": item["fingerprint"],
            "action": item["action"],
            "projected_overage_usd": (
                _decimal_string(overage_by_id.get(item["script"].entry_id, Decimal("0")))
                if account is not None and item["action"] in {"generate", "rerender"}
                else None
            ),
        } for item in actions],
        "created_at": _iso(now),
    }
    _atomic_json(output_directory / "preflight.json", preflight)
    if not apply:
        return preflight

    secret = api_key if api_key is not None else os.environ.get("CARTESIA_API_KEY")
    if not secret or not secret.strip():
        raise AuditionError("cartesia_api_key_unavailable")
    # API keys are deliberately never accepted as command-line arguments and
    # are never copied into preflight, ledger, provenance, or exceptions.
    secret = secret.strip()
    encoder = encoder or probe_pinned_encoder()
    transport = transport or UrllibProviderTransport()
    assert account is not None

    for item in actions:
        script: AuditionScript = item["script"]
        fingerprint = item["fingerprint"]
        directory: Path = item["directory"]
        directory.mkdir(parents=True, exist_ok=True)
        master_path = directory / "master.wav"
        existing = dict(item["existing"])
        attempts = list(existing.get("attempts") or [])
        generation_cost = overage_by_id.get(script.entry_id, Decimal("0"))
        probe: AudioProbe | None = item["probe"]

        if item["action"] in {"generate", "rerender"}:
            payload = _canonical_bytes(_request_payload(script))
            entry = {
                **existing,
                "entry_id": script.entry_id,
                "transcript_sha256": script.transcript_sha256,
                "word_count": script.word_count,
                "request_fingerprint": fingerprint,
                "payload_character_count": script.raw_character_count,
                "normalized_character_count": script.normalized_character_count,
                "reserved_credit_ceiling": script.billing_ceiling_credits,
                "state": "started",
                "attempts": attempts,
                "account_evidence_sha256": account.file_sha256,
            }
            ledger["entries"][script.entry_id] = entry
            for attempt_index in range(1, MAX_PROVIDER_ATTEMPTS + 1):
                attempt_number = len(attempts) + 1
                attempt_started = _redacted_attempt(
                    attempt_number, "started", now,
                )
                attempts.append(attempt_started)
                entry["attempts"] = attempts
                entry["state"] = "started"
                _commit_cost(
                    ledger,
                    script.billing_ceiling_credits,
                    generation_cost,
                )
                _save_ledger(ledger_path, ledger, now)
                try:
                    response = transport.post(
                        TTS_ENDPOINT,
                        headers={
                            "Authorization": f"Bearer {secret}",
                            "Cartesia-Version": API_VERSION,
                            "Accept": "audio/wav",
                            "Content-Type": "application/json",
                        },
                        body=payload,
                        timeout=120.0,
                    )
                except (TimeoutError, ConnectionError, OSError, urllib.error.URLError):
                    attempts[-1] = _redacted_attempt(
                        attempt_number, "unknown_provider_state", now,
                    )
                    entry["state"] = "unknown_provider_state"
                    _save_ledger(ledger_path, ledger, now)
                    raise AuditionError("unknown_provider_state") from None

                status = int(response.status_code)
                if status == 200:
                    try:
                        canonical_audio, header_repaired = canonicalize_streamed_wav(
                            response.body
                        )
                        probe = probe_wav_bytes(canonical_audio)
                        duration_validator(script, probe)
                    except AuditionError:
                        attempts[-1] = _redacted_attempt(
                            attempt_number, "invalid_audio", now, http_status=200,
                        )
                        entry["state"] = "invalid_audio"
                        _save_ledger(ledger_path, ledger, now)
                        raise
                    _atomic_write(master_path, canonical_audio)
                    attempts[-1] = _redacted_attempt(
                        attempt_number, "audio_received", now, http_status=200,
                    )
                    entry["master"] = probe.as_dict()
                    entry["streamed_wav_header_repaired"] = header_repaired
                    entry["transport_audio_sha256"] = _sha256_bytes(response.body)
                    entry["state"] = "master_complete"
                    _save_ledger(ledger_path, ledger, now)
                    break

                retryable = status == 429 or 500 <= status <= 599
                if retryable:
                    _release_cost(
                        ledger,
                        script.billing_ceiling_credits,
                        generation_cost,
                    )
                    retry_after = _retry_after_seconds(response.headers, now)
                    if retry_after <= 0:
                        base_retry = min(8.0, float(2 ** (attempt_index - 1)))
                        jitter = max(0.0, min(base_retry * 0.25, retry_jitter(base_retry)))
                        retry_after = min(
                            MAX_RETRY_AFTER_SECONDS, base_retry + jitter
                        )
                    attempts[-1] = _redacted_attempt(
                        attempt_number, "retryable_provider_response", now,
                        http_status=status, retry_after_s=retry_after,
                    )
                    entry["state"] = "retry_wait"
                    _save_ledger(ledger_path, ledger, now)
                    if attempt_index < MAX_PROVIDER_ATTEMPTS:
                        sleep(retry_after)
                        continue
                    entry["state"] = "provider_retry_exhausted"
                    _save_ledger(ledger_path, ledger, now)
                    raise AuditionError("provider_retry_exhausted")

                attempts[-1] = _redacted_attempt(
                    attempt_number, "definitive_provider_rejection", now,
                    http_status=status,
                )
                _release_cost(
                    ledger,
                    script.billing_ceiling_credits,
                    generation_cost,
                )
                entry["state"] = "provider_rejected"
                _save_ledger(ledger_path, ledger, now)
                raise AuditionError("provider_rejected")

        if probe is None:
            probe = _master_matches(
                ledger["entries"].get(script.entry_id, {}),
                fingerprint=fingerprint,
                master_path=master_path,
            )
        if probe is None:
            raise AuditionError("audition_master_resume_validation_failed")
        duration_validator(script, probe)
        derivatives = encoder_runner(master_path, directory, encoder)
        provenance = _provenance(
            packet=packet,
            script=script,
            fingerprint=fingerprint,
            probe=probe,
            derivatives=derivatives,
            encoder=encoder,
            account=account,
            now=now,
        )
        _atomic_json(directory / "provenance.json", provenance)
        entry = ledger["entries"].setdefault(script.entry_id, {})
        entry.update({
            "entry_id": script.entry_id,
            "transcript_sha256": script.transcript_sha256,
            "word_count": script.word_count,
            "request_fingerprint": fingerprint,
            "payload_character_count": script.raw_character_count,
            "normalized_character_count": script.normalized_character_count,
            "reserved_credit_ceiling": script.billing_ceiling_credits,
            "master": probe.as_dict(),
            "derivatives": derivatives,
            "provenance_sha256": _sha256_file(directory / "provenance.json"),
            "state": "complete",
        })
        _save_ledger(ledger_path, ledger, now)

    return {
        **preflight,
        "status": "complete",
        "credits_committed_after_run": ledger["credits_committed_total"],
        "overage_usd_committed_after_run": ledger["overage_usd_committed_total"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--account-evidence", type=Path)
    parser.add_argument(
        "--apply", action="store_true",
        help="Permit the checked provider requests. Omit for a network-free dry run.",
    )
    parser.add_argument(
        "--rerender", action="append", default=[], metavar="ENTRY_ID",
        help="Explicitly spend credits to replace one locked audition.",
    )
    parser.add_argument(
        "--approve-provider-recovery", action="store_true",
        help=(
            "Permit the single ledger-bound recovery for the first streamed-WAV "
            "header failure. It cannot authorize ordinary rerenders."
        ),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run_renderer(
            lock_path=args.lock,
            output_directory=args.output,
            account_evidence_path=args.account_evidence,
            apply=args.apply,
            rerender_ids=args.rerender,
            approve_provider_recovery=args.approve_provider_recovery,
        )
    except AuditionError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({
        "mode": result["mode"],
        "lock_sha256": result["lock_sha256"],
        "credits_projected_this_run": result["credits_projected_this_run"],
        "status": result.get("status", "dry_run_complete"),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
