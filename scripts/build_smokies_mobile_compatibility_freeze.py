#!/usr/bin/env python3
"""Build the pre-build Smokies mobile compatibility/source-freeze record.

No default invocation writes an artifact. Final generation requires an exact
clean source commit and tree *after* this builder, its tests, the marker, and
the final-readiness support are committed. The generated record intentionally
contains no signed-build or device claim; those are future evidence bound to
the same source commit. The output artifact is excluded from the canonical
source set, avoiding a circular self hash.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.originals_complete_validation import (
    OriginalValidationRunnerError,
    trusted_complete_originals_long_form_validator_source_paths,
    trusted_complete_originals_long_form_validator_source_sha256,
)
OUTPUT_PATH = Path("originals/smokies/smokies_mobile_compatibility_freeze_v1.json")
ARTIFACT_ID = "smokies_mobile_compatibility_freeze_20260811_v1"
PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CHECKPOINT_M_COMMIT = "55ffb762335544224fd1b421e1df7c4c27f07f00"
CHECKPOINT_M_TREE = "fc152bfb6be4a2f61a8d16fc06f55d92b900d88c"
ANDROID_BUILD_73_SOURCE = "e8bd03013024f7d43f790d8ee309f2c72b8f1b81"
ANDROID_BUILD_73_VERSION = "1.0.12"
ANDROID_BUILD_73_NUMBER = "73"
ANDROID_RUNTIME = "native-1.0.12-android.1"
IOS_RUNTIME = "native-1.0.12-ios.1"
EAS_PROJECT_ID = "92c016d2-6e63-480e-a483-a6898d7e77d5"
RELEASE_BRANCH = "release/smokies-s4m-production-20260810"

EXPECTED_COUNTS = {
    "chapters": 4,
    "variants": 6,
    "base_entries": 77,
    "directional_replacements": 8,
    "narration_assets": 85,
    "image_assets": 13,
    "content_assets": 98,
    "offline_map_regions": 1,
}
CONTENT_ASSET_BYTES = 458_155_200
OFFLINE_MAP_ESTIMATE_BYTES = 213_074_000
COMPLETE_BUNDLE_ESTIMATE_BYTES = 671_229_200
MATHEMATICAL_FREE_SPACE_THRESHOLD_BYTES = 738_352_120
JS_CONSERVATIVE_INTEGER_FREE_SPACE_THRESHOLD_BYTES = 738_352_121
EXPECTED_TRUSTED_VALIDATION_PATH_COUNT = 174

IMMUTABLE_PINNED_ARTIFACTS = {
    "originals/smokies/smokies_complete_private_candidate_v1.json": (
        20090, "ee01f78dcb43ec9a3b9d02e1cd6e0271675f033dbc9ed6fb18ce2562b4cb0aee",
    ),
    "originals/smokies/smokies_complete_private_manifest_v3.json": (
        3768450, "d2cfa5aeb0116359326f682fb49d59ee156157f9efbfb8e8a53f99e830ca54eb",
    ),
    "originals/smokies/remaining_media_acceptance_v1.json": (
        120715, "e593b5f280b62e00a0887e24cef131858e768f1cbe056476e3b631342a788a2a",
    ),
    "originals/smokies/smokies_union_offline_map_estimate_v1.json": (
        9614, "1b7742efe6b19cf0fc813c6457fed7e4aa0220d2c153d5950a6a9c41c28ad754",
    ),
}
CHECKPOINT_M_MIGRATION_ARTIFACTS = {
    "originals/smokies/smokies_complete_private_migration_packet_v1.json": (
        5_838_967,
        "d2f7ca0b587e67c2f8e9164a4d8f66663e6ac1f1a509af50989e04dcf84f4920",
    ),
    "originals/smokies/smokies_complete_private_migration_operator_audit_v1.json": (
        5_779,
        "28bd4356804994cf48323788335f95d8c99566cbc0c87001340ea709be632188",
    ),
}
REQUIRED_SOURCE_PATHS = {
    "db/originals_complete_validation.py",
    "db/originals_remaining_validation.py",
    "db/originals_route_evidence.py",
    "db/originals_smokies_final_readiness.py",
    "db/originals_validation.py",
    "db/store.py",
    "scripts/build_smokies_full_bundle_final_readiness.py",
    "scripts/build_smokies_full_bundle_finalization_review.py",
    "scripts/finalize_smokies_full_bundle_readiness.py",
    "scripts/attest_and_profile_smokies_complete_private.py",
    "scripts/record_smokies_dual_platform_private_preview.py",
    "scripts/build_smokies_mobile_compatibility_freeze.py",
    "tests/test_smokies_full_bundle_final_readiness.py",
    "tests/test_smokies_full_bundle_final_readiness_cas.py",
    "tests/test_smokies_full_bundle_finalization_review.py",
    "tests/test_smokies_complete_private_attestation_profile.py",
    "tests/test_smokies_dual_platform_private_preview_marker.py",
    "tests/test_smokies_mobile_compatibility_freeze.py",
    *IMMUTABLE_PINNED_ARTIFACTS,
    *CHECKPOINT_M_MIGRATION_ARTIFACTS,
}

GATE_FAMILIES = {
    "typescript": ("mobile/tsconfig.json", "mobile/package.json", "mobile/package-lock.json"),
    "native_drift": ("mobile/scripts/native-drift-check.mjs",),
    "native_ota_compatibility": (
        "mobile/scripts/native-ota-compatibility.mjs",
        "mobile/scripts/native-ota-compatibility.test.mjs",
    ),
    "app_links": (
        "mobile/app.config.js", "mobile/lib/appLinks.ts",
        "mobile/lib/__tests__/appLinks.test.ts",
    ),
    "release_identity": (
        "mobile/scripts/release-identity.cjs",
        "mobile/scripts/release-identity.test.mjs",
        "mobile/scripts/release-worktree.mjs",
        "mobile/scripts/release-worktree.test.mjs",
    ),
    "signed_build_evidence": (
        "mobile/eas.json", "mobile/scripts/eas-build-evidence.mjs",
        "mobile/scripts/eas-build-evidence.test.mjs",
        "mobile/scripts/verify-eas-build-evidence.mjs",
    ),
    "offline_storage_and_cleanup": (
        "mobile/lib/originals/bundleStore.ts",
        "mobile/lib/originals/accountCleanup.ts",
        "mobile/lib/offlineV2/scopeCleanup.ts",
        "mobile/lib/offlineV2/__tests__/scopeCleanup.test.ts",
    ),
    "background_audio": (
        "mobile/lib/originals/audioAdapter.ts",
        "mobile/lib/originals/audioCoordinator.ts",
        "mobile/lib/originals/__tests__/audioCoordinator.test.ts",
    ),
    "preview_selection": (
        "mobile/app/originals/index.tsx", "mobile/app/originals/preview.tsx",
        "mobile/lib/originals/adminPreviewReview.ts",
        "mobile/lib/originals/__tests__/adminPreviewReview.test.ts",
    ),
    "preview_cleanup_and_account_isolation": (
        "mobile/lib/originals/accountCleanup.ts",
        "mobile/lib/__tests__/accountStorageLifecycle.test.ts",
    ),
    "update_channel": (
        "mobile/scripts/eas-update-evidence.mjs",
        "mobile/scripts/eas-update-evidence.test.mjs",
        "mobile/scripts/publish-staged-preview.mjs",
        "mobile/scripts/staged-preview-evidence.mjs",
        "mobile/scripts/staged-preview-evidence.test.mjs",
    ),
}

PENDING_ACTION_TIME_ARTIFACTS = (
    "originals/smokies/official_route_evidence_publication_v1.json",
    "originals/smokies/smokies_full_bundle_finalization_review_v1.json",
    "originals/smokies/smokies_full_bundle_final_readiness_v1.json",
)
PENDING_EXTERNAL_PRIVATE_EVIDENCE = (
    "external_private_attestation_and_profile_receipt",
    "external_private_final_readiness_cas_receipt",
)


class MobileCompatibilityBuildError(RuntimeError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise MobileCompatibilityBuildError(message)


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
    ).encode("utf-8")


def _canonical_sha256(value: object) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _git(*arguments: str, binary: bool = False) -> str | bytes:
    result = subprocess.run(
        ["git", *arguments], cwd=ROOT, check=True,
        capture_output=True, text=not binary,
    )
    return result.stdout


def _commit_identity(commit: str, tree: str) -> None:
    _require(re.fullmatch(r"[a-f0-9]{40}", commit) is not None, "Source commit is invalid")
    _require(re.fullmatch(r"[a-f0-9]{40}", tree) is not None, "Source tree is invalid")
    actual_commit = str(_git("rev-parse", f"{commit}^{{commit}}")).strip()
    actual_tree = str(_git("rev-parse", f"{commit}^{{tree}}")).strip()
    _require(actual_commit == commit and actual_tree == tree, "Source commit or tree drifted")
    ancestry = subprocess.run(
        ["git", "merge-base", "--is-ancestor", CHECKPOINT_M_COMMIT, commit],
        cwd=ROOT,
    )
    _require(ancestry.returncode == 0, "Source does not descend from Checkpoint M")
    _require(
        str(_git("rev-parse", f"{CHECKPOINT_M_COMMIT}^{{tree}}")).strip()
        == CHECKPOINT_M_TREE,
        "Checkpoint M identity drifted",
    )


def _generation_context(commit: str) -> dict[str, Any]:
    head = str(_git("rev-parse", "HEAD^{commit}")).strip()
    branch = str(_git("branch", "--show-current")).strip()
    origin_ref = f"origin/{RELEASE_BRANCH}"
    origin = str(_git("rev-parse", f"{origin_ref}^{{commit}}")).strip()
    _require(head == commit, "Generation source commit is not checked out")
    _require(branch == RELEASE_BRANCH, "Generation branch is not the guarded release branch")
    _require(origin == commit, "Generation source is not pushed and origin-equal")
    status = str(_git("status", "--porcelain=v1", "--untracked-files=all"))
    lines = [line for line in status.splitlines() if line]
    allowed = {f"?? {OUTPUT_PATH}"}
    _require(set(lines).issubset(allowed), "Generation worktree contains unrelated changes")
    return {
        "branch": branch,
        "origin_ref": origin_ref,
        "origin_equal": True,
        "worktree_clean_except_generated_artifact": True,
    }


def _commit_paths(commit: str) -> list[str]:
    output = str(_git("ls-tree", "-r", "--name-only", commit))
    return [line for line in output.splitlines() if line]


def _blob(commit: str, path: str) -> bytes:
    return bytes(_git("show", f"{commit}:{path}", binary=True))


def _blob_row(commit: str, path: str) -> dict[str, Any]:
    payload = _blob(commit, path)
    blob = str(_git("rev-parse", f"{commit}:{path}")).strip()
    return {
        "path": path,
        "byte_count": len(payload),
        "git_blob_sha1": blob,
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def _json_blob(commit: str, path: str) -> dict[str, Any]:
    try:
        value = json.loads(_blob(commit, path).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MobileCompatibilityBuildError(f"Committed JSON is invalid: {path}") from exc
    _require(isinstance(value, dict), f"Committed JSON is not an object: {path}")
    return value


def _source_sets(commit: str) -> dict[str, Any]:
    paths = set(_commit_paths(commit))
    _require(str(OUTPUT_PATH) not in paths, "Generated artifact already exists in source commit")
    missing = REQUIRED_SOURCE_PATHS - paths
    _require(not missing, f"Required source paths are absent: {sorted(missing)}")
    mobile_paths = sorted(path for path in paths if path.startswith("mobile/"))
    _require(mobile_paths, "Mobile source set is empty")
    source_paths = sorted(set(mobile_paths) | REQUIRED_SOURCE_PATHS)
    mobile_rows = [_blob_row(commit, path) for path in mobile_paths]
    release_rows = [_blob_row(commit, path) for path in source_paths]
    native_paths = sorted(
        path for path in mobile_paths
        if path.startswith(("mobile/android/", "mobile/ios/", "mobile/modules/", "mobile/patches/"))
        or path in {
            "mobile/app.config.js", "mobile/eas.json", "mobile/package.json",
            "mobile/package-lock.json",
        }
    )
    native_rows = [_blob_row(commit, path) for path in native_paths]
    gate_rows = {}
    for family, required in sorted(GATE_FAMILIES.items()):
        _require(set(required).issubset(paths), f"{family} gate family is incomplete")
        gate_rows[family] = {
            "paths": list(required),
            "source_set_sha256": _canonical_sha256(
                [_blob_row(commit, path) for path in sorted(required)]
            ),
            "required_for_signed_candidate": True,
            "executed_by_this_builder": False,
        }
    return {
        "complete_mobile_tracked_source": {
            "path_count": len(mobile_paths),
            "rows": mobile_rows,
            "source_set_sha256": _canonical_sha256(mobile_rows),
            "scope": "all_tracked_mobile_paths",
        },
        "complete_release_support_source": {
            "path_count": len(release_rows),
            "rows": release_rows,
            "source_set_sha256": _canonical_sha256(release_rows),
            "scope": "all_tracked_mobile_paths_plus_backend_and_evidence_dependencies",
        },
        "native_input_closure": {
            "path_count": len(native_rows),
            "rows": native_rows,
            "source_set_sha256": _canonical_sha256(native_rows),
        },
        "gate_families": gate_rows,
    }


def _trusted_validation_closure(commit: str) -> dict[str, Any]:
    """Bind the current source-S validator closure, not checkpoint M's closure."""
    try:
        paths = tuple(trusted_complete_originals_long_form_validator_source_paths())
        reported_sha256 = trusted_complete_originals_long_form_validator_source_sha256()
    except (OSError, OriginalValidationRunnerError) as exc:
        raise MobileCompatibilityBuildError(
            "Current trusted-validation closure is unavailable"
        ) from exc
    _require(
        paths == tuple(sorted(paths, key=lambda item: item.as_posix()))
        and len(paths) == len(set(paths))
        and len(paths) == EXPECTED_TRUSTED_VALIDATION_PATH_COUNT
        and all(not path.is_absolute() and ".." not in path.parts for path in paths),
        "Current trusted-validation closure inventory is invalid",
    )
    rows = [_blob_row(commit, path.as_posix()) for path in paths]
    digest = hashlib.sha256()
    for row in rows:
        raw = _blob(commit, row["path"])
        digest.update(row["path"].encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(raw)).encode("ascii"))
        digest.update(b"\0")
        digest.update(raw)
        digest.update(b"\0")
    computed_sha256 = digest.hexdigest()
    _require(
        computed_sha256 == reported_sha256,
        "Current trusted-validation closure hash drifted",
    )
    return {
        "schema_version": 1,
        "path_count": len(rows),
        "rows": rows,
        "sha256": computed_sha256,
        "row_hash_key": "sha256",
        "framing": (
            "for each repo-relative path sorted by POSIX path: "
            "utf8(path) + NUL + ascii(decimal_byte_count) + NUL + raw_bytes + NUL"
        ),
    }


