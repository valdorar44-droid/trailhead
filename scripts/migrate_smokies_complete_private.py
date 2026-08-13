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
from contextvars import ContextVar
import ctypes
from dataclasses import dataclass
from datetime import datetime, timezone
import errno
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
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


_PINNED_DIRECTORIES: ContextVar[
    dict[str, tuple[int, tuple[int, int]]]
] = ContextVar("smokies_complete_private_pinned_directories", default={})

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


def _filesystem_identity_sha256(identity: tuple[int, int]) -> str:
    """Bind a runtime inode without serializing raw device or inode values."""
    return _canonical_sha256(
        {"st_dev": int(identity[0]), "st_ino": int(identity[1])}
    )


def _assert_pinned_regular_file_path(
    path: Path,
    descriptor: int,
    expected_identity: tuple[int, int],
    *,
    label: str,
    commit_uncertain: bool = False,
) -> None:
    try:
        held = os.fstat(descriptor)
        lexical = path.lstat()
    except OSError as exc:
        error_type = ReportCommitUncertainError if commit_uncertain else FullBundleMigrationError
        raise error_type(f"{label} identity is unavailable") from exc
    safe = (
        stat.S_ISREG(held.st_mode)
        and held.st_nlink == 1
        and stat.S_ISREG(lexical.st_mode)
        and not stat.S_ISLNK(lexical.st_mode)
        and lexical.st_nlink == 1
        and (int(held.st_dev), int(held.st_ino)) == expected_identity
        and (int(lexical.st_dev), int(lexical.st_ino)) == expected_identity
    )
    if not safe:
        error_type = ReportCommitUncertainError if commit_uncertain else FullBundleMigrationError
        raise error_type(f"{label} identity changed")


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


def _pretty_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def _assert_anchored_parent(
    path: Path, parent_descriptor: int, expected_identity: tuple[int, int], label: str
) -> None:
    try:
        descriptor_info = os.fstat(parent_descriptor)
        lexical_info = path.parent.lstat()
    except OSError as exc:
        raise FullBundleMigrationError(f"{label} parent identity is unavailable") from exc
    if (
        not stat.S_ISDIR(descriptor_info.st_mode)
        or stat.S_ISLNK(lexical_info.st_mode)
        or not stat.S_ISDIR(lexical_info.st_mode)
        or (int(descriptor_info.st_dev), int(descriptor_info.st_ino))
        != expected_identity
        or (int(lexical_info.st_dev), int(lexical_info.st_ino))
        != expected_identity
    ):
        raise FullBundleMigrationError(f"{label} parent identity changed")


@contextmanager
def _pin_directory(
    directory: Path, label: str
) -> Iterator[tuple[int, tuple[int, int]]]:
    if not directory.is_absolute():
        raise FullBundleMigrationError(f"{label} must be absolute")
    flags = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(directory, flags)
    except OSError as exc:
        raise FullBundleMigrationError(f"{label} is unsafe") from exc
    try:
        info = os.fstat(descriptor)
        lexical = directory.lstat()
        identity = (int(info.st_dev), int(info.st_ino))
        if (
            not stat.S_ISDIR(info.st_mode)
            or stat.S_ISLNK(lexical.st_mode)
            or not stat.S_ISDIR(lexical.st_mode)
            or (int(lexical.st_dev), int(lexical.st_ino)) != identity
        ):
            raise FullBundleMigrationError(f"{label} identity changed")
        current = dict(_PINNED_DIRECTORIES.get())
        key = str(directory)
        if key in current:
            raise FullBundleMigrationError(f"{label} is already pinned")
        current[key] = (descriptor, identity)
        token = _PINNED_DIRECTORIES.set(current)
        try:
            yield descriptor, identity
            final = directory.lstat()
            if (
                stat.S_ISLNK(final.st_mode)
                or not stat.S_ISDIR(final.st_mode)
                or (int(final.st_dev), int(final.st_ino)) != identity
                or (int(os.fstat(descriptor).st_dev), int(os.fstat(descriptor).st_ino))
                != identity
            ):
                raise ReportCommitUncertainError(
                    f"{label} retargeted during the migration"
                )
        finally:
            _PINNED_DIRECTORIES.reset(token)
    finally:
        os.close(descriptor)


@contextmanager
def _pin_regular_file(
    path: Path, label: str
) -> Iterator[tuple[int, tuple[int, int]]]:
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise FullBundleMigrationError(f"{label} is unsafe") from exc
    try:
        info = os.fstat(descriptor)
        lexical = path.lstat()
        identity = (int(info.st_dev), int(info.st_ino))
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or stat.S_ISLNK(lexical.st_mode)
            or not stat.S_ISREG(lexical.st_mode)
            or (int(lexical.st_dev), int(lexical.st_ino)) != identity
        ):
            raise FullBundleMigrationError(f"{label} identity changed")
        yield descriptor, identity
        final = path.lstat()
        held = os.fstat(descriptor)
        if (
            stat.S_ISLNK(final.st_mode)
            or not stat.S_ISREG(final.st_mode)
            or (int(final.st_dev), int(final.st_ino)) != identity
            or (int(held.st_dev), int(held.st_ino)) != identity
        ):
            raise ReportCommitUncertainError(
                f"{label} retargeted during the migration"
            )
    finally:
        os.close(descriptor)


@contextmanager
def _open_anchored_parent(
    path: Path, label: str
) -> Iterator[tuple[int, tuple[int, int]]]:
    if not path.is_absolute():
        raise FullBundleMigrationError(f"{label} path must be absolute")
    pinned = _PINNED_DIRECTORIES.get().get(str(path.parent))
    if pinned is not None:
        descriptor = os.dup(pinned[0])
    else:
        flags = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(path.parent, flags)
        except OSError as exc:
            raise FullBundleMigrationError(f"{label} parent is unsafe") from exc
    try:
        info = os.fstat(descriptor)
        identity = (int(info.st_dev), int(info.st_ino))
        _assert_anchored_parent(path, descriptor, identity, label)
        yield descriptor, identity
        _assert_anchored_parent(path, descriptor, identity, label)
    finally:
        os.close(descriptor)


def _read_regular_at(
    parent_descriptor: int, name: str, *, label: str
) -> tuple[bytes, os.stat_result]:
    try:
        first = os.stat(name, dir_fd=parent_descriptor, follow_symlinks=False)
    except OSError as exc:
        raise FullBundleMigrationError(f"{label} is unavailable") from exc
    parent_info = os.fstat(parent_descriptor)
    if (
        stat.S_ISLNK(first.st_mode)
        or not stat.S_ISREG(first.st_mode)
        or first.st_nlink != 1
        or stat.S_IMODE(first.st_mode) != 0o600
        or first.st_uid != os.geteuid()
        or first.st_dev != parent_info.st_dev
    ):
        raise FullBundleMigrationError(f"{label} is not an owned immutable file")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=parent_descriptor)
    except OSError as exc:
        raise FullBundleMigrationError(f"{label} raced before open") from exc
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or stat.S_IMODE(opened.st_mode) != 0o600
            or opened.st_uid != os.geteuid()
            or (opened.st_dev, opened.st_ino) != (first.st_dev, first.st_ino)
        ):
            raise FullBundleMigrationError(f"{label} identity raced")
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            payload = handle.read()
    finally:
        os.close(descriptor)
    current = os.stat(name, dir_fd=parent_descriptor, follow_symlinks=False)
    if (
        current.st_nlink != 1
        or (current.st_dev, current.st_ino) != (first.st_dev, first.st_ino)
    ):
        raise FullBundleMigrationError(f"{label} identity raced after read")
    return payload, current


def _lstat_at_or_none(
    path: Path,
    parent_descriptor: int,
    parent_identity: tuple[int, int],
    *,
    label: str,
) -> os.stat_result | None:
    _assert_anchored_parent(path, parent_descriptor, parent_identity, label)
    try:
        info = os.stat(
            path.name, dir_fd=parent_descriptor, follow_symlinks=False
        )
    except FileNotFoundError:
        info = None
    except OSError as exc:
        raise FullBundleMigrationError(f"{label} identity is unavailable") from exc
    _assert_anchored_parent(path, parent_descriptor, parent_identity, label)
    return info


def _read_json_at(
    path: Path,
    parent_descriptor: int,
    parent_identity: tuple[int, int],
    *,
    label: str,
) -> dict[str, Any]:
    _assert_anchored_parent(path, parent_descriptor, parent_identity, label)
    payload, _info = _read_regular_at(
        parent_descriptor, path.name, label=label
    )
    value = _decode_canonical_json(payload, label=label)
    _assert_anchored_parent(path, parent_descriptor, parent_identity, label)
    return value


def _link_unnamed_file_at(
    source_descriptor: int,
    parent_descriptor: int,
    destination_name: str,
    *,
    label: str,
) -> str:
    """Install an O_TMPFILE inode with Linux's two documented linkat forms."""
    libc = ctypes.CDLL(None, use_errno=True)
    linkat = getattr(libc, "linkat", None)
    if linkat is None:
        raise FullBundleMigrationError(f"{label} linkat is unavailable")
    linkat.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
    ]
    linkat.restype = ctypes.c_int
    destination = os.fsencode(destination_name)
    ctypes.set_errno(0)
    if linkat(source_descriptor, b"", parent_descriptor, destination, 0x1000) == 0:
        return "linkat_at_empty_path"
    direct_error = ctypes.get_errno()
    if direct_error == errno.EEXIST:
        raise FileExistsError(destination_name)
    if direct_error not in {
        errno.EACCES,
        errno.EINVAL,
        errno.ENOENT,
        errno.ENOSYS,
        errno.EOPNOTSUPP,
        errno.EPERM,
    }:
        raise FullBundleMigrationError(
            f"{label} direct anonymous link failed"
        ) from OSError(direct_error, os.strerror(direct_error))
    proc_source = f"/proc/self/fd/{source_descriptor}"
    try:
        source_info = os.fstat(source_descriptor)
        proc_info = os.stat(proc_source, follow_symlinks=True)
    except OSError as exc:
        raise FullBundleMigrationError(
            f"{label} procfd anonymous link source is unavailable"
        ) from exc
    if (source_info.st_dev, source_info.st_ino) != (proc_info.st_dev, proc_info.st_ino):
        raise FullBundleMigrationError(f"{label} procfd anonymous link source drifted")
    ctypes.set_errno(0)
    if linkat(-100, os.fsencode(proc_source), parent_descriptor, destination, 0x400) == 0:
        return "proc_self_fd_linkat_symlink_follow"
    fallback_error = ctypes.get_errno()
    if fallback_error == errno.EEXIST:
        raise FileExistsError(destination_name)
    raise FullBundleMigrationError(
        f"{label} anonymous create-only linking is unsupported"
    ) from OSError(fallback_error, os.strerror(fallback_error))


