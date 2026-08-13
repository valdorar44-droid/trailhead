import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys

import pytest

from config.settings import settings
from db import originals_complete_validation as complete_validation
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


def _pretty_json_bytes(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def _retarget_directory(path: Path, label: str) -> Path:
    moved = path.with_name(f"{path.name}-{label}-moved")
    path.rename(moved)
    path.mkdir(mode=0o700)
    return moved


def _restore_retargeted_directory(path: Path, moved: Path) -> Path:
    replacement = path.with_name(f"{path.name}-foreign-replacement")
    path.rename(replacement)
    moved.rename(path)
    return replacement


def _semantic_database_clone(source: Path, destination: Path) -> None:
    source_connection = sqlite3.connect(source)
    destination_connection = sqlite3.connect(destination)
    try:
        source_connection.backup(destination_connection)
        destination_connection.commit()
        destination_connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        destination_connection.close()
        source_connection.close()
    for suffix in ("-wal", "-shm", "-journal"):
        Path(str(destination) + suffix).unlink(missing_ok=True)


def _retarget_database_to_clone(
    database: Path, clone: Path, label: str
) -> tuple[Path, list[Path]]:
    moved = database.with_name(f"{database.name}-{label}-moved")
    database.rename(moved)
    moved_sidecars: list[Path] = []
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(database) + suffix)
        if sidecar.exists():
            moved_sidecar = Path(str(moved) + suffix)
            sidecar.rename(moved_sidecar)
            moved_sidecars.append(moved_sidecar)
    clone.rename(database)
    return moved, moved_sidecars


def _terminal_journal(asset_root: Path) -> dict:
    journal = (asset_root / operator.JOURNAL_FILE_NAME).resolve()
    chain = operator._load_journal_chain(journal)
    assert chain is not None
    assert chain["document"]["state"] == "database_committed"
    assert chain["head_terminal"] is not None
    binding = operator._journal_terminal_binding(journal)
    assert binding["sequence"] == chain["sequence"]
    assert binding["head_sha256"] == chain["head_sha256"]
    for path in asset_root.glob(f"{operator.JOURNAL_FILE_NAME}*"):
        assert path.is_file() and not path.is_symlink()
        assert path.stat().st_nlink == 1
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    return chain


def _predecessor_terminal_journal(asset_root: Path) -> dict:
    journal = (asset_root / operator.JOURNAL_FILE_NAME).resolve()
    chain = operator._load_journal_chain(journal)
    assert chain is not None and chain["head_terminal"] is not None
    assert chain["head_terminal"]["terminal_status"] == "predecessor_recovered"
    assert chain["document"]["state"] != "database_committed"
    return chain


def _retained_new_asset_identities(env: dict) -> dict[str, tuple[int, int, str]]:
    identities: dict[str, tuple[int, int, str]] = {}
    for spec in env["packet"]["assets"]["new"]:
        destination = operator._asset_destination(
            spec, env["asset_root"].resolve()
        )
        assert destination.is_file() and not destination.is_symlink()
        info = destination.stat()
        assert info.st_nlink == 1
        assert stat.S_IMODE(info.st_mode) == 0o600
        assert info.st_size == int(spec["bytes"])
        assert operator._sha256_path(destination) == spec["sha256"]
        identities[destination.relative_to(env["asset_root"]).as_posix()] = (
            int(info.st_dev),
            int(info.st_ino),
            spec["sha256"],
        )
    assert len(identities) == 78
    return identities


def _interrupted_create_only_pair(
    path: Path, payload: bytes, *, token: str = "a" * 32
) -> Path:
    assert len(token) == 32 and all(character in "0123456789abcdef" for character in token)
    temporary = path.parent / f".{path.name}.{token}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        os.write(descriptor, payload)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.link(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    assert path.stat().st_ino == temporary.stat().st_ino
    assert path.stat().st_nlink == temporary.stat().st_nlink == 2
    return temporary


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
    historical_manifest_sha256 = _canonical_sha(predecessor_manifest)
    historical_assets_sha256 = "1" * 64
    historical_input_sha256 = "2" * 64
    historical_validator_source_sha256 = "3" * 64
    historical_started_at = now + 1
    historical_completed_at = now + 2
    historical_summary = {
        "selection": "roaring_fork_one_way_private_v1:one_way"
    }
    historical_issues: list[dict] = []
    historical_scenario_ids = [f"scenario_{index:02d}" for index in range(13)]
    historical_scenarios = [
        {
            "selection_key": "roaring_fork_one_way_private_v1:one_way",
            "passed": True,
            "issues": [],
            "scenarios": [
                {"id": scenario_id, "passed": True}
                for scenario_id in historical_scenario_ids
            ],
        }
    ]
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
            destination.chmod(0o600)
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
                historical_manifest_sha256,
                historical_assets_sha256,
                historical_input_sha256,
                historical_validator_source_sha256,
                _json(predecessor_manifest),
                "originals_virtual_route_v3",
                "original-trigger-v3",
                "passed",
                1,
                _json(historical_summary),
                _json(historical_scenarios),
                _json(historical_issues),
                admin["id"],
                16,
                historical_started_at,
                historical_completed_at,
            ),
        )
        connection.commit()
        connection.row_factory = sqlite3.Row
        historical_report_row = connection.execute(
            "SELECT * FROM authored_original_validation_reports WHERE id=?",
            (report_id,),
        ).fetchone()
        assert historical_report_row is not None
    finally:
        connection.close()

    historical_delivery_contract_sha256 = "4" * 64
    historical_target_binding_sha256 = "5" * 64
    historical_target_evidence_sha256 = "6" * 64
    historical_store_report = {
        "schema_version": 1,
        "report_type": "OriginalRouteValidationReportV1",
        "id": report_id,
        "pack_id": builder.PRODUCT_ID,
        "draft_revision": 2,
        "manifest_sha256": historical_manifest_sha256,
        "assets_sha256": historical_assets_sha256,
        "input_sha256": historical_input_sha256,
        "validator_source_sha256": historical_validator_source_sha256,
        "suite_version": "originals_virtual_route_v3",
        "engine_version": "original-trigger-v3",
        "status": "passed",
        "passed": True,
        "current": True,
        "started_at": historical_started_at,
        "completed_at": historical_completed_at,
        "summary_sha256": _canonical_sha(historical_summary),
        "scenarios_sha256": _canonical_sha(historical_scenarios),
        "issues_sha256": _canonical_sha(historical_issues),
        "pass_contract": {
            "selection_key": "roaring_fork_one_way_private_v1:one_way",
            "route_scenario_count": 13,
            "route_scenario_ids_sha256": _canonical_sha(
                historical_scenario_ids
            ),
            "delivery_contract_sha256": historical_delivery_contract_sha256,
            "target_id": "south_tn",
            "target_binding_sha256": historical_target_binding_sha256,
            "target_evidence_sha256": historical_target_evidence_sha256,
        },
    }
    historical_identity = {
        "draft_revision": 2,
        "material_identity": {
            "draft_revision": 2,
            "manifest_sha256": historical_manifest_sha256,
            "assets_sha256": historical_assets_sha256,
            "input_sha256": historical_input_sha256,
            "validator_source_sha256": historical_validator_source_sha256,
        },
    }
    historical_journal = {
        "schema_version": 1,
        "kind": "roaring_fork_trusted_validation_operator_report",
        "target_id": "isolated-target",
        "origin": "apply",
        "state": "completed",
        "validation_report_id": report_id,
        "identity": historical_identity,
        "preflight": {
            "global_active_report_count": 0,
            "target_report_count": 0,
        },
        "report": historical_store_report,
        "post_validation": {
            "identity": historical_identity,
            "global_active_report_count": 0,
            "target_report_count": 1,
        },
    }
    historical_journal_payload = _pretty_json_bytes(historical_journal)
    historical_rf_operator_report = (
        tmp_path / "roaring-fork-trusted-validation-v1.json"
    )
    historical_rf_operator_report.write_bytes(historical_journal_payload)
    historical_rf_operator_report.chmod(0o644)
    historical_redacted_report_sha256 = _sha(historical_journal_payload)

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
                "redacted_report_sha256": historical_redacted_report_sha256,
                "redacted_operator_report_path_sha256": operator._path_identity(
                    historical_rf_operator_report.resolve()
                ),
                "redacted_operator_report_byte_count": len(
                    historical_journal_payload
                ),
                "redacted_operator_report_file_sha256": (
                    historical_redacted_report_sha256
                ),
                "redacted_operator_report_canonical_sha256": _canonical_sha(
                    historical_journal
                ),
                "redacted_store_report_canonical_sha256": _canonical_sha(
                    historical_store_report
                ),
                "summary_sha256": _canonical_sha(historical_summary),
                "scenarios_sha256": _canonical_sha(historical_scenarios),
                "issues_sha256": _canonical_sha(historical_issues),
                "route_scenario_ids_sha256": _canonical_sha(
                    historical_scenario_ids
                ),
                "delivery_contract_sha256": (
                    historical_delivery_contract_sha256
                ),
                "target_id": "south_tn",
                "target_binding_sha256": historical_target_binding_sha256,
                "target_evidence_sha256": historical_target_evidence_sha256,
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
                "expected_worker_pid": 16,
                "expected_manifest_sha256": historical_manifest_sha256,
                "expected_assets_sha256": historical_assets_sha256,
                "expected_input_sha256": historical_input_sha256,
                "expected_validator_source_sha256": (
                    historical_validator_source_sha256
                ),
                "expected_started_by": admin["id"],
                "expected_started_at": historical_started_at,
                "expected_completed_at": historical_completed_at,
                "expected_selection_result_count": 1,
                "expected_nested_scenario_count": 13,
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
        "historical_rf_operator_report": historical_rf_operator_report,
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


def _draft_revision_at(database: Path) -> int:
    connection = sqlite3.connect(database)
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
        "historical_rf_operator_report_path": environment[
            "historical_rf_operator_report"
        ],
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
        builder,
        "HISTORICAL_RF_OPERATOR_REPORT_PATH",
        str(environment["historical_rf_operator_report"].resolve()),
    )
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


