#!/usr/bin/env python3
"""Fail-closed renderer for the approved 72-request Smokies James batch.

Dry-run is the default. Apply renders exactly one chapter, reads one restricted
key from stdin, writes only to a dedicated external root, and requires an
independent hash-bound audit plus fresh key/account evidence. Provider calls
are impossible until every local gate passes.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import math
import os
import re
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_UP
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from scripts import build_smokies_checkpoint2_approval as approval_builder
from scripts import build_smokies_elevenlabs_james_postpurchase_preflight as preflight_builder
from scripts import build_smokies_elevenlabs_james_remaining_locks as locks_builder
from scripts import (
    build_smokies_postpurchase_render_continuation_approval as continuation_builder,
)


VOICE_ID = preflight_builder.VOICE_ID
VOICE_NAME = preflight_builder.VOICE_NAME
MODEL_ID = preflight_builder.MODEL_ID
OUTPUT_FORMAT_ID = preflight_builder.OUTPUT_FORMAT_ID
VOICE_SETTINGS = preflight_builder.VOICE_SETTINGS
LANGUAGE_CODE = "en"
ENDPOINT_ROOT = "https://api.elevenlabs.io/v1/text-to-speech"
VOICE_ENDPOINT_ROOT = "https://api.elevenlabs.io/v1/voices"
SUBSCRIPTION_ENDPOINT = "https://api.elevenlabs.io/v1/user/subscription"
APPROVAL_PATH = preflight_builder.APPROVAL_PATH
CONTINUATION_APPROVAL_PATH = continuation_builder.OUTPUT_PATH
GREEN_PREFLIGHT_PATH = preflight_builder.DESTINATION
AUDIT_PATH = (
    REPOSITORY
    / "originals/smokies/elevenlabs_james_remaining_renderer_audit_v1.json"
)
TEST_PATH = REPOSITORY / "tests/test_smokies_elevenlabs_james_remaining_renderer.py"
OPERATOR_PATH = REPOSITORY / "scripts/operate_smokies_elevenlabs_james_remaining.py"
OPERATOR_TEST_PATH = (
    REPOSITORY / "tests/test_smokies_elevenlabs_james_remaining_operator.py"
)
RENDERER_CONTRACT = "smokies_elevenlabs_james_remaining_renderer_v2"
ROOT_CONTRACT = "smokies_elevenlabs_james_remaining_external_root_v1"
OUTPUT_ROOT_BASENAME = "trailhead-smokies-james-remaining-v1"
ROOT_MARKER_NAME = ".trailhead-smokies-james-remaining-root.json"
EVENTS_NAME = "render-events.ndjson"
LEDGER_NAME = "render-ledger.json"
CLOSEOUT_NAME = "chapter-closeout.json"
PROVISIONAL_CLOSEOUT_NAME = "chapter-key-deletion-provisional.json"
CHAPTER_ORDER = preflight_builder.CHAPTER_ORDER
MAX_PROVIDER_ATTEMPTS = 3
MAX_RETRY_AFTER_SECONDS = 60.0
MIN_PLAUSIBLE_WPM = 75.0
MAX_PLAUSIBLE_WPM = 240.0
MIN_MP3_BYTES = 4_096
MAX_JSON_RESPONSE_BYTES = 1 * 1024 * 1024
MAX_AUDIO_RESPONSE_BYTES = 64 * 1024 * 1024
EXECUTION_EVIDENCE_MAX_AGE = timedelta(minutes=15)
MIN_KEY_REMAINING = timedelta(hours=2)
KEY_LIFETIME_SECONDS = 86_400
KEY_UI_TIMEZONE = "America/Winnipeg"
KEY_UI_TIMESTAMP_PRECISION = "minute"
KEY_UI_TIMESTAMP_PRECISION_SECONDS = 60
KEY_UI_ROUNDING_MODE = "unknown"
KEY_UI_REQUESTED_TTL_LABEL = "1 day"
KEY_EXPIRY_INTERVAL_UNCERTAINTY_SECONDS = 60
KEY_DISPATCH_SAFETY_BUFFER_SECONDS = 300
KEY_UI_SOURCES = {
    "key_id": "official_signed_in_api_keys_ui_copy_key_id",
    "key_name": "official_signed_in_api_keys_ui_name",
    "key_preview": "official_signed_in_api_keys_ui_preview_last_4_secret_chars",
    "created_tooltip": "official_signed_in_api_keys_ui_created_tooltip",
    "expiry_tooltip": "official_signed_in_api_keys_ui_expiry_tooltip",
    "enabled": "official_signed_in_api_keys_ui_enabled_status",
    "controls": "official_signed_in_api_keys_ui_edit_cap_permissions_safeguards",
    "uniqueness": "official_signed_in_api_keys_ui_exact_matching_row_review",
    "timezone": "authoritative_codex_app_environment_context",
    "browser_time": "signed_in_api_keys_page_new_date_to_string",
    "offsets": "zoneinfo_offsets_at_created_and_expiry_ui_instants",
}
KEY_UI_TOOLTIP_RE = re.compile(
    r"^(?P<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) "
    r"(?P<day>[1-9]|[12][0-9]|3[01]), (?P<year>[0-9]{4}), "
    r"(?P<hour>[1-9]|1[0-2]):(?P<minute>[0-5][0-9]) "
    r"(?P<meridiem>AM|PM)$"
)
KEY_UI_BROWSER_DATE_RE = re.compile(
    r"^(?P<weekday>Sun|Mon|Tue|Wed|Thu|Fri|Sat) "
    r"(?P<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +"
    r"(?P<day>[1-9]|[12][0-9]|3[01]) (?P<year>[0-9]{4}) "
    r"(?P<hour>[01][0-9]|2[0-3]):(?P<minute>[0-5][0-9]):"
    r"(?P<second>[0-5][0-9]) "
    r"GMT-0500 \(Central Daylight Time\)$"
)
KEY_UI_MONTHS = {
    name: index
    for index, name in enumerate(
        (
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        ),
        start=1,
    )
}
KEY_UI_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
PROVIDER_KEY_CHAPTER_CODES = {
    "foothills_parkway": "fp",
    "mountain_crossing": "mc",
    "little_river_cades_cove": "cc",
}
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
SAFE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_]{19,127}$")
REQUEST_ID_RE = re.compile(r"^[a-z0-9_]+__(?:base|[a-z0-9_]+)$")
EXPECTED_KEY_PERMISSIONS = (
    "text_to_speech_access",
    "user_access",
    "voices_read",
)
PREBATCH_BILLABLE_REQUEST_COUNT = 14
PREBATCH_TOTAL_USAGE_USD = Decimal("2.64")
DIRECT_DEPENDENCY_PATHS = (
    Path(approval_builder.__file__).resolve(),
    Path(preflight_builder.__file__).resolve(),
    Path(locks_builder.__file__).resolve(),
    Path(continuation_builder.__file__).resolve(),
)
_OPERATOR_APPLY_CAPABILITY = object()


class NarrationError(ValueError):
    """A redacted fail-closed renderer error."""


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
            "bitrate_kbps": self.bitrate_kbps,
            "byte_count": self.byte_count,
            "duration_s": round(self.duration_s, 6),
            "frame_count": self.frame_count,
            "sample_rate_hz": self.sample_rate_hz,
            "sha256": self.sha256,
        }


@dataclass(frozen=True)
class RenderRequest:
    stable_order: int
    provider_request_id: str
    entry_id: str
    request_kind: str
    base_variant_id: str
    override_variant_id: str | None
    effective_variant_ids: tuple[str, ...]
    transcript: str
    raw_transcript_sha256: str
    normalized_transcript_sha256: str
    word_count: int
    payload_character_count: int
    normalized_character_count: int
    reserved_provider_credit_ceiling: int


@dataclass(frozen=True)
class ChapterPacket:
    chapter_id: str
    lock_id: str
    lock_path: Path
    lock_sha256: str
    requests: tuple[RenderRequest, ...]
    payload_character_count: int
    normalized_character_count: int
    reserved_provider_credit_ceiling: int
    renderer_character_cap: int
    key_credit_quota: int
    dollar_cap_usd: str


@dataclass(frozen=True)
class SourceBindings:
    checkpoint2_approval_sha256: str
    continuation_approval_sha256: str
    green_preflight_sha256: str
    renderer_audit_sha256: str
    operator_sha256: str
    operator_test_sha256: str
    dependency_sha256: Mapping[str, str]


@dataclass(frozen=True)
class ExecutionEvidence:
    file_sha256: str
    key_id_sha256: str
    key_material_sha256: str
    observed_at: str
    available_credits: int
    remaining_batch_renderer_cap: int
    ledger_event_chain_head: str
    continuation: bool
    continuation_mode: str
    prior_key_id_sha256: str | None
    prior_key_deleted_and_verified: bool
    ledger_character_cost_total_at_start: int
    partial_usage_credits_since_prior_session: int
    key_credit_limit: int
    key_preview_sha256: str
    provider_key_name_sha256: str
    key_session_number: int
    provider_key_matching_row_count: int
    provider_key_row_unique: bool
    provider_key_enabled: bool
    provider_key_created_tooltip: str
    provider_key_expires_tooltip: str
    provider_key_browser_date_string: str
    provider_key_created_tooltip_sha256: str
    provider_key_expires_tooltip_sha256: str
    provider_key_browser_date_string_sha256: str
    provider_key_timestamp_timezone: str
    provider_key_timestamp_precision: str
    provider_key_timestamp_precision_seconds: int
    provider_key_timestamp_rounding_mode: str
    provider_key_created_utc_offset: str
    provider_key_expires_utc_offset: str
    provider_key_created_tooltip_source: str
    provider_key_expiry_tooltip_source: str
    provider_key_timestamp_timezone_source: str
    provider_key_timestamp_offsets_source: str
    provider_key_browser_date_source: str
    key_created_at_interval_lower: str
    key_created_at_interval_upper: str
    key_expires_at_interval_lower: str
    key_expires_at_interval_upper: str
    key_expiry_conservative_deadline: str
    key_displayed_center_duration_seconds: int
    key_duration_interval_lower_seconds: int
    key_duration_interval_upper_seconds: int
    requested_ttl_label: str
    requested_ttl_seconds: int
    observed_total_usage_usd: str
    observed_billable_request_count: int
    ledger_request_count_at_start: int
    partial_billable_requests_since_prior_session: int
    prior_key_deleted_at: str | None
    replacement_key_creation_initiated_at: str | None

    def session_payload(self) -> dict[str, Any]:
        return {
            "available_credits": self.available_credits,
            "continuation": self.continuation,
            "continuation_mode": self.continuation_mode,
            "evidence_sha256": self.file_sha256,
            "key_id_sha256": self.key_id_sha256,
            "key_material_sha256": self.key_material_sha256,
            "key_credit_limit": self.key_credit_limit,
            "key_preview_sha256": self.key_preview_sha256,
            "provider_key_name_sha256": self.provider_key_name_sha256,
            "key_session_number": self.key_session_number,
            "provider_key_matching_row_count": (
                self.provider_key_matching_row_count
            ),
            "provider_key_row_unique": self.provider_key_row_unique,
            "provider_key_enabled": self.provider_key_enabled,
            "provider_key_created_tooltip": (
                self.provider_key_created_tooltip
            ),
            "provider_key_expires_tooltip": (
                self.provider_key_expires_tooltip
            ),
            "provider_key_browser_date_string": (
                self.provider_key_browser_date_string
            ),
            "provider_key_created_tooltip_sha256": (
                self.provider_key_created_tooltip_sha256
            ),
            "provider_key_expires_tooltip_sha256": (
                self.provider_key_expires_tooltip_sha256
            ),
            "provider_key_browser_date_string_sha256": (
                self.provider_key_browser_date_string_sha256
            ),
            "provider_key_timestamp_timezone": (
                self.provider_key_timestamp_timezone
            ),
            "provider_key_timestamp_precision": (
                self.provider_key_timestamp_precision
            ),
            "provider_key_timestamp_precision_seconds": (
                self.provider_key_timestamp_precision_seconds
            ),
            "provider_key_timestamp_rounding_mode": (
                self.provider_key_timestamp_rounding_mode
            ),
            "provider_key_created_utc_offset": (
                self.provider_key_created_utc_offset
            ),
            "provider_key_expires_utc_offset": (
                self.provider_key_expires_utc_offset
            ),
            "provider_key_created_tooltip_source": (
                self.provider_key_created_tooltip_source
            ),
            "provider_key_expiry_tooltip_source": (
                self.provider_key_expiry_tooltip_source
            ),
            "provider_key_timestamp_timezone_source": (
                self.provider_key_timestamp_timezone_source
            ),
            "provider_key_timestamp_offsets_source": (
                self.provider_key_timestamp_offsets_source
            ),
            "provider_key_browser_date_source": (
                self.provider_key_browser_date_source
            ),
            "key_created_at_interval_lower": self.key_created_at_interval_lower,
            "key_created_at_interval_upper": self.key_created_at_interval_upper,
            "key_expires_at_interval_lower": self.key_expires_at_interval_lower,
            "key_expires_at_interval_upper": self.key_expires_at_interval_upper,
            "key_expiry_conservative_deadline": (
                self.key_expiry_conservative_deadline
            ),
            "key_displayed_center_duration_seconds": (
                self.key_displayed_center_duration_seconds
            ),
            "key_duration_interval_lower_seconds": (
                self.key_duration_interval_lower_seconds
            ),
            "key_duration_interval_upper_seconds": (
                self.key_duration_interval_upper_seconds
            ),
            "provider_key_created_tooltip_directly_observed": True,
            "provider_key_expires_tooltip_directly_observed": True,
            "requested_ttl_label": self.requested_ttl_label,
            "requested_ttl_seconds": self.requested_ttl_seconds,
            "ledger_character_cost_total_at_start": (
                self.ledger_character_cost_total_at_start
            ),
            "ledger_request_count_at_start": self.ledger_request_count_at_start,
            "observed_at": self.observed_at,
            "observed_billable_request_count": (
                self.observed_billable_request_count
            ),
            "observed_total_usage_usd": self.observed_total_usage_usd,
            "partial_billable_requests_since_prior_session": (
                self.partial_billable_requests_since_prior_session
            ),
            "partial_usage_credits_since_prior_session": (
                self.partial_usage_credits_since_prior_session
            ),
            "prior_key_deleted_and_verified": (
                self.prior_key_deleted_and_verified
            ),
            "prior_key_id_sha256": self.prior_key_id_sha256,
            "prior_key_deleted_at": self.prior_key_deleted_at,
            "replacement_key_creation_initiated_at": (
                self.replacement_key_creation_initiated_at
            ),
            "remaining_batch_renderer_cap": self.remaining_batch_renderer_cap,
        }


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class UrllibProviderTransport:
    @staticmethod
    def _bounded_read(stream: Any, limit: int) -> bytes:
        value = stream.read(limit + 1)
        if len(value) > limit:
            raise NarrationError("provider_response_body_too_large")
        return value

    def _request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        timeout: float,
        body: bytes | None = None,
        max_body_bytes: int,
    ) -> ProviderResponse:
        request = urllib.request.Request(
            url=url,
            data=body,
            headers=dict(headers),
            method=method,
        )
        opener = urllib.request.build_opener(_RejectRedirects())
        try:
            with opener.open(request, timeout=timeout) as response:
                return ProviderResponse(
                    status_code=int(response.status),
                    headers=dict(response.headers.items()),
                    body=self._bounded_read(response, max_body_bytes),
                )
        except urllib.error.HTTPError as exc:
            return ProviderResponse(
                status_code=int(exc.code),
                headers=dict(exc.headers.items()),
                body=self._bounded_read(exc, MAX_JSON_RESPONSE_BYTES),
            )

    def get(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        timeout: float,
    ) -> ProviderResponse:
        return self._request(
            "GET",
            url,
            headers=headers,
            timeout=timeout,
            max_body_bytes=MAX_JSON_RESPONSE_BYTES,
        )

    def post(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes,
        timeout: float,
    ) -> ProviderResponse:
        return self._request(
            "POST",
            url,
            headers=headers,
            body=body,
            timeout=timeout,
            max_body_bytes=MAX_AUDIO_RESPONSE_BYTES,
        )


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_utc(value: object, code: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise NarrationError(code) from exc
    if parsed.tzinfo is None:
        raise NarrationError(code)
    return parsed.astimezone(timezone.utc)


def _key_ui_offset_label(value: datetime, code: str) -> str:
    offset = value.utcoffset()
    if offset is None or offset.total_seconds() % 60:
        raise NarrationError(code)
    total_minutes = int(offset.total_seconds() // 60)
    sign = "+" if total_minutes >= 0 else "-"
    total_minutes = abs(total_minutes)
    return f"{sign}{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def _key_ui_strict_local_to_utc(
    naive: datetime, *, observed_offset: object, code: str
) -> datetime:
    try:
        zone = ZoneInfo(KEY_UI_TIMEZONE)
    except ZoneInfoNotFoundError as exc:
        raise NarrationError(code) from exc
    candidates: dict[datetime, datetime] = {}
    for fold in (0, 1):
        local = naive.replace(tzinfo=zone, fold=fold)
        utc_value = local.astimezone(timezone.utc)
        if utc_value.astimezone(zone).replace(tzinfo=None) == naive:
            candidates[utc_value] = local
    if len(candidates) != 1:
        raise NarrationError(code)
    utc_value, local = next(iter(candidates.items()))
    if observed_offset != _key_ui_offset_label(local, code):
        raise NarrationError(code)
    return utc_value


def _key_ui_tooltip_center(
    raw_value: str, *, observed_offset: object, code: str
) -> datetime:
    match = KEY_UI_TOOLTIP_RE.fullmatch(raw_value)
    if match is None:
        raise NarrationError(code)
    parts = match.groupdict()
    hour = int(parts["hour"]) % 12
    if parts["meridiem"] == "PM":
        hour += 12
    try:
        naive = datetime(
            int(parts["year"]),
            KEY_UI_MONTHS[parts["month"]],
            int(parts["day"]),
            hour,
            int(parts["minute"]),
        )
    except ValueError as exc:
        raise NarrationError(code) from exc
    return _key_ui_strict_local_to_utc(
        naive, observed_offset=observed_offset, code=code
    )


def _key_ui_browser_time(
    raw_value: str, *, observed_at: datetime, code: str
) -> datetime:
    match = KEY_UI_BROWSER_DATE_RE.fullmatch(raw_value)
    if match is None:
        raise NarrationError(code)
    parts = match.groupdict()
    try:
        naive = datetime(
            int(parts["year"]),
            KEY_UI_MONTHS[parts["month"]],
            int(parts["day"]),
            int(parts["hour"]),
            int(parts["minute"]),
            int(parts["second"]),
        )
    except ValueError as exc:
        raise NarrationError(code) from exc
    if KEY_UI_WEEKDAYS[naive.weekday()] != parts["weekday"]:
        raise NarrationError(code)
    browser_utc = _key_ui_strict_local_to_utc(
        naive, observed_offset="-05:00", code=code
    )
    if abs(browser_utc - observed_at) > timedelta(minutes=2):
        raise NarrationError(code)
    return browser_utc


def _key_ui_computed_intervals(
    key: Mapping[str, Any], *, observed_at: datetime, code: str
) -> dict[str, datetime | int]:
    created_tooltip = key.get("provider_key_created_tooltip")
    expires_tooltip = key.get("provider_key_expires_tooltip")
    browser_date = key.get("provider_key_browser_date_string")
    if any(
        (
            not isinstance(created_tooltip, str),
            not isinstance(expires_tooltip, str),
            not isinstance(browser_date, str),
        )
    ):
        raise NarrationError(code)
    if any(
        (
            key.get("provider_key_timestamp_timezone") != KEY_UI_TIMEZONE,
            key.get("provider_key_created_utc_offset") != "-05:00",
            key.get("provider_key_expires_utc_offset") != "-05:00",
        )
    ):
        raise NarrationError(code)
    _key_ui_browser_time(browser_date, observed_at=observed_at, code=code)
    created_center = _key_ui_tooltip_center(
        created_tooltip,
        observed_offset=key.get("provider_key_created_utc_offset"),
        code=code,
    )
    expires_center = _key_ui_tooltip_center(
        expires_tooltip,
        observed_offset=key.get("provider_key_expires_utc_offset"),
        code=code,
    )
    uncertainty = timedelta(seconds=KEY_EXPIRY_INTERVAL_UNCERTAINTY_SECONDS)
    created_lower = created_center - uncertainty
    created_upper = created_center + uncertainty
    expires_lower = expires_center - uncertainty
    expires_upper = expires_center + uncertainty
    duration_lower = int((expires_lower - created_upper).total_seconds())
    duration_upper = int((expires_upper - created_lower).total_seconds())
    if any(
        (
            expires_center - created_center
            != timedelta(seconds=KEY_LIFETIME_SECONDS),
            duration_lower != KEY_LIFETIME_SECONDS - 120,
            duration_upper != KEY_LIFETIME_SECONDS + 120,
            observed_at - created_lower > EXECUTION_EVIDENCE_MAX_AGE,
            created_upper - observed_at > timedelta(minutes=2),
            expires_lower - observed_at < MIN_KEY_REMAINING,
        )
    ):
        raise NarrationError(code)
    return {
        "created_lower": created_lower,
        "created_upper": created_upper,
        "expires_lower": expires_lower,
        "expires_upper": expires_upper,
        "duration_lower": duration_lower,
        "duration_upper": duration_upper,
    }


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _binding(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    return {
        "byte_count": len(raw),
        "path": path.relative_to(REPOSITORY).as_posix(),
        "sha256": _sha256_bytes(raw),
    }


def _load_json(path: Path, code: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise NarrationError(code) from exc
    if not isinstance(value, dict):
        raise NarrationError(code)
    return value


def _resolve_transcript(reference: object) -> str:
    raw = str(reference or "")
    if "#" not in raw:
        raise NarrationError("transcript_reference_invalid")
    raw_path, pointer = raw.split("#", 1)
    path = (REPOSITORY / raw_path).resolve()
    try:
        path.relative_to(REPOSITORY)
    except ValueError as exc:
        raise NarrationError("transcript_source_outside_repository") from exc
    value: Any = _load_json(path, "transcript_source_unreadable")
    if not pointer.startswith("/"):
        raise NarrationError("transcript_pointer_invalid")
    for token in pointer[1:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list):
            try:
                value = value[int(token)]
            except (ValueError, IndexError) as exc:
                raise NarrationError("transcript_pointer_invalid") from exc
        elif isinstance(value, dict) and token in value:
            value = value[token]
        else:
            raise NarrationError("transcript_pointer_invalid")
    if not isinstance(value, str) or not value.strip():
        raise NarrationError("transcript_value_invalid")
    return value


def _validate_owner_sources() -> tuple[str, str, str]:
    expected_approval = approval_builder.build()
    if APPROVAL_PATH.read_text(encoding="utf-8") != approval_builder.serialize(
        expected_approval
    ):
        raise NarrationError("checkpoint2_approval_drift")
    boundary = expected_approval.get("approval_boundary", {})
    scope = expected_approval.get("approval", {}).get("scope", {})
    if any(
        (
            boundary.get("exact_72_request_james_render_authorized") is not True,
            boundary.get("exact_provider_credit_spend_authorized") is not True,
            boundary.get("restricted_one_day_key_creation_authorized") is not True,
            scope.get("james_provider_request_count") != 72,
            scope.get("reserved_provider_credit_ceiling") != 138_190,
            scope.get("dollar_cap_usd") != "14.50",
            scope.get("paid_overage_authorized") is not False,
            scope.get("rerender_count") != 0,
        )
    ):
        raise NarrationError("checkpoint2_approval_scope_drift")

    continuation = continuation_builder.build()
    if CONTINUATION_APPROVAL_PATH.read_text(
        encoding="utf-8"
    ) != continuation_builder.serialize(continuation):
        raise NarrationError("postpurchase_continuation_approval_drift")
    unchanged = continuation.get("unchanged_render_contract", {})
    if any(
        (
            continuation.get("continuation_boundary", {}).get(
                "owner_purchase_and_continue_event_bound"
            )
            is not True,
            unchanged.get("provider_request_count") != 72,
            unchanged.get("reserved_provider_credit_ceiling") != 138_190,
            unchanged.get("renderer_character_cap") != 138_300,
            unchanged.get("combined_one_day_key_credit_quota") != 145_000,
            unchanged.get("dollar_cap_usd") != "14.50",
            unchanged.get("rerender_authorized") is not False,
            unchanged.get("paid_overage_authorized") is not False,
            unchanged.get("cross_chapter_borrowing_allowed") is not False,
        )
    ):
        raise NarrationError("postpurchase_continuation_scope_drift")

    preflight = preflight_builder.build()
    if GREEN_PREFLIGHT_PATH.read_text(
        encoding="utf-8"
    ) != preflight_builder.serialize(preflight):
        raise NarrationError("green_preflight_drift")
    decision = preflight.get("decision", {})
    usage = preflight.get("provider_usage_baseline", {})
    if any(
        (
            decision.get("fresh_provider_preflight_go") is not True,
            decision.get("credit_gate_passed") is not True,
            decision.get("all_non_credit_gates_passed") is not True,
            usage.get("billable_request_count")
            != PREBATCH_BILLABLE_REQUEST_COUNT,
            usage.get("total_usage_usd") != str(PREBATCH_TOTAL_USAGE_USD),
            preflight.get("authorization", {}).get("rerender_authorized")
            is not False,
            preflight.get("authorization", {}).get(
                "paid_usage_overage_authorized"
            )
            is not False,
        )
    ):
        raise NarrationError("green_preflight_gate_invalid")
    return (
        _sha256_file(APPROVAL_PATH),
        _sha256_file(CONTINUATION_APPROVAL_PATH),
        _sha256_file(GREEN_PREFLIGHT_PATH),
    )


def load_chapter_packet(chapter_id: str) -> ChapterPacket:
    artifacts = locks_builder.build_all()
    for path, payload in artifacts.items():
        if path.read_text(encoding="utf-8") != locks_builder.serialize(payload):
            raise NarrationError("remaining_lock_drift")
    matches = [
        spec for spec in locks_builder.CHAPTER_SPECS if spec.chapter_id == chapter_id
    ]
    if len(matches) != 1:
        raise NarrationError("chapter_id_invalid")
    spec = matches[0]
    raw = artifacts[spec.destination]
    profile = raw.get("generation_profile", {})
    output = profile.get("output", {})
    if any(
        (
            profile.get("provider") != "elevenlabs",
            profile.get("voice_id") != VOICE_ID,
            profile.get("voice_name") != VOICE_NAME,
            profile.get("model_id") != MODEL_ID,
            profile.get("language_code") != LANGUAGE_CODE,
            profile.get("voice_settings") != VOICE_SETTINGS,
            output.get("format_id") != OUTPUT_FORMAT_ID,
            output.get("sample_rate_hz") != 44_100,
            output.get("bitrate_kbps") != 128,
            output.get("channels") != 1,
        )
    ):
        raise NarrationError("chapter_generation_profile_drift")
    rows = raw.get("requests")
    expected_count = spec.expected_base_count + spec.expected_override_count
    if not isinstance(rows, list) or len(rows) != expected_count:
        raise NarrationError("chapter_request_inventory_drift")
    requests: list[RenderRequest] = []
    for row in rows:
        if not isinstance(row, dict):
            raise NarrationError("chapter_request_invalid")
        transcript = _resolve_transcript(row.get("transcript_source"))
        normalized = " ".join(transcript.split())
        request_id = str(row.get("provider_request_id") or "")
        if any(
            (
                REQUEST_ID_RE.fullmatch(request_id) is None,
                row.get("accepted_audio_sha256") is not None,
                row.get("narration_generated") is not False,
                row.get("provider_request_sent") is not False,
                row.get("render_authorized") is not False,
                row.get("spend_authorized") is not False,
                _sha256_bytes(transcript.encode("utf-8"))
                != row.get("raw_transcript_sha256"),
                _sha256_bytes(normalized.encode("utf-8"))
                != row.get("normalized_transcript_sha256"),
                len(transcript) != row.get("payload_character_count"),
                len(normalized) != row.get("normalized_character_count"),
                len(normalized.split(" ")) != row.get("word_count"),
            )
        ):
            raise NarrationError("chapter_request_source_drift")
        reserved = row.get("reserved_provider_credit_ceiling")
        if isinstance(reserved, bool) or not isinstance(reserved, int):
            raise NarrationError("chapter_request_reservation_invalid")
        requests.append(
            RenderRequest(
                stable_order=int(row["stable_order"]),
                provider_request_id=request_id,
                entry_id=str(row["entry_id"]),
                request_kind=str(row["request_kind"]),
                base_variant_id=str(row["base_variant_id"]),
                override_variant_id=(
                    None
                    if row.get("override_variant_id") is None
                    else str(row["override_variant_id"])
                ),
                effective_variant_ids=tuple(row["effective_variant_ids"]),
                transcript=transcript,
                raw_transcript_sha256=str(row["raw_transcript_sha256"]),
                normalized_transcript_sha256=str(
                    row["normalized_transcript_sha256"]
                ),
                word_count=int(row["word_count"]),
                payload_character_count=int(row["payload_character_count"]),
                normalized_character_count=int(
                    row["normalized_character_count"]
                ),
                reserved_provider_credit_ceiling=reserved,
            )
        )
    requests.sort(key=lambda item: item.stable_order)
    if [item.stable_order for item in requests] != list(
        range(1, len(requests) + 1)
    ) or len({item.provider_request_id for item in requests}) != len(requests):
        raise NarrationError("chapter_request_order_or_identity_drift")
    budget = raw.get("budget", {})
    payload_count = sum(item.payload_character_count for item in requests)
    normalized_count = sum(item.normalized_character_count for item in requests)
    reserved_total = sum(
        item.reserved_provider_credit_ceiling for item in requests
    )
    if any(
        (
            payload_count != budget.get("payload_character_count"),
            normalized_count != budget.get("normalized_character_count"),
            reserved_total != budget.get("reserved_provider_credit_ceiling"),
            budget.get("renderer_character_cap")
            != spec.expected_renderer_character_cap,
            budget.get("proposed_one_day_api_key_credit_quota")
            != spec.expected_one_day_key_credit_quota,
            budget.get("dollar_cap_usd") != spec.expected_dollar_cap_usd,
            budget.get("rerender_budget") != 0,
            budget.get("paid_overage_authorized") is not False,
            budget.get("cross_chapter_borrowing_allowed") is not False,
        )
    ):
        raise NarrationError("chapter_budget_drift")
    return ChapterPacket(
        chapter_id=chapter_id,
        lock_id=str(raw["lock_id"]),
        lock_path=spec.destination.resolve(),
        lock_sha256=_sha256_file(spec.destination),
        requests=tuple(requests),
        payload_character_count=payload_count,
        normalized_character_count=normalized_count,
        reserved_provider_credit_ceiling=reserved_total,
        renderer_character_cap=int(budget["renderer_character_cap"]),
        key_credit_quota=int(
            budget["proposed_one_day_api_key_credit_quota"]
        ),
        dollar_cap_usd=str(budget["dollar_cap_usd"]),
    )


def _dependency_hashes() -> dict[str, str]:
    return {
        path.relative_to(REPOSITORY).as_posix(): _sha256_file(path)
        for path in DIRECT_DEPENDENCY_PATHS
    }


def load_audit_evidence(path: Path = AUDIT_PATH) -> SourceBindings:
    raw = _load_json(path, "renderer_audit_unreadable")
    approval_sha, continuation_sha, preflight_sha = _validate_owner_sources()
    expected_fields = {
        "schema_version",
        "audit_id",
        "audited_at",
        "renderer_contract",
        "renderer_sha256",
        "test_sha256",
        "operator_sha256",
        "operator_test_sha256",
        "dependency_sha256",
        "green_preflight_sha256",
        "checkpoint2_owner_approval_sha256",
        "postpurchase_continuation_approval_sha256",
        "independent_audit_passed",
        "p0_findings",
        "p1_findings",
        "dry_run_default_verified",
        "provider_calls_performed_by_audit",
        "author_source_files_edited_by_auditor",
        "audit_artifact_created_by_auditor",
    }
    if set(raw) != expected_fields or any(
        (
            raw.get("schema_version") != 1,
            raw.get("renderer_contract") != RENDERER_CONTRACT,
            raw.get("renderer_sha256") != _sha256_file(Path(__file__)),
            raw.get("test_sha256") != _sha256_file(TEST_PATH),
            raw.get("operator_sha256") != _sha256_file(OPERATOR_PATH),
            raw.get("operator_test_sha256") != _sha256_file(OPERATOR_TEST_PATH),
            raw.get("dependency_sha256") != _dependency_hashes(),
            raw.get("green_preflight_sha256") != preflight_sha,
            raw.get("checkpoint2_owner_approval_sha256") != approval_sha,
            raw.get("postpurchase_continuation_approval_sha256")
            != continuation_sha,
            raw.get("independent_audit_passed") is not True,
            raw.get("p0_findings") != 0,
            raw.get("p1_findings") != 0,
            raw.get("dry_run_default_verified") is not True,
            raw.get("provider_calls_performed_by_audit") != 0,
            raw.get("author_source_files_edited_by_auditor") != 0,
            raw.get("audit_artifact_created_by_auditor") is not True,
        )
    ):
        raise NarrationError("renderer_audit_invalid")
    _parse_utc(raw.get("audited_at"), "renderer_audit_timestamp_invalid")
    return SourceBindings(
        checkpoint2_approval_sha256=approval_sha,
        continuation_approval_sha256=continuation_sha,
        green_preflight_sha256=preflight_sha,
        renderer_audit_sha256=_sha256_file(path),
        operator_sha256=_sha256_file(OPERATOR_PATH),
        operator_test_sha256=_sha256_file(OPERATOR_TEST_PATH),
        dependency_sha256=_dependency_hashes(),
    )


def _output_root_hash(path: Path) -> str:
    return _sha256_bytes(str(path).encode("utf-8"))


def _validate_external_root(path: Path) -> Path:
    if not path.is_absolute() or path.name != OUTPUT_ROOT_BASENAME:
        raise NarrationError("dedicated_external_output_root_required")
    parent = path.parent.resolve(strict=True)
    if (
        path.parent.is_symlink()
        or not parent.is_dir()
        or parent != Path(os.path.abspath(path.parent))
    ):
        raise NarrationError("output_root_parent_invalid")
    if parent in {Path("/"), Path.home().resolve(), Path("/tmp").resolve()}:
        raise NarrationError("output_root_parent_too_broad")
    parent_info = parent.stat()
    if parent_info.st_uid != os.getuid() or parent_info.st_mode & 0o077:
        raise NarrationError("output_root_parent_permissions_invalid")
    resolved = parent / path.name
    try:
        resolved.relative_to(REPOSITORY.resolve())
    except ValueError:
        pass
    else:
        raise NarrationError("output_root_must_be_outside_repository")
    if _path_present(resolved):
        if resolved.is_symlink() or not resolved.is_dir():
            raise NarrationError("output_root_invalid")
        info = resolved.stat()
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise NarrationError("output_root_permissions_invalid")
    return resolved


def _path_present(path: Path) -> bool:
    """Return True for every directory entry, including a broken symlink."""
    return os.path.lexists(path)


def _require_root_confined(path: Path, root: Path, code: str) -> Path:
    try:
        root_resolved = root.resolve(strict=True)
        resolved = path.resolve(strict=True)
        resolved.relative_to(root_resolved)
    except (OSError, ValueError) as exc:
        raise NarrationError(code) from exc
    if resolved != Path(os.path.abspath(path)):
        raise NarrationError(code)
    return resolved


def _require_owned_directory(path: Path, root: Path, code: str) -> Path:
    try:
        info = path.lstat()
    except OSError as exc:
        raise NarrationError(code) from exc
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
    ):
        raise NarrationError(code)
    return _require_root_confined(path, root, code)


def _require_owned_regular_file(path: Path, root: Path, code: str) -> Path:
    try:
        info = path.lstat()
    except OSError as exc:
        raise NarrationError(code) from exc
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
    ):
        raise NarrationError(code)
    return _require_root_confined(path, root, code)


def _root_marker(root: Path) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "root_contract": ROOT_CONTRACT,
        "renderer_contract": RENDERER_CONTRACT,
        "product_id": preflight_builder.PRODUCT_ID,
        "output_root_sha256": _output_root_hash(root),
        "chapter_order": list(CHAPTER_ORDER),
        "contains_api_key_material": False,
    }


def _fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISDIR(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_mode & 0o077
        ):
            raise NarrationError("output_directory_permissions_invalid")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _create_only(path: Path, content: bytes, *, mode: int = 0o600) -> None:
    try:
        parent_info = path.parent.lstat()
    except OSError as exc:
        raise NarrationError("create_only_parent_invalid") from exc
    if (
        stat.S_ISLNK(parent_info.st_mode)
        or not stat.S_ISDIR(parent_info.st_mode)
        or parent_info.st_uid != os.getuid()
        or parent_info.st_mode & 0o077
        or path.parent.resolve(strict=True) != Path(os.path.abspath(path.parent))
    ):
        raise NarrationError("create_only_parent_invalid")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags, mode)
    except FileExistsError:
        raise NarrationError("create_only_target_exists") from None
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_mode & 0o077
        ):
            raise NarrationError("create_only_target_invalid")
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        _fsync_directory(path.parent)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _atomic_replace_json(path: Path, value: object) -> None:
    payload = json.dumps(
        value, indent=2, sort_keys=True, ensure_ascii=False
    ).encode("utf-8") + b"\n"
    try:
        parent_info = path.parent.lstat()
    except OSError as exc:
        raise NarrationError("atomic_json_parent_invalid") from exc
    if (
        stat.S_ISLNK(parent_info.st_mode)
        or not stat.S_ISDIR(parent_info.st_mode)
        or parent_info.st_uid != os.getuid()
        or parent_info.st_mode & 0o077
        or path.parent.resolve(strict=True) != Path(os.path.abspath(path.parent))
    ):
        raise NarrationError("atomic_json_parent_invalid")
    if _path_present(path):
        try:
            target_info = path.lstat()
        except OSError as exc:
            raise NarrationError("atomic_json_target_invalid") from exc
        if (
            stat.S_ISLNK(target_info.st_mode)
            or not stat.S_ISREG(target_info.st_mode)
            or target_info.st_uid != os.getuid()
            or target_info.st_mode & 0o077
        ):
            raise NarrationError("atomic_json_target_invalid")
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _prepare_root(root: Path) -> None:
    expected = _root_marker(root)
    marker = root / ROOT_MARKER_NAME
    if not _path_present(root):
        root.mkdir(mode=0o700)
    _require_owned_directory(root, root, "output_root_permissions_invalid")
    if not _path_present(marker):
        if any(root.iterdir()):
            raise NarrationError("output_root_marker_missing_or_invalid")
        _create_only(
            marker,
            json.dumps(
                expected, indent=2, sort_keys=True, ensure_ascii=False
            ).encode("utf-8")
            + b"\n",
        )
    _require_owned_regular_file(
        marker, root, "output_root_marker_missing_or_invalid"
    )
    if _load_json(marker, "output_root_marker_missing_or_invalid") != expected:
        raise NarrationError("output_root_marker_drift")
    allowed = {ROOT_MARKER_NAME, *CHAPTER_ORDER}
    for path in root.iterdir():
        if path.name not in allowed:
            raise NarrationError("unexpected_output_root_content")
        if path.name == ROOT_MARKER_NAME:
            _require_owned_regular_file(
                path, root, "output_root_marker_missing_or_invalid"
            )
        else:
            _require_owned_directory(path, root, "chapter_directory_invalid")


@contextmanager
def _exclusive_sentinel(root: Path):
    sentinel = root.parent / f".{root.name}.remaining-render.apply.lock"
    flags = os.O_CREAT | os.O_RDWR
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(sentinel, flags, 0o600)
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_mode & 0o077
        ):
            raise NarrationError("renderer_lock_file_invalid")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise NarrationError("concurrent_apply_forbidden") from None
        os.ftruncate(descriptor, 0)
        os.write(descriptor, f"{RENDERER_CONTRACT}\n".encode("utf-8"))
        os.fsync(descriptor)
        yield
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def _remaining_renderer_cap(chapter_id: str) -> int:
    start = CHAPTER_ORDER.index(chapter_id)
    return sum(
        load_chapter_packet(row).renderer_character_cap
        for row in CHAPTER_ORDER[start:]
    )


def _provider_key_name(chapter_id: str, session_number: int) -> str:
    if (
        chapter_id not in PROVIDER_KEY_CHAPTER_CODES
        or isinstance(session_number, bool)
        or not isinstance(session_number, int)
        or not 1 <= session_number <= 99
    ):
        raise NarrationError("provider_key_session_number_invalid")
    return (
        "trailhead-smokies-james-"
        f"{PROVIDER_KEY_CHAPTER_CODES[chapter_id]}-session-{session_number}"
    )


_FORBIDDEN_FIELD_PARTS = (
    "api_key",
    "secret",
    "password",
    "credential",
    "transcript",
    "local_path",
    "account_email",
    "workspace_name",
)


def _reject_private_values(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            folded = str(key).casefold()
            if any(part in folded for part in _FORBIDDEN_FIELD_PARTS):
                raise NarrationError("execution_evidence_sensitive_field")
            _reject_private_values(child)
    elif isinstance(value, list):
        for child in value:
            _reject_private_values(child)
    elif isinstance(value, str):
        folded = value.casefold()
        if any(
            marker in folded
            for marker in ("/home/", "\\\\wsl", "c:\\", "xi-api-key")
        ) or "@" in value:
            raise NarrationError("execution_evidence_private_value")
        if re.search(r"(?:^|[\s:=])sk[_-][a-z0-9]", folded):
            raise NarrationError("execution_evidence_private_value")


def load_execution_evidence(
    path: Path,
    *,
    packet: ChapterPacket,
    root: Path,
    sources: SourceBindings,
    ledger_head: str,
    prior_session: Mapping[str, Any] | None,
    already_committed: int,
    committed_since_prior_session: int,
    completed_request_count: int,
    completed_requests_since_prior_session: int,
    chapter_starting_total_usage_usd: Decimal,
    chapter_starting_billable_requests: int,
    ledger_updated_at: str | None,
    now: datetime,
) -> ExecutionEvidence:
    try:
        evidence_path = path.resolve(strict=True)
    except OSError as exc:
        raise NarrationError("execution_evidence_file_invalid") from exc
    try:
        evidence_path.relative_to(REPOSITORY.resolve())
    except ValueError:
        pass
    else:
        raise NarrationError("execution_evidence_must_be_outside_repository")
    _require_owned_directory(
        evidence_path.parent,
        evidence_path.parent,
        "execution_evidence_parent_invalid",
    )
    _require_owned_regular_file(
        path, evidence_path.parent, "execution_evidence_file_invalid"
    )
    raw = _load_json(evidence_path, "execution_evidence_unreadable")
    _reject_private_values(raw)
    expected_fields = {
        "schema_version",
        "evidence_id",
        "source",
        "source_observation_sha256",
        "observed_at",
        "chapter_id",
        "account",
        "provider_usage_baseline",
        "terms",
        "voice_contract",
        "key_policy",
        "continuation",
        "authorization",
        "bindings",
        "effects_before_apply",
    }
    if set(raw) != expected_fields:
        raise NarrationError("execution_evidence_fields_drift")
    evidence_id = str(raw.get("evidence_id") or "")
    if (
        raw.get("schema_version") != 1
        or raw.get("source") != "authenticated_browser"
        or SAFE_ID_RE.fullmatch(evidence_id) is None
        or raw.get("chapter_id") != packet.chapter_id
    ):
        raise NarrationError("execution_evidence_identity_drift")
    source_observation_sha256 = _validate_hash_field(
        raw.get("source_observation_sha256"),
        "execution_source_observation_hash_invalid",
    )
    if evidence_id != f"smokies_execution_{source_observation_sha256[:32]}":
        raise NarrationError("execution_source_observation_binding_invalid")
    observed = _parse_utc(raw.get("observed_at"), "execution_observed_at_invalid")
    if observed > now + timedelta(minutes=2) or now - observed > EXECUTION_EVIDENCE_MAX_AGE:
        raise NarrationError("execution_evidence_not_fresh")
    required_remaining = (
        _remaining_renderer_cap(packet.chapter_id) - already_committed
    )
    if required_remaining <= 0:
        raise NarrationError("execution_remaining_exposure_invalid")
    account = raw.get("account")
    if not isinstance(account, dict) or set(account) != {
        "plan",
        "commercial_use",
        "available_credits",
        "required_remaining_renderer_cap",
        "observed_total_usage_usd",
        "observed_billable_request_count",
        "prepaid_top_up_balance_usd",
        "auto_top_up_enabled",
        "paid_usage_overage_authorized",
        "account_identity_recorded",
        "workspace_identity_recorded",
    }:
        raise NarrationError("execution_account_schema_invalid")
    try:
        top_up_balance = Decimal(str(account["prepaid_top_up_balance_usd"]))
        observed_total_usage_usd = Decimal(
            str(account["observed_total_usage_usd"])
        )
    except InvalidOperation as exc:
        raise NarrationError("execution_account_schema_invalid") from exc
    expected_key_credit_limit = (
        packet.key_credit_quota
        if prior_session is None
        else packet.renderer_character_cap - already_committed
    )
    if expected_key_credit_limit <= 0:
        raise NarrationError("execution_residual_key_quota_invalid")
    if prior_session is None:
        expected_key_session_number = 1
    else:
        prior_key_session_number = prior_session.get("key_session_number")
        if (
            isinstance(prior_key_session_number, bool)
            or not isinstance(prior_key_session_number, int)
        ):
            raise NarrationError("execution_prior_key_session_invalid")
        expected_key_session_number = prior_key_session_number + 1
    expected_key_name_sha256 = _sha256_bytes(
        _provider_key_name(
            packet.chapter_id, expected_key_session_number
        ).encode("ascii")
    )
    if any(
        (
            account.get("plan") != "creator",
            account.get("commercial_use") is not True,
            account.get("required_remaining_renderer_cap") != required_remaining,
            not re.fullmatch(
                r"\d+\.\d{2}", str(account.get("prepaid_top_up_balance_usd"))
            ),
            not Decimal("0.00") <= top_up_balance <= Decimal("10.00"),
            not re.fullmatch(
                r"\d+\.\d{2}", str(account.get("observed_total_usage_usd"))
            ),
            account.get("auto_top_up_enabled") is not False,
            account.get("paid_usage_overage_authorized") is not False,
            account.get("account_identity_recorded") is not False,
            account.get("workspace_identity_recorded") is not False,
            isinstance(account.get("observed_billable_request_count"), bool),
            not isinstance(account.get("observed_billable_request_count"), int),
        )
    ):
        raise NarrationError("execution_account_gate_invalid")
    available = account.get("available_credits")
    observed_billable_requests = account.get("observed_billable_request_count")
    if (
        isinstance(available, bool)
        or not isinstance(available, int)
        or available < required_remaining
    ):
        raise NarrationError("execution_account_gate_invalid")
    if raw.get("provider_usage_baseline") != {
        "billable_request_count": PREBATCH_BILLABLE_REQUEST_COUNT,
        "total_usage_usd": str(PREBATCH_TOTAL_USAGE_USD),
        "used_provider_credits": 14_510,
        "remaining_provider_credits": 171_490,
        "total_provider_credits": 186_000,
    }:
        raise NarrationError("execution_usage_baseline_drift")
    if raw.get("terms") != {
        "jurisdiction": "non_eea",
        "primary_terms_id": preflight_builder.POLICY_TUPLE["primary_terms"][
            "terms_id"
        ],
        "voice_library_addendum_id": preflight_builder.POLICY_TUPLE[
            "voice_library_addendum"
        ]["terms_id"],
        "prohibited_use_policy_id": preflight_builder.POLICY_TUPLE[
            "prohibited_use_policy"
        ]["terms_id"],
        "beta_services_addendum_id": preflight_builder.POLICY_TUPLE[
            "beta_services_addendum"
        ]["terms_id"],
        "terms_changed": False,
    }:
        raise NarrationError("execution_terms_gate_invalid")
    if raw.get("voice_contract") != {
        "voice_id": VOICE_ID,
        "voice_name": VOICE_NAME,
        "model_id": MODEL_ID,
        "language_code": LANGUAGE_CODE,
        "output_format_id": OUTPUT_FORMAT_ID,
        "voice_settings": VOICE_SETTINGS,
        "explicit_request_override": True,
        "beta_services_used": False,
    }:
        raise NarrationError("execution_voice_gate_invalid")
    key = raw.get("key_policy")
    if not isinstance(key, dict) or set(key) != {
        "key_id_sha256",
        "key_material_sha256",
        "key_preview_sha256",
        "provider_key_name_sha256",
        "key_session_number",
        "provider_key_matching_row_count",
        "provider_key_row_unique",
        "provider_key_enabled",
        "provider_key_created_tooltip",
        "provider_key_expires_tooltip",
        "provider_key_browser_date_string",
        "provider_key_created_tooltip_sha256",
        "provider_key_expires_tooltip_sha256",
        "provider_key_browser_date_string_sha256",
        "provider_key_timestamp_timezone",
        "provider_key_timestamp_precision",
        "provider_key_timestamp_precision_seconds",
        "provider_key_timestamp_rounding_mode",
        "provider_key_created_utc_offset",
        "provider_key_expires_utc_offset",
        "key_created_at_interval_lower",
        "key_created_at_interval_upper",
        "key_expires_at_interval_lower",
        "key_expires_at_interval_upper",
        "key_expiry_conservative_deadline",
        "key_displayed_center_duration_seconds",
        "key_duration_interval_lower_seconds",
        "key_duration_interval_upper_seconds",
        "provider_key_created_tooltip_directly_observed",
        "provider_key_expires_tooltip_directly_observed",
        "requested_ttl_label",
        "key_credit_limit",
        "key_permissions",
        "restrict_key_enabled",
        "auto_disable_if_leaked",
        "other_chapter_keys_active",
        "requested_ttl_seconds",
        "provider_key_id_source",
        "provider_key_name_source",
        "provider_key_preview_source",
        "provider_key_created_tooltip_source",
        "provider_key_expiry_tooltip_source",
        "provider_key_enabled_source",
        "provider_key_controls_source",
        "provider_key_uniqueness_source",
        "provider_key_timestamp_timezone_source",
        "provider_key_timestamp_offsets_source",
        "provider_key_browser_date_source",
        "post_create_response_inspected",
        "key_delivery",
        "key_identity_capture",
    }:
        raise NarrationError("execution_key_policy_schema_invalid")
    key_id_sha = str(key.get("key_id_sha256") or "").lower()
    material_sha = str(key.get("key_material_sha256") or "").lower()
    preview_sha = str(key.get("key_preview_sha256") or "").lower()
    key_name_sha = str(key.get("provider_key_name_sha256") or "").lower()
    created_tooltip = key.get("provider_key_created_tooltip")
    expires_tooltip = key.get("provider_key_expires_tooltip")
    browser_date_string = key.get("provider_key_browser_date_string")
    if any(
        (
            not isinstance(created_tooltip, str),
            not isinstance(expires_tooltip, str),
            not isinstance(browser_date_string, str),
        )
    ):
        raise NarrationError("execution_key_policy_invalid")
    if any(
        (
            KEY_UI_TOOLTIP_RE.fullmatch(created_tooltip) is None,
            KEY_UI_TOOLTIP_RE.fullmatch(expires_tooltip) is None,
            KEY_UI_BROWSER_DATE_RE.fullmatch(browser_date_string) is None,
        )
    ):
        raise NarrationError("execution_key_policy_invalid")
    computed_key_time = _key_ui_computed_intervals(
        key, observed_at=observed, code="execution_key_policy_invalid"
    )
    created_lower = _parse_utc(
        key.get("key_created_at_interval_lower"),
        "execution_key_created_interval_invalid",
    )
    created_upper = _parse_utc(
        key.get("key_created_at_interval_upper"),
        "execution_key_created_interval_invalid",
    )
    expires_lower = _parse_utc(
        key.get("key_expires_at_interval_lower"),
        "execution_key_expiry_interval_invalid",
    )
    expires_upper = _parse_utc(
        key.get("key_expires_at_interval_upper"),
        "execution_key_expiry_interval_invalid",
    )
    conservative_deadline = _parse_utc(
        key.get("key_expiry_conservative_deadline"),
        "execution_key_expiry_interval_invalid",
    )
    duration_lower = int((expires_lower - created_upper).total_seconds())
    duration_upper = int((expires_upper - created_lower).total_seconds())
    if any(
        (
            SHA256_RE.fullmatch(key_id_sha) is None,
            SHA256_RE.fullmatch(material_sha) is None,
            SHA256_RE.fullmatch(preview_sha) is None,
            key_name_sha != expected_key_name_sha256,
            key.get("key_session_number") != expected_key_session_number,
            isinstance(key.get("provider_key_matching_row_count"), bool),
            key.get("provider_key_matching_row_count") != 1,
            key.get("provider_key_row_unique") is not True,
            key.get("provider_key_enabled") is not True,
            key.get("provider_key_created_tooltip_sha256")
            != _sha256_bytes(created_tooltip.encode("ascii")),
            key.get("provider_key_expires_tooltip_sha256")
            != _sha256_bytes(expires_tooltip.encode("ascii")),
            key.get("provider_key_browser_date_string_sha256")
            != _sha256_bytes(browser_date_string.encode("ascii")),
            key.get("provider_key_timestamp_timezone") != KEY_UI_TIMEZONE,
            key.get("provider_key_timestamp_precision")
            != KEY_UI_TIMESTAMP_PRECISION,
            key.get("provider_key_timestamp_precision_seconds")
            != KEY_UI_TIMESTAMP_PRECISION_SECONDS,
            key.get("provider_key_timestamp_rounding_mode")
            != KEY_UI_ROUNDING_MODE,
            key.get("provider_key_created_utc_offset") != "-05:00",
            key.get("provider_key_expires_utc_offset") != "-05:00",
            created_lower != computed_key_time["created_lower"],
            created_upper != computed_key_time["created_upper"],
            expires_lower != computed_key_time["expires_lower"],
            expires_upper != computed_key_time["expires_upper"],
            created_upper - created_lower != timedelta(seconds=120),
            expires_upper - expires_lower != timedelta(seconds=120),
            expires_lower - created_lower
            != timedelta(seconds=KEY_LIFETIME_SECONDS),
            conservative_deadline != expires_lower,
            key.get("key_displayed_center_duration_seconds")
            != KEY_LIFETIME_SECONDS,
            key.get("key_duration_interval_lower_seconds") != duration_lower,
            key.get("key_duration_interval_upper_seconds") != duration_upper,
            duration_lower != KEY_LIFETIME_SECONDS - 120,
            duration_upper != KEY_LIFETIME_SECONDS + 120,
            key.get("provider_key_created_tooltip_directly_observed")
            is not True,
            key.get("provider_key_expires_tooltip_directly_observed")
            is not True,
            key.get("requested_ttl_label") != KEY_UI_REQUESTED_TTL_LABEL,
            key.get("key_credit_limit") != expected_key_credit_limit,
            key.get("key_permissions") != list(EXPECTED_KEY_PERMISSIONS),
            key.get("restrict_key_enabled") is not True,
            key.get("auto_disable_if_leaked") is not True,
            key.get("other_chapter_keys_active") is not False,
            key.get("requested_ttl_seconds") != KEY_LIFETIME_SECONDS,
            key.get("provider_key_id_source")
            != KEY_UI_SOURCES["key_id"],
            key.get("provider_key_name_source")
            != KEY_UI_SOURCES["key_name"],
            key.get("provider_key_preview_source")
            != KEY_UI_SOURCES["key_preview"],
            key.get("provider_key_created_tooltip_source")
            != KEY_UI_SOURCES["created_tooltip"],
            key.get("provider_key_expiry_tooltip_source")
            != KEY_UI_SOURCES["expiry_tooltip"],
            key.get("provider_key_enabled_source")
            != KEY_UI_SOURCES["enabled"],
            key.get("provider_key_controls_source")
            != KEY_UI_SOURCES["controls"],
            key.get("provider_key_uniqueness_source")
            != KEY_UI_SOURCES["uniqueness"],
            key.get("provider_key_timestamp_timezone_source")
            != KEY_UI_SOURCES["timezone"],
            key.get("provider_key_timestamp_offsets_source")
            != KEY_UI_SOURCES["offsets"],
            key.get("provider_key_browser_date_source")
            != KEY_UI_SOURCES["browser_time"],
            key.get("post_create_response_inspected") is not False,
            key.get("key_delivery")
            != "secure_piped_stdin_external_transfer_not_attested_by_operator",
            key.get("key_identity_capture")
            != "official_ui_key_row_name_id_preview_times_controls_and_operator_memory_material_sha256",
            now - created_lower > EXECUTION_EVIDENCE_MAX_AGE,
            created_upper - now > timedelta(minutes=2),
            expires_lower - now < MIN_KEY_REMAINING,
        )
    ):
        raise NarrationError("execution_key_policy_invalid")
    continuation = raw.get("continuation")
    if prior_session is None:
        if (
            continuation is not None
            or observed_total_usage_usd != chapter_starting_total_usage_usd
            or observed_billable_requests != chapter_starting_billable_requests
        ):
            raise NarrationError("execution_continuation_unexpected")
        is_continuation = False
        continuation_mode = "initial"
        prior_key_id = None
        prior_key_deleted = False
        prior_key_deleted_at = None
        replacement_key_creation_initiated_at = None
    else:
        prior_total_usage_usd = Decimal(
            str(prior_session["observed_total_usage_usd"])
        )
        partial_usage_usd = observed_total_usage_usd - prior_total_usage_usd
        partial_billable_requests = (
            observed_billable_requests
            - int(prior_session["observed_billable_request_count"])
        )
        ledger_partial_usage_usd = _unrounded_usage_cost(
            committed_since_prior_session
        )
        expected_continuation = {
            "prior_execution_evidence_sha256": prior_session[
                "evidence_sha256"
            ],
            "continuation_mode": "recovery_only_replacement_key",
            "prior_key_id_sha256": prior_session["key_id_sha256"],
            "prior_key_deleted": True,
            "prior_key_deletion_verified": True,
            "prior_key_deleted_at": continuation.get("prior_key_deleted_at")
            if isinstance(continuation, dict)
            else None,
            "replacement_key_creation_initiated_at": (
                continuation.get("replacement_key_creation_initiated_at")
                if isinstance(continuation, dict)
                else None
            ),
            "replacement_key_creation_initiated_after_prior_deletion_verified": (
                True
            ),
            "replacement_key_creation_action_source": (
                "authenticated_browser_action_sequence"
            ),
            "partial_usage_starting_provider_credits": prior_session[
                "available_credits"
            ],
            "partial_usage_ending_provider_credits": available,
            "partial_usage_ledger_credits": committed_since_prior_session,
            "partial_usage_reconciliation_passed": True,
            "partial_usage_starting_total_usage_usd": (
                f"{prior_total_usage_usd:.2f}"
            ),
            "partial_usage_ending_total_usage_usd": (
                f"{observed_total_usage_usd:.2f}"
            ),
            "partial_usage_observed_usd": f"{partial_usage_usd:.2f}",
            "partial_usage_ledger_usd_unrounded": (
                f"{ledger_partial_usage_usd:.4f}"
            ),
            "partial_usage_dollar_tolerance_usd": "0.01",
            "partial_usage_dollar_reconciliation_passed": True,
            "partial_usage_starting_billable_request_count": prior_session[
                "observed_billable_request_count"
            ],
            "partial_usage_ending_billable_request_count": (
                observed_billable_requests
            ),
            "partial_usage_billable_request_count": partial_billable_requests,
            "partial_usage_ledger_request_count": (
                completed_requests_since_prior_session
            ),
            "partial_usage_request_reconciliation_passed": True,
            "ledger_character_cost_total": already_committed,
            "residual_key_credit_limit": expected_key_credit_limit,
            "accepted_plus_residual_cap": (
                already_committed + expected_key_credit_limit
            ),
            "unresolved_provider_ambiguity": False,
            "recovery_only_within_existing_owner_authority": True,
        }
        if continuation != expected_continuation or any(
            (
                key_id_sha == prior_session["key_id_sha256"],
                material_sha == prior_session["key_material_sha256"],
                prior_session["available_credits"] - available
                != committed_since_prior_session,
                already_committed + expected_key_credit_limit
                != packet.renderer_character_cap,
                abs(partial_usage_usd - ledger_partial_usage_usd)
                > Decimal("0.01"),
                partial_billable_requests
                != completed_requests_since_prior_session,
            )
        ):
            raise NarrationError("execution_continuation_invalid")
        deleted_at = _parse_utc(
            continuation.get("prior_key_deleted_at"),
            "execution_prior_key_deletion_time_invalid",
        )
        if ledger_updated_at is None or deleted_at < _parse_utc(
            ledger_updated_at, "render_event_timestamp_invalid"
        ):
            raise NarrationError("execution_prior_key_deleted_before_ledger_settled")
        replacement_initiated = _parse_utc(
            continuation.get("replacement_key_creation_initiated_at"),
            "execution_replacement_key_initiation_time_invalid",
        )
        if replacement_initiated < deleted_at or replacement_initiated > observed:
            raise NarrationError("execution_replacement_key_predates_prior_deletion")
        is_continuation = True
        continuation_mode = "recovery_only_replacement_key"
        prior_key_id = prior_session["key_id_sha256"]
        prior_key_deleted = True
        prior_key_deleted_at = str(continuation["prior_key_deleted_at"])
        replacement_key_creation_initiated_at = str(
            continuation["replacement_key_creation_initiated_at"]
        )
    bindings = raw.get("bindings")
    if bindings != {
        "renderer_sha256": _sha256_file(Path(__file__)),
        "renderer_audit_sha256": sources.renderer_audit_sha256,
        "operator_sha256": sources.operator_sha256,
        "operator_test_sha256": sources.operator_test_sha256,
        "dependency_sha256": dict(sources.dependency_sha256),
        "green_preflight_sha256": sources.green_preflight_sha256,
        "checkpoint2_owner_approval_sha256": (
            sources.checkpoint2_approval_sha256
        ),
        "postpurchase_continuation_approval_sha256": (
            sources.continuation_approval_sha256
        ),
        "chapter_lock_sha256": packet.lock_sha256,
        "output_root_sha256": _output_root_hash(root),
        "ledger_event_chain_head": ledger_head,
    }:
        raise NarrationError("execution_bindings_drift")
    if raw.get("authorization") != {
        "owner_render_and_spend_authorized": True,
        "postpurchase_continuation_authorized": True,
        "independent_renderer_audit_passed": True,
        "chapter_key_created": True,
        "provider_preflight_authorized": True,
        "provider_request_authorized": True,
        "provider_credit_spend_authorized": True,
        "paid_usage_overage_authorized": False,
        "rerender_authorized": False,
    }:
        raise NarrationError("execution_authorization_invalid")
    if raw.get("effects_before_apply") != {
        "provider_tts_requests_sent_this_execution": 0,
        "provider_credits_spent_this_execution": 0,
        "chapter_audio_files_created_this_execution": 0,
    }:
        raise NarrationError("execution_prior_effects_invalid")
    return ExecutionEvidence(
        file_sha256=_sha256_file(evidence_path),
        key_id_sha256=key_id_sha,
        key_material_sha256=material_sha,
        observed_at=_iso(observed),
        available_credits=available,
        remaining_batch_renderer_cap=required_remaining,
        ledger_event_chain_head=ledger_head,
        continuation=is_continuation,
        continuation_mode=continuation_mode,
        prior_key_id_sha256=prior_key_id,
        prior_key_deleted_and_verified=prior_key_deleted,
        ledger_character_cost_total_at_start=already_committed,
        partial_usage_credits_since_prior_session=(
            committed_since_prior_session
        ),
        key_credit_limit=expected_key_credit_limit,
        key_preview_sha256=preview_sha,
        provider_key_name_sha256=key_name_sha,
        key_session_number=expected_key_session_number,
        provider_key_matching_row_count=1,
        provider_key_row_unique=True,
        provider_key_enabled=True,
        provider_key_created_tooltip=created_tooltip,
        provider_key_expires_tooltip=expires_tooltip,
        provider_key_browser_date_string=browser_date_string,
        provider_key_created_tooltip_sha256=str(
            key["provider_key_created_tooltip_sha256"]
        ),
        provider_key_expires_tooltip_sha256=str(
            key["provider_key_expires_tooltip_sha256"]
        ),
        provider_key_browser_date_string_sha256=str(
            key["provider_key_browser_date_string_sha256"]
        ),
        provider_key_timestamp_timezone=KEY_UI_TIMEZONE,
        provider_key_timestamp_precision=KEY_UI_TIMESTAMP_PRECISION,
        provider_key_timestamp_precision_seconds=(
            KEY_UI_TIMESTAMP_PRECISION_SECONDS
        ),
        provider_key_timestamp_rounding_mode=KEY_UI_ROUNDING_MODE,
        provider_key_created_utc_offset=str(
            key["provider_key_created_utc_offset"]
        ),
        provider_key_expires_utc_offset=str(
            key["provider_key_expires_utc_offset"]
        ),
        provider_key_created_tooltip_source=str(
            key["provider_key_created_tooltip_source"]
        ),
        provider_key_expiry_tooltip_source=str(
            key["provider_key_expiry_tooltip_source"]
        ),
        provider_key_timestamp_timezone_source=str(
            key["provider_key_timestamp_timezone_source"]
        ),
        provider_key_timestamp_offsets_source=str(
            key["provider_key_timestamp_offsets_source"]
        ),
        provider_key_browser_date_source=str(
            key["provider_key_browser_date_source"]
        ),
        key_created_at_interval_lower=_iso(created_lower),
        key_created_at_interval_upper=_iso(created_upper),
        key_expires_at_interval_lower=_iso(expires_lower),
        key_expires_at_interval_upper=_iso(expires_upper),
        key_expiry_conservative_deadline=_iso(conservative_deadline),
        key_displayed_center_duration_seconds=KEY_LIFETIME_SECONDS,
        key_duration_interval_lower_seconds=duration_lower,
        key_duration_interval_upper_seconds=duration_upper,
        requested_ttl_label=KEY_UI_REQUESTED_TTL_LABEL,
        requested_ttl_seconds=KEY_LIFETIME_SECONDS,
        observed_total_usage_usd=f"{observed_total_usage_usd:.2f}",
        observed_billable_request_count=observed_billable_requests,
        ledger_request_count_at_start=completed_request_count,
        partial_billable_requests_since_prior_session=(
            completed_requests_since_prior_session
        ),
        prior_key_deleted_at=prior_key_deleted_at,
        replacement_key_creation_initiated_at=(
            replacement_key_creation_initiated_at
        ),
    )


def _header(headers: Mapping[str, str], name: str) -> str | None:
    target = name.casefold()
    for key, value in headers.items():
        if str(key).casefold() == target:
            return str(value)
    return None


def _provider_json(response: ProviderResponse, code: str) -> dict[str, Any]:
    content_type = (_header(response.headers, "content-type") or "").casefold()
    if not 200 <= int(response.status_code) <= 299 or "json" not in content_type:
        raise NarrationError(code)
    try:
        value = json.loads(response.body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise NarrationError(code) from exc
    if not isinstance(value, dict):
        raise NarrationError(code)
    return value


def _decimal_equal(actual: object, expected: object) -> bool:
    try:
        return Decimal(str(actual)) == Decimal(str(expected))
    except InvalidOperation:
        return False


def _validate_voice_metadata(metadata: Mapping[str, Any]) -> dict[str, str]:
    sharing = metadata.get("sharing")
    if not isinstance(sharing, dict):
        raise NarrationError("provider_voice_metadata_drift")
    supported = metadata.get("high_quality_base_model_ids")
    multiplier = sharing.get(
        "credit_multiplier", metadata.get("credit_multiplier")
    )
    if any(
        (
            str(metadata.get("voice_id") or metadata.get("voiceId") or "")
            != VOICE_ID,
            str(metadata.get("name") or "") != VOICE_NAME,
            str(sharing.get("original_voice_id") or "") != VOICE_ID,
            not isinstance(supported, list),
            MODEL_ID not in (supported or []),
            str(sharing.get("status") or "").casefold() != "copied",
            metadata.get("disable_at_unix") not in (None, 0, "", False),
            sharing.get("disable_at_unix") not in (None, 0, "", False),
            not _decimal_equal(sharing.get("rate"), 1),
            not _decimal_equal(sharing.get("notice_period"), 730),
            multiplier is not None and not _decimal_equal(multiplier, 1),
        )
    ):
        raise NarrationError("provider_voice_metadata_drift")
    return {
        "custom_credit_multiplier": (
            "not_reported" if multiplier is None else "1"
        ),
        "sharing_status": "copied",
        "voice_library_rate": "1",
        "withdrawal_notice_period": "730",
    }


def _subscription_remaining(subscription: Mapping[str, Any]) -> int:
    tier = str(subscription.get("tier") or subscription.get("plan") or "").casefold()
    used = subscription.get("character_count", subscription.get("credits_used"))
    limit = subscription.get("character_limit", subscription.get("credits_limit"))
    def exact_integer(value: object) -> int:
        if isinstance(value, bool):
            raise NarrationError("provider_subscription_invalid")
        if isinstance(value, int):
            return value
        if isinstance(value, str) and re.fullmatch(r"0|[1-9]\d*", value):
            return int(value)
        raise NarrationError("provider_subscription_invalid")

    if tier != "creator":
        raise NarrationError("provider_subscription_invalid")
    used_exact = exact_integer(used)
    limit_exact = exact_integer(limit)
    if used_exact < 0 or limit_exact < used_exact:
        raise NarrationError("provider_subscription_invalid")
    return limit_exact - used_exact


def _require_conservative_key_deadline(
    deadline_value: object,
    *,
    current: datetime,
    operation_timeout_seconds: float,
    code: str,
) -> None:
    if operation_timeout_seconds < 0:
        raise NarrationError(code)
    deadline = _parse_utc(deadline_value, code)
    required = timedelta(
        seconds=operation_timeout_seconds + KEY_DISPATCH_SAFETY_BUFFER_SECONDS
    )
    if deadline - current < required:
        raise NarrationError(code)


def _require_execution_key_deadline(
    execution: ExecutionEvidence,
    *,
    current: datetime,
    operation_timeout_seconds: float,
) -> None:
    _require_conservative_key_deadline(
        execution.key_expiry_conservative_deadline,
        current=current,
        operation_timeout_seconds=operation_timeout_seconds,
        code="conservative_key_expiry_deadline_too_close",
    )


def provider_preflight(
    transport: Any,
    *,
    api_key: str,
    execution: ExecutionEvidence,
    timeout: float,
) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "xi-api-key": api_key,
        "User-Agent": "Trailhead-Originals-Smokies-Remaining/2",
    }
    try:
        metadata_response = transport.get(
            f"{VOICE_ENDPOINT_ROOT}/{VOICE_ID}",
            headers=headers,
            timeout=timeout,
        )
        settings_response = transport.get(
            f"{VOICE_ENDPOINT_ROOT}/{VOICE_ID}/settings",
            headers=headers,
            timeout=timeout,
        )
        subscription_response = transport.get(
            SUBSCRIPTION_ENDPOINT, headers=headers, timeout=timeout
        )
    except Exception:
        raise NarrationError("provider_preflight_transport_failed") from None
    metadata = _provider_json(
        metadata_response, "provider_voice_metadata_unavailable"
    )
    settings = _provider_json(
        settings_response, "provider_voice_settings_unavailable"
    )
    subscription = _provider_json(
        subscription_response, "provider_subscription_unavailable"
    )
    lineage = _validate_voice_metadata(metadata)
    if set(VOICE_SETTINGS) - set(settings) or any(
        (
            settings.get(key) is not expected
            if isinstance(expected, bool)
            else not _decimal_equal(settings.get(key), expected)
        )
        for key, expected in VOICE_SETTINGS.items()
    ):
        raise NarrationError("provider_voice_settings_drift")
    remaining = _subscription_remaining(subscription)
    if remaining != execution.available_credits:
        raise NarrationError("provider_subscription_evidence_mismatch")
    if remaining < execution.remaining_batch_renderer_cap:
        raise NarrationError("provider_subscription_balance_insufficient")
    return {
        "evidence_sha256": execution.file_sha256,
        "metadata_sha256": _sha256_bytes(_canonical_bytes(metadata)),
        "settings_sha256": _sha256_bytes(_canonical_bytes(settings)),
        "subscription_sha256": _sha256_bytes(_canonical_bytes(subscription)),
        "subscription_remaining_credits": remaining,
        "model_id": MODEL_ID,
        "language_code": LANGUAGE_CODE,
        "output_format_id": OUTPUT_FORMAT_ID,
        "request_voice_settings": dict(VOICE_SETTINGS),
        "stored_voice_settings_relied_on": False,
        "beta_services_used": False,
        **lineage,
    }


def _id3v2_end(content: bytes) -> int:
    if not content.startswith(b"ID3"):
        return 0
    if len(content) < 10 or content[3] not in (2, 3, 4):
        raise NarrationError("provider_audio_id3_invalid")
    if any(byte & 0x80 for byte in content[6:10]):
        raise NarrationError("provider_audio_id3_invalid")
    size = (
        (content[6] << 21)
        | (content[7] << 14)
        | (content[8] << 7)
        | content[9]
    )
    end = 10 + size + (10 if content[5] & 0x10 else 0)
    if end > len(content):
        raise NarrationError("provider_audio_id3_invalid")
    return end


def _mp3_frame(header: bytes) -> tuple[int, int, int]:
    if len(header) != 4 or header[0] != 0xFF or header[1] & 0xE0 != 0xE0:
        raise NarrationError("provider_audio_invalid")
    version_bits = (header[1] >> 3) & 0x03
    layer_bits = (header[1] >> 1) & 0x03
    bitrate_index = (header[2] >> 4) & 0x0F
    sample_index = (header[2] >> 2) & 0x03
    padding = (header[2] >> 1) & 0x01
    if version_bits != 0x03 or layer_bits != 0x01:
        raise NarrationError("provider_audio_format_mismatch")
    bitrates = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
    sample_rates = (44_100, 48_000, 32_000, 0)
    bitrate = bitrates[bitrate_index]
    sample_rate = sample_rates[sample_index]
    if bitrate <= 0 or sample_rate <= 0:
        raise NarrationError("provider_audio_invalid")
    return math.floor(144 * bitrate * 1000 / sample_rate) + padding, sample_rate, bitrate


def _strict_probe_mono_mp3(content: bytes) -> Mp3Probe:
    """Accept only ID3v2 + contiguous mono frames + optional exact ID3v1."""
    if len(content) < MIN_MP3_BYTES:
        raise NarrationError("provider_audio_too_short")
    prefix = content[:64].lstrip().lower()
    if prefix.startswith((b"{", b"[", b"<html", b"<!doctype")):
        raise NarrationError("provider_audio_invalid")
    cursor = _id3v2_end(content)
    frame_count = 0
    sample_rate = 0
    bitrate = 0
    while cursor < len(content):
        if content[cursor : cursor + 3] == b"TAG" and len(content) - cursor == 128:
            cursor = len(content)
            break
        frame_length, current_rate, current_bitrate = _mp3_frame(
            content[cursor : cursor + 4]
        )
        if cursor + frame_length > len(content):
            raise NarrationError("provider_audio_truncated_frame")
        if ((content[cursor + 3] >> 6) & 0x03) != 0x03:
            raise NarrationError("provider_audio_channel_mismatch")
        if current_rate != 44_100 or current_bitrate != 128:
            raise NarrationError("provider_audio_format_mismatch")
        if sample_rate and current_rate != sample_rate:
            raise NarrationError("provider_audio_format_mismatch")
        sample_rate = current_rate
        bitrate = current_bitrate
        frame_count += 1
        cursor += frame_length
    if cursor != len(content) or frame_count < 10:
        raise NarrationError("provider_audio_structure_invalid")
    return Mp3Probe(
        byte_count=len(content),
        sha256=_sha256_bytes(content),
        sample_rate_hz=sample_rate,
        bitrate_kbps=bitrate,
        frame_count=frame_count,
        duration_s=frame_count * 1152 / sample_rate,
    )


def _request_payload(entry: RenderRequest) -> dict[str, Any]:
    return {
        "text": entry.transcript,
        "model_id": MODEL_ID,
        "language_code": LANGUAGE_CODE,
        "voice_settings": dict(VOICE_SETTINGS),
    }


def _request_fingerprint(packet: ChapterPacket, entry: RenderRequest) -> str:
    return _sha256_bytes(
        _canonical_bytes(
            {
                "renderer_contract": RENDERER_CONTRACT,
                "lock_sha256": packet.lock_sha256,
                "provider_request_id": entry.provider_request_id,
                "voice_id": VOICE_ID,
                "output_format_id": OUTPUT_FORMAT_ID,
                "payload": _request_payload(entry),
            }
        )
    )


def _projected_cost(character_count: int) -> Decimal:
    return (
        Decimal(character_count) / Decimal(1000) * Decimal("0.10")
    ).quantize(Decimal("0.01"), rounding=ROUND_UP)


def _unrounded_usage_cost(character_count: int) -> Decimal:
    return (Decimal(character_count) / Decimal(10_000)).quantize(
        Decimal("0.0001")
    )


def _master_name(entry: RenderRequest) -> str:
    return f"{entry.stable_order:02d}-{entry.provider_request_id}.mp3"


def _metadata_name(entry: RenderRequest) -> str:
    return f"{entry.stable_order:02d}-{entry.provider_request_id}.json"


def _stage_audio_name(entry: RenderRequest) -> str:
    return f".{_master_name(entry)}.accepted.pending"


def _stage_metadata_name(entry: RenderRequest) -> str:
    return f".{_metadata_name(entry)}.accepted.pending"


def _quarantine_name(entry: RenderRequest) -> str:
    return f"{entry.stable_order:02d}-{entry.provider_request_id}.ambiguous.bin"


def _request_identity(entry: RenderRequest) -> dict[str, Any]:
    return {
        "stable_order": entry.stable_order,
        "entry_id": entry.entry_id,
        "request_kind": entry.request_kind,
        "base_variant_id": entry.base_variant_id,
        "override_variant_id": entry.override_variant_id,
        "effective_variant_ids": list(entry.effective_variant_ids),
        "raw_transcript_sha256": entry.raw_transcript_sha256,
        "normalized_transcript_sha256": entry.normalized_transcript_sha256,
        "word_count": entry.word_count,
        "payload_character_count": entry.payload_character_count,
        "normalized_character_count": entry.normalized_character_count,
        "reserved_provider_credit_ceiling": (
            entry.reserved_provider_credit_ceiling
        ),
    }


def _initial_event_payload(
    packet: ChapterPacket,
    sources: SourceBindings,
    root: Path,
) -> dict[str, Any]:
    return {
        "renderer_contract": RENDERER_CONTRACT,
        "chapter_id": packet.chapter_id,
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "checkpoint2_owner_approval_sha256": sources.checkpoint2_approval_sha256,
        "postpurchase_continuation_approval_sha256": (
            sources.continuation_approval_sha256
        ),
        "green_preflight_sha256": sources.green_preflight_sha256,
        "renderer_audit_sha256": sources.renderer_audit_sha256,
        "operator_sha256": sources.operator_sha256,
        "operator_test_sha256": sources.operator_test_sha256,
        "dependency_sha256": dict(sources.dependency_sha256),
        "output_root_sha256": _output_root_hash(root),
        "provider": "elevenlabs",
        "voice_id": VOICE_ID,
        "model_id": MODEL_ID,
        "language_code": LANGUAGE_CODE,
        "output_format_id": OUTPUT_FORMAT_ID,
        "request_count": len(packet.requests),
        "request_inventory_sha256": _sha256_bytes(
            _canonical_bytes(
                [
                    {
                        "provider_request_id": entry.provider_request_id,
                        **_request_identity(entry),
                    }
                    for entry in packet.requests
                ]
            )
        ),
        "caps": {
            "renderer_characters": packet.renderer_character_cap,
            "api_key_credits": packet.key_credit_quota,
            "reserved_provider_credits": packet.reserved_provider_credit_ceiling,
            "dollars_usd": packet.dollar_cap_usd,
            "rerenders": 0,
            "cross_chapter_borrowing": False,
            "paid_overage": False,
        },
        "provider_usage_baseline": {
            "used_provider_credits": 14_510,
            "remaining_provider_credits": 171_490,
            "total_provider_credits": 186_000,
            "billable_request_count": PREBATCH_BILLABLE_REQUEST_COUNT,
            "total_usage_usd": str(PREBATCH_TOTAL_USAGE_USD),
        },
    }


def _new_state(packet: ChapterPacket) -> dict[str, Any]:
    return {
        "initialized": False,
        "initial": None,
        "created_at": None,
        "updated_at": None,
        "status": "in_progress",
        "sessions": [],
        "preflights": [],
        "items": {
            entry.provider_request_id: {
                **_request_identity(entry),
                "state": "pending",
                "attempts": 0,
                "request_fingerprint": None,
                "accepted": None,
                "completion": None,
            }
            for entry in packet.requests
        },
        "blocked_reason": None,
        "event_count": 0,
        "event_head_sha256": "0" * 64,
    }


def _event_without_hash(event: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "seq": event["seq"],
        "event_type": event["event_type"],
        "at": event["at"],
        "provider_request_id": event["provider_request_id"],
        "payload": event["payload"],
        "previous_event_sha256": event["previous_event_sha256"],
    }


def _require_exact_fields(value: object, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        raise NarrationError(code)
    return value


def _validate_hash_field(value: object, code: str) -> str:
    raw = str(value or "").lower()
    if SHA256_RE.fullmatch(raw) is None:
        raise NarrationError(code)
    return raw


def _event_response_fields(payload: dict[str, Any], *, allow_retry: bool = False) -> None:
    fields = {
        "attempt",
        "http_status",
        "response_bytes",
        "response_sha256",
        "request_fingerprint",
        "character_cost",
        "provider_request_id_sha256",
        "provider_trace_id_sha256",
    }
    if allow_retry:
        fields.add("retry_after_s")
    if set(payload) != fields:
        raise NarrationError("render_event_response_schema_invalid")
    _validate_hash_field(payload["response_sha256"], "render_event_hash_invalid")
    for name in ("provider_request_id_sha256", "provider_trace_id_sha256"):
        if payload[name] is not None:
            _validate_hash_field(payload[name], "render_event_hash_invalid")


def _replay_events(
    events: Sequence[Mapping[str, Any]],
    *,
    packet: ChapterPacket,
    sources: SourceBindings,
    root: Path,
) -> dict[str, Any]:
    state = _new_state(packet)
    previous = "0" * 64
    previous_at: datetime | None = None
    entries = {entry.provider_request_id: entry for entry in packet.requests}
    for expected_seq, event_raw in enumerate(events, start=1):
        event = _require_exact_fields(
            event_raw,
            {
                "seq",
                "event_type",
                "at",
                "provider_request_id",
                "payload",
                "previous_event_sha256",
                "event_sha256",
            },
            "render_event_schema_invalid",
        )
        if event["seq"] != expected_seq or event["previous_event_sha256"] != previous:
            raise NarrationError("render_event_chain_invalid")
        calculated = _sha256_bytes(_canonical_bytes(_event_without_hash(event)))
        if event["event_sha256"] != calculated:
            raise NarrationError("render_event_hash_invalid")
        at = _parse_utc(event["at"], "render_event_timestamp_invalid")
        if previous_at is not None and at < previous_at:
            raise NarrationError("render_event_timestamp_regressed")
        previous_at = at
        event_type = event["event_type"]
        request_id = event["provider_request_id"]
        payload = event["payload"]
        if not isinstance(payload, dict):
            raise NarrationError("render_event_payload_invalid")

        if expected_seq == 1:
            if (
                event_type != "ledger_initialized"
                or request_id is not None
                or payload != _initial_event_payload(packet, sources, root)
            ):
                raise NarrationError("render_initial_event_invalid")
            state["initialized"] = True
            state["initial"] = payload
            state["created_at"] = event["at"]
        elif not state["initialized"]:
            raise NarrationError("render_initial_event_missing")
        elif event_type == "execution_session_started":
            _require_exact_fields(
                payload,
                {
                    "available_credits",
                    "continuation",
                    "continuation_mode",
                    "evidence_sha256",
                    "key_credit_limit",
                    "key_id_sha256",
                    "key_material_sha256",
                    "key_preview_sha256",
                    "provider_key_name_sha256",
                    "key_session_number",
                    "provider_key_matching_row_count",
                    "provider_key_row_unique",
                    "provider_key_enabled",
                    "provider_key_created_tooltip",
                    "provider_key_expires_tooltip",
                    "provider_key_browser_date_string",
                    "provider_key_created_tooltip_sha256",
                    "provider_key_expires_tooltip_sha256",
                    "provider_key_browser_date_string_sha256",
                    "provider_key_timestamp_timezone",
                    "provider_key_timestamp_precision",
                    "provider_key_timestamp_precision_seconds",
                    "provider_key_timestamp_rounding_mode",
                    "provider_key_created_utc_offset",
                    "provider_key_expires_utc_offset",
                    "provider_key_created_tooltip_source",
                    "provider_key_expiry_tooltip_source",
                    "provider_key_timestamp_timezone_source",
                    "provider_key_timestamp_offsets_source",
                    "provider_key_browser_date_source",
                    "key_created_at_interval_lower",
                    "key_created_at_interval_upper",
                    "key_expires_at_interval_lower",
                    "key_expires_at_interval_upper",
                    "key_expiry_conservative_deadline",
                    "key_displayed_center_duration_seconds",
                    "key_duration_interval_lower_seconds",
                    "key_duration_interval_upper_seconds",
                    "provider_key_created_tooltip_directly_observed",
                    "provider_key_expires_tooltip_directly_observed",
                    "requested_ttl_label",
                    "ledger_character_cost_total_at_start",
                    "ledger_request_count_at_start",
                    "observed_at",
                    "observed_billable_request_count",
                    "observed_total_usage_usd",
                    "partial_billable_requests_since_prior_session",
                    "partial_usage_credits_since_prior_session",
                    "prior_key_deleted_and_verified",
                    "prior_key_deleted_at",
                    "prior_key_id_sha256",
                    "remaining_batch_renderer_cap",
                    "replacement_key_creation_initiated_at",
                    "requested_ttl_seconds",
                },
                "render_session_event_invalid",
            )
            if request_id is not None or state["status"] != "in_progress":
                raise NarrationError("render_session_transition_invalid")
            for name in (
                "evidence_sha256",
                "key_id_sha256",
                "key_material_sha256",
                "key_preview_sha256",
                "provider_key_name_sha256",
                "provider_key_created_tooltip_sha256",
                "provider_key_expires_tooltip_sha256",
                "provider_key_browser_date_string_sha256",
            ):
                _validate_hash_field(payload[name], "render_session_hash_invalid")
            expected_session_number = len(state["sessions"]) + 1
            if any(
                (
                    payload["key_session_number"] != expected_session_number,
                    payload["provider_key_name_sha256"]
                    != _sha256_bytes(
                        _provider_key_name(
                            packet.chapter_id, expected_session_number
                        ).encode("ascii")
                    ),
                    isinstance(
                        payload["provider_key_matching_row_count"], bool
                    ),
                    payload["provider_key_matching_row_count"] != 1,
                    payload["provider_key_row_unique"] is not True,
                )
            ):
                raise NarrationError("render_session_key_name_invalid")
            observed_at = _parse_utc(
                payload["observed_at"], "render_session_observed_at_invalid"
            )
            created_tooltip = payload["provider_key_created_tooltip"]
            expires_tooltip = payload["provider_key_expires_tooltip"]
            browser_date_string = payload["provider_key_browser_date_string"]
            if any(
                (
                    not isinstance(created_tooltip, str),
                    not isinstance(expires_tooltip, str),
                    not isinstance(browser_date_string, str),
                )
            ):
                raise NarrationError("render_session_key_expiry_invalid")
            if any(
                (
                    KEY_UI_TOOLTIP_RE.fullmatch(created_tooltip) is None,
                    KEY_UI_TOOLTIP_RE.fullmatch(expires_tooltip) is None,
                    KEY_UI_BROWSER_DATE_RE.fullmatch(browser_date_string) is None,
                )
            ):
                raise NarrationError("render_session_key_expiry_invalid")
            computed_key_time = _key_ui_computed_intervals(
                payload,
                observed_at=observed_at,
                code="render_session_key_expiry_invalid",
            )
            created_lower = _parse_utc(
                payload["key_created_at_interval_lower"],
                "render_session_key_time_invalid",
            )
            created_upper = _parse_utc(
                payload["key_created_at_interval_upper"],
                "render_session_key_time_invalid",
            )
            expires_lower = _parse_utc(
                payload["key_expires_at_interval_lower"],
                "render_session_key_time_invalid",
            )
            expires_upper = _parse_utc(
                payload["key_expires_at_interval_upper"],
                "render_session_key_time_invalid",
            )
            conservative_deadline = _parse_utc(
                payload["key_expiry_conservative_deadline"],
                "render_session_key_time_invalid",
            )
            duration_lower = int(
                (expires_lower - created_upper).total_seconds()
            )
            duration_upper = int(
                (expires_upper - created_lower).total_seconds()
            )
            if any(
                (
                    payload["provider_key_enabled"] is not True,
                    payload["provider_key_created_tooltip_sha256"]
                    != _sha256_bytes(
                        created_tooltip.encode("ascii")
                    ),
                    payload["provider_key_expires_tooltip_sha256"]
                    != _sha256_bytes(
                        expires_tooltip.encode("ascii")
                    ),
                    payload["provider_key_browser_date_string_sha256"]
                    != _sha256_bytes(
                        browser_date_string.encode("ascii")
                    ),
                    payload["provider_key_timestamp_timezone"]
                    != KEY_UI_TIMEZONE,
                    payload["provider_key_timestamp_precision"]
                    != KEY_UI_TIMESTAMP_PRECISION,
                    payload["provider_key_timestamp_precision_seconds"]
                    != KEY_UI_TIMESTAMP_PRECISION_SECONDS,
                    payload["provider_key_timestamp_rounding_mode"]
                    != KEY_UI_ROUNDING_MODE,
                    payload["provider_key_created_utc_offset"] != "-05:00",
                    payload["provider_key_expires_utc_offset"] != "-05:00",
                    created_lower != computed_key_time["created_lower"],
                    created_upper != computed_key_time["created_upper"],
                    expires_lower != computed_key_time["expires_lower"],
                    expires_upper != computed_key_time["expires_upper"],
                    payload["provider_key_created_tooltip_source"]
                    != KEY_UI_SOURCES["created_tooltip"],
                    payload["provider_key_expiry_tooltip_source"]
                    != KEY_UI_SOURCES["expiry_tooltip"],
                    payload["provider_key_timestamp_timezone_source"]
                    != KEY_UI_SOURCES["timezone"],
                    payload["provider_key_timestamp_offsets_source"]
                    != KEY_UI_SOURCES["offsets"],
                    payload["provider_key_browser_date_source"]
                    != KEY_UI_SOURCES["browser_time"],
                    created_upper - created_lower != timedelta(seconds=120),
                    expires_upper - expires_lower != timedelta(seconds=120),
                    expires_lower - created_lower
                    != timedelta(seconds=KEY_LIFETIME_SECONDS),
                    conservative_deadline != expires_lower,
                    payload["key_displayed_center_duration_seconds"]
                    != KEY_LIFETIME_SECONDS,
                    payload["key_duration_interval_lower_seconds"]
                    != duration_lower,
                    payload["key_duration_interval_upper_seconds"]
                    != duration_upper,
                    duration_lower != KEY_LIFETIME_SECONDS - 120,
                    duration_upper != KEY_LIFETIME_SECONDS + 120,
                    payload["provider_key_created_tooltip_directly_observed"]
                    is not True,
                    payload["provider_key_expires_tooltip_directly_observed"]
                    is not True,
                    payload["requested_ttl_label"]
                    != KEY_UI_REQUESTED_TTL_LABEL,
                    payload["requested_ttl_seconds"] != KEY_LIFETIME_SECONDS,
                    observed_at - created_lower
                    > EXECUTION_EVIDENCE_MAX_AGE,
                    created_upper - observed_at > timedelta(minutes=2),
                    expires_lower - observed_at < MIN_KEY_REMAINING,
                )
            ):
                raise NarrationError("render_session_key_expiry_invalid")
            if re.fullmatch(
                r"\d+\.\d{2}", str(payload["observed_total_usage_usd"])
            ) is None:
                raise NarrationError("render_session_usage_usd_invalid")
            if (
                isinstance(payload["observed_billable_request_count"], bool)
                or not isinstance(payload["observed_billable_request_count"], int)
                or payload["observed_billable_request_count"] < 0
            ):
                raise NarrationError("render_session_request_count_invalid")
            committed_at_start = sum(
                int(item["accepted"]["character_cost"])
                for item in state["items"].values()
                if item["state"] == "completed"
            )
            completed_at_start = sum(
                item["state"] == "completed" for item in state["items"].values()
            )
            if state["sessions"]:
                prior = state["sessions"][-1]
                since_prior = committed_at_start - int(
                    prior["ledger_character_cost_total_at_start"]
                )
                requests_since_prior = completed_at_start - int(
                    prior["ledger_request_count_at_start"]
                )
                observed_usage_delta = Decimal(
                    payload["observed_total_usage_usd"]
                ) - Decimal(prior["observed_total_usage_usd"])
                if any(
                    (
                        payload["continuation"] is not True,
                        payload["continuation_mode"]
                        != "recovery_only_replacement_key",
                        payload["prior_key_id_sha256"]
                        != prior["key_id_sha256"],
                        payload["prior_key_deleted_and_verified"] is not True,
                        payload["prior_key_deleted_at"] is None,
                        payload["replacement_key_creation_initiated_at"]
                        is None,
                        payload["key_id_sha256"] == prior["key_id_sha256"],
                        payload["key_material_sha256"]
                        == prior["key_material_sha256"],
                        payload["ledger_character_cost_total_at_start"]
                        != committed_at_start,
                        payload["partial_usage_credits_since_prior_session"]
                        != since_prior,
                        payload[
                            "partial_billable_requests_since_prior_session"
                        ]
                        != requests_since_prior,
                        prior["available_credits"] - payload["available_credits"]
                        != since_prior,
                        payload["observed_billable_request_count"]
                        - prior["observed_billable_request_count"]
                        != requests_since_prior,
                        payload["key_credit_limit"]
                        != packet.renderer_character_cap - committed_at_start,
                        abs(
                            observed_usage_delta
                            - _unrounded_usage_cost(since_prior)
                        )
                        > Decimal("0.01"),
                    )
                ):
                    raise NarrationError("render_session_key_drift")
                deleted_at = _parse_utc(
                    payload["prior_key_deleted_at"],
                    "render_session_prior_key_deletion_time_invalid",
                )
                replacement_initiated = _parse_utc(
                    payload["replacement_key_creation_initiated_at"],
                    "render_session_replacement_key_initiation_time_invalid",
                )
                if (
                    replacement_initiated < deleted_at
                    or replacement_initiated > observed_at
                ):
                    raise NarrationError("render_session_key_drift")
            elif any(
                (
                    payload["continuation"] is not False,
                    payload["continuation_mode"] != "initial",
                    payload["prior_key_id_sha256"] is not None,
                    payload["prior_key_deleted_and_verified"] is not False,
                    payload["ledger_character_cost_total_at_start"] != 0,
                    payload["ledger_request_count_at_start"] != 0,
                    payload["partial_usage_credits_since_prior_session"] != 0,
                    payload[
                        "partial_billable_requests_since_prior_session"
                    ]
                    != 0,
                    payload["prior_key_deleted_at"] is not None,
                    payload["replacement_key_creation_initiated_at"]
                    is not None,
                    payload["key_credit_limit"] != packet.key_credit_quota,
                    re.fullmatch(
                        r"\d+\.\d{2}",
                        str(payload["observed_total_usage_usd"]),
                    )
                    is None,
                )
            ):
                raise NarrationError("render_session_continuation_invalid")
            if any(
                item["state"]
                in {
                    "dispatched",
                    "blocked_ambiguous",
                    "blocked_definitive",
                }
                for item in state["items"].values()
            ):
                raise NarrationError("render_session_started_while_blocked")
            state["sessions"].append(dict(payload))
        elif event_type == "provider_preflight_passed":
            fields = {
                "evidence_sha256",
                "metadata_sha256",
                "settings_sha256",
                "subscription_sha256",
                "subscription_remaining_credits",
                "model_id",
                "language_code",
                "output_format_id",
                "request_voice_settings",
                "stored_voice_settings_relied_on",
                "beta_services_used",
                "custom_credit_multiplier",
                "sharing_status",
                "voice_library_rate",
                "withdrawal_notice_period",
            }
            _require_exact_fields(payload, fields, "render_preflight_event_invalid")
            if (
                request_id is not None
                or not state["sessions"]
                or payload["evidence_sha256"]
                != state["sessions"][-1]["evidence_sha256"]
            ):
                raise NarrationError("render_preflight_transition_invalid")
            for name in ("metadata_sha256", "settings_sha256", "subscription_sha256"):
                _validate_hash_field(payload[name], "render_preflight_hash_invalid")
            state["preflights"].append(dict(payload))
        elif event_type in {
            "request_reserved",
            "request_dispatched",
            "retryable_uncharged_429",
            "audio_accepted",
            "request_completed",
            "ambiguous_transport",
            "ambiguous_provider_5xx",
            "ambiguous_429_billing",
            "ambiguous_audio_or_cost",
            "failed_definitive",
        }:
            if request_id not in entries:
                raise NarrationError("render_event_request_invalid")
            entry = entries[request_id]
            item = state["items"][request_id]
            fingerprint = _request_fingerprint(packet, entry)
            if event_type == "request_reserved":
                if payload != {"request_fingerprint": fingerprint} or item["state"] != "pending":
                    raise NarrationError("render_reservation_transition_invalid")
                item["state"] = "reserved"
                item["request_fingerprint"] = fingerprint
            elif event_type == "request_dispatched":
                if set(payload) != {
                    "attempt",
                    "evidence_sha256",
                    "request_fingerprint",
                }:
                    raise NarrationError("render_dispatch_schema_invalid")
                if any(
                    (
                        item["state"] not in {"reserved", "retryable_429"},
                        payload["attempt"] != item["attempts"] + 1,
                        payload["attempt"] > MAX_PROVIDER_ATTEMPTS,
                        payload["request_fingerprint"] != fingerprint,
                        not state["preflights"],
                        payload["evidence_sha256"]
                        != state["preflights"][-1]["evidence_sha256"],
                    )
                ):
                    raise NarrationError("render_dispatch_transition_invalid")
                item["attempts"] = payload["attempt"]
                item["state"] = "dispatched"
            elif event_type == "retryable_uncharged_429":
                _event_response_fields(payload, allow_retry=True)
                if any(
                    (
                        item["state"] != "dispatched",
                        payload["attempt"] != item["attempts"],
                        payload["http_status"] != 429,
                        payload["character_cost"] != 0,
                        payload["request_fingerprint"] != fingerprint,
                        not isinstance(payload["retry_after_s"], (int, float)),
                        not 0 <= float(payload["retry_after_s"])
                        <= MAX_RETRY_AFTER_SECONDS,
                    )
                ):
                    raise NarrationError("render_retry_transition_invalid")
                item["state"] = "retryable_429"
            elif event_type == "audio_accepted":
                expected_fields = {
                    "attempt",
                    "request_fingerprint",
                    "character_cost",
                    "projected_cost_usd",
                    "content_type",
                    "response_sha256",
                    "response_bytes",
                    "provider_request_id_sha256",
                    "provider_trace_id_sha256",
                    "audio",
                    "words_per_minute",
                    "accepted_at",
                    "stage_audio_file",
                    "stage_metadata_file",
                }
                _require_exact_fields(payload, expected_fields, "render_accept_event_invalid")
                cost = payload["character_cost"]
                if any(
                    (
                        item["state"] != "dispatched",
                        payload["attempt"] != item["attempts"],
                        payload["request_fingerprint"] != fingerprint,
                        isinstance(cost, bool),
                        not isinstance(cost, int),
                        isinstance(cost, int)
                        and not 0 < cost <= entry.reserved_provider_credit_ceiling,
                        payload["projected_cost_usd"]
                        != str(_projected_cost(int(cost))),
                        payload["content_type"] != "audio/mpeg",
                        payload["stage_audio_file"] != _stage_audio_name(entry),
                        payload["stage_metadata_file"]
                        != _stage_metadata_name(entry),
                    )
                ):
                    raise NarrationError("render_accept_transition_invalid")
                _validate_hash_field(payload["response_sha256"], "render_accept_hash_invalid")
                accepted = dict(payload)
                accepted["accepted_event_sha256"] = event["event_sha256"]
                item["accepted"] = accepted
                item["state"] = "accepted_pending_promotion"
            elif event_type == "request_completed":
                if payload != {
                    "accepted_event_sha256": (
                        item["accepted"]["accepted_event_sha256"]
                        if isinstance(item.get("accepted"), dict)
                        else None
                    ),
                    "master_file": _master_name(entry),
                    "metadata_file": _metadata_name(entry),
                } or item["state"] != "accepted_pending_promotion":
                    raise NarrationError("render_completion_transition_invalid")
                item["state"] = "completed"
                item["completion"] = {
                    **payload,
                    "completed_at": event["at"],
                }
            elif event_type == "ambiguous_transport":
                if set(payload) != {
                    "attempt",
                    "request_fingerprint",
                    "exception_type",
                } or any(
                    (
                        item["state"] != "dispatched",
                        payload["attempt"] != item["attempts"],
                        payload["request_fingerprint"] != fingerprint,
                        not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,79}", str(payload["exception_type"])),
                    )
                ):
                    raise NarrationError("render_ambiguous_transport_event_invalid")
                item["state"] = "blocked_ambiguous"
                state["status"] = "blocked_manual_reconciliation_required"
                state["blocked_reason"] = event_type
            else:
                _event_response_fields(payload)
                status = payload["http_status"]
                valid_status = {
                    "ambiguous_provider_5xx": 500 <= status <= 599,
                    "ambiguous_429_billing": status == 429,
                    "ambiguous_audio_or_cost": 200 <= status <= 299,
                    "failed_definitive": status < 500 and status != 429 and not 200 <= status <= 299,
                }[event_type]
                if any(
                    (
                        item["state"] != "dispatched",
                        payload["attempt"] != item["attempts"],
                        payload["request_fingerprint"] != fingerprint,
                        not valid_status,
                    )
                ):
                    raise NarrationError("render_terminal_event_invalid")
                item["state"] = (
                    "blocked_definitive"
                    if event_type == "failed_definitive"
                    else "blocked_ambiguous"
                )
                state["status"] = "blocked_manual_reconciliation_required"
                state["blocked_reason"] = event_type
        elif event_type == "chapter_render_complete":
            committed = sum(
                int(item["accepted"]["character_cost"])
                for item in state["items"].values()
                if item["state"] == "completed"
            )
            expected = {
                "provider_request_count": len(packet.requests),
                "character_cost_total": committed,
                "projected_cost_usd": str(_projected_cost(committed)),
                "rerender_count": 0,
                "status": "render_complete_pending_key_deletion_closeout",
            }
            if (
                request_id is not None
                or payload != expected
                or not all(
                    item["state"] == "completed"
                    for item in state["items"].values()
                )
                or state["status"] != "in_progress"
            ):
                raise NarrationError("render_complete_event_invalid")
            state["status"] = "render_complete_pending_key_deletion_closeout"
        else:
            raise NarrationError("render_event_type_invalid")
        previous = event["event_sha256"]
        state["updated_at"] = event["at"]
        state["event_count"] = expected_seq
        state["event_head_sha256"] = previous
    if events and not state["initialized"]:
        raise NarrationError("render_initial_event_missing")
    return state


def _snapshot(state: Mapping[str, Any], packet: ChapterPacket) -> dict[str, Any]:
    committed = sum(
        int(item["accepted"]["character_cost"])
        for item in state["items"].values()
        if item["state"] == "completed"
    )
    return {
        "schema_version": 2,
        "renderer_contract": RENDERER_CONTRACT,
        "chapter_id": packet.chapter_id,
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "created_at": state["created_at"],
        "updated_at": state["updated_at"],
        "status": state["status"],
        "blocked_reason": state["blocked_reason"],
        "render_event_count": state["event_count"],
        "render_event_head_sha256": state["event_head_sha256"],
        "execution_sessions": state["sessions"],
        "provider_preflights": state["preflights"],
        "caps": state["initial"]["caps"],
        "character_cost_total": committed,
        "projected_cost_usd": str(_projected_cost(committed)),
        "items": state["items"],
    }


def _read_events(path: Path, *, root: Path) -> list[dict[str, Any]]:
    _require_owned_regular_file(path, root, "render_event_journal_invalid")
    if path.stat().st_size > 16 * 1024 * 1024:
        raise NarrationError("render_event_journal_too_large")
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise NarrationError("render_event_journal_unreadable") from exc
    if not raw.endswith("\n"):
        raise NarrationError("render_event_journal_partial")
    events: list[dict[str, Any]] = []
    for line in raw.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise NarrationError("render_event_journal_invalid") from exc
        if not isinstance(value, dict):
            raise NarrationError("render_event_journal_invalid")
        events.append(value)
    if not events:
        raise NarrationError("render_event_journal_empty")
    return events


def _load_state(
    chapter_dir: Path,
    *,
    packet: ChapterPacket,
    sources: SourceBindings,
    root: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if _path_present(chapter_dir):
        _require_owned_directory(chapter_dir, root, "chapter_directory_invalid")
    events_path = chapter_dir / EVENTS_NAME
    ledger_path = chapter_dir / LEDGER_NAME
    if not _path_present(events_path):
        if _path_present(ledger_path):
            raise NarrationError("render_snapshot_without_authoritative_journal")
        return [], _new_state(packet)
    events = _read_events(events_path, root=root)
    state = _replay_events(events, packet=packet, sources=sources, root=root)
    expected_snapshot = _snapshot(state, packet)
    current_snapshot = None
    if _path_present(ledger_path):
        _require_owned_regular_file(ledger_path, root, "render_ledger_invalid")
        try:
            current_snapshot = _load_json(ledger_path, "render_ledger_unreadable")
        except NarrationError:
            current_snapshot = None
    if current_snapshot != expected_snapshot:
        _atomic_replace_json(ledger_path, expected_snapshot)
    return events, state


def _append_event_line(
    path: Path, event: Mapping[str, Any], *, root: Path
) -> None:
    line = _canonical_bytes(event) + b"\n"
    if not _path_present(path):
        _create_only(path, line)
        return
    _require_owned_regular_file(path, root, "render_event_journal_invalid")
    flags = os.O_WRONLY | os.O_APPEND
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_mode & 0o077
        ):
            raise NarrationError("render_event_journal_invalid")
        written = os.write(descriptor, line)
        if written != len(line):
            raise NarrationError("render_event_journal_partial_write")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    _fsync_directory(path.parent)


def _commit_event(
    chapter_dir: Path,
    events: list[dict[str, Any]],
    *,
    packet: ChapterPacket,
    sources: SourceBindings,
    root: Path,
    event_type: str,
    provider_request_id: str | None,
    payload: Mapping[str, Any],
    at: datetime,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    previous = events[-1]["event_sha256"] if events else "0" * 64
    event: dict[str, Any] = {
        "seq": len(events) + 1,
        "event_type": event_type,
        "at": _iso(at),
        "provider_request_id": provider_request_id,
        "payload": dict(payload),
        "previous_event_sha256": previous,
    }
    event["event_sha256"] = _sha256_bytes(
        _canonical_bytes(_event_without_hash(event))
    )
    candidate = [*events, event]
    state = _replay_events(candidate, packet=packet, sources=sources, root=root)
    _append_event_line(chapter_dir / EVENTS_NAME, event, root=root)
    _atomic_replace_json(chapter_dir / LEDGER_NAME, _snapshot(state, packet))
    return candidate, state


def _ensure_initialized(
    chapter_dir: Path,
    events: list[dict[str, Any]],
    state: dict[str, Any],
    *,
    packet: ChapterPacket,
    sources: SourceBindings,
    root: Path,
    now: datetime,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if events:
        return events, state
    if _path_present(chapter_dir):
        _require_owned_directory(chapter_dir, root, "chapter_directory_invalid")
    else:
        chapter_dir.mkdir(mode=0o700)
        _require_owned_directory(chapter_dir, root, "chapter_directory_invalid")
    return _commit_event(
        chapter_dir,
        events,
        packet=packet,
        sources=sources,
        root=root,
        event_type="ledger_initialized",
        provider_request_id=None,
        payload=_initial_event_payload(packet, sources, root),
        at=now,
    )


def _validate_duration(entry: RenderRequest, probe: Mp3Probe) -> float:
    minimum = entry.word_count / MAX_PLAUSIBLE_WPM * 60
    maximum = entry.word_count / MIN_PLAUSIBLE_WPM * 60
    if not minimum <= probe.duration_s <= maximum:
        raise NarrationError("provider_audio_duration_implausible")
    return entry.word_count / (probe.duration_s / 60)


def _metadata_contract(
    packet: ChapterPacket,
    entry: RenderRequest,
    accepted: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": 2,
        "renderer_contract": RENDERER_CONTRACT,
        "chapter_id": packet.chapter_id,
        "lock_id": packet.lock_id,
        "lock_sha256": packet.lock_sha256,
        "provider_request_id": entry.provider_request_id,
        "entry_id": entry.entry_id,
        "request_kind": entry.request_kind,
        "base_variant_id": entry.base_variant_id,
        "override_variant_id": entry.override_variant_id,
        "effective_variant_ids": list(entry.effective_variant_ids),
        "raw_transcript_sha256": entry.raw_transcript_sha256,
        "normalized_transcript_sha256": entry.normalized_transcript_sha256,
        "provider": "elevenlabs",
        "voice_id": VOICE_ID,
        "voice_name": VOICE_NAME,
        "model_id": MODEL_ID,
        "language_code": LANGUAGE_CODE,
        "output_format_id": OUTPUT_FORMAT_ID,
        "voice_settings": dict(VOICE_SETTINGS),
        "request_fingerprint": accepted["request_fingerprint"],
        "character_cost": accepted["character_cost"],
        "projected_cost_usd": accepted["projected_cost_usd"],
        "content_type": accepted["content_type"],
        "response_sha256": accepted["response_sha256"],
        "response_bytes": accepted["response_bytes"],
        "provider_request_id_sha256": accepted[
            "provider_request_id_sha256"
        ],
        "provider_trace_id_sha256": accepted["provider_trace_id_sha256"],
        "accepted_at": accepted["accepted_at"],
        "audio": accepted["audio"],
        "words_per_minute": accepted["words_per_minute"],
        "provider_native_lossy_source": True,
        "lossless_or_wav_claimed": False,
        "accepted_bytes_never_regenerated": True,
    }


def _validate_completed_files(
    chapter_dir: Path,
    *,
    packet: ChapterPacket,
    state: Mapping[str, Any],
    probe_audio: Callable[[bytes], Mp3Probe],
) -> None:
    entries = {entry.provider_request_id: entry for entry in packet.requests}
    for request_id, item in state["items"].items():
        if item["state"] != "completed":
            continue
        entry = entries[request_id]
        accepted = item["accepted"]
        master = chapter_dir / _master_name(entry)
        sidecar = chapter_dir / _metadata_name(entry)
        try:
            _require_owned_regular_file(
                master, chapter_dir.parent, "completed_master_file_invalid"
            )
            _require_owned_regular_file(
                sidecar, chapter_dir.parent, "completed_sidecar_file_invalid"
            )
            content = master.read_bytes()
            probe = probe_audio(content)
            wpm = _validate_duration(entry, probe)
            metadata = _load_json(sidecar, "completed_sidecar_unreadable")
        except OSError as exc:
            raise NarrationError("completed_file_missing") from exc
        expected_audio = {**probe.as_dict(), "channels": 1}
        if any(
            (
                probe.sha256 != accepted["response_sha256"],
                probe.byte_count != accepted["response_bytes"],
                expected_audio != accepted["audio"],
                round(wpm, 3) != accepted["words_per_minute"],
                metadata != _metadata_contract(packet, entry, accepted),
            )
        ):
            raise NarrationError("completed_master_or_sidecar_drift")


def _validate_output_inventory(
    chapter_dir: Path,
    *,
    packet: ChapterPacket,
    state: Mapping[str, Any],
) -> None:
    if not _path_present(chapter_dir):
        return
    _require_owned_directory(
        chapter_dir, chapter_dir.parent, "chapter_directory_invalid"
    )
    allowed = {EVENTS_NAME, LEDGER_NAME}
    entries = {entry.provider_request_id: entry for entry in packet.requests}
    for request_id, item in state["items"].items():
        entry = entries[request_id]
        if item["state"] == "completed":
            allowed.update({_master_name(entry), _metadata_name(entry)})
        elif item["state"] == "accepted_pending_promotion":
            allowed.update(
                {
                    _stage_audio_name(entry),
                    _stage_metadata_name(entry),
                    _master_name(entry),
                    _metadata_name(entry),
                }
            )
        elif item["state"] == "blocked_ambiguous":
            allowed.add(_quarantine_name(entry))
    if state["status"] == "render_complete_pending_key_deletion_closeout":
        allowed.update({CLOSEOUT_NAME, PROVISIONAL_CLOSEOUT_NAME})
    for path in chapter_dir.iterdir():
        if path.name not in allowed:
            raise NarrationError("unexpected_chapter_output_content")
        _require_owned_regular_file(
            path, chapter_dir.parent, "chapter_output_file_invalid"
        )


def _promote_create_only(stage: Path, final: Path, expected_sha256: str) -> None:
    if stage.parent != final.parent:
        raise NarrationError("accepted_promotion_parent_invalid")
    root = stage.parent.parent
    _require_owned_directory(stage.parent, root, "chapter_directory_invalid")
    _require_owned_regular_file(stage, root, "accepted_stage_file_invalid")
    if _path_present(final):
        _require_owned_regular_file(final, root, "accepted_final_file_invalid")
        if _sha256_file(final) != expected_sha256:
            raise NarrationError("accepted_final_file_drift")
    else:
        try:
            os.link(stage, final, follow_symlinks=False)
        except FileExistsError:
            raise NarrationError("create_only_target_exists") from None
        _fsync_directory(final.parent)
    if _sha256_file(final) != expected_sha256:
        raise NarrationError("accepted_final_file_drift")


def _recover_accepted_items(
    chapter_dir: Path,
    events: list[dict[str, Any]],
    state: dict[str, Any],
    *,
    packet: ChapterPacket,
    sources: SourceBindings,
    root: Path,
    probe_audio: Callable[[bytes], Mp3Probe],
    now: Callable[[], datetime],
) -> tuple[list[dict[str, Any]], dict[str, Any], list[str]]:
    recovered: list[str] = []
    entries = {entry.provider_request_id: entry for entry in packet.requests}
    for request_id, item in list(state["items"].items()):
        if item["state"] != "accepted_pending_promotion":
            continue
        entry = entries[request_id]
        accepted = item["accepted"]
        stage_audio = chapter_dir / _stage_audio_name(entry)
        stage_sidecar = chapter_dir / _stage_metadata_name(entry)
        final_audio = chapter_dir / _master_name(entry)
        final_sidecar = chapter_dir / _metadata_name(entry)
        expected_metadata = _metadata_contract(packet, entry, accepted)
        expected_sidecar_bytes = json.dumps(
            expected_metadata, indent=2, sort_keys=True, ensure_ascii=False
        ).encode("utf-8") + b"\n"
        sidecar_sha = _sha256_bytes(expected_sidecar_bytes)
        if not _path_present(stage_audio) and not _path_present(final_audio):
            raise NarrationError("accepted_audio_stage_missing")
        if not _path_present(stage_sidecar) and not _path_present(final_sidecar):
            raise NarrationError("accepted_sidecar_stage_missing")
        if _path_present(stage_audio):
            _require_owned_regular_file(
                stage_audio, root, "accepted_audio_stage_invalid"
            )
            if _sha256_file(stage_audio) != accepted["response_sha256"]:
                raise NarrationError("accepted_audio_stage_drift")
            probe = probe_audio(stage_audio.read_bytes())
            _validate_duration(entry, probe)
        if _path_present(stage_sidecar):
            _require_owned_regular_file(
                stage_sidecar, root, "accepted_sidecar_stage_invalid"
            )
            if stage_sidecar.read_bytes() != expected_sidecar_bytes:
                raise NarrationError("accepted_sidecar_stage_drift")
        _promote_create_only(
            stage_audio if _path_present(stage_audio) else final_audio,
            final_audio,
            accepted["response_sha256"],
        )
        _promote_create_only(
            stage_sidecar if _path_present(stage_sidecar) else final_sidecar,
            final_sidecar,
            sidecar_sha,
        )
        if final_sidecar.read_bytes() != expected_sidecar_bytes:
            raise NarrationError("accepted_sidecar_final_drift")
        if _path_present(stage_audio):
            _require_owned_regular_file(
                stage_audio, root, "accepted_audio_stage_invalid"
            )
            stage_audio.unlink()
        if _path_present(stage_sidecar):
            _require_owned_regular_file(
                stage_sidecar, root, "accepted_sidecar_stage_invalid"
            )
            stage_sidecar.unlink()
        events, state = _commit_event(
            chapter_dir,
            events,
            packet=packet,
            sources=sources,
            root=root,
            event_type="request_completed",
            provider_request_id=request_id,
            payload={
                "accepted_event_sha256": accepted["accepted_event_sha256"],
                "master_file": _master_name(entry),
                "metadata_file": _metadata_name(entry),
            },
            at=now(),
        )
        recovered.append(request_id)
    _validate_completed_files(
        chapter_dir, packet=packet, state=state, probe_audio=probe_audio
    )
    return events, state, recovered


def _complete_if_ready(
    chapter_dir: Path,
    events: list[dict[str, Any]],
    state: dict[str, Any],
    *,
    packet: ChapterPacket,
    sources: SourceBindings,
    root: Path,
    now: Callable[[], datetime],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if state["status"] == "render_complete_pending_key_deletion_closeout":
        return events, state
    if not all(item["state"] == "completed" for item in state["items"].values()):
        return events, state
    committed = sum(
        int(item["accepted"]["character_cost"])
        for item in state["items"].values()
    )
    return _commit_event(
        chapter_dir,
        events,
        packet=packet,
        sources=sources,
        root=root,
        event_type="chapter_render_complete",
        provider_request_id=None,
        payload={
            "provider_request_count": len(packet.requests),
            "character_cost_total": committed,
            "projected_cost_usd": str(_projected_cost(committed)),
            "rerender_count": 0,
            "status": "render_complete_pending_key_deletion_closeout",
        },
        at=now(),
    )


def _audio_inventory(
    packet: ChapterPacket, state: Mapping[str, Any]
) -> tuple[list[dict[str, Any]], str]:
    rows: list[dict[str, Any]] = []
    for entry in packet.requests:
        item = state["items"][entry.provider_request_id]
        if item["state"] != "completed":
            raise NarrationError("audio_inventory_incomplete")
        accepted = item["accepted"]
        rows.append(
            {
                "provider_request_id": entry.provider_request_id,
                "raw_transcript_sha256": entry.raw_transcript_sha256,
                "master_file": _master_name(entry),
                "metadata_file": _metadata_name(entry),
                "audio_sha256": accepted["response_sha256"],
                "audio_bytes": accepted["response_bytes"],
                "duration_s": accepted["audio"]["duration_s"],
                "words_per_minute": accepted["words_per_minute"],
                "character_cost": accepted["character_cost"],
            }
        )
    return rows, _sha256_bytes(_canonical_bytes(rows))


_KEY_UI_CLOSEOUT_FIELDS = (
    "provider_key_created_tooltip",
    "provider_key_expires_tooltip",
    "provider_key_browser_date_string",
    "provider_key_created_tooltip_sha256",
    "provider_key_expires_tooltip_sha256",
    "provider_key_browser_date_string_sha256",
    "provider_key_timestamp_timezone",
    "provider_key_timestamp_precision",
    "provider_key_timestamp_precision_seconds",
    "provider_key_timestamp_rounding_mode",
    "provider_key_created_utc_offset",
    "provider_key_expires_utc_offset",
    "provider_key_created_tooltip_source",
    "provider_key_expiry_tooltip_source",
    "provider_key_timestamp_timezone_source",
    "provider_key_timestamp_offsets_source",
    "provider_key_browser_date_source",
    "key_created_at_interval_lower",
    "key_created_at_interval_upper",
    "key_expires_at_interval_lower",
    "key_expires_at_interval_upper",
    "key_expiry_conservative_deadline",
    "key_displayed_center_duration_seconds",
    "key_duration_interval_lower_seconds",
    "key_duration_interval_upper_seconds",
    "provider_key_created_tooltip_directly_observed",
    "provider_key_expires_tooltip_directly_observed",
    "requested_ttl_label",
    "requested_ttl_seconds",
)


def _key_ui_time_evidence_from_session(
    session: Mapping[str, Any],
) -> dict[str, Any]:
    try:
        return {name: session[name] for name in _KEY_UI_CLOSEOUT_FIELDS}
    except KeyError as exc:
        raise NarrationError("session_key_ui_time_evidence_missing") from exc


def _validate_closeout(
    chapter_dir: Path,
    *,
    packet: ChapterPacket,
    state: Mapping[str, Any],
    starting_provider_credits: int,
    starting_billable_requests: int,
    starting_total_usage_usd: Decimal,
    prior_closeout_sha256: str | None,
    raw_value: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if raw_value is None:
        closeout_path = chapter_dir / CLOSEOUT_NAME
        _require_owned_regular_file(
            closeout_path, chapter_dir.parent, "chapter_closeout_file_invalid"
        )
        raw = _load_json(closeout_path, "chapter_closeout_missing")
    else:
        raw = dict(raw_value)
    _reject_private_values(raw)
    expected_fields = {
        "schema_version",
        "closeout_id",
        "source",
        "source_observation_sha256",
        "observed_at",
        "renderer_contract",
        "chapter_id",
        "render_event_count",
        "render_event_head_sha256",
        "render_ledger_sha256",
        "audio_inventory_sha256",
        "prior_closeout_sha256",
        "key_id_sha256",
        "key_material_sha256",
        "key_deleted",
        "key_deletion_verified",
        "key_deleted_at",
        "key_deletion_source",
        "key_ui_time_evidence",
        "key_expiry_conservative_deadline",
        "key_deleted_before_conservative_expiry",
        "no_other_active_render_keys",
        "starting_provider_credits",
        "ending_provider_credits",
        "ledger_character_cost_total",
        "provider_reported_usage_credits",
        "starting_billable_request_count",
        "ending_billable_request_count",
        "provider_reported_request_count",
        "starting_total_usage_usd",
        "ending_total_usage_usd",
        "provider_reported_chapter_usage_usd",
        "ledger_usage_usd_unrounded",
        "dollar_reconciliation_tolerance_usd",
        "observation_sources",
        "prebatch_baseline",
        "account_credit_reconciliation_passed",
        "usage_credit_reconciliation_passed",
        "request_count_reconciliation_passed",
        "dollar_reconciliation_passed",
        "other_account_usage_observed",
        "rerender_count",
        "paid_overage_used",
    }
    if set(raw) != expected_fields:
        raise NarrationError("chapter_closeout_schema_invalid")
    if (
        raw.get("schema_version") != 2
        or SAFE_ID_RE.fullmatch(str(raw.get("closeout_id") or "")) is None
        or raw.get("source")
        != "authenticated_provider_usage_and_key_management_ui"
        or raw.get("renderer_contract") != RENDERER_CONTRACT
        or raw.get("chapter_id") != packet.chapter_id
    ):
        raise NarrationError("chapter_closeout_identity_invalid")
    source_observation_sha256 = _validate_hash_field(
        raw.get("source_observation_sha256"),
        "chapter_closeout_source_observation_hash_invalid",
    )
    if raw.get("closeout_id") != f"smokies_closeout_{source_observation_sha256[:32]}":
        raise NarrationError("chapter_closeout_source_observation_binding_invalid")
    observed = _parse_utc(raw.get("observed_at"), "chapter_closeout_time_invalid")
    if observed < _parse_utc(state["updated_at"], "render_event_timestamp_invalid"):
        raise NarrationError("chapter_closeout_predates_render")
    sessions = state["sessions"]
    if not sessions:
        raise NarrationError("chapter_closeout_session_missing")
    deleted_at = _parse_utc(
        raw.get("key_deleted_at"), "chapter_closeout_key_deleted_at_invalid"
    )
    conservative_deadline = _parse_utc(
        sessions[-1]["key_expiry_conservative_deadline"],
        "chapter_closeout_key_expiry_deadline_invalid",
    )
    if any(
        (
            deleted_at < _parse_utc(
                state["updated_at"], "render_event_timestamp_invalid"
            ),
            deleted_at > observed,
            observed
            > conservative_deadline
            - timedelta(seconds=KEY_DISPATCH_SAFETY_BUFFER_SECONDS),
        )
    ):
        raise NarrationError("chapter_closeout_key_deadline_invalid")
    committed = sum(
        int(item["accepted"]["character_cost"])
        for item in state["items"].values()
    )
    _, inventory_sha = _audio_inventory(packet, state)
    ending_credits = starting_provider_credits - committed
    ending_requests = starting_billable_requests + len(packet.requests)
    exact_ledger_usage_usd = _unrounded_usage_cost(committed)
    if raw["ledger_usage_usd_unrounded"] != f"{exact_ledger_usage_usd:.4f}":
        raise NarrationError("chapter_closeout_dollar_reconciliation_invalid")
    dollar_available = raw["ending_total_usage_usd"] is not None
    if not dollar_available:
        raise NarrationError("chapter_closeout_dollar_observation_required")
    if dollar_available:
        try:
            observed_start_usd = Decimal(str(raw["starting_total_usage_usd"]))
            observed_end_usd = Decimal(str(raw["ending_total_usage_usd"]))
            observed_delta_usd = Decimal(
                str(raw["provider_reported_chapter_usage_usd"])
            )
            tolerance_usd = Decimal(
                str(raw["dollar_reconciliation_tolerance_usd"])
            )
        except InvalidOperation as exc:
            raise NarrationError("chapter_closeout_dollar_invalid") from exc
        if any(
            (
                raw["starting_total_usage_usd"]
                != f"{starting_total_usage_usd:.2f}",
                not re.fullmatch(
                    r"\d+\.\d{2}", str(raw["ending_total_usage_usd"])
                ),
                not re.fullmatch(
                    r"-?\d+\.\d{2}",
                    str(raw["provider_reported_chapter_usage_usd"]),
                ),
                raw["dollar_reconciliation_tolerance_usd"] != "0.01",
                observed_start_usd != starting_total_usage_usd,
                observed_delta_usd != observed_end_usd - observed_start_usd,
                abs(observed_delta_usd - exact_ledger_usage_usd) > tolerance_usd,
            )
        ):
            raise NarrationError("chapter_closeout_dollar_reconciliation_invalid")
        dollar_sources = {
            "provider_credits": (
                "authenticated_subscription_ui_or_api_exact_integer"
            ),
            "billable_request_count": (
                "authenticated_usage_analytics_ui_exact_integer"
            ),
            "total_usage_usd": (
                "authenticated_usage_analytics_ui_two_decimal_rounded"
            ),
            "chapter_usage_usd": (
                "derived_difference_of_observed_rounded_totals"
            ),
            "ledger_usage_usd": "ledger_character_cost_at_locked_rate",
        }
        dollar_reconciliation: bool | None = True
    else:
        if any(
            raw[name] is not None
            for name in (
                "starting_total_usage_usd",
                "provider_reported_chapter_usage_usd",
                "dollar_reconciliation_tolerance_usd",
            )
        ):
            raise NarrationError("chapter_closeout_dollar_unavailable_invalid")
        dollar_sources = {
            "provider_credits": (
                "authenticated_subscription_ui_or_api_exact_integer"
            ),
            "billable_request_count": (
                "authenticated_usage_analytics_ui_exact_integer"
            ),
            "total_usage_usd": "unavailable_on_authenticated_surface",
            "chapter_usage_usd": "not_computed_without_observed_totals",
            "ledger_usage_usd": "ledger_character_cost_at_locked_rate",
        }
        dollar_reconciliation = None
    expected_values = {
        "render_event_count": state["event_count"],
        "render_event_head_sha256": state["event_head_sha256"],
        "render_ledger_sha256": _sha256_file(chapter_dir / LEDGER_NAME),
        "audio_inventory_sha256": inventory_sha,
        "prior_closeout_sha256": prior_closeout_sha256,
        "key_id_sha256": sessions[-1]["key_id_sha256"],
        "key_material_sha256": sessions[-1]["key_material_sha256"],
        "key_deleted": True,
        "key_deletion_verified": True,
        "key_deleted_at": raw["key_deleted_at"],
        "key_deletion_source": (
            "official_signed_in_api_keys_ui_delete_and_absence_verification"
        ),
        "key_ui_time_evidence": _key_ui_time_evidence_from_session(
            sessions[-1]
        ),
        "key_expiry_conservative_deadline": _iso(conservative_deadline),
        "key_deleted_before_conservative_expiry": True,
        "no_other_active_render_keys": True,
        "starting_provider_credits": starting_provider_credits,
        "ending_provider_credits": ending_credits,
        "ledger_character_cost_total": committed,
        "provider_reported_usage_credits": committed,
        "starting_billable_request_count": starting_billable_requests,
        "ending_billable_request_count": ending_requests,
        "provider_reported_request_count": len(packet.requests),
        "observation_sources": dollar_sources,
        "prebatch_baseline": {
            "used_provider_credits": 14_510,
            "remaining_provider_credits": 171_490,
            "total_provider_credits": 186_000,
            "billable_request_count": PREBATCH_BILLABLE_REQUEST_COUNT,
            "total_usage_usd": str(PREBATCH_TOTAL_USAGE_USD),
        },
        "account_credit_reconciliation_passed": True,
        "usage_credit_reconciliation_passed": True,
        "request_count_reconciliation_passed": True,
        "dollar_reconciliation_passed": dollar_reconciliation,
        "other_account_usage_observed": False,
        "rerender_count": 0,
        "paid_overage_used": False,
    }
    if any(raw.get(key) != value for key, value in expected_values.items()):
        raise NarrationError("chapter_closeout_reconciliation_invalid")
    return raw


def _validate_prior_sequence(
    root: Path,
    *,
    chapter_id: str,
    sources: SourceBindings,
    probe_audio: Callable[[bytes], Mp3Probe],
) -> tuple[int, int, Decimal, str | None]:
    starting_credits = 171_490
    starting_requests = PREBATCH_BILLABLE_REQUEST_COUNT
    starting_usd = PREBATCH_TOTAL_USAGE_USD
    prior_closeout_sha: str | None = None
    for prior in CHAPTER_ORDER[: CHAPTER_ORDER.index(chapter_id)]:
        packet = load_chapter_packet(prior)
        chapter_dir = root / prior
        _events, state = _load_state(
            chapter_dir, packet=packet, sources=sources, root=root
        )
        if state["status"] != "render_complete_pending_key_deletion_closeout":
            raise NarrationError("prior_chapter_render_not_complete")
        _validate_output_inventory(chapter_dir, packet=packet, state=state)
        _validate_completed_files(
            chapter_dir, packet=packet, state=state, probe_audio=probe_audio
        )
        closeout = _validate_closeout(
            chapter_dir,
            packet=packet,
            state=state,
            starting_provider_credits=starting_credits,
            starting_billable_requests=starting_requests,
            starting_total_usage_usd=starting_usd,
            prior_closeout_sha256=prior_closeout_sha,
        )
        prior_closeout_sha = _sha256_file(chapter_dir / CLOSEOUT_NAME)
        starting_credits = int(closeout["ending_provider_credits"])
        starting_requests = int(closeout["ending_billable_request_count"])
        starting_usd = Decimal(closeout["ending_total_usage_usd"])
    for later in CHAPTER_ORDER[CHAPTER_ORDER.index(chapter_id) + 1 :]:
        if _path_present(root / later):
            raise NarrationError("later_chapter_started_out_of_order")
    return starting_credits, starting_requests, starting_usd, prior_closeout_sha


def _read_key_from_stdin() -> bytearray:
    if sys.stdin.isatty():
        raise NarrationError("ephemeral_key_requires_piped_stdin")
    raw = sys.stdin.buffer.read(4097)
    if not raw or len(raw) > 4096:
        raise NarrationError("ephemeral_key_stdin_invalid")
    value = raw.strip()
    if any(byte > 0x7F for byte in value):
        raise NarrationError("ephemeral_key_stdin_invalid")
    if not 32 <= len(value) <= 512 or any(chr(byte).isspace() for byte in value):
        raise NarrationError("ephemeral_key_stdin_invalid")
    return bytearray(value)


def _character_cost(headers: Mapping[str, str]) -> int | None:
    raw = _header(headers, "character-cost")
    if raw is None or raw == "":
        return None
    try:
        cost = int(raw)
    except ValueError:
        return None
    return cost if cost >= 0 else None


def _header_sha(headers: Mapping[str, str], name: str) -> str | None:
    value = _header(headers, name)
    return None if not value else _sha256_bytes(value.encode("utf-8"))


def _response_payload_for_packet(
    response: ProviderResponse,
    *,
    packet: ChapterPacket,
    entry: RenderRequest,
    attempt: int,
    character_cost: int | None,
) -> dict[str, Any]:
    return {
        "attempt": attempt,
        "http_status": int(response.status_code),
        "response_bytes": len(response.body),
        "response_sha256": _sha256_bytes(response.body),
        "request_fingerprint": _request_fingerprint(packet, entry),
        "character_cost": character_cost,
        "provider_request_id_sha256": _header_sha(
            response.headers, "request-id"
        ),
        "provider_trace_id_sha256": _header_sha(
            response.headers, "x-trace-id"
        ),
    }


def _dry_run_summary(packet: ChapterPacket | None = None) -> dict[str, Any]:
    approval_sha, continuation_sha, preflight_sha = _validate_owner_sources()
    try:
        audit = load_audit_evidence()
    except NarrationError as exc:
        audit = None
        audit_status = (
            "missing"
            if str(exc) == "renderer_audit_unreadable"
            else "invalid_or_stale"
        )
    else:
        audit_status = "valid"
    blockers = [
        "fresh_redacted_authenticated_observation_required",
        "exact_restricted_chapter_key_required",
        "key_material_hash_must_match_bound_observation",
        "dedicated_external_output_root_required",
        "prior_chapter_key_deletion_and_usage_closeout_required",
    ]
    if audit is None:
        blockers.insert(
            0, "independent_renderer_and_operator_audit_record_required"
        )
    packets = (
        [packet]
        if packet is not None
        else [load_chapter_packet(chapter_id) for chapter_id in CHAPTER_ORDER]
    )
    return {
        "apply": False,
        "status": (
            "dry_run_ready_external_observation_and_key_required"
            if audit is not None
            else "dry_run_blocked_renderer_audit_missing_or_invalid"
        ),
        "renderer_contract": RENDERER_CONTRACT,
        "provider": "elevenlabs",
        "voice_id": VOICE_ID,
        "model_id": MODEL_ID,
        "language_code": LANGUAGE_CODE,
        "output_format_id": OUTPUT_FORMAT_ID,
        "output_root_basename": OUTPUT_ROOT_BASENAME,
        "event_journal_filename": EVENTS_NAME,
        "ledger_filename": LEDGER_NAME,
        "closeout_filename": CLOSEOUT_NAME,
        "independent_audit": {
            "status": audit_status,
            "valid": audit is not None,
            "renderer_audit_sha256": (
                None if audit is None else audit.renderer_audit_sha256
            ),
        },
        "chapter_count": len(packets),
        "provider_request_count": sum(len(row.requests) for row in packets),
        "payload_character_count": sum(
            row.payload_character_count for row in packets
        ),
        "normalized_character_count": sum(
            row.normalized_character_count for row in packets
        ),
        "reserved_provider_credit_ceiling": sum(
            row.reserved_provider_credit_ceiling for row in packets
        ),
        "renderer_character_caps": sum(
            row.renderer_character_cap for row in packets
        ),
        "one_day_key_credit_quotas": sum(
            row.key_credit_quota for row in packets
        ),
        "provider_usage_baseline": {
            "used_provider_credits": 14_510,
            "remaining_provider_credits": 171_490,
            "total_provider_credits": 186_000,
            "billable_request_count": PREBATCH_BILLABLE_REQUEST_COUNT,
            "total_usage_usd": str(PREBATCH_TOTAL_USAGE_USD),
        },
        "source_bindings": {
            "checkpoint2_owner_approval_sha256": approval_sha,
            "postpurchase_continuation_approval_sha256": continuation_sha,
            "green_preflight_sha256": preflight_sha,
            "dependency_sha256": _dependency_hashes(),
            "operator_sha256": _sha256_file(OPERATOR_PATH),
            "operator_test_sha256": _sha256_file(OPERATOR_TEST_PATH),
        },
        "chapters": [
            {
                "chapter_id": row.chapter_id,
                "request_count": len(row.requests),
                "lock_sha256": row.lock_sha256,
                "reserved_provider_credit_ceiling": (
                    row.reserved_provider_credit_ceiling
                ),
                "renderer_character_cap": row.renderer_character_cap,
                "one_day_key_credit_quota": row.key_credit_quota,
                "dollar_cap_usd": row.dollar_cap_usd,
            }
            for row in packets
        ],
        "key_source_on_apply": "stdin_one_line",
        "accepted_bytes_never_regenerated": True,
        "cross_chapter_closeout_required": True,
        "key_read": False,
        "network_used": False,
        "files_written": 0,
        "live_apply_authorized_by_owner": True,
        "live_apply_blockers": blockers,
    }


def _render_chapter(
    *,
    packet: ChapterPacket,
    root: Path,
    execution_evidence_path: Path,
    verified_output_format: str | None,
    key_reader: Callable[[], bytearray],
    transport_factory: Callable[[], Any],
    probe_audio: Callable[[bytes], Mp3Probe],
    sleep: Callable[[float], None],
    now: Callable[[], datetime],
    timeout: float,
) -> dict[str, Any]:
    if verified_output_format != OUTPUT_FORMAT_ID:
        raise NarrationError("output_format_confirmation_required")
    sources = load_audit_evidence()
    _prepare_root(root)
    (
        starting_provider_credits,
        starting_requests,
        _starting_usd,
        _prior_closeout_sha,
    ) = _validate_prior_sequence(
        root,
        chapter_id=packet.chapter_id,
        sources=sources,
        probe_audio=probe_audio,
    )
    chapter_dir = root / packet.chapter_id
    events, state = _load_state(
        chapter_dir, packet=packet, sources=sources, root=root
    )
    _validate_output_inventory(chapter_dir, packet=packet, state=state)
    if state["status"] == "blocked_manual_reconciliation_required" or any(
        item["state"] == "dispatched" for item in state["items"].values()
    ):
        raise NarrationError("manual_provider_reconciliation_required")
    recovered: list[str] = []
    if events:
        if any(
            item["state"] == "accepted_pending_promotion"
            for item in state["items"].values()
        ):
            if not state["sessions"]:
                raise NarrationError("local_recovery_session_missing")
            _require_conservative_key_deadline(
                state["sessions"][-1]["key_expiry_conservative_deadline"],
                current=now(),
                operation_timeout_seconds=0,
                code="local_recovery_after_conservative_key_expiry",
            )
        events, state, recovered = _recover_accepted_items(
            chapter_dir,
            events,
            state,
            packet=packet,
            sources=sources,
            root=root,
            probe_audio=probe_audio,
            now=now,
        )
        events, state = _complete_if_ready(
            chapter_dir,
            events,
            state,
            packet=packet,
            sources=sources,
            root=root,
            now=now,
        )
    _validate_output_inventory(chapter_dir, packet=packet, state=state)
    if recovered:
        return {
            "apply": True,
            "status": "local_accepted_byte_recovery_complete_fresh_evidence_required",
            "chapter_id": packet.chapter_id,
            "recovered_without_provider_request": recovered,
            "network_used": False,
            "key_read": False,
            "render_event_head_sha256": state["event_head_sha256"],
            "render_ledger_sha256": _sha256_file(chapter_dir / LEDGER_NAME),
        }
    if state["status"] == "render_complete_pending_key_deletion_closeout":
        _validate_completed_files(
            chapter_dir, packet=packet, state=state, probe_audio=probe_audio
        )
        return {
            "apply": True,
            "status": "render_complete_pending_key_deletion_closeout",
            "chapter_id": packet.chapter_id,
            "rendered": [],
            "network_used": False,
            "key_read": False,
            "render_event_head_sha256": state["event_head_sha256"],
            "render_ledger_sha256": _sha256_file(chapter_dir / LEDGER_NAME),
        }
    prior_session = state["sessions"][-1] if state["sessions"] else None
    current_time = now()
    already_committed = sum(
        int(item["accepted"]["character_cost"])
        for item in state["items"].values()
        if item["state"] == "completed"
    )
    committed_since_prior_session = (
        0
        if prior_session is None
        else already_committed
        - int(prior_session["ledger_character_cost_total_at_start"])
    )
    completed_request_count = sum(
        item["state"] == "completed" for item in state["items"].values()
    )
    completed_requests_since_prior_session = (
        0
        if prior_session is None
        else completed_request_count
        - int(prior_session["ledger_request_count_at_start"])
    )
    execution = load_execution_evidence(
        execution_evidence_path,
        packet=packet,
        root=root,
        sources=sources,
        ledger_head=state["event_head_sha256"],
        prior_session=prior_session,
        already_committed=already_committed,
        committed_since_prior_session=committed_since_prior_session,
        completed_request_count=completed_request_count,
        completed_requests_since_prior_session=(
            completed_requests_since_prior_session
        ),
        chapter_starting_total_usage_usd=_starting_usd,
        chapter_starting_billable_requests=starting_requests,
        ledger_updated_at=state["updated_at"],
        now=current_time,
    )
    _require_execution_key_deadline(
        execution,
        current=current_time,
        operation_timeout_seconds=timeout * 3,
    )
    if execution.available_credits != starting_provider_credits - already_committed:
        raise NarrationError("execution_credit_reconciliation_mismatch")
    if not events:
        events, state = _ensure_initialized(
            chapter_dir,
            events,
            state,
            packet=packet,
            sources=sources,
            root=root,
            now=now(),
        )
    key_material = key_reader()
    api_key = ""
    try:
        if _sha256_bytes(bytes(key_material)) != execution.key_material_sha256:
            raise NarrationError("stdin_key_material_evidence_mismatch")
        try:
            api_key = bytes(key_material).decode("ascii")
        except UnicodeDecodeError as exc:
            raise NarrationError("ephemeral_key_stdin_invalid") from exc
        events, state = _commit_event(
            chapter_dir,
            events,
            packet=packet,
            sources=sources,
            root=root,
            event_type="execution_session_started",
            provider_request_id=None,
            payload=execution.session_payload(),
            at=now(),
        )
        transport = transport_factory()
        _require_execution_key_deadline(
            execution,
            current=now(),
            operation_timeout_seconds=timeout * 3,
        )
        preflight = provider_preflight(
            transport,
            api_key=api_key,
            execution=execution,
            timeout=timeout,
        )
        events, state = _commit_event(
            chapter_dir,
            events,
            packet=packet,
            sources=sources,
            root=root,
            event_type="provider_preflight_passed",
            provider_request_id=None,
            payload=preflight,
            at=now(),
        )
        rendered: list[str] = []
        retried_429 = 0
        for entry in packet.requests:
            item = state["items"][entry.provider_request_id]
            if item["state"] == "completed":
                continue
            if item["state"] == "pending":
                events, state = _commit_event(
                    chapter_dir,
                    events,
                    packet=packet,
                    sources=sources,
                    root=root,
                    event_type="request_reserved",
                    provider_request_id=entry.provider_request_id,
                    payload={
                        "request_fingerprint": _request_fingerprint(packet, entry)
                    },
                    at=now(),
                )
                item = state["items"][entry.provider_request_id]
            while item["state"] in {"reserved", "retryable_429"}:
                if item["attempts"] >= MAX_PROVIDER_ATTEMPTS:
                    raise NarrationError("provider_retry_exhausted")
                _require_execution_key_deadline(
                    execution,
                    current=now(),
                    operation_timeout_seconds=timeout,
                )
                committed = sum(
                    int(row["accepted"]["character_cost"])
                    for row in state["items"].values()
                    if row["state"] == "completed"
                )
                if committed + entry.reserved_provider_credit_ceiling > packet.renderer_character_cap:
                    raise NarrationError("chapter_character_cap_exceeded")
                attempt = item["attempts"] + 1
                events, state = _commit_event(
                    chapter_dir,
                    events,
                    packet=packet,
                    sources=sources,
                    root=root,
                    event_type="request_dispatched",
                    provider_request_id=entry.provider_request_id,
                    payload={
                        "attempt": attempt,
                        "evidence_sha256": execution.file_sha256,
                        "request_fingerprint": _request_fingerprint(packet, entry),
                    },
                    at=now(),
                )
                payload = _canonical_bytes(_request_payload(entry))
                query = urllib.parse.urlencode({"output_format": OUTPUT_FORMAT_ID})
                url = f"{ENDPOINT_ROOT}/{VOICE_ID}?{query}"
                try:
                    response = transport.post(
                        url,
                        headers={
                            "Accept": "audio/mpeg",
                            "Content-Type": "application/json",
                            "xi-api-key": api_key,
                            "User-Agent": "Trailhead-Originals-Smokies-Remaining/2",
                        },
                        body=payload,
                        timeout=timeout,
                    )
                except Exception as exc:
                    events, state = _commit_event(
                        chapter_dir,
                        events,
                        packet=packet,
                        sources=sources,
                        root=root,
                        event_type="ambiguous_transport",
                        provider_request_id=entry.provider_request_id,
                        payload={
                            "attempt": attempt,
                            "request_fingerprint": _request_fingerprint(packet, entry),
                            "exception_type": type(exc).__name__,
                        },
                        at=now(),
                    )
                    raise NarrationError("provider_transport_ambiguous") from None
                status = int(response.status_code)
                cost = _character_cost(response.headers)
                response_payload = _response_payload_for_packet(
                    response,
                    packet=packet,
                    entry=entry,
                    attempt=attempt,
                    character_cost=cost,
                )
                if status == 429:
                    retry_after = _header(response.headers, "retry-after")
                    try:
                        delay = float(retry_after) if retry_after is not None else -1.0
                    except ValueError:
                        delay = -1.0
                    if (
                        _header(response.headers, "character-cost") != "0"
                        or cost != 0
                        or not 0 <= delay <= MAX_RETRY_AFTER_SECONDS
                    ):
                        events, state = _commit_event(
                            chapter_dir,
                            events,
                            packet=packet,
                            sources=sources,
                            root=root,
                            event_type="ambiguous_429_billing",
                            provider_request_id=entry.provider_request_id,
                            payload=response_payload,
                            at=now(),
                        )
                        raise NarrationError("provider_429_billing_ambiguous")
                    response_payload["retry_after_s"] = round(delay, 3)
                    events, state = _commit_event(
                        chapter_dir,
                        events,
                        packet=packet,
                        sources=sources,
                        root=root,
                        event_type="retryable_uncharged_429",
                        provider_request_id=entry.provider_request_id,
                        payload=response_payload,
                        at=now(),
                    )
                    retried_429 += 1
                    if attempt >= MAX_PROVIDER_ATTEMPTS:
                        raise NarrationError("provider_retry_exhausted")
                    sleep(delay)
                    item = state["items"][entry.provider_request_id]
                    continue
                if 500 <= status <= 599:
                    events, state = _commit_event(
                        chapter_dir,
                        events,
                        packet=packet,
                        sources=sources,
                        root=root,
                        event_type="ambiguous_provider_5xx",
                        provider_request_id=entry.provider_request_id,
                        payload=response_payload,
                        at=now(),
                    )
                    raise NarrationError("provider_server_response_ambiguous")
                if not 200 <= status <= 299:
                    events, state = _commit_event(
                        chapter_dir,
                        events,
                        packet=packet,
                        sources=sources,
                        root=root,
                        event_type="failed_definitive",
                        provider_request_id=entry.provider_request_id,
                        payload=response_payload,
                        at=now(),
                    )
                    raise NarrationError("provider_request_failed_definitive")
                content_type = (
                    _header(response.headers, "content-type") or ""
                ).split(";", 1)[0].strip().casefold()
                probe: Mp3Probe | None = None
                wpm = 0.0
                invalid = cost is None or cost <= 0 or content_type != "audio/mpeg"
                if not invalid:
                    try:
                        probe = probe_audio(response.body)
                        wpm = _validate_duration(entry, probe)
                    except NarrationError:
                        invalid = True
                committed = sum(
                    int(row["accepted"]["character_cost"])
                    for row in state["items"].values()
                    if row["state"] == "completed"
                )
                if not invalid and any(
                    (
                        cost > entry.reserved_provider_credit_ceiling,
                        committed + cost > packet.renderer_character_cap,
                        _projected_cost(committed + cost)
                        > Decimal(packet.dollar_cap_usd),
                    )
                ):
                    invalid = True
                if invalid or probe is None:
                    _create_only(chapter_dir / _quarantine_name(entry), response.body)
                    events, state = _commit_event(
                        chapter_dir,
                        events,
                        packet=packet,
                        sources=sources,
                        root=root,
                        event_type="ambiguous_audio_or_cost",
                        provider_request_id=entry.provider_request_id,
                        payload=response_payload,
                        at=now(),
                    )
                    raise NarrationError("provider_audio_or_cost_ambiguous")
                accepted = {
                    "attempt": attempt,
                    "request_fingerprint": _request_fingerprint(packet, entry),
                    "character_cost": cost,
                    "projected_cost_usd": str(_projected_cost(cost)),
                    "content_type": "audio/mpeg",
                    "response_sha256": probe.sha256,
                    "response_bytes": probe.byte_count,
                    "provider_request_id_sha256": response_payload[
                        "provider_request_id_sha256"
                    ],
                    "provider_trace_id_sha256": response_payload[
                        "provider_trace_id_sha256"
                    ],
                    "audio": {**probe.as_dict(), "channels": 1},
                    "words_per_minute": round(wpm, 3),
                    "accepted_at": _iso(now()),
                    "stage_audio_file": _stage_audio_name(entry),
                    "stage_metadata_file": _stage_metadata_name(entry),
                }
                stage_audio = chapter_dir / _stage_audio_name(entry)
                stage_metadata = chapter_dir / _stage_metadata_name(entry)
                _create_only(stage_audio, response.body)
                _create_only(
                    stage_metadata,
                    json.dumps(
                        _metadata_contract(packet, entry, accepted),
                        indent=2,
                        sort_keys=True,
                        ensure_ascii=False,
                    ).encode("utf-8")
                    + b"\n",
                )
                events, state = _commit_event(
                    chapter_dir,
                    events,
                    packet=packet,
                    sources=sources,
                    root=root,
                    event_type="audio_accepted",
                    provider_request_id=entry.provider_request_id,
                    payload=accepted,
                    at=now(),
                )
                events, state, promoted = _recover_accepted_items(
                    chapter_dir,
                    events,
                    state,
                    packet=packet,
                    sources=sources,
                    root=root,
                    probe_audio=probe_audio,
                    now=now,
                )
                if promoted != [entry.provider_request_id]:
                    raise NarrationError("accepted_promotion_scope_invalid")
                rendered.append(entry.provider_request_id)
                item = state["items"][entry.provider_request_id]
            if item["state"] != "completed":
                raise NarrationError("render_request_not_completed")
        events, state = _complete_if_ready(
            chapter_dir,
            events,
            state,
            packet=packet,
            sources=sources,
            root=root,
            now=now,
        )
        _validate_completed_files(
            chapter_dir, packet=packet, state=state, probe_audio=probe_audio
        )
        _validate_output_inventory(chapter_dir, packet=packet, state=state)
        committed = sum(
            int(item["accepted"]["character_cost"])
            for item in state["items"].values()
        )
        return {
            "apply": True,
            "status": "render_complete_pending_key_deletion_closeout",
            "chapter_id": packet.chapter_id,
            "rendered": rendered,
            "safe_uncharged_429_retries": retried_429,
            "provider_request_count": len(packet.requests),
            "character_cost_total": committed,
            "projected_cost_usd": str(_projected_cost(committed)),
            "network_used": True,
            "provider_preflight_network_used": True,
            "tts_network_used": bool(rendered),
            "render_event_count": state["event_count"],
            "render_event_head_sha256": state["event_head_sha256"],
            "render_ledger_sha256": _sha256_file(chapter_dir / LEDGER_NAME),
            "next_required_action": (
                "delete_and_verify_chapter_key_then_create_exact_chapter_closeout"
            ),
        }
    finally:
        for index in range(len(key_material)):
            key_material[index] = 0
        api_key = ""


def run_renderer(
    *,
    chapter_id: str | None = None,
    output_root: Path | None = None,
    apply: bool = False,
    verified_output_format: str | None = None,
    execution_evidence_path: Path | None = None,
    key_reader: Callable[[], bytearray] = _read_key_from_stdin,
    transport_factory: Callable[[], Any] = UrllibProviderTransport,
    probe_audio: Callable[[bytes], Mp3Probe] = _strict_probe_mono_mp3,
    sleep: Callable[[float], None] = time.sleep,
    now: Callable[[], datetime] = _utc_now,
    timeout: float = 120.0,
    _operator_capability: object | None = None,
) -> dict[str, Any]:
    if not apply:
        packet = None if chapter_id is None else load_chapter_packet(chapter_id)
        return _dry_run_summary(packet)
    if _operator_capability is not _OPERATOR_APPLY_CAPABILITY:
        raise NarrationError("audited_operator_required_for_live_apply")
    if chapter_id is None:
        raise NarrationError("apply_requires_exact_chapter")
    if output_root is None:
        raise NarrationError("apply_requires_external_output_root")
    if execution_evidence_path is None:
        raise NarrationError("apply_requires_fresh_execution_evidence")
    packet = load_chapter_packet(chapter_id)
    root = _validate_external_root(output_root)
    with _exclusive_sentinel(root):
        return _render_chapter(
            packet=packet,
            root=root,
            execution_evidence_path=execution_evidence_path,
            verified_output_format=verified_output_format,
            key_reader=key_reader,
            transport_factory=transport_factory,
            probe_audio=probe_audio,
            sleep=sleep,
            now=now,
            timeout=timeout,
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--chapter", choices=CHAPTER_ORDER)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--verified-output-format")
    parser.add_argument("--execution-evidence", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run_renderer(
            chapter_id=args.chapter,
            output_root=args.output_root,
            apply=args.apply,
            verified_output_format=args.verified_output_format,
            execution_evidence_path=args.execution_evidence,
        )
    except NarrationError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
