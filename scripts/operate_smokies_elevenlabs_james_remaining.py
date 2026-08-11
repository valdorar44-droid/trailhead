#!/usr/bin/env python3
"""Create bound execution/closeout evidence and invoke the remaining renderer.

Dry-run is the default. Render apply consumes a strict redacted observation,
reads the one-time key once from stdin, hashes it in memory, writes only the
redacted evidence outside Git, invokes the audited renderer, and zeroes the
buffer. Closeout apply consumes only directly observed ending facts and never
reads a key or calls the provider.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import hmac
import json
import os
import re
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Mapping, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from scripts import render_smokies_elevenlabs_james_remaining as renderer


OPERATOR_CONTRACT = "smokies_elevenlabs_james_remaining_operator_v1"
RENDER_ACTION = "render"
CLOSEOUT_ACTION = "closeout"
OBSERVATION_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_]{19,127}$")
USD_RE = re.compile(r"^\d+\.\d{2}$")
UI_TOOLTIP_RE = re.compile(
    r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) "
    r"([1-9]|[12][0-9]|3[01]), ([0-9]{4}), "
    r"([1-9]|1[0-2]):([0-5][0-9]) (AM|PM)$"
)
UI_BROWSER_DATE_RE = re.compile(
    r"^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) "
    r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +"
    r"([1-9]|[12][0-9]|3[01]) ([0-9]{4}) "
    r"([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9]) "
    r"GMT(-[0-9]{4}) \(Central Daylight Time\)$"
)
UI_MONTHS = {
    name: index
    for index, name in enumerate(
        ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"),
        start=1,
    )
}
UI_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
KEY_READER = renderer._read_key_from_stdin
TRANSPORT_FACTORY = renderer.UrllibProviderTransport
PROBE_AUDIO = renderer._strict_probe_mono_mp3
NOW = renderer._utc_now
SLEEP = renderer.time.sleep


def _load(path: Path, code: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise renderer.NarrationError(code) from exc
    if not isinstance(value, dict):
        raise renderer.NarrationError(code)
    return value


def _outside_repository_file(path: Path, code: str) -> Path:
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(REPOSITORY.resolve())
    except ValueError:
        pass
    else:
        raise renderer.NarrationError(code)
    renderer._require_owned_directory(path.parent, path.parent, code)
    renderer._require_owned_regular_file(path, path.parent, code)
    return resolved


def _observation_common(
    raw: Mapping[str, Any],
    *,
    chapter_id: str,
    kind: str,
    schema_version: int = 1,
) -> None:
    def reject_sensitive(value: object) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                folded = str(key).casefold()
                if any(part in folded for part in renderer._FORBIDDEN_FIELD_PARTS):
                    if child is not False:
                        raise renderer.NarrationError(
                            "operator_observation_sensitive_field"
                        )
                else:
                    reject_sensitive(child)
        elif isinstance(value, list):
            for child in value:
                reject_sensitive(child)

    reject_sensitive(raw)
    if (
        raw.get("schema_version") != schema_version
        or raw.get("kind") != kind
        or raw.get("source") != "authenticated_browser"
        or raw.get("chapter_id") != chapter_id
        or renderer.SAFE_ID_RE.fullmatch(str(raw.get("observation_id") or ""))
        is None
    ):
        raise renderer.NarrationError("operator_observation_identity_invalid")
    renderer._parse_utc(raw.get("observed_at"), "operator_observation_time_invalid")


def _utc_offset_label(value: datetime) -> str:
    offset = value.utcoffset()
    if offset is None or offset.total_seconds() % 60:
        raise renderer.NarrationError("render_observation_key_timezone_invalid")
    total_minutes = int(offset.total_seconds() // 60)
    sign = "+" if total_minutes >= 0 else "-"
    total_minutes = abs(total_minutes)
    return f"{sign}{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def _strict_local_to_utc(
    naive: datetime,
    *,
    timezone_name: str,
    observed_offset: object,
    code: str,
) -> datetime:
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise renderer.NarrationError(code) from exc
    candidates: dict[datetime, datetime] = {}
    for fold in (0, 1):
        local = naive.replace(tzinfo=zone, fold=fold)
        utc_value = local.astimezone(timezone.utc)
        roundtrip = utc_value.astimezone(zone)
        if roundtrip.replace(tzinfo=None) == naive:
            candidates[utc_value] = local
    if len(candidates) != 1:
        raise renderer.NarrationError("render_observation_key_timezone_ambiguous")
    utc_value, local = next(iter(candidates.items()))
    if observed_offset != _utc_offset_label(local):
        raise renderer.NarrationError("render_observation_key_offset_mismatch")
    return utc_value


def _parse_ui_tooltip_minute(
    raw_value: object,
    *,
    timezone_name: str,
    observed_offset: object,
    code: str,
) -> datetime:
    if not isinstance(raw_value, str):
        raise renderer.NarrationError(code)
    match = UI_TOOLTIP_RE.fullmatch(raw_value)
    if match is None:
        raise renderer.NarrationError(code)
    month_name, day, year, hour, minute, meridiem = match.groups()
    hour_value = int(hour) % 12 + (12 if meridiem == "PM" else 0)
    try:
        naive = datetime(
            int(year),
            UI_MONTHS[month_name],
            int(day),
            hour_value,
            int(minute),
        )
    except ValueError as exc:
        raise renderer.NarrationError(code) from exc
    return _strict_local_to_utc(
        naive,
        timezone_name=timezone_name,
        observed_offset=observed_offset,
        code=code,
    )


def _parse_browser_date_string(
    raw_value: object, *, observed_at: datetime, timezone_name: str
) -> tuple[datetime, str]:
    if not isinstance(raw_value, str):
        raise renderer.NarrationError("render_observation_browser_time_invalid")
    match = UI_BROWSER_DATE_RE.fullmatch(raw_value)
    if match is None:
        raise renderer.NarrationError("render_observation_browser_time_invalid")
    (
        weekday,
        month_name,
        day,
        year,
        hour,
        minute,
        second,
        compact_offset,
    ) = match.groups()
    try:
        naive = datetime(
            int(year),
            UI_MONTHS[month_name],
            int(day),
            int(hour),
            int(minute),
            int(second),
        )
    except ValueError as exc:
        raise renderer.NarrationError("render_observation_browser_time_invalid") from exc
    if UI_WEEKDAYS[naive.weekday()] != weekday:
        raise renderer.NarrationError("render_observation_browser_time_invalid")
    offset = f"{compact_offset[:3]}:{compact_offset[3:]}"
    if offset != "-05:00":
        raise renderer.NarrationError("render_observation_browser_offset_invalid")
    browser_utc = _strict_local_to_utc(
        naive,
        timezone_name=timezone_name,
        observed_offset=offset,
        code="render_observation_browser_time_invalid",
    )
    if abs(browser_utc - observed_at) > timedelta(minutes=2):
        raise renderer.NarrationError("render_observation_browser_time_stale")
    return browser_utc, offset


def _ui_time_evidence(
    key: Mapping[str, Any], *, observed_at: datetime
) -> dict[str, Any]:
    timezone_name = key.get("provider_key_timestamp_timezone")
    if timezone_name != renderer.KEY_UI_TIMEZONE:
        raise renderer.NarrationError("render_observation_key_timezone_invalid")
    if any(
        (
            key.get("provider_key_timestamp_precision")
            != renderer.KEY_UI_TIMESTAMP_PRECISION,
            key.get("provider_key_timestamp_precision_seconds")
            != renderer.KEY_UI_TIMESTAMP_PRECISION_SECONDS,
            key.get("provider_key_timestamp_rounding_mode")
            != renderer.KEY_UI_ROUNDING_MODE,
            key.get("provider_key_timestamp_timezone_source")
            != renderer.KEY_UI_SOURCES["timezone"],
            key.get("provider_key_browser_date_source")
            != renderer.KEY_UI_SOURCES["browser_time"],
            key.get("provider_key_timestamp_offsets_source")
            != renderer.KEY_UI_SOURCES["offsets"],
        )
    ):
        raise renderer.NarrationError("render_observation_key_time_contract_invalid")
    _browser_utc, browser_offset = _parse_browser_date_string(
        key.get("provider_key_browser_date_string"),
        observed_at=observed_at,
        timezone_name=timezone_name,
    )
    if any(
        (
            key.get("provider_key_created_utc_offset") != browser_offset,
            key.get("provider_key_expires_utc_offset") != browser_offset,
        )
    ):
        raise renderer.NarrationError("render_observation_key_offset_transition")
    created_center = _parse_ui_tooltip_minute(
        key.get("provider_key_created_tooltip"),
        timezone_name=timezone_name,
        observed_offset=key.get("provider_key_created_utc_offset"),
        code="render_observation_key_created_tooltip_invalid",
    )
    expires_center = _parse_ui_tooltip_minute(
        key.get("provider_key_expires_tooltip"),
        timezone_name=timezone_name,
        observed_offset=key.get("provider_key_expires_utc_offset"),
        code="render_observation_key_expiry_tooltip_invalid",
    )
    uncertainty = timedelta(
        seconds=renderer.KEY_EXPIRY_INTERVAL_UNCERTAINTY_SECONDS
    )
    created_lower = created_center - uncertainty
    created_upper = created_center + uncertainty
    expires_lower = expires_center - uncertainty
    expires_upper = expires_center + uncertainty
    duration_lower = int((expires_lower - created_upper).total_seconds())
    duration_upper = int((expires_upper - created_lower).total_seconds())
    if any(
        (
            int((expires_center - created_center).total_seconds())
            != renderer.KEY_LIFETIME_SECONDS,
            duration_lower != renderer.KEY_LIFETIME_SECONDS - 120,
            duration_upper != renderer.KEY_LIFETIME_SECONDS + 120,
            key.get("requested_ttl_label")
            != renderer.KEY_UI_REQUESTED_TTL_LABEL,
            key.get("requested_ttl_seconds")
            != renderer.KEY_LIFETIME_SECONDS,
            key.get("provider_key_created_tooltip_directly_observed")
            is not True,
            key.get("provider_key_expires_tooltip_directly_observed")
            is not True,
            observed_at - created_lower
            > renderer.EXECUTION_EVIDENCE_MAX_AGE,
            created_upper - observed_at > timedelta(minutes=2),
            expires_lower - observed_at < renderer.MIN_KEY_REMAINING,
        )
    ):
        raise renderer.NarrationError("render_observation_key_time_contract_invalid")
    return {
        "created_center": created_center,
        "created_lower": created_lower,
        "created_upper": created_upper,
        "expires_center": expires_center,
        "expires_lower": expires_lower,
        "expires_upper": expires_upper,
        "duration_lower_seconds": duration_lower,
        "duration_upper_seconds": duration_upper,
    }


def _load_render_observation(
    path: Path,
    packet: renderer.ChapterPacket,
    *,
    expected_session_number: int,
) -> dict[str, Any]:
    raw = _load(
        _outside_repository_file(path, "render_observation_file_invalid"),
        "render_observation_unreadable",
    )
    expected_fields = {
        "schema_version",
        "kind",
        "observation_id",
        "source",
        "observed_at",
        "chapter_id",
        "account",
        "provider_usage_baseline",
        "terms",
        "voice_contract",
        "key_policy",
        "recovery",
        "privacy",
    }
    if set(raw) != expected_fields:
        raise renderer.NarrationError("render_observation_schema_invalid")
    _observation_common(
        raw,
        chapter_id=packet.chapter_id,
        kind="smokies_remaining_render_execution_observation_v2",
        schema_version=2,
    )
    if raw.get("privacy") != {
        "account_identity_recorded": False,
        "workspace_identity_recorded": False,
        "key_material_recorded": False,
        "local_paths_recorded": False,
    }:
        raise renderer.NarrationError("render_observation_privacy_invalid")
    key = raw.get("key_policy")
    if not isinstance(key, dict) or set(key) != {
        "provider_key_id",
        "provider_key_name",
        "provider_key_preview",
        "provider_key_created_tooltip",
        "provider_key_expires_tooltip",
        "provider_key_created_tooltip_directly_observed",
        "provider_key_expires_tooltip_directly_observed",
        "provider_key_timestamp_timezone",
        "provider_key_timestamp_timezone_source",
        "provider_key_timestamp_precision",
        "provider_key_timestamp_precision_seconds",
        "provider_key_timestamp_rounding_mode",
        "provider_key_created_utc_offset",
        "provider_key_expires_utc_offset",
        "provider_key_timestamp_offsets_source",
        "provider_key_browser_date_string",
        "provider_key_browser_date_source",
        "provider_key_matching_row_count",
        "provider_key_row_unique",
        "provider_key_enabled",
        "requested_ttl_label",
        "requested_ttl_seconds",
        "key_credit_limit",
        "key_permissions",
        "restrict_key_enabled",
        "auto_disable_if_leaked",
        "other_chapter_keys_active",
        "provider_key_id_source",
        "provider_key_name_source",
        "provider_key_preview_source",
        "provider_key_created_tooltip_source",
        "provider_key_expiry_tooltip_source",
        "provider_key_enabled_source",
        "provider_key_controls_source",
        "provider_key_uniqueness_source",
        "post_create_response_inspected",
        "key_delivery",
        "key_identity_capture",
    }:
        raise renderer.NarrationError("render_observation_key_schema_invalid")
    raw_key_id = key.get("provider_key_id")
    if (
        not isinstance(raw_key_id, str)
        or re.fullmatch(r"[A-Za-z0-9_-]{16,128}", raw_key_id) is None
    ):
        raise renderer.NarrationError("render_observation_key_id_invalid")
    raw_key_name = key.get("provider_key_name")
    expected_key_name = renderer._provider_key_name(
        packet.chapter_id, expected_session_number
    )
    if (
        not isinstance(raw_key_name, str)
        or not raw_key_name.isascii()
        or raw_key_name != expected_key_name
    ):
        raise renderer.NarrationError("render_observation_key_name_invalid")
    raw_preview = key.get("provider_key_preview")
    if (
        not isinstance(raw_preview, str)
        or len(raw_preview) != 4
        or not raw_preview.isascii()
        or any(not 0x21 <= ord(character) <= 0x7E for character in raw_preview)
    ):
        raise renderer.NarrationError("render_observation_key_preview_invalid")
    if hmac.compare_digest(
        raw_key_id.encode("ascii"), raw_preview.encode("ascii")
    ) or hmac.compare_digest(
        raw_key_id.encode("ascii"), raw_key_name.encode("ascii")
    ):
        raise renderer.NarrationError("render_observation_key_identity_invalid")
    observed_at = renderer._parse_utc(
        raw.get("observed_at"), "render_observation_time_invalid"
    )
    current = NOW()
    if (
        observed_at > current + timedelta(minutes=2)
        or current - observed_at > renderer.EXECUTION_EVIDENCE_MAX_AGE
    ):
        raise renderer.NarrationError("render_observation_not_fresh")
    key_time = _ui_time_evidence(key, observed_at=observed_at)
    if any(
        (
            current - key_time["created_lower"]
            > renderer.EXECUTION_EVIDENCE_MAX_AGE,
            key_time["created_upper"] - current > timedelta(minutes=2),
            key_time["expires_lower"] - current < renderer.MIN_KEY_REMAINING,
        )
    ):
        raise renderer.NarrationError(
            "render_observation_key_action_time_invalid"
        )
    credit_limit = key.get("key_credit_limit")
    if isinstance(credit_limit, bool) or not isinstance(credit_limit, int):
        raise renderer.NarrationError("render_observation_key_delivery_invalid")
    if any(
        (
            not 0 < credit_limit <= packet.key_credit_quota,
            key.get("key_permissions")
            != list(renderer.EXPECTED_KEY_PERMISSIONS),
            key.get("restrict_key_enabled") is not True,
            key.get("auto_disable_if_leaked") is not True,
            key.get("other_chapter_keys_active") is not False,
            key.get("provider_key_enabled") is not True,
            isinstance(key.get("provider_key_matching_row_count"), bool),
            key.get("provider_key_matching_row_count") != 1,
            key.get("provider_key_row_unique") is not True,
            key.get("provider_key_id_source")
            != renderer.KEY_UI_SOURCES["key_id"],
            key.get("provider_key_name_source")
            != renderer.KEY_UI_SOURCES["key_name"],
            key.get("provider_key_preview_source")
            != renderer.KEY_UI_SOURCES["key_preview"],
            key.get("provider_key_created_tooltip_source")
            != renderer.KEY_UI_SOURCES["created_tooltip"],
            key.get("provider_key_expiry_tooltip_source")
            != renderer.KEY_UI_SOURCES["expiry_tooltip"],
            key.get("provider_key_enabled_source")
            != renderer.KEY_UI_SOURCES["enabled"],
            key.get("provider_key_controls_source")
            != renderer.KEY_UI_SOURCES["controls"],
            key.get("provider_key_uniqueness_source")
            != renderer.KEY_UI_SOURCES["uniqueness"],
            key.get("post_create_response_inspected") is not False,
            key.get("key_delivery")
            != "secure_piped_stdin_external_transfer_not_attested_by_operator",
            key.get("key_identity_capture")
            != "official_ui_key_row_name_id_preview_times_controls_and_operator_memory_material_sha256",
        )
    ):
        raise renderer.NarrationError("render_observation_key_delivery_invalid")
    return raw


def _build_execution_evidence(
    observation: Mapping[str, Any],
    *,
    packet: renderer.ChapterPacket,
    root: Path,
    sources: renderer.SourceBindings,
    state: Mapping[str, Any],
    key_material_sha256: str,
) -> dict[str, Any]:
    prior_session = state["sessions"][-1] if state["sessions"] else None
    account = observation.get("account")
    if not isinstance(account, dict):
        raise renderer.NarrationError("render_observation_account_invalid")
    observed_key = dict(observation["key_policy"])
    raw_key_id = str(observed_key["provider_key_id"])
    raw_key_name = str(observed_key["provider_key_name"])
    raw_preview = str(observed_key["provider_key_preview"])
    key_id_sha256 = hashlib.sha256(raw_key_id.encode("utf-8")).hexdigest()
    preview_sha256 = hashlib.sha256(raw_preview.encode("ascii")).hexdigest()
    key_name_sha256 = hashlib.sha256(raw_key_name.encode("ascii")).hexdigest()
    key_session_number = len(state["sessions"]) + 1
    if raw_key_name != renderer._provider_key_name(
        packet.chapter_id, key_session_number
    ):
        raise renderer.NarrationError("render_observation_key_name_invalid")
    observed_at = renderer._parse_utc(
        observation["observed_at"], "render_observation_time_invalid"
    )
    time_evidence = _ui_time_evidence(observed_key, observed_at=observed_at)
    created_tooltip = str(observed_key["provider_key_created_tooltip"])
    expires_tooltip = str(observed_key["provider_key_expires_tooltip"])
    browser_date_string = str(observed_key["provider_key_browser_date_string"])
    key = {
        "key_id_sha256": key_id_sha256,
        "key_material_sha256": key_material_sha256,
        "key_preview_sha256": preview_sha256,
        "provider_key_name_sha256": key_name_sha256,
        "key_session_number": key_session_number,
        "key_credit_limit": observed_key["key_credit_limit"],
        "key_permissions": observed_key["key_permissions"],
        "restrict_key_enabled": observed_key["restrict_key_enabled"],
        "auto_disable_if_leaked": observed_key["auto_disable_if_leaked"],
        "other_chapter_keys_active": observed_key[
            "other_chapter_keys_active"
        ],
        "provider_key_matching_row_count": 1,
        "provider_key_row_unique": True,
        "provider_key_enabled": True,
        "provider_key_created_tooltip": created_tooltip,
        "provider_key_expires_tooltip": expires_tooltip,
        "provider_key_browser_date_string": browser_date_string,
        "provider_key_created_tooltip_sha256": hashlib.sha256(
            created_tooltip.encode("ascii")
        ).hexdigest(),
        "provider_key_expires_tooltip_sha256": hashlib.sha256(
            expires_tooltip.encode("ascii")
        ).hexdigest(),
        "provider_key_browser_date_string_sha256": hashlib.sha256(
            browser_date_string.encode("ascii")
        ).hexdigest(),
        "provider_key_timestamp_timezone": renderer.KEY_UI_TIMEZONE,
        "provider_key_timestamp_precision": renderer.KEY_UI_TIMESTAMP_PRECISION,
        "provider_key_timestamp_precision_seconds": (
            renderer.KEY_UI_TIMESTAMP_PRECISION_SECONDS
        ),
        "provider_key_timestamp_rounding_mode": renderer.KEY_UI_ROUNDING_MODE,
        "provider_key_created_utc_offset": observed_key[
            "provider_key_created_utc_offset"
        ],
        "provider_key_expires_utc_offset": observed_key[
            "provider_key_expires_utc_offset"
        ],
        "key_created_at_interval_lower": renderer._iso(
            time_evidence["created_lower"]
        ),
        "key_created_at_interval_upper": renderer._iso(
            time_evidence["created_upper"]
        ),
        "key_expires_at_interval_lower": renderer._iso(
            time_evidence["expires_lower"]
        ),
        "key_expires_at_interval_upper": renderer._iso(
            time_evidence["expires_upper"]
        ),
        "key_expiry_conservative_deadline": renderer._iso(
            time_evidence["expires_lower"]
        ),
        "key_displayed_center_duration_seconds": renderer.KEY_LIFETIME_SECONDS,
        "key_duration_interval_lower_seconds": time_evidence[
            "duration_lower_seconds"
        ],
        "key_duration_interval_upper_seconds": time_evidence[
            "duration_upper_seconds"
        ],
        "provider_key_created_tooltip_directly_observed": True,
        "provider_key_expires_tooltip_directly_observed": True,
        "requested_ttl_label": renderer.KEY_UI_REQUESTED_TTL_LABEL,
        "requested_ttl_seconds": renderer.KEY_LIFETIME_SECONDS,
        "provider_key_id_source": observed_key[
            "provider_key_id_source"
        ],
        "provider_key_name_source": observed_key[
            "provider_key_name_source"
        ],
        "provider_key_preview_source": observed_key[
            "provider_key_preview_source"
        ],
        "provider_key_created_tooltip_source": observed_key[
            "provider_key_created_tooltip_source"
        ],
        "provider_key_expiry_tooltip_source": observed_key[
            "provider_key_expiry_tooltip_source"
        ],
        "provider_key_enabled_source": observed_key[
            "provider_key_enabled_source"
        ],
        "provider_key_controls_source": observed_key[
            "provider_key_controls_source"
        ],
        "provider_key_uniqueness_source": observed_key[
            "provider_key_uniqueness_source"
        ],
        "provider_key_timestamp_timezone_source": observed_key[
            "provider_key_timestamp_timezone_source"
        ],
        "provider_key_timestamp_offsets_source": observed_key[
            "provider_key_timestamp_offsets_source"
        ],
        "provider_key_browser_date_source": observed_key[
            "provider_key_browser_date_source"
        ],
        "post_create_response_inspected": False,
        "key_delivery": observed_key["key_delivery"],
        "key_identity_capture": observed_key["key_identity_capture"],
    }
    committed = sum(
        int(item["accepted"]["character_cost"])
        for item in state["items"].values()
        if item["state"] == "completed"
    )
    if prior_session is None:
        if observation.get("recovery") is not None:
            raise renderer.NarrationError("render_recovery_unexpected")
        continuation = None
        expected_key_limit = packet.key_credit_quota
    else:
        recovery = observation.get("recovery")
        expected_recovery_fields = {
            "recovery_only",
            "prior_key_id",
            "prior_key_deleted",
            "prior_key_deletion_verified",
            "prior_key_deleted_at",
            "provider_usage_reconciled",
            "unresolved_provider_ambiguity",
            "replacement_key_creation_initiated_at",
            "replacement_key_creation_initiated_after_prior_deletion_verified",
            "replacement_key_creation_action_source",
        }
        if not isinstance(recovery, dict) or set(recovery) != expected_recovery_fields:
            raise renderer.NarrationError("render_recovery_schema_invalid")
        deleted_at = renderer._parse_utc(
            recovery.get("prior_key_deleted_at"),
            "render_recovery_deletion_time_invalid",
        )
        replacement_initiated_at = renderer._parse_utc(
            recovery.get("replacement_key_creation_initiated_at"),
            "render_recovery_key_initiation_time_invalid",
        )
        observation_at = renderer._parse_utc(
            observation.get("observed_at"), "render_observation_time_invalid"
        )
        committed_since_prior = committed - int(
            prior_session["ledger_character_cost_total_at_start"]
        )
        available = account.get("available_credits")
        observed_billable_requests = account.get(
            "observed_billable_request_count"
        )
        completed_request_count = sum(
            item["state"] == "completed" for item in state["items"].values()
        )
        completed_since_prior = completed_request_count - int(
            prior_session["ledger_request_count_at_start"]
        )
        partial_billable_input_characters = (
            renderer._locked_billable_input_characters_between_requests(
                packet,
                int(prior_session["ledger_request_count_at_start"]),
                completed_request_count,
            )
        )
        prior_key_id_sha256 = hashlib.sha256(
            str(recovery.get("prior_key_id")).encode("utf-8")
        ).hexdigest()
        try:
            starting_usage_usd = Decimal(
                prior_session["observed_total_usage_usd"]
            )
            ending_usage_usd = Decimal(str(account["observed_total_usage_usd"]))
        except (InvalidOperation, KeyError) as exc:
            raise renderer.NarrationError(
                "render_recovery_usage_usd_invalid"
            ) from exc
        partial_usage_usd = ending_usage_usd - starting_usage_usd
        ledger_partial_usage_usd = renderer._unrounded_usage_cost(
            partial_billable_input_characters
        )
        expected_key_limit = packet.renderer_character_cap - committed
        if any(
            (
                recovery.get("recovery_only") is not True,
                prior_key_id_sha256 != prior_session["key_id_sha256"],
                recovery.get("prior_key_deleted") is not True,
                recovery.get("prior_key_deletion_verified") is not True,
                recovery.get("provider_usage_reconciled") is not True,
                recovery.get("unresolved_provider_ambiguity") is not False,
                recovery.get(
                    "replacement_key_creation_initiated_after_prior_deletion_verified"
                )
                is not True,
                recovery.get("replacement_key_creation_action_source")
                != "authenticated_browser_action_sequence",
                replacement_initiated_at < deleted_at,
                replacement_initiated_at > observation_at,
                deleted_at
                < renderer._parse_utc(
                    state["updated_at"], "render_event_timestamp_invalid"
                ),
                key_id_sha256 == prior_session["key_id_sha256"],
                key_material_sha256 == prior_session["key_material_sha256"],
                isinstance(available, bool),
                not isinstance(available, int),
                prior_session["available_credits"] - available
                != committed_since_prior,
                expected_key_limit <= 0,
                committed + expected_key_limit
                != packet.renderer_character_cap,
                abs(partial_usage_usd - ledger_partial_usage_usd)
                > Decimal("0.01"),
                isinstance(observed_billable_requests, bool),
                not isinstance(observed_billable_requests, int),
                observed_billable_requests
                - prior_session["observed_billable_request_count"]
                != completed_since_prior,
            )
        ):
            raise renderer.NarrationError("render_recovery_reconciliation_invalid")
        continuation = {
            "prior_execution_evidence_sha256": prior_session[
                "evidence_sha256"
            ],
            "continuation_mode": "recovery_only_replacement_key",
            "prior_key_id_sha256": prior_session["key_id_sha256"],
            "prior_key_deleted": True,
            "prior_key_deletion_verified": True,
            "prior_key_deleted_at": recovery["prior_key_deleted_at"],
            "replacement_key_creation_initiated_at": recovery[
                "replacement_key_creation_initiated_at"
            ],
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
            "partial_usage_ledger_credits": committed_since_prior,
            "partial_usage_ledger_billable_input_characters": (
                partial_billable_input_characters
            ),
            "partial_usage_reconciliation_passed": True,
            "partial_usage_starting_total_usage_usd": (
                f"{starting_usage_usd:.2f}"
            ),
            "partial_usage_ending_total_usage_usd": (
                f"{ending_usage_usd:.2f}"
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
            "partial_usage_billable_request_count": completed_since_prior,
            "partial_usage_ledger_request_count": completed_since_prior,
            "partial_usage_request_reconciliation_passed": True,
            "ledger_character_cost_total": committed,
            "residual_key_credit_limit": expected_key_limit,
            "accepted_plus_residual_cap": committed + expected_key_limit,
            "unresolved_provider_ambiguity": False,
            "recovery_only_within_existing_owner_authority": True,
        }
    if key.get("key_credit_limit") != expected_key_limit:
        raise renderer.NarrationError("render_key_residual_quota_invalid")
    required_exposure = renderer._remaining_renderer_cap(packet.chapter_id) - committed
    if account.get("required_remaining_renderer_cap") != required_exposure:
        raise renderer.NarrationError("render_remaining_exposure_invalid")
    observation_sha = renderer._sha256_bytes(renderer._canonical_bytes(observation))
    return {
        "schema_version": 1,
        "evidence_id": f"smokies_execution_{observation_sha[:32]}",
        "source": "authenticated_browser",
        "source_observation_sha256": observation_sha,
        "observed_at": observation["observed_at"],
        "chapter_id": packet.chapter_id,
        "account": observation["account"],
        "provider_usage_baseline": observation["provider_usage_baseline"],
        "terms": observation["terms"],
        "voice_contract": observation["voice_contract"],
        "key_policy": key,
        "continuation": continuation,
        "authorization": {
            "owner_render_and_spend_authorized": True,
            "postpurchase_continuation_authorized": True,
            "independent_renderer_audit_passed": True,
            "chapter_key_created": True,
            "provider_preflight_authorized": True,
            "provider_request_authorized": True,
            "provider_credit_spend_authorized": True,
            "paid_usage_overage_authorized": False,
            "rerender_authorized": False,
        },
        "bindings": {
            "renderer_sha256": renderer._sha256_file(Path(renderer.__file__)),
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
            "output_root_sha256": renderer._output_root_hash(root),
            "ledger_event_chain_head": state["event_head_sha256"],
        },
        "effects_before_apply": {
            "provider_tts_requests_sent_this_execution": 0,
            "provider_credits_spent_this_execution": 0,
            "chapter_audio_files_created_this_execution": 0,
        },
    }


def _validate_key_preview_in_memory(
    key_material: bytearray, observation: Mapping[str, Any]
) -> None:
    preview_value = observation["key_policy"]["provider_key_preview"]
    try:
        preview = str(preview_value).encode("ascii")
    except UnicodeEncodeError as exc:
        raise renderer.NarrationError(
            "render_observation_key_preview_invalid"
        ) from exc
    if len(preview) != 4 or len(key_material) < 4 or not hmac.compare_digest(
        bytes(key_material[-4:]), preview
    ):
        raise renderer.NarrationError(
            "provider_key_preview_mismatch_delete_key_required"
        )


def _evidence_path(root: Path, chapter_id: str, evidence: Mapping[str, Any]) -> Path:
    digest = renderer._sha256_bytes(renderer._canonical_bytes(evidence))
    return root.parent / (
        f".{root.name}.{chapter_id}.{digest[:16]}.execution-evidence.json"
    )


def _find_session_evidence(
    root: Path, chapter_id: str, evidence_sha256: str
) -> Path:
    pattern = f".{root.name}.{chapter_id}.*.execution-evidence.json"
    matches: list[Path] = []
    for candidate in root.parent.glob(pattern):
        renderer._require_owned_regular_file(
            candidate, root.parent, "bound_execution_evidence_file_invalid"
        )
        if renderer._sha256_file(candidate) == evidence_sha256:
            matches.append(candidate)
    if len(matches) != 1:
        raise renderer.NarrationError("bound_execution_evidence_file_missing")
    return matches[0]


def _serialized_json(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        value, indent=2, sort_keys=True, ensure_ascii=False
    ).encode("utf-8") + b"\n"


def _create_json_idempotent(path: Path, value: Mapping[str, Any]) -> bool:
    expected = _serialized_json(value)
    if renderer._path_present(path):
        renderer._require_owned_regular_file(
            path, path.parent, "operator_existing_record_invalid"
        )
        if path.read_bytes() != expected:
            raise renderer.NarrationError("operator_existing_record_drift")
        return False
    renderer._create_only(path, expected)
    return True


@contextmanager
def _operator_sentinel(root: Path):
    path = root.parent / f".{root.name}.remaining-operator.lock"
    flags = os.O_CREAT | os.O_RDWR
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        info = os.fstat(descriptor)
        if (
            not renderer.stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_mode & 0o077
        ):
            raise renderer.NarrationError("operator_lock_file_invalid")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise renderer.NarrationError("concurrent_operator_forbidden") from None
        os.ftruncate(descriptor, 0)
        os.write(descriptor, f"{OPERATOR_CONTRACT}\n".encode("utf-8"))
        os.fsync(descriptor)
        yield
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def _render_apply(
    *,
    chapter_id: str,
    root: Path,
    observation_path: Path,
    verified_output_format: str | None,
) -> dict[str, Any]:
    packet = renderer.load_chapter_packet(chapter_id)
    sources = renderer.load_audit_evidence()
    renderer._prepare_root(root)
    renderer._validate_prior_sequence(
        root,
        chapter_id=chapter_id,
        sources=sources,
        probe_audio=PROBE_AUDIO,
    )
    chapter_dir = root / chapter_id
    _events, state = renderer._load_state(
        chapter_dir, packet=packet, sources=sources, root=root
    )
    if state["status"] == "blocked_manual_reconciliation_required" or any(
        item["state"] == "dispatched" for item in state["items"].values()
    ):
        raise renderer.NarrationError("manual_provider_reconciliation_required")
    if state["status"] == "render_complete_pending_key_deletion_closeout" or any(
        item["state"] == "accepted_pending_promotion"
        for item in state["items"].values()
    ):
        if not state["sessions"]:
            raise renderer.NarrationError("local_recovery_session_missing")
        bound_evidence = _find_session_evidence(
            root,
            chapter_id,
            state["sessions"][-1]["evidence_sha256"],
        )
        return renderer.run_renderer(
            chapter_id=chapter_id,
            output_root=root,
            apply=True,
            verified_output_format=verified_output_format,
            execution_evidence_path=bound_evidence,
            key_reader=lambda: (_ for _ in ()).throw(
                renderer.NarrationError("unexpected_key_read")
            ),
            transport_factory=TRANSPORT_FACTORY,
            probe_audio=PROBE_AUDIO,
            sleep=SLEEP,
            now=NOW,
            _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
        )
    observation = _load_render_observation(
        observation_path,
        packet,
        expected_session_number=len(state["sessions"]) + 1,
    )
    key_material = KEY_READER()
    try:
        _validate_key_preview_in_memory(key_material, observation)
        evidence = _build_execution_evidence(
            observation,
            packet=packet,
            root=root,
            sources=sources,
            state=state,
            key_material_sha256=hashlib.sha256(bytes(key_material)).hexdigest(),
        )
        evidence_path = _evidence_path(root, chapter_id, evidence)
        _create_json_idempotent(evidence_path, evidence)
        result = renderer.run_renderer(
            chapter_id=chapter_id,
            output_root=root,
            apply=True,
            verified_output_format=verified_output_format,
            execution_evidence_path=evidence_path,
            key_reader=lambda: key_material,
            transport_factory=TRANSPORT_FACTORY,
            probe_audio=PROBE_AUDIO,
            sleep=SLEEP,
            now=NOW,
            _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
        )
        return {
            **result,
            "operator_contract": OPERATOR_CONTRACT,
            "execution_evidence_sha256": renderer._sha256_file(evidence_path),
            "execution_evidence_filename": evidence_path.name,
            "key_material_output": False,
        }
    finally:
        for index in range(len(key_material)):
            key_material[index] = 0


def _load_closeout_observation(
    path: Path, chapter_id: str
) -> tuple[dict[str, Any], str]:
    resolved = _outside_repository_file(
        path, "closeout_observation_file_invalid"
    )
    if resolved == renderer.LIVE_FOOTHILLS_CLOSEOUT_OBSERVATION_PATH.resolve(
        strict=False
    ):
        if chapter_id != "foothills_parkway":
            raise renderer.NarrationError(
                "live_closeout_observation_chapter_invalid"
            )
        live = renderer._load_bound_live_foothills_closeout_observation()
        ending = live["ending_account"]
        provider = live["provider_ui_evidence"]
        canonical = {
            "schema_version": 2,
            "kind": "smokies_remaining_render_closeout_observation_v2",
            "observation_id": live["observation_id"],
            "source": "authenticated_browser",
            "observed_at": live["observed_at"],
            "chapter_id": live["chapter_id"],
            "ending_provider_credits": ending["provider_credits_remaining"],
            "ending_billable_request_count": ending[
                "billable_request_count"
            ],
            "ending_total_usage_usd": ending["total_usage_usd"],
            "key_id": provider["key_id"],
            "key_deleted_at": provider["key_deleted_at"],
            "key_deletion_source": provider["key_deletion_source"],
            "key_deleted": provider["key_deleted"],
            "key_deletion_verified": provider["key_deletion_verified"],
            "no_other_active_render_keys": provider[
                "no_other_active_render_keys"
            ],
            "other_account_usage_observed": provider[
                "other_account_usage_observed"
            ],
            "privacy": {
                "account_identity_recorded": False,
                "workspace_identity_recorded": False,
                "key_material_recorded": False,
                "local_paths_recorded": False,
            },
        }
        return canonical, renderer.LIVE_FOOTHILLS_CLOSEOUT_OBSERVATION_SHA256
    raw = _load(
        resolved,
        "closeout_observation_unreadable",
    )
    expected_fields = {
        "schema_version",
        "kind",
        "observation_id",
        "source",
        "observed_at",
        "chapter_id",
        "ending_provider_credits",
        "ending_billable_request_count",
        "ending_total_usage_usd",
        "key_id",
        "key_deleted_at",
        "key_deletion_source",
        "key_deleted",
        "key_deletion_verified",
        "no_other_active_render_keys",
        "other_account_usage_observed",
        "privacy",
    }
    if set(raw) != expected_fields:
        raise renderer.NarrationError("closeout_observation_schema_invalid")
    _observation_common(
        raw,
        chapter_id=chapter_id,
        kind="smokies_remaining_render_closeout_observation_v2",
        schema_version=2,
    )
    if raw["privacy"] != {
        "account_identity_recorded": False,
        "workspace_identity_recorded": False,
        "key_material_recorded": False,
        "local_paths_recorded": False,
    }:
        raise renderer.NarrationError("closeout_observation_privacy_invalid")
    raw_key_id = raw.get("key_id")
    if (
        not isinstance(raw_key_id, str)
        or re.fullmatch(r"[A-Za-z0-9_-]{16,128}", raw_key_id) is None
    ):
        raise renderer.NarrationError("closeout_observation_key_id_invalid")
    observed = renderer._parse_utc(
        raw["observed_at"], "closeout_observation_time_invalid"
    )
    deleted_at = renderer._parse_utc(
        raw["key_deleted_at"], "closeout_observation_key_deleted_at_invalid"
    )
    current = NOW()
    if (
        observed > current + renderer.timedelta(minutes=2)
        or current - observed > renderer.EXECUTION_EVIDENCE_MAX_AGE
        or deleted_at > observed
        or raw.get("key_deletion_source")
        != "official_signed_in_api_keys_ui_delete_and_absence_verification"
    ):
        raise renderer.NarrationError("closeout_observation_not_fresh")
    return raw, renderer._sha256_bytes(renderer._canonical_bytes(raw))


def _closeout_apply(
    *, chapter_id: str, root: Path, observation_path: Path
) -> dict[str, Any]:
    sources = renderer.load_audit_evidence()
    packet = renderer.load_chapter_packet(chapter_id)
    (
        starting_credits,
        starting_requests,
        starting_usd,
        prior_closeout_sha,
    ) = renderer._validate_prior_sequence(
        root,
        chapter_id=chapter_id,
        sources=sources,
        probe_audio=PROBE_AUDIO,
    )
    chapter_dir = root / chapter_id
    _events, state = renderer._load_state(
        chapter_dir, packet=packet, sources=sources, root=root
    )
    if state["status"] != "render_complete_pending_key_deletion_closeout":
        raise renderer.NarrationError("chapter_render_not_ready_for_closeout")
    renderer._validate_completed_files(
        chapter_dir,
        packet=packet,
        state=state,
        probe_audio=PROBE_AUDIO,
    )
    observation, observation_sha = _load_closeout_observation(
        observation_path, chapter_id
    )
    if not state["sessions"]:
        raise renderer.NarrationError("chapter_closeout_session_missing")
    session = state["sessions"][-1]
    deleted_at = renderer._parse_utc(
        observation["key_deleted_at"],
        "closeout_observation_key_deleted_at_invalid",
    )
    rendered_at = renderer._parse_utc(
        state["updated_at"], "render_event_timestamp_invalid"
    )
    renderer._require_conservative_key_deadline(
        session["key_expiry_conservative_deadline"],
        current=renderer._parse_utc(
            observation["observed_at"], "closeout_observation_time_invalid"
        ),
        operation_timeout_seconds=0,
        code="closeout_after_conservative_key_expiry_deadline",
    )
    if deleted_at < rendered_at:
        raise renderer.NarrationError("closeout_key_deleted_before_render_complete")
    observed_key_id_sha256 = hashlib.sha256(
        observation["key_id"].encode("utf-8")
    ).hexdigest()
    committed = sum(
        int(item["accepted"]["character_cost"])
        for item in state["items"].values()
    )
    billable_input_characters = renderer._completed_billable_input_characters(
        packet, state
    )
    ledger_input_usage_usd = renderer._unrounded_usage_cost(
        billable_input_characters
    )
    projected_chapter_cost = renderer._projected_cost(
        billable_input_characters
    )
    if any(
        (
            billable_input_characters != packet.payload_character_count,
            projected_chapter_cost > Decimal(packet.dollar_cap_usd),
        )
    ):
        raise renderer.NarrationError("closeout_chapter_dollar_cap_invalid")
    _rows, inventory_sha = renderer._audio_inventory(packet, state)
    ending_credits = observation["ending_provider_credits"]
    ending_requests = observation["ending_billable_request_count"]
    ending_usd_value = observation["ending_total_usage_usd"]
    if (
        isinstance(ending_credits, bool)
        or not isinstance(ending_credits, int)
        or isinstance(ending_requests, bool)
        or not isinstance(ending_requests, int)
    ):
        raise renderer.NarrationError("closeout_observed_values_invalid")
    if ending_usd_value is None:
        if any(
            (
                ending_credits != starting_credits - committed,
                ending_requests != starting_requests + len(packet.requests),
                observed_key_id_sha256
                != state["sessions"][-1]["key_id_sha256"],
                observation.get("key_deleted") is not True,
                observation.get("key_deletion_verified") is not True,
                observation.get("no_other_active_render_keys") is not True,
                observation.get("other_account_usage_observed") is not False,
            )
        ):
            raise renderer.NarrationError(
                "provisional_key_deletion_reconciliation_invalid"
            )
        provisional = {
            "schema_version": 1,
            "record_id": (
                "smokies_provisional_"
                f"{hashlib.sha256(renderer._canonical_bytes(observation)).hexdigest()[:32]}"
            ),
            "record_type": "key_deletion_only_provisional_not_usage_closeout",
            "source": "authenticated_provider_usage_and_key_management_ui",
            "source_observation_sha256": observation_sha,
            "observed_at": observation["observed_at"],
            "renderer_contract": renderer.RENDERER_CONTRACT,
            "chapter_id": chapter_id,
            "render_event_count": state["event_count"],
            "render_event_head_sha256": state["event_head_sha256"],
            "render_ledger_sha256": renderer._sha256_file(
                chapter_dir / renderer.LEDGER_NAME
            ),
            "audio_inventory_schema_version": (
                renderer.AUDIO_INVENTORY_SCHEMA_VERSION
            ),
            "audio_inventory_sha256": inventory_sha,
            "key_id_sha256": state["sessions"][-1]["key_id_sha256"],
            "key_material_sha256": state["sessions"][-1][
                "key_material_sha256"
            ],
            "key_deleted": True,
            "key_deletion_verified": True,
            "key_deleted_at": observation["key_deleted_at"],
            "key_deletion_source": observation["key_deletion_source"],
            "key_ui_time_evidence": renderer._key_ui_time_evidence_from_session(
                session
            ),
            "key_expiry_conservative_deadline": session[
                "key_expiry_conservative_deadline"
            ],
            "key_deleted_before_conservative_expiry": True,
            "no_other_active_render_keys": True,
            "ending_provider_credits": ending_credits,
            "ending_billable_request_count": ending_requests,
            "ending_total_usage_usd": None,
            "ledger_provider_credit_cost_total": committed,
            "ledger_billable_input_character_count_total": (
                billable_input_characters
            ),
            "ledger_input_character_usage_usd_unrounded": (
                f"{ledger_input_usage_usd:.4f}"
            ),
            "projected_chapter_cost_ceiling_usd": str(
                projected_chapter_cost
            ),
            "chapter_dollar_cap_usd": packet.dollar_cap_usd,
            "credit_and_input_character_meters_independent": True,
            "total_usage_usd_observation": (
                "unavailable_on_authenticated_surface"
            ),
            "final_usage_reconciliation_complete": False,
            "replacement_key_authorized": False,
            "next_chapter_unlocked": False,
            "qa_eligible": False,
            "publication_eligible": False,
            "contains_key_material": False,
        }
        renderer._reject_private_values(provisional)
        provisional_path = chapter_dir / renderer.PROVISIONAL_CLOSEOUT_NAME
        _create_json_idempotent(provisional_path, provisional)
        return {
            "apply": True,
            "status": "key_deleted_provisional_usage_observation_required",
            "chapter_id": chapter_id,
            "operator_contract": OPERATOR_CONTRACT,
            "provisional_record_sha256": renderer._sha256_file(
                provisional_path
            ),
            "next_chapter_unlocked": False,
            "qa_eligible": False,
            "network_used": False,
            "key_read": False,
        }
    else:
        ending_usd_raw = str(ending_usd_value)
        if starting_usd is None or USD_RE.fullmatch(ending_usd_raw) is None:
            raise renderer.NarrationError("closeout_observed_values_invalid")
        try:
            ending_usd = Decimal(ending_usd_raw)
        except InvalidOperation as exc:
            raise renderer.NarrationError("closeout_observed_values_invalid") from exc
        delta_usd = ending_usd - starting_usd
        starting_usd_raw = f"{starting_usd:.2f}"
        delta_usd_raw = f"{delta_usd:.2f}"
        tolerance_usd = "0.01"
        dollar_passed = (
            abs(delta_usd - ledger_input_usage_usd)
            <= Decimal("0.01")
        )
        observation_sources = {
            "provider_credits": "authenticated_subscription_ui_or_api_exact_integer",
            "billable_request_count": "authenticated_usage_analytics_ui_exact_integer",
            "total_usage_usd": "authenticated_usage_analytics_ui_two_decimal_rounded",
            "chapter_usage_usd": "derived_difference_of_observed_rounded_totals",
            "ledger_usage_usd": (
                "locked_payload_input_characters_at_locked_rate"
            ),
        }
    closeout = {
        "schema_version": 3,
        "closeout_id": f"smokies_closeout_{observation_sha[:32]}",
        "source": "authenticated_provider_usage_and_key_management_ui",
        "source_observation_sha256": observation_sha,
        "observed_at": observation["observed_at"],
        "renderer_contract": renderer.RENDERER_CONTRACT,
        "chapter_id": chapter_id,
        "render_event_count": state["event_count"],
        "render_event_head_sha256": state["event_head_sha256"],
        "render_ledger_sha256": renderer._sha256_file(
            chapter_dir / renderer.LEDGER_NAME
        ),
        "audio_inventory_schema_version": (
            renderer.AUDIO_INVENTORY_SCHEMA_VERSION
        ),
        "audio_inventory_sha256": inventory_sha,
        "prior_closeout_sha256": prior_closeout_sha,
        "key_id_sha256": observed_key_id_sha256,
        "key_material_sha256": state["sessions"][-1][
            "key_material_sha256"
        ],
        "key_deleted": observation["key_deleted"],
        "key_deletion_verified": observation["key_deletion_verified"],
        "key_deleted_at": observation["key_deleted_at"],
        "key_deletion_source": observation["key_deletion_source"],
        "key_ui_time_evidence": renderer._key_ui_time_evidence_from_session(
            session
        ),
        "key_expiry_conservative_deadline": session[
            "key_expiry_conservative_deadline"
        ],
        "key_deleted_before_conservative_expiry": True,
        "no_other_active_render_keys": observation[
            "no_other_active_render_keys"
        ],
        "starting_provider_credits": starting_credits,
        "ending_provider_credits": ending_credits,
        "ledger_provider_credit_cost_total": committed,
        "ledger_billable_input_character_count_total": (
            billable_input_characters
        ),
        "provider_reported_usage_credits": starting_credits - ending_credits,
        "starting_billable_request_count": starting_requests,
        "ending_billable_request_count": ending_requests,
        "provider_reported_request_count": ending_requests - starting_requests,
        "starting_total_usage_usd": starting_usd_raw,
        "ending_total_usage_usd": ending_usd_raw,
        "provider_reported_chapter_usage_usd": delta_usd_raw,
        "ledger_input_character_usage_usd_unrounded": (
            f"{ledger_input_usage_usd:.4f}"
        ),
        "locked_input_rate_usd_per_1000_characters": "0.10",
        "projected_chapter_cost_ceiling_usd": str(projected_chapter_cost),
        "chapter_dollar_cap_usd": packet.dollar_cap_usd,
        "chapter_dollar_cap_passed": True,
        "credit_and_input_character_meters_independent": True,
        "dollar_reconciliation_tolerance_usd": tolerance_usd,
        "observation_sources": observation_sources,
        "prebatch_baseline": {
            "used_provider_credits": 14_510,
            "remaining_provider_credits": 171_490,
            "total_provider_credits": 186_000,
            "billable_request_count": 14,
            "total_usage_usd": "2.64",
        },
        "account_credit_reconciliation_passed": (
            starting_credits - ending_credits == committed
        ),
        "usage_credit_reconciliation_passed": (
            starting_credits - ending_credits == committed
        ),
        "request_count_reconciliation_passed": (
            ending_requests - starting_requests == len(packet.requests)
        ),
        "dollar_reconciliation_passed": dollar_passed,
        "other_account_usage_observed": observation[
            "other_account_usage_observed"
        ],
        "rerender_count": 0,
        "paid_overage_used": False,
    }
    path = chapter_dir / renderer.CLOSEOUT_NAME
    renderer._validate_closeout(
        chapter_dir,
        packet=packet,
        state=state,
        starting_provider_credits=starting_credits,
        starting_billable_requests=starting_requests,
        starting_total_usage_usd=starting_usd,
        prior_closeout_sha256=prior_closeout_sha,
        raw_value=closeout,
    )
    _create_json_idempotent(path, closeout)
    verified = renderer._validate_closeout(
        chapter_dir,
        packet=packet,
        state=state,
        starting_provider_credits=starting_credits,
        starting_billable_requests=starting_requests,
        starting_total_usage_usd=starting_usd,
        prior_closeout_sha256=prior_closeout_sha,
    )
    return {
        "apply": True,
        "status": "chapter_closeout_verified",
        "chapter_id": chapter_id,
        "operator_contract": OPERATOR_CONTRACT,
        "chapter_closeout_sha256": renderer._sha256_file(path),
        "render_event_head_sha256": verified["render_event_head_sha256"],
        "key_deleted_and_verified": True,
        "network_used": False,
        "key_read": False,
    }


def run_operator(
    *,
    action: str | None = None,
    chapter_id: str | None = None,
    output_root: Path | None = None,
    observation_path: Path | None = None,
    apply: bool = False,
    verified_output_format: str | None = None,
) -> dict[str, Any]:
    if not apply:
        renderer_summary = renderer.run_renderer(chapter_id=chapter_id)
        audit = renderer_summary["independent_audit"]
        return {
            "apply": False,
            "status": (
                "dry_run_operator_ready_external_observation_and_key_required"
                if audit["valid"]
                else "dry_run_operator_blocked_renderer_audit_missing_or_invalid"
            ),
            "operator_contract": OPERATOR_CONTRACT,
            "selected_action": action,
            "independent_audit": audit,
            "key_read": False,
            "network_used": False,
            "files_written": 0,
            "renderer": renderer_summary,
        }
    if action not in {RENDER_ACTION, CLOSEOUT_ACTION}:
        raise renderer.NarrationError("apply_requires_exact_action")
    if chapter_id is None or output_root is None or observation_path is None:
        raise renderer.NarrationError("apply_requires_chapter_root_and_observation")
    root = renderer._validate_external_root(output_root)
    with _operator_sentinel(root):
        if action == RENDER_ACTION:
            return _render_apply(
                chapter_id=chapter_id,
                root=root,
                observation_path=observation_path,
                verified_output_format=verified_output_format,
            )
        if verified_output_format is not None:
            raise renderer.NarrationError("closeout_rejects_output_format_argument")
        return _closeout_apply(
            chapter_id=chapter_id,
            root=root,
            observation_path=observation_path,
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--action", choices=(RENDER_ACTION, CLOSEOUT_ACTION))
    parser.add_argument("--chapter", choices=renderer.CHAPTER_ORDER)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--observation", type=Path)
    parser.add_argument("--verified-output-format")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run_operator(
            action=args.action,
            chapter_id=args.chapter,
            output_root=args.output_root,
            observation_path=args.observation,
            apply=args.apply,
            verified_output_format=args.verified_output_format,
        )
    except renderer.NarrationError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