def _valid_journal_document(environment: dict) -> dict:
    target = operator._configured_target(
        db_path=environment["database"].resolve(),
        asset_root=environment["asset_root"].resolve(),
        target_id="isolated-target",
        packet=environment["packet"],
    )
    return operator._journal_document(
        environment["packet"],
        environment["packet_sha256"],
        target=target,
        db_path=environment["database"].resolve(),
        asset_root=environment["asset_root"].resolve(),
        narration_root=environment["narration_root"].resolve(),
        artwork_root=environment["artwork_root"].resolve(),
        backup_manifest_sha256=environment["backup_manifest_sha256"],
        audit_sha256="e" * 64,
        predecessor_history_sha256="1" * 64,
        database_inode_identity_sha256=operator._filesystem_identity_sha256(
            operator._inode_identity(environment["database"])
        ),
    )


def test_real_packet_is_deterministic_exact_and_fail_closed() -> None:
    packet, contract = builder.build_bundle()
    assert packet["source_revision"] == builder.MIGRATION_BASE_SOURCE_REVISION
    assert packet["source_revision"] == {
        "commit": "4d24fe44a02bbf957c8200399612151f84a1e83a",
        "tree": "9393a7a0049f8c0f4eef60d18ca5579d9f9aeef4",
    }
    assert packet["private_candidate_commit_revision"] == (
        builder.PRIVATE_CANDIDATE_COMMIT_REVISION
    )
    assert packet["candidate_source_revision"] == builder.EXPECTED_CANDIDATE_SOURCE_REVISION
    historical = packet["predecessor"]["permitted_validation_history"]
    assert {
        key: historical[key]
        for key in (
            "expected_worker_pid",
            "expected_manifest_sha256",
            "expected_assets_sha256",
            "expected_input_sha256",
            "expected_validator_source_sha256",
            "expected_started_by",
            "expected_started_at",
            "expected_completed_at",
            "expected_selection_result_count",
            "expected_nested_scenario_count",
        )
    } == {
        "expected_worker_pid": 16,
        "expected_manifest_sha256": (
            "b6f730d17922f7b38361d08e9bc97bde1d340a0c42d9b455802fca708585d725"
        ),
        "expected_assets_sha256": (
            "1c4c945fe594089bb6147f15251a097818ea5b4093e193c22c93751cf811fc32"
        ),
        "expected_input_sha256": (
            "81815b5cca2e6cb19a0cc1e75208d73b3ce01683d3660ea2095c7a553d1fba0a"
        ),
        "expected_validator_source_sha256": (
            "cd045f33f6908235f5393dfeca54ae3317855dbb9f716bbd283fceff5be415a1"
        ),
        "expected_started_by": 3,
        "expected_started_at": 1786412026,
        "expected_completed_at": 1786412036,
        "expected_selection_result_count": 1,
        "expected_nested_scenario_count": 13,
    }
    assert historical["expected_manifest_sha256"] != (
        packet["predecessor"]["profiled_manifest_canonical_sha256"]
    )
    assert {
        key: historical[key]
        for key in (
            "redacted_report_sha256",
            "redacted_operator_report_path_sha256",
            "redacted_operator_report_byte_count",
            "redacted_operator_report_file_sha256",
            "redacted_operator_report_canonical_sha256",
            "redacted_store_report_canonical_sha256",
            "summary_sha256",
            "scenarios_sha256",
            "issues_sha256",
            "route_scenario_ids_sha256",
            "delivery_contract_sha256",
            "target_id",
            "target_binding_sha256",
            "target_evidence_sha256",
        )
    } == {
        "redacted_report_sha256": (
            "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059"
        ),
        "redacted_operator_report_path_sha256": (
            "db4e1621926c4267a96a0f56294a31acb943f490f496898af44138be26a3684f"
        ),
        "redacted_operator_report_byte_count": 6090,
        "redacted_operator_report_file_sha256": (
            "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059"
        ),
        "redacted_operator_report_canonical_sha256": (
            "368fdffed960744954f709643ea4c9ac33c995302b54179167eff27c32f5567f"
        ),
        "redacted_store_report_canonical_sha256": (
            "a9dd8583e1c50869f1de75fe124e5a8590be6b33a5ace5a71ddae974174b3503"
        ),
        "summary_sha256": (
            "c8a49951221c454da8462c26dcbbcb2962af8bfe3ce0875d24927b2b21d0ef6f"
        ),
        "scenarios_sha256": (
            "09ee939488a9f41d781aa4bded9058f88852d3a9ab1d08b73802308b333fc248"
        ),
        "issues_sha256": (
            "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        ),
        "route_scenario_ids_sha256": (
            "9edf543ba393121a86699f205813c58fba30e09b687f89659a1f7a7a5bde6511"
        ),
        "delivery_contract_sha256": (
            "9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6"
        ),
        "target_id": "south_tn",
        "target_binding_sha256": (
            "41a00c67ed83bafe7355d4e1858710df38e780c2a514641e269103fdcea9104e"
        ),
        "target_evidence_sha256": (
            "2fded0c644b73a36c2efe45a0f64e6e0add551b9c5f2b81c42e73fd276a7a703"
        ),
    }
    closure = packet["trusted_complete_validator_source_closure"]
    assert closure["schema_version"] == 1
    assert closure["framing"] == builder.COMPLETE_VALIDATOR_SOURCE_FRAMING
    assert closure["path_count"] == 174
    assert closure["sha256"] == (
        "b01033dcdf155370688c5fd4ce1e9264d670505b1958b7135b1724e39d52235f"
    )
    assert len(closure["paths"]) == closure["path_count"]
    assert [row["path"] for row in closure["paths"]] == sorted(
        row["path"] for row in closure["paths"]
    )
    assert len({row["path"] for row in closure["paths"]}) == closure["path_count"]
    assert contract["complete_validator_source_closure"] == {
        key: closure[key]
        for key in ("schema_version", "framing", "path_count", "sha256")
    }
    assert packet["v3_release_guard_independent_audit"] == {
        **packet["source_bindings"][str(builder.RELEASE_GUARD_AUDIT_PATH)],
        "status": "independent_audit_passed",
        "p0_count": 0,
        "p1_count": 0,
        "runtime_source_commit_and_tree": builder.MIGRATION_BASE_SOURCE_REVISION,
    }
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
    assert packet["assets"]["promotion"] == {
        "content_addressed": True,
        "create_only": True,
        "overwrite_allowed": False,
        "rerender_allowed": False,
        "anonymous_inode_created_on_destination_filesystem": True,
        "anonymous_inode_fsynced_before_no_replace_link": True,
        "linked_destination_nlink_must_equal_one": True,
        "every_destination_uid_mode_device_and_inode_reverified": True,
        "asset_root_inode_pinned_for_every_traversal": True,
        "nested_parent_loss_journaled_as_external_absent": True,
        "named_staging_used": False,
        "unexpected_named_staging_preserved_and_rejected": True,
        "append_only_journal_required_before_first_asset_link": True,
        "journal_chain_and_terminals_retained": True,
        "receipt_binds_cumulative_journal_inventory": True,
        "rollback_deletes_content_addressed_bytes": False,
        "exact_unreferenced_bytes_retained_for_replay": True,
        "foreign_or_corrupt_replacement_preserved_and_rejected": True,
    }
    transaction_requirements = {
        "asset_root_directory_inode_flocked_for_process_lifetime": True,
        "replaceable_lock_path_used": False,
        "database_inode_pinned_through_procfd": True,
        "database_lexical_path_rechecked_at_every_action_and_receipt_edge": True,
        "database_inode_identity_redacted_hash_bound_in_journal_terminal_receipt": True,
        "postcommit_database_path_drift_is_commit_uncertain_without_success_receipt": True,
        "report_parent_directory_inode_pinned_through_receipt_return": True,
    }
    assert {
        key: packet["database_transaction"][key] for key in transaction_requirements
    } == transaction_requirements
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


def test_complete_validator_closure_and_historical_evidence_are_exact() -> None:
    packet, contract = builder.build_bundle()
    closure = packet["trusted_complete_validator_source_closure"]
    rows = closure["paths"]
    digest = hashlib.sha256()
    row_by_path = {row["path"]: row for row in rows}
    for row in rows:
        relative = Path(row["path"])
        assert not relative.is_absolute()
        assert ".." not in relative.parts
        payload = (builder.ROOT / relative).read_bytes()
        assert row["byte_count"] == len(payload)
        assert row["sha256"] == _sha(payload)
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(payload)).encode("ascii"))
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
    assert digest.hexdigest() == closure["sha256"]
    for relative, expected_sha256 in complete_validation.IMMUTABLE_EVIDENCE_SHA256:
        assert row_by_path[relative.as_posix()]["sha256"] == expected_sha256
    expected_transitive_paths = {
        builder.STORE_PATH,
        builder.CANDIDATE_BUILDER_PATH,
        builder.COMPLETE_VALIDATION_PATH,
        builder.MOBILE_LONG_FORM_VALIDATOR_PATH,
        builder.MOBILE_LONG_FORM_EVIDENCE_REGISTRY_PATH,
        builder.RELEASE_GUARD_AUDIT_PATH,
        builder.RF_IMPORT_OPERATOR_PATH,
        builder.BACKUP_OPERATOR_PATH,
        builder.MANIFEST_NORMALIZER_PATH,
    }
    assert set(contract["transitive_source_contract"]) == {
        str(path) for path in expected_transitive_paths
    }
    assert contract["required_artifact"]["required_bindings"] == [
        "migration_packet",
        "packet_builder",
        "migration_operator",
        "migration_operator_tests",
        "db_store",
        "complete_private_candidate_builder",
        "complete_validation_dispatcher",
        "mobile_long_form_validator",
        "mobile_long_form_evidence_registry",
        "complete_validator_source_closure",
        "v3_release_guard_audit",
        "roaring_fork_import_operator",
        "sqlite_backup_operator",
        "manifest_v3_normalizer",
        "source_commit_and_tree",
    ]


