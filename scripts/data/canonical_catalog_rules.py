from __future__ import annotations

import re
from typing import Any


TRAIL_SURFACE_CATEGORY_VALUES = {
    "",
    "AGGREGATE",
    "ASPHALT",
    "BALLAST",
    "BITUMINOUS",
    "BOARWALK",
    "BOARDWALK",
    "CONCRETE",
    "EARTH",
    "GRAVEL",
    "N/A",
    "NAT - NATIVE MATERIAL",
    "NATIVE MATERIAL",
    "PAVED",
    "SNOW",
    "SOIL",
    "STONE",
    "UNKNOWN",
    "WATER",
}

PRIMARY_RV_RE = re.compile(
    r"\b(?:rv|r\.v\.|caravan|motorhome|motor\s+home|recreational\s+vehicle)\s*"
    r"(?:park|parks|resort|resorts|camp|campground|campgrounds|stay|stays)\b|"
    r"\b(?:park|resort|campground|camp)\s+for\s+"
    r"(?:rvs?|r\.v\.s?|caravans?|motorhomes?|motor\s+homes?|recreational\s+vehicles?)\b|"
    r"\b(?:rv|r\.v\.)[-_\s]?(?:park|resort|campground)\b|"
    r"\bcaravan[-_\s]?park\b|\bmotorhome[-_\s]?park\b|"
    r"\b[A-Za-z0-9][A-Za-z0-9 '&.-]{2,}\s+RV\b$",
    re.I,
)

OVERNIGHT_PARKING_RE = re.compile(
    r"\b(casino|truck\s*stop|rest\s*area|travel\s*center|service\s*plaza|"
    r"overnight\s+parking|parking\s+lot|sleep\s+in\s+(?:car|vehicle)|"
    r"vehicle\s+overnight|walmart|cracker\s+barrel)\b",
    re.I,
)

DEVELOPED_CAMP_RE = re.compile(
    r"\b(campgrounds?|camp\s*sites?|campsites?|group\s+camp|recreation\.gov|"
    r"reservable|reservation|hookups?|showers?|dump\s+station)\b",
    re.I,
)

DISPERSED_RE = re.compile(r"\b(dispersed|primitive|boondock|wild camp|informal camp|undeveloped)\b", re.I)

NON_OVERNIGHT_CAMP_RE = re.compile(
    r"\b(day\s*use|picnic|visitor\s+cent(?:er|re)|information\s+cent(?:er|re)|"
    r"ranger\s+(?:station|district|office)|field\s+office|headquarters|admin(?:istrative)?|"
    r"test\s+facility|test\s+venue|venue\s+test|demo\s+facility|boat\s+launch|trailhead|trail\s*head|"
    r"\bth\b|parking\s+area|river\s+access|boating\s+site|climbing\s+route|sno[-\s]?park|"
    r"shuttle|tickets?|"
    r"weddings?|ceremon(?:y|ies)|softball|volleyball|mixed\s+use\s+field|hockey\s+fields?|"
    r"photography|filming|special\s+event|gazebo|pavilion|hunt\s+blind)\b",
    re.I,
)

