"""Server-side live condition providers for map and navigation alerts."""
from __future__ import annotations

import asyncio
from collections import deque
import csv
import io
import logging
import math
import hashlib
import json
import time
import weakref
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any
from xml.etree import ElementTree as ET

import httpx

from config.settings import settings
from db.store import get_cached, get_wfigs_map_cached, set_cached, set_wfigs_map_cached
from ingestors.tomtom_traffic import (
    bbox_for_center,
    bboxes_for_route_corridor,
    filter_alerts_near_waypoints,
    filter_tomtom_alerts_along_route,
    get_tomtom_incidents_for_bbox,
)

log = logging.getLogger(__name__)

WFIGS_PERIMETERS_URL = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query"
WFIGS_MAP_CACHE_TTL_SECONDS = 900
WFIGS_MAP_MAX_FEATURES = 120
WFIGS_LEGACY_MAP_MAX_FEATURES = 800
WFIGS_MAP_MAX_FEATURE_VERTICES = 12_000
WFIGS_MAP_MAX_TOTAL_VERTICES = 60_000
WFIGS_MAP_MAX_SERIALIZED_BYTES = 2_000_000
WFIGS_MAP_MAX_UPSTREAM_BYTES = 8_000_000
WFIGS_MAP_STALE_MAX_AGE_SECONDS = 1_800
WFIGS_MAP_FAILURE_BACKOFF_SECONDS = 60
WFIGS_MAP_OUTBOUND_WINDOW_SECONDS = 60
WFIGS_MAP_OUTBOUND_MAX_REQUESTS = 24
WFIGS_MAP_OUTBOUND_CONCURRENCY = 3
WFIGS_MAP_MAX_DROPPED_SUMMARY = 1_000_000
WFIGS_MAP_PARTIAL_REASONS = frozenset({
    "provider_limit",
    "invalid_geometry",
    "feature_vertex_limit",
    "total_vertex_limit",
    "feature_limit",
    "serialized_size_limit",
    "cell_fetch_failure",
    "stale_cell",
})
NWS_ALERTS_URL = "https://api.weather.gov/alerts/active"
AIRNOW_CURRENT_URL = "https://www.airnowapi.org/aq/observation/latLong/current/"
FIRMS_AREA_URL = "https://firms.modaps.eosdis.nasa.gov/usfs/api/area/csv"

_WFIGS_MAP_LOOP_STATES: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()
GDACS_RSS_URL = "https://www.gdacs.org/xml/rss.xml"
UA = "Trailhead/1.0 (https://api.gettrailhead.app; hello@gettrailhead.app)"


def _now() -> int:
    return int(time.time())


def _parse_ts(value: Any) -> int | None:
    if isinstance(value, (int, float)):
        return int(value / 1000 if value > 10_000_000_000 else value)
    if not isinstance(value, str) or not value:
        return None
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


def _parse_rfc822_ts(value: Any) -> int | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return int(parsedate_to_datetime(value.strip()).timestamp())
    except Exception:
        return _parse_ts(value)


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _coords_from_geometry(geometry: dict | None) -> list[tuple[float, float]]:
    if not isinstance(geometry, dict):
        return []
    coords = geometry.get("coordinates") or []
    gtype = geometry.get("type")
    if gtype == "Point" and len(coords) >= 2:
        return [(float(coords[1]), float(coords[0]))]
    if gtype == "Polygon":
        pts = [pt for ring in coords for pt in ring if isinstance(pt, list) and len(pt) >= 2]
        return [(float(pt[1]), float(pt[0])) for pt in pts]
    if gtype == "MultiPolygon":
        pts = [pt for poly in coords for ring in poly for pt in ring if isinstance(pt, list) and len(pt) >= 2]
        return [(float(pt[1]), float(pt[0])) for pt in pts]
    return []


def _centroid(geometry: dict | None) -> tuple[float, float] | None:
    pts = _coords_from_geometry(geometry)
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def _bbox_distance_candidate(lat: float, lng: float, bbox_text: str, radius_miles: float) -> bool:
    """GDACS bbox format is lonmin lonmax latmin latmax."""
    try:
        lon_min, lon_max, lat_min, lat_max = [float(v) for v in str(bbox_text or "").split()[:4]]
    except Exception:
        return False
    pad = max(0.05, min(radius_miles / 69.0, 2.0))
    return (lat_min - pad) <= lat <= (lat_max + pad) and (lon_min - pad) <= lng <= (lon_max + pad)


def _condition_alert(
    *,
    provider: str,
    provider_id: str,
    alert_type: str,
    subtype: str,
    severity: str,
    description: str,
    lat: float,
    lng: float,
    created_at: int | None = None,
    updated_at: int | None = None,
    expires_at: int | None = None,
    road_name: str | None = None,
    geometry: dict | None = None,
    confidence: float = 0.85,
) -> dict:
    ts = updated_at or created_at or _now()
    return {
        "id": f"{provider}:{provider_id}",
        "source": "provider",
        "provider": provider,
        "provider_id": provider_id,
        "type": alert_type,
        "subtype": subtype,
        "severity": severity,
        "description": description,
        "lat": lat,
        "lng": lng,
        "geometry": geometry,
        "created_at": created_at or ts,
        "updated_at": ts,
        "expires_at": expires_at,
        "road_name": road_name,
        "confidence": confidence,
        "upvotes": 0,
        "downvotes": 0,
        "confirmations": 0,
        "has_photo": 0,
        "cluster_count": 1,
        "username": provider.upper(),
    }


def _nws_severity(raw: str) -> str:
    value = (raw or "").lower()
    if value == "extreme":
        return "critical"
    if value == "severe":
        return "high"
    if value == "moderate":
        return "moderate"
    return "low"


def _aqi_severity(aqi: int) -> str:
    if aqi >= 201:
        return "critical"
    if aqi >= 151:
        return "high"
    if aqi >= 101:
        return "moderate"
    return "low"


