"""Trailhead FastAPI server. All API routes."""
from __future__ import annotations
import asyncio, os, json, uuid, secrets, xml.etree.ElementTree as ET, time, hashlib, re, sqlite3, smtplib, html
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
from urllib.parse import quote
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional
import httpx
import bcrypt as _bcrypt_lib
from jose import jwt, JWTError

from config.settings import settings
from ai.planner import plan_trip, chat_guide, edit_trip, plan_trip_from_conversation
from dashboard.route_enrichment import enrich_trip_along_route
from ingestors.ridb import get_campsites_near, get_campsites_search, get_facility_detail
from ingestors.osm import get_osm_campsites, get_osm_campsite_detail, get_water_sources, get_trailheads, get_trails, get_viewpoints, get_peaks, get_hot_springs, get_fuel_stations
from ingestors.blm import get_blm_campsites, get_blm_campsite_detail
from db.store import (
    save_trip, get_trip, add_community_pin, get_community_pins, find_duplicate_community_pin,
    save_audio_guide, get_audio_guide, get_cached, set_cached, get_route_cached, set_route_cached,
    create_user, get_user_by_email, get_user_by_username, get_user_by_id, get_user_by_referral_code,
    set_email_verification, verify_email_token, set_password_reset, reset_password_with_token,
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
    authorize_offline_download,
    save_push_token, get_push_token,
    create_plan_job, get_plan_job, update_plan_job,
    submit_field_report, get_field_reports, get_field_report_summary,
    submit_trail_field_report, get_trail_field_reports, get_trail_field_report_summary,
    upsert_trail_profile, get_trail_profile, list_trail_profiles_near,
    add_trail_edit_suggestion, get_trail_edit_suggestions,
    update_trail_edit_suggestion_status, set_trail_profile_admin_update,
    get_camp_profile_override, set_camp_profile_override, add_camp_edit_suggestion,
    get_camp_edit_suggestions, update_camp_edit_suggestion_status,
    get_explore_story_override, get_explore_story_overrides, set_explore_story_override,
    get_user_pin_count_today, vote_community_pin, add_pin_update_suggestion,
    get_pin_update_suggestions, update_pin_update_suggestion_status, set_user_plan,
    save_app_store_subscription, get_app_store_subscription,
    add_contest_points, ensure_contest_entry, get_contest_user_status, get_contest_leaderboard,
    get_contest_admin_overview, snapshot_contest_award, run_contest_drawing,
    update_contest_award_status, backfill_contest_events_from_credits,
    get_contributor_profile, get_contributor_leaderboard, set_contributor_visibility,
    submit_map_contributor_application, get_map_contributor_applications,
    update_map_contributor_application_status,
)

# ── Credit economy ─────────────────────────────────────────────────────────────

AI_COSTS = {
    "chat":             3,
    "chat_edit":        10,  # Sonnet + full trip JSON context ≈ same cost as a new plan
    "campsite_insight": 5,
    "route_brief":      8,
    "packing_list":     5,
    "audio_guide":      10,
    "nearby_audio":     5,
    "explore_audio_summary": 5,
    "explore_audio_story": 10,
}

