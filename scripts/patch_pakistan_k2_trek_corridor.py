#!/usr/bin/env python3
"""Add a conservative classic K2 Base Camp trek corridor to Pakistan trail packs."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.extract_trail_graph import distance_m, node_key, write_routing_graph_jsonl_gz, write_trail_pmtiles


REGION_DIR = Path("data/trails/pk")
TRAILS_PATH = REGION_DIR / "trails.geojson"
GRAPH_PATH = REGION_DIR / "trail_graph.json"
PMTILES_PATH = REGION_DIR / "trails.pmtiles"
ROUTE_GRAPH_PATH = REGION_DIR / "trail_route_graph.jsonl.gz"

SEGMENT_ID = "trailhead_curated_pk_classic_k2_base_camp_trek"
SYSTEM_ID = "classic-k2-base-camp-trek"
TRAIL_ID = "classic-k2-base-camp-trek"
NAME = "Classic K2 Base Camp Trek"

# Simplified planning corridor through common K2 Base Camp trek waypoints.
# Coordinates are intentionally sparse and should be treated as a trek-follow
# line, not a guide-grade glacier navigation track.
COORDS = [
    [75.8178, 35.6806],  # Askole
    [75.9144, 35.6893],  # Korophon
    [75.9997, 35.6555],  # Bardumal
    [76.1257, 35.6772],  # Paju
    [76.1944, 35.7008],  # Liligo
    [76.2850, 35.7275],  # Urdokas
    [76.4000, 35.7350],  # Goro approach
    [76.5142, 35.7455],  # Concordia
    [76.5669, 35.8108],  # Broad Peak Base Camp area
    [76.5158, 35.8808],  # K2 Base Camp
]


def curated_feature() -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": COORDS},
        "properties": {
            "trail_id": TRAIL_ID,
            "system_id": SYSTEM_ID,
            "segment_id": SEGMENT_ID,
            "name": NAME,
            "route_class": "hiking",
            "trail_visual_class": "hike",
            "source": "trailhead_curated_k2_trek",
            "allowed_uses": "foot",
            "surface": "mountain_trail_glacier_approach",
            "difficulty": "trekking_only_verify_locally",
            "ref": "",
            "network": "Karakoram",
            "operator": "",
            "trail_visibility": "variable",
            "safety_note": "Simplified offline trek-follow corridor. Verify route, guides, permits, glacier conditions, bridges, weather, and local access before travel.",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    }


def patch_trails() -> dict:
    payload = json.loads(TRAILS_PATH.read_text())
    features = payload.get("features") or []
    features = [
        feature for feature in features
        if (feature.get("properties") or {}).get("segment_id") != SEGMENT_ID
    ]
    features.append(curated_feature())
    payload["features"] = features
    TRAILS_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    return payload


def patch_selection_graph() -> dict:
    graph = json.loads(GRAPH_PATH.read_text())
    nodes = [node for node in graph.get("nodes") or [] if node.get("id") not in {node_key(tuple(coord)) for coord in COORDS}]
    edges = [edge for edge in graph.get("edges") or [] if edge.get("segment_id") != SEGMENT_ID]
    systems = [system for system in graph.get("systems") or [] if system.get("id") != SYSTEM_ID]
    adjacency = {
        key: [seg for seg in value if seg != SEGMENT_ID]
        for key, value in (graph.get("adjacency") or {}).items()
    }

    coord_tuples = [(float(lng), float(lat)) for lng, lat in COORDS]
    for coord in coord_tuples:
        key = node_key(coord)
        nodes.append({"id": key, "lng": coord[0], "lat": coord[1]})
        adjacency.setdefault(key, [])

    length = sum(distance_m(coord_tuples[idx - 1], coord_tuples[idx]) for idx in range(1, len(coord_tuples)))
    edge = {
        "id": SEGMENT_ID,
        "segment_id": SEGMENT_ID,
        "trail_id": TRAIL_ID,
        "system_id": SYSTEM_ID,
        "a": node_key(coord_tuples[0]),
        "b": node_key(coord_tuples[-1]),
        "length_m": length,
        "name": NAME,
        "route_class": "hiking",
        "trail_visual_class": "hike",
        "allowed_uses": ["foot"],
        "surface": "mountain_trail_glacier_approach",
        "difficulty": "trekking_only_verify_locally",
        "source": "trailhead_curated_k2_trek",
    }
    edges.append(edge)
    adjacency.setdefault(edge["a"], []).append(SEGMENT_ID)
    adjacency.setdefault(edge["b"], []).append(SEGMENT_ID)
    systems.append({
        "id": SYSTEM_ID,
        "name": NAME,
        "segment_ids": [SEGMENT_ID],
        "length_m": length,
        "bounds": [
            min(coord[0] for coord in coord_tuples),
            min(coord[1] for coord in coord_tuples),
            max(coord[0] for coord in coord_tuples),
            max(coord[1] for coord in coord_tuples),
        ],
        "allowed_uses": ["foot"],
        "sources": ["trailhead_curated_k2_trek"],
    })
    graph.update(nodes=nodes, edges=edges, systems=systems, adjacency=adjacency)
    GRAPH_PATH.write_text(json.dumps(graph, separators=(",", ":")))
    return graph


def main() -> int:
    trails = patch_trails()
    graph = patch_selection_graph()
    write_trail_pmtiles(trails, PMTILES_PATH, 8, 12)
    write_routing_graph_jsonl_gz(trails, ROUTE_GRAPH_PATH, "pk")
    print(json.dumps({
        "features": len(trails.get("features") or []),
        "nodes": len(graph.get("nodes") or []),
        "edges": len(graph.get("edges") or []),
        "systems": len(graph.get("systems") or []),
        "patched_segment": SEGMENT_ID,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
