#!/usr/bin/env python3
"""Guarded rev4 -> rev5 Smokies finalization operator.

Default execution is a network-free, database-free status report. Live apply
requires the exact sentinel and explicit private receipt path; the reviewed
readiness and route artifacts must already exist and pass their frozen gates.
"""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import json
import os
import stat
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import store
from db.originals_smokies_final_readiness import (
    EXPECTED_AFTER_DRAFT_REVISION,
    EXPECTED_BEFORE_DRAFT_REVISION,
    FINALIZATION_REVIEW_PATH,
    PRODUCT_ID,
    SMOKIES_PUBLICATION_ROUTE_EVIDENCE,
    SmokiesFinalReadinessError,
    canonical_bytes,
    load_finalization_review_artifact,
)


APPLY_SENTINEL = "FINALIZE_PRIVATE_SMOKIES_FULL_BUNDLE_READINESS"
RECEIPT_ROOT_ENV = "TRAILHEAD_SMOKIES_PRIVATE_RECEIPT_ROOT"
RECEIPT_NAME = "smokies_full_bundle_final_readiness_cas_receipt_v1.json"


class SmokiesFinalReadinessOperatorError(ValueError):
    """The guarded operator could not prove a safe action boundary."""


def dry_run() -> dict[str, Any]:
    missing: list[str] = []
    for label, path in (
        ("finalization_review_artifact", FINALIZATION_REVIEW_PATH),
        ("publication_route_evidence", SMOKIES_PUBLICATION_ROUTE_EVIDENCE),
    ):
        if not path.is_file():
            missing.append(label)
    return {
        "schema_version": 1,
        "status": "dry_run_live_apply_locked",
        "pack_id": PRODUCT_ID,
        "expected_before_revision": EXPECTED_BEFORE_DRAFT_REVISION,
        "expected_after_revision": EXPECTED_AFTER_DRAFT_REVISION,
        "sentinel_required": APPLY_SENTINEL,
        "required_artifacts_present": not missing,
        "missing_requirements": missing,
        "database_accessed": False,
        "database_mutated": False,
        "network_accessed": False,
        "provider_accessed": False,
        "publication_performed": False,
        "writes_performed": False,
    }


def _private_receipt_path(receipt_path: Path) -> tuple[Path, int, tuple[int, int]]:
    configured = os.environ.get(RECEIPT_ROOT_ENV, "").strip()
    if not configured:
        raise SmokiesFinalReadinessOperatorError(
            f"{RECEIPT_ROOT_ENV} must name the private receipt root"
        )
    lexical_root = Path(os.path.abspath(configured))
    lexical_path = Path(os.path.abspath(receipt_path))
    try:
        relative = lexical_path.relative_to(lexical_root)
    except ValueError as exc:
        raise SmokiesFinalReadinessOperatorError(
            "receipt path must stay under the configured private root"
        ) from exc
    if relative != Path(RECEIPT_NAME):
        raise SmokiesFinalReadinessOperatorError(
            "receipt path must use the exact final-readiness receipt name"
        )
    if lexical_root.is_symlink() or not lexical_root.is_dir():
        raise SmokiesFinalReadinessOperatorError(
            "private receipt root must be a real existing directory"
        )
    root_info = lexical_root.lstat()
    mode = stat.S_IMODE(root_info.st_mode)
    if mode & 0o077:
        raise SmokiesFinalReadinessOperatorError(
            "private receipt root must not grant group or other access"
        )
    descriptor = os.open(
        lexical_root,
        os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_CLOEXEC", 0),
    )
    opened = os.fstat(descriptor)
    if (opened.st_dev, opened.st_ino) != (root_info.st_dev, root_info.st_ino):
        os.close(descriptor)
        raise SmokiesFinalReadinessOperatorError(
            "private receipt root changed during preflight"
        )
    return lexical_path, descriptor, (opened.st_dev, opened.st_ino)


def _assert_receipt_parent(
    path: Path, descriptor: int, identity: tuple[int, int]
) -> None:
    info = path.parent.lstat()
    opened = os.fstat(descriptor)
    if (
        path.parent.is_symlink()
        or (info.st_dev, info.st_ino) != identity
        or (opened.st_dev, opened.st_ino) != identity
    ):
        raise SmokiesFinalReadinessOperatorError(
            "private receipt root identity changed"
        )


def _receipt_binding(payload: bytes) -> dict[str, Any]:
    return {
        "receipt_byte_count": len(payload),
        "receipt_sha256": hashlib.sha256(payload).hexdigest(),
    }


