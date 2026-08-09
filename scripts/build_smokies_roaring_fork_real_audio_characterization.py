#!/usr/bin/env python3
"""Build the bounded internal Roaring Fork real-audio characterization.

This report is not a publication validator.  It binds the checked authoring
packet to locally ignored renderer evidence and invokes the existing exported
``computeOriginalLongFormDeliveryMetrics`` TypeScript function.  When ignored
audio is unavailable (for example in ordinary CI), ``--check`` still verifies
the tracked report's source bindings and deterministic structure; pass
``--require-local-evidence`` to require a fresh ledger, MP3 re-probe, and exact
TypeScript execution.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence


REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from scripts.build_smokies_elevenlabs_james_roaring_fork_lock import (
    build as build_production_lock,
    serialize as serialize_production_lock,
)
from scripts.build_smokies_long_form_delivery_readiness import (
    build as build_delivery_readiness,
)
from scripts.build_smokies_roaring_fork_trigger_preflight import (
    build_artifact as build_trigger_preflight,
    serialize as serialize_trigger_preflight,
)
from scripts.render_smokies_elevenlabs_james_roaring_fork import (
    _probe_mono_mp3,
)


DESTINATION = (
    REPOSITORY
    / "originals/smokies/roaring_fork_real_audio_characterization_v1.json"
)
LOCK_PATH = (
    REPOSITORY
    / "originals/smokies/elevenlabs_james_roaring_fork_lock_v1.json"
)
PREFLIGHT_PATH = (
    REPOSITORY / "originals/smokies/roaring_fork_trigger_preflight_v1.json"
)
READINESS_PATH = (
    REPOSITORY / "originals/smokies/roaring_fork_delivery_readiness_v1.json"
)
EDITORIAL_PATH = REPOSITORY / "originals/smokies/editorial_roaring_fork_v1.json"
DOSSIER_PATH = REPOSITORY / "originals/smokies/source_dossiers_v1.json"
ROUTE_PATH = REPOSITORY / "originals/smokies/official_route_evidence_v1.json"
OUTPUT_DIRECTORY = (
    REPOSITORY
    / "output/smokies-original/elevenlabs-james-roaring-fork-v1"
)
LEDGER_PATH = OUTPUT_DIRECTORY / "render-ledger.json"
TYPESCRIPT_BRIDGE_PATH = (
    REPOSITORY
    / "mobile/scripts/compute-original-long-form-delivery-metrics-bridge.ts"
)
TSX_PATH = REPOSITORY / "mobile/node_modules/.bin/tsx"

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CHAPTER_ID = "roaring_fork"
VARIANT_ID = "one_way"
LOCK_ID = "great_smoky_mountains_james_roaring_fork_lock_v1"
VOICE_ID = "EkK5I93UQWFDigLMpZcX"
MODEL_ID = "eleven_multilingual_v2"
OUTPUT_FORMAT_ID = "mp3_44100_128"

SPEED_FIXTURES_MPH = (15, 36, 65, 75)
ROUTE_END_TAIL_LIMIT_S = 240
TRIGGER_TO_PLAY_LATENCY_LIMIT_S = 180
CAPACITY_GUARD_S = 30
MINIMUM_RELIABLE_FIXES = 2
MINIMUM_RELIABLE_DWELL_MS = 3_000
SECOND_FIX_EPSILON_S = 0.1

EXPECTED_COUNTS_BY_MODE = {
    "hard_auto": 5,
    "capacity_deeper": 4,
    "stopped_deeper": 3,
    "completion_deeper": 1,
}
EXPECTED_OGLE_ORDER = ("rf_cue_02", "rf_story_03")
SEMANTICS_SOURCE_PATHS = (
    "mobile/lib/originals/longFormScheduler.ts",
    "mobile/lib/originals/routeProjection.ts",
    "mobile/lib/routeProjection.ts",
    "mobile/scripts/validate-original-long-form.ts",
)
SHA256_LENGTH = 64


class CharacterizationError(ValueError):
    """The internal characterization cannot be reproduced safely."""


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CharacterizationError(f"unavailable JSON evidence: {path}") from error
    if not isinstance(value, dict):
        raise CharacterizationError(f"expected JSON object: {path}")
    return value


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_path(path: Path) -> str:
    try:
        return _sha256_bytes(path.read_bytes())
    except OSError as error:
        raise CharacterizationError(f"unavailable evidence file: {path}") from error


def _sha256_json(value: object) -> str:
    return _sha256_bytes(json.dumps(
        value,
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
    ).encode("utf-8"))


def _relative(path: Path) -> str:
    return path.relative_to(REPOSITORY).as_posix()


def _source_binding(path: Path, *, check: str | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {
        "path": _relative(path),
        "sha256": _sha256_path(path),
        "byte_count": path.stat().st_size,
    }
    if check is not None:
        value["deterministic_check"] = check
    return value


def _canonical_readiness(value: Mapping[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def _checked_sources() -> dict[str, dict[str, Any]]:
    lock = _load_json(LOCK_PATH)
    preflight = _load_json(PREFLIGHT_PATH)
    readiness = _load_json(READINESS_PATH)
    editorial = _load_json(EDITORIAL_PATH)
    dossier = _load_json(DOSSIER_PATH)
    route = _load_json(ROUTE_PATH)

    if LOCK_PATH.read_text(encoding="utf-8") != serialize_production_lock(
        build_production_lock()
    ):
        raise CharacterizationError("production narration lock is stale")
    if PREFLIGHT_PATH.read_text(encoding="utf-8") != serialize_trigger_preflight(
        build_trigger_preflight()
    ):
        raise CharacterizationError("S3G trigger preflight is stale")
    if READINESS_PATH.read_text(encoding="utf-8") != _canonical_readiness(
        build_delivery_readiness()
    ):
        raise CharacterizationError("delivery readiness is stale")

    if any((
        lock.get("product_id") != PRODUCT_ID,
        lock.get("chapter_id") != CHAPTER_ID,
        lock.get("variant_id") != VARIANT_ID,
        lock.get("lock_id") != LOCK_ID,
        lock.get("lock_status") != "internal_production_candidate",
        preflight.get("product_id") != PRODUCT_ID,
        preflight.get("chapter_id") != CHAPTER_ID,
        preflight.get("variant_id") != VARIANT_ID,
        readiness.get("product_id") != PRODUCT_ID,
        readiness.get("chapter_id") != CHAPTER_ID,
        readiness.get("variant_id") != VARIANT_ID,
        readiness.get("preflight_sha256") != _sha256_path(PREFLIGHT_PATH),
        readiness.get("real_audio_required") is not True,
        readiness.get("authoring_estimates_accepted") is not False,
    )):
        raise CharacterizationError("checked Roaring Fork source identity drifted")

    preflight_bindings = preflight.get("input_bindings")
    if not isinstance(preflight_bindings, dict) or any((
        preflight_bindings.get("editorial_packet_sha256")
        != _sha256_path(EDITORIAL_PATH),
        preflight_bindings.get("source_dossier_sha256")
        != _sha256_path(DOSSIER_PATH),
        preflight_bindings.get("official_route_evidence_sha256")
        != _sha256_path(ROUTE_PATH),
    )):
        raise CharacterizationError("S3G source binding drifted")

    return {
        "lock": lock,
        "preflight": preflight,
        "readiness": readiness,
        "editorial": editorial,
        "dossier": dossier,
        "route": route,
    }


def _rows_by_id(rows: object, *, key: str, label: str) -> dict[str, Mapping[str, Any]]:
    if not isinstance(rows, list):
        raise CharacterizationError(f"{label} rows are unavailable")
    result: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise CharacterizationError(f"{label} row is invalid")
        identity = str(row.get(key) or "")
        if not identity or identity in result:
            raise CharacterizationError(f"{label} identity is invalid")
        result[identity] = row
    return result


def _route_variant(route: Mapping[str, Any]) -> Mapping[str, Any]:
    variants = route.get("variants")
    if not isinstance(variants, list):
        raise CharacterizationError("official route variants are unavailable")
    matches = [
        row for row in variants
        if isinstance(row, dict)
        and row.get("chapter_id") == CHAPTER_ID
        and row.get("variant_id") == VARIANT_ID
    ]
    if len(matches) != 1:
        raise CharacterizationError("Roaring Fork official route identity drifted")
    variant = matches[0]
    geometry = variant.get("geometry")
    coordinates = geometry.get("coordinates") if isinstance(geometry, dict) else None
    if any((
        variant.get("status") != "official_geometry_candidate",
        not isinstance(coordinates, list),
        len(coordinates) != 1_175,
        float(variant.get("distance_m") or 0) != 8_561.4,
        variant.get("geometry_sha256")
        != "d66f76d6053000244d7e15c8be0494f48d79544e0ceaf79428c51e458e964668",
    )):
        raise CharacterizationError("Roaring Fork route evidence drifted")
    return variant


def _delivery_inventory(
    lock_entries: Mapping[str, Mapping[str, Any]],
    preflight: Mapping[str, Any],
) -> dict[str, Any]:
    preflight_entries = _rows_by_id(
        preflight.get("entries"), key="id", label="preflight entry"
    )
    if set(preflight_entries) != set(lock_entries) or len(lock_entries) != 13:
        raise CharacterizationError("delivery inventory drifted")

    by_mode: dict[str, list[str]] = {mode: [] for mode in EXPECTED_COUNTS_BY_MODE}
    ordered = sorted(lock_entries.values(), key=lambda row: int(row["stable_order"]))
    if [int(row["stable_order"]) for row in ordered] != list(range(1, 14)):
        raise CharacterizationError("delivery stable order drifted")
    for lock_entry in ordered:
        entry_id = str(lock_entry["entry_id"])
        preflight_entry = preflight_entries[entry_id]
        delivery = preflight_entry.get("delivery")
        mode = delivery.get("mode") if isinstance(delivery, dict) else None
        if mode not in by_mode or lock_entry.get("delivery_mode") != mode:
            raise CharacterizationError(f"delivery mode drifted: {entry_id}")
        if any((
            int(preflight_entry.get("stable_order") or 0)
            != int(lock_entry["stable_order"]),
            preflight_entry.get("kind") != lock_entry.get("kind"),
            int(preflight_entry.get("editorial_sequence") or 0)
            != int(lock_entry.get("editorial_sequence") or 0),
        )):
            raise CharacterizationError(f"delivery identity drifted: {entry_id}")
        by_mode[mode].append(entry_id)

    counts = {mode: len(ids) for mode, ids in by_mode.items()}
    if counts != EXPECTED_COUNTS_BY_MODE:
        raise CharacterizationError("delivery classification count drifted")

    non_moving = preflight.get("non_moving_delivery_input")
    if not isinstance(non_moving, list):
        raise CharacterizationError("non-moving delivery evidence is unavailable")
    ogle = [
        row for row in non_moving
        if isinstance(row, dict) and row.get("experience_group_id") == "ogle_prelude"
    ]
    ogle.sort(key=lambda row: int(row.get("stable_order") or 0))
    if tuple(str(row.get("id") or "") for row in ogle) != EXPECTED_OGLE_ORDER:
        raise CharacterizationError("Ogle stopped-prelude order drifted")
    if any((
        row.get("mode") != "stopped_deeper"
        or row.get("requires_user_confirmed_parked") is not True
        for row in ogle
    )):
        raise CharacterizationError("Ogle stopped-prelude safety gate drifted")

    return {
        "entry_count": 13,
        "counts_by_mode": counts,
        "entry_ids_by_mode": by_mode,
        "ogle_prelude": {
            "experience_group_id": "ogle_prelude",
            "entry_ids_in_delivery_order": list(EXPECTED_OGLE_ORDER),
            "requires_user_confirmed_parked": True,
        },
    }


def _audio_rows(
    lock_entries: Mapping[str, Mapping[str, Any]],
    ledger: Mapping[str, Any],
    audio_directory: Path,
) -> list[dict[str, Any]]:
    items = ledger.get("items")
    if not isinstance(items, dict) or set(items) != set(lock_entries):
        raise CharacterizationError("render ledger inventory drifted")
    expected_lock_sha = _sha256_path(LOCK_PATH)
    if any((
        ledger.get("schema_version") != 1,
        ledger.get("lock_id") != LOCK_ID,
        ledger.get("lock_sha256") != expected_lock_sha,
        ledger.get("provider") != "elevenlabs",
        ledger.get("voice_id") != VOICE_ID,
        ledger.get("model_id") != MODEL_ID,
        ledger.get("output_format_id") != OUTPUT_FORMAT_ID,
    )):
        raise CharacterizationError("render ledger identity drifted")

    result: list[dict[str, Any]] = []
    ordered = sorted(lock_entries.values(), key=lambda row: int(row["stable_order"]))
    for lock_entry in ordered:
        entry_id = str(lock_entry["entry_id"])
        item = items.get(entry_id)
        if not isinstance(item, dict):
            raise CharacterizationError(f"render ledger item unavailable: {entry_id}")
        disposition = str(lock_entry.get("generation_disposition") or "")
        expected_state = "completed" if disposition == "generate" else "reused_verified"
        filename = f"{int(lock_entry['stable_order']):02d}-{entry_id}.mp3"
        if any((
            item.get("stable_order") != lock_entry.get("stable_order"),
            item.get("state") != expected_state,
            item.get("disposition") != disposition,
            item.get("master_file") != filename,
            item.get("raw_transcript_sha256")
            != lock_entry.get("raw_transcript_sha256"),
            item.get("normalized_transcript_sha256")
            != lock_entry.get("normalized_transcript_sha256"),
        )):
            raise CharacterizationError(f"render ledger binding drifted: {entry_id}")

        path = audio_directory / filename
        content = path.read_bytes()
        probe = _probe_mono_mp3(content)
        duration_s = float(item.get("duration_s") or 0)
        if any((
            probe.sha256 != item.get("audio_sha256"),
            probe.byte_count != item.get("audio_bytes"),
            abs(probe.duration_s - duration_s) > 0.000001,
            probe.sample_rate_hz != 44_100,
            probe.bitrate_kbps != 128,
            duration_s <= 0,
        )):
            raise CharacterizationError(f"real MP3 evidence drifted: {entry_id}")

        word_count = int(lock_entry.get("word_count") or 0)
        if word_count <= 0:
            raise CharacterizationError(f"word count unavailable: {entry_id}")
        probed_duration_ms = int(math.floor(probe.duration_s * 1_000 + 0.5))
        result.append({
            "stable_order": int(lock_entry["stable_order"]),
            "entry_id": entry_id,
            "kind": lock_entry.get("kind"),
            "delivery_mode": lock_entry.get("delivery_mode"),
            "generation_disposition": disposition,
            "provider_generated": True,
            "raw_transcript_sha256": lock_entry.get("raw_transcript_sha256"),
            "normalized_transcript_sha256": lock_entry.get(
                "normalized_transcript_sha256"
            ),
            "master_file": filename,
            "audio_sha256": probe.sha256,
            "audio_bytes": probe.byte_count,
            "probed_duration_s": _rounded(probe.duration_s),
            "probed_duration_ms": probed_duration_ms,
            "sample_rate_hz": probe.sample_rate_hz,
            "bitrate_kbps": probe.bitrate_kbps,
            "channels": 1,
            "container": "mp3",
            "provider_native_lossy_source": True,
            "words_per_minute": _rounded(word_count / probe.duration_s * 60),
        })
    return result


def _rounded(value: float) -> float:
    return float(f"{max(0.0, value):.6f}")


def _compiled_typescript_timing_input(
    sources: Mapping[str, Mapping[str, Any]],
    assets: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    preflight = sources["preflight"]
    preflight_entries = _rows_by_id(
        preflight.get("entries"), key="id", label="preflight entry"
    )
    hard_rows = preflight.get("hard_auto_fifo_input")
    capacity_rows = preflight.get("capacity_admission_input")
    if not isinstance(hard_rows, list) or not isinstance(capacity_rows, list):
        raise CharacterizationError("S3G timing references are unavailable")
    route = _route_variant(sources["route"])

    def coordinates_for(entry_id: str) -> dict[str, float]:
        row = preflight_entries.get(entry_id)
        coordinates = row.get("projected_coordinate") if row else None
        if not isinstance(coordinates, dict):
            raise CharacterizationError(
                f"S3G projected coordinate is unavailable: {entry_id}"
            )
        lng = float(coordinates.get("lng"))
        lat = float(coordinates.get("lat"))
        if not math.isfinite(lng) or not math.isfinite(lat):
            raise CharacterizationError(
                f"S3G projected coordinate is invalid: {entry_id}"
            )
        return {"lng": lng, "lat": lat}

    stops: list[dict[str, Any]] = []
    for row in hard_rows:
        if not isinstance(row, dict):
            raise CharacterizationError("S3G hard timing reference is invalid")
        entry_id = str(row.get("id") or "")
        window = row.get("trigger_window")
        if not isinstance(window, dict):
            raise CharacterizationError(
                f"S3G hard trigger window is unavailable: {entry_id}"
            )
        stops.append({
            "id": entry_id,
            "sequence": int(row.get("stable_order") or 0),
            "coordinates": coordinates_for(entry_id),
            "trigger": {
                "route_progress_start_m": float(window.get("start_m") or 0),
                "route_progress_end_m": float(window.get("end_m") or 0),
            },
        })

    items: list[dict[str, Any]] = []
    for row in capacity_rows:
        if not isinstance(row, dict):
            raise CharacterizationError("S3G capacity timing reference is invalid")
        entry_id = str(row.get("id") or "")
        window = row.get("trigger_window")
        next_hard = row.get("next_hard_auto")
        rule = row.get("admission_rule")
        if not all(isinstance(value, dict) for value in (window, next_hard, rule)):
            raise CharacterizationError(
                f"S3G capacity timing contract is unavailable: {entry_id}"
            )
        guard_s = int(rule.get("finish_guard_before_next_hard_window_s") or 0)
        if guard_s != CAPACITY_GUARD_S:
            raise CharacterizationError(f"capacity guard drifted: {entry_id}")
        items.append({
            "id": entry_id,
            "sequence": int(row.get("stable_order") or 0),
            "coordinates": coordinates_for(entry_id),
            "trigger": {
                "route_progress_start_m": float(window.get("start_m") or 0),
                "route_progress_end_m": float(window.get("end_m") or 0),
            },
            "delivery": {
                "mode": "capacity_deeper",
                "next_hard_auto_story_id": str(next_hard.get("id") or ""),
                "guard_before_next_hard_auto_window_s": guard_s,
            },
        })

    duration_items = [
        {
            "item_id": str(row["entry_id"]),
            "probed_duration_ms": int(row["probed_duration_ms"]),
        }
        for row in assets
    ]
    if len(duration_items) != 13:
        raise CharacterizationError("TypeScript timing duration inventory drifted")
    return {
        "manifest": {
            "route": {
                "distance_m": route.get("distance_m"),
                "geometry": {"coordinates": route["geometry"]["coordinates"]},
            },
            "stops": stops,
        },
        "selectable": {"items": items},
        "audio_evidence": {"items": duration_items},
    }


def _run_typescript_metrics_bridge(
    compiled: Mapping[str, Any],
) -> dict[str, Any]:
    if not TSX_PATH.is_file():
        raise CharacterizationError("local tsx runtime is unavailable")
    payload = json.dumps(
        {"schema_version": 1, "compiled": compiled},
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
    )
    try:
        process = subprocess.run(
            [str(TSX_PATH), str(TYPESCRIPT_BRIDGE_PATH)],
            cwd=REPOSITORY / "mobile",
            input=payload,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise CharacterizationError("TypeScript timing bridge failed") from error
    if process.returncode != 0 or process.stderr:
        raise CharacterizationError("TypeScript timing bridge rejected input")
    lines = process.stdout.splitlines()
    if len(lines) != 1:
        raise CharacterizationError("TypeScript timing bridge output drifted")
    try:
        result = json.loads(lines[0])
    except json.JSONDecodeError as error:
        raise CharacterizationError("TypeScript timing bridge output is invalid") from error
    if not isinstance(result, dict):
        raise CharacterizationError("TypeScript timing bridge result is invalid")
    return result


def _validated_typescript_result(value: Mapping[str, Any]) -> dict[str, Any]:
    fixtures = value.get("speed_fixtures")
    if any((
        value.get("schema_version") != 1,
        value.get("duration_basis") != "server_probed_immutable_audio",
        value.get("valid") is not True,
        not isinstance(fixtures, list),
        [row.get("speed_mph") for row in fixtures if isinstance(row, dict)]
        != list(SPEED_FIXTURES_MPH),
        len(fixtures or []) != len(SPEED_FIXTURES_MPH),
    )):
        raise CharacterizationError("TypeScript timing result drifted")
    return dict(value)


def _timing_characterization(
    preflight: Mapping[str, Any],
    assets: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    duration_by_id = {
        str(row["entry_id"]): int(row["probed_duration_ms"]) / 1_000
        for row in assets
    }
    hard_rows = preflight.get("hard_auto_fifo_input")
    capacity_rows = preflight.get("capacity_admission_input")
    route = preflight.get("route")
    if not isinstance(hard_rows, list) or not isinstance(capacity_rows, list):
        raise CharacterizationError("S3G timing rows are unavailable")
    if not isinstance(route, dict):
        raise CharacterizationError("S3G route timing evidence is unavailable")
    route_distance_m = float(route.get("measured_distance_m") or 0)
    if route_distance_m <= 0:
        raise CharacterizationError("S3G route timing distance is invalid")

    fixtures: list[dict[str, Any]] = []
    for speed_mph in SPEED_FIXTURES_MPH:
        speed_mps = speed_mph * 0.44704
        route_travel_s = route_distance_m / speed_mps
        events: list[dict[str, Any]] = []
        for row in hard_rows:
            if not isinstance(row, dict):
                raise CharacterizationError("hard timing row is invalid")
            entry_id = str(row.get("id") or "")
            duration_s = duration_by_id.get(entry_id, 0)
            progress_m = float(row.get("projected_progress_m") or 0)
            events.append({
                "id": entry_id,
                "kind": "hard",
                "arrival_s": progress_m / speed_mps,
                "duration_s": duration_s,
                "sequence": int(row.get("stable_order") or 0),
                "available_audio_s": None,
                "required_audio_s": None,
                "window_end_s": None,
                "next_hard_window_start_s": None,
            })
        for row in capacity_rows:
            if not isinstance(row, dict):
                raise CharacterizationError("capacity timing row is invalid")
            entry_id = str(row.get("id") or "")
            duration_s = duration_by_id.get(entry_id, 0)
            progress_m = float(row.get("projected_progress_m") or 0)
            trigger = row.get("trigger_window")
            next_hard = row.get("next_hard_auto")
            rule = row.get("admission_rule")
            if not all(isinstance(value, dict) for value in (trigger, next_hard, rule)):
                raise CharacterizationError(f"capacity timing contract drifted: {entry_id}")
            guard_s = float(rule.get("finish_guard_before_next_hard_window_s") or 0)
            if guard_s != CAPACITY_GUARD_S:
                raise CharacterizationError(f"capacity guard drifted: {entry_id}")
            next_start_m = float(next_hard.get("window_start_m") or 0)
            events.append({
                "id": entry_id,
                "kind": "capacity",
                "arrival_s": progress_m / speed_mps,
                "duration_s": duration_s,
                "sequence": int(row.get("stable_order") or 0),
                "available_audio_s": max(0.0, next_start_m - progress_m) / speed_mps,
                "required_audio_s": duration_s + guard_s,
                "window_end_s": float(trigger.get("end_m") or 0) / speed_mps,
                "next_hard_window_start_s": next_start_m / speed_mps,
            })
        events.sort(key=lambda row: (
            float(row["arrival_s"]),
            0 if row["kind"] == "hard" else 1,
            int(row["sequence"]),
            str(row["id"]),
        ))

        active: dict[str, Any] | None = None
        hard_queue: list[dict[str, Any]] = []
        capacity_candidate: dict[str, Any] | None = None
        maximum_latency_s = 0.0
        admitted: list[str] = []
        rejected: list[str] = []

        def start_hard(event: Mapping[str, Any], start_s: float) -> dict[str, Any]:
            nonlocal maximum_latency_s
            maximum_latency_s = max(
                maximum_latency_s, start_s - float(event["arrival_s"])
            )
            return {**event, "finish_s": start_s + float(event["duration_s"])}

        def advance_to(target_s: float) -> None:
            nonlocal active, capacity_candidate, maximum_latency_s
            while True:
                active_finish = (
                    float(active["finish_s"]) if active is not None else math.inf
                )
                candidate_ready = (
                    float(capacity_candidate["ready_s"])
                    if capacity_candidate is not None else math.inf
                )
                next_time = min(active_finish, candidate_ready)
                if not math.isfinite(next_time) or next_time > target_s:
                    break
                if candidate_ready <= active_finish:
                    candidate = capacity_candidate
                    capacity_candidate = None
                    if (
                        candidate is not None
                        and active is None
                        and not hard_queue
                        and candidate["ready_s"] <= candidate["window_end_s"]
                        and candidate["next_hard_window_start_s"]
                        - candidate["ready_s"] >= candidate["required_audio_s"]
                    ):
                        admitted.append(str(candidate["id"]))
                        maximum_latency_s = max(
                            maximum_latency_s,
                            float(candidate["ready_s"])
                            - float(candidate["arrival_s"]),
                        )
                        active = {
                            **candidate,
                            "finish_s": float(candidate["ready_s"])
                            + float(candidate["duration_s"]),
                        }
                    elif candidate is not None:
                        rejected.append(str(candidate["id"]))
                    continue
                finished_at = active_finish
                active = None
                if hard_queue:
                    active = start_hard(hard_queue.pop(0), finished_at)

        for event in events:
            if not math.isfinite(float(event["duration_s"])) or event["duration_s"] <= 0:
                raise CharacterizationError(
                    f"real audio duration unavailable: {event['id']}"
                )
            advance_to(float(event["arrival_s"]))
            if event["kind"] == "hard":
                if capacity_candidate is not None:
                    rejected.append(str(capacity_candidate["id"]))
                    capacity_candidate = None
                if active is not None and active["kind"] == "capacity":
                    active = None
                if active is not None:
                    hard_queue.append({**event, "queued_at_s": event["arrival_s"]})
                else:
                    active = start_hard(event, float(event["arrival_s"]))
                continue

            dwell_s = MINIMUM_RELIABLE_DWELL_MS / 1_000 + SECOND_FIX_EPSILON_S
            if (
                active is None
                and not hard_queue
                and capacity_candidate is None
                and event["arrival_s"] + dwell_s <= event["window_end_s"]
                and event["next_hard_window_start_s"]
                - (event["arrival_s"] + dwell_s) >= event["required_audio_s"]
            ):
                capacity_candidate = {
                    **event, "ready_s": float(event["arrival_s"]) + dwell_s
                }
            else:
                rejected.append(str(event["id"]))

        advance_to(route_travel_s)
        if capacity_candidate is not None:
            rejected.append(str(capacity_candidate["id"]))
            capacity_candidate = None
        active_remaining_s = (
            max(0.0, float(active["finish_s"]) - route_travel_s)
            if active is not None else 0.0
        )
        queued_remaining_s = sum(
            float(event["duration_s"]) for event in hard_queue
        )
        backlog_s = active_remaining_s + queued_remaining_s
        within_limits = (
            backlog_s <= ROUTE_END_TAIL_LIMIT_S
            and maximum_latency_s <= TRIGGER_TO_PLAY_LATENCY_LIMIT_S
        )
        fixtures.append({
            "speed_mph": speed_mph,
            "route_travel_s": _rounded(route_travel_s),
            "route_end_backlog_audio_s": _rounded(backlog_s),
            "maximum_trigger_to_play_latency_s": _rounded(maximum_latency_s),
            "admitted_capacity_ids": admitted,
            "rejected_capacity_ids": rejected,
            "within_internal_limits": within_limits,
        })

    return {
        "scope": "internal_real_audio_timing_characterization",
        "duration_basis": "locally_reprobed_immutable_mp3_integer_milliseconds",
        "mobile_semantics_reference": "computeOriginalLongFormDeliveryMetrics",
        "scheduler_semantics": {
            "speed_fixtures_mph": list(SPEED_FIXTURES_MPH),
            "hard_auto_preempts_capacity": True,
            "hard_auto_fifo": True,
            "capacity_queue_capacity": 0,
            "minimum_reliable_fixes": MINIMUM_RELIABLE_FIXES,
            "minimum_reliable_dwell_ms": MINIMUM_RELIABLE_DWELL_MS,
            "second_fix_epsilon_s": SECOND_FIX_EPSILON_S,
            "capacity_guard_before_next_hard_window_s": CAPACITY_GUARD_S,
            "route_end_tail_limit_s": ROUTE_END_TAIL_LIMIT_S,
            "trigger_to_play_latency_limit_s": TRIGGER_TO_PLAY_LATENCY_LIMIT_S,
        },
        "speed_fixtures": fixtures,
        "all_fixtures_within_internal_limits": all(
            fixture["within_internal_limits"] for fixture in fixtures
        ),
    }


def _source_bindings(sources: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    readiness_sources = sources["readiness"].get("source_sha256_by_path")
    if not isinstance(readiness_sources, dict):
        raise CharacterizationError("readiness source hashes are unavailable")
    semantics = {}
    for path in SEMANTICS_SOURCE_PATHS:
        actual = _sha256_path(REPOSITORY / path)
        if readiness_sources.get(path) != actual:
            raise CharacterizationError(f"timing semantics source drifted: {path}")
        semantics[path] = actual
    return {
        "production_narration_lock": _source_binding(
            LOCK_PATH, check="exact_builder_match"
        ),
        "s3g_trigger_preflight": _source_binding(
            PREFLIGHT_PATH, check="exact_builder_match"
        ),
        "delivery_readiness": _source_binding(
            READINESS_PATH, check="exact_builder_match"
        ),
        "editorial_packet": _source_binding(EDITORIAL_PATH),
        "source_dossier": _source_binding(DOSSIER_PATH),
        "official_route_evidence": _source_binding(ROUTE_PATH),
        "typescript_timing_bridge": _source_binding(TYPESCRIPT_BRIDGE_PATH),
        "mobile_timing_semantics_sha256_by_path": semantics,
    }


def _artifact_from_assets(
    sources: Mapping[str, Mapping[str, Any]],
    assets: Sequence[Mapping[str, Any]],
    *,
    ledger_binding: Mapping[str, Any],
    tracked_typescript_result: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    lock_entries = _rows_by_id(
        sources["lock"].get("entries"), key="entry_id", label="lock entry"
    )
    inventory = _delivery_inventory(lock_entries, sources["preflight"])
    route_variant = _route_variant(sources["route"])
    if len(assets) != 13 or [row["entry_id"] for row in assets] != [
        row["entry_id"]
        for row in sorted(lock_entries.values(), key=lambda row: row["stable_order"])
    ]:
        raise CharacterizationError("real-audio asset order drifted")

    compiled_timing_input = _compiled_typescript_timing_input(sources, assets)
    timing_result = _validated_typescript_result(
        tracked_typescript_result
        if tracked_typescript_result is not None
        else _run_typescript_metrics_bridge(compiled_timing_input)
    )
    timing = {
        "scope": "internal_real_audio_timing_characterization",
        "execution": "existing_typescript_computeOriginalLongFormDeliveryMetrics",
        "compiled_input_sha256": _sha256_json(compiled_timing_input),
        "result_sha256": _sha256_json(timing_result),
        "result": timing_result,
    }
    total_bytes = sum(int(row["audio_bytes"]) for row in assets)
    total_duration_s = sum(float(row["probed_duration_s"]) for row in assets)
    total_duration_ms = sum(int(row["probed_duration_ms"]) for row in assets)
    return {
        "schema_version": 1,
        "kind": "original_internal_real_audio_characterization",
        "characterization_id": "smokies_roaring_fork_james_real_audio_v1",
        "status": "internal_characterization_only",
        "product_id": PRODUCT_ID,
        "chapter_id": CHAPTER_ID,
        "variant_id": VARIANT_ID,
        "release_gate": {
            "public_release": False,
            "trusted_publication_validation": False,
            "validated_delivery_contracts": [],
            "publication_status": "blocked_missing_publication_evidence",
            "missing_publication_evidence": [
                "artwork_evidence",
                "full_original_manifest_v3_publication_evidence",
            ],
            "characterization_must_not_be_used_as_publication_validation": True,
        },
        "source_bindings": _source_bindings(sources),
        "route_binding": {
            "route_id": route_variant.get("id"),
            "chapter_id": CHAPTER_ID,
            "variant_id": VARIANT_ID,
            "status": route_variant.get("status"),
            "distance_m": route_variant.get("distance_m"),
            "coordinate_count": len(route_variant["geometry"]["coordinates"]),
            "geometry_sha256": route_variant.get("geometry_sha256"),
        },
        "delivery_inventory": inventory,
        "renderer_evidence": {
            "tracking_policy": "ignored_local_output",
            "provider": "elevenlabs",
            "voice_id": VOICE_ID,
            "model_id": MODEL_ID,
            "output_format_id": OUTPUT_FORMAT_ID,
            "render_ledger": dict(ledger_binding),
            "asset_count": 13,
            "asset_evidence_sha256": _sha256_json(list(assets)),
            "total_audio_bytes": total_bytes,
            "total_probed_duration_s": _rounded(total_duration_s),
            "total_probed_duration_ms": total_duration_ms,
            "assets": list(assets),
        },
        "timing_characterization": timing,
        "limitations": [
            "ignored_audio_and_ledger_are_not_public_artifacts",
            "provider_renderer_sidecars_are_not_publication_generator_metadata",
            "no_artwork_or_complete_v3_manifest_is_bound",
            "no_trusted_server_publication_validator_was_run",
        ],
    }


def build(
    *,
    output_directory: Path = OUTPUT_DIRECTORY,
    ledger_path: Path = LEDGER_PATH,
) -> dict[str, Any]:
    sources = _checked_sources()
    lock_entries = _rows_by_id(
        sources["lock"].get("entries"), key="entry_id", label="lock entry"
    )
    ledger = _load_json(ledger_path)
    assets = _audio_rows(lock_entries, ledger, output_directory)
    ledger_binding = {
        "path": _relative(ledger_path),
        "sha256": _sha256_path(ledger_path),
        "byte_count": ledger_path.stat().st_size,
        "schema_version": ledger.get("schema_version"),
        "lock_sha256": ledger.get("lock_sha256"),
        "item_count": len(ledger.get("items") or {}),
    }
    return _artifact_from_assets(
        sources, assets, ledger_binding=ledger_binding
    )


def _validate_sha256(value: object, label: str) -> None:
    if not isinstance(value, str) or len(value) != SHA256_LENGTH:
        raise CharacterizationError(f"invalid SHA-256 binding: {label}")
    try:
        int(value, 16)
    except ValueError as error:
        raise CharacterizationError(f"invalid SHA-256 binding: {label}") from error


def validate_tracked_without_local_audio(value: Mapping[str, Any]) -> None:
    """Recompute all non-audio logic while trusting only tracked audio hashes."""
    sources = _checked_sources()
    release_gate = value.get("release_gate")
    renderer = value.get("renderer_evidence")
    assets = renderer.get("assets") if isinstance(renderer, dict) else None
    timing = value.get("timing_characterization")
    tracked_typescript_result = (
        timing.get("result") if isinstance(timing, dict) else None
    )
    if any((
        value.get("status") != "internal_characterization_only",
        not isinstance(release_gate, dict),
        release_gate.get("public_release") is not False,
        release_gate.get("trusted_publication_validation") is not False,
        release_gate.get("validated_delivery_contracts") != [],
        not isinstance(renderer, dict),
        renderer.get("tracking_policy") != "ignored_local_output",
        not isinstance(assets, list),
        len(assets) != 13,
        not isinstance(timing, dict),
        not isinstance(tracked_typescript_result, dict),
    )):
        raise CharacterizationError("tracked internal-release boundary drifted")
    for row in assets:
        if not isinstance(row, dict):
            raise CharacterizationError("tracked audio binding row is invalid")
        _validate_sha256(row.get("audio_sha256"), "audio")
        _validate_sha256(row.get("raw_transcript_sha256"), "raw transcript")
        _validate_sha256(
            row.get("normalized_transcript_sha256"), "normalized transcript"
        )
        if any((
            int(row.get("audio_bytes") or 0) <= 0,
            float(row.get("probed_duration_s") or 0) <= 0,
            isinstance(row.get("probed_duration_ms"), bool),
            not isinstance(row.get("probed_duration_ms"), int),
            int(row.get("probed_duration_ms") or 0) <= 0,
            int(row.get("probed_duration_ms") or 0)
            != int(math.floor(float(row.get("probed_duration_s") or 0) * 1_000 + 0.5)),
            row.get("sample_rate_hz") != 44_100,
            row.get("bitrate_kbps") != 128,
            row.get("channels") != 1,
            row.get("provider_generated") is not True,
        )):
            raise CharacterizationError("tracked audio binding metadata drifted")
    tracked_ledger = renderer.get("render_ledger")
    if not isinstance(tracked_ledger, dict):
        raise CharacterizationError("tracked ledger binding is unavailable")
    _validate_sha256(tracked_ledger.get("sha256"), "render ledger")
    expected = _artifact_from_assets(
        sources,
        assets,
        ledger_binding=tracked_ledger,
        tracked_typescript_result=tracked_typescript_result,
    )
    if value != expected:
        raise CharacterizationError("tracked characterization is stale")


def serialize(value: Mapping[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def _local_evidence_available() -> bool:
    if not LEDGER_PATH.is_file() or not TSX_PATH.is_file():
        return False
    try:
        ledger = _load_json(LEDGER_PATH)
    except CharacterizationError:
        return False
    items = ledger.get("items")
    if not isinstance(items, dict) or len(items) != 13:
        return False
    return all(
        isinstance(row, dict)
        and isinstance(row.get("master_file"), str)
        and (OUTPUT_DIRECTORY / row["master_file"]).is_file()
        for row in items.values()
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DESTINATION)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--require-local-evidence", action="store_true")
    args = parser.parse_args(argv)

    if args.check:
        if not args.output.is_file():
            raise SystemExit("Roaring Fork characterization is missing")
        if _local_evidence_available():
            if args.output.read_text(encoding="utf-8") != serialize(build()):
                raise SystemExit("Roaring Fork characterization is stale")
            return 0
        if args.require_local_evidence:
            raise SystemExit("Ignored Roaring Fork ledger/MP3 evidence is unavailable")
        validate_tracked_without_local_audio(_load_json(args.output))
        return 0

    rendered = serialize(build())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