PUBLIC_COPY_FORBIDDEN_RE = re.compile(
    r"\b(AI|API|RIDB|FeatureServer|database dump|knowledge cutoff|undefined|null|N/A|"
    r"0 results|POI|schema|endpoint|raw\s+(?:source|record|data|json|dump)|"
    r"import(?:ed|ing)?\s+(?:source|record|data|dump)|"
    r"download(?:ed|ing)?\s+(?:source|record|data|dump|file|feed)?|"
    r"sync(?:ed|ing)?\s+(?:source|record|data|dump)|rig aware|offline ready)\b",
    re.I,
)


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def repair_public_title(value: Any, *context_values: Any, category: Any = "") -> str:
    """Repair source-field title truncations that are obvious in outdoor data.

    Some official feeds carry fixed-width display names such as
    "Campgroun", "Cam", or "Rec". This helper only expands those suffixes
    when surrounding context supports an outdoor/camp/recreation meaning.
    """
    title = compact(value)
    if not title:
        return ""
    context = " ".join(compact(value) for value in (*context_values, category))
    hay = f"{title} {context}".lower()
    camp_context = bool(re.search(r"\b(camps?|campgrounds?|campsites?|camping|tent|rv|overnight|group site)\b", hay))
    recreation_context = bool(re.search(r"\b(recreation|campgrounds?|camps?|lake|shoreline|river|area|facility|trail|picnic|day use|first-come)\b", hay))

    letters = [char for char in title if char.isalpha()]
    if letters and len(letters) >= 4 and sum(1 for char in letters if char.isupper()) / len(letters) >= 0.85:
        title = title.title()
        replacements = {
            " Rv ": " RV ",
            " Ohv ": " OHV ",
            " Atv ": " ATV ",
            " Usfs ": " USFS ",
            " Blm ": " BLM ",
            " Nps ": " NPS ",
            " Nf ": " NF ",
            " Cg ": " CG ",
        }
        padded = f" {title} "
        for needle, replacement in replacements.items():
            padded = padded.replace(needle, replacement)
        title = padded.strip()

    title = re.sub(r"\s*-\s*", " - ", title)
    title = re.sub(r"\s*/\s*", " / ", title)
    title = re.sub(r"\bCampgroun$", "Campground", title, flags=re.I)
    if camp_context:
        title = re.sub(r"\bCam$", "Campground", title, flags=re.I)
        title = re.sub(r"\bCG$", "Campground", title, flags=re.I)
    if recreation_context or camp_context:
        title = re.sub(r"\bRec$", "Recreation Area", title, flags=re.I)
    return compact(title)


def normalize_official_search_category(canonical_type: str, source_category: Any) -> str:
    """Return a public-safe search category for the canonical official cache."""
    kind = compact(canonical_type).lower()
    raw = compact(source_category)
    raw_lower = raw.lower().replace(" ", "_")
    if kind == "trail":
        return "trail"
    if kind == "land_unit":
        return "park"
    if raw.upper() in TRAIL_SURFACE_CATEGORY_VALUES:
        return "trail" if kind == "trail" else "place"
    if raw_lower in {"campground", "rv_park", "visitor_center", "trailhead", "park", "activity", "place"}:
        return raw_lower
    return raw


def is_primary_rv_label(*values: Any) -> bool:
    """Strict RV classification: primary RV parks only, not mixed campgrounds with RV capacity."""
    return bool(PRIMARY_RV_RE.search(" ".join(compact(value) for value in values if compact(value))))


def is_overnight_parking_label(*values: Any) -> bool:
    return bool(OVERNIGHT_PARKING_RE.search(" ".join(compact(value) for value in values if compact(value))))


def is_non_overnight_camp_label(*values: Any) -> bool:
    return bool(NON_OVERNIGHT_CAMP_RE.search(" ".join(compact(value) for value in values if compact(value))))


def classify_camp_kind(camp: dict[str, Any]) -> str:
    """Classify camp-like records into the public marker kinds Trailhead supports."""
    primary_text = " ".join(
        compact(value)
        for value in [
            camp.get("name"),
            camp.get("land_type"),
            camp.get("subtype"),
            camp.get("type"),
        ]
        if compact(value)
    )
    text = " ".join(
        compact(value)
        for value in [
            camp.get("name"),
            camp.get("land_type"),
            camp.get("subtype"),
            camp.get("type"),
            camp.get("source_badge"),
            camp.get("verified_source"),
            camp.get("description"),
            *(camp.get("tags") if isinstance(camp.get("tags"), list) else []),
            *(camp.get("site_types") if isinstance(camp.get("site_types"), list) else []),
        ]
        if compact(value)
    )
    if is_overnight_parking_label(primary_text):
        return "overnight_parking"
    if DISPERSED_RE.search(text) and not DEVELOPED_CAMP_RE.search(text):
        return "dispersed_camp"
    if is_primary_rv_label(camp.get("name"), camp.get("land_type"), camp.get("subtype"), camp.get("type")):
        return "rv_park"
    return "campground"


def public_label_for_camp_kind(kind: str) -> str:
    return {
        "dispersed_camp": "Dispersed camp",
        "rv_park": "RV park",
        "overnight_parking": "Overnight parking",
        "campground": "Campground",
    }.get(kind, "Campground")
