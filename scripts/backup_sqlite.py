#!/usr/bin/env python3
"""Create and verify a consistent Trailhead SQLite backup."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_backup(source: Path, output_dir: Path, keep: int = 14) -> dict:
    source = source.expanduser().resolve()
    output_dir = output_dir.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"SQLite database not found: {source}")
    if keep < 1:
        raise ValueError("keep must be at least 1")
    output_dir.mkdir(parents=True, exist_ok=True)

    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    destination = output_dir / f"trailhead-{stamp}.sqlite3"
    sequence = 1
    while destination.exists():
        destination = output_dir / f"trailhead-{stamp}-{sequence}.sqlite3"
        sequence += 1

    source_db = sqlite3.connect(str(source), timeout=30)
    target_db = sqlite3.connect(str(destination), timeout=30)
    try:
        source_db.backup(target_db)
    finally:
        target_db.close()
        source_db.close()

    verify_db = sqlite3.connect(f"file:{destination}?mode=ro", uri=True)
    try:
        integrity = str(verify_db.execute("PRAGMA integrity_check").fetchone()[0])
        table_count = int(verify_db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchone()[0])
    finally:
        verify_db.close()
    if integrity.lower() != "ok":
        destination.unlink(missing_ok=True)
        raise RuntimeError(f"Backup integrity check failed: {integrity}")
    if table_count < 1 or destination.stat().st_size < 1:
        destination.unlink(missing_ok=True)
        raise RuntimeError("Backup verification found no application tables or data file")
    destination.chmod(0o600)

    manifest = {
        "schema_version": 1,
        "created_at": int(time.time()),
        "source": str(source),
        "backup": str(destination),
        "bytes": destination.stat().st_size,
        "sha256": file_sha256(destination),
        "integrity_check": integrity,
        "table_count": table_count,
    }
    manifest_path = destination.with_suffix(".json")
    temporary_manifest = manifest_path.with_suffix(".json.tmp")
    temporary_manifest.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    temporary_manifest.chmod(0o600)
    temporary_manifest.replace(manifest_path)

    backups = sorted(output_dir.glob("trailhead-*.sqlite3"), key=lambda item: item.stat().st_mtime, reverse=True)
    for expired in backups[keep:]:
        expired.unlink(missing_ok=True)
        expired.with_suffix(".json").unlink(missing_ok=True)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a verified SQLite backup")
    parser.add_argument("--source", default=os.getenv("TRAILHEAD_DB_PATH", "/data/trailhead.db"))
    parser.add_argument("--output-dir", default=os.getenv("TRAILHEAD_BACKUP_DIR", "/data/backups"))
    parser.add_argument("--keep", type=int, default=14)
    args = parser.parse_args()
    print(json.dumps(create_backup(Path(args.source), Path(args.output_dir), args.keep), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
