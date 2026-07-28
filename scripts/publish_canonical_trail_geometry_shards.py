#!/usr/bin/env python3
"""Publish canonical trail geometry shards to the existing Trailhead R2 bucket."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import boto3
from botocore.config import Config


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "output" / "canonical-trail-geometries-v1"


def _required_env(name: str) -> str:
    value = str(os.getenv(name) or "").strip()
    if not value:
        raise SystemExit(f"Missing {name}")
    return value


def _client():
    account_id = _required_env("R2_ACCOUNT_ID")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=_required_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_required_env("R2_SECRET_ACCESS_KEY"),
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _same_remote(client, bucket: str, key: str, sha256: str, size: int) -> bool:
    try:
        head = client.head_object(Bucket=bucket, Key=key)
    except Exception:
        return False
    metadata = head.get("Metadata") or {}
    return int(head.get("ContentLength") or -1) == size and metadata.get("sha256") == sha256


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--bucket", default=str(os.getenv("R2_BUCKET") or "trailhead-tiles"))
    parser.add_argument("--prefix", default="trails")
    args = parser.parse_args()

    manifest_path = args.input / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"Missing manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1 or not str(manifest.get("revision") or "").startswith("sha256:"):
        raise SystemExit("Invalid canonical trail geometry manifest")

    client = _client()
    uploaded = 0
    skipped = 0
    for shard_key, item in sorted((manifest.get("shards") or {}).items()):
        local_path = args.input / f"{shard_key}.jsonl.gz"
        if not local_path.exists():
            raise SystemExit(f"Missing shard: {local_path}")
        remote_path = str(item.get("path") or "").strip().lstrip("/")
        sha256 = str(item.get("sha256") or "").strip()
        size = int(item.get("size") or 0)
        if local_path.stat().st_size != size:
            raise SystemExit(f"Shard size mismatch: {local_path}")
        object_key = f"{args.prefix.rstrip('/')}/{remote_path}"
        if _same_remote(client, args.bucket, object_key, sha256, size):
            skipped += 1
            continue
        client.put_object(
            Bucket=args.bucket,
            Key=object_key,
            Body=local_path.read_bytes(),
            ContentType="application/gzip",
            CacheControl="public, max-age=31536000, immutable",
            Metadata={"sha256": sha256},
        )
        uploaded += 1

    manifest_bytes = manifest_path.read_bytes()
    client.put_object(
        Bucket=args.bucket,
        Key=f"{args.prefix.rstrip('/')}/canonical-geometries-v1-manifest.json",
        Body=manifest_bytes,
        ContentType="application/json",
        CacheControl="no-cache, max-age=0",
        Metadata={"revision": str(manifest["revision"]).split(":", 1)[1]},
    )
    print(json.dumps({
        "bucket": args.bucket,
        "prefix": args.prefix,
        "revision": manifest["revision"],
        "published_count": manifest.get("published_count"),
        "uploaded_shards": uploaded,
        "unchanged_shards": skipped,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