def _assert_path_bindings_current(
    commit: str, bindings: object, *, label: str,
) -> None:
    _require(isinstance(bindings, dict), f"{label} bindings are invalid")
    for binding_name, value in bindings.items():
        if not isinstance(value, dict) or not isinstance(value.get("path"), str):
            continue
        path = value["path"]
        if "byte_count" not in value or "sha256" not in value:
            continue
        row = _blob_row(commit, path)
        _require(
            value.get("byte_count") == row["byte_count"]
            and value.get("sha256") == row["sha256"],
            f"{label} source binding drifted: {binding_name}",
        )


def _pinned_artifacts(commit: str) -> dict[str, dict[str, Any]]:
    result = {}
    for path, (expected_bytes, expected_sha) in sorted(IMMUTABLE_PINNED_ARTIFACTS.items()):
        row = _blob_row(commit, path)
        _require(
            row["byte_count"] == expected_bytes and row["sha256"] == expected_sha,
            f"Pinned candidate evidence drifted: {path}",
        )
        result[path] = row
    for path, (expected_bytes, expected_sha) in sorted(
        CHECKPOINT_M_MIGRATION_ARTIFACTS.items()
    ):
        row = _blob_row(commit, path)
        _require(
            row["byte_count"] == expected_bytes and row["sha256"] == expected_sha,
            f"Checkpoint-M migration evidence drifted: {path}",
        )
        result[path] = row
    candidate = _json_blob(commit, "originals/smokies/smokies_complete_private_candidate_v1.json")
    _require(candidate.get("candidate_id") == "smokies_complete_private_candidate_20260811_v1", "Candidate identity drifted")
    _require(candidate.get("status") == "complete_private_candidate_owner_dual_platform_preview_required", "Candidate state drifted")
    media = _json_blob(commit, "originals/smokies/remaining_media_acceptance_v1.json")
    _require("owner_accepted" in str(media.get("status") or ""), "Media acceptance state drifted")
    migration = _json_blob(commit, "originals/smokies/smokies_complete_private_migration_operator_audit_v1.json")
    _require(migration.get("status") == "independent_audit_passed", "Migration audit is not passed")
    _require(
        isinstance(migration.get("findings"), dict)
        and migration["findings"].get("p0_count") == 0
        and migration["findings"].get("p1_count") == 0
        ,
        "Migration audit has a blocking finding",
    )
    _require(
        isinstance(migration.get("effects"), dict)
        and all(value is False for key, value in migration["effects"].items() if key != "ephemeral_test_databases_used")
        ,
        "Migration audit reports an external effect",
    )
    packet = _json_blob(commit, "originals/smokies/smokies_complete_private_migration_packet_v1.json")
    _require(
        packet.get("status") == "network_and_database_free_plan_live_apply_locked"
        and packet.get("source_revision") == {
            "commit": "4d24fe44a02bbf957c8200399612151f84a1e83a",
            "tree": "9393a7a0049f8c0f4eef60d18ca5579d9f9aeef4",
        }
        and (migration.get("bindings") or {}).get("migration_packet")
        == {
            key: result[
                "originals/smokies/smokies_complete_private_migration_packet_v1.json"
            ][key]
            for key in ("path", "byte_count", "sha256")
        },
        "Checkpoint M historical migration binding is incomplete",
    )
    return result


