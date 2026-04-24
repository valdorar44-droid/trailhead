"""Trailhead FastAPI server. All API routes."""
from __future__ import annotations
import asyncio, os, json, uuid, secrets, xml.etree.ElementTree as ET
from pathlib import Path
from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import HTMLResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
import httpx
from passlib.context import CryptContext
from jose import jwt, JWTError

from config.settings import settings
from ai.planner import plan_trip
from ingestors.ridb import get_campsites_near, get_campsites_search, get_facility_detail
from ingestors.nrel import get_gas_along_route
from ingestors.osm import get_osm_campsites, get_water_sources, get_trailheads, get_viewpoints
from db.store import (
    save_trip, get_trip, add_community_pin, get_community_pins,
    save_audio_guide, get_audio_guide, get_cached, set_cached,
    create_user, get_user_by_email, get_user_by_id, get_user_by_referral_code,
    add_credits, get_credit_history,
    create_report, get_reports_near, get_reports_along_route,
    upvote_report, downvote_report, confirm_report,
    get_leaderboard, is_reporter_restricted, check_and_update_streak,
    EXPIRY_BY_TYPE,
    get_platform_stats, get_all_users, set_user_admin, ban_user,
    get_all_reports, expire_report, delete_report,
    get_all_trips, get_all_pins, delete_pin, ensure_admin_user,
)

app = FastAPI(title="Trailhead API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DASH  = Path(__file__).parent / "dashboard.html"
ADMIN = Path(__file__).parent / "admin.html"
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)
ALGORITHM = "HS256"


# ── Admin bootstrap ───────────────────────────────────────────────────────────

@app.on_event("startup")
async def _bootstrap_admin():
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_pass  = os.environ.get("ADMIN_PASSWORD")
    admin_user  = os.environ.get("ADMIN_USERNAME", "admin")
    if admin_email and admin_pass:
        ensure_admin_user(admin_email, admin_user, pwd.hash(admin_pass))


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

def _safe_user(u: dict) -> dict:
    return {k: v for k, v in u.items() if k not in ("password_hash", "photo_data")}

def _require_admin(user: dict = Depends(_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    return user


# ── Core ──────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return DASH.read_text()

@app.get("/admin", response_class=HTMLResponse)
async def admin_page():
    return ADMIN.read_text()

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "trailhead"}

# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str; username: str; password: str; referral_code: str = ""

class LoginRequest(BaseModel):
    email: str; password: str

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
    return {"token": _make_token(uid), "user": _safe_user(get_user_by_id(uid))}

@app.post("/api/auth/login")
async def login(body: LoginRequest):
    user = get_user_by_email(body.email)
    if not user or not pwd.verify(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    return {"token": _make_token(user["id"]), "user": _safe_user(user)}

@app.get("/api/auth/me")
async def me(user: dict = Depends(_current_user)):
    return _safe_user(user)


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
                    seen.add(c["id"]); campsites.append(c)

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

@app.get("/api/trip/{trip_id}/guide")
async def trip_guide(trip_id: str):
    """Return audio guide narrations for trip waypoints (generates + caches on first call)."""
    cached = get_audio_guide(trip_id)
    if cached:
        return cached

    trip = get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    from ai.planner import generate_audio_guide
    waypoints = trip.get("plan", {}).get("waypoints", [])
    trip_name = trip.get("plan", {}).get("trip_name", "Adventure")

    try:
        guide = generate_audio_guide(waypoints, trip_name)
    except Exception as e:
        raise HTTPException(500, f"Guide generation failed: {e}")

    save_audio_guide(trip_id, guide)
    return guide


# ── Weather ───────────────────────────────────────────────────────────────────

@app.get("/api/weather")
async def weather_forecast(lat: float, lng: float, days: int = 7):
    cache_key = f"weather:{lat:.2f},{lng:.2f}"
    cached = get_cached("weather_cache", cache_key, ttl_seconds=3600)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat, "longitude": lng,
                "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,weathercode",
                "temperature_unit": "fahrenheit",
                "windspeed_unit": "mph",
                "precipitation_unit": "inch",
                "timezone": "auto",
                "forecast_days": min(days, 14),
            }
        )
        r.raise_for_status()
        data = r.json()

    set_cached("weather_cache", cache_key, data)
    return data


