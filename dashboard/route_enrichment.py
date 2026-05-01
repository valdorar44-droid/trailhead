"""Verified route-corridor enrichment for generated trips.

The AI creates the narrative route and waypoint intent. This module adds
grounded map data along that route: real camps, ordinary gas stations, and
useful POIs close enough to matter while driving.
"""
from __future__ import annotations

import asyncio
import math
from typing import Iterable

from ingestors.nrel import get_gas_along_route
from ingestors.osm import (
    get_fuel_stations,
    get_hot_springs,
    get_osm_campsites,
    get_peaks,
    get_trailheads,
    get_viewpoints,
    get_water_sources,
)
from ingestors.ridb import get_campsites_search


def _valid_points(waypoints: list[dict]) -> list[dict]:
    return [
        wp for wp in waypoints
        if isinstance(wp.get("lat"), (int, float)) and isinstance(wp.get("lng"), (int, float))
    ]


def _haversine_mi(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 3958.8 * 2 * math.asin(min(1, math.sqrt(h)))


def _point_segment_distance_mi(point: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    """Approximate shortest distance from point to route segment in miles."""
    plat, plng = point
    alat, alng = a
    blat, blng = b
    ref_lat = math.radians((plat + alat + blat) / 3)
    x, y = plng * math.cos(ref_lat), plat
    ax, ay = alng * math.cos(ref_lat), alat
    bx, by = blng * math.cos(ref_lat), blat
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return _haversine_mi(point, a)
    t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    proj = (ay + t * dy, (ax + t * dx) / math.cos(ref_lat))
    return _haversine_mi(point, proj)


def _route_distance_mi(item: dict, route: list[dict]) -> float:
    if len(route) < 2:
        return 0
    point = (float(item["lat"]), float(item["lng"]))
    pairs = zip(route, route[1:])
    return min(
        _point_segment_distance_mi(point, (a["lat"], a["lng"]), (b["lat"], b["lng"]))
        for a, b in pairs
    )


def _nearest_day(item: dict, waypoints: list[dict], types: Iterable[str] | None = None) -> int | None:
    allowed = set(types or [])
    candidates = [
        wp for wp in waypoints
        if wp.get("day") is not None and wp.get("lat") and wp.get("lng")
        and (not allowed or wp.get("type") in allowed)
    ]
    if not candidates:
        return None
    point = (float(item["lat"]), float(item["lng"]))
    nearest = min(candidates, key=lambda wp: _haversine_mi(point, (wp["lat"], wp["lng"])))
    try:
        return int(nearest["day"])
    except Exception:
        return None


def _route_samples(route: list[dict], max_samples: int = 8) -> list[dict]:
    if len(route) <= max_samples:
        return route
    step = (len(route) - 1) / (max_samples - 1)
    return [route[round(i * step)] for i in range(max_samples)]


def _merge_targets(primary: list[dict], fallback: list[dict], max_targets: int) -> list[dict]:
    """Use AI intent anchors plus route samples so one bad geocode doesn't starve enrichment."""
    merged: list[dict] = []
    seen: set[str] = set()
    for wp in [*primary, *fallback]:
        if not wp.get("lat") or not wp.get("lng"):
            continue
        key = f"{float(wp['lat']):.3f}:{float(wp['lng']):.3f}"
        if key in seen:
            continue
        seen.add(key)
        merged.append(wp)
        if len(merged) >= max_targets:
            break
    return merged


def _dedupe(items: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for item in items:
        key = str(item.get("id") or f"{item.get('name')}:{item.get('lat'):.4f}:{item.get('lng'):.4f}")
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def annotate_waypoint_verification(
    waypoints: list[dict],
    campsites: list[dict],
    gas_stations: list[dict],
) -> list[dict]:
    """Mark AI waypoints that are supported by verified route-corridor data."""
    verified_by_type = {
        "camp": campsites,
        "motel": campsites,
        "fuel": gas_stations,
    }
    thresholds = {"camp": 12.0, "motel": 12.0, "fuel": 5.0}
    annotated: list[dict] = []
    for wp in waypoints:
        out = dict(wp)
        wp_type = str(out.get("type") or "")
        items = verified_by_type.get(wp_type)
        if not items or not out.get("lat") or not out.get("lng"):
            annotated.append(out)
            continue
        point = (float(out["lat"]), float(out["lng"]))
        candidates = [
            item for item in items
            if item.get("lat") is not None and item.get("lng") is not None
        ]
        if not candidates:
            annotated.append(out)
            continue
        nearest = min(candidates, key=lambda item: _haversine_mi(point, (float(item["lat"]), float(item["lng"]))))
        dist = _haversine_mi(point, (float(nearest["lat"]), float(nearest["lng"])))
        threshold = thresholds.get(wp_type, 5.0)
        out["verified_match"] = dist <= threshold
        out["verified_distance_mi"] = round(dist, 1)
        out["verified_name"] = nearest.get("name")
        out["verified_source"] = nearest.get("verified_source") or nearest.get("source")
        if dist > threshold:
            out["needs_review"] = True
            out["verification_note"] = f"No verified {wp_type} found within {threshold:g} mi of this AI waypoint."
        annotated.append(out)
    return annotated


async def _route_camps(waypoints: list[dict], route: list[dict]) -> list[dict]:
    camp_targets = [wp for wp in waypoints if wp.get("type") in ("camp", "motel") and wp.get("lat") and wp.get("lng")]
    targets = _merge_targets(camp_targets, _route_samples(route, max_samples=8), max_targets=14)

    async def fetch_for(wp: dict) -> list[dict]:
        ridb, osm = await asyncio.gather(
            get_campsites_search(wp["lat"], wp["lng"], radius_miles=45),
            get_osm_campsites(wp["lat"], wp["lng"], radius_m=72000),
        )
        return [*ridb, *osm]

    batches = await asyncio.gather(*[fetch_for(wp) for wp in targets], return_exceptions=True)
    camps: list[dict] = []
    for batch in batches:
        if isinstance(batch, list):
            camps.extend(batch)

    scored = []
    for camp in _dedupe(camps):
        if not camp.get("lat") or not camp.get("lng"):
            continue
        route_mi = _route_distance_mi(camp, route)
        if route_mi > 35:
            continue
        day = _nearest_day(camp, waypoints, types=("camp", "motel"))
        tags = set(camp.get("tags") or [])
        quality = 0
        if route_mi <= 5:
            quality += 7
        elif route_mi <= 12:
            quality += 4
        if "dispersed" in tags or "blm" in tags or "usfs" in tags:
            quality += 8
        if camp.get("photo_url"):
            quality += 2
        if camp.get("reservable"):
            quality += 1
        camp["route_distance_mi"] = round(route_mi, 1)
        camp["route_fit"] = "on_route" if route_mi <= 3 else "short_detour" if route_mi <= 12 else "detour"
        camp["recommended_day"] = day
        camp["verified_source"] = camp.get("source") or ("ridb" if str(camp.get("id", "")).isdigit() else "osm")
        scored.append((route_mi - quality, camp))
    return [camp for _, camp in sorted(scored, key=lambda row: row[0])[:70]]


async def _route_gas(waypoints: list[dict], route: list[dict]) -> list[dict]:
    fuel_targets = [wp for wp in waypoints if wp.get("type") == "fuel" and wp.get("lat") and wp.get("lng")]
    targets = _merge_targets(fuel_targets, _route_samples(route, max_samples=10), max_targets=16)

    osm_batches = await asyncio.gather(
        *[get_fuel_stations(wp["lat"], wp["lng"], radius_m=24000) for wp in targets],
        return_exceptions=True,
    )
    stations: list[dict] = []
    for batch in osm_batches:
        if isinstance(batch, list):
            stations.extend(batch)
    try:
        stations.extend(await get_gas_along_route(waypoints))
    except Exception:
        pass

    scored = []
    for station in _dedupe(stations):
        if not station.get("lat") or not station.get("lng"):
            continue
        route_mi = _route_distance_mi(station, route)
        if route_mi > 15:
            continue
        station["route_distance_mi"] = round(route_mi, 1)
        station["route_fit"] = "on_route" if route_mi <= 2 else "short_detour"
        station["recommended_day"] = _nearest_day(station, waypoints)
        scored.append((route_mi, station))
    return [station for _, station in sorted(scored, key=lambda row: row[0])[:45]]


async def _route_pois(route: list[dict]) -> list[dict]:
    samples = _route_samples(route, max_samples=6)

    async def fetch_for(wp: dict) -> list[dict]:
        water, trailheads, viewpoints, peaks, hot_springs = await asyncio.gather(
            get_water_sources(wp["lat"], wp["lng"], radius_m=16000),
            get_trailheads(wp["lat"], wp["lng"], radius_m=24000),
            get_viewpoints(wp["lat"], wp["lng"], radius_m=24000),
            get_peaks(wp["lat"], wp["lng"], radius_m=32000),
            get_hot_springs(wp["lat"], wp["lng"], radius_m=48000),
        )
        return [*water, *trailheads, *viewpoints, *peaks, *hot_springs]

    batches = await asyncio.gather(*[fetch_for(wp) for wp in samples], return_exceptions=True)
    pois: list[dict] = []
    for batch in batches:
        if isinstance(batch, list):
            pois.extend(batch)

    scored = []
    for poi in _dedupe(pois):
        if not poi.get("lat") or not poi.get("lng"):
            continue
        raw_route_mi = _route_distance_mi(poi, route)
        if raw_route_mi > 18:
            continue
        route_mi = raw_route_mi
        if (poi.get("name") or "").lower() in ("viewpoint", "trailhead", "water source", "natural spring", "peak"):
            route_mi += 5
        if poi.get("type") == "hot_spring":
            route_mi -= 6
        poi["route_distance_mi"] = round(raw_route_mi, 1)
        poi["route_fit"] = "on_route" if raw_route_mi <= 3 else "short_detour"
        scored.append((route_mi, poi))
    return [poi for _, poi in sorted(scored, key=lambda row: row[0])[:50]]


async def enrich_trip_along_route(waypoints: list[dict]) -> dict:
    route = _valid_points(waypoints)
    if len(route) < 2:
        return {"campsites": [], "gas_stations": [], "route_pois": []}

    camps, gas, pois = await asyncio.gather(
        _route_camps(waypoints, route),
        _route_gas(waypoints, route),
        _route_pois(route),
    )
    return {
        "campsites": camps,
        "gas_stations": gas,
        "route_pois": pois,
        "waypoints": annotate_waypoint_verification(waypoints, camps, gas),
    }
