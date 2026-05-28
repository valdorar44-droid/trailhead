#!/usr/bin/env python3
"""Build Safe Water hydro PMTiles from source bathymetry GIS.

This pipeline is intentionally separate from topographic land contours. The
first target is Lake of the Woods using Minnesota DNR Lake Bathymetry data.

Output:
  data/hydro/<region>.pmtiles
  data/hydro/manifest.json

Required external tools for a full source build after source coverage is found:
  - ogrinfo / ogr2ogr
  - tippecanoe
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
import sys
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dashboard.hydro_provider import HYDRO_LAYERS, HYDRO_REGIONS, classify_hazard, depth_band, is_index_depth


DEFAULT_SOURCE_URL = (
    "https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_dnr/"
    "water_lake_bathymetry/gpkg_water_lake_bathymetry.zip"
)


def need_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(f"Missing required tool: {name}")
    return path


def run(cmd: list[str]) -> None:
    print("+ " + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def download(url: str, path: Path) -> Path:
    if path.exists() and path.stat().st_size > 0:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url} -> {path}", flush=True)
    with urllib.request.urlopen(url) as src, path.open("wb") as dst:
        shutil.copyfileobj(src, dst)
    return path


def extract_source(zip_path: Path, work_dir: Path) -> Path:
    unpacked = work_dir / "source"
    unpacked.mkdir(parents=True, exist_ok=True)
    marker = unpacked / ".extracted"
    if not marker.exists():
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(unpacked)
        marker.write_text(str(time.time()))
    for suffix in ("*.gpkg", "*.gdb", "*.shp"):
        matches = sorted(unpacked.rglob(suffix))
        if matches:
            return matches[0]
    raise SystemExit(f"No GeoPackage, file geodatabase, or shapefile found in {zip_path}")


def ogr_layers(dataset: Path) -> list[str]:
    try:
        import pyogrio

        return [str(row[0]) for row in pyogrio.list_layers(dataset)]
    except Exception:
        pass

    need_tool("ogrinfo")
    out = subprocess.check_output(["ogrinfo", "-ro", "-q", str(dataset)], text=True)
    layers = []
    for line in out.splitlines():
        line = line.strip()
        if ":" not in line:
            continue
        _, name = line.split(":", 1)
        layers.append(name.strip().split(" ")[0])
    return layers


def choose_layer(layers: list[str], candidates: list[str]) -> str:
    lower = {layer.lower(): layer for layer in layers}
    for candidate in candidates:
        for key, layer in lower.items():
            if candidate in key:
                return layer
    raise SystemExit(f"Could not find layer matching {candidates}; available layers: {', '.join(layers)}")


def bbox_feature_count(dataset: Path, layer: str, bbox: Any) -> int | None:
    try:
        import pyogrio

        frame = pyogrio.read_dataframe(
            dataset,
            layer=layer,
            bbox=(bbox.west, bbox.south, bbox.east, bbox.north),
            columns=[],
        )
        return len(frame)
    except Exception as exc:
        print(f"warning: could not probe {layer} with pyogrio: {exc}", flush=True)
        return None


def numeric_prop(props: dict[str, Any], keys: list[str]) -> float | None:
    lower = {str(k).lower(): v for k, v in props.items()}
    for key in keys:
        value = lower.get(key)
        if value in (None, ""):
            continue
        try:
            return abs(float(value))
        except Exception:
            continue
    return None


def normalize_contours(raw_path: Path, out_path: Path) -> int:
    count = 0
    with raw_path.open("r", encoding="utf-8") as src, out_path.open("w", encoding="utf-8") as dst:
        for line in src:
            if not line.strip():
                continue
            feature = json.loads(line)
            props = feature.get("properties") or {}
            depth_ft = numeric_prop(props, ["depth", "depth_ft", "contour", "contour_ft", "elev", "elevation"])
            if depth_ft is None:
                continue
            feature["properties"] = {
                "depth_ft": round(depth_ft, 1),
                "depth_label": f"{round(depth_ft):.0f}'",
                "idx": is_index_depth(depth_ft),
                "unit": "ft",
                "source": "Minnesota DNR Lake Bathymetry",
                "confidence": "state_public_gis",
                "navigation_note": "Bathymetry awareness only; verify with official charts and local conditions.",
            }
            dst.write(json.dumps(feature, separators=(",", ":")) + "\n")
            count += 1
    return count


def normalize_depth_areas(raw_path: Path, out_path: Path) -> tuple[int, int]:
    areas = 0
    hazards = 0
    hazard_path = out_path.with_name("reef_hazards.geojsonseq")
    with raw_path.open("r", encoding="utf-8") as src, out_path.open("w", encoding="utf-8") as dst, hazard_path.open("w", encoding="utf-8") as hz:
        for line in src:
            if not line.strip():
                continue
            feature = json.loads(line)
            props = feature.get("properties") or {}
            depth_ft = numeric_prop(props, ["depth", "depth_ft", "max_depth", "maxdepth", "contour", "contour_ft"])
            if depth_ft is None:
                continue
            band = depth_band(depth_ft)
            feature["properties"] = {
                "max_depth_ft": round(depth_ft, 1),
                "depth_band": band,
                "source": "Minnesota DNR Lake Bathymetry",
                "confidence": "derived",
                "navigation_note": "Derived shallow-water awareness only; not a navigational chart.",
            }
            dst.write(json.dumps(feature, separators=(",", ":")) + "\n")
            areas += 1
            hazard = classify_hazard(depth_ft, source_tags=props)
            if hazard:
                hazard_feature = dict(feature)
                hazard_feature["properties"] = {
                    **feature["properties"],
                    **hazard,
                    "label": hazard["kind"].replace("_", " ").title(),
                }
                hz.write(json.dumps(hazard_feature, separators=(",", ":")) + "\n")
                hazards += 1
    return areas, hazards


def write_manifest(out_dir: Path, region: str, counts: dict[str, int]) -> None:
    packs = {}
    for path in sorted(out_dir.glob("*.pmtiles")):
        packs[path.name] = {
            "size": path.stat().st_size,
            "region": path.stem,
            "generated_at": int(time.time()),
            "counts": counts if path.stem == region else {},
        }
    manifest = {
        "version": 1,
        "mode": "safe_water_awareness",
        "generated_at": int(time.time()),
        "layers": HYDRO_LAYERS,
        "warning": "Informational awareness only; not certified navigation.",
        "packs": packs,
        "regions": [
            {
                "id": region_meta.id,
                "name": region_meta.name,
                "file": region_meta.file,
                "bounds": region_meta.bounds.__dict__,
                "layers": HYDRO_LAYERS,
                "source": region_meta.source,
                "confidence": region_meta.confidence,
                "status": region_meta.status,
                "offline": region_meta.offline,
                "coverage_note": region_meta.coverage_note,
                "available": region_meta.file in packs,
                "counts": counts if region_meta.id == region else {},
            }
            for region_meta in HYDRO_REGIONS.values()
        ],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("region", choices=sorted(HYDRO_REGIONS), default="mn-lotw", nargs="?")
    parser.add_argument("--source-url", default=DEFAULT_SOURCE_URL)
    parser.add_argument("--source-zip", type=Path)
    parser.add_argument("--work-dir", type=Path, default=Path(os.environ.get("TRAILHEAD_HYDRO_WORK_DIR", "/data/hydro-work")))
    parser.add_argument("--out-dir", type=Path, default=Path(os.environ.get("TRAILHEAD_HYDRO_OUT_DIR", "data/hydro")))
    parser.add_argument("--contour-layer", default="")
    parser.add_argument("--area-layer", default="")
    parser.add_argument("--min-zoom", type=int, default=8)
    parser.add_argument("--max-zoom", type=int, default=15)
    args = parser.parse_args()

    region = HYDRO_REGIONS[args.region]
    source_id = str((region.source or {}).get("id") or "")
    if source_id != "mn_dnr_lake_bathymetry":
        raise SystemExit(
            f"{args.region} is {region.status}: {region.coverage_note} "
            "No offline PMTiles are generated from this source."
        )
    bbox = region.bounds
    args.work_dir.mkdir(parents=True, exist_ok=True)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    source_zip = args.source_zip or download(args.source_url, args.work_dir / "mn-dnr-lake-bathymetry.gpkg.zip")
    dataset = extract_source(source_zip, args.work_dir)
    layers = ogr_layers(dataset)
    contour_layer = args.contour_layer or choose_layer(layers, ["contour", "bathy_cont"])
    area_layer = args.area_layer or choose_layer(layers, ["outline", "depth", "bathy"])

    contour_probe = bbox_feature_count(dataset, contour_layer, bbox)
    if contour_probe == 0:
        write_manifest(args.out_dir, args.region, {
            "contours": 0,
            "shallow_zones": 0,
            "hazards": 0,
            "labels": 0,
        })
        raise SystemExit(
            f"No bathymetry contour features found for {args.region} in {contour_layer}; "
            "not writing a synthetic PMTiles pack."
        )

    need_tool("ogr2ogr")
    need_tool("tippecanoe")

    raw_contours = args.work_dir / "depth_contours.raw.geojsonseq"
    depth_contours = args.work_dir / "depth_contours.geojsonseq"
    raw_areas = args.work_dir / "depth_areas.raw.geojsonseq"
    depth_areas = args.work_dir / "depth_areas.geojsonseq"
    reef_hazards = args.work_dir / "reef_hazards.geojsonseq"

    spat = [str(bbox.west), str(bbox.south), str(bbox.east), str(bbox.north)]
    run(["ogr2ogr", "-f", "GeoJSONSeq", str(raw_contours), str(dataset), contour_layer, "-spat", *spat, "-t_srs", "EPSG:4326"])
    run(["ogr2ogr", "-f", "GeoJSONSeq", str(raw_areas), str(dataset), area_layer, "-spat", *spat, "-t_srs", "EPSG:4326"])

    contour_count = normalize_contours(raw_contours, depth_contours)
    area_count, hazard_count = normalize_depth_areas(raw_areas, depth_areas)
    labels_count = contour_count
    hydro_labels = depth_contours

    pmtiles_path = args.out_dir / f"{args.region}.pmtiles"
    if pmtiles_path.exists():
        pmtiles_path.unlink()
    run([
        "tippecanoe",
        "-o", str(pmtiles_path),
        "--force",
        "--minimum-zoom", str(args.min_zoom),
        "--maximum-zoom", str(args.max_zoom),
        "-L", f"depth_contours:{depth_contours}",
        "-L", f"depth_areas:{depth_areas}",
        "-L", f"reef_hazards:{reef_hazards}",
        "-L", f"hydro_labels:{hydro_labels}",
    ])

    write_manifest(args.out_dir, args.region, {
        "contours": contour_count,
        "shallow_zones": area_count,
        "hazards": hazard_count,
        "labels": labels_count,
    })
    print(f"wrote {pmtiles_path}", flush=True)


if __name__ == "__main__":
    main()