OFFLINE_DOWNLOAD_COSTS = {
    "state_map": 0,
    "state_route": 0,
    "state_contours": 0,
    "state_trails": 0,
    "trip_corridor": 0,
    "conus_map": 0,
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
REFERRAL_BONUS     = 20
COMMUNITY_PIN_CREDIT = 5
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
EXPLORE_CATALOG = Path(__file__).parent / "explore_catalog_v1.json"


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    from math import asin, cos, radians, sin, sqrt
    r = 6371000.0
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * r * asin(sqrt(a))


def _load_explore_catalog() -> dict:
    if EXPLORE_CATALOG.exists():
        try:
            catalog = json.loads(EXPLORE_CATALOG.read_text())
            return _apply_explore_story_overrides(catalog)
        except Exception:
            pass
    return _apply_explore_story_overrides({
        "schema_version": 1,
        "catalog_id": "explore-us-top-v1",
        "name": "Trailhead Featured Explore",
        "generated_at": 0,
        "source": "Fallback catalog",
        "future_pack_compatible": True,
        "places": [],
    })

def _apply_explore_story_overrides(catalog: dict) -> dict:
    overrides = get_explore_story_overrides()
    if not overrides:
        return catalog
    places = []
    for place in catalog.get("places") or []:
        override = overrides.get(str(place.get("id") or ""))
        if not override:
            places.append(place)
            continue
        enriched = dict(place)
        summary = dict(enriched.get("summary") or {})
        profile = dict(enriched.get("profile") or {})
        if override.get("title"):
            summary["title"] = override["title"]
        if override.get("hook"):
            summary["hook"] = override["hook"]
            profile["hook"] = override["hook"]
        if override.get("summary"):
            summary["short_description"] = override["summary"]
            profile["summary"] = override["summary"]
        if override.get("story"):
            profile["story"] = override["story"]
            enriched["audio_script"] = override["story"]
        enriched["summary"] = summary
        enriched["profile"] = profile
        enriched["admin_story"] = {
            "edited": True,
            "updated_at": override.get("updated_at"),
        }
        places.append(enriched)
    return {**catalog, "places": places}
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

def _email_configured() -> bool:
    smtp_ready = bool(settings.smtp_host and settings.smtp_from_email)
    cloudflare_ready = bool(
        settings.cloudflare_email_account_id and
        settings.cloudflare_email_api_token and
        settings.smtp_from_email
    )
    return smtp_ready or cloudflare_ready

def _verification_links(token: str) -> tuple[str, str]:
    app_link = f"trailhead://verify-email?token={token}"
    web_link = f"{settings.public_url.rstrip('/')}/api/auth/verify-email?token={token}"
    return app_link, web_link

def _send_email(to_email: str, subject: str, text_body: str, html_body: str) -> None:
    if settings.cloudflare_email_account_id and settings.cloudflare_email_api_token:
        cf_logo = '<div style="width:48px;height:48px;border-radius:14px;background:#f97316;display:inline-block;text-align:center;line-height:48px;color:white;font-size:26px;font-weight:900;">T</div>'
        payload = {
            "to": to_email,
            "from": settings.smtp_from_email,
            "subject": subject,
            "html": html_body.replace("{logo_html}", cf_logo),
            "text": text_body,
        }
        with httpx.Client(timeout=20) as client:
            resp = client.post(
                f"https://api.cloudflare.com/client/v4/accounts/{settings.cloudflare_email_account_id}/email/sending/send",
                headers={
                    "Authorization": f"Bearer {settings.cloudflare_email_api_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if resp.status_code >= 400:
            raise RuntimeError(f"Cloudflare email send failed: {resp.status_code}")
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError("Cloudflare email send failed")
        return

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    msg["To"] = to_email
    msg.set_content(text_body)
    logo_cid = "trailhead-logo"
    smtp_logo = f'<img src="cid:{logo_cid}" width="48" height="48" alt="Trailhead" style="width:48px;height:48px;border-radius:14px;display:inline-block;" />'
    msg.add_alternative(html_body.replace("{logo_html}", smtp_logo), subtype="html")
    logo_path = Path(__file__).resolve().parents[1] / "mobile" / "assets" / "icon.png"
    if logo_path.exists():
        msg.get_payload()[1].add_related(logo_path.read_bytes(), maintype="image", subtype="png", cid=f"<{logo_cid}>")

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        if settings.smtp_tls:
            smtp.starttls()
        if settings.smtp_user or settings.smtp_password:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)

def _send_verification_email(email: str, username: str, token: str) -> None:
    if not _email_configured():
        raise RuntimeError("Email sending is not configured")

    app_link, web_link = _verification_links(token)
    safe_username = html.escape(username)
    text_body = (
        f"Hi {username},\n\n"
        "Confirm your email to activate Trailhead:\n"
        f"{web_link}\n\n"
        "If you did not create this account, you can ignore this email.\n\n"
        "Trailhead\n"
        "hello@gettrailhead.app"
    )
    html_body = f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171412;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ee;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffaf2;border:1px solid #eadfce;border-radius:18px;overflow:hidden;">
          <tr><td style="padding:28px 28px 10px;">
            <div style="display:flex;align-items:center;gap:12px;">
              {{logo_html}}
              <div>
                <div style="font-size:22px;font-weight:900;letter-spacing:.08em;">TRAILHEAD</div>
                <div style="font-size:11px;color:#7a6f63;letter-spacing:.18em;">AI OVERLAND GUIDE</div>
              </div>
            </div>
          </td></tr>
          <tr><td style="padding:18px 28px 8px;">
            <h1 style="font-size:26px;line-height:1.15;margin:0 0 12px;">Confirm your email</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 18px;color:#4b423a;">Hi {safe_username}, tap the button below to activate your Trailhead account. Your signup credits unlock after verification.</p>
            <a href="{app_link}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:900;border-radius:12px;padding:14px 18px;font-size:14px;letter-spacing:.08em;">OPEN TRAILHEAD</a>
            <p style="font-size:13px;line-height:1.5;margin:18px 0 0;color:#7a6f63;">If the app button does not open, use this secure web link:<br><a href="{web_link}" style="color:#c2410c;">Confirm email in browser</a></p>
          </td></tr>
          <tr><td style="padding:18px 28px 28px;color:#95877a;font-size:12px;line-height:1.5;">You received this because this email was used to create a Trailhead account. Questions? hello@gettrailhead.app</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
"""
    _send_email(email, "Confirm your Trailhead email", text_body, html_body)

def _send_password_reset_email(email: str, username: str, token: str) -> None:
    if not _email_configured():
        raise RuntimeError("Email sending is not configured")
    reset_link = f"{settings.public_url.rstrip('/')}/api/auth/reset-password?token={token}"
    safe_username = html.escape(username)
    text_body = (
        f"Hi {username},\n\n"
        "Reset your Trailhead password using this secure link:\n"
        f"{reset_link}\n\n"
        "This link expires in 1 hour. If you did not request this, you can ignore this email.\n\n"
        "Trailhead\n"
        "hello@gettrailhead.app"
    )
    html_body = f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#f7f4ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171412;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ee;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffaf2;border:1px solid #eadfce;border-radius:18px;overflow:hidden;">
          <tr><td style="padding:28px 28px 10px;">
            <div style="display:flex;align-items:center;gap:12px;">
              {{logo_html}}
              <div>
                <div style="font-size:22px;font-weight:900;letter-spacing:.08em;">TRAILHEAD</div>
                <div style="font-size:11px;color:#7a6f63;letter-spacing:.18em;">AI OVERLAND GUIDE</div>
              </div>
            </div>
          </td></tr>
          <tr><td style="padding:18px 28px 8px;">
            <h1 style="font-size:26px;line-height:1.15;margin:0 0 12px;">Reset your password</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 18px;color:#4b423a;">Hi {safe_username}, use this secure link to set a new Trailhead password. It expires in 1 hour.</p>
            <a href="{reset_link}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:900;border-radius:12px;padding:14px 18px;font-size:14px;letter-spacing:.08em;">RESET PASSWORD</a>
          </td></tr>
          <tr><td style="padding:18px 28px 28px;color:#95877a;font-size:12px;line-height:1.5;">If you did not request this, ignore this email. Questions? hello@gettrailhead.app</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
"""
    _send_email(email, "Reset your Trailhead password", text_body, html_body)

def _grant_signup_rewards(user: dict) -> None:
    if int(user.get("credits") or 0) == 0:
        add_credits(user["id"], SIGNUP_BONUS, "Welcome bonus")
        if user.get("referred_by"):
            add_credits(user["referred_by"], REFERRAL_BONUS, f"Referral - {user.get('username', 'new user')} signed up")

def _require_admin(user: dict = Depends(_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    return user

def _check_credits(user: dict, cost: int, reason: str) -> None:
    """Deduct credits; admins always pass with no deduction."""
    if user.get("is_admin"):
        return  # unlimited for admin
    if not deduct_credits(user["id"], cost, reason):
        raise HTTPException(402, f"Not enough credits. This action costs {cost} credits.")


def _paywall_detail(code: str, message: str, credits_needed: int) -> dict:
    return {
        "code": code,
        "message": message,
        "credits_needed": credits_needed,
        "earn_hint": True,
    }


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

class VerifyEmailRequest(BaseModel):
    token: str

class ResendVerificationRequest(BaseModel):
    email: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    password: str

@app.post("/api/auth/register")
async def register(body: RegisterRequest):
    email = body.email.strip().lower()
    username = body.username.strip()
    if not _email_configured():
        raise HTTPException(503, "Email verification is not configured. Contact hello@gettrailhead.app.")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(400, "Enter a valid email address")
    if len(username) < 3 or len(username) > 24:
        raise HTTPException(400, "Username must be 3-24 characters")
    if not re.match(r"^[A-Za-z0-9_.-]+$", username):
        raise HTTPException(400, "Username can only use letters, numbers, dots, dashes, and underscores")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if get_user_by_email(email):
        raise HTTPException(400, "Email already registered")
    if get_user_by_username(username):
        raise HTTPException(400, "Username already taken")
    referrer = get_user_by_referral_code(body.referral_code) if body.referral_code else None
    code = f"{username.lower()}-{secrets.token_hex(3)}"
    try:
        uid = create_user(email, username, _hash_pw(body.password), code,
                          referred_by=referrer["id"] if referrer else None)
    except sqlite3.IntegrityError:
        raise HTTPException(400, "Email or username already registered")
    token = secrets.token_urlsafe(32)
    set_email_verification(uid, token)
    try:
        _send_verification_email(email, username, token)
    except Exception as e:
        raise HTTPException(503, f"Could not send verification email. Contact hello@gettrailhead.app. ({type(e).__name__})")
    return {
        "needs_verification": True,
        "email": email,
        "message": "Check your email to activate your Trailhead account.",
    }

@app.post("/api/auth/login")
async def login(body: LoginRequest):
    user = get_user_by_email(body.email.strip().lower())
    if not user or not _verify_pw(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    if not int(user.get("email_verified", 1)):
        raise HTTPException(403, "Email not verified. Check your inbox or resend the verification email.")
    return {"token": _make_token(user["id"]), "user": _safe_user(user)}

@app.post("/api/auth/verify-email")
async def verify_email(body: VerifyEmailRequest):
    token = body.token.strip()
    if not token:
        raise HTTPException(400, "Verification token is required")
    user = verify_email_token(token)
    if not user:
        raise HTTPException(400, "Verification link is invalid or expired")
    _grant_signup_rewards(user)
    fresh = get_user_by_id(user["id"])
    return {"token": _make_token(user["id"]), "user": _safe_user(fresh or user)}

@app.get("/api/auth/verify-email", response_class=HTMLResponse)
async def verify_email_web(token: str = ""):
    user = verify_email_token(token.strip()) if token else None
    if not user:
        return HTMLResponse("""<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f4ee;color:#171412;padding:32px;"><h1>Verification link expired</h1><p>Open Trailhead and resend the verification email, or contact hello@gettrailhead.app.</p></body></html>""", status_code=400)
    _grant_signup_rewards(user)
    return HTMLResponse("""<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f4ee;color:#171412;padding:32px;"><h1>Email confirmed</h1><p>Your Trailhead account is active. Open the app and sign in.</p><a href="trailhead://" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:900;border-radius:12px;padding:14px 18px;">Open Trailhead</a></body></html>""")

@app.post("/api/auth/resend-verification")
async def resend_verification(body: ResendVerificationRequest):
    if not _email_configured():
        raise HTTPException(503, "Email verification is not configured. Contact hello@gettrailhead.app.")
    email = body.email.strip().lower()
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(404, "No account found for that email")
    if int(user.get("email_verified", 1)):
        return {"ok": True, "message": "That email is already verified. Sign in to continue."}
    last_sent = int(user.get("email_verify_sent_at") or 0)
    if time.time() - last_sent < 60:
        raise HTTPException(429, "Please wait a minute before resending.")
    token = secrets.token_urlsafe(32)
    set_email_verification(user["id"], token)
    try:
        _send_verification_email(email, user["username"], token)
    except Exception as e:
        raise HTTPException(503, f"Could not send verification email. Contact hello@gettrailhead.app. ({type(e).__name__})")
    return {"ok": True, "message": "Verification email sent."}

@app.post("/api/auth/forgot-password")
async def forgot_password(body: ForgotPasswordRequest):
    if not _email_configured():
        raise HTTPException(503, "Email is not configured. Contact hello@gettrailhead.app.")
    email = body.email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(400, "Enter a valid email address")
    user = get_user_by_email(email)
    generic = {"ok": True, "message": "If that email has a Trailhead account, a reset link has been sent."}
    if not user:
        return generic
    last_sent = int(user.get("password_reset_sent_at") or 0)
    if time.time() - last_sent < 60:
        return generic
    token = secrets.token_urlsafe(32)
    set_password_reset(user["id"], token, int(time.time()) + 3600)
    try:
        _send_password_reset_email(email, user["username"], token)
    except Exception as e:
        raise HTTPException(503, f"Could not send reset email. Contact hello@gettrailhead.app. ({type(e).__name__})")
    return generic

@app.post("/api/auth/reset-password")
async def reset_password(body: ResetPasswordRequest):
    token = body.token.strip()
    if not token:
        raise HTTPException(400, "Reset token is required")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    user = reset_password_with_token(token, _hash_pw(body.password))
    if not user:
        raise HTTPException(400, "Reset link is invalid or expired")
    fresh = get_user_by_id(user["id"])
    return {"token": _make_token(user["id"]), "user": _safe_user(fresh or user)}

@app.get("/api/auth/reset-password", response_class=HTMLResponse)
async def reset_password_web(token: str = ""):
    safe_token = html.escape(token.strip())
    if not safe_token:
        return HTMLResponse("""<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f4ee;color:#171412;padding:32px;"><h1>Reset link missing</h1><p>Open the latest Trailhead password reset email and try again.</p></body></html>""", status_code=400)
    return HTMLResponse(f"""<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Reset Trailhead Password</title>
  <style>
    body{{margin:0;background:#f7f4ee;color:#171412;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;}}
    .card{{width:100%;max-width:420px;background:#fffaf2;border:1px solid #eadfce;border-radius:18px;padding:24px;box-shadow:0 14px 40px rgba(51,38,22,.12);}}
    .brand{{display:flex;align-items:center;gap:12px;margin-bottom:18px;}}
    .mark{{width:48px;height:48px;border-radius:14px;background:#f97316;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:24px;}}
    .name{{font-weight:900;letter-spacing:.08em;font-size:20px;}}
    .tag{{font-size:10px;color:#7a6f63;letter-spacing:.18em;margin-top:2px;}}
    h1{{font-size:26px;margin:0 0 8px;}}
    p{{color:#5f544a;line-height:1.5;margin:0 0 18px;}}
    input{{width:100%;box-sizing:border-box;border:1.5px solid #d8cbb8;border-radius:12px;padding:14px;font-size:16px;margin:8px 0;background:#fff;color:#171412;}}
    button{{width:100%;border:0;border-radius:12px;background:#f97316;color:white;font-weight:900;padding:15px;margin-top:10px;letter-spacing:.08em;}}
    .msg{{margin-top:14px;font-size:14px;color:#5f544a;}}
    .err{{color:#b91c1c;}}
    .ok{{color:#15803d;}}
  </style>
</head>
<body>
  <main class="card">
    <div class="brand"><div class="mark">T</div><div><div class="name">TRAILHEAD</div><div class="tag">AI OVERLAND GUIDE</div></div></div>
    <h1>Set a new password</h1>
    <p>Use at least 8 characters. After this works, open Trailhead and sign in with the new password.</p>
    <input id="pw" type="password" autocomplete="new-password" placeholder="New password" />
    <input id="pw2" type="password" autocomplete="new-password" placeholder="Confirm new password" />
    <button id="btn">RESET PASSWORD</button>
    <div id="msg" class="msg"></div>
  </main>
  <script>
    const token = "{safe_token}";
    const msg = document.getElementById('msg');
    document.getElementById('btn').onclick = async () => {{
      const password = document.getElementById('pw').value;
      const confirm = document.getElementById('pw2').value;
      msg.className = 'msg';
      if (password.length < 8) {{ msg.className = 'msg err'; msg.textContent = 'Use at least 8 characters.'; return; }}
      if (password !== confirm) {{ msg.className = 'msg err'; msg.textContent = 'Passwords do not match.'; return; }}
      const res = await fetch('/api/auth/reset-password', {{
        method: 'POST',
        headers: {{'Content-Type':'application/json'}},
        body: JSON.stringify({{token, password}})
      }});
      const data = await res.json().catch(() => ({{detail:'Request failed'}}));
      if (!res.ok) {{ msg.className = 'msg err'; msg.textContent = data.detail || 'Reset failed.'; return; }}
      msg.className = 'msg ok';
      msg.innerHTML = 'Password reset. <a href="trailhead://">Open Trailhead</a> and sign in.';
    }};
  </script>
</body>
</html>""")

@app.get("/api/auth/me")
async def me(user: dict = Depends(_current_user)):
    return _safe_user(user)

@app.delete("/api/auth/me")
async def delete_account(user: dict = Depends(_current_user)):
    """Permanently delete the authenticated user's account and all associated data.
    Required by App Store guideline 5.1.1(v)."""
    from db.store import delete_user
    delete_user(user["id"])
    return {"deleted": True}


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


def _trip_edit_clarification(message: str) -> Optional[str]:
    """Catch vague edit-mode requests before the planner rewrites a whole route."""
    text = (message or "").strip().lower()
    if not text:
        return None
    specific_day = bool(re.search(r"\bday\s*\d+\b", text))
    has_action = bool(re.search(r"\b(add|remove|delete|swap|replace|avoid|reroute|change|shorten|extend|move|insert|navigate|trail|camp|fuel|gas|monument|poi|viewpoint|hike|hot spring|waterfall)\b", text))
    has_place_signal = bool(re.search(r"\b(to|from|near|around|through|between|at)\s+[a-z0-9]", text))
    affirmative_build = bool(re.search(r"\b(build|do it|go ahead|yes|sounds good|send it)\b", text))
    vague_quality = bool(re.search(r"\b(better|cooler|fun|wild|chill|fix|improve|polish|interesting|scenic|less boring|more)\b", text))

    if affirmative_build or (has_action and (specific_day or has_place_signal)):
        return None
    if vague_quality or len(text.split()) <= 6:
        return (
            "I can tune this route before rebuilding it. What should I optimize for: easier driving, wilder roads, better camps, trails/hikes, monuments/viewpoints, or fuel/resupply?"
        )
    return None


def _ai_conversation_key(session_id: str, user: dict | None) -> str:
    """Privacy boundary for AI chat threads.

    Mobile keeps a device session id so offline/UI state can survive relaunches.
    Authenticated users still need session-scoped conversations so a new trip
    does not inherit the last trip's chat transcript.
    """
    clean_session = session_id or "default"
    if user and user.get("id") is not None:
        return f"user:{user['id']}:session:{clean_session}"
    return f"anon:{clean_session}"


def _ai_profile_key(session_id: str, user: dict | None) -> str:
    """Durable Trail DNA key.

    Account users keep stable preferences across trips. Anonymous users are
    still bound to their local session id.
    """
    if user and user.get("id") is not None:
        return f"user:{user['id']}:profile"
    return f"anon:{session_id or 'default'}"


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
            _check_credits(user, cost, f"AI chat")
    else:
        _anon_check(_client_ip(request), "chat")

    session_id = body.session_id
    conversation_key = _ai_conversation_key(session_id, user)
    profile_key = _ai_profile_key(session_id, user)
    messages  = get_conversation(conversation_key)
    trail_dna = get_trail_dna(profile_key)

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
        save_trail_dna(profile_key, trail_dna)

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
        save_trail_dna(profile_key, trail_dna)

    # ── Edit mode: active trip exists ──────────────────────────────────────────
    if body.current_trip:
        import anthropic as _anthropic
        clarification = _trip_edit_clarification(body.message)
        if clarification:
            messages.append({"role": "user", "content": body.message})
            messages.append({"role": "assistant", "content": clarification})
            save_conversation(conversation_key, messages[-30:])
            return {"type": "message", "content": clarification, "trail_dna": trail_dna}
        try:
            result = edit_trip(body.current_trip, body.message)
        except _anthropic.RateLimitError:
            raise HTTPException(429, "Rate limit hit — please wait 30 seconds and try again")
        except Exception as e:
            raise HTTPException(500, f"Edit failed: {e}")

        messages.append({"role": "user", "content": body.message})
        messages.append({"role": "assistant", "content": result.get("message", "")})
        save_conversation(conversation_key, messages[-30:])

        edited_plan = result.get("trip")
        if edited_plan:
            geocoded = await _geocode_waypoints(edited_plan.get("waypoints", []))
            edited_plan["waypoints"] = geocoded
            enrichment = await enrich_trip_along_route(geocoded)
            edited_plan["waypoints"] = enrichment.get("waypoints", geocoded)
            trip_id = body.current_trip.get("trip_id", str(uuid.uuid4())[:8])
            updated = {"trip_id": trip_id, "plan": edited_plan,
                       "campsites": enrichment["campsites"][:70],
                       "gas_stations": enrichment["gas_stations"][:45],
                       "route_pois": enrichment["route_pois"][:50]}
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
    save_conversation(conversation_key, messages[-30:])

    return {"type": response["type"], "content": response["content"],
            "outline": response.get("outline"), "trail_dna": trail_dna}


async def _send_expo_push(token: str, title: str, body_text: str, data: dict) -> None:
    """Fire-and-forget Expo push notification."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                "https://exp.host/--/api/v2/push/send",
                json={"to": token, "title": title, "body": body_text,
                      "data": data, "sound": "default", "priority": "high"},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
    except Exception:
        pass  # push is best-effort; never block the main flow


async def _execute_plan_job(job_id: str, body: PlanRequest, user: dict | None, cost: int) -> None:
    """Background task: generate the trip, geocode, enrich, save, notify."""
    import anthropic as _anthropic
    import re as _re
    started_at = time.time()
    update_plan_job(job_id, "running")
    try:
        update_plan_job(job_id, "ai")
        if body.session_id:
            msgs = get_conversation(_ai_conversation_key(body.session_id, user))
            plan_data = plan_trip_from_conversation(msgs) if msgs else plan_trip(body.request or "")
        else:
            plan_data = plan_trip(body.request or "")

        # Adjust credit charge to actual trip length
        if user and cost > 0:
            actual_days = plan_data.get("duration_days", 7)
            day_hint = int((_re.search(r'\b(\d+)\s*-?\s*day', body.request or '', _re.I) or [None, 7])[1])
            actual_cost = _plan_credit_cost(actual_days)
            estimated_cost = _plan_credit_cost(day_hint)
            if actual_cost != estimated_cost:
                add_credits(user["id"], estimated_cost - actual_cost,
                            f"Credit adjustment — actual trip is {actual_days} days")

        trip_id = str(uuid.uuid4())[:8]
        result_stub = {"trip_id": trip_id, "plan": plan_data, "campsites": [], "gas_stations": []}
        save_trip(trip_id, body.request, result_stub, user_id=user["id"] if user else None)

        actual_days = plan_data.get("duration_days", 7)
        log_event(
            user["id"] if user else None, body.session_id, "plan_generated",
            {"trip_id": trip_id, "days": actual_days,
             "states": plan_data.get("states", []),
             "difficulty": plan_data.get("difficulty", ""),
             "waypoint_count": len(plan_data.get("waypoints", [])),
             "platform": "mobile"},
        )

        is_long_trip = int(plan_data.get("duration_days") or 0) >= 10 or len(plan_data.get("waypoints", [])) >= 28

        update_plan_job(job_id, "geocoding")
        try:
            geocode_timeout = 25 if is_long_trip else 45
            geocoded = await asyncio.wait_for(_geocode_waypoints(plan_data.get("waypoints", [])), timeout=geocode_timeout)
        except Exception:
            geocoded = plan_data.get("waypoints", [])
        plan_data["waypoints"] = geocoded

        update_plan_job(job_id, "enriching")
        try:
            enrich_timeout = 10 if is_long_trip or (time.time() - started_at) > 70 else 28
            enrichment = await asyncio.wait_for(enrich_trip_along_route(geocoded), timeout=enrich_timeout)
        except Exception:
            enrichment = {"waypoints": geocoded, "campsites": [], "gas_stations": [], "route_pois": []}
        plan_data["waypoints"] = enrichment.get("waypoints", geocoded)
        result = {"trip_id": trip_id, "plan": plan_data,
                  "campsites": enrichment["campsites"][:70],
                  "gas_stations": enrichment["gas_stations"][:45],
                  "route_pois": enrichment["route_pois"][:50]}
        save_trip(trip_id, body.request, result, user_id=user["id"] if user else None)

        update_plan_job(job_id, "done", result=json.dumps(result))

        # Push notification — send whether or not app is foregrounded
        if user:
            push_token = get_push_token(user["id"])
            if push_token:
                trip_name = plan_data.get("trip_name", "Your trip")
                days = plan_data.get("duration_days", 0)
                await _send_expo_push(
                    push_token,
                    title="Your route is ready Map",
                    body_text=f"{trip_name} — {days} days planned. Tap to explore.",
                    data={"type": "trip_ready", "job_id": job_id, "trip_id": trip_id},
                )

    except _anthropic.RateLimitError:
        if user and cost > 0:
            add_credits(user["id"], cost, "Refund — rate limit during planning")
        update_plan_job(job_id, "failed", error="Rate limit hit — please try again in 30 seconds")
    except Exception as e:
        if user and cost > 0:
            add_credits(user["id"], cost, "Refund — planning error")
        update_plan_job(job_id, "failed", error=f"AI planning failed: {e}")


@app.post("/api/plan")
async def plan(request: Request, body: PlanRequest, user: dict = Depends(_optional_user)):
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    import re as _re
    day_hint = int((_re.search(r'\b(\d+)\s*-?\s*day', body.request or '', _re.I) or [None, 7])[1])

    if user:
        if has_active_plan(user):
            from db.store import get_plan_action_count_today, log_ai_usage
            if get_plan_action_count_today(user["id"], "trip_plan") >= PLAN_DAILY_TRIPS:
                raise HTTPException(429, "Daily trip planning limit reached. Resets at midnight UTC.")
            cost = 0
            log_ai_usage(user["id"], "trip_plan")
        else:
            cost = _plan_credit_cost(day_hint)
            if not user.get("is_admin") and not deduct_credits(user["id"], cost, f"AI trip plan (~{day_hint}d)"):
                raise HTTPException(402, detail={
                    "code": "insufficient_credits",
                    "message": f"A {day_hint}-day plan costs {cost} credits.",
                    "credits_needed": cost,
                    "earn_hint": True,
                })
    else:
        _anon_check(_client_ip(request), "plan")
        cost = 0

    if not body.session_id and not (body.request or "").strip():
        if user and cost > 0:
            add_credits(user["id"], cost, "Refund — empty plan request")
        raise HTTPException(400, "Request cannot be empty")

    job_id = str(uuid.uuid4())[:12]
    create_plan_job(job_id, user["id"] if user else None, body.session_id or "", body.request or "")
    asyncio.create_task(_execute_plan_job(job_id, body, user, cost))
    return {"job_id": job_id, "status": "pending"}


@app.get("/api/plan/job/{job_id}")
async def plan_job_status(job_id: str, user: dict | None = Depends(_optional_user)):
    """Poll for async plan job status. Returns result when done."""
    job = get_plan_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    job_owner = job.get("user_id")
    if job_owner and (not user or user["id"] != job_owner):
        raise HTTPException(403, "Not authorized to view this plan job")
    result = json.loads(job["result"]) if job.get("result") else None
    return {"job_id": job_id, "status": job["status"], "result": result, "error": job.get("error")}


class PushTokenRequest(BaseModel):
    token: str

@app.post("/api/push-token")
async def register_push_token(body: PushTokenRequest, user: dict = Depends(_current_user)):
    """Store the device's Expo push token so the server can notify on job completion."""
    save_push_token(user["id"], body.token)
    return {"ok": True}


# ── Routing ───────────────────────────────────────────────────────────────────

class RouteOptions(BaseModel):
    avoidTolls: bool = False
    avoidHighways: bool = False
    backRoads: bool = False
    noFerries: bool = False

class RouteRequest(BaseModel):
    locations: list[dict]
    options: RouteOptions = Field(default_factory=RouteOptions)
    units: str = "miles"

def _valhalla_base_url() -> str:
    return settings.valhalla_url.rstrip("/")

def _valhalla_costing_options(opts: RouteOptions) -> dict:
    return {
        "auto": {
            # Valhalla weights are preferences, not hard filters. These defaults
            # bias overland routes toward service roads/tracks while keeping
            # enough paved connectivity to avoid broken farm-field shortcuts.
            "use_tracks": 0.9 if opts.backRoads else 0.35,
            "use_highways": 0.05 if (opts.backRoads or opts.avoidHighways) else 0.65,
            "use_tolls": 0.0 if opts.avoidTolls else 0.5,
            "use_ferry": 0.0 if opts.noFerries else 0.5,
        }
    }

def _route_cache_key(payload: dict) -> str:
    canonical = {
        "locations": [
            {"lat": round(float(loc["lat"]), 5), "lon": round(float(loc["lon"]), 5)}
            for loc in payload["locations"]
        ],
        "costing": payload["costing"],
        "costing_options": payload["costing_options"],
        "units": payload["units"],
    }
    raw = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()

@app.get("/api/route/health")
async def route_health():
    url = f"{_valhalla_base_url()}/status"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(url)
        return {"ok": res.status_code < 500, "engine": "valhalla", "status": res.status_code}
    except Exception as e:
        return {"ok": False, "engine": "valhalla", "error": str(e)}

@app.post("/api/route")
async def route_proxy(body: RouteRequest):
    if len(body.locations) < 2:
        raise HTTPException(400, "At least two locations are required")

    locations = []
    for loc in body.locations:
        try:
            lat = float(loc["lat"])
            lon = float(loc["lon"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "Each location must include numeric lat and lon")
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise HTTPException(400, "Location out of range")
        locations.append({"lat": lat, "lon": lon})

    payload = {
        "locations": locations,
        "costing": "auto",
        "costing_options": _valhalla_costing_options(body.options),
        "units": body.units if body.units in ("miles", "kilometers") else "miles",
        "directions_options": {"units": body.units if body.units in ("miles", "kilometers") else "miles"},
    }
    cache_key = _route_cache_key(payload)
    cached = get_route_cached(cache_key)
    if cached:
        cached["_trailhead"] = {"engine": "valhalla", "cache": "hit", "cache_key": cache_key}
        return cached

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(f"{_valhalla_base_url()}/route", json=payload)
    except httpx.TimeoutException:
        raise HTTPException(504, "Valhalla route timed out")
    except Exception as e:
        raise HTTPException(502, f"Valhalla route failed: {e}")

    if res.status_code >= 400:
        detail = res.text[:500] if res.text else "Valhalla route failed"
        raise HTTPException(res.status_code, detail)
    data = res.json()
    if data.get("trip", {}).get("status") == 0:
        set_route_cached(cache_key, payload, data)
    data["_trailhead"] = {"engine": "valhalla", "cache": "miss", "cache_key": cache_key}
    return data

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
async def trip_guide(trip_id: str, generate: bool = False, user: dict = Depends(_current_user)):
    """Return audio guide narrations for trip waypoints (generates + caches on first call).
    Free if already cached. Costs credits only when generate=true and no cache exists."""
    trip = get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    trip_owner = trip.get("user_id")
    if trip_owner and user["id"] != trip_owner:
        raise HTTPException(403, "Not authorized to view this trip")

    cached = get_audio_guide(trip_id)
    if cached:
        return cached  # already generated — serve free

    if not generate:
        return {}

    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    cost = AI_COSTS["audio_guide"]
    charged_audio_guide = False
    if not user.get("is_admin") and not has_active_plan(user):
        if not deduct_credits(user["id"], cost, f"Audio guide — {trip_id}"):
            raise HTTPException(402, detail=_paywall_detail(
                "audio_guide",
                f"Trip audio guide generation costs {cost} credits, or is included with Explorer.",
                cost,
            ))
        charged_audio_guide = True

    from ai.planner import generate_audio_guide
    waypoints = trip.get("plan", {}).get("waypoints", [])
    trip_name = trip.get("plan", {}).get("trip_name", "Adventure")

    try:
        guide = generate_audio_guide(waypoints, trip_name)
    except Exception as e:
        if charged_audio_guide:
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

ELEVENLABS_DIRECTION_MODEL = "eleven_flash_v2_5"
ELEVENLABS_GUIDE_MODEL = "eleven_multilingual_v2"
AUDIO_CACHE_VERSION = "v1"

def _tts_mode(mode: str) -> str:
    return "guide" if mode == "guide" else "direction"

def _tts_model_id(mode: str) -> str:
    return ELEVENLABS_DIRECTION_MODEL if mode == "direction" else ELEVENLABS_GUIDE_MODEL

def _tts_voice_settings(mode: str) -> dict:
    return {
        "stability": 0.42 if mode == "guide" else 0.58,
        "similarity_boost": 0.78,
        "style": 0.45 if mode == "guide" else 0.12,
        "use_speaker_boost": True,
    }

def _normalize_tts_text(text: str, mode: str) -> str:
    clean = " ".join((text or "").split())
    if not clean:
        raise HTTPException(400, "Text is required")
    limit = 280 if mode == "direction" else 10000
    return clean[:limit]

def _audio_cache_digest(text: str, mode: str) -> str:
    payload = {
        "version": AUDIO_CACHE_VERSION,
        "mode": mode,
        "voice_id": settings.elevenlabs_voice_id,
        "model_id": _tts_model_id(mode),
        "voice_settings": _tts_voice_settings(mode),
        "text": text,
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()

def _audio_cache_key(digest: str, mode: str) -> str:
    prefix = (settings.audio_cache_r2_prefix or "audio-cache").strip("/").strip()
    return f"{prefix}/{AUDIO_CACHE_VERSION}/{mode}/{digest}.mp3"

def _audio_cache_path(digest: str, mode: str) -> Path:
    return Path(settings.audio_cache_dir) / AUDIO_CACHE_VERSION / mode / f"{digest}.mp3"

def _audio_cache_headers(text: str, mode: str, cache_status: str) -> dict[str, str]:
    digest = _audio_cache_digest(text, mode)[:24]
    max_age = "2592000" if mode == "guide" else "300"
    return {
        "Cache-Control": f"private, max-age={max_age}",
        "ETag": f'"tts-{digest}"',
        "X-Trailhead-Voice": "elevenlabs",
        "X-Trailhead-Audio-Cache": cache_status,
    }

def _r2_audio_client():
    if not (settings.r2_account_id and settings.r2_access_key_id and settings.r2_secret_access_key and settings.r2_bucket):
        return None
    try:
        import boto3
        from botocore.config import Config
        return boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
    except Exception as exc:
        try:
            log_event(None, None, "audio_cache_r2_unavailable", {"details": f"{type(exc).__name__}: {exc}"})
        except Exception:
            pass
        return None

async def _read_audio_cache(digest: str, mode: str) -> bytes | None:
    if mode != "guide":
        return None
    r2 = _r2_audio_client()
    key = _audio_cache_key(digest, mode)
    if r2 is not None:
        try:
            obj = await asyncio.to_thread(r2.get_object, Bucket=settings.r2_bucket, Key=key)
            return await asyncio.to_thread(obj["Body"].read)
        except Exception:
            pass
    path = _audio_cache_path(digest, mode)
    if path.exists():
        try:
            return await asyncio.to_thread(path.read_bytes)
        except Exception:
            return None
    return None

async def _write_audio_cache(digest: str, mode: str, audio: bytes) -> None:
    if mode != "guide" or not audio:
        return
    r2 = _r2_audio_client()
    key = _audio_cache_key(digest, mode)
    if r2 is not None:
        try:
            await asyncio.to_thread(
                r2.put_object,
                Bucket=settings.r2_bucket,
                Key=key,
                Body=audio,
                ContentType="audio/mpeg",
                CacheControl="private, max-age=2592000",
                Metadata={"trailhead-cache-version": AUDIO_CACHE_VERSION, "mode": mode},
            )
            return
        except Exception as exc:
            try:
                log_event(None, None, "audio_cache_r2_write_failed", {"details": f"{type(exc).__name__}: {exc}"})
            except Exception:
                pass
    try:
        path = _audio_cache_path(digest, mode)
        await asyncio.to_thread(path.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, audio)
    except Exception as exc:
        try:
            log_event(None, None, "audio_cache_local_write_failed", {"details": f"{type(exc).__name__}: {exc}"})
        except Exception:
            pass

async def _delete_audio_cache(digest: str, mode: str) -> None:
    if mode != "guide":
        return
    r2 = _r2_audio_client()
    key = _audio_cache_key(digest, mode)
    if r2 is not None:
        try:
            await asyncio.to_thread(r2.delete_object, Bucket=settings.r2_bucket, Key=key)
        except Exception as exc:
            try:
                log_event(None, None, "audio_cache_r2_delete_failed", {"details": f"{type(exc).__name__}: {exc}"})
            except Exception:
                pass
    try:
        path = _audio_cache_path(digest, mode)
        if path.exists():
            await asyncio.to_thread(path.unlink)
    except Exception as exc:
        try:
            log_event(None, None, "audio_cache_local_delete_failed", {"details": f"{type(exc).__name__}: {exc}"})
        except Exception:
            pass

async def _purge_guide_audio_texts(*texts: str) -> int:
    purged = 0
    seen = set()
    for text in texts:
        if not text:
            continue
        clean = _normalize_tts_text(text, "guide")
        digest = _audio_cache_digest(clean, "guide")
        if digest in seen:
            continue
        seen.add(digest)
        await _delete_audio_cache(digest, "guide")
        purged += 1
    return purged

async def _elevenlabs_tts(clean: str, mode: str) -> bytes:
    if not settings.elevenlabs_api_key:
        raise HTTPException(500, "ELEVENLABS_API_KEY not configured")
    model_id = _tts_model_id(mode)
    url = (
        "https://api.elevenlabs.io/v1/text-to-speech/"
        f"{quote(settings.elevenlabs_voice_id)}?output_format=mp3_44100_128"
    )
    payload = {
        "text": clean,
        "model_id": model_id,
        "voice_settings": _tts_voice_settings(mode),
    }
    timeout = 120 if mode == "guide" else 30
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            url,
            headers={
                "xi-api-key": settings.elevenlabs_api_key,
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if r.status_code >= 400:
        detail = r.text[:240] if r.text else r.reason_phrase
        raise HTTPException(r.status_code, f"ElevenLabs TTS failed: {detail}")
    return r.content

@app.get("/api/audio/tts")
async def tts_audio(text: str = "", mode: str = "direction", token: str = "", user: dict = Depends(_current_user)):
    """Return ElevenLabs MP3 speech. The API key stays server-side."""
    mode = _tts_mode(mode)
    if token:
        session = get_cached("campsite_cache", f"tts_session:{user['id']}:{token}", ttl_seconds=3600)
        if not session:
            raise HTTPException(404, "Audio session expired")
        text = session.get("text") or ""
        mode = _tts_mode(session.get("mode") or mode)
    clean = _normalize_tts_text(text, mode)
    digest = _audio_cache_digest(clean, mode)
    cached = await _read_audio_cache(digest, mode)
    if cached:
        return Response(
            content=cached,
            media_type="audio/mpeg",
            headers=_audio_cache_headers(clean, mode, "HIT"),
        )

    audio = await _elevenlabs_tts(clean, mode)
    await _write_audio_cache(digest, mode, audio)
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers=_audio_cache_headers(clean, mode, "MISS" if mode == "guide" else "BYPASS"),
    )

class NearbyAudioRequest(BaseModel):
    lat: float; lng: float; location_name: str = ""

class ExploreAudioAuthorizeRequest(BaseModel):
    place_id: str
    mode: str = "summary"

class TtsSessionRequest(BaseModel):
    text: str
    mode: str = "guide"

@app.post("/api/audio/tts-session")
async def prepare_tts_session(body: TtsSessionRequest, user: dict = Depends(_current_user)):
    """Store long TTS text briefly so mobile can fetch audio without an oversized URL."""
    mode = _tts_mode(body.mode)
    clean = _normalize_tts_text(body.text, mode)
    token = hashlib.sha256(f"{user['id']}:{mode}:{clean}:{settings.secret_key}".encode()).hexdigest()[:40]
    set_cached("campsite_cache", f"tts_session:{user['id']}:{token}", {"text": clean, "mode": mode})
    return {"uri": f"/api/audio/tts?token={token}", "mode": mode}

@app.post("/api/audio/nearby")
async def nearby_audio(body: NearbyAudioRequest, user: dict = Depends(_current_user)):
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")
    cache_key = f"nearby_audio:{body.lat:.3f},{body.lng:.3f}:{(body.location_name or '').strip().lower()[:60]}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24)
    if cached:
        return {"narration": cached}
    cost = AI_COSTS["nearby_audio"]
    charged_nearby_audio = False
    if not user.get("is_admin") and not has_active_plan(user):
        if not deduct_credits(user["id"], cost, "Nearby audio narration"):
            raise HTTPException(402, detail=_paywall_detail(
                "nearby_audio",
                f"What’s Around Me audio costs {cost} credits, or is included with Explorer.",
                cost,
            ))
        charged_nearby_audio = True
    from ai.planner import generate_location_narration
    try:
        location_name = body.location_name
        if not location_name:
            wiki_hits, land = await asyncio.gather(
                wikipedia_nearby(body.lat, body.lng, radius=12000, limit=3),
                land_check(body.lat, body.lng),
            )
            nearby = ", ".join(h.get("title", "") for h in wiki_hits[:3] if h.get("title"))
            land_label = " ".join(x for x in [land.get("land_type", ""), land.get("admin_name", "")] if x).strip()
            location_name = "; ".join(x for x in [land_label, nearby] if x)
        narration = generate_location_narration(body.lat, body.lng, location_name)
    except Exception as e:
        if charged_nearby_audio:
            add_credits(user["id"], cost, "Refund — nearby audio error")
        raise HTTPException(500, f"Narration failed: {e}")
    set_cached("campsite_cache", cache_key, narration)
    return {"narration": narration}

@app.post("/api/audio/explore/authorize")
async def authorize_explore_audio(body: ExploreAudioAuthorizeRequest, user: dict = Depends(_current_user)):
    mode = "story" if body.mode == "story" else "summary"
    cost = AI_COSTS["explore_audio_story"] if mode == "story" else AI_COSTS["explore_audio_summary"]
    place_id = re.sub(r"[^a-zA-Z0-9_.:-]", "", (body.place_id or ""))[:160] or "place"
    unlock_key = f"explore_audio_unlock:{user['id']}:{place_id}:{mode}"
    if user.get("is_admin") or has_active_plan(user):
        return {"authorized": True, "charged": 0, "plan": True, "credits": user.get("credits", 0)}
    if get_cached("campsite_cache", unlock_key, ttl_seconds=3600 * 24 * 365):
        return {"authorized": True, "charged": 0, "already_unlocked": True, "credits": user.get("credits", 0)}
    if not deduct_credits(user["id"], cost, f"Explore audio {mode} — {place_id}"):
        raise HTTPException(402, detail=_paywall_detail(
            "explore_audio",
            f"{'Full Story' if mode == 'story' else 'Summary'} audio costs {cost} credits, or is included with Explorer.",
            cost,
        ))
    set_cached("campsite_cache", unlock_key, {"mode": mode, "place_id": place_id})
    fresh = get_user_by_id(user["id"]) or user
    return {"authorized": True, "charged": cost, "credits": fresh.get("credits", 0)}


# ── Config (public) ───────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    return {
        "mapbox_token": settings.mapbox_token,
        # Exposed so the mobile app can fetch vector tiles direct from Protomaps'
        # CDN (faster than proxying via Railway). Acceptable for early-stage —
        # rotate if abused. Free tier is 200k-1M tiles/month.
        "protomaps_key": settings.protomaps_key,
    }


@app.get("/api/geocode")
async def geocode_places(q: str, limit: int = 8):
    query = (q or "").strip()
    if not query:
        return []
    limit = max(1, min(int(limit or 8), 10))
    token = settings.mapbox_token
    async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "TrailheadRouteBuilder/1.0"}) as client:
        if token:
            try:
                resp = await client.get(
                    f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(query, safe='')}.json",
                    params={"access_token": token, "limit": limit, "country": "us"},
                )
                resp.raise_for_status()
                places = []
                for feat in resp.json().get("features", [])[:limit]:
                    coords = feat.get("geometry", {}).get("coordinates") or []
                    if len(coords) >= 2:
                        places.append({
                            "name": feat.get("place_name") or feat.get("text") or query,
                            "lat": float(coords[1]),
                            "lng": float(coords[0]),
                        })
                if places:
                    return places
            except Exception:
                pass
        try:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"format": "json", "limit": limit, "countrycodes": "us", "q": query},
            )
            resp.raise_for_status()
            places = []
            for p in resp.json()[:limit]:
                if not p.get("lat") or not p.get("lon"):
                    continue
                display = p.get("display_name") or query
                places.append({
                    "name": ", ".join(display.split(",")[:3]),
                    "lat": float(p["lat"]),
                    "lng": float(p["lon"]),
                })
            return places
        except Exception as e:
            raise HTTPException(502, f"Geocode failed: {e}")


# ── Self-hosted vector tiles (Protomaps proxy) ────────────────────────────────
# Lets the mobile app render maps without selective region downloads. The whole
# world's vector data is served from our backend; the WebView caches tiles it
# fetches, so any area the user views gets cached automatically.
#
# Two cache layers:
#   1. In-process LRU (RAM) — eliminates Protomaps round-trip for repeat hits
#   2. Surrogate-Control header — opts into Fastly CDN edge caching at Railway
# Without these, every tile is ~300-600ms (round trip + Protomaps fetch), and
# the map feels glitchy as 20-50 tiles slowly populate the viewport.

import asyncio
from collections import OrderedDict

_TILE_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)
_tile_client: Optional[httpx.AsyncClient] = None

