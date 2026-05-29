"""Offline water-routing graph lookup for Safe Water advisory corridors."""
from __future__ import annotations

import heapq
import json
import math
import time
from pathlib import Path
from typing import Any

from dashboard.marine_chart_provider import NON_CERTIFIED_NAVIGATION_NOTE


WATER_ROUTING_DIR = Path("/data/water-routing")
LOCAL_WATER_ROUTING_DIR = Path("data/water-routing")
PACKAGE_WATER_ROUTING_DIR = Path(__file__).resolve().parent / "water_routing_graphs"


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _dedupe_coords(coords: list[list[float]]) -> list[list[float]]:
    out: list[list[float]] = []
    for coord in coords:
        if len(coord) < 2:
            continue
        clean = [round(float(coord[0]), 6), round(float(coord[1]), 6)]
        if not out or out[-1] != clean:
            out.append(clean)
    return out


def _bounds_contains(bounds: dict[str, Any], lat: float, lng: float, margin_deg: float = 0.03) -> bool:
    try:
        return (
            float(bounds["south"]) - margin_deg <= lat <= float(bounds["north"]) + margin_deg
            and float(bounds["west"]) - margin_deg <= lng <= float(bounds["east"]) + margin_deg
        )
    except Exception:
        return False


def _graph_roots(data_dir: Path | None = None) -> list[Path]:
    if data_dir:
        return [data_dir]
    roots = []
    if WATER_ROUTING_DIR.exists():
        roots.append(WATER_ROUTING_DIR)
    roots.extend([LOCAL_WATER_ROUTING_DIR, PACKAGE_WATER_ROUTING_DIR])
    return roots


def list_water_route_graphs(data_dir: Path | None = None) -> list[dict[str, Any]]:
    graphs: list[dict[str, Any]] = []
    seen: set[str] = set()
    seen_regions: set[str] = set()
    for root in _graph_roots(data_dir):
        if not root.exists():
            continue
        for path in sorted(root.glob("*.graph.json")):
            if str(path.resolve()) in seen:
                continue
            seen.add(str(path.resolve()))
            try:
                raw = json.loads(path.read_text())
            except Exception:
                continue
            nodes = raw.get("nodes")
            edges = raw.get("edges")
            if not isinstance(nodes, list) or not isinstance(edges, list):
                continue
            region = str(raw.get("region") or path.stem.replace(".graph", ""))
            if region in seen_regions:
                continue
            seen_regions.add(region)
            graphs.append({"path": path, "graph": raw})
    return graphs


def water_graph_manifest(data_dir: Path | None = None) -> dict[str, Any]:
    regions = []
    for item in list_water_route_graphs(data_dir):
        graph = item["graph"]
        regions.append({
            "id": graph.get("region") or item["path"].stem.replace(".graph", ""),
            "name": graph.get("name") or graph.get("region") or item["path"].stem,
            "source": graph.get("source") or {},
            "bounds": graph.get("bounds") or {},
            "counts": graph.get("counts") or {},
            "confidence": graph.get("confidence") or "advisory_chart_graph",
            "generated_at": graph.get("generated_at"),
            "path": str(item["path"]),
        })
    return {
        "version": 1,
        "mode": "safe_water_advisory_routing",
        "generated_at": int(time.time()) if regions else None,
        "regions": regions,
        "warning": NON_CERTIFIED_NAVIGATION_NOTE,
    }


def route_with_water_graph(
    *,
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    data_dir: Path | None = None,
) -> dict[str, Any] | None:
    direct_m = max(1.0, _haversine_m(start_lat, start_lng, end_lat, end_lng))
    best: dict[str, Any] | None = None
    for item in list_water_route_graphs(data_dir):
        graph = item["graph"]
        bounds = graph.get("bounds") or {}
        if not (
            _bounds_contains(bounds, start_lat, start_lng)
            and _bounds_contains(bounds, end_lat, end_lng)
        ):
            continue
        routed = _route_single_graph(
            graph=graph,
            start_lat=start_lat,
            start_lng=start_lng,
            end_lat=end_lat,
            end_lng=end_lng,
            direct_m=direct_m,
        )
        if not routed:
            continue
        if best is None or float(routed["route_cost_m"]) < float(best["route_cost_m"]):
            best = routed
    return best