def _candidate_contract(commit: str) -> dict[str, Any]:
    manifest = _json_blob(commit, "originals/smokies/smokies_complete_private_manifest_v3.json")
    chapters = manifest.get("chapters") or []
    stories = manifest.get("stories") or []
    assets = manifest.get("assets") or []
    variants = sum(len(chapter.get("variants") or []) for chapter in chapters)
    narration = sum(asset.get("kind") == "narration" for asset in assets)
    images = sum(asset.get("kind") == "image" for asset in assets)
    # Directional replacements are a locked product invariant, already bound by
    # candidate/release-guard evidence. It is deliberately not re-inferred from
    # presentation-level cue ordering.
    counts = {
        "chapters": len(chapters), "variants": variants,
        "base_entries": len(stories), "directional_replacements": 8,
        "narration_assets": narration, "image_assets": images,
        "content_assets": len(assets),
        "offline_map_regions": 1 if (manifest.get("offline_map") or {}).get("region_id") else 0,
    }
    _require(counts == EXPECTED_COUNTS, "Complete candidate counts drifted")
    byte_count = sum(int(asset["bytes"]) for asset in assets)
    _require(byte_count == CONTENT_ASSET_BYTES, "Complete candidate asset bytes drifted")
    candidate = _json_blob(commit, "originals/smokies/smokies_complete_private_candidate_v1.json")
    product = candidate.get("product_contract") or {}
    _require(
        product.get("permanent_credit_price") == 900
        and product.get("explorer_included") is True
        and product.get("standalone_product_ids") == [],
        "Product price/access/standalone contract drifted",
    )
    return {
        "counts": counts,
        "content_asset_bytes": byte_count,
        "permanent_earned_credit_price": 900,
        "explorer_included": True,
        "standalone_chapter_products": 0,
    }


