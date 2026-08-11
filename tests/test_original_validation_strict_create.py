from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
from pathlib import Path

import pytest

from db import store
from db import originals_complete_validation as complete_validation


PACK_ID = "strict_original"
TARGET_PACK_ID = complete_validation.PRODUCT_ID
REAL_ORIGINAL_VALIDATION_MATERIAL = store._original_validation_material


def _connection(database: Path) -> sqlite3.Connection:
    db = sqlite3.connect(database, timeout=10, check_same_thread=False)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=10000")
    db.row_factory = sqlite3.Row
    return db


def _material(revision: int) -> dict:
    return {
        "draft_revision": revision,
        "manifest_sha256": f"{revision:064x}",
        "assets_sha256": f"{revision + 10:064x}",
        "input_sha256": f"{revision + 20:064x}",
        "validator_source_sha256": f"{revision + 30:064x}",
    }


def _setup(monkeypatch, tmp_path: Path) -> Path:
    database = tmp_path / "strict-create.db"
    db = _connection(database)
    db.executescript(
        """
        CREATE TABLE users (id INTEGER PRIMARY KEY, is_admin INTEGER NOT NULL);
        CREATE TABLE authored_trip_packs (
            id TEXT PRIMARY KEY,
            content_kind TEXT NOT NULL,
            draft_revision INTEGER NOT NULL
        );
        CREATE TABLE authored_original_validation_reports (
            id TEXT PRIMARY KEY,
            pack_id TEXT NOT NULL,
            draft_revision INTEGER NOT NULL,
            manifest_sha256 TEXT NOT NULL,
            assets_sha256 TEXT NOT NULL,
            input_sha256 TEXT NOT NULL,
            validator_source_sha256 TEXT NOT NULL,
            manifest_json TEXT NOT NULL,
            suite_version TEXT NOT NULL,
            engine_version TEXT,
            status TEXT NOT NULL,
            passed INTEGER NOT NULL DEFAULT 0,
            summary_json TEXT NOT NULL DEFAULT '{}',
            scenarios_json TEXT NOT NULL DEFAULT '[]',
            issues_json TEXT NOT NULL DEFAULT '[]',
            started_by INTEGER,
            worker_pid INTEGER,
            started_at INTEGER NOT NULL,
            completed_at INTEGER
        );
        """
    )
    db.execute("INSERT INTO users(id,is_admin) VALUES (7,1)")
    db.execute(
        "INSERT INTO authored_trip_packs VALUES (?,?,?)",
        (PACK_ID, "original_drive", 2),
    )
    db.commit()
    db.close()

    monkeypatch.setattr(store, "_conn", lambda: _connection(database))
    monkeypatch.setattr(store, "_verified_original_asset_map_db", lambda *_: {})
    monkeypatch.setattr(
        store,
        "_authored_original_validation_manifest_from_row",
        lambda pack, *_args, **_kwargs: {
            "version": store.ORIGINAL_DEVICE_PREVIEW_VERSION_BASE
            + int(pack["draft_revision"]),
            "revision_marker": int(pack["draft_revision"]),
        },
    )
    monkeypatch.setattr(
        store,
        "_original_validation_material",
        lambda _manifest, revision: _material(revision),
    )
    return database


def _strict_create(expected: dict) -> dict:
    return store.create_authored_original_virtual_validation_run(
        PACK_ID,
        7,
        require_zero_active_reports=True,
        require_zero_pack_reports=True,
        expected_draft_revision=expected["draft_revision"],
        expected_manifest_sha256=expected["manifest_sha256"],
        expected_assets_sha256=expected["assets_sha256"],
        expected_input_sha256=expected["input_sha256"],
    )


def _target_manifest() -> dict:
    return {
        "schema_version": 3,
        "pack_id": TARGET_PACK_ID,
        "assets": [],
        "chapters": [],
    }


