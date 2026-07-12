#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

try:
    from .canonical_catalog_rules import (
        PUBLIC_COPY_FORBIDDEN_RE,
        classify_camp_kind,
        compact,
        is_non_overnight_camp_label,
        is_primary_rv_label,
        public_label_for_camp_kind,
        repair_public_title,
    )
except ImportError:
    from canonical_catalog_rules import (
        PUBLIC_COPY_FORBIDDEN_RE,
        classify_camp_kind,
        compact,
        is_non_overnight_camp_label,
        is_primary_rv_label,
        public_label_for_camp_kind,
        repair_public_title,
    )

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.explore_sources.base.enrichment import REVIEWABLE_GRADES, enrich_place_dict, primary_media_url

OFFICIAL_DB = ROOT / "data" / "processed" / "trailhead_official_data.sqlite"
APP_DB = ROOT / "trailhead.db"
EXPLORE_CANDIDATE = ROOT / "data" / "processed" / "explore_catalog_v3.candidate.json"
OUT_DIR = ROOT / "data" / "processed" / "canonical_serving"


SOURCE_RANKS = {
    "trailhead": 0,
    "nps": 8,
    "national park service": 8,
    "ridb": 10,
    "recreation.gov": 10,
    "usfs": 12,
    "us forest service": 12,
    "blm": 14,
    "osm": 40,
    "openstreetmap": 40,
    "geoapify": 45,
}

GENERIC_EXPLORE_DESCRIPTION_RE = re.compile(
    r"\b(?:has overnight options around the area|is a managed recreation stop|"
    r"check current access, fees, fire restrictions, reservations, and seasonal road conditions before you go)\b",
    re.I,
)
GENERIC_EXPLORE_TITLES = {
    "campground",
    "campgrounds",
    "national forest",
    "national park",
    "park",
    "recreation area",
    "state park",
}
DROP_EXPLORE_CATEGORY = ("__drop__", "__drop__")

EXPLORER_FILTER_CATEGORIES = {
    "camp": {"campground", "rv_park", "dispersed_camp", "overnight_parking"},
    "trails": {"trail", "trailhead"},
    "parks": {"park"},
    "water": {"lake", "water"},
    "views": {"viewpoint"},
    "things": {"activity", "historic", "permit_required", "visitor_center"},
    "land": {"forest", "public_land"},
    "huts": {"lodging"},
    "waterfalls": {"waterfall"},
    "peaks": {"peak", "glacier"},
    "trailheads": {"trailhead"},
    "glamping": {"glamping"},
    "springs": {"hot_spring"},
    "climb": {"bouldering_area", "climbing_area"},
    "scenic": {"forest_road", "offroad_route", "scenic_drive"},
    "fuel": {"fuel"},
    "resupply": {"resupply"},
}

OLD_MARKER_RE = re.compile(r"\(\s*old\s*\)", re.I)
UPPER_OLD_MARKER_RE = re.compile(r"\bOLD\b")
TIMED_ENTRY_YEAR_RE = re.compile(r"\bTimed Entry\s*\(\s*20\d{2}\s*\)", re.I)

GENERIC_TRAIL_NAMES = {
    "access",
    "connector",
    "connect",
    "cut across",
    "cutoff",
    "road",
    "service road",
    "side trail",
    "trail",
    "unknown",
}

KNOWN_PUBLIC_TRAIL_ACRONYMS = {
    "AT",
    "AZT",
    "BMT",
    "CDT",
    "JMT",
    "MST",
    "PCT",
    "PNT",
}

TITLE_CASE_KEEPERS = {
    "anst": "ANST",
    "atv": "ATV",
    "blm": "BLM",
    "cg": "Campground",
    "cr": "Creek",
    "fk": "Fork",
    "fs": "FS",
    "hwy": "Hwy",
    "mst": "MST",
    "mt": "Mount",
    "mtn": "Mountain",
    "nrt": "NRT",
    "ohv": "OHV",
    "orv": "ORV",
    "pct": "PCT",
    "rd": "Road",
    "usfs": "USFS",
}

SURFACE_LABELS = {
    "NAT - NATIVE MATERIAL": "Natural surface",
    "NATIVE MATERIAL": "Natural surface",
    "IMPORTED LOOSE MATERIAL": "Loose gravel",
    "IMPORTED COMPACTED MATERIAL": "Compacted surface",
    "CRUSHED AGGREGATE OR GRAVEL": "Gravel",
    "AGG - CRUSHED AGGREGATE OR GRAVEL": "Gravel",
    "ASPHALT": "Paved",
    "AC- ASPHALT": "Paved",
    "CONCRETE": "Paved",
    "CON - CONCRETE": "Paved",
    "SNOW": "Snow route",
    "WATER": "Water route",
}

DIFFICULTY_LABELS = {
    "1": "Easy",
    "2": "Moderate",
    "3": "Moderate",
    "4": "Hard",
    "5": "Very hard",
}

USE_LABELS = {
    "4x4": "4x4",
    "biking": "mountain biking",
    "hiking": "hiking",
    "horse": "horseback riding",
    "motorcycle": "motorcycling",
    "motorcycling": "motorcycling",
}


def connect(path: Path) -> sqlite3.Connection | None:
    if not path.exists():
        return None
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    return db


def load_json(raw: object, fallback: Any) -> Any:
    if raw in (None, ""):
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(str(raw))
    except Exception:
        return fallback


def point_from_geojson(raw: object) -> tuple[float | None, float | None]:
    geom = load_json(raw, None)
    if not isinstance(geom, dict):
        return None, None
    coords = geom.get("coordinates")
    if geom.get("type") == "Point" and isinstance(coords, list) and len(coords) >= 2:
        return valid_point(coords[1], coords[0])
    if geom.get("type") == "LineString" and isinstance(coords, list) and coords:
        return coord_pair(coords[0])
    if geom.get("type") == "MultiLineString" and isinstance(coords, list):
        for line in coords:
            if isinstance(line, list) and line:
                point = coord_pair(line[0])
                if point != (None, None):
                    return point
    return None, None


def coord_pair(value: object) -> tuple[float | None, float | None]:
    if not isinstance(value, list) or len(value) < 2:
        return None, None
    return valid_point(value[1], value[0])


def line_endpoints_from_geojson(raw: object) -> tuple[tuple[float, float] | None, tuple[float, float] | None]:
    geom = load_json(raw, None)
    if not isinstance(geom, dict):
        return None, None
    coords = geom.get("coordinates")
    first: object = None
    last: object = None
    if geom.get("type") == "LineString" and isinstance(coords, list) and coords:
        first, last = coords[0], coords[-1]
    elif geom.get("type") == "MultiLineString" and isinstance(coords, list):
        for line in coords:
            if isinstance(line, list) and line:
                first = line[0]
                break
        for line in reversed(coords):
            if isinstance(line, list) and line:
                last = line[-1]
                break
    start = coord_pair(first)
    end = coord_pair(last)
    return (
        (start[0], start[1]) if start != (None, None) else None,
        (end[0], end[1]) if end != (None, None) else None,
    )


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1 = a
    lat2, lng2 = b
    radius_m = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    h = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius_m * math.asin(math.sqrt(h))


def valid_point(lat: object, lng: object) -> tuple[float | None, float | None]:
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except Exception:
        return None, None
    if math.isfinite(lat_f) and math.isfinite(lng_f) and -90 <= lat_f <= 90 and -180 <= lng_f <= 180:
        return lat_f, lng_f
    return None, None


def source_rank(value: object) -> int:
    text = compact(value).lower()
    for needle, rank in SOURCE_RANKS.items():
        if needle in text:
            return rank
    return 50


def name_key(value: object) -> str:
    text = compact(value).lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\b(campgrounds?|campsites?|camp\s*sites?|rv park|rv resort|trailheads?|trails?)\b", " ", text)
    return re.sub(r"[^a-z0-9]+", "", text)[:80]


