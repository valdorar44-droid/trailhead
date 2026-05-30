#!/usr/bin/env python3
"""Upload a completed Valhalla graph artifact to Cloudflare R2.

This is intentionally standalone so it can run from a temporary build VM after
the graph is built on local NVMe. Required env vars match the API service:

  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET

Example:
  python3 scripts/publish_valhalla_artifact.py \
    --artifact /mnt/nvme/valhalla-us/us-full-valhalla.tar.zst \
    --key routing/valhalla/us-full.tar.zst \
    --label us-full
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

import boto3
from botocore.config import Config


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def r2_client():
    account_id = env("R2_ACCOUNT_ID")
    access_key = env("R2_ACCESS_KEY_ID")
    secret_key = env("R2_SECRET_ACCESS_KEY")
    if not (account_id and access_key and secret_key):
        raise SystemExit("Missing R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def sha256_file(path: Path, chunk_size: int = 32 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def upload_multipart(client, bucket: str, key: str, path: Path, content_type: str) -> None:
    size = path.stat().st_size
    part_size = 128 * 1024 * 1024
    upload = client.create_multipart_upload(Bucket=bucket, Key=key, ContentType=content_type)
    upload_id = upload["UploadId"]
    parts: list[dict] = []
    uploaded = 0
    started = time.time()
    try:
        with path.open("rb") as fh:
            part_number = 1
            while True:
                chunk = fh.read(part_size)
                if not chunk:
                    break
                resp = client.upload_part(
                    Bucket=bucket,
                    Key=key,
                    UploadId=upload_id,
                    PartNumber=part_number,
                    Body=chunk,
                )
                parts.append({"PartNumber": part_number, "ETag": resp["ETag"]})
                uploaded += len(chunk)
                elapsed = max(1, int(time.time() - started))
                print(f"{key}: {uploaded / size:.1%} ({uploaded / 1_000_000:.0f}/{size / 1_000_000:.0f} MB, {elapsed}s)", flush=True)
                part_number += 1
        client.complete_multipart_upload(
            Bucket=bucket,
            Key=key,
            MultipartUpload={"Parts": parts},
            UploadId=upload_id,
        )
    except Exception:
        client.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--key", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--manifest-key", default="routing/valhalla/manifest.json")
    parser.add_argument("--content-type", default="application/zstd")
    args = parser.parse_args()

    artifact = args.artifact.resolve()
    if not artifact.exists():
        raise SystemExit(f"Artifact not found: {artifact}")
    bucket = env("R2_BUCKET", "trailhead-tiles")
    client = r2_client()
    size = artifact.stat().st_size
    digest = sha256_file(artifact)

    upload_multipart(client, bucket, args.key, artifact, args.content_type)

    entry = {
        "label": args.label,
        "key": args.key,
        "size": size,
        "sha256": digest,
        "content_type": args.content_type,
        "uploaded_at": int(time.time()),
    }
    manifest = {"artifacts": {args.label: entry}}
    try:
        existing = client.get_object(Bucket=bucket, Key=args.manifest_key)
        manifest = json.loads(existing["Body"].read().decode("utf-8"))
        manifest.setdefault("artifacts", {})[args.label] = entry
    except Exception:
        pass
    client.put_object(
        Bucket=bucket,
        Key=args.manifest_key,
        Body=json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"),
        ContentType="application/json",
    )
    print(json.dumps(entry, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
