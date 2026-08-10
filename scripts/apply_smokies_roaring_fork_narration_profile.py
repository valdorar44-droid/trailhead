#!/usr/bin/env python3
"""Guarded one-time operator for the Roaring Fork narration profile.

The default mode is read-only. Apply writes a rollback journal before calling
the store's revision-checked profile function. The journal is retained across
replays so a lost response can never discard the exact pre-apply metadata.
This script has no publish, preview, validation-run, media-upload, or raw SQL
mutation path.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from typing import Any, Iterator

REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from config.settings import settings
from db import store
from db.original_manifest_v2 import validate_original_narration_profile_asset
import scripts.build_smokies_roaring_fork_narration_profile as builder


REPORT_ID = "smokies_roaring_fork_narration_profile_application_20260810_v1"
TARGET_ID = "railway.trailhead.production.private"
DEFAULT_REPORT_PATH = Path(
    os.environ.get("TRAILHEAD_S4P_REPORT_PATH")
    or "/data/originals/reports/roaring-fork-narration-profile-application-v1.json"
)
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class NarrationProfileOperatorError(RuntimeError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise NarrationProfileOperatorError(message)


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _canonical_sha256(value: object) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _path_identity(path: Path) -> str:
    return hashlib.sha256(str(path).encode("utf-8")).hexdigest()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise NarrationProfileOperatorError(
            f"Required JSON is unavailable or invalid: {path.name}"
        ) from exc
    _require(isinstance(value, dict), f"Required JSON is not an object: {path.name}")
    return value


def _load_bundle() -> dict[str, Any]:
    profile, evidence = builder.build_bundle()
    tracked_profile = _load_json(builder.PROFILE_OUTPUT_PATH)
    tracked_evidence = _load_json(builder.EVIDENCE_OUTPUT_PATH)
    _require(profile == tracked_profile, "Tracked narration profile drifted")
    _require(evidence == tracked_evidence, "Tracked profile evidence drifted")
    _require(
        builder.PROFILE_OUTPUT_PATH.read_text(encoding="utf-8")
        == builder.serialize(profile),
        "Tracked narration profile is not byte-canonical",
    )
    _require(
        builder.EVIDENCE_OUTPUT_PATH.read_text(encoding="utf-8")
        == builder.serialize(evidence),
        "Tracked profile evidence is not byte-canonical",
    )

    receipt_spec = builder.SOURCE_SPECS["private_import_receipt"]
    receipt = _load_json(receipt_spec.path)
    _require(
        _sha256_path(receipt_spec.path) == receipt_spec.sha256,
        "Private import receipt SHA-256 drifted",
    )
    receipt_rows = receipt.get("assets", {}).get("verified_sha256")
    _require(isinstance(receipt_rows, list), "Private import receipt assets are invalid")
    receipt_sha256: dict[str, str] = {}
    for row in receipt_rows:
        _require(isinstance(row, dict), "Private import receipt asset is invalid")
        asset_id = str(row.get("asset_id") or "")
        sha256 = str(row.get("sha256") or "")
        _require(asset_id and SHA256_RE.fullmatch(sha256) is not None, "Receipt asset binding is invalid")
        _require(asset_id not in receipt_sha256, "Receipt contains a duplicate asset id")
        receipt_sha256[asset_id] = sha256
    _require(len(receipt_sha256) == 20, "Private import receipt must bind exactly 20 assets")

    narration_sha256 = {
        asset_id: sha256
        for asset_id, sha256 in receipt_sha256.items()
        if asset_id.startswith("rf_audio_")
    }
    _require(len(narration_sha256) == 13, "Private import receipt must bind exactly 13 narrations")
    redacted_attestation_sha256: dict[str, str] = {}
    for row in evidence.get("attestations", []):
        _require(isinstance(row, dict), "Profile evidence attestation is invalid")
        asset_id = str(row.get("asset_id") or "")
        sha256 = str(row.get("redacted_attestation_sha256") or "")
        _require(
            asset_id in narration_sha256
            and SHA256_RE.fullmatch(sha256) is not None,
            "Profile evidence attestation binding is invalid",
        )
        _require(
            asset_id not in redacted_attestation_sha256,
            "Profile evidence has a duplicate attestation",
        )
        redacted_attestation_sha256[asset_id] = sha256
    _require(
        set(redacted_attestation_sha256) == set(narration_sha256),
        "Profile evidence must bind every exact narration attestation",
    )

    profile_file_sha256 = _sha256_path(builder.PROFILE_OUTPUT_PATH)
    profile_sha256 = store._original_validation_hash(profile)
    profile_artifact = evidence.get("profile_artifact")
    _require(isinstance(profile_artifact, dict), "Profile evidence artifact binding is invalid")
    _require(
        profile_artifact.get("sha256") == profile_file_sha256
        and profile_artifact.get("canonical_sha256") == profile_sha256,
        "Profile artifact hashes drifted",
    )
    live_readback = evidence.get("live_readback", {})
    _require(isinstance(live_readback, dict), "Live readback evidence is invalid")
    expected_base_manifest_sha256 = str(
        live_readback.get("store_base_manifest_canonical_sha256") or ""
    )
    _require(
        SHA256_RE.fullmatch(expected_base_manifest_sha256) is not None,
        "Live base-manifest evidence is invalid",
    )
    _require(
        expected_base_manifest_sha256
        == str(receipt.get("manifest_canonical_sha256") or ""),
        "Store base-manifest evidence drifted from the private import receipt",
    )
    _require(
        SHA256_RE.fullmatch(
            str(live_readback.get("manifest_probe_ensure_ascii_sha256") or "")
        )
        is not None,
        "Raw live manifest probe evidence is invalid",
    )
    expected_applied_manifest_sha256 = str(
        profile_artifact.get("normalized_manifest_with_profile_canonical_sha256")
        or ""
    )
    _require(
        SHA256_RE.fullmatch(expected_applied_manifest_sha256) is not None,
        "Profiled-manifest evidence is invalid",
    )
    protected = receipt.get("protected_files")
    _require(isinstance(protected, dict), "Private import protected-file bindings are invalid")
    for relative_path, expected_sha256 in protected.items():
        _require(
            isinstance(relative_path, str)
            and SHA256_RE.fullmatch(str(expected_sha256)) is not None,
            "Private import protected-file binding is invalid",
        )
        source_path = (builder.REPOSITORY / relative_path).resolve()
        _require(source_path.is_file(), f"Protected source is unavailable: {relative_path}")
        _require(
            _sha256_path(source_path) == expected_sha256,
            f"Protected source drifted: {relative_path}",
        )
    _require(
        receipt.get("pack", {}).get("id") == builder.PRODUCT_ID
        and receipt.get("pack", {}).get("draft_revision") == 1,
        "Private import receipt pack binding drifted",
    )
    return {
        "profile": profile,
        "evidence": evidence,
        "receipt": receipt,
        "receipt_sha256": receipt_spec.sha256,
        "receipt_asset_sha256": receipt_sha256,
        "narration_sha256": narration_sha256,
        "redacted_attestation_sha256": redacted_attestation_sha256,
        "profile_file_sha256": profile_file_sha256,
        "profile_sha256": profile_sha256,
        "evidence_file_sha256": _sha256_path(builder.EVIDENCE_OUTPUT_PATH),
        "expected_base_manifest_sha256": expected_base_manifest_sha256,
        "expected_applied_manifest_sha256": expected_applied_manifest_sha256,
    }


def _configured_target(bundle: dict[str, Any]) -> dict[str, Any]:
    raw_db = os.environ.get("TRAILHEAD_DB_PATH")
    raw_asset_root = os.environ.get("TRAILHEAD_ORIGINALS_ASSET_DIR")
    target_id = os.environ.get("TRAILHEAD_PRIVATE_IMPORT_TARGET_ID")
    _require(bool(raw_db), "TRAILHEAD_DB_PATH must be explicitly configured")
    _require(bool(raw_asset_root), "TRAILHEAD_ORIGINALS_ASSET_DIR must be explicitly configured")
    _require(target_id == TARGET_ID, "Configured private target id is not the reviewed target")

    database_path = Path(str(raw_db)).expanduser().resolve()
    asset_root = Path(str(raw_asset_root)).expanduser().resolve()
    _require(database_path.is_absolute() and database_path.is_file(), "Configured database is unavailable")
    _require(asset_root.is_absolute() and asset_root.is_dir(), "Configured asset root is unavailable")
    _require(
        Path(settings.db_path).expanduser().resolve() == database_path,
        "Runtime database setting does not match the configured target",
    )
    target = bundle["receipt"].get("target")
    _require(isinstance(target, dict), "Private import receipt target is invalid")
    _require(target.get("id") == TARGET_ID, "Private import receipt target id drifted")
    _require(
        target.get("database_path_sha256") == _path_identity(database_path),
        "Configured database path identity drifted",
    )
    _require(
        target.get("asset_root_path_sha256") == _path_identity(asset_root),
        "Configured asset-root identity drifted",
    )
    return {
        "id": TARGET_ID,
        "database_path": database_path,
        "asset_root": asset_root,
        "database_path_sha256": _path_identity(database_path),
        "asset_root_path_sha256": _path_identity(asset_root),
    }


def _read_connection(database_path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(f"{database_path.as_uri()}?mode=ro", uri=True, timeout=60)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    return db


def _json_column(value: object, label: str) -> dict[str, Any]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError) as exc:
        raise NarrationProfileOperatorError(f"{label} is invalid") from exc
    _require(isinstance(decoded, dict), f"{label} is invalid")
    return decoded


def _inspect_current(
    bundle: dict[str, Any],
    target: dict[str, Any],
) -> dict[str, Any]:
    db = _read_connection(target["database_path"])
    try:
        quick = db.execute("PRAGMA quick_check").fetchall()
        _require(
            len(quick) == 1 and str(quick[0][0]).lower() == "ok",
            "SQLite quick_check failed",
        )
        pack = db.execute(
            """SELECT id,content_kind,status,draft_title,
                      draft_original_manifest_json,draft_validation_metadata,
                      draft_revision,current_published_version
               FROM authored_trip_packs WHERE id=?""",
            (builder.PRODUCT_ID,),
        ).fetchone()
        _require(pack is not None, "Roaring Fork private draft is unavailable")
        _require(
            pack["content_kind"] == "original_drive" and pack["status"] == "draft",
            "Roaring Fork target is not an unpublished Original draft",
        )
        _require(pack["current_published_version"] is None, "Roaring Fork already has a current published version")
        published_count = int(
            db.execute(
                "SELECT COUNT(*) FROM authored_trip_pack_versions WHERE pack_id=?",
                (builder.PRODUCT_ID,),
            ).fetchone()[0]
        )
        validation_report_count = int(
            db.execute(
                "SELECT COUNT(*) FROM authored_original_validation_reports WHERE pack_id=?",
                (builder.PRODUCT_ID,),
            ).fetchone()[0]
        )
        _require(published_count == 0, "Roaring Fork has a published version")
        _require(validation_report_count == 0, "Roaring Fork has a validation report")

        manifest = _json_column(pack["draft_original_manifest_json"], "Draft manifest")
        validation_metadata = _json_column(
            pack["draft_validation_metadata"], "Draft validation metadata"
        )
        raw_profile = manifest.get("narration_profile")
        base_input = copy.deepcopy(manifest)
        base_input.pop("narration_profile", None)
        normalized_base, _ = store._normalize_original_manifest(
            builder.PRODUCT_ID,
            str(pack["draft_title"]),
            base_input,
            publishing=False,
        )
        base_manifest_sha256 = store._original_validation_hash(normalized_base)
        _require(
            base_manifest_sha256 == bundle["expected_base_manifest_sha256"],
            "Live base-manifest hash drifted",
        )
        candidate_input = copy.deepcopy(normalized_base)
        candidate_input["narration_profile"] = copy.deepcopy(bundle["profile"])
        normalized_candidate, _ = store._normalize_original_manifest(
            builder.PRODUCT_ID,
            str(pack["draft_title"]),
            candidate_input,
            publishing=False,
        )
        applied_manifest_sha256 = store._original_validation_hash(normalized_candidate)
        _require(
            applied_manifest_sha256
            == bundle["expected_applied_manifest_sha256"],
            "Profiled-manifest hash drifted from deterministic evidence",
        )

        rows = db.execute(
            """SELECT * FROM authored_original_assets
               WHERE pack_id=? AND is_current=1 ORDER BY asset_id""",
            (builder.PRODUCT_ID,),
        ).fetchall()
        current_by_id = {str(row["asset_id"]): dict(row) for row in rows}
        _require(
            set(current_by_id) == set(bundle["receipt_asset_sha256"]),
            "Current asset membership drifted from the import receipt",
        )
        manifest_assets = {
            str(row["id"]): row
            for row in normalized_base.get("assets", [])
            if isinstance(row, dict)
        }
        _require(set(manifest_assets) == set(current_by_id), "Manifest asset membership drifted")
        total_bytes = 0
        narration_count = 0
        image_count = 0
        attesting_admin_ids: set[int] = set()
        for asset_id in sorted(current_by_id):
            row = current_by_id[asset_id]
            expected_sha256 = bundle["receipt_asset_sha256"][asset_id]
            _require(row["sha256"] == expected_sha256, f"Current asset SHA-256 drifted: {asset_id}")
            storage_path = Path(str(row["storage_path"])).resolve()
            try:
                storage_path.relative_to(target["asset_root"])
            except ValueError as exc:
                raise NarrationProfileOperatorError(
                    f"Current asset escaped the configured asset root: {asset_id}"
                ) from exc
            _require(storage_path.is_file(), f"Current asset file is unavailable: {asset_id}")
            byte_count = int(row["byte_count"])
            _require(storage_path.stat().st_size == byte_count, f"Current asset byte count drifted: {asset_id}")
            _require(_sha256_path(storage_path) == expected_sha256, f"Current asset bytes drifted: {asset_id}")
            manifest_asset = manifest_assets[asset_id]
            _require(
                manifest_asset.get("kind") == row["kind"]
                and manifest_asset.get("mime_type") == row["mime_type"]
                and manifest_asset.get("bytes") == byte_count
                and manifest_asset.get("sha256") == expected_sha256,
                f"Manifest asset tuple drifted: {asset_id}",
            )
            total_bytes += byte_count
            if row["kind"] == "narration":
                narration_count += 1
                generator = _json_column(
                    row["generator_metadata_json"],
                    f"Generator metadata for {asset_id}",
                )
                _require(
                    store._original_generator_license_attestation_complete(generator),
                    f"License attestation is incomplete: {asset_id}",
                )
                attestation = generator["license_attestation"]
                redacted_attestation = copy.deepcopy(attestation)
                redacted_attestation.pop("attested_by_admin_user_id", None)
                _require(
                    _canonical_sha256(redacted_attestation)
                    == bundle["redacted_attestation_sha256"][asset_id],
                    f"Server-owned attestation record drifted: {asset_id}",
                )
                attesting_admin_ids.add(int(attestation["attested_by_admin_user_id"]))
                validate_original_narration_profile_asset(
                    bundle["profile"], row, label=f"Roaring Fork narration {asset_id}"
                )
            elif row["kind"] == "image":
                image_count += 1
            else:
                raise NarrationProfileOperatorError(f"Unsupported current asset kind: {asset_id}")
        _require(
            narration_count == 13 and image_count == 7 and total_bytes == 239_772_665,
            "Current asset totals drifted from the import receipt",
        )
        _require(len(attesting_admin_ids) == 1, "Narrations do not share one attesting admin")
        attesting_admin_id = next(iter(attesting_admin_ids))
        admin = db.execute(
            "SELECT is_admin FROM users WHERE id=?", (attesting_admin_id,)
        ).fetchone()
        _require(admin is not None and bool(admin["is_admin"]), "Attesting identity is not a current admin")
        bindings = store._validate_original_narration_profile_bindings_locked(
            db,
            builder.PRODUCT_ID,
            normalized_base,
            bundle["profile"],
            bundle["narration_sha256"],
        )
        _require(len(bindings) == 13, "Narration profile bindings are incomplete")

        if raw_profile is None:
            _require(
                validation_metadata.get("admin_license_attestation_complete") is not True
                and validation_metadata.get("verified_private_upload_complete") is not True,
                "Profile completion gates are asserted without a profile",
            )
            state = "unapplied"
        else:
            _require(raw_profile == bundle["profile"], "Live narration profile drifted")
            normalized_current, _ = store._normalize_original_manifest(
                builder.PRODUCT_ID,
                str(pack["draft_title"]),
                manifest,
                publishing=False,
            )
            _require(normalized_current == normalized_candidate, "Live profiled manifest drifted")
            _require(
                validation_metadata.get("admin_license_attestation_complete") is True
                and validation_metadata.get("verified_private_upload_complete") is True,
                "Profile completion gates are incomplete",
            )
            state = "applied"
        _require(
            validation_metadata.get("authenticated_device_preview_complete") is not True
            and validation_metadata.get("trusted_publication_validation_complete") is not True
            and validation_metadata.get("public_release") is not True,
            "A downstream release gate changed unexpectedly",
        )
        return {
            "state": state,
            "draft_revision": int(pack["draft_revision"]),
            "base_manifest_sha256": base_manifest_sha256,
            "applied_manifest_sha256": applied_manifest_sha256,
            "profile_sha256": bundle["profile_sha256"],
            "validation_metadata": validation_metadata,
            "validation_metadata_sha256": _canonical_sha256(validation_metadata),
            "asset_count": len(rows),
            "narration_count": narration_count,
            "image_count": image_count,
            "asset_bytes": total_bytes,
            "published_version_count": published_count,
            "validation_report_count": validation_report_count,
            "bindings": bindings,
            "attesting_admin_id": attesting_admin_id,
        }
    finally:
        db.close()


def _public_inspection(inspection: dict[str, Any]) -> dict[str, Any]:
    return {
        "state": inspection["state"],
        "draft_revision": inspection["draft_revision"],
        "base_manifest_sha256": inspection["base_manifest_sha256"],
        "applied_manifest_sha256": inspection["applied_manifest_sha256"],
        "profile_sha256": inspection["profile_sha256"],
        "validation_metadata_sha256": inspection["validation_metadata_sha256"],
        "asset_count": inspection["asset_count"],
        "narration_count": inspection["narration_count"],
        "image_count": inspection["image_count"],
        "asset_bytes": inspection["asset_bytes"],
        "published_version_count": inspection["published_version_count"],
        "validation_report_count": inspection["validation_report_count"],
        "single_attesting_admin": True,
    }


def _report_identity(bundle: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    return {
        "report_id": REPORT_ID,
        "target_id": target["id"],
        "database_path_sha256": target["database_path_sha256"],
        "asset_root_path_sha256": target["asset_root_path_sha256"],
        "receipt_sha256": bundle["receipt_sha256"],
        "profile_file_sha256": bundle["profile_file_sha256"],
        "profile_sha256": bundle["profile_sha256"],
        "evidence_file_sha256": bundle["evidence_file_sha256"],
    }


def _validate_report_path(path: Path, target: dict[str, Any]) -> Path:
    _require(path.is_absolute(), "Report path must be absolute")
    parent = path.parent.resolve()
    database_parent = target["database_path"].parent.resolve()
    try:
        parent.relative_to(database_parent)
    except ValueError as exc:
        raise NarrationProfileOperatorError(
            "Report path must stay beneath the configured database volume"
        ) from exc
    resolved = parent / path.name
    _require(resolved != target["database_path"], "Report path collides with the database")
    try:
        resolved.relative_to(target["asset_root"])
    except ValueError:
        pass
    else:
        raise NarrationProfileOperatorError("Report path cannot be inside the asset root")
    for source in (
        builder.PROFILE_OUTPUT_PATH,
        builder.EVIDENCE_OUTPUT_PATH,
        builder.SOURCE_SPECS["private_import_receipt"].path,
    ):
        _require(resolved != source.resolve(), "Report path collides with immutable evidence")
    return resolved


def _atomic_write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    temporary = path.parent / f".{path.name}.{os.getpid()}.tmp"
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary.exists():
            temporary.unlink()


def _load_report(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    _require(path.is_file(), "Report destination is not a file")
    return _load_json(path)


def _require_report_identity(
    report: dict[str, Any], bundle: dict[str, Any], target: dict[str, Any]
) -> None:
    expected = _report_identity(bundle, target)
    _require(report.get("schema_version") == 1, "Profile report schema drifted")
    _require(report.get("identity") == expected, "Profile report identity drifted")
    rollback = report.get("rollback")
    _require(isinstance(rollback, dict), "Profile report rollback snapshot is missing")
    metadata = rollback.get("validation_metadata")
    _require(isinstance(metadata, dict), "Profile report rollback metadata is invalid")
    _require(
        rollback.get("validation_metadata_sha256") == _canonical_sha256(metadata),
        "Profile report rollback metadata hash drifted",
    )


@contextlib.contextmanager
def _operator_lock(report_path: Path) -> Iterator[None]:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = report_path.parent / f".{report_path.name}.lock"
    with lock_path.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def dry_run() -> dict[str, Any]:
    bundle = _load_bundle()
    target = _configured_target(bundle)
    inspection = _inspect_current(bundle, target)
    _require(inspection["state"] == "unapplied", "Narration profile is already applied")
    _require(inspection["draft_revision"] == 1, "Expected private draft revision 1")
    return {
        "status": "dry_run_verified",
        "target_id": TARGET_ID,
        "receipt_sha256": bundle["receipt_sha256"],
        "profile_file_sha256": bundle["profile_file_sha256"],
        "evidence_file_sha256": bundle["evidence_file_sha256"],
        "inspection": _public_inspection(inspection),
        "mutation_performed": False,
    }


def _prepared_report(
    bundle: dict[str, Any], target: dict[str, Any], inspection: dict[str, Any]
) -> dict[str, Any]:
    _require(inspection["state"] == "unapplied", "Cannot prepare from an applied state")
    _require(inspection["draft_revision"] == 1, "Expected private draft revision 1")
    return {
        "schema_version": 1,
        "identity": _report_identity(bundle, target),
        "state": "prepared",
        "prepared_at": _utc_now(),
        "expected": {
            "before_draft_revision": 1,
            "after_draft_revision": 2,
            "reverted_draft_revision": 3,
            "base_manifest_sha256": inspection["base_manifest_sha256"],
            "applied_manifest_sha256": inspection["applied_manifest_sha256"],
            "asset_sha256": copy.deepcopy(bundle["receipt_asset_sha256"]),
            "narration_sha256": copy.deepcopy(bundle["narration_sha256"]),
            "redacted_license_attestation_sha256": copy.deepcopy(
                bundle["redacted_attestation_sha256"]
            ),
        },
        "rollback": {
            "validation_metadata": copy.deepcopy(inspection["validation_metadata"]),
            "validation_metadata_sha256": inspection["validation_metadata_sha256"],
        },
        "preflight": _public_inspection(inspection),
        "expected_gates_after_apply": {
            "admin_license_attestation_complete": True,
            "verified_private_upload_complete": True,
            "authenticated_device_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
    }


def apply_private(report_path: Path = DEFAULT_REPORT_PATH) -> dict[str, Any]:
    bundle = _load_bundle()
    target = _configured_target(bundle)
    report_path = _validate_report_path(report_path, target)
    with _operator_lock(report_path):
        _require(
            report_path.parent.stat().st_dev
            == target["database_path"].stat().st_dev,
            "Rollback journal is not on the database volume",
        )
        report = _load_report(report_path)
        if report is None:
            inspection = _inspect_current(bundle, target)
            report = _prepared_report(bundle, target, inspection)
            _atomic_write_report(report_path, report)
        else:
            _require_report_identity(report, bundle, target)
            _require(
                report.get("state") in {"prepared", "applied_verified"},
                "Existing profile report is not apply-compatible",
            )

        inspection = _inspect_current(bundle, target)
        expected = report["expected"]
        rollback = report["rollback"]
        _require(
            inspection["base_manifest_sha256"] == expected["base_manifest_sha256"]
            and inspection["applied_manifest_sha256"] == expected["applied_manifest_sha256"],
            "Live manifest identity changed after journal preparation",
        )
        if inspection["state"] == "unapplied":
            _require(
                inspection["draft_revision"] == expected["before_draft_revision"],
                "Live draft revision changed after journal preparation",
            )
            _require(
                inspection["validation_metadata"] == rollback["validation_metadata"],
                "Live validation metadata changed after journal preparation",
            )
        else:
            _require(
                inspection["draft_revision"] == expected["after_draft_revision"],
                "Applied draft revision is not the expected revision",
            )

        result = store.apply_authored_original_narration_profile_v2(
            builder.PRODUCT_ID,
            expected_draft_revision=expected["before_draft_revision"],
            expected_base_manifest_sha256=expected["base_manifest_sha256"],
            expected_validation_metadata_sha256=inspection[
                "validation_metadata_sha256"
            ],
            expected_asset_sha256=expected["asset_sha256"],
            expected_redacted_license_attestation_sha256=expected[
                "redacted_license_attestation_sha256"
            ],
            narration_profile=bundle["profile"],
            admin_user_id=inspection["attesting_admin_id"],
        )
        if result["replayed"]:
            _require(
                result.get("rollback_validation_metadata") is None
                and result.get("rollback_validation_metadata_sha256") is None,
                "Replay unexpectedly replaced the rollback snapshot",
            )
        else:
            _require(
                result.get("rollback_validation_metadata")
                == rollback["validation_metadata"]
                and result.get("rollback_validation_metadata_sha256")
                == rollback["validation_metadata_sha256"],
                "Fresh apply rollback snapshot disagrees with the durable journal",
            )

        verified = _inspect_current(bundle, target)
        _require(verified["state"] == "applied", "Profile apply did not verify")
        _require(
            verified["draft_revision"] == expected["after_draft_revision"],
            "Profile apply revision did not verify",
        )
        _require(
            verified["applied_manifest_sha256"] == expected["applied_manifest_sha256"],
            "Profiled manifest hash did not verify",
        )
        expected_validation = copy.deepcopy(rollback["validation_metadata"])
        expected_validation["admin_license_attestation_complete"] = True
        expected_validation["verified_private_upload_complete"] = True
        _require(
            verified["validation_metadata"] == expected_validation,
            "Profile apply changed validation metadata beyond the two reviewed gates",
        )
        report["state"] = "applied_verified"
        report["applied_at"] = report.get("applied_at") or _utc_now()
        report["apply_replayed"] = bool(result["replayed"])
        report["post_apply"] = _public_inspection(verified)
        _atomic_write_report(report_path, report)
        return {
            "status": "verified_private_profile_apply",
            "target_id": TARGET_ID,
            "report_sha256": _sha256_path(report_path),
            "replayed": bool(result["replayed"]),
            "inspection": _public_inspection(verified),
            "gates": copy.deepcopy(report["expected_gates_after_apply"]),
        }


def verify_private(report_path: Path = DEFAULT_REPORT_PATH) -> dict[str, Any]:
    bundle = _load_bundle()
    target = _configured_target(bundle)
    report_path = _validate_report_path(report_path, target)
    report = _load_report(report_path)
    if report is not None:
        _require_report_identity(report, bundle, target)
    inspection = _inspect_current(bundle, target)
    expected_state = "unapplied" if report and report.get("state") == "reverted_verified" else "applied"
    _require(inspection["state"] == expected_state, "Live profile state does not match the report")
    if report is not None:
        expected_revision = (
            (
                report["expected"]["before_draft_revision"]
                if report.get("never_applied") is True
                else report["expected"]["reverted_draft_revision"]
            )
            if expected_state == "unapplied"
            else report["expected"]["after_draft_revision"]
        )
        _require(inspection["draft_revision"] == expected_revision, "Live draft revision does not match the report")
    return {
        "status": "verified_reverted_profile_state" if expected_state == "unapplied" else "verified_private_profile_state",
        "target_id": TARGET_ID,
        "report_sha256": _sha256_path(report_path) if report is not None else None,
        "inspection": _public_inspection(inspection),
        "mutation_performed": False,
    }


def revert_private(report_path: Path = DEFAULT_REPORT_PATH) -> dict[str, Any]:
    bundle = _load_bundle()
    target = _configured_target(bundle)
    report_path = _validate_report_path(report_path, target)
    with _operator_lock(report_path):
        _require(
            report_path.parent.stat().st_dev
            == target["database_path"].stat().st_dev,
            "Rollback journal is not on the database volume",
        )
        report = _load_report(report_path)
        _require(report is not None, "A durable profile report is required for revert")
        _require_report_identity(report, bundle, target)
        _require(
            report.get("state") in {"prepared", "applied_verified", "reverted_verified"},
            "Profile report is not revert-compatible",
        )
        inspection = _inspect_current(bundle, target)
        expected = report["expected"]
        rollback = report["rollback"]
        if (
            inspection["state"] == "unapplied"
            and inspection["draft_revision"] == expected["before_draft_revision"]
            and inspection["validation_metadata"] == rollback["validation_metadata"]
        ):
            report["state"] = "reverted_verified"
            report["never_applied"] = True
            report["reverted_at"] = report.get("reverted_at") or _utc_now()
            report["post_revert"] = _public_inspection(inspection)
            _atomic_write_report(report_path, report)
            return {
                "status": "verified_profile_never_applied",
                "target_id": TARGET_ID,
                "report_sha256": _sha256_path(report_path),
                "replayed": True,
                "inspection": _public_inspection(inspection),
            }

        result = store.revert_authored_original_narration_profile_v2(
            builder.PRODUCT_ID,
            expected_draft_revision=expected["after_draft_revision"],
            expected_profile_sha256=bundle["profile_sha256"],
            expected_applied_manifest_sha256=expected["applied_manifest_sha256"],
            expected_base_manifest_sha256=expected["base_manifest_sha256"],
            expected_narration_sha256=expected["narration_sha256"],
            narration_profile=bundle["profile"],
            restore_validation_metadata=rollback["validation_metadata"],
            admin_user_id=inspection["attesting_admin_id"],
        )
        verified = _inspect_current(bundle, target)
        _require(verified["state"] == "unapplied", "Profile revert did not verify")
        _require(
            verified["draft_revision"] == expected["reverted_draft_revision"],
            "Profile revert revision did not verify",
        )
        _require(
            verified["validation_metadata"] == rollback["validation_metadata"],
            "Profile revert did not restore exact validation metadata",
        )
        report["state"] = "reverted_verified"
        report["never_applied"] = False
        report["reverted_at"] = report.get("reverted_at") or _utc_now()
        report["revert_replayed"] = bool(result["replayed"])
        report["post_revert"] = _public_inspection(verified)
        _atomic_write_report(report_path, report)
        return {
            "status": "verified_profile_revert",
            "target_id": TARGET_ID,
            "report_sha256": _sha256_path(report_path),
            "replayed": bool(result["replayed"]),
            "inspection": _public_inspection(verified),
        }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--apply", action="store_true", help="Apply the exact private profile")
    modes.add_argument("--verify", action="store_true", help="Verify the exact current profile state")
    modes.add_argument("--revert", action="store_true", help="Revert only the journaled profile change")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.apply:
            result = apply_private(args.report)
        elif args.verify:
            result = verify_private(args.report)
        elif args.revert:
            result = revert_private(args.report)
        else:
            result = dry_run()
    except NarrationProfileOperatorError as exc:
        print(json.dumps({"status": "failed", "reason": str(exc)}, sort_keys=True), file=sys.stderr)
        return 1
    except sqlite3.Error:
        print(
            json.dumps(
                {"status": "failed", "reason": "Database verification failed"},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    except OSError:
        print(
            json.dumps(
                {"status": "failed", "reason": "Filesystem verification failed"},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    except (ValueError, PermissionError) as exc:
        print(json.dumps({"status": "failed", "reason": str(exc)}, sort_keys=True), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
