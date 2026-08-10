import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from config.settings import settings
from db import store
import scripts.build_smokies_roaring_fork_private_packet as builder
import scripts.import_smokies_roaring_fork_private as importer


def _initialized_database(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    name: str,
) -> tuple[Path, dict]:
    database = tmp_path / f"{name}.db"
    monkeypatch.setattr(settings, "db_path", str(database))
    store.init_db()
    email = f"{name}@example.invalid"
    store.ensure_admin_user(email, f"{name}_admin", "not-a-login-credential")
    admin = store.get_user_by_email(email)
    assert admin and admin["is_admin"]
    return database, admin


def _packet_without_external_media() -> tuple[dict, dict]:
    _authorization, manifest, packet = builder.build_bundle(
        require_local_evidence=False
    )
    return packet, manifest


def test_report_path_cannot_overwrite_database_or_packet_evidence(tmp_path: Path) -> None:
    database = tmp_path / "target.db"
    database.write_bytes(b"sqlite")
    assets = tmp_path / "assets"
    assets.mkdir()
    with pytest.raises(importer.PrivateImportError, match="overwrite the database"):
        importer._assert_report_path_safe(
            database.resolve(),
            db_path=database.resolve(),
            asset_root=assets.resolve(),
            prepared=[],
        )
    with pytest.raises(importer.PrivateImportError, match="protected packet evidence"):
        importer._assert_report_path_safe(
            importer.PACKET_PATH.resolve(),
            db_path=database.resolve(),
            asset_root=assets.resolve(),
            prepared=[],
        )
    original_packet = importer.PACKET_PATH.read_bytes()
    with pytest.raises(importer.PrivateImportError, match="protected packet evidence"):
        importer._write_report(
            importer.PACKET_PATH,
            {
                "schema_version": 1,
                "packet_id": builder.PACKET_ID,
                "status": "dry_run_verified",
            },
        )
    assert importer.PACKET_PATH.read_bytes() == original_packet


def test_configured_apply_rejects_an_unbound_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "target.db"
    database.write_bytes(b"sqlite")
    assets = tmp_path / "assets"
    for name in (importer.DB_PATH_ENV, importer.ASSET_ROOT_ENV, importer.TARGET_ID_ENV):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(importer.PrivateImportError, match="explicitly configured"):
        importer._configured_target(
            database.resolve(),
            assets.resolve(),
            "private-target",
            allow_isolated=False,
        )


