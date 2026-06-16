#!/usr/bin/env python3
"""Production route QA matrix for Trailhead route/camp/POI behavior."""
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


DEFAULT_API = "https://api.gettrailhead.app"


@dataclass(frozen=True)
class Place:
    name: str
    lat: float
    lon: float


PLACES = {
    "moab": Place("Moab, UT", 38.5733, -109.5498),
    "big_sur": Place("Big Sur, CA", 36.2704, -121.8081),
    "denver": Place("Denver, CO", 39.7392, -104.9903),
    "asheville": Place("Asheville, NC", 35.5951, -82.5515),
    "seattle": Place("Seattle, WA", 47.6062, -122.3321),
    "spokane": Place("Spokane, WA", 47.6588, -117.4260),
    "yellowstone": Place("Yellowstone West Entrance, MT", 44.6579, -111.0897),
    "glacier": Place("West Glacier, MT", 48.4950, -113.9819),
    "bend": Place("Bend, OR", 44.0582, -121.3153),
    "boise": Place("Boise, ID", 43.6150, -116.2023),
}


POIS = {
    "arches": Place("Arches National Park", 38.7331, -109.5925),
    "goblin": Place("Goblin Valley State Park", 38.5730, -110.7071),
    "zion": Place("Zion National Park", 37.2982, -113.0263),
    "badlands": Place("Badlands National Park", 43.8554, -102.3397),
    "shenandoah": Place("Shenandoah National Park", 38.5330, -78.3500),
}


def request_json(method: str, url: str, payload: dict[str, Any] | None = None, timeout: int = 45) -> tuple[int, dict[str, Any], int]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "TrailheadRouteMatrixQA/1.0",
        },
    )
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = res.read().decode("utf-8")
            elapsed_ms = round((time.time() - started) * 1000)
            return res.status, json.loads(body), elapsed_ms
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        elapsed_ms = round((time.time() - started) * 1000)
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"error": body[:500]}
        return exc.code, parsed, elapsed_ms
    except Exception as exc:
        elapsed_ms = round((time.time() - started) * 1000)
        return 0, {"error": str(exc)}, elapsed_ms


def loc(place: Place, point_type: str = "break") -> dict[str, Any]:
    return {"lat": place.lat, "lon": place.lon, "type": point_type}