# LRU cache: ~2000 tiles × ~30KB avg = ~60MB RAM. Tiles change on weekly
# Protomaps builds, so a 24h TTL is more than sufficient.
_TILE_LRU_MAX = 2000
_tile_lru: "OrderedDict[tuple, bytes]" = OrderedDict()
_tile_lru_lock = asyncio.Lock()

# Glyphs only need ~12 unique entries (3 fontstacks × 4 ranges), keep all forever
_font_lru: "dict[tuple, bytes]" = {}
_font_lru_lock = asyncio.Lock()


def _get_tile_client() -> httpx.AsyncClient:
    global _tile_client
    if _tile_client is None or _tile_client.is_closed:
        # http2 + keepalive shaves another ~100ms off cache misses on warm conns
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=50,
                               keepalive_expiry=300.0)
        _tile_client = httpx.AsyncClient(timeout=_TILE_TIMEOUT, http2=False, limits=limits)
    return _tile_client


_TILE_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=86400",
    # Fastly-specific: forces CDN edge caching independent of browser cache
    "Surrogate-Control": "public, max-age=86400",
}


PROTOMAPS_MAXZOOM = 15  # tiles v4 schema cap


from dashboard import pmtiles_bootstrap


@app.on_event("startup")
async def _bootstrap_pmtiles():
    """Kick off the US PMTiles extract in the background. Tiles serve from
    Protomaps API until the local file is ready."""
    asyncio.create_task(pmtiles_bootstrap.ensure_us_pmtiles())


@app.get("/api/admin/pmtiles-status")
def pmtiles_status():
    return pmtiles_bootstrap.status()


@app.get("/api/admin/pmtiles-leaf-test")
async def pmtiles_leaf_test():
    """Inspect the first leaf dir and look up tile 35144 (z=8/60/97)."""
    from dashboard.pmtiles_bootstrap import PMTILES_PATH
    if not PMTILES_PATH.exists():
        return {"error": "file missing"}
    try:
        import pmtiles.tile as pmt, inspect, gzip
        members = dict(inspect.getmembers(pmt, inspect.isfunction))
        deser = members.get('deserialize_directory') or members.get('deserialize_entries')
        def u64(b, o): return int.from_bytes(b[o:o+8], "little")
        with open(PMTILES_PATH, "rb") as f:
            hdr = f.read(127)
        ldo = u64(hdr, 40)  # leaf_dirs_offset
        # Read the first leaf dir (offset=0, len=10291)
        with open(PMTILES_PATH, "rb") as f:
            f.seek(ldo + 0); leaf_compressed = f.read(10291)
        entries = deser(leaf_compressed)
        def e2d(e): return {"tid": getattr(e,'tile_id',0), "rl": getattr(e,'run_length',0),
                            "len": getattr(e,'length',0), "off": getattr(e,'offset',0)}
        # Find entry for tile 35144
        target = 35144
        found = None
        for i, e in enumerate(entries):
            tid = getattr(e,'tile_id',0)
            rl = getattr(e,'run_length',0)
            if tid <= target < tid + max(rl,1):
                found = {"idx": i, **e2d(e)}
                break
            if tid > target:
                break
        return {"leaf0_num_entries": len(entries),
                "first_5": [e2d(e) for e in entries[:5]],
                "last_5": [e2d(e) for e in entries[-5:]],
                "tile_35144_entry": found}
    except Exception as ex:
        import traceback
        return {"error": str(ex), "trace": traceback.format_exc()[-600:]}


