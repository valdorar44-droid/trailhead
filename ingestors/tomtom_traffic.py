"""Server-only TomTom live traffic incident ingestor."""
from __future__ import annotations

import logging
import math
import time
from typing import Any

import httpx

from config.settings import settings

TOMTOM_INCIDENTS_URL = "https://api.tomtom.com/traffic/services/5/incidentDetails"
TRAFFIC_CACHE_TTL_SECONDS = 60
MAX_BBOX_SPAN_DEG = 1.25
EARTH_RADIUS_M = 6_371_000.0

log = logging.getLogger(__name__)
_cache: dict[str, tuple[float, list[dict]]] = {}

CATEGORY_TYPE_MAP = {
    "accident": "hazard",
    "disabled-vehicle": "hazard",
    "broken-down-vehicle": "hazard",
    "road-hazard": "hazard",
    "hazard": "hazard",
    "dangerous-conditions": "hazard",
    "weather": "hazard",
    "rain": "hazard",
    "snow": "hazard",
    "ice": "hazard",
    "fog": "hazard",
    "road-closed": "closure",
    "road-closure": "closure",
    "closure": "closure",
    "lane-closed": "closure",
    "lane-restriction": "closure",
    "roadworks": "road_condition",
    "roadwork": "road_condition",
    "construction": "road_condition",
    "planned-event": "road_condition",
    "jam": "traffic",
    "congestion": "traffic",
    "traffic": "traffic",
}

CATEGORY_LABELS = {
    "accident": "Crash",
    "disabled-vehicle": "Disabled vehicle",
    "broken-down-vehicle": "Disabled vehicle",
    "road-hazard": "Road hazard",
    "road-closed": "Road closed",
    "roadworks": "Construction",
    "roadwork": "Construction",
    "construction": "Construction",
    "planned-event": "Planned event",
    "jam": "Traffic jam",
    "congestion": "Congestion",
    "weather": "Weather impact",
}

MAGNITUDE_SEVERITY = {
    0: "low",
    1: "low",
    2: "moderate",
    3: "high",
    4: "critical",
    "unknown": "low",
    "minor": "low",
    "moderate": "moderate",
    "major": "high",
    "indefinite": "critical",
}


def tomtom_enabled() -> bool:
    return bool(settings.tomtom_api_key.strip())


def normalize_tomtom_category(category: str | int | None, event_code: int | None = None) -> str:
    cat = _category_slug(category, event_code)
    return CATEGORY_TYPE_MAP.get(cat, "hazard")


def _category_slug(category: str | int | None, event_code: int | None = None) -> str:
    if isinstance(category, str) and category.strip():
        return category.strip().lower().replace("_", "-").replace(" ", "-")
    # TomTom icon categories are numeric in some responses. Map only the common
    # buckets and leave unknowns as hazards.
    numeric = int(category if isinstance(category, int) else event_code or 0)
    return {
        1: "accident",
        2: "fog",
        3: "dangerous-conditions",
        4: "rain",
        5: "ice",
        6: "jam",
        7: "lane-closed",
        8: "road-closed",
        9: "roadworks",
        10: "wind",
        11: "flooding",
        14: "broken-down-vehicle",
    }.get(numeric, "hazard")


def _severity(magnitude: Any, incident_type: str) -> str:
    if incident_type == "closure":
        return "critical"
    if isinstance(magnitude, str):
        return MAGNITUDE_SEVERITY.get(magnitude.lower(), "moderate")
    try:
        return MAGNITUDE_SEVERITY.get(int(magnitude), "moderate")
    except Exception:
        return "moderate"


def _coords_from_geometry(geometry: dict | None) -> list[list[float]]:
    if not isinstance(geometry, dict):
        return []
    coords = geometry.get("coordinates") or []
    if geometry.get("type") == "Point" and len(coords) >= 2:
        return [[float(coords[0]), float(coords[1])]]
    if geometry.get("type") == "LineString":
        return [[float(c[0]), float(c[1])] for c in coords if isinstance(c, list) and len(c) >= 2]
    if geometry.get("type") == "MultiLineString":
        out = []
        for line in coords:
            out.extend([[float(c[0]), float(c[1])] for c in line if isinstance(c, list) and len(c) >= 2])
        return out
    return []


def _first_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        for item in value:
            text = _first_text(item)
            if text:
                return text
    if isinstance(value, dict):
        for key in ("description", "label", "value", "text"):
            text = _first_text(value.get(key))
            if text:
                return text
    return ""


