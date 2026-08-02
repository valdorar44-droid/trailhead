#!/usr/bin/env python3
"""Build an immutable, cached-only NPS child-depth internal candidate.

This builder deliberately cannot fetch data or write Trailhead's live catalog,
internal-preview overlay, or serving index. It reads five named cached NPS
source packs, applies the existing conservative child-promotion rules, and
writes a review sidecar beneath ``data/explore/audit_candidates``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.promote_nps_child_explore_places import (
    NPS_ATTRIBUTION,
    NPS_LICENSE,
    child_title,
    first_image,
    load_existing_keys,
    promote_from_fixture,
    title_key,
)
from scripts.explore_sources.nps.media_rights import (
    NPS_MEDIA_DISTRIBUTION_STATUS,
    NPS_MEDIA_RIGHTS_STATE,
    normalize_selected_nps_places,
)


BATCH_ID = "post-b08-nps-child-depth-b1"
BATCH_DESTINATIONS: tuple[tuple[str, str], ...] = (
    ("blri", "Blue Ridge Parkway"),
    ("seki", "Sequoia & Kings Canyon National Parks"),
    ("brca", "Bryce Canyon National Park"),
    ("shen", "Shenandoah National Park"),
    ("dino", "Dinosaur National Monument"),
)
BATCH_2_ID = "post-b08-nps-child-depth-b2"
BATCH_2_DESTINATIONS: tuple[tuple[str, str], ...] = (
    ("gumo", "Guadalupe Mountains National Park"),
    ("olym", "Olympic National Park"),
    ("deva", "Death Valley National Park"),
    ("jotr", "Joshua Tree National Park"),
    ("romo", "Rocky Mountain National Park"),
)
BATCH_DEFINITIONS: dict[str, tuple[tuple[str, str], ...]] = {
    BATCH_ID: BATCH_DESTINATIONS,
    BATCH_2_ID: BATCH_2_DESTINATIONS,
}
RENDERED_RAIL_ENDPOINT_PRIORITY = {
    "visitorcenters": 0,
    "campgrounds": 0,
    "thingstodo": 1,
    "places": 2,
}
DISPLAY_NAME_OVERRIDES = {
    "place:nps-child:olym:campgrounds:f8dfab23-efe0-4f31-98d0-cd5a871596a9": (
        "Kalaloch Campround",
        "Kalaloch Campground",
    ),
}
EXACT_COPY_REPLACEMENTS: dict[str, tuple[tuple[str, str], ...]] = {
    "place:nps-child:jotr:thingstodo:4b6d0fab-7f6b-4b19-b3fe-6c07566b8050": (
        (
            "A .6-mile trail leads to a .2-mile loop.",
            "A 0.6-mile trail leads to a 0.2-mile loop.",
        ),
        (
            "A.6-mile trail leads to a.2-mile loop.",
            "A 0.6-mile trail leads to a 0.2-mile loop.",
        ),
    ),
    "place:nps-child:romo:visitorcenters:593c4e0b-88ae-4ce3-8150-dc1ee862ada2": ((
        "help your plan your trips",
        "help you plan your trip",
    ),),
    "place:nps-child:romo:places:c3a54769-e360-4591-8650-cc7cf92fb7bc": (
        ("What to Expect? .", "What to expect?"),
        ("What to Expect?.", "What to expect?"),
    ),
    "place:nps-child:olym:places:b340cd12-f8e3-40af-b9ea-f00928240554": ((
        "Visit nps.gov/olym/planyourvisit/wic.htm to plan a backpacking trip!",
        "",
    ),),
    "place:nps-child:romo:campgrounds:7475825b-e844-4012-841b-0e29e05d4540": ((
        "To make a reservation, visit www.recreation.gov online, use the Recreation.gov Mobile App or call 1-877-444-6777 and search for Rocky Mountain National Park - Aspenglen Campground",
        "",
    ),),
    "place:nps-child:romo:campgrounds:6715a7cc-280c-4093-85d3-492004c2db48": ((
        "To make a reservation, visit www.recreation.gov online, use the Recreation.gov Mobile App or call 1-877-444-6777 and search for Rocky Mountain National Park - Glacier Basin Campground",
        "",
    ),),
    "place:nps-child:romo:campgrounds:d322e1e9-8058-4c42-80a3-9fbc82583190": ((
        "To make a reservation, visit www.recreation.gov online, use the Recreation.gov Mobile App or call 1-877-444-6777 and search for Rocky Mountain National Park - Moraine Park Campground",
        "",
    ),),
    "place:nps-child:romo:campgrounds:f7965b87-3035-49d4-b55a-d55d6cad0c93": ((
        "To make a reservation, visit www.recreation.gov online, use the Recreation.gov Mobile App or call 1-877-444-6777 and search for Rocky Mountain National Park - Timber Creek Campground",
        "",
    ),),
    "place:nps-child:jotr:places:013a1c84-4949-4cdc-958f-7283f1bc9ac5": ((
        "one way(16 miles round trip)",
        "one way (16 miles round trip)",
    ),),
}
MAX_PER_DESTINATION = 36
MAX_TOTAL = 180
ALLOWED_MODULE_TARGETS = {"stay", "visitor", "trails", "do", "see"}
DEFAULT_BASE_CATALOG = (
    ROOT
    / "data/explore/audit_candidates/combined/live-20260801-b08-operational-r8/explore_catalog_v3_review.json"
)
DEFAULT_SOURCE_CACHE = ROOT / "data/explore/source_cache/nps"
AUDIT_CANDIDATE_ROOT = (ROOT / "data/explore/audit_candidates").resolve()
DEFAULT_OUTPUT = AUDIT_CANDIDATE_ROOT / f"internal/{BATCH_ID}"
PROTECTED_OUTPUTS = {
    (ROOT / "dashboard/explore_catalog_v3.json").resolve(),
    (ROOT / "dashboard/explore_serving_index_v2.json").resolve(),
    (ROOT / "dashboard/explore_internal_preview_v1.json").resolve(),
}
FORBIDDEN_COPY = re.compile(
    r"\b(?:artificial intelligence|provider slug|check local rules|verify current|"
    r"description not available|lorem ipsum|generated summary)\b",
    re.IGNORECASE,
)
URL_TOKEN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError(f"expected a JSON object: {path}")
    return payload


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_ref(path: Path, logical_path: str) -> dict[str, Any]:
    resolved = path.resolve()
    display = str(logical_path or "").strip().replace("\\", "/").lstrip("/")
    if not display or display.startswith("../") or "/../" in display:
        raise ValueError("source reference needs a stable logical path")
    return {
        "path": display,
        "bytes": resolved.stat().st_size,
        "sha256": _sha256(resolved),
    }


def _places(payload: dict[str, Any], path: Path) -> list[dict[str, Any]]:
    places = [item for item in payload.get("places") or [] if isinstance(item, dict)]
    declared = int(payload.get("count") or len(places))
    if declared != len(places):
        raise ValueError(f"declared place count does not match records: {path}")
    ids = [str(item.get("id") or "") for item in places]
    if not all(ids) or len(ids) != len(set(ids)):
        raise ValueError(f"base catalog contains missing or duplicate IDs: {path}")
    return places


def _fixture_for_code(source_cache: Path, code: str) -> Path:
    matches = sorted(source_cache.glob(f"source-pack_codes-{code}_with-*.json"))
    if len(matches) != 1:
        raise ValueError(f"expected exactly one cached NPS fixture for {code}, found {len(matches)}")
    return matches[0]


def _fixture_park(
    path: Path,
    code: str,
    expected_name: str,
) -> tuple[dict[str, Any], dict[str, Any], int]:
    payload = _read_json(path)
    parks = [item for item in payload.get("data") or [] if isinstance(item, dict)]
    related = payload.get("related") if isinstance(payload.get("related"), dict) else {}
    if len(parks) != 1:
        raise ValueError(f"expected one park record in cached fixture: {path}")
    park = parks[0]
    actual_code = str(park.get("parkCode") or park.get("id") or "").strip().lower()
    actual_name = str(park.get("fullName") or park.get("name") or "").strip()
    if actual_code != code or actual_name != expected_name:
        raise ValueError(
            f"cached fixture identity mismatch for {code}: {actual_code!r}, {actual_name!r}"
        )
    related_for_park = related.get(code)
    if not isinstance(related_for_park, dict):
        raise ValueError(f"cached fixture has no related records for {code}: {path}")
    fetched_at = int(payload.get("fetched_at") or 0)
    if fetched_at <= 0:
        raise ValueError(f"cached fixture has no fixed fetched_at timestamp for {code}: {path}")
    return park, related_for_park, fetched_at


def _nps_https_url(value: Any) -> bool:
    text = str(value or "").strip()
    try:
        parsed = urlsplit(text)
        port = parsed.port
    except ValueError:
        return False
    host = (parsed.hostname or "").lower().rstrip(".")
    return (
        parsed.scheme == "https"
        and bool(parsed.path)
        and not parsed.username
        and not parsed.password
        and port in (None, 443)
        and (host == "nps.gov" or host.endswith(".nps.gov"))
    )


def _valid_point(place: dict[str, Any]) -> bool:
    try:
        lat = float(place.get("lat"))
        lng = float(place.get("lng"))
    except (TypeError, ValueError):
        return False
    return math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180


def _source_child_index(related: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for endpoint in ("campgrounds", "visitorcenters", "thingstodo", "places"):
        for item in related.get(endpoint) or []:
            if not isinstance(item, dict):
                continue
            source_id = str(item.get("id") or "").strip().casefold()
            title = title_key(child_title(item))
            if source_id:
                result.setdefault(f"{endpoint}:id:{source_id}", item)
            if title:
                result.setdefault(f"{endpoint}:title:{title}", item)
    return result


def _source_id_from_place(place: dict[str, Any]) -> str:
    direct = str(place.get("source_item_id") or "").strip()
    if direct:
        return direct
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    packed = str(pack.get("nps_item_id") or "").strip()
    if packed:
        return packed
    for source in place.get("sources") or []:
        if isinstance(source, dict) and str(source.get("source_id") or "").strip():
            return str(source["source_id"]).strip()
    return ""


def _resolve_source_item(
    place: dict[str, Any],
    endpoint: str,
    source_index: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    source_id = _source_id_from_place(place).casefold()
    if source_id:
        item = source_index.get(f"{endpoint}:id:{source_id}")
        if item is not None:
            return item
    return source_index.get(f"{endpoint}:title:{title_key(place.get('name'))}")


def _safe_nps_reader_url(raw_url: Any, parent_url: Any) -> tuple[str, str]:
    """Return a safe NPS reader URL and the normalization action used."""
    raw = str(raw_url or "").strip()
    try:
        parsed = urlsplit(raw)
    except ValueError:
        parsed = urlsplit("")
    raw_host = (parsed.hostname or "").lower().rstrip(".")
    if raw_host == "nps.gov" or raw_host.endswith(".nps.gov"):
        if parsed.scheme == "http":
            return parsed._replace(scheme="https").geturl(), "upgraded_nps_https"
        if _nps_https_url(raw):
            return raw, "kept_item_url"
    parent = str(parent_url or "").strip()
    if _nps_https_url(parent):
        return parent, "used_parent_nps_url"
    return "", "rejected"


def _normalize_child_reader_link(
    place: dict[str, Any],
    park: dict[str, Any],
    source_item: dict[str, Any],
) -> str:
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    safe_url, action = _safe_nps_reader_url(
        source_item.get("url") or source_item.get("relatedUrl") or pack.get("official_url"),
        park.get("url"),
    )
    if not safe_url:
        return action
    pack["official_url"] = safe_url
    for source in pack.get("sources") or []:
        if isinstance(source, dict):
            source["url"] = safe_url
    for source in place.get("sources") or []:
        if isinstance(source, dict):
            source["url"] = safe_url
    place["source_pack"] = pack
    return action


def _structured_terms(source_item: dict[str, Any], *keys: str) -> set[str]:
    terms: set[str] = set()
    for key in keys:
        raw = source_item.get(key)
        values = raw if isinstance(raw, list) else [raw]
        for value in values:
            if isinstance(value, dict):
                value = value.get("name") or value.get("title") or value.get("label")
            text = str(value or "").strip().casefold()
            if text:
                terms.add(text)
    return terms


def _normalize_child_classification(
    place: dict[str, Any],
    endpoint: str,
    source_item: dict[str, Any],
) -> None:
    """Classify from endpoint and structured NPS facts, not incidental title tokens."""
    title = str(place.get("name") or "").casefold()
    original_category = str(place.get("category") or "")
    activity_terms = _structured_terms(source_item, "activities")
    tag_terms = _structured_terms(source_item, "tags", "topics")
    facility_terms = _structured_terms(source_item, "amenities", "facilities")
    # Explicit NPS activities are authoritative. Tags/topics are a fallback,
    # not a reason to override a populated activity field.
    activity_basis = " ".join(sorted(activity_terms or tag_terms))
    guided_activity = bool(re.search(r"\b(?:guided|ranger|tour|program|talk)\b", activity_basis))
    trail_activity = bool(
        re.search(
            r"\b(?:hiking|backcountry hiking|front-country hiking|biking|cycling|"
            r"horseback riding|mountain biking|walking|snowshoeing|cross-country skiing)\b",
            activity_basis,
        )
    )
    explicit_nontrail_route_activity = bool(
        re.search(
            r"\b(?:scenic driving|auto touring|driving|road touring)\b",
            " ".join(sorted(activity_terms)),
        )
    )
    structured_trailhead = bool(
        re.search(r"\btrailheads?\b", " ".join(sorted(facility_terms)))
    )
    facility_title = bool(
        re.search(
            r"\b(?:gazebo|wayside|trail stops?|petroglyphs?|exhibits?|markers?|"
            r"signs?|ranger walks?|walk with a ranger)\b",
            title,
        )
    )
    trail_title = bool(re.search(r"\b(?:trail|hike|loop|route)\b", title)) and not facility_title
    if endpoint == "campgrounds":
        place["category"] = "campground"
        place["module_target"] = "stay"
    elif endpoint == "visitorcenters":
        place["category"] = "visitor_center"
        place["module_target"] = "visitor"
    elif endpoint == "thingstodo":
        is_trail = (
            trail_activity or (trail_title and not explicit_nontrail_route_activity)
        ) and not guided_activity
        place["category"] = "trail" if is_trail else "activity"
        place["module_target"] = "trails" if is_trail else "do"
    elif endpoint == "places":
        if structured_trailhead and trail_title:
            place["category"] = "trailhead"
            place["module_target"] = "trails"
        elif re.search(r"\b(?:campground|campsite)\b", title):
            place["category"] = "campground"
            place["module_target"] = "stay"
        elif re.search(r"\btrailhead\b", title) and not facility_title:
            place["category"] = "trailhead"
            place["module_target"] = "trails"
        elif re.search(r"\bvisitor (?:center|centre)\b", title):
            place["category"] = "visitor_center"
            place["module_target"] = "visitor"
        elif facility_title:
            place["module_target"] = "see"
            if re.search(r"\b(?:petroglyphs?|archaeolog|historic|exhibit|wayside|marker)\b", title):
                place["category"] = "historic_site"
            else:
                place["category"] = "place"
        elif re.search(r"\b(?:overlook|viewpoint|vista)\b", title):
            place["category"] = "viewpoint"
            place["module_target"] = "see"
        elif re.search(r"\b(?:waterfall|falls|cascade)\b", title):
            place["category"] = "waterfall"
            place["module_target"] = "see"
        elif place.get("category") in {
            "waterfall",
            "viewpoint",
            "lake",
            "river",
            "shore",
            "hot_spring",
            "peak",
            "historic_site",
            "monument",
        }:
            place["module_target"] = "see"
        elif (trail_title or trail_activity) and not guided_activity and not facility_title:
            place["category"] = "trail"
            place["module_target"] = "trails"
        else:
            place["module_target"] = "see"
            if place.get("category") in {"trail", "trailhead", "campground", "visitor_center", "activity"}:
                place["category"] = "place"

    final_category = str(place.get("category") or "")
    if final_category == original_category:
        return

    category_labels = {
        "activity": "Activity",
        "campground": "Campground",
        "place": "Place",
        "trail": "Trail",
        "trailhead": "Trailhead",
        "visitor_center": "Visitor center",
    }
    classification_tokens = {key.casefold() for key in category_labels}
    classification_tokens.update(label.casefold() for label in category_labels.values())

    def aligned_terms(values: Any) -> list[str]:
        clean = [str(value).strip() for value in values or [] if str(value).strip()]
        clean = [value for value in clean if value.casefold() not in classification_tokens]
        label = category_labels.get(final_category, final_category.replace("_", " ").title())
        if label and label.casefold() not in {value.casefold() for value in clean}:
            clean.append(label)
        return clean

    place["tags"] = aligned_terms(place.get("tags"))
    place["search_aliases"] = aligned_terms(place.get("search_aliases"))
    if isinstance(place.get("subcategories"), list):
        place["subcategories"] = aligned_terms(place.get("subcategories"))
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    if isinstance(pack.get("topics"), list):
        pack["topics"] = aligned_terms(pack.get("topics"))
    card = place.get("card") if isinstance(place.get("card"), dict) else {}
    quick_facts = [str(value).strip() for value in card.get("quick_facts") or [] if str(value).strip()]
    label = category_labels.get(final_category, final_category.replace("_", " ").title())
    replaced = False
    for index, value in enumerate(quick_facts):
        if value.casefold() in classification_tokens:
            quick_facts[index] = label
            replaced = True
    if not replaced and label:
        quick_facts.append(label)
    if quick_facts:
        card["quick_facts"] = list(dict.fromkeys(quick_facts))


def _apply_exact_child_copy_fixes(place: dict[str, Any]) -> None:
    """Apply reviewed, identity-bound source-copy corrections only."""
    place_id = str(place.get("id") or "")
    name_override = DISPLAY_NAME_OVERRIDES.get(place_id)
    if name_override:
        old_name, new_name = name_override
        if str(place.get("name") or "") == old_name:
            place["name"] = new_name
            aliases = [str(value).strip() for value in place.get("search_aliases") or [] if str(value).strip()]
            if old_name not in aliases:
                aliases.append(old_name)
            place["search_aliases"] = aliases
            card = place.get("card") if isinstance(place.get("card"), dict) else {}
            if card.get("title") == old_name:
                card["title"] = new_name
            if card.get("headline") == old_name:
                card["headline"] = new_name
            pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
            for source in pack.get("sources") or []:
                if isinstance(source, dict) and source.get("title") == old_name:
                    source["title"] = new_name
            for source in place.get("sources") or []:
                if isinstance(source, dict) and source.get("title") == old_name:
                    source["title"] = new_name

    replacements = EXACT_COPY_REPLACEMENTS.get(place_id, ())
    if not replacements:
        return

    def cleaned(value: Any) -> Any:
        if not isinstance(value, str):
            return value
        result = value
        for old, new in replacements:
            result = result.replace(old, new)
        return re.sub(r"\s+", " ", result).strip()

    for key in ("summary", "description"):
        if key in place:
            place[key] = cleaned(place.get(key))
    card = place.get("card") if isinstance(place.get("card"), dict) else {}
    for key in ("summary", "highlight"):
        if key in card:
            card[key] = cleaned(card.get(key))
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    if "extract" in pack:
        pack["extract"] = cleaned(pack.get("extract"))


def _rendered_rail_identity(
    place: dict[str, Any],
) -> tuple[str, str, str, float | None, float | None]:
    try:
        lat = round(float(place.get("lat")), 5)
        lng = round(float(place.get("lng")), 5)
    except (TypeError, ValueError):
        lat = None
        lng = None
    return (
        str(place.get("parent_hub_id") or ""),
        str(place.get("module_target") or ""),
        title_key(place.get("name")),
        lat,
        lng,
    )


def _dedupe_rendered_rail_children(
    children: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Keep one deterministic record per parent, rail, title, and exact point."""
    grouped: dict[tuple[str, str, str, float | None, float | None], list[dict[str, Any]]] = {}
    for place in children:
        key = _rendered_rail_identity(place)
        grouped.setdefault(key, []).append(place)

    dropped_ids: set[str] = set()
    diagnostics: list[dict[str, Any]] = []
    for key, group in sorted(grouped.items()):
        if len(group) < 2:
            continue
        ranked = sorted(
            group,
            key=lambda place: (
                RENDERED_RAIL_ENDPOINT_PRIORITY.get(_endpoint_from_place(place), 99),
                str(place.get("id") or ""),
            ),
        )
        kept = ranked[0]
        dropped = ranked[1:]
        dropped_ids.update(str(place.get("id") or "") for place in dropped)
        diagnostics.append({
            "parent_hub_id": key[0],
            "module_target": key[1],
            "title": str(kept.get("name") or ""),
            "lat": key[3],
            "lng": key[4],
            "kept_id": kept.get("id"),
            "kept_endpoint": _endpoint_from_place(kept),
            "dropped": [
                {"id": place.get("id"), "endpoint": _endpoint_from_place(place)}
                for place in dropped
            ],
        })
    return (
        [place for place in children if str(place.get("id") or "") not in dropped_ids],
        diagnostics,
    )