def _install_immutable_bytes_at(
    path: Path,
    payload: bytes,
    *,
    label: str,
    parent_descriptor: int,
    parent_identity: tuple[int, int],
) -> None:
    """Create one nlink=1 immutable file through one already pinned parent."""
    _assert_anchored_parent(path, parent_descriptor, parent_identity, label)
    try:
        existing, _info = _read_regular_at(
            parent_descriptor, path.name, label=f"existing {label}"
        )
    except FullBundleMigrationError:
        try:
            os.stat(
                path.name,
                dir_fd=parent_descriptor,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            existing = None
        else:
            raise
    if existing is not None:
        if existing != payload:
            raise FullBundleMigrationError(
                f"refusing to replace different immutable {label}"
            )
        try:
            os.fsync(parent_descriptor)
        except OSError as exc:
            raise ReportCommitUncertainError(
                f"existing {label} directory sync was not confirmed"
            ) from exc
        _assert_anchored_parent(path, parent_descriptor, parent_identity, label)
        return
    anonymous_flag = getattr(os, "O_TMPFILE", 0)
    if not anonymous_flag:
        raise FullBundleMigrationError(f"{label} O_TMPFILE is unavailable")
    try:
        descriptor = os.open(
            ".",
            os.O_RDWR | anonymous_flag | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=parent_descriptor,
        )
    except OSError as exc:
        raise FullBundleMigrationError(f"{label} O_TMPFILE is unsupported") from exc
    try:
        os.fchmod(descriptor, 0o600)
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                raise FullBundleMigrationError(f"{label} anonymous write failed")
            offset += written
        os.fsync(descriptor)
        anonymous_info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(anonymous_info.st_mode)
            or anonymous_info.st_nlink != 0
            or stat.S_IMODE(anonymous_info.st_mode) != 0o600
            or anonymous_info.st_uid != os.geteuid()
            or anonymous_info.st_dev != parent_identity[0]
        ):
            raise FullBundleMigrationError(f"{label} anonymous inode is unsafe")
        try:
            _link_unnamed_file_at(
                descriptor,
                parent_descriptor,
                path.name,
                label=label,
            )
        except FileExistsError as exc:
            raise FullBundleMigrationError(
                f"{label} raced at create-only installation"
            ) from exc
        installed_payload, installed_info = _read_regular_at(
            parent_descriptor, path.name, label=f"installed {label}"
        )
        if (
            installed_payload != payload
            or (installed_info.st_dev, installed_info.st_ino)
            != (anonymous_info.st_dev, anonymous_info.st_ino)
            or installed_info.st_nlink != 1
        ):
            raise ReportCommitUncertainError(
                f"{label} installation identity was not confirmed"
            )
        try:
            os.fsync(parent_descriptor)
        except OSError as exc:
            raise ReportCommitUncertainError(
                f"{label} installation sync was not confirmed"
            ) from exc
        _assert_anchored_parent(path, parent_descriptor, parent_identity, label)
    finally:
        os.close(descriptor)


def _install_immutable_bytes(path: Path, payload: bytes, *, label: str) -> None:
    """Create one nlink=1 immutable file with no named temp or overwrite path."""
    with _open_anchored_parent(path, label) as (
        parent_descriptor,
        parent_identity,
    ):
        _install_immutable_bytes_at(
            path,
            payload,
            label=label,
            parent_descriptor=parent_descriptor,
            parent_identity=parent_identity,
        )


def _decode_canonical_json(payload: bytes, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FullBundleMigrationError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict) or _pretty_json_bytes(value) != payload:
        raise FullBundleMigrationError(f"{label} is not canonical JSON")
    return value


JOURNAL_CHAIN_FRAMING = "trailhead-smokies-private-journal-chain-v1"


def _journal_inventory_digest(
    records: list[tuple[str, int, str, bytes]],
) -> tuple[str, int]:
    digest = hashlib.sha256()
    digest.update(JOURNAL_CHAIN_FRAMING.encode("ascii") + b"\x00")
    for kind, sequence, name, payload in records:
        header = _canonical_bytes(
            {"kind": kind, "sequence": sequence, "name": name, "bytes": len(payload)}
        )
        digest.update(len(header).to_bytes(8, "big"))
        digest.update(header)
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return digest.hexdigest(), len(records)


def _journal_terminal_document(
    journal_path: Path,
    *,
    sequence: int,
    head_sha256: str,
    head_document: dict[str, Any],
    ancestry_sha256: str,
    ancestry_entry_count: int,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "kind": "original_full_bundle_private_migration_journal_terminal",
        "journal_file_name": journal_path.name,
        "sequence": sequence,
        "head_sha256": head_sha256,
        "chain_framing": JOURNAL_CHAIN_FRAMING,
        "ancestry_sha256": ancestry_sha256,
        "ancestry_entry_count": ancestry_entry_count,
        "packet_sha256": head_document.get("packet_sha256"),
        "database_inode_identity_sha256": head_document.get(
            "database_inode_identity_sha256"
        ),
        "predecessor_history_sha256": head_document.get(
            "predecessor_history_sha256"
        ),
        "state": head_document.get("state"),
        "terminal_status": (
            "committed_target"
            if head_document.get("state") == "database_committed"
            else "predecessor_recovered"
        ),
    }


def _assert_journal_document_shape(document: dict[str, Any]) -> None:
    expected_keys = {
        "schema_version",
        "packet_id",
        "packet_sha256",
        "target_id",
        "database_path_sha256",
        "database_inode_identity_sha256",
        "asset_root_path_sha256",
        "narration_root_path_sha256",
        "artwork_root_path_sha256",
        "backup_manifest_sha256",
        "operator_audit_sha256",
        "predecessor_history_sha256",
        "expected_before_revision",
        "expected_after_revision",
        "legacy_forbidden_staging_relative_path",
        "state",
        "destinations",
    }
    if set(document) != expected_keys or document.get("schema_version") != 1:
        raise FullBundleMigrationError("migration journal document shape drifted")
    if document.get("packet_id") != packet_builder.PACKET_ID:
        raise FullBundleMigrationError("migration journal packet id drifted")
    for key in (
        "packet_sha256",
        "database_path_sha256",
        "database_inode_identity_sha256",
        "asset_root_path_sha256",
        "narration_root_path_sha256",
        "artwork_root_path_sha256",
        "backup_manifest_sha256",
        "operator_audit_sha256",
        "predecessor_history_sha256",
    ):
        if not isinstance(document.get(key), str) or not re.fullmatch(
            r"[a-f0-9]{64}", document[key]
        ):
            raise FullBundleMigrationError(f"migration journal {key} is invalid")
    if (
        not isinstance(document.get("target_id"), str)
        or not document["target_id"]
        or document.get("legacy_forbidden_staging_relative_path")
        != STAGING_DIR_NAME
        or document.get("state")
        not in {"planned", "files_promoted", "database_committed"}
    ):
        raise FullBundleMigrationError("migration journal fixed fields are invalid")
    for key in ("expected_before_revision", "expected_after_revision"):
        value = document.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise FullBundleMigrationError(f"migration journal {key} is invalid")
    destinations = document.get("destinations")
    if not isinstance(destinations, list) or len(destinations) != 78:
        raise FullBundleMigrationError("migration journal destination count drifted")
    row_keys = {
        "asset_id",
        "relative_path",
        "sha256",
        "bytes",
        "existed_before",
        "ownership_state",
        "preexisting_st_dev",
        "preexisting_st_ino",
        "operator_created_st_dev",
        "operator_created_st_ino",
    }
    asset_ids: set[str] = set()
    for row in destinations:
        if not isinstance(row, dict) or set(row) != row_keys:
            raise FullBundleMigrationError("migration journal destination shape drifted")
        asset_id = row.get("asset_id")
        relative_path = row.get("relative_path")
        sha256 = row.get("sha256")
        byte_count = row.get("bytes")
        if (
            not isinstance(asset_id, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,119}", asset_id)
            or asset_id in asset_ids
            or not isinstance(relative_path, str)
            or Path(relative_path).is_absolute()
            or ".." in Path(relative_path).parts
            or not isinstance(sha256, str)
            or not re.fullmatch(r"[a-f0-9]{64}", sha256)
            or isinstance(byte_count, bool)
            or not isinstance(byte_count, int)
            or byte_count < 1
            or not isinstance(row.get("existed_before"), bool)
        ):
            raise FullBundleMigrationError("migration journal destination is invalid")
        asset_ids.add(asset_id)
        ownership = row.get("ownership_state")
        preexisting = (row.get("preexisting_st_dev"), row.get("preexisting_st_ino"))
        created = (
            row.get("operator_created_st_dev"),
            row.get("operator_created_st_ino"),
        )
        valid_pair = lambda pair: all(
            isinstance(value, int) and not isinstance(value, bool) and value >= 0
            for value in pair
        )
        if ownership == "preexisting":
            valid = row["existed_before"] and valid_pair(preexisting) and created == (None, None)
        elif ownership == "operator_created":
            valid = not row["existed_before"] and preexisting == (None, None) and valid_pair(created)
        elif ownership in {
            "unclaimed",
            "raced_exact",
            "external_collision",
            "external_absent",
        }:
            valid = not row["existed_before"] and preexisting == (None, None) and created == (None, None)
        else:
            valid = False
        if not valid:
            raise FullBundleMigrationError("migration journal ownership proof is invalid")


