"""Trailhead FastAPI server. All API routes."""
from __future__ import annotations
import os, json, uuid, xml.etree.ElementTree as ET
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

from config.settings import settings
from ai.planner import plan_trip
from ingestors.ridb import get_campsites_near
from ingestors.nrel import get_gas_along_route
from db.store import save_trip, get_trip, add_community_pin, get_community_pins

app = FastAPI(title="Trailhead API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DASH = Path(__file__).parent / "dashboard.html"


# ── Core routes ──────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return DASH.read_text()

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "trailhead"}

@app.get("/api/config")
async def config():
    return {
        "mapbox_token": settings.mapbox_token,
    }


# ── Trip planning ─────────────────────────────────────────────────────────────

class PlanRequest(BaseModel):
    request: str

@app.post("/api/plan")
async def plan(body: PlanRequest):
    if not body.request.strip():
        raise HTTPException(400, "Request cannot be empty")
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")
    if not settings.mapbox_token:
        raise HTTPException(500, "MAPBOX_TOKEN not configured")

    # Get AI plan
    try:
        plan_data = plan_trip(body.request)
    except Exception as e:
        raise HTTPException(500, f"AI planning failed: {e}")

    # Geocode waypoints
    geocoded = await _geocode_waypoints(plan_data.get("waypoints", []))
    plan_data["waypoints"] = geocoded

    # Fetch campsites near each waypoint
    campsites = []
    seen_camp_ids = set()
    for wp in geocoded:
        if wp.get("lat") and wp.get("lng"):
            nearby = await get_campsites_near(wp["lat"], wp["lng"], radius_miles=25)
            for c in nearby:
                if c["id"] not in seen_camp_ids:
                    seen_camp_ids.add(c["id"])
                    campsites.append(c)

    # Fetch gas stations along route
    gas_stations = await get_gas_along_route(geocoded)

    trip_id = str(uuid.uuid4())[:8]
    result = {
        "trip_id": trip_id,
        "plan": plan_data,
        "campsites": campsites[:40],
        "gas_stations": gas_stations[:30],
    }
    save_trip(trip_id, body.request, result)
    return result

@app.get("/api/trip/{trip_id}")
async def get_trip_route(trip_id: str):
    trip = get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    return trip


# ── Campsite / gas spot queries ───────────────────────────────────────────────

@app.get("/api/campsites")
async def campsites(lat: float, lng: float, radius: float = 25):
    return await get_campsites_near(lat, lng, radius_miles=radius)

@app.get("/api/gas")
async def gas(lat: float, lng: float, radius: float = 25):
    from ingestors.nrel import get_fuel_near
    return await get_fuel_near(lat, lng, radius_miles=radius)


# ── Community pins ────────────────────────────────────────────────────────────

class PinRequest(BaseModel):
    lat: float
    lng: float
    name: str
    type: str = "camp"
    description: str = ""
    land_type: str = "BLM"

@app.post("/api/pins")
async def submit_pin(body: PinRequest):
    add_community_pin(body.lat, body.lng, body.name, body.type, body.description, body.land_type)
    return {"status": "ok"}

@app.get("/api/pins")
async def nearby_pins(lat: float, lng: float, radius: float = 1.0):
    return get_community_pins(lat, lng, radius_deg=radius)


# ── GPX export ────────────────────────────────────────────────────────────────

class GpxRequest(BaseModel):
    trip_name: str
    waypoints: list[dict]

@app.post("/api/export/gpx")
async def export_gpx(body: GpxRequest):
    root = ET.Element("gpx", version="1.1", creator="Trailhead")
    meta = ET.SubElement(root, "metadata")
    ET.SubElement(meta, "name").text = body.trip_name

    rte = ET.SubElement(root, "rte")
    ET.SubElement(rte, "name").text = body.trip_name

    for wp in body.waypoints:
        lat = wp.get("lat")
        lng = wp.get("lng")
        if not lat or not lng:
            continue
        wpt = ET.SubElement(root, "wpt", lat=str(lat), lon=str(lng))
        ET.SubElement(wpt, "name").text = wp.get("name", "Waypoint")
        ET.SubElement(wpt, "desc").text = wp.get("description", "")

        rtept = ET.SubElement(rte, "rtept", lat=str(lat), lon=str(lng))
        ET.SubElement(rtept, "name").text = wp.get("name", "Waypoint")

    gpx_str = ET.tostring(root, encoding="unicode", xml_declaration=True)
    return Response(
        content=gpx_str,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": f'attachment; filename="trailhead-trip.gpx"'}
    )


# ── Geocoding proxy ───────────────────────────────────────────────────────────

async def _geocode_waypoints(waypoints: list[dict]) -> list[dict]:
    """Geocode named waypoints using Mapbox. Adds lat/lng to each."""
    result = []
    async with httpx.AsyncClient(timeout=10) as client:
        for wp in waypoints:
            name = wp.get("name", "")
            if not name:
                result.append(wp)
                continue
            try:
                encoded = name.replace(" ", "%20")
                resp = await client.get(
                    f"https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json",
                    params={
                        "access_token": settings.mapbox_token,
                        "country": "us",
                        "limit": 1,
                        "types": "place,locality,neighborhood,poi,address",
                    }
                )
                resp.raise_for_status()
                features = resp.json().get("features", [])
                if features:
                    lng, lat = features[0]["center"]
                    wp["lat"] = lat
                    wp["lng"] = lng
                    wp["geocoded_name"] = features[0].get("place_name", name)
            except Exception:
                pass
            result.append(wp)
    return result