def _road_name(props: dict) -> str:
    road_numbers = props.get("roadNumbers") or props.get("road_numbers") or []
    if isinstance(road_numbers, list) and road_numbers:
        return str(road_numbers[0])
    for key in ("roadName", "road_name", "from", "to"):
        val = props.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _normalize_incident(raw: dict) -> dict | None:
    props = raw.get("properties") if isinstance(raw.get("properties"), dict) else raw
    geometry = raw.get("geometry") if isinstance(raw.get("geometry"), dict) else props.get("geometry")
    coords = _coords_from_geometry(geometry)
    point = coords[len(coords) // 2] if coords else None
    if not point:
        lat = props.get("latitude") or props.get("lat")
        lng = props.get("longitude") or props.get("lng") or props.get("lon")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            return None
        point = [float(lng), float(lat)]

    event = (props.get("events") or [{}])[0] if isinstance(props.get("events"), list) else {}
    category = props.get("category") or props.get("iconCategory") or event.get("category")
    cat_slug = _category_slug(category, event.get("code") if isinstance(event, dict) else None)
    alert_type = normalize_tomtom_category(category, event.get("code") if isinstance(event, dict) else None)
    road_name = _road_name(props)
    description = _first_text(props.get("description")) or _first_text(event) or CATEGORY_LABELS.get(cat_slug, "Live traffic incident")
    if road_name and road_name not in description:
        description = f"{description} on {road_name}"
    provider_id = str(props.get("id") or raw.get("id") or raw.get("tmcId") or hash((cat_slug, tuple(point), description)))
    updated = props.get("lastUpdateTime") or props.get("last_updated") or props.get("startTime")
    expires = props.get("endTime") or props.get("expirationTime")
    magnitude = props.get("magnitudeOfDelay") or props.get("magnitude") or props.get("delayMagnitude")
    return {
        "id": f"tomtom:{provider_id}",
        "source": "provider",
        "provider": "tomtom",
        "provider_id": provider_id,
        "type": alert_type,
        "subtype": CATEGORY_LABELS.get(cat_slug, cat_slug.replace("-", " ").title()),
        "severity": _severity(magnitude, alert_type),
        "description": description,
        "lat": point[1],
        "lng": point[0],
        "geometry": geometry if coords else None,
        "created_at": _parse_time(updated) or int(time.time()),
        "updated_at": _parse_time(updated) or int(time.time()),
        "expires_at": _parse_time(expires),
        "road_name": road_name,
        "confidence": 0.9,
        "upvotes": 0,
        "downvotes": 0,
        "confirmations": 0,
        "has_photo": 0,
        "cluster_count": 1,
        "username": "TomTom",
    }


def _parse_time(value: Any) -> int | None:
    if isinstance(value, (int, float)):
        return int(value / 1000 if value > 10_000_000_000 else value)
    if not isinstance(value, str) or not value:
        return None
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


def _bbox_key(bbox: tuple[float, float, float, float]) -> str:
    return ",".join(f"{v:.2f}" for v in bbox)


def _project_xy_m(lat: float, lng: float, ref_lat: float) -> tuple[float, float]:
    ref_cos = math.cos(math.radians(ref_lat))
    return (
        math.radians(lng) * EARTH_RADIUS_M * ref_cos,
        math.radians(lat) * EARTH_RADIUS_M,
    )


def _point_distance_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float, ref_lat: float) -> float:
    ax, ay = _project_xy_m(a_lat, a_lng, ref_lat)
    bx, by = _project_xy_m(b_lat, b_lng, ref_lat)
    return math.hypot(ax - bx, ay - by)


def _point_segment_distance_m(
    point_lat: float,
    point_lng: float,
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    ref_lat: float,
) -> tuple[float, float]:
    px, py = _project_xy_m(point_lat, point_lng, ref_lat)
    ax, ay = _project_xy_m(start_lat, start_lng, ref_lat)
    bx, by = _project_xy_m(end_lat, end_lng, ref_lat)
    dx = bx - ax
    dy = by - ay
    if abs(dx) < 1e-9 and abs(dy) < 1e-9:
        return math.hypot(px - ax, py - ay), 0.0
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    closest_x = ax + t * dx
    closest_y = ay + t * dy
    return math.hypot(px - closest_x, py - closest_y), t


def _alert_points(alert: dict) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for lng, lat in _coords_from_geometry(alert.get("geometry")):
        points.append((lat, lng))
    if not points:
        try:
            points.append((float(alert["lat"]), float(alert["lng"])))
        except Exception:
            return []
    return points


def _route_match_radius_m(alert: dict, default_radius_m: float) -> float:
    alert_type = str(alert.get("type") or "").lower()
    severity = str(alert.get("severity") or "").lower()
    if alert_type == "traffic":
        return 900.0 if severity in {"low", "moderate"} else 1_200.0
    if alert_type in {"closure", "road_condition", "hazard"}:
        return max(default_radius_m, 1_200.0)
    return default_radius_m


def _nearest_route_match(point_lat: float, point_lng: float, waypoints: list[dict]) -> tuple[float, Any]:
    valid = [(float(wp["lat"]), float(wp["lng"]), wp.get("day")) for wp in waypoints if wp.get("lat") and wp.get("lng")]
    if not valid:
        return float("inf"), None
    ref_lat = sum(lat for lat, _, _ in valid) / len(valid)
    if len(valid) == 1:
        lat, lng, day = valid[0]
        return _point_distance_m(point_lat, point_lng, lat, lng, ref_lat), day
    best_distance = float("inf")
    best_day = None
    for idx in range(len(valid) - 1):
        start_lat, start_lng, start_day = valid[idx]
        end_lat, end_lng, end_day = valid[idx + 1]
        distance_m, t = _point_segment_distance_m(point_lat, point_lng, start_lat, start_lng, end_lat, end_lng, ref_lat)
        if distance_m < best_distance:
            best_distance = distance_m
            if t < 0.5:
                best_day = start_day if start_day is not None else end_day
            else:
                best_day = end_day if end_day is not None else start_day
    return best_distance, best_day


