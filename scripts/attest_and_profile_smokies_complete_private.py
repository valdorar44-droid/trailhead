#!/usr/bin/env python3
"""Guarded, restartable post-migration attestation/profile operator.

The default invocation is a database-free and network-free locked dry run.
Live execution consumes a fresh private observation of the four official
ElevenLabs policies; it never contacts ElevenLabs, renders media, validates,
deploys, or publishes.  Each completed narration gets a create-only private
journal record so a retry resumes only work still missing from the database.
"""

from __future__ import annotations

import argparse
import copy
import ctypes
import errno
import hashlib
import json
import os
import re
import sqlite3
import stat
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import store  # noqa: E402


PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
TARGET_ID = "railway.trailhead.production.private"
APPLY_SENTINEL = "ATTEST_AND_PROFILE_PRIVATE_SMOKIES_FULL_BUNDLE"
PROFILE_TEMPLATE_PATH = ROOT / "originals/smokies/smokies_pack_narration_profile_v2.json"
RECEIPT_NAME = "smokies_full_bundle_post_migration_profile_receipt_v1.json"
JOURNAL_HEADER_NAME = "000000-header-v1.json"
MAX_TERMS_OBSERVATION_AGE_SECONDS = 900


class SmokiesPostMigrationError(ValueError):
    """A fail-closed post-migration condition was not proven."""


