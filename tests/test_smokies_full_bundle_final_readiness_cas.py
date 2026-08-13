import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3

import pytest

from db import originals_route_evidence, originals_smokies_final_readiness as ready
from db import store


ROOT = Path(__file__).resolve().parents[1]


def _sha(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
    ).hexdigest()


def _rev4_manifest() -> dict:
    manifest = json.loads((
        ROOT / "originals/smokies/smokies_complete_private_manifest_v3.json"
    ).read_text(encoding="utf-8"))
    # Rev4's profile verification is server-owned at action time. Preserve it
    # as an exact predecessor field without pretending to know its future value.
    manifest["narration_profile"]["commercial_license"]["verified_at"] = (
        "2026-08-11T20:00:00Z"
    )
    return manifest


def _route_evidence() -> dict:
    evidence = json.loads((
        ROOT / "originals/smokies/official_route_evidence_v1.json"
    ).read_text(encoding="utf-8"))
    evidence["evidence_id"] = ready.PUBLICATION_ROUTE_EVIDENCE_ID
    evidence["publication_status"] = "ready_for_publication"
    evidence["publication_blockers"] = []
    evidence["publication_review_bindings"] = {
        "technical_field_drive_evidence_sha256": "7" * 64,
        "source_review_evidence_sha256": "8" * 64,
        "vehicle_source_policy_sha256": ready.OPERATIONAL_POLICY_CANONICAL_SHA256,
    }
    return evidence


def _artifact(manifest: dict, evidence: dict) -> dict:
    return {
        "schema_version": 1,
        "kind": ready.FINALIZATION_REVIEW_KIND,
        "review_id": ready.FINALIZATION_REVIEW_ID,
        "status": "field_drive_and_source_review_complete",
        "product_id": ready.PRODUCT_ID,
        "expected_before_draft_revision": 4,
        "expected_after_draft_revision": 5,
        "expected_before_manifest_sha256": _sha(manifest),
        "content_projection_sha256": ready.CONTENT_PROJECTION_SHA256,
        "review": {
            "editorial_status": "approved",
            "field_drive_completed_at": "2026-08-11T19:00:00Z",
            "source_review_completed_at": "2026-08-11T19:30:00Z",
        },
        "offline_map_estimated_bytes": ready.EXPECTED_OFFLINE_MAP_BYTES,
        "publication_review_bindings": dict(
            evidence["publication_review_bindings"]
        ),
        "route_evidence": {
            "schema_version": 1,
            "evidence_id": ready.PUBLICATION_ROUTE_EVIDENCE_ID,
            "evidence_sha256": _sha(evidence),
            "product_id": evidence["product_id"],
            "route_spec_sha256": evidence["route_spec_sha256"],
            "source_snapshot_sha256": evidence["source_snapshot_sha256"],
        },
        "roaring_fork_final_disclaimer": ready.FINAL_DISCLAIMER,
        "roaring_fork_final_accessibility_note": (
            ready.FINAL_ACCESSIBILITY_NOTE
        ),
        "effects": {
            "database_accessed": False,
            "database_mutated": False,
            "network_accessed": False,
            "provider_accessed": False,
            "provider_mutated": False,
            "publication_performed": False,
            "public_release": False,
        },
    }


def _historical_validation_contract() -> tuple[dict, dict]:
    history, binding = ready.load_historical_validation_contract()
    return copy.deepcopy(history), copy.deepcopy(binding)


