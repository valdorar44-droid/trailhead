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
BUILDER_PATH = ROOT / "scripts/build_smokies_mobile_compatibility_freeze.py"
SPEC = importlib.util.spec_from_file_location("build_smokies_mobile_compatibility_freeze", BUILDER_PATH)
assert SPEC is not None and SPEC.loader is not None
builder = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = builder
SPEC.loader.exec_module(builder)


def test_default_dry_run_is_zero_effect_and_artifact_absent(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        builder, "_git", lambda *_args, **_kwargs: pytest.fail("dry run accessed Git"),
    )
    assert builder.main([]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result == builder.dry_run()
    assert result["status"] == "dry_run_clean_source_commit_and_tree_required"
    assert result["writes_performed"] is False
    assert result["network_accessed"] is False
    assert result["database_accessed"] is False
    assert result["mobile_build_performed"] is False
    assert result["device_accessed"] is False
    assert result["publication_performed"] is False
    assert result["output_present_required_now"] is False
    assert not (ROOT / builder.OUTPUT_PATH).exists()


def test_source_commit_and_tree_are_explicit_and_checkpoint_m_ancestry_is_required(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(builder.MobileCompatibilityBuildError, match="source commit"):
        builder.main(["--write"])
    calls = []

    def fake_git(*args: str, binary: bool = False):
        calls.append(args)
        if args == ("rev-parse", "a" * 40 + "^{commit}"):
            return "a" * 40 + "\n"
        if args == ("rev-parse", "a" * 40 + "^{tree}"):
            return "b" * 40 + "\n"
        if args == ("rev-parse", builder.CHECKPOINT_M_COMMIT + "^{tree}"):
            return builder.CHECKPOINT_M_TREE + "\n"
        raise AssertionError(args)

    monkeypatch.setattr(builder, "_git", fake_git)
    monkeypatch.setattr(
        builder.subprocess,
        "run",
        lambda *_args, **_kwargs: type("Result", (), {"returncode": 1})(),
    )
    with pytest.raises(builder.MobileCompatibilityBuildError, match="descend"):
        builder._commit_identity("a" * 40, "b" * 40)
    assert calls


def test_generation_requires_checked_out_pushed_origin_equal_clean_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commit = "a" * 40
    responses = {
        ("rev-parse", "HEAD^{commit}"): commit + "\n",
        ("branch", "--show-current"): builder.RELEASE_BRANCH + "\n",
        (
            "rev-parse",
            f"origin/{builder.RELEASE_BRANCH}^{{commit}}",
        ): commit + "\n",
        ("status", "--porcelain=v1", "--untracked-files=all"): "",
    }
    monkeypatch.setattr(
        builder, "_git", lambda *args, **_kwargs: responses[args],
    )
    assert builder._generation_context(commit) == {
        "branch": builder.RELEASE_BRANCH,
        "origin_ref": f"origin/{builder.RELEASE_BRANCH}",
        "origin_equal": True,
        "worktree_clean_except_generated_artifact": True,
    }
    responses[("status", "--porcelain=v1", "--untracked-files=all")] = (
        " M mobile/app/originals/preview.tsx\n"
    )
    with pytest.raises(builder.MobileCompatibilityBuildError, match="unrelated"):
        builder._generation_context(commit)
    responses[("status", "--porcelain=v1", "--untracked-files=all")] = (
        f"?? {builder.OUTPUT_PATH}\n"
    )
    assert builder._generation_context(commit)["worktree_clean_except_generated_artifact"] is True


def test_output_is_excluded_from_source_set_to_avoid_circular_hash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_paths = set(builder.REQUIRED_SOURCE_PATHS)
    source_paths.add(str(builder.OUTPUT_PATH))
    monkeypatch.setattr(builder, "_commit_paths", lambda _commit: sorted(source_paths))
    with pytest.raises(builder.MobileCompatibilityBuildError, match="already exists"):
        builder._source_sets("a" * 40)
    assert str(builder.OUTPUT_PATH) not in builder.REQUIRED_SOURCE_PATHS


def test_current_s_validator_closure_is_recomputed_from_exact_committed_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert builder.EXPECTED_TRUSTED_VALIDATION_PATH_COUNT == 174
    monkeypatch.setattr(builder, "EXPECTED_TRUSTED_VALIDATION_PATH_COUNT", 1)
    relative = Path("db/store.py")
    payload = b"exact-current-source-S-store"
    digest = hashlib.sha256()
    digest.update(relative.as_posix().encode("utf-8"))
    digest.update(b"\0")
    digest.update(str(len(payload)).encode("ascii"))
    digest.update(b"\0")
    digest.update(payload)
    digest.update(b"\0")
    expected = digest.hexdigest()
    monkeypatch.setattr(
        builder, "trusted_complete_originals_long_form_validator_source_paths",
        lambda: (relative,),
    )
    monkeypatch.setattr(
        builder, "trusted_complete_originals_long_form_validator_source_sha256",
        lambda: expected,
    )
    monkeypatch.setattr(builder, "_blob", lambda _commit, _path: payload)
    monkeypatch.setattr(
        builder, "_blob_row",
        lambda _commit, path: {
            "path": path,
            "byte_count": len(payload),
            "git_blob_sha1": "1" * 40,
            "sha256": hashlib.sha256(payload).hexdigest(),
        },
    )
    closure = builder._trusted_validation_closure("a" * 40)
    assert closure["path_count"] == 1
    assert closure["sha256"] == expected
    assert closure["rows"][0]["path"] == "db/store.py"
    monkeypatch.setattr(
        builder, "trusted_complete_originals_long_form_validator_source_sha256",
        lambda: "0" * 64,
    )
    with pytest.raises(builder.MobileCompatibilityBuildError, match="hash drifted"):
        builder._trusted_validation_closure("a" * 40)


@pytest.mark.parametrize("path_count", [173, 175])
def test_current_s_validator_closure_requires_exact_174_paths(
    monkeypatch: pytest.MonkeyPatch, path_count: int,
) -> None:
    paths = tuple(Path(f"db/closure_{index:03d}.py") for index in range(path_count))
    monkeypatch.setattr(
        builder,
        "trusted_complete_originals_long_form_validator_source_paths",
        lambda: paths,
    )
    monkeypatch.setattr(
        builder,
        "trusted_complete_originals_long_form_validator_source_sha256",
        lambda: "0" * 64,
    )
    with pytest.raises(
        builder.MobileCompatibilityBuildError,
        match="closure inventory is invalid",
    ):
        builder._trusted_validation_closure("a" * 40)


def test_source_set_requires_all_gate_families_and_complete_mobile_tree(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = set(builder.REQUIRED_SOURCE_PATHS)
    for members in builder.GATE_FAMILIES.values():
        paths.update(members)
    paths.add("mobile/lib/originals/index.ts")
    monkeypatch.setattr(builder, "_commit_paths", lambda _commit: sorted(paths))
    monkeypatch.setattr(
        builder, "_blob_row",
        lambda _commit, path: {
            "path": path, "byte_count": len(path),
            "git_blob_sha1": "1" * 40, "sha256": "2" * 64,
        },
    )
    source_sets = builder._source_sets("a" * 40)
    assert set(source_sets["gate_families"]) == set(builder.GATE_FAMILIES)
    assert source_sets["complete_mobile_tracked_source"]["path_count"] > 0
    assert source_sets["complete_mobile_tracked_source"]["scope"] == (
        "all_tracked_mobile_paths"
    )
    assert source_sets["complete_release_support_source"]["path_count"] >= (
        source_sets["complete_mobile_tracked_source"]["path_count"]
    )
    assert source_sets["complete_release_support_source"]["scope"] == (
        "all_tracked_mobile_paths_plus_backend_and_evidence_dependencies"
    )
    for family in source_sets["gate_families"].values():
        assert family["required_for_signed_candidate"] is True
        assert family["executed_by_this_builder"] is False
    incomplete = paths - {builder.GATE_FAMILIES["app_links"][-1]}
    monkeypatch.setattr(builder, "_commit_paths", lambda _commit: sorted(incomplete))
    with pytest.raises(builder.MobileCompatibilityBuildError, match="app_links"):
        builder._source_sets("a" * 40)


def test_exact_candidate_counts_price_access_and_asset_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = {
        "chapters": [
            {"variants": [{}, {}]}, {"variants": [{}]},
            {"variants": [{}]}, {"variants": [{}, {}]},
        ],
        "stories": [{} for _ in range(77)],
        "assets": [
            {"kind": "narration", "bytes": 1} for _ in range(85)
        ] + [
            {"kind": "image", "bytes": 1} for _ in range(13)
        ],
        "offline_map": {"region_id": "union"},
    }
    manifest["assets"][-1]["bytes"] += builder.CONTENT_ASSET_BYTES - 98
    candidate = {
        "product_contract": {
            "permanent_credit_price": 900,
            "explorer_included": True,
            "standalone_product_ids": [],
        }
    }
    monkeypatch.setattr(
        builder, "_json_blob",
        lambda _commit, path: manifest if path.endswith("manifest_v3.json") else candidate,
    )
    contract = builder._candidate_contract("a" * 40)
    assert contract["counts"] == builder.EXPECTED_COUNTS
    assert contract["content_asset_bytes"] == 458_155_200
    assert contract["permanent_earned_credit_price"] == 900
    assert contract["explorer_included"] is True
    assert contract["standalone_chapter_products"] == 0


def test_union_storage_math_and_one_byte_js_precision_note(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    estimate = {
        "storage": {
            "content_asset_bytes": 458_155_200,
            "selected_offline_map_estimated_bytes": 213_074_000,
            "estimated_complete_bundle_bytes": 671_229_200,
            "required_free_space_bytes": 738_352_120,
        }
    }
    monkeypatch.setattr(builder, "_json_blob", lambda *_args: estimate)
    result = builder._offline_contract("a" * 40)
    assert result["mathematical_free_space_threshold_bytes"] == 738_352_120
    assert result["javascript_integer_pass_threshold_bytes"] == 738_352_121
    assert 671_229_200 * 1.1 == 738_352_120.0000001
    assert "one byte above" in result["javascript_precision_note"]


def test_build73_nonreuse_is_exact_dependency_drift_despite_native_tree_equality(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old = {"dependencies": {"react": "x"}}
    new = {
        "dependencies": {
            "react": "x", "@noble/ed25519": "3.1.0", "@noble/hashes": "2.2.0",
        }
    }
    monkeypatch.setattr(
        builder, "_blob",
        lambda commit, path: json.dumps(old if commit == builder.ANDROID_BUILD_73_SOURCE else new).encode(),
    )
    monkeypatch.setattr(builder, "_git", lambda *_args, **_kwargs: "native-tree\n")
    result = builder._build73_nonreuse("a" * 40)
    assert result["reuse"] is False
    assert result["signed_android_build_source_commit"] == builder.ANDROID_BUILD_73_SOURCE
    assert result["android_native_tree_unchanged"] is True
    assert result["ios_native_tree_unchanged"] is True
    assert result["dependency_field_changes"] == [
        {"section": "dependencies", "name": "@noble/ed25519", "from": None, "to": "3.1.0"},
        {"section": "dependencies", "name": "@noble/hashes", "from": None, "to": "2.2.0"},
    ]
    assert result["reason"] == "repository_native_ota_validator_rejects_dependency_field_changes"


def test_prebuild_record_keeps_every_external_gate_and_effect_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(builder, "_commit_identity", lambda *_args: None)
    monkeypatch.setattr(builder, "_commit_paths", lambda _commit: list(builder.REQUIRED_SOURCE_PATHS))
    monkeypatch.setattr(builder, "_source_sets", lambda _commit: {"sets": "bound"})
    monkeypatch.setattr(
        builder, "_pinned_artifacts",
        lambda _commit: {
            "evidence": "bound",
            "originals/smokies/smokies_complete_private_migration_operator_audit_v1.json": {
                "path": "originals/smokies/smokies_complete_private_migration_operator_audit_v1.json",
                "byte_count": 1,
                "sha256": "e" * 64,
            },
            "originals/smokies/smokies_complete_private_migration_packet_v1.json": {
                "path": "originals/smokies/smokies_complete_private_migration_packet_v1.json",
                "byte_count": 2,
                "sha256": "f" * 64,
            },
        },
    )
    monkeypatch.setattr(builder, "_candidate_contract", lambda _commit: {"counts": builder.EXPECTED_COUNTS})
    monkeypatch.setattr(builder, "_offline_contract", lambda _commit: {"bytes": 1})
    monkeypatch.setattr(builder, "_mobile_identity", lambda _commit: {"runtime": "bound"})
    monkeypatch.setattr(builder, "_build73_nonreuse", lambda _commit: {"reuse": False})
    closure = {
        "path_count": 174,
        "sha256": "d" * 64,
        "row_hash_key": "sha256",
        "framing": "path NUL byte-count NUL bytes NUL",
    }
    monkeypatch.setattr(builder, "_trusted_validation_closure", lambda _commit: closure)
    result = builder._build_artifact("a" * 40, "b" * 40)
    assert result["kind"] == "smokies_mobile_compatibility_freeze"
    assert result["status"] == (
        "prebuild_source_compatibility_ready_new_signed_dual_platform_builds_required"
    )
    assert result["source_revision"]["generated_artifact_excluded_from_source_set"] is True
    assert result["source_revision"]["same_source_commit_required_for_android_and_ios"] is True
    assert result["trusted_validation_closure"] == {
        "path_count": 174,
        "sha256": "d" * 64,
        "row_hash_key": "sha256",
        "framing": "path NUL byte-count NUL bytes NUL",
    }
    assert result["required_future_builds"][
        "private_preview_evidence_record_schema"
    ]["fixed_values"]["device_environment"] == {
        "environment": "physical",
        "physical_device": True,
    }
    assert result["checkpoint_m_migration_evidence"] == {
        "commit": builder.CHECKPOINT_M_COMMIT,
        "tree": builder.CHECKPOINT_M_TREE,
        "packet": {
            "path": "originals/smokies/smokies_complete_private_migration_packet_v1.json",
            "byte_count": 2,
            "sha256": "f" * 64,
        },
        "independent_audit": {
            "path": "originals/smokies/smokies_complete_private_migration_operator_audit_v1.json",
            "byte_count": 1,
            "sha256": "e" * 64,
        },
        "historical_immutable": True,
        "executed_later_from_isolated_checkpoint_m": True,
    }
    assert result["product_counts"] == {
        "chapter_count": 4,
        "variant_count": 6,
        "base_entry_count": 77,
        "directional_substitution_count": 8,
        "narration_asset_count": 85,
        "image_asset_count": 13,
        "content_asset_count": 98,
        "union_offline_region_count": 1,
    }
    assert all(value is False for value in result["effects"].values())
    assert all(value is False for value in result["gates"].values())
    assert result["preview_selection_guard"] == {
        "v1_selection_free": True,
        "v2_v3_explicit_selection_required_before_private_download": True,
        "six_complete_candidate_selections_reachable": True,
        "source_family": "preview_selection",
        "device_verified": False,
    }
    assert [item["path"] for item in result["pending_action_time_artifacts"]] == list(
        builder.PENDING_ACTION_TIME_ARTIFACTS
    )
    assert [item["identity"] for item in result["pending_external_private_evidence"]] == list(
        builder.PENDING_EXTERNAL_PRIVATE_EVIDENCE
    )


def test_pinned_artifact_source_size_hash_and_status_drift_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def row(_commit: str, path: str) -> dict:
        immutable = (
            builder.IMMUTABLE_PINNED_ARTIFACTS.get(path)
            or builder.CHECKPOINT_M_MIGRATION_ARTIFACTS.get(path)
        )
        return {
            "path": path,
            "byte_count": immutable[0] if immutable else len(path),
            "git_blob_sha1": "1" * 40,
            "sha256": immutable[1] if immutable else hashlib.sha256(path.encode()).hexdigest(),
        }

    monkeypatch.setattr(builder, "_blob_row", row)
    monkeypatch.setattr(builder, "_assert_path_bindings_current", lambda *_args, **_kwargs: None)
    store = {key: row("x", "db/store.py")[key] for key in ("byte_count", "path", "sha256")}
    values = {
        "smokies_complete_private_candidate_v1.json": {
            "candidate_id": "smokies_complete_private_candidate_20260811_v1",
            "status": "complete_private_candidate_owner_dual_platform_preview_required",
        },
        "remaining_media_acceptance_v1.json": {"status": "owner_accepted"},
        "smokies_complete_private_migration_operator_audit_v1.json": {
            "status": "independent_audit_passed", "findings": {"p0_count": 0, "p1_count": 0},
            "effects": {"network_accessed": False},
            "bindings": {
                "migration_packet": {
                    key: row(
                        "x", "originals/smokies/smokies_complete_private_migration_packet_v1.json"
                    )[key]
                    for key in ("path", "byte_count", "sha256")
                },
            },
        },
        "smokies_v3_release_guard_audit_v1.json": {
            "status": "independent_audit_passed", "findings": {"p0_count": 0, "p1_count": 0},
            "effects": {"ephemeral_test_databases_used": True, "network_accessed": False},
            "bindings": {"store": store},
        },
        "smokies_complete_private_migration_packet_v1.json": {
            "status": "network_and_database_free_plan_live_apply_locked",
            "source_revision": {
                "commit": "4d24fe44a02bbf957c8200399612151f84a1e83a",
                "tree": "9393a7a0049f8c0f4eef60d18ca5579d9f9aeef4",
            },
        },
    }
    monkeypatch.setattr(
        builder, "_json_blob",
        lambda _commit, path: values.get(Path(path).name, {}),
    )
    result = builder._pinned_artifacts("a" * 40)
    assert set(result) == (
        set(builder.IMMUTABLE_PINNED_ARTIFACTS)
        | set(builder.CHECKPOINT_M_MIGRATION_ARTIFACTS)
    )
    original = builder.IMMUTABLE_PINNED_ARTIFACTS[
        "originals/smokies/smokies_union_offline_map_estimate_v1.json"
    ]
    monkeypatch.setattr(
        builder, "_blob_row",
        lambda _commit, path: (
            {"path": path, "byte_count": original[0], "git_blob_sha1": "1" * 40, "sha256": "0" * 64}
            if path.endswith("smokies_union_offline_map_estimate_v1.json")
            else row(_commit, path)
        ),
    )
    with pytest.raises(builder.MobileCompatibilityBuildError, match="Pinned"):
        builder._pinned_artifacts("a" * 40)


def test_artifact_render_is_canonical_deterministic_and_private() -> None:
    value = {
        "z": False,
        "a": {
            "path": "mobile/app/originals/preview.tsx",
            "token_serialized": False,
        },
    }
    first = builder._render(value)
    second = builder._render(copy.deepcopy(value))
    assert first == second
    assert first.endswith(b"\n")
    parsed = json.loads(first)
    assert parsed == value
    assert b"/home/" not in first and b"C:\\Users" not in first
    assert hashlib.sha256(first).hexdigest() == hashlib.sha256(second).hexdigest()