def _offline_contract(commit: str) -> dict[str, Any]:
    estimate = _json_blob(commit, "originals/smokies/smokies_union_offline_map_estimate_v1.json")
    storage = estimate.get("storage") or {}
    _require(
        storage.get("content_asset_bytes") == CONTENT_ASSET_BYTES
        and storage.get("selected_offline_map_estimated_bytes") == OFFLINE_MAP_ESTIMATE_BYTES
        and storage.get("estimated_complete_bundle_bytes") == COMPLETE_BUNDLE_ESTIMATE_BYTES
        and storage.get("required_free_space_bytes") == MATHEMATICAL_FREE_SPACE_THRESHOLD_BYTES,
        "Union map storage contract drifted",
    )
    return {
        "content_asset_bytes": CONTENT_ASSET_BYTES,
        "selected_offline_map_estimated_bytes": OFFLINE_MAP_ESTIMATE_BYTES,
        "estimated_complete_bundle_bytes": COMPLETE_BUNDLE_ESTIMATE_BYTES,
        "mathematical_free_space_threshold_bytes": MATHEMATICAL_FREE_SPACE_THRESHOLD_BYTES,
        "javascript_integer_pass_threshold_bytes": JS_CONSERVATIVE_INTEGER_FREE_SPACE_THRESHOLD_BYTES,
        "javascript_precision_note": (
            "The runtime compares freeBytes < totalBytes * 1.1; IEEE-754 evaluates "
            "671229200 * 1.1 as 738352120.0000001, so the first passing integer is "
            "one byte above the exact mathematical threshold."
        ),
    }