def _parent_identity_sha256(identity: tuple[int, int]) -> str:
    return hashlib.sha256(
        json.dumps(
            {"device": identity[0], "inode": identity[1]},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()


def _read_existing_receipt(
    path: Path,
    expected: dict[str, Any],
    *,
    parent_descriptor: int | None = None,
    parent_identity: tuple[int, int] | None = None,
) -> dict:
    if parent_descriptor is not None and parent_identity is not None:
        _assert_receipt_parent(path, parent_descriptor, parent_identity)
    try:
        if parent_descriptor is None:
            info = path.lstat()
            payload = path.read_bytes()
        else:
            fd = os.open(
                path.name,
                os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
                dir_fd=parent_descriptor,
            )
            try:
                info = os.fstat(fd)
                payload = b""
                while True:
                    chunk = os.read(fd, 1024 * 1024)
                    if not chunk:
                        break
                    payload += chunk
            finally:
                os.close(fd)
    except OSError as exc:
        raise SmokiesFinalReadinessOperatorError(
            "existing final-readiness receipt could not be verified"
        ) from exc
    expected_payload = canonical_bytes(expected)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or stat.S_IMODE(info.st_mode) != 0o600
        or payload != expected_payload
    ):
        raise SmokiesFinalReadinessOperatorError(
            "existing final-readiness receipt drifted"
        )
    return _receipt_binding(payload)


def _link_unnamed_receipt(
    source_descriptor: int, parent_descriptor: int, name: str
) -> None:
    linkat = getattr(ctypes.CDLL(None, use_errno=True), "linkat", None)
    if linkat is None:
        raise SmokiesFinalReadinessOperatorError("receipt linkat is unavailable")
    linkat.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
    ]
    linkat.restype = ctypes.c_int
    if linkat(
        source_descriptor,
        b"",
        parent_descriptor,
        os.fsencode(name),
        0x1000,
    ) == 0:
        return
    error = ctypes.get_errno()
    if error == errno.EEXIST:
        raise FileExistsError(name)
    if error in {
        errno.EACCES,
        errno.EINVAL,
        errno.ENOENT,
        errno.ENOSYS,
        errno.EOPNOTSUPP,
        errno.EPERM,
    }:
        proc_source = f"/proc/self/fd/{source_descriptor}"
        source_info = os.fstat(source_descriptor)
        try:
            proc_info = os.stat(proc_source, follow_symlinks=True)
        except OSError as exc:
            raise SmokiesFinalReadinessOperatorError(
                "anonymous receipt procfd source is unavailable"
            ) from exc
        if (source_info.st_dev, source_info.st_ino) != (
            proc_info.st_dev,
            proc_info.st_ino,
        ):
            raise SmokiesFinalReadinessOperatorError(
                "anonymous receipt procfd source drifted"
            )
        if linkat(
            -100,
            os.fsencode(proc_source),
            parent_descriptor,
            os.fsencode(name),
            0x400,
        ) == 0:
            return
        error = ctypes.get_errno()
        if error == errno.EEXIST:
            raise FileExistsError(name)
    raise SmokiesFinalReadinessOperatorError(
        "anonymous receipt create-only linking failed"
    ) from OSError(error, os.strerror(error))


def _write_receipt_create_only(
    path: Path,
    receipt: dict[str, Any],
    *,
    parent_descriptor: int | None = None,
    parent_identity: tuple[int, int] | None = None,
) -> dict:
    payload = canonical_bytes(receipt)
    close_parent = False
    if parent_descriptor is None or parent_identity is None:
        info = path.parent.lstat()
        parent_descriptor = os.open(
            path.parent,
            os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_CLOEXEC", 0),
        )
        parent_identity = (info.st_dev, info.st_ino)
        close_parent = True
    try:
        _assert_receipt_parent(path, parent_descriptor, parent_identity)
        anonymous_flag = getattr(os, "O_TMPFILE", 0)
        if not anonymous_flag:
            raise SmokiesFinalReadinessOperatorError(
                "receipt O_TMPFILE is unavailable"
            )
        fd = os.open(
            ".",
            os.O_RDWR | anonymous_flag | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=parent_descriptor,
        )
        try:
            os.fchmod(fd, 0o600)
            offset = 0
            while offset < len(payload):
                written = os.write(fd, payload[offset:])
                if written <= 0:
                    raise SmokiesFinalReadinessOperatorError(
                        "anonymous receipt write failed"
                    )
                offset += written
            os.fsync(fd)
            anonymous_info = os.fstat(fd)
            if (
                not stat.S_ISREG(anonymous_info.st_mode)
                or anonymous_info.st_nlink != 0
                or stat.S_IMODE(anonymous_info.st_mode) != 0o600
                or anonymous_info.st_uid != os.geteuid()
                or anonymous_info.st_dev != parent_identity[0]
            ):
                raise SmokiesFinalReadinessOperatorError(
                    "anonymous receipt inode is unsafe"
                )
            _assert_receipt_parent(path, parent_descriptor, parent_identity)
            _link_unnamed_receipt(fd, parent_descriptor, path.name)
            os.fsync(parent_descriptor)
        finally:
            os.close(fd)
        installed_fd = os.open(
            path.name,
            os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_descriptor,
        )
        try:
            info = os.fstat(installed_fd)
            installed_payload = b""
            while True:
                chunk = os.read(installed_fd, 1024 * 1024)
                if not chunk:
                    break
                installed_payload += chunk
        finally:
            os.close(installed_fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o600
            or installed_payload != payload
        ):
            raise SmokiesFinalReadinessOperatorError(
                "final-readiness receipt failed immutable readback"
            )
        return _receipt_binding(payload)
    finally:
        if close_parent:
            os.close(parent_descriptor)


