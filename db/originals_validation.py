"""Trusted bridge to the headless Trailhead Originals trigger validator."""
from __future__ import annotations

import copy
import json
import hashlib
import math
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import subprocess
from typing import Any, Iterable
from urllib import error as urllib_error, request as urllib_request
from urllib.parse import urlsplit


class OriginalValidationRunnerError(RuntimeError):
    """The trusted validator could not produce a valid deterministic report."""


REPO_ROOT = Path(__file__).resolve().parents[1]
MOBILE_ROOT = REPO_ROOT / "mobile"
RUNNER_PATH = MOBILE_ROOT / "scripts" / "validate-original-route.ts"
LONG_FORM_RUNNER_PATH = MOBILE_ROOT / "scripts" / "validate-original-long-form.ts"
LONG_FORM_PREFLIGHT_PATH = Path(
    "originals/smokies/roaring_fork_trigger_preflight_v1.json"
)
LEGACY_LONG_FORM_READINESS_PATH = Path(
    "originals/smokies/roaring_fork_delivery_readiness_v1.json"
)
LONG_FORM_READINESS_PATH = Path(
    "originals/smokies/roaring_fork_delivery_readiness_v2.json"
)
ROARING_FORK_ROUTE_NETWORK_TARGET_PATH = Path(
    "originals/smokies/roaring_fork_route_network_validation_target_v1.json"
)
MAX_OUTPUT_BYTES = 2 * 1024 * 1024
DEFAULT_VALIDATOR_TIMEOUT_SECONDS = 180
MAX_VALIDATOR_TIMEOUT_SECONDS = 300
MAX_ROUTE_NETWORK_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_ROUTE_NETWORK_CHUNK_POINTS = 50
ROUTE_NETWORK_CHUNK_OVERLAP_POINTS = 2
MAX_AUTHORED_ROUTE_SEGMENT_M = 2_000.0
MAX_MATCHED_POINT_OFFSET_M = 50.0
MAX_LOCATE_EDGE_DISTANCE_M = 25.0
MAX_NETWORK_DISTANCE_DELTA_RATIO = 0.15
MAX_NETWORK_DISTANCE_DELTA_M = 300.0
ROUTE_NETWORK_OVERRIDE_MAX_AGE_DAYS = 30
TRUSTED_VALIDATOR_SOURCE_PATHS = (
    Path("db/originals_validation.py"),
    ROARING_FORK_ROUTE_NETWORK_TARGET_PATH,
    Path("mobile/lib/routeProjection.ts"),
    Path("mobile/lib/originals/manifest.ts"),
    Path("mobile/lib/originals/routeProjection.ts"),
    Path("mobile/lib/originals/routeValidation.ts"),
    Path("mobile/lib/originals/session.ts"),
    Path("mobile/lib/originals/triggerEngine.ts"),
    Path("mobile/lib/originals/triggerSimulation.ts"),
    Path("mobile/scripts/validate-original-route.ts"),
)

TRUSTED_LONG_FORM_VALIDATOR_SOURCE_PATHS = (
    Path("db/original_manifest_v2.py"),
    Path("db/original_manifest_v3.py"),
    Path("db/original_entitlement_receipt.py"),
    Path("db/originals_cultural_review.py"),
    Path("db/originals_editorial.py"),
    Path("db/originals_operational.py"),
    Path("db/originals_route_evidence.py"),
    Path("db/originals_validation.py"),
    Path("db/store.py"),
    Path("dashboard/server.py"),
    Path("originals/smokies/editorial_roaring_fork_v1.json"),
    Path("originals/smokies/official_route_evidence_v1.json"),
    LONG_FORM_PREFLIGHT_PATH,
    LEGACY_LONG_FORM_READINESS_PATH,
    LONG_FORM_READINESS_PATH,
    ROARING_FORK_ROUTE_NETWORK_TARGET_PATH,
    Path("originals/smokies/source_dossiers_v1.json"),
    Path("scripts/build_smokies_roaring_fork_trigger_preflight.py"),
    Path("scripts/build_smokies_long_form_delivery_readiness.py"),
    Path("mobile/package.json"),
    Path("mobile/package-lock.json"),
    Path("mobile/app/originals/[id].tsx"),
    Path("mobile/components/originals/OriginalsMapPlayerSheet.tsx"),
    Path("mobile/components/originals/originalsUiService.ts"),
    Path("mobile/components/originals/types.ts"),
    Path("mobile/lib/routeProjection.ts"),
    Path("mobile/lib/originals/accessPolicy.ts"),
    Path("mobile/lib/originals/accessStore.ts"),
    Path("mobile/lib/originals/api.ts"),
    Path("mobile/lib/originals/audioAdapter.ts"),
    Path("mobile/lib/originals/audioAdapterState.ts"),
    Path("mobile/lib/originals/audioCoordinator.ts"),
    Path("mobile/lib/originals/bundleStore.ts"),
    Path("mobile/lib/originals/clientCapabilities.ts"),
    Path("mobile/lib/originals/expoFileAdapter.ts"),
    Path("mobile/lib/originals/expoStores.ts"),
    Path("mobile/lib/originals/fileAdapter.ts"),
    Path("mobile/lib/originals/manifest.ts"),
    Path("mobile/lib/originals/manifestV2.ts"),
    Path("mobile/lib/originals/manifestV3.ts"),
    Path("mobile/lib/originals/routeProjection.ts"),
    Path("mobile/lib/originals/routeValidation.ts"),
    Path("mobile/lib/originals/headlessController.ts"),
    Path("mobile/lib/originals/headlessRuntime.ts"),
    Path("mobile/lib/originals/localAccessSummary.ts"),
    Path("mobile/lib/originals/locationAdapter.ts"),
    Path("mobile/lib/originals/locationPolicy.ts"),
    Path("mobile/lib/originals/locationQueue.ts"),
    Path("mobile/lib/originals/mainMapExperience.ts"),
    Path("mobile/lib/originals/mapAdapter.ts"),
    Path("mobile/lib/originals/mapDownloadWatchdog.ts"),
    Path("mobile/lib/originals/nativeAudioSession.ts"),
    Path("mobile/lib/originals/ownership.ts"),
    Path("mobile/lib/originals/runtime.tsx"),
    Path("mobile/lib/originals/session.ts"),
    Path("mobile/lib/originals/sessionStore.ts"),
    Path("mobile/lib/originals/triggerEngine.ts"),
    Path("mobile/lib/originals/triggerSimulation.ts"),
    Path("mobile/lib/originals/longFormScheduler.ts"),
    Path("mobile/lib/originals/types.ts"),
    Path("mobile/scripts/validate-original-long-form.ts"),
)

ORIGINAL_LONG_FORM_VALIDATION_GATES = {
    "route_end_tail_limit_s": 240,
    "trigger_to_play_latency_limit_s": 180,
    "capacity_guard_s": 30,
    "speed_fixtures_mph": [15, 36, 65, 75],
}
ORIGINAL_LONG_FORM_INVARIANTS = (
    "hard_preemption_preserves_position",
    "restart_restores_explicit_selection",
    "parked_requires_explicit_confirmation",
    "completion_requires_hard_route_completion",
    "optional_ids_absent_from_hard_progress",
)

ORIGINAL_LONG_FORM_CHECKED_DELIVERY_EVIDENCE = {
    (
        "great_smoky_mountains_ridges_rivers_living_memory",
        "roaring_fork",
        "one_way",
    ): {
        "evidence_id": "smokies_roaring_fork_delivery_v2",
        "artifact_path": LONG_FORM_PREFLIGHT_PATH,
        "readiness_path": LONG_FORM_READINESS_PATH,
    },
}


def _trusted_source_sha256(paths: Iterable[Path], label: str) -> str:
    digest = hashlib.sha256()
    for relative_path in paths:
        path = REPO_ROOT / relative_path
        if not path.is_file():
            raise OriginalValidationRunnerError(
                f"Trusted {label} source is unavailable at {relative_path.as_posix()}"
            )
        content = path.read_bytes()
        digest.update(relative_path.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(content)).encode("ascii"))
        digest.update(b"\0")
        digest.update(content)
        digest.update(b"\0")
    return digest.hexdigest()