def _insert_historical_validation_report(db, *, admin_id: int, now: int) -> None:
    report_manifest = {"schema_version": 3, "fixture": "historical_report"}
    report_manifest_sha256 = store._original_validation_hash(report_manifest)
    report = {
        "schema_version": 1,
        "report_type": "OriginalRouteValidationReportV1",
        "id": store._SMOKIES_HISTORICAL_REPORT_ID,
        "pack_id": ready.PRODUCT_ID,
        "draft_revision": 2,
        "manifest_sha256": report_manifest_sha256,
        "assets_sha256": "1" * 64,
        "input_sha256": "2" * 64,
        "validator_source_sha256": "3" * 64,
        "suite_version": "originals_virtual_route_v3",
        "engine_version": "original-trigger-v3",
        "status": "passed",
        "passed": True,
        "summary": {
            "required": 13,
            "passed": 13,
            "failed": 0,
            "selection_count": 1,
            "selections_passed": 1,
            "selections_failed": 0,
            "validated_selections": [store._SMOKIES_RF_SELECTION_KEY],
            "validated_delivery_contracts": [
                f"{store._SMOKIES_RF_SELECTION_KEY}:"
                f"{store._SMOKIES_RF_DELIVERY_CONTRACT_SHA256}"
            ],
        },
        "scenarios": [{
            "selection_key": store._SMOKIES_RF_SELECTION_KEY,
            "passed": True,
            "issues": [],
            "scenarios": [
                {"scenario_id": f"scenario_{index}"}
                for index in range(13)
            ],
        }],
        "issues": [],
    }
    db.execute(
        """INSERT INTO authored_original_validation_reports
           (id,pack_id,draft_revision,manifest_sha256,assets_sha256,input_sha256,
            validator_source_sha256,manifest_json,suite_version,engine_version,
            status,passed,summary_json,scenarios_json,issues_json,started_by,
            worker_pid,started_at,completed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            report["id"], report["pack_id"], report["draft_revision"],
            report["manifest_sha256"], report["assets_sha256"],
            report["input_sha256"], report["validator_source_sha256"],
                json.dumps(report_manifest), report["suite_version"],
                report["engine_version"],
            report["status"], 1, json.dumps(report["summary"]),
            json.dumps(report["scenarios"]), "[]", admin_id, 16,
            now + 1, now + 2,
        ),
    )


def _install_synthetic_historical_contract(monkeypatch, db) -> tuple[dict, dict]:
    """Bind synthetic row values without weakening production fixed constants."""
    row = dict(db.execute(
        "SELECT * FROM authored_original_validation_reports WHERE id=?",
        (store._SMOKIES_HISTORICAL_REPORT_ID,),
    ).fetchone())
    redacted = store._original_validation_report_from_row(
        row,
        current_material={
            key: row[key]
            for key in (
                "draft_revision",
                "manifest_sha256",
                "assets_sha256",
                "input_sha256",
                "validator_source_sha256",
            )
        },
    )
    redacted_sha256 = _sha(redacted)
    history, binding = _historical_validation_contract()
    history["redacted_report_sha256"] = redacted_sha256
    history["expected_manifest_sha256"] = row["manifest_sha256"]
    history["expected_assets_sha256"] = row["assets_sha256"]
    history["expected_input_sha256"] = row["input_sha256"]
    history["expected_validator_source_sha256"] = row[
        "validator_source_sha256"
    ]
    history["expected_worker_pid"] = row["worker_pid"]
    history["expected_started_by"] = row["started_by"]
    history["expected_started_at"] = row["started_at"]
    history["expected_completed_at"] = row["completed_at"]
    binding["historical_validation_contract_sha256"] = _sha(history)
    monkeypatch.setattr(
        store, "_SMOKIES_HISTORICAL_REPORT_MANIFEST_SHA256",
        row["manifest_sha256"],
    )
    monkeypatch.setattr(
        store, "_SMOKIES_HISTORICAL_ASSETS_SHA256", row["assets_sha256"]
    )
    monkeypatch.setattr(
        store, "_SMOKIES_HISTORICAL_INPUT_SHA256", row["input_sha256"]
    )
    monkeypatch.setattr(
        store, "_SMOKIES_HISTORICAL_VALIDATOR_SOURCE_SHA256",
        row["validator_source_sha256"],
    )
    monkeypatch.setattr(store, "_SMOKIES_HISTORICAL_WORKER_PID", row["worker_pid"])
    monkeypatch.setattr(store, "_SMOKIES_HISTORICAL_STARTED_BY", row["started_by"])
    monkeypatch.setattr(store, "_SMOKIES_HISTORICAL_STARTED_AT", row["started_at"])
    monkeypatch.setattr(
        store, "_SMOKIES_HISTORICAL_COMPLETED_AT", row["completed_at"]
    )
    monkeypatch.setattr(
        store, "_SMOKIES_HISTORICAL_REDACTED_REPORT_SHA256", redacted_sha256
    )
    monkeypatch.setattr(
        store,
        "load_smokies_historical_validation_contract",
        lambda: (copy.deepcopy(history), copy.deepcopy(binding)),
    )
    return history, binding


def test_additive_route_registration_preserves_historical_artifact():
    historical = originals_route_evidence.DEFAULT_SMOKIES_ROUTE_EVIDENCE
    before = historical.read_bytes()
    assert hashlib.sha256(before).hexdigest() == (
        "d946ffaf8f21ad97399b6dedfb5cbe9483fce0787653b389d7075d933f398c60"
    )
    assert originals_route_evidence._REGISTERED_EVIDENCE[
        "smokies-official-routes-2026-v1"
    ] == historical
    assert originals_route_evidence._REGISTERED_EVIDENCE[
        ready.PUBLICATION_ROUTE_EVIDENCE_ID
    ] == originals_route_evidence.SMOKIES_PUBLICATION_ROUTE_EVIDENCE
    assert not originals_route_evidence.SMOKIES_PUBLICATION_ROUTE_EVIDENCE.exists()
    with pytest.raises(
        originals_route_evidence.OriginalRouteEvidenceError,
        match="could not be loaded",
    ):
        originals_route_evidence.load_registered_route_evidence(
            ready.PUBLICATION_ROUTE_EVIDENCE_ID
        )
    assert historical.read_bytes() == before


def test_default_artifact_loader_fails_closed_while_real_inputs_are_absent():
    assert not ready.FINALIZATION_REVIEW_PATH.exists()
    assert not ready.SMOKIES_PUBLICATION_ROUTE_EVIDENCE.exists()
    with pytest.raises(ready.SmokiesFinalReadinessError):
        ready.load_finalization_review_artifact()


def test_historical_validation_contract_is_exact_source_bound():
    history, binding = ready.load_historical_validation_contract()
    assert history["expected_report_count"] == 1
    assert history["report_id"] == store._SMOKIES_HISTORICAL_REPORT_ID
    assert binding["historical_validation_source_sha256"] == (
        ready.HISTORICAL_VALIDATION_SOURCE_SHA256
    )
    assert binding["historical_validation_contract_sha256"] == _sha(history)
    assert history["expected_worker_pid"] == 16
    assert history["expected_manifest_sha256"] == (
        "b6f730d17922f7b38361d08e9bc97bde1d340a0c42d9b455802fca708585d725"
    )
    assert history["expected_selection_result_count"] == 1
    assert history["expected_nested_scenario_count"] == 13
    assert store._SMOKIES_HISTORICAL_REDACTED_REPORT_SHA256 == (
        "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059"
    )


def test_exact_allowed_transition_and_reverse_preserve_content():
    manifest = _rev4_manifest()
    evidence = _route_evidence()
    artifact = _artifact(manifest, evidence)
    final = ready.build_final_manifest(
        manifest,
        artifact,
        content_projection=store._original_v3_release_content_projection(
            manifest
        ),
        route_evidence_document=evidence,
    )
    assert final["review"] == artifact["review"]
    assert final["offline_map"]["estimated_bytes"] == ready.EXPECTED_OFFLINE_MAP_BYTES
    assert final["route_evidence"] == artifact["route_evidence"]
    assert final["narration_profile"] == manifest["narration_profile"]
    assert [
        (chapter["operational_readiness"], chapter["operational_sources"])
        for chapter in final["chapters"]
    ] == [
        (chapter["operational_readiness"], chapter["operational_sources"])
        for chapter in manifest["chapters"]
    ]
    change = ready.allowed_change_contract(manifest, final)
    assert change["before_offline_map_estimated_bytes"] == 0
    assert change["after_offline_map_estimated_bytes"] == ready.EXPECTED_OFFLINE_MAP_BYTES
    reversed_manifest = ready.reconstruct_private_predecessor(
        final,
        artifact,
        content_projection=store._original_v3_release_content_projection(final),
        route_evidence_document=evidence,
    )
    assert reversed_manifest == manifest


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value.update(status="blocked"),
        lambda value: value.update(expected_before_draft_revision=3),
        lambda value: value.update(content_projection_sha256="0" * 64),
        lambda value: value["review"].update(editorial_status="pending"),
        lambda value: value.update(offline_map_estimated_bytes=0),
        lambda value: value["route_evidence"].update(
            evidence_id="smokies-official-routes-2026-v1"
        ),
        lambda value: value["effects"].update(database_accessed=True),
    ],
)
def test_artifact_contract_rejects_blocked_or_drifted_facts(mutate):
    manifest = _rev4_manifest()
    evidence = _route_evidence()
    artifact = _artifact(manifest, evidence)
    mutate(artifact)
    with pytest.raises(ready.SmokiesFinalReadinessError):
        ready.validate_finalization_review_artifact(
            artifact,
            route_evidence_document=evidence,
        )


def test_transition_rejects_any_nonapproved_content_change():
    manifest = _rev4_manifest()
    evidence = _route_evidence()
    artifact = _artifact(manifest, evidence)
    transcript_drift = copy.deepcopy(manifest)
    transcript_drift["stories"][0]["transcript"] += " drift"
    with pytest.raises(ready.SmokiesFinalReadinessError, match="predecessor"):
        ready.build_final_manifest(
            transcript_drift,
            artifact,
            content_projection=store._original_v3_release_content_projection(
                transcript_drift
            ),
            route_evidence_document=evidence,
        )
    profile_drift = copy.deepcopy(manifest)
    profile_drift["narration_profile"]["voice_id"] = "changed"
    with pytest.raises(ready.SmokiesFinalReadinessError, match="predecessor"):
        ready.build_final_manifest(
            profile_drift,
            artifact,
            content_projection=store._original_v3_release_content_projection(
                profile_drift
            ),
            route_evidence_document=evidence,
        )


def test_store_cas_signature_and_operator_are_default_locked():
    from scripts import finalize_smokies_full_bundle_readiness as operator

    dry = operator.dry_run()
    assert dry["status"] == "dry_run_live_apply_locked"
    assert dry["required_artifacts_present"] is False
    assert dry["database_accessed"] is False
    assert dry["database_mutated"] is False
    assert dry["network_accessed"] is False
    assert dry["writes_performed"] is False
    with pytest.raises(operator.SmokiesFinalReadinessOperatorError):
        operator.apply(
            apply_sentinel="continue",
            expected_manifest_sha256="0" * 64,
            expected_validation_metadata_sha256="0" * 64,
            admin_user_id=1,
            idempotency_key="readiness-test-key-123",
            receipt_path=Path("receipt.json"),
        )


def test_operator_external_receipt_is_create_only_and_exactly_replayable(
    monkeypatch, tmp_path: Path,
) -> None:
    from scripts import finalize_smokies_full_bundle_readiness as operator

    private_root = tmp_path / "private"
    private_root.mkdir(mode=0o700)
    receipt_path = private_root / operator.RECEIPT_NAME
    monkeypatch.setenv(operator.RECEIPT_ROOT_ENV, str(private_root))
    receipt = {
        "schema_version": 1,
        "kind": "smokies_full_bundle_final_readiness_cas_receipt",
        "status": "verified_final_readiness_cas",
        "effects": {"database_mutated": True},
    }
    binding = operator._write_receipt_create_only(receipt_path, receipt)
    assert binding["receipt_sha256"] == hashlib.sha256(
        ready.canonical_bytes(receipt)
    ).hexdigest()
    assert operator._read_existing_receipt(receipt_path, receipt) == binding
    drifted = copy.deepcopy(receipt)
    drifted["status"] = "drifted"
    with pytest.raises(
        operator.SmokiesFinalReadinessOperatorError, match="drifted"
    ):
        operator._read_existing_receipt(receipt_path, drifted)
    receipt_path.chmod(0o600)
    receipt_path.write_bytes(ready.canonical_bytes(drifted))
    with pytest.raises(
        operator.SmokiesFinalReadinessOperatorError, match="drifted"
    ):
        operator._read_existing_receipt(receipt_path, receipt)


def test_store_rejects_unregistered_review_path_before_database_access(
    monkeypatch, tmp_path: Path,
) -> None:
    called = False

    def _should_not_connect():
        nonlocal called
        called = True
        raise AssertionError("database must remain closed")

    monkeypatch.setattr(store, "_conn", _should_not_connect)
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError,
        match="registered server artifact",
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID,
            expected_draft_revision=4,
            expected_manifest_sha256="0" * 64,
            expected_validation_metadata_sha256="1" * 64,
            admin_user_id=1,
            idempotency_key="final-readiness-path-test",
            finalization_review_artifact_path=tmp_path / "other.json",
            private_receipt_parent_identity_sha256="9" * 64,
        )
    assert called is False


def test_operator_rejects_private_receipt_parent_retarget(
    monkeypatch, tmp_path: Path,
) -> None:
    from scripts import finalize_smokies_full_bundle_readiness as operator

    root = tmp_path / "private"
    root.mkdir(mode=0o700)
    path = root / operator.RECEIPT_NAME
    monkeypatch.setenv(operator.RECEIPT_ROOT_ENV, str(root))
    _path, descriptor, identity = operator._private_receipt_path(path)
    moved = tmp_path / "moved-private"
    root.rename(moved)
    root.mkdir(mode=0o700)
    try:
        with pytest.raises(
            operator.SmokiesFinalReadinessOperatorError,
            match="identity changed",
        ):
            operator._assert_receipt_parent(path, descriptor, identity)
    finally:
        os.close(descriptor)


def test_anonymous_receipt_collision_preserves_foreign_file(
    tmp_path: Path,
) -> None:
    from scripts import finalize_smokies_full_bundle_readiness as operator

    root = tmp_path / "private"
    root.mkdir(mode=0o700)
    path = root / operator.RECEIPT_NAME
    foreign = b"foreign\n"
    path.write_bytes(foreign)
    path.chmod(0o600)
    with pytest.raises(FileExistsError):
        operator._write_receipt_create_only(path, {"schema_version": 1})
    assert path.read_bytes() == foreign


def test_store_cas_synthetic_rev4_to_rev5_and_idempotent_replay(
    monkeypatch, tmp_path: Path,
):
    db_path = tmp_path / "readiness.sqlite"
    monkeypatch.setattr(store.settings, "db_path", str(db_path))
    store.init_db()
    manifest = _rev4_manifest()
    evidence = _route_evidence()
    artifact = _artifact(manifest, evidence)
    artifact_path = tmp_path / "readiness.json"
    route_path = tmp_path / "route.json"
    artifact_path.write_bytes(ready.canonical_bytes(artifact))
    route_path.write_bytes(ready.canonical_bytes(evidence))
    monkeypatch.setitem(
        originals_route_evidence._REGISTERED_EVIDENCE,
        ready.PUBLICATION_ROUTE_EVIDENCE_ID,
        route_path,
    )
    monkeypatch.setattr(
        ready, "SMOKIES_PUBLICATION_ROUTE_EVIDENCE", route_path
    )
    monkeypatch.setattr(store, "SMOKIES_FINALIZATION_REVIEW_PATH", artifact_path)
    validation = {
        "admin_license_attestation_complete": True,
        "verified_private_upload_complete": True,
        "authenticated_device_preview_complete": False,
        "dual_platform_private_preview_complete": False,
        "trusted_publication_validation_complete": False,
        "public_release": False,
    }
    now = 1_700_000_000
    db = store._conn()
    db.execute(
        """INSERT INTO users
           (id,email,username,password_hash,is_admin,created_at)
           VALUES (1,'admin@example.test','admin','x',1,?)""",
        (now,),
    )
    db.execute(
        """INSERT INTO authored_trip_packs
           (id,slug,status,current_published_version,
            created_by,updated_by,created_at,updated_at,content_kind,draft_title,
            draft_summary,draft_price_credits,draft_coverage_region,
            draft_public_metadata,draft_validation_metadata,draft_template_json,
            draft_original_manifest_json,draft_revision)
           VALUES (?,?,'draft',NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,4)""",
        (
            ready.PRODUCT_ID,
            "smokies",
            1,
            1,
            now,
            now,
            "original_drive",
            store.ORIGINAL_V3_RELEASE_TARGET_TITLE,
            "Private",
            900,
            "north_america",
            "{}",
            json.dumps(validation, separators=(",", ":"), sort_keys=True),
            "{}",
            json.dumps(manifest, separators=(",", ":"), sort_keys=True),
        ),
    )
    _insert_historical_validation_report(db, admin_id=1, now=now)
    synthetic_history, synthetic_binding = (
        _install_synthetic_historical_contract(monkeypatch, db)
    )
    db.commit()
    db.close()
    monkeypatch.setattr(
        store,
        "load_smokies_finalization_review_artifact",
        lambda path: (
            artifact,
            evidence,
            {
                "artifact_byte_count": artifact_path.stat().st_size,
                "artifact_sha256": hashlib.sha256(
                    artifact_path.read_bytes()
                ).hexdigest(),
                "route_evidence_byte_count": route_path.stat().st_size,
                "route_evidence_sha256": hashlib.sha256(
                    route_path.read_bytes()
                ).hexdigest(),
                "route_evidence_canonical_sha256": _sha(evidence),
            },
        ),
    )
    monkeypatch.setattr(
        store,
        "load_smokies_historical_validation_contract",
        lambda: (copy.deepcopy(synthetic_history), copy.deepcopy(synthetic_binding)),
    )
    kwargs = dict(
        expected_draft_revision=4,
        expected_manifest_sha256=_sha(manifest),
        expected_validation_metadata_sha256=_sha(validation),
        admin_user_id=1,
        idempotency_key="final-readiness-test-0001",
        finalization_review_artifact_path=artifact_path,
        private_receipt_parent_identity_sha256="9" * 64,
    )
    first = store.finalize_authored_original_smokies_full_bundle_readiness(
        ready.PRODUCT_ID, **kwargs
    )
    assert first["replayed"] is False
    first_receipt = first["receipt"]
    assert first_receipt["status"] == "verified_final_readiness_cas"
    assert first_receipt["before_revision"] == 4
    assert first_receipt["after_revision"] == 5
    assert first_receipt["effects"]["database_mutated"] is True
    replay = store.finalize_authored_original_smokies_full_bundle_readiness(
        ready.PRODUCT_ID, **kwargs
    )
    assert replay["receipt"] == first_receipt
    assert replay["replayed"] is True
    db = store._conn()
    row = db.execute(
        "SELECT * FROM authored_trip_packs WHERE id=?", (ready.PRODUCT_ID,)
    ).fetchone()
    assert int(row["draft_revision"]) == 5
    assert json.loads(row["draft_validation_metadata"]) == validation
    assert db.execute(
        "SELECT COUNT(*) FROM authored_original_validation_reports WHERE pack_id=?",
        (ready.PRODUCT_ID,),
    ).fetchone()[0] == 1
    assert first_receipt["historical_validation_report_count_before"] == 1
    assert first_receipt["historical_validation_report_count_after"] == 1
    assert first_receipt["full_bundle_validation_report_count_before"] == 0
    assert first_receipt["full_bundle_validation_report_count_after"] == 0
    assert (
        first_receipt["validation_report_inventory_sha256_before"]
        == first_receipt["validation_report_inventory_sha256_after"]
    )
    stored = db.execute(
        """SELECT * FROM
           authored_original_smokies_final_readiness_receipts_v1
           WHERE pack_id=?""",
        (ready.PRODUCT_ID,),
    ).fetchone()
    assert stored is not None
    assert json.loads(stored["receipt_json"]) == first_receipt
    db.close()


@pytest.mark.parametrize(
    "mutation",
    [
        "extra",
        "summary",
        "identity",
        "manifest",
        "assets",
        "input",
        "validator",
        "worker_null",
        "worker_other",
        "started_by",
        "started_at",
        "completed_at",
        "selection",
        "top_level_count",
        "nested_count",
        "historical_contract",
    ],
)
def test_cas_rejects_historical_validation_inventory_drift(
    monkeypatch, tmp_path: Path, mutation: str,
) -> None:
    db_path = tmp_path / "inventory.sqlite"
    monkeypatch.setattr(store.settings, "db_path", str(db_path))
    store.init_db()
    db = store._conn()
    now = 1_700_000_000
    db.execute(
        """INSERT INTO users
           (id,email,username,password_hash,is_admin,created_at)
           VALUES (1,'admin@example.test','admin','x',1,?)""",
        (now,),
    )
    db.execute(
        """INSERT INTO authored_trip_packs
           (id,slug,status,current_published_version,created_by,updated_by,
            created_at,updated_at,content_kind,draft_title,draft_summary,
            draft_price_credits,draft_coverage_region,draft_public_metadata,
            draft_validation_metadata,draft_template_json,
            draft_original_manifest_json,draft_revision)
           VALUES (?,?,'draft',NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,4)""",
        (
            ready.PRODUCT_ID, "smokies-inventory", 1, 1, now, now,
            "original_drive", store.ORIGINAL_V3_RELEASE_TARGET_TITLE,
            "Private", 900, "north_america", "{}", "{}", "{}", "{}",
        ),
    )
    _insert_historical_validation_report(db, admin_id=1, now=now)
    synthetic_history, _synthetic_binding = (
        _install_synthetic_historical_contract(monkeypatch, db)
    )
    if mutation == "extra":
        db.execute(
            """INSERT INTO authored_original_validation_reports
               SELECT 'original_validation_extra',pack_id,draft_revision,
                      manifest_sha256,assets_sha256,input_sha256,
                      validator_source_sha256,manifest_json,suite_version,
                      engine_version,status,passed,summary_json,scenarios_json,
                      issues_json,started_by,worker_pid,started_at,completed_at
               FROM authored_original_validation_reports WHERE id=?""",
            (store._SMOKIES_HISTORICAL_REPORT_ID,),
        )
    elif mutation == "summary":
        db.execute(
            """UPDATE authored_original_validation_reports
               SET summary_json='{}' WHERE id=?""",
            (store._SMOKIES_HISTORICAL_REPORT_ID,),
        )
    elif mutation == "identity":
        db.execute(
            """UPDATE authored_original_validation_reports
               SET manifest_sha256=? WHERE id=?""",
            ("0" * 64, store._SMOKIES_HISTORICAL_REPORT_ID),
        )
    elif mutation == "manifest":
        db.execute(
            """UPDATE authored_original_validation_reports
               SET manifest_json='{}' WHERE id=?""",
            (store._SMOKIES_HISTORICAL_REPORT_ID,),
        )
    elif mutation in {"assets", "input", "validator"}:
        column = {
            "assets": "assets_sha256",
            "input": "input_sha256",
            "validator": "validator_source_sha256",
        }[mutation]
        db.execute(
            f"""UPDATE authored_original_validation_reports
                SET {column}=? WHERE id=?""",
            ("0" * 64, store._SMOKIES_HISTORICAL_REPORT_ID),
        )
    elif mutation in {"worker_null", "worker_other"}:
        db.execute(
            """UPDATE authored_original_validation_reports
               SET worker_pid=? WHERE id=?""",
            (
                None if mutation == "worker_null" else 17,
                store._SMOKIES_HISTORICAL_REPORT_ID,
            ),
        )
    elif mutation in {"started_by", "started_at", "completed_at"}:
        column = mutation
        if mutation == "started_by":
            db.execute(
                """INSERT INTO users
                   (id,email,username,password_hash,is_admin,created_at)
                   VALUES (2,'other@example.test','other','x',1,?)""",
                (now,),
            )
        db.execute(
            f"""UPDATE authored_original_validation_reports
                SET {column}={column}+1 WHERE id=?""",
            (store._SMOKIES_HISTORICAL_REPORT_ID,),
        )
    elif mutation in {"selection", "top_level_count", "nested_count"}:
        scenarios = json.loads(db.execute(
            """SELECT scenarios_json FROM authored_original_validation_reports
               WHERE id=?""",
            (store._SMOKIES_HISTORICAL_REPORT_ID,),
        ).fetchone()[0])
        if mutation == "selection":
            scenarios[0]["selection_key"] = "wrong:selection"
        elif mutation == "top_level_count":
            scenarios = []
        else:
            scenarios[0]["scenarios"] = scenarios[0]["scenarios"][:-1]
        db.execute(
            """UPDATE authored_original_validation_reports
               SET scenarios_json=? WHERE id=?""",
            (json.dumps(scenarios), store._SMOKIES_HISTORICAL_REPORT_ID),
        )
    rows = db.execute(
        """SELECT * FROM authored_original_validation_reports
           WHERE pack_id=? ORDER BY id""",
        (ready.PRODUCT_ID,),
    ).fetchall()
    history = copy.deepcopy(synthetic_history)
    if mutation == "historical_contract":
        history["source_commit"] = "0" * 40
    before = [dict(row) for row in rows]
    with pytest.raises(store.OriginalSmokiesFinalReadinessConflictError):
        store._smokies_historical_validation_inventory(rows, history)
    after = [dict(row) for row in db.execute(
        """SELECT * FROM authored_original_validation_reports
           WHERE pack_id=? ORDER BY id""",
        (ready.PRODUCT_ID,),
    ).fetchall()]
    assert after == before
    db.close()


def test_general_init_upgrades_legacy_db_with_durable_receipt_table(
    monkeypatch, tmp_path: Path,
) -> None:
    db_path = tmp_path / "legacy.sqlite"
    legacy = sqlite3.connect(db_path)
    legacy.execute(
        """CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )"""
    )
    legacy.execute(
        """CREATE TABLE authored_trip_packs (
            id TEXT PRIMARY KEY,
            content_kind TEXT NOT NULL DEFAULT 'trip_pack',
            slug TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'draft',
            draft_title TEXT NOT NULL,
            draft_summary TEXT NOT NULL,
            draft_price_credits INTEGER NOT NULL,
            draft_coverage_region TEXT NOT NULL,
            draft_public_metadata TEXT NOT NULL DEFAULT '{}',
            draft_validation_metadata TEXT NOT NULL DEFAULT '{}',
            draft_template_json TEXT NOT NULL,
            draft_original_manifest_json TEXT,
            draft_revision INTEGER NOT NULL DEFAULT 1,
            current_published_version INTEGER,
            created_by INTEGER,
            updated_by INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )"""
    )
    legacy.commit()
    legacy.close()
    monkeypatch.setattr(store.settings, "db_path", str(db_path))
    store.init_db()
    db = store._conn()
    columns = {
        row["name"] for row in db.execute(
            """PRAGMA table_info(
               authored_original_smokies_final_readiness_receipts_v1)"""
        ).fetchall()
    }
    assert {
        "pack_id",
        "before_manifest_sha256",
        "after_manifest_sha256",
        "finalization_review_sha256",
        "idempotency_key_sha256",
        "request_sha256",
        "receipt_json",
        "receipt_sha256",
    } <= columns
    db.close()


def test_exact_replay_rejects_different_key_admin_or_database_drift(
    monkeypatch, tmp_path: Path,
) -> None:
    # Exercise the stored-receipt branch with one minimal internally consistent
    # row; every changed caller or database fact must fail before any mutation.
    db_path = tmp_path / "replay.sqlite"
    monkeypatch.setattr(store.settings, "db_path", str(db_path))
    store.init_db()
    manifest = _rev4_manifest()
    evidence = _route_evidence()
    artifact = _artifact(manifest, evidence)
    artifact_path = tmp_path / "review.json"
    route_path = tmp_path / "route.json"
    artifact_path.write_bytes(ready.canonical_bytes(artifact))
    route_path.write_bytes(ready.canonical_bytes(evidence))
    monkeypatch.setitem(
        originals_route_evidence._REGISTERED_EVIDENCE,
        ready.PUBLICATION_ROUTE_EVIDENCE_ID,
        route_path,
    )
    monkeypatch.setattr(ready, "SMOKIES_PUBLICATION_ROUTE_EVIDENCE", route_path)
    monkeypatch.setattr(store, "SMOKIES_FINALIZATION_REVIEW_PATH", artifact_path)
    monkeypatch.setattr(
        store,
        "load_smokies_finalization_review_artifact",
        lambda path: (
            artifact,
            evidence,
            {
                "artifact_byte_count": artifact_path.stat().st_size,
                "artifact_sha256": hashlib.sha256(
                    artifact_path.read_bytes()
                ).hexdigest(),
                "route_evidence_byte_count": route_path.stat().st_size,
                "route_evidence_sha256": hashlib.sha256(
                    route_path.read_bytes()
                ).hexdigest(),
                "route_evidence_canonical_sha256": _sha(evidence),
            },
        ),
    )
    monkeypatch.setattr(
        store,
        "load_smokies_historical_validation_contract",
        lambda: (copy.deepcopy(synthetic_history), copy.deepcopy(synthetic_binding)),
    )
    validation = {
        "authenticated_device_preview_complete": False,
        "dual_platform_private_preview_complete": False,
        "trusted_publication_validation_complete": False,
        "public_release": False,
    }
    now = 1_700_000_000
    db = store._conn()
    db.execute(
        """INSERT INTO users
           (id,email,username,password_hash,is_admin,created_at)
           VALUES (1,'one@example.test','one','x',1,?),
                  (2,'two@example.test','two','x',1,?)""",
        (now, now),
    )
    db.execute(
        """INSERT INTO authored_trip_packs
           (id,slug,status,current_published_version,created_by,updated_by,
            created_at,updated_at,content_kind,draft_title,draft_summary,
            draft_price_credits,draft_coverage_region,draft_public_metadata,
            draft_validation_metadata,draft_template_json,
            draft_original_manifest_json,draft_revision)
           VALUES (?,?,'draft',NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,4)""",
        (
            ready.PRODUCT_ID,
            "smokies-replay",
            1,
            1,
            now,
            now,
            "original_drive",
            store.ORIGINAL_V3_RELEASE_TARGET_TITLE,
            "Private",
            900,
            "north_america",
            "{}",
            json.dumps(validation, separators=(",", ":"), sort_keys=True),
            "{}",
            json.dumps(manifest, separators=(",", ":"), sort_keys=True),
        ),
    )
    _insert_historical_validation_report(db, admin_id=1, now=now)
    synthetic_history, synthetic_binding = (
        _install_synthetic_historical_contract(monkeypatch, db)
    )
    db.commit()
    db.close()
    kwargs = dict(
        expected_draft_revision=4,
        expected_manifest_sha256=_sha(manifest),
        expected_validation_metadata_sha256=_sha(validation),
        admin_user_id=1,
        idempotency_key="final-readiness-exact-key",
        finalization_review_artifact_path=artifact_path,
        private_receipt_parent_identity_sha256="9" * 64,
    )

    # The first CAS must reject every publication-state ambiguity, even when
    # the revision and manifest hashes still match the caller's snapshot.
    db = store._conn()
    db.execute(
        "UPDATE authored_trip_packs SET status='published' WHERE id=?",
        (ready.PRODUCT_ID,),
    )
    db.commit()
    db.close()
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError,
        match="unpublished private draft",
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **kwargs
        )
    db = store._conn()
    db.execute(
        "UPDATE authored_trip_packs SET status='draft' WHERE id=?",
        (ready.PRODUCT_ID,),
    )
    db.commit()
    db.close()

    db = store._conn()
    db.execute(
        "UPDATE authored_trip_packs SET current_published_version=1 WHERE id=?",
        (ready.PRODUCT_ID,),
    )
    db.commit()
    db.close()
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError,
        match="unpublished private draft",
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **kwargs
        )
    db = store._conn()
    db.execute(
        "UPDATE authored_trip_packs SET current_published_version=NULL WHERE id=?",
        (ready.PRODUCT_ID,),
    )
    db.execute(
        """INSERT INTO authored_trip_pack_versions
           (pack_id,version,content_kind,slug,title,summary,price_credits,
            coverage_region,public_metadata,validation_metadata,template_json,
            original_manifest_json,published_by,published_at)
           VALUES (?,1,'original_drive','smokies-test-version','Smokies',
                   'private',900,'north_america','{}','{}','{}','{}',1,?)""",
        (ready.PRODUCT_ID, now),
    )
    db.commit()
    db.close()
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError,
        match="unpublished private draft",
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **kwargs
        )
    db = store._conn()
    db.execute(
        "DELETE FROM authored_trip_pack_versions WHERE pack_id=?",
        (ready.PRODUCT_ID,),
    )
    db.execute(
        """INSERT INTO authored_original_release_authorizations_v1
           (id,pack_id,draft_revision,manifest_sha256,assets_sha256,asset_count,
            validation_report_id,validation_report_sha256,device_evidence_sha256,
            reviews_sha256,catalog_sha256,current_road_evidence_sha256,
            current_road_observed_at,current_road_expires_at,next_version,
            snapshot_json,snapshot_sha256,idempotency_key,request_sha256,
            authorized_by,created_at,expires_at)
           VALUES ('auth_test',?,4,?,?,98,?,?,?,?,?,?,?, ?,1,'{}',?, 'auth-key',?,1,?,?)""",
        (
            ready.PRODUCT_ID,
            _sha(manifest),
            "1" * 64,
            store._SMOKIES_HISTORICAL_REPORT_ID,
            "2" * 64,
            "3" * 64,
            "4" * 64,
            "5" * 64,
            "6" * 64,
            now,
            now + 200,
            "7" * 64,
            "auth-request",
            now,
            now + 100,
        ),
    )
    db.commit()
    db.close()
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError,
        match="unpublished private draft",
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **kwargs
        )
    db = store._conn()
    db.execute(
        "DELETE FROM authored_original_release_authorizations_v1 WHERE pack_id=?",
        (ready.PRODUCT_ID,),
    )
    db.commit()
    db.close()

    store.finalize_authored_original_smokies_full_bundle_readiness(
        ready.PRODUCT_ID, **kwargs
    )
    changed = dict(kwargs, idempotency_key="final-readiness-other-key")
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError, match="input drifted"
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **changed
        )
    changed = dict(kwargs, admin_user_id=2)
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError, match="input drifted"
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **changed
        )

    db = store._conn()
    db.execute(
        "UPDATE authored_trip_packs SET status='published' WHERE id=?",
        (ready.PRODUCT_ID,),
    )
    db.commit()
    db.close()
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError,
        match="database state drifted",
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **kwargs
        )
    db = store._conn()
    db.execute(
        "UPDATE authored_trip_packs SET status='draft' WHERE id=?",
        (ready.PRODUCT_ID,),
    )
    db.execute(
        "UPDATE authored_trip_packs SET current_published_version=1 WHERE id=?",
        (ready.PRODUCT_ID,),
    )
    db.commit()
    db.close()
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError,
        match="database state drifted",
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **kwargs
        )
    db = store._conn()
    db.execute(
        "UPDATE authored_trip_packs SET current_published_version=NULL WHERE id=?",
        (ready.PRODUCT_ID,),
    )
    db.execute(
        """INSERT INTO authored_trip_pack_versions
           (pack_id,version,content_kind,slug,title,summary,price_credits,
            coverage_region,public_metadata,validation_metadata,template_json,
            original_manifest_json,published_by,published_at)
           VALUES (?,1,'original_drive','smokies-replay-version','Smokies',
                   'private',900,'north_america','{}','{}','{}','{}',1,?)""",
        (ready.PRODUCT_ID, now),
    )
    db.commit()
    db.close()
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError,
        match="database state drifted",
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **kwargs
        )
    db = store._conn()
    db.execute(
        "DELETE FROM authored_trip_pack_versions WHERE pack_id=?",
        (ready.PRODUCT_ID,),
    )
    db.execute(
        """INSERT INTO authored_original_release_authorizations_v1
           (id,pack_id,draft_revision,manifest_sha256,assets_sha256,asset_count,
            validation_report_id,validation_report_sha256,device_evidence_sha256,
            reviews_sha256,catalog_sha256,current_road_evidence_sha256,
            current_road_observed_at,current_road_expires_at,next_version,
            snapshot_json,snapshot_sha256,idempotency_key,request_sha256,
            authorized_by,created_at,expires_at)
           VALUES ('auth_replay_test',?,5,?,?,98,?,?,?,?,?,?,?, ?,1,'{}',?,
                   'auth-replay-key',?,1,?,?)""",
        (
            ready.PRODUCT_ID,
            "8" * 64,
            "1" * 64,
            store._SMOKIES_HISTORICAL_REPORT_ID,
            "2" * 64,
            "3" * 64,
            "4" * 64,
            "5" * 64,
            "6" * 64,
            now,
            now + 200,
            "7" * 64,
            "auth-replay-request",
            now,
            now + 100,
        ),
    )
    db.commit()
    db.close()
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError,
        match="database state drifted",
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **kwargs
        )
    db = store._conn()
    db.execute(
        "DELETE FROM authored_original_release_authorizations_v1 WHERE pack_id=?",
        (ready.PRODUCT_ID,),
    )
    db.commit()
    db.close()

    db = store._conn()
    db.execute(
        """UPDATE authored_trip_packs SET draft_validation_metadata='{}'
           WHERE id=?""",
        (ready.PRODUCT_ID,),
    )
    db.commit()
    db.close()
    with pytest.raises(
        store.OriginalSmokiesFinalReadinessConflictError,
        match="database state drifted",
    ):
        store.finalize_authored_original_smokies_full_bundle_readiness(
            ready.PRODUCT_ID, **kwargs
        )