def apply(
    *,
    apply_sentinel: str,
    expected_manifest_sha256: str,
    expected_validation_metadata_sha256: str,
    admin_user_id: int,
    idempotency_key: str,
    receipt_path: Path,
) -> dict[str, Any]:
    if apply_sentinel != APPLY_SENTINEL:
        raise SmokiesFinalReadinessOperatorError(
            "exact final-readiness apply sentinel is required"
        )
    private_receipt, parent_descriptor, parent_identity = _private_receipt_path(
        receipt_path
    )
    try:
        # Preflight both immutable artifacts before opening SQLite.
        try:
            load_finalization_review_artifact()
        except SmokiesFinalReadinessError as exc:
            raise SmokiesFinalReadinessOperatorError(str(exc)) from exc
        _assert_receipt_parent(
            private_receipt, parent_descriptor, parent_identity
        )
        result = store.finalize_authored_original_smokies_full_bundle_readiness(
            PRODUCT_ID,
            expected_draft_revision=EXPECTED_BEFORE_DRAFT_REVISION,
            expected_manifest_sha256=expected_manifest_sha256,
            expected_validation_metadata_sha256=(
                expected_validation_metadata_sha256
            ),
            admin_user_id=admin_user_id,
            idempotency_key=idempotency_key,
            finalization_review_artifact_path=FINALIZATION_REVIEW_PATH,
            private_receipt_parent_identity_sha256=(
                _parent_identity_sha256(parent_identity)
            ),
        )
        receipt = result["receipt"]
        _assert_receipt_parent(
            private_receipt, parent_descriptor, parent_identity
        )
        try:
            os.stat(
                private_receipt.name,
                dir_fd=parent_descriptor,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            binding = _write_receipt_create_only(
                private_receipt,
                receipt,
                parent_descriptor=parent_descriptor,
                parent_identity=parent_identity,
            )
        else:
            binding = _read_existing_receipt(
                private_receipt,
                receipt,
                parent_descriptor=parent_descriptor,
                parent_identity=parent_identity,
            )
    finally:
        os.close(parent_descriptor)
    return {
        "schema_version": 1,
        "status": "private_final_readiness_applied_receipt_created",
        "pack_id": PRODUCT_ID,
        "before_revision": EXPECTED_BEFORE_DRAFT_REVISION,
        "after_revision": EXPECTED_AFTER_DRAFT_REVISION,
        "receipt": binding,
        "database_accessed": True,
        "idempotent_replay": result["replayed"],
        "database_mutated": not result["replayed"],
        "network_accessed": False,
        "provider_accessed": False,
        "publication_performed": False,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply-sentinel")
    parser.add_argument("--expected-manifest-sha256")
    parser.add_argument("--expected-validation-metadata-sha256")
    parser.add_argument("--admin-user-id", type=int)
    parser.add_argument("--idempotency-key")
    parser.add_argument("--receipt-path", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    supplied = [
        args.apply_sentinel,
        args.expected_manifest_sha256,
        args.expected_validation_metadata_sha256,
        args.admin_user_id,
        args.idempotency_key,
        args.receipt_path,
    ]
    if not any(value is not None for value in supplied):
        result = dry_run()
    elif not all(value is not None for value in supplied):
        raise SmokiesFinalReadinessOperatorError(
            "live-shaped final-readiness arguments must be complete"
        )
    else:
        result = apply(
            apply_sentinel=args.apply_sentinel,
            expected_manifest_sha256=args.expected_manifest_sha256,
            expected_validation_metadata_sha256=(
                args.expected_validation_metadata_sha256
            ),
            admin_user_id=args.admin_user_id,
            idempotency_key=args.idempotency_key,
            receipt_path=args.receipt_path,
        )
    sys.stdout.write(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
