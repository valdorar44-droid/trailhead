#!/usr/bin/env python3
"""Build external-only QA evidence for the 72 remaining James MP3 masters.

The builder is network-free and provider-free.  It will not produce a report
until all three immutable chapter ledgers, append-only event chains, key
closeouts, metadata files, and 72 MP3 masters exist under the exact external
render-root name.  The report is internal media-acceptance evidence only; it
does not approve listening, ingestion, validation, upload, or publication.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_UP
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from scripts.render_smokies_elevenlabs_james_auditions import (  # noqa: E402
    _mp3_frame,
    _skip_id3v2,
)
from scripts.render_smokies_elevenlabs_james_roaring_fork import (  # noqa: E402
    _probe_mono_mp3,
)


PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
EXPECTED_RENDER_ROOT_BASENAME = "trailhead-smokies-james-remaining-v1"
ROOT_MARKER_NAME = ".trailhead-smokies-james-remaining-root.json"
ROOT_CONTRACT = "smokies_elevenlabs_james_remaining_external_root_v1"
PROVISIONAL_CLOSEOUT_NAME = "chapter-key-deletion-provisional.json"
REPORT_FILENAME = "remaining-audio-qa-v1.json"
VOICE_ID = "EkK5I93UQWFDigLMpZcX"
VOICE_NAME = "James - Husky, Engaging and Bold"
MODEL_ID = "eleven_multilingual_v2"
OUTPUT_FORMAT_ID = "mp3_44100_128"
RENDERER_CONTRACT = "smokies_elevenlabs_james_remaining_renderer_v2"
RENDERER_PATH = REPOSITORY / "scripts/render_smokies_elevenlabs_james_remaining.py"
RENDERER_TEST_PATH = (
    REPOSITORY / "tests/test_smokies_elevenlabs_james_remaining_renderer.py"
)
OPERATOR_PATH = REPOSITORY / "scripts/operate_smokies_elevenlabs_james_remaining.py"
OPERATOR_TEST_PATH = (
    REPOSITORY / "tests/test_smokies_elevenlabs_james_remaining_operator.py"
)
RENDERER_DEPENDENCY_PATHS = (
    REPOSITORY / "scripts/build_smokies_checkpoint2_approval.py",
    REPOSITORY / "scripts/build_smokies_elevenlabs_james_postpurchase_preflight.py",
    REPOSITORY / "scripts/build_smokies_elevenlabs_james_remaining_locks.py",
    REPOSITORY / "scripts/build_smokies_postpurchase_render_continuation_approval.py",
)
CHECKPOINT2_APPROVAL_SHA256 = (
    "3cc18dad4d1b6a80f2259e58cbe50fba3804096d0c00437eca9103e626078d5c"
)
VOICE_SETTINGS = {
    "stability": 0.5,
    "similarity_boost": 0.5,
    "style": 0.1,
    "use_speaker_boost": True,
    "speed": 1.0,
}
CHAPTER_ORDER = (
    "foothills_parkway",
    "mountain_crossing",
    "little_river_cades_cove",
)
KEY_NAME_CODES = {
    "foothills_parkway": "fp",
    "mountain_crossing": "mc",
    "little_river_cades_cove": "cc",
}
EXPECTED_AGGREGATE = {
    "provider_request_count": 72,
    "base_request_count": 64,
    "direction_override_request_count": 8,
    "reserved_provider_credit_ceiling": 138_190,
    "renderer_character_cap": 138_300,
    "one_day_key_credit_quota": 145_000,
    "dollar_cap_usd": "14.50",
}
PREBATCH_BASELINE = {
    "used_provider_credits": 14_510,
    "total_provider_credits": 186_000,
    "remaining_provider_credits": 171_490,
    "billable_request_count": 14,
    "total_usage_usd": "2.64",
}
MIN_HARD_WPM = 75.0
MAX_HARD_WPM = 240.0
MIN_PREFERRED_WPM = 115.0
MAX_PREFERRED_WPM = 185.0
MIN_DURATION_FLAG_S = 2.0
MAX_DURATION_FLAG_S = 300.0
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")

LOCK_SPECS = {
    "foothills_parkway": {
        "path": REPOSITORY
        / "originals/smokies/elevenlabs_james_foothills_parkway_lock_v1.json",
        "byte_count": 33_701,
        "sha256": "eac2d636c4c26fd55fbc4ebe7b7be25882ffd51e6064703924d96d89fa71c119",
        "provider_request_count": 16,
        "base_request_count": 13,
        "direction_override_request_count": 3,
        "reserved_provider_credit_ceiling": 23_557,
        "renderer_character_cap": 23_600,
        "one_day_key_credit_quota": 25_000,
        "dollar_cap_usd": "2.50",
    },
    "mountain_crossing": {
        "path": REPOSITORY
        / "originals/smokies/elevenlabs_james_mountain_crossing_lock_v1.json",
        "byte_count": 63_724,
        "sha256": "561a8a8bf62f534d485df0ebf523d13a9defd962af136240fd46e1ca5aacec25",
        "provider_request_count": 33,
        "base_request_count": 28,
        "direction_override_request_count": 5,
        "reserved_provider_credit_ceiling": 65_938,
        "renderer_character_cap": 66_000,
        "one_day_key_credit_quota": 70_000,
        "dollar_cap_usd": "7.00",
    },
    "little_river_cades_cove": {
        "path": REPOSITORY
        / "originals/smokies/elevenlabs_james_cades_cove_lock_v1.json",
        "byte_count": 44_518,
        "sha256": "6c6fecdaa85d91f4e29cd08ea9c46f20d404dba8ed72962390b8d8d8dc5b6a04",
        "provider_request_count": 23,
        "base_request_count": 23,
        "direction_override_request_count": 0,
        "reserved_provider_credit_ceiling": 48_695,
        "renderer_character_cap": 48_700,
        "one_day_key_credit_quota": 50_000,
        "dollar_cap_usd": "5.00",
    },
}

STATIC_SOURCE_SPECS = {
    "checkpoint2_owner_approval": {
        "path": REPOSITORY
        / "originals/smokies/checkpoint2_owner_approval_v1.json",
        "byte_count": 68_453,
        "sha256": CHECKPOINT2_APPROVAL_SHA256,
    },
    "postpurchase_continuation_approval": {
        "path": REPOSITORY
        / "originals/smokies/postpurchase_render_continuation_approval_v1.json",
        "byte_count": 5_571,
        "sha256": "c7edea54c4facd3d9cc336217577bcec38b78928041e163c92b54290141f029d",
    },
    "mp3_probe": {
        "path": REPOSITORY
        / "scripts/render_smokies_elevenlabs_james_auditions.py",
        "byte_count": 43_215,
        "sha256": "3000c6c8e49a1af2e32be9c008c8ed846aaf2cc5e370dc6fda107019c393f942",
    },
    "mono_probe": {
        "path": REPOSITORY
        / "scripts/render_smokies_elevenlabs_james_roaring_fork.py",
        "byte_count": 62_697,
        "sha256": "1c508a5286e9d23955a5552ebcfc11830ab84ae41d65d7f670f097f3f9fe9ca5",
    },
}
RUNTIME_SOURCE_PATHS = {
    "green_postpurchase_preflight": REPOSITORY
    / "originals/smokies/elevenlabs_james_remaining_postpurchase_preflight_v2.json",
    "renderer_audit": REPOSITORY
    / "originals/smokies/elevenlabs_james_remaining_renderer_audit_v1.json",
}

# Conservative listening flags only.  These are not culturally supplied
# pronunciations and do not assert that automated audio is correct or wrong.
PRONUNCIATION_REVIEW_TERMS = (
    "Appalachian",
    "Cades Cove",
    "Cherokee",
    "Chilhowee",
    "Kuwohi",
    "Oconaluftee",
    "Ocoee Supergroup",
    "Pangaea",
    "Tuckaleechee",
    "Abrams",
    "metasandstone",
    "quartzite",
)


class AudioQaError(ValueError):
    """The external render evidence is absent, incomplete, or inconsistent."""


@dataclass(frozen=True)
class StrictAudioProbe:
    sha256: str
    byte_count: int
    sample_rate_hz: int
    bitrate_kbps: int
    channels: int
    frame_count: int
    duration_s: float
    id3v2_bytes: int
    id3v1_bytes: int
    frame_bytes: int
    all_bytes_accounted_for: bool


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_path(path: Path) -> str:
    try:
        return _sha256_bytes(path.read_bytes())
    except OSError as error:
        raise AudioQaError(f"evidence file unavailable: {path.name}") from error


def _canonical_sha256(value: object) -> str:
    return _sha256_bytes(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
    )


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise AudioQaError(f"JSON evidence unavailable: {path.name}") from error
    if not isinstance(value, dict):
        raise AudioQaError(f"expected JSON object: {path.name}")
    return value


def _repo_relative(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPOSITORY.resolve()).as_posix()
    except ValueError as error:
        raise AudioQaError("repository source path escaped repository") from error


def _external_relative(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError as error:
        raise AudioQaError("external evidence path escaped render root") from error


def _assert_external(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    try:
        resolved.relative_to(REPOSITORY.resolve())
    except ValueError:
        return resolved
    raise AudioQaError("render evidence and QA output must remain outside Git")


def _valid_sha(value: object) -> bool:
    return isinstance(value, str) and SHA256_RE.fullmatch(value) is not None


def _parse_utc_timestamp(value: object, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise AudioQaError(f"{label} timestamp is invalid")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        raise AudioQaError(f"{label} timestamp is invalid") from error
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise AudioQaError(f"{label} timestamp is invalid")
    return parsed.astimezone(timezone.utc)


def _reject_secret_material(value: object) -> None:
    prohibited_keys = {"api_key", "key", "secret", "key_material", "raw_key"}
    if isinstance(value, dict):
        for key, nested in value.items():
            if str(key).lower() in prohibited_keys:
                raise AudioQaError("raw provider key or secret material was serialized")
            _reject_secret_material(nested)
    elif isinstance(value, list):
        for nested in value:
            _reject_secret_material(nested)


def _checked_binding(
    path: Path, *, expected_sha256: str | None = None, expected_bytes: int | None = None
) -> dict[str, Any]:
    if not path.is_file():
        raise AudioQaError(f"required source evidence unavailable: {path.name}")
    byte_count = path.stat().st_size
    sha256 = _sha256_path(path)
    if expected_sha256 is not None and sha256 != expected_sha256:
        raise AudioQaError(f"source evidence hash drifted: {path.name}")
    if expected_bytes is not None and byte_count != expected_bytes:
        raise AudioQaError(f"source evidence size drifted: {path.name}")
    return {
        "path": _repo_relative(path),
        "byte_count": byte_count,
        "sha256": sha256,
    }


def _resolve_transcript(reference: object) -> str:
    raw = str(reference or "")
    if "#" not in raw:
        raise AudioQaError("transcript reference is invalid")
    raw_path, pointer = raw.split("#", 1)
    path = (REPOSITORY / raw_path).resolve()
    _repo_relative(path)
    value: Any = _load_json(path)
    if not pointer.startswith("/"):
        raise AudioQaError("transcript pointer is invalid")
    for token in pointer[1:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list):
            try:
                value = value[int(token)]
            except (ValueError, IndexError) as error:
                raise AudioQaError("transcript pointer is invalid") from error
        elif isinstance(value, dict) and token in value:
            value = value[token]
        else:
            raise AudioQaError("transcript pointer is invalid")
    if not isinstance(value, str) or not value.strip():
        raise AudioQaError("transcript value is invalid")
    return value


def _strict_mp3_probe(content: bytes) -> StrictAudioProbe:
    try:
        base = _probe_mono_mp3(content)
        id3v2_bytes = _skip_id3v2(content)
    except Exception as error:
        raise AudioQaError("MP3 structure is invalid") from error
    if id3v2_bytes >= len(content):
        raise AudioQaError("MP3 contains no complete audio frames")
    cursor = id3v2_bytes
    frame_bytes = 0
    frame_count = 0
    while cursor < len(content):
        if content[cursor : cursor + 3] == b"TAG":
            if len(content) - cursor != 128:
                raise AudioQaError("MP3 ID3v1 tail is incomplete")
            break
        if cursor + 4 > len(content):
            raise AudioQaError("MP3 final frame header is incomplete")
        try:
            frame_length, sample_rate, bitrate = _mp3_frame(
                content[cursor : cursor + 4]
            )
        except Exception as error:
            raise AudioQaError("MP3 has unaccounted non-frame bytes") from error
        if sample_rate != 44_100 or bitrate != 128:
            raise AudioQaError("MP3 format drifted")
        if ((content[cursor + 3] >> 6) & 0x03) != 0x03:
            raise AudioQaError("MP3 channel mode is not mono")
        if cursor + frame_length > len(content):
            raise AudioQaError("MP3 final frame is truncated")
        cursor += frame_length
        frame_bytes += frame_length
        frame_count += 1
    id3v1_bytes = 128 if cursor < len(content) else 0
    accounted = id3v2_bytes + frame_bytes + id3v1_bytes
    if accounted != len(content) or frame_count != base.frame_count:
        raise AudioQaError("MP3 frame completeness reconciliation failed")
    if any(
        (
            base.sha256 != _sha256_bytes(content),
            base.byte_count != len(content),
            base.sample_rate_hz != 44_100,
            base.bitrate_kbps != 128,
        )
    ):
        raise AudioQaError("MP3 probe identity drifted")
    return StrictAudioProbe(
        sha256=base.sha256,
        byte_count=base.byte_count,
        sample_rate_hz=base.sample_rate_hz,
        bitrate_kbps=base.bitrate_kbps,
        channels=1,
        frame_count=frame_count,
        duration_s=base.duration_s,
        id3v2_bytes=id3v2_bytes,
        id3v1_bytes=id3v1_bytes,
        frame_bytes=frame_bytes,
        all_bytes_accounted_for=True,
    )


def _projected_cost(character_cost: int) -> Decimal:
    return (
        Decimal(character_cost) / Decimal(1000) * Decimal("0.10")
    ).quantize(Decimal("0.01"), rounding=ROUND_UP)


def _load_checked_sources() -> tuple[
    dict[str, dict[str, Any]], dict[str, dict[str, Any]], dict[str, Any]
]:
    bindings: dict[str, dict[str, Any]] = {}
    locks: dict[str, dict[str, Any]] = {}
    all_request_ids: set[str] = set()
    total_base = 0
    total_overrides = 0
    total_requests = 0
    total_reserved = 0
    total_cap = 0
    total_key_quota = 0
    for chapter_id in CHAPTER_ORDER:
        spec = LOCK_SPECS[chapter_id]
        path = spec["path"]
        bindings[f"{chapter_id}_lock"] = _checked_binding(
            path,
            expected_sha256=str(spec["sha256"]),
            expected_bytes=int(spec["byte_count"]),
        )
        lock = _load_json(path)
        requests = lock.get("requests")
        budget = lock.get("budget")
        aggregate = lock.get("aggregate")
        profile = lock.get("generation_profile")
        output = profile.get("output") if isinstance(profile, dict) else None
        if any(
            (
                lock.get("product_id") != PRODUCT_ID,
                lock.get("chapter_id") != chapter_id,
                not isinstance(requests, list),
                len(requests) != spec["provider_request_count"],
                not isinstance(budget, dict),
                not isinstance(aggregate, dict),
                not isinstance(profile, dict),
                not isinstance(output, dict),
                profile.get("voice_id") != VOICE_ID,
                profile.get("voice_name") != VOICE_NAME,
                profile.get("model_id") != MODEL_ID,
                profile.get("voice_settings") != VOICE_SETTINGS,
                output.get("format_id") != OUTPUT_FORMAT_ID,
                output.get("sample_rate_hz") != 44_100,
                output.get("bitrate_kbps") != 128,
                output.get("channels") != 1,
                budget.get("reserved_provider_credit_ceiling")
                != spec["reserved_provider_credit_ceiling"],
                budget.get("renderer_character_cap")
                != spec["renderer_character_cap"],
                budget.get("proposed_one_day_api_key_credit_quota")
                != spec["one_day_key_credit_quota"],
                budget.get("dollar_cap_usd") != spec["dollar_cap_usd"],
                budget.get("cross_chapter_borrowing_allowed") is not False,
                budget.get("unused_budget_transfer_allowed") is not False,
                budget.get("rerender_budget") != 0,
                budget.get("paid_overage_authorized") is not False,
                aggregate.get("provider_request_count")
                != spec["provider_request_count"],
                aggregate.get("base_entry_count") != spec["base_request_count"],
                aggregate.get("directional_override_count")
                != spec["direction_override_request_count"],
            )
        ):
            raise AudioQaError(f"locked chapter contract drifted: {chapter_id}")
        request_ids = [str(row.get("provider_request_id") or "") for row in requests]
        if len(set(request_ids)) != len(request_ids) or any(
            not value for value in request_ids
        ):
            raise AudioQaError(f"locked request identity drifted: {chapter_id}")
        if all_request_ids.intersection(request_ids):
            raise AudioQaError("provider request IDs are duplicated across chapters")
        all_request_ids.update(request_ids)
        _validate_direction_map(lock, requests)
        locks[chapter_id] = lock
        total_requests += int(spec["provider_request_count"])
        total_base += int(spec["base_request_count"])
        total_overrides += int(spec["direction_override_request_count"])
        total_reserved += int(spec["reserved_provider_credit_ceiling"])
        total_cap += int(spec["renderer_character_cap"])
        total_key_quota += int(spec["one_day_key_credit_quota"])

    for name, spec in STATIC_SOURCE_SPECS.items():
        bindings[name] = _checked_binding(
            spec["path"],
            expected_sha256=str(spec["sha256"]),
            expected_bytes=int(spec["byte_count"]),
        )
    runtime: dict[str, Any] = {}
    for name, path in RUNTIME_SOURCE_PATHS.items():
        bindings[name] = _checked_binding(path)
        runtime[name] = _load_json(path)
    _validate_runtime_sources(runtime)

    if {
        "provider_request_count": total_requests,
        "base_request_count": total_base,
        "direction_override_request_count": total_overrides,
        "reserved_provider_credit_ceiling": total_reserved,
        "renderer_character_cap": total_cap,
        "one_day_key_credit_quota": total_key_quota,
        "dollar_cap_usd": "14.50",
    } != EXPECTED_AGGREGATE:
        raise AudioQaError("aggregate locked budget drifted")
    return bindings, locks, runtime


def _validate_direction_map(lock: Mapping[str, Any], requests: Sequence[Any]) -> None:
    by_id = {
        str(row.get("provider_request_id")): row
        for row in requests
        if isinstance(row, dict)
    }
    direction = lock.get("direction_delivery")
    variants = direction.get("variants") if isinstance(direction, dict) else None
    reviewed = direction.get("reviewed_variant_ids") if isinstance(direction, dict) else None
    if not isinstance(variants, list) or not isinstance(reviewed, list):
        raise AudioQaError("direction delivery map is unavailable")
    if [row.get("variant_id") for row in variants if isinstance(row, dict)] != reviewed:
        raise AudioQaError("reviewed direction order drifted")
    referenced: set[str] = set()
    for variant in variants:
        if not isinstance(variant, dict):
            raise AudioQaError("direction delivery row is invalid")
        variant_id = variant.get("variant_id")
        rows = variant.get("entry_audio_request_map")
        if not isinstance(rows, list) or len(rows) != variant.get("entry_count"):
            raise AudioQaError("direction request map inventory drifted")
        entry_ids: set[str] = set()
        for mapping in rows:
            if not isinstance(mapping, dict):
                raise AudioQaError("direction request mapping is invalid")
            request_id = mapping.get("provider_request_id")
            request = by_id.get(str(request_id))
            if request is None or request.get("entry_id") != mapping.get("entry_id"):
                raise AudioQaError("direction-to-request mapping drifted")
            if variant_id not in request.get("effective_variant_ids", []):
                raise AudioQaError("request effective direction binding drifted")
            if str(mapping.get("entry_id")) in entry_ids:
                raise AudioQaError("direction entry is duplicated")
            entry_ids.add(str(mapping.get("entry_id")))
            referenced.add(str(request_id))
    if referenced != set(by_id):
        raise AudioQaError("some locked requests are unreachable from direction maps")


def _validate_external_inventory(
    root: Path, locks: Mapping[str, Mapping[str, Any]]
) -> None:
    allowed_root = {*CHAPTER_ORDER, ROOT_MARKER_NAME, REPORT_FILENAME}
    actual_root = {path.name for path in root.iterdir()}
    if not actual_root.issubset(allowed_root) or not {
        *CHAPTER_ORDER,
        ROOT_MARKER_NAME,
    }.issubset(actual_root):
        raise AudioQaError("external render-root inventory drifted")
    marker_path = root / ROOT_MARKER_NAME
    if marker_path.is_symlink() or not marker_path.is_file():
        raise AudioQaError("external render-root marker is invalid")
    if _load_json(marker_path) != {
        "schema_version": 1,
        "root_contract": ROOT_CONTRACT,
        "renderer_contract": RENDERER_CONTRACT,
        "product_id": PRODUCT_ID,
        "output_root_sha256": _sha256_bytes(str(root).encode("utf-8")),
        "chapter_order": list(CHAPTER_ORDER),
        "contains_api_key_material": False,
    }:
        raise AudioQaError("external render-root marker drifted")
    report_path = root / REPORT_FILENAME
    if report_path.exists() and (
        report_path.is_symlink() or not report_path.is_file()
    ):
        raise AudioQaError("external QA report path is invalid")
    for chapter_id in CHAPTER_ORDER:
        chapter_dir = root / chapter_id
        if chapter_dir.is_symlink() or not chapter_dir.is_dir():
            raise AudioQaError("external chapter directory is invalid")
        expected = {"render-events.ndjson", "render-ledger.json", "chapter-closeout.json"}
        for request in locks[chapter_id]["requests"]:
            prefix = f"{int(request['stable_order']):02d}-{request['provider_request_id']}"
            expected.update({f"{prefix}.mp3", f"{prefix}.json"})
        actual = {path.name for path in chapter_dir.iterdir()}
        if actual not in (expected, {*expected, PROVISIONAL_CLOSEOUT_NAME}):
            raise AudioQaError(f"external chapter inventory drifted: {chapter_id}")
        if any(path.is_symlink() or not path.is_file() for path in chapter_dir.iterdir()):
            raise AudioQaError(f"external chapter contains a non-regular file: {chapter_id}")


def _validate_runtime_sources(runtime: Mapping[str, Any]) -> None:
    preflight = runtime.get("green_postpurchase_preflight", {})
    decision = preflight.get("decision") if isinstance(preflight, dict) else None
    authorization = preflight.get("authorization") if isinstance(preflight, dict) else None
    account = (
        preflight.get("account_and_credit_gate")
        if isinstance(preflight, dict)
        else None
    )
    provider = (
        preflight.get("provider_contract_gate")
        if isinstance(preflight, dict)
        else None
    )
    terms = preflight.get("terms_gate") if isinstance(preflight, dict) else None
    policy = terms.get("policy_tuple") if isinstance(terms, dict) else None
    usage = (
        preflight.get("provider_usage_baseline")
        if isinstance(preflight, dict)
        else None
    )
    chapter_envelopes = (
        preflight.get("chapter_envelopes")
        if isinstance(preflight, dict)
        else None
    )
    expected_chapter_envelopes = [
        {
            "chapter_id": chapter_id,
            "dollar_cap_usd": LOCK_SPECS[chapter_id]["dollar_cap_usd"],
            "one_day_key_credit_quota": LOCK_SPECS[chapter_id][
                "one_day_key_credit_quota"
            ],
            "provider_request_count": LOCK_SPECS[chapter_id][
                "provider_request_count"
            ],
            "renderer_character_cap": LOCK_SPECS[chapter_id][
                "renderer_character_cap"
            ],
            "reserved_provider_credit_ceiling": LOCK_SPECS[chapter_id][
                "reserved_provider_credit_ceiling"
            ],
            "source_lock": {
                "path": _repo_relative(LOCK_SPECS[chapter_id]["path"]),
                "byte_count": LOCK_SPECS[chapter_id]["byte_count"],
                "sha256": LOCK_SPECS[chapter_id]["sha256"],
            },
        }
        for chapter_id in CHAPTER_ORDER
    ]
    if any(
        (
            preflight.get("schema_version") != 2,
            preflight.get("product_id") != PRODUCT_ID,
            preflight.get("status")
            != "fresh_provider_preflight_green_renderer_code_audit_required",
            not isinstance(decision, dict),
            decision.get("fresh_provider_preflight_go") is not True,
            decision.get("credit_gate_passed") is not True,
            decision.get("all_non_credit_gates_passed") is not True,
            decision.get("live_apply_go") is not False,
            not isinstance(authorization, dict),
            authorization.get("checkpoint2_owner_render_and_spend_authorized")
            is not True,
            authorization.get("fresh_preflight_passed") is not True,
            authorization.get("paid_usage_overage_authorized") is not False,
            authorization.get("rerender_authorized") is not False,
            account
            != {
                "auto_top_up_enabled": False,
                "available_provider_credits": 171_490,
                "full_batch_key_quota_ceiling": 145_000,
                "full_batch_renderer_character_cap": 138_300,
                "full_batch_reserved_provider_credit_ceiling": 138_190,
                "headroom_above_key_quotas": 26_490,
                "headroom_above_renderer_caps": 33_190,
                "headroom_above_reservations": 33_300,
                "paid_usage_overage_authorized": False,
                "point_in_time_only": True,
                "prepaid_top_up_balance_usd": "10.00",
                "total_provider_credits": 186_000,
                "used_provider_credits": 14_510,
            },
            provider
            != {
                "beta_services_used_or_planned": False,
                "explicit_request_body_settings_required": True,
                "model_id": MODEL_ID,
                "output_format_id": OUTPUT_FORMAT_ID,
                "production_non_beta_contract_required": True,
                "stored_provider_defaults_relied_on": False,
                "voice_id": VOICE_ID,
                "voice_name": VOICE_NAME,
                "voice_settings": VOICE_SETTINGS,
            },
            not isinstance(terms, dict),
            isinstance(terms, dict)
            and any(
                (
                    terms.get("jurisdiction") != "non_eea",
                    terms.get("commercial_use_eligible") is not True,
                    terms.get("point_in_time_only") is not True,
                )
            ),
            not isinstance(policy, dict),
            isinstance(policy, dict)
            and {
                name: value.get("terms_id") if isinstance(value, dict) else None
                for name, value in policy.items()
            }
            != {
                "primary_terms": "elevenlabs_terms_of_service_non_eea_2026-03-31",
                "voice_library_addendum": (
                    "elevenlabs_voice_library_addendum_2026-03-06"
                ),
                "prohibited_use_policy": (
                    "elevenlabs_prohibited_use_policy_2025-09-03"
                ),
                "beta_services_addendum": (
                    "elevenlabs_beta_services_addendum_2024-11-13"
                ),
            },
            not isinstance(usage, dict),
            isinstance(usage, dict)
            and any(
                (
                    usage.get("billable_request_count") != 14,
                    usage.get("total_usage_usd") != "2.64",
                    usage.get("usage_surface")
                    != "signed_in_usage_analytics_ui",
                )
            ),
            chapter_envelopes != expected_chapter_envelopes,
        )
    ):
        raise AudioQaError("green post-purchase preflight is invalid")
    audit = runtime.get("renderer_audit", {})
    expected_audit_fields = {
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
    dependencies = audit.get("dependency_sha256") if isinstance(audit, dict) else None
    if any(
        (
            not isinstance(audit, dict),
            isinstance(audit, dict) and set(audit) != expected_audit_fields,
            audit.get("schema_version") != 1,
            audit.get("renderer_contract") != RENDERER_CONTRACT,
            audit.get("renderer_sha256") != _sha256_path(RENDERER_PATH),
            audit.get("test_sha256") != _sha256_path(RENDERER_TEST_PATH),
            audit.get("operator_sha256") != _sha256_path(OPERATOR_PATH),
            audit.get("operator_test_sha256") != _sha256_path(OPERATOR_TEST_PATH),
            audit.get("green_preflight_sha256")
            != _sha256_path(RUNTIME_SOURCE_PATHS["green_postpurchase_preflight"]),
            audit.get("checkpoint2_owner_approval_sha256")
            != CHECKPOINT2_APPROVAL_SHA256,
            audit.get("postpurchase_continuation_approval_sha256")
            != STATIC_SOURCE_SPECS["postpurchase_continuation_approval"]["sha256"],
            audit.get("independent_audit_passed") is not True,
            audit.get("p0_findings") != 0,
            audit.get("p1_findings") != 0,
            audit.get("dry_run_default_verified") is not True,
            audit.get("provider_calls_performed_by_audit") != 0,
            audit.get("author_source_files_edited_by_auditor") != 0,
            audit.get("audit_artifact_created_by_auditor") is not True,
            not isinstance(audit.get("audit_id"), str),
            not isinstance(audit.get("audited_at"), str),
            not isinstance(dependencies, dict),
            isinstance(dependencies, dict) and not dependencies,
        )
    ):
        raise AudioQaError("independent renderer audit is invalid")
    assert isinstance(dependencies, dict)
    checked_dependencies: dict[str, str] = {}
    for relative, claimed_sha in dependencies.items():
        if not isinstance(relative, str) or Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise AudioQaError("renderer audit dependency path is invalid")
        dependency_path = (REPOSITORY / relative).resolve()
        try:
            dependency_path.relative_to(REPOSITORY.resolve())
        except ValueError as error:
            raise AudioQaError("renderer audit dependency escaped the repository") from error
        actual_sha = _sha256_path(dependency_path)
        if claimed_sha != actual_sha:
            raise AudioQaError("renderer audit dependency hash drifted")
        checked_dependencies[relative] = actual_sha
    expected_dependencies = {
        _repo_relative(path): _sha256_path(path)
        for path in RENDERER_DEPENDENCY_PATHS
    }
    if (
        dependencies != dict(sorted(checked_dependencies.items()))
        or dependencies != expected_dependencies
    ):
        raise AudioQaError("renderer audit dependency set is not canonical")


def _parse_events(path: Path) -> tuple[list[dict[str, Any]], str]:
    if not path.is_file():
        raise AudioQaError("append-only render event log is unavailable")
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise AudioQaError("append-only render event log is unreadable") from error
    if not lines or any(not line.strip() for line in lines):
        raise AudioQaError("append-only render event log is incomplete")
    events: list[dict[str, Any]] = []
    prior = "0" * 64
    prior_at: str | None = None
    seen: set[str] = set()
    for sequence, line in enumerate(lines, start=1):
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise AudioQaError("append-only render event is invalid JSON") from error
        if not isinstance(event, dict) or set(event) != {
            "seq",
            "event_type",
            "at",
            "provider_request_id",
            "payload",
            "previous_event_sha256",
            "event_sha256",
        }:
            raise AudioQaError("render event schema drifted")
        if event.get("seq") != sequence:
            raise AudioQaError("render event sequence drifted")
        claimed = event.get("event_sha256")
        previous = event.get("previous_event_sha256")
        if not _valid_sha(claimed) or claimed in seen:
            raise AudioQaError("render event hash is invalid or duplicated")
        if previous != prior:
            raise AudioQaError("render event hash chain is broken")
        at = event.get("at")
        if not isinstance(at, str) or not at.endswith("Z"):
            raise AudioQaError("render event timestamp is invalid")
        if prior_at is not None and at < prior_at:
            raise AudioQaError("render event timestamp regressed")
        prior_at = at
        if not isinstance(event.get("payload"), dict):
            raise AudioQaError("render event payload is invalid")
        payload = dict(event)
        payload.pop("event_sha256", None)
        if _canonical_sha256(payload) != claimed:
            raise AudioQaError("render event hash does not bind its payload")
        event_type = str(event.get("event_type") or "")
        if any(term in event_type for term in ("rerender", "ambiguous", "duplicate")):
            raise AudioQaError("render event contains a prohibited disposition")
        if "retry" in event_type:
            raise AudioQaError("render event contains a retry requiring review")
        seen.add(str(claimed))
        prior = str(claimed)
        events.append(event)
    return events, prior


def _pronunciation_terms(transcript: str) -> list[str]:
    matches = []
    for term in PRONUNCIATION_REVIEW_TERMS:
        if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", transcript, re.IGNORECASE):
            matches.append(term)
    return matches


def _audio_inventory_hash(rows: Sequence[Mapping[str, Any]]) -> str:
    return _canonical_sha256(
        [
            {
                "provider_request_id": row["provider_request_id"],
                "raw_transcript_sha256": row["raw_transcript_sha256"],
                "master_file": Path(str(row["master_file"])).name,
                "metadata_file": Path(str(row["metadata_file"])).name,
                "audio_sha256": row["audio_sha256"],
                "audio_bytes": row["audio_bytes"],
                "duration_s": row["duration_s"],
                "words_per_minute": row["words_per_minute"],
                "character_cost": row["provider_character_cost"],
            }
            for row in rows
        ]
    )


def _request_inventory_hash(requests: Sequence[Mapping[str, Any]]) -> str:
    return _canonical_sha256(
        [
            {
                "provider_request_id": request["provider_request_id"],
                "stable_order": request["stable_order"],
                "entry_id": request["entry_id"],
                "request_kind": request["request_kind"],
                "base_variant_id": request["base_variant_id"],
                "override_variant_id": request["override_variant_id"],
                "effective_variant_ids": request["effective_variant_ids"],
                "raw_transcript_sha256": request["raw_transcript_sha256"],
                "normalized_transcript_sha256": request[
                    "normalized_transcript_sha256"
                ],
                "word_count": request["word_count"],
                "payload_character_count": request["payload_character_count"],
                "normalized_character_count": request[
                    "normalized_character_count"
                ],
                "reserved_provider_credit_ceiling": request[
                    "reserved_provider_credit_ceiling"
                ],
            }
            for request in requests
        ]
    )


def _request_event_pairs(
    events: Sequence[Mapping[str, Any]], expected_ids: set[str]
) -> dict[str, tuple[Mapping[str, Any], Mapping[str, Any]]]:
    allowed_types = {
        "ledger_initialized",
        "execution_session_started",
        "provider_preflight_passed",
        "request_reserved",
        "request_dispatched",
        "audio_accepted",
        "request_completed",
        "chapter_render_complete",
    }
    if any(event.get("event_type") not in allowed_types for event in events):
        raise AudioQaError("render event disposition is not zero-retry safe")
    if (
        events[0].get("event_type") != "ledger_initialized"
        or events[0].get("provider_request_id") is not None
        or events[-1].get("event_type") != "chapter_render_complete"
        or events[-1].get("provider_request_id") is not None
    ):
        raise AudioQaError("render event lifecycle boundary drifted")
    per_request: dict[str, dict[str, list[Mapping[str, Any]]]] = {
        request_id: {
            "request_reserved": [],
            "request_dispatched": [],
            "audio_accepted": [],
            "request_completed": [],
        }
        for request_id in expected_ids
    }
    for event in events:
        event_type = str(event["event_type"])
        if event_type not in per_request[next(iter(per_request))]:
            continue
        request_id = str(event.get("provider_request_id") or "")
        if request_id not in per_request:
            raise AudioQaError("render event references an unknown request")
        per_request[request_id][event_type].append(event)
    pairs: dict[str, tuple[Mapping[str, Any], Mapping[str, Any]]] = {}
    for request_id, grouped in per_request.items():
        if any(len(grouped[event_type]) != 1 for event_type in grouped):
            raise AudioQaError(f"request lifecycle was retried or duplicated: {request_id}")
        reserved = grouped["request_reserved"][0]
        dispatched = grouped["request_dispatched"][0]
        accepted = grouped["audio_accepted"][0]
        completed = grouped["request_completed"][0]
        if not (
            int(reserved["seq"])
            < int(dispatched["seq"])
            < int(accepted["seq"])
            < int(completed["seq"])
        ):
            raise AudioQaError(f"request lifecycle order drifted: {request_id}")
        dispatched_payload = dispatched["payload"]
        accepted_payload = accepted["payload"]
        completed_payload = completed["payload"]
        if any(
            (
                set(reserved["payload"]) != {"request_fingerprint"},
                set(dispatched_payload)
                != {"attempt", "evidence_sha256", "request_fingerprint"},
                set(completed_payload)
                != {"accepted_event_sha256", "master_file", "metadata_file"},
                dispatched_payload.get("attempt") != 1,
                accepted_payload.get("attempt") != 1,
                reserved["payload"].get("request_fingerprint")
                != dispatched_payload.get("request_fingerprint"),
                dispatched_payload.get("request_fingerprint")
                != accepted_payload.get("request_fingerprint"),
                not _valid_sha(dispatched_payload.get("evidence_sha256")),
                completed_payload.get("accepted_event_sha256")
                != accepted.get("event_sha256"),
            )
        ):
            raise AudioQaError(f"request lifecycle binding drifted: {request_id}")
        pairs[request_id] = (accepted, completed)
    return pairs


def _validate_chapter_event_identity(
    *,
    chapter_id: str,
    lock: Mapping[str, Any],
    events: Sequence[Mapping[str, Any]],
    render_root: Path,
    continuation_sha256: str,
    preflight_sha256: str,
    audit_sha256: str,
    dependency_sha256: Mapping[str, str],
) -> None:
    spec = LOCK_SPECS[chapter_id]
    requests = lock["requests"]
    expected_initial = {
        "renderer_contract": RENDERER_CONTRACT,
        "chapter_id": chapter_id,
        "lock_id": lock["lock_id"],
        "lock_sha256": spec["sha256"],
        "checkpoint2_owner_approval_sha256": CHECKPOINT2_APPROVAL_SHA256,
        "postpurchase_continuation_approval_sha256": continuation_sha256,
        "green_preflight_sha256": preflight_sha256,
        "renderer_audit_sha256": audit_sha256,
        "operator_sha256": _sha256_path(OPERATOR_PATH),
        "operator_test_sha256": _sha256_path(OPERATOR_TEST_PATH),
        "dependency_sha256": dict(dependency_sha256),
        "output_root_sha256": _sha256_bytes(str(render_root).encode("utf-8")),
        "provider": "elevenlabs",
        "voice_id": VOICE_ID,
        "model_id": MODEL_ID,
        "language_code": "en",
        "output_format_id": OUTPUT_FORMAT_ID,
        "request_count": len(requests),
        "request_inventory_sha256": _request_inventory_hash(requests),
        "caps": {
            "renderer_characters": spec["renderer_character_cap"],
            "api_key_credits": spec["one_day_key_credit_quota"],
            "reserved_provider_credits": spec[
                "reserved_provider_credit_ceiling"
            ],
            "dollars_usd": spec["dollar_cap_usd"],
            "rerenders": 0,
            "cross_chapter_borrowing": False,
            "paid_overage": False,
        },
        "provider_usage_baseline": PREBATCH_BASELINE,
    }
    if events[0].get("payload") != expected_initial:
        raise AudioQaError(f"render initialization binding drifted: {chapter_id}")
    complete_payload = events[-1].get("payload")
    if not isinstance(complete_payload, dict) or any(
        (
            complete_payload.get("provider_request_count") != len(requests),
            complete_payload.get("rerender_count") != 0,
            complete_payload.get("status")
            != "render_complete_pending_key_deletion_closeout",
        )
    ):
        raise AudioQaError(f"chapter completion event drifted: {chapter_id}")


def _validate_session_preflight_contract(
    *,
    chapter_id: str,
    sessions: object,
    preflights: object,
) -> None:
    if (
        not isinstance(sessions, list)
        or not sessions
        or not isinstance(preflights, list)
        or len(preflights) != len(sessions)
    ):
        raise AudioQaError(f"provider session/preflight inventory drifted: {chapter_id}")
    initial_remaining_cap = sum(
        int(LOCK_SPECS[value]["renderer_character_cap"])
        for value in CHAPTER_ORDER[CHAPTER_ORDER.index(chapter_id) :]
    )
    key_id_sha256: str | None = None
    key_material_sha256: str | None = None
    prior_credits: int | None = None
    for index, (session, preflight) in enumerate(zip(sessions, preflights, strict=True)):
        if not isinstance(session, dict) or set(session) != {
            "available_credits",
            "continuation",
            "continuation_mode",
            "evidence_sha256",
            "key_credit_limit",
            "key_created_at_derived",
            "key_created_at_derivation",
            "key_created_at_directly_observed",
            "key_expires_at",
            "key_id_sha256",
            "key_material_sha256",
            "key_session_number",
            "provider_key_name_sha256",
            "provider_key_matching_row_count",
            "provider_key_row_unique",
            "key_preview_sha256",
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
            "provider_key_expires_at_unix",
            "remaining_batch_renderer_cap",
            "replacement_key_creation_initiated_at",
            "requested_ttl_seconds",
            "expiry_directly_observed",
        }:
            raise AudioQaError(f"provider execution session drifted: {chapter_id}")
        available = session.get("available_credits")
        if any(
            (
                isinstance(available, bool) or not isinstance(available, int),
                session.get("continuation") is not (index > 0),
                not _valid_sha(session.get("evidence_sha256")),
                not _valid_sha(session.get("key_id_sha256")),
                not _valid_sha(session.get("key_material_sha256")),
                not _valid_sha(session.get("provider_key_name_sha256")),
                not _valid_sha(session.get("key_preview_sha256")),
                not isinstance(session.get("observed_at"), str),
                not isinstance(session.get("key_expires_at"), str),
                prior_credits is not None
                and isinstance(available, int)
                and available > prior_credits,
                isinstance(session.get("observed_billable_request_count"), bool),
                not isinstance(session.get("observed_billable_request_count"), int),
                re.fullmatch(
                    r"\d+\.\d{2}",
                    str(session.get("observed_total_usage_usd")),
                )
                is None,
                any(
                    isinstance(session.get(name), bool)
                    or not isinstance(session.get(name), int)
                    or int(session.get(name)) < 0
                    for name in (
                        "key_credit_limit",
                        "key_session_number",
                        "provider_key_expires_at_unix",
                        "requested_ttl_seconds",
                        "ledger_character_cost_total_at_start",
                        "ledger_request_count_at_start",
                        "partial_usage_credits_since_prior_session",
                        "partial_billable_requests_since_prior_session",
                        "remaining_batch_renderer_cap",
                    )
                ),
                session.get("requested_ttl_seconds") != 86_400,
                session.get("key_session_number") != index + 1,
                session.get("provider_key_name_sha256")
                != _sha256_bytes(
                    (
                        "trailhead-smokies-james-"
                        f"{KEY_NAME_CODES[chapter_id]}-session-{index + 1}"
                    ).encode("utf-8")
                ),
                session.get("provider_key_matching_row_count") != 1,
                session.get("provider_key_row_unique") is not True,
                session.get("key_created_at_directly_observed") is not False,
                session.get("key_created_at_derivation")
                != (
                    "provider_get_expires_at_unix_minus_official_ui_"
                    "requested_ttl_seconds"
                ),
                session.get("expiry_directly_observed") is not True,
            )
        ):
            raise AudioQaError(f"provider execution session drifted: {chapter_id}")
        expected_remaining_cap = initial_remaining_cap - int(
            session["ledger_character_cost_total_at_start"]
        )
        if any(
            (
                expected_remaining_cap <= 0,
                session.get("remaining_batch_renderer_cap")
                != expected_remaining_cap,
                int(available) < expected_remaining_cap,
            )
        ):
            raise AudioQaError(
                f"provider residual exposure drifted: {chapter_id}"
            )
        try:
            expires_at = datetime.fromtimestamp(
                int(session["provider_key_expires_at_unix"]), tz=timezone.utc
            )
        except (OSError, OverflowError, ValueError) as error:
            raise AudioQaError(
                f"provider key expiry evidence drifted: {chapter_id}"
            ) from error
        observed_at = _parse_utc_timestamp(
            session["observed_at"], "provider session observation"
        )
        derived_created_at = expires_at - timedelta(seconds=86_400)
        if any(
            (
                session.get("key_expires_at")
                != expires_at.isoformat().replace("+00:00", "Z"),
                session.get("key_created_at_derived")
                != derived_created_at.isoformat().replace("+00:00", "Z"),
                observed_at - derived_created_at > timedelta(minutes=15),
                derived_created_at - observed_at > timedelta(minutes=2),
            )
        ):
            raise AudioQaError(f"provider key expiry evidence drifted: {chapter_id}")
        if index == 0:
            key_id_sha256 = str(session["key_id_sha256"])
            key_material_sha256 = str(session["key_material_sha256"])
            if any(
                (
                    session.get("continuation_mode") != "initial",
                    session.get("key_credit_limit")
                    != LOCK_SPECS[chapter_id]["one_day_key_credit_quota"],
                    session.get("ledger_character_cost_total_at_start") != 0,
                    session.get("ledger_request_count_at_start") != 0,
                    session.get("partial_usage_credits_since_prior_session") != 0,
                    session.get("partial_billable_requests_since_prior_session")
                    != 0,
                    session.get("prior_key_id_sha256") is not None,
                    session.get("prior_key_deleted_and_verified") is not False,
                    session.get("prior_key_deleted_at") is not None,
                    session.get("replacement_key_creation_initiated_at")
                    is not None,
                )
            ):
                raise AudioQaError(f"initial provider session drifted: {chapter_id}")
        else:
            prior = sessions[index - 1]
            partial_credits = session.get("partial_usage_credits_since_prior_session")
            partial_requests = session.get(
                "partial_billable_requests_since_prior_session"
            )
            prior_deleted_at = _parse_utc_timestamp(
                session.get("prior_key_deleted_at"), "prior key deletion"
            )
            replacement_initiated_at = _parse_utc_timestamp(
                session.get("replacement_key_creation_initiated_at"),
                "replacement key creation",
            )
            try:
                observed_usd_delta = Decimal(
                    str(session["observed_total_usage_usd"])
                ) - Decimal(str(prior["observed_total_usage_usd"]))
            except InvalidOperation as error:
                raise AudioQaError(
                    f"provider recovery dollar evidence drifted: {chapter_id}"
                ) from error
            if any(
                (
                    session.get("continuation_mode")
                    != "recovery_only_replacement_key",
                    session.get("prior_key_id_sha256")
                    != prior.get("key_id_sha256"),
                    session.get("prior_key_deleted_and_verified") is not True,
                    not isinstance(session.get("prior_key_deleted_at"), str),
                    session.get("key_id_sha256") == prior.get("key_id_sha256"),
                    session.get("key_material_sha256")
                    == prior.get("key_material_sha256"),
                    session.get("key_credit_limit")
                    != LOCK_SPECS[chapter_id]["renderer_character_cap"]
                    - session.get("ledger_character_cost_total_at_start"),
                    replacement_initiated_at < prior_deleted_at,
                    replacement_initiated_at > observed_at,
                    not isinstance(partial_credits, int),
                    not isinstance(partial_requests, int),
                    isinstance(partial_credits, bool),
                    isinstance(partial_requests, bool),
                    isinstance(partial_credits, int)
                    and session.get("ledger_character_cost_total_at_start")
                    - prior.get("ledger_character_cost_total_at_start", 0)
                    != partial_credits,
                    isinstance(partial_requests, int)
                    and session.get("ledger_request_count_at_start")
                    - prior.get("ledger_request_count_at_start", 0)
                    != partial_requests,
                    isinstance(partial_credits, int)
                    and prior.get("available_credits") - available
                    != partial_credits,
                    isinstance(partial_requests, int)
                    and session.get("observed_billable_request_count")
                    - prior.get("observed_billable_request_count", 0)
                    != partial_requests,
                    abs(
                        observed_usd_delta
                        - Decimal(int(partial_credits or 0)) / Decimal(10_000)
                    )
                    > Decimal("0.01"),
                )
            ):
                raise AudioQaError(f"provider recovery session drifted: {chapter_id}")
            key_id_sha256 = str(session["key_id_sha256"])
            key_material_sha256 = str(session["key_material_sha256"])
        if not isinstance(preflight, dict) or set(preflight) != {
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
        }:
            raise AudioQaError(f"provider live preflight drifted: {chapter_id}")
        if any(
            (
                preflight.get("evidence_sha256") != session.get("evidence_sha256"),
                not _valid_sha(preflight.get("metadata_sha256")),
                not _valid_sha(preflight.get("settings_sha256")),
                not _valid_sha(preflight.get("subscription_sha256")),
                preflight.get("subscription_remaining_credits") != available,
                preflight.get("model_id") != MODEL_ID,
                preflight.get("language_code") != "en",
                preflight.get("output_format_id") != OUTPUT_FORMAT_ID,
                preflight.get("request_voice_settings") != VOICE_SETTINGS,
                preflight.get("stored_voice_settings_relied_on") is not False,
                preflight.get("beta_services_used") is not False,
                preflight.get("custom_credit_multiplier")
                not in {"1", "not_reported"},
                preflight.get("sharing_status") != "copied",
                preflight.get("voice_library_rate") != "1",
                preflight.get("withdrawal_notice_period") != "730",
            )
        ):
            raise AudioQaError(f"provider live preflight drifted: {chapter_id}")
        prior_credits = int(available)


def _validate_audio_item(
    *,
    chapter_id: str,
    lock_id: str,
    request: Mapping[str, Any],
    item: Mapping[str, Any],
    accepted_event: Mapping[str, Any],
    completed_event: Mapping[str, Any],
    chapter_dir: Path,
    probe_audio: Callable[[bytes], StrictAudioProbe],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    request_id = str(request.get("provider_request_id") or "")
    transcript = _resolve_transcript(request.get("transcript_source"))
    normalized = " ".join(transcript.split())
    raw_sha = _sha256_bytes(transcript.encode("utf-8"))
    normalized_sha = _sha256_bytes(normalized.encode("utf-8"))
    expected_identity = {
        "stable_order": request.get("stable_order"),
        "entry_id": request.get("entry_id"),
        "request_kind": request.get("request_kind"),
        "base_variant_id": request.get("base_variant_id"),
        "override_variant_id": request.get("override_variant_id"),
        "effective_variant_ids": request.get("effective_variant_ids"),
        "raw_transcript_sha256": raw_sha,
        "normalized_transcript_sha256": normalized_sha,
        "word_count": request.get("word_count"),
        "payload_character_count": len(transcript),
        "normalized_character_count": len(normalized),
        "reserved_provider_credit_ceiling": request.get(
            "reserved_provider_credit_ceiling"
        ),
    }
    if set(item) != {
        *expected_identity,
        "state",
        "attempts",
        "request_fingerprint",
        "accepted",
        "completion",
    }:
        raise AudioQaError(f"ledger item schema drifted: {request_id}")
    if any(item.get(key) != value for key, value in expected_identity.items()):
        raise AudioQaError(f"ledger item identity drifted: {request_id}")
    if any(
        (
            request.get("raw_transcript_sha256") != raw_sha,
            request.get("normalized_transcript_sha256") != normalized_sha,
            request.get("payload_character_count") != len(transcript),
            request.get("normalized_character_count") != len(normalized),
            request.get("word_count") != len(normalized.split(" ")),
            item.get("state") != "completed",
        )
    ):
        raise AudioQaError(f"transcript or completion binding drifted: {request_id}")
    attempts = item.get("attempts")
    if attempts != 1:
        raise AudioQaError(f"request was retried or duplicated: {request_id}")
    if not _valid_sha(item.get("request_fingerprint")):
        raise AudioQaError(f"request fingerprint is invalid: {request_id}")

    accepted = item.get("accepted")
    completion = item.get("completion")
    if not isinstance(accepted, dict) or not isinstance(completion, dict):
        raise AudioQaError(f"request acceptance evidence is incomplete: {request_id}")
    expected_accepted = {
        **accepted_event["payload"],
        "accepted_event_sha256": accepted_event["event_sha256"],
    }
    expected_completion = {
        **completed_event["payload"],
        "completed_at": completed_event["at"],
    }
    if accepted != expected_accepted or completion != expected_completion:
        raise AudioQaError(f"request event/ledger acceptance drifted: {request_id}")
    if set(accepted) != {
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
        "accepted_event_sha256",
    } or set(completion) != {
        "accepted_event_sha256",
        "master_file",
        "metadata_file",
        "completed_at",
    }:
        raise AudioQaError(f"request acceptance schema drifted: {request_id}")
    if accepted.get("request_fingerprint") != item.get("request_fingerprint"):
        raise AudioQaError(f"request fingerprint binding drifted: {request_id}")

    expected_file = f"{int(request['stable_order']):02d}-{request_id}.mp3"
    expected_metadata = f"{int(request['stable_order']):02d}-{request_id}.json"
    if any(
        (
            completion.get("master_file") != expected_file,
            completion.get("metadata_file") != expected_metadata,
            accepted.get("stage_audio_file")
            != f".{expected_file}.accepted.pending",
            accepted.get("stage_metadata_file")
            != f".{expected_metadata}.accepted.pending",
            accepted.get("provider_request_id_sha256") is not None
            and not _valid_sha(accepted.get("provider_request_id_sha256")),
            accepted.get("provider_trace_id_sha256") is not None
            and not _valid_sha(accepted.get("provider_trace_id_sha256")),
        )
    ):
        raise AudioQaError(f"master filename drifted: {request_id}")
    audio_path = chapter_dir / expected_file
    metadata_path = chapter_dir / expected_metadata
    try:
        audio = audio_path.read_bytes()
    except OSError as error:
        raise AudioQaError(f"MP3 master unavailable: {request_id}") from error
    probe = probe_audio(audio)
    metadata = _load_json(metadata_path)
    cost = accepted.get("character_cost")
    if (
        isinstance(cost, bool)
        or not isinstance(cost, int)
        or cost <= 0
        or cost > int(request.get("reserved_provider_credit_ceiling") or 0)
    ):
        raise AudioQaError(f"provider cost is invalid: {request_id}")
    word_count = int(request.get("word_count") or 0)
    wpm = word_count / probe.duration_s * 60 if probe.duration_s > 0 else 0
    if not MIN_HARD_WPM <= wpm <= MAX_HARD_WPM:
        raise AudioQaError(f"duration/WPM is implausible: {request_id}")
    if any(
        (
            accepted.get("response_sha256") != probe.sha256,
            accepted.get("response_bytes") != probe.byte_count,
            accepted.get("content_type") != "audio/mpeg",
            accepted.get("projected_cost_usd") != str(_projected_cost(cost)),
            accepted.get("words_per_minute") != round(wpm, 3),
            not probe.all_bytes_accounted_for,
        )
    ):
        raise AudioQaError(f"MP3 ledger evidence drifted: {request_id}")
    expected_audio = {
        "bitrate_kbps": 128,
        "byte_count": probe.byte_count,
        "duration_s": round(probe.duration_s, 6),
        "frame_count": probe.frame_count,
        "sample_rate_hz": 44_100,
        "sha256": probe.sha256,
        "channels": 1,
    }
    if accepted.get("audio") != expected_audio:
        raise AudioQaError(f"MP3 accepted-audio evidence drifted: {request_id}")
    expected_metadata_value = {
        "schema_version": 2,
        "renderer_contract": RENDERER_CONTRACT,
        "chapter_id": chapter_id,
        "lock_id": lock_id,
        "lock_sha256": LOCK_SPECS[chapter_id]["sha256"],
        "provider_request_id": request_id,
        "entry_id": request.get("entry_id"),
        "request_kind": request.get("request_kind"),
        "base_variant_id": request.get("base_variant_id"),
        "override_variant_id": request.get("override_variant_id"),
        "effective_variant_ids": request.get("effective_variant_ids"),
        "raw_transcript_sha256": raw_sha,
        "normalized_transcript_sha256": normalized_sha,
        "provider": "elevenlabs",
        "voice_id": VOICE_ID,
        "voice_name": VOICE_NAME,
        "model_id": MODEL_ID,
        "language_code": "en",
        "output_format_id": OUTPUT_FORMAT_ID,
        "voice_settings": VOICE_SETTINGS,
        "request_fingerprint": accepted["request_fingerprint"],
        "character_cost": cost,
        "projected_cost_usd": str(_projected_cost(cost)),
        "content_type": "audio/mpeg",
        "response_sha256": probe.sha256,
        "response_bytes": probe.byte_count,
        "provider_request_id_sha256": accepted.get("provider_request_id_sha256"),
        "provider_trace_id_sha256": accepted.get("provider_trace_id_sha256"),
        "accepted_at": accepted.get("accepted_at"),
        "audio": expected_audio,
        "words_per_minute": round(wpm, 3),
        "provider_native_lossy_source": True,
        "lossless_or_wav_claimed": False,
        "accepted_bytes_never_regenerated": True,
    }
    if metadata != expected_metadata_value:
        raise AudioQaError(f"per-file metadata binding drifted: {request_id}")

    flags: list[dict[str, Any]] = []
    terms = _pronunciation_terms(transcript)
    if terms:
        flags.append(
            {
                "type": "pronunciation_review",
                "reason": "locked_term_occurrence_requires_owner_listening",
                "terms": terms,
            }
        )
    if probe.duration_s < MIN_DURATION_FLAG_S or probe.duration_s > MAX_DURATION_FLAG_S:
        flags.append(
            {
                "type": "duration_outlier",
                "reason": "outside_preferred_owner_review_duration",
                "duration_s": round(probe.duration_s, 6),
            }
        )
    if wpm < MIN_PREFERRED_WPM or wpm > MAX_PREFERRED_WPM:
        flags.append(
            {
                "type": "pacing_outlier",
                "reason": "outside_preferred_owner_review_wpm",
                "words_per_minute": round(wpm, 3),
            }
        )
    row = {
        "chapter_id": chapter_id,
        "stable_order": int(request["stable_order"]),
        "provider_request_id": request_id,
        "entry_id": request.get("entry_id"),
        "request_kind": request.get("request_kind"),
        "base_variant_id": request.get("base_variant_id"),
        "override_variant_id": request.get("override_variant_id"),
        "effective_variant_ids": list(request.get("effective_variant_ids") or []),
        "raw_transcript_sha256": raw_sha,
        "normalized_transcript_sha256": normalized_sha,
        "word_count": word_count,
        "master_file": f"{chapter_id}/{expected_file}",
        "metadata_file": f"{chapter_id}/{expected_metadata}",
        "audio_sha256": probe.sha256,
        "audio_bytes": probe.byte_count,
        "frame_count": probe.frame_count,
        "frame_bytes": probe.frame_bytes,
        "id3v2_bytes": probe.id3v2_bytes,
        "id3v1_bytes": probe.id3v1_bytes,
        "all_bytes_accounted_for": probe.all_bytes_accounted_for,
        "sample_rate_hz": probe.sample_rate_hz,
        "bitrate_kbps": probe.bitrate_kbps,
        "channels": probe.channels,
        "duration_s": round(probe.duration_s, 6),
        "words_per_minute": round(wpm, 3),
        "provider_character_cost": cost,
        "projected_cost_usd": str(_projected_cost(cost)),
        "request_fingerprint": item["request_fingerprint"],
        "provider_attempt_count": 1,
        "retry_count": 0,
        "rerender_count": 0,
        "ambiguous_response": False,
        "flags": flags,
    }
    return row, flags


def _validate_provisional_record(
    *,
    chapter_id: str,
    chapter_dir: Path,
    ledger_path: Path,
    event_count: int,
    event_head: str,
    audio_rows: Sequence[Mapping[str, Any]],
    closeout: Mapping[str, Any],
) -> dict[str, Any] | None:
    path = chapter_dir / PROVISIONAL_CLOSEOUT_NAME
    if not path.exists():
        return None
    raw = _load_json(path)
    _reject_secret_material(raw)
    expected_fields = {
        "schema_version",
        "record_id",
        "record_type",
        "source",
        "source_observation_sha256",
        "observed_at",
        "renderer_contract",
        "chapter_id",
        "render_event_count",
        "render_event_head_sha256",
        "render_ledger_sha256",
        "audio_inventory_sha256",
        "key_id_sha256",
        "key_material_sha256",
        "key_deleted",
        "key_deletion_verified",
        "no_other_active_render_keys",
        "ending_provider_credits",
        "ending_billable_request_count",
        "ending_total_usage_usd",
        "total_usage_usd_observation",
        "final_usage_reconciliation_complete",
        "replacement_key_authorized",
        "next_chapter_unlocked",
        "qa_eligible",
        "publication_eligible",
        "contains_key_material",
    }
    source_sha = raw.get("source_observation_sha256")
    if any(
        (
            set(raw) != expected_fields,
            raw.get("schema_version") != 1,
            not _valid_sha(source_sha),
            raw.get("record_id")
            != f"smokies_provisional_{str(source_sha or '')[:32]}",
            raw.get("record_type")
            != "key_deletion_only_provisional_not_usage_closeout",
            raw.get("source")
            != "authenticated_provider_usage_and_key_management_ui",
            raw.get("renderer_contract") != RENDERER_CONTRACT,
            raw.get("chapter_id") != chapter_id,
            raw.get("render_event_count") != event_count,
            raw.get("render_event_head_sha256") != event_head,
            raw.get("render_ledger_sha256") != _sha256_path(ledger_path),
            raw.get("audio_inventory_sha256") != _audio_inventory_hash(audio_rows),
            raw.get("key_id_sha256") != closeout.get("key_id_sha256"),
            raw.get("key_material_sha256")
            != closeout.get("key_material_sha256"),
            raw.get("key_deleted") is not True,
            raw.get("key_deletion_verified") is not True,
            raw.get("no_other_active_render_keys") is not True,
            raw.get("ending_provider_credits")
            != closeout.get("ending_provider_credits"),
            raw.get("ending_billable_request_count")
            != closeout.get("ending_billable_request_count"),
            raw.get("ending_total_usage_usd") is not None,
            raw.get("total_usage_usd_observation")
            != "unavailable_on_authenticated_surface",
            raw.get("final_usage_reconciliation_complete") is not False,
            raw.get("replacement_key_authorized") is not False,
            raw.get("next_chapter_unlocked") is not False,
            raw.get("qa_eligible") is not False,
            raw.get("publication_eligible") is not False,
            raw.get("contains_key_material") is not False,
        )
    ):
        raise AudioQaError(f"provisional key-deletion record drifted: {chapter_id}")
    return {
        "path": f"{chapter_id}/{PROVISIONAL_CLOSEOUT_NAME}",
        "sha256": _sha256_path(path),
        "byte_count": path.stat().st_size,
        "source_observation_sha256": source_sha,
        "superseded_by_final_closeout": True,
        "never_unlocked_next_chapter_or_qa": True,
    }


def _validate_closeout(
    *,
    chapter_id: str,
    closeout: Mapping[str, Any],
    closeout_path: Path,
    ledger: Mapping[str, Any],
    ledger_path: Path,
    events_path: Path,
    event_count: int,
    event_head: str,
    audio_rows: Sequence[Mapping[str, Any]],
    chapter_cost: int,
    prior_ending_credits: int | None,
    prior_ending_requests: int | None,
    prior_ending_total_usage_usd: Decimal | None,
    prior_closeout_sha256: str | None,
) -> tuple[int, int, Decimal, str, dict[str, Any]]:
    spec = LOCK_SPECS[chapter_id]
    _reject_secret_material(closeout)
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
    sessions = ledger.get("execution_sessions")
    if any(
        (
            set(closeout) != expected_fields,
            closeout.get("schema_version") != 2,
            not _valid_sha(closeout.get("source_observation_sha256")),
            closeout.get("closeout_id")
            != (
                "smokies_closeout_"
                f"{str(closeout.get('source_observation_sha256') or '')[:32]}"
            ),
            closeout.get("source")
            != "authenticated_provider_usage_and_key_management_ui",
            not isinstance(closeout.get("observed_at"), str),
            closeout.get("observed_at", "") < str(ledger.get("updated_at") or ""),
            closeout.get("renderer_contract") != RENDERER_CONTRACT,
            closeout.get("chapter_id") != chapter_id,
            closeout.get("render_event_count") != event_count,
            closeout.get("render_event_head_sha256") != event_head,
            closeout.get("render_ledger_sha256") != _sha256_path(ledger_path),
            closeout.get("audio_inventory_sha256")
            != _audio_inventory_hash(audio_rows),
            closeout.get("prior_closeout_sha256") != prior_closeout_sha256,
            closeout.get("key_id_sha256")
            != (sessions[-1] if isinstance(sessions, list) and sessions else {}).get(
                "key_id_sha256"
            ),
            closeout.get("key_material_sha256")
            != (sessions[-1] if isinstance(sessions, list) and sessions else {}).get(
                "key_material_sha256"
            ),
            not _valid_sha(closeout.get("key_id_sha256")),
            not _valid_sha(closeout.get("key_material_sha256")),
            closeout.get("key_deleted") is not True,
            closeout.get("key_deletion_verified") is not True,
            closeout.get("no_other_active_render_keys") is not True,
            closeout.get("ledger_character_cost_total") != chapter_cost,
            closeout.get("provider_reported_usage_credits") != chapter_cost,
            closeout.get("provider_reported_request_count")
            != spec["provider_request_count"],
            closeout.get("prebatch_baseline") != PREBATCH_BASELINE,
            closeout.get("observation_sources")
            != {
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
            },
            closeout.get("account_credit_reconciliation_passed") is not True,
            closeout.get("usage_credit_reconciliation_passed") is not True,
            closeout.get("request_count_reconciliation_passed") is not True,
            closeout.get("dollar_reconciliation_passed") is not True,
            closeout.get("other_account_usage_observed") is not False,
            closeout.get("rerender_count") != 0,
            closeout.get("paid_overage_used") is not False,
        )
    ):
        raise AudioQaError(f"chapter key/provider closeout drifted: {chapter_id}")
    starting = closeout.get("starting_provider_credits")
    ending = closeout.get("ending_provider_credits")
    start_requests = closeout.get("starting_billable_request_count")
    end_requests = closeout.get("ending_billable_request_count")
    if any(
        isinstance(value, bool) or not isinstance(value, int)
        for value in (starting, ending, start_requests, end_requests)
    ):
        raise AudioQaError(f"provider closeout counters are invalid: {chapter_id}")
    expected_start = (
        PREBATCH_BASELINE["remaining_provider_credits"]
        if prior_ending_credits is None
        else prior_ending_credits
    )
    expected_requests = (
        PREBATCH_BASELINE["billable_request_count"]
        if prior_ending_requests is None
        else prior_ending_requests
    )
    if any(
        (
            starting != expected_start,
            ending != starting - chapter_cost,
            start_requests != expected_requests,
            end_requests - start_requests != spec["provider_request_count"],
        )
    ):
        raise AudioQaError(f"provider usage reconciliation drifted: {chapter_id}")
    expected_start_usd = (
        Decimal(PREBATCH_BASELINE["total_usage_usd"])
        if prior_ending_total_usage_usd is None
        else prior_ending_total_usage_usd
    )
    try:
        start_usd = Decimal(str(closeout.get("starting_total_usage_usd")))
        end_usd = Decimal(str(closeout.get("ending_total_usage_usd")))
        chapter_usd = Decimal(
            str(closeout.get("provider_reported_chapter_usage_usd"))
        )
        ledger_usd = Decimal(str(closeout.get("ledger_usage_usd_unrounded")))
        tolerance_usd = Decimal(
            str(closeout.get("dollar_reconciliation_tolerance_usd"))
        )
    except InvalidOperation as error:
        raise AudioQaError(f"provider dollar closeout is invalid: {chapter_id}") from error
    exact_ledger_usd = (Decimal(chapter_cost) / Decimal(10_000)).quantize(
        Decimal("0.0001")
    )
    if any(
        (
            closeout.get("starting_total_usage_usd")
            != f"{expected_start_usd:.2f}",
            re.fullmatch(r"\d+\.\d{2}", str(closeout.get("ending_total_usage_usd")))
            is None,
            re.fullmatch(
                r"-?\d+\.\d{2}",
                str(closeout.get("provider_reported_chapter_usage_usd")),
            )
            is None,
            closeout.get("ledger_usage_usd_unrounded")
            != f"{exact_ledger_usd:.4f}",
            closeout.get("dollar_reconciliation_tolerance_usd") != "0.01",
            start_usd != expected_start_usd,
            chapter_usd != end_usd - start_usd,
            ledger_usd != exact_ledger_usd,
            tolerance_usd != Decimal("0.01"),
            abs(chapter_usd - ledger_usd) > tolerance_usd,
        )
    ):
        raise AudioQaError(f"provider dollar reconciliation drifted: {chapter_id}")
    closeout_sha256 = _sha256_path(closeout_path)
    public = {
        "chapter_id": chapter_id,
        "path": f"{chapter_id}/chapter-closeout.json",
        "sha256": closeout_sha256,
        "byte_count": closeout_path.stat().st_size,
        "render_event_count": event_count,
        "render_event_head_sha256": event_head,
        "render_ledger_sha256": _sha256_path(ledger_path),
        "source_observation_sha256": closeout["source_observation_sha256"],
        "prior_closeout_sha256": prior_closeout_sha256,
        "audio_inventory_sha256": _audio_inventory_hash(audio_rows),
        "key_id_sha256": closeout["key_id_sha256"],
        "key_deleted": True,
        "key_deletion_verified": True,
        "no_other_active_render_keys": True,
        "starting_provider_credits": starting,
        "ending_provider_credits": ending,
        "provider_reported_usage_credits": chapter_cost,
        "starting_billable_request_count": start_requests,
        "ending_billable_request_count": end_requests,
        "provider_reported_request_count": spec["provider_request_count"],
        "starting_total_usage_usd": f"{start_usd:.2f}",
        "ending_total_usage_usd": f"{end_usd:.2f}",
        "provider_reported_chapter_usage_usd": f"{chapter_usd:.2f}",
        "ledger_usage_usd_unrounded": f"{ledger_usd:.4f}",
        "dollar_reconciliation_tolerance_usd": "0.01",
        "account_credit_reconciliation_passed": True,
        "usage_credit_reconciliation_passed": True,
        "request_count_reconciliation_passed": True,
        "dollar_reconciliation_passed": True,
    }
    return int(ending), int(end_requests), end_usd, closeout_sha256, public


def _representative_listening_set(
    locks: Mapping[str, Mapping[str, Any]], rows: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    by_id = {str(row["provider_request_id"]): row for row in rows}
    reasons: dict[str, set[str]] = {}
    for chapter_id in CHAPTER_ORDER:
        lock = locks[chapter_id]
        requests = {
            str(row["provider_request_id"]): row for row in lock["requests"]
        }
        variants = lock["direction_delivery"]["variants"]
        for variant in variants:
            variant_id = str(variant["variant_id"])
            mappings = variant["entry_audio_request_map"]
            directional = [
                mapping
                for mapping in mappings
                if requests[str(mapping["provider_request_id"])]["request_kind"]
                == "directional_override"
            ]
            stories = [
                mapping
                for mapping in mappings
                if requests[str(mapping["provider_request_id"])]["content_kind"]
                == "story"
            ]
            selected = (directional or stories or mappings)[0]
            request_id = str(selected["provider_request_id"])
            reasons.setdefault(request_id, set()).update(
                {f"chapter:{chapter_id}", f"direction:{variant_id}"}
            )
    flagged_ids = {
        str(row["provider_request_id"])
        for row in rows
        if isinstance(row.get("flags"), list) and row["flags"]
    }
    for request_id in flagged_ids:
        reasons.setdefault(request_id, set()).add("all_automated_flags")
    chapter_rank = {chapter: index for index, chapter in enumerate(CHAPTER_ORDER)}
    selected_rows = sorted(
        (by_id[request_id] for request_id in reasons),
        key=lambda row: (chapter_rank[str(row["chapter_id"])], row["stable_order"]),
    )
    items = [
        {
            "chapter_id": row["chapter_id"],
            "provider_request_id": row["provider_request_id"],
            "entry_id": row["entry_id"],
            "master_file": row["master_file"],
            "audio_sha256": row["audio_sha256"],
            "duration_s": row["duration_s"],
            "words_per_minute": row["words_per_minute"],
            "coverage_reasons": sorted(reasons[str(row["provider_request_id"])]),
            "flags": row["flags"],
        }
        for row in selected_rows
    ]
    required_directions = [
        f"{chapter_id}:{variant_id}"
        for chapter_id in CHAPTER_ORDER
        for variant_id in locks[chapter_id]["direction_delivery"][
            "reviewed_variant_ids"
        ]
    ]
    covered_directions = sorted(
        {
            f"{row['chapter_id']}:{variant_id}"
            for row in selected_rows
            for variant_id in row["effective_variant_ids"]
        }
    )
    if not set(required_directions).issubset(covered_directions):
        raise AudioQaError("representative listening set missed a direction")
    if not flagged_ids.issubset(reasons):
        raise AudioQaError("representative listening set missed a flagged file")
    return {
        "selection_policy": (
            "one_exact_master_per_chapter_and_direction_plus_every_automated_flag"
        ),
        "owner_listening_is_representative_not_exhaustive": True,
        "required_chapters": list(CHAPTER_ORDER),
        "required_chapter_directions": required_directions,
        "covered_chapter_directions": covered_directions,
        "all_flagged_provider_request_ids": sorted(flagged_ids),
        "all_flags_included": True,
        "item_count": len(items),
        "items": items,
    }


def build(
    render_root: Path,
    *,
    probe_audio: Callable[[bytes], StrictAudioProbe] = _strict_mp3_probe,
) -> dict[str, Any]:
    root = _assert_external(render_root)
    if root.name != EXPECTED_RENDER_ROOT_BASENAME:
        raise AudioQaError("external render-root basename drifted")
    if not root.is_dir():
        raise AudioQaError("external 72-file render evidence is unavailable")
    source_bindings, locks, runtime = _load_checked_sources()
    _validate_external_inventory(root, locks)
    approval_sha = source_bindings["postpurchase_continuation_approval"]["sha256"]
    preflight_sha = source_bindings["green_postpurchase_preflight"]["sha256"]
    audit_sha = source_bindings["renderer_audit"]["sha256"]
    dependency_sha256 = runtime["renderer_audit"]["dependency_sha256"]

    audio_rows: list[dict[str, Any]] = []
    flagged: list[dict[str, Any]] = []
    chapter_results: list[dict[str, Any]] = []
    closeouts: list[dict[str, Any]] = []
    seen_audio_hashes: set[str] = set()
    seen_fingerprints: set[str] = set()
    prior_ending_credits: int | None = None
    prior_ending_requests: int | None = None
    prior_ending_total_usage_usd: Decimal | None = None
    prior_closeout_sha256: str | None = None
    aggregate_cost = 0

    for chapter_id in CHAPTER_ORDER:
        spec = LOCK_SPECS[chapter_id]
        lock = locks[chapter_id]
        chapter_dir = root / chapter_id
        ledger_path = chapter_dir / "render-ledger.json"
        events_path = chapter_dir / "render-events.ndjson"
        closeout_path = chapter_dir / "chapter-closeout.json"
        ledger = _load_json(ledger_path)
        events, event_head = _parse_events(events_path)
        _reject_secret_material(ledger)
        _reject_secret_material(events)
        _validate_chapter_event_identity(
            chapter_id=chapter_id,
            lock=lock,
            events=events,
            render_root=root,
            continuation_sha256=approval_sha,
            preflight_sha256=preflight_sha,
            audit_sha256=audit_sha,
            dependency_sha256=dependency_sha256,
        )
        expected_caps = {
            "renderer_characters": spec["renderer_character_cap"],
            "api_key_credits": spec["one_day_key_credit_quota"],
            "reserved_provider_credits": spec["reserved_provider_credit_ceiling"],
            "dollars_usd": spec["dollar_cap_usd"],
            "rerenders": 0,
            "cross_chapter_borrowing": False,
            "paid_overage": False,
        }
        expected_ledger_fields = {
            "schema_version",
            "renderer_contract",
            "chapter_id",
            "lock_id",
            "lock_sha256",
            "created_at",
            "updated_at",
            "status",
            "blocked_reason",
            "render_event_count",
            "render_event_head_sha256",
            "execution_sessions",
            "provider_preflights",
            "caps",
            "character_cost_total",
            "projected_cost_usd",
            "items",
        }
        if any(
            (
                set(ledger) != expected_ledger_fields,
                ledger.get("schema_version") != 2,
                ledger.get("renderer_contract") != RENDERER_CONTRACT,
                ledger.get("chapter_id") != chapter_id,
                ledger.get("lock_id") != lock.get("lock_id"),
                ledger.get("lock_sha256") != spec["sha256"],
                ledger.get("created_at") != events[0]["at"],
                ledger.get("updated_at") != events[-1]["at"],
                ledger.get("status")
                != "render_complete_pending_key_deletion_closeout",
                ledger.get("blocked_reason") is not None,
                ledger.get("caps") != expected_caps,
                ledger.get("render_event_count") != len(events),
                ledger.get("render_event_head_sha256") != event_head,
                ledger.get("execution_sessions")
                != [
                    event["payload"]
                    for event in events
                    if event["event_type"] == "execution_session_started"
                ],
                ledger.get("provider_preflights")
                != [
                    event["payload"]
                    for event in events
                    if event["event_type"] == "provider_preflight_passed"
                ],
                not ledger.get("execution_sessions"),
                not ledger.get("provider_preflights"),
            )
        ):
            raise AudioQaError(f"render ledger identity drifted: {chapter_id}")
        _validate_session_preflight_contract(
            chapter_id=chapter_id,
            sessions=ledger["execution_sessions"],
            preflights=ledger["provider_preflights"],
        )
        items = ledger.get("items")
        requests = lock["requests"]
        expected_ids = {str(row["provider_request_id"]) for row in requests}
        if not isinstance(items, dict) or set(items) != expected_ids:
            raise AudioQaError(f"render ledger inventory drifted: {chapter_id}")
        request_event_pairs = _request_event_pairs(events, expected_ids)
        chapter_rows: list[dict[str, Any]] = []
        chapter_cost = 0
        for request in sorted(requests, key=lambda row: int(row["stable_order"])):
            request_id = str(request["provider_request_id"])
            item = items[request_id]
            if not isinstance(item, dict):
                raise AudioQaError(f"render ledger item is invalid: {request_id}")
            row, item_flags = _validate_audio_item(
                chapter_id=chapter_id,
                lock_id=str(lock["lock_id"]),
                request=request,
                item=item,
                accepted_event=request_event_pairs[request_id][0],
                completed_event=request_event_pairs[request_id][1],
                chapter_dir=chapter_dir,
                probe_audio=probe_audio,
            )
            if row["audio_sha256"] in seen_audio_hashes:
                raise AudioQaError("duplicate MP3 bytes detected")
            if row["request_fingerprint"] in seen_fingerprints:
                raise AudioQaError("duplicate request fingerprint detected")
            seen_audio_hashes.add(str(row["audio_sha256"]))
            seen_fingerprints.add(str(row["request_fingerprint"]))
            chapter_rows.append(row)
            audio_rows.append(row)
            chapter_cost += int(row["provider_character_cost"])
            for flag in item_flags:
                flagged.append(
                    {
                        "chapter_id": chapter_id,
                        "provider_request_id": request_id,
                        "entry_id": row["entry_id"],
                        "master_file": row["master_file"],
                        **flag,
                    }
                )
        if any(
            (
                ledger.get("character_cost_total") != chapter_cost,
                ledger.get("projected_cost_usd")
                != str(_projected_cost(chapter_cost)),
                events[-1]["payload"].get("character_cost_total")
                != chapter_cost,
                events[-1]["payload"].get("projected_cost_usd")
                != str(_projected_cost(chapter_cost)),
            )
        ):
            raise AudioQaError(f"chapter ledger cost drifted: {chapter_id}")
        if chapter_cost > int(spec["reserved_provider_credit_ceiling"]) or chapter_cost > int(
            spec["renderer_character_cap"]
        ):
            raise AudioQaError(f"chapter provider cost cap exceeded: {chapter_id}")
        chapter_projected = _projected_cost(chapter_cost)
        if chapter_projected > Decimal(str(spec["dollar_cap_usd"])):
            raise AudioQaError(f"chapter dollar cap exceeded: {chapter_id}")
        closeout = _load_json(closeout_path)
        (
            prior_ending_credits,
            prior_ending_requests,
            prior_ending_total_usage_usd,
            prior_closeout_sha256,
            closeout_public,
        ) = (
            _validate_closeout(
                chapter_id=chapter_id,
                closeout=closeout,
                closeout_path=closeout_path,
                ledger=ledger,
                ledger_path=ledger_path,
                events_path=events_path,
                event_count=len(events),
                event_head=event_head,
                audio_rows=chapter_rows,
                chapter_cost=chapter_cost,
                prior_ending_credits=prior_ending_credits,
                prior_ending_requests=prior_ending_requests,
                prior_ending_total_usage_usd=prior_ending_total_usage_usd,
                prior_closeout_sha256=prior_closeout_sha256,
            )
        )
        provisional_public = _validate_provisional_record(
            chapter_id=chapter_id,
            chapter_dir=chapter_dir,
            ledger_path=ledger_path,
            event_count=len(events),
            event_head=event_head,
            audio_rows=chapter_rows,
            closeout=closeout,
        )
        closeouts.append(closeout_public)
        aggregate_cost += chapter_cost
        chapter_results.append(
            {
                "chapter_id": chapter_id,
                "request_count": len(chapter_rows),
                "audio_accepted_event_count": len(request_event_pairs),
                "request_completed_event_count": len(request_event_pairs),
                "base_request_count": spec["base_request_count"],
                "direction_override_request_count": spec[
                    "direction_override_request_count"
                ],
                "ledger": {
                    "path": _external_relative(ledger_path, root),
                    "sha256": _sha256_path(ledger_path),
                    "byte_count": ledger_path.stat().st_size,
                },
                "events": {
                    "path": _external_relative(events_path, root),
                    "sha256": _sha256_path(events_path),
                    "byte_count": events_path.stat().st_size,
                    "event_count": len(events),
                    "event_head_sha256": event_head,
                },
                "closeout": closeout_public,
                "provisional_key_deletion_record": provisional_public,
                "audio_inventory_sha256": _audio_inventory_hash(chapter_rows),
                "provider_character_cost": chapter_cost,
                "projected_cost_usd": str(chapter_projected),
                "reserved_provider_credit_ceiling": spec[
                    "reserved_provider_credit_ceiling"
                ],
                "renderer_character_cap": spec["renderer_character_cap"],
                "dollar_cap_usd": spec["dollar_cap_usd"],
                "all_mp3_frames_complete": True,
                "retry_count": 0,
                "rerender_count": 0,
                "ambiguous_response_count": 0,
            }
        )

    if len(audio_rows) != 72:
        raise AudioQaError("expected exactly 72 MP3 masters")
    if aggregate_cost > EXPECTED_AGGREGATE["reserved_provider_credit_ceiling"] or aggregate_cost > EXPECTED_AGGREGATE[
        "renderer_character_cap"
    ]:
        raise AudioQaError("aggregate provider cost cap exceeded")
    aggregate_projected = _projected_cost(aggregate_cost)
    if aggregate_projected > Decimal(EXPECTED_AGGREGATE["dollar_cap_usd"]):
        raise AudioQaError("aggregate dollar cap exceeded")
    representative = _representative_listening_set(locks, audio_rows)
    flag_counts = {
        flag_type: sum(1 for row in flagged if row["type"] == flag_type)
        for flag_type in (
            "pronunciation_review",
            "duration_outlier",
            "pacing_outlier",
        )
    }
    return {
        "schema_version": 1,
        "report_id": "smokies_remaining_72_audio_qa_v1",
        "kind": "internal_external_audio_qa_and_owner_listening_selection",
        "product_id": PRODUCT_ID,
        "status": "technical_qa_passed_owner_media_acceptance_required",
        "render_root": {
            "basename": root.name,
            "marker": {
                "path": ROOT_MARKER_NAME,
                "sha256": _sha256_path(root / ROOT_MARKER_NAME),
                "byte_count": (root / ROOT_MARKER_NAME).stat().st_size,
            },
            "absolute_path_serialized": False,
            "tracking_policy": "external_ignored_derived_evidence",
        },
        "source_bindings": source_bindings,
        "qa_contract": {
            "expected_mp3_count": 72,
            "container": "mp3",
            "sample_rate_hz": 44_100,
            "bitrate_kbps": 128,
            "channels": 1,
            "all_frames_and_metadata_bytes_must_be_accounted_for": True,
            "hard_wpm_range": [MIN_HARD_WPM, MAX_HARD_WPM],
            "preferred_owner_review_wpm_range": [
                MIN_PREFERRED_WPM,
                MAX_PREFERRED_WPM,
            ],
            "pronunciation_flags_are_conservative_owner_listening_terms_not_"
            "culturally_supplied_pronunciations": True,
        },
        "aggregate": {
            **EXPECTED_AGGREGATE,
            "actual_provider_character_cost": aggregate_cost,
            "actual_projected_cost_usd": str(aggregate_projected),
            "ending_provider_credits": prior_ending_credits,
            "ending_billable_request_count": prior_ending_requests,
            "ending_total_usage_usd": (
                f"{prior_ending_total_usage_usd:.2f}"
                if prior_ending_total_usage_usd is not None
                else None
            ),
            "mp3_count": len(audio_rows),
            "unique_audio_sha256_count": len(seen_audio_hashes),
            "unique_request_fingerprint_count": len(seen_fingerprints),
            "provider_attempt_count": 72,
            "audio_accepted_event_count": 72,
            "request_completed_event_count": 72,
            "retry_count": 0,
            "rerender_count": 0,
            "duplicate_count": 0,
            "ambiguous_response_count": 0,
            "all_keys_deleted_and_verified": True,
            "provider_usage_reconciled": True,
        },
        "chapter_results": chapter_results,
        "provider_closeouts": {
            "prebatch_baseline": PREBATCH_BASELINE,
            "chapter_order": list(CHAPTER_ORDER),
            "chapters": closeouts,
            "sequential_credit_and_request_counters_reconciled": True,
            "all_keys_deleted_and_no_other_active_render_keys": True,
        },
        "flagged_items": {
            "flag_count": len(flagged),
            "counts_by_type": flag_counts,
            "items": flagged,
        },
        "representative_owner_listening_set": representative,
        "audio_assets": audio_rows,
        "acceptance_boundary": {
            "technical_qa_complete": True,
            "owner_media_acceptance": False,
            "owner_derivative_image_acceptance": False,
            "narration_revision_authorized": False,
            "rerender_authorized": False,
            "ingestion_allowed": False,
            "manifest_mutation_allowed": False,
            "upload_allowed": False,
            "database_accessed": False,
            "production_mutation_allowed": False,
            "trusted_validation_allowed": False,
            "publication_allowed": False,
            "public_release": False,
            "next_action": (
                "present_exact_72_hashes_flags_and_representative_listening_set_"
                "for_owner_media_acceptance"
            ),
        },
        "builder_effects": {
            "network_accessed": False,
            "provider_accessed": False,
            "api_keys_created_or_deleted": 0,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
            "media_files_created_or_modified": 0,
            "database_accessed": False,
            "production_mutated": False,
        },
    }


def serialize(value: Mapping[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render-root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    configured = args.render_root or (
        Path(os.environ["TRAILHEAD_SMOKIES_JAMES_REMAINING_ROOT"])
        if os.environ.get("TRAILHEAD_SMOKIES_JAMES_REMAINING_ROOT")
        else None
    )
    if configured is None:
        raise SystemExit(
            "External 72-file render evidence is unavailable; pass --render-root"
        )
    root = _assert_external(configured)
    output = _assert_external(args.output or (root / REPORT_FILENAME))
    if output.parent != root:
        raise SystemExit("QA report must be written directly inside the external root")
    try:
        rendered = serialize(build(root))
    except AudioQaError as error:
        raise SystemExit(str(error)) from error
    if args.check:
        if (
            output.is_symlink()
            or not output.is_file()
            or output.read_text(encoding="utf-8") != rendered
        ):
            raise SystemExit("External 72-file audio QA report is missing or stale")
        return 0
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(output, flags, 0o600)
    except FileExistsError as error:
        raise SystemExit(
            "External 72-file audio QA report already exists; use --check"
        ) from error
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(rendered)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