class SmokiesPostMigrationCommitUncertain(SmokiesPostMigrationError):
    """A durable record was linked but its final state could not be proven."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def path_identity(path: Path) -> str:
    return hashlib.sha256(str(path).encode("utf-8")).hexdigest()


def filesystem_identity_sha256(identity: tuple[int, int]) -> str:
    return canonical_sha256({"st_dev": identity[0], "st_ino": identity[1]})


def admin_identity_sha256(admin_user_id: int) -> str:
    return canonical_sha256({"admin_user_id": admin_user_id})


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SmokiesPostMigrationError(message)


def _json_object(payload: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SmokiesPostMigrationError(f"{label} is invalid JSON") from exc
    _require(isinstance(value, dict), f"{label} must contain an object")
    return value


def _parse_utc(value: object, label: str) -> datetime:
    raw = str(value or "")
    try:
        parsed = datetime.fromisoformat(
            raw[:-1] + "+00:00" if raw.endswith("Z") else raw
        )
    except ValueError as exc:
        raise SmokiesPostMigrationError(f"{label} is not ISO-8601") from exc
    _require(parsed.tzinfo is not None, f"{label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _canonical_utc_seconds(value: object, label: str) -> str:
    parsed = _parse_utc(value, label)
    canonical = parsed.isoformat(timespec="seconds").replace("+00:00", "Z")
    _require(str(value) == canonical, f"{label} is not canonical UTC seconds")
    return canonical


def _outside_repo(path: Path, label: str, *, must_exist: bool = True) -> Path:
    _require(path.is_absolute(), f"{label} must be absolute")
    lexical = Path(os.path.abspath(path))
    try:
        lexical.relative_to(ROOT)
    except ValueError:
        pass
    else:
        raise SmokiesPostMigrationError(f"{label} must stay outside the repository")
    if must_exist:
        try:
            resolved = lexical.resolve(strict=True)
        except OSError as exc:
            raise SmokiesPostMigrationError(f"{label} is unavailable") from exc
        _require(resolved == lexical, f"{label} must not traverse symlinks")
    else:
        try:
            resolved_parent = lexical.parent.resolve(strict=True)
        except OSError as exc:
            raise SmokiesPostMigrationError(f"{label} parent is unavailable") from exc
        _require(
            resolved_parent == lexical.parent,
            f"{label} parent must not traverse symlinks",
        )
    return lexical


def _assert_pinned_file(
    path: Path, descriptor: int, identity: tuple[int, int], label: str
) -> None:
    try:
        held = os.fstat(descriptor)
        lexical = path.lstat()
    except OSError as exc:
        raise SmokiesPostMigrationCommitUncertain(
            f"{label} identity is unavailable"
        ) from exc
    safe = (
        stat.S_ISREG(held.st_mode)
        and held.st_nlink == 1
        and not stat.S_ISLNK(lexical.st_mode)
        and stat.S_ISREG(lexical.st_mode)
        and lexical.st_nlink == 1
        and (int(held.st_dev), int(held.st_ino)) == identity
        and (int(lexical.st_dev), int(lexical.st_ino)) == identity
    )
    if not safe:
        raise SmokiesPostMigrationCommitUncertain(f"{label} identity changed")


@contextmanager
def _pinned_file(
    path: Path,
    label: str,
    *,
    private: bool,
    writable: bool = False,
    read_payload: bool = True,
) -> Iterator[tuple[int, tuple[int, int], bytes]]:
    try:
        before = path.lstat()
    except OSError as exc:
        raise SmokiesPostMigrationError(f"{label} is unavailable") from exc
    safe = (
        not stat.S_ISLNK(before.st_mode)
        and stat.S_ISREG(before.st_mode)
        and before.st_nlink == 1
        and (not private or stat.S_IMODE(before.st_mode) == 0o600)
        and (not private or before.st_uid == os.geteuid())
    )
    _require(safe, f"{label} is not a safe immutable file")
    flags = (os.O_RDWR if writable else os.O_RDONLY) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise SmokiesPostMigrationError(f"{label} raced before open") from exc
    try:
        opened = os.fstat(descriptor)
        identity = (int(opened.st_dev), int(opened.st_ino))
        _require(
            identity == (int(before.st_dev), int(before.st_ino)),
            f"{label} identity changed",
        )
        payload = b""
        if read_payload:
            parts: list[bytes] = []
            while True:
                chunk = os.read(descriptor, 1024 * 1024)
                if not chunk:
                    break
                parts.append(chunk)
            payload = b"".join(parts)
            os.lseek(descriptor, 0, os.SEEK_SET)
        yield descriptor, identity, payload
        _assert_pinned_file(path, descriptor, identity, label)
    finally:
        os.close(descriptor)


def _assert_pinned_directory(
    path: Path,
    descriptor: int,
    identity: tuple[int, int],
    label: str,
    *,
    private: bool,
) -> None:
    try:
        held = os.fstat(descriptor)
        lexical = path.lstat()
    except OSError as exc:
        raise SmokiesPostMigrationCommitUncertain(
            f"{label} identity is unavailable"
        ) from exc
    safe = (
        stat.S_ISDIR(held.st_mode)
        and not stat.S_ISLNK(lexical.st_mode)
        and stat.S_ISDIR(lexical.st_mode)
        and (int(held.st_dev), int(held.st_ino)) == identity
        and (int(lexical.st_dev), int(lexical.st_ino)) == identity
        and (not private or stat.S_IMODE(held.st_mode) == 0o700)
        and (not private or stat.S_IMODE(lexical.st_mode) == 0o700)
        and (not private or held.st_uid == os.geteuid())
        and (not private or lexical.st_uid == os.geteuid())
    )
    if not safe:
        raise SmokiesPostMigrationCommitUncertain(f"{label} identity changed")


@contextmanager
def _pinned_directory(
    path: Path, label: str, *, private: bool
) -> Iterator[tuple[int, tuple[int, int]]]:
    try:
        before = path.lstat()
    except OSError as exc:
        raise SmokiesPostMigrationError(f"{label} is unavailable") from exc
    safe = (
        not stat.S_ISLNK(before.st_mode)
        and stat.S_ISDIR(before.st_mode)
        and (not private or stat.S_IMODE(before.st_mode) == 0o700)
        and (not private or before.st_uid == os.geteuid())
    )
    _require(safe, f"{label} is unsafe")
    descriptor = os.open(
        path,
        os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        opened = os.fstat(descriptor)
        identity = (int(opened.st_dev), int(opened.st_ino))
        _require(
            identity == (int(before.st_dev), int(before.st_ino)),
            f"{label} identity changed",
        )
        yield descriptor, identity
        _assert_pinned_directory(
            path, descriptor, identity, label, private=private
        )
    finally:
        os.close(descriptor)


def _link_unnamed(source_fd: int, parent_fd: int, name: str, label: str) -> None:
    linkat = getattr(ctypes.CDLL(None, use_errno=True), "linkat", None)
    if linkat is None:
        raise SmokiesPostMigrationError(f"{label} linkat is unavailable")
    linkat.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
    ]
    linkat.restype = ctypes.c_int
    destination = os.fsencode(name)
    ctypes.set_errno(0)
    if linkat(source_fd, b"", parent_fd, destination, 0x1000) == 0:
        return
    direct_error = ctypes.get_errno()
    if direct_error == errno.EEXIST:
        raise FileExistsError(name)
    allowed = {
        errno.EACCES,
        errno.EINVAL,
        errno.ENOENT,
        errno.ENOSYS,
        errno.EOPNOTSUPP,
        errno.EPERM,
    }
    if direct_error not in allowed:
        raise SmokiesPostMigrationError(f"{label} anonymous link failed")
    proc_source = f"/proc/self/fd/{source_fd}"
    try:
        direct = os.fstat(source_fd)
        proc = os.stat(proc_source, follow_symlinks=True)
    except OSError as exc:
        raise SmokiesPostMigrationError(
            f"{label} procfd source is unavailable"
        ) from exc
    _require(
        (direct.st_dev, direct.st_ino) == (proc.st_dev, proc.st_ino),
        f"{label} procfd source drifted",
    )
    ctypes.set_errno(0)
    if linkat(-100, os.fsencode(proc_source), parent_fd, destination, 0x400) == 0:
        return
    fallback_error = ctypes.get_errno()
    if fallback_error == errno.EEXIST:
        raise FileExistsError(name)
    raise SmokiesPostMigrationError(
        f"{label} anonymous create-only linking is unsupported"
    ) from OSError(fallback_error, os.strerror(fallback_error))


def _read_record(parent_fd: int, name: str, label: str) -> bytes | None:
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=parent_fd,
        )
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise SmokiesPostMigrationError(f"{label} could not be opened") from exc
    try:
        info = os.fstat(descriptor)
        _require(
            stat.S_ISREG(info.st_mode)
            and info.st_nlink == 1
            and stat.S_IMODE(info.st_mode) == 0o600
            and info.st_uid == os.geteuid(),
            f"{label} is not immutable private evidence",
        )
        parts: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            parts.append(chunk)
        return b"".join(parts)
    finally:
        os.close(descriptor)


def _install_record(
    parent_fd: int, name: str, document: dict[str, Any], label: str
) -> bool:
    payload = canonical_bytes(document)
    existing = _read_record(parent_fd, name, f"existing {label}")
    if existing is not None:
        _require(existing == payload, f"existing {label} conflicts")
        return True
    anonymous = getattr(os, "O_TMPFILE", 0)
    _require(bool(anonymous), f"{label} O_TMPFILE is unavailable")
    try:
        descriptor = os.open(
            ".",
            os.O_RDWR | anonymous | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=parent_fd,
        )
    except OSError as exc:
        raise SmokiesPostMigrationError(f"{label} O_TMPFILE is unsupported") from exc
    try:
        os.fchmod(descriptor, 0o600)
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            _require(written > 0, f"{label} anonymous write failed")
            offset += written
        os.fsync(descriptor)
        anonymous_info = os.fstat(descriptor)
        parent_info = os.fstat(parent_fd)
        _require(
            stat.S_ISREG(anonymous_info.st_mode)
            and anonymous_info.st_nlink == 0
            and stat.S_IMODE(anonymous_info.st_mode) == 0o600
            and anonymous_info.st_uid == os.geteuid()
            and anonymous_info.st_dev == parent_info.st_dev,
            f"{label} anonymous inode is unsafe",
        )
        try:
            _link_unnamed(descriptor, parent_fd, name, label)
        except FileExistsError:
            raced = _read_record(parent_fd, name, f"raced {label}")
            _require(raced == payload, f"{label} raced with conflicting evidence")
            return True
        os.fsync(parent_fd)
        if _read_record(parent_fd, name, f"installed {label}") != payload:
            raise SmokiesPostMigrationCommitUncertain(
                f"{label} installation was not confirmed"
            )
        return False
    finally:
        os.close(descriptor)


def _asset_record_name(asset_id: str) -> str:
    _require(
        bool(re.fullmatch(r"[a-z0-9_]{3,120}", asset_id)),
        "asset id is not canonical",
    )
    return f"asset-{asset_id}.json"


class PrivateJournal:
    def __init__(self, path: Path, descriptor: int, identity: tuple[int, int]):
        self.path = path
        self.descriptor = descriptor
        self.identity = identity

    def _assert(self) -> None:
        _assert_pinned_directory(
            self.path,
            self.descriptor,
            self.identity,
            "private journal directory",
            private=True,
        )

    def header(self) -> dict[str, Any] | None:
        payload = _read_record(
            self.descriptor, JOURNAL_HEADER_NAME, "journal header"
        )
        return None if payload is None else _json_object(payload, "journal header")

    def ensure_header(self, document: dict[str, Any]) -> bool:
        self._assert()
        result = _install_record(
            self.descriptor, JOURNAL_HEADER_NAME, document, "journal header"
        )
        self._assert()
        return result

    def record_terms(self, document: dict[str, Any]) -> bool:
        name = f"terms-{document['observation_sha256'][:24]}.json"
        self._assert()
        result = _install_record(
            self.descriptor, name, document, "terms observation journal record"
        )
        self._assert()
        return result

    def asset(self, asset_id: str) -> dict[str, Any] | None:
        payload = _read_record(
            self.descriptor,
            _asset_record_name(asset_id),
            f"journal record for {asset_id}",
        )
        return (
            None
            if payload is None
            else _json_object(payload, f"journal record for {asset_id}")
        )

    def record_asset(self, document: dict[str, Any]) -> bool:
        asset_id = str(document["asset_id"])
        self._assert()
        result = _install_record(
            self.descriptor,
            _asset_record_name(asset_id),
            document,
            f"journal record for {asset_id}",
        )
        self._assert()
        return result

    def record_profile(self, document: dict[str, Any]) -> bool:
        self._assert()
        result = _install_record(
            self.descriptor,
            "profile-cas-v1.json",
            document,
            "profile CAS journal record",
        )
        self._assert()
        return result

    def binding(self) -> dict[str, Any]:
        self._assert()
        try:
            names = sorted(os.listdir(self.descriptor))
        except OSError as exc:
            raise SmokiesPostMigrationError("private journal cannot be enumerated") from exc
        rows: list[dict[str, Any]] = []
        pattern = re.compile(
            r"(?:000000-header-v1|terms-[a-f0-9]{24}|"
            r"asset-[a-z0-9_]{3,120}|profile-cas-v1)\.json"
        )
        for name in names:
            _require(bool(pattern.fullmatch(name)), "private journal has an unexpected record")
            payload = _read_record(self.descriptor, name, f"journal record {name}")
            _require(payload is not None, "private journal record disappeared")
            rows.append(
                {
                    "name": name,
                    "byte_count": len(payload),
                    "sha256": sha256_bytes(payload),
                }
            )
        _require(
            any(row["name"] == JOURNAL_HEADER_NAME for row in rows),
            "journal header is missing",
        )
        return {"record_count": len(rows), "records_sha256": canonical_sha256(rows)}


class PrivateReceipt:
    def __init__(self, path: Path, descriptor: int, identity: tuple[int, int]):
        self.path = path
        self.descriptor = descriptor
        self.identity = identity

    def install(self, document: dict[str, Any]) -> dict[str, Any]:
        _assert_pinned_directory(
            self.path.parent,
            self.descriptor,
            self.identity,
            "private receipt directory",
            private=True,
        )
        replayed = _install_record(
            self.descriptor, self.path.name, document, "post-migration receipt"
        )
        payload = _read_record(
            self.descriptor, self.path.name, "post-migration receipt"
        )
        _require(payload == canonical_bytes(document), "post-migration receipt drifted")
        return {
            "replayed": replayed,
            "receipt_sha256": sha256_bytes(payload),
            "receipt_byte_count": len(payload),
        }


def dry_run() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "status": "dry_run_live_apply_locked",
        "product_id": PRODUCT_ID,
        "expected_before_revision": 3,
        "expected_after_revision": 4,
        "sentinel_required": APPLY_SENTINEL,
        "database_accessed": False,
        "database_mutated": False,
        "external_private_evidence_accessed": False,
        "external_private_evidence_mutated": False,
        "network_accessed": False,
        "provider_accessed": False,
        "provider_requests_sent": 0,
        "provider_credits_spent": 0,
        "media_rerendered": False,
        "trusted_validation_performed": False,
        "deployment_performed": False,
        "publication_performed": False,
        "writes_performed": False,
    }


def _validate_packet(
    packet: dict[str, Any], packet_sha256: str, args: argparse.Namespace
) -> None:
    _require(packet_sha256 == args.expected_packet_sha256, "migration packet sha256 drifted")
    _require(packet.get("schema_version") == 1, "migration packet schema drifted")
    _require(
        packet.get("kind") == "original_full_bundle_private_migration_packet",
        "migration packet kind drifted",
    )
    _require(packet.get("product_id") == PRODUCT_ID, "migration packet product drifted")
    _require(
        packet.get("status") == "network_and_database_free_plan_live_apply_locked",
        "migration packet status drifted",
    )
    _require(
        packet.get("source_revision")
        == {
            "commit": args.expected_source_commit,
            "tree": args.expected_source_tree,
        },
        "migration source revision drifted",
    )
    terms = packet["post_migration_phases"]["license_attestation"]
    profile = packet["post_migration_phases"]["narration_profile_cas"]
    _require(
        terms.get("asset_count") == 72
        and terms.get("expected_draft_revision") == 3,
        "attestation phase drifted",
    )
    _require(
        profile.get("expected_before_revision") == 3
        and profile.get("expected_after_revision") == 4,
        "profile CAS revisions drifted",
    )
    actual = {
        "new narration map": canonical_sha256(terms["asset_sha256"]),
        "all asset map": canonical_sha256(profile["expected_asset_sha256"]),
        "base manifest": profile["expected_base_manifest_sha256"],
        "validation metadata": profile["expected_validation_metadata_sha256"],
        "terms policy": terms["terms_policy_sha256"],
    }
    supplied = {
        "new narration map": args.expected_new_narration_map_sha256,
        "all asset map": args.expected_asset_map_sha256,
        "base manifest": args.expected_base_manifest_sha256,
        "validation metadata": args.expected_validation_metadata_sha256,
        "terms policy": args.expected_terms_policy_sha256,
    }
    drift = sorted(key for key in actual if actual[key] != supplied[key])
    _require(not drift, "explicit packet expectations drifted: " + ", ".join(drift))


def _validate_audit(
    audit: dict[str, Any], payload: bytes, packet_sha256: str, args: argparse.Namespace
) -> dict[str, Any]:
    audit_sha = sha256_bytes(payload)
    _require(audit_sha == args.expected_audit_sha256, "migration audit sha256 drifted")
    _require(audit.get("schema_version") == 1, "migration audit schema drifted")
    _require(
        audit.get("kind") == "original_private_migration_operator_audit"
        and audit.get("status") == "independent_audit_passed"
        and audit.get("live_apply_reviewed") is True,
        "migration audit status drifted",
    )
    _require(audit.get("product_id") == PRODUCT_ID, "migration audit product drifted")
    findings = audit.get("findings")
    _require(
        isinstance(findings, dict)
        and findings.get("p0_count") == 0
        and findings.get("p1_count") == 0
        and findings.get("author_source_files_edited_by_auditor") == 0,
        "migration audit findings drifted",
    )
    bindings = audit.get("bindings")
    _require(isinstance(bindings, dict), "migration audit bindings are missing")
    _require(
        bindings.get("migration_packet", {}).get("sha256") == packet_sha256,
        "migration audit packet binding drifted",
    )
    bindings_sha = canonical_sha256(bindings)
    _require(
        bindings_sha == args.expected_audit_bindings_sha256,
        "migration audit bindings sha256 drifted",
    )
    return {
        "sha256": audit_sha,
        "byte_count": len(payload),
        "bindings_sha256": bindings_sha,
    }


def _validate_migration_receipt(
    receipt: dict[str, Any],
    payload: bytes,
    packet: dict[str, Any],
    packet_sha256: str,
    db_path: Path,
    db_identity: tuple[int, int],
    asset_root: Path,
    args: argparse.Namespace,
) -> dict[str, Any]:
    receipt_sha = sha256_bytes(payload)
    _require(
        receipt_sha == args.expected_migration_receipt_sha256,
        "private migration receipt sha256 drifted",
    )
    _require(receipt.get("schema_version") == 1, "migration receipt schema drifted")
    _require(
        receipt.get("kind") == "original_full_bundle_private_migration_receipt"
        and receipt.get("status") == "verified_configured_private_migration",
        "migration receipt status drifted",
    )
    _require(receipt.get("packet_sha256") == packet_sha256, "migration receipt packet drifted")
    _require(
        receipt.get("source_revision") == packet["source_revision"],
        "migration receipt source drifted",
    )
    target = receipt.get("target")
    _require(isinstance(target, dict), "migration receipt target is missing")
    _require(target.get("id") == args.target_id == TARGET_ID, "private target id drifted")
    _require(
        target.get("database_path_sha256") == path_identity(db_path),
        "database path binding drifted",
    )
    _require(
        target.get("asset_root_path_sha256") == path_identity(asset_root),
        "asset root binding drifted",
    )
    _require(
        target.get("database_inode_identity_sha256")
        == filesystem_identity_sha256(db_identity),
        "database inode binding drifted",
    )
    configured = packet.get("configured_target_binding")
    _require(
        configured
        == {
            "target_id": TARGET_ID,
            "database_path_sha256": path_identity(db_path),
            "asset_root_path_sha256": path_identity(asset_root),
            "raw_database_or_asset_root_path_serialized": False,
        },
        "migration packet configured-target binding drifted",
    )
    migration = receipt.get("migration")
    expected = {
        "before_revision": 2,
        "after_revision": 3,
        "committed_asset_count": 98,
        "committed_narration_count": 85,
        "committed_image_count": 13,
        "profile_present": False,
        "roaring_fork_existing_rows_preserved": True,
        "published_version_count": 0,
    }
    _require(
        isinstance(migration, dict)
        and all(migration.get(key) == value for key, value in expected.items()),
        "private migration result drifted",
    )
    _require(
        bool(
            re.fullmatch(
                r"[a-f0-9]{64}",
                str(migration.get("predecessor_history_sha256") or ""),
            )
        ),
        "private migration predecessor-history binding is missing",
    )
    effects = receipt.get("effects")
    _require(
        isinstance(effects, dict)
        and effects.get("attestations_written") == 0
        and effects.get("narration_profile_applied") is False
        and effects.get("trusted_validation_performed") is False
        and effects.get("publication_performed") is False,
        "migration receipt effects drifted",
    )
    return {
        "receipt_id": receipt.get("receipt_id"),
        "sha256": receipt_sha,
        "byte_count": len(payload),
        "predecessor_history_sha256": migration.get(
            "predecessor_history_sha256"
        ),
    }


def _validate_terms_observation(
    document: dict[str, Any],
    payload: bytes,
    packet: dict[str, Any],
    expected_sha256: str,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    observation_sha = sha256_bytes(payload)
    _require(observation_sha == expected_sha256, "terms observation sha256 drifted")
    _require(document.get("schema_version") == 1, "terms observation schema drifted")
    _require(
        document.get("kind") == "elevenlabs_official_terms_observation"
        and document.get("status") == "verified_exact_policy_tuple",
        "terms observation status drifted",
    )
    _require(document.get("product_id") == PRODUCT_ID, "terms observation product drifted")
    _require(
        document.get("source") == "official_public_terms_read_only"
        and document.get("verified_live") is True,
        "terms observation is not a live official readback",
    )
    phase = packet["post_migration_phases"]["license_attestation"]
    policy = document.get("full_non_eea_policy_tuple")
    _require(policy == phase["full_non_eea_policy_tuple"], "fresh official terms drifted")
    _require(
        canonical_sha256({"jurisdiction": "non_eea", "policy_tuple": policy})
        == phase["terms_policy_sha256"],
        "fresh official terms hash drifted",
    )
    _require(
        document.get("effects")
        == {
            "account_mutated": False,
            "provider_api_accessed": False,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
            "purchase_submitted": False,
        },
        "terms observation effects drifted",
    )
    observed_at = _parse_utc(document.get("observed_at"), "terms observed_at")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    age = (current - observed_at).total_seconds()
    _require(age >= -30, "terms observation is in the future")
    _require(
        age <= MAX_TERMS_OBSERVATION_AGE_SECONDS,
        "terms observation is stale; reverify all four official policies",
    )
    return {
        "sha256": observation_sha,
        "byte_count": len(payload),
        "observed_at": str(document["observed_at"]),
    }


def _decode_column(value: object, label: str) -> dict[str, Any]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError) as exc:
        raise SmokiesPostMigrationError(f"{label} is invalid JSON") from exc
    _require(isinstance(decoded, dict), f"{label} must contain an object")
    return decoded


def _attestation(row: dict[str, Any]) -> dict[str, Any] | None:
    metadata = _decode_column(row.get("generator_metadata_json"), "generator metadata")
    status = metadata.get("license_status")
    evidence = metadata.get("license_attestation")
    if status in {None, "unverified"} and evidence is None:
        return None
    _require(
        status == "attested" and isinstance(evidence, dict),
        "license attestation is incomplete",
    )
    return copy.deepcopy(evidence)


def _verify_attestation(
    evidence: dict[str, Any],
    terms: dict[str, Any],
    admin_user_id: int,
    label: str,
) -> dict[str, str]:
    _require(isinstance(evidence, dict), f"{label} is missing")
    for key, expected in terms.items():
        _require(evidence.get(key) == expected, f"{label} terms drifted")
    _require(
        evidence.get("attested_by_admin_user_id") == admin_user_id,
        f"{label} attesting admin drifted",
    )
    timestamp = _canonical_utc_seconds(
        evidence.get("attested_at"), f"{label} attested_at"
    )
    return {
        "attested_at": timestamp,
        "redacted_license_attestation_sha256": (
            store.original_redacted_license_attestation_sha256(evidence)
        ),
    }


def _verify_asset_file(row: dict[str, Any], asset_root: Path) -> None:
    path = Path(str(row.get("storage_path") or ""))
    _require(path.is_absolute(), f"asset {row.get('asset_id')} path is not absolute")
    try:
        resolved = path.resolve(strict=True)
        _require(
            resolved == path,
            f"asset {row.get('asset_id')} path traverses a symlink or alias",
        )
        resolved.relative_to(asset_root)
        info = resolved.lstat()
    except (OSError, ValueError) as exc:
        raise SmokiesPostMigrationError(
            f"asset {row.get('asset_id')} escapes the configured root"
        ) from exc
    _require(
        not stat.S_ISLNK(info.st_mode)
        and stat.S_ISREG(info.st_mode)
        and info.st_nlink == 1,
        f"asset {row.get('asset_id')} inode is unsafe",
    )
    _require(
        info.st_size == int(row.get("byte_count") or -1),
        f"asset {row.get('asset_id')} byte count drifted",
    )
    _require(
        sha256_path(resolved) == row.get("sha256"),
        f"asset {row.get('asset_id')} bytes drifted",
    )


def _query_live_state(
    connection: sqlite3.Connection,
    packet: dict[str, Any],
    asset_root: Path,
    admin_user_id: int,
    expected_predecessor_history_sha256: str,
    *,
    verify_files: bool,
) -> dict[str, Any]:
    connection.row_factory = sqlite3.Row
    pack_row = connection.execute(
        "SELECT * FROM authored_trip_packs WHERE id=? AND content_kind='original_drive'",
        (PRODUCT_ID,),
    ).fetchone()
    _require(pack_row is not None, "private Smokies draft is missing")
    pack = dict(pack_row)
    _require(
        pack.get("status") == "draft"
        and pack.get("current_published_version") is None,
        "private Smokies publication state drifted",
    )
    draft = packet["migration_draft"]
    expected_pack_projection = {
        "slug": draft["slug"],
        "draft_title": draft["title"],
        "draft_summary": draft["summary"],
        "draft_price_credits": draft["price_credits"],
        "draft_coverage_region": draft["coverage_region"],
        "draft_public_metadata": draft["public_metadata_json"],
        "draft_template_json": draft["template_json"],
    }
    _require(
        all(pack.get(key) == value for key, value in expected_pack_projection.items()),
        "private Smokies committed content projection drifted",
    )
    revision = int(pack["draft_revision"])
    _require(revision in {3, 4}, "private draft revision is not resumable")
    rows = [
        dict(row)
        for row in connection.execute(
            """SELECT * FROM authored_original_assets
               WHERE pack_id=? AND is_current=1 ORDER BY asset_id""",
            (PRODUCT_ID,),
        ).fetchall()
    ]
    total_asset_rows = int(
        connection.execute(
            "SELECT COUNT(*) FROM authored_original_assets WHERE pack_id=?",
            (PRODUCT_ID,),
        ).fetchone()[0]
    )
    phase = packet["post_migration_phases"]["narration_profile_cas"]
    asset_map = {str(row["asset_id"]): str(row["sha256"]) for row in rows}
    _require(
        total_asset_rows == len(rows) == 98
        and asset_map == phase["expected_asset_sha256"],
        "current 98-asset set drifted",
    )
    counts = {"narration": 0, "image": 0}
    for row in rows:
        kind = str(row.get("kind"))
        _require(kind in counts, "current asset kind drifted")
        counts[kind] += 1
        if verify_files:
            _verify_asset_file(row, asset_root)
    _require(counts == {"narration": 85, "image": 13}, "asset counts drifted")
    for table, label in (
        ("authored_trip_pack_versions", "published versions"),
        ("authored_original_release_authorizations_v1", "release authorizations"),
    ):
        count = int(
            connection.execute(
                f"SELECT COUNT(*) FROM {table} WHERE pack_id=?", (PRODUCT_ID,)
            ).fetchone()[0]
        )
        _require(count == 0, f"{label} must remain zero")

    reports = [
        dict(row)
        for row in connection.execute(
            """SELECT * FROM authored_original_validation_reports
               WHERE pack_id=? ORDER BY id""",
            (PRODUCT_ID,),
        ).fetchall()
    ]
    permitted = packet["predecessor"]["permitted_validation_history"]
    _require(
        len(reports) == permitted.get("expected_report_count") == 1,
        "historical validation report membership drifted",
    )
    try:
        historical_inventory = store._smokies_historical_validation_inventory(
            reports, permitted
        )
    except store.OriginalSmokiesFinalReadinessConflictError as exc:
        raise SmokiesPostMigrationError(
            "historical validation report inventory drifted"
        ) from exc
    _require(
        historical_inventory.get("historical_report_count") == 1
        and historical_inventory.get("full_bundle_report_count") == 0
        and isinstance(historical_inventory.get("inventory"), list)
        and len(historical_inventory["inventory"]) == 1
        and re.fullmatch(
            r"[a-f0-9]{64}",
            str(historical_inventory.get("inventory_sha256") or ""),
        )
        is not None,
        "historical validation report canonical inventory drifted",
    )

    manifest = _decode_column(pack.get("draft_original_manifest_json"), "draft manifest")
    _require(manifest.get("schema_version") == 3, "draft manifest schema drifted")
    validation = _decode_column(
        pack.get("draft_validation_metadata"), "draft validation metadata"
    )
    base = copy.deepcopy(manifest)
    profile = base.pop("narration_profile", None)
    _require(
        store._original_validation_hash(base) == phase["expected_base_manifest_sha256"],
        "profile-absent manifest drifted",
    )
    if revision == 3:
        _require(profile is None, "profile is already present at revision 3")
        _require(
            store._original_validation_hash(validation)
            == phase["expected_validation_metadata_sha256"],
            "revision-3 validation metadata drifted",
        )
        _require(
            validation.get("admin_license_attestation_complete") is not True
            and validation.get("verified_private_upload_complete") is not True,
            "profile flags are asserted before the CAS",
        )
    else:
        _require(isinstance(profile, dict), "revision-4 profile is missing")
        expected_after_validation = copy.deepcopy(draft["validation_metadata"])
        expected_after_validation["admin_license_attestation_complete"] = True
        expected_after_validation["verified_private_upload_complete"] = True
        _require(
            validation.get("admin_license_attestation_complete") is True
            and validation.get("verified_private_upload_complete") is True,
            "revision-4 profile flags are incomplete",
        )
        _require(
            validation == expected_after_validation,
            "revision-4 validation metadata changed outside the profile flags",
        )
    for key in (
        "authenticated_device_preview_complete",
        "trusted_publication_validation_complete",
        "public_release",
    ):
        _require(validation.get(key) is not True, f"downstream gate {key} is asserted")

    new_map = packet["post_migration_phases"]["license_attestation"]["asset_sha256"]
    narration_rows = {
        str(row["asset_id"]): row for row in rows if row["kind"] == "narration"
    }
    rf_ids = sorted(set(narration_rows) - set(new_map))
    _require(len(rf_ids) == 13, "Roaring Fork narration membership drifted")
    terms = packet["post_migration_phases"]["license_attestation"]["terms_tuple"]
    redacted: dict[str, str] = {}
    timestamps: dict[str, str] = {}
    missing: list[str] = []
    for asset_id in sorted(narration_rows):
        evidence = _attestation(narration_rows[asset_id])
        if evidence is None:
            _require(
                asset_id in new_map and revision == 3,
                f"preserved narration {asset_id} lost its attestation",
            )
            missing.append(asset_id)
            continue
        verified = _verify_attestation(
            evidence, terms, admin_user_id, f"narration {asset_id}"
        )
        timestamps[asset_id] = verified["attested_at"]
        redacted[asset_id] = verified["redacted_license_attestation_sha256"]
    latest = max(timestamps.values()) if timestamps else None
    if revision == 4:
        _require(not missing and len(redacted) == 85, "revision-4 attestations are incomplete")
        _require(
            profile["commercial_license"]["verified_at"] == latest,
            "profile verified_at is not the latest server attestation",
        )
    rf_material = [
        {
            "asset_id": asset_id,
            "sha256": narration_rows[asset_id]["sha256"],
            "generator_metadata": _decode_column(
                narration_rows[asset_id]["generator_metadata_json"],
                f"Roaring Fork metadata {asset_id}",
            ),
        }
        for asset_id in rf_ids
    ]
    narration_map = {key: asset_map[key] for key in sorted(narration_rows)}
    historical_asset_ids = set(packet["predecessor"]["existing_asset_sha256"])
    historical_asset_rows = sorted(
        [copy.deepcopy(row) for row in rows if str(row["asset_id"]) in historical_asset_ids],
        key=lambda row: (str(row["asset_id"]), str(row["sha256"])),
    )
    _require(
        len(historical_asset_rows) == len(historical_asset_ids) == 20,
        "historical Roaring Fork asset-row membership drifted",
    )
    predecessor_history = {
        "schema_version": 1,
        "pack_immutable_history": {
            "id": pack.get("id"),
            "created_by": pack.get("created_by"),
            "created_at": pack.get("created_at"),
        },
        "roaring_fork_asset_rows": historical_asset_rows,
        "validation_reports": copy.deepcopy(reports),
        "published_versions": [],
        "release_authorizations": [],
    }
    predecessor_history_sha256 = canonical_sha256(predecessor_history)
    _require(
        predecessor_history_sha256 == expected_predecessor_history_sha256,
        "migration-bound predecessor history drifted",
    )
    return {
        "revision": revision,
        "manifest": manifest,
        "manifest_sha256": store._original_validation_hash(manifest),
        "base_manifest_sha256": store._original_validation_hash(base),
        "profile": profile,
        "profile_sha256": (
            store._original_validation_hash(profile) if profile is not None else None
        ),
        "validation": validation,
        "validation_sha256": store._original_validation_hash(validation),
        "asset_map": asset_map,
        "asset_map_sha256": canonical_sha256(asset_map),
        "narration_map": narration_map,
        "narration_map_sha256": canonical_sha256(narration_map),
        "redacted_attestation_map": redacted,
        "redacted_attestation_map_sha256": (
            canonical_sha256(redacted) if len(redacted) == 85 else None
        ),
        "attested_at": timestamps,
        "latest_attested_at": latest,
        "unattested_new": sorted(missing),
        "new_ids": sorted(new_map),
        "rf_ids": rf_ids,
        "rf_metadata_sha256": canonical_sha256(rf_material),
        "historical_report_id": permitted["report_id"],
        "historical_report_redacted_sha256": permitted["redacted_report_sha256"],
        "historical_report_row_sha256": canonical_sha256(historical),
        "historical_report_inventory_sha256": historical_inventory[
            "inventory_sha256"
        ],
        "historical_report_count": 1,
        "current_full_bundle_report_count": 0,
        "predecessor_history_sha256": predecessor_history_sha256,
    }


class DatabaseAdapter:
    def __init__(
        self,
        db_path: Path,
        db_descriptor: int,
        db_identity: tuple[int, int],
        packet: dict[str, Any],
        asset_root: Path,
        admin_user_id: int,
        expected_predecessor_history_sha256: str,
    ):
        self.db_path = db_path
        self.db_descriptor = db_descriptor
        self.db_identity = db_identity
        self.packet = packet
        self.asset_root = asset_root
        self.admin_user_id = admin_user_id
        self.expected_predecessor_history_sha256 = (
            expected_predecessor_history_sha256
        )
        self.original_store_connector = store._conn

    def assert_database(self) -> None:
        _assert_pinned_file(
            self.db_path,
            self.db_descriptor,
            self.db_identity,
            "configured SQLite database",
        )

    def connect(self) -> sqlite3.Connection:
        self.assert_database()
        connection = sqlite3.connect(
            f"file:/proc/self/fd/{self.db_descriptor}?mode=rw",
            uri=True,
            check_same_thread=False,
            timeout=30.0,
        )
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
        connection.row_factory = sqlite3.Row
        main = [
            row
            for row in connection.execute("PRAGMA database_list").fetchall()
            if str(row[1]) == "main"
        ]
        try:
            opened = Path(str(main[0][2])).stat()
        except (IndexError, OSError) as exc:
            connection.close()
            raise SmokiesPostMigrationError(
                "pinned SQLite main database is unavailable"
            ) from exc
        if (int(opened.st_dev), int(opened.st_ino)) != self.db_identity:
            connection.close()
            raise SmokiesPostMigrationError(
                "SQLite connection is not pinned to the target inode"
            )
        return connection

    @contextmanager
    def bind_store(self) -> Iterator[None]:
        store._conn = self.connect
        try:
            yield
        finally:
            store._conn = self.original_store_connector

    def inspect(self, *, verify_files: bool) -> dict[str, Any]:
        connection = self.connect()
        try:
            return _query_live_state(
                connection,
                self.packet,
                self.asset_root,
                self.admin_user_id,
                self.expected_predecessor_history_sha256,
                verify_files=verify_files,
            )
        finally:
            connection.close()
            self.assert_database()

    def attest(
        self, asset_id: str, expected_sha256: str, terms: dict[str, Any]
    ) -> dict[str, Any]:
        with self.bind_store():
            result = store.attest_authored_original_generator_license(
                PRODUCT_ID,
                asset_id,
                expected_sha256=expected_sha256,
                expected_draft_revision=3,
                terms_id=terms["terms_id"],
                terms_url=terms["terms_url"],
                terms_version=terms["terms_version"],
                reviewed_at=terms["reviewed_at"],
                admin_user_id=self.admin_user_id,
            )
        self.assert_database()
        return result

    def apply_profile(
        self, profile: dict[str, Any], redacted: dict[str, str]
    ) -> dict[str, Any]:
        phase = self.packet["post_migration_phases"]["narration_profile_cas"]
        with self.bind_store():
            result = store.apply_authored_original_narration_profile_v2(
                PRODUCT_ID,
                expected_draft_revision=3,
                expected_base_manifest_sha256=phase["expected_base_manifest_sha256"],
                expected_validation_metadata_sha256=phase[
                    "expected_validation_metadata_sha256"
                ],
                expected_asset_sha256=phase["expected_asset_sha256"],
                expected_redacted_license_attestation_sha256=redacted,
                narration_profile=profile,
                admin_user_id=self.admin_user_id,
            )
        self.assert_database()
        return result


def _materialize_profile(
    template: dict[str, Any], packet: dict[str, Any], latest: str
) -> dict[str, Any]:
    expected = packet["post_migration_phases"]["narration_profile_cas"][
        "profile_materialization"
    ]["settings_template"]
    _require(template == expected, "profile template content drifted")
    profile = copy.deepcopy(template)
    profile["commercial_license"]["verified_at"] = latest
    check = copy.deepcopy(profile)
    check["commercial_license"]["verified_at"] = template["commercial_license"][
        "verified_at"
    ]
    _require(check == template, "profile materialization changed a static field")
    return profile


def _asset_journal_document(
    asset_id: str,
    asset_sha256: str,
    attested_at: str,
    redacted_sha256: str,
    terms_policy_sha256: str,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "kind": "smokies_narration_attestation_journal_record",
        "status": "server_attestation_verified",
        "product_id": PRODUCT_ID,
        "asset_id": asset_id,
        "asset_sha256": asset_sha256,
        "server_attested_at": attested_at,
        "redacted_license_attestation_sha256": redacted_sha256,
        "terms_policy_sha256": terms_policy_sha256,
    }


@dataclass(frozen=True)
class ExecutionBindings:
    packet_sha256: str
    packet_byte_count: int
    audit: dict[str, Any]
    migration_receipt: dict[str, Any]
    terms_observation: dict[str, Any]
    profile_template_sha256: str
    profile_template_byte_count: int
    source_revision: dict[str, str]
    target: dict[str, Any]
    admin_sha256: str


def _receipt_document(
    bindings: ExecutionBindings,
    initial_rf_sha256: str,
    initial_report_row_sha256: str,
    initial_report_inventory_sha256: str,
    final: dict[str, Any],
    journal_binding: dict[str, Any],
) -> dict[str, Any]:
    redacted = [
        {
            "asset_id": asset_id,
            "sha256": final["narration_map"][asset_id],
            "redacted_license_attestation_sha256": final[
                "redacted_attestation_map"
            ][asset_id],
        }
        for asset_id in sorted(final["narration_map"])
    ]
    return {
        "schema_version": 1,
        "kind": "smokies_full_bundle_post_migration_profile_receipt",
        "status": "verified_profiled_private_draft",
        "product_id": PRODUCT_ID,
        "migration_bindings": {
            "packet": {
                "sha256": bindings.packet_sha256,
                "byte_count": bindings.packet_byte_count,
            },
            "audit": bindings.audit,
            "private_migration_receipt": bindings.migration_receipt,
            "source_revision": bindings.source_revision,
            "target": bindings.target,
        },
        "terms_observation_binding": bindings.terms_observation,
        "journal_binding": journal_binding,
        "profile_template_binding": {
            "sha256": bindings.profile_template_sha256,
            "byte_count": bindings.profile_template_byte_count,
        },
        "operator_identity": {"admin_identity_sha256": bindings.admin_sha256},
        "revisions": {"before": 3, "after": 4},
        "counts": {
            "newly_attested_narrations": 72,
            "preserved_roaring_fork_narrations": 13,
            "total_narrations": 85,
            "total_images": 13,
            "total_assets": 98,
        },
        "private_state": {
            "base_manifest_sha256": final["base_manifest_sha256"],
            "profiled_manifest_sha256": final["manifest_sha256"],
            "narration_profile_sha256": final["profile_sha256"],
            "asset_map_sha256": final["asset_map_sha256"],
            "validation_metadata_sha256": final["validation_sha256"],
            "narration_map_sha256": final["narration_map_sha256"],
            "redacted_license_attestation_map_sha256": final[
                "redacted_attestation_map_sha256"
            ],
            "latest_server_attested_at": final["latest_attested_at"],
        },
        "redacted_attestation_bindings": redacted,
        "preservation": {
            "roaring_fork_asset_count": 13,
            "roaring_fork_generator_metadata_sha256_before": initial_rf_sha256,
            "roaring_fork_generator_metadata_sha256_after": final[
                "rf_metadata_sha256"
            ],
            "roaring_fork_attestations_rewritten": False,
            "historical_validation_report": {
                "report_count": final["historical_report_count"],
                "report_id": final["historical_report_id"],
                "redacted_report_sha256": final[
                    "historical_report_redacted_sha256"
                ],
                "row_sha256_before": initial_report_row_sha256,
                "row_sha256_after": final["historical_report_row_sha256"],
                "inventory_sha256_before": initial_report_inventory_sha256,
                "inventory_sha256_after": final[
                    "historical_report_inventory_sha256"
                ],
                "current_full_bundle_report_count": final[
                    "current_full_bundle_report_count"
                ],
                "rewritten": False,
            },
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


def execute_state_machine(
    *,
    adapter: Any,
    journal: Any,
    receipt: Any,
    packet: dict[str, Any],
    template: dict[str, Any],
    bindings: ExecutionBindings,
    admin_user_id: int,
    after_database_attestation: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Run the restartable state machine; dependencies are injectable in tests."""
    state = adapter.inspect(verify_files=True)
    terms_phase = packet["post_migration_phases"]["license_attestation"]
    terms = terms_phase["terms_tuple"]
    initial_rf_sha256 = state["rf_metadata_sha256"]
    initial_report_sha256 = state["historical_report_row_sha256"]
    initial_report_inventory_sha256 = state[
        "historical_report_inventory_sha256"
    ]
    header = {
        "schema_version": 1,
        "kind": "smokies_post_migration_attestation_journal_header",
        "status": "append_only_private_journal",
        "product_id": PRODUCT_ID,
        "packet_sha256": bindings.packet_sha256,
        "audit_sha256": bindings.audit["sha256"],
        "migration_receipt_sha256": bindings.migration_receipt["sha256"],
        "source_revision": bindings.source_revision,
        "target": bindings.target,
        "admin_identity_sha256": bindings.admin_sha256,
        "terms_policy_sha256": terms_phase["terms_policy_sha256"],
        "roaring_fork_generator_metadata_sha256": initial_rf_sha256,
        "historical_validation_report": {
            "report_id": state["historical_report_id"],
            "redacted_report_sha256": state[
                "historical_report_redacted_sha256"
            ],
            "row_sha256": initial_report_sha256,
            "inventory_sha256": initial_report_inventory_sha256,
        },
        "expected_before_revision": 3,
        "expected_after_revision": 4,
    }
    if state["revision"] == 4:
        _require(journal.header() == header, "revision-4 journal header is missing or drifted")
    else:
        journal.ensure_header(header)
    journal.record_terms(
        {
            "schema_version": 1,
            "kind": "smokies_terms_observation_journal_record",
            "status": "fresh_exact_policy_tuple_verified",
            "product_id": PRODUCT_ID,
            "observation_sha256": bindings.terms_observation["sha256"],
            "observation_byte_count": bindings.terms_observation["byte_count"],
            "observed_at": bindings.terms_observation["observed_at"],
            "terms_policy_sha256": terms_phase["terms_policy_sha256"],
        }
    )

    if state["revision"] == 3:
        for asset_id in state["new_ids"]:
            expected_sha = terms_phase["asset_sha256"][asset_id]
            timestamp = state["attested_at"].get(asset_id)
            existing = journal.asset(asset_id)
            if timestamp is None and existing is not None:
                raise SmokiesPostMigrationError(
                    f"journal claims {asset_id} completed but the database does not"
                )
            if timestamp is None:
                result = adapter.attest(asset_id, expected_sha, terms)
                _require(result.get("pack_id") == PRODUCT_ID, "attestation pack drifted")
                _require(result.get("asset_id") == asset_id, "attestation asset drifted")
                _require(result.get("sha256") == expected_sha, "attestation sha256 drifted")
                verified = _verify_attestation(
                    result.get("license_attestation"),
                    terms,
                    admin_user_id,
                    f"attestation result {asset_id}",
                )
                timestamp = verified["attested_at"]
                redacted_sha = verified["redacted_license_attestation_sha256"]
                if after_database_attestation is not None:
                    after_database_attestation(asset_id)
            else:
                redacted_sha = state["redacted_attestation_map"][asset_id]
            journal.record_asset(
                _asset_journal_document(
                    asset_id,
                    expected_sha,
                    timestamp,
                    redacted_sha,
                    terms_phase["terms_policy_sha256"],
                )
            )
            state = adapter.inspect(verify_files=False)
            _require(state["revision"] == 3, "draft revision changed during attestation")
            _require(state["rf_metadata_sha256"] == initial_rf_sha256, "Roaring Fork metadata changed")
            _require(
                state["historical_report_row_sha256"] == initial_report_sha256,
                "historical validation report changed",
            )
            _require(
                state["historical_report_inventory_sha256"]
                == initial_report_inventory_sha256,
                "historical validation report inventory changed",
            )

        state = adapter.inspect(verify_files=True)
        _require(state["revision"] == 3, "profile CAS precondition revision drifted")
        _require(not state["unattested_new"], "not all 72 narrations are attested")
        _require(len(state["redacted_attestation_map"]) == 85, "85 attestation bindings are incomplete")
        profile = _materialize_profile(
            template, packet, state["latest_attested_at"]
        )
        result = adapter.apply_profile(profile, state["redacted_attestation_map"])
        _require(result.get("before_draft_revision") == 3, "profile CAS before revision drifted")
        _require(result.get("after_draft_revision") == 4, "profile CAS after revision drifted")
        _require(result.get("replayed") is False, "profile CAS unexpectedly replayed")
        _require(
            result.get("profile_sha256") == store._original_validation_hash(profile),
            "profile CAS hash drifted",
        )
        journal.record_profile(
            {
                "schema_version": 1,
                "kind": "smokies_narration_profile_cas_journal_record",
                "status": "revision_3_to_4_cas_verified",
                "product_id": PRODUCT_ID,
                "before_revision": 3,
                "after_revision": 4,
                "base_manifest_sha256": result["base_manifest_sha256"],
                "profile_sha256": result["profile_sha256"],
                "profiled_manifest_sha256": result["after_manifest_sha256"],
                "validation_metadata_sha256": result[
                    "after_validation_metadata_sha256"
                ],
            }
        )
    else:
        for asset_id in state["new_ids"]:
            expected = _asset_journal_document(
                asset_id,
                terms_phase["asset_sha256"][asset_id],
                state["attested_at"][asset_id],
                state["redacted_attestation_map"][asset_id],
                terms_phase["terms_policy_sha256"],
            )
            _require(
                journal.asset(asset_id) == expected,
                f"revision-4 journal record drifted for {asset_id}",
            )
        journal.record_profile(
            {
                "schema_version": 1,
                "kind": "smokies_narration_profile_cas_journal_record",
                "status": "revision_3_to_4_cas_verified",
                "product_id": PRODUCT_ID,
                "before_revision": 3,
                "after_revision": 4,
                "base_manifest_sha256": state["base_manifest_sha256"],
                "profile_sha256": state["profile_sha256"],
                "profiled_manifest_sha256": state["manifest_sha256"],
                "validation_metadata_sha256": state["validation_sha256"],
            }
        )

    final = adapter.inspect(verify_files=True)
    _require(final["revision"] == 4, "post-profile draft is not revision 4")
    _require(final["rf_metadata_sha256"] == initial_rf_sha256, "Roaring Fork attestations changed")
    _require(
        final["historical_report_row_sha256"] == initial_report_sha256,
        "historical validation report changed",
    )
    _require(
        final["historical_report_inventory_sha256"]
        == initial_report_inventory_sha256,
        "historical validation report inventory changed",
    )
    _require(not final["unattested_new"], "post-profile attestations are incomplete")
    _require(
        final["profile"]
        == _materialize_profile(template, packet, final["latest_attested_at"]),
        "post-profile narration profile drifted",
    )
    document = _receipt_document(
        bindings,
        initial_rf_sha256,
        initial_report_sha256,
        initial_report_inventory_sha256,
        final,
        journal.binding(),
    )
    installed = receipt.install(document)
    return {
        "schema_version": 1,
        "status": "verified_profiled_private_draft",
        "product_id": PRODUCT_ID,
        "before_revision": 3,
        "after_revision": 4,
        "receipt_sha256": installed["receipt_sha256"],
        "receipt_byte_count": installed["receipt_byte_count"],
        "replayed": installed["replayed"],
        "database_mutated": state["revision"] == 3,
        "provider_accessed": False,
        "provider_requests_sent": 0,
        "provider_credits_spent": 0,
        "media_rerendered": False,
        "trusted_validation_performed": False,
        "deployment_performed": False,
        "publication_performed": False,
    }