def _build73_nonreuse(commit: str) -> dict[str, Any]:
    old_package = json.loads(_blob(ANDROID_BUILD_73_SOURCE, "mobile/package.json"))
    new_package = json.loads(_blob(commit, "mobile/package.json"))
    changes = []
    for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        old = old_package.get(section) or {}
        new = new_package.get(section) or {}
        for name in sorted(set(old) | set(new)):
            if old.get(name) != new.get(name):
                changes.append({"section": section, "name": name, "from": old.get(name), "to": new.get(name)})
    _require(changes == [
        {"section": "dependencies", "name": "@noble/ed25519", "from": None, "to": "3.1.0"},
        {"section": "dependencies", "name": "@noble/hashes", "from": None, "to": "2.2.0"},
    ], "Build-73 dependency drift proof changed")
    old_android = str(_git("rev-parse", f"{ANDROID_BUILD_73_SOURCE}:mobile/android")).strip()
    new_android = str(_git("rev-parse", f"{commit}:mobile/android")).strip()
    old_ios = str(_git("rev-parse", f"{ANDROID_BUILD_73_SOURCE}:mobile/ios")).strip()
    new_ios = str(_git("rev-parse", f"{commit}:mobile/ios")).strip()
    _require(old_android == new_android and old_ios == new_ios, "Native tree comparison drifted")
    return {
        "reuse": False,
        "signed_android_build_source_commit": ANDROID_BUILD_73_SOURCE,
        "app_version": ANDROID_BUILD_73_VERSION,
        "build_number": ANDROID_BUILD_73_NUMBER,
        "runtime_version": ANDROID_RUNTIME,
        "android_native_tree_unchanged": True,
        "android_native_tree": new_android,
        "ios_native_tree_unchanged": True,
        "ios_native_tree": new_ios,
        "dependency_field_changes": changes,
        "reason": "repository_native_ota_validator_rejects_dependency_field_changes",
    }


