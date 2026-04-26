"""Trailhead FastAPI server. All API routes."""
from __future__ import annotations
import asyncio, os, json, uuid, secrets, xml.etree.ElementTree as ET, time
from pathlib import Path
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
import httpx
import bcrypt as _bcrypt_lib
from jose import jwt, JWTError

from config.settings import settings
from ai.planner import plan_trip, chat_guide, edit_trip, plan_trip_from_conversation
from ingestors.ridb import get_campsites_near, get_campsites_search, get_facility_detail
from ingestors.nrel import get_gas_along_route
from ingestors.osm import get_osm_campsites, get_water_sources, get_trailheads, get_viewpoints, get_peaks
from db.store import (
    save_trip, get_trip, add_community_pin, get_community_pins,
    save_audio_guide, get_audio_guide, get_cached, set_cached,
    create_user, get_user_by_email, get_user_by_id, get_user_by_referral_code,
    add_credits, deduct_credits, get_credit_history,
    get_user_report_count_today, get_report_credits_today,
    is_stripe_session_fulfilled, fulfill_stripe_purchase,
    create_report, get_reports_near, get_reports_along_route,
    upvote_report, downvote_report, confirm_report,
    get_leaderboard, is_reporter_restricted, check_and_update_streak,
    EXPIRY_BY_TYPE,
    get_platform_stats, get_all_users, set_user_admin, ban_user,
    get_all_reports, expire_report, delete_report,
    get_all_trips, get_all_pins, delete_pin, ensure_admin_user,
    submit_bug_report, get_all_bug_reports, award_bug_credits, dismiss_bug_report,
    get_trail_dna, save_trail_dna, get_conversation, save_conversation, clear_conversation,
    report_camp_full, confirm_camp_full, dispute_camp_full, get_camp_fullness, get_fullness_nearby,
    log_event, cleanup_stale_data,
    get_camp_brief, set_camp_brief, has_active_plan, activate_plan, use_free_camp_search,
)

# ── Credit economy ─────────────────────────────────────────────────────────────

AI_COSTS = {
    "chat":             3,
    "chat_edit":        10,  # Sonnet + full trip JSON context ≈ same cost as a new plan
    "campsite_insight": 5,
    "route_brief":      8,
    "packing_list":     5,
    "audio_guide":      8,
    "nearby_audio":     3,
}

# Soft daily caps for plan subscribers (unlimited plan, but abuse protection)
PLAN_DAILY_TRIPS    = 15   # trip plans per day
PLAN_DAILY_EDITS    = 20   # trip edits per day
PLAN_DAILY_AUDIO    = 10   # audio guides per day

CREDIT_PACKAGES = {
    "starter":    {"credits": 100,  "price_cents": 299,  "label": "Starter",    "popular": False},
    "explorer":   {"credits": 350,  "price_cents": 799,  "label": "Explorer",   "popular": True},
    "overlander": {"credits": 1000, "price_cents": 1799, "label": "Overlander", "popular": False},
    "trailhead":  {"credits": 3000, "price_cents": 3999, "label": "Trailhead+", "popular": False},
}

SIGNUP_BONUS       = 50
DAILY_REPORT_LIMIT = 8     # max reports per user per day
DAILY_REPORT_CREDITS_CAP = 50   # max credits/day from reports
REPORT_CREDIT_BASE = 5     # credits for a plain report
REPORT_CREDIT_PHOTO = 10   # credits for a report with photo


# ── Anonymous rate limiter ─────────────────────────────────────────────────────
# Keyed by IP. Buckets reset after ANON_WINDOW_S seconds.
# Authenticated users bypass this entirely — credits are their limit.
_ANON_WINDOW_S = 604_800   # 7-day rolling window
_ANON_LIMITS   = {"chat": 15, "plan": 1, "insight": 1, "search": 1}  # per window
_anon_buckets: dict[str, dict] = {}

