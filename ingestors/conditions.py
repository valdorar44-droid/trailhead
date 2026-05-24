"""Server-side live condition providers for map and navigation alerts."""
from __future__ import annotations

import csv
import io
import logging
import math
import time
from datetime import datetime
from typing import Any

import httpx

from config.settings import settings
from db.store import get_cached, set_cached
from ingestors.tomtom_traffic import (
    bbox_for_center,
    bboxes_for_route_corridor,
    filter_alerts_near_waypoints,
    get_tomtom_incidents_for_bbox,
)

log = logging.getLogger(__name__)

WFIGS_PERIMETERS_URL = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query"
NWS_ALERTS_URL = "https://api.weather.gov/alerts/active"
AIRNOW_CURRENT_URL = "https://www.airnowapi.org/aq/observation/latLong/current/"
FIRMS_AREA_URL = "https://firms.modaps.eosdis.nasa.gov/usfs/api/area/csv"
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


async def get_wfigs_fire_perimeters() -> dict | None:
    key = "conditions:wfigs:perimeters"
    payload = get_cached("weather_cache", key, ttl_seconds=900)
    if payload is None:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    WFIGS_PERIMETERS_URL,
                    params={
                        "where": "1=1",
                        "outFields": "poly_IRWINID,poly_IncidentName,poly_GISAcres,attr_IncidentSize,attr_PercentContained,attr_FireCause,attr_IncidentTypeCategory,attr_ModifiedOnDateTime_dt",
                        "returnGeometry": "true",
                        "f": "geojson",
                        "resultRecordCount": 800,
                    },
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
    )
    return _dedupe([item for result in results for item in result])


async def get_provider_conditions_along_route(waypoints: list[dict], radius_deg: float = 0.12) -> list[dict]:
    samples = [{"lat": float(wp["lat"]), "lng": float(wp["lng"]), "day": wp.get("day")} for wp in waypoints if wp.get("lat") and wp.get("lng")]
    if not samples:
        return []
    combined: list[dict] = []
    seen: set[str] = set()
    for bbox in bboxes_for_route_corridor(samples, radius_deg):
        for alert in await get_tomtom_incidents_for_bbox(bbox):
            key = str(alert.get("id") or alert.get("provider_id"))
            if key not in seen:
                seen.add(key)
                combined.append(alert)
    for sample in samples[:8]:
        radius_miles = max(5.0, min(max(radius_deg, 0.18) * 69.0, 75.0))
        sample_results = await asyncio_gather_quiet(
            get_nws_alerts_near(sample["lat"], sample["lng"]),
            get_airnow_alerts_near(sample["lat"], sample["lng"], radius_miles=min(radius_miles, 50)),
            get_wfigs_fire_alerts_near(sample["lat"], sample["lng"], radius_miles=radius_miles),
            get_firms_fire_alerts_near(sample["lat"], sample["lng"], radius_miles=min(radius_miles, 50)),
        )
        for alert in [item for result in sample_results for item in result]:
            key = str(alert.get("id") or alert.get("provider_id"))
            if key not in seen:
                seen.add(key)
                combined.append(alert)
    filtered = filter_alerts_near_waypoints(combined, samples, radius_deg=max(radius_deg, 0.18))
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
