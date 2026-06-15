#!/usr/bin/env python3
"""Rebuild the root offline PMTiles manifest from R2 object metadata."""
from __future__ import annotations

import json
import os

import boto3
from botocore.config import Config


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def main() -> int:
    account_id = env("R2_ACCOUNT_ID")
    access_key = env("R2_ACCESS_KEY_ID")
    secret_key = env("R2_SECRET_ACCESS_KEY")
    bucket = env("R2_BUCKET", "trailhead-tiles")
    if not (account_id and access_key and secret_key):
        raise SystemExit("Missing R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY")

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    manifest: dict[str, dict[str, int]] = {}
    token = None
    while True:
        kwargs = {"Bucket": bucket}
        if token:
            kwargs["ContinuationToken"] = token
        page = client.list_objects_v2(**kwargs)
        for obj in page.get("Contents", []):
            key = str(obj.get("Key") or "")
            if "/" in key or not key.endswith(".pmtiles"):
                continue
            manifest[key] = {"size": int(obj.get("Size") or 0)}
        if not page.get("IsTruncated"):
            break
        token = page.get("NextContinuationToken")
    client.put_object(
        Bucket=bucket,
        Key="manifest.json",
        Body=json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"),
        ContentType="application/json",
    )
    print(json.dumps({"count": len(manifest), "pk": manifest.get("pk.pmtiles")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
