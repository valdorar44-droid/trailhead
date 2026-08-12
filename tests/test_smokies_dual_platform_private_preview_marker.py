from __future__ import annotations

import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

import pytest

import scripts.record_smokies_dual_platform_private_preview as marker


MANIFEST_SHA = "1" * 64
ASSETS_SHA = "2" * 64
INPUT_SHA = "3" * 64
ADMIN_ID = 73
IDEMPOTENCY_KEY = "smokies-preview-marker-20260811-v1"


def _manifest() -> dict:
    assets = []
    for index in range(98):
        kind = "narration" if index < 85 else "image"
        assets.append({
            "id": f"asset_{index:03d}",
            "kind": kind,
            "mime_type": "audio/mpeg" if kind == "narration" else "image/png",
            "bytes": 1,
            "sha256": f"{index + 1:064x}",
        })
    assets[-1]["bytes"] += 458_155_200 - 98
    stories = [{"id": f"story_{index:03d}"} for index in range(77)]
    for index in range(8):
        stories[index]["variant_overrides"] = [
            {"variant_id": f"directional_{index:02d}"}
        ]
    return {
        "schema_version": 3,
        "title": "Smokies",
        "stories": stories,
        "chapters": [
            {"id": "mountain_crossing", "variants": [{"id": "a"}, {"id": "b"}]},
            {"id": "little_river_cades_cove", "variants": [{"id": "a"}]},
            {"id": "roaring_fork", "variants": [{"id": "a"}]},
            {"id": "foothills_parkway", "variants": [{"id": "a"}, {"id": "b"}]},
        ],
        "assets": assets,
        "offline_map": {"region_id": "smokies_union"},
        "narration_profile": {"schema_version": 2},
    }


def _pending_validation() -> dict:
    return {
        "preserved_final_readiness": {"sha256": "4" * 64},
        "authenticated_device_preview_complete": False,
        "dual_platform_private_preview_complete": False,
        "trusted_publication_validation_complete": False,
        "public_release": False,
    }


def _historical_report() -> tuple[dict, str, str]:
    manifest = {"schema_version": 3, "title": "Historical Roaring Fork"}
    manifest_sha = marker._canonical_sha256(manifest)
    row = {
        "id": marker.HISTORICAL_REPORT_ID,
        "pack_id": marker.PRODUCT_ID,
        "draft_revision": 2,
        "manifest_sha256": manifest_sha,
        "assets_sha256": "9" * 64,
        "input_sha256": "a" * 64,
        "validator_source_sha256": "b" * 64,
        "manifest_json": json.dumps(manifest, separators=(",", ":"), sort_keys=True),
        "suite_version": "originals_virtual_route_v3",
        "engine_version": "original-trigger-v3",
        "status": "passed",
        "passed": 1,
        "summary_json": json.dumps(
            {
                "required": 13,
                "passed": 13,
                "failed": 0,
                "selection_count": 1,
                "selections_passed": 1,
                "selections_failed": 0,
                "validated_selections": [marker.store._SMOKIES_RF_SELECTION_KEY],
                "validated_delivery_contracts": [
                    f"{marker.store._SMOKIES_RF_SELECTION_KEY}:"
                    f"{marker.store._SMOKIES_RF_DELIVERY_CONTRACT_SHA256}"
                ],
            },
            separators=(",", ":"), sort_keys=True,
        ),
        "scenarios_json": json.dumps(
            [{
                "selection_key": marker.store._SMOKIES_RF_SELECTION_KEY,
                "passed": True,
                "issues": [],
            }],
            separators=(",", ":"), sort_keys=True,
        ),
        "issues_json": "[]",
        "started_by": ADMIN_ID,
        "worker_pid": None,
        "started_at": 1_754_876_000,
        "completed_at": 1_754_876_100,
    }
    material = {
        key: row[key]
        for key in (
            "draft_revision", "manifest_sha256", "assets_sha256", "input_sha256",
            "validator_source_sha256",
        )
    }
    redacted = marker.store._original_validation_report_from_row(
        row, current_material=material,
    )
    return row, manifest_sha, marker._canonical_sha256(redacted)


def _write_private_json(path: Path, value: dict) -> Path:
    path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
    path.chmod(0o600)
    return path.resolve()


