from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "scripts/build_smokies_full_bundle_final_readiness.py"
SPEC = importlib.util.spec_from_file_location(
    "build_smokies_full_bundle_final_readiness", BUILDER_PATH
)
assert SPEC is not None and SPEC.loader is not None
builder = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = builder
SPEC.loader.exec_module(builder)


def _write(path: Path, value: object) -> Path:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def _sha(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
    ).hexdigest()


@pytest.fixture()
def evidence(tmp_path: Path) -> dict[str, Path]:
    manifest4 = "1" * 64
    manifest5 = "2" * 64
    profile = "3" * 64
    assets = "4" * 64
    source_commit = "5" * 40
    source_tree = "6" * 40
    historical_inventory = "d" * 64
    post_profile = {
        "schema_version": 1,
        "receipt_id": "post_profile_v1",
        "kind": "smokies_full_bundle_post_migration_profile_receipt",
        "status": "verified_profiled_private_draft",
        "product_id": builder.PRODUCT_ID,
        "revisions": {"before": 3, "after": 4},
        "counts": {
            "newly_attested_narrations": 72,
            "preserved_roaring_fork_narrations": 13,
            "total_narrations": 85,
            "total_images": 13,
            "total_assets": 98,
        },
        "private_state": {
            "base_manifest_sha256": "0" * 64,
            "profiled_manifest_sha256": manifest4,
            "narration_profile_sha256": profile,
            "asset_map_sha256": assets,
            "validation_metadata_sha256": "9" * 64,
            "latest_server_attested_at": "2026-08-12T09:00:00Z",
        },
        "redacted_attestation_bindings": [
            {
                "asset_id": f"audio_{index:02d}",
                "sha256": f"{index % 10}" * 64,
                "redacted_license_attestation_sha256": f"{(index + 1) % 10}" * 64,
            }
            for index in range(85)
        ],
        "preservation": {
            "historical_validation_report": {
                "report_count": 1,
                "report_id": builder.HISTORICAL_REPORT_ID,
                "redacted_report_sha256": (
                    builder.HISTORICAL_REPORT_REDACTED_SHA256
                ),
                "row_sha256_before": "a" * 64,
                "row_sha256_after": "a" * 64,
                "inventory_sha256_before": historical_inventory,
                "inventory_sha256_after": historical_inventory,
                "current_full_bundle_report_count": 0,
                "rewritten": False,
            },
        },
        "migration_bindings": {
            "packet": {
                "sha256": builder.CHECKPOINT_M_PACKET["sha256"],
                "byte_count": builder.CHECKPOINT_M_PACKET["byte_count"],
            },
            "audit": {
                "sha256": builder.CHECKPOINT_M_AUDIT["sha256"],
                "byte_count": builder.CHECKPOINT_M_AUDIT["byte_count"],
                "bindings_sha256": builder.CHECKPOINT_M_AUDIT_BINDINGS_SHA256,
            },
            "private_migration_receipt": {
                "receipt_id": "private_migration_v1",
                "sha256": "8" * 64,
                "byte_count": 1200,
            },
            "source_revision": copy.deepcopy(builder.CHECKPOINT_M_RUNTIME_SOURCE),
            "target": {"id": "private"},
        },
        "effects": {
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
        "gates": {
            "configured_private_migration_complete": True,
            "new_72_license_attestations_complete": True,
            "pack_narration_profile_cas_complete": True,
            "verified_private_upload_complete": True,
            "dual_platform_private_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
    }
    post_profile["private_state"]["narration_map_sha256"] = _sha(
        {
            row["asset_id"]: row["sha256"]
            for row in post_profile["redacted_attestation_bindings"]
        }
    )
    post_profile["private_state"][
        "redacted_license_attestation_map_sha256"
    ] = _sha(
        {
            row["asset_id"]: row["redacted_license_attestation_sha256"]
            for row in post_profile["redacted_attestation_bindings"]
        }
    )
    compatibility = {
        "schema_version": 1,
        "artifact_id": "mobile_compatibility_v1",
        "kind": "smokies_mobile_compatibility_freeze",
        "status": builder.MOBILE_COMPATIBILITY_STATUS,
        "product_id": builder.PRODUCT_ID,
        "source_revision": {"commit": source_commit, "tree": source_tree},
        "trusted_validation_closure": {
            "path_count": 174,
            "sha256": "e" * 64,
            "row_hash_key": "sha256",
            "framing": "path NUL byte-count NUL bytes NUL",
        },
        "checkpoint_m_migration_evidence": {
            "commit": builder.CHECKPOINT_M_COMMIT,
            "tree": builder.CHECKPOINT_M_TREE,
            "packet": copy.deepcopy(builder.CHECKPOINT_M_PACKET),
            "independent_audit": {
                **copy.deepcopy(builder.CHECKPOINT_M_AUDIT),
            },
            "historical_immutable": True,
            "executed_later_from_isolated_checkpoint_m": True,
        },
        "product_counts": copy.deepcopy(builder.EXPECTED_COUNTS),
        "effects": {
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
        "gates": {
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
    }
    finalization = {
        "schema_version": 1,
        "kind": "smokies_full_bundle_finalization_review",
        "review_id": "smokies_full_bundle_finalization_review_v1",
        "status": "field_drive_and_source_review_complete",
        "product_id": builder.PRODUCT_ID,
        "expected_before_draft_revision": 4,
        "expected_after_draft_revision": 5,
        "expected_before_manifest_sha256": manifest4,
        "content_projection_sha256": builder.CONTENT_PROJECTION_SHA256,
        "offline_map_estimated_bytes": 213_074_000,
        "route_evidence": {
            "schema_version": 1,
            "evidence_id": builder.ROUTE_EVIDENCE_ID,
            "evidence_sha256": "9" * 64,
            "product_id": builder.PRODUCT_ID,
            "route_spec_sha256": "a" * 64,
            "source_snapshot_sha256": "b" * 64,
        },
        "review": {
            "editorial_status": "approved",
            "field_drive_completed_at": "2026-08-12T10:00:00Z",
            "source_review_completed_at": "2026-08-12T11:00:00Z",
        },
        "roaring_fork_final_disclaimer": "final",
        "roaring_fork_final_accessibility_note": "final",
        "effects": {
            "database_accessed": False,
            "database_mutated": False,
            "network_accessed": False,
            "provider_accessed": False,
            "provider_mutated": False,
            "publication_performed": False,
            "public_release": False,
        },
    }
    cas = {
        "schema_version": 1,
        "receipt_id": "final_readiness_cas_v1",
        "kind": "smokies_full_bundle_final_readiness_cas_receipt",
        "status": "verified_final_readiness_cas",
        "product_id": builder.PRODUCT_ID,
        "before_revision": 4,
        "after_revision": 5,
        "before_manifest_sha256": manifest4,
        "after_manifest_sha256": manifest5,
        "content_projection_sha256": builder.CONTENT_PROJECTION_SHA256,
        "profile_sha256_before": profile,
        "profile_sha256_after": profile,
        "historical_validation_report_count_before": 1,
        "historical_validation_report_count_after": 1,
        "full_bundle_validation_report_count_before": 0,
        "full_bundle_validation_report_count_after": 0,
        "validation_report_inventory_sha256_before": historical_inventory,
        "validation_report_inventory_sha256_after": historical_inventory,
        "finalization_review": {
            "artifact_sha256": "placeholder",
            "contract": finalization,
            "contract_sha256": _sha(finalization),
        },
        "effects": {
            "database_accessed": True,
            "database_mutated": True,
            "network_accessed": False,
            "provider_accessed": False,
            "provider_mutated": False,
            "publication_performed": False,
            "public_release": False,
        },
    }
    platforms = [
        {
            "platform": platform,
            "source_commit": source_commit,
            "source_tree": source_tree,
            "build_identity_file_sha256": char * 64,
            "preview_evidence_file_sha256": char * 64,
        }
        for platform, char in (("android", "7"), ("ios", "8"))
    ]
    marker = {
        "schema_version": 1,
        "evidence_id": "dual_platform_preview_v1",
        "kind": "smokies_dual_platform_private_preview_marker",
        "status": "verified_dual_platform_private_preview",
        "product_id": builder.PRODUCT_ID,
        "draft_revision": 5,
        "manifest_sha256": manifest5,
        "assets_sha256": assets,
        "asset_set_sha256": assets,
        "platform_files": {row["platform"]: row for row in platforms},
        "source_revision": {"commit": source_commit, "tree": source_tree},
        "validation_report_state": {
            "historical_report_count": 1,
            "full_bundle_report_count": 0,
            "historical_report_id": builder.HISTORICAL_REPORT_ID,
            "historical_redacted_report_sha256": (
                builder.HISTORICAL_REPORT_REDACTED_SHA256
            ),
            "inventory_sha256": historical_inventory,
        },
        "dual_platform_envelope": {
            "canonical_sha256": "placeholder",
            "evidence": {
                "draft_revision": 5,
                "manifest_sha256": manifest5,
                "assets_sha256": assets,
            },
        },
        "effects": {
            "network_accessed": False,
            "provider_accessed": False,
            "mobile_build_performed": False,
            "deployment_performed": False,
            "trusted_validation_performed": False,
            "publication_performed": False,
        },
        "gates": {
            "dual_platform_private_preview_complete": True,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
    }
    marker["dual_platform_envelope"]["canonical_sha256"] = _sha(
        marker["dual_platform_envelope"]["evidence"]
    )
    compatibility_path = _write(tmp_path / "compatibility.json", compatibility)
    compatibility_payload = compatibility_path.read_bytes()
    marker["mobile_compatibility_freeze"] = {
        "path": builder.MOBILE_COMPATIBILITY_PATH,
        "byte_count": len(compatibility_payload),
        "sha256": hashlib.sha256(compatibility_payload).hexdigest(),
    }
    result = {
        "post_migration_profile_receipt": _write(tmp_path / "profile.json", post_profile),
        "mobile_compatibility": compatibility_path,
        "finalization_review": _write(tmp_path / "finalization.json", finalization),
        "final_readiness_cas_receipt": _write(tmp_path / "cas.json", cas),
        "dual_platform_marker": _write(tmp_path / "marker.json", marker),
    }
    cas["finalization_review"]["artifact_sha256"] = hashlib.sha256(
        result["finalization_review"].read_bytes()
    ).hexdigest()
    result["final_readiness_cas_receipt"] = _write(tmp_path / "cas.json", cas)
    return result


def _build(paths: dict[str, Path]) -> dict:
    return builder.build(**paths)


def test_code_only_source_is_fail_closed_until_all_runtime_evidence_exists(
    tmp_path: Path,
) -> None:
    subprocess.run([sys.executable, "-m", "py_compile", str(BUILDER_PATH)], check=True)
    result = subprocess.run(
        [
            sys.executable,
            str(BUILDER_PATH),
            "--check",
            "--post-migration-profile-receipt",
            str(tmp_path / "missing-profile.json"),
            "--mobile-compatibility",
            str(tmp_path / "missing-mobile.json"),
            "--finalization-review",
            str(tmp_path / "missing-finalization.json"),
            "--final-readiness-cas-receipt",
            str(tmp_path / "missing-cas.json"),
            "--dual-platform-marker",
            str(tmp_path / "missing-marker.json"),
            "--output",
            str(tmp_path / "readiness.json"),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert json.loads(result.stderr)["status"] == "blocked"
    assert not (tmp_path / "readiness.json").exists()
    assert not (ROOT / builder.OUTPUT_PATH).exists()


def test_exact_complete_evidence_builds_pre_validation_record(
    evidence: dict[str, Path],
) -> None:
    artifact = _build(evidence)
    assert artifact["status"] == "ready_for_single_trusted_validation"
    assert artifact["product_counts"] == builder.EXPECTED_COUNTS
    assert artifact["draft"]["revision"] == 5
    assert artifact["draft"]["content_projection_sha256"] == (
        builder.CONTENT_PROJECTION_SHA256
    )
    assert artifact["storage"] == {
        "offline_map_estimated_bytes": 213_074_000,
        "content_asset_bytes": 458_155_200,
        "bundle_bytes": 671_229_200,
        "runtime_free_space_floor_bytes": 738_352_121,
    }
    validation = artifact["trusted_validation"]
    assert validation["performed"] is False
    assert validation["report_count"] == 0
    assert validation["historical_roaring_fork_report_count"] == 1
    assert validation["historical_roaring_fork_report_id"] == (
        builder.HISTORICAL_REPORT_ID
    )
    assert validation["historical_roaring_fork_report_inventory_sha256"] == (
        "d" * 64
    )
    assert validation["expected_contract"]["selection_count"] == 6
    assert validation["expected_contract"]["required_total_scenario_count"] == 78
    assert len(validation["expected_contract"]["selections"]) == 6
    assert all(
        len(row["required_scenarios"]) == 13
        for row in validation["expected_contract"]["selections"]
    )
    assert all(value is False for value in artifact["gates"].values())


@pytest.mark.parametrize("path_count", [173, 175])
def test_final_readiness_requires_exact_174_file_validator_closure(
    evidence: dict[str, Path], path_count: int,
) -> None:
    path = evidence["mobile_compatibility"]
    value = json.loads(path.read_text(encoding="utf-8"))
    value["trusted_validation_closure"]["path_count"] = path_count
    _write(path, value)
    with pytest.raises(
        builder.FinalReadinessBuildError,
        match="trusted validator closure drifted",
    ):
        _build(evidence)


def test_double_render_and_write_check_are_deterministic(
    evidence: dict[str, Path], tmp_path: Path
) -> None:
    first = builder._render(_build(evidence))
    second = builder._render(_build(evidence))
    assert first == second
    output = tmp_path / "readiness.json"
    args = [
        "--post-migration-profile-receipt",
        str(evidence["post_migration_profile_receipt"]),
        "--mobile-compatibility",
        str(evidence["mobile_compatibility"]),
        "--finalization-review",
        str(evidence["finalization_review"]),
        "--final-readiness-cas-receipt",
        str(evidence["final_readiness_cas_receipt"]),
        "--dual-platform-marker",
        str(evidence["dual_platform_marker"]),
        "--output",
        str(output),
    ]
    subprocess.run([sys.executable, str(BUILDER_PATH), "--write", *args], check=True)
    first_written = output.read_bytes()
    subprocess.run([sys.executable, str(BUILDER_PATH), "--check", *args], check=True)
    assert output.read_bytes() == first_written == first


@pytest.mark.parametrize(
    ("input_name", "field", "replacement", "message"),
    [
        ("post_migration_profile_receipt", "counts", {}, "attestation inventory"),
        ("mobile_compatibility", "product_counts", {}, "product inventory"),
        ("finalization_review", "status", "blocked", "not ready"),
        (
            "final_readiness_cas_receipt",
            "full_bundle_validation_report_count_after",
            1,
            "validation report inventory drifted",
        ),
        ("dual_platform_marker", "draft_revision", 4, "snapshot drifted"),
    ],
)
def test_every_runtime_evidence_class_fails_closed_on_drift(
    evidence: dict[str, Path],
    input_name: str,
    field: str,
    replacement: object,
    message: str,
) -> None:
    path = evidence[input_name]
    value = json.loads(path.read_text(encoding="utf-8"))
    value[field] = replacement
    _write(path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match=message):
        _build(evidence)


def test_finalization_review_must_match_exact_cas_binding(
    evidence: dict[str, Path],
) -> None:
    path = evidence["finalization_review"]
    value = json.loads(path.read_text(encoding="utf-8"))
    value["review"]["field_drive_completed_at"] = "2026-08-12T12:00:00Z"
    _write(path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match="CAS binding"):
        _build(evidence)


@pytest.mark.parametrize(
    ("input_name", "path"),
    [
        (
            "post_migration_profile_receipt",
            ("preservation", "historical_validation_report", "inventory_sha256_before"),
        ),
        (
            "post_migration_profile_receipt",
            ("preservation", "historical_validation_report", "inventory_sha256_after"),
        ),
        (
            "final_readiness_cas_receipt",
            ("validation_report_inventory_sha256_before",),
        ),
        (
            "final_readiness_cas_receipt",
            ("validation_report_inventory_sha256_after",),
        ),
        (
            "dual_platform_marker",
            ("validation_report_state", "inventory_sha256"),
        ),
    ],
)
def test_historical_report_inventory_is_one_exact_cross_evidence_binding(
    evidence: dict[str, Path], input_name: str, path: tuple[str, ...]
) -> None:
    input_path = evidence[input_name]
    value = json.loads(input_path.read_text(encoding="utf-8"))
    target = value
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = "c" * 64
    _write(input_path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match="report|inventory"):
        _build(evidence)


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("historical_report_count", 0),
        ("full_bundle_report_count", 1),
        ("historical_report_id", "other_report"),
        ("historical_redacted_report_sha256", "c" * 64),
    ],
)
def test_marker_must_bind_exact_historical_rf_and_zero_full_bundle_reports(
    evidence: dict[str, Path], field: str, replacement: object
) -> None:
    path = evidence["dual_platform_marker"]
    value = json.loads(path.read_text(encoding="utf-8"))
    value["validation_report_state"][field] = replacement
    _write(path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match="historical report"):
        _build(evidence)


@pytest.mark.parametrize(
    ("input_name", "section", "field"),
    [
        ("post_migration_profile_receipt", "effects", "publication_performed"),
        ("post_migration_profile_receipt", "gates", "public_release"),
        ("mobile_compatibility", "effects", "trusted_validation_performed"),
        ("mobile_compatibility", "gates", "public_release"),
        ("finalization_review", "effects", "publication_performed"),
        ("final_readiness_cas_receipt", "effects", "publication_performed"),
        ("dual_platform_marker", "effects", "trusted_validation_performed"),
        ("dual_platform_marker", "gates", "public_release"),
    ],
)
def test_runtime_inputs_cannot_claim_downstream_validation_or_release(
    evidence: dict[str, Path], input_name: str, section: str, field: str
) -> None:
    path = evidence[input_name]
    value = json.loads(path.read_text(encoding="utf-8"))
    value[section][field] = True
    _write(path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match="state|completion"):
        _build(evidence)


def test_marker_envelope_hash_is_recomputed(evidence: dict[str, Path]) -> None:
    path = evidence["dual_platform_marker"]
    value = json.loads(path.read_text(encoding="utf-8"))
    value["dual_platform_envelope"]["canonical_sha256"] = "0" * 64
    _write(path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match="canonical hash"):
        _build(evidence)


@pytest.mark.parametrize("field", ["sha256", "redacted_license_attestation_sha256"])
def test_every_attestation_row_requires_both_exact_hashes(
    evidence: dict[str, Path], field: str
) -> None:
    path = evidence["post_migration_profile_receipt"]
    value = json.loads(path.read_text(encoding="utf-8"))
    del value["redacted_attestation_bindings"][0][field]
    _write(path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match="attestation bindings"):
        _build(evidence)


@pytest.mark.parametrize(
    "field",
    ["narration_map_sha256", "redacted_license_attestation_map_sha256"],
)
def test_post_profile_map_hashes_are_recomputed_from_all_85_rows(
    evidence: dict[str, Path], field: str
) -> None:
    path = evidence["post_migration_profile_receipt"]
    value = json.loads(path.read_text(encoding="utf-8"))
    value["private_state"][field] = "0" * 64
    _write(path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match="map binding"):
        _build(evidence)


def test_checkpoint_m_paths_are_exact_and_private_paths_never_serialize(
    evidence: dict[str, Path]
) -> None:
    path = evidence["mobile_compatibility"]
    value = json.loads(path.read_text(encoding="utf-8"))
    value["checkpoint_m_migration_evidence"]["packet"]["path"] = (
        "/home/private/migration-packet.json"
    )
    _write(path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match="identity or path"):
        _build(evidence)


@pytest.mark.parametrize(
    ("path_keys", "replacement"),
    [
        (("migration_bindings", "packet", "sha256"), "0" * 64),
        (("migration_bindings", "audit", "bindings_sha256"), "0" * 64),
        (("migration_bindings", "source_revision", "commit"), "0" * 40),
    ],
)
def test_post_profile_receipt_binds_exact_checkpoint_m_inputs(
    evidence: dict[str, Path], path_keys: tuple[str, ...], replacement: str
) -> None:
    path = evidence["post_migration_profile_receipt"]
    value = json.loads(path.read_text(encoding="utf-8"))
    target = value
    for key in path_keys[:-1]:
        target = target[key]
    target[path_keys[-1]] = replacement
    _write(path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match="checkpoint-M"):
        _build(evidence)


def test_marker_binds_the_exact_mobile_compatibility_bytes(
    evidence: dict[str, Path]
) -> None:
    path = evidence["dual_platform_marker"]
    value = json.loads(path.read_text(encoding="utf-8"))
    value["mobile_compatibility_freeze"]["sha256"] = "0" * 64
    _write(path, value)
    with pytest.raises(builder.FinalReadinessBuildError, match="mobile compatibility"):
        _build(evidence)


def test_asset_map_and_validation_material_hashes_remain_distinct_contracts(
    evidence: dict[str, Path]
) -> None:
    path = evidence["dual_platform_marker"]
    value = json.loads(path.read_text(encoding="utf-8"))
    value["assets_sha256"] = "b" * 64
    value["dual_platform_envelope"]["evidence"]["assets_sha256"] = "b" * 64
    value["dual_platform_envelope"]["canonical_sha256"] = _sha(
        value["dual_platform_envelope"]["evidence"]
    )
    _write(path, value)
    artifact = _build(evidence)
    assert artifact["draft"]["asset_map_sha256"] == "4" * 64
    assert artifact["draft"]["assets_sha256"] == "b" * 64


def test_no_input_path_or_secret_value_is_serialized(
    evidence: dict[str, Path],
) -> None:
    artifact = _build(evidence)
    encoded = json.dumps(artifact, sort_keys=True)
    for path in evidence.values():
        assert str(path) not in encoded
    for forbidden in (
        '"api_key":',
        '"access_token":',
        '"session_token":',
        '"device_id":',
    ):
        assert forbidden not in encoded.lower()
