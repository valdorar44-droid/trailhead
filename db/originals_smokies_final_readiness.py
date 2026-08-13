"""Exact pre-CAS finalization-review contract for the complete Smokies draft.

The field-drive/source-review builder will eventually create the checked-in
readiness artifact consumed here. Until that artifact and its additive route
evidence exist, every apply path fails closed.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from db.originals_route_evidence import (
    OriginalRouteEvidenceError,
    SMOKIES_PUBLICATION_ROUTE_EVIDENCE,
    canonical_sha256,
    load_registered_route_evidence,
    normalize_route_evidence_binding,
    validate_manifest_route_evidence,
    validate_smokies_publication_route_evidence_document,
)


ROOT = Path(__file__).resolve().parents[1]
HISTORICAL_VALIDATION_SOURCE_PATH = (
    ROOT
    / "originals"
    / "smokies"
    / "roaring_fork_publication_readiness_inputs_v1.json"
)
HISTORICAL_VALIDATION_SOURCE_SHA256 = (
    "555c4282a39b7f1affbcd7481645bba14649235df1d693883dd0a461b41879ec"
)
HISTORICAL_VALIDATION_SOURCE_BYTE_COUNT = 4_125
FINALIZATION_REVIEW_PATH = (
    ROOT
    / "originals"
    / "smokies"
    / "smokies_full_bundle_finalization_review_v1.json"
)
FINALIZATION_REVIEW_ID = "smokies_full_bundle_finalization_review_v1"
FINALIZATION_REVIEW_KIND = "smokies_full_bundle_finalization_review"
PUBLICATION_ROUTE_EVIDENCE_ID = (
    "smokies-official-routes-2026-publication-v1"
)
PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
EXPECTED_BEFORE_DRAFT_REVISION = 4
EXPECTED_AFTER_DRAFT_REVISION = 5
CONTENT_PROJECTION_SHA256 = (
    "35414d27e5a26dcfc5ef352f94322ca1fc88d17a4977c16b32ebd53f0bcdaf16"
)
EXPECTED_OFFLINE_MAP_BYTES = 213_074_000
OPERATIONAL_POLICY_PATH = (
    ROOT / "docs" / "originals" / "smokies-operational-readiness-v1.json"
)
OPERATIONAL_POLICY_BYTE_COUNT = 8_016
OPERATIONAL_POLICY_FILE_SHA256 = (
    "359c8e2ff8086de56054d99503cb2661730a9977534c3007ff4c6d0db2cafb8f"
)
OPERATIONAL_POLICY_CANONICAL_SHA256 = (
    "17b9eea045ac2369e7679f5fbec3291cca46374b004165f15087ceb4bded7a21"
)
PRIVATE_REVIEW_SHA256 = (
    "5d8bf31a8dc789dac15ee8d4a65fc14227c466c50a996eb17a48f926f18ce82b"
)
PRIVATE_OFFLINE_MAP_SHA256 = (
    "32496802424c15cd5d08337364a6aefd119187cc9a42180ec0183ce2dc4542de"
)
PRIVATE_CHAPTERS_SHA256 = (
    "116875ac9cb52ed52e1b74df210fc32f457acd46a61b5c75f6d770a88450242c"
)
PRIVATE_DISCLAIMER = (
    "This private draft does not replace current NPS information."
)
FINAL_DISCLAIMER = "This tour does not replace current NPS information."
PRIVATE_ACCESSIBILITY_NOTE = (
    "Accessibility and stop conditions require a current NPS check; "
    "this draft makes no parking or access guarantee."
)
FINAL_ACCESSIBILITY_NOTE = (
    "Accessibility and stop conditions require a current NPS check; "
    "this tour makes no parking or access guarantee."
)
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_TIMESTAMP_RE = re.compile(
    r"^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T"
    r"(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$"
)
_ARTIFACT_KEYS = {
    "schema_version",
    "kind",
    "review_id",
    "status",
    "product_id",
    "expected_before_draft_revision",
    "expected_after_draft_revision",
    "expected_before_manifest_sha256",
    "content_projection_sha256",
    "review",
    "offline_map_estimated_bytes",
    "route_evidence",
    "publication_review_bindings",
    "roaring_fork_final_disclaimer",
    "roaring_fork_final_accessibility_note",
    "effects",
}
_REVIEW_KEYS = {
    "editorial_status",
    "field_drive_completed_at",
    "source_review_completed_at",
}
_EFFECT_KEYS = {
    "database_accessed",
    "database_mutated",
    "network_accessed",
    "provider_accessed",
    "provider_mutated",
    "publication_performed",
    "public_release",
}
_PUBLICATION_REVIEW_BINDING_KEYS = {
    "technical_field_drive_evidence_sha256",
    "source_review_evidence_sha256",
    "vehicle_source_policy_sha256",
}
_HISTORICAL_VALIDATION_KEYS = {
    "current",
    "delivery_contract_sha256",
    "engine",
    "expected_draft_revision",
    "expected_worker_pid",
    "expected_manifest_sha256",
    "expected_assets_sha256",
    "expected_input_sha256",
    "expected_validator_source_sha256",
    "expected_started_by",
    "expected_started_at",
    "expected_completed_at",
    "expected_selection_result_count",
    "expected_nested_scenario_count",
    "expected_report_count",
    "expected_suite_version",
    "issues",
    "issues_sha256",
    "live_report_rechecked_by_publication_readiness_builder",
    "publication_approval",
    "readback_observed_at",
    "redacted_report_sha256",
    "redacted_operator_report_byte_count",
    "redacted_operator_report_canonical_sha256",
    "redacted_operator_report_file_sha256",
    "redacted_operator_report_path_sha256",
    "redacted_store_report_canonical_sha256",
    "report_id",
    "route_scenario_ids_sha256",
    "route_scenarios_passed",
    "route_scenarios_required",
    "selection",
    "scenarios_sha256",
    "source_commit",
    "source_path",
    "source_sha256",
    "status",
    "summary_sha256",
    "target_binding_sha256",
    "target_evidence_sha256",
    "target_id",
}


class SmokiesFinalReadinessError(ValueError):
    """Raised when the final-readiness artifact or exact CAS input drifts."""


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def sha256(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()


def _object(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SmokiesFinalReadinessError(f"{label} must be an object")
    return value


def _exact_keys(value: dict, keys: set[str], label: str) -> None:
    if set(value) != keys:
        raise SmokiesFinalReadinessError(f"{label} fields are invalid")


def _timestamp(value: object, label: str) -> str:
    clean = str(value or "").strip()
    if not _TIMESTAMP_RE.fullmatch(clean):
        raise SmokiesFinalReadinessError(
            f"{label} must be a canonical UTC-second timestamp"
        )
    return clean


def _publication_review_bindings(value: object) -> dict[str, str]:
    bindings = copy.deepcopy(
        _object(value, "Smokies publication review bindings")
    )
    _exact_keys(
        bindings,
        _PUBLICATION_REVIEW_BINDING_KEYS,
        "Smokies publication review bindings",
    )
    for key in sorted(_PUBLICATION_REVIEW_BINDING_KEYS):
        clean = str(bindings.get(key) or "")
        if not _SHA256_RE.fullmatch(clean):
            raise SmokiesFinalReadinessError(
                f"Smokies publication review {key} is invalid"
            )
        bindings[key] = clean
    if (
        bindings["vehicle_source_policy_sha256"]
        != OPERATIONAL_POLICY_CANONICAL_SHA256
    ):
        raise SmokiesFinalReadinessError(
            "Smokies reviewed vehicle/source policy drifted"
        )
    try:
        policy_raw = OPERATIONAL_POLICY_PATH.read_bytes()
        policy = json.loads(policy_raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise SmokiesFinalReadinessError(
            "Smokies reviewed vehicle/source policy is unavailable"
        ) from exc
    if (
        len(policy_raw) != OPERATIONAL_POLICY_BYTE_COUNT
        or hashlib.sha256(policy_raw).hexdigest()
        != OPERATIONAL_POLICY_FILE_SHA256
        or sha256(policy) != OPERATIONAL_POLICY_CANONICAL_SHA256
    ):
        raise SmokiesFinalReadinessError(
            "Smokies reviewed vehicle/source policy source drifted"
        )
    return bindings


def _load_json(path: Path, label: str) -> tuple[dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise SmokiesFinalReadinessError(f"{label} is absent or invalid") from exc
    value = _object(value, label)
    if raw != canonical_bytes(value):
        raise SmokiesFinalReadinessError(f"{label} is not canonical JSON")
    return value, raw


def load_historical_validation_contract() -> tuple[dict[str, Any], dict[str, Any]]:
    """Load the exact immutable RF report contract used by migration."""
    try:
        raw = HISTORICAL_VALIDATION_SOURCE_PATH.read_bytes()
        source = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise SmokiesFinalReadinessError(
            "Smokies historical validation source is absent or invalid"
        ) from exc
    source = _object(source, "Smokies historical validation source")
    if (
        len(raw) != HISTORICAL_VALIDATION_SOURCE_BYTE_COUNT
        or hashlib.sha256(raw).hexdigest()
        != HISTORICAL_VALIDATION_SOURCE_SHA256
    ):
        raise SmokiesFinalReadinessError(
            "Smokies historical validation source drifted"
        )
    history = copy.deepcopy(_object(
        source.get("trusted_private_validation_at_s4r_readback"),
        "Smokies historical validation report",
    ))
    private_state = _object(
        source.get("private_state_at_s4r_readback"),
        "Smokies historical private state",
    )
    history.update({
        "expected_report_count": 1,
        "expected_suite_version": "originals_virtual_route_v3",
        "expected_draft_revision": 2,
        "expected_worker_pid": 16,
        "expected_manifest_sha256": (
            "b6f730d17922f7b38361d08e9bc97bde1d340a0c42d9b455802fca708585d725"
        ),
        "expected_assets_sha256": (
            "1c4c945fe594089bb6147f15251a097818ea5b4093e193c22c93751cf811fc32"
        ),
        "expected_input_sha256": (
            "81815b5cca2e6cb19a0cc1e75208d73b3ce01683d3660ea2095c7a553d1fba0a"
        ),
        "expected_validator_source_sha256": (
            "cd045f33f6908235f5393dfeca54ae3317855dbb9f716bbd283fceff5be415a1"
        ),
        "expected_started_by": 3,
        "expected_started_at": 1786412026,
        "expected_completed_at": 1786412036,
        "expected_selection_result_count": 1,
        "expected_nested_scenario_count": 13,
        "delivery_contract_sha256": (
            "9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6"
        ),
        "issues_sha256": (
            "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        ),
        "redacted_operator_report_byte_count": 6090,
        "redacted_operator_report_canonical_sha256": (
            "368fdffed960744954f709643ea4c9ac33c995302b54179167eff27c32f5567f"
        ),
        "redacted_operator_report_file_sha256": (
            "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059"
        ),
        "redacted_operator_report_path_sha256": (
            "db4e1621926c4267a96a0f56294a31acb943f490f496898af44138be26a3684f"
        ),
        "redacted_store_report_canonical_sha256": (
            "a9dd8583e1c50869f1de75fe124e5a8590be6b33a5ace5a71ddae974174b3503"
        ),
        "route_scenario_ids_sha256": (
            "9edf543ba393121a86699f205813c58fba30e09b687f89659a1f7a7a5bde6511"
        ),
        "scenarios_sha256": (
            "09ee939488a9f41d781aa4bded9058f88852d3a9ab1d08b73802308b333fc248"
        ),
        "summary_sha256": (
            "c8a49951221c454da8462c26dcbbcb2962af8bfe3ce0875d24927b2b21d0ef6f"
        ),
        "target_binding_sha256": (
            "41a00c67ed83bafe7355d4e1858710df38e780c2a514641e269103fdcea9104e"
        ),
        "target_evidence_sha256": (
            "2fded0c644b73a36c2efe45a0f64e6e0add551b9c5f2b81c42e73fd276a7a703"
        ),
        "target_id": "south_tn",
        "readback_observed_at": private_state.get("observed_at"),
        "source_path": (
            "originals/smokies/"
            "roaring_fork_publication_readiness_inputs_v1.json"
        ),
        "source_sha256": HISTORICAL_VALIDATION_SOURCE_SHA256,
    })
    _exact_keys(
        history,
        _HISTORICAL_VALIDATION_KEYS,
        "Smokies permitted validation history",
    )
    if (
        history.get("report_id")
        != "original_validation_9df694c93ee9ef3809c33f451d04bf28"
        or history.get("redacted_report_sha256")
        != "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059"
        or history.get("redacted_operator_report_file_sha256")
        != history.get("redacted_report_sha256")
        or history.get("redacted_operator_report_byte_count") != 6090
        or history.get("redacted_operator_report_canonical_sha256")
        != "368fdffed960744954f709643ea4c9ac33c995302b54179167eff27c32f5567f"
        or history.get("redacted_operator_report_path_sha256")
        != "db4e1621926c4267a96a0f56294a31acb943f490f496898af44138be26a3684f"
        or history.get("redacted_store_report_canonical_sha256")
        != "a9dd8583e1c50869f1de75fe124e5a8590be6b33a5ace5a71ddae974174b3503"
        or history.get("expected_report_count") != 1
        or history.get("expected_draft_revision") != 2
        or history.get("expected_worker_pid") != 16
        or history.get("expected_manifest_sha256")
        != "b6f730d17922f7b38361d08e9bc97bde1d340a0c42d9b455802fca708585d725"
        or history.get("expected_assets_sha256")
        != "1c4c945fe594089bb6147f15251a097818ea5b4093e193c22c93751cf811fc32"
        or history.get("expected_input_sha256")
        != "81815b5cca2e6cb19a0cc1e75208d73b3ce01683d3660ea2095c7a553d1fba0a"
        or history.get("expected_validator_source_sha256")
        != "cd045f33f6908235f5393dfeca54ae3317855dbb9f716bbd283fceff5be415a1"
        or history.get("expected_started_by") != 3
        or history.get("expected_started_at") != 1786412026
        or history.get("expected_completed_at") != 1786412036
        or history.get("expected_selection_result_count") != 1
        or history.get("expected_nested_scenario_count") != 13
        or history.get("summary_sha256")
        != "c8a49951221c454da8462c26dcbbcb2962af8bfe3ce0875d24927b2b21d0ef6f"
        or history.get("scenarios_sha256")
        != "09ee939488a9f41d781aa4bded9058f88852d3a9ab1d08b73802308b333fc248"
        or history.get("issues_sha256")
        != "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        or history.get("route_scenario_ids_sha256")
        != "9edf543ba393121a86699f205813c58fba30e09b687f89659a1f7a7a5bde6511"
        or history.get("delivery_contract_sha256")
        != "9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6"
        or history.get("target_id") != "south_tn"
        or history.get("target_binding_sha256")
        != "41a00c67ed83bafe7355d4e1858710df38e780c2a514641e269103fdcea9104e"
        or history.get("target_evidence_sha256")
        != "2fded0c644b73a36c2efe45a0f64e6e0add551b9c5f2b81c42e73fd276a7a703"
        or history.get("expected_suite_version") != "originals_virtual_route_v3"
        or history.get("engine") != "original-trigger-v3"
        or history.get("status") != "passed"
        or history.get("current") is not True
        or history.get("selection")
        != "roaring_fork_one_way_private_v1:one_way"
        or history.get("route_scenarios_required") != 13
        or history.get("route_scenarios_passed") != 13
        or history.get("issues") != []
        or history.get("publication_approval") is not False
        or history.get("live_report_rechecked_by_publication_readiness_builder")
        is not False
    ):
        raise SmokiesFinalReadinessError(
            "Smokies immutable historical validation contract drifted"
        )
    expected_historical_validation_store_report(history)
    return history, {
        "historical_validation_source_byte_count": len(raw),
        "historical_validation_source_sha256": hashlib.sha256(raw).hexdigest(),
        "historical_validation_contract_sha256": sha256(history),
    }


def expected_historical_validation_store_report(
    history: dict[str, Any],
) -> dict[str, Any]:
    """Return the exact safe DB-report projection nested in the S4R journal."""
    pass_contract = {
        "selection_key": history["selection"],
        "route_scenario_count": history["expected_nested_scenario_count"],
        "route_scenario_ids_sha256": history["route_scenario_ids_sha256"],
        "delivery_contract_sha256": history["delivery_contract_sha256"],
        "target_id": history["target_id"],
        "target_binding_sha256": history["target_binding_sha256"],
        "target_evidence_sha256": history["target_evidence_sha256"],
    }
    report = {
        "schema_version": 1,
        "report_type": "OriginalRouteValidationReportV1",
        "id": history["report_id"],
        "pack_id": PRODUCT_ID,
        "draft_revision": history["expected_draft_revision"],
        "manifest_sha256": history["expected_manifest_sha256"],
        "assets_sha256": history["expected_assets_sha256"],
        "input_sha256": history["expected_input_sha256"],
        "validator_source_sha256": history["expected_validator_source_sha256"],
        "suite_version": history["expected_suite_version"],
        "engine_version": history["engine"],
        "status": history["status"],
        "passed": True,
        "current": True,
        "started_at": history["expected_started_at"],
        "completed_at": history["expected_completed_at"],
        "summary_sha256": history["summary_sha256"],
        "scenarios_sha256": history["scenarios_sha256"],
        "issues_sha256": history["issues_sha256"],
        "pass_contract": pass_contract,
    }
    if sha256(report) != history["redacted_store_report_canonical_sha256"]:
        raise SmokiesFinalReadinessError(
            "Smokies historical safe store-report binding drifted"
        )
    return report


def validate_finalization_review_artifact(
    value: object,
    *,
    route_evidence_document: dict | None = None,
) -> dict[str, Any]:
    artifact = copy.deepcopy(_object(value, "Smokies finalization-review artifact"))
    _exact_keys(artifact, _ARTIFACT_KEYS, "Smokies finalization-review artifact")
    if (
        artifact.get("schema_version") != 1
        or artifact.get("kind") != FINALIZATION_REVIEW_KIND
        or artifact.get("review_id") != FINALIZATION_REVIEW_ID
        or artifact.get("status") != "field_drive_and_source_review_complete"
        or artifact.get("product_id") != PRODUCT_ID
        or artifact.get("expected_before_draft_revision")
        != EXPECTED_BEFORE_DRAFT_REVISION
        or artifact.get("expected_after_draft_revision")
        != EXPECTED_AFTER_DRAFT_REVISION
        or artifact.get("content_projection_sha256")
        != CONTENT_PROJECTION_SHA256
    ):
        raise SmokiesFinalReadinessError(
            "Smokies finalization-review artifact identity drifted"
        )
    before_manifest_sha256 = str(
        artifact.get("expected_before_manifest_sha256") or ""
    )
    if not _SHA256_RE.fullmatch(before_manifest_sha256):
        raise SmokiesFinalReadinessError(
            "Smokies exact rev4 predecessor hash is invalid"
        )
    review = _object(artifact.get("review"), "Smokies final review")
    _exact_keys(review, _REVIEW_KEYS, "Smokies final review")
    if review.get("editorial_status") != "approved":
        raise SmokiesFinalReadinessError("Smokies final review is not approved")
    review["field_drive_completed_at"] = _timestamp(
        review.get("field_drive_completed_at"),
        "Smokies field-drive completion",
    )
    review["source_review_completed_at"] = _timestamp(
        review.get("source_review_completed_at"),
        "Smokies source-review completion",
    )
    offline_bytes = artifact.get("offline_map_estimated_bytes")
    if offline_bytes != EXPECTED_OFFLINE_MAP_BYTES:
        raise SmokiesFinalReadinessError(
            "Smokies reviewed offline-map bytes drifted"
        )
    review_bindings = _publication_review_bindings(
        artifact.get("publication_review_bindings")
    )
    try:
        route_binding = normalize_route_evidence_binding(
            artifact.get("route_evidence"), required=True
        )
    except OriginalRouteEvidenceError as exc:
        raise SmokiesFinalReadinessError(str(exc)) from exc
    if (
        not route_binding
        or route_binding["evidence_id"] != PUBLICATION_ROUTE_EVIDENCE_ID
        or route_binding["product_id"] != PRODUCT_ID
    ):
        raise SmokiesFinalReadinessError(
            "Smokies publication route-evidence identity drifted"
        )
    document = route_evidence_document
    if document is None:
        try:
            document = load_registered_route_evidence(
                PUBLICATION_ROUTE_EVIDENCE_ID
            )
        except OriginalRouteEvidenceError as exc:
            raise SmokiesFinalReadinessError(str(exc)) from exc
    if canonical_sha256(document) != route_binding["evidence_sha256"]:
        raise SmokiesFinalReadinessError(
            "Smokies publication route-evidence hash drifted"
        )
    try:
        document = validate_smokies_publication_route_evidence_document(document)
    except OriginalRouteEvidenceError as exc:
        raise SmokiesFinalReadinessError(str(exc)) from exc
    if not isinstance(document, dict) or _publication_review_bindings(
        document.get("publication_review_bindings")
    ) != review_bindings:
        raise SmokiesFinalReadinessError(
            "Smokies publication route review bindings drifted"
        )
    if artifact.get("roaring_fork_final_disclaimer") != FINAL_DISCLAIMER:
        raise SmokiesFinalReadinessError(
            "Smokies final Roaring Fork disclaimer drifted"
        )
    if (
        artifact.get("roaring_fork_final_accessibility_note")
        != FINAL_ACCESSIBILITY_NOTE
    ):
        raise SmokiesFinalReadinessError(
            "Smokies final Roaring Fork accessibility note drifted"
        )
    effects = _object(artifact.get("effects"), "Smokies finalization-review effects")
    _exact_keys(effects, _EFFECT_KEYS, "Smokies finalization-review effects")
    if any(value is not False for value in effects.values()):
        raise SmokiesFinalReadinessError(
            "Smokies finalization-review artifact falsely claims downstream effects"
        )
    artifact["review"] = review
    artifact["publication_review_bindings"] = review_bindings
    artifact["route_evidence"] = route_binding
    return artifact


def load_finalization_review_artifact(
    path: Path = FINALIZATION_REVIEW_PATH,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    artifact, raw = _load_json(path, "Smokies finalization-review artifact")
    try:
        route_evidence = load_registered_route_evidence(
            PUBLICATION_ROUTE_EVIDENCE_ID
        )
    except OriginalRouteEvidenceError as exc:
        raise SmokiesFinalReadinessError(str(exc)) from exc
    artifact = validate_finalization_review_artifact(
        artifact,
        route_evidence_document=route_evidence,
    )
    try:
        route_raw = SMOKIES_PUBLICATION_ROUTE_EVIDENCE.read_bytes()
    except OSError as exc:
        raise SmokiesFinalReadinessError(
            "Registered Original route evidence could not be loaded"
        ) from exc
    return artifact, route_evidence, {
        "artifact_byte_count": len(raw),
        "artifact_sha256": hashlib.sha256(raw).hexdigest(),
        "route_evidence_byte_count": len(route_raw),
        "route_evidence_sha256": hashlib.sha256(route_raw).hexdigest(),
        "route_evidence_canonical_sha256": canonical_sha256(route_evidence),
    }


def build_final_manifest(
    current_manifest: object,
    artifact: object,
    *,
    content_projection: object,
    route_evidence_document: dict,
) -> dict[str, Any]:
    manifest = copy.deepcopy(_object(current_manifest, "Smokies rev4 manifest"))
    readiness = validate_finalization_review_artifact(
        artifact,
        route_evidence_document=route_evidence_document,
    )
    if (
        manifest.get("schema_version") != 3
        or sha256(manifest)
        != readiness["expected_before_manifest_sha256"]
        or sha256(content_projection) != CONTENT_PROJECTION_SHA256
        or sha256(manifest.get("review")) != PRIVATE_REVIEW_SHA256
        or sha256(manifest.get("offline_map")) != PRIVATE_OFFLINE_MAP_SHA256
        or sha256(manifest.get("chapters")) != PRIVATE_CHAPTERS_SHA256
        or manifest.get("route_evidence") is not None
    ):
        raise SmokiesFinalReadinessError(
            "Smokies rev4 predecessor manifest drifted"
        )
    manifest["review"] = copy.deepcopy(readiness["review"])
    manifest["offline_map"]["estimated_bytes"] = readiness[
        "offline_map_estimated_bytes"
    ]
    manifest["route_evidence"] = copy.deepcopy(readiness["route_evidence"])
    roaring_fork = [
        chapter
        for chapter in manifest["chapters"]
        if chapter.get("id") == "roaring_fork"
    ]
    if len(roaring_fork) != 1:
        raise SmokiesFinalReadinessError(
            "Smokies Roaring Fork predecessor is invalid"
        )
    chapter = roaring_fork[0]
    disclaimers = chapter.get("safety", {}).get("disclaimers")
    access = chapter.get("access")
    if (
        not isinstance(disclaimers, list)
        or not disclaimers
        or disclaimers[0] != PRIVATE_DISCLAIMER
        or not isinstance(access, dict)
        or access.get("accessibility_notes") != PRIVATE_ACCESSIBILITY_NOTE
    ):
        raise SmokiesFinalReadinessError(
            "Smokies Roaring Fork predecessor copy drifted"
        )
    disclaimers[0] = FINAL_DISCLAIMER
    access["accessibility_notes"] = FINAL_ACCESSIBILITY_NOTE
    try:
        validate_manifest_route_evidence(
            manifest,
            readiness["route_evidence"],
            expected_product_id=PRODUCT_ID,
            evidence_document=route_evidence_document,
        )
    except OriginalRouteEvidenceError as exc:
        raise SmokiesFinalReadinessError(str(exc)) from exc
    return manifest


def reconstruct_private_predecessor(
    final_manifest: object,
    artifact: object,
    *,
    content_projection: object,
    route_evidence_document: dict,
) -> dict[str, Any]:
    """Reverse only the approved final fields to verify an exact rev5 replay."""
    manifest = copy.deepcopy(_object(final_manifest, "Smokies rev5 manifest"))
    readiness = validate_finalization_review_artifact(
        artifact,
        route_evidence_document=route_evidence_document,
    )
    if (
        manifest.get("review") != readiness["review"]
        or manifest.get("route_evidence") != readiness["route_evidence"]
        or not isinstance(manifest.get("offline_map"), dict)
        or manifest["offline_map"].get("estimated_bytes")
        != readiness["offline_map_estimated_bytes"]
        or sha256(content_projection) != CONTENT_PROJECTION_SHA256
    ):
        raise SmokiesFinalReadinessError("Smokies rev5 readiness state drifted")
    try:
        validate_manifest_route_evidence(
            manifest,
            readiness["route_evidence"],
            expected_product_id=PRODUCT_ID,
            evidence_document=route_evidence_document,
        )
    except OriginalRouteEvidenceError as exc:
        raise SmokiesFinalReadinessError(str(exc)) from exc
    roaring_fork = [
        chapter
        for chapter in manifest.get("chapters") or []
        if isinstance(chapter, dict) and chapter.get("id") == "roaring_fork"
    ]
    if len(roaring_fork) != 1:
        raise SmokiesFinalReadinessError("Smokies rev5 Roaring Fork is invalid")
    chapter = roaring_fork[0]
    disclaimers = chapter.get("safety", {}).get("disclaimers")
    access = chapter.get("access")
    if (
        not isinstance(disclaimers, list)
        or not disclaimers
        or disclaimers[0] != FINAL_DISCLAIMER
        or not isinstance(access, dict)
        or access.get("accessibility_notes") != FINAL_ACCESSIBILITY_NOTE
    ):
        raise SmokiesFinalReadinessError(
            "Smokies rev5 Roaring Fork final copy drifted"
        )
    manifest["review"] = {"editorial_status": "owner_dual_platform_preview_required"}
    manifest["offline_map"]["estimated_bytes"] = 0
    manifest.pop("route_evidence")
    disclaimers[0] = PRIVATE_DISCLAIMER
    access["accessibility_notes"] = PRIVATE_ACCESSIBILITY_NOTE
    if sha256(manifest) != readiness["expected_before_manifest_sha256"]:
        raise SmokiesFinalReadinessError(
            "Smokies rev5 does not reverse to the exact rev4 predecessor"
        )
    return manifest


def allowed_change_contract(before: dict, after: dict) -> dict[str, Any]:
    """Return exact hashes proving only the six final-only fields changed."""
    before_copy = copy.deepcopy(before)
    after_copy = copy.deepcopy(after)
    before_review = before_copy.pop("review", None)
    after_review = after_copy.pop("review", None)
    before_route = before_copy.pop("route_evidence", None)
    after_route = after_copy.pop("route_evidence", None)
    before_offline = before_copy.get("offline_map")
    after_offline = after_copy.get("offline_map")
    if not isinstance(before_offline, dict) or not isinstance(after_offline, dict):
        raise SmokiesFinalReadinessError("Smokies offline-map shape drifted")
    before_offline_bytes = before_offline.pop("estimated_bytes", None)
    after_offline_bytes = after_offline.pop("estimated_bytes", None)
    before_rf = next(
        chapter for chapter in before_copy["chapters"]
        if chapter["id"] == "roaring_fork"
    )
    after_rf = next(
        chapter for chapter in after_copy["chapters"]
        if chapter["id"] == "roaring_fork"
    )
    before_disclaimer = before_rf["safety"]["disclaimers"].pop(0)
    after_disclaimer = after_rf["safety"]["disclaimers"].pop(0)
    before_access = before_rf["access"].pop("accessibility_notes")
    after_access = after_rf["access"].pop("accessibility_notes")
    if before_copy != after_copy:
        raise SmokiesFinalReadinessError(
            "Smokies finalization update changed committed content"
        )
    return {
        "schema_version": 1,
        "before_review_sha256": sha256(before_review),
        "after_review_sha256": sha256(after_review),
        "before_offline_map_estimated_bytes": before_offline_bytes,
        "after_offline_map_estimated_bytes": after_offline_bytes,
        "before_route_evidence": before_route,
        "after_route_evidence_sha256": sha256(after_route),
        "before_roaring_fork_disclaimer": before_disclaimer,
        "after_roaring_fork_disclaimer": after_disclaimer,
        "before_roaring_fork_accessibility_note": before_access,
        "after_roaring_fork_accessibility_note": after_access,
        "unchanged_remainder_sha256": sha256(before_copy),
    }