def _compatibility(tmp_path: Path) -> Path:
    source_rows = []
    for relative in marker.SOURCE_BINDING_PATHS:
        source = marker.ROOT / relative
        source_rows.append({
            "path": relative,
            "byte_count": source.stat().st_size,
            "sha256": marker._sha256_path(source),
        })
    value = {
        "schema_version": 1,
        "kind": "smokies_mobile_compatibility_freeze",
        "status": "prebuild_source_compatibility_ready_new_signed_dual_platform_builds_required",
        "product_id": marker.PRODUCT_ID,
        "source_revision": {
            "commit": "a" * 40,
            "tree": "b" * 40,
            "generated_artifact_excluded_from_source_set": True,
            "same_source_commit_required_for_android_and_ios": True,
        },
        "required_future_builds": {
            "source_commit": "a" * 40,
            "source_tree": "b" * 40,
            "same_source_commit": True,
            "build_identity_record_schema": {
                "fixed_values": {
                    "source_revision": {"commit": "a" * 40, "tree": "b" * 40},
                    "kind": "trailhead_signed_mobile_build_identity",
                }
            },
            "private_preview_evidence_record_schema": {
                "fixed_values": {
                    "source_revision": {"commit": "a" * 40, "tree": "b" * 40},
                    "kind": "smokies_complete_private_preview_evidence",
                    "counts": marker.EXPECTED_COUNTS,
                    "device_environment": {
                        "environment": "physical",
                        "physical_device": True,
                    },
                }
            },
        },
        "android_build_73_reuse": {"reuse": False},
        "source_sets": {
            "complete_release_support_source": {
                "rows": source_rows,
            }
        },
        "effects": {"mobile_build_performed": False, "network_accessed": False},
        "gates": {"dual_platform_private_preview_complete": False},
    }
    return _write_private_json(tmp_path / "compatibility.json", value)


def _files(tmp_path: Path) -> dict[str, Path]:
    source = {"commit": "a" * 40, "tree": "b" * 40}
    result: dict[str, Path] = {}
    completed_at = datetime.now(timezone.utc).replace(
        microsecond=0
    ).isoformat().replace("+00:00", "Z")
    for platform in ("android", "ios"):
        runtime = (
            "native-1.0.12-android.1"
            if platform == "android"
            else "native-1.0.12-ios.1"
        )
        build = {
            "schema_version": 1,
            "kind": "trailhead_signed_mobile_build_identity",
            "status": "verified_signed_preview_build",
            "product_id": marker.PRODUCT_ID,
            "platform": platform,
            "source_revision": source,
            "build_id": f"{platform}-build-identity-v1",
            "app_version": "1.0.12",
            "build_number": "74" if platform == "android" else "1",
            "runtime_version": runtime,
            "channel": "preview",
            "distribution": "internal",
            "signed": True,
            "simulator": False,
            "eas_project_id": "92c016d2-6e63-480e-a483-a6898d7e77d5",
            "native_fingerprint_sha256": ("5" if platform == "android" else "6") * 64,
            "build_artifact_sha256": ("7" if platform == "android" else "8") * 64,
        }
        build_key = f"{platform}_build_identity"
        result[build_key] = _write_private_json(tmp_path / f"{build_key}.json", build)
        preview = {
            "schema_version": 1,
            "kind": "smokies_complete_private_preview_evidence",
            "status": "verified_complete_private_preview",
            "product_id": marker.PRODUCT_ID,
            "platform": platform,
            "source_revision": source,
            "build_identity_sha256": marker._sha256_path(result[build_key]),
            "build_id": build["build_id"],
            "draft_revision": 5,
            "manifest_sha256": MANIFEST_SHA,
            "assets_sha256": ASSETS_SHA,
            "completed_at": completed_at,
            "selection_keys": marker.EXPECTED_SELECTION_KEYS,
            "counts": marker.EXPECTED_COUNTS,
            "device_environment": {
                "environment": "physical",
                "physical_device": True,
            },
            "offline_map": {
                "region_id": "smokies_ridges_rivers_living_memory_union_private_v1",
                "estimated_map_bytes": 213_074_000,
                "mathematical_required_free_space_bytes": 738_352_120,
                "javascript_integer_required_free_space_bytes": 738_352_121,
                "installed_map_bytes": 200_000_000,
                "free_space_before_download_bytes": 800_000_000,
                "download_complete": True,
                "capacity_accounting_complete": True,
                "restart_recovery_complete": True,
                "scoped_deletion_complete": True,
            },
            "checks": {key: True for key in marker.EXPECTED_PREVIEW_CHECKS},
            "privacy": {
                "raw_device_identifier_serialized": False,
                "account_identifier_serialized": False,
                "api_key_or_token_serialized": False,
            },
        }
        preview_key = f"{platform}_preview_evidence"
        result[preview_key] = _write_private_json(
            tmp_path / f"{preview_key}.json", preview,
        )
    return result