@pytest.mark.parametrize(
    "case",
    [
        "worker_pid_missing",
        "worker_pid_changed",
        "manifest_sha256",
        "assets_sha256",
        "input_sha256",
        "validator_source_sha256",
        "manifest_json",
        "summary_json",
        "selection_key",
        "selection_result_count",
        "nested_scenario_count",
        "nested_scenario_payload",
        "started_by",
        "started_at",
        "completed_at",
    ],
)
def test_historical_report_exact_facts_and_nested_shape_fail_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    case: str,
) -> None:
    environment = _synthetic_environment(tmp_path, monkeypatch, f"history_{case}")
    packet = environment["packet"]
    connection = sqlite3.connect(environment["database"])
    connection.row_factory = sqlite3.Row
    try:
        report = dict(
            connection.execute(
                "SELECT * FROM authored_original_validation_reports WHERE id=?",
                (packet["predecessor"]["permitted_validation_history"]["report_id"],),
            ).fetchone()
        )
        if case == "worker_pid_missing":
            column, value = "worker_pid", None
        elif case == "worker_pid_changed":
            column, value = "worker_pid", 17
        elif case in {
            "manifest_sha256",
            "assets_sha256",
            "input_sha256",
            "validator_source_sha256",
        }:
            column, value = case, "0" * 64
        elif case == "manifest_json":
            column, value = "manifest_json", _json(
                {"schema_version": 3, "title": "historical drift"}
            )
        elif case == "summary_json":
            column, value = "summary_json", "{}"
        elif case in {
            "selection_key",
            "selection_result_count",
            "nested_scenario_count",
            "nested_scenario_payload",
        }:
            scenarios = json.loads(report["scenarios_json"])
            if case == "selection_key":
                scenarios[0]["selection_key"] = "wrong:selection"
            elif case == "selection_result_count":
                scenarios.append(copy.deepcopy(scenarios[0]))
            elif case == "nested_scenario_count":
                scenarios[0]["scenarios"] = scenarios[0]["scenarios"][:-1]
            else:
                scenarios[0]["scenarios"][0]["passed"] = False
            column, value = "scenarios_json", _json(scenarios)
        elif case == "started_by":
            column, value = "started_by", int(environment["admin"]["id"]) + 1
        elif case == "started_at":
            column, value = "started_at", int(report["started_at"]) + 1
        else:
            column, value = "completed_at", int(report["completed_at"]) + 1
        connection.execute(
            f"UPDATE authored_original_validation_reports SET {column}=? WHERE id=?",
            (value, report["id"]),
        )
        connection.commit()
        before = operator._db_snapshot(connection)
        rf_rows = {
            row["asset_id"]: row
            for row in before["assets"]
            if row["asset_id"]
            in packet["predecessor"]["existing_asset_sha256"]
        }
        with pytest.raises(
            operator.FullBundleMigrationError,
            match="historical validation report",
        ):
            operator._assert_independent_rf_history(before, packet, rf_rows)
        after = operator._db_snapshot(connection)
        assert after == before
        assert after["pack"]["draft_revision"] == 2
        assert len(after["assets"]) == 20
        assert len(after["validation_reports"]) == 1
    finally:
        connection.close()


@pytest.mark.parametrize(
    "case",
    ["raw_bytes", "nested_report", "mode", "hardlink", "wrong_path"],
)
def test_historical_operator_journal_is_file_and_semantics_bound(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    case: str,
) -> None:
    environment = _synthetic_environment(tmp_path, monkeypatch, f"journal_{case}")
    packet = environment["packet"]
    path = environment["historical_rf_operator_report"]
    monkeypatch.setattr(
        builder,
        "HISTORICAL_RF_OPERATOR_REPORT_PATH",
        str(path.resolve()),
    )
    expected = operator._assert_historical_rf_operator_report(
        path.resolve(), packet
    )
    assert expected == {
        "path_sha256": operator._path_identity(path.resolve()),
        "byte_count": path.stat().st_size,
        "file_sha256": operator._sha256_path(path),
        "canonical_sha256": packet["predecessor"][
            "permitted_validation_history"
        ]["redacted_operator_report_canonical_sha256"],
        "store_report_canonical_sha256": packet["predecessor"][
            "permitted_validation_history"
        ]["redacted_store_report_canonical_sha256"],
    }
    if case == "raw_bytes":
        path.write_bytes(path.read_bytes() + b"\n")
    elif case == "nested_report":
        document = json.loads(path.read_bytes())
        document["report"]["current"] = False
        payload = _pretty_json_bytes(document)
        path.write_bytes(payload)
        history = packet["predecessor"]["permitted_validation_history"]
        history["redacted_report_sha256"] = _sha(payload)
        history["redacted_operator_report_file_sha256"] = _sha(payload)
        history["redacted_operator_report_byte_count"] = len(payload)
        history["redacted_operator_report_canonical_sha256"] = _canonical_sha(
            document
        )
    elif case == "mode":
        path.chmod(0o600)
    elif case == "hardlink":
        os.link(path, tmp_path / "foreign-hardlink.json")
    else:
        path = tmp_path / "wrong-historical-report.json"
        path.write_bytes(
            environment["historical_rf_operator_report"].read_bytes()
        )
        path.chmod(0o644)
    with pytest.raises(operator.FullBundleMigrationError, match="historical"):
        operator._assert_historical_rf_operator_report(path.resolve(), packet)