def test_apply_rechecks_protected_files(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    protected = tmp_path / "protected.json"
    protected.write_text("unchanged", encoding="utf-8")
    monkeypatch.setattr(importer, "PROTECTED_FILES", {protected: "0" * 64})
    with pytest.raises(importer.PrivateImportError, match="protected file drifted"):
        importer._verify_protected_files()


def test_database_apply_rejects_non_admin_and_different_existing_draft(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database, admin = _initialized_database(tmp_path, monkeypatch, "direct-apply")
    packet, manifest = _packet_without_external_media()
    clean = importer._clean_draft(packet, manifest)
    with pytest.raises(importer.PrivateImportError, match="real target admin"):
        importer._apply_database(database, clean, [], admin["id"] + 10_000)

    inserted_pack, inserted_assets, revision = importer._apply_database(
        database, clean, [], admin["id"]
    )
    assert inserted_pack is True
    assert inserted_assets == []
    assert revision == 1
    connection = importer._connect(database)
    try:
        connection.execute(
            "UPDATE authored_trip_packs SET draft_title='different' WHERE id=?",
            (builder.PACK_ID,),
        )
        connection.commit()
    finally:
        connection.close()
    with pytest.raises(importer.PrivateImportError, match="different draft"):
        importer._apply_database(database, clean, [], admin["id"])


def test_database_replay_preserves_complete_server_license_attestation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database, admin = _initialized_database(tmp_path, monkeypatch, "attested-replay")
    packet, manifest = _packet_without_external_media()
    clean = importer._clean_draft(packet, manifest)
    asset_bytes = b"test narration bytes"
    asset_sha256 = hashlib.sha256(asset_bytes).hexdigest()
    transcript_sha256 = hashlib.sha256(b"reviewed transcript").hexdigest()
    destination = tmp_path / "assets" / "test-narration.mp3"
    prepared = [
        importer.PreparedAsset(
            spec={
                "asset_id": "test_narration",
                "kind": "narration",
                "mime_type": "audio/mpeg",
                "bytes": len(asset_bytes),
                "sha256": asset_sha256,
                "transcript_sha256": transcript_sha256,
                "_destination": str(destination),
            },
            source_path=tmp_path / "source.mp3",
            media_metadata={"format": "mp3"},
        )
    ]

    inserted_pack, inserted_assets, revision = importer._apply_database(
        database, clean, prepared, admin["id"]
    )
    assert inserted_pack is True
    assert inserted_assets == [(builder.PACK_ID, "test_narration", asset_sha256)]
    assert revision == 1

    connection = importer._connect(database)
    try:
        row = connection.execute(
            "SELECT generator_metadata_json,updated_at FROM authored_original_assets "
            "WHERE pack_id=? AND asset_id=? AND sha256=?",
            (builder.PACK_ID, "test_narration", asset_sha256),
        ).fetchone()
        generator = json.loads(row["generator_metadata_json"])
        generator["license_status"] = "attested"
        generator["license_attestation"] = {
            "terms_id": "test_terms",
            "terms_url": "https://elevenlabs.io/terms-of-use",
            "terms_version": "test-v1",
            "reviewed_at": "2026-01-01",
            "attested_at": "2026-01-02T00:00:00Z",
            "attested_by_admin_user_id": int(admin["id"]),
        }
        attested_json = importer._canonical_json(generator)
        connection.execute(
            "UPDATE authored_original_assets SET generator_metadata_json=? "
            "WHERE pack_id=? AND asset_id=? AND sha256=?",
            (attested_json, builder.PACK_ID, "test_narration", asset_sha256),
        )
        connection.commit()
    finally:
        connection.close()

    replay_pack, replay_assets, replay_revision = importer._apply_database(
        database, clean, prepared, admin["id"]
    )
    assert replay_pack is False
    assert replay_assets == []
    assert replay_revision == 1
    connection = importer._connect(database)
    try:
        preserved = connection.execute(
            "SELECT generator_metadata_json FROM authored_original_assets "
            "WHERE pack_id=? AND asset_id=? AND sha256=?",
            (builder.PACK_ID, "test_narration", asset_sha256),
        ).fetchone()
        assert preserved["generator_metadata_json"] == attested_json
    finally:
        connection.close()


def test_import_lock_rejects_a_concurrent_process(tmp_path: Path) -> None:
    assets = tmp_path / "assets"
    assets.mkdir()
    lock_path = assets / importer.LOCK_FILE_NAME
    code = (
        "import fcntl,sys;"
        "f=open(sys.argv[1],'a+');"
        "fcntl.flock(f.fileno(),fcntl.LOCK_EX);"
        "print('locked',flush=True);"
        "sys.stdin.readline()"
    )
    holder = subprocess.Popen(
        [sys.executable, "-c", code, str(lock_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert holder.stdout is not None
        assert holder.stdout.readline().strip() == "locked"
        with pytest.raises(importer.PrivateImportError, match="another .* import"):
            with importer._exclusive_import_lock(assets):
                pytest.fail("concurrent lock unexpectedly acquired")
    finally:
        if holder.stdin is not None:
            holder.stdin.write("\n")
            holder.stdin.flush()
        holder.wait(timeout=10)


def test_recovery_journal_removes_only_unreferenced_created_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database, _admin = _initialized_database(tmp_path, monkeypatch, "recovery")
    assets = tmp_path / "assets"
    assets.mkdir()
    payload = b"interrupted exact bytes"
    digest = hashlib.sha256(payload).hexdigest()
    source = tmp_path / "source.png"
    source.write_bytes(payload)
    prepared = [importer.PreparedAsset(
        spec={
            "asset_id": "test_asset",
            "kind": "image",
            "sha256": digest,
            "bytes": len(payload),
        },
        source_path=source,
        media_metadata={},
    )]
    journal = importer._journal_document(
        db_path=database.resolve(),
        asset_root=assets.resolve(),
        target_id="recovery-test",
        prepared=prepared,
    )
    journal_path = assets / importer.JOURNAL_FILE_NAME
    importer._write_json_atomic(journal_path, journal)
    destination = Path(journal["destinations"][0]["path"])
    destination.parent.mkdir(parents=True)
    destination.write_bytes(payload)

    assert importer._recover_interrupted_import(
        journal_path=journal_path,
        db_path=database.resolve(),
        asset_root=assets.resolve(),
        target_id="recovery-test",
        prepared=prepared,
    ) is True
    assert not destination.exists()
    assert not journal_path.exists()


def test_rollback_failure_retains_recovery_journal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database, admin = _initialized_database(tmp_path, monkeypatch, "rollback-failure")
    assets = tmp_path / "assets"
    report = tmp_path / "report.json"
    packet, manifest = _packet_without_external_media()
    monkeypatch.setattr(importer, "_assert_exact_packet", lambda: (packet, manifest, []))
    monkeypatch.setattr(importer, "_verify_protected_files", lambda: {})
    monkeypatch.setattr(
        importer,
        "_verify_database",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("post-commit failure")),
    )
    monkeypatch.setattr(
        importer,
        "_restore_database",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("rollback failure")),
    )
    with pytest.raises(importer.PrivateImportError, match="rollback failed"):
        importer.apply_private(
            db_path=database,
            asset_root=assets,
            admin_user_id=admin["id"],
            target_id="isolated-rollback-failure",
            report_path=report,
            _allow_isolated_target=True,
        )
    journal_path = assets / importer.JOURNAL_FILE_NAME
    assert journal_path.is_file()
    assert json.loads(journal_path.read_text(encoding="utf-8"))["state"] == "rollback_failed"


def test_uninitialized_database_is_rejected_before_journal_or_staging(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "uninitialized.db"
    database.touch()
    assets = tmp_path / "assets"
    report = tmp_path / "report.json"
    packet, manifest = _packet_without_external_media()
    monkeypatch.setattr(importer, "_assert_exact_packet", lambda: (packet, manifest, []))
    with pytest.raises(importer.PrivateImportError, match="not an initialized"):
        importer.apply_private(
            db_path=database,
            asset_root=assets,
            admin_user_id=1,
            target_id="isolated-uninitialized",
            report_path=report,
            _allow_isolated_target=True,
        )
    assert not (assets / importer.JOURNAL_FILE_NAME).exists()
    assert not list(assets.glob(".roaring-fork-private-staging-*"))
    assert not report.exists()


def test_finalization_failure_rolls_back_before_success_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database, admin = _initialized_database(tmp_path, monkeypatch, "finalization-failure")
    assets = tmp_path / "assets"
    report = tmp_path / "report.json"
    packet, manifest = _packet_without_external_media()
    monkeypatch.setattr(importer, "_assert_exact_packet", lambda: (packet, manifest, []))
    monkeypatch.setattr(importer, "_verify_protected_files", lambda: {})
    monkeypatch.setattr(importer, "_verify_database", lambda *_args: {
        "draft_revision": 1,
        "current_asset_count": 0,
        "published_version_count": 0,
        "status": "draft",
    })
    real_fsync_directory = importer._fsync_directory
    asset_root_fsyncs = 0

    def fail_after_journal_unlink(path: Path) -> None:
        nonlocal asset_root_fsyncs
        if path.resolve() == assets.resolve():
            asset_root_fsyncs += 1
            if asset_root_fsyncs == 3:
                raise OSError("injected finalization failure")
        real_fsync_directory(path)

    monkeypatch.setattr(importer, "_fsync_directory", fail_after_journal_unlink)
    with pytest.raises(OSError, match="injected finalization failure"):
        importer.apply_private(
            db_path=database,
            asset_root=assets,
            admin_user_id=admin["id"],
            target_id="isolated-finalization-failure",
            report_path=report,
            _allow_isolated_target=True,
        )
    connection = importer._connect(database)
    try:
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM authored_trip_packs WHERE id=?",
            (builder.PACK_ID,),
        ).fetchone()["count"] == 0
    finally:
        connection.close()
    assert not report.exists()
    assert not (assets / importer.JOURNAL_FILE_NAME).exists()


def test_report_sync_uncertainty_keeps_matching_import_committed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database, admin = _initialized_database(tmp_path, monkeypatch, "report-sync")
    assets = tmp_path / "assets"
    report = tmp_path / "report.json"
    packet, manifest = _packet_without_external_media()
    monkeypatch.setattr(importer, "_assert_exact_packet", lambda: (packet, manifest, []))
    monkeypatch.setattr(importer, "_verify_protected_files", lambda: {})
    monkeypatch.setattr(importer, "_verify_database", lambda *_args: {
        "draft_revision": 1,
        "current_asset_count": 0,
        "published_version_count": 0,
        "status": "draft",
    })
    real_fsync_directory = importer._fsync_directory

    def fail_report_directory_sync(path: Path) -> None:
        if path.resolve() == report.parent.resolve() and report.exists():
            raise OSError("injected report directory sync failure")
        real_fsync_directory(path)

    monkeypatch.setattr(importer, "_fsync_directory", fail_report_directory_sync)
    with pytest.raises(importer.ReportCommitUncertainError, match="not compensated"):
        importer.apply_private(
            db_path=database,
            asset_root=assets,
            admin_user_id=admin["id"],
            target_id="isolated-report-sync",
            report_path=report,
            _allow_isolated_target=True,
        )
    connection = importer._connect(database)
    try:
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM authored_trip_packs WHERE id=?",
            (builder.PACK_ID,),
        ).fetchone()["count"] == 1
    finally:
        connection.close()
    assert json.loads(report.read_text(encoding="utf-8"))["status"] == (
        "verified_isolated_import"
    )
    assert not (assets / importer.JOURNAL_FILE_NAME).exists()


@pytest.mark.skipif(
    os.getenv("TRAILHEAD_RUN_PRIVATE_IMPORT_E2E") != "YES",
    reason="requires the external accepted audio and artwork evidence roots",
)
def test_exact_private_import_is_atomic_private_and_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "trailhead-isolated.db"
    assets = tmp_path / "assets"
    report = tmp_path / "private-import-report.json"

    monkeypatch.setattr(settings, "db_path", str(database))
    store.init_db()
    store.ensure_admin_user(
        "private-import-isolated@example.invalid",
        "private_import_isolated_admin",
        "not-a-login-credential",
    )
    admin = store.get_user_by_email("private-import-isolated@example.invalid")
    assert admin and admin["is_admin"]

    first = importer.apply_private(
        db_path=database,
        asset_root=assets,
        admin_user_id=admin["id"],
        target_id="isolated-test-target",
        report_path=report,
        _allow_isolated_target=True,
    )
    assert first["status"] == "verified_isolated_import"
    assert first["pack"] == {
        "id": builder.PACK_ID,
        "status": "draft",
        "draft_revision": 1,
    }
    assert first["assets"]["total"] == 20
    assert first["post_import"] == {
        "draft_revision": 1,
        "current_asset_count": 20,
        "published_version_count": 0,
        "status": "draft",
    }
    assert first["narration_license"]["status"] == "unverified"
    assert first["gates"]["isolated_import_verified"] is True
    assert first["gates"]["configured_private_byte_import_complete"] is False
    assert first["gates"]["admin_license_attestation_complete"] is False
    assert first["gates"]["verified_private_upload_complete"] is False
    assert first["gates"]["public_release"] is False
    assert json.loads(report.read_text(encoding="utf-8")) == first

    second = importer.apply_private(
        db_path=database,
        asset_root=assets,
        admin_user_id=admin["id"],
        target_id="isolated-test-target",
        report_path=report,
        _allow_isolated_target=True,
    )
    assert second["idempotency"]["pack_created_by_run"] is False
    assert second["idempotency"]["asset_rows_created_by_run"] == 0
    assert second["idempotency"]["content_files_created_by_run"] == 0
    assert second["idempotency"]["packet_sha256_keyed"] is True
    assert second["post_import"]["published_version_count"] == 0

    connection = importer._connect(database)
    try:
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM authored_original_assets WHERE pack_id=?",
            (builder.PACK_ID,),
        ).fetchone()["count"] == 20
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM authored_trip_pack_versions WHERE pack_id=?",
            (builder.PACK_ID,),
        ).fetchone()["count"] == 0
        generators = connection.execute(
            "SELECT generator_metadata_json FROM authored_original_assets "
            "WHERE pack_id=? AND kind='narration'",
            (builder.PACK_ID,),
        ).fetchall()
        assert len(generators) == 13
        for row in generators:
            generator = json.loads(row["generator_metadata_json"])
            assert generator["license_status"] == "unverified"
            assert "license_attestation" not in generator
    finally:
        connection.close()


