import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

from config.settings import settings
from db import store
from scripts import backup_sqlite
import scripts.build_smokies_complete_private_migration as builder
import scripts.migrate_smokies_complete_private as operator


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_sha(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()


def _json(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _initialized_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str
) -> tuple[Path, dict]:
    database = tmp_path / f"{name}.db"
    monkeypatch.setattr(settings, "db_path", str(database))
    store.init_db()
    email = f"{name}@example.invalid"
    store.ensure_admin_user(email, f"{name}_admin", "not-a-login-credential")
    admin = store.get_user_by_email(email)
    assert admin and admin["is_admin"]
    return database, admin


def _synthetic_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str = "migration"
) -> dict:
    database, admin = _initialized_database(tmp_path, monkeypatch, name)
    asset_root = tmp_path / "assets"
    narration_root = tmp_path / "accepted-audio"
    artwork_root = tmp_path / "accepted-artwork"
    backup_root = tmp_path / "backups"
    for path in (asset_root, narration_root, artwork_root, backup_root):
        path.mkdir()
    monkeypatch.setenv(operator.DB_PATH_ENV, str(database.resolve()))
    monkeypatch.setenv(operator.ASSET_ROOT_ENV, str(asset_root.resolve()))
    monkeypatch.setenv(operator.TARGET_ID_ENV, "isolated-target")

    terms = copy.deepcopy(builder.TERMS_TUPLE)
    profile = {
        "schema_version": 2,
        "provider": "elevenlabs",
        "commercial_license": {**terms, "verified_at": "2026-08-10T20:19:19Z"},
    }
    preview = {"evidence_id": "synthetic_preview", "complete": True}
    predecessor_manifest = {
        "schema_version": 3,
        "title": "Synthetic RF",
        "narration_profile": profile,
    }
    predecessor_validation = {
        "admin_license_attestation_complete": True,
        "authenticated_device_preview_complete": True,
        "authenticated_device_preview_evidence": preview,
        "public_release": False,
        "trusted_publication_validation_complete": False,
        "verified_private_upload_complete": True,
    }
    target_manifest = {
        "schema_version": 3,
        "title": "Synthetic full pack",
        "assets": [],
    }
    target_validation = {
        "admin_license_attestation_complete": False,
        "artwork_derivatives_visually_approved": True,
        "audio_assets_reviewed": True,
        "authenticated_device_preview_complete": False,
        "dual_platform_private_preview_complete": False,
        "media_licenses_reviewed": True,
        "migration_packet_id": builder.PACKET_ID,
        "public_release": False,
        "transcripts_reviewed": True,
        "trusted_publication_validation_complete": False,
        "verified_private_upload_complete": False,
    }
    existing: list[dict] = []
    redacted: dict[str, str] = {}
    now = 1_786_400_000
    import_started_at = datetime.fromtimestamp(now, timezone.utc).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")
    import_completed_at = datetime.fromtimestamp(now + 4, timezone.utc).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")
    connection = sqlite3.connect(database)
    try:
        connection.execute(
            """INSERT INTO authored_trip_packs
               (id,content_kind,slug,status,draft_title,draft_summary,
                draft_price_credits,draft_coverage_region,draft_public_metadata,
                draft_validation_metadata,draft_template_json,
                draft_original_manifest_json,draft_revision,current_published_version,
                created_by,updated_by,created_at,updated_at)
               VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?,2,NULL,?,?,?,?)""",
            (
                builder.PRODUCT_ID,
                "original_drive",
                "synthetic-rf-private",
                "Synthetic RF",
                "Synthetic predecessor",
                0,
                "north_america",
                "{}",
                _json(predecessor_validation),
                _json({"title": "Synthetic RF"}),
                _json(predecessor_manifest),
                admin["id"],
                admin["id"],
                now,
                now,
            ),
        )
        for index in range(20):
            narration = index < 13
            asset_id = f"rf_audio_{index:02d}" if narration else f"rf_art_{index:02d}"
            data = f"existing-{index}".encode()
            sha256 = _sha(data)
            spec = {
                "asset_id": asset_id,
                "bytes": len(data),
                "kind": "narration" if narration else "image",
                "media": (
                    {
                        "format": "mp3",
                        "duration_s": 1.0,
                        "sample_rate_hz": 44100,
                        "bitrate_kbps": 128,
                        "channels": 1,
                    }
                    if narration
                    else {"format": "png", "width": 1, "height": 1}
                ),
                "mime_type": "audio/mpeg" if narration else "image/png",
                "public_path": (
                    f"/api/original-assets/{builder.PRODUCT_ID}/{asset_id}/{sha256}"
                ),
                "sha256": sha256,
                "transcript_sha256": _sha(f"transcript-{index}".encode()) if narration else None,
            }
            destination = operator._asset_destination(spec, asset_root.resolve())
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            generator = {}
            if narration:
                attestation = {
                    **terms,
                    "attested_at": f"2026-08-10T20:{index:02d}:00Z",
                    "attested_by_admin_user_id": int(admin["id"]),
                }
                generator = {
                    "provider": "elevenlabs",
                    "model_id": "eleven_multilingual_v2",
                    "voice_id": "EkK5I93UQWFDigLMpZcX",
                    "license_status": "attested",
                    "license_attestation": attestation,
                }
                redacted[asset_id] = store.original_redacted_license_attestation_sha256(
                    attestation
                )
                row_updated_at = int(
                    datetime.fromisoformat(
                        attestation["attested_at"][:-1] + "+00:00"
                    ).timestamp()
                )
            else:
                row_updated_at = now
            connection.execute(
                """INSERT INTO authored_original_assets
                   (pack_id,asset_id,sha256,kind,mime_type,byte_count,public_path,
                    storage_path,media_metadata_json,transcript_sha256,
                    generator_metadata_json,is_current,uploaded_by,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)""",
                (
                    builder.PRODUCT_ID,
                    asset_id,
                    sha256,
                    spec["kind"],
                    spec["mime_type"],
                    len(data),
                    spec["public_path"],
                    str(destination),
                    _json(spec["media"]),
                    spec["transcript_sha256"],
                    _json(generator),
                    admin["id"],
                    now,
                    row_updated_at,
                ),
            )
            existing.append(spec)
        report_id = "original_validation_synthetic_history"
        connection.execute(
            """INSERT INTO authored_original_validation_reports
               (id,pack_id,draft_revision,manifest_sha256,assets_sha256,input_sha256,
                validator_source_sha256,manifest_json,suite_version,engine_version,
                status,passed,summary_json,scenarios_json,issues_json,started_by,
                worker_pid,started_at,completed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                report_id,
                builder.PRODUCT_ID,
                2,
                _canonical_sha(predecessor_manifest),
                "1" * 64,
                "2" * 64,
                "3" * 64,
                _json(predecessor_manifest),
                "originals_virtual_route_v3",
                "original-trigger-v3",
                "passed",
                1,
                _json({"selection": "roaring_fork_one_way_private_v1:one_way"}),
                _json([{"passed": True, "index": index} for index in range(13)]),
                "[]",
                admin["id"],
                None,
                now + 1,
                now + 2,
            ),
        )
        connection.commit()
    finally:
        connection.close()

    new: list[dict] = []
    for index in range(78):
        narration = index < 72
        asset_id = f"new_audio_{index:02d}" if narration else f"new_art_{index:02d}"
        data = f"new-{index}".encode()
        sha256 = _sha(data)
        root = narration_root if narration else artwork_root
        relative = f"chapter/{index:02d}.mp3" if narration else f"{index:02d}.png"
        source = root / relative
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(data)
        spec = {
            "asset_id": asset_id,
            "bytes": len(data),
            "generator_metadata": (
                {
                    "provider": "elevenlabs",
                    "api_version": "elevenlabs_text_to_speech_v1",
                    "model_id": "eleven_multilingual_v2",
                    "voice_id": "EkK5I93UQWFDigLMpZcX",
                    "output_format": "mp3_44100_128",
                    "provider_native_master": True,
                    "lossless_master_claimed": False,
                    "transcoded": False,
                    "license_status": "unverified",
                }
                if narration
                else {}
            ),
            "kind": "narration" if narration else "image",
            "media": (
                {
                    "format": "mp3",
                    "duration_s": 1.0,
                    "sample_rate_hz": 44100,
                    "bitrate_kbps": 128,
                    "channels": 1,
                }
                if narration
                else {"format": "png", "width": 1, "height": 1}
            ),
            "mime_type": "audio/mpeg" if narration else "image/png",
            "public_path": (
                f"/api/original-assets/{builder.PRODUCT_ID}/{asset_id}/{sha256}"
            ),
            "sha256": sha256,
            "source_relative_path": relative,
            "source_root": (
                "accepted_remaining_narration_root"
                if narration
                else "accepted_remaining_artwork_root"
            ),
            "transcript_sha256": _sha(f"new-transcript-{index}".encode()) if narration else None,
        }
        new.append(spec)

    all_sha = {row["asset_id"]: row["sha256"] for row in [*existing, *new]}
    new_narration_sha = {
        row["asset_id"]: row["sha256"] for row in new if row["kind"] == "narration"
    }
    packet = {
        "schema_version": 1,
        "packet_id": builder.PACKET_ID,
        "product_id": builder.PRODUCT_ID,
        "source_revision": {"commit": "a" * 40, "tree": "b" * 40},
        "configured_target_binding": {
            "target_id": "isolated-target",
            "database_path_sha256": _sha(str(database.resolve()).encode()),
            "asset_root_path_sha256": _sha(str(asset_root.resolve()).encode()),
        },
        "predecessor": {
            "draft_revision": 2,
            "immutable_draft_fields": {
                "slug": "synthetic-rf-private",
                "draft_title": "Synthetic RF",
                "draft_summary": "Synthetic predecessor",
                "draft_price_credits": 0,
                "draft_coverage_region": "north_america",
                "draft_public_metadata": "{}",
                "draft_template_json": _json({"title": "Synthetic RF"}),
            },
            "profiled_manifest_canonical_sha256": _canonical_sha(predecessor_manifest),
            "narration_profile_canonical_sha256": _canonical_sha(profile),
            "validation_metadata_canonical_sha256": _canonical_sha(predecessor_validation),
            "device_preview_evidence_canonical_sha256": _canonical_sha(preview),
            "existing_asset_sha256": {
                row["asset_id"]: row["sha256"] for row in existing
            },
            "existing_narration_redacted_attestation_sha256": redacted,
            "historical_import_window": {
                "started_at": import_started_at,
                "completed_at": import_completed_at,
            },
            "permitted_validation_history": {
                "report_id": report_id,
                "redacted_report_sha256": "4" * 64,
                "status": "passed",
                "current": True,
                "engine": "original-trigger-v3",
                "selection": "roaring_fork_one_way_private_v1:one_way",
                "route_scenarios_required": 13,
                "route_scenarios_passed": 13,
                "issues": [],
                "publication_approval": False,
                "expected_report_count": 1,
                "expected_suite_version": "originals_virtual_route_v3",
                "expected_draft_revision": 2,
                "readback_observed_at": datetime.fromtimestamp(
                    now + 100, timezone.utc
                ).isoformat(timespec="seconds").replace("+00:00", "Z"),
            },
        },
        "migration_draft": {
            "content_kind": "original_drive",
            "slug": "synthetic-full-pack",
            "title": "Synthetic full pack",
            "summary": "Synthetic full bundle",
            "price_credits": 900,
            "coverage_region": "north_america",
            "public_metadata_json": _json(
                {
                    "access_policy": {
                        "schema_version": 1,
                        "explorer_included": True,
                        "permanent_credit_price": 900,
                    }
                }
            ),
            "validation_metadata": target_validation,
            "validation_metadata_json": _json(target_validation),
            "validation_metadata_canonical_sha256": _canonical_sha(target_validation),
            "template_json": _json({"title": "Synthetic full pack"}),
            "original_manifest": target_manifest,
            "original_manifest_json": _json(target_manifest),
            "original_manifest_canonical_sha256": _canonical_sha(target_manifest),
            "expected_before_revision": 2,
            "expected_after_revision": 3,
        },
        "assets": {
            "existing_roaring_fork": existing,
            "new": new,
            "all_asset_sha256": all_sha,
            "counts": {
                "existing": 20,
                "new": 78,
                "new_narration": 72,
                "new_images": 6,
                "committed_total": 98,
                "committed_narration": 85,
                "committed_images": 13,
            },
        },
        "post_migration_phases": {
            "license_attestation": {
                "store_api": "attest_authored_original_generator_license",
                "asset_count": 72,
                "asset_sha256": new_narration_sha,
                "terms_tuple": terms,
                "terms_policy_sha256": "c" * 64,
            },
            "narration_profile_cas": {
                "store_api": "apply_authored_original_narration_profile_v2",
                "expected_base_manifest_sha256": _canonical_sha(target_manifest),
            },
        },
        "gates": {
            "deterministic_migration_packet_built": True,
            "independent_operator_audit_passed": False,
            "same_volume_backup_verified": False,
            "configured_private_migration_complete": False,
            "new_72_license_attestations_complete": False,
            "pack_narration_profile_cas_complete": False,
            "verified_private_upload_complete": False,
            "dual_platform_private_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
    }
    backup_manifest = backup_sqlite.create_backup(database, backup_root)
    # The legacy backup helper verifies through a normal SQLite connection,
    # which leaves unbound empty WAL/SHM artifacts. A migration-approved backup
    # snapshot is explicitly closed and sidecar-free.
    for suffix in ("-wal", "-shm", "-journal"):
        Path(str(backup_manifest["backup"]) + suffix).unlink(missing_ok=True)
    backup_manifest_path = Path(backup_manifest["backup"]).with_suffix(".json")
    return {
        "database": database,
        "admin": admin,
        "asset_root": asset_root,
        "narration_root": narration_root,
        "artwork_root": artwork_root,
        "packet": packet,
        "contract": {"contract_id": builder.AUDIT_CONTRACT_ID},
        "packet_sha256": "d" * 64,
        "backup_manifest": backup_manifest,
        "backup_manifest_path": backup_manifest_path,
        "backup_manifest_sha256": operator._sha256_path(backup_manifest_path),
        "report": tmp_path / "migration-receipt.json",
        "audit": tmp_path / "audit.json",
    }


def _prepared_without_media_probe(
    packet: dict, narration_root: Path, artwork_root: Path
) -> list[operator.PreparedAsset]:
    roots = {
        "accepted_remaining_narration_root": narration_root,
        "accepted_remaining_artwork_root": artwork_root,
    }
    rows = []
    for spec in packet["assets"]["new"]:
        source = roots[spec["source_root"]] / spec["source_relative_path"]
        assert source.stat().st_size == spec["bytes"]
        assert operator._sha256_path(source) == spec["sha256"]
        rows.append(operator.PreparedAsset(copy.deepcopy(spec), source, spec["media"]))
    return rows


def _refresh_backup(environment: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = backup_sqlite.create_backup(environment["database"], output_dir)
    for suffix in ("-wal", "-shm", "-journal"):
        Path(str(manifest["backup"]) + suffix).unlink(missing_ok=True)
    manifest_path = Path(manifest["backup"]).with_suffix(".json")
    environment["backup_manifest"] = manifest
    environment["backup_manifest_path"] = manifest_path
    environment["backup_manifest_sha256"] = operator._sha256_path(manifest_path)


def _draft_revision(environment: dict) -> int:
    connection = sqlite3.connect(environment["database"])
    try:
        return int(
            connection.execute(
                "SELECT draft_revision FROM authored_trip_packs WHERE id=?",
                (builder.PRODUCT_ID,),
            ).fetchone()[0]
        )
    finally:
        connection.close()


def _apply_args(environment: dict) -> dict:
    packet = environment["packet"]
    return {
        "apply_confirmation": operator.APPLY_SENTINEL,
        "db_path": environment["database"],
        "asset_root": environment["asset_root"],
        "narration_root": environment["narration_root"],
        "artwork_root": environment["artwork_root"],
        "backup_manifest_path": environment["backup_manifest_path"],
        "expected_backup_manifest_sha256": environment["backup_manifest_sha256"],
        "operator_audit_path": environment["audit"],
        "admin_user_id": environment["admin"]["id"],
        "target_id": "isolated-target",
        "report_path": environment["report"],
        "expected_packet_sha256": environment["packet_sha256"],
        "expected_source_commit": packet["source_revision"]["commit"],
        "expected_source_tree": packet["source_revision"]["tree"],
        "expected_draft_revision": packet["predecessor"]["draft_revision"],
        "expected_current_manifest_sha256": packet["predecessor"][
            "profiled_manifest_canonical_sha256"
        ],
        "expected_current_profile_sha256": packet["predecessor"][
            "narration_profile_canonical_sha256"
        ],
        "expected_validation_metadata_sha256": packet["predecessor"][
            "validation_metadata_canonical_sha256"
        ],
        "expected_full_base_manifest_sha256": packet["migration_draft"][
            "original_manifest_canonical_sha256"
        ],
        "expected_terms_policy_sha256": packet["post_migration_phases"][
            "license_attestation"
        ]["terms_policy_sha256"],
    }


def _patch_synthetic_apply(
    monkeypatch: pytest.MonkeyPatch, environment: dict
) -> None:
    environment["audit"].write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(
        operator,
        "_load_exact_packet",
        lambda: (
            environment["packet"],
            environment["contract"],
            environment["packet_sha256"],
        ),
    )
    monkeypatch.setattr(
        operator,
        "_validate_operator_audit",
        lambda *_args, **_kwargs: {
            "artifact_sha256": "e" * 64,
            "artifact_byte_count": 1,
            "bindings_sha256": "f" * 64,
            "independent_audit_passed": True,
        },
    )
    monkeypatch.setattr(operator, "_prepare_external_assets", _prepared_without_media_probe)


def test_real_packet_is_deterministic_exact_and_fail_closed() -> None:
    packet, contract = builder.build_bundle()
    assert packet["source_revision"] == builder.MIGRATION_BASE_SOURCE_REVISION
    assert packet["source_revision"] == {
        "commit": "a4ef35366eaecdb762e316036a54e47436c71b1a",
        "tree": "9d45a61f6dad1266497cb6564a7334a4255da6b5",
    }
    assert packet["private_candidate_commit_revision"] == (
        builder.PRIVATE_CANDIDATE_COMMIT_REVISION
    )
    assert packet["candidate_source_revision"] == builder.EXPECTED_CANDIDATE_SOURCE_REVISION
    assert packet["assets"]["counts"] == {
        "existing": 20,
        "new": 78,
        "new_narration": 72,
        "new_images": 6,
        "committed_total": 98,
        "committed_narration": 85,
        "committed_images": 13,
    }
    assert len(packet["assets"]["all_asset_sha256"]) == 98
    assert len(packet["post_migration_phases"]["license_attestation"]["asset_sha256"]) == 72
    assert packet["migration_draft"]["original_manifest"].get("narration_profile") is None
    assert packet["migration_draft"]["price_credits"] == 900
    assert packet["migration_draft"]["public_metadata"]["access_policy"] == {
        "schema_version": 1,
        "explorer_included": True,
        "permanent_credit_price": 900,
    }
    assert packet["final_profiled_candidate"]["not_yet_valid_after_new_attestations"] is True
    assert packet["post_migration_phases"]["narration_profile_cas"][
        "redacted_license_attestation_sha256_pending_server_attestations"
    ] is True
    assert packet["effects"] == {
        "database_accessed": False,
        "database_mutated": False,
        "external_media_accessed": False,
        "external_media_mutated": False,
        "network_accessed": False,
        "provider_accessed": False,
        "provider_rerendered": False,
        "upload_performed": False,
        "deployment_performed": False,
        "trusted_validation_performed": False,
        "publication_performed": False,
    }
    assert all(value is False for key, value in packet["gates"].items() if key != "deterministic_migration_packet_built")
    assert contract["audit_state"]["live_apply_allowed"] is False


def test_real_packet_asset_bindings_match_manifest_and_acceptance() -> None:
    packet, _contract = builder.build_bundle()
    manifest = json.loads((builder.ROOT / builder.MANIFEST_PATH).read_text())
    manifest_sha = {row["id"]: row["sha256"] for row in manifest["assets"]}
    assert packet["assets"]["all_asset_sha256"] == manifest_sha
    assert len(packet["predecessor"]["existing_narration_redacted_attestation_sha256"]) == 13
    assert all(
        row["source_relative_path"] and not Path(row["source_relative_path"]).is_absolute()
        for row in packet["assets"]["new"]
    )
    assert all(root["serialized_path"] is None for root in packet["assets"]["source_roots"].values())


def test_builder_fails_on_transitive_source_drift(monkeypatch: pytest.MonkeyPatch) -> None:
    broken = dict(builder.EXPECTED_SOURCE_SHA256)
    broken[str(builder.CANDIDATE_PATH)] = "0" * 64
    monkeypatch.setattr(builder, "EXPECTED_SOURCE_SHA256", broken)
    with pytest.raises(builder.MigrationPacketBuildError, match="source drifted"):
        builder.build_bundle()


def test_default_cli_is_read_only_and_rejects_live_shaped_arguments(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        operator,
        "dry_run",
        lambda: {"status": "dry_run_verified_live_apply_locked", "writes_performed": False},
    )
    assert operator.main([]) == 0
    assert json.loads(capsys.readouterr().out)["writes_performed"] is False
    with pytest.raises(SystemExit):
        operator.main(["--db-path", "/tmp/forbidden.db"])


def test_explicit_identity_and_terms_drift_fail_before_mutation() -> None:
    packet, _contract = builder.build_bundle()
    with pytest.raises(operator.FullBundleMigrationError, match="terms"):
        operator._assert_expected_identities(
            packet,
            packet_sha256="1" * 64,
            expected_packet_sha256="1" * 64,
            expected_source_commit=packet["source_revision"]["commit"],
            expected_source_tree=packet["source_revision"]["tree"],
            expected_draft_revision=packet["predecessor"]["draft_revision"],
            expected_current_manifest_sha256=packet["predecessor"]["profiled_manifest_canonical_sha256"],
            expected_current_profile_sha256=packet["predecessor"]["narration_profile_canonical_sha256"],
            expected_validation_metadata_sha256=packet["predecessor"]["validation_metadata_canonical_sha256"],
            expected_full_base_manifest_sha256=packet["migration_draft"]["original_manifest_canonical_sha256"],
            expected_terms_policy_sha256="0" * 64,
        )


def test_callable_apply_requires_the_same_exact_confirmation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "callable-confirmation")
    args = _apply_args(env)
    args["apply_confirmation"] = "continue"
    with pytest.raises(operator.FullBundleMigrationError, match="confirmation"):
        operator.apply_private(**args)
    assert not env["report"].exists()
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()


def test_path_safety_rejects_symlink_wal_and_overlapping_roots(tmp_path: Path) -> None:
    database = tmp_path / "db.sqlite"
    database.write_bytes(b"db")
    wal_target = tmp_path / "wal-target"
    wal_target.write_bytes(b"wal")
    Path(str(database) + "-wal").symlink_to(wal_target)
    with pytest.raises(operator.FullBundleMigrationError, match="sidecar"):
        operator._assert_wal_sidecars_safe(database.resolve())
    root = tmp_path / "root"
    child = root / "child"
    child.mkdir(parents=True)
    with pytest.raises(operator.FullBundleMigrationError, match="overlap"):
        operator._assert_disjoint_paths({"root": root.resolve(), "child": child.resolve()})


def test_database_connection_never_changes_journal_mode(tmp_path: Path) -> None:
    database = tmp_path / "delete-mode.sqlite3"
    connection = sqlite3.connect(database)
    try:
        connection.execute("CREATE TABLE proof (id INTEGER PRIMARY KEY)")
        connection.commit()
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    finally:
        connection.close()
    before = operator._sha256_path(database)
    with pytest.raises(operator.FullBundleMigrationError, match="already use WAL"):
        operator._connect(database)
    assert operator._sha256_path(database) == before
    verify = sqlite3.connect(database)
    try:
        assert verify.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    finally:
        verify.close()


def test_external_media_ancestor_symlink_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "source-symlink")
    chapter = env["narration_root"] / "chapter"
    real_chapter = env["narration_root"] / "chapter-real"
    chapter.rename(real_chapter)
    chapter.symlink_to(real_chapter, target_is_directory=True)
    with pytest.raises(operator.FullBundleMigrationError, match="real directories"):
        operator._prepare_external_assets(
            env["packet"], env["narration_root"], env["artwork_root"]
        )


def test_backup_is_hash_age_integrity_schema_and_volume_bound(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "backup")
    manifest, backup = operator._validate_backup(
        env["backup_manifest_path"],
        expected_manifest_sha256=env["backup_manifest_sha256"],
        db_path=env["database"].resolve(),
        asset_root=env["asset_root"].resolve(),
        now=env["backup_manifest"]["created_at"],
    )
    assert manifest["integrity_check"] == "ok"
    assert backup.is_file()
    with pytest.raises(operator.FullBundleMigrationError, match="sha256"):
        operator._validate_backup(
            env["backup_manifest_path"],
            expected_manifest_sha256="0" * 64,
            db_path=env["database"].resolve(),
            asset_root=env["asset_root"].resolve(),
            now=env["backup_manifest"]["created_at"],
        )
    with pytest.raises(operator.FullBundleMigrationError, match="stale"):
        operator._validate_backup(
            env["backup_manifest_path"],
            expected_manifest_sha256=env["backup_manifest_sha256"],
            db_path=env["database"].resolve(),
            asset_root=env["asset_root"].resolve(),
            now=env["backup_manifest"]["created_at"] + 901,
        )


def test_exact_synthetic_migration_is_atomic_private_and_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "atomic")
    _patch_synthetic_apply(monkeypatch, env)
    first = operator.apply_private(**_apply_args(env))
    assert first["status"] == "verified_configured_private_migration"
    assert all(
        key not in first["migration"]
        for key in (
            "result",
            "recovery",
            "asset_rows_inserted_by_run",
            "content_files_created_by_run",
        )
    )
    assert len(first["migration"]["predecessor_history_sha256"]) == 64
    assert first["migration"]["committed_asset_count"] == 98
    assert first["migration"]["profile_present"] is False
    assert first["prepared_not_executed"]["license_attestation"]["executed"] is False
    assert first["prepared_not_executed"]["narration_profile_cas"]["executed"] is False
    assert first["effects"]["provider_rerendered"] is False
    assert first["gates"]["public_release"] is False
    assert str(tmp_path.resolve()) not in json.dumps(first, sort_keys=True)
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()

    connection = operator._connect(env["database"])
    try:
        pack = connection.execute(
            "SELECT * FROM authored_trip_packs WHERE id=?", (builder.PRODUCT_ID,)
        ).fetchone()
        assert pack["draft_revision"] == 3
        assert pack["draft_price_credits"] == 900
        assert json.loads(pack["draft_original_manifest_json"]).get("narration_profile") is None
        validation = json.loads(pack["draft_validation_metadata"])
        assert all(
            validation[key] is False
            for key in (
                "admin_license_attestation_complete",
                "authenticated_device_preview_complete",
                "dual_platform_private_preview_complete",
                "trusted_publication_validation_complete",
                "verified_private_upload_complete",
                "public_release",
            )
        )
        assert connection.execute(
            "SELECT COUNT(*) FROM authored_original_assets WHERE pack_id=?",
            (builder.PRODUCT_ID,),
        ).fetchone()[0] == 98
        assert connection.execute(
            "SELECT COUNT(*) FROM authored_trip_pack_versions WHERE pack_id=?",
            (builder.PRODUCT_ID,),
        ).fetchone()[0] == 0
    finally:
        connection.close()

    second = operator.apply_private(**_apply_args(env))
    assert second == first


def test_failed_database_phase_leaves_recoverable_journal_then_replays(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "recovery")
    _patch_synthetic_apply(monkeypatch, env)
    real_apply = operator._apply_database_locked
    monkeypatch.setattr(
        operator,
        "_apply_database_locked",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("injected DB failure")),
    )
    with pytest.raises(RuntimeError, match="injected DB failure"):
        operator.apply_private(**_apply_args(env))
    journal = env["asset_root"] / operator.JOURNAL_FILE_NAME
    assert journal.is_file()
    assert len(list(env["asset_root"].rglob("new-*"))) == 0  # names are hash-addressed
    assert len(list((env["asset_root"] / builder.PRODUCT_ID).glob("new_*/*"))) == 78

    # A second interrupted attempt must rebuild presence flags after rolling
    # back the first attempt. Otherwise the next rollback would misclassify
    # newly promoted files as preexisting and leak them.
    with pytest.raises(RuntimeError, match="injected DB failure"):
        operator.apply_private(**_apply_args(env))
    second_journal = json.loads(journal.read_text(encoding="utf-8"))
    assert all(row["existed_before"] is False for row in second_journal["destinations"])

    monkeypatch.setattr(operator, "_apply_database_locked", real_apply)
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["committed_asset_count"] == 98
    assert not journal.exists()


def test_create_only_promotion_rejects_corrupt_existing_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "create-only")
    spec = env["packet"]["assets"]["new"][0]
    destination = operator._asset_destination(spec, env["asset_root"].resolve())
    target = operator._configured_target(
        db_path=env["database"].resolve(),
        asset_root=env["asset_root"].resolve(),
        target_id="isolated-target",
        packet=env["packet"],
    )
    journal = operator._journal_document(
        env["packet"],
        env["packet_sha256"],
        target=target,
        db_path=env["database"].resolve(),
        asset_root=env["asset_root"].resolve(),
        narration_root=env["narration_root"].resolve(),
        artwork_root=env["artwork_root"].resolve(),
        backup_manifest_sha256=env["backup_manifest_sha256"],
        audit_sha256="e" * 64,
        predecessor_history_sha256=operator._predecessor_history_sha256(
            operator._backup_snapshot(Path(env["backup_manifest"]["backup"])),
            env["packet"],
        ),
    )
    journal_path = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    operator._write_json_atomic(journal_path, journal, create_only=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(b"corrupt")
    prepared = _prepared_without_media_probe(
        env["packet"], env["narration_root"], env["artwork_root"]
    )
    with pytest.raises(operator.FullBundleMigrationError, match="raced after journal"):
        operator._stage_and_promote(
            prepared,
            env["asset_root"].resolve(),
            journal["destinations"],
            journal_path=journal_path,
            journal_document=journal,
        )
    assert destination.read_bytes() == b"corrupt"


def test_backup_snapshot_and_live_revision_race_fail_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "race")
    _patch_synthetic_apply(monkeypatch, env)
    connection = sqlite3.connect(env["database"])
    try:
        connection.execute(
            "UPDATE authored_trip_packs SET draft_revision=9 WHERE id=?",
            (builder.PRODUCT_ID,),
        )
        connection.commit()
    finally:
        connection.close()
    with pytest.raises(operator.FullBundleMigrationError, match="neither predecessor"):
        operator.apply_private(**_apply_args(env))
    assert not env["report"].exists()


def test_predecessor_scalar_draft_identity_is_exact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "predecessor-fields")
    connection = operator._connect(env["database"])
    try:
        connection.execute(
            "UPDATE authored_trip_packs SET draft_title=? WHERE id=?",
            ("Wrong predecessor", builder.PRODUCT_ID),
        )
        connection.commit()
        with pytest.raises(operator.FullBundleMigrationError, match="draft fields drifted"):
            operator._assert_predecessor_state(
                connection, env["packet"], env["asset_root"].resolve()
            )
    finally:
        connection.close()


def test_database_root_overlap_and_symlink_lock_fail_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "path-safety")
    _patch_synthetic_apply(monkeypatch, env)
    args = _apply_args(env)
    args["asset_root"] = env["database"].parent
    monkeypatch.setenv(operator.ASSET_ROOT_ENV, str(env["database"].parent.resolve()))
    with pytest.raises(operator.FullBundleMigrationError, match="must not overlap"):
        operator.apply_private(**args)

    monkeypatch.setenv(operator.ASSET_ROOT_ENV, str(env["asset_root"].resolve()))
    lock_path = env["asset_root"] / operator.LOCK_FILE_NAME
    lock_path.symlink_to(env["database"])
    with pytest.raises(operator.FullBundleMigrationError, match="lock path is unsafe"):
        operator.apply_private(**_apply_args(env))


def test_backup_is_rechecked_at_database_action_time(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "action-time-backup")
    _patch_synthetic_apply(monkeypatch, env)
    created_at = int(env["backup_manifest"]["created_at"])
    real_time = operator.time.time
    observations = iter((created_at, created_at, created_at + 901))
    monkeypatch.setattr(operator.time, "time", lambda: next(observations))
    with pytest.raises(operator.FullBundleMigrationError, match="stale"):
        operator.apply_private(**_apply_args(env))
    assert not env["report"].exists()
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()
    assert len(list((env["asset_root"] / builder.PRODUCT_ID).glob("new_*/*"))) == 0
    monkeypatch.setattr(operator.time, "time", real_time)
    _refresh_backup(env, tmp_path / "fresh-backup")
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["committed_asset_count"] == 98


def test_backup_expiry_while_waiting_for_begin_rolls_back_before_db_mutation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "post-begin-freshness")
    _patch_synthetic_apply(monkeypatch, env)
    created_at = int(env["backup_manifest"]["created_at"])
    clock = {"now": created_at + 899}
    began = {"value": False}
    real_connect = operator._connect

    class DelayedBeginConnection:
        def __init__(self, inner):
            self._inner = inner

        def execute(self, sql, *args, **kwargs):
            result = self._inner.execute(sql, *args, **kwargs)
            if sql.strip().upper() == "BEGIN IMMEDIATE" and not began["value"]:
                began["value"] = True
                clock["now"] = created_at + 901
            return result

        def __getattr__(self, name):
            return getattr(self._inner, name)

    monkeypatch.setattr(operator.time, "time", lambda: clock["now"])
    def delayed_connect(path, *args, **kwargs):
        connection = real_connect(path, *args, **kwargs)
        return (
            connection
            if kwargs.get("readonly") is True
            else DelayedBeginConnection(connection)
        )

    monkeypatch.setattr(operator, "_connect", delayed_connect)
    with pytest.raises(operator.FullBundleMigrationError, match="stale"):
        operator.apply_private(**_apply_args(env))
    assert began["value"] is True
    assert _draft_revision(env) == 2
    connection = sqlite3.connect(env["database"])
    try:
        assert connection.execute(
            "SELECT COUNT(*) FROM authored_original_assets WHERE pack_id=?",
            (builder.PRODUCT_ID,),
        ).fetchone()[0] == 20
    finally:
        connection.close()
    assert not env["report"].exists()
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()
    assert not (env["asset_root"] / operator.STAGING_DIR_NAME).exists()
    assert len(list((env["asset_root"] / builder.PRODUCT_ID).glob("new_*/*"))) == 0


def test_existing_receipt_is_fully_immutable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "receipt-integrity")
    _patch_synthetic_apply(monkeypatch, env)
    operator.apply_private(**_apply_args(env))
    receipt = json.loads(env["report"].read_text(encoding="utf-8"))
    receipt["effects"]["publication_performed"] = True
    env["report"].write_text(json.dumps(receipt, sort_keys=True) + "\n", encoding="utf-8")
    with pytest.raises(operator.FullBundleMigrationError, match="bindings drifted"):
        operator.apply_private(**_apply_args(env))


def test_preexisting_receipt_blocks_before_files_or_database_change(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "receipt-preflight")
    _patch_synthetic_apply(monkeypatch, env)
    env["report"].write_text("{}\n", encoding="utf-8")
    with pytest.raises(operator.FullBundleMigrationError, match="cannot authorize"):
        operator.apply_private(**_apply_args(env))
    connection = operator._connect(env["database"])
    try:
        revision = connection.execute(
            "SELECT draft_revision FROM authored_trip_packs WHERE id=?",
            (builder.PRODUCT_ID,),
        ).fetchone()[0]
    finally:
        connection.close()
    assert revision == 2
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()
    assert len(list((env["asset_root"] / builder.PRODUCT_ID).glob("new_*/*"))) == 0


@pytest.mark.parametrize("inside_root", [False, True])
def test_destination_ancestor_symlinks_fail_before_mutation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    inside_root: bool,
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"ancestor-{inside_root}")
    _patch_synthetic_apply(monkeypatch, env)
    spec = env["packet"]["assets"]["new"][0]
    destination = operator._asset_destination(spec, env["asset_root"].resolve())
    destination.parent.parent.mkdir(parents=True, exist_ok=True)
    target = (
        env["asset_root"] / "unrelated"
        if inside_root
        else tmp_path / "outside-destination"
    )
    target.mkdir()
    destination.parent.symlink_to(target, target_is_directory=True)
    with pytest.raises(operator.FullBundleMigrationError, match="ancestors"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()
    assert list(target.iterdir()) == []


def test_destination_retarget_race_uses_anchored_dirfd_and_creates_no_asset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "retarget")
    _patch_synthetic_apply(monkeypatch, env)
    outside = tmp_path / "retarget-outside"
    outside.mkdir()
    real_link = operator.os.link
    retargeted: list[Path] = []

    def racing_link(source, destination, *args, **kwargs):
        if not retargeted and str(destination).endswith(".mp3"):
            spec = env["packet"]["assets"]["new"][0]
            lexical = operator._asset_destination(
                spec, env["asset_root"].resolve()
            ).parent
            moved = lexical.with_name(lexical.name + "-moved")
            lexical.rename(moved)
            lexical.symlink_to(outside, target_is_directory=True)
            retargeted.append(moved)
        return real_link(source, destination, *args, **kwargs)

    monkeypatch.setattr(operator.os, "link", racing_link)
    with pytest.raises(operator.FullBundleMigrationError, match="retargeted"):
        operator.apply_private(**_apply_args(env))
    assert retargeted and list(retargeted[0].iterdir()) == []
    assert list(outside.iterdir()) == []
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()


def test_postlink_foreign_replacement_survives_cleanup_and_blocks_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "postlink-replacement")
    _patch_synthetic_apply(monkeypatch, env)
    spec = env["packet"]["assets"]["new"][0]
    destination = operator._asset_destination(spec, env["asset_root"].resolve())
    foreign = b"foreign-postlink-replacement"
    real_stat = operator.os.stat
    raced = {"value": False}

    def racing_stat(path, *args, **kwargs):
        if (
            not raced["value"]
            and path == destination.name
            and kwargs.get("dir_fd") is not None
            and kwargs.get("follow_symlinks") is False
        ):
            raced["value"] = True
            parent_fd = kwargs["dir_fd"]
            os.unlink(destination.name, dir_fd=parent_fd)
            descriptor = os.open(
                destination.name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
                dir_fd=parent_fd,
            )
            try:
                os.write(descriptor, foreign)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return real_stat(path, *args, **kwargs)

    monkeypatch.setattr(operator.os, "stat", racing_stat)
    with pytest.raises(operator.FullBundleMigrationError, match="preserved|retargeted"):
        operator.apply_private(**_apply_args(env))
    assert raced["value"] is True
    assert destination.read_bytes() == foreign
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    journal_path = env["asset_root"] / operator.JOURNAL_FILE_NAME
    journal = json.loads(journal_path.read_text(encoding="utf-8"))
    entry = next(
        row for row in journal["destinations"] if row["asset_id"] == spec["asset_id"]
    )
    assert entry["ownership_state"] == "external_collision"


def test_postcommit_foreign_journal_replacement_is_preserved(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "journal-retire-race")
    _patch_synthetic_apply(monkeypatch, env)
    journal_path = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    foreign = b'{"external":"foreign-journal"}\n'
    real_retire = operator._retire_json_document
    raced = {"value": False}

    def race_retirement(path: Path, value: dict, *, label: str) -> None:
        if path == journal_path and not raced["value"]:
            raced["value"] = True
            path.unlink()
            path.write_bytes(foreign)
        real_retire(path, value, label=label)

    monkeypatch.setattr(operator, "_retire_json_document", race_retirement)
    with pytest.raises(operator.FullBundleMigrationError, match="content drifted"):
        operator.apply_private(**_apply_args(env))
    assert raced["value"] is True
    assert journal_path.read_bytes() == foreign
    assert _draft_revision(env) == 3
    assert env["report"].is_file()


@pytest.mark.parametrize("name", [operator.JOURNAL_FILE_NAME, "receipt.json"])
def test_atomic_create_only_output_race_never_overwrites(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    output = (tmp_path / name).resolve()
    raced_payload = b'{"external":"wins"}\n'
    real_link = operator.os.link

    def racing_link(source, destination, *args, **kwargs):
        if str(destination) == output.name:
            descriptor = os.open(
                output.name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
                dir_fd=kwargs["dst_dir_fd"],
            )
            try:
                os.write(descriptor, raced_payload)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return real_link(source, destination, *args, **kwargs)

    monkeypatch.setattr(operator.os, "link", racing_link)
    with pytest.raises(operator.FullBundleMigrationError, match="raced"):
        operator._write_json_atomic(output, {"operator": True}, create_only=True)
    assert output.read_bytes() == raced_payload


def test_atomic_output_detects_parent_retarget_after_link(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    parent = tmp_path / "output-parent"
    parent.mkdir()
    moved = tmp_path / "output-parent-moved"
    output = (parent / "receipt.json").resolve()
    real_link = operator.os.link
    retargeted = {"value": False}

    def retarget_after_link(source, destination, *args, **kwargs):
        result = real_link(source, destination, *args, **kwargs)
        if destination == output.name and not retargeted["value"]:
            retargeted["value"] = True
            parent.rename(moved)
            parent.mkdir()
        return result

    monkeypatch.setattr(operator.os, "link", retarget_after_link)
    with pytest.raises(operator.ReportCommitUncertainError, match="parent retargeted"):
        operator._write_json_atomic(output, {"operator": True}, create_only=True)
    assert retargeted["value"] is True
    assert not output.exists()
    assert (moved / output.name).is_file()


def test_journal_retirement_detects_parent_retarget_after_unlink(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    parent = tmp_path / "retire-parent"
    parent.mkdir()
    moved = tmp_path / "retire-parent-moved"
    journal = (parent / operator.JOURNAL_FILE_NAME).resolve()
    document = {"state": "database_committed"}
    operator._write_json_atomic(journal, document, create_only=True)
    foreign = b'{"external":"replacement-parent"}\n'
    real_unlink = operator.os.unlink
    retargeted = {"value": False}

    def retarget_after_unlink(path, *args, **kwargs):
        result = real_unlink(path, *args, **kwargs)
        if path == journal.name and not retargeted["value"]:
            retargeted["value"] = True
            parent.rename(moved)
            parent.mkdir()
            (parent / journal.name).write_bytes(foreign)
        return result

    monkeypatch.setattr(operator.os, "unlink", retarget_after_unlink)
    with pytest.raises(operator.ReportCommitUncertainError, match="parent retargeted"):
        operator._retire_json_document(
            journal, document, label="migration journal"
        )
    assert retargeted["value"] is True
    assert journal.read_bytes() == foreign
    assert not (moved / journal.name).exists()


def test_journal_create_race_blocks_before_copy_or_database_change(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "journal-create-race")
    _patch_synthetic_apply(monkeypatch, env)
    journal_path = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    raced_payload = b'{"external":"journal-race"}\n'
    real_write = operator._write_json_atomic

    def race_journal(
        path: Path,
        value: dict,
        *,
        create_only: bool,
        expected_prior: dict | None = None,
    ) -> None:
        if path == journal_path and create_only:
            path.write_bytes(raced_payload)
        real_write(
            path,
            value,
            create_only=create_only,
            expected_prior=expected_prior,
        )

    monkeypatch.setattr(operator, "_write_json_atomic", race_journal)
    with pytest.raises(operator.FullBundleMigrationError, match="replace|raced"):
        operator.apply_private(**_apply_args(env))
    assert journal_path.read_bytes() == raced_payload
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    assert len(list((env["asset_root"] / builder.PRODUCT_ID).glob("new_*/*"))) == 0


def test_dangling_report_symlink_is_rejected_lexically(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "report-symlink")
    _patch_synthetic_apply(monkeypatch, env)
    env["report"].symlink_to(tmp_path / "missing-report-target")
    with pytest.raises(operator.FullBundleMigrationError, match="receipt is unsafe"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 2
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()


def test_midpromotion_foreign_journal_replacement_is_cas_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "journal-update-race")
    _patch_synthetic_apply(monkeypatch, env)
    journal_path = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    foreign = b'{"external":"mid-promotion-journal"}\n'
    real_write = operator._write_json_atomic
    raced = {"value": False}

    def race_update(
        path: Path,
        value: dict,
        *,
        create_only: bool,
        expected_prior: dict | None = None,
    ) -> None:
        if path == journal_path and not create_only and not raced["value"]:
            raced["value"] = True
            path.write_bytes(foreign)
        real_write(
            path,
            value,
            create_only=create_only,
            expected_prior=expected_prior,
        )

    monkeypatch.setattr(operator, "_write_json_atomic", race_update)
    with pytest.raises(operator.FullBundleMigrationError, match="prior|content drifted"):
        operator.apply_private(**_apply_args(env))
    assert raced["value"] is True
    assert journal_path.read_bytes() == foreign
    assert _draft_revision(env) == 2
    assert not env["report"].exists()


@pytest.mark.parametrize("exact", [True, False])
def test_raced_destination_is_never_misclassified_as_operator_owned(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, exact: bool
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"ownership-{exact}")
    spec = env["packet"]["assets"]["new"][0]
    prepared = _prepared_without_media_probe(
        env["packet"], env["narration_root"], env["artwork_root"]
    )
    backup_snapshot = operator._backup_snapshot(
        Path(env["backup_manifest"]["backup"])
    )
    target = operator._configured_target(
        db_path=env["database"].resolve(),
        asset_root=env["asset_root"].resolve(),
        target_id="isolated-target",
        packet=env["packet"],
    )
    journal = operator._journal_document(
        env["packet"],
        env["packet_sha256"],
        target=target,
        db_path=env["database"].resolve(),
        asset_root=env["asset_root"].resolve(),
        narration_root=env["narration_root"].resolve(),
        artwork_root=env["artwork_root"].resolve(),
        backup_manifest_sha256=env["backup_manifest_sha256"],
        audit_sha256="e" * 64,
        predecessor_history_sha256=operator._predecessor_history_sha256(
            backup_snapshot, env["packet"]
        ),
    )
    journal_path = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    operator._write_json_atomic(journal_path, journal, create_only=True)
    destination = operator._asset_destination(spec, env["asset_root"].resolve())
    destination.parent.mkdir(parents=True, exist_ok=True)
    raced_bytes = (
        (env["narration_root"] / spec["source_relative_path"]).read_bytes()
        if exact
        else b"external-corrupt-race"
    )
    destination.write_bytes(raced_bytes)
    with pytest.raises(operator.FullBundleMigrationError, match="raced after journal"):
        operator._stage_and_promote(
            prepared,
            env["asset_root"].resolve(),
            journal["destinations"],
            journal_path=journal_path,
            journal_document=journal,
        )
    connection = operator._connect(env["database"])
    try:
        connection.execute("BEGIN IMMEDIATE")
        if exact:
            operator._remove_unreferenced_created(
                connection,
                journal["destinations"],
                env["asset_root"].resolve(),
                env["packet"]["assets"]["new"],
                journal_path=journal_path,
                journal_document=journal,
            )
        else:
            with pytest.raises(operator.FullBundleMigrationError, match="preserved"):
                operator._remove_unreferenced_created(
                    connection,
                    journal["destinations"],
                    env["asset_root"].resolve(),
                    env["packet"]["assets"]["new"],
                    journal_path=journal_path,
                    journal_document=journal,
                )
        connection.rollback()
    finally:
        connection.close()
    assert destination.read_bytes() == raced_bytes
    assert journal["destinations"][0]["ownership_state"] in {
        "raced_exact",
        "external_collision",
    }


@pytest.mark.parametrize("suffix", ["-wal", "-shm"])
def test_dangling_sqlite_sidecar_symlink_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, suffix: str
) -> None:
    database, _admin = _initialized_database(tmp_path, monkeypatch, f"dangling{suffix}")
    sidecar = Path(str(database) + suffix)
    sidecar.unlink(missing_ok=True)
    sidecar.symlink_to(tmp_path / "missing-sidecar-target")
    with pytest.raises(operator.FullBundleMigrationError, match="sidecar"):
        operator._assert_wal_sidecars_safe(database.resolve())


def test_hardlinked_sqlite_sidecar_and_database_backup_are_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "hardlink")
    sidecar_source = tmp_path / "sidecar-source"
    sidecar_source.write_bytes(b"sidecar")
    sidecar = Path(str(env["database"]) + "-wal")
    sidecar.unlink(missing_ok=True)
    os.link(sidecar_source, sidecar)
    with pytest.raises(operator.FullBundleMigrationError, match="sidecar"):
        operator._assert_wal_sidecars_safe(env["database"].resolve())
    sidecar.unlink()

    backup = Path(env["backup_manifest"]["backup"])
    backup.unlink()
    os.link(env["database"], backup)
    manifest = json.loads(env["backup_manifest_path"].read_text(encoding="utf-8"))
    manifest["bytes"] = backup.stat().st_size
    manifest["sha256"] = operator._sha256_path(backup)
    env["backup_manifest_path"].write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    with pytest.raises(operator.FullBundleMigrationError, match="regular|aliases"):
        operator._validate_backup(
            env["backup_manifest_path"],
            expected_manifest_sha256=operator._sha256_path(
                env["backup_manifest_path"]
            ),
            db_path=env["database"].resolve(),
            asset_root=env["asset_root"].resolve(),
        )


@pytest.mark.parametrize("suffix", ["-wal", "-shm"])
def test_report_cannot_occupy_reserved_sqlite_sidecar_name(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    suffix: str,
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"report-sidecar{suffix}")
    _patch_synthetic_apply(monkeypatch, env)
    args = _apply_args(env)
    args["report_path"] = Path(str(env["database"].resolve()) + suffix)
    with pytest.raises(operator.FullBundleMigrationError, match="collides"):
        operator.apply_private(**args)
    assert _draft_revision(env) == 2
    assert not args["report_path"].exists()
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()


@pytest.mark.parametrize("suffix", ["-wal", "-shm", "-journal"])
def test_backup_sidecars_are_rejected_before_snapshot_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    suffix: str,
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"backup-sidecar{suffix}")
    backup = Path(env["backup_manifest"]["backup"])
    sidecar = Path(str(backup) + suffix)
    sidecar.write_bytes(b"unbound")
    with pytest.raises(operator.FullBundleMigrationError, match="sidecars"):
        operator._validate_backup(
            env["backup_manifest_path"],
            expected_manifest_sha256=env["backup_manifest_sha256"],
            db_path=env["database"].resolve(),
            asset_root=env["asset_root"].resolve(),
        )


def test_backup_freshness_is_measured_after_integrity_and_at_lock_edge(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "freshness-boundary")
    created = int(env["backup_manifest"]["created_at"])
    monkeypatch.setattr(operator.time, "time", lambda: created + 900)
    operator._validate_backup(
        env["backup_manifest_path"],
        expected_manifest_sha256=env["backup_manifest_sha256"],
        db_path=env["database"].resolve(),
        asset_root=env["asset_root"].resolve(),
    )
    monkeypatch.setattr(operator.time, "time", lambda: created + 901)
    with pytest.raises(operator.FullBundleMigrationError, match="stale"):
        operator._validate_backup(
            env["backup_manifest_path"],
            expected_manifest_sha256=env["backup_manifest_sha256"],
            db_path=env["database"].resolve(),
            asset_root=env["asset_root"].resolve(),
        )


def test_postcommit_receipt_race_is_preserved_and_fresh_backup_recovers_journal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "receipt-race-recovery")
    _patch_synthetic_apply(monkeypatch, env)
    real_write = operator._write_json_atomic
    raced_payload = b'{"external":"receipt-race"}\n'

    def race_receipt(
        path: Path,
        value: dict,
        *,
        create_only: bool,
        expected_prior: dict | None = None,
    ) -> None:
        if path == env["report"].resolve() and create_only:
            path.write_bytes(raced_payload)
        real_write(
            path,
            value,
            create_only=create_only,
            expected_prior=expected_prior,
        )

    monkeypatch.setattr(operator, "_write_json_atomic", race_receipt)
    with pytest.raises(operator.FullBundleMigrationError, match="replace|raced"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 3
    assert env["report"].read_bytes() == raced_payload
    journal = env["asset_root"] / operator.JOURNAL_FILE_NAME
    assert journal.is_file()

    env["report"].unlink()
    monkeypatch.setattr(operator, "_write_json_atomic", real_write)
    _refresh_backup(env, tmp_path / "target-fresh-backup")
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["committed_asset_count"] == 98
    assert not journal.exists()


def test_canonical_receipt_is_backup_independent_and_exact_on_target_replay(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "receipt-canonical")
    _patch_synthetic_apply(monkeypatch, env)
    first = operator.apply_private(**_apply_args(env))
    assert "backup" not in first
    _refresh_backup(env, tmp_path / "fresh-target-replay")
    second = operator.apply_private(**_apply_args(env))
    assert second == first
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()


def test_target_replay_independently_rejects_rf_and_completed_history_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "target-history")
    _patch_synthetic_apply(monkeypatch, env)
    receipt = operator.apply_private(**_apply_args(env))
    history_sha = receipt["migration"]["predecessor_history_sha256"]
    rf_asset_id = env["packet"]["assets"]["existing_roaring_fork"][0]["asset_id"]
    connection = operator._connect(env["database"])
    try:
        mutations = []
        mutations.append(
            lambda: connection.execute(
                "UPDATE authored_original_assets SET sha256=? WHERE pack_id=? AND asset_id=?",
                ("f" * 64, builder.PRODUCT_ID, rf_asset_id),
            )
        )
        mutations.append(
            lambda: connection.execute(
                "UPDATE authored_original_assets SET storage_path=storage_path||'.wrong' WHERE pack_id=? AND asset_id=?",
                (builder.PRODUCT_ID, rf_asset_id),
            )
        )

        def mutate_generator() -> None:
            row = connection.execute(
                "SELECT generator_metadata_json FROM authored_original_assets WHERE pack_id=? AND asset_id=?",
                (builder.PRODUCT_ID, rf_asset_id),
            ).fetchone()
            generator = json.loads(row[0])
            generator["model_id"] = "altered-model"
            connection.execute(
                "UPDATE authored_original_assets SET generator_metadata_json=? WHERE pack_id=? AND asset_id=?",
                (_json(generator), builder.PRODUCT_ID, rf_asset_id),
            )

        mutations.append(mutate_generator)

        def mutate_coherent_timestamps() -> None:
            connection.execute(
                "UPDATE authored_trip_packs SET created_at=created_at+1 WHERE id=?",
                (builder.PRODUCT_ID,),
            )
            rf_ids = [
                row["asset_id"]
                for row in env["packet"]["assets"]["existing_roaring_fork"]
            ]
            for asset_id in rf_ids:
                connection.execute(
                    "UPDATE authored_original_assets SET created_at=created_at+1 WHERE pack_id=? AND asset_id=?",
                    (builder.PRODUCT_ID, asset_id),
                )
            for image_id in (
                row["asset_id"]
                for row in env["packet"]["assets"]["existing_roaring_fork"]
                if row["kind"] == "image"
            ):
                connection.execute(
                    "UPDATE authored_original_assets SET updated_at=updated_at+1 WHERE pack_id=? AND asset_id=?",
                    (builder.PRODUCT_ID, image_id),
                )

        mutations.append(mutate_coherent_timestamps)

        def add_completed_history() -> None:
            connection.execute(
                """INSERT INTO authored_original_validation_reports
                   SELECT 'original_validation_unapproved_extra',pack_id,draft_revision,
                          manifest_sha256,assets_sha256,input_sha256,
                          validator_source_sha256,manifest_json,suite_version,
                          engine_version,status,passed,summary_json,scenarios_json,
                          issues_json,started_by,worker_pid,started_at,completed_at
                   FROM authored_original_validation_reports WHERE id=?""",
                ("original_validation_synthetic_history",),
            )

        mutations.append(add_completed_history)
        for index, mutate in enumerate(mutations):
            connection.execute(f"SAVEPOINT history_case_{index}")
            mutate()
            with pytest.raises(operator.FullBundleMigrationError):
                operator._assert_target_state(
                    connection,
                    env["packet"],
                    env["asset_root"].resolve(),
                    expected_predecessor_history_sha256=history_sha,
                )
            connection.execute(f"ROLLBACK TO history_case_{index}")
            connection.execute(f"RELEASE history_case_{index}")
    finally:
        connection.close()


def test_canonical_receipt_rejects_every_old_run_local_field(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "receipt-run-fields")
    _patch_synthetic_apply(monkeypatch, env)
    receipt = operator.apply_private(**_apply_args(env))
    for key in (
        "result",
        "recovery",
        "asset_rows_inserted_by_run",
        "content_files_created_by_run",
    ):
        assert key not in receipt["migration"]
        changed = copy.deepcopy(receipt)
        changed["migration"][key] = 0
        with pytest.raises(operator.FullBundleMigrationError, match="bindings drifted"):
            operator._validate_existing_receipt(changed, receipt)


def test_audit_artifact_binds_frozen_operator_tests_and_transitive_sources(
    tmp_path: Path
) -> None:
    packet, contract, packet_sha = operator._load_exact_packet()
    bindings = {
        "migration_packet": {
            "path": str(builder.PACKET_PATH),
            "byte_count": (builder.ROOT / builder.PACKET_PATH).stat().st_size,
            "sha256": packet_sha,
        },
        "packet_builder": operator._source_binding(operator.PACKET_BUILDER_PATH),
        "migration_operator": operator._source_binding(operator.OPERATOR_PATH),
        "migration_operator_tests": operator._source_binding(operator.TEST_PATH),
        "db_store": packet["source_bindings"][str(builder.STORE_PATH)],
        "roaring_fork_import_operator": packet["source_bindings"][str(builder.RF_IMPORT_OPERATOR_PATH)],
        "sqlite_backup_operator": packet["source_bindings"][str(builder.BACKUP_OPERATOR_PATH)],
        "manifest_v3_normalizer": packet["source_bindings"][str(builder.MANIFEST_NORMALIZER_PATH)],
        "source_commit_and_tree": packet["source_revision"],
    }
    audit = {
        "schema_version": 1,
        "kind": "original_private_migration_operator_audit",
        "status": "independent_audit_passed",
        "contract_id": contract["contract_id"],
        "product_id": builder.PRODUCT_ID,
        "findings": contract["required_artifact"]["required_findings"],
        "bindings": bindings,
        "live_apply_reviewed": True,
    }
    path = tmp_path / "audit.json"
    path.write_text(json.dumps(audit), encoding="utf-8")
    result = operator._validate_operator_audit(path.resolve(), packet, contract, packet_sha)
    assert result["independent_audit_passed"] is True
    audit["bindings"]["migration_operator"]["sha256"] = "0" * 64
    path.write_text(json.dumps(audit), encoding="utf-8")
    with pytest.raises(operator.FullBundleMigrationError, match="bindings drifted"):
        operator._validate_operator_audit(path.resolve(), packet, contract, packet_sha)


def test_no_network_provider_rerender_or_secret_path_surface_is_present() -> None:
    files = [
        builder.ROOT / "scripts/build_smokies_complete_private_migration.py",
        builder.ROOT / "scripts/migrate_smokies_complete_private.py",
        builder.ROOT / "tests/test_smokies_complete_private_migration.py",
        builder.ROOT / builder.PACKET_PATH,
        builder.ROOT / builder.AUDIT_CONTRACT_PATH,
    ]
    joined = "\n".join(path.read_text(encoding="utf-8") for path in files)
    forbidden = (
        "/" + "home" + "/",
        "C:" + "\\" + "Users" + "\\",
        "wsl" + "." + "localhost",
        "api" + "_key",
        "client" + "_id",
        "requests" + ".",
        "url" + "open" + "(",
        "rerender" + "_allowed\": True",
    )
    assert all(item.lower() not in joined.lower() for item in forbidden)