def _target_inventory() -> list[dict]:
    rows = []
    for index, key in enumerate(sorted(complete_validation.EXPECTED_SELECTION_KEYS), start=1):
        contract = hashlib.sha256(f"{key}:{index}".encode()).hexdigest()
        selection = {
            "chapter_id": key[1],
            "variant_id": key[2],
            "delivery_contract_sha256": contract,
        }
        compiled = {
            "manifest": {"pack_id": key[0]},
            "selection": dict(selection),
            "selectable": {"delivery_contract_sha256": contract},
        }
        rows.append({
            "manifest": {"pack_id": key[0]},
            "selection": selection,
            "long_form_compiled": compiled,
            "delivery_contract_sha256": contract,
        })
    return rows


def _invalid_target_inventory(kind: str) -> list[dict]:
    rows = _target_inventory()
    if kind == "partial":
        return rows[:1]
    if kind == "missing":
        return rows[:-1]
    if kind == "duplicate":
        return [*rows[:-1], {**rows[0], "selection": dict(rows[0]["selection"])}]
    if kind == "extra":
        return [*rows, {**rows[0], "selection": {
            **rows[0]["selection"],
            "chapter_id": "extra_chapter",
            "variant_id": "extra_variant",
        }}]
    raise AssertionError(kind)


def _setup_target_inventory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    rows: list[dict],
) -> Path:
    database = _setup(monkeypatch, tmp_path)
    db = _connection(database)
    db.execute(
        "UPDATE authored_trip_packs SET id=? WHERE id=?",
        (TARGET_PACK_ID, PACK_ID),
    )
    db.commit()
    db.close()
    monkeypatch.setattr(store, "_original_validation_material", REAL_ORIGINAL_VALIDATION_MATERIAL)
    monkeypatch.setattr(
        store,
        "_authored_original_validation_manifest_from_row",
        lambda *_args, **_kwargs: _target_manifest(),
    )
    monkeypatch.setattr(
        store,
        "_compiled_original_validation_selections",
        lambda _manifest: rows,
    )
    return database


def test_strict_create_serializes_two_zero_report_preflights(
    monkeypatch, tmp_path: Path,
) -> None:
    database = _setup(monkeypatch, tmp_path)
    expected = _material(2)
    barrier = threading.Barrier(2)
    results: list[dict] = []
    errors: list[Exception] = []

    def worker() -> None:
        barrier.wait()
        try:
            results.append(_strict_create(expected))
        except Exception as exc:  # asserted below
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert all(not thread.is_alive() for thread in threads)
    assert len(results) == 1
    assert results[0]["status"] == "running"
    assert len(errors) == 1
    assert isinstance(errors[0], ValueError)
    db = _connection(database)
    try:
        assert db.execute(
            "SELECT COUNT(*) FROM authored_original_validation_reports"
        ).fetchone()[0] == 1
    finally:
        db.close()


def test_strict_create_recomputes_material_after_waiting_for_draft_writer(
    monkeypatch, tmp_path: Path,
) -> None:
    database = _setup(monkeypatch, tmp_path)
    expected = _material(2)
    writer = _connection(database)
    writer.execute("BEGIN IMMEDIATE")
    writer.execute(
        "UPDATE authored_trip_packs SET draft_revision=3 WHERE id=?", (PACK_ID,),
    )
    started = threading.Event()
    errors: list[Exception] = []

    def create_after_preflight() -> None:
        started.set()
        try:
            _strict_create(expected)
        except Exception as exc:  # asserted below
            errors.append(exc)

    thread = threading.Thread(target=create_after_preflight)
    thread.start()
    assert started.wait(timeout=5)
    writer.commit()
    writer.close()
    thread.join(timeout=15)

    assert not thread.is_alive()
    assert len(errors) == 1
    assert isinstance(errors[0], ValueError)
    assert "material changed" in str(errors[0])
    db = _connection(database)
    try:
        assert db.execute(
            "SELECT COUNT(*) FROM authored_original_validation_reports"
        ).fetchone()[0] == 0
    finally:
        db.close()


