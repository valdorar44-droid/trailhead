"""Trailhead FastAPI server. All API routes."""
from __future__ import annotations
import asyncio, os, json, uuid, secrets, xml.etree.ElementTree as ET, time, hashlib, re, sqlite3, smtplib, html, base64, binascii, math, heapq
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
from urllib.parse import quote, unquote
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Any, Optional
import httpx
import bcrypt as _bcrypt_lib
from jose import jwt, JWTError

from config.settings import settings
from ai.planner import plan_trip, chat_guide, edit_trip, plan_trip_from_conversation
from dashboard.route_enrichment import enrich_trip_along_route
from dashboard.adventure_intelligence import build_mission_control
from dashboard.provider_registry import list_provider_metadata
from dashboard.marine_chart_provider import (
    MarineBounds,
    fishing_conditions,
    marine_chart_profile,
    marine_spot_cards,
    nearest_marine_station,
    parse_draft_feet,
    parse_ndbc_realtime,
    suggested_corridor,
)
from dashboard.hydro_provider import LOCAL_HYDRO_DIR, HYDRO_DIR, hydro_profile, read_hydro_manifest
from dashboard.water_routing_provider import route_with_water_graph, water_graph_manifest
from scripts.explore_sources.travel.ranking import rank_experiences
from scripts.explore_sources.travel.viator.client import ViatorClient, config_from_env as viator_config_from_env
from scripts.explore_sources.travel.viator.normalize_viator import normalize_viator_products
from scripts.explore_sources.offers.disclosure import (
    PARTNER_BOOKING_DISCLOSURE_KIND,
    PARTNER_BOOKING_DISCLOSURE_LABEL,
)
from scripts.explore_sources.offers.providers.base import OfferSearchQuery, OfferSearchResult
from scripts.explore_sources.offers.providers.outdoorsy import (
    OutdoorsyProvider,
    config_from_env as outdoorsy_config_from_env,
)
from ingestors.ridb import get_campsites_near, get_campsites_search, get_facility_detail, get_campsite_detail as get_ridb_campsite_detail
from ingestors.osm import get_osm_campsites, get_osm_campsite_detail, get_water_sources, get_trailheads, get_trails, get_viewpoints, get_peaks, get_hot_springs, get_fuel_stations, get_service_places
from ingestors.nps import get_nps_places, nps_enabled
from ingestors.geoapify import get_geoapify_places
from ingestors.usfs import get_usfs_recreation_sites
from ingestors.provider_guard import provider_call_snapshot, record_provider_call, runtime_cached_call
from ingestors.blm import get_blm_campsites, get_blm_campsite_detail, get_blm_recreation_sites
from ingestors.international_registry import international_camp_tasks
from ingestors.pakistan_curated import get_pakistan_curated_treks
from ingestors.conditions import get_provider_conditions_along_route, get_provider_conditions_near, get_wfigs_fire_perimeters
from ingestors.pakistan_confidence import pakistan_route_confidence
from db.store import (
    save_trip, get_trip, add_community_pin, get_community_pins, find_duplicate_community_pin,
    save_audio_guide, get_audio_guide, get_cached, set_cached, clear_cached_rows, get_route_cached, set_route_cached,
    create_user, create_oauth_user, get_user_by_oauth, link_user_oauth,
    get_user_by_email, get_user_by_username, get_user_by_id, get_user_by_referral_code,
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
    has_extreme_plan, create_extreme_demo_session, end_extreme_demo_session,
    log_extreme_ledger_event, save_extreme_trip_metadata, stage_extreme_copilot_action, confirm_extreme_copilot_action,
    list_extreme_sessions, list_extreme_ledger_events, get_extreme_ledger_summary,
    get_extreme_admin_config, set_extreme_admin_config,
    authorize_offline_download,
    save_push_token, get_push_token,
    get_push_campaign_recipients, count_push_campaign_recipients,
    create_push_campaign, record_push_campaign_delivery, finalize_push_campaign,
    list_push_campaigns, get_push_campaign,
    create_support_thread, list_support_threads_for_user, list_support_threads_admin,
    get_support_thread, add_support_message, update_support_thread_status,
    list_user_trips, save_account_trip, save_trip_geometry,
    create_plan_job, get_plan_job, update_plan_job,
    submit_field_report, get_field_reports, get_field_report_summary,
    add_camp_comment, get_camp_comments,
    upsert_canonical_place, canonical_place_id, get_place,
    add_place_comment, get_place_comments, add_place_photo, get_place_photos, get_place_photo_image,
    add_place_edit_suggestion, get_place_edit_suggestions, update_place_edit_suggestion_status,
    list_place_comments, update_place_comment_status, list_place_photos, update_place_photo_status,
    save_place_reservation_alert, get_place_reservation_alerts,
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
from ingestors.active import get_active_activities, get_active_campgrounds
from ingestors.fcc import get_mobile_coverage

LEGACY_PLACE_PROVIDERS = {"google", "foursquare", "fsq"}

def _legacy_place_source(value: object) -> bool:
    text = str(value or "").lower()
    return any(source in text for source in LEGACY_PLACE_PROVIDERS)

def strip_lightweight_google_rich_fields(place: dict) -> dict:
    """Compatibility scrubber for old cached provider records.

    Runtime place discovery no longer uses Google/Foursquare. This keeps stale
    cached objects from leaking paid/legacy provider fields through shared
    card/smart-pack code paths. Geoapify remains allowed as a lightweight
    hosted/open-data coverage source.
    """
    if not isinstance(place, dict):
        return place
    if _legacy_place_source(place.get("source")) or _legacy_place_source(place.get("source_label")):
        for key in (
            "google_maps_uri",
            "reviews",
            "hours",
            "photos",
            "photo_url",
            "provider_place_id",
            "place_id",
            "rich_detail_available",
            "rich_detail_locked",
            "rich_detail_reason",
        ):
            place.pop(key, None)
    return place

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
    "explore_category_day": 8,
    "paid_place_detail": 5,
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

SIGNUP_BONUS       = 20
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

DASH    = Path(__file__).parent / "dashboard.html"
LANDING = Path(__file__).parent / "landing.html"
ADMIN   = Path(__file__).parent / "admin.html"
WEB_DIST = Path(__file__).parent / "site" / "dist"
BLOG_INDEX = Path(__file__).parent / "blog.html"
BLOG_DIR = Path(__file__).parent / "blog"
EXPLORE_CATALOG = Path(__file__).parent / "explore_catalog_v1.json"
EXPLORE_CATALOG_V3 = Path(__file__).parent / "explore_catalog_v3.json"
EXPLORE_BOOKABLE_EXPERIENCES = Path(__file__).parent / "explore_bookable_experiences_v1.json"
EXPLORE_TOURS_VIATOR = Path(__file__).parent / "explore_tours_viator_v1.json"
EXPLORE_ASSETS = Path(__file__).parent / "explore_assets"
APP_ICON = Path(__file__).resolve().parents[1] / "mobile" / "assets" / "icon.png"

app = FastAPI(title="Trailhead API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
if EXPLORE_ASSETS.exists():
    app.mount("/assets/explore", StaticFiles(directory=str(EXPLORE_ASSETS)), name="explore-assets")
if (WEB_DIST / "_astro").exists():
    app.mount("/_astro", StaticFiles(directory=str(WEB_DIST / "_astro")), name="astro-assets")
if (WEB_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(WEB_DIST / "assets")), name="site-assets")

BLOG_POSTS = {
    "offline-maps-are-not-magic": "offline-maps-are-not-magic.html",
    "web-planning-phone-navigation": "web-planning-phone-navigation.html",
    "trailhead-vs-ioverlander": "trailhead-vs-ioverlander.html",
}


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    from math import asin, cos, radians, sin, sqrt
    r = 6371000.0
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * r * asin(sqrt(a))


UNSUPPORTED_ROUTE_TERMS = re.compile(
    r"\b("
    r"uk|united kingdom|england|scotland|wales|ireland|london|europe|france|germany|spain|italy|"
    r"australia|new zealand|africa|asia|china|japan|india|russia|iceland|greenland|hawaii"
    r")\b",
    re.I,
)

SUPPORTED_ROUTE_TERMS = re.compile(
    r"\b("
    r"united states|usa|u\.s\.|canada|mexico|finland|alaska|"
    r"al|ak|az|ar|ca|co|ct|de|fl|ga|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|"
    r"ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc|fi"
    r")\b",
    re.I,
)

def _route_validation_result(ok: bool, reason: str = "", details: list[str] | None = None,
                             severity: str = "block", supported_region: bool = True) -> dict:
    return {
        "ok": ok,
        "severity": severity,
        "reason": reason,
        "details": details or [],
        "supported_region": supported_region,
    }

def _validate_route_waypoints(waypoints: list[dict], context: str = "") -> dict:
    names = " ".join(str(w.get("name", "")) for w in waypoints if isinstance(w, dict))
    text = f"{context} {names}"
    if UNSUPPORTED_ROUTE_TERMS.search(text) and not re.search(r"\bfinland\b|\bfi\b", text, re.I):
        return _route_validation_result(
            False,
            "This route leaves Trailhead's supported planning regions.",
            ["Trailhead currently supports the United States, Canada, Mexico, and Finland.", "Start a separate plan inside a supported region."],
            supported_region=False,
        )

    points: list[dict] = []
    for wp in waypoints:
        if not isinstance(wp, dict):
            continue
        lat = wp.get("lat")
        lng = wp.get("lng")
        try:
            lat = float(lat)
            lng = float(lng)
        except (TypeError, ValueError):
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            points.append({"lat": lat, "lng": lng, "name": str(wp.get("name", "stop"))})

    for a, b in zip(points, points[1:]):
        miles = _haversine_m(a["lat"], a["lng"], b["lat"], b["lng"]) / 1609.344
        lng_span = abs(a["lng"] - b["lng"])
        if miles > 2800 and lng_span > 45:
            return _route_validation_result(
                False,
                "This plan contains an unrealistic over-water or unsupported long jump.",
                [f"{a['name']} to {b['name']} is about {round(miles):,} miles direct.", "Break the trip into supported land routes before saving or navigating."],
            )
    return _route_validation_result(True)

def _validate_route_locations(locations: list[dict]) -> dict:
    for a, b in zip(locations, locations[1:]):
        miles = _haversine_m(a["lat"], a["lon"], b["lat"], b["lon"]) / 1609.344
        lng_span = abs(a["lon"] - b["lon"])
        if miles > 2800 and lng_span > 45:
            return _route_validation_result(
                False,
                "Route request looks like an unsupported cross-ocean jump.",
                [f"Adjacent route anchors are about {round(miles):,} miles apart.", "Add realistic land-route stops or keep the route inside a supported region."],
            )
    return _route_validation_result(True)


def _clean_source_badge(item: dict | None, fallback: str = "Trailhead") -> str:
    if not item:
        return fallback
    raw = (
        item.get("source_badge")
        or item.get("verified_source")
        or item.get("source_label")
        or item.get("source")
        or fallback
    )
    text = re.sub(r"\s+", " ", str(raw or fallback)).strip()
    return text[:42] or fallback


def _route_position(item: dict | None) -> dict:
    if not item:
        return {}
    out: dict = {}
    for key in ("route_progress", "route_progress_mi", "route_distance_mi", "route_segment_index"):
        value = item.get(key)
        if value is not None:
            out[key] = value
    return out


def _event_warning(level: str = "info", message: str = "") -> dict:
    return {"level": level, "message": message} if message else {"level": level}


def _timeline_event(
    event_type: str,
    title: str,
    day: int,
    item: dict | None = None,
    description: str = "",
    warning_level: str = "info",
    quick_actions: list[str] | None = None,
) -> dict:
    point: dict | None = None
    if item and item.get("lat") is not None and item.get("lng") is not None:
        try:
            point = {"lat": float(item["lat"]), "lng": float(item["lng"])}
        except Exception:
            point = None
    return {
        "type": event_type,
        "title": re.sub(r"\s+", " ", str(title or event_type).strip())[:160],
        "description": _planner_clean_text(description or (item or {}).get("description") or (item or {}).get("summary") or "", 360) if "_planner_clean_text" in globals() else str(description or "")[:360],
        "day": day,
        "source": _clean_source_badge(item),
        "warning_level": warning_level,
        "point": point,
        "route_position": _route_position(item),
        "quick_actions": quick_actions or [],
    }


def _same_point(a: dict | None, b: dict | None, threshold_mi: float = 1.5) -> bool:
    if not a or not b or a.get("lat") is None or a.get("lng") is None or b.get("lat") is None or b.get("lng") is None:
        return False
    try:
        miles = _haversine_m(float(a["lat"]), float(a["lng"]), float(b["lat"]), float(b["lng"])) / 1609.344
        return miles <= threshold_mi
    except Exception:
        return False


def _items_for_day(items: list[dict], day: int) -> list[dict]:
    return [
        item for item in items or []
        if int(item.get("recommended_day") or item.get("day") or 0) == day
    ]


def _build_trip_timeline(
    plan: dict,
    campsites: list[dict] | None = None,
    gas_stations: list[dict] | None = None,
    route_pois: list[dict] | None = None,
    request_context: str = "",
) -> dict:
    """Create a compact, optional timeline contract for AI Planner and Route Builder."""
    campsites = campsites or []
    gas_stations = gas_stations or []
    route_pois = route_pois or []
    days = plan.get("daily_itinerary") if isinstance(plan.get("daily_itinerary"), list) else []
    waypoints = plan.get("waypoints") if isinstance(plan.get("waypoints"), list) else []
    duration = int(plan.get("duration_days") or len(days) or 0)
    warnings: list[dict] = []
    out_days: list[dict] = []

    for idx, day_plan in enumerate(days, start=1):
        if not isinstance(day_plan, dict):
            continue
        try:
            day_num = int(day_plan.get("day") or idx)
        except Exception:
            day_num = idx
        day_wps = [wp for wp in waypoints if int(wp.get("day") or 0) == day_num]
        prev_wps = [wp for wp in waypoints if int(wp.get("day") or 0) < day_num]
        previous_overnight = next((wp for wp in reversed(prev_wps) if wp.get("type") in {"camp", "motel"}), None)
        start = previous_overnight or (day_wps[0] if day_wps else None)
        overnight_wp = next((wp for wp in reversed(day_wps) if wp.get("type") in {"camp", "motel"}), None)
        matching_camp = next(
            (
                camp for camp in campsites
                if int(camp.get("recommended_day") or 0) == day_num
                or (overnight_wp and (camp.get("name") == overnight_wp.get("name") or _same_point(camp, overnight_wp, 12)))
            ),
            None,
        )
        rest_day = int(day_plan.get("est_miles") or 0) == 0 or str(day_plan.get("road_type") or "").lower() == "none"
        events: list[dict] = []
        if start:
            events.append(_timeline_event(
                "start" if day_num == 1 else "depart",
                "Start" if day_num == 1 else "Break camp",
                day_num,
                start,
                start.get("description") or "",
                quick_actions=["navigate"],
            ))
        if not rest_day:
            miles = int(day_plan.get("est_miles") or 0)
            warning_level = "warn" if (day_num == 1 and miles > 250) or miles > 350 else "info"
            if warning_level == "warn":
                warnings.append(_event_warning("warn", f"Day {day_num} is planned at {miles} mi. Recheck pacing before departure."))
            events.append({
                "type": "drive",
                "title": str(day_plan.get("title") or f"Day {day_num} drive")[:160],
                "description": _planner_clean_text(day_plan.get("description") or "", 420) if "_planner_clean_text" in globals() else str(day_plan.get("description") or "")[:420],
                "day": day_num,
                "source": "AI intent + route corridor",
                "warning_level": warning_level,
                "distance_mi": miles,
                "road_type": str(day_plan.get("road_type") or "mixed"),
                "quick_actions": ["start_day", "swap_stop"],
            })
        else:
            events.append({
                "type": "rest",
                "title": str(day_plan.get("title") or f"Day {day_num} rest day")[:160],
                "description": _planner_clean_text(day_plan.get("description") or "Rest day at camp.", 420) if "_planner_clean_text" in globals() else str(day_plan.get("description") or "Rest day at camp.")[:420],
                "day": day_num,
                "source": "AI intent",
                "warning_level": "info",
                "quick_actions": ["add_place", "swap_camp"],
            })

        for gas in _items_for_day(gas_stations, day_num)[:3]:
            events.append(_timeline_event(
                "fuel",
                gas.get("name") or "Fuel stop",
                day_num,
                gas,
                gas.get("address") or gas.get("fuel_types") or "Fuel found along the route corridor.",
                quick_actions=["add_stop", "swap_fuel"],
            ))
        for wp in day_wps:
            if wp.get("type") not in {"waypoint", "town", "shower", "fuel"}:
                continue
            if wp.get("type") == "fuel" and any(_same_point(wp, gas, 3) for gas in _items_for_day(gas_stations, day_num)):
                continue
            events.append(_timeline_event(
                "fuel" if wp.get("type") == "fuel" else "poi",
                wp.get("name") or "Route stop",
                day_num,
                wp,
                wp.get("description") or wp.get("notes") or "",
                warning_level="review" if wp.get("needs_review") else "info",
                quick_actions=["open", "swap_stop"],
            ))
        for poi in _items_for_day(route_pois, day_num)[:6]:
            if any(_same_point(poi, wp, 2) for wp in day_wps):
                continue
            events.append(_timeline_event(
                "poi",
                poi.get("name") or poi.get("type") or "Place",
                day_num,
                poi,
                poi.get("summary") or poi.get("address") or poi.get("subtype") or "Route-corridor place.",
                quick_actions=["add_to_day", "open"],
            ))

        if overnight_wp or matching_camp:
            source_item = matching_camp or overnight_wp
            warning_level = "review" if overnight_wp and overnight_wp.get("needs_review") else "info"
            events.append(_timeline_event(
                "overnight",
                (source_item or {}).get("name") or "Overnight",
                day_num,
                source_item,
                (source_item or {}).get("description") or (source_item or {}).get("notes") or "Overnight stop for this day.",
                warning_level=warning_level,
                quick_actions=["swap_camp", "add_rest_day"],
            ))
        elif not rest_day and day_num < duration:
            message = f"Day {day_num} needs a verified camp or lodging stop."
            warnings.append(_event_warning("warn", message))
            events.append({
                "type": "overnight",
                "title": "Choose overnight",
                "description": message,
                "day": day_num,
                "source": "Trailhead",
                "warning_level": "warn",
                "quick_actions": ["scan_camps", "add_lodging"],
            })

        out_days.append({
            "day": day_num,
            "title": str(day_plan.get("title") or f"Day {day_num}")[:160],
            "summary": _planner_clean_text(day_plan.get("description") or "", 360) if "_planner_clean_text" in globals() else str(day_plan.get("description") or "")[:360],
            "distance_mi": int(day_plan.get("est_miles") or 0),
            "road_type": str(day_plan.get("road_type") or "mixed"),
            "events": events,
            "warning_level": "warn" if any(ev.get("warning_level") in {"warn", "review"} for ev in events) else "info",
        })

    offline_ready = {
        "map": False,
        "navigation": False,
        "places": bool(campsites or gas_stations or route_pois),
        "topo": False,
        "trails": False,
        "trip_download": False,
        "message": "Download this trip to save the route corridor plus fuel, camps, and places for offline discovery.",
    }
    if request_context and UNSUPPORTED_ROUTE_TERMS.search(request_context) and not re.search(r"\bfinland\b|\bfi\b", request_context, re.I):
        warnings.append(_event_warning("warn", "Request mentioned a region outside current Trailhead planner support."))
    return {
        "schema_version": 1,
        "days": out_days,
        "warnings": warnings[:12],
        "offline_readiness": offline_ready,
    }


def _title_case_category(value: object) -> str:
    text = re.sub(r"[_-]+", " ", str(value or "").strip())
    return " ".join(part.capitalize() for part in text.split()) or "Explore"


def _v3_explore_group(category: str) -> str:
    normalized = str(category or "").lower()
    if normalized in {"campground", "dispersed_camp", "rv_park"}:
        return "camping"
    if normalized in {"trail", "trailhead", "forest_road", "offroad_route", "scenic_drive"}:
        return "trails"
    if normalized in {"park", "public_land", "forest", "wilderness"}:
        return "parks"
    if normalized in {"waterfall", "lake", "glacier", "hot_spring", "river", "shore"}:
        return "water"
    if normalized in {"climbing_area", "bouldering_area", "peak", "viewpoint"}:
        return "scenic"
    if normalized in {"historic_site", "monument"}:
        return "monuments"
    if normalized in {"fuel", "resupply"}:
        return "services"
    return "explore"


def _v3_source_quality(value: object) -> str:
    normalized = str(value or "").lower()
    return {
        "official_source": "official",
        "open_community_data": "open",
        "curated_trailhead": "curated",
        "needs_verification": "needs_verification",
    }.get(normalized, normalized or "open")


def _v3_primary_source(place: dict) -> dict:
    sources = place.get("sources") if isinstance(place.get("sources"), list) else []
    for source in sources:
        if isinstance(source, dict):
            return source
    return {}


def _v3_primary_media(place: dict) -> dict:
    media = place.get("media") if isinstance(place.get("media"), list) else []
    for item in media:
        if isinstance(item, dict) and item.get("url"):
            return item
    source_pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    for item in source_pack.get("photos") or []:
        if isinstance(item, dict) and item.get("url"):
            return item
    for key in ("things_to_do", "things_to_see", "visitor_centers", "campgrounds"):
        for item in source_pack.get(key) or []:
            if isinstance(item, dict) and item.get("image_url"):
                return {
                    "url": item.get("image_url"),
                    "caption": item.get("image_caption") or item.get("title") or place.get("name"),
                    "credit": item.get("image_credit") or source_pack.get("primary") or "",
                    "license": item.get("image_license") or source_pack.get("license") or "",
                }
    return {}


def _v3_source_pack(place: dict) -> dict:
    source_pack = place.get("source_pack")
    return source_pack if isinstance(source_pack, dict) else {}


def _v3_lat_lng(place: dict) -> tuple[float | None, float | None]:
    try:
        lat = float(place.get("lat")) if place.get("lat") is not None else None
        lng = float(place.get("lng")) if place.get("lng") is not None else None
    except Exception:
        return None, None
    if lat is None or lng is None or not math.isfinite(lat) or not math.isfinite(lng):
        return None, None
    return lat, lng


def _v3_distance_miles(a: dict, b: dict) -> float | None:
    lat1, lng1 = _v3_lat_lng(a)
    lat2, lng2 = _v3_lat_lng(b)
    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return None
    radius_mi = 3958.7613
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    h = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return 2 * radius_mi * math.asin(min(1.0, math.sqrt(h)))


def _v3_nearby_region_match(parent: dict, child: dict) -> bool:
    parent_country = str(parent.get("country") or "").strip().lower()
    child_country = str(child.get("country") or "").strip().lower()
    if parent_country and child_country and parent_country != child_country:
        return False
    parent_region = str(parent.get("region") or parent.get("admin") or "").strip().lower()
    child_region = str(child.get("region") or child.get("admin") or "").strip().lower()
    if parent_region and child_region and parent_region == child_region:
        return True
    return bool(parent_country and child_country and parent_country == child_country)


def _v3_source_pack_child_item(place: dict, *, kind: str, distance_mi: float) -> dict:
    source_pack = _v3_source_pack(place)
    primary_source = _v3_primary_source(place)
    media = _v3_primary_media(place)
    title = str(place.get("name") or "Place").strip()
    source_title = (
        source_pack.get("primary")
        or primary_source.get("title")
        or primary_source.get("publisher")
        or primary_source.get("source")
        or "Open source"
    )
    source_url = source_pack.get("official_url") or primary_source.get("url") or primary_source.get("source_url") or ""
    description = str(place.get("description") or place.get("summary") or "").strip()
    lat, lng = _v3_lat_lng(place)
    return {
        "kind": kind,
        "source": primary_source.get("source") or place.get("quality") or "open_source",
        "source_id": str(place.get("id") or title),
        "title": title,
        "description": description,
        "url": source_url,
        "lat": lat,
        "lng": lng,
        "image_url": media.get("url") or "",
        "image_caption": media.get("caption") or title,
        "image_credit": media.get("credit") or source_title,
        "image_license": media.get("license") or source_pack.get("license") or "",
        "source_label": primary_source.get("attribution") or source_title,
        "category": str(place.get("category") or kind).replace("_", " "),
        "tags": [str(tag) for tag in (place.get("tags") or []) if str(tag).strip()][:8],
        "distance_mi": round(distance_mi, 1),
    }


def _v3_child_kind(category: str) -> str:
    normalized = str(category or "").strip().lower()
    if normalized in {"glacier", "waterfall", "lake", "peak", "trail", "park"}:
        return normalized
    if normalized == "historic_site":
        return "historic_site"
    if normalized == "public_land":
        return "protected_area"
    return "place"


def _attach_v3_nearby_source_items(profiles: list[dict], raw_places: list[dict]) -> None:
    by_id = {str(profile.get("id") or ""): profile for profile in profiles}
    source_places = [place for place in raw_places if isinstance(place, dict)]
    child_categories = {"glacier", "waterfall", "lake", "peak", "viewpoint", "historic_site", "trail", "park", "public_land"}
    hub_categories = {"park", "public_land", "glacier"}
    for parent in source_places:
        parent_id = str(parent.get("id") or "")
        profile = by_id.get(parent_id)
        if not profile:
            continue
        parent_pack = profile.get("source_pack") if isinstance(profile.get("source_pack"), dict) else {}
        if parent_pack.get("nps_park_code"):
            continue
        parent_category = str(parent.get("category") or "").strip().lower()
        if parent_category not in hub_categories:
            continue
        existing_children = parent_pack.get("things_to_see") if isinstance(parent_pack.get("things_to_see"), list) else []
        if len(existing_children) >= 8:
            continue
        nearby: list[tuple[float, dict]] = []
        for child in source_places:
            if child is parent:
                continue
            child_category = str(child.get("category") or "").strip().lower()
            if child_category not in child_categories:
                continue
            if _explore_title_merge_key({"name": child.get("name")}) == _explore_title_merge_key({"name": parent.get("name")}):
                continue
            if not _v3_nearby_region_match(parent, child):
                continue
            distance = _v3_distance_miles(parent, child)
            if distance is None or distance <= 0.05 or distance > 120:
                continue
            nearby.append((distance, child))
        if not nearby:
            continue
        nearby.sort(key=lambda item: (
            0 if _v3_primary_media(item[1]).get("url") else 1,
            item[0],
            str(item[1].get("name") or ""),
        ))
        additions = [
            _v3_source_pack_child_item(child, kind=_v3_child_kind(str(child.get("category") or "")), distance_mi=distance)
            for distance, child in nearby[: max(0, 16 - len(existing_children))]
        ]
        if not additions:
            continue
        merged_pack = dict(parent_pack)
        merged_pack["things_to_see"] = _merge_unique_dicts(existing_children, additions, ("source_id", "title"))
        topics = [*(merged_pack.get("topics") or []), "nearby landmarks", "map stops"]
        for item in additions:
            if item.get("category"):
                topics.append(str(item.get("category")))
        merged_pack["topics"] = sorted({str(topic).strip() for topic in topics if str(topic).strip()})
        if not merged_pack.get("source_note"):
            merged_pack["source_note"] = "Nearby source-linked places"
        profile["source_pack"] = merged_pack


def _v3_merge_source_pack(existing: dict, generated: dict) -> dict:
    if not existing:
        return generated
    merged = {**generated, **existing}
    for key in ("sources", "photos", "things_to_do", "things_to_see", "visitor_centers", "campgrounds", "alerts"):
        values = []
        for item in [*(generated.get(key) or []), *(existing.get(key) or [])]:
            if isinstance(item, dict) and item not in values:
                values.append(item)
        if values:
            merged[key] = values
    for key in ("activities", "topics", "fees"):
        values = []
        for item in [*(generated.get(key) or []), *(existing.get(key) or [])]:
            text = str(item or "").strip()
            if text and text not in values:
                values.append(text)
        if values:
            merged[key] = values
    return merged


def _explore_v3_place_to_profile(place: dict, rank: int = 900000) -> dict:
    place_id = str(place.get("id") or f"place:v3:{rank}")
    title = str(place.get("name") or place.get("title") or "Explore stop").strip()
    category = str(place.get("category") or "explore").strip()
    category_title = _title_case_category(category)
    region = str(place.get("region") or place.get("admin") or place.get("country") or "").strip()
    summary_text = str(place.get("summary") or place.get("description") or "").strip()
    description = str(place.get("description") or summary_text or f"{title} is mapped from open source data.").strip()
    tags = [str(tag) for tag in (place.get("tags") or []) if str(tag).strip()]
    card = place.get("card") if isinstance(place.get("card"), dict) else {}
    primary_source = _v3_primary_source(place)
    existing_source_pack = _v3_source_pack(place)
    primary_media = _v3_primary_media(place)
    source_title = (
        existing_source_pack.get("primary")
        or primary_source.get("title")
        or primary_source.get("publisher")
        or primary_source.get("source")
        or card.get("source_badge")
        or "Open source"
    )
    source_url = existing_source_pack.get("official_url") or primary_source.get("url") or primary_source.get("source_url") or ""
    image_url = primary_media.get("url") or ""
    image_credit = primary_media.get("credit") or primary_media.get("caption") or source_title or ""
    quality = _v3_source_quality(place.get("quality"))
    lat = place.get("lat")
    lng = place.get("lng")
    try:
        lat_value = float(lat) if lat is not None else None
        lng_value = float(lng) if lng is not None else None
    except Exception:
        lat_value = None
        lng_value = None
    hook = str(card.get("headline") or title).strip()
    card_summary = str(card.get("summary") or summary_text or description).strip()
    quick_facts = [str(item) for item in (card.get("quick_facts") or []) if str(item).strip()]
    source_pack_sources = []
    for source in place.get("sources") or []:
        if not isinstance(source, dict):
            continue
        source_pack_sources.append({
            "title": source.get("title") or source.get("publisher") or source.get("source") or source_title,
            "publisher": source.get("publisher") or source.get("source") or source_title,
            "url": source.get("url") or source.get("source_url") or "",
            "kind": source.get("kind") or source.get("source") or quality,
        })
    photos = []
    for item in place.get("media") or []:
        if isinstance(item, dict) and item.get("url"):
            photos.append({
                "url": item.get("url"),
                "caption": item.get("caption") or title,
                "credit": item.get("credit") or source_title,
                "license": item.get("license") or "",
            })
    for item in existing_source_pack.get("photos") or []:
        if isinstance(item, dict) and item.get("url") and all(photo.get("url") != item.get("url") for photo in photos):
            photos.append({
                "url": item.get("url"),
                "caption": item.get("caption") or title,
                "credit": item.get("credit") or source_title,
                "license": item.get("license") or existing_source_pack.get("license") or "",
            })
    generated_source_pack = {
        "quality": quality,
        "primary": source_title,
        "official_url": source_url,
        "sources": source_pack_sources,
        "photos": photos,
        "activities": place.get("amenities") or [],
        "topics": tags,
        "source_note": card.get("source_badge") or source_title,
        "extract": description,
        "booking_url": (place.get("reservations") or {}).get("url") if isinstance(place.get("reservations"), dict) else "",
        "license": primary_source.get("license") or existing_source_pack.get("license") or "",
    }
    return {
        "id": place_id,
        "category": category,
        "subcategories": place.get("subcategories") or [],
        "sources": place.get("sources") or [],
        "source_ids": place.get("source_ids") or [],
        "quality": place.get("quality") or quality,
        "quality_score": place.get("quality_score"),
        "verified": bool(place.get("verified")),
        "search_aliases": place.get("search_aliases") or [],
        "search_blob": place.get("search_blob") or "",
        "best_season": place.get("best_season") or "",
        "access": place.get("access") or "",
        "safety": place.get("safety") or "",
        "amenities": place.get("amenities") or [],
        "reservations": place.get("reservations") or {},
        "media": place.get("media") or [],
        "geometry": place.get("geometry"),
        "linked_trail_ids": place.get("linked_trail_ids") or [],
        "card": {
            "title": title,
            "headline": hook,
            "summary": card_summary,
            "highlight": str(card.get("highlight") or card_summary).strip(),
            "region": region,
            "facts": quick_facts,
            **card,
        },
        "summary": {
            "id": place_id,
            "title": title,
            "category": category_title,
            "explore_group": _v3_explore_group(category),
            "state": region,
            "region": region,
            "lat": lat_value,
            "lng": lng_value,
            "rank": rank,
            "hero_rank": rank,
            "tags": tags,
            "badges": [category_title],
            "hook": hook,
            "short_description": card_summary,
            "thumbnail_url": image_url,
            "image_url": image_url,
            "image_credit": image_credit,
            "image_license": primary_media.get("license") or "",
            "source_url": source_url,
            "source_title": source_title,
        },
        "profile": {
            "hook": hook,
            "summary": card_summary,
            "story": description,
            "why_it_matters": card_summary,
            "what_to_know": str(place.get("safety") or "Check current access, closures, permits, weather, and local rules before you go."),
            "best_time_to_stop": str(place.get("best_season") or "Check season and current conditions."),
            "access_notes": str(place.get("access") or "Open the source link and map before committing to the stop."),
            "nearby_context": "Use nearby camps, trails, services, weather, and map context from this stop.",
        },
        "audio_script": description,
        "wiki_extract": description if any(str(source.get("source") or "").lower() == "wikidata" for source in place.get("sources") or [] if isinstance(source, dict)) else "",
        "source_pack": _v3_merge_source_pack(existing_source_pack, generated_source_pack),
        "facts": {
            "coordinates": f"{lat_value:.5f}, {lng_value:.5f}" if lat_value is not None and lng_value is not None else "",
            "source_url": source_url,
            "source_title": source_title,
            "official_url": source_url,
            "source_quality": quality,
            "last_updated": place.get("last_updated"),
        },
        "attribution": primary_source.get("attribution") or source_title,
    }


def _load_explore_catalog_v3_profiles() -> list[dict]:
    if not EXPLORE_CATALOG_V3.exists():
        return []
    try:
        catalog = json.loads(EXPLORE_CATALOG_V3.read_text())
    except Exception:
        return []
    raw_places = [place for place in catalog.get("places") or [] if isinstance(place, dict)]
    profiles = []
    for idx, place in enumerate(raw_places, start=1):
        if isinstance(place, dict):
            profiles.append(_explore_v3_place_to_profile(place, rank=900000 + idx))
    _attach_v3_nearby_source_items(profiles, raw_places)
    return profiles


def _explore_title_merge_key(place: dict) -> str:
    summary = place.get("summary") if isinstance(place.get("summary"), dict) else {}
    title = str(summary.get("title") or place.get("name") or "").lower()
    title = re.sub(r"&", " and ", title)
    title = re.sub(r"[^a-z0-9]+", " ", title)
    return re.sub(r"\s+", " ", title).strip()


def _explore_richer_text(current: object, candidate: object) -> object:
    current_text = str(current or "").strip()
    candidate_text = str(candidate or "").strip()
    if len(candidate_text) > len(current_text) + 60:
        return candidate
    return current if current_text else candidate


def _merge_unique_dicts(primary: list, secondary: list, key_fields: tuple[str, ...]) -> list:
    merged = []
    seen = set()
    for item in [*(primary or []), *(secondary or [])]:
        if not isinstance(item, dict):
            continue
        key = tuple(str(item.get(field) or "").strip().lower() for field in key_fields)
        if not any(key) or key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def _merge_explore_sidecar_enrichment(base: dict, sidecar: dict) -> dict:
    enriched = dict(base)
    base_summary = dict(enriched.get("summary") or {})
    side_summary = sidecar.get("summary") if isinstance(sidecar.get("summary"), dict) else {}
    for key in ("image_url", "thumbnail_url", "image_credit", "image_license", "source_url", "source_title"):
        if not base_summary.get(key) and side_summary.get(key):
            base_summary[key] = side_summary.get(key)
    for key in ("hook", "short_description"):
        if side_summary.get(key):
            base_summary[key] = _explore_richer_text(base_summary.get(key), side_summary.get(key))
    enriched["summary"] = base_summary

    base_profile = dict(enriched.get("profile") or {})
    side_profile = sidecar.get("profile") if isinstance(sidecar.get("profile"), dict) else {}
    for key in ("summary", "story", "why_it_matters", "what_to_know", "best_time_to_stop", "access_notes", "nearby_context"):
        if side_profile.get(key):
            base_profile[key] = _explore_richer_text(base_profile.get(key), side_profile.get(key))
    enriched["profile"] = base_profile

    base_pack = enriched.get("source_pack") if isinstance(enriched.get("source_pack"), dict) else {}
    side_pack = sidecar.get("source_pack") if isinstance(sidecar.get("source_pack"), dict) else {}
    if side_pack:
        merged_pack = _v3_merge_source_pack(base_pack, side_pack)
        if side_pack.get("extract"):
            merged_pack["extract"] = _explore_richer_text(base_pack.get("extract"), side_pack.get("extract"))
        enriched["source_pack"] = merged_pack
    enriched["sources"] = _merge_unique_dicts(enriched.get("sources") or [], sidecar.get("sources") or [], ("url", "title", "publisher", "name"))
    enriched["media"] = _merge_unique_dicts(enriched.get("media") or [], sidecar.get("media") or [], ("url", "caption"))
    if sidecar.get("wiki_extract"):
        enriched["wiki_extract"] = _explore_richer_text(enriched.get("wiki_extract"), sidecar.get("wiki_extract"))
    if sidecar.get("audio_script"):
        enriched["audio_script"] = _explore_richer_text(enriched.get("audio_script"), sidecar.get("audio_script"))
    facts = dict(enriched.get("facts") or {})
    for key, value in (sidecar.get("facts") or {}).items():
        if value and not facts.get(key):
            facts[key] = value
    if facts:
        enriched["facts"] = facts
    return enriched


def _load_explore_catalog() -> dict:
    if EXPLORE_CATALOG.exists():
        try:
            catalog = json.loads(EXPLORE_CATALOG.read_text())
            places = list(catalog.get("places") or [])
            seen = {str(place.get("id") or "") for place in places if isinstance(place, dict)}
            id_to_index = {str(place.get("id") or ""): idx for idx, place in enumerate(places) if isinstance(place, dict)}
            title_to_index = {
                key: idx
                for idx, place in enumerate(places)
                if isinstance(place, dict) and (key := _explore_title_merge_key(place))
            }
            for place in _load_explore_catalog_v3_profiles():
                place_id = str(place.get("id") or "")
                title_key = _explore_title_merge_key(place)
                if place_id in id_to_index:
                    places[id_to_index[place_id]] = _merge_explore_sidecar_enrichment(places[id_to_index[place_id]], place)
                    seen.add(place_id)
                    continue
                if title_key and title_key in title_to_index:
                    places[title_to_index[title_key]] = _merge_explore_sidecar_enrichment(places[title_to_index[title_key]], place)
                    seen.add(place_id)
                    continue
                if place_id not in seen:
                    places.append(place)
                    id_to_index[place_id] = len(places) - 1
                    if title_key:
                        title_to_index[title_key] = len(places) - 1
                    seen.add(place_id)
            merged = {
                **catalog,
                "catalog_id": "explore-us-top-v1-plus-real-data-v3",
                "source": f"{catalog.get('source') or 'Featured catalog'} + ExplorePlace v3 real-data sidecar",
                "count": len(places),
                "places": places,
            }
            return _apply_explore_story_overrides(merged)
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

def _catalog_place_category(summary: dict) -> str:
    group = str(summary.get("explore_group") or "").lower()
    category = str(summary.get("category") or "").lower()
    title = str(summary.get("title") or "").lower()
    hay = f"{group} {category} {title}"
    if "camp" in hay:
        return "camp"
    if any(term in hay for term in ("water", "lake", "coast", "shore", "marine", "reef", "river", "scenic")):
        return "viewpoint"
    if "trail" in hay:
        return "trail"
    if "visitor" in hay:
        return "visitor_center"
    if any(term in hay for term in ("historic", "monument", "heritage")):
        return "historic"
    if any(term in hay for term in ("park", "marine", "preserve", "refuge")):
        return "park"
    return "attraction"

def _explore_query_text(place: dict) -> str:
    summary = place.get("summary") or {}
    profile = place.get("profile") or {}
    source_pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    values = [
        place.get("id"),
        summary.get("title"),
        summary.get("state"),
        summary.get("category"),
        summary.get("explore_group"),
        summary.get("hook"),
        summary.get("short_description"),
        profile.get("summary"),
        profile.get("why_it_matters"),
        place.get("category"),
        " ".join(place.get("subcategories") or []),
        " ".join(place.get("search_aliases") or []),
        place.get("search_blob"),
        " ".join(summary.get("tags") or []),
        _explore_source_pack_query_text(source_pack),
    ]
    return " ".join(str(v or "") for v in values).lower()


def _explore_query_terms(query: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", str(query or "").lower()) if len(t) >= 2]


def _explore_query_tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", str(text or "").lower()))


EXPLORE_QUERY_GENERIC_TERMS = {
    "activity",
    "activities",
    "base",
    "camp",
    "campground",
    "campgrounds",
    "camping",
    "campsite",
    "campsites",
    "center",
    "centers",
    "centre",
    "centres",
    "do",
    "fall",
    "falls",
    "forest",
    "forests",
    "fuel",
    "gas",
    "glacier",
    "glaciers",
    "glamping",
    "hike",
    "hiking",
    "hut",
    "huts",
    "lodging",
    "monument",
    "monuments",
    "mountain",
    "mountains",
    "park",
    "parks",
    "parking",
    "place",
    "places",
    "peak",
    "peaks",
    "see",
    "stay",
    "stays",
    "thing",
    "things",
    "to",
    "tour",
    "tours",
    "trail",
    "trailhead",
    "trailheads",
    "trails",
    "trek",
    "treks",
    "trekking",
    "view",
    "views",
    "visitor",
    "visitors",
    "waterfall",
    "waterfalls",
}


def _explore_identity_query_text(place: dict) -> str:
    summary = place.get("summary") or {}
    profile = place.get("profile") or {}
    source_pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    values = [
        place.get("id"),
        summary.get("title"),
        summary.get("state"),
        summary.get("region"),
        " ".join(place.get("search_aliases") or []),
        source_pack.get("nps_park_code"),
    ]
    return " ".join(str(v or "") for v in values).lower()


def _explore_terms_match_tokens(query_terms: list[str], tokens: set[str]) -> bool:
    for term in query_terms:
        if term in tokens:
            continue
        if len(term) >= 4 and any(token.startswith(term) or term.startswith(token) for token in tokens):
            continue
        return False
    return True


def _explore_query_terms_match(place: dict, query_terms: list[str]) -> bool:
    if not query_terms:
        return True
    specific_terms = [term for term in query_terms if term not in EXPLORE_QUERY_GENERIC_TERMS]
    if specific_terms and not _explore_terms_match_tokens(specific_terms, _explore_query_tokens(_explore_identity_query_text(place))):
        return False
    text = _explore_query_text(place)
    return _explore_terms_match_tokens(query_terms, _explore_query_tokens(text))


def _explore_source_pack_query_text(source_pack: dict) -> str:
    if not isinstance(source_pack, dict):
        return ""
    values: list[str] = []
    for key in ("primary", "official_url", "nps_park_code", "source_note", "extract", "operating_hours"):
        if source_pack.get(key):
            values.append(str(source_pack.get(key)))
    for key in ("activities", "topics", "fees", "passes"):
        values.extend(str(item) for item in source_pack.get(key) or [] if str(item or "").strip())
    for key in (
        "sources",
        "photos",
        "things_to_do",
        "things_to_see",
        "visitor_centers",
        "campgrounds",
        "events",
        "tours",
        "parking_lots",
        "alerts",
    ):
        for item in source_pack.get(key) or []:
            if isinstance(item, dict):
                values.extend(
                    str(item.get(field) or "")
                    for field in ("title", "name", "description", "caption", "category", "publisher", "kind", "url")
                    if str(item.get(field) or "").strip()
                )
            elif str(item or "").strip():
                values.append(str(item))
    return " ".join(values).lower()


def _explore_is_destination_hub(place: dict) -> bool:
    summary = place.get("summary") or {}
    title = str(summary.get("title") or "").lower()
    category_text = " ".join(str(value or "") for value in [
        place.get("category"),
        summary.get("category"),
        summary.get("explore_group"),
        *(place.get("subcategories") or []),
    ]).lower()
    if re.search(r"\b(campgrounds?|campsites?|camping|glamping|huts?|cabins?|lodging|trails?|trailheads?|visitor centers?|parking|tours?|activities|climb|climbing)\b", category_text):
        return False
    if str(place.get("id") or "").startswith("place:nps:"):
        return True
    if re.search(r"\b(national|state|provincial|regional|county|territorial)\s+(park|monument|preserve|seashore|lakeshore|forest|wilderness|reserve|historic site|historical park|recreation area)\b", title):
        return True
    if re.search(r"\b(park|monument|preserve|forest|wilderness|reserve|seashore|lakeshore)\b", title) and re.search(r"\b(parks?|land|public land)\b", category_text):
        return True
    if re.search(r"\b(peak|mountain|glacier)\b", category_text) and not re.search(r"\b(base camp|trek|trail|campground|hut|cabin)\b", title):
        return True
    return False


def _explore_query_sort_key(place: dict, query_terms: list[str]) -> tuple[float, float]:
    summary = place.get("summary") or {}
    rank = float(summary.get("hero_rank") or summary.get("rank") or 999999)
    if not query_terms:
        return (0.0, rank)
    title_tokens = _explore_query_tokens(str(summary.get("title") or ""))
    source_pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    nested_tokens = _explore_query_tokens(" ".join([
        str(place.get("search_blob") or ""),
        _explore_source_pack_query_text(source_pack),
    ]))
    is_hub = _explore_is_destination_hub(place)
    child_title = bool(re.search(r"\b(campgrounds?|campsites?|camping|glamping|huts?|cabins?|lodging|trails?|trailheads?|visitor centers?|parking|tours?|activities|base camp|trek)\b", str(summary.get("title") or ""), re.I))
    all_in_title = all(term in title_tokens or any(token.startswith(term) for token in title_tokens) for term in query_terms)
    all_in_nested = all(term in nested_tokens or any(token.startswith(term) for token in nested_tokens) for term in query_terms)
    score = 100.0
    if all_in_title:
        score -= 30.0
    if is_hub and all_in_nested:
        score -= 55.0
    if is_hub:
        score -= 15.0
    if str(place.get("id") or "").startswith("place:nps:"):
        score -= 15.0
    if child_title and not is_hub:
        score += 15.0
    return (score, rank)

def _explore_place_matches_categories(place_type: str, requested: set[str] | None) -> bool:
    if not requested:
        return True
    normalized = {_normalize_place_category(c) for c in requested if str(c).strip()}
    if not normalized:
        return True
    if place_type == "camp":
        return bool(normalized.intersection({"camp", "camping", "rv", "private_stay"}))
    if place_type == "park":
        return bool(normalized.intersection({"park", "attraction", "tourism", "viewpoint"}))
    if place_type == "historic":
        return bool(normalized.intersection({"historic", "monument", "attraction", "tourism"}))
    if place_type == "viewpoint":
        return bool(normalized.intersection({"viewpoint", "water", "attraction", "tourism", "park"}))
    if place_type == "trail":
        return bool(normalized.intersection({"trail", "trailhead", "attraction", "tourism"}))
    return bool(normalized.intersection({place_type, "attraction", "tourism", "place", "poi"}))


def _explore_place_category_tokens(place: dict) -> set[str]:
    summary = place.get("summary") or {}
    source_pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    raw_values = [
        place.get("category"),
        summary.get("category"),
        summary.get("explore_group"),
        *(place.get("subcategories") or []),
        *(summary.get("tags") or []),
        *(source_pack.get("activities") or []),
        *(source_pack.get("topics") or []),
    ]
    tokens = {_normalize_place_category(value) for value in raw_values if str(value or "").strip()}
    if source_pack.get("campgrounds"):
        tokens.update({"camp", "camping", "campground"})
    if source_pack.get("visitor_centers"):
        tokens.update({"visitor_center", "park"})
    nested_text = _explore_source_pack_query_text(source_pack)
    if re.search(r"\b(trails?|hiking|hike|trek|trekking|trailheads?)\b", nested_text):
        tokens.update({"trail", "trails", "trailhead"})
    if re.search(r"\b(tours?|guided|tickets?|activities|things to do)\b", nested_text):
        tokens.update({"tour", "tours", "activity"})
    if re.search(r"\b(waterfalls?|falls|lake|river|viewpoint|overlook|scenic)\b", nested_text):
        tokens.update({"water", "viewpoint", "scenic"})
    if "waterfall" in tokens:
        tokens.add("waterfalls")
    if "hot_spring" in tokens:
        tokens.add("springs")
    if "climbing_area" in tokens or "bouldering_area" in tokens:
        tokens.add("climb")
        tokens.add("climbing")
    if "forest_road" in tokens or "offroad_route" in tokens:
        tokens.add("ohv")
    return tokens


def _explore_place_matches_category_request(place: dict, requested: set[str] | None) -> bool:
    if not requested:
        return True
    normalized = {_normalize_place_category(c) for c in requested if str(c).strip()}
    if not normalized:
        return True
    if _explore_place_category_tokens(place).intersection(normalized):
        return True
    return _explore_place_matches_categories(_catalog_place_category(place.get("summary") or {}), normalized)


def _explore_place_index_item(place: dict) -> dict:
    summary = place.get("summary") or {}
    source_pack = place.get("source_pack") or {}
    sources = source_pack.get("sources") if isinstance(source_pack.get("sources"), list) else []
    primary_source = source_pack.get("primary") or summary.get("source_title") or ""
    source_url = (
        source_pack.get("official_url")
        or summary.get("source_url")
        or next((item.get("url") for item in sources if isinstance(item, dict) and item.get("url")), "")
        or ""
    )
    return {
        "id": place.get("id") or summary.get("id") or "",
        "title": summary.get("title") or "",
        "category": summary.get("category") or place.get("category") or "",
        "explore_group": summary.get("explore_group") or "",
        "region": summary.get("region") or summary.get("state") or "",
        "lat": summary.get("lat"),
        "lng": summary.get("lng"),
        "rank": summary.get("rank") or 999999,
        "hero_rank": summary.get("hero_rank") or summary.get("rank") or 999999,
        "tags": summary.get("tags") or [],
        "hook": summary.get("hook") or (place.get("profile") or {}).get("hook") or "",
        "short_description": summary.get("short_description") or (place.get("profile") or {}).get("summary") or "",
        "thumbnail_url": summary.get("thumbnail_url") or summary.get("image_url") or "",
        "image_url": summary.get("image_url") or summary.get("thumbnail_url") or "",
        "image_credit": summary.get("image_credit") or "",
        "image_license": summary.get("image_license") or "",
        "source_title": primary_source,
        "source_url": source_url,
        "source_quality": (place.get("facts") or {}).get("source_quality") or source_pack.get("quality") or "",
        "v3_category": place.get("category") or "",
        "subcategories": place.get("subcategories") or [],
        "sources": place.get("sources") or [],
        "source_ids": place.get("source_ids") or [],
        "quality": place.get("quality") or "",
        "quality_score": place.get("quality_score"),
        "verified": place.get("verified"),
        "search_aliases": place.get("search_aliases") or [],
        "search_blob": " ".join(
            part for part in (str(place.get("search_blob") or ""), _explore_source_pack_query_text(source_pack))
            if part.strip()
        ),
        "best_season": place.get("best_season") or "",
        "access": place.get("access") or "",
        "safety": place.get("safety") or "",
        "amenities": place.get("amenities") or [],
        "media": place.get("media") or [],
        "card": place.get("card") or {},
        "linked_trail_ids": place.get("linked_trail_ids") or [],
    }

def _explore_place_to_nearby_place(place: dict, center_lat: float, center_lng: float) -> dict | None:
    summary = place.get("summary") or {}
    try:
        lat = float(summary.get("lat"))
        lng = float(summary.get("lng"))
    except Exception:
        return None
    ptype = _catalog_place_category(summary)
    dist = _haversine_m(center_lat, center_lng, lat, lng) / 1609.344
    source_pack = place.get("source_pack") or {}
    source_url = source_pack.get("official_url") or summary.get("source_url") or ""
    photo_url = summary.get("image_url") or summary.get("thumbnail_url") or ""
    return {
        "id": f"explore:{place.get('id') or summary.get('title')}",
        "name": summary.get("title") or "Trailhead Explore place",
        "lat": lat,
        "lng": lng,
        "type": ptype,
        "subtype": {
            "camp": "Campground area",
            "park": "Park",
            "historic": "Historic site",
            "trail": "Trail area",
        }.get(ptype, "Attraction"),
        "source": "trailhead_explore",
        "source_label": "Trailhead Explore",
        "source_badge": "Explore",
        "verified_source": "Trailhead seeded catalog",
        "summary": _planner_clean_text(summary.get("hook") or summary.get("short_description") or (place.get("profile") or {}).get("summary") or "", 320),
        "description": _planner_clean_text((place.get("profile") or {}).get("summary") or summary.get("short_description") or "", 700),
        "photo_url": photo_url,
        "photos": [photo_url] if photo_url else [],
        "photo_status": "catalog" if photo_url else "placeholder",
        "website": source_url,
        "url": source_url,
        "official_url": source_url,
        "distance_mi": round(dist, 2),
        "attribution": place.get("attribution") or "Trailhead Explore catalog",
        "source_freshness": "Seeded Trailhead Explore fallback; verify current closures, permits, fees, and access with the official source.",
        "category_access": {
            "explore_unlocked": True,
            "locked_categories": [],
            "official_free_categories": [],
            "unlock_cost": 0,
        },
    }

def _explore_place_to_camp(place: dict, center_lat: float, center_lng: float) -> dict | None:
    nearby = _explore_place_to_nearby_place(place, center_lat, center_lng)
    if not nearby or nearby.get("type") != "camp":
        return None
    return {
        "id": nearby["id"],
        "name": nearby["name"],
        "lat": nearby["lat"],
        "lng": nearby["lng"],
        "tags": ["campground", "explore_seed", "official_link"],
        "land_type": "Campground Area",
        "description": nearby.get("summary") or "Seeded campground area from Trailhead Explore. Open the official source before relying on availability or access.",
        "photo_url": nearby.get("photo_url") or "",
        "photos": nearby.get("photos") or [],
        "reservable": False,
        "cost": "",
        "url": nearby.get("official_url") or "",
        "ada": False,
        "source": "trailhead_explore",
        "source_tier": "seeded",
        "verified_source": "Trailhead Explore catalog",
        "source_badge": "Explore",
        "source_confidence": "seeded",
        "link_label": "Official page",
        "distance_mi": nearby.get("distance_mi"),
        "source_freshness": nearby.get("source_freshness"),
        "amenities": [],
        "site_types": ["Campground area"],
    }

def _explore_catalog_fallback_places(
    lat: float,
    lng: float,
    radius_miles: float,
    categories: set[str] | None = None,
    query: str = "",
    limit: int = 24,
) -> list[dict]:
    def item_distance(item: dict) -> float:
        try:
            return float(item.get("distance_mi"))
        except Exception:
            return 999999.0

    query_terms = _explore_query_terms(query)
    items: list[dict] = []
    for place in _load_explore_catalog().get("places") or []:
        summary = place.get("summary") or {}
        ptype = _catalog_place_category(summary)
        if not _explore_place_matches_categories(ptype, categories):
            continue
        nearby = _explore_place_to_nearby_place(place, lat, lng)
        if not nearby:
            continue
        if query_terms:
            if not _explore_query_terms_match(place, query_terms):
                continue
        if item_distance(nearby) > radius_miles:
            continue
        items.append(nearby)
    return sorted(items, key=lambda item: (item_distance(item), str(item.get("name") or "")))[:limit]

def _explore_catalog_fallback_camps(lat: float, lng: float, radius_miles: float, limit: int = 24) -> list[dict]:
    def item_distance(item: dict) -> float:
        try:
            return float(item.get("distance_mi"))
        except Exception:
            return 999999.0

    camps = []
    for place in _load_explore_catalog().get("places") or []:
        camp = _explore_place_to_camp(place, lat, lng)
        if not camp:
            continue
        if item_distance(camp) > radius_miles:
            continue
        camps.append(camp)
    return sorted(camps, key=lambda item: (item_distance(item), str(item.get("name") or "")))[:limit]

def _merge_place_fallbacks(primary: list[dict], fallback: list[dict], limit: int = 80, min_results: int = 8) -> list[dict]:
    if len(primary) >= min_results or not fallback:
        return primary[:limit]
    return _dedupe_nearby_places([*primary, *fallback])[:limit]
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

_OAUTH_JWKS_CACHE: dict[str, tuple[float, list[dict]]] = {}

def _oauth_client_ids(provider: str) -> list[str]:
    if provider == "apple":
        return [v for v in [settings.apple_bundle_id, settings.apple_service_id] if v]
    return [v.strip() for v in (settings.google_oauth_client_ids or "").split(",") if v.strip()]

async def _jwks(url: str) -> list[dict]:
    cached = _OAUTH_JWKS_CACHE.get(url)
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    async with httpx.AsyncClient(timeout=8) as client:
        r = await client.get(url)
        r.raise_for_status()
    keys = r.json().get("keys") or []
    _OAUTH_JWKS_CACHE[url] = (time.time(), keys)
    return keys

async def _decode_oauth_token(provider: str, identity_token: str) -> dict:
    token = (identity_token or "").strip()
    if not token:
        raise HTTPException(400, "Identity token is required")
    audiences = _oauth_client_ids(provider)
    if not audiences:
        raise HTTPException(503, f"{provider.title()} sign in is not configured")
    issuers = ["https://appleid.apple.com"] if provider == "apple" else ["https://accounts.google.com", "accounts.google.com"]
    jwks_url = "https://appleid.apple.com/auth/keys" if provider == "apple" else "https://www.googleapis.com/oauth2/v3/certs"
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        key = next((k for k in await _jwks(jwks_url) if k.get("kid") == kid), None)
        if not key:
            _OAUTH_JWKS_CACHE.pop(jwks_url, None)
            key = next((k for k in await _jwks(jwks_url) if k.get("kid") == kid), None)
        if not key:
            raise HTTPException(401, "Could not verify sign-in token")
        last_error: Exception | None = None
        for audience in audiences:
            for issuer in issuers:
                try:
                    return jwt.decode(token, key, algorithms=[header.get("alg", "RS256")], audience=audience, issuer=issuer)
                except Exception as exc:
                    last_error = exc
        raise last_error or JWTError("Invalid token audience")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Invalid sign-in token")

def _oauth_username(email: str, full_name: str, provider: str) -> str:
    base = re.sub(r"[^A-Za-z0-9_.-]+", "", (full_name or "").strip().replace(" ", "."))
    if len(base) < 3:
        base = re.sub(r"[^A-Za-z0-9_.-]+", "", email.split("@")[0])
    if len(base) < 3:
        base = f"{provider}user"
    base = (base[:20].strip("._-") or f"{provider}user")
    candidate = base
    for _ in range(12):
        if not get_user_by_username(candidate):
            return candidate
        suffix = secrets.token_hex(2)
        candidate = f"{base[: max(3, 24 - len(suffix))]}{suffix}"[:24]
    return f"{provider}{secrets.token_hex(5)}"[:24]

async def _oauth_login(provider: str, body: "OAuthLoginRequest"):
    claims = await _decode_oauth_token(provider, body.identity_token)
    sub = str(claims.get("sub") or "")
    email = str(claims.get("email") or body.email or "").strip().lower()
    email_verified = str(claims.get("email_verified", "true")).lower() in {"true", "1"}
    if not sub:
        raise HTTPException(401, "Sign-in token is missing an account id")
    if not email:
        raise HTTPException(400, "Sign-in provider did not return an email address")
    if provider == "google" and not email_verified:
        raise HTTPException(401, "Google email is not verified")
    grant_welcome = False
    user = get_user_by_oauth(provider, sub)
    if not user:
        existing = get_user_by_email(email)
        if existing:
            grant_welcome = not int(existing.get("email_verified", 1))
            user = link_user_oauth(existing["id"], provider, sub) or existing
        else:
            username = _oauth_username(email, body.full_name, provider)
            uid = create_oauth_user(email, username, _hash_pw(secrets.token_urlsafe(48)), provider, sub)
            user = get_user_by_id(uid)
            grant_welcome = True
    if not user:
        raise HTTPException(500, "Could not create account")
    if not int(user.get("email_verified", 1)):
        user = link_user_oauth(user["id"], provider, sub) or user
    if grant_welcome:
        _grant_signup_rewards(user)
    fresh = get_user_by_id(user["id"]) or user
    return {"token": _make_token(fresh["id"]), "user": _safe_user(fresh)}

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

def _verification_success_html() -> str:
    return """<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f4ee;color:#171412;padding:32px;line-height:1.45;">
    <h1>Email confirmed</h1>
    <p>Your Trailhead account is active. Open the app and sign in.</p>
    <a href="trailhead://" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:900;border-radius:12px;padding:14px 18px;">Open Trailhead</a>
  </body>
</html>"""

def _verification_failed_html() -> str:
    return """<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f4ee;color:#171412;padding:32px;line-height:1.45;">
    <h1>Verification link expired</h1>
    <p>Open Trailhead and resend the verification email, or contact hello@gettrailhead.app.</p>
  </body>
</html>"""

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
    safe_web_link = html.escape(web_link, quote=True)
    safe_app_link = html.escape(app_link, quote=True)
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
                <div style="font-size:11px;color:#7a6f63;letter-spacing:.18em;">OVERLAND NAVIGATION</div>
              </div>
            </div>
          </td></tr>
          <tr><td style="padding:18px 28px 8px;">
            <h1 style="font-size:26px;line-height:1.15;margin:0 0 12px;">Confirm your email</h1>
            <p style="font-size:16px;line-height:1.55;margin:0 0 18px;color:#4b423a;">Hi {safe_username}, tap the button below to activate your Trailhead account. Your signup credits unlock after verification.</p>
            <a href="{safe_web_link}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:900;border-radius:12px;padding:14px 18px;font-size:14px;letter-spacing:.08em;">CONFIRM EMAIL</a>
            <p style="font-size:13px;line-height:1.5;margin:18px 0 0;color:#7a6f63;">If the button does not open, copy this secure link into your browser:<br><a href="{safe_web_link}" style="color:#c2410c;word-break:break-all;">{safe_web_link}</a></p>
            <p style="font-size:12px;line-height:1.5;margin:12px 0 0;color:#95877a;">Already on your phone? You can also try opening Trailhead directly:<br><a href="{safe_app_link}" style="color:#c2410c;word-break:break-all;">{safe_app_link}</a></p>
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
                <div style="font-size:11px;color:#7a6f63;letter-spacing:.18em;">OVERLAND NAVIGATION</div>
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


ESSENTIAL_PLACE_CATEGORIES = {
    "camp", "camps", "camping", "trail", "trailhead", "viewpoint", "peak",
    "hot_spring", "fuel", "propane", "water", "dump", "parking", "mechanic",
}
EXPLORE_PLACE_CATEGORIES = {
    "food", "restaurant", "restaurants", "grocery", "shopping", "lodging",
    "hotel", "attraction", "historic", "park", "tourism", "shower",
    "laundromat", "laundry", "hardware", "medical", "parts", "wifi",
    "climbing", "ohv",
}
EXPLORE_CATEGORY_ALIASES = {
    "restaurant": "food",
    "restaurants": "food",
    "hotel": "lodging",
    "shopping": "grocery",
    "laundry": "laundromat",
    "tourism": "attraction",
}
EXPLORE_CATEGORY_GROUP = "town_services"
OFFICIAL_FREE_PLACE_CATEGORIES = {
    *ESSENTIAL_PLACE_CATEGORIES,
    "attraction", "historic", "park", "tourism", "visitor_center", "picnic",
    "ohv", "climbing", "camping",
}
OFFICIAL_FREE_PLACE_SOURCES = {"nps", "blm", "usfs", "ridb", "recreation.gov", "wikipedia", "wikimedia", "osm", "openstreetmap"}


class ExploreCategoryAuthorizeRequest(BaseModel):
    group: str = EXPLORE_CATEGORY_GROUP


class PlaceDetailAuthorizeRequest(BaseModel):
    source: str
    place_id: str
    category: str = ""


class CanonicalPlacePayload(BaseModel):
    id: Optional[str] = None
    name: str
    lat: float
    lng: float
    source: Optional[str] = None
    source_label: Optional[str] = None
    source_place_id: Optional[str] = None
    provider_place_id: Optional[str] = None
    place_id: Optional[str] = None
    category: Optional[str] = None
    type: Optional[str] = None
    subtype: Optional[str] = None
    official_url: Optional[str] = None
    url: Optional[str] = None
    website: Optional[str] = None
    photo_url: Optional[str] = None
    hero_photo_url: Optional[str] = None
    summary: Optional[str] = None
    description: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    rating: Optional[float] = None
    rating_count: Optional[int] = None
    reservable: Optional[bool] = None
    booking_url: Optional[str] = None
    reservation_notes: Optional[str] = None
    amenities: Optional[list[str]] = None
    activities: Optional[list[str]] = None
    photos: Optional[list[dict | str]] = None
    metadata: dict = Field(default_factory=dict)


class PlaceCommentPayload(BaseModel):
    body: str
    photo_data: Optional[str] = None
    photo_caption: Optional[str] = None


class PlacePhotoPayload(BaseModel):
    photo_data: str
    caption: Optional[str] = None
    comment_id: Optional[int] = None
    content_type: str = "image/jpeg"


class PlaceEditSuggestionPayload(BaseModel):
    place_name: str = ""
    field: str
    value: str
    note: Optional[str] = None


class PlaceReservationAlertPayload(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    party_size: Optional[int] = None


class AnalyticsEventRequest(BaseModel):
    event_type: str
    session_id: str = ""
    event_data: dict = Field(default_factory=dict)


class OfferEventRequest(BaseModel):
    offer_id: str
    provider: str = "outdoorsy"
    placement: str = ""
    route_type: str = ""
    session_id: str = ""
    context: dict = Field(default_factory=dict)


class ExtremeCheckpoint(BaseModel):
    id: str
    type: str
    title: str
    note: str = ""
    lat: float
    lng: float
    day: int = 1
    sequence: int = 0
    status: str = "planned"
    source: str = "trailhead"
    source_id: str = ""
    confidence: str = "estimated"
    expires_at: Optional[int] = None

class TripMemory(BaseModel):
    vehicle: Optional[dict] = None
    range: Optional[dict] = None
    clearance: Optional[dict] = None
    trailer: Optional[dict] = None
    comfort_level: str = ""
    preferred_stays: list[str] = Field(default_factory=list)
    avoid_rules: list[str] = Field(default_factory=list)
    public_private_preference: str = ""
    offline_readiness: dict = Field(default_factory=dict)
    risk_notes: list[str] = Field(default_factory=list)
    recent_user_edits: list[dict] = Field(default_factory=list)

class ExtremeSessionAuthorizeRequest(BaseModel):
    surface: str = "map"
    trip_id: Optional[str] = None
    checkpoints: list[ExtremeCheckpoint] = Field(default_factory=list)
    trip_memory: Optional[TripMemory] = None
    metadata: dict = Field(default_factory=dict)

class ExtremeNavigationAuthorizeRequest(BaseModel):
    surface: str = "navigation"
    trip_id: Optional[str] = None
    route_id: Optional[str] = None
    route_summary: dict = Field(default_factory=dict)
    trip_memory: Optional[TripMemory] = None
    metadata: dict = Field(default_factory=dict)
    acknowledged_billing: bool = False
    navigation_mode: str = "route_guidance"

class ExtremeSessionEndRequest(BaseModel):
    session_id: str
    reason: str = "ended"

class ExtremeLedgerRequest(BaseModel):
    session_id: Optional[str] = None
    event_type: str
    surface: str = "map"
    trip_id: Optional[str] = None
    event_data: dict = Field(default_factory=dict)

class ExtremeCopilotCommandRequest(BaseModel):
    session_id: Optional[str] = None
    trip_id: Optional[str] = None
    command: str
    mode: str = "text"
    context: dict = Field(default_factory=dict)

class CopilotContext(BaseModel):
    user: dict = Field(default_factory=dict)
    map: dict = Field(default_factory=dict)
    route: dict = Field(default_factory=dict)
    trip: dict = Field(default_factory=dict)
    safety: dict = Field(default_factory=dict)

class ExtremeCopilotSessionRequest(BaseModel):
    surface: str = "map_layers"
    trip_id: Optional[str] = None
    context: CopilotContext = Field(default_factory=CopilotContext)
    metadata: dict = Field(default_factory=dict)

class ExtremeCopilotMessageRequest(BaseModel):
    session_id: Optional[str] = None
    trip_id: Optional[str] = None
    message: str
    mode: str = "text"
    context: CopilotContext = Field(default_factory=CopilotContext)
    provider: str = "trailhead_openai"

class ExtremeCopilotConfirmRequest(BaseModel):
    action_id: int
    confirmed: bool = True
    client_result: dict = Field(default_factory=dict)

class MissionControlRequest(BaseModel):
    session_id: Optional[str] = None
    trip_id: Optional[str] = None
    route: list = Field(default_factory=list)
    checkpoints: list[ExtremeCheckpoint] = Field(default_factory=list)
    places: list[dict] = Field(default_factory=list)
    trip_memory: Optional[TripMemory] = None
    context: dict = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict)

class RouteScoutWindowPlanRequest(BaseModel):
    session_id: Optional[str] = None
    trip_id: Optional[str] = None
    route: list = Field(default_factory=list)
    total_miles: Optional[float] = None
    days: int = 2
    drive_hours: Optional[float] = None
    route_style: str = "balanced"
    metadata: dict = Field(default_factory=dict)

class ExploreRouteRankRequest(BaseModel):
    route: list = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    q: str = ""
    limit: int = 48
    max_distance_mi: float = 90
    mode: str = "route"

class RealtimeCopilotSessionRequest(BaseModel):
    session_id: Optional[str] = None
    voice: str = ""
    mode: str = "push_to_talk"
    wake_phrase: bool = False
    context: CopilotContext = Field(default_factory=CopilotContext)

class MapActionRequest(BaseModel):
    action_id: str
    action_type: str
    args: dict = Field(default_factory=dict)
    requires_confirmation: bool = False
    cost_class: str = "local"
    surface: str = "map_layers"
    provider: str = "trailhead_openai"

class MapActionResult(BaseModel):
    ok: bool
    message: str
    map_updates: dict = Field(default_factory=dict)
    status: Optional[str] = None
    spoken_summary: Optional[str] = None
    results: list[dict] = Field(default_factory=list)
    selected: Optional[dict] = None
    requires_confirmation: Optional[bool] = None
    selected_place: Optional[dict] = None
    route_preview: Optional[dict] = None
    location_status: Optional[dict] = None
    navigation: Optional[dict] = None
    route_builder_draft: Optional[dict] = None
    current_screen: Optional[str] = None
    failure_reason: Optional[str] = None
    ledger_id: Optional[int] = None
    error_code: Optional[str] = None

class ExtremeRouteRiskRequest(BaseModel):
    trip_id: Optional[str] = None
    route: list[dict] = Field(default_factory=list)
    checkpoints: list[ExtremeCheckpoint] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)

class ExtremeSearchSessionRequest(BaseModel):
    surface: str = "map_layers"
    metadata: dict = Field(default_factory=dict)

class ExtremeSearchSuggestRequest(BaseModel):
    q: str
    session_token: str
    proximity: str = ""
    origin: str = ""
    bbox: str = ""
    country: str = ""
    types: str = ""
    language: str = "en"
    limit: int = 8

class ExtremeSearchRetrieveRequest(BaseModel):
    mapbox_id: str
    session_token: str
    language: str = "en"
    proximity: str = ""
    origin: str = ""

class ExtremeSearchCategoryRequest(BaseModel):
    category: str
    proximity: str = ""
    bbox: str = ""
    country: str = ""
    language: str = "en"
    limit: int = 10

class ExtremeSearchReverseRequest(BaseModel):
    lat: float
    lng: float
    language: str = "en"
    limit: int = 5
    country: str = ""
    types: str = ""

class ExtremeDirectionsRequest(BaseModel):
    coordinates: list[list[float]] = Field(default_factory=list)
    profile: str = "mapbox/driving-traffic"
    steps: bool = True
    alternatives: bool = False
    annotations: str = ""
    exclude: str = ""
    language: str = "en"
    voice_units: str = "imperial"
    overview: str = "full"
    metadata: dict = Field(default_factory=dict)

class MapContextPoint(BaseModel):
    lat: float
    lng: float

class MapContextBounds(BaseModel):
    n: float
    s: float
    e: float
    w: float

class MapContextSnapshot(BaseModel):
    center: Optional[MapContextPoint] = None
    bounds: Optional[MapContextBounds] = None
    zoom: Optional[float] = None
    style: str = ""
    selected_place: Optional[dict] = None
    visible_features: list[dict] = Field(default_factory=list)
    current_results: list[dict] = Field(default_factory=list)
    route: list[list[float]] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)

class MapContextResolveRequest(BaseModel):
    q: str
    limit: int = 8
    country: str = ""
    proximity: str = ""
    bbox: str = ""
    types: str = ""
    language: str = "en"
    snapshot: Optional[MapContextSnapshot] = None
    metadata: dict = Field(default_factory=dict)

class MapContextSearchRequest(BaseModel):
    q: str = ""
    category: str = ""
    keyword: str = ""
    limit: int = 8
    proximity: str = ""
    origin: str = ""
    bbox: str = ""
    country: str = ""
    language: str = "en"
    center: Optional[MapContextPoint] = None
    route: list[list[float]] = Field(default_factory=list)
    snapshot: Optional[MapContextSnapshot] = None
    metadata: dict = Field(default_factory=dict)

class MapContextReverseRequest(BaseModel):
    lat: float
    lng: float
    limit: int = 5
    country: str = ""
    types: str = ""
    language: str = "en"
    snapshot: Optional[MapContextSnapshot] = None
    metadata: dict = Field(default_factory=dict)

class MapContextRouteRequest(BaseModel):
    coordinates: list[list[float]] = Field(default_factory=list)
    profile: str = "mapbox/driving-traffic"
    steps: bool = True
    alternatives: bool = False
    annotations: str = "congestion,duration,distance"
    exclude: str = ""
    language: str = "en"
    voice_units: str = "imperial"
    overview: str = "full"
    units: str = "miles"
    snapshot: Optional[MapContextSnapshot] = None
    metadata: dict = Field(default_factory=dict)

class MapContextMatrixRequest(BaseModel):
    coordinates: list[list[float]] = Field(default_factory=list)
    profile: str = "mapbox/driving"
    sources: str = "0"
    destinations: str = "all"
    annotations: str = "duration,distance"
    metadata: dict = Field(default_factory=dict)

class AdminExtremeConfigBody(BaseModel):
    enabled: Optional[bool] = None
    kill_switch: Optional[bool] = None
    allowed_surfaces: Optional[list[str]] = None
    navigation_enabled: Optional[bool] = None
    weather_enabled: Optional[bool] = None
    voice_enabled: Optional[bool] = None
    copilot_enabled: Optional[bool] = None
    mission_control_enabled: Optional[bool] = None
    adventure_scores_enabled: Optional[bool] = None
    mission_provider_evidence_enabled: Optional[bool] = None
    copilot_wake_phrase_enabled: Optional[bool] = None
    native_mode_enabled: Optional[bool] = None
    mapgpt_pilot_enabled: Optional[bool] = None
    atlas_pilot_enabled: Optional[bool] = None
    max_demo_session_seconds: Optional[int] = None
    max_navigation_session_seconds: Optional[int] = None
    cost_cap_cents_daily: Optional[int] = None
    copilot_persona: Optional[str] = None
    copilot_voice: Optional[str] = None

class AdminPushAudience(BaseModel):
    segment: str = "active_recent"
    active_within_days: Optional[int] = 30
    credits_lte: Optional[int] = None

class AdminPushCampaignBody(BaseModel):
    title: str
    body: str
    campaign_type: str = "admin_campaign"
    audience: AdminPushAudience = Field(default_factory=AdminPushAudience)
    deeplink: Optional[str] = None
    data: dict = Field(default_factory=dict)
    credits: Optional[int] = None
    campaign_tag: Optional[str] = None
    test_only: bool = False

class SupportInboxMessageBody(BaseModel):
    thread_id: Optional[int] = None
    subject: Optional[str] = None
    category: str = "support"
    body: str

class AdminSupportThreadCreateBody(BaseModel):
    user_id: int
    subject: str
    category: str = "support"
    body: str

class AdminSupportThreadMessageBody(BaseModel):
    body: str
    close_after_send: bool = False
    copilot_persona: Optional[str] = None
    copilot_voice: Optional[str] = None

class AdminExtremeGrantBody(BaseModel):
    user_id: Optional[int] = None
    email: str = ""
    plan_type: str = "extreme_beta"
    duration_days: int = 366

EXTREME_STYLE_LABELS = {
    "standard": "Standard",
    "live_road": "Live Road",
    "satellite_trail": "Satellite Trail",
    "3d_terrain": "3D Terrain",
    "night_drive": "Night Drive",
    "weather_watch": "Weather Watch",
    "outdoors": "Outdoors",
}

EXTREME_WEATHER_LAYERS = [
    {"id": "radar", "label": "Radar", "enabled_by_default": True},
    {"id": "precipitation", "label": "Precipitation", "enabled_by_default": True},
    {"id": "temperature", "label": "Temperature", "enabled_by_default": False},
    {"id": "wind", "label": "Wind", "enabled_by_default": False},
    {"id": "satellite", "label": "Satellite", "enabled_by_default": False},
]

EXTREME_COPILOT_ACTIONS = {
    "getMapContext": "Get map context",
    "getVisibleMapCandidates": "Get visible map candidates",
    "searchPlaces": "Search places",
    "searchTrails": "Search trails",
    "selectPlace": "Select place",
    "selectRenderedFeature": "Select visible map feature",
    "selectVisiblePlace": "Select visible place",
    "searchAndSelectPlace": "Search and select place",
    "openSelectedPlaceCard": "Open selected place card",
    "routeToSelectedPlace": "Route to selected place",
    "flyToPlace": "Fly to place",
    "zoomMap": "Zoom map",
    "setMapZoom": "Set map zoom",
    "toggleLayer": "Toggle layer",
    "setMapStyle": "Set map style",
    "buildRoute": "Build route",
    "startRouteScout": "Scout multi-day route",
    "saveScoutToRouteBuilder": "Save scout to Route Builder",
    "startNavigation": "Start navigation",
    "modifyRoute": "Modify route",
    "dropPin": "Drop pin",
    "saveTrip": "Save trip",
    "downloadOfflineArea": "Download offline area",
    "openRouteBuilderDraft": "Open Route Builder draft",
    "updateRouteBuilderDraft": "Update Route Builder draft",
    "buildRouteBuilderFramework": "Build Route Builder framework",
    "readRouteBuilderContext": "Read Route Builder context",
    "openGuide": "Open Guide",
    "playTripGuide": "Play trip guide",
    "openReports": "Open reports",
    "stageReport": "Stage report",
    "openOfflineDownloads": "Open offline downloads",
    "openRigProfile": "Open rig profile",
    "explainVisibleArea": "Explain visible area",
    "askForConfirmation": "Ask for confirmation",
    "add_fuel": "Add fuel",
    "review_private_stay": "Review private stay",
    "mark_checkpoint": "Mark checkpoint",
    "show_weather": "Show weather",
    "download_trip": "Download trip",
    "review_reroute": "Review reroute",
    "start_guidance": "Start guidance",
}
EXTREME_COPILOT_PROVIDERS = {
    "trailhead_openai",
    "mapbox_mapgpt_private_preview",
    "mapbox_mcp",
    "openai_with_mapbox_tools",
}
EXTREME_COPILOT_CONFIRM_ACTIONS = {
    "startNavigation",
    "modifyRoute",
    "dropPin",
    "saveTrip",
    "downloadOfflineArea",
    "stageReport",
    "playTripGuide",
    "askForConfirmation",
}
TRAILHEAD_COPILOT_CAPABILITY_REGISTRY = {
    "map": {
        "summary": "Search, fly, zoom, select cards, preview routes, toggle layers, change styles, radar, public lands, topo, satellite, nautical, pins, camps, trails, places.",
        "commands": ["getVisibleMapCandidates", "searchPlaces", "searchTrails", "selectPlace", "selectRenderedFeature", "selectVisiblePlace", "searchAndSelectPlace", "openSelectedPlaceCard", "routeToSelectedPlace", "flyToPlace", "zoomMap", "toggleLayer", "setMapStyle", "buildRoute", "dropPin"],
        "confirmation": ["dropPin"],
    },
    "navigation": {
        "summary": "buildRoute previews an animated route line. startNavigation is a separate confirmed action and must not claim success without client navigation state.",
        "commands": ["buildRoute", "startRouteScout", "saveScoutToRouteBuilder", "startNavigation"],
        "required_context": ["current location", "destination"],
        "confirmation": ["startNavigation"],
    },
    "route_builder": {
        "summary": "Multi-day trip planning starts as a map-first Route Scout. Use Route Builder only when the user asks for builder/draft/save/export, or after scout results are ready.",
        "commands": ["openRouteBuilderDraft", "updateRouteBuilderDraft", "buildRouteBuilderFramework", "readRouteBuilderContext"],
        "fields": ["start", "destination", "stops", "days", "tripShape", "routeStyle", "campPreference", "campReuse", "driveHours", "targetMiles", "restDays", "rigConstraints", "fuelStrategy", "poiPreferences", "roadPreference", "riskTolerance"],
        "vocabulary": {
            "wild": ["wild", "adventure", "backroads"],
            "direct": ["direct", "fastest"],
            "balanced": ["scenic but sane", "balanced"],
            "public_camps": ["dispersed", "boondock", "free", "blm", "usfs", "public land"],
            "private_camps": ["private stays", "farm", "ranch", "winery", "glamping"],
            "same_camp_window": ["same camp", "basecamp", "there and back"],
            "different_each_night": ["different camps", "each night"],
            "rough_roads": ["forest roads", "wild roads", "high clearance", "4wd", "rough roads"],
            "poi_categories": ["parks", "monuments", "historic sites", "visitor centers", "water access", "trailheads"],
        },
    },
    "app": {
        "summary": "Guide, reports, offline downloads, profile/rig, paid route brief, packing list, weather/safety, water, and community pins are supported workflows.",
        "commands": ["openGuide", "playTripGuide", "openReports", "stageReport", "openOfflineDownloads", "openRigProfile"],
        "confirmation": ["playTripGuide", "stageReport", "downloadOfflineArea", "saveTrip"],
    },
}

def _copilot_capability_summary() -> str:
    lines = []
    for domain, data in TRAILHEAD_COPILOT_CAPABILITY_REGISTRY.items():
        commands = ", ".join(data.get("commands", []))
        lines.append(f"{domain}: {data.get('summary', '')} Tools: {commands}.")
    return " ".join(lines)
EXTREME_ADMIN_SURFACES = ["map_layers", "map", "route_builder", "navigation", "weather", "copilot"]

def _extreme_allowed_surfaces() -> list[str]:
    allowed = []
    for raw in (settings.extreme_allowed_surfaces or "").split(","):
        clean = re.sub(r"[^a-z0-9_]+", "", raw.strip().lower().replace("-", "_"))
        if clean:
            allowed.append(clean)
    return list(dict.fromkeys(allowed or ["map_layers"]))

def _extreme_style_uris() -> dict:
    return {
        "standard": settings.extreme_style_standard,
        "live_road": settings.extreme_style_live_road,
        "satellite_trail": settings.extreme_style_satellite_trail,
        "3d_terrain": settings.extreme_style_3d_terrain,
        "night_drive": settings.extreme_style_night_drive,
        "weather_watch": settings.extreme_style_weather_watch,
        "outdoors": settings.extreme_style_outdoors,
    }

def _bool_override(overrides: dict, key: str, default: bool) -> bool:
    value = overrides.get(key)
    return bool(default) if value is None else bool(value)

def _int_override(overrides: dict, key: str, default: int, min_value: int, max_value: int) -> int:
    value = overrides.get(key)
    try:
        parsed = int(default if value is None else value)
    except (TypeError, ValueError):
        parsed = int(default)
    return max(min_value, min(parsed, max_value))

def _str_override(overrides: dict, key: str, default: str, max_len: int = 160) -> str:
    value = overrides.get(key)
    text = str(default if value is None else value).strip()
    return text[:max_len]

def _extreme_runtime_overrides() -> dict:
    try:
        return get_extreme_admin_config()
    except Exception:
        return {"_meta": {}}

def _extreme_allowed_surfaces_from_overrides(overrides: dict) -> list[str]:
    raw = overrides.get("allowed_surfaces")
    if isinstance(raw, list):
        source = ",".join(str(item) for item in raw)
    elif isinstance(raw, str):
        source = raw
    else:
        source = settings.extreme_allowed_surfaces or ""
    allowed = []
    for item in source.split(","):
        clean = _clean_extreme_surface(item)
        if clean:
            allowed.append(clean)
    return list(dict.fromkeys(allowed or ["map_layers"]))

def _extreme_feature_flags(beta_active: bool, overrides: dict) -> dict:
    return {
        "native_mode": bool(beta_active and _bool_override(overrides, "native_mode_enabled", settings.extreme_native_mode_enabled)),
        "search": bool(beta_active and _bool_override(overrides, "search_enabled", settings.extreme_search_enabled)),
        "weather": bool(beta_active and _bool_override(overrides, "weather_enabled", settings.extreme_weather_enabled)),
        "navigation": bool(beta_active and _bool_override(overrides, "navigation_enabled", settings.extreme_navigation_enabled)),
        "voice": bool(beta_active and _bool_override(overrides, "voice_enabled", settings.extreme_voice_enabled)),
        "copilot": bool(beta_active and _bool_override(overrides, "copilot_enabled", settings.extreme_copilot_enabled)),
        "mission_control": bool(beta_active and _bool_override(overrides, "mission_control_enabled", settings.extreme_mission_control_enabled)),
        "adventure_scores": bool(beta_active and _bool_override(overrides, "adventure_scores_enabled", settings.extreme_adventure_scores_enabled)),
        "mission_provider_evidence": bool(beta_active and _bool_override(overrides, "mission_provider_evidence_enabled", settings.extreme_mission_provider_evidence_enabled)),
        "mapgpt_pilot": bool(beta_active and _bool_override(overrides, "mapgpt_pilot_enabled", settings.extreme_mapgpt_pilot_enabled)),
        "atlas_pilot": bool(beta_active and _bool_override(overrides, "atlas_pilot_enabled", settings.extreme_atlas_pilot_enabled)),
    }

def _extreme_config_for_user(user: dict | None) -> dict:
    overrides = _extreme_runtime_overrides()
    db_kill_switch = _bool_override(overrides, "kill_switch", False)
    kill_switch = bool(settings.extreme_kill_switch or db_kill_switch)
    is_admin = bool(user and user.get("is_admin"))
    master_enabled = bool(settings.extreme_enabled)
    db_enabled = _bool_override(overrides, "enabled", True)
    beta_active = bool(((master_enabled and db_enabled) or is_admin) and not kill_switch)
    # EXTREME map/explorer is now part of the free signed-in experience.
    # Keep anonymous users blocked and preserve the kill switch/admin rollout controls.
    entitled = bool(user) or has_extreme_plan(user)
    visual_entitled = bool(entitled or has_active_plan(user or {}))
    if beta_active and is_admin:
        allowed_surfaces = list(dict.fromkeys([*_extreme_allowed_surfaces_from_overrides(overrides), *EXTREME_ADMIN_SURFACES]))
    else:
        allowed_surfaces = _extreme_allowed_surfaces_from_overrides(overrides) if beta_active else []
    allowed_surfaces_visual = list(dict.fromkeys([
        *(allowed_surfaces if entitled else []),
        "map_layers",
        "terrain_3d",
        "trail_overlays",
    ])) if beta_active and visual_entitled else []
    feature_flags = _extreme_feature_flags(beta_active, overrides)
    if beta_active and is_admin:
        feature_flags.update({
            "native_mode": True,
            "search": True,
            "weather": True,
            "navigation": True,
            "voice": True,
            "copilot": True,
            "mission_control": True,
            "adventure_scores": True,
            "mission_provider_evidence": True,
            "mapgpt_pilot": True,
            "atlas_pilot": True,
        })
    max_demo_session_seconds = _int_override(overrides, "max_demo_session_seconds", settings.extreme_max_demo_session_seconds, 60, 7200)
    max_navigation_session_seconds = _int_override(overrides, "max_navigation_session_seconds", settings.extreme_max_navigation_session_seconds, 300, 86400)
    return {
        "tier_name": "Explorer",
        "enabled": bool(beta_active and entitled),
        "entitled": bool(entitled),
        "enabled_visual": bool(beta_active and visual_entitled),
        "entitled_visual": bool(visual_entitled),
        "kill_switch": kill_switch,
        "master_enabled": master_enabled,
        "beta_active": beta_active,
        "allowed_surfaces": allowed_surfaces,
        "allowed_surfaces_visual": allowed_surfaces_visual,
        "style_uris": _extreme_style_uris(),
        "style_labels": EXTREME_STYLE_LABELS,
        "mapbox_public_token": settings.mapbox_token,
        "max_demo_session_seconds": max_demo_session_seconds,
        "max_navigation_session_seconds": max_navigation_session_seconds,
        "feature_flags": feature_flags,
        "weather": {
            "enabled": feature_flags["weather"],
            "provider": "mapbox" if settings.extreme_mapbox_weather_enabled else "trailhead",
            "mapbox_conditions_enabled": bool(feature_flags["weather"] and settings.extreme_mapbox_weather_enabled),
            "layers": EXTREME_WEATHER_LAYERS,
        },
        "copilot": {
            "enabled": feature_flags["copilot"],
            "voice_enabled": feature_flags["voice"],
            "press_to_talk": feature_flags["voice"],
            "wake_phrase": bool(feature_flags["voice"] and _bool_override(overrides, "copilot_wake_phrase_enabled", settings.extreme_copilot_wake_phrase_enabled)),
            "persona": _str_override(overrides, "copilot_persona", settings.extreme_copilot_persona, 160),
            "voice": _str_override(overrides, "copilot_voice", settings.extreme_copilot_voice, 80),
            "actions": EXTREME_COPILOT_ACTIONS,
            "requires_confirmation": True,
        },
        "navigation": {
            "enabled": feature_flags["navigation"],
            "requires_explicit_authorization": True,
            "max_session_seconds": max_navigation_session_seconds,
            "free_drive": False,
        },
        "cost_caps": {
            "daily_cents": _int_override(overrides, "cost_cap_cents_daily", settings.extreme_cost_cap_cents_daily, 0, 1_000_000),
        },
        "pilot_flags": {
            "mapgpt": feature_flags["mapgpt_pilot"],
            "atlas": feature_flags["atlas_pilot"],
        },
        "admin_overrides": {k: v for k, v in overrides.items() if not str(k).startswith("_")},
        "admin_override_meta": overrides.get("_meta", {}),
        "guardrails": {
            "navigation_sessions": feature_flags["navigation"],
            "free_drive": False,
            "mapgpt": feature_flags["mapgpt_pilot"],
            "offline_mapbox_packs": False,
            "permanent_copilot_mutations": False,
        },
    }

def _clean_extreme_surface(surface: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "", str(surface or "map").lower().replace("-", "_"))[:40] or "map"

def _clean_extreme_event_type(event_type: str) -> str:
    clean = re.sub(r"[^a-z0-9_.:-]+", "", str(event_type or "").lower())[:80]
    if not clean:
        raise HTTPException(400, "Invalid ledger event")
    return clean

def _clean_extreme_session_id(session_id: str | None) -> str | None:
    clean = re.sub(r"[^a-zA-Z0-9_.:-]+", "", (session_id or "").strip())[:120]
    return clean or None

def _classify_extreme_command(command: str) -> tuple[str, str]:
    text = (command or "").lower()
    if re.search(r"\bfuel|gas|range|empty\b", text):
        return "add_fuel", "Fuel stop staged for review."
    if re.search(r"\bstay|camp|sleep|overnight|private\b", text):
        return "review_private_stay", "Stay options staged for review."
    if re.search(r"\bweather|storm|rain|snow|wind|heat|cold|risk\b", text):
        return "show_weather", "Weather checks staged for review."
    if re.search(r"\boffline|download|save\b", text):
        return "download_trip", "Trip download staged for review."
    if re.search(r"\breroute|avoid|detour|alternate\b", text):
        return "review_reroute", "Route change staged for review."
    if re.search(r"\bnavigate|guidance|directions|start\b", text):
        return "start_guidance", "Guidance request staged for confirmation."
    return "mark_checkpoint", "Checkpoint staged for review."

def _require_extreme_copilot(user: dict, voice: bool = False) -> dict:
    config = _extreme_config_for_user(user)
    if config["kill_switch"]:
        raise HTTPException(403, {"code": "extreme_disabled", "message": "Explorer is temporarily unavailable."})
    if not config["enabled"] or not config["entitled"]:
        raise HTTPException(403, {"code": "extreme_hidden_beta", "message": "Explorer is in hidden beta for selected accounts."})
    if "copilot" not in config["allowed_surfaces"] and "map_layers" not in config["allowed_surfaces"]:
        raise HTTPException(403, {"code": "extreme_copilot_unavailable", "message": "EXTREME Copilot is not available on this surface."})
    if not config["feature_flags"]["copilot"]:
        raise HTTPException(403, {"code": "extreme_copilot_disabled", "message": "Co-Pilot is not enabled for this beta."})
    if voice and not config["feature_flags"]["voice"]:
        raise HTTPException(403, {"code": "extreme_voice_disabled", "message": "Voice commands are not enabled for this beta."})
    return config

def _copilot_context_dict(ctx: CopilotContext | dict | None) -> dict:
    if isinstance(ctx, CopilotContext):
        data = ctx.dict()
    elif isinstance(ctx, dict):
        data = ctx
    else:
        data = {}
    return {
        "user": data.get("user") if isinstance(data.get("user"), dict) else {},
        "map": data.get("map") if isinstance(data.get("map"), dict) else {},
        "route": data.get("route") if isinstance(data.get("route"), dict) else {},
        "trip": data.get("trip") if isinstance(data.get("trip"), dict) else {},
        "safety": data.get("safety") if isinstance(data.get("safety"), dict) else {},
    }

def _copilot_provider(provider: str = "") -> str:
    clean = re.sub(r"[^a-z0-9_]+", "", str(provider or "").lower())[:80]
    return clean if clean in EXTREME_COPILOT_PROVIDERS else "trailhead_openai"

def _openai_realtime_model(fallback: bool = False) -> str:
    raw = settings.openai_realtime_fallback_model if fallback else settings.openai_realtime_model
    clean = re.sub(r"[^a-zA-Z0-9_.:-]+", "", str(raw or ""))[:80]
    return clean or ("gpt-realtime-mini" if fallback else "gpt-realtime-2")

def _openai_realtime_voice(raw: str = "") -> str:
    clean = re.sub(r"[^a-zA-Z0-9_.:-]+", "", str(raw or "").strip().lower())[:80]
    known = {"alloy", "ash", "ballad", "cedar", "coral", "echo", "marin", "sage", "shimmer", "verse"}
    if clean == "trailhead":
        return "marin"
    return clean if clean in known else "marin"

def _copilot_realtime_tools() -> list[dict]:
    return [{
        "type": "function",
        "name": "map_action",
        "description": "Stage a Trailhead map action. The mobile client executes this through the same MapActionRequest executor used by text Copilot.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "action_type": {
                    "type": "string",
                    "enum": [
                        "getMapContext", "getVisibleMapCandidates", "searchPlaces", "searchTrails", "selectPlace",
                        "selectRenderedFeature", "selectVisiblePlace", "searchAndSelectPlace", "openSelectedPlaceCard",
                        "routeToSelectedPlace", "flyToPlace", "zoomMap", "setMapZoom",
                        "toggleLayer", "setMapStyle", "buildRoute", "startRouteScout", "saveScoutToRouteBuilder", "startNavigation", "modifyRoute", "dropPin",
                        "saveTrip", "downloadOfflineArea", "openRouteBuilderDraft", "updateRouteBuilderDraft",
                        "buildRouteBuilderFramework", "readRouteBuilderContext", "openGuide", "playTripGuide",
                        "openReports", "stageReport", "openOfflineDownloads", "openRigProfile",
                        "showMissionControl", "explainVisibleArea", "askForConfirmation",
                    ],
                },
                "args": {"type": "object"},
                "requires_confirmation": {"type": "boolean"},
                "label": {"type": "string"},
            },
            "required": ["action_type", "args", "requires_confirmation"],
        },
    }]

def _copilot_realtime_turn_detection() -> dict:
    return {
        "type": "server_vad",
        "threshold": 0.9,
        "prefix_padding_ms": 250,
        "silence_duration_ms": 1400,
        "create_response": True,
        "interrupt_response": False,
    }

def _copilot_realtime_instructions(wake_phrase: bool) -> str:
    capabilities = _copilot_capability_summary()
    base = (
        "You are Trailhead Copilot, a concise overland map voice assistant. "
        f"Trailhead capabilities: {capabilities} "
        "Use map_action for map changes. Keep spoken confirmations short. "
        "For questions about what is visible, call map_action with explainVisibleArea and answer from the tool output. "
        "For readiness questions like \"is this trip ready\", \"what is risky ahead\", \"why is this blocked\", or \"mission control\", call showMissionControl; answer only from Mission Control output. "
        "For fly-to commands with a named place, call flyToPlace with args.target.name set to the place name. "
        "For famous landmarks or named attractions such as Eiffel Tower, Golden Gate Bridge, Grand Canyon, Arches, museums, monuments, or parks, use flyToPlace with only the landmark name unless the user gives a specific city/region; do not choose similarly named roads or addresses. "
        "For zoom in/out commands, call zoomMap with args.direction=\"in\" or \"out\" and answer from the returned visible_map_features; for zooming to a visible icon, include the visible candidate feature_id, result_index, type, or screen_position. "
        "For broad discovery requests like \"find places\" or \"where should I stop\", ask the user to choose camps, lodging, food, fuel, attractions, or trails before searching. Do not default to camps. "
        "For campground searches near a named place, call searchPlaces with args.category=\"camp\", args.query set to the place name, "
        "and args.open_card=true when the user asks for one campground or the best/top option. "
        "For restaurants, food, scenic viewpoints, landmarks, or attractions near a named place, call searchPlaces with args.category set to "
        "\"food\", \"viewpoint\", or \"attraction\" and args.query set to the named place; set args.open_card=true only when the user asks to open the best/top/first option. "
        "For cuisine or drink followups such as pizza, tacos, burgers, coffee, BBQ, sushi, Italian, breweries, beer, or pubs, call searchPlaces with args.category=\"food\" and args.keyword set to the cuisine/drink; do not geocode the cuisine/drink as a destination. "
        "Never simulate tapping Trailhead controls. For visible labels/icons on the map, call getVisibleMapCandidates, then selectVisiblePlace with feature_id, result_index, type, name, and/or screen_position. "
        "If multiple visible candidates match, ask which one instead of choosing randomly. "
        "When a tool returns query_context, keep using its result_set_id/result_id for followups; do not select by plain index from a different or stale region. "
        "For followups like \"open the second one\", prefer result_id and result_set_id from the prior tool output; use selectVisiblePlace only when the prior answer described visible map candidates, otherwise use selectPlace for search results. "
        "If selection returns stale_query_context or region_mismatch, refresh getVisibleMapCandidates or searchPlaces in the current requested region before selecting again. "
        "For \"route me there\" use routeToSelectedPlace or buildRoute to preview only; use the selected card/current result, not a random nearby place. "
        "For \"start navigation\" or \"navigate there\" use startNavigation with confirmation. "
        "For full multi-day planning such as \"plan/build/create a 5-day dispersed route from Moab to Big Sur\", call startRouteScout with start, destination, days, driveHours when known, routeStyle, campPreference, campPhotoOnly when they ask for camps with photos/pictures only, fuelStrategy, poiPreferences, and rig profile context. "
        "Before staging a multi-day scout, ask one short follow-up when camp style, route style, daily drive window, or rough-road vehicle fit is ambiguous. "
        "Treat driveHours as the user's maximum drive time per day across the requested days, not a required exact daily duration. "
        "If the user gives a follow-up drive time such as \"5 hours\" while a route scout is active, call startRouteScout again with the prior scout context plus driveHours. "
        "Interpret requests for dangerous, gnarly, rough, or high-clearance roads as wild but safe scouting. Use the saved rig profile when available and do not silently push low-clearance or towing rigs onto rough roads. "
        "For parks, monuments, historic sites, visitor centers, scenic drives, overlooks, water access, and other POIs, map them to Trailhead's supported place or trail searches instead of defaulting to camps. "
        "Do not use visible_map_features to invent route plans or overnight stops unless the user explicitly asks about the current screen. "
        "Only use Route Builder actions when the user explicitly asks to open, save, export, or prefill Route Builder. "
        "Never call openRigProfile during or immediately after route planning. Only call openRigProfile when the user explicitly says open/show/edit/set up my rig profile; include args.explicit_request=true. "
        "Ignore tiny fragments, map labels, loading copy, and background speech that are not clear user commands. "
        "If the detected speech is only filler, partial words, breathing, road noise, or silence, do not answer, do not say filler words like well/okay/let's, and wait for a clear command. "
        "When the command is unclear, ask one short clarification instead of thinking out loud. "
        "After every tool call, answer only from returned tool output; do not invent camps or claim map results without tool data. "
        "Speak brief audio responses for driving, such as \"I found three camps\" or \"Confirm to route there.\" "
        "Never create pins, save trips, start navigation, modify active routes, stage reports, make paid calls, "
        "or start offline downloads without confirmation."
    )
    if not wake_phrase:
        return base + " Push-to-talk is active, so respond directly to the user's current utterance."
    return base + (
        " Wake phrase mode is active. Do not respond and do not call tools until the user says "
        "\"Hey Trailhead\" or \"Trailhead\" near the start of the utterance. If speech is not addressed "
        "to Trailhead, stay silent. After handling one request, return to waiting for the wake phrase."
    )

def _valid_context_point(point: dict | None) -> dict | None:
    if not isinstance(point, dict):
        return None
    try:
        lat = float(point.get("lat"))
        lng = float(point.get("lng"))
    except (TypeError, ValueError):
        return None
    if -90 <= lat <= 90 and -180 <= lng <= 180:
        return {"lat": lat, "lng": lng}
    return None

def _extract_place_query(command: str) -> str:
    text = str(command or "")
    match = re.search(r"\b(?:near|around|by|in|at)\s+([a-zA-Z0-9 .,'-]{2,90})", text)
    if not match:
        return ""
    query = match.group(1)
    query = re.split(r"\b(?:for|with|that|and|then|please)\b", query, maxsplit=1, flags=re.I)[0]
    query = re.sub(r"\b(?:campgrounds?|campsites?|camps?|rv parks?|huts?|shelters?|refuges?|bothies|treks?|trekking|base\s*camps?|trails?|fuel|gas|propane|restaurants?|food|eat|dining|hotels?|motels?|lodg(?:e|ing)|guest\s*houses?|places? to stay|inns?|hostels?|viewpoints?|views?|scenic|cool places?|attractions?|landmarks?|nearby|around|area|map|view)\b", " ", query, flags=re.I)
    query = re.sub(r"\s+", " ", query).strip(" .,'-")
    if query.lower() in {
        "me", "here", "my location", "current location", "current view", "map view", "this area",
        "my route", "the route", "route", "route corridor", "along my route",
    }:
        return ""
    return query[:80]

def _extract_food_keyword(command: str) -> str:
    text = str(command or "").lower()
    keyword_specs = [
        ("pizza", r"\bpizza\b"),
        ("tacos", r"\b(tacos?|mexican)\b"),
        ("burgers", r"\b(burgers?|burger joint)\b"),
        ("coffee", r"\b(coffee|cafe)\b"),
        ("breakfast", r"\bbreakfast\b"),
        ("barbecue", r"\b(bbq|barbecue)\b"),
        ("sushi", r"\bsushi\b"),
        ("thai", r"\bthai\b"),
        ("italian", r"\bitalian\b"),
        ("sandwiches", r"\b(sandwiches?|deli)\b"),
    ]
    for keyword, pattern in keyword_specs:
        if re.search(pattern, text):
            return keyword
    return ""

def _extract_route_query(command: str) -> str:
    text = str(command or "")
    match = re.search(r"\b(?:route|directions|guidance|preview\s+(?:a\s+)?route|route me|take me|navigate)\s+(?:me\s+)?(?:to|for|toward|there to)?\s*([a-zA-Z0-9 .,'-]{2,90})", text, flags=re.I)
    if not match:
        return ""
    query = match.group(1)
    query = re.split(r"\b(?:and|then|please|now|with|avoid|using)\b", query, maxsplit=1, flags=re.I)[0]
    query = re.sub(r"\b(?:route|directions|guidance|preview|there|here|map|view|area)\b", " ", query, flags=re.I)
    query = re.sub(r"\s+", " ", query).strip(" .,'-")
    if query.lower() in {"me", "my location", "current location", "selected place", "current result"}:
        return ""
    return query[:80]

def _visible_selection_args(command: str) -> dict:
    text = str(command or "").lower()
    args: dict = {}
    for pos in ("left", "right", "center", "top", "bottom"):
        if re.search(rf"\b(?:on|to|at|near|in)\s+(?:the\s+)?{pos}\b|\b{pos}\s+(?:side|area)\b", text):
            args["screen_position"] = pos
            break
    type_specs = [
        ("lodging", r"\b(hotel|motel|lodging|stay)\b"),
        ("food", r"\b(restaurant|food|bar|cafe|coffee|bakery|pizza|burger|eat)\b"),
        ("grocery", r"\b(grocery|market|supermarket)\b"),
        ("fuel", r"\b(fuel|gas|charging)\b"),
        ("attraction", r"\b(museum|attraction|park|theater|theatre|school|landmark)\b"),
        ("shop", r"\b(shop|store|retail)\b"),
    ]
    for kind, pattern in type_specs:
        if re.search(pattern, text):
            args["type"] = kind
            break
    name_match = re.search(r"\b(?:open|select|choose|route(?: me)? to|directions to|take me to)\s+(?:the\s+)?([a-zA-Z0-9 .,'-]{2,80})", command, flags=re.I)
    if not name_match:
        name_match = re.search(r"\bzoom\s+(?:in\s+|out\s+)?(?:on|to|at)\s+(?:the\s+)?([a-zA-Z0-9 .,'-]{2,80})", command, flags=re.I)
    if name_match:
        raw = re.sub(r"\b(?:on the left|on the right|near the center|in the center|at the top|at the bottom|nearby|visible|that|this|place|result)\b", " ", name_match.group(1), flags=re.I)
        raw = re.sub(r"\s+", " ", raw).strip(" .,'-")
        if raw and raw.lower() not in {"hotel", "restaurant", "bar", "place", "one", "result"}:
            args["name"] = raw[:80]
    return args

def _explicit_visible_reference(command: str) -> bool:
    text = str(command or "").lower()
    return bool(
        _visible_selection_args(command)
        or re.search(r"\b(visible|on screen|on the map|map label|map icon|that icon|this icon)\b", text)
    )

def _copilot_result_selection_args(items: object, index: int) -> dict:
    if not isinstance(items, list) or index < 0 or index >= len(items):
        return {"result_index": index}
    item = items[index] if isinstance(items[index], dict) else {}
    args = {"result_index": index}
    for key in ("result_set_id", "result_id", "feature_id", "id", "name", "type", "category", "screen_position"):
        value = item.get(key)
        if value is not None and value != "":
            args[key] = value
    return args

def _clean_route_builder_place(value: str) -> str:
    clean = re.split(r"\b(?:for|with|using|and make|make it|different camps|same camp|basecamp|route style|camp preference|please)\b", value, maxsplit=1, flags=re.I)[0]
    clean = re.sub(r"\b(?:mostly|camping|camps?|campsites?|campgrounds?|wild|adventure|backroads|direct|fastest|balanced|scenic but sane|dispersed|boondock|free|blm|usfs|public land|private stays?|farm|ranch|winery|glamping|rv|developed|reservable|route|trip|plan|days?|nights?)\b", " ", clean, flags=re.I)
    return re.sub(r"\s+", " ", clean).strip(" .,'-")[:120]

def _copilot_rig_profile(context: dict | None = None) -> dict | None:
    user_ctx = (context or {}).get("user") if isinstance((context or {}).get("user"), dict) else {}
    rig = user_ctx.get("rig_profile") if isinstance(user_ctx, dict) else None
    return rig if isinstance(rig, dict) else None

def _route_builder_has_towing_risk(rig: dict | None) -> bool:
    if not isinstance(rig, dict):
        return False
    if rig.get("is_towing") is True:
        return True
    try:
        trailer_len = float(rig.get("trailer_length_ft") or 0)
    except Exception:
        trailer_len = 0.0
    return trailer_len >= 10

def _route_builder_has_low_clearance(rig: dict | None) -> bool:
    if not isinstance(rig, dict):
        return False
    try:
        lift = float(rig.get("lift_in") or 0)
        clearance = float(rig.get("ground_clearance_in") or 0) + lift
    except Exception:
        clearance = 0.0
    return 0 < clearance < 8.5

def _route_builder_clarification(draft: dict, command: str, context: dict | None = None, route_scout_active: bool = False) -> dict | None:
    text = (command or "").lower()
    rig = _copilot_rig_profile(context)
    road_pref = str(draft.get("roadPreference") or "").lower()
    route_style = str(draft.get("routeStyle") or "").lower()
    needs_rough_vehicle = road_pref in {"high_clearance", "4wd_only"} or route_style == "wild"
    if needs_rough_vehicle and not rig:
        return {
            "question": "What should I tune this for: stock SUV, high-clearance rig, or true 4WD build?",
            "options": ["stock SUV", "high-clearance rig", "4WD build"],
            "reason": "missing_rig_for_rough_roads",
        }
    if road_pref in {"high_clearance", "4wd_only"} and _route_builder_has_towing_risk(rig):
        return {
            "question": "You look set up to tow. Keep this trailer-safe, or switch to a rough-road scout for the tow rig only?",
            "options": ["trailer-safe", "rough-road tow rig", "I am not towing"],
            "reason": "towing_conflict",
        }
    if road_pref in {"high_clearance", "4wd_only"} and _route_builder_has_low_clearance(rig):
        return {
            "question": "Your saved rig reads low-clearance for rough-road scouting. Keep it balanced, or switch to a high-clearance route anyway?",
            "options": ["keep it balanced", "switch to high-clearance", "update my rig later"],
            "reason": "low_clearance_conflict",
        }
    camping_intent = bool(re.search(r"\b(camp|camping|campsite|overnight|sleep|dispersed|boondock|rv park|glamping|private stay|lodging|hut|huts|shelter|refuge|bothy|trekking lodge|guest house|base camp|basecamp)\b", text))
    has_primary_signal = any(
        draft.get(key)
        for key in ("campPreference", "driveHours", "routeStyle", "roadPreference", "poiPreferences", "campReuse")
    )
    if draft.get("destination") and not route_scout_active and camping_intent and not draft.get("campPreference"):
        return {
            "question": "What overnight style should I scout first: public/dispersed, developed campgrounds, RV-friendly, or any legal stop?",
            "options": ["public/dispersed", "developed campgrounds", "RV-friendly", "any legal stop"],
            "reason": "missing_camp_preference",
        }
    if draft.get("destination") and not route_scout_active and not has_primary_signal:
        return {
            "question": "How should I bias this scout: direct, balanced, or wild but safe?",
            "options": ["direct", "balanced", "wild but safe"],
            "reason": "missing_route_style",
        }
    vague_update = bool(re.search(r"\b(make it|change it|update it|better|cooler|wilder|rougher|gnarlier|more scenic|quiet|legal)\b", text))
    if route_scout_active and vague_update and not has_primary_signal and not re.search(r"\b(\d{1,2}(?:\.\d+)?)\s*(?:hours?|hrs?)\b", text):
        return {
            "question": "What should I optimize next: easier driving, wilder roads, better camps, or more trails and landmarks?",
            "options": ["easier driving", "wilder roads", "better camps", "trails and landmarks"],
            "reason": "vague_route_tuning",
        }
    return None

def _route_builder_draft_from_text(command: str, context: dict | None = None) -> dict:
    text = (command or "").lower()
    draft: dict = {"source": "copilot", "originalCommand": str(command or "")[:500]}
    days_match = re.search(r"\b(\d{1,2})\s*-?\s*(?:day|days|night|nights)\b", text)
    if days_match:
        draft["days"] = max(1, min(30, int(days_match.group(1))))
    hours_match = re.search(r"\b(\d{1,2}(?:\.\d+)?)\s*(?:hours?|hrs?)\b", text)
    if hours_match:
        draft["driveHours"] = max(1, min(14, float(hours_match.group(1))))
    miles_match = re.search(r"\b(\d{2,3})\s*(?:mi|mile|miles)\b", text)
    if miles_match:
        draft["targetMiles"] = max(20, min(700, int(miles_match.group(1))))
    to_from = re.search(r"\b(?:to|toward)\s+([a-zA-Z0-9 .,'-]{2,120}?)\s+from\s+([a-zA-Z0-9 .,'-]{2,140})", command, flags=re.I)
    from_to = re.search(r"\bfrom\s+([a-zA-Z0-9 .,'-]{2,120}?)\s+(?:to|through|toward)\s+([a-zA-Z0-9 .,'-]{2,140})", command, flags=re.I)
    bare_to = re.search(
        r"^\s*(?:please\s+)?(?:plan|build|create|generate|draft|make(?:\s+me|\s+a)?|route)\b\s*(?:a|an|my)?\s*(?:route|trip|itinerary)?\s+(?!to\b)([a-zA-Z0-9 .,'-]{2,120}?)\s+(?:to|through|toward)\s+([a-zA-Z0-9 .,'-]{2,140})",
        command,
        flags=re.I,
    )
    if to_from:
        dest = _clean_route_builder_place(to_from.group(1))
        start = _clean_route_builder_place(to_from.group(2))
        if start:
            draft["start"] = start
        if dest:
            draft["destination"] = dest
    elif from_to:
        start = _clean_route_builder_place(from_to.group(1))
        dest = _clean_route_builder_place(from_to.group(2))
        if start:
            draft["start"] = start
        if dest:
            draft["destination"] = dest
    elif bare_to:
        start = _clean_route_builder_place(bare_to.group(1))
        dest = _clean_route_builder_place(bare_to.group(2))
        if start:
            draft["start"] = start
        if dest:
            draft["destination"] = dest
    elif re.search(r"\b(?:to|toward)\s+[a-zA-Z0-9 .,'-]{2,120}", command, flags=re.I):
        dest_match = re.search(r"\b(?:to|toward)\s+([a-zA-Z0-9 .,'-]{2,120})", command, flags=re.I)
        dest = _clean_route_builder_place(dest_match.group(1)) if dest_match else ""
        if dest:
            draft["destination"] = dest
    if re.search(r"\b(wild|adventure|backroads?|dirt|remote)\b", text):
        draft["routeStyle"] = "wild"
    elif re.search(r"\b(direct|fastest|quickest)\b", text):
        draft["routeStyle"] = "direct"
    elif re.search(r"\b(scenic but sane|balanced|scenic)\b", text):
        draft["routeStyle"] = "balanced"
    if re.search(r"\b(stock suv|crossover|paved only|easy roads?|low clearance|trailer safe|avoid rough roads?)\b", text):
        draft["roadPreference"] = "paved_ok"
        draft["riskTolerance"] = "conservative"
        draft.setdefault("rigConstraints", {"vehicle_fit": "stock_suv"})
    elif re.search(r"\b(forest roads?|gravel roads?|washboards?|dirt roads?|fire roads?)\b", text):
        draft["roadPreference"] = "dirt_ok"
        draft["riskTolerance"] = "moderate"
    elif re.search(r"\b(high clearance|high-clearance|shelf roads?|rocky roads?|rutted roads?)\b", text):
        draft["roadPreference"] = "high_clearance"
        draft["riskTolerance"] = "wild_but_safe"
        draft.setdefault("rigConstraints", {"vehicle_fit": "high_clearance"})
        draft.setdefault("routeStyle", "wild")
    elif re.search(r"\b(4wd|4x4|technical|gnarly|rough roads?|dangerous|danger|locking diffs?|low range)\b", text):
        draft["roadPreference"] = "4wd_only"
        draft["riskTolerance"] = "wild_but_safe"
        draft.setdefault("rigConstraints", {"vehicle_fit": "4wd"})
        draft.setdefault("routeStyle", "wild")
    elif re.search(r"\b(safe|sane|not stupid|reasonable)\b", text):
        draft["riskTolerance"] = "moderate" if draft.get("routeStyle") == "wild" else "conservative"
    if re.search(r"\b(dispersed|boondock|boondocking|free|blm|usfs|forest service|public lands?)\b", text):
        draft["campPreference"] = "public"
    elif re.search(r"\b(private stays?|farm|ranch|winery|glamping|hipcamp)\b", text):
        draft["campPreference"] = "private"
    elif re.search(r"\b(huts?|shelters?|refuges?|bothy|bothies|trekking lodges?|guest houses?|hostels?|chalets?|base camp|basecamp)\b", text):
        draft["campPreference"] = "developed"
    elif re.search(r"\b(rv|developed|reservable|hookups?)\b", text):
        draft["campPreference"] = "rv" if "rv" in text else "developed"
    if re.search(r"\b(?:photos?|pictures?|images?)\s*(?:only|required|preferred)?\b|\b(?:with|that have)\s+(?:photos?|pictures?|images?)\b", text):
        draft["campPhotoOnly"] = True
    poi_preferences = []
    poi_specs = [
        ("fuel", r"\b(fuel|gas|propane|resupply)\b"),
        ("water", r"\b(water|fill water|water fill)\b"),
        ("trailhead", r"\b(trailheads?|hikes?|hiking|treks?|trekking|base camp|basecamp)\b"),
        ("viewpoint", r"\b(viewpoints?|views?|overlooks?|scenic stops?)\b"),
        ("hot_spring", r"\b(hot springs?)\b"),
        ("food", r"\b(food|restaurants?|dinner|lunch|coffee)\b"),
        ("grocery", r"\b(grocer(?:y|ies)|supplies)\b"),
        ("mechanic", r"\b(mechanic|repair|service)\b"),
        ("attraction", r"\b(attractions?|historic|landmarks?)\b"),
        ("historic", r"\b(history|historic|battlefield|petroglyphs?|rock art|ghost town)\b"),
        ("park", r"\b(parks?|state parks?|national parks?)\b"),
        ("monument", r"\b(monuments?|memorials?)\b"),
        ("visitor_center", r"\b(visitor centers?|ranger stations?)\b"),
        ("water_access", r"\b(lake|river|beach|boat ramp|swimming hole|water access)\b"),
        ("camp_services", r"\b(dump station|showers?|laundry|laundromat|water fill|camp services?)\b"),
    ]
    for key, pattern in poi_specs:
        if re.search(pattern, text):
            poi_preferences.append(key)
    if poi_preferences:
        draft["poiPreferences"] = list(dict.fromkeys(poi_preferences))
    draft["fuelStrategy"] = "auto_when_needed"
    if re.search(r"\b(same camp|same campground|same basecamp|basecamp|base camp|stay put|two nights same camp|same camp window|there and back|out and back)\b", text):
        draft["campReuse"] = "same_camp_window"
        if re.search(r"\b(there and back|out and back)\b", text):
            draft["tripShape"] = "there_and_back"
    elif re.search(r"\b(different camps?|each night|new camp)\b", text):
        draft["campReuse"] = "different_each_night"
    if re.search(r"\b(loop|round trip)\b", text):
        draft["tripShape"] = "loop"
    elif "tripShape" not in draft and re.search(r"\b(one way|one-way)\b", text):
        draft["tripShape"] = "one_way"
    if re.search(r"\b(use my rig|rig profile|vehicle profile|trailer|clearance|high clearance|4wd|4x4|stock suv)\b", text):
        draft["useRigProfile"] = True
        rig = _copilot_rig_profile(context)
        if isinstance(rig, dict):
            draft["rigConstraints"] = rig
    else:
        rig = _copilot_rig_profile(context)
        if isinstance(rig, dict):
            draft["useRigProfile"] = True
            draft["rigConstraints"] = rig
    return draft

def _is_route_builder_request(text: str) -> bool:
    explicit_pair = bool(
        re.search(r"\bfrom\b.+\b(?:to|through|toward)\b", text)
        and re.search(r"\b(route|trip|itinerary|plan|build|create|draft|generate|make)\b", text)
    )
    command_pair = bool(re.search(r"\b(?:plan|build|create|generate|draft|make(?: me| a)?)\b.+\b(?:to|through|toward)\b", text))
    return bool(
        (re.search(r"\b(route builder|trip builder|ai planner|plan|build|create|draft)\b", text)
        and re.search(r"\b(route|trip|itinerary|days?|nights?|from\b.*\bto\b|camp|camps|dispersed|boondock|wild|private stays?)\b", text)
        or explicit_pair
        or command_pair)
        and not re.search(r"\b(route me|directions|navigate there|start navigation|guidance)\b", text)
    )

def _route_builder_should_auto_build(text: str, draft: dict) -> bool:
    if not _is_route_builder_request(text):
        return False
    if re.search(r"\b(open|show|draft|prefill|set up|fill in)\b", text) and not re.search(r"\b(plan|build|create|generate)\b", text):
        return False
    return bool(re.search(r"\b(plan|build|create|generate|make me|make a|route planner|itinerary)\b|\broute\s+from\b", text) and (draft.get("destination") or draft.get("start") or draft.get("days")))

def _build_extreme_map_action(command: str, context: dict, provider: str = "trailhead_openai") -> dict:
    text = (command or "").lower()
    provider = _copilot_provider(provider)
    map_ctx = context.get("map") or {}
    route_ctx = context.get("route") or {}
    trip_ctx = context.get("trip") or {}
    user_ctx = context.get("user") or {}
    app_ctx = context.get("app") if isinstance(context.get("app"), dict) else {}
    center = _valid_context_point(map_ctx.get("center")) or _valid_context_point(user_ctx.get("location"))
    route_active = bool(route_ctx.get("active_route") or route_ctx.get("destination") or trip_ctx.get("active_trip"))
    route_scout_ctx = route_ctx.get("route_scout") if isinstance(route_ctx.get("route_scout"), dict) else {}
    route_scout_capable = bool(app_ctx.get("route_scout_enabled") or route_scout_ctx)
    route_scout_active = bool(route_scout_ctx and route_scout_ctx.get("status") not in {None, "", "idle", "failed"})

    action_type = "explainVisibleArea"
    args: dict = {"scope": "visible_area"}
    message = "I can explain this area or stage a map action."
    map_updates: dict = {"assistant_panel": True}
    selected_place = None
    route_preview = None
    route_builder_draft = None
    cost_class = "local"
    requires_confirmation = False

    if re.search(r"\b(mission control|trip readiness|is (?:this|my) trip ready|are we ready|ready to go|what(?:'s| is) risky|risky ahead|why (?:is|isn'?t)|what do i need before|before i lose signal)\b", text):
        action_type = "showMissionControl"
        args = {"scope": "active_trip"}
        map_updates = {"assistant_panel": True, "mission_control": True}
        message = "Mission Control is checking the route."
    elif re.search(r"(?:^|\s)/help\b|\bwhat can (?:i|you) do\b|\bhelp\b|\bcapabilities\b|\bhow do i\b", text):
        action_type = "getMapContext"
        args = {"scope": "current_screen", "capabilities": TRAILHEAD_COPILOT_CAPABILITY_REGISTRY}
        map_updates = {"assistant_panel": True}
        message = "I can help with this screen, map search, route previews, Route Builder, Guide, reports, offline, rig profile, and safety workflows."
    elif route_scout_active and re.search(r"\b(\d{1,2}(?:\.\d+)?)\s*(?:hours?|hrs?)\b", text):
        draft = dict(route_scout_ctx.get("draftArgs") if isinstance(route_scout_ctx.get("draftArgs"), dict) else {})
        draft.update(_route_builder_draft_from_text(command, context))
        action_type = "startRouteScout"
        args = {"draft": draft}
        route_builder_draft = draft
        map_updates = {"route_scout": True, "route_scout_tune": True}
        message = "Route Scout is tuning the daily drive window."
    elif route_scout_ctx.get("status") == "needs_input" and not re.search(r"\b(save|send|export|open)\b.*\b(route builder|builder|draft)\b|\broute builder\b.*\b(save|send|open)\b", text):
        draft = dict(route_scout_ctx.get("draftArgs") if isinstance(route_scout_ctx.get("draftArgs"), dict) else {})
        draft.update(_route_builder_draft_from_text(command, context))
        clarify = _route_builder_clarification(draft, command, context, route_scout_active=True)
        action_type = "startRouteScout"
        args = {"draft": draft}
        if clarify:
            args["clarify"] = clarify
            message = clarify["question"]
        else:
            message = "Route Scout is updating the route preview."
        route_builder_draft = draft
        map_updates = {"route_scout": True, "route_scout_tune": True}
    elif route_scout_active and re.search(r"\b(save|send|export|open)\b.*\b(route builder|builder|draft)\b|\broute builder\b.*\b(save|send|open)\b", text):
        action_type = "saveScoutToRouteBuilder"
        args = {"source": "active_route_scout"}
        map_updates = {"open_route_builder": True, "route_scout_save": True}
        message = "Route Scout will save this to Route Builder."
    elif route_scout_active and re.search(r"\b(build it|create it|run it|generate it|finish the route|build the framework|make it|change it|update it|different camps?|same camp|basecamp|private stays?|dispersed|boondock|direct|fastest|wild|scenic but sane|use my rig|rig profile|vehicle profile)\b", text) and not re.search(r"\b(route builder|trip builder|builder|draft|prefill|open (my )?rig|show (my )?rig|edit (my )?rig|set up (my )?rig)\b", text):
        draft = dict(route_scout_ctx.get("draftArgs") if isinstance(route_scout_ctx.get("draftArgs"), dict) else {})
        draft.update(_route_builder_draft_from_text(command, context))
        action_type = "startRouteScout"
        args = {"draft": draft}
        route_builder_draft = draft
        map_updates = {"route_scout": True, "route_scout_tune": True}
        message = "Route Scout is updating the map preview."
    elif re.search(r"\b(build it|create it|run it|generate it|finish the route|build the framework)\b", text):
        action_type = "buildRouteBuilderFramework"
        args = {"draft": _route_builder_draft_from_text(command, context)}
        args["draft"]["autoBuild"] = True
        route_builder_draft = args["draft"]
        map_updates = {"open_route_builder": True, "route_builder_auto_build": True}
        message = "Route Builder is building the trip framework."
    elif _is_route_builder_request(text):
        draft = _route_builder_draft_from_text(command, context)
        explicit_builder = bool(re.search(r"\b(route builder|trip builder|builder|draft|prefill)\b", text))
        if route_scout_capable and not explicit_builder and _route_builder_should_auto_build(text, draft):
            clarify = _route_builder_clarification(draft, command, context, route_scout_active=False)
            action_type = "startRouteScout"
            args = {"draft": draft}
            if clarify:
                args["clarify"] = clarify
                message = clarify["question"]
            else:
                message = "Route Scout is plotting the route and looking for overnight stops."
            route_builder_draft = draft
            map_updates = {"route_scout": True, "route_preview": True}
        elif _route_builder_should_auto_build(text, draft):
            draft["autoBuild"] = True
            action_type = "buildRouteBuilderFramework"
            map_updates = {"open_route_builder": True, "route_builder_auto_build": True}
            message = "Route Builder is building the trip framework."
        else:
            action_type = "openRouteBuilderDraft"
            map_updates = {"open_route_builder": True, "route_builder_draft": True}
            message = "Route Builder draft ready."
        args = {"draft": draft}
        route_builder_draft = args["draft"]
    elif re.search(r"\b(make it|change it|update (the )?draft|different camps?|same camp|basecamp|private stays?|dispersed|boondock|direct|fastest|wild|scenic but sane|use my rig|rig profile)\b", text) and not re.search(r"\b(route me|navigate|start navigation|open (my )?rig|show (my )?rig|edit (my )?rig|set up (my )?rig)\b", text):
        action_type = "updateRouteBuilderDraft"
        args = {"draft": _route_builder_draft_from_text(command, context)}
        route_builder_draft = args["draft"]
        map_updates = {"route_builder_draft": True}
        message = "Route Builder draft updated."
    elif re.search(r"\b(start navigation|start guidance|navigate there|navigate to it|begin navigation|go there now)\b", text):
        action_type = "startNavigation"
        args = {"instruction": command[:240], "destination": route_ctx.get("destination") or map_ctx.get("selected_place"), "require_location": True}
        map_updates = {"navigation": {"requested": True}, "route_preview": True}
        route_preview = {"status": "requires_confirmation", "instruction": command[:240]}
        message = "Confirm to start navigation."
        requires_confirmation = True
    elif re.search(r"\b(open|show|go to)\s+(the\s+)?guide\b|\baudio guide\b", text):
        action_type = "playTripGuide" if re.search(r"\b(play|read|generate)\b", text) else "openGuide"
        args = {"trip_id": trip_ctx.get("active_trip") or trip_ctx.get("trip_id"), "play": action_type == "playTripGuide"}
        map_updates = {"open_guide": True}
        message = "Guide opened." if action_type == "openGuide" else "Trip guide needs confirmation before generating or playing."
        requires_confirmation = action_type == "playTripGuide"
    elif re.search(r"\breports?|alerts?|road condition|hazard|closure|washout\b", text):
        action_type = "stageReport" if re.search(r"\b(add|create|submit|report)\b", text) and not re.search(r"\b(show|what|nearby|open)\b", text) else "openReports"
        args = {"near": center, "report_type": "road_condition", "needs_location": action_type == "stageReport"}
        map_updates = {"open_reports": True}
        message = "Reports opened." if action_type == "openReports" else "Report creation needs confirmation and location."
        requires_confirmation = action_type == "stageReport"
    elif re.search(r"\b(show|open)\s+(offline|downloads?)\b", text):
        action_type = "openOfflineDownloads"
        args = {"target": "active_trip" if trip_ctx.get("active_trip") else "visible_area"}
        map_updates = {"open_offline_download": True}
        message = "Offline downloads opened."
    elif re.search(r"\b(open|show|edit|set up|go to)\s+(my\s+)?(rig|rig profile|vehicle profile)\b|\b(open|show|edit)\s+profile\b", text):
        action_type = "openRigProfile"
        args = {"read_context": True, "explicit_request": True, "rig_profile": user_ctx.get("rig_profile")}
        map_updates = {"open_rig_profile": True}
        message = "Rig profile opened."
    elif re.search(r"\bradar|weather|storm|rain|snow|wind|heat|cold|risk\b", text):
        action_type = "toggleLayer"
        args = {"layer": "radar", "show": True, "route_risk": route_active}
        map_updates = {"layers": {"radar": True}, "weather_route_risk": route_active}
        message = "Weather radar is ready to turn on."
    elif re.search(r"\b(public lands?|land ownership|blm|usfs|forest service|bureau of land management)\b", text):
        action_type = "toggleLayer"
        args = {"layer": "lands", "show": not re.search(r"\boff|hide|disable\b", text)}
        map_updates = {"layers": {"lands": args["show"]}}
        message = "Public lands layer is ready."
    elif re.search(r"\b(satellite|sat view|aerial)\b", text):
        action_type = "setMapStyle"
        args = {"style": "satellite"}
        map_updates = {"map_style": "satellite"}
        message = "Satellite map staged."
    elif re.search(r"\b(topo|topographic|terrain map|contours?)\b", text):
        action_type = "setMapStyle"
        args = {"style": "topo"}
        map_updates = {"map_style": "topo"}
        message = "Topo map staged."
    elif re.search(r"\b(zoom\s+(?:in|out)|zoom\s+(?:closer|back|wide)|closer|pull back|back out|wider view|more detail)\b", text):
        direction = "out" if re.search(r"\b(zoom\s+out|zoom\s+back|pull back|back out|wider view|wide|farther)\b", text) else "in"
        visible_args = _visible_selection_args(command)
        args = {"direction": direction, "delta": 1.4, "refresh_visible": True, **visible_args}
        if re.search(r"\b(that|this|there|selected)\b", text) and isinstance(map_ctx.get("selected_place"), dict):
            args["target"] = map_ctx.get("selected_place")
        action_type = "zoomMap"
        map_updates = {"zoom": args}
        message = "Map zoom staged."
    elif re.search(r"\b(find|show|search|look for|suggest|recommend)\b.*\b(places?|somewhere|stops?|options?|things?)\b", text) and not re.search(r"\b(food|restaurant|eat|dining|dinner|lunch|breakfast|cafe|coffee|bar|pizza|tacos?|mexican|burgers?|bbq|barbecue|sushi|thai|italian|sandwiches?|deli|hotels?|motels?|lodg(?:e|ing)|camp|campsite|trail|trailhead|hike|fuel|gas|propane|views?|viewpoints?|scenic|overlook|vista|landmarks?|attractions?|sights?)\b", text):
        action_type = "askForConfirmation"
        args = {
            "question": "What kind of places should I search for?",
            "options": ["camps", "lodging", "food", "fuel", "attractions", "trails"],
            "near": center,
            "reason": "ambiguous_place_category",
        }
        map_updates = {"needs_category": True, "options": args["options"]}
        message = "Choose a category first: camps, lodging, food, fuel, attractions, or trails."
    elif re.search(r"\bfuel|gas|propane|range|empty\b", text):
        action_type = "searchPlaces"
        category = "propane" if "propane" in text else "fuel"
        args = {"category": category, "route_scoped": route_active, "near": center}
        map_updates = {"open_search": True, "search_mode": "browse", "category": category}
        message = "Fuel search staged near your route or map view." if category == "fuel" else "Propane search staged near your route or map view."
    elif re.search(r"\b(food|restaurant|eat|dining|dinner|lunch|breakfast|cafe|coffee|bar|pizza|tacos?|mexican|burgers?|bbq|barbecue|sushi|thai|italian|sandwiches?|deli)\b", text):
        action_type = "searchPlaces"
        query = _extract_place_query(command)
        keyword = _extract_food_keyword(command)
        open_card = bool(re.search(r"\b(best|top|first|nearest|closest|open|show me one|pick one)\b", text))
        args = {"category": "food", "route_scoped": route_active, "near": center, "query": query, "keyword": keyword, "open_card": open_card, "limit": 8}
        map_updates = {"result_list": True, "open_card": open_card, "category": "food", "query": query, "keyword": keyword}
        message = f"{keyword.title() if keyword else 'Food'} search staged near {query}." if query else f"{keyword.title() if keyword else 'Food'} search staged for the current map view."
    elif re.search(r"\b(cool places?|things to do|views?|viewpoints?|scenic|overlook|vista|landmarks?|attractions?|sights?|parks?|monuments?|historic|visitor centers?|water access|swimming holes?)\b", text):
        action_type = "searchPlaces"
        query = _extract_place_query(command)
        category = "viewpoint" if re.search(r"\b(views?|viewpoints?|scenic|overlook|vista)\b", text) else "attraction"
        open_card = bool(re.search(r"\b(best|top|first|nearest|closest|open|show me one|pick one)\b", text))
        args = {"category": category, "route_scoped": route_active, "near": center, "query": query, "open_card": open_card, "limit": 8}
        map_updates = {"result_list": True, "open_card": open_card, "category": category, "query": query}
        message = f"{'Viewpoint' if category == 'viewpoint' else 'Attraction'} search staged near {query}." if query else "Place search staged for the current map view."
    elif re.search(r"\b(hotels?|motels?|lodg(?:e|ing)|places? to stay|inns?|hostels?)\b", text):
        action_type = "searchPlaces"
        query = _extract_place_query(command)
        open_card = bool(re.search(r"\b(best|top|first|nearest|closest|open|show me one|pick one)\b", text))
        args = {"category": "lodging", "route_scoped": route_active, "near": center, "query": query, "open_card": open_card, "limit": 8}
        map_updates = {"result_list": True, "open_card": open_card, "category": "lodging", "query": query}
        message = f"Lodging search staged near {query}." if query else "Lodging search staged for the current map view."
    elif re.search(r"\btrail|trailhead|hike|peak|hot spring\b", text):
        action_type = "searchTrails"
        args = {"category": "trails", "route_scoped": route_active, "near": center}
        map_updates = {"open_discovery": True, "discovery_mode": "trails"}
        message = "Trail discovery staged for the current map view."
    elif re.search(r"\bcamp|campsite|sleep|overnight|stay|rv park|private\b", text):
        action_type = "searchPlaces"
        query = _extract_place_query(command)
        args = {"category": "camp", "route_scoped": route_active, "near": center, "query": query, "open_card": bool(query)}
        map_updates = {"open_discovery": True, "discovery_mode": "camps", "query": query}
        message = f"Camp search staged near {query}." if query else "Camp search staged for the current map view."
    elif re.search(r"\bdrop (a )?pin|mark here|save pin|pin here\b", text):
        action_type = "dropPin"
        args = {"at": center, "pin_type": "camp" if "camp" in text else "other"}
        map_updates = {"pin_drop": {"at": center}}
        message = "Pin creation needs confirmation before it is saved."
        requires_confirmation = True
    elif re.search(r"\boffline|download\b", text):
        action_type = "downloadOfflineArea"
        args = {"target": "active_trip" if trip_ctx.get("active_trip") else "visible_area", "bounds": map_ctx.get("bounds")}
        map_updates = {"open_offline_download": True}
        message = "Offline download needs confirmation before it starts."
        requires_confirmation = True
    elif re.search(r"\bsave (this )?trip|save route|save plan\b", text):
        action_type = "saveTrip"
        args = {"trip_id": trip_ctx.get("active_trip") or trip_ctx.get("trip_id")}
        message = "Trip save needs confirmation."
        requires_confirmation = True
    elif re.search(r"\breroute|avoid|detour|alternate|change route|modify route\b", text):
        action_type = "modifyRoute"
        args = {"instruction": command[:240], "route_id": route_ctx.get("route_id")}
        map_updates = {"route_preview": True}
        route_preview = {"status": "staged", "instruction": command[:240]}
        message = "Route change staged for confirmation."
        requires_confirmation = True
    elif re.search(r"\b(select|choose|open|take me to)\b.*\b(first|second|third|1|2|3|result)\b|\b(first|second|third) result\b|\b(another|next one|next result|show another|open another)\b", text):
        visible_features = map_ctx.get("visible_map_features") if isinstance(map_ctx.get("visible_map_features"), list) else []
        current_results = map_ctx.get("current_results") if isinstance(map_ctx.get("current_results"), list) else []
        if visible_features and not current_results and route_active and not _explicit_visible_reference(command):
            action_type = "askForConfirmation"
            args = {
                "question": "I do not have a route result list yet. Do you want camps, trails, fuel, food, or a visible map label?",
                "options": ["camps", "trails", "fuel", "food", "visible map label"],
                "reason": "route_selection_without_result_list",
            }
            map_updates = {"needs_category": True, "options": args["options"]}
            message = args["question"]
        else:
            action_type = "selectVisiblePlace" if visible_features and not current_results else "selectPlace"
        if re.search(r"\bthird\b|\b3\b", text):
            index = 2
        elif re.search(r"\bsecond\b|\b2\b|\banother\b|\bnext one\b|\bnext result\b|\bshow another\b|\bopen another\b", text):
            index = 1
        else:
            index = 0
        if action_type != "askForConfirmation":
            args = _copilot_result_selection_args(visible_features if action_type == "selectVisiblePlace" else current_results, index)
            for key, value in _visible_selection_args(command).items():
                if key == "name" and args.get("result_id"):
                    continue
                args[key] = value
            map_updates = {"select_result_index": index}
            selected_place = {"result_index": index}
            message = "Selection staged from the current result list."
    elif re.search(r"\b(open|select|choose)\b.*\b(hotel|motel|restaurant|bar|cafe|coffee|shop|store|museum|park|on the left|on the right|near the center|in the center)\b", text):
        action_type = "selectVisiblePlace"
        args = _visible_selection_args(command)
        map_updates = {"select_visible_place": args}
        message = "Visible place selection staged."
    elif re.search(r"\broute me|directions|guidance|preview (a )?route|route to\b", text):
        visible_args = _visible_selection_args(command)
        action_type = "routeToSelectedPlace" if visible_args and re.search(r"\b(that|this|visible|on the left|on the right|near the center|in the center|hotel|restaurant|bar|cafe|shop|store|museum)\b", text) else "buildRoute"
        query = _extract_route_query(command)
        args = {"instruction": command[:240], "destination": route_ctx.get("destination") or map_ctx.get("selected_place"), "query": query, **visible_args}
        map_updates = {"route_preview": True, "open_search": not bool(args.get("destination"))}
        route_preview = {"status": "preview", "instruction": command[:240]}
        message = "Route preview staged. Confirm separately before starting navigation."
        requires_confirmation = False
    elif re.search(r"\bfly|zoom|center|show me|go to|take me to\b", text):
        action_type = "flyToPlace"
        query = ""
        query_match = re.search(r"\b(?:fly|zoom|center|show me|go to|take me to)\s+(?:the map\s+)?(?:to|on|at|around)?\s*([a-z0-9 .,'-]{2,80})", text)
        if query_match:
            query = re.sub(r"\b(?:please|map|view|area|there|here)\b", " ", query_match.group(1), flags=re.I).strip(" .,'-")
        target = {"name": query} if query else (map_ctx.get("selected_place") or center)
        args = {"target": target, "query": query, "zoom": 13}
        map_updates = {"fly_to": args}
        message = "Map move staged."

    if action_type in EXTREME_COPILOT_CONFIRM_ACTIONS:
        requires_confirmation = True
    return {
        "action_id": f"copilot_{uuid.uuid4().hex[:12]}",
        "action_type": action_type,
        "args": args,
        "requires_confirmation": requires_confirmation,
        "cost_class": cost_class,
        "surface": "map_layers",
        "provider": provider,
        "message": message,
        "map_updates": map_updates,
        "selected_place": selected_place,
        "route_preview": route_preview,
        "route_builder_draft": route_builder_draft,
    }

def _extreme_weather_risk_points(body: ExtremeRouteRiskRequest) -> list[dict]:
    points: list[dict] = []
    for cp in body.checkpoints[:20]:
        if str(cp.type).lower() == "weather":
            points.append(cp.dict())
    if points:
        return points[:12]
    route = [p for p in body.route if isinstance(p, dict)]
    if len(route) >= 3:
        candidates = [route[len(route) // 3], route[(len(route) * 2) // 3]]
    else:
        candidates = route[:2]
    for idx, point in enumerate(candidates):
        try:
            lat = float(point.get("lat"))
            lng = float(point.get("lng"))
        except (TypeError, ValueError):
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            points.append({
                "id": f"weather-risk-{idx + 1}",
                "type": "weather",
                "title": "Weather review",
                "note": "Review route conditions before this stretch.",
                "lat": lat,
                "lng": lng,
                "day": int(point.get("day") or idx + 1),
                "sequence": idx + 1,
                "status": "suggested",
                "source": "trailhead",
                "source_id": "",
                "confidence": "estimated",
                "expires_at": None,
            })
    return points[:12]

def _admin_extreme_config_values(body: AdminExtremeConfigBody) -> dict:
    values: dict = {}
    bool_keys = (
        "enabled", "kill_switch", "navigation_enabled", "weather_enabled",
        "voice_enabled", "copilot_enabled", "copilot_wake_phrase_enabled", "native_mode_enabled",
        "mission_control_enabled", "adventure_scores_enabled",
        "mission_provider_evidence_enabled",
        "mapgpt_pilot_enabled", "atlas_pilot_enabled",
    )
    for key in bool_keys:
        value = getattr(body, key)
        if value is not None:
            values[key] = bool(value)
    if body.allowed_surfaces is not None:
        surfaces = []
        for surface in body.allowed_surfaces[:12]:
            clean = _clean_extreme_surface(surface)
            if clean:
                surfaces.append(clean)
        values["allowed_surfaces"] = list(dict.fromkeys(surfaces or ["map_layers"]))
    int_specs = {
        "max_demo_session_seconds": (60, 7200),
        "max_navigation_session_seconds": (300, 86400),
        "cost_cap_cents_daily": (0, 1_000_000),
    }
    for key, (min_value, max_value) in int_specs.items():
        value = getattr(body, key)
        if value is not None:
            values[key] = max(min_value, min(int(value), max_value))
    if body.copilot_persona is not None:
        values["copilot_persona"] = " ".join(body.copilot_persona.split())[:160]
    if body.copilot_voice is not None:
        values["copilot_voice"] = re.sub(r"[^a-zA-Z0-9_.:-]+", "_", body.copilot_voice.strip())[:80]
    return values


def _normalize_place_category(value: object) -> str:
    category = re.sub(r"[^a-z0-9_]+", "", str(value or "").lower().replace(" ", "_"))
    return EXPLORE_CATEGORY_ALIASES.get(category, category)


def _today_key() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")


def _explore_category_unlock_key(user_id: int, group: str = EXPLORE_CATEGORY_GROUP) -> str:
    clean_group = re.sub(r"[^a-z0-9_:-]+", "", (group or EXPLORE_CATEGORY_GROUP).lower()) or EXPLORE_CATEGORY_GROUP
    return f"place_category_unlock:{user_id}:{_today_key()}:{clean_group}"


def _paid_place_detail_unlock_key(user_id: int, source: str, place_id: str) -> str:
    clean_source = re.sub(r"[^a-z0-9_:-]+", "", (source or "").lower())[:40]
    clean_place_id = hashlib.sha1(str(place_id or "").strip().encode("utf-8")).hexdigest()[:24]
    return f"paid_place_detail_unlock:{user_id}:{clean_source}:{clean_place_id}"


def _has_paid_place_detail_access(user: dict | None, source: str, place_id: str) -> bool:
    if not user:
        return False
    if user.get("is_admin") or has_active_plan(user):
        return True
    return bool(get_cached("campsite_cache", _paid_place_detail_unlock_key(user["id"], source, place_id), ttl_seconds=3600 * 24))


def _has_explore_category_access(user: dict | None, group: str = EXPLORE_CATEGORY_GROUP) -> bool:
    if not user:
        return False
    if user.get("is_admin") or has_active_plan(user):
        return True
    return bool(get_cached("campsite_cache", _explore_category_unlock_key(user["id"], group), ttl_seconds=3600 * 36))


def _authorize_place_categories(categories: set[str], user: dict | None) -> tuple[set[str], list[str], dict]:
    normalized = {_normalize_place_category(c) for c in categories if str(c).strip()}
    locked = sorted(c for c in normalized if c in EXPLORE_PLACE_CATEGORIES)
    has_access = _has_explore_category_access(user)
    allowed = normalized if has_access else {c for c in normalized if c not in EXPLORE_PLACE_CATEGORIES}
    metadata = {
        "explore_group": EXPLORE_CATEGORY_GROUP,
        "explore_unlocked": has_access,
        "unlock_cost": AI_COSTS["explore_category_day"],
        "locked_categories": [] if has_access else locked,
    }
    return allowed, ([] if has_access else locked), metadata


def _official_free_categories_for_request(categories: set[str]) -> set[str]:
    normalized = {_normalize_place_category(c) for c in categories if str(c).strip()}
    return {c for c in normalized if c in OFFICIAL_FREE_PLACE_CATEGORIES}


def _is_official_free_place(item: dict) -> bool:
    source = str(item.get("source") or "").lower()
    label = str(item.get("source_label") or item.get("verified_source") or item.get("attribution") or "").lower()
    return source in OFFICIAL_FREE_PLACE_SOURCES or any(token in label for token in ("national park", "bureau of land management", "forest service", "recreation.gov", "wikipedia", "openstreetmap"))


# ── Core ──────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    site_index = WEB_DIST / "index.html"
    if site_index.exists():
        return FileResponse(site_index, media_type="text/html")
    if LANDING.exists():
        return LANDING.read_text()
    return DASH.read_text()

@app.head("/")
async def index_head():
    return Response(status_code=200, media_type="text/html")

@app.get("/app", response_class=HTMLResponse)
async def app_page():
    web_index = WEB_DIST / "app" / "index.html"
    if web_index.exists():
        return FileResponse(web_index, media_type="text/html")
    return DASH.read_text()

@app.head("/app")
async def app_page_head():
    return Response(status_code=200, media_type="text/html")

@app.get("/journal", response_class=HTMLResponse)
async def journal_page():
    site_journal = WEB_DIST / "journal" / "index.html"
    if site_journal.exists():
        return FileResponse(site_journal, media_type="text/html")
    return await blog_index()

@app.get("/blog", response_class=HTMLResponse)
async def blog_index():
    site_blog = WEB_DIST / "blog" / "index.html"
    if site_blog.exists():
        return FileResponse(site_blog, media_type="text/html")
    if BLOG_INDEX.exists():
        return BLOG_INDEX.read_text()
    raise HTTPException(404, "Blog not found")

@app.head("/blog")
async def blog_index_head():
    return Response(status_code=200, media_type="text/html")

@app.get("/blog/{slug}", response_class=HTMLResponse)
async def blog_post(slug: str):
    site_post = WEB_DIST / "blog" / slug / "index.html"
    if site_post.exists():
        return FileResponse(site_post, media_type="text/html")
    filename = BLOG_POSTS.get(slug)
    if not filename:
        raise HTTPException(404, "Post not found")
    post = BLOG_DIR / filename
    if not post.exists():
        raise HTTPException(404, "Post not found")
    return post.read_text()

@app.head("/blog/{slug}")
async def blog_post_head(slug: str):
    if not (WEB_DIST / "blog" / slug / "index.html").exists() and slug not in BLOG_POSTS:
        raise HTTPException(404, "Post not found")
    return Response(status_code=200, media_type="text/html")

@app.get("/hero.mp4")
async def site_hero_video():
    path = WEB_DIST / "hero.mp4"
    if not path.exists():
        raise HTTPException(404, "Asset not found")
    return FileResponse(path, media_type="video/mp4")

@app.get("/hero.jpg")
async def site_hero_poster():
    path = WEB_DIST / "hero.jpg"
    if not path.exists():
        raise HTTPException(404, "Asset not found")
    return FileResponse(path, media_type="image/jpeg")

@app.get("/favicon.svg")
async def site_favicon():
    path = WEB_DIST / "favicon.svg"
    if not path.exists():
        raise HTTPException(404, "Asset not found")
    return FileResponse(path, media_type="image/svg+xml")

@app.get("/sitemap-index.xml")
async def sitemap_index():
    path = WEB_DIST / "sitemap-index.xml"
    if not path.exists():
        raise HTTPException(404, "Asset not found")
    return FileResponse(path, media_type="application/xml")

@app.get("/sitemap-0.xml")
async def sitemap_zero():
    path = WEB_DIST / "sitemap-0.xml"
    if not path.exists():
        raise HTTPException(404, "Asset not found")
    return FileResponse(path, media_type="application/xml")

@app.get("/admin", response_class=HTMLResponse)
async def admin_page():
    return ADMIN.read_text()

@app.get("/favicon.ico")
async def favicon():
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#050505"/><path d="M32 10 13 54h38L32 10Z" fill="none" stroke="#e5e7eb" stroke-width="4" stroke-linejoin="round"/><path d="M24 39 32 20l8 19" fill="none" stroke="#6da8ff" stroke-width="3" stroke-linejoin="round"/></svg>"""
    return Response(content=svg, media_type="image/svg+xml")

@app.head("/favicon.ico")
async def favicon_head():
    return Response(status_code=200, media_type="image/svg+xml")

@app.get("/assets/app-icon.png")
async def app_icon():
    if not APP_ICON.exists():
        raise HTTPException(404, "App icon not found")
    return Response(content=APP_ICON.read_bytes(), media_type="image/png")

@app.head("/assets/app-icon.png")
async def app_icon_head():
    if not APP_ICON.exists():
        raise HTTPException(404, "App icon not found")
    return Response(status_code=200, media_type="image/png")

@app.get("/api/health")
async def health():
    cleanup_stale_data()
    return {"status": "ok", "service": "trailhead"}

@app.get("/api/providers/registry")
async def provider_registry():
    return {
        "schema_version": 1,
        "generated_at": int(time.time()),
        "providers": list_provider_metadata(),
    }


OFFER_EVENT_TYPES = {
    "commerce_offer_impression",
    "commerce_offer_click",
    "commerce_offer_save",
    "commerce_offer_redirect",
    "commerce_offer_dismiss",
}
SAFE_OFFER_CONTEXT_KEYS = {
    "camp_nights",
    "party_size",
    "placement",
    "query_kind",
    "route_type",
    "surface",
    "trip_type",
    "vehicle_type",
}


def _clean_offer_slug(value: object, max_len: int = 120) -> str:
    return re.sub(r"[^a-zA-Z0-9_.:-]+", "_", str(value or "").strip())[:max_len].strip("._:-")


def _clean_offer_label(value: object, max_len: int = 120) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())[:max_len]


def _offer_provider_id(provider: object = "outdoorsy") -> str:
    provider_id = _clean_offer_slug(provider or "outdoorsy", 48).lower()
    if provider_id in {"", "all"}:
        return "outdoorsy"
    if provider_id != "outdoorsy":
        raise HTTPException(400, "Provider unavailable")
    return provider_id


def _outdoor_offer_disclosure() -> dict[str, str]:
    return {
        "kind": PARTNER_BOOKING_DISCLOSURE_KIND,
        "label": PARTNER_BOOKING_DISCLOSURE_LABEL,
    }


def _rental_offer_search(query: OfferSearchQuery) -> OfferSearchResult:
    if _offer_provider_id(query.provider or "outdoorsy") == "outdoorsy":
        return OutdoorsyProvider(outdoorsy_config_from_env()).search_rentals(query)
    return OfferSearchResult("outdoorsy", "empty", offers=[], reason="provider_unavailable")


def _public_offer_search_response(result: OfferSearchResult) -> dict[str, Any]:
    offers = [offer.to_public_dict() for offer in result.offers] if result.status == "ok" else []
    status = "ok" if result.status == "ok" else "empty"
    return {
        "provider": result.provider,
        "status": status,
        "offers": offers,
        "results": offers,
        "count": len(offers),
        "fetched_at": result.fetched_at,
        "expires_at": result.expires_at if status == "ok" else 0,
        "disclosure": _outdoor_offer_disclosure(),
    }


def _offer_event_context(context: object) -> dict[str, object]:
    if not isinstance(context, dict):
        return {}
    clean: dict[str, object] = {}
    for key in SAFE_OFFER_CONTEXT_KEYS:
        if key not in context:
            continue
        value = context.get(key)
        if isinstance(value, bool):
            clean[key] = value
        elif isinstance(value, int):
            clean[key] = max(0, min(value, 90))
        elif isinstance(value, float):
            clean[key] = round(max(0.0, min(value, 90.0)), 1)
        elif value is not None:
            clean[key] = _clean_offer_label(value, 80)
    return clean


def _record_offer_event(event_type: str, body: OfferEventRequest, user: dict | None) -> dict[str, bool]:
    if event_type not in OFFER_EVENT_TYPES:
        raise HTTPException(400, "Unsupported offer event")
    provider_id = _offer_provider_id(body.provider)
    offer_id = _clean_offer_slug(body.offer_id, 160)
    if not offer_id:
        raise HTTPException(400, "Offer unavailable")
    placement = _clean_offer_slug(body.placement, 80)
    route_type = _clean_offer_label(body.route_type, 80)
    session_id = _clean_offer_slug(body.session_id, 120) or None
    event_data: dict[str, object] = {
        "offer_id": offer_id,
        "provider": provider_id,
        "placement": placement,
        "route_type": route_type,
        "timestamp": int(time.time()),
    }
    context = _offer_event_context(body.context)
    if context:
        event_data["context"] = context
    log_event(user["id"] if user else None, session_id, event_type, event_data)
    return {"ok": True}


@app.get("/api/offers/rentals")
async def rental_offers(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    start_date: str = "",
    end_date: str = "",
    sleeps: Optional[int] = None,
    vehicle_type: str = "",
    pet_friendly: Optional[bool] = None,
    delivery: Optional[bool] = None,
    limit: int = 12,
    provider: str = "outdoorsy",
):
    provider_id = _offer_provider_id(provider)
    query = OfferSearchQuery(
        lat=lat,
        lng=lng,
        start_date=start_date,
        end_date=end_date,
        sleeps=sleeps,
        vehicle_type=vehicle_type,
        pet_friendly=pet_friendly,
        delivery=delivery,
        limit=limit,
        provider=provider_id,
    )
    if query.validation_error():
        raise HTTPException(400, "Invalid rental search")
    return _public_offer_search_response(_rental_offer_search(query))


@app.get("/api/offers/{offer_id}")
async def outdoor_offer_detail(offer_id: str, provider: str = "outdoorsy"):
    provider_id = _offer_provider_id(provider or str(offer_id).split(":", 1)[0])
    result = _rental_offer_search(OfferSearchQuery(limit=24, provider=provider_id))
    for offer in result.offers:
        if offer.id == offer_id or offer.provider_offer_id == offer_id:
            return {
                "status": "ok",
                "provider": offer.provider,
                "offer": offer.to_public_dict(),
                "disclosure": _outdoor_offer_disclosure(),
            }
    raise HTTPException(404, "Offer not available")


@app.post("/api/offers/impression")
async def offer_impression(body: OfferEventRequest, user: dict | None = Depends(_optional_user)):
    return _record_offer_event("commerce_offer_impression", body, user)


@app.post("/api/offers/click")
async def offer_click(body: OfferEventRequest, user: dict | None = Depends(_optional_user)):
    return _record_offer_event("commerce_offer_click", body, user)


@app.post("/api/offers/save")
async def offer_save(body: OfferEventRequest, user: dict | None = Depends(_optional_user)):
    return _record_offer_event("commerce_offer_save", body, user)


@app.post("/api/offers/redirect")
async def offer_redirect(body: OfferEventRequest, user: dict | None = Depends(_optional_user)):
    return _record_offer_event("commerce_offer_redirect", body, user)


@app.post("/api/offers/dismiss")
async def offer_dismiss(body: OfferEventRequest, user: dict | None = Depends(_optional_user)):
    return _record_offer_event("commerce_offer_dismiss", body, user)

# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str; username: str; password: str; referral_code: str = ""

class LoginRequest(BaseModel):
    email: str; password: str

class OAuthLoginRequest(BaseModel):
    identity_token: str
    full_name: str = ""
    email: str = ""

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

@app.post("/api/auth/oauth/apple")
async def apple_oauth_login(body: OAuthLoginRequest):
    return await _oauth_login("apple", body)

@app.post("/api/auth/oauth/google")
async def google_oauth_login(body: OAuthLoginRequest):
    return await _oauth_login("google", body)

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
        return HTMLResponse(_verification_failed_html(), status_code=400)
    _grant_signup_rewards(user)
    return HTMLResponse(_verification_success_html())

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
    <div class="brand"><div class="mark">T</div><div><div class="name">TRAILHEAD</div><div class="tag">OVERLAND NAVIGATION</div></div></div>
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
    route_style: str = "balanced"
    camp_preference: str = "public"
    region_hint: str = ""
    camp_reuse_policy: str = "different_each_night"
    max_daily_drive_hours: Optional[float] = None

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
            validation = _validate_route_waypoints(geocoded, body.message)
            if not validation["ok"]:
                content = f"{validation['reason']} " + " ".join(validation["details"])
                messages.append({"role": "assistant", "content": content})
                save_conversation(conversation_key, messages[-30:])
                return {"type": "message", "content": content, "route_validation": validation, "trail_dna": trail_dna}
            enrichment = await enrich_trip_along_route(geocoded)
            edited_plan["waypoints"] = enrichment.get("waypoints", geocoded)
            timeline = _build_trip_timeline(
                edited_plan,
                enrichment.get("campsites", []),
                enrichment.get("gas_stations", []),
                enrichment.get("route_pois", []),
                body.message,
            )
            edited_plan["timeline"] = timeline
            trip_id = body.current_trip.get("trip_id", str(uuid.uuid4())[:8])
            updated = {"trip_id": trip_id, "plan": edited_plan,
                       "campsites": enrichment["campsites"][:70],
                       "gas_stations": enrichment["gas_stations"][:45],
                       "route_pois": enrichment["route_pois"][:50],
                       "timeline": timeline}
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


async def _send_expo_push(token: str, title: str, body_text: str, data: dict) -> dict:
    """Best-effort Expo push notification. Returns a structured result."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://exp.host/--/api/v2/push/send",
                json={"to": token, "title": title, "body": body_text,
                      "data": data, "sound": "default", "priority": "high"},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        payload = response.json() if response.content else {}
        if response.is_success:
            return {"ok": True, "response": payload}
        return {"ok": False, "error": response.text[:400], "response": payload}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

def _normalize_admin_push_payload(body: AdminPushCampaignBody) -> tuple[str, str, dict]:
    campaign_type = re.sub(r"[^a-z0-9_:-]+", "_", str(body.campaign_type or "admin_campaign").strip().lower())[:60] or "admin_campaign"
    deeplink = str(body.deeplink or "").strip() or "/(tabs)/guide"
    payload = dict(body.data or {})
    payload["type"] = campaign_type
    payload["deeplink"] = deeplink
    if body.credits is not None:
        payload["credits"] = int(body.credits)
    if body.campaign_tag:
        payload["campaign_tag"] = re.sub(r"[^a-z0-9_:-]+", "_", str(body.campaign_tag).strip().lower())[:80]
    return campaign_type, deeplink, payload

async def _send_admin_push_campaign(body: AdminPushCampaignBody, admin: dict) -> dict:
    campaign_type, deeplink, payload = _normalize_admin_push_payload(body)
    audience = body.audience.model_dump()
    recipients = get_push_campaign_recipients(audience)
    if body.test_only:
        recipients = [row for row in recipients if int(row.get("is_admin") or 0) == 1]
    estimated = len(recipients)
    if estimated <= 0:
        raise HTTPException(400, "No recipients match this audience")
    campaign_key = f"push_{uuid.uuid4().hex[:16]}"
    campaign_id = create_push_campaign(
        campaign_key=campaign_key,
        campaign_type=campaign_type,
        audience=audience,
        title=body.title.strip()[:120],
        body=body.body.strip()[:300],
        deeplink=deeplink,
        payload=payload,
        created_by=admin["id"],
        estimated_recipients=estimated,
        test_only=body.test_only,
        status="sending",
    )
    sent_count = 0
    failed_count = 0
    for offset in range(0, len(recipients), 50):
        batch = recipients[offset:offset + 50]
        results = await asyncio.gather(*[
            _send_expo_push(
                str(recipient["push_token"]),
                body.title.strip()[:120],
                body.body.strip()[:300],
                {**payload, "campaign_id": campaign_id, "campaign_key": campaign_key},
            )
            for recipient in batch
        ])
        for recipient, result in zip(batch, results):
            ok = bool(result.get("ok"))
            if ok:
                sent_count += 1
            else:
                failed_count += 1
            record_push_campaign_delivery(
                campaign_id=campaign_id,
                user_id=recipient.get("id"),
                push_token=str(recipient.get("push_token") or ""),
                delivery_status="sent" if ok else "failed",
                response=result.get("response"),
                error_text=result.get("error"),
            )
        if offset + 50 < len(recipients):
            await asyncio.sleep(0.35)
    finalize_push_campaign(campaign_id, sent_count=sent_count, failed_count=failed_count, status="sent")
    log_event(admin["id"], None, "admin_push_campaign_send", {
        "campaign_id": campaign_id,
        "campaign_type": campaign_type,
        "test_only": body.test_only,
        "estimated": estimated,
        "sent": sent_count,
        "failed": failed_count,
        "audience": audience,
    })
    return {
        "campaign_id": campaign_id,
        "campaign_key": campaign_key,
        "campaign_type": campaign_type,
        "estimated_recipients": estimated,
        "sent_count": sent_count,
        "failed_count": failed_count,
        "test_only": body.test_only,
        "deeplink": deeplink,
    }


async def _execute_plan_job(job_id: str, body: PlanRequest, user: dict | None, cost: int) -> None:
    """Background task: generate the trip, geocode, enrich, save, notify."""
    import anthropic as _anthropic
    import re as _re
    started_at = time.time()
    update_plan_job(job_id, "running")
    try:
        update_plan_job(job_id, "ai")
        route_style = (body.route_style or "balanced").strip().lower()
        if route_style == "adventure":
            route_style = "wild"
        if body.session_id:
            msgs = get_conversation(_ai_conversation_key(body.session_id, user))
            plan_data = plan_trip_from_conversation(msgs) if msgs else plan_trip(body.request or "")
        else:
            plan_data = plan_trip(body.request or "")
        plan_data["route_preferences"] = {
            "route_style": route_style if route_style in {"direct", "balanced", "wild"} else "balanced",
            "camp_preference": (body.camp_preference or "public").strip().lower(),
            "camp_reuse_policy": (body.camp_reuse_policy or "different_each_night").strip().lower(),
            "region_hint": (body.region_hint or "").strip(),
            "max_daily_drive_hours": body.max_daily_drive_hours,
        }

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
        result_stub = {"trip_id": trip_id, "plan": plan_data, "campsites": [], "gas_stations": [], "route_pois": [], "timeline": _build_trip_timeline(plan_data, request_context=body.request or "")}
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
        validation = _validate_route_waypoints(geocoded, body.request or "")
        if not validation["ok"]:
            if user and cost > 0:
                add_credits(user["id"], cost, "Refund — unsupported route")
            update_plan_job(job_id, "failed", error=f"{validation['reason']} {' '.join(validation['details'])}")
            return

        update_plan_job(job_id, "enriching")
        try:
            enrich_timeout = 10 if is_long_trip or (time.time() - started_at) > 70 else 28
            enrichment = await asyncio.wait_for(enrich_trip_along_route(geocoded, route_style=route_style), timeout=enrich_timeout)
        except Exception:
            enrichment = {"waypoints": geocoded, "campsites": [], "gas_stations": [], "route_pois": []}
        plan_data["waypoints"] = enrichment.get("waypoints", geocoded)
        timeline = _build_trip_timeline(
            plan_data,
            enrichment.get("campsites", []),
            enrichment.get("gas_stations", []),
            enrichment.get("route_pois", []),
            body.request or "",
        )
        plan_data["timeline"] = timeline
        result = {"trip_id": trip_id, "plan": plan_data,
                  "campsites": enrichment["campsites"][:70],
                  "gas_stations": enrichment["gas_stations"][:45],
                  "route_pois": enrichment["route_pois"][:50],
                  "timeline": timeline}
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

@app.get("/api/support/inbox")
async def support_inbox(user: dict = Depends(_current_user)):
    threads = list_support_threads_for_user(user["id"])
    return {
        "threads": threads,
        "unread_count": sum(int(t.get("unread_count") or 0) for t in threads),
    }

@app.get("/api/support/threads/{thread_id}")
async def support_thread_detail(thread_id: int, user: dict = Depends(_current_user)):
    thread = get_support_thread(thread_id, user_id=user["id"], admin=False)
    if not thread:
        raise HTTPException(404, "Thread not found")
    return thread

@app.post("/api/support/inbox/message")
async def support_inbox_message(body: SupportInboxMessageBody, user: dict = Depends(_current_user)):
    text = body.body.strip()
    if not text:
        raise HTTPException(400, "Message body is required")
    if body.thread_id:
        thread = get_support_thread(body.thread_id, user_id=user["id"], admin=False)
        if not thread:
            raise HTTPException(404, "Thread not found")
        message = add_support_message(body.thread_id, "user", text, user_id=user["id"])
        thread_id = body.thread_id
    else:
        subject = (body.subject or "Trailhead support").strip()[:160] or "Trailhead support"
        thread_id = create_support_thread(
            user_id=user["id"],
            subject=subject,
            category=(body.category or "support").strip().lower()[:60] or "support",
            opened_by="user",
            initial_body=text,
        )
        message = None
    log_event(user["id"], None, "support_user_message", {"thread_id": thread_id, "category": body.category})
    return {"ok": True, "thread_id": thread_id, "message": message}


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

VALHALLA_COVERAGE_PROBES: list[dict] = [
    {
        "id": "moab_big_sur",
        "label": "Moab, UT to Big Sur, CA",
        "region": "southwest_to_california",
        "expected_engine": "valhalla",
        "locations": [
            {"name": "Moab, UT", "lat": 38.5733, "lon": -109.5498},
            {"name": "Big Sur, CA", "lat": 36.2704, "lon": -121.8081},
        ],
    },
    {
        "id": "las_vegas_moab",
        "label": "Las Vegas, NV to Moab, UT",
        "region": "southwest",
        "expected_engine": "valhalla",
        "locations": [
            {"name": "Las Vegas, NV", "lat": 36.1699, "lon": -115.1398},
            {"name": "Moab, UT", "lat": 38.5733, "lon": -109.5498},
        ],
    },
    {
        "id": "sf_los_angeles",
        "label": "San Francisco, CA to Los Angeles, CA",
        "region": "california",
        "expected_engine": "valhalla",
        "locations": [
            {"name": "San Francisco, CA", "lat": 37.7749, "lon": -122.4194},
            {"name": "Los Angeles, CA", "lat": 34.0522, "lon": -118.2437},
        ],
    },
    {
        "id": "seattle_spokane",
        "label": "Seattle, WA to Spokane, WA",
        "region": "pacific_northwest",
        "expected_engine": "valhalla",
        "locations": [
            {"name": "Seattle, WA", "lat": 47.6062, "lon": -122.3321},
            {"name": "Spokane, WA", "lat": 47.6588, "lon": -117.4260},
        ],
    },
    {
        "id": "portland_eugene",
        "label": "Portland, OR to Eugene, OR",
        "region": "pacific_northwest",
        "expected_engine": "valhalla",
        "locations": [
            {"name": "Portland, OR", "lat": 45.5152, "lon": -122.6784},
            {"name": "Eugene, OR", "lat": 44.0521, "lon": -123.0868},
        ],
    },
    {
        "id": "seattle_boise",
        "label": "Seattle, WA to Boise, ID",
        "region": "pacific_northwest_to_idaho",
        "expected_engine": "valhalla",
        "locations": [
            {"name": "Seattle, WA", "lat": 47.6062, "lon": -122.3321},
            {"name": "Boise, ID", "lat": 43.6150, "lon": -116.2023},
        ],
    },
    {
        "id": "boise_missoula",
        "label": "Boise, ID to Missoula, MT",
        "region": "idaho_to_montana",
        "expected_engine": "valhalla",
        "locations": [
            {"name": "Boise, ID", "lat": 43.6150, "lon": -116.2023},
            {"name": "Missoula, MT", "lat": 46.8721, "lon": -113.9940},
        ],
    },
    {
        "id": "salt_lake_denver",
        "label": "Salt Lake City, UT to Denver, CO",
        "region": "utah_to_colorado",
        "expected_engine": "valhalla",
        "locations": [
            {"name": "Salt Lake City, UT", "lat": 40.7608, "lon": -111.8910},
            {"name": "Denver, CO", "lat": 39.7392, "lon": -104.9903},
        ],
    },
    {
        "id": "phoenix_albuquerque",
        "label": "Phoenix, AZ to Albuquerque, NM",
        "region": "arizona_to_new_mexico",
        "expected_engine": "valhalla",
        "locations": [
            {"name": "Phoenix, AZ", "lat": 33.4484, "lon": -112.0740},
            {"name": "Albuquerque, NM", "lat": 35.0844, "lon": -106.6504},
        ],
    },
    {
        "id": "cheyenne_denver",
        "label": "Cheyenne, WY to Denver, CO",
        "region": "wyoming_to_colorado",
        "expected_engine": "valhalla",
        "locations": [
            {"name": "Cheyenne, WY", "lat": 41.1400, "lon": -104.8202},
            {"name": "Denver, CO", "lat": 39.7392, "lon": -104.9903},
        ],
    },
]

class AccountTripRequest(BaseModel):
    trip: dict
    request: str = ""
    route_geometry: Optional[dict] = None
    builder_state: Optional[dict] = None
    source: str = "web"

class RouteGeometryRequest(BaseModel):
    route_geometry: dict

class PlannerBounds(BaseModel):
    n: float
    s: float
    e: float
    w: float

class PlannerPoint(BaseModel):
    lat: float
    lng: float

class PlannerContextRequest(BaseModel):
    bounds: PlannerBounds | None = None
    center: PlannerPoint | None = None
    radius: float = 35
    filters: list[str] = Field(default_factory=list)
    route: list[list[float]] = Field(default_factory=list)

class ExcursionNearbyRequest(BaseModel):
    center: PlannerPoint
    radius: float = 35
    categories: list[str] = Field(default_factory=list)
    route: list[list[float]] = Field(default_factory=list)
    day: Optional[int] = None
    source_context: str = "map"

class NearbySmartPackRequest(BaseModel):
    center: PlannerPoint
    radius: float = 35
    categories: list[str] = Field(default_factory=list)
    route: list[list[float]] = Field(default_factory=list)
    scope_id: str = ""
    recommended_day: Optional[int] = None
    route_scope: str = "area"

class RouteCampWindow(BaseModel):
    day: int
    start: float
    end: float
    label: str = ""
    target_mi: float
    search_window_mi: float = 45

class RouteCampWindowsRequest(BaseModel):
    route: list[dict] = Field(default_factory=list)
    windows: list[RouteCampWindow] = Field(default_factory=list)
    camp_filters: list[str] = Field(default_factory=list)
    route_style: str = "balanced"
    camp_preference: str = "public"
    require_photos: bool = False
    region_hint: str = ""
    camp_reuse_policy: str = "different_each_night"
    max_daily_drive_hours: Optional[float] = None
    max_radius: float = 58

class MapCardResolveRequest(BaseModel):
    kind: str = "place"
    id: Optional[str] = None
    source: Optional[str] = None
    source_label: Optional[str] = None
    selection_source: Optional[str] = None
    feature_id: Optional[str] = None
    provider_place_id: Optional[str] = None
    place_id: Optional[str] = None
    source_layer: Optional[str] = None
    screen_x: Optional[float] = None
    screen_y: Optional[float] = None
    screen_position: Optional[str] = None
    selection_confidence: Optional[str] = None
    raw_feature: Optional[dict] = None
    name: str = ""
    lat: float
    lng: float
    type: Optional[str] = None
    subtype: Optional[str] = None
    photo_url: Optional[str] = None
    summary: Optional[str] = None
    address: Optional[str] = None
    rating: Optional[float] = None
    rating_count: Optional[int] = None
    country_code: Optional[str] = None
    country: Optional[str] = None
    region: Optional[str] = None
    bbox: Optional[list[float]] = None
    route: list[list[float]] = Field(default_factory=list)

def _parse_valhalla_area_urls() -> list[dict]:
    raw = (getattr(settings, "valhalla_area_urls", "") or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = []
        for chunk in raw.split(";"):
            parts = [p.strip() for p in chunk.split("|")]
            if len(parts) < 6:
                continue
            try:
                parsed.append({
                    "id": parts[0],
                    "url": parts[1],
                    "bounds": {
                        "s": float(parts[2]),
                        "w": float(parts[3]),
                        "n": float(parts[4]),
                        "e": float(parts[5]),
                    },
                })
            except ValueError:
                continue
    if isinstance(parsed, dict):
        parsed = parsed.get("areas") or []
    areas: list[dict] = []
    for idx, item in enumerate(parsed if isinstance(parsed, list) else []):
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip().rstrip("/")
        bounds = item.get("bounds") or {}
        try:
            area = {
                "id": str(item.get("id") or item.get("name") or f"area_{idx}").strip(),
                "url": url,
                "bounds": {
                    "s": float(bounds["s"]),
                    "w": float(bounds["w"]),
                    "n": float(bounds["n"]),
                    "e": float(bounds["e"]),
                },
                "states": item.get("states") or [],
                "priority": int(item.get("priority") or 100),
            }
        except (KeyError, TypeError, ValueError):
            continue
        if area["id"] and area["url"]:
            areas.append(area)
    return sorted(areas, key=lambda a: (a["priority"], a["id"]))

def _valhalla_base_url() -> str:
    return settings.valhalla_url.rstrip("/")

def _default_valhalla_target() -> dict:
    return {"id": "default", "url": _valhalla_base_url(), "bounds": None, "states": [], "priority": 9999}

def _valhalla_targets() -> list[dict]:
    areas = _parse_valhalla_area_urls()
    default = _default_valhalla_target()
    return areas + [default] if areas else [default]

def _location_in_bounds(loc: dict, bounds: dict) -> bool:
    lat = float(loc["lat"])
    lon = float(loc["lon"])
    return float(bounds["s"]) <= lat <= float(bounds["n"]) and float(bounds["w"]) <= lon <= float(bounds["e"])

def _select_valhalla_target(locations: list[dict]) -> dict:
    required = _route_required_locations(locations)
    for target in _parse_valhalla_area_urls():
        bounds = target.get("bounds")
        if bounds and all(_location_in_bounds(loc, bounds) for loc in required):
            return target
    return _default_valhalla_target()

def _route_fallback_urls() -> list[str]:
    raw = getattr(settings, "route_fallback_urls", "") or ""
    return [u.strip().rstrip("/") for u in raw.split(",") if u.strip()]

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

def _route_cache_key(payload: dict, target_id: str = "default") -> str:
    canonical = {
        "target": target_id,
        "locations": [
            {
                "lat": round(float(loc["lat"]), 5),
                "lon": round(float(loc["lon"]), 5),
                "type": str(loc.get("type") or "break").lower(),
            }
            for loc in payload["locations"]
        ],
        "costing": payload["costing"],
        "costing_options": payload["costing_options"],
        "units": payload["units"],
    }
    raw = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()

def _route_required_locations(locations: list[dict]) -> list[dict]:
    required = [loc for loc in locations if str(loc.get("type") or "break").lower() != "side_stop"]
    return required if len(required) >= 2 else locations

def _route_payload(locations: list[dict], opts: RouteOptions, units: str) -> dict:
    route_units = units if units in ("miles", "kilometers") else "miles"
    return {
        "locations": [{**loc, "type": "through" if str(loc.get("type") or "").lower() == "through" else "break"} for loc in locations],
        "costing": "auto",
        "costing_options": _valhalla_costing_options(opts),
        "units": route_units,
        "directions_options": {"units": route_units},
    }

def _polyline6_point_count(shape: str) -> int:
    index = 0
    count = 0
    while index < len(shape):
        for _ in range(2):
            shift = 0
            while index < len(shape):
                b = ord(shape[index]) - 63
                index += 1
                shift += 5
                if b < 0x20:
                    break
        count += 1
    return count

def _osrm_maneuver_type(step: dict, is_first: bool, is_last: bool) -> int:
    if is_first:
        return 1
    if is_last or step.get("maneuver", {}).get("type") == "arrive":
        return 4
    modifier = str(step.get("maneuver", {}).get("modifier") or "").lower()
    if "sharp left" in modifier:
        return 5
    if "sharp right" in modifier:
        return 6
    if "slight left" in modifier:
        return 10
    if "slight right" in modifier:
        return 11
    if "left" in modifier:
        return 2
    if "right" in modifier:
        return 3
    if "uturn" in modifier:
        return 9
    return 0

def _osrm_instruction(step: dict, is_first: bool, is_last: bool) -> str:
    if is_first:
        return "Head toward destination"
    if is_last:
        return "Arrive at destination"
    name = step.get("name") or step.get("ref") or "the road"
    modifier = str(step.get("maneuver", {}).get("modifier") or "").replace("straight", "continue")
    if modifier:
        return f"{modifier.title()} onto {name}" if name != "the road" else modifier.title()
    return f"Continue on {name}"

def _osrm_to_valhalla(data: dict, units: str) -> dict:
    routes = data.get("routes") or []
    if not routes:
        raise ValueError("OSRM returned no routes")
    route = routes[0]
    meters = float(route.get("distance") or 0)
    seconds = float(route.get("duration") or 0)
    length = meters / (1000.0 if units == "kilometers" else 1609.344)
    maneuvers: list[dict] = []
    begin_index = 0
    steps = [step for leg in route.get("legs", []) for step in (leg.get("steps") or [])]
    for idx, step in enumerate(steps):
        is_first = idx == 0
        is_last = idx == len(steps) - 1
        step_points = max(_polyline6_point_count(step.get("geometry") or ""), 1)
        maneuver = step.get("maneuver") or {}
        street_name = step.get("name") or step.get("ref") or ""
        maneuvers.append({
            "type": _osrm_maneuver_type(step, is_first, is_last),
            "instruction": _osrm_instruction(step, is_first, is_last),
            "verbal_pre_transition_instruction": _osrm_instruction(step, is_first, is_last),
            "verbal_transition_alert_instruction": "",
            "verbal_post_transition_instruction": "",
            "street_names": [street_name] if street_name else [],
            "length": float(step.get("distance") or 0) / (1000.0 if units == "kilometers" else 1609.344),
            "time": float(step.get("duration") or 0),
            "begin_shape_index": begin_index,
            "end_shape_index": begin_index + step_points - 1,
            "roundabout_exit_count": None,
            "_osrm": {
                "type": maneuver.get("type"),
                "modifier": maneuver.get("modifier"),
                "location": maneuver.get("location"),
            },
        })
        begin_index += max(step_points - 1, 1)
    return {
        "trip": {
            "status": 0,
            "status_message": "Found route",
            "units": units,
            "summary": {"length": length, "time": seconds},
            "legs": [{
                "shape": route.get("geometry") or "",
                "summary": {"length": length, "time": seconds},
                "maneuvers": maneuvers,
            }],
        },
        "_fallback": {
            "engine": "osrm",
            "warning": "Valhalla unavailable; used emergency car-routing fallback. Off-road/backroad weighting may be limited.",
        },
    }

async def _route_with_osrm(client: httpx.AsyncClient, locations: list[dict], units: str) -> tuple[dict, str]:
    coords = ";".join(f"{loc['lon']:.6f},{loc['lat']:.6f}" for loc in locations)
    last_error = "No OSRM fallback configured"
    for base in _route_fallback_urls():
        url = f"{base}/route/v1/driving/{coords}"
        try:
            res = await client.get(url, params={"overview": "full", "geometries": "polyline6", "steps": "true"})
            if res.status_code >= 400:
                last_error = f"{base}: HTTP {res.status_code} {res.text[:160]}"
                continue
            data = res.json()
            if data.get("code") != "Ok":
                last_error = f"{base}: {data.get('code') or 'route failed'}"
                continue
            return _osrm_to_valhalla(data, units), base
        except Exception as exc:
            last_error = f"{base}: {exc}"
    raise RuntimeError(last_error)

def _valhalla_probe_payload(probe: dict, units: str = "miles") -> dict:
    opts = RouteOptions()
    locations = [{"lat": loc["lat"], "lon": loc["lon"], "type": "break"} for loc in probe["locations"]]
    return _route_payload(locations, opts, units)

def _valhalla_probe_result(probe: dict, *, ok: bool, **updates) -> dict:
    locations = [
        {
            "name": loc.get("name"),
            "lat": loc.get("lat"),
            "lon": loc.get("lon"),
        }
        for loc in probe.get("locations", [])
    ]
    result = {
        "id": probe["id"],
        "label": probe["label"],
        "region": probe["region"],
        "expected_engine": probe.get("expected_engine", "valhalla"),
        "ok": ok,
        "engine": "valhalla" if ok else "none",
        "locations": locations,
    }
    result.update(updates)
    return result

async def _run_valhalla_coverage_probe(client: httpx.AsyncClient, probe: dict, *, timeout_s: float = 20.0) -> dict:
    payload = _valhalla_probe_payload(probe)
    target = _select_valhalla_target(payload["locations"])
    try:
        res = await client.post(f"{target['url']}/route", json=payload, timeout=timeout_s)
    except httpx.TimeoutException:
        return _valhalla_probe_result(probe, ok=False, error="Valhalla route timed out", fallback_expected=True, target=target["id"])
    except Exception as exc:
        return _valhalla_probe_result(probe, ok=False, error=f"Valhalla route failed: {exc}", fallback_expected=True, target=target["id"])

    result_meta = {"status": res.status_code, "target": target["id"]}
    if res.status_code >= 400:
        error_text = res.text[:500] if res.text else f"HTTP {res.status_code}"
        valhalla_status = None
        try:
            error_data = res.json()
            error_text = str(error_data.get("error") or error_data.get("message") or error_text)[:500]
            valhalla_status = error_data.get("error_code") or error_data.get("status_code")
        except Exception:
            pass
        return _valhalla_probe_result(
            probe,
            ok=False,
            error=error_text,
            valhalla_status=valhalla_status,
            fallback_expected=True,
            **result_meta,
        )

    try:
        data = res.json()
    except Exception:
        return _valhalla_probe_result(probe, ok=False, error="Valhalla returned non-JSON response", fallback_expected=True, **result_meta)

    trip = data.get("trip") or {}
    summary = trip.get("summary") or {}
    if trip.get("status") == 0:
        return _valhalla_probe_result(
            probe,
            ok=True,
            engine="valhalla",
            fallback_expected=False,
            status_message=trip.get("status_message") or "Found route",
            length=summary.get("length"),
            time=summary.get("time"),
            **result_meta,
        )
    return _valhalla_probe_result(
        probe,
        ok=False,
        error=trip.get("status_message") or "Valhalla returned no navigable route",
        fallback_expected=True,
        valhalla_status=trip.get("status"),
        **result_meta,
    )

@app.get("/api/admin/routing-coverage-diagnostic")
async def routing_coverage_diagnostic():
    started = time.time()
    targets = _valhalla_targets()
    target_health: list[dict] = []
    async with httpx.AsyncClient(timeout=20) as client:
        for target in targets:
            health: dict = {"ok": False, "engine": "valhalla", "target": target["id"], "url": target["url"]}
            try:
                res = await client.get(f"{target['url']}/status", timeout=5)
                health.update({"ok": 200 <= res.status_code < 300, "status": res.status_code})
                if res.status_code < 400:
                    try:
                        status_data = res.json()
                        health["valhalla_version"] = status_data.get("version")
                        health["tileset_last_modified"] = status_data.get("tileset_last_modified")
                        health["has_tileset_last_modified"] = bool(status_data.get("tileset_last_modified"))
                    except Exception:
                        health["status_parse_error"] = "Valhalla status was not JSON"
            except Exception as exc:
                health.update({"ok": False, "error": str(exc)})
            target_health.append(health)
        probes = await asyncio.gather(*[_run_valhalla_coverage_probe(client, probe) for probe in VALHALLA_COVERAGE_PROBES])

    passed = sum(1 for probe in probes if probe.get("ok"))
    failed = len(probes) - passed
    failed_regions = sorted({probe["region"] for probe in probes if not probe.get("ok")})
    return {
        "ok": any(h.get("ok") for h in target_health) and failed == 0,
        "engine_url": _valhalla_base_url(),
        "targets": target_health,
        "health": target_health[0] if target_health else {"ok": False},
        "probes": probes,
        "summary": {
            "total": len(probes),
            "passed": passed,
            "failed": failed,
            "failed_regions": failed_regions,
            "elapsed_ms": round((time.time() - started) * 1000),
            "duration_ms": round((time.time() - started) * 1000),
        },
        "next_actions": [
            "If Pacific Northwest probes fail while R2 routing/wa.tar and routing/or.tar exist, rebuild or remount the live West2 graph before switching traffic.",
            "If all probes pass on a candidate full-US service, point VALHALLA_URL at that service and rerun this diagnostic.",
        ],
    }

@app.get("/api/route/health")
async def route_health():
    checks: list[dict] = []
    valhalla_ok = False
    async with httpx.AsyncClient(timeout=5) as client:
        for target in _valhalla_targets():
            try:
                res = await client.get(f"{target['url']}/status")
                ok = 200 <= res.status_code < 300
                valhalla_ok = valhalla_ok or ok
                checks.append({"engine": "valhalla", "target": target["id"], "url": target["url"], "ok": ok, "status": res.status_code})
            except Exception as e:
                checks.append({"engine": "valhalla", "target": target["id"], "url": target["url"], "ok": False, "error": str(e)})
    if valhalla_ok:
        return {"ok": True, "engine": "valhalla", "status": 200, "checks": checks}
    sample = [{"lat": 38.5733, "lon": -109.5498}, {"lat": 38.5677, "lon": -109.5271}]
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            _, base = await _route_with_osrm(client, sample, "miles")
        checks.append({"engine": "osrm", "url": base, "ok": True})
        return {"ok": True, "engine": "osrm-fallback", "checks": checks}
    except Exception as e:
        checks.append({"engine": "osrm", "ok": False, "error": str(e)})
    return {"ok": False, "engine": "none", "checks": checks}

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
        loc_type = str(loc.get("type") or "break").strip().lower()
        if loc_type not in {"break", "through", "side_stop"}:
            loc_type = "break"
        locations.append({"lat": lat, "lon": lon, "type": loc_type})
    route_locations = _route_required_locations(locations)
    validation = _validate_route_locations(route_locations)
    if not validation["ok"]:
        raise HTTPException(422, validation)

    payload = _route_payload(route_locations, body.options, body.units)
    target = _select_valhalla_target(payload["locations"])
    cache_key = _route_cache_key(payload, target["id"])
    dropped_optional = len(locations) - len(route_locations)
    cached = get_route_cached(cache_key)
    cached_osrm_fallback = bool(cached and cached.get("_fallback", {}).get("engine") == "osrm")
    if cached and not cached_osrm_fallback:
        cached_engine = "osrm-fallback" if cached.get("_fallback", {}).get("engine") == "osrm" else "valhalla"
        cached["_trailhead"] = {"engine": cached_engine, "cache": "hit", "cache_key": cache_key, "valhalla_target": target["id"], "target": target["id"]}
        if dropped_optional > 0:
            cached["_trailhead"]["repair"] = "dropped_optional_points"
            cached["_trailhead"]["dropped_optional_points"] = dropped_optional
            cached["_trailhead"]["message"] = "Route kept. Optional side stops are saved as pins, not navigation stops."
        return cached

    valhalla_error = ""
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(f"{target['url']}/route", json=payload)
            if res.status_code < 400:
                data = res.json()
                if data.get("trip", {}).get("status") == 0:
                    set_route_cached(cache_key, payload, data)
                    data["_trailhead"] = {"engine": "valhalla", "cache": "miss", "cache_key": cache_key, "valhalla_target": target["id"], "target": target["id"]}
                    if dropped_optional > 0:
                        data["_trailhead"]["repair"] = "dropped_optional_points"
                        data["_trailhead"]["dropped_optional_points"] = dropped_optional
                        data["_trailhead"]["message"] = "Route kept. Optional side stops are saved as pins, not navigation stops."
                    return data
                valhalla_error = data.get("trip", {}).get("status_message") or "Valhalla returned no navigable route"
            else:
                valhalla_error = res.text[:500] if res.text else f"HTTP {res.status_code}"
    except httpx.TimeoutException:
        valhalla_error = "Valhalla route timed out"
    except Exception as e:
        valhalla_error = f"Valhalla route failed: {e}"

    if cached_osrm_fallback and cached:
        cached["_trailhead"] = {
            "engine": "osrm-fallback",
            "cache": "stale-fallback-hit",
            "cache_key": cache_key,
            "valhalla_target": target["id"],
            "target": target["id"],
            "valhalla_error": valhalla_error,
        }
        if dropped_optional > 0:
            cached["_trailhead"]["repair"] = "dropped_optional_points"
            cached["_trailhead"]["dropped_optional_points"] = dropped_optional
            cached["_trailhead"]["message"] = "Route kept. Optional side stops are saved as pins, not navigation stops."
        return cached

    repair_locations = route_locations
    if dropped_optional > 0:
        repair_payload = _route_payload(repair_locations, body.options, body.units)
        repair_target = _select_valhalla_target(repair_payload["locations"])
        repair_cache_key = _route_cache_key(repair_payload, repair_target["id"])
        cached_repair = get_route_cached(repair_cache_key)
        if cached_repair:
            cached_repair["_trailhead"] = {
                "engine": "valhalla",
                "cache": "hit",
                "cache_key": repair_cache_key,
                "valhalla_target": repair_target["id"],
                "target": repair_target["id"],
                "repair": "dropped_optional_points",
                "dropped_optional_points": dropped_optional,
                "message": "Route kept. Optional side stops are saved as pins, not navigation stops.",
                "original_cache_key": cache_key,
                "valhalla_error": valhalla_error,
            }
            return cached_repair
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                res = await client.post(f"{repair_target['url']}/route", json=repair_payload)
                if res.status_code < 400:
                    data = res.json()
                    if data.get("trip", {}).get("status") == 0:
                        set_route_cached(repair_cache_key, repair_payload, data)
                        data["_trailhead"] = {
                            "engine": "valhalla",
                            "cache": "miss",
                            "cache_key": repair_cache_key,
                            "valhalla_target": repair_target["id"],
                            "target": repair_target["id"],
                            "repair": "dropped_optional_points",
                            "dropped_optional_points": dropped_optional,
                            "message": "Route kept. Optional side stops are saved as pins, not navigation stops.",
                            "original_cache_key": cache_key,
                            "valhalla_error": valhalla_error,
                        }
                        return data
                repair_error = res.text[:500] if res.text else f"HTTP {res.status_code}"
                valhalla_error = f"{valhalla_error}; repair without optional side stops failed: {repair_error}" if valhalla_error else f"Repair without optional side stops failed: {repair_error}"
        except httpx.TimeoutException:
            valhalla_error = f"{valhalla_error}; repair without optional side stops timed out" if valhalla_error else "Repair without optional side stops timed out"
        except Exception as e:
            valhalla_error = f"{valhalla_error}; repair without optional side stops failed: {e}" if valhalla_error else f"Repair without optional side stops failed: {e}"

    try:
        async with httpx.AsyncClient(timeout=18) as client:
            data, base = await _route_with_osrm(client, repair_locations, payload["units"])
        if data.get("trip", {}).get("status") == 0:
            if dropped_optional > 0:
                repair_payload = _route_payload(repair_locations, body.options, body.units)
                repair_target = _select_valhalla_target(repair_payload["locations"])
                set_route_cached(_route_cache_key(repair_payload, repair_target["id"]), repair_payload, data)
            else:
                set_route_cached(cache_key, payload, data)
        data["_trailhead"] = {
            "engine": "osrm-fallback",
            "cache": "miss",
            "cache_key": cache_key,
            "valhalla_target": target["id"],
            "target": target["id"],
            "fallback_url": base,
            "valhalla_error": valhalla_error,
        }
        if dropped_optional > 0:
            data["_trailhead"]["repair"] = "dropped_optional_points"
            data["_trailhead"]["dropped_optional_points"] = dropped_optional
            data["_trailhead"]["message"] = "Route kept. Optional side stops are saved as pins, not navigation stops."
        return data
    except Exception as e:
        detail = f"{valhalla_error}; OSRM fallback failed: {e}" if valhalla_error else f"OSRM fallback failed: {e}"
        raise HTTPException(502, detail)

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

@app.get("/api/trips")
async def user_trips(limit: int = 25, user: dict = Depends(_current_user)):
    return {"trips": list_user_trips(user["id"], max(1, min(limit, 100)))}

@app.post("/api/trips")
async def create_account_trip(body: AccountTripRequest, user: dict = Depends(_current_user)):
    trip = dict(body.trip or {})
    trip_id = str(trip.get("trip_id") or f"web_{uuid.uuid4().hex[:12]}")
    trip["trip_id"] = trip_id
    existing = get_trip(trip_id)
    if existing and existing.get("user_id") and existing.get("user_id") != user["id"]:
        raise HTTPException(403, "Not authorized to update this trip")
    saved = save_account_trip(
        trip_id,
        trip,
        user["id"],
        request=body.request,
        route_geometry=body.route_geometry,
        builder_state=body.builder_state,
        source=body.source or "web",
    )
    return saved

@app.put("/api/trip/{trip_id}")
async def update_account_trip(trip_id: str, body: AccountTripRequest, user: dict = Depends(_current_user)):
    existing = get_trip(trip_id)
    if existing and existing.get("user_id") and existing.get("user_id") != user["id"]:
        raise HTTPException(403, "Not authorized to update this trip")
    trip = dict(body.trip or {})
    trip["trip_id"] = trip_id
    saved = save_account_trip(
        trip_id,
        trip,
        user["id"],
        request=body.request,
        route_geometry=body.route_geometry,
        builder_state=body.builder_state,
        source=body.source or "web",
    )
    return saved

@app.put("/api/trip/{trip_id}/geometry")
async def update_trip_geometry(trip_id: str, body: RouteGeometryRequest, user: dict = Depends(_current_user)):
    try:
        saved = save_trip_geometry(trip_id, user["id"], body.route_geometry)
    except PermissionError:
        raise HTTPException(403, "Not authorized to update this trip")
    if not saved:
        raise HTTPException(404, "Trip not found")
    return saved

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
    units: str = "auto"

def _weather_units_for(lat: float, lng: float, mode: str = "auto") -> dict:
    """Return Open-Meteo params + display metadata for a coordinate."""
    clean = (mode or "auto").lower()
    if clean not in {"auto", "imperial", "metric"}:
        clean = "auto"
    if clean == "auto":
        # US users expect Fahrenheit; almost everywhere else uses metric.
        # Bounds include Alaska, Hawaii, and CONUS.
        in_us = (
            (24.0 <= lat <= 49.8 and -125.5 <= lng <= -66.0) or
            (51.0 <= lat <= 72.0 and -170.0 <= lng <= -129.0) or
            (18.5 <= lat <= 23.0 and -161.0 <= lng <= -154.0)
        )
        clean = "imperial" if in_us else "metric"
    if clean == "metric":
        return {
            "mode": "metric",
            "temperature_unit": "celsius",
            "windspeed_unit": "kmh",
            "precipitation_unit": "mm",
            "distance_unit": "kilometers",
            "temperature_label": "°C",
            "wind_label": "km/h",
            "precipitation_label": "mm",
        }
    return {
        "mode": "imperial",
        "temperature_unit": "fahrenheit",
        "windspeed_unit": "mph",
        "precipitation_unit": "inch",
        "distance_unit": "miles",
        "temperature_label": "°F",
        "wind_label": "mph",
        "precipitation_label": "in",
    }

@app.post("/api/weather/route")
async def route_weather(body: RouteWeatherRequest):
    """Download 7-day forecasts for all waypoints in a trip for offline use.
    Deduplicates waypoints within 0.1° and caches the full result for 3 hours."""
    unit_key = (body.units or "auto").lower()
    cache_key = f"route_weather:{body.trip_id}:{unit_key}"
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
                data = await weather_forecast(wp["lat"], wp["lng"], days=7, units=body.units)
                return (wp.get("name", f"{wp['lat']:.2f},{wp['lng']:.2f}"), data)
            except Exception:
                return (wp.get("name", ""), None)

    results = await asyncio.gather(*[_fetch_one(wp) for wp in unique_wps])
    forecasts = {name: data for name, data in results if data is not None}
    response = {"trip_id": body.trip_id, "forecasts": forecasts}
    set_cached("campsite_cache", cache_key, response)
    return response


@app.get("/api/weather")
async def weather_forecast(lat: float, lng: float, days: int = 7, units: str = "auto"):
    unit_meta = _weather_units_for(lat, lng, units)
    cache_key = f"weather_v2:{lat:.2f},{lng:.2f}:{unit_meta['mode']}:{min(days, 14)}"
    cached = get_cached("weather_cache", cache_key, ttl_seconds=3600)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=10) as client:
        forecast_task = client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat, "longitude": lng,
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
                "hourly": "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m",
                "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,windspeed_10m_max,wind_gusts_10m_max,weathercode,uv_index_max",
                "temperature_unit": unit_meta["temperature_unit"],
                "windspeed_unit": unit_meta["windspeed_unit"],
                "precipitation_unit": unit_meta["precipitation_unit"],
                "timezone": "auto",
                "forecast_days": min(days, 14),
            }
        )
        air_task = client.get(
            "https://air-quality-api.open-meteo.com/v1/air-quality",
            params={
                "latitude": lat,
                "longitude": lng,
                "current": "us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide",
                "hourly": "us_aqi,pm2_5,pm10,ozone,grass_pollen,ragweed_pollen,birch_pollen",
                "timezone": "auto",
                "forecast_days": min(days, 5),
            },
        )
        r, air = await asyncio.gather(forecast_task, air_task, return_exceptions=True)
        if isinstance(r, Exception):
            raise r
        r.raise_for_status()
        data = r.json()
        if not isinstance(air, Exception):
            try:
                air.raise_for_status()
                data["air_quality"] = air.json()
            except Exception:
                data["air_quality"] = {"available": False}
        else:
            data["air_quality"] = {"available": False}
    data["trailhead_units"] = unit_meta
    data["source_label"] = "Open-Meteo"
    data["health_summary"] = {
        "air_quality_source": "Open-Meteo air quality" if data.get("air_quality", {}).get("current") else "Unavailable",
        "advisory": "Weather, air quality, pollen, and UV forecasts are modeled estimates. Verify severe weather with official alerts before travel.",
    }

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


@app.post("/api/places/categories/authorize")
async def authorize_explore_categories(body: ExploreCategoryAuthorizeRequest, user: dict = Depends(_current_user)):
    group = EXPLORE_CATEGORY_GROUP if body.group in {"", EXPLORE_CATEGORY_GROUP, "explore", "town"} else body.group
    cost = AI_COSTS["explore_category_day"]
    unlock_key = _explore_category_unlock_key(user["id"], group)
    if user.get("is_admin") or has_active_plan(user):
        return {"authorized": True, "charged": 0, "plan": True, "group": group, "credits": user.get("credits", 0)}
    if get_cached("campsite_cache", unlock_key, ttl_seconds=3600 * 36):
        return {"authorized": True, "charged": 0, "already_unlocked": True, "group": group, "credits": user.get("credits", 0)}
    if not deduct_credits(user["id"], cost, f"Explore map categories — {group}"):
        raise HTTPException(402, detail=_paywall_detail(
            "category_unlock",
            f"Explore town services cost {cost} credits for today, or are included with Explorer.",
            cost,
        ))
    set_cached("campsite_cache", unlock_key, {"group": group, "date": _today_key()})
    fresh = get_user_by_id(user["id"]) or user
    return {"authorized": True, "charged": cost, "group": group, "credits": fresh.get("credits", 0)}


@app.post("/api/places/detail/authorize")
async def authorize_paid_place_detail(body: PlaceDetailAuthorizeRequest, user: dict = Depends(_current_user)):
    source = (body.source or "").lower().strip()
    if source in LEGACY_PLACE_PROVIDERS:
        raise HTTPException(410, "Legacy paid place providers are disabled")
    raise HTTPException(400, "Unsupported paid place provider")


def _place_payload_dict(body: CanonicalPlacePayload) -> dict:
    raw = body.dict(exclude_none=True)
    metadata = raw.pop("metadata", {}) or {}
    return {**raw, **{k: v for k, v in metadata.items() if k not in raw}}


def _decode_place_photo_payload(photo_data: str, content_type: str = "image/jpeg") -> tuple[bytes, str, str]:
    raw = (photo_data or "").strip()
    if "," in raw and raw.lower().startswith("data:"):
        header, raw = raw.split(",", 1)
        match = re.match(r"data:([^;]+);base64", header, re.I)
        if match:
            content_type = match.group(1)
    content_type = (content_type or "image/jpeg").strip().lower()
    if content_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        raise HTTPException(400, "Unsupported photo type")
    try:
        body = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Invalid photo data")
    if len(body) < 256:
        raise HTTPException(400, "Photo is too small")
    if len(body) > 8 * 1024 * 1024:
        raise HTTPException(400, "Photo is too large")
    ext = "jpg" if content_type in {"image/jpeg", "image/jpg"} else content_type.rsplit("/", 1)[-1]
    return body, ("image/jpeg" if content_type == "image/jpg" else content_type), ext


async def _upload_place_photo_to_r2(trailhead_place_id: str, body: bytes, content_type: str, ext: str) -> tuple[str | None, str | None]:
    if not (settings.r2_account_id and settings.r2_access_key_id and settings.r2_secret_access_key and settings.r2_bucket and settings.r2_public_url):
        return None, None
    key = f"place-photos/{trailhead_place_id}/{uuid.uuid4().hex}.{ext}"

    def _put() -> None:
        import boto3
        client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
        )
        client.put_object(Bucket=settings.r2_bucket, Key=key, Body=body, ContentType=content_type)

    try:
        await asyncio.to_thread(_put)
    except Exception:
        return None, None
    return key, f"{settings.r2_public_url.rstrip('/')}/{key}"


@app.post("/api/places/canonicalize")
async def api_canonicalize_place(body: CanonicalPlacePayload):
    try:
        place = upsert_canonical_place(_place_payload_dict(body))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"trailhead_place_id": place["trailhead_place_id"], "place": place}


@app.get("/api/places/{trailhead_place_id}/comments")
async def api_get_place_comments(trailhead_place_id: str):
    if not get_place(trailhead_place_id):
        raise HTTPException(404, "Place not found")
    return get_place_comments(trailhead_place_id)


@app.post("/api/places/{trailhead_place_id}/comments")
async def api_add_place_comment(trailhead_place_id: str, body: PlaceCommentPayload,
                                user: dict = Depends(_current_user)):
    place = get_place(trailhead_place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    text = (body.body or "").strip()
    if len(text) < 2:
        raise HTTPException(400, "Comment is too short")
    if len(text) > 1200:
        raise HTTPException(400, "Comment is too long")
    comment = add_place_comment(trailhead_place_id, user["id"], user["username"], text)
    photo = None
    if body.photo_data:
        image_bytes, content_type, ext = _decode_place_photo_payload(body.photo_data)
        object_key, url = await _upload_place_photo_to_r2(trailhead_place_id, image_bytes, content_type, ext)
        photo = add_place_photo(
            trailhead_place_id,
            user["id"],
            user["username"],
            comment_id=comment["id"],
            object_key=object_key,
            url=url,
            caption=(body.photo_caption or text[:120]),
            photo_data=None if url else body.photo_data,
            content_type=content_type,
        )
    fresh = get_user_by_id(user["id"]) or user
    return {
        "comment": comment,
        "photo": photo,
        "credits_earned": photo["credits_awarded"] if photo else 0,
        "new_balance": fresh.get("credits", user.get("credits", 0)),
    }


@app.get("/api/places/{trailhead_place_id}/photos")
async def api_get_place_photos(trailhead_place_id: str):
    if not get_place(trailhead_place_id):
        raise HTTPException(404, "Place not found")
    return get_place_photos(trailhead_place_id)


@app.post("/api/places/{trailhead_place_id}/photos")
async def api_add_place_photo(trailhead_place_id: str, body: PlacePhotoPayload,
                              user: dict = Depends(_current_user)):
    if not get_place(trailhead_place_id):
        raise HTTPException(404, "Place not found")
    image_bytes, content_type, ext = _decode_place_photo_payload(body.photo_data, body.content_type)
    object_key, url = await _upload_place_photo_to_r2(trailhead_place_id, image_bytes, content_type, ext)
    photo = add_place_photo(
        trailhead_place_id,
        user["id"],
        user["username"],
        comment_id=body.comment_id,
        object_key=object_key,
        url=url,
        caption=body.caption,
        photo_data=None if url else body.photo_data,
        content_type=content_type,
    )
    fresh = get_user_by_id(user["id"]) or user
    return {**photo, "credits_earned": photo["credits_awarded"], "new_balance": fresh.get("credits", user.get("credits", 0))}


@app.get("/api/places/photos/{photo_id}/image")
async def api_place_photo_image(photo_id: int):
    row = get_place_photo_image(photo_id)
    if not row:
        raise HTTPException(404, "Photo not found")
    raw = str(row["photo_data"] or "")
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        body = base64.b64decode(raw, validate=True)
    except Exception:
        raise HTTPException(404, "Photo not available")
    return Response(content=body, media_type=row.get("content_type") or "image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.post("/api/places/{trailhead_place_id}/edit-suggestions")
async def api_add_place_edit_suggestion(trailhead_place_id: str, body: PlaceEditSuggestionPayload,
                                        user: dict = Depends(_current_user)):
    place = get_place(trailhead_place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    allowed = {
        "name", "category", "type", "hours", "phone", "website", "address",
        "access_notes", "amenities", "reservation_info", "photo",
        "closure_status", "status", "duplicate", "location", "profile",
    }
    field = (body.field or "").strip().lower()
    if field not in allowed:
        raise HTTPException(400, "Invalid edit field")
    value = (body.value or "").strip()
    if not value:
        raise HTTPException(400, "Suggested value is required")
    result = add_place_edit_suggestion(
        trailhead_place_id,
        (body.place_name or place.get("name") or "Place").strip(),
        user.get("id"),
        user.get("username"),
        field,
        value,
        (body.note or "").strip()[:800] or None,
    )
    fresh = get_user_by_id(user["id"]) or user
    return {**result, "new_balance": fresh.get("credits", user.get("credits", 0))}


def _place_booking_url(place: dict) -> str:
    metadata = place.get("display_metadata") or {}
    provider_ids = place.get("provider_ids") or {}
    ridb_id = provider_ids.get("ridb") or (place.get("source_place_id") if str(place.get("source") or "") in {"ridb", "recreation.gov"} else "")
    if metadata.get("booking_url"):
        return str(metadata.get("booking_url"))
    if metadata.get("url") and "recreation.gov" in str(metadata.get("url")):
        return str(metadata.get("url"))
    if place.get("official_url") and "recreation.gov" in str(place.get("official_url")):
        return str(place.get("official_url"))
    if ridb_id:
        return f"https://www.recreation.gov/camping/campgrounds/{ridb_id}"
    return str(place.get("official_url") or metadata.get("website") or metadata.get("url") or "")


def _camp_link_search_url(place: dict) -> str:
    name = str(place.get("name") or "campground").strip()
    return f"https://www.recreation.gov/search?q={quote(name)}&entity_type=campground"


def _camp_link_label(url: str, official: bool, reservable: bool, fallback: bool = False) -> str:
    if fallback:
        return "Search official site"
    if reservable and "recreation.gov" in (url or "").lower():
        return "Reserve"
    return "Official page" if official or url else "Search official site"


async def _resolve_camp_link(place: dict, booking_url: str, reservable: bool) -> dict:
    source = str(place.get("source") or "").lower()
    official = source in {"nps", "ridb", "recreation.gov", "blm", "usfs"}
    url = booking_url or str(place.get("official_url") or "")
    ridb_backed = source in {"ridb", "recreation.gov"} or "recreation.gov/camping/campgrounds/" in url.lower()
    if not url:
        fallback = _camp_link_search_url(place) if ridb_backed or reservable else ""
        return {"url": fallback, "label": _camp_link_label(fallback, official, reservable, bool(fallback)), "confidence": "fallback" if fallback else "none"}
    if ridb_backed:
        cache_key = f"camp_link:{hashlib.sha1(url.encode()).hexdigest()}"
        cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24)
        if cached:
            return cached
        resolved = {"url": url, "label": _camp_link_label(url, True, reservable), "confidence": "verified"}
        try:
            async with httpx.AsyncClient(timeout=8, follow_redirects=True, headers={"User-Agent": "Trailhead/1.0"}) as client:
                # Recreation.gov returns 405 to HEAD on some pages; use a small GET instead.
                res = await client.get(url)
                final_url = str(res.url)
                text = res.text[:1600].lower()
                generic = "/search" in final_url.lower() or "/camping" == final_url.lower().rstrip("/")[-8:] or "page not found" in text or "something went wrong" in text
                if res.status_code >= 400 or generic:
                    fallback = _camp_link_search_url(place)
                    resolved = {"url": fallback, "label": "Search official site", "confidence": "fallback"}
        except Exception:
            fallback = _camp_link_search_url(place)
            resolved = {"url": fallback, "label": "Search official site", "confidence": "fallback"}
        set_cached("campsite_cache", cache_key, resolved)
        return resolved
    return {"url": url, "label": _camp_link_label(url, official, reservable), "confidence": "source"}


@app.get("/api/places/{trailhead_place_id}/reservation-status")
async def api_place_reservation_status(trailhead_place_id: str, start_date: str = "", end_date: str = "",
                                       user: dict | None = Depends(_optional_user)):
    place = get_place(trailhead_place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    metadata = place.get("display_metadata") or {}
    provider_ids = place.get("provider_ids") or {}
    source = str(place.get("source") or "").lower()
    source_label = place.get("source_label") or metadata.get("verified_source") or source
    booking_url = _place_booking_url(place)
    ridb_backed = source in {"ridb", "recreation.gov"} or bool(provider_ids.get("ridb")) or "recreation.gov" in booking_url
    reservable = bool(metadata.get("reservable") or ridb_backed)
    alerts = get_place_reservation_alerts(trailhead_place_id, user["id"] if isinstance(user, dict) else None)
    link = await _resolve_camp_link(place, booking_url, reservable)
    return {
        "trailhead_place_id": trailhead_place_id,
        "source": source,
        "source_label": source_label,
        "official": source in {"nps", "ridb", "recreation.gov", "blm", "usfs"},
        "reservable": reservable,
        "booking_url": link.get("url") or booking_url,
        "check_availability_url": link.get("url") or booking_url,
        "link_label": link.get("label") or _camp_link_label(booking_url, source in {"nps", "ridb", "recreation.gov", "blm", "usfs"}, reservable),
        "link_confidence": link.get("confidence"),
        "availability_supported": False,
        "alert_supported": reservable and bool(booking_url),
        "alerts": alerts,
        "start_date": start_date or None,
        "end_date": end_date or None,
        "source_freshness": f"Official/source data last seen {datetime.utcfromtimestamp(int(place.get('last_seen') or time.time())).strftime('%Y-%m-%d')}. Verify availability with the official source.",
        "notes": metadata.get("reservation_notes") or ("Trailhead links to the official booking source; checkout stays on Recreation.gov." if ridb_backed else "No public availability endpoint is confirmed for this place yet."),
    }


@app.post("/api/places/{trailhead_place_id}/reservation-alerts")
async def api_place_reservation_alert(trailhead_place_id: str, body: PlaceReservationAlertPayload,
                                      user: dict = Depends(_current_user)):
    place = get_place(trailhead_place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    booking_url = _place_booking_url(place)
    alert = save_place_reservation_alert(
        trailhead_place_id,
        user["id"],
        (body.start_date or "").strip()[:20] or None,
        (body.end_date or "").strip()[:20] or None,
        max(1, min(int(body.party_size or 1), 20)),
        str(place.get("source") or ""),
        booking_url or None,
    )
    return {"ok": True, "alert": alert}


@app.get("/api/admin/place-edit-suggestions")
async def admin_place_edit_suggestions(status: Optional[str] = "pending",
                                       admin: dict = Depends(_require_admin)):
    return get_place_edit_suggestions(status if status else None, limit=250)


@app.post("/api/admin/place-edit-suggestions/{suggestion_id}/status")
async def admin_place_edit_suggestion_status(suggestion_id: int, body: dict,
                                             admin: dict = Depends(_require_admin)):
    status = str(body.get("status", "")).strip().lower()
    if status not in {"pending", "applied", "dismissed"}:
        raise HTTPException(400, "Invalid status")
    if not update_place_edit_suggestion_status(suggestion_id, status):
        raise HTTPException(404, "Suggestion not found")
    return {"ok": True}


@app.get("/api/admin/place-comments")
async def admin_place_comments(status: Optional[str] = "visible", admin: dict = Depends(_require_admin)):
    return list_place_comments(status if status else None, limit=250)


@app.post("/api/admin/place-comments/{comment_id}/status")
async def admin_place_comment_status(comment_id: int, body: dict, admin: dict = Depends(_require_admin)):
    status = str(body.get("status", "")).strip().lower()
    if status not in {"visible", "hidden", "removed"}:
        raise HTTPException(400, "Invalid status")
    if not update_place_comment_status(comment_id, status):
        raise HTTPException(404, "Comment not found")
    return {"ok": True}


@app.get("/api/admin/place-photos")
async def admin_place_photos(status: Optional[str] = "visible", admin: dict = Depends(_require_admin)):
    return list_place_photos(status if status else None, limit=250)


@app.post("/api/admin/place-photos/{photo_id}/status")
async def admin_place_photo_status(photo_id: int, body: dict, admin: dict = Depends(_require_admin)):
    status = str(body.get("status", "")).strip().lower()
    if status not in {"visible", "hidden", "removed"}:
        raise HTTPException(400, "Invalid status")
    if not update_place_photo_status(photo_id, status):
        raise HTTPException(404, "Photo not found")
    return {"ok": True}


@app.post("/api/analytics/event")
async def analytics_event(body: AnalyticsEventRequest, user: dict | None = Depends(_optional_user)):
    event_type = re.sub(r"[^a-z0-9_.:-]+", "_", (body.event_type or "").strip().lower())[:80]
    if event_type not in {"welcome_contest_seen", "welcome_contest_cta", "welcome_contest_cta_attributed"} and not event_type.startswith("phase0_"):
        raise HTTPException(400, "Unsupported analytics event")
    clean_session = re.sub(r"[^a-zA-Z0-9_.:-]+", "", (body.session_id or "").strip())[:120]
    log_event(user["id"] if user else None, clean_session or None, event_type, body.event_data or {})
    return {"ok": True}


# ── Config (public) ───────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    return {
        "mapbox_token": settings.mapbox_token,
        # Exposed so the mobile app can fetch vector tiles direct from Protomaps'
        # CDN (faster than proxying via Railway). Acceptable for early-stage —
        # rotate if abused. Free tier is 200k-1M tiles/month.
        "protomaps_key": settings.protomaps_key,
        "google_oauth_client_id": (_oauth_client_ids("google") or [""])[0],
        "apple_service_id": settings.apple_service_id,
    }

@app.get("/api/explorer/config")
@app.get("/api/extreme/config")
def extreme_config(user: dict = Depends(_current_user)):
    return _extreme_config_for_user(user)

@app.post("/api/explorer/session/authorize")
@app.post("/api/extreme/session/authorize")
def extreme_authorize_session(body: ExtremeSessionAuthorizeRequest, user: dict = Depends(_current_user)):
    config = _extreme_config_for_user(user)
    surface = _clean_extreme_surface(body.surface)
    if config["kill_switch"]:
        raise HTTPException(403, {"code": "extreme_disabled", "message": "Explorer is temporarily unavailable."})
    if not config["beta_active"] or surface not in config["allowed_surfaces"]:
        raise HTTPException(403, {"code": "extreme_unavailable", "message": "Explorer is not available here yet."})
    if not config["entitled"]:
        raise HTTPException(403, {"code": "extreme_hidden_beta", "message": "Explorer is in hidden beta for selected accounts."})

    trip_id = (body.trip_id or "").strip()[:120] or None
    checkpoints = [cp.dict() for cp in body.checkpoints[:80]]
    trip_memory = body.trip_memory.dict() if body.trip_memory else {}
    if trip_id and (checkpoints or trip_memory):
        save_extreme_trip_metadata(user["id"], trip_id, checkpoints, trip_memory)
    session = create_extreme_demo_session(
        user["id"],
        surface,
        trip_id,
        config["max_demo_session_seconds"],
        {"checkpoint_count": len(checkpoints), **(body.metadata or {})},
    )
    log_extreme_ledger_event(
        user["id"],
        "demo_session_started",
        session["session_id"],
        surface,
        trip_id,
        {"checkpoint_count": len(checkpoints)},
    )
    return {
        "authorized": True,
        "session_id": session["session_id"],
        "expires_at": session["expires_at"],
        "max_demo_session_seconds": config["max_demo_session_seconds"],
        "navigation_session_authorized": False,
    }

@app.post("/api/explorer/session/end")
@app.post("/api/extreme/session/end")
def extreme_end_session(body: ExtremeSessionEndRequest, user: dict = Depends(_current_user)):
    clean_session = _clean_extreme_session_id(body.session_id)
    if not clean_session:
        raise HTTPException(400, "session_id is required")
    ended = end_extreme_demo_session(user["id"], clean_session, _clean_extreme_event_type(body.reason or "ended"))
    if not ended:
        raise HTTPException(404, "Session not found")
    log_extreme_ledger_event(
        user["id"],
        "demo_session_ended",
        clean_session,
        ended.get("surface"),
        ended.get("trip_id"),
        {"reason": body.reason or "ended"},
    )
    return {"ok": True, "session_id": clean_session, "status": ended.get("status"), "ended_at": ended.get("ended_at")}

@app.post("/api/explorer/navigation/authorize")
@app.post("/api/extreme/navigation/authorize")
def extreme_authorize_navigation(body: ExtremeNavigationAuthorizeRequest, user: dict = Depends(_current_user)):
    config = _extreme_config_for_user(user)
    surface = _clean_extreme_surface(body.surface or "navigation")
    nav_mode = _clean_extreme_event_type(body.navigation_mode or "route_guidance")
    if config["kill_switch"]:
        raise HTTPException(403, {"code": "extreme_disabled", "message": "Explorer is temporarily unavailable."})
    if not config["enabled"] or not config["entitled"]:
        raise HTTPException(403, {"code": "extreme_hidden_beta", "message": "Explorer is in hidden beta for selected accounts."})
    if not config["feature_flags"]["navigation"] or surface not in config["allowed_surfaces"]:
        raise HTTPException(403, {"code": "extreme_navigation_disabled", "message": "Guided navigation is not enabled for this beta."})
    if nav_mode in {"free_drive", "free-drive"}:
        raise HTTPException(400, {"code": "extreme_free_drive_blocked", "message": "Free drive is not available in this beta."})
    if not body.acknowledged_billing:
        raise HTTPException(400, {"code": "extreme_navigation_confirmation_required", "message": "Confirm guided navigation before starting."})

    trip_id = (body.trip_id or "").strip()[:120] or None
    route_id = (body.route_id or "").strip()[:120] or None
    trip_memory = body.trip_memory.dict() if body.trip_memory else {}
    if trip_id and trip_memory:
        save_extreme_trip_metadata(user["id"], trip_id, [], trip_memory)
    metadata = {
        "mode": "guided_navigation",
        "route_id": route_id,
        "route_summary": body.route_summary or {},
        "navigation_billing_acknowledged": True,
        **(body.metadata or {}),
    }
    session = create_extreme_demo_session(
        user["id"],
        surface,
        trip_id,
        config["max_navigation_session_seconds"],
        metadata,
    )
    log_extreme_ledger_event(
        user["id"],
        "guided_navigation_authorized",
        session["session_id"],
        surface,
        trip_id,
        metadata,
    )
    return {
        "authorized": True,
        "session_id": session["session_id"],
        "expires_at": session["expires_at"],
        "max_navigation_session_seconds": config["max_navigation_session_seconds"],
        "navigation_session_authorized": True,
        "free_drive_authorized": False,
        "route_id": route_id,
    }

@app.post("/api/explorer/ledger")
@app.post("/api/extreme/ledger")
def extreme_ledger(body: ExtremeLedgerRequest, user: dict = Depends(_current_user)):
    config = _extreme_config_for_user(user)
    if not config["beta_active"]:
        raise HTTPException(403, {"code": "extreme_unavailable", "message": "Explorer is not available."})
    if not config["entitled"]:
        raise HTTPException(403, {"code": "extreme_hidden_beta", "message": "Explorer is in hidden beta for selected accounts."})
    surface = _clean_extreme_surface(body.surface)
    event_type = _clean_extreme_event_type(body.event_type)
    clean_session = _clean_extreme_session_id(body.session_id)
    trip_id = (body.trip_id or "").strip()[:120] or None
    event_id = log_extreme_ledger_event(user["id"], event_type, clean_session, surface, trip_id, body.event_data or {})
    return {"ok": True, "event_id": event_id}

def _require_extreme_map_layers(user: dict) -> dict:
    config = _extreme_config_for_user(user)
    if config["kill_switch"]:
        raise HTTPException(403, {"code": "extreme_disabled", "message": "Explorer is temporarily unavailable."})
    if not config["enabled"] or not config["entitled"]:
        raise HTTPException(403, {"code": "extreme_hidden_beta", "message": "Explorer is in hidden beta for selected accounts."})
    if "map_layers" not in config["allowed_surfaces"]:
        raise HTTPException(403, {"code": "extreme_unavailable", "message": "Extreme map layers are not available here yet."})
    if not settings.mapbox_token:
        raise HTTPException(503, {"code": "mapbox_unconfigured", "message": "Mapbox is not configured."})
    return config

def _clean_mapbox_param(value: str, pattern: str, max_len: int = 160) -> str:
    return re.sub(pattern, "", str(value or "").strip())[:max_len]

def _searchbox_params(base: dict) -> dict:
    params = {"access_token": settings.mapbox_token}
    for key, value in base.items():
        text = str(value or "").strip()
        if text:
            params[key] = text
    return params

def _mapbox_session_hash(session_token: str) -> str:
    token = str(session_token or "").encode("utf-8")
    return hashlib.sha1(token).hexdigest()[:16] if token else ""

async def _mapbox_get(url: str, params: dict) -> dict:
    async with httpx.AsyncClient(timeout=8) as client:
        res = await client.get(url, params=params)
    if res.status_code >= 400:
        detail = res.json() if res.headers.get("content-type", "").startswith("application/json") else {"message": res.text[:500]}
        raise HTTPException(res.status_code, detail)
    return res.json()

def _mapbox_directions_url(profile: str, coords: list[str]) -> str:
    return f"https://api.mapbox.com/directions/v5/{profile}/{';'.join(coords)}"

MAP_CONTEXT_CATEGORY_ALIASES = {
    "camp": "campground",
    "camps": "campground",
    "camping": "campground",
    "campground": "campground",
    "campsite": "campground",
    "rv": "campground",
    "rv_park": "campground",
    "food": "restaurant",
    "restaurant": "restaurant",
    "restaurants": "restaurant",
    "coffee": "cafe",
    "cafe": "cafe",
    "fuel": "gas station",
    "gas": "gas station",
    "gas_station": "gas station",
    "propane": "propane",
    "lodging": "hotel",
    "hotel": "hotel",
    "motel": "hotel",
    "stay": "hotel",
    "viewpoint": "scenic viewpoint",
    "view": "scenic viewpoint",
    "attraction": "attraction",
    "landmark": "attraction",
    "trail": "trailhead",
    "trails": "trailhead",
    "trailhead": "trailhead",
    "grocery": "grocery",
    "mechanic": "mechanic",
    "parking": "parking",
    "water": "water",
}

def _map_context_category_provider(category: str = "") -> str:
    clean = re.sub(r"[^a-z0-9_ -]+", "", str(category or "").lower()).strip()
    return MAP_CONTEXT_CATEGORY_ALIASES.get(clean.replace(" ", "_"), clean)

def _map_context_limit(limit: int, default: int = 8, max_value: int = 12) -> int:
    try:
        parsed = int(limit or default)
    except (TypeError, ValueError):
        parsed = default
    return max(1, min(parsed, max_value))

def _map_context_center(snapshot: MapContextSnapshot | None, explicit: MapContextPoint | None = None) -> MapContextPoint | None:
    if explicit:
        return explicit
    if snapshot and snapshot.center:
        return snapshot.center
    if snapshot and snapshot.bounds:
        return MapContextPoint(
            lat=(snapshot.bounds.n + snapshot.bounds.s) / 2,
            lng=(snapshot.bounds.e + snapshot.bounds.w) / 2,
        )
    return None

def _map_context_proximity(snapshot: MapContextSnapshot | None, explicit: str = "", center: MapContextPoint | None = None) -> str:
    cleaned = _clean_mapbox_param(explicit, r"[^0-9,.\-]+", 80)
    if cleaned:
        return cleaned
    point = center or _map_context_center(snapshot)
    return f"{point.lng:.6f},{point.lat:.6f}" if point else ""

def _map_context_bbox(snapshot: MapContextSnapshot | None, explicit: str = "") -> str:
    cleaned = _clean_mapbox_param(explicit, r"[^0-9,.\-]+", 120)
    if cleaned:
        return cleaned
    bounds = snapshot.bounds if snapshot else None
    return f"{bounds.w:.6f},{bounds.s:.6f},{bounds.e:.6f},{bounds.n:.6f}" if bounds else ""

def _first_text(*values: object) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if value is not None and not isinstance(value, (dict, list, tuple)):
            text = str(value).strip()
            if text:
                return text
    return ""

def _first_number(*values: object) -> float | None:
    for value in values:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(parsed):
            return parsed
    return None

def _map_context_string_list(*values: object) -> list[str]:
    out: list[str] = []
    for value in values:
        if isinstance(value, str):
            parts = [part.strip() for part in re.split(r"[,;/|]", value) if part.strip()]
            out.extend(parts)
        elif isinstance(value, list):
            out.extend(str(item).strip() for item in value if str(item or "").strip())
    return list(dict.fromkeys(out))

def _map_context_feature_coords(feature: dict) -> tuple[float | None, float | None]:
    geometry = feature.get("geometry") if isinstance(feature.get("geometry"), dict) else {}
    props = feature.get("properties") if isinstance(feature.get("properties"), dict) else feature
    coords = geometry.get("coordinates") if isinstance(geometry, dict) else None
    if isinstance(coords, list) and len(coords) >= 2:
        lng = _first_number(coords[0])
        lat = _first_number(coords[1])
        if lat is not None and lng is not None:
            return lat, lng
    coord_obj = props.get("coordinates") if isinstance(props.get("coordinates"), dict) else {}
    lat = _first_number(props.get("lat"), props.get("latitude"), coord_obj.get("latitude"), coord_obj.get("lat"))
    lng = _first_number(props.get("lng"), props.get("lon"), props.get("longitude"), coord_obj.get("longitude"), coord_obj.get("lng"), coord_obj.get("lon"))
    return lat, lng

def _map_context_normalize_mapbox_feature(feature: dict, *, category: str = "", center: MapContextPoint | None = None, source: str = "mapbox_search") -> dict | None:
    if not isinstance(feature, dict):
        return None
    props = feature.get("properties") if isinstance(feature.get("properties"), dict) else feature
    metadata = props.get("metadata") if isinstance(props.get("metadata"), dict) else {}
    metadata_data = metadata.get("data") if isinstance(metadata.get("data"), dict) else {}
    lat, lng = _map_context_feature_coords(feature)
    if lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    categories = _map_context_string_list(
        props.get("poi_category"),
        props.get("poi_category_ids"),
        props.get("category"),
        props.get("categories"),
        metadata.get("poi_category"),
        metadata.get("category"),
        metadata.get("categories"),
        metadata_data.get("category"),
        metadata_data.get("categories"),
    )
    mapbox_id = _first_text(props.get("mapbox_id"), props.get("id"), feature.get("mapbox_id"), feature.get("id"))
    feature_type = _first_text(props.get("feature_type"), props.get("type"), feature.get("place_type"))
    name = _first_text(
        props.get("name"),
        props.get("full_address"),
        props.get("place_formatted"),
        props.get("text"),
        feature.get("text"),
        feature.get("place_name"),
        "Mapbox place",
    )
    address = _first_text(
        props.get("full_address"),
        props.get("place_formatted"),
        props.get("address"),
        props.get("address_line1"),
        feature.get("place_name"),
        metadata.get("full_address"),
        metadata.get("place_formatted"),
        metadata.get("address"),
    )
    phone = _first_text(props.get("phone"), props.get("tel"), props.get("telephone"), metadata.get("phone"), metadata_data.get("phone"))
    website = _first_text(props.get("website"), props.get("url"), metadata.get("website"), metadata.get("url"), metadata_data.get("website"))
    rating = _first_number(props.get("rating"), props.get("average_rating"), metadata.get("rating"), metadata_data.get("rating"))
    rating_count = _first_number(props.get("rating_count"), props.get("review_count"), metadata.get("rating_count"), metadata_data.get("review_count"))
    coordinates = props.get("coordinates") if isinstance(props.get("coordinates"), dict) else {}
    routable_points = []
    for point in coordinates.get("routable_points") or []:
        point_coords = point.get("coordinates") if isinstance(point, dict) else point
        if isinstance(point_coords, list) and len(point_coords) >= 2:
            rp_lng = _first_number(point_coords[0])
            rp_lat = _first_number(point_coords[1])
            if rp_lat is not None and rp_lng is not None:
                routable_points.append({"name": point.get("name") if isinstance(point, dict) else None, "lat": rp_lat, "lng": rp_lng})
    country_code = country_name = region_name = None
    try:
        country_code, country_name, region_name = _country_code_from_mapbox_context(feature)
    except Exception:
        pass
    place_type = category or (categories[0] if categories else feature_type) or "poi"
    distance_mi = None
    if center:
        distance_mi = _haversine_m(float(center.lat), float(center.lng), lat, lng) / 1609.344
    stable_id = mapbox_id or hashlib.sha1(f"{name}:{lat:.6f}:{lng:.6f}".encode()).hexdigest()[:16]
    normalized = {
        "id": f"mapbox:{stable_id}",
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": place_type,
        "subtype": ", ".join(categories) or feature_type or place_type,
        "source": source,
        "source_label": "Mapbox Search",
        "provider": "mapbox",
        "provider_place_id": mapbox_id or stable_id,
        "place_id": mapbox_id or stable_id,
        "mapbox_id": mapbox_id or None,
        "mapbox_categories": categories,
        "categories": categories,
        "feature_type": feature_type,
        "address": address or None,
        "phone": phone or None,
        "website": website or None,
        "rating": rating,
        "rating_count": rating_count,
        "average_rating": rating,
        "review_count": rating_count,
        "country_code": country_code,
        "country": country_name,
        "region": region_name,
        "bbox": feature.get("bbox") if isinstance(feature.get("bbox"), list) else None,
        "distance_mi": distance_mi,
        "distance_meters": _first_number(props.get("distance"), metadata.get("distance")),
        "routable_points": routable_points,
        "attribution": "Mapbox",
        "temporary_use_only": True,
        "enrichment_source": "mapbox_searchbox_rest",
        "raw_feature": {"id": mapbox_id or stable_id, "source": source, "properties": props},
    }
    return {k: v for k, v in normalized.items() if v not in (None, "", [])}

async def _mapbox_forward_geocode_features(
    client: httpx.AsyncClient,
    query: str,
    *,
    limit: int = 8,
    country: str = "",
    proximity: str = "",
    bbox: str = "",
    types: str = "",
    language: str = "en",
) -> list[dict]:
    token = settings.mapbox_token
    clean_query = " ".join(str(query or "").split())[:256]
    if not token or len(clean_query) < 2:
        return []
    safe_limit = _map_context_limit(limit, 8, 10)
    country_filter = _clean_countrycodes(country)
    cache_key = "mapctx:geocode:" + hashlib.sha1(
        f"{clean_query.lower()}:{safe_limit}:{country_filter}:{proximity}:{bbox}:{types}:{language}".encode()
    ).hexdigest()[:24]

    async def fetch_geocode() -> list[dict]:
        common_params = {
            "access_token": token,
            "limit": str(safe_limit),
            "language": _clean_mapbox_param(language, r"[^a-zA-Z,\-]+", 40) or "en",
        }
        if country_filter:
            common_params["country"] = country_filter
        cleaned_proximity = _clean_mapbox_param(proximity, r"[^0-9,.\-]+", 80)
        cleaned_bbox = _clean_mapbox_param(bbox, r"[^0-9,.\-]+", 120)
        cleaned_types = _clean_mapbox_param(types, r"[^a-zA-Z0-9_,]+", 120)
        if cleaned_proximity:
            common_params["proximity"] = cleaned_proximity
        if cleaned_bbox:
            common_params["bbox"] = cleaned_bbox
        if cleaned_types:
            common_params["types"] = cleaned_types
        try:
            res = await client.get(
                "https://api.mapbox.com/search/geocode/v6/forward",
                params={**common_params, "q": clean_query, "permanent": "false"},
            )
            if res.status_code < 400:
                features = res.json().get("features", [])
                if isinstance(features, list) and features:
                    return features
        except Exception:
            pass
        try:
            res = await client.get(
                f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(clean_query, safe='')}.json",
                params=common_params,
            )
            if res.status_code < 400:
                features = res.json().get("features", [])
                if isinstance(features, list):
                    return features
        except Exception:
            return []
        return []

    return await runtime_cached_call(
        cache_key,
        180,
        fetch_geocode,
        provider="mapbox",
        endpoint="geocode",
        source_action="map_context",
        source_tier="temporary",
        cache_empty=False,
    )

async def _map_context_searchbox_features(body: MapContextSearchRequest | MapContextResolveRequest) -> tuple[list[dict], dict]:
    center = _map_context_center(getattr(body, "snapshot", None), getattr(body, "center", None))
    proximity = _map_context_proximity(getattr(body, "snapshot", None), getattr(body, "proximity", ""), center)
    origin = _map_context_proximity(getattr(body, "snapshot", None), getattr(body, "origin", ""), center)
    bbox = _map_context_bbox(getattr(body, "snapshot", None), getattr(body, "bbox", ""))
    country = _clean_countrycodes(getattr(body, "country", ""))
    language = _clean_mapbox_param(getattr(body, "language", "en"), r"[^a-zA-Z,\-]+", 40) or "en"
    limit = _map_context_limit(getattr(body, "limit", 8), 8, 10)
    raw_category = getattr(body, "category", "") or ""
    keyword = getattr(body, "keyword", "") or ""
    provider_category = _map_context_category_provider(raw_category)
    q = " ".join(str(getattr(body, "q", "") or "").split())[:256]
    if keyword and not q:
        q = str(keyword).strip()[:120]
    if q and provider_category and provider_category.lower() not in q.lower() and raw_category not in {"", "place", "anchor", "poi"}:
        q = f"{q} {provider_category}".strip()
    token = str(uuid.uuid4())
    features: list[dict] = []
    debug = {
        "provider": "mapbox",
        "temporary_use_only": True,
        "session_token_hash": _mapbox_session_hash(token),
        "category": raw_category,
        "provider_category": provider_category,
        "q": q,
        "bbox": bbox,
        "proximity": proximity,
    }

    if q:
        suggest_params = _searchbox_params({
            "q": q,
            "session_token": token,
            "proximity": proximity,
            "origin": origin,
            "bbox": bbox,
            "country": country,
            "types": _clean_mapbox_param(getattr(body, "types", "poi,place,address"), r"[^a-zA-Z0-9_,]+", 120) or "poi,place,address",
            "language": language,
            "limit": str(limit),
        })
        suggestions = await _mapbox_get("https://api.mapbox.com/search/searchbox/v1/suggest", suggest_params)
        ids = [
            str(item.get("mapbox_id") or item.get("id") or "").strip()
            for item in suggestions.get("suggestions", [])
            if isinstance(item, dict)
        ]
        ids = [item for item in ids if item][:limit]
        retrieve_params = _searchbox_params({"session_token": token, "language": language, "proximity": proximity, "origin": origin})
        async def retrieve(mapbox_id: str) -> list[dict]:
            data = await _mapbox_get(f"https://api.mapbox.com/search/searchbox/v1/retrieve/{quote(mapbox_id, safe='')}", retrieve_params)
            return [feat for feat in data.get("features", []) if isinstance(feat, dict)]
        retrieved = await asyncio.gather(*(retrieve(item) for item in ids), return_exceptions=True)
        for item in retrieved:
            if isinstance(item, list):
                features.extend(item)
        debug["suggestion_count"] = len(ids)
    elif provider_category:
        category_params = _searchbox_params({
            "proximity": proximity,
            "bbox": bbox,
            "country": country,
            "language": language,
            "limit": str(limit),
        })
        data = await _mapbox_get(f"https://api.mapbox.com/search/searchbox/v1/category/{quote(provider_category, safe='')}", category_params)
        features = [feat for feat in data.get("features", []) if isinstance(feat, dict)]
    return features[:limit], debug

def _encode_polyline6(coords: list[list[float]]) -> str:
    def encode_value(value: int) -> str:
        value = ~(value << 1) if value < 0 else (value << 1)
        chunks = []
        while value >= 0x20:
            chunks.append(chr((0x20 | (value & 0x1f)) + 63))
            value >>= 5
        chunks.append(chr(value + 63))
        return "".join(chunks)

    last_lat = 0
    last_lng = 0
    out = []
    for coord in coords:
        if not isinstance(coord, list) or len(coord) < 2:
            continue
        lng = _first_number(coord[0])
        lat = _first_number(coord[1])
        if lat is None or lng is None:
            continue
        lat_i = int(round(lat * 1_000_000))
        lng_i = int(round(lng * 1_000_000))
        out.append(encode_value(lat_i - last_lat))
        out.append(encode_value(lng_i - last_lng))
        last_lat = lat_i
        last_lng = lng_i
    return "".join(out)

def _map_context_route_build_from_directions(data: dict, units: str = "miles") -> dict:
    route = (data.get("routes") or [{}])[0] if isinstance(data.get("routes"), list) else {}
    geometry = route.get("geometry") if isinstance(route.get("geometry"), dict) else {}
    coords = geometry.get("coordinates") if isinstance(geometry.get("coordinates"), list) else []
    distance_m = _first_number(route.get("distance")) or 0.0
    duration_s = _first_number(route.get("duration")) or 0.0
    use_metric = str(units or "").lower().startswith("k")
    length = distance_m / 1000 if use_metric else distance_m / 1609.344
    return {
        "trip": {
            "status": 0 if coords else 1,
            "summary": {"length": length, "time": duration_s},
            "legs": [{"shape": _encode_polyline6(coords), "summary": {"length": length, "time": duration_s}}],
        },
        "_trailhead": {"engine": "mapbox-directions", "cache": "temporary", "temporary_use_only": True},
    }

async def _map_context_directions(body: MapContextRouteRequest | ExtremeDirectionsRequest) -> dict:
    profile = body.profile if body.profile in {"mapbox/driving-traffic", "mapbox/driving", "mapbox/walking", "mapbox/cycling"} else "mapbox/driving-traffic"
    coords: list[str] = []
    for point in body.coordinates[:25]:
        if not isinstance(point, list) or len(point) < 2:
            continue
        lng = _first_number(point[0])
        lat = _first_number(point[1])
        if lng is not None and lat is not None and -180 <= lng <= 180 and -90 <= lat <= 90:
            coords.append(f"{lng:.6f},{lat:.6f}")
    if len(coords) < 2:
        raise HTTPException(400, "At least two valid [lng,lat] coordinates are required")
    params = {
        "access_token": settings.mapbox_token,
        "geometries": "geojson",
        "overview": body.overview if body.overview in {"full", "simplified", "false"} else "full",
        "steps": "true" if body.steps else "false",
        "alternatives": "true" if body.alternatives else "false",
        "language": _clean_mapbox_param(body.language, r"[^a-zA-Z,\-]+", 40) or "en",
        "voice_units": "metric" if body.voice_units == "metric" else "imperial",
    }
    annotations = _clean_mapbox_param(body.annotations, r"[^a-zA-Z_,]+", 80)
    if annotations:
        params["annotations"] = annotations
    exclude = _clean_mapbox_param(body.exclude, r"[^a-zA-Z_,]+", 80)
    if exclude:
        params["exclude"] = exclude
    data = await _mapbox_get(_mapbox_directions_url(profile, coords), params)
    data["_trailhead"] = {"engine": "mapbox-directions", "temporary_use_only": True, "profile": profile}
    return data

async def _map_context_matrix(body: MapContextMatrixRequest) -> dict:
    profile = body.profile if body.profile in {"mapbox/driving", "mapbox/walking", "mapbox/cycling"} else "mapbox/driving"
    coords: list[str] = []
    for point in body.coordinates[:25]:
        if not isinstance(point, list) or len(point) < 2:
            continue
        lng = _first_number(point[0])
        lat = _first_number(point[1])
        if lng is not None and lat is not None and -180 <= lng <= 180 and -90 <= lat <= 90:
            coords.append(f"{lng:.6f},{lat:.6f}")
    if len(coords) < 2:
        raise HTTPException(400, "At least two valid [lng,lat] coordinates are required")
    params = _searchbox_params({
        "sources": _clean_mapbox_param(body.sources, r"[^0-9;all]+", 80) or "0",
        "destinations": _clean_mapbox_param(body.destinations, r"[^0-9;all]+", 80) or "all",
        "annotations": _clean_mapbox_param(body.annotations, r"[^a-zA-Z_,]+", 80) or "duration,distance",
    })
    data = await _mapbox_get(f"https://api.mapbox.com/directions-matrix/v1/{profile}/{';'.join(coords)}", params)
    data["_trailhead"] = {"engine": "mapbox-matrix", "temporary_use_only": True, "profile": profile}
    return data

def _mapbox_feature_coordinate_summary(items: object, limit: int = 8) -> list[dict]:
    if not isinstance(items, list):
        return []
    summary: list[dict] = []
    for item in items[:limit]:
        if not isinstance(item, dict):
            continue
        props = item.get("properties") if isinstance(item.get("properties"), dict) else item
        geometry = item.get("geometry") if isinstance(item.get("geometry"), dict) else {}
        coords = geometry.get("coordinates") if isinstance(geometry, dict) else None
        lng = lat = None
        if isinstance(coords, list) and len(coords) >= 2:
            try:
                lng = round(float(coords[0]), 6)
                lat = round(float(coords[1]), 6)
            except (TypeError, ValueError):
                lng = lat = None
        summary.append({
            "name": str(props.get("name") or props.get("full_address") or props.get("place_formatted") or props.get("text") or "")[:120],
            "mapbox_id": str(props.get("mapbox_id") or props.get("id") or item.get("mapbox_id") or item.get("id") or "")[:180],
            "type": str(props.get("feature_type") or props.get("type") or props.get("category") or "")[:80],
            "lat": lat,
            "lng": lng,
        })
    return summary

@app.post("/api/explorer/search/session")
@app.post("/api/extreme/search/session")
def extreme_search_session(body: ExtremeSearchSessionRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_map_layers(user)
    if not config["feature_flags"]["search"]:
        raise HTTPException(403, {"code": "extreme_search_disabled", "message": "Extreme search is not enabled for this beta."})
    session_token = str(uuid.uuid4())
    log_extreme_ledger_event(
        user["id"],
        "mapbox_search_session_created",
        None,
        "map_layers",
        None,
        {"session_token_hash": _mapbox_session_hash(session_token), **(body.metadata or {})},
    )
    return {
        "session_token": session_token,
        "temporary_use_only": True,
        "expires_in_seconds": 180,
    }

@app.post("/api/explorer/search/suggest")
@app.post("/api/extreme/search/suggest")
async def extreme_search_suggest(body: ExtremeSearchSuggestRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_map_layers(user)
    if not config["feature_flags"]["search"]:
        raise HTTPException(403, {"code": "extreme_search_disabled", "message": "Extreme search is not enabled for this beta."})
    query = " ".join(str(body.q or "").split())[:256]
    token = _clean_mapbox_param(body.session_token, r"[^a-zA-Z0-9_.:-]+", 120)
    if len(query) < 2 or not token:
        raise HTTPException(400, "q and session_token are required")
    params = _searchbox_params({
        "q": query,
        "session_token": token,
        "proximity": _clean_mapbox_param(body.proximity, r"[^0-9,.\-]+", 80),
        "origin": _clean_mapbox_param(body.origin, r"[^0-9,.\-]+", 80),
        "bbox": _clean_mapbox_param(body.bbox, r"[^0-9,.\-]+", 120),
        "country": _clean_countrycodes(body.country),
        "types": _clean_mapbox_param(body.types, r"[^a-zA-Z0-9_,]+", 120),
        "language": _clean_mapbox_param(body.language, r"[^a-zA-Z,\-]+", 40) or "en",
        "limit": str(max(1, min(int(body.limit or 8), 10))),
    })
    data = await _mapbox_get("https://api.mapbox.com/search/searchbox/v1/suggest", params)
    log_extreme_ledger_event(
        user["id"],
        "mapbox_search_suggest",
        None,
        "map_layers",
        None,
        {
            "session_token_hash": _mapbox_session_hash(token),
            "q_len": len(query),
            "count": len(data.get("suggestions", [])),
            "bbox": params.get("bbox", ""),
            "proximity": params.get("proximity", ""),
            "origin": params.get("origin", ""),
            "types": params.get("types", ""),
            "feature_coordinates": _mapbox_feature_coordinate_summary(data.get("suggestions", [])),
        },
    )
    data["_trailhead"] = {"temporary_use_only": True}
    return data

@app.post("/api/explorer/search/retrieve")
@app.post("/api/extreme/search/retrieve")
async def extreme_search_retrieve(body: ExtremeSearchRetrieveRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_map_layers(user)
    if not config["feature_flags"]["search"]:
        raise HTTPException(403, {"code": "extreme_search_disabled", "message": "Extreme search is not enabled for this beta."})
    mapbox_id = _clean_mapbox_param(body.mapbox_id, r"[^a-zA-Z0-9_=:.+\-/]+", 300)
    token = _clean_mapbox_param(body.session_token, r"[^a-zA-Z0-9_.:-]+", 120)
    if not mapbox_id or not token:
        raise HTTPException(400, "mapbox_id and session_token are required")
    params = _searchbox_params({
        "session_token": token,
        "language": _clean_mapbox_param(body.language, r"[^a-zA-Z,\-]+", 40) or "en",
        "proximity": _clean_mapbox_param(body.proximity, r"[^0-9,.\-]+", 80),
        "origin": _clean_mapbox_param(body.origin, r"[^0-9,.\-]+", 80),
    })
    data = await _mapbox_get(f"https://api.mapbox.com/search/searchbox/v1/retrieve/{quote(mapbox_id, safe='')}", params)
    log_extreme_ledger_event(
        user["id"],
        "mapbox_search_retrieve",
        None,
        "map_layers",
        None,
        {
            "session_token_hash": _mapbox_session_hash(token),
            "feature_count": len(data.get("features", [])),
            "proximity": params.get("proximity", ""),
            "origin": params.get("origin", ""),
            "feature_coordinates": _mapbox_feature_coordinate_summary(data.get("features", [])),
        },
    )
    data["_trailhead"] = {"temporary_use_only": True}
    return data

@app.post("/api/explorer/search/category")
@app.post("/api/extreme/search/category")
async def extreme_search_category(body: ExtremeSearchCategoryRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_map_layers(user)
    if not config["feature_flags"]["search"]:
        raise HTTPException(403, {"code": "extreme_search_disabled", "message": "Extreme search is not enabled for this beta."})
    category = _clean_mapbox_param(body.category, r"[^a-zA-Z0-9_\- ]+", 80)
    if not category:
        raise HTTPException(400, "category is required")
    params = _searchbox_params({
        "proximity": _clean_mapbox_param(body.proximity, r"[^0-9,.\-]+", 80),
        "bbox": _clean_mapbox_param(body.bbox, r"[^0-9,.\-]+", 120),
        "country": _clean_countrycodes(body.country),
        "language": _clean_mapbox_param(body.language, r"[^a-zA-Z,\-]+", 40) or "en",
        "limit": str(max(1, min(int(body.limit or 10), 10))),
    })
    data = await _mapbox_get(f"https://api.mapbox.com/search/searchbox/v1/category/{quote(category, safe='')}", params)
    log_extreme_ledger_event(
        user["id"],
        "mapbox_search_category",
        None,
        "map_layers",
        None,
        {
            "category": category,
            "feature_count": len(data.get("features", [])),
            "bbox": params.get("bbox", ""),
            "proximity": params.get("proximity", ""),
            "feature_coordinates": _mapbox_feature_coordinate_summary(data.get("features", [])),
        },
    )
    data["_trailhead"] = {"temporary_use_only": True}
    return data

@app.post("/api/explorer/search/reverse")
@app.post("/api/extreme/search/reverse")
async def extreme_search_reverse(body: ExtremeSearchReverseRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_map_layers(user)
    if not config["feature_flags"]["search"]:
        raise HTTPException(403, {"code": "extreme_search_disabled", "message": "Extreme search is not enabled for this beta."})
    lat = float(body.lat)
    lng = float(body.lng)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(400, "lat/lng out of range")
    params = _searchbox_params({
        "latitude": f"{lat:.7f}",
        "longitude": f"{lng:.7f}",
        "language": _clean_mapbox_param(body.language, r"[^a-zA-Z,\-]+", 40) or "en",
        "limit": str(max(1, min(int(body.limit or 5), 10))),
        "country": _clean_countrycodes(body.country),
        "types": _clean_mapbox_param(body.types, r"[^a-zA-Z0-9_,]+", 120),
    })
    data = await _mapbox_get("https://api.mapbox.com/search/searchbox/v1/reverse", params)
    log_extreme_ledger_event(
        user["id"],
        "mapbox_search_reverse",
        None,
        "map_layers",
        None,
        {
            "feature_count": len(data.get("features", [])),
            "lat": round(lat, 7),
            "lng": round(lng, 7),
            "types": params.get("types", ""),
            "feature_coordinates": _mapbox_feature_coordinate_summary(data.get("features", [])),
        },
    )
    data["_trailhead"] = {"temporary_use_only": True}
    return data

@app.post("/api/explorer/directions")
@app.post("/api/extreme/directions")
async def extreme_directions(body: ExtremeDirectionsRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_map_layers(user)
    if not config["feature_flags"]["navigation"]:
        raise HTTPException(403, {"code": "extreme_navigation_disabled", "message": "Mapbox routing is not enabled for this beta."})
    profile = body.profile if body.profile in {"mapbox/driving-traffic", "mapbox/driving", "mapbox/walking", "mapbox/cycling"} else "mapbox/driving-traffic"
    coords: list[str] = []
    for point in body.coordinates[:25]:
        if not isinstance(point, list) or len(point) < 2:
            continue
        try:
            lng = float(point[0])
            lat = float(point[1])
        except (TypeError, ValueError):
            continue
        if -180 <= lng <= 180 and -90 <= lat <= 90:
            coords.append(f"{lng:.6f},{lat:.6f}")
    if len(coords) < 2:
        raise HTTPException(400, "At least two valid [lng,lat] coordinates are required")
    params = {
        "access_token": settings.mapbox_token,
        "geometries": "geojson",
        "overview": body.overview if body.overview in {"full", "simplified", "false"} else "full",
        "steps": "true" if body.steps else "false",
        "alternatives": "true" if body.alternatives else "false",
        "language": _clean_mapbox_param(body.language, r"[^a-zA-Z,\-]+", 40) or "en",
        "voice_units": "metric" if body.voice_units == "metric" else "imperial",
    }
    annotations = _clean_mapbox_param(body.annotations, r"[^a-zA-Z_,]+", 80)
    if annotations:
        params["annotations"] = annotations
    exclude = _clean_mapbox_param(body.exclude, r"[^a-zA-Z_,]+", 80)
    if exclude:
        params["exclude"] = exclude
    data = await _mapbox_get(_mapbox_directions_url(profile, coords), params)
    log_extreme_ledger_event(
        user["id"],
        "mapbox_directions_route",
        None,
        "map_layers",
        None,
        {"profile": profile, "coordinate_count": len(coords), "route_count": len(data.get("routes", [])), **(body.metadata or {})},
    )
    data["_trailhead"] = {"engine": "mapbox-directions", "temporary_use_only": True}
    return data

@app.post("/api/map-context/context")
async def map_context_snapshot(body: MapContextSnapshot, user: dict = Depends(_current_user)):
    _require_extreme_map_layers(user)
    center = _map_context_center(body)
    visible = [
        place for place in (
            _map_context_normalize_mapbox_feature(item, center=center, source="mapbox_visible_feature")
            for item in (body.visible_features or [])[:40]
        )
        if place
    ]
    return {
        "ok": True,
        "provider": "mapbox",
        "temporary_use_only": True,
        "snapshot": body.dict(),
        "visible_places": visible,
        "current_results": body.current_results[:40],
        "_trailhead": {"engine": "map-context", "temporary_use_only": True},
    }

@app.post("/api/map-context/resolve")
async def map_context_resolve(body: MapContextResolveRequest, user: dict = Depends(_current_user)):
    _require_extreme_map_layers(user)
    center = _map_context_center(body.snapshot)
    proximity = _map_context_proximity(body.snapshot, body.proximity, center)
    bbox = _map_context_bbox(body.snapshot, body.bbox)
    features: list[dict] = []
    async with httpx.AsyncClient(timeout=8) as client:
        features = await _mapbox_forward_geocode_features(
            client,
            body.q,
            limit=body.limit,
            country=body.country,
            proximity=proximity,
            bbox=bbox,
            types=body.types or "place,address,poi",
            language=body.language,
        )
    if not features:
        search_body = MapContextSearchRequest(
            q=body.q,
            limit=body.limit,
            proximity=proximity,
            bbox=bbox,
            country=body.country,
            language=body.language,
            snapshot=body.snapshot,
            metadata=body.metadata,
        )
        features, _debug = await _map_context_searchbox_features(search_body)
    places = [
        place for place in (
            _map_context_normalize_mapbox_feature(feature, category="place", center=center, source="mapbox_geocode")
            for feature in features[:_map_context_limit(body.limit, 8, 10)]
        )
        if place
    ]
    log_extreme_ledger_event(
        user["id"],
        "map_context_resolve",
        None,
        "map_layers",
        None,
        {"q_len": len(body.q or ""), "count": len(places), "bbox": bbox, "proximity": proximity, **(body.metadata or {})},
    )
    return {
        "ok": True,
        "provider": "mapbox",
        "temporary_use_only": True,
        "query": body.q,
        "selected": places[0] if places else None,
        "places": places,
        "features": features[:_map_context_limit(body.limit, 8, 10)],
        "_trailhead": {"engine": "map-context-resolve", "temporary_use_only": True},
    }

@app.post("/api/map-context/search")
async def map_context_search(body: MapContextSearchRequest, user: dict = Depends(_current_user)):
    _require_extreme_map_layers(user)
    center = _map_context_center(body.snapshot, body.center)
    features, debug = await _map_context_searchbox_features(body)
    category = body.category or body.keyword or "poi"
    places = [
        place for place in (
            _map_context_normalize_mapbox_feature(feature, category=category, center=center, source="mapbox_search")
            for feature in features[:_map_context_limit(body.limit, 8, 10)]
        )
        if place
    ]
    log_extreme_ledger_event(
        user["id"],
        "map_context_search",
        None,
        "map_layers",
        None,
        {"category": category, "q_len": len(body.q or body.keyword or ""), "count": len(places), **debug, **(body.metadata or {})},
    )
    return {
        "ok": True,
        "provider": "mapbox",
        "temporary_use_only": True,
        "places": places,
        "features": features[:_map_context_limit(body.limit, 8, 10)],
        "query_context": {
            "source": "map_context",
            "provider": "mapbox",
            "category": body.category,
            "keyword": body.keyword,
            "q": body.q,
            "bbox": debug.get("bbox", ""),
            "proximity": debug.get("proximity", ""),
            "temporary_use_only": True,
        },
        "_trailhead": {"engine": "map-context-search", "temporary_use_only": True},
    }

@app.post("/api/map-context/reverse")
async def map_context_reverse(body: MapContextReverseRequest, user: dict = Depends(_current_user)):
    _require_extreme_map_layers(user)
    lat = float(body.lat)
    lng = float(body.lng)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(400, "lat/lng out of range")
    params = _searchbox_params({
        "latitude": f"{lat:.7f}",
        "longitude": f"{lng:.7f}",
        "language": _clean_mapbox_param(body.language, r"[^a-zA-Z,\-]+", 40) or "en",
        "limit": str(_map_context_limit(body.limit, 5, 10)),
        "country": _clean_countrycodes(body.country),
        "types": _clean_mapbox_param(body.types, r"[^a-zA-Z0-9_,]+", 120),
    })
    data = await _mapbox_get("https://api.mapbox.com/search/searchbox/v1/reverse", params)
    center = MapContextPoint(lat=lat, lng=lng)
    features = [feature for feature in data.get("features", []) if isinstance(feature, dict)]
    places = [
        place for place in (
            _map_context_normalize_mapbox_feature(feature, category="place", center=center, source="mapbox_reverse_geocode")
            for feature in features
        )
        if place
    ]
    log_extreme_ledger_event(
        user["id"],
        "map_context_reverse",
        None,
        "map_layers",
        None,
        {"lat": round(lat, 7), "lng": round(lng, 7), "count": len(places), **(body.metadata or {})},
    )
    return {
        "ok": True,
        "provider": "mapbox",
        "temporary_use_only": True,
        "selected": places[0] if places else None,
        "places": places,
        "features": features,
        "_trailhead": {"engine": "map-context-reverse", "temporary_use_only": True},
    }

@app.post("/api/map-context/route")
async def map_context_route(body: MapContextRouteRequest, user: dict = Depends(_current_user)):
    _require_extreme_map_layers(user)
    data = await _map_context_directions(body)
    route_build = _map_context_route_build_from_directions(data, body.units)
    log_extreme_ledger_event(
        user["id"],
        "map_context_route",
        None,
        "map_layers",
        None,
        {
            "profile": data.get("_trailhead", {}).get("profile") or body.profile,
            "coordinate_count": len(body.coordinates or []),
            "route_count": len(data.get("routes", [])),
            **(body.metadata or {}),
        },
    )
    return {
        "ok": True,
        "provider": "mapbox",
        "temporary_use_only": True,
        "directions": data,
        "route_build": route_build,
        "_trailhead": {"engine": "map-context-route", "temporary_use_only": True},
    }

@app.post("/api/map-context/matrix")
async def map_context_matrix(body: MapContextMatrixRequest, user: dict = Depends(_current_user)):
    _require_extreme_map_layers(user)
    data = await _map_context_matrix(body)
    log_extreme_ledger_event(
        user["id"],
        "map_context_matrix",
        None,
        "map_layers",
        None,
        {"profile": body.profile, "coordinate_count": len(body.coordinates or []), **(body.metadata or {})},
    )
    return {
        "ok": True,
        "provider": "mapbox",
        "temporary_use_only": True,
        "matrix": data,
        "_trailhead": {"engine": "map-context-matrix", "temporary_use_only": True},
    }

@app.get("/api/explorer/weather/layers")
@app.get("/api/extreme/weather/layers")
def extreme_weather_layers(user: dict = Depends(_current_user)):
    config = _extreme_config_for_user(user)
    if not config["enabled"]:
        raise HTTPException(403, {"code": "extreme_hidden_beta", "message": "Explorer is in hidden beta for selected accounts."})
    return config["weather"]

@app.post("/api/explorer/weather/route-risk")
@app.post("/api/extreme/weather/route-risk")
def extreme_weather_route_risk(body: ExtremeRouteRiskRequest, user: dict = Depends(_current_user)):
    config = _extreme_config_for_user(user)
    if not config["enabled"]:
        raise HTTPException(403, {"code": "extreme_hidden_beta", "message": "Explorer is in hidden beta for selected accounts."})
    if not config["feature_flags"]["weather"]:
        raise HTTPException(403, {"code": "extreme_weather_disabled", "message": "Weather Watch is not enabled for this beta."})
    trip_id = (body.trip_id or "").strip()[:120] or None
    risks = _extreme_weather_risk_points(body)
    log_extreme_ledger_event(
        user["id"],
        "weather_route_risk_previewed",
        None,
        "weather",
        trip_id,
        {"risk_count": len(risks), **(body.metadata or {})},
    )
    return {
        "enabled": True,
        "layers": EXTREME_WEATHER_LAYERS,
        "risk_checkpoints": risks,
        "summary": "Weather checks are staged along the route for review.",
    }

@app.post("/api/explorer/copilot/command")
@app.post("/api/extreme/copilot/command")
def extreme_copilot_command(body: ExtremeCopilotCommandRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_copilot(user, voice=str(body.mode or "").lower() == "voice")
    command = " ".join(str(body.command or "").split())[:800]
    if not command:
        raise HTTPException(400, "command is required")
    mode = _clean_extreme_event_type(body.mode or "text")
    action_type, response = _classify_extreme_command(command)
    context = _copilot_context_dict(body.context or {})
    map_action = _build_extreme_map_action(command, context)
    clean_session = _clean_extreme_session_id(body.session_id)
    trip_id = (body.trip_id or "").strip()[:120] or None
    payload = {
        "response": response,
        "requires_confirmation": bool(map_action["requires_confirmation"]),
        "context": context,
        "mode": mode,
        "map_action": map_action,
    }
    action = stage_extreme_copilot_action(user["id"], command, action_type, clean_session, trip_id, payload)
    log_extreme_ledger_event(
        user["id"],
        "copilot_action_staged",
        clean_session,
        "copilot",
        trip_id,
        {
            "action_id": action["id"],
            "action_type": action_type,
            "map_action_type": map_action["action_type"],
            "mode": mode,
            "provider": map_action["provider"],
            "prompt_class": action_type,
            "result_status": "staged",
            "cost_bucket": map_action["cost_class"],
        },
    )
    return {
        "ok": True,
        "action": {
            "id": action["id"],
            "type": action_type,
            "label": EXTREME_COPILOT_ACTIONS.get(action_type, "Review"),
            "status": "staged",
            "requires_confirmation": bool(map_action["requires_confirmation"]),
            "payload": action.get("payload") or payload,
            "map_action": map_action,
        },
        "message": map_action["message"] or response,
    }

@app.post("/api/explorer/copilot/session")
@app.post("/api/extreme/copilot/session")
def extreme_copilot_session(body: ExtremeCopilotSessionRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_copilot(user)
    surface = _clean_extreme_surface(body.surface or "map_layers")
    if surface not in config["allowed_surfaces"] and surface != "copilot":
        raise HTTPException(403, {"code": "extreme_copilot_surface_disabled", "message": "Copilot is not enabled on this surface."})
    trip_id = (body.trip_id or "").strip()[:120] or None
    context = _copilot_context_dict(body.context)
    session = create_extreme_demo_session(
        user["id"],
        "copilot",
        trip_id,
        config["max_demo_session_seconds"],
        {
            "surface": surface,
            "provider": "trailhead_openai",
            "context_keys": [key for key, value in context.items() if value],
            **(body.metadata or {}),
        },
    )
    event_id = log_extreme_ledger_event(
        user["id"],
        "copilot_session_started",
        session["session_id"],
        "copilot",
        trip_id,
        {"surface": surface, "provider": "trailhead_openai"},
    )
    return {
        "ok": True,
        "session_id": session["session_id"],
        "expires_at": session["expires_at"],
        "provider": "trailhead_openai",
        "voice_enabled": bool(config["feature_flags"]["voice"]),
        "ledger_id": event_id,
    }

@app.post("/api/explorer/copilot/message")
@app.post("/api/extreme/copilot/message")
def extreme_copilot_message(body: ExtremeCopilotMessageRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_copilot(user, voice=str(body.mode or "").lower() == "voice")
    message = " ".join(str(body.message or "").split())[:1200]
    if not message:
        raise HTTPException(400, "message is required")
    mode = _clean_extreme_event_type(body.mode or "text")
    provider = _copilot_provider(body.provider)
    context = _copilot_context_dict(body.context)
    map_action = _build_extreme_map_action(message, context, provider)
    legacy_action_type, legacy_message = _classify_extreme_command(message)
    clean_session = _clean_extreme_session_id(body.session_id)
    trip_id = (body.trip_id or "").strip()[:120] or None
    payload = {
        "schema_version": 1,
        "response": map_action["message"] or legacy_message,
        "requires_confirmation": bool(map_action["requires_confirmation"]),
        "mode": mode,
        "provider": provider,
        "map_action": map_action,
        "context": context,
    }
    staged = stage_extreme_copilot_action(user["id"], message, map_action["action_type"], clean_session, trip_id, payload)
    ledger_id = log_extreme_ledger_event(
        user["id"],
        "copilot_map_action_staged",
        clean_session,
        "copilot",
        trip_id,
        {
            "action_id": staged["id"],
            "action_type": map_action["action_type"],
            "prompt_class": legacy_action_type,
            "chosen_tool": map_action["action_type"],
            "result_status": "staged",
            "latency_ms": 0,
            "cost_bucket": map_action["cost_class"],
            "requires_confirmation": bool(map_action["requires_confirmation"]),
            "provider": provider,
        },
    )
    action_request = {
        **{key: map_action[key] for key in ("action_id", "action_type", "args", "requires_confirmation", "cost_class", "surface", "provider")},
        "id": staged["id"],
        "status": "staged",
        "label": EXTREME_COPILOT_ACTIONS.get(map_action["action_type"], "Review"),
    }
    result = {
        "ok": True,
        "message": map_action["message"] or legacy_message,
        "map_updates": map_action["map_updates"],
        "status": "staged",
        "spoken_summary": map_action["message"] or legacy_message,
        "selected_place": map_action["selected_place"],
        "route_preview": map_action["route_preview"],
        "route_builder_draft": map_action.get("route_builder_draft"),
        "current_screen": (context.get("map") or {}).get("current_screen") or (context.get("trip") or {}).get("current_screen"),
        "failure_reason": None,
        "ledger_id": ledger_id,
        "error_code": None,
    }
    return {
        "ok": True,
        "session_id": clean_session,
        "provider": provider,
        "message": result["message"],
        "action": action_request,
        "result": result,
    }

def _mission_provider_confidence(value: object) -> str:
    try:
        numeric = float(value)
    except Exception:
        numeric = 0.0
    if numeric >= 0.85:
        return "high"
    if numeric >= 0.65:
        return "medium"
    if numeric > 0:
        return "low"
    return "unknown"

def _mission_condition_type(alert: dict) -> str:
    raw = re.sub(r"[^a-z0-9_]+", "_", str(alert.get("type") or "hazard").lower()).strip("_")
    if raw in {"weather", "fire", "smoke", "traffic", "road", "closure", "hazard"}:
        return raw
    if raw in {"earthquake", "cyclone", "flood", "volcano", "drought", "tsunami"}:
        return raw
    subtype = str(alert.get("subtype") or "").lower()
    if "weather" in subtype or "warning" in subtype or "watch" in subtype:
        return "weather"
    return "hazard"

def _mission_place_from_condition(alert: dict, route_points: list[dict]) -> dict | None:
    try:
        lat = float(alert.get("lat"))
        lng = float(alert.get("lng"))
    except Exception:
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    provider = re.sub(r"[^a-z0-9_:-]+", "", str(alert.get("provider") or alert.get("source") or "provider").lower()) or "provider"
    subtype = _planner_clean_text(alert.get("subtype") or alert.get("title") or alert.get("type") or "Route condition", 120)
    description = _planner_clean_text(alert.get("description") or alert.get("note") or subtype, 360)
    item = {
        "id": str(alert.get("id") or f"{provider}:{alert.get('provider_id') or lat}:{lng}")[:180],
        "type": _mission_condition_type(alert),
        "subtype": subtype,
        "title": subtype,
        "note": description or "Review this route condition before departure.",
        "summary": description,
        "lat": lat,
        "lng": lng,
        "source": "provider",
        "source_label": provider.upper(),
        "provider": provider,
        "provider_id": str(alert.get("provider_id") or "")[:160],
        "source_id": str(alert.get("id") or alert.get("provider_id") or "")[:180],
        "severity": str(alert.get("severity") or "").lower() or "low",
        "confidence": _mission_provider_confidence(alert.get("confidence")),
        "created_at": alert.get("created_at"),
        "updated_at": alert.get("updated_at"),
        "expires_at": alert.get("expires_at"),
    }
    _annotate_route_candidate(item, route_points)
    return item

async def _mission_provider_places_for_route(config: dict, route: object, metadata: dict | None = None) -> tuple[list[dict], dict]:
    flags = config.get("feature_flags") or {}
    meta = metadata if isinstance(metadata, dict) else {}
    enabled = bool(flags.get("weather") and flags.get("mission_provider_evidence"))
    if meta.get("include_provider_evidence") is False:
        enabled = False
    route_points = _route_points_from_any(route, limit=160)
    debug = {
        "provider_evidence_enabled": enabled,
        "provider_route_points": len(route_points),
        "provider_evidence_count": 0,
        "provider_sources": [],
        "provider_errors": [],
    }
    if not enabled or len(route_points) < 2:
        return [], debug
    try:
        alerts = await get_provider_conditions_along_route(route_points, radius_deg=0.18)
    except Exception as exc:
        debug["provider_errors"] = [str(exc)[:180]]
        return [], debug
    places = []
    for alert in alerts:
        place = _mission_place_from_condition(alert, route_points)
        if place:
            places.append(place)
    sources = sorted({str(place.get("source_label") or place.get("provider") or "").upper() for place in places if place.get("source_label") or place.get("provider")})
    debug.update({
        "provider_evidence_count": len(places),
        "provider_sources": sources[:8],
    })
    return places[:40], debug

@app.post("/api/explorer/copilot/mission-control")
@app.post("/api/extreme/copilot/mission-control")
async def extreme_copilot_mission_control(body: MissionControlRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_copilot(user)
    if not config["feature_flags"].get("mission_control") or not config["feature_flags"].get("adventure_scores"):
        raise HTTPException(403, {"code": "mission_control_disabled", "message": "Mission Control is not enabled for this beta."})
    clean_session = _clean_extreme_session_id(body.session_id)
    trip_id = (body.trip_id or "").strip()[:120] or None
    metadata = body.metadata or {}
    provider_places, provider_debug = await _mission_provider_places_for_route(config, body.route, metadata)
    payload = {
        "trip_id": trip_id,
        "route": body.route[:400],
        "checkpoints": [checkpoint.dict() for checkpoint in body.checkpoints[:80]],
        "places": [*body.places[:120], *provider_places],
        "trip_memory": body.trip_memory.dict() if body.trip_memory else {},
        "context": body.context or {},
        "metadata": metadata,
    }
    brief = build_mission_control(payload)
    brief.setdefault("debug", {}).update(provider_debug)
    brief["debug"]["provider_calls"] = 1 if provider_debug.get("provider_evidence_enabled") else 0
    ledger_id = log_extreme_ledger_event(
        user["id"],
        "mission_control_generated",
        clean_session,
        "copilot",
        trip_id,
        {
            "readiness": brief.get("readiness"),
            "score_count": len(brief.get("scores") or []),
            "risk_count": len(brief.get("risks") or []),
            "recommendation_count": len(brief.get("recommendations") or []),
            "route_points": len(payload["route"]),
            "provider_calls": brief["debug"].get("provider_calls", 0),
            "provider_evidence_count": provider_debug.get("provider_evidence_count", 0),
            "provider_sources": provider_debug.get("provider_sources", []),
        },
    )
    brief["ledger_id"] = ledger_id
    return brief

@app.post("/api/explorer/route-scout/windows")
@app.post("/api/extreme/route-scout/windows")
def extreme_route_scout_windows(body: RouteScoutWindowPlanRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_copilot(user)
    if not config["feature_flags"].get("copilot"):
        raise HTTPException(403, {"code": "route_scout_disabled", "message": "Route Scout is not enabled for this beta."})
    route_points = _route_points_from_any(body.route, limit=400)
    total_miles = float(body.total_miles or 0)
    if total_miles <= 0 and len(route_points) >= 2:
        total_miles = _route_distance_mi(route_points)
    if total_miles <= 0:
        raise HTTPException(400, "Route distance is required for Route Scout windows")
    safe_days = max(2, min(30, int(round(float(body.days or 2)))))
    windows = _route_scout_window_plan(safe_days, total_miles)
    clean_session = _clean_extreme_session_id(body.session_id)
    trip_id = (body.trip_id or "").strip()[:120] or None
    ledger_id = log_extreme_ledger_event(
        user["id"],
        "route_scout_windows_planned",
        clean_session,
        "copilot",
        trip_id,
        {
            "route_points": len(route_points),
            "route_distance_mi": round(total_miles, 1),
            "days": safe_days,
            "window_count": len(windows),
            "route_style": str(body.route_style or "balanced")[:40],
        },
    )
    return {
        "ok": True,
        "trip_id": trip_id,
        "route_distance_mi": round(total_miles, 2),
        "days": safe_days,
        "drive_hours": body.drive_hours,
        "route_style": str(body.route_style or "balanced")[:40],
        "policy": "route_scout_windows_v1",
        "windows": windows,
        "ledger_id": ledger_id,
    }

@app.post("/api/explorer/copilot/action/confirm")
@app.post("/api/extreme/copilot/action/confirm")
def extreme_copilot_action_confirm(body: ExtremeCopilotConfirmRequest, user: dict = Depends(_current_user)):
    _require_extreme_copilot(user)
    action = confirm_extreme_copilot_action(user["id"], int(body.action_id), bool(body.confirmed), body.client_result or {})
    if not action:
        raise HTTPException(404, "Copilot action not found")
    payload = action.get("payload") or {}
    map_action = payload.get("map_action") if isinstance(payload.get("map_action"), dict) else {}
    ledger_id = log_extreme_ledger_event(
        user["id"],
        "copilot_action_confirmation",
        action.get("session_id"),
        "copilot",
        action.get("trip_id"),
        {
            "action_id": action["id"],
            "action_type": map_action.get("action_type") or action.get("action_type"),
            "confirmation_outcome": "confirmed" if body.confirmed else "rejected",
            "result_status": action.get("status"),
            "cost_bucket": map_action.get("cost_class", "local"),
        },
    )
    return {
        "ok": True,
        "action_id": action["id"],
        "status": action.get("status"),
        "confirmed": bool(body.confirmed),
        "ledger_id": ledger_id,
    }

@app.post("/api/explorer/copilot/realtime-session")
@app.post("/api/extreme/copilot/realtime-session")
def extreme_copilot_realtime_session(body: RealtimeCopilotSessionRequest, user: dict = Depends(_current_user)):
    config = _require_extreme_copilot(user, voice=True)
    api_key = settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise HTTPException(503, {"code": "realtime_unconfigured", "message": "Realtime voice is not configured for this beta."})
    voice = _openai_realtime_voice(body.voice or config["copilot"]["voice"])
    wake_requested = bool(body.wake_phrase or str(body.mode or "").lower() == "wake_phrase")
    wake_enabled = bool((config.get("copilot") or {}).get("wake_phrase"))
    if wake_requested and not wake_enabled:
        raise HTTPException(403, {"code": "extreme_wake_phrase_disabled", "message": "Wake phrase mode is not enabled for this beta."})
    wake_phrase = bool(wake_requested and wake_enabled)
    model = _openai_realtime_model(False)
    fallback_model = _openai_realtime_model(True)
    session_id = _clean_extreme_session_id(body.session_id) or f"extreme_rt_{uuid.uuid4().hex[:16]}"
    context = _copilot_context_dict(body.context)
    log_extreme_ledger_event(
        user["id"],
        "copilot_realtime_session_requested",
        session_id,
        "copilot",
        None,
        {"voice": voice, "model": model, "fallback_model": fallback_model, "wake_phrase": wake_phrase, "raw_audio_stored": False},
    )
    safety_id = hashlib.sha256(f"trailhead:{user['id']}".encode("utf-8")).hexdigest()
    session_config = {
        "session": {
            "type": "realtime",
            "model": model,
            "instructions": _copilot_realtime_instructions(wake_phrase),
            "audio": {
                "output": {"voice": voice},
                "input": {
                    "turn_detection": _copilot_realtime_turn_detection(),
                    "noise_reduction": {"type": "near_field"},
                },
            },
            "tools": _copilot_realtime_tools(),
            "tool_choice": "auto",
        }
    }
    try:
        with httpx.Client(timeout=12.0) as client:
            response = client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "OpenAI-Safety-Identifier": safety_id,
                },
                json=session_config,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(503, {"code": "realtime_openai_unavailable", "message": str(exc)[:240]})
    if response.status_code >= 400:
        detail = response.text[:500]
        raise HTTPException(response.status_code, {"code": "realtime_openai_error", "message": detail})
    data = response.json()
    log_extreme_ledger_event(
        user["id"],
        "copilot_realtime_session_created",
        session_id,
        "copilot",
        None,
        {"voice": voice, "model": model, "wake_phrase": wake_phrase, "raw_audio_stored": False},
    )
    data["ok"] = True
    data["session_id"] = session_id
    data["provider"] = "openai_realtime"
    data["model"] = model
    data["fallback_model"] = fallback_model
    data["voice"] = voice
    data["wake_phrase"] = wake_phrase
    return data


def _clean_countrycodes(countrycodes: str = "") -> str:
    codes = []
    for raw in (countrycodes or "").split(","):
        code = re.sub(r"[^a-zA-Z]", "", raw).lower()
        if len(code) == 2:
            codes.append(code)
    return ",".join(dict.fromkeys(codes))

COUNTRY_QUERY_HINTS = {
    "finland": "fi", "suomi": "fi", "helsinki": "fi", "turku": "fi", "tampere": "fi", "rovaniemi": "fi",
    "canada": "ca", "alberta": "ca", "british columbia": "ca", "ontario": "ca", "quebec": "ca", "vancouver": "ca", "banff": "ca",
    "mexico": "mx", "baja": "mx", "sonora": "mx", "chihuahua": "mx", "oaxaca": "mx", "mexico city": "mx",
    "united states": "us", "usa": "us", "u.s.a": "us", "u.s.": "us",
    "france": "fr", "paris france": "fr", "paris, france": "fr", "eiffel tower": "fr", "eifel tower": "fr", "louvre": "fr",
    "italy": "it", "rome": "it", "venice": "it", "florence": "it",
    "spain": "es", "barcelona": "es", "madrid": "es",
    "united kingdom": "gb", "uk": "gb", "england": "gb", "london": "gb",
    "germany": "de", "berlin": "de", "munich": "de",
    "japan": "jp", "tokyo": "jp", "kyoto": "jp",
    "australia": "au", "sydney": "au", "melbourne": "au",
    "pakistan": "pk", "gilgit": "pk", "skardu": "pk", "karakoram": "pk", "askole": "pk", "baltoro": "pk", "k2": "pk",
}

def _countrycodes_for_query(query: str) -> str:
    text = (query or "").lower()
    matches = []
    for needle, code in COUNTRY_QUERY_HINTS.items():
        if needle in text and code not in matches:
            matches.append(code)
    return ",".join(matches)

def _normalize_geocode_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()

GEOCODE_ROAD_WORD_RE = re.compile(r"\b(road|rd|street|st|avenue|ave|boulevard|blvd|drive|dr|lane|ln|way|highway|hwy|route|rte)\b")
GEOCODE_SEARCH_CENTER_PREFERENCES = {"center", "search center", "nearby search", "locality", "place", "map center"}
GEOCODE_LOCALITY_TYPES = {
    "place", "locality", "city", "town", "village", "hamlet", "municipality", "settlement",
    "county", "district", "region", "province", "state", "country", "neighborhood", "suburb",
    "borough", "administrative", "boundary",
}
GEOCODE_CENTER_ANCHOR_TYPES = {
    "landmark", "park", "national_park", "protected_area", "mountain", "peak", "volcano",
    "glacier", "natural", "tourism", "attraction", "historic", "monument",
}

def _geocode_query_is_road(query: str) -> bool:
    return bool(GEOCODE_ROAD_WORD_RE.search(_normalize_geocode_text(query)))

def _geocode_prefer_search_center(prefer: str) -> bool:
    return _normalize_geocode_text(prefer) in GEOCODE_SEARCH_CENTER_PREFERENCES

def _geocode_candidate_type_tokens(place: dict) -> set[str]:
    raw_types = [
        place.get("feature_type"),
        place.get("category"),
        *(place.get("place_types") if isinstance(place.get("place_types"), list) else []),
    ]
    tokens: set[str] = set()
    for value in raw_types:
        normalized = _normalize_geocode_text(str(value or ""))
        if not normalized:
            continue
        tokens.add(normalized)
        tokens.update(part for part in normalized.split() if part)
    return tokens

def _geocode_candidate_is_locality(place: dict) -> bool:
    return bool(_geocode_candidate_type_tokens(place).intersection(GEOCODE_LOCALITY_TYPES))

def _geocode_candidate_is_search_center(place: dict) -> bool:
    tokens = _geocode_candidate_type_tokens(place)
    if tokens.intersection(GEOCODE_LOCALITY_TYPES):
        return True
    if str(place.get("source") or "").lower() == "trailhead_landmark":
        return True
    return bool(tokens.intersection(GEOCODE_CENTER_ANCHOR_TYPES))

def _country_code_from_mapbox_context(feature: dict) -> tuple[str | None, str | None, str | None]:
    country_code = None
    country_name = None
    region_name = None
    for item in feature.get("context") or []:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or "")
        text = str(item.get("text") or "")
        short_code = str(item.get("short_code") or "").lower()
        if item_id.startswith("country"):
            country_name = text or country_name
            if short_code:
                country_code = short_code.split("-")[0]
        elif item_id.startswith("region"):
            region_name = text or region_name
    return country_code, country_name, region_name

def _geocode_place_matches_country(place: dict, country_filter: str) -> bool:
    filters = {code for code in _clean_countrycodes(country_filter).split(",") if code}
    if not filters:
        return True
    country_code = str(place.get("country_code") or "").lower()
    if country_code:
        return country_code in filters
    hay = _normalize_geocode_text(" ".join([
        str(place.get("name") or ""),
        str(place.get("country") or ""),
        str(place.get("region") or ""),
    ]))
    country_names = {
        "fr": ["france"],
        "us": ["united states", "usa"],
        "ca": ["canada"],
        "mx": ["mexico"],
        "fi": ["finland", "suomi"],
        "gb": ["united kingdom", "england"],
        "it": ["italy"],
        "es": ["spain"],
        "de": ["germany"],
        "jp": ["japan"],
        "au": ["australia"],
        "pk": ["pakistan"],
    }
    return any(any(_normalize_geocode_text(name) in hay for name in country_names.get(code, [])) for code in filters)

def _geocode_candidate_score(query: str, place: dict, country_filter: str = "", prefer_search_center: bool = False) -> float:
    needle = _normalize_geocode_text(query)
    name = _normalize_geocode_text(str(place.get("name") or ""))
    tokens = _geocode_candidate_type_tokens(place)
    types = " ".join(sorted(tokens))
    score = 0.0
    if needle and name:
        if name == needle:
            score -= 20
        elif name.startswith(needle) or needle.startswith(name):
            score -= 10
        elif needle in name or name in needle:
            score -= 5
        else:
            score += 14
    if country_filter and not _geocode_place_matches_country(place, country_filter):
        score += 500
    query_is_road = bool(GEOCODE_ROAD_WORD_RE.search(needle))
    name_is_road = bool(GEOCODE_ROAD_WORD_RE.search(name))
    if name_is_road and not query_is_road:
        score += 60
    if re.search(r"\b(address|street|postcode|neighborhood|locality)\b", types) and not query_is_road:
        score += 20
    if re.search(r"\b(place|poi|landmark|tourism|attraction|historic|monument|museum|park|locality)\b", types):
        score -= 10
    relevance = place.get("relevance")
    try:
        score -= max(0.0, min(float(relevance), 1.0)) * 8
    except (TypeError, ValueError):
        pass
    if str(place.get("source") or "").lower() == "trailhead_explore" and not query_is_road:
        score -= 12
    if prefer_search_center and not query_is_road:
        source = str(place.get("source") or "").lower()
        if _geocode_candidate_is_locality(place):
            score -= 70
        elif _geocode_candidate_is_search_center(place):
            score -= 30
        elif source == "trailhead_explore":
            score += 35
        else:
            score += 12
        if "country" in tokens and len([term for term in needle.split() if len(term) > 1]) > 1:
            score += 35
    try:
        score += min(max(float(place.get("trailhead_match_score")), 0.0), 999.0) / 20.0
    except (TypeError, ValueError):
        pass
    return score

def _explore_geocode_country_code(item: dict) -> str | None:
    hay = _normalize_geocode_text(" ".join([
        str(item.get("region") or ""),
        str(item.get("source_url") or ""),
        " ".join(str(tag or "") for tag in item.get("tags") or []),
        str((item.get("card") or {}).get("region") if isinstance(item.get("card"), dict) else ""),
    ]))
    if re.search(r"\b(pk|pakistan|gilgit baltistan|karakoram|skardu|askole|baltoro)\b", hay):
        return "pk"
    if re.search(r"\b(united states|usa|california|utah|arizona|colorado|wyoming|montana|washington|oregon|nevada)\b", hay):
        return "us"
    if re.search(r"\b(canada|alberta|british columbia|ontario|quebec)\b", hay):
        return "ca"
    if re.search(r"\b(france)\b", hay):
        return "fr"
    if re.search(r"\b(australia)\b", hay):
        return "au"
    return None

def _explore_geocode_match_score(query: str, place: dict, item: dict) -> float | None:
    needle = _normalize_geocode_text(query)
    if not needle or _geocode_query_is_road(query):
        return None
    terms = [term for term in needle.split() if len(term) >= 2]
    if not terms:
        return None
    title = _normalize_geocode_text(item.get("title") or "")
    aliases = [_normalize_geocode_text(value) for value in item.get("search_aliases") or [] if str(value or "").strip()]
    hay = _normalize_geocode_text(_explore_query_text(place))
    if title == needle:
        base = 0.0
    elif any(alias == needle for alias in aliases):
        base = 3.0
    elif title.startswith(needle):
        base = 1.0
    elif needle in title:
        base = 2.0
    elif title and title in needle:
        base = 5.0
    elif all(term in title for term in terms):
        base = 4.0
    elif all(any(term in alias for alias in aliases) or term in hay for term in terms):
        base = 8.0
    else:
        return None
    try:
        rank_penalty = min(float(item.get("hero_rank") or item.get("rank") or 9999), 9999.0) / 1000.0
    except (TypeError, ValueError):
        rank_penalty = 9.999
    source_quality = str(item.get("source_quality") or item.get("quality") or "").lower()
    quality_penalty = 0.0 if any(term in source_quality for term in ("curated", "official")) else 2.0
    return base * 20.0 + rank_penalty + quality_penalty

def _explore_place_to_geocode_candidate(place: dict, query: str) -> dict | None:
    item = _explore_place_index_item(place)
    title = str(item.get("title") or "").strip()
    try:
        lat = float(item.get("lat"))
        lng = float(item.get("lng"))
    except (TypeError, ValueError):
        return None
    if not title or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    match_score = _explore_geocode_match_score(query, place, item)
    if match_score is None:
        return None
    category = str(item.get("v3_category") or item.get("category") or item.get("explore_group") or "place").strip()
    normalized_category = _normalize_place_category(category) or "place"
    explore_group = str(item.get("explore_group") or "").lower()
    source_label = "Trailhead trail" if "trail" in explore_group or normalized_category in {"trail", "trailhead"} else "Trailhead Explore"
    relevance = max(0.1, min(1.0, 1.0 - (match_score / 220.0)))
    return {
        "name": title,
        "lat": lat,
        "lng": lng,
        "source": "trailhead_explore",
        "source_label": source_label,
        "place_id": item.get("id"),
        "provider_place_id": item.get("id"),
        "feature_type": normalized_category,
        "place_types": [part for part in ["poi", normalized_category, explore_group or None] if part],
        "category": category,
        "relevance": round(relevance, 4),
        "country_code": _explore_geocode_country_code(item),
        "country": "Pakistan" if _explore_geocode_country_code(item) == "pk" else None,
        "region": item.get("region") or None,
        "summary": item.get("short_description") or item.get("hook") or "",
        "photo_url": item.get("thumbnail_url") or item.get("image_url") or "",
        "trailhead_match_score": round(match_score, 3),
    }

def _near_duplicate_geocode_place(a: dict, b: dict) -> bool:
    name_a = _normalize_geocode_text(a.get("name") or "")
    name_b = _normalize_geocode_text(b.get("name") or "")
    if name_a != name_b:
        return False
    if str(a.get("source") or "").lower() == "trailhead_explore" and str(b.get("source") or "").lower() == "trailhead_explore":
        return True
    try:
        return abs(float(a.get("lat")) - float(b.get("lat"))) <= 0.02 and abs(float(a.get("lng")) - float(b.get("lng"))) <= 0.02
    except (TypeError, ValueError):
        return False

def _merge_geocode_candidates(groups: list[list[dict]], limit: int) -> list[dict]:
    merged: list[dict] = []
    seen_ids: set[str] = set()
    for group in groups:
        for place in group:
            if not isinstance(place, dict):
                continue
            place_id = str(place.get("place_id") or place.get("provider_place_id") or "").strip().lower()
            id_key = f"{str(place.get('source') or '').lower()}:{place_id}" if place_id else ""
            if id_key and id_key in seen_ids:
                continue
            if any(_near_duplicate_geocode_place(place, existing) for existing in merged):
                continue
            if id_key:
                seen_ids.add(id_key)
            merged.append(place)
            if len(merged) >= limit:
                return merged
    return merged[:limit]

def _explore_catalog_geocode_candidates(query: str, limit: int = 8, country_filter: str = "") -> list[dict]:
    if _geocode_query_is_road(query):
        return []
    candidates: list[dict] = []
    for place in _load_explore_catalog().get("places") or []:
        candidate = _explore_place_to_geocode_candidate(place, query)
        if not candidate:
            continue
        if country_filter and not _geocode_place_matches_country(candidate, country_filter):
            continue
        candidates.append(candidate)
    candidates.sort(key=lambda item: (
        float(item.get("trailhead_match_score") or 9999),
        str(item.get("name") or ""),
        float(item.get("lat") or 0),
        float(item.get("lng") or 0),
    ))
    return _merge_geocode_candidates([candidates], max(1, min(int(limit or 8), 10)))

def _strong_explore_geocode_hit(candidates: list[dict]) -> bool:
    if not candidates:
        return False
    try:
        return float(candidates[0].get("trailhead_match_score") or 9999) <= 45.0
    except (TypeError, ValueError):
        return False

def _resolve_geocode_candidates(query: str, places: list[dict], country_filter: str = "", prefer_search_center: bool = False) -> dict:
    valid = [
        place for place in places
        if isinstance(place, dict)
        and isinstance(place.get("lat"), (int, float))
        and isinstance(place.get("lng"), (int, float))
    ]
    if not valid:
        return {"status": "not_found", "query": query, "normalized_query": query, "selected": None, "alternatives": [], "rejected": [], "reason": "no_candidates"}
    def score_place(place: dict) -> float:
        return _geocode_candidate_score(query, place, country_filter, prefer_search_center)
    ranked = sorted(valid, key=lambda place: (
        score_place(place),
        str(place.get("name") or ""),
        float(place.get("lat") or 0),
        float(place.get("lng") or 0),
    ))
    selected = ranked[0]
    rejected = [
        {
            "name": place.get("name"),
            "lat": place.get("lat"),
            "lng": place.get("lng"),
            "country_code": place.get("country_code"),
            "feature_type": place.get("feature_type"),
            "place_id": place.get("place_id"),
            "score": round(score_place(place), 3),
            "reason": "country_mismatch" if country_filter and not _geocode_place_matches_country(place, country_filter) else "lower_rank",
        }
        for place in ranked[1:8]
    ]
    if country_filter and not _geocode_place_matches_country(selected, country_filter):
        return {
            "status": "mismatch",
            "query": query,
            "normalized_query": query,
            "selected": None,
            "alternatives": ranked[:6],
            "rejected": rejected,
            "reason": "explicit_country_mismatch",
            "countrycodes": country_filter,
        }
    runner_up = ranked[1] if len(ranked) > 1 else None
    margin = (score_place(runner_up) - score_place(selected)) if runner_up else 999
    status = "ambiguous" if runner_up and margin < 3 and not country_filter else "resolved"
    return {
        "status": status,
        "query": query,
        "normalized_query": query,
        "selected": {
            **selected,
            "confidence": "high" if status == "resolved" and margin >= 8 else "medium",
            "score": round(score_place(selected), 3),
        },
        "alternatives": ranked[1:6],
        "rejected": rejected,
        "reason": "close_candidates" if status == "ambiguous" else "best_verified_candidate",
        "countrycodes": country_filter,
    }

FAMOUS_LANDMARK_GEOCODES = [
    {
        "aliases": ["eiffel tower", "eifel tower", "tour eiffel"],
        "name": "Eiffel Tower, Paris, France",
        "lat": 48.85837,
        "lng": 2.29448,
        "category": "landmark",
    },
    {
        "aliases": ["golden gate bridge"],
        "name": "Golden Gate Bridge, San Francisco, California",
        "lat": 37.81993,
        "lng": -122.47826,
        "category": "landmark",
    },
    {
        "aliases": ["grand canyon", "grand canyon national park"],
        "name": "Grand Canyon National Park, Arizona",
        "lat": 36.05444,
        "lng": -112.14011,
        "category": "park",
    },
    {
        "aliases": ["delicate arch"],
        "name": "Delicate Arch, Arches National Park, Utah",
        "lat": 38.74362,
        "lng": -109.49929,
        "category": "landmark",
    },
    {
        "aliases": ["half dome"],
        "name": "Half Dome, Yosemite National Park, California",
        "lat": 37.74604,
        "lng": -119.53319,
        "category": "landmark",
    },
]

def _canonical_landmark_geocode(query: str) -> list[dict]:
    text = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (query or "").lower())).strip()
    if not text or re.search(r"\b(road|rd|street|st|lane|ln|drive|dr|way|avenue|ave|boulevard|blvd|highway|hwy|route)\b", text):
        return []
    for landmark in FAMOUS_LANDMARK_GEOCODES:
        if any(alias in text for alias in landmark["aliases"]):
            return [{
                "name": landmark["name"],
                "lat": landmark["lat"],
                "lng": landmark["lng"],
                "source": "trailhead_landmark",
                "place_id": f"trailhead_landmark:{landmark['aliases'][0].replace(' ', '_')}",
                "feature_type": "landmark",
                "place_types": ["poi", "landmark"],
                "category": landmark["category"],
                "relevance": 1.0,
                "country_code": "fr" if "eiffel" in landmark["aliases"][0] else "us",
            }]
    return []

@app.get("/api/geocode")
async def geocode_places(q: str, limit: int = 8, countrycodes: str = "", prefer: str = ""):
    query = (q or "").strip()
    if not query:
        return []
    limit = max(1, min(int(limit or 8), 10))
    country_filter = _clean_countrycodes(countrycodes) or _countrycodes_for_query(query)
    prefer_search_center = _geocode_prefer_search_center(prefer)
    canonical_landmarks = _canonical_landmark_geocode(query)
    explore_candidates = _explore_catalog_geocode_candidates(query, limit, country_filter)
    if not prefer_search_center and _strong_explore_geocode_hit(explore_candidates):
        return _merge_geocode_candidates([explore_candidates, canonical_landmarks], limit)
    if canonical_landmarks and not prefer_search_center:
        return _merge_geocode_candidates([explore_candidates, canonical_landmarks], limit)

    async def fetch_geocode() -> list[dict]:
        token = settings.mapbox_token
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "TrailheadRouteBuilder/1.0"}) as client:
            if token:
                try:
                    params = {"access_token": token, "limit": limit}
                    if country_filter:
                        params["country"] = country_filter
                    t0 = time.time()
                    resp = await client.get(
                        f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(query, safe='')}.json",
                        params=params,
                    )
                    record_provider_call(
                        "mapbox",
                        "geocode",
                        status_code=resp.status_code,
                        duration_ms=round((time.time() - t0) * 1000),
                        source_action="submit_search",
                        key=f"{query.lower()}:{country_filter}:{limit}",
                    )
                    resp.raise_for_status()
                    places = []
                    for feat in resp.json().get("features", [])[:limit]:
                        coords = feat.get("geometry", {}).get("coordinates") or []
                        if len(coords) >= 2:
                            place_types = feat.get("place_type") if isinstance(feat.get("place_type"), list) else []
                            properties = feat.get("properties") if isinstance(feat.get("properties"), dict) else {}
                            country_code, country_name, region_name = _country_code_from_mapbox_context(feat)
                            places.append({
                                "name": feat.get("place_name") or feat.get("text") or query,
                                "lat": float(coords[1]),
                                "lng": float(coords[0]),
                                "source": "mapbox",
                                "place_id": feat.get("id"),
                                "feature_type": place_types[0] if place_types else None,
                                "place_types": place_types,
                                "category": properties.get("category"),
                                "relevance": feat.get("relevance"),
                                "country_code": country_code,
                                "country": country_name,
                                "region": region_name,
                                "bbox": feat.get("bbox") if isinstance(feat.get("bbox"), list) else None,
                                "provider_place_id": properties.get("mapbox_id") or feat.get("id"),
                            })
                    if places:
                        groups = [canonical_landmarks, places, explore_candidates] if prefer_search_center else [explore_candidates, canonical_landmarks, places]
                        return _merge_geocode_candidates(groups, limit)
                except Exception:
                    pass
            try:
                params = {"format": "json", "limit": limit, "q": query, "addressdetails": 1}
                if country_filter:
                    params["countrycodes"] = country_filter
                t0 = time.time()
                resp = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params=params,
                )
                record_provider_call(
                    "nominatim",
                    "geocode",
                    status_code=resp.status_code,
                    duration_ms=round((time.time() - t0) * 1000),
                    source_action="submit_search",
                    key=f"{query.lower()}:{country_filter}:{limit}",
                )
                resp.raise_for_status()
                places = []
                for p in resp.json()[:limit]:
                    if not p.get("lat") or not p.get("lon"):
                        continue
                    display = p.get("display_name") or query
                    address = p.get("address") if isinstance(p.get("address"), dict) else {}
                    places.append({
                        "name": ", ".join(display.split(",")[:3]),
                        "lat": float(p["lat"]),
                        "lng": float(p["lon"]),
                        "source": "nominatim",
                        "place_id": p.get("osm_id"),
                        "feature_type": p.get("type"),
                        "place_types": [p.get("class"), p.get("type")],
                        "category": p.get("class"),
                        "relevance": float(p.get("importance") or 0),
                        "country_code": str(address.get("country_code") or "").lower() or None,
                        "country": address.get("country"),
                        "region": address.get("state") or address.get("province") or address.get("region"),
                        "bbox": [float(v) for v in p.get("boundingbox", [])] if isinstance(p.get("boundingbox"), list) and len(p.get("boundingbox")) == 4 else None,
                        "provider_place_id": p.get("osm_id"),
                    })
                groups = [canonical_landmarks, places, explore_candidates] if prefer_search_center else [explore_candidates, canonical_landmarks, places]
                return _merge_geocode_candidates(groups, limit)
            except Exception as e:
                if explore_candidates or canonical_landmarks:
                    groups = [canonical_landmarks, explore_candidates] if prefer_search_center else [explore_candidates, canonical_landmarks]
                    return _merge_geocode_candidates(groups, limit)
                raise HTTPException(502, f"Geocode failed: {e}")

    cache_key = f"geocode:{query.lower()}:{country_filter}:{limit}:{_normalize_geocode_text(prefer)}"
    return await runtime_cached_call(
        cache_key,
        10 * 60,
        fetch_geocode,
        provider="geocode",
        endpoint="search",
        source_action="submit_search",
    )

@app.get("/api/geocode/resolve")
async def resolve_geocode_place(q: str, limit: int = 8, countrycodes: str = "", prefer: str = ""):
    query = (q or "").strip()
    if not query:
        return {"status": "not_found", "query": "", "normalized_query": "", "selected": None, "alternatives": [], "rejected": [], "reason": "empty_query"}
    limit = max(2, min(int(limit or 8), 10))
    country_filter = _clean_countrycodes(countrycodes) or _countrycodes_for_query(query)
    prefer_search_center = _geocode_prefer_search_center(prefer)
    normalized_query = re.sub(r"\s+", " ", query).strip()
    places = await geocode_places(normalized_query, limit, country_filter, prefer)
    result = _resolve_geocode_candidates(normalized_query, places, country_filter, prefer_search_center)
    if result.get("status") in {"mismatch", "not_found"} and country_filter:
        strict_query = normalized_query
        first_country = country_filter.split(",")[0]
        country_names = {
            "fr": "France", "us": "United States", "ca": "Canada", "mx": "Mexico", "fi": "Finland",
            "gb": "United Kingdom", "it": "Italy", "es": "Spain", "de": "Germany", "jp": "Japan", "au": "Australia",
        }
        suffix = country_names.get(first_country)
        if suffix and _normalize_geocode_text(suffix) not in _normalize_geocode_text(strict_query):
            strict_query = f"{normalized_query}, {suffix}"
        retry_places = await geocode_places(strict_query, limit, country_filter, prefer)
        retry_result = _resolve_geocode_candidates(strict_query, retry_places, country_filter, prefer_search_center)
        retry_result["query"] = query
        retry_result["normalized_query"] = strict_query
        retry_result["retry_of"] = normalized_query
        if retry_result.get("status") in {"resolved", "ambiguous"}:
            return retry_result
    return result


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

def _tile_response_headers(content: bytes) -> dict:
    headers = dict(_TILE_CACHE_HEADERS)
    if content.startswith(b"\x1f\x8b"):
        headers["Content-Encoding"] = "gzip"
    return headers


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


# ── Offline contour packs ─────────────────────────────────────────────────────
_contour_jobs: dict[str, dict] = {}
_contour_lock = asyncio.Lock()
_contour_queue: dict = {
    "status": "idle",
    "preset": None,
    "regions": [],
    "pending": [],
    "completed": [],
    "failed": [],
    "current": None,
    "started_at": None,
    "completed_at": None,
    "error": None,
}

class ContourBatchRequest(BaseModel):
    regions: list[str] | None = None
    preset: str = Field("east", description="east, all-states, countries, or custom with regions")
    force: bool = False
    skip_published: bool = True
    continue_on_error: bool = True

_CONTOUR_PRESETS: dict[str, list[str]] = {
    "east": [
        "md", "ny", "wv", "va", "oh", "nc", "sc", "ga", "fl", "tn", "ky",
        "al", "ms", "la", "ar", "mo", "il", "in", "mi", "wi", "ia", "mn",
    ],
    "central": ["nd", "sd", "ne", "ok", "tx"],
    "west": ["ak", "az", "ca", "hi", "id", "mt", "nm", "nv", "or", "ut", "wa", "wy"],
    "countries": ["mexico", "canada"],
}

def _contour_region_id(code: str) -> str:
    raw = (code or "").strip()
    upper = raw.upper()
    if upper in _pms.STATE_BBOXES:
        return upper.lower()
    if upper in _pms.REGION_BBOXES:
        return upper.lower()
    raise HTTPException(400, f"unknown contour region code {code}")

def _contour_defaults(region: str) -> tuple[str, str, str]:
    if region.upper() in _pms.STATE_BBOXES:
        return "feet", "12.192", "200"
    return "meters", "20", "100"

def _contour_preset_regions(preset: str) -> list[str]:
    key = (preset or "").strip().lower()
    if key in {"all", "all-states", "states"}:
        return [code.lower() for code in _pms.STATE_BBOXES]
    if key in _CONTOUR_PRESETS:
        return list(_CONTOUR_PRESETS[key])
    raise HTTPException(400, f"unknown contour batch preset {preset}")

async def _remote_contour_manifest() -> dict:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get("https://tiles.gettrailhead.app/api/contours/manifest.json")
            if resp.status_code == 404:
                return {}
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}

async def _contour_batch_regions(req: ContourBatchRequest) -> list[str]:
    requested = req.regions if req.regions else _contour_preset_regions(req.preset)
    regions = [_contour_region_id(code) for code in requested]
    regions = list(dict.fromkeys(regions))
    if req.skip_published and not req.force:
        manifest = await _remote_contour_manifest()
        published = {name.rsplit(".", 1)[0].lower() for name in manifest if str(name).endswith(".pmtiles")}
        regions = [region for region in regions if region not in published]
    return regions

async def _run_contour_command(region: str, cmd: list[str]) -> int:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(Path(__file__).resolve().parents[1]),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    lines: list[str] = []
    assert proc.stdout is not None
    pending = ""
    while True:
        raw = await proc.stdout.read(4096)
        if not raw:
            break
        pending += raw.decode(errors="replace")
        parts = re.split(r"[\r\n]+", pending)
        pending = parts.pop() if parts else ""
        for part in parts:
            line = part.strip()
            if not line:
                continue
            lines.append(line)
            lines = lines[-25:]
            _contour_jobs[region]["progress"] = line[-500:]
            _contour_jobs[region]["log_tail"] = lines
        if pending.strip():
            _contour_jobs[region]["progress"] = pending.strip()[-500:]
    return await proc.wait()

async def _build_and_publish_contour(region: str, *, force: bool = False) -> None:
    async with _contour_lock:
        unit, interval, index_interval = _contour_defaults(region)
        _contour_jobs[region] = {
            "status": "building",
            "progress": "starting",
            "error": None,
            "started_at": int(time.time()),
            "completed_at": None,
            "log_tail": [],
        }
        build_cmd = [
            "python3", "scripts/build_contours_from_dem.py", region,
            "--unit", unit,
            "--interval-meters", interval,
            "--index-interval", index_interval,
        ]
        if not force:
            build_cmd.append("--skip-existing")
        rc = await _run_contour_command(region, build_cmd)
        if rc != 0:
            _contour_jobs[region].update(status="error", error=f"build exited {rc}", completed_at=int(time.time()))
            return
        _contour_jobs[region].update(status="publishing", progress="uploading to R2")
        rc = await _run_contour_command(region, ["python3", "scripts/publish_contour_packs.py", region])
        if rc != 0:
            _contour_jobs[region].update(status="error", error=f"publish exited {rc}", completed_at=int(time.time()))
            return
        _contour_jobs[region].update(status="done", progress="published", completed_at=int(time.time()))

async def _run_contour_batch(req: ContourBatchRequest, regions: list[str]) -> None:
    _contour_queue.update({
        "status": "running",
        "preset": req.preset,
        "regions": regions,
        "pending": regions[:],
        "completed": [],
        "failed": [],
        "current": None,
        "started_at": int(time.time()),
        "completed_at": None,
        "error": None,
    })
    try:
        for region in regions:
            _contour_queue["current"] = region
            _contour_queue["pending"] = [r for r in _contour_queue["pending"] if r != region]
            await _build_and_publish_contour(region, force=req.force)
            job = _contour_jobs.get(region, {})
            if job.get("status") == "done":
                _contour_queue["completed"].append(region)
                continue
            _contour_queue["failed"].append({"region": region, "error": job.get("error") or "unknown error"})
            if not req.continue_on_error:
                break
        _contour_queue.update(status="done", current=None, completed_at=int(time.time()))
    except Exception as exc:
        _contour_queue.update(status="error", current=None, error=f"{type(exc).__name__}: {exc}", completed_at=int(time.time()))

@app.get("/api/admin/contour-packs-status")
async def contour_packs_status():
    data_dir = Path("/data/contours")
    local = {}
    if data_dir.exists():
        for path in sorted(data_dir.glob("*.pmtiles")):
            local[path.name] = {"size": path.stat().st_size}
    return {"jobs": _contour_jobs, "queue": _contour_queue, "local": local}

@app.api_route("/api/admin/build-contour-pack/{code}", methods=["GET", "POST"])
async def build_contour_pack(code: str, force: bool = False):
    region = _contour_region_id(code)
    active = _contour_lock.locked() or _contour_queue.get("status") == "running"
    if active:
        return {"triggered": False, "region": region, "reason": "contour job already running"}
    asyncio.create_task(_build_and_publish_contour(region, force=force))
    return {"triggered": True, "region": region, "force": force}

@app.post("/api/admin/build-contour-batch")
async def build_contour_batch(req: ContourBatchRequest):
    active = _contour_lock.locked() or _contour_queue.get("status") == "running"
    if active:
        return {"triggered": False, "reason": "contour job already running", "queue": _contour_queue}
    regions = await _contour_batch_regions(req)
    if not regions:
        _contour_queue.update({
            "status": "done",
            "preset": req.preset,
            "regions": [],
            "pending": [],
            "completed": [],
            "failed": [],
            "current": None,
            "started_at": int(time.time()),
            "completed_at": int(time.time()),
            "error": None,
        })
        return {"triggered": False, "reason": "nothing to build", "regions": []}
    asyncio.create_task(_run_contour_batch(req, regions))
    return {"triggered": True, "regions": regions, "count": len(regions), "force": req.force, "skip_published": req.skip_published}


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
                            headers=_tile_response_headers(hit))

    # Layer 2: local self-hosted PMTiles file (preferred)
    local_tile = await pmtiles_bootstrap.get_local_tile(upstream_z, upstream_x, upstream_y)
    if local_tile is not None:
        async with _tile_lru_lock:
            _tile_lru[key] = local_tile
            if len(_tile_lru) > _TILE_LRU_MAX:
                _tile_lru.popitem(last=False)
        return Response(local_tile, media_type="application/vnd.mapbox-vector-tile",
                        headers=_tile_response_headers(local_tile))

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
                    headers=_tile_response_headers(content))


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
    international_tasks = _international_camp_tasks(lat, lng, radius, type_filters)
    ridb, blm, active, *international_sources = await asyncio.gather(
        get_campsites_search(lat, lng, radius_miles=radius, type_filters=type_filters),
        get_blm_campsites(lat, lng, radius_miles=radius),
        get_active_campgrounds(lat, lng, radius_miles=radius, filters={"group_site": bool(type_filters and "group" in type_filters)}),
        *international_tasks,
    )
    merged = _merge_camp_sources(ridb, blm, active, *international_sources, type_filters=type_filters)
    if len(merged) < 8:
        merged = _merge_camp_sources(merged, _explore_catalog_fallback_camps(lat, lng, max(radius, 75), limit=24), type_filters=type_filters)
    return merged[:80]

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
    if detail.get("lat") and detail.get("lng") and not detail.get("mobile_coverage"):
        try:
            detail["mobile_coverage"] = await get_mobile_coverage(float(detail["lat"]), float(detail["lng"]))
        except Exception:
            pass
    if detail.get("lat") and detail.get("lng"):
        try:
            related, status, _ = await _build_place_context(float(detail["lat"]), float(detail["lng"]), "camp", camp_detail=detail)
            detail = _merge_context_rails_into_detail(detail, related, status)
        except Exception:
            detail = _merge_context_rails_into_detail(detail, {}, None)
    override = get_camp_profile_override(facility_id)
    if override:
        detail = {**detail, **override, "admin_edited": True}
    return detail

@app.get("/api/campsites/{facility_id}/sites/{campsite_id}/detail")
async def campsite_site_detail(facility_id: str, campsite_id: str):
    site_detail = await get_ridb_campsite_detail(facility_id, campsite_id)
    if site_detail:
        parent_detail = None
        try:
            parent_detail = await get_facility_detail(facility_id)
        except Exception:
            parent_detail = None
        if parent_detail:
            for key in ("things_to_do", "things_to_see", "visitor_centers", "campgrounds_nearby", "trip_services", "activities", "amenities", "site_types", "links"):
                if parent_detail.get(key) and not site_detail.get(key):
                    site_detail[key] = parent_detail.get(key)
        try:
            if site_detail.get("lat") and site_detail.get("lng"):
                site_detail["mobile_coverage"] = await get_mobile_coverage(float(site_detail["lat"]), float(site_detail["lng"]))
        except Exception:
            pass
        try:
            if site_detail.get("lat") and site_detail.get("lng"):
                related, status, _ = await _build_place_context(float(site_detail["lat"]), float(site_detail["lng"]), "camp", camp_detail=parent_detail or site_detail)
                site_detail = _merge_context_rails_into_detail(site_detail, related, status)
        except Exception:
            site_detail = _merge_context_rails_into_detail(site_detail, {}, None)
        return site_detail
    detail = await get_facility_detail(facility_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Facility not found")
    site = next(
        (
            item for item in (detail.get("campsites") or [])
            if str(item.get("id") or "") == str(campsite_id)
            or str(item.get("map_card_id") or "") == f"ridb_site:{facility_id}:{campsite_id}"
        ),
        None,
    )
    if not site:
        raise HTTPException(status_code=404, detail="Campsite not found")
    photos = site.get("photos") or detail.get("photos") or []
    return {
        **site,
        "id": f"ridb_site:{facility_id}:{campsite_id}",
        "facility_id": str(facility_id),
        "campsite_id": str(campsite_id),
        "parent_campground": {
            "id": str(facility_id),
            "name": detail.get("name"),
            "lat": detail.get("lat"),
            "lng": detail.get("lng"),
            "official_url": detail.get("official_url"),
            "booking_url": detail.get("booking_url"),
        },
        "lat": site.get("lat") if site.get("lat") is not None else detail.get("lat"),
        "lng": site.get("lng") if site.get("lng") is not None else detail.get("lng"),
        "photos": photos,
        "photo_url": site.get("photo_url") or (photos[0] if photos else detail.get("photo_url")),
        "source": "ridb",
        "verified_source": "Recreation.gov",
        "source_badge": "Official Recreation.gov",
        "reservation_notes": "Trailhead links to the official Recreation.gov campground page. Checkout stays on Recreation.gov.",
        "booking_url": detail.get("booking_url"),
        "official_url": detail.get("official_url"),
    }

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
    access_notes: Optional[str] = None
    bail_out_notes: Optional[str] = None
    stay_limit: Optional[str] = None
    reservation_notes: Optional[str] = None
    source_confidence_notes: Optional[str] = None
    max_rig_length: Optional[str] = None

class CampCacheClearPayload(BaseModel):
    scope: str = "all"
    source_prefix: Optional[str] = None
    camp_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_mi: Optional[float] = None

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

@app.post("/api/admin/cache/camps/clear")
async def admin_clear_camp_cache(body: CampCacheClearPayload, admin: dict = Depends(_require_admin)):
    scope = (body.scope or "all").strip().lower()
    prefixes: list[str] = []
    keys: list[str] = []
    gas_prefixes: list[str] = []
    gas_keys: list[str] = []
    brief_deleted = 0

    if scope == "all":
        prefixes = [
            "ridb",
            "ridb_search",
            "osm_camp",
            "osm_camps",
            "osm_detail",
            "blm_camps",
            "blm_detail",
            "google_nearby",
            "google_detail",
            "google_text",
            "google_places_nearby",
            "google_places_permission_backoff",
            "geoapify_places",
            "geoapify_permission_backoff",
            "geoapify_quota_backoff",
            "nps_",
            "blm_recreation_",
            "usfs_recreation_",
            "foursquare_search",
            "foursquare_detail",
            "foursquare_permission_backoff",
            "foursquare_quota_backoff",
            "map_card:",
            "ai_insight_",
            "wiki_",
            "trail_photo_wiki_",
            "land_check:",
            "route_camp_window:",
        ]
        gas_prefixes = [
            "nrel_",
            "osm_fuel_",
            "osm_services_",
        ]
        db = sqlite3.connect(settings.db_path, timeout=30.0)
        try:
            cur = db.execute("DELETE FROM camp_briefs")
            brief_deleted = cur.rowcount or 0
            db.commit()
        finally:
            db.close()
    elif scope == "source":
        source = (body.source_prefix or "").strip().lower()
        allowed = {"ridb", "osm", "blm", "usfs", "nps", "google", "geoapify", "foursquare", "map_card", "ai_insight", "route_weather", "wiki", "land_check", "route_camp_window"}
        if source not in allowed:
            raise HTTPException(400, f"source_prefix must be one of {', '.join(sorted(allowed))}")
        prefixes = [source]
        if source == "google":
            prefixes.extend(["google_text", "google_nearby", "google_detail", "google_places_permission_backoff"])
        if source == "geoapify":
            prefixes.extend(["geoapify_places", "geoapify_permission_backoff", "geoapify_quota_backoff"])
        if source == "foursquare":
            prefixes.extend(["foursquare_search", "foursquare_detail", "foursquare_permission_backoff", "foursquare_quota_backoff"])
        if source == "nps":
            prefixes.extend(["nps_"])
        if source == "usfs":
            prefixes.extend(["usfs_recreation_"])
        if source == "osm":
            gas_prefixes.extend(["osm_fuel_", "osm_services_"])
    elif scope == "camp_id":
        camp_id = (body.camp_id or "").strip()
        if not camp_id:
            raise HTTPException(400, "camp_id required")
        clean = camp_id.replace("ridb:", "").replace("osm:", "").replace("blm:", "")
        keys = [
            f"ridb_detail_{clean}",
            f"ridb_detail_v2_{clean}",
            f"ridb_detail_v3_{clean}",
            f"osm_detail_{clean}",
            f"blm_detail_{clean}",
            f"ai_insight_{clean}",
        ]
        prefixes = []
        db = sqlite3.connect(settings.db_path, timeout=30.0)
        try:
            cur = db.execute("DELETE FROM camp_briefs WHERE facility_id=?", (clean,))
            brief_deleted = cur.rowcount or 0
            db.commit()
        finally:
            db.close()
    elif scope == "near":
        if body.lat is None or body.lng is None:
            raise HTTPException(400, "lat and lng required")
        lat2 = f"{body.lat:.2f}"
        lng2 = f"{body.lng:.2f}"
        lat3 = f"{body.lat:.3f}"
        lng3 = f"{body.lng:.3f}"
        prefixes = [
            f"ridb_search_{lat2}_{lng2}",
            f"ridb_{lat2}_{lng2}",
            f"osm_camp_{lat2}_{lng2}",
            f"osm_camps_{lat3}_{lng3}",
            f"blm_camps_{lat3}_{lng3}",
            f"blm_camps_{lat2}_{lng2}",
            f"blm_recreation_{lat2}_{lng2}",
            f"usfs_recreation_{lat2}_{lng2}",
            f"nps_",
            f"google_nearby:{lat3}:{lng3}",
            f"geoapify_places:{lat3}:{lng3}",
            f"foursquare_search:{lat3}:{lng3}",
            f"land_check:{lat3},{lng3}",
            f"ai_insight_{lat3}_{lng3}",
            f"wiki_{lat2}_{lng2}",
        ]
        gas_prefixes = [
            f"nrel_{lat2}_{lng2}",
            f"osm_fuel_{lat2}_{lng2}",
            f"osm_services_{lat2}_{lng2}",
        ]
    else:
        raise HTTPException(400, "scope must be all, source, camp_id, or near")

    deleted = clear_cached_rows("campsite_cache", prefixes=prefixes, keys=keys)
    gas_deleted = clear_cached_rows("gas_cache", prefixes=gas_prefixes, keys=gas_keys) if gas_prefixes or gas_keys else 0
    log_event(admin["id"], None, "admin_clear_camp_cache", {"scope": scope, "prefixes": prefixes, "keys": keys, "gas_prefixes": gas_prefixes, "gas_keys": gas_keys, "deleted": deleted, "gas_deleted": gas_deleted, "brief_deleted": brief_deleted})
    return {"ok": True, "deleted": deleted, "gas_deleted": gas_deleted, "brief_deleted": brief_deleted, "scope": scope}

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
    radius_m = int(min(max(radius, 1), 45) * 1609.344)
    osm_radius_m = int(min(max(radius, 1), 25) * 1609.344)
    nrel, osm = await asyncio.gather(
        get_fuel_near(lat, lng, radius_miles=radius),
        get_fuel_stations(lat, lng, radius_m=osm_radius_m),
        return_exceptions=True,
    )
    merged: list[dict] = []
    seen = set()
    max_distance_m = float(min(max(radius, 1), 45)) * 1609.344
    for batch in (osm if isinstance(osm, list) else [], nrel if isinstance(nrel, list) else []):
        for item in batch:
            try:
                item_lat = float(item.get("lat"))
                item_lng = float(item.get("lng"))
            except Exception:
                continue
            if _haversine_m(lat, lng, item_lat, item_lng) > max_distance_m:
                continue
            item_id = str(item.get("id") or "")
            source = str(item.get("source") or "fuel")
            key = f"{source}:{item_id}" if item_id else f"{source}:{item.get('name')}:{item_lat:.4f}:{item_lng:.4f}"
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
    return merged[:100]


FUEL_PRICE_FALLBACK = 3.65
FUEL_REGION_PRICES = {
    "west": 4.45,
    "rockies": 3.55,
    "midwest": 3.35,
    "south": 3.25,
    "northeast": 3.55,
    "national": FUEL_PRICE_FALLBACK,
}
FUEL_STATE_REGION = {
    **dict.fromkeys(["CA", "OR", "WA", "NV", "AK", "HI"], "west"),
    **dict.fromkeys(["AZ", "CO", "ID", "MT", "NM", "UT", "WY"], "rockies"),
    **dict.fromkeys(["IA", "IL", "IN", "KS", "MI", "MN", "MO", "ND", "NE", "OH", "SD", "WI"], "midwest"),
    **dict.fromkeys(["AL", "AR", "FL", "GA", "KY", "LA", "MS", "NC", "OK", "SC", "TN", "TX", "VA", "WV"], "south"),
    **dict.fromkeys(["CT", "DC", "DE", "MA", "MD", "ME", "NH", "NJ", "NY", "PA", "RI", "VT"], "northeast"),
}


async def _latest_eia_regular_price() -> dict | None:
    cache_key = "fuel:eia:regular:national"
    cached = get_cached("gas_cache", cache_key, ttl_seconds=3600 * 12)
    if cached is not None:
        return cached
    params = {
        "frequency": "weekly",
        "data[0]": "value",
        "facets[series][]": "EMM_EPMR_PTE_NUS_DPG",
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "length": "1",
    }
    if settings.eia_api_key:
        params["api_key"] = settings.eia_api_key
    try:
        async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "TrailheadFuel/1.0"}) as client:
            resp = await client.get("https://api.eia.gov/v2/petroleum/pri/gnd/data/", params=params)
            resp.raise_for_status()
            row = (resp.json().get("response", {}).get("data") or [None])[0] or {}
            value = float(row.get("value"))
            if value > 0:
                payload = {
                    "price_per_gallon": round(value, 3),
                    "source": "EIA weekly regular gasoline average",
                    "confidence": "medium",
                    "updated_at": row.get("period") or datetime.now(timezone.utc).isoformat(),
                }
                set_cached("gas_cache", cache_key, payload)
                return payload
    except Exception:
        return None
    return None


@app.get("/api/fuel/estimate")
async def fuel_estimate(miles: float = 0, mpg: float = 0, states: str = "", unit: str = "imperial"):
    safe_miles = max(0.0, float(miles or 0))
    safe_mpg = max(1.0, float(mpg or 0) if mpg else 0.0)
    if safe_mpg <= 1.0:
        safe_mpg = 18.0
    route_states = [s.strip().upper() for s in states.split(",") if len(s.strip()) == 2]
    live = await _latest_eia_regular_price()
    if live:
        price = float(live["price_per_gallon"])
        source = live["source"]
        confidence = live["confidence"]
        updated_at = live["updated_at"]
    else:
        regions = [FUEL_STATE_REGION.get(s, "national") for s in route_states] or ["national"]
        price = sum(FUEL_REGION_PRICES.get(region, FUEL_PRICE_FALLBACK) for region in regions) / max(1, len(regions))
        source = "Regional fuel estimate"
        confidence = "estimated"
        updated_at = datetime.now(timezone.utc).isoformat()
    gallons = safe_miles / safe_mpg if safe_miles > 0 else 0.0
    liters = gallons * 3.785411784
    return {
        "miles": round(safe_miles, 1),
        "mpg": round(safe_mpg, 2),
        "gallons": round(gallons, 2),
        "liters": round(liters, 1),
        "estimated_cost": round(gallons * price, 2),
        "price_per_gallon": round(price, 3),
        "source": source,
        "confidence": confidence,
        "updated_at": updated_at,
        "unit": "metric" if unit == "metric" else "imperial",
    }


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

class CampCommentPayload(BaseModel):
    camp_name: str
    lat: float
    lng: float
    body: str

@app.post("/api/camps/{camp_id}/comments")
async def post_camp_comment(camp_id: str, body: CampCommentPayload,
                            user: dict = Depends(_current_user)):
    text = (body.body or "").strip()
    if len(text) < 2:
        raise HTTPException(400, "Comment is too short")
    if len(text) > 800:
        raise HTTPException(400, "Comment is too long")
    return add_camp_comment(
        camp_id=camp_id,
        camp_name=body.camp_name.strip()[:160],
        lat=body.lat,
        lng=body.lng,
        user_id=user["id"],
        username=user["username"],
        body=text,
    )

@app.get("/api/camps/{camp_id}/comments")
async def list_camp_comments(camp_id: str):
    return get_camp_comments(camp_id)


# ── Trail Profiles / Discovery ────────────────────────────────────────────────

def _clean_trail_profile_id(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.:-]", "", value or "")[:180]

TRAIL_PHOTO_ALLOWED_LICENSES = {
    "cc0", "pdm", "publicdomain", "public_domain", "by", "by-sa", "by-nc", "by-nd", "cc-by",
    "cc-by-sa", "cc-by-nc", "cc-by-nd",
}
TRAIL_PHOTO_COMMERCIAL_RESTRICTED = {"by-nc", "by-nd", "cc-by-nc", "cc-by-nd"}
PAKISTAN_BBOX = (23.5, 60.5, 37.4, 77.9)
PAKISTAN_TRAIL_FALLBACK_PHOTOS = {
    "k2": {
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/K2_8611.jpg/960px-K2_8611.jpg",
        "caption": "K2 from Concordia",
        "source_url": "https://commons.wikimedia.org/wiki/File:K2_8611.jpg",
    },
    "baltoro": {
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Baltoro_glacier_from_air.jpg/960px-Baltoro_glacier_from_air.jpg",
        "caption": "Baltoro Glacier from the air",
        "source_url": "https://commons.wikimedia.org/wiki/File:Baltoro_glacier_from_air.jpg",
    },
    "godwin-austen": {
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/K2_8611.jpg/960px-K2_8611.jpg",
        "caption": "K2 and the Godwin-Austen Glacier area",
        "source_url": "https://commons.wikimedia.org/wiki/File:K2_8611.jpg",
    },
    "rakaposhi": {
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Rakaposhi_%26_Autumn.jpg/960px-Rakaposhi_%26_Autumn.jpg",
        "caption": "Rakaposhi before autumn",
        "source_url": "https://commons.wikimedia.org/wiki/File:Rakaposhi_%26_Autumn.jpg",
    },
    "passu": {
        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Passu_Glacier.jpg/960px-Passu_Glacier.jpg",
        "caption": "Passu Glacier",
        "source_url": "https://commons.wikimedia.org/wiki/File:Passu_Glacier.jpg",
    },
}

def _pakistan_trail_fallback_photos(name: str) -> list[dict]:
    text = (name or "").lower()
    key = ""
    if "godwin" in text:
        key = "godwin-austen"
    elif "baltoro" in text or "gondogoro" in text:
        key = "baltoro"
    elif "rakaposhi" in text:
        key = "rakaposhi"
    elif "passu" in text:
        key = "passu"
    elif "k2" in text or "concordia" in text:
        key = "k2"
    data = PAKISTAN_TRAIL_FALLBACK_PHOTOS.get(key)
    if not data:
        return []
    return [{
        **data,
        "credit": "Wikimedia Commons",
        "source": "Wikimedia Commons",
        "provider": "wikimedia",
        "license": "Wikimedia Commons",
        "commercial_restricted": False,
    }]

def _trail_catalog_from_profile(profile: dict) -> dict:
    provenance = profile.get("provenance") if isinstance(profile.get("provenance"), dict) else {}
    catalog = provenance.get("catalog") if isinstance(provenance.get("catalog"), dict) else {}
    return catalog

def _trail_geometry_ref(profile: dict) -> str:
    catalog = _trail_catalog_from_profile(profile)
    ref = str(catalog.get("geometry_ref") or "").strip()
    if ref:
        return ref[:220]
    source = str(profile.get("source") or "trail").strip() or "trail"
    return _clean_trail_profile_id(f"{source}:{profile.get('id') or profile.get('name') or ''}")[:220]

def _trail_route_type(profile: dict) -> str:
    catalog = _trail_catalog_from_profile(profile)
    value = str(catalog.get("route_type") or "").strip()
    if value:
        return value[:80]
    geometry = profile.get("geometry") or {}
    features = geometry.get("features") if isinstance(geometry, dict) else []
    if features:
        coords = (((features[0] or {}).get("geometry") or {}).get("coordinates") or [])
        if isinstance(coords, list) and len(coords) >= 3 and coords[0] == coords[-1]:
            return "Loop"
    name = str(profile.get("name") or "").lower()
    if "loop" in name:
        return "Loop"
    if any(term in name for term in ("out and back", "out-and-back")):
        return "Out and back"
    return "Point or route"

def _trail_feature_label(feature_type: str) -> str:
    text = str(feature_type or "").replace("_", " ").strip().title()
    if text == "Trek":
        return "Trek"
    if text == "Glacier":
        return "Glacier"
    if text == "Pass":
        return "Pass"
    if text == "Base Camp":
        return "Base camp"
    if text == "Trailhead":
        return "Trailhead"
    return text or "Trail"

def _point_in_pakistan(lat: float, lng: float) -> bool:
    min_lat, min_lng, max_lat, max_lng = PAKISTAN_BBOX
    return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng

def _trail_difficulty_label(profile: dict) -> str:
    value = str(profile.get("difficulty") or "").strip()
    if value:
        return value[:80]
    length = profile.get("length_mi")
    try:
        miles = float(length)
    except Exception:
        return "Scout first"
    if miles >= 8:
        return "Hard"
    if miles >= 3:
        return "Moderate"
    return "Easy"

def _trail_source_pack(profile: dict) -> dict:
    catalog = _trail_catalog_from_profile(profile)
    sources = list(catalog.get("sources") or [])
    official = str(profile.get("official_url") or catalog.get("official_url") or "").strip()
    if official:
        sources.append({
            "title": profile.get("source_label") or "Official trail source",
            "publisher": profile.get("source_label") or profile.get("source") or "Trail source",
            "url": official,
            "kind": "official" if str(profile.get("source") or "").lower() in {"nps", "usfs", "blm", "ridb"} else "open",
        })
    if str(profile.get("source_label") or "").lower().startswith("openstreetmap"):
        sources.append({
            "title": "OpenStreetMap feature",
            "publisher": "OpenStreetMap contributors",
            "url": official or "",
            "kind": "geometry",
        })
    return {
        "quality": catalog.get("quality") or ("official" if official and profile.get("source") != "osm" else "open"),
        "primary": profile.get("source_label") or "Open trail data",
        "official_url": official,
        "sources": sources,
        "photos": profile.get("photos") or [],
        "license": catalog.get("license") or "",
        "geometry_ref": _trail_geometry_ref(profile),
        "source_note": catalog.get("source_note") or "Trailhead combines open map data, official sources, and attributed media where available.",
    }

def _public_trail_profile(profile: dict) -> dict:
    out = dict(profile)
    catalog = _trail_catalog_from_profile(out)
    out["route_type"] = _trail_route_type(out)
    out["difficulty"] = _trail_difficulty_label(out)
    out["geometry_ref"] = _trail_geometry_ref(out)
    out["area_id"] = catalog.get("area_id") or ""
    out["area_name"] = catalog.get("area_name") or ""
    out["elevation_gain_ft"] = catalog.get("elevation_gain_ft")
    out["best_season"] = catalog.get("best_season") or ""
    out["warnings"] = catalog.get("warnings") or []
    out["feature_type"] = catalog.get("feature_type") or "trail"
    out["feature_label"] = _trail_feature_label(out["feature_type"])
    out["trekking_only"] = bool(catalog.get("trekking_only"))
    out["guide_required"] = bool(catalog.get("guide_required"))
    out["permit_note"] = catalog.get("permit_note") or ""
    out["glacier_crossing"] = bool(catalog.get("glacier_crossing"))
    out["altitude_ft"] = catalog.get("altitude_ft")
    out["season_window"] = catalog.get("season_window") or out["best_season"]
    out["source_confidence"] = catalog.get("source_confidence") or ""
    out["route_target"] = catalog.get("route_target") or None
    out["source_pack"] = _trail_source_pack(out)
    return out

def _trail_profile_to_explore_card(profile: dict) -> dict:
    public = _public_trail_profile(profile)
    photos = public.get("photos") or []
    first_photo = next((p for p in photos if isinstance(p, dict) and p.get("url")), {})
    return {
        "id": public.get("id"),
        "trail_id": public.get("id"),
        "title": public.get("name") or "Trail",
        "difficulty": public.get("difficulty") or "Scout first",
        "feature_type": public.get("feature_type") or "trail",
        "feature_label": public.get("feature_label") or "Trail",
        "trekking_only": bool(public.get("trekking_only")),
        "guide_required": bool(public.get("guide_required")),
        "permit_note": public.get("permit_note") or "",
        "glacier_crossing": bool(public.get("glacier_crossing")),
        "altitude_ft": public.get("altitude_ft"),
        "season_window": public.get("season_window") or "",
        "route_target": public.get("route_target"),
        "distance_mi": float(public.get("length_mi") or 0),
        "route_type": public.get("route_type") or "Point or route",
        "elevation_gain_ft": public.get("elevation_gain_ft"),
        "typical_time": public.get("typical_time") or "",
        "area": public.get("area_name") or public.get("land_manager") or "",
        "image_url": first_photo.get("url") or "",
        "image_credit": first_photo.get("credit") or first_photo.get("source") or "",
        "image_license": first_photo.get("license") or "",
        "summary": public.get("summary") or "Mapped trail feature with Trailhead scouting context.",
        "description": public.get("description") or public.get("summary") or "",
        "best_season": public.get("best_season") or "",
        "tags": [str(a).title() for a in (public.get("activities") or [])[:4]],
        "highlights": [h for h in [
            public.get("feature_label") or "",
            "Trekking-only" if public.get("trekking_only") else "",
            "Guide required" if public.get("guide_required") else "",
            "Glacier context" if public.get("feature_type") == "glacier" or public.get("glacier_crossing") else "",
            "Map geometry available" if public.get("geometry") or public.get("geometry_ref") else "",
            public.get("source_label") or "",
            "Photo source credited" if first_photo else "",
        ] if h],
        "lat": public.get("lat"),
        "lng": public.get("lng"),
        "source_url": public.get("official_url") or "",
        "source_label": public.get("source_label") or "",
        "source_pack": public.get("source_pack") or {},
        "geometry_ref": public.get("geometry_ref") or "",
        "photos": photos,
    }

def _trail_area_from_profiles(lat: float, lng: float, radius: float, profiles: list[dict]) -> dict:
    public_profiles = [_public_trail_profile(p) for p in profiles]
    is_pakistan = _point_in_pakistan(lat, lng)
    title = "Northern Pakistan Treks" if is_pakistan else "Nearby Trail Area"
    if public_profiles:
        managers = [str(p.get("land_manager") or "").strip() for p in public_profiles if p.get("land_manager")]
        if is_pakistan:
            title = "Northern Pakistan Treks"
        elif managers:
            title = managers[0]
        else:
            title = f"Trails near {public_profiles[0].get('name') or 'this stop'}"
    photos = []
    for profile in public_profiles:
        photos.extend([p for p in profile.get("photos") or [] if isinstance(p, dict) and p.get("url")])
    now = int(time.time())
    return {
        "id": _clean_trail_profile_id(f"trail-area:{lat:.4f}:{lng:.4f}:{radius:.0f}"),
        "summary": {
            "title": title,
            "explore_group": "trails",
            "category": "trails",
            "state": "",
            "region": "Gilgit-Baltistan" if is_pakistan else "Nearby",
            "lat": lat,
            "lng": lng,
            "rank": 1,
            "hero_rank": 1,
            "tags": ["treks", "glaciers", "pakistan", "karakoram"] if is_pakistan else ["trails", "hiking", "trailheads"],
            "hook": "Trek and glacier cards for northern Pakistan." if is_pakistan else "Trail cards built from open map data and attributed sources.",
            "short_description": "Compare trek, glacier, base-camp, staging, permit, and guide context." if is_pakistan else "Compare trail distance, route type, map context, and source-backed photos near this stop.",
            "image_url": (photos[0] or {}).get("url") if photos else "",
            "image_credit": (photos[0] or {}).get("credit") if photos else "",
        },
        "card": {
            "title": title,
            "headline": "Trek and glacier options near this stop" if is_pakistan else "Trail options near this stop",
            "summary": "Trailhead groups northern Pakistan trek, glacier, and staging records into one map-ready card list." if is_pakistan else "Trailhead groups nearby trail records into one map-ready card list.",
            "highlight": "Route to staging points and verify permits, guide, glacier, bridge, weather, and local safety." if is_pakistan else "Open a trail to route to it or highlight it on the map.",
            "region": "Gilgit-Baltistan" if is_pakistan else "Nearby",
        },
        "category": "trails",
        "subcategories": ["treks", "glaciers", "base camps", "map"] if is_pakistan else ["trailheads", "hiking", "map"],
        "quality": "open",
        "search_aliases": ["pakistan treks", "karakoram", "k2", "baltoro", "hunza", "glaciers"] if is_pakistan else ["trails nearby", "hiking trails", "trailheads"],
        "trails": [_trail_profile_to_explore_card(p) for p in public_profiles],
        "profile": {
            "hook": "Northern Pakistan trek and glacier planning leads." if is_pakistan else "Trail cards near your selected map area.",
            "summary": "Use these as planning leads and verify permits, guide requirements, glacier, bridge, road, weather, and local safety before committing." if is_pakistan else "Use these as scouting leads and verify current access before committing.",
            "why_it_matters": "Karakoram trek planning needs staging towns, guide/permit context, glacier awareness, and conservative routing." if is_pakistan else "Nearby trail context helps choose stops, detours, and camp windows.",
            "what_to_know": "These are mixed-source planning leads; glacier and trek data is informational, not a safety assessment." if is_pakistan else "Open-source records can miss closures, permits, seasonal access, and local restrictions.",
            "best_time_to_stop": "Check season, weather, daylight, permits, and local advice before starting." if is_pakistan else "Check daylight, weather, and trail status before starting.",
            "access_notes": "Route to the listed staging point; do not treat trek or glacier lines as vehicle navigation." if is_pakistan else "Route to the listed trailhead or open the map highlight for geometry context.",
            "nearby_context": "Use support towns, camps, fuel, weather, and safety alerts before relying on a trek stop." if is_pakistan else "Use nearby camps, weather, fuel, and water before relying on a trail stop.",
        },
        "audio_script": "",
        "wiki_extract": "",
        "source_pack": {
            "quality": "open",
            "primary": "Trailhead northern Pakistan trek catalog" if is_pakistan else "Trailhead trail catalog",
            "sources": [
                {"title": "Gilgit-Baltistan Tourism", "publisher": "Government of Gilgit-Baltistan", "url": "https://visitgilgitbaltistan.gov.pk/", "kind": "official_context"},
                {"title": "OpenStreetMap trail and glacier data", "publisher": "OpenStreetMap contributors", "kind": "geometry"},
                {"title": "RGI 7.0 glacier outlines", "publisher": "NSIDC / GLIMS", "url": "https://www.glims.org/RGI/", "kind": "glacier_reference"},
            ] if is_pakistan else [{"title": "OpenStreetMap trail data", "publisher": "OpenStreetMap contributors", "kind": "geometry"}],
            "photos": photos[:12],
            "source_note": "Mixed-source northern Pakistan planning leads. Verify all access, permits, guide requirements, glacier, bridge, weather, and local safety conditions." if is_pakistan else "Generated from open map records and enriched with credited media where available.",
        },
        "facts": {"coordinates": f"{lat:.5f}, {lng:.5f}", "source_quality": "open", "last_updated": now},
        "attribution": "Gilgit-Baltistan official context, OpenStreetMap contributors, RGI/GLIMS glacier reference, and credited media sources." if is_pakistan else "Open map data and credited media sources.",
    }

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
        "catalog": {
            "route_type": "Point or route",
            "geometry_ref": trail_id,
            "quality": "open",
            "source_note": "Seeded from open map data; verify current trail status with the land manager.",
        },
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

def _trail_profile_from_pakistan_trek(item: dict) -> dict | None:
    try:
        lat = float(item.get("lat"))
        lng = float(item.get("lng"))
    except Exception:
        return None
    if not _point_in_pakistan(lat, lng):
        return None
    name = re.sub(r"\s+", " ", str(item.get("name") or "Pakistan trek")).strip()[:180]
    if not name:
        return None
    feature_type = str(item.get("feature_type") or item.get("type") or "trek").strip() or "trek"
    source_id = _clean_trail_profile_id(f"pk:{feature_type}:{name.lower().replace(' ', '-')}")
    now = int(time.time())
    route_lat = item.get("route_lat")
    route_lng = item.get("route_lng")
    route_target = None
    try:
        if route_lat is not None and route_lng is not None:
            route_target = {
                "name": str(item.get("route_name") or "Staging point")[:140],
                "lat": float(route_lat),
                "lng": float(route_lng),
                "reason": "Route to the staging point; verify the trek or glacier approach locally.",
            }
    except Exception:
        route_target = None
    tags = [str(tag).strip() for tag in (item.get("tags") or []) if str(tag).strip()]
    warnings = list(item.get("warnings") or [])
    if item.get("trekking_only") and not any("vehicle" in warning.lower() for warning in warnings):
        warnings.append("Trekking-only feature; do not treat as vehicle navigation.")
    if item.get("glacier_crossing") and not any("glacier" in warning.lower() for warning in warnings):
        warnings.append("Verify glacier, bridge, weather, and local safety conditions.")
    summary = str(item.get("summary") or "Northern Pakistan trek and glacier planning lead.").strip()
    official_url = str(item.get("official_url") or "https://visitgilgitbaltistan.gov.pk/")
    catalog = {
        "feature_type": feature_type,
        "route_type": item.get("route_type") or ("Glacier feature" if feature_type == "glacier" else "Trek"),
        "geometry_ref": source_id,
        "area_id": _clean_trail_profile_id(f"pk:{str(item.get('area_name') or 'karakoram').lower().replace(' ', '-')}"),
        "area_name": item.get("area_name") or "Gilgit-Baltistan",
        "best_season": item.get("best_season") or "",
        "season_window": item.get("season_window") or item.get("best_season") or "",
        "altitude_ft": item.get("altitude_ft"),
        "trekking_only": bool(item.get("trekking_only", True)),
        "guide_required": bool(item.get("guide_required")),
        "permit_note": item.get("permit_note") or "Verify permits, guide requirements, and current local access before committing.",
        "glacier_crossing": bool(item.get("glacier_crossing")),
        "route_target": route_target,
        "warnings": warnings,
        "source_confidence": "mixed_curated",
        "quality": "mixed_curated",
        "official_url": official_url,
        "sources": [
            {"title": "Gilgit-Baltistan Tourism", "publisher": "Government of Gilgit-Baltistan", "url": "https://visitgilgitbaltistan.gov.pk/", "kind": "official_context"},
            {"title": "OpenStreetMap Pakistan extract", "publisher": "OpenStreetMap contributors / Geofabrik", "url": "https://download.geofabrik.de/asia/pakistan.html", "kind": "open_map_reference"},
            {"title": "RGI 7.0 glacier outlines", "publisher": "NSIDC / GLIMS", "url": "https://www.glims.org/RGI/", "kind": "glacier_reference"},
        ],
        "source_note": "Mixed-source northern Pakistan trek/glacier planning lead. Verify permits, guide, glacier, bridge, weather, road, and local safety conditions.",
    }
    return {
        "id": source_id,
        "name": name,
        "summary": summary[:800],
        "description": (
            str(item.get("description") or summary).strip()
            + " Verify permits, guide requirements, glacier, bridge, weather, road, and local safety conditions before relying on this record."
        )[:6000],
        "lat": lat,
        "lng": lng,
        "length_mi": item.get("length_mi"),
        "difficulty": str(item.get("difficulty") or ("Guide required" if item.get("guide_required") else "Trekking lead"))[:80],
        "activities": ["Trekking", "Hiking", "Glacier context"] if feature_type == "glacier" else ["Trekking", "Hiking"],
        "land_manager": "Gilgit-Baltistan / local authorities",
        "geometry": None,
        "trailheads": [route_target] if route_target else [{"name": name, "lat": lat, "lng": lng, "source": "Trailhead curated"}],
        "official_url": official_url,
        "photos": [],
        "source": "pakistan_karakoram_curated",
        "source_label": "Trailhead mixed Pakistan sources",
        "provenance": {
            "name": {"source": "Trailhead curated Pakistan/Karakoram seed", "last_checked": now},
            "location": {"source": "Trailhead curated from OSM and official destination context", "last_checked": now},
            "summary": {"source": "Trailhead curated safety-first trek catalog", "last_checked": now},
            "catalog": catalog,
            "tags": tags,
        },
        "last_checked": now,
    }

async def _seed_pakistan_trek_profiles(lat: float, lng: float, radius_mi: float, limit: int = 80) -> list[dict]:
    if not _point_in_pakistan(lat, lng):
        return []
    profiles: list[dict] = []
    seen: set[str] = set()
    for item in get_pakistan_curated_treks(lat, lng, radius_miles=max(radius_mi, 50)):
        profile = _trail_profile_from_pakistan_trek(item)
        if not profile or profile["id"] in seen:
            continue
        photos = await _open_trail_photos(profile["name"], profile["lat"], profile["lng"])
        if not photos:
            photos = _pakistan_trail_fallback_photos(profile["name"])
        if photos:
            profile["photos"] = photos
            profile["provenance"]["photos"] = {"source": "Wikipedia / Wikimedia Commons / Openverse", "last_checked": profile["last_checked"]}
        seen.add(profile["id"])
        profiles.append(_public_trail_profile(upsert_trail_profile(profile)))
        if len(profiles) >= limit:
            break
    return profiles

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
                    "gsrsearch": f'"{clean}"',
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
                    "provider": "wikimedia",
                    "license": "Wikimedia Commons",
                    "source_url": page.get("fullurl") or "",
                    "commercial_restricted": False,
                }]
                set_cached("campsite_cache", cache_key, photos)
                return photos
    except Exception:
        pass
    photos = await _openverse_trail_photos(clean, lat, lng)
    set_cached("campsite_cache", cache_key, photos)
    return photos

async def _openverse_trail_photos(name: str, lat: float, lng: float) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=7.0, headers={"User-Agent": "TrailheadTrailDiscovery/1.0"}) as client:
            res = await client.get(
                "https://api.openverse.engineering/v1/images/",
                params={
                    "q": name,
                    "page_size": 3,
                    "license": ",".join(sorted(TRAIL_PHOTO_ALLOWED_LICENSES)),
                },
            )
            if res.status_code >= 400:
                return []
            results = (res.json() or {}).get("results") or []
    except Exception:
        return []
    photos: list[dict] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = item.get("url") or item.get("thumbnail")
        if not url:
            continue
        license_code = str(item.get("license") or "").lower().strip()
        photos.append({
            "url": url,
            "thumbnail_url": item.get("thumbnail") or url,
            "caption": item.get("title") or name,
            "credit": item.get("creator") or item.get("source") or "Openverse",
            "source": item.get("source") or "Openverse",
            "provider": "openverse",
            "license": license_code or "cc",
            "source_url": item.get("foreign_landing_url") or item.get("url") or "",
            "commercial_restricted": license_code in TRAIL_PHOTO_COMMERCIAL_RESTRICTED,
            "lat": lat,
            "lng": lng,
        })
        if len(photos) >= 3:
            break
    return photos

async def _seed_open_trail_profiles(lat: float, lng: float, radius_mi: float, limit: int = 80) -> list[dict]:
    radius_m = int(max(3, min(radius_mi, 80)) * 1609.344)
    pakistan_profiles = await _seed_pakistan_trek_profiles(lat, lng, radius_mi, limit=limit)
    batches = await asyncio.gather(
        get_trails(lat, lng, radius_m=radius_m),
        get_trailheads(lat, lng, radius_m=radius_m),
        get_viewpoints(lat, lng, radius_m=radius_m),
        get_peaks(lat, lng, radius_m=radius_m),
        get_hot_springs(lat, lng, radius_m=radius_m),
        return_exceptions=True,
    )
    profiles: list[dict] = list(pakistan_profiles)
    seen: set[str] = {str(p.get("id")) for p in profiles}
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
            profiles.append(_public_trail_profile(upsert_trail_profile(profile)))
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
    trails = [_public_trail_profile(p) for p in list_trail_profiles_near(float(lat), float(lng), radius, max(1, min(limit, 100)), bbox=bbox, mode=mode)]
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
    profile = _public_trail_profile(profile)
    profile["field_report_summary"] = get_trail_field_report_summary(profile["id"])
    return profile

@app.get("/api/trail-areas/discover")
async def trail_area_discover(lat: float, lng: float, radius: float = 45, limit: int = 24):
    radius = max(3.0, min(float(radius), 80.0))
    limit = max(1, min(int(limit), 60))
    await _seed_open_trail_profiles(float(lat), float(lng), radius, limit=max(limit, 80))
    profiles = list_trail_profiles_near(float(lat), float(lng), radius, limit)
    return {"area": _trail_area_from_profiles(float(lat), float(lng), radius, profiles)}

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

class CommunityTrailPayload(BaseModel):
    name: str
    summary: Optional[str] = None
    description: Optional[str] = None
    geometry: dict
    trailheads: list[dict] = Field(default_factory=list)
    activities: list[str] = Field(default_factory=list)
    difficulty: Optional[str] = None
    land_manager: Optional[str] = None
    photos: list[dict] = Field(default_factory=list)
    source_note: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None

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

@app.post("/api/trails/community")
async def submit_community_trail(body: CommunityTrailPayload, user: dict = Depends(_current_user)):
    name = re.sub(r"\s+", " ", (body.name or "").strip())[:140]
    if not name:
        raise HTTPException(400, "Trail name is required")
    geometry = body.geometry if isinstance(body.geometry, dict) else {}
    coords = geometry.get("coordinates") if geometry.get("type") == "LineString" else None
    if not isinstance(coords, list) or len(coords) < 2:
        raise HTTPException(400, "Trail geometry must be a LineString with at least two points")
    clean_coords: list[list[float]] = []
    for pair in coords[:2000]:
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        lng, lat = float(pair[0]), float(pair[1])
        if -180 <= lng <= 180 and -90 <= lat <= 90:
            clean_coords.append([round(lng, 7), round(lat, 7)])
    if len(clean_coords) < 2:
        raise HTTPException(400, "Trail geometry has no valid coordinates")
    length_m = 0.0
    for idx in range(1, len(clean_coords)):
        a, b = clean_coords[idx - 1], clean_coords[idx]
        length_m += _haversine_m(a[1], a[0], b[1], b[0])
    mid = clean_coords[len(clean_coords) // 2]
    trail_id = _clean_trail_profile_id(f"trailhead:{user['id']}:{uuid.uuid4().hex[:12]}")
    clean_trailheads = []
    for item in body.trailheads[:8]:
        if not isinstance(item, dict):
            continue
        try:
            th_lat = float(item.get("lat"))
            th_lng = float(item.get("lng"))
        except Exception:
            continue
        if -90 <= th_lat <= 90 and -180 <= th_lng <= 180:
            clean_trailheads.append({
                "name": str(item.get("name") or "Trailhead").strip()[:120],
                "lat": round(th_lat, 7),
                "lng": round(th_lng, 7),
                "role": str(item.get("role") or "access").strip()[:40],
            })
    profile = upsert_trail_profile({
        "id": trail_id,
        "name": name,
        "summary": (body.summary or f"Community trail route submitted by {user.get('username') or 'a Trailhead user'}.").strip()[:700],
        "description": (body.description or body.source_note or "User-pinned route. Verify legality, closures, and conditions before driving.").strip()[:4000],
        "lat": float(body.lat) if body.lat is not None else mid[1],
        "lng": float(body.lng) if body.lng is not None else mid[0],
        "length_mi": round(length_m / 1609.344, 2),
        "difficulty": (body.difficulty or "Unrated").strip()[:80],
        "activities": [str(a).strip()[:40] for a in body.activities[:12] if str(a).strip()] or ["overland", "trail"],
        "land_manager": (body.land_manager or "Verify locally").strip()[:180],
        "geometry": {"type": "FeatureCollection", "features": [{
            "type": "Feature",
            "properties": {"name": name, "source": "Trailhead community"},
            "geometry": {"type": "LineString", "coordinates": clean_coords},
        }]},
        "trailheads": clean_trailheads,
        "official_url": None,
        "photos": body.photos[:12],
        "source": "trailhead",
        "source_label": "Trailhead community",
        "provenance": {
            "submitted_by": user.get("username"),
            "submitted_by_id": user.get("id"),
            "source_note": (body.source_note or "").strip()[:500],
            "review_status": "community",
        },
        "last_checked": int(time.time()),
        "admin_edited": False,
        "updated_at": int(time.time()),
    })
    credits_earned = 5
    add_credits(user["id"], credits_earned, f"Community trail: {name[:80]}")
    fresh = get_user_by_id(user["id"])
    return {"ok": True, "profile": profile, "credits_earned": credits_earned, "new_balance": fresh["credits"] if fresh else user.get("credits", 0)}

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
    "camp", "informal_camp", "wild_camp", "private_stay", "fuel", "propane", "water", "dump",
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
    "fuel", "service", "viewpoint", "traffic", "weather", "fire", "smoke",
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

def _community_alert(report: dict) -> dict:
    alert = dict(report)
    alert.setdefault("source", "trailhead")
    alert.setdefault("provider", None)
    alert.setdefault("provider_id", str(alert.get("id")))
    alert.setdefault("confidence", 0.75 + min(float(alert.get("confirmations") or 0), 5) * 0.04)
    alert.setdefault("updated_at", alert.get("created_at"))
    alert.setdefault("road_name", None)
    return alert

def _severity_rank(alert: dict) -> int:
    return {"critical": 4, "high": 3, "moderate": 2, "low": 1}.get(str(alert.get("severity")), 0)

def _dedupe_sort_alerts(alerts: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for alert in alerts:
        key = str(alert.get("id") or f"{alert.get('provider')}:{alert.get('provider_id')}")
        if key in seen:
            continue
        seen.add(key)
        out.append(alert)
    out.sort(
        key=lambda a: (
            -_severity_rank(a),
            float(a.get("route_distance_m") if a.get("route_distance_m") is not None else 9e9),
            -int(a.get("updated_at") or a.get("created_at") or 0),
        )
    )
    return out

async def _provider_alerts_near(lat: float, lng: float, radius_deg: float) -> list[dict]:
    return await get_provider_conditions_near(lat, lng, radius_deg)

async def _provider_alerts_along_route(waypoints: list[dict], radius_deg: float = 0.12) -> list[dict]:
    return await get_provider_conditions_along_route(waypoints, radius_deg)

@app.post("/api/reports/along-route")
async def route_reports(body: RouteReportRequest):
    """Return active reports within ~10km of any route waypoint."""
    return get_reports_along_route(body.waypoints, radius_deg=0.12)

@app.get("/api/alerts/nearby")
async def nearby_alerts(lat: float, lng: float, radius: float = 0.5):
    """Return community reports plus server-side live condition alerts."""
    community = [_community_alert(r) for r in get_reports_near(lat, lng, radius_deg=radius)]
    provider = await _provider_alerts_near(lat, lng, radius)
    return _dedupe_sort_alerts([*community, *provider])

@app.post("/api/alerts/along-route")
async def route_alerts(body: RouteReportRequest):
    """Return active community and live condition alerts within ~10km of route waypoints."""
    community = [_community_alert(r) for r in get_reports_along_route(body.waypoints, radius_deg=0.12)]
    provider = await _provider_alerts_along_route(body.waypoints, radius_deg=0.12)
    return _dedupe_sort_alerts([*community, *provider])

@app.get("/api/conditions/nearby")
async def nearby_conditions(lat: float, lng: float, radius: float = 0.5):
    """Unified live conditions feed for map panels and navigation."""
    return await nearby_alerts(lat, lng, radius)

@app.post("/api/conditions/along-route")
async def route_conditions(body: RouteReportRequest):
    """Unified live conditions feed along active route waypoints."""
    return await route_alerts(body)

@app.post("/api/route-confidence/pakistan")
async def pakistan_confidence(body: RouteReportRequest):
    """Conservative Pakistan road/trek confidence until OSM segment scoring is live."""
    return pakistan_route_confidence(body.waypoints)

@app.get("/api/conditions/fire-perimeters")
async def fire_perimeters():
    """Cached WFIGS active fire perimeters for map overlays."""
    data = await get_wfigs_fire_perimeters()
    return data or {"type": "FeatureCollection", "features": []}

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
<p>We collect information you provide directly: email address, username, and password (stored as a bcrypt hash). If you use Apple or Google sign in, we store the verified email address and provider account identifier needed to keep you signed in. When you use the app we collect location data (with your permission) to show nearby campsites, fuel stations, and community reports. We collect usage data such as trips planned, reports submitted, and credits earned or spent.</p>

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

@app.get("/api/admin/provider-calls")
async def admin_provider_calls(limit: int = 100, admin: dict = Depends(_require_admin)):
    return provider_call_snapshot(limit)

@app.get("/api/admin/users")
async def admin_users(search: str = "", limit: int = 50, offset: int = 0,
                      admin: dict = Depends(_require_admin)):
    return get_all_users(search, limit, offset)

@app.get("/api/admin/extreme")
async def admin_extreme(admin: dict = Depends(_require_admin)):
    since = int(time.time()) - 86400
    recent_events = list_extreme_ledger_events(200)
    debug_event_types = {
        "copilot_admin_debug_snapshot",
        "copilot_selection_guard_failed",
        "copilot_selection_resolved",
        "copilot_candidates_resolved",
        "copilot_query_region_started",
    }
    return {
        "config": _extreme_config_for_user(admin),
        "env": {
            "enabled": bool(settings.extreme_enabled),
            "kill_switch": bool(settings.extreme_kill_switch),
            "allowed_surfaces": _extreme_allowed_surfaces(),
            "beta_user_ids": [v for v in (settings.extreme_beta_user_ids or "").split(",") if v.strip()],
            "beta_emails": [v for v in (settings.extreme_beta_emails or "").split(",") if v.strip()],
        },
        "summary_24h": get_extreme_ledger_summary(since),
        "recent_sessions": list_extreme_sessions(50),
        "recent_events": recent_events[:100],
        "debug_events": [event for event in recent_events if event.get("event_type") in debug_event_types][:40],
    }

@app.post("/api/admin/extreme/config")
async def admin_update_extreme_config(body: AdminExtremeConfigBody, admin: dict = Depends(_require_admin)):
    values = _admin_extreme_config_values(body)
    if not values:
        raise HTTPException(400, "No Extreme config values provided")
    overrides = set_extreme_admin_config(values, admin.get("id"))
    log_event(admin["id"], None, "admin_extreme_config_update", {"keys": sorted(values.keys())})
    return {
        "ok": True,
        "overrides": {k: v for k, v in overrides.items() if not str(k).startswith("_")},
        "config": _extreme_config_for_user(admin),
    }

@app.post("/api/admin/extreme/grant")
async def admin_extreme_grant(body: AdminExtremeGrantBody, admin: dict = Depends(_require_admin)):
    plan = (body.plan_type or "extreme_beta").strip().lower()
    if plan not in {"extreme_beta", "extreme"}:
        raise HTTPException(400, "plan_type must be extreme_beta or extreme")
    target = get_user_by_id(body.user_id) if body.user_id else None
    if not target and body.email:
        target = get_user_by_email(body.email.strip().lower())
    if not target:
        raise HTTPException(404, "User not found")
    days = min(max(int(body.duration_days or 366), 1), 3660)
    expires_at = int(time.time()) + days * 86400
    updated = set_user_plan(target["id"], plan, expires_at)
    log_event(admin["id"], None, "admin_extreme_beta_grant", {
        "target_user_id": target["id"],
        "plan_type": plan,
        "expires_at": expires_at,
    })
    return {"ok": True, "user": updated, "plan_type": plan, "plan_expires_at": expires_at}

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

@app.post("/api/admin/push-campaigns/preview")
async def admin_push_campaign_preview(body: AdminPushCampaignBody,
                                      admin: dict = Depends(_require_admin)):
    audience = body.audience.model_dump()
    if body.test_only:
        recipients = [row for row in get_push_campaign_recipients(audience, limit=25) if int(row.get("is_admin") or 0) == 1]
        count = len([row for row in get_push_campaign_recipients(audience) if int(row.get("is_admin") or 0) == 1])
    else:
        count = count_push_campaign_recipients(audience)
        recipients = get_push_campaign_recipients(audience, limit=5)
    campaign_type, deeplink, payload = _normalize_admin_push_payload(body)
    return {
        "ok": True,
        "campaign_type": campaign_type,
        "deeplink": deeplink,
        "payload": payload,
        "audience": audience,
        "estimated_recipients": count,
        "sample_recipients": [
            {
                "id": row["id"],
                "username": row["username"],
                "email": row["email"],
                "plan_type": row["plan_type"],
                "credits": row["credits"],
                "is_admin": bool(row["is_admin"]),
            }
            for row in recipients
        ],
    }

@app.post("/api/admin/push-campaigns/send")
async def admin_push_campaign_send(body: AdminPushCampaignBody,
                                   admin: dict = Depends(_require_admin)):
    if not body.title.strip():
        raise HTTPException(400, "Title is required")
    if not body.body.strip():
        raise HTTPException(400, "Body is required")
    result = await _send_admin_push_campaign(body, admin)
    return {"ok": True, **result}

@app.get("/api/admin/push-campaigns")
async def admin_push_campaign_list(admin: dict = Depends(_require_admin)):
    return {"campaigns": list_push_campaigns(60)}

@app.get("/api/admin/push-campaigns/{campaign_id}")
async def admin_push_campaign_detail(campaign_id: int,
                                     admin: dict = Depends(_require_admin)):
    campaign = get_push_campaign(campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    return campaign

@app.get("/api/admin/support/threads")
async def admin_support_threads(search: str = "", status: str = "",
                                admin: dict = Depends(_require_admin)):
    return {"threads": list_support_threads_admin(status.strip() or None, search.strip(), 200)}

@app.get("/api/admin/support/threads/{thread_id}")
async def admin_support_thread_detail(thread_id: int,
                                      admin: dict = Depends(_require_admin)):
    thread = get_support_thread(thread_id, admin=True)
    if not thread:
        raise HTTPException(404, "Thread not found")
    return thread

@app.post("/api/admin/support/threads/start")
async def admin_support_thread_start(body: AdminSupportThreadCreateBody,
                                     admin: dict = Depends(_require_admin)):
    message = body.body.strip()
    subject = body.subject.strip()
    if not subject:
        raise HTTPException(400, "Subject is required")
    if not message:
        raise HTTPException(400, "Message body is required")
    target = get_user_by_id(body.user_id)
    if not target:
        raise HTTPException(404, "User not found")
    thread_id = create_support_thread(
        user_id=body.user_id,
        subject=subject,
        category=(body.category or "support").strip().lower()[:60] or "support",
        opened_by="admin",
        initial_body=message,
        admin_id=admin["id"],
    )
    push_token = get_push_token(body.user_id)
    if push_token:
        await _send_expo_push(
            push_token,
            title="Trailhead support message",
            body_text=subject[:140],
            data={"type": "admin_campaign", "deeplink": "/(tabs)/profile?support=1", "support_thread_id": thread_id},
        )
    log_event(admin["id"], None, "admin_support_thread_start", {"thread_id": thread_id, "target_user_id": body.user_id, "category": body.category})
    return {"ok": True, "thread_id": thread_id}

@app.post("/api/admin/support/threads/{thread_id}/message")
async def admin_support_thread_message(thread_id: int, body: AdminSupportThreadMessageBody,
                                       admin: dict = Depends(_require_admin)):
    text = body.body.strip()
    if not text:
        raise HTTPException(400, "Message body is required")
    thread = get_support_thread(thread_id, admin=True)
    if not thread:
        raise HTTPException(404, "Thread not found")
    message = add_support_message(thread_id, "admin", text, admin_id=admin["id"])
    if not message:
        raise HTTPException(404, "Thread not found")
    if body.close_after_send:
        update_support_thread_status(thread_id, "closed")
    push_token = get_push_token(int(thread["user_id"]))
    if push_token:
        await _send_expo_push(
            push_token,
            title="New Trailhead message",
            body_text=text[:140],
            data={"type": "admin_campaign", "deeplink": "/(tabs)/profile?support=1", "support_thread_id": thread_id},
        )
    log_event(admin["id"], None, "admin_support_thread_message", {"thread_id": thread_id, "close_after_send": body.close_after_send})
    return {"ok": True, "message": message}

@app.post("/api/admin/support/threads/{thread_id}/status")
async def admin_support_thread_status(thread_id: int, body: dict,
                                      admin: dict = Depends(_require_admin)):
    status = str(body.get("status", "")).strip().lower()
    if status not in {"open", "closed"}:
        raise HTTPException(400, "Status must be open or closed")
    thread = get_support_thread(thread_id, admin=True)
    if not thread:
        raise HTTPException(404, "Thread not found")
    update_support_thread_status(thread_id, status)
    log_event(admin["id"], None, "admin_support_thread_status", {"thread_id": thread_id, "status": status})
    return {"ok": True, "status": status}

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
    if plan not in {"free", "explorer", "extreme_beta", "extreme"}:
        raise HTTPException(400, "plan_type must be free, explorer, extreme_beta, or extreme")
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    expires_at = None
    if plan in {"explorer", "extreme_beta", "extreme"}:
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
    category: Optional[str] = "bug"
    source_surface: Optional[str] = ""
    screenshot_data: Optional[str] = None
    screenshot_content_type: Optional[str] = "image/jpeg"
    ai_context: Optional[dict] = None

@app.post("/api/bugs")
async def submit_bug(body: BugReportPayload, user: dict = Depends(_current_user)):
    if not body.title.strip() or not body.description.strip():
        raise HTTPException(400, "Title and description are required.")
    category = str(body.category or "bug").strip().lower()
    if category not in {"bug", "offensive"}:
        raise HTTPException(400, "Invalid bug category.")
    bug_id = submit_bug_report(
        user_id=user["id"], username=user["username"],
        title=body.title.strip(), description=body.description.strip(),
        app_version=body.app_version or "",
        category=category,
        source_surface=str(body.source_surface or "").strip()[:40],
        screenshot_data=(body.screenshot_data or "")[:4_000_000],
        screenshot_content_type=str(body.screenshot_content_type or "image/jpeg")[:80],
        ai_context=body.ai_context or None,
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

_CAMP_CHILD_SITE_RE = re.compile(r"\b(group\s+site|site|loop|campsite|camp\s*site|area|unit)\s*#?\s*[a-z0-9-]+\b", re.I)

def _camp_cluster_name(value: object) -> str:
    name = re.sub(r"\s+", " ", str(value or "").lower()).strip()
    name = re.sub(r"\([^)]*\)", " ", name)
    name = _CAMP_CHILD_SITE_RE.sub(" ", name)
    name = re.sub(r"\b(group|standard|tent|rv|primitive|walk[- ]?in|drive[- ]?in|single|double|site|loop|area|unit)\b", " ", name)
    return re.sub(r"[^a-z0-9]+", "", name)[:42]

def _camp_source_rank(camp: dict) -> int:
    source = str(camp.get("source") or camp.get("verified_source") or "").lower()
    verified = str(camp.get("verified_source") or "").lower()
    if any(v in source or v in verified for v in ("ridb", "recreation.gov", "nps")):
        return 0
    if "blm" in source or "blm" in verified:
        return 1
    if "active" in source or "reserveamerica" in verified:
        return 2
    if any(v in source or v in verified for v in (
        "nz_doc", "department of conservation", "australia_open_data",
        "canada_open_data", "government open data", "open data",
    )):
        return 2
    if "osm" in source or "openstreetmap" in verified:
        return 3
    if _legacy_place_source(source) or _legacy_place_source(verified):
        return 5
    return 4

def _camp_distance_m(a: dict, b: dict) -> float:
    try:
        return _haversine_m(float(a.get("lat")), float(a.get("lng")), float(b.get("lat")), float(b.get("lng")))
    except Exception:
        return 999999.0

def _merge_camp_record(existing: dict, incoming: dict) -> dict:
    primary, secondary = (incoming, existing) if _camp_source_rank(incoming) < _camp_source_rank(existing) else (existing, incoming)
    merged = dict(primary)
    secondary_paid = _legacy_place_source(secondary.get("source"))
    merged["alternate_sources"] = sorted(set([
        *(existing.get("alternate_sources") or []),
        *(incoming.get("alternate_sources") or []),
        str(existing.get("verified_source") or existing.get("source") or "").strip(),
        str(incoming.get("verified_source") or incoming.get("source") or "").strip(),
    ]) - {""})
    merge_keys = ("url", "phone", "address", "provider_place_id", "place_id") if secondary_paid else ("photo_url", "description", "url", "phone", "address", "rating", "rating_count", "provider_place_id", "place_id")
    for key in merge_keys:
        if not merged.get(key):
            merged[key] = secondary.get(key)
    merged_tags = sorted(set((existing.get("tags") or []) + (incoming.get("tags") or [])))
    if merged_tags:
        merged["tags"] = merged_tags
    if not secondary_paid and not merged.get("photos") and secondary.get("photos"):
        merged["photos"] = secondary.get("photos")
    if not secondary_paid and not merged.get("reviews") and secondary.get("reviews"):
        merged["reviews"] = secondary.get("reviews")
    return merged

PRIVATE_STAY_PLACE_TYPES = {"private_stay", "farm_stay", "ranch", "winery", "glamping", "private_camp"}
PRIVATE_STAY_FILTERS = {"private", "private_stay", "farm", "farm_stay", "ranch", "winery", "glamping", "private_camp"}

def _private_stay_only_place_request(categories: set[str]) -> bool:
    normalized = {_normalize_place_category(c) for c in categories if str(c).strip()}
    return bool(normalized) and normalized.issubset(PRIVATE_STAY_PLACE_TYPES | {"private"})

def _private_stay_place_types_for_request(categories: set[str]) -> set[str]:
    normalized = {_normalize_place_category(c) for c in categories if str(c).strip()}
    if normalized.intersection({"private", "private_stay"}):
        return set(PRIVATE_STAY_PLACE_TYPES)
    return normalized.intersection(PRIVATE_STAY_PLACE_TYPES)

def _private_stay_place_type(item: dict) -> str:
    return _smart_pack_type(item.get("type") or item.get("category"))

def _private_stay_requested(type_filters: list[str] | None = None) -> bool:
    return bool({str(t or "").lower().strip() for t in (type_filters or [])}.intersection(PRIVATE_STAY_FILTERS))

def _private_stay_categories_for_filters(type_filters: list[str] | None = None) -> set[str]:
    filters = {str(t or "").lower().strip() for t in (type_filters or [])}
    if not filters.intersection(PRIVATE_STAY_FILTERS):
        return set()
    categories = {"private_stay", "private_camp"}
    if "farm" in filters or "farm_stay" in filters or "private" in filters:
        categories.add("farm_stay")
    if "ranch" in filters or "private" in filters:
        categories.add("ranch")
    if "winery" in filters or "private" in filters:
        categories.add("winery")
    if "glamping" in filters or "private" in filters:
        categories.add("glamping")
    return categories

def _private_stay_label(place_type: str, text: str = "") -> str:
    value = f"{place_type} {text}".lower()
    if "winery" in value or "vineyard" in value:
        return "Winery Stay"
    if "ranch" in value:
        return "Ranch Stay"
    if "glamping" in value or "yurt" in value or "cabin" in value:
        return "Glamping"
    if "farm" in value:
        return "Farm Stay"
    return "Private Camp"

def _merge_camp_sources(*sources: list[dict], type_filters: list[str] | None = None) -> list[dict]:
    seen_ids: set[str] = set()
    merged: list[dict] = []
    for source in sources:
        for camp in source:
            if type_filters and not _camp_matches_filters(camp, type_filters):
                continue
            camp_id = str(camp.get("id") or "")
            if camp_id in seen_ids:
                continue
            seen_ids.add(camp_id)
            cluster_name = _camp_cluster_name(camp.get("name"))
            replaced = False
            for idx, existing in enumerate(merged):
                same_named_cluster = cluster_name and cluster_name == _camp_cluster_name(existing.get("name")) and _camp_distance_m(camp, existing) <= 260
                same_site_cluster = _camp_distance_m(camp, existing) <= 220 and (
                    cluster_name == _camp_cluster_name(existing.get("name")) or
                    re.search(r"\b(group\s+site|site|loop|area)\b", str(camp.get("name") or ""), re.I) or
                    re.search(r"\b(group\s+site|site|loop|area)\b", str(existing.get("name") or ""), re.I)
                )
                if same_named_cluster or same_site_cluster:
                    merged[idx] = _merge_camp_record(existing, camp)
                    replaced = True
                    break
            if not replaced:
                merged.append(camp)
    return sorted(merged, key=_camp_source_rank)

def _camp_from_live_place(place: dict) -> dict | None:
    """Convert provider campground/private-stay results into overnight pins."""
    try:
        lat = float(place.get("lat"))
        lng = float(place.get("lng"))
    except Exception:
        return None
    name = re.sub(r"\s+", " ", str(place.get("name") or "")).strip()
    if not name:
        return None
    source = str(place.get("source") or "places").lower()
    subtype = str(place.get("subtype") or "").strip()
    place_type = str(place.get("type") or "").lower()
    type_text = f"{subtype} {place_type}".lower()
    is_private_stay = place_type in PRIVATE_STAY_PLACE_TYPES
    if place_type != "camp" and not is_private_stay:
        return None
    non_camp = ("college", "university", "school", "campus", "summer camp", "boot camp", "training camp")
    campish = ("campground", "camp ground", "campsite", "camp site", "rv park", "recreational vehicle", "caravan")
    combined = f"{name} {type_text} {place.get('address') or ''}".lower()
    if any(term in combined for term in non_camp):
        return None
    if not is_private_stay and not any(term in combined for term in campish):
        return None
    tags = ["commercial", "campground"]
    if is_private_stay:
        tags.extend(["private", "private_stay", place_type])
        if place_type == "farm_stay":
            tags.append("farm")
        land_type = _private_stay_label(place_type, combined)
    else:
        land_type = "RV Park" if "rv" in type_text else "Commercial Campground"
    if "rv" in type_text and not is_private_stay:
        tags.append("rv")
    else:
        tags.append("tent")
    amenities: list[str] = []
    if any(term in combined for term in ("hookup", "electric", "electrical")):
        amenities.append("Hookups" if "hookup" in combined else "Electric")
    if "shower" in combined:
        amenities.append("Showers")
    if any(term in combined for term in ("restroom", "toilet")):
        amenities.append("Restrooms")
    if "dump" in combined:
        amenities.append("Dump station")
    return {
        "id": str(place.get("id") or f"{source}:camp:{lat:.5f}:{lng:.5f}"),
        "name": name,
        "lat": lat,
        "lng": lng,
        "tags": tags,
        "land_type": land_type,
        "description": _planner_clean_text(place.get("summary") or place.get("address") or subtype or f"{land_type} found from available place data. Confirm access and overnight rules before relying on it.", 360),
        "photo_url": place.get("photo_url") or "",
        "reservable": False,
        "cost": "",
        "url": place.get("website") or place.get("google_maps_uri") or "",
        "ada": False,
        "source": source,
        "source_tier": "",
        "verified_source": place.get("source_label") or place.get("attribution") or source.title(),
        "phone": place.get("phone") or "",
        "address": place.get("address") or "",
        "provider_place_id": place.get("provider_place_id") or place.get("place_id") or "",
        "place_id": place.get("place_id") or "",
        "source_badge": place.get("source_label") or place.get("attribution") or source.title(),
        "source_confidence": "review",
        "link_label": "Official page",
        "rich_detail_available": False,
        "rich_detail_locked": False,
        "rich_detail_reason": "",
        "amenities": amenities,
        "site_types": [land_type] if is_private_stay else (["RV"] if "rv" in tags else ["Tent", "Campground"]),
    }

def _international_camp_tasks(lat: float, lng: float, radius: float, type_filters: list[str] | None) -> list:
    return international_camp_tasks(lat, lng, radius, type_filters)

async def _aggregate_nearby_camps(lat: float, lng: float, radius: float = 50, types: str = "") -> list[dict]:
    type_filters = [t.strip() for t in types.split(",") if t.strip()] if types else None
    private_stay_categories = _private_stay_categories_for_filters(type_filters)
    active_filters = {
        "group_site": bool(type_filters and "group" in type_filters),
        "rv": bool(type_filters and "rv" in type_filters),
        "tent": bool(type_filters and "tent" in type_filters),
    }
    international_tasks = _international_camp_tasks(lat, lng, radius, type_filters)
    ridb, blm, osm, active, hosted_private, *international_sources = await asyncio.gather(
        get_campsites_search(lat, lng, radius_miles=radius, type_filters=type_filters),
        get_blm_campsites(lat, lng, radius_miles=radius),
        get_osm_campsites(lat, lng, radius_m=int(min(radius, 60) * 1600)),
        get_active_campgrounds(lat, lng, radius_miles=radius, filters=active_filters),
        get_geoapify_places(lat, lng, radius_m=int(min(radius, 45) * 1609.344), categories=private_stay_categories, limit_per_category=12) if private_stay_categories else asyncio.sleep(0, result=[]),
        *international_tasks,
    )
    hosted_camps = [_camp_from_live_place(place) for place in hosted_private if isinstance(place, dict)]
    merged = _merge_camp_sources(ridb, blm, osm, active, [c for c in hosted_camps if c], *international_sources, type_filters=type_filters)
    if len(merged) < 10:
        merged = _merge_camp_sources(merged, _explore_catalog_fallback_camps(lat, lng, max(radius, 75), limit=32), type_filters=type_filters)
    return merged[:160]


@app.get("/api/nearby-camps")
async def nearby_camps(lat: float, lng: float, radius: float = 50, types: str = ""):
    """Aggregate legal camp sources near a point, no trip required."""
    return await _aggregate_nearby_camps(lat, lng, radius, types)


def _route_points_from_body(route: list[dict]) -> list[dict]:
    points: list[dict] = []
    for item in route or []:
        try:
            lat = float(item.get("lat"))
            lng = float(item.get("lng"))
        except Exception:
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            points.append({"lat": lat, "lng": lng})
    return points

def _route_distance_mi(points: list[dict]) -> float:
    total = 0.0
    for a, b in zip(points, points[1:]):
        total += _haversine_m(a["lat"], a["lng"], b["lat"], b["lng"]) / 1609.344
    return total

def _route_points_from_any(route: object, limit: int = 400) -> list[dict]:
    points: list[dict] = []
    if not isinstance(route, list):
        return points
    for item in route[:limit]:
        lat = lng = None
        day = None
        if isinstance(item, dict):
            try:
                lat = float(item.get("lat"))
                lng = float(item.get("lng"))
                day = item.get("day")
            except Exception:
                continue
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            try:
                lng = float(item[0])
                lat = float(item[1])
            except Exception:
                continue
        if lat is None or lng is None:
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            point = {"lat": lat, "lng": lng}
            if day is not None:
                point["day"] = day
            points.append(point)
    return points

def _route_scout_window_plan(days: int, total_miles: float) -> list[dict]:
    safe_days = max(2, min(30, int(round(float(days or 2)))))
    total = max(0.1, float(total_miles or 0))
    overnight_count = max(1, safe_days - 1)
    day_span = total / safe_days
    windows: list[dict] = []
    for idx in range(overnight_count):
        day = idx + 1
        target = day_span * day
        search_window = max(28.0, min(85.0, day_span * 0.72))
        windows.append({
            "day": day,
            "start": round(max(0.0, target - search_window * 0.5), 2),
            "end": round(min(total, target + search_window * 0.5), 2),
            "label": f"Day {day} overnight",
            "target_mi": round(target, 2),
            "search_window_mi": round(search_window, 2),
        })
    return windows

def _point_at_route_mile(points: list[dict], target_mi: float) -> dict | None:
    if not points:
        return None
    if len(points) == 1 or target_mi <= 0:
        return points[0]
    travelled = 0.0
    for a, b in zip(points, points[1:]):
        seg = _haversine_m(a["lat"], a["lng"], b["lat"], b["lng"]) / 1609.344
        if travelled + seg >= target_mi:
            t = 0 if seg <= 0 else max(0.0, min(1.0, (target_mi - travelled) / seg))
            return {"lat": a["lat"] + (b["lat"] - a["lat"]) * t, "lng": a["lng"] + (b["lng"] - a["lng"]) * t}
        travelled += seg
    return points[-1]

def _route_window_samples(points: list[dict], target_mi: float, window_mi: float, max_samples: int = 6) -> list[dict]:
    if not points:
        return []
    total = _route_distance_mi(points)
    start = max(0.0, target_mi - window_mi / 2)
    end = min(total, target_mi + window_mi / 2)
    if max_samples <= 1 or end <= start:
        target = _point_at_route_mile(points, target_mi)
        return [target] if target else []
    out: list[dict] = []
    for idx in range(max_samples):
        mile = start + (end - start) * (idx / (max_samples - 1))
        point = _point_at_route_mile(points, mile)
        if point:
            out.append(point)
    deduped: list[dict] = []
    seen: set[str] = set()
    for point in out:
        key = f"{point['lat']:.4f},{point['lng']:.4f}"
        if key not in seen:
            seen.add(key)
            deduped.append(point)
    return deduped

NORTHEAST_PUBLIC_CAMP_FALLBACK_STATES = {
    "ct", "de", "ma", "md", "me", "nh", "nj", "ny", "pa", "ri", "vt",
}


def _public_camp_supply_limited(region_hint: str = "") -> bool:
    hint = re.sub(r"[^a-z, ]+", " ", (region_hint or "").lower())
    tokens = {t.strip() for t in re.split(r"[, ]+", hint) if t.strip()}
    return bool(tokens.intersection(NORTHEAST_PUBLIC_CAMP_FALLBACK_STATES) or "northeast" in tokens or "newengland" in tokens or {"new", "england"}.issubset(tokens))


def _camp_pref_score(camp: dict, route_style: str = "balanced", camp_preference: str = "public", region_hint: str = "") -> float:
    combined = " ".join(str(v or "") for v in [
        camp.get("name"),
        camp.get("land_type"),
        camp.get("source"),
        camp.get("verified_source"),
        camp.get("cost"),
        " ".join(camp.get("tags") or []),
        " ".join(camp.get("amenities") or []),
        " ".join(camp.get("site_types") or []),
    ]).lower()
    style = "wild" if str(route_style).lower() in {"wild", "adventure"} else str(route_style or "balanced").lower()
    preference = str(camp_preference or "public").lower()
    limited_public = _public_camp_supply_limited(region_hint)
    public = any(term in combined for term in ("blm", "usfs", "national forest", "forest service", "public", "dispersed", "primitive", "free"))
    official_developed = any(term in combined for term in ("ridb", "recreation.gov", "nps", "state park", "county park", "municipal"))
    rv_private = any(term in combined for term in ("rv park", "rv resort", "koa", "hookup", "electric", "private campground"))
    private_stay = any(term in combined for term in ("private_stay", "private stay", "farm stay", "ranch stay", "winery stay", "vineyard", "glamping", "private camp"))
    score = 0.0
    if preference == "rv":
        score += -12 if rv_private else 5
        score += -4 if camp.get("reservable") else 0
    elif preference == "private":
        score += -16 if private_stay else 8
        score += -4 if any(term in combined for term in ("farm", "ranch", "winery", "vineyard", "glamping")) else 0
        score += 6 if public else 0
    elif preference == "developed":
        score += -10 if official_developed else 0
        score += -4 if public else 0
        score += -4 if private_stay and limited_public else 0
        score += 2 if rv_private else 0
    elif preference == "any":
        score += -5 if public or official_developed else 0
        score += 3 if rv_private and not limited_public else 0
    else:
        score += -14 if public else 4
        score += -5 if official_developed and limited_public else 0
        score += (12 if limited_public else 26) if rv_private else 0
        score += 8 if private_stay and not limited_public else 0
    if style == "wild":
        score += -8 if public else 5
        score += (18 if limited_public else 30) if rv_private else 0
        score += 8 if camp.get("reservable") else 0
    elif style == "direct":
        score += 3 if public and not camp.get("reservable") else 0
        score += -2 if camp.get("reservable") else 0
    if camp.get("rating"):
        try:
            score -= min(float(camp.get("rating")), 5.0)
        except Exception:
            pass
    return score

def _camp_text(camp: dict) -> str:
    return " ".join(str(v or "") for v in [
        camp.get("name"),
        camp.get("land_type"),
        camp.get("source"),
        camp.get("verified_source"),
        camp.get("cost"),
        " ".join(camp.get("tags") or []),
        " ".join(camp.get("amenities") or []),
        " ".join(camp.get("site_types") or []),
        camp.get("description"),
    ]).lower()

def _camp_matches_filters(camp: dict, type_filters: list[str]) -> bool:
    if not type_filters:
        return True
    text = _camp_text(camp)
    tags = {str(t or "").lower() for t in camp.get("tags") or []}
    for raw in type_filters:
        f = str(raw or "").lower().strip()
        if not f:
            continue
        if f in tags or f in text:
            return True
        if f in {"private", "private_stay", "farm", "farm_stay", "ranch", "winery", "glamping", "private_camp"} and any(term in text for term in ("private_stay", "private stay", "farm stay", "farm", "ranch", "winery", "vineyard", "glamping", "private camp")):
            return True
        if f in {"public", "blm", "usfs", "dispersed", "free"} and any(term in text for term in ("blm", "usfs", "national forest", "forest service", "public", "dispersed", "primitive", "free")):
            return True
        if f in {"hut", "huts", "shelter", "refuge", "bothy", "alpine_hut", "wilderness_hut", "walk_in", "walk-in"} and any(term in text for term in ("hut", "shelter", "refuge", "bothy", "alpine hut", "wilderness hut", "walk in", "walk-in", "backcountry", "trekking lodge", "guest house", "guesthouse")):
            return True
        if f in {"trek", "trekking", "trail", "trails", "basecamp", "base_camp", "base camp"} and any(term in text for term in ("trek", "trekking", "trail", "base camp", "basecamp", "karakoram", "k2")):
            return True
        if f in {"lodging", "lodge", "guesthouse", "guest_house", "hostel", "chalet"} and any(term in text for term in ("lodging", "lodge", "guest house", "guesthouse", "hostel", "chalet", "trekking lodge")):
            return True
        if f == "tent" and not any(term in text for term in ("rv resort", "koa", "hookup-only")):
            return True
        if f == "reservable" and any(term in text for term in ("reservable", "reservation", "recreation.gov", "state park", "nps", "national park")):
            return True
    return False

def _route_fit_label(route_distance: float) -> str:
    if route_distance <= 5:
        return "on_route"
    if route_distance <= 18:
        return "short_detour"
    if route_distance <= 38:
        return "detour"
    return "review"

def _camp_source_confidence(camp: dict) -> str:
    explicit = str(camp.get("source_confidence") or "").lower().strip()
    if explicit in {"high", "medium", "low", "review", "mixed", "official"}:
        return "high" if explicit == "official" else explicit
    source = f"{camp.get('source') or ''} {camp.get('verified_source') or ''}".lower()
    if any(term in source for term in ("ridb", "recreation.gov", "nps", "blm")):
        return "high"
    if any(term in source for term in ("osm", "openstreetmap")):
        return "medium"
    return "review"

def _camp_has_media(camp: dict) -> bool:
    if camp.get("photo_url") or camp.get("hero_photo_url") or camp.get("primary_image") or camp.get("image_url"):
        return True
    photos = camp.get("photos") or camp.get("photo_candidates") or camp.get("images") or []
    return isinstance(photos, list) and any(bool(photo.get("url") if isinstance(photo, dict) else photo) for photo in photos)

def _camp_overnight_style(camp: dict | None) -> str:
    text = _camp_text(camp or {})
    if any(term in text for term in ("dispersed", "primitive", "boondock", "public land", "blm", "usfs", "forest service", "free")):
        return "dispersed"
    if any(term in text for term in ("rv park", "rv resort", "koa", "hookup", "electric")):
        return "rv"
    if any(term in text for term in ("private stay", "farm stay", "ranch stay", "winery stay", "glamping", "private camp")):
        return "private"
    if any(term in text for term in ("recreation.gov", "ridb", "state park", "national park", "county park", "campground")):
        return "developed"
    return "unknown"

def _camp_name_needs_review(name: str | None) -> bool:
    clean = re.sub(r"\s+", " ", str(name or "")).strip().lower()
    if not clean:
        return True
    return clean in {"camp", "campground", "campsite", "site", "rv park", "park", "overnight option"}

def _camp_display_name(camp: dict | None, label: str) -> str:
    name = re.sub(r"\s+", " ", str((camp or {}).get("name") or "")).strip()
    if _camp_name_needs_review(name):
        style = _camp_overnight_style(camp)
        if style == "dispersed":
            return f"{label} dispersed review area"
        if style == "rv":
            return f"{label} RV review area"
        if style == "private":
            return f"{label} private stay review area"
        return f"{label} review area"
    return name

def _route_window_fit_notes(camp: dict | None, require_photos: bool = False) -> list[str]:
    if not isinstance(camp, dict):
        return []
    notes: list[str] = []
    route_fit = str(camp.get("route_fit") or "").strip().replace("_", " ")
    route_distance = camp.get("route_distance_mi")
    endpoint_distance = camp.get("endpoint_distance_mi")
    if route_fit:
        notes.append(route_fit)
    if isinstance(route_distance, (int, float)):
        notes.append(f"{float(route_distance):.1f} mi off route")
    elif isinstance(endpoint_distance, (int, float)):
        notes.append(f"{float(endpoint_distance):.1f} mi from the overnight window")
    if require_photos:
        notes.append("photo-backed" if _camp_has_media(camp) else "no photos yet")
    if camp.get("reservable"):
        notes.append("reservable")
    source_confidence = str(camp.get("source_confidence") or "").strip().lower()
    if source_confidence in {"high", "medium"}:
        notes.append(f"{source_confidence} source confidence")
    deduped: list[str] = []
    for note in notes:
        clean = re.sub(r"\s+", " ", str(note or "")).strip()
        if clean and clean not in deduped:
            deduped.append(clean)
    return deduped[:4]

async def _select_camp_for_window(
    window: RouteCampWindow,
    points: list[dict],
    type_filters: list[str],
    max_radius: float,
    total_mi: float,
    sem: asyncio.Semaphore,
    route_style: str = "balanced",
    camp_preference: str = "public",
    require_photos: bool = False,
    region_hint: str = "",
) -> dict:
    label = window.label or (f"Day {window.day}" if window.start == window.end else f"Days {window.start}-{window.end}")
    target = _point_at_route_mile(points, window.target_mi) or points[min(len(points) - 1, max(0, window.day - 1))]
    samples = _route_window_samples(points, window.target_mi, max(12.0, window.search_window_mi), max_samples=6)
    base_radius = max(24.0, min(max_radius, window.search_window_mi * 0.75))
    filter_key = sorted(type_filters)
    pass_defs: list[dict] = []
    if type_filters:
        pass_defs.append({"name": "preferred", "filters": type_filters, "radius": base_radius, "strict": True})
        pass_defs.append({"name": "preferred_wide", "filters": [], "radius": min(max_radius, max(base_radius * 1.25, 45.0)), "strict": False})
    pass_defs.append({"name": "any_legal", "filters": [], "radius": min(max_radius, max(base_radius * 1.55, 58.0)), "strict": False})
    if route_style == "wild" or str(camp_preference or "").lower() == "public":
        pass_defs.append({"name": "wide_review", "filters": [], "radius": min(max(max_radius, 82.0), max(base_radius * 1.9, 72.0)), "strict": False})
    pass_defs.append({"name": "target_review", "filters": [], "radius": min(120.0, max(max_radius, base_radius * 2.2, 105.0)), "strict": False, "target_only": True})
    key_payload = {
        "v": 9,
        "route": [[round(p["lat"], 3), round(p["lng"], 3)] for p in samples],
        "window": [window.day, window.start, window.end, round(window.target_mi, 1), round(window.search_window_mi, 1)],
        "filters": filter_key,
        "style": route_style,
        "camp_preference": camp_preference,
        "require_photos": require_photos,
        "region_hint": region_hint,
        "passes": [(p["name"], round(float(p["radius"])), bool(p.get("target_only"))) for p in pass_defs],
    }
    cache_key = "route_camp_window:" + hashlib.sha1(json.dumps(key_payload, sort_keys=True).encode()).hexdigest()[:24]
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24)
    if cached is not None:
        cached["cache_status"] = "hit"
        return cached
    try:
        by_key: dict[str, dict] = {}
        search_passes: list[dict] = []
        for pass_def in pass_defs:
            radius = float(pass_def["radius"])
            filters = list(pass_def["filters"])
            pass_samples = [target] if pass_def.get("target_only") else samples
            async with sem:
                results = await asyncio.gather(*[
                    asyncio.wait_for(nearby_camps(sample["lat"], sample["lng"], radius, ",".join(filters)), timeout=8.0)
                    for sample in pass_samples
                ], return_exceptions=True)
            found = _merge_camp_sources(*[r for r in results if isinstance(r, list)], type_filters=filters or None)
            kept = 0
            for camp in found:
                if pass_def["strict"] and not _camp_matches_filters(camp, type_filters):
                    continue
                has_media = _camp_has_media(camp)
                if require_photos and not has_media:
                    continue
                try:
                    route_distance = min(_haversine_m(float(camp["lat"]), float(camp["lng"]), s["lat"], s["lng"]) / 1609.344 for s in samples)
                    endpoint_distance = _haversine_m(float(camp["lat"]), float(camp["lng"]), target["lat"], target["lng"]) / 1609.344
                except Exception:
                    continue
                preferred_match = _camp_matches_filters(camp, type_filters)
                camp = {
                    **camp,
                    "route_distance_mi": round(route_distance, 2),
                    "route_fit": _route_fit_label(route_distance),
                    "route_progress": round(window.target_mi / total_mi, 4) if total_mi > 0 else 0,
                    "route_progress_mi": round(window.target_mi, 1),
                    "endpoint_distance_mi": round(endpoint_distance, 2),
                    "recommended_day": window.day,
                    "search_pass": pass_def["name"],
                    "source_confidence": _camp_source_confidence(camp),
                    "preference_match": preferred_match,
                    "has_photos": has_media,
                }
                score = (
                    endpoint_distance * (0.62 if route_style != "direct" else 0.82)
                    + route_distance * (0.78 if route_style == "direct" else 0.95)
                    + _camp_pref_score(camp, route_style, camp_preference, region_hint)
                    + (-8 if has_media else 0)
                    + (0 if preferred_match or not type_filters else 14)
                    + (0 if pass_def["name"] in {"preferred", "preferred_wide"} else 6 if pass_def["name"] == "any_legal" else 12)
                )
                camp["_score"] = round(score, 3)
                key = _camp_merge_key(camp)
                if key not in by_key or float(camp["_score"]) < float(by_key[key].get("_score", 999999)):
                    by_key[key] = camp
                    kept += 1
            search_passes.append({"name": pass_def["name"], "radius_mi": round(radius, 1), "filters": filters, "found": len(found), "kept": kept, "target_only": bool(pass_def.get("target_only"))})
            if len(by_key) >= 18 and (pass_def["name"] == "preferred" or not type_filters):
                break
        scored = sorted(by_key.values(), key=lambda c: float(c.get("_score", 999999)))
        candidates = [{k: v for k, v in camp.items() if k != "_score"} for camp in scored[:18]]
        best = candidates[0] if candidates else None
        best_route_distance = float(best.get("route_distance_mi") if best.get("route_distance_mi") is not None else 999) if best else 999
        best_endpoint_distance = float(best.get("endpoint_distance_mi") if best.get("endpoint_distance_mi") is not None else 999) if best else 999
        preferred_best = bool(best and (best.get("preference_match") or not type_filters))
        display_name = _camp_display_name(best, label)
        display_name_needs_review = _camp_name_needs_review(display_name) or display_name.lower().endswith("review area")
        strong = bool(
            best
            and best_route_distance <= 28
            and best_endpoint_distance <= 55
            and (preferred_best or str(camp_preference or "").lower() == "any")
            and not display_name_needs_review
        )
        confidence = "strong" if strong else "review" if best else "missing"
        coverage_status = "ready" if strong else "review" if best else "sparse"
        overnight_style = _camp_overnight_style(best)
        fit_notes = _route_window_fit_notes(best, require_photos=require_photos)
        reason = (
            f"{display_name} fits this overnight window with a short detour."
            if strong else
            f"{display_name} is the best photo-backed overnight option here."
            if require_photos and not best else
            f"{display_name} is the best legal overnight option here. Review the fit before navigation."
            if best else
            f"No overnight is locked for {label.lower()} yet. Keep it as a review stop or choose a camp manually."
        )
        reason_short = (
            f"Locked {display_name}."
            if strong else
            f"Review {display_name} before you commit."
            if best else
            f"{label} still needs an overnight."
        )
        response = {
            "day": window.day,
            "start": window.start,
            "end": window.end,
            "label": label,
            "target_mi": window.target_mi,
            "search_window_mi": window.search_window_mi,
            "camp": best,
            "selected": best,
            "candidates": candidates,
            "fallback": None if best else {"lat": target["lat"], "lng": target["lng"], "name": f"{label} review area", "description": "Review this day. Choose an overnight stop before navigation."},
            "strong": strong,
            "confidence": confidence,
            "coverage_status": coverage_status,
            "reason": reason,
            "reason_short": reason_short,
            "display_name": display_name,
            "overnight_kind": "camp" if best else "review",
            "overnight_style": overnight_style if best else "unknown",
            "fallback_label": f"{label} review area",
            "fit_notes": fit_notes,
            "search_radius_mi": max((p["radius_mi"] for p in search_passes), default=round(base_radius, 1)),
            "search_passes": search_passes,
            "found": len(candidates),
            "cache_status": "miss",
        }
    except Exception as exc:
        response = {
            "day": window.day,
            "start": window.start,
            "end": window.end,
            "label": label,
            "target_mi": window.target_mi,
            "search_window_mi": window.search_window_mi,
            "camp": None,
            "selected": None,
            "candidates": [],
            "fallback": {"lat": target["lat"], "lng": target["lng"], "name": f"{label} review area", "description": "Review this day. Choose an overnight stop before navigation."},
            "strong": False,
            "confidence": "missing",
            "coverage_status": "sparse",
            "reason": "Overnight search failed for this day.",
            "reason_short": f"{label} still needs an overnight.",
            "display_name": f"{label} review area",
            "overnight_kind": "review",
            "overnight_style": "unknown",
            "fallback_label": f"{label} review area",
            "fit_notes": [],
            "search_radius_mi": round(base_radius, 1),
            "search_passes": [],
            "found": 0,
            "cache_status": "error",
            "error": str(exc),
        }
    set_cached("campsite_cache", cache_key, response)
    return response

@app.post("/api/route/camp-windows")
async def route_camp_windows(body: RouteCampWindowsRequest):
    points = _route_points_from_body(body.route)
    if len(points) < 2:
        raise HTTPException(400, "At least two route points are required")
    windows = body.windows[:30]
    if not windows:
        return {"windows": [], "errors": {}}
    total_mi = _route_distance_mi(points)
    sem = asyncio.Semaphore(3)
    type_filters = [str(t).strip() for t in body.camp_filters if str(t).strip()]
    route_style = "wild" if (body.route_style or "").lower() in {"wild", "adventure"} else (body.route_style or "balanced").lower()
    results = await asyncio.gather(*[
        _select_camp_for_window(
            window,
            points,
            type_filters,
            max(25.0, min(float(body.max_radius or 58), 120.0)),
            total_mi,
            sem,
            route_style=route_style,
            camp_preference=body.camp_preference,
            require_photos=body.require_photos,
            region_hint=body.region_hint,
        )
        for window in windows
    ], return_exceptions=True)
    out: list[dict] = []
    errors: dict[str, str] = {}
    for idx, result in enumerate(results):
        if isinstance(result, Exception):
            errors[str(windows[idx].day)] = str(result)
        else:
            out.append(result)
    return {"windows": out, "errors": errors}


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


def _planner_clean_text(value: object, max_chars: int = 700) -> str:
    raw = str(value or "")
    if not raw:
        return ""
    raw = re.sub(r"<\s*(br|p|div|li|h[1-6])[^>]*>", " ", raw, flags=re.I)
    raw = re.sub(r"<[^>]+>", " ", raw)
    text = html.unescape(raw)
    text = re.sub(r"\b(overview|about)\s*(overview|about)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_chars:
        text = text[:max_chars].rsplit(" ", 1)[0].rstrip() + "..."
    return text

def _planner_route_samples(route: list[list[float]], max_samples: int = 5) -> list[dict]:
    coords: list[dict] = []
    for point in route:
        try:
            lng, lat = float(point[0]), float(point[1])
        except Exception:
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            coords.append({"lat": lat, "lng": lng})
    if len(coords) <= max_samples:
        return coords
    step = max(1, (len(coords) - 1) // (max_samples - 1))
    sampled = [coords[0], *coords[step:-1:step][: max_samples - 2], coords[-1]]
    return sampled[:max_samples]

def _planner_dedupe(items: list[dict], limit: int = 180) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for item in items:
        try:
            lat = round(float(item.get("lat")), 4)
            lng = round(float(item.get("lng")), 4)
        except Exception:
            continue
        key = str(item.get("id") or f"{item.get('type','')}_{item.get('name','')}_{lat}_{lng}").lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= limit:
            break
    return out

@app.post("/api/planner/context")
async def planner_context(body: PlannerContextRequest):
    """Return the real map data needed by the web planner in one cached call.

    The browser should not know provider keys or call every source separately.
    This endpoint mirrors the mobile planner approach: load Trailhead camps,
    practical services, community pins, and trail profiles around a viewport or
    sampled route while allowing individual sources to fail without blanking the map.
    """
    errors: dict[str, str] = {}
    filters = [re.sub(r"[^a-z0-9_]+", "", f.strip().lower()) for f in body.filters if f.strip()]
    filters = filters or ["fuel", "water", "dump", "trailhead"]

    center_lat: float
    center_lng: float
    radius = max(3.0, min(float(body.radius or 35), 85.0))
    if body.center:
        center_lat, center_lng = float(body.center.lat), float(body.center.lng)
    elif body.bounds:
        center_lat = (float(body.bounds.n) + float(body.bounds.s)) / 2
        center_lng = (float(body.bounds.e) + float(body.bounds.w)) / 2
    else:
        raise HTTPException(400, "center or bounds is required")

    bbox = None
    if body.bounds:
        bbox = {
            "n": float(body.bounds.n),
            "s": float(body.bounds.s),
            "e": float(body.bounds.e),
            "w": float(body.bounds.w),
        }
        radius = max(3.0, min(85.0, max(abs(bbox["n"] - bbox["s"]) * 69, abs(bbox["e"] - bbox["w"]) * 54.6) / 2 + 5))

    route_samples = _planner_route_samples(body.route)
    sample_points = route_samples or [{"lat": center_lat, "lng": center_lng}]
    sample_radius = min(radius, 35 if route_samples else radius)

    async def load_camps() -> list[dict]:
        merged: list[dict] = []
        for point in sample_points:
            try:
                ridb, blm, osm = await asyncio.gather(
                    get_campsites_search(point["lat"], point["lng"], radius_miles=sample_radius, type_filters=None),
                    get_blm_campsites(point["lat"], point["lng"], radius_miles=sample_radius),
                    get_osm_campsites(point["lat"], point["lng"], radius_m=int(min(sample_radius, 60) * 1600)),
                )
                merged.extend(_merge_camp_sources(ridb, blm, osm))
            except Exception as exc:
                errors["camps"] = str(exc)
        if bbox:
            merged = [c for c in merged if bbox["s"] <= float(c.get("lat", 999)) <= bbox["n"] and bbox["w"] <= float(c.get("lng", 999)) <= bbox["e"]]
        cleaned = []
        for camp in _planner_dedupe(merged, limit=180):
            camp = dict(camp)
            desc = _planner_clean_text(camp.get("description"), 700)
            camp["description"] = desc
            camp["summary"] = _planner_clean_text(camp.get("summary") or desc, 240)
            cleaned.append(camp)
        return cleaned

    async def load_places() -> list[dict]:
        merged: list[dict] = []
        for point in sample_points:
            try:
                merged.extend(await nearby_places(point["lat"], point["lng"], radius=sample_radius, categories=",".join(filters), provider="auto"))
            except Exception as exc:
                errors["places"] = str(exc)
        return _planner_dedupe(merged, limit=120)

    async def load_pins() -> list[dict]:
        try:
            return get_community_pins(center_lat, center_lng, radius_deg=max(0.05, radius / 69.0))[:120]
        except Exception as exc:
            errors["pins"] = str(exc)
            return []

    async def load_trails() -> list[dict]:
        try:
            await _seed_open_trail_profiles(center_lat, center_lng, radius, limit=100)
            return list_trail_profiles_near(center_lat, center_lng, radius, 100, bbox=bbox, mode="view" if bbox else "nearby")
        except Exception as exc:
            errors["trails"] = str(exc)
            return []

    async def guarded(name: str, loader, timeout: float):
        try:
            return await asyncio.wait_for(loader(), timeout=timeout)
        except Exception as exc:
            errors[name] = str(exc)
            return []

    camps, places, pins, trails = await asyncio.gather(
        guarded("camps", load_camps, 9.0),
        guarded("places", load_places, 8.0),
        guarded("pins", load_pins, 2.0),
        guarded("trails", load_trails, 6.0),
    )
    return {
        "center": {"lat": center_lat, "lng": center_lng},
        "radius": radius,
        "filters": filters,
        "route_samples": sample_points,
        "camps": camps,
        "places": places,
        "pins": pins,
        "trails": trails,
        "errors": errors,
    }

EXCURSION_DEFAULT_CATEGORIES = {
    "trailhead", "trail", "ohv", "viewpoint", "peak", "hot_spring",
    "park", "historic", "climbing", "water", "attraction",
}

EXCURSION_PLACE_CATEGORIES = "water,trailhead,viewpoint,peak,hot_spring,parking,attraction"

def _excursion_distance_mi(lat: float, lng: float, item: dict) -> float:
    try:
        return round(_haversine_m(lat, lng, float(item.get("lat")), float(item.get("lng"))) / 1609.344, 2)
    except Exception:
        return 9999.0

def _route_points_from_lonlat(route: list[list[float]] | None) -> list[dict]:
    points: list[dict] = []
    for point in route or []:
        if not isinstance(point, list) or len(point) < 2:
            continue
        try:
            lng = float(point[0])
            lat = float(point[1])
        except Exception:
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            points.append({"lat": lat, "lng": lng})
    return points

def _point_segment_projection_mi(point: dict, a: dict, b: dict) -> dict:
    plat, plng = float(point["lat"]), float(point["lng"])
    alat, alng = float(a["lat"]), float(a["lng"])
    blat, blng = float(b["lat"]), float(b["lng"])
    ref_lat = math.radians((plat + alat + blat) / 3)
    x, y = plng * math.cos(ref_lat), plat
    ax, ay = alng * math.cos(ref_lat), alat
    bx, by = blng * math.cos(ref_lat), blat
    dx, dy = bx - ax, by - ay
    seg_mi = _haversine_m(alat, alng, blat, blng) / 1609.344
    if dx == 0 and dy == 0:
        return {"distance_mi": _haversine_m(plat, plng, alat, alng) / 1609.344, "progress_mi": 0.0, "progress": 0.0}
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    projected = {"lat": ay + t * dy, "lng": (ax + t * dx) / math.cos(ref_lat)}
    return {"distance_mi": _haversine_m(plat, plng, projected["lat"], projected["lng"]) / 1609.344, "progress_mi": seg_mi * t, "progress": t}

def _route_projection_for_item(item: dict, route_points: list[dict]) -> dict | None:
    if len(route_points) < 2:
        return None
    try:
        point = {"lat": float(item["lat"]), "lng": float(item["lng"])}
    except Exception:
        return None
    seg_lengths = [
        _haversine_m(float(a["lat"]), float(a["lng"]), float(b["lat"]), float(b["lng"])) / 1609.344
        for a, b in zip(route_points, route_points[1:])
    ]
    total = max(sum(seg_lengths), 0.0001)
    cumulative = 0.0
    best: dict | None = None
    for idx, (a, b) in enumerate(zip(route_points, route_points[1:])):
        projection = _point_segment_projection_mi(point, a, b)
        candidate = {
            "route_distance_mi": round(float(projection["distance_mi"]), 2),
            "route_progress": round(max(0.0, min(1.0, (cumulative + float(projection["progress_mi"])) / total)), 4),
            "route_progress_mi": round(cumulative + float(projection["progress_mi"]), 2),
            "route_segment_index": idx,
        }
        if best is None or candidate["route_distance_mi"] < best["route_distance_mi"]:
            best = candidate
        cumulative += seg_lengths[idx]
    return best

def _annotate_route_candidate(item: dict, route_points: list[dict], recommended_day: int | None = None) -> dict:
    projection = _route_projection_for_item(item, route_points)
    if projection:
        item.update(projection)
    if recommended_day is not None:
        item["recommended_day"] = recommended_day
    return item

def _excursion_route_distance_mi(center_lat: float, center_lng: float, item: dict, route: list[list[float]] | None = None) -> float:
    route_points = _route_points_from_lonlat(route)
    projection = _route_projection_for_item(item, route_points)
    if projection:
        return round(float(projection["route_distance_mi"]), 2)
    distances = [_excursion_distance_mi(center_lat, center_lng, item)]
    for point in route or []:
        if not isinstance(point, list) or len(point) < 2:
            continue
        try:
            lng = float(point[0])
            lat = float(point[1])
        except Exception:
            continue
        distances.append(_excursion_distance_mi(lat, lng, item))
    return round(min(distances), 2)

def _excursion_source_confidence(source: str) -> str:
    source = (source or "").lower()
    if source in {"nps", "blm", "ridb", "recreation.gov", "active", "trailhead", "community"}:
        return "high"
    if source in {"osm", "wikipedia", "openbeta"}:
        return "medium"
    return "low"

def _excursion_candidate(
    *,
    item: dict,
    center_lat: float,
    center_lng: float,
    route: list[list[float]] | None = None,
    max_distance_mi: float | None = None,
    xtype: str,
    source: str,
    source_label: str,
    summary: str = "",
    why_go: str = "",
    access_notes: str = "",
    risk_notes: str = "",
    best_for: str = "",
    offline_ready: bool = False,
    sensitive_location: bool = False,
) -> dict | None:
    try:
        lat = float(item.get("lat"))
        lng = float(item.get("lng"))
    except Exception:
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    name = re.sub(r"\s+", " ", str(item.get("name") or item.get("title") or xtype.replace("_", " ").title())).strip()
    if not name:
        return None
    distance = _excursion_route_distance_mi(center_lat, center_lng, {"lat": lat, "lng": lng}, route)
    if max_distance_mi is not None and distance > max_distance_mi:
        return None
    clean_summary = _planner_clean_text(summary or item.get("summary") or item.get("description") or item.get("extract") or "", 360)
    clean_access = _planner_clean_text(access_notes or item.get("access_notes") or "", 260)
    clean_risk = _planner_clean_text(risk_notes or "", 260)
    source_id = str(item.get("id") or item.get("pageid") or item.get("place_id") or f"{source}:{xtype}:{lat:.5f}:{lng:.5f}")
    candidate = {
        "id": _clean_trail_profile_id(f"{source}:{source_id}") or hashlib.sha1(f"{source_id}:{lat}:{lng}".encode()).hexdigest(),
        "name": name[:180],
        "type": xtype,
        "subtype": str(item.get("subtype") or item.get("category") or item.get("kind") or "")[:80],
        "lat": lat,
        "lng": lng,
        "source": source,
        "source_label": source_label,
        "summary": clean_summary,
        "why_go": _planner_clean_text(why_go or clean_summary, 260),
        "access_notes": clean_access or "Verify current access, closures, fees, road conditions, and land-manager rules before committing.",
        "risk_notes": clean_risk,
        "best_for": best_for or ("Basecamp side trip" if distance <= 30 else "Route detour"),
        "distance_from_route_mi": distance,
        "detour_mi": round(distance * 2, 1),
        "drive_time_min": max(8, int(distance * 3.2)),
        "day_fit": "near camp" if distance <= 12 else "half day" if distance <= 35 else "long detour",
        "offline_ready": bool(offline_ready),
        "source_confidence": _excursion_source_confidence(source),
        "sensitive_location": bool(sensitive_location),
    }
    _annotate_route_candidate(candidate, _route_points_from_lonlat(route))
    return candidate

def _excursion_dedupe(items: list[dict], limit: int = 80) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for item in sorted(items, key=lambda p: (p.get("distance_from_route_mi", 9999), p.get("source_confidence") != "high", p.get("name", ""))):
        try:
            key = f"{item.get('type')}:{str(item.get('name','')).lower()}:{round(float(item.get('lat')), 4)}:{round(float(item.get('lng')), 4)}"
        except Exception:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= limit:
            break
    return out

async def _blm_recreation_excursions(lat: float, lng: float, radius_mi: float) -> list[dict]:
    radius_deg = max(0.05, min(radius_mi / 69.0, 1.0))
    geometry = {
        "xmin": lng - radius_deg,
        "ymin": lat - radius_deg,
        "xmax": lng + radius_deg,
        "ymax": lat + radius_deg,
        "spatialReference": {"wkid": 4326},
    }
    url = "https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recreation/MapServer/12/query"
    params = {
        "where": "1=1",
        "geometry": json.dumps(geometry),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "outSR": 4326,
        "outFields": "RecSiteName,FeaturedActivity,PrimaryType,RecAreaName,URL",
        "returnGeometry": "true",
        "f": "geojson",
        "resultRecordCount": 80,
    }
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "TrailheadExcursions/1.0"}) as client:
            res = await client.get(url, params=params)
            res.raise_for_status()
            features = (res.json() or {}).get("features") or []
    except Exception:
        return []
    out: list[dict] = []
    for feature in features:
        props = feature.get("properties") or {}
        coords = ((feature.get("geometry") or {}).get("coordinates") or [])
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        activity = str(props.get("FeaturedActivity") or props.get("PrimaryType") or "recreation").lower()
        xtype = "climbing" if "climb" in activity else "ohv" if any(k in activity for k in ["ohv", "off-highway", "motor"]) else "park"
        out.append({
            "id": str(props.get("OBJECTID") or props.get("RecSiteName") or ""),
            "name": props.get("RecSiteName") or props.get("RecAreaName") or "BLM recreation site",
            "lat": coords[1],
            "lng": coords[0],
            "subtype": props.get("FeaturedActivity") or props.get("PrimaryType") or "",
            "summary": f"{props.get('FeaturedActivity') or 'Public recreation'} site from BLM recreation data.",
            "access_notes": props.get("URL") or "Check the BLM field office or posted rules before driving.",
        })
    return out

@app.post("/api/excursions/nearby")
async def excursions_nearby(body: ExcursionNearbyRequest):
    center_lat = float(body.center.lat)
    center_lng = float(body.center.lng)
    radius = max(3.0, min(float(body.radius or 35), 85.0))
    route = body.route or []
    categories = {re.sub(r"[^a-z0-9_]+", "", c.strip().lower()) for c in body.categories if c.strip()}
    categories = categories or EXCURSION_DEFAULT_CATEGORIES
    candidates: list[dict] = []
    errors: dict[str, str] = {}

    async def load_places():
        places = await nearby_places(center_lat, center_lng, radius=min(radius, 45), categories=EXCURSION_PLACE_CATEGORIES, provider="auto")
        for place in places:
            ptype = str(place.get("type") or "attraction")
            xtype = "trail" if ptype == "trailhead" else ptype
            if xtype not in categories and ptype not in categories:
                continue
            cand = _excursion_candidate(
                item=place, center_lat=center_lat, center_lng=center_lng,
                route=route, max_distance_mi=radius,
                xtype=xtype, source=str(place.get("source") or "osm"),
                source_label=str(place.get("source_label") or "Open place data"),
                summary=place.get("address") or place.get("subtype") or "",
                best_for="Quick stop" if ptype in {"water", "viewpoint"} else "Side trip",
            )
            if cand:
                candidates.append(cand)

    async def load_trails():
        await _seed_open_trail_profiles(center_lat, center_lng, radius, limit=80)
        for trail in list_trail_profiles_near(center_lat, center_lng, radius, 80):
            if "trail" not in categories and "trailhead" not in categories and "ohv" not in categories:
                continue
            activities = " ".join(str(a).lower() for a in trail.get("activities") or [])
            xtype = "ohv" if any(k in activities for k in ["overland", "ohv", "4x4", "motor"]) else "trail"
            cand = _excursion_candidate(
                item=trail, center_lat=center_lat, center_lng=center_lng,
                route=route, max_distance_mi=radius,
                xtype=xtype, source=str(trail.get("source") or "trailhead"),
                source_label=str(trail.get("source_label") or "Trailhead"),
                summary=trail.get("summary") or trail.get("description") or "",
                why_go=trail.get("summary") or "",
                best_for="Trail scouting",
                offline_ready=False,
            )
            if cand:
                cand["length_mi"] = trail.get("length_mi")
                cand["difficulty"] = trail.get("difficulty")
                cand["activities"] = trail.get("activities") or []
                candidates.append(cand)

    async def load_explore():
        try:
            catalog = await explore_places(center_lat, center_lng, mode="nearby", limit=60)
        except Exception:
            return
        for place in catalog.get("places") or []:
            summary = place.get("summary") or {}
            source_pack = place.get("source_pack") or {}
            category = str(summary.get("category") or "").lower()
            xtype = "historic" if any(k in category for k in ["historic", "monument"]) else "park"
            if xtype not in categories and "attraction" not in categories:
                continue
            cand = _excursion_candidate(
                item={**summary, "lat": summary.get("lat"), "lng": summary.get("lng")},
                center_lat=center_lat, center_lng=center_lng,
                route=route, max_distance_mi=radius,
                xtype=xtype,
                source="nps" if source_pack.get("quality") == "official" else "wikipedia",
                source_label=source_pack.get("primary") or summary.get("source_title") or "Explore",
                summary=summary.get("short_description") or (place.get("profile") or {}).get("summary") or "",
                why_go=(place.get("profile") or {}).get("why_it_matters") or "",
                access_notes=(place.get("profile") or {}).get("access_notes") or "",
                sensitive_location=xtype == "historic" and source_pack.get("quality") != "official",
            )
            if cand:
                candidates.append(cand)

    async def load_wiki():
        if not categories.intersection({"historic", "attraction", "park"}):
            return
        for article in await wikipedia_nearby(center_lat, center_lng, radius=int(min(radius * 1609.344, 30000)), limit=12):
            title = str(article.get("title") or "")
            lower = title.lower()
            xtype = "historic" if any(k in lower for k in ["historic", "ruins", "monument", "petroglyph", "fort", "mission"]) else "attraction"
            cand = _excursion_candidate(
                item=article, center_lat=center_lat, center_lng=center_lng,
                route=route, max_distance_mi=radius,
                xtype=xtype, source="wikipedia", source_label="Wikipedia",
                summary=article.get("extract") or "",
                access_notes="Use this as context only; verify official access before detouring.",
                sensitive_location=any(k in lower for k in ["petroglyph", "archaeological", "ruins"]),
            )
            if cand and (not cand["sensitive_location"] or "historic" in categories):
                candidates.append(cand)

    async def load_blm():
        if not categories.intersection({"climbing", "ohv", "park", "attraction"}):
            return
        for item in await _blm_recreation_excursions(center_lat, center_lng, radius):
            xtype = "climbing" if "climb" in str(item.get("subtype", "")).lower() else "ohv" if "ohv" in str(item.get("subtype", "")).lower() else "park"
            if xtype not in categories and "attraction" not in categories:
                continue
            cand = _excursion_candidate(
                item=item, center_lat=center_lat, center_lng=center_lng,
                route=route, max_distance_mi=radius,
                xtype=xtype, source="blm", source_label="Bureau of Land Management",
                summary=item.get("summary") or "",
                access_notes=item.get("access_notes") or "",
                best_for="Public land side trip",
            )
            if cand:
                candidates.append(cand)

    async def guarded(name: str, fn):
        try:
            await asyncio.wait_for(fn(), timeout=8.0)
        except Exception as exc:
            errors[name] = str(exc)

    await asyncio.gather(
        guarded("places", load_places),
        guarded("trails", load_trails),
        guarded("explore", load_explore),
        guarded("wikipedia", load_wiki),
        guarded("blm", load_blm),
    )
    return {
        "center": {"lat": center_lat, "lng": center_lng},
        "radius": radius,
        "categories": sorted(categories),
        "excursions": [_annotate_route_candidate(item, _route_points_from_lonlat(route), body.day) for item in _excursion_dedupe(candidates, limit=80)],
        "errors": errors,
    }


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


def _web_mercator_tile_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    extent = 20037508.342789244
    tiles = 2 ** z
    tile_size = (extent * 2) / tiles
    west = -extent + x * tile_size
    east = west + tile_size
    north = extent - y * tile_size
    south = north - tile_size
    return west, south, east, north


def _mercator_to_lon_lat(mx: float, my: float) -> tuple[float, float]:
    extent = 20037508.342789244
    lon = (mx / extent) * 180.0
    lat = (my / extent) * 180.0
    lat = (180.0 / math.pi) * (2.0 * math.atan(math.exp(lat * math.pi / 180.0)) - math.pi / 2.0)
    return lon, lat


def _tile_intersects_chs_nonna_coverage(z: int, x: int, y: int) -> bool:
    west, south, east, north = _web_mercator_tile_bbox(z, x, y)
    west_lng, south_lat = _mercator_to_lon_lat(west, south)
    east_lng, north_lat = _mercator_to_lon_lat(east, north)
    # CHS NONNA open-data extent from the current Open Canada record.
    return not (east_lng < -143.0 or west_lng > -47.0 or north_lat < 39.05 or south_lat > 85.0)


def _marine_bounds_from_tile(z: int, x: int, y: int) -> MarineBounds:
    west, south, east, north = _web_mercator_tile_bbox(z, x, y)
    west_lng, south_lat = _mercator_to_lon_lat(west, south)
    east_lng, north_lat = _mercator_to_lon_lat(east, north)
    return MarineBounds(north=north_lat, south=south_lat, east=east_lng, west=west_lng)


def _marine_bounds_from_params(n: float, s: float, e: float, w: float) -> MarineBounds:
    return MarineBounds(north=float(n), south=float(s), east=float(e), west=float(w))


@app.get("/api/noaa-chart-tile/{z}/{x}/{y}")
async def noaa_chart_tile(z: int, x: int, y: int):
    if z < 0 or z > 18 or x < 0 or y < 0 or x >= 2 ** z or y >= 2 ** z:
        return Response(content=_TRANSPARENT_TILE, media_type="image/png", headers={"Access-Control-Allow-Origin": "*"})
    cache_key = f"noaa_chart_tile_v1:{z}:{x}:{y}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24 * 7)
    if cached:
        return Response(
            content=_b64.b64decode(cached),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*"},
        )
    west, south, east, north = _web_mercator_tile_bbox(z, x, y)
    url = "https://encdirect.noaa.gov/arcgis/rest/services/MarineChart_Services/NOAACharts/MapServer/export"
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(
                url,
                params={
                    "bbox": f"{west},{south},{east},{north}",
                    "bboxSR": "3857",
                    "imageSR": "3857",
                    "size": "256,256",
                    "format": "png32",
                    "transparent": "true",
                    "f": "image",
                },
                headers={"User-Agent": "Trailhead/1.0 (NOAA chart tile proxy)"},
            )
            r.raise_for_status()
            data = r.content
        if not data or not str(r.headers.get("content-type") or "").startswith("image/"):
            data = _TRANSPARENT_TILE
        set_cached("campsite_cache", cache_key, _b64.b64encode(data).decode())
        return Response(
            content=data,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*"},
        )
    except Exception:
        return Response(content=_TRANSPARENT_TILE, media_type="image/png", headers={"Access-Control-Allow-Origin": "*"})


@app.get("/api/chs-nonna-tile/{z}/{x}/{y}")
async def chs_nonna_tile(z: int, x: int, y: int):
    if z < 0 or z > 18 or x < 0 or y < 0 or x >= 2 ** z or y >= 2 ** z:
        return Response(content=_TRANSPARENT_TILE, media_type="image/png", headers={"Access-Control-Allow-Origin": "*"})
    if not _tile_intersects_chs_nonna_coverage(z, x, y):
        return Response(
            content=_TRANSPARENT_TILE,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*"},
        )
    cache_key = f"chs_nonna_tile_v1:{z}:{x}:{y}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24 * 7)
    if cached:
        return Response(
            content=_b64.b64decode(cached),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*"},
        )
    west, south, east, north = _web_mercator_tile_bbox(z, x, y)
    url = "https://nonna-geoserver.data.chs-shc.ca/geoserver/ows"
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(
                url,
                params={
                    "SERVICE": "WMS",
                    "VERSION": "1.3.0",
                    "REQUEST": "GetMap",
                    "LAYERS": "nonna:NONNA 10",
                    "STYLES": "raster",
                    "CRS": "EPSG:3857",
                    "BBOX": f"{west},{south},{east},{north}",
                    "WIDTH": "256",
                    "HEIGHT": "256",
                    "FORMAT": "image/png",
                    "TRANSPARENT": "true",
                },
                headers={"User-Agent": "Trailhead/1.0 (CHS NONNA bathymetry tile proxy)"},
            )
            r.raise_for_status()
            data = r.content
        if not data or not str(r.headers.get("content-type") or "").startswith("image/"):
            data = _TRANSPARENT_TILE
        set_cached("campsite_cache", cache_key, _b64.b64encode(data).decode())
        return Response(
            content=data,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*"},
        )
    except Exception:
        return Response(content=_TRANSPARENT_TILE, media_type="image/png", headers={"Access-Control-Allow-Origin": "*"})


@app.get("/api/water/chart-sources")
async def water_chart_sources(n: float, s: float, e: float, w: float):
    if not (-90 <= s <= 90 and -90 <= n <= 90 and -180 <= w <= 180 and -180 <= e <= 180 and n > s and e > w):
        raise HTTPException(400, "Invalid bounds")
    bounds = _marine_bounds_from_params(n, s, e, w)
    return marine_chart_profile(bounds)


@app.get("/api/water/spot-cards")
async def water_spot_cards(n: float, s: float, e: float, w: float):
    if not (-90 <= s <= 90 and -90 <= n <= 90 and -180 <= w <= 180 and -180 <= e <= 180 and n > s and e > w):
        raise HTTPException(400, "Invalid bounds")
    bounds = _marine_bounds_from_params(n, s, e, w)
    return marine_spot_cards(bounds)


@app.get("/api/hydro/manifest.json")
async def hydro_manifest():
    return read_hydro_manifest()


@app.get("/api/hydro/chart-profile")
async def hydro_chart_profile(n: float, s: float, e: float, w: float):
    if not (-90 <= s <= 90 and -90 <= n <= 90 and -180 <= w <= 180 and -180 <= e <= 180 and n > s and e > w):
        raise HTTPException(400, "Invalid bounds")
    bounds = _marine_bounds_from_params(n, s, e, w)
    return {
        "mode": "safe_water_awareness",
        "hydro": hydro_profile(bounds),
        "chart_profile": marine_chart_profile(bounds),
    }


@app.get("/api/water/route-graphs/manifest.json")
async def water_route_graphs_manifest():
    return water_graph_manifest()


@app.get("/api/hydro/{region}.pmtiles")
async def hydro_pmtiles(region: str):
    if not re.fullmatch(r"[a-z0-9-]{2,24}", region):
        raise HTTPException(400, "Invalid hydro region")
    for root in (HYDRO_DIR, LOCAL_HYDRO_DIR):
        path = root / f"{region}.pmtiles"
        if path.exists():
            return FileResponse(
                path,
                media_type="application/vnd.pmtiles",
                headers={
                    "Cache-Control": "public, max-age=300",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    raise HTTPException(404, "Hydro pack not found")


@app.get("/api/water/conditions")
async def water_conditions(lat: float, lng: float):
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(400, "Invalid coordinate")
    station = nearest_marine_station(lat, lng)
    if not station:
        return {
            "station": None,
            "source": "Trailhead",
            "note": "No supported live water-condition station is mapped near this point yet.",
        }
    cache_key = f"water_conditions_v1:{station['id']}"
    cached = get_cached("weather_cache", cache_key, ttl_seconds=60 * 10)
    if cached is not None:
        return cached
    url = f"https://www.ndbc.noaa.gov/data/realtime2/{station['id']}.txt"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, headers={"User-Agent": "Trailhead/1.0 (water conditions)"})
            r.raise_for_status()
            parsed = parse_ndbc_realtime(r.text, station)
    except Exception as exc:
        return {
            "station": station,
            "source": "NOAA NDBC realtime text feed",
            "source_url": url,
            "error": f"{type(exc).__name__}: {exc}",
            "note": "Live water conditions are unavailable right now.",
        }
    if not parsed:
        return {
            "station": station,
            "source": "NOAA NDBC realtime text feed",
            "source_url": url,
            "note": "No current observation row was available.",
        }
    set_cached("weather_cache", cache_key, parsed)
    return parsed


@app.get("/api/water/fishing-conditions")
async def water_fishing_conditions(lat: float, lng: float):
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(400, "Invalid coordinate")
    return fishing_conditions(lat, lng)


@app.get("/api/water/suggested-corridor")
async def water_suggested_corridor(
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    draft_ft: float | None = None,
):
    for lat in (start_lat, end_lat):
        if not -90 <= lat <= 90:
            raise HTTPException(400, "Invalid latitude")
    for lng in (start_lng, end_lng):
        if not -180 <= lng <= 180:
            raise HTTPException(400, "Invalid longitude")
    corridor = suggested_corridor(
        start_lat=start_lat,
        start_lng=start_lng,
        end_lat=end_lat,
        end_lng=end_lng,
        draft_ft=draft_ft,
    )
    graph_line = route_with_water_graph(
        start_lat=start_lat,
        start_lng=start_lng,
        end_lat=end_lat,
        end_lng=end_lng,
    )
    if graph_line:
        corridor["geometry"] = {"type": "LineString", "coordinates": graph_line["coordinates"]}
        corridor["distance_mi"] = graph_line.get("distance_mi") or corridor["distance_mi"]
        corridor["eta_minutes"] = round((float(corridor["distance_mi"]) / 16.0) * 60) if corridor.get("distance_mi") else corridor["eta_minutes"]
        corridor["source_confidence"] = graph_line["source_confidence"]
        corridor["chart_source"] = graph_line["source"]
        corridor["source_disclosure"] = "Chart graph."
        corridor["conflicts"].append({
            "kind": graph_line["source_confidence"],
            "severity": "notice",
            "note": "Chart graph used where available.",
        })
        corridor["route_points"] = [
            {"name": "Start", "lat": start_lat, "lng": start_lng, "kind": "start"},
            {"name": "Graph", "lat": start_lat, "lng": start_lng, "kind": "chart_graph"},
            {"name": "End", "lat": end_lat, "lng": end_lng, "kind": "end"},
        ]
        return corridor
    try:
        open_line = await _open_water_nav_corridor(start_lat, start_lng, end_lat, end_lng)
    except Exception:
        open_line = None
    if open_line:
        corridor["geometry"] = {"type": "LineString", "coordinates": open_line["coordinates"]}
        corridor["distance_mi"] = open_line.get("distance_mi") or corridor["distance_mi"]
        corridor["eta_minutes"] = round((float(corridor["distance_mi"]) / 16.0) * 60) if corridor.get("distance_mi") else corridor["eta_minutes"]
        corridor["source_confidence"] = "open_seamark_graph_advisory" if open_line.get("graph") else "open_seamark_advisory"
        corridor["chart_source"] = open_line["source"]
        corridor["source_disclosure"] = "Open seamark graph." if open_line.get("graph") else "Open seamark line."
        corridor["conflicts"].append({
            "kind": corridor["source_confidence"],
            "severity": "notice",
            "note": "Open seamark graph used where available." if open_line.get("graph") else "Open seamark line used where available.",
        })
        corridor["route_points"] = [
            {"name": "Start", "lat": start_lat, "lng": start_lng, "kind": "start"},
            {"name": "Graph" if open_line.get("graph") else "Line", "lat": start_lat, "lng": start_lng, "kind": "open_seamark_graph" if open_line.get("graph") else "open_seamark_line"},
            {"name": "End", "lat": end_lat, "lng": end_lng, "kind": "end"},
        ]
    return corridor


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


# ── OSM POIs and water navigation context ─────────────────────────────────────

OVERPASS_INTERPRETER_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
OVERPASS_INTERPRETER_URL = OVERPASS_INTERPRETER_URLS[0]
WATER_NAV_LINE_PATTERN = (
    "fairway|recommended|recommended_track|recommended_route|route|track|"
    "leading|range|navigation_line|traffic_separation|deep_water"
)
WATER_NAV_POINT_PATTERN = (
    "buoy|beacon|light|daymark|marker|signal|pile|post|rock|wreck|"
    "obstruction|shoal|reef|foul|hazard|anchorage|mooring|lock"
)


def _water_nav_line_kind(tags: dict) -> str:
    seamark = str(tags.get("seamark:type") or "").lower().replace("-", "_")
    waterway = str(tags.get("waterway") or "").lower()
    text = " ".join(str(v or "").lower() for v in tags.values())
    if "leading" in seamark or "range" in seamark or "leading line" in text or "range line" in text:
        return "range_line"
    if "traffic_separation" in seamark:
        return "traffic_lane"
    if "deep_water" in seamark:
        return "deep_water_route"
    if "recommended" in seamark or "track" in seamark or "route" in seamark:
        return "recommended_track"
    if "fairway" in seamark or waterway == "fairway":
        return "marked_channel"
    return "water_follow_line"


def _water_nav_line_label(kind: str) -> str:
    return {
        "marked_channel": "Marked channel",
        "recommended_track": "Recommended track",
        "fairway": "Fairway",
        "range_line": "Range / leading line",
        "traffic_lane": "Traffic lane",
        "deep_water_route": "Deep-water route",
    }.get(kind, "Water follow line")


def _pretty_water_token(value: str) -> str:
    text = str(value or "").replace("_", " ").replace("-", " ").strip()
    if not text:
        return ""
    return " ".join(part[:1].upper() + part[1:] for part in text.split())


def _first_tag(tags: dict, *keys: str) -> str:
    for key in keys:
        value = tags.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def _water_nav_point_kind(tags: dict) -> str:
    seamark = str(tags.get("seamark:type") or "").lower().replace("-", "_")
    hazard_text = " ".join(
        str(tags.get(k) or "").lower()
        for k in ("hazard", "seamark:hazard", "seamark:obstruction:category", "seamark:rock:water_level", "natural")
    )
    if re.search(r"(rock|wreck|obstruction|shoal|reef|foul|hazard|seabed|depth_area)", seamark) or re.search(
        r"(rock|rocks|shoal|submerged|obstruction|wreck|reef|danger|awash)", hazard_text
    ):
        return "water_hazard"
    if re.search(r"(fairway|recommended|route|track|traffic_separation|deep_water)", seamark):
        return "channel_marker"
    if re.search(r"(anchorage|mooring)", seamark):
        return "anchorage"
    if "lock" in seamark or str(tags.get("waterway") or "").lower() in {"lock", "lock_gate"}:
        return "lock"
    if re.search(r"(buoy|beacon|light|daymark|marker|signal|pile|post)", seamark):
        return "navigation_aid"
    return "navigation_aid"


def _water_nav_point_label(kind: str) -> str:
    return {
        "navigation_aid": "Buoy / marker",
        "channel_marker": "Channel marker",
        "water_hazard": "Rock / hazard",
        "anchorage": "Anchorage / mooring",
        "lock": "Lock / control",
    }.get(kind, "Water navigation point")


def _water_nav_point_color(tags: dict, kind: str) -> str:
    raw = _first_tag(
        tags,
        "seamark:buoy_lateral:colour",
        "seamark:buoy_cardinal:colour",
        "seamark:beacon_lateral:colour",
        "seamark:beacon_cardinal:colour",
        "seamark:daymark:colour",
        "seamark:light:colour",
        "colour",
    ).lower()
    if "red" in raw:
        return "red"
    if "green" in raw:
        return "green"
    if "yellow" in raw:
        return "yellow"
    if "white" in raw:
        return "white"
    if "black" in raw:
        return "black"
    if kind == "water_hazard":
        return "hazard"
    if kind == "channel_marker":
        return "channel"
    return "aid"


def _water_nav_point_code(kind: str, color: str) -> str:
    if kind == "water_hazard":
        return "!"
    if kind == "channel_marker":
        return "C"
    if kind == "anchorage":
        return "A"
    if kind == "lock":
        return "L"
    if color == "red":
        return "R"
    if color == "green":
        return "G"
    return "M"


def _water_nav_element_coord(el: dict) -> tuple[float, float] | None:
    lat, lon = el.get("lat"), el.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return float(lon), float(lat)
    center = el.get("center") or {}
    lat, lon = center.get("lat"), center.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return float(lon), float(lat)
    geom = el.get("geometry") or []
    points = [
        (float(node.get("lon")), float(node.get("lat")))
        for node in geom
        if isinstance(node.get("lat"), (int, float)) and isinstance(node.get("lon"), (int, float))
    ]
    if not points:
        return None
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))


def _water_nav_depth_ft(value: str) -> float | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    depth = float(match.group(0))
    if "ft" in text or "feet" in text or "'" in text:
        return round(depth, 1)
    return round(depth * 3.28084, 1)


def _water_nav_line_feature(el: dict) -> dict | None:
    coords = []
    for node in el.get("geometry") or []:
        lat, lon = node.get("lat"), node.get("lon")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            coords.append([float(lon), float(lat)])
    if len(coords) < 2:
        return None
    if len(coords) > 400:
        step = max(1, len(coords) // 400)
        coords = coords[::step]
        if coords[-1] != [float((el.get("geometry") or [])[-1].get("lon")), float((el.get("geometry") or [])[-1].get("lat"))]:
            last = (el.get("geometry") or [])[-1]
            coords.append([float(last.get("lon")), float(last.get("lat"))])
    tags = el.get("tags") or {}
    kind = _water_nav_line_kind(tags)
    label = _water_nav_line_label(kind)
    name = (
        tags.get("name")
        or tags.get("seamark:name")
        or tags.get("seamark:fairway:name")
        or tags.get("seamark:recommended_track:name")
        or label
    )
    draft = (
        tags.get("seamark:recommended_track:maximum_draught")
        or tags.get("seamark:recommended_track:draft")
        or tags.get("seamark:fairway:maximum_draught")
        or tags.get("maxdraft")
        or ""
    )
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {
            "id": f"osm_water_nav_{el.get('type', 'way')}_{el.get('id', '')}",
            "name": str(name),
            "kind": kind,
            "label": label,
            "source": "OpenStreetMap / OpenSeaMap",
            "source_freshness": "Open seamark tags packaged live by Trailhead; verify against current official charts and local markers.",
            "seamark_type": str(tags.get("seamark:type") or ""),
            "waterway": str(tags.get("waterway") or ""),
            "max_draft": str(draft),
            "max_draft_ft": parse_draft_feet(str(draft)),
            "navigation_note": "Informational follow line only. Use official charts, buoys/daymarks, depth, weather, water levels, and local notices before boating.",
        },
    }


def _water_nav_point_feature(el: dict) -> dict | None:
    coord = _water_nav_element_coord(el)
    if not coord:
        return None
    tags = el.get("tags") or {}
    kind = _water_nav_point_kind(tags)
    color = _water_nav_point_color(tags, kind)
    label = _water_nav_point_label(kind)
    seamark = str(tags.get("seamark:type") or "")
    feature_name = _pretty_water_token(seamark) or label
    name = tags.get("name") or tags.get("seamark:name") or feature_name
    hazard = _pretty_water_token(_first_tag(tags, "seamark:obstruction:category", "seamark:wreck:category", "seamark:rock:water_level", "hazard", "natural"))
    shape = _pretty_water_token(_first_tag(
        tags,
        "seamark:buoy_lateral:shape",
        "seamark:buoy_cardinal:shape",
        "seamark:beacon_lateral:shape",
        "seamark:beacon_cardinal:shape",
        "seamark:topmark:shape",
        "shape",
    ))
    light = _pretty_water_token(_first_tag(tags, "seamark:light:character", "seamark:light:colour", "seamark:light:range"))
    depth = _first_tag(tags, "seamark:depth", "seamark:rock:depth", "seamark:obstruction:depth", "seamark:wreck:depth")
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [coord[0], coord[1]]},
        "properties": {
            "id": f"osm_water_nav_{el.get('type', 'node')}_{el.get('id', '')}",
            "name": str(name),
            "kind": kind,
            "subtype": kind,
            "label": label,
            "code": _water_nav_point_code(kind, color),
            "marker_color": color,
            "navigation_feature": feature_name,
            "hazard_type": hazard,
            "mark_color": _pretty_water_token(color),
            "mark_shape": shape,
            "light_character": light,
            "depth": str(depth),
            "depth_ft": _water_nav_depth_ft(depth),
            "source": "OpenStreetMap / OpenSeaMap",
            "source_freshness": "Open seamark tags packaged live by Trailhead; verify against current official charts and local markers.",
            "seamark_type": seamark,
            "navigation_note": "Open seamark point only. Verify marker position, hazard state, depth, lights, and safe passage against official charts and local conditions.",
        },
    }


async def _post_overpass_json(query: str, *, user_agent: str, timeout_seconds: float = 60) -> tuple[dict, str, list[str]]:
    errors: list[str] = []
    timeout = httpx.Timeout(timeout_seconds, connect=6, read=timeout_seconds, write=15)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for url in OVERPASS_INTERPRETER_URLS:
            try:
                res = await client.post(url, data={"data": query}, headers={"User-Agent": user_agent})
                if res.status_code in {408, 429, 500, 502, 503, 504}:
                    errors.append(f"{url}: HTTP {res.status_code}")
                    continue
                res.raise_for_status()
                return res.json(), url, errors
            except Exception as exc:
                errors.append(f"{url}: {type(exc).__name__}: {exc}")
    raise RuntimeError("; ".join(errors[-3:]) or "Overpass unavailable")


def _water_coord_key(coord: list[float] | tuple[float, float]) -> str:
    return f"{round(float(coord[0]), 5):.5f},{round(float(coord[1]), 5):.5f}"


def _water_dedupe_coords(coords: list[list[float]]) -> list[list[float]]:
    deduped: list[list[float]] = []
    for coord in coords:
        if len(coord) < 2:
            continue
        item = [round(float(coord[0]), 6), round(float(coord[1]), 6)]
        if not deduped or item != deduped[-1]:
            deduped.append(item)
    return deduped


def _water_route_graph_path(
    *,
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    features: list[dict],
) -> dict | None:
    node_coords: dict[str, list[float]] = {}
    graph: dict[str, list[tuple[str, float]]] = {}
    source_names: set[str] = set()

    for feature in features:
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        props = feature.get("properties") or {}
        clean = [
            [float(coord[0]), float(coord[1])]
            for coord in coords
            if isinstance(coord, (list, tuple)) and len(coord) >= 2
        ]
        if len(clean) < 2:
            continue
        source_names.add(str(props.get("name") or props.get("label") or props.get("source") or "Open seamark line"))
        previous_key = ""
        previous_coord: list[float] | None = None
        for coord in clean:
            key = _water_coord_key(coord)
            node_coords.setdefault(key, [round(coord[0], 6), round(coord[1], 6)])
            graph.setdefault(key, [])
            if previous_key and previous_coord:
                weight = _haversine_m(previous_coord[1], previous_coord[0], coord[1], coord[0])
                if weight > 0:
                    graph[previous_key].append((key, weight))
                    graph[key].append((previous_key, weight))
            previous_key = key
            previous_coord = coord

    if len(node_coords) < 2:
        return None

    def nearest_nodes(lat: float, lng: float, limit: int = 5) -> list[tuple[str, float]]:
        scored = [
            (key, _haversine_m(lat, lng, coord[1], coord[0]))
            for key, coord in node_coords.items()
        ]
        scored.sort(key=lambda item: item[1])
        return scored[:limit]

    direct_m = max(1.0, _haversine_m(start_lat, start_lng, end_lat, end_lng))
    snap_limit_m = max(900.0, min(4200.0, direct_m * 0.35))
    start_key = "__start__"
    end_key = "__end__"
    node_coords[start_key] = [round(start_lng, 6), round(start_lat, 6)]
    node_coords[end_key] = [round(end_lng, 6), round(end_lat, 6)]
    graph[start_key] = []
    graph[end_key] = []

    for key, dist in nearest_nodes(start_lat, start_lng):
        if dist <= snap_limit_m:
            graph[start_key].append((key, dist))
            graph.setdefault(key, []).append((start_key, dist))
    for key, dist in nearest_nodes(end_lat, end_lng):
        if dist <= snap_limit_m:
            graph[end_key].append((key, dist))
            graph.setdefault(key, []).append((end_key, dist))

    if not graph[start_key] or not graph[end_key]:
        return None

    queue: list[tuple[float, str]] = [(0.0, start_key)]
    distances: dict[str, float] = {start_key: 0.0}
    parents: dict[str, str] = {}
    while queue:
        cost, key = heapq.heappop(queue)
        if key == end_key:
            break
        if cost > distances.get(key, math.inf):
            continue
        for next_key, weight in graph.get(key, []):
            next_cost = cost + weight
            if next_cost < distances.get(next_key, math.inf):
                distances[next_key] = next_cost
                parents[next_key] = key
                heapq.heappush(queue, (next_cost, next_key))

    route_cost = distances.get(end_key)
    if route_cost is None or not math.isfinite(route_cost):
        return None
    if route_cost > max(6500.0, direct_m * 4.5):
        return None

    keys: list[str] = []
    cursor = end_key
    while cursor:
        keys.append(cursor)
        if cursor == start_key:
            break
        cursor = parents.get(cursor, "")
    if not keys or keys[-1] != start_key:
        return None
    keys.reverse()

    coords = _water_dedupe_coords([node_coords[key] for key in keys if key in node_coords])
    if len(coords) < 2:
        return None
    return {
        "coordinates": coords[:320],
        "distance_mi": round(route_cost / 1609.344, 2),
        "source": "OpenStreetMap / OpenSeaMap graph",
        "source_names": sorted(source_names)[:6],
        "graph": True,
        "snap_limit_m": round(snap_limit_m),
    }


async def _open_water_nav_corridor(start_lat: float, start_lng: float, end_lat: float, end_lng: float) -> dict | None:
    n = max(start_lat, end_lat) + 0.18
    s = min(start_lat, end_lat) - 0.18
    e = max(start_lng, end_lng) + 0.18
    w = min(start_lng, end_lng) - 0.18
    if abs(n - s) > 4.5 or abs(e - w) > 4.5:
        return None
    bbox = f"{s},{w},{n},{e}"
    query = f"""[out:json][timeout:18];
(
  way["seamark:type"~"{WATER_NAV_LINE_PATTERN}",i]({bbox});
  way["waterway"="fairway"]({bbox});
  way["seamark:recommended_track:category"]({bbox});
  way["seamark:recommended_track:maximum_draught"]({bbox});
  way["seamark:fairway:category"]({bbox});
);
out tags geom 900;
"""
    payload, _, _ = await _post_overpass_json(query, user_agent="Trailhead/1.0 (water corridor)", timeout_seconds=22)
    line_features: list[dict] = []
    candidates: list[tuple[float, list[list[float]], dict]] = []
    direct_mi = max(0.1, _haversine_m(start_lat, start_lng, end_lat, end_lng) / 1609.344)
    for el in payload.get("elements") or []:
        feature = _water_nav_line_feature(el)
        coords = feature.get("geometry", {}).get("coordinates") if feature else None
        if not coords or len(coords) < 2:
            continue
        line_features.append(feature)
        first = coords[0]
        last = coords[-1]
        forward_score = (
            _haversine_m(start_lat, start_lng, first[1], first[0])
            + _haversine_m(end_lat, end_lng, last[1], last[0])
        ) / 1609.344
        reverse_score = (
            _haversine_m(start_lat, start_lng, last[1], last[0])
            + _haversine_m(end_lat, end_lng, first[1], first[0])
        ) / 1609.344
        oriented = coords if forward_score <= reverse_score else list(reversed(coords))
        score = min(forward_score, reverse_score)
        if score <= max(8.0, direct_mi * 0.75):
            candidates.append((score, oriented, feature.get("properties", {})))
    graph_route = _water_route_graph_path(
        start_lat=start_lat,
        start_lng=start_lng,
        end_lat=end_lat,
        end_lng=end_lng,
        features=line_features,
    )
    if graph_route:
        return graph_route
    if not candidates:
        return None
    _, line_coords, props = min(candidates, key=lambda item: (item[0], -len(item[1])))
    coords = [[round(start_lng, 6), round(start_lat, 6)]]
    coords.extend([[round(float(lng), 6), round(float(lat), 6)] for lng, lat in line_coords])
    coords.append([round(end_lng, 6), round(end_lat, 6)])
    deduped = _water_dedupe_coords(coords)
    return {
        "coordinates": deduped[:220],
        "source": str(props.get("source") or "OpenStreetMap / OpenSeaMap"),
        "source_names": [str(props.get("name") or props.get("label") or "Open seamark line")],
    }


@app.get("/api/water/navigation-lines")
async def water_navigation_lines(n: float, s: float, e: float, w: float):
    """Return open chart lines plus seamark aids/hazards in a viewport."""
    if not (-90 <= s <= 90 and -90 <= n <= 90 and -180 <= w <= 180 and -180 <= e <= 180 and n > s and e > w):
        raise HTTPException(400, "Invalid bounds")
    lat_span = abs(n - s)
    lng_span = abs(e - w)
    if lat_span > 4.5 or lng_span > 4.5:
        return {
            "type": "FeatureCollection",
            "features": [],
            "source": "OpenStreetMap / OpenSeaMap",
            "note": "Zoom in to load water follow lines.",
            "chart_profile": marine_chart_profile(_marine_bounds_from_params(n, s, e, w)),
            "counts": {"lines": 0, "points": 0, "hazards": 0, "aids": 0, "recommended_tracks": 0},
        }
    key = "water_nav_lines:" + hashlib.sha1(json.dumps([round(n, 2), round(s, 2), round(e, 2), round(w, 2)], sort_keys=True).encode()).hexdigest()[:24]
    cached = get_cached("campsite_cache", key, ttl_seconds=3600 * 24)
    if cached is not None:
        return cached
    bbox = f"{s},{w},{n},{e}"
    query = f"""[out:json][timeout:45];
(
  way["seamark:type"~"{WATER_NAV_LINE_PATTERN}",i]({bbox});
  way["waterway"="fairway"]({bbox});
  way["seamark:recommended_track:category"]({bbox});
  way["seamark:recommended_track:maximum_draught"]({bbox});
  way["seamark:fairway:category"]({bbox});
  node["seamark:type"~"{WATER_NAV_POINT_PATTERN}",i]({bbox});
  way["seamark:type"~"{WATER_NAV_POINT_PATTERN}",i]({bbox});
  relation["seamark:type"~"{WATER_NAV_POINT_PATTERN}",i]({bbox});
  node["natural"~"reef|shoal",i]({bbox});
);
out tags geom center 3000;
"""
    features: list[dict] = []
    try:
        overpass_payload, overpass_endpoint, overpass_errors = await _post_overpass_json(
            query,
            user_agent="Trailhead/1.0 (water navigation lines)",
        )
        for el in overpass_payload.get("elements") or []:
            feature = _water_nav_line_feature(el)
            if feature:
                features.append(feature)
                continue
            feature = _water_nav_point_feature(el)
            if feature:
                features.append(feature)
    except Exception as exc:
        return {
            "type": "FeatureCollection",
            "features": [],
            "source": "OpenStreetMap / OpenSeaMap",
            "error": f"{type(exc).__name__}: {exc}",
            "note": "Water follow lines unavailable right now.",
            "chart_profile": marine_chart_profile(_marine_bounds_from_params(n, s, e, w)),
            "counts": {"lines": 0, "points": 0, "hazards": 0, "aids": 0, "recommended_tracks": 0},
        }
    payload = {
        "type": "FeatureCollection",
        "features": features[:700],
        "source": "OpenStreetMap / OpenSeaMap",
        "generated_at": int(time.time()),
        "note": "Open seamark channels, recommended tracks, buoys, markers, lights, anchorages, locks, rocks, wrecks, and hazards where source data exists. Informational only.",
        "chart_profile": marine_chart_profile(_marine_bounds_from_params(n, s, e, w)),
        "counts": {
            "lines": sum(1 for feature in features if feature.get("geometry", {}).get("type") == "LineString"),
            "points": sum(1 for feature in features if feature.get("geometry", {}).get("type") == "Point"),
            "hazards": sum(1 for feature in features if feature.get("properties", {}).get("kind") == "water_hazard"),
            "aids": sum(1 for feature in features if feature.get("properties", {}).get("kind") in {"navigation_aid", "channel_marker"}),
            "recommended_tracks": sum(1 for feature in features if feature.get("properties", {}).get("kind") == "recommended_track"),
        },
        "overpass_endpoint": overpass_endpoint,
        "fallback_errors": overpass_errors[-2:],
    }
    set_cached("campsite_cache", key, payload)
    return payload

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


@app.get("/api/places/nearby")
async def nearby_places(
    lat: float,
    lng: float,
    radius: float = 25,
    categories: str = "fuel,water,trailhead,viewpoint",
    provider: str = "auto",
    user: dict | None = Depends(_optional_user),
):
    """Server-cached nearby services for app category search.

    This keeps public OSM services behind Trailhead caching/rate control and
    gives the app one production path for online + offline result merging.
    """
    requested_categories = {_normalize_place_category(t) for t in categories.split(",") if t.strip()}
    private_stay_only = _private_stay_only_place_request(requested_categories)
    private_stay_allowed_types = _private_stay_place_types_for_request(requested_categories) if private_stay_only else set()
    category_set, locked_categories, access_meta = _authorize_place_categories(requested_categories, user if isinstance(user, dict) else None)
    official_category_set = _official_free_categories_for_request(requested_categories)
    if private_stay_only:
        official_category_set = set()
    if provider in {"nps", "blm", "usfs"}:
        official_category_set = official_category_set or requested_categories
    discovery_categories = category_set | official_category_set
    if not discovery_categories:
        return []
    radius_m = int(min(max(radius, 1), 45) * 1609.344)
    provider = (provider or "auto").lower().strip()
    osm_places: list[dict] = []
    geoapify_places: list[dict] = []
    official_places: list[dict] = []

    official_tasks = []
    if provider in {"auto", "nps"} and nps_enabled() and official_category_set.intersection({"park", "historic", "attraction", "tourism", "camp", "camping", "visitor_center"}):
        official_tasks.append(get_nps_places(lat, lng, radius_m=radius_m, categories=official_category_set, limit=80))
    if provider in {"auto", "blm"} and official_category_set.intersection({"camp", "trailhead", "ohv", "water", "picnic", "attraction", "visitor_center"}):
        official_tasks.append(get_blm_recreation_sites(lat, lng, radius_miles=radius, categories=official_category_set))
    if provider in {"auto", "usfs"} and official_category_set.intersection({"camp", "trailhead", "ohv", "water", "picnic", "attraction", "visitor_center"}):
        official_tasks.append(get_usfs_recreation_sites(lat, lng, radius_miles=radius, categories=official_category_set))
    if official_tasks:
        batches = await asyncio.gather(*official_tasks, return_exceptions=True)
        for batch in batches:
            if isinstance(batch, list):
                official_places.extend(batch)

    if provider in {"auto", "osm"} and category_set and not private_stay_only:
        osm_places = await get_service_places(lat, lng, radius_m=radius_m, categories=category_set)
        if category_set.intersection({"fuel", "propane"}):
            dedicated_fuel = await get_fuel_stations(lat, lng, radius_m=int(min(max(radius, 1), 25) * 1609.344))
            if "fuel" in category_set:
                osm_places.extend(dedicated_fuel)
            elif "propane" in category_set:
                osm_places.extend([p for p in dedicated_fuel if str(p.get("fuel_types") or "").lower().find("propane") >= 0])
    if provider in {"auto", "geoapify"} and category_set:
        geoapify_categories = category_set if not private_stay_only else private_stay_allowed_types
        geoapify_places = await get_geoapify_places(lat, lng, radius_m=radius_m, categories=geoapify_categories, limit_per_category=18)

    def dist_mi(item: dict) -> float:
        try:
            return _haversine_m(lat, lng, float(item.get("lat")), float(item.get("lng"))) / 1609.344
        except Exception:
            return 9999.0

    merged: list[dict] = []
    seen: set[str] = set()
    for item in [*official_places, *osm_places, *geoapify_places]:
        name = str(item.get("name") or "").lower().strip()
        coord_key = f"{item.get('type')}:{name}:{round(float(item.get('lat', 0)), 4)}:{round(float(item.get('lng', 0)), 4)}"
        key = str(item.get("id") or coord_key)
        fuzzy_key = coord_key
        if fuzzy_key in seen:
            continue
        if key in seen:
            continue
        seen.add(key)
        seen.add(fuzzy_key)
        item["distance_mi"] = round(dist_mi(item), 2)
        merged.append(item)
    merged = _dedupe_nearby_places(merged)
    balanced = _balanced_nearby_places(merged, discovery_categories, dist_mi, limit=80)
    if private_stay_only:
        balanced = [item for item in balanced if _private_stay_place_type(item) in private_stay_allowed_types]
    if not private_stay_only and len(balanced) < 8:
        fallback_radius = max(float(radius), 75.0 if discovery_categories.intersection({"camp", "camping", "park", "historic", "attraction", "tourism", "trailhead", "viewpoint"}) else float(radius))
        fallback = _explore_catalog_fallback_places(lat, lng, fallback_radius, discovery_categories, limit=32)
        balanced = _merge_place_fallbacks(balanced, fallback, limit=80, min_results=8)
    for item in balanced:
        strip_lightweight_google_rich_fields(item)
        if _is_official_free_place(item):
            item["official_free"] = True
            item.setdefault("source_badge", item.get("source_label") or item.get("verified_source") or "Open official data")
            item.setdefault("source_freshness", "Official/open source data cached by Trailhead; verify current closures, hours, fees, and access with the source.")
        item.setdefault("category_access", {
            "explore_unlocked": access_meta["explore_unlocked"],
            "locked_categories": locked_categories,
            "official_free_categories": sorted(official_category_set),
            "unlock_cost": access_meta["unlock_cost"],
        })
    return balanced


@app.get("/api/places/search-card")
async def search_place_card(q: str, lat: float | None = None, lng: float | None = None):
    """Return the best rich provider card for a map search result."""
    query = (q or "").strip()
    if not query:
        return None
    if lat is not None and lng is not None:
        return {
            "id": f"search:{query.lower().replace(' ', '-')[:40]}:{float(lat):.5f}:{float(lng):.5f}",
            "name": query,
            "lat": float(lat),
            "lng": float(lng),
            "type": "locality" if _query_looks_like_locality(query) else "poi",
            "subtype": "City" if _query_looks_like_locality(query) else "poi",
            "display_type": "City" if _query_looks_like_locality(query) else "Place",
            "source": "search",
            "source_label": "Map search",
            "summary": "Selected map place.",
            "photo_status": "placeholder",
        }
    return None


BROAD_MAP_PLACE_TYPES = {
    "place",
    "locality",
    "city",
    "town",
    "village",
    "hamlet",
    "municipality",
    "neighborhood",
    "suburb",
    "district",
    "region",
}


def _query_looks_like_locality(query: str) -> bool:
    clean = re.sub(r"\s+", " ", str(query or "")).strip().lower()
    if not clean:
        return False
    parts = [part.strip() for part in clean.split(",") if part.strip()]
    return len(parts) >= 2 and not re.search(r"\d", clean) and all(len(part) > 1 for part in parts[:2])


def _is_broad_map_place(body: MapCardResolveRequest | None = None, card: dict | None = None) -> bool:
    typed = {
        _smart_pack_type(value)
        for value in (
            getattr(body, "kind", None),
            getattr(body, "type", None),
            getattr(body, "subtype", None),
            (card or {}).get("type"),
            (card or {}).get("subtype"),
        )
        if value
    }
    source = " ".join(str(value or "").lower() for value in (
        getattr(body, "source", None),
        getattr(body, "source_label", None),
        getattr(body, "selection_source", None),
        (card or {}).get("source"),
        (card or {}).get("source_label"),
    ))
    name = str((card or {}).get("name") or getattr(body, "name", "") or "")
    if typed.intersection(BROAD_MAP_PLACE_TYPES) and any(token in source for token in ("search", "mapbox", "map search", "geocode")):
        return True
    return any(token in source for token in ("search", "mapbox", "geocode")) and _query_looks_like_locality(name)


def _broad_place_display_type(body: MapCardResolveRequest | None = None, card: dict | None = None) -> str:
    typed = {
        _smart_pack_type(value)
        for value in (
            getattr(body, "type", None),
            getattr(body, "subtype", None),
            (card or {}).get("type"),
            (card or {}).get("subtype"),
        )
        if value
    }
    if typed.intersection({"neighborhood", "suburb", "district"}):
        return "Neighborhood"
    if "region" in typed:
        return "Region"
    if typed.intersection({"village", "hamlet"}):
        return "Town"
    if typed.intersection({"city", "town", "municipality", "locality", "place"}) or _query_looks_like_locality(str((card or {}).get("name") or getattr(body, "name", "") or "")):
        return "City"
    return "Place"


def _town_profile_cache_key(name: str, lat: float, lng: float, region: str = "", country: str = "", provider_id: str = "") -> str:
    clean = re.sub(r"\s+", " ", str(name or "").lower()).strip()
    region_key = re.sub(r"[^a-z0-9]+", "-", str(region or "").lower()).strip("-")
    country_key = re.sub(r"[^a-z0-9]+", "-", str(country or "").lower()).strip("-")
    provider_key = re.sub(r"[^a-z0-9:._-]+", "-", str(provider_id or "").lower()).strip("-")
    base = f"{clean}|{region_key}|{country_key}|{provider_key}|{float(lat):.3f}|{float(lng):.3f}"
    return f"town_profile_v2:{hashlib.sha1(base.encode()).hexdigest()[:24]}"


def _town_name_candidates(name: str) -> list[str]:
    raw_parts = [part.strip() for part in re.split(r",|\|", str(name or "")) if part.strip()]
    candidates = []
    if raw_parts:
        candidates.append(raw_parts[0])
        if len(raw_parts) >= 2:
            candidates.append(f"{raw_parts[0]}, {raw_parts[1]}")
    clean = re.sub(r"\s+", " ", str(name or "").strip())
    if clean:
        candidates.append(clean)
    out: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = candidate.lower()
        if key not in seen:
            seen.add(key)
            out.append(candidate)
    return out


def _wikidata_image_url(filename: object, width: int = 1200) -> str:
    raw = str(filename or "").strip()
    if not raw:
        return ""
    raw = raw.removeprefix("File:").strip().replace(" ", "_")
    digest = hashlib.md5(raw.encode("utf-8")).hexdigest()
    quoted = quote(raw, safe="()'!,.-_")
    return f"https://upload.wikimedia.org/wikipedia/commons/thumb/{digest[0]}/{digest[:2]}/{quoted}/{width}px-{quoted}"


async def _wikidata_profile(qid: str, client: httpx.AsyncClient | None = None) -> dict | None:
    clean_qid = re.sub(r"[^Q0-9]", "", str(qid or "").upper())
    if not clean_qid.startswith("Q"):
        return None
    close_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=7.0, headers={"User-Agent": "TrailheadPlaceCards/1.0"})
    try:
        resp = await client.get(
            "https://www.wikidata.org/wiki/Special:EntityData/{qid}.json".format(qid=clean_qid),
        )
        resp.raise_for_status()
        entity = ((resp.json().get("entities") or {}).get(clean_qid) or {})
        claims = entity.get("claims") or {}
        labels = entity.get("labels") or {}
        descriptions = entity.get("descriptions") or {}
        sitelinks = entity.get("sitelinks") or {}
        image_file = ""
        p18 = claims.get("P18") or []
        if p18:
            image_file = (((p18[0].get("mainsnak") or {}).get("datavalue") or {}).get("value") or "")
        wikipedia_title = ((sitelinks.get("enwiki") or {}).get("title") or "")
        profile = {
            "name": (labels.get("en") or {}).get("value") or "",
            "summary": (descriptions.get("en") or {}).get("value") or "",
            "wikidata_id": clean_qid,
            "wikipedia_title": wikipedia_title,
            "official_url": f"https://www.wikidata.org/wiki/{clean_qid}",
            "source": "wikidata",
            "source_label": "Wikidata",
            "source_badge": "Wikidata / Wikimedia",
        }
        image_url = _wikidata_image_url(image_file)
        if image_url:
            profile["photo_url"] = image_url
            profile["photos"] = [{"url": image_url, "caption": profile["name"] or wikipedia_title, "credit": "Wikimedia Commons", "source": "Wikidata"}]
        return profile
    except Exception:
        return None
    finally:
        if close_client:
            await client.aclose()


async def _open_place_wiki_profile(name: str, lat: float, lng: float, client: httpx.AsyncClient | None = None) -> dict | None:
    clean = re.sub(r"\s+", " ", (name or "").strip())
    if not clean or len(clean) < 2:
        return None
    search_name = clean.split(",", 1)[0].strip() or clean
    cache_key = f"place_wiki_{hashlib.sha1(f'{search_name}:{lat:.3f}:{lng:.3f}'.encode()).hexdigest()[:16]}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24 * 30)
    if cached is not None:
        return cached or None
    close_client = client is None
    try:
        if client is None:
            client = httpx.AsyncClient(timeout=7.0, headers={"User-Agent": "TrailheadPlaceCards/1.0"})
        resp = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "format": "json",
                "generator": "search",
                "gsrsearch": search_name,
                "gsrlimit": 5,
                "prop": "extracts|pageimages|info|coordinates|pageprops",
                "exintro": True,
                "explaintext": True,
                "exsentences": 3,
                "piprop": "original|thumbnail",
                "pithumbsize": 1100,
                "inprop": "url",
                "coprop": "type",
                "origin": "*",
            },
        )
        resp.raise_for_status()
        pages = (resp.json().get("query") or {}).get("pages") or {}
        name_norm = re.sub(r"[^a-z0-9]+", " ", search_name.lower()).strip()
        best: dict | None = None
        best_score = 999999.0
        for page in pages.values():
            title = str(page.get("title") or "")
            title_norm = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
            if name_norm and name_norm not in title_norm and title_norm not in name_norm:
                continue
            coords = page.get("coordinates") or []
            dist_m = 0.0
            if coords:
                coord = coords[0]
                try:
                    dist_m = _haversine_m(lat, lng, float(coord.get("lat")), float(coord.get("lon")))
                except Exception:
                    dist_m = 999999.0
            score = dist_m + abs(len(title_norm) - len(name_norm)) * 25
            if score < best_score:
                best = page
                best_score = score
        if not best:
            set_cached("campsite_cache", cache_key, {})
            return None
        image = (best.get("original") or {}).get("source") or (best.get("thumbnail") or {}).get("source") or ""
        qid = ((best.get("pageprops") or {}).get("wikibase_item") or "")
        profile = {
            "name": best.get("title") or search_name,
            "summary": _planner_clean_text(best.get("extract") or "", 700),
            "photo_url": image,
            "photos": [{"url": image, "caption": best.get("title") or search_name, "credit": "Wikipedia / Wikimedia Commons", "source": "Wikipedia"}] if image else [],
            "official_url": best.get("fullurl") or "",
            "wikidata_id": qid,
            "wikipedia_title": best.get("title") or "",
            "source": "wikipedia",
            "source_label": "Wikipedia",
            "source_badge": "Wikipedia / Wikimedia",
            "source_freshness": "Wikipedia/Wikimedia context cached by Trailhead; verify current local conditions with official sources.",
            "last_checked": int(time.time()),
        }
        set_cached("campsite_cache", cache_key, profile)
        return profile
    except Exception:
        set_cached("campsite_cache", cache_key, {})
        return None
    finally:
        if close_client and client is not None:
            await client.aclose()


async def _nominatim_town_profile(name: str, lat: float, lng: float, client: httpx.AsyncClient) -> dict | None:
    candidates = _town_name_candidates(name)
    try:
        for query in candidates:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": query,
                    "format": "jsonv2",
                    "limit": 5,
                    "addressdetails": 1,
                    "extratags": 1,
                    "namedetails": 1,
                },
            )
            resp.raise_for_status()
            records = resp.json() if isinstance(resp.json(), list) else []
            best = None
            best_score = 999999.0
            for record in records:
                try:
                    dist = _haversine_m(lat, lng, float(record.get("lat")), float(record.get("lon")))
                except Exception:
                    dist = 999999.0
                rtype = _smart_pack_type(record.get("type") or record.get("class"))
                type_penalty = 0 if rtype in BROAD_MAP_PLACE_TYPES or str(record.get("class")) == "place" else 180000
                score = dist + type_penalty
                if score < best_score:
                    best = record
                    best_score = score
            if not best:
                continue
            extratags = best.get("extratags") if isinstance(best.get("extratags"), dict) else {}
            namedetails = best.get("namedetails") if isinstance(best.get("namedetails"), dict) else {}
            address = best.get("address") if isinstance(best.get("address"), dict) else {}
            image = extratags.get("image") or ""
            if image and not str(image).startswith(("http://", "https://")):
                image = ""
            wikipedia = extratags.get("wikipedia") or ""
            wiki_title = wikipedia.split(":", 1)[1] if ":" in wikipedia else wikipedia
            profile = {
                "name": namedetails.get("name") or best.get("name") or (candidates[0] if candidates else name),
                "lat": float(best.get("lat") or lat),
                "lng": float(best.get("lon") or lng),
                "display_name": best.get("display_name") or "",
                "country": address.get("country") or "",
                "region": address.get("state") or address.get("region") or address.get("county") or "",
                "county": address.get("county") or "",
                "wikidata_id": extratags.get("wikidata") or "",
                "wikipedia_title": wiki_title,
                "source": "osm",
                "source_label": "OpenStreetMap",
                "source_badge": "OpenStreetMap / Nominatim",
                "source_freshness": "OpenStreetMap/Nominatim place identity cached by Trailhead; verify current local conditions with official sources.",
                "last_checked": int(time.time()),
            }
            if image:
                profile["photo_url"] = image
                profile["photos"] = [{"url": image, "caption": profile["name"], "credit": "OpenStreetMap linked open image", "source": "OpenStreetMap"}]
            return profile
    except Exception:
        return None
    return None


async def _geonames_town_profile(name: str, lat: float, lng: float, client: httpx.AsyncClient) -> dict | None:
    username = getattr(settings, "geonames_username", "") or ""
    if not username:
        return None
    try:
        resp = await client.get(
            "http://api.geonames.org/findNearbyWikipediaJSON",
            params={"lat": lat, "lng": lng, "radius": 20, "maxRows": 8, "username": username},
        )
        resp.raise_for_status()
        records = (resp.json() or {}).get("geonames") or []
        first_name = (_town_name_candidates(name) or [name])[0].lower()
        best = None
        for record in records:
            title = str(record.get("title") or "").lower()
            if first_name in title or title in first_name:
                best = record
                break
        best = best or (records[0] if records else None)
        if not best:
            return None
        thumb = best.get("thumbnailImg") or ""
        return {
            "name": best.get("title") or name,
            "summary": _planner_clean_text(best.get("summary") or "", 700),
            "lat": float(best.get("lat") or lat),
            "lng": float(best.get("lng") or lng),
            "photo_url": thumb,
            "photos": [{"url": thumb, "caption": best.get("title") or name, "credit": "GeoNames / Wikipedia", "source": "GeoNames"}] if thumb else [],
            "official_url": best.get("wikipediaUrl") if str(best.get("wikipediaUrl") or "").startswith("http") else (f"https://{best.get('wikipediaUrl')}" if best.get("wikipediaUrl") else ""),
            "source": "geonames",
            "source_label": "GeoNames",
            "source_badge": "GeoNames / Wikipedia",
            "source_freshness": "GeoNames/Wikipedia context cached by Trailhead; verify current local conditions with official sources.",
            "last_checked": int(time.time()),
        }
    except Exception:
        return None


def _merge_town_profiles(*profiles: dict | None) -> dict | None:
    merged: dict = {}
    sources: list[str] = []
    for profile in profiles:
        if not isinstance(profile, dict) or not profile:
            continue
        for key, value in profile.items():
            if key == "photos":
                existing = merged.get("photos") or []
                next_photos = value if isinstance(value, list) else []
                for photo in next_photos:
                    url = photo.get("url") if isinstance(photo, dict) else str(photo or "")
                    if url and all((p.get("url") if isinstance(p, dict) else p) != url for p in existing):
                        existing.append(photo)
                if existing:
                    merged["photos"] = existing[:8]
                continue
            if value not in (None, "", []) and not merged.get(key):
                merged[key] = value
        source_label = profile.get("source_label") or profile.get("source_badge") or profile.get("source")
        if source_label and source_label not in sources:
            sources.append(str(source_label))
    if not merged:
        return None
    if not merged.get("photo_url") and merged.get("photos"):
        first = merged["photos"][0]
        merged["photo_url"] = first.get("url") if isinstance(first, dict) else first
    if sources:
        merged["source_label"] = sources[0]
        merged["source_badge"] = " · ".join(sources[:3])
    merged.setdefault("source", "town_profile")
    merged.setdefault("photo_status", "town_profile" if merged.get("photo_url") else "placeholder")
    merged.setdefault("last_checked", int(time.time()))
    return merged


async def _open_town_profile(card: dict, body: MapCardResolveRequest) -> dict | None:
    name = str(card.get("name") or body.name or "").strip()
    if not name:
        return None
    lat = float(card.get("lat") or body.lat)
    lng = float(card.get("lng") or body.lng)
    cache_key = _town_profile_cache_key(
        name,
        lat,
        lng,
        region=str(card.get("region") or ""),
        country=str(card.get("country") or ""),
        provider_id=str(body.provider_place_id or body.place_id or body.id or ""),
    )
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24 * 30)
    if cached is not None:
        return cached or None
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "TrailheadTownProfiles/1.0"}) as client:
            osm_profile = await _nominatim_town_profile(name, lat, lng, client)
            wikidata_profile = await _wikidata_profile((osm_profile or {}).get("wikidata_id") or "", client) if osm_profile else None
            wiki_name = (osm_profile or {}).get("wikipedia_title") or (wikidata_profile or {}).get("wikipedia_title") or name
            wiki_profile = await _open_place_wiki_profile(str(wiki_name), lat, lng, client)
            geonames_profile = await _geonames_town_profile(name, lat, lng, client)
            profile = _merge_town_profiles(osm_profile, wikidata_profile, wiki_profile, geonames_profile)
            if profile:
                profile["id"] = f"town_profile:{hashlib.sha1(f'{name}:{lat:.3f}:{lng:.3f}'.encode()).hexdigest()[:16]}"
                profile["source_freshness"] = profile.get("source_freshness") or "Open town profile data cached by Trailhead; verify current conditions with official local sources."
            set_cached("campsite_cache", cache_key, profile or {})
            return profile
    except Exception:
        set_cached("campsite_cache", cache_key, {})
        return None


def _map_card_base_from_request(body: MapCardResolveRequest) -> dict:
    source = (body.source or "search").strip().lower() or "search"
    kind = _smart_pack_type(body.kind or body.type or "place")
    name = re.sub(r"\s+", " ", (body.name or kind.replace("_", " ").title()).strip())
    card_type = _smart_pack_type(body.type or ("trail" if kind == "trail" else "camp" if kind == "camp" else "poi"))
    display_type = _broad_place_display_type(body) if _is_broad_map_place(body) else None
    return {
        "id": body.id or f"{source}:{card_type}:{float(body.lat):.5f}:{float(body.lng):.5f}",
        "name": name or "Selected place",
        "lat": float(body.lat),
        "lng": float(body.lng),
        "type": "locality" if display_type in {"City", "Town", "Neighborhood", "Region"} and card_type in {"place", "poi"} else card_type,
        "subtype": display_type or body.subtype or card_type,
        "display_type": display_type,
        "source": source,
        "source_label": body.source_label or ("Trailhead trail" if card_type == "trail" else "Map search" if source == "search" else body.source or "Map source"),
        "selection_source": body.selection_source or source,
        "feature_id": body.feature_id,
        "provider_place_id": body.provider_place_id,
        "place_id": body.place_id,
        "source_layer": body.source_layer,
        "screen_x": body.screen_x,
        "screen_y": body.screen_y,
        "screen_position": body.screen_position,
        "selection_confidence": body.selection_confidence,
        "raw_feature": body.raw_feature,
        "photo_url": body.photo_url,
        "summary": body.summary or ("Mapped trail route with nearby support context from Trailhead." if card_type == "trail" else "Selected map place."),
        "address": body.address,
        "rating": body.rating,
        "rating_count": body.rating_count,
        "country_code": body.country_code,
        "country": body.country,
        "region": body.region,
        "bbox": body.bbox,
        "photo_status": "open_photo" if body.photo_url else "placeholder",
    }


def _map_card_merge(primary: dict, secondary: dict | None) -> dict:
    if not secondary:
        return primary
    merged = dict(primary)
    preserve_primary_type = _smart_pack_type(primary.get("type")) in {"peak", "viewpoint", "trailhead", "hot_spring", "trail"}
    for key in (
        "id", "name", "lat", "lng", "type", "subtype",
        "provider_place_id", "place_id", "photo_url", "summary", "description", "details", "address", "phone",
        "website", "rating", "rating_count", "google_maps_uri", "access_note",
        "official_url", "booking_url", "registration_url", "start_date", "end_date", "price",
        "source_freshness", "source_badge",
    ):
        value = secondary.get(key)
        if value not in (None, "", []):
            if key in {"id", "lat", "lng"} and merged.get(key) not in (None, ""):
                continue
            if key == "type" and preserve_primary_type:
                continue
            if key == "name" and merged.get("name") and primary.get("source") != "search":
                continue
            merged[key] = value
    secondary_source = secondary.get("source_label") or secondary.get("attribution") or secondary.get("source")
    if secondary_source:
        merged["enriched_by"] = secondary_source
        if primary.get("source") == "search":
            merged["source"] = secondary.get("source") or merged.get("source")
            merged["source_label"] = secondary.get("source_label") or merged.get("source_label")
    for key in ("photos", "reviews", "hours"):
        if secondary.get(key):
            merged[key] = secondary.get(key)
    return merged


def _outdoor_google_match_ok(body: MapCardResolveRequest, item: dict) -> bool:
    requested = _smart_pack_type(body.type or body.kind or "")
    if requested not in {"peak", "viewpoint", "trailhead", "hot_spring"}:
        return True
    try:
        dist_m = _haversine_m(float(body.lat), float(body.lng), float(item.get("lat")), float(item.get("lng")))
    except Exception:
        return False
    if dist_m > (2500 if requested == "peak" else 1200):
        return False
    haystack = " ".join(str(item.get(k) or "").lower() for k in ("type", "subtype", "name", "summary", "address"))
    if requested == "peak":
        return any(token in haystack for token in ("peak", "summit", "mountain", "natural", "trail", "park", "view"))
    if requested == "viewpoint":
        return any(token in haystack for token in ("view", "overlook", "vista", "lookout", "trail", "park", "tourist"))
    if requested == "trailhead":
        return any(token in haystack for token in ("trail", "hiking", "park"))
    if requested == "hot_spring":
        return any(token in haystack for token in ("hot spring", "spring", "bath", "spa", "park"))
    return True


MAP_CARD_OVERNIGHT_TYPES = {
    "camp",
    "camping",
    "campground",
    "campsite",
    "rv",
    "rv_park",
    "caravan",
    "lodging",
    "hotel",
    "motel",
    "stay",
    "private_stay",
    "farm_stay",
    "ranch",
    "winery",
    "glamping",
    "private_camp",
}
MAP_CARD_OVERNIGHT_RE = re.compile(
    r"\b(campgrounds?|camp\s*sites?|campsites?|rv\s*(park|resort|camp)?|caravan|overnight|"
    r"places?\s+to\s+stay|lodg(?:e|ing)|hotel|motel|hostel|inn|cabin|glamping|hipcamp|"
    r"farm\s*stay|ranch\s*stay|winery\s*stay|private\s*(camp|stay))\b",
    re.I,
)
MAP_CARD_NON_OVERNIGHT_CAMP_RE = re.compile(r"\b(campus|summer camp|boot camp|training camp|campbell)\b", re.I)


def _map_card_search_text(body: MapCardResolveRequest, card: dict | None = None) -> str:
    values: list[str] = []
    for source in (body.__dict__, card or {}):
        if not isinstance(source, dict):
            continue
        for key in ("kind", "type", "subtype", "name", "source_layer", "source", "source_label", "summary", "address"):
            value = source.get(key)
            if value not in (None, "", []):
                values.append(str(value))
        raw = source.get("raw_feature")
        if isinstance(raw, dict):
            props = raw.get("properties") if isinstance(raw.get("properties"), dict) else raw
            for key in ("class", "type", "kind", "category", "maki", "name", "subclass"):
                value = props.get(key) if isinstance(props, dict) else None
                if value not in (None, "", []):
                    values.append(str(value))
    return " ".join(values)


def _map_card_is_overnight(body: MapCardResolveRequest, card: dict | None = None) -> bool:
    if str(body.id or "").startswith("ridb_site:"):
        return True
    typed = {
        _smart_pack_type(value)
        for value in (
            body.kind,
            body.type,
            body.subtype,
            (card or {}).get("type"),
            (card or {}).get("subtype"),
        )
        if value
    }
    if typed.intersection(MAP_CARD_OVERNIGHT_TYPES):
        return True
    text = _map_card_search_text(body, card)
    if MAP_CARD_NON_OVERNIGHT_CAMP_RE.search(text):
        return False
    return bool(MAP_CARD_OVERNIGHT_RE.search(text))


def _map_card_overnight_fallback(body: MapCardResolveRequest, card: dict) -> dict:
    text = _map_card_search_text(body, card).lower()
    is_private = any(token in text for token in ("farm", "ranch", "winery", "glamping", "private", "hipcamp"))
    is_lodging = any(token in text for token in ("hotel", "motel", "lodging", "hostel", "inn", "cabin")) and "camp" not in text
    is_rv = "rv" in text or "caravan" in text
    if is_private:
        land_type = _private_stay_label(_smart_pack_type(card.get("type") or body.type or "private_stay"), text)
        tags = ["private", "private_stay", "stay"]
    elif is_lodging:
        land_type = "Lodging"
        tags = ["stay", "lodging"]
    elif is_rv:
        land_type = "RV Park"
        tags = ["camp", "rv", "campground"]
    else:
        land_type = "Campground"
        tags = ["camp", "campground", "tent"]
    return {
        "id": str(card.get("id") or f"map_card:overnight:{float(body.lat):.5f}:{float(body.lng):.5f}"),
        "name": card.get("name") or body.name or "Overnight stop",
        "lat": float(card.get("lat") or body.lat),
        "lng": float(card.get("lng") or body.lng),
        "type": "private_stay" if is_private else "camp",
        "subtype": card.get("subtype") or body.subtype or land_type,
        "tags": tags,
        "land_type": land_type,
        "description": card.get("summary") or card.get("address") or "Map-sourced overnight option. Verify current access, booking rules, fees, and stay limits before relying on it.",
        "photo_url": card.get("photo_url") or "",
        "photos": card.get("photos") or [],
        "reservable": False,
        "cost": card.get("cost") or "",
        "url": card.get("website") or card.get("url") or "",
        "official_url": card.get("official_url") or "",
        "booking_url": card.get("booking_url") or "",
        "ada": False,
        "source": card.get("source") or body.source or "map",
        "verified_source": card.get("source_label") or body.source_label or "Map source",
        "source_badge": card.get("source_label") or body.source_label or "Map source",
        "rating": card.get("rating"),
        "rating_count": card.get("rating_count"),
        "phone": card.get("phone") or "",
        "address": card.get("address") or body.address or "",
        "provider_place_id": card.get("provider_place_id") or body.provider_place_id or body.place_id or "",
        "place_id": card.get("place_id") or body.place_id or "",
        "source_confidence": "review",
        "link_label": "Official page",
        "rich_detail_available": False,
        "rich_detail_reason": "Mapbox rendered place upgraded into Trailhead's overnight card flow; confirm details with the source.",
        "amenities": card.get("amenities") or [],
        "site_types": card.get("site_types") or ([land_type] if is_private or is_lodging else (["RV"] if is_rv else ["Tent", "Campground"])),
    }


def _map_card_camp_match_score(body: MapCardResolveRequest, camp: dict) -> float:
    try:
        distance_m = _haversine_m(float(body.lat), float(body.lng), float(camp.get("lat")), float(camp.get("lng")))
    except Exception:
        return 999999.0
    body_token = _camp_cluster_name(body.name)
    camp_token = _camp_cluster_name(camp.get("name"))
    score = distance_m
    if body_token and camp_token:
        if body_token == camp_token:
            score -= 900
        elif body_token in camp_token or camp_token in body_token:
            score -= 600
    score += _camp_source_rank(camp) * 80
    return score


async def _resolve_map_card_overnight(body: MapCardResolveRequest, card: dict) -> tuple[dict | None, dict | None]:
    if not _map_card_is_overnight(body, card):
        return None, None
    raw_id = str(body.id or "")
    if raw_id.startswith("ridb_site:"):
        parts = raw_id.split(":", 2)
        if len(parts) == 3:
            facility_id, site_id = parts[1], parts[2]
            try:
                site_card = await get_ridb_campsite_detail(facility_id, site_id)
            except Exception:
                site_card = None
            if site_card:
                try:
                    parent = await get_facility_detail(facility_id)
                except Exception:
                    parent = None
                return site_card, {**(parent or {}), "selected_site": site_card}
    source_text = f"{body.source or ''} {body.source_label or ''} {card.get('source') or ''} {card.get('source_label') or ''}".lower()
    if raw_id.isdigit() and any(token in source_text for token in ("ridb", "recreation.gov", "recreation")):
        try:
            detail = await get_facility_detail(raw_id)
        except Exception:
            detail = None
        if detail:
            return detail, detail
    candidates = await nearby_camps(body.lat, body.lng, radius=12, types="")
    close = [
        camp for camp in candidates
        if isinstance(camp, dict)
        and camp.get("lat") is not None
        and camp.get("lng") is not None
        and _camp_distance_m({"lat": body.lat, "lng": body.lng}, camp) <= 1800
    ]
    matched = min(close, key=lambda camp: _map_card_camp_match_score(body, camp), default=None)
    if not matched:
        fallback = _map_card_overnight_fallback(body, card)
        return fallback, None
    detail = None
    camp_id = str(matched.get("id") or "")
    if camp_id and not camp_id.startswith(("osm_", "blm_", "geoapify:", "mapbox:", "map_card:")):
        try:
            detail = await get_facility_detail(camp_id)
        except Exception:
            detail = None
    enriched = {**matched, **(detail or {})}
    if detail and not enriched.get("description"):
        enriched["description"] = detail.get("description")
    return enriched, detail


def _map_card_sections(card: dict, body: MapCardResolveRequest) -> list[dict]:
    sections: list[dict] = []
    if card.get("hours"):
        sections.append({"type": "hours", "title": "Hours", "items": card.get("hours") or []})
    if card.get("reviews"):
        sections.append({"type": "reviews", "title": "Reviews", "items": card.get("reviews") or []})
    if _smart_pack_type(card.get("type")) == "trail":
        sections.append({
            "type": "support",
            "title": "Trail support",
            "items": [
                "Nearby camps, trails, and useful stops load below.",
                "Verify current access, closures, road difficulty, and legality with the land manager.",
            ],
        })
    if body.kind == "camp" or _smart_pack_type(card.get("type")) == "camp" or _map_card_is_overnight(body, card):
        sections.append({
            "type": "access",
            "title": "Camp access",
            "items": ["Verify current access, fees, stay limits, fire restrictions, and road conditions before camping."],
        })
    return sections


def _normalize_map_card_display(card: dict, body: MapCardResolveRequest) -> dict:
    normalized = dict(card)
    ctype = _smart_pack_type(normalized.get("type"))
    name_text = str(normalized.get("name") or "")
    if _is_broad_map_place(body, normalized):
        display = _broad_place_display_type(body, normalized)
        normalized["type"] = "locality" if display in {"City", "Town", "Neighborhood", "Region"} else ctype
        normalized["subtype"] = display
        normalized["display_type"] = display
        normalized.setdefault("source_label", "Map search")
        normalized.setdefault("photo_status", "open_photo" if normalized.get("photo_url") or normalized.get("photos") else "placeholder")
    elif ctype == "camp":
        display = "Group Site" if re.search(r"\b(group\s+sites?|group\s+campsites?)\b", name_text, re.I) else "Campground"
        normalized["display_type"] = display
        normalized["subtype"] = normalized.get("land_type") or display
        normalized.setdefault("photo_status", "facility" if normalized.get("photo_url") or normalized.get("photos") else "placeholder")
    elif ctype == "event":
        normalized["display_type"] = "Event"
        normalized.setdefault("subtype", "Event")
    else:
        display = {
            "trail": "Trail",
            "trailhead": "Trailhead",
            "viewpoint": "Viewpoint",
            "peak": "Peak",
            "hot_spring": "Hot Spring",
            "water": "Water",
            "dump": "Dump",
            "fuel": "Fuel",
            "propane": "Propane",
            "mechanic": "Mechanic",
            "grocery": "Grocery",
            "food": "Food",
            "visitor_center": "Visitor Center",
            "park": "Park",
            "historic": "Historic Site",
            "attraction": "Attraction",
        }.get(ctype)
        if display:
            normalized["display_type"] = display
            normalized.setdefault("subtype", display)
    if not normalized.get("photo_status"):
        normalized["photo_status"] = "open_photo" if normalized.get("photo_url") or normalized.get("photos") else "placeholder"
    return normalized


def _is_weak_card_summary(value: object) -> bool:
    clean = re.sub(r"\s+", " ", str(value or "")).strip().lower()
    if not clean:
        return True
    weak = {
        "selected map place.",
        "selected map place",
        "place",
        "poi",
        "places",
    }
    if clean in weak:
        return True
    return clean.startswith("loading place details")


PLACE_CONTEXT_CATEGORIES = [
    "camp",
    "trailhead",
    "viewpoint",
    "peak",
    "hot_spring",
    "water",
    "fuel",
    "propane",
    "dump",
    "mechanic",
    "parking",
    "grocery",
    "food",
    "park",
    "historic",
    "attraction",
    "visitor_center",
    "event",
    "tour",
    "permit",
    "climbing",
    "ohv",
]


def _place_context_radius(card_type: str) -> float:
    ctype = _smart_pack_type(card_type)
    if ctype in {"city", "town", "locality", "place", "region", "neighborhood"}:
        return 55.0
    if ctype in {"camp", "camping", "campground"}:
        return 38.0
    return 32.0


def _context_status(related: dict, errors: dict | None = None) -> dict:
    rail_counts = {
        key: len(related.get(key) or [])
        for key in ("things_to_see", "things_to_do", "campgrounds_nearby", "trails", "trip_services", "visitor_centers")
    }
    total = sum(rail_counts.values())
    return {
        "status": "full" if total >= 6 and not errors else "partial" if total > 0 else "empty",
        "rail_counts": rail_counts,
        "errors": errors or {},
    }


async def _build_place_context(
    lat: float,
    lng: float,
    card_type: str = "place",
    route: list[list[float]] | None = None,
    camp_detail: dict | None = None,
    user: dict | None = None,
) -> tuple[dict, dict, dict]:
    errors: dict[str, str] = {}

    async def guarded(name: str, coro, default, timeout: float = 14.0):
        try:
            return await asyncio.wait_for(coro, timeout=timeout)
        except Exception as exc:
            errors[name] = str(exc)[:160]
            return default

    radius = _place_context_radius(card_type)
    nearby_task = guarded(
        "nearby",
        nearby_smart_pack(NearbySmartPackRequest(
            center=PlannerPoint(lat=float(lat), lng=float(lng)),
            radius=radius,
            categories=PLACE_CONTEXT_CATEGORIES,
            route=route or [],
        ), user=user),
        {"places": []},
        timeout=16.0,
    )
    trails_task = guarded(
        "trails",
        trails_discover(lat=float(lat), lng=float(lng), radius=min(radius, 55), mode="nearby", limit=16),
        {"trails": []},
        timeout=10.0,
    )
    related_pack, trail_pack = await asyncio.gather(nearby_task, trails_task)
    related = _related_rails_from_places((related_pack or {}).get("places") or [], (trail_pack or {}).get("trails", []), camp_detail)
    status = _context_status(related, errors)
    related["context_status"] = status
    related["rail_status"] = status
    return related, status, errors


PLACE_CONTEXT_RAIL_KEYS = ("things_to_do", "things_to_see", "visitor_centers", "campgrounds_nearby", "trip_services", "trails")


def _merge_context_rails_into_detail(detail: dict, related: dict | None, status: dict | None = None) -> dict:
    if not isinstance(detail, dict):
        return detail
    merged = dict(detail)
    related = related or {}
    for key in PLACE_CONTEXT_RAIL_KEYS:
        current = [item for item in (merged.get(key) or []) if isinstance(item, dict)]
        normalized_current = [_normalize_related_rail_item(item) for item in current]
        incoming = [item for item in (related.get(key) or []) if isinstance(item, dict)]
        if normalized_current:
            merged[key] = normalized_current
        elif incoming:
            merged[key] = incoming
    if related.get("camps") and not merged.get("campgrounds_nearby"):
        merged["campgrounds_nearby"] = related.get("camps")
    if status:
        merged["context_status"] = status
        merged["rail_status"] = status
    elif related.get("context_status"):
        merged["context_status"] = related.get("context_status")
        merged["rail_status"] = related.get("rail_status") or related.get("context_status")
    return merged


MAP_CARD_SAFE_TTL_SECONDS = 3600 * 24 * 7
MAP_CARD_PASSIVE_SOURCES = {
    "osm",
    "geoapify",
    "ridb",
    "recreation.gov",
    "blm",
    "offline",
    "smart_pack",
    "trailhead",
    "map",
    "map source",
}


def _map_card_cache_key(body: MapCardResolveRequest) -> str:
    base = "|".join([
        _smart_pack_type(body.kind or "place"),
        _smart_pack_type(body.type or ""),
        str(body.id or body.provider_place_id or body.place_id or ""),
        re.sub(r"\s+", " ", (body.name or "").lower()).strip(),
        f"{float(body.lat):.4f}",
        f"{float(body.lng):.4f}",
    ])
    return f"map_card_v11:{hashlib.sha1(base.encode()).hexdigest()[:24]}"


def _contains_restricted_provider(value: object) -> bool:
    if isinstance(value, str):
        lowered = value.lower()
        return any(
            token in lowered
            for token in (
                "googleapis.com",
                "googleusercontent.com",
                "gstatic.com",
                "maps.google",
                "foursquare.com",
                "4sqi.net",
            )
        )
    if isinstance(value, dict):
        source = str(value.get("source") or value.get("source_label") or value.get("attribution") or "").lower()
        if _legacy_place_source(source):
            return True
        return any(_contains_restricted_provider(v) for v in value.values())
    if isinstance(value, list):
        return any(_contains_restricted_provider(v) for v in value)
    return False


def _map_card_cacheable(body: MapCardResolveRequest, response: dict) -> bool:
    source = str(body.source or "").lower()
    if source in LEGACY_PLACE_PROVIDERS:
        return False
    return not _contains_restricted_provider(response)


@app.post("/api/map-card/resolve")
async def resolve_map_card(body: MapCardResolveRequest, user: dict | None = Depends(_optional_user)):
    """Resolve a selected map item into the richest fast card payload available.

    The client opens from the optimistic input immediately, then merges this
    result. Slow provider data is guarded so one vendor cannot block the card.
    """
    started = time.time()
    center_lat = float(body.lat)
    center_lng = float(body.lng)
    base = _map_card_base_from_request(body)
    errors: dict[str, str] = {}
    cache_key = _map_card_cache_key(body)
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=MAP_CARD_SAFE_TTL_SECONDS)
    if cached is not None and not _contains_restricted_provider(cached):
        cached["cached"] = True
        cached["cache_status"] = "hit"
        cached.setdefault("timings", {})["total_ms"] = round((time.time() - started) * 1000)
        return cached

    async def guarded(name: str, coro, default, timeout: float = 2.8):
        t0 = time.time()
        try:
            value = await asyncio.wait_for(coro, timeout=timeout)
            return value, round((time.time() - t0) * 1000)
        except Exception as exc:
            errors[name] = str(exc)[:160]
            return default, round((time.time() - t0) * 1000)

    provider = (body.source or "").lower()
    source_label = str(body.source_label or "").lower()
    provider_id = body.provider_place_id or body.place_id or ""
    raw_id = str(body.id or "")
    if not provider_id and raw_id.startswith(("google:", "foursquare:", "geoapify:")):
        provider, provider_id = raw_id.split(":", 1)
    is_trailhead_explore = (
        provider == "trailhead_explore"
        or source_label.startswith("trailhead explore")
        or source_label.startswith("trailhead verified")
        or raw_id.startswith("explore:")
        or str(provider_id or "").startswith("explore:")
    )

    timings: dict[str, int] = {}
    detail_task = None
    async def no_detail():
        return None, 0
    detail_task = no_detail()

    is_trailish = body.kind == "trail" or _smart_pack_type(body.type) in {"trail", "trailhead", "ohv"}
    photos_task = guarded("trail_photos", _open_trail_photos(body.name, center_lat, center_lng), []) if is_trailish else None
    context_type = "locality" if _is_broad_map_place(body, base) else _smart_pack_type(base.get("type") or body.type or body.kind or "place")
    context_radius = _place_context_radius(context_type)
    nearby_task = guarded(
        "nearby",
        nearby_smart_pack(NearbySmartPackRequest(
            center=PlannerPoint(lat=center_lat, lng=center_lng),
            radius=context_radius,
            categories=PLACE_CONTEXT_CATEGORIES,
            route=body.route or [],
        ), user=user if isinstance(user, dict) else None),
        {"places": []},
    )
    trails_task = guarded(
        "trails",
        trails_discover(lat=center_lat, lng=center_lng, radius=min(context_radius, 55), mode="nearby", limit=16),
        {"trails": []},
    )
    overnight_task = guarded("overnight_card", _resolve_map_card_overnight(body, base), (None, None), timeout=8.0) if not is_trailhead_explore and _map_card_is_overnight(body, base) else None
    if photos_task and overnight_task:
        (detail_value, detail_ms), (photos, photos_ms), (related_pack, nearby_ms), (trail_pack, trails_ms), ((camp_card, camp_detail), overnight_ms) = await asyncio.gather(detail_task, photos_task, nearby_task, trails_task, overnight_task)
        timings["trail_photos_ms"] = photos_ms
        timings["overnight_ms"] = overnight_ms
    elif photos_task:
        (detail_value, detail_ms), (photos, photos_ms), (related_pack, nearby_ms), (trail_pack, trails_ms) = await asyncio.gather(detail_task, photos_task, nearby_task, trails_task)
        camp_card = None
        camp_detail = None
        timings["trail_photos_ms"] = photos_ms
    elif overnight_task:
        (detail_value, detail_ms), (related_pack, nearby_ms), (trail_pack, trails_ms), ((camp_card, camp_detail), overnight_ms) = await asyncio.gather(detail_task, nearby_task, trails_task, overnight_task)
        photos = []
        timings["overnight_ms"] = overnight_ms
    else:
        (detail_value, detail_ms), (related_pack, nearby_ms), (trail_pack, trails_ms) = await asyncio.gather(detail_task, nearby_task, trails_task)
        photos = []
        camp_card = None
        camp_detail = None
    detail = None
    timings["nearby_ms"] = nearby_ms
    timings["trails_ms"] = trails_ms

    card = _map_card_merge(base, detail)
    if camp_card:
        card = _map_card_merge(card, camp_card)
        card["type"] = "camp"
        card["subtype"] = camp_card.get("land_type") or camp_card.get("subtype") or card.get("subtype") or "camp"
        for key in (
            "tags", "land_type", "amenities", "site_types", "activities", "cost", "reservable",
            "url", "official_url", "booking_url", "ada", "verified_source", "source_badge",
            "source_freshness", "reservation_notes", "last_checked", "campsites_count",
            "price_summary", "things_to_do", "things_to_see", "visitor_centers", "campgrounds_nearby", "permits", "tours", "events", "links",
            "site_media_count", "photo_fallback_chain", "photo_status", "mobile_coverage", "provider_notices",
        ):
            value = camp_card.get(key)
            if value not in (None, "", []):
                card[key] = value
    if photos and not card.get("photos"):
        card["photos"] = photos
        card["photo_url"] = card.get("photo_url") or photos[0].get("url")
    if camp_card and camp_card.get("photos") and not card.get("photos"):
        card["photos"] = camp_card.get("photos")
        if not card.get("photo_url"):
            first_photo = (camp_card.get("photos") or [None])[0]
            card["photo_url"] = first_photo.get("url") if isinstance(first_photo, dict) else first_photo

    smart_places = (related_pack or {}).get("places") or []
    related = _related_rails_from_places(smart_places, (trail_pack or {}).get("trails", []), camp_detail)
    if _is_broad_map_place(body, card):
        town_profile, town_ms = await guarded(
            "town_profile",
            _open_town_profile(card, body),
            None,
            timeout=8.0,
        )
        timings["town_profile_ms"] = town_ms
        if town_profile:
            town_summary = town_profile.get("summary")
            town_photos = town_profile.get("photos") or []
            if _is_weak_card_summary(card.get("summary")) and town_summary:
                card["summary"] = town_summary
                card["description"] = town_summary
            if not card.get("photo_url") and town_profile.get("photo_url"):
                card["photo_url"] = town_profile.get("photo_url")
                card["photos"] = town_photos
                card["photo_status"] = "open_photo"
            if town_profile.get("official_url") and not card.get("official_url"):
                card["official_url"] = town_profile.get("official_url")
                card["website"] = town_profile.get("official_url")
            card["town_profile"] = town_profile
            card["enriched_by"] = town_profile.get("source_label") or "Open town profile"
            card.setdefault("source_badge", town_profile.get("source_badge"))
            card.setdefault("source_freshness", town_profile.get("source_freshness"))
            card.setdefault("last_checked", town_profile.get("last_checked"))
    card = _normalize_map_card_display(card, body)
    if _is_weak_card_summary(card.get("summary")):
        ctype = _smart_pack_type(card.get("type"))
        if ctype == "peak":
            card["summary"] = "Mapped peak or summit feature. Verify route, access, weather, and exposure before using it as a destination."
        elif ctype == "viewpoint":
            card["summary"] = "Mapped viewpoint or overlook. Verify current access, parking, and road conditions before relying on it."
        elif ctype == "trailhead":
            card["summary"] = "Mapped trail access point. Check current closures, parking rules, and trail conditions before heading out."
        elif ctype == "hot_spring":
            card["summary"] = "Mapped hot spring or public bath feature. Verify access, rules, fees, and current conditions before visiting."
        elif _is_broad_map_place(body, card):
            display = card.get("display_type") or "place"
            card["summary"] = f"Selected {str(display).lower()} with nearby camps, trails, scenic places, events, and trip services from open source data."
        else:
            card["summary"] = card.get("address") or "Selected map place."
    card["source_label"] = card.get("source_label") or card.get("source") or "Trailhead"
    context_status = _context_status(related, errors)
    related["context_status"] = context_status
    related["rail_status"] = context_status
    enriched_by = card.get("enriched_by")
    display_source_label = card["source_label"]
    if enriched_by and str(enriched_by).lower() not in str(display_source_label).lower():
        display_source_label = f"{display_source_label} · enriched by {enriched_by}"
    photo_candidates = card.get("photos") or ([{"url": card["photo_url"], "source": card.get("source_label", "")}] if card.get("photo_url") else [])
    response = {
        "card": card,
        "photos": photo_candidates,
        "sections": _map_card_sections(card, body),
        "related": related,
        "camp": camp_card,
        "camp_detail": camp_detail,
        "display_source_label": display_source_label,
        "enriched_by": enriched_by,
        "cache_status": "miss",
        "photo_candidates": photo_candidates,
        "locked_sections": [],
        "partial": bool(errors),
        "errors": errors,
        "context_status": context_status,
        "rail_status": context_status,
        "cached": False,
        "cache_ttl_seconds": MAP_CARD_SAFE_TTL_SECONDS if _map_card_cacheable(body, {"card": card, "photos": card.get("photos") or [], "related": related}) else 0,
        "timings": {**timings, "total_ms": round((time.time() - started) * 1000)},
    }
    if response["cache_ttl_seconds"]:
        set_cached("campsite_cache", cache_key, response)
    return response


OUTDOOR_PLACE_PRIORITY = {
    "trailhead": 0,
    "trail": 1,
    "viewpoint": 2,
    "peak": 3,
    "hot_spring": 4,
    "park": 5,
    "historic": 6,
    "attraction": 7,
    "climbing": 8,
    "ohv": 9,
    "camp": 10,
    "camping": 11,
    "water": 12,
    "grocery": 16,
    "mechanic": 17,
    "food": 18,
    "hardware": 19,
    "parts": 20,
    "parking": 24,
    "dump": 25,
    "propane": 26,
    "fuel": 27,
}
UTILITY_PLACE_TYPES = {"fuel", "propane", "dump", "parking"}
TRIP_SERVICE_PLACE_TYPES = {"fuel", "propane", "dump", "parking", "mechanic", "water", "grocery", "food", "hardware", "parts"}
THINGS_TO_DO_PLACE_TYPES = {
    "trail",
    "trailhead",
    "hot_spring",
    "climbing",
    "ohv",
    "permit",
    "tour",
    "event",
}
THINGS_TO_SEE_PLACE_TYPES = {"viewpoint", "peak", "park", "historic", "attraction"}


def _place_type_priority(value: object) -> int:
    return OUTDOOR_PLACE_PRIORITY.get(_smart_pack_type(value), 50)


def _related_rails_from_places(smart_places: list[dict], trails: list[dict], camp_detail: dict | None = None) -> dict:
    things: list[dict] = []
    sights: list[dict] = []
    visitor_centers: list[dict] = []
    camps: list[dict] = []
    services: list[dict] = []
    seen: set[str] = set()

    def generic_key(item: dict) -> str:
        name = re.sub(r"[^a-z0-9]+", " ", str(item.get("name") or "").lower()).strip()
        if name in {"blm recreation site", "recreation site", "campground", "campsite", "visitor center", "trailhead", "viewpoint", "parking"}:
            return f"generic:{_smart_pack_type(item.get('type'))}:{name}"
        return ""

    def photo_backed(item: dict) -> bool:
        return bool(item.get("photo_url") or item.get("photos")) and str(item.get("photo_status") or "") != "placeholder"

    def add(bucket: list[dict], item: dict):
        item = _normalize_related_rail_item(item)
        try:
            key = str(item.get("id") or f"{item.get('type')}:{item.get('name')}:{round(float(item.get('lat', 0)), 4)}:{round(float(item.get('lng', 0)), 4)}")
        except Exception:
            key = str(item.get("id") or f"{item.get('type')}:{item.get('name')}")
        gkey = generic_key(item)
        if gkey and gkey in seen:
            return
        if key in seen:
            return
        seen.add(key)
        if gkey:
            seen.add(gkey)
        item.setdefault("photo_status", "open_photo" if item.get("photo_url") or item.get("photos") else "placeholder")
        item.setdefault("_rail_order", len(seen))
        bucket.append(item)

    def service_cluster_key(item: dict) -> str:
        ptype = _smart_pack_type(item.get("type") or item.get("category"))
        if ptype not in TRIP_SERVICE_PLACE_TYPES:
            return ""
        name = re.sub(r"[^a-z0-9]+", " ", str(item.get("name") or "").lower()).strip()
        if not name:
            return ""
        generic = {"dump station", "rv dump", "water", "potable water", "fuel", "gas station", "parking"}
        return f"{ptype}:{name if name not in generic else name}:{round(float(item.get('lat') or 0), 2)}:{round(float(item.get('lng') or 0), 2)}"

    def collapse_services(items: list[dict]) -> list[dict]:
        out: list[dict] = []
        for item in sorted(items, key=lambda p: (_place_source_priority(p), float(p.get("distance_mi") or p.get("route_distance_mi") or 9999))):
            key = service_cluster_key(item)
            merged = False
            for idx, existing in enumerate(out):
                same_named = key and key == service_cluster_key(existing)
                near_named = (
                    _smart_pack_type(item.get("type")) == _smart_pack_type(existing.get("type"))
                    and _place_cluster_name(item.get("name")) == _place_cluster_name(existing.get("name"))
                    and _place_distance_m(item, existing) <= 805
                )
                if same_named or near_named:
                    out[idx] = _merge_place_record(existing, item)
                    merged = True
                    break
            if not merged:
                out.append(item)
        return out

    for item in smart_places or []:
        ptype = _smart_pack_type(item.get("type") or item.get("category"))
        if ptype == "camp":
            add(camps, item)
        elif ptype in TRIP_SERVICE_PLACE_TYPES:
            if _is_low_value_generic_blm_place(item):
                continue
            add(services, item)
        elif ptype == "visitor_center":
            add(visitor_centers, item)
        elif ptype in THINGS_TO_SEE_PLACE_TYPES:
            if not _is_low_value_generic_blm_place(item) and (photo_backed(item) or not generic_key(item)):
                add(sights, item)
        else:
            if not _is_low_value_generic_blm_place(item) and (photo_backed(item) or not generic_key(item)):
                add(things, item)

    if camp_detail:
        for item in (camp_detail.get("things_to_do") or camp_detail.get("tours") or [])[:16]:
            if not isinstance(item, dict):
                continue
            ptype = _smart_pack_type(item.get("type"))
            if ptype in {"permit", "tour", "event"}:
                add(things, item)

    # Keep trail profiles as their own rail, but mirror lightweight trail cards
    # into Things to do so the first nearby rail behaves like an audio guide.
    for trail in (trails or [])[:8]:
        if not isinstance(trail, dict):
            continue
        raw_photos = trail.get("photos") if isinstance(trail.get("photos"), list) else []
        first_photo = raw_photos[0].get("url") if raw_photos and isinstance(raw_photos[0], dict) else (raw_photos[0] if raw_photos else trail.get("photo_url"))
        card = {
            "id": trail.get("id"),
            "name": trail.get("name"),
            "lat": trail.get("lat"),
            "lng": trail.get("lng"),
            "type": "trail",
            "subtype": trail.get("difficulty") or "trail",
            "source": trail.get("source"),
            "source_label": trail.get("source_label") or trail.get("source") or "Trailhead trails",
            "photo_url": first_photo,
            "summary": trail.get("summary") or trail.get("description"),
            "length_mi": trail.get("length_mi"),
            "distance_mi": trail.get("distance_mi"),
        }
        if card.get("name") and card.get("lat") is not None and card.get("lng") is not None:
            add(things, card)

    def rail(items: list[dict], limit: int) -> list[dict]:
        ranked = sorted(
            items,
            key=lambda item: (
                0 if item.get("photo_url") or item.get("photos") else 1,
                _place_source_priority(item),
                float(item.get("distance_mi") or item.get("route_distance_mi") or 9999),
                int(item.get("_rail_order") or 0),
            ),
        )[:limit]
        return [{k: v for k, v in item.items() if k != "_rail_order"} for item in ranked]

    return {
        "places": [*rail(things, 16), *rail(sights, 16), *rail(visitor_centers, 12)][:14],
        "camps": rail(camps, 10),
        "things_to_do": rail(things, 16),
        "things_to_see": rail(sights, 16),
        "visitor_centers": rail(visitor_centers, 12),
        "campgrounds_nearby": rail(camps, 12),
        "trip_services": rail(collapse_services(services), 4),
        "trails": (trails or [])[:10],
    }


def _normalize_related_rail_item(item: dict) -> dict:
    normalized = dict(item)
    ptype = _smart_pack_type(normalized.get("type") or normalized.get("category"))
    source_label = normalized.get("source_label") or normalized.get("source_badge") or normalized.get("verified_source") or normalized.get("attribution") or normalized.get("source")
    if source_label:
        normalized["source_label"] = source_label
    display = {
        "camp": "Group Site" if re.search(r"\b(group\s+sites?|group\s+campsites?)\b", str(normalized.get("name") or ""), re.I) else "Campground",
        "trail": "Trail",
        "trailhead": "Trailhead",
        "viewpoint": "Viewpoint",
        "peak": "Peak",
        "hot_spring": "Hot Spring",
        "event": "Event",
        "visitor_center": "Visitor Center",
        "park": "Park",
        "historic": "Historic Site",
        "attraction": "Attraction",
        "water": "Water",
        "dump": "Dump",
        "fuel": "Fuel",
        "propane": "Propane",
        "mechanic": "Mechanic",
        "grocery": "Grocery",
        "food": "Food",
        "parking": "Parking",
    }.get(ptype)
    if display:
        normalized["display_type"] = display
        if not normalized.get("subtype") or _smart_pack_type(normalized.get("subtype")) in {"poi", "place"}:
            normalized["subtype"] = display
    if not normalized.get("photo_status"):
        normalized["photo_status"] = "open_photo" if normalized.get("photo_url") or normalized.get("photos") else "placeholder"
    return normalized


def _is_low_value_generic_blm_place(item: dict | None, keep_services: bool = False) -> bool:
    if not isinstance(item, dict):
        return False
    ptype = _smart_pack_type(item.get("type") or item.get("category"))
    if keep_services and ptype in TRIP_SERVICE_PLACE_TYPES:
        return False
    name = re.sub(r"[^a-z0-9]+", " ", str(item.get("name") or "").lower()).strip()
    source = str(item.get("source") or item.get("source_label") or item.get("source_badge") or item.get("attribution") or "").lower()
    has_photo = bool(item.get("photo_url") or item.get("photos"))
    low_name = name in {"", "blm recreation site", "recreation site", "trailhead", "viewpoint", "parking", "campground", "campsite"}
    return "blm" in source and low_name and not has_photo


def _place_cluster_name(value: object) -> str:
    name = re.sub(r"\s+", " ", str(value or "").lower()).strip()
    name = re.sub(r"\([^)]*\)", " ", name)
    name = re.sub(r"\b(group\s+site|site|loop|area|unit)\s*#?\s*[a-z0-9-]+\b", " ", name)
    return re.sub(r"[^a-z0-9]+", "", name)[:42]


def _place_distance_m(a: dict, b: dict) -> float:
    try:
        return _haversine_m(float(a.get("lat")), float(a.get("lng")), float(b.get("lat")), float(b.get("lng")))
    except Exception:
        return 999999.0


def _place_source_priority(item: dict) -> int:
    source = str(item.get("source") or item.get("attribution") or "").lower()
    verified = str(item.get("verified_source") or item.get("source_label") or "").lower()
    if source in {"trailhead", "admin", "community"} or "trailhead" in verified:
        return 0
    if source in {"ridb", "blm", "nps", "usfs", "recreation.gov"} or any(v in verified for v in ("ridb", "blm", "nps", "recreation.gov", "forest service", "usfs")):
        return 1
    if source in {"active"} or "reserveamerica" in verified:
        return 2
    if source in {"offline", "osm", "openstreetmap"}:
        return 3
    if _legacy_place_source(source) or _legacy_place_source(verified):
        return 8
    return 5


def _merge_place_record(existing: dict, incoming: dict) -> dict:
    primary, secondary = (incoming, existing) if _place_source_priority(incoming) < _place_source_priority(existing) else (existing, incoming)
    merged = dict(primary)
    for key in ("photo_url", "photo_status", "summary", "address", "phone", "website", "rating", "rating_count", "google_maps_uri", "provider_place_id", "place_id"):
        if not merged.get(key):
            merged[key] = secondary.get(key)
    for key in ("photos", "reviews"):
        if not merged.get(key) and secondary.get(key):
            merged[key] = secondary.get(key)
    sources = sorted(set([
        *(existing.get("alternate_sources") or []),
        *(incoming.get("alternate_sources") or []),
        str(existing.get("source_label") or existing.get("source") or "").strip(),
        str(incoming.get("source_label") or incoming.get("source") or "").strip(),
    ]) - {""})
    if sources:
        merged["alternate_sources"] = sources
    return merged


def _dedupe_nearby_places(items: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    for item in sorted(items, key=lambda p: (_place_source_priority(p), 0 if p.get("photo_url") else 1)):
        name_key = _place_cluster_name(item.get("name"))
        ptype = _smart_pack_type(item.get("type") or item.get("category"))
        merged = False
        for idx, existing in enumerate(deduped):
            existing_type = _smart_pack_type(existing.get("type") or existing.get("category"))
            if ptype != existing_type:
                continue
            same_name = name_key and name_key == _place_cluster_name(existing.get("name"))
            near_same = _place_distance_m(item, existing) <= (220 if ptype == "camp" else 70)
            child_site = ptype == "camp" and re.search(r"\b(group\s+site|site|loop|area)\b", f"{item.get('name','')} {existing.get('name','')}", re.I)
            if (same_name and near_same) or (child_site and near_same):
                deduped[idx] = _merge_place_record(existing, item)
                merged = True
                break
        if not merged:
            deduped.append(item)
    return deduped


def _balanced_nearby_places(items: list[dict], requested: set[str], dist_fn, limit: int = 80) -> list[dict]:
    """Keep browse/search results from being monopolized by one utility type."""
    if not items:
        return []
    broad_explore = len(requested) > 3 or bool(requested.intersection({"trailhead", "viewpoint", "park", "historic", "attraction", "hot_spring", "peak"}))
    if not broad_explore:
        return sorted(items, key=lambda item: (_place_source_priority(item), dist_fn(item)))[:limit]

    buckets: dict[str, list[dict]] = {}
    for item in items:
        ptype = _smart_pack_type(item.get("type") or item.get("category"))
        buckets.setdefault(ptype, []).append(item)
    for bucket in buckets.values():
        bucket.sort(key=lambda item: (_place_source_priority(item), dist_fn(item)))

    result: list[dict] = []
    seen: set[str] = set()
    ordered_types = sorted(buckets, key=lambda ptype: (_place_type_priority(ptype), ptype))
    for ptype in ordered_types:
        if ptype in UTILITY_PLACE_TYPES:
            cap = 18 if requested.intersection(UTILITY_PLACE_TYPES) else 10
        else:
            cap = 10
        for item in buckets[ptype][:cap]:
            key = str(item.get("id") or f"{ptype}:{item.get('name')}:{item.get('lat')}:{item.get('lng')}")
            if key in seen:
                continue
            seen.add(key)
            result.append(item)
            if len(result) >= limit:
                return result

    for item in sorted(items, key=lambda item: (_place_source_priority(item), dist_fn(item))):
        ptype = _smart_pack_type(item.get("type") or item.get("category"))
        key = str(item.get("id") or f"{ptype}:{item.get('name')}:{item.get('lat')}:{item.get('lng')}")
        if key not in seen:
            seen.add(key)
            result.append(item)
            if len(result) >= limit:
                break
    return result


def _smart_pack_type(value: object) -> str:
    t = re.sub(r"[^a-z0-9_]+", "", str(value or "poi").lower().replace(" ", "_"))
    return t or "poi"

def _smart_place_from_camp(camp: dict, center_lat: float, center_lng: float, route: list[list[float]]) -> dict | None:
    try:
        lat = float(camp.get("lat"))
        lng = float(camp.get("lng"))
    except Exception:
        return None
    name = re.sub(r"\s+", " ", str(camp.get("name") or "")).strip()
    if not name:
        return None
    source = str(camp.get("verified_source") or camp.get("source") or "camp").lower()
    return {
        "id": str(camp.get("id") or f"camp:{lat:.5f}:{lng:.5f}"),
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": "camp",
        "subtype": camp.get("land_type") or "camp",
        "source": source,
        "source_label": camp.get("source_badge") or camp.get("verified_source") or camp.get("source_label") or "Camp data",
        "confidence": _excursion_source_confidence(source),
        "distance_mi": round(_haversine_m(center_lat, center_lng, lat, lng) / 1609.344, 2),
        "route_distance_mi": _excursion_route_distance_mi(center_lat, center_lng, {"lat": lat, "lng": lng}, route),
        "summary": _planner_clean_text(camp.get("description") or camp.get("land_type") or "Camp option near this area.", 260),
        "access_note": "Verify current access, fees, stay limits, fire restrictions, and road conditions before camping.",
        "photo_url": camp.get("photo_url"),
        "photos": camp.get("photos") or ([camp.get("photo_url")] if camp.get("photo_url") else []),
        "photo_status": camp.get("photo_status") or ("facility" if camp.get("photo_url") else "placeholder"),
        "website": camp.get("url"),
        "attribution": camp.get("verified_source") or camp.get("source") or "Trailhead",
    }

def _smart_place_from_poi(item: dict, center_lat: float, center_lng: float, route: list[list[float]]) -> dict | None:
    try:
        lat = float(item.get("lat"))
        lng = float(item.get("lng"))
    except Exception:
        return None
    ptype = _smart_pack_type(item.get("type") or item.get("subtype"))
    raw_name = re.sub(r"\s+", " ", str(item.get("name") or "")).strip()
    utility = ptype in {"fuel", "propane", "water", "dump", "parking"}
    has_card_value = raw_name or item.get("address") or item.get("phone") or item.get("website") or item.get("photo_url")
    if not has_card_value and not utility:
        return None
    name = raw_name or ptype.replace("_", " ").title()
    source = str(item.get("source") or "osm").lower()
    normalized = {
        **item,
        "id": str(item.get("id") or item.get("place_id") or f"{source}:{ptype}:{lat:.5f}:{lng:.5f}"),
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": ptype,
        "source": source,
        "source_label": item.get("source_label") or item.get("attribution") or "Open place data",
        "confidence": _excursion_source_confidence(source),
        "distance_mi": round(_haversine_m(center_lat, center_lng, lat, lng) / 1609.344, 2),
        "route_distance_mi": _excursion_route_distance_mi(center_lat, center_lng, {"lat": lat, "lng": lng}, route),
        "summary": _planner_clean_text(item.get("summary") or item.get("description") or item.get("address") or item.get("subtype") or "", 300),
        "description": _planner_clean_text(item.get("description") or item.get("details") or item.get("summary") or "", 5000),
        "details": _planner_clean_text(item.get("details") or "", 5000),
    }
    return strip_lightweight_google_rich_fields(normalized)

def _smart_place_from_excursion(item: dict, center_lat: float, center_lng: float, route: list[list[float]]) -> dict | None:
    try:
        lat = float(item.get("lat"))
        lng = float(item.get("lng"))
    except Exception:
        return None
    name = re.sub(r"\s+", " ", str(item.get("name") or "")).strip()
    if not name:
        return None
    xtype = _smart_pack_type(item.get("type") or "attraction")
    return {
        "id": str(item.get("id") or f"{item.get('source','excursion')}:{xtype}:{lat:.5f}:{lng:.5f}"),
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": xtype if xtype in {"trailhead", "viewpoint", "peak", "hot_spring", "water"} else "attraction",
        "subtype": item.get("subtype") or xtype,
        "source": item.get("source") or "excursion",
        "source_label": item.get("source_label") or "Trailhead",
        "confidence": item.get("source_confidence") or _excursion_source_confidence(str(item.get("source") or "")),
        "distance_mi": round(_haversine_m(center_lat, center_lng, lat, lng) / 1609.344, 2),
        "route_distance_mi": item.get("distance_from_route_mi") or _excursion_route_distance_mi(center_lat, center_lng, {"lat": lat, "lng": lng}, route),
        "summary": _planner_clean_text(item.get("summary") or item.get("why_go") or "", 320),
        "access_note": _planner_clean_text(item.get("access_notes") or item.get("risk_notes") or "", 260),
        "attribution": item.get("source_label") or item.get("source") or "Trailhead",
        "length_mi": item.get("length_mi"),
        "activities": item.get("activities") or [],
    }

async def _enrich_nearby_card_photos(items: list[dict], limit: int = 24) -> list[dict]:
    """Attach open/official photo status to nearby cards before mobile sees them."""
    enrichable_types = THINGS_TO_DO_PLACE_TYPES | THINGS_TO_SEE_PLACE_TYPES | {"visitor_center", "camp"}
    sem = asyncio.Semaphore(4)

    async def enrich_one(item: dict) -> dict:
        if not isinstance(item, dict):
            return item
        photos = item.get("photos") if isinstance(item.get("photos"), list) else []
        if item.get("photo_url") or photos:
            item.setdefault("photo_status", "facility" if _smart_pack_type(item.get("type")) == "camp" else "open_photo")
            return item
        ptype = _smart_pack_type(item.get("type"))
        name = re.sub(r"\s+", " ", str(item.get("name") or "").strip())
        generic = name.lower() in {"", "blm recreation site", "recreation site", "trailhead", "viewpoint", "campground", "campsite"}
        if ptype not in enrichable_types or generic:
            item["photo_status"] = "placeholder"
            return item
        try:
            async with sem:
                found = await _open_trail_photos(name, float(item.get("lat")), float(item.get("lng")))
        except Exception:
            found = []
        if found:
            item["photos"] = found
            item["photo_url"] = found[0].get("url") if isinstance(found[0], dict) else found[0]
            item["photo_status"] = "open_photo"
            item.setdefault("source_badge", item.get("source_label") or item.get("source") or "Open photo")
        else:
            item["photo_status"] = "placeholder"
        return item

    head = items[:limit]
    tail = items[limit:]
    enriched = await asyncio.gather(*(enrich_one(dict(item)) for item in head))
    for item in tail:
        if isinstance(item, dict):
            item.setdefault("photo_status", "open_photo" if item.get("photo_url") or item.get("photos") else "placeholder")
    return [*enriched, *tail]

@app.post("/api/nearby/smart-pack")
async def nearby_smart_pack(body: NearbySmartPackRequest, user: dict | None = Depends(_optional_user)):
    """Unified app-facing nearby discovery feed for rich place cards."""
    center_lat = float(body.center.lat)
    center_lng = float(body.center.lng)
    radius = max(2.0, min(float(body.radius or 35), 70.0))
    route = body.route or []
    route_points = _route_points_from_lonlat(route)
    route_scope = str(body.route_scope or "area").lower()
    requested_raw = {_normalize_place_category(c) for c in body.categories if str(c).strip()}
    requested_raw = requested_raw or {"camp", "fuel", "propane", "water", "dump", "trailhead", "viewpoint", "peak", "hot_spring", "mechanic", "parking", "camping", "park", "historic", "attraction", "visitor_center"}
    requested, locked_categories, access_meta = _authorize_place_categories(requested_raw, user if isinstance(user, dict) else None)
    official_requested = _official_free_categories_for_request(requested_raw)
    display_requested = requested | official_requested
    if not display_requested:
        display_requested = {"fuel", "water", "trailhead", "viewpoint"}
    errors: dict[str, str] = {}

    async def guarded(name: str, fn, default, timeout: float = 9.0):
        try:
            return await asyncio.wait_for(fn(), timeout=timeout)
        except Exception as exc:
            errors[name] = str(exc)
            return default

    camp_requested = bool(display_requested.intersection({"camp", "camps", "camping"}))
    place_requested = sorted(c for c in display_requested if c not in {"camp", "camps", "camping"})
    place_categories = ",".join(place_requested)
    camps_task = guarded("camps", lambda: nearby_camps(center_lat, center_lng, min(radius, 55), ""), []) if camp_requested else asyncio.sleep(0, result=[])
    places_task = guarded("places", lambda: nearby_places(center_lat, center_lng, min(radius, 45), place_categories, "auto", user if isinstance(user, dict) else None), [], timeout=14.0) if place_categories else asyncio.sleep(0, result=[])
    fuel_task = guarded("fuel", lambda: get_fuel_stations(center_lat, center_lng, radius_m=int(min(max(radius, 1), 25) * 1609.344)), [], timeout=8.0) if display_requested.intersection({"fuel", "propane"}) else asyncio.sleep(0, result=[])
    active_activity_task = guarded("active_activities", lambda: get_active_activities(center_lat, center_lng, radius_miles=min(radius, 45), limit=30), [], timeout=8.0) if display_requested.intersection({"event", "attraction", "park", "historic", "trailhead", "tour"}) else asyncio.sleep(0, result=[])
    excursions_task = guarded("excursions", lambda: excursions_nearby(ExcursionNearbyRequest(
        center=PlannerPoint(lat=center_lat, lng=center_lng),
        radius=radius,
        categories=list(display_requested),
        route=route,
        source_context="smart_pack",
    )), {"excursions": []})
    camps, places, fuel_places, active_activities, excursion_pack = await asyncio.gather(camps_task, places_task, fuel_task, active_activity_task, excursions_task)

    normalized: list[dict] = []
    if camp_requested:
        normalized.extend(filter(None, (_smart_place_from_camp(c, center_lat, center_lng, route) for c in camps[:80])))
    if place_categories:
        normalized.extend(filter(None, (_smart_place_from_poi(p, center_lat, center_lng, route) for p in places)))
    if display_requested.intersection({"fuel", "propane"}):
        normalized.extend(filter(None, (_smart_place_from_poi(p, center_lat, center_lng, route) for p in fuel_places)))
    normalized.extend(filter(None, (_smart_place_from_poi(p, center_lat, center_lng, route) for p in active_activities)))
    normalized.extend(filter(None, (_smart_place_from_excursion(e, center_lat, center_lng, route) for e in (excursion_pack or {}).get("excursions", []))))
    if len(route_points) >= 2:
        for item in normalized:
            _annotate_route_candidate(item, route_points, body.recommended_day)
    normalized = [item for item in normalized if not _is_low_value_generic_blm_place(item, keep_services=True)]

    deduped: list[dict] = []
    seen: set[str] = set()
    def smart_dist(item: dict) -> float:
        try:
            value = item.get("route_distance_mi")
            if value is None:
                value = item.get("distance_mi")
            return float(value if value is not None else 9999)
        except Exception:
            return 9999.0

    normalized = await _enrich_nearby_card_photos(normalized)
    normalized = _dedupe_nearby_places(normalized)
    normalized = [item for item in normalized if not _is_low_value_generic_blm_place(item, keep_services=True)]
    if route_scope == "leg" and len(route_points) >= 2:
        sorted_normalized = sorted(normalized, key=lambda p: (smart_dist(p), _place_type_priority(p.get("type")), _place_source_priority(p), p.get("confidence") != "high", p.get("name", "")))[:100]
    else:
        sorted_normalized = _balanced_nearby_places(normalized, display_requested, smart_dist, limit=80)
    final_sort = (lambda p: (smart_dist(p), _place_type_priority(p.get("type")), _place_source_priority(p), p.get("confidence") != "high", p.get("name", ""))) if route_scope == "leg" and len(route_points) >= 2 else (lambda p: (_place_type_priority(p.get("type")), _place_source_priority(p), smart_dist(p), p.get("confidence") != "high", p.get("name", "")))
    for item in sorted(sorted_normalized, key=final_sort):
        strip_lightweight_google_rich_fields(item)
        if _is_official_free_place(item):
            item["official_free"] = True
            item.setdefault("source_badge", item.get("source_label") or item.get("verified_source") or "Open official data")
            item.setdefault("source_freshness", "Official/open source data cached by Trailhead; verify current closures, hours, fees, and access with the source.")
        ptype = _smart_pack_type(item.get("type"))
        if _is_low_value_generic_blm_place(item, keep_services=True):
            continue
        if ptype not in display_requested and not (ptype == "attraction" and display_requested.intersection({"park", "historic", "climbing", "ohv", "attraction"})):
            continue
        try:
            key = f"{ptype}:{str(item.get('name','')).lower()}:{round(float(item.get('lat')), 4)}:{round(float(item.get('lng')), 4)}"
        except Exception:
            continue
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
        if len(deduped) >= 80:
            break
    return {
        "center": {"lat": center_lat, "lng": center_lng},
        "radius": radius,
        "categories": sorted(display_requested),
        "scope_id": body.scope_id,
        "recommended_day": body.recommended_day,
        "route_scope": route_scope,
        "places": deduped,
        "errors": errors,
        "category_access": {
            **access_meta,
            "locked_categories": locked_categories,
            "official_free_categories": sorted(official_requested),
        },
    }


@app.get("/api/places/{source}/{place_id}/detail")
async def place_detail(source: str, place_id: str, category: str = "", user: dict | None = Depends(_optional_user)):
    """Return selected-place details for rich cards.

    Legacy paid place providers are no longer used for Trailhead cards. Mapbox
    Search results are resolved through the Extreme Search Box proxy instead.
    """
    source = (source or "").lower().strip()
    if source in LEGACY_PLACE_PROVIDERS:
        raise HTTPException(410, "Legacy place provider details are disabled")
    raise HTTPException(404, "Place detail unavailable for this provider")


@app.get("/api/places/google/photo")
async def google_place_photo(name: str, max_width: int = 900):
    raise HTTPException(410, "Google place photos are disabled")


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
    ptype = "camp" if category == "camp" else str(item.get("type") or category or "poi")
    if ptype == "fuel":
        category = "fuel"
    elif ptype in {"water", "trailhead", "viewpoint", "peak", "hot_spring"}:
        category = ptype
    point = {
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
    if ptype == "camp" or category == "camp":
        official_url = item.get("official_url") or item.get("url") or item.get("website") or ""
        point.update({
            "official_url": official_url,
            "booking_url": item.get("booking_url") or (official_url if "recreation.gov" in str(official_url).lower() else ""),
            "photo_url": item.get("photo_url") or "",
            "reservable": bool(item.get("reservable")),
            "tags": item.get("tags") if isinstance(item.get("tags"), list) else [],
            "amenities": item.get("amenities") if isinstance(item.get("amenities"), list) else [],
            "site_types": item.get("site_types") if isinstance(item.get("site_types"), list) else [],
            "source_badge": item.get("source_badge") or item.get("verified_source") or item.get("source_label") or item.get("source") or "Camp source",
            "source_freshness": item.get("source_freshness") or "Camp source data cached by Trailhead; verify current access, fees, closures, and availability with the source.",
            "last_checked": int(item.get("last_checked") or time.time()),
        })
    return point

async def _gather_essentials_for_sample(sample: dict) -> list[dict]:
    lat = sample["lat"]
    lng = sample["lng"]
    fuel, camps, water, trailheads, viewpoints, peaks, hot_springs = await asyncio.gather(
        get_fuel_stations(lat, lng, radius_m=32000),
        nearby_camps(lat, lng, radius=35, types=""),
        get_water_sources(lat, lng, radius_m=24000),
        get_trailheads(lat, lng, radius_m=28000),
        get_viewpoints(lat, lng, radius_m=28000),
        get_peaks(lat, lng, radius_m=36000),
        get_hot_springs(lat, lng, radius_m=52000),
        return_exceptions=True,
    )
    merged: list[dict] = []
    for category, batch in (
        ("fuel", fuel), ("camp", camps), ("water", water), ("trailhead", trailheads),
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


@app.get("/api/places/{trailhead_place_id}")
async def api_get_place(trailhead_place_id: str):
    place = get_place(trailhead_place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    return place


# ── Explore catalog ────────────────────────────────────────────────────────────

@app.get("/api/explore/catalog")
async def explore_catalog():
    """Return the prebuilt featured Explore catalog. No request-time AI."""
    return _load_explore_catalog()

@app.get("/api/explore/catalog/index")
async def explore_catalog_index(q: str = "", category: str = "", limit: int = 500, cursor: int = 0):
    """Return lightweight Explore cards for scalable browsing."""
    catalog = _load_explore_catalog()
    places = list(catalog.get("places") or [])
    query_terms = _explore_query_terms(q)
    if query_terms:
        places = [place for place in places if _explore_query_terms_match(place, query_terms)]
    if category:
        requested = {_normalize_place_category(category)}
        places = [place for place in places if _explore_place_matches_category_request(place, requested)]
    places = sorted(places, key=lambda p: _explore_query_sort_key(p, query_terms))
    cursor = max(0, int(cursor or 0))
    limit = max(1, min(int(limit or 500), 1000))
    items = [_explore_place_index_item(place) for place in places[cursor:cursor + limit]]
    next_cursor = cursor + limit if cursor + limit < len(places) else None
    return {
        "schema_version": catalog.get("schema_version", 1),
        "catalog_id": catalog.get("catalog_id", ""),
        "generated_at": catalog.get("generated_at", 0),
        "count": len(places),
        "cursor": cursor,
        "next_cursor": next_cursor,
        "places": items,
    }


def _explore_route_rank_categories(categories: object) -> set[str]:
    raw: list[str] = []
    if isinstance(categories, list):
        raw = [str(item) for item in categories]
    elif isinstance(categories, str):
        raw = [part for part in categories.split(",")]
    return {_normalize_place_category(item) for item in raw if str(item).strip()}

def _explore_place_route_location(place: dict) -> dict | None:
    summary = place.get("summary") or {}
    for source in (summary, place):
        try:
            lat = float(source.get("lat"))
            lng = float(source.get("lng"))
        except Exception:
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            return {"lat": lat, "lng": lng}
    return None

def _explore_source_quality_score(place: dict) -> float:
    source_pack = place.get("source_pack") or {}
    sources = source_pack.get("sources") if isinstance(source_pack.get("sources"), list) else []
    source_text = " ".join(str(item.get("publisher") or item.get("name") or item.get("title") or item.get("kind") or "") for item in sources if isinstance(item, dict)).lower()
    source_text = " ".join([
        source_text,
        str(source_pack.get("primary") or ""),
        str((place.get("summary") or {}).get("source_title") or ""),
        str(place.get("quality") or ""),
    ]).lower()
    if place.get("verified") or any(term in source_text for term in ("nps", "national park service", "blm", "usfs", "forest service", "recreation.gov", "ridb", "official")):
        return 0.0
    if any(term in source_text for term in ("osm", "openstreetmap", "wikipedia", "wikimedia")):
        return 4.0
    return 8.0

def _explore_route_fit_label(distance_mi: float) -> str:
    if distance_mi <= 2:
        return "on route"
    if distance_mi <= 12:
        return "near route"
    if distance_mi <= 35:
        return "short detour"
    return "long detour"

def _rank_explore_places_for_route(
    places: list[dict],
    route_points: list[dict],
    *,
    categories: set[str] | None = None,
    q: str = "",
    limit: int = 48,
    max_distance_mi: float = 90,
) -> list[dict]:
    if len(route_points) < 2:
        return []
    query_terms = _explore_query_terms(q)
    ranked: list[tuple[float, dict]] = []
    max_distance = max(1.0, min(float(max_distance_mi or 90), 250.0))
    for place in places:
        if query_terms and not _explore_query_terms_match(place, query_terms):
            continue
        if categories and not _explore_place_matches_category_request(place, categories):
            continue
        location = _explore_place_route_location(place)
        if not location:
            continue
        projection = _route_projection_for_item(location, route_points)
        if not projection:
            continue
        distance_mi = float(projection.get("route_distance_mi") or 9999)
        if distance_mi > max_distance:
            continue
        summary = place.get("summary") or {}
        route_rank = (
            distance_mi * 10.0
            + float(projection.get("route_progress") or 0) * 3.0
            + _explore_source_quality_score(place)
            + min(float(summary.get("hero_rank") or summary.get("rank") or 9999), 9999.0) / 400.0
        )
        enriched = dict(place)
        enriched_summary = dict(summary)
        enriched_summary.update({
            "lat": location["lat"],
            "lng": location["lng"],
            "route_distance_mi": round(distance_mi, 2),
            "route_progress": projection.get("route_progress"),
            "route_progress_mi": projection.get("route_progress_mi"),
            "route_segment_index": projection.get("route_segment_index"),
            "route_fit": _explore_route_fit_label(distance_mi),
            "route_rank": round(route_rank, 3),
        })
        enriched["summary"] = enriched_summary
        enriched["route_rank"] = {
            "distance_mi": round(distance_mi, 2),
            "progress": projection.get("route_progress"),
            "progress_mi": projection.get("route_progress_mi"),
            "fit": enriched_summary["route_fit"],
            "score": round(route_rank, 3),
        }
        ranked.append((route_rank, enriched))
    ranked.sort(key=lambda item: item[0])
    return [item for _, item in ranked[:max(1, min(int(limit or 48), 120))]]

@app.post("/api/explore/route-rank")
async def explore_route_rank(body: ExploreRouteRankRequest):
    route_points = _route_points_from_any(body.route, limit=400)
    if len(route_points) < 2:
        raise HTTPException(400, "At least two route points are required")
    catalog = _load_explore_catalog()
    categories = _explore_route_rank_categories(body.categories)
    ranked = _rank_explore_places_for_route(
        list(catalog.get("places") or []),
        route_points,
        categories=categories,
        q=body.q,
        limit=body.limit,
        max_distance_mi=body.max_distance_mi,
    )
    return {
        "schema_version": catalog.get("schema_version", 1),
        "catalog_id": catalog.get("catalog_id", ""),
        "generated_at": catalog.get("generated_at", 0),
        "mode": body.mode or "route",
        "route_points": len(route_points),
        "categories": sorted(categories),
        "count": len(ranked),
        "places": ranked,
    }


@app.get("/api/explore/places")
async def explore_places(
    lat: float | None = None,
    lng: float | None = None,
    mode: str = "featured",
    q: str = "",
    category: str = "",
    limit: int = 60,
    cursor: int = 0,
):
    catalog = _load_explore_catalog()
    places = list(catalog.get("places") or [])
    query_terms = _explore_query_terms(q)
    if query_terms:
        places = [place for place in places if _explore_query_terms_match(place, query_terms)]
    if category:
        requested = {_normalize_place_category(category)}
        places = [place for place in places if _explore_place_matches_category_request(place, requested)]
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
        places = sorted(places, key=lambda p: _explore_query_sort_key(p, query_terms))
    cursor = max(0, int(cursor or 0))
    limit = max(1, min(limit, 100))
    page = places[cursor:cursor + limit]
    next_cursor = cursor + limit if cursor + limit < len(places) else None
    return {**catalog, "places": page, "mode": mode, "count": len(places), "cursor": cursor, "next_cursor": next_cursor}


def _find_explore_place(place_id: str) -> dict | None:
    for place in _load_explore_catalog().get("places") or []:
        if str(place.get("id") or "") == str(place_id):
            return place
    return None


@app.get("/api/explore/places/{place_id}")
async def explore_place_detail(place_id: str):
    place = _find_explore_place(place_id)
    if not place:
        raise HTTPException(404, "Explore place not found")
    return place


def _load_explore_experiences() -> dict:
    for path in (EXPLORE_BOOKABLE_EXPERIENCES, EXPLORE_TOURS_VIATOR):
        if path.exists():
            try:
                payload = json.loads(path.read_text())
                experiences = payload.get("experiences") if isinstance(payload, dict) else []
                fixture_enabled = str(os.getenv("VIATOR_ENABLE_FIXTURE_DATA", "")).lower() in {"1", "true", "yes", "on"}
                if payload.get("fixture_mode") and not fixture_enabled:
                    continue
                if isinstance(experiences, list):
                    return {
                        "schema_version": payload.get("schema_version", 1),
                        "source": payload.get("source", "viator"),
                        "attribution": payload.get("attribution", "Tours and experiences sourced from Viator."),
                        "generated_at": payload.get("generated_at", 0),
                        "count": len(experiences),
                        "experiences": experiences,
                    }
            except Exception:
                continue
    return {
        "schema_version": 1,
        "source": "viator",
        "attribution": "Tours and experiences sourced from Viator.",
        "generated_at": 0,
        "count": 0,
        "experiences": [],
    }


def _experience_distance_filter(experiences: list[dict], lat: float | None, lng: float | None, radius_mi: float) -> list[dict]:
    if lat is None or lng is None:
        return list(experiences)
    out = []
    for item in experiences or []:
        try:
            item_lat = float(item.get("lat"))
            item_lng = float(item.get("lng"))
            distance = _haversine_m(float(lat), float(lng), item_lat, item_lng) / 1609.344
        except Exception:
            continue
        if distance <= radius_mi:
            enriched = dict(item)
            enriched["distance_mi"] = round(distance, 1)
            out.append(enriched)
    return out


def _find_experience(experience_id: str) -> dict | None:
    decoded = unquote(str(experience_id or ""))
    for item in _load_explore_experiences().get("experiences") or []:
        if str(item.get("id") or "") == decoded:
            return item
    return None


def _experience_query_text(item: dict) -> str:
    values = [
        item.get("id"),
        item.get("title"),
        item.get("category"),
        item.get("region"),
        item.get("country"),
        item.get("summary"),
        item.get("description"),
        " ".join(item.get("subcategories") or []),
        " ".join(item.get("highlights") or []),
    ]
    return " ".join(str(v or "") for v in values).lower()


def _filter_experiences_by_query(experiences: list[dict], q: str = "") -> list[dict]:
    cleaned = re.sub(
        r"\b(things to do|tour|tours|experience|experiences|activity|activities|ticket|tickets|guide|guided|book|booking)\b",
        " ",
        str(q or "").lower(),
    )
    query_terms = [t for t in re.split(r"\s+", cleaned.strip()) if len(t) >= 2]
    if not query_terms:
        return list(experiences)
    return [item for item in experiences if all(term in _experience_query_text(item) for term in query_terms)]


def _experience_response(source: str, results: list[dict], place_id: str = "", cache_status: str = "fresh") -> dict:
    return {
        "source": source or "viator",
        "place_id": place_id,
        "results": results,
        "count": len(results),
        "attribution": "Tours and experiences sourced from Viator.",
        "cache_status": cache_status,
    }


@app.get("/api/explore/places/{place_id}/experiences")
async def explore_place_experiences(place_id: str, source: str = "viator", limit: int = 12, radius: float | None = None):
    place = _find_explore_place(place_id)
    if not place:
        raise HTTPException(404, "Explore place not found")
    summary = place.get("summary") or {}
    lat = summary.get("lat")
    lng = summary.get("lng")
    radius_mi = max(5.0, min(float(radius or _explore_experience_radius_mi(place)), 100.0))
    payload = _load_explore_experiences()
    experiences = [
        item for item in payload.get("experiences") or []
        if source in {"", "all"} or str(item.get("source") or "").lower() == source.lower()
    ]
    nearby = _experience_distance_filter(experiences, float(lat) if isinstance(lat, (int, float)) else None, float(lng) if isinstance(lng, (int, float)) else None, radius_mi)
    ranked = rank_experiences(nearby, place)[:max(1, min(int(limit or 12), 24))]
    return _experience_response(source, ranked, place_id=place_id, cache_status="fresh" if payload.get("generated_at") else "empty")


@app.get("/api/explore/experiences")
async def explore_experiences(lat: float | None = None, lng: float | None = None, radius: float = 30, source: str = "viator", limit: int = 20, q: str = ""):
    payload = _load_explore_experiences()
    experiences = [
        item for item in payload.get("experiences") or []
        if source in {"", "all"} or str(item.get("source") or "").lower() == source.lower()
    ]
    experiences = _filter_experiences_by_query(experiences, q)
    nearby = _experience_distance_filter(experiences, lat, lng, max(1.0, min(float(radius or 30), 100.0)))
    ranked = rank_experiences(nearby, lat=lat, lng=lng)[:max(1, min(int(limit or 20), 50))]
    return _experience_response(source, ranked, cache_status="fresh" if payload.get("generated_at") else "empty")


@app.post("/api/explore/experiences/refresh")
async def explore_experience_refresh(source: str = "viator", destination_id: str = "", limit: int = 12):
    if source.lower() != "viator":
        raise HTTPException(400, "Only Viator refresh is supported in this source pack.")
    config = viator_config_from_env()
    client = ViatorClient(config)
    if not client.ready():
        return {
            "ok": False,
            "source": "viator",
            "status": "disabled",
            "results": [],
            "message": "Set VIATOR_API_KEY and VIATOR_ENABLE_LIVE=true to refresh live Viator Basic Access products.",
        }
    payload = client.search_products(destination_id=destination_id, count=limit)
    experiences = [item.to_dict() for item in normalize_viator_products(payload, ttl_hours=config.cache_ttl_hours)]
    return {
        "ok": True,
        "source": "viator",
        "status": payload.get("status", "live"),
        "results": experiences,
        "count": len(experiences),
        "message": "Live Viator refresh returned external-booking products. Persist via importer before serving broadly.",
    }


@app.get("/api/explore/experiences/{experience_id}")
async def explore_experience_detail(experience_id: str):
    item = _find_experience(experience_id)
    if not item:
        raise HTTPException(404, "Experience not found")
    return item


def _explore_experience_radius_mi(place: dict) -> float:
    summary = place.get("summary") or {}
    hay = " ".join(str(v or "").lower() for v in (
        summary.get("category"),
        summary.get("explore_group"),
        summary.get("title"),
        place.get("category"),
    ))
    if any(term in hay for term in ("fuel", "resupply", "town", "service")):
        return 20.0
    if any(term in hay for term in ("park", "trail", "water", "glacier", "offroad", "scenic")):
        return 50.0
    if any(term in hay for term in ("pakistan", "karakoram", "remote")):
        return 80.0
    return 30.0


def _explore_camp_radius_mi(place: dict, requested: float | None = None) -> float:
    if requested is not None:
        return max(5.0, min(float(requested), 75.0))
    summary = place.get("summary") or {}
    source_pack = place.get("source_pack") or {}
    raw = (
        source_pack.get("camp_search_radius_mi")
        or summary.get("camp_search_radius_mi")
        or place.get("camp_search_radius_mi")
    )
    try:
        if raw is not None:
            return max(5.0, min(float(raw), 75.0))
    except Exception:
        pass
    group = str(summary.get("explore_group") or "").lower()
    return 45.0 if group in {"camping", "parks"} else 35.0


def _camp_image_value(camp: dict) -> str:
    for key in ("photo_url", "hero_photo_url", "primary_image", "image_url"):
        val = camp.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    for key in ("photos", "images", "photo_candidates"):
        vals = camp.get(key)
        if not isinstance(vals, list):
            continue
        for item in vals:
            if isinstance(item, str) and item.strip():
                return item.strip()
            if isinstance(item, dict):
                val = item.get("url") or item.get("src")
                if isinstance(val, str) and val.strip():
                    return val.strip()
    return ""


def _explore_area_image_url(place: dict) -> str:
    summary = place.get("summary") or {}
    source_pack = place.get("source_pack") or {}
    for val in (
        summary.get("image_url"),
        summary.get("thumbnail_url"),
        source_pack.get("image_asset"),
    ):
        if isinstance(val, str) and val.strip():
            return val.strip()
    for photo in source_pack.get("photos") or []:
        if isinstance(photo, dict) and isinstance(photo.get("url"), str) and photo["url"].strip():
            return photo["url"].strip()
    return ""


def _rank_explore_camps(camps: list[dict], place: dict, lat: float, lng: float) -> list[dict]:
    area_image = _explore_area_image_url(place)
    ranked: list[dict] = []
    for idx, camp in enumerate(camps or []):
        if not isinstance(camp, dict):
            continue
        enriched = dict(camp)
        try:
            dist_m = _haversine_m(lat, lng, float(enriched.get("lat")), float(enriched.get("lng")))
            enriched["distance_mi"] = round(dist_m / 1609.344, 1)
        except Exception:
            enriched["distance_mi"] = None
        has_source_photo = bool(_camp_image_value(enriched))
        if not has_source_photo and area_image:
            enriched["photo_url"] = area_image
            enriched["photo_status"] = "area_fallback"
        source = " ".join(str(enriched.get(k) or "") for k in ("source_badge", "verified_source", "source"))
        score = 0
        if has_source_photo:
            score += 100
        elif area_image:
            score += 20
        if re.search(r"recreation|nps|national park|official", source, re.I):
            score += 30
        if enriched.get("reservable"):
            score += 10
        if enriched.get("cost"):
            score += 3
        dist = enriched.get("distance_mi")
        if isinstance(dist, (int, float)):
            score -= min(float(dist), 80.0) * 0.35
        enriched["_explore_rank_score"] = round(score, 3)
        enriched["_explore_original_index"] = idx
        ranked.append(enriched)
    ranked.sort(key=lambda c: (-(c.get("_explore_rank_score") or 0), c.get("distance_mi") if isinstance(c.get("distance_mi"), (int, float)) else 999, c.get("_explore_original_index") or 0))
    for camp in ranked:
        camp.pop("_explore_rank_score", None)
        camp.pop("_explore_original_index", None)
    return ranked


@app.get("/api/explore/places/{place_id}/campgrounds")
async def explore_place_campgrounds(place_id: str, radius: float | None = None, limit: int = 24, types: str = ""):
    place = _find_explore_place(place_id)
    if not place:
        raise HTTPException(404, "Explore place not found")
    summary = place.get("summary") or {}
    lat = summary.get("lat")
    lng = summary.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        raise HTTPException(400, "Explore place has no map coordinates")
    radius_mi = _explore_camp_radius_mi(place, radius)
    limit = max(1, min(int(limit), 48))
    camps = await _aggregate_nearby_camps(float(lat), float(lng), radius_mi, types)
    ranked = _rank_explore_camps(camps, place, float(lat), float(lng))
    return {
        "place_id": place_id,
        "center": {"lat": float(lat), "lng": float(lng), "name": summary.get("title") or place_id},
        "radius_mi": radius_mi,
        "count": len(ranked),
        "campgrounds": ranked[:limit],
    }


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
    country_filter = _countrycodes_for_query(name)

    async def _try(query: str):
        if token:
            try:
                feats = await _mapbox_forward_geocode_features(
                    client,
                    query,
                    limit=1,
                    country=country_filter,
                    types="place,address,poi",
                    language="en",
                )
                if feats:
                    place = _map_context_normalize_mapbox_feature(feats[0], category="place", source="mapbox_geocode")
                    if place:
                        return [place["lng"], place["lat"]], place.get("name") or feats[0].get("place_name", query)
            except Exception:
                pass
        try:
            params = {"format": "json", "limit": 1, "q": query}
            if country_filter:
                params["countrycodes"] = country_filter
            resp = await client.get("https://nominatim.openstreetmap.org/search", params=params)
            resp.raise_for_status()
            hits = resp.json()
            if hits:
                hit = hits[0]
                return [float(hit["lon"]), float(hit["lat"])], hit.get("display_name", query)
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
