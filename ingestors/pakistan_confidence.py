"""Pakistan route-confidence scaffold.

This is the live API shape for Pakistan mountain/overland confidence. The
first pass is conservative and geometry-based; the next pass should replace the
heuristics with segment tags from the Pakistan Geofabrik/Valhalla import.
"""
from __future__ import annotations

import math
from typing import Any


PAKISTAN_BBOX = (23.5, 60.5, 37.4, 77.9)
KARAKORAM_TREK_BBOX = (35.35, 75.65, 36.05, 76.75)
HUNZA_KKH_BBOX = (35.95, 74.0, 36.95, 75.25)
SKARDU_DEOSAI_BBOX = (34.75, 74.95, 35.65, 76.65)


def _in_bbox(lat: float, lng: float, bbox: tuple[float, float, float, float]) -> bool:
    min_lat, min_lng, max_lat, max_lng = bbox
    return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng


def _haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 3958.7613
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _point(value: dict[str, Any]) -> dict[str, float] | None:
    try:
        lat = float(value.get("lat"))
        lng = float(value.get("lng"))
    except Exception:
        return None
    if -90 <= lat <= 90 and -180 <= lng <= 180:
        return {"lat": lat, "lng": lng}
    return None


def _segment_confidence(a: dict[str, float], b: dict[str, float]) -> tuple[str, list[str]]:
    mid_lat = (a["lat"] + b["lat"]) / 2
    mid_lng = (a["lng"] + b["lng"]) / 2
    dist = _haversine_miles(a["lat"], a["lng"], b["lat"], b["lng"])
    notes: list[str] = []
    if _in_bbox(mid_lat, mid_lng, KARAKORAM_TREK_BBOX):
        return "trekking_only", [
            "K2/Baltoro/Karakoram trekking corridor. Do not treat this as vehicle routing without a verified road segment.",
            "Verify guide, permit, glacier, bridge, and local safety conditions.",
        ]
    if _in_bbox(mid_lat, mid_lng, SKARDU_DEOSAI_BBOX):
        notes.append("Skardu/Deosai mountain access area. Seasonal closures, rough surfaces, and weather can change quickly.")
        return ("low" if dist > 35 else "medium"), notes
    if _in_bbox(mid_lat, mid_lng, HUNZA_KKH_BBOX):
        notes.append("Hunza/KKH mountain-road area. Verify landslides, construction, and seasonal access.")
        return "medium", notes
    if dist > 80:
        notes.append("Long Pakistan segment without local road tags loaded yet. Split route or verify with the live router.")
        return "low", notes
    notes.append("Pakistan route segment pending OSM road-tag validation.")
    return "medium", notes


def pakistan_route_confidence(waypoints: list[dict[str, Any]]) -> dict[str, Any]:
    points = [pt for item in waypoints if (pt := _point(item))]
    pakistan_points = [pt for pt in points if _in_bbox(pt["lat"], pt["lng"], PAKISTAN_BBOX)]
    if not pakistan_points:
        return {
            "country": "PK",
            "active": False,
            "overall_confidence": "not_applicable",
            "segments": [],
            "warnings": [],
            "source": "trailhead_confidence_scaffold",
        }
    segments: list[dict[str, Any]] = []
    warnings: list[str] = []
    rank = {"high": 1, "medium": 2, "low": 3, "trekking_only": 4}
    overall = "medium"
    for idx, (a, b) in enumerate(zip(points, points[1:])):
        if not (_in_bbox(a["lat"], a["lng"], PAKISTAN_BBOX) or _in_bbox(b["lat"], b["lng"], PAKISTAN_BBOX)):
            continue
        confidence, notes = _segment_confidence(a, b)
        if rank[confidence] > rank[overall]:
            overall = confidence
        warnings.extend(notes)
        segments.append({
            "index": idx,
            "from": a,
            "to": b,
            "distance_mi": round(_haversine_miles(a["lat"], a["lng"], b["lat"], b["lng"]), 1),
            "route_confidence": confidence,
            "notes": notes,
        })
    deduped_warnings = []
    for warning in warnings:
        if warning not in deduped_warnings:
            deduped_warnings.append(warning)
    return {
        "country": "PK",
        "active": True,
        "overall_confidence": overall,
        "segments": segments,
        "warnings": deduped_warnings[:8],
        "source": "trailhead_confidence_scaffold",
        "source_note": "Conservative Pakistan confidence scaffold. Full road-class, surface, slope, and router-agreement scoring starts after the Pakistan Valhalla/OSM segment import is published.",
    }