def test_strict_create_and_execution_use_only_complete_long_form_dispatch() -> None:
    material_names = set(store._original_validation_material.__code__.co_names)
    execution_names = set(store._execute_original_validation_selection.__code__.co_names)
    assert {
        "complete_trusted_original_route_network_validation_target",
        "complete_original_long_form_preflight_binding",
        "trusted_complete_originals_long_form_validator_source_sha256",
    } <= material_names
    assert {
        "complete_trusted_original_route_network_validation_target",
        "run_complete_originals_long_form_validation_cli",
        "normalize_complete_original_long_form_validation_output",
    } <= execution_names
    historical_only = {
        "trusted_original_route_network_validation_target",
        "original_long_form_preflight_binding",
        "run_originals_long_form_validation_cli",
        "normalize_original_long_form_validation_output",
    }
    assert material_names.isdisjoint(historical_only)
    assert execution_names.isdisjoint(historical_only)


@pytest.mark.parametrize("kind", ["partial", "missing", "duplicate", "extra"])
def test_complete_product_invalid_inventory_inserts_no_report_or_dispatches(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    kind: str,
) -> None:
    rows = _invalid_target_inventory(kind)
    database = _setup_target_inventory(monkeypatch, tmp_path, rows)
    calls = {"target": 0, "preflight": 0}

    def unexpected_target(*_args, **_kwargs):
        calls["target"] += 1
        raise AssertionError("route target dispatch must not run")

    def unexpected_preflight(*_args, **_kwargs):
        calls["preflight"] += 1
        raise AssertionError("preflight dispatch must not run")

    monkeypatch.setattr(
        store,
        "complete_trusted_original_route_network_validation_target",
        unexpected_target,
    )
    monkeypatch.setattr(
        store,
        "complete_original_long_form_preflight_binding",
        unexpected_preflight,
    )
    with pytest.raises(
        complete_validation.OriginalValidationRunnerError,
        match="exactly six|missing, extra, or duplicated",
    ):
        store.create_authored_original_virtual_validation_run(
            TARGET_PACK_ID,
            7,
            require_zero_active_reports=True,
            require_zero_pack_reports=True,
        )
    assert calls == {"target": 0, "preflight": 0}
    db = _connection(database)
    try:
        assert db.execute(
            "SELECT COUNT(*) FROM authored_original_validation_reports"
        ).fetchone()[0] == 0
    finally:
        db.close()


@pytest.mark.parametrize("kind", ["partial", "missing", "duplicate", "extra"])
def test_complete_product_invalid_persisted_inventory_is_not_claimed_or_executed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    kind: str,
) -> None:
    rows = _invalid_target_inventory(kind)
    database = _setup_target_inventory(monkeypatch, tmp_path, rows)
    report_id = f"invalid_inventory_{kind}"
    db = _connection(database)
    db.execute(
        """INSERT INTO authored_original_validation_reports
           (id,pack_id,draft_revision,manifest_sha256,assets_sha256,input_sha256,
            validator_source_sha256,manifest_json,suite_version,status,started_by,
            worker_pid,started_at)
           VALUES (?,?,?,?,?,?,?,?,?,'running',?,?,?)""",
        (
            report_id,
            TARGET_PACK_ID,
            2,
            "1" * 64,
            "2" * 64,
            "3" * 64,
            "4" * 64,
            json.dumps(_target_manifest(), separators=(",", ":"), sort_keys=True),
            store.ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION,
            7,
            os.getpid(),
            int(time.time()),
        ),
    )
    db.commit()
    db.close()
    calls = {"runner": 0, "long_form": 0, "network": 0}

    def unexpected(name: str):
        def invoke(*_args, **_kwargs):
            calls[name] += 1
            raise AssertionError(f"{name} must not run")
        return invoke

    with pytest.raises(
        complete_validation.OriginalValidationRunnerError,
        match="exactly six|missing, extra, or duplicated",
    ):
        store.execute_authored_original_virtual_validation_run(
            report_id,
            runner=unexpected("runner"),
            long_form_runner=unexpected("long_form"),
            route_network_validator=unexpected("network"),
        )
    assert calls == {"runner": 0, "long_form": 0, "network": 0}
    db = _connection(database)
    try:
        row = db.execute(
            "SELECT status, summary_json, scenarios_json, issues_json "
            "FROM authored_original_validation_reports WHERE id=?",
            (report_id,),
        ).fetchone()
        assert dict(row) == {
            "status": "running",
            "summary_json": "{}",
            "scenarios_json": "[]",
            "issues_json": "[]",
        }
    finally:
        db.close()
