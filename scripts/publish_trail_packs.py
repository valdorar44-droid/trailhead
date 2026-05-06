#!/usr/bin/env python3
"""Upload generated trail packs to Cloudflare R2 via wrangler."""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("regions", nargs="*", help="Region ids to publish. Defaults to every generated pack.")
    parser.add_argument("--data-dir", type=Path, default=Path("data/trails"))
    parser.add_argument("--bucket", default="trailhead-tiles")
    args = parser.parse_args()

    regions = [r.lower() for r in args.regions]
    if not regions:
        regions = sorted(p.parent.name for p in args.data_dir.glob("*/trails.pmtiles"))

    manifest: dict[str, dict[str, int]] = {}
    existing_manifest = args.data_dir / "manifest.json"
    if existing_manifest.exists():
        manifest.update(json.loads(existing_manifest.read_text()))

    for region in regions:
        pmtiles = args.data_dir / region / "trails.pmtiles"
        graph = args.data_dir / region / "trail_graph.json"
        route_graph = args.data_dir / region / "trail_route_graph.jsonl.gz"
        if not pmtiles.exists():
            print(f"{region}: missing {pmtiles}, skipping")
            continue
        subprocess.run(["wrangler", "r2", "object", "put", f"{args.bucket}/trails/{region}.pmtiles", "--file", str(pmtiles), "--remote"], check=True)
        if graph.exists():
            subprocess.run(["wrangler", "r2", "object", "put", f"{args.bucket}/trails/{region}.graph.json", "--file", str(graph), "--remote"], check=True)
        if route_graph.exists():
            subprocess.run(["wrangler", "r2", "object", "put", f"{args.bucket}/trails/{region}.route.jsonl.gz", "--file", str(route_graph), "--remote"], check=True)
        manifest[f"{region}.pmtiles"] = {"size": pmtiles.stat().st_size}
        if graph.exists():
            manifest[f"{region}.graph.json"] = {"size": graph.stat().st_size}
        if route_graph.exists():
            manifest[f"{region}.route.jsonl.gz"] = {"size": route_graph.stat().st_size}

    args.data_dir.mkdir(parents=True, exist_ok=True)
    existing_manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    subprocess.run(["wrangler", "r2", "object", "put", f"{args.bucket}/trails/manifest.json", "--file", str(existing_manifest), "--remote"], check=True)
    print(f"published trail manifest with {len(manifest)} entries")


if __name__ == "__main__":
    main()
