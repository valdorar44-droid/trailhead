#!/usr/bin/env python3
"""Build deterministic, lazy-loadable canonical trail geometry shards.

The serving index intentionally stays compact and does not embed route geometry.
This builder turns the source-owned official trail geometry into small gzip JSONL
shards so the API can fetch only the shard needed for a selected trail.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path
from typing import Any, BinaryIO

from shapely.geometry import mapping, shape


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "processed" / "trailhead_official_data.sqlite"
DEFAULT_INDEX = ROOT / "dashboard" / "canonical_trail_index_v1.json"
DEFAULT_OUTPUT = ROOT / "output" / "canonical-trail-geometries-v1"


def _round_coordinates(value: Any) -> Any:
    if isinstance(value, (list, tuple)):
        return [_round_coordinates(item) for item in value]
    return round(float(value), 6)


def _compact_geometry(raw: object, tolerance: float) -> dict[str, Any] | None:
    if not isinstance(raw, str) or len(raw) < 10:
        return None
    try:
        source = json.loads(raw)
        resolved = shape(source).simplify(tolerance, preserve_topology=False)
        public = mapping(resolved)
    except Exception:
        return None
    if public.get("type") not in {"LineString", "MultiLineString"} or resolved.is_empty:
        return None
    return {
        "type": public["type"],
        "coordinates": _round_coordinates(public["coordinates"]),
    }


def _shard_key(trail_id: str, shard_count: int) -> str:
    value = int(hashlib.sha256(trail_id.encode()).hexdigest()[:8], 16) % shard_count
    width = max(2, len(f"{shard_count - 1:x}"))
    return f"{value:0{width}x}"


def _open_deterministic_gzip(path: Path, level: int) -> tuple[BinaryIO, gzip.GzipFile]:
    raw = path.open("wb")
    compressed = gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=level, mtime=0)
    return raw, compressed


def build(args: argparse.Namespace) -> dict[str, Any]:
    if not args.database.exists():
        raise SystemExit(f"Missing official trail database: {args.database}")
    if not args.canonical_index.exists():
        raise SystemExit(f"Missing canonical trail index: {args.canonical_index}")
    if args.shards < 1 or args.shards > 256:
        raise SystemExit("--shards must be between 1 and 256")

    index_payload = json.loads(args.canonical_index.read_text(encoding="utf-8"))
    canonical_ids = {
        str(item.get("id") or "").strip()
        for item in index_payload.get("items") or []
        if str(item.get("id") or "").strip()
    }
    if not canonical_ids:
        raise SystemExit("Canonical trail index contains no trail IDs")

    if args.output.exists():
        if not args.overwrite:
            raise SystemExit(f"Output already exists: {args.output}; pass --overwrite to replace it")
        shutil.rmtree(args.output)
    args.output.mkdir(parents=True)

    streams: dict[str, tuple[BinaryIO, gzip.GzipFile]] = {}
    width = max(2, len(f"{args.shards - 1:x}"))
    counts = {f"{index:0{width}x}": 0 for index in range(args.shards)}
    for key in counts:
        streams[key] = _open_deterministic_gzip(args.output / f"{key}.jsonl.gz", args.compress_level)

    revision = hashlib.sha256()
    published = 0
    skipped = 0
    db = sqlite3.connect(f"file:{args.database}?mode=ro", uri=True, timeout=30)
    try:
        rows = db.execute(
            "SELECT id, route_geom FROM trail WHERE route_geom IS NOT NULL ORDER BY id"
        )
        for trail_id, raw_geometry in rows:
            trail_id = str(trail_id or "").strip()
            if trail_id not in canonical_ids:
                continue
            geometry = _compact_geometry(raw_geometry, args.tolerance)
            if not geometry:
                skipped += 1
                continue
            line = json.dumps(
                {"id": trail_id, "geometry": geometry},
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8") + b"\n"
            key = _shard_key(trail_id, args.shards)
            streams[key][1].write(line)
            counts[key] += 1
            revision.update(line)
            published += 1
    finally:
        db.close()
        for raw, compressed in streams.values():
            compressed.close()
            raw.close()

    revision_value = "sha256:" + revision.hexdigest()
    revision_path = revision_value.split(":", 1)[1]
    shard_manifest: dict[str, dict[str, Any]] = {}
    for key, count in counts.items():
        path = args.output / f"{key}.jsonl.gz"
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        shard_manifest[key] = {
            "count": count,
            "size": path.stat().st_size,
            "sha256": digest,
            "path": f"canonical-geometries-v1-{revision_path}-{key}.jsonl.gz",
        }

    manifest = {
        "schema_version": 1,
        "source": "Trailhead canonical official trail geometry",
        "canonical_generated_at": int(index_payload.get("generated_at") or 0),
        "revision": revision_value,
        "shard_count": args.shards,
        "canonical_count": len(canonical_ids),
        "published_count": published,
        "skipped_count": skipped,
        "simplify_tolerance_degrees": args.tolerance,
        "coordinate_precision": 6,
        "shards": shard_manifest,
    }
    (args.output / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--canonical-index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--shards", type=int, default=64)
    parser.add_argument("--tolerance", type=float, default=0.00002)
    parser.add_argument("--compress-level", type=int, default=6)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    manifest = build(args)
    print(json.dumps({
        "output": str(args.output),
        "revision": manifest["revision"],
        "canonical_count": manifest["canonical_count"],
        "published_count": manifest["published_count"],
        "skipped_count": manifest["skipped_count"],
        "compressed_bytes": sum(item["size"] for item in manifest["shards"].values()),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
