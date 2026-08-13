#!/usr/bin/env python3
"""Guarded revision-preserving marker for the exact dual-platform preview.

The default invocation is a zero-effect dry run. Live apply requires five
private evidence files, a private receipt directory, and the exact sentinel
``RECORD_SMOKIES_DUAL_PLATFORM_PRIVATE_PREVIEW``. The one database mutation is
a ``BEGIN IMMEDIATE`` CAS over revision 5 and changes validation metadata only.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import ctypes
from datetime import datetime, timezone
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import store


PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
EXPECTED_DRAFT_REVISION = 5
APPLY_SENTINEL = "RECORD_SMOKIES_DUAL_PLATFORM_PRIVATE_PREVIEW"
RECEIPT_ID = "smokies_dual_platform_private_preview_marker_20260811_v1"
RECEIPT_TABLE = "authored_original_smokies_dual_platform_preview_receipts_v1"
RECEIPT_COLUMNS = (
    "receipt_id", "pack_id", "draft_revision", "manifest_sha256",
    "assets_sha256", "validation_input_sha256",
    "before_validation_metadata_sha256", "after_validation_metadata_sha256",
    "evidence_sha256", "evidence_file_sha256",
    "compatibility_freeze_sha256", "source_commit", "source_tree",
    "android_build_identity_sha256", "android_preview_evidence_sha256",
    "ios_build_identity_sha256", "ios_preview_evidence_sha256",
    "historical_validation_report_count",
    "full_bundle_validation_report_count",
    "validation_report_inventory_sha256",
    "admin_user_id", "idempotency_key_sha256", "request_sha256",
    "receipt_json", "receipt_sha256", "created_at",
)
COMPATIBILITY_REPO_PATH = "originals/smokies/smokies_mobile_compatibility_freeze_v1.json"
COMPATIBILITY_PATH = ROOT / COMPATIBILITY_REPO_PATH
SOURCE_BINDING_PATHS = (
    "scripts/record_smokies_dual_platform_private_preview.py",
    "scripts/build_smokies_mobile_compatibility_freeze.py",
    "tests/test_smokies_dual_platform_private_preview_marker.py",
    "tests/test_smokies_mobile_compatibility_freeze.py",
    "db/store.py",
)
EXPECTED_SELECTION_KEYS = [
    "mountain_crossing:tn_to_nc",
    "mountain_crossing:nc_to_tn",
    "little_river_cades_cove:sugarlands_to_cades_cove_loop",
    "roaring_fork:one_way",
    "foothills_parkway:west_to_east",
    "foothills_parkway:east_to_west",
]
EXPECTED_PREVIEW_CHECKS = {
    "single_four_chapter_product_verified",
    "six_selections_verified",
    "all_77_base_entries_verified",
    "all_8_directional_substitutions_verified",
    "all_13_images_verified",
    "app_links_verified",
    "gps_behavior_verified",
    "off_route_behavior_verified",
    "artwork_behavior_verified",
    "captions_verified",
    "all_85_narration_playback_paths_exercised",
    "media_controls_verified",
    "interruption_resume_cleanup_verified",
    "current_road_fail_closed_verified",
    "vehicle_policy_matrix_verified",
}
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
EXPECTED_CONTENT_ASSET_BYTES = 458_155_200
PLATFORM_KEYS = {
    "android": ("android_build_identity", "android_preview_evidence"),
    "ios": ("ios_build_identity", "ios_preview_evidence"),
}
BUILD_IDENTITY_FIELDS = (
    "schema_version", "kind", "status", "product_id", "platform",
    "source_revision", "build_id", "app_version", "build_number",
    "runtime_version", "channel", "distribution", "signed", "simulator",
    "eas_project_id", "native_fingerprint_id", "native_fingerprint_hash",
    "build_artifact_sha256",
)


class DualPlatformPreviewMarkerError(RuntimeError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise DualPlatformPreviewMarkerError(message)


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
    ).encode("utf-8")


def _canonical_sha256(value: object) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DualPlatformPreviewMarkerError(
            f"Private JSON evidence is unavailable or invalid: {path.name}"
        ) from exc
    _require(isinstance(value, dict), f"Private JSON evidence is not an object: {path.name}")
    return value


def _canonical_utc(value: object, label: str) -> str:
    raw = str(value or "")
    _require(raw.endswith("Z"), f"{label} must be canonical UTC")
    try:
        parsed = datetime.fromisoformat(raw[:-1] + "+00:00").astimezone(timezone.utc)
    except ValueError as exc:
        raise DualPlatformPreviewMarkerError(f"{label} must be canonical UTC") from exc
    canonical = parsed.isoformat().replace("+00:00", "Z")
    _require(raw == canonical, f"{label} must be canonical UTC")
    return raw


def _safe_sha(value: object, label: str) -> str:
    _require(
        isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None,
        f"{label} is invalid",
    )
    return value


def _canonical_uuid(value: object, label: str) -> str:
    _require(
        isinstance(value, str)
        and re.fullmatch(
            r"[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}",
            value,
        ) is not None,
        f"{label} is invalid",
    )
    return value


def _native_fingerprint_hash(value: object, label: str) -> str:
    _require(
        isinstance(value, str) and re.fullmatch(r"[a-f0-9]{40}", value) is not None,
        f"{label} is invalid",
    )
    return value


def _source_revision(value: object, label: str) -> dict[str, str]:
    _require(
        isinstance(value, dict) and set(value) == {"commit", "tree"},
        f"{label} fields are invalid",
    )
    commit, tree = value.get("commit"), value.get("tree")
    _require(
        isinstance(commit, str) and re.fullmatch(r"[a-f0-9]{40}", commit) is not None,
        f"{label} commit is invalid",
    )
    _require(
        isinstance(tree, str) and re.fullmatch(r"[a-f0-9]{40}", tree) is not None,
        f"{label} tree is invalid",
    )
    return {"commit": commit, "tree": tree}


def _load_compatibility_freeze() -> dict[str, Any]:
    value = _load_json(COMPATIBILITY_PATH)
    _require(
        value.get("schema_version") == 1
        and value.get("kind") == "smokies_mobile_compatibility_freeze"
        and value.get("status")
        == "prebuild_source_compatibility_ready_new_signed_dual_platform_builds_required"
        and value.get("product_id") == PRODUCT_ID,
        "Mobile compatibility freeze identity drifted",
    )
    revision_root = value.get("source_revision")
    _require(isinstance(revision_root, dict), "Compatibility source revision is invalid")
    revision = _source_revision(
        {"commit": revision_root.get("commit"), "tree": revision_root.get("tree")},
        "Compatibility source revision",
    )
    _require(
        revision_root.get("generated_artifact_excluded_from_source_set") is True
        and revision_root.get("same_source_commit_required_for_android_and_ios") is True,
        "Compatibility source-freeze semantics drifted",
    )
    future = value.get("required_future_builds")
    _require(
        isinstance(future, dict)
        and future.get("source_commit") == revision["commit"]
        and future.get("source_tree") == revision["tree"]
        and future.get("same_source_commit") is True,
        "Compatibility future-build source binding drifted",
    )
    build_schema = future.get("build_identity_record_schema")
    preview_schema = future.get("private_preview_evidence_record_schema")
    _require(
        isinstance(build_schema, dict)
        and build_schema.get("schema_version") == 1
        and build_schema.get("required_exact_fields") == list(BUILD_IDENTITY_FIELDS)
        and (build_schema.get("fixed_values") or {}).get("source_revision") == revision
        and (build_schema.get("fixed_values") or {}).get("kind")
        == "trailhead_signed_mobile_build_identity"
        and build_schema.get("native_fingerprint_id_required") is True
        and build_schema.get("native_fingerprint_id_format") == "canonical_uuid"
        and build_schema.get("native_fingerprint_hash_required") is True
        and build_schema.get("native_fingerprint_hash_format")
        == "lowercase_sha1_hex_40"
        and "native_fingerprint_sha256_required" not in build_schema
        and isinstance(preview_schema, dict)
        and (preview_schema.get("fixed_values") or {}).get("source_revision") == revision
        and (preview_schema.get("fixed_values") or {}).get("kind")
        == "smokies_complete_private_preview_evidence"
        and (preview_schema.get("fixed_values") or {}).get("counts")
        == EXPECTED_COUNTS
        and (preview_schema.get("fixed_values") or {}).get("device_environment")
        == {"environment": "physical", "physical_device": True},
        "Compatibility private evidence schemas drifted",
    )
    _require(
        isinstance(value.get("android_build_73_reuse"), dict)
        and value["android_build_73_reuse"].get("reuse") is False,
        "Compatibility record did not require a new Android build",
    )
    _require(
        isinstance(value.get("effects"), dict)
        and all(item is False for item in value["effects"].values())
        and isinstance(value.get("gates"), dict)
        and all(item is False for item in value["gates"].values()),
        "Compatibility record contains a completed external effect or gate",
    )
    release_set = (
        (value.get("source_sets") or {}).get("complete_release_support_source") or {}
    )
    rows = release_set.get("rows")
    _require(isinstance(rows, list), "Compatibility release source set is invalid")
    for source_path in SOURCE_BINDING_PATHS:
        matches = [
            row for row in rows
            if isinstance(row, dict) and row.get("path") == source_path
        ]
        _require(
            len(matches) == 1,
            f"Compatibility source set does not bind {source_path}",
        )
        source_file = ROOT / source_path
        _require(
            source_file.is_file()
            and matches[0].get("byte_count") == source_file.stat().st_size
            and matches[0].get("sha256") == _sha256_path(source_file),
            f"Source changed after the mobile compatibility freeze: {source_path}",
        )
    return {
        "record": value,
        "path": COMPATIBILITY_REPO_PATH,
        "byte_count": COMPATIBILITY_PATH.stat().st_size,
        "sha256": _sha256_path(COMPATIBILITY_PATH),
        "source_revision": revision,
    }


def _beneath(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _reject_symlink_components(path: Path) -> None:
    current = Path(path.anchor)
    for component in path.parts[1:]:
        current /= component
        if current.is_symlink():
            raise DualPlatformPreviewMarkerError(
                f"Private path contains a symlink: {path.name}"
            )


def _private_file(path: Path, label: str) -> Path:
    _require(path.is_absolute(), f"{label} path must be absolute")
    _reject_symlink_components(path)
    try:
        info = path.stat()
    except OSError as exc:
        raise DualPlatformPreviewMarkerError(f"{label} file is unavailable") from exc
    _require(stat.S_ISREG(info.st_mode), f"{label} must be a regular file")
    _require(info.st_uid == os.geteuid(), f"{label} must be operator owned")
    _require(info.st_nlink == 1, f"{label} cannot be hard linked")
    _require(stat.S_IMODE(info.st_mode) == 0o600, f"{label} must have mode 0600")
    resolved = path.resolve(strict=True)
    _require(not _beneath(resolved, ROOT.resolve()), f"{label} must stay outside Git")
    return resolved


def _private_receipt_path(path: Path) -> Path:
    _require(path.is_absolute(), "Receipt path must be absolute")
    _reject_symlink_components(path.parent)
    try:
        parent = path.parent.resolve(strict=True)
        info = parent.stat()
    except OSError as exc:
        raise DualPlatformPreviewMarkerError("Receipt directory is unavailable") from exc
    _require(stat.S_ISDIR(info.st_mode), "Receipt parent must be a directory")
    _require(info.st_uid == os.geteuid(), "Receipt directory must be operator owned")
    _require(stat.S_IMODE(info.st_mode) == 0o700, "Receipt directory must have mode 0700")
    _require(not _beneath(parent, ROOT.resolve()), "Receipt must stay outside Git")
    result = parent / path.name
    _require(result.name not in {"", ".", ".."}, "Receipt filename is invalid")
    if result.exists() or result.is_symlink():
        _private_file(result, "Existing receipt")
    return result


def _decode_object(value: object, label: str) -> dict[str, Any]:
    try:
        result = json.loads(str(value))
    except (TypeError, json.JSONDecodeError) as exc:
        raise DualPlatformPreviewMarkerError(f"{label} is invalid") from exc
    _require(isinstance(result, dict), f"{label} is invalid")
    return result


def _database_path(db: sqlite3.Connection) -> Path:
    values = [str(row[2]) for row in db.execute("PRAGMA database_list") if str(row[1]) == "main"]
    _require(len(values) == 1 and values[0], "Configured database identity is unavailable")
    path = Path(values[0])
    _require(path.is_absolute(), "Configured database path must be absolute")
    _reject_symlink_components(path)
    return path.resolve(strict=True)


def _stored_receipt_row(db: sqlite3.Connection) -> sqlite3.Row | None:
    """Validate the dedicated durable-receipt schema before reading a row."""
    expected_types = {
        name: (
            "INTEGER"
            if name in {
                "draft_revision", "historical_validation_report_count",
                "full_bundle_validation_report_count", "admin_user_id", "created_at",
            }
            else "TEXT"
        )
        for name in RECEIPT_COLUMNS
    }
    try:
        columns = db.execute(f"PRAGMA table_info({RECEIPT_TABLE})").fetchall()
        _require(
            tuple(str(row[1]) for row in columns) == RECEIPT_COLUMNS
            and all(str(row[2]).upper() == expected_types[str(row[1])] for row in columns)
            and sum(int(row[5]) == 1 for row in columns) == 1
            and next(int(row[5]) for row in columns if str(row[1]) == "receipt_id") == 1,
            "Marker receipt table schema drifted",
        )
        unique_pack = False
        for index in db.execute(f"PRAGMA index_list({RECEIPT_TABLE})").fetchall():
            if int(index[2]) != 1:
                continue
            indexed = db.execute(f"PRAGMA index_info({index[1]})").fetchall()
            if [str(row[2]) for row in indexed] == ["pack_id"]:
                unique_pack = True
        _require(unique_pack, "Marker receipt pack identity is not unique")
        foreign_keys = {
            (str(row[3]), str(row[2]), str(row[4]))
            for row in db.execute(f"PRAGMA foreign_key_list({RECEIPT_TABLE})").fetchall()
        }
        _require(
            ("pack_id", "authored_trip_packs", "id") in foreign_keys
            and ("admin_user_id", "users", "id") in foreign_keys,
            "Marker receipt foreign-key contract drifted",
        )
        rows = db.execute(f"SELECT * FROM {RECEIPT_TABLE}").fetchall()
    except sqlite3.Error as exc:
        raise DualPlatformPreviewMarkerError(
            "Marker durable receipt table is unavailable"
        ) from exc
    _require(len(rows) <= 1, "Marker receipt table contains foreign rows")
    if not rows:
        return None
    row = rows[0]
    _require(
        tuple(row.keys()) == RECEIPT_COLUMNS
        and row["receipt_id"] == RECEIPT_ID
        and row["pack_id"] == PRODUCT_ID,
        "Marker receipt identity drifted",
    )
    return row


def _manifest_counts(manifest: dict[str, Any]) -> dict[str, int]:
    chapters = manifest.get("chapters")
    stories = manifest.get("stories")
    assets = manifest.get("assets")
    offline = manifest.get("offline_map")
    _require(isinstance(chapters, list), "Draft chapter inventory is invalid")
    _require(isinstance(stories, list), "Draft story inventory is invalid")
    _require(isinstance(assets, list), "Draft asset inventory is invalid")
    _require(isinstance(offline, dict), "Draft offline-map inventory is invalid")
    try:
        counts = {
            "chapters": len(chapters),
            "variants": sum(
                len(chapter.get("variants") or [])
                for chapter in chapters if isinstance(chapter, dict)
            ),
            "base_entries": len(stories),
            "directional_replacements": sum(
                len(story.get("variant_overrides") or [])
                for story in stories if isinstance(story, dict)
            ),
            "narration_assets": sum(
                isinstance(asset, dict) and asset.get("kind") == "narration"
                for asset in assets
            ),
            "image_assets": sum(
                isinstance(asset, dict) and asset.get("kind") == "image"
                for asset in assets
            ),
            "content_assets": len(assets),
            "offline_map_regions": 1 if offline.get("region_id") else 0,
        }
        content_asset_bytes = sum(
            int(asset["bytes"]) for asset in assets if isinstance(asset, dict)
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise DualPlatformPreviewMarkerError("Draft content counts are invalid") from exc
    _require(counts == EXPECTED_COUNTS, "Draft complete-product counts drifted")
    _require(
        content_asset_bytes == EXPECTED_CONTENT_ASSET_BYTES,
        "Draft complete-product content bytes drifted",
    )
    return counts


def _historical_validation_inventory(db: sqlite3.Connection) -> dict[str, Any]:
    rows = db.execute(
        "SELECT * FROM authored_original_validation_reports WHERE pack_id=? ORDER BY id",
        (PRODUCT_ID,),
    ).fetchall()
    try:
        history, _history_binding = store.load_smokies_historical_validation_contract()
        canonical_inventory = store._smokies_historical_validation_inventory(
            rows, history
        )
    except (ValueError, KeyError, TypeError) as exc:
        raise DualPlatformPreviewMarkerError(
            "Historical validation report canonical inventory drifted"
        ) from exc
    _require(
        canonical_inventory.get("historical_report_count") == 1
        and canonical_inventory.get("full_bundle_report_count") == 0
        and isinstance(canonical_inventory.get("inventory"), list)
        and len(canonical_inventory["inventory"]) == 1
        and canonical_inventory["inventory"][0].get("report_id")
        == history.get("report_id")
        and canonical_inventory["inventory"][0].get("redacted_report_sha256")
        == history.get("redacted_report_sha256")
        and _safe_sha(
            canonical_inventory.get("inventory_sha256"),
            "Historical validation report inventory sha256",
        ),
        "Historical validation report canonical inventory drifted",
    )
    return {
        "historical_report_count": 1,
        "full_bundle_report_count": 0,
        "historical_report_id": history["report_id"],
        "historical_redacted_report_sha256": history["redacted_report_sha256"],
        "inventory_sha256": canonical_inventory["inventory_sha256"],
    }


def _asset_sha_map(manifest: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for asset in manifest.get("assets") or []:
        _require(isinstance(asset, dict), "Draft asset row is invalid")
        asset_id, digest = asset.get("id"), asset.get("sha256")
        _require(
            isinstance(asset_id, str)
            and re.fullmatch(r"[a-z0-9]+(?:_[a-z0-9]+)*", asset_id) is not None,
            "Draft asset id is invalid",
        )
        _require(
            isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest) is not None,
            "Draft asset sha256 is invalid",
        )
        _require(asset_id not in result, "Draft asset ids are not unique")
        result[asset_id] = digest
    _require(len(result) == 98, "Draft asset membership drifted")
    return result


def _validated_platform_files(
    evidence: dict[str, Any], paths: dict[str, Path], compatibility: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    rows = evidence.get("platforms")
    _require(
        isinstance(rows, list) and len(rows) == 2,
        "Dual-platform evidence coverage is invalid",
    )
    by_platform = {
        str(row.get("platform") or ""): row
        for row in rows if isinstance(row, dict)
    }
    _require(set(by_platform) == {"android", "ios"}, "Android and iOS evidence are required")
    result = {}
    expected_source = compatibility["source_revision"]
    accepted_at = _canonical_utc(evidence.get("accepted_at"), "Preview accepted_at")
    accepted_timestamp = datetime.fromisoformat(
        accepted_at[:-1] + "+00:00"
    ).timestamp()
    for platform, (build_key, preview_key) in PLATFORM_KEYS.items():
        build_sha = _sha256_path(paths[build_key])
        preview_sha = _sha256_path(paths[preview_key])
        _require(
            by_platform[platform].get("build_identity_sha256") == build_sha,
            f"{platform} build identity hash does not match the envelope",
        )
        _require(
            by_platform[platform].get("preview_evidence_sha256") == preview_sha,
            f"{platform} preview evidence hash does not match the envelope",
        )
        build = _load_json(paths[build_key])
        _require(
            set(build) == set(BUILD_IDENTITY_FIELDS),
            f"{platform} build identity fields are invalid",
        )
        source = _source_revision(build.get("source_revision"), f"{platform} build source")
        runtime = "native-1.0.12-android.1" if platform == "android" else "native-1.0.12-ios.1"
        build_id = build.get("build_id")
        build_number = build.get("build_number")
        _require(
            build.get("schema_version") == 1
            and build.get("kind") == "trailhead_signed_mobile_build_identity"
            and build.get("status") == "verified_signed_preview_build"
            and build.get("product_id") == PRODUCT_ID
            and build.get("platform") == platform
            and source == expected_source
            and isinstance(build_id, str)
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,127}", build_id) is not None
            and build.get("app_version") == "1.0.12"
            and isinstance(build_number, str)
            and re.fullmatch(r"[1-9][0-9]{0,15}", build_number) is not None
            and build.get("runtime_version") == runtime
            and build.get("channel") == "preview"
            and build.get("distribution") == "internal"
            and build.get("signed") is True
            and build.get("simulator") is False
            and build.get("eas_project_id") == "92c016d2-6e63-480e-a483-a6898d7e77d5",
            f"{platform} build identity is not the exact signed preview candidate",
        )
        native_fingerprint_id = _canonical_uuid(
            build.get("native_fingerprint_id"), f"{platform} native fingerprint id",
        )
        native_fingerprint_hash = _native_fingerprint_hash(
            build.get("native_fingerprint_hash"), f"{platform} native fingerprint hash",
        )
        build_artifact = _safe_sha(
            build.get("build_artifact_sha256"), f"{platform} signed build artifact",
        )
        preview = _load_json(paths[preview_key])
        required_preview_fields = {
            "schema_version", "kind", "status", "product_id", "platform",
            "source_revision", "build_identity_sha256", "build_id",
            "draft_revision", "manifest_sha256", "assets_sha256", "completed_at",
            "selection_keys", "counts", "offline_map", "device_environment",
            "checks", "privacy",
        }
        _require(set(preview) == required_preview_fields, f"{platform} preview evidence fields are invalid")
        completed_at = _canonical_utc(preview.get("completed_at"), f"{platform} preview completed_at")
        completed_timestamp = datetime.fromisoformat(
            completed_at[:-1] + "+00:00"
        ).timestamp()
        _require(completed_timestamp <= accepted_timestamp, f"{platform} preview completed after owner acceptance")
        preview_source = _source_revision(preview.get("source_revision"), f"{platform} preview source")
        _require(
            preview.get("schema_version") == 1
            and preview.get("kind") == "smokies_complete_private_preview_evidence"
            and preview.get("status") == "verified_complete_private_preview"
            and preview.get("product_id") == PRODUCT_ID
            and preview.get("platform") == platform
            and preview_source == expected_source
            and preview.get("build_identity_sha256") == build_sha
            and preview.get("build_id") == build_id
            and preview.get("draft_revision") == EXPECTED_DRAFT_REVISION
            and preview.get("manifest_sha256") == evidence.get("manifest_sha256")
            and preview.get("assets_sha256") == evidence.get("assets_sha256")
            and preview.get("selection_keys") == EXPECTED_SELECTION_KEYS
            and preview.get("counts") == EXPECTED_COUNTS,
            f"{platform} preview does not bind the exact source/build/draft/content snapshot",
        )
        _require(
            preview.get("device_environment") == {
                "environment": "physical",
                "physical_device": True,
            },
            f"{platform} preview was not completed on a physical device",
        )
        offline = preview.get("offline_map")
        _require(
            isinstance(offline, dict)
            and set(offline) == {
                "region_id", "estimated_map_bytes", "mathematical_required_free_space_bytes",
                "javascript_integer_required_free_space_bytes", "installed_map_bytes",
                "free_space_before_download_bytes", "download_complete",
                "capacity_accounting_complete", "restart_recovery_complete",
                "scoped_deletion_complete",
            }
            and offline.get("region_id") == "smokies_ridges_rivers_living_memory_union_private_v1"
            and offline.get("estimated_map_bytes") == 213_074_000
            and offline.get("mathematical_required_free_space_bytes") == 738_352_120
            and offline.get("javascript_integer_required_free_space_bytes") == 738_352_121
            and isinstance(offline.get("installed_map_bytes"), int)
            and not isinstance(offline.get("installed_map_bytes"), bool)
            and 0 < offline["installed_map_bytes"] <= 213_074_000
            and isinstance(offline.get("free_space_before_download_bytes"), int)
            and not isinstance(offline.get("free_space_before_download_bytes"), bool)
            and offline["free_space_before_download_bytes"] >= 738_352_121
            and all(
                offline.get(key) is True
                for key in (
                    "download_complete", "capacity_accounting_complete",
                    "restart_recovery_complete", "scoped_deletion_complete",
                )
            ),
            f"{platform} union offline-map evidence is incomplete",
        )
        checks = preview.get("checks")
        _require(
            isinstance(checks, dict)
            and set(checks) == EXPECTED_PREVIEW_CHECKS
            and all(value is True for value in checks.values()),
            f"{platform} private-preview behavior coverage is incomplete",
        )
        privacy = preview.get("privacy")
        _require(
            privacy == {
                "raw_device_identifier_serialized": False,
                "account_identifier_serialized": False,
                "api_key_or_token_serialized": False,
            },
            f"{platform} private-preview privacy contract drifted",
        )
        result[platform] = {
            "platform": platform,
            "source_commit": expected_source["commit"],
            "source_tree": expected_source["tree"],
            "build_identity_file_sha256": build_sha,
            "preview_evidence_file_sha256": preview_sha,
            "build_id": build_id,
            "build_number": build_number,
            "runtime_version": runtime,
            "native_fingerprint_id": native_fingerprint_id,
            "native_fingerprint_hash": native_fingerprint_hash,
            "build_artifact_sha256": build_artifact,
            "preview_completed_at": completed_at,
            "installed_map_bytes": offline["installed_map_bytes"],
            "device_environment": "physical",
            "physical_device_verified": True,
        }
    return result


def _expected_after(
    validation: dict[str, Any], evidence: dict[str, Any], evidence_sha256: str
) -> dict[str, Any]:
    result = copy.deepcopy(validation)
    result["dual_platform_private_preview_complete"] = True
    result["dual_platform_private_preview_evidence"] = copy.deepcopy(evidence)
    result["dual_platform_private_preview_evidence_sha256"] = evidence_sha256
    return result


def _inspect_locked(db: sqlite3.Connection, proposed: dict[str, Any]) -> dict[str, Any]:
    quick = db.execute("PRAGMA quick_check").fetchall()
    _require(len(quick) == 1 and str(quick[0][0]).lower() == "ok", "SQLite quick_check failed")
    pack = db.execute(
        "SELECT * FROM authored_trip_packs WHERE id=? AND content_kind='original_drive'",
        (PRODUCT_ID,),
    ).fetchone()
    _require(pack is not None, "Complete Smokies private draft is unavailable")
    raw_pack = dict(pack)
    _require(
        pack["status"] == "draft"
        and pack["current_published_version"] is None
        and int(pack["draft_revision"]) == EXPECTED_DRAFT_REVISION,
        "Complete Smokies draft is not exact unpublished revision 5",
    )
    for table, message in (
        ("authored_trip_pack_versions", "A public Smokies version already exists"),
        ("authored_original_release_authorizations_v1", "A release authorization already exists"),
    ):
        count = int(db.execute(f"SELECT COUNT(*) FROM {table} WHERE pack_id=?", (PRODUCT_ID,)).fetchone()[0])
        _require(count == 0, message)
    report_state = _historical_validation_inventory(db)
    raw_manifest = _decode_object(pack["draft_original_manifest_json"], "Draft manifest")
    _require(raw_manifest.get("schema_version") == 3, "Draft is not Manifest V3")
    try:
        manifest, _ = store._normalize_original_manifest(
            PRODUCT_ID, str(pack["draft_title"]), raw_manifest, publishing=False,
        )
    except Exception as exc:
        raise DualPlatformPreviewMarkerError("Draft manifest is invalid") from exc
    counts = _manifest_counts(manifest)
    asset_sha = _asset_sha_map(manifest)
    try:
        store._validate_original_profile_all_assets_locked(db, PRODUCT_ID, manifest, asset_sha)
        profile = manifest.get("narration_profile")
        _require(
            isinstance(profile, dict) and profile.get("schema_version") == 2,
            "Pack-wide narration profile is missing",
        )
        base_manifest = copy.deepcopy(manifest)
        base_manifest.pop("narration_profile", None)
        narration_sha = {
            str(asset["id"]): str(asset["sha256"])
            for asset in manifest.get("assets") or []
            if isinstance(asset, dict) and asset.get("kind") == "narration"
        }
        narration_bindings = store._validate_original_narration_profile_bindings_locked(
            db, PRODUCT_ID, base_manifest, profile, narration_sha,
        )
        _require(
            len(narration_bindings) == 85,
            "Complete narration profile binding count drifted",
        )
        verified_assets = store._verified_original_asset_map_db(db, PRODUCT_ID)
        _require(set(verified_assets) == set(asset_sha), "Verified asset membership drifted")
        validation_manifest = store._authored_original_validation_manifest_from_row(
            pack, verified_assets, include_validation_audio_evidence=True,
        )
        material = store._original_validation_material(validation_manifest, EXPECTED_DRAFT_REVISION)
    except DualPlatformPreviewMarkerError:
        raise
    except Exception as exc:
        raise DualPlatformPreviewMarkerError(
            "Private asset bytes or complete validation material drifted"
        ) from exc
    validation = _decode_object(pack["draft_validation_metadata"], "Draft validation metadata")
    _require(
        validation.get("trusted_publication_validation_complete") is False
        and validation.get("public_release") is False,
        "Downstream validation or release gates changed",
    )
    proposed_sha = _canonical_sha256(proposed)
    try:
        evidence, evidence_sha = store._original_v3_release_device_evidence_db(
            db,
            {
                "dual_platform_private_preview_complete": True,
                "dual_platform_private_preview_evidence": proposed,
                "dual_platform_private_preview_evidence_sha256": proposed_sha,
            },
            pack_id=PRODUCT_ID,
            draft_revision=EXPECTED_DRAFT_REVISION,
            manifest_sha256=material["manifest_sha256"],
            assets_sha256=material["assets_sha256"],
        )
    except Exception as exc:
        raise DualPlatformPreviewMarkerError(
            "Dual-platform evidence is not the canonical release-guard envelope"
        ) from exc
    existing_gate = validation.get("dual_platform_private_preview_complete")
    if existing_gate is True:
        _require(
            validation.get("dual_platform_private_preview_evidence") == evidence
            and validation.get("dual_platform_private_preview_evidence_sha256") == evidence_sha,
            "Different dual-platform preview evidence is already immutable",
        )
        state, after = "applied", copy.deepcopy(validation)
    else:
        _require(
            existing_gate is False
            and validation.get("dual_platform_private_preview_evidence") is None
            and validation.get("dual_platform_private_preview_evidence_sha256") is None,
            "Dual-platform preview gate is not in its exact preflight state",
        )
        state, after = "pending", _expected_after(validation, evidence, evidence_sha)
    return {
        "state": state,
        "pack": raw_pack,
        "manifest_sha256": material["manifest_sha256"],
        "assets_sha256": material["assets_sha256"],
        "validation_input_sha256": material["input_sha256"],
        "before_validation_sha256": _canonical_sha256(validation),
        "after_validation": after,
        "after_validation_sha256": _canonical_sha256(after),
        "evidence": evidence,
        "evidence_sha256": evidence_sha,
        "asset_set_sha256": _canonical_sha256(asset_sha),
        "counts": counts,
        "validation_report_state": report_state,
    }


def _link_unnamed(descriptor: int, parent_descriptor: int, name: str) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    linkat = getattr(libc, "linkat", None)
    _require(linkat is not None, "Receipt linkat is unavailable")
    linkat.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
    linkat.restype = ctypes.c_int
    destination = os.fsencode(name)
    if linkat(descriptor, b"", parent_descriptor, destination, 0x1000) == 0:
        return
    direct_error = ctypes.get_errno()
    if direct_error == errno.EEXIST:
        raise FileExistsError(name)
    allowed = {errno.EACCES, errno.EINVAL, errno.ENOENT, errno.ENOSYS, errno.EOPNOTSUPP, errno.EPERM}
    _require(direct_error in allowed, "Receipt anonymous link failed")
    source = f"/proc/self/fd/{descriptor}"
    _require(
        (os.fstat(descriptor).st_dev, os.fstat(descriptor).st_ino)
        == (os.stat(source).st_dev, os.stat(source).st_ino),
        "Receipt procfd source drifted",
    )
    if linkat(-100, os.fsencode(source), parent_descriptor, destination, 0x400) == 0:
        return
    fallback_error = ctypes.get_errno()
    if fallback_error == errno.EEXIST:
        raise FileExistsError(name)
    raise DualPlatformPreviewMarkerError("Receipt create-only linking is unsupported")


def _install_receipt(path: Path, payload: bytes) -> bool:
    if path.exists() or path.is_symlink():
        existing = _private_file(path, "Existing receipt")
        _require(existing.read_bytes() == payload, "Existing receipt conflicts with exact result")
        return False
    parent_descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    anonymous_flag = getattr(os, "O_TMPFILE", 0)
    _require(bool(anonymous_flag), "Receipt O_TMPFILE is unavailable")
    try:
        descriptor = os.open(
            ".", os.O_RDWR | anonymous_flag | getattr(os, "O_CLOEXEC", 0),
            0o600, dir_fd=parent_descriptor,
        )
        try:
            os.fchmod(descriptor, 0o600)
            offset = 0
            while offset < len(payload):
                written = os.write(descriptor, payload[offset:])
                _require(written > 0, "Receipt anonymous write failed")
                offset += written
            os.fsync(descriptor)
            info = os.fstat(descriptor)
            _require(
                stat.S_ISREG(info.st_mode)
                and info.st_nlink == 0
                and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_uid == os.geteuid(),
                "Receipt anonymous inode is unsafe",
            )
            try:
                _link_unnamed(descriptor, parent_descriptor, path.name)
            except FileExistsError:
                existing = _private_file(path, "Existing receipt")
                _require(existing.read_bytes() == payload, "Receipt create-only race conflicted")
                return False
            installed = _private_file(path, "Installed receipt")
            _require(installed.read_bytes() == payload, "Installed receipt bytes drifted")
            os.fsync(parent_descriptor)
            return True
        finally:
            os.close(descriptor)
    finally:
        os.close(parent_descriptor)


@contextlib.contextmanager
def _exclusive_lock(receipt: Path) -> Iterator[None]:
    lock_path = receipt.parent / f".{receipt.name}.lock"
    _reject_symlink_components(lock_path)
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        info = os.fstat(descriptor)
        _require(
            stat.S_ISREG(info.st_mode)
            and info.st_uid == os.geteuid()
            and info.st_nlink == 1
            and stat.S_IMODE(info.st_mode) == 0o600,
            "Receipt lock file is unsafe",
        )
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def _source_bindings(compatibility: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result = {}
    for relative in SOURCE_BINDING_PATHS:
        path = ROOT / relative
        result[relative] = {
            "path": relative,
            "byte_count": path.stat().st_size,
            "sha256": _sha256_path(path),
        }
    result[compatibility["path"]] = {
        "path": compatibility["path"],
        "byte_count": compatibility["byte_count"],
        "sha256": compatibility["sha256"],
    }
    return result


def _receipt(
    state: dict[str, Any], platform_files: dict[str, dict[str, Any]],
    evidence_file_sha256: str, database_identity: dict[str, Any],
    compatibility: dict[str, Any], request: dict[str, Any], request_sha256: str,
    recorded_at_unix: int,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "kind": "smokies_dual_platform_private_preview_marker",
        "status": "verified_dual_platform_private_preview",
        "receipt_id": RECEIPT_ID,
        "operation": "validation_metadata_only_revision_preserving_cas",
        "product_id": PRODUCT_ID,
        "draft_revision": EXPECTED_DRAFT_REVISION,
        "manifest_sha256": state["manifest_sha256"],
        "assets_sha256": state["assets_sha256"],
        "validation_input_sha256": state["validation_input_sha256"],
        "validation_metadata_sha256": state["after_validation_sha256"],
        "evidence_sha256": state["evidence_sha256"],
        "evidence_file_sha256": evidence_file_sha256,
        "dual_platform_envelope": {
            "canonical_sha256": state["evidence_sha256"],
            "evidence": copy.deepcopy(state["evidence"]),
        },
        "database_identity": copy.deepcopy(database_identity),
        "asset_set_sha256": state["asset_set_sha256"],
        "accepted_at": state["evidence"]["accepted_at"],
        "accepted_by_admin_user_id": state["evidence"][
            "accepted_by_admin_user_id"
        ],
        "counts": copy.deepcopy(state["counts"]),
        "validation_report_state": copy.deepcopy(state["validation_report_state"]),
        "platform_files": copy.deepcopy(platform_files),
        "source_revision": copy.deepcopy(compatibility["source_revision"]),
        "mobile_compatibility_freeze": {
            "path": compatibility["path"],
            "byte_count": compatibility["byte_count"],
            "sha256": compatibility["sha256"],
        },
        "request": copy.deepcopy(request),
        "request_sha256": request_sha256,
        "recorded_at_unix": recorded_at_unix,
        "idempotent_replay_safe": True,
        "source_bindings": _source_bindings(compatibility),
        "invariants": {
            "canonical_release_guard_envelope": True,
            "all_current_asset_bytes_force_rehashed": True,
            "draft_manifest_mutated": False,
            "draft_revision_mutated": False,
            "validation_report_created": False,
            "release_authorization_created": False,
            "catalog_mutated": False,
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


def apply_private(
    evidence_path: Path,
    receipt_path: Path,
    platform_paths: dict[str, Path],
    idempotency_key: str,
) -> dict[str, Any]:
    clean_key = str(idempotency_key or "").strip()
    _require(
        re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{15,159}", clean_key) is not None,
        "Marker idempotency key must be 16-160 safe characters",
    )
    idempotency_key_sha256 = hashlib.sha256(clean_key.encode("utf-8")).hexdigest()
    evidence_path = _private_file(evidence_path, "Dual-platform envelope")
    receipt_path = _private_receipt_path(receipt_path)
    paths = {
        key: _private_file(path, key.replace("_", " ").title())
        for key, path in platform_paths.items()
    }
    _require(
        set(paths) == {key for pair in PLATFORM_KEYS.values() for key in pair},
        "Exact Android and iOS evidence file set is required",
    )
    all_inputs = [evidence_path, *paths.values()]
    _require(len(set(all_inputs)) == len(all_inputs), "Private evidence files must be distinct")
    proposed = _load_json(evidence_path)
    compatibility = _load_compatibility_freeze()
    platform_files = _validated_platform_files(proposed, paths, compatibility)
    evidence_file_sha = _sha256_path(evidence_path)
    with _exclusive_lock(receipt_path):
        db = store._conn()
        db.row_factory = sqlite3.Row
        try:
            db.execute("BEGIN IMMEDIATE")
            database = _database_path(db)
            database_info = database.stat()
            database_identity = {
                "path_sha256": hashlib.sha256(str(database).encode("utf-8")).hexdigest(),
                "device": int(database_info.st_dev),
                "inode": int(database_info.st_ino),
            }
            _require(database not in all_inputs, "Private evidence collides with the database")
            _require(receipt_path != database, "Receipt collides with the database")
            before = _inspect_locked(db, proposed)
            if receipt_path.exists() or receipt_path.is_symlink():
                _require(before["state"] == "applied", "Receipt exists before the database gate")
            stored_row = _stored_receipt_row(db)
            if stored_row is not None:
                stored_before_sha = _safe_sha(
                    stored_row["before_validation_metadata_sha256"],
                    "Stored pre-marker validation hash",
                )
            else:
                stored_before_sha = before["before_validation_sha256"]
            database_request = {
                "schema_version": 1,
                "receipt_id": RECEIPT_ID,
                "product_id": PRODUCT_ID,
                "draft_revision": EXPECTED_DRAFT_REVISION,
                "manifest_sha256": before["manifest_sha256"],
                "assets_sha256": before["assets_sha256"],
                "validation_input_sha256": before["validation_input_sha256"],
                "before_validation_metadata_sha256": stored_before_sha,
                "evidence_sha256": before["evidence_sha256"],
                "evidence_file_sha256": evidence_file_sha,
                "compatibility_freeze_sha256": compatibility["sha256"],
                "source_revision": copy.deepcopy(compatibility["source_revision"]),
                "platform_file_bindings_sha256": _canonical_sha256(platform_files),
                "accepted_by_admin_user_id": before["evidence"][
                    "accepted_by_admin_user_id"
                ],
                "validation_report_state": copy.deepcopy(
                    before["validation_report_state"]
                ),
                "idempotency_key_sha256": idempotency_key_sha256,
                "database_identity": copy.deepcopy(database_identity),
            }
            replayed = stored_row is not None
            if replayed:
                _require(before["state"] == "applied", "Stored marker receipt has no applied gate")
                stored = dict(stored_row)
                expected_stored = {
                    "receipt_id": RECEIPT_ID,
                    "pack_id": PRODUCT_ID,
                    "draft_revision": EXPECTED_DRAFT_REVISION,
                    "manifest_sha256": before["manifest_sha256"],
                    "assets_sha256": before["assets_sha256"],
                    "validation_input_sha256": before["validation_input_sha256"],
                    "before_validation_metadata_sha256": stored_before_sha,
                    "after_validation_metadata_sha256": before["after_validation_sha256"],
                    "evidence_sha256": before["evidence_sha256"],
                    "evidence_file_sha256": evidence_file_sha,
                    "compatibility_freeze_sha256": compatibility["sha256"],
                    "source_commit": compatibility["source_revision"]["commit"],
                    "source_tree": compatibility["source_revision"]["tree"],
                    "android_build_identity_sha256": platform_files["android"][
                        "build_identity_file_sha256"
                    ],
                    "android_preview_evidence_sha256": platform_files["android"][
                        "preview_evidence_file_sha256"
                    ],
                    "ios_build_identity_sha256": platform_files["ios"][
                        "build_identity_file_sha256"
                    ],
                    "ios_preview_evidence_sha256": platform_files["ios"][
                        "preview_evidence_file_sha256"
                    ],
                    "historical_validation_report_count": 1,
                    "full_bundle_validation_report_count": 0,
                    "validation_report_inventory_sha256": before[
                        "validation_report_state"
                    ]["inventory_sha256"],
                    "admin_user_id": before["evidence"]["accepted_by_admin_user_id"],
                    "idempotency_key_sha256": idempotency_key_sha256,
                }
                try:
                    stored_receipt = json.loads(stored["receipt_json"])
                except (TypeError, json.JSONDecodeError) as exc:
                    raise DualPlatformPreviewMarkerError(
                        "Stored marker receipt is invalid"
                    ) from exc
                verified = before
                request_sha256 = _canonical_sha256(database_request)
                created_at = stored.get("created_at")
                _require(
                    isinstance(created_at, int)
                    and not isinstance(created_at, bool)
                    and created_at > 0,
                    "Stored marker receipt time is invalid",
                )
                expected_receipt = _receipt(
                    verified, platform_files, evidence_file_sha,
                    database_identity, compatibility, database_request,
                    request_sha256, created_at,
                )
                canonical_receipt_json = json.dumps(
                    expected_receipt, ensure_ascii=False,
                    separators=(",", ":"), sort_keys=True,
                )
                expected_stored.update({
                    "request_sha256": request_sha256,
                    "receipt_json": canonical_receipt_json,
                    "receipt_sha256": _canonical_sha256(expected_receipt),
                    "created_at": created_at,
                })
                for field, expected in expected_stored.items():
                    _require(
                        stored.get(field) == expected,
                        f"Stored marker receipt replay input drifted: {field}",
                    )
                _require(
                    isinstance(stored_receipt, dict)
                    and stored_receipt == expected_receipt,
                    "Stored marker receipt content drifted",
                )
                receipt = expected_receipt
            else:
                _require(before["state"] == "pending", "Applied marker gate lacks durable receipt")
                after_json = json.dumps(
                    before["after_validation"], ensure_ascii=False,
                    separators=(",", ":"), sort_keys=True,
                )
                updated = db.execute(
                    """UPDATE authored_trip_packs SET draft_validation_metadata=?
                       WHERE id=? AND content_kind='original_drive' AND status='draft'
                         AND current_published_version IS NULL AND draft_revision=?
                         AND draft_original_manifest_json=? AND draft_validation_metadata=?""",
                    (
                        after_json, PRODUCT_ID, EXPECTED_DRAFT_REVISION,
                        before["pack"]["draft_original_manifest_json"],
                        before["pack"]["draft_validation_metadata"],
                    ),
                )
                _require(updated.rowcount == 1, "Exact revision-5 preview CAS lost its race")
                verified = _inspect_locked(db, proposed)
                _require(verified["state"] == "applied", "Preview CAS did not reach exact state")
                _require(
                    verified["validation_report_state"]
                    == before["validation_report_state"],
                    "Preview CAS changed historical validation evidence",
                )
                for key, value in before["pack"].items():
                    if key != "draft_validation_metadata":
                        _require(verified["pack"][key] == value, f"Preview CAS changed {key}")
                recorded_at_unix = int(time.time())
                request_sha256 = _canonical_sha256(database_request)
                receipt = _receipt(
                    verified, platform_files, evidence_file_sha,
                    database_identity, compatibility, database_request,
                    request_sha256, recorded_at_unix,
                )
                receipt_json = json.dumps(
                    receipt, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
                )
                receipt_sha256 = _canonical_sha256(receipt)
                db.execute(
                    f"""INSERT INTO {RECEIPT_TABLE}
                       (receipt_id,pack_id,draft_revision,manifest_sha256,
                        assets_sha256,validation_input_sha256,
                        before_validation_metadata_sha256,
                        after_validation_metadata_sha256,evidence_sha256,
                        evidence_file_sha256,compatibility_freeze_sha256,
                        source_commit,source_tree,android_build_identity_sha256,
                        android_preview_evidence_sha256,ios_build_identity_sha256,
                        ios_preview_evidence_sha256,
                        historical_validation_report_count,
                        full_bundle_validation_report_count,
                        validation_report_inventory_sha256,admin_user_id,
                        idempotency_key_sha256,request_sha256,receipt_json,
                        receipt_sha256,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        RECEIPT_ID, PRODUCT_ID, EXPECTED_DRAFT_REVISION,
                        verified["manifest_sha256"], verified["assets_sha256"],
                        verified["validation_input_sha256"],
                        before["before_validation_sha256"],
                        verified["after_validation_sha256"],
                        verified["evidence_sha256"], evidence_file_sha,
                        compatibility["sha256"],
                        compatibility["source_revision"]["commit"],
                        compatibility["source_revision"]["tree"],
                        platform_files["android"]["build_identity_file_sha256"],
                        platform_files["android"]["preview_evidence_file_sha256"],
                        platform_files["ios"]["build_identity_file_sha256"],
                        platform_files["ios"]["preview_evidence_file_sha256"],
                        1, 0,
                        verified["validation_report_state"]["inventory_sha256"],
                        verified["evidence"]["accepted_by_admin_user_id"],
                        idempotency_key_sha256, request_sha256, receipt_json,
                        receipt_sha256, recorded_at_unix,
                    ),
                )
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
        payload = json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
        receipt_created = _install_receipt(receipt_path, payload)
    return {
        "status": "dual_platform_private_preview_recorded",
        "product_id": PRODUCT_ID,
        "draft_revision": EXPECTED_DRAFT_REVISION,
        "manifest_sha256": verified["manifest_sha256"],
        "assets_sha256": verified["assets_sha256"],
        "evidence_sha256": verified["evidence_sha256"],
        "validation_metadata_sha256": verified["after_validation_sha256"],
        "receipt_sha256": hashlib.sha256(payload).hexdigest(),
        "receipt_created": receipt_created,
        "replayed": replayed,
        "manifest_mutated": False,
        "draft_revision_mutated": False,
        "network_accessed": False,
        "provider_accessed": False,
        "trusted_validation_performed": False,
        "publication_performed": False,
    }


