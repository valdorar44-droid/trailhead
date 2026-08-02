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


def _fixture_park(path: Path, code: str, expected_name: str) -> tuple[dict[str, Any], dict[str, Any]]:
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
    return park, related_for_park


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
    activity_terms = _structured_terms(source_item, "activities")
    tag_terms = _structured_terms(source_item, "tags", "topics")
    structured = " ".join(sorted(activity_terms | tag_terms))
    guided_activity = bool(re.search(r"\b(?:guided|ranger|tour|program|talk)\b", structured))
    trail_activity = bool(
        re.search(
            r"\b(?:hiking|backcountry hiking|front-country hiking|biking|cycling|"
            r"horseback riding|mountain biking|walking|snowshoeing|cross-country skiing)\b",
            structured,
        )
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
        is_trail = trail_activity and not guided_activity
        place["category"] = "trail" if is_trail else "activity"
        place["module_target"] = "trails" if is_trail else "do"
    elif endpoint == "places":
        if re.search(r"\b(?:campground|campsite)\b", title):
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

    def fail(code: str, place: dict[str, Any], detail: str) -> None:
        errors.append({"code": code, "place_id": place.get("id"), "detail": detail})

    if len(ids) != len(set(ids)):
        errors.append({"code": "duplicate_id", "count": len(ids) - len(set(ids))})
    if len(title_scopes) != len(set(title_scopes)):
        errors.append({
            "code": "duplicate_title_scope",
            "count": len(title_scopes) - len(set(title_scopes)),
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
        "batch_id": BATCH_ID,
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
    for code, expected_name in BATCH_DESTINATIONS:
        fixture = _fixture_for_code(source_cache, code)
        park, related = _fixture_park(fixture, code, expected_name)
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
            }
        )
        fixture_refs[code] = _source_ref(fixture, f"nps/{code}/{fixture.name}")

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
    audit = _audit_children(children, source_indexes)
    if not audit["passed"]:
        codes = sorted({str(item.get("code") or "unknown") for item in audit["errors"]})
        raise ValueError(f"NPS child-depth audit failed: {', '.join(codes)}")

    sidecar = {
        "schema_version": 1,
        "batch_id": BATCH_ID,
        "stage": "internal",
        "generated_at": generated_at,
        "source": "Cached official National Park Service child records",
        "count": len(children),
        "places": children,
    }
    review = {
        "schema_version": 1,
        "batch_id": BATCH_ID,
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
        "batch_id": BATCH_ID,
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
    parser.add_argument("--base-catalog", default=str(DEFAULT_BASE_CATALOG))
    parser.add_argument("--source-cache", default=str(DEFAULT_SOURCE_CACHE))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUTPUT))
    return parser.parse_args()


if __name__ == "__main__":
    print(json.dumps(build(parse_args()), indent=2))