@pytest.mark.skipif(
    os.getenv("TRAILHEAD_RUN_PRIVATE_IMPORT_E2E") != "YES",
    reason="requires the external accepted audio and artwork evidence roots",
)
def test_post_commit_report_failure_restores_database_and_created_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "trailhead-rollback.db"
    assets = tmp_path / "assets"
    report = tmp_path / "report.json"

    monkeypatch.setattr(settings, "db_path", str(database))
    store.init_db()
    store.ensure_admin_user(
        "private-import-rollback@example.invalid",
        "private_import_rollback_admin",
        "not-a-login-credential",
    )
    admin = store.get_user_by_email("private-import-rollback@example.invalid")
    assert admin and admin["is_admin"]

    def fail_report(_path: Path, _report: dict) -> None:
        raise OSError("injected report failure")

    monkeypatch.setattr(importer, "_write_report", fail_report)
    with pytest.raises(OSError, match="injected report failure"):
        importer.apply_private(
            db_path=database,
            asset_root=assets,
            admin_user_id=admin["id"],
            target_id="isolated-rollback-target",
            report_path=report,
            _allow_isolated_target=True,
        )

    connection = importer._connect(database)
    try:
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM authored_trip_packs WHERE id=?",
            (builder.PACK_ID,),
        ).fetchone()["count"] == 0
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM authored_original_assets WHERE pack_id=?",
            (builder.PACK_ID,),
        ).fetchone()["count"] == 0
    finally:
        connection.close()
    assert not report.exists()
    assert not list(assets.rglob("*.mp3"))
    assert not list(assets.rglob("*.png"))
    assert not (assets / importer.JOURNAL_FILE_NAME).exists()
