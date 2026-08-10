#!/usr/bin/env python3
"""Import the exact Roaring Fork packet into a private draft fail-closed.

The command is dry-run by default. Apply mode requires an explicitly configured
database, asset root, target id, and real admin id. Narration provenance remains
unverified until the authenticated server-owned license-attestation endpoint is
used later. This command has no publish, deployment, validation-run,
preview-token, license-attestation, or TTS code path.
"""

from __future__ import annotations

import argparse
import binascii
import copy
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import struct
import sys
import uuid
import zlib
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from PIL import Image  # noqa: E402

from db.store import (  # noqa: E402
    _probe_original_asset_file,
    _validate_trip_pack_fields,
    reconcile_original_generator_license_metadata,
)
from scripts import build_smokies_roaring_fork_private_packet as packet_builder  # noqa: E402


PACKET_PATH = packet_builder.PACKET_PATH
MANIFEST_PATH = packet_builder.MANIFEST_PATH
AUTHORIZATION_PATH = packet_builder.AUTHORIZATION_PATH
APPLY_SENTINEL = "IMPORT_PRIVATE_ROARING_FORK_DRAFT"
TARGET_ID_ENV = "TRAILHEAD_PRIVATE_IMPORT_TARGET_ID"
DB_PATH_ENV = "TRAILHEAD_DB_PATH"
ASSET_ROOT_ENV = "TRAILHEAD_ORIGINALS_ASSET_DIR"
LOCK_FILE_NAME = ".roaring-fork-private-import.lock"
JOURNAL_FILE_NAME = ".roaring-fork-private-import-journal-v1.json"
ALLOWED_PNG_CHUNKS = {"IHDR", "IDAT", "IEND"}
PROTECTED_FILES = {
    ROOT / "dashboard/explore_serving_index_v2.json": (
        "c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869"
    ),
    ROOT / "docs/app-store-copy.md": (
        "126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a"
    ),
}


class PrivateImportError(ValueError):
    """A fail-closed private import requirement was not satisfied."""


class ReportCommitUncertainError(PrivateImportError):
    """The final report was replaced but its directory sync was not confirmed."""


@dataclass(frozen=True)
class PreparedAsset:
    spec: dict[str, Any]
    source_path: Path
    media_metadata: dict[str, Any]


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PrivateImportError(f"cannot read {path}") from exc
    if not isinstance(value, dict):
        raise PrivateImportError(f"{path.name} must contain an object")
    return value


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _assert_regular_contained(path: Path, root: Path, label: str) -> Path:
    try:
        info = path.lstat()
    except OSError as exc:
        raise PrivateImportError(f"{label} is unavailable: {path}") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise PrivateImportError(f"{label} must be a regular non-symlink file")
    resolved_root = root.resolve(strict=True)
    resolved = path.resolve(strict=True)
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise PrivateImportError(f"{label} escapes its approved evidence root")
    return resolved


def _inspect_png(path: Path, spec: dict[str, Any]) -> dict[str, Any]:
    chunk_types: list[str] = []
    with path.open("rb") as handle:
        if handle.read(8) != b"\x89PNG\r\n\x1a\n":
            raise PrivateImportError(f"approved artwork has an invalid PNG signature: {path.name}")
        while True:
            header = handle.read(8)
            if len(header) != 8:
                raise PrivateImportError(f"approved artwork PNG is truncated: {path.name}")
            length = struct.unpack(">I", header[:4])[0]
            raw_type = header[4:]
            payload = handle.read(length)
            crc_bytes = handle.read(4)
            if len(payload) != length or len(crc_bytes) != 4:
                raise PrivateImportError(f"approved artwork PNG is truncated: {path.name}")
            recorded_crc = struct.unpack(">I", crc_bytes)[0]
            if binascii.crc32(raw_type + payload) & 0xFFFFFFFF != recorded_crc:
                raise PrivateImportError(f"approved artwork PNG CRC failed: {path.name}")
            try:
                chunk_type = raw_type.decode("ascii")
            except UnicodeDecodeError as exc:
                raise PrivateImportError(f"approved artwork PNG chunk is invalid: {path.name}") from exc
            chunk_types.append(chunk_type)
            if chunk_type == "IEND":
                if handle.read(1):
                    raise PrivateImportError(f"approved artwork PNG has trailing bytes: {path.name}")
                break
    if not chunk_types or chunk_types[0] != "IHDR" or set(chunk_types) != ALLOWED_PNG_CHUNKS:
        raise PrivateImportError(f"approved artwork PNG metadata policy failed: {path.name}")

    try:
        with Image.open(path) as image:
            image.load()
            if image.format != "PNG" or image.mode != "RGB":
                raise PrivateImportError(f"approved artwork format drifted: {path.name}")
            expected = spec["media"]
            if image.size != (int(expected["width"]), int(expected["height"])):
                raise PrivateImportError(f"approved artwork dimensions drifted: {path.name}")
            if image.info or len(image.getexif()) != 0:
                raise PrivateImportError(f"approved artwork contains forbidden metadata: {path.name}")
            pixel_sha256 = hashlib.sha256(image.tobytes()).hexdigest()
    except PrivateImportError:
        raise
    except (OSError, SyntaxError, zlib.error) as exc:
        raise PrivateImportError(f"approved artwork cannot be decoded: {path.name}") from exc
    if pixel_sha256 != spec["decoded_pixel_sha256"]:
        raise PrivateImportError(f"approved artwork pixels drifted: {path.name}")
    return {
        "format": "png",
        "width": int(spec["media"]["width"]),
        "height": int(spec["media"]["height"]),
    }


