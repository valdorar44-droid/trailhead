#!/usr/bin/env python3
"""Build region contour PMTiles from OSM US contour vector tiles.

This is an extraction/validation tool for Trailhead's separate offline contour
pack lane. It fetches contour-only MVT tiles for a bbox and writes a compact
PMTiles archive that the mobile app can download independently of base maps.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write


TILE_URL = "https://tiles.openstreetmap.us/vector/contours-feet/{z}/{x}/{y}.mvt"

STATE_BBOXES: dict[str, tuple[float, float, float, float]] = {
    "ak": (-168.0, 54.6, -130.0, 71.4),
    "al": (-88.5, 30.2, -84.9, 35.0),
    "ar": (-94.6, 33.0, -89.6, 36.5),
    "az": (-114.8, 31.3, -109.0, 37.0),
    "ca": (-124.4, 32.5, -114.1, 42.0),
    "co": (-109.1, 37.0, -102.0, 41.0),
    "ct": (-73.7, 41.0, -71.8, 42.1),
    "de": (-75.8, 38.4, -75.0, 39.8),
    "fl": (-87.6, 24.5, -80.0, 31.0),
    "ga": (-85.6, 30.4, -80.8, 35.0),
    "hi": (-160.2, 18.9, -154.8, 22.2),
    "ia": (-96.6, 40.4, -90.1, 43.5),
    "id": (-117.2, 42.0, -111.0, 49.0),
    "il": (-91.5, 36.9, -87.0, 42.5),
    "in": (-88.1, 37.8, -84.8, 41.8),
    "ks": (-102.1, 36.9, -94.6, 40.0),
    "ky": (-89.6, 36.5, -81.9, 39.1),
    "la": (-94.0, 28.9, -88.8, 33.0),
    "ma": (-73.5, 41.2, -69.9, 42.9),
    "md": (-79.5, 37.9, -75.0, 39.7),
    "me": (-71.1, 43.1, -66.9, 47.5),
    "mi": (-90.4, 41.7, -82.4, 48.3),
    "mn": (-97.2, 43.5, -89.5, 49.4),
    "mo": (-95.8, 35.9, -89.1, 40.6),
    "ms": (-91.7, 30.2, -88.1, 35.0),
    "mt": (-116.0, 44.4, -104.0, 49.0),
    "nc": (-84.3, 33.8, -75.5, 36.6),
    "nd": (-104.1, 45.9, -96.6, 49.0),
    "ne": (-104.1, 40.0, -95.3, 43.0),
    "nh": (-72.6, 42.7, -70.6, 45.3),
    "nj": (-75.6, 38.9, -73.9, 41.4),
    "nm": (-109.1, 31.3, -103.0, 37.0),
    "nv": (-120.0, 35.0, -114.0, 42.0),
    "ny": (-79.8, 40.5, -71.8, 45.0),
    "oh": (-84.8, 38.4, -80.5, 42.0),
    "ok": (-103.0, 33.6, -94.4, 37.0),
    "or": (-124.6, 41.9, -116.5, 46.3),
    "pa": (-80.5, 39.7, -74.7, 42.3),
    "ri": (-71.9, 41.1, -71.1, 42.0),
    "sc": (-83.4, 32.0, -78.5, 35.2),
    "sd": (-104.1, 42.5, -96.4, 45.9),
    "tn": (-90.3, 35.0, -81.6, 36.7),
    "tx": (-106.6, 25.8, -93.5, 36.5),
    "ut": (-114.1, 36.9, -109.0, 42.0),
    "va": (-83.7, 36.5, -75.2, 39.5),
    "vt": (-73.4, 42.7, -71.5, 45.0),
    "wa": (-124.7, 45.5, -116.9, 49.0),
    "wi": (-92.9, 42.5, -86.2, 47.1),
    "wv": (-82.6, 37.2, -77.7, 40.6),
    "wy": (-111.1, 41.0, -104.1, 45.0),
}

REGION_BBOXES: dict[str, tuple[float, float, float, float]] = {
    "canada": (-141.1, 41.7, -52.6, 83.2),
    "mexico": (-118.6, 14.5, -86.7, 32.8),
}

BBOXES: dict[str, tuple[float, float, float, float]] = {**STATE_BBOXES, **REGION_BBOXES}


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    lat = max(min(lat, 85.05112878), -85.05112878)
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def iter_tiles(bbox: tuple[float, float, float, float], min_zoom: int, max_zoom: int):
    west, south, east, north = bbox
    for z in range(min_zoom, max_zoom + 1):
        min_x, min_y = lonlat_to_tile(west, north, z)
        max_x, max_y = lonlat_to_tile(east, south, z)
        for x in range(min_x, max_x + 1):
            for y in range(min_y, max_y + 1):
                yield z, x, y


def fetch_tile(z: int, x: int, y: int, retries: int) -> bytes | None:
    url = TILE_URL.format(z=z, x=x, y=y)
    for attempt in range(retries + 1):
        proc = subprocess.run(
            ["curl", "-s", "-L", "--fail", "--connect-timeout", "8", "--max-time", "20", url],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        if proc.returncode == 0 and proc.stdout:
            return proc.stdout
        if attempt < retries:
            time.sleep(0.4 * (attempt + 1))
    return None


def build_pack(
    region: str,
    bbox: tuple[float, float, float, float],
    min_zoom: int,
    max_zoom: int,
    out_dir: Path,
    skip_existing: bool = False,
    workers: int = 12,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{region}.pmtiles"
    if skip_existing and out_path.exists() and out_path.stat().st_size > 0:
        print(f"{region}: exists, skipping {out_path}", flush=True)
        return out_path
    tmp_path = out_path.with_suffix(".pmtiles.tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    tiles = list(iter_tiles(bbox, min_zoom, max_zoom))
    written = 0
    started = time.time()
    west, south, east, north = bbox
    header = {
        "tile_compression": Compression.NONE,
        "tile_type": TileType.MVT,
        "min_lon_e7": round(west * 10_000_000),
        "min_lat_e7": round(south * 10_000_000),
        "max_lon_e7": round(east * 10_000_000),
        "max_lat_e7": round(north * 10_000_000),
        "center_zoom": min(max_zoom, max(min_zoom, 10)),
        "center_lon_e7": round(((west + east) / 2.0) * 10_000_000),
        "center_lat_e7": round(((south + north) / 2.0) * 10_000_000),
    }
    metadata = {
        "name": f"{region} contours",
        "description": "Topographic contour lines in feet, extracted from OpenStreetMap US contours-feet tiles.",
        "version": "1",
        "bounds": [west, south, east, north],
        "center": [(west + east) / 2.0, (south + north) / 2.0, min(max_zoom, max(min_zoom, 10))],
        "minzoom": min_zoom,
        "maxzoom": max_zoom,
        "type": "overlay",
        "format": "pbf",
        "vector_layers": [
            {"id": "contours", "fields": {"ele": "Number", "idx": "Boolean"}},
        ],
        "attribution": "OpenStreetMap US, Mapzen DEM, GDAL",
    }

    def fetch_one(tile: tuple[int, int, int]) -> tuple[int, int, int, bytes | None]:
        z, x, y = tile
        return z, x, y, fetch_tile(z, x, y, retries=2)

    with write(str(tmp_path)) as writer:
        with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            for idx, (z, x, y, data) in enumerate(pool.map(fetch_one, tiles), start=1):
                if data:
                    writer.write_tile(zxy_to_tileid(z, x, y), data)
                    written += 1
                if idx == 1 or idx % 250 == 0 or idx == len(tiles):
                    elapsed = max(1, int(time.time() - started))
                    print(f"{region}: {idx}/{len(tiles)} checked · {written} tiles written · {elapsed}s", flush=True)
        if written == 0:
            raise RuntimeError(f"No contour tiles fetched for {region}")
        writer.finalize(header, metadata)

    tmp_path.rename(out_path)
    manifest_path = out_dir / "manifest.json"
    manifest: dict[str, dict[str, int]] = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    manifest[f"{region}.pmtiles"] = {"size": out_path.stat().st_size}
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"{region}: wrote {out_path} ({out_path.stat().st_size / 1_048_576:.1f} MiB)", flush=True)
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("regions", nargs="*", help="Region ids, e.g. ks co ut")
    parser.add_argument("--all-states", action="store_true", help="Extract all 50 state contour packs")
    parser.add_argument("--all", action="store_true", help="Extract all state and country/large-region contour packs")
    parser.add_argument("--skip-existing", action="store_true", help="Skip packs that already exist on disk")
    parser.add_argument("--workers", type=int, default=12, help="Concurrent tile fetches per region")
    parser.add_argument("--min-zoom", type=int, default=8)
    parser.add_argument("--max-zoom", type=int, default=12)
    parser.add_argument("--out-dir", type=Path, default=Path("data/contours"))
    args = parser.parse_args()

    regions = [r.lower() for r in args.regions]
    if args.all_states:
        regions.extend(STATE_BBOXES.keys())
    if args.all:
        regions.extend(BBOXES.keys())
    regions = list(dict.fromkeys(regions))
    if not regions:
        raise SystemExit("No regions requested. Pass region ids, --all-states, or --all.")

    for region in regions:
        bbox = BBOXES.get(region)
        if not bbox:
            raise SystemExit(f"Unknown region {region}. Known: {', '.join(sorted(BBOXES))}")
        build_pack(region, bbox, args.min_zoom, args.max_zoom, args.out_dir, args.skip_existing, args.workers)


if __name__ == "__main__":
    main()
