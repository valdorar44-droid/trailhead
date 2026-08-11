#!/usr/bin/env python3
"""Journaled CAS migration from the accepted RF draft to the full private pack.

The default command is a repository-only dry run. Live mutation requires the exact
sentinel plus explicit target, source, backup, source-code, manifest, profile,
validation, terms, and independent-audit identities. This operator has no network,
provider, attestation, validation-run, deployment, or publication code path.
"""

from __future__ import annotations

import argparse
import copy
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import sys
import time
import uuid
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import store  # noqa: E402
from scripts import backup_sqlite  # noqa: E402
from scripts import build_smokies_complete_private_migration as packet_builder  # noqa: E402
from scripts import import_smokies_roaring_fork_private as rf_import  # noqa: E402


APPLY_SENTINEL = "MIGRATE_PRIVATE_SMOKIES_FULL_BUNDLE"
DB_PATH_ENV = "TRAILHEAD_DB_PATH"
ASSET_ROOT_ENV = "TRAILHEAD_ORIGINALS_ASSET_DIR"
TARGET_ID_ENV = "TRAILHEAD_PRIVATE_IMPORT_TARGET_ID"
LOCK_FILE_NAME = ".smokies-complete-private-migration.lock"
JOURNAL_FILE_NAME = ".smokies-complete-private-migration-journal-v1.json"
STAGING_DIR_NAME = ".smokies-complete-private-staging-v1"
OPERATOR_PATH = Path("scripts/migrate_smokies_complete_private.py")
TEST_PATH = Path("tests/test_smokies_complete_private_migration.py")
PACKET_BUILDER_PATH = Path("scripts/build_smokies_complete_private_migration.py")
MAX_BACKUP_AGE_SECONDS = 900


class FullBundleMigrationError(ValueError):
    """The bounded private migration cannot proceed safely."""


class ReportCommitUncertainError(FullBundleMigrationError):
    """The report was replaced but its parent directory sync was not confirmed."""


@dataclass(frozen=True)
class PreparedAsset:
    spec: dict[str, Any]
    source_path: Path
    media_metadata: dict[str, Any]


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _path_identity(path: Path) -> str:
    return hashlib.sha256(str(path).encode("utf-8")).hexdigest()


def _inode_identity(path: Path) -> tuple[int, int]:
    info = path.stat()
    return int(info.st_dev), int(info.st_ino)


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FullBundleMigrationError(f"cannot read {label}") from exc
    if not isinstance(value, dict):
        raise FullBundleMigrationError(f"{label} must contain an object")
    return value


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _lstat_or_none(path: Path) -> os.stat_result | None:
    try:
        return path.lstat()
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise FullBundleMigrationError("filesystem identity is unavailable") from exc


def _write_json_atomic(
    path: Path,
    value: dict[str, Any],
    *,
    create_only: bool,
    expected_prior: dict[str, Any] | None = None,
) -> None:
    if not path.is_absolute():
        raise FullBundleMigrationError("operator output paths must be absolute")
    if create_only and expected_prior is not None:
        raise FullBundleMigrationError("create-only output cannot have a prior value")
    if not create_only and expected_prior is None:
        raise FullBundleMigrationError(
            "mutable operator output requires an exact prior value"
        )
    payload = (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    prior_payload = (
        None
        if expected_prior is None
        else (
            json.dumps(
                expected_prior, ensure_ascii=False, indent=2, sort_keys=True
            )
            + "\n"
        ).encode("utf-8")
    )
    parent_flags = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
    try:
        parent_descriptor = os.open(path.parent, parent_flags)
    except OSError as exc:
        raise FullBundleMigrationError("operator output parent is unsafe") from exc
    temporary_name = f".{path.name}.{uuid.uuid4().hex}.tmp"
    temporary_created = False
    try:
        parent_info = os.fstat(parent_descriptor)
        lexical_parent_info = path.parent.lstat()
        if (
            not stat.S_ISDIR(parent_info.st_mode)
            or stat.S_ISLNK(lexical_parent_info.st_mode)
            or not stat.S_ISDIR(lexical_parent_info.st_mode)
            or (parent_info.st_dev, parent_info.st_ino)
            != (lexical_parent_info.st_dev, lexical_parent_info.st_ino)
        ):
            raise FullBundleMigrationError("operator output parent identity changed")

        try:
            existing_info = os.stat(
                path.name, dir_fd=parent_descriptor, follow_symlinks=False
            )
        except FileNotFoundError:
            existing_info = None
        if existing_info is not None:
            if not stat.S_ISREG(existing_info.st_mode) or existing_info.st_nlink != 1:
                raise FullBundleMigrationError("existing operator output is unsafe")
            read_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            existing_descriptor = os.open(
                path.name, read_flags, dir_fd=parent_descriptor
            )
            try:
                opened_info = os.fstat(existing_descriptor)
                if (opened_info.st_dev, opened_info.st_ino) != (
                    existing_info.st_dev,
                    existing_info.st_ino,
                ):
                    raise FullBundleMigrationError("existing operator output raced")
                with os.fdopen(existing_descriptor, "rb", closefd=False) as handle:
                    existing = handle.read()
            finally:
                os.close(existing_descriptor)
            if existing == payload:
                return
            if create_only:
                raise FullBundleMigrationError(
                    "refusing to replace different immutable output"
                )
            if existing != prior_payload:
                raise FullBundleMigrationError(
                    "mutable operator output differs from its exact prior value"
                )
        elif not create_only:
            raise FullBundleMigrationError("mutable operator output disappeared")

        descriptor = os.open(
            temporary_name,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0),
            0o600,
            dir_fd=parent_descriptor,
        )
        temporary_created = True
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb", closefd=False) as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            temporary_info = os.fstat(descriptor)
        finally:
            os.close(descriptor)

        if create_only:
            try:
                os.link(
                    temporary_name,
                    path.name,
                    src_dir_fd=parent_descriptor,
                    dst_dir_fd=parent_descriptor,
                    follow_symlinks=False,
                )
            except FileExistsError as exc:
                raise FullBundleMigrationError(
                    "immutable output raced after create-only preflight"
                ) from exc
        else:
            current_info = os.stat(
                path.name, dir_fd=parent_descriptor, follow_symlinks=False
            )
            if (current_info.st_dev, current_info.st_ino) != (
                existing_info.st_dev,
                existing_info.st_ino,
            ):
                raise FullBundleMigrationError(
                    "mutable operator output raced before replacement"
                )
            current_descriptor = os.open(
                path.name,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=parent_descriptor,
            )
            try:
                opened_current_info = os.fstat(current_descriptor)
                if (opened_current_info.st_dev, opened_current_info.st_ino) != (
                    current_info.st_dev,
                    current_info.st_ino,
                ):
                    raise FullBundleMigrationError(
                        "mutable operator output raced during replacement"
                    )
                with os.fdopen(
                    current_descriptor, "rb", closefd=False
                ) as current_handle:
                    current_payload = current_handle.read()
            finally:
                os.close(current_descriptor)
            if current_payload != prior_payload:
                raise FullBundleMigrationError(
                    "mutable operator output content raced before replacement"
                )
            os.replace(
                temporary_name,
                path.name,
                src_dir_fd=parent_descriptor,
                dst_dir_fd=parent_descriptor,
            )
            temporary_created = False
        installed_info = os.stat(
            path.name, dir_fd=parent_descriptor, follow_symlinks=False
        )
        if (
            not stat.S_ISREG(installed_info.st_mode)
            or (installed_info.st_dev, installed_info.st_ino)
            != (temporary_info.st_dev, temporary_info.st_ino)
        ):
            raise ReportCommitUncertainError(
                "output installation completed but identity was not confirmed"
            )
        if create_only:
            os.unlink(temporary_name, dir_fd=parent_descriptor)
            temporary_created = False
        try:
            os.fsync(parent_descriptor)
        except Exception as exc:
            raise ReportCommitUncertainError(
                "output replacement completed but directory sync was not confirmed"
            ) from exc
        try:
            final_parent_info = path.parent.lstat()
        except OSError as exc:
            raise ReportCommitUncertainError(
                "output replacement completed but lexical parent disappeared"
            ) from exc
        if (
            stat.S_ISLNK(final_parent_info.st_mode)
            or not stat.S_ISDIR(final_parent_info.st_mode)
            or (final_parent_info.st_dev, final_parent_info.st_ino)
            != (parent_info.st_dev, parent_info.st_ino)
        ):
            raise ReportCommitUncertainError(
                "output replacement completed but lexical parent retargeted"
            )
    finally:
        if temporary_created:
            try:
                os.unlink(temporary_name, dir_fd=parent_descriptor)
            except FileNotFoundError:
                pass
        os.close(parent_descriptor)


def _retire_json_document(
    path: Path, value: dict[str, Any], *, label: str
) -> None:
    """Remove one exact operator document without following a raced name."""
    if not path.is_absolute():
        raise FullBundleMigrationError(f"{label} path must be absolute")
    expected = (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    parent_flags = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
    try:
        parent_descriptor = os.open(path.parent, parent_flags)
    except OSError as exc:
        raise FullBundleMigrationError(f"{label} parent is unsafe") from exc
    try:
        parent_info = os.fstat(parent_descriptor)
        lexical_parent_info = path.parent.lstat()
        if (
            not stat.S_ISDIR(parent_info.st_mode)
            or stat.S_ISLNK(lexical_parent_info.st_mode)
            or not stat.S_ISDIR(lexical_parent_info.st_mode)
            or (parent_info.st_dev, parent_info.st_ino)
            != (lexical_parent_info.st_dev, lexical_parent_info.st_ino)
        ):
            raise FullBundleMigrationError(f"{label} parent identity changed")
        try:
            first_info = os.stat(
                path.name, dir_fd=parent_descriptor, follow_symlinks=False
            )
        except FileNotFoundError as exc:
            raise FullBundleMigrationError(f"{label} disappeared before retirement") from exc
        if (
            stat.S_ISLNK(first_info.st_mode)
            or not stat.S_ISREG(first_info.st_mode)
            or first_info.st_nlink != 1
        ):
            raise FullBundleMigrationError(f"{label} is unsafe at retirement")
        descriptor = os.open(
            path.name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=parent_descriptor,
        )
        try:
            opened_info = os.fstat(descriptor)
            if (opened_info.st_dev, opened_info.st_ino) != (
                first_info.st_dev,
                first_info.st_ino,
            ):
                raise FullBundleMigrationError(f"{label} raced before retirement")
            with os.fdopen(descriptor, "rb", closefd=False) as handle:
                actual = handle.read()
        finally:
            os.close(descriptor)
        if actual != expected:
            raise FullBundleMigrationError(f"{label} content drifted before retirement")
        current_info = os.stat(
            path.name, dir_fd=parent_descriptor, follow_symlinks=False
        )
        if (current_info.st_dev, current_info.st_ino) != (
            opened_info.st_dev,
            opened_info.st_ino,
        ):
            raise FullBundleMigrationError(f"{label} raced during retirement")
        os.unlink(path.name, dir_fd=parent_descriptor)
        os.fsync(parent_descriptor)
        try:
            final_parent_info = path.parent.lstat()
        except OSError as exc:
            raise ReportCommitUncertainError(
                f"{label} retirement completed but lexical parent disappeared"
            ) from exc
        if (
            stat.S_ISLNK(final_parent_info.st_mode)
            or not stat.S_ISDIR(final_parent_info.st_mode)
            or (final_parent_info.st_dev, final_parent_info.st_ino)
            != (parent_info.st_dev, parent_info.st_ino)
        ):
            raise ReportCommitUncertainError(
                f"{label} retirement completed but lexical parent retargeted"
            )
    finally:
        os.close(parent_descriptor)


def _assert_file(path: Path, label: str) -> Path:
    if not path.is_absolute():
        raise FullBundleMigrationError(f"{label} must be an explicit absolute path")
    try:
        info = path.lstat()
    except OSError as exc:
        raise FullBundleMigrationError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise FullBundleMigrationError(f"{label} must be a regular non-symlink file")
    resolved = path.resolve(strict=True)
    if resolved == Path(resolved.anchor):
        raise FullBundleMigrationError(f"{label} cannot be a filesystem root")
    return resolved


def _assert_directory(path: Path, label: str, *, create: bool = False) -> Path:
    if not path.is_absolute():
        raise FullBundleMigrationError(f"{label} must be an explicit absolute path")
    if path.exists() and path.is_symlink():
        raise FullBundleMigrationError(f"{label} cannot be a symlink")
    if create:
        path.mkdir(parents=True, exist_ok=True)
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise FullBundleMigrationError(f"{label} is unavailable") from exc
    if resolved == Path(resolved.anchor) or resolved.is_symlink() or not resolved.is_dir():
        raise FullBundleMigrationError(f"{label} must be a real non-root directory")
    return resolved


def _assert_disjoint_paths(paths: dict[str, Path]) -> None:
    rows = list(paths.items())
    for index, (left_label, left) in enumerate(rows):
        for right_label, right in rows[index + 1 :]:
            if left == right or left in right.parents or right in left.parents:
                raise FullBundleMigrationError(
                    f"{left_label} and {right_label} must not overlap"
                )


def _assert_wal_sidecars_safe(db_path: Path) -> None:
    db_info = db_path.lstat()
    if (
        stat.S_ISLNK(db_info.st_mode)
        or not stat.S_ISREG(db_info.st_mode)
        or db_info.st_nlink != 1
    ):
        raise FullBundleMigrationError("SQLite database identity is unsafe")
    identities = {(int(db_info.st_dev), int(db_info.st_ino))}
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(db_path) + suffix)
        info = _lstat_or_none(sidecar)
        if info is None:
            continue
        identity = (int(info.st_dev), int(info.st_ino))
        if (
            stat.S_ISLNK(info.st_mode)
            or not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or info.st_dev != db_info.st_dev
            or identity in identities
        ):
            raise FullBundleMigrationError(f"SQLite {suffix[1:]} sidecar is unsafe")
        if sidecar.parent != db_path.parent or sidecar.resolve(strict=True).parent != db_path.parent:
            raise FullBundleMigrationError(f"SQLite {suffix[1:]} sidecar escaped")
        identities.add(identity)