def _evidence(files: dict[str, Path]) -> dict:
    return {
        "schema_version": 1,
        "evidence_id": "smokies_dual_platform_private_preview_v1",
        "pack_id": marker.PRODUCT_ID,
        "draft_revision": 5,
        "manifest_sha256": MANIFEST_SHA,
        "assets_sha256": ASSETS_SHA,
        "accepted_at": datetime.now(timezone.utc).replace(
            microsecond=0
        ).isoformat().replace("+00:00", "Z"),
        "accepted_by_admin_user_id": ADMIN_ID,
        "platforms": [
            {
                "platform": "android",
                "build_identity_sha256": marker._sha256_path(files["android_build_identity"]),
                "preview_evidence_sha256": marker._sha256_path(files["android_preview_evidence"]),
                "complete": True,
            },
            {
                "platform": "ios",
                "build_identity_sha256": marker._sha256_path(files["ios_build_identity"]),
                "preview_evidence_sha256": marker._sha256_path(files["ios_preview_evidence"]),
                "complete": True,
            },
        ],
    }


def _create_database(path: Path, *, revision: int = 5) -> None:
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE users(id INTEGER PRIMARY KEY,is_admin INTEGER NOT NULL);
        CREATE TABLE authored_trip_packs(
          id TEXT PRIMARY KEY,content_kind TEXT NOT NULL,status TEXT NOT NULL,
          current_published_version INTEGER,draft_revision INTEGER NOT NULL,
          draft_title TEXT NOT NULL,draft_original_manifest_json TEXT NOT NULL,
          draft_validation_metadata TEXT NOT NULL,immutable_note TEXT NOT NULL
        );
        CREATE TABLE authored_trip_pack_versions(pack_id TEXT NOT NULL);
        CREATE TABLE authored_original_validation_reports(
          id TEXT PRIMARY KEY,
          pack_id TEXT NOT NULL REFERENCES authored_trip_packs(id),
          draft_revision INTEGER NOT NULL,
          manifest_sha256 TEXT NOT NULL,
          assets_sha256 TEXT NOT NULL,
          input_sha256 TEXT NOT NULL,
          validator_source_sha256 TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          suite_version TEXT NOT NULL,
          engine_version TEXT,
          status TEXT NOT NULL,
          passed INTEGER NOT NULL,
          summary_json TEXT NOT NULL,
          scenarios_json TEXT NOT NULL,
          issues_json TEXT NOT NULL,
          started_by INTEGER REFERENCES users(id),
          worker_pid INTEGER,
          started_at INTEGER NOT NULL,
          completed_at INTEGER
        );
        CREATE TABLE authored_original_release_authorizations_v1(pack_id TEXT NOT NULL);
        CREATE TABLE authored_original_smokies_dual_platform_preview_receipts_v1(
          receipt_id TEXT PRIMARY KEY,
          pack_id TEXT NOT NULL UNIQUE,
          draft_revision INTEGER NOT NULL,
          manifest_sha256 TEXT NOT NULL,
          assets_sha256 TEXT NOT NULL,
          validation_input_sha256 TEXT NOT NULL,
          before_validation_metadata_sha256 TEXT NOT NULL,
          after_validation_metadata_sha256 TEXT NOT NULL,
          evidence_sha256 TEXT NOT NULL,
          evidence_file_sha256 TEXT NOT NULL,
          compatibility_freeze_sha256 TEXT NOT NULL,
          source_commit TEXT NOT NULL,
          source_tree TEXT NOT NULL,
          android_build_identity_sha256 TEXT NOT NULL,
          android_preview_evidence_sha256 TEXT NOT NULL,
          ios_build_identity_sha256 TEXT NOT NULL,
          ios_preview_evidence_sha256 TEXT NOT NULL,
          historical_validation_report_count INTEGER NOT NULL,
          full_bundle_validation_report_count INTEGER NOT NULL,
          validation_report_inventory_sha256 TEXT NOT NULL,
          admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          idempotency_key_sha256 TEXT NOT NULL,
          request_sha256 TEXT NOT NULL,
          receipt_json TEXT NOT NULL,
          receipt_sha256 TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY(pack_id) REFERENCES authored_trip_packs(id) ON DELETE RESTRICT
        );
        """
    )
    db.execute("INSERT INTO users VALUES (?,1)", (ADMIN_ID,))
    db.execute(
        "INSERT INTO authored_trip_packs VALUES (?,?,?,?,?,?,?,?,?)",
        (
            marker.PRODUCT_ID, "original_drive", "draft", None, revision,
            "Smokies", json.dumps(_manifest(), separators=(",", ":"), sort_keys=True),
            json.dumps(_pending_validation(), separators=(",", ":"), sort_keys=True),
            "must-not-change",
        ),
    )
    historical, _manifest_sha, _redacted_sha = _historical_report()
    db.execute(
        """INSERT INTO authored_original_validation_reports
           (id,pack_id,draft_revision,manifest_sha256,assets_sha256,input_sha256,
            validator_source_sha256,manifest_json,suite_version,engine_version,
            status,passed,summary_json,scenarios_json,issues_json,started_by,
            worker_pid,started_at,completed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        tuple(historical[column] for column in (
            "id", "pack_id", "draft_revision", "manifest_sha256", "assets_sha256",
            "input_sha256", "validator_source_sha256", "manifest_json",
            "suite_version", "engine_version", "status", "passed", "summary_json",
            "scenarios_json", "issues_json", "started_by", "worker_pid",
            "started_at", "completed_at",
        )),
    )
    db.commit()
    db.close()


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> dict:
    tmp_path.chmod(0o700)
    database = tmp_path / "trailhead.db"
    _create_database(database)
    _historical, historical_manifest_sha, historical_redacted_sha = _historical_report()
    monkeypatch.setattr(
        marker, "HISTORICAL_REPORT_MANIFEST_SHA256", historical_manifest_sha,
    )
    monkeypatch.setattr(
        marker, "HISTORICAL_REPORT_REDACTED_SHA256", historical_redacted_sha,
    )
    inventory_calls: list[tuple[list[dict], dict]] = []
    historical_contract = {"schema_version": 1, "fixture": "exact_history"}
    monkeypatch.setattr(
        marker.store,
        "load_smokies_historical_validation_contract",
        lambda: (copy.deepcopy(historical_contract), {"sha256": "c" * 64}),
    )

    def canonical_inventory(rows: list[sqlite3.Row], history: dict) -> dict:
        inventory_calls.append(([dict(row) for row in rows], copy.deepcopy(history)))
        assert history == historical_contract
        scenarios = json.loads(str(dict(rows[0])["scenarios_json"]))
        assert scenarios == [{
            "selection_key": marker.store._SMOKIES_RF_SELECTION_KEY,
            "passed": True,
            "issues": [],
        }]
        return {
            "historical_report_count": 1,
            "full_bundle_report_count": 0,
            "inventory": [{"report_id": marker.HISTORICAL_REPORT_ID}],
            "inventory_sha256": "c" * 64,
        }

    monkeypatch.setattr(
        marker.store, "_smokies_historical_validation_inventory", canonical_inventory,
    )
    manifest = _manifest()
    verified = {
        item["id"]: {
            "asset_id": item["id"], "sha256": item["sha256"],
            "kind": item["kind"], "mime_type": item["mime_type"],
            "byte_count": item["bytes"],
        }
        for item in manifest["assets"]
    }

    def connect() -> sqlite3.Connection:
        db = sqlite3.connect(database)
        db.row_factory = sqlite3.Row
        return db

    monkeypatch.setattr(marker.store, "_conn", connect)
    monkeypatch.setattr(
        marker.store, "_normalize_original_manifest",
        lambda *_args, **_kwargs: (copy.deepcopy(manifest), []),
    )
    monkeypatch.setattr(
        marker.store, "_validate_original_profile_all_assets_locked",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        marker.store, "_validate_original_narration_profile_bindings_locked",
        lambda *_args, **_kwargs: [{} for _ in range(85)],
    )
    monkeypatch.setattr(
        marker.store, "_verified_original_asset_map_db",
        lambda *_args, **_kwargs: copy.deepcopy(verified),
    )
    monkeypatch.setattr(
        marker.store, "_authored_original_validation_manifest_from_row",
        lambda *_args, **_kwargs: {**copy.deepcopy(manifest), "version": 1005},
    )
    monkeypatch.setattr(
        marker.store, "_original_validation_material",
        lambda *_args, **_kwargs: {
            "draft_revision": 5, "manifest_sha256": MANIFEST_SHA,
            "assets_sha256": ASSETS_SHA, "input_sha256": INPUT_SHA,
        },
    )
    files = _files(tmp_path)
    compatibility = _compatibility(tmp_path)
    monkeypatch.setattr(marker, "COMPATIBILITY_PATH", compatibility)
    evidence = _evidence(files)
    evidence_path = tmp_path / "envelope.json"
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    evidence_path.chmod(0o600)
    return {
        "database": database,
        "files": files,
        "evidence": evidence,
        "evidence_path": evidence_path.resolve(),
        "receipt": (tmp_path / "receipt.json").resolve(),
        "compatibility": compatibility,
        "inventory_calls": inventory_calls,
    }


