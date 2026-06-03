#!/usr/bin/env python3
"""Download and extract a Valhalla artifact from R2 for serving.

Designed for the Railway Valhalla artifact image. Required env vars:
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
  VALHALLA_ARTIFACT_KEY, VALHALLA_ARTIFACT_SHA256 optional
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

import boto3
from botocore.config import Config


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
      while True:
          chunk = fh.read(32 * 1024 * 1024)
          if not chunk:
              break
          digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    target_dir = Path(env("VALHALLA_DATA_DIR", "/custom_files"))
    artifact_key = env("VALHALLA_ARTIFACT_KEY")
    expected_sha = env("VALHALLA_ARTIFACT_SHA256")
    tiles_dir = target_dir / "valhalla_tiles"
    config_path = target_dir / "valhalla.json"
    ready_marker = target_dir / ".artifact-ready"
    def graph_exists() -> bool:
        return (target_dir / "index.bin").exists() and any((target_dir / level).is_dir() for level in ("0", "1", "2"))

    def ensure_config() -> int:
        if config_path.exists():
            return 0
        if not graph_exists():
            return 4
        print(f"Generating Valhalla config for graph in {target_dir}")
        with config_path.open("w") as fh:
            subprocess.check_call(
                ["valhalla_build_config", "--mjolnir-tile-dir", str(target_dir)],
                stdout=fh,
            )
        return 0

    if config_path.exists() and (tiles_dir.exists() or graph_exists()) and ready_marker.exists():
        print("Valhalla artifact already extracted")
        return 0
    if graph_exists():
        rc = ensure_config()
        if rc:
            print("Existing graph is missing a usable Valhalla config", file=sys.stderr)
            return rc
        ready_marker.write_text("mounted-graph")
        print("Mounted Valhalla graph ready")
        return 0

    local_artifact = target_dir / "valhalla_tiles.tar"
    if not artifact_key:
        if not local_artifact.exists():
            print("VALHALLA_ARTIFACT_KEY is not set and /custom_files/valhalla_tiles.tar is missing", file=sys.stderr)
            return 2
        print(f"Extracting mounted artifact {local_artifact}")
        if tiles_dir.exists():
            shutil.rmtree(tiles_dir)
        if config_path.exists():
            config_path.unlink()
        ready_marker.unlink(missing_ok=True)
        subprocess.check_call(["tar", "-xf", str(local_artifact), "-C", str(target_dir)])
        if not tiles_dir.exists() or not config_path.exists():
            print("Mounted artifact did not contain valhalla_tiles and valhalla.json", file=sys.stderr)
            return 4
        ready_marker.write_text(str(local_artifact))
        print("Mounted Valhalla artifact extracted")
        return 0

    account_id = env("R2_ACCOUNT_ID")
    access_key = env("R2_ACCESS_KEY_ID")
    secret_key = env("R2_SECRET_ACCESS_KEY")
    bucket = env("R2_BUCKET", "trailhead-tiles")
    if not (account_id and access_key and secret_key):
        print("Missing R2 credentials", file=sys.stderr)
        return 2

    target_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = target_dir / Path(artifact_key).name
    r2 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    print(f"Downloading s3://{bucket}/{artifact_key} -> {artifact_path}")
    with artifact_path.open("wb") as fh:
        r2.download_fileobj(bucket, artifact_key, fh)

    if expected_sha:
        actual_sha = sha256_file(artifact_path)
        if actual_sha.lower() != expected_sha.lower():
            print(f"SHA mismatch: expected {expected_sha}, got {actual_sha}", file=sys.stderr)
            return 3

    if tiles_dir.exists():
        shutil.rmtree(tiles_dir)
    if config_path.exists():
        config_path.unlink()
    ready_marker.unlink(missing_ok=True)

    if artifact_path.name.endswith(".zst"):
        subprocess.check_call(["tar", "--zstd", "-xf", str(artifact_path), "-C", str(target_dir)])
    else:
        subprocess.check_call(["tar", "-xf", str(artifact_path), "-C", str(target_dir)])

    if not tiles_dir.exists() or not config_path.exists():
        print("Artifact did not contain valhalla_tiles and valhalla.json", file=sys.stderr)
        return 4

    ready_marker.write_text(artifact_key)
    print("Valhalla artifact extracted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
