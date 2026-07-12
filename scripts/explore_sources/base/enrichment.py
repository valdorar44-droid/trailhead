from __future__ import annotations

import math
import re
from copy import deepcopy
from typing import Any

from .content_quality import fallback_description
from .normalize import compact_text
from .schema import ExplorePlaceV3


ENRICHMENT_GRADES = ("signature", "complete", "basic", "candidate")
REVIEWABLE_GRADES = frozenset({"signature", "complete", "basic"})

GENERIC_TITLE_RE = re.compile(
    r"^(?:campgrounds?|campsites?|parks?|trails?|trailheads?|viewpoints?|"
    r"mountains?|peaks?|lakes?|waterfalls?|recreation areas?|places?)$",
    re.I,
)
BOILERPLATE_DESCRIPTION_RE = re.compile(
    r"(?:^\s*mapped\b.*\b(?:verify|check)\b|\bmapped (?:camping|outdoor|service|trail|place)|"
    r"\bverify access, current conditions, and local rules before relying on it|"
    r"\bcheck access, fees, fire restrictions, reservations, and seasonal road conditions|"
    r"\bhas overnight options around\b|\bis a managed recreation stop\b|"
    r"\b(?:placeholder copy|lorem ipsum|undefined|null|database dump|raw record|api endpoint)\b)",
    re.I,
)
EMPTY_VALUE_RE = re.compile(r"^(?:n/?a|n|no|none|null|unknown|not available|not provided|\.?|-+)$", re.I)
URL_RE = re.compile(r"^https?://", re.I)
GENERIC_GEOGRAPHY_RE = re.compile(
    r"^(?:a\s+)?(?:lake|mountain|waterfall|glacier|island|hill|volcano|national park|"
    r"marine reserve|animal sanctuary|locality|river|peak|hot spring)\s+(?:in|on|near|of)\s+[^.]{1,100}\.?$",
    re.I,
)
KNOWN_AMENITY_RE = re.compile(
    r"\b(?:drinking water|potable water|toilets?|restrooms?|showers?|picnic tables?|"
    r"fire rings?|fire pits?|electric hookups?|rv hookups?|dump stations?|trash|wifi|food)\b",
    re.I,
)


def valid_coordinates(lat: Any, lng: Any) -> bool:
    try:
        lat_value = float(lat)
        lng_value = float(lng)
    except (TypeError, ValueError):
        return False
    return (
        math.isfinite(lat_value)
        and math.isfinite(lng_value)
        and -90 <= lat_value <= 90
        and -180 <= lng_value <= 180
    )


def public_description(place: dict[str, Any]) -> str:
    summary = place.get("summary")
    card = place.get("card") if isinstance(place.get("card"), dict) else {}
    candidates = [place.get("description")]
    if isinstance(summary, dict):
        candidates.extend((summary.get("short_description"), summary.get("description")))
    else:
        candidates.append(summary)
    candidates.extend((card.get("summary"), card.get("highlight")))
    for value in candidates:
        text = compact_text(value)
        if text:
            return text
    return ""


def is_boilerplate_description(text: Any, place: dict[str, Any]) -> bool:
    description = compact_text(text)
    title = compact_text(place.get("name") or place.get("title"))
    category = compact_text(place.get("category"))
    region = compact_text(place.get("region") or place.get("admin") or place.get("country"))
    if not description or description.strip(" .,:;!?") == "":
        return True
    if description.casefold().rstrip(".") == title.casefold().rstrip("."):
        return True
    if BOILERPLATE_DESCRIPTION_RE.search(description):
        return True
    if len(description) < 45 or GENERIC_GEOGRAPHY_RE.fullmatch(description):
        return True
    generated = fallback_description(title=title, category=category, region=region)
    if compact_text(generated).casefold() == description.casefold():
        return True
    return False


def _clean_fact_value(value: Any, *, max_length: int = 140) -> str:
    text = compact_text(value)
    if not text or len(text) > max_length or EMPTY_VALUE_RE.fullmatch(text):
        return ""
    if text.count(",") > 4 or re.search(r"\b(?:api|database|raw record|feature server)\b", text, re.I):
        return ""
    return text