def _assert_journal_transition(
    prior: dict[str, Any], current: dict[str, Any], *, prior_was_terminal: bool
) -> None:
    _assert_journal_document_shape(prior)
    _assert_journal_document_shape(current)
    if prior.get("state") == "database_committed":
        raise FullBundleMigrationError(
            "migration journal cannot transition after a committed target"
        )
    immutable_top = set(prior) - {"state", "destinations"}
    if prior_was_terminal:
        immutable_top.remove("backup_manifest_sha256")
    for key in immutable_top:
        if current.get(key) != prior.get(key):
            raise FullBundleMigrationError(
                f"migration journal transition changed immutable field {key}"
            )
    prior_rows = prior["destinations"]
    current_rows = current["destinations"]
    static_row_fields = ("asset_id", "relative_path", "sha256", "bytes")
    for prior_row, current_row in zip(prior_rows, current_rows, strict=True):
        if any(current_row[key] != prior_row[key] for key in static_row_fields):
            raise FullBundleMigrationError(
                "migration journal transition changed destination identity"
            )
    if prior_was_terminal:
        if current.get("state") != "planned":
            raise FullBundleMigrationError(
                "migration journal restart must begin in planned state"
            )
        for row in current_rows:
            if row["existed_before"]:
                valid = row["ownership_state"] == "preexisting"
            else:
                valid = row["ownership_state"] == "unclaimed"
            if not valid:
                raise FullBundleMigrationError(
                    "migration journal restart presence snapshot is invalid"
                )
        return
    allowed_states = {
        "planned": {"planned", "files_promoted"},
        "files_promoted": {"files_promoted", "database_committed"},
    }
    if current["state"] not in allowed_states[prior["state"]]:
        raise FullBundleMigrationError("migration journal state transition is invalid")
    changed_rows = [
        (before, after)
        for before, after in zip(prior_rows, current_rows, strict=True)
        if before != after
    ]
    if current["state"] != prior["state"]:
        if changed_rows:
            raise FullBundleMigrationError(
                "migration journal state and ownership changed together"
            )
        return
    if len(changed_rows) != 1:
        raise FullBundleMigrationError(
            "migration journal ownership transition must change one row"
        )
    before, after = changed_rows[0]
    allowed_ownership = {
        "unclaimed": {
            "operator_created",
            "raced_exact",
            "external_collision",
            "external_absent",
        },
        "operator_created": {
            "raced_exact",
            "external_collision",
            "external_absent",
        },
        "raced_exact": {"external_collision", "external_absent"},
        "external_collision": {"raced_exact", "external_absent"},
        "external_absent": {"raced_exact", "external_collision"},
    }
    if after["ownership_state"] not in allowed_ownership.get(
        before["ownership_state"], set()
    ):
        raise FullBundleMigrationError(
            "migration journal ownership transition is invalid"
        )


def _load_journal_chain(journal_path: Path) -> dict[str, Any] | None:
    """Read the retained base/transition/terminal chain under one dirfd."""
    with _open_anchored_parent(journal_path, "migration journal") as (
        parent_descriptor,
        _parent_identity,
    ):
        names = sorted(os.listdir(parent_descriptor))
        prefix = journal_path.name + "."
        related = [name for name in names if name.startswith(prefix)]
        base_present = journal_path.name in names
        if not base_present:
            if related:
                raise FullBundleMigrationError(
                    "orphan migration journal chain entries exist without a base"
                )
            return None
        base_payload, _base_info = _read_regular_at(
            parent_descriptor, journal_path.name, label="migration journal base"
        )
        base_document = _decode_canonical_json(
            base_payload, label="migration journal base"
        )
        _assert_journal_document_shape(base_document)
        transition_pattern = re.compile(
            rf"{re.escape(journal_path.name)}\.transition-"
            rf"([0-9]{{6}})-([a-f0-9]{{64}})-([a-f0-9]{{64}})\.json\Z"
        )
        terminal_pattern = re.compile(
            rf"{re.escape(journal_path.name)}\.terminal-"
            rf"([0-9]{{6}})-([a-f0-9]{{64}})\.json\Z"
        )
        transitions: dict[int, tuple[str, str, str]] = {}
        terminals: dict[int, tuple[str, str]] = {}
        for name in related:
            transition_match = transition_pattern.fullmatch(name)
            terminal_match = terminal_pattern.fullmatch(name)
            if transition_match:
                sequence = int(transition_match.group(1))
                if sequence == 0 or sequence in transitions:
                    raise FullBundleMigrationError(
                        "migration journal transition sequence is duplicated"
                    )
                transitions[sequence] = (
                    name,
                    transition_match.group(2),
                    transition_match.group(3),
                )
            elif terminal_match:
                sequence = int(terminal_match.group(1))
                if sequence in terminals:
                    raise FullBundleMigrationError(
                        "migration journal terminal sequence is duplicated"
                    )
                terminals[sequence] = (name, terminal_match.group(2))
            else:
                raise FullBundleMigrationError(
                    "migration journal chain contains an unknown entry"
                )
        if transitions and sorted(transitions) != list(
            range(1, max(transitions) + 1)
        ):
            raise FullBundleMigrationError("migration journal transition chain has a gap")
        documents: dict[int, dict[str, Any]] = {0: base_document}
        payloads: dict[int, bytes] = {0: base_payload}
        hashes: dict[int, str] = {0: hashlib.sha256(base_payload).hexdigest()}
        for sequence in sorted(transitions):
            name, prior_sha256, claimed_sha256 = transitions[sequence]
            if prior_sha256 != hashes[sequence - 1]:
                raise FullBundleMigrationError(
                    "migration journal transition prior hash drifted"
                )
            payload, _info = _read_regular_at(
                parent_descriptor,
                name,
                label=f"migration journal transition {sequence}",
            )
            actual_sha256 = hashlib.sha256(payload).hexdigest()
            if actual_sha256 != claimed_sha256:
                raise FullBundleMigrationError(
                    "migration journal transition content hash drifted"
                )
            documents[sequence] = _decode_canonical_json(
                payload, label=f"migration journal transition {sequence}"
            )
            _assert_journal_transition(
                documents[sequence - 1],
                documents[sequence],
                prior_was_terminal=(sequence - 1 in terminals),
            )
            payloads[sequence] = payload
            hashes[sequence] = actual_sha256
        maximum_sequence = max(documents)
        terminal_payloads: dict[int, bytes] = {}
        terminal_decoded: dict[int, dict[str, Any]] = {}
        for sequence, (name, claimed_head_sha256) in sorted(terminals.items()):
            if sequence not in documents or claimed_head_sha256 != hashes[sequence]:
                raise FullBundleMigrationError(
                    "migration journal terminal references an unknown head"
                )
            payload, _info = _read_regular_at(
                parent_descriptor,
                name,
                label=f"migration journal terminal {sequence}",
            )
            terminal_payloads[sequence] = payload
            terminal_decoded[sequence] = _decode_canonical_json(
                payload, label=f"migration journal terminal {sequence}"
            )

        inventory: list[tuple[str, int, str, bytes]] = [
            ("base", 0, journal_path.name, base_payload)
        ]
        terminal_documents: dict[int, dict[str, Any]] = {}
        for sequence in range(maximum_sequence + 1):
            if sequence:
                inventory.append(
                    (
                        "transition",
                        sequence,
                        transitions[sequence][0],
                        payloads[sequence],
                    )
                )
            if sequence not in terminals:
                continue
            name, _claimed_head_sha256 = terminals[sequence]
            marker = terminal_decoded[sequence]
            ancestry_sha256, ancestry_entry_count = _journal_inventory_digest(
                inventory
            )
            expected_marker = _journal_terminal_document(
                journal_path,
                sequence=sequence,
                head_sha256=hashes[sequence],
                head_document=documents[sequence],
                ancestry_sha256=ancestry_sha256,
                ancestry_entry_count=ancestry_entry_count,
            )
            if marker != expected_marker:
                raise FullBundleMigrationError(
                    "migration journal terminal binding drifted"
                )
            terminal_documents[sequence] = marker
            inventory.append(
                ("terminal", sequence, name, terminal_payloads[sequence])
            )
        inventory_sha256, inventory_entry_count = _journal_inventory_digest(inventory)
        return {
            "sequence": maximum_sequence,
            "document": documents[maximum_sequence],
            "payload": payloads[maximum_sequence],
            "head_sha256": hashes[maximum_sequence],
            "head_terminal": terminal_documents.get(maximum_sequence),
            "terminals": terminal_documents,
            "inventory_sha256": inventory_sha256,
            "inventory_entry_count": inventory_entry_count,
        }