def _pack(database: Path) -> dict:
    db = sqlite3.connect(database)
    db.row_factory = sqlite3.Row
    result = dict(db.execute("SELECT * FROM authored_trip_packs").fetchone())
    db.close()
    return result


def _durable_receipt(database: Path) -> dict | None:
    db = sqlite3.connect(database)
    db.row_factory = sqlite3.Row
    row = db.execute(
        f"SELECT * FROM {marker.RECEIPT_TABLE}"
    ).fetchone()
    db.close()
    return dict(row) if row is not None else None


def test_default_dry_run_has_zero_file_database_or_external_effects(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        marker.store, "_conn", lambda: pytest.fail("dry run accessed database"),
    )
    assert marker.main([]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "dry_run_dual_platform_private_preview_evidence_required"
    assert result["sentinel"] == "RECORD_SMOKIES_DUAL_PLATFORM_PRIVATE_PREVIEW"
    assert result["expected_counts"] == marker.EXPECTED_COUNTS
    assert result["writes_performed"] is False
    assert result["database_accessed"] is False
    assert result["evidence_files_accessed"] is False
    assert all(value is False for value in result["gates"].values())


def test_apply_changes_only_three_validation_fields_and_replays(configured: dict) -> None:
    before = _pack(configured["database"])
    first = marker.apply_private(
        configured["evidence_path"], configured["receipt"], configured["files"],
        IDEMPOTENCY_KEY,
    )
    after = _pack(configured["database"])
    assert first["replayed"] is False and first["receipt_created"] is True
    assert after["draft_revision"] == before["draft_revision"] == 5
    assert after["draft_original_manifest_json"] == before["draft_original_manifest_json"]
    assert after["immutable_note"] == before["immutable_note"] == "must-not-change"
    pending = json.loads(before["draft_validation_metadata"])
    applied = json.loads(after["draft_validation_metadata"])
    assert applied["dual_platform_private_preview_complete"] is True
    assert applied["dual_platform_private_preview_evidence"] == configured["evidence"]
    assert applied["dual_platform_private_preview_evidence_sha256"] == marker._canonical_sha256(
        configured["evidence"]
    )
    for key, value in pending.items():
        if key != "dual_platform_private_preview_complete":
            assert applied[key] == value
    receipt_bytes = configured["receipt"].read_bytes()
    receipt = json.loads(receipt_bytes)
    durable = _durable_receipt(configured["database"])
    assert durable is not None
    assert durable["receipt_id"] == marker.RECEIPT_ID
    assert durable["pack_id"] == marker.PRODUCT_ID
    assert durable["before_validation_metadata_sha256"] == marker._canonical_sha256(
        pending
    )
    assert durable["after_validation_metadata_sha256"] == marker._canonical_sha256(
        applied
    )
    assert durable["request_sha256"] == receipt["request_sha256"]
    assert durable["receipt_sha256"] == marker._canonical_sha256(receipt)
    assert json.loads(durable["receipt_json"]) == receipt
    assert IDEMPOTENCY_KEY not in durable["receipt_json"]
    assert durable["idempotency_key_sha256"] == marker.hashlib.sha256(
        IDEMPOTENCY_KEY.encode("utf-8")
    ).hexdigest()
    assert receipt["kind"] == "smokies_dual_platform_private_preview_marker"
    assert receipt["status"] == "verified_dual_platform_private_preview"
    assert receipt["accepted_by_admin_user_id"] == ADMIN_ID
    report_state = receipt["validation_report_state"]
    assert report_state == receipt["request"]["validation_report_state"]
    assert report_state["historical_report_count"] == 1
    assert report_state["full_bundle_report_count"] == 0
    assert report_state["historical_report_id"] == marker.HISTORICAL_REPORT_ID
    assert report_state["historical_redacted_report_sha256"] == (
        marker.HISTORICAL_REPORT_REDACTED_SHA256
    )
    assert report_state["inventory_sha256"] == "c" * 64
    assert configured["inventory_calls"]
    assert all(
        history == {"schema_version": 1, "fixture": "exact_history"}
        for _rows, history in configured["inventory_calls"]
    )
    assert durable["historical_validation_report_count"] == 1
    assert durable["full_bundle_validation_report_count"] == 0
    assert durable["validation_report_inventory_sha256"] == report_state[
        "inventory_sha256"
    ]
    assert receipt["dual_platform_envelope"] == {
        "canonical_sha256": marker._canonical_sha256(configured["evidence"]),
        "evidence": configured["evidence"],
    }
    assert set(receipt["dual_platform_envelope"]["evidence"]) == {
        "schema_version", "evidence_id", "pack_id", "draft_revision",
        "manifest_sha256", "assets_sha256", "accepted_at",
        "accepted_by_admin_user_id", "platforms",
    }
    for platform, details in receipt["platform_files"].items():
        assert details["platform"] == platform
        assert details["source_commit"] == "a" * 40
        assert details["source_tree"] == "b" * 40
    assert receipt["operation"] == "validation_metadata_only_revision_preserving_cas"
    assert receipt["counts"] == marker.EXPECTED_COUNTS
    assert receipt["manifest_sha256"] == MANIFEST_SHA
    assert receipt["assets_sha256"] == ASSETS_SHA
    assert receipt["validation_input_sha256"] == INPUT_SHA
    assert receipt["invariants"]["draft_manifest_mutated"] is False
    assert receipt["invariants"]["draft_revision_mutated"] is False
    second = marker.apply_private(
        configured["evidence_path"], configured["receipt"], configured["files"],
        IDEMPOTENCY_KEY,
    )
    assert second["replayed"] is True and second["receipt_created"] is False
    assert configured["receipt"].read_bytes() == receipt_bytes
    assert _pack(configured["database"]) == after


def test_receipt_crash_recovers_without_second_database_write(
    configured: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_install = marker._install_receipt
    monkeypatch.setattr(
        marker, "_install_receipt",
        lambda *_args: (_ for _ in ()).throw(OSError("receipt crash")),
    )
    with pytest.raises(OSError, match="receipt crash"):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )
    applied = _pack(configured["database"])
    assert json.loads(applied["draft_validation_metadata"])[
        "dual_platform_private_preview_complete"
    ] is True
    assert not configured["receipt"].exists()
    durable_before_replay = _durable_receipt(configured["database"])
    assert durable_before_replay is not None
    monkeypatch.setattr(marker, "_install_receipt", real_install)
    result = marker.apply_private(
        configured["evidence_path"], configured["receipt"], configured["files"],
        IDEMPOTENCY_KEY,
    )
    assert result["replayed"] is True and result["receipt_created"] is True
    assert _pack(configured["database"]) == applied
    assert _durable_receipt(configured["database"]) == durable_before_replay


def test_idempotency_key_or_durable_row_drift_cannot_replay(configured: dict) -> None:
    marker.apply_private(
        configured["evidence_path"], configured["receipt"], configured["files"],
        IDEMPOTENCY_KEY,
    )
    accepted = _pack(configured["database"])
    durable = _durable_receipt(configured["database"])
    receipt_bytes = configured["receipt"].read_bytes()
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="idempotency"):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            "different-preview-marker-key-v1",
        )
    assert _pack(configured["database"]) == accepted
    assert _durable_receipt(configured["database"]) == durable
    assert configured["receipt"].read_bytes() == receipt_bytes

    db = sqlite3.connect(configured["database"])
    db.execute(
        f"UPDATE {marker.RECEIPT_TABLE} SET request_sha256=?",
        ("0" * 64,),
    )
    db.commit(); db.close()
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="request_sha256"):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )
    assert _pack(configured["database"]) == accepted


