#!/usr/bin/env python3
"""Prepare mounted Valhalla tiles for the Railway artifact image."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def requested_artifact_keys() -> list[str]:
    raw_multi = env("VALHALLA_ARTIFACT_KEYS")
    raw_single = env("VALHALLA_ARTIFACT_KEY")
    raw = raw_multi or raw_single
    if not raw:
        return []
    if raw.startswith("["):
        import json
        try:
            parsed = json.loads(raw)
            return [str(item).strip() for item in parsed if str(item).strip()]
        except Exception:
            pass
    return [part.strip() for part in raw.replace("\n", ",").split(",") if part.strip()]


def expected_marker(keys: list[str]) -> str:
    return "r2:" + ",".join(keys)


def r2_client():
    import boto3
    from botocore.config import Config

    account_id = env("R2_ACCOUNT_ID")
    access_key = env("R2_ACCESS_KEY_ID")
    secret_key = env("R2_SECRET_ACCESS_KEY")
    if not (account_id and access_key and secret_key):
        print("Missing R2 credentials", file=sys.stderr)
        return None
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def download_r2_artifacts(keys: list[str], target_dir: Path) -> list[Path]:
    client = r2_client()
    if client is None:
        raise RuntimeError("R2 credentials are required when VALHALLA_ARTIFACT_KEYS is set")
    bucket = env("R2_BUCKET", "trailhead-tiles")
    cache_dir = target_dir / "artifact-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for key in keys:
        name = key.replace("/", "__")
        out = cache_dir / name
        tmp = out.with_suffix(out.suffix + ".tmp")
        if out.exists() and out.stat().st_size > 0:
            print(f"Using cached R2 artifact {key}")
            paths.append(out)
            continue
        print(f"Downloading R2 artifact {key}")
        if tmp.exists():
            tmp.unlink()
        client.download_file(bucket, key, str(tmp))
        tmp.rename(out)
        paths.append(out)
    return paths


def generate_config_for_tiles(tiles_dir: Path, target_dir: Path) -> int:
    config_path = target_dir / "valhalla.json"
    print(f"Generating Valhalla config for graph in {tiles_dir}")
    with config_path.open("w") as fh:
        subprocess.check_call(
            ["valhalla_build_config", "--mjolnir-tile-dir", str(tiles_dir)],
            stdout=fh,
        )
    return 0


def extract_one_to_tiles(artifact: Path, target_dir: Path, tiles_dir: Path) -> None:
    scratch = target_dir / "_extract_scratch"
    if scratch.exists():
        shutil.rmtree(scratch)
    scratch.mkdir(parents=True, exist_ok=True)
    try:
        if artifact.name.endswith(".zst"):
            subprocess.check_call(["tar", "--zstd", "-xf", str(artifact), "-C", str(scratch)])
        else:
            with tarfile.open(artifact, "r:*") as tar:
                tar.extractall(scratch)
        source_tiles = scratch / "valhalla_tiles"
        if not source_tiles.exists():
            raise RuntimeError(f"{artifact} did not contain valhalla_tiles")
        shutil.copytree(source_tiles, tiles_dir, dirs_exist_ok=True)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def extract_r2_artifacts(keys: list[str], target_dir: Path) -> int:
    tiles_dir = target_dir / "valhalla_tiles"
    config_path = target_dir / "valhalla.json"
    ready_marker = target_dir / ".artifact-ready"
    marker = expected_marker(keys)
    if config_path.exists() and tiles_dir.exists() and ready_marker.exists() and ready_marker.read_text().strip() == marker:
        print("Valhalla R2 artifacts already extracted")
        return 0

    target_dir.mkdir(parents=True, exist_ok=True)
    if tiles_dir.exists():
        shutil.rmtree(tiles_dir)
    if config_path.exists():
        config_path.unlink()
    ready_marker.unlink(missing_ok=True)
    tiles_dir.mkdir(parents=True, exist_ok=True)

    artifacts = download_r2_artifacts(keys, target_dir)
    for artifact in artifacts:
        print(f"Extracting {artifact.name}")
        extract_one_to_tiles(artifact, target_dir, tiles_dir)

    if not any(tiles_dir.iterdir()):
        print("No Valhalla tiles were extracted", file=sys.stderr)
        return 4
    rc = generate_config_for_tiles(tiles_dir, target_dir)
    if rc:
        return rc
    ready_marker.write_text(marker)
    print(f"Valhalla R2 artifacts extracted: {len(keys)}")
    return 0


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
    # Older per-state packs contain builder-local paths in valhalla.json. Always
    # regenerate the serving config so Railway uses the mounted graph path.
    rc = generate_config_for_tiles(tiles_dir, target_dir)
    if rc:
        return rc
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
    keys = requested_artifact_keys()
    if keys:
        return extract_r2_artifacts(keys, target_dir)
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