def dry_run() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "status": "dry_run_dual_platform_private_preview_evidence_required",
        "sentinel": APPLY_SENTINEL,
        "product_id": PRODUCT_ID,
        "expected_draft_revision": EXPECTED_DRAFT_REVISION,
        "expected_counts": copy.deepcopy(EXPECTED_COUNTS),
        "required_private_inputs": [
            "canonical dual-platform envelope",
            "Android signed-build identity record",
            "Android complete private-preview evidence",
            "iOS signed-build identity record",
            "iOS complete private-preview evidence",
            "private create-only receipt path",
        ],
        "writes_performed": False,
        "database_accessed": False,
        "evidence_files_accessed": False,
        "network_accessed": False,
        "provider_accessed": False,
        "mobile_build_performed": False,
        "deployment_performed": False,
        "trusted_validation_performed": False,
        "publication_performed": False,
        "gates": {
            "dual_platform_private_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", choices=[APPLY_SENTINEL])
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--android-build-identity", type=Path)
    parser.add_argument("--android-preview-evidence", type=Path)
    parser.add_argument("--ios-build-identity", type=Path)
    parser.add_argument("--ios-preview-evidence", type=Path)
    parser.add_argument("--idempotency-key")
    args = parser.parse_args(argv)
    live_shaped = any(
        value is not None
        for value in (
            args.evidence, args.receipt, args.android_build_identity,
            args.android_preview_evidence, args.ios_build_identity,
            args.ios_preview_evidence, args.idempotency_key,
        )
    )
    if args.apply is None:
        _require(
            not live_shaped,
            f"Live-shaped arguments require exact --apply {APPLY_SENTINEL}",
        )
        print(json.dumps(dry_run(), indent=2, sort_keys=True))
        return 0
    required = {
        "evidence": args.evidence,
        "receipt": args.receipt,
        "android_build_identity": args.android_build_identity,
        "android_preview_evidence": args.android_preview_evidence,
        "ios_build_identity": args.ios_build_identity,
        "ios_preview_evidence": args.ios_preview_evidence,
    }
    _require(all(isinstance(value, Path) for value in required.values()), "All private evidence paths are required")
    _require(isinstance(args.idempotency_key, str), "Exact idempotency key is required")
    result = apply_private(
        required["evidence"], required["receipt"],
        {key: required[key] for key in required if key not in {"evidence", "receipt"}},
        args.idempotency_key,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