def _write_json_atomic(
    path: Path,
    value: dict[str, Any],
    *,
    create_only: bool,
    expected_prior: dict[str, Any] | None = None,
) -> None:
    """Create immutable JSON, or append one immutable journal transition."""
    if not path.is_absolute():
        raise FullBundleMigrationError("operator output paths must be absolute")
    if create_only and expected_prior is not None:
        raise FullBundleMigrationError("create-only output cannot have a prior value")
    if not create_only and expected_prior is None:
        raise FullBundleMigrationError(
            "journal transition requires an exact prior value"
        )
    payload = _pretty_json_bytes(value)
    if create_only:
        _install_immutable_bytes(path, payload, label="operator output")
        if path.name == JOURNAL_FILE_NAME:
            chain = _load_journal_chain(path)
            if chain is None or chain["sequence"] != 0 or chain["payload"] != payload:
                raise ReportCommitUncertainError(
                    "migration journal base installation was not confirmed"
                )
        return
    if path.name != JOURNAL_FILE_NAME:
        raise FullBundleMigrationError(
            "only the migration journal supports append-only transitions"
        )
    chain = _load_journal_chain(path)
    if chain is None:
        raise FullBundleMigrationError("migration journal transition has no base")
    prior_payload = _pretty_json_bytes(expected_prior)
    if chain["payload"] != prior_payload:
        raise FullBundleMigrationError(
            "migration journal head differs from its exact prior value"
        )
    if chain["payload"] == payload:
        return
    sequence = int(chain["sequence"]) + 1
    prior_sha256 = str(chain["head_sha256"])
    next_sha256 = hashlib.sha256(payload).hexdigest()
    transition_path = path.with_name(
        f"{path.name}.transition-{sequence:06d}-{prior_sha256}-{next_sha256}.json"
    )
    _install_immutable_bytes(
        transition_path, payload, label="migration journal transition"
    )
    reloaded = _load_journal_chain(path)
    if (
        reloaded is None
        or reloaded["sequence"] != sequence
        or reloaded["payload"] != payload
        or reloaded["head_sha256"] != next_sha256
    ):
        raise ReportCommitUncertainError(
            "migration journal transition installation was not confirmed"
        )


def _retire_json_document(
    path: Path, value: dict[str, Any], *, label: str
) -> None:
    """Append an immutable terminal marker; journal evidence is never deleted."""
    if path.name != JOURNAL_FILE_NAME:
        raise FullBundleMigrationError(f"{label} cannot be retired by this operator")
    chain = _load_journal_chain(path)
    if chain is None or chain["payload"] != _pretty_json_bytes(value):
        raise FullBundleMigrationError(f"{label} head drifted before terminal marker")
    if chain["head_terminal"] is not None:
        return
    marker = _journal_terminal_document(
        path,
        sequence=int(chain["sequence"]),
        head_sha256=str(chain["head_sha256"]),
        head_document=chain["document"],
        ancestry_sha256=str(chain["inventory_sha256"]),
        ancestry_entry_count=int(chain["inventory_entry_count"]),
    )
    terminal_path = path.with_name(
        f"{path.name}.terminal-{int(chain['sequence']):06d}-"
        f"{chain['head_sha256']}.json"
    )
    _install_immutable_bytes(
        terminal_path,
        _pretty_json_bytes(marker),
        label="migration journal terminal",
    )
    reloaded = _load_journal_chain(path)
    if reloaded is None or reloaded["head_terminal"] != marker:
        raise ReportCommitUncertainError(
            f"{label} terminal installation was not confirmed"
        )


def _journal_terminal_binding(path: Path) -> dict[str, Any]:
    chain = _load_journal_chain(path)
    if chain is None or chain["head_terminal"] is None:
        raise FullBundleMigrationError("migration journal head is not terminal")
    sequence = int(chain["sequence"])
    head_sha256 = str(chain["head_sha256"])
    name = f"{path.name}.terminal-{sequence:06d}-{head_sha256}.json"
    marker_payload = _pretty_json_bytes(chain["head_terminal"])
    return {
        "chain_framing": JOURNAL_CHAIN_FRAMING,
        "journal_file_name": path.name,
        "terminal_file_name": name,
        "sequence": sequence,
        "head_sha256": head_sha256,
        "database_inode_identity_sha256": chain["head_terminal"][
            "database_inode_identity_sha256"
        ],
        "ancestry_sha256": chain["head_terminal"]["ancestry_sha256"],
        "ancestry_entry_count": chain["head_terminal"][
            "ancestry_entry_count"
        ],
        "terminal_sha256": hashlib.sha256(marker_payload).hexdigest(),
        "closed_inventory_sha256": chain["inventory_sha256"],
        "closed_inventory_entry_count": chain["inventory_entry_count"],
    }


def _json_create_capability_marker_path(
    parent: Path, *, role: str, packet_sha256: str
) -> Path:
    return parent / (
        f".smokies-complete-private-json-create-capability-v1-"
        f"{role}-{packet_sha256[:16]}.json"
    )


def _ensure_json_create_capability(
    parent: Path, *, role: str, packet_sha256: str
) -> Path:
    """Retain one exact marker proving anonymous create-only support on this parent."""
    info = parent.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise FullBundleMigrationError(f"{role} capability parent is unsafe")
    marker = _json_create_capability_marker_path(
        parent, role=role, packet_sha256=packet_sha256
    )
    value = {
        "schema_version": 1,
        "kind": "original_full_bundle_private_json_create_capability",
        "packet_sha256": packet_sha256,
        "role": role,
        "parent_path_sha256": _path_identity(parent),
        "parent_st_dev": int(info.st_dev),
        "parent_st_ino": int(info.st_ino),
        "contract": "otmpfile_linkat_at_empty_path_or_procfd_symlink_follow_v1",
        "named_temporary_files_used": False,
        "overwrite_permitted": False,
    }
    _install_immutable_bytes(
        marker, _pretty_json_bytes(value), label=f"{role} capability marker"
    )
    return marker


def _ensure_json_create_capability_at(
    parent: Path,
    *,
    role: str,
    packet_sha256: str,
    parent_descriptor: int,
    parent_identity: tuple[int, int],
) -> Path:
    """Retain a capability marker through one already pinned parent dirfd."""
    marker = _json_create_capability_marker_path(
        parent, role=role, packet_sha256=packet_sha256
    )
    _assert_anchored_parent(
        marker, parent_descriptor, parent_identity, f"{role} capability"
    )
    value = {
        "schema_version": 1,
        "kind": "original_full_bundle_private_json_create_capability",
        "packet_sha256": packet_sha256,
        "role": role,
        "parent_path_sha256": _path_identity(parent),
        "parent_st_dev": parent_identity[0],
        "parent_st_ino": parent_identity[1],
        "contract": "otmpfile_linkat_at_empty_path_or_procfd_symlink_follow_v1",
        "named_temporary_files_used": False,
        "overwrite_permitted": False,
    }
    _install_immutable_bytes_at(
        marker,
        _pretty_json_bytes(value),
        label=f"{role} capability marker",
        parent_descriptor=parent_descriptor,
        parent_identity=parent_identity,
    )
    _assert_anchored_parent(
        marker, parent_descriptor, parent_identity, f"{role} capability"
    )
    return marker


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
    closure = packet.get("trusted_complete_validator_source_closure")
    if not isinstance(closure, dict):
        raise FullBundleMigrationError(
            "complete trusted-validator source closure is missing"
        )
    closure_binding = {
        key: closure.get(key)
        for key in ("schema_version", "framing", "path_count", "sha256")
    }
    if contract.get("complete_validator_source_closure") != closure_binding:
        raise FullBundleMigrationError(
            "complete trusted-validator source closure drifted"
        )
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
        "complete_private_candidate_builder": packet["source_bindings"][
            str(packet_builder.CANDIDATE_BUILDER_PATH)
        ],
        "complete_validation_dispatcher": packet["source_bindings"][
            str(packet_builder.COMPLETE_VALIDATION_PATH)
        ],
        "mobile_long_form_validator": packet["source_bindings"][
            str(packet_builder.MOBILE_LONG_FORM_VALIDATOR_PATH)
        ],
        "mobile_long_form_evidence_registry": packet["source_bindings"][
            str(packet_builder.MOBILE_LONG_FORM_EVIDENCE_REGISTRY_PATH)
        ],
        "complete_validator_source_closure": closure_binding,
        "v3_release_guard_audit": packet[
            "v3_release_guard_independent_audit"
        ],
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


def _assert_pinned_database_connection(
    connection: sqlite3.Connection,
    db_path: Path,
    pinned_descriptor: int,
    expected_identity: tuple[int, int],
    *,
    commit_uncertain: bool = False,
) -> None:
    _assert_pinned_regular_file_path(
        db_path,
        pinned_descriptor,
        expected_identity,
        label="configured SQLite database",
        commit_uncertain=commit_uncertain,
    )
    held = os.fstat(pinned_descriptor)
    database_rows = connection.execute("PRAGMA database_list").fetchall()
    main_rows = [row for row in database_rows if str(row[1]) == "main"]
    try:
        opened_path = Path(str(main_rows[0][2])).resolve(strict=True)
        opened_info = opened_path.stat()
    except (IndexError, OSError) as exc:
        error_type = ReportCommitUncertainError if commit_uncertain else FullBundleMigrationError
        raise error_type(
            "pinned SQLite main database identity is unavailable"
        ) from exc
    if (
        (int(held.st_dev), int(held.st_ino)) != expected_identity
        or (int(opened_info.st_dev), int(opened_info.st_ino))
        != expected_identity
    ):
        error_type = ReportCommitUncertainError if commit_uncertain else FullBundleMigrationError
        raise error_type(
            "SQLite connection is not bound to the pinned database inode"
        )