# ── Audio guide ────────────────────────────────────────────────────────────────

class NearbyAudioRequest(BaseModel):
    lat: float; lng: float; location_name: str = ""

@app.post("/api/audio/nearby")
async def nearby_audio(body: NearbyAudioRequest):
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")
    from ai.planner import generate_location_narration
    try:
        narration = generate_location_narration(body.lat, body.lng, body.location_name)
    except Exception as e:
        raise HTTPException(500, f"Narration failed: {e}")
    return {"narration": narration}


# ── Config (public) ───────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    return {"mapbox_token": settings.mapbox_token}


# ── Campsite / gas ────────────────────────────────────────────────────────────

@app.get("/api/campsites")
async def campsites(lat: float, lng: float, radius: float = 25):
    return await get_campsites_near(lat, lng, radius_miles=radius)

@app.get("/api/campsites/search")
async def campsites_search(lat: float, lng: float, radius: float = 40, types: str = ""):
    type_filters = [t.strip() for t in types.split(",") if t.strip()] if types else None
    return await get_campsites_search(lat, lng, radius_miles=radius, type_filters=type_filters)

@app.get("/api/campsites/{facility_id}/detail")
async def campsite_detail(facility_id: str):
    detail = await get_facility_detail(facility_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Facility not found")
    return detail

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


# ── Reports ───────────────────────────────────────────────────────────────────

class ReportRequest(BaseModel):
    lat: float; lng: float
    type: str
    subtype: str = ""
    description: str = ""
    severity: str = "moderate"
    photo_data: Optional[str] = None  # base64 jpeg

@app.post("/api/reports")
async def submit_report(body: ReportRequest, user: dict = Depends(_current_user)):
    # Check restriction
    restricted, secs = is_reporter_restricted(user["id"])
    if restricted:
        hours = round(secs / 3600, 1)
        raise HTTPException(403, f"Reporting restricted for {hours} more hours due to inaccurate reports.")

    report_id = create_report(user["id"], body.lat, body.lng, body.type,
                              body.subtype, body.description, body.severity,
                              photo_data=body.photo_data)

    # Base credits: 10, double for photo
    credits_earned = 20 if body.photo_data else 10
    add_credits(user["id"], credits_earned,
                f"{'Photo ' if body.photo_data else ''}Report: {body.type}")

    # Streak check + bonus
    streak_info = check_and_update_streak(user["id"])

    fresh_user = get_user_by_id(user["id"])
    return {
        "status": "ok",
        "report_id": report_id,
        "credits_earned": credits_earned + streak_info["bonus"],
        "new_balance": fresh_user["credits"],
        "streak": streak_info["streak"],
        "streak_bonus": streak_info["bonus"],
        "streak_reason": streak_info["reason"],
        "ttl_hours": round(EXPIRY_BY_TYPE.get(body.type, 7 * 86400) / 3600, 1),
    }

@app.get("/api/reports")
async def nearby_reports(lat: float, lng: float, radius: float = 0.5):
    return get_reports_near(lat, lng, radius_deg=radius)

class RouteReportRequest(BaseModel):
    waypoints: list[dict]

@app.post("/api/reports/along-route")
async def route_reports(body: RouteReportRequest):
    """Return active reports within ~10km of any route waypoint."""
    return get_reports_along_route(body.waypoints, radius_deg=0.12)

@app.post("/api/reports/{report_id}/upvote")
async def upvote(report_id: int):
    upvote_report(report_id)
    return {"status": "ok"}

@app.post("/api/reports/{report_id}/downvote")
async def downvote(report_id: int):
    downvote_report(report_id)
    return {"status": "ok"}

@app.post("/api/reports/{report_id}/confirm")
async def confirm(report_id: int, user: dict = Depends(_current_user)):
    """'Still there' — resets expiry, +1 credit to confirmer."""
    ok = confirm_report(report_id, user["id"])
    if not ok:
        raise HTTPException(404, "Report not found")
    fresh = get_user_by_id(user["id"])
    return {"status": "ok", "credits_earned": 1, "new_balance": fresh["credits"]}

@app.get("/api/reports/{report_id}/photo")
async def report_photo(report_id: int):
    from db.store import _conn
    db = _conn()
    row = db.execute("SELECT photo_data FROM reports WHERE id=?", (report_id,)).fetchone()
    db.close()
    if not row or not row["photo_data"]:
        raise HTTPException(404, "No photo")
    import base64
    data = base64.b64decode(row["photo_data"])
    return Response(content=data, media_type="image/jpeg")


# ── Credits ───────────────────────────────────────────────────────────────────

@app.get("/api/credits")
async def credits_route(user: dict = Depends(_current_user)):
    return {"balance": user["credits"], "history": get_credit_history(user["id"])}


# ── Leaderboard ───────────────────────────────────────────────────────────────

@app.get("/api/leaderboard")
async def leaderboard():
    return get_leaderboard(limit=20)


# ── GPX export ────────────────────────────────────────────────────────────────

class GpxRequest(BaseModel):
    trip_name: str; waypoints: list[dict]

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

# ── Admin API ─────────────────────────────────────────────────────────────────

@app.get("/api/admin/stats")
async def admin_stats(admin: dict = Depends(_require_admin)):
    return get_platform_stats()

@app.get("/api/admin/users")
async def admin_users(search: str = "", limit: int = 50, offset: int = 0,
                      admin: dict = Depends(_require_admin)):
    return get_all_users(search, limit, offset)

class AdminCreditBody(BaseModel):
    amount: int; reason: str = "Admin adjustment"

@app.post("/api/admin/users/{user_id}/credits")
async def admin_adjust_credits(user_id: int, body: AdminCreditBody,
                               admin: dict = Depends(_require_admin)):
    add_credits(user_id, body.amount, f"{body.reason} (by admin {admin['username']})")
    return {"ok": True, "new_balance": get_user_by_id(user_id)["credits"]}

@app.post("/api/admin/users/{user_id}/admin")
async def admin_toggle_admin(user_id: int, admin: dict = Depends(_require_admin)):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    new_state = not bool(user.get("is_admin"))
    set_user_admin(user_id, new_state)
    return {"ok": True, "is_admin": new_state}

@app.post("/api/admin/users/{user_id}/ban")
async def admin_ban_user(user_id: int, admin: dict = Depends(_require_admin)):
    ban_user(user_id, days=365)
    return {"ok": True}

@app.get("/api/admin/reports")
async def admin_reports(include_expired: bool = False,
                        admin: dict = Depends(_require_admin)):
    return get_all_reports(limit=200, include_expired=include_expired)

@app.post("/api/admin/reports/{report_id}/expire")
async def admin_expire_report(report_id: int, admin: dict = Depends(_require_admin)):
    expire_report(report_id)
    return {"ok": True}

@app.delete("/api/admin/reports/{report_id}")
async def admin_delete_report(report_id: int, admin: dict = Depends(_require_admin)):
    delete_report(report_id)
    return {"ok": True}

@app.get("/api/admin/trips")
async def admin_trips(admin: dict = Depends(_require_admin)):
    return get_all_trips(limit=100)

@app.get("/api/admin/pins")
async def admin_pins(admin: dict = Depends(_require_admin)):
    return get_all_pins(limit=200)

@app.delete("/api/admin/pins/{pin_id}")
async def admin_delete_pin(pin_id: int, admin: dict = Depends(_require_admin)):
    delete_pin(pin_id)
    return {"ok": True}


# ── Nearby camps (RIDB + OSM aggregated — Dyrt-style discovery) ──────────────

@app.get("/api/nearby-camps")
async def nearby_camps(lat: float, lng: float, radius: float = 50, types: str = ""):
    """Aggregate RIDB + OSM campsites near a point, no trip required."""
    type_filters = [t.strip() for t in types.split(",") if t.strip()] if types else None
    ridb, osm = await asyncio.gather(
        get_campsites_search(lat, lng, radius_miles=radius, type_filters=type_filters),
        get_osm_campsites(lat, lng, radius_m=int(min(radius, 60) * 1600)),
    )
    seen, merged = set(), []
    for s in ridb:
        if s["id"] not in seen:
            seen.add(s["id"]); merged.append(s)
    for s in osm:
        if s["id"] not in seen:
            if not type_filters or any(t in s.get("tags", []) for t in type_filters):
                seen.add(s["id"]); merged.append(s)
    return merged[:120]


@app.get("/api/camps/bbox")
async def camps_bbox(n: float, s: float, e: float, w: float, types: str = ""):
    """Viewport-based camp loading — returns all camps in a bounding box."""
    lat = (n + s) / 2
    lng = (e + w) / 2
    # Rough radius: half the larger of NS or EW span in miles
    lat_span_mi = abs(n - s) * 69.0
    lng_span_mi = abs(e - w) * 54.6  # ~54.6 mi per degree lng at 38° N
    radius_miles = min(max(lat_span_mi, lng_span_mi) / 2 + 5, 120)
    radius_m = int(radius_miles * 1600)
    type_filters = [t.strip() for t in types.split(",") if t.strip()] if types else None
    ridb, osm = await asyncio.gather(
        get_campsites_search(lat, lng, radius_miles=radius_miles, type_filters=type_filters),
        get_osm_campsites(lat, lng, radius_m=min(radius_m, 120000)),
    )
    seen, merged = set(), []
    for c in ridb:
        if c["id"] not in seen and s <= c["lat"] <= n and w <= c["lng"] <= e:
            seen.add(c["id"]); merged.append(c)
    for c in osm:
        if c["id"] not in seen and s <= c["lat"] <= n and w <= c["lng"] <= e:
            if not type_filters or any(t in c.get("tags", []) for t in type_filters):
                seen.add(c["id"]); merged.append(c)
    return merged[:150]


# ── OSM POIs (water, trailheads, viewpoints) ──────────────────────────────────

@app.get("/api/osm-pois")
async def osm_pois(lat: float, lng: float, radius: float = 30, types: str = "water,trailhead,viewpoint"):
    type_set = {t.strip() for t in types.split(",") if t.strip()}
    tasks = []
    if "water" in type_set:
        tasks.append(get_water_sources(lat, lng, radius_m=int(radius * 1600)))
    if "trailhead" in type_set:
        tasks.append(get_trailheads(lat, lng, radius_m=int(radius * 1600)))
    if "viewpoint" in type_set:
        tasks.append(get_viewpoints(lat, lng, radius_m=int(radius * 1600)))
    if not tasks:
        return []
    results = await asyncio.gather(*tasks)
    return [item for sublist in results for item in sublist][:60]


# ── Wikipedia nearby ──────────────────────────────────────────────────────────

@app.get("/api/wikipedia-nearby")
async def wikipedia_nearby(lat: float, lng: float, radius: int = 10000, limit: int = 8):
    key = f"wiki_{lat:.2f}_{lng:.2f}_{radius}"
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 48)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query", "list": "geosearch",
                    "gscoord": f"{lat}|{lng}", "gsradius": radius,
                    "gslimit": limit, "format": "json", "gsprop": "type|name",
                },
                headers={"User-Agent": "Trailhead/1.0"},
            )
            r.raise_for_status()
            hits = r.json().get("query", {}).get("geosearch", [])
            # Enrich with extracts
            if hits:
                page_ids = "|".join(str(h["pageid"]) for h in hits)
                r2 = await client.get(
                    "https://en.wikipedia.org/w/api.php",
                    params={
                        "action": "query", "pageids": page_ids,
                        "prop": "extracts|info", "exintro": True,
                        "exsentences": 2, "explaintext": True,
                        "inprop": "url", "format": "json",
                    },
                    headers={"User-Agent": "Trailhead/1.0"},
                )
                r2.raise_for_status()
                pages = r2.json().get("query", {}).get("pages", {})
                enriched = []
                for h in hits:
                    p = pages.get(str(h["pageid"]), {})
                    enriched.append({
                        "title": h["title"],
                        "lat": h["lat"], "lng": h["lon"],
                        "dist_m": h.get("dist", 0),
                        "extract": p.get("extract", "")[:300],
                        "url": p.get("fullurl", f"https://en.wikipedia.org/?curid={h['pageid']}"),
                    })
                set_cached("campsite_cache", key, enriched)
                return enriched
    except Exception:
        pass
    return []


