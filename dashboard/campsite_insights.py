"""Evidence and cache policy for campsite planning notes.

The text generator is intentionally treated as an untrusted formatter.  This
module owns the public response: it binds cached notes to their exact evidence,
keeps provenance explicit, and drops fields that cannot be traced back to the
supplied campsite listing or nearby reference records.
"""
from __future__ import annotations

import hashlib
import html
import json
import math
import re
import time
from datetime import datetime, timezone
from typing import Any, Iterable


CAMP_INSIGHT_SCHEMA_VERSION = "campsite-insight-v2"
CAMP_INSIGHT_CACHE_TTL_SECONDS = 48 * 60 * 60

_SPACE_RE = re.compile(r"\s+")
_TAG_RE = re.compile(r"<[^>]+>")
_WORD_RE = re.compile(r"[a-z0-9]+")
_URL_RE = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
_UNSUPPORTED_ASSURANCE_RE = re.compile(
    r"(?:"
    r"\bguaranteed\b|\balways\s+(?:open|available|safe|quiet)\b|"
    r"\b(?:safe|clear|open|passable)\s+(?:road|route|access)\b|"
    r"\bno\s+(?:hazards?|closures?|restrictions?|crowds?)\b|"
    r"\b(?:no|without)\s+(?:avalanche|bears?|closures?|danger|fires?|floods?|flooding|hazards?|heat|ice|mud|smoke|snow|storms?|washouts?|wildlife)\b|"
    r"\breliable\s+(?:cell|signal|service|coverage|water)\b|"
    r"\bwater\s+is\s+(?:safe|available|reliable)\b"
    r")",
    re.IGNORECASE,
)
_HAZARD_TERMS = {
    "avalanche", "bear", "bears", "closure", "closures", "closed", "danger",
    "fire", "flood", "flooding", "hazard", "hazards", "heat", "ice", "mud",
    "rough", "smoke", "snow", "storm", "steep", "washout", "wildfire", "wildlife",
}
_SEASON_TERMS = {
    "spring", "summer", "fall", "autumn", "winter",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
}
_STOPWORDS = {
    "a", "about", "an", "and", "are", "as", "at", "be", "before", "best", "by",
    "can", "check", "for", "from", "has", "have", "in", "is", "it", "its", "near",
    "of", "on", "or", "site", "sites", "that", "the", "their", "this", "to", "with",
    "your",
}
_TOKEN_EQUIVALENTS = {
    "campers": "camp",
    "camper": "camp",
    "camping": "camp",
    "campsite": "camp",
    "campsites": "camp",
    "campground": "camp",
    "campgrounds": "camp",
    "trailers": "trailer",
    "tents": "tent",
    "restrooms": "restroom",
    "toilets": "toilet",
}


def _clean_text(value: object, max_chars: int) -> str:
    text = html.unescape(str(value or ""))
    text = _TAG_RE.sub(" ", text)
    text = text.replace("`", " ").replace("**", " ")
    text = _SPACE_RE.sub(" ", text).strip(" \t\r\n-*\u2022")
    if len(text) > max_chars:
        text = text[:max_chars].rsplit(" ", 1)[0].rstrip(" ,;:")
    return text


def _clean_url(value: object) -> str:
    url = _clean_text(value, 500)
    return url if _URL_RE.match(url) and "@" not in url.split("//", 1)[-1].split("/", 1)[0] else ""


def _safe_timestamp(value: object) -> int | None:
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        if isinstance(value, (int, float)):
            parsed = int(value)
        else:
            raw = str(value).strip()
            if re.fullmatch(r"\d+(?:\.\d+)?", raw):
                parsed = int(float(raw))
            else:
                parsed_dt = datetime.fromisoformat(raw[:-1] + "+00:00" if raw.endswith("Z") else raw)
                if parsed_dt.tzinfo is None:
                    parsed_dt = parsed_dt.replace(tzinfo=timezone.utc)
                parsed = int(parsed_dt.timestamp())
    except (OverflowError, TypeError, ValueError):
        return None
    now = int(time.time())
    return parsed if 946684800 <= parsed <= now + 300 else None


