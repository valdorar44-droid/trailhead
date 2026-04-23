"""Trailhead FastAPI server. All API routes."""
from __future__ import annotations
import os, json, uuid, secrets, xml.etree.ElementTree as ET
from pathlib import Path
from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import HTMLResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import httpx
from passlib.context import CryptContext
from jose import jwt, JWTError

from config.settings import settings
from ai.planner import plan_trip
from ingestors.ridb import get_campsites_near
from ingestors.nrel import get_gas_along_route
from db.store import (
    save_trip, get_trip, add_community_pin, get_community_pins,
    create_user, get_user_by_email, get_user_by_id, get_user_by_referral_code,
    add_credits, get_credit_history,
    create_report, get_reports_near, upvote_report,
)

app = FastAPI(title="Trailhead API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DASH = Path(__file__).parent / "dashboard.html"
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)
ALGORITHM = "HS256"


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _make_token(user_id: int) -> str:
    return jwt.encode({"sub": str(user_id)}, settings.secret_key, algorithm=ALGORITHM)

def _decode_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None

def _current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Authentication required")
    uid = _decode_token(creds.credentials)
    if not uid:
        raise HTTPException(401, "Invalid token")
    user = get_user_by_id(uid)
    if not user:
        raise HTTPException(401, "User not found")
    return user

def _optional_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict | None:
    if not creds:
        return None
    uid = _decode_token(creds.credentials)
    return get_user_by_id(uid) if uid else None


# ── Core ──────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return DASH.read_text()

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "trailhead"}

@app.get("/api/config")
async def config():
    return {"status": "ok"}


# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    username: str
    password: str
    referral_code: str = ""

class LoginRequest(BaseModel):
    email: str
    password: str

@app.post("/api/auth/register")
async def register(body: RegisterRequest):
    if get_user_by_email(body.email):
        raise HTTPException(400, "Email already registered")
    referrer = get_user_by_referral_code(body.referral_code) if body.referral_code else None
    code = f"{body.username.lower()}-{secrets.token_hex(3)}"
    uid = create_user(body.email, body.username, pwd.hash(body.password), code,
                      referred_by=referrer["id"] if referrer else None)
    if referrer:
        add_credits(referrer["id"], 50, f"Referral — {body.username} signed up!")
    user = get_user_by_id(uid)
    return {"token": _make_token(uid), "user": _safe_user(user)}