def _rebuild_search_blob(
    place: dict[str, Any],
    endpoint: str,
    source_item: dict[str, Any],
) -> None:
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    terms = [
        place.get("name"),
        place.get("parent_hub_title"),
        endpoint,
        place.get("category"),
        place.get("module_target"),
        place.get("summary"),
        place.get("description"),
        *(place.get("tags") or []),
        *(place.get("search_aliases") or []),
        *sorted(_structured_terms(source_item, "activities", "tags", "topics")),
        pack.get("primary"),
    ]
    place["search_blob"] = " ".join(
        re.sub(r"\s+", " ", URL_TOKEN.sub("", str(term or ""))).strip()
        for term in terms
        if URL_TOKEN.sub("", str(term or "")).strip()
    ).casefold()


def _endpoint_from_place(place: dict[str, Any]) -> str:
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    explicit = str(pack.get("nps_endpoint") or "").strip()
    if explicit:
        return explicit
    parts = str(place.get("id") or "").split(":", 4)
    return parts[3] if len(parts) == 5 else ""


def _stabilize_evidence_paths(value: Any) -> None:
    """Keep cached-rights evidence portable across checkout locations."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "source_cache_path" and str(child or "").strip():
                value[key] = f"nps-cache/{Path(str(child)).name}"
            else:
                _stabilize_evidence_paths(child)
    elif isinstance(value, list):
        for child in value:
            _stabilize_evidence_paths(child)


def _visible_copy(place: dict[str, Any]) -> str:
    card = place.get("card") if isinstance(place.get("card"), dict) else {}
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    return " ".join(
        str(value or "")
        for value in (
            place.get("name"),
            place.get("summary"),
            place.get("description"),
            card.get("summary"),
            pack.get("extract"),
        )
    )


def _audit_children(
    children: list[dict[str, Any]],
    sources_by_destination: dict[str, dict[str, dict[str, Any]]],
    *,
    batch_id: str = BATCH_ID,
) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    ids = [str(item.get("id") or "") for item in children]
    title_scopes = [
        (
            str(item.get("parent_hub_id") or ""),
            _endpoint_from_place(item),
            title_key(item.get("name")),
        )
        for item in children
    ]
    rendered_rail_scopes = [_rendered_rail_identity(item) for item in children]

    def fail(code: str, place: dict[str, Any], detail: str) -> None:
        errors.append({"code": code, "place_id": place.get("id"), "detail": detail})

    if len(ids) != len(set(ids)):
        errors.append({"code": "duplicate_id", "count": len(ids) - len(set(ids))})
    if len(title_scopes) != len(set(title_scopes)):
        errors.append({
            "code": "duplicate_title_scope",
            "count": len(title_scopes) - len(set(title_scopes)),
        })
    if len(rendered_rail_scopes) != len(set(rendered_rail_scopes)):
        errors.append({
            "code": "duplicate_rendered_rail_identity",
            "count": len(rendered_rail_scopes) - len(set(rendered_rail_scopes)),
        })

    module_counts: Counter[str] = Counter()
    destination_counts: Counter[str] = Counter()
    coordinate_groups: dict[tuple[float, float], list[str]] = {}
    media_count = 0
    for place in children:
        place_id = str(place.get("id") or "")
        parent_id = str(place.get("parent_hub_id") or "")
        code = parent_id.removeprefix("place:nps:")
        module_target = str(place.get("module_target") or "")
        module_counts[module_target] += 1
        destination_counts[code] += 1
        if not place_id.startswith(f"place:nps-child:{code}:") or place.get("canonical_role") != "child":
            fail("identity_contract", place, "child ID, parent ID, and canonical role must agree")
        if module_target not in ALLOWED_MODULE_TARGETS:
            fail("invalid_module_target", place, module_target)
        if not _valid_point(place):
            fail("invalid_coordinates", place, "missing or out-of-range point")
        else:
            point = (round(float(place["lat"]), 4), round(float(place["lng"]), 4))
            coordinate_groups.setdefault(point, []).append(place_id)
        if FORBIDDEN_COPY.search(_visible_copy(place)):
            fail("forbidden_or_filler_copy", place, "reader copy contains a forbidden generic phrase")
        if URL_TOKEN.search(_visible_copy(place)):
            fail("visible_copy_url", place, "reader copy may not retain source URLs")
        if re.search(r"https?://", str(place.get("search_blob") or ""), re.IGNORECASE):
            fail("unsafe_search_blob_url", place, "search data may not retain reader URLs")
        compatible_categories = {
            "stay": {"campground"},
            "visitor": {"visitor_center"},
            "trails": {"trail", "trailhead"},
            "do": {"activity"},
        }
        if module_target in compatible_categories and place.get("category") not in compatible_categories[module_target]:
            fail("module_category_mismatch", place, str(place.get("category") or "missing"))

        pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
        official_url = pack.get("official_url")
        if pack.get("primary") != NPS_ATTRIBUTION or pack.get("license") != NPS_LICENSE:
            fail("source_pack_identity", place, "NPS attribution or license is missing")
        if not _nps_https_url(official_url):
            fail("unsafe_official_url", place, str(official_url or "missing"))

        parts = place_id.split(":", 4)
        endpoint = parts[3] if len(parts) == 5 else ""
        source_item = _resolve_source_item(
            place,
            endpoint,
            sources_by_destination.get(code, {}),
        )
        if source_item is None:
            fail("source_item_missing", place, "accepted child did not resolve to its cached source row")
            continue
        stable_source_id = str(source_item.get("id") or "").strip()
        if not stable_source_id or _source_id_from_place(place) != stable_source_id:
            fail("source_identity_mismatch", place, "child is not bound to its stable NPS item ID")
        source_image = str(first_image(source_item).get("url") or "").strip()
        media = [item for item in place.get("media") or [] if isinstance(item, dict)]
        pack_photos = [item for item in pack.get("photos") or [] if isinstance(item, dict)]
        media_count += len(media)
        if media or pack_photos:
            if not source_image or not _nps_https_url(source_image):
                fail("unsafe_source_image", place, source_image or "missing")
            if [str(item.get("url") or "").strip() for item in media] != [source_image]:
                fail("media_identity_mismatch", place, "card media is not the exact cached child image")
            if [str(item.get("url") or "").strip() for item in pack_photos] != [source_image]:
                fail("pack_media_identity_mismatch", place, "source-pack media is not the exact cached child image")
            for image in [*media, *pack_photos]:
                if (
                    image.get("license") != NPS_LICENSE
                    or not str(image.get("credit") or "").strip()
                    or image.get("distribution_status") != NPS_MEDIA_DISTRIBUTION_STATUS
                    or image.get("rights_state") != NPS_MEDIA_RIGHTS_STATE
                    or not isinstance(image.get("rights_evidence"), dict)
                ):
                    fail("media_rights_missing", place, "approved cached rights evidence is missing")

    shared_coordinates = [
        {"lat": point[0], "lng": point[1], "place_ids": place_ids}
        for point, place_ids in sorted(coordinate_groups.items())
        if len(place_ids) > 1
    ]
    if shared_coordinates:
        warnings.append({
            "code": "shared_coordinate_clusters",
            "count": len(shared_coordinates),
            "samples": shared_coordinates[:12],
            "detail": "Distinct official child records can share an access point; review but do not merge by coordinate alone.",
        })
    return {
        "schema_version": 1,
        "batch_id": batch_id,
        "intended_grain": "one approved cached NPS child record per stable place ID",
        "count": len(children),
        "destination_counts": dict(destination_counts),
        "module_counts": dict(module_counts),
        "media_count": media_count,
        "unique_ids": len(ids) == len(set(ids)),
        "unique_title_scopes": len(title_scopes) == len(set(title_scopes)),
        "errors": errors,
        "warnings": warnings,
        "passed": not errors,
    }


def build(args: argparse.Namespace) -> dict[str, Any]:
    batch_id = str(getattr(args, "batch_id", BATCH_ID) or BATCH_ID).strip()
    try:
        batch_destinations = BATCH_DEFINITIONS[batch_id]
    except KeyError as exc:
        supported = ", ".join(sorted(BATCH_DEFINITIONS))
        raise ValueError(f"unsupported NPS child-depth batch {batch_id!r}; choose {supported}") from exc
    base_catalog = Path(args.base_catalog).resolve()
    source_cache = Path(args.source_cache).resolve()
    out_dir = Path(args.out_dir).resolve()
    if not base_catalog.is_file():
        raise FileNotFoundError(base_catalog)
    if not source_cache.is_dir():
        raise FileNotFoundError(source_cache)
    if out_dir == AUDIT_CANDIDATE_ROOT or AUDIT_CANDIDATE_ROOT not in out_dir.parents:
        raise ValueError("output must remain below data/explore/audit_candidates")
    if out_dir in PROTECTED_OUTPUTS or any(out_dir in path.parents for path in PROTECTED_OUTPUTS):
        raise ValueError("output may not target a protected live artifact")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise FileExistsError(f"immutable candidate directory is not empty: {out_dir}")

    base_payload = _read_json(base_catalog)
    base_places = _places(base_payload, base_catalog)
    existing_ids, existing_titles = load_existing_keys({"places": base_places})
    generated_at = int(base_payload.get("generated_at") or 0)
    if generated_at <= 0:
        raise ValueError("base catalog needs a fixed generated_at timestamp")

    children: list[dict[str, Any]] = []
    fixture_refs: dict[str, dict[str, Any]] = {}
    source_indexes: dict[str, dict[str, dict[str, Any]]] = {}
    destination_review: list[dict[str, Any]] = []
    link_actions: Counter[str] = Counter()
    for code, expected_name in batch_destinations:
        fixture = _fixture_for_code(source_cache, code)
        park, related, source_fetched_at = _fixture_park(fixture, code, expected_name)
        source_indexes[code] = _source_child_index(related)
        additions = promote_from_fixture(
            fixture,
            existing_ids,
            existing_titles,
            generated_at,
            max_per_park=MAX_PER_DESTINATION,
        )
        for child in additions:
            parts = str(child.get("id") or "").split(":", 4)
            endpoint = parts[3] if len(parts) == 5 else ""
            source_item = _resolve_source_item(child, endpoint, source_indexes[code])
            if source_item is None:
                continue
            _normalize_child_classification(child, endpoint, source_item)
            _apply_exact_child_copy_fixes(child)
            link_actions[_normalize_child_reader_link(child, park, source_item)] += 1
            _rebuild_search_blob(child, endpoint, source_item)
        children.extend(additions)
        module_counts = Counter(str(item.get("module_target") or "") for item in additions)
        destination_review.append(
            {
                "park_code": code,
                "name": expected_name,
                "accepted": len(additions),
                "module_counts": dict(module_counts),
                "cached_counts": {
                    endpoint: len(related.get(endpoint) or [])
                    for endpoint in ("campgrounds", "visitorcenters", "thingstodo", "places")
                },
                "parent_hub_id": f"place:nps:{code}",
                "source_fetched_at": source_fetched_at,
            }
        )
        fixture_refs[code] = _source_ref(fixture, f"nps/{code}/{fixture.name}")

    children, rendered_rail_dedupe = _dedupe_rendered_rail_children(children)
    for destination in destination_review:
        code = str(destination.get("park_code") or "")
        final_children = [
            child
            for child in children
            if str(child.get("parent_hub_id") or "") == f"place:nps:{code}"
        ]
        destination["accepted_before_dedupe"] = destination["accepted"]
        destination["accepted"] = len(final_children)
        destination["module_counts"] = dict(
            Counter(str(child.get("module_target") or "") for child in final_children)
        )
    if not children or len(children) > MAX_TOTAL:
        raise ValueError(f"bounded batch count must be between 1 and {MAX_TOTAL}, got {len(children)}")
    media_before_policy = sum(len(item.get("media") or []) for item in children)
    evidence_root = source_cache.parents[3] if len(source_cache.parents) > 3 else source_cache.parent
    children = normalize_selected_nps_places(
        children,
        cache_dir=source_cache,
        evidence_root=evidence_root,
    )
    _stabilize_evidence_paths(children)
    media_after_policy = sum(len(item.get("media") or []) for item in children)
    audit = _audit_children(children, source_indexes, batch_id=batch_id)
    if not audit["passed"]:
        codes = sorted({str(item.get("code") or "unknown") for item in audit["errors"]})
        raise ValueError(f"NPS child-depth audit failed: {', '.join(codes)}")

    sidecar = {
        "schema_version": 1,
        "batch_id": batch_id,
        "stage": "internal",
        "generated_at": generated_at,
        "source": "Cached official National Park Service child records",
        "count": len(children),
        "places": children,
    }
    review = {
        "schema_version": 1,
        "batch_id": batch_id,
        "generated_at": generated_at,
        "requests_used": 0,
        "live_catalog_modified": False,
        "live_serving_index_modified": False,
        "promotion_ready": False,
        "destinations": destination_review,
        "counts": {
            "base_places": len(base_places),
            "sidecar_places": len(children),
            "destination_count": len(destination_review),
        },
        "reader_link_actions": dict(link_actions),
        "media_policy": {
            "candidate_images": media_before_policy,
            "approved_images": media_after_policy,
            "stripped_images": media_before_policy - media_after_policy,
            "policy": "exact cached NPS media with NPS-prefixed credit only",
        },
        "rendered_rail_dedupe": {
            "rule": (
                "one stable child per parent, rendered module, normalized title, and "
                "5-decimal point; endpoint priority then stable ID"
            ),
            "dropped_count": sum(len(item["dropped"]) for item in rendered_rail_dedupe),
            "records": rendered_rail_dedupe,
        },
        "internal_preview_contract": {
            "stage": "internal",
            "requires_authenticated_admin": True,
            "required_header": "X-Trailhead-Explore-Preview: internal",
            "header_is_not_a_credential": True,
        },
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    artifacts = {
        "nps_child_depth_v1.json": sidecar,
        "audit.json": audit,
        "review.json": review,
    }
    for name, payload in artifacts.items():
        _write_json(out_dir / name, payload)
    manifest = {
        "schema_version": 1,
        "batch_id": batch_id,
        "generated_at": generated_at,
        "requests_used": 0,
        "live_catalog_modified": False,
        "live_serving_index_modified": False,
        "promotion_ready": False,
        "inputs": {
            "base_catalog": _source_ref(base_catalog, f"base_catalog/{base_catalog.name}"),
            "fixtures": fixture_refs,
        },
        "artifacts": [
            {"path": name, "bytes": (out_dir / name).stat().st_size, "sha256": _sha256(out_dir / name)}
            for name in sorted(artifacts)
        ],
    }
    _write_json(out_dir / "manifest.json", manifest)
    return {
        "out_dir": str(out_dir),
        "count": len(children),
        "destination_counts": audit["destination_counts"],
        "module_counts": audit["module_counts"],
        "manifest_sha256": _sha256(out_dir / "manifest.json"),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-id", choices=sorted(BATCH_DEFINITIONS), default=BATCH_ID)
    parser.add_argument("--base-catalog", default=str(DEFAULT_BASE_CATALOG))
    parser.add_argument("--source-cache", default=str(DEFAULT_SOURCE_CACHE))
    parser.add_argument("--out-dir")
    args = parser.parse_args()
    if not args.out_dir:
        args.out_dir = str(AUDIT_CANDIDATE_ROOT / f"internal/{args.batch_id}")
    return args


if __name__ == "__main__":
    print(json.dumps(build(parse_args()), indent=2))