def test_historical_operator_journal_drift_stops_before_all_durable_effects(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment = _synthetic_environment(tmp_path, monkeypatch, "journal_apply")
    _patch_synthetic_apply(monkeypatch, environment)
    path = environment["historical_rf_operator_report"]
    path.write_bytes(path.read_bytes() + b"\n")
    with pytest.raises(
        operator.FullBundleMigrationError,
        match="historical validation journal bytes drifted",
    ):
        operator.apply_private(**_apply_args(environment))
    assert _draft_revision(environment) == 2
    assert not environment["report"].exists()
    assert not list(
        environment["asset_root"].glob(f"{operator.JOURNAL_FILE_NAME}*")
    )
    assert not any(
        operator._asset_destination(spec, environment["asset_root"].resolve()).exists()
        for spec in environment["packet"]["assets"]["new"]
    )


def test_builder_fails_on_transitive_source_drift(monkeypatch: pytest.MonkeyPatch) -> None:
    broken = dict(builder.EXPECTED_SOURCE_SHA256)
    broken[str(builder.CANDIDATE_PATH)] = "0" * 64
    monkeypatch.setattr(builder, "EXPECTED_SOURCE_SHA256", broken)
    with pytest.raises(builder.MigrationPacketBuildError, match="source drifted"):
        builder.build_bundle()


def test_builder_fails_on_complete_validator_closure_drift(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        builder,
        "trusted_complete_originals_long_form_validator_source_sha256",
        lambda: "0" * 64,
    )
    with pytest.raises(
        builder.MigrationPacketBuildError,
        match="complete trusted-validator source hash drifted",
    ):
        builder.build_bundle()


def test_builder_fails_on_complete_validator_closure_inventory_drift(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = builder.trusted_complete_originals_long_form_validator_source_paths
    monkeypatch.setattr(
        builder,
        "trusted_complete_originals_long_form_validator_source_paths",
        lambda: original()[:-1],
    )
    with pytest.raises(
        builder.MigrationPacketBuildError,
        match="complete trusted-validator source inventory drifted",
    ):
        builder.build_bundle()


def test_builder_fails_on_release_guard_audit_semantic_drift(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = builder._read_json

    def drifted(relative: Path) -> dict:
        value = original(relative)
        if relative == builder.RELEASE_GUARD_AUDIT_PATH:
            value["findings"]["p1_count"] = 1
        return value

    monkeypatch.setattr(builder, "_read_json", drifted)
    with pytest.raises(
        builder.MigrationPacketBuildError,
        match="V3 release-guard audit binding drifted",
    ):
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


def test_anonymous_json_capability_failure_precedes_every_durable_effect(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "capability-fail")
    _patch_synthetic_apply(monkeypatch, env)

    def unsupported(*_args, **_kwargs):
        raise operator.FullBundleMigrationError(
            "anonymous create-only linking is unsupported"
        )

    monkeypatch.setattr(operator, "_link_unnamed_file_at", unsupported)
    with pytest.raises(operator.FullBundleMigrationError, match="unsupported"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()
    assert not (env["asset_root"] / operator.LOCK_FILE_NAME).exists()
    assert not list((env["asset_root"] / builder.PRODUCT_ID).glob("new_*/*"))
    assert not list(
        env["asset_root"].glob(
            ".smokies-complete-private-json-create-capability-v1-*"
        )
    )


@pytest.mark.parametrize("shape", ["exact", "corrupt", "symlink"])
def test_unexpected_legacy_staging_is_preserved_and_blocks_all_effects(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, shape: str
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"legacy-staging-{shape}")
    _patch_synthetic_apply(monkeypatch, env)
    staging = env["asset_root"] / operator.STAGING_DIR_NAME
    if shape == "symlink":
        retained = tmp_path / "foreign-staging-target"
        retained.mkdir()
        staging.symlink_to(retained, target_is_directory=True)
        child = retained / "foreign.bin"
        child.write_bytes(b"foreign-staging-symlink")
    else:
        staging.mkdir()
        child = staging / "retained.bin"
        if shape == "exact":
            spec = env["packet"]["assets"]["new"][0]
            source_root = (
                env["narration_root"]
                if spec["source_root"] == "accepted_remaining_narration_root"
                else env["artwork_root"]
            )
            child.write_bytes(
                (source_root / spec["source_relative_path"]).read_bytes()
            )
        else:
            child.write_bytes(b"foreign-corrupt-staging")
    before = child.read_bytes()
    with pytest.raises(operator.FullBundleMigrationError, match="orphan staging"):
        operator.apply_private(**_apply_args(env))
    assert child.read_bytes() == before
    assert _draft_revision(env) == 2
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
    terminal_chain = _terminal_journal(env["asset_root"])
    assert first["migration"]["journal_terminal"]["head_sha256"] == terminal_chain[
        "head_sha256"
    ]
    capability_markers = [
        *env["asset_root"].glob(
            ".smokies-complete-private-json-create-capability-v1-*"
        ),
        *env["report"].parent.glob(
            ".smokies-complete-private-json-create-capability-v1-*"
        ),
    ]
    assert len(capability_markers) == 2
    for marker in capability_markers:
        assert marker.stat().st_nlink == 1
        assert stat.S_IMODE(marker.stat().st_mode) == 0o600
        assert str(tmp_path.resolve()) not in marker.read_text(encoding="utf-8")

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
    retained = sorted(
        (env["asset_root"] / builder.PRODUCT_ID).glob("new_*/*")
    )
    assert len(retained) == 78
    retained_identities = {
        path.relative_to(env["asset_root"]).as_posix(): (
            path.stat().st_dev,
            path.stat().st_ino,
            operator._sha256_path(path),
        )
        for path in retained
    }

    # Rollback is deliberately non-destructive.  The next attempt must bind
    # every retained exact inode as preexisting and must not copy, overwrite,
    # or relink any accepted bytes.
    with pytest.raises(RuntimeError, match="injected DB failure"):
        operator.apply_private(**_apply_args(env))
    second_chain = operator._load_journal_chain(journal.resolve())
    assert second_chain is not None
    second_journal = second_chain["document"]
    assert all(row["existed_before"] is True for row in second_journal["destinations"])
    assert all(
        row["ownership_state"] == "preexisting"
        for row in second_journal["destinations"]
    )
    assert {
        path.relative_to(env["asset_root"]).as_posix(): (
            path.stat().st_dev,
            path.stat().st_ino,
            operator._sha256_path(path),
        )
        for path in retained
    } == retained_identities

    monkeypatch.setattr(operator, "_apply_database_locked", real_apply)
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["committed_asset_count"] == 98
    assert {
        path.relative_to(env["asset_root"]).as_posix(): (
            path.stat().st_dev,
            path.stat().st_ino,
            operator._sha256_path(path),
        )
        for path in retained
    } == retained_identities
    _terminal_journal(env["asset_root"])


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
        database_inode_identity_sha256=operator._filesystem_identity_sha256(
            operator._inode_identity(env["database"])
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


@pytest.mark.parametrize("unsafe", ["hardlink", "mode", "owner"])
def test_preexisting_exact_asset_requires_single_link_owner_mode_and_device(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, unsafe: str
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"asset-{unsafe}")
    _patch_synthetic_apply(monkeypatch, env)
    spec = env["packet"]["assets"]["new"][0]
    destination = operator._asset_destination(spec, env["asset_root"].resolve())
    destination.parent.mkdir(parents=True, exist_ok=True)
    source = env["narration_root"] / spec["source_relative_path"]
    destination.write_bytes(source.read_bytes())
    destination.chmod(0o600)
    external = tmp_path / "external-hardlink"
    if unsafe == "hardlink":
        os.link(destination, external)
    elif unsafe == "mode":
        destination.chmod(0o644)
    else:
        historical_binding = operator._assert_historical_rf_operator_report(
            env["historical_rf_operator_report"].resolve(),
            env["packet"],
        )
        monkeypatch.setattr(
            operator,
            "_assert_historical_rf_operator_report",
            lambda *_args, **_kwargs: copy.deepcopy(historical_binding),
        )
        monkeypatch.setattr(operator.os, "geteuid", lambda: os.getuid() + 1)
    with pytest.raises(operator.FullBundleMigrationError, match="identity or bytes changed"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()
    if unsafe == "hardlink":
        assert destination.stat().st_nlink == external.stat().st_nlink == 2
        assert destination.stat().st_ino == external.stat().st_ino


def test_preexisting_asset_hardlink_race_after_first_verification_is_detected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "asset-hardlink-race")
    _patch_synthetic_apply(monkeypatch, env)
    spec = env["packet"]["assets"]["new"][0]
    destination = operator._asset_destination(spec, env["asset_root"].resolve())
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(
        (env["narration_root"] / spec["source_relative_path"]).read_bytes()
    )
    destination.chmod(0o600)
    external = tmp_path / "post-verification-hardlink"
    real_verify = operator._verified_asset_destination
    raced = {"done": False}

    def verify_then_link(item, root, **kwargs):
        result = real_verify(item, root, **kwargs)
        if item["asset_id"] == spec["asset_id"] and not raced["done"]:
            os.link(result, external)
            raced["done"] = True
        return result

    monkeypatch.setattr(operator, "_verified_asset_destination", verify_then_link)
    with pytest.raises(operator.FullBundleMigrationError, match="identity or bytes changed"):
        operator.apply_private(**_apply_args(env))
    assert raced["done"] is True
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    assert destination.stat().st_nlink == external.stat().st_nlink == 2


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


def test_database_root_overlap_and_pinned_root_flock_fail_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "path-safety")
    _patch_synthetic_apply(monkeypatch, env)
    args = _apply_args(env)
    args["asset_root"] = env["database"].parent
    monkeypatch.setenv(operator.ASSET_ROOT_ENV, str(env["database"].parent.resolve()))
    with pytest.raises(operator.FullBundleMigrationError, match="must not overlap"):
        operator.apply_private(**args)

    root = env["asset_root"].resolve()
    monkeypatch.setenv(operator.ASSET_ROOT_ENV, str(root))
    # A legacy/foreign lock filename is irrelevant because the operator flocks
    # the already pinned root directory inode itself.
    (root / operator.LOCK_FILE_NAME).symlink_to(env["database"])
    probe = (
        "import fcntl,os,sys;"
        "fd=os.open(sys.argv[1],os.O_RDONLY|os.O_DIRECTORY);"
        "\ntry:\n fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError:\n sys.exit(23)\n"
        "sys.exit(0)\n"
    )
    with operator._pin_directory(root, "asset root"):
        with operator._exclusive_lock(root):
            blocked = subprocess.run(
                [sys.executable, "-c", probe, str(root)], check=False
            )
            assert blocked.returncode == 23
    acquired = subprocess.run([sys.executable, "-c", probe, str(root)], check=False)
    assert acquired.returncode == 0


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
    _predecessor_terminal_journal(env["asset_root"])
    retained_identities = _retained_new_asset_identities(env)
    monkeypatch.setattr(operator.time, "time", real_time)
    _refresh_backup(env, tmp_path / "fresh-backup")
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["committed_asset_count"] == 98
    assert _retained_new_asset_identities(env) == retained_identities


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
    _predecessor_terminal_journal(env["asset_root"])
    assert not (env["asset_root"] / operator.STAGING_DIR_NAME).exists()
    _retained_new_asset_identities(env)


def test_existing_receipt_is_fully_immutable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "receipt-integrity")
    _patch_synthetic_apply(monkeypatch, env)
    operator.apply_private(**_apply_args(env))
    receipt = json.loads(env["report"].read_text(encoding="utf-8"))
    receipt["effects"]["publication_performed"] = True
    env["report"].write_bytes(_pretty_json_bytes(receipt))
    with pytest.raises(operator.FullBundleMigrationError, match="bindings drifted"):
        operator.apply_private(**_apply_args(env))


def test_preexisting_receipt_blocks_before_files_or_database_change(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "receipt-preflight")
    _patch_synthetic_apply(monkeypatch, env)
    env["report"].write_text("{}\n", encoding="utf-8")
    env["report"].chmod(0o600)
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


def test_report_parent_retarget_after_capability_is_preserved_and_blocks_all_effects(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "report-parent-capability")
    _patch_synthetic_apply(monkeypatch, env)
    report_parent = tmp_path / "reports"
    report_parent.mkdir()
    env["report"] = report_parent / "receipt.json"
    moved: list[Path] = []
    real_capability = operator._ensure_json_create_capability_at

    def retarget_after_capability(parent: Path, **kwargs):
        result = real_capability(parent, **kwargs)
        if kwargs.get("role") == "receipt" and not moved:
            moved.append(_retarget_directory(report_parent, "after-capability"))
        return result

    monkeypatch.setattr(
        operator, "_ensure_json_create_capability_at", retarget_after_capability
    )
    with pytest.raises(operator.FullBundleMigrationError, match="identity|retargeted"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    assert moved and any(moved[0].iterdir())
    assert not (env["asset_root"] / operator.JOURNAL_FILE_NAME).exists()
    assert not any(
        operator._asset_destination(spec, env["asset_root"].resolve()).exists()
        for spec in env["packet"]["assets"]["new"]
    )


@pytest.mark.parametrize("stage", ["before-install", "after-install"])
def test_report_parent_retarget_at_receipt_install_is_fail_closed_and_replayable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, stage: str
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"report-{stage}")
    _patch_synthetic_apply(monkeypatch, env)
    report_parent = tmp_path / "reports"
    report_parent.mkdir()
    env["report"] = report_parent / "receipt.json"
    moved: list[Path] = []
    if stage == "before-install":
        real_install = operator._install_immutable_bytes_at

        def install_hook(path: Path, payload: bytes, *, label: str, **kwargs):
            if label == "migration receipt" and not moved:
                moved.append(_retarget_directory(report_parent, stage))
            return real_install(path, payload, label=label, **kwargs)

        monkeypatch.setattr(operator, "_install_immutable_bytes_at", install_hook)
    else:
        real_read = operator._read_json_at

        def read_hook(path: Path, parent_descriptor: int, parent_identity, *, label: str):
            if label == "installed migration receipt" and not moved:
                moved.append(_retarget_directory(report_parent, stage))
            return real_read(path, parent_descriptor, parent_identity, label=label)

        monkeypatch.setattr(operator, "_read_json_at", read_hook)
    with pytest.raises(operator.FullBundleMigrationError, match="identity|retargeted"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 3
    assert moved and not env["report"].exists()
    if stage == "after-install":
        assert (moved[0] / env["report"].name).is_file()
    _terminal_journal(env["asset_root"])
    replacement = _restore_retargeted_directory(report_parent, moved[0])
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["database_inode_identity_sha256"]
    assert not any(replacement.iterdir())


def test_existing_receipt_parent_retarget_never_bootstraps_replacement_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "existing-receipt-parent")
    _patch_synthetic_apply(monkeypatch, env)
    report_parent = tmp_path / "reports"
    report_parent.mkdir()
    env["report"] = report_parent / "receipt.json"
    expected = operator.apply_private(**_apply_args(env))
    moved: list[Path] = []
    real_history = operator._history_binding_from_file

    def history_hook(path: Path, **kwargs):
        if kwargs.get("kind") == "migration receipt" and not moved:
            moved.append(_retarget_directory(report_parent, "existing-read"))
        return real_history(path, **kwargs)

    monkeypatch.setattr(operator, "_history_binding_from_file", history_hook)
    with pytest.raises(operator.FullBundleMigrationError, match="identity|retargeted"):
        operator.apply_private(**_apply_args(env))
    assert moved and (moved[0] / env["report"].name).is_file()
    assert not env["report"].exists()
    _restore_retargeted_directory(report_parent, moved[0])
    monkeypatch.setattr(operator, "_history_binding_from_file", real_history)
    assert operator.apply_private(**_apply_args(env)) == expected


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
    real_link = operator._link_unnamed_file_at
    retargeted: list[Path] = []
    first_spec = env["packet"]["assets"]["new"][0]
    first_destination = operator._asset_destination(
        first_spec, env["asset_root"].resolve()
    )

    def racing_link(source_fd, parent_fd, name, *, label):
        if not retargeted and name == first_destination.name:
            lexical = first_destination.parent
            moved = lexical.with_name(lexical.name + "-moved")
            lexical.rename(moved)
            lexical.symlink_to(outside, target_is_directory=True)
            retargeted.append(moved)
        return real_link(source_fd, parent_fd, name, label=label)

    monkeypatch.setattr(operator, "_link_unnamed_file_at", racing_link)
    with pytest.raises(operator.FullBundleMigrationError, match="retargeted"):
        operator.apply_private(**_apply_args(env))
    retained = retargeted[0] / first_destination.name
    assert retained.is_file()
    assert retained.stat().st_nlink == 1
    assert operator._sha256_path(retained) == first_spec["sha256"]
    assert list(outside.iterdir()) == []
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    _predecessor_terminal_journal(env["asset_root"])


def test_nested_asset_parent_retarget_after_install_terminalizes_and_replays_cleanly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "nested-parent-after-install")
    _patch_synthetic_apply(monkeypatch, env)
    first_spec = env["packet"]["assets"]["new"][0]
    first_destination = operator._asset_destination(
        first_spec, env["asset_root"].resolve()
    )
    real_install = operator._install_asset_create_only
    moved: list[Path] = []

    def install_then_retarget(item, root, destination):
        info = real_install(item, root, destination)
        if item.spec["asset_id"] == first_spec["asset_id"] and not moved:
            moved.append(_retarget_directory(destination.parent, "post-install"))
        return info

    monkeypatch.setattr(operator, "_install_asset_create_only", install_then_retarget)
    with pytest.raises(operator.FullBundleMigrationError, match="unavailable|retargeted"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 2
    assert moved and (moved[0] / first_destination.name).is_file()
    assert not first_destination.exists()
    chain = _predecessor_terminal_journal(env["asset_root"])
    row = next(
        item
        for item in chain["document"]["destinations"]
        if item["asset_id"] == first_spec["asset_id"]
    )
    assert row["ownership_state"] == "external_absent"
    monkeypatch.setattr(operator, "_install_asset_create_only", real_install)
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["committed_asset_count"] == 98
    assert (moved[0] / first_destination.name).is_file()
    assert first_destination.is_file()
    assert first_destination.stat().st_ino != (moved[0] / first_destination.name).stat().st_ino


@pytest.mark.parametrize("stage", ["after-base", "after-link"])
def test_top_level_asset_root_retarget_never_splits_journal_and_assets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, stage: str
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"root-{stage}")
    _patch_synthetic_apply(monkeypatch, env)
    root = env["asset_root"].resolve()
    moved: list[Path] = []
    if stage == "after-base":
        real_write = operator._write_json_atomic

        def write_then_retarget(path: Path, value: dict, **kwargs):
            result = real_write(path, value, **kwargs)
            if path.name == operator.JOURNAL_FILE_NAME and kwargs.get("create_only") and not moved:
                moved.append(_retarget_directory(root, stage))
            return result

        monkeypatch.setattr(operator, "_write_json_atomic", write_then_retarget)
    else:
        real_install = operator._install_asset_create_only

        def install_then_retarget(item, asset_root, destination):
            result = real_install(item, asset_root, destination)
            if not moved:
                moved.append(_retarget_directory(root, stage))
            return result

        monkeypatch.setattr(operator, "_install_asset_create_only", install_then_retarget)
    with pytest.raises(operator.FullBundleMigrationError, match="identity|retargeted"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 2
    assert moved
    assert not any(root.iterdir())
    assert (moved[0] / operator.JOURNAL_FILE_NAME).is_file()
    replacement = _restore_retargeted_directory(root, moved[0])
    if stage == "after-base":
        monkeypatch.setattr(operator, "_write_json_atomic", real_write)
    else:
        monkeypatch.setattr(operator, "_install_asset_create_only", real_install)
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["committed_asset_count"] == 98
    assert not any(replacement.iterdir())


def test_asset_link_crash_retains_one_exact_nlink1_destination_for_replay(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "asset-link-crash")
    _patch_synthetic_apply(monkeypatch, env)
    spec = env["packet"]["assets"]["new"][0]
    destination = operator._asset_destination(spec, env["asset_root"].resolve())
    real_link = operator._link_unnamed_file_at
    crashed = {"value": False}

    def link_then_crash(source_fd, parent_fd, name, *, label):
        result = real_link(source_fd, parent_fd, name, label=label)
        if not crashed["value"] and name == destination.name:
            crashed["value"] = True
            raise RuntimeError("injected asset link crash")
        return result

    monkeypatch.setattr(operator, "_link_unnamed_file_at", link_then_crash)
    with pytest.raises(RuntimeError, match="injected asset link crash"):
        operator.apply_private(**_apply_args(env))
    assert crashed["value"] is True
    assert destination.is_file() and not destination.is_symlink()
    assert destination.stat().st_nlink == 1
    assert stat.S_IMODE(destination.stat().st_mode) == 0o600
    assert operator._sha256_path(destination) == spec["sha256"]
    chain = _predecessor_terminal_journal(env["asset_root"])
    entry = next(
        row
        for row in chain["document"]["destinations"]
        if row["asset_id"] == spec["asset_id"]
    )
    assert entry["ownership_state"] == "raced_exact"
    assert _draft_revision(env) == 2
    assert not env["report"].exists()


def test_postlink_foreign_replacement_survives_cleanup_and_blocks_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "postlink-replacement")
    _patch_synthetic_apply(monkeypatch, env)
    spec = env["packet"]["assets"]["new"][0]
    destination = operator._asset_destination(spec, env["asset_root"].resolve())
    foreign = b"foreign-postlink-replacement"
    real_link = operator._link_unnamed_file_at
    raced = {"value": False}

    def racing_link(source_fd, parent_fd, name, *, label):
        result = real_link(source_fd, parent_fd, name, label=label)
        if not raced["value"] and name == destination.name:
            raced["value"] = True
            os.unlink(name, dir_fd=parent_fd)
            descriptor = os.open(
                name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
                dir_fd=parent_fd,
            )
            try:
                os.write(descriptor, foreign)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return result

    monkeypatch.setattr(operator, "_link_unnamed_file_at", racing_link)
    with pytest.raises(
        operator.FullBundleMigrationError,
        match="installation was not confirmed|preserved|retargeted|identity or bytes changed",
    ):
        operator.apply_private(**_apply_args(env))
    assert raced["value"] is True
    assert destination.read_bytes() == foreign
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    journal_path = env["asset_root"] / operator.JOURNAL_FILE_NAME
    chain = operator._load_journal_chain(journal_path.resolve())
    assert chain is not None
    journal = chain["document"]
    entry = next(
        row for row in journal["destinations"] if row["asset_id"] == spec["asset_id"]
    )
    assert entry["ownership_state"] == "external_collision"


def test_rollback_postcheck_foreign_replacement_is_preserved_and_journaled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "rollback-replacement")
    spec = env["packet"]["assets"]["new"][-1]
    destination = operator._asset_destination(spec, env["asset_root"].resolve())
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_root = (
        env["narration_root"]
        if spec["source_root"] == "accepted_remaining_narration_root"
        else env["artwork_root"]
    )
    destination.write_bytes((source_root / spec["source_relative_path"]).read_bytes())
    destination.chmod(0o600)
    info = destination.lstat()
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
        database_inode_identity_sha256=operator._filesystem_identity_sha256(
            operator._inode_identity(env["database"])
        ),
    )
    entry = next(
        row for row in journal["destinations"] if row["asset_id"] == spec["asset_id"]
    )
    # The base sees the exact file as preexisting; model an already-promoted
    # owned row as the only permitted semantic delta from an unclaimed base.
    entry["existed_before"] = False
    entry["ownership_state"] = "unclaimed"
    entry["preexisting_st_dev"] = None
    entry["preexisting_st_ino"] = None
    journal_path = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    operator._write_json_atomic(journal_path, journal, create_only=True)
    prior = copy.deepcopy(journal)
    entry["ownership_state"] = "operator_created"
    entry["operator_created_st_dev"] = int(info.st_dev)
    entry["operator_created_st_ino"] = int(info.st_ino)
    operator._write_json_atomic(
        journal_path,
        journal,
        create_only=False,
        expected_prior=prior,
    )

    foreign = b"foreign-rollback-postcheck-replacement"
    real_reference_count = operator._storage_reference_count
    raced = {"value": False}
    held_descriptors: list[int] = []

    def racing_reference_count(connection, path):
        count = real_reference_count(connection, path)
        if path == destination and not raced["value"]:
            raced["value"] = True
            # Keep the prior inode alive so the filesystem cannot immediately
            # reuse its identity for the foreign replacement.
            held_descriptors.append(os.open(destination, os.O_RDONLY))
            destination.unlink()
            destination.write_bytes(foreign)
            destination.chmod(0o600)
        return count

    monkeypatch.setattr(operator, "_storage_reference_count", racing_reference_count)
    connection = operator._connect(env["database"])
    try:
        connection.execute("BEGIN IMMEDIATE")
        with pytest.raises(
            operator.FullBundleMigrationError, match="preserved a destination replacement"
        ):
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
        for descriptor in held_descriptors:
            os.close(descriptor)
    assert raced["value"] is True
    assert destination.read_bytes() == foreign
    chain = operator._load_journal_chain(journal_path)
    assert chain is not None
    current = next(
        row
        for row in chain["document"]["destinations"]
        if row["asset_id"] == spec["asset_id"]
    )
    assert current["ownership_state"] == "external_collision"
    assert _draft_revision(env) == 2
    assert not env["report"].exists()


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
    with pytest.raises(operator.FullBundleMigrationError, match="journal|immutable"):
        operator.apply_private(**_apply_args(env))
    assert raced["value"] is True
    assert journal_path.read_bytes() == foreign
    assert _draft_revision(env) == 3
    assert not env["report"].exists()