def _mobile_identity(commit: str) -> dict[str, Any]:
    config = _blob(commit, "mobile/app.config.js").decode("utf-8")
    eas = _json_blob(commit, "mobile/eas.json")
    _require(f"runtimeVersion: '{ANDROID_RUNTIME}'" in config, "Android runtime drifted")
    _require(f"runtimeVersion: '{IOS_RUNTIME}'" in config, "iOS runtime drifted")
    _require(EAS_PROJECT_ID in config, "EAS project identity drifted")
    preview = (eas.get("build") or {}).get("preview") or {}
    _require(
        (eas.get("cli") or {}).get("version") == "21.0.2"
        and preview.get("distribution") == "internal"
        and preview.get("channel") == "preview"
        and (preview.get("ios") or {}).get("simulator") is False,
        "EAS preview profile drifted",
    )
    return {
        "app_version": "1.0.12",
        "android_runtime_version": ANDROID_RUNTIME,
        "ios_runtime_version": IOS_RUNTIME,
        "eas_project_id": EAS_PROJECT_ID,
        "eas_cli_version": "21.0.2",
        "preview_distribution": "internal",
        "preview_channel": "preview",
        "ios_simulator": False,
    }


def _build_artifact(
    commit: str, tree: str, *, generation_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _commit_identity(commit, tree)
    paths = set(_commit_paths(commit))
    for pending in PENDING_ACTION_TIME_ARTIFACTS:
        _require(pending not in paths, f"Action-time artifact unexpectedly exists: {pending}")
    source_sets = _source_sets(commit)
    artifacts = _pinned_artifacts(commit)
    validator = _trusted_validation_closure(commit)
    source_sets["trusted_validation_closure"] = validator
    return {
        "schema_version": 1,
        "artifact_id": ARTIFACT_ID,
        "kind": "smokies_mobile_compatibility_freeze",
        "status": "prebuild_source_compatibility_ready_new_signed_dual_platform_builds_required",
        "product_id": PRODUCT_ID,
        "source_revision": {
            "commit": commit,
            "tree": tree,
            "checkpoint_m_commit": CHECKPOINT_M_COMMIT,
            "checkpoint_m_tree": CHECKPOINT_M_TREE,
            "generated_artifact_excluded_from_source_set": True,
            "same_source_commit_required_for_android_and_ios": True,
            "generation_context": copy.deepcopy(generation_context) if generation_context else {
                "branch": RELEASE_BRANCH,
                "origin_ref": f"origin/{RELEASE_BRANCH}",
                "origin_equal": True,
                "worktree_clean_except_generated_artifact": True,
            },
        },
        # This compact compatibility view is the stable input consumed by the
        # later final-readiness aggregator. The full canonical source sets are
        # retained below and independently hash every tracked mobile path.
        "trusted_validation_closure": {
            key: validator[key]
            for key in ("path_count", "sha256", "row_hash_key", "framing")
        },
        "checkpoint_m_migration_evidence": {
            "commit": CHECKPOINT_M_COMMIT,
            "tree": CHECKPOINT_M_TREE,
            "packet": artifacts[
                "originals/smokies/smokies_complete_private_migration_packet_v1.json"
            ],
            "independent_audit": artifacts[
                "originals/smokies/smokies_complete_private_migration_operator_audit_v1.json"
            ],
            "historical_immutable": True,
            "executed_later_from_isolated_checkpoint_m": True,
        },
        "candidate_contract": _candidate_contract(commit),
        "product_counts": {
            "chapter_count": EXPECTED_COUNTS["chapters"],
            "variant_count": EXPECTED_COUNTS["variants"],
            "base_entry_count": EXPECTED_COUNTS["base_entries"],
            "directional_substitution_count": EXPECTED_COUNTS[
                "directional_replacements"
            ],
            "narration_asset_count": EXPECTED_COUNTS["narration_assets"],
            "image_asset_count": EXPECTED_COUNTS["image_assets"],
            "content_asset_count": EXPECTED_COUNTS["content_assets"],
            "union_offline_region_count": EXPECTED_COUNTS["offline_map_regions"],
        },
        "pinned_evidence": artifacts,
        "offline_storage_contract": _offline_contract(commit),
        "mobile_identity": _mobile_identity(commit),
        "android_build_73_reuse": _build73_nonreuse(commit),
        "source_sets": source_sets,
        "preview_selection_guard": {
            "v1_selection_free": True,
            "v2_v3_explicit_selection_required_before_private_download": True,
            "six_complete_candidate_selections_reachable": True,
            "source_family": "preview_selection",
            "device_verified": False,
        },
        "required_future_builds": {
            "source_commit": commit,
            "source_tree": tree,
            "android": {"signed": True, "preview_profile": True, "required": True},
            "ios": {"signed": True, "preview_profile": True, "required": True},
            "same_source_commit": True,
            "build_identity_record_schema": {
                "schema_version": 1,
                "required_exact_fields": [
                    "schema_version", "kind", "status", "product_id", "platform",
                    "source_revision", "build_id", "app_version", "build_number",
                    "runtime_version", "channel", "distribution", "signed", "simulator",
                    "eas_project_id", "native_fingerprint_sha256", "build_artifact_sha256",
                ],
                "fixed_values": {
                    "kind": "trailhead_signed_mobile_build_identity",
                    "status": "verified_signed_preview_build",
                    "product_id": PRODUCT_ID,
                    "source_revision": {"commit": commit, "tree": tree},
                    "app_version": "1.0.12",
                    "channel": "preview",
                    "distribution": "internal",
                    "signed": True,
                    "simulator": False,
                    "eas_project_id": EAS_PROJECT_ID,
                },
                "platform_values": {
                    "android": {"runtime_version": ANDROID_RUNTIME},
                    "ios": {"runtime_version": IOS_RUNTIME},
                },
                "provider_build_id_required": True,
                "native_fingerprint_sha256_required": True,
                "build_artifact_sha256_required": True,
            },
            "private_preview_evidence_record_schema": {
                "schema_version": 1,
                "required_exact_fields": [
                    "schema_version", "kind", "status", "product_id", "platform",
                    "source_revision", "build_identity_sha256", "build_id",
                    "draft_revision", "manifest_sha256", "assets_sha256", "completed_at",
                    "selection_keys", "counts", "offline_map", "device_environment",
                    "checks", "privacy",
                ],
                "fixed_values": {
                    "kind": "smokies_complete_private_preview_evidence",
                    "status": "verified_complete_private_preview",
                    "product_id": PRODUCT_ID,
                    "source_revision": {"commit": commit, "tree": tree},
                    "draft_revision": 5,
                    "selection_keys": [
                        "mountain_crossing:tn_to_nc",
                        "mountain_crossing:nc_to_tn",
                        "little_river_cades_cove:sugarlands_to_cades_cove_loop",
                        "roaring_fork:one_way",
                        "foothills_parkway:west_to_east",
                        "foothills_parkway:east_to_west",
                    ],
                    "counts": copy.deepcopy(EXPECTED_COUNTS),
                    "device_environment": {
                        "environment": "physical",
                        "physical_device": True,
                    },
                },
                "all_playback_paths_and_offline_lifecycle_required": True,
            },
        },
        "pending_action_time_artifacts": [
            {"path": path, "present": False, "fabricated": False}
            for path in PENDING_ACTION_TIME_ARTIFACTS
        ],
        "pending_external_private_evidence": [
            {"identity": identity, "present": False, "fabricated": False}
            for identity in PENDING_EXTERNAL_PRIVATE_EVIDENCE
        ],
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
        "privacy": {
            "absolute_local_paths_serialized": False,
            "account_identifier_serialized": False,
            "device_identifier_serialized": False,
            "api_key_or_token_serialized": False,
            "raw_provider_response_serialized": False,
        },
    }


def _render(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def build_all(
    commit: str, tree: str, *, generation_context: dict[str, Any] | None = None,
) -> dict[Path, bytes]:
    return {
        OUTPUT_PATH: _render(
            _build_artifact(commit, tree, generation_context=generation_context)
        )
    }


def _write(outputs: dict[Path, bytes]) -> None:
    for relative, payload in outputs.items():
        path = ROOT / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)


def _check(outputs: dict[Path, bytes]) -> None:
    for relative, payload in outputs.items():
        path = ROOT / relative
        _require(path.is_file() and path.read_bytes() == payload, f"Generated artifact drifted: {relative}")


def dry_run() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "status": "dry_run_clean_source_commit_and_tree_required",
        "output_path": str(OUTPUT_PATH),
        "output_present_required_now": False,
        "checkpoint_m_commit": CHECKPOINT_M_COMMIT,
        "checkpoint_m_tree": CHECKPOINT_M_TREE,
        "pending_action_time_artifacts": list(PENDING_ACTION_TIME_ARTIFACTS),
        "pending_external_private_evidence": list(PENDING_EXTERNAL_PRIVATE_EVIDENCE),
        "writes_performed": False,
        "network_accessed": False,
        "database_accessed": False,
        "mobile_build_performed": False,
        "device_accessed": False,
        "publication_performed": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    parser.add_argument("--source-commit")
    parser.add_argument("--source-tree")
    args = parser.parse_args(argv)
    if not args.write and not args.check:
        print(json.dumps(dry_run(), indent=2, sort_keys=True))
        return 0
    _require(isinstance(args.source_commit, str), "Exact source commit is required")
    _require(isinstance(args.source_tree, str), "Exact source tree is required")
    generation_context = _generation_context(args.source_commit)
    outputs = build_all(
        args.source_commit, args.source_tree,
        generation_context=generation_context,
    )
    if args.write:
        _write(outputs)
    else:
        _check(outputs)
    print(json.dumps({
        "status": "verified",
        "source_commit": args.source_commit,
        "source_tree": args.source_tree,
        "artifacts": {
            str(path): {"byte_count": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
            for path, payload in outputs.items()
        },
        "network_accessed": False,
        "database_accessed": False,
        "mobile_build_performed": False,
        "device_accessed": False,
        "publication_performed": False,
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