def _source_for(spec: dict[str, Any]) -> tuple[Path, Path]:
    if spec["source_root"] == "accepted_narration_output":
        root = packet_builder.OUTPUT_ROOT
    elif spec["source_root"] == "approved_artwork_derivatives":
        root = packet_builder.ARTWORK_ROOT
    else:
        raise PrivateImportError("packet references an unapproved evidence root")
    return root / str(spec["source_relative_path"]), root


def _prepare_asset(spec: dict[str, Any]) -> PreparedAsset:
    source, root = _source_for(spec)
    source = _assert_regular_contained(source, root, f"asset {spec['asset_id']}")
    if source.name != spec["file_name"]:
        raise PrivateImportError(f"asset file identity drifted: {spec['asset_id']}")
    if source.stat().st_size != int(spec["bytes"]):
        raise PrivateImportError(f"asset byte count drifted: {spec['asset_id']}")
    if _sha256_file(source) != spec["sha256"]:
        raise PrivateImportError(f"asset hash drifted: {spec['asset_id']}")

    if spec["kind"] == "narration":
        media = _probe_original_asset_file(source, "narration", "audio/mpeg")
        expected = spec["media"]
        for field in ("format", "sample_rate_hz", "bitrate_kbps", "channels"):
            if media.get(field) != expected[field]:
                raise PrivateImportError(f"narration {field} drifted: {spec['asset_id']}")
        if abs(float(media["duration_s"]) - float(expected["duration_s"])) > 0.01:
            raise PrivateImportError(f"narration duration drifted: {spec['asset_id']}")
    elif spec["kind"] == "image":
        media = _inspect_png(source, spec)
    else:
        raise PrivateImportError("the bounded packet may contain narration and images only")
    return PreparedAsset(spec=copy.deepcopy(spec), source_path=source, media_metadata=media)


def _assert_exact_packet() -> tuple[dict[str, Any], dict[str, Any], list[PreparedAsset]]:
    expected_authorization, expected_manifest, expected_packet = packet_builder.build_bundle(
        require_local_evidence=True
    )
    actual_authorization = _read_json(AUTHORIZATION_PATH)
    actual_manifest = _read_json(MANIFEST_PATH)
    actual_packet = _read_json(PACKET_PATH)
    if actual_authorization != expected_authorization:
        raise PrivateImportError("private ingestion authorization is stale")
    if actual_manifest != expected_manifest:
        raise PrivateImportError("private Manifest V3 is stale")
    if actual_packet != expected_packet:
        raise PrivateImportError("private import packet is stale")
    assets = actual_packet.get("assets")
    if not isinstance(assets, list) or len(assets) != 20:
        raise PrivateImportError("private packet must contain exactly twenty assets")
    if len({item.get("asset_id") for item in assets}) != 20:
        raise PrivateImportError("private packet asset ids must be unique")
    if sum(item.get("kind") == "narration" for item in assets) != 13:
        raise PrivateImportError("private packet must contain thirteen narrations")
    if sum(item.get("kind") == "image" for item in assets) != 7:
        raise PrivateImportError("private packet must contain seven images")
    prepared = [_prepare_asset(item) for item in assets]
    return actual_packet, actual_manifest, prepared