# ── AI campsite insight ───────────────────────────────────────────────────────

class CampsiteInsightRequest(BaseModel):
    name: str; lat: float; lng: float
    description: str = ""; land_type: str = ""; amenities: list[str] = []

@app.post("/api/ai/campsite-insight")
async def campsite_insight(body: CampsiteInsightRequest):
    """Generate AI-enriched campsite description with nearby context."""
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    cache_key = f"ai_insight_{body.lat:.3f}_{body.lng:.3f}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 72)
    if cached:
        return cached

    # Fetch Wikipedia and weather context in parallel
    wiki_task = wikipedia_nearby(body.lat, body.lng, radius=15000, limit=4)
    weather_task = weather_forecast(body.lat, body.lng, days=3)
    wiki_hits, weather_data = await asyncio.gather(wiki_task, weather_task)

    wiki_ctx = "\n".join(f"- {h['title']}: {h['extract'][:150]}" for h in wiki_hits[:3])
    daily = weather_data.get("daily", {})
    temps = daily.get("temperature_2m_max", [])
    weather_ctx = f"Highs: {temps[0]:.0f}°F" if temps else ""

    from ai.planner import generate_campsite_insight
    try:
        result = generate_campsite_insight(
            name=body.name, lat=body.lat, lng=body.lng,
            description=body.description, land_type=body.land_type,
            amenities=body.amenities, wiki_context=wiki_ctx, weather_context=weather_ctx,
        )
    except Exception as e:
        raise HTTPException(500, str(e))

    set_cached("campsite_cache", cache_key, result)
    return result