def _aqi_label(aqi: int) -> str:
    if aqi >= 301:
        return "Hazardous smoke/AQI"
    if aqi >= 201:
        return "Very unhealthy smoke/AQI"
    if aqi >= 151:
        return "Unhealthy smoke/AQI"
    if aqi >= 101:
        return "Smoke/AQI sensitive groups"
    if aqi >= 51:
        return "Moderate air quality"
    return "Good air quality"


GDACS_EVENT_TYPES = {
    "EQ": "earthquake",
    "TC": "cyclone",
    "FL": "flood",
    "VO": "volcano",
    "DR": "drought",
    "WF": "fire",
    "TS": "tsunami",
}


def _gdacs_severity(alert_level: str, distance_m: float) -> str:
    level = str(alert_level or "").strip().lower()
    if level == "red":
        return "critical"
    if level == "orange":
        return "high"
    if level == "green" and distance_m <= 25 * 1609.344:
        return "moderate"
    return "low"


def _xml_text(node: ET.Element, path: str, ns: dict[str, str]) -> str:
    found = node.find(path, ns)
    return (found.text or "").strip() if found is not None and found.text else ""


async def get_gdacs_alerts_near(lat: float, lng: float, radius_miles: float = 75) -> list[dict]:
    if not settings.gdacs_alerts_enabled:
        return []
    radius_miles = max(10.0, min(radius_miles, 250.0))
    key = f"conditions:gdacs:{lat:.1f},{lng:.1f}:{int(radius_miles)}"
    cached = get_cached("weather_cache", key, ttl_seconds=900)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(timeout=12, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml"}) as client:
            resp = await client.get(GDACS_RSS_URL)
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
    except Exception as exc:
        log.warning("GDACS alerts fetch failed: %s", exc)
        return []

    ns = {
        "geo": "http://www.w3.org/2003/01/geo/wgs84_pos#",
        "gdacs": "http://www.gdacs.org",
        "dc": "http://purl.org/dc/elements/1.1/",
    }
    alerts: list[dict] = []
    for item in root.findall(".//item"):
        try:
            alat = float(_xml_text(item, "geo:Point/geo:lat", ns))
            alng = float(_xml_text(item, "geo:Point/geo:long", ns))
        except Exception:
            continue
        distance_m = _haversine_m(lat, lng, alat, alng)
        bbox_text = _xml_text(item, "gdacs:bbox", ns)
        if distance_m > radius_miles * 1609.344 and not _bbox_distance_candidate(lat, lng, bbox_text, radius_miles):
            continue
        event_type = _xml_text(item, "gdacs:eventtype", ns)
        alert_level = _xml_text(item, "gdacs:alertlevel", ns)
        severity = _gdacs_severity(alert_level, distance_m)
        if severity == "low":
            continue
        event_name = _xml_text(item, "gdacs:eventname", ns)
        country = _xml_text(item, "gdacs:country", ns)
        title = _xml_text(item, "title", ns)
        desc = _xml_text(item, "description", ns) or title
        label = GDACS_EVENT_TYPES.get(event_type.upper(), event_type.lower() or "disaster")
        provider_id = f"{event_type}{_xml_text(item, 'gdacs:eventid', ns) or _xml_text(item, 'guid', ns)}"
        description = " · ".join([part for part in [title, event_name, country, desc] if part])[:520]
        alerts.append(_condition_alert(
            provider="gdacs",
            provider_id=provider_id,
            alert_type=label,
            subtype=f"{alert_level.title()} GDACS {label}".strip(),
            severity=severity,
            description=description,
            lat=alat,
            lng=alng,
            created_at=_parse_rfc822_ts(_xml_text(item, "gdacs:dateadded", ns) or _xml_text(item, "pubDate", ns)),
            updated_at=_parse_rfc822_ts(_xml_text(item, "gdacs:datemodified", ns) or _xml_text(item, "pubDate", ns)),
            expires_at=_parse_rfc822_ts(_xml_text(item, "gdacs:todate", ns)),
            geometry=None,
            confidence=0.84,
        ))
    set_cached("weather_cache", key, alerts[:60])
    return alerts[:60]


async def get_nws_alerts_near(lat: float, lng: float) -> list[dict]:
    key = f"conditions:nws:{lat:.2f},{lng:.2f}"
    cached = get_cached("weather_cache", key, ttl_seconds=300)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(timeout=10, headers={"User-Agent": UA, "Accept": "application/geo+json"}) as client:
            resp = await client.get(NWS_ALERTS_URL, params={"point": f"{lat:.4f},{lng:.4f}"})
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:
        log.warning("NWS alerts fetch failed: %s", exc)
        return []
    alerts: list[dict] = []
    for feature in payload.get("features") or []:
        props = feature.get("properties") or {}
        event = str(props.get("event") or "Weather alert")
        severity = _nws_severity(str(props.get("severity") or ""))
        if severity == "low":
            continue
        effective = _parse_ts(props.get("effective") or props.get("sent"))
        expires = _parse_ts(props.get("expires") or props.get("ends"))
        desc = str(props.get("headline") or props.get("description") or event)
        alerts.append(_condition_alert(
            provider="nws",
            provider_id=str(props.get("id") or feature.get("id") or event),
            alert_type="weather",
            subtype=event,
            severity=severity,
            description=desc[:500],
            lat=lat,
            lng=lng,
            created_at=effective,
            updated_at=effective,
            expires_at=expires,
            geometry=feature.get("geometry"),
            confidence=0.92,
        ))
    set_cached("weather_cache", key, alerts)
    return alerts


async def get_airnow_alerts_near(lat: float, lng: float, radius_miles: float = 25) -> list[dict]:
    if not settings.airnow_api_key.strip():
        return []
    key = f"conditions:airnow:{lat:.2f},{lng:.2f}:{int(radius_miles)}"
    cached = get_cached("weather_cache", key, ttl_seconds=1800)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                AIRNOW_CURRENT_URL,
                params={
                    "format": "application/json",
                    "latitude": f"{lat:.4f}",
                    "longitude": f"{lng:.4f}",
                    "distance": int(max(5, min(radius_miles, 50))),
                    "API_KEY": settings.airnow_api_key,
                },
            )
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:
        log.warning("AirNow fetch failed: %s", exc)
        return []
    alerts: list[dict] = []
    for row in payload if isinstance(payload, list) else []:
        try:
            aqi = int(row.get("AQI"))
        except Exception:
            continue
        if aqi < 101:
            continue
        pollutant = str(row.get("ParameterName") or "AQI")
        area = str(row.get("ReportingArea") or "Nearby")
        alerts.append(_condition_alert(
            provider="airnow",
            provider_id=f"{area}:{pollutant}:{aqi}",
            alert_type="smoke",
            subtype=_aqi_label(aqi),
            severity=_aqi_severity(aqi),
            description=f"{area}: {pollutant} AQI {aqi} ({row.get('Category', {}).get('Name') or _aqi_label(aqi)}).",
            lat=lat,
            lng=lng,
            updated_at=_parse_ts(row.get("DateObserved")) or _now(),
            confidence=0.82,
        ))
    set_cached("weather_cache", key, alerts)
    return alerts