def _required_hex(value: object, label: str) -> None:
    _require(
        bool(re.fullmatch(r"[a-f0-9]{64}", str(value or ""))),
        f"{label} must be a lowercase sha256",
    )


def _validate_sqlite_sidecars(db_path: Path) -> None:
    for suffix in ("-wal", "-shm"):
        path = Path(str(db_path) + suffix)
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise SmokiesPostMigrationError("SQLite sidecar identity is unavailable") from exc
        _require(
            not stat.S_ISLNK(info.st_mode)
            and stat.S_ISREG(info.st_mode)
            and info.st_nlink == 1,
            f"SQLite {suffix} sidecar is unsafe",
        )


def apply(args: argparse.Namespace) -> dict[str, Any]:
    _require(args.apply == APPLY_SENTINEL, "exact live-apply sentinel is required")
    for name in (
        "expected_packet_sha256",
        "expected_audit_sha256",
        "expected_audit_bindings_sha256",
        "expected_migration_receipt_sha256",
        "expected_terms_observation_sha256",
        "expected_profile_template_sha256",
        "expected_new_narration_map_sha256",
        "expected_asset_map_sha256",
        "expected_base_manifest_sha256",
        "expected_validation_metadata_sha256",
        "expected_terms_policy_sha256",
    ):
        _required_hex(getattr(args, name, None), name.replace("_", " "))
    _require(
        bool(re.fullmatch(r"[a-f0-9]{40}", str(args.expected_source_commit or ""))),
        "source commit must be exact",
    )
    _require(
        bool(re.fullmatch(r"[a-f0-9]{40}", str(args.expected_source_tree or ""))),
        "source tree must be exact",
    )
    _require(args.target_id == TARGET_ID, "target id is not the configured private target")
    _require(
        isinstance(args.admin_user_id, int) and args.admin_user_id > 0,
        "admin user id is required",
    )

    db_path = _outside_repo(Path(str(args.database or "")), "configured SQLite database")
    asset_root = _outside_repo(Path(str(args.asset_root or "")), "configured asset root")
    migration_receipt_path = _outside_repo(
        Path(str(args.migration_receipt or "")), "private migration receipt"
    )
    migration_packet_path = _outside_repo(
        Path(str(args.migration_packet or "")), "immutable M2 migration packet"
    )
    migration_audit_path = _outside_repo(
        Path(str(args.migration_audit or "")), "immutable M2 migration audit"
    )
    terms_path = _outside_repo(
        Path(str(args.terms_observation or "")), "private terms observation"
    )
    journal_path = _outside_repo(
        Path(str(args.journal_dir or "")), "private journal directory"
    )
    receipt_path = _outside_repo(
        Path(str(args.receipt or "")), "private post-migration receipt", must_exist=False
    )
    _require(receipt_path.name == RECEIPT_NAME, "receipt name is not canonical")
    _require(receipt_path.parent.exists(), "receipt parent is missing")
    _require(receipt_path.parent != journal_path, "receipt and journal directories must differ")
    _require(asset_root.is_dir() and not asset_root.is_symlink(), "asset root is unsafe")
    _validate_sqlite_sidecars(db_path)

    with _pinned_file(
        migration_packet_path, "immutable M2 migration packet", private=True
    ) as packet_pin, \
        _pinned_file(
            migration_audit_path, "immutable M2 migration audit", private=True
        ) as audit_pin, \
        _pinned_file(PROFILE_TEMPLATE_PATH, "profile template", private=False) as template_pin, \
        _pinned_file(migration_receipt_path, "private migration receipt", private=True) as migration_pin, \
        _pinned_file(terms_path, "private terms observation", private=True) as terms_pin, \
        _pinned_file(
            db_path,
            "configured SQLite database",
            private=False,
            writable=True,
            read_payload=False,
        ) as db_pin, \
        _pinned_directory(asset_root, "configured asset root", private=False) as asset_pin, \
        _pinned_directory(journal_path, "private journal directory", private=True) as journal_pin, \
        _pinned_directory(receipt_path.parent, "private receipt directory", private=True) as receipt_pin:
        packet_payload = packet_pin[2]
        audit_payload = audit_pin[2]
        template_payload = template_pin[2]
        migration_payload = migration_pin[2]
        terms_payload = terms_pin[2]
        packet = _json_object(packet_payload, "migration packet")
        audit = _json_object(audit_payload, "migration audit")
        template = _json_object(template_payload, "profile template")
        migration_receipt = _json_object(migration_payload, "private migration receipt")
        terms_observation = _json_object(terms_payload, "private terms observation")
        packet_sha = sha256_bytes(packet_payload)
        _validate_packet(packet, packet_sha, args)
        audit_binding = _validate_audit(audit, audit_payload, packet_sha, args)
        template_sha = sha256_bytes(template_payload)
        _require(
            template_sha == args.expected_profile_template_sha256,
            "profile template sha256 drifted",
        )
        _require(
            template_sha
            == packet["final_profiled_candidate"]["profile_settings_template_sha256"],
            "packet profile template binding drifted",
        )
        migration_binding = _validate_migration_receipt(
            migration_receipt,
            migration_payload,
            packet,
            packet_sha,
            db_path,
            db_pin[1],
            asset_root,
            args,
        )
        terms_binding = _validate_terms_observation(
            terms_observation,
            terms_payload,
            packet,
            args.expected_terms_observation_sha256,
        )
        target = {
            "id": TARGET_ID,
            "database_path_sha256": path_identity(db_path),
            "database_inode_identity_sha256": filesystem_identity_sha256(db_pin[1]),
            "asset_root_path_sha256": path_identity(asset_root),
        }
        bindings = ExecutionBindings(
            packet_sha256=packet_sha,
            packet_byte_count=len(packet_payload),
            audit=audit_binding,
            migration_receipt=migration_binding,
            terms_observation=terms_binding,
            profile_template_sha256=template_sha,
            profile_template_byte_count=len(template_payload),
            source_revision=packet["source_revision"],
            target=target,
            admin_sha256=admin_identity_sha256(args.admin_user_id),
        )
        adapter = DatabaseAdapter(
            db_path,
            db_pin[0],
            db_pin[1],
            packet,
            asset_root,
            args.admin_user_id,
            migration_binding["predecessor_history_sha256"],
        )
        result = execute_state_machine(
            adapter=adapter,
            journal=PrivateJournal(journal_path, journal_pin[0], journal_pin[1]),
            receipt=PrivateReceipt(receipt_path, receipt_pin[0], receipt_pin[1]),
            packet=packet,
            template=template,
            bindings=bindings,
            admin_user_id=args.admin_user_id,
        )
        _assert_pinned_file(
            terms_path, terms_pin[0], terms_pin[1], "private terms observation"
        )
        _assert_pinned_directory(
            asset_root,
            asset_pin[0],
            asset_pin[1],
            "configured asset root",
            private=False,
        )
        _validate_sqlite_sidecars(db_path)
        return result


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--apply")
    result.add_argument("--database")
    result.add_argument("--asset-root")
    result.add_argument("--target-id")
    result.add_argument("--admin-user-id", type=int)
    result.add_argument("--migration-packet")
    result.add_argument("--migration-audit")
    result.add_argument("--migration-receipt")
    result.add_argument("--terms-observation")
    result.add_argument("--journal-dir")
    result.add_argument("--receipt")
    result.add_argument("--expected-packet-sha256")
    result.add_argument("--expected-audit-sha256")
    result.add_argument("--expected-audit-bindings-sha256")
    result.add_argument("--expected-migration-receipt-sha256")
    result.add_argument("--expected-terms-observation-sha256")
    result.add_argument("--expected-profile-template-sha256")
    result.add_argument("--expected-source-commit")
    result.add_argument("--expected-source-tree")
    result.add_argument("--expected-new-narration-map-sha256")
    result.add_argument("--expected-asset-map-sha256")
    result.add_argument("--expected-base-manifest-sha256")
    result.add_argument("--expected-validation-metadata-sha256")
    result.add_argument("--expected-terms-policy-sha256")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        output = dry_run() if args.apply is None else apply(args)
    except (ValueError, PermissionError, sqlite3.Error, OSError) as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}, sort_keys=True))
        return 2
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
