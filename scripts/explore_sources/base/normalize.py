from __future__ import annotations

import math
import re
from typing import Any, Iterable


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_name(value: Any) -> str:
    return compact_text(value).lower().replace("&", "and")


def slugify(value: Any) -> str:
    text = normalize_name(value)
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "item"


def coord_pair(value: Iterable[Any]) -> tuple[float, float] | None:
    try:
        lng, lat = list(value)[:2]
        return float(lat), float(lng)
    except Exception:
        return None


def representative_point(geometry: dict[str, Any] | None) -> tuple[float | None, float | None]:
    if not geometry:
        return None, None
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if gtype == "Point":
        point = coord_pair(coords or [])
        return point if point else (None, None)
    points: list[tuple[float, float]] = []
    if gtype == "LineString":
        points = [p for p in (coord_pair(item) for item in coords or []) if p]
    elif gtype == "MultiLineString":
        for line in coords or []:
            points.extend([p for p in (coord_pair(item) for item in line or []) if p])
    elif gtype == "Polygon":
        ring = (coords or [[]])[0]
        points = [p for p in (coord_pair(item) for item in ring or []) if p]
    if not points:
        return None, None
    mid = points[len(points) // 2]
    return mid[0], mid[1]


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_m = 6371000.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return radius_m * 2 * math.asin(math.sqrt(a))


def line_distance_mi(geometry: dict[str, Any] | None) -> float | None:
    if not geometry:
        return None
    lines = []
    if geometry.get("type") == "LineString":
        lines = [geometry.get("coordinates") or []]
    elif geometry.get("type") == "MultiLineString":
        lines = geometry.get("coordinates") or []
    else:
        return None
    meters = 0.0
    for line in lines:
        points = [p for p in (coord_pair(item) for item in line or []) if p]
        for a, b in zip(points, points[1:]):
            meters += haversine_m(a[0], a[1], b[0], b[1])
    if meters <= 0:
        return None
    return round(meters / 1609.344, 2)


def sorted_unique(values: Iterable[Any]) -> list[str]:
    seen = set()
    out = []
    for value in values:
        text = compact_text(value)
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            out.append(text)
    return out