def _canonical_json_value(value: Any) -> Any:
    """Match JSON.stringify number/object canonicalization for cross-language hashes."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [_canonical_json_value(item) for item in value]
    if isinstance(value, dict):
        return {
            key: _canonical_json_value(item)
            for key, item in sorted(value.items())
        }
    return value


def trusted_originals_validator_source_sha256() -> str:
    """Hash the executable validator source set so friendly-version drift cannot pass."""
    return _trusted_source_sha256(TRUSTED_VALIDATOR_SOURCE_PATHS, "validator")


def trusted_originals_long_form_validator_source_paths() -> tuple[Path, ...]:
    """Close the checked mobile source set over every relative TS dependency."""
    discovered = set(TRUSTED_LONG_FORM_VALIDATOR_SOURCE_PATHS)
    pending = [
        path for path in discovered if path.suffix in {".ts", ".tsx", ".js", ".jsx"}
    ]
    import_re = re.compile(
        r"(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\()\s*['\"]((?:\.[^'\"]+|@/[^'\"]+))['\"]"
    )
    while pending:
        relative = pending.pop()
        source_path = REPO_ROOT / relative
        if not source_path.is_file():
            continue
        for specifier in import_re.findall(
            source_path.read_text(encoding="utf-8")
        ):
            unresolved = (
                REPO_ROOT / "mobile" / specifier[2:]
                if specifier.startswith("@/")
                else source_path.parent / specifier
            ).resolve()
            suffixes = (
                ".native.ts", ".native.tsx", ".ios.ts", ".ios.tsx",
                ".android.ts", ".android.tsx", ".ts", ".tsx",
                ".native.js", ".native.jsx", ".ios.js", ".ios.jsx",
                ".android.js", ".android.jsx", ".js", ".jsx", ".json",
            )
            candidates = {
                unresolved,
                *(Path(str(unresolved) + suffix) for suffix in suffixes),
                *(unresolved / f"index{suffix}" for suffix in suffixes),
            }
            for dependency in sorted(candidates):
                if not dependency.is_file():
                    continue
                try:
                    dependency_relative = dependency.relative_to(REPO_ROOT)
                except ValueError as exc:
                    raise OriginalValidationRunnerError(
                        f"Trusted long-form source imports outside the repository: {specifier}"
                    ) from exc
                if dependency_relative in discovered:
                    continue
                discovered.add(dependency_relative)
                if dependency_relative.suffix in {".ts", ".tsx", ".js", ".jsx"}:
                    pending.append(dependency_relative)
    return tuple(sorted(discovered, key=lambda item: item.as_posix()))


def trusted_originals_long_form_validator_source_sha256() -> str:
    """Bind V3 delivery evidence to its distinct executable consumer source set."""
    return _trusted_source_sha256(
        trusted_originals_long_form_validator_source_paths(),
        "long-form validator",
    )


def _long_form_delivery_semantics_from_preflight(
    preflight: dict,
    *,
    stopped_availability_radius_m_by_id: dict[str, int | float],
) -> dict:
    entries = preflight.get("entries")
    summary = preflight.get("delivery_summary")
    capacity_rows = preflight.get("capacity_admission_input")
    if (
        not isinstance(entries, list)
        or not isinstance(summary, dict)
        or not isinstance(capacity_rows, list)
    ):
        raise OriginalValidationRunnerError(
            "Checked long-form delivery evidence is incomplete"
        )
    capacity_by_id = {
        str(row.get("id") or ""): row
        for row in capacity_rows if isinstance(row, dict)
    }
    normalized_entries: list[dict] = []
    for row in sorted(
        entries,
        key=lambda item: int(item.get("stable_order") or 0)
        if isinstance(item, dict) else 0,
    ):
        if not isinstance(row, dict) or not isinstance(row.get("delivery"), dict):
            raise OriginalValidationRunnerError(
                "Checked long-form delivery entry is invalid"
            )
        item_id = str(row.get("id") or "").strip()
        order = row.get("stable_order")
        delivery = row["delivery"]
        mode = delivery.get("mode")
        if (
            not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,239}", item_id)
            or isinstance(order, bool)
            or not isinstance(order, int)
            or order < 1
            or mode not in {
                "hard_auto", "capacity_deeper", "stopped_deeper",
                "completion_deeper",
            }
        ):
            raise OriginalValidationRunnerError(
                "Checked long-form delivery entry identity is invalid"
            )
        normalized: dict[str, Any] = {
            "id": item_id,
            "stable_order": order,
            "mode": mode,
        }
        if row.get("projected_coordinate") is not None:
            normalized["coordinates"] = copy.deepcopy(row["projected_coordinate"])
        if mode in {"hard_auto", "capacity_deeper"}:
            trigger = row.get("trigger")
            if not isinstance(trigger, dict):
                raise OriginalValidationRunnerError(
                    f"Checked long-form delivery entry {item_id} has no trigger"
                )
            normalized["trigger"] = {
                key: trigger.get(key)
                for key in (
                    "enter_radius_m", "exit_radius_m", "lead_time_s",
                    "route_progress_start_m", "route_progress_end_m",
                    "approach_bearing_deg", "bearing_tolerance_deg",
                )
                if trigger.get(key) is not None
            }
        if mode == "hard_auto":
            normalized["delivery"] = {
                "priority": delivery.get("priority"),
                "queue_policy": delivery.get("queue_policy"),
                "optional_content_may_delay": delivery.get(
                    "optional_content_may_delay"
                ),
            }
        elif mode == "capacity_deeper":
            capacity = capacity_by_id.get(item_id)
            next_hard = (
                capacity.get("next_hard_auto")
                if isinstance(capacity, dict) else None
            )
            if not isinstance(next_hard, dict):
                raise OriginalValidationRunnerError(
                    f"Checked long-form capacity entry {item_id} is incomplete"
                )
            normalized["delivery"] = {
                "admission_policy_id": delivery.get("admission_policy_id"),
                "next_hard_auto_story_id": next_hard.get("id"),
                "guard_before_next_hard_auto_window_s": delivery.get(
                    "guard_before_next_hard_auto_window_s"
                ),
                "fallback_mode": delivery.get("fallback_mode"),
                "may_queue_behind_capacity": delivery.get(
                    "may_queue_behind_capacity"
                ),
                "may_wait_for_active_hard_auto": delivery.get(
                    "may_wait_for_active_hard_auto"
                ),
            }
        elif mode == "stopped_deeper":
            normalized["delivery"] = {
                "availability": delivery.get("availability"),
                "experience_group_id": delivery.get("experience_group_id"),
                "requires_user_confirmed_parked": delivery.get(
                    "requires_user_confirmed_parked"
                ),
                "motion_inference_allowed": delivery.get(
                    "motion_inference_allowed"
                ),
                "parking_availability": delivery.get("parking_availability"),
                "parking_promise": delivery.get("parking_promise"),
                "availability_radius_m": (
                    stopped_availability_radius_m_by_id.get(item_id)
                    if delivery.get("availability")
                    == "at_landmark_user_confirmed_parked"
                    else None
                ),
            }
        else:
            normalized["delivery"] = {
                "availability": delivery.get("availability"),
                "requires_route_completion": delivery.get(
                    "requires_route_completion"
                ),
            }
        normalized_entries.append(normalized)
    expected_orders = list(range(1, len(normalized_entries) + 1))
    if [row["stable_order"] for row in normalized_entries] != expected_orders:
        raise OriginalValidationRunnerError(
            "Checked long-form delivery order is not contiguous"
        )
    return {
        "route_geometry_sha256": str(
            (preflight.get("input_bindings") or {}).get("geometry_sha256") or ""
        ),
        "route_distance_m": (preflight.get("route") or {}).get(
            "evidence_distance_m"
        ),
        "entries": normalized_entries,
        "entry_ids_by_mode": summary.get("entry_ids_by_mode"),
        "ogle_prelude_entry_ids": summary.get("ogle_prelude_entry_ids"),
    }


def _long_form_delivery_semantics_from_compiled(compiled: dict) -> dict:
    manifest = compiled.get("manifest") if isinstance(compiled, dict) else None
    selectable = compiled.get("selectable") if isinstance(compiled, dict) else None
    if not isinstance(manifest, dict) or not isinstance(selectable, dict):
        raise OriginalValidationRunnerError(
            "Compiled long-form selection is incomplete"
        )
    hard = manifest.get("stops")
    optional = selectable.get("items")
    if not isinstance(hard, list) or not isinstance(optional, list):
        raise OriginalValidationRunnerError(
            "Compiled long-form delivery items are incomplete"
        )
    total = len(hard) + len(optional)
    optional_orders = {
        int(item.get("sequence") or 0)
        for item in optional if isinstance(item, dict)
    }
    hard_orders = [order for order in range(1, total + 1) if order not in optional_orders]
    if (
        len(hard_orders) != len(hard)
        or len(optional_orders) != len(optional)
        or any(order < 1 or order > total for order in optional_orders)
    ):
        raise OriginalValidationRunnerError(
            "Compiled long-form delivery order is invalid"
        )
    entries: list[dict] = []
    for order, item in zip(hard_orders, hard):
        if not isinstance(item, dict):
            raise OriginalValidationRunnerError(
                "Compiled hard-auto delivery item is invalid"
            )
        entries.append({
            "id": str(item.get("id") or ""),
            "stable_order": order,
            "mode": "hard_auto",
            "coordinates": copy.deepcopy(item.get("coordinates")),
            "trigger": copy.deepcopy(item.get("trigger")),
            "delivery": {
                "priority": "must_play",
                "queue_policy": "durable_fifo_among_hard_auto",
                "optional_content_may_delay": False,
            },
        })
    for item in optional:
        if not isinstance(item, dict) or not isinstance(item.get("delivery"), dict):
            raise OriginalValidationRunnerError(
                "Compiled selectable delivery item is invalid"
            )
        delivery = item["delivery"]
        mode = delivery.get("mode")
        normalized: dict[str, Any] = {
            "id": str(item.get("id") or ""),
            "stable_order": int(item.get("sequence") or 0),
            "mode": mode,
        }
        if item.get("coordinates") is not None:
            normalized["coordinates"] = copy.deepcopy(item["coordinates"])
        if mode == "capacity_deeper":
            normalized["trigger"] = copy.deepcopy(item.get("trigger"))
            normalized["delivery"] = {
                key: delivery.get(key)
                for key in (
                    "admission_policy_id", "next_hard_auto_story_id",
                    "guard_before_next_hard_auto_window_s", "fallback_mode",
                    "may_queue_behind_capacity", "may_wait_for_active_hard_auto",
                )
            }
        elif mode == "stopped_deeper":
            normalized["delivery"] = {
                key: delivery.get(key)
                for key in (
                    "availability", "experience_group_id",
                    "requires_user_confirmed_parked", "motion_inference_allowed",
                    "parking_availability", "parking_promise",
                    "availability_radius_m",
                )
            }
        elif mode == "completion_deeper":
            normalized["delivery"] = {
                key: delivery.get(key)
                for key in ("availability", "requires_route_completion")
            }
        else:
            raise OriginalValidationRunnerError(
                "Compiled selectable delivery mode is unsupported"
            )
        entries.append(normalized)
    entries.sort(key=lambda item: (item["stable_order"], item["id"]))
    ids_by_mode: dict[str, list[str]] = {
        "capacity_deeper": [],
        "completion_deeper": [],
        "hard_auto": [],
        "stopped_deeper": [],
    }
    for item in entries:
        ids_by_mode[item["mode"]].append(item["id"])
    geometry = (manifest.get("route") or {}).get("geometry")
    if not isinstance(geometry, dict):
        raise OriginalValidationRunnerError(
            "Compiled long-form route geometry is invalid"
        )
    return {
        "route_geometry_sha256": hashlib.sha256(json.dumps(
            geometry, separators=(",", ":"), sort_keys=True, ensure_ascii=False,
        ).encode("utf-8")).hexdigest(),
        "route_distance_m": (manifest.get("route") or {}).get("distance_m"),
        "entries": entries,
        "entry_ids_by_mode": ids_by_mode,
        "ogle_prelude_entry_ids": [
            item["id"] for item in entries
            if item["mode"] == "stopped_deeper"
            and item["delivery"].get("experience_group_id") == "ogle_prelude"
        ],
    }


def original_long_form_preflight_binding(compiled: dict) -> dict:
    """Resolve and verify checked delivery evidence for one exact selection."""
    manifest = compiled.get("manifest") if isinstance(compiled, dict) else None
    selection = compiled.get("selection") if isinstance(compiled, dict) else None
    if not isinstance(manifest, dict) or not isinstance(selection, dict):
        raise OriginalValidationRunnerError(
            "Compiled long-form selection is invalid"
        )
    key = (
        str(manifest.get("pack_id") or "").strip(),
        str(selection.get("chapter_id") or "").strip(),
        str(selection.get("variant_id") or "").strip(),
    )
    registry = ORIGINAL_LONG_FORM_CHECKED_DELIVERY_EVIDENCE.get(key)
    if registry is None:
        raise OriginalValidationRunnerError(
            "No checked long-form delivery evidence is registered for this chapter variant"
        )
    artifact_path = registry["artifact_path"]
    readiness_path = registry["readiness_path"]
    path = REPO_ROOT / artifact_path
    if not path.is_file():
        raise OriginalValidationRunnerError("S3G long-form preflight is unavailable")
    raw = path.read_bytes()
    try:
        preflight = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OriginalValidationRunnerError("S3G long-form preflight is invalid") from exc
    runtime = preflight.get("runtime_capacity") if isinstance(preflight, dict) else None
    inputs = preflight.get("input_bindings") if isinstance(preflight, dict) else None
    if (
        preflight.get("schema_version") != 2
        or preflight.get("authoring_only") is not True
        or preflight.get("product_id") != key[0]
        or preflight.get("chapter_id") != key[1]
        or preflight.get("variant_id") != key[2]
        or not isinstance(runtime, dict)
        or runtime.get("gates_weakened") is not False
        or runtime.get("route_end_audio_backlog_limit_s") != 240
        or runtime.get("trigger_to_play_latency_limit_s") != 180
        or runtime.get("capacity_hard_auto_guard_s") != 30
        or not isinstance(inputs, dict)
    ):
        raise OriginalValidationRunnerError(
            "S3G long-form preflight safety contract is invalid"
        )
    input_paths = (
        ("editorial_packet_path", "editorial_packet_sha256"),
        ("official_route_evidence_path", "official_route_evidence_sha256"),
        ("source_dossier_path", "source_dossier_sha256"),
    )
    for path_key, hash_key in input_paths:
        relative = str(inputs.get(path_key) or "").strip()
        expected = str(inputs.get(hash_key) or "").strip().lower()
        source_path = REPO_ROOT / relative
        if (
            not relative
            or not re.fullmatch(r"[a-f0-9]{64}", expected)
            or not source_path.is_file()
            or hashlib.sha256(source_path.read_bytes()).hexdigest() != expected
        ):
            raise OriginalValidationRunnerError(
                f"S3G long-form preflight input {path_key} drifted"
            )
    frozen_sources = runtime.get("source_sha256_by_path")
    if (
        not isinstance(frozen_sources, dict)
        or not frozen_sources
        or any(
            not isinstance(source_path, str)
            or not re.fullmatch(r"[a-f0-9]{64}", str(source_hash or ""))
            for source_path, source_hash in frozen_sources.items()
        )
    ):
        raise OriginalValidationRunnerError(
            "S3G long-form runtime source baseline is invalid"
        )
    canonical_inputs = json.dumps(
        inputs, separators=(",", ":"), sort_keys=True, ensure_ascii=False,
    ).encode("utf-8")
    canonical_sources = json.dumps(
        frozen_sources, separators=(",", ":"), sort_keys=True, ensure_ascii=False,
    ).encode("utf-8")
    readiness_file = REPO_ROOT / readiness_path
    if not readiness_file.is_file():
        raise OriginalValidationRunnerError(
            "Checked long-form consumer readiness evidence is unavailable"
        )
    readiness_raw = readiness_file.read_bytes()
    try:
        readiness = json.loads(readiness_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OriginalValidationRunnerError(
            "Checked long-form consumer readiness evidence is invalid"
        ) from exc
    readiness_sources = (
        readiness.get("source_sha256_by_path")
        if isinstance(readiness, dict) else None
    )
    stopped_radius_by_id = (
        readiness.get("stopped_availability_radius_m_by_id")
        if isinstance(readiness, dict) else None
    )
    expected_readiness_paths = {
        relative.as_posix()
        for relative in trusted_originals_long_form_validator_source_paths()
        if relative != readiness_path
    }
    if (
        readiness.get("schema_version") != 1
        or readiness.get("kind") != "original_long_form_consumer_readiness"
        or readiness.get("evidence_id") != registry["evidence_id"]
        or readiness.get("product_id") != key[0]
        or readiness.get("chapter_id") != key[1]
        or readiness.get("variant_id") != key[2]
        or readiness.get("preflight_sha256") != hashlib.sha256(raw).hexdigest()
        or readiness.get("consumer_delivery_modes_supported") is not True
        or readiness.get("consumer_runtime_status") != "ready_for_real_audio_validation"
        or readiness.get("real_audio_required") is not True
        or readiness.get("authoring_estimates_accepted") is not False
        or readiness.get("gates") != ORIGINAL_LONG_FORM_VALIDATION_GATES
        or not isinstance(stopped_radius_by_id, dict)
        or set(stopped_radius_by_id) != {"rf_story_06"}
        or stopped_radius_by_id.get("rf_story_06") != 250
        or not isinstance(readiness_sources, dict)
        or set(readiness_sources) != expected_readiness_paths
    ):
        raise OriginalValidationRunnerError(
            "Checked long-form consumer readiness contract is invalid"
        )
    for relative, expected_hash in readiness_sources.items():
        source_path = REPO_ROOT / relative
        if (
            not re.fullmatch(r"[a-f0-9]{64}", str(expected_hash or ""))
            or not source_path.is_file()
            or hashlib.sha256(source_path.read_bytes()).hexdigest() != expected_hash
        ):
            raise OriginalValidationRunnerError(
                f"Checked long-form consumer readiness source drifted: {relative}"
            )
    expected_semantics = _long_form_delivery_semantics_from_preflight(
        preflight,
        stopped_availability_radius_m_by_id=stopped_radius_by_id,
    )
    actual_semantics = _long_form_delivery_semantics_from_compiled(compiled)
    semantic_hash = hashlib.sha256(json.dumps(
        _canonical_json_value(expected_semantics),
        separators=(",", ":"), sort_keys=True, ensure_ascii=False,
    ).encode("utf-8")).hexdigest()
    if (
        readiness.get("delivery_semantics_sha256") != semantic_hash
        or actual_semantics != expected_semantics
    ):
        raise OriginalValidationRunnerError(
            "Compiled long-form delivery semantics drifted from checked evidence"
        )
    canonical_readiness_sources = json.dumps(
        readiness_sources,
        separators=(",", ":"), sort_keys=True, ensure_ascii=False,
    ).encode("utf-8")
    return {
        "schema_version": 1,
        "evidence_id": registry["evidence_id"],
        "product_id": key[0],
        "chapter_id": key[1],
        "variant_id": key[2],
        "artifact_path": artifact_path.as_posix(),
        "artifact_sha256": hashlib.sha256(raw).hexdigest(),
        "readiness_artifact_path": readiness_path.as_posix(),
        "readiness_artifact_sha256": hashlib.sha256(readiness_raw).hexdigest(),
        "readiness_source_set_sha256": hashlib.sha256(
            canonical_readiness_sources
        ).hexdigest(),
        "input_bindings_sha256": hashlib.sha256(canonical_inputs).hexdigest(),
        "s3g_runtime_source_baseline_sha256": hashlib.sha256(
            canonical_sources
        ).hexdigest(),
        "semantic_contract_sha256": semantic_hash,
    }


def original_long_form_audio_binding(compiled: dict) -> dict:
    """Hash verified narration, transcript, provenance, duration, and referenced art."""
    if not isinstance(compiled, dict):
        raise OriginalValidationRunnerError("Compiled long-form selection is invalid")
    manifest = compiled.get("manifest")
    selectable = compiled.get("selectable")
    evidence = compiled.get("audio_evidence")
    if not isinstance(manifest, dict) or not isinstance(selectable, dict):
        raise OriginalValidationRunnerError("Compiled long-form selection is incomplete")
    if (
        not isinstance(evidence, dict)
        or evidence.get("schema_version") != 2
        or evidence.get("source") != "server_verified_publication_metadata"
        or not isinstance(evidence.get("items"), list)
    ):
        raise OriginalValidationRunnerError(
            "Long-form validation requires server-verified narration publication evidence"
        )
    assets = manifest.get("assets")
    if not isinstance(assets, list):
        raise OriginalValidationRunnerError("Compiled narration assets are missing")
    assets_by_id: dict[str, dict] = {}
    for asset in assets:
        if not isinstance(asset, dict):
            raise OriginalValidationRunnerError("Compiled narration asset is invalid")
        asset_id = str(asset.get("id") or "").strip()
        if not asset_id or asset_id in assets_by_id:
            raise OriginalValidationRunnerError("Compiled narration asset ids are invalid")
        assets_by_id[asset_id] = asset
    references: list[tuple[str, str, float, str, str | None]] = []
    hard_items = manifest.get("stops")
    optional_items = selectable.get("items")
    if not isinstance(hard_items, list) or not isinstance(optional_items, list):
        raise OriginalValidationRunnerError("Compiled narrative items are missing")
    for item in [*hard_items, *optional_items]:
        if not isinstance(item, dict):
            raise OriginalValidationRunnerError("Compiled narrative item is invalid")
        item_id = str(item.get("id") or "").strip()
        asset_id = str(item.get("audio_asset_id") or "").strip()
        if not item_id or not asset_id:
            raise OriginalValidationRunnerError("Compiled narrative audio identity is missing")
        duration_s = item.get("audio_duration_s")
        if (
            isinstance(duration_s, bool)
            or not isinstance(duration_s, (int, float))
            or not math.isfinite(float(duration_s))
            or duration_s <= 0
        ):
            raise OriginalValidationRunnerError(
                f"Narrative item {item_id} has an invalid declared audio duration"
            )
        transcript = " ".join(str(item.get("transcript") or "").split())
        if not transcript:
            raise OriginalValidationRunnerError(
                f"Narrative item {item_id} has no reviewed transcript"
            )
        artwork_id = item.get("artwork_asset_id")
        if artwork_id is not None:
            artwork_id = str(artwork_id).strip()
            if not artwork_id:
                raise OriginalValidationRunnerError(
                    f"Narrative item {item_id} artwork identity is invalid"
                )
        references.append((item_id, asset_id, float(duration_s), transcript, artwork_id))
    references.sort(key=lambda item: (item[0], item[1]))
    if not references:
        raise OriginalValidationRunnerError(
            "Long-form validation requires real narration assets"
        )
    if len({item_id for item_id, *_ in references}) != len(references):
        raise OriginalValidationRunnerError("Compiled narrative item ids are duplicated")
    evidence_by_id: dict[str, dict] = {}
    for evidence_item in evidence["items"]:
        if not isinstance(evidence_item, dict):
            raise OriginalValidationRunnerError(
                "Server-probed narration duration evidence is invalid"
            )
        item_id = str(evidence_item.get("item_id") or "").strip()
        if not item_id or item_id in evidence_by_id:
            raise OriginalValidationRunnerError(
                "Server-probed narration duration evidence ids are invalid"
            )
        evidence_by_id[item_id] = evidence_item
    if set(evidence_by_id) != {item_id for item_id, *_ in references}:
        raise OriginalValidationRunnerError(
            "Server-probed narration duration evidence coverage is incomplete"
        )
    binding: list[dict] = []
    sha_re = re.compile(r"^[a-f0-9]{64}$")
    empty_generator_sha256 = hashlib.sha256(b"{}").hexdigest()
    for item_id, asset_id, duration_s, transcript, artwork_id in references:
        asset = assets_by_id.get(asset_id)
        if not isinstance(asset, dict):
            raise OriginalValidationRunnerError(
                f"Narrative item {item_id} has no verified narration asset"
            )
        byte_count = asset.get("bytes")
        sha256 = str(asset.get("sha256") or "").strip().lower()
        if (
            asset.get("kind") != "narration"
            or isinstance(byte_count, bool)
            or not isinstance(byte_count, int)
            or byte_count <= 0
            or not sha_re.fullmatch(sha256)
        ):
            raise OriginalValidationRunnerError(
                f"Narrative item {item_id} has no verified narration asset"
            )
        evidence_item = evidence_by_id[item_id]
        transcript_sha256 = hashlib.sha256(transcript.encode("utf-8")).hexdigest()
        manifest_duration_ms = int(math.floor(duration_s * 1000 + 0.5))
        probed_duration_ms = evidence_item.get("probed_duration_ms")
        if (
            evidence_item.get("audio_asset_id") != asset_id
            or evidence_item.get("asset_sha256") != sha256
            or evidence_item.get("asset_bytes") != byte_count
            or evidence_item.get("transcript_sha256") != transcript_sha256
            or evidence_item.get("manifest_duration_ms") != manifest_duration_ms
            or isinstance(probed_duration_ms, bool)
            or not isinstance(probed_duration_ms, int)
            or probed_duration_ms <= 0
            or abs(manifest_duration_ms - probed_duration_ms)
            > max(250, int(math.floor(probed_duration_ms * 0.05 + 0.5)))
        ):
            raise OriginalValidationRunnerError(
                f"Narrative item {item_id} does not match its verified narration evidence"
            )
        generator = evidence_item.get("generator")
        if not isinstance(generator, dict):
            raise OriginalValidationRunnerError(
                f"Narrative item {item_id} generator evidence is missing"
            )
        generated = generator.get("generated")
        generator_hash = str(generator.get("metadata_sha256") or "").lower()
        provider = generator.get("provider")
        model_id = generator.get("model_id")
        voice_id = generator.get("voice_id")
        license_attested = generator.get("commercial_license_attested")
        if generated is True:
            if (
                provider not in {"elevenlabs", "cartesia"}
                or not str(model_id or "").strip()
                or not str(voice_id or "").strip()
                or license_attested is not True
                or not sha_re.fullmatch(generator_hash)
            ):
                raise OriginalValidationRunnerError(
                    f"Narrative item {item_id} generator or commercial license evidence is invalid"
                )
        elif generated is False:
            if (
                provider is not None
                or model_id is not None
                or voice_id is not None
                or license_attested is not False
                or generator_hash != empty_generator_sha256
            ):
                raise OriginalValidationRunnerError(
                    f"Narrative item {item_id} non-generated narration evidence is invalid"
                )
        else:
            raise OriginalValidationRunnerError(
                f"Narrative item {item_id} generator evidence is invalid"
            )
        artwork_binding = None
        evidence_artwork = evidence_item.get("artwork")
        if artwork_id is not None:
            artwork_asset = assets_by_id.get(artwork_id)
            if (
                not isinstance(artwork_asset, dict)
                or artwork_asset.get("kind") != "image"
                or not str(artwork_asset.get("mime_type") or "").startswith("image/")
            ):
                raise OriginalValidationRunnerError(
                    f"Narrative item {item_id} has no verified artwork asset"
                )
            artwork_bytes = artwork_asset.get("bytes")
            artwork_sha256 = str(artwork_asset.get("sha256") or "").strip().lower()
            if (
                isinstance(artwork_bytes, bool)
                or not isinstance(artwork_bytes, int)
                or artwork_bytes <= 0
                or not sha_re.fullmatch(artwork_sha256)
                or not isinstance(evidence_artwork, dict)
                or evidence_artwork.get("asset_id") != artwork_id
                or evidence_artwork.get("asset_sha256") != artwork_sha256
                or evidence_artwork.get("asset_bytes") != artwork_bytes
                or isinstance(evidence_artwork.get("width"), bool)
                or not isinstance(evidence_artwork.get("width"), int)
                or evidence_artwork["width"] < 320
                or isinstance(evidence_artwork.get("height"), bool)
                or not isinstance(evidence_artwork.get("height"), int)
                or evidence_artwork["height"] < 180
            ):
                raise OriginalValidationRunnerError(
                    f"Narrative item {item_id} artwork does not match its verified media evidence"
                )
            artwork_binding = {
                "asset_bytes": artwork_bytes,
                "asset_id": artwork_id,
                "asset_sha256": artwork_sha256,
                "height": evidence_artwork["height"],
                "width": evidence_artwork["width"],
            }
        elif evidence_artwork is not None:
            raise OriginalValidationRunnerError(
                f"Narrative item {item_id} has unexpected artwork evidence"
            )
        binding.append({
            "asset_bytes": byte_count,
            "asset_id": asset_id,
            "asset_sha256": sha256,
            "artwork": artwork_binding,
            "generator": {
                "commercial_license_attested": license_attested,
                "generated": generated,
                "metadata_sha256": generator_hash,
                "model_id": model_id,
                "provider": provider,
                "voice_id": voice_id,
            },
            "item_id": item_id,
            "manifest_duration_ms": manifest_duration_ms,
            "probed_duration_ms": probed_duration_ms,
            "transcript_sha256": transcript_sha256,
        })
    encoded = json.dumps(
        binding,
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
    ).encode("utf-8")
    return {
        "binding_sha256": hashlib.sha256(encoded).hexdigest(),
        "referenced_item_count": len(binding),
        "unique_asset_count": len({item["asset_id"] for item in binding}),
        "verified_artwork_count": sum(item["artwork"] is not None for item in binding),
        "verified_generated_asset_count": len({
            item["asset_id"] for item in binding if item["generator"]["generated"]
        }),
    }


def original_route_geometry_sha256(coordinates: list) -> str:
    canonical = ";".join(
        f"{float(point[0]):.7f},{float(point[1]):.7f}"
        for point in coordinates
    )
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def _bounded_json(value: Any, label: str, maximum_bytes: int) -> Any:
    try:
        encoded = json.dumps(value, separators=(",", ":"), sort_keys=True)
    except (TypeError, ValueError) as exc:
        raise OriginalValidationRunnerError(f"Validator {label} is not JSON serializable") from exc
    if len(encoded.encode("utf-8")) > maximum_bytes:
        raise OriginalValidationRunnerError(f"Validator {label} is too large")
    return value


def normalize_original_validation_output(
    raw: Any,
    *,
    manifest: dict,
    required_scenario_ids: Iterable[str],
    expected_engine_version: str,
    expected_validator_source_sha256: str,
) -> dict:
    if not isinstance(raw, dict) or raw.get("schema_version") != 1:
        raise OriginalValidationRunnerError("Validator returned an unsupported schema")
    if raw.get("engine_version") != expected_engine_version:
        raise OriginalValidationRunnerError("Validator engine version does not match the publication gate")
    if raw.get("validator_source_sha256") != expected_validator_source_sha256:
        raise OriginalValidationRunnerError("Validator source hash does not match the publication gate")
    identity = raw.get("manifest")
    expected_identity = {
        "pack_id": manifest.get("pack_id"),
        "version": manifest.get("version"),
        "manifest_id": manifest.get("manifest_id"),
    }
    if not isinstance(identity, dict) or any(identity.get(key) != value for key, value in expected_identity.items()):
        raise OriginalValidationRunnerError("Validator report is for a different manifest")

    required_ids = tuple(str(value) for value in required_scenario_ids)
    scenarios = raw.get("scenarios")
    if not isinstance(scenarios, list) or len(scenarios) > 100:
        raise OriginalValidationRunnerError("Validator scenarios are missing or invalid")
    normalized_scenarios: list[dict] = []
    seen: set[str] = set()
    for scenario in scenarios:
        if not isinstance(scenario, dict):
            raise OriginalValidationRunnerError("Validator scenarios must be objects")
        scenario_id = str(scenario.get("id") or "").strip()
        if not scenario_id or len(scenario_id) > 120 or scenario_id in seen:
            raise OriginalValidationRunnerError("Validator scenario ids must be unique identifiers")
        seen.add(scenario_id)
        issues = scenario.get("issues") or []
        if not isinstance(issues, list) or len(issues) > 100:
            raise OriginalValidationRunnerError(f"Validator scenario {scenario_id} has invalid issues")
        clean_issues: list[str] = []
        for issue in issues:
            clean = str(issue or "").strip()
            if not clean or len(clean) > 1000:
                raise OriginalValidationRunnerError(f"Validator scenario {scenario_id} has an invalid issue")
            clean_issues.append(clean)
        stops = scenario.get("stops") or []
        if not isinstance(stops, list) or len(stops) > 500:
            raise OriginalValidationRunnerError(f"Validator scenario {scenario_id} has invalid stop results")
        metrics = scenario.get("metrics") or {}
        if not isinstance(metrics, dict):
            raise OriginalValidationRunnerError(f"Validator scenario {scenario_id} has invalid metrics")
        normalized_scenarios.append({
            "id": scenario_id,
            "required": scenario_id in required_ids,
            "passed": scenario.get("passed") is True,
            "issues": clean_issues,
            "metrics": _bounded_json(metrics, f"scenario {scenario_id} metrics", 128 * 1024),
            "stops": _bounded_json(stops, f"scenario {scenario_id} stops", 512 * 1024),
        })

    missing = [scenario_id for scenario_id in required_ids if scenario_id not in seen]
    if missing:
        raise OriginalValidationRunnerError(
            "Validator omitted required scenarios: " + ", ".join(missing)
        )
    required_results = [item for item in normalized_scenarios if item["required"]]
    passed = bool(required_results) and all(item["passed"] for item in required_results)
    if bool(raw.get("passed")) != passed:
        raise OriginalValidationRunnerError("Validator pass summary disagrees with required scenarios")
    route_summary = raw.get("route_summary")
    if not isinstance(route_summary, dict):
        raise OriginalValidationRunnerError("Validator route summary is missing")
    expected_geometry_hash = original_route_geometry_sha256(
        manifest.get("route", {}).get("geometry", {}).get("coordinates") or [],
    )
    if route_summary.get("geometry_sha256") != expected_geometry_hash:
        raise OriginalValidationRunnerError("Validator route summary is for different geometry")
    clean_route_summary = {"geometry_sha256": expected_geometry_hash}
    for key in (
        "coordinate_count", "distance_m", "maximum_segment_m",
        "discontinuity_count", "self_intersection_count", "stop_projection_failures",
    ):
        value = route_summary.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise OriginalValidationRunnerError(f"Validator route summary has invalid {key}")
        clean_route_summary[key] = value
    failed_ids = [item["id"] for item in required_results if not item["passed"]]
    return {
        "schema_version": 1,
        "engine_version": expected_engine_version,
        "validator_source_sha256": expected_validator_source_sha256,
        "manifest": expected_identity,
        "passed": passed,
        "summary": {
            "required": len(required_results),
            "passed": len(required_results) - len(failed_ids),
            "failed": len(failed_ids),
            "stop_count": len(manifest.get("stops") or []),
        },
        "route_summary": clean_route_summary,
        "scenarios": normalized_scenarios,
        "issues": [f"Scenario failed: {scenario_id}" for scenario_id in failed_ids],
    }


def run_originals_validation_cli(
    manifest: dict,
    *,
    required_scenario_ids: Iterable[str],
    expected_engine_version: str,
    expected_validator_source_sha256: str | None = None,
    timeout_seconds: int = DEFAULT_VALIDATOR_TIMEOUT_SECONDS,
) -> dict:
    if not RUNNER_PATH.is_file():
        raise OriginalValidationRunnerError(f"Trusted validator is unavailable at {RUNNER_PATH}")
    source_sha256 = (
        str(expected_validator_source_sha256 or "").strip().lower()
        or trusted_originals_validator_source_sha256()
    )
    if len(source_sha256) != 64 or any(character not in "0123456789abcdef" for character in source_sha256):
        raise OriginalValidationRunnerError("Trusted validator source hash is invalid")
    payload = {
        "schema_version": 1,
        "manifest": manifest,
        "options": {
            "scenario_ids": list(required_scenario_ids),
            "validator_source_sha256": source_sha256,
        },
    }
    tsx_import = "tsx"
    if not (REPO_ROOT / "node_modules" / "tsx").is_dir():
        local_loader = MOBILE_ROOT / "node_modules" / "tsx" / "dist" / "loader.mjs"
        if local_loader.is_file():
            # Developer/test fallback only. Production installs the root
            # dependency declared by the deployable service package.
            tsx_import = local_loader.as_uri()
    command = [
        os.getenv("TRAILHEAD_ORIGINALS_NODE_BINARY", "node"),
        "--import",
        tsx_import,
        str(RUNNER_PATH.relative_to(REPO_ROOT)),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            input=json.dumps(payload, separators=(",", ":")),
            text=True,
            capture_output=True,
            timeout=max(5, min(int(timeout_seconds), MAX_VALIDATOR_TIMEOUT_SECONDS)),
            check=False,
            env={**os.environ, "NO_COLOR": "1"},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise OriginalValidationRunnerError("Trusted validator could not complete") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()[-1:] or [""]
        raise OriginalValidationRunnerError(
            "Trusted validator failed" + (f": {detail[0][:500]}" if detail[0] else "")
        )
    output = completed.stdout.encode("utf-8")
    if not output or len(output) > MAX_OUTPUT_BYTES:
        raise OriginalValidationRunnerError("Trusted validator returned an invalid output size")
    try:
        raw = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise OriginalValidationRunnerError("Trusted validator returned malformed JSON") from exc
    return normalize_original_validation_output(
        raw,
        manifest=manifest,
        required_scenario_ids=required_scenario_ids,
        expected_engine_version=expected_engine_version,
        expected_validator_source_sha256=source_sha256,
    )


def normalize_original_long_form_validation_output(
    raw: Any,
    *,
    compiled: dict,
    expected_validator_source_sha256: str,
) -> dict:
    """Accept only a complete, source-bound V3 delivery characterization."""
    if not isinstance(raw, dict) or raw.get("schema_version") != 1:
        raise OriginalValidationRunnerError(
            "Long-form validator returned an unsupported schema"
        )
    if raw.get("report_type") != "OriginalLongFormDeliveryValidationReportV1":
        raise OriginalValidationRunnerError("Long-form validator report type is invalid")
    if raw.get("contract_id") != "originals_long_form_delivery_v1":
        raise OriginalValidationRunnerError("Long-form validator contract is invalid")
    if raw.get("validator_source_sha256") != expected_validator_source_sha256:
        raise OriginalValidationRunnerError(
            "Long-form validator source hash does not match the publication gate"
        )
    selection = compiled.get("selection") if isinstance(compiled, dict) else None
    selectable = compiled.get("selectable") if isinstance(compiled, dict) else None
    if not isinstance(selection, dict) or not isinstance(selectable, dict):
        raise OriginalValidationRunnerError("Compiled long-form selection is incomplete")
    expected_selection = {
        key: selection.get(key)
        for key in (
            "validation_selection_id",
            "chapter_id",
            "variant_id",
            "delivery_contract_sha256",
        )
    }
    if raw.get("selection") != expected_selection:
        raise OriginalValidationRunnerError(
            "Long-form validator report is for a different selection"
        )
    delivery_hash = str(selection.get("delivery_contract_sha256") or "").strip().lower()
    if (
        not re.fullmatch(r"[a-f0-9]{64}", delivery_hash)
        or raw.get("delivery_contract_sha256") != delivery_hash
        or selectable.get("delivery_contract_sha256") != delivery_hash
    ):
        raise OriginalValidationRunnerError(
            "Long-form validator delivery contract hash does not match"
        )
    if raw.get("gates") != ORIGINAL_LONG_FORM_VALIDATION_GATES:
        raise OriginalValidationRunnerError(
            "Long-form validator changed a source-controlled safety gate"
        )
    expected_audio = original_long_form_audio_binding(compiled)
    if raw.get("audio") != expected_audio:
        raise OriginalValidationRunnerError(
            "Long-form validator narration binding does not match verified audio"
        )
    expected_preflight = original_long_form_preflight_binding(compiled)
    if raw.get("preflight") != expected_preflight:
        raise OriginalValidationRunnerError(
            "Long-form validator S3G preflight binding does not match"
        )

    characterization = raw.get("characterization")
    if not isinstance(characterization, dict):
        raise OriginalValidationRunnerError(
            "Long-form validator characterization is missing"
        )
    if (
        characterization.get("schema_version") != 1
        or characterization.get("delivery_contract_sha256") != delivery_hash
    ):
        raise OriginalValidationRunnerError(
            "Long-form characterization is for a different contract"
        )
    invariants = characterization.get("invariants")
    if (
        not isinstance(invariants, dict)
        or set(invariants) != set(ORIGINAL_LONG_FORM_INVARIANTS)
        or any(invariants.get(key) is not True for key in ORIGINAL_LONG_FORM_INVARIANTS)
    ):
        raise OriginalValidationRunnerError(
            "Long-form runtime invariants did not all pass"
        )
    expected_capacity_ids = [
        str(item.get("id") or "")
        for item in sorted(
            (
                item for item in selectable.get("items") or []
                if isinstance(item, dict)
                and isinstance(item.get("delivery"), dict)
                and item["delivery"].get("mode") == "capacity_deeper"
            ),
            key=lambda item: (int(item.get("sequence") or 0), str(item.get("id") or "")),
        )
    ]
    fixtures = characterization.get("speed_fixtures")
    if not isinstance(fixtures, list) or len(fixtures) != 4:
        raise OriginalValidationRunnerError(
            "Long-form validator omitted required speed fixtures"
        )
    normalized_fixtures: list[dict] = []
    allowed_decisions = {
        "admitted", "already_complete", "audio_busy", "before_window",
        "insufficient_capacity", "invalid_contract", "no_candidate",
        "outside_radius", "poor_accuracy", "stale_fix", "waiting_for_dwell",
        "waiting_for_fixes",
    }
    for index, fixture in enumerate(fixtures):
        expected_speed = ORIGINAL_LONG_FORM_VALIDATION_GATES[
            "speed_fixtures_mph"
        ][index]
        if not isinstance(fixture, dict) or fixture.get("speed_mph") != expected_speed:
            raise OriginalValidationRunnerError(
                "Long-form validator speed fixtures are incomplete or reordered"
            )
        capacity_items = fixture.get("capacity_items")
        if not isinstance(capacity_items, list):
            raise OriginalValidationRunnerError(
                f"Long-form {expected_speed} mph fixture is invalid"
            )
        ids = [str(item.get("item_id") or "") for item in capacity_items if isinstance(item, dict)]
        if ids != expected_capacity_ids or len(ids) != len(capacity_items):
            raise OriginalValidationRunnerError(
                f"Long-form {expected_speed} mph fixture has wrong capacity coverage"
            )
        clean_items: list[dict] = []
        for item in capacity_items:
            expected_admitted = item.get("expected_admitted")
            observed_admitted = item.get("observed_admitted")
            decision = item.get("decision")
            available = item.get("available_audio_s")
            required = item.get("required_audio_s")
            if (
                not isinstance(expected_admitted, bool)
                or not isinstance(observed_admitted, bool)
                or expected_admitted != observed_admitted
                or decision not in allowed_decisions
                or isinstance(available, bool)
                or not isinstance(available, (int, float))
                or not math.isfinite(float(available))
                or available < 0
                or isinstance(required, bool)
                or not isinstance(required, (int, float))
                or not math.isfinite(float(required))
                or required <= 30
            ):
                raise OriginalValidationRunnerError(
                    f"Long-form {expected_speed} mph capacity result did not pass"
                )
            clean_items.append({
                "item_id": item["item_id"],
                "expected_admitted": expected_admitted,
                "observed_admitted": observed_admitted,
                "decision": decision,
                "available_audio_s": available,
                "required_audio_s": required,
            })
        normalized_fixtures.append({
            "speed_mph": expected_speed,
            "capacity_items": clean_items,
        })
    derived_valid = all(invariants.values()) and all(
        item["expected_admitted"] == item["observed_admitted"]
        for fixture in normalized_fixtures
        for item in fixture["capacity_items"]
    )
    if characterization.get("valid") is not derived_valid or not derived_valid:
        raise OriginalValidationRunnerError(
            "Long-form validator pass summary disagrees with its evidence"
        )
    delivery_metrics = raw.get("delivery_metrics")
    metric_fixtures = (
        delivery_metrics.get("speed_fixtures")
        if isinstance(delivery_metrics, dict) else None
    )
    if (
        not isinstance(delivery_metrics, dict)
        or delivery_metrics.get("schema_version") != 1
        or delivery_metrics.get("duration_basis") != "server_probed_immutable_audio"
        or not isinstance(metric_fixtures, list)
        or len(metric_fixtures) != 4
    ):
        raise OriginalValidationRunnerError(
            "Long-form validator did not compute delivery timing metrics"
        )
    normalized_metrics: list[dict] = []
    capacity_id_set = set(expected_capacity_ids)
    for index, fixture in enumerate(metric_fixtures):
        speed = ORIGINAL_LONG_FORM_VALIDATION_GATES["speed_fixtures_mph"][index]
        if not isinstance(fixture, dict) or fixture.get("speed_mph") != speed:
            raise OriginalValidationRunnerError(
                "Long-form delivery timing fixtures are incomplete or reordered"
            )
        route_travel = fixture.get("route_travel_s")
        tail = fixture.get("route_end_backlog_audio_s")
        latency = fixture.get("maximum_trigger_to_play_latency_s")
        admitted = fixture.get("admitted_capacity_ids")
        rejected = fixture.get("rejected_capacity_ids")
        if (
            any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                or value < 0
                for value in (route_travel, tail, latency)
            )
            or not isinstance(admitted, list)
            or not isinstance(rejected, list)
            or len(admitted) != len(set(admitted))
            or len(rejected) != len(set(rejected))
            or set(admitted).intersection(rejected)
            or set(admitted).union(rejected) != capacity_id_set
            or tail > ORIGINAL_LONG_FORM_VALIDATION_GATES["route_end_tail_limit_s"]
            or latency > ORIGINAL_LONG_FORM_VALIDATION_GATES[
                "trigger_to_play_latency_limit_s"
            ]
            or fixture.get("within_limits") is not True
        ):
            raise OriginalValidationRunnerError(
                f"Long-form {speed} mph delivery timing exceeded its publication gate"
            )
        normalized_metrics.append({
            "speed_mph": speed,
            "route_travel_s": route_travel,
            "route_end_backlog_audio_s": tail,
            "maximum_trigger_to_play_latency_s": latency,
            "admitted_capacity_ids": admitted,
            "rejected_capacity_ids": rejected,
            "within_limits": True,
        })
    if delivery_metrics.get("valid") is not True:
        raise OriginalValidationRunnerError(
            "Long-form delivery timing pass summary disagrees with its evidence"
        )
    if raw.get("passed") is not True:
        raise OriginalValidationRunnerError("Long-form delivery validation did not pass")
    issues = raw.get("issues")
    if issues != []:
        raise OriginalValidationRunnerError(
            "Passing long-form delivery validation cannot contain issues"
        )
    return {
        "schema_version": 1,
        "report_type": "OriginalLongFormDeliveryValidationReportV1",
        "contract_id": "originals_long_form_delivery_v1",
        "validator_source_sha256": expected_validator_source_sha256,
        "selection": expected_selection,
        "delivery_contract_sha256": delivery_hash,
        "audio": expected_audio,
        "preflight": expected_preflight,
        "gates": dict(ORIGINAL_LONG_FORM_VALIDATION_GATES),
        "characterization": {
            "schema_version": 1,
            "delivery_contract_sha256": delivery_hash,
            "speed_fixtures": normalized_fixtures,
            "invariants": {key: True for key in ORIGINAL_LONG_FORM_INVARIANTS},
            "valid": True,
        },
        "delivery_metrics": {
            "schema_version": 1,
            "duration_basis": "server_probed_immutable_audio",
            "speed_fixtures": normalized_metrics,
            "valid": True,
        },
        "passed": True,
        "issues": [],
    }


def run_originals_long_form_validation_cli(
    compiled: dict,
    *,
    expected_validator_source_sha256: str | None = None,
    timeout_seconds: int = DEFAULT_VALIDATOR_TIMEOUT_SECONDS,
) -> dict:
    if not LONG_FORM_RUNNER_PATH.is_file():
        raise OriginalValidationRunnerError(
            f"Trusted long-form validator is unavailable at {LONG_FORM_RUNNER_PATH}"
        )
    source_sha256 = (
        str(expected_validator_source_sha256 or "").strip().lower()
        or trusted_originals_long_form_validator_source_sha256()
    )
    if not re.fullmatch(r"[a-f0-9]{64}", source_sha256):
        raise OriginalValidationRunnerError(
            "Trusted long-form validator source hash is invalid"
        )
    selection = compiled.get("selection") if isinstance(compiled, dict) else None
    if not isinstance(selection, dict):
        raise OriginalValidationRunnerError("Compiled long-form selection is invalid")
    delivery_hash = str(selection.get("delivery_contract_sha256") or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", delivery_hash):
        raise OriginalValidationRunnerError(
            "Compiled long-form delivery contract hash is invalid"
        )
    audio = original_long_form_audio_binding(compiled)
    preflight = original_long_form_preflight_binding(compiled)
    payload = {
        "schema_version": 1,
        "compiled": compiled,
        "options": {
            "validator_source_sha256": source_sha256,
            "delivery_contract_sha256": delivery_hash,
            "audio_binding_sha256": audio["binding_sha256"],
            "preflight": preflight,
        },
    }
    tsx_import = "tsx"
    if not (REPO_ROOT / "node_modules" / "tsx").is_dir():
        local_loader = MOBILE_ROOT / "node_modules" / "tsx" / "dist" / "loader.mjs"
        if local_loader.is_file():
            tsx_import = local_loader.as_uri()
    command = [
        os.getenv("TRAILHEAD_ORIGINALS_NODE_BINARY", "node"),
        "--import",
        tsx_import,
        str(LONG_FORM_RUNNER_PATH.relative_to(REPO_ROOT)),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            input=json.dumps(payload, separators=(",", ":")),
            text=True,
            capture_output=True,
            timeout=max(5, min(int(timeout_seconds), MAX_VALIDATOR_TIMEOUT_SECONDS)),
            check=False,
            env={**os.environ, "NO_COLOR": "1"},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise OriginalValidationRunnerError(
            "Trusted long-form validator could not complete"
        ) from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()[-1:] or [""]
        raise OriginalValidationRunnerError(
            "Trusted long-form validator failed"
            + (f": {detail[0][:500]}" if detail[0] else "")
        )
    output = completed.stdout.encode("utf-8")
    if not output or len(output) > MAX_OUTPUT_BYTES:
        raise OriginalValidationRunnerError(
            "Trusted long-form validator returned an invalid output size"
        )
    try:
        raw = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise OriginalValidationRunnerError(
            "Trusted long-form validator returned malformed JSON"
        ) from exc
    return normalize_original_long_form_validation_output(
        raw,
        compiled=compiled,
        expected_validator_source_sha256=source_sha256,
    )


def _route_haversine_m(a: list[float], b: list[float]) -> float:
    lng1, lat1 = map(math.radians, a)
    lng2, lat2 = map(math.radians, b)
    delta_lat = lat2 - lat1
    delta_lng = lng2 - lng1
    hav = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(min(1.0, math.sqrt(hav)))


def _route_coordinate_chunks(coordinates: list[list[float]]) -> list[tuple[int, list[list[float]]]]:
    """Cover every authored segment with small, overlapping map-match requests."""
    if len(coordinates) <= MAX_ROUTE_NETWORK_CHUNK_POINTS:
        return [(0, coordinates)]
    chunks: list[tuple[int, list[list[float]]]] = []
    start = 0
    while start < len(coordinates) - 1:
        end = min(len(coordinates), start + MAX_ROUTE_NETWORK_CHUNK_POINTS)
        chunk = coordinates[start:end]
        if len(chunk) < 2:
            break
        chunks.append((start, chunk))
        if end == len(coordinates):
            break
        start = end - ROUTE_NETWORK_CHUNK_OVERLAP_POINTS
    return chunks


def _request_valhalla_json(
    request: urllib_request.Request,
    *,
    timeout_seconds: int,
    label: str,
) -> Any:
    try:
        with urllib_request.urlopen(
            request,
            timeout=max(5, min(int(timeout_seconds), 60)),
        ) as response:
            raw = response.read(MAX_ROUTE_NETWORK_RESPONSE_BYTES + 1)
    except (OSError, urllib_error.URLError, urllib_error.HTTPError) as exc:
        raise OriginalValidationRunnerError(
            f"Valhalla {label} is unavailable"
        ) from exc
    if len(raw) > MAX_ROUTE_NETWORK_RESPONSE_BYTES:
        raise OriginalValidationRunnerError(f"Valhalla {label} response is too large")
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OriginalValidationRunnerError(f"Valhalla returned malformed {label}") from exc


def _valhalla_status(base_url: str, timeout_seconds: int) -> dict[str, str]:
    request = urllib_request.Request(
        base_url + "/status",
        headers={"Accept": "application/json"},
        method="GET",
    )
    result = _request_valhalla_json(
        request,
        timeout_seconds=timeout_seconds,
        label="status",
    )
    if not isinstance(result, dict):
        raise OriginalValidationRunnerError("Valhalla status metadata is unusable")
    provider_version = str(result.get("version") or "").strip()
    graph_version_value = result.get("tileset_last_modified")
    if (
        not provider_version
        or isinstance(graph_version_value, (bool, dict, list))
        or graph_version_value is None
        or graph_version_value == ""
    ):
        raise OriginalValidationRunnerError(
            "Valhalla status must identify both provider and graph versions"
        )
    return {
        "provider_version": provider_version[:120],
        "graph_version": str(graph_version_value)[:120],
    }


def _canonical_edge_id(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("value", "id"):
            if value.get(key) not in {None, ""}:
                value = value[key]
                break
    if isinstance(value, (bool, dict, list)) or value is None or value == "":
        return ""
    return str(value)


def _matched_coordinate(point: dict) -> list[float] | None:
    candidate = point.get("point") if isinstance(point.get("point"), dict) else point
    try:
        lat = float(candidate.get("lat"))
        lng = float(candidate.get("lon", candidate.get("lng")))
    except (AttributeError, TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lng) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
        return None
    return [lng, lat]


def _decode_valhalla_polyline6(value: Any) -> list[list[float]]:
    """Decode Valhalla's encoded route shape into [longitude, latitude] points."""
    encoded = str(value or "")
    if not encoded:
        raise OriginalValidationRunnerError("Valhalla matched route shape is missing")
    coordinates: list[list[float]] = []
    index = 0
    latitude = 0
    longitude = 0
    factor = 1_000_000.0
    while index < len(encoded):
        deltas = []
        for _axis in range(2):
            result = 0
            shift = 0
            while True:
                if index >= len(encoded):
                    raise OriginalValidationRunnerError("Valhalla matched route shape is invalid")
                byte = ord(encoded[index]) - 63
                index += 1
                if byte < 0 or byte > 0x3F or shift > 60:
                    raise OriginalValidationRunnerError("Valhalla matched route shape is invalid")
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        latitude += deltas[0]
        longitude += deltas[1]
        lng = longitude / factor
        lat = latitude / factor
        if not -180 <= lng <= 180 or not -90 <= lat <= 90:
            raise OriginalValidationRunnerError("Valhalla matched route shape is invalid")
        coordinates.append([lng, lat])
    if len(coordinates) < 2:
        raise OriginalValidationRunnerError("Valhalla matched route shape is incomplete")
    return coordinates


