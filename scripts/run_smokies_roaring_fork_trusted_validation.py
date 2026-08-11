#!/usr/bin/env python3
"""Fail-closed production operator for one Roaring Fork trusted validation.

The default mode is a read-only dry run. ``--apply`` creates exactly one
store-owned validation report, journals its id on the database volume, and
then asks the store to execute that same report synchronously. ``--verify``
replays or completes the journaled report without ever creating another one.
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
import re
import sqlite3
import sys
from typing import Any, Iterator

REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from db import store


TARGET_ID = "railway.trailhead.production.private"
PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CHAPTER_ID = "roaring_fork"
VARIANT_ID = "one_way"
DEFAULT_REPORT_PATH = Path(
    os.environ.get("TRAILHEAD_S4R_REPORT_PATH")
    or "/data/originals/reports/roaring-fork-trusted-validation-v1.json"
)
REPORT_KIND = "roaring_fork_trusted_validation_operator_report"
DELIVERY_CONTRACT_SHA256 = (
    "9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6"
)
SELECTION_KEY = "roaring_fork_one_way_private_v1:one_way"
TERMINAL_STATUSES = {"passed", "failed", "error"}
ACTIVE_STATUSES = {"running", "executing"}
REPORT_ID_RE = re.compile(r"^original_validation_[a-f0-9]{32}$")


class TrustedValidationOperatorError(RuntimeError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise TrustedValidationOperatorError(message)


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


def _json_column(value: object, label: str) -> dict[str, Any]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError) as exc:
        raise TrustedValidationOperatorError(f"{label} is invalid") from exc
    _require(isinstance(decoded, dict), f"{label} is invalid")
    return decoded


def _read_connection(database_path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(f"{database_path.as_uri()}?mode=ro", uri=True, timeout=60)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    return db


def _load_context() -> tuple[dict[str, Any], dict[str, Any]]:
    # Keep production settings and the larger evidence builder lazy so --help
    # can never initialize an application or inspect a live target.
    import scripts.apply_smokies_roaring_fork_narration_profile as profile_operator

    try:
        bundle = profile_operator._load_bundle()
        target = profile_operator._configured_target(bundle)
    except profile_operator.NarrationProfileOperatorError as exc:
        raise TrustedValidationOperatorError(str(exc)) from exc
    _require(
        target.get("id") == TARGET_ID,
        "Configured validation target is not the exact reviewed production target",
    )
    return bundle, target


def _asset_metadata_digest(rows: list[sqlite3.Row]) -> str:
    # Only the digest is allowed into the operator report. The private input
    # deliberately includes storage/public locations and uploader identity so
    # any metadata mutation is still detected without disclosing those values.
    protected = []
    for row in rows:
        raw = dict(row)
        protected.append({key: raw[key] for key in sorted(raw)})
    return _canonical_sha256(protected)


def _material_identity(material: dict[str, Any]) -> dict[str, Any]:
    result = {
        "draft_revision": material["draft_revision"],
        "manifest_sha256": material["manifest_sha256"],
        "assets_sha256": material["assets_sha256"],
        "input_sha256": material["input_sha256"],
        "validator_source_sha256": material["validator_source_sha256"],
        "validation_selections_sha256": _canonical_sha256(
            material.get("validation_selections") or []
        ),
        "long_form_preflight_sha256": _canonical_sha256(
            material.get("long_form_preflight_bindings") or []
        ),
        "operational_bindings_sha256": _canonical_sha256(
            material.get("operational_readiness_candidates") or []
        ),
        "operational_projection_sha256": _canonical_sha256(
            material.get("operational_validation_projections") or []
        ),
    }
    long_form_source = material.get("long_form_validator_source_sha256")
    if long_form_source is not None:
        result["long_form_validator_source_sha256"] = long_form_source
    return result


def _inspect_current(
    bundle: dict[str, Any], target: dict[str, Any],
) -> dict[str, Any]:
    """Read and fully bind the exact unpublished R2 input and report state."""
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
        _require(published_count == 0, "Roaring Fork has a published version")

        manifest_input = _json_column(
            pack["draft_original_manifest_json"], "Draft manifest",
        )
        manifest, _ = store._normalize_original_manifest(
            PRODUCT_ID, str(pack["draft_title"]), manifest_input, publishing=False,
        )
        manifest_sha256 = store._original_validation_hash(manifest)
        _require(
            manifest_sha256 == bundle["expected_applied_manifest_sha256"],
            "Live profiled manifest hash drifted",
        )
        profile = manifest.get("narration_profile")
        _require(
            isinstance(profile, dict)
            and profile == bundle["profile"]
            and store._original_validation_hash(profile) == bundle["profile_sha256"],
            "Live narration profile drifted",
        )
        base_input = copy.deepcopy(manifest)
        base_input.pop("narration_profile", None)
        normalized_base, _ = store._normalize_original_manifest(
            PRODUCT_ID, str(pack["draft_title"]), base_input, publishing=False,
        )
        base_manifest_sha256 = store._original_validation_hash(normalized_base)
        _require(
            base_manifest_sha256 == bundle["expected_base_manifest_sha256"],
            "Live profile-absent manifest hash drifted",
        )

        chapters = manifest.get("chapters") or []
        _require(len(chapters) == 1, "Reviewed chapter membership drifted")
        variants = chapters[0].get("variants") or []
        _require(
            chapters[0].get("id") == CHAPTER_ID
            and len(variants) == 1
            and variants[0].get("id") == VARIANT_ID,
            "Reviewed roaring_fork/one_way selection drifted",
        )

        validation = _json_column(
            pack["draft_validation_metadata"], "Draft validation metadata",
        )
        _require(
            validation.get("admin_license_attestation_complete") is True
            and validation.get("verified_private_upload_complete") is True
            and validation.get("authenticated_device_preview_complete") is True,
            "Required private validation gates are incomplete",
        )
        _require(
            validation.get("trusted_publication_validation_complete") is False
            and validation.get("public_release") is False,
            "Publication or trusted-validation completion was already asserted",
        )
        preview_evidence = validation.get("authenticated_device_preview_evidence")
        _require(
            isinstance(preview_evidence, dict)
            and validation.get("authenticated_device_preview_evidence_sha256")
            == _canonical_sha256(preview_evidence),
            "Authenticated device-preview metadata drifted",
        )

        rows = db.execute(
            """SELECT * FROM authored_original_assets
               WHERE pack_id=? AND is_current=1 ORDER BY asset_id""",
            (PRODUCT_ID,),
        ).fetchall()
        expected_assets = bundle["receipt_asset_sha256"]
        current = {str(row["asset_id"]): row for row in rows}
        manifest_assets = {
            str(item.get("id") or ""): item for item in manifest.get("assets") or []
        }
        _require(
            len(rows) == 20
            and set(current) == set(expected_assets)
            and set(manifest_assets) == set(expected_assets),
            "Current exact twenty-asset membership drifted",
        )
        total_bytes = 0
        narration_count = 0
        image_count = 0
        attesting_admin_ids: set[int] = set()
        for asset_id in sorted(current):
            row = current[asset_id]
            expected_sha256 = expected_assets[asset_id]
            item = manifest_assets[asset_id]
            storage = Path(str(row["storage_path"])).resolve()
            try:
                storage.relative_to(target["asset_root"])
            except ValueError as exc:
                raise TrustedValidationOperatorError(
                    f"Current asset escaped the configured asset root: {asset_id}"
                ) from exc
            byte_count = int(row["byte_count"])
            _require(
                row["sha256"] == expected_sha256
                and item.get("sha256") == expected_sha256
                and item.get("kind") == row["kind"]
                and item.get("mime_type") == row["mime_type"]
                and int(item.get("bytes") or -1) == byte_count
                and item.get("path") == row["public_path"]
                and storage.is_file()
                and storage.stat().st_size == byte_count
                and _sha256_path(storage) == expected_sha256,
                f"Current asset bytes or metadata drifted: {asset_id}",
            )
            total_bytes += byte_count
            if row["kind"] == "narration":
                narration_count += 1
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
                attesting_admin_ids.add(
                    int(attestation["attested_by_admin_user_id"])
                )
            elif row["kind"] == "image":
                image_count += 1
            else:
                raise TrustedValidationOperatorError(
                    f"Unexpected current asset kind: {asset_id}"
                )
        receipt_assets = bundle["receipt"].get("assets") or {}
        _require(
            total_bytes == 239_772_665
            and total_bytes == int(receipt_assets.get("bytes") or -1)
            and narration_count == 13
            and image_count == 7,
            "Current asset totals drifted from reviewed evidence",
        )
        _require(
            len(attesting_admin_ids) == 1,
            "Thirteen narrations no longer share one current attesting admin",
        )
        admin_user_id = next(iter(attesting_admin_ids))
        admin = db.execute(
            "SELECT is_admin FROM users WHERE id=?", (admin_user_id,),
        ).fetchone()
        _require(
            admin is not None and bool(admin["is_admin"]),
            "Attesting identity is no longer a current admin",
        )
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
                item["asset_id"]: item["redacted_license_attestation_sha256"]
                for item in bindings
            } == bundle["redacted_attestation_sha256"],
            "Exact narration/profile bindings drifted",
        )

        verified_assets = store._verified_original_asset_map_db(db, PRODUCT_ID)
        _require(
            len(verified_assets) == 20 and set(verified_assets) == set(expected_assets),
            "Store verification does not bind the exact twenty assets",
        )
        validation_manifest = store._authored_original_validation_manifest_from_row(
            pack, verified_assets, include_validation_audio_evidence=True,
        )
        material = store._original_validation_material(validation_manifest, 2)
        _require(
            material["draft_revision"] == 2,
            "Trusted validation material is not revision 2",
        )

        report_rows = db.execute(
            """SELECT id,pack_id,status FROM authored_original_validation_reports
               ORDER BY started_at,id"""
        ).fetchall()
        target_reports = [row for row in report_rows if row["pack_id"] == PRODUCT_ID]
        active_reports = [row for row in report_rows if row["status"] in ACTIVE_STATUSES]
        return {
            "draft_revision": 2,
            "base_manifest_sha256": base_manifest_sha256,
            "manifest_sha256": manifest_sha256,
            "profile_sha256": bundle["profile_sha256"],
            "validation_metadata_sha256": _canonical_sha256(validation),
            "device_preview_evidence_sha256": _canonical_sha256(preview_evidence),
            "asset_metadata_sha256": _asset_metadata_digest(rows),
            "asset_binding_sha256": _canonical_sha256(expected_assets),
            "asset_count": 20,
            "narration_count": 13,
            "image_count": 7,
            "asset_bytes": total_bytes,
            "published_version_count": published_count,
            "current_published_version": None,
            "public_release": False,
            "trusted_publication_validation_complete": False,
            "material": material,
            "material_identity": _material_identity(material),
            "admin_user_id": admin_user_id,
            "global_active_report_ids": [str(row["id"]) for row in active_reports],
            "target_report_ids": [str(row["id"]) for row in target_reports],
            "target_report_statuses": {
                str(row["id"]): str(row["status"]) for row in target_reports
            },
        }
    finally:
        db.close()


_IDENTITY_KEYS = (
    "draft_revision",
    "base_manifest_sha256",
    "manifest_sha256",
    "profile_sha256",
    "validation_metadata_sha256",
    "device_preview_evidence_sha256",
    "asset_metadata_sha256",
    "asset_binding_sha256",
    "asset_count",
    "narration_count",
    "image_count",
    "asset_bytes",
    "published_version_count",
    "current_published_version",
    "public_release",
    "trusted_publication_validation_complete",
    "material_identity",
)


def _immutable_identity(inspection: dict[str, Any]) -> dict[str, Any]:
    return {key: copy.deepcopy(inspection[key]) for key in _IDENTITY_KEYS}


def _public_inspection(inspection: dict[str, Any]) -> dict[str, Any]:
    return {
        "identity": _immutable_identity(inspection),
        "global_active_report_count": len(inspection["global_active_report_ids"]),
        "target_report_count": len(inspection["target_report_ids"]),
    }


def _validated_report_path(path: Path, target: dict[str, Any]) -> Path:
    _require(path.is_absolute(), "Operator report destination must be absolute")
    parent = path.parent.resolve()
    database_parent = target["database_path"].parent.resolve()
    try:
        parent.relative_to(database_parent)
    except ValueError as exc:
        raise TrustedValidationOperatorError(
            "Operator report must stay beneath the configured database volume"
        ) from exc
    resolved = parent / path.name
    _require(resolved != target["database_path"], "Operator report collides with database")
    database_name = target["database_path"].name
    _require(
        not (
            resolved.parent == target["database_path"].parent
            and resolved.name.startswith(f"{database_name}-")
        ),
        "Operator report collides with a database sidecar",
    )
    try:
        resolved.relative_to(target["asset_root"])
    except ValueError:
        pass
    else:
        raise TrustedValidationOperatorError(
            "Operator report cannot be inside the asset root"
        )
    return resolved


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TrustedValidationOperatorError("Operator report is unavailable or invalid") from exc
    _require(isinstance(value, dict), "Operator report is invalid")
    return value


def _load_report(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    _require(path.is_file(), "Operator report destination is not a file")
    report = _load_json(path)
    _require_report_redacted(report)
    return report


def _require_report_redacted(value: object) -> None:
    """Reject persisted disclosure of locations, admins, credentials, or URLs."""
    forbidden_keys = ("path", "admin", "token", "url")

    def visit(item: object) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                lowered = str(key).casefold()
                _require(
                    not any(fragment in lowered for fragment in forbidden_keys),
                    "Operator report contains a forbidden field",
                )
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)
        elif isinstance(item, str):
            lowered = item.casefold()
            _require(
                "://" not in lowered
                and not item.startswith(("/", "\\"))
                and re.match(r"^[a-zA-Z]:[\\/]", item) is None,
                "Operator report contains a forbidden location or URL",
            )

    visit(value)


def _atomic_write_report(path: Path, report: dict[str, Any]) -> None:
    _require_report_redacted(report)
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


_STORE_REPORT_BASE_KEYS = {
    "schema_version", "report_type", "id", "pack_id", "draft_revision",
    "manifest_sha256", "assets_sha256", "input_sha256",
    "validator_source_sha256", "suite_version", "engine_version", "status",
    "passed", "current", "started_at", "completed_at", "summary_sha256",
    "scenarios_sha256", "issues_sha256",
}


def _trusted_pass_contract(
    report: dict[str, Any], inspection: dict[str, Any],
) -> dict[str, Any]:
    """Validate the full success payload and return only its safe aggregate."""
    material_selections = inspection["material"].get("validation_selections") or []
    _require(
        len(material_selections) == 1
        and material_selections[0].get("key") == SELECTION_KEY,
        "Trusted material does not contain the sole reviewed RF selection",
    )
    expected_target = material_selections[0].get("route_network_target")
    _require(
        isinstance(expected_target, dict)
        and expected_target.get("target_id") == "south_tn"
        and expected_target.get("validation_only") is True
        and expected_target.get("draft_mutated") is False
        and expected_target.get("global_config_mutated") is False
        and expected_target.get("public_release_authorized") is False,
        "Trusted material does not bind the reviewed south_tn validation target",
    )
    _require_report_redacted(expected_target)

    summary = report.get("summary")
    selections = report.get("scenarios")
    _require(
        isinstance(summary, dict)
        and summary.get("required") == 13
        and summary.get("passed") == 13
        and summary.get("failed") == 0
        and summary.get("selection_count") == 1
        and summary.get("selections_passed") == 1
        and summary.get("selections_failed") == 0
        and summary.get("validated_selections") == [SELECTION_KEY]
        and summary.get("validated_delivery_contracts")
        == [f"{SELECTION_KEY}:{DELIVERY_CONTRACT_SHA256}"]
        and isinstance(selections, list)
        and len(selections) == 1,
        "Passing report does not have the exact RF aggregate contract",
    )
    selection = selections[0]
    selection_identity = selection.get("selection")
    selection_summary = selection.get("summary")
    route_summary = (
        selection_summary.get("route") if isinstance(selection_summary, dict) else None
    )
    network_summary = (
        route_summary.get("network") if isinstance(route_summary, dict) else None
    )
    delivery = selection.get("delivery_validation")
    scenarios = selection.get("scenarios")
    _require(
        isinstance(selection, dict)
        and selection.get("selection_key") == SELECTION_KEY
        and selection.get("passed") is True
        and selection.get("issues") == []
        and isinstance(selection_identity, dict)
        and selection_identity.get("chapter_id") == CHAPTER_ID
        and selection_identity.get("variant_id") == VARIANT_ID
        and isinstance(selection_summary, dict)
        and selection_summary.get("required") == 13
        and selection_summary.get("passed") == 13
        and selection_summary.get("failed") == 0
        and isinstance(network_summary, dict)
        and network_summary.get("validation_target") == expected_target
        and isinstance(delivery, dict)
        and delivery.get("passed") is True
        and delivery.get("delivery_contract_sha256") == DELIVERY_CONTRACT_SHA256
        and isinstance(scenarios, list)
        and len(scenarios) == 13,
        "Passing report does not bind exact route, delivery, and target evidence",
    )
    expected_scenario_ids = list(store.ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS)
    scenario_ids = [item.get("id") for item in scenarios if isinstance(item, dict)]
    _require(
        scenario_ids == expected_scenario_ids
        and all(
            item.get("required") is True
            and item.get("passed") is True
            and item.get("issues") == []
            for item in scenarios
        ),
        "Passing report does not contain exact 13/13 route scenarios",
    )
    contract = {
        "selection_key": SELECTION_KEY,
        "route_scenario_count": 13,
        "route_scenario_ids_sha256": _canonical_sha256(scenario_ids),
        "delivery_contract_sha256": DELIVERY_CONTRACT_SHA256,
        "target_id": "south_tn",
        "target_binding_sha256": expected_target.get("target_binding_sha256"),
        "target_evidence_sha256": _canonical_sha256(expected_target),
    }
    _require_report_redacted(contract)
    return contract


def _safe_store_report(
    report: dict[str, Any], inspection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe = {
        key: copy.deepcopy(report.get(key))
        for key in (
            "schema_version", "report_type", "id", "pack_id", "draft_revision",
            "manifest_sha256", "assets_sha256", "input_sha256",
            "validator_source_sha256", "suite_version", "engine_version",
            "status", "passed", "current", "started_at", "completed_at",
        )
    }
    safe.update({
        "summary_sha256": _canonical_sha256(report.get("summary") or {}),
        "scenarios_sha256": _canonical_sha256(report.get("scenarios") or []),
        "issues_sha256": _canonical_sha256(report.get("issues") or []),
    })
    if report.get("status") == "passed" or report.get("passed") is True:
        _require(
            inspection is not None,
            "Passing store report needs current trusted-input inspection",
        )
        safe["pass_contract"] = _trusted_pass_contract(report, inspection)
    _require_report_redacted(safe)
    return safe


def _require_safe_store_report(
    report: dict[str, Any], inspection: dict[str, Any], *, report_id: str,
) -> None:
    material = inspection["material_identity"]
    expected_keys = set(_STORE_REPORT_BASE_KEYS)
    if report.get("status") == "passed":
        expected_keys.add("pass_contract")
    _require(
        set(report) == expected_keys
        and report.get("schema_version") == 1
        and report.get("report_type") == "OriginalRouteValidationReportV1"
        and report.get("id") == report_id
        and report.get("pack_id") == PRODUCT_ID
        and report.get("draft_revision") == 2
        and report.get("manifest_sha256") == material["manifest_sha256"]
        and report.get("assets_sha256") == material["assets_sha256"]
        and report.get("input_sha256") == material["input_sha256"]
        and report.get("validator_source_sha256")
        == material["validator_source_sha256"]
        and report.get("suite_version")
        == store.ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION
        and report.get("current") is True,
        "Store validation report identity or trusted inputs drifted",
    )
    status = report.get("status")
    _require(
        status in ACTIVE_STATUSES | TERMINAL_STATUSES,
        "Store validation report has an invalid state",
    )
    if status in ACTIVE_STATUSES:
        _require(
            report.get("engine_version") is None,
            "Active validation report has an unexpected engine identity",
        )
    elif status == "passed":
        _require(
            report.get("engine_version")
            == store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
            "Passing validation report has the wrong trusted engine",
        )
    else:
        _require(
            report.get("engine_version") in {
                None, store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
            },
            "Failed validation report has an unexpected engine identity",
        )
    if status in TERMINAL_STATUSES:
        _require(
            report.get("completed_at") is not None
            and bool(report.get("passed")) == (status == "passed"),
            "Terminal validation report is internally inconsistent",
        )
    else:
        _require(
            report.get("completed_at") is None and report.get("passed") is False,
            "Active validation report is internally inconsistent",
        )
    if status == "passed":
        _require(
            report.get("issues_sha256") == _canonical_sha256([])
            and isinstance(report.get("pass_contract"), dict)
            and report["pass_contract"].get("selection_key") == SELECTION_KEY
            and report["pass_contract"].get("route_scenario_count") == 13
            and report["pass_contract"].get("delivery_contract_sha256")
            == DELIVERY_CONTRACT_SHA256
            and report["pass_contract"].get("target_id") == "south_tn",
            "Passing report is missing the exact redacted success contract",
        )
    _require_report_redacted(report)


def _journal(
    *, origin: str, state: str, inspection: dict[str, Any],
    store_report: dict[str, Any], preflight: dict[str, int],
) -> dict[str, Any]:
    report_id = str(store_report["id"])
    result = {
        "schema_version": 1,
        "kind": REPORT_KIND,
        "target_id": TARGET_ID,
        "origin": origin,
        "state": state,
        "validation_report_id": report_id,
        "identity": _immutable_identity(inspection),
        "preflight": copy.deepcopy(preflight),
        "report": copy.deepcopy(store_report),
    }
    if state == "completed":
        result["post_validation"] = _public_inspection(inspection)
    _require_report_redacted(result)
    return result


def _require_journal(
    journal: dict[str, Any], inspection: dict[str, Any],
) -> None:
    _require_report_redacted(journal)
    state = journal.get("state")
    expected_keys = {
        "schema_version", "kind", "target_id", "origin", "state",
        "validation_report_id", "identity", "preflight", "report",
    }
    if state == "completed":
        expected_keys.add("post_validation")
    _require(
        set(journal) == expected_keys
        and journal.get("schema_version") == 1
        and journal.get("kind") == REPORT_KIND
        and journal.get("target_id") == TARGET_ID
        and journal.get("origin") in {"apply", "bootstrap"}
        and state in {"created", "completed"}
        and journal.get("identity") == _immutable_identity(inspection),
        "Existing operator report identity or state drifted",
    )
    report_id = journal.get("validation_report_id")
    _require(
        isinstance(report_id, str)
        and REPORT_ID_RE.fullmatch(report_id) is not None,
        "Existing operator report id is invalid",
    )
    safe_report = journal.get("report")
    _require(isinstance(safe_report, dict), "Existing store-report snapshot is invalid")
    _require_safe_store_report(safe_report, inspection, report_id=report_id)
    preflight = journal.get("preflight")
    _require(
        isinstance(preflight, dict)
        and set(preflight) == {
            "global_active_report_count", "target_report_count",
        },
        "Existing operator preflight snapshot drifted",
    )
    if journal["origin"] == "apply":
        _require(
            preflight == {
                "global_active_report_count": 0, "target_report_count": 0,
            },
            "Existing apply preflight snapshot drifted",
        )
    else:
        expected_bootstrap = {
            "global_active_report_count": 1 if state == "created" else 0,
            "target_report_count": 1,
        }
        _require(
            preflight == expected_bootstrap,
            "Existing bootstrap preflight snapshot drifted",
        )
    if state == "created":
        _require(
            safe_report["status"] == "running",
            "Created journal no longer contains its original running snapshot",
        )
    else:
        _require(
            safe_report["status"] in TERMINAL_STATUSES
            and journal.get("post_validation") == _public_inspection(inspection),
            "Completed operator report drifted",
        )


def _require_first_apply(inspection: dict[str, Any]) -> None:
    _require(
        not inspection["global_active_report_ids"],
        "Another trusted validation is running or executing",
    )
    _require(
        not inspection["target_report_ids"],
        "Roaring Fork already has a validation report; reports are append-only",
    )


def _require_only_report(
    inspection: dict[str, Any], report_id: str, *, allow_terminal: bool,
) -> None:
    _require(
        inspection["target_report_ids"] == [report_id],
        "Roaring Fork report history is not the exact one-report history",
    )
    other_active = [
        item for item in inspection["global_active_report_ids"] if item != report_id
    ]
    _require(not other_active, "Another trusted validation is running or executing")
    if not allow_terminal:
        _require(
            inspection["global_active_report_ids"] == [report_id]
            and inspection["target_report_statuses"].get(report_id) == "running",
            "The exact validation report is not the sole running report",
        )


def _get_store_report(report_id: str, inspection: dict[str, Any]) -> dict[str, Any]:
    raw = store.get_authored_original_virtual_validation_report(PRODUCT_ID, report_id)
    _require(raw is not None, "Exact store validation report is unavailable")
    safe = _safe_store_report(raw, inspection)
    _require_safe_store_report(safe, inspection, report_id=report_id)
    return safe


def _complete_existing(
    report_path: Path,
    journal: dict[str, Any],
    bundle: dict[str, Any],
    target: dict[str, Any],
) -> dict[str, Any]:
    inspection = _inspect_current(bundle, target)
    _require_journal(journal, inspection)
    report_id = journal["validation_report_id"]
    _require_only_report(inspection, report_id, allow_terminal=True)
    current = _get_store_report(report_id, inspection)

    if journal["state"] == "completed":
        _require(
            current == journal["report"] and current["status"] in TERMINAL_STATUSES,
            "Completed store validation report drifted",
        )
        _require(not inspection["global_active_report_ids"], "A validation is still active")
        return journal

    if current["status"] == "executing":
        raise TrustedValidationOperatorError(
            "The exact validation report is already executing; verify again after it finishes"
        )
    if current["status"] == "running":
        _require(
            current == journal["report"],
            "Journaled running report snapshot drifted from the store",
        )
        before_execute = _inspect_current(bundle, target)
        _require(
            _immutable_identity(before_execute) == journal["identity"],
            "Trusted inputs drifted before execution",
        )
        _require_only_report(before_execute, report_id, allow_terminal=False)
        # The second inspection re-derives the one attesting admin and rechecks
        # current is_admin immediately before the store-owned mutation.
        executed = store.execute_authored_original_virtual_validation_run(report_id)
        current = _safe_store_report(executed, before_execute)
        _require_safe_store_report(current, before_execute, report_id=report_id)
        _require(
            current["status"] in TERMINAL_STATUSES,
            "Synchronous trusted validation did not reach a terminal report",
        )

    post = _inspect_current(bundle, target)
    _require(
        _immutable_identity(post) == journal["identity"],
        "Manifest, profile, assets, metadata, or publication state changed",
    )
    _require_only_report(post, report_id, allow_terminal=True)
    _require(not post["global_active_report_ids"], "A validation is still active")
    latest = _get_store_report(report_id, post)
    _require(latest["status"] in TERMINAL_STATUSES, "Validation is not terminal")
    completed = _journal(
        origin=journal["origin"],
        state="completed",
        inspection=post,
        store_report=latest,
        preflight=(
            {
                "global_active_report_count": 0,
                "target_report_count": 1,
            }
            if journal["origin"] == "bootstrap"
            else journal["preflight"]
        ),
    )
    _atomic_write_report(report_path, completed)
    return completed


def dry_run() -> dict[str, Any]:
    bundle, target = _load_context()
    inspection = _inspect_current(bundle, target)
    _require_first_apply(inspection)
    result = {
        "status": "dry_run_verified",
        "target_id": TARGET_ID,
        "inspection": _public_inspection(inspection),
        "mutation_performed": False,
    }
    _require_report_redacted(result)
    return result


def apply(report_path: Path = DEFAULT_REPORT_PATH) -> dict[str, Any]:
    bundle, target = _load_context()
    report_path = _validated_report_path(report_path, target)
    with _operator_lock(report_path):
        _require(
            report_path.parent.stat().st_dev
            == target["database_path"].stat().st_dev,
            "Operator report is not on the database volume",
        )
        existing = _load_report(report_path)
        if existing is not None:
            return _complete_existing(report_path, existing, bundle, target)

        inspection = _inspect_current(bundle, target)
        _require_first_apply(inspection)
        # This private value is never returned, persisted, or printed. The
        # store independently rechecks is_admin while creating the report.
        created_raw = store.create_authored_original_virtual_validation_run(
            PRODUCT_ID,
            inspection["admin_user_id"],
            require_zero_active_reports=True,
            require_zero_pack_reports=True,
            expected_draft_revision=inspection["material"]["draft_revision"],
            expected_manifest_sha256=inspection["material"]["manifest_sha256"],
            expected_assets_sha256=inspection["material"]["assets_sha256"],
            expected_input_sha256=inspection["material"]["input_sha256"],
        )
        created = _safe_store_report(created_raw)
        report_id = str(created.get("id") or "")
        _require(
            REPORT_ID_RE.fullmatch(report_id) is not None,
            "Store returned an invalid validation report id",
        )
        after_create = _inspect_current(bundle, target)
        _require(
            _immutable_identity(after_create) == _immutable_identity(inspection),
            "Trusted inputs drifted while creating the validation report",
        )
        _require_only_report(after_create, report_id, allow_terminal=False)
        _require_safe_store_report(created, after_create, report_id=report_id)
        journal = _journal(
            origin="apply",
            state="created",
            inspection=after_create,
            store_report=created,
            preflight={
                "global_active_report_count": 0,
                "target_report_count": 0,
            },
        )
        try:
            _atomic_write_report(report_path, journal)
        except Exception as exc:
            raise TrustedValidationOperatorError(
                "Validation report was created but not journaled; resume with "
                f"--verify --bootstrap-report-id {report_id}"
            ) from exc
        return _complete_existing(report_path, journal, bundle, target)


def verify(
    report_path: Path = DEFAULT_REPORT_PATH,
    *,
    bootstrap_report_id: str | None = None,
) -> dict[str, Any]:
    bundle, target = _load_context()
    report_path = _validated_report_path(report_path, target)
    with _operator_lock(report_path):
        _require(
            report_path.parent.stat().st_dev
            == target["database_path"].stat().st_dev,
            "Operator report is not on the database volume",
        )
        journal = _load_report(report_path)
        if journal is not None:
            if bootstrap_report_id is not None:
                _require(
                    bootstrap_report_id == journal.get("validation_report_id"),
                    "Bootstrap report id does not match the existing operator report",
                )
            return _complete_existing(report_path, journal, bundle, target)

        inspection = _inspect_current(bundle, target)
        _require(
            len(inspection["target_report_ids"]) == 1,
            "Missing operator report can only bootstrap one exact target report",
        )
        recovered_report_id = inspection["target_report_ids"][0]
        _require(
            REPORT_ID_RE.fullmatch(recovered_report_id) is not None,
            "Sole target validation report id is invalid",
        )
        if bootstrap_report_id is not None:
            _require(
                bootstrap_report_id == recovered_report_id,
                "Bootstrap report id does not match the sole target report",
            )
        _require_only_report(inspection, recovered_report_id, allow_terminal=True)
        current = _get_store_report(recovered_report_id, inspection)
        refreshed = _inspect_current(bundle, target)
        _require(
            _immutable_identity(refreshed) == _immutable_identity(inspection),
            "Trusted inputs drifted while recovering the store report",
        )
        _require_only_report(refreshed, recovered_report_id, allow_terminal=True)
        _require(
            refreshed["target_report_statuses"].get(recovered_report_id)
            == current["status"],
            "Store report state drifted while recovering its journal",
        )
        inspection = refreshed
        _require(
            current["status"] != "executing",
            "The exact validation report is already executing; verify again after it finishes",
        )
        origin_state = (
            "completed" if current["status"] in TERMINAL_STATUSES else "created"
        )
        journal = _journal(
            origin="bootstrap",
            state=origin_state,
            inspection=inspection,
            store_report=current,
            preflight={
                "global_active_report_count": len(
                    inspection["global_active_report_ids"]
                ),
                "target_report_count": len(inspection["target_report_ids"]),
            },
        )
        _atomic_write_report(report_path, journal)
        if origin_state == "completed":
            _require(
                not inspection["global_active_report_ids"],
                "Another validation is still active",
            )
            return journal
        return _complete_existing(report_path, journal, bundle, target)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Validate the exact unpublished production Roaring Fork R2 input. "
            "No mode flag performs a read-only dry run."
        )
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--apply", action="store_true",
        help="create, journal, and synchronously execute exactly one report",
    )
    mode.add_argument(
        "--verify", action="store_true",
        help="resume or verify the already journaled report without creating one",
    )
    parser.add_argument(
        "--bootstrap-report-id",
        help=(
            "with --verify, optionally cross-check the sole report id while "
            "recovering a missing journal; this never creates a second report"
        ),
    )
    parser.add_argument(
        "--report", type=Path, default=DEFAULT_REPORT_PATH,
        help="same-volume operator report destination",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.bootstrap_report_id and not args.verify:
        parser.error("--bootstrap-report-id requires --verify")
    try:
        if args.apply:
            result = apply(args.report)
        elif args.verify:
            result = verify(
                args.report, bootstrap_report_id=args.bootstrap_report_id,
            )
        else:
            result = dry_run()
    except (TrustedValidationOperatorError, ValueError, PermissionError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False))
    if result.get("state") == "completed":
        return 0 if result.get("report", {}).get("passed") is True else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
