"""RIDB (Recreation.gov) campsite ingestor.
Fetches federal campsites near a lat/lng. Free API — register at ridb.recreation.gov.
"""
from __future__ import annotations
import httpx
from config.settings import settings
from db.store import get_cached, set_cached

RIDB_BASE = "https://ridb.recreation.gov/api/v1"

def _cache_key(lat: float, lng: float, radius: float) -> str:
    return f"ridb_{lat:.2f}_{lng:.2f}_{radius}"

async def get_campsites_near(lat: float, lng: float, radius_miles: float = 30) -> list[dict]:
    key = _cache_key(lat, lng, radius_miles)
    cached = get_cached("campsite_cache", key, ttl_seconds=86400)
    if cached is not None:
        return cached

    headers = {"apikey": settings.ridb_api_key} if settings.ridb_api_key else {}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{RIDB_BASE}/facilities",
                params={
                    "latitude": lat,
                    "longitude": lng,
                    "radius": radius_miles,
                    "activity": "CAMPING",
                    "limit": 20,
                    "offset": 0,
                },
                headers=headers
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return []

    sites = []
    for facility in data.get("RECDATA", []):
        lat_f = facility.get("FacilityLatitude")
        lng_f = facility.get("FacilityLongitude")
        if not lat_f or not lng_f:
            continue
        sites.append({
            "id": facility.get("FacilityID"),
            "name": facility.get("FacilityName", "Unknown Campsite"),
            "lat": float(lat_f),
            "lng": float(lng_f),
            "type": "federal_camp",
            "description": facility.get("FacilityDescription", "")[:200],
            "reservable": facility.get("Reservable", False),
            "url": f"https://www.recreation.gov/camping/campgrounds/{facility.get('FacilityID')}",
        })

    set_cached("campsite_cache", key, sites)
    return sites