def _client_ip(request: Request) -> str:
    """Return the real client IP, honoring X-Forwarded-For on Railway/proxies."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host

def _anon_check(ip: str, kind: str) -> None:
    """Raise 429 if the anonymous IP has hit its 7-day limit for `kind`."""
    now = time.time()
    b = _anon_buckets.get(ip)
    if not b or now - b["t"] > _ANON_WINDOW_S:
        _anon_buckets[ip] = {"t": now, **{k: 0 for k in _ANON_LIMITS}}
        b = _anon_buckets[ip]
    limit = _ANON_LIMITS[kind]
    if b[kind] >= limit:
        reset_days = max(1, int((_ANON_WINDOW_S - (now - b["t"])) / 86_400))
        raise HTTPException(429, f"Free limit reached ({limit} {kind}/week). "
                                 f"Sign up on mobile for unlimited access. "
                                 f"Resets in ~{reset_days}d.")
    b[kind] += 1
    # Prune stale IPs periodically to avoid unbounded growth
    if len(_anon_buckets) > 10_000:
        cutoff = now - _ANON_WINDOW_S
        stale = [k for k, v in _anon_buckets.items() if v["t"] < cutoff]
        for k in stale:
            del _anon_buckets[k]


def _plan_credit_cost(days: int) -> int:
    if days <= 3:  return 15
    if days <= 7:  return 25
    if days <= 14: return 40
    return 60


def _require_ai(user: dict = Depends(None)) -> dict:
    """Placeholder — replaced at endpoint level via lambda."""
    return user

app = FastAPI(title="Trailhead API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DASH    = Path(__file__).parent / "dashboard.html"
LANDING = Path(__file__).parent / "landing.html"
ADMIN   = Path(__file__).parent / "admin.html"
def _hash_pw(password: str) -> str:
    return _bcrypt_lib.hashpw(password[:72].encode(), _bcrypt_lib.gensalt()).decode()

def _verify_pw(password: str, hashed: str) -> bool:
    return _bcrypt_lib.checkpw(password[:72].encode(), hashed.encode())

bearer = HTTPBearer(auto_error=False)
ALGORITHM = "HS256"


# ── Admin bootstrap ───────────────────────────────────────────────────────────

@app.on_event("startup")
async def _bootstrap_admin():
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_pass  = os.environ.get("ADMIN_PASSWORD")
    admin_user  = os.environ.get("ADMIN_USERNAME", "admin")
    if admin_email and admin_pass:
        ensure_admin_user(admin_email, admin_user, _hash_pw(admin_pass))


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
    if LANDING.exists():
        return LANDING.read_text()
    return DASH.read_text()

@app.get("/app", response_class=HTMLResponse)
async def app_page():
    return DASH.read_text()

@app.get("/admin", response_class=HTMLResponse)
async def admin_page():
    return ADMIN.read_text()

@app.get("/api/health")
async def health():
    cleanup_stale_data()
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
    uid = create_user(body.email, body.username, _hash_pw(body.password), code,
                      referred_by=referrer["id"] if referrer else None)
    # Welcome bonus — enough for ~3 short AI trips to show off the product
    add_credits(uid, SIGNUP_BONUS, "Welcome bonus")
    if referrer:
        # Referral bonus paid to both parties; capped at 10 referrals lifetime via credit history check
        add_credits(referrer["id"], 20, f"Referral — {body.username} signed up")
    return {"token": _make_token(uid), "user": _safe_user(get_user_by_id(uid))}

@app.post("/api/auth/login")
async def login(body: LoginRequest):
    user = get_user_by_email(body.email)
    if not user or not _verify_pw(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    return {"token": _make_token(user["id"]), "user": _safe_user(user)}

@app.get("/api/auth/me")
async def me(user: dict = Depends(_current_user)):
    return _safe_user(user)


# ── Trip planning ─────────────────────────────────────────────────────────────

def _extract_dna_signals(message: str) -> dict:
    """Keyword-match preference signals from user messages."""
    msg = message.lower()
    signals: dict = {}
    vehicle_map = {
        'tacoma': 'Toyota Tacoma', '4runner': 'Toyota 4Runner', 'tundra': 'Toyota Tundra',
        'wrangler': 'Jeep Wrangler', 'gladiator': 'Jeep Gladiator', 'bronco': 'Ford Bronco',
        'f-150': 'Ford F-150', 'f150': 'Ford F-150', 'raptor': 'Ford Raptor',
        'silverado': 'Chevy Silverado', 'ram ': 'RAM Truck', 'colorado': 'Chevy Colorado',
        'sprinter': 'Mercedes Sprinter', 'transit van': 'Ford Transit', 'land cruiser': 'Land Cruiser',
        'land rover': 'Land Rover', 'defender': 'Land Rover Defender',
    }
    for key, val in vehicle_map.items():
        if key in msg:
            signals['vehicle'] = val; break
    if not signals.get('vehicle'):
        if 'truck' in msg:   signals['vehicle'] = 'truck'
        elif 'van' in msg:   signals['vehicle'] = 'van'
        elif 'jeep' in msg:  signals['vehicle'] = 'Jeep'
        elif 'suv' in msg:   signals['vehicle'] = 'SUV'

    if any(x in msg for x in ['4wd', '4x4', 'technical', 'rock crawl', 'high clearance', 'locking']):
        signals['terrain'] = '4WD/technical'
    elif any(x in msg for x in ['mild', 'easy dirt', 'no big rocks', 'stock height', 'low clearance']):
        signals['terrain'] = 'mild dirt'

    if any(x in msg for x in ['dispersed', 'free camp', 'primitive', 'no hookup', 'boondock', 'wild camp']):
        signals['camp_style'] = 'dispersed/free'
    elif any(x in msg for x in ['hookup', 'electric', 'rv park', 'koa', 'full service', 'full hook']):
        signals['camp_style'] = 'hookups/developed'
    elif any(x in msg for x in ['reservation', 'reservable', 'fee campground']):
        signals['camp_style'] = 'reservable'

    if 'weekend' in msg:
        signals['duration'] = 'weekend'

    for region in ['utah', 'colorado', 'wyoming', 'montana', 'idaho', 'nevada', 'arizona',
                   'new mexico', 'oregon', 'washington', 'california', 'southwest', 'pacific northwest']:
        if region in msg:
            signals.setdefault('regions', [])
            if region not in signals['regions']:
                signals['regions'].append(region)
    return signals


class PlanRequest(BaseModel):
    request: str
    session_id: str = ""

class ChatRequest(BaseModel):
    message: str
    session_id: str
    current_trip: Optional[dict] = None
    rig_context: Optional[dict] = None  # mobile passes rig profile to seed trail_dna

@app.post("/api/chat")
async def chat_endpoint(request: Request, body: ChatRequest, user: dict = Depends(_optional_user)):
    if not body.message.strip():
        raise HTTPException(400, "Message cannot be empty")
    if len(body.message) > 2000:
        raise HTTPException(400, "Message exceeds 2000 characters")
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    if user:
        if has_active_plan(user):
            from db.store import get_plan_action_count_today, log_ai_usage
            if body.current_trip and get_plan_action_count_today(user["id"], "trip_edit") >= PLAN_DAILY_EDITS:
                raise HTTPException(429, "Daily trip edit limit reached. Resets at midnight UTC.")
            cost = 0
            log_ai_usage(user["id"], "trip_edit" if body.current_trip else "chat")
        else:
            cost = AI_COSTS["chat_edit"] if body.current_trip else AI_COSTS["chat"]
            if not deduct_credits(user["id"], cost, f"AI chat"):
                raise HTTPException(402, f"Not enough credits. This action costs {cost} credits.")
    else:
        _anon_check(_client_ip(request), "chat")

    session_id = body.session_id
    messages  = get_conversation(session_id)
    trail_dna = get_trail_dna(session_id)

    # Seed trail_dna from rig profile when mobile provides it
    if body.rig_context:
        rig = body.rig_context
        if rig.get("vehicle_type") and not trail_dna.get("vehicle"):
            parts = [rig.get("vehicle_type", "")]
            if rig.get("make"):  parts.append(rig["make"])
            if rig.get("model"): parts.append(rig["model"])
            if rig.get("lift_in") and rig["lift_in"] != "0": parts.append(f"{rig['lift_in']}\" lift")
            if rig.get("locking_diffs") and rig["locking_diffs"] not in ("None", ""):
                parts.append(f"lockers: {rig['locking_diffs']}")
            trail_dna["vehicle"] = " ".join(p for p in parts if p)
        if rig.get("fuel_range_miles") and not trail_dna.get("fuel_range"):
            trail_dna["fuel_range"] = str(rig["fuel_range_miles"])
        if rig.get("ground_clearance_in") and not trail_dna.get("clearance"):
            lift = float(rig.get("lift_in") or 0)
            base = float(rig.get("ground_clearance_in") or 0)
            trail_dna["clearance"] = str(int(base + lift))
        save_trail_dna(session_id, trail_dna)

    # Extract and persist preference signals
    signals = _extract_dna_signals(body.message)
    if signals:
        for k, v in signals.items():
            if k == 'regions':
                trail_dna.setdefault('regions', [])
                for r in v:
                    if r not in trail_dna['regions']:
                        trail_dna['regions'].append(r)
            else:
                trail_dna[k] = v
        save_trail_dna(session_id, trail_dna)

    # ── Edit mode: active trip exists ──────────────────────────────────────────
    if body.current_trip:
        import anthropic as _anthropic
        try:
            result = edit_trip(body.current_trip, body.message)
        except _anthropic.RateLimitError:
            raise HTTPException(429, "Rate limit hit — please wait 30 seconds and try again")
        except Exception as e:
            raise HTTPException(500, f"Edit failed: {e}")

        messages.append({"role": "user", "content": body.message})
        messages.append({"role": "assistant", "content": result.get("message", "")})
        save_conversation(session_id, messages[-30:])

        edited_plan = result.get("trip")
        if edited_plan:
            geocoded = await _geocode_waypoints(edited_plan.get("waypoints", []))
            edited_plan["waypoints"] = geocoded
            campsites, seen = [], set()
            for wp in geocoded:
                if wp.get("lat") and wp.get("lng"):
                    for c in await get_campsites_near(wp["lat"], wp["lng"], radius_miles=20):
                        if c["id"] not in seen:
                            seen.add(c["id"]); campsites.append(c)
            gas_stations = await get_gas_along_route(geocoded)
            trip_id = body.current_trip.get("trip_id", str(uuid.uuid4())[:8])
            updated = {"trip_id": trip_id, "plan": edited_plan,
                       "campsites": campsites[:40], "gas_stations": gas_stations[:30]}
            save_trip(trip_id, body.message, updated, user_id=user["id"] if user else None)
            return {"type": "trip_update", "content": result.get("message", "Route updated."),
                    "trip": updated, "trail_dna": trail_dna}

        return {"type": "message", "content": result.get("message", ""), "trail_dna": trail_dna}

    # ── Conversational planning mode ───────────────────────────────────────────
    messages.append({"role": "user", "content": body.message})
    try:
        response = chat_guide(messages, trail_dna)
    except Exception as e:
        raise HTTPException(500, f"Chat failed: {e}")

    messages.append({"role": "assistant", "content": response["content"]})
    save_conversation(session_id, messages[-30:])

    return {"type": response["type"], "content": response["content"],
            "outline": response.get("outline"), "trail_dna": trail_dna}


@app.post("/api/plan")
async def plan(request: Request, body: PlanRequest, user: dict = Depends(_optional_user)):
    import anthropic as _anthropic
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    # Estimate days from request text to determine cost; we refund/adjust after AI responds
    import re as _re
    day_hint = int((_re.search(r'\b(\d+)\s*-?\s*day', body.request or '', _re.I) or [None, 7])[1])
    if user:
        if has_active_plan(user):
            from db.store import get_plan_action_count_today, log_ai_usage
            if get_plan_action_count_today(user["id"], "trip_plan") >= PLAN_DAILY_TRIPS:
                raise HTTPException(429, "Daily trip planning limit reached. Resets at midnight UTC.")
            cost = 0  # plan holders plan for free
            log_ai_usage(user["id"], "trip_plan")
        else:
            cost = _plan_credit_cost(day_hint)
            if not deduct_credits(user["id"], cost, f"AI trip plan (~{day_hint}d)"):
                raise HTTPException(402, detail={
                    "code": "insufficient_credits",
                    "message": f"A {day_hint}-day plan costs {cost} credits.",
                    "credits_needed": cost,
                    "earn_hint": True,
                })
    else:
        _anon_check(_client_ip(request), "plan")
        cost = 0

    try:
        if body.session_id:
            msgs = get_conversation(body.session_id)
            plan_data = plan_trip_from_conversation(msgs) if msgs else plan_trip(body.request or "")
        else:
            if not body.request.strip():
                if user: add_credits(user["id"], cost, "Refund — empty plan request")
                raise HTTPException(400, "Request cannot be empty")
            plan_data = plan_trip(body.request)
    except HTTPException:
        raise
    except _anthropic.RateLimitError:
        if user: add_credits(user["id"], cost, "Refund — rate limit hit")
        raise HTTPException(429, "Rate limit hit — please wait 30 seconds and try again")
    except Exception as e:
        if user: add_credits(user["id"], cost, "Refund — planning error")
        raise HTTPException(500, f"AI planning failed: {e}")

    # Adjust charge to actual trip length
    if user and cost > 0:
        actual_days = plan_data.get("duration_days", day_hint)
        actual_cost = _plan_credit_cost(actual_days)
        if actual_cost != cost:
            diff = cost - actual_cost
            add_credits(user["id"], diff, f"Credit adjustment — actual trip is {actual_days} days")

    trip_id = str(uuid.uuid4())[:8]
    result_stub = {"trip_id": trip_id, "plan": plan_data, "campsites": [], "gas_stations": []}
    save_trip(trip_id, body.request, result_stub, user_id=user["id"] if user else None)

    actual_days = plan_data.get("duration_days", day_hint)
    log_event(
        user["id"] if user else None,
        body.session_id,
        "plan_generated",
        {"trip_id": trip_id, "days": actual_days,
         "states": plan_data.get("states", []),
         "difficulty": plan_data.get("difficulty", ""),
         "waypoint_count": len(plan_data.get("waypoints", [])),
         "platform": "web"},
    )

    geocoded = await _geocode_waypoints(plan_data.get("waypoints", []))
    plan_data["waypoints"] = geocoded

    campsites, seen = [], set()
    for wp in geocoded:
        if wp.get("lat") and wp.get("lng"):
            for c in await get_campsites_near(wp["lat"], wp["lng"], radius_miles=25):
                if c["id"] not in seen:
                    seen.add(c["id"]); campsites.append(c)

    gas_stations = await get_gas_along_route(geocoded)
    result = {"trip_id": trip_id, "plan": plan_data,
              "campsites": campsites[:40], "gas_stations": gas_stations[:30]}
    save_trip(trip_id, body.request, result, user_id=user["id"] if user else None)
    return result

@app.get("/api/trip/{trip_id}")
async def get_trip_route(trip_id: str, user: dict | None = Depends(_optional_user)):
    trip = get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    # Trips with a user_id are private — only the owner can fetch them
    trip_owner = trip.get("user_id")
    if trip_owner and (not user or user["id"] != trip_owner):
        raise HTTPException(403, "Not authorized to view this trip")
    return trip

@app.get("/api/trip/{trip_id}/guide")
async def trip_guide(trip_id: str, user: dict = Depends(_current_user)):
    """Return audio guide narrations for trip waypoints (generates + caches on first call).
    Free if already cached; costs credits only on first generation."""
    cached = get_audio_guide(trip_id)
    if cached:
        return cached  # already generated — serve free

    trip = get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    cost = AI_COSTS["audio_guide"]
    if not deduct_credits(user["id"], cost, f"Audio guide — {trip_id}"):
        raise HTTPException(402, f"Not enough credits. Audio guide costs {cost} credits.")

    from ai.planner import generate_audio_guide
    waypoints = trip.get("plan", {}).get("waypoints", [])
    trip_name = trip.get("plan", {}).get("trip_name", "Adventure")

    try:
        guide = generate_audio_guide(waypoints, trip_name)
    except Exception as e:
        add_credits(user["id"], cost, "Refund — audio guide error")
        raise HTTPException(500, f"Guide generation failed: {e}")

    save_audio_guide(trip_id, guide)
    return guide


# ── Weather ───────────────────────────────────────────────────────────────────

class RouteWeatherRequest(BaseModel):
    waypoints: list[dict]
    trip_id: str

@app.post("/api/weather/route")
async def route_weather(body: RouteWeatherRequest):
    """Download 7-day forecasts for all waypoints in a trip for offline use.
    Deduplicates waypoints within 0.1° and caches the full result for 3 hours."""
    cache_key = f"route_weather:{body.trip_id}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=10800)
    if cached:
        return cached

    # Filter to waypoints with valid coords, deduplicate within 0.1°
    seen_coords: list[tuple[float, float]] = []
    unique_wps: list[dict] = []
    for wp in body.waypoints:
        lat = wp.get("lat")
        lng = wp.get("lng")
        if lat is None or lng is None:
            continue
        is_dup = any(abs(lat - slat) < 0.1 and abs(lng - slng) < 0.1 for slat, slng in seen_coords)
        if not is_dup:
            seen_coords.append((lat, lng))
            unique_wps.append(wp)

    sem = asyncio.Semaphore(5)

    async def _fetch_one(wp: dict) -> tuple[str, dict | None]:
        async with sem:
            try:
                data = await weather_forecast(wp["lat"], wp["lng"], days=7)
                return (wp.get("name", f"{wp['lat']:.2f},{wp['lng']:.2f}"), data)
            except Exception:
                return (wp.get("name", ""), None)

    results = await asyncio.gather(*[_fetch_one(wp) for wp in unique_wps])
    forecasts = {name: data for name, data in results if data is not None}
    response = {"trip_id": body.trip_id, "forecasts": forecasts}
    set_cached("campsite_cache", cache_key, response)
    return response


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
async def nearby_audio(body: NearbyAudioRequest, user: dict = Depends(_current_user)):
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")
    cost = AI_COSTS["nearby_audio"]
    if not deduct_credits(user["id"], cost, "Nearby audio narration"):
        raise HTTPException(402, f"Not enough credits. This costs {cost} credits.")
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
async def campsites_search(
    lat: float, lng: float, radius: float = 40, types: str = "",
    request: Request = None, user: dict | None = Depends(_optional_user)
):
    type_filters = [t.strip() for t in types.split(",") if t.strip()] if types else None
    if user:
        if not has_active_plan(user) and user.get("credits", 0) < 1:
            # Check and consume the single free search slot
            if not use_free_camp_search(user["id"]):
                raise HTTPException(402, detail={
                    "code": "search_limit",
                    "message": "You've used your 1 free camp search.",
                    "earn_hint": True,
                })
    else:
        # Anonymous: treated as one-time per session via anon check
        if request:
            _anon_check(_client_ip(request), "search")
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


# ── Camp fullness ──────────────────────────────────────────────────────────────

class CampFullRequest(BaseModel):
    camp_name: str = ""; lat: float; lng: float

@app.post("/api/camps/{camp_id}/full")
async def api_report_camp_full(camp_id: str, body: CampFullRequest, user: dict = Depends(_current_user)):
    return report_camp_full(camp_id, body.camp_name, body.lat, body.lng, user["id"])

@app.post("/api/camps/{camp_id}/confirm-full")
async def api_confirm_camp_full(camp_id: str, user: dict = Depends(_current_user)):
    return confirm_camp_full(camp_id, user["id"])

@app.post("/api/camps/{camp_id}/dispute-full")
async def api_dispute_camp_full(camp_id: str, user: dict = Depends(_current_user)):
    return dispute_camp_full(camp_id, user["id"])

@app.get("/api/camps/fullness/nearby")
async def api_fullness_nearby(lat: float, lng: float, radius: float = 0.5):
    return get_fullness_nearby(lat, lng, radius_deg=radius)

@app.get("/api/camps/{camp_id}/fullness")
async def api_camp_fullness(camp_id: str):
    result = get_camp_fullness(camp_id)
    return result if result else None


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
        add_credits(user["id"], 5, f"Community pin: {body.name}")
    return {"status": "ok"}

@app.get("/api/pins")
async def nearby_pins(lat: float, lng: float, radius: float = 1.0):
    return get_community_pins(lat, lng, radius_deg=radius)


# ── Reports ───────────────────────────────────────────────────────────────────

VALID_REPORT_TYPES = {"police", "hazard", "road_condition", "wildlife", "road_closure", "campsite", "water", "cell_signal", "closure"}
VALID_SEVERITIES   = {"low", "moderate", "high", "critical"}

class ReportRequest(BaseModel):
    lat: float; lng: float
    type: str
    subtype: str = ""
    description: str = ""
    severity: str = "moderate"
    photo_data: Optional[str] = None  # base64 jpeg

@app.post("/api/reports")
async def submit_report(body: ReportRequest, user: dict = Depends(_current_user)):
    if not (-90 <= body.lat <= 90 and -180 <= body.lng <= 180):
        raise HTTPException(400, "Invalid coordinates")
    if body.type not in VALID_REPORT_TYPES:
        raise HTTPException(400, f"Invalid report type")
    if body.severity not in VALID_SEVERITIES:
        raise HTTPException(400, "Invalid severity")
    if len(body.description) > 500:
        raise HTTPException(400, "Description exceeds 500 characters")
    if body.photo_data and len(body.photo_data) > 2_000_000:
        raise HTTPException(400, "Photo too large (max 1.5 MB)")
    import time as _time
    # Check active restriction
    restricted, secs = is_reporter_restricted(user["id"])
    if restricted:
        hours = round(secs / 3600, 1)
        raise HTTPException(403, f"Reporting restricted for {hours} more hours due to inaccurate reports.")

    # Anti-abuse: hard daily report cap
    reports_today = get_user_report_count_today(user["id"])
    if reports_today >= DAILY_REPORT_LIMIT:
        raise HTTPException(429, f"Daily report limit reached ({DAILY_REPORT_LIMIT}/day). Thank you for your contributions!")

    # Anti-abuse: new accounts (< 24h) can report but don't earn credits yet
    account_age_h = (_time.time() - user.get("created_at", 0)) / 3600
    credits_eligible = account_age_h >= 24

    report_id = create_report(user["id"], body.lat, body.lng, body.type,
                              body.subtype, body.description, body.severity,
                              photo_data=body.photo_data)

    credits_earned = 0
    streak_info = {"streak": 0, "bonus": 0, "reason": ""}

    if credits_eligible:
        # Check daily credit cap from reports
        report_credits_today = get_report_credits_today(user["id"])
        base = REPORT_CREDIT_PHOTO if body.photo_data else REPORT_CREDIT_BASE
        allowed = min(base, max(0, DAILY_REPORT_CREDITS_CAP - report_credits_today))
        if allowed > 0:
            add_credits(user["id"], allowed, f"Report: {body.type}{' (photo)' if body.photo_data else ''}")
            credits_earned = allowed

        streak_info = check_and_update_streak(user["id"])
    else:
        streak_info = {"streak": 0, "bonus": 0, "reason": "Account must be 24h old to earn report credits"}

    log_event(user["id"], None, "report_submitted", {
        "report_type": body.type,
        "has_photo": bool(body.photo_data),
        "credits_earned": credits_earned + streak_info["bonus"],
    })
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


# ── Credits & Stripe ─────────────────────────────────────────────────────────

@app.get("/api/credits")
async def credits_route(user: dict = Depends(_current_user)):
    return {"balance": user["credits"], "history": get_credit_history(user["id"])}

@app.get("/api/credits/packages")
async def credit_packages():
    return [
        {"id": pid, **{k: v for k, v in pkg.items()},
         "price_display": f"${pkg['price_cents']/100:.2f}"}
        for pid, pkg in CREDIT_PACKAGES.items()
    ]

class CheckoutRequest(BaseModel):
    package_id: str

@app.post("/api/credits/checkout")
async def create_checkout(body: CheckoutRequest, user: dict = Depends(_current_user)):
    if not settings.stripe_secret_key:
        raise HTTPException(503, "Payment system not configured. Contact support.")
    pkg = CREDIT_PACKAGES.get(body.package_id)
    if not pkg:
        raise HTTPException(400, "Invalid package")
    try:
        import stripe as _stripe
        _stripe.api_key = settings.stripe_secret_key
        session = _stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": pkg["price_cents"],
                    "product_data": {
                        "name": f"Trailhead Credits — {pkg['label']}",
                        "description": f"{pkg['credits']} trail credits for AI trip planning",
                        "images": [f"{settings.public_url}/static/credits-icon.png"],
                    },
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=f"{settings.public_url}/credits/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.public_url}/credits/cancel",
            metadata={
                "user_id": str(user["id"]),
                "package_id": body.package_id,
                "credits": str(pkg["credits"]),
                "username": user["username"],
            },
            customer_email=user["email"],
        )
        return {"url": session.url, "session_id": session.id}
    except Exception as e:
        raise HTTPException(500, f"Checkout error: {e}")

from fastapi import Request as _Request

@app.post("/api/credits/webhook")
async def stripe_webhook(request: _Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "Webhook not configured")
    try:
        import stripe as _stripe
        _stripe.api_key = settings.stripe_secret_key
        event = _stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)
    except Exception:
        raise HTTPException(400, "Invalid webhook signature")

    if event["type"] == "checkout.session.completed":
        sess = event["data"]["object"]
        if sess.get("payment_status") == "paid":
            meta = sess.get("metadata", {})
            session_id = sess["id"]
            try:
                uid = int(meta.get("user_id", 0))
                credits = int(meta.get("credits", 0))
                pkg_id = meta.get("package_id", "")
            except (ValueError, TypeError):
                return {"received": True}
            if uid and credits and not is_stripe_session_fulfilled(session_id):
                add_credits(uid, credits, f"Purchased {pkg_id} pack — {credits} credits")
                fulfill_stripe_purchase(session_id, uid, credits)

    return {"received": True}

# ── Apple IAP subscription activation ────────────────────────────────────────

IAP_PRODUCTS = {
    "com.trailhead.explorer.monthly": {"label": "Explorer Monthly", "days": 31},
    "com.trailhead.explorer.annual":  {"label": "Explorer Annual",  "days": 366},
}

class IAPActivateRequest(BaseModel):
    product_id: str
    transaction_id: str  # from Apple StoreKit — stored for idempotency

@app.post("/api/subscription/activate")
async def activate_subscription(body: IAPActivateRequest, user: dict = Depends(_current_user)):
    """Called by mobile after a successful StoreKit purchase. Activates the plan on the user account."""
    product = IAP_PRODUCTS.get(body.product_id)
    if not product:
        raise HTTPException(400, f"Unknown product: {body.product_id}")

    # Idempotency: store transaction_id to prevent double-activation
    from db.store import _conn as _db_conn
    db = _db_conn()
    existing = db.execute(
        "SELECT id FROM stripe_purchases WHERE session_id=?", (body.transaction_id,)
    ).fetchone()
    if existing:
        db.close()
        user_row = get_user_by_id(user["id"])
        return {"status": "already_active", "plan_type": user_row.get("plan_type"), "plan_expires_at": user_row.get("plan_expires_at")}

    db.execute(
        "INSERT INTO stripe_purchases (session_id, user_id, credits, created_at) VALUES (?,?,0,?)",
        (body.transaction_id, user["id"], int(__import__("time").time()))
    )
    db.commit(); db.close()

    expires_at = activate_plan(user["id"], body.product_id, product["days"])
    log_event(user["id"], None, "iap_activate", {"product_id": body.product_id, "days": product["days"]})
    return {"status": "activated", "plan_type": body.product_id, "plan_expires_at": expires_at}

@app.get("/api/subscription/status")
async def subscription_status(user: dict = Depends(_current_user)):
    """Returns current plan state so mobile can gate features."""
    return {
        "plan_type": user.get("plan_type", "free"),
        "plan_expires_at": user.get("plan_expires_at"),
        "is_active": has_active_plan(user),
        "credits": user.get("credits", 0),
        "camp_searches_used": user.get("camp_searches_used", 0),
    }

@app.get("/credits/success", response_class=HTMLResponse)
async def credits_success(session_id: str = ""):
    return HTMLResponse("""<!DOCTYPE html><html><head><title>Payment Successful</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;background:#0a0f18;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.card{text-align:center;padding:40px;border-radius:16px;background:#141c2b;max-width:400px;}