def haversine_mi(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def decode_polyline6(shape: str) -> list[tuple[float, float]]:
    coords: list[tuple[float, float]] = []
    index = lat = lon = 0
    while index < len(shape):
        values = []
        for _ in range(2):
            result = shift = 0
            while index < len(shape):
                b = ord(shape[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            values.append(~(result >> 1) if result & 1 else result >> 1)
        lat += values[0]
        lon += values[1]
        coords.append((lat / 1e6, lon / 1e6))
    return coords


def route_coords(route: dict[str, Any]) -> list[tuple[float, float]]:
    legs = ((route.get("trip") or {}).get("legs") or [])
    coords: list[tuple[float, float]] = []
    for leg in legs:
        shape = leg.get("shape")
        if isinstance(shape, str) and shape:
            decoded = decode_polyline6(shape)
            if coords and decoded and coords[-1] == decoded[0]:
                decoded = decoded[1:]
            coords.extend(decoded)
    return coords


def route_lonlat_sample(coords: list[tuple[float, float]], max_points: int = 80) -> list[list[float]]:
    if not coords:
        return []
    if len(coords) <= max_points:
        sample = coords
    else:
        step = max(1, (len(coords) - 1) // (max_points - 1))
        sample = coords[::step][: max_points - 1] + [coords[-1]]
    return [[lon, lat] for lat, lon in sample]


def windows_for_route(coords: list[tuple[float, float]], days: int, max_hours: float, same_window: bool) -> list[dict[str, Any]]:
    total = 0.0
    for a, b in zip(coords, coords[1:]):
        total += haversine_mi(a, b)
    if total <= 0:
        total = max(50.0, days * max_hours * 45.0)
    windows = []
    usable_days = max(1, days - 1)
    for day in range(1, usable_days + 1):
        if same_window:
            start = total * 0.42
            end = total * 0.58
            target = total * 0.5
            label = f"Shared basecamp window day {day}"
        else:
            start = total * max(0.02, (day / (days + 0.5)) - 0.06)
            end = total * min(0.98, (day / (days + 0.5)) + 0.08)
            target = (start + end) / 2
            label = f"Day {day} overnight window"
        span = max(35.0, min(90.0, max_hours * 12.0))
        windows.append({
            "day": day,
            "start": round(start, 1),
            "end": round(end, 1),
            "label": label,
            "target_mi": round(target, 1),
            "search_window_mi": round(span, 1),
        })
    return windows[:6]


SCENARIOS = [
    {
        "id": "wild_moab_big_sur_5d",
        "style": "wild",
        "days": 5,
        "max_hours": 5,
        "camp_policy": "different_each_night",
        "locations": [loc(PLACES["moab"]), loc(POIS["goblin"], "side_stop"), loc(POIS["zion"], "side_stop"), loc(PLACES["big_sur"])],
        "expect_side_stop_repair": True,
    },
    {
        "id": "balanced_moab_big_sur_5d_same_window",
        "style": "balanced",
        "days": 5,
        "max_hours": 6,
        "camp_policy": "same_camp_window",
        "locations": [loc(PLACES["moab"]), loc(POIS["arches"], "side_stop"), loc(PLACES["big_sur"])],
        "expect_side_stop_repair": True,
    },
    {
        "id": "balanced_cross_usa_7d",
        "style": "balanced",
        "days": 7,
        "max_hours": 8,
        "camp_policy": "different_each_night",
        "locations": [loc(PLACES["denver"]), loc(POIS["badlands"], "side_stop"), loc(PLACES["asheville"])],
        "expect_side_stop_repair": True,
    },
    {
        "id": "wild_there_back_moab_big_sur_8d",
        "style": "wild",
        "days": 8,
        "max_hours": 5,
        "camp_policy": "different_each_night",
        "locations": [loc(PLACES["moab"]), loc(POIS["goblin"], "side_stop"), loc(PLACES["big_sur"]), loc(PLACES["moab"])],
        "expect_side_stop_repair": True,
    },
    {
        "id": "same_route_more_hours_3d",
        "style": "balanced",
        "days": 3,
        "max_hours": 9,
        "camp_policy": "different_each_night",
        "locations": [loc(PLACES["moab"]), loc(PLACES["big_sur"])],
    },
    {
        "id": "same_route_less_hours_7d",
        "style": "balanced",
        "days": 7,
        "max_hours": 4,
        "camp_policy": "different_each_night",
        "locations": [loc(PLACES["moab"]), loc(PLACES["big_sur"])],
    },
    {
        "id": "pnw_wild_route_with_poi",
        "style": "wild",
        "days": 4,
        "max_hours": 5,
        "camp_policy": "different_each_night",
        "locations": [loc(PLACES["seattle"]), loc(PLACES["spokane"]), loc(PLACES["boise"])],
    },
    {
        "id": "rockies_balanced_same_window",
        "style": "balanced",
        "days": 5,
        "max_hours": 6,
        "camp_policy": "same_camp_window",
        "locations": [loc(PLACES["yellowstone"]), loc(PLACES["glacier"]), loc(PLACES["yellowstone"])],
    },
]


def summarize_route(data: dict[str, Any]) -> dict[str, Any]:
    trip = data.get("trip") or {}
    meta = data.get("_trailhead") or {}
    summary = trip.get("summary") or {}
    return {
        "ok": trip.get("status") == 0 and bool(trip.get("legs")),
        "engine": meta.get("engine"),
        "target": meta.get("target") or meta.get("valhalla_target"),
        "length_mi": round(float(summary.get("length") or 0), 1),
        "time_hr": round(float(summary.get("time") or 0) / 3600.0, 1),
        "repair": meta.get("repair"),
        "dropped_optional_points": meta.get("dropped_optional_points"),
        "error": meta.get("valhalla_error") or data.get("detail") or data.get("error") or trip.get("status_message"),
    }


def run_scenario(api: str, scenario: dict[str, Any], *, include_context: bool = True) -> dict[str, Any]:
    options = {
        "backRoads": scenario["style"] == "wild",
        "avoidHighways": scenario["style"] == "wild",
        "avoidTolls": True,
        "noFerries": False,
    }
    status, route_data, route_ms = request_json("POST", f"{api}/api/route", {
        "locations": scenario["locations"],
        "options": options,
        "units": "miles",
    })
    route_summary = summarize_route(route_data)
    result: dict[str, Any] = {
        "id": scenario["id"],
        "style": scenario["style"],
        "days": scenario["days"],
        "max_hours": scenario["max_hours"],
        "camp_policy": scenario["camp_policy"],
        "route_status": status,
        "route_ms": route_ms,
        "route": route_summary,
        "checks": [],
        "failures": [],
    }
    if not route_summary["ok"]:
        result["failures"].append(f"route failed: {route_summary.get('error')}")
        return result
    if scenario.get("expect_side_stop_repair") and route_summary.get("repair") != "dropped_optional_points":
        result["failures"].append("POI side stops did not report dropped_optional_points repair")
    if route_summary["length_mi"] <= 0 or route_summary["time_hr"] <= 0:
        result["failures"].append("route summary length/time missing")

    coords = route_coords(route_data)
    route_sample = route_lonlat_sample(coords)
    result["route_points"] = len(coords)
    if len(coords) < 2:
        result["failures"].append("route shape decode produced fewer than two points")
        return result

    same_window = scenario["camp_policy"] == "same_camp_window"
    windows = windows_for_route(coords, int(scenario["days"]), float(scenario["max_hours"]), same_window)
    status, camp_data, camp_ms = request_json("POST", f"{api}/api/route/camp-windows", {
        "route": [{"lat": lat, "lng": lon} for lat, lon in coords[:: max(1, len(coords) // 60)]],
        "windows": windows,
        "camp_filters": ["dispersed", "public"] if scenario["style"] == "wild" else [],
        "max_radius": 72 if scenario["style"] == "wild" else 58,
        "max_daily_drive_hours": scenario["max_hours"],
        "route_style": scenario["style"],
        "camp_preference": "public" if scenario["style"] == "wild" else "any",
        "require_photos": False,
        "region_hint": "",
    }, timeout=35)
    camp_windows = camp_data.get("windows") if isinstance(camp_data, dict) else None
    result["camp_status"] = status
    result["camp_ms"] = camp_ms
    result["camp"] = {
        "requested": len(windows),
        "returned": len(camp_windows or []),
        "errors": camp_data.get("errors") if isinstance(camp_data, dict) else None,
        "strong": sum(1 for w in (camp_windows or []) if w.get("strong")),
        "review": sum(1 for w in (camp_windows or []) if w.get("confidence") == "review"),
        "missing": sum(1 for w in (camp_windows or []) if w.get("confidence") == "missing"),
    }
    if status >= 400 or not isinstance(camp_windows, list):
        result["failures"].append(f"camp window endpoint failed: {camp_data}")
    elif len(camp_windows) != len(windows):
        result["failures"].append(f"camp windows returned {len(camp_windows)} of {len(windows)}")
    elif camp_data.get("errors"):
        result["failures"].append(f"camp windows errors: {camp_data.get('errors')}")

    center = coords[len(coords) // 2]
    if include_context:
        status, context_data, context_ms = request_json("POST", f"{api}/api/planner/context", {
            "center": {"lat": center[0], "lng": center[1]},
            "radius": 35,
            "route": route_sample[:40],
            "filters": ["fuel", "water", "trailhead", "viewpoint", "hot_spring", "attraction"],
        }, timeout=25)
        result["context_status"] = status
        result["context_ms"] = context_ms
        if status >= 400:
            result["failures"].append(f"planner context failed: {context_data}")
        else:
            result["context"] = {
                "camps": len(context_data.get("camps") or []),
                "places": len(context_data.get("places") or []),
                "trails": len(context_data.get("trails") or []),
                "errors": context_data.get("errors") or {},
            }
            if context_data.get("errors"):
                result["checks"].append(f"planner context provider errors: {context_data.get('errors')}")

    if len(scenario["locations"]) >= 3:
        durable = [
            {**p, "type": "break"}
            for p in scenario["locations"]
        ]
        status, poi_route_data, poi_ms = request_json("POST", f"{api}/api/route", {
            "locations": durable,
            "options": options,
            "units": "miles",
        }, timeout=45)
        poi_summary = summarize_route(poi_route_data)
        result["poi_break_route"] = {**poi_summary, "status": status, "ms": poi_ms}
        if not poi_summary["ok"]:
            result["checks"].append("POIs as hard breakpoints fail, but side_stop route succeeded")

    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default=DEFAULT_API)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--skip-context", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    api = args.api.rstrip("/")

    scenarios = SCENARIOS[: args.limit] if args.limit else SCENARIOS
    results = []
    for scenario in scenarios:
        print(f"RUN\t{scenario['id']}", flush=True)
        result = run_scenario(api, scenario, include_context=not args.skip_context)
        results.append(result)
        route = result["route"]
        camp = result.get("camp") or {}
        status = "PASS" if not result["failures"] else "FAIL"
        print(
            f"{status}\t{result['id']}\t{route.get('engine')}:{route.get('target')}\t"
            f"{route.get('length_mi')}mi/{route.get('time_hr')}h\t"
            f"camp {camp.get('returned','-')}/{camp.get('requested','-')} "
            f"strong={camp.get('strong','-')} review={camp.get('review','-')} missing={camp.get('missing','-')}\t"
            f"{'; '.join(result['failures'])}",
            flush=True,
        )
    failures = [result for result in results if result["failures"]]
    if args.json:
        print(json.dumps({"results": results, "failure_count": len(failures)}, indent=2, sort_keys=True))
    else:
        for result in results:
            for check in result.get("checks") or []:
                print(f"  note: {check}")
        print(json.dumps({"total": len(results), "failures": [r["id"] for r in failures]}, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
