#!/usr/bin/env python3
"""Prepare mounted Valhalla tiles for the Railway artifact image."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def extract_artifact(artifact: Path, target_dir: Path) -> int:
    tiles_dir = target_dir / "valhalla_tiles"
    config_path = target_dir / "valhalla.json"
    ready_marker = target_dir / ".artifact-ready"

    if tiles_dir.exists():
        shutil.rmtree(tiles_dir)
    if config_path.exists():
        config_path.unlink()
    ready_marker.unlink(missing_ok=True)

    if artifact.name.endswith(".zst"):
        subprocess.check_call(["tar", "--zstd", "-xf", str(artifact), "-C", str(target_dir)])
    else:
        subprocess.check_call(["tar", "-xf", str(artifact), "-C", str(target_dir)])

    if not tiles_dir.exists() or not config_path.exists():
        print("Artifact did not contain valhalla_tiles and valhalla.json", file=sys.stderr)
        return 4
    ready_marker.write_text(str(artifact))
    print("Valhalla artifact extracted")
    return 0


def graph_exists(target_dir: Path) -> bool:
    return (target_dir / "index.bin").exists() and any((target_dir / level).is_dir() for level in ("0", "1", "2"))


def ensure_config(target_dir: Path) -> int:
    config_path = target_dir / "valhalla.json"
    if config_path.exists():
        return 0
    if not graph_exists(target_dir):
        return 4
    print(f"Generating Valhalla config for graph in {target_dir}")
    with config_path.open("w") as fh:
        subprocess.check_call(
            ["valhalla_build_config", "--mjolnir-tile-dir", str(target_dir)],
            stdout=fh,
        )
    return 0


def main() -> int:
    target_dir = Path(env("VALHALLA_DATA_DIR", "/custom_files"))
    tiles_dir = target_dir / "valhalla_tiles"
    config_path = target_dir / "valhalla.json"
    ready_marker = target_dir / ".artifact-ready"
    if config_path.exists() and (tiles_dir.exists() or graph_exists(target_dir)) and ready_marker.exists():
        print("Valhalla artifact already extracted")
        return 0
    if graph_exists(target_dir):
        rc = ensure_config(target_dir)
        if rc:
            print("Existing graph is missing a usable Valhalla config", file=sys.stderr)
            return rc
        ready_marker.write_text("mounted-graph")
        print("Mounted Valhalla graph ready")
        return 0

    artifact = target_dir / "valhalla_tiles.tar"
    if not artifact.exists():
        print("Missing /custom_files/valhalla_tiles.tar", file=sys.stderr)
        return 2
    print(f"Extracting mounted artifact {artifact}")
    target_dir.mkdir(parents=True, exist_ok=True)
    return extract_artifact(artifact, target_dir)


if __name__ == "__main__":
    raise SystemExit(main())
