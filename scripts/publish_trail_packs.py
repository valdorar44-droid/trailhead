#!/usr/bin/env python3
"""Upload generated trail packs to Cloudflare R2 via wrangler."""
from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path

WRANGLER_LIMIT_BYTES = 300 * 1024 * 1024
PART_SIZE_BYTES = 280 * 1024 * 1024


def wrangler_put(bucket: str, key: str, path: Path) -> None:
    subprocess.run(
        ["wrangler", "r2", "object", "put", f"{bucket}/{key}", "--file", str(path), "--remote"],
        check=True,
    )


def put_large_as_parts(bucket: str, key: str, path: Path, tmp_dir: Path) -> None:
    size = path.stat().st_size
    part_count = math.ceil(size / PART_SIZE_BYTES)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    parts = []
    print(f"{key}: splitting {size} bytes into {part_count} parts")
    with path.open("rb") as src:
        for idx in range(part_count):
            part_name = f"{key}.part{idx:03d}"
            part_path = tmp_dir / part_name.replace("/", "_")
            data = src.read(PART_SIZE_BYTES)
            part_path.write_bytes(data)
            try:
                wrangler_put(bucket, part_name, part_path)
            finally:
                part_path.unlink(missing_ok=True)
            parts.append({"key": part_name, "size": len(data)})

    parts_manifest = tmp_dir / (key.replace("/", "_") + ".parts.json")
    parts_manifest.write_text(json.dumps({"size": size, "parts": parts}, separators=(",", ":")) + "\n")
    try:
        wrangler_put(bucket, f"{key}.parts.json", parts_manifest)
    finally:
        parts_manifest.unlink(missing_ok=True)


def put_file(bucket: str, key: str, path: Path, tmp_dir: Path) -> None:
    if path.stat().st_size > WRANGLER_LIMIT_BYTES:
        put_large_as_parts(bucket, key, path, tmp_dir)
    else:
        wrangler_put(bucket, key, path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("regions", nargs="*", help="Region ids to publish. Defaults to every generated pack.")
    parser.add_argument("--data-dir", type=Path, default=Path("data/trails"))
    parser.add_argument("--bucket", default="trailhead-tiles")
    args = parser.parse_args()

    regions = [r.lower() for r in args.regions]
    full_publish = not regions
    if not regions:
        regions = sorted(p.parent.name for p in args.data_dir.glob("*/trails.pmtiles"))

    manifest: dict[str, dict[str, int]] = {}
    existing_manifest = args.data_dir / "manifest.json"
    if not full_publish and existing_manifest.exists():
        manifest.update(json.loads(existing_manifest.read_text()))
    tmp_dir = Path("output") / "r2-parts"

    for region in regions:
        pmtiles = args.data_dir / region / "trails.pmtiles"
        graph = args.data_dir / region / "trail_graph.json"
        route_graph = args.data_dir / region / "trail_route_graph.jsonl.gz"
        if not pmtiles.exists():
            print(f"{region}: missing {pmtiles}, skipping")
            continue
        put_file(args.bucket, f"trails/{region}.pmtiles", pmtiles, tmp_dir)
        if graph.exists():
            if graph.stat().st_size > WRANGLER_LIMIT_BYTES:
                print(f"{region}: skipping oversized legacy selection graph {graph.stat().st_size} bytes")
            else:
                put_file(args.bucket, f"trails/{region}.graph.json", graph, tmp_dir)
        if route_graph.exists():
            put_file(args.bucket, f"trails/{region}.route.jsonl.gz", route_graph, tmp_dir)
        manifest[f"{region}.pmtiles"] = {"size": pmtiles.stat().st_size}
        if graph.exists() and graph.stat().st_size <= WRANGLER_LIMIT_BYTES:
            manifest[f"{region}.graph.json"] = {"size": graph.stat().st_size}
        if route_graph.exists():
            manifest[f"{region}.route.jsonl.gz"] = {"size": route_graph.stat().st_size}

    args.data_dir.mkdir(parents=True, exist_ok=True)
    existing_manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    wrangler_put(args.bucket, "trails/manifest.json", existing_manifest)
    print(f"published trail manifest with {len(manifest)} entries")


if __name__ == "__main__":
    main()
