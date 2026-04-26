"""NREL Alternative Fuel Station ingestor.
Fetches gas + propane stations near a lat/lng. Free API — register at developer.nrel.gov.
Use DEMO_KEY for development (rate limited).
"""
from __future__ import annotations
import httpx
from config.settings import settings
from db.store import get_cached, set_cached

NREL_BASE = "https://developer.nrel.gov/api/alt-fuel-stations/v1.json"

def _cache_key(lat: float, lng: float, radius: float) -> str:
    return f"nrel_{lat:.2f}_{lng:.2f}_{radius}"

async def get_fuel_near(lat: float, lng: float, radius_miles: float = 25) -> list[dict]:
    key = _cache_key(lat, lng, radius_miles)
    cached = get_cached("gas_cache", key, ttl_seconds=86400 * 7)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                NREL_BASE,
                params={
                    "api_key": settings.nrel_api_key,
                    "latitude": lat,
                    "longitude": lng,
                    "radius": radius_miles,
                    "fuel_type": "LPG,ELEC,E85,CNG",
                    "status": "E",  # open stations only
                    "limit": 10,
                }
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return []

    stations = []
    for s in data.get("fuel_stations", []):
        stations.append({
            "id": s.get("id"),
            "name": s.get("station_name", "Fuel Station"),
            "lat": float(s.get("latitude", 0)),
            "lng": float(s.get("longitude", 0)),
            "type": "fuel",
            "fuel_types": s.get("fuel_type_code", ""),
            "address": f"{s.get('street_address', '')}, {s.get('city', '')}, {s.get('state', '')}",
            "phone": s.get("station_phone", ""),
        })

    set_cached("gas_cache", key, stations)
    return stations


async def get_gas_along_route(waypoints: list[dict]) -> list[dict]:
    """Fetch alternative fuel stations near fuel-type waypoints only.
    Querying near every waypoint scatters pins far off route — fuel stops
    are the only waypoints where an off-route fuel station is actually useful."""
    seen = set()
    all_stations = []
    fuel_wps = [wp for wp in waypoints if wp.get("type") == "fuel"]
    # Fall back to all waypoints if Claude generated no explicit fuel stops
    targets = fuel_wps if fuel_wps else waypoints[:5]
    for wp in targets:
        lat = wp.get("lat")
        lng = wp.get("lng")
        if not lat or not lng:
            continue
        stations = await get_fuel_near(lat, lng, radius_miles=15)
        for s in stations:
            sid = s["id"]
            if sid not in seen:
                seen.add(sid)
                all_stations.append(s)
    return all_stations