def test_applied_gate_without_durable_receipt_cannot_unlock_replay(configured: dict) -> None:
    marker.apply_private(
        configured["evidence_path"], configured["receipt"], configured["files"],
        IDEMPOTENCY_KEY,
    )
    accepted = _pack(configured["database"])
    configured["receipt"].unlink()
    db = sqlite3.connect(configured["database"])
    db.execute(f"DELETE FROM {marker.RECEIPT_TABLE}")
    db.commit(); db.close()
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="lacks durable"):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )
    assert _pack(configured["database"]) == accepted
    assert not configured["receipt"].exists()


def test_receipt_insert_failure_rolls_back_validation_cas(configured: dict) -> None:
    db = sqlite3.connect(configured["database"])
    db.executescript(f"""
      CREATE TRIGGER block_preview_receipt_insert
      BEFORE INSERT ON {marker.RECEIPT_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'receipt insert blocked');
      END;
    """)
    db.commit(); db.close()
    before = _pack(configured["database"])
    with pytest.raises(sqlite3.IntegrityError, match="receipt insert blocked"):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )
    assert _pack(configured["database"]) == before
    assert _durable_receipt(configured["database"]) is None
    assert not configured["receipt"].exists()


@pytest.mark.parametrize("damage", ["missing", "foreign_row", "missing_unique_index"])
def test_durable_receipt_schema_or_identity_drift_fails_before_pack_write(
    configured: dict, damage: str,
) -> None:
    db = sqlite3.connect(configured["database"])
    if damage == "missing":
        db.execute(f"DROP TABLE {marker.RECEIPT_TABLE}")
    elif damage == "foreign_row":
        db.execute("INSERT INTO users VALUES (?,1)", (999,))
        db.execute(
            "INSERT INTO authored_trip_packs VALUES (?,?,?,?,?,?,?,?,?)",
            (
                "foreign-pack", "original_drive", "draft", None, 5, "Foreign",
                "{}", "{}", "foreign",
            ),
        )
        placeholders = ",".join("?" for _ in marker.RECEIPT_COLUMNS)
        values = ["x" for _ in marker.RECEIPT_COLUMNS]
        values[0] = "foreign-receipt"
        values[1] = "foreign-pack"
        values[2] = 5
        values[marker.RECEIPT_COLUMNS.index("historical_validation_report_count")] = 1
        values[marker.RECEIPT_COLUMNS.index("full_bundle_validation_report_count")] = 0
        values[marker.RECEIPT_COLUMNS.index("admin_user_id")] = 999
        values[marker.RECEIPT_COLUMNS.index("created_at")] = 1
        db.execute(
            f"INSERT INTO {marker.RECEIPT_TABLE} VALUES ({placeholders})", values,
        )
    else:
        # SQLite creates the UNIQUE auto-index from the table constraint; a
        # replacement table without that constraint must fail the schema gate.
        db.execute(f"ALTER TABLE {marker.RECEIPT_TABLE} RENAME TO old_receipts")
        column_sql = ",".join(
            f"{name} {'INTEGER' if name in {'draft_revision', 'admin_user_id', 'created_at'} else 'TEXT'}"
            + (" PRIMARY KEY" if name == "receipt_id" else "")
            for name in marker.RECEIPT_COLUMNS
        )
        db.execute(f"CREATE TABLE {marker.RECEIPT_TABLE}({column_sql})")
    db.commit(); db.close()
    before = _pack(configured["database"])
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="receipt"):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )
    assert _pack(configured["database"]) == before
    assert not configured["receipt"].exists()


