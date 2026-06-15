#!/usr/bin/env python3
"""Publish one generated trail region pack to R2 using S3 credentials."""
from __future__ import annotations

import argparse
import json
import os
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


def upload_file(client, bucket: str, key: str, path: Path, content_type: str) -> None:
    size = path.stat().st_size
    if size < 64 * 1024 * 1024:
        client.put_object(Bucket=bucket, Key=key, Body=path.read_bytes(), ContentType=content_type)
        print(f"{key}: uploaded {size} bytes")
        return

    upload = client.create_multipart_upload(Bucket=bucket, Key=key, ContentType=content_type)
    upload_id = upload["UploadId"]
    parts: list[dict] = []
    part_size = 64 * 1024 * 1024
    sent = 0
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
                sent += len(chunk)
                print(f"{key}: {sent / size:.1%}", flush=True)
                part_number += 1
        client.complete_multipart_upload(
            Bucket=bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )
    except Exception:
        client.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("region")
    parser.add_argument("--data-dir", type=Path, default=Path("data/trails"))
    parser.add_argument("--bucket", default=env("R2_BUCKET", "trailhead-tiles"))
    args = parser.parse_args()

    region = args.region.lower()
    region_dir = args.data_dir / region
    files = {
        f"{region}.pmtiles": (region_dir / "trails.pmtiles", "application/vnd.pmtiles"),
        f"{region}.graph.json": (region_dir / "trail_graph.json", "application/json"),
        f"{region}.route.jsonl.gz": (region_dir / "trail_route_graph.jsonl.gz", "application/gzip"),
    }
    missing = [str(path) for path, _content_type in files.values() if not path.exists()]
    if missing:
        raise SystemExit(f"Missing trail artifacts: {', '.join(missing)}")

    client = r2_client()
    for name, (path, content_type) in files.items():
        upload_file(client, args.bucket, f"trails/{name}", path, content_type)

    manifest_key = "trails/manifest.json"
    try:
        obj = client.get_object(Bucket=args.bucket, Key=manifest_key)
        manifest = json.loads(obj["Body"].read().decode("utf-8"))
        if not isinstance(manifest, dict):
            manifest = {}
    except Exception:
        manifest = {}
    for name, (path, _content_type) in files.items():
        manifest[name] = {"size": path.stat().st_size}
    client.put_object(
        Bucket=args.bucket,
        Key=manifest_key,
        Body=json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"),
        ContentType="application/json",
    )
    print(json.dumps({name: manifest[name] for name in files}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