async def get_wfigs_fire_alerts_near(lat: float, lng: float, radius_miles: float = 50) -> list[dict]:
    payload = await get_wfigs_fire_perimeters()
    if not payload:
        return []
    out: list[dict] = []
    max_m = max(10, min(radius_miles, 150)) * 1609.344
    for feature in payload.get("features") or []:
        center = _centroid(feature.get("geometry"))
        if not center:
            continue
        dist = _haversine_m(lat, lng, center[0], center[1])
        if dist > max_m:
            continue
        props = feature.get("properties") or {}
        name = str(props.get("poly_IncidentName") or "Active wildfire")
        acres = props.get("poly_GISAcres") or props.get("attr_IncidentSize")
        contained = props.get("attr_PercentContained")
        parts = [name]
        if acres not in (None, ""):
            parts.append(f"{round(float(acres)):,} acres")
        if contained not in (None, ""):
            parts.append(f"{contained}% contained")
        severity = "critical" if dist < 10 * 1609.344 else "high"
        out.append(_condition_alert(
            provider="wfigs",
            provider_id=str(props.get("poly_IRWINID") or props.get("poly_IncidentName") or hash(name)),
            alert_type="fire",
            subtype="Active wildfire",
            severity=severity,
            description=" · ".join(parts),
            lat=center[0],
            lng=center[1],
            updated_at=_parse_ts(props.get("attr_ModifiedOnDateTime_dt")) or _now(),
            geometry=feature.get("geometry"),
            confidence=0.88,
        ))
    return out


def _wfigs_map_query_params(
    bounds: tuple[float, float, float, float] | None,
    *,
    max_features: int,
) -> dict[str, str | int]:
    """Build a bounded, generalized WFIGS query suitable for a map overlay.

    Bounds are `(north, south, east, west)`. The generalization is deliberately
    tied to viewport span so the native bridge never receives the full national
    perimeter geometry merely because the layer was enabled.
    """
    safe_limit = max(1, min(int(max_features), WFIGS_LEGACY_MAP_MAX_FEATURES))
    params: dict[str, str | int] = {
        "where": "1=1",
        "outFields": "poly_IRWINID,poly_IncidentName,attr_ModifiedOnDateTime_dt",
        "returnGeometry": "true",
        "outSR": "4326",
        "geometryPrecision": 5,
        "orderByFields": "attr_ModifiedOnDateTime_dt DESC",
        "f": "geojson",
        "resultRecordCount": safe_limit,
    }
    if bounds is None:
        # Backward-compatible callers without a viewport receive a deliberately
        # coarse, capped national overview rather than the unbounded source.
        params["maxAllowableOffset"] = "0.01"
        return params

    north, south, east, west = bounds
    span = max(north - south, east - west)
    if span <= 2:
        offset = 0.00025
    elif span <= 10:
        offset = 0.001
    elif span <= 30:
        offset = 0.005
    else:
        offset = 0.01
    params.update({
        "geometry": f"{west:.6f},{south:.6f},{east:.6f},{north:.6f}",
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "inSR": "4326",
        "maxAllowableOffset": f"{offset:.5f}",
    })
    return params


def _wfigs_map_grid_size(bounds: tuple[float, float, float, float]) -> float:
    north, south, east, west = bounds
    longitude_span = east - west if east > west else (180 - west) + (east + 180)
    span = max(north - south, longitude_span)
    for degrees in (0.25, 0.5, 1, 2, 5, 10, 20, 45, 90, 180):
        if degrees >= span:
            return degrees
    return 180