@app.get("/api/admin/pmtiles-entries")
async def pmtiles_entries():
    """Dump root directory entries via official pmtiles library (compressed bytes passed directly)."""
    from dashboard.pmtiles_bootstrap import PMTILES_PATH
    if not PMTILES_PATH.exists():
        return {"error": "file missing"}
    try:
        import pmtiles.tile as pmt
        import inspect
        members = dict(inspect.getmembers(pmt, inspect.isfunction))
        deser = members.get('deserialize_directory') or members.get('deserialize_entries')
        if not deser:
            return {"error": "no deserializer", "funcs": list(members.keys())}
        def u64(b, o): return int.from_bytes(b[o:o+8], "little")
        with open(PMTILES_PATH, "rb") as f:
            hdr = f.read(127)
            rdo = u64(hdr, 8); rdl = u64(hdr, 16)
            f.seek(rdo); root_compressed = f.read(rdl)
        entries = deser(root_compressed)  # library handles decompression internally
        # Check entry type
        sample = entries[0]
        attr = 'tile_id' if hasattr(sample, 'tile_id') else list(vars(sample).keys())[0]
        def e2d(e): return {"tid": getattr(e,'tile_id',0), "rl": getattr(e,'run_length',0),
                            "len": getattr(e,'length',0), "off": getattr(e,'offset',0)}
        return {"num": len(entries), "first_20": [e2d(e) for e in entries[:20]],
                "entry_attrs": list(vars(sample).keys()) if hasattr(sample,'__dict__') else str(type(sample))}
    except Exception as e:
        import traceback
        return {"error": str(e), "trace": traceback.format_exc()[-800:]}


@app.get("/api/admin/pmtiles-raw-root")
async def pmtiles_raw_root():
    """Return the root directory bytes (gzip compressed, base64) for JS decoder testing."""
    import base64
    from dashboard.pmtiles_bootstrap import PMTILES_PATH
    if not PMTILES_PATH.exists():
        return {"error": "file missing"}
    with open(PMTILES_PATH, "rb") as f:
        header = f.read(127)
    def u64(b, o): return int.from_bytes(b[o:o+8], "little")
    rdo = u64(header, 8); rdl = u64(header, 16)
    with open(PMTILES_PATH, "rb") as f:
        f.seek(rdo); root_compressed = f.read(rdl)
    import gzip
    root_raw = gzip.decompress(root_compressed)
    # Read first 20 entries to show structure
    import io
    def read_varint(data, pos):
        result, shift = 0, 0
        while True:
            b = data[pos]; pos += 1
            result += (b & 127) * (2 ** shift); shift += 7
            if not (b & 128): break
        return result, pos
    pos = 0; n, pos = read_varint(root_raw, pos)
    entries = []; li=ll=lo=0
    for _ in range(min(n, 30)):
        di, pos = read_varint(root_raw, pos)
        rl, pos = read_varint(root_raw, pos)
        dl, pos = read_varint(root_raw, pos)
        od, pos = read_varint(root_raw, pos)
        tid = li + di; length = ll + dl
        off = lo + ll if od == 0 else lo + od
        li=tid; ll=length; lo=off
        entries.append({"tid": tid, "rl": rl, "len": length, "off": off})
    return {"num_entries": n, "root_dir_length_compressed": rdl,
            "root_dir_length_raw": len(root_raw), "first_30": entries,
            "tdo": u64(header, 56)}


@app.get("/api/admin/pmtiles-debug")
async def pmtiles_debug():
    """Read and decode the PMTiles header so we can verify the Worker's decoder."""
    from dashboard.pmtiles_bootstrap import PMTILES_PATH
    if not PMTILES_PATH.exists():
        return {"error": "file missing"}
    with open(PMTILES_PATH, "rb") as f:
        header = f.read(127)
    if len(header) < 127 or header[:7] != b"PMTiles":
        return {"error": "bad magic", "got": header[:8].hex()}
    def u64(b, off):
        lo = int.from_bytes(b[off:off+4], "little")
        hi = int.from_bytes(b[off+4:off+8], "little")
        return hi * (2**32) + lo
    h = {
        "version": header[7],
        "root_dir_offset": u64(header, 8),
        "root_dir_length": u64(header, 16),
        "leaf_dir_offset": u64(header, 40),
        "leaf_dir_length": u64(header, 48),
        "tile_data_offset": u64(header, 56),
        "tile_data_length": u64(header, 64),
        "min_zoom": header[100],
        "max_zoom": header[101],
        "tile_type": header[99],
        "internal_compression": header[97],
        "tile_compression": header[98],
    }
    # Also test the Python pmtiles reader lookup for a known Kansas tile
    reader = pmtiles_bootstrap._open_reader()
    test_result = None
    if reader:
        try:
            tile = await asyncio.to_thread(reader.get, 8, 60, 97)
            test_result = len(tile) if tile else "not_found"
        except Exception as e:
            test_result = f"error: {e}"
    h["python_tile_z8_x60_y97"] = test_result
    return h


@app.post("/api/admin/pmtiles-retry")
async def pmtiles_retry():
    """Re-trigger the extract task."""
    asyncio.create_task(pmtiles_bootstrap.ensure_us_pmtiles())
    return {"triggered": True, "status": pmtiles_bootstrap.status()}


# ── Per-state PMTiles extraction ───────────────────────────────────────────────
from dashboard import pmtiles_states as _pms

@app.get("/api/admin/states-status")
async def states_status():
    """Status of all per-state PMTiles extractions."""
    return {"running": _pms._running, "states": _pms.all_status()}

@app.post("/api/admin/extract-state/{code}")
async def extract_single_state(code: str):
    """Extract + upload a single state (e.g. UT, CO). Runs in background."""
    code = code.upper()
    if code not in _pms.STATE_BBOXES:
        return {"error": f"unknown state code {code}"}
    asyncio.create_task(_pms.extract_and_upload_state(code))
    return {"triggered": True, "code": code}

@app.post("/api/admin/extract-all-states")
async def extract_all_states():
    """Queue extraction + upload for all 50 states. Runs sequentially in background."""
    if _pms._running:
        return {"triggered": False, "reason": "already running"}
    asyncio.create_task(_pms.extract_all_states_task())
    return {"triggered": True, "total": len(_pms.STATE_BBOXES)}

@app.get("/api/admin/offline-regions-status")
async def offline_regions_status():
    """Status of Canada/Mexico PMTiles extraction."""
    return {"regions": _pms.all_region_status()}

@app.post("/api/admin/extract-region/{code}")
async def extract_single_region(code: str):
    """Extract + upload a country/large region such as CANADA or MEXICO."""
    code = code.upper()
    if code not in _pms.REGION_BBOXES:
        return {"error": f"unknown region code {code}"}
    asyncio.create_task(_pms.extract_and_upload_region(code))
    return {"triggered": True, "code": code}

@app.post("/api/admin/extract-canada-mexico")
async def extract_canada_mexico():
    """Queue Canada and Mexico PMTiles extraction/upload sequentially."""
    asyncio.create_task(_pms.extract_regions_task(["MEXICO", "CANADA"]))
    return {"triggered": True, "regions": ["MEXICO", "CANADA"]}

@app.post("/api/admin/update-manifest")
async def update_manifest():
    """Rewrite manifest.json on R2 with current file sizes."""
    ok = await _pms.update_manifest_on_r2()
    return {"ok": ok}


@app.get("/api/admin/base-status")
def base_status():
    """Status of the z0–z9 CONUS base layer."""
    return _pms.base_status()


@app.api_route("/api/admin/generate-base", methods=["GET", "POST"])
async def generate_base():
    """Extract z0–z9 CONUS tiles and upload to R2 as base.pmtiles.
    Runs in the background; poll /api/admin/base-status for progress."""
    if _pms._base_status.get("status") in ("extracting", "uploading"):
        return {"triggered": False, "reason": "already running"}
    asyncio.create_task(_pms.generate_and_upload_base())
    return {"triggered": True}


# ── Per-state Valhalla routing packs ──────────────────────────────────────────
from dashboard import valhalla_packs as _vhp

@app.get("/api/admin/routing-packs-status")
async def routing_packs_status():
    return {
        "running": _vhp._running,
        "tools": _vhp.tool_status(),
        "order": _vhp.ordered_codes(),
        "states": _vhp.all_status(),
    }

@app.api_route("/api/admin/build-routing-pack/{code}", methods=["GET", "POST"])
async def build_routing_pack(code: str, force: bool = False):
    code = code.upper()
    if code not in _vhp.ALL_REGION_CODES:
        return {"error": f"unknown routing region code {code}"}
    if _vhp.is_state_running(code):
        return {"triggered": False, "code": code, "reason": "already running"}
    if _vhp.is_state_built(code) and not force:
        return {"triggered": False, "code": code, "reason": "already built"}
    remote_size = await _vhp.remote_pack_size(code) if not force else None
    if remote_size:
        return {"triggered": False, "code": code, "reason": "already uploaded", "size_bytes": remote_size}
    asyncio.create_task(_vhp.build_and_upload_pack(code, force=force))
    return {"triggered": True, "code": code, "force": force}

@app.post("/api/admin/build-all-routing-packs")
async def build_all_routing_packs():
    if _vhp._running:
        return {"triggered": False, "reason": "already running"}
    asyncio.create_task(_vhp.build_all_task())
    return {"triggered": True, "total": len(_pms.STATE_BBOXES), "order": _vhp.ordered_codes()}

@app.post("/api/admin/build-canada-mexico-routing")
async def build_canada_mexico_routing():
    if _vhp._running:
        return {"triggered": False, "reason": "already running"}
    asyncio.create_task(_vhp.build_all_task(["MEXICO", "CANADA"]))
    return {"triggered": True, "regions": ["MEXICO", "CANADA"]}

@app.post("/api/admin/update-routing-manifest")
async def update_routing_manifest():
    ok = await _vhp.update_routing_manifest_on_r2()
    return {"ok": ok}


# ── Offline place packs ───────────────────────────────────────────────────────
from dashboard import place_packs as _place_packs

@app.get("/api/admin/place-packs-status")
async def place_packs_status():
    return _place_packs.status()

@app.post("/api/admin/build-place-pack/{region}/{pack_id}")
async def build_place_pack(region: str, pack_id: str = "essentials"):
    if _place_packs._running:
        return {"triggered": False, "reason": "already running"}
    asyncio.create_task(_place_packs.build_and_upload(region, pack_id))
    return {"triggered": True, "region": region.lower(), "pack_id": pack_id.lower()}

@app.post("/api/admin/build-all-place-packs")
async def build_all_place_packs(skip_existing: bool = True):
    if _place_packs._running:
        return {"triggered": False, "reason": "already running"}
    pack_ids = list(_place_packs.PACK_DEFINITIONS.keys())
    regions = _place_packs.ordered_regions()
    asyncio.create_task(_place_packs.build_all_task(regions, pack_ids, skip_existing=skip_existing))
    return {"triggered": True, "regions": len(regions), "packs": pack_ids, "skip_existing": skip_existing}

@app.post("/api/admin/update-place-packs-manifest")
async def update_place_packs_manifest():
    ok = await _place_packs.update_manifest_on_r2()
    return {"ok": ok}


# ── R2 upload ─────────────────────────────────────────────────────────────────
_r2_upload_status: dict = {"running": False, "done": False, "error": None, "progress": ""}


@app.get("/api/admin/r2-status")
def r2_upload_status():
    from dashboard.pmtiles_bootstrap import PMTILES_PATH
    return {
        **_r2_upload_status,
        "source_size_mb": round(PMTILES_PATH.stat().st_size / 1_000_000, 1) if PMTILES_PATH.exists() else 0,
    }


@app.post("/api/admin/r2-upload")
async def trigger_r2_upload():
    """Stream /data/us.pmtiles to Cloudflare R2 via S3 multipart upload.
    Safe to call multiple times — skips if already done or running."""
    if _r2_upload_status["running"]:
        return {"triggered": False, "reason": "already running", **_r2_upload_status}
    if _r2_upload_status["done"]:
        return {"triggered": False, "reason": "already done", **_r2_upload_status}
    asyncio.create_task(_run_r2_upload())
    return {"triggered": True}


async def _run_r2_upload():
    import boto3
    from botocore.config import Config
    from dashboard.pmtiles_bootstrap import PMTILES_PATH
    import time as _t

    _r2_upload_status.update(running=True, done=False, error=None, progress="starting")
    try:
        r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )

        file_size = PMTILES_PATH.stat().st_size
        part_size = 256 * 1024 * 1024  # 256 MB parts — R2 handles large multipart fine
        start = _t.time()

        mpu = await asyncio.to_thread(
            r2.create_multipart_upload, Bucket=settings.r2_bucket, Key="us.pmtiles",
            ContentType="application/vnd.pmtiles",
        )
        upload_id = mpu["UploadId"]
        parts = []

        with open(PMTILES_PATH, "rb") as fh:
            part_num = 1
            while True:
                chunk = fh.read(part_size)
                if not chunk:
                    break
                resp = await asyncio.to_thread(
                    r2.upload_part,
                    Bucket=settings.r2_bucket, Key="us.pmtiles",
                    UploadId=upload_id, PartNumber=part_num, Body=chunk,
                )
                parts.append({"PartNumber": part_num, "ETag": resp["ETag"]})
                uploaded_mb = round(fh.tell() / 1_000_000, 0)
                total_mb = round(file_size / 1_000_000, 0)
                elapsed = int(_t.time() - start)
                _r2_upload_status["progress"] = f"{uploaded_mb:.0f}/{total_mb:.0f} MB  {elapsed}s"
                part_num += 1

        await asyncio.to_thread(
            r2.complete_multipart_upload,
            Bucket=settings.r2_bucket, Key="us.pmtiles",
            MultipartUpload={"Parts": parts}, UploadId=upload_id,
        )
        _r2_upload_status.update(done=True, progress=f"complete — {round(file_size/1_000_000, 0):.0f} MB uploaded")
    except Exception as e:
        _r2_upload_status["error"] = f"{type(e).__name__}: {e}"
        try:
            await asyncio.to_thread(r2.abort_multipart_upload,
                                    Bucket=settings.r2_bucket, Key="us.pmtiles", UploadId=upload_id)
        except Exception:
            pass
    finally:
        _r2_upload_status["running"] = False


@app.get("/api/tiles/{z}/{x}/{y}.pbf")
async def proxy_vector_tile(z: int, x: int, y: int):
    """Vector tile endpoint. Serves from local PMTiles file when available
    (fast path, ~5ms), falls back to the Protomaps API while the local file
    is being extracted on first deploy.

    For z > 15 (Protomaps maxzoom), serve the parent z15 tile so MapLibre's
    over-zoom rendering works. Without this, MapLibre's z16+ requests hit a
    400 error and the map appears to stop loading when the user zooms in.
    """
    if z < 0 or x < 0 or y < 0 or z > 22:
        raise HTTPException(400, "invalid tile coords")

    # Map any z>15 request back to its z15 parent — same data, MapLibre stretches
    if z > PROTOMAPS_MAXZOOM:
        shift = z - PROTOMAPS_MAXZOOM
        upstream_z, upstream_x, upstream_y = PROTOMAPS_MAXZOOM, x >> shift, y >> shift
    else:
        upstream_z, upstream_x, upstream_y = z, x, y

    key = (upstream_z, upstream_x, upstream_y)

    # Layer 1: RAM cache (keyed by upstream coords so over-zoom requests dedupe)
    async with _tile_lru_lock:
        hit = _tile_lru.get(key)
        if hit is not None:
            _tile_lru.move_to_end(key)
            return Response(hit, media_type="application/vnd.mapbox-vector-tile",
                            headers=_TILE_CACHE_HEADERS)

    # Layer 2: local self-hosted PMTiles file (preferred)
    local_tile = await pmtiles_bootstrap.get_local_tile(upstream_z, upstream_x, upstream_y)
    if local_tile is not None:
        async with _tile_lru_lock:
            _tile_lru[key] = local_tile
            if len(_tile_lru) > _TILE_LRU_MAX:
                _tile_lru.popitem(last=False)
        return Response(local_tile, media_type="application/vnd.mapbox-vector-tile",
                        headers=_TILE_CACHE_HEADERS)

    # Layer 3: upstream Protomaps API (fallback during extract)
    if not settings.protomaps_key:
        raise HTTPException(503, "vector tiles not configured")
    url = f"https://api.protomaps.com/tiles/v4/{upstream_z}/{upstream_x}/{upstream_y}.mvt?key={settings.protomaps_key}"
    try:
        r = await _get_tile_client().get(url)
    except httpx.HTTPError:
        raise HTTPException(504, "tile upstream timeout")
    if r.status_code == 404:
        content = b""  # cache empty tiles too — outside-coverage areas are common
    elif r.status_code != 200:
        raise HTTPException(r.status_code, "tile upstream error")
    else:
        content = r.content

    # Populate LRU
    async with _tile_lru_lock:
        _tile_lru[key] = content
        if len(_tile_lru) > _TILE_LRU_MAX:
            _tile_lru.popitem(last=False)

    return Response(content, media_type="application/vnd.mapbox-vector-tile",
                    headers=_TILE_CACHE_HEADERS)


