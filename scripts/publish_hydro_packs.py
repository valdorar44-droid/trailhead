#!/usr/bin/env python3
"""Upload generated Safe Water hydro PMTiles to Cloudflare R2.

Publishes:
  hydro/<region>.pmtiles
  hydro/manifest.json
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
from pathlib import Path

import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config.settings import settings


PART_SIZE = 64 * 1024 * 1024


def r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload_file(bucket: str, key: str, path: Path) -> None:
    r2 = r2_client()
    size = path.stat().st_size
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if path.suffix == ".pmtiles":
        content_type = "application/vnd.pmtiles"
    if size <= PART_SIZE:
        r2.put_object(Bucket=bucket, Key=key, Body=path.read_bytes(), ContentType=content_type)
        return

    mpu = r2.create_multipart_upload(Bucket=bucket, Key=key, ContentType=content_type)
    upload_id = mpu["UploadId"]
    parts = []
    uploaded = 0
    try:
        with path.open("rb") as fh:
            part_num = 1
            while True:
                chunk = fh.read(PART_SIZE)
                if not chunk:
                    break
                resp = r2.upload_part(
                    Bucket=bucket,
                    Key=key,
                    UploadId=upload_id,
                    PartNumber=part_num,
                    Body=chunk,
                )
                parts.append({"PartNumber": part_num, "ETag": resp["ETag"]})
                uploaded += len(chunk)
                print(f"{key}: uploading {round(uploaded / size * 100)}%", flush=True)
                part_num += 1
        r2.complete_multipart_upload(
            Bucket=bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )
    except Exception:
        r2.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("regions", nargs="*", help="Hydro region ids. Defaults to all local hydro PMTiles.")
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("TRAILHEAD_HYDRO_OUT_DIR", "data/hydro")))
    parser.add_argument("--bucket", default="trailhead-tiles")
    args = parser.parse_args()

    regions = [r.lower() for r in args.regions]
    if not regions:
        regions = sorted(path.stem for path in args.data_dir.glob("*.pmtiles"))
    if not regions:
        raise SystemExit(f"No hydro PMTiles found in {args.data_dir}")

    for region in regions:
        path = args.data_dir / f"{region}.pmtiles"
        if not path.exists():
            print(f"{region}: missing {path}, skipping", flush=True)
            continue
        key = f"hydro/{region}.pmtiles"
        print(f"{region}: uploading {path} -> {key}", flush=True)
        upload_file(args.bucket, key, path)

    manifest_path = args.data_dir / "manifest.json"
    if not manifest_path.exists():
        manifest = {
            "version": 1,
            "mode": "safe_water_awareness",
            "packs": {
                f"{region}.pmtiles": {"size": (args.data_dir / f"{region}.pmtiles").stat().st_size, "region": region}
                for region in regions
                if (args.data_dir / f"{region}.pmtiles").exists()
            },
        }
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    upload_file(args.bucket, "hydro/manifest.json", manifest_path)
    print("published hydro manifest", flush=True)


if __name__ == "__main__":
    main()