def test_different_evidence_cannot_replace_immutable_gate(configured: dict) -> None:
    marker.apply_private(
        configured["evidence_path"], configured["receipt"], configured["files"],
        IDEMPOTENCY_KEY,
    )
    accepted = _pack(configured["database"])
    changed = copy.deepcopy(configured["evidence"])
    changed["evidence_id"] = "different_dual_platform_preview_v1"
    path = configured["evidence_path"].with_name("different.json")
    path.write_text(json.dumps(changed), encoding="utf-8")
    path.chmod(0o600)
    with pytest.raises(marker.DualPlatformPreviewMarkerError):
        marker.apply_private(
            path, configured["receipt"].with_name("other.json"), configured["files"],
            IDEMPOTENCY_KEY,
        )
    assert _pack(configured["database"]) == accepted


@pytest.mark.parametrize("mutation", ["revision", "report", "authorization", "admin"])
def test_snapshot_drift_fails_before_write(configured: dict, mutation: str) -> None:
    db = sqlite3.connect(configured["database"])
    if mutation == "revision":
        db.execute("UPDATE authored_trip_packs SET draft_revision=6")
    elif mutation == "report":
        db.execute(
            """INSERT INTO authored_original_validation_reports
               SELECT ?,pack_id,5,manifest_sha256,assets_sha256,input_sha256,
                      validator_source_sha256,manifest_json,suite_version,
                      engine_version,status,passed,summary_json,scenarios_json,
                      issues_json,started_by,worker_pid,started_at,completed_at
               FROM authored_original_validation_reports WHERE id=?""",
            ("new_full_bundle_report", marker.HISTORICAL_REPORT_ID),
        )
    elif mutation == "authorization":
        db.execute("INSERT INTO authored_original_release_authorizations_v1 VALUES (?)", (marker.PRODUCT_ID,))
    else:
        db.execute("UPDATE users SET is_admin=0")
    db.commit(); db.close()
    before = _pack(configured["database"])
    with pytest.raises(marker.DualPlatformPreviewMarkerError):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )
    assert _pack(configured["database"]) == before
    assert not configured["receipt"].exists()