def _generator_metadata() -> dict[str, Any]:
    """Preserve exact provenance without manufacturing a license attestation."""
    return {
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


def _clean_draft(
    packet: dict[str, Any],
    manifest: dict[str, Any],
) -> dict[str, Any]:
    draft = copy.deepcopy(packet["draft"])
    return _validate_trip_pack_fields(
        packet_builder.PACK_ID,
        draft["slug"],
        draft["title"],
        draft["summary"],
        int(draft["price_credits"]),
        draft["coverage_region"],
        draft["public_metadata"],
        draft["validation_metadata"],
        draft["template"],
        "original_drive",
        copy.deepcopy(manifest),
    )


def _connect(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(db_path), timeout=30.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def _preflight_database_target(db_path: Path, admin_user_id: int) -> None:
    required_columns = {
        "users": {"id", "is_admin"},
        "authored_trip_packs": {
            "id", "content_kind", "slug", "status", "draft_title", "draft_summary",
            "draft_price_credits", "draft_coverage_region", "draft_public_metadata",
            "draft_validation_metadata", "draft_template_json",
            "draft_original_manifest_json", "draft_revision", "created_by", "updated_by",
            "created_at", "updated_at",
        },
        "authored_original_assets": {
            "pack_id", "asset_id", "sha256", "kind", "mime_type", "byte_count",
            "public_path", "storage_path", "media_metadata_json", "transcript_sha256",
            "generator_metadata_json", "is_current", "uploaded_by", "created_at",
            "updated_at",
        },
        "authored_trip_pack_versions": {"pack_id"},
    }
    connection = _connect(db_path)
    try:
        tables = {
            row["name"] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if not set(required_columns).issubset(tables):
            raise PrivateImportError("target database is not an initialized Trailhead database")
        for table, expected in required_columns.items():
            actual = {
                row["name"] for row in connection.execute(
                    f'PRAGMA table_info("{table}")'
                ).fetchall()
            }
            if not expected.issubset(actual):
                raise PrivateImportError(f"target database schema is stale: {table}")
        admin = connection.execute(
            "SELECT id,is_admin FROM users WHERE id=?", (admin_user_id,)
        ).fetchone()
        if not admin or not bool(admin["is_admin"]):
            raise PrivateImportError("private import requires a real target admin user")
    finally:
        connection.close()


def _assert_target_path(path: Path, label: str, *, must_exist: bool) -> Path:
    if not path.is_absolute():
        raise PrivateImportError(f"{label} must be an explicit absolute path")
    if path.exists() and path.is_symlink():
        raise PrivateImportError(f"{label} cannot be a symlink")
    resolved = path.resolve(strict=must_exist)
    if resolved == Path(resolved.anchor):
        raise PrivateImportError(f"{label} cannot be a filesystem root")
    if must_exist and (resolved.is_symlink() or not resolved.is_file()):
        raise PrivateImportError(f"{label} must be an existing regular file")
    if not must_exist and resolved.exists() and not resolved.is_dir():
        raise PrivateImportError(f"{label} must be a directory")
    return resolved


def _verify_protected_files() -> dict[str, str]:
    protected: dict[str, str] = {}
    for path, expected in PROTECTED_FILES.items():
        actual = _sha256_file(path)
        label = (
            path.relative_to(ROOT).as_posix()
            if path.is_relative_to(ROOT)
            else str(path)
        )
        if actual != expected:
            raise PrivateImportError(f"protected file drifted: {label}")
        protected[label] = actual
    return protected


def _configured_target(
    db_path: Path,
    asset_root: Path,
    target_id: str,
    *,
    allow_isolated: bool,
) -> dict[str, Any]:
    clean_target_id = str(target_id or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{3,120}", clean_target_id):
        raise PrivateImportError("private import target id is invalid")
    if allow_isolated:
        return {
            "id": clean_target_id,
            "classification": "isolated_test",
            "configured": False,
        }
    configured_db = os.environ.get(DB_PATH_ENV, "").strip()
    configured_assets = os.environ.get(ASSET_ROOT_ENV, "").strip()
    configured_target_id = os.environ.get(TARGET_ID_ENV, "").strip()
    if not configured_db or not configured_assets or not configured_target_id:
        raise PrivateImportError(
            "apply requires explicitly configured database, asset root, and target id"
        )
    if Path(configured_db).resolve(strict=True) != db_path:
        raise PrivateImportError("database path does not match the configured target")
    if Path(configured_assets).resolve(strict=False) != asset_root:
        raise PrivateImportError("asset root does not match the configured target")
    if configured_target_id != clean_target_id:
        raise PrivateImportError("target id does not match the configured target")
    return {
        "id": clean_target_id,
        "classification": "configured_private",
        "configured": True,
    }


def _assert_report_path_safe(
    report_path: Path,
    *,
    db_path: Path,
    asset_root: Path,
    prepared: list[PreparedAsset],
) -> Path:
    if not report_path.is_absolute():
        raise PrivateImportError("report path must be absolute")
    resolved = report_path.resolve(strict=False)
    if resolved == Path(resolved.anchor):
        raise PrivateImportError("report path cannot be a filesystem root")
    if resolved == db_path:
        raise PrivateImportError("report path cannot overwrite the database")
    if resolved == asset_root or asset_root in resolved.parents:
        raise PrivateImportError("report path cannot be inside the asset root")
    reserved = {
        PACKET_PATH.resolve(),
        MANIFEST_PATH.resolve(),
        AUTHORIZATION_PATH.resolve(),
        *(path.resolve() for path in PROTECTED_FILES),
        *(path.resolve() for path in packet_builder.SOURCE_PATHS.values()),
        *(item.source_path.resolve() for item in prepared),
    }
    if resolved in reserved:
        raise PrivateImportError("report path collides with protected packet evidence")
    if resolved.exists() and (resolved.is_symlink() or not resolved.is_file()):
        raise PrivateImportError("existing report path must be a regular non-symlink file")
    return resolved


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            handle.write(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def _exclusive_import_lock(asset_root: Path):
    lock_path = asset_root / LOCK_FILE_NAME
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    handle = os.fdopen(descriptor, "a+", encoding="utf-8")
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise PrivateImportError("another Roaring Fork private import is active") from exc
        yield lock_path
    finally:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def _destination_for(item: PreparedAsset, asset_root: Path) -> Path:
    suffix = ".mp3" if item.spec["kind"] == "narration" else ".png"
    destination = (
        asset_root
        / packet_builder.PACK_ID
        / str(item.spec["asset_id"])
        / f"{item.spec['sha256']}{suffix}"
    ).resolve(strict=False)
    if asset_root not in destination.parents:
        raise PrivateImportError("content-addressed destination escapes the asset root")
    return destination


def _journal_document(
    *,
    db_path: Path,
    asset_root: Path,
    target_id: str,
    prepared: list[PreparedAsset],
) -> dict[str, Any]:
    destinations = []
    for item in prepared:
        destination = _destination_for(item, asset_root)
        existed_before = destination.exists()
        if existed_before:
            if destination.is_symlink() or not destination.is_file():
                raise PrivateImportError(f"asset destination is unsafe: {item.spec['asset_id']}")
            if (
                destination.stat().st_size != int(item.spec["bytes"])
                or _sha256_file(destination) != item.spec["sha256"]
            ):
                raise PrivateImportError(
                    f"content-addressed destination is corrupt: {item.spec['asset_id']}"
                )
        destinations.append({
            "asset_id": item.spec["asset_id"],
            "path": str(destination),
            "sha256": item.spec["sha256"],
            "bytes": int(item.spec["bytes"]),
            "existed_before": existed_before,
        })
    return {
        "schema_version": 1,
        "packet_id": packet_builder.PACKET_ID,
        "packet_sha256": _sha256_file(PACKET_PATH),
        "target_id": target_id,
        "database_path": str(db_path),
        "asset_root": str(asset_root),
        "state": "planned",
        "destinations": destinations,
    }


def _storage_reference_count(db_path: Path, destination: Path) -> int:
    connection = _connect(db_path)
    try:
        return int(connection.execute(
            "SELECT COUNT(*) AS count FROM authored_original_assets WHERE storage_path=?",
            (str(destination),),
        ).fetchone()["count"])
    finally:
        connection.close()


def _remove_unreferenced_created(
    db_path: Path,
    destinations: list[dict[str, Any]],
) -> None:
    for entry in reversed(destinations):
        if bool(entry["existed_before"]):
            continue
        path = Path(str(entry["path"]))
        if not path.exists():
            continue
        if path.is_symlink() or not path.is_file():
            raise PrivateImportError("rollback found an unsafe asset destination")
        if (
            path.stat().st_size != int(entry["bytes"])
            or _sha256_file(path) != entry["sha256"]
        ):
            raise PrivateImportError("rollback refused to delete drifted asset bytes")
        if _storage_reference_count(db_path, path) == 0:
            path.unlink()


def _recover_interrupted_import(
    *,
    journal_path: Path,
    db_path: Path,
    asset_root: Path,
    target_id: str,
    prepared: list[PreparedAsset],
) -> bool:
    if not journal_path.exists():
        return False
    if journal_path.is_symlink() or not journal_path.is_file():
        raise PrivateImportError("private import recovery journal is unsafe")
    journal = _read_json(journal_path)
    expected = _journal_document(
        db_path=db_path,
        asset_root=asset_root,
        target_id=target_id,
        prepared=prepared,
    )
    for key in (
        "schema_version",
        "packet_id",
        "packet_sha256",
        "target_id",
        "database_path",
        "asset_root",
    ):
        if journal.get(key) != expected[key]:
            raise PrivateImportError("private import recovery journal target drifted")
    actual_destinations = journal.get("destinations")
    if not isinstance(actual_destinations, list):
        raise PrivateImportError("private import recovery journal is malformed")
    expected_by_id = {item["asset_id"]: item for item in expected["destinations"]}
    if {item.get("asset_id") for item in actual_destinations} != set(expected_by_id):
        raise PrivateImportError("private import recovery journal asset set drifted")
    for entry in actual_destinations:
        planned = expected_by_id[entry["asset_id"]]
        for key in ("path", "sha256", "bytes"):
            if entry.get(key) != planned[key]:
                raise PrivateImportError("private import recovery journal asset drifted")
        if not isinstance(entry.get("existed_before"), bool):
            raise PrivateImportError("private import recovery journal is malformed")
    _remove_unreferenced_created(db_path, actual_destinations)
    journal_path.unlink()
    _fsync_directory(journal_path.parent)
    return True


def _stage_assets(
    prepared: list[PreparedAsset], asset_root: Path
) -> tuple[Path, list[tuple[PreparedAsset, Path]], list[Path]]:
    asset_root.mkdir(parents=True, exist_ok=True)
    asset_root = asset_root.resolve(strict=True)
    if asset_root.is_symlink() or not asset_root.is_dir():
        raise PrivateImportError("private asset root must be a real directory")
    required = sum(item.spec["bytes"] for item in prepared) + 128 * 1024 * 1024
    if shutil.disk_usage(asset_root).free < required:
        raise PrivateImportError("private asset root does not have enough staging space")
    staging = asset_root / f".roaring-fork-private-staging-{uuid.uuid4().hex}"
    staging.mkdir(mode=0o700)
    staged: list[tuple[PreparedAsset, Path]] = []
    created_destinations: list[Path] = []
    try:
        for item in prepared:
            target = staging / item.spec["file_name"]
            shutil.copyfile(item.source_path, target)
            with target.open("rb") as handle:
                os.fsync(handle.fileno())
            if target.stat().st_size != item.spec["bytes"] or _sha256_file(target) != item.spec["sha256"]:
                raise PrivateImportError(f"staged asset verification failed: {item.spec['asset_id']}")
            staged.append((item, target))

        for item, staged_path in staged:
            destination = _destination_for(item, asset_root)
            destination_dir = destination.parent
            destination_dir.mkdir(parents=True, exist_ok=True)
            if destination_dir.is_symlink() or not destination_dir.is_dir():
                raise PrivateImportError(f"asset destination is unsafe: {item.spec['asset_id']}")
            if destination.exists():
                if destination.is_symlink() or not destination.is_file():
                    raise PrivateImportError(f"asset destination is unsafe: {item.spec['asset_id']}")
                if destination.stat().st_size != item.spec["bytes"] or _sha256_file(destination) != item.spec["sha256"]:
                    raise PrivateImportError(f"content-addressed destination is corrupt: {item.spec['asset_id']}")
                staged_path.unlink()
            else:
                os.replace(staged_path, destination)
                _fsync_directory(destination_dir)
                created_destinations.append(destination)
            item.spec["_destination"] = str(destination)
        return staging, staged, created_destinations
    except Exception:
        for path in reversed(created_destinations):
            path.unlink(missing_ok=True)
        shutil.rmtree(staging, ignore_errors=True)
        raise


def _pack_matches(row: sqlite3.Row, clean: dict[str, Any]) -> bool:
    expected = {
        "content_kind": clean["content_kind"],
        "slug": clean["slug"],
        "draft_title": clean["title"],
        "draft_summary": clean["summary"],
        "draft_price_credits": clean["price_credits"],
        "draft_coverage_region": clean["coverage_region"],
        "draft_public_metadata": clean["public_metadata_json"],
        "draft_validation_metadata": clean["validation_metadata_json"],
        "draft_template_json": clean["template_json"],
        "draft_original_manifest_json": clean["original_manifest_json"],
    }
    return row["status"] == "draft" and all(row[key] == value for key, value in expected.items())


def _apply_database(
    db_path: Path,
    clean: dict[str, Any],
    prepared: list[PreparedAsset],
    admin_user_id: int,
) -> tuple[bool, list[tuple[str, str, str]], int]:
    now = int(datetime.now(timezone.utc).timestamp())
    inserted_pack = False
    inserted_assets: list[tuple[str, str, str]] = []
    connection = _connect(db_path)
    try:
        required_tables = {"users", "authored_trip_packs", "authored_original_assets"}
        tables = {
            row["name"] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if not required_tables.issubset(tables):
            raise PrivateImportError("target database is not an initialized Trailhead database")
        connection.execute("BEGIN IMMEDIATE")
        admin = connection.execute(
            "SELECT id,is_admin FROM users WHERE id=?", (admin_user_id,)
        ).fetchone()
        if not admin or not bool(admin["is_admin"]):
            raise PrivateImportError("private import requires a real target admin user")

        existing_pack = connection.execute(
            "SELECT * FROM authored_trip_packs WHERE id=?", (clean["id"],)
        ).fetchone()
        if existing_pack is not None and not _pack_matches(existing_pack, clean):
            raise PrivateImportError("an existing different draft blocks this bounded import")
        if existing_pack is None:
            connection.execute(
                """INSERT INTO authored_trip_packs
                   (id,content_kind,slug,status,draft_title,draft_summary,draft_price_credits,
                    draft_coverage_region,draft_public_metadata,draft_validation_metadata,
                    draft_template_json,draft_original_manifest_json,draft_revision,
                    created_by,updated_by,created_at,updated_at)
                   VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?,1,?,?,?,?)""",
                (
                    clean["id"], clean["content_kind"], clean["slug"], clean["title"],
                    clean["summary"], clean["price_credits"], clean["coverage_region"],
                    clean["public_metadata_json"], clean["validation_metadata_json"],
                    clean["template_json"], clean["original_manifest_json"],
                    admin_user_id, admin_user_id, now, now,
                ),
            )
            inserted_pack = True

        generator = _generator_metadata()
        for item in prepared:
            spec = item.spec
            destination = str(spec["_destination"])
            public_path = (
                f"/api/original-assets/{packet_builder.PACK_ID}/"
                f"{spec['asset_id']}/{spec['sha256']}"
            )
            media_json = _canonical_json(item.media_metadata)
            transcript_sha256 = spec.get("transcript_sha256")
            generator_json = _canonical_json(generator if spec["kind"] == "narration" else {})
            current = connection.execute(
                """SELECT * FROM authored_original_assets
                   WHERE pack_id=? AND asset_id=? AND is_current=1""",
                (packet_builder.PACK_ID, spec["asset_id"]),
            ).fetchall()
            if any(row["sha256"] != spec["sha256"] for row in current):
                raise PrivateImportError(
                    f"an existing different current asset blocks {spec['asset_id']}"
                )
            existing = connection.execute(
                """SELECT * FROM authored_original_assets
                   WHERE pack_id=? AND asset_id=? AND sha256=?""",
                (packet_builder.PACK_ID, spec["asset_id"], spec["sha256"]),
            ).fetchone()
            expected = {
                "kind": spec["kind"],
                "mime_type": spec["mime_type"],
                "byte_count": int(spec["bytes"]),
                "public_path": public_path,
                "storage_path": destination,
                "media_metadata_json": media_json,
                "transcript_sha256": transcript_sha256,
                "generator_metadata_json": generator_json,
                "is_current": 1,
            }
            if existing is not None:
                if spec["kind"] == "narration":
                    try:
                        existing_generator = json.loads(
                            existing["generator_metadata_json"]
                        )
                        reconciled_generator = (
                            reconcile_original_generator_license_metadata(
                                existing_generator,
                                generator,
                            )
                        )
                    except (TypeError, ValueError, json.JSONDecodeError) as exc:
                        raise PrivateImportError(
                            "immutable narration generator metadata differs for "
                            f"{spec['asset_id']}"
                        ) from exc
                    expected["generator_metadata_json"] = _canonical_json(
                        reconciled_generator
                    )
                if any(existing[key] != value for key, value in expected.items()):
                    raise PrivateImportError(
                        f"immutable asset metadata differs for {spec['asset_id']}"
                    )
                continue
            connection.execute(
                """INSERT INTO authored_original_assets
                   (pack_id,asset_id,sha256,kind,mime_type,byte_count,public_path,
                    storage_path,media_metadata_json,transcript_sha256,
                    generator_metadata_json,is_current,uploaded_by,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)""",
                (
                    packet_builder.PACK_ID, spec["asset_id"], spec["sha256"],
                    spec["kind"], spec["mime_type"], int(spec["bytes"]), public_path,
                    destination, media_json, transcript_sha256, generator_json,
                    admin_user_id, now, now,
                ),
            )
            inserted_assets.append(
                (packet_builder.PACK_ID, str(spec["asset_id"]), str(spec["sha256"]))
            )
        revision_row = connection.execute(
            "SELECT draft_revision FROM authored_trip_packs WHERE id=?",
            (packet_builder.PACK_ID,),
        ).fetchone()
        if revision_row is None:
            raise PrivateImportError("private draft revision disappeared before commit")
        revision = int(revision_row["draft_revision"])
        connection.commit()
        return inserted_pack, inserted_assets, revision
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _restore_database(
    db_path: Path,
    *,
    inserted_pack: bool,
    inserted_assets: list[tuple[str, str, str]],
) -> None:
    connection = _connect(db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        if inserted_pack:
            connection.execute(
                "DELETE FROM authored_trip_packs WHERE id=?", (packet_builder.PACK_ID,)
            )
        else:
            for key in inserted_assets:
                connection.execute(
                    """DELETE FROM authored_original_assets
                       WHERE pack_id=? AND asset_id=? AND sha256=?""",
                    key,
                )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _verify_database(
    db_path: Path, clean: dict[str, Any], prepared: list[PreparedAsset]
) -> dict[str, Any]:
    connection = _connect(db_path)
    try:
        pack = connection.execute(
            "SELECT * FROM authored_trip_packs WHERE id=?", (packet_builder.PACK_ID,)
        ).fetchone()
        if pack is None or not _pack_matches(pack, clean):
            raise PrivateImportError("post-import private draft verification failed")
        rows = connection.execute(
            """SELECT * FROM authored_original_assets
               WHERE pack_id=? AND is_current=1 ORDER BY asset_id""",
            (packet_builder.PACK_ID,),
        ).fetchall()
        if len(rows) != 20:
            raise PrivateImportError("post-import asset count verification failed")
        expected = {item.spec["asset_id"]: item for item in prepared}
        for row in rows:
            item = expected.get(row["asset_id"])
            if item is None or row["sha256"] != item.spec["sha256"]:
                raise PrivateImportError("post-import asset identity verification failed")
            stored = Path(row["storage_path"])
            if (
                not stored.is_file()
                or stored.stat().st_size != item.spec["bytes"]
                or _sha256_file(stored) != item.spec["sha256"]
            ):
                raise PrivateImportError("post-import stored-byte verification failed")
        versions = int(connection.execute(
            "SELECT COUNT(*) AS count FROM authored_trip_pack_versions WHERE pack_id=?",
            (packet_builder.PACK_ID,),
        ).fetchone()["count"])
        if versions != 0 or pack["status"] != "draft":
            raise PrivateImportError("private import unexpectedly created a publication")
        return {
            "draft_revision": int(pack["draft_revision"]),
            "current_asset_count": len(rows),
            "published_version_count": versions,
            "status": str(pack["status"]),
        }
    finally:
        connection.close()


def _write_report(path: Path, report: dict[str, Any]) -> None:
    if not path.is_absolute():
        raise PrivateImportError("report path must be absolute")
    path = path.resolve(strict=False)
    reserved = {
        PACKET_PATH.resolve(),
        MANIFEST_PATH.resolve(),
        AUTHORIZATION_PATH.resolve(),
        *(item.resolve() for item in PROTECTED_FILES),
        *(item.resolve() for item in packet_builder.SOURCE_PATHS.values()),
    }
    evidence_roots = (
        packet_builder.OUTPUT_ROOT.resolve(strict=False),
        packet_builder.ARTWORK_ROOT.resolve(strict=False),
        packet_builder.ARTWORK_WINDOWS_MIRROR.resolve(strict=False),
    )
    if path in reserved or any(path == root or root in path.parents for root in evidence_roots):
        raise PrivateImportError("report path collides with protected packet evidence")
    if path.exists():
        if path.is_symlink() or not path.is_file():
            raise PrivateImportError("existing report path must be a regular non-symlink file")
        existing = _read_json(path)
        if (
            existing.get("schema_version") != report.get("schema_version")
            or existing.get("packet_id") != report.get("packet_id")
        ):
            raise PrivateImportError("refusing to overwrite an unrelated report")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            handle.write(
                json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
            )
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        try:
            _fsync_directory(path.parent)
        except Exception as exc:
            raise ReportCommitUncertainError(
                "report replacement completed but directory sync was not confirmed; "
                "caller state was not compensated and must be verified by exact replay"
            ) from exc
    finally:
        temporary.unlink(missing_ok=True)


def dry_run() -> dict[str, Any]:
    packet, manifest, prepared = _assert_exact_packet()
    protected = _verify_protected_files()
    return {
        "schema_version": 1,
        "status": "dry_run_verified",
        "packet_id": packet["packet_id"],
        "packet_sha256": _sha256_file(PACKET_PATH),
        "manifest_canonical_sha256": _canonical_sha256(manifest),
        "delivery_contract_sha256": packet["manifest"]["delivery_contract_sha256"],
        "assets": {
            "total": len(prepared),
            "narration": sum(item.spec["kind"] == "narration" for item in prepared),
            "artwork": sum(item.spec["kind"] == "image" for item in prepared),
            "bytes": sum(int(item.spec["bytes"]) for item in prepared),
            "verified_sha256": [
                {"asset_id": item.spec["asset_id"], "sha256": item.spec["sha256"]}
                for item in prepared
            ],
        },
        "protected_files": protected,
        "writes_performed": False,
        "remaining_live_requirements": [
            "explicit configured private database, asset root, and target id",
            "real target admin user id",
            "authenticated server-owned generator-license attestation after byte import",
        ],
        "gates": {
            "private_upload_complete": False,
            "authenticated_device_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
    }


def apply_private(
    *,
    db_path: Path,
    asset_root: Path,
    admin_user_id: int,
    target_id: str,
    report_path: Path,
    _allow_isolated_target: bool = False,
) -> dict[str, Any]:
    packet, manifest, prepared = _assert_exact_packet()
    clean = _clean_draft(packet, manifest)
    db_path = _assert_target_path(db_path, "database path", must_exist=True)
    asset_root = _assert_target_path(asset_root, "asset root", must_exist=False)
    asset_root.mkdir(parents=True, exist_ok=True)
    asset_root = asset_root.resolve(strict=True)
    target = _configured_target(
        db_path,
        asset_root,
        target_id,
        allow_isolated=_allow_isolated_target,
    )
    report_path = _assert_report_path_safe(
        report_path,
        db_path=db_path,
        asset_root=asset_root,
        prepared=prepared,
    )
    if admin_user_id < 1:
        raise PrivateImportError("admin user id must be positive")

    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )
    journal_path = asset_root / JOURNAL_FILE_NAME
    with _exclusive_import_lock(asset_root):
        _preflight_database_target(db_path, admin_user_id)
        recovered = _recover_interrupted_import(
            journal_path=journal_path,
            db_path=db_path,
            asset_root=asset_root,
            target_id=target["id"],
            prepared=prepared,
        )
        protected = _verify_protected_files()
        journal = _journal_document(
            db_path=db_path,
            asset_root=asset_root,
            target_id=target["id"],
            prepared=prepared,
        )
        _write_json_atomic(journal_path, journal)

        staging: Path | None = None
        created_destinations: list[Path] = []
        inserted_pack = False
        inserted_assets: list[tuple[str, str, str]] = []
        committed = False
        try:
            staging, _staged, created_destinations = _stage_assets(prepared, asset_root)
            inserted_pack, inserted_assets, revision = _apply_database(
                db_path, clean, prepared, admin_user_id
            )
            committed = True
            journal["state"] = "database_committed"
            _write_json_atomic(journal_path, journal)
            verification = _verify_database(db_path, clean, prepared)
            completed_at = datetime.now(timezone.utc).isoformat(
                timespec="seconds"
            ).replace("+00:00", "Z")
            run_nonce = uuid.uuid4().hex
            transaction_id = hashlib.sha256(
                _canonical_json({
                    "packet_sha256": _sha256_file(PACKET_PATH),
                    "target_id": target["id"],
                    "database_path": str(db_path),
                    "asset_root": str(asset_root),
                    "admin_user_id": admin_user_id,
                    "started_at": started_at,
                    "nonce": run_nonce,
                }).encode("utf-8")
            ).hexdigest()
            configured = target["classification"] == "configured_private"
            report = {
                "schema_version": 1,
                "status": (
                    "verified_configured_private_import"
                    if configured
                    else "verified_isolated_import"
                ),
                "packet_id": packet["packet_id"],
                "packet_sha256": _sha256_file(PACKET_PATH),
                "authorization_sha256": _sha256_file(AUTHORIZATION_PATH),
                "manifest_canonical_sha256": _canonical_sha256(
                    clean["original_manifest"]
                ),
                "delivery_contract_sha256": packet["manifest"][
                    "delivery_contract_sha256"
                ],
                "transaction_id": transaction_id,
                "started_at": started_at,
                "completed_at": completed_at,
                "target": {
                    **target,
                    "database_path_sha256": hashlib.sha256(
                        str(db_path).encode("utf-8")
                    ).hexdigest(),
                    "asset_root_path_sha256": hashlib.sha256(
                        str(asset_root).encode("utf-8")
                    ).hexdigest(),
                },
                "pack": {
                    "id": packet_builder.PACK_ID,
                    "status": "draft",
                    "draft_revision": revision,
                },
                "assets": {
                    "total": len(prepared),
                    "narration": 13,
                    "artwork": 7,
                    "bytes": sum(int(item.spec["bytes"]) for item in prepared),
                    "verified_sha256": [
                        {
                            "asset_id": item.spec["asset_id"],
                            "sha256": item.spec["sha256"],
                        }
                        for item in prepared
                    ],
                },
                "narration_license": {
                    "status": "unverified",
                    "server_owned_attestation_complete": False,
                    "required_next_action": (
                        "authenticated admin license-attestation endpoint for each narration"
                    ),
                },
                "protected_files": protected,
                "idempotency": {
                    "packet_sha256_keyed": True,
                    "pack_created_by_run": inserted_pack,
                    "asset_rows_created_by_run": len(inserted_assets),
                    "content_files_created_by_run": len(created_destinations),
                    "interrupted_run_recovered": recovered,
                },
                "post_import": verification,
                "rollback": {"required": False, "performed": False},
                "gates": {
                    "isolated_import_verified": not configured,
                    "configured_private_byte_import_complete": configured,
                    "admin_license_attestation_complete": False,
                    "verified_private_upload_complete": False,
                    "authenticated_device_preview_complete": False,
                    "trusted_publication_validation_complete": False,
                    "public_release": False,
                },
            }
            journal_path.unlink()
            _fsync_directory(asset_root)
            _write_report(report_path, report)
            return report
        except ReportCommitUncertainError:
            raise
        except Exception as exc:
            if committed:
                try:
                    _restore_database(
                        db_path,
                        inserted_pack=inserted_pack,
                        inserted_assets=inserted_assets,
                    )
                except Exception as rollback_exc:
                    journal["state"] = "rollback_failed"
                    try:
                        _write_json_atomic(journal_path, journal)
                    except Exception:
                        pass
                    raise PrivateImportError(
                        "database rollback failed; recovery journal retained"
                    ) from rollback_exc
            _remove_unreferenced_created(
                db_path,
                list(journal["destinations"]),
            )
            journal_path.unlink(missing_ok=True)
            _fsync_directory(asset_root)
            raise exc
        finally:
            if staging is not None:
                shutil.rmtree(staging, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", choices=[APPLY_SENTINEL])
    parser.add_argument("--db-path", type=Path)
    parser.add_argument("--asset-root", type=Path)
    parser.add_argument("--target-id")
    parser.add_argument("--admin-user-id", type=int)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.apply is None:
        report = dry_run()
        if args.report is not None:
            _write_report(args.report, report)
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
        return
    required = {
        "--db-path": args.db_path,
        "--asset-root": args.asset_root,
        "--target-id": args.target_id,
        "--admin-user-id": args.admin_user_id,
        "--report": args.report,
    }
    missing = [name for name, value in required.items() if value is None]
    if missing:
        parser.error("apply mode requires " + ", ".join(missing))
    report = apply_private(
        db_path=args.db_path,
        asset_root=args.asset_root,
        target_id=args.target_id,
        admin_user_id=args.admin_user_id,
        report_path=args.report,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
