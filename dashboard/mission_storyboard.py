"""AI-directed mission cinematic storyboard generation with Trailhead tool bridge context."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

import httpx

from config.settings import settings

MAX_SCENES = 16
SCENE_TYPES = {
    "intro",
    "whole_route",
    "day_flyover",
    "drive_leg",
    "trail_flythrough",
    "monument_orbit",
    "camp_arrival",
    "fuel_stop",
    "risk_focus",
    "weather_focus",
    "offline_readiness",
    "mission_recap",
    "poi_flyover",
    "route_rejoin",
}
CAMERA_MODES = {"fit", "fly", "orbit", "follow"}
CAMERA_PRESETS = {"low_pass"}
ORBIT_DIRECTIONS = {"cw", "ccw"}


def _finite_coord(lat: Any, lng: Any) -> bool:
    try:
        return float(lat) == float(lat) and float(lng) == float(lng)
    except (TypeError, ValueError):
        return False


def _route_midpoint(route: list) -> dict | None:
    if len(route) < 2:
        return None
    mid = route[len(route) // 2]
    if not isinstance(mid, (list, tuple)) or len(mid) < 2:
        return None
    return {"lng": float(mid[0]), "lat": float(mid[1])}


def _route_ratio(route: list, lat: float, lng: float) -> float:
    if len(route) < 2:
        return 0.5
    best_idx = 0
    best_dist = float("inf")
    for idx, point in enumerate(route):
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        d_lng = float(point[0]) - lng
        d_lat = float(point[1]) - lat
        dist = d_lng * d_lng + d_lat * d_lat
        if dist < best_dist:
            best_dist = dist
            best_idx = idx
    return best_idx / max(1, len(route) - 1)


def _clamp_ratio(value: float) -> float:
    return max(0.0, min(1.0, value))


def _sanitize_scene(raw: dict, idx: int) -> dict | None:
    scene_type = str(raw.get("type") or "drive_leg")
    if scene_type not in SCENE_TYPES:
        scene_type = "drive_leg"
    camera = raw.get("camera") if isinstance(raw.get("camera"), dict) else {}
    mode = str(camera.get("mode") or "fly")
    if mode not in CAMERA_MODES:
        mode = "fly"
    title = str(raw.get("title") or f"Scene {idx + 1}")[:120]
    subtitle = str(raw.get("subtitle") or "")[:160]
    narration = str(raw.get("narration") or "")[:320]
    duration = int(raw.get("durationMs") or 8000)
    duration = max(4000, min(14000, duration))
    route_slice = raw.get("routeSlice")
    clean_slice = None
    if isinstance(route_slice, list) and len(route_slice) == 2:
        try:
            clean_slice = [_clamp_ratio(float(route_slice[0])), _clamp_ratio(float(route_slice[1]))]
        except (TypeError, ValueError):
            clean_slice = None
    focus = raw.get("focus") if isinstance(raw.get("focus"), dict) else None
    clean_focus = None
    if focus and _finite_coord(focus.get("lat"), focus.get("lng")):
        clean_focus = {"lat": float(focus["lat"]), "lng": float(focus["lng"])}
    callouts = []
    for callout in (raw.get("callouts") or [])[:6]:
        if not isinstance(callout, dict):
            continue
        if not _finite_coord(callout.get("lat"), callout.get("lng")):
            continue
        callouts.append({
            "id": str(callout.get("id") or f"callout-{idx}-{len(callouts)}")[:80],
            "title": str(callout.get("title") or "Stop")[:120],
            "note": str(callout.get("note") or "")[:200] or None,
            "lat": float(callout["lat"]),
            "lng": float(callout["lng"]),
            "kind": str(callout.get("kind") or "poi")[:40],
        })
    layers = raw.get("layers") if isinstance(raw.get("layers"), dict) else {}
    day = raw.get("day")
    clean_day = int(day) if isinstance(day, (int, float)) and day > 0 else None

    def _clamped(value: Any, low: float, high: float) -> float | None:
        try:
            if value is None:
                return None
            return max(low, min(high, float(value)))
        except (TypeError, ValueError):
            return None

    clean_camera: dict[str, Any] = {
        "mode": mode,
        "zoom": _clamped(camera.get("zoom"), 4.0, 15.0),
        "pitch": _clamped(camera.get("pitch"), 0.0, 72.0),
        "bearing": float(camera["bearing"]) if camera.get("bearing") is not None else None,
    }
    orbit = camera.get("orbit") if isinstance(camera.get("orbit"), dict) else None
    if orbit:
        direction = str(orbit.get("direction") or "cw")
        clean_camera["orbit"] = {
            "direction": direction if direction in ORBIT_DIRECTIONS else "cw",
            "sweepDeg": _clamped(orbit.get("sweepDeg"), 30.0, 180.0) or 90.0,
        }
    preset = str(camera.get("preset") or "")
    if preset in CAMERA_PRESETS:
        clean_camera["preset"] = preset
    rejoin_ratio = raw.get("rejoinRatio")
    clean_rejoin = None
    if rejoin_ratio is not None:
        try:
            clean_rejoin = _clamp_ratio(float(rejoin_ratio))
        except (TypeError, ValueError):
            clean_rejoin = None

    return {
        "id": str(raw.get("id") or f"scene-{idx}")[:80],
        "type": scene_type,
        "title": title,
        "subtitle": subtitle,
        "day": clean_day,
        "durationMs": duration,
        "routeSlice": clean_slice,
        "focus": clean_focus,
        "rejoinRatio": clean_rejoin,
        "camera": clean_camera,
        "layers": {
            "terrain": bool(layers.get("terrain")),
            "warning": bool(layers.get("warning")),
        },
        "narration": narration,
        "callouts": callouts,
    }


def _normalize_route(route: list) -> list[list[float]]:
    clean: list[list[float]] = []
    for point in route or []:
        lat = lng = None
        if isinstance(point, dict):
            try:
                lat = float(point.get("lat"))
                lng = float(point.get("lng"))
            except (TypeError, ValueError):
                continue
        elif isinstance(point, (list, tuple)) and len(point) >= 2:
            try:
                lng = float(point[0])
                lat = float(point[1])
            except (TypeError, ValueError):
                continue
        if lat is None or lng is None or not _finite_coord(lat, lng):
            continue
        clean.append([lng, lat])
    return clean[:400]


def _sanitize_cinematic(raw: dict, trip_id: str | None, trip_name: str, route: list) -> dict:
    scenes_in = raw.get("scenes") if isinstance(raw.get("scenes"), list) else []
    scenes = []
    for idx, item in enumerate(scenes_in[:MAX_SCENES]):
        if not isinstance(item, dict):
            continue
        scene = _sanitize_scene(item, idx)
        if scene:
            scenes.append(scene)
    if len(scenes) < 2:
        raise ValueError("storyboard_too_short")
    types = {s["type"] for s in scenes}
    if "intro" not in types:
        scenes.insert(0, _fallback_intro(trip_name, route))
    if "mission_recap" not in types:
        scenes.append(_fallback_recap(trip_name))
    sources = list({str(s) for s in (raw.get("sources") or []) if s})
    sources.extend(["trailhead", "mission_storyboard"])
    return {
        "id": str(raw.get("id") or f"mission-{uuid.uuid4().hex[:12]}"),
        "tripId": trip_id,
        "title": str(raw.get("title") or trip_name)[:120],
        "route": route[:400],
        "scenes": scenes[:MAX_SCENES],
        "generatedAt": int(raw.get("generatedAt") or time.time() * 1000),
        "sources": list(dict.fromkeys(sources))[:12],
    }


def _fallback_intro(trip_name: str, route: list) -> dict:
    return {
        "id": "scene-intro",
        "type": "intro",
        "title": trip_name,
        "subtitle": "Trip overview",
        "durationMs": 9000,
        "camera": {"mode": "fit", "pitch": 52, "zoom": 9.8},
        "layers": {},
        "narration": f"Here is the plan for {trip_name}. We will fly it start to finish.",
        "callouts": [],
    }


def _fallback_recap(trip_name: str) -> dict:
    return {
        "id": "scene-recap",
        "type": "mission_recap",
        "title": "Trip recap",
        "subtitle": "Review before departure",
        "durationMs": 9000,
        "camera": {"mode": "fit", "pitch": 48, "zoom": 8.8},
        "layers": {},
        "narration": f"That covers {trip_name}. Confirm road, weather, and camp conditions before you roll.",
        "callouts": [],
    }


def fallback_mission_storyboard(payload: dict) -> dict:
    trip_id = (payload.get("trip_id") or "").strip()[:120] or None
    trip_name = str(payload.get("trip_name") or "Your route")[:120]
    clean_route = _normalize_route(payload.get("route") or [])
    checkpoints = payload.get("checkpoints") or []
    places = payload.get("places") or []
    scenes = [_fallback_intro(trip_name, clean_route)]
    day_numbers = sorted({
        int(cp.get("day") or 0)
        for cp in checkpoints
        if isinstance(cp, dict) and int(cp.get("day") or 0) > 0
    })[:5]
    for day in day_numbers:
        day_points = [cp for cp in checkpoints if isinstance(cp, dict) and int(cp.get("day") or 0) == day]
        if not day_points:
            continue
        anchor = day_points[len(day_points) // 2]
        lat = float(anchor.get("lat"))
        lng = float(anchor.get("lng"))
        ratio = _route_ratio(clean_route, lat, lng)
        scenes.append({
            "id": f"scene-day-{day}",
            "type": "day_flyover",
            "title": f"Day {day}",
            "subtitle": str(anchor.get("title") or f"Day {day} leg")[:120],
            "day": day,
            "durationMs": 10000,
            "routeSlice": [_clamp_ratio(ratio - 0.08), _clamp_ratio(ratio + 0.08)],
            "focus": {"lat": lat, "lng": lng},
            "camera": {"mode": "follow", "pitch": 58, "zoom": 10.2},
            "layers": {"terrain": True},
            "narration": str(anchor.get("note") or f"Day {day} follows the corridor toward the next overnight stop.")[:320],
            "callouts": [],
        })
    for place in places[:6]:
        if not isinstance(place, dict) or not _finite_coord(place.get("lat"), place.get("lng")):
            continue
        ptype = str(place.get("type") or "poi").lower()
        if "camp" in ptype:
            scene_type = "camp_arrival"
            camera = {"mode": "orbit", "pitch": 52, "zoom": 11.0}
        elif "fuel" in ptype:
            scene_type = "fuel_stop"
            camera = {"mode": "fly", "pitch": 48, "zoom": 10.5}
        elif any(token in ptype for token in ("monument", "park", "view", "scenic")):
            scene_type = "poi_flyover"
            camera = {"mode": "orbit", "pitch": 50, "zoom": 11.2, "orbit": {"direction": "cw", "sweepDeg": 90.0}}
        else:
            scene_type = "drive_leg"
            camera = {"mode": "follow", "pitch": 55, "zoom": 10.0}
        lat = float(place["lat"])
        lng = float(place["lng"])
        ratio = _route_ratio(clean_route, lat, lng)
        scenes.append({
            "id": f"scene-place-{place.get('id') or len(scenes)}",
            "type": scene_type,
            "title": str(place.get("title") or "Stop")[:120],
            "subtitle": str(place.get("note") or "")[:160],
            "day": int(place.get("day") or 0) or None,
            "durationMs": 9000,
            "routeSlice": [_clamp_ratio(ratio - 0.04), _clamp_ratio(ratio + 0.04)],
            "focus": {"lat": lat, "lng": lng},
            "rejoinRatio": _clamp_ratio(ratio + 0.01) if scene_type == "poi_flyover" else None,
            "camera": camera,
            "layers": {"terrain": True},
            "narration": str(place.get("note") or place.get("title") or "A planned stop along the route.")[:320],
            "callouts": [{
                "id": str(place.get("id") or f"place-{len(scenes)}"),
                "title": str(place.get("title") or "Stop")[:120],
                "note": str(place.get("note") or "")[:200] or None,
                "lat": lat,
                "lng": lng,
                "kind": ptype,
            }],
        })
    scenes.append(_fallback_recap(trip_name))
    return {
        "id": f"mission-fallback-{uuid.uuid4().hex[:12]}",
        "tripId": trip_id,
        "title": trip_name,
        "route": clean_route,
        "scenes": scenes[:MAX_SCENES],
        "generatedAt": int(time.time() * 1000),
        "sources": ["trailhead", "fallback"],
    }


def _compact_route_preview(route_preview: dict | None) -> dict:
    if not isinstance(route_preview, dict):
        return {}
    routes = route_preview.get("routes") if isinstance(route_preview.get("routes"), list) else []
    if not routes:
        return {}
    route = routes[0] if isinstance(routes[0], dict) else {}
    legs = route.get("legs") if isinstance(route.get("legs"), list) else []
    summary = []
    for leg in legs[:8]:
        if not isinstance(leg, dict):
            continue
        summary.append({
            "distance_mi": round(float(leg.get("distance") or 0) / 1609.34, 1),
            "duration_min": round(float(leg.get("duration") or 0) / 60, 0),
            "summary": str(leg.get("summary") or "")[:120],
        })
    return {
        "distance_mi": round(float(route.get("distance") or 0) / 1609.34, 1),
        "duration_min": round(float(route.get("duration") or 0) / 60, 0),
        "legs": summary,
    }


def _storyboard_prompt(payload: dict, route_preview: dict) -> str:
    trip_name = str(payload.get("trip_name") or "Your route")
    days = payload.get("days")
    checkpoints = payload.get("checkpoints") or []
    places = payload.get("places") or []
    mission_brief = payload.get("mission_brief") if isinstance(payload.get("mission_brief"), dict) else {}
    risks = mission_brief.get("risks") if isinstance(mission_brief.get("risks"), list) else []
    return (
        "You are directing a cinematic 3D map flythrough for an overland camping trip. "
        "Return JSON with key cinematic containing id, tripId, title, route (echo input), generatedAt (ms epoch), sources, and scenes. "
        f"Trip: {trip_name}. Days: {days}. Route preview: {json.dumps(route_preview)[:1200]}. "
        f"Checkpoints: {json.dumps(checkpoints)[:1800]}. Places: {json.dumps(places)[:1800]}. "
        f"Risks: {json.dumps(risks)[:800]}. "
        "Pick 8-14 scenes in play order: intro, camp_arrival, fuel_stop, poi_flyover, risk_focus when warranted, mission_recap. "
        "Connective drive legs are optional - the client weaves follow legs between your beats, so spend your scenes on the stops that matter. "
        "From the places list, pick 1-3 that genuinely deserve a cinematic detour (scenic viewpoints, monuments, canyons, waterfalls - not fuel stops or generic towns). "
        "For each, emit a poi_flyover scene with focus {lat,lng}, narration grounded in that place's note (never invent facts; if unsure describe what is visible: red-rock canyon country, desert corridor, high plateau), "
        "and camera framing: mode orbit with camera.orbit {direction: cw|ccw, sweepDeg: 30-180} for standalone landmarks, or camera.preset 'low_pass' with camera.bearing for canyons and valleys. "
        "Set rejoinRatio on each poi_flyover to the route fraction where the tour resumes (>= the POI's position along the route). "
        "Keep all scenes in strictly increasing route order. "
        "Assign camera.mode per scene: orbit for monuments/parks, follow for canyon or road legs, fit for overview/recap, fly for transitions. "
        "Each scene needs id, type, title, subtitle, durationMs (6000-12000), routeSlice [start,end] fractions 0-1, optional focus {lat,lng}, camera, layers, narration, callouts. "
        "Narration must be plain spoken English, one short sentence, no hype, no AI jargon, no em dashes. "
        "Never claim the route is safe or ready unless mission_brief.readiness is ready."
    )


async def _openai_storyboard(payload: dict, route_preview: dict) -> dict:
    api_key = settings.openai_api_key
    if not api_key:
        raise RuntimeError("openai_unconfigured")
    prompt = _storyboard_prompt(payload, route_preview)
    body = {
        "model": "gpt-4o-mini",
        "temperature": 0.35,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You output only valid JSON for a mobile map cinematic director. "
                    "Keep scene count <= 16. Use only allowed scene types and camera modes."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }
    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
        )
    if response.status_code >= 400:
        raise RuntimeError(f"openai_error:{response.status_code}")
    data = response.json()
    content = (((data.get("choices") or [{}])[0]).get("message") or {}).get("content")
    if not isinstance(content, str):
        raise RuntimeError("openai_empty")
    parsed = json.loads(content)
    cinematic_raw = parsed.get("cinematic") if isinstance(parsed.get("cinematic"), dict) else parsed
    return cinematic_raw


async def generate_mission_storyboard(payload: dict, route_preview_fetcher) -> dict:
    trip_id = (payload.get("trip_id") or "").strip()[:120] or None
    trip_name = str(payload.get("trip_name") or "Your route")[:120]
    clean_route = _normalize_route(payload.get("route") or [])
    if len(clean_route) < 2:
        raise ValueError("route_too_short")
    route_preview = {}
    try:
        preview_result = await route_preview_fetcher(clean_route)
        route_preview = _compact_route_preview(preview_result if isinstance(preview_result, dict) else {})
    except Exception:
        route_preview = {}
    try:
        raw = await _openai_storyboard({**payload, "trip_name": trip_name, "route": clean_route}, route_preview)
        cinematic = _sanitize_cinematic(raw, trip_id, trip_name, clean_route)
        return {"ok": True, "cinematic": cinematic, "generated_by": "ai", "sources": cinematic.get("sources", [])}
    except Exception:
        cinematic = fallback_mission_storyboard({**payload, "trip_name": trip_name, "route": clean_route})
        return {"ok": True, "cinematic": cinematic, "generated_by": "fallback", "sources": cinematic.get("sources", [])}