def _connect(
    path: Path,
    *,
    readonly: bool = False,
    pinned_descriptor: int | None = None,
    expected_identity: tuple[int, int] | None = None,
) -> sqlite3.Connection:
    if (pinned_descriptor is None) != (expected_identity is None):
        raise FullBundleMigrationError(
            "database pin descriptor and identity must be supplied together"
        )
    if pinned_descriptor is not None:
        held = os.fstat(pinned_descriptor)
        if (
            not stat.S_ISREG(held.st_mode)
            or held.st_nlink != 1
            or (int(held.st_dev), int(held.st_ino)) != expected_identity
        ):
            raise FullBundleMigrationError("pinned database identity drifted")
        mode = "ro" if readonly else "rw"
        target = f"file:/proc/self/fd/{pinned_descriptor}?mode={mode}"
        connection = sqlite3.connect(target, uri=True, timeout=30)
    elif readonly:
        connection = sqlite3.connect(
            path.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=30
        )
    else:
        connection = sqlite3.connect(str(path), timeout=30)
    if pinned_descriptor is not None:
        try:
            _assert_pinned_database_connection(
                connection, path, pinned_descriptor, expected_identity
            )
        except FullBundleMigrationError:
            connection.close()
            raise
    if readonly:
        connection.execute("PRAGMA query_only=ON")
    else:
        journal_mode = str(connection.execute("PRAGMA journal_mode").fetchone()[0])
        if journal_mode.lower() != "wal":
            connection.close()
            raise FullBundleMigrationError(
                "target database must already use WAL journal mode"
            )
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
    if pinned_descriptor is not None:
        try:
            _assert_pinned_database_connection(
                connection, path, pinned_descriptor, expected_identity
            )
        except FullBundleMigrationError:
            connection.close()
            raise
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
    parent_descriptor: int | None = None,
    parent_identity: tuple[int, int] | None = None,
) -> str | None:
    if kind == "migration journal":
        chain = _load_journal_chain(path)
        if chain is None:
            return None
        payload = chain["document"]
    else:
        if parent_descriptor is None or parent_identity is None:
            raise FullBundleMigrationError(
                "migration receipt requires its pinned parent identity"
            )
        if _lstat_at_or_none(
            path,
            parent_descriptor,
            parent_identity,
            label=f"existing {kind}",
        ) is None:
            return None
        payload = _read_json_at(
            path,
            parent_descriptor,
            parent_identity,
            label=f"existing {kind}",
        )
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
        pinned = _PINNED_DIRECTORIES.get().get(str(asset_root))
        root_descriptor = (
            os.dup(pinned[0]) if pinned is not None else os.open(asset_root, flags)
        )
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
            descriptor = os.open(
                destination.name,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=parent_fd,
            )
        except OSError as exc:
            raise FullBundleMigrationError("asset destination is unavailable") from exc
        try:
            opened = os.fstat(descriptor)
            root_info = asset_root.lstat()
            lexical_info = destination.lstat()
            if (
                not stat.S_ISREG(opened.st_mode)
                or opened.st_nlink != 1
                or stat.S_IMODE(opened.st_mode) != 0o600
                or opened.st_uid != os.geteuid()
                or opened.st_dev != root_info.st_dev
                or stat.S_ISLNK(lexical_info.st_mode)
                or not stat.S_ISREG(lexical_info.st_mode)
                or (opened.st_dev, opened.st_ino)
                != (lexical_info.st_dev, lexical_info.st_ino)
                or opened.st_size != int(spec["bytes"])
                or _sha256_descriptor(descriptor) != spec["sha256"]
            ):
                raise FullBundleMigrationError(
                    "asset destination identity or bytes changed"
                )
            current = os.stat(
                destination.name, dir_fd=parent_fd, follow_symlinks=False
            )
            lexical_after = destination.lstat()
            opened_after = os.fstat(descriptor)
            if (
                opened_after.st_nlink != 1
                or stat.S_IMODE(opened_after.st_mode) != 0o600
                or opened_after.st_uid != os.geteuid()
                or (opened_after.st_dev, opened_after.st_ino)
                != (opened.st_dev, opened.st_ino)
                or (current.st_dev, current.st_ino)
                != (opened.st_dev, opened.st_ino)
                or current.st_nlink != 1
                or stat.S_IMODE(current.st_mode) != 0o600
                or current.st_uid != os.geteuid()
                or (lexical_after.st_dev, lexical_after.st_ino)
                != (opened.st_dev, opened.st_ino)
            ):
                raise FullBundleMigrationError(
                    "asset destination identity raced after verification"
                )
            if entry is not None:
                ownership = entry.get("ownership_state")
                if ownership == "preexisting":
                    expected_identity = (
                        entry.get("preexisting_st_dev"),
                        entry.get("preexisting_st_ino"),
                    )
                elif ownership == "operator_created":
                    expected_identity = (
                        entry.get("operator_created_st_dev"),
                        entry.get("operator_created_st_ino"),
                    )
                else:
                    expected_identity = None
                if expected_identity is not None and expected_identity != (
                    int(opened.st_dev),
                    int(opened.st_ino),
                ):
                    raise FullBundleMigrationError(
                        "asset destination ownership identity drifted"
                    )
        finally:
            os.close(descriptor)
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
    integer_contract = {
        key: permitted.get(key)
        for key in (
            "expected_draft_revision",
            "expected_worker_pid",
            "expected_started_by",
            "expected_started_at",
            "expected_completed_at",
            "expected_selection_result_count",
            "expected_nested_scenario_count",
        )
    }
    if any(
        isinstance(value, bool) or not isinstance(value, int)
        for value in integer_contract.values()
    ):
        raise FullBundleMigrationError(
            "historical validation integer contract drifted"
        )
    hash_contract = {
        key: permitted.get(key)
        for key in (
            "expected_manifest_sha256",
            "expected_assets_sha256",
            "expected_input_sha256",
            "expected_validator_source_sha256",
            "redacted_report_sha256",
        )
    }
    if any(
        not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value)
        for value in hash_contract.values()
    ):
        raise FullBundleMigrationError("historical validation hash contract drifted")
    expected_report = {
        "id": permitted["report_id"],
        "pack_id": packet_builder.PRODUCT_ID,
        "draft_revision": integer_contract["expected_draft_revision"],
        "manifest_sha256": hash_contract["expected_manifest_sha256"],
        "assets_sha256": hash_contract["expected_assets_sha256"],
        "input_sha256": hash_contract["expected_input_sha256"],
        "validator_source_sha256": hash_contract[
            "expected_validator_source_sha256"
        ],
        "suite_version": permitted["expected_suite_version"],
        "engine_version": permitted["engine"],
        "status": permitted["status"],
        "passed": 1,
        "started_by": integer_contract["expected_started_by"],
        "worker_pid": integer_contract["expected_worker_pid"],
        "started_at": integer_contract["expected_started_at"],
        "completed_at": integer_contract["expected_completed_at"],
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
    try:
        redacted_report = store._original_validation_report_from_row(
            report,
            current_material={
                "draft_revision": integer_contract["expected_draft_revision"],
                "manifest_sha256": hash_contract["expected_manifest_sha256"],
                "assets_sha256": hash_contract["expected_assets_sha256"],
                "input_sha256": hash_contract["expected_input_sha256"],
                "validator_source_sha256": hash_contract[
                    "expected_validator_source_sha256"
                ],
            },
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise FullBundleMigrationError(
            "historical validation redacted report drifted"
        ) from exc
    selection_result = scenarios[0] if isinstance(scenarios, list) and scenarios else None
    nested_scenarios = (
        selection_result.get("scenarios")
        if isinstance(selection_result, dict)
        else None
    )
    if (
        _canonical_sha256(report_manifest)
        != hash_contract["expected_manifest_sha256"]
        or issues != permitted["issues"]
        or not isinstance(scenarios, list)
        or len(scenarios)
        != integer_contract["expected_selection_result_count"]
        or not isinstance(selection_result, dict)
        or selection_result.get("selection_key") != permitted["selection"]
        or selection_result.get("passed") is not True
        or selection_result.get("issues") != permitted["issues"]
        or not isinstance(nested_scenarios, list)
        or len(nested_scenarios)
        != integer_contract["expected_nested_scenario_count"]
        or integer_contract["expected_nested_scenario_count"]
        != int(permitted["route_scenarios_required"])
        or integer_contract["expected_nested_scenario_count"]
        != int(permitted["route_scenarios_passed"])
        or _canonical_sha256(redacted_report)
        != hash_contract["redacted_report_sha256"]
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
    database_inode_identity_sha256: str,
) -> dict[str, Any]:
    if not re.fullmatch(r"[a-f0-9]{64}", predecessor_history_sha256):
        raise FullBundleMigrationError("predecessor history binding is invalid")
    if not re.fullmatch(r"[a-f0-9]{64}", database_inode_identity_sha256):
        raise FullBundleMigrationError("database inode identity binding is invalid")
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
        "database_inode_identity_sha256": database_inode_identity_sha256,
        "asset_root_path_sha256": _path_identity(asset_root),
        "narration_root_path_sha256": _path_identity(narration_root),
        "artwork_root_path_sha256": _path_identity(artwork_root),
        "backup_manifest_sha256": backup_manifest_sha256,
        "operator_audit_sha256": audit_sha256,
        "predecessor_history_sha256": predecessor_history_sha256,
        "expected_before_revision": packet["predecessor"]["draft_revision"],
        "expected_after_revision": packet["migration_draft"]["expected_after_revision"],
        "legacy_forbidden_staging_relative_path": STAGING_DIR_NAME,
        "state": "planned",
        "destinations": destinations,
    }


@contextmanager
def _exclusive_lock(asset_root: Path) -> Iterator[None]:
    pinned = _PINNED_DIRECTORIES.get().get(str(asset_root))
    if pinned is None:
        raise FullBundleMigrationError("migration lock requires the pinned asset root")
    descriptor = os.dup(pinned[0])
    identity = pinned[1]
    try:
        held = os.fstat(descriptor)
        if (
            not stat.S_ISDIR(held.st_mode)
            or (int(held.st_dev), int(held.st_ino)) != identity
        ):
            raise FullBundleMigrationError("pinned migration lock identity drifted")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise FullBundleMigrationError(
                "another full-bundle migration is active"
            ) from exc
        try:
            _assert_anchored_parent(
                asset_root / ".migration-lock-anchor",
                descriptor,
                identity,
                "migration lock",
            )
            yield
            _assert_anchored_parent(
                asset_root / ".migration-lock-anchor",
                descriptor,
                identity,
                "migration lock",
            )
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)


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
            "external_absent",
        }:
            raise FullBundleMigrationError("rollback ownership state is invalid")
        current_info = _lstat_or_none(destination)
        if current_info is None:
            if state == "preexisting":
                raise FullBundleMigrationError("preexisting destination disappeared")
            if state != "external_absent":
                prior_document = copy.deepcopy(journal_document)
                entry["ownership_state"] = "external_absent"
                entry["operator_created_st_dev"] = None
                entry["operator_created_st_ino"] = None
                if journal_path is not None and journal_document is not None:
                    _write_json_atomic(
                        journal_path,
                        journal_document,
                        create_only=False,
                        expected_prior=prior_document,
                    )
            continue
        destination = _verified_asset_destination(
            spec, asset_root, entry=entry
        )
        verified_info = destination.lstat()
        exact = (
            verified_info.st_size != int(entry["bytes"])
            or _sha256_path(destination) != entry["sha256"]
        ) is False
        # No pathname is ever deleted during rollback. Exact unreferenced bytes
        # are immutable content-addressed retry material; corrupt or foreign
        # bytes are preserved and stop the operator.
        if not exact:
            prior_document = copy.deepcopy(journal_document)
            if entry["ownership_state"] != "external_collision":
                entry["ownership_state"] = "external_collision"
                entry["operator_created_st_dev"] = None
                entry["operator_created_st_ino"] = None
            if (
                journal_path is not None
                and journal_document is not None
                and prior_document != journal_document
            ):
                _write_json_atomic(
                    journal_path,
                    journal_document,
                    create_only=False,
                    expected_prior=prior_document,
                )
            raise FullBundleMigrationError(
                "rollback preserved an unowned drifted destination"
            )
        if _storage_reference_count(connection, destination) != 0:
            raise FullBundleMigrationError(
                "rollback destination is unexpectedly referenced by the database"
            )
        # Re-open and re-hash after the database-reference query.  Nothing is
        # ever unlinked here, but the journal must not claim an owned/exact
        # destination if another actor replaced the name at that boundary.
        try:
            reverified = _verified_asset_destination(
                spec, asset_root, entry=entry
            )
            reverified_info = reverified.lstat()
            reverified_exact = (
                reverified_info.st_size == int(entry["bytes"])
                and _sha256_path(reverified) == entry["sha256"]
            )
        except FullBundleMigrationError:
            reverified_info = None
            reverified_exact = False
        identity_changed = reverified_info is None or (
            int(reverified_info.st_dev), int(reverified_info.st_ino)
        ) != (int(verified_info.st_dev), int(verified_info.st_ino))
        if identity_changed:
            if state == "preexisting":
                raise FullBundleMigrationError(
                    "preexisting destination identity changed during rollback"
                )
            prior_document = copy.deepcopy(journal_document)
            entry["ownership_state"] = (
                "raced_exact" if reverified_exact else "external_collision"
            )
            entry["operator_created_st_dev"] = None
            entry["operator_created_st_ino"] = None
            if journal_path is not None and journal_document is not None:
                _write_json_atomic(
                    journal_path,
                    journal_document,
                    create_only=False,
                    expected_prior=prior_document,
                )
            if not reverified_exact:
                raise FullBundleMigrationError(
                    "rollback preserved a destination replacement"
                )
            continue
        if state in {"preexisting", "raced_exact"}:
            continue
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
    with _open_anchored_parent(staging, "legacy named staging") as (
        parent_descriptor,
        _parent_identity,
    ):
        try:
            os.stat(
                staging.name,
                dir_fd=parent_descriptor,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            return
        except OSError as exc:
            raise FullBundleMigrationError(
                "legacy named staging identity is unavailable"
            ) from exc
    raise FullBundleMigrationError(
        "legacy named staging exists; no destructive cleanup is permitted"
    )


def _recover_journal(
    journal_path: Path,
    expected_journal: dict[str, Any],
    *,
    db_path: Path,
    asset_root: Path,
    prepared: list[PreparedAsset],
    packet: dict[str, Any],
    backup_snapshot: dict[str, Any],
    db_descriptor: int,
    db_identity: tuple[int, int],
    require_target: bool = False,
) -> str | None:
    chain = _load_journal_chain(journal_path)
    if chain is None:
        staging = asset_root / STAGING_DIR_NAME
        try:
            _clean_staging(staging, prepared)
        except FullBundleMigrationError as exc:
            raise FullBundleMigrationError(
                "orphan staging exists without a journal"
            ) from exc
        return None
    journal = copy.deepcopy(chain["document"])
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
        elif ownership in {
            "unclaimed",
            "raced_exact",
            "external_collision",
            "external_absent",
        }:
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
    connection = _connect(
        db_path,
        pinned_descriptor=db_descriptor,
        expected_identity=db_identity,
    )
    try:
        connection.execute("BEGIN IMMEDIATE")
        _assert_pinned_database_connection(
            connection, db_path, db_descriptor, db_identity
        )
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
            _assert_pinned_database_connection(
                connection, db_path, db_descriptor, db_identity
            )
            connection.commit()
            _assert_pinned_database_connection(
                connection, db_path, db_descriptor, db_identity
            )
            # Carry the exact validated on-disk document forward so the next
            # state transition compares against its real prior bytes.
            expected_journal.clear()
            expected_journal.update(copy.deepcopy(journal))
            return "committed_target_recovered"
        if require_target:
            raise FullBundleMigrationError(
                "existing receipt journal recovery requires the exact target"
            )
        _remove_unreferenced_created(
            connection,
            list(actual_destinations),
            asset_root,
            packet["assets"]["new"],
            journal_path=journal_path,
            journal_document=journal,
        )
        _clean_staging(asset_root / STAGING_DIR_NAME, prepared)
        _assert_pinned_database_connection(
            connection, db_path, db_descriptor, db_identity
        )
        connection.commit()
        _assert_pinned_database_connection(
            connection, db_path, db_descriptor, db_identity
        )
        _retire_json_document(
            journal_path, journal, label="migration journal"
        )
        expected_journal.clear()
        expected_journal.update(copy.deepcopy(journal))
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
    db_descriptor: int,
    db_identity: tuple[int, int],
) -> str:
    connection = _connect(
        db_path,
        pinned_descriptor=db_descriptor,
        expected_identity=db_identity,
    )
    try:
        connection.execute("BEGIN IMMEDIATE")
        _assert_pinned_database_connection(
            connection, db_path, db_descriptor, db_identity
        )
        state, _snapshot = _classify_state(
            connection,
            packet,
            asset_root,
            backup_snapshot=backup_snapshot,
            expected_predecessor_history_sha256=predecessor_history_sha256,
        )
        if state == "target":
            _assert_pinned_database_connection(
                connection, db_path, db_descriptor, db_identity
            )
            connection.commit()
            _assert_pinned_database_connection(
                connection, db_path, db_descriptor, db_identity
            )
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
        _assert_pinned_database_connection(
            connection, db_path, db_descriptor, db_identity
        )
        connection.commit()
        _assert_pinned_database_connection(
            connection, db_path, db_descriptor, db_identity
        )
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    _retire_json_document(
        journal_path, journal_document, label="migration journal"
    )
    return "predecessor_files_rolled_back"