def _wfigs_map_cells(
    bounds: tuple[float, float, float, float],
) -> tuple[tuple[float, float, float, float], ...]:
    """Expand a viewport into reusable grid cells, including wrapped longitudes."""
    north, south, east, west = (float(value) for value in bounds)
    if not all(math.isfinite(value) for value in (north, south, east, west)):
        raise ValueError("viewport values must be finite")
    if not (-90 <= south < north <= 90 and -180 <= east <= 180 and -180 <= west <= 180):
        raise ValueError("viewport is outside WGS84 bounds")
    if east == west:
        raise ValueError("viewport longitude span must be non-zero")

    grid = _wfigs_map_grid_size((north, south, east, west))
    longitude_segments = ((west, east),) if east > west else ((west, 180.0), (-180.0, east))
    lat_start = math.floor((south + 90) / grid)
    lat_stop = math.ceil((north + 90) / grid)
    cell_south = max(-90.0, -90 + lat_start * grid)
    cell_north = min(90.0, -90 + lat_stop * grid)
    cells: set[tuple[float, float, float, float]] = set()
    for segment_west, segment_east in longitude_segments:
        if segment_east <= segment_west:
            continue
        lng_start = math.floor((segment_west + 180) / grid)
        lng_stop = math.ceil((segment_east + 180) / grid)
        cell_west = max(-180.0, -180 + lng_start * grid)
        cell_east = min(180.0, -180 + lng_stop * grid)
        if cell_north <= cell_south or cell_east <= cell_west:
            continue
        cells.add(tuple(round(value, 6) for value in (
            cell_north, cell_south, cell_east, cell_west,
        )))
    if not cells:
        raise ValueError("viewport did not produce a map cell")
    return tuple(sorted(cells, key=lambda item: (item[3], item[1], item[2], item[0])))


def _wfigs_map_cache_key(
    bounds: tuple[float, float, float, float] | None,
    *,
    max_features: int,
) -> str:
    params = _wfigs_map_query_params(bounds, max_features=max_features)
    cache_fingerprint = hashlib.sha256(
        json.dumps(params, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:20]
    return f"conditions:wfigs:map:v3:{cache_fingerprint}"


def _normalized_wfigs_position(value: Any) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    if isinstance(value[0], bool) or isinstance(value[1], bool):
        return None
    try:
        longitude = float(value[0])
        latitude = float(value[1])
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(longitude) and math.isfinite(latitude)):
        return None
    if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
        return None
    return [round(longitude, 5), round(latitude, 5)]


def _normalized_wfigs_ring(value: Any) -> list[list[float]] | None:
    if not isinstance(value, list) or len(value) < 4:
        return None
    ring: list[list[float]] = []
    for raw_position in value:
        position = _normalized_wfigs_position(raw_position)
        if position is None:
            return None
        ring.append(position)
    if ring[0] != ring[-1]:
        return None
    return ring


def _normalized_wfigs_geometry(value: Any) -> tuple[dict, int] | None:
    if not isinstance(value, dict):
        return None
    geometry_type = value.get("type")
    coordinates = value.get("coordinates")
    if geometry_type == "Polygon":
        if not isinstance(coordinates, list) or not coordinates:
            return None
        rings: list[list[list[float]]] = []
        for raw_ring in coordinates:
            ring = _normalized_wfigs_ring(raw_ring)
            if ring is None:
                return None
            rings.append(ring)
        vertex_count = sum(len(ring) for ring in rings)
        return {"type": "Polygon", "coordinates": rings}, vertex_count
    if geometry_type == "MultiPolygon":
        if not isinstance(coordinates, list) or not coordinates:
            return None
        polygons: list[list[list[list[float]]]] = []
        for raw_polygon in coordinates:
            if not isinstance(raw_polygon, list) or not raw_polygon:
                return None
            polygon: list[list[list[float]]] = []
            for raw_ring in raw_polygon:
                ring = _normalized_wfigs_ring(raw_ring)
                if ring is None:
                    return None
                polygon.append(ring)
            polygons.append(polygon)
        vertex_count = sum(len(ring) for polygon in polygons for ring in polygon)
        return {"type": "MultiPolygon", "coordinates": polygons}, vertex_count
    return None


def _wfigs_geometry_vertex_count(geometry: Any) -> int:
    if not isinstance(geometry, dict):
        return 0
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "Polygon" and isinstance(coordinates, list):
        return sum(len(ring) for ring in coordinates if isinstance(ring, list))
    if geometry.get("type") == "MultiPolygon" and isinstance(coordinates, list):
        return sum(
            len(ring)
            for polygon in coordinates if isinstance(polygon, list)
            for ring in polygon if isinstance(ring, list)
        )
    return 0


def _refresh_wfigs_map_metadata(result: dict) -> int:
    metadata = result["metadata"]
    features = result["features"]
    # Completeness is its own axis. A response can be complete while stale,
    # or current while incomplete for a reason that is not a truncation.
    reported_partial = metadata.get("partial") is True
    metadata["returned_feature_count"] = len(features)
    metadata["vertex_count"] = sum(
        _wfigs_geometry_vertex_count(feature.get("geometry"))
        for feature in features if isinstance(feature, dict)
    )
    dropped = metadata["dropped"]
    reasons = set(metadata.get("truncation_reasons") or [])
    reasons.update(reason for reason, count in dropped.items() if count)
    safe_reasons = sorted(reason for reason in reasons if reason in WFIGS_MAP_PARTIAL_REASONS)
    dropped_feature_count = min(
        WFIGS_MAP_MAX_DROPPED_SUMMARY,
        sum(
            max(0, int(count))
            for count in dropped.values()
            if isinstance(count, (int, float)) and not isinstance(count, bool) and math.isfinite(count)
        ),
    )
    metadata["truncation_reasons"] = safe_reasons
    metadata["truncated"] = bool(safe_reasons or dropped_feature_count)
    # Compact, client-safe coverage summary. This intentionally excludes
    # provider messages, viewport coordinates, and source geometry details.
    metadata["partial"] = reported_partial or metadata["truncated"]
    metadata["partial_reasons"] = safe_reasons
    metadata["dropped_feature_count"] = dropped_feature_count
    metadata["serialized_bytes"] = 0
    for _ in range(4):
        size = len(json.dumps(result, separators=(",", ":"), allow_nan=False).encode("utf-8"))
        if metadata["serialized_bytes"] == size:
            break
        metadata["serialized_bytes"] = size
    return len(json.dumps(result, separators=(",", ":"), allow_nan=False).encode("utf-8"))


