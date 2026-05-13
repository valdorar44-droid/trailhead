#!/usr/bin/env python3
"""
Build Trailhead trail display and graph packs from open trail line data.

Preferred inputs:
  - GeoJSON FeatureCollection with LineString/MultiLineString features
  - OSM PBF extract when the `osmium` CLI is installed

Outputs:
  - trails.geojson: display layer source for PMTiles generation
  - trail_graph.json: topology graph used for complete trail selection/navigation
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import shutil
import subprocess
import tempfile
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

try:
    import osmium
except Exception:  # pragma: no cover - optional until extraction env is installed
    osmium = None

try:
    from mapbox_vector_tile import encode as encode_mvt
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import write as write_pmtiles
    from shapely.geometry import LineString, MultiLineString, box, mapping, shape
    from shapely.strtree import STRtree
    from shapely.ops import transform as shapely_transform
except Exception:  # pragma: no cover - graph-only mode still works
    encode_mvt = None
    Compression = None
    TileType = None
    zxy_to_tileid = None
    write_pmtiles = None
    LineString = None
    MultiLineString = None
    box = None
    mapping = None
    shape = None
    shapely_transform = None
    STRtree = None

Coord = Tuple[float, float]
NODE_PRECISION = 6

TRAIL_HIGHWAYS = {"path", "track", "footway", "bridleway", "cycleway", "steps"}
TRAIL_ROUTES = {"hiking", "foot", "mtb", "bicycle", "horse"}

GEOFABRIK_STATE_SLUGS = {
    "ak": "alaska", "al": "alabama", "ar": "arkansas", "az": "arizona", "ca": "california",
    "co": "colorado", "ct": "connecticut", "de": "delaware", "fl": "florida", "ga": "georgia",
    "hi": "hawaii", "ia": "iowa", "id": "idaho", "il": "illinois", "in": "indiana",
    "ks": "kansas", "ky": "kentucky", "la": "louisiana", "ma": "massachusetts", "md": "maryland",
    "me": "maine", "mi": "michigan", "mn": "minnesota", "mo": "missouri", "ms": "mississippi",
    "mt": "montana", "nc": "north-carolina", "nd": "north-dakota", "ne": "nebraska",
    "nh": "new-hampshire", "nj": "new-jersey", "nm": "new-mexico", "nv": "nevada",
    "ny": "new-york", "oh": "ohio", "ok": "oklahoma", "or": "oregon", "pa": "pennsylvania",
    "ri": "rhode-island", "sc": "south-carolina", "sd": "south-dakota", "tn": "tennessee",
    "tx": "texas", "ut": "utah", "va": "virginia", "vt": "vermont", "wa": "washington",
    "wi": "wisconsin", "wv": "west-virginia", "wy": "wyoming",
}


def distance_m(a: Coord, b: Coord) -> float:
    lat = math.radians((a[1] + b[1]) / 2.0)
    x = (b[0] - a[0]) * math.cos(lat) * 111_320.0
    y = (b[1] - a[1]) * 110_540.0
    return math.hypot(x, y)


def node_key(coord: Coord) -> str:
    return f"{coord[0]:.{NODE_PRECISION}f},{coord[1]:.{NODE_PRECISION}f}"


def slug(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-") or "unnamed"


def line_length(coords: List[Coord]) -> float:
    return sum(distance_m(coords[i - 1], coords[i]) for i in range(1, len(coords)))


def load_geojson(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if data.get("type") == "FeatureCollection":
        return data
    if data.get("type") == "Feature":
        return {"type": "FeatureCollection", "features": [data]}
    raise ValueError(f"{path} is not a GeoJSON FeatureCollection")


def iter_geojson_features(path: Path) -> Iterable[Dict[str, Any]]:
    """Stream features from a compact FeatureCollection without loading it all.

    Trail pack GeoJSON can be hundreds of MB for large states. The routing graph
    resume path only needs one feature at a time, so avoid materializing the
    entire FeatureCollection in memory.
    """
    decoder = json.JSONDecoder()
    buffer = ""
    in_features = False
    done = False

    with path.open("r", encoding="utf-8") as f:
        while not done:
            chunk = f.read(1_048_576)
            if chunk:
                buffer += chunk
            elif not buffer:
                break

            while True:
                if not in_features:
                    idx = buffer.find('"features"')
                    if idx < 0:
                        if not chunk:
                            raise ValueError(f"{path} has no features array")
                        buffer = buffer[-64:]
                        break
                    array_idx = buffer.find("[", idx)
                    if array_idx < 0:
                        if not chunk:
                            raise ValueError(f"{path} has no features array")
                        buffer = buffer[idx:]
                        break
                    buffer = buffer[array_idx + 1 :]
                    in_features = True

                buffer = buffer.lstrip()
                if buffer.startswith("]"):
                    done = True
                    break
                if buffer.startswith(","):
                    buffer = buffer[1:].lstrip()
                if not buffer:
                    break

                try:
                    feature, end = decoder.raw_decode(buffer)
                except json.JSONDecodeError:
                    if not chunk:
                        raise
                    break
                if isinstance(feature, dict):
                    yield feature
                buffer = buffer[end:]


class TrailPbfHandler(osmium.SimpleHandler if osmium else object):
    def __init__(self, progress_interval: int = 50_000) -> None:
        super().__init__()
        self.features: List[Dict[str, Any]] = []
        self.progress_interval = progress_interval
        self.ways_seen = 0
        self.ways_matched = 0
        self.started = time.time()

    def way(self, way: Any) -> None:
        self.ways_seen += 1
        if self.progress_interval and self.ways_seen % self.progress_interval == 0:
            elapsed = int(time.time() - self.started)
            print(
                f"pbf: scanned {self.ways_seen:,} ways · matched {self.ways_matched:,} trail ways · {elapsed}s",
                flush=True,
            )
        tags = {str(k): str(v) for k, v in way.tags}
        if not is_trail_feature(tags):
            return
        if tags.get("access") in {"private", "no"}:
            return
        coords: List[Coord] = []
        try:
            for node in way.nodes:
                if not node.location.valid():
                    continue
                coords.append((float(node.location.lon), float(node.location.lat)))
        except Exception:
            return
        if len(coords) < 2:
            return
        props = {
            **tags,
            "id": f"osm_way_{way.id}",
            "source": "openstreetmap",
        }
        self.ways_matched += 1
        self.features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": props,
        })


def export_pbf_with_pyosmium(path: Path) -> Dict[str, Any]:
    if osmium is None:
        raise RuntimeError("OSM PBF input requires pyosmium. Use .venv-trails/bin/pip install osmium.")
    handler = TrailPbfHandler()
    print(f"pbf: parsing {path}", flush=True)
    handler.apply_file(str(path), locations=True)
    elapsed = int(time.time() - handler.started)
    print(
        f"pbf: done scanned {handler.ways_seen:,} ways · matched {handler.ways_matched:,} trail ways · {elapsed}s",
        flush=True,
    )
    return {"type": "FeatureCollection", "features": handler.features}


def export_pbf_with_osmium(path: Path, tmp_dir: Path) -> Path:
    osmium = shutil.which("osmium")
    if not osmium:
        raise RuntimeError("OSM PBF input requires the osmium CLI. Install osmium-tool or pass GeoJSON.")
    filtered = tmp_dir / "trails.osm.pbf"
    out = tmp_dir / "trails.geojson"
    filters = [
        "w/highway=path,track,footway,bridleway,cycleway,steps",
        "w/route=hiking,foot,mtb,bicycle,horse",
        "r/route=hiking,foot,mtb,bicycle,horse",
    ]
    subprocess.run([osmium, "tags-filter", str(path), *filters, "-o", str(filtered), "--overwrite"], check=True)
    subprocess.run([osmium, "export", str(filtered), "-o", str(out), "--overwrite"], check=True)
    return out


def load_source(path: Path) -> Dict[str, Any]:
    if path.suffix.lower() == ".pbf":
        if osmium is not None:
            return export_pbf_with_pyosmium(path)
        with tempfile.TemporaryDirectory(prefix="trailhead-trails-") as tmp:
            return load_geojson(export_pbf_with_osmium(path, Path(tmp)))
    return load_geojson(path)


def iter_lines(feature: Dict[str, Any]) -> Iterable[List[Coord]]:
    geom = feature.get("geometry") or {}
    gtype = geom.get("type")
    raw_lines = []
    if gtype == "LineString":
        raw_lines = [geom.get("coordinates") or []]
    elif gtype == "MultiLineString":
        raw_lines = geom.get("coordinates") or []
    for raw in raw_lines:
        coords: List[Coord] = []
        for item in raw:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            lng, lat = float(item[0]), float(item[1])
            if math.isfinite(lng) and math.isfinite(lat):
                coords.append((lng, lat))
        if len(coords) >= 2:
            yield coords


def trail_name(props: Dict[str, Any], fallback: str) -> str:
    for key in ("name", "trail_name", "ref", "operator", "mvum_symbol_name", "symbol"):
        value = props.get(key)
        if value:
            return str(value).strip()
    return fallback


def route_class(props: Dict[str, Any]) -> str:
    route = str(props.get("route") or "").lower()
    highway = str(props.get("highway") or "").lower()
    if route in TRAIL_ROUTES:
        return route
    if highway in TRAIL_HIGHWAYS:
        return highway
    if props.get("mvum_symbol") or props.get("mvum_symbol_name"):
        return "mvum"
    return "trail"


def allowed_uses(props: Dict[str, Any]) -> List[str]:
    uses = []
    for use in ("foot", "bicycle", "horse", "motor_vehicle", "motorcar", "atv", "motorcycle"):
        value = str(props.get(use) or "").lower()
        if value in {"yes", "designated", "permissive"}:
            uses.append(use)
    cls = route_class(props)
    if not uses:
        if cls in {"hiking", "foot", "path", "footway", "steps"}:
            uses.append("foot")
        if cls in {"mtb", "bicycle", "cycleway"}:
            uses.append("bicycle")
        if cls in {"track", "mvum"}:
            uses.append("motor_vehicle")
    return sorted(set(uses))


def is_trail_feature(props: Dict[str, Any]) -> bool:
    highway = str(props.get("highway") or "").lower()
    route = str(props.get("route") or "").lower()
    return (
        highway in TRAIL_HIGHWAYS
        or route in TRAIL_ROUTES
        or bool(props.get("sac_scale"))
        or bool(props.get("trail_visibility"))
        or bool(props.get("mvum_symbol"))
        or bool(props.get("mvum_symbol_name"))
    )


def build_packs(source: Dict[str, Any], region: str, dense_graph: bool = False) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []
    display_features: List[Dict[str, Any]] = []
    systems: Dict[str, Dict[str, Any]] = {}

    source_features = source.get("features") or []
    started = time.time()
    for feature_idx, feature in enumerate(source_features):
        if feature_idx and feature_idx % 25_000 == 0:
            elapsed = int(time.time() - started)
            print(
                f"{region}: built from {feature_idx:,}/{len(source_features):,} source features · "
                f"{len(display_features):,} display · {len(edges):,} graph edges · {elapsed}s",
                flush=True,
            )
        props = feature.get("properties") or {}
        if not is_trail_feature(props):
            continue
        for line_idx, coords in enumerate(iter_lines(feature)):
            name = trail_name(props, f"Trail {feature_idx + 1}")
            class_name = route_class(props)
            system_id = slug(str(props.get("relation_id") or props.get("@relations") or props.get("network") or name))
            segment_id = str(props.get("id") or props.get("@id") or f"{region}-{feature_idx}-{line_idx}")
            trail_id = slug(str(props.get("route_id") or props.get("ref") or name))
            line_len = line_length(coords)
            if line_len < 8:
                continue

            display_props = {
                "trail_id": trail_id,
                "system_id": system_id,
                "segment_id": segment_id,
                "name": name,
                "route_class": class_name,
                "source": str(props.get("source") or "open"),
                "allowed_uses": ",".join(allowed_uses(props)),
                "surface": str(props.get("surface") or ""),
                "difficulty": str(props.get("sac_scale") or props.get("difficulty") or ""),
                "ref": str(props.get("ref") or ""),
                "network": str(props.get("network") or ""),
                "operator": str(props.get("operator") or ""),
                "trail_visibility": str(props.get("trail_visibility") or ""),
            }
            display_features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": display_props,
            })

            system = systems.setdefault(system_id, {
                "id": system_id,
                "name": name,
                "segment_ids": [],
                "length_m": 0.0,
                "bounds": [180.0, 90.0, -180.0, -90.0],
                "allowed_uses": set(),
                "sources": set(),
            })
            system["segment_ids"].append(segment_id)
            system["length_m"] += line_len
            system["allowed_uses"].update(allowed_uses(props))
            system["sources"].add(display_props["source"])

            for coord in coords:
                system["bounds"][0] = min(system["bounds"][0], coord[0])
                system["bounds"][1] = min(system["bounds"][1], coord[1])
                system["bounds"][2] = max(system["bounds"][2], coord[0])
                system["bounds"][3] = max(system["bounds"][3], coord[1])

            if dense_graph:
                for coord in coords:
                    key = node_key(coord)
                    nodes.setdefault(key, {"id": key, "lng": coord[0], "lat": coord[1]})
                for idx in range(1, len(coords)):
                    a = node_key(coords[idx - 1])
                    b = node_key(coords[idx])
                    if a == b:
                        continue
                    edges.append({
                        "id": f"{segment_id}:{idx}",
                        "segment_id": segment_id,
                        "trail_id": trail_id,
                        "system_id": system_id,
                        "a": a,
                        "b": b,
                        "length_m": distance_m(coords[idx - 1], coords[idx]),
                        "name": name,
                        "route_class": class_name,
                        "allowed_uses": allowed_uses(props),
                        "surface": display_props["surface"],
                        "difficulty": display_props["difficulty"],
                        "source": display_props["source"],
                    })
            else:
                a = node_key(coords[0])
                b = node_key(coords[-1])
                nodes.setdefault(a, {"id": a, "lng": coords[0][0], "lat": coords[0][1]})
                nodes.setdefault(b, {"id": b, "lng": coords[-1][0], "lat": coords[-1][1]})
                edges.append({
                    "id": segment_id,
                    "segment_id": segment_id,
                    "trail_id": trail_id,
                    "system_id": system_id,
                    "a": a,
                    "b": b,
                    "length_m": line_len,
                    "name": name,
                    "route_class": class_name,
                    "allowed_uses": allowed_uses(props),
                    "surface": display_props["surface"],
                    "difficulty": display_props["difficulty"],
                    "source": display_props["source"],
                })

    adjacency = defaultdict(list)
    for edge in edges:
        adjacency[edge["a"]].append(edge["id"])
        adjacency[edge["b"]].append(edge["id"])

    graph_systems = []
    for system in systems.values():
        graph_systems.append({
            **{k: v for k, v in system.items() if k not in {"allowed_uses", "sources"}},
            "length_m": round(system["length_m"], 1),
            "allowed_uses": sorted(system["allowed_uses"]),
            "sources": sorted(system["sources"]),
        })

    trail_geojson = {"type": "FeatureCollection", "features": display_features}
    graph = {
        "version": 1,
        "region": region,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "nodes": sorted(nodes.values(), key=lambda n: n["id"]),
        "edges": edges,
        "systems": sorted(graph_systems, key=lambda s: s["id"]),
        "adjacency": dict(adjacency),
    }
    return trail_geojson, graph


def write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    tmp_path.rename(path)


def write_routing_graph_jsonl_gz(
    trails: Dict[str, Any] | Iterable[Dict[str, Any]],
    out_path: Path,
    region: str,
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    node_ids: Dict[tuple[int, int], int] = {}
    next_node_id = 1
    segment_count = 0
    edge_count = 0
    started = time.time()

    def emit(f: Any, item: Dict[str, Any]) -> None:
        f.write(json.dumps(item, separators=(",", ":")) + "\n")

    def node_id_for(f: Any, coord: Coord) -> int:
        nonlocal next_node_id
        key = (round(coord[0] * 1_000_000), round(coord[1] * 1_000_000))
        existing = node_ids.get(key)
        if existing:
            return existing
        node_id = next_node_id
        next_node_id += 1
        node_ids[key] = node_id
        emit(f, {"n": node_id, "lng": key[0], "lat": key[1]})
        return node_id

    with gzip.open(tmp_path, "wt", encoding="utf-8", compresslevel=6) as f:
        emit(f, {
            "type": "trail_route_graph_v1",
            "region": region,
            "coord_precision": 6,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "schema": {
                "n": "node [id,lng_e6,lat_e6]",
                "s": "segment metadata [id,segment_id,trail_id,system_id,name,route_class,allowed_uses]",
                "e": "directed-neutral edge [id,a,b,length_m,segment]",
            },
        })
        feature_iter = trails.get("features") if isinstance(trails, dict) else trails
        for feature_idx, feature in enumerate(feature_iter or []):
            props = feature.get("properties") or {}
            for line_idx, coords in enumerate(iter_lines(feature)):
                if len(coords) < 2:
                    continue
                segment_count += 1
                segment_numeric_id = segment_count
                segment_id = str(props.get("segment_id") or f"{region}-{feature_idx}-{line_idx}")
                emit(f, {
                    "s": segment_numeric_id,
                    "segment_id": segment_id,
                    "trail_id": props.get("trail_id") or "",
                    "system_id": props.get("system_id") or "",
                    "name": props.get("name") or "",
                    "route_class": props.get("route_class") or "",
                    "allowed_uses": props.get("allowed_uses") or "",
                    "surface": props.get("surface") or "",
                    "difficulty": props.get("difficulty") or "",
                    "source": props.get("source") or "",
                })
                prev_id = node_id_for(f, coords[0])
                for idx in range(1, len(coords)):
                    curr_id = node_id_for(f, coords[idx])
                    if prev_id != curr_id:
                        edge_count += 1
                        emit(f, {
                            "e": edge_count,
                            "a": prev_id,
                            "b": curr_id,
                            "l": round(distance_m(coords[idx - 1], coords[idx]), 2),
                            "s": segment_numeric_id,
                        })
                    prev_id = curr_id
                if segment_count % 25_000 == 0:
                    elapsed = int(time.time() - started)
                    print(
                        f"{region}: routing graph {segment_count:,} segments · "
                        f"{edge_count:,} edges · {len(node_ids):,} nodes · {elapsed}s",
                        flush=True,
                    )

    tmp_path.rename(out_path)
    print(
        f"Wrote routing graph {out_path} with {segment_count:,} segments, "
        f"{edge_count:,} edges, {len(node_ids):,} nodes",
        flush=True,
    )


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    lat = max(min(lat, 85.05112878), -85.05112878)
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2**z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north


def iter_tiles_for_bounds(bounds: tuple[float, float, float, float], min_zoom: int, max_zoom: int):
    west, south, east, north = bounds
    for z in range(min_zoom, max_zoom + 1):
        min_x, min_y = lonlat_to_tile(west, north, z)
        max_x, max_y = lonlat_to_tile(east, south, z)
        for x in range(min_x, max_x + 1):
            for y in range(min_y, max_y + 1):
                yield z, x, y


def trail_bounds(trails: Dict[str, Any]) -> tuple[float, float, float, float]:
    west, south, east, north = 180.0, 90.0, -180.0, -90.0
    for feature in trails.get("features") or []:
        for coords in iter_lines(feature):
            for lng, lat in coords:
                west, south = min(west, lng), min(south, lat)
                east, north = max(east, lng), max(north, lat)
    if west > east or south > north:
        return -180.0, -85.0, 180.0, 85.0
    return west, south, east, north


def iter_line_geometries(geom: Any) -> Iterable[Any]:
    if geom.is_empty:
        return
    if geom.geom_type in {"LineString", "MultiLineString"}:
        yield geom
        return
    if geom.geom_type == "GeometryCollection":
        for part in geom.geoms:
            yield from iter_line_geometries(part)


def write_trail_pmtiles(
    trails: Dict[str, Any],
    out_path: Path,
    min_zoom: int,
    max_zoom: int,
) -> None:
    if not all([encode_mvt, write_pmtiles, zxy_to_tileid, LineString, box, shape]):
        raise RuntimeError("PMTiles generation requires mapbox-vector-tile, shapely, and pmtiles packages.")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(".pmtiles.tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    indexed = []
    for feature in trails.get("features") or []:
        geom = shape(feature.get("geometry"))
        if geom.is_empty:
            continue
        indexed.append((geom, feature.get("properties") or {}))
    geoms = [item[0] for item in indexed]
    props_by_idx = [item[1] for item in indexed]
    tree = STRtree(geoms) if STRtree and geoms else None

    bounds = trail_bounds(trails)
    header = {
        "tile_compression": Compression.NONE,
        "tile_type": TileType.MVT,
        "min_lon_e7": round(bounds[0] * 10_000_000),
        "min_lat_e7": round(bounds[1] * 10_000_000),
        "max_lon_e7": round(bounds[2] * 10_000_000),
        "max_lat_e7": round(bounds[3] * 10_000_000),
        "center_zoom": min(max_zoom, max(min_zoom, 10)),
        "center_lon_e7": round(((bounds[0] + bounds[2]) / 2.0) * 10_000_000),
        "center_lat_e7": round(((bounds[1] + bounds[3]) / 2.0) * 10_000_000),
    }
    metadata = {
        "name": out_path.stem,
        "description": "Trailhead trail systems extracted from open trail data.",
        "version": "1",
        "bounds": list(bounds),
        "center": [(bounds[0] + bounds[2]) / 2.0, (bounds[1] + bounds[3]) / 2.0, min(max_zoom, max(min_zoom, 10))],
        "minzoom": min_zoom,
        "maxzoom": max_zoom,
        "type": "overlay",
        "format": "pbf",
        "vector_layers": [{
            "id": "trails",
            "fields": {
                "trail_id": "String",
                "system_id": "String",
                "segment_id": "String",
                "name": "String",
                "route_class": "String",
                "allowed_uses": "String",
                "source": "String",
            },
        }],
        "attribution": "OpenStreetMap contributors, public agency open data where included",
    }

    written = 0
    checked = 0
    started = time.time()
    total_tiles = sum(1 for _ in iter_tiles_for_bounds(bounds, min_zoom, max_zoom))
    with write_pmtiles(str(tmp_path)) as writer:
        for z, x, y in iter_tiles_for_bounds(bounds, min_zoom, max_zoom):
            checked += 1
            if checked % 1_000 == 0:
                elapsed = int(time.time() - started)
                print(
                    f"{out_path.parent.name}: pmtiles {checked:,}/{total_tiles:,} checked · "
                    f"{written:,} tiles written · {elapsed}s",
                    flush=True,
                )
            tb = tile_bounds(z, x, y)
            tile_box = box(*tb)
            features = []
            if tree:
                matches = tree.query(tile_box)
                candidates = ((geoms[int(i)], props_by_idx[int(i)]) for i in matches)
            else:
                candidates = iter(indexed)
            for geom, props in candidates:
                if not geom.intersects(tile_box):
                    continue
                clipped = geom.intersection(tile_box)
                if clipped.is_empty:
                    continue
                for line_geom in iter_line_geometries(clipped):
                    features.append({"geometry": line_geom, "properties": props})
            if not features:
                continue
            tile = encode_mvt(
                [{"name": "trails", "features": features}],
                default_options={"quantize_bounds": tb, "extents": 4096},
            )
            if tile:
                writer.write_tile(zxy_to_tileid(z, x, y), gzip.compress(tile))
                written += 1
        if written == 0:
            raise RuntimeError("No trail tiles were generated")
        writer.finalize(header, metadata)
    tmp_path.rename(out_path)
    print(f"Wrote {written} trail PMTiles tiles to {out_path}", flush=True)


def geofabrik_url(region: str) -> str:
    slug_value = GEOFABRIK_STATE_SLUGS.get(region.lower())
    if not slug_value:
        raise ValueError(f"No Geofabrik state slug for {region}")
    return f"https://download.geofabrik.de/north-america/us/{slug_value}-latest.osm.pbf"


def download_source(url: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 0:
        print(f"Using cached source {path}", flush=True)
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    subprocess.run(["curl", "-L", "--fail", "--retry", "3", "-o", str(tmp), url], check=True)
    tmp.rename(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract Trailhead trail display and graph packs.")
    parser.add_argument("source", type=Path, nargs="?", help="OSM PBF or GeoJSON source file")
    parser.add_argument("--region", required=True, help="Region/state code, e.g. co")
    parser.add_argument("--out-dir", type=Path, default=Path("dist/trail-packs"), help="Output directory")
    parser.add_argument("--download-geofabrik", action="store_true", help="Download the state PBF from Geofabrik first")
    parser.add_argument("--source-dir", type=Path, default=Path("data/osm-pbf"), help="Downloaded OSM PBF cache directory")
    parser.add_argument("--pmtiles", action="store_true", help="Also write trails.pmtiles")
    parser.add_argument("--routing-graph", action="store_true", help="Also write dense routing graph as route.jsonl.gz")
    parser.add_argument("--min-zoom", type=int, default=8)
    parser.add_argument("--max-zoom", type=int, default=12)
    parser.add_argument("--force", action="store_true", help="Rebuild existing outputs instead of resuming/skipping")
    parser.add_argument(
        "--dense-graph",
        action="store_true",
        help="Write one graph edge per coordinate pair. Expensive; default is one compact edge per trail segment.",
    )
    args = parser.parse_args()

    region = args.region.lower()
    region_dir = args.out_dir / region
    trails_path = region_dir / "trails.geojson"
    graph_path = region_dir / "trail_graph.json"
    pmtiles_path = region_dir / "trails.pmtiles"
    route_graph_path = region_dir / "trail_route_graph.jsonl.gz"

    if (
        not args.force
        and trails_path.exists()
        and graph_path.exists()
        and (not args.pmtiles or pmtiles_path.exists())
        and (not args.routing_graph or route_graph_path.exists())
    ):
        print(f"{region}: existing outputs complete, skipping", flush=True)
        return

    source = args.source
    if args.download_geofabrik:
        source = args.source_dir / f"{region}.osm.pbf"
        download_source(geofabrik_url(region), source)
    if source is None:
        raise SystemExit("Pass a source file or --download-geofabrik.")

    needs_pmtiles = args.pmtiles and (args.force or not pmtiles_path.exists())
    needs_route_graph = args.routing_graph and (args.force or not route_graph_path.exists())
    can_stream_route_graph_only = (
        needs_route_graph
        and not needs_pmtiles
        and trails_path.exists()
        and graph_path.exists()
    )

    if can_stream_route_graph_only:
        print(f"{region}: existing display/graph/PMTiles complete; streaming routing graph from {trails_path}", flush=True)
        trails: Dict[str, Any] | Iterable[Dict[str, Any]] = iter_geojson_features(trails_path)
        graph: Dict[str, Any] | None = None
    elif not args.force and trails_path.exists() and graph_path.exists():
        print(f"{region}: reusing existing graph/display outputs", flush=True)
        trails = load_geojson(trails_path)
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    else:
        print(f"{region}: loading source", flush=True)
        geojson = load_source(source)
        print(f"{region}: building display and graph packs", flush=True)
        trails, graph = build_packs(geojson, region, dense_graph=args.dense_graph)
        print(f"{region}: writing {trails_path}", flush=True)
        write_json(trails_path, trails)
        print(f"{region}: writing {graph_path}", flush=True)
        write_json(graph_path, graph)
    if args.pmtiles:
        if not args.force and pmtiles_path.exists():
            print(f"{region}: existing PMTiles complete, skipping", flush=True)
        else:
            print(f"{region}: writing {pmtiles_path}", flush=True)
            write_trail_pmtiles(trails, pmtiles_path, args.min_zoom, args.max_zoom)
    if args.routing_graph:
        if not args.force and route_graph_path.exists():
            print(f"{region}: existing routing graph complete, skipping", flush=True)
        else:
            print(f"{region}: writing {route_graph_path}", flush=True)
            write_routing_graph_jsonl_gz(trails, route_graph_path, region)
    if isinstance(trails, dict):
        print(f"Wrote {len(trails['features'])} trail display features", flush=True)
    if graph is not None:
        print(f"Wrote {len(graph['nodes'])} graph nodes, {len(graph['edges'])} graph edges, {len(graph['systems'])} systems", flush=True)
    if not args.pmtiles:
        print(f"Next PMTiles step: rerun with --pmtiles or use tippecanoe -o {region_dir / 'trails.pmtiles'} -zg --drop-densest-as-needed --extend-zooms-if-still-dropping -l trails {region_dir / 'trails.geojson'}")


if __name__ == "__main__":
    main()
