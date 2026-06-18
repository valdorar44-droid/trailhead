from __future__ import annotations

import math
import time
from typing import Any

from dashboard.provider_registry import normalize_provider_id, provider_metadata, source_quality_summary


Readiness = str
Confidence = str

PLACEHOLDER_NAMES = {
    "camp",
    "campground",
    "campsite",
    "stay",
    "overnight",
    "overnight stop",
    "overnight area",
    "review area",
}

OFFICIAL_SOURCE_HINTS = (
    "nps",
    "ridb",
    "recreation.gov",
    "usfs",
    "blm",
    "trailhead",
    "official",
    "nws",
    "airnow",
    "wfigs",
    "firms",
    "gdacs",
    "tomtom",
)


def build_mission_control(payload: dict[str, Any]) -> dict[str, Any]:
    generated_at = int(time.time())
    route = _clean_route(payload.get("route"))
    checkpoints = _clean_items(payload.get("checkpoints"))
    places = _clean_items(payload.get("places"))
    trip_memory = payload.get("trip_memory") if isinstance(payload.get("trip_memory"), dict) else {}
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    trip_id = _clean_text(payload.get("trip_id"), 120) or None

    route_miles = _route_miles(route)
    route_score, route_risks = score_route_geometry(route, checkpoints, route_miles)
    overnight_score, overnights, overnight_risks = score_overnights(checkpoints, places, metadata)
    legal_score, legal_risks = score_legal_stay_confidence(overnights)
    rig_score, rig_risks = score_rig_fit(route_miles, trip_memory)
    fuel_score, fuel_risks = score_fuel_and_services(route_miles, trip_memory, checkpoints, places)
    hazard_score, hazard_risks = score_hazards(checkpoints, places)
    offline_score, offline_risks = score_offline_readiness(route, checkpoints, trip_memory)
    report_score, report_risks = score_reports(checkpoints, places, generated_at)
    context_score, context_risks = score_visible_context(context)

    scores = [
        route_score,
        overnight_score,
        legal_score,
        rig_score,
        fuel_score,
        hazard_score,
        offline_score,
        report_score,
        context_score,
    ]
    risks = [
        *route_risks,
        *overnight_risks,
        *legal_risks,
        *rig_risks,
        *fuel_risks,
        *hazard_risks,
        *offline_risks,
        *report_risks,
        *context_risks,
    ]
    readiness = _aggregate_readiness(scores, risks)
    recommendations = _recommendations(readiness, scores, risks, overnights)
    map_filters = _map_filters(readiness, risks, overnights)
    evidence_items = [*checkpoints, *places, *overnights]
    source_summary = _source_summary(evidence_items, generated_at)
    provider_evidence = _provider_evidence(evidence_items, generated_at)
    status_summary = _status_summary(readiness, scores, risks, overnights)
    headline, summary = _brief_copy(readiness, scores, risks, overnights)

    return {
        "ok": True,
        "schema_version": 2,
        "trip_id": trip_id,
        "generated_at": generated_at,
        "readiness": readiness,
        "headline": headline,
        "summary": summary,
        "status_summary": status_summary,
        "scores": scores,
        "overnights": overnights,
        "risks": risks,
        "recommendations": recommendations,
        "next_actions": _staged_next_actions(recommendations),
        "map_filters": map_filters,
        "source_summary": source_summary,
        "provider_evidence": provider_evidence,
        "debug": {
            "route_points": len(route),
            "route_miles": round(route_miles, 1),
            "checkpoint_count": len(checkpoints),
            "place_count": len(places),
            "provider_calls": 0,
        },
    }


def score_route_geometry(route: list[dict[str, float]], checkpoints: list[dict[str, Any]], route_miles: float) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if len(route) >= 3 and route_miles > 1:
        return _score("route_geometry", "Route geometry", "ready", "high", 100, ["Route line is available for corridor checks."]), []
    if len(route) >= 2 or len(checkpoints) >= 2:
        risk = _risk(
            "route_sparse_geometry",
            "route_geometry",
            "Route needs geometry review",
            "The trip has anchors but not enough route shape for reliable corridor checks.",
            "warning",
            "medium",
        )
        return _score("route_geometry", "Route geometry", "needs_review", "medium", 55, ["Only sparse route geometry is available."]), [risk]
    risk = _risk(
        "route_missing_geometry",
        "route_geometry",
        "Route line missing",
        "Mission Control needs at least two route points before it can grade the corridor.",
        "block",
        "high",
    )
    return _score("route_geometry", "Route geometry", "blocked", "high", 0, ["No usable route geometry was provided."]), [risk]