def _assert_backup_sidecars_absent(backup_path: Path) -> None:
    for suffix in ("-wal", "-shm", "-journal"):
        if _lstat_or_none(Path(str(backup_path) + suffix)) is not None:
            raise FullBundleMigrationError(
                "SQLite backup sidecars must be absent from the hash-bound snapshot"
            )


def _assert_regular_single_link(path: Path, label: str) -> os.stat_result:
    info = path.lstat()
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
    ):
        raise FullBundleMigrationError(f"{label} must be one regular non-symlink file")
    return info


def _assert_distinct_file_identities(paths: dict[str, Path]) -> None:
    seen: dict[tuple[int, int], str] = {}
    for label, path in paths.items():
        info = _assert_regular_single_link(path, label)
        identity = (int(info.st_dev), int(info.st_ino))
        prior = seen.get(identity)
        if prior is not None:
            raise FullBundleMigrationError(f"{label} aliases {prior}")
        seen[identity] = label


def _assert_backup_fresh(
    manifest: dict[str, Any], *, now: int | None = None
) -> None:
    created_at = manifest.get("created_at")
    if isinstance(created_at, bool) or not isinstance(created_at, int):
        raise FullBundleMigrationError("backup created_at is invalid")
    observed_now = int(time.time()) if now is None else int(now)
    age = observed_now - created_at
    if age < -60 or age > MAX_BACKUP_AGE_SECONDS:
        raise FullBundleMigrationError("backup is stale or from the future")


def _load_exact_packet() -> tuple[dict[str, Any], dict[str, Any], str]:
    outputs = packet_builder.build_all()
    packet_payload = outputs[packet_builder.PACKET_PATH]
    contract_payload = outputs[packet_builder.AUDIT_CONTRACT_PATH]
    packet_path = ROOT / packet_builder.PACKET_PATH
    contract_path = ROOT / packet_builder.AUDIT_CONTRACT_PATH
    try:
        actual_packet = packet_path.read_bytes()
        actual_contract = contract_path.read_bytes()
    except OSError as exc:
        raise FullBundleMigrationError("migration packet artifacts are missing") from exc
    if actual_packet != packet_payload or actual_contract != contract_payload:
        raise FullBundleMigrationError("migration packet artifacts are stale")
    packet = json.loads(actual_packet)
    contract = json.loads(actual_contract)
    if (
        packet.get("packet_id") != packet_builder.PACKET_ID
        or packet.get("product_id") != packet_builder.PRODUCT_ID
        or packet.get("status") != "network_and_database_free_plan_live_apply_locked"
        or contract.get("contract_id") != packet_builder.AUDIT_CONTRACT_ID
    ):
        raise FullBundleMigrationError("migration packet identity drifted")
    return packet, contract, hashlib.sha256(actual_packet).hexdigest()


def _source_binding(path: Path) -> dict[str, Any]:
    absolute = ROOT / path
    return {
        "path": str(path),
        "byte_count": absolute.stat().st_size,
        "sha256": _sha256_path(absolute),
    }


def _validate_operator_audit(
    audit_path: Path,
    packet: dict[str, Any],
    contract: dict[str, Any],
    packet_sha256: str,
) -> dict[str, Any]:
    audit_path = _assert_file(audit_path, "operator audit artifact")
    audit = _read_json(audit_path, "operator audit artifact")
    if (
        audit.get("schema_version") != 1
        or audit.get("kind") != "original_private_migration_operator_audit"
        or audit.get("status") != "independent_audit_passed"
        or audit.get("contract_id") != contract.get("contract_id")
        or audit.get("product_id") != packet_builder.PRODUCT_ID
    ):
        raise FullBundleMigrationError("operator audit status or identity drifted")
    findings = audit.get("findings")
    if findings != contract["required_artifact"]["required_findings"]:
        raise FullBundleMigrationError("operator audit findings are not zero and independent")
    expected_bindings = {
        "migration_packet": {
            "path": str(packet_builder.PACKET_PATH),
            "byte_count": (ROOT / packet_builder.PACKET_PATH).stat().st_size,
            "sha256": packet_sha256,
        },
        "packet_builder": _source_binding(PACKET_BUILDER_PATH),
        "migration_operator": _source_binding(OPERATOR_PATH),
        "migration_operator_tests": _source_binding(TEST_PATH),
        "db_store": packet["source_bindings"][str(packet_builder.STORE_PATH)],
        "roaring_fork_import_operator": packet["source_bindings"][
            str(packet_builder.RF_IMPORT_OPERATOR_PATH)
        ],
        "sqlite_backup_operator": packet["source_bindings"][
            str(packet_builder.BACKUP_OPERATOR_PATH)
        ],
        "manifest_v3_normalizer": packet["source_bindings"][
            str(packet_builder.MANIFEST_NORMALIZER_PATH)
        ],
        "source_commit_and_tree": packet["source_revision"],
    }
    if audit.get("bindings") != expected_bindings:
        raise FullBundleMigrationError("operator audit source bindings drifted")
    if audit.get("live_apply_reviewed") is not True:
        raise FullBundleMigrationError("operator audit did not authorize exact live code")
    return {
        "artifact_sha256": _sha256_path(audit_path),
        "artifact_byte_count": audit_path.stat().st_size,
        "bindings_sha256": _canonical_sha256(expected_bindings),
        "independent_audit_passed": True,
    }


