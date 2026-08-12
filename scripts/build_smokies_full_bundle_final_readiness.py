#!/usr/bin/env python3
"""Build the final Smokies pre-validation readiness record, offline only.

This builder is deliberately unusable during the code-only source freeze.  It
requires the later redacted runtime receipts for the profiled revision-4
draft, compatible signed builds, reviewed offline bundle, publication route
evidence, final revision-5 CAS, and owner-approved dual-platform preview.
It never creates those facts and it requires that trusted validation has not
yet run.  The only output it may write is the immutable readiness record that
authorizes exactly one later trusted validation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = Path(
    "originals/smokies/smokies_full_bundle_final_readiness_v1.json"
)

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CONTENT_PROJECTION_SHA256 = (
    "35414d27e5a26dcfc5ef352f94322ca1fc88d17a4977c16b32ebd53f0bcdaf16"
)
MOBILE_COMPATIBILITY_STATUS = (
    "prebuild_source_compatibility_ready_new_signed_dual_platform_builds_required"
)
ROUTE_EVIDENCE_ID = "smokies-official-routes-2026-publication-v1"
HISTORICAL_REPORT_ID = (
    "original_validation_9df694c93ee9ef3809c33f451d04bf28"
)
HISTORICAL_REPORT_REDACTED_SHA256 = (
    "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059"
)
CHECKPOINT_M_PACKET = {
    "path": "originals/smokies/smokies_complete_private_migration_packet_v1.json",
    "byte_count": 5_838_967,
    "sha256": "d2f7ca0b587e67c2f8e9164a4d8f66663e6ac1f1a509af50989e04dcf84f4920",
}
CHECKPOINT_M_AUDIT = {
    "path": "originals/smokies/smokies_complete_private_migration_operator_audit_v1.json",
    "byte_count": 5_779,
    "sha256": "28bd4356804994cf48323788335f95d8c99566cbc0c87001340ea709be632188",
}
CHECKPOINT_M_AUDIT_BINDINGS_SHA256 = (
    "7d06cc44203eb55f4a6f9abf622e7d62a52368737c3bb6fb94dbd5ed76807074"
)
CHECKPOINT_M_RUNTIME_SOURCE = {
    "commit": "4d24fe44a02bbf957c8200399612151f84a1e83a",
    "tree": "9393a7a0049f8c0f4eef60d18ca5579d9f9aeef4",
}
MOBILE_COMPATIBILITY_PATH = (
    "originals/smokies/smokies_mobile_compatibility_freeze_v1.json"
)
EXPECTED_OFFLINE_MAP_BYTES = 213_074_000
EXPECTED_CONTENT_ASSET_BYTES = 458_155_200
EXPECTED_BUNDLE_BYTES = 671_229_200
EXPECTED_RUNTIME_FREE_SPACE_BYTES = 738_352_121
EXPECTED_TRUSTED_VALIDATION_PATH_COUNT = 174
EXPECTED_COUNTS = {
    "chapter_count": 4,
    "variant_count": 6,
    "base_entry_count": 77,
    "directional_substitution_count": 8,
    "narration_asset_count": 85,
    "image_asset_count": 13,
    "content_asset_count": 98,
    "union_offline_region_count": 1,
}
EXPECTED_SELECTIONS = (
    ("mountain_crossing", "tn_to_nc"),
    ("mountain_crossing", "nc_to_tn"),
    ("little_river_cades_cove", "sugarlands_to_cades_cove_loop"),
    ("roaring_fork", "one_way"),
    ("foothills_parkway", "west_to_east"),
    ("foothills_parkway", "east_to_west"),
)
EXPECTED_SCENARIOS = (
    "baseline_slow_15mph",
    "baseline_cruise_36mph",
    "baseline_highway_65mph",
    "gps_jitter",
    "poor_accuracy_recovery",
    "off_route_rejoin",
    "reverse_travel",
    "mid_route_start",
    "restart_duplicate_prevention",
    "overlapping_audio_queue",
    "drive_by_speed",
    "delayed_out_of_order_fixes",
    "self_intersection_ambiguity",
)
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
GIT_OID_RE = re.compile(r"^[a-f0-9]{40}(?:[a-f0-9]{24})?$")


class FinalReadinessBuildError(RuntimeError):
    """Raised when required pre-validation evidence is absent or drifted."""


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def _canonical_sha256(value: object) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _render(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise FinalReadinessBuildError(message)


def _sha256(value: object, label: str) -> str:
    clean = str(value or "")
    _require(SHA256_RE.fullmatch(clean) is not None, f"{label} is invalid")
    return clean


def _git_oid(value: object, label: str) -> str:
    clean = str(value or "")
    _require(GIT_OID_RE.fullmatch(clean) is not None, f"{label} is invalid")
    return clean


def _utc_second(value: object, label: str) -> str:
    clean = str(value or "")
    _require(
        re.fullmatch(
            r"20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T"
            r"(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ",
            clean,
        )
        is not None,
        f"{label} is invalid",
    )
    return clean


def _exact_state(value: object, expected: dict[str, object], label: str) -> None:
    _require(
        isinstance(value, dict) and value == expected,
        f"{label} claims contradictory or incomplete state",
    )


def _load_input(path: Path, label: str) -> tuple[dict[str, Any], dict[str, Any]]:
    _require(path.is_file(), f"{label} is required")
    _require(not path.is_symlink(), f"{label} must not be a symlink")
    try:
        payload = path.read_bytes()
        value = json.loads(payload.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FinalReadinessBuildError(f"{label} is unavailable or invalid") from exc
    _require(isinstance(value, dict), f"{label} must contain an object")
    return value, {
        "byte_count": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def _selection_contract() -> dict[str, Any]:
    selections = [
        {
            "chapter_id": chapter_id,
            "variant_id": variant_id,
            "required_scenarios": list(EXPECTED_SCENARIOS),
        }
        for chapter_id, variant_id in EXPECTED_SELECTIONS
    ]
    return {
        "schema_version": 1,
        "selection_count": 6,
        "scenario_count_per_selection": 13,
        "required_total_scenario_count": 78,
        "selections": selections,
    }


def _redacted_binding(
    value: dict[str, Any],
    raw_binding: dict[str, Any],
    *,
    kind: str,
    status: str,
    label: str,
) -> dict[str, Any]:
    _require(value.get("schema_version") == 1, f"{label} schema drifted")
    _require(value.get("kind") == kind, f"{label} kind drifted")
    _require(value.get("status") == status, f"{label} status drifted")
    _require(value.get("product_id") == PRODUCT_ID, f"{label} product drifted")
    result = dict(raw_binding)
    for key in (
        "receipt_id",
        "artifact_id",
        "evidence_id",
        "source_commit",
        "source_tree",
        "draft_revision",
        "manifest_sha256",
        "assets_sha256",
    ):
        if key in value:
            result[key] = value[key]
    return result


def build(
    *,
    post_migration_profile_receipt: Path,
    mobile_compatibility: Path,
    finalization_review: Path,
    final_readiness_cas_receipt: Path,
    dual_platform_marker: Path,
) -> dict[str, Any]:
    post_profile, post_profile_raw = _load_input(
        post_migration_profile_receipt, "post-migration profile receipt"
    )
    compatibility, compatibility_raw = _load_input(
        mobile_compatibility, "mobile compatibility record"
    )
    finalization, finalization_raw = _load_input(
        finalization_review, "finalization-review evidence"
    )
    cas, cas_raw = _load_input(
        final_readiness_cas_receipt, "final-readiness CAS receipt"
    )
    marker, marker_raw = _load_input(
        dual_platform_marker, "dual-platform preview marker"
    )

    post_binding = _redacted_binding(
        post_profile,
        post_profile_raw,
        kind="smokies_full_bundle_post_migration_profile_receipt",
        status="verified_profiled_private_draft",
        label="post-migration profile receipt",
    )
    revisions = post_profile.get("revisions")
    _require(
        isinstance(revisions, dict)
        and revisions.get("before") == 3
        and revisions.get("after") == 4,
        "post-migration revision boundary drifted",
    )
    counts = post_profile.get("counts")
    _require(
        isinstance(counts, dict)
        and counts == {
            "newly_attested_narrations": 72,
            "preserved_roaring_fork_narrations": 13,
            "total_narrations": 85,
            "total_images": 13,
            "total_assets": 98,
        },
        "post-migration attestation inventory drifted",
    )
    private_state = post_profile.get("private_state")
    _require(
        isinstance(private_state, dict)
        and set(private_state)
        == {
            "base_manifest_sha256",
            "profiled_manifest_sha256",
            "narration_profile_sha256",
            "asset_map_sha256",
            "validation_metadata_sha256",
            "narration_map_sha256",
            "redacted_license_attestation_map_sha256",
            "latest_server_attested_at",
        }
        and all(
            SHA256_RE.fullmatch(str(private_state.get(key) or "")) is not None
            for key in set(private_state) - {"latest_server_attested_at"}
        ),
        "post-migration private-state binding is missing",
    )
    _utc_second(
        private_state["latest_server_attested_at"],
        "latest server-owned narration attestation time",
    )
    migration_bindings = post_profile.get("migration_bindings")
    _require(
        isinstance(migration_bindings, dict)
        and migration_bindings.get("packet")
        == {
            "sha256": CHECKPOINT_M_PACKET["sha256"],
            "byte_count": CHECKPOINT_M_PACKET["byte_count"],
        }
        and isinstance(migration_bindings.get("audit"), dict)
        and migration_bindings["audit"].get("sha256")
        == CHECKPOINT_M_AUDIT["sha256"]
        and migration_bindings["audit"].get("byte_count")
        == CHECKPOINT_M_AUDIT["byte_count"]
        and migration_bindings["audit"].get("bindings_sha256")
        == CHECKPOINT_M_AUDIT_BINDINGS_SHA256
        and migration_bindings.get("source_revision")
        == CHECKPOINT_M_RUNTIME_SOURCE
        and isinstance(migration_bindings.get("private_migration_receipt"), dict)
        and SHA256_RE.fullmatch(
            str(
                migration_bindings["private_migration_receipt"].get("sha256")
                or ""
            )
        )
        is not None
        and isinstance(
            migration_bindings["private_migration_receipt"].get("byte_count"),
            int,
        )
        and migration_bindings["private_migration_receipt"]["byte_count"] > 0,
        "post-migration checkpoint-M bindings drifted",
    )
    rev4_manifest_sha256 = _sha256(
        private_state.get("profiled_manifest_sha256"),
        "revision-4 manifest sha256",
    )
    rev4_profile_sha256 = _sha256(
        private_state.get("narration_profile_sha256"),
        "revision-4 narration profile sha256",
    )
    rev4_asset_map_sha256 = _sha256(
        private_state.get("asset_map_sha256"), "revision-4 assets sha256"
    )
    redacted_attestations = post_profile.get("redacted_attestation_bindings")
    _require(
        isinstance(redacted_attestations, list)
        and len(redacted_attestations) == 85
        and all(
            isinstance(row, dict)
            and set(row)
            == {
                "asset_id",
                "sha256",
                "redacted_license_attestation_sha256",
            }
            and isinstance(row.get("asset_id"), str)
            and re.fullmatch(
                r"[a-z0-9]+(?:_[a-z0-9]+)*", str(row.get("asset_id") or "")
            )
            is not None
            and SHA256_RE.fullmatch(str(row.get("sha256") or "")) is not None
            and SHA256_RE.fullmatch(
                str(row.get("redacted_license_attestation_sha256") or "")
            )
            is not None
            for row in redacted_attestations
        )
        and len({row["asset_id"] for row in redacted_attestations}) == 85,
        "post-migration redacted attestation bindings drifted",
    )
    narration_map = {
        row["asset_id"]: row["sha256"] for row in redacted_attestations
    }
    attestation_map = {
        row["asset_id"]: row["redacted_license_attestation_sha256"]
        for row in redacted_attestations
    }
    _require(
        private_state.get("narration_map_sha256")
        == _canonical_sha256(narration_map)
        and private_state.get("redacted_license_attestation_map_sha256")
        == _canonical_sha256(attestation_map),
        "post-migration narration or attestation map binding drifted",
    )
    preservation = post_profile.get("preservation")
    historical = (
        preservation.get("historical_validation_report")
        if isinstance(preservation, dict)
        else None
    )
    _require(
        isinstance(historical, dict)
        and historical.get("report_count") == 1
        and historical.get("report_id") == HISTORICAL_REPORT_ID
        and historical.get("redacted_report_sha256")
        == HISTORICAL_REPORT_REDACTED_SHA256
        and historical.get("current_full_bundle_report_count") == 0
        and historical.get("row_sha256_before")
        == historical.get("row_sha256_after")
        and SHA256_RE.fullmatch(str(historical.get("row_sha256_after") or ""))
        is not None
        and historical.get("inventory_sha256_before")
        == historical.get("inventory_sha256_after")
        and SHA256_RE.fullmatch(
            str(historical.get("inventory_sha256_after") or "")
        )
        is not None
        and historical.get("rewritten") is False,
        "historical validation report preservation drifted",
    )
    historical_inventory_sha256 = historical["inventory_sha256_after"]
    _exact_state(
        post_profile.get("effects"),
        {
            "database_accessed": True,
            "new_narration_attestations_written": 72,
            "roaring_fork_attestations_written": 0,
            "narration_profile_cas_count": 1,
            "media_files_created_or_rewritten": 0,
            "provider_accessed": False,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
            "trusted_validation_performed": False,
            "deployment_performed": False,
            "publication_performed": False,
        },
        "post-migration profile effects",
    )
    _exact_state(
        post_profile.get("gates"),
        {
            "configured_private_migration_complete": True,
            "new_72_license_attestations_complete": True,
            "pack_narration_profile_cas_complete": True,
            "verified_private_upload_complete": True,
            "dual_platform_private_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
        "post-migration profile gates",
    )

    compatibility_binding = _redacted_binding(
        compatibility,
        compatibility_raw,
        kind="smokies_mobile_compatibility_freeze",
        status=MOBILE_COMPATIBILITY_STATUS,
        label="mobile compatibility record",
    )
    source = compatibility.get("source_revision")
    _require(isinstance(source, dict), "mobile source binding is missing")
    source_commit = _git_oid(source.get("commit"), "mobile source commit")
    source_tree = _git_oid(source.get("tree"), "mobile source tree")
    validator = compatibility.get("trusted_validation_closure")
    _require(
        isinstance(validator, dict)
        and {"path_count", "sha256", "row_hash_key", "framing"}
        <= set(validator)
        and isinstance(validator.get("path_count"), int)
        and not isinstance(validator.get("path_count"), bool)
        and validator["path_count"] == EXPECTED_TRUSTED_VALIDATION_PATH_COUNT
        and SHA256_RE.fullmatch(str(validator.get("sha256") or "")) is not None
        and validator.get("row_hash_key") == "sha256"
        and isinstance(validator.get("framing"), str)
        and validator["framing"],
        "trusted validator closure drifted",
    )
    checkpoint_m = compatibility.get("checkpoint_m_migration_evidence")
    _require(
        isinstance(checkpoint_m, dict)
        and checkpoint_m.get("historical_immutable") is True
        and checkpoint_m.get("executed_later_from_isolated_checkpoint_m") is True
        and isinstance(checkpoint_m.get("packet"), dict)
        and isinstance(checkpoint_m.get("independent_audit"), dict)
        and all(
            isinstance(binding.get("byte_count"), int)
            and binding["byte_count"] > 0
            and SHA256_RE.fullmatch(str(binding.get("sha256") or "")) is not None
            for binding in (checkpoint_m["packet"], checkpoint_m["independent_audit"])
        ),
        "checkpoint-M migration evidence binding drifted",
    )
    checkpoint_commit = _git_oid(
        checkpoint_m.get("commit"), "checkpoint-M commit"
    )
    checkpoint_tree = _git_oid(checkpoint_m.get("tree"), "checkpoint-M tree")
    _require(
        checkpoint_commit
        == "55ffb762335544224fd1b421e1df7c4c27f07f00"
        and checkpoint_tree
        == "fc152bfb6be4a2f61a8d16fc06f55d92b900d88c",
        "checkpoint-M source identity drifted",
    )
    _require(
        checkpoint_m.get("packet") == CHECKPOINT_M_PACKET
        and checkpoint_m.get("independent_audit") == CHECKPOINT_M_AUDIT,
        "checkpoint-M evidence identity or path drifted",
    )
    _require(
        (compatibility.get("product_counts") or
         (compatibility.get("candidate_contract") or {}).get("counts"))
        == EXPECTED_COUNTS,
        "mobile compatibility product inventory drifted",
    )
    _exact_state(
        compatibility.get("effects"),
        {
            "network_accessed": False,
            "provider_accessed": False,
            "database_accessed": False,
            "database_mutated": False,
            "mobile_build_performed": False,
            "mobile_build_signed": False,
            "device_accessed": False,
            "deployment_performed": False,
            "trusted_validation_performed": False,
            "publication_performed": False,
        },
        "mobile compatibility effects",
    )
    _exact_state(
        compatibility.get("gates"),
        {
            "final_readiness_cas_complete": False,
            "compatible_signed_android_build_complete": False,
            "compatible_signed_ios_build_complete": False,
            "same_source_build_identity_verified": False,
            "android_private_preview_complete": False,
            "ios_private_preview_complete": False,
            "dual_platform_private_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "publication_authorization_present": False,
            "public_release": False,
        },
        "mobile compatibility gates",
    )

    _require(
        finalization.get("schema_version") == 1
        and finalization.get("kind") == "smokies_full_bundle_finalization_review"
        and finalization.get("status") == "field_drive_and_source_review_complete"
        and finalization.get("product_id") == PRODUCT_ID
        and finalization.get("expected_before_draft_revision") == 4
        and finalization.get("expected_after_draft_revision") == 5
        and finalization.get("expected_before_manifest_sha256")
        == rev4_manifest_sha256
        and finalization.get("content_projection_sha256")
        == CONTENT_PROJECTION_SHA256,
        "finalization-review evidence is not ready",
    )
    route_binding = finalization.get("route_evidence")
    _require(
        isinstance(route_binding, dict)
        and route_binding.get("evidence_id") == ROUTE_EVIDENCE_ID
        and route_binding.get("product_id") == PRODUCT_ID
        and SHA256_RE.fullmatch(str(route_binding.get("evidence_sha256") or ""))
        is not None,
        "publication route-evidence binding drifted",
    )
    _require(
        finalization.get("offline_map_estimated_bytes")
        == EXPECTED_OFFLINE_MAP_BYTES,
        "reviewed offline-map byte count drifted",
    )
    _exact_state(
        finalization.get("effects"),
        {
            "database_accessed": False,
            "database_mutated": False,
            "network_accessed": False,
            "provider_accessed": False,
            "provider_mutated": False,
            "publication_performed": False,
            "public_release": False,
        },
        "finalization-review effects",
    )

    cas_binding = _redacted_binding(
        cas,
        cas_raw,
        kind="smokies_full_bundle_final_readiness_cas_receipt",
        status="verified_final_readiness_cas",
        label="final-readiness CAS receipt",
    )
    _require(
        cas.get("before_revision") == 4 and cas.get("after_revision") == 5,
        "final-readiness revision boundary drifted",
    )
    _require(
        cas.get("before_manifest_sha256") == rev4_manifest_sha256,
        "final-readiness predecessor manifest drifted",
    )
    _require(
        cas.get("content_projection_sha256") == CONTENT_PROJECTION_SHA256,
        "final-readiness content projection drifted",
    )
    rev5_manifest_sha256 = _sha256(
        cas.get("after_manifest_sha256"), "revision-5 manifest sha256"
    )
    _require(
        cas.get("profile_sha256_before") == rev4_profile_sha256
        and cas.get("profile_sha256_after") == rev4_profile_sha256,
        "final-readiness narration profile drifted",
    )
    _require(
        cas.get("historical_validation_report_count_before") == 1
        and cas.get("historical_validation_report_count_after") == 1
        and cas.get("full_bundle_validation_report_count_before") == 0
        and cas.get("full_bundle_validation_report_count_after") == 0,
        "validation report inventory drifted before final-readiness freeze",
    )
    _require(
        cas.get("validation_report_inventory_sha256_before")
        == historical_inventory_sha256
        and cas.get("validation_report_inventory_sha256_after")
        == historical_inventory_sha256,
        "final-readiness CAS historical report inventory binding drifted",
    )
    _exact_state(
        cas.get("effects"),
        {
            "database_accessed": True,
            "database_mutated": True,
            "network_accessed": False,
            "provider_accessed": False,
            "provider_mutated": False,
            "publication_performed": False,
            "public_release": False,
        },
        "final-readiness CAS effects",
    )
    cas_finalization = cas.get("finalization_review")
    _require(
        isinstance(cas_finalization, dict)
        and cas_finalization.get("artifact_sha256")
        == finalization_raw["sha256"]
        and cas_finalization.get("contract") == finalization
        and cas_finalization.get("contract_sha256")
        == _canonical_sha256(finalization),
        "finalization-review CAS binding drifted",
    )

    marker_binding = _redacted_binding(
        marker,
        marker_raw,
        kind="smokies_dual_platform_private_preview_marker",
        status="verified_dual_platform_private_preview",
        label="dual-platform preview marker",
    )
    _require(
        marker.get("draft_revision") == 5
        and marker.get("manifest_sha256") == rev5_manifest_sha256
        and marker.get("asset_set_sha256") == rev4_asset_map_sha256,
        "dual-platform marker snapshot drifted",
    )
    rev5_validation_assets_sha256 = _sha256(
        marker.get("assets_sha256"), "revision-5 validation assets sha256"
    )
    marker_report_state = marker.get("validation_report_state")
    _require(
        isinstance(marker_report_state, dict)
        and set(marker_report_state)
        == {
            "historical_report_count",
            "full_bundle_report_count",
            "historical_report_id",
            "historical_redacted_report_sha256",
            "inventory_sha256",
        }
        and marker_report_state.get("historical_report_count") == 1
        and marker_report_state.get("full_bundle_report_count") == 0
        and marker_report_state.get("historical_report_id")
        == HISTORICAL_REPORT_ID
        and marker_report_state.get("historical_redacted_report_sha256")
        == HISTORICAL_REPORT_REDACTED_SHA256
        and marker_report_state.get("inventory_sha256")
        == historical_inventory_sha256,
        "dual-platform marker historical report inventory drifted",
    )
    platform_details = marker.get("platform_files")
    _require(
        isinstance(platform_details, dict)
        and set(platform_details) == {"android", "ios"},
        "dual-platform marker coverage drifted",
    )
    for platform in ("android", "ios"):
        details = platform_details[platform]
        _require(
            isinstance(details, dict)
            and details.get("platform") == platform
            and details.get("source_commit") == source_commit
            and details.get("source_tree") == source_tree
            and SHA256_RE.fullmatch(
                str(details.get("build_identity_file_sha256") or "")
            ) is not None
            and SHA256_RE.fullmatch(
                str(details.get("preview_evidence_file_sha256") or "")
            ) is not None,
            f"{platform} preview marker binding drifted",
        )
    envelope = marker.get("dual_platform_envelope")
    _require(
        isinstance(envelope, dict)
        and SHA256_RE.fullmatch(str(envelope.get("canonical_sha256") or ""))
        is not None
        and isinstance(envelope.get("evidence"), dict)
        and envelope["evidence"].get("draft_revision") == 5
        and envelope["evidence"].get("manifest_sha256") == rev5_manifest_sha256
        and envelope["evidence"].get("assets_sha256")
        == rev5_validation_assets_sha256,
        "dual-platform owner envelope drifted",
    )
    _require(
        marker.get("source_revision") == {"commit": source_commit, "tree": source_tree},
        "signed preview builds do not share exact source",
    )
    _require(
        marker.get("mobile_compatibility_freeze")
        == {
            "path": MOBILE_COMPATIBILITY_PATH,
            "byte_count": compatibility_raw["byte_count"],
            "sha256": compatibility_raw["sha256"],
        },
        "dual-platform marker mobile compatibility binding drifted",
    )
    _require(
        envelope.get("canonical_sha256")
        == _canonical_sha256(envelope["evidence"]),
        "dual-platform owner envelope canonical hash drifted",
    )
    _exact_state(
        marker.get("effects"),
        {
            "network_accessed": False,
            "provider_accessed": False,
            "mobile_build_performed": False,
            "deployment_performed": False,
            "trusted_validation_performed": False,
            "publication_performed": False,
        },
        "dual-platform marker effects",
    )
    _exact_state(
        marker.get("gates"),
        {
            "dual_platform_private_preview_complete": True,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
        "dual-platform marker gates",
    )

    expected_validation = _selection_contract()
    expected_validation_sha256 = _canonical_sha256(expected_validation)
    return {
        "schema_version": 1,
        "artifact_id": "smokies_full_bundle_final_readiness_v1",
        "kind": "smokies_full_bundle_final_readiness",
        "status": "ready_for_single_trusted_validation",
        "product_id": PRODUCT_ID,
        "source": {
            "commit": source_commit,
            "tree": source_tree,
            "mobile_compatibility": compatibility_binding,
            "trusted_validation_closure": {
                key: validator[key]
                for key in ("path_count", "sha256", "row_hash_key", "framing")
            },
            "checkpoint_m_migration_evidence": dict(checkpoint_m),
        },
        "product_counts": dict(EXPECTED_COUNTS),
        "storage": {
            "offline_map_estimated_bytes": EXPECTED_OFFLINE_MAP_BYTES,
            "content_asset_bytes": EXPECTED_CONTENT_ASSET_BYTES,
            "bundle_bytes": EXPECTED_BUNDLE_BYTES,
            "runtime_free_space_floor_bytes": EXPECTED_RUNTIME_FREE_SPACE_BYTES,
        },
        "draft": {
            "revision": 5,
            "manifest_sha256": rev5_manifest_sha256,
            "assets_sha256": rev5_validation_assets_sha256,
            "asset_map_sha256": rev4_asset_map_sha256,
            "narration_profile_sha256": rev4_profile_sha256,
            "content_projection_sha256": CONTENT_PROJECTION_SHA256,
            "post_migration_profile_receipt": post_binding,
            "final_readiness_cas_receipt": cas_binding,
        },
        "finalization_review": {
            **finalization_raw,
            "contract_sha256": _canonical_sha256(finalization),
            "route_evidence_id": ROUTE_EVIDENCE_ID,
        },
        "dual_platform_preview": marker_binding,
        "trusted_validation": {
            "performed": False,
            "report_count": 0,
            "historical_roaring_fork_report_count": 1,
            "historical_roaring_fork_report_id": HISTORICAL_REPORT_ID,
            "historical_roaring_fork_report_row_sha256": historical[
                "row_sha256_after"
            ],
            "historical_roaring_fork_report_inventory_sha256": (
                historical_inventory_sha256
            ),
            "expected_contract": expected_validation,
            "expected_contract_sha256": expected_validation_sha256,
            "exactly_one_future_report_allowed": True,
            "alternate_or_duplicate_report_allowed": False,
        },
        "gates": {
            "database_accessed_by_builder": False,
            "database_mutated_by_builder": False,
            "deployment_performed_by_builder": False,
            "network_accessed_by_builder": False,
            "provider_accessed_by_builder": False,
            "trusted_validation_performed": False,
            "release_authorization_created": False,
            "publication_performed": False,
        },
        "invalidation": {
            "any_bound_evidence_or_source_drift_invalidates": True,
            "failed_or_ambiguous_validation_requires_new_draft_revision": True,
            "manifest_media_terms_route_build_device_database_drift_invalidates": True,
        },
        "privacy": {
            "absolute_private_paths_serialized": False,
            "credentials_or_session_material_serialized": False,
            "raw_device_identifiers_serialized": False,
            "raw_provider_identifiers_serialized": False,
        },
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    parser.add_argument("--post-migration-profile-receipt", type=Path, required=True)
    parser.add_argument("--mobile-compatibility", type=Path, required=True)
    parser.add_argument("--finalization-review", type=Path, required=True)
    parser.add_argument("--final-readiness-cas-receipt", type=Path, required=True)
    parser.add_argument("--dual-platform-marker", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / OUTPUT_PATH)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        artifact = build(
            post_migration_profile_receipt=args.post_migration_profile_receipt,
            mobile_compatibility=args.mobile_compatibility,
            finalization_review=args.finalization_review,
            final_readiness_cas_receipt=args.final_readiness_cas_receipt,
            dual_platform_marker=args.dual_platform_marker,
        )
        payload = _render(artifact)
        if args.write:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_bytes(payload)
        else:
            _require(
                args.output.is_file() and args.output.read_bytes() == payload,
                "generated final-readiness artifact is absent or drifted",
            )
    except (FinalReadinessBuildError, OSError) as exc:
        print(json.dumps({"status": "blocked", "reason": str(exc)}, sort_keys=True), file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "status": "verified",
                "artifact": {
                    "byte_count": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                },
                "database_accessed": False,
                "deployment_performed": False,
                "network_accessed": False,
                "provider_accessed": False,
                "trusted_validation_performed": False,
                "publication_performed": False,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