def _fit_wfigs_map_serialized_budget(result: dict, *, max_serialized_bytes: int) -> dict:
    while True:
        size = _refresh_wfigs_map_metadata(result)
        if size <= max_serialized_bytes or not result["features"]:
            return result
        result["features"].pop()
        result["metadata"]["dropped"]["serialized_size_limit"] += 1


def _compact_wfigs_map_payload(
    payload: Any,
    *,
    max_features: int,
    max_feature_vertices: int = WFIGS_MAP_MAX_FEATURE_VERTICES,
    max_total_vertices: int = WFIGS_MAP_MAX_TOTAL_VERTICES,
    max_serialized_bytes: int = WFIGS_MAP_MAX_SERIALIZED_BYTES,
) -> dict:
    features = payload.get("features") if isinstance(payload, dict) else None
    if not isinstance(features, list):
        features = []
    feature_limit = max(1, min(int(max_features), WFIGS_LEGACY_MAP_MAX_FEATURES))
    feature_vertex_limit = max(4, min(int(max_feature_vertices), WFIGS_MAP_MAX_FEATURE_VERTICES))
    total_vertex_limit = max(4, min(int(max_total_vertices), WFIGS_MAP_MAX_TOTAL_VERTICES))
    serialized_limit = max(1024, min(int(max_serialized_bytes), WFIGS_MAP_MAX_SERIALIZED_BYTES))
    compact: list[dict] = []
    total_vertices = 0
    dropped = {
        "invalid_geometry": 0,
        "feature_vertex_limit": 0,
        "total_vertex_limit": 0,
        "feature_limit": 0,
        "serialized_size_limit": 0,
    }
    for index, feature in enumerate(features):
        if len(compact) >= feature_limit:
            dropped["feature_limit"] += len(features) - index
            break
        if not isinstance(feature, dict):
            dropped["invalid_geometry"] += 1
            continue
        normalized_geometry = _normalized_wfigs_geometry(feature.get("geometry"))
        if normalized_geometry is None:
            dropped["invalid_geometry"] += 1
            continue
        geometry, vertex_count = normalized_geometry
        if vertex_count > feature_vertex_limit:
            dropped["feature_vertex_limit"] += 1
            continue
        if total_vertices + vertex_count > total_vertex_limit:
            dropped["total_vertex_limit"] += 1
            continue
        props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        provider_id = props.get("id") or props.get("poly_IRWINID") or feature.get("id")
        provider_name = props.get("name") or props.get("poly_IncidentName")
        updated_at = props.get("updated_at") or props.get("attr_ModifiedOnDateTime_dt")
        compact.append({
            "type": "Feature",
            "geometry": geometry,
            "properties": {
                "id": str(provider_id)[:128] if provider_id is not None else None,
                "name": str(provider_name)[:200] if provider_name is not None else None,
                "updated_at": (
                    updated_at if isinstance(updated_at, (int, float)) and not isinstance(updated_at, bool)
                    else str(updated_at)[:64] if updated_at is not None else None
                ),
            },
        })
        total_vertices += vertex_count
    upstream_truncated = bool(
        isinstance(payload, dict)
        and (
            payload.get("exceededTransferLimit")
            or (isinstance(payload.get("metadata"), dict) and payload["metadata"].get("truncated"))
        )
    )
    result = {
        "type": "FeatureCollection",
        "features": compact,
        "metadata": {
            "source": "WFIGS",
            "source_feature_count": len(features),
            "returned_feature_count": len(compact),
            "vertex_count": total_vertices,
            "serialized_bytes": 0,
            "truncated": upstream_truncated,
            "truncation_reasons": ["provider_limit"] if upstream_truncated else [],
            "dropped": dropped,
            "limits": {
                "features": feature_limit,
                "vertices_per_feature": feature_vertex_limit,
                "vertices_total": total_vertex_limit,
                "serialized_bytes": serialized_limit,
            },
        },
    }
    return _fit_wfigs_map_serialized_budget(result, max_serialized_bytes=serialized_limit)