def score_overnights(checkpoints: list[dict[str, Any]], places: list[dict[str, Any]], metadata: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    days = _trip_days(checkpoints, places, metadata)
    stay_items = [item for item in [*checkpoints, *places] if _is_stay(item)]
    overnights: list[dict[str, Any]] = []
    risks: list[dict[str, Any]] = []
    missing = 0
    placeholder = 0
    for day in range(1, days + 1):
        candidates = [item for item in stay_items if _item_day(item) == day or (days == 1 and _item_day(item) == 0)]
        item = candidates[0] if candidates else None
        if not item:
            missing += 1
            overnights.append({
                "day": day,
                "name": f"Day {day} overnight",
                "status": "missing",
                "source": "trailhead",
                "confidence": "unknown",
                "legal_stay": "needs_review",
                "reason": "No overnight is assigned for this day.",
                "source_ids": [],
            })
            continue
        name = _item_name(item, f"Day {day} overnight")
        is_placeholder = _is_placeholder_name(name)
        if is_placeholder:
            placeholder += 1
        confidence = _confidence(item)
        status = "review_area" if is_placeholder else ("confirmed" if confidence == "high" else "candidate")
        legal = "ready" if confidence == "high" and not is_placeholder else "needs_review"
        overnights.append({
            "day": day,
            "name": name,
            "lat": item.get("lat"),
            "lng": item.get("lng"),
            "status": status,
            "source": _source(item),
            "confidence": confidence,
            "legal_stay": legal,
            "reason": _clean_text(item.get("note") or item.get("summary") or item.get("description"), 180) or ("Source needs review." if is_placeholder else "Overnight candidate is present."),
            "source_ids": _source_ids(item),
        })

    if missing:
        risks.append(_risk(
            "overnight_missing",
            "camp",
            "Overnight missing",
            f"{missing} trip day needs a real overnight before this can be ready.",
            "warning",
            "high",
        ))
    if placeholder:
        risks.append(_risk(
            "overnight_placeholder",
            "camp",
            "Overnight name needs review",
            "A placeholder overnight cannot be treated as confirmed.",
            "warning",
            "high",
        ))
    if not overnights:
        return _score("overnights", "Overnights", "needs_review", "unknown", 35, ["No overnight plan is attached."]), [], risks
    if missing or placeholder:
        return _score("overnights", "Overnights", "needs_review", "medium", 55, ["One or more nights still needs review."]), overnights, risks
    return _score("overnights", "Overnights", "ready", "medium", 85, ["Each planned day has an overnight candidate."]), overnights, risks


def score_legal_stay_confidence(overnights: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not overnights:
        return _score("legal_stay", "Legal stay confidence", "needs_review", "unknown", 30, ["No stay evidence is available."]), []
    blocked = [
        o for o in overnights
        if str(o.get("status")) == "blocked"
        or (str(o.get("status")) not in {"missing", "review_area"} and _contains_no_stay_signal(o))
    ]
    low = [o for o in overnights if o.get("confidence") in {"low", "unknown"} or o.get("status") in {"missing", "review_area"}]
    if blocked:
        return _score("legal_stay", "Legal stay confidence", "blocked", "high", 0, ["A stay source indicates this night is not usable."]), [
            _risk("legal_stay_blocked", "legal", "Stay not usable", "One overnight has closure, private, or no-overnight language.", "block", "high")
        ]
    if low:
        return _score("legal_stay", "Legal stay confidence", "needs_review", "medium", 50, ["Some stay sources are low-confidence or unresolved."]), [
            _risk("legal_stay_review", "legal", "Stay legality needs review", "At least one overnight needs source confirmation.", "warning", "medium")
        ]
    return _score("legal_stay", "Legal stay confidence", "ready", "medium", 80, ["Stay sources are named and attributable."]), []


def score_rig_fit(route_miles: float, trip_memory: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    vehicle = trip_memory.get("vehicle") if isinstance(trip_memory.get("vehicle"), dict) else {}
    clearance = trip_memory.get("clearance") if isinstance(trip_memory.get("clearance"), dict) else {}
    if vehicle or clearance:
        reasons = ["Rig profile is attached."]
        if clearance.get("inches"):
            reasons.append(f"{clearance.get('inches')} in clearance recorded.")
        return _score("rig_fit", "Rig fit", "ready", "medium", 80, reasons), []
    if route_miles > 25:
        return _score("rig_fit", "Rig fit", "needs_review", "unknown", 45, ["No rig profile is attached for this route."]), [
            _risk("rig_profile_missing", "road", "Rig profile missing", "Vehicle range and clearance improve route confidence.", "watch", "unknown")
        ]
    return _score("rig_fit", "Rig fit", "needs_review", "unknown", 55, ["No rig constraints were provided."]), []


def score_fuel_and_services(route_miles: float, trip_memory: dict[str, Any], checkpoints: list[dict[str, Any]], places: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    range_data = trip_memory.get("range") if isinstance(trip_memory.get("range"), dict) else {}
    range_miles = _number(range_data.get("miles") or range_data.get("fuel_range_miles"))
    fuel_count = sum(1 for item in [*checkpoints, *places] if _type_text(item) in {"fuel", "gas", "gas_station"})
    trusted_fuel_count = sum(1 for item in [*checkpoints, *places] if _type_text(item) in {"fuel", "gas", "gas_station"} and _confidence(item) in {"high", "medium"})
    if not route_miles:
        return _score("fuel_services", "Fuel and services", "needs_review", "unknown", 45, ["Fuel gap cannot be scored without route miles."]), []
    if range_miles and route_miles > range_miles and trusted_fuel_count == 0:
        return _score("fuel_services", "Fuel and services", "blocked", "high", 20, ["Route distance exceeds recorded range with no fuel stop attached."]), [
            _risk("fuel_gap_over_range", "fuel_gap", "Fuel gap over range", "Add or confirm fuel before the remote stretch.", "block", "high")
        ]
    if range_miles and route_miles > range_miles * 0.7 and trusted_fuel_count == 0:
        return _score("fuel_services", "Fuel and services", "needs_review", "medium", 45, ["Route uses most of recorded range and has no fuel stop attached."]), [
            _risk("fuel_gap_watch", "fuel_gap", "Fuel stop needed", "The route uses most of the recorded range.", "warning", "medium")
        ]
    if trusted_fuel_count:
        return _score("fuel_services", "Fuel and services", "ready", "medium", 82, [f"{trusted_fuel_count} fuel or service stop is attached."]), []
    if fuel_count:
        return _score("fuel_services", "Fuel and services", "needs_review", "low", 58, ["Fuel is only estimated and needs confirmation."]), [
            _risk("fuel_low_confidence", "fuel_gap", "Fuel stop needs confirmation", "Estimated fuel markers cannot clear the route range check.", "watch", "low")
        ]
    return _score("fuel_services", "Fuel and services", "needs_review", "unknown", 55, ["No fuel stop is attached."]), []


def score_hazards(checkpoints: list[dict[str, Any]], places: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    hazard_terms = (
        "weather", "risk", "fire", "smoke", "closure", "hazard", "traffic",
        "road", "flood", "earthquake", "cyclone", "volcano", "drought", "tsunami",
    )
    hazard_items = [item for item in [*checkpoints, *places] if any(term in _type_text(item) for term in hazard_terms)]
    risks = [
        _risk(
            f"hazard_{idx}",
            _hazard_risk_type(item),
            _item_name(item, "Route hazard"),
            _clean_text(item.get("note") or item.get("summary") or item.get("description") or "Review this route condition before departure.", 220),
            _hazard_severity(item),
            _confidence(item),
            lat=item.get("lat"),
            lng=item.get("lng"),
            day=_item_day(item) or None,
            route_distance_m=_route_distance_m(item),
            expires_at=item.get("expires_at"),
            provider=item.get("provider"),
            source_ids=_source_ids(item),
        )
        for idx, item in enumerate(hazard_items[:8])
    ]
    review_risks = [risk for risk in risks if risk.get("severity") in {"block", "warning", "watch"}]
    if review_risks:
        return _score("hazards", "Hazards", "needs_review", "medium", 58, [f"{len(review_risks)} route condition needs review."]), risks
    if risks:
        return _score("hazards", "Hazards", "ready", "medium", 74, ["Only low-severity route conditions are attached."]), risks
    return _score("hazards", "Hazards", "ready", "unknown", 72, ["No attached route hazards were found."]), []


def _hazard_risk_type(item: dict[str, Any]) -> str:
    text = _type_text(item)
    if "fire" in text:
        return "fire"
    if "smoke" in text or "aqi" in text or "air_quality" in text:
        return "smoke"
    if "weather" in text or "cyclone" in text:
        return "weather"
    if "traffic" in text or "road" in text or "closure" in text:
        return "road"
    if text in {"flood", "earthquake", "volcano", "drought", "tsunami"}:
        return text
    return "hazard"


def _hazard_severity(item: dict[str, Any]) -> str:
    raw = _clean_text(item.get("mission_severity") or item.get("severity"), 40).lower()
    if raw in {"block", "warning", "watch", "info"}:
        return raw
    text = " ".join(str(item.get(key) or "") for key in ("title", "name", "note", "summary", "description", "subtype", "type")).lower()
    if any(term in text for term in ("closed", "closure", "evacuation", "no travel", "impassable", "blocked")):
        return "block"
    if raw in {"critical", "extreme", "severe", "high"}:
        return "warning"
    if raw in {"moderate", "medium"}:
        return "watch"
    return "info"


def _route_distance_m(item: dict[str, Any]) -> int | None:
    explicit = _number(item.get("route_distance_m"))
    if explicit is not None:
        return int(max(0, explicit))
    miles = _number(item.get("route_distance_mi") or item.get("distance_from_route_mi"))
    if miles is None:
        return None
    return int(max(0, miles * 1609.344))


def score_offline_readiness(route: list[dict[str, float]], checkpoints: list[dict[str, Any]], trip_memory: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    offline = trip_memory.get("offline_readiness") if isinstance(trip_memory.get("offline_readiness"), dict) else {}
    if not route and not checkpoints:
        score = _score("offline_readiness", "Offline readiness", "needs_review", "unknown", 30, ["Offline pack cannot be sized without route context."])
        score["offline_status"] = "missing"
        score["missing_keys"] = ["route"]
        return score, []

    groups = {
        "maps": ("maps", "map_tiles", "tiles", "route_tiles", "trail_tiles"),
        "route": ("route", "route_line", "route_cache", "route_geometry"),
        "trail_graph": ("trail_graph", "trail_route_graph", "route_graph", "graph", "trail_graph_sidecars"),
        "places": ("places", "stays", "camps", "camp_packs", "poi", "key_stops"),
        "conditions": ("weather", "reports", "hazards", "conditions"),
    }
    ready_groups: list[str] = []
    missing_groups: list[str] = []
    known_groups: list[str] = []
    for group, aliases in groups.items():
        raw = next((offline.get(alias) for alias in aliases if alias in offline), None)
        if raw is None:
            continue
        known_groups.append(group)
        state = _offline_state(raw)
        if state == "ready":
            ready_groups.append(group)
        elif state == "missing":
            missing_groups.append(group)

    if {"maps", "route"}.issubset(set(ready_groups)) and not missing_groups:
        score = _score("offline_readiness", "Offline readiness", "ready", "medium", 86, ["Route maps and route data are marked ready."])
        score["offline_status"] = "complete"
        score["ready_keys"] = ready_groups
        return score, []
    if ready_groups:
        label = ", ".join(_status_label(key) for key in missing_groups[:3]) or "some route data"
        score = _score("offline_readiness", "Offline readiness", "needs_review", "medium", 62, [f"Offline pack is partial; review {label}."])
        score["offline_status"] = "partial"
        score["ready_keys"] = ready_groups
        score["missing_keys"] = missing_groups or [group for group in groups if group not in known_groups][:3]
        return score, [
            _risk("offline_partial", "offline", "Offline pack partial", "Some route data is downloaded, but key offline pieces still need review.", "watch", "medium")
        ]

    score = _score("offline_readiness", "Offline readiness", "needs_review", "unknown", 50, ["Download route maps and key stops before leaving signal."])
    score["offline_status"] = "missing"
    score["missing_keys"] = list(groups.keys())
    return score, [
        _risk("offline_not_confirmed", "offline", "Offline pack not confirmed", "Route maps, stays, and key stops are not marked downloaded.", "watch", "unknown")
    ]


def _offline_state(value: Any) -> str:
    if value is True:
        return "ready"
    if value is False or value is None:
        return "missing"
    text = _clean_text(value, 80).lower()
    if text in {"ready", "downloaded", "complete", "available", "cached", "done", "true"}:
        return "ready"
    if text in {"missing", "unavailable", "not_downloaded", "not downloaded", "failed", "false", "none"}:
        return "missing"
    return "partial"


def score_reports(checkpoints: list[dict[str, Any]], places: list[dict[str, Any]], now: int | None = None) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    now = int(now or time.time())
    report_items = [item for item in [*checkpoints, *places] if _is_report(item)]
    if not report_items:
        score = _score("reports", "Reports", "ready", "unknown", 72, ["No current community conflicts are attached."])
        score["report_status"] = "current"
        return score, []

    conflicting = [item for item in report_items if _is_conflicting_report(item)]
    stale = [item for item in report_items if _is_stale_report(item, now)]
    current = [item for item in report_items if item not in stale and item not in conflicting]

    if conflicting:
        score = _score("reports", "Reports", "needs_review", "medium", 42, ["One report has conflicting or disputed status."])
        score["report_status"] = "conflicting"
        return score, [
            _risk(
                "reports_conflicting",
                "report",
                "Reports conflict",
                "Community or route reports disagree; confirm before relying on this route detail.",
                "warning",
                "medium",
            )
        ]
    if stale and not current:
        score = _score("reports", "Reports", "needs_review", "low", 50, ["Only stale route reports are attached."])
        score["report_status"] = "stale"
        return score, [
            _risk(
                "reports_stale",
                "report",
                "Reports are stale",
                "Attached reports are old or expired and need a current check.",
                "watch",
                "low",
            )
        ]

    reasons = [f"{len(current)} current report{'s' if len(current) != 1 else ''} attached."]
    if stale:
        reasons.append(f"{len(stale)} stale report{'s' if len(stale) != 1 else ''} ignored for readiness.")
    score = _score("reports", "Reports", "ready", "medium", 78, reasons)
    score["report_status"] = "current"
    return score, []


def _is_report(item: dict[str, Any]) -> bool:
    text = " ".join(
        _clean_text(item.get(key), 120).lower()
        for key in ("type", "subtype", "category", "source", "source_label", "status", "report_type")
    )
    return (
        "report" in text
        or "trailhead_user" in text
        or "community" in text
        or item.get("reported_at") is not None
        or item.get("community_confirmations") is not None
    )


def _is_conflicting_report(item: dict[str, Any]) -> bool:
    text = " ".join(str(item.get(key) or "") for key in ("status", "note", "summary", "description")).lower()
    return bool(item.get("conflicting") or item.get("disputed") or "conflict" in text or "disputed" in text)


def _is_stale_report(item: dict[str, Any], now: int) -> bool:
    expires_at = _timestamp(item.get("expires_at"))
    if expires_at and expires_at < now:
        return True
    if item.get("stale") is True:
        return True
    seen_at = _timestamp(item.get("updated_at") or item.get("last_seen_at") or item.get("reported_at") or item.get("created_at"))
    if not seen_at:
        return False
    return now - seen_at > 30 * 86_400


def score_visible_context(context: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    map_ctx = context.get("map") if isinstance(context.get("map"), dict) else {}
    route_ctx = context.get("route") if isinstance(context.get("route"), dict) else {}
    visible = map_ctx.get("visible_map_features")
    if not isinstance(visible, list):
        visible = []
    types = [_type_text(item if isinstance(item, dict) else {}) for item in visible[:24]]
    filler_count = sum(1 for kind in types[:8] if kind in {"fuel", "grocery", "shop", "food"})
    if route_ctx.get("active_route") and filler_count >= 4:
        return _score("visible_context", "Map context", "needs_review", "medium", 52, ["Visible map results look cluttered for route review."]), [
            _risk("visible_context_pollution", "route_geometry", "Map results need filtering", "Fuel, grocery, and shop results are crowding route context.", "watch", "medium")
        ]
    return _score("visible_context", "Map context", "ready", "medium", 78, ["Visible map context is usable."]), []


def _recommendations(readiness: Readiness, scores: list[dict[str, Any]], risks: list[dict[str, Any]], overnights: list[dict[str, Any]]) -> list[dict[str, Any]]:
    recs: list[dict[str, Any]] = []
    score_by_id = {score["id"]: score for score in scores}
    if score_by_id.get("route_geometry", {}).get("status") == "blocked":
        recs.append(_recommendation("startRouteScout", "Build route", "Add route geometry before reviewing readiness.", True, 10, {"source": "mission_control"}))
    if any(r.get("type") == "fuel_gap" for r in risks):
        recs.append(_recommendation("searchPlaces", "Find fuel", "Fuel range needs a stop or confirmation.", False, 20, {"category": "fuel", "route_scoped": True}))
    if any(o.get("status") in {"missing", "review_area"} for o in overnights):
        recs.append(_recommendation("searchPlaces", "Review stays", "One or more nights needs a real stay option.", False, 30, {"category": "camp", "route_scoped": True, "open_card": False}))
    if any(r.get("type") in {"weather", "fire", "smoke", "road"} for r in risks):
        recs.append(_recommendation("toggleLayer", "Show conditions", "Review route conditions on the map.", False, 40, {"layer": "radar"}))
    if score_by_id.get("offline_readiness", {}).get("status") != "ready":
        recs.append(_recommendation("openOfflineDownloads", "Download route", "Save maps and key stops before losing signal.", True, 50, {"route_scoped": True}))
    if readiness != "ready":
        recs.append(_recommendation("applyMissionFilter", "Focus map", "Show the route, overnights, risks, and key services first.", False, 60, {"preset": "remote_ready"}))
    return recs[:6]


def _map_filters(readiness: Readiness, risks: list[dict[str, Any]], overnights: list[dict[str, Any]]) -> list[dict[str, Any]]:
    filters = [
        {"id": "tonight", "label": "Tonight", "reason": "Overnights and nearby services.", "layers": ["overnights", "fuel", "weather"]},
        {"id": "remote_ready", "label": "Remote ready", "reason": "Fuel, offline, repair, water, and route risks.", "layers": ["route", "fuel", "repair", "water", "offline", "hazards"]},
        {"id": "trail_day", "label": "Trail day", "reason": "Trails, viewpoints, weather, and daylight checks.", "layers": ["trails", "viewpoints", "weather", "daylight"]},
    ]
    if risks:
        filters.insert(0, {"id": "risk_review", "label": "Risk review", "reason": "Current warnings and blocked items.", "layers": ["hazards", "route", "overnights"]})
    if overnights:
        filters.append({"id": "public_land", "label": "Public land", "reason": "Stay legality and public-land context.", "layers": ["lands", "camp", "overnights"]})
    return filters[:5]


def _brief_copy(readiness: Readiness, scores: list[dict[str, Any]], risks: list[dict[str, Any]], overnights: list[dict[str, Any]]) -> tuple[str, str]:
    blockers = [risk for risk in risks if risk.get("severity") == "block"]
    warnings = [risk for risk in risks if risk.get("severity") in {"warning", "watch"}]
    if readiness == "blocked":
        headline = "Trip blocked for review"
        summary = blockers[0]["summary"] if blockers else "Fix the blocked item before treating this route as ready."
    elif readiness == "needs_review":
        headline = "Trip needs review"
        if warnings:
            summary = warnings[0]["summary"]
        else:
            needs = [score["label"] for score in scores if score.get("status") != "ready"]
            summary = f"Review {', '.join(needs[:2]).lower()} before departure." if needs else "Review the route before departure."
    else:
        headline = "Trip looks ready"
        summary = "Route, stays, services, and offline checks look usable from the attached sources."
    if overnights:
        summary = f"{summary} {len(overnights)} overnight check{'s' if len(overnights) != 1 else ''} attached."
    return headline, summary


def _aggregate_readiness(scores: list[dict[str, Any]], risks: list[dict[str, Any]]) -> Readiness:
    if any(score.get("status") == "blocked" for score in scores) or any(risk.get("severity") == "block" for risk in risks):
        return "blocked"
    if any(score.get("status") == "needs_review" for score in scores) or any(risk.get("severity") in {"warning", "watch"} for risk in risks):
        return "needs_review"
    return "ready"


def _source_summary(items: list[dict[str, Any]], now: int) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for item in items:
        source = _source(item)
        if not source:
            continue
        quality = _item_source_quality(item, now)
        bucket = buckets.setdefault(source, {
            "source": source,
            "count": 0,
            "scores": [],
            "factors": set(),
            "provider_ids": set(),
            "attribution": "",
            "freshness_label": "",
        })
        bucket["count"] += 1
        if _number(quality.get("score")) is not None:
            bucket["scores"].append(float(quality["score"]))
        bucket["factors"].update(str(factor) for factor in quality.get("factors", []) if factor)
        bucket["provider_ids"].update(str(pid) for pid in quality.get("provider_ids", []) if pid)
        bucket["attribution"] = bucket["attribution"] or _clean_text(quality.get("attribution"), 160)
        bucket["freshness_label"] = bucket["freshness_label"] or _clean_text(quality.get("freshness_label"), 160)
    summaries: list[dict[str, Any]] = []
    for bucket in sorted(buckets.values(), key=lambda item: item["count"], reverse=True)[:8]:
        scores = bucket.pop("scores")
        avg = int(round(sum(scores) / len(scores))) if scores else 45
        factors = sorted(bucket.pop("factors"))
        provider_ids = sorted(bucket.pop("provider_ids"))
        summaries.append({
            **bucket,
            "confidence": _quality_label(avg),
            "score": avg,
            "factors": factors[:6],
            "provider_ids": provider_ids[:6],
        })
    return summaries


def _score(id_: str, label: str, status: Readiness, confidence: Confidence, value: int, reasons: list[str], source_ids: list[str] | None = None) -> dict[str, Any]:
    return {
        "id": id_,
        "label": label,
        "status": status,
        "confidence": confidence,
        "value": value,
        "max": 100,
        "reasons": reasons,
        "source_ids": source_ids or [],
    }


def _risk(id_: str, type_: str, title: str, summary: str, severity: str, confidence: Confidence, **extra: Any) -> dict[str, Any]:
    risk = {
        "id": id_,
        "type": type_,
        "title": title,
        "summary": summary,
        "severity": severity,
        "confidence": confidence,
        "source_ids": extra.pop("source_ids", []),
    }
    for key, value in extra.items():
        if value is not None:
            risk[key] = value
    return risk


def _recommendation(action_type: str, label: str, reason: str, requires_confirmation: bool, priority: int, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "action_type": action_type,
        "label": label,
        "reason": reason,
        "requires_confirmation": requires_confirmation,
        "priority": priority,
        "args": args,
    }


def _staged_next_actions(recommendations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for rec in recommendations:
        staged = dict(rec)
        staged["status"] = "staged"
        staged["mutates_trip"] = False
        actions.append(staged)
    return actions


def _status_summary(readiness: Readiness, scores: list[dict[str, Any]], risks: list[dict[str, Any]], overnights: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_id = {score.get("id"): score for score in scores}
    route_score = by_id.get("route_geometry", {})
    overnight_score = by_id.get("overnights", {})
    rig_score = by_id.get("rig_fit", {})
    legal_score = by_id.get("legal_stay", {})
    fuel_score = by_id.get("fuel_services", {})
    hazard_score = by_id.get("hazards", {})
    offline_score = by_id.get("offline_readiness", {})
    report_score = by_id.get("reports", {})

    return {
        "route_status": _status_item("Route status", str(route_score.get("status") or readiness), route_score),
        "overnights": _status_item("Overnights", _overnight_state(overnights, overnight_score), overnight_score),
        "rig_fit": _status_item("Rig fit", _rig_state(rig_score), rig_score),
        "legal_stay": _status_item("Legal stay", _legal_state(legal_score), legal_score),
        "fuel_risk": _status_item("Fuel risk", _fuel_state(fuel_score), fuel_score),
        "conditions": _status_item("Conditions", _condition_state(hazard_score, risks), hazard_score),
        "offline_readiness": _status_item("Offline readiness", str(offline_score.get("offline_status") or _offline_summary_state(offline_score)), offline_score),
        "reports": _status_item("Reports", str(report_score.get("report_status") or "current"), report_score),
    }


def _status_item(label: str, value: str, score: dict[str, Any]) -> dict[str, Any]:
    reasons = score.get("reasons") if isinstance(score.get("reasons"), list) else []
    return {
        "label": label,
        "value": value,
        "score_id": score.get("id") or "",
        "readiness": score.get("status") or "needs_review",
        "confidence": score.get("confidence") or "unknown",
        "summary": _clean_text(reasons[0] if reasons else "", 180),
    }


def _overnight_state(overnights: list[dict[str, Any]], score: dict[str, Any]) -> str:
    if not overnights:
        return "missing"
    statuses = {str(item.get("status") or "") for item in overnights}
    if "blocked" in statuses:
        return "blocked"
    if "missing" in statuses:
        return "missing"
    if "review_area" in statuses:
        return "review_area"
    if "candidate" in statuses:
        return "candidate"
    if statuses == {"confirmed"} or score.get("status") == "ready":
        return "confirmed"
    return "candidate"


def _rig_state(score: dict[str, Any]) -> str:
    if score.get("status") == "ready":
        return "safe"
    if score.get("status") == "blocked":
        return "not_recommended"
    if score.get("confidence") == "unknown" and _number(score.get("value")) is not None and float(score.get("value")) <= 45:
        return "unknown"
    return "caution"


def _legal_state(score: dict[str, Any]) -> str:
    if score.get("status") == "ready":
        return str(score.get("confidence") or "medium")
    if score.get("status") == "blocked":
        return "low"
    if score.get("confidence") in {"medium", "high"}:
        return "medium"
    return "unknown"


def _fuel_state(score: dict[str, Any]) -> str:
    if score.get("status") == "ready":
        return "safe"
    if score.get("status") == "blocked":
        return "warning"
    return "watch"


def _condition_state(score: dict[str, Any], risks: list[dict[str, Any]]) -> str:
    condition_types = {"weather", "fire", "smoke", "air_quality", "water", "road", "hazard", "flood", "earthquake", "volcano", "drought", "tsunami"}
    condition_risks = [risk for risk in risks if risk.get("type") in condition_types]
    if any(risk.get("severity") in {"block", "warning"} for risk in condition_risks):
        return "warning"
    if any(risk.get("severity") == "watch" for risk in condition_risks) or score.get("status") != "ready":
        return "watch"
    return "clear"


def _offline_summary_state(score: dict[str, Any]) -> str:
    value = _number(score.get("value"))
    if score.get("status") == "ready":
        return "complete"
    if value is not None and value > 40:
        return "partial"
    return "missing"


def _status_label(value: str) -> str:
    return value.replace("_", " ")


def _clean_route(value: Any) -> list[dict[str, float]]:
    out: list[dict[str, float]] = []
    if not isinstance(value, list):
        return out
    for point in value[:400]:
        lat = lng = None
        if isinstance(point, dict):
            lat = _number(point.get("lat"))
            lng = _number(point.get("lng"))
        elif isinstance(point, (list, tuple)) and len(point) >= 2:
            lng = _number(point[0])
            lat = _number(point[1])
        if lat is None or lng is None:
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            out.append({"lat": lat, "lng": lng})
    return out


def _clean_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for item in value[:160]:
        if not isinstance(item, dict):
            continue
        clean = dict(item)
        lat = _number(clean.get("lat"))
        lng = _number(clean.get("lng"))
        if lat is not None and lng is not None and -90 <= lat <= 90 and -180 <= lng <= 180:
            clean["lat"] = lat
            clean["lng"] = lng
        out.append(clean)
    return out


def _route_miles(route: list[dict[str, float]]) -> float:
    total = 0.0
    for prev, curr in zip(route, route[1:]):
        total += _haversine_miles(prev["lat"], prev["lng"], curr["lat"], curr["lng"])
    return total


def _haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 3958.7613
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _trip_days(checkpoints: list[dict[str, Any]], places: list[dict[str, Any]], metadata: dict[str, Any]) -> int:
    explicit = _number(metadata.get("days") or metadata.get("trip_days"))
    days = int(explicit) if explicit else 0
    for item in [*checkpoints, *places]:
        days = max(days, _item_day(item))
    return max(1, min(days or 1, 30))


def _item_day(item: dict[str, Any]) -> int:
    value = _number(item.get("day") or item.get("recommended_day"))
    return max(0, min(int(value), 30)) if value is not None else 0


def _is_stay(item: dict[str, Any]) -> bool:
    text = f"{_type_text(item)} {_clean_text(item.get('title') or item.get('name'), 120)}".lower()
    return any(term in text for term in ("camp", "stay", "overnight", "lodging", "hut", "shelter"))


def _type_text(item: dict[str, Any]) -> str:
    return _clean_text(item.get("type") or item.get("subtype") or item.get("category"), 80).lower().replace(" ", "_")


def _item_name(item: dict[str, Any], fallback: str) -> str:
    return _clean_text(item.get("title") or item.get("name") or item.get("label"), 140) or fallback


def _is_placeholder_name(name: str) -> bool:
    clean = _clean_text(name, 140).lower()
    if clean in PLACEHOLDER_NAMES:
        return True
    return clean.startswith("review area") or clean.startswith("day ") and "overnight" in clean


def _contains_no_stay_signal(item: dict[str, Any]) -> bool:
    text = " ".join(str(item.get(key) or "") for key in ("name", "reason", "summary", "note", "source")).lower()
    return any(term in text for term in ("closed", "no camping", "no overnight", "private property", "not permitted"))


def _confidence(item: dict[str, Any]) -> Confidence:
    raw = _clean_text(item.get("confidence"), 40).lower()
    if raw in {"high", "medium", "low", "unknown"}:
        return raw
    if raw == "estimated":
        return "low"
    source = _source(item).lower()
    if "preview" in source or "fallback" in source or "estimated" in source:
        return "low"
    if any(hint in source for hint in OFFICIAL_SOURCE_HINTS):
        return "high"
    return "unknown"


def _source(item: dict[str, Any]) -> str:
    return _clean_text(item.get("source_label") or item.get("source") or item.get("source_badge"), 100) or "unknown"


def _provider_id(item: dict[str, Any]) -> str:
    explicit = item.get("provider") or item.get("source_provider")
    if explicit:
        return normalize_provider_id(explicit)
    source = item.get("source")
    if source and str(source).lower() != "provider":
        return normalize_provider_id(source)
    return normalize_provider_id(_source(item))


def _item_source_quality(item: dict[str, Any], now: int) -> dict[str, Any]:
    existing = item.get("source_quality")
    if isinstance(existing, dict):
        quality = dict(existing)
        quality.setdefault("label", _quality_label(_number(quality.get("score"))))
        quality.setdefault("factors", [])
        quality.setdefault("provider_ids", [_provider_id(item)] if _provider_id(item) else [])
        return quality
    provider_id = _provider_id(item)
    source_ids = _source_ids(item)
    inferred = _confidence(item) == "low" or "preview" in _source(item).lower() or "estimated" in _clean_text(existing, 80).lower()
    unknown_access = _is_stay(item) and _confidence(item) in {"unknown", "low"}
    return source_quality_summary(
        [{"source": provider_id or _source(item), "source_id": source_ids[0] if source_ids else ""}],
        fetched_at=_timestamp(item.get("fetched_at") or item.get("created_at")),
        last_seen_at=_timestamp(item.get("last_seen_at") or item.get("updated_at") or item.get("reported_at")),
        community_confirmations=int(_number(item.get("community_confirmations")) or 0),
        inferred=inferred,
        unknown_access=unknown_access,
        now=now,
    )


def _provider_evidence(items: list[dict[str, Any]], now: int) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for item in items:
        provider_id = _provider_id(item)
        if not provider_id:
            continue
        quality = _item_source_quality(item, now)
        meta = provider_metadata(provider_id)
        bucket = buckets.setdefault(provider_id, {
            "provider_id": provider_id,
            "name": meta.name if meta else _source(item),
            "source_type": meta.source_type if meta else "unknown",
            "count": 0,
            "scores": [],
            "factors": set(),
            "freshness_label": meta.freshness_label if meta else _clean_text(quality.get("freshness_label"), 160),
            "attribution": meta.attribution_text if meta else _clean_text(quality.get("attribution"), 160),
            "offline_allowed": bool(meta.offline_allowed) if meta else bool(quality.get("offline_allowed")),
        })
        bucket["count"] += 1
        if _number(quality.get("score")) is not None:
            bucket["scores"].append(float(quality["score"]))
        bucket["factors"].update(str(factor) for factor in quality.get("factors", []) if factor)
    out: list[dict[str, Any]] = []
    for bucket in sorted(buckets.values(), key=lambda item: item["count"], reverse=True)[:8]:
        scores = bucket.pop("scores")
        avg = int(round(sum(scores) / len(scores))) if scores else 45
        factors = sorted(bucket.pop("factors"))
        out.append({
            **bucket,
            "confidence": _quality_label(avg),
            "score": avg,
            "factors": factors[:6],
        })
    return out


def _quality_label(score: float | None) -> str:
    if score is None:
        return "unknown"
    if score >= 85:
        return "high"
    if score >= 65:
        return "medium"
    if score >= 40:
        return "review"
    return "low"


def _source_ids(item: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for key in ("source_id", "id", "place_id", "result_id"):
        value = _clean_text(item.get(key), 160)
        if value:
            out.append(value)
    return list(dict.fromkeys(out))[:4]


def _timestamp(value: Any) -> int | None:
    parsed = _number(value)
    if parsed is None or parsed <= 0:
        return None
    return int(parsed)


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _clean_text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]