def _source_label(value: object) -> str:
    raw = _clean_text(value, 80)
    lowered = raw.casefold()
    if "recreation" in lowered or "ridb" in lowered:
        return "Recreation.gov"
    if "national park" in lowered or lowered == "nps":
        return "National Park Service"
    if "bureau of land" in lowered or lowered.startswith("blm"):
        return "Bureau of Land Management"
    if "forest service" in lowered or "usfs" in lowered:
        return "U.S. Forest Service"
    if "openstreetmap" in lowered or lowered == "osm":
        return "OpenStreetMap"
    return "Campsite listing"


def _normalized_amenities(values: object) -> list[str]:
    if not isinstance(values, list):
        return []
    cleaned = {_clean_text(value, 80) for value in values}
    return sorted((value for value in cleaned if value), key=str.casefold)[:40]


def normalize_campsite_evidence(
    *,
    name: object,
    lat: object,
    lng: object,
    description: object = "",
    land_type: object = "",
    amenities: object = None,
    facility_id: object = "",
    source_label: object = "",
    source_url: object = "",
    source_updated_at: object = None,
    wiki_hits: object = None,
) -> dict[str, Any]:
    """Return the bounded, canonical evidence used for generation and caching."""
    try:
        latitude = float(lat)
        longitude = float(lng)
    except (TypeError, ValueError) as exc:
        raise ValueError("valid campsite coordinates are required") from exc
    if not math.isfinite(latitude) or not math.isfinite(longitude) or not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        raise ValueError("valid campsite coordinates are required")

    references: list[dict[str, Any]] = []
    for raw in wiki_hits if isinstance(wiki_hits, list) else []:
        if not isinstance(raw, dict):
            continue
        title = _clean_text(raw.get("title"), 120)
        extract = _clean_text(raw.get("extract"), 400)
        if not title:
            continue
        references.append({
            "title": title,
            "extract": extract,
            "url": _clean_url(raw.get("url")),
        })
        if len(references) == 4:
            break

    return {
        "schema_version": CAMP_INSIGHT_SCHEMA_VERSION,
        "facility_id": _clean_text(facility_id, 180),
        "name": _clean_text(name, 160) or "Campsite",
        "lat": round(latitude, 5),
        "lng": round(longitude, 5),
        "description": _clean_text(description, 4000),
        "land_type": _clean_text(land_type, 100),
        "amenities": _normalized_amenities(amenities),
        "listing_source": {
            "label": _source_label(source_label),
            "url": _clean_url(source_url),
            "updated_at": _safe_timestamp(source_updated_at),
        },
        "nearby_references": references,
    }