def _sha256_descriptor(descriptor: int) -> str:
    digest = hashlib.sha256()
    original_offset = os.lseek(descriptor, 0, os.SEEK_CUR)
    try:
        os.lseek(descriptor, 0, os.SEEK_SET)
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    finally:
        os.lseek(descriptor, original_offset, os.SEEK_SET)
    return digest.hexdigest()


def _install_asset_create_only(
    item: PreparedAsset, asset_root: Path, destination: Path
) -> os.stat_result:
    """Stream accepted bytes into an anonymous inode and link once, never delete."""
    with _open_asset_destination_parent(
        asset_root, destination, create=True
    ) as parent_descriptor:
        parent_info = os.fstat(parent_descriptor)
        parent_identity = (int(parent_info.st_dev), int(parent_info.st_ino))
        try:
            os.stat(destination.name, dir_fd=parent_descriptor, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise FileExistsError(destination.name)
        anonymous_flag = getattr(os, "O_TMPFILE", 0)
        if not anonymous_flag:
            raise FullBundleMigrationError("asset O_TMPFILE is unavailable")
        try:
            descriptor = os.open(
                ".",
                os.O_RDWR | anonymous_flag | getattr(os, "O_CLOEXEC", 0),
                0o600,
                dir_fd=parent_descriptor,
            )
        except OSError as exc:
            raise FullBundleMigrationError("asset O_TMPFILE is unsupported") from exc
        try:
            os.fchmod(descriptor, 0o600)
            with item.source_path.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    offset = 0
                    while offset < len(chunk):
                        written = os.write(descriptor, chunk[offset:])
                        if written <= 0:
                            raise FullBundleMigrationError(
                                "anonymous asset write failed"
                            )
                        offset += written
            os.fsync(descriptor)
            anonymous_info = os.fstat(descriptor)
            if (
                not stat.S_ISREG(anonymous_info.st_mode)
                or anonymous_info.st_nlink != 0
                or stat.S_IMODE(anonymous_info.st_mode) != 0o600
                or anonymous_info.st_uid != os.geteuid()
                or anonymous_info.st_dev != asset_root.lstat().st_dev
                or anonymous_info.st_size != int(item.spec["bytes"])
                or _sha256_descriptor(descriptor) != item.spec["sha256"]
            ):
                raise FullBundleMigrationError(
                    f"anonymous asset verification failed: {item.spec['asset_id']}"
                )
            _link_unnamed_file_at(
                descriptor,
                parent_descriptor,
                destination.name,
                label=f"asset {item.spec['asset_id']}",
            )
            opened = os.open(
                destination.name,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=parent_descriptor,
            )
            try:
                installed_info = os.fstat(opened)
                if (
                    not stat.S_ISREG(installed_info.st_mode)
                    or installed_info.st_nlink != 1
                    or stat.S_IMODE(installed_info.st_mode) != 0o600
                    or (installed_info.st_dev, installed_info.st_ino)
                    != (anonymous_info.st_dev, anonymous_info.st_ino)
                    or installed_info.st_size != int(item.spec["bytes"])
                    or _sha256_descriptor(opened) != item.spec["sha256"]
                ):
                    raise ReportCommitUncertainError(
                        f"asset installation was not confirmed: {item.spec['asset_id']}"
                    )
            finally:
                os.close(opened)
            try:
                lexical_parent = destination.parent.lstat()
                lexical_file = destination.lstat()
            except OSError as exc:
                raise ReportCommitUncertainError(
                    f"asset destination retargeted: {item.spec['asset_id']}"
                ) from exc
            if (
                stat.S_ISLNK(lexical_parent.st_mode)
                or not stat.S_ISDIR(lexical_parent.st_mode)
                or (int(lexical_parent.st_dev), int(lexical_parent.st_ino))
                != parent_identity
                or stat.S_ISLNK(lexical_file.st_mode)
                or not stat.S_ISREG(lexical_file.st_mode)
                or (int(lexical_file.st_dev), int(lexical_file.st_ino))
                != (int(installed_info.st_dev), int(installed_info.st_ino))
            ):
                raise ReportCommitUncertainError(
                    f"asset destination retargeted: {item.spec['asset_id']}"
                )
            os.fsync(parent_descriptor)
            return installed_info
        finally:
            os.close(descriptor)


def _stage_and_promote(
    prepared: list[PreparedAsset],
    asset_root: Path,
    journal_destinations: list[dict[str, Any]],
    *,
    journal_path: Path,
    journal_document: dict[str, Any],
) -> list[Path]:
    """Create content-addressed destinations directly; retain all exact bytes."""
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
            existing = _verified_asset_destination(item.spec, asset_root, entry=entry)
            info = existing.lstat()
            if (
                entry.get("existed_before") is not True
                or (int(info.st_dev), int(info.st_ino))
                != (entry.get("preexisting_st_dev"), entry.get("preexisting_st_ino"))
                or info.st_size != int(item.spec["bytes"])
                or _sha256_path(existing) != item.spec["sha256"]
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
    required = sum(int(item.spec["bytes"]) for item in pending) + 128 * 1024 * 1024
    if shutil.disk_usage(asset_root).free < required:
        raise FullBundleMigrationError("asset volume lacks safe create-only capacity")
    created: list[Path] = []
    for item in pending:
        entry = entries[str(item.spec["asset_id"])]
        destination = _journal_destination_for_spec(entry, item.spec, asset_root)
        try:
            installed_info = _install_asset_create_only(item, asset_root, destination)
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
            if _lstat_or_none(destination) is not None:
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
            raise
        prior_document = copy.deepcopy(journal_document)
        entry["ownership_state"] = "operator_created"
        entry["operator_created_st_dev"] = int(installed_info.st_dev)
        entry["operator_created_st_ino"] = int(installed_info.st_ino)
        _write_json_atomic(
            journal_path,
            journal_document,
            create_only=False,
            expected_prior=prior_document,
        )
        _verified_asset_destination(item.spec, asset_root, entry=entry)
        created.append(destination)
    return created


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
    journal_terminal: dict[str, Any],
) -> dict[str, Any]:
    draft = packet["migration_draft"]
    attestation = packet["post_migration_phases"]["license_attestation"]
    profile = packet["post_migration_phases"]["narration_profile_cas"]
    identity = {
        "packet_sha256": packet_sha256,
        "target_id": target["id"],
        "database_path_sha256": target["database_path_sha256"],
        "database_inode_identity_sha256": target[
            "database_inode_identity_sha256"
        ],
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
            "database_inode_identity_sha256": target[
                "database_inode_identity_sha256"
            ],
            "profile_present": False,
            "roaring_fork_existing_rows_preserved": True,
            "predecessor_history_sha256": predecessor_history_sha256,
            "journal_terminal": copy.deepcopy(journal_terminal),
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
    with _pin_regular_file(db_path, "database") as (
        db_descriptor,
        pinned_db_identity,
    ):
        if pinned_db_identity != db_identity:
            raise FullBundleMigrationError("database identity changed before pin")
        database_inode_identity_sha256 = _filesystem_identity_sha256(db_identity)
        target = copy.deepcopy(target)
        target["database_inode_identity_sha256"] = database_inode_identity_sha256
        with _pin_directory(asset_root, "asset root") as (
            asset_root_descriptor,
            pinned_asset_root_identity,
        ):
            if pinned_asset_root_identity != asset_root_identity:
                raise FullBundleMigrationError("asset-root identity changed before pin")
            with _open_anchored_parent(report_path, "migration receipt") as (
                report_parent_descriptor,
                report_parent_identity,
            ):
                report_info = _lstat_at_or_none(
                    report_path,
                    report_parent_descriptor,
                    report_parent_identity,
                    label="migration receipt",
                )
                if report_info is not None and (
                    stat.S_ISLNK(report_info.st_mode)
                    or not stat.S_ISREG(report_info.st_mode)
                    or report_info.st_nlink != 1
                    or stat.S_IMODE(report_info.st_mode) != 0o600
                    or report_info.st_uid != os.geteuid()
                ):
                    raise FullBundleMigrationError("existing migration receipt is unsafe")
                asset_capability_marker = _json_create_capability_marker_path(
                    asset_root, role="journal", packet_sha256=packet_sha256
                )
                report_capability_marker = _json_create_capability_marker_path(
                    report_parent, role="receipt", packet_sha256=packet_sha256
                )
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
                    asset_capability_marker,
                    report_capability_marker,
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
                # These retained markers are the fail-closed capability proof. They are
                # created before the lock, staging, journal, database, or receipt can move.
                _ensure_json_create_capability(
                    asset_root, role="journal", packet_sha256=packet_sha256
                )
                _ensure_json_create_capability_at(
                    report_parent,
                    role="receipt",
                    packet_sha256=packet_sha256,
                    parent_descriptor=report_parent_descriptor,
                    parent_identity=report_parent_identity,
                )
                _assert_anchored_parent(
                    report_path,
                    report_parent_descriptor,
                    report_parent_identity,
                    "migration receipt",
                )

                journal_path = asset_root / JOURNAL_FILE_NAME
                created: list[Path] = []
                inserted = 0
                committed = False
                migration_result = "not_started"
                recovered: str | None = None
                with _exclusive_lock(asset_root):
                    _assert_anchored_parent(
                        report_path,
                        report_parent_descriptor,
                        report_parent_identity,
                        "migration receipt",
                    )
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
                        parent_descriptor=report_parent_descriptor,
                        parent_identity=report_parent_identity,
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
                        database_inode_identity_sha256=database_inode_identity_sha256,
                    )

                    if _lstat_at_or_none(
                        report_path,
                        report_parent_descriptor,
                        report_parent_identity,
                        label="existing migration receipt",
                    ) is not None:
                        report_state_connection = _connect(
                            db_path,
                            pinned_descriptor=db_descriptor,
                            expected_identity=db_identity,
                        )
                        try:
                            report_state_connection.execute("BEGIN IMMEDIATE")
                            _assert_pinned_database_connection(
                                report_state_connection,
                                db_path,
                                db_descriptor,
                                db_identity,
                            )
                            report_state, _report_snapshot = _classify_state(
                                report_state_connection,
                                packet,
                                asset_root,
                                backup_snapshot=backup_snapshot,
                                expected_predecessor_history_sha256=(
                                    predecessor_history_sha256
                                ),
                            )
                            _assert_pinned_database_connection(
                                report_state_connection,
                                db_path,
                                db_descriptor,
                                db_identity,
                            )
                            report_state_connection.commit()
                            _assert_pinned_database_connection(
                                report_state_connection,
                                db_path,
                                db_descriptor,
                                db_identity,
                                commit_uncertain=True,
                            )
                        except Exception:
                            report_state_connection.rollback()
                            raise
                        finally:
                            report_state_connection.close()
                        if report_state != "target":
                            raise FullBundleMigrationError(
                                "an existing receipt cannot authorize a predecessor migration"
                            )
                        _assert_pinned_regular_file_path(
                            db_path,
                            db_descriptor,
                            db_identity,
                            label="configured SQLite database before existing receipt read",
                            commit_uncertain=True,
                        )
                        existing_receipt = _read_json_at(
                            report_path,
                            report_parent_descriptor,
                            report_parent_identity,
                            label="existing migration receipt",
                        )
                        existing_chain = _load_journal_chain(journal_path)
                        if (
                            existing_chain is None
                            or existing_chain["document"].get("state") != "database_committed"
                            or existing_chain["head_terminal"] is None
                        ):
                            raise FullBundleMigrationError(
                                "existing receipt requires an exact terminal journal head"
                            )
                        existing_terminal = _journal_terminal_binding(journal_path)
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
                            journal_terminal=existing_terminal,
                        )
                        _validate_existing_receipt(existing_receipt, expected_receipt)
                        receipt_journal_recovery = _recover_journal(
                            journal_path,
                            expected_journal,
                            db_path=db_path,
                            asset_root=asset_root,
                            prepared=prepared,
                            packet=packet,
                            backup_snapshot=backup_snapshot,
                            db_descriptor=db_descriptor,
                            db_identity=db_identity,
                            require_target=True,
                        )
                        if receipt_journal_recovery != "committed_target_recovered":
                            raise FullBundleMigrationError(
                                "existing receipt journal recovery contradicted target state"
                            )
                        if _journal_terminal_binding(journal_path) != existing_terminal:
                            raise FullBundleMigrationError(
                                "existing receipt journal terminal changed during recovery"
                            )
                        _assert_anchored_parent(
                            report_path,
                            report_parent_descriptor,
                            report_parent_identity,
                            "existing migration receipt",
                        )
                        _assert_pinned_regular_file_path(
                            db_path,
                            db_descriptor,
                            db_identity,
                            label="configured SQLite database before existing receipt return",
                            commit_uncertain=True,
                        )
                        return existing_receipt
                    recovered = _recover_journal(
                        journal_path,
                        expected_journal,
                        db_path=db_path,
                        asset_root=asset_root,
                        prepared=prepared,
                        packet=packet,
                        backup_snapshot=backup_snapshot,
                        db_descriptor=db_descriptor,
                        db_identity=db_identity,
                    )
                    if recovered != "committed_target_recovered":
                        if recovered == "partial_files_rolled_back":
                            # Recovery may have removed files created by the interrupted run;
                            # rebuild the presence flags before starting the new run.
                            recovered_head = copy.deepcopy(expected_journal)
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
                                database_inode_identity_sha256=database_inode_identity_sha256,
                            )
                            _write_json_atomic(
                                journal_path,
                                expected_journal,
                                create_only=False,
                                expected_prior=recovered_head,
                            )
                        else:
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
                            connection = _connect(
                                db_path,
                                pinned_descriptor=db_descriptor,
                                expected_identity=db_identity,
                            )
                            try:
                                connection.execute("BEGIN IMMEDIATE")
                                _assert_pinned_database_connection(
                                    connection,
                                    db_path,
                                    db_descriptor,
                                    db_identity,
                                )
                                _remove_unreferenced_created(
                                    connection,
                                    expected_journal["destinations"],
                                    asset_root,
                                    packet["assets"]["new"],
                                    journal_path=journal_path,
                                    journal_document=expected_journal,
                                )
                                _assert_pinned_database_connection(
                                    connection,
                                    db_path,
                                    db_descriptor,
                                    db_identity,
                                )
                                connection.commit()
                                _assert_pinned_database_connection(
                                    connection,
                                    db_path,
                                    db_descriptor,
                                    db_identity,
                                    commit_uncertain=True,
                                )
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
                        if _lstat_at_or_none(
                            report_path,
                            report_parent_descriptor,
                            report_parent_identity,
                            label="migration receipt action edge",
                        ) is not None:
                            action_identity_inputs["existing migration receipt"] = report_path
                        _assert_distinct_file_identities(action_identity_inputs)
                        _assert_anchored_parent(
                            report_path,
                            report_parent_descriptor,
                            report_parent_identity,
                            "migration receipt action edge",
                        )
                    except Exception:
                        if _load_journal_chain(journal_path) is not None:
                            _rollback_pre_database_action_failure(
                                journal_path=journal_path,
                                journal_document=expected_journal,
                                db_path=db_path,
                                asset_root=asset_root,
                                prepared=prepared,
                                packet=packet,
                                backup_snapshot=backup_snapshot,
                                predecessor_history_sha256=predecessor_history_sha256,
                                db_descriptor=db_descriptor,
                                db_identity=db_identity,
                            )
                        raise
                    connection = _connect(
                        db_path,
                        pinned_descriptor=db_descriptor,
                        expected_identity=db_identity,
                    )
                    _assert_pinned_regular_file_path(
                        db_path,
                        db_descriptor,
                        db_identity,
                        label="configured SQLite database before write lock",
                    )
                    try:
                        # The integrity read above may itself consume the last seconds of a
                        # backup's lifetime. Recheck at the actual lock acquisition edge.
                        _assert_backup_fresh(backup_manifest)
                    except Exception:
                        connection.close()
                        if _load_journal_chain(journal_path) is not None:
                            _rollback_pre_database_action_failure(
                                journal_path=journal_path,
                                journal_document=expected_journal,
                                db_path=db_path,
                                asset_root=asset_root,
                                prepared=prepared,
                                packet=packet,
                                backup_snapshot=backup_snapshot,
                                predecessor_history_sha256=predecessor_history_sha256,
                                db_descriptor=db_descriptor,
                                db_identity=db_identity,
                            )
                        raise
                    try:
                        connection.execute("BEGIN IMMEDIATE")
                        _assert_pinned_database_connection(
                            connection, db_path, db_descriptor, db_identity
                        )
                        _assert_anchored_parent(
                            report_path,
                            report_parent_descriptor,
                            report_parent_identity,
                            "migration receipt database edge",
                        )
                        # BEGIN IMMEDIATE may wait for another writer. The backup must still
                        # be fresh after the write lock is actually held, before any change.
                        try:
                            _assert_backup_fresh(backup_manifest)
                        except Exception:
                            connection.rollback()
                            connection.close()
                            connection = None
                            if _load_journal_chain(journal_path) is not None:
                                _rollback_pre_database_action_failure(
                                    journal_path=journal_path,
                                    journal_document=expected_journal,
                                    db_path=db_path,
                                    asset_root=asset_root,
                                    prepared=prepared,
                                    packet=packet,
                                    backup_snapshot=backup_snapshot,
                                    predecessor_history_sha256=predecessor_history_sha256,
                                    db_descriptor=db_descriptor,
                                    db_identity=db_identity,
                                )
                            raise
                        _assert_pinned_database_connection(
                            connection, db_path, db_descriptor, db_identity
                        )
                        migration_result, inserted, _revision = _apply_database_locked(
                            connection,
                            packet,
                            asset_root=asset_root,
                            admin_user_id=admin_user_id,
                            backup_snapshot=backup_snapshot,
                            journal_destinations=expected_journal["destinations"],
                            predecessor_history_sha256=predecessor_history_sha256,
                        )
                        _assert_pinned_database_connection(
                            connection, db_path, db_descriptor, db_identity
                        )
                        connection.commit()
                        committed = True
                        _assert_pinned_database_connection(
                            connection, db_path, db_descriptor, db_identity,
                            commit_uncertain=True,
                        )
                    except Exception:
                        if connection is not None:
                            connection.rollback()
                        raise
                    finally:
                        if connection is not None:
                            connection.close()

                    _assert_pinned_regular_file_path(
                        db_path,
                        db_descriptor,
                        db_identity,
                        label="configured SQLite database after commit",
                        commit_uncertain=True,
                    )
                    prior_journal = copy.deepcopy(expected_journal)
                    expected_journal["state"] = "database_committed"
                    _write_json_atomic(
                        journal_path,
                        expected_journal,
                        create_only=False,
                        expected_prior=prior_journal,
                    )
                    _assert_pinned_regular_file_path(
                        db_path,
                        db_descriptor,
                        db_identity,
                        label="configured SQLite database after commit journal",
                        commit_uncertain=True,
                    )
                    verify_connection = _connect(
                        db_path,
                        pinned_descriptor=db_descriptor,
                        expected_identity=db_identity,
                    )
                    try:
                        verification_snapshot = _assert_target_state(
                            verify_connection,
                            packet,
                            asset_root,
                            backup_rf_snapshot=backup_snapshot,
                            expected_predecessor_history_sha256=predecessor_history_sha256,
                        )
                        _assert_pinned_database_connection(
                            verify_connection, db_path, db_descriptor, db_identity,
                            commit_uncertain=True,
                        )
                    finally:
                        verify_connection.close()
                    verification = _verification_from_snapshot(verification_snapshot)
                    _assert_pinned_regular_file_path(
                        db_path,
                        db_descriptor,
                        db_identity,
                        label="configured SQLite database before journal terminal",
                        commit_uncertain=True,
                    )
                    _retire_json_document(
                        journal_path, expected_journal, label="migration journal"
                    )
                    journal_terminal = _journal_terminal_binding(journal_path)
                    _assert_pinned_regular_file_path(
                        db_path,
                        db_descriptor,
                        db_identity,
                        label="configured SQLite database after journal terminal",
                        commit_uncertain=True,
                    )
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
                        journal_terminal=journal_terminal,
                    )
                    if _lstat_at_or_none(
                        report_path,
                        report_parent_descriptor,
                        report_parent_identity,
                        label="migration receipt commit edge",
                    ) is not None:
                        _assert_pinned_regular_file_path(
                            db_path,
                            db_descriptor,
                            db_identity,
                            label="configured SQLite database before receipt read",
                            commit_uncertain=True,
                        )
                        existing = _read_json_at(
                            report_path,
                            report_parent_descriptor,
                            report_parent_identity,
                            label="existing migration receipt",
                        )
                        _validate_existing_receipt(existing, report)
                        _assert_anchored_parent(
                            report_path,
                            report_parent_descriptor,
                            report_parent_identity,
                            "existing migration receipt return",
                        )
                        _assert_pinned_regular_file_path(
                            db_path,
                            db_descriptor,
                            db_identity,
                            label="configured SQLite database before receipt return",
                            commit_uncertain=True,
                        )
                        return existing
                    _assert_pinned_regular_file_path(
                        db_path,
                        db_descriptor,
                        db_identity,
                        label="configured SQLite database before receipt install",
                        commit_uncertain=True,
                    )
                    try:
                        _install_immutable_bytes_at(
                            report_path,
                            _pretty_json_bytes(report),
                            label="migration receipt",
                            parent_descriptor=report_parent_descriptor,
                            parent_identity=report_parent_identity,
                        )
                    except Exception:
                        # A committed database is never blindly compensated after releasing
                        # its write lock. The exact journal is retained for verified replay.
                        raise
                    _assert_pinned_regular_file_path(
                        db_path,
                        db_descriptor,
                        db_identity,
                        label="configured SQLite database after receipt install",
                        commit_uncertain=True,
                    )
                    installed_report = _read_json_at(
                        report_path,
                        report_parent_descriptor,
                        report_parent_identity,
                        label="installed migration receipt",
                    )
                    _validate_existing_receipt(installed_report, report)
                    _assert_anchored_parent(
                        report_path,
                        report_parent_descriptor,
                        report_parent_identity,
                        "installed migration receipt return",
                    )
                    _assert_pinned_regular_file_path(
                        db_path,
                        db_descriptor,
                        db_identity,
                        label="configured SQLite database before success return",
                        commit_uncertain=True,
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