def test_asset_integrity_failure_rolls_back_before_gate(
    configured: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        marker.store, "_validate_original_profile_all_assets_locked",
        lambda *_args: (_ for _ in ()).throw(ValueError("hash drift")),
    )
    before = _pack(configured["database"])
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="asset bytes"):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )
    assert _pack(configured["database"]) == before


@pytest.mark.parametrize(
    "drift",
    [
        "source_revision",
        "playback_check",
        "app_link_check",
        "physical_device",
        "offline_threshold",
    ],
)
def test_private_platform_record_drift_stops_before_database(
    configured: dict, monkeypatch: pytest.MonkeyPatch, drift: str
) -> None:
    preview_path = configured["files"]["android_preview_evidence"]
    preview = json.loads(preview_path.read_text(encoding="utf-8"))
    if drift == "source_revision":
        preview["source_revision"]["commit"] = "c" * 40
    elif drift == "playback_check":
        preview["checks"]["all_85_narration_playback_paths_exercised"] = False
    elif drift == "app_link_check":
        preview["checks"]["app_links_verified"] = False
    elif drift == "physical_device":
        preview["device_environment"]["physical_device"] = False
    else:
        preview["offline_map"]["javascript_integer_required_free_space_bytes"] = 738_352_120
    _write_private_json(preview_path, preview)
    envelope = copy.deepcopy(configured["evidence"])
    envelope["platforms"][0]["preview_evidence_sha256"] = marker._sha256_path(preview_path)
    _write_private_json(configured["evidence_path"], envelope)
    monkeypatch.setattr(
        marker.store, "_conn", lambda: pytest.fail("invalid private evidence reached database"),
    )
    with pytest.raises(marker.DualPlatformPreviewMarkerError):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )


