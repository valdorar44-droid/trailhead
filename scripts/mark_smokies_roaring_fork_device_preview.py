#!/usr/bin/env python3
"""Guarded operator for Roaring Fork authenticated Android preview proof.

The default mode is a read-only dry run. Apply journals the exact redacted
evidence and CAS inputs before invoking the store-only completion path. This
script has no HTTP, upload, validation-run, publish, or draft-edit operation.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
from typing import Any, Iterator

REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from db import store


REPORT_ID = "smokies_roaring_fork_authenticated_device_preview_20260810_v1"
EVIDENCE_ID = "roaring_fork_authenticated_device_preview_20260810_v1"
TARGET_ID = "railway.trailhead.production.private"
PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
DEFAULT_EVIDENCE_PATH = Path(
    os.environ.get("TRAILHEAD_S4Q_EVIDENCE_PATH")
    or "/data/originals/evidence/roaring-fork-device-preview-20260810-v1.json"
)
DEFAULT_REPORT_PATH = Path(
    os.environ.get("TRAILHEAD_S4Q_REPORT_PATH")
    or "/data/originals/reports/roaring-fork-device-preview-completion-v1.json"
)
DEFAULT_RELEASE_SHA = os.environ.get("TRAILHEAD_S4Q_RELEASE_SHA")
DEFAULT_UPDATE_ID = os.environ.get("TRAILHEAD_S4Q_UPDATE_ID")


class DevicePreviewOperatorError(RuntimeError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise DevicePreviewOperatorError(message)


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
    except (OSError, json.JSONDecodeError) as exc:
        raise DevicePreviewOperatorError(
            f"Required JSON is unavailable or invalid: {path.name}"
        ) from exc
    _require(isinstance(value, dict), f"Required JSON is not an object: {path.name}")
    return value


def _beneath(path: Path, parent: Path, message: str) -> None:
    try:
        path.relative_to(parent)
    except ValueError as exc:
        raise DevicePreviewOperatorError(message) from exc


def _validated_evidence_path(path: Path, target: dict[str, Any]) -> Path:
    _require(path.is_absolute(), "Evidence path must be absolute")
    resolved = path.resolve()
    _require(resolved.is_file(), "Redacted device evidence file is unavailable")
    _beneath(
        resolved,
        target["database_path"].parent.resolve(),
        "Evidence path must stay beneath the configured database volume",
    )
    try:
        resolved.relative_to(target["asset_root"])
    except ValueError:
        pass
    else:
        raise DevicePreviewOperatorError("Evidence path cannot be inside the asset root")
    _require(resolved != target["database_path"], "Evidence path collides with the database")
    return resolved


def _validated_report_path(path: Path, target: dict[str, Any]) -> Path:
    _require(path.is_absolute(), "Report path must be absolute")
    parent = path.parent.resolve()
    _beneath(
        parent,
        target["database_path"].parent.resolve(),
        "Report path must stay beneath the configured database volume",
    )
    resolved = parent / path.name
    _require(resolved != target["database_path"], "Report path collides with the database")
    try:
        resolved.relative_to(target["asset_root"])
    except ValueError:
        pass
    else:
        raise DevicePreviewOperatorError("Report path cannot be inside the asset root")
    return resolved


def _read_connection(database_path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(f"{database_path.as_uri()}?mode=ro", uri=True, timeout=60)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    return db


def _json_column(value: object, label: str) -> dict[str, Any]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError) as exc:
        raise DevicePreviewOperatorError(f"{label} is invalid") from exc
    _require(isinstance(decoded, dict), f"{label} is invalid")
    return decoded


def _load_context(
    evidence_path: Path,
    expected_release_sha: str | None,
    expected_update_id: str | None,
) -> tuple[
    dict[str, Any], dict[str, Any], Path, dict[str, Any], dict[str, str]
]:
    # Keep the larger immutable-profile builder lazy so `--help` and the
    # default-running unit tests do not initialize the web application.
    import scripts.apply_smokies_roaring_fork_narration_profile as profile_operator

    try:
        bundle = profile_operator._load_bundle()
        target = profile_operator._configured_target(bundle)
    except profile_operator.NarrationProfileOperatorError as exc:
        raise DevicePreviewOperatorError(str(exc)) from exc
    evidence_path = _validated_evidence_path(evidence_path, target)
    _require(
        evidence_path.stat().st_dev == target["database_path"].stat().st_dev,
        "Redacted device evidence is not on the database volume",
    )
    evidence = _load_json(evidence_path)
    _require(
        evidence.get("evidence_id") == EVIDENCE_ID,
        "Redacted device evidence id is not the reviewed id",
    )
    _require(
        isinstance(expected_release_sha, str)
        and len(expected_release_sha) == 40
        and all(character in "0123456789abcdef" for character in expected_release_sha),
        "Expected Trailhead preview release SHA must be explicit exact lowercase SHA-1",
    )
    _require(
        isinstance(expected_update_id, str)
        and 8 <= len(expected_update_id) <= 128
        and expected_update_id[0].isalnum()
        and all(
            character.isalnum() or character in "._:-"
            for character in expected_update_id
        ),
        "Expected Trailhead preview update id must be explicit and exact",
    )
    application = evidence.get("application")
    expected_application = {
        "platform": "android",
        "app_version": "1.0.12",
        "build_number": "73",
        "channel": "preview",
        "runtime_version": "native-1.0.12-android.1",
        "release_sha": expected_release_sha,
        "update_id": expected_update_id,
    }
    _require(
        application == expected_application,
        "Redacted evidence does not match the exact Trailhead Android preview build",
    )
    return bundle, target, evidence_path, evidence, expected_application


def _inspect_current(
    bundle: dict[str, Any],
    target: dict[str, Any],
    evidence: dict[str, Any],
    expected_application: dict[str, str],
) -> dict[str, Any]:
    db = _read_connection(target["database_path"])
    try:
        quick = db.execute("PRAGMA quick_check").fetchall()
        _require(
            len(quick) == 1 and str(quick[0][0]).lower() == "ok",
            "SQLite quick_check failed",
        )
        pack = db.execute(
            """SELECT * FROM authored_trip_packs
               WHERE id=? AND content_kind='original_drive'""",
            (PRODUCT_ID,),
        ).fetchone()
        _require(pack is not None, "Roaring Fork private draft is unavailable")
        _require(
            pack["status"] == "draft"
            and pack["current_published_version"] is None
            and int(pack["draft_revision"]) == 2,
            "Roaring Fork is not exact unpublished revision 2",
        )
        published_count = int(db.execute(
            "SELECT COUNT(*) FROM authored_trip_pack_versions WHERE pack_id=?",
            (PRODUCT_ID,),
        ).fetchone()[0])
        report_count = int(db.execute(
            "SELECT COUNT(*) FROM authored_original_validation_reports WHERE pack_id=?",
            (PRODUCT_ID,),
        ).fetchone()[0])
        _require(published_count == 0, "Roaring Fork has a published version")
        _require(report_count == 0, "Trusted publication validation has already started")

        manifest = _json_column(pack["draft_original_manifest_json"], "Draft manifest")
        normalized_manifest, _ = store._normalize_original_manifest(
            PRODUCT_ID,
            str(pack["draft_title"]),
            manifest,
            publishing=False,
        )
        manifest_sha256 = store._original_validation_hash(normalized_manifest)
        _require(
            manifest_sha256 == bundle["expected_applied_manifest_sha256"],
            "Live profiled manifest hash drifted",
        )
        profile = normalized_manifest.get("narration_profile")
        _require(
            isinstance(profile, dict)
            and profile == bundle["profile"]
            and store._original_validation_hash(profile) == bundle["profile_sha256"],
            "Live narration profile drifted",
        )
        base = copy.deepcopy(normalized_manifest)
        base.pop("narration_profile", None)
        normalized_base, _ = store._normalize_original_manifest(
            PRODUCT_ID,
            str(pack["draft_title"]),
            base,
            publishing=False,
        )
        _require(
            store._original_validation_hash(normalized_base)
            == bundle["expected_base_manifest_sha256"],
            "Live profile-absent manifest hash drifted",
        )

        validation = _json_column(
            pack["draft_validation_metadata"], "Draft validation metadata",
        )
        _require(
            validation.get("admin_license_attestation_complete") is True
            and validation.get("verified_private_upload_complete") is True,
            "Upstream profile gates are incomplete",
        )
        _require(
            validation.get("trusted_publication_validation_complete") is False
            and validation.get("public_release") is False,
            "A downstream publication gate changed",
        )

        rows = db.execute(
            """SELECT * FROM authored_original_assets
               WHERE pack_id=? AND is_current=1 ORDER BY asset_id""",
            (PRODUCT_ID,),
        ).fetchall()
        current = {str(row["asset_id"]): dict(row) for row in rows}
        _require(
            set(current) == set(bundle["receipt_asset_sha256"])
            and len(current) == 20,
            "Current twenty-asset membership drifted",
        )
        total_bytes = 0
        admin_ids: set[int] = set()
        for asset_id in sorted(current):
            row = current[asset_id]
            expected_sha256 = bundle["receipt_asset_sha256"][asset_id]
            path = Path(str(row["storage_path"])).resolve()
            try:
                path.relative_to(target["asset_root"])
            except ValueError as exc:
                raise DevicePreviewOperatorError(
                    f"Current asset escaped the configured asset root: {asset_id}"
                ) from exc
            _require(
                row["sha256"] == expected_sha256
                and path.is_file()
                and path.stat().st_size == int(row["byte_count"])
                and _sha256_path(path) == expected_sha256,
                f"Current asset bytes drifted: {asset_id}",
            )
            total_bytes += int(row["byte_count"])
            if row["kind"] == "narration":
                generator = _json_column(
                    row["generator_metadata_json"],
                    f"Narration generator metadata for {asset_id}",
                )
                _require(
                    store._original_generator_license_attestation_complete(generator),
                    f"Narration attestation is incomplete: {asset_id}",
                )
                attestation = generator["license_attestation"]
                _require(
                    store.original_redacted_license_attestation_sha256(attestation)
                    == bundle["redacted_attestation_sha256"][asset_id],
                    f"Redacted narration attestation drifted: {asset_id}",
                )
                admin_ids.add(int(attestation["attested_by_admin_user_id"]))
        _require(
            total_bytes == 239_772_665,
            "Current exact asset-byte total drifted",
        )
        _require(len(admin_ids) == 1, "Narrations no longer share one current admin")
        admin_user_id = next(iter(admin_ids))
        admin = db.execute(
            "SELECT is_admin FROM users WHERE id=?", (admin_user_id,),
        ).fetchone()
        _require(admin is not None and bool(admin["is_admin"]), "Attesting admin is no longer current")
        bindings = store._validate_original_narration_profile_bindings_locked(
            db,
            PRODUCT_ID,
            normalized_base,
            profile,
            bundle["narration_sha256"],
        )
        _require(
            len(bindings) == 13
            and {
                binding["asset_id"]: binding[
                    "redacted_license_attestation_sha256"
                ]
                for binding in bindings
            } == bundle["redacted_attestation_sha256"],
            "Exact thirteen narration bindings drifted",
        )

        chapter = normalized_manifest["chapters"][0]
        variant = chapter["variants"][0]
        _require(
            chapter["id"] == "roaring_fork"
            and variant["id"] == "one_way"
            and len(normalized_manifest["chapters"]) == 1
            and len(chapter["variants"]) == 1,
            "Reviewed chapter or variant membership drifted",
        )
        hard_ids = [item["story_id"] for item in variant["cue_refs"]]
        selectable_ids = [
            item["story_id"] for item in variant["selectable_refs"]
        ]
        preview = store._authored_original_preview_manifest_from_row(
            pack,
            store._verified_original_asset_map_db(db, PRODUCT_ID),
            chapter_id="roaring_fork",
            variant_id="one_way",
        )
        gate = validation.get("authenticated_device_preview_complete")
        state = "pending" if gate is False else "applied" if gate is True else "invalid"
        _require(state != "invalid", "Device preview gate is not boolean")
        normalized_evidence = store._normalize_original_device_preview_completion_evidence(
            evidence,
            pack_id=PRODUCT_ID,
            draft_revision=2,
            preview_manifest=preview,
            chapter_id="roaring_fork",
            variant_id="one_way",
            delivery_contract_sha256=variant["delivery_contract_sha256"],
            hard_auto_story_ids=hard_ids,
            selectable_story_ids=selectable_ids,
            asset_ids=sorted(bundle["receipt_asset_sha256"]),
            expected_application_release_sha=expected_application["release_sha"],
            expected_application_update_id=expected_application["update_id"],
            require_recent=state == "pending",
        )
        evidence_sha256 = _canonical_sha256(normalized_evidence)
        if state == "pending":
            _require(
                validation.get("authenticated_device_preview_evidence") is None
                and validation.get("authenticated_device_preview_evidence_sha256") is None,
                "Pending preview gate already has evidence",
            )
        else:
            _require(
                validation.get("authenticated_device_preview_evidence")
                == normalized_evidence
                and validation.get("authenticated_device_preview_evidence_sha256")
                == evidence_sha256,
                "Stored immutable device preview evidence drifted",
            )
        return {
            "state": state,
            "draft_revision": 2,
            "base_manifest_sha256": bundle["expected_base_manifest_sha256"],
            "manifest_sha256": manifest_sha256,
            "profile_sha256": bundle["profile_sha256"],
            "preview_manifest_sha256": store._original_validation_hash(preview),
            "validation_metadata_sha256": _canonical_sha256(validation),
            "validation_metadata": copy.deepcopy(validation),
            "evidence_sha256": evidence_sha256,
            "asset_count": 20,
            "narration_count": 13,
            "asset_bytes": total_bytes,
            "reviewed_story_count": 13,
            "hard_auto_story_count": 5,
            "selectable_story_count": 8,
            "published_version_count": published_count,
            "validation_report_count": report_count,
            "admin_user_id": admin_user_id,
        }
    finally:
        db.close()


def _public_inspection(inspection: dict[str, Any]) -> dict[str, Any]:
    return {
        key: inspection[key]
        for key in (
            "state",
            "draft_revision",
            "base_manifest_sha256",
            "manifest_sha256",
            "profile_sha256",
            "preview_manifest_sha256",
            "validation_metadata_sha256",
            "evidence_sha256",
            "asset_count",
            "narration_count",
            "asset_bytes",
            "reviewed_story_count",
            "hard_auto_story_count",
            "selectable_story_count",
            "published_version_count",
            "validation_report_count",
        )
    }


def _identity(
    bundle: dict[str, Any],
    target: dict[str, Any],
    evidence_path: Path,
    evidence: dict[str, Any],
    expected_application: dict[str, str],
) -> dict[str, Any]:
    return {
        "report_id": REPORT_ID,
        "target_id": TARGET_ID,
        "database_path_sha256": target["database_path_sha256"],
        "asset_root_path_sha256": target["asset_root_path_sha256"],
        "receipt_sha256": bundle["receipt_sha256"],
        "profile_sha256": bundle["profile_sha256"],
        "evidence_file_sha256": _sha256_path(evidence_path),
        "evidence_sha256": _canonical_sha256(evidence),
        "application": copy.deepcopy(expected_application),
    }


def _expected_bindings(bundle: dict[str, Any]) -> dict[str, Any]:
    return {
        "draft_revision": 2,
        "base_manifest_sha256": bundle["expected_base_manifest_sha256"],
        "manifest_sha256": bundle["expected_applied_manifest_sha256"],
        "profile_sha256": bundle["profile_sha256"],
        "asset_sha256": copy.deepcopy(bundle["receipt_asset_sha256"]),
        "narration_sha256": copy.deepcopy(bundle["narration_sha256"]),
        "redacted_license_attestation_sha256": copy.deepcopy(
            bundle["redacted_attestation_sha256"]
        ),
    }


_PUBLIC_INSPECTION_KEYS = {
    "state",
    "draft_revision",
    "base_manifest_sha256",
    "manifest_sha256",
    "profile_sha256",
    "preview_manifest_sha256",
    "validation_metadata_sha256",
    "evidence_sha256",
    "asset_count",
    "narration_count",
    "asset_bytes",
    "reviewed_story_count",
    "hard_auto_story_count",
    "selectable_story_count",
    "published_version_count",
    "validation_report_count",
}


def _validation_snapshot(inspection: dict[str, Any]) -> dict[str, Any]:
    metadata = copy.deepcopy(inspection["validation_metadata"])
    return {
        "validation_metadata": metadata,
        "validation_metadata_sha256": _canonical_sha256(metadata),
    }


def _expected_applied_validation(
    rollback: dict[str, Any], evidence: dict[str, Any]
) -> dict[str, Any]:
    metadata = copy.deepcopy(rollback["validation_metadata"])
    metadata["authenticated_device_preview_complete"] = True
    metadata["authenticated_device_preview_evidence"] = copy.deepcopy(evidence)
    metadata["authenticated_device_preview_evidence_sha256"] = _canonical_sha256(
        evidence
    )
    return metadata


def _expected_preflight_public(
    bundle: dict[str, Any],
    identity: dict[str, Any],
    evidence: dict[str, Any],
    rollback: dict[str, Any],
) -> dict[str, Any]:
    return {
        "state": "pending",
        "draft_revision": 2,
        "base_manifest_sha256": bundle["expected_base_manifest_sha256"],
        "manifest_sha256": bundle["expected_applied_manifest_sha256"],
        "profile_sha256": bundle["profile_sha256"],
        "preview_manifest_sha256": evidence["preview"]["manifest_sha256"],
        "validation_metadata_sha256": rollback[
            "validation_metadata_sha256"
        ],
        "evidence_sha256": identity["evidence_sha256"],
        "asset_count": 20,
        "narration_count": 13,
        "asset_bytes": 239_772_665,
        "reviewed_story_count": 13,
        "hard_auto_story_count": 5,
        "selectable_story_count": 8,
        "published_version_count": 0,
        "validation_report_count": 0,
    }


def _expected_applied_public(
    preflight: dict[str, Any], applied: dict[str, Any]
) -> dict[str, Any]:
    result = copy.deepcopy(preflight)
    result["state"] = "applied"
    result["validation_metadata_sha256"] = applied[
        "validation_metadata_sha256"
    ]
    return result


def _require_report(
    report: dict[str, Any],
    identity: dict[str, Any],
    bundle: dict[str, Any],
    evidence: dict[str, Any],
    *,
    allowed_states: set[str],
) -> None:
    state = report.get("state")
    base_keys = {
        "schema_version", "identity", "state", "preflight", "expected", "rollback",
    }
    _require(
        report.get("schema_version") == 2
        and report.get("identity") == identity
        and state in allowed_states
        and report.get("expected") == _expected_bindings(bundle),
        "Existing device preview report identity, bindings, or state drifted",
    )
    rollback = report.get("rollback")
    _require(
        isinstance(rollback, dict)
        and set(rollback)
        == {"validation_metadata", "validation_metadata_sha256"}
        and isinstance(rollback.get("validation_metadata"), dict)
        and rollback.get("validation_metadata_sha256")
        == _canonical_sha256(rollback.get("validation_metadata")),
        "Device preview report rollback snapshot drifted",
    )
    rollback_metadata = rollback["validation_metadata"]
    _require(
        rollback_metadata.get("admin_license_attestation_complete") is True
        and rollback_metadata.get("verified_private_upload_complete") is True
        and rollback_metadata.get("authenticated_device_preview_complete") is False
        and rollback_metadata.get("trusted_publication_validation_complete") is False
        and rollback_metadata.get("public_release") is False
        and rollback_metadata.get("authenticated_device_preview_evidence") is None
        and rollback_metadata.get("authenticated_device_preview_evidence_sha256")
        is None,
        "Device preview report rollback gates drifted",
    )
    preflight = report.get("preflight")
    expected_preflight = _expected_preflight_public(
        bundle, identity, evidence, rollback,
    )
    _require(
        isinstance(preflight, dict)
        and set(preflight) == _PUBLIC_INSPECTION_KEYS
        and preflight == expected_preflight,
        "Device preview report preflight drifted",
    )

    applied_metadata = _expected_applied_validation(rollback, evidence)
    applied = {
        "validation_metadata": applied_metadata,
        "validation_metadata_sha256": _canonical_sha256(applied_metadata),
    }
    expected_post_apply = _expected_applied_public(preflight, applied)

    if state == "prepared":
        expected_keys = base_keys
    elif state == "applied_verified":
        expected_keys = base_keys | {"post_apply", "applied"}
        _require(
            report.get("applied") == applied
            and report.get("post_apply") == expected_post_apply,
            "Device preview report applied state drifted",
        )
    elif state == "reverted_never_applied":
        expected_keys = base_keys | {"post_revert"}
        _require(
            report.get("post_revert") == expected_preflight,
            "Device preview report reverted state drifted",
        )
    else:
        expected_keys = base_keys | {"post_revert", "post_apply", "applied"}
        _require(
            report.get("post_revert") == expected_preflight
            and report.get("applied") == applied
            and report.get("post_apply") == expected_post_apply,
            "Device preview report recovered applied state drifted",
        )
    _require(
        set(report) == expected_keys,
        "Device preview report has extra or missing state fields",
    )


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
    return _load_json(path) if path.exists() else None


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


def dry_run(
    evidence_path: Path = DEFAULT_EVIDENCE_PATH,
    expected_release_sha: str | None = DEFAULT_RELEASE_SHA,
    expected_update_id: str | None = DEFAULT_UPDATE_ID,
) -> dict[str, Any]:
    bundle, target, _path, evidence, application = _load_context(
        evidence_path, expected_release_sha, expected_update_id,
    )
    inspection = _inspect_current(bundle, target, evidence, application)
    _require(inspection["state"] == "pending", "Device preview evidence is already applied")
    return {
        "status": "dry_run_verified",
        "target_id": TARGET_ID,
        "inspection": _public_inspection(inspection),
        "mutation_performed": False,
    }


def apply_private(
    evidence_path: Path = DEFAULT_EVIDENCE_PATH,
    report_path: Path = DEFAULT_REPORT_PATH,
    expected_release_sha: str | None = DEFAULT_RELEASE_SHA,
    expected_update_id: str | None = DEFAULT_UPDATE_ID,
) -> dict[str, Any]:
    bundle, target, evidence_path, evidence, application = _load_context(
        evidence_path, expected_release_sha, expected_update_id,
    )
    report_path = _validated_report_path(report_path, target)
    with _operator_lock(report_path):
        _require(
            report_path.parent.stat().st_dev == target["database_path"].stat().st_dev,
            "Device preview report is not on the database volume",
        )
        identity = _identity(
            bundle, target, evidence_path, evidence, application,
        )
        report = _load_report(report_path)
        if report is None:
            inspection = _inspect_current(
                bundle, target, evidence, application,
            )
            _require(inspection["state"] == "pending", "Cannot prepare from applied state")
            rollback = _validation_snapshot(inspection)
            report = {
                "schema_version": 2,
                "identity": identity,
                "state": "prepared",
                "preflight": _public_inspection(inspection),
                "expected": _expected_bindings(bundle),
                "rollback": rollback,
            }
            _require_report(
                report,
                identity,
                bundle,
                evidence,
                allowed_states={"prepared"},
            )
            _atomic_write_report(report_path, report)
        else:
            _require_report(
                report,
                identity,
                bundle,
                evidence,
                allowed_states={"prepared", "applied_verified"},
            )

        inspection = _inspect_current(bundle, target, evidence, application)
        expected = report["expected"]
        _require(
            inspection["draft_revision"] == expected["draft_revision"]
            and inspection["base_manifest_sha256"] == expected["base_manifest_sha256"]
            and inspection["manifest_sha256"] == expected["manifest_sha256"]
            and inspection["profile_sha256"] == expected["profile_sha256"],
            "Live exact draft identity changed after report preparation",
        )
        if report["state"] == "applied_verified":
            _require(
                _public_inspection(inspection) == report["post_apply"]
                and inspection["validation_metadata"]
                == report["applied"]["validation_metadata"],
                "Live applied state drifted from the exact report",
            )
            return {
                "status": "verified_authenticated_device_preview_completion",
                "target_id": TARGET_ID,
                "report_sha256": _sha256_path(report_path),
                "replayed": True,
                "inspection": _public_inspection(inspection),
            }

        rollback = report["rollback"]
        expected_applied_metadata = _expected_applied_validation(
            rollback, evidence,
        )
        expected_applied_snapshot = {
            "validation_metadata": expected_applied_metadata,
            "validation_metadata_sha256": _canonical_sha256(
                expected_applied_metadata
            ),
        }
        if inspection["state"] == "pending":
            _require(
                _public_inspection(inspection) == report["preflight"]
                and inspection["validation_metadata"]
                == rollback["validation_metadata"],
                "Live pending state drifted from the exact report",
            )
        else:
            _require(
                _public_inspection(inspection)
                == _expected_applied_public(
                    report["preflight"], expected_applied_snapshot,
                )
                and inspection["validation_metadata"]
                == expected_applied_metadata,
                "Recovered applied state drifted from the exact report",
            )
        result = store.mark_authored_original_device_preview_complete(
            PRODUCT_ID,
            expected_draft_revision=2,
            expected_base_manifest_sha256=expected["base_manifest_sha256"],
            expected_manifest_sha256=expected["manifest_sha256"],
            expected_profile_sha256=expected["profile_sha256"],
            expected_validation_metadata_sha256=inspection[
                "validation_metadata_sha256"
            ],
            expected_asset_sha256=expected["asset_sha256"],
            expected_narration_sha256=expected["narration_sha256"],
            expected_redacted_license_attestation_sha256=expected[
                "redacted_license_attestation_sha256"
            ],
            expected_application_release_sha=application["release_sha"],
            expected_application_update_id=application["update_id"],
            evidence=evidence,
            admin_user_id=inspection["admin_user_id"],
        )
        verified = _inspect_current(bundle, target, evidence, application)
        _require(verified["state"] == "applied", "Device preview completion did not verify")
        _require(
            result["evidence_sha256"] == verified["evidence_sha256"],
            "Stored device preview evidence hash did not verify",
        )
        _require(
            verified["validation_metadata"] == expected_applied_metadata
            and _public_inspection(verified)
            == _expected_applied_public(
                report["preflight"], expected_applied_snapshot,
            ),
            "Applied validation metadata changed beyond the exact evidence assertion",
        )
        report = {
            "schema_version": 2,
            "identity": identity,
            "state": "applied_verified",
            "preflight": copy.deepcopy(report["preflight"]),
            "expected": copy.deepcopy(report["expected"]),
            "rollback": copy.deepcopy(rollback),
            "post_apply": _public_inspection(verified),
            "applied": _validation_snapshot(verified),
        }
        _require_report(
            report,
            identity,
            bundle,
            evidence,
            allowed_states={"applied_verified"},
        )
        _atomic_write_report(report_path, report)
        return {
            "status": "verified_authenticated_device_preview_completion",
            "target_id": TARGET_ID,
            "report_sha256": _sha256_path(report_path),
            "replayed": bool(result["replayed"]),
            "inspection": _public_inspection(verified),
        }


def verify_private(
    evidence_path: Path = DEFAULT_EVIDENCE_PATH,
    report_path: Path = DEFAULT_REPORT_PATH,
    expected_release_sha: str | None = DEFAULT_RELEASE_SHA,
    expected_update_id: str | None = DEFAULT_UPDATE_ID,
) -> dict[str, Any]:
    bundle, target, evidence_path, evidence, application = _load_context(
        evidence_path, expected_release_sha, expected_update_id,
    )
    report_path = _validated_report_path(report_path, target)
    report = _load_report(report_path)
    _require(report is not None, "Applied device preview report is unavailable")
    _require_report(
        report,
        _identity(bundle, target, evidence_path, evidence, application),
        bundle,
        evidence,
        allowed_states={
            "applied_verified", "reverted_verified", "reverted_never_applied",
        },
    )
    inspection = _inspect_current(bundle, target, evidence, application)
    if report["state"] == "applied_verified":
        expected_public = report["post_apply"]
        expected_validation = report["applied"]["validation_metadata"]
    else:
        expected_public = report["post_revert"]
        expected_validation = report["rollback"]["validation_metadata"]
    _require(
        _public_inspection(inspection) == expected_public
        and inspection["validation_metadata"] == expected_validation,
        "Live device preview state does not match the exact report",
    )
    return {
        "status": (
            "verified_authenticated_device_preview_state"
            if report["state"] == "applied_verified"
            else "verified_reverted_device_preview_state"
        ),
        "target_id": TARGET_ID,
        "report_sha256": _sha256_path(report_path),
        "inspection": _public_inspection(inspection),
        "mutation_performed": False,
    }


def revert_private(
    evidence_path: Path = DEFAULT_EVIDENCE_PATH,
    report_path: Path = DEFAULT_REPORT_PATH,
    expected_release_sha: str | None = DEFAULT_RELEASE_SHA,
    expected_update_id: str | None = DEFAULT_UPDATE_ID,
) -> dict[str, Any]:
    bundle, target, evidence_path, evidence, application = _load_context(
        evidence_path, expected_release_sha, expected_update_id,
    )
    report_path = _validated_report_path(report_path, target)
    with _operator_lock(report_path):
        _require(
            report_path.parent.stat().st_dev
            == target["database_path"].stat().st_dev,
            "Device preview report is not on the database volume",
        )
        report = _load_report(report_path)
        _require(report is not None, "A durable device preview report is required")
        identity = _identity(
            bundle, target, evidence_path, evidence, application,
        )
        _require_report(
            report,
            identity,
            bundle,
            evidence,
            allowed_states={
                "prepared",
                "applied_verified",
                "reverted_verified",
                "reverted_never_applied",
            },
        )
        inspection = _inspect_current(bundle, target, evidence, application)
        if report["state"] in {
            "reverted_verified", "reverted_never_applied",
        }:
            _require(
                _public_inspection(inspection) == report["post_revert"]
                and inspection["validation_metadata"]
                == report["rollback"]["validation_metadata"],
                "Live reverted state drifted from the exact report",
            )
            return {
                "status": "verified_device_preview_revert",
                "target_id": TARGET_ID,
                "report_sha256": _sha256_path(report_path),
                "replayed": True,
                "inspection": _public_inspection(inspection),
            }

        rollback = report["rollback"]
        expected_applied_metadata = _expected_applied_validation(
            rollback, evidence,
        )
        applied_snapshot = {
            "validation_metadata": expected_applied_metadata,
            "validation_metadata_sha256": _canonical_sha256(
                expected_applied_metadata
            ),
        }
        expected_applied_public = _expected_applied_public(
            report["preflight"], applied_snapshot,
        )
        if inspection["state"] == "pending":
            _require(
                _public_inspection(inspection) == report["preflight"]
                and inspection["validation_metadata"]
                == rollback["validation_metadata"],
                "Live restored state drifted from the rollback journal",
            )
        else:
            _require(
                _public_inspection(inspection) == expected_applied_public
                and inspection["validation_metadata"]
                == expected_applied_metadata,
                "Live applied state drifted from the rollback journal",
            )

        never_applied = report["state"] == "prepared" and inspection[
            "state"
        ] == "pending"
        result = store.revert_authored_original_device_preview_complete(
            PRODUCT_ID,
            expected_draft_revision=2,
            expected_base_manifest_sha256=report["expected"][
                "base_manifest_sha256"
            ],
            expected_manifest_sha256=report["expected"]["manifest_sha256"],
            expected_profile_sha256=report["expected"]["profile_sha256"],
            expected_applied_validation_metadata_sha256=applied_snapshot[
                "validation_metadata_sha256"
            ],
            expected_asset_sha256=report["expected"]["asset_sha256"],
            expected_narration_sha256=report["expected"]["narration_sha256"],
            expected_redacted_license_attestation_sha256=report["expected"][
                "redacted_license_attestation_sha256"
            ],
            expected_application_release_sha=application["release_sha"],
            expected_application_update_id=application["update_id"],
            evidence=evidence,
            restore_validation_metadata=rollback["validation_metadata"],
            expected_restore_validation_metadata_sha256=rollback[
                "validation_metadata_sha256"
            ],
            admin_user_id=inspection["admin_user_id"],
        )
        verified = _inspect_current(bundle, target, evidence, application)
        _require(
            verified["state"] == "pending"
            and _public_inspection(verified) == report["preflight"]
            and verified["validation_metadata"]
            == rollback["validation_metadata"],
            "Device preview revert did not restore exact preflight state",
        )
        reverted_report = {
            "schema_version": 2,
            "identity": identity,
            "state": (
                "reverted_never_applied" if never_applied else "reverted_verified"
            ),
            "preflight": copy.deepcopy(report["preflight"]),
            "expected": copy.deepcopy(report["expected"]),
            "rollback": copy.deepcopy(rollback),
            "post_revert": _public_inspection(verified),
        }
        if not never_applied:
            if report["state"] == "applied_verified":
                reverted_report["post_apply"] = copy.deepcopy(
                    report["post_apply"]
                )
                reverted_report["applied"] = copy.deepcopy(report["applied"])
            else:
                reverted_report["post_apply"] = expected_applied_public
                reverted_report["applied"] = applied_snapshot
        _require_report(
            reverted_report,
            identity,
            bundle,
            evidence,
            allowed_states={reverted_report["state"]},
        )
        _atomic_write_report(report_path, reverted_report)
        return {
            "status": "verified_device_preview_revert",
            "target_id": TARGET_ID,
            "report_sha256": _sha256_path(report_path),
            "replayed": bool(result["replayed"]),
            "inspection": _public_inspection(verified),
        }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--apply", action="store_true", help="Apply exact redacted device proof")
    modes.add_argument("--verify", action="store_true", help="Verify applied proof and report")
    modes.add_argument("--revert", action="store_true", help="Restore only the journaled preflight metadata")
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE_PATH)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument("--release-sha", default=DEFAULT_RELEASE_SHA)
    parser.add_argument("--update-id", default=DEFAULT_UPDATE_ID)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.apply:
            result = apply_private(
                args.evidence,
                args.report,
                args.release_sha,
                args.update_id,
            )
        elif args.verify:
            result = verify_private(
                args.evidence,
                args.report,
                args.release_sha,
                args.update_id,
            )
        elif args.revert:
            result = revert_private(
                args.evidence,
                args.report,
                args.release_sha,
                args.update_id,
            )
        else:
            result = dry_run(
                args.evidence,
                args.release_sha,
                args.update_id,
            )
    except DevicePreviewOperatorError as exc:
        print(json.dumps({"status": "failed", "reason": str(exc)}, sort_keys=True), file=sys.stderr)
        return 1
    except sqlite3.Error:
        print(json.dumps({"status": "failed", "reason": "Database verification failed"}, sort_keys=True), file=sys.stderr)
        return 1
    except OSError:
        print(json.dumps({"status": "failed", "reason": "Filesystem verification failed"}, sort_keys=True), file=sys.stderr)
        return 1
    except (ValueError, PermissionError) as exc:
        print(json.dumps({"status": "failed", "reason": str(exc)}, sort_keys=True), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