def _merge_wfigs_map_payloads(
    payloads: list[dict],
    *,
    max_features: int,
    failed_cell_count: int = 0,
) -> dict:
    source_feature_count = 0
    upstream_reasons: set[str] = set()
    degraded_cell_count = 0
    stale_cell_count = 0
    partial_cell_count = 0
    maximum_age_seconds = 0
    combined_dropped = {
        "invalid_geometry": 0,
        "feature_vertex_limit": 0,
        "total_vertex_limit": 0,
        "feature_limit": 0,
        "serialized_size_limit": 0,
    }
    combined: list[dict] = []
    for payload in payloads:
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        source_feature_count += int(metadata.get("source_feature_count") or len(payload.get("features") or []))
        upstream_reasons.update(
            reason
            for reason in [
                *(metadata.get("truncation_reasons") or []),
                *(metadata.get("partial_reasons") or []),
            ]
            if reason in WFIGS_MAP_PARTIAL_REASONS
        )
        payload_dropped = metadata.get("dropped") if isinstance(metadata.get("dropped"), dict) else {}
        for reason in combined_dropped:
            count = payload_dropped.get(reason)
            if isinstance(count, (int, float)) and not isinstance(count, bool) and math.isfinite(count):
                combined_dropped[reason] = min(
                    WFIGS_MAP_MAX_DROPPED_SUMMARY,
                    combined_dropped[reason] + max(0, int(count)),
                )
        maximum_age_seconds = max(maximum_age_seconds, int(metadata.get("age_seconds") or 0))
        availability = metadata.get("availability")
        freshness = metadata.get("freshness")
        if availability != "available":
            degraded_cell_count += 1
        if freshness == "stale":
            stale_cell_count += 1
        if (
            freshness == "partial"  # Backward compatibility with pre-axis cache rows.
            or metadata.get("partial")
            or metadata.get("truncated")
            or metadata.get("partial_reasons")
            or metadata.get("truncation_reasons")
        ):
            partial_cell_count += 1
        combined.extend(payload.get("features") or [])
    combined.sort(
        key=lambda feature: (
            _parse_ts((feature.get("properties") or {}).get("updated_at")) or 0,
            str((feature.get("properties") or {}).get("id") or ""),
        ),
        reverse=True,
    )
    unique: list[dict] = []
    seen: set[str] = set()
    duplicate_count = 0
    for feature in combined:
        props = feature.get("properties") if isinstance(feature, dict) else {}
        identity = str((props or {}).get("id") or "").strip()
        if not identity:
            identity = hashlib.sha256(
                json.dumps(feature.get("geometry"), sort_keys=True, separators=(",", ":")).encode("utf-8")
            ).hexdigest()
        if identity in seen:
            duplicate_count += 1
            continue
        seen.add(identity)
        unique.append(feature)
    merged = _compact_wfigs_map_payload(
        {"type": "FeatureCollection", "features": unique},
        max_features=max_features,
    )
    metadata = merged["metadata"]
    for reason, count in combined_dropped.items():
        metadata["dropped"][reason] = min(
            WFIGS_MAP_MAX_DROPPED_SUMMARY,
            int(metadata["dropped"].get(reason) or 0) + count,
        )
    metadata["source_feature_count"] = source_feature_count
    metadata["cell_count"] = len(payloads) + failed_cell_count
    metadata["failed_cell_count"] = failed_cell_count
    metadata["degraded_cell_count"] = degraded_cell_count
    metadata["stale_cell_count"] = stale_cell_count
    metadata["partial_cell_count"] = partial_cell_count
    metadata["duplicate_feature_count"] = duplicate_count
    metadata["availability"] = "degraded" if degraded_cell_count or failed_cell_count else "available"
    has_partial_coverage = bool(
        failed_cell_count
        or partial_cell_count
        or upstream_reasons
        or any(combined_dropped.values())
    )
    # Availability, freshness, and completeness are independent. In
    # particular, a complete cached fallback is degraded + stale, not partial.
    metadata["freshness"] = "stale" if stale_cell_count else "fresh"
    metadata["partial"] = has_partial_coverage
    metadata["age_seconds"] = maximum_age_seconds
    reasons = set(metadata.get("truncation_reasons") or []) | upstream_reasons
    if failed_cell_count:
        reasons.add("cell_fetch_failure")
    metadata["truncation_reasons"] = sorted(reasons)
    metadata["truncated"] = bool(reasons)
    return _fit_wfigs_map_serialized_budget(
        merged,
        max_serialized_bytes=int(metadata["limits"]["serialized_bytes"]),
    )


def _wfigs_map_loop_state() -> dict:
    loop = asyncio.get_running_loop()
    state = _WFIGS_MAP_LOOP_STATES.get(loop)
    if state is None:
        state = {
            "semaphore": asyncio.Semaphore(WFIGS_MAP_OUTBOUND_CONCURRENCY),
            "rate_lock": asyncio.Lock(),
            "request_times": deque(),
            "failures": {},
            "flights": {},
        }
        _WFIGS_MAP_LOOP_STATES[loop] = state
    return state


def _wfigs_map_payload_availability(
    payload: dict,
    *,
    availability: str,
    freshness: str,
    age_seconds: int,
    reason: str | None = None,
) -> dict:
    result = dict(payload)
    metadata = dict(payload.get("metadata") or {})
    is_partial = bool(
        metadata.get("partial")
        or metadata.get("truncated")
        or metadata.get("partial_reasons")
        or metadata.get("truncation_reasons")
        or metadata.get("dropped_feature_count")
    )
    metadata.update({
        "availability": availability,
        # Do not encode completeness in freshness. A current response with a
        # missing cell is fresh + partial; a complete cache fallback is stale
        # + not partial.
        "freshness": freshness,
        "partial": is_partial,
        "age_seconds": max(0, int(age_seconds)),
    })
    if reason:
        metadata["availability_reason"] = reason
    else:
        metadata.pop("availability_reason", None)
    result["metadata"] = metadata
    return result


async def _reserve_wfigs_map_outbound_request(state: dict) -> bool:
    async with state["rate_lock"]:
        now = time.monotonic()
        request_times: deque = state["request_times"]
        while request_times and now - request_times[0] >= WFIGS_MAP_OUTBOUND_WINDOW_SECONDS:
            request_times.popleft()
        if len(request_times) >= WFIGS_MAP_OUTBOUND_MAX_REQUESTS:
            return False
        request_times.append(now)
        return True


def _wfigs_map_failure_is_active(state: dict, key: str) -> bool:
    now = time.monotonic()
    failures: dict[str, float] = state["failures"]
    expired = [candidate for candidate, deadline in failures.items() if deadline <= now]
    for candidate in expired:
        failures.pop(candidate, None)
    return failures.get(key, 0) > now


def _wfigs_map_record_failure(state: dict, key: str) -> None:
    failures: dict[str, float] = state["failures"]
    if len(failures) >= 256 and key not in failures:
        oldest = min(failures, key=failures.get)
        failures.pop(oldest, None)
    failures[key] = time.monotonic() + WFIGS_MAP_FAILURE_BACKOFF_SECONDS


