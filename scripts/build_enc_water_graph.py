#!/usr/bin/env python3
"""Build Safe Water advisory routing graphs from S-57 ENC exchange sets.

NOAA ENC packages can be downloaded for U.S. waters. Canadian CHS ENC test
builds must use a local licensed exchange set supplied with --source-zip or
--source-dir.
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
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dashboard.marine_chart_provider import MarineBounds


NOAA_MN_ENC_URL = "https://www.charts.noaa.gov/ENCs/MN_ENCs.zip"

REGIONS: dict[str, dict[str, Any]] = {
    "mn-noaa-enc-test": {
        "name": "Minnesota NOAA ENC test",
        "bounds": MarineBounds(north=48.7, south=46.4, east=-89.0, west=-92.5),
        "source": {
            "id": "noaa_enc",
            "name": "NOAA ENC",
            "url": NOAA_MN_ENC_URL,
            "license": "NOAA public ENC package; verify current NOAA terms before redistribution.",
        },
        "default_url": NOAA_MN_ENC_URL,
        "confidence": "official_noaa_enc_advisory_graph",
    },
    "ca-lotw-enc-test": {
        "name": "Canada Lake of the Woods ENC test",
        "bounds": MarineBounds(north=49.45, south=48.7, east=-93.6, west=-95.4),
        "source": {
            "id": "chs_enc_local",
            "name": "CHS ENC local test",
            "url": "https://charts.gc.ca/",
            "license": "Local licensed/test exchange set only; do not redistribute without approved CHS rights.",
        },
        "default_url": "",
        "confidence": "licensed_chs_enc_test_advisory_graph",
    },
}

ROUTING_LAYERS = [
    "RECTRC",
    "RCRTCL",
    "DWRTCL",
    "FAIRWY",
    "NAVLNE",
    "TSSLPT",
    "TSELNE",
    "PRCARE",
]


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


def extract_zip(zip_path: Path, work_dir: Path) -> Path:
    target = work_dir / zip_path.stem
    marker = target / ".extracted"
    if not marker.exists():
        target.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(target)
        marker.write_text(str(time.time()))
    return target


def find_s57_cells(source_dir: Path) -> list[Path]:
    cells = []
    for path in source_dir.rglob("*"):
        if path.is_file() and path.suffix.lower() == ".000":
            cells.append(path)
    return sorted(cells)


def ogr_layers(dataset: Path) -> list[str]:
    try:
        import pyogrio  # type: ignore

        return [str(row[0]) for row in pyogrio.list_layers(dataset)]
    except Exception:
        pass

    need_tool("ogrinfo")
    out = subprocess.check_output(["ogrinfo", "-ro", "-q", str(dataset)], text=True)
    layers: list[str] = []
    for line in out.splitlines():
        line = line.strip()
        if ":" not in line:
            continue
        _, name = line.split(":", 1)
        layer = name.strip().split(" ")[0]
        if layer:
            layers.append(layer)
    return layers


def convert_layer(dataset: Path, layer: str, out_path: Path, bounds: MarineBounds) -> bool:
    need_tool("ogr2ogr")
    if out_path.exists():
        out_path.unlink()
    spat = [str(bounds.west), str(bounds.south), str(bounds.east), str(bounds.north)]
    cmd = [
        "ogr2ogr",
        "-f",
        "GeoJSONSeq",
        str(out_path),
        str(dataset),
        layer,
        "-spat",
        *spat,
        "-t_srs",
        "EPSG:4326",
    ]
    try:
        run(cmd)
    except subprocess.CalledProcessError:
        return False
    return out_path.exists() and out_path.stat().st_size > 0


def read_layer_features(dataset: Path, layer: str, bounds: MarineBounds) -> list[dict[str, Any]] | None:
    try:
        import pyogrio  # type: ignore

        frame = pyogrio.read_dataframe(
            dataset,
            layer=layer,
            bbox=(bounds.west, bounds.south, bounds.east, bounds.north),
        )
        features: list[dict[str, Any]] = []
        for _, row in frame.iterrows():
            geom = row.get("geometry")
            if geom is None:
                continue
            try:
                geometry = geom.__geo_interface__
            except Exception:
                continue
            props: dict[str, Any] = {}
            for key, value in row.items():
                if key == "geometry":
                    continue
                if value is None:
                    continue
                if hasattr(value, "item"):
                    try:
                        value = value.item()
                    except Exception:
                        pass
                if isinstance(value, float) and math.isnan(value):
                    continue
                props[str(key)] = value
            features.append({"type": "Feature", "geometry": geometry, "properties": props})
        return features
    except Exception:
        return None


def flatten_lines(geometry: dict[str, Any]) -> list[list[list[float]]]:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if gtype == "LineString":
        return [_clean_line(coords)]
    if gtype == "MultiLineString":
        return [_clean_line(line) for line in coords]
    if gtype == "Polygon":
        return [_clean_line(ring) for ring in coords[:1]]
    if gtype == "MultiPolygon":
        lines: list[list[list[float]]] = []
        for polygon in coords:
            if polygon:
                lines.append(_clean_line(polygon[0]))
        return lines
    return []


def _clean_line(coords: Any) -> list[list[float]]:
    line: list[list[float]] = []
    for coord in coords or []:
        if not isinstance(coord, (list, tuple)) or len(coord) < 2:
            continue
        try:
            lng = round(float(coord[0]), 6)
            lat = round(float(coord[1]), 6)
        except Exception:
            continue
        if not line or line[-1] != [lng, lat]:
            line.append([lng, lat])
    return line


def haversine_m(a: list[float], b: list[float]) -> float:
    r = 6371000.0
    lat1 = math.radians(a[1])
    lat2 = math.radians(b[1])
    dphi = math.radians(b[1] - a[1])
    dlambda = math.radians(b[0] - a[0])
    h = math.sin(dphi / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def node_key(coord: list[float]) -> str:
    return f"{round(coord[0], 5):.5f},{round(coord[1], 5):.5f}"


def build_graph(features: list[dict[str, Any]]) -> tuple[list[list[float]], list[list[Any]]]:
    node_index: dict[str, int] = {}
    nodes: list[list[float]] = []
    edges: list[list[Any]] = []
    seen_edges: set[tuple[int, int, str]] = set()

    def get_node(coord: list[float]) -> int:
        key = node_key(coord)
        if key not in node_index:
            node_index[key] = len(nodes)
            nodes.append([round(coord[0], 6), round(coord[1], 6)])
        return node_index[key]

    for feature in features:
        props = feature.get("properties") or {}
        layer = str(props.get("layer") or "")
        for line in flatten_lines(feature.get("geometry") or {}):
            if len(line) < 2:
                continue
            previous_idx = get_node(line[0])
            previous_coord = line[0]
            for coord in line[1:]:
                idx = get_node(coord)
                dist = haversine_m(previous_coord, coord)
                key = (min(previous_idx, idx), max(previous_idx, idx), layer)
                if dist > 0 and key not in seen_edges:
                    seen_edges.add(key)
                    edges.append([previous_idx, idx, round(dist, 1), layer, props.get("name") or ""])
                previous_idx = idx
                previous_coord = coord
    return nodes, edges


def read_features(path: Path, layer: str, source_cell: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                feature = json.loads(line)
            except Exception:
                continue
            geometry = feature.get("geometry") or {}
            if geometry.get("type") not in {"LineString", "MultiLineString", "Polygon", "MultiPolygon"}:
                continue
            props = feature.get("properties") or {}
            feature["properties"] = {
                "layer": layer,
                "cell": source_cell,
                "name": props.get("OBJNAM") or props.get("name") or "",
                "category": props.get("CATTRK") or props.get("CATFAI") or props.get("CATNAV") or "",
            }
            out.append(feature)
    return out


def normalize_features(raw_features: list[dict[str, Any]], layer: str, source_cell: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for feature in raw_features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in {"LineString", "MultiLineString", "Polygon", "MultiPolygon"}:
            continue
        props = feature.get("properties") or {}
        feature["properties"] = {
            "layer": layer,
            "cell": source_cell,
            "name": props.get("OBJNAM") or props.get("name") or "",
            "category": props.get("CATTRK") or props.get("CATFAI") or props.get("CATNAV") or "",
        }
        out.append(feature)
    return out


def write_geojson(path: Path, features: list[dict[str, Any]], metadata: dict[str, Any]) -> None:
    payload = {
        "type": "FeatureCollection",
        "properties": metadata,
        "features": features,
    }
    path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("region", choices=sorted(REGIONS))
    parser.add_argument("--source-url", default="")
    parser.add_argument("--source-zip", type=Path)
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--work-dir", type=Path, default=Path(os.environ.get("TRAILHEAD_ENC_WORK_DIR", "/data/water-routing-work")))
    parser.add_argument("--out-dir", type=Path, default=Path(os.environ.get("TRAILHEAD_WATER_ROUTING_OUT_DIR", "data/water-routing")))
    args = parser.parse_args()

    config = REGIONS[args.region]
    bounds: MarineBounds = config["bounds"]
    args.work_dir.mkdir(parents=True, exist_ok=True)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    if args.source_dir:
        source_dir = args.source_dir
    else:
        source_zip = args.source_zip
        source_url = args.source_url or config.get("default_url") or ""
        if not source_zip:
            if not source_url:
                raise SystemExit(f"{args.region} requires --source-zip or --source-dir for a licensed local ENC exchange set.")
            source_zip = download(source_url, args.work_dir / f"{args.region}.zip")
        source_dir = extract_zip(source_zip, args.work_dir)

    cells = find_s57_cells(source_dir)
    if not cells:
        raise SystemExit(f"No .000 S-57 ENC cells found under {source_dir}")

    features: list[dict[str, Any]] = []
    layer_counts: dict[str, int] = {}
    for cell in cells:
        try:
            available = set(ogr_layers(cell))
        except Exception as exc:
            print(f"warning: skipping {cell}: {exc}", flush=True)
            continue
        for layer in ROUTING_LAYERS:
            if layer not in available:
                continue
            raw_features = read_layer_features(cell, layer, bounds)
            layer_features = normalize_features(raw_features, layer, cell.stem) if raw_features is not None else []
            if raw_features is None:
                raw_path = args.work_dir / f"{cell.stem}.{layer}.geojsonseq"
                if not convert_layer(cell, layer, raw_path, bounds):
                    continue
                layer_features = read_features(raw_path, layer, cell.stem)
            if layer_features:
                features.extend(layer_features)
                layer_counts[layer] = layer_counts.get(layer, 0) + len(layer_features)

    nodes, edges = build_graph(features)
    graph = {
        "version": 1,
        "mode": "safe_water_advisory_routing",
        "region": args.region,
        "name": config["name"],
        "generated_at": int(time.time()),
        "bounds": bounds.__dict__,
        "source": config["source"],
        "confidence": config["confidence"],
        "counts": {
            "cells": len(cells),
            "features": len(features),
            "nodes": len(nodes),
            "edges": len(edges),
            "layers": layer_counts,
        },
        "nodes": nodes,
        "edges": edges,
        "warning": "Advisory chart graph only; not turn-by-turn or certified navigation.",
    }
    graph_path = args.out_dir / f"{args.region}.graph.json"
    graph_path.write_text(json.dumps(graph, separators=(",", ":")) + "\n")
    write_geojson(args.out_dir / f"{args.region}.corridors.geojson", features, {
        "region": args.region,
        "source": config["source"],
        "counts": graph["counts"],
    })
    print(f"wrote {graph_path} with {len(nodes)} nodes, {len(edges)} edges", flush=True)
    if not edges:
        raise SystemExit("No routable ENC line edges were found in this region.")


if __name__ == "__main__":
    main()
