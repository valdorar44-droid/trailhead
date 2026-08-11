from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

from db import store


PACK_ID = "strict_original"


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