async def _fetch_wfigs_map_payload(
    client: httpx.AsyncClient,
    *,
    bounds: tuple[float, float, float, float] | None,
    max_features: int,
) -> dict | None:
    params = _wfigs_map_query_params(bounds, max_features=max_features)
    key = _wfigs_map_cache_key(bounds, max_features=max_features)
    cached, cached_age = get_wfigs_map_cached(key, max_age_seconds=WFIGS_MAP_STALE_MAX_AGE_SECONDS)
    if isinstance(cached, dict) and cached_age is not None and cached_age <= WFIGS_MAP_CACHE_TTL_SECONDS:
        return _wfigs_map_payload_availability(
            cached,
            availability="available",
            freshness="fresh",
            age_seconds=cached_age,
        )
    state = _wfigs_map_loop_state()
    if _wfigs_map_failure_is_active(state, key):
        return _wfigs_map_payload_availability(
            cached,
            availability="degraded",
            freshness="stale",
            age_seconds=cached_age or 0,
            reason="provider_backoff",
        ) if isinstance(cached, dict) else None

    flights: dict = state["flights"]
    flight = flights.get(key)
    if flight is None:
        flight = {"lock": asyncio.Lock(), "users": 0}
        flights[key] = flight
    flight["users"] += 1
    try:
        async with flight["lock"]:
            cached, cached_age = get_wfigs_map_cached(key, max_age_seconds=WFIGS_MAP_STALE_MAX_AGE_SECONDS)
            if isinstance(cached, dict) and cached_age is not None and cached_age <= WFIGS_MAP_CACHE_TTL_SECONDS:
                return _wfigs_map_payload_availability(
                    cached,
                    availability="available",
                    freshness="fresh",
                    age_seconds=cached_age,
                )
            if _wfigs_map_failure_is_active(state, key):
                return _wfigs_map_payload_availability(
                    cached,
                    availability="degraded",
                    freshness="stale",
                    age_seconds=cached_age or 0,
                    reason="provider_backoff",
                ) if isinstance(cached, dict) else None
            if not await _reserve_wfigs_map_outbound_request(state):
                return _wfigs_map_payload_availability(
                    cached,
                    availability="degraded",
                    freshness="stale",
                    age_seconds=cached_age or 0,
                    reason="provider_rate_limited",
                ) if isinstance(cached, dict) else None
            try:
                content = bytearray()
                async with state["semaphore"]:
                    async with client.stream("GET", WFIGS_PERIMETERS_URL, params=params) as response:
                        response.raise_for_status()
                        content_length = response.headers.get("content-length")
                        if content_length and int(content_length) > WFIGS_MAP_MAX_UPSTREAM_BYTES:
                            raise ValueError("WFIGS map response exceeds byte budget")
                        async for chunk in response.aiter_bytes():
                            if len(content) + len(chunk) > WFIGS_MAP_MAX_UPSTREAM_BYTES:
                                raise ValueError("WFIGS map response exceeds byte budget")
                            content.extend(chunk)
                payload = json.loads(content)
                if (
                    not isinstance(payload, dict)
                    or payload.get("type") != "FeatureCollection"
                    or not isinstance(payload.get("features"), list)
                    or payload.get("error")
                ):
                    # ArcGIS may report quota and provider failures in a JSON
                    # body while retaining HTTP 200. Never cache that response
                    # as a fresh, empty fire layer.
                    raise ValueError("WFIGS map response is not a GeoJSON FeatureCollection")
                compact = _compact_wfigs_map_payload(payload, max_features=max_features)
                try:
                    set_wfigs_map_cached(key, compact)
                except Exception as cache_error:
                    log.warning("WFIGS map cache write failed: %s", type(cache_error).__name__)
                state["failures"].pop(key, None)
                return _wfigs_map_payload_availability(
                    compact,
                    availability="available",
                    freshness="fresh",
                    age_seconds=0,
                )
            except Exception as exc:
                _wfigs_map_record_failure(state, key)
                log.warning("WFIGS map fetch failed: %s", type(exc).__name__)
                return _wfigs_map_payload_availability(
                    cached,
                    availability="degraded",
                    freshness="stale",
                    age_seconds=cached_age or 0,
                    reason="provider_unavailable",
                ) if isinstance(cached, dict) else None
    finally:
        flight["users"] -= 1
        if flight["users"] <= 0 and flights.get(key) is flight:
            flights.pop(key, None)


async def get_wfigs_fire_perimeters(
    *,
    bounds: tuple[float, float, float, float] | None = None,
    map_safe: bool = False,
    max_features: int = 120,
) -> dict | None:
    if map_safe:
        cells: tuple[tuple[float, float, float, float] | None, ...] = (
            (None,) if bounds is None else _wfigs_map_cells(bounds)
        )
        async with httpx.AsyncClient(timeout=15) as client:
            results = await asyncio.gather(*(
                _fetch_wfigs_map_payload(client, bounds=cell, max_features=max_features)
                for cell in cells
            ))
        payloads = [payload for payload in results if isinstance(payload, dict)]
        if not payloads:
            return None
        if len(cells) == 1 and len(payloads) == 1:
            return payloads[0]
        return _merge_wfigs_map_payloads(
            payloads,
            max_features=max_features,
            failed_cell_count=len(cells) - len(payloads),
        )

    params = {
        "where": "1=1",
        "outFields": "poly_IRWINID,poly_IncidentName,poly_GISAcres,attr_IncidentSize,attr_PercentContained,attr_FireCause,attr_IncidentTypeCategory,attr_ModifiedOnDateTime_dt",
        "returnGeometry": "true",
        "f": "geojson",
        "resultRecordCount": 800,
    }
    key = "conditions:wfigs:perimeters"
    payload = get_cached("weather_cache", key, ttl_seconds=900)
    if payload is None:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    WFIGS_PERIMETERS_URL,
                    params=params,
                )
                resp.raise_for_status()
                payload = resp.json()
            set_cached("weather_cache", key, payload)
        except Exception as exc:
            log.warning("WFIGS fire fetch failed: %s", exc)
            return None
    return payload