@app.get("/api/fonts/{fontstack}/{range_str}.pbf")
async def proxy_font(fontstack: str, range_str: str):
    """Glyph (font PBF) proxy — needed for offline label rendering."""
    # Validate fontstack to prevent SSRF — only allow known Protomaps font names
    allowed = {"Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic", "Noto Sans Medium"}
    fonts = [f.strip() for f in fontstack.split(",")]
    if not all(f in allowed for f in fonts):
        raise HTTPException(400, "unknown fontstack")
    if not range_str.replace("-", "").isdigit():
        raise HTTPException(400, "invalid range")

    key = (fontstack, range_str)
    async with _font_lru_lock:
        hit = _font_lru.get(key)
        if hit is not None:
            return Response(hit, media_type="application/x-protobuf",
                            headers={"Cache-Control": "public, max-age=604800",
                                     "Surrogate-Control": "public, max-age=604800"})

    from urllib.parse import quote
    url = f"https://protomaps.github.io/basemaps-assets/fonts/{quote(fontstack)}/{range_str}.pbf"
    try:
        r = await _get_tile_client().get(url)
    except httpx.HTTPError:
        raise HTTPException(504, "font upstream timeout")
    if r.status_code != 200:
        raise HTTPException(r.status_code, "font upstream error")

    async with _font_lru_lock:
        _font_lru[key] = r.content

    return Response(r.content, media_type="application/x-protobuf",
                    headers={"Cache-Control": "public, max-age=604800",
                             "Surrogate-Control": "public, max-age=604800"})


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
    ridb, blm = await asyncio.gather(
        get_campsites_search(lat, lng, radius_miles=radius, type_filters=type_filters),
        get_blm_campsites(lat, lng, radius_miles=radius),
    )
    return _merge_camp_sources(ridb, blm, type_filters=type_filters)[:80]

@app.get("/api/campsites/{facility_id}/detail")
async def campsite_detail(facility_id: str):
    if facility_id.startswith("osm_"):
        detail = await get_osm_campsite_detail(facility_id)
    elif facility_id.startswith("blm_"):
        detail = await get_blm_campsite_detail(facility_id)
    else:
        detail = await get_facility_detail(facility_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Facility not found")
    override = get_camp_profile_override(facility_id)
    if override:
        detail = {**detail, **override, "admin_edited": True}
    return detail

class CampEditSuggestionPayload(BaseModel):
    camp_name: str
    lat: float
    lng: float
    field: str
    value: str
    note: Optional[str] = None

@app.post("/api/campsites/{facility_id}/suggest-edit")
async def suggest_camp_edit(facility_id: str, body: CampEditSuggestionPayload,
                            user: dict = Depends(_current_user)):
    allowed = {"profile", "name", "description", "amenities", "site_types", "activities", "cost", "phone", "url", "access", "notes"}
    field = (body.field or "").strip().lower()
    if field not in allowed:
        raise HTTPException(400, "Invalid edit field")
    value = (body.value or "").strip()
    if not value:
        raise HTTPException(400, "Suggested value is required")
    if len(value) > 8000:
        raise HTTPException(400, "Suggested value is too long")
    result = add_camp_edit_suggestion(
        facility_id, body.camp_name.strip()[:160], body.lat, body.lng,
        user.get("id"), user.get("username"), field, value, (body.note or "").strip()[:500] or None
    )
    add_credits(user["id"], 3, f"Camp edit suggestion: {body.camp_name[:80]}")
    fresh = get_user_by_id(user["id"])
    return {**result, "credits_earned": 3, "new_balance": fresh["credits"] if fresh else user.get("credits", 0)}

class CampAdminUpdatePayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    amenities: Optional[list[str]] = None
    site_types: Optional[list[str]] = None
    activities: Optional[list[str]] = None
    cost: Optional[str] = None
    phone: Optional[str] = None
    url: Optional[str] = None

@app.post("/api/admin/campsites/{facility_id}")
async def admin_update_camp_detail(facility_id: str, body: CampAdminUpdatePayload,
                                   user: dict = Depends(_current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    raw = body.dict(exclude_unset=True)
    clean: dict = {}
    for key, val in raw.items():
        if isinstance(val, str):
            clean[key] = val.strip()[:4000]
        elif isinstance(val, list):
            clean[key] = [str(x).strip()[:80] for x in val if str(x).strip()][:40]
    return {"ok": True, "override": set_camp_profile_override(facility_id, clean, user.get("id"))}

@app.get("/api/admin/camp-edit-suggestions")
async def admin_camp_edit_suggestions(status: Optional[str] = "pending",
                                      admin: dict = Depends(_require_admin)):
    return get_camp_edit_suggestions(status if status else None, limit=200)

@app.post("/api/admin/camp-edit-suggestions/{suggestion_id}/status")
async def admin_camp_edit_suggestion_status(suggestion_id: int, body: dict,
                                            admin: dict = Depends(_require_admin)):
    status = str(body.get("status", "")).strip().lower()
    if status not in {"pending", "applied", "dismissed"}:
        raise HTTPException(400, "Invalid status")
    if not update_camp_edit_suggestion_status(suggestion_id, status):
        raise HTTPException(404, "Suggestion not found")
    return {"ok": True}

@app.get("/api/gas")
async def gas(lat: float, lng: float, radius: float = 25):
    from ingestors.nrel import get_fuel_near
    osm_radius_m = int(min(max(radius, 1), 25) * 1609.344)
    nrel, osm = await asyncio.gather(
        get_fuel_near(lat, lng, radius_miles=radius),
        get_fuel_stations(lat, lng, radius_m=osm_radius_m),
        return_exceptions=True,
    )
    merged: list[dict] = []
    seen = set()
    for batch in (nrel if isinstance(nrel, list) else [], osm if isinstance(osm, list) else []):
        for item in batch:
            item_id = str(item.get("id") or "")
            key = item_id or f"{item.get('name')}:{float(item.get('lat', 0)):.4f}:{float(item.get('lng', 0)):.4f}"
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
    return merged[:100]


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


# ── Camp Field Reports ──────────────────────────────────────────────────────────

class FieldReportPayload(BaseModel):
    camp_name: str
    lat: float
    lng: float
    rig_label: Optional[str] = None
    visited_date: str
    sentiment: str        # loved_it | its_ok | would_skip
    access_condition: str # easy | rough | four_wd_required
    crowd_level: str      # empty | few_rigs | packed
    tags: list[str] = []
    note: Optional[str] = None
    photo_data: Optional[str] = None

@app.post("/api/camps/{camp_id}/field-report")
async def post_field_report(camp_id: str, body: FieldReportPayload,
                             user: dict = Depends(_current_user)):
    valid_sentiments = {'loved_it', 'its_ok', 'would_skip'}
    valid_access = {'easy', 'rough', 'four_wd_required'}
    valid_crowd = {'empty', 'few_rigs', 'packed'}
    if body.sentiment not in valid_sentiments:
        raise HTTPException(400, "Invalid sentiment")
    if body.access_condition not in valid_access:
        raise HTTPException(400, "Invalid access_condition")
    if body.crowd_level not in valid_crowd:
        raise HTTPException(400, "Invalid crowd_level")
    result = submit_field_report(
        camp_id=camp_id, camp_name=body.camp_name,
        lat=body.lat, lng=body.lng,
        user_id=user["id"], username=user["username"],
        rig_label=body.rig_label,
        visited_date=body.visited_date,
        sentiment=body.sentiment, access_condition=body.access_condition,
        crowd_level=body.crowd_level, tags=body.tags,
        note=body.note, photo_data=body.photo_data,
    )
    fresh = get_user_by_id(user["id"])
    return {**result, "new_balance": fresh["credits"]}

@app.get("/api/camps/{camp_id}/field-reports")
async def get_camp_field_reports(camp_id: str):
    return get_field_reports(camp_id)

@app.get("/api/camps/{camp_id}/field-report-summary")
async def get_camp_field_report_summary(camp_id: str):
    return get_field_report_summary(camp_id)


# ── Trail Profiles / Discovery ────────────────────────────────────────────────

def _clean_trail_profile_id(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.:-]", "", value or "")[:180]

def _trail_profile_from_open_poi(item: dict) -> dict | None:
    lat, lng = item.get("lat"), item.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    kind = str(item.get("type") or "trailhead")
    source_id = str(item.get("id") or f"{kind}_{float(lat):.5f}_{float(lng):.5f}")
    trail_id = _clean_trail_profile_id(f"osm:{source_id}") or hashlib.sha1(source_id.encode()).hexdigest()
    name = str(item.get("name") or {
        "trail": "Trail",
        "trailhead": "Trailhead",
        "viewpoint": "Viewpoint",
        "peak": "Peak",
        "hot_spring": "Hot Spring",
    }.get(kind, "Trail"))
    if re.search(r"\bgrade[1-5]\b", name, re.I):
        name = "Mapped rough track" if re.search(r"\bgrade[45]\b", name, re.I) else "Mapped backroad"
    summary = {
        "trail": "Mapped trail route with nearby support context from Trailhead.",
        "trailhead": "Mapped trail access point with nearby support context from Trailhead.",
        "viewpoint": "Mapped viewpoint that can anchor a trail scouting route.",
        "peak": "Mapped peak or summit feature for route scouting.",
        "hot_spring": "Mapped hot spring or public bath feature near trails.",
    }.get(kind, "Open-source trail feature with Trailhead scouting context.")
    now = int(time.time())
    official_url = str(item.get("url") or "")
    if not official_url and source_id.startswith("osm_"):
        parts = source_id.split("_")
        if len(parts) >= 3:
            official_url = f"https://www.openstreetmap.org/{parts[1]}/{parts[2]}"
    provenance = {
        "name": {"source": "OpenStreetMap", "last_checked": now},
        "location": {"source": "OpenStreetMap", "last_checked": now},
        "summary": {"source": "Trailhead generated from open-source tags", "last_checked": now},
        "activities": {"source": "Trailhead inference", "last_checked": now},
    }
    return {
        "id": trail_id,
        "name": name[:180],
        "summary": summary,
        "description": f"{summary} Verify current access, difficulty, closures, and legality with the land manager before relying on this trail profile.",
        "lat": float(lat),
        "lng": float(lng),
        "length_mi": None,
        "difficulty": "Scout first",
        "activities": ["Overlanding", "Hiking"] if kind in {"trail", "trailhead", "viewpoint", "peak"} else ["Overlanding"],
        "land_manager": "",
        "geometry": None,
        "trailheads": [{"name": name, "lat": float(lat), "lng": float(lng), "source": "OpenStreetMap"}],
        "official_url": official_url,
        "photos": [],
        "source": "osm",
        "source_label": "OpenStreetMap",
        "provenance": provenance,
        "last_checked": now,
    }

async def _open_trail_photos(name: str, lat: float, lng: float) -> list[dict]:
    clean = re.sub(r"\s+", " ", (name or "").strip())
    if not clean or clean.lower() in {"trail", "trailhead", "mapped trail", "mapped rough track", "mapped backroad"}:
        return []
    cache_key = f"trail_photo_wiki_{hashlib.sha1(f'{clean}:{lat:.3f}:{lng:.3f}'.encode()).hexdigest()[:16]}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24 * 30)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(timeout=7.0, headers={"User-Agent": "TrailheadTrailDiscovery/1.0"}) as client:
            search = await client.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "format": "json",
                    "generator": "search",
                    "gsrsearch": f'"{clean}" trail',
                    "gsrlimit": 3,
                    "prop": "pageimages|info",
                    "piprop": "original|thumbnail",
                    "pithumbsize": 900,
                    "inprop": "url",
                    "origin": "*",
                },
            )
            pages = (search.json().get("query") or {}).get("pages") or {}
            for page in sorted(pages.values(), key=lambda p: p.get("index", 99)):
                title = str(page.get("title") or "")
                title_norm = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
                name_norm = re.sub(r"[^a-z0-9]+", " ", clean.lower()).strip()
                if name_norm and name_norm not in title_norm and title_norm not in name_norm:
                    continue
                url = (page.get("original") or {}).get("source") or (page.get("thumbnail") or {}).get("source")
                if not url:
                    continue
                photos = [{
                    "url": url,
                    "caption": title,
                    "credit": "Wikipedia / Wikimedia Commons",
                    "source": "Wikipedia",
                }]
                set_cached("campsite_cache", cache_key, photos)
                return photos
    except Exception:
        pass
    set_cached("campsite_cache", cache_key, [])
    return []

async def _seed_open_trail_profiles(lat: float, lng: float, radius_mi: float, limit: int = 80) -> list[dict]:
    radius_m = int(max(3, min(radius_mi, 80)) * 1609.344)
    batches = await asyncio.gather(
        get_trails(lat, lng, radius_m=radius_m),
        get_trailheads(lat, lng, radius_m=radius_m),
        get_viewpoints(lat, lng, radius_m=radius_m),
        get_peaks(lat, lng, radius_m=radius_m),
        get_hot_springs(lat, lng, radius_m=radius_m),
        return_exceptions=True,
    )
    profiles: list[dict] = []
    seen: set[str] = set()
    for batch in batches:
        if not isinstance(batch, list):
            continue
        for item in batch:
            profile = _trail_profile_from_open_poi(item)
            if not profile or profile["id"] in seen:
                continue
            photos = await _open_trail_photos(profile["name"], profile["lat"], profile["lng"])
            if photos:
                profile["photos"] = photos
                profile["provenance"]["photos"] = {"source": "Wikipedia / Wikimedia Commons", "last_checked": profile["last_checked"]}
            seen.add(profile["id"])
            profiles.append(upsert_trail_profile(profile))
            if len(profiles) >= limit:
                return profiles
    return profiles

@app.get("/api/trails/discover")
async def trails_discover(
    lat: float | None = None,
    lng: float | None = None,
    radius: float = 45,
    n: float | None = None,
    s: float | None = None,
    e: float | None = None,
    w: float | None = None,
    mode: str = "nearby",
    limit: int = 60,
):
    mode = "view" if mode == "view" else "nearby"
    bbox = None
    if mode == "view" and None not in (n, s, e, w):
        bbox = {"n": float(n), "s": float(s), "e": float(e), "w": float(w)}
        lat = (bbox["n"] + bbox["s"]) / 2
        lng = (bbox["e"] + bbox["w"]) / 2
        radius = max(3, min(80, max(abs(bbox["n"] - bbox["s"]) * 69, abs(bbox["e"] - bbox["w"]) * 69) / 2 + 3))
    if lat is None or lng is None:
        raise HTTPException(400, "lat/lng or n/s/e/w bounds are required")
    await _seed_open_trail_profiles(float(lat), float(lng), radius, limit=max(limit, 80))
    trails = list_trail_profiles_near(float(lat), float(lng), radius, max(1, min(limit, 100)), bbox=bbox, mode=mode)
    return {
        "mode": mode,
        "source": "online-open-official-first",
        "offline": False,
        "trails": trails,
    }

@app.get("/api/trails/{trail_id}")
async def trail_profile(trail_id: str):
    profile = get_trail_profile(_clean_trail_profile_id(trail_id))
    if not profile:
        raise HTTPException(404, "Trail profile not found")
    profile["field_report_summary"] = get_trail_field_report_summary(profile["id"])
    return profile

class TrailEditSuggestionPayload(BaseModel):
    trail_name: str
    field: str
    value: str
    note: Optional[str] = None

@app.post("/api/trails/{trail_id}/suggest-edit")
async def suggest_trail_edit(trail_id: str, body: TrailEditSuggestionPayload,
                             user: dict = Depends(_current_user)):
    allowed = {"name", "summary", "description", "length_mi", "difficulty", "activities", "land_manager", "official_url", "trailheads", "geometry", "photos", "access", "notes"}
    clean_id = _clean_trail_profile_id(trail_id)
    if not clean_id:
        raise HTTPException(400, "Invalid trail id")
    field = (body.field or "").strip().lower()
    if field not in allowed:
        raise HTTPException(400, "Invalid edit field")
    value = (body.value or "").strip()
    if not value:
        raise HTTPException(400, "Suggested value is required")
    result = add_trail_edit_suggestion(clean_id, body.trail_name.strip()[:180] or "Trail",
                                       user.get("id"), user.get("username"), field, value,
                                       (body.note or "").strip()[:500] or None)
    add_credits(user["id"], 3, f"Trail edit suggestion: {(body.trail_name or clean_id)[:80]}")
    fresh = get_user_by_id(user["id"])
    return {**result, "credits_earned": 3, "new_balance": fresh["credits"] if fresh else user.get("credits", 0)}

class TrailAdminUpdatePayload(BaseModel):
    name: Optional[str] = None
    summary: Optional[str] = None
    description: Optional[str] = None
    length_mi: Optional[float] = None
    difficulty: Optional[str] = None
    activities: Optional[list[str]] = None
    land_manager: Optional[str] = None
    geometry: Optional[dict] = None
    trailheads: Optional[list[dict]] = None
    official_url: Optional[str] = None
    photos: Optional[list[dict]] = None

@app.post("/api/admin/trails/{trail_id}")
async def admin_update_trail(trail_id: str, body: TrailAdminUpdatePayload,
                             admin: dict = Depends(_require_admin)):
    raw = body.dict(exclude_unset=True)
    clean: dict = {}
    for key, val in raw.items():
        if isinstance(val, str):
            clean[key] = val.strip()[:6000]
        elif isinstance(val, list):
            clean[key] = val[:80]
        elif isinstance(val, dict):
            clean[key] = val
        elif isinstance(val, (int, float)):
            clean[key] = val
    try:
        profile = set_trail_profile_admin_update(_clean_trail_profile_id(trail_id), clean, admin.get("id"))
    except KeyError:
        raise HTTPException(404, "Trail profile not found")
    return {"ok": True, "profile": profile}

@app.get("/api/admin/trail-edit-suggestions")
async def admin_trail_edit_suggestions(status: Optional[str] = "pending",
                                       admin: dict = Depends(_require_admin)):
    return get_trail_edit_suggestions(status if status else None, limit=200)

@app.post("/api/admin/trail-edit-suggestions/{suggestion_id}/status")
async def admin_trail_edit_suggestion_status(suggestion_id: int, body: dict,
                                             admin: dict = Depends(_require_admin)):
    status = str(body.get("status", "")).strip().lower()
    if status not in {"pending", "applied", "dismissed"}:
        raise HTTPException(400, "Invalid status")
    if not update_trail_edit_suggestion_status(suggestion_id, status):
        raise HTTPException(404, "Suggestion not found")
    return {"ok": True}


# ── Trail Field Reports ───────────────────────────────────────────────────────

class TrailFieldReportPayload(BaseModel):
    trail_name: str
    lat: float
    lng: float
    rig_label: Optional[str] = None
    visited_date: str
    sentiment: str
    access_condition: str
    crowd_level: str
    tags: list[str] = []
    note: Optional[str] = None
    photo_data: Optional[str] = None

def _validate_field_report(body: FieldReportPayload):
    valid_sentiments = {'loved_it', 'its_ok', 'would_skip'}
    valid_access = {'easy', 'rough', 'four_wd_required'}
    valid_crowd = {'empty', 'few_rigs', 'packed'}
    if body.sentiment not in valid_sentiments:
        raise HTTPException(400, "Invalid sentiment")
    if body.access_condition not in valid_access:
        raise HTTPException(400, "Invalid access_condition")
    if body.crowd_level not in valid_crowd:
        raise HTTPException(400, "Invalid crowd_level")

@app.post("/api/trails/{trail_id}/field-report")
async def post_trail_field_report(trail_id: str, body: TrailFieldReportPayload,
                                  user: dict = Depends(_current_user)):
    _validate_field_report(body)
    clean_trail_id = re.sub(r"[^a-zA-Z0-9_.:-]", "", trail_id)[:140] or "trail"
    result = submit_trail_field_report(
        trail_id=clean_trail_id,
        trail_name=(body.trail_name or "Trail")[:120],
        lat=body.lat, lng=body.lng,
        user_id=user["id"], username=user["username"],
        rig_label=body.rig_label,
        visited_date=body.visited_date,
        sentiment=body.sentiment, access_condition=body.access_condition,
        crowd_level=body.crowd_level, tags=body.tags,
        note=body.note, photo_data=body.photo_data,
    )
    fresh = get_user_by_id(user["id"])
    return {**result, "new_balance": fresh["credits"]}

@app.get("/api/trails/{trail_id}/field-reports")
async def get_trail_reports(trail_id: str):
    clean_trail_id = re.sub(r"[^a-zA-Z0-9_.:-]", "", trail_id)[:140] or "trail"
    return get_trail_field_reports(clean_trail_id)

@app.get("/api/trails/{trail_id}/field-report-summary")
async def get_trail_report_summary(trail_id: str):
    clean_trail_id = re.sub(r"[^a-zA-Z0-9_.:-]", "", trail_id)[:140] or "trail"
    return get_trail_field_report_summary(clean_trail_id)

@app.get("/api/trails/{trail_id}/field-reports/{report_id}/photo")
async def trail_report_photo(trail_id: str, report_id: int):
    from db.store import _conn
    clean_trail_id = re.sub(r"[^a-zA-Z0-9_.:-]", "", trail_id)[:140] or "trail"
    db = _conn()
    row = db.execute(
        "SELECT photo_data FROM trail_field_reports WHERE trail_id=? AND id=?",
        (clean_trail_id, report_id),
    ).fetchone()
    db.close()
    if not row or not row["photo_data"]:
        raise HTTPException(404, "No photo")
    import base64
    data = base64.b64decode(row["photo_data"])
    return Response(content=data, media_type="image/jpeg")


# ── Community pins ─────────────────────────────────────────────────────────────

VALID_PIN_TYPES = {
    "camp", "informal_camp", "wild_camp", "fuel", "propane", "water", "dump",
    "parking", "mechanic", "restaurant", "attraction", "shopping", "medical",
    "pet", "laundromat", "shower", "wifi", "checkpoint", "road_report",
    "trailhead", "trail_note", "overlook", "crossing", "gate", "trail_closure",
    "rock_art", "cell_signal", "trash", "wildlife",
    "warning", "gpx_import", "other",
}

class PinRequest(BaseModel):
    lat: float; lng: float; name: str
    type: str = "camp"; description: str = ""; land_type: str = "BLM"
    details: dict = Field(default_factory=dict)

class PinUpdateSuggestionPayload(BaseModel):
    pin_name: str
    field: str = "notes"
    value: str
    note: Optional[str] = None

@app.post("/api/pins")
async def submit_pin(body: PinRequest, user: dict = Depends(_current_user)):
    if get_user_pin_count_today(user["id"]) >= 15:
        raise HTTPException(429, "Daily community pin cap reached")
    pin_type = (body.type or "other").strip().lower()
    if pin_type not in VALID_PIN_TYPES:
        pin_type = "other"
    name = (body.name or "").strip()[:80]
    if not name:
        raise HTTPException(400, "Pin name is required")
    clean_details: dict[str, str] = {}
    for key, val in (body.details or {}).items():
        k = re.sub(r"[^a-zA-Z0-9_:-]", "", str(key))[:40]
        v = str(val).strip()[:240]
        if k and v:
            clean_details[k] = v
    duplicate = find_duplicate_community_pin(body.lat, body.lng, pin_type, name)
    if duplicate and pin_type == "gpx_import":
        return {"status": "duplicate", "credits_earned": 0, "duplicate_id": duplicate.get("id")}
    pin_id = add_community_pin(body.lat, body.lng, name, pin_type,
                               (body.description or "").strip()[:500], (body.land_type or "").strip()[:80],
                               user_id=user["id"], details=clean_details)
    credits_earned = 0 if pin_type == "gpx_import" else COMMUNITY_PIN_CREDIT
    if credits_earned:
        add_credits(user["id"], credits_earned, f"Community pin: {name}")
    return {"status": "ok", "id": pin_id, "credits_earned": credits_earned}

@app.get("/api/pins")
async def nearby_pins(lat: float, lng: float, radius: float = 1.0):
    return get_community_pins(lat, lng, radius_deg=radius)

@app.post("/api/pins/{pin_id}/suggest-update")
async def suggest_pin_update(pin_id: int, body: PinUpdateSuggestionPayload,
                             user: dict = Depends(_current_user)):
    field = (body.field or "notes").strip().lower()
    allowed = {"name", "type", "description", "details", "access", "status", "notes", "duplicate", "location"}
    if field not in allowed:
        raise HTTPException(400, "Invalid update field")
    value = (body.value or "").strip()
    if len(value) < 3:
        raise HTTPException(400, "Suggested update is too short")
    result = add_pin_update_suggestion(
        pin_id,
        (body.pin_name or f"Pin {pin_id}").strip()[:120],
        user.get("id"),
        user.get("username"),
        field,
        value,
        (body.note or "").strip()[:700] or None,
    )
    add_credits(user["id"], 2, f"Community pin update: {(body.pin_name or str(pin_id))[:80]}")
    fresh = get_user_by_id(user["id"])
    return {**result, "credits_earned": 2, "new_balance": fresh["credits"] if fresh else user.get("credits", 0)}

@app.post("/api/pins/{pin_id}/upvote")
async def upvote_pin(pin_id: int, user: dict = Depends(_current_user)):
    result = vote_community_pin(pin_id, user["id"], "upvote")
    if not result.get("ok"):
        raise HTTPException(400, result.get("reason", "vote_failed"))
    return result

@app.post("/api/pins/{pin_id}/downvote")
async def downvote_pin(pin_id: int, user: dict = Depends(_current_user)):
    result = vote_community_pin(pin_id, user["id"], "downvote")
    if not result.get("ok"):
        raise HTTPException(400, result.get("reason", "vote_failed"))
    return result


# ── Reports ───────────────────────────────────────────────────────────────────

VALID_REPORT_TYPES = {
    "police", "hazard", "road_condition", "wildlife", "road_closure",
    "campsite", "water", "cell_signal", "closure", "trail_condition",
}
VALID_SEVERITIES   = {"low", "moderate", "high", "critical"}

class ReportRequest(BaseModel):
    lat: float; lng: float
    type: str
    subtype: Optional[str] = None
    description: Optional[str] = None
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
    if body.description and len(body.description) > 500:
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
async def upvote(report_id: int, user: dict = Depends(_optional_user)):
    upvote_report(report_id, user["id"] if user else None)
    return {"status": "ok"}

@app.post("/api/reports/{report_id}/downvote")
async def downvote(report_id: int):
    downvote_report(report_id)
    return {"status": "ok"}

@app.post("/api/reports/{report_id}/confirm")
async def confirm(report_id: int, user: dict = Depends(_current_user)):
    """'Still there' — resets expiry, +1 credit to confirmer. One per user per report."""
    result = confirm_report(report_id, user["id"])
    reason = result.get("reason")
    if reason == "not_found":
        raise HTTPException(404, "Report not found")
    if reason == "own_report":
        raise HTTPException(400, "Cannot confirm your own report")
    if reason == "already_confirmed":
        raise HTTPException(400, "Already confirmed this report")
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
    # Current App Store / Play Store products. Product IDs are permanent in App Store Connect.
    "com.trailhead.explorer.monthly.v2": {"label": "Explorer Monthly", "days": 31},
    "com.trailhead.explorer.annual.v2":  {"label": "Explorer Annual",  "days": 366},
    "com.trailhead.explorer.yearly.v2":  {"label": "Explorer Yearly Alias",  "days": 366},
    # Legacy IDs remain accepted so existing sandbox/Play transactions can still sync during transition.
    "com.trailhead.explorer.monthly":    {"label": "Explorer Monthly Legacy", "days": 31},
    "com.trailhead.explorer.annual":     {"label": "Explorer Annual Legacy",  "days": 366},
}