# ── AI route briefing ─────────────────────────────────────────────────────────

class RouteBriefRequest(BaseModel):
    trip_name: str; waypoints: list[dict]; reports: list[dict] = []

@app.post("/api/ai/route-brief")
async def route_brief(body: RouteBriefRequest):
    """AI safety and readiness briefing for an active trip."""
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")
    from ai.planner import generate_route_brief
    try:
        return generate_route_brief(body.trip_name, body.waypoints, body.reports)
    except Exception as e:
        raise HTTPException(500, str(e))


# ── AI packing list ───────────────────────────────────────────────────────────

class PackingRequest(BaseModel):
    trip_name: str; duration_days: int; road_types: list[str] = []
    land_types: list[str] = []; states: list[str] = []

@app.post("/api/ai/packing-list")
async def packing_list(body: PackingRequest):
    """Generate a smart packing list based on trip parameters."""
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")
    from ai.planner import generate_packing_list
    try:
        return generate_packing_list(body.trip_name, body.duration_days,
                                     body.road_types, body.land_types, body.states)
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Geocoding ─────────────────────────────────────────────────────────────────

async def _geocode_waypoints(waypoints: list[dict]) -> list[dict]:
    import asyncio
    result = []
    headers = {"User-Agent": "Trailhead/1.0 (valdorar44@gmail.com)"}
    async with httpx.AsyncClient(timeout=10, headers=headers) as client:
        for wp in waypoints:
            name = wp.get("name", "")
            if not name:
                result.append(wp); continue
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