async def get_firms_fire_alerts_near(lat: float, lng: float, radius_miles: float = 35) -> list[dict]:
    if not settings.nasa_firms_map_key.strip():
        return []
    deg = max(0.15, min(radius_miles / 69.0, 1.25))
    west, south, east, north = bbox_for_center(lat, lng, deg)
    key = f"conditions:firms:{west:.2f},{south:.2f},{east:.2f},{north:.2f}"
    cached = get_cached("weather_cache", key, ttl_seconds=1800)
    if cached is not None:
        return cached
    url = f"{FIRMS_AREA_URL}/{settings.nasa_firms_map_key}/VIIRS_SNPP_NRT/{west:.4f},{south:.4f},{east:.4f},{north:.4f}/1"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            rows = list(csv.DictReader(io.StringIO(resp.text)))
    except Exception as exc:
        log.warning("NASA FIRMS fetch failed: %s", exc)
        return []
    alerts: list[dict] = []
    for row in rows[:80]:
        try:
            flat = float(row.get("latitude") or 0)
            flng = float(row.get("longitude") or 0)
        except Exception:
            continue
        dist_m = _haversine_m(lat, lng, flat, flng)
        if dist_m > radius_miles * 1609.344:
            continue
        conf = str(row.get("confidence") or "").lower()
        severity = "high" if conf in {"h", "high"} or dist_m < 10 * 1609.344 else "moderate"
        alerts.append(_condition_alert(
            provider="firms",
            provider_id=f"{row.get('latitude')}:{row.get('longitude')}:{row.get('acq_date')}:{row.get('acq_time')}",
            alert_type="fire",
            subtype="Satellite fire detection",
            severity=severity,
            description=f"Satellite heat detection {dist_m / 1609.344:.1f} mi away. Verify perimeter and local evacuation notices.",
            lat=flat,
            lng=flng,
            updated_at=_now(),
            confidence=0.72,
        ))
    set_cached("weather_cache", key, alerts)
    return alerts


def _dedupe(alerts: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for alert in alerts:
        key = str(alert.get("id") or f"{alert.get('provider')}:{alert.get('provider_id')}")
        if key in seen:
            continue
        seen.add(key)
        out.append(alert)
    return out


async def get_provider_conditions_near(lat: float, lng: float, radius_deg: float = 0.5) -> list[dict]:
    radius_miles = max(5.0, min(radius_deg * 69.0, 75.0))
    bbox = bbox_for_center(lat, lng, radius_deg)
    results = await asyncio_gather_quiet(
        get_tomtom_incidents_for_bbox(bbox),
        get_nws_alerts_near(lat, lng),
        get_airnow_alerts_near(lat, lng, radius_miles=min(radius_miles, 50)),
        get_wfigs_fire_alerts_near(lat, lng, radius_miles=radius_miles),
        get_firms_fire_alerts_near(lat, lng, radius_miles=min(radius_miles, 50)),
        get_gdacs_alerts_near(lat, lng, radius_miles=max(radius_miles, 90)),
    )
    return _dedupe([item for result in results for item in result])


async def get_provider_conditions_along_route(waypoints: list[dict], radius_deg: float = 0.12) -> list[dict]:
    samples = [{"lat": float(wp["lat"]), "lng": float(wp["lng"]), "day": wp.get("day")} for wp in waypoints if wp.get("lat") and wp.get("lng")]
    if not samples:
        return []
    tomtom_alerts: list[dict] = []
    context_alerts: list[dict] = []
    seen: set[str] = set()
    for bbox in bboxes_for_route_corridor(samples, radius_deg):
        for alert in await get_tomtom_incidents_for_bbox(bbox):
            key = str(alert.get("id") or alert.get("provider_id"))
            if key not in seen:
                seen.add(key)
                tomtom_alerts.append(alert)
    for sample in samples[:8]:
        radius_miles = max(5.0, min(max(radius_deg, 0.18) * 69.0, 75.0))
        sample_results = await asyncio_gather_quiet(
            get_nws_alerts_near(sample["lat"], sample["lng"]),
            get_airnow_alerts_near(sample["lat"], sample["lng"], radius_miles=min(radius_miles, 50)),
            get_wfigs_fire_alerts_near(sample["lat"], sample["lng"], radius_miles=radius_miles),
            get_firms_fire_alerts_near(sample["lat"], sample["lng"], radius_miles=min(radius_miles, 50)),
            get_gdacs_alerts_near(sample["lat"], sample["lng"], radius_miles=max(radius_miles, 90)),
        )
        for alert in [item for result in sample_results for item in result]:
            key = str(alert.get("id") or alert.get("provider_id"))
            if key not in seen:
                seen.add(key)
                context_alerts.append(alert)
    filtered = _dedupe(
        [
            *filter_tomtom_alerts_along_route(tomtom_alerts, samples, default_radius_m=1_200.0),
            *filter_alerts_near_waypoints(context_alerts, samples, radius_deg=max(radius_deg, 0.18)),
        ]
    )
    high_value: list[dict] = []
    low_traffic = 0
    for alert in filtered:
        is_tomtom_traffic = alert.get("provider") == "tomtom" and alert.get("type") == "traffic"
        if is_tomtom_traffic and str(alert.get("severity") or "low") in {"low", "moderate"}:
            low_traffic += 1
            continue
        high_value.append(alert)
    if low_traffic:
        high_value.append({
            "id": "tomtom:traffic-summary",
            "provider": "tomtom",
            "provider_id": "traffic-summary",
            "source": "provider",
            "lat": samples[len(samples) // 2]["lat"],
            "lng": samples[len(samples) // 2]["lng"],
            "type": "traffic",
            "subtype": "summary",
            "severity": "low",
            "description": f"{low_traffic} ordinary traffic slowdowns hidden from default route alerts.",
            "confidence": 0.7,
            "created_at": int(time.time()),
            "updated_at": int(time.time()),
        })
    return high_value[:40]


async def asyncio_gather_quiet(*aws) -> list[list[dict]]:
    import asyncio

    results = await asyncio.gather(*aws, return_exceptions=True)
    out: list[list[dict]] = []
    for result in results:
        out.append(result if isinstance(result, list) else [])
    return out