@pytest.mark.parametrize("name", [operator.JOURNAL_FILE_NAME, "receipt.json"])
def _obsolete_atomic_create_only_output_race_never_overwrites(
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


@pytest.mark.parametrize(
    "operation",
    ["create_retry", "quarantine_retry", "mutable_transition", "retire"],
)
def _obsolete_interrupted_create_only_pair_is_narrowly_recovered(
    tmp_path: Path, operation: str
) -> None:
    output = (tmp_path / "operator-document.json").resolve()
    prior = {"state": "planned", "value": 1}
    temporary = _interrupted_create_only_pair(output, _pretty_json_bytes(prior))
    if operation == "quarantine_retry":
        quarantined = temporary.with_suffix(".retire")
        temporary.rename(quarantined)
        temporary = quarantined
    if operation == "create_retry":
        operator._write_json_atomic(output, prior, create_only=True)
        assert json.loads(output.read_text(encoding="utf-8")) == prior
    elif operation == "quarantine_retry":
        operator._write_json_atomic(output, prior, create_only=True)
        assert json.loads(output.read_text(encoding="utf-8")) == prior
    elif operation == "mutable_transition":
        updated = {"state": "files_promoted", "value": 2}
        operator._write_json_atomic(
            output,
            updated,
            create_only=False,
            expected_prior=prior,
        )
        assert json.loads(output.read_text(encoding="utf-8")) == updated
    else:
        operator._retire_json_document(output, prior, label="migration journal")
        assert not output.exists()
    assert not temporary.exists()
    if output.exists():
        assert output.stat().st_nlink == 1


@pytest.mark.parametrize(
    "ambiguity",
    ["wrong_payload", "foreign_name", "extra_link", "extra_temp"],
)
def _obsolete_interrupted_create_only_recovery_preserves_ambiguous_links(
    tmp_path: Path, ambiguity: str
) -> None:
    output = (tmp_path / "operator-document.json").resolve()
    expected = {"state": "planned"}
    expected_payload = _pretty_json_bytes(expected)
    if ambiguity == "wrong_payload":
        temporary = _interrupted_create_only_pair(
            output, _pretty_json_bytes({"state": "foreign"})
        )
        preserved = [output, temporary]
    elif ambiguity == "foreign_name":
        temporary = tmp_path / "foreign-hardlink"
        descriptor = os.open(
            temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
        )
        try:
            os.write(descriptor, expected_payload)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.link(temporary, output)
        preserved = [output, temporary]
    else:
        temporary = _interrupted_create_only_pair(output, expected_payload)
        if ambiguity == "extra_link":
            extra = tmp_path / "unaccounted-hardlink"
            os.link(output, extra)
        else:
            extra = tmp_path / f".{output.name}.{'b' * 32}.tmp"
            descriptor = os.open(
                extra, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
            )
            try:
                os.write(descriptor, expected_payload)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        preserved = [output, temporary, extra]
    identities = {path: (path.stat().st_dev, path.stat().st_ino) for path in preserved}
    with pytest.raises(operator.FullBundleMigrationError, match="unsafe|ambiguous|foreign|differs"):
        operator._write_json_atomic(output, expected, create_only=True)
    assert all(path.exists() for path in preserved)
    assert {
        path: (path.stat().st_dev, path.stat().st_ino) for path in preserved
    } == identities


def _obsolete_interrupted_create_only_repair_detects_parent_retarget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    parent = tmp_path / "recovery-parent"
    parent.mkdir()
    moved = tmp_path / "recovery-parent-moved"
    output = (parent / "receipt.json").resolve()
    value = {"state": "database_committed"}
    temporary = _interrupted_create_only_pair(output, _pretty_json_bytes(value))
    real_unlink = operator.os.unlink
    raced = {"value": False}

    def retarget_after_temp_unlink(path, *args, **kwargs):
        result = real_unlink(path, *args, **kwargs)
        if str(path).endswith(".retire") and not raced["value"]:
            raced["value"] = True
            parent.rename(moved)
            parent.mkdir()
        return result

    monkeypatch.setattr(operator.os, "unlink", retarget_after_temp_unlink)
    with pytest.raises(operator.ReportCommitUncertainError, match="parent retargeted"):
        operator._write_json_atomic(output, value, create_only=True)
    assert raced["value"] is True
    assert not output.exists()
    assert (moved / output.name).is_file()
    assert (moved / output.name).stat().st_nlink == 1


def _obsolete_interrupted_temp_swap_is_quarantined_restored_and_never_deleted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = (tmp_path / "receipt.json").resolve()
    value = {"state": "database_committed"}
    temporary = _interrupted_create_only_pair(output, _pretty_json_bytes(value))
    foreign = b'{"foreign":"temp-swap"}\n'
    real_rename = operator._rename_noreplace_at
    raced = {"value": False}

    def swap_before_quarantine(
        parent_descriptor: int,
        source_name: str,
        destination_name: str,
        *,
        label: str,
    ) -> None:
        if source_name == temporary.name and not raced["value"]:
            raced["value"] = True
            os.unlink(source_name, dir_fd=parent_descriptor)
            descriptor = os.open(
                source_name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
                dir_fd=parent_descriptor,
            )
            try:
                os.write(descriptor, foreign)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        real_rename(
            parent_descriptor,
            source_name,
            destination_name,
            label=label,
        )

    monkeypatch.setattr(operator, "_rename_noreplace_at", swap_before_quarantine)
    with pytest.raises(operator.FullBundleMigrationError, match="foreign temp"):
        operator._write_json_atomic(output, value, create_only=True)
    assert raced["value"] is True
    assert output.read_bytes() == _pretty_json_bytes(value)
    assert output.stat().st_nlink == 1
    assert temporary.read_bytes() == foreign
    assert temporary.stat().st_nlink == 1
    assert not list(tmp_path.glob(f".{output.name}.*.retire"))


@pytest.mark.parametrize("operation", ["write", "retire"])
def _obsolete_anchored_repair_never_follows_parent_replacement(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    parent = tmp_path / f"anchored-{operation}"
    parent.mkdir()
    moved = tmp_path / f"anchored-{operation}-moved"
    output = (parent / "document.json").resolve()
    value = {"state": "planned"}
    original_temporary = _interrupted_create_only_pair(
        output, _pretty_json_bytes(value), token="a" * 32
    )
    real_repair = operator._repair_interrupted_create_only_output_at
    replacement: dict[str, Path] = {}
    raced = {"value": False}

    def retarget_before_anchored_repair(path: Path, **kwargs) -> bool:
        if not raced["value"]:
            raced["value"] = True
            parent.rename(moved)
            parent.mkdir()
            replacement_output = parent / output.name
            replacement_temp = _interrupted_create_only_pair(
                replacement_output,
                b'{"replacement":true}\n',
                token="b" * 32,
            )
            replacement["output"] = replacement_output
            replacement["temporary"] = replacement_temp
        return real_repair(path, **kwargs)

    monkeypatch.setattr(
        operator,
        "_repair_interrupted_create_only_output_at",
        retarget_before_anchored_repair,
    )
    with pytest.raises(operator.FullBundleMigrationError, match="parent identity changed"):
        if operation == "write":
            operator._write_json_atomic(output, value, create_only=True)
        else:
            operator._retire_json_document(output, value, label="migration journal")
    assert raced["value"] is True
    assert replacement["output"].read_bytes() == b'{"replacement":true}\n'
    assert replacement["temporary"].read_bytes() == b'{"replacement":true}\n'
    assert (moved / output.name).read_bytes() == _pretty_json_bytes(value)
    assert (moved / original_temporary.name).read_bytes() == _pretty_json_bytes(value)


def _obsolete_receipt_preflight_never_follows_replaced_parent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "receipt-parent-replaced")
    _patch_synthetic_apply(monkeypatch, env)
    report_parent = tmp_path / "receipt-parent"
    report_parent.mkdir()
    env["report"] = report_parent / "receipt.json"
    original_temp = _interrupted_create_only_pair(
        env["report"], b'{"packet_sha256":"placeholder"}\n', token="a" * 32
    )
    moved = tmp_path / "receipt-parent-moved"
    replacement: dict[str, Path] = {}
    real_repair = operator._repair_interrupted_create_only_output
    raced = {"value": False}

    def retarget_before_standalone_repair(path: Path, **kwargs) -> bool:
        if not raced["value"]:
            raced["value"] = True
            report_parent.rename(moved)
            report_parent.mkdir()
            replacement_output = report_parent / env["report"].name
            replacement_temp = _interrupted_create_only_pair(
                replacement_output,
                b'{"replacement":true}\n',
                token="b" * 32,
            )
            replacement["output"] = replacement_output
            replacement["temporary"] = replacement_temp
        return real_repair(path, **kwargs)

    monkeypatch.setattr(
        operator,
        "_repair_interrupted_create_only_output",
        retarget_before_standalone_repair,
    )
    with pytest.raises(operator.FullBundleMigrationError, match="parent identity changed"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 2
    assert replacement["output"].read_bytes() == b'{"replacement":true}\n'
    assert replacement["temporary"].read_bytes() == b'{"replacement":true}\n'
    assert (moved / env["report"].name).read_bytes() == b'{"packet_sha256":"placeholder"}\n'
    assert (moved / original_temp.name).is_file()


def test_atomic_output_detects_parent_retarget_after_link(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    parent = tmp_path / "output-parent"
    parent.mkdir()
    moved = tmp_path / "output-parent-moved"
    output = (parent / "receipt.json").resolve()
    real_link = operator._link_unnamed_file_at
    retargeted = {"value": False}

    def retarget_after_link(source, parent_fd, destination, *, label):
        result = real_link(source, parent_fd, destination, label=label)
        if destination == output.name and not retargeted["value"]:
            retargeted["value"] = True
            parent.rename(moved)
            parent.mkdir()
        return result

    monkeypatch.setattr(operator, "_link_unnamed_file_at", retarget_after_link)
    with pytest.raises(operator.FullBundleMigrationError, match="parent identity changed"):
        operator._write_json_atomic(output, {"operator": True}, create_only=True)
    assert retargeted["value"] is True
    assert not output.exists()
    assert (moved / output.name).is_file()
    assert (moved / output.name).stat().st_nlink == 1
    assert list(parent.iterdir()) == []


def test_anonymous_create_only_link_crash_leaves_one_exact_replayable_name(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = (tmp_path / "receipt.json").resolve()
    value = {"state": "database_committed", "exact": True}
    real_link = operator._link_unnamed_file_at
    crashed = {"value": False}

    class SimulatedPowerLoss(BaseException):
        pass

    def crash_after_link(source, parent_fd, destination, *, label):
        method = real_link(source, parent_fd, destination, label=label)
        if destination == output.name and not crashed["value"]:
            crashed["value"] = True
            raise SimulatedPowerLoss
        return method

    monkeypatch.setattr(operator, "_link_unnamed_file_at", crash_after_link)
    with pytest.raises(SimulatedPowerLoss):
        operator._write_json_atomic(output, value, create_only=True)
    first_identity = (output.stat().st_dev, output.stat().st_ino)
    assert output.read_bytes() == _pretty_json_bytes(value)
    assert output.stat().st_nlink == 1
    assert not list(tmp_path.glob("*.tmp"))
    assert not list(tmp_path.glob("*.retire"))

    monkeypatch.setattr(operator, "_link_unnamed_file_at", real_link)
    operator._write_json_atomic(output, value, create_only=True)
    assert (output.stat().st_dev, output.stat().st_ino) == first_identity
    assert output.stat().st_nlink == 1


def test_append_only_journal_transition_link_crash_replays_without_replace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "transition-link-crash")
    journal = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    planned = _valid_journal_document(env)
    promoted = copy.deepcopy(planned)
    promoted["state"] = "files_promoted"
    operator._write_json_atomic(journal, planned, create_only=True)
    real_link = operator._link_unnamed_file_at
    crashed = {"value": False}

    class SimulatedPowerLoss(BaseException):
        pass

    def crash_after_transition(source, parent_fd, destination, *, label):
        method = real_link(source, parent_fd, destination, label=label)
        if ".transition-" in destination and not crashed["value"]:
            crashed["value"] = True
            raise SimulatedPowerLoss
        return method

    monkeypatch.setattr(operator, "_link_unnamed_file_at", crash_after_transition)
    with pytest.raises(SimulatedPowerLoss):
        operator._write_json_atomic(
            journal, promoted, create_only=False, expected_prior=planned
        )
    chain = operator._load_journal_chain(journal)
    assert chain is not None and chain["sequence"] == 1
    assert chain["document"] == promoted
    transition_files = list(env["asset_root"].glob(f"{operator.JOURNAL_FILE_NAME}.transition-*"))
    assert len(transition_files) == 1
    assert transition_files[0].stat().st_nlink == 1

    monkeypatch.setattr(operator, "_link_unnamed_file_at", real_link)
    operator._write_json_atomic(
        journal, promoted, create_only=False, expected_prior=promoted
    )
    replayed = operator._load_journal_chain(journal)
    assert replayed is not None and replayed["sequence"] == 1


@pytest.mark.parametrize(
    "fault", ["unknown", "gap", "branch", "hardlink", "semantic"]
)
def test_append_only_journal_chain_rejects_every_foreign_or_invalid_entry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fault: str
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"journal-chain-{fault}")
    journal = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    planned = _valid_journal_document(env)
    promoted = copy.deepcopy(planned)
    promoted["state"] = "files_promoted"
    operator._write_json_atomic(journal, planned, create_only=True)
    operator._write_json_atomic(
        journal, promoted, create_only=False, expected_prior=planned
    )
    chain = operator._load_journal_chain(journal)
    assert chain is not None
    transition = next(
        env["asset_root"].glob(f"{operator.JOURNAL_FILE_NAME}.transition-*")
    )
    preserved: list[Path] = []
    if fault == "unknown":
        extra = env["asset_root"] / f"{operator.JOURNAL_FILE_NAME}.foreign"
        extra.write_bytes(b"foreign")
        preserved.append(extra)
    elif fault == "hardlink":
        extra = tmp_path / "foreign-journal-link"
        os.link(transition, extra)
        preserved.extend((transition, extra))
    else:
        next_document = copy.deepcopy(promoted)
        if fault == "semantic":
            next_document["operator_audit_sha256"] = "0" * 64
            sequence = 2
            prior_sha = chain["head_sha256"]
        elif fault == "branch":
            next_document["state"] = "database_committed"
            sequence = 1
            prior_sha = hashlib.sha256(_pretty_json_bytes(planned)).hexdigest()
        else:
            next_document["state"] = "database_committed"
            sequence = 3
            prior_sha = chain["head_sha256"]
        payload = _pretty_json_bytes(next_document)
        extra = env["asset_root"] / (
            f"{operator.JOURNAL_FILE_NAME}.transition-{sequence:06d}-"
            f"{prior_sha}-{hashlib.sha256(payload).hexdigest()}.json"
        )
        extra.write_bytes(payload)
        extra.chmod(0o600)
        preserved.append(extra)
    identities = {
        path: (path.stat().st_dev, path.stat().st_ino, path.read_bytes())
        for path in preserved
    }
    with pytest.raises(operator.FullBundleMigrationError):
        operator._load_journal_chain(journal)
    assert all(path.exists() for path in preserved)
    assert {
        path: (path.stat().st_dev, path.stat().st_ino, path.read_bytes())
        for path in preserved
    } == identities


def test_terminal_marker_is_retained_idempotent_and_blocks_target_transition(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "terminal-chain")
    journal = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    planned = _valid_journal_document(env)
    promoted = copy.deepcopy(planned)
    promoted["state"] = "files_promoted"
    committed = copy.deepcopy(promoted)
    committed["state"] = "database_committed"
    operator._write_json_atomic(journal, planned, create_only=True)
    operator._write_json_atomic(
        journal, promoted, create_only=False, expected_prior=planned
    )
    operator._write_json_atomic(
        journal, committed, create_only=False, expected_prior=promoted
    )
    operator._retire_json_document(journal, committed, label="migration journal")
    first_binding = operator._journal_terminal_binding(journal)
    operator._retire_json_document(journal, committed, label="migration journal")
    assert operator._journal_terminal_binding(journal) == first_binding
    terminal = env["asset_root"] / first_binding["terminal_file_name"]
    assert terminal.is_file() and terminal.stat().st_nlink == 1
    with pytest.raises(operator.FullBundleMigrationError, match="committed target"):
        operator._write_json_atomic(
            journal,
            {**committed, "backup_manifest_sha256": "2" * 64},
            create_only=False,
            expected_prior=committed,
        )


def test_receipt_cumulative_binding_distinguishes_same_final_alternate_history(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "alternate-history")
    planned = _valid_journal_document(env)
    roots = [tmp_path / "history-a", tmp_path / "history-b"]
    for root in roots:
        root.mkdir()
    journals = [root / operator.JOURNAL_FILE_NAME for root in roots]
    orders = [(0, 1), (1, 0)]
    bindings: list[dict] = []
    for journal, order in zip(journals, orders, strict=True):
        current = copy.deepcopy(planned)
        operator._write_json_atomic(journal.resolve(), current, create_only=True)
        for index in order:
            prior = copy.deepcopy(current)
            current["destinations"][index]["ownership_state"] = "operator_created"
            current["destinations"][index]["operator_created_st_dev"] = 100 + index
            current["destinations"][index]["operator_created_st_ino"] = 200 + index
            operator._write_json_atomic(
                journal.resolve(), current, create_only=False, expected_prior=prior
            )
        prior = copy.deepcopy(current)
        current["state"] = "files_promoted"
        operator._write_json_atomic(
            journal.resolve(), current, create_only=False, expected_prior=prior
        )
        prior = copy.deepcopy(current)
        current["state"] = "database_committed"
        operator._write_json_atomic(
            journal.resolve(), current, create_only=False, expected_prior=prior
        )
        operator._retire_json_document(
            journal.resolve(), current, label="migration journal"
        )
        bindings.append(operator._journal_terminal_binding(journal.resolve()))
    assert bindings[0]["sequence"] == bindings[1]["sequence"]
    assert bindings[0]["head_sha256"] == bindings[1]["head_sha256"]
    assert bindings[0]["ancestry_sha256"] != bindings[1]["ancestry_sha256"]
    assert bindings[0]["closed_inventory_sha256"] != bindings[1][
        "closed_inventory_sha256"
    ]
    receipt_a = {"migration": {"journal_terminal": bindings[0]}}
    receipt_b = {"migration": {"journal_terminal": bindings[1]}}
    with pytest.raises(operator.FullBundleMigrationError, match="bindings drifted"):
        operator._validate_existing_receipt(receipt_a, receipt_b)


@pytest.mark.parametrize("fault", ["missing", "reordered"])
def test_later_terminal_commits_every_prior_terminal_boundary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fault: str
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"terminal-history-{fault}")
    journal = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    first = _valid_journal_document(env)
    operator._write_json_atomic(journal, first, create_only=True)
    operator._retire_json_document(journal, first, label="migration journal")
    first_binding = operator._journal_terminal_binding(journal)
    restarted = copy.deepcopy(first)
    restarted["backup_manifest_sha256"] = "2" * 64
    operator._write_json_atomic(
        journal, restarted, create_only=False, expected_prior=first
    )
    promoted = copy.deepcopy(restarted)
    promoted["state"] = "files_promoted"
    operator._write_json_atomic(
        journal, promoted, create_only=False, expected_prior=restarted
    )
    committed = copy.deepcopy(promoted)
    committed["state"] = "database_committed"
    operator._write_json_atomic(
        journal, committed, create_only=False, expected_prior=promoted
    )
    operator._retire_json_document(journal, committed, label="migration journal")
    final_binding = operator._journal_terminal_binding(journal)
    assert final_binding["closed_inventory_entry_count"] == 6
    prior_terminal = env["asset_root"] / first_binding["terminal_file_name"]
    original_payload = prior_terminal.read_bytes()
    if fault == "missing":
        prior_terminal.unlink()
        preserved: list[Path] = []
    else:
        reordered = prior_terminal.with_name(
            f"{operator.JOURNAL_FILE_NAME}.terminal-000001-"
            f"{hashlib.sha256(_pretty_json_bytes(restarted)).hexdigest()}.json"
        )
        prior_terminal.rename(reordered)
        preserved = [reordered]
    with pytest.raises(operator.FullBundleMigrationError):
        operator._load_journal_chain(journal)
    for path in preserved:
        assert path.read_bytes() == original_payload
        assert path.stat().st_nlink == 1


def _obsolete_journal_retirement_detects_parent_retarget_after_unlink(
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
    with pytest.raises(operator.FullBundleMigrationError, match="replace|raced|immutable"):
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
    with pytest.raises(operator.FullBundleMigrationError, match="prior|journal|immutable"):
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
        database_inode_identity_sha256=operator._filesystem_identity_sha256(
            operator._inode_identity(env["database"])
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
    destination.chmod(0o600)
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
            with pytest.raises(
                operator.FullBundleMigrationError,
                match="preserved|identity or bytes changed",
            ):
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
    real_install = operator._install_immutable_bytes_at
    raced_payload = b'{"external":"receipt-race"}\n'

    def race_receipt(path: Path, payload: bytes, *, label: str, **kwargs) -> None:
        if path == env["report"].resolve() and label == "migration receipt":
            path.write_bytes(raced_payload)
            path.chmod(0o600)
        real_install(path, payload, label=label, **kwargs)

    monkeypatch.setattr(operator, "_install_immutable_bytes_at", race_receipt)
    with pytest.raises(operator.FullBundleMigrationError, match="replace|raced|immutable"):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 3
    assert env["report"].read_bytes() == raced_payload
    journal = env["asset_root"] / operator.JOURNAL_FILE_NAME
    assert journal.is_file()

    env["report"].unlink()
    monkeypatch.setattr(operator, "_install_immutable_bytes_at", real_install)
    _refresh_backup(env, tmp_path / "target-fresh-backup")
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["committed_asset_count"] == 98
    _terminal_journal(env["asset_root"])


def test_postcommit_receipt_link_crash_recovers_receipt_and_exact_journal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "receipt-link-crash")
    _patch_synthetic_apply(monkeypatch, env)
    real_link = operator._link_unnamed_file_at
    crashed = {"value": False}

    class SimulatedPowerLoss(BaseException):
        pass

    def crash_after_receipt_link(source, parent_fd, destination, *, label):
        method = real_link(source, parent_fd, destination, label=label)
        if destination == env["report"].name and not crashed["value"]:
            crashed["value"] = True
            raise SimulatedPowerLoss
        return method

    monkeypatch.setattr(operator, "_link_unnamed_file_at", crash_after_receipt_link)
    with pytest.raises(SimulatedPowerLoss):
        operator.apply_private(**_apply_args(env))
    report = env["report"]
    journal = env["asset_root"] / operator.JOURNAL_FILE_NAME
    assert _draft_revision(env) == 3
    assert report.is_file() and report.stat().st_nlink == 1
    crashed_chain = _terminal_journal(env["asset_root"])
    assert crashed_chain["document"]["state"] == "database_committed"
    assert not list(report.parent.glob(f".{report.name}.*.tmp"))

    first_identity = (report.stat().st_dev, report.stat().st_ino)
    monkeypatch.setattr(operator, "_link_unnamed_file_at", real_link)
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["after_revision"] == 3
    assert report.stat().st_nlink == 1
    assert (report.stat().st_dev, report.stat().st_ino) == first_identity
    assert receipt["migration"]["journal_terminal"] == operator._journal_terminal_binding(
        journal.resolve()
    )


@pytest.mark.parametrize("journal_fault", ["semantic", "corrupt", "foreign_link"])
def test_existing_receipt_never_ignores_unsafe_retained_journal(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    journal_fault: str,
) -> None:
    env = _synthetic_environment(
        tmp_path, monkeypatch, f"receipt-journal-{journal_fault}"
    )
    _patch_synthetic_apply(monkeypatch, env)
    journal = env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 3
    assert env["report"].is_file()
    _terminal_journal(env["asset_root"])

    foreign: Path | None = None
    if journal_fault == "semantic":
        document = json.loads(journal.read_text(encoding="utf-8"))
        document["operator_audit_sha256"] = "0" * 64
        journal.write_bytes(_pretty_json_bytes(document))
    elif journal_fault == "corrupt":
        journal.write_bytes(b"{not-json\n")
    else:
        foreign = tmp_path / "foreign-journal-hardlink"
        os.link(journal, foreign)

    with pytest.raises(operator.FullBundleMigrationError):
        operator.apply_private(**_apply_args(env))
    assert _draft_revision(env) == 3
    assert env["report"].is_file()
    assert journal.is_file()
    if foreign is not None:
        assert foreign.is_file()
        assert foreign.stat().st_ino == journal.stat().st_ino
        assert foreign.stat().st_nlink == journal.stat().st_nlink == 2


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
    _terminal_journal(env["asset_root"])


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


def test_database_retarget_inside_final_connect_never_mutates_or_receipts_clone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "db-final-connect-retarget")
    _patch_synthetic_apply(monkeypatch, env)
    clone = tmp_path / "predecessor-clone.db"
    _semantic_database_clone(env["database"], clone)
    real_stage = operator._stage_and_promote
    real_connect = operator._connect
    armed = {"value": False}
    moved: list[Path] = []

    def stage_then_arm(*args, **kwargs):
        result = real_stage(*args, **kwargs)
        armed["value"] = True
        return result

    def retargeting_connect(path: Path, **kwargs):
        if kwargs.get("pinned_descriptor") is not None and armed["value"] and not moved:
            moved_db, _sidecars = _retarget_database_to_clone(
                env["database"], clone, "inside-connect"
            )
            moved.append(moved_db)
        return real_connect(path, **kwargs)

    monkeypatch.setattr(operator, "_stage_and_promote", stage_then_arm)
    monkeypatch.setattr(operator, "_connect", retargeting_connect)
    with pytest.raises(operator.FullBundleMigrationError, match="identity|retargeted"):
        operator.apply_private(**_apply_args(env))
    assert moved
    assert _draft_revision_at(moved[0]) == 2
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    chain = operator._load_journal_chain(
        env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    )
    assert chain is not None and chain["document"]["state"] == "files_promoted"


@pytest.mark.parametrize("stage", ["before-begin", "after-begin"])
def test_database_retarget_around_begin_rolls_back_captured_inode_and_clone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, stage: str
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, f"db-{stage}")
    _patch_synthetic_apply(monkeypatch, env)
    clone = tmp_path / f"{stage}-predecessor-clone.db"
    _semantic_database_clone(env["database"], clone)
    real_stage = operator._stage_and_promote
    real_connect = operator._connect
    armed = {"value": False}
    wrapped = {"value": False}
    moved: list[Path] = []

    class BeginProxy:
        def __init__(self, connection):
            self._connection = connection

        def __getattr__(self, name):
            return getattr(self._connection, name)

        def execute(self, sql, parameters=()):
            if str(sql).strip().upper() == "BEGIN IMMEDIATE" and not moved:
                if stage == "after-begin":
                    result = self._connection.execute(sql, parameters)
                    moved_db, _sidecars = _retarget_database_to_clone(
                        env["database"], clone, stage
                    )
                    moved.append(moved_db)
                    return result
                moved_db, _sidecars = _retarget_database_to_clone(
                    env["database"], clone, stage
                )
                moved.append(moved_db)
            return self._connection.execute(sql, parameters)

    def stage_then_arm(*args, **kwargs):
        result = real_stage(*args, **kwargs)
        armed["value"] = True
        return result

    def proxy_connect(path: Path, **kwargs):
        connection = real_connect(path, **kwargs)
        if kwargs.get("pinned_descriptor") is not None and armed["value"] and not wrapped["value"]:
            wrapped["value"] = True
            return BeginProxy(connection)
        return connection

    monkeypatch.setattr(operator, "_stage_and_promote", stage_then_arm)
    monkeypatch.setattr(operator, "_connect", proxy_connect)
    with pytest.raises(operator.FullBundleMigrationError, match="identity|retargeted"):
        operator.apply_private(**_apply_args(env))
    assert moved and wrapped["value"]
    assert _draft_revision_at(moved[0]) == 2
    assert _draft_revision(env) == 2
    assert not env["report"].exists()