APPLE_STOREKIT_PROD = "https://api.storekit.itunes.apple.com"
APPLE_STOREKIT_SANDBOX = "https://api.storekit-sandbox.itunes.apple.com"

class IAPActivateRequest(BaseModel):
    product_id: str
    transaction_id: str  # from Apple StoreKit — stored for idempotency
    platform: str = "ios"

class AppleNotificationBody(BaseModel):
    signedPayload: str

def _apple_private_key() -> str:
    if settings.apple_private_key:
        return settings.apple_private_key.replace("\\n", "\n")
    if settings.apple_private_key_path:
        try:
            return Path(settings.apple_private_key_path).read_text()
        except Exception:
            return ""
    return ""

def _apple_server_api_ready() -> bool:
    return bool(settings.apple_issuer_id and settings.apple_key_id and _apple_private_key())

def _google_play_server_api_ready() -> bool:
    return bool(settings.google_play_package_name and (settings.google_play_service_account_json or settings.google_play_service_account_path))

def _google_play_service_account() -> dict:
    raw = settings.google_play_service_account_json
    if not raw and settings.google_play_service_account_path:
        try:
            raw = Path(settings.google_play_service_account_path).read_text()
        except Exception:
            raw = ""
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        try:
            return json.loads(raw.replace("\\n", "\n"))
        except Exception:
            return {}

async def _google_play_access_token() -> str:
    account = _google_play_service_account()
    if not account.get("client_email") or not account.get("private_key"):
        raise HTTPException(500, "Google Play service account is not configured")
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": account["client_email"],
            "scope": "https://www.googleapis.com/auth/androidpublisher",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 900,
        },
        account["private_key"].replace("\\n", "\n"),
        algorithm="RS256",
    )
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
    if r.status_code >= 400:
        detail = r.text[:240] if r.text else r.reason_phrase
        raise HTTPException(502, f"Google Play auth failed: {detail}")
    return r.json().get("access_token") or ""

def _parse_google_expiry(value: str | None) -> int:
    if not value:
        return 0
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return int(parsed.astimezone(timezone.utc).timestamp())
    except Exception:
        return 0

async def _verify_google_play_subscription(product_id: str, purchase_token: str) -> dict:
    token = await _google_play_access_token()
    if not token:
        raise HTTPException(502, "Google Play auth did not return an access token")
    url = (
        "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"
        f"{quote(settings.google_play_package_name)}/purchases/subscriptionsv2/tokens/{quote(purchase_token)}"
    )
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    if r.status_code >= 400:
        detail = r.text[:240] if r.text else r.reason_phrase
        raise HTTPException(402, f"Google Play could not verify this subscription ({r.status_code}: {detail})")
    data = r.json()
    line_items = data.get("lineItems") or []
    matching = next((item for item in line_items if item.get("productId") == product_id), None)
    if not matching:
        raise HTTPException(400, "Google Play subscription does not match the requested product")
    expires_at = _parse_google_expiry(matching.get("expiryTime"))
    if expires_at <= int(time.time()):
        raise HTTPException(402, "Google Play subscription is expired")
    state = data.get("subscriptionState", "")
    if state in {"SUBSCRIPTION_STATE_EXPIRED", "SUBSCRIPTION_STATE_CANCELED", "SUBSCRIPTION_STATE_PENDING"}:
        raise HTTPException(402, f"Google Play subscription is not active ({state})")
    return {
        "product_id": product_id,
        "transaction_id": data.get("latestOrderId") or purchase_token,
        "original_transaction_id": data.get("linkedPurchaseToken") or purchase_token,
        "expires_at": expires_at,
        "environment": "GooglePlay",
        "state": state,
    }

def _apple_server_jwt() -> str:
    now = int(time.time())
    payload = {
        "iss": settings.apple_issuer_id,
        "iat": now,
        "exp": now + 900,
        "aud": "appstoreconnect-v1",
    }
    if settings.apple_bundle_id:
        payload["bid"] = settings.apple_bundle_id
    return jwt.encode(
        payload,
        _apple_private_key(),
        algorithm="ES256",
        headers={"kid": settings.apple_key_id, "typ": "JWT"},
    )

def _decode_apple_jws_payload(jws: str) -> dict:
    try:
        part = jws.split(".")[1]
        part += "=" * (-len(part) % 4)
        import base64
        return json.loads(base64.urlsafe_b64decode(part.encode()).decode())
    except Exception:
        raise HTTPException(502, "Apple returned an unreadable transaction payload")

async def _fetch_apple_transaction(transaction_id: str) -> tuple[dict, str]:
    token = _apple_server_jwt()
    headers = {"Authorization": f"Bearer {token}"}
    last_status = 0
    last_detail = ""
    for base, env in ((APPLE_STOREKIT_PROD, "Production"), (APPLE_STOREKIT_SANDBOX, "Sandbox")):
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{base}/inApps/v1/transactions/{quote(transaction_id)}", headers=headers)
        if r.status_code == 200:
            data = r.json()
            signed = data.get("signedTransactionInfo")
            if not signed:
                raise HTTPException(502, "Apple response did not include transaction info")
            return _decode_apple_jws_payload(signed), env
        last_status = r.status_code
        last_detail = r.text[:240] if r.text else r.reason_phrase
        if r.status_code not in {404, 400}:
            break
    raise HTTPException(402, f"Apple could not verify this subscription transaction ({last_status}: {last_detail})")

async def _verify_apple_subscription(product_id: str, transaction_id: str) -> dict:
    tx, queried_env = await _fetch_apple_transaction(transaction_id)
    apple_product_id = tx.get("productId")
    if apple_product_id != product_id:
        raise HTTPException(400, "Apple transaction does not match the requested product")
    if apple_product_id not in IAP_PRODUCTS:
        raise HTTPException(400, "Apple transaction is not a Trailhead Explorer product")
    bundle_id = tx.get("bundleId")
    if settings.apple_bundle_id and bundle_id and bundle_id != settings.apple_bundle_id:
        raise HTTPException(400, "Apple transaction bundle does not match Trailhead")
    expires_ms = int(tx.get("expiresDate") or 0)
    if expires_ms <= 0:
        raise HTTPException(402, "Apple transaction is not an active subscription")
    expires_at = expires_ms // 1000
    if expires_at <= int(time.time()):
        raise HTTPException(402, "Apple subscription is expired")
    return {
        "product_id": apple_product_id,
        "transaction_id": tx.get("transactionId") or transaction_id,
        "original_transaction_id": tx.get("originalTransactionId"),
        "expires_at": expires_at,
        "environment": tx.get("environment") or queried_env,
        "bundle_id": bundle_id,
    }

@app.post("/api/subscription/activate")
async def activate_subscription(body: IAPActivateRequest, user: dict = Depends(_current_user)):
    """Called by mobile after a successful native store purchase. Activates the plan on the user account."""
    product = IAP_PRODUCTS.get(body.product_id)
    if not product:
        raise HTTPException(400, f"Unknown product: {body.product_id}")
    if not body.transaction_id.strip():
        raise HTTPException(400, "Missing transaction_id")

    platform = (body.platform or "ios").strip().lower()
    if platform not in {"ios", "android"}:
        platform = "ios"
    verification = None
    if platform == "ios" and _apple_server_api_ready():
        verification = await _verify_apple_subscription(body.product_id, body.transaction_id.strip())
    if platform == "android" and _google_play_server_api_ready():
        verification = await _verify_google_play_subscription(body.product_id, body.transaction_id.strip())

    # Idempotency: store transaction_id to prevent double-activation
    from db.store import _conn as _db_conn
    db = _db_conn()
    existing = db.execute(
        "SELECT 1 FROM stripe_purchases WHERE session_id=?", (body.transaction_id,)
    ).fetchone()
    if existing:
        db.close()
        user_row = get_user_by_id(user["id"])
        if verification:
            updated = set_user_plan(user["id"], verification["product_id"], verification["expires_at"])
            if verification.get("original_transaction_id"):
                save_app_store_subscription(
                    verification["original_transaction_id"],
                    verification.get("transaction_id"),
                    user["id"],
                    verification["product_id"],
                    verification.get("environment"),
                    verification["expires_at"],
                    "active",
                )
            log_event(user["id"], None, "iap_verified_existing", verification)
            return {
                "status": "verified",
                "plan_type": updated.get("plan_type"),
                "plan_expires_at": updated.get("plan_expires_at"),
            }
        if has_active_plan(user_row):
            return {"status": "already_active", "plan_type": user_row.get("plan_type"), "plan_expires_at": user_row.get("plan_expires_at")}
        expires_at = activate_plan(user["id"], body.product_id, product["days"])
        log_event(user["id"], None, "iap_reactivate", {"product_id": body.product_id, "platform": platform, "days": product["days"]})
        return {"status": "reactivated", "plan_type": body.product_id, "plan_expires_at": expires_at}

    db.execute(
        "INSERT INTO stripe_purchases (session_id, user_id, credits, created_at) VALUES (?,?,0,?)",
        (body.transaction_id, user["id"], int(__import__("time").time()))
    )
    db.commit(); db.close()

    if verification:
        updated = set_user_plan(user["id"], verification["product_id"], verification["expires_at"])
        if verification.get("original_transaction_id"):
            save_app_store_subscription(
                verification["original_transaction_id"],
                verification.get("transaction_id"),
                user["id"],
                verification["product_id"],
                verification.get("environment"),
                verification["expires_at"],
                "active",
            )
        log_event(user["id"], None, "iap_verified_activate", verification)
        return {
            "status": "verified",
            "plan_type": updated.get("plan_type"),
            "plan_expires_at": updated.get("plan_expires_at"),
        }

    expires_at = activate_plan(user["id"], body.product_id, product["days"])
    log_event(user["id"], None, "iap_activate_unverified", {
        "product_id": body.product_id,
        "platform": platform,
        "google_validation_configured": _google_play_server_api_ready(),
        "days": product["days"],
    })
    return {"status": "activated", "plan_type": body.product_id, "plan_expires_at": expires_at}

