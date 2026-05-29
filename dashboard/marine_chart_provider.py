"""Marine chart/source helpers for Trailhead Safe Water.

These helpers deliberately separate awareness layers from certified navigation.
The v1 providers are open/public context only; licensed chart providers can be
added here without rewriting map UI routes.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import re
import time
from typing import Any


@dataclass(frozen=True)
class MarineBounds:
    north: float
    south: float
    east: float
    west: float


@dataclass(frozen=True)
class MarineStation:
    id: str
    name: str
    lat: float
    lng: float
    provider: str
    source_url: str


LAKE_OF_THE_WOODS_BOUNDS = MarineBounds(north=49.55, south=48.35, east=-93.35, west=-95.65)

NDBC_LOTW = MarineStation(
    id="45148",
    name="Lake of the Woods buoy",
    lat=49.016,
    lng=-94.441,
    provider="NOAA NDBC / Environment Canada",
    source_url="https://www.ndbc.noaa.gov/station_page.php?station=45148",
)

NON_CERTIFIED_NAVIGATION_NOTE = (
    "Informational awareness only; not certified navigation, not a chartplotter, "
    "and not turn-by-turn boat routing. Verify with official/current charts, "
    "markers, water levels, weather, local notices, and required safety gear."
)


MARINE_PROVIDER_CAPABILITIES: dict[str, dict[str, Any]] = {
    "licensed_marine_chart": {
        "provider_class": "licensed_marine_chart",
        "status": "not_integrated",
        "offline": "entitlement_required",
        "coverage_confidence": "unknown_until_provider_contract",
        "supports_depth_ranges": True,
        "supports_hazards": True,
        "supports_structure": True,
        "supports_corridors": True,
        "note": "Intended premium path for recreational chart/depth packs. Do not display, redistribute, or cache commercial chart data without explicit rights.",
    },
    "public_live_chart": {
        "provider_class": "public_live_chart",
        "status": "active",
        "offline": "live_only",
        "coverage_confidence": "official_where_available",
        "supports_depth_ranges": False,
        "supports_hazards": False,
        "supports_structure": False,
        "supports_corridors": False,
        "note": "NOAA and CHS/NONNA context is live-only in v1 unless a separate licensed offline path is approved.",
    },
    "open_seamark": {
        "provider_class": "open_seamark",
        "status": "active",
        "offline": "cacheable_feature_context",
        "coverage_confidence": "community_mapped",
        "supports_depth_ranges": False,
        "supports_hazards": True,
        "supports_structure": False,
        "supports_corridors": True,
        "note": "OpenSeaMap/OSM seamarks can expose aids, hazards, fairways, and recommended tracks where mapped, but coverage is incomplete.",
    },
    "community_user": {
        "provider_class": "community/user",
        "status": "active",
        "offline": "user_saved",
        "coverage_confidence": "user_asserted",
        "supports_depth_ranges": False,
        "supports_hazards": True,
        "supports_structure": True,
        "supports_corridors": False,
        "note": "User marks, catch notes, saved fishing spots, and community edits are app-owned context, not official chart data.",
    },
    "derived": {
        "provider_class": "derived",
        "status": "planned",
        "offline": "derived_pack_if_source_rights_allow",
        "coverage_confidence": "source_dependent",
        "supports_depth_ranges": True,
        "supports_hazards": True,
        "supports_structure": True,
        "supports_corridors": True,
        "note": "Derived structure/hazard summaries may be generated only from sources Trailhead has rights to use.",
    },
}


def _intersects(a: MarineBounds, b: MarineBounds) -> bool:
    return not (a.east < b.west or a.west > b.east or a.north < b.south or a.south > b.north)


def _haversine_mi(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_mi = 3958.7613
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * radius_mi * math.asin(math.sqrt(a))


def is_lake_of_the_woods(lat: float, lng: float, name: str = "") -> bool:
    text = name.lower()
    return (
        "lake of the woods" in text
        or "lac des bois" in text
        or (LAKE_OF_THE_WOODS_BOUNDS.south <= lat <= LAKE_OF_THE_WOODS_BOUNDS.north and LAKE_OF_THE_WOODS_BOUNDS.west <= lng <= LAKE_OF_THE_WOODS_BOUNDS.east)
    )


def is_likely_canadian_water(lat: float, lng: float, name: str = "") -> bool:
    if is_lake_of_the_woods(lat, lng, name):
        return True
    if -141.5 <= lng <= -52.0 and lat >= 49.0:
        return True
    if -67.5 <= lng <= -52.0 and lat >= 43.0:
        return True
    return False


def chart_context(lat: float, lng: float, name: str = "") -> dict[str, str]:
    if is_likely_canadian_water(lat, lng, name):
        return {
            "chart_source": "CHS NONNA bathymetry (non-navigational) for Canadian waters; Lake of the Woods also has CHS chart 6201 official chart context.",
            "chart_url": "https://www.chs.gc.ca/data-gestion/nonna/index-eng.html",
            "safety_url": "https://tc.canada.ca/en/marine-transportation/marine-safety/boating-safety",
            "navigation_note": "NONNA bathymetry is not for navigation. Verify with official CHS charts, local markers, water levels, weather, and required safety gear before boating.",
        }
    return {
        "chart_source": "NOAA ENC chart layer where coverage exists; many inland waters may not have charted depth or hazard data.",
        "chart_url": "https://www.nauticalcharts.noaa.gov/charts/noaa-enc.html",
        "safety_url": "https://www.uscgboating.org/",
        "navigation_note": "Waterbody context only. Use NOAA chart coverage where available and verify local charts, conditions, water levels, and safety requirements before boating.",
    }


def marine_chart_profile(bounds: MarineBounds) -> dict[str, Any]:
    center_lat = (bounds.north + bounds.south) / 2
    center_lng = (bounds.east + bounds.west) / 2
    lotw = _intersects(bounds, LAKE_OF_THE_WOODS_BOUNDS)
    canadian = lotw or center_lat >= 49.0 or (center_lng >= -67.5 and center_lat >= 43.0)
    sources: list[dict[str, Any]] = [
        {
            "id": "open_seamark",
            "name": "OpenSeaMap / OpenStreetMap seamarks",
            "role": "aids_hazards_tracks",
            "status": "active",
            "offline": False,
            "confidence": "community",
            "url": "https://wiki.openseamap.org/wiki/OpenSeaMap-dev:Seamark-tagging",
            "note": "Open seamark tags for buoys, markers, rocks, wrecks, channels, and recommended tracks where mapped.",
        },
    ]
    if canadian:
        sources.append({
            "id": "chs_nonna",
            "name": "CHS NONNA bathymetry",
            "role": "bathymetry_depth_imagery",
            "status": "active",
            "offline": False,
            "confidence": "official_non_navigational",
            "url": "https://www.chs.gc.ca/data-gestion/nonna/index-eng.html",
            "note": "Canadian Hydrographic Service bathymetry for non-navigational use only.",
        })
    if bounds.south < 49.3 and bounds.west < -66:
        sources.append({
            "id": "noaa_charts",
            "name": "NOAA ENC raster chart proxy",
            "role": "official_us_chart_imagery",
            "status": "active",
            "offline": False,
            "confidence": "official",
            "url": "https://nauticalcharts.noaa.gov/charts/noaa-enc.html",
            "note": "U.S. NOAA chart imagery where coverage exists; inland lake coverage varies.",
        })
    if lotw:
        sources.extend([
            {
                "id": "mn_dnr_lake_bathymetry",
                "name": "Minnesota DNR Lake Bathymetry",
                "role": "source_probe",
                "status": "no_lotw_coverage_found",
                "offline": True,
                "confidence": "source_probe_no_lotw_features",
                "url": "https://www.mngeo.state.mn.us/chouse/water_lakes.html",
                "note": "Selected Minnesota lakes include bathymetric contours, DEM, outlines, and aquatic vegetation, but the published GeoPackage returned no Lake of the Woods features.",
            },
            {
                "id": "ndbc_45148",
                "name": NDBC_LOTW.name,
                "role": "live_conditions",
                "status": "active",
                "offline": False,
                "confidence": "observed",
                "url": NDBC_LOTW.source_url,
                "station_id": NDBC_LOTW.id,
                "note": "Lake of the Woods buoy observations for wind, waves, pressure, temperature, and water temperature when available.",
            },
        ])
    try:
        from dashboard.hydro_provider import hydro_profile
        hydro = hydro_profile(bounds)
    except Exception:
        hydro = None
    hydro_counts = (hydro or {}).get("counts") or {}
    licensed_available = False
    depth_ranges = [
        {"id": "shallow_0_5", "label": "0-5 ft", "hazard": True},
        {"id": "shallow_5_10", "label": "5-10 ft", "hazard": False},
        {"id": "moderate_10_20", "label": "10-20 ft", "hazard": False},
        {"id": "deep_20_40", "label": "20-40 ft", "hazard": False},
        {"id": "deep_40_plus", "label": "40+ ft", "hazard": False},
    ]
    return {
        "mode": "safe_water_awareness",
        "region": "lake_of_the_woods" if lotw else ("canada" if canadian else "us_or_open_water"),
        "sources": sources,
        "provider_capabilities": MARINE_PROVIDER_CAPABILITIES,
        "licensed_chart": {
            "available": licensed_available,
            "status": "not_integrated",
            "offline_ready": False,
            "coverage_confidence": "none",
            "note": "No licensed Lake of the Woods chart pack is integrated yet.",
        },
        "offline_status": {
            "base_map": "offline_ready_when_downloaded",
            "places": "offline_ready_when_downloaded",
            "user_spots": "offline_ready",
            "open_seamark": "cacheable_after_fetch",
            "public_live_chart": "live_only",
            "licensed_marine_chart": "unavailable",
        },
        "depth_ranges": depth_ranges,
        "hazard_summary": {
            "hydro_hazards": int(hydro_counts.get("hazards") or 0),
            "open_seamark_hazards": "viewport_dependent",
            "source_confidence": (hydro or {}).get("coverage") or "none",
        },
        "corridor_availability": {
            "status": "planning_only",
            "licensed_provider_required_for_premium_confidence": True,
            "turn_by_turn": False,
            "certified_navigation": False,
        },
        "hydro": hydro,
        "recommended_next_pipeline": "licensed_lotw_hydro_source_or_chs_offline_path" if lotw else "licensed_or_official_chart_provider",
        "disclaimer": NON_CERTIFIED_NAVIGATION_NOTE,
    }


def marine_spot_cards(bounds: MarineBounds) -> dict[str, Any]:
    """Return premium fishing/structure card scaffolds without claiming chart coverage."""
    lotw = _intersects(bounds, LAKE_OF_THE_WOODS_BOUNDS)
    cards: list[dict[str, Any]] = []
    if lotw:
        cards = [
            {
                "id": "lotw-nw-reef-edge",
                "name": "Northwest reef edge",
                "kind": "structure",
                "lat": 49.02,
                "lng": -94.53,
                "species_targets": ["walleye", "sauger"],
                "depth_range_ft": {"min": 12, "max": 22, "source": "derived_placeholder"},
                "structure": ["reef edge", "channel break", "wind drift"],
                "best_context": ["evening", "moderate wind", "clear hazard visibility"],
                "actions": ["save_spot", "add_catch_log", "open_regulations", "check_conditions"],
                "source": "Trailhead example card + public/live Safe Water context",
                "source_confidence": "prototype_context",
                "navigation_note": NON_CERTIFIED_NAVIGATION_NOTE,
            },
            {
                "id": "lotw-morson-ramp-access",
                "name": "Morson ramp access context",
                "kind": "access",
                "lat": 49.10,
                "lng": -94.32,
                "species_targets": [],
                "structure": ["ramp", "marina access", "open-water departure"],
                "actions": ["navigate_to_access", "save_spot", "check_conditions"],
                "source": "Public access context; verify local ramp status before departure.",
                "source_confidence": "public_context",
                "navigation_note": NON_CERTIFIED_NAVIGATION_NOTE,
            },
        ]
    return {
        "mode": "safe_water_fishing",
        "region": "lake_of_the_woods" if lotw else "generic",
        "cards": cards,
        "empty_state": None if cards else "No premium fishing cards are available for this viewport yet.",
        "source_disclosure": "Fishing cards combine user/app-owned notes with public/live source context. Restricted chart data is not inferred or cached.",
    }


def fishing_conditions(lat: float, lng: float, at_ts: int | None = None) -> dict[str, Any]:
    station = nearest_marine_station(lat, lng)
    now = at_ts or int(time.time())
    hour = int((now // 3600) % 24)
    major_start = (hour + 2) % 24
    minor_start = (hour + 7) % 24
    return {
        "mode": "safe_water_fishing_conditions",
        "station": station,
        "solunar": {
            "status": "heuristic_placeholder",
            "major_window": f"{major_start:02d}:00-{(major_start + 2) % 24:02d}:00",
            "minor_window": f"{minor_start:02d}:00-{(minor_start + 1) % 24:02d}:00",
            "source": "Trailhead heuristic placeholder until a licensed/validated solunar provider is integrated.",
        },
        "weather_source": "Use /api/water/conditions for observed buoy context where available.",
        "source_disclosure": "Conditions are planning context only and can change faster than the app refreshes.",
        "navigation_note": NON_CERTIFIED_NAVIGATION_NOTE,
    }


def suggested_corridor(
    *,
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    draft_ft: float | None = None,
) -> dict[str, Any]:
    distance_mi = _haversine_mi(start_lat, start_lng, end_lat, end_lng)
    mid_lat = (start_lat + end_lat) / 2
    mid_lng = (start_lng + end_lng) / 2
    point_count = max(12, min(64, int(distance_mi * 3) + 2))
    bend = 0.035 if is_lake_of_the_woods(mid_lat, mid_lng) else 0.012
    coordinates: list[list[float]] = []
    for idx in range(point_count):
        t = idx / max(1, point_count - 1)
        lat = start_lat + (end_lat - start_lat) * t
        lng = start_lng + (end_lng - start_lng) * t
        offset = math.sin(math.pi * t) * bend
        coordinates.append([round(lng + offset, 6), round(lat, 6)])
    conflicts = [
        {
            "kind": "licensed_chart_missing",
            "severity": "blocking_for_premium_confidence",
            "note": "No licensed chart provider is integrated for this corridor.",
        },
        {
            "kind": "official_navigation_unavailable",
            "severity": "warning",
            "note": "Trailhead corridors are planning-only awareness, not official navigation.",
        },
    ]
    if draft_ft is not None and draft_ft >= 4:
        conflicts.append({
            "kind": "draft_requires_depth_review",
            "severity": "warning",
            "note": f"Draft {draft_ft:g} ft requires local depth verification before departure.",
        })
    return {
        "mode": "safe_water_corridor",
        "status": "candidate_planning_only",
        "geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
        "distance_mi": round(distance_mi, 2),
        "eta_minutes": round((distance_mi / 16.0) * 60) if distance_mi else 0,
        "conflicts": conflicts,
        "source_confidence": "low_planning_corridor",
        "source_disclosure": "Planning only.",
        "route_points": [
            {"name": "Start", "lat": start_lat, "lng": start_lng, "kind": "start"},
            {"name": "End", "lat": end_lat, "lng": end_lng, "kind": "end"},
        ],
        "turn_by_turn": False,
        "certified_navigation": False,
        "navigation_note": NON_CERTIFIED_NAVIGATION_NOTE,
    }


def nearest_marine_station(lat: float, lng: float) -> dict[str, Any] | None:
    distance = _haversine_mi(lat, lng, NDBC_LOTW.lat, NDBC_LOTW.lng)
    if distance > 140 and not is_lake_of_the_woods(lat, lng):
        return None
    return {
        "id": NDBC_LOTW.id,
        "name": NDBC_LOTW.name,
        "lat": NDBC_LOTW.lat,
        "lng": NDBC_LOTW.lng,
        "provider": NDBC_LOTW.provider,
        "source_url": NDBC_LOTW.source_url,
        "distance_mi": round(distance, 1),
    }


def _num(value: str) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed >= 99 or parsed <= -99:
        return None
    return parsed


def parse_ndbc_realtime(text: str, station: dict[str, Any]) -> dict[str, Any] | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    headers: list[str] | None = None
    values: list[str] | None = None
    for line in lines:
        if line.startswith("#YY"):
            headers = line.lstrip("#").split()
            continue
        if line.startswith("#"):
            continue
        if headers:
            values = line.split()
            break
    if not headers or not values:
        return None
    row = dict(zip(headers, values))
    year = int(row.get("YY", "0") or 0)
    if year and year < 100:
        year += 2000
    observed_at = None
    try:
        observed_at = int(time.mktime((
            year,
            int(row.get("MM", "1")),
            int(row.get("DD", "1")),
            int(row.get("hh", "0")),
            int(row.get("mm", "0")),
            0,
            0,
            0,
            0,
        )))
    except Exception:
        observed_at = None

    wind_kt = _num(row.get("WSPD", ""))
    gust_kt = _num(row.get("GST", ""))
    wave_m = _num(row.get("WVHT", ""))
    air_c = _num(row.get("ATMP", ""))
    water_c = _num(row.get("WTMP", ""))
    pressure_hpa = _num(row.get("PRES", ""))
    wave_ft = round(wave_m * 3.28084, 1) if wave_m is not None else None
    wind_mph = round(wind_kt * 1.15078, 1) if wind_kt is not None else None
    gust_mph = round(gust_kt * 1.15078, 1) if gust_kt is not None else None
    risk_score = 0
    if wave_ft is not None:
        risk_score += 35 if wave_ft >= 3 else 20 if wave_ft >= 2 else 8 if wave_ft >= 1 else 0
    if gust_mph is not None:
        risk_score += 35 if gust_mph >= 30 else 22 if gust_mph >= 22 else 10 if gust_mph >= 15 else 0
    elif wind_mph is not None:
        risk_score += 25 if wind_mph >= 24 else 15 if wind_mph >= 17 else 6 if wind_mph >= 12 else 0
    risk_score = min(risk_score, 100)
    risk_label = "High" if risk_score >= 55 else "Moderate" if risk_score >= 25 else "Low"
    return {
        "station": station,
        "observed_at": observed_at,
        "wind_dir_deg": _num(row.get("WDIR", "")),
        "wind_kt": wind_kt,
        "wind_mph": wind_mph,
        "gust_kt": gust_kt,
        "gust_mph": gust_mph,
        "wave_height_m": wave_m,
        "wave_height_ft": wave_ft,
        "dominant_period_s": _num(row.get("DPD", "")),
        "average_period_s": _num(row.get("APD", "")),
        "air_temp_c": air_c,
        "water_temp_c": water_c,
        "pressure_hpa": pressure_hpa,
        "crossing_risk": {"score": risk_score, "label": risk_label},
        "source": "NOAA NDBC realtime text feed",
        "source_url": f"https://www.ndbc.noaa.gov/data/realtime2/{station['id']}.txt",
        "navigation_note": "Observed conditions only. Local wind fetch, storms, reefs, current, water level, and vessel capability can make conditions more hazardous.",
    }


def parse_draft_feet(text: str) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", str(text or ""))
    if not match:
        return None
    value = float(match.group(0))
    lowered = str(text).lower()
    if "m" in lowered and "mi" not in lowered:
        return round(value * 3.28084, 1)
    return round(value, 1)
