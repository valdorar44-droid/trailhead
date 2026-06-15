#!/usr/bin/env python3
"""Publish one app-compatible offline routing tar to R2."""
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


def upload_multipart(client, bucket: str, key: str, path: Path) -> None:
    size = path.stat().st_size
    upload = client.create_multipart_upload(Bucket=bucket, Key=key, ContentType="application/x-tar")
    upload_id = upload["UploadId"]
    parts: list[dict] = []
    sent = 0
    part_size = 128 * 1024 * 1024
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


def rebuild_manifest(client, bucket: str) -> dict[str, dict[str, int]]:
    manifest: dict[str, dict[str, int]] = {}
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": "routing/"}
        if token:
            kwargs["ContinuationToken"] = token
        page = client.list_objects_v2(**kwargs)
        for obj in page.get("Contents", []):
            key = str(obj.get("Key") or "")
            name = key.removeprefix("routing/")
            if "/" in name or not name.endswith((".tar", ".tar.gz")):
                continue
            manifest[name] = {"size": int(obj.get("Size") or 0)}
        if not page.get("IsTruncated"):
            break
        token = page.get("NextContinuationToken")
    client.put_object(
        Bucket=bucket,
        Key="routing/manifest.json",
        Body=json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"),
        ContentType="application/json",
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("region")
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--bucket", default=env("R2_BUCKET", "trailhead-tiles"))
    args = parser.parse_args()

    region = args.region.lower()
    artifact = args.artifact.resolve()
    if not artifact.exists():
        raise SystemExit(f"Artifact not found: {artifact}")
    client = r2_client()
    key = f"routing/{region}.tar"
    upload_multipart(client, args.bucket, key, artifact)
    manifest = rebuild_manifest(client, args.bucket)
    print(json.dumps({"count": len(manifest), f"{region}.tar": manifest.get(f"{region}.tar")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