@app.post("/api/apple/notifications")
async def apple_server_notification(body: AppleNotificationBody):
    """App Store Server Notifications v2 endpoint for renewal/cancellation sync."""
    payload = _decode_apple_jws_payload(body.signedPayload)
    data = payload.get("data") or {}
    signed_tx = data.get("signedTransactionInfo")
    if not signed_tx:
        log_event(None, None, "apple_notification_no_transaction", {"notificationType": payload.get("notificationType")})
        return {"ok": True, "handled": False}
    tx = _decode_apple_jws_payload(signed_tx)
    original_id = tx.get("originalTransactionId")
    product_id = tx.get("productId")
    if not original_id or product_id not in IAP_PRODUCTS:
        log_event(None, None, "apple_notification_unmapped_product", {
            "product_id": product_id,
            "notificationType": payload.get("notificationType"),
        })
        return {"ok": True, "handled": False}
    mapped = get_app_store_subscription(original_id)
    if not mapped:
        log_event(None, None, "apple_notification_no_user_mapping", {
            "original_transaction_id": original_id,
            "product_id": product_id,
            "notificationType": payload.get("notificationType"),
        })
        return {"ok": True, "handled": False}
    expires_ms = int(tx.get("expiresDate") or 0)
    expires_at = expires_ms // 1000 if expires_ms else None
    active = bool(expires_at and expires_at > int(time.time()))
    status = "active" if active else "expired"
    if active:
        set_user_plan(mapped["user_id"], product_id, expires_at)
    else:
        set_user_plan(mapped["user_id"], "free", None)
    save_app_store_subscription(
        original_id,
        tx.get("transactionId"),
        mapped["user_id"],
        product_id,
        tx.get("environment") or data.get("environment"),
        expires_at,
        status,
    )
    log_event(mapped["user_id"], None, "apple_notification_subscription_sync", {
        "notificationType": payload.get("notificationType"),
        "subtype": payload.get("subtype"),
        "product_id": product_id,
        "expires_at": expires_at,
        "status": status,
    })
    return {"ok": True, "handled": True, "status": status}

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

class OfflineAuthorizeRequest(BaseModel):
    asset_type: str
    region_id: str
    label: str = ""