def campsite_evidence_revision(evidence: dict[str, Any]) -> str:
    canonical = json.dumps(evidence, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _identity_segment(facility_id: object, lat: float, lng: float) -> str:
    clean_id = re.sub(r"[^a-z0-9._-]+", "-", _clean_text(facility_id, 180).casefold()).strip("-")
    if clean_id:
        return f"facility:{clean_id[:72]}"
    return f"coord:{lat:.3f}:{lng:.3f}"


def campsite_insight_cache_prefix(facility_id: object, lat: float | None = None, lng: float | None = None) -> str:
    if _clean_text(facility_id, 180):
        return f"ai_insight_v2:{_identity_segment(facility_id, 0, 0)}:"
    if lat is None or lng is None:
        return "ai_insight_v2:coord:"
    return f"ai_insight_v2:{_identity_segment('', float(lat), float(lng))}:"


def campsite_insight_cache_key(evidence: dict[str, Any]) -> str:
    prefix = campsite_insight_cache_prefix(
        evidence.get("facility_id"),
        float(evidence.get("lat") or 0),
        float(evidence.get("lng") or 0),
    )
    return f"{prefix}{campsite_evidence_revision(evidence)[:32]}"


def _canonical_token(token: str) -> str:
    return _TOKEN_EQUIVALENTS.get(token, token)


def _tokens(value: object) -> set[str]:
    return {
        _canonical_token(token)
        for token in _WORD_RE.findall(_clean_text(value, 5000).casefold())
        if len(token) >= 3 and token not in _STOPWORDS
    }


def _grounded(candidate: str, corpus: str, *, minimum: float, minimum_matches: int = 2) -> bool:
    if not candidate or _UNSUPPORTED_ASSURANCE_RE.search(candidate):
        return False
    normalized_candidate = _clean_text(candidate, 500).casefold()
    normalized_corpus = _clean_text(corpus, 12000).casefold()
    if len(normalized_candidate) >= 12 and normalized_candidate in normalized_corpus:
        return True
    candidate_tokens = _tokens(candidate)
    corpus_tokens = _tokens(corpus)
    if not candidate_tokens:
        return False
    matches = len(candidate_tokens & corpus_tokens)
    required = min(minimum_matches, len(candidate_tokens))
    return matches >= required and matches / len(candidate_tokens) >= minimum


def _listing_corpus(evidence: dict[str, Any]) -> str:
    return " ".join([
        str(evidence.get("name") or ""),
        str(evidence.get("description") or ""),
        str(evidence.get("land_type") or ""),
        *[str(value) for value in evidence.get("amenities") or []],
    ])


def _reference_corpus(evidence: dict[str, Any]) -> str:
    return " ".join(
        f"{item.get('title', '')} {item.get('extract', '')}"
        for item in evidence.get("nearby_references") or []
        if isinstance(item, dict)
    )


def _supporting_sources(candidate: str, listing: str, references: str, *, minimum: float) -> list[str]:
    sources: list[str] = []
    if _grounded(candidate, listing, minimum=minimum):
        sources.append("camp_listing")
    if references and _grounded(candidate, references, minimum=minimum):
        sources.append("nearby_references")
    if not sources and _grounded(candidate, f"{listing} {references}", minimum=minimum):
        sources = ["camp_listing"] + (["nearby_references"] if references else [])
    return sources


def _freshness(updated_at: int | None, now: int) -> str:
    if updated_at is None:
        return "date_unknown"
    age = max(0, now - updated_at)
    if age <= 7 * 86400:
        return "checked_recently"
    if age <= 30 * 86400:
        return "dated"
    return "older_source"


def _dms(value: float, positive: str, negative: str) -> str:
    direction = positive if value >= 0 else negative
    absolute = abs(value)
    degrees = int(absolute)
    minutes_float = (absolute - degrees) * 60
    minutes = int(minutes_float)
    seconds = round((minutes_float - minutes) * 60)
    if seconds == 60:
        seconds = 0
        minutes += 1
    if minutes == 60:
        minutes = 0
        degrees += 1
    return f'{degrees}\u00b0{minutes:02d}\'{seconds:02d}"{direction}'


def coordinates_dms(lat: float, lng: float) -> str:
    return f"{_dms(lat, 'N', 'S')} {_dms(lng, 'E', 'W')}"


def _dedupe(values: Iterable[str], *, limit: int) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        key = value.casefold()
        if not value or key in seen:
            continue
        seen.add(key)
        result.append(value)
        if len(result) == limit:
            break
    return result


def build_campsite_insight(
    generated: object,
    evidence: dict[str, Any],
    *,
    generated_at: int | None = None,
) -> dict[str, Any]:
    """Validate generated fields and attach user-visible evidence provenance."""
    now = int(generated_at or time.time())
    payload = generated if isinstance(generated, dict) else {}
    listing = _listing_corpus(evidence)
    references = _reference_corpus(evidence)
    all_evidence = f"{listing} {references}".strip()
    field_sources: dict[str, list[str]] = {}

    insider_tip = _clean_text(payload.get("insider_tip"), 240)
    insider_sources = _supporting_sources(insider_tip, listing, references, minimum=0.75)
    if insider_sources:
        field_sources["insider_tip"] = insider_sources
    else:
        insider_tip = (
            "Review the campsite listing and confirm current access, fees, and availability before leaving."
            if listing else
            "Planning details are limited. Confirm access, fees, and availability with the campsite source before leaving."
        )
        field_sources["insider_tip"] = ["planning_guidance"]

    best_for = _clean_text(payload.get("best_for"), 120)
    if best_for and _grounded(best_for, listing, minimum=0.75):
        field_sources["best_for"] = ["camp_listing"]
    else:
        best_for = ""

    best_season = _clean_text(payload.get("best_season"), 120)
    candidate_seasons = _tokens(best_season) & _SEASON_TERMS
    evidence_seasons = _tokens(listing + " " + references) & _SEASON_TERMS
    season_sources = _supporting_sources(best_season, listing, references, minimum=0.60)
    if best_season and candidate_seasons and candidate_seasons <= evidence_seasons and season_sources:
        field_sources["best_season"] = season_sources
    else:
        best_season = ""

    hazards = _clean_text(payload.get("hazards"), 180)
    hazard_tokens = _tokens(hazards) & _HAZARD_TERMS
    evidence_hazard_tokens = _tokens(all_evidence) & _HAZARD_TERMS
    hazard_sources = _supporting_sources(hazards, listing, references, minimum=0.75)
    if hazards and hazard_tokens and hazard_tokens <= evidence_hazard_tokens and hazard_sources:
        field_sources["hazards"] = hazard_sources
    else:
        hazards = ""

    allowed_highlights = {
        _clean_text(item.get("title"), 120).casefold(): _clean_text(item.get("title"), 120)
        for item in evidence.get("nearby_references") or []
        if isinstance(item, dict) and _clean_text(item.get("title"), 120)
    }
    raw_highlights = payload.get("nearby_highlights") if isinstance(payload.get("nearby_highlights"), list) else []
    nearby_highlights = _dedupe(
        [allowed_highlights.get(_clean_text(item, 120).casefold(), "") for item in raw_highlights],
        limit=3,
    )
    if nearby_highlights:
        field_sources["nearby_highlights"] = ["nearby_references"]

    supported_fields = [
        field for field, sources in field_sources.items()
        if sources != ["planning_guidance"]
    ]
    source_revision = campsite_evidence_revision(evidence)
    listing_source = evidence.get("listing_source") if isinstance(evidence.get("listing_source"), dict) else {}
    listing_updated_at = _safe_timestamp(listing_source.get("updated_at"))
    sources: list[dict[str, Any]] = [{
        "id": "camp_listing",
        "label": _source_label(listing_source.get("label")),
        "url": _clean_url(listing_source.get("url")) or None,
        "source_updated_at": listing_updated_at,
        "freshness": _freshness(listing_updated_at, now),
    }]
    if evidence.get("nearby_references"):
        sources.append({
            "id": "nearby_references",
            "label": "Wikipedia nearby",
            "retrieved_at": now,
            "max_age_seconds": CAMP_INSIGHT_CACHE_TTL_SECONDS,
            "freshness": "refreshed_within_48_hours",
        })
    sources.append({
        "id": "planning_guidance",
        "label": "Trailhead planning guidance",
        "freshness": "current_policy",
    })

    return {
        "insider_tip": insider_tip,
        "best_for": best_for,
        "best_season": best_season,
        "nearby_highlights": nearby_highlights,
        "hazards": hazards or None,
        "star_rating": 0,
        "coordinates_dms": coordinates_dms(float(evidence["lat"]), float(evidence["lng"])),
        "provenance": {
            "schema_version": CAMP_INSIGHT_SCHEMA_VERSION,
            "evidence_status": "supported" if supported_fields else "limited",
            "source_revision": source_revision,
            "generated_at": now,
            "expires_at": now + CAMP_INSIGHT_CACHE_TTL_SECONDS,
            "sources": sources,
            "field_sources": field_sources,
            "notice": "Source notes can be incomplete. Confirm current access, fees, closures, and availability before travel.",
        },
    }