def clean_explore_title(value: object, *context_values: object, category: object = "") -> str:
    text = compact(value)
    if not text:
        return ""
    text = OLD_MARKER_RE.sub(" ", text)
    text = UPPER_OLD_MARKER_RE.sub(" ", text)
    if TIMED_ENTRY_YEAR_RE.search(text):
        text = re.sub(r"\s*\(\s*20\d{2}\s*\)", " ", text)
    return repair_public_title(text, *context_values, category=category)


def is_stale_explore_title(value: object) -> bool:
    text = compact(value)
    return bool(OLD_MARKER_RE.search(text) or UPPER_OLD_MARKER_RE.search(text) or TIMED_ENTRY_YEAR_RE.search(text))


def public_sentence_parts(value: object) -> list[str]:
    text = compact(value)
    if not text:
        return []
    placeholder = "<trailhead-dot>"
    text = re.sub(r"\b(Mt|St|Ste|Dr|Mr|Mrs|Ms|Jr|Sr|Rd|Hwy|Ft|Lt|Col|Gen|Capt|Sgt|Rev)\.", rf"\1{placeholder}", text)
    text = re.sub(r"\b([A-Z])\.", rf"\1{placeholder}", text)
    parts = [part.replace(placeholder, ".").strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    return parts


def first_sentence(value: object, max_len: int = 220) -> str:
    text = compact(value)
    if not text:
        return ""
    bullet_summary = False
    if text.startswith("-") and " - " in text:
        parts = [compact(part.strip(" -")) for part in re.split(r"\s+-\s+", text) if compact(part.strip(" -"))]
        if parts:
            text = ". ".join(parts[:2])
            bullet_summary = True
    if bullet_summary:
        out = text
    else:
        parts = public_sentence_parts(text)
        while parts and re.match(r"^\s*(?:attention\s+campers!?|want to camp\?|going camping\?|contact info\b|hey ranger, what plant is this\?)\s*$", parts[0], re.I):
            parts = parts[1:]
        if parts and re.match(r"^\s*attention\b", parts[0], re.I):
            current_year = time.gmtime().tm_year
            years = [int(year) for year in re.findall(r"\b20\d{2}\b", parts[0])]
            if years and max(years) < current_year - 1:
                parts = parts[1:]
        out = parts[0] if parts else text
    was_clipped = False
    if len(out) > max_len:
        out = out[:max_len].rsplit(" ", 1)[0].rstrip(".,;:") + "."
        was_clipped = True
    out = re.sub(r"\s*\([^)]*$", "", out).strip()
    out = re.sub(r"^\s*[-•]\s*", "", out).strip()
    dangling_words = {"as", "with", "and", "or", "the", "of", "to", "in", "for", "from", "by", "on", "at", "a", "an"}
    while True:
        stripped = out.rstrip(".!?").rstrip()
        words = stripped.split()
        if not words or words[-1].lower() not in dangling_words:
            break
        out = " ".join(words[:-1]).rstrip(" ,;:-")
        if out:
            out += "."
    if was_clipped:
        out = re.sub(r"\s+as\s+(?:a|an|the)\s+\w+\.?$", ".", out, flags=re.I).strip()
        out = re.sub(r"\s+in\s+addition(?:\s+to(?:\s+the)?\s+\w+)?\.?$", ".", out, flags=re.I).strip()
    return out


def clean_source_summary(value: object, max_len: int = 220) -> str:
    text = compact(value)
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = clean_explore_title(text)
    text = re.sub(r"([a-z])is located\b", r"\1 is located", text)
    text = re.sub(r"([.!?])([A-Z][a-z])", r"\1 \2", text)
    text = re.sub(r"^\s*(?:overview|recreation|facilities|natural features|nearby attractions)\s+", "", text, flags=re.I)
    text = re.sub(r"\bdownload\b[^.!?]*(?:[.!?]|$)", " ", text, flags=re.I)
    text = re.sub(r"\b(?:RIDB|API|FeatureServer|database dump|raw record|raw source|endpoint|schema)\b[^.]*\.?", " ", text, flags=re.I)
    text = re.sub(r"\b(?:downloaded|imported|synced)\b[^.]*\.?", " ", text, flags=re.I)
    text = re.sub(r"\b(?:rig aware|offline ready)\b", " ", text, flags=re.I)
    text = re.sub(r"\bnear the area\b", "nearby", text, flags=re.I)
    text = compact(text)
    if PUBLIC_COPY_FORBIDDEN_RE.search(text):
        return ""
    return first_sentence(text, max_len=max_len)


def clean_optional_label(value: object) -> str:
    text = compact(value)
    if text.lower() in {"", "0", "n/a", "na", "none", "null", "undefined", "unknown"}:
        return ""
    return "" if PUBLIC_COPY_FORBIDDEN_RE.search(text) else text


def public_trail_distance_mi(value: object) -> float | None:
    try:
        distance = float(value or 0)
    except Exception:
        return None
    if not math.isfinite(distance):
        return None
    miles = distance / 1609.344
    return round(miles, 2) if miles >= 0.05 else None


def public_trail_is_short_access(value: object) -> bool:
    try:
        distance = float(value or 0)
    except Exception:
        return False
    return math.isfinite(distance) and 0 < distance < 80


def public_trail_elevation_gain_ft(value: object) -> int | None:
    try:
        meters = float(value or 0)
    except Exception:
        return None
    if not math.isfinite(meters) or meters < 6:
        return None
    feet = int(round((meters * 3.28084) / 10.0) * 10)
    return feet if feet > 0 else None


def public_trail_route_shape(route_geom: object, distance_m: object = None) -> str:
    try:
        distance = float(distance_m or 0)
    except Exception:
        distance = 0
    if distance < 400:
        return ""
    start, end = line_endpoints_from_geojson(route_geom)
    if not start or not end:
        return ""
    if haversine_m(start, end) <= 160:
        return "Loop"
    return "Point-to-point"


def public_trail_title(value: object) -> str:
    text = compact(value).strip("\"'“”‘’")
    text = re.sub(r"\s+", " ", text)
    if not text:
        return ""
    letters = re.sub(r"[^A-Za-z]+", "", text)
    uppercase_ratio = (sum(1 for char in letters if char.isupper()) / len(letters)) if letters else 0
    if uppercase_ratio > 0.75:
        text = text.lower().title()
    text = re.sub(r"([A-Za-z])'S\b", lambda match: f"{match.group(1)}'s", text)
    for raw, replacement in TITLE_CASE_KEEPERS.items():
        text = re.sub(rf"\b{re.escape(raw)}\b", replacement, text, flags=re.I)
    text = re.sub(r"\b(?:Mount|Mt)\.?\s+Bike\b", "Mountain Bike", text, flags=re.I)
    text = re.sub(r"\bN\s+Fork\b", "North Fork", text)
    text = re.sub(r"\bS\s+Fork\b", "South Fork", text)
    text = re.sub(r"\bE\s+Fork\b", "East Fork", text)
    text = re.sub(r"\bW\s+Fork\b", "West Fork", text)
    text = re.sub(r"\bCr\b", "Creek", text, flags=re.I)
    text = re.sub(r"\b4X4\b", "4x4", text)
    text = re.sub(r"\bMgra\b", "MGRA", text)
    text = re.sub(r"\bTrail\s*-\s*", "Trail - ", text, flags=re.I)
    text = re.sub(r"\s*/\s*", " / ", text)
    suffix_repairs = {
        "Branc": "Branch",
        "Cree": "Creek",
        "Lak": "Lake",
        "Roa": "Road",
        "Trai": "Trail",
    }
    for raw, replacement in suffix_repairs.items():
        text = re.sub(rf"\b{raw}$", replacement, text, flags=re.I)
    text = re.sub(r"\bJacks Bra$", "Jacks Branch", text, flags=re.I)
    text = re.sub(r"\bNatl Rec$", "National Recreation Trail", text, flags=re.I)
    return compact(text)


def trail_name_key(value: object) -> str:
    text = public_trail_title(value).lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\b(trailheads?|trails?|routes?|loops?)\b", " ", text)
    return re.sub(r"[^a-z0-9]+", "", text)[:96]


def public_trail_difficulty(value: object) -> str:
    text = compact(value)
    if not text or text.lower() in {"n", "n/a", "na", "none", "null", "undefined", "unknown", "0"}:
        return ""
    upper = text.upper()
    if upper in DIFFICULTY_LABELS:
        return DIFFICULTY_LABELS[upper]
    if text.lower() in {"easy", "moderate", "hard", "very hard", "strenuous"}:
        return "Very hard" if text.lower() == "strenuous" else text.capitalize()
    return "" if PUBLIC_COPY_FORBIDDEN_RE.search(text) else text


def public_trail_surface(value: object) -> str:
    text = compact(value)
    if not text or text.lower() in {"n/a", "na", "none", "null", "undefined", "unknown", "other", "0"}:
        return ""
    upper = text.upper()
    if upper in SURFACE_LABELS:
        return SURFACE_LABELS[upper]
    return "" if PUBLIC_COPY_FORBIDDEN_RE.search(text) else text.title()


def public_trail_uses(value: object) -> str:
    raw = compact(value)
    if not raw or raw.lower() in {"n/a", "na", "none", "null", "undefined", "unknown", "0"}:
        return ""
    labels: list[str] = []
    for part in re.split(r"[,;/]+", raw):
        key = compact(part).lower()
        label = USE_LABELS.get(key)
        if label and label not in labels:
            labels.append(label)
    if not labels:
        return "" if PUBLIC_COPY_FORBIDDEN_RE.search(raw) else raw
    if len(labels) == 1:
        return labels[0].capitalize() if labels[0] != "4x4" else "4x4"
    return ", ".join(labels[:-1]).capitalize() + f", and {labels[-1]}"


def public_trail_activity(item: dict[str, Any]) -> str:
    text = " ".join(
        compact(item.get(key)).lower()
        for key in ("name", "allowed_uses", "surface")
        if compact(item.get(key))
    )
    if "snowmobile" in text or "snow route" in text:
        return "Snowmobile route"
    if re.search(r"\b(ohv|orv|atv|4x4|jeep|motorcycl\w*|motorized)\b", text):
        return "OHV route"
    if "mountain biking" in text:
        return "Bike trail"
    if "horseback" in text:
        return "Horse trail"
    if "water route" in text:
        return "Water route"
    return "Hiking trail"


def public_trail_fact_labels(item: dict[str, Any]) -> list[str]:
    facts: list[str] = []
    distance = item.get("distance_mi")
    if isinstance(distance, (int, float)) and distance >= 0.05:
        facts.append(f"{float(distance):.1f} mi")
    elif item.get("short_access"):
        facts.append("Short access")
    gain = item.get("elevation_gain_ft")
    if isinstance(gain, int) and gain > 0:
        facts.append(f"{gain:,} ft gain")
    shape = clean_optional_label(item.get("route_shape"))
    if shape:
        facts.append(shape)
    for key in ("difficulty", "activity", "surface", "season_text"):
        text = clean_optional_label(item.get(key))
        if text and text not in facts:
            facts.append(text)
    return facts[:5]


def public_trail_quality_score(item: dict[str, Any]) -> int:
    score = 35
    if item.get("distance_mi"):
        score += 20
    elif item.get("short_access"):
        score += 6
    if item.get("difficulty"):
        score += 12
    if item.get("allowed_uses"):
        score += 12
    if item.get("surface"):
        score += 10
    if item.get("elevation_gain_ft"):
        score += 6
    if item.get("route_shape"):
        score += 3
    if item.get("season_text"):
        score += 5
    if item.get("review_only"):
        score = min(score, 25)
    return max(0, min(score, 100))


def public_trail_summary(item: dict[str, Any]) -> str:
    parts: list[str] = []
    distance = item.get("distance_mi")
    if isinstance(distance, (int, float)) and distance >= 0.05:
        unit = "mile" if round(float(distance), 1) == 1.0 else "miles"
        parts.append(f"{float(distance):.1f} {unit}")
    elif item.get("short_access"):
        parts.append("Short trail access")
    gain = item.get("elevation_gain_ft")
    if isinstance(gain, int) and gain > 0:
        parts.append(f"{gain:,} ft gain")
    shape = clean_optional_label(item.get("route_shape"))
    if shape:
        parts.append(shape)
    activity = clean_optional_label(item.get("activity"))
    for key in ("difficulty", "activity", "allowed_uses", "surface", "season_text"):
        text = clean_optional_label(item.get(key))
        if key == "allowed_uses" and activity == "Hiking trail" and text == "Hiking":
            continue
        if text and text not in parts:
            parts.append(text)
    if activity and parts == [activity]:
        return f"{activity}. Check current conditions and access before you go."
    if not parts:
        activity = activity or "Trail route"
        return f"{activity}. Check current conditions and access before you go."
    return ". ".join(parts[:4]) + "."


def camp_record(row: dict[str, Any], *, source: str, app_place: bool = False) -> dict[str, Any] | None:
    lat, lng = valid_point(row.get("lat"), row.get("lng")) if app_place else point_from_geojson(row.get("geom"))
    if lat is None or lng is None:
        return None
    metadata = load_json(row.get("display_metadata"), {}) if app_place else {}
    if isinstance(metadata, dict):
        row = {**row, **metadata}
    name = clean_explore_title(
        row.get("name") or row.get("canonical_name"),
        row.get("summary"),
        row.get("description"),
        row.get("subtype"),
        row.get("land_type"),
        category=row.get("category"),
    )
    if not name:
        return None
    raw_category = compact(row.get("category")).lower()
    raw_land_type = row.get("land_type") or row.get("subtype")
    land_type = raw_land_type or row.get("category")
    if is_non_overnight_camp_label(name, land_type, row.get("subtype"), row.get("category")):
        return None
    primary_rv = is_primary_rv_label(name, raw_land_type, row.get("subtype"))
    if raw_category == "rv_park" and not primary_rv and not re.search(
        r"\b(campgrounds?|campsites?|camping|cabins?|huts?|lodges?|lodging|lookout|shelter)\b",
        " ".join(compact(value) for value in (name, land_type, row.get("subtype"), row.get("summary"), row.get("description"))),
        re.I,
    ):
        return None
    category_for_kind = row.get("category") if raw_category != "rv_park" or primary_rv else "campground"
    land_type_for_kind = land_type if raw_category != "rv_park" or primary_rv else "campground"
    kind = "rv_park" if (
        raw_category == "rv_park"
        and primary_rv
    ) else classify_camp_kind({
        "name": name,
        "land_type": land_type_for_kind,
        "subtype": row.get("subtype"),
        "type": category_for_kind,
        "description": row.get("summary") or row.get("description"),
        "tags": row.get("tags") if isinstance(row.get("tags"), list) else [],
        "site_types": row.get("site_types") if isinstance(row.get("site_types"), list) else [],
    })
    label = public_label_for_camp_kind(kind)
    official_url = compact(row.get("official_url") or row.get("website") or row.get("url"))
    reservation_url = compact(row.get("reservation_url") or row.get("booking_url"))
    source_label = compact(row.get("managing_agency") or row.get("source_label") or row.get("verified_source") or source)
    summary = clean_source_summary(row.get("summary") or row.get("description"))
    return {
        "id": compact(row.get("id") or row.get("trailhead_place_id") or row.get("source_place_id")),
        "name": name,
        "lat": round(lat, 7),
        "lng": round(lng, 7),
        "category": "camp",
        "kind": kind,
        "label": label,
        "land_type": label,
        "source": source,
        "source_label": source_label,
        "source_rank": source_rank(source_label or source),
        "summary": summary or f"{name} is a {label.lower()}.",
        "official_url": official_url,
        "reservation_url": reservation_url,
        "reservable": bool(reservation_url or row.get("reservable")),
        "verified": True,
    }


def build_camp_index(official_db: Path, app_db: Path, limit: int = 0) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    db = connect(official_db)
    if db:
        try:
            sql = """SELECT id, canonical_name, category, subcategory, managing_agency, geom,
                            reservation_url, official_url, website, summary, season_text, fee_text
                     FROM place
                     WHERE category IN ('campground', 'rv_park')"""
            if limit:
                sql += f" LIMIT {int(limit)}"
            for row in db.execute(sql):
                item = camp_record(dict(row), source=compact(row["managing_agency"]) or "official")
                if item:
                    candidates.append(item)
        finally:
            db.close()
    db = connect(app_db)
    if db:
        try:
            sql = """SELECT trailhead_place_id, source, source_label, source_place_id, name, lat, lng,
                            category, subtype, official_url, display_metadata
                     FROM places
                     WHERE category='camp'"""
            for row in db.execute(sql):
                item = camp_record(dict(row), source=compact(row["source"]) or "trailhead", app_place=True)
                if item:
                    candidates.append(item)
        finally:
            db.close()
    items = dedupe_records(candidates)
    return {
        "generated_at": int(time.time()),
        "count": len(items),
        "items": items,
    }


def dedupe_records(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for item in items:
        key = f"{item.get('category')}:{item.get('kind')}:{name_key(item.get('name'))}:{float(item['lat']):.3f}:{float(item['lng']):.3f}"
        existing = by_key.get(key)
        if not existing or sort_key(item) < sort_key(existing):
            by_key[key] = item
    out = sorted(by_key.values(), key=sort_key)
    return out


def explore_dedupe_key(item: dict[str, Any]) -> str:
    key = name_key(item.get("title"))
    if not key:
        return ""
    try:
        lat = round(float(item.get("lat")), 3)
        lng = round(float(item.get("lng")), 3)
    except Exception:
        lat = None
        lng = None
    return f"{key}:{lat}:{lng}"


def explore_sort_key(item: dict[str, Any]) -> tuple:
    title = compact(item.get("title"))
    raw_title = compact(item.get("_raw_title") or title)
    description = compact(item.get("description"))
    category = compact(item.get("category")).lower()
    stale_penalty = 1 if (item.get("_stale_title") or is_stale_explore_title(raw_title)) else 0
    generic_penalty = 1 if GENERIC_EXPLORE_DESCRIPTION_RE.search(description) else 0
    no_description_penalty = 1 if not description else 0
    parenthetical_penalty = 1 if re.search(r"\([^)]{4,}\)", title) else 0
    category_penalty = {
        "campground": 0,
        "dispersed_camp": 0,
        "lodging": 1,
        "trail": 2,
        "rv_park": 3 if not is_primary_rv_label(title) else 0,
        "overnight_parking": 3,
    }.get(category, 2)
    return (
        stale_penalty,
        generic_penalty,
        no_description_penalty,
        category_penalty,
        parenthetical_penalty,
        -min(len(description), 420),
        len(title),
        title.lower(),
        str(item.get("id") or ""),
    )


def explore_serving_sort_key(item: dict[str, Any]) -> tuple:
    grade_order = {"signature": 0, "complete": 1, "basic": 2, "candidate": 3}
    try:
        rank = int(item.get("rank"))
    except (TypeError, ValueError):
        rank = 10_000
    return (
        grade_order.get(compact(item.get("enrichment_grade")), 4),
        -int(item.get("enrichment_score") or 0),
        rank,
        compact(item.get("title")).casefold(),
        str(item.get("id") or ""),
    )


def explore_filter_coverage(items: list[dict[str, Any]]) -> tuple[dict[str, int], list[str]]:
    counts = Counter(compact(item.get("category")).lower() for item in items)
    filter_counts = {
        name: sum(counts[category] for category in categories)
        for name, categories in EXPLORER_FILTER_CATEGORIES.items()
    }
    return filter_counts, sorted(name for name, count in filter_counts.items() if count == 0)


def dedupe_explore_records(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, tuple[int, dict[str, Any]]] = {}
    passthrough: list[tuple[int, dict[str, Any]]] = []
    for index, item in enumerate(items):
        key = explore_dedupe_key(item)
        if not key:
            passthrough.append((index, item))
            continue
        existing = by_key.get(key)
        if not existing or explore_sort_key(item) < explore_sort_key(existing[1]):
            by_key[key] = (existing[0] if existing else index, item)
    return [item for _, item in sorted([*passthrough, *by_key.values()], key=lambda pair: pair[0])]


def sort_key(item: dict[str, Any]) -> tuple:
    return (
        int(item.get("source_rank") or 50),
        bool(item.get("review_only")),
        compact(item.get("name")).lower(),
        str(item.get("id") or ""),
    )


def clean_public_text(value: object, max_len: int = 360) -> str:
    text = compact(value)
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = clean_explore_title(text)
    text = re.sub(r"([a-z])is located\b", r"\1 is located", text)
    text = re.sub(r"([.!?])([A-Z][a-z])", r"\1 \2", text)
    text = re.sub(r"^\s*(?:overview|recreation|facilities|natural features|nearby attractions)\s+", "", text, flags=re.I)
    text = re.sub(r"\bdownload\b[^.!?]*(?:[.!?]|$)", "", text, flags=re.I)
    text = re.sub(r"\b(?:RIDB|API|FeatureServer|database dump|raw record|raw source|endpoint|schema)\b[^.]*\.?", "", text, flags=re.I)
    text = re.sub(r"\b(?:downloaded|imported|synced)\b[^.]*\.?", "", text, flags=re.I)
    text = re.sub(r"\b(?:rig aware|offline ready)\b", "", text, flags=re.I)
    text = re.sub(r"\bnear the area\b", "nearby", text, flags=re.I)
    text = compact(text)
    leading_ellipsis = bool(re.match(r"^(?:\.\s*){2,}", text))
    text = re.sub(r"^(?:\.\s*){2,}", "", text).lstrip(" ,;:-")
    if leading_ellipsis and text:
        text = text[0].upper() + text[1:]
    if PUBLIC_COPY_FORBIDDEN_RE.search(text) or GENERIC_EXPLORE_DESCRIPTION_RE.search(text):
        return ""
    sentences = public_sentence_parts(text)
    while len(sentences) > 1 and (
        len(sentences[0]) < 45
        or sentences[0][0].islower()
        or re.match(r"^(?:whose|which)\b", sentences[0], re.I)
        or re.match(r"^(?:overview|attention|welcome|want to|looking for|discover|reserve your spot)\b", sentences[0], re.I)
    ):
        sentences = sentences[1:]
    if sentences:
        text = " ".join(sentences[:2])
    if len(text) > max_len:
        clipped = text[:max_len].rsplit(" ", 1)[0].rstrip(" ,;:")
        sentence_end = max(clipped.rfind("."), clipped.rfind("!"), clipped.rfind("?"))
        if sentence_end >= 80:
            clipped = clipped[:sentence_end + 1]
        text = clipped if clipped.endswith((".", "!", "?")) else f"{clipped}."
    if text and not text.endswith((".", "!", "?")):
        sentence_end = max(text.rfind("."), text.rfind("!"), text.rfind("?"))
        if sentence_end >= 80:
            text = text[:sentence_end + 1]
        else:
            text = text.rstrip(" ,;:") + "."
    return text.strip()


def generic_explore_title(value: object) -> bool:
    text = re.sub(r"[^a-z0-9]+", " ", compact(value).lower()).strip()
    return text in GENERIC_EXPLORE_TITLES


def explore_description_fallback(title: str, category: str, group: str) -> str:
    hay = f"{title} {category} {group}".lower()
    if re.search(r"\b(cabins?|huts?|lodges?|lodging|lookout|shelter)\b", hay):
        return f"{title}. Check booking, access, rules, and operating dates."
    if re.search(r"\b(trails?|trailheads?|hikes?|treks?)\b", hay):
        return f"{title}. Check route conditions, daylight, and local rules before starting."
    if re.search(r"\b(campgrounds?|campsites?|camping|rv park|rv resort|primitive|dispersed|boondock|wild camp)\b", hay) or group == "camping":
        return f"{title}. Check fees, stay limits, fire rules, and seasonal access."
    if group == "things" or category in {"permit_required", "activity"}:
        return f"{title}. Check timing, access, reservations, and local rules."
    if group == "parks" or category in {"park", "public_land"}:
        return f"{title}. Check access, fees, closures, and local rules before you go."
    return f"{title}. Check access, hours, and local rules before you go."


def polish_explore_description(title: str, description: str, category: str, group: str) -> str:
    text = compact(description)
    if not text:
        return ""
    title_text = compact(title)
    if len(text) < 42 and title_text and not re.search(rf"\b{re.escape(title_text)}\b", text, re.I):
        if re.search(r"^\$?\d+(?:\.\d{2})?\b.*\b(?:per\s+(?:site|night)|nightly|fee|fees?)\b", text, re.I):
            return f"{title_text}. {text}"
        if text.lower() in {"no reservations.", "reservations required."}:
            return f"{title_text}. {text}"
    return text


def looks_like_camp_title(value: object) -> bool:
    return bool(re.search(r"\b(campgrounds?|campsites?|camp\s*sites?|camping|rv park|rv resort|primitive camp|group camp)\b", compact(value), re.I))


def looks_like_lodging_title(value: object) -> bool:
    return bool(re.search(r"\b(cabins?|huts?|lodges?|lodging|lookout|shelter)\b", compact(value), re.I))


def non_camp_explore_category(title: str, description: str) -> tuple[str, str] | None:
    title_text = compact(title).lower()
    desc_text = compact(description).lower()
    hay = f"{title_text} {desc_text}"
    title_has_stay = looks_like_camp_title(title_text) or looks_like_lodging_title(title_text)
    if re.search(r"\bnot a public campground\b", hay):
        return DROP_EXPLORE_CATEGORY
    if re.search(r"\bdoes not have camping\b", hay):
        return DROP_EXPLORE_CATEGORY
    if re.search(r"\b(?:non[-\s]?camper\s+)?dump station\b", title_text):
        return DROP_EXPLORE_CATEGORY
    if re.search(r"\b(parking tag|entrance pass|vehicle access reservation|timed entry)\b", title_text):
        return "permit_required", "things"
    if re.search(r"\b(shooting range|rifle range|hunt(?:ing)? permit|hunt blind)\b", title_text):
        return "activity", "things"
    if re.search(r"\b(boat ramp|boat launch|boat access|boat landing|boat area|boat site|raft launch|river access|water access|marina)\b", title_text):
        return "water", "water"
    if re.search(r"\b(overlook|viewpoint|vista)\b", title_text) and not title_has_stay:
        return "viewpoint", "viewpoint"
    if re.search(r"\b(day[-\s]?use|picnic shelter|picnic area|pavilion|parking area)\b", title_text) and not title_has_stay:
        return DROP_EXPLORE_CATEGORY
    if re.search(r"\b(museum|historic site|historical site|battlefield|cemetery|memorial|lighthouse|plantation|fort|ruins|heritage|cultural center|bookstore)\b", hay) and not title_has_stay:
        return "historic", "historic"
    if re.search(r"\b(visitor contact station|contact station|visitor center|welcome center|information station|information desk|nature center|environmental education|interpretive center|ranger contact station)\b", hay) and not title_has_stay:
        return "activity", "things"
    if re.search(r"\b(trails?|trailheads?|hikes?|treks?)\b", title_text) and not title_has_stay:
        return "trail", "trails"
    if (
        not title_has_stay
        and re.search(r"\b(the|this)\s+[a-z0-9 '&/#.-]{2,80}\s+trail\s+(?:is|begins|starts|ends|climbs|connects|parallels|passes|offers|leads|runs)\b", desc_text)
    ):
        return "trail", "trails"
    if (
        not title_has_stay
        and re.search(r"\brecommended users:\s*(?:mountain bikers|hikers|equestrians|horseback|ohv|atv)", desc_text)
    ):
        return "trail", "trails"
    return None


def title_identity_category(title: str, explicit_category: str) -> tuple[str, str] | None:
    text = compact(title)
    lower = text.lower()
    if re.search(r"\b(?:glamping|yurts?)\b", lower):
        return "glamping", "lodging"
    if re.search(r"\b(?:campgrounds?|campsites?)\b", lower):
        if re.search(r"\brv\s+(?:park|resort|campground)\b", lower):
            return "rv_park", "camping"
        if re.search(r"\b(?:dispersed|primitive)\b", lower):
            return "dispersed_camp", "camping"
        return "campground", "camping"
    if re.search(r"\b(?:group|grp)\s+site\b", lower) and not re.search(r"\b(?:day[-\s]?use|picnic)\b", lower):
        return "campground", "camping"
    if re.search(r"\b(?:picnic|exhibits?|ski area|ranger talk|geology talk|wayside)\b", lower):
        return "activity", "things"
    if re.search(r"(?<!self-)(?<!self )\bguided\b.*\b(?:programs?|tours?)\b|\b(?:programs?|tours?)\b$", lower):
        return "activity", "things"
    if re.search(r"\b(?:visitor|information) cent(?:er|re)\b", lower):
        return "visitor_center", "things"
    if re.search(r"\b(?:cabins?|huts?|lodges?|bunkhouses?|shelters?)\b", lower):
        return "lodging", "lodging"
    if re.search(r"\b(?:group camp|overnight camp)\b", lower) or re.search(r"\bcamp\s*$", lower):
        return "campground", "camping"
    if re.search(r"\btrailheads?\b", lower):
        return "trailhead", "trails"
    if re.search(r"\btrails?\b", lower) or re.search(r"\bwalk\s*$", lower):
        return "trail", "trails"
    if re.search(r"\b(?:climbing|bouldering|crags?)\b", lower):
        return "climbing_area", "climbing"
    if re.search(r"\b(?:national park|state park|national monument|national forest|wilderness|preserve|wildlife refuge|marine conservation area)\b", lower):
        return "park", "parks"
    if re.search(r"\b(?:museum|historic site|battlefield|memorial|fort|blacksmith shop)\b", lower):
        return "historic", "historic"
    water_precedence_categories = {
        "activity", "glacier", "hot_spring", "lake", "peak", "place", "trail", "trailhead", "viewpoint", "water", "waterfall",
    }
    if explicit_category in water_precedence_categories:
        if re.search(r"\b(?:waterfalls?|falls?)\b", lower):
            return "waterfall", "water"
        if re.search(r"\bhot springs?\b", lower):
            return "hot_spring", "water"
        if re.search(r"\b(?:lakes?|ponds?|reservoirs?)\b", lower):
            return "lake", "water"
        if re.search(r"\b(?:rivers?|creeks?|beaches?|geysers?|dams?|bays?|sounds?|coves?)\b", lower):
            return "water", "water"
    if explicit_category in {"glacier", "lake", "peak", "trail", "viewpoint", "waterfall"} and re.search(
        r"\b(?:overlook|vista|viewpoint|lookout|pass|rim|summit|peak|butte|fault|fossil beds?|scenic point)\b",
        lower,
    ):
        return "viewpoint", "viewpoint"
    return None


def normalize_explore_category(title: str, category: str, group: str, description: str = "") -> tuple[str, str] | None:
    hay = f"{title} {category} {group} {description}".lower()
    explicit_category = compact(category).lower().replace(" ", "_")
    title_category = title_identity_category(title, explicit_category)
    if title_category:
        return title_category
    explicit_categories = {
        "activity": ("activity", "things"),
        "bouldering_area": ("bouldering_area", "climbing"),
        "climbing_area": ("climbing_area", "climbing"),
        "forest": ("forest", "parks"),
        "forest_road": ("forest_road", "drives"),
        "fuel": ("fuel", "services"),
        "glacier": ("glacier", "viewpoint"),
        "historic_site": ("historic", "historic"),
        "hot_spring": ("hot_spring", "water"),
        "lake": ("lake", "water"),
        "monument": ("historic", "historic"),
        "offroad_route": ("offroad_route", "drives"),
        "park": ("park", "parks"),
        "peak": ("peak", "viewpoint"),
        "public_land": ("public_land", "parks"),
        "resupply": ("resupply", "services"),
        "scenic_drive": ("scenic_drive", "drives"),
        "trail": ("trail", "trails"),
        "trailhead": ("trailhead", "trails"),
        "viewpoint": ("viewpoint", "viewpoint"),
        "visitor_center": ("visitor_center", "things"),
        "waterfall": ("waterfall", "water"),
    }
    if explicit_category in explicit_categories:
        return explicit_categories[explicit_category]
    if re.search(r"\b(?:scenic drive|scenic byway)\b", title, re.I):
        return "scenic_drive", "drives"
    if re.search(r"\b(?:ohv|off[- ]road|4x4)\b.*\b(?:road|route|trail)\b", title, re.I):
        return "offroad_route", "drives"
    if re.search(r"\bforest road\b", title, re.I):
        return "forest_road", "drives"
    if re.search(r"\btrailhead\b", title, re.I):
        return "trailhead", "trails"
    non_camp_category = non_camp_explore_category(title, description)
    if non_camp_category == DROP_EXPLORE_CATEGORY:
        return None
    if non_camp_category:
        return non_camp_category
    if re.search(r"\b(day\s*use|dump station|boat launch|ranger district|field office|headquarters|visitor center|trailhead|parking area|test facility|venue test)\b", hay):
        if re.search(r"\b(campgrounds?|campsites?|camping|rv park|rv resort|cabin|hut|lodg(?:e|ing))\b", hay):
            if is_non_overnight_camp_label(title, category, group, description):
                return None
    if re.search(r"\b(cabins?|huts?|lodges?|lodging|lookout|shelter)\b", title.lower()):
        return "lodging", "lodging"
    if re.search(r"\b(cabins?|huts?|lodges?|lodging|lookout|shelter)\b", hay) and not re.search(r"\b(rv park|rv resort)\b", hay):
        return "lodging", "lodging"
    if re.search(r"\b(timed\s+entry|permit\s+reservations?|backcountry\s+permits?|wilderness\s+permits?|permits?)\b", hay) and not re.search(
        r"\b(campgrounds?|campsites?|camp\s*sites?|rv park|rv resort|cabin|hut|lodg(?:e|ing))\b",
        title.lower(),
    ):
        return "permit_required", "things"
    if re.search(r"\b(trails?|trailheads?|hikes?|treks?)\b", title.lower()) and not re.search(r"\b(campgrounds?|campsites?|camping|rv park|rv resort|cabin|hut|lodg(?:e|ing))\b", title.lower()):
        return "trail", "trails"
    if re.search(r"\b(campgrounds?|campsites?|camping|rv park|rv resort|primitive|dispersed|boondock|wild camp)\b", hay) or category in {"campground", "rv_park"}:
        if is_non_overnight_camp_label(title, category, group, description):
            return None
        kind = classify_camp_kind({
            "name": title,
            "land_type": "" if category == "rv_park" and not is_primary_rv_label(title) else category,
            "subtype": group,
            "type": "" if category == "rv_park" and not is_primary_rv_label(title) else category,
            "description": description,
        })
        if kind == "rv_park" and not is_primary_rv_label(title):
            kind = "campground"
        if kind == "rv_park":
            return "rv_park", "camping"
        if kind == "overnight_parking":
            return "overnight_parking", "camping"
        if kind == "dispersed_camp":
            return "dispersed_camp", "camping"
        return "campground", "camping"
    if re.search(r"\b(trails?|trailheads?|hikes?|treks?)\b", hay):
        return "trail", "trails"
    if re.search(r"\b(waterfalls?|falls|lake|river|overlook|viewpoint|vista|scenic|rim|summit|peak|mountain|arch|bridge)\b", hay):
        return "viewpoint", "viewpoint"
    if re.search(r"\b(national park|national forest|wilderness|refuge|monument|preserve|recreation area|state park)\b", hay):
        return "park", "parks"
    if re.search(r"\b(historic|heritage|battlefield|ruins|museum)\b", hay):
        return "historic", "historic"
    if re.search(r"\b(activity|activities|things to do|tour|guided)\b", hay):
        return "activity", "things"
    return (category or "place").lower(), group or "places"


def guard_explore_category_relevance(
    title: str,
    description: str,
    category: str,
    group: str,
) -> tuple[tuple[str, str] | None, str]:
    scenic_categories = {"glacier", "lake", "peak", "trail", "trailhead", "viewpoint", "waterfall"}
    title_text = compact(title)
    if re.search(
        r"\bovernight group camping\b|\b(?:available for|offers?|provides?|designated for)\s+(?:overnight\s+)?group camping\b",
        description,
        re.I,
    ):
        return ("campground", "camping"), ""
    if re.search(
        r"\b(?:restaurant|steakhouse|cafe|cafeteria|grill|dining room|food court)\b",
        title_text,
        re.I,
    ):
        return None, "category_mismatch_food_service"
    if re.search(r"\b(?:bus|shuttle|transit) stop\b", title_text, re.I):
        return None, "category_mismatch_transit_stop"
    if category in scenic_categories and re.search(r"\b(?:office|headquarters|administration building)\b", title_text, re.I):
        return None, "category_mismatch_office"
    if category in scenic_categories and re.search(r"\b(?:visitor|information) cent(?:er|re)\b", title_text, re.I):
        return ("visitor_center", "things"), ""
    if re.search(
        r"\b(?:ranger[- ]led|ranger\s*[-:]?\s*guided|guided (?:canoe|kayak|paddle|snowmobile)?\s*(?:programs?|tours?)|"
        r"geology talk|ranger talk)\b",
        title_text,
        re.I,
    ) or re.search(r"(?<!self-)(?<!self )\bguided\b.*\b(?:programs?|tours?)\b", title_text, re.I):
        return ("activity", "things"), ""
    wildlife_title = re.fullmatch(
        r"(?:american )?(?:bighorn sheep|black bears?|brown bears?|grizzly bears?|bison|deer|elk|moose|"
        r"mountain lions?|pikas?|pronghorn|wolves|wolf|coyotes?|bobcats?|beavers?|otters?)",
        title_text,
        re.I,
    )
    wildlife_copy = re.search(r"\b(?:species|habitat|population|commonly seen|live in|summer range)\b", description, re.I)
    if category in scenic_categories and wildlife_title and wildlife_copy:
        return ("activity", "things"), ""
    if category == "lake" and not re.search(
        r"\b(?:lakes?|ponds?|reservoirs?|rivers?|creeks?|beaches?|geysers?|dams?|bays?|sounds?|coves?)\b",
        title_text,
        re.I,
    ):
        return ("activity", "things"), ""
    if category == "viewpoint" and not re.search(
        r"\b(?:overlook|vista|viewpoint|lookout|pass|rim|summit|peak|butte|fault|fossil beds?|scenic point|recreation site)\b",
        title_text,
        re.I,
    ):
        return ("activity", "things"), ""
    if category == "waterfall" and not re.search(r"\b(?:waterfalls?|falls?|cascade)\b", title_text, re.I):
        return ("activity", "things"), ""
    if (
        category == "peak"
        and re.search(r"\b(?:peninsula|island|lake|river|bay|beach|lagoon|valley|forest)\b", title_text, re.I)
        and not re.search(r"\b(?:mount|mountain|peak|summit|hill|butte|dome)\b|\bk\d+\b", title_text, re.I)
    ):
        return ("viewpoint", "viewpoint"), ""
    return (category, group), ""


def trail_review_only(name: object) -> bool:
    text = compact(name).strip("\"'“”‘’")
    normalized = re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
    acronym = re.sub(r"[^A-Z0-9]+", "", text.upper())
    if acronym in KNOWN_PUBLIC_TRAIL_ACRONYMS:
        return False
    if re.search(r"\bAI\b", text, re.I):
        return True
    if len(text) < 3:
        return True
    if not re.search(r"[a-zA-Z]", text):
        return True
    if normalized in GENERIC_TRAIL_NAMES:
        return True
    if normalized.startswith("mgra "):
        return True
    if re.search(r"\bmountain bike [a-z]\b$", normalized):
        return True
    if re.search(r"\b[a-z]\b$", normalized) and not re.search(r"\b(?:loop|trail|route|road|fork|creek)\s+[a-z]\b$", normalized):
        return True
    if re.search(r"\s-\s(?:pine|oak|cedar|fir|spruce|willow|cottonwood|aspen|maple|juniper)\b$", text, re.I):
        return True
    if re.match(r"^\d", text):
        return True
    if re.fullmatch(r"[A-Z]{1,3}\d{0,4}[A-Z]?", text):
        return True
    if re.fullmatch(r"[0-9A-Z._-]+", text) and (any(char.isdigit() for char in text) or "." in text or "_" in text):
        return True
    if re.fullmatch(r"\d+[A-Z]{0,4}\d*", text):
        return True
    if re.fullmatch(r"\d{1,3}[A-Z]{1,3}\d{1,4}", text):
        return True
    return False


def trail_dedupe_key(item: dict[str, Any]) -> str:
    try:
        lat = round(float(item.get("lat")), 3)
        lng = round(float(item.get("lng")), 3)
    except Exception:
        lat = None
        lng = None
    return f"trail:{trail_name_key(item.get('name'))}:{lat}:{lng}"


def trail_distance_sort_bucket(item: dict[str, Any]) -> int:
    try:
        distance = float(item.get("distance_mi") or 0)
    except Exception:
        distance = 0.0
    if distance <= 0:
        return 4
    if distance < 0.25:
        return 3
    if distance <= 25:
        return 0
    if distance <= 60:
        return 1
    return 2


def trail_activity_sort_bucket(item: dict[str, Any]) -> int:
    text = compact(item.get("activity") or item.get("allowed_uses") or item.get("name")).lower()
    if "hiking" in text:
        return 0
    if re.search(r"\b(ohv|4x4|atv|orv|motorcycl|motorized)\b", text):
        return 1
    if "bike" in text or "horse" in text:
        return 2
    if "water route" in text:
        return 3
    if "snowmobile" in text:
        return 4
    return 2


def meaningful_short_trail_title(value: object) -> bool:
    text = compact(value)
    return bool(re.search(
        r"\b(overlook|view|vista|interpretive|nature|falls?|waterfall|petroglyph|cedar|redwood|"
        r"boardwalk|accessible|beach|lake|spring|cave|arch|bridge|trail)\b",
        text,
        re.I,
    ))


def public_trail_should_publish(item: dict[str, Any], *, raw_distance_m: object = None) -> bool:
    if not item.get("short_access"):
        return True
    detail_fields = (
        item.get("distance_mi"),
        item.get("elevation_gain_ft"),
        item.get("difficulty"),
        item.get("allowed_uses"),
        item.get("surface"),
        item.get("season_text"),
    )
    has_detail = any(value not in (None, "", 0) for value in detail_fields)
    if has_detail:
        return True
    if meaningful_short_trail_title(item.get("name")):
        return True
    try:
        distance_m = float(raw_distance_m or 0)
    except Exception:
        distance_m = 0.0
    return not (0 < distance_m < 80)


def trail_sort_key(item: dict[str, Any]) -> tuple:
    name = compact(item.get("name"))
    starts_with_letter = bool(re.match(r"^[A-Za-z]", name))
    try:
        quality = int(item.get("quality_score") or public_trail_quality_score(item))
    except Exception:
        quality = 0
    try:
        distance = float(item.get("distance_mi") or 0)
    except Exception:
        distance = 0.0
    return (
        int(item.get("source_rank") or 50),
        bool(item.get("review_only")),
        0 if starts_with_letter else 1,
        trail_distance_sort_bucket(item),
        trail_activity_sort_bucket(item),
        -quality,
        -min(max(distance, 0.0), 25.0),
        name.lower(),
        str(item.get("id") or ""),
    )


def dedupe_trail_records(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for item in items:
        key = trail_dedupe_key(item)
        existing = by_key.get(key)
        if not existing or trail_sort_key(item) < trail_sort_key(existing):
            by_key[key] = item
    return sorted(by_key.values(), key=trail_sort_key)


def build_trail_index(official_db: Path, limit: int = 0) -> dict[str, Any]:
    db = connect(official_db)
    items: list[dict[str, Any]] = []
    if db:
        try:
            sql = """SELECT id, name, route_geom, start_geom, distance_m, elevation_gain_m,
                            difficulty, allowed_uses, surface, managing_agency, season_text
                     FROM trail"""
            if limit:
                sql += f" LIMIT {int(limit)}"
            for row in db.execute(sql):
                lat, lng = point_from_geojson(row["start_geom"]) if row["start_geom"] else point_from_geojson(row["route_geom"])
                if lat is None or lng is None:
                    continue
                name = public_trail_title(row["name"])
                if not name:
                    continue
                review_only = trail_review_only(name)
                if review_only:
                    continue
                route_shape = public_trail_route_shape(row["route_geom"], row["distance_m"])
                item = {
                    "id": row["id"],
                    "name": name,
                    "lat": round(lat, 7),
                    "lng": round(lng, 7),
                    "category": "trail",
                    "source_label": compact(row["managing_agency"]),
                    "source_rank": source_rank(row["managing_agency"]),
                    "distance_mi": public_trail_distance_mi(row["distance_m"]),
                    "elevation_gain_ft": public_trail_elevation_gain_ft(row["elevation_gain_m"]),
                    "difficulty": public_trail_difficulty(row["difficulty"]),
                    "allowed_uses": public_trail_uses(row["allowed_uses"]),
                    "surface": public_trail_surface(row["surface"]),
                    "season_text": clean_optional_label(row["season_text"]),
                    "route_shape": route_shape,
                    "short_access": public_trail_is_short_access(row["distance_m"]),
                    "geometry_ref": row["id"],
                    "verified": True,
                    "display_quality": "needs_review" if review_only else "named",
                    "review_only": review_only,
                }
                if not public_trail_should_publish(item, raw_distance_m=row["distance_m"]):
                    continue
                item["activity"] = public_trail_activity(item)
                item["fact_labels"] = public_trail_fact_labels(item)
                item["quality_score"] = public_trail_quality_score(item)
                item["summary"] = public_trail_summary(item)
                items.append(item)
        finally:
            db.close()
    items = dedupe_trail_records(items)
    return {"generated_at": int(time.time()), "count": len(items), "items": items}


def build_explore_index(
    path: Path,
    limit: int = 0,
    *,
    minimum_reviewable: int = 4000,
    enforce_enrichment_gate: bool | None = None,
) -> dict[str, Any]:
    if not path.exists():
        return {
            "schema_version": 2,
            "generated_at": int(time.time()),
            "source_count": 0,
            "count": 0,
            "grade_counts": {},
            "rejection_reason_counts": {"missing_catalog": 1},
            "rejections": [],
            "gate": {"minimum_reviewable": minimum_reviewable, "reviewable_count": 0, "passed": False},
            "items": [],
        }
    catalog = json.loads(path.read_text())
    places = catalog.get("places") if isinstance(catalog, dict) else []
    source_count = len(places) if isinstance(places, list) else 0
    if enforce_enrichment_gate is None:
        enforce_enrichment_gate = bool(isinstance(catalog, dict) and int(catalog.get("schema_version") or 0) >= 3)
    items: list[dict[str, Any]] = []
    rejections: list[dict[str, Any]] = []
    rejection_counts: Counter[str] = Counter()

    def reject(place: dict[str, Any], title: str, score: int, reasons: list[str]) -> None:
        clean_reasons = sorted({compact(reason) for reason in reasons if compact(reason)})
        rejection_counts.update(clean_reasons)
        rejections.append({
            "id": place.get("id"),
            "title": title or compact(place.get("name")),
            "enrichment_score": int(score or 0),
            "rejection_reasons": clean_reasons,
        })

    for place in places if isinstance(places, list) else []:
        if not isinstance(place, dict):
            rejection_counts["invalid_record"] += 1
            continue
        enriched = enrich_place_dict(place)
        summary = place.get("summary") if isinstance(place.get("summary"), dict) else {}
        card = place.get("card") if isinstance(place.get("card"), dict) else {}
        raw_title = summary.get("title") or card.get("headline") or place.get("name")
        raw_description = place.get("description") or summary.get("short_description") or card.get("summary")
        title = clean_explore_title(raw_title, raw_description, category=summary.get("category") or place.get("category"))
        if not title:
            reject(enriched, "", enriched["enrichment_score"], [*enriched["rejection_reasons"], "invalid_name"])
            continue
        lat = summary.get("lat", place.get("lat"))
        lng = summary.get("lng", place.get("lng"))
        description = clean_public_text(raw_description, 420)
        category = compact(summary.get("category") or place.get("category")).lower()
        group = compact(summary.get("explore_group") or place.get("category")).lower()
        if generic_explore_title(title) and not description:
            reject(enriched, title, enriched["enrichment_score"], [*enriched["rejection_reasons"], "generic_name"])
            continue
        normalized = normalize_explore_category(title, category, group, description)
        if not normalized:
            reject(enriched, title, enriched["enrichment_score"], [*enriched["rejection_reasons"], "unsupported_or_misrouted_category"])
            continue
        category, group = normalized
        guarded_category, guard_reason = guard_explore_category_relevance(title, description, category, group)
        if not guarded_category:
            reject(enriched, title, enriched["enrichment_score"], [*enriched["rejection_reasons"], guard_reason])
            continue
        category, group = guarded_category
        enrichment_place = dict(place)
        enrichment_place["category"] = category
        enriched = enrich_place_dict(enrichment_place)
        lat_value, lng_value = valid_point(lat, lng)
        item = {
            "id": place.get("id"),
            "title": title,
            "category": category,
            "group": group,
            "lat": round(lat_value, 7) if lat_value is not None else None,
            "lng": round(lng_value, 7) if lng_value is not None else None,
            "rank": summary.get("rank"),
            "description": description,
            "image_url": primary_media_url(enriched),
            "media_kind": enriched["media_kind"],
            "source_url": compact(
                summary.get("source_url")
                or (place.get("facts") or {}).get("source_url")
                or (enriched.get("provenance") or {}).get("primary", {}).get("url")
            ),
            "verified": bool(place.get("verified")),
            "planning_facts": enriched["planning_facts"],
            "provenance": enriched["provenance"],
            "checked_at": enriched["checked_at"],
            "enrichment_score": enriched["enrichment_score"],
            "enrichment_grade": enriched["enrichment_grade"],
            "rejection_reasons": list(enriched["rejection_reasons"]),
            "reviewable": bool(enriched["reviewable"]),
            "_raw_title": compact(raw_title),
            "_stale_title": is_stale_explore_title(raw_title),
        }
        if not item["description"]:
            item["description"] = clean_public_text(card.get("highlight") or card.get("summary") or "", 220)
        if item["description"] and (PUBLIC_COPY_FORBIDDEN_RE.search(item["description"]) or GENERIC_EXPLORE_DESCRIPTION_RE.search(item["description"])):
            item["description"] = ""
        if not item["description"]:
            if enforce_enrichment_gate:
                reject(enriched, title, enriched["enrichment_score"], [*enriched["rejection_reasons"], "public_copy_rejected"])
                continue
            item["description"] = explore_description_fallback(title, category, group)
        item["description"] = polish_explore_description(title, item["description"], category, group)
        if enforce_enrichment_gate and len(item["description"]) < 45:
            reject(enriched, title, enriched["enrichment_score"], [*enriched["rejection_reasons"], "public_copy_rejected"])
            continue
        if enforce_enrichment_gate and enriched["enrichment_grade"] not in REVIEWABLE_GRADES:
            reject(enriched, title, enriched["enrichment_score"], enriched["rejection_reasons"] or ["below_enrichment_threshold"])
            continue
        items.append(item)
    items = dedupe_explore_records(items)
    for item in items:
        item.pop("_raw_title", None)
        item.pop("_stale_title", None)
    items.sort(key=explore_serving_sort_key)
    reviewable_count = len(items)
    grade_counts = Counter(compact(item.get("enrichment_grade")) or "candidate" for item in items)
    filter_counts, missing_filters = explore_filter_coverage(items)
    gate_passed = reviewable_count >= minimum_reviewable
    if limit:
        items = items[:limit]
    rejections.sort(key=lambda item: (item["rejection_reasons"], compact(item.get("title")).casefold(), str(item.get("id") or "")))
    return {
        "schema_version": 2,
        "generated_at": int(catalog.get("generated_at") or time.time()) if isinstance(catalog, dict) else int(time.time()),
        "source_count": source_count,
        "count": len(items),
        "reviewable_count": reviewable_count,
        "grade_counts": dict(sorted(grade_counts.items())),
        "rejection_reason_counts": dict(sorted(rejection_counts.items())),
        "filter_counts": filter_counts,
        "missing_filters": missing_filters,
        "rejections": rejections,
        "gate": {
            "minimum_reviewable": minimum_reviewable,
            "reviewable_count": reviewable_count,
            "passed": gate_passed,
        },
        "items": items,
    }


def merge_explore_indexes(indexes: list[dict[str, Any]], *, minimum_reviewable: int = 4000) -> dict[str, Any]:
    items = dedupe_explore_records([
        dict(item)
        for index in indexes
        for item in index.get("items") or []
        if isinstance(item, dict)
    ])
    items.sort(key=explore_serving_sort_key)
    accepted_ids = {str(item.get("id") or "") for item in items}
    rejection_by_key: dict[tuple[str, tuple[str, ...]], dict[str, Any]] = {}
    for index in indexes:
        for rejection in index.get("rejections") or []:
            if not isinstance(rejection, dict):
                continue
            item_id = str(rejection.get("id") or "")
            if item_id and item_id in accepted_ids:
                continue
            reasons = tuple(sorted({compact(reason) for reason in rejection.get("rejection_reasons") or [] if compact(reason)}))
            rejection_by_key[(item_id, reasons)] = dict(rejection)
    rejections = sorted(
        rejection_by_key.values(),
        key=lambda item: (item.get("rejection_reasons") or [], compact(item.get("title")).casefold(), str(item.get("id") or "")),
    )
    rejection_counts: Counter[str] = Counter(
        reason
        for rejection in rejections
        for reason in rejection.get("rejection_reasons") or []
    )
    grade_counts = Counter(compact(item.get("enrichment_grade")) or "candidate" for item in items)
    reviewable_count = len(items)
    filter_counts, missing_filters = explore_filter_coverage(items)
    catalogs = []
    for index in indexes:
        for catalog in index.get("catalogs") or []:
            if isinstance(catalog, dict) and catalog not in catalogs:
                catalogs.append(catalog)
    return {
        "schema_version": 2,
        "generated_at": max((int(index.get("generated_at") or 0) for index in indexes), default=int(time.time())),
        "catalogs": catalogs,
        "source_count": sum(int(index.get("source_count") or 0) for index in indexes),
        "count": reviewable_count,
        "reviewable_count": reviewable_count,
        "grade_counts": dict(sorted(grade_counts.items())),
        "rejection_reason_counts": dict(sorted(rejection_counts.items())),
        "filter_counts": filter_counts,
        "missing_filters": missing_filters,
        "rejections": rejections,
        "gate": {
            "minimum_reviewable": minimum_reviewable,
            "reviewable_count": reviewable_count,
            "passed": reviewable_count >= minimum_reviewable,
        },
        "items": items,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(payload)
    if isinstance(payload.get("items"), list):
        payload["count"] = len(payload["items"])
    tmp = path.with_suffix(path.suffix + f".tmp-{time.time_ns()}")
    tmp.write_text(json.dumps(payload, indent=2) + "\n")
    tmp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build compact canonical serving indexes for app reads.")
    parser.add_argument("--official-db", default=str(OFFICIAL_DB))
    parser.add_argument("--app-db", default=str(APP_DB))
    parser.add_argument("--explore-catalog", default=str(EXPLORE_CANDIDATE))
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    camp_index = build_camp_index(Path(args.official_db), Path(args.app_db), args.limit)
    trail_index = build_trail_index(Path(args.official_db), args.limit)
    explore_index = build_explore_index(Path(args.explore_catalog), args.limit)
    write_json(out_dir / "camps.candidate.json", camp_index)
    write_json(out_dir / "trails.candidate.json", trail_index)
    write_json(out_dir / "explore.candidate.json", explore_index)
    print(json.dumps({
        "out_dir": str(out_dir),
        "camps": camp_index["count"],
        "trails": trail_index["count"],
        "explore": explore_index["count"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