@app.post("/api/offline/authorize")
async def offline_authorize(body: OfflineAuthorizeRequest, user: dict = Depends(_current_user)):
    asset_type = body.asset_type.strip().lower()
    region_id = body.region_id.strip().lower()
    if asset_type not in OFFLINE_DOWNLOAD_COSTS:
        raise HTTPException(400, "Invalid offline asset type")
    if asset_type == "conus_map":
        region_id = "conus"
    return {
        "authorized": True,
        "charged": 0,
        "free_used": False,
        "already_authorized": True,
        "plan": has_active_plan(user),
        "credits": user.get("credits", 0),
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


@app.get("/terms", response_class=HTMLResponse)
async def terms_of_use():
    return HTMLResponse("""<!DOCTYPE html><html lang="en"><head><title>Terms of Use — Trailhead</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0f18;color:#e2e8f0;max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.7;}
h1{color:#f97316;font-size:28px;margin-bottom:4px;}
h2{color:#f1f5f9;font-size:18px;margin-top:32px;border-bottom:1px solid #1e2d3d;padding-bottom:8px;}
p,li{color:#94a3b8;font-size:15px;}
a{color:#f97316;}
.updated{color:#475569;font-size:13px;margin-bottom:32px;}
</style></head><body>
<h1>Terms of Use</h1>
<p class="updated">Last updated: April 28, 2026</p>

<h2>1. Acceptance of Terms</h2>
<p>By downloading or using Trailhead ("the App"), you agree to be bound by these Terms of Use. If you do not agree, do not use the App.</p>

<h2>2. Description of Service</h2>
<p>Trailhead is an AI-powered overlanding and road trip planning application that provides route suggestions, campsite recommendations, navigation, and community reporting features. Trip plans are generated by AI and are suggestions only — always verify conditions independently before traveling.</p>

<h2>3. User Accounts</h2>
<p>You must create an account to access most features. You are responsible for maintaining the confidentiality of your credentials and for all activities under your account. You may delete your account at any time from the Profile screen.</p>

<h2>4. Subscriptions and Credits</h2>
<p>Trailhead offers auto-renewable subscriptions (Explorer Plan Monthly and Explorer Plan Annual) through Apple's App Store on iOS and Google Play on Android. Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current period. Manage or cancel subscriptions in your Apple ID settings or Google Play subscriptions. Credits are non-refundable except where required by law.</p>

<h2>5. Prohibited Conduct</h2>
<p>You agree not to: (a) use the App for any unlawful purpose; (b) submit false or misleading reports; (c) attempt to reverse engineer or tamper with the App; (d) use automated tools to scrape data; (e) harass other users.</p>

<h2>6. Community Reports</h2>
<p>User-submitted reports (road conditions, hazards, campsite conditions) reflect the views of individual users and are not verified by Trailhead. Trailhead reserves the right to remove any report that violates these terms. Never rely solely on community reports for safety-critical decisions.</p>

<h2>7. Safety Disclaimer</h2>
<p>Overlanding and off-road travel involve inherent risks. AI-generated route suggestions may be inaccurate, outdated, or unsuitable for your vehicle or conditions. Always carry emergency supplies, inform others of your plans, and exercise independent judgment. Trailhead is not liable for accidents, injuries, property damage, or other losses resulting from use of the App.</p>

<h2>8. Intellectual Property</h2>
<p>All content, design, and functionality of the App are owned by Trailhead. You may not reproduce, distribute, or create derivative works without written permission.</p>

<h2>9. Termination</h2>
<p>We may suspend or terminate your account for violation of these Terms. You may terminate your account at any time from the Profile screen.</p>

<h2>10. Limitation of Liability</h2>
<p>To the maximum extent permitted by law, Trailhead shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the App.</p>

<h2>11. Changes to Terms</h2>
<p>We may update these Terms at any time. Continued use of the App after changes constitutes acceptance of the updated Terms.</p>

<h2>12. Governing Law</h2>
<p>These Terms are governed by the laws of the State of Colorado, United States, without regard to conflict of law provisions.</p>

<h2>13. Contact</h2>
<p>Questions about these Terms? Email us at <a href="mailto:hello@gettrailhead.app">hello@gettrailhead.app</a></p>
</body></html>""")


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
<p>Credit purchases and subscriptions are processed by Stripe, Apple, or Google Play depending on platform and purchase type. Trailhead never stores your full card number or payment details. Their privacy policies govern payment data handling.</p>

<h2>5. Data Retention</h2>
<p>Account data is retained while your account is active. Community reports expire automatically (typically within 24–72 hours). You may request account deletion by contacting us at the address below.</p>

<h2>6. Third-Party Services</h2>
<p>Trailhead uses: Mapbox for maps (see <a href="https://www.mapbox.com/legal/privacy">Mapbox Privacy Policy</a>); Anthropic Claude for AI trip planning; ElevenLabs for optional AI voice/audio guide generation; RIDB / Recreation.gov and National Park Service data for campsite and place information; Open-Meteo for weather data; Stripe, Apple, and Google Play for payments.</p>

<h2>7. Children's Privacy</h2>
<p>Trailhead is not directed to children under 13 and we do not knowingly collect personal information from children under 13.</p>

<h2>8. Changes to This Policy</h2>
<p>We may update this policy from time to time. Continued use of the app after changes constitutes acceptance of the updated policy.</p>

<h2>9. Contact</h2>
<p>Questions or requests: <a href="mailto:hello@gettrailhead.app">hello@gettrailhead.app</a></p>
</body></html>""")


# ── Leaderboard ───────────────────────────────────────────────────────────────

@app.get("/api/leaderboard")
async def leaderboard():
    return get_leaderboard(limit=20)


# ── Contest ──────────────────────────────────────────────────────────────────

CONTEST_RULES = {
    "title": "Trailhead Contributor Contest Official Rules",
    "eligibility": "Open to legal U.S. residents who are 18 or older. Void where prohibited.",
    "sponsor": "Sponsored by Trailhead. Apple is not a sponsor and is not involved in this contest or drawing in any manner.",
    "prizes": [
        "Yearly top contributor: $1,000 cash/card plus 1 year Explorer.",
        "Monthly top contributor: $100 cash/card plus 1 year Explorer.",
        "Monthly drawing: $50 cash/card plus 1 year Explorer.",
    ],
    "entries": "No purchase necessary. Subscribers are automatically entered in the monthly drawing, and any eligible user may enter free once per calendar month in the app. A purchase does not improve odds.",
    "odds": "Monthly drawing odds depend on the number of eligible entries received for that month.",
    "points": "Contest points are separate from spendable credits. Spendable credits stay on the account; contest totals are measured by calendar month and calendar year.",
    "contact": "Questions or winner verification: hello@gettrailhead.app",
}

@app.get("/api/contest/rules")
async def contest_rules():
    return CONTEST_RULES

@app.get("/api/contest/status")
async def contest_status(user: dict = Depends(_current_user)):
    if has_active_plan(user):
        ensure_contest_entry(user["id"], "subscriber")
    return {
        **get_contest_user_status(user["id"]),
        "rules": CONTEST_RULES,
        "month_leaders": get_contest_leaderboard("month", 10),
        "year_leaders": get_contest_leaderboard("year", 10),
    }

@app.get("/api/contest/leaderboard")
async def contest_leaderboard(period: str = "month", user: dict = Depends(_current_user)):
    return {"leaders": get_contest_leaderboard(period, 50)}

@app.post("/api/contest/free-entry")
async def contest_free_entry(user: dict = Depends(_current_user)):
    entry = ensure_contest_entry(user["id"], "free")
    return {"ok": True, "entry": entry, "status": get_contest_user_status(user["id"])}


# ── Contributor profiles ─────────────────────────────────────────────────────

class ContributionPrivacyBody(BaseModel):
    visible: bool

class MapContributorApplicationBody(BaseModel):
    experience: str = ""
    regions: str = ""
    sample_note: str = ""

@app.get("/api/contributions/me")
async def contributions_me(user: dict = Depends(_current_user)):
    if has_active_plan(user):
        ensure_contest_entry(user["id"], "subscriber")
    profile = get_contributor_profile(user["id"], user["id"])
    if not profile:
        raise HTTPException(404, "Contributor profile not found")
    return profile

@app.get("/api/contributions/leaderboard")
async def contributions_leaderboard(period: str = "month", user: dict = Depends(_current_user)):
    period = period if period in {"month", "year", "all"} else "month"
    return {"period": period, "leaders": get_contributor_leaderboard(period, 50, user["id"])}

@app.get("/api/contributors/{user_id}")
async def contributor_public_profile(user_id: int, user: dict = Depends(_current_user)):
    profile = get_contributor_profile(user_id, user["id"])
    if not profile:
        raise HTTPException(404, "Contributor profile is private")
    return profile

@app.post("/api/contributions/privacy")
async def contribution_privacy(body: ContributionPrivacyBody, user: dict = Depends(_current_user)):
    profile = set_contributor_visibility(user["id"], body.visible)
    if not profile:
        raise HTTPException(404, "Contributor profile not found")
    return profile

@app.post("/api/contributions/map-contributor/apply")
async def map_contributor_apply(body: MapContributorApplicationBody, user: dict = Depends(_current_user)):
    experience = (body.experience or "").strip()
    regions = (body.regions or "").strip()
    sample_note = (body.sample_note or "").strip()
    if len(experience) < 20 or len(regions) < 2:
        raise HTTPException(400, "Tell us where you map and how you verify places.")
    application = submit_map_contributor_application(
        user["id"], user.get("username") or "", experience, regions, sample_note,
    )
    return {"ok": True, "application": application}


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

class AdminCreditBody(BaseModel):
    amount: int; reason: str = "Admin adjustment"

class AdminPlanBody(BaseModel):
    plan_type: str
    duration_days: int = 366

class AdminContestSnapshotBody(BaseModel):
    prize_type: str
    month: str = ""
    year: str = ""
    notes: str = ""

class AdminContestDrawingBody(BaseModel):
    month: str = ""
    year: str = ""
    notes: str = ""

class AdminContestAwardStatusBody(BaseModel):
    status: str
    notes: str = ""

class ExploreStoryAdminBody(BaseModel):
    title: str = ""
    hook: str = ""
    summary: str = ""
    story: str = ""
    notes: str = ""

@app.get("/api/admin/stats")
async def admin_stats(admin: dict = Depends(_require_admin)):
    stats = get_platform_stats()
    stats["apple_validation_configured"] = _apple_server_api_ready()
    stats["apple_bundle_id"] = settings.apple_bundle_id
    stats["google_play_validation_configured"] = _google_play_server_api_ready()
    stats["google_play_package_name"] = settings.google_play_package_name
    return stats

@app.get("/api/admin/users")
async def admin_users(search: str = "", limit: int = 50, offset: int = 0,
                      admin: dict = Depends(_require_admin)):
    return get_all_users(search, limit, offset)

@app.get("/api/admin/contest/overview")
async def admin_contest_overview(month: str = "", year: str = "",
                                 admin: dict = Depends(_require_admin)):
    return get_contest_admin_overview(month or None, year or None)

@app.get("/api/admin/contest/leaderboard")
async def admin_contest_leaderboard(period: str = "month", month: str = "", year: str = "",
                                    admin: dict = Depends(_require_admin)):
    return {"leaders": get_contest_leaderboard(period, 100, month or None, year or None)}

@app.post("/api/admin/contest/backfill")
async def admin_contest_backfill(admin: dict = Depends(_require_admin)):
    count = backfill_contest_events_from_credits()
    return {"ok": True, "inserted": count}

@app.post("/api/admin/contest/snapshot")
async def admin_contest_snapshot(body: AdminContestSnapshotBody,
                                 admin: dict = Depends(_require_admin)):
    prize_type = body.prize_type.strip()
    if prize_type not in {"monthly_top", "yearly_top"}:
        raise HTTPException(400, "prize_type must be monthly_top or yearly_top")
    award = snapshot_contest_award(prize_type, admin["id"], body.month or None, body.year or None, body.notes)
    return {"ok": True, "award": award}

@app.post("/api/admin/contest/drawing/run")
async def admin_contest_run_drawing(body: AdminContestDrawingBody,
                                    admin: dict = Depends(_require_admin)):
    award = run_contest_drawing(admin["id"], body.month or None, body.year or None, body.notes)
    return {"ok": True, "award": award}

@app.post("/api/admin/contest/awards/{award_id}/status")
async def admin_contest_award_status(award_id: int, body: AdminContestAwardStatusBody,
                                     admin: dict = Depends(_require_admin)):
    award = update_contest_award_status(award_id, body.status.strip().lower(), body.notes)
    if not award:
        raise HTTPException(400, "Invalid award or status")
    return {"ok": True, "award": award}

@app.get("/api/admin/map-contributor-applications")
async def admin_map_contributor_applications(status: Optional[str] = "pending",
                                             admin: dict = Depends(_require_admin)):
    return get_map_contributor_applications(status if status else None, limit=200)

@app.post("/api/admin/map-contributor-applications/{application_id}/status")
async def admin_map_contributor_application_status(application_id: int, body: dict,
                                                  admin: dict = Depends(_require_admin)):
    status = str(body.get("status", "")).strip().lower()
    if status not in {"pending", "approved", "dismissed"}:
        raise HTTPException(400, "Invalid status")
    if not update_map_contributor_application_status(application_id, status):
        raise HTTPException(404, "Application not found")
    return {"ok": True}

def _find_explore_place(place_id: str) -> dict | None:
    catalog = _load_explore_catalog()
    for place in catalog.get("places") or []:
        if str(place.get("id") or "") == place_id:
            return place
    return None

@app.get("/api/admin/explore/places")
async def admin_explore_places(search: str = "", limit: int = 80,
                               admin: dict = Depends(_require_admin)):
    query = search.strip().lower()
    overrides = get_explore_story_overrides()
    places = []
    for place in (_load_explore_catalog().get("places") or []):
        summary = place.get("summary") or {}
        title = str(summary.get("title") or place.get("id") or "")
        haystack = " ".join([
            str(place.get("id") or ""),
            title,
            str(summary.get("state") or ""),
            str(summary.get("category") or ""),
        ]).lower()
        if query and query not in haystack:
            continue
        override = overrides.get(str(place.get("id") or "")) or {}
        story = override.get("story") or (place.get("profile") or {}).get("story") or place.get("audio_script") or ""
        places.append({
            "id": place.get("id"),
            "title": title,
            "category": summary.get("category"),
            "state": summary.get("state"),
            "rank": summary.get("rank"),
            "edited": bool(override.get("story") or override.get("summary") or override.get("hook")),
            "updated_at": override.get("updated_at"),
            "story_words": len(str(story).split()),
        })
    places.sort(key=lambda p: (not p["edited"], p.get("rank") or 9999, p.get("title") or ""))
    limit = max(1, min(limit, 200))
    return {"places": places[:limit], "total": len(places)}

@app.get("/api/admin/explore/places/{place_id}")
async def admin_explore_place(place_id: str, admin: dict = Depends(_require_admin)):
    place_id = re.sub(r"[^a-zA-Z0-9_.:-]", "", place_id)[:180]
    place = _find_explore_place(place_id)
    if not place:
        raise HTTPException(404, "Explore place not found")
    override = get_explore_story_override(place_id)
    summary = place.get("summary") or {}
    profile = place.get("profile") or {}
    return {
        "place": place,
        "override": override,
        "editable": {
            "title": override.get("title") or summary.get("title") or "",
            "hook": override.get("hook") or profile.get("hook") or summary.get("hook") or "",
            "summary": override.get("summary") or profile.get("summary") or summary.get("short_description") or "",
            "story": override.get("story") or profile.get("story") or place.get("audio_script") or place.get("wiki_extract") or "",
            "notes": override.get("notes") or "",
        },
    }

@app.post("/api/admin/explore/places/{place_id}")
async def admin_update_explore_place(place_id: str, body: ExploreStoryAdminBody,
                                     admin: dict = Depends(_require_admin)):
    place_id = re.sub(r"[^a-zA-Z0-9_.:-]", "", place_id)[:180]
    if not _find_explore_place(place_id):
        raise HTTPException(404, "Explore place not found")
    old_override = get_explore_story_override(place_id)
    old_story = old_override.get("story") or ""
    story = " ".join(body.story.split()) if len(body.story) < 400 else body.story.strip()
    override = set_explore_story_override(place_id, {
        "title": body.title.strip()[:180],
        "hook": body.hook.strip()[:500],
        "summary": body.summary.strip()[:1200],
        "story": story[:18000],
        "notes": body.notes.strip()[:2000],
    }, admin.get("id"))
    purged_audio = await _purge_guide_audio_texts(old_story, override.get("story") or "")
    log_event(admin["id"], None, "admin_explore_story_edit", {
        "place_id": place_id,
        "story_words": len((override.get("story") or "").split()),
        "purged_audio": purged_audio,
    })
    return {"ok": True, "override": override, "purged_audio": purged_audio}

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

@app.post("/api/admin/users/{user_id}/plan")
async def admin_set_user_plan(user_id: int, body: AdminPlanBody,
                              admin: dict = Depends(_require_admin)):
    plan = body.plan_type.strip().lower()
    if plan not in {"free", "explorer"}:
        raise HTTPException(400, "plan_type must be free or explorer")
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    expires_at = None
    if plan == "explorer":
        days = min(max(body.duration_days, 1), 3660)
        expires_at = int(time.time()) + days * 86400
    updated = set_user_plan(user_id, plan, expires_at)
    log_event(admin["id"], None, "admin_plan_override", {
        "target_user_id": user_id,
        "plan_type": plan,
        "expires_at": expires_at,
    })
    return {
        "ok": True,
        "plan_type": updated.get("plan_type", "free") if updated else plan,
        "plan_expires_at": updated.get("plan_expires_at") if updated else expires_at,
        "is_active": has_active_plan(updated) if updated else False,
    }

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

@app.post("/api/admin/reports/{report_id}/remove-photo")
async def admin_remove_photo(report_id: int, admin: dict = Depends(_require_admin)):
    """Strip the photo from a report without deleting the report itself."""
    db = _get_db()
    db.execute("UPDATE reports SET photo_url=NULL, photo_data=NULL WHERE id=?", (report_id,))
    db.commit()
    return {"ok": True}

@app.get("/api/admin/trips")
async def admin_trips(admin: dict = Depends(_require_admin)):
    return get_all_trips(limit=100)

@app.get("/api/admin/pins")
async def admin_pins(admin: dict = Depends(_require_admin)):
    return get_all_pins(limit=200)

@app.get("/api/admin/pin-update-suggestions")
async def admin_pin_update_suggestions(status: Optional[str] = "pending",
                                       admin: dict = Depends(_require_admin)):
    return get_pin_update_suggestions(status if status else None, limit=200)

@app.post("/api/admin/pin-update-suggestions/{suggestion_id}/status")
async def admin_pin_update_suggestion_status(suggestion_id: int, body: dict,
                                             admin: dict = Depends(_require_admin)):
    status = str(body.get("status") or "").strip().lower()
    if status not in {"pending", "approved", "rejected"}:
        raise HTTPException(400, "Invalid status")
    if not update_pin_update_suggestion_status(suggestion_id, status):
        raise HTTPException(404, "Suggestion not found")
    return {"ok": True}

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

def _camp_merge_key(camp: dict) -> str:
    name = re.sub(r"[^a-z0-9]+", "", str(camp.get("name") or "").lower())[:32]
    try:
        lat = round(float(camp.get("lat", 0)), 4)
        lng = round(float(camp.get("lng", 0)), 4)
    except Exception:
        lat = lng = 0
    return f"{name}:{lat}:{lng}"

def _merge_camp_sources(*sources: list[dict], type_filters: list[str] | None = None) -> list[dict]:
    seen_ids: set[str] = set()
    seen_near: set[str] = set()
    merged: list[dict] = []
    for source in sources:
        for camp in source:
            if type_filters and not any(t in camp.get("tags", []) for t in type_filters):
                continue
            camp_id = str(camp.get("id") or "")
            near_key = _camp_merge_key(camp)
            if camp_id in seen_ids or near_key in seen_near:
                continue
            seen_ids.add(camp_id)
            seen_near.add(near_key)
            merged.append(camp)
    return merged

@app.get("/api/nearby-camps")
async def nearby_camps(lat: float, lng: float, radius: float = 50, types: str = ""):
    """Aggregate legal camp sources near a point, no trip required."""
    type_filters = [t.strip() for t in types.split(",") if t.strip()] if types else None
    ridb, blm, osm = await asyncio.gather(
        get_campsites_search(lat, lng, radius_miles=radius, type_filters=type_filters),
        get_blm_campsites(lat, lng, radius_miles=radius),
        get_osm_campsites(lat, lng, radius_m=int(min(radius, 60) * 1600)),
    )
    return _merge_camp_sources(ridb, blm, osm, type_filters=type_filters)[:160]


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
    ridb, blm, osm = await asyncio.gather(
        get_campsites_search(lat, lng, radius_miles=radius_miles, type_filters=type_filters),
        get_blm_campsites(lat, lng, radius_miles=radius_miles),
        get_osm_campsites(lat, lng, radius_m=min(radius_m, 120000)),
    )
    in_box = [
        [c for c in source if s <= c.get("lat", 999) <= n and w <= c.get("lng", 999) <= e]
        for source in (ridb, blm, osm)
    ]
    return _merge_camp_sources(*in_box, type_filters=type_filters)[:200]


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


# ── OSM POIs (water, named trails, trailheads, viewpoints, hot springs) ────────

@app.get("/api/osm-pois")
async def osm_pois(lat: float, lng: float, radius: float = 30, types: str = "water,trailhead,viewpoint"):
    type_set = {t.strip() for t in types.split(",") if t.strip()}
    radius_m = int(radius * 1600)
    dense_radius_m = int(min(max(radius, 1), 25) * 1600)
    tasks = []
    if "trail" in type_set or "trails" in type_set:
        tasks.append(get_trails(lat, lng, radius_m=dense_radius_m))
    if "water" in type_set:
        tasks.append(get_water_sources(lat, lng, radius_m=dense_radius_m))
    if "fuel" in type_set or "gas" in type_set:
        tasks.append(get_fuel_stations(lat, lng, radius_m=dense_radius_m))
    if "trailhead" in type_set:
        tasks.append(get_trailheads(lat, lng, radius_m=radius_m))
    if "viewpoint" in type_set:
        tasks.append(get_viewpoints(lat, lng, radius_m=radius_m))
    if "peak" in type_set:
        tasks.append(get_peaks(lat, lng, radius_m=radius_m))
    if "hot_spring" in type_set or "hot_springs" in type_set:
        tasks.append(get_hot_springs(lat, lng, radius_m=radius_m))
    if not tasks:
        return []
    results = await asyncio.gather(*tasks, return_exceptions=True)
    merged: list[dict] = []
    seen = set()
    per_type_limit = max(12, min(40, int(120 / max(len(results), 1))))
    for sublist in results:
        if not isinstance(sublist, list):
            continue
        added_for_type = 0
        for item in sublist:
            item_id = str(item.get("id") or "")
            key = item_id or f"{item.get('type')}:{item.get('name')}:{float(item.get('lat', 0)):.4f}:{float(item.get('lng', 0)):.4f}"
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
            added_for_type += 1
            if added_for_type >= per_type_limit:
                break
    return merged[:120]


# ── Offline trip essentials packs ─────────────────────────────────────────────

class PlaceTripWaypoint(BaseModel):
    lat: float
    lng: float
    name: str = ""
    day: int = 0
    type: str = ""

class PlaceTripPackRequest(BaseModel):
    trip_id: str = ""
    trip_name: str = "Trip"
    waypoints: list[PlaceTripWaypoint] = Field(default_factory=list)
    route_coords: list[list[float]] = Field(default_factory=list)

def _place_pack_id(trip_id: str, trip_name: str) -> str:
    base = trip_id.strip() or trip_name.strip().lower()
    base = re.sub(r"[^a-zA-Z0-9_-]+", "-", base).strip("-").lower()
    return (base or "trip")[:80] + "-essentials"

def _trip_pack_samples(body: PlaceTripPackRequest) -> list[dict]:
    samples: list[dict] = []
    route = []
    for coord in body.route_coords:
        if isinstance(coord, list) and len(coord) >= 2:
            lng, lat = coord[0], coord[1]
            if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
                route.append({"lat": float(lat), "lng": float(lng), "name": "Route"})
    if len(route) >= 2:
        stride = max(1, len(route) // 4)
        samples.extend(route[::stride][:5])
        if route[-1] not in samples:
            samples.append(route[-1])
    for wp in body.waypoints:
        if isinstance(wp.lat, (int, float)) and isinstance(wp.lng, (int, float)):
            samples.append({"lat": float(wp.lat), "lng": float(wp.lng), "name": wp.name, "day": wp.day})

    deduped: list[dict] = []
    seen = set()
    for p in samples:
        key = (round(p["lat"], 3), round(p["lng"], 3))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(p)
    return deduped[:6]

def _normalize_pack_point(item: dict, category: str) -> dict | None:
    lat, lng = item.get("lat"), item.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    ptype = str(item.get("type") or category or "poi")
    if ptype == "fuel":
        category = "fuel"
    elif ptype in {"water", "trailhead", "viewpoint", "peak", "hot_spring"}:
        category = ptype
    return {
        "id": str(item.get("id") or f"{ptype}_{lat:.5f}_{lng:.5f}"),
        "name": str(item.get("name") or ptype.replace("_", " ").title()),
        "lat": float(lat),
        "lng": float(lng),
        "type": ptype,
        "category": category,
        "source": str(item.get("source") or "osm"),
        "subtype": item.get("subtype") or "",
        "address": item.get("address") or "",
        "fuel_types": item.get("fuel_types") or "",
        "elevation": item.get("elevation") or "",
    }

async def _gather_essentials_for_sample(sample: dict) -> list[dict]:
    lat = sample["lat"]
    lng = sample["lng"]
    fuel, water, trailheads, viewpoints, peaks, hot_springs = await asyncio.gather(
        get_fuel_stations(lat, lng, radius_m=32000),
        get_water_sources(lat, lng, radius_m=24000),
        get_trailheads(lat, lng, radius_m=28000),
        get_viewpoints(lat, lng, radius_m=28000),
        get_peaks(lat, lng, radius_m=36000),
        get_hot_springs(lat, lng, radius_m=52000),
        return_exceptions=True,
    )
    merged: list[dict] = []
    for category, batch in (
        ("fuel", fuel), ("water", water), ("trailhead", trailheads),
        ("viewpoint", viewpoints), ("peak", peaks), ("hot_spring", hot_springs),
    ):
        if isinstance(batch, list):
            for item in batch:
                normalized = _normalize_pack_point(item, category)
                if normalized:
                    merged.append(normalized)
    return merged

@app.post("/api/places/trip-essentials")
async def trip_essentials_pack(body: PlaceTripPackRequest, user: dict = Depends(_current_user)):
    samples = _trip_pack_samples(body)
    if len(samples) < 2:
        raise HTTPException(400, "Trip essentials need at least two mapped route points.")

    semaphore = asyncio.Semaphore(2)

    async def limited_gather(sample: dict) -> list[dict]:
        async with semaphore:
            return await _gather_essentials_for_sample(sample)

    batches = await asyncio.gather(*[limited_gather(p) for p in samples], return_exceptions=True)
    points: list[dict] = []
    seen = set()
    for batch in batches:
        if not isinstance(batch, list):
            continue
        for point in batch:
            key = point.get("id") or f"{point.get('type')}:{point.get('lat'):.4f}:{point.get('lng'):.4f}"
            if key in seen:
                continue
            seen.add(key)
            points.append(point)

    priority = {"fuel": 0, "water": 1, "hot_spring": 2, "trailhead": 3, "viewpoint": 4, "peak": 5}
    points.sort(key=lambda p: (priority.get(str(p.get("type")), 9), str(p.get("name", ""))))
    points = points[:350]
    categories = sorted({str(p.get("type") or p.get("category") or "poi") for p in points})
    return {
        "schema_version": 1,
        "pack_id": _place_pack_id(body.trip_id, body.trip_name),
        "trip_id": body.trip_id,
        "trip_name": body.trip_name,
        "name": f"{body.trip_name or 'Trip'} Essentials",
        "generated_at": int(time.time()),
        "source": "OpenStreetMap",
        "sample_count": len(samples),
        "categories": categories,
        "points": points,
    }


@app.get("/api/places/packs/manifest")
async def place_packs_manifest():
    return await _place_packs.remote_manifest()


@app.get("/api/places/packs/{region}/{pack_id}")
async def place_pack_download(region: str, pack_id: str = "essentials", user: dict = Depends(_current_user)):
    pack = await _place_packs.fetch_remote_pack(region, pack_id)
    if not pack:
        raise HTTPException(404, "Place pack not found")
    return pack


# ── Explore catalog ────────────────────────────────────────────────────────────

@app.get("/api/explore/catalog")
async def explore_catalog():
    """Return the prebuilt featured Explore catalog. No request-time AI."""
    return _load_explore_catalog()


@app.get("/api/explore/places")
async def explore_places(
    lat: float | None = None,
    lng: float | None = None,
    mode: str = "featured",
    limit: int = 60,
):
    catalog = _load_explore_catalog()
    places = list(catalog.get("places") or [])
    if lat is not None and lng is not None and mode in {"nearby", "trip"}:
        ranked = []
        for place in places:
            summary = place.get("summary") or {}
            plat = summary.get("lat")
            plng = summary.get("lng")
            if not isinstance(plat, (int, float)) or not isinstance(plng, (int, float)):
                continue
            dist_m = _haversine_m(lat, lng, float(plat), float(plng))
            enriched = dict(place)
            enriched["summary"] = {**summary, "distance_m": round(dist_m)}
            ranked.append(enriched)
        places = sorted(ranked, key=lambda p: (p.get("summary") or {}).get("distance_m", 999999999))
    else:
        places = sorted(places, key=lambda p: (p.get("summary") or {}).get("rank", 9999))
    limit = max(1, min(limit, 100))
    return {**catalog, "places": places[:limit], "mode": mode}


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
    Costs credits or active plan before any cached/generated brief is returned.
    Permanent cache by facility_id; coordinate cache fallback for community pins."""
    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    # Full camp briefs are a paid/token feature even when the AI text is cached.
    if user:
        if has_active_plan(user) or user.get("is_admin"):
            pass
        else:
            cost = AI_COSTS["campsite_insight"]
            if not deduct_credits(user["id"], cost, f"Campsite insight — {body.name}"):
                raise HTTPException(402, detail={
                    "code": "insufficient_credits",
                    "message": f"Campsite briefs cost {cost} credits.",
                    "earn_hint": True,
                })
    else:
        raise HTTPException(402, detail={
            "code": "login_required",
            "message": "Sign in or join a plan to view full camp briefs.",
            "earn_hint": True,
        })

    # Permanent cache by facility_id (RIDB campsites) — returned only after access is authorized
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
    _check_credits(user, cost, f"Route brief — {body.trip_name}")
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
    _check_credits(user, cost, f"Packing list — {body.trip_name}")
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

    async def _try(query: str):
        try:
            resp = await client.get(
                f"https://api.mapbox.com/geocoding/v5/mapbox.places/{httpx.utils.quote(query, safe='')}.json",
                params={"access_token": token, "limit": 1, "country": "us"},
            )
            resp.raise_for_status()
            feats = resp.json().get("features", [])
            if feats:
                return feats[0]["geometry"]["coordinates"], feats[0].get("place_name", query)
        except Exception:
            pass
        return None, None

    async with sem:
        # Try full name first
        coords, place_name = await _try(name)
        if coords:
            wp["lat"], wp["lng"], wp["geocoded_name"] = coords[1], coords[0], place_name
            return wp

        # Fallback: strip leading comma-parts (handles "Road Mile 24, Area, State" → "Area, State" → "State")
        parts = [p.strip() for p in name.split(",")]
        for i in range(1, len(parts)):
            shorter = ", ".join(parts[i:])
            if shorter:
                coords, place_name = await _try(shorter)
                if coords:
                    wp["lat"], wp["lng"], wp["geocoded_name"] = coords[1], coords[0], place_name
                    return wp

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