def test_compatibility_freeze_must_bind_exact_current_marker_source(
    configured: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    compatibility = json.loads(configured["compatibility"].read_text(encoding="utf-8"))
    compatibility["source_sets"]["complete_release_support_source"]["rows"][0][
        "sha256"
    ] = "0" * 64
    _write_private_json(configured["compatibility"], compatibility)
    monkeypatch.setattr(
        marker.store, "_conn", lambda: pytest.fail("drifted compatibility reached database"),
    )
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="Source changed"):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )


def test_wrong_platform_hash_and_foreign_receipt_fail_closed(configured: dict) -> None:
    ios = configured["files"]["ios_preview_evidence"]
    original = ios.read_bytes()
    ios.write_bytes(b"changed"); ios.chmod(0o600)
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="ios preview"):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )
    ios.write_bytes(original); ios.chmod(0o600)
    before = _pack(configured["database"])
    configured["receipt"].write_bytes(b"foreign\n"); configured["receipt"].chmod(0o600)
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="Receipt exists"):
        marker.apply_private(
            configured["evidence_path"], configured["receipt"], configured["files"],
            IDEMPOTENCY_KEY,
        )
    assert _pack(configured["database"]) == before


def test_apply_cli_requires_sentinel_before_paths_or_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        marker, "apply_private", lambda *_args: pytest.fail("apply started"),
    )
    with pytest.raises(SystemExit):
        marker.main(["--apply"])
    with pytest.raises(SystemExit):
        marker.main(["--apply", "wrong-marker"])
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="Live-shaped"):
        marker.main(["--evidence", "/private/evidence.json"])
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="paths"):
        marker.main(["--apply", marker.APPLY_SENTINEL])


def test_private_file_rejects_broad_permissions_and_symlink(tmp_path: Path) -> None:
    tmp_path.chmod(0o700)
    source = tmp_path / "source.json"
    source.write_text("{}", encoding="utf-8"); source.chmod(0o644)
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="0600"):
        marker._private_file(source.resolve(), "Evidence")
    source.chmod(0o600)
    link = tmp_path / "link.json"; link.symlink_to(source)
    with pytest.raises(marker.DualPlatformPreviewMarkerError, match="symlink"):
        marker._private_file(link, "Evidence")