def test_postcommit_database_retarget_has_no_receipt_and_replays_after_restore(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _synthetic_environment(tmp_path, monkeypatch, "db-postcommit-retarget")
    _patch_synthetic_apply(monkeypatch, env)
    clone = tmp_path / "postcommit-predecessor-clone.db"
    _semantic_database_clone(env["database"], clone)
    real_assert = operator._assert_pinned_regular_file_path
    moved: list[Path] = []
    moved_sidecars: list[Path] = []

    def retarget_after_commit(path: Path, descriptor: int, identity, **kwargs):
        if kwargs.get("label") == "configured SQLite database after commit" and not moved:
            moved_db, sidecars = _retarget_database_to_clone(
                env["database"], clone, "postcommit"
            )
            moved.append(moved_db)
            moved_sidecars.extend(sidecars)
        return real_assert(path, descriptor, identity, **kwargs)

    monkeypatch.setattr(
        operator, "_assert_pinned_regular_file_path", retarget_after_commit
    )
    with pytest.raises(operator.ReportCommitUncertainError, match="identity"):
        operator.apply_private(**_apply_args(env))
    assert moved
    assert _draft_revision_at(moved[0]) == 3
    assert _draft_revision(env) == 2
    assert not env["report"].exists()
    chain = operator._load_journal_chain(
        env["asset_root"].resolve() / operator.JOURNAL_FILE_NAME
    )
    assert chain is not None and chain["document"]["state"] == "files_promoted"
    foreign = env["database"].with_name(env["database"].name + "-foreign")
    env["database"].rename(foreign)
    moved[0].rename(env["database"])
    for sidecar in moved_sidecars:
        suffix = sidecar.name.removeprefix(moved[0].name)
        sidecar.rename(Path(str(env["database"]) + suffix))
    monkeypatch.setattr(operator, "_assert_pinned_regular_file_path", real_assert)
    receipt = operator.apply_private(**_apply_args(env))
    assert receipt["migration"]["database_inode_identity_sha256"] == (
        operator._filesystem_identity_sha256(operator._inode_identity(env["database"]))
    )


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
        "complete_private_candidate_builder": packet["source_bindings"][
            str(builder.CANDIDATE_BUILDER_PATH)
        ],
        "complete_validation_dispatcher": packet["source_bindings"][
            str(builder.COMPLETE_VALIDATION_PATH)
        ],
        "mobile_long_form_validator": packet["source_bindings"][
            str(builder.MOBILE_LONG_FORM_VALIDATOR_PATH)
        ],
        "mobile_long_form_evidence_registry": packet["source_bindings"][
            str(builder.MOBILE_LONG_FORM_EVIDENCE_REGISTRY_PATH)
        ],
        "complete_validator_source_closure": {
            key: packet["trusted_complete_validator_source_closure"][key]
            for key in ("schema_version", "framing", "path_count", "sha256")
        },
        "v3_release_guard_audit": packet[
            "v3_release_guard_independent_audit"
        ],
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
    audit["bindings"]["migration_operator"] = operator._source_binding(
        operator.OPERATOR_PATH
    )
    audit["bindings"]["complete_validator_source_closure"] = {
        **bindings["complete_validator_source_closure"],
        "sha256": "0" * 64,
    }
    path.write_text(json.dumps(audit), encoding="utf-8")
    with pytest.raises(operator.FullBundleMigrationError, match="bindings drifted"):
        operator._validate_operator_audit(path.resolve(), packet, contract, packet_sha)
    drifted_contract = copy.deepcopy(contract)
    drifted_contract["complete_validator_source_closure"]["path_count"] -= 1
    with pytest.raises(
        operator.FullBundleMigrationError,
        match="complete trusted-validator source closure drifted",
    ):
        operator._validate_operator_audit(
            path.resolve(), packet, drifted_contract, packet_sha
        )


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
