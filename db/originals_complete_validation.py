"""Complete six-selection trusted validation dispatcher for the Smokies pack.

The checked Roaring Fork history and the five remaining readiness/target pairs
are immutable historical inputs.  Their recorded source maps describe the
reviewed snapshots; the current executable consumer is bound separately by the
complete trusted-source closure below.  No artifact is rewritten to pretend a
historical snapshot was produced by current code.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
from typing import Any

from db.originals_validation import (
    DEFAULT_VALIDATOR_TIMEOUT_SECONDS,
    LONG_FORM_RUNNER_PATH,
    MAX_OUTPUT_BYTES,
    MAX_VALIDATOR_TIMEOUT_SECONDS,
    MOBILE_ROOT,
    ORIGINAL_LONG_FORM_INVARIANTS,
    ORIGINAL_LONG_FORM_VALIDATION_GATES,
    REPO_ROOT,
    TRUSTED_LONG_FORM_VALIDATOR_SOURCE_PATHS,
    OriginalValidationRunnerError,
    _canonical_json_value,
    _configured_original_validation_area_target,
    _long_form_delivery_semantics_from_compiled,
    _long_form_delivery_semantics_from_preflight,
    original_long_form_audio_binding,
    original_route_geometry_sha256,
)


PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"
SHA256_RE = re.compile(r"[a-f0-9]{64}")

RF_PREFLIGHT = Path("originals/smokies/roaring_fork_trigger_preflight_v1.json")
RF_READINESS_V1 = Path("originals/smokies/roaring_fork_delivery_readiness_v1.json")
RF_READINESS_V2 = Path("originals/smokies/roaring_fork_delivery_readiness_v2.json")
RF_READINESS_V3 = Path("originals/smokies/roaring_fork_delivery_readiness_v3.json")
RF_TARGET = Path("originals/smokies/roaring_fork_route_network_validation_target_v1.json")

COMPLETE_LONG_FORM_EVIDENCE_ROWS: tuple[dict[str, Any], ...] = (
    {
        "key": (PRODUCT_ID, "mountain_crossing", "tn_to_nc"),
        "kind": "remaining",
        "preflight_path": None,
        "preflight_sha256": None,
        "readiness_path": Path("originals/smokies/mountain_crossing_tn_to_nc_delivery_readiness_v1.json"),
        "readiness_sha256": "05dd58aa92040f2815fdc1e8b5ddb352af1fbfa0263193093c49950359a5cfe8",
        "target_path": Path("originals/smokies/mountain_crossing_tn_to_nc_route_network_validation_target_v1.json"),
        "target_sha256": "1dd7704e476fd9df6aabe4b20771d62ddb9f1f2d257d838340757cec19fe7e2b",
    },
    {
        "key": (PRODUCT_ID, "mountain_crossing", "nc_to_tn"),
        "kind": "remaining",
        "preflight_path": None,
        "preflight_sha256": None,
        "readiness_path": Path("originals/smokies/mountain_crossing_nc_to_tn_delivery_readiness_v1.json"),
        "readiness_sha256": "d416bf0c716434f3ee651fb8fd379ca01d082d438a16130d182cb3314d905e2d",
        "target_path": Path("originals/smokies/mountain_crossing_nc_to_tn_route_network_validation_target_v1.json"),
        "target_sha256": "6ba74de0ab77e9ff12aa4e52c54377533e95a92cbf9219a254b345676dccd7c5",
    },
    {
        "key": (PRODUCT_ID, "little_river_cades_cove", "sugarlands_to_cades_cove_loop"),
        "kind": "remaining",
        "preflight_path": None,
        "preflight_sha256": None,
        "readiness_path": Path("originals/smokies/little_river_cades_cove_loop_delivery_readiness_v1.json"),
        "readiness_sha256": "00abe0b8646332d27636856ab0c9029760d6b33f6ff4215d2364c17674b3fa90",
        "target_path": Path("originals/smokies/little_river_cades_cove_loop_route_network_validation_target_v1.json"),
        "target_sha256": "59ad07c506489c036c9ff26b94c3ec11e114e22c2dc5fd3ae5a402310797acd9",
    },
    {
        "key": (PRODUCT_ID, "roaring_fork", "one_way"),
        "kind": "roaring_fork",
        "preflight_path": RF_PREFLIGHT,
        "preflight_sha256": "b7b8412e07cdef5706d814550491f8c28bfadb05d3fbef38369ec7006c3b67f3",
        "readiness_path": RF_READINESS_V3,
        "readiness_sha256": "423866158fc5d1590419076a86f1632717b314c8647adfe6f604342f808abd01",
        "target_path": RF_TARGET,
        "target_sha256": "f29b9900158659dc53c15afe8d403b808b42a3bdef75f1c024232a6c683c5119",
    },
    {
        "key": (PRODUCT_ID, "foothills_parkway", "west_to_east"),
        "kind": "remaining",
        "preflight_path": None,
        "preflight_sha256": None,
        "readiness_path": Path("originals/smokies/foothills_parkway_west_to_east_delivery_readiness_v1.json"),
        "readiness_sha256": "743719296433bb9528f88fe56aed158d8f08fb8af4a5c6fd42fc7f11610c5a6d",
        "target_path": Path("originals/smokies/foothills_parkway_west_to_east_route_network_validation_target_v1.json"),
        "target_sha256": "f534a8289d2205fb3d1f0d23736cd50a771bad657e8e9e6c855a480672c7bc5f",
    },
    {
        "key": (PRODUCT_ID, "foothills_parkway", "east_to_west"),
        "kind": "remaining",
        "preflight_path": None,
        "preflight_sha256": None,
        "readiness_path": Path("originals/smokies/foothills_parkway_east_to_west_delivery_readiness_v1.json"),
        "readiness_sha256": "2eaafeb3573a8f15aed8b6ab68a660bc00e4807a6bd1b462e2fcb88aab4bd716",
        "target_path": Path("originals/smokies/foothills_parkway_east_to_west_route_network_validation_target_v1.json"),
        "target_sha256": "9598a7080733d1f33a5c01f608419bae28bcf24f7b9d37ed3a0c838efab26171",
    },
)

EXPECTED_SELECTION_KEYS = {
    (PRODUCT_ID, "mountain_crossing", "tn_to_nc"),
    (PRODUCT_ID, "mountain_crossing", "nc_to_tn"),
    (PRODUCT_ID, "little_river_cades_cove", "sugarlands_to_cades_cove_loop"),
    (PRODUCT_ID, "roaring_fork", "one_way"),
    (PRODUCT_ID, "foothills_parkway", "west_to_east"),
    (PRODUCT_ID, "foothills_parkway", "east_to_west"),
}

IMMUTABLE_EVIDENCE_SHA256: tuple[tuple[Path, str], ...] = (
    (RF_PREFLIGHT, "b7b8412e07cdef5706d814550491f8c28bfadb05d3fbef38369ec7006c3b67f3"),
    (RF_READINESS_V1, "4a0fc760fd07790785b820af06bac4e5a10e8337ad3f6257a10a3c50464c9b67"),
    (RF_READINESS_V2, "7cf1b601d48845e3bc404a501d33a9f2c1e2567544c03347b99de0524ee923e6"),
    (RF_READINESS_V3, "423866158fc5d1590419076a86f1632717b314c8647adfe6f604342f808abd01"),
    (RF_TARGET, "f29b9900158659dc53c15afe8d403b808b42a3bdef75f1c024232a6c683c5119"),
    *((row["readiness_path"], row["readiness_sha256"]) for row in COMPLETE_LONG_FORM_EVIDENCE_ROWS if row["kind"] == "remaining"),
    *((row["target_path"], row["target_sha256"]) for row in COMPLETE_LONG_FORM_EVIDENCE_ROWS if row["kind"] == "remaining"),
)


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        _canonical_json_value(value),
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _safe_repo_path(relative: Path, label: str) -> Path:
    if relative.is_absolute() or ".." in relative.parts:
        raise OriginalValidationRunnerError(f"{label} path is invalid")
    root = REPO_ROOT.resolve()
    path = (root / relative).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise OriginalValidationRunnerError(f"{label} path escapes the repository") from exc
    return path


def _validated_registry() -> dict[tuple[str, str, str], dict[str, Any]]:
    rows = COMPLETE_LONG_FORM_EVIDENCE_ROWS
    keys = [row.get("key") for row in rows]
    readiness_paths = [row.get("readiness_path") for row in rows]
    target_paths = [row.get("target_path") for row in rows]
    registered_evidence_paths = [
        *readiness_paths,
        *target_paths,
        *(row.get("preflight_path") for row in rows if row.get("preflight_path") is not None),
    ]
    if (
        len(rows) != 6
        or set(keys) != EXPECTED_SELECTION_KEYS
        or len(set(keys)) != len(rows)
        or len(set(readiness_paths)) != len(rows)
        or len(set(target_paths)) != len(rows)
        or len(set(registered_evidence_paths)) != len(registered_evidence_paths)
    ):
        raise OriginalValidationRunnerError(
            "Complete long-form evidence registry is incomplete or duplicated"
        )
    for row in rows:
        if (
            row.get("kind") not in {"roaring_fork", "remaining"}
            or not isinstance(row.get("readiness_path"), Path)
            or not isinstance(row.get("target_path"), Path)
            or not SHA256_RE.fullmatch(str(row.get("readiness_sha256") or ""))
            or not SHA256_RE.fullmatch(str(row.get("target_sha256") or ""))
            or (row["kind"] == "roaring_fork") != isinstance(row.get("preflight_path"), Path)
            or (row["kind"] == "roaring_fork") != bool(SHA256_RE.fullmatch(str(row.get("preflight_sha256") or "")))
        ):
            raise OriginalValidationRunnerError(
                "Complete long-form evidence registry row is invalid"
            )
    return {row["key"]: row for row in rows}


def _load_immutable_evidence() -> dict[Path, tuple[dict, bytes]]:
    registry = _validated_registry()
    del registry  # registry validation is an intentional prerequisite
    paths = [path for path, _digest in IMMUTABLE_EVIDENCE_SHA256]
    if len(paths) != 15 or len(set(paths)) != 15:
        raise OriginalValidationRunnerError(
            "Complete long-form immutable evidence inventory is incomplete or duplicated"
        )
    loaded: dict[Path, tuple[dict, bytes]] = {}
    for relative, expected_sha256 in IMMUTABLE_EVIDENCE_SHA256:
        path = _safe_repo_path(relative, "Checked long-form evidence")
        if not path.is_file():
            raise OriginalValidationRunnerError(
                f"Checked long-form evidence is unavailable: {relative.as_posix()}"
            )
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected_sha256:
            raise OriginalValidationRunnerError(
                f"Checked long-form immutable evidence drifted: {relative.as_posix()}"
            )
        try:
            value = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise OriginalValidationRunnerError(
                f"Checked long-form evidence is invalid: {relative.as_posix()}"
            ) from exc
        if not isinstance(value, dict):
            raise OriginalValidationRunnerError(
                f"Checked long-form evidence is invalid: {relative.as_posix()}"
            )
        loaded[relative] = (value, raw)
    return loaded


def _selection_key(compiled: dict, label: str = "Compiled long-form selection") -> tuple[str, str, str]:
    manifest = compiled.get("manifest") if isinstance(compiled, dict) else None
    selection = compiled.get("selection") if isinstance(compiled, dict) else None
    if not isinstance(manifest, dict) or not isinstance(selection, dict):
        raise OriginalValidationRunnerError(f"{label} is invalid")
    return (
        str(manifest.get("pack_id") or "").strip(),
        str(selection.get("chapter_id") or "").strip(),
        str(selection.get("variant_id") or "").strip(),
    )


def _historical_source_map(value: Any, label: str) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        raise OriginalValidationRunnerError(f"{label} is invalid")
    for relative, digest in value.items():
        if (
            not isinstance(relative, str)
            or not relative
            or Path(relative).is_absolute()
            or ".." in Path(relative).parts
            or not SHA256_RE.fullmatch(str(digest or ""))
        ):
            raise OriginalValidationRunnerError(f"{label} is invalid")
    return value


def _validate_rf_history(loaded: dict[Path, tuple[dict, bytes]]) -> None:
    for relative in (RF_READINESS_V1, RF_READINESS_V2, RF_READINESS_V3):
        artifact = loaded[relative][0]
        if (
            artifact.get("schema_version") != 1
            or artifact.get("kind") != "original_long_form_consumer_readiness"
            or artifact.get("product_id") != PRODUCT_ID
            or artifact.get("chapter_id") != "roaring_fork"
            or artifact.get("variant_id") != "one_way"
        ):
            raise OriginalValidationRunnerError(
                "Checked Roaring Fork readiness history is invalid"
            )


def _rf_preflight_binding(
    compiled: dict,
    row: dict[str, Any],
    loaded: dict[Path, tuple[dict, bytes]],
) -> dict:
    _validate_rf_history(loaded)
    key = _selection_key(compiled)
    preflight, preflight_raw = loaded[RF_PREFLIGHT]
    readiness, readiness_raw = loaded[RF_READINESS_V3]
    runtime = preflight.get("runtime_capacity")
    inputs = preflight.get("input_bindings")
    if (
        preflight.get("schema_version") != 2
        or preflight.get("authoring_only") is not True
        or (preflight.get("product_id"), preflight.get("chapter_id"), preflight.get("variant_id")) != key
        or not isinstance(runtime, dict)
        or runtime.get("gates_weakened") is not False
        or runtime.get("route_end_audio_backlog_limit_s") != 240
        or runtime.get("trigger_to_play_latency_limit_s") != 180
        or runtime.get("capacity_hard_auto_guard_s") != 30
        or not isinstance(inputs, dict)
    ):
        raise OriginalValidationRunnerError("S3G long-form preflight safety contract is invalid")
    for path_key, hash_key in (
        ("editorial_packet_path", "editorial_packet_sha256"),
        ("official_route_evidence_path", "official_route_evidence_sha256"),
        ("source_dossier_path", "source_dossier_sha256"),
    ):
        relative = Path(str(inputs.get(path_key) or ""))
        expected = str(inputs.get(hash_key) or "").lower()
        source_path = _safe_repo_path(relative, f"S3G long-form preflight input {path_key}")
        if (
            not SHA256_RE.fullmatch(expected)
            or not source_path.is_file()
            or hashlib.sha256(source_path.read_bytes()).hexdigest() != expected
        ):
            raise OriginalValidationRunnerError(
                f"S3G long-form preflight input {path_key} drifted"
            )
    frozen_sources = _historical_source_map(
        runtime.get("source_sha256_by_path"), "S3G historical runtime source baseline"
    )
    readiness_sources = _historical_source_map(
        readiness.get("source_sha256_by_path"),
        "Checked Roaring Fork historical readiness source set",
    )
    stopped_radius = readiness.get("stopped_availability_radius_m_by_id")
    if (
        readiness.get("evidence_id") != "smokies_roaring_fork_delivery_v3"
        or (readiness.get("product_id"), readiness.get("chapter_id"), readiness.get("variant_id")) != key
        or readiness.get("preflight_sha256") != row["preflight_sha256"]
        or readiness.get("consumer_delivery_modes_supported") is not True
        or readiness.get("consumer_runtime_status") != "ready_for_real_audio_validation"
        or readiness.get("real_audio_required") is not True
        or readiness.get("authoring_estimates_accepted") is not False
        or readiness.get("gates") != ORIGINAL_LONG_FORM_VALIDATION_GATES
        or stopped_radius != {"rf_story_06": 250}
    ):
        raise OriginalValidationRunnerError(
            "Checked Roaring Fork long-form readiness contract is invalid"
        )
    expected_semantics = _long_form_delivery_semantics_from_preflight(
        preflight,
        stopped_availability_radius_m_by_id=stopped_radius,
    )
    actual_semantics = _long_form_delivery_semantics_from_compiled(compiled)
    semantic_hash = _canonical_sha256(expected_semantics)
    if (
        readiness.get("delivery_semantics_sha256") != semantic_hash
        or actual_semantics != expected_semantics
    ):
        raise OriginalValidationRunnerError(
            "Compiled Roaring Fork long-form delivery semantics drifted from checked evidence"
        )
    return {
        "schema_version": 1,
        "evidence_id": "smokies_roaring_fork_delivery_v3",
        "product_id": key[0],
        "chapter_id": key[1],
        "variant_id": key[2],
        "artifact_path": RF_PREFLIGHT.as_posix(),
        "artifact_sha256": hashlib.sha256(preflight_raw).hexdigest(),
        "readiness_artifact_path": RF_READINESS_V3.as_posix(),
        "readiness_artifact_sha256": hashlib.sha256(readiness_raw).hexdigest(),
        "readiness_source_set_sha256": _canonical_sha256(readiness_sources),
        "input_bindings_sha256": _canonical_sha256(inputs),
        "s3g_runtime_source_baseline_sha256": _canonical_sha256(frozen_sources),
        "semantic_contract_sha256": semantic_hash,
    }


def _remaining_preflight_binding(
    compiled: dict,
    row: dict[str, Any],
    loaded: dict[Path, tuple[dict, bytes]],
) -> dict:
    key = _selection_key(compiled)
    readiness, raw = loaded[row["readiness_path"]]
    semantics = readiness.get("expected_delivery_semantics")
    narration = readiness.get("narration_binding")
    if (
        readiness.get("schema_version") != 1
        or readiness.get("kind") != "original_checked_long_form_delivery_readiness"
        or (readiness.get("product_id"), readiness.get("chapter_id"), readiness.get("variant_id")) != key
        or readiness.get("consumer_delivery_modes_supported") is not True
        or readiness.get("consumer_runtime_status") != "ready_for_real_audio_validation"
        or readiness.get("real_audio_required") is not True
        or readiness.get("authoring_estimates_accepted") is not False
        or readiness.get("publication_authorized") is not False
        or readiness.get("gates") != ORIGINAL_LONG_FORM_VALIDATION_GATES
        or not isinstance(semantics, dict)
        or not isinstance(narration, dict)
    ):
        raise OriginalValidationRunnerError(
            "Checked remaining long-form readiness contract is invalid"
        )
    source_map = _historical_source_map(
        readiness.get("source_sha256_by_path"),
        "Checked remaining historical readiness source set",
    )
    semantic_hash = _canonical_sha256(semantics)
    if (
        readiness.get("delivery_semantics_sha256") != semantic_hash
        or _long_form_delivery_semantics_from_compiled(compiled) != semantics
    ):
        raise OriginalValidationRunnerError(
            "Compiled remaining long-form delivery semantics drifted from checked evidence"
        )
    requests = narration.get("effective_requests")
    request_set_hash = str(narration.get("effective_request_set_sha256") or "").lower()
    if (
        not isinstance(requests, list)
        or not SHA256_RE.fullmatch(request_set_hash)
        or request_set_hash != _canonical_sha256(requests)
    ):
        raise OriginalValidationRunnerError(
            "Checked remaining narration request set is invalid"
        )
    expected_transcripts: dict[str, str] = {}
    for request in requests:
        if not isinstance(request, dict):
            raise OriginalValidationRunnerError("Checked remaining narration request is invalid")
        entry_id = str(request.get("entry_id") or "")
        transcript_hash = str(request.get("transcript_sha256") or "").lower()
        if entry_id in expected_transcripts or not SHA256_RE.fullmatch(transcript_hash):
            raise OriginalValidationRunnerError(
                "Checked remaining narration identity is duplicated or invalid"
            )
        expected_transcripts[entry_id] = transcript_hash
    manifest = compiled.get("manifest")
    selectable = compiled.get("selectable")
    if not isinstance(manifest, dict) or not isinstance(selectable, dict):
        raise OriginalValidationRunnerError("Compiled remaining narration is invalid")
    actual_transcripts: dict[str, str] = {}
    for item in list(manifest.get("stops") or []) + list(selectable.get("items") or []):
        if not isinstance(item, dict) or not isinstance(item.get("transcript"), str):
            raise OriginalValidationRunnerError("Compiled remaining narration transcript is invalid")
        entry_id = str(item.get("id") or "")
        if entry_id in actual_transcripts:
            raise OriginalValidationRunnerError("Compiled remaining narration identity is duplicated")
        actual_transcripts[entry_id] = hashlib.sha256(
            item["transcript"].encode("utf-8")
        ).hexdigest()
    if actual_transcripts != expected_transcripts:
        raise OriginalValidationRunnerError(
            "Compiled remaining effective narration drifted from checked evidence"
        )
    return {
        "schema_version": 1,
        "evidence_id": readiness.get("evidence_id"),
        "product_id": key[0],
        "chapter_id": key[1],
        "variant_id": key[2],
        "readiness_artifact_path": row["readiness_path"].as_posix(),
        "readiness_artifact_sha256": hashlib.sha256(raw).hexdigest(),
        "readiness_source_set_sha256": _canonical_sha256(source_map),
        "semantic_contract_sha256": semantic_hash,
        "narration_request_set_sha256": request_set_hash,
        "real_audio_validation_required": True,
        "publication_authorized": False,
    }


def complete_original_long_form_preflight_binding(compiled: dict) -> dict:
    """Return the exact checked binding for one of the six registered selections."""
    key = _selection_key(compiled)
    row = _validated_registry().get(key)
    if row is None:
        raise OriginalValidationRunnerError(
            "No checked complete long-form delivery evidence is registered for this chapter variant"
        )
    loaded = _load_immutable_evidence()
    return (
        _rf_preflight_binding(compiled, row, loaded)
        if row["kind"] == "roaring_fork"
        else _remaining_preflight_binding(compiled, row, loaded)
    )


def require_complete_original_validation_selection_inventory(
    manifest: dict,
    selection_items: list[dict],
) -> None:
    """Require six exact selections for the complete Smokies V3 report."""

    if (
        not isinstance(manifest, dict)
        or manifest.get("schema_version") != 3
        or str(manifest.get("pack_id") or "").strip() != PRODUCT_ID
    ):
        return
    if not isinstance(selection_items, list) or len(selection_items) != 6:
        raise OriginalValidationRunnerError(
            "Complete Smokies validation requires exactly six selections"
        )
    keys: list[tuple[str, str, str]] = []
    contracts: list[str] = []
    for item in selection_items:
        item_manifest = item.get("manifest") if isinstance(item, dict) else None
        selection = item.get("selection") if isinstance(item, dict) else None
        compiled = item.get("long_form_compiled") if isinstance(item, dict) else None
        if (
            not isinstance(item_manifest, dict)
            or not isinstance(selection, dict)
            or not isinstance(compiled, dict)
            or not isinstance(compiled.get("selectable"), dict)
        ):
            raise OriginalValidationRunnerError(
                "Complete Smokies validation selection inventory is incomplete"
            )
        key = (
            str(item_manifest.get("pack_id") or "").strip(),
            str(selection.get("chapter_id") or "").strip(),
            str(selection.get("variant_id") or "").strip(),
        )
        contract = str(item.get("delivery_contract_sha256") or "").strip().lower()
        compiled_selection = compiled.get("selection")
        if (
            key[0] != PRODUCT_ID
            or _selection_key(compiled) != key
            or not isinstance(compiled_selection, dict)
            or not SHA256_RE.fullmatch(contract)
            or str(selection.get("delivery_contract_sha256") or "").strip().lower()
            != contract
            or str(compiled_selection.get("delivery_contract_sha256") or "").strip().lower()
            != contract
            or str(compiled["selectable"].get("delivery_contract_sha256") or "").strip().lower()
            != contract
        ):
            raise OriginalValidationRunnerError(
                "Complete Smokies validation selection inventory is invalid"
            )
        keys.append(key)
        contracts.append(contract)
    if (
        set(keys) != EXPECTED_SELECTION_KEYS
        or len(set(keys)) != 6
        or len(set(contracts)) != 6
    ):
        raise OriginalValidationRunnerError(
            "Complete Smokies validation selection inventory is missing, extra, or duplicated"
        )


def _complete_source_seeds() -> set[Path]:
    loaded = _load_immutable_evidence()
    seeds = set(TRUSTED_LONG_FORM_VALIDATOR_SOURCE_PATHS) | {
        Path("db/originals_complete_validation.py"),
        Path("db/originals_remaining_validation.py"),
        Path("mobile/lib/originals/longFormValidationEvidence.ts"),
        *(path for path, _digest in IMMUTABLE_EVIDENCE_SHA256),
    }
    for artifact, _raw in loaded.values():
        source_map = artifact.get("source_sha256_by_path")
        if isinstance(source_map, dict):
            seeds.update(Path(relative) for relative in source_map)
        runtime = artifact.get("runtime_capacity")
        if isinstance(runtime, dict) and isinstance(runtime.get("source_sha256_by_path"), dict):
            seeds.update(Path(relative) for relative in runtime["source_sha256_by_path"])
    return seeds


def _comment_safe_local_import_specifiers(source: str) -> tuple[str, ...]:
    """Find static local JS imports without treating comments/strings as code."""

    cleaned = list(source)
    code_position = [False] * len(source)
    state = "code"
    quote = ""
    escaped = False
    index = 0
    while index < len(source):
        character = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""
        if state == "code":
            if character == "/" and following == "/":
                cleaned[index] = cleaned[index + 1] = " "
                state = "line_comment"
                index += 2
                continue
            if character == "/" and following == "*":
                cleaned[index] = cleaned[index + 1] = " "
                state = "block_comment"
                index += 2
                continue
            if character in {"'", '"', "`"}:
                state = "string"
                quote = character
                escaped = False
            else:
                code_position[index] = True
            index += 1
            continue
        if state == "line_comment":
            if character in {"\n", "\r"}:
                state = "code"
                code_position[index] = True
            else:
                cleaned[index] = " "
            index += 1
            continue
        if state == "block_comment":
            if character == "*" and following == "/":
                cleaned[index] = cleaned[index + 1] = " "
                state = "code"
                index += 2
            else:
                if character not in {"\n", "\r"}:
                    cleaned[index] = " "
                index += 1
            continue
        if escaped:
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == quote:
            state = "code"
            quote = ""
        index += 1
    import_re = re.compile(
        r"(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)"
        r"['\"]((?:\.[^'\"]+|@/[^'\"]+))['\"]"
    )
    return tuple(
        match.group(1)
        for match in import_re.finditer("".join(cleaned))
        if code_position[match.start()]
    )


def trusted_complete_originals_long_form_validator_source_paths() -> tuple[Path, ...]:
    """Close the complete current source set over every local mobile import."""
    discovered = _complete_source_seeds()
    pending = [
        path for path in discovered if path.suffix in {".ts", ".tsx", ".js", ".jsx"}
    ]
    while pending:
        relative = pending.pop()
        source_path = _safe_repo_path(relative, "Trusted complete long-form source")
        if not source_path.is_file():
            raise OriginalValidationRunnerError(
                f"Trusted complete long-form source is unavailable at {relative.as_posix()}"
            )
        if source_path.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
            continue
        for specifier in _comment_safe_local_import_specifiers(
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
            resolved = False
            for dependency in sorted(candidates):
                if not dependency.is_file():
                    continue
                resolved = True
                try:
                    dependency_relative = dependency.relative_to(REPO_ROOT.resolve())
                except ValueError as exc:
                    raise OriginalValidationRunnerError(
                        f"Trusted complete long-form source imports outside the repository: {specifier}"
                    ) from exc
                if dependency_relative in discovered:
                    continue
                discovered.add(dependency_relative)
                if dependency_relative.suffix in {".ts", ".tsx", ".js", ".jsx"}:
                    pending.append(dependency_relative)
            if not resolved:
                raise OriginalValidationRunnerError(
                    "Trusted complete long-form source has an unresolved local import: "
                    f"{relative.as_posix()} -> {specifier}"
                )
    return tuple(sorted(discovered, key=lambda item: item.as_posix()))


def trusted_complete_originals_long_form_validator_source_sha256() -> str:
    digest = hashlib.sha256()
    for relative in trusted_complete_originals_long_form_validator_source_paths():
        path = _safe_repo_path(relative, "Trusted complete long-form source")
        if not path.is_file():
            raise OriginalValidationRunnerError(
                f"Trusted complete long-form source is unavailable at {relative.as_posix()}"
            )
        content = path.read_bytes()
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(content)).encode("ascii"))
        digest.update(b"\0")
        digest.update(content)
        digest.update(b"\0")
    return digest.hexdigest()


def normalize_complete_original_long_form_validation_output(
    raw: Any,
    *,
    compiled: dict,
    expected_validator_source_sha256: str,
) -> dict:
    """Accept only one complete report bound to the six-selection dispatcher."""
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
        not SHA256_RE.fullmatch(delivery_hash)
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
    expected_preflight = complete_original_long_form_preflight_binding(compiled)
    if raw.get("preflight") != expected_preflight:
        raise OriginalValidationRunnerError(
            "Long-form validator complete preflight binding does not match"
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
        ids = [
            str(item.get("item_id") or "")
            for item in capacity_items if isinstance(item, dict)
        ]
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
    if raw.get("issues") != []:
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


def run_complete_originals_long_form_validation_cli(
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
        or trusted_complete_originals_long_form_validator_source_sha256()
    )
    if not SHA256_RE.fullmatch(source_sha256):
        raise OriginalValidationRunnerError(
            "Trusted complete long-form validator source hash is invalid"
        )
    selection = compiled.get("selection") if isinstance(compiled, dict) else None
    if not isinstance(selection, dict):
        raise OriginalValidationRunnerError("Compiled long-form selection is invalid")
    delivery_hash = str(selection.get("delivery_contract_sha256") or "").strip().lower()
    if not SHA256_RE.fullmatch(delivery_hash):
        raise OriginalValidationRunnerError(
            "Compiled long-form delivery contract hash is invalid"
        )
    audio = original_long_form_audio_binding(compiled)
    preflight = complete_original_long_form_preflight_binding(compiled)
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
            "Trusted complete long-form validator could not complete"
        ) from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()[-1:] or [""]
        raise OriginalValidationRunnerError(
            "Trusted complete long-form validator failed"
            + (f": {detail[0][:500]}" if detail[0] else "")
        )
    output = completed.stdout.encode("utf-8")
    if not output or len(output) > MAX_OUTPUT_BYTES:
        raise OriginalValidationRunnerError(
            "Trusted complete long-form validator returned an invalid output size"
        )
    try:
        raw = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise OriginalValidationRunnerError(
            "Trusted complete long-form validator returned malformed JSON"
        ) from exc
    return normalize_complete_original_long_form_validation_output(
        raw,
        compiled=compiled,
        expected_validator_source_sha256=source_sha256,
    )


def complete_trusted_original_route_network_validation_target(
    selection_item: dict,
    *,
    configured_area_urls: str,
) -> dict | None:
    """Resolve the one immutable target for every registered V3 selection."""
    manifest = selection_item.get("manifest") if isinstance(selection_item, dict) else None
    selection = selection_item.get("selection") if isinstance(selection_item, dict) else None
    if not isinstance(manifest, dict):
        raise OriginalValidationRunnerError(
            "Trusted complete route target selection is invalid"
        )
    if selection is None:
        return None
    if not isinstance(selection, dict):
        raise OriginalValidationRunnerError(
            "Trusted complete route target selection is invalid"
        )
    key = (
        str(manifest.get("pack_id") or "").strip(),
        str(selection.get("chapter_id") or "").strip(),
        str(selection.get("variant_id") or "").strip(),
    )
    row = _validated_registry().get(key)
    if row is None:
        if key[0] != PRODUCT_ID:
            return None
        raise OriginalValidationRunnerError(
            "No checked complete route-network target is registered for this chapter variant"
        )
    loaded = _load_immutable_evidence()
    compiled = selection_item.get("long_form_compiled")
    if compiled is None and "selectable" in selection_item:
        compiled = selection_item
    if not isinstance(compiled, dict) or _selection_key(compiled) != key:
        raise OriginalValidationRunnerError(
            "Trusted complete route target is missing its exact long-form compilation"
        )
    preflight = complete_original_long_form_preflight_binding(compiled)
    artifact, raw = loaded[row["target_path"]]
    coordinates = (manifest.get("route") or {}).get("geometry", {}).get("coordinates")
    contract = str(selection.get("delivery_contract_sha256") or "").strip().lower()
    if not isinstance(coordinates, list) or not SHA256_RE.fullmatch(contract):
        raise OriginalValidationRunnerError(
            "Checked complete route-network target addresses invalid input"
        )
    geometry_sha256 = original_route_geometry_sha256(coordinates)
    authorization = {
        "decision": "allow_validation_only_route_target",
        "project_owner_authorized": True,
        "source_task_id": TASK_ID,
        "draft_mutation_authorized": False,
        "global_valhalla_reconfiguration_authorized": False,
        "public_release_authorized": False,
        "cultural_scope_expansion_authorized": False,
    }
    if row["kind"] == "roaring_fork":
        expected_fields = {
            "schema_version": 1,
            "kind": "original_route_network_validation_target_authorization",
            "product_id": key[0],
            "chapter_id": key[1],
            "variant_id": key[2],
            "geometry_sha256": geometry_sha256,
            "delivery_contract_sha256": contract,
            "required_area_id": "south_tn",
            "require_full_geometry_within_configured_bounds": True,
            "authorization": authorization,
        }
        for name, expected in expected_fields.items():
            if artifact.get(name) != expected:
                raise OriginalValidationRunnerError(
                    "Checked Roaring Fork route-network target contract is invalid"
                )
    else:
        expected_fields = {
            "schema_version": 2,
            "kind": "original_route_network_validation_target_authorization",
            "product_id": key[0],
            "chapter_id": key[1],
            "variant_id": key[2],
            "geometry_sha256": geometry_sha256,
            "delivery_readiness_path": row["readiness_path"].as_posix(),
            "delivery_readiness_sha256": preflight["readiness_artifact_sha256"],
            "delivery_semantics_sha256": preflight["semantic_contract_sha256"],
            "delivery_contract_binding": "resolve_exact_normalized_manifest_v3_contract_at_validation_time_after_checked_readiness",
            "required_area_id": "south_tn",
            "require_full_geometry_within_configured_bounds": True,
            "authorization": authorization,
        }
        for name, expected in expected_fields.items():
            if artifact.get(name) != expected:
                raise OriginalValidationRunnerError(
                    "Checked remaining route-network target contract is invalid"
                )
    target = _configured_original_validation_area_target(
        "south_tn", configured_area_urls
    )
    bounds = target["bounds"]
    for index, point in enumerate(coordinates):
        try:
            lng, lat = float(point[0]), float(point[1])
        except (IndexError, TypeError, ValueError) as exc:
            raise OriginalValidationRunnerError(
                f"Complete validation coordinate {index + 1} is invalid"
            ) from exc
        if (
            not math.isfinite(lng)
            or not math.isfinite(lat)
            or not bounds["s"] <= lat <= bounds["n"]
            or not bounds["w"] <= lng <= bounds["e"]
        ):
            raise OriginalValidationRunnerError(
                "Complete geometry is outside the configured south_tn target"
            )
    configuration_binding = {
        "id": target["id"],
        "bounds": bounds,
        "url": target["url"],
    }
    evidence = {
        "schema_version": 1 if row["kind"] == "roaring_fork" else 2,
        "evidence_id": artifact["evidence_id"],
        "evidence_sha256": hashlib.sha256(raw).hexdigest(),
        "geometry_sha256": geometry_sha256,
        "delivery_contract_sha256": contract,
        "target_id": target["id"],
        "target_binding_sha256": _canonical_sha256(configuration_binding),
        "route_point_count": len(coordinates),
        "validation_only": True,
        "draft_mutated": False,
        "global_config_mutated": False,
        "public_release_authorized": False,
    }
    if row["kind"] == "remaining":
        evidence.update({
            "delivery_readiness_sha256": preflight["readiness_artifact_sha256"],
            "delivery_semantics_sha256": preflight["semantic_contract_sha256"],
        })
    return {"valhalla_url": target["url"], "evidence": evidence}