def _route_single_graph(
    *,
    graph: dict[str, Any],
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    direct_m: float,
) -> dict[str, Any] | None:
    raw_nodes = graph.get("nodes") or []
    raw_edges = graph.get("edges") or []
    nodes: list[list[float]] = []
    for node in raw_nodes:
        if isinstance(node, (list, tuple)) and len(node) >= 2:
            nodes.append([float(node[0]), float(node[1])])
    if len(nodes) < 2:
        return None

    adjacency: dict[int, list[tuple[int, float]]] = {}
    for edge in raw_edges:
        if not isinstance(edge, (list, tuple)) or len(edge) < 3:
            continue
        try:
            a = int(edge[0])
            b = int(edge[1])
            weight = float(edge[2])
        except Exception:
            continue
        if a < 0 or b < 0 or a >= len(nodes) or b >= len(nodes) or weight <= 0:
            continue
        adjacency.setdefault(a, []).append((b, weight))
        adjacency.setdefault(b, []).append((a, weight))
    if not adjacency:
        return None

    def nearest(lat: float, lng: float, limit: int = 8) -> list[tuple[int, float]]:
        scored = [
            (idx, _haversine_m(lat, lng, coord[1], coord[0]))
            for idx, coord in enumerate(nodes)
            if idx in adjacency
        ]
        scored.sort(key=lambda item: item[1])
        return scored[:limit]

    snap_limit_m = max(900.0, min(5000.0, direct_m * 0.4))
    start_idx = len(nodes)
    end_idx = start_idx + 1
    nodes.extend([[start_lng, start_lat], [end_lng, end_lat]])
    adjacency[start_idx] = []
    adjacency[end_idx] = []

    for idx, dist in nearest(start_lat, start_lng):
        if dist <= snap_limit_m:
            adjacency[start_idx].append((idx, dist))
            adjacency.setdefault(idx, []).append((start_idx, dist))
    for idx, dist in nearest(end_lat, end_lng):
        if dist <= snap_limit_m:
            adjacency[end_idx].append((idx, dist))
            adjacency.setdefault(idx, []).append((end_idx, dist))
    if not adjacency[start_idx] or not adjacency[end_idx]:
        return None

    queue: list[tuple[float, int]] = [(0.0, start_idx)]
    distances: dict[int, float] = {start_idx: 0.0}
    parents: dict[int, int] = {}
    while queue:
        cost, idx = heapq.heappop(queue)
        if idx == end_idx:
            break
        if cost > distances.get(idx, math.inf):
            continue
        for next_idx, weight in adjacency.get(idx, []):
            next_cost = cost + weight
            if next_cost < distances.get(next_idx, math.inf):
                distances[next_idx] = next_cost
                parents[next_idx] = idx
                heapq.heappush(queue, (next_cost, next_idx))

    route_cost = distances.get(end_idx)
    if route_cost is None or not math.isfinite(route_cost):
        return None
    if route_cost > max(6500.0, direct_m * 5.0):
        return None

    route_indices: list[int] = []
    cursor = end_idx
    while True:
        route_indices.append(cursor)
        if cursor == start_idx:
            break
        if cursor not in parents:
            return None
        cursor = parents[cursor]
    route_indices.reverse()
    coords = _dedupe_coords([nodes[idx] for idx in route_indices])
    if len(coords) < 2:
        return None

    source = graph.get("source") or {}
    return {
        "coordinates": coords[:640],
        "distance_mi": round(route_cost / 1609.344, 2),
        "route_cost_m": round(route_cost, 1),
        "source": str(source.get("name") or graph.get("source_name") or "ENC routing graph"),
        "source_url": source.get("url"),
        "source_region": graph.get("region"),
        "source_confidence": graph.get("confidence") or "enc_advisory_graph",
        "graph": True,
        "snap_limit_m": round(snap_limit_m),
    }
