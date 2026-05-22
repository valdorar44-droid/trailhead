#!/usr/bin/env python3
"""Build Trailhead contour PMTiles from public Copernicus DEM COGs.

This is the owned contour pipeline. It does not scrape rendered contour tiles.
It builds region packs from source DEM rasters, converts contour lines to MVT,
and writes the same PMTiles contract the mobile app already downloads:

  data/contours/<region>.pmtiles
  data/contours/manifest.json

Required external tools:
  - GDAL: gdalbuildvrt, gdal_contour
  - tippecanoe
  - pmtiles CLI or data/go_pmtiles from the existing bootstrap flow
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


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
    "fi": (19.0, 59.5, 31.6, 70.1),
}

BBOXES: dict[str, tuple[float, float, float, float]] = {**STATE_BBOXES, **REGION_BBOXES}


def need_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(f"Missing required tool: {name}")
    return path


def pmtiles_bin(explicit: str | None = None) -> str:
    if explicit:
        return explicit
    for local in (Path("/data/go_pmtiles"), Path("data/go_pmtiles")):
        if local.exists() and os.access(local, os.X_OK):
            return str(local)
    found = shutil.which("pmtiles")
    if found:
        return found
    raise SystemExit("Missing pmtiles converter. Run backend bootstrap or install pmtiles CLI.")


def lat_token(lat: int) -> str:
    return f"N{lat:02d}_00" if lat >= 0 else f"S{abs(lat):02d}_00"


def lon_token(lon: int) -> str:
    return f"E{lon:03d}_00" if lon >= 0 else f"W{abs(lon):03d}_00"


def copernicus_url(lat: int, lon: int, resolution: int) -> str:
    if resolution == 30:
        bucket = "copernicus-dem-30m"
        arcsec = "10"
    elif resolution == 90:
        bucket = "copernicus-dem-90m"
        arcsec = "30"
    else:
        raise ValueError("resolution must be 30 or 90")
    name = f"Copernicus_DSM_COG_{arcsec}_{lat_token(lat)}_{lon_token(lon)}_DEM"
    return f"https://{bucket}.s3.amazonaws.com/{name}/{name}.tif"


def iter_degrees(bbox: tuple[float, float, float, float]):
    west, south, east, north = bbox
    for lat in range(math.floor(south), math.ceil(north)):
        for lon in range(math.floor(west), math.ceil(east)):
            yield lat, lon


def url_exists(url: str, timeout: float = 6.0) -> bool:
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 400
    except urllib.error.HTTPError as exc:
        return 200 <= exc.code < 400
    except Exception:
        return False


def discover_dem_urls(
    bbox: tuple[float, float, float, float],
    resolution: int,
    fallback_90m: bool,
    workers: int,
) -> list[str]:
    coords = list(iter_degrees(bbox))

    def find_one(coord: tuple[int, int]) -> str | None:
        lat, lon = coord
        primary = copernicus_url(lat, lon, resolution)
        if url_exists(primary):
            return primary
        if resolution == 30 and fallback_90m:
            fallback = copernicus_url(lat, lon, 90)
            if url_exists(fallback):
                return fallback
        return None

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        urls = [url for url in pool.map(find_one, coords) if url]
    return sorted(urls)


def run(cmd: list[str], *, env: dict[str, str] | None = None) -> None:
    print("+ " + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, env=env)


def normalize_feature(raw: dict, unit: str, index_interval: int) -> dict | None:
    props = raw.get("properties") or {}
    try:
        meters = float(props.get("ele"))
    except Exception:
        return None
    if unit == "feet":
        elevation = int(round(meters * 3.280839895))
        unit_label = "ft"
    else:
        elevation = int(round(meters))
        unit_label = "m"
    idx = index_interval > 0 and elevation % index_interval == 0
    raw["properties"] = {"ele": elevation, "idx": idx, "unit": unit_label}
    return raw


def normalize_geojsonseq(raw_path: Path, out_path: Path, unit: str, index_interval: int) -> int:
    count = 0
    with raw_path.open("r", encoding="utf-8") as src, out_path.open("w", encoding="utf-8") as dst:
        for line in src:
            line = line.strip()
            if not line:
                continue
            feature = normalize_feature(json.loads(line), unit, index_interval)
            if not feature:
                continue
            dst.write(json.dumps(feature, separators=(",", ":")) + "\n")
            count += 1
    return count


def write_manifest(out_dir: Path) -> None:
    manifest = {
        path.name: {"size": path.stat().st_size}
        for path in sorted(out_dir.glob("*.pmtiles"))
        if path.is_file()
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def build_region(args: argparse.Namespace, region: str) -> Path:
    bbox = BBOXES[region]
    region_dir = args.work_dir / region
    region_dir.mkdir(parents=True, exist_ok=True)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out_dir / f"{region}.pmtiles"
    if args.skip_existing and out_path.exists() and out_path.stat().st_size > 0:
        print(f"{region}: exists, skipping {out_path}", flush=True)
        return out_path

    started = time.time()
    urls = discover_dem_urls(bbox, args.dem_resolution, args.fallback_90m, args.discover_workers)
    if not urls:
        raise RuntimeError(f"{region}: no Copernicus DEM tiles found for bbox {bbox}")
    url_list = region_dir / "dem-urls.txt"
    url_list.write_text("\n".join(f"/vsicurl/{url}" for url in urls) + "\n")
    print(f"{region}: using {len(urls)} DEM COG tiles", flush=True)

    west, south, east, north = bbox
    vrt = region_dir / "dem.vrt"
    raw_seq = region_dir / "contours.raw.geojsonseq"
    seq = region_dir / "contours.geojsonseq"
    mbtiles = region_dir / "contours.mbtiles"
    tmp_pmtiles = region_dir / "contours.pmtiles"

    run([
        "gdalbuildvrt",
        "-overwrite",
        "-te", str(west), str(south), str(east), str(north),
        "-input_file_list", str(url_list),
        str(vrt),
    ])
    run([
        "gdal_contour",
        "-a", "ele",
        "-i", str(args.interval_meters),
        "-f", "GeoJSONSeq",
        str(vrt),
        str(raw_seq),
    ])
    count = normalize_geojsonseq(raw_seq, seq, args.unit, args.index_interval)
    if count <= 0:
        raise RuntimeError(f"{region}: generated zero contour features")
    print(f"{region}: normalized {count:,} contour features", flush=True)

    if mbtiles.exists():
        mbtiles.unlink()
    if tmp_pmtiles.exists():
        tmp_pmtiles.unlink()
    run([
        "tippecanoe",
        "-o", str(mbtiles),
        "-l", "contours",
        "-Z", str(args.min_zoom),
        "-z", str(args.max_zoom),
        "--force",
        "--drop-densest-as-needed",
        "--extend-zooms-if-still-dropping",
        str(seq),
    ])
    run([pmtiles_bin(args.pmtiles_bin), "convert", str(mbtiles), str(tmp_pmtiles)])
    tmp_pmtiles.replace(out_path)
    write_manifest(args.out_dir)
    elapsed = int(time.time() - started)
    print(f"{region}: wrote {out_path} ({out_path.stat().st_size / 1_048_576:.1f} MiB) in {elapsed}s", flush=True)
    return out_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("regions", nargs="*", help="Region ids, e.g. ks co fi")
    parser.add_argument("--all-states", action="store_true")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--skip-existing", action="store_true")
    parser.add_argument("--dem-resolution", type=int, choices=[30, 90], default=30)
    parser.add_argument("--fallback-90m", action="store_true", default=True)
    parser.add_argument("--interval-meters", type=float, default=20.0)
    parser.add_argument("--unit", choices=["meters", "feet"], default="meters")
    parser.add_argument("--index-interval", type=int, default=100)
    parser.add_argument("--min-zoom", type=int, default=9)
    parser.add_argument("--max-zoom", type=int, default=13)
    parser.add_argument("--discover-workers", type=int, default=16)
    parser.add_argument("--work-dir", type=Path, default=Path(os.environ.get("TRAILHEAD_CONTOUR_WORK_DIR", "/data/contour-work")))
    parser.add_argument("--out-dir", type=Path, default=Path(os.environ.get("TRAILHEAD_CONTOUR_OUT_DIR", "/data/contours")))
    parser.add_argument("--pmtiles-bin", default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    need_tool("gdalbuildvrt")
    need_tool("gdal_contour")
    need_tool("tippecanoe")
    pmtiles_bin(args.pmtiles_bin)

    regions = [r.lower() for r in args.regions]
    if args.all_states:
        regions.extend(STATE_BBOXES.keys())
    if args.all:
        regions.extend(BBOXES.keys())
    regions = list(dict.fromkeys(regions))
    if not regions:
        raise SystemExit("No regions requested. Pass region ids, --all-states, or --all.")
    unknown = [r for r in regions if r not in BBOXES]
    if unknown:
        raise SystemExit(f"Unknown regions: {', '.join(unknown)}")

    for region in regions:
        try:
            build_region(args, region)
        except Exception as exc:
            print(f"{region}: ERROR {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            if len(regions) == 1:
                raise


if __name__ == "__main__":
    main()