def _configured_target(
    *,
    db_path: Path,
    asset_root: Path,
    target_id: str,
    packet: dict[str, Any],
) -> dict[str, Any]:
    clean_target = str(target_id or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{3,120}", clean_target):
        raise FullBundleMigrationError("target id is invalid")
    binding = packet["configured_target_binding"]
    configured_db = os.environ.get(DB_PATH_ENV, "").strip()
    configured_assets = os.environ.get(ASSET_ROOT_ENV, "").strip()
    configured_target = os.environ.get(TARGET_ID_ENV, "").strip()
    if not configured_db or not configured_assets or not configured_target:
        raise FullBundleMigrationError(
            "apply requires configured database, asset root, and target id"
        )
    if Path(configured_db).resolve(strict=True) != db_path:
        raise FullBundleMigrationError("database path differs from configured target")
    if Path(configured_assets).resolve(strict=True) != asset_root:
        raise FullBundleMigrationError("asset root differs from configured target")
    if configured_target != clean_target or clean_target != binding["target_id"]:
        raise FullBundleMigrationError("target id differs from configured receipt")
    if (
        _path_identity(db_path) != binding["database_path_sha256"]
        or _path_identity(asset_root) != binding["asset_root_path_sha256"]
    ):
        raise FullBundleMigrationError("configured target path identity drifted")
    return {
        "id": clean_target,
        "classification": "configured_private",
        "configured": True,
        "database_path_sha256": _path_identity(db_path),
        "asset_root_path_sha256": _path_identity(asset_root),
    }


def _assert_expected_identities(
    packet: dict[str, Any],
    *,
    packet_sha256: str,
    expected_packet_sha256: str,
    expected_source_commit: str,
    expected_source_tree: str,
    expected_draft_revision: int,
    expected_current_manifest_sha256: str,
    expected_current_profile_sha256: str,
    expected_validation_metadata_sha256: str,
    expected_full_base_manifest_sha256: str,
    expected_terms_policy_sha256: str,
) -> None:
    predecessor = packet["predecessor"]
    draft = packet["migration_draft"]
    terms = packet["post_migration_phases"]["license_attestation"]
    actual = {
        "packet": packet_sha256,
        "source_commit": packet["source_revision"]["commit"],
        "source_tree": packet["source_revision"]["tree"],
        "draft_revision": predecessor["draft_revision"],
        "current_manifest": predecessor["profiled_manifest_canonical_sha256"],
        "current_profile": predecessor["narration_profile_canonical_sha256"],
        "validation": predecessor["validation_metadata_canonical_sha256"],
        "full_base": draft["original_manifest_canonical_sha256"],
        "terms": terms["terms_policy_sha256"],
    }
    supplied = {
        "packet": expected_packet_sha256,
        "source_commit": expected_source_commit,
        "source_tree": expected_source_tree,
        "draft_revision": expected_draft_revision,
        "current_manifest": expected_current_manifest_sha256,
        "current_profile": expected_current_profile_sha256,
        "validation": expected_validation_metadata_sha256,
        "full_base": expected_full_base_manifest_sha256,
        "terms": expected_terms_policy_sha256,
    }
    if supplied != actual:
        differences = sorted(key for key in actual if supplied[key] != actual[key])
        raise FullBundleMigrationError(
            "explicit expected identities drifted: " + ", ".join(differences)
        )


def _validate_backup(
    manifest_path: Path,
    *,
    expected_manifest_sha256: str,
    db_path: Path,
    asset_root: Path,
    now: int | None = None,
) -> tuple[dict[str, Any], Path]:
    manifest_path = _assert_file(manifest_path, "backup manifest")
    if _sha256_path(manifest_path) != expected_manifest_sha256:
        raise FullBundleMigrationError("backup manifest sha256 drifted")
    manifest = _read_json(manifest_path, "backup manifest")
    if manifest.get("schema_version") != 1 or manifest.get("integrity_check") != "ok":
        raise FullBundleMigrationError("backup manifest is not verified")
    try:
        source = Path(str(manifest["source"])).resolve(strict=True)
        backup = _assert_file(Path(str(manifest["backup"])), "SQLite backup")
    except (KeyError, OSError) as exc:
        raise FullBundleMigrationError("backup manifest paths are invalid") from exc
    if source != db_path:
        raise FullBundleMigrationError("backup source does not match target database")
    _assert_distinct_file_identities(
        {
            "database": db_path,
            "backup manifest": manifest_path,
            "SQLite backup": backup,
        }
    )
    _assert_backup_sidecars_absent(backup)
    if (
        backup.stat().st_size != int(manifest.get("bytes") or 0)
        or _sha256_path(backup) != manifest.get("sha256")
    ):
        raise FullBundleMigrationError("backup bytes failed exact verification")
    created_at = manifest.get("created_at")
    if isinstance(created_at, bool) or not isinstance(created_at, int):
        raise FullBundleMigrationError("backup created_at is invalid")
    device_ids = {
        db_path.stat().st_dev,
        asset_root.stat().st_dev,
        manifest_path.stat().st_dev,
        backup.stat().st_dev,
    }
    if len(device_ids) != 1:
        raise FullBundleMigrationError("backup, database, and assets must share one volume")
    connection = sqlite3.connect(
        backup.as_uri() + "?mode=ro&immutable=1", uri=True
    )
    connection.row_factory = sqlite3.Row
    try:
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
        tables = {
            str(row["name"])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
    finally:
        connection.close()
    _assert_backup_sidecars_absent(backup)
    required = {
        "users",
        "authored_trip_packs",
        "authored_original_assets",
        "authored_trip_pack_versions",
        "authored_original_validation_reports",
        "authored_original_release_authorizations_v1",
    }
    if integrity.lower() != "ok" or not required.issubset(tables):
        raise FullBundleMigrationError("backup integrity or schema verification failed")
    _assert_backup_fresh(manifest, now=now)
    return manifest, backup


def _connect(path: Path, *, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        connection = sqlite3.connect(
            path.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=30
        )
        connection.execute("PRAGMA query_only=ON")
    else:
        connection = sqlite3.connect(str(path), timeout=30)
        journal_mode = str(connection.execute("PRAGMA journal_mode").fetchone()[0])
        if journal_mode.lower() != "wal":
            connection.close()
            raise FullBundleMigrationError(
                "target database must already use WAL journal mode"
            )
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
    connection.row_factory = sqlite3.Row
    return connection


def _db_snapshot(connection: sqlite3.Connection) -> dict[str, Any]:
    pack_id = packet_builder.PRODUCT_ID
    pack = connection.execute(
        "SELECT * FROM authored_trip_packs WHERE id=?", (pack_id,)
    ).fetchone()
    assets = connection.execute(
        "SELECT * FROM authored_original_assets WHERE pack_id=? ORDER BY asset_id,sha256",
        (pack_id,),
    ).fetchall()
    versions = connection.execute(
        "SELECT * FROM authored_trip_pack_versions WHERE pack_id=? ORDER BY version",
        (pack_id,),
    ).fetchall()
    reports = connection.execute(
        "SELECT * FROM authored_original_validation_reports WHERE pack_id=? ORDER BY id",
        (pack_id,),
    ).fetchall()
    authorizations = connection.execute(
        "SELECT * FROM authored_original_release_authorizations_v1 WHERE pack_id=? ORDER BY id",
        (pack_id,),
    ).fetchall()
    return {
        "pack": dict(pack) if pack else None,
        "assets": [dict(row) for row in assets],
        "versions": [dict(row) for row in versions],
        "validation_reports": [dict(row) for row in reports],
        "release_authorizations": [dict(row) for row in authorizations],
    }


def _predecessor_history_material(
    snapshot: dict[str, Any], packet: dict[str, Any]
) -> dict[str, Any]:
    pack = snapshot.get("pack")
    if not isinstance(pack, dict):
        raise FullBundleMigrationError("predecessor history pack is missing")
    rf_ids = set(packet["predecessor"]["existing_asset_sha256"])
    rf_rows = [
        copy.deepcopy(row)
        for row in snapshot.get("assets", [])
        if str(row.get("asset_id") or "") in rf_ids
    ]
    if len(rf_rows) != len(rf_ids) or {row["asset_id"] for row in rf_rows} != rf_ids:
        raise FullBundleMigrationError("predecessor history RF membership drifted")
    return {
        "schema_version": 1,
        "pack_immutable_history": {
            "id": pack.get("id"),
            "created_by": pack.get("created_by"),
            "created_at": pack.get("created_at"),
        },
        "roaring_fork_asset_rows": sorted(
            rf_rows, key=lambda row: (str(row["asset_id"]), str(row["sha256"]))
        ),
        "validation_reports": copy.deepcopy(snapshot.get("validation_reports", [])),
        "published_versions": copy.deepcopy(snapshot.get("versions", [])),
        "release_authorizations": copy.deepcopy(
            snapshot.get("release_authorizations", [])
        ),
    }


def _predecessor_history_sha256(
    snapshot: dict[str, Any], packet: dict[str, Any]
) -> str:
    return _canonical_sha256(_predecessor_history_material(snapshot, packet))


def _history_binding_from_file(
    path: Path,
    *,
    packet_sha256: str,
    kind: str,
) -> str | None:
    if _lstat_or_none(path) is None:
        return None
    exact = _assert_file(path, f"existing {kind}")
    payload = _read_json(exact, f"existing {kind}")
    if payload.get("packet_sha256") != packet_sha256:
        if kind == "migration receipt":
            raise FullBundleMigrationError(
                "an existing receipt cannot authorize this migration"
            )
        raise FullBundleMigrationError(f"existing {kind} packet binding drifted")
    if kind == "migration receipt":
        value = payload.get("migration", {}).get("predecessor_history_sha256")
    else:
        value = payload.get("predecessor_history_sha256")
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        if kind == "migration receipt":
            raise FullBundleMigrationError(
                "an existing receipt cannot authorize this migration"
            )
        raise FullBundleMigrationError(f"existing {kind} history binding is invalid")
    return value


def _decode_object(raw: Any, label: str) -> dict[str, Any]:
    try:
        value = json.loads(str(raw))
    except (TypeError, json.JSONDecodeError) as exc:
        raise FullBundleMigrationError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise FullBundleMigrationError(f"{label} must be an object")
    return value


def _asset_destination(spec: dict[str, Any], asset_root: Path) -> Path:
    asset_id = str(spec.get("asset_id") or "")
    sha256 = str(spec.get("sha256") or "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,119}", asset_id):
        raise FullBundleMigrationError("asset id is not canonical")
    if not re.fullmatch(r"[a-f0-9]{64}", sha256):
        raise FullBundleMigrationError("asset sha256 is invalid")
    suffix = ".mp3" if spec["kind"] == "narration" else ".png"
    destination = (
        asset_root
        / packet_builder.PRODUCT_ID
        / asset_id
        / f"{sha256}{suffix}"
    )
    if asset_root not in destination.parents:
        raise FullBundleMigrationError("asset destination escapes asset root")
    return destination


def _assert_planned_asset_ancestry(asset_root: Path, destination: Path) -> None:
    relative = destination.relative_to(asset_root)
    if len(relative.parts) != 3 or relative.parts[0] != packet_builder.PRODUCT_ID:
        raise FullBundleMigrationError("asset destination layout drifted")
    current = asset_root
    for part in relative.parts[:-1]:
        current = current / part
        try:
            info = current.lstat()
        except FileNotFoundError:
            return
        except OSError as exc:
            raise FullBundleMigrationError("asset destination ancestor is unavailable") from exc
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise FullBundleMigrationError(
                "asset destination ancestors must be real directories"
            )


@contextmanager
def _open_asset_destination_parent(
    asset_root: Path,
    destination: Path,
    *,
    create: bool,
) -> Iterator[int]:
    relative = destination.relative_to(asset_root)
    if len(relative.parts) != 3 or relative.parts[0] != packet_builder.PRODUCT_ID:
        raise FullBundleMigrationError("asset destination layout drifted")
    flags = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
    descriptors: list[int] = []
    try:
        root_descriptor = os.open(asset_root, flags)
        descriptors.append(root_descriptor)
        root_info = os.fstat(root_descriptor)
        lexical_root_info = asset_root.lstat()
        if (
            not stat.S_ISDIR(root_info.st_mode)
            or stat.S_ISLNK(lexical_root_info.st_mode)
            or (root_info.st_dev, root_info.st_ino)
            != (lexical_root_info.st_dev, lexical_root_info.st_ino)
        ):
            raise FullBundleMigrationError("asset root identity changed")
        parent_descriptor = root_descriptor
        lexical_parent = asset_root
        for part in relative.parts[:-1]:
            lexical_child = lexical_parent / part
            if create:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=parent_descriptor)
                    os.fsync(parent_descriptor)
                except FileExistsError:
                    pass
            try:
                child_descriptor = os.open(part, flags, dir_fd=parent_descriptor)
            except OSError as exc:
                raise FullBundleMigrationError(
                    "asset destination ancestor is missing or unsafe"
                ) from exc
            descriptors.append(child_descriptor)
            child_info = os.fstat(child_descriptor)
            try:
                lexical_info = lexical_child.lstat()
            except OSError as exc:
                raise FullBundleMigrationError(
                    "asset destination ancestor changed during traversal"
                ) from exc
            if (
                not stat.S_ISDIR(child_info.st_mode)
                or child_info.st_dev != root_info.st_dev
                or stat.S_ISLNK(lexical_info.st_mode)
                or not stat.S_ISDIR(lexical_info.st_mode)
                or (child_info.st_dev, child_info.st_ino)
                != (lexical_info.st_dev, lexical_info.st_ino)
            ):
                raise FullBundleMigrationError(
                    "asset destination ancestor identity changed"
                )
            parent_descriptor = child_descriptor
            lexical_parent = lexical_child
        yield parent_descriptor
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def _journal_destination_for_spec(
    entry: dict[str, Any], spec: dict[str, Any], asset_root: Path
) -> Path:
    destination = _asset_destination(spec, asset_root)
    expected_relative = destination.relative_to(asset_root).as_posix()
    expected = {
        "asset_id": spec["asset_id"],
        "relative_path": expected_relative,
        "sha256": spec["sha256"],
        "bytes": int(spec["bytes"]),
    }
    if any(entry.get(key) != value for key, value in expected.items()):
        raise FullBundleMigrationError("journal destination differs from asset contract")
    if _destination_from_journal(entry, asset_root) != destination:
        raise FullBundleMigrationError("journal destination is not lexical and canonical")
    return destination


def _verified_asset_destination(
    spec: dict[str, Any],
    asset_root: Path,
    *,
    entry: dict[str, Any] | None = None,
) -> Path:
    destination = (
        _journal_destination_for_spec(entry, spec, asset_root)
        if entry is not None
        else _asset_destination(spec, asset_root)
    )
    with _open_asset_destination_parent(asset_root, destination, create=False) as parent_fd:
        try:
            descriptor_info = os.stat(
                destination.name, dir_fd=parent_fd, follow_symlinks=False
            )
            lexical_info = destination.lstat()
        except OSError as exc:
            raise FullBundleMigrationError("asset destination is unavailable") from exc
        if (
            not stat.S_ISREG(descriptor_info.st_mode)
            or descriptor_info.st_dev != asset_root.lstat().st_dev
            or stat.S_ISLNK(lexical_info.st_mode)
            or not stat.S_ISREG(lexical_info.st_mode)
            or (descriptor_info.st_dev, descriptor_info.st_ino)
            != (lexical_info.st_dev, lexical_info.st_ino)
        ):
            raise FullBundleMigrationError("asset destination identity changed")
    verified = _assert_file(destination, f"asset destination {spec['asset_id']}")
    if verified != destination:
        raise FullBundleMigrationError("asset destination resolved through a symlink")
    return destination


def _assert_existing_rf_assets(
    connection: sqlite3.Connection,
    packet: dict[str, Any],
    asset_root: Path,
    *,
    expected_snapshot: dict[str, Any] | None = None,
    allow_additional: bool = False,
) -> dict[str, dict[str, Any]]:
    rows = connection.execute(
        "SELECT * FROM authored_original_assets WHERE pack_id=? AND is_current=1 ORDER BY asset_id",
        (packet_builder.PRODUCT_ID,),
    ).fetchall()
    all_current = {str(row["asset_id"]): dict(row) for row in rows}
    specs = {
        str(row["asset_id"]): row
        for row in packet["assets"]["existing_roaring_fork"]
    }
    if (not allow_additional and set(all_current) != set(specs)) or not set(
        specs
    ).issubset(all_current):
        raise FullBundleMigrationError("predecessor RF asset membership drifted")
    current = {asset_id: all_current[asset_id] for asset_id in specs}
    expected_attestations = packet["predecessor"][
        "existing_narration_redacted_attestation_sha256"
    ]
    expected_terms = packet["post_migration_phases"]["license_attestation"][
        "terms_tuple"
    ]
    for asset_id, spec in specs.items():
        row = current[asset_id]
        expected_destination = _verified_asset_destination(spec, asset_root)
        stored = _assert_file(Path(str(row["storage_path"])), f"RF asset {asset_id}")
        if stored != expected_destination:
            raise FullBundleMigrationError(f"RF storage path drifted: {asset_id}")
        expected = {
            "sha256": spec["sha256"],
            "kind": spec["kind"],
            "mime_type": spec["mime_type"],
            "byte_count": int(spec["bytes"]),
            "public_path": spec["public_path"],
            "transcript_sha256": spec.get("transcript_sha256"),
            "is_current": 1,
        }
        if any(row[key] != value for key, value in expected.items()):
            raise FullBundleMigrationError(f"RF immutable metadata drifted: {asset_id}")
        if stored.stat().st_size != int(spec["bytes"]) or _sha256_path(stored) != spec["sha256"]:
            raise FullBundleMigrationError(f"RF asset bytes drifted: {asset_id}")
        if spec["kind"] == "narration":
            generator = _decode_object(row["generator_metadata_json"], "RF generator metadata")
            if not store._original_generator_license_attestation_complete(generator):
                raise FullBundleMigrationError(f"RF attestation is incomplete: {asset_id}")
            attestation = generator["license_attestation"]
            if any(attestation.get(key) != value for key, value in expected_terms.items()):
                raise FullBundleMigrationError(f"RF attestation terms drifted: {asset_id}")
            if (
                store.original_redacted_license_attestation_sha256(attestation)
                != expected_attestations[asset_id]
            ):
                raise FullBundleMigrationError(f"RF attestation hash drifted: {asset_id}")
    if expected_snapshot is not None:
        prior = {
            str(row["asset_id"]): row
            for row in expected_snapshot["assets"]
            if str(row["asset_id"]) in specs
        }
        if current != prior:
            raise FullBundleMigrationError("RF database rows changed from backup")
    return current


def _canonical_utc_epoch(raw: Any, label: str) -> int:
    if not isinstance(raw, str) or not raw.endswith("Z"):
        raise FullBundleMigrationError(f"{label} must be canonical UTC")
    try:
        parsed = datetime.fromisoformat(raw[:-1] + "+00:00")
    except ValueError as exc:
        raise FullBundleMigrationError(f"{label} is invalid") from exc
    if parsed.tzinfo is None or parsed.astimezone(timezone.utc).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z") != raw:
        raise FullBundleMigrationError(f"{label} must be canonical UTC")
    return int(parsed.timestamp())


def _assert_independent_rf_history(
    snapshot: dict[str, Any],
    packet: dict[str, Any],
    rf_rows: dict[str, dict[str, Any]],
) -> None:
    pack = snapshot.get("pack")
    if not isinstance(pack, dict):
        raise FullBundleMigrationError("historical pack is missing")
    predecessor = packet["predecessor"]
    import_window = predecessor.get("historical_import_window")
    if not isinstance(import_window, dict):
        raise FullBundleMigrationError("historical import evidence is missing")
    started = _canonical_utc_epoch(import_window.get("started_at"), "import start")
    completed = _canonical_utc_epoch(
        import_window.get("completed_at"), "import completion"
    )
    created_at = pack.get("created_at")
    if (
        isinstance(created_at, bool)
        or not isinstance(created_at, int)
        or not started <= created_at <= completed
    ):
        raise FullBundleMigrationError("immutable pack creation time drifted")
    created_by = pack.get("created_by")
    if isinstance(created_by, bool) or not isinstance(created_by, int) or created_by < 1:
        raise FullBundleMigrationError("immutable pack creator drifted")
    for asset_id, row in rf_rows.items():
        if row.get("uploaded_by") != created_by or row.get("created_at") != created_at:
            raise FullBundleMigrationError(f"RF immutable import history drifted: {asset_id}")
        if row.get("kind") == "image":
            if row.get("updated_at") != created_at:
                raise FullBundleMigrationError(
                    f"RF immutable image timestamps drifted: {asset_id}"
                )
            continue
        generator = _decode_object(
            row.get("generator_metadata_json"), "RF generator metadata"
        )
        attestation = generator.get("license_attestation")
        if not isinstance(attestation, dict):
            raise FullBundleMigrationError(f"RF attestation history is missing: {asset_id}")
        attested_epoch = _canonical_utc_epoch(
            attestation.get("attested_at"), f"RF attestation time {asset_id}"
        )
        if (
            attestation.get("attested_by_admin_user_id") != created_by
            or row.get("updated_at") != attested_epoch
        ):
            raise FullBundleMigrationError(
                f"RF immutable attestation timestamps drifted: {asset_id}"
            )

    permitted = predecessor.get("permitted_validation_history")
    if not isinstance(permitted, dict):
        raise FullBundleMigrationError("historical validation evidence is missing")
    reports = snapshot.get("validation_reports")
    if (
        not isinstance(reports, list)
        or len(reports) != int(permitted.get("expected_report_count") or -1)
        or len(reports) != 1
    ):
        raise FullBundleMigrationError("historical validation report membership drifted")
    report = reports[0]
    expected_report = {
        "id": permitted["report_id"],
        "pack_id": packet_builder.PRODUCT_ID,
        "draft_revision": int(permitted["expected_draft_revision"]),
        "suite_version": permitted["expected_suite_version"],
        "engine_version": permitted["engine"],
        "status": permitted["status"],
        "passed": 1,
        "worker_pid": None,
    }
    if any(report.get(key) != value for key, value in expected_report.items()):
        raise FullBundleMigrationError("historical validation report facts drifted")
    try:
        report_manifest = _decode_object(
            report.get("manifest_json"), "historical validation manifest"
        )
        issues = json.loads(str(report.get("issues_json")))
        scenarios = json.loads(str(report.get("scenarios_json")))
    except (TypeError, json.JSONDecodeError) as exc:
        raise FullBundleMigrationError("historical validation report JSON drifted") from exc
    if (
        report.get("manifest_sha256")
        != predecessor["profiled_manifest_canonical_sha256"]
        or _canonical_sha256(report_manifest)
        != predecessor["profiled_manifest_canonical_sha256"]
        or issues != permitted["issues"]
        or not isinstance(scenarios, list)
        or len(scenarios) != int(permitted["route_scenarios_required"])
    ):
        raise FullBundleMigrationError("historical validation report payload drifted")
    report_started = report.get("started_at")
    report_completed = report.get("completed_at")
    readback = _canonical_utc_epoch(
        permitted.get("readback_observed_at"), "validation readback"
    )
    if (
        isinstance(report_started, bool)
        or not isinstance(report_started, int)
        or isinstance(report_completed, bool)
        or not isinstance(report_completed, int)
        or report_started < created_at
        or report_completed < report_started
        or report_completed > readback
        or report.get("started_by") != created_by
    ):
        raise FullBundleMigrationError("historical validation report timestamps drifted")


def _assert_report_and_publication_state(snapshot: dict[str, Any]) -> None:
    if snapshot["versions"]:
        raise FullBundleMigrationError("published versions already exist")
    if snapshot["release_authorizations"]:
        raise FullBundleMigrationError("release authorization state is not empty")
    unsafe = [
        row["id"]
        for row in snapshot["validation_reports"]
        if str(row.get("status") or "") in {"pending", "executing"}
    ]
    if unsafe:
        raise FullBundleMigrationError("validation report is active or executing")


def _assert_predecessor_state(
    connection: sqlite3.Connection,
    packet: dict[str, Any],
    asset_root: Path,
    *,
    backup_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    snapshot = _db_snapshot(connection)
    pack = snapshot["pack"]
    if not isinstance(pack, dict):
        raise FullBundleMigrationError("predecessor pack is missing")
    predecessor = packet["predecessor"]
    if (
        pack["content_kind"] != "original_drive"
        or pack["status"] != "draft"
        or int(pack["draft_revision"]) != int(predecessor["draft_revision"])
        or pack["current_published_version"] is not None
    ):
        raise FullBundleMigrationError("predecessor draft identity drifted")
    immutable_fields = predecessor.get("immutable_draft_fields")
    if not isinstance(immutable_fields, dict) or set(immutable_fields) != {
        "slug",
        "draft_title",
        "draft_summary",
        "draft_price_credits",
        "draft_coverage_region",
        "draft_public_metadata",
        "draft_template_json",
    } or any(pack[key] != value for key, value in immutable_fields.items()):
        raise FullBundleMigrationError("predecessor draft fields drifted")
    manifest = _decode_object(pack["draft_original_manifest_json"], "predecessor manifest")
    validation = _decode_object(pack["draft_validation_metadata"], "predecessor validation")
    profile = manifest.get("narration_profile")
    if (
        not isinstance(profile, dict)
        or _canonical_sha256(manifest)
        != predecessor["profiled_manifest_canonical_sha256"]
        or _canonical_sha256(profile)
        != predecessor["narration_profile_canonical_sha256"]
        or _canonical_sha256(validation)
        != predecessor["validation_metadata_canonical_sha256"]
    ):
        raise FullBundleMigrationError("predecessor manifest/profile/validation drifted")
    if (
        validation.get("authenticated_device_preview_complete") is not True
        or validation.get("public_release") is not False
    ):
        raise FullBundleMigrationError("predecessor preview or publication state is unsafe")
    preview = validation.get("authenticated_device_preview_evidence")
    if (
        not isinstance(preview, dict)
        or _canonical_sha256(preview)
        != predecessor["device_preview_evidence_canonical_sha256"]
    ):
        raise FullBundleMigrationError("predecessor preview evidence drifted")
    _assert_report_and_publication_state(snapshot)
    rf_rows = _assert_existing_rf_assets(
        connection,
        packet,
        asset_root,
        expected_snapshot=backup_snapshot,
    )
    _assert_independent_rf_history(snapshot, packet, rf_rows)
    if len(snapshot["assets"]) != 20:
        raise FullBundleMigrationError("predecessor contains unexpected historical assets")
    return snapshot


def _expected_new_media_json(spec: dict[str, Any]) -> str:
    return json.dumps(spec["media"], separators=(",", ":"), sort_keys=True)


def _assert_target_state(
    connection: sqlite3.Connection,
    packet: dict[str, Any],
    asset_root: Path,
    *,
    backup_rf_snapshot: dict[str, Any] | None = None,
    expected_predecessor_history_sha256: str | None = None,
    require_history_binding: bool = True,
) -> dict[str, Any]:
    snapshot = _db_snapshot(connection)
    pack = snapshot["pack"]
    draft = packet["migration_draft"]
    if not isinstance(pack, dict):
        raise FullBundleMigrationError("target pack is missing")
    expected_pack = {
        "content_kind": draft["content_kind"],
        "slug": draft["slug"],
        "status": "draft",
        "draft_title": draft["title"],
        "draft_summary": draft["summary"],
        "draft_price_credits": int(draft["price_credits"]),
        "draft_coverage_region": draft["coverage_region"],
        "draft_public_metadata": draft["public_metadata_json"],
        "draft_validation_metadata": draft["validation_metadata_json"],
        "draft_template_json": draft["template_json"],
        "draft_original_manifest_json": draft["original_manifest_json"],
        "draft_revision": int(draft["expected_after_revision"]),
        "current_published_version": None,
    }
    if any(pack[key] != value for key, value in expected_pack.items()):
        raise FullBundleMigrationError("target draft fields drifted")
    if backup_rf_snapshot is not None:
        prior_pack = backup_rf_snapshot.get("pack")
        if not isinstance(prior_pack, dict) or any(
            pack[key] != prior_pack[key] for key in ("id", "created_by", "created_at")
        ):
            raise FullBundleMigrationError("target rewrote immutable pack history")
    manifest = _decode_object(pack["draft_original_manifest_json"], "target manifest")
    validation = _decode_object(pack["draft_validation_metadata"], "target validation")
    if (
        manifest.get("narration_profile") is not None
        or _canonical_sha256(manifest) != draft["original_manifest_canonical_sha256"]
        or _canonical_sha256(validation) != draft["validation_metadata_canonical_sha256"]
        or any(
            validation.get(key) is not False
            for key in (
                "admin_license_attestation_complete",
                "authenticated_device_preview_complete",
                "dual_platform_private_preview_complete",
                "public_release",
                "trusted_publication_validation_complete",
                "verified_private_upload_complete",
            )
        )
    ):
        raise FullBundleMigrationError("target manifest or reset gates drifted")
    _assert_report_and_publication_state(snapshot)
    rows = {
        str(row["asset_id"]): row
        for row in snapshot["assets"]
        if int(row["is_current"]) == 1
    }
    all_sha = packet["assets"]["all_asset_sha256"]
    if len(snapshot["assets"]) != 98 or set(rows) != set(all_sha):
        raise FullBundleMigrationError("target asset membership drifted")
    rf_ids = set(packet["predecessor"]["existing_asset_sha256"])
    rf_rows = _assert_existing_rf_assets(
        connection, packet, asset_root, allow_additional=True
    )
    _assert_independent_rf_history(snapshot, packet, rf_rows)
    actual_history_sha256 = _predecessor_history_sha256(snapshot, packet)
    if require_history_binding and (
        not isinstance(expected_predecessor_history_sha256, str)
        or not re.fullmatch(r"[a-f0-9]{64}", expected_predecessor_history_sha256)
        or actual_history_sha256 != expected_predecessor_history_sha256
    ):
        raise FullBundleMigrationError(
            "target lacks the exact predecessor-bound history proof"
        )
    if backup_rf_snapshot is not None:
        prior_rf = {
            str(row["asset_id"]): row
            for row in backup_rf_snapshot["assets"]
            if str(row["asset_id"]) in rf_ids
        }
        if rf_rows != prior_rf:
            raise FullBundleMigrationError("RF asset rows were rewritten from backup")
    new_specs = {row["asset_id"]: row for row in packet["assets"]["new"]}
    for asset_id, spec in new_specs.items():
        row = rows.get(asset_id)
        if row is None:
            raise FullBundleMigrationError(f"new asset is missing: {asset_id}")
        destination = _verified_asset_destination(spec, asset_root)
        stored = _assert_file(Path(str(row["storage_path"])), f"new asset {asset_id}")
        expected = {
            "sha256": spec["sha256"],
            "kind": spec["kind"],
            "mime_type": spec["mime_type"],
            "byte_count": int(spec["bytes"]),
            "public_path": spec["public_path"],
            "storage_path": str(destination),
            "media_metadata_json": _expected_new_media_json(spec),
            "transcript_sha256": spec.get("transcript_sha256"),
            "generator_metadata_json": json.dumps(
                spec["generator_metadata"], separators=(",", ":"), sort_keys=True
            ),
            "is_current": 1,
            "uploaded_by": pack["updated_by"],
            "created_at": pack["updated_at"],
            "updated_at": pack["updated_at"],
        }
        if stored != destination or any(row[key] != value for key, value in expected.items()):
            raise FullBundleMigrationError(f"new immutable metadata drifted: {asset_id}")
        if stored.stat().st_size != int(spec["bytes"]) or _sha256_path(stored) != spec["sha256"]:
            raise FullBundleMigrationError(f"new asset bytes drifted: {asset_id}")
    return snapshot


def _classify_state(
    connection: sqlite3.Connection,
    packet: dict[str, Any],
    asset_root: Path,
    *,
    backup_snapshot: dict[str, Any] | None = None,
    expected_predecessor_history_sha256: str | None = None,
) -> tuple[str, dict[str, Any]]:
    pack = connection.execute(
        "SELECT draft_revision,draft_original_manifest_json FROM authored_trip_packs WHERE id=?",
        (packet_builder.PRODUCT_ID,),
    ).fetchone()
    if not pack:
        raise FullBundleMigrationError("bounded predecessor pack is missing")
    revision = int(pack["draft_revision"])
    if revision == int(packet["predecessor"]["draft_revision"]):
        return "predecessor", _assert_predecessor_state(
            connection, packet, asset_root, backup_snapshot=backup_snapshot
        )
    if revision == int(packet["migration_draft"]["expected_after_revision"]):
        if backup_snapshot is None:
            raise FullBundleMigrationError("target replay requires backup RF snapshot")
        return "target", _assert_target_state(
            connection,
            packet,
            asset_root,
            backup_rf_snapshot=backup_snapshot,
            expected_predecessor_history_sha256=expected_predecessor_history_sha256,
        )
    raise FullBundleMigrationError("draft revision is neither predecessor nor exact target")


def _prepare_external_assets(
    packet: dict[str, Any],
    narration_root: Path,
    artwork_root: Path,
) -> list[PreparedAsset]:
    roots = {
        "accepted_remaining_narration_root": narration_root,
        "accepted_remaining_artwork_root": artwork_root,
    }
    prepared: list[PreparedAsset] = []
    for spec in packet["assets"]["new"]:
        root = roots.get(str(spec.get("source_root")))
        if root is None:
            raise FullBundleMigrationError("packet references an unknown external root")
        relative = Path(str(spec.get("source_relative_path") or ""))
        if relative.is_absolute() or not relative.parts or ".." in relative.parts:
            raise FullBundleMigrationError("external asset relative path is unsafe")
        ancestor = root
        for part in relative.parts[:-1]:
            ancestor = ancestor / part
            try:
                ancestor_info = ancestor.lstat()
            except OSError as exc:
                raise FullBundleMigrationError(
                    "external asset ancestor is unavailable"
                ) from exc
            if stat.S_ISLNK(ancestor_info.st_mode) or not stat.S_ISDIR(
                ancestor_info.st_mode
            ):
                raise FullBundleMigrationError(
                    "external asset ancestors must be real directories"
                )
        source = rf_import._assert_regular_contained(
            root / relative, root, f"new asset {spec['asset_id']}"
        )
        if source.stat().st_size != int(spec["bytes"]) or _sha256_path(source) != spec["sha256"]:
            raise FullBundleMigrationError(f"accepted bytes drifted: {spec['asset_id']}")
        if spec["kind"] == "narration":
            media = store._probe_original_asset_file(source, "narration", "audio/mpeg")
            expected = spec["media"]
            for field in ("format", "sample_rate_hz", "bitrate_kbps", "channels"):
                if media.get(field) != expected[field]:
                    raise FullBundleMigrationError(
                        f"accepted narration {field} drifted: {spec['asset_id']}"
                    )
            if abs(float(media["duration_s"]) - float(expected["duration_s"])) > 0.01:
                raise FullBundleMigrationError(
                    f"accepted narration duration drifted: {spec['asset_id']}"
                )
        else:
            media = rf_import._inspect_png(source, spec)
        if media != spec["media"]:
            raise FullBundleMigrationError(f"media characterization drifted: {spec['asset_id']}")
        prepared.append(
            PreparedAsset(copy.deepcopy(spec), source, copy.deepcopy(media))
        )
    if len(prepared) != 78:
        raise FullBundleMigrationError("prepared asset count drifted")
    return prepared


def _journal_document(
    packet: dict[str, Any],
    packet_sha256: str,
    *,
    target: dict[str, Any],
    db_path: Path,
    asset_root: Path,
    narration_root: Path,
    artwork_root: Path,
    backup_manifest_sha256: str,
    audit_sha256: str,
    predecessor_history_sha256: str,
) -> dict[str, Any]:
    if not re.fullmatch(r"[a-f0-9]{64}", predecessor_history_sha256):
        raise FullBundleMigrationError("predecessor history binding is invalid")
    destinations = []
    for spec in packet["assets"]["new"]:
        destination = _asset_destination(spec, asset_root)
        _assert_planned_asset_ancestry(asset_root, destination)
        destination_info = _lstat_or_none(destination)
        existed_before = destination_info is not None
        preexisting_st_dev: int | None = None
        preexisting_st_ino: int | None = None
        if existed_before:
            existing = _verified_asset_destination(spec, asset_root)
            if existing.stat().st_size != int(spec["bytes"]) or _sha256_path(existing) != spec["sha256"]:
                raise FullBundleMigrationError(
                    f"content-addressed destination is corrupt: {spec['asset_id']}"
                )
            verified_info = existing.lstat()
            preexisting_st_dev = int(verified_info.st_dev)
            preexisting_st_ino = int(verified_info.st_ino)
        destinations.append(
            {
                "asset_id": spec["asset_id"],
                "relative_path": destination.relative_to(asset_root).as_posix(),
                "sha256": spec["sha256"],
                "bytes": int(spec["bytes"]),
                "existed_before": existed_before,
                "ownership_state": "preexisting" if existed_before else "unclaimed",
                "preexisting_st_dev": preexisting_st_dev,
                "preexisting_st_ino": preexisting_st_ino,
                "operator_created_st_dev": None,
                "operator_created_st_ino": None,
            }
        )
    return {
        "schema_version": 1,
        "packet_id": packet_builder.PACKET_ID,
        "packet_sha256": packet_sha256,
        "target_id": target["id"],
        "database_path_sha256": _path_identity(db_path),
        "asset_root_path_sha256": _path_identity(asset_root),
        "narration_root_path_sha256": _path_identity(narration_root),
        "artwork_root_path_sha256": _path_identity(artwork_root),
        "backup_manifest_sha256": backup_manifest_sha256,
        "operator_audit_sha256": audit_sha256,
        "predecessor_history_sha256": predecessor_history_sha256,
        "expected_before_revision": packet["predecessor"]["draft_revision"],
        "expected_after_revision": packet["migration_draft"]["expected_after_revision"],
        "staging_relative_path": STAGING_DIR_NAME,
        "state": "planned",
        "destinations": destinations,
    }


@contextmanager
def _exclusive_lock(asset_root: Path) -> Iterator[None]:
    lock_path = asset_root / LOCK_FILE_NAME
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(lock_path, flags, 0o600)
    except OSError as exc:
        raise FullBundleMigrationError("migration lock path is unsafe") from exc
    info = os.fstat(descriptor)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        os.close(descriptor)
        raise FullBundleMigrationError("migration lock must be one regular file")
    handle = os.fdopen(descriptor, "a+", encoding="utf-8")
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise FullBundleMigrationError("another full-bundle migration is active") from exc
        yield
    finally:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def _destination_from_journal(entry: dict[str, Any], asset_root: Path) -> Path:
    raw_relative = str(entry.get("relative_path") or "")
    relative = Path(raw_relative)
    if (
        relative.is_absolute()
        or not relative.parts
        or ".." in relative.parts
        or relative.as_posix() != raw_relative
    ):
        raise FullBundleMigrationError("journal destination path is unsafe")
    destination = asset_root / relative
    if asset_root not in destination.parents:
        raise FullBundleMigrationError("journal destination escapes asset root")
    return destination


def _storage_reference_count(connection: sqlite3.Connection, path: Path) -> int:
    return int(
        connection.execute(
            "SELECT COUNT(*) FROM authored_original_assets WHERE storage_path=?",
            (str(path),),
        ).fetchone()[0]
    )


def _remove_unreferenced_created(
    connection: sqlite3.Connection,
    destinations: list[dict[str, Any]],
    asset_root: Path,
    specs: list[dict[str, Any]],
    *,
    journal_path: Path | None = None,
    journal_document: dict[str, Any] | None = None,
) -> None:
    specs_by_id = {str(spec["asset_id"]): spec for spec in specs}
    if set(specs_by_id) != {str(row.get("asset_id") or "") for row in destinations}:
        raise FullBundleMigrationError("rollback destination membership drifted")
    for entry in reversed(destinations):
        spec = specs_by_id[str(entry["asset_id"])]
        destination = _journal_destination_for_spec(entry, spec, asset_root)
        state = entry.get("ownership_state")
        if state not in {
            "preexisting",
            "unclaimed",
            "operator_created",
            "raced_exact",
            "external_collision",
        }:
            raise FullBundleMigrationError("rollback ownership state is invalid")
        current_info = _lstat_or_none(destination)
        if current_info is None:
            if state == "preexisting":
                raise FullBundleMigrationError("preexisting destination disappeared")
            continue
        destination = _verified_asset_destination(
            spec, asset_root, entry=entry
        )
        exact = (
            destination.stat().st_size != int(entry["bytes"])
            or _sha256_path(destination) != entry["sha256"]
        ) is False
        owned_identity = (
            entry.get("operator_created_st_dev"),
            entry.get("operator_created_st_ino"),
        )
        current_identity = (int(current_info.st_dev), int(current_info.st_ino))
        if state == "operator_created" and owned_identity == current_identity:
            if not exact:
                raise FullBundleMigrationError(
                    "rollback refused drifted operator-owned destination bytes"
                )
            if _storage_reference_count(connection, destination) == 0:
                with _open_asset_destination_parent(
                    asset_root, destination, create=False
                ) as parent_fd:
                    anchored = os.stat(
                        destination.name,
                        dir_fd=parent_fd,
                        follow_symlinks=False,
                    )
                    if (int(anchored.st_dev), int(anchored.st_ino)) != current_identity:
                        raise FullBundleMigrationError(
                            "rollback destination retargeted before unlink"
                        )
                    os.unlink(destination.name, dir_fd=parent_fd)
                    os.fsync(parent_fd)
            continue

        # Prior absence never proves ownership. A name created outside this
        # operator, or an operator-created inode replaced before recovery, is
        # preserved. Exact bytes can become preexisting on the next safe retry;
        # corrupt bytes remain untouched and block progress.
        if not exact:
            prior_document = copy.deepcopy(journal_document)
            entry["ownership_state"] = "external_collision"
            if journal_path is not None and journal_document is not None:
                _write_json_atomic(
                    journal_path,
                    journal_document,
                    create_only=False,
                    expected_prior=prior_document,
                )
            raise FullBundleMigrationError(
                "rollback preserved an unowned drifted destination"
            )
        prior_document = copy.deepcopy(journal_document)
        entry["ownership_state"] = "raced_exact"
        entry["operator_created_st_dev"] = None
        entry["operator_created_st_ino"] = None
        if journal_path is not None and journal_document is not None:
            _write_json_atomic(
                journal_path,
                journal_document,
                create_only=False,
                expected_prior=prior_document,
            )


def _clean_staging(staging: Path, prepared: list[PreparedAsset]) -> None:
    if _lstat_or_none(staging) is None:
        return
    if staging.is_symlink() or not staging.is_dir():
        raise FullBundleMigrationError("staging path is unsafe")
    expected = {
        f"{item.spec['asset_id']}-{item.spec['sha256']}"
        + (".mp3" if item.spec["kind"] == "narration" else ".png")
        for item in prepared
    }
    for child in staging.iterdir():
        if child.name not in expected:
            raise FullBundleMigrationError("staging directory contains an unknown file")
        child = _assert_file(child, "staged file")
        child.unlink()
    staging.rmdir()
    _fsync_directory(staging.parent)


def _recover_journal(
    journal_path: Path,
    expected_journal: dict[str, Any],
    *,
    db_path: Path,
    asset_root: Path,
    prepared: list[PreparedAsset],
    packet: dict[str, Any],
    backup_snapshot: dict[str, Any],
) -> str | None:
    if _lstat_or_none(journal_path) is None:
        staging = asset_root / STAGING_DIR_NAME
        if _lstat_or_none(staging) is not None:
            raise FullBundleMigrationError("orphan staging exists without a journal")
        return None
    journal_path = _assert_file(journal_path, "migration journal")
    journal = _read_json(journal_path, "migration journal")
    for key, expected in expected_journal.items():
        if key in {"state", "destinations", "backup_manifest_sha256"}:
            continue
        if journal.get(key) != expected:
            raise FullBundleMigrationError(f"migration journal drifted at {key}")
    actual_destinations = journal.get("destinations")
    prior_backup_sha = journal.get("backup_manifest_sha256")
    if not isinstance(prior_backup_sha, str) or not re.fullmatch(
        r"[a-f0-9]{64}", prior_backup_sha
    ):
        raise FullBundleMigrationError("migration journal backup binding is invalid")
    expected_destinations = expected_journal["destinations"]
    if not isinstance(actual_destinations, list) or len(actual_destinations) != len(
        expected_destinations
    ):
        raise FullBundleMigrationError("migration journal destinations are malformed")
    expected_by_id = {row["asset_id"]: row for row in expected_destinations}
    if {row.get("asset_id") for row in actual_destinations} != set(expected_by_id):
        raise FullBundleMigrationError("migration journal destination membership drifted")
    for row in actual_destinations:
        expected = expected_by_id[row["asset_id"]]
        if not isinstance(row.get("existed_before"), bool):
            raise FullBundleMigrationError("migration journal existed-before flag is invalid")
        for key in ("asset_id", "relative_path", "sha256", "bytes"):
            if row.get(key) != expected[key]:
                raise FullBundleMigrationError("migration journal destination drifted")
        ownership = row.get("ownership_state")
        preexisting_identity = (
            row.get("preexisting_st_dev"),
            row.get("preexisting_st_ino"),
        )
        created_identity = (
            row.get("operator_created_st_dev"),
            row.get("operator_created_st_ino"),
        )
        valid_int_pair = lambda pair: all(
            isinstance(value, int) and not isinstance(value, bool) and value >= 0
            for value in pair
        )
        if ownership == "preexisting":
            valid = (
                row["existed_before"] is True
                and valid_int_pair(preexisting_identity)
                and created_identity == (None, None)
            )
        elif ownership == "operator_created":
            valid = (
                row["existed_before"] is False
                and preexisting_identity == (None, None)
                and valid_int_pair(created_identity)
            )
        elif ownership in {"unclaimed", "raced_exact", "external_collision"}:
            valid = (
                row["existed_before"] is False
                and preexisting_identity == (None, None)
                and created_identity == (None, None)
            )
        else:
            valid = False
        if not valid:
            raise FullBundleMigrationError("migration journal ownership proof is invalid")
    if journal.get("state") not in {"planned", "files_promoted", "database_committed"}:
        raise FullBundleMigrationError("migration journal state is invalid")
    connection = _connect(db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        state, _snapshot = _classify_state(
            connection,
            packet,
            asset_root,
            backup_snapshot=backup_snapshot,
            expected_predecessor_history_sha256=journal[
                "predecessor_history_sha256"
            ],
        )
        if state == "target":
            _clean_staging(asset_root / STAGING_DIR_NAME, prepared)
            connection.commit()
            # Carry the exact validated on-disk document forward so the next
            # state transition compares against its real prior bytes.
            expected_journal.clear()
            expected_journal.update(copy.deepcopy(journal))
            return "committed_target_recovered"
        _remove_unreferenced_created(
            connection,
            list(actual_destinations),
            asset_root,
            packet["assets"]["new"],
            journal_path=journal_path,
            journal_document=journal,
        )
        _clean_staging(asset_root / STAGING_DIR_NAME, prepared)
        connection.commit()
        _retire_json_document(
            journal_path, journal, label="migration journal"
        )
        return "partial_files_rolled_back"
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _rollback_pre_database_action_failure(
    *,
    journal_path: Path,
    journal_document: dict[str, Any],
    db_path: Path,
    asset_root: Path,
    prepared: list[PreparedAsset],
    packet: dict[str, Any],
    backup_snapshot: dict[str, Any],
    predecessor_history_sha256: str,
) -> str:
    connection = _connect(db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        state, _snapshot = _classify_state(
            connection,
            packet,
            asset_root,
            backup_snapshot=backup_snapshot,
            expected_predecessor_history_sha256=predecessor_history_sha256,
        )
        if state == "target":
            connection.commit()
            return "target_journal_retained"
        _remove_unreferenced_created(
            connection,
            journal_document["destinations"],
            asset_root,
            packet["assets"]["new"],
            journal_path=journal_path,
            journal_document=journal_document,
        )
        _clean_staging(asset_root / STAGING_DIR_NAME, prepared)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    _retire_json_document(
        journal_path, journal_document, label="migration journal"
    )
    return "predecessor_files_rolled_back"


def _stage_and_promote(
    prepared: list[PreparedAsset],
    asset_root: Path,
    journal_destinations: list[dict[str, Any]],
    *,
    journal_path: Path,
    journal_document: dict[str, Any],
) -> list[Path]:
    if journal_document.get("destinations") is not journal_destinations:
        raise FullBundleMigrationError("promotion journal document is not authoritative")
    entries = {str(row.get("asset_id") or ""): row for row in journal_destinations}
    if set(entries) != {str(item.spec["asset_id"]) for item in prepared}:
        raise FullBundleMigrationError("promotion journal membership drifted")
    pending: list[PreparedAsset] = []
    for item in prepared:
        entry = entries[str(item.spec["asset_id"])]
        destination = _journal_destination_for_spec(entry, item.spec, asset_root)
        _assert_planned_asset_ancestry(asset_root, destination)
        if entry.get("ownership_state") == "preexisting":
            destination = _verified_asset_destination(
                item.spec, asset_root, entry=entry
            )
            info = destination.lstat()
            if (
                entry.get("existed_before") is not True
                or (int(info.st_dev), int(info.st_ino))
                != (
                    entry.get("preexisting_st_dev"),
                    entry.get("preexisting_st_ino"),
                )
                or destination.stat().st_size != int(item.spec["bytes"])
                or _sha256_path(destination) != item.spec["sha256"]
            ):
                raise FullBundleMigrationError(
                    f"preexisting destination drifted: {item.spec['asset_id']}"
                )
            continue
        if (
            entry.get("existed_before") is not False
            or entry.get("ownership_state") != "unclaimed"
        ):
            raise FullBundleMigrationError("promotion journal ownership state is invalid")
        pending.append(item)
    if not pending:
        return []
    required = sum(int(item.spec["bytes"]) for item in pending) + 128 * 1024 * 1024
    if shutil.disk_usage(asset_root).free < required:
        raise FullBundleMigrationError("asset volume lacks safe staging capacity")
    staging = asset_root / STAGING_DIR_NAME
    if _lstat_or_none(staging) is not None:
        raise FullBundleMigrationError("staging path already exists")
    staging.mkdir(mode=0o700)
    _fsync_directory(asset_root)
    staged: list[tuple[PreparedAsset, Path]] = []
    created: list[Path] = []
    try:
        for item in pending:
            suffix = ".mp3" if item.spec["kind"] == "narration" else ".png"
            target = staging / f"{item.spec['asset_id']}-{item.spec['sha256']}{suffix}"
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as output, item.source_path.open("rb") as source:
                shutil.copyfileobj(source, output, length=1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            if target.stat().st_size != int(item.spec["bytes"]) or _sha256_path(target) != item.spec["sha256"]:
                raise FullBundleMigrationError(
                    f"staged asset verification failed: {item.spec['asset_id']}"
                )
            staged.append((item, target))
        _fsync_directory(staging)

        for item, staged_path in staged:
            entry = entries[str(item.spec["asset_id"])]
            destination = _journal_destination_for_spec(entry, item.spec, asset_root)
            staged_info = staged_path.lstat()
            if (
                stat.S_ISLNK(staged_info.st_mode)
                or not stat.S_ISREG(staged_info.st_mode)
                or staged_info.st_nlink != 1
            ):
                raise FullBundleMigrationError(
                    f"staged asset identity is unsafe: {item.spec['asset_id']}"
                )
            with _open_asset_destination_parent(
                asset_root, destination, create=True
            ) as parent_fd:
                linked = False
                try:
                    os.link(
                        staged_path,
                        destination.name,
                        dst_dir_fd=parent_fd,
                        follow_symlinks=False,
                    )
                    linked = True
                    linked_info = os.stat(
                        destination.name,
                        dir_fd=parent_fd,
                        follow_symlinks=False,
                    )
                    try:
                        lexical_parent_info = destination.parent.lstat()
                        descriptor_parent_info = os.fstat(parent_fd)
                        lexical_file_info = destination.lstat()
                    except OSError as exc:
                        raise FullBundleMigrationError(
                            f"asset destination retargeted during promotion: {item.spec['asset_id']}"
                        ) from exc
                    if (
                        (linked_info.st_dev, linked_info.st_ino)
                        != (staged_info.st_dev, staged_info.st_ino)
                        or (descriptor_parent_info.st_dev, descriptor_parent_info.st_ino)
                        != (lexical_parent_info.st_dev, lexical_parent_info.st_ino)
                        or stat.S_ISLNK(lexical_parent_info.st_mode)
                        or (linked_info.st_dev, linked_info.st_ino)
                        != (lexical_file_info.st_dev, lexical_file_info.st_ino)
                        or stat.S_ISLNK(lexical_file_info.st_mode)
                    ):
                        raise FullBundleMigrationError(
                            f"asset destination retargeted during promotion: {item.spec['asset_id']}"
                        )
                    os.fsync(parent_fd)
                except FileExistsError:
                    prior_document = copy.deepcopy(journal_document)
                    try:
                        collision = _verified_asset_destination(
                            item.spec, asset_root, entry=entry
                        )
                        collision_exact = (
                            collision.stat().st_size == int(item.spec["bytes"])
                            and _sha256_path(collision) == item.spec["sha256"]
                        )
                    except FullBundleMigrationError:
                        collision_exact = False
                    entry["ownership_state"] = (
                        "raced_exact" if collision_exact else "external_collision"
                    )
                    entry["operator_created_st_dev"] = None
                    entry["operator_created_st_ino"] = None
                    _write_json_atomic(
                        journal_path,
                        journal_document,
                        create_only=False,
                        expected_prior=prior_document,
                    )
                    raise FullBundleMigrationError(
                        f"create-only destination raced after journal: {item.spec['asset_id']}"
                    )
                except Exception:
                    if linked:
                        try:
                            current_info = os.stat(
                                destination.name,
                                dir_fd=parent_fd,
                                follow_symlinks=False,
                            )
                        except FileNotFoundError:
                            current_info = None
                        except OSError:
                            current_info = False
                        if current_info is not None and current_info is not False and (
                            current_info.st_dev,
                            current_info.st_ino,
                        ) == (staged_info.st_dev, staged_info.st_ino):
                            os.unlink(destination.name, dir_fd=parent_fd)
                            os.fsync(parent_fd)
                        elif current_info is not None:
                            prior_document = copy.deepcopy(journal_document)
                            entry["ownership_state"] = "external_collision"
                            entry["operator_created_st_dev"] = None
                            entry["operator_created_st_ino"] = None
                            _write_json_atomic(
                                journal_path,
                                journal_document,
                                create_only=False,
                                expected_prior=prior_document,
                            )
                    raise
            prior_document = copy.deepcopy(journal_document)
            entry["ownership_state"] = "operator_created"
            entry["operator_created_st_dev"] = int(linked_info.st_dev)
            entry["operator_created_st_ino"] = int(linked_info.st_ino)
            _write_json_atomic(
                journal_path,
                journal_document,
                create_only=False,
                expected_prior=prior_document,
            )
            _verified_asset_destination(item.spec, asset_root, entry=entry)
            created.append(destination)
            staged_path.unlink()
        staging.rmdir()
        _fsync_directory(asset_root)
        return created
    except Exception:
        # The caller removes promoted files only while holding a database write
        # lock and only after proving that no row references them.
        if staging.exists() and staging.is_dir() and not staging.is_symlink():
            for child in staging.iterdir():
                if child.is_file() and not child.is_symlink():
                    child.unlink()
            staging.rmdir()
        raise


def _insert_new_assets(
    connection: sqlite3.Connection,
    packet: dict[str, Any],
    asset_root: Path,
    admin_user_id: int,
    now: int,
    journal_destinations: list[dict[str, Any]],
) -> int:
    entries = {str(row.get("asset_id") or ""): row for row in journal_destinations}
    if set(entries) != {str(spec["asset_id"]) for spec in packet["assets"]["new"]}:
        raise FullBundleMigrationError("database journal membership drifted")
    inserted = 0
    for spec in packet["assets"]["new"]:
        destination = _verified_asset_destination(
            spec, asset_root, entry=entries[str(spec["asset_id"])]
        )
        if (
            destination.stat().st_size != int(spec["bytes"])
            or _sha256_path(destination) != spec["sha256"]
        ):
            raise FullBundleMigrationError(
                f"database destination bytes drifted: {spec['asset_id']}"
            )
        current = connection.execute(
            "SELECT * FROM authored_original_assets WHERE pack_id=? AND asset_id=? AND is_current=1",
            (packet_builder.PRODUCT_ID, spec["asset_id"]),
        ).fetchall()
        if current:
            raise FullBundleMigrationError(
                f"new asset id already has a current row: {spec['asset_id']}"
            )
        existing = connection.execute(
            "SELECT 1 FROM authored_original_assets WHERE pack_id=? AND asset_id=? AND sha256=?",
            (packet_builder.PRODUCT_ID, spec["asset_id"], spec["sha256"]),
        ).fetchone()
        if existing:
            raise FullBundleMigrationError(
                f"new asset already has a historical row: {spec['asset_id']}"
            )
        connection.execute(
            """INSERT INTO authored_original_assets
               (pack_id,asset_id,sha256,kind,mime_type,byte_count,public_path,
                storage_path,media_metadata_json,transcript_sha256,
                generator_metadata_json,is_current,uploaded_by,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)""",
            (
                packet_builder.PRODUCT_ID,
                spec["asset_id"],
                spec["sha256"],
                spec["kind"],
                spec["mime_type"],
                int(spec["bytes"]),
                spec["public_path"],
                str(destination),
                _expected_new_media_json(spec),
                spec.get("transcript_sha256"),
                json.dumps(
                    spec["generator_metadata"], separators=(",", ":"), sort_keys=True
                ),
                admin_user_id,
                now,
                now,
            ),
        )
        inserted += 1
    return inserted


def _apply_database_locked(
    connection: sqlite3.Connection,
    packet: dict[str, Any],
    *,
    asset_root: Path,
    admin_user_id: int,
    backup_snapshot: dict[str, Any],
    journal_destinations: list[dict[str, Any]],
    predecessor_history_sha256: str,
) -> tuple[str, int, int]:
    admin = connection.execute(
        "SELECT id,is_admin FROM users WHERE id=?", (admin_user_id,)
    ).fetchone()
    if not admin or not bool(admin["is_admin"]):
        raise FullBundleMigrationError("full-bundle migration requires a current admin")
    state, live_snapshot = _classify_state(
        connection,
        packet,
        asset_root,
        backup_snapshot=backup_snapshot,
        expected_predecessor_history_sha256=predecessor_history_sha256,
    )
    if _canonical_sha256(live_snapshot) != _canonical_sha256(backup_snapshot):
        if state != "target":
            raise FullBundleMigrationError(
                "same-volume backup does not match locked live predecessor"
            )
        # A target replay may use the original predecessor backup; its RF rows and
        # all preexisting reports were already checked byte-for-byte above.
    if state == "target":
        return "replayed_exact_target", 0, int(packet["migration_draft"]["expected_after_revision"])

    now = int(time.time())
    inserted = _insert_new_assets(
        connection,
        packet,
        asset_root,
        admin_user_id,
        now,
        journal_destinations,
    )
    if inserted != 78:
        raise FullBundleMigrationError("database insertion count drifted")
    draft = packet["migration_draft"]
    updated = connection.execute(
        """UPDATE authored_trip_packs SET
             slug=?,draft_title=?,draft_summary=?,draft_price_credits=?,
             draft_coverage_region=?,draft_public_metadata=?,
             draft_validation_metadata=?,draft_template_json=?,
             draft_original_manifest_json=?,draft_revision=draft_revision+1,
             updated_by=?,updated_at=?
           WHERE id=? AND content_kind='original_drive' AND status='draft'
             AND draft_revision=? AND current_published_version IS NULL""",
        (
            draft["slug"],
            draft["title"],
            draft["summary"],
            int(draft["price_credits"]),
            draft["coverage_region"],
            draft["public_metadata_json"],
            draft["validation_metadata_json"],
            draft["template_json"],
            draft["original_manifest_json"],
            admin_user_id,
            now,
            packet_builder.PRODUCT_ID,
            int(draft["expected_before_revision"]),
        ),
    )
    if updated.rowcount != 1:
        raise FullBundleMigrationError("draft CAS lost a race")
    _assert_target_state(
        connection,
        packet,
        asset_root,
        backup_rf_snapshot=backup_snapshot,
        expected_predecessor_history_sha256=predecessor_history_sha256,
    )
    return "migrated", inserted, int(draft["expected_after_revision"])


def _backup_snapshot(backup_path: Path) -> dict[str, Any]:
    _assert_backup_sidecars_absent(backup_path)
    connection = _connect(backup_path, readonly=True)
    try:
        return _db_snapshot(connection)
    finally:
        connection.close()
        _assert_backup_sidecars_absent(backup_path)


def _validate_backup_snapshot_state(
    backup_path: Path,
    packet: dict[str, Any],
    asset_root: Path,
    snapshot: dict[str, Any],
    *,
    expected_predecessor_history_sha256: str | None = None,
) -> str:
    _assert_backup_sidecars_absent(backup_path)
    connection = _connect(backup_path, readonly=True)
    try:
        pack = connection.execute(
            "SELECT draft_revision FROM authored_trip_packs WHERE id=?",
            (packet_builder.PRODUCT_ID,),
        ).fetchone()
        if not pack:
            raise FullBundleMigrationError("backup does not contain the bounded pack")
        revision = int(pack["draft_revision"])
        if revision == int(packet["predecessor"]["draft_revision"]):
            _assert_predecessor_state(connection, packet, asset_root)
            return "predecessor"
        if revision == int(packet["migration_draft"]["expected_after_revision"]):
            _assert_target_state(
                connection,
                packet,
                asset_root,
                backup_rf_snapshot=snapshot,
                expected_predecessor_history_sha256=expected_predecessor_history_sha256,
                require_history_binding=(
                    expected_predecessor_history_sha256 is not None
                ),
            )
            return "target"
        raise FullBundleMigrationError("backup pack revision is not bounded")
    finally:
        connection.close()
        _assert_backup_sidecars_absent(backup_path)


def _report(
    packet: dict[str, Any],
    packet_sha256: str,
    *,
    target: dict[str, Any],
    backup_manifest: dict[str, Any],
    backup_manifest_sha256: str,
    audit: dict[str, Any],
    migration_result: str,
    inserted_assets: int,
    created_files: int,
    recovered: str | None,
    verification: dict[str, Any],
    predecessor_history_sha256: str,
) -> dict[str, Any]:
    draft = packet["migration_draft"]
    attestation = packet["post_migration_phases"]["license_attestation"]
    profile = packet["post_migration_phases"]["narration_profile_cas"]
    identity = {
        "packet_sha256": packet_sha256,
        "target_id": target["id"],
        "database_path_sha256": target["database_path_sha256"],
        "asset_root_path_sha256": target["asset_root_path_sha256"],
        "after_revision": draft["expected_after_revision"],
    }
    return {
        "schema_version": 1,
        "receipt_id": "smokies_complete_private_migration_receipt_" + _canonical_sha256(identity)[:24],
        "kind": "original_full_bundle_private_migration_receipt",
        "status": "verified_configured_private_migration",
        "packet_id": packet["packet_id"],
        "packet_sha256": packet_sha256,
        "source_revision": packet["source_revision"],
        "target": target,
        "operator_audit": audit,
        "migration": {
            "before_revision": packet["predecessor"]["draft_revision"],
            "after_revision": draft["expected_after_revision"],
            "committed_asset_count": 98,
            "committed_narration_count": 85,
            "committed_image_count": 13,
            "manifest_canonical_sha256": draft["original_manifest_canonical_sha256"],
            "profile_present": False,
            "roaring_fork_existing_rows_preserved": True,
            "predecessor_history_sha256": predecessor_history_sha256,
            "published_version_count": 0,
        },
        "verification": verification,
        "prepared_not_executed": {
            "license_attestation": {
                "store_api": attestation["store_api"],
                "asset_count": attestation["asset_count"],
                "asset_sha256_set_sha256": _canonical_sha256(
                    attestation["asset_sha256"]
                ),
                "terms_policy_sha256": attestation["terms_policy_sha256"],
                "executed": False,
            },
            "narration_profile_cas": {
                "store_api": profile["store_api"],
                "expected_base_manifest_sha256": profile[
                    "expected_base_manifest_sha256"
                ],
                "server_attestation_hashes_pending": True,
                "executed": False,
            },
        },
        "effects": {
            "network_accessed": False,
            "provider_accessed": False,
            "provider_rerendered": False,
            "attestations_written": 0,
            "narration_profile_applied": False,
            "trusted_validation_performed": False,
            "deployment_performed": False,
            "publication_performed": False,
        },
        "gates": {
            "configured_private_migration_complete": True,
            "new_72_license_attestations_complete": False,
            "pack_narration_profile_cas_complete": False,
            "verified_private_upload_complete": False,
            "dual_platform_private_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
    }


def _verification_from_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "draft_revision": int(snapshot["pack"]["draft_revision"]),
        "current_asset_count": len(snapshot["assets"]),
        "published_version_count": len(snapshot["versions"]),
        "active_validation_report_count": sum(
            str(row.get("status") or "") in {"pending", "executing"}
            for row in snapshot["validation_reports"]
        ),
        "release_authorization_count": len(snapshot["release_authorizations"]),
        "snapshot_sha256": _canonical_sha256(snapshot),
    }


def _validate_existing_receipt(
    existing: dict[str, Any], expected_for_this_replay: dict[str, Any]
) -> None:
    if existing != expected_for_this_replay:
        raise FullBundleMigrationError("existing migration receipt bindings drifted")


def dry_run() -> dict[str, Any]:
    packet, contract, packet_sha256 = _load_exact_packet()
    return {
        "schema_version": 1,
        "status": "dry_run_verified_live_apply_locked",
        "packet_id": packet["packet_id"],
        "packet_sha256": packet_sha256,
        "operator_audit_contract_id": contract["contract_id"],
        "counts": packet["assets"]["counts"],
        "expected_before_revision": packet["predecessor"]["draft_revision"],
        "expected_after_revision": packet["migration_draft"]["expected_after_revision"],
        "writes_performed": False,
        "database_accessed": False,
        "external_media_accessed": False,
        "network_accessed": False,
        "provider_accessed": False,
        "remaining_requirements": [
            "independent operator audit artifact bound to frozen operator and tests",
            "explicit configured target and exact predecessor identities",
            "fresh verified same-volume SQLite backup",
            "explicit accepted narration and artwork roots",
            "post-migration 72-asset attestation and server-timestamped profile CAS",
        ],
        "gates": copy.deepcopy(packet["gates"]),
    }


def apply_private(
    *,
    apply_confirmation: str,
    db_path: Path,
    asset_root: Path,
    narration_root: Path,
    artwork_root: Path,
    backup_manifest_path: Path,
    expected_backup_manifest_sha256: str,
    operator_audit_path: Path,
    admin_user_id: int,
    target_id: str,
    report_path: Path,
    expected_packet_sha256: str,
    expected_source_commit: str,
    expected_source_tree: str,
    expected_draft_revision: int,
    expected_current_manifest_sha256: str,
    expected_current_profile_sha256: str,
    expected_validation_metadata_sha256: str,
    expected_full_base_manifest_sha256: str,
    expected_terms_policy_sha256: str,
) -> dict[str, Any]:
    if apply_confirmation != APPLY_SENTINEL:
        raise FullBundleMigrationError("exact private migration confirmation is required")
    packet, contract, packet_sha256 = _load_exact_packet()
    _assert_expected_identities(
        packet,
        packet_sha256=packet_sha256,
        expected_packet_sha256=expected_packet_sha256,
        expected_source_commit=expected_source_commit,
        expected_source_tree=expected_source_tree,
        expected_draft_revision=expected_draft_revision,
        expected_current_manifest_sha256=expected_current_manifest_sha256,
        expected_current_profile_sha256=expected_current_profile_sha256,
        expected_validation_metadata_sha256=expected_validation_metadata_sha256,
        expected_full_base_manifest_sha256=expected_full_base_manifest_sha256,
        expected_terms_policy_sha256=expected_terms_policy_sha256,
    )
    db_path = _assert_file(db_path, "database")
    _assert_wal_sidecars_safe(db_path)
    asset_root = _assert_directory(asset_root, "asset root")
    narration_root = _assert_directory(narration_root, "accepted narration root")
    artwork_root = _assert_directory(artwork_root, "accepted artwork root")
    db_identity = _inode_identity(db_path)
    asset_root_identity = _inode_identity(asset_root)
    _assert_disjoint_paths(
        {
            "database": db_path,
            "asset root": asset_root,
            "accepted narration root": narration_root,
            "accepted artwork root": artwork_root,
            "repository": ROOT.resolve(strict=True),
        }
    )
    target = _configured_target(
        db_path=db_path,
        asset_root=asset_root,
        target_id=target_id,
        packet=packet,
    )
    if isinstance(admin_user_id, bool) or not isinstance(admin_user_id, int) or admin_user_id < 1:
        raise FullBundleMigrationError("admin user id must be positive")
    operator_audit_path = _assert_file(operator_audit_path, "operator audit artifact")
    audit = _validate_operator_audit(
        operator_audit_path, packet, contract, packet_sha256
    )
    backup_manifest, backup_path = _validate_backup(
        backup_manifest_path,
        expected_manifest_sha256=expected_backup_manifest_sha256,
        db_path=db_path,
        asset_root=asset_root,
    )
    _assert_disjoint_paths(
        {
            "asset root": asset_root,
            "database": db_path,
            "backup manifest": backup_manifest_path.resolve(strict=True),
            "SQLite backup": backup_path,
            "accepted narration root": narration_root,
            "accepted artwork root": artwork_root,
            "repository": ROOT.resolve(strict=True),
        }
    )
    backup_snapshot = _backup_snapshot(backup_path)
    backup_state = _validate_backup_snapshot_state(
        backup_path, packet, asset_root, backup_snapshot
    )
    prepared = _prepare_external_assets(packet, narration_root, artwork_root)

    if not report_path.is_absolute():
        raise FullBundleMigrationError("report path must be absolute")
    report_parent = _assert_directory(report_path.parent, "report parent")
    report_path = report_parent / report_path.name
    report_info = _lstat_or_none(report_path)
    if report_info is not None and (
        stat.S_ISLNK(report_info.st_mode)
        or not stat.S_ISREG(report_info.st_mode)
        or report_info.st_nlink != 1
    ):
        raise FullBundleMigrationError("existing migration receipt is unsafe")
    db_wal_path = Path(str(db_path) + "-wal")
    db_shm_path = Path(str(db_path) + "-shm")
    reserved = {
        db_path,
        db_wal_path,
        db_shm_path,
        operator_audit_path,
        backup_manifest_path.resolve(strict=True),
        backup_path,
        *(ROOT / path for path in (packet_builder.PACKET_PATH, packet_builder.AUDIT_CONTRACT_PATH)),
        *(item.source_path for item in prepared),
    }
    if (
        report_path in reserved
        or report_path == asset_root
        or asset_root in report_path.parents
        or report_path == narration_root
        or narration_root in report_path.parents
        or report_path == artwork_root
        or artwork_root in report_path.parents
    ):
        raise FullBundleMigrationError("report path collides with protected state")
    identity_inputs = {
        "database": db_path,
        "backup manifest": backup_manifest_path.resolve(strict=True),
        "SQLite backup": backup_path,
        "operator audit": operator_audit_path,
    }
    if report_info is not None:
        identity_inputs["existing migration receipt"] = report_path
    _assert_distinct_file_identities(identity_inputs)

    journal_path = asset_root / JOURNAL_FILE_NAME
    created: list[Path] = []
    inserted = 0
    committed = False
    migration_result = "not_started"
    recovered: str | None = None
    with _exclusive_lock(asset_root):
        if _inode_identity(db_path) != db_identity or _inode_identity(asset_root) != asset_root_identity:
            raise FullBundleMigrationError("database or asset-root identity changed")
        _assert_wal_sidecars_safe(db_path)
        # Revalidate immutable prerequisites after acquiring the process lock.
        _validate_backup(
            backup_manifest_path,
            expected_manifest_sha256=expected_backup_manifest_sha256,
            db_path=db_path,
            asset_root=asset_root,
        )
        current_packet, current_contract, current_packet_sha256 = _load_exact_packet()
        if (
            current_packet_sha256 != packet_sha256
            or current_packet != packet
            or current_contract != contract
        ):
            raise FullBundleMigrationError("migration packet changed after preflight")
        current_audit = _validate_operator_audit(
            operator_audit_path, packet, contract, packet_sha256
        )
        if current_audit != audit:
            raise FullBundleMigrationError("operator audit changed after preflight")
        receipt_history = _history_binding_from_file(
            report_path,
            packet_sha256=packet_sha256,
            kind="migration receipt",
        )
        journal_history = _history_binding_from_file(
            journal_path,
            packet_sha256=packet_sha256,
            kind="migration journal",
        )
        if (
            receipt_history is not None
            and journal_history is not None
            and receipt_history != journal_history
        ):
            raise FullBundleMigrationError(
                "receipt and journal predecessor-history bindings disagree"
            )
        persisted_history = receipt_history or journal_history
        if backup_state == "predecessor":
            backup_history = _predecessor_history_sha256(backup_snapshot, packet)
            if persisted_history is not None and persisted_history != backup_history:
                raise FullBundleMigrationError(
                    "persisted history differs from the locked predecessor backup"
                )
            predecessor_history_sha256 = backup_history
        else:
            if persisted_history is None:
                raise FullBundleMigrationError(
                    "target replay requires a predecessor-bound journal or receipt"
                )
            predecessor_history_sha256 = persisted_history

        if _lstat_or_none(report_path) is not None:
            _assert_file(report_path, "existing migration receipt")
            report_state_connection = _connect(db_path)
            try:
                report_state_connection.execute("BEGIN IMMEDIATE")
                report_state, _report_snapshot = _classify_state(
                    report_state_connection,
                    packet,
                    asset_root,
                    backup_snapshot=backup_snapshot,
                    expected_predecessor_history_sha256=(
                        predecessor_history_sha256
                    ),
                )
                report_state_connection.commit()
            except Exception:
                report_state_connection.rollback()
                raise
            finally:
                report_state_connection.close()
            if report_state != "target":
                raise FullBundleMigrationError(
                    "an existing receipt cannot authorize a predecessor migration"
                )
            existing_receipt = _read_json(
                report_path, "existing migration receipt"
            )
            expected_receipt = _report(
                packet,
                packet_sha256,
                target=target,
                backup_manifest=backup_manifest,
                backup_manifest_sha256=expected_backup_manifest_sha256,
                audit=audit,
                migration_result="replayed_exact_target",
                inserted_assets=0,
                created_files=0,
                recovered=None,
                verification=_verification_from_snapshot(_report_snapshot),
                predecessor_history_sha256=predecessor_history_sha256,
            )
            _validate_existing_receipt(existing_receipt, expected_receipt)
            return existing_receipt
        expected_journal = _journal_document(
            packet,
            packet_sha256,
            target=target,
            db_path=db_path,
            asset_root=asset_root,
            narration_root=narration_root,
            artwork_root=artwork_root,
            backup_manifest_sha256=expected_backup_manifest_sha256,
            audit_sha256=audit["artifact_sha256"],
            predecessor_history_sha256=predecessor_history_sha256,
        )
        recovered = _recover_journal(
            journal_path,
            expected_journal,
            db_path=db_path,
            asset_root=asset_root,
            prepared=prepared,
            packet=packet,
            backup_snapshot=backup_snapshot,
        )
        if recovered != "committed_target_recovered":
            if recovered == "partial_files_rolled_back":
                # Recovery may have removed files created by the interrupted run;
                # rebuild the presence flags before starting the new run.
                expected_journal = _journal_document(
                    packet,
                    packet_sha256,
                    target=target,
                    db_path=db_path,
                    asset_root=asset_root,
                    narration_root=narration_root,
                    artwork_root=artwork_root,
                    backup_manifest_sha256=expected_backup_manifest_sha256,
                    audit_sha256=audit["artifact_sha256"],
                    predecessor_history_sha256=predecessor_history_sha256,
                )
            _write_json_atomic(journal_path, expected_journal, create_only=True)
            try:
                created = _stage_and_promote(
                    prepared,
                    asset_root,
                    expected_journal["destinations"],
                    journal_path=journal_path,
                    journal_document=expected_journal,
                )
                prior_journal = copy.deepcopy(expected_journal)
                expected_journal["state"] = "files_promoted"
                _write_json_atomic(
                    journal_path,
                    expected_journal,
                    create_only=False,
                    expected_prior=prior_journal,
                )
            except Exception:
                connection = _connect(db_path)
                try:
                    connection.execute("BEGIN IMMEDIATE")
                    _remove_unreferenced_created(
                        connection,
                        expected_journal["destinations"],
                        asset_root,
                        packet["assets"]["new"],
                        journal_path=journal_path,
                        journal_document=expected_journal,
                    )
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
                finally:
                    connection.close()
                _retire_json_document(
                    journal_path, expected_journal, label="migration journal"
                )
                raise

        # Asset verification and promotion can be lengthy. Recheck the backup,
        # frozen sources, audit, and path identities at the actual DB action time.
        try:
            _validate_backup(
                backup_manifest_path,
                expected_manifest_sha256=expected_backup_manifest_sha256,
                db_path=db_path,
                asset_root=asset_root,
            )
            if _inode_identity(db_path) != db_identity or _inode_identity(asset_root) != asset_root_identity:
                raise FullBundleMigrationError("database or asset-root identity changed at action time")
            _assert_wal_sidecars_safe(db_path)
            current_packet, current_contract, current_packet_sha256 = _load_exact_packet()
            if (
                current_packet_sha256 != packet_sha256
                or current_packet != packet
                or current_contract != contract
                or _validate_operator_audit(
                    operator_audit_path, packet, contract, packet_sha256
                )
                != audit
            ):
                raise FullBundleMigrationError("frozen migration authority drifted at action time")
            action_identity_inputs = copy.deepcopy(identity_inputs)
            if _lstat_or_none(report_path) is not None:
                action_identity_inputs["existing migration receipt"] = report_path
            _assert_distinct_file_identities(action_identity_inputs)
        except Exception:
            if _lstat_or_none(journal_path) is not None:
                _rollback_pre_database_action_failure(
                    journal_path=journal_path,
                    journal_document=expected_journal,
                    db_path=db_path,
                    asset_root=asset_root,
                    prepared=prepared,
                    packet=packet,
                    backup_snapshot=backup_snapshot,
                    predecessor_history_sha256=predecessor_history_sha256,
                )
            raise
        connection = _connect(db_path)
        try:
            # The integrity read above may itself consume the last seconds of a
            # backup's lifetime. Recheck at the actual lock acquisition edge.
            _assert_backup_fresh(backup_manifest)
        except Exception:
            connection.close()
            if _lstat_or_none(journal_path) is not None:
                _rollback_pre_database_action_failure(
                    journal_path=journal_path,
                    journal_document=expected_journal,
                    db_path=db_path,
                    asset_root=asset_root,
                    prepared=prepared,
                    packet=packet,
                    backup_snapshot=backup_snapshot,
                    predecessor_history_sha256=predecessor_history_sha256,
                )
            raise
        try:
            connection.execute("BEGIN IMMEDIATE")
            # BEGIN IMMEDIATE may wait for another writer. The backup must still
            # be fresh after the write lock is actually held, before any change.
            try:
                _assert_backup_fresh(backup_manifest)
            except Exception:
                connection.rollback()
                connection.close()
                connection = None
                if _lstat_or_none(journal_path) is not None:
                    _rollback_pre_database_action_failure(
                        journal_path=journal_path,
                        journal_document=expected_journal,
                        db_path=db_path,
                        asset_root=asset_root,
                        prepared=prepared,
                        packet=packet,
                        backup_snapshot=backup_snapshot,
                        predecessor_history_sha256=predecessor_history_sha256,
                    )
                raise
            migration_result, inserted, _revision = _apply_database_locked(
                connection,
                packet,
                asset_root=asset_root,
                admin_user_id=admin_user_id,
                backup_snapshot=backup_snapshot,
                journal_destinations=expected_journal["destinations"],
                predecessor_history_sha256=predecessor_history_sha256,
            )
            connection.commit()
            committed = True
        except Exception:
            if connection is not None:
                connection.rollback()
            raise
        finally:
            if connection is not None:
                connection.close()

        prior_journal = copy.deepcopy(expected_journal)
        expected_journal["state"] = "database_committed"
        _write_json_atomic(
            journal_path,
            expected_journal,
            create_only=False,
            expected_prior=prior_journal,
        )
        verify_connection = _connect(db_path)
        try:
            verification_snapshot = _assert_target_state(
                verify_connection,
                packet,
                asset_root,
                backup_rf_snapshot=backup_snapshot,
                expected_predecessor_history_sha256=predecessor_history_sha256,
            )
        finally:
            verify_connection.close()
        verification = _verification_from_snapshot(verification_snapshot)
        report = _report(
            packet,
            packet_sha256,
            target=target,
            backup_manifest=backup_manifest,
            backup_manifest_sha256=expected_backup_manifest_sha256,
            audit=audit,
            migration_result=migration_result,
            inserted_assets=inserted,
            created_files=len(created),
            recovered=recovered,
            verification=verification,
            predecessor_history_sha256=predecessor_history_sha256,
        )
        if _lstat_or_none(report_path) is not None:
            existing_path = _assert_file(report_path, "existing migration receipt")
            existing = _read_json(existing_path, "existing migration receipt")
            _validate_existing_receipt(existing, report)
            _retire_json_document(
                journal_path, expected_journal, label="migration journal"
            )
            return existing
        try:
            _write_json_atomic(report_path, report, create_only=True)
        except Exception:
            # A committed database is never blindly compensated after releasing
            # its write lock. The exact journal is retained for verified replay.
            raise
        _retire_json_document(
            journal_path, expected_journal, label="migration journal"
        )
        return report

    # This branch is unreachable, but retains the safety intent for static audits.
    if not committed:
        raise FullBundleMigrationError("migration did not commit")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", choices=[APPLY_SENTINEL])
    parser.add_argument("--db-path", type=Path)
    parser.add_argument("--asset-root", type=Path)
    parser.add_argument("--remaining-audio-root", type=Path)
    parser.add_argument("--remaining-artwork-root", type=Path)
    parser.add_argument("--backup-manifest", type=Path)
    parser.add_argument("--expected-backup-manifest-sha256")
    parser.add_argument("--operator-audit", type=Path)
    parser.add_argument("--admin-user-id", type=int)
    parser.add_argument("--target-id")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--expected-packet-sha256")
    parser.add_argument("--expected-source-commit")
    parser.add_argument("--expected-source-tree")
    parser.add_argument("--expected-draft-revision", type=int)
    parser.add_argument("--expected-current-manifest-sha256")
    parser.add_argument("--expected-current-profile-sha256")
    parser.add_argument("--expected-validation-metadata-sha256")
    parser.add_argument("--expected-full-base-manifest-sha256")
    parser.add_argument("--expected-terms-policy-sha256")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.apply is None:
        # Supplying mutation-shaped arguments without the sentinel is rejected,
        # rather than silently opening any user path during a dry run.
        supplied = [
            value
            for key, value in vars(args).items()
            if key != "apply" and value is not None
        ]
        if supplied:
            parser.error("live arguments require the exact --apply sentinel")
        print(json.dumps(dry_run(), ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    required = {
        name: getattr(args, name.replace("-", "_"))
        for name in (
            "db-path",
            "asset-root",
            "remaining-audio-root",
            "remaining-artwork-root",
            "backup-manifest",
            "expected-backup-manifest-sha256",
            "operator-audit",
            "admin-user-id",
            "target-id",
            "report",
            "expected-packet-sha256",
            "expected-source-commit",
            "expected-source-tree",
            "expected-draft-revision",
            "expected-current-manifest-sha256",
            "expected-current-profile-sha256",
            "expected-validation-metadata-sha256",
            "expected-full-base-manifest-sha256",
            "expected-terms-policy-sha256",
        )
    }
    missing = [f"--{name}" for name, value in required.items() if value is None]
    if missing:
        parser.error("apply mode requires " + ", ".join(missing))
    report = apply_private(
        apply_confirmation=args.apply,
        db_path=args.db_path,
        asset_root=args.asset_root,
        narration_root=args.remaining_audio_root,
        artwork_root=args.remaining_artwork_root,
        backup_manifest_path=args.backup_manifest,
        expected_backup_manifest_sha256=args.expected_backup_manifest_sha256,
        operator_audit_path=args.operator_audit,
        admin_user_id=args.admin_user_id,
        target_id=args.target_id,
        report_path=args.report,
        expected_packet_sha256=args.expected_packet_sha256,
        expected_source_commit=args.expected_source_commit,
        expected_source_tree=args.expected_source_tree,
        expected_draft_revision=args.expected_draft_revision,
        expected_current_manifest_sha256=args.expected_current_manifest_sha256,
        expected_current_profile_sha256=args.expected_current_profile_sha256,
        expected_validation_metadata_sha256=args.expected_validation_metadata_sha256,
        expected_full_base_manifest_sha256=args.expected_full_base_manifest_sha256,
        expected_terms_policy_sha256=args.expected_terms_policy_sha256,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
