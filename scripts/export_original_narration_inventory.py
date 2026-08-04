#!/usr/bin/env python3
"""Export a redacted narration inventory for an immutable published Original.

This tool is intentionally independent from the application store connection:
it opens SQLite in URI ``mode=ro`` and also enables ``PRAGMA query_only``. It
uses the asset id and SHA-256 recorded in the selected published manifest, not
the mutable ``is_current`` asset pointer.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any


SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class InventoryError(RuntimeError):
    """Raised when immutable narration provenance cannot be proven."""


def open_read_only_database(database: str | Path) -> sqlite3.Connection:
    """Open an existing SQLite database with two independent write guards."""
    path = Path(database).expanduser().resolve(strict=True)
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    if int(connection.execute("PRAGMA query_only").fetchone()[0]) != 1:
        connection.close()
        raise InventoryError("SQLite query-only mode could not be enabled")
    return connection


def _json_object(raw: object, label: str) -> dict[str, Any]:
    try:
        value = json.loads(str(raw or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise InventoryError(f"{label} is not valid JSON") from exc
    if not isinstance(value, dict):
        raise InventoryError(f"{label} must be a JSON object")
    return value


def _published_version_row(
    connection: sqlite3.Connection,
    pack_id: str,
    version: int,
) -> sqlite3.Row:
    row = connection.execute(
        """SELECT p.id AS pack_id,v.version,v.original_manifest_json
             FROM authored_trip_packs p
             JOIN authored_trip_pack_versions v ON v.pack_id=p.id
            WHERE p.id=? AND v.version=?
              AND p.status='published'
              AND p.content_kind='original_drive'
              AND v.content_kind='original_drive'
            LIMIT 1""",
        (pack_id, version),
    ).fetchone()
    if row is None:
        raise InventoryError("Published Original pack/version was not found")
    return row


def _manifest_narrations(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    assets = manifest.get("assets")
    stops = manifest.get("stops")
    if not isinstance(assets, list) or not isinstance(stops, list):
        raise InventoryError("Published Original manifest lacks V1 assets or stops")

    assets_by_id: dict[str, dict[str, Any]] = {}
    for raw_asset in assets:
        if not isinstance(raw_asset, dict):
            raise InventoryError("Published Original manifest contains an invalid asset")
        asset_id = str(raw_asset.get("id") or "").strip()
        if not asset_id or asset_id in assets_by_id:
            raise InventoryError("Published Original manifest asset ids are missing or duplicated")
        assets_by_id[asset_id] = raw_asset

    narrations: list[dict[str, Any]] = []
    seen_sequences: set[int] = set()
    for raw_stop in stops:
        if not isinstance(raw_stop, dict):
            raise InventoryError("Published Original manifest contains an invalid stop")
        sequence = raw_stop.get("sequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
            raise InventoryError("Published Original stop sequence is invalid")
        if sequence in seen_sequences:
            raise InventoryError("Published Original stop sequences are duplicated")
        seen_sequences.add(sequence)
        stop_id = str(raw_stop.get("id") or "").strip()
        asset_id = str(raw_stop.get("audio_asset_id") or "").strip()
        if not stop_id or not asset_id:
            raise InventoryError("Published Original stop narration binding is incomplete")
        asset = assets_by_id.get(asset_id)
        if not asset or str(asset.get("kind") or "").lower() != "narration":
            raise InventoryError(f"Published narration asset {asset_id!r} is unavailable")
        sha256 = str(asset.get("sha256") or "").strip().lower()
        if not SHA256_RE.fullmatch(sha256):
            raise InventoryError(f"Published narration asset {asset_id!r} has an invalid SHA-256")
        byte_size = asset.get("bytes")
        if isinstance(byte_size, bool) or not isinstance(byte_size, int) or byte_size < 1:
            raise InventoryError(f"Published narration asset {asset_id!r} has an invalid byte size")
        duration = raw_stop.get("audio_duration_s")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or duration <= 0:
            raise InventoryError(f"Published narration stop {stop_id!r} has an invalid duration")
        transcript = " ".join(str(raw_stop.get("transcript") or "").split())
        if not transcript:
            raise InventoryError(f"Published narration stop {stop_id!r} lacks a transcript")
        narrations.append({
            "sequence": sequence,
            "stop_id": stop_id,
            "asset_id": asset_id,
            "audio_sha256": sha256,
            "byte_size": byte_size,
            "published_duration_s": float(duration),
            "manifest_transcript_sha256": hashlib.sha256(
                transcript.encode("utf-8")
            ).hexdigest(),
        })
    return sorted(narrations, key=lambda item: item["sequence"])


def list_published(connection: sqlite3.Connection) -> dict[str, Any]:
    """List safe pack/version identifiers without returning authored content."""
    rows = connection.execute(
        """SELECT p.id AS pack_id,v.version,v.original_manifest_json
             FROM authored_trip_packs p
             JOIN authored_trip_pack_versions v ON v.pack_id=p.id
            WHERE p.status='published'
              AND p.content_kind='original_drive'
              AND v.content_kind='original_drive'
            ORDER BY p.id,v.version"""
    ).fetchall()
    items = []
    for row in rows:
        manifest = _json_object(row["original_manifest_json"], "Published Original manifest")
        items.append({
            "pack_id": row["pack_id"],
            "version": int(row["version"]),
            "narration_count": len(_manifest_narrations(manifest)),
        })
    return {"published_originals": items}


def export_inventory(
    connection: sqlite3.Connection,
    pack_id: str,
    version: int,
    *,
    expect_narrations: int | None = None,
) -> dict[str, Any]:
    """Export only redacted provenance bound to one published pack version."""
    row = _published_version_row(connection, pack_id, version)
    manifest = _json_object(row["original_manifest_json"], "Published Original manifest")
    references = _manifest_narrations(manifest)
    if expect_narrations is not None and len(references) != expect_narrations:
        raise InventoryError(
            f"Expected {expect_narrations} narrations but the manifest binds {len(references)}"
        )

    narrations: list[dict[str, Any]] = []
    for reference in references:
        asset = connection.execute(
            """SELECT pack_id,asset_id,sha256,kind,byte_count,
                      media_metadata_json,transcript_sha256,generator_metadata_json
                 FROM authored_original_assets
                WHERE pack_id=? AND asset_id=? AND sha256=?
                LIMIT 1""",
            (row["pack_id"], reference["asset_id"], reference["audio_sha256"]),
        ).fetchone()
        if asset is None:
            raise InventoryError(
                f"Immutable narration revision {reference['asset_id']!r} is missing"
            )
        if str(asset["kind"] or "").lower() != "narration":
            raise InventoryError(
                f"Immutable asset {reference['asset_id']!r} is not narration"
            )
        if int(asset["byte_count"]) != reference["byte_size"]:
            raise InventoryError(
                f"Immutable narration {reference['asset_id']!r} byte size does not match its manifest"
            )
        transcript_sha256 = str(asset["transcript_sha256"] or "").strip().lower()
        if not SHA256_RE.fullmatch(transcript_sha256):
            raise InventoryError(
                f"Immutable narration {reference['asset_id']!r} lacks a transcript SHA-256"
            )
        if transcript_sha256 != reference["manifest_transcript_sha256"]:
            raise InventoryError(
                f"Immutable narration {reference['asset_id']!r} transcript does not match its manifest"
            )

        media = _json_object(asset["media_metadata_json"], "Narration media metadata")
        generator = _json_object(
            asset["generator_metadata_json"], "Narration generator metadata"
        )
        probed_duration = media.get("duration_s")
        if (
            isinstance(probed_duration, bool)
            or not isinstance(probed_duration, (int, float))
            or probed_duration <= 0
        ):
            raise InventoryError(
                f"Immutable narration {reference['asset_id']!r} lacks a probed duration"
            )

        record = {
            "audio_sha256": reference["audio_sha256"],
            "byte_size": reference["byte_size"],
            "published_duration_s": reference["published_duration_s"],
            "provider": str(generator.get("provider") or "").strip() or None,
            "model_id": str(generator.get("model_id") or "").strip() or None,
            "voice_id": str(generator.get("voice_id") or "").strip() or None,
            "probed_duration_s": float(probed_duration),
            "transcript_sha256": transcript_sha256,
            "license_status": str(generator.get("license_status") or "").strip()
            or "not_recorded",
        }
        for output_key in ("output_format", "output_version", "api_version"):
            value = str(generator.get(output_key) or "").strip()
            if value:
                record[output_key] = value
        narrations.append(record)

    return {
        "pack_id": row["pack_id"],
        "version": int(row["version"]),
        "narrations": narrations,
    }


def _positive_int(raw: str) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a positive integer") from exc
    if value < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, help="Existing SQLite database path")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--list-published", action="store_true")
    mode.add_argument("--pack-id")
    parser.add_argument("--version", type=_positive_int)
    parser.add_argument("--expect-narrations", type=_positive_int)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.list_published:
        if args.version is not None or args.expect_narrations is not None:
            parser.error("--version and --expect-narrations require --pack-id")
    elif args.version is None:
        parser.error("--pack-id requires --version")

    try:
        with open_read_only_database(args.database) as connection:
            result = (
                list_published(connection)
                if args.list_published
                else export_inventory(
                    connection,
                    args.pack_id,
                    args.version,
                    expect_narrations=args.expect_narrations,
                )
            )
    except (InventoryError, OSError, sqlite3.Error) as exc:
        print(f"inventory export failed: {exc}", file=sys.stderr)
        return 1

    json.dump(result, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