def bbox_for_center(lat: float, lng: float, radius_deg: float) -> tuple[float, float, float, float]:
    radius = max(0.02, min(float(radius_deg), MAX_BBOX_SPAN_DEG / 2))
    return (lng - radius, lat - radius, lng + radius, lat + radius)


def bbox_for_waypoints(waypoints: list[dict], radius_deg: float = 0.12) -> tuple[float, float, float, float] | None:
    coords = [(float(wp["lat"]), float(wp["lng"])) for wp in waypoints if wp.get("lat") and wp.get("lng")]
    if not coords:
        return None
    min_lat = max(-90, min(lat for lat, _ in coords) - radius_deg)
    max_lat = min(90, max(lat for lat, _ in coords) + radius_deg)
    min_lng = max(-180, min(lng for _, lng in coords) - radius_deg)
    max_lng = min(180, max(lng for _, lng in coords) + radius_deg)
    if max_lat - min_lat > MAX_BBOX_SPAN_DEG or max_lng - min_lng > MAX_BBOX_SPAN_DEG:
        center_lat = (min_lat + max_lat) / 2
        center_lng = (min_lng + max_lng) / 2
        half = MAX_BBOX_SPAN_DEG / 2
        return (center_lng - half, center_lat - half, center_lng + half, center_lat + half)
    return (min_lng, min_lat, max_lng, max_lat)


def bboxes_for_route_corridor(waypoints: list[dict], radius_deg: float = 0.12, max_boxes: int = 8) -> list[tuple[float, float, float, float]]:
    coords = [(float(wp["lat"]), float(wp["lng"])) for wp in waypoints if wp.get("lat") and wp.get("lng")]
    if not coords:
        return []
    if len(coords) <= max_boxes:
        samples = coords
    else:
        step = (len(coords) - 1) / (max_boxes - 1)
        samples = [coords[round(i * step)] for i in range(max_boxes)]
    return [bbox_for_center(lat, lng, radius_deg) for lat, lng in samples]


async def get_tomtom_incidents_for_bbox(bbox: tuple[float, float, float, float]) -> list[dict]:
    if not tomtom_enabled():
        return []
    key = _bbox_key(bbox)
    cached = _cache.get(key)
    now = time.time()
    if cached and now - cached[0] < TRAFFIC_CACHE_TTL_SECONDS:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                TOMTOM_INCIDENTS_URL,
                params={
                    "bbox": ",".join(f"{v:.6f}" for v in bbox),
                    "fields": "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,roadNumbers,delay,length}}}",
                    "language": "en-US",
                    "key": settings.tomtom_api_key,
                },
            )
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:
        log.warning("TomTom traffic incidents fetch failed: %s", exc)
        return []
    incidents = payload.get("incidents") or payload.get("tm", {}).get("poi") or []
    alerts = [a for item in incidents if (a := _normalize_incident(item))]
    _cache[key] = (now, alerts)
    return alerts


def filter_alerts_near_waypoints(alerts: list[dict], waypoints: list[dict], radius_deg: float = 0.12) -> list[dict]:
    valid = [(float(wp["lat"]), float(wp["lng"]), wp.get("day")) for wp in waypoints if wp.get("lat") and wp.get("lng")]
    if not valid:
        return []
    out = []
    for alert in alerts:
        best_day = None
        for lat, lng, day in valid:
            if abs(float(alert["lat"]) - lat) <= radius_deg and abs(float(alert["lng"]) - lng) <= radius_deg:
                best_day = day
                break
        if best_day is not None:
            copied = dict(alert)
            copied["waypoint_day"] = best_day
            out.append(copied)
    return out


def filter_tomtom_alerts_along_route(
    alerts: list[dict],
    waypoints: list[dict],
    default_radius_m: float = 1_200.0,
) -> list[dict]:
    valid = [wp for wp in waypoints if wp.get("lat") and wp.get("lng")]
    if not valid:
        return []
    out: list[dict] = []
    for alert in alerts:
        points = _alert_points(alert)
        if not points:
            continue
        best_distance = float("inf")
        best_day = None
        for point_lat, point_lng in points:
            distance_m, day = _nearest_route_match(point_lat, point_lng, valid)
            if distance_m < best_distance:
                best_distance = distance_m
                best_day = day
        if best_day is None:
            continue
        if best_distance > _route_match_radius_m(alert, default_radius_m):
            continue
        copied = dict(alert)
        copied["waypoint_day"] = best_day
        copied["route_distance_m"] = round(best_distance, 1)
        out.append(copied)
    return out