def _surface_class(value: Any) -> str:
    surface = str(value or "").strip().lower().replace("-", "_")
    if surface in {"paved", "paved_smooth", "paved_rough"}:
        return "paved"
    if surface in {
        "unpaved", "compacted", "dirt", "earth", "gravel", "fine_gravel",
        "ground", "mud", "path", "sand", "wood", "impassable",
    }:
        return "unpaved"
    return "unknown"


def _parse_override_datetime(value: Any, label: str) -> datetime:
    raw = str(value or "").strip()
    if "T" not in raw or (
        not raw.endswith("Z") and raw[-6:-5] not in {"+", "-"}
    ):
        raise OriginalValidationRunnerError(f"{label} must be a timezone-aware ISO date-time")
    try:
        parsed = datetime.fromisoformat(raw[:-1] + "+00:00" if raw.endswith("Z") else raw)
    except ValueError as exc:
        raise OriginalValidationRunnerError(f"{label} is invalid") from exc
    if parsed.tzinfo is None:
        raise OriginalValidationRunnerError(f"{label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _parse_citation_date(value: Any) -> date:
    raw = str(value or "").strip()
    try:
        if "T" in raw:
            return _parse_override_datetime(raw, "Override source reviewed_at").date()
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise OriginalValidationRunnerError("Override source reviewed_at is invalid") from exc


_OVERRIDABLE_NETWORK_FINDINGS = {
    "private_or_restricted_access",
    "destination_only",
    "not_through",
    "seasonal_access",
    "restricted_road_use",
    "unpaved_surface",
}


def _configured_original_validation_area_target(
    required_area_id: str,
    configured_area_urls: str,
) -> dict:
    """Resolve one existing area target without changing or exposing global config."""

    raw = str(configured_area_urls or "").strip()
    if not raw:
        raise OriginalValidationRunnerError(
            "Configured Valhalla area targets are unavailable"
        )
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = []
        for chunk in raw.split(";"):
            parts = [part.strip() for part in chunk.split("|")]
            if len(parts) < 6:
                continue
            parsed.append({
                "id": parts[0],
                "url": parts[1],
                "bounds": {
                    "s": parts[2], "w": parts[3],
                    "n": parts[4], "e": parts[5],
                },
            })
    if isinstance(parsed, dict):
        parsed = parsed.get("areas")
    if not isinstance(parsed, list):
        raise OriginalValidationRunnerError(
            "Configured Valhalla area targets are invalid"
        )

    matches = [
        item for item in parsed
        if isinstance(item, dict)
        and str(item.get("id") or item.get("name") or "").strip()
        == required_area_id
    ]
    if len(matches) != 1:
        raise OriginalValidationRunnerError(
            "Required Valhalla validation area target is unavailable or ambiguous"
        )
    match = matches[0]
    url = str(match.get("url") or "").strip().rstrip("/")
    parsed_url = urlsplit(url)
    if (
        parsed_url.scheme not in {"http", "https"}
        or not parsed_url.netloc
        or parsed_url.username is not None
        or parsed_url.password is not None
        or bool(parsed_url.query)
        or bool(parsed_url.fragment)
    ):
        raise OriginalValidationRunnerError(
            "Required Valhalla validation area URL is invalid"
        )
    bounds = match.get("bounds")
    if not isinstance(bounds, dict):
        raise OriginalValidationRunnerError(
            "Required Valhalla validation area bounds are unavailable"
        )
    try:
        clean_bounds = {
            key: float(bounds[key]) for key in ("s", "w", "n", "e")
        }
    except (KeyError, TypeError, ValueError) as exc:
        raise OriginalValidationRunnerError(
            "Required Valhalla validation area bounds are invalid"
        ) from exc
    if (
        any(not math.isfinite(value) for value in clean_bounds.values())
        or not -90 <= clean_bounds["s"] < clean_bounds["n"] <= 90
        or not -180 <= clean_bounds["w"] < clean_bounds["e"] <= 180
    ):
        raise OriginalValidationRunnerError(
            "Required Valhalla validation area bounds are invalid"
        )
    return {"id": required_area_id, "url": url, "bounds": clean_bounds}


def trusted_original_route_network_validation_target(
    selection_item: dict,
    *,
    configured_area_urls: str,
) -> dict | None:
    """Resolve the existing area target authorized for exact Roaring Fork R2.

    The raw configured URL is returned only to the trusted caller. Durable
    evidence receives only the target ID and its canonical binding hash, not
    the internal URL, and neither the draft nor the process-global Valhalla
    configuration is changed.
    """

    manifest = selection_item.get("manifest") if isinstance(selection_item, dict) else None
    selection = selection_item.get("selection") if isinstance(selection_item, dict) else None
    if not isinstance(manifest, dict):
        raise OriginalValidationRunnerError(
            "Trusted route-network target selection is invalid"
        )
    # Schema V1 compiles as the root manifest with no chapter/variant
    # selection. It is outside the source-controlled RF target registry.
    if selection is None:
        return None
    if not isinstance(selection, dict):
        raise OriginalValidationRunnerError(
            "Trusted route-network target selection is invalid"
        )
    key = (
        str(manifest.get("pack_id") or "").strip(),
        str(selection.get("chapter_id") or "").strip(),
        str(selection.get("variant_id") or "").strip(),
    )
    expected_key = (
        "great_smoky_mountains_ridges_rivers_living_memory",
        "roaring_fork",
        "one_way",
    )
    if key != expected_key:
        return None

    path = REPO_ROOT / ROARING_FORK_ROUTE_NETWORK_TARGET_PATH
    if not path.is_file():
        raise OriginalValidationRunnerError(
            "Checked Roaring Fork route-network target evidence is unavailable"
        )
    raw = path.read_bytes()
    try:
        artifact = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OriginalValidationRunnerError(
            "Checked Roaring Fork route-network target evidence is invalid"
        ) from exc
    expected_keys = {
        "schema_version", "kind", "evidence_id", "product_id", "chapter_id",
        "variant_id", "geometry_sha256", "delivery_contract_sha256",
        "required_area_id", "require_full_geometry_within_configured_bounds",
        "authorization",
    }
    expected_authorization = {
        "decision": "allow_validation_only_route_target",
        "project_owner_authorized": True,
        "source_task_id": "019fe9fb-cafa-75d3-b663-1e5051731cd5",
        "draft_mutation_authorized": False,
        "global_valhalla_reconfiguration_authorized": False,
        "public_release_authorized": False,
        "cultural_scope_expansion_authorized": False,
    }
    if (
        not isinstance(artifact, dict)
        or set(artifact) != expected_keys
        or artifact.get("schema_version") != 1
        or artifact.get("kind")
        != "original_route_network_validation_target_authorization"
        or artifact.get("evidence_id")
        != "smokies_roaring_fork_route_network_validation_target_20260810_v1"
        or (
            artifact.get("product_id"), artifact.get("chapter_id"),
            artifact.get("variant_id"),
        ) != expected_key
        or artifact.get("required_area_id") != "south_tn"
        or artifact.get("require_full_geometry_within_configured_bounds") is not True
        or artifact.get("authorization") != expected_authorization
    ):
        raise OriginalValidationRunnerError(
            "Checked Roaring Fork route-network target contract is invalid"
        )

    coordinates = manifest.get("route", {}).get("geometry", {}).get("coordinates") or []
    geometry_sha256 = original_route_geometry_sha256(coordinates)
    delivery_contract_sha256 = str(
        selection.get("delivery_contract_sha256") or ""
    ).strip().lower()
    if (
        artifact.get("geometry_sha256") != geometry_sha256
        or artifact.get("delivery_contract_sha256") != delivery_contract_sha256
    ):
        raise OriginalValidationRunnerError(
            "Checked Roaring Fork route-network target addresses different R2 input"
        )

    target = _configured_original_validation_area_target(
        "south_tn", configured_area_urls,
    )
    bounds = target["bounds"]
    for index, point in enumerate(coordinates):
        try:
            lng, lat = float(point[0]), float(point[1])
        except (IndexError, TypeError, ValueError) as exc:
            raise OriginalValidationRunnerError(
                f"Roaring Fork validation coordinate {index + 1} is invalid"
            ) from exc
        if not (
            bounds["s"] <= lat <= bounds["n"]
            and bounds["w"] <= lng <= bounds["e"]
        ):
            raise OriginalValidationRunnerError(
                "Roaring Fork R2 geometry is outside the configured south_tn target"
            )

    configuration_binding = {
        "id": target["id"],
        "bounds": bounds,
        "url": target["url"],
    }
    evidence = {
        "schema_version": 1,
        "evidence_id": artifact["evidence_id"],
        "evidence_sha256": hashlib.sha256(raw).hexdigest(),
        "geometry_sha256": geometry_sha256,
        "delivery_contract_sha256": delivery_contract_sha256,
        "target_id": target["id"],
        "target_binding_sha256": hashlib.sha256(json.dumps(
            configuration_binding,
            separators=(",", ":"), sort_keys=True, ensure_ascii=False,
        ).encode("utf-8")).hexdigest(),
        "route_point_count": len(coordinates),
        "validation_only": True,
        "draft_mutated": False,
        "global_config_mutated": False,
        "public_release_authorized": False,
    }
    return {"valhalla_url": target["url"], "evidence": evidence}


def _validated_route_network_override(
    manifest: dict,
    finding_codes: set[str],
    finding_evidence: list[dict] | None = None,
) -> dict:
    review = manifest.get("review") if isinstance(manifest.get("review"), dict) else {}
    override = review.get("route_network_override")
    if not isinstance(override, dict):
        message = (
            "Route-network restrictions require an approved official-source-backed override: "
            + ", ".join(sorted(finding_codes))
        )
        evidence_samples = []
        for code in sorted(finding_codes):
            sample = next((
                item for item in (finding_evidence or [])
                if isinstance(item, dict) and item.get("code") == code
            ), None)
            coordinate = sample.get("coordinate") if isinstance(sample, dict) else None
            if (
                isinstance(coordinate, list) and len(coordinate) == 2
                and all(isinstance(value, (int, float)) for value in coordinate)
            ):
                evidence_samples.append(
                    f"{code} at {float(coordinate[1]):.6f},{float(coordinate[0]):.6f}"
                )
        if evidence_samples:
            message += ". Evidence: " + "; ".join(evidence_samples)
        raise OriginalValidationRunnerError(message)
    expected_keys = {
        "schema_version", "status", "finding_codes", "reason",
        "official_source_url", "approved_at", "approved_by_admin_user_id",
    }
    if set(override) != expected_keys or override.get("schema_version") != 1 or override.get("status") != "approved":
        raise OriginalValidationRunnerError("Route-network override structure is invalid")
    raw_codes = override.get("finding_codes")
    if (
        not isinstance(raw_codes, list)
        or any(not isinstance(code, str) for code in raw_codes)
        or len(raw_codes) != len(set(raw_codes))
        or set(raw_codes) != finding_codes
        or not set(raw_codes) <= _OVERRIDABLE_NETWORK_FINDINGS
    ):
        raise OriginalValidationRunnerError(
            "Route-network override findings must exactly match the current restrictions"
        )
    reason = str(override.get("reason") or "").strip()
    source_url = str(override.get("official_source_url") or "").strip()
    admin_id = override.get("approved_by_admin_user_id")
    if not 20 <= len(reason) <= 2000:
        raise OriginalValidationRunnerError("Route-network override needs a specific reason")
    if not source_url.startswith("https://") or len(source_url) > 2000:
        raise OriginalValidationRunnerError("Route-network override needs an HTTPS official source")
    if isinstance(admin_id, bool) or not isinstance(admin_id, int) or admin_id < 1:
        raise OriginalValidationRunnerError("Route-network override needs an approving admin")
    now = datetime.now(timezone.utc)
    approved_at = _parse_override_datetime(override.get("approved_at"), "Override approved_at")
    if approved_at > now + timedelta(minutes=5) or approved_at < now - timedelta(days=ROUTE_NETWORK_OVERRIDE_MAX_AGE_DAYS):
        raise OriginalValidationRunnerError("Route-network override approval is not current")

    matching_citation: dict | None = None
    for stop in manifest.get("stops") or []:
        for citation in stop.get("citations") or []:
            if (
                isinstance(citation, dict)
                and citation.get("url") == source_url
                and citation.get("role") == "operational"
                and citation.get("authority") == "official"
            ):
                matching_citation = citation
                break
        if matching_citation:
            break
    if not matching_citation:
        raise OriginalValidationRunnerError(
            "Route-network override source must match an official operational citation"
        )
    reviewed_on = _parse_citation_date(matching_citation.get("reviewed_at"))
    if reviewed_on > now.date() or reviewed_on < now.date() - timedelta(days=ROUTE_NETWORK_OVERRIDE_MAX_AGE_DAYS):
        raise OriginalValidationRunnerError("Route-network override source review is not current")
    required_scopes = {"route"}
    if finding_codes & {"private_or_restricted_access", "destination_only", "not_through", "restricted_road_use"}:
        required_scopes.add("access")
    if "seasonal_access" in finding_codes:
        required_scopes.add("closures")
    if "unpaved_surface" in finding_codes:
        required_scopes.add("surface")
    scopes = set(matching_citation.get("scope") or [])
    if not required_scopes <= scopes:
        raise OriginalValidationRunnerError(
            "Route-network override citation is missing required scopes: "
            + ", ".join(sorted(required_scopes - scopes))
        )
    return {
        "schema_version": 1,
        "finding_codes": sorted(finding_codes),
        "reason": reason,
        "official_source_url": source_url,
        "official_source_title": str(matching_citation.get("title") or "")[:300],
        "source_reviewed_at": str(matching_citation.get("reviewed_at")),
        "approved_at": approved_at.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "approved_by_admin_user_id": admin_id,
    }


def validate_original_route_network(
    manifest: dict,
    *,
    valhalla_url: str,
    timeout_seconds: int = 25,
) -> dict:
    """Map-match every authored segment and fail closed on incomplete road evidence."""
    raw_coordinates = manifest.get("route", {}).get("geometry", {}).get("coordinates") or []
    if not isinstance(raw_coordinates, list) or len(raw_coordinates) < 2:
        raise OriginalValidationRunnerError("Authored route has no map-matchable geometry")
    coordinates: list[list[float]] = []
    for index, point in enumerate(raw_coordinates):
        try:
            lng, lat = float(point[0]), float(point[1])
        except (IndexError, TypeError, ValueError) as exc:
            raise OriginalValidationRunnerError(
                f"Authored route coordinate {index + 1} is invalid"
            ) from exc
        if not math.isfinite(lng) or not math.isfinite(lat) or not -180 <= lng <= 180 or not -90 <= lat <= 90:
            raise OriginalValidationRunnerError(f"Authored route coordinate {index + 1} is invalid")
        coordinates.append([lng, lat])
    segment_lengths = [
        _route_haversine_m(start, end)
        for start, end in zip(coordinates, coordinates[1:])
    ]
    maximum_segment = max(segment_lengths, default=0.0)
    if maximum_segment > MAX_AUTHORED_ROUTE_SEGMENT_M:
        raise OriginalValidationRunnerError(
            "Authored route geometry is too sparse for whole-route validation "
            f"({maximum_segment:.0f} m maximum segment)"
        )

    base_url = str(valhalla_url or "").strip().rstrip("/")
    if not base_url.startswith(("https://", "http://")):
        raise OriginalValidationRunnerError("Configured Valhalla URL is invalid")
    status_before = _valhalla_status(base_url, timeout_seconds)
    chunks = _route_coordinate_chunks(coordinates)
    authored_surface = str(manifest.get("access", {}).get("surface") or "").strip().lower()
    total_matched = 0
    total_edges = 0
    total_network_distance_m = 0.0
    total_authored_chunk_distance_m = 0.0
    maximum_offset_m = 0.0
    discontinuities = 0
    unique_trace_edge_ids: set[str] = set()
    unpaved_edge_ids: set[str] = set()
    restricted_edge_ids: set[str] = set()
    findings: set[str] = set()
    finding_evidence: list[dict] = []
    finding_evidence_keys: set[tuple] = set()
    osm_changesets: set[str] = set()
    located_edge_ids: set[str] = set()
    access_evidence_count = 0
    provider_seasonal_field_seen = False

    def record_finding_evidence(
        code: str,
        *,
        source: str,
        edge_id: str,
        coordinate: list[float] | None,
        use: str,
        surface: str,
    ) -> None:
        restricted_edge_ids.add(edge_id)
        rounded_coordinate = (
            [round(float(coordinate[0]), 6), round(float(coordinate[1]), 6)]
            if isinstance(coordinate, list) and len(coordinate) == 2 else None
        )
        key = (
            code,
            source,
            edge_id,
            tuple(rounded_coordinate) if rounded_coordinate else None,
        )
        if key in finding_evidence_keys or len(finding_evidence) >= 200:
            return
        finding_evidence_keys.add(key)
        finding_evidence.append({
            "code": code,
            "source": source,
            "edge_id": edge_id,
            "coordinate": rounded_coordinate,
            "use": use,
            "surface": surface,
        })

    trace_attributes = [
        "edge.id", "edge.length", "edge.surface", "edge.unpaved", "edge.use",
        "edge.begin_shape_index", "edge.end_shape_index",
        "edge.traversability", "edge.travel_mode", "edge.vehicle_type",
        "matched.point", "matched.type", "matched.edge_index",
        "matched.begin_route_discontinuity", "matched.end_route_discontinuity",
        "matched.distance_along_edge", "shape",
    ]
    restricted_uses = {
        "construction", "impassable", "steps", "ferry", "rail_ferry",
        "rail-ferry", "track", "driveway", "parking_aisle",
    }
    for chunk_number, (start_index, chunk) in enumerate(chunks, start=1):
        trace_payload = {
            "shape": [{"lat": point[1], "lon": point[0]} for point in chunk],
            "costing": "auto",
            # Valhalla only returns the point-for-point ``matched_points``
            # evidence used below when trace matching is explicitly map_snap.
            "shape_match": "map_snap",
            "directions_options": {"units": "kilometers"},
            "trace_options": {
                "gps_accuracy": 20,
                "search_radius": 75,
                "breakage_distance": 2_000,
                # This is authored geometry, not a noisy GPS trace. Disable
                # Meili interpolation so each coordinate is edge-bound.
                "interpolation_distance": 0,
            },
            "filters": {"action": "include", "attributes": trace_attributes},
        }
        trace_request = urllib_request.Request(
            base_url + "/trace_attributes",
            data=json.dumps(trace_payload, separators=(",", ":")).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        result = _request_valhalla_json(
            trace_request,
            timeout_seconds=timeout_seconds,
            label=f"trace_attributes chunk {chunk_number}",
        )
        edges = result.get("edges") if isinstance(result, dict) else None
        matched = result.get("matched_points") if isinstance(result, dict) else None
        units = str(result.get("units") or "").strip().lower() if isinstance(result, dict) else ""
        if not isinstance(edges, list) or not edges or not isinstance(matched, list):
            raise OriginalValidationRunnerError(
                f"Valhalla could not map-match authored route chunk {chunk_number}"
            )
        if units not in {"kilometers", "kilometres", "km"}:
            raise OriginalValidationRunnerError("Valhalla edge-length units are missing or unusable")
        if len(matched) != len(chunk):
            raise OriginalValidationRunnerError(
                f"Valhalla did not return one matched point per authored point in chunk {chunk_number}"
            )
        matched_shape = _decode_valhalla_polyline6(result.get("shape"))
        osm_changeset = result.get("osm_changeset")
        if not isinstance(osm_changeset, (dict, list)) and osm_changeset is not None and osm_changeset != "":
            osm_changesets.add(str(osm_changeset))

        network_distance_m = 0.0
        edge_ids: list[str] = []
        edge_surfaces: list[str] = []
        edge_uses: list[str] = []
        edge_finding_codes: list[set[str]] = []
        edge_coordinates: list[list[float]] = []
        for edge_index, edge in enumerate(edges):
            if not isinstance(edge, dict):
                raise OriginalValidationRunnerError("Valhalla returned an unusable edge record")
            edge_id = _canonical_edge_id(edge.get("id"))
            surface = str(edge.get("surface") or "").strip().lower()
            surface_class = _surface_class(surface)
            use = str(edge.get("use") or "").strip().lower()
            traversability = str(edge.get("traversability") or "").strip().lower()
            travel_mode = str(edge.get("travel_mode") or "").strip().lower()
            vehicle_type = str(edge.get("vehicle_type") or "").strip().lower()
            unpaved_flag = edge.get("unpaved")
            length = edge.get("length")
            begin_shape_index = edge.get("begin_shape_index")
            end_shape_index = edge.get("end_shape_index")
            if (
                not edge_id or surface_class == "unknown" or not use or not traversability
                or travel_mode not in {"drive", "driving"}
                or vehicle_type not in {"car", "auto"}
                or not isinstance(unpaved_flag, bool)
                or isinstance(length, bool) or not isinstance(length, (int, float))
                or not math.isfinite(float(length)) or float(length) < 0
                or isinstance(begin_shape_index, bool) or not isinstance(begin_shape_index, int)
                or isinstance(end_shape_index, bool) or not isinstance(end_shape_index, int)
                or not 0 <= begin_shape_index < end_shape_index < len(matched_shape)
            ):
                raise OriginalValidationRunnerError(
                    f"Valhalla edge {edge_index} is missing usable driving, surface, or length attributes"
                )
            if traversability in {"none", "unreachable"}:
                raise OriginalValidationRunnerError("Valhalla matched a non-drivable edge")
            if bool(unpaved_flag) != (surface_class == "unpaved"):
                raise OriginalValidationRunnerError("Valhalla surface attributes disagree")
            current_edge_findings: set[str] = set()
            if use in restricted_uses:
                findings.add("restricted_road_use")
                current_edge_findings.add("restricted_road_use")
            if surface_class == "unpaved":
                unpaved_edge_ids.add(edge_id)
                if authored_surface == "paved":
                    findings.add("unpaved_surface")
                    current_edge_findings.add("unpaved_surface")
            network_distance_m += float(length) * 1000.0
            edge_ids.append(edge_id)
            unique_trace_edge_ids.add(edge_id)
            edge_surfaces.append(surface_class)
            edge_uses.append(use)
            edge_finding_codes.append(current_edge_findings)
            representative_segment_index = begin_shape_index + (
                end_shape_index - begin_shape_index - 1
            ) // 2
            segment_start = matched_shape[representative_segment_index]
            segment_end = matched_shape[representative_segment_index + 1]
            edge_coordinates.append([
                (segment_start[0] + segment_end[0]) / 2.0,
                (segment_start[1] + segment_end[1]) / 2.0,
            ])

        representatives: list[dict] = []
        for edge_index, edge_id in enumerate(edge_ids):
            if (
                edge_id not in located_edge_ids
                and all(item["edge_id"] != edge_id for item in representatives)
            ):
                coordinate = edge_coordinates[edge_index]
                representatives.append({
                    "edge_id": edge_id,
                    "edge_index": edge_index,
                    "lat": coordinate[1],
                    "lon": coordinate[0],
                })
        for chunk_point_index, (authored_point, matched_point) in enumerate(zip(chunk, matched)):
            if not isinstance(matched_point, dict):
                raise OriginalValidationRunnerError("Valhalla returned an unusable matched point")
            edge_index = matched_point.get("edge_index")
            if (
                isinstance(edge_index, bool) or not isinstance(edge_index, int)
                or not 0 <= edge_index < len(edges)
            ):
                route_point_number = start_index + chunk_point_index + 1
                matched_type = str(matched_point.get("type") or "unknown")
                raise OriginalValidationRunnerError(
                    "Valhalla returned an unmatched authored point at "
                    f"route coordinate {route_point_number} "
                    f"(chunk {chunk_number}, edge_index={edge_index!r}, type={matched_type})"
                )
            if (
                matched_point.get("begin_route_discontinuity") is True
                or matched_point.get("end_route_discontinuity") is True
            ):
                discontinuities += 1
            coordinate = _matched_coordinate(matched_point)
            if coordinate is None:
                raise OriginalValidationRunnerError("Valhalla matched-point geometry is missing")
            offset = _route_haversine_m(authored_point, coordinate)
            maximum_offset_m = max(maximum_offset_m, offset)
            if offset > MAX_MATCHED_POINT_OFFSET_M:
                raise OriginalValidationRunnerError(
                    f"Valhalla matched geometry deviates {offset:.0f} m from the authored route"
                )
        for edge_index, codes in enumerate(edge_finding_codes):
            for code in sorted(codes):
                record_finding_evidence(
                    code,
                    source="trace",
                    edge_id=edge_ids[edge_index],
                    coordinate=edge_coordinates[edge_index],
                    use=edge_uses[edge_index],
                    surface=edge_surfaces[edge_index],
                )
        if discontinuities:
            raise OriginalValidationRunnerError("Valhalla found a route discontinuity")

        authored_chunk_distance_m = sum(
            _route_haversine_m(start, end) for start, end in zip(chunk, chunk[1:])
        )
        distance_delta_m = abs(network_distance_m - authored_chunk_distance_m)
        allowed_delta_m = max(
            MAX_NETWORK_DISTANCE_DELTA_M,
            authored_chunk_distance_m * MAX_NETWORK_DISTANCE_DELTA_RATIO,
        )
        if distance_delta_m > allowed_delta_m:
            raise OriginalValidationRunnerError(
                "Valhalla matched distance does not follow authored route segments "
                f"in chunk {chunk_number} ({network_distance_m:.0f} m vs {authored_chunk_distance_m:.0f} m)"
            )

        if representatives:
            locate_payload = {
                "verbose": True,
                "locations": [
                    {"lat": item["lat"], "lon": item["lon"]}
                    for item in representatives
                ],
                "costing": "auto",
                "directions_options": {"units": "kilometers"},
            }
            locate_request = urllib_request.Request(
                base_url + "/locate",
                data=json.dumps(locate_payload, separators=(",", ":")).encode("utf-8"),
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                method="POST",
            )
            locate_result = _request_valhalla_json(
                locate_request,
                timeout_seconds=timeout_seconds,
                label=f"locate access evidence chunk {chunk_number}",
            )
            if not isinstance(locate_result, list) or len(locate_result) != len(representatives):
                raise OriginalValidationRunnerError("Valhalla driving-access evidence is incomplete")
            for representative, located in zip(representatives, locate_result):
                candidates = located.get("edges") if isinstance(located, dict) else None
                if not isinstance(candidates, list):
                    raise OriginalValidationRunnerError("Valhalla driving-access evidence is unusable")
                candidate = next((
                    value for value in candidates
                    if isinstance(value, dict)
                    and _canonical_edge_id(value.get("edge_id")) == representative["edge_id"]
                ), None)
                if not candidate:
                    raise OriginalValidationRunnerError(
                        "Valhalla could not bind driving-access evidence to matched edge "
                        f"{representative['edge_id']} in chunk {chunk_number} at "
                        f"{representative['lat']:.6f},{representative['lon']:.6f}"
                    )
                edge_detail = candidate.get("edge")
                if not isinstance(edge_detail, dict):
                    raise OriginalValidationRunnerError("Valhalla driving-access evidence is missing")
                access = edge_detail.get("access")
                car_access = access.get("car") if isinstance(access, dict) else None
                restriction_flag = edge_detail.get("access_restriction")
                access_restrictions = candidate.get("access_restrictions")
                classification = edge_detail.get("classification")
                located_surface = (
                    classification.get("surface") if isinstance(classification, dict) else None
                )
                located_use = str(
                    classification.get("use") if isinstance(classification, dict) else ""
                ).strip().lower()
                located_surface_class = _surface_class(located_surface)
                candidate_distance = candidate.get("distance")
                if (
                    not isinstance(car_access, bool)
                    or not isinstance(restriction_flag, bool)
                    or not isinstance(access_restrictions, list)
                    or not located_use
                    or located_surface_class == "unknown"
                    or isinstance(candidate_distance, bool)
                    or not isinstance(candidate_distance, (int, float))
                    or not math.isfinite(float(candidate_distance))
                    or not 0 <= float(candidate_distance) <= MAX_LOCATE_EDGE_DISTANCE_M
                ):
                    raise OriginalValidationRunnerError(
                        "Valhalla locate response lacks nearby car access, private/restriction, use, or surface evidence"
                    )
                for key in ("start_restriction", "end_restriction"):
                    restriction = edge_detail.get(key)
                    car_restricted = restriction.get("car") if isinstance(restriction, dict) else None
                    if not isinstance(car_restricted, bool):
                        raise OriginalValidationRunnerError(
                            f"Valhalla locate response lacks {key} car-access evidence"
                        )
                if not isinstance(edge_detail.get("part_of_complex_restriction"), bool):
                    raise OriginalValidationRunnerError(
                        "Valhalla locate response lacks complex-turn-restriction evidence"
                    )
                trace_surface_class = edge_surfaces[representative["edge_index"]]
                if located_surface_class != trace_surface_class:
                    raise OriginalValidationRunnerError(
                        "Valhalla trace and locate surface evidence disagree"
                    )
                trace_use = edge_uses[representative["edge_index"]]
                if located_use != trace_use:
                    raise OriginalValidationRunnerError(
                        "Valhalla trace and locate road-use evidence disagree"
                    )
                if car_access is not True or edge_detail.get("unreachable") is True:
                    raise OriginalValidationRunnerError("Valhalla matched an edge without car access")
                car_access_restriction = False
                for restriction_index, restriction in enumerate(access_restrictions):
                    restriction_type = (
                        str(restriction.get("type") or "").strip()
                        if isinstance(restriction, dict) else ""
                    )
                    restricted_for_car = (
                        restriction.get("car") if isinstance(restriction, dict) else None
                    )
                    if not restriction_type or not isinstance(restricted_for_car, bool):
                        raise OriginalValidationRunnerError(
                            "Valhalla locate response returned unusable access restriction "
                            f"{restriction_index + 1}"
                        )
                    car_access_restriction = car_access_restriction or restricted_for_car
                if restriction_flag is True and not access_restrictions:
                    raise OriginalValidationRunnerError(
                        "Valhalla reports restricted access without restriction details"
                    )
                if car_access_restriction:
                    findings.add("private_or_restricted_access")
                    record_finding_evidence(
                        "private_or_restricted_access",
                        source="locate",
                        edge_id=representative["edge_id"],
                        coordinate=[representative["lon"], representative["lat"]],
                        use=located_use,
                        surface=located_surface_class,
                    )
                for key, finding in (
                    ("destination_only", "destination_only"),
                    ("not_thru", "not_through"),
                ):
                    flag = edge_detail.get(key)
                    if not isinstance(flag, bool):
                        raise OriginalValidationRunnerError(
                            f"Valhalla locate response lacks {key} access evidence"
                        )
                    if flag:
                        findings.add(finding)
                        record_finding_evidence(
                            finding,
                            source="locate",
                            edge_id=representative["edge_id"],
                            coordinate=[representative["lon"], representative["lat"]],
                            use=located_use,
                            surface=located_surface_class,
                        )
                # Valhalla 3.5.x does not expose a seasonal flag in verbose
                # locate responses. Treat it as evidence when a provider does
                # expose it, while operational-source freshness remains the
                # authoritative seasonal-access gate.
                seasonal_flag = edge_detail.get("seasonal")
                provider_seasonal_field_seen = provider_seasonal_field_seen or "seasonal" in edge_detail
                if seasonal_flag is not None and not isinstance(seasonal_flag, bool):
                    raise OriginalValidationRunnerError(
                        "Valhalla locate response returned unusable seasonal access evidence"
                    )
                if seasonal_flag is True:
                    findings.add("seasonal_access")
                    record_finding_evidence(
                        "seasonal_access",
                        source="locate",
                        edge_id=representative["edge_id"],
                        coordinate=[representative["lon"], representative["lat"]],
                        use=located_use,
                        surface=located_surface_class,
                    )
                end_node_id = _canonical_edge_id(edge_detail.get("end_node"))
                nodes = located.get("nodes") if isinstance(located, dict) else None
                if end_node_id and isinstance(nodes, list):
                    bound_node = next((
                        node for node in nodes
                        if isinstance(node, dict)
                        and _canonical_edge_id(node.get("node_id")) == end_node_id
                    ), None)
                    if bound_node is not None:
                        private_access = bound_node.get("private_access")
                        if not isinstance(private_access, bool):
                            raise OriginalValidationRunnerError(
                                "Valhalla locate response returned unusable private-node evidence"
                            )
                        if private_access:
                            findings.add("private_or_restricted_access")
                            record_finding_evidence(
                                "private_or_restricted_access",
                                source="locate_node",
                                edge_id=representative["edge_id"],
                                coordinate=[representative["lon"], representative["lat"]],
                                use=located_use,
                                surface=located_surface_class,
                            )
                located_edge_ids.add(representative["edge_id"])
                access_evidence_count += 1

        total_matched += len(matched)
        total_edges += len(edges)
        total_network_distance_m += network_distance_m
        total_authored_chunk_distance_m += authored_chunk_distance_m

    missing_access_edge_ids = unique_trace_edge_ids - located_edge_ids
    if missing_access_edge_ids:
        raise OriginalValidationRunnerError(
            "Valhalla driving-access evidence does not cover every matched route edge "
            f"({len(missing_access_edge_ids)} missing)"
        )
    status_after = _valhalla_status(base_url, timeout_seconds)
    if status_after != status_before:
        raise OriginalValidationRunnerError("Valhalla provider or graph changed during validation")
    override_summary = (
        _validated_route_network_override(manifest, findings, finding_evidence)
        if findings else None
    )
    return {
        "provider": "valhalla",
        "provider_version": status_before["provider_version"],
        "graph_version": status_before["graph_version"],
        "osm_changesets": sorted(osm_changesets),
        "geometry_sha256": original_route_geometry_sha256(coordinates),
        "authored_point_count": len(coordinates),
        "sampled_point_count": len(coordinates),
        "chunk_count": len(chunks),
        "matched_point_count": total_matched,
        "edge_count": total_edges,
        "unique_edge_count": len(unique_trace_edge_ids),
        "access_evidence_edge_count": access_evidence_count,
        "provider_seasonal_field_available": provider_seasonal_field_seen,
        "seasonal_access_evidence": (
            "valhalla_and_official_operational_sources"
            if provider_seasonal_field_seen
            else "official_operational_sources"
        ),
        "maximum_authored_segment_m": maximum_segment,
        "maximum_matched_offset_m": maximum_offset_m,
        "matched_network_distance_m_with_chunk_overlap": total_network_distance_m,
        "authored_distance_m_with_chunk_overlap": total_authored_chunk_distance_m,
        "discontinuity_count": 0,
        "unmatched_point_count": 0,
        "restricted_segment_count": len(restricted_edge_ids),
        "finding_evidence": finding_evidence,
        "unpaved_segment_count": len(unpaved_edge_ids),
        "unknown_surface_segment_count": 0,
        "authored_surface": authored_surface,
        "override": override_summary,
    }