@app.post("/api/auth/login")
async def login(body: LoginRequest):
    user = get_user_by_email(body.email)
    if not user or not pwd.verify(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    return {"token": _make_token(user["id"]), "user": _safe_user(user)}

@app.get("/api/auth/me")
async def me(user: dict = Depends(_current_user)):
    return _safe_user(user)

def _safe_user(u: dict) -> dict:
    return {k: v for k, v in u.items() if k not in ("password_hash",)}


# ── Trip planning ─────────────────────────────────────────────────────────────

class PlanRequest(BaseModel):
    request: str

@app.post("/api/plan")
async def plan(body: PlanRequest, user: dict | None = Depends(_optional_user)):
    if not body.request.strip():
        raise HTTPException(400, "Request cannot be empty")
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    try:
        plan_data = plan_trip(body.request)
    except Exception as e:
        raise HTTPException(500, f"AI planning failed: {e}")

    geocoded = await _geocode_waypoints(plan_data.get("waypoints", []))
    plan_data["waypoints"] = geocoded

    campsites, seen = [], set()
    for wp in geocoded:
        if wp.get("lat") and wp.get("lng"):
            for c in await get_campsites_near(wp["lat"], wp["lng"], radius_miles=25):
                if c["id"] not in seen:
                    seen.add(c["id"])
                    campsites.append(c)

    gas_stations = await get_gas_along_route(geocoded)
    trip_id = str(uuid.uuid4())[:8]
    result = {"trip_id": trip_id, "plan": plan_data,
              "campsites": campsites[:40], "gas_stations": gas_stations[:30]}
    save_trip(trip_id, body.request, result, user_id=user["id"] if user else None)

    if user:
        add_credits(user["id"], 25, f"Trip planned: {plan_data.get('trip_name', 'Adventure')}")

    return result

@app.get("/api/trip/{trip_id}")
async def get_trip_route(trip_id: str):
    trip = get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    return trip


# ── Campsite / gas ────────────────────────────────────────────────────────────

@app.get("/api/campsites")
async def campsites(lat: float, lng: float, radius: float = 25):
    return await get_campsites_near(lat, lng, radius_miles=radius)

@app.get("/api/gas")
async def gas(lat: float, lng: float, radius: float = 25):
    from ingestors.nrel import get_fuel_near
    return await get_fuel_near(lat, lng, radius_miles=radius)


# ── Community pins ─────────────────────────────────────────────────────────────

class PinRequest(BaseModel):
    lat: float; lng: float; name: str
    type: str = "camp"; description: str = ""; land_type: str = "BLM"

@app.post("/api/pins")
async def submit_pin(body: PinRequest, user: dict | None = Depends(_optional_user)):
    add_community_pin(body.lat, body.lng, body.name, body.type,
                      body.description, body.land_type,
                      user_id=user["id"] if user else None)
    if user:
        add_credits(user["id"], 15, f"New campsite pin: {body.name}")
    return {"status": "ok"}

@app.get("/api/pins")
async def nearby_pins(lat: float, lng: float, radius: float = 1.0):
    return get_community_pins(lat, lng, radius_deg=radius)


# ── Reports (Waze-style) ──────────────────────────────────────────────────────

class ReportRequest(BaseModel):
    lat: float; lng: float
    type: str          # road_condition | campsite | hazard | closure | water | cell_signal
    subtype: str = ""  # e.g. "washed_out", "occupied", "downed_tree"
    description: str = ""
    severity: str = "moderate"  # low | moderate | high | critical

@app.post("/api/reports")
async def submit_report(body: ReportRequest, user: dict = Depends(_current_user)):
    report_id = create_report(user["id"], body.lat, body.lng, body.type,
                              body.subtype, body.description, body.severity)
    add_credits(user["id"], 10, f"Report submitted: {body.type}")
    return {"status": "ok", "report_id": report_id, "credits_earned": 10,
            "new_balance": get_user_by_id(user["id"])["credits"]}

@app.get("/api/reports")
async def nearby_reports(lat: float, lng: float, radius: float = 0.5):
    return get_reports_near(lat, lng, radius_deg=radius)

@app.post("/api/reports/{report_id}/upvote")
async def upvote(report_id: int):
    upvote_report(report_id)
    return {"status": "ok"}

@app.post("/api/reports/{report_id}/downvote")
async def downvote(report_id: int):
    from db.store import downvote_report
    downvote_report(report_id)
    return {"status": "ok"}


# ── Credits ───────────────────────────────────────────────────────────────────

@app.get("/api/credits")
async def credits(user: dict = Depends(_current_user)):
    return {"balance": user["credits"], "history": get_credit_history(user["id"])}


# ── GPX export ────────────────────────────────────────────────────────────────

class GpxRequest(BaseModel):
    trip_name: str
    waypoints: list[dict]

@app.post("/api/export/gpx")
async def export_gpx(body: GpxRequest):
    root = ET.Element("gpx", version="1.1", creator="Trailhead")
    ET.SubElement(ET.SubElement(root, "metadata"), "name").text = body.trip_name
    rte = ET.SubElement(root, "rte")
    ET.SubElement(rte, "name").text = body.trip_name
    for wp in body.waypoints:
        lat, lng = wp.get("lat"), wp.get("lng")
        if not lat or not lng:
            continue
        wpt = ET.SubElement(root, "wpt", lat=str(lat), lon=str(lng))
        ET.SubElement(wpt, "name").text = wp.get("name", "Waypoint")
        ET.SubElement(wpt, "desc").text = wp.get("description", "")
        rtept = ET.SubElement(rte, "rtept", lat=str(lat), lon=str(lng))
        ET.SubElement(rtept, "name").text = wp.get("name", "Waypoint")
    gpx_str = ET.tostring(root, encoding="unicode", xml_declaration=True)
    return Response(content=gpx_str, media_type="application/gpx+xml",
                    headers={"Content-Disposition": 'attachment; filename="trailhead-trip.gpx"'})


# ── Geocoding ─────────────────────────────────────────────────────────────────

async def _geocode_waypoints(waypoints: list[dict]) -> list[dict]:
    import asyncio
    result = []
    headers = {"User-Agent": "Trailhead/1.0 (valdorar44@gmail.com)"}
    async with httpx.AsyncClient(timeout=10, headers=headers) as client:
        for wp in waypoints:
            name = wp.get("name", "")
            if not name:
                result.append(wp)
                continue
            try:
                resp = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": name, "format": "json", "limit": 1, "countrycodes": "us"},
                )
                resp.raise_for_status()
                hits = resp.json()
                if hits:
                    wp["lat"] = float(hits[0]["lat"])
                    wp["lng"] = float(hits[0]["lon"])
                    wp["geocoded_name"] = hits[0].get("display_name", name)
            except Exception:
                pass
            result.append(wp)
            await asyncio.sleep(1.1)
    return result