def _safe_timestamp(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _primary_source(place: dict[str, Any]) -> dict[str, Any]:
    sources = [item for item in (place.get("sources") or []) if isinstance(item, dict)]
    if not sources:
        return {}
    quality_order = {
        "community_verified": 0,
        "official_source": 1,
        "curated_trailhead": 2,
        "open_community_data": 3,
        "basic_map_data": 4,
        "needs_verification": 5,
    }
    return min(
        sources,
        key=lambda item: (
            quality_order.get(compact_text(item.get("quality")), 9),
            compact_text(item.get("source")),
            compact_text(item.get("source_id")),
        ),
    )


def build_provenance(place: dict[str, Any], checked_at: int) -> dict[str, Any]:
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for source in place.get("sources") or []:
        if not isinstance(source, dict):
            continue
        source_name = compact_text(source.get("source"))
        source_id = compact_text(source.get("source_id"))
        if not source_name or not source_id or (source_name, source_id) in seen:
            continue
        seen.add((source_name, source_id))
        item = {
            "source": source_name,
            "source_id": source_id,
            "url": compact_text(source.get("url")),
            "attribution": compact_text(source.get("attribution")),
            "license": compact_text(source.get("license")),
            "quality": compact_text(source.get("quality")) or "basic_map_data",
            "checked_at": checked_at,
        }
        normalized.append(item)
    normalized.sort(key=lambda item: (item["source"], item["source_id"]))
    primary = _primary_source({"sources": normalized})
    return {"primary": deepcopy(primary), "sources": normalized}


def primary_media_url(place: dict[str, Any]) -> str:
    for media in place.get("media") or []:
        if not isinstance(media, dict):
            continue
        url = compact_text(media.get("url") or media.get("image_url") or media.get("thumbnail_url") or media.get("src"))
        if URL_RE.match(url):
            return url
    summary = place.get("summary") if isinstance(place.get("summary"), dict) else {}
    summary_url = compact_text(summary.get("image_url") or summary.get("thumbnail_url"))
    return summary_url if URL_RE.match(summary_url) else ""


def media_kind_for_place(place: dict[str, Any]) -> str:
    if primary_media_url(place):
        return "photo"
    if valid_coordinates(place.get("lat"), place.get("lng")):
        return "map_preview"
    return "none"


def build_planning_facts(place: dict[str, Any], checked_at: int) -> list[dict[str, Any]]:
    source = _primary_source(place)
    source_id = f"{compact_text(source.get('source'))}:{compact_text(source.get('source_id'))}".strip(":")
    facts: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(key: str, label: str, value: Any, field: str, *, url: Any = "") -> None:
        clean_value = _clean_fact_value(value)
        if not clean_value or key in seen:
            return
        seen.add(key)
        fact = {
            "key": key,
            "label": label,
            "value": clean_value,
            "source_id": source_id,
            "field": field,
            "checked_at": checked_at,
        }
        clean_url = compact_text(url)
        if URL_RE.match(clean_url):
            fact["url"] = clean_url
        facts.append(fact)

    category = compact_text(place.get("category")).replace("_", " ")
    if category:
        add("place_type", "Type", category.title(), "category")

    region_parts = []
    for field in ("region", "admin", "country"):
        value = _clean_fact_value(place.get(field), max_length=80)
        if value and value.casefold() not in {item.casefold() for item in region_parts}:
            region_parts.append(value)
    if region_parts:
        add("area", "Area", ", ".join(region_parts[:2]), "region")

    for key, label, field in (
        ("access", "Access", "access"),
        ("season", "Best season", "best_season"),
        ("difficulty", "Difficulty", "difficulty"),
        ("safety", "Safety", "safety"),
    ):
        add(key, label, place.get(field), field)

    description = public_description(place)
    title = compact_text(place.get("name") or place.get("title"))
    route_context = bool(
        compact_text(place.get("category")) in {"forest_road", "offroad_route", "scenic_drive", "trail"}
        or re.search(r"\b(?:forest road|ohv route|off[- ]road route|scenic drive|scenic byway|trail)\b", title, re.I)
    )
    if route_context:
        distance_match = re.search(r"\b(\d{1,3}(?:\.\d+)?)\s*(?:miles?|mi\.?)(?:\b|$)", description, re.I)
        if distance_match:
            add("distance", "Distance", f"{distance_match.group(1)} mi", "description")
        surfaces = []
        for pattern, label in (
            (r"\bpaved\b", "Paved"),
            (r"\bgravel(?:ed)?\b", "Gravel"),
            (r"\bdirt\b", "Dirt"),
            (r"\bunpaved\b", "Unpaved"),
        ):
            if re.search(pattern, description, re.I):
                surfaces.append(label)
        if surfaces:
            add("surface", "Surface", ", ".join(surfaces), "description")
        if re.search(r"\bhigh[- ]clearance\s+(?:4wd|4x4|four[- ]wheel[- ]drive)(?:\s+vehicles?)?\s+(?:recommended|required)\b", description, re.I):
            add("vehicle", "Vehicle", "High-clearance 4WD recommended", "description")
        elevation_match = re.search(r"\b(?:elevation(?:\s+of)?|climbs?\s+to)\s+(\d{1,2}(?:,\d{3})?)\s*(?:feet|ft)\b", description, re.I)
        if elevation_match:
            add("elevation", "Elevation", f"{elevation_match.group(1)} ft", "description")

    reservations = place.get("reservations") if isinstance(place.get("reservations"), dict) else {}
    reservation_url = reservations.get("reservation_url")
    if "reservable" in reservations:
        add(
            "reservations",
            "Reservations",
            "Available" if reservations.get("reservable") is True else "Not reservable",
            "reservations.reservable",
            url=reservation_url,
        )
    elif URL_RE.match(compact_text(reservation_url)):
        add("reservations", "Reservations", "Booking link", "reservations.reservation_url", url=reservation_url)

    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    for key, label, pack_key in (
        ("fees", "Fees", "fees"),
        ("hours", "Hours", "operating_hours"),
    ):
        raw = pack.get(pack_key)
        values = raw if isinstance(raw, list) else [raw]
        first = next((_clean_fact_value(item) for item in values if _clean_fact_value(item)), "")
        add(key, label, first, f"source_pack.{pack_key}")

    activities = []
    for value in pack.get("activities") or []:
        clean = _clean_fact_value(value, max_length=60)
        if clean and clean.casefold() not in {item.casefold() for item in activities}:
            activities.append(clean)
        if len(activities) == 4:
            break
    if activities:
        add("activities", "Activities", ", ".join(activities), "source_pack.activities")

    amenities = []
    for value in place.get("amenities") or []:
        clean = _clean_fact_value(value, max_length=60)
        if clean and KNOWN_AMENITY_RE.search(clean) and clean.casefold() not in {item.casefold() for item in amenities}:
            amenities.append(clean)
        if len(amenities) == 3:
            break
    if amenities:
        add("amenities", "Amenities", ", ".join(amenities), "amenities")

    return facts


def enrichment_grade(score: int, rejection_reasons: list[str], media_kind: str, fact_count: int) -> str:
    if rejection_reasons:
        return "candidate"
    if score >= 90 and media_kind == "photo" and fact_count >= 3:
        return "signature"
    if score >= 75:
        return "complete"
    if score >= 60:
        return "basic"
    return "candidate"


def enrich_place_dict(place: dict[str, Any]) -> dict[str, Any]:
    enriched = deepcopy(place)
    checked_at = max(_safe_timestamp(enriched.get("last_seen_at")), _safe_timestamp(enriched.get("updated_at")))
    title = compact_text(enriched.get("name") or enriched.get("title"))
    description = public_description(enriched)
    coordinates_valid = valid_coordinates(enriched.get("lat"), enriched.get("lng"))
    provenance = build_provenance(enriched, checked_at)
    planning_facts = build_planning_facts(enriched, checked_at)
    media_kind = media_kind_for_place(enriched)
    rejection_reasons: list[str] = []

    if not title:
        rejection_reasons.append("missing_name")
    elif GENERIC_TITLE_RE.fullmatch(title):
        rejection_reasons.append("generic_name")
    if not coordinates_valid:
        rejection_reasons.append("invalid_coordinates")
    if not description:
        rejection_reasons.append("missing_description")
    elif is_boilerplate_description(description, enriched):
        rejection_reasons.append("boilerplate_description")
    if not provenance["sources"]:
        rejection_reasons.append("missing_provenance")
    if media_kind == "none":
        rejection_reasons.append("missing_media")
    if len(planning_facts) < 2:
        rejection_reasons.append("insufficient_planning_facts")

    score = 0
    if title and not GENERIC_TITLE_RE.fullmatch(title):
        score += 10
    if coordinates_valid:
        score += 15
    if description and not is_boilerplate_description(description, enriched):
        score += 20 if len(description) >= 140 else 15
    if provenance["sources"]:
        primary = provenance["primary"]
        score += 15 if primary.get("url") and primary.get("attribution") else 12
    score += 15 if media_kind == "photo" else 8 if media_kind == "map_preview" else 0
    score += min(16, len(planning_facts) * 4)
    if bool(enriched.get("verified")) or compact_text(enriched.get("quality")) in {"official_source", "community_verified", "curated_trailhead"}:
        score += 4
    if isinstance(enriched.get("source_pack"), dict) and enriched["source_pack"]:
        score += 2
    score = min(100, score)
    grade = enrichment_grade(score, rejection_reasons, media_kind, len(planning_facts))

    enriched.update({
        "planning_facts": planning_facts,
        "provenance": provenance,
        "checked_at": checked_at,
        "media_kind": media_kind,
        "enrichment_score": score,
        "enrichment_grade": grade,
        "rejection_reasons": rejection_reasons,
        "reviewable": grade in REVIEWABLE_GRADES,
    })
    return enriched


def enrich_place(place: ExplorePlaceV3) -> ExplorePlaceV3:
    enriched = enrich_place_dict(place.to_dict())
    for field in (
        "planning_facts",
        "provenance",
        "checked_at",
        "media_kind",
        "enrichment_score",
        "enrichment_grade",
        "rejection_reasons",
        "reviewable",
    ):
        setattr(place, field, enriched[field])
    return place