h1{color:#f97316;font-size:28px;margin-bottom:8px;}p{color:#94a3b8;}</style></head>
<body><div class="card"><h1>Credits Added!</h1>
<p>Your trail credits have been added to your account. Return to the Trailhead app to start planning.</p>
<p style="margin-top:24px;font-size:13px;color:#64748b;">You can close this window.</p></div></body></html>""")

@app.get("/credits/cancel", response_class=HTMLResponse)
async def credits_cancel():
    return HTMLResponse("""<!DOCTYPE html><html><head><title>Checkout Cancelled</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;background:#0a0f18;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.card{text-align:center;padding:40px;border-radius:16px;background:#141c2b;max-width:400px;}
h1{color:#94a3b8;font-size:24px;}</style></head>
<body><div class="card"><h1>Checkout Cancelled</h1>
<p style="color:#64748b;">No charge was made. Return to the app to try again.</p></div></body></html>""")


@app.get("/privacy", response_class=HTMLResponse)
async def privacy_policy():
    return HTMLResponse("""<!DOCTYPE html><html lang="en"><head><title>Privacy Policy — Trailhead</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0f18;color:#e2e8f0;max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.7;}
h1{color:#f97316;font-size:28px;margin-bottom:4px;}
h2{color:#f1f5f9;font-size:18px;margin-top:32px;border-bottom:1px solid #1e2d3d;padding-bottom:8px;}
p,li{color:#94a3b8;font-size:15px;}
a{color:#f97316;}
.updated{color:#4b5563;font-size:13px;margin-bottom:32px;}
</style></head>
<body>
<h1>Trailhead — Privacy Policy</h1>
<p class="updated">Last updated: April 24, 2026</p>

<h2>1. Information We Collect</h2>
<p>We collect information you provide directly: email address, username, and password (stored as a bcrypt hash). When you use the app we collect location data (with your permission) to show nearby campsites, fuel stations, and community reports. We collect usage data such as trips planned, reports submitted, and credits earned or spent.</p>

<h2>2. How We Use Your Information</h2>
<p>Your information is used to: provide and improve the Trailhead service; personalise AI trip plans to your vehicle and preferences; display nearby campsite and hazard data on the map; process credit purchases via Stripe; send service-related communications. We do not sell your personal data to third parties.</p>

<h2>3. Location Data</h2>
<p>Trailhead requests foreground location access to center the map and find nearby camps and reports. Background location is requested only to enable automatic audio guide narrations as you drive. You can disable location access in your device Settings at any time, which will disable navigation and nearby features.</p>

<h2>4. Payment Data</h2>
<p>Credit purchases are processed by <a href="https://stripe.com/privacy">Stripe</a>. Trailhead never stores your full card number or payment details. Stripe's privacy policy governs payment data handling.</p>

<h2>5. Data Retention</h2>
<p>Account data is retained while your account is active. Community reports expire automatically (typically within 24–72 hours). You may request account deletion by contacting us at the address below.</p>

<h2>6. Third-Party Services</h2>
<p>Trailhead uses: Mapbox for maps (see <a href="https://www.mapbox.com/legal/privacy">Mapbox Privacy Policy</a>); Anthropic Claude for AI trip planning; RIDB / Recreation.gov for campsite data; Open-Meteo for weather data; Stripe for payments.</p>

<h2>7. Children's Privacy</h2>
<p>Trailhead is not directed to children under 13 and we do not knowingly collect personal information from children under 13.</p>

<h2>8. Changes to This Policy</h2>
<p>We may update this policy from time to time. Continued use of the app after changes constitutes acceptance of the updated policy.</p>

<h2>9. Contact</h2>
<p>Questions or requests: <a href="mailto:valdorar44@gmail.com">valdorar44@gmail.com</a></p>
</body></html>""")


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


# ── Bug reports ───────────────────────────────────────────────────────────────

class BugReportPayload(BaseModel):
    title: str
    description: str
    app_version: Optional[str] = ""

@app.post("/api/bugs")
async def submit_bug(body: BugReportPayload, user: dict = Depends(_current_user)):
    if not body.title.strip() or not body.description.strip():
        raise HTTPException(400, "Title and description are required.")
    bug_id = submit_bug_report(
        user_id=user["id"], username=user["username"],
        title=body.title.strip(), description=body.description.strip(),
        app_version=body.app_version or ""
    )
    return {"bug_id": bug_id, "message": "Bug report received. If it's legit you'll earn credits — thank you!"}

@app.get("/api/admin/bugs")
async def admin_get_bugs(status: Optional[str] = None, admin: dict = Depends(_require_admin)):
    return get_all_bug_reports(status)

@app.post("/api/admin/bugs/{bug_id}/award")
async def admin_award_bug(bug_id: int, credits: int, admin: dict = Depends(_require_admin)):
    return award_bug_credits(bug_id, credits)

@app.post("/api/admin/bugs/{bug_id}/dismiss")
async def admin_dismiss_bug(bug_id: int, admin: dict = Depends(_require_admin)):
    dismiss_bug_report(bug_id)
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


# ── Land ownership tile proxy (BLM/USFS/NPS) ─────────────────────────────────
# Proxies BLM Surface Management Agency tiles through our server so the mobile
# WebView never hits BLM's ArcGIS directly (CORS issues).
# BLM_Natl_SMA_Cached_without_PriUnk tiles are already RGBA — private land is
# transparent, only federal/state managed areas are colored. BLM_Natl_SMA no longer exists.

import base64 as _b64

_TRANSPARENT_TILE = _b64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=="
)

@app.get("/api/land-tile/{z}/{y}/{x}")
async def land_tile(z: int, y: int, x: int):
    # Mapbox GL JS template is {z}/{y}/{x} so y=tile_row, x=tile_col
    cache_key = f"blmtile3_{z}_{y}_{x}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24 * 7)
    if cached:
        return Response(
            content=_b64.b64decode(cached),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*"},
        )
    url = f"https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}"
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(url, headers={"User-Agent": "Trailhead/1.0"})
            r.raise_for_status()
            data = r.content
        set_cached("campsite_cache", cache_key, _b64.b64encode(data).decode())
        return Response(
            content=data,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*"},
        )
    except Exception:
        return Response(content=_TRANSPARENT_TILE, media_type="image/png", headers={"Access-Control-Allow-Origin": "*"})


# ── Land legality check ───────────────────────────────────────────────────────

@app.get("/api/land-check")
async def land_check(lat: float, lng: float):
    """Long-press 'am I legal here?' — queries BLM ArcGIS for land ownership.
    Tries layer 1 (LimitedScale) first, then layer 0 as fallback for gaps."""
    # 3-decimal precision (~100 m) so moving a few feet doesn't skip cache
    cache_key = f"land_check:{lat:.3f},{lng:.3f}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24 * 7)
    if cached:
        return cached

    UNKNOWN_RESULT = {
        "land_type": "UNKNOWN",
        "admin_name": "",
        "camping_status": "unknown",
        "camping_note": "Land ownership unclear — verify before camping.",
        "source": "BLM ArcGIS",
    }

    point_geom = json.dumps({"x": lng, "y": lat})
    base_params = {
        "geometry": point_geom,
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "ADMIN_UNIT_CD,ADMIN_ST,NLCS_DESC,GIS_ACRES",
        "returnGeometry": "false",
        "f": "json",
    }

    features = []
    source_label = "BLM ArcGIS"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Layer 1 = SMA polygon detail; layer 0 = broader SMA coverage
            for layer in (1, 0):
                resp = await client.get(
                    f"https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/{layer}/query",
                    params=base_params,
                    headers={"User-Agent": "Trailhead/1.0"},
                )
                resp.raise_for_status()
                features = resp.json().get("features", [])
                if features:
                    break

            # BLM SMA sometimes misses USFS-managed lands — try USFS boundary layer
            if not features:
                try:
                    usfs_params = {
                        "geometry": point_geom,
                        "geometryType": "esriGeometryPoint",
                        "inSR": "4326",
                        "spatialRel": "esriSpatialRelIntersects",
                        "outFields": "FORESTNAME,REGION",
                        "returnGeometry": "false",
                        "f": "json",
                    }
                    r2 = await client.get(
                        "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/0/query",
                        params=usfs_params,
                        headers={"User-Agent": "Trailhead/1.0"},
                        timeout=8,
                    )
                    r2.raise_for_status()
                    usfs_feats = r2.json().get("features", [])
                    if usfs_feats:
                        forest_name = usfs_feats[0].get("attributes", {}).get("FORESTNAME", "National Forest")
                        result = {
                            "land_type": "USFS",
                            "admin_name": forest_name,
                            "camping_status": "allowed",
                            "camping_note": f"{forest_name} — dispersed camping generally allowed outside developed sites. Check local fire restrictions.",
                            "source": "USFS ArcGIS",
                        }
                        set_cached("campsite_cache", cache_key, result)
                        return result
                except Exception:
                    pass

    except Exception:
        return UNKNOWN_RESULT

    if not features:
        return UNKNOWN_RESULT

    attrs = features[0].get("attributes", {})
    admin_cd = (attrs.get("ADMIN_UNIT_CD") or "").upper()
    nlcs_desc = (attrs.get("NLCS_DESC") or "").upper()
    admin_name = attrs.get("ADMIN_UNIT_CD") or ""

    # Determine land type from admin unit code prefix
    if "BLM" in admin_cd:
        land_type = "BLM"
    elif "USFS" in admin_cd or "NF" in admin_cd:
        land_type = "USFS"
    elif "NPS" in admin_cd:
        land_type = "NPS"
    elif "BOR" in admin_cd:
        land_type = "BOR"
    elif "STATE" in admin_cd or admin_cd.startswith("ST-"):
        land_type = "STATE"
    else:
        # Any matched feature defaults to BLM (most common public land type)
        land_type = "BLM"

    # Wilderness overrides camping rules
    is_wilderness = "WILDERNESS" in nlcs_desc and "STUDY" not in nlcs_desc

    if is_wilderness:
        camping_status = "check-rules"
        camping_note = "Wilderness area — pack-in/pack-out, no motorized vehicles. Dispersed camping allowed."
    elif land_type == "BLM":
        camping_status = "allowed"
        camping_note = "BLM land — dispersed camping generally allowed. 14-day stay limit. No facilities."
    elif land_type == "USFS":
        camping_status = "allowed"
        camping_note = "National Forest — dispersed camping generally allowed outside developed sites. Check local fire restrictions."
    elif land_type == "NPS":
        camping_status = "restricted"
        camping_note = "National Park — camping in designated sites only. Permit may be required."
    elif land_type == "BOR":
        camping_status = "check-rules"
        camping_note = "Bureau of Reclamation land — camping rules vary by project area. Check with local BOR office."
    elif land_type == "STATE":
        camping_status = "check-rules"
        camping_note = "State land — rules vary by state agency. Check before camping."
    else:
        camping_status = "unknown"
        camping_note = "Land ownership unclear — verify before camping."

    result = {
        "land_type": land_type,
        "admin_name": admin_name,
        "camping_status": camping_status,
        "camping_note": camping_note,
        "source": "BLM ArcGIS",
    }
    set_cached("campsite_cache", cache_key, result)
    return result


# ── OSM POIs (water, trailheads, viewpoints) ──────────────────────────────────

@app.get("/api/osm-pois")
async def osm_pois(lat: float, lng: float, radius: float = 30, types: str = "water,trailhead,viewpoint"):
    type_set = {t.strip() for t in types.split(",") if t.strip()}
    radius_m = int(radius * 1600)
    tasks = []
    if "water" in type_set:
        tasks.append(get_water_sources(lat, lng, radius_m=radius_m))
    if "trailhead" in type_set:
        tasks.append(get_trailheads(lat, lng, radius_m=radius_m))
    if "viewpoint" in type_set:
        tasks.append(get_viewpoints(lat, lng, radius_m=radius_m))
    if "peak" in type_set:
        tasks.append(get_peaks(lat, lng, radius_m=radius_m))
    if not tasks:
        return []
    results = await asyncio.gather(*tasks)
    return [item for sublist in results for item in sublist][:100]


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
    facility_id: str = ""

@app.post("/api/ai/campsite-insight")
async def campsite_insight(request: Request, body: CampsiteInsightRequest, user: dict = Depends(_optional_user)):
    """Generate AI-enriched campsite description with nearby context.
    Served free from cache; costs credits (auth) or counts against weekly limit (anon) on first generation.
    Permanent cache by facility_id; coordinate cache fallback for community pins."""
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    # Permanent cache by facility_id (RIDB campsites) — free for everyone forever
    if body.facility_id:
        cached = get_camp_brief(body.facility_id)
        if cached:
            return cached

    # Coordinate-based fallback cache (72h) for pins without a facility_id
    coord_key = f"ai_insight_{body.lat:.3f}_{body.lng:.3f}"
    if not body.facility_id:
        cached = get_cached("campsite_cache", coord_key, ttl_seconds=3600 * 72)
        if cached:
            return cached

    # Not cached — need to generate. Check credits/plan/anon limit.
    if user:
        if has_active_plan(user):
            pass  # plan holders generate for free
        else:
            cost = AI_COSTS["campsite_insight"]
            if not deduct_credits(user["id"], cost, f"Campsite insight — {body.name}"):
                raise HTTPException(402, detail={
                    "code": "insufficient_credits",
                    "message": f"Campsite briefs cost {cost} credits.",
                    "earn_hint": True,
                })
    else:
        _anon_check(_client_ip(request), "insight")

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
        if user and not has_active_plan(user):
            add_credits(user["id"], AI_COSTS["campsite_insight"], "Refund — campsite insight error")
        raise HTTPException(500, str(e))

    # Write to permanent cache (facility_id) and/or coordinate cache
    if body.facility_id:
        set_camp_brief(body.facility_id, result)
    set_cached("campsite_cache", coord_key, result)
    return result


# ── AI route briefing ─────────────────────────────────────────────────────────

class RouteBriefRequest(BaseModel):
    trip_name: str; waypoints: list[dict]; reports: list[dict] = []

@app.post("/api/ai/route-brief")
async def route_brief(body: RouteBriefRequest, user: dict = Depends(_current_user)):
    """AI safety and readiness briefing for an active trip."""
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")
    cost = AI_COSTS["route_brief"]
    if not deduct_credits(user["id"], cost, f"Route brief — {body.trip_name}"):
        raise HTTPException(402, f"Not enough credits. Route brief costs {cost} credits.")
    from ai.planner import generate_route_brief
    try:
        return generate_route_brief(body.trip_name, body.waypoints, body.reports)
    except Exception as e:
        add_credits(user["id"], cost, "Refund — route brief error")
        raise HTTPException(500, str(e))


# ── AI packing list ───────────────────────────────────────────────────────────

class PackingRequest(BaseModel):
    trip_name: str; duration_days: int; road_types: list[str] = []
    land_types: list[str] = []; states: list[str] = []

@app.post("/api/ai/packing-list")
async def packing_list(body: PackingRequest, user: dict = Depends(_current_user)):
    """Generate a smart packing list based on trip parameters."""
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")
    cost = AI_COSTS["packing_list"]
    if not deduct_credits(user["id"], cost, f"Packing list — {body.trip_name}"):
        raise HTTPException(402, f"Not enough credits. Packing list costs {cost} credits.")
    from ai.planner import generate_packing_list
    try:
        return generate_packing_list(body.trip_name, body.duration_days,
                                     body.road_types, body.land_types, body.states)
    except Exception as e:
        add_credits(user["id"], cost, "Refund — packing list error")
        raise HTTPException(500, str(e))


# ── Geocoding ─────────────────────────────────────────────────────────────────

async def _geocode_one(client: httpx.AsyncClient, wp: dict, sem: asyncio.Semaphore) -> dict:
    name = wp.get("name", "")
    if not name:
        return wp
    token = settings.mapbox_token
    async with sem:
        try:
            resp = await client.get(
                f"https://api.mapbox.com/geocoding/v5/mapbox.places/{httpx.utils.quote(name, safe='')}.json",
                params={"access_token": token, "limit": 1, "country": "us", "types": "place,locality,address,poi,region"},
            )
            resp.raise_for_status()
            feats = resp.json().get("features", [])
            if feats:
                lng, lat = feats[0]["geometry"]["coordinates"]
                wp["lat"] = lat
                wp["lng"] = lng
                wp["geocoded_name"] = feats[0].get("place_name", name)
        except Exception:
            pass
    return wp


async def _geocode_waypoints(waypoints: list[dict]) -> list[dict]:
    # Cap at 45 waypoints (covers 14-day trips); Mapbox has no per-second limit
    capped = waypoints[:45]
    sem = asyncio.Semaphore(8)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            results = await asyncio.wait_for(
                asyncio.gather(*[_geocode_one(client, wp, sem) for wp in capped]),
                timeout=45,
            )
            return list(results) + waypoints[45:]
    except asyncio.TimeoutError:
        return capped + waypoints[45:]
