#!/usr/bin/env python3
"""Validate the bounded b08 Explore sidecar without touching live data."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import math
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
ACCEPTED_AGENCY_REVISION = "live-20260801-b08-operational-r8"
ACCEPTED_NPS_REVISION = "live-20260731-b08"
ACCEPTED_COMBINED_REVISION = "live-20260801-b08-operational-r8"
EXPECTED_CANDIDATE = {
    "agency_revision": ACCEPTED_AGENCY_REVISION,
    "nps_revision": ACCEPTED_NPS_REVISION,
    "combined_revision": ACCEPTED_COMBINED_REVISION,
    "agency_manifest_path": f"data/explore/audit_candidates/agencies/{ACCEPTED_AGENCY_REVISION}/manifest.json",
    "agency_manifest_sha256": "5be23a802d14e17be42ad779b9fee2dc7367ec91a56191464f147401c5a5dcc2",
    "agency_catalog_path": f"data/explore/audit_candidates/agencies/{ACCEPTED_AGENCY_REVISION}/explore_catalog_v3.json",
    "agency_catalog_sha256": "d10520fed581a8e55b81d732f31e6ce2cbc7fca7a7cf8bafc1760a898f5a4308",
    "combined_manifest_path": f"data/explore/audit_candidates/combined/{ACCEPTED_COMBINED_REVISION}/manifest.json",
    "combined_manifest_sha256": "c0bb0cb923ff1879f4fac76a68cd6ea60dfc46fbf22aa86ac4b16a01e1b627fe",
    "nps_catalog_path": f"data/explore/audit_candidates/combined/{ACCEPTED_NPS_REVISION}/nps_catalog_scoped.json",
    "nps_catalog_sha256": "fe3d69a8de7426ab22a20a8cf04f2bfdc00558e21651c548ddbb334073e66b46",
    "serving_index_path": f"data/explore/audit_candidates/combined/{ACCEPTED_COMBINED_REVISION}/serving_index_review.json",
    "serving_index_sha256": "6d4efc2fb3ff4e34a1d5474b6d0aa5ca0e9c80b1a6f8f6ea67a8fe27b000aa20",
    "catalog_merge_review_path": f"data/explore/audit_candidates/combined/{ACCEPTED_COMBINED_REVISION}/catalog_merge_review.json",
    "catalog_merge_review_sha256": "ff90754558de6a57974c46a29ea5fcb56691968564411e22b55951fd5f5af1e5",
    "promotion_review_path": f"data/explore/audit_candidates/combined/{ACCEPTED_COMBINED_REVISION}/promotion_review.json",
    "promotion_review_sha256": "dfca76c582eddc2e9da057ef5cb07c6305c49f67c55421a1040cfcb4f5d81526",
}
EXPECTED_NPS_CHILD_BINDING = {
    "batch_id": "post-b08-nps-child-depth-b1",
    "manifest_path": "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b1-r7/manifest.json",
    "manifest_sha256": "6956e4b8bdc238501feee49215470e6d0a8785be31188fbddcc2abe7c196266d",
    "artifact_path": "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b1-r7/nps_child_depth_v1.json",
    "artifact_sha256": "66abda311a4734cc05bf3b4d9c99834cd5d3ec119e5a295e68b6cb7a3199ade9",
    "audit_path": "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b1-r7/audit.json",
    "audit_sha256": "b5fc24c29e376a20d694c339d23c636c3937092669e52d998795a0981d251923",
    "review_path": "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b1-r7/review.json",
    "review_sha256": "8ecfe03c074dd0da8a753693db801651d73b08610af82a009a7fcde1b376aee1",
}


EXPECTED_IDS = (
    "place:usfs:9006",
    "place:blm:moab-field-office",
    "place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8",
    "place:usfs:usfs-sierra-sites-5f618db8-3fe8-4011-a735-18a738acfb43",
    "place:usfs:usfs-sierra-sites-b01b7bab-bef1-45a7-a0f5-8707be86d2ba",
    "place:usfs:usfs-sierra-sites-307b30f3-9f42-4aa4-8de0-fe6eb125d8e2",
    "place:usfs:usfs-sierra-sites-1089761d-6a96-47fa-b575-6b69bd7c1772",
    "place:nps:cave",
    "place:nps:cato",
    "place:nps:chis",
    "place:nps:goga",
    "place:nps:grte",
    "place:nps:gumo",
)
REPLACEMENT_IDS = frozenset(EXPECTED_IDS[2:7])
FORBIDDEN_COPY = re.compile(
    r"\bOPEN\b|\b05,\s*Sierra|approximately1|\s['’]s\b|daysMaximum|"
    r"â€”|â€“|â€™|â€œ|â€|Â|ï¿½|�|"
    r"(?i:\b(?:API endpoint|database dump|raw record|provider slug|"
    r"Check official source or local rules|Verify access)\b)",
)
LINK_KEYS = frozenset({
    "url",
    "href",
    "link",
    "source_url",
    "source_page_url",
    "official_url",
    "booking_url",
    "reservation_url",
    "website_url",
})
MEDIA_COLLECTION_KEYS = frozenset({"media", "photos", "images"})
APPROVED_MEDIA_RIGHTS_STATES = frozenset({
    "approved",
    "cleared",
    "licensed",
    "public_domain",
    "source_terms_reviewed",
})
AI_FLAG_KEYS = frozenset({
    "ai_modified",
    "modified_by_ai",
    "ai_generated",
    "generated_by_ai",
    "is_ai",
    "is_synthetic",
})
AI_METHOD_KEYS = frozenset({"modification_method", "edit_method", "generation_method", "provenance_method"})
URL_IN_TEXT_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
UNSAFE_HOST_SUFFIXES = (".local", ".internal", ".localhost", ".cms.nps.doi.net")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _valid_coordinates(place: dict[str, Any]) -> bool:
    try:
        lat = float(place.get("lat"))
        lng = float(place.get("lng"))
    except (TypeError, ValueError):
        return False
    return math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180


def _is_https_public_url(value: str) -> bool:
    parsed = urlsplit(value.strip())
    host = (parsed.hostname or "").strip().rstrip(".").casefold()
    if (
        parsed.scheme.casefold() != "https"
        or not host
        or host == "localhost"
        or host == "cms.nps.doi.net"
        or host.endswith(UNSAFE_HOST_SUFFIXES)
    ):
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return "." in host


def _is_source_page(value: str) -> bool:
    if not _is_https_public_url(value):
        return False
    parsed = urlsplit(value.strip())
    return bool(parsed.path and parsed.path != "/") or bool(parsed.query)


def _iter_links(value: Any, path: str = "place"):
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            normalized_key = str(key).casefold()
            if isinstance(child, str) and (
                normalized_key in LINK_KEYS or normalized_key.endswith("_url")
            ) and child.strip():
                yield child_path, child.strip()
            elif isinstance(child, str):
                for index, match in enumerate(URL_IN_TEXT_RE.finditer(child)):
                    yield f"{child_path}#url[{index}]", match.group(0).rstrip(".,;:!?)]:")
            else:
                yield from _iter_links(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _iter_links(child, f"{path}[{index}]")


def _iter_media(value: Any, path: str = "place"):
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if str(key).casefold() in MEDIA_COLLECTION_KEYS and isinstance(child, list):
                for index, media in enumerate(child):
                    if isinstance(media, dict):
                        yield f"{child_path}[{index}]", media
            yield from _iter_media(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _iter_media(child, f"{path}[{index}]")


def _media_is_explicitly_ai_modified(media: dict[str, Any]) -> bool:
    for key in AI_FLAG_KEYS:
        value = media.get(key)
        if value is True or str(value or "").strip().casefold() in {"1", "true", "yes", "ai", "generated", "modified"}:
            return True
    for key in AI_METHOD_KEYS:
        value = str(media.get(key) or "").strip().casefold()
        if value and ("artificial intelligence" in value or re.search(r"\bai\b", value)):
            return True
    return False


def _reader_copy(place: dict[str, Any]) -> str:
    values: list[Any] = [
        place.get("name"),
        place.get("description"),
        place.get("summary"),
        place.get("card"),
        place.get("access"),
        place.get("region"),
    ]
    values.extend(
        {"label": fact.get("label"), "value": fact.get("value")}
        for fact in place.get("planning_facts") or []
        if isinstance(fact, dict)
    )
    return json.dumps(values, ensure_ascii=False)


def _manifest_declared_hash(manifest: dict[str, Any], artifact_path: str) -> str:
    for item in manifest.get("artifacts") or []:
        if isinstance(item, dict) and str(item.get("path") or "") == artifact_path:
            return str(item.get("sha256") or "")
    for item in (manifest.get("inputs") or {}).values():
        if isinstance(item, dict) and str(item.get("path") or "") == artifact_path:
            return str(item.get("sha256") or "")
    return ""


def _validate_candidate_binding(
    payload: dict[str, Any],
    failures: list[str],
    *,
    root: Path,
    expected: dict[str, str],
) -> None:
    candidate = payload.get("candidate") if isinstance(payload.get("candidate"), dict) else {}
    sources = payload.get("sources") if isinstance(payload.get("sources"), dict) else {}
    if candidate.get("agency_revision") != expected["agency_revision"]:
        failures.append("sidecar is not bound to the accepted agency revision")
    if candidate.get("nps_revision") != expected["nps_revision"]:
        failures.append("sidecar is not bound to the accepted NPS revision")
    if candidate.get("combined_revision") != expected["combined_revision"]:
        failures.append("sidecar is not bound to the accepted combined revision")

    agency_manifest = candidate.get("agency_manifest") if isinstance(candidate.get("agency_manifest"), dict) else {}
    combined_manifest = candidate.get("combined_manifest") if isinstance(candidate.get("combined_manifest"), dict) else {}
    expected_entries = (
        ("agency_catalog", "agency_catalog_path", "agency_catalog_sha256"),
        ("nps_catalog", "nps_catalog_path", "nps_catalog_sha256"),
        ("serving_index", "serving_index_path", "serving_index_sha256"),
    )
    for source_key, path_key, hash_key in expected_entries:
        source = sources.get(source_key) if isinstance(sources.get(source_key), dict) else {}
        if source.get("path") != expected[path_key] or source.get("sha256") != expected[hash_key]:
            failures.append(f"{source_key}: sidecar source path/hash differs from the accepted candidate")
        expected_revision = {
            "agency_catalog": expected["agency_revision"],
            "nps_catalog": expected["nps_revision"],
            "serving_index": expected["combined_revision"],
        }[source_key]
        if source.get("revision") != expected_revision:
            failures.append(f"{source_key}: sidecar source revision differs from the accepted candidate")
        source_path = root / expected[path_key]
        if not source_path.is_file() or _sha256(source_path) != expected[hash_key]:
            failures.append(f"{source_key}: accepted source artifact is missing or changed on disk")

    if (
        agency_manifest.get("path") != expected["agency_manifest_path"]
        or agency_manifest.get("sha256") != expected["agency_manifest_sha256"]
        or agency_manifest.get("artifact_sha256") != expected["agency_catalog_sha256"]
    ):
        failures.append("agency manifest binding differs from the accepted candidate")
    if (
        combined_manifest.get("path") != expected["combined_manifest_path"]
        or combined_manifest.get("sha256") != expected["combined_manifest_sha256"]
    ):
        failures.append("combined manifest binding differs from the accepted candidate")

    for manifest_path_key, manifest_hash_key, require_final_promotion, artifacts in (
        ("agency_manifest_path", "agency_manifest_sha256", True, {"explore_catalog_v3.json": expected["agency_catalog_sha256"]}),
        (
            "combined_manifest_path",
            "combined_manifest_sha256",
            False,
            {
                expected["nps_catalog_path"]: expected["nps_catalog_sha256"],
                "serving_index_review.json": expected["serving_index_sha256"],
                "catalog_merge_review.json": expected["catalog_merge_review_sha256"],
                "promotion_review.json": expected["promotion_review_sha256"],
            },
        ),
    ):
        manifest_path = root / expected[manifest_path_key]
        if not manifest_path.is_file() or _sha256(manifest_path) != expected[manifest_hash_key]:
            failures.append(f"{manifest_path_key}: accepted manifest is missing or changed on disk")
            continue
        manifest = json.loads(manifest_path.read_text())
        ready = (
            manifest.get("promotion_ready") is True
            if require_final_promotion
            else manifest.get("catalog_gate_passed") is True
        )
        if not ready or manifest.get("live_serving_index_modified") is not False:
            failures.append(f"{manifest_path_key}: manifest is not a safe review candidate")
        for artifact_path, artifact_hash in artifacts.items():
            if _manifest_declared_hash(manifest, artifact_path) != artifact_hash:
                failures.append(f"{manifest_path_key}: {artifact_path} hash is not declared by the manifest")

    combined_artifacts = combined_manifest.get("artifacts") if isinstance(combined_manifest.get("artifacts"), dict) else {}
    for key, expected_hash in (
        ("nps_catalog", expected["nps_catalog_sha256"]),
        ("serving_index", expected["serving_index_sha256"]),
        ("catalog_merge_review", expected["catalog_merge_review_sha256"]),
        ("promotion_review", expected["promotion_review_sha256"]),
    ):
        binding = combined_artifacts.get(key) if isinstance(combined_artifacts.get(key), dict) else {}
        if binding.get("artifact_sha256") != expected_hash:
            failures.append(f"combined manifest {key} binding differs from the accepted candidate")

    expected_agency_catalog = expected["agency_catalog_path"]
    expected_agency_serving = str(Path(expected_agency_catalog).with_name("serving_index_merged_review.json"))
    for review_path_key, review_hash_key, source_key, expected_source in (
        ("catalog_merge_review_path", "catalog_merge_review_sha256", "agency", expected_agency_catalog),
        ("promotion_review_path", "promotion_review_sha256", "agency_merged", expected_agency_serving),
    ):
        review_path = root / expected[review_path_key]
        if not review_path.is_file() or _sha256(review_path) != expected[review_hash_key]:
            failures.append(f"{review_path_key}: combined review is missing or changed on disk")
            continue
        review = json.loads(review_path.read_text())
        review_sources = review.get("sources") if isinstance(review.get("sources"), dict) else {}
        source = review_sources.get(source_key)
        source_path = str(source.get("path") or "") if isinstance(source, dict) else str(source or "")
        if source_path != expected_source:
            failures.append(
                f"{review_path_key}: combined review is not aligned to {expected['agency_revision']}"
            )


def audit(
    path: Path,
    *,
    root: Path = ROOT,
    expected: dict[str, str] = EXPECTED_CANDIDATE,
) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    places = [item for item in payload.get("places") or [] if isinstance(item, dict)]
    children = [item for item in payload.get("children") or [] if isinstance(item, dict)]
    failures: list[str] = []
    _validate_candidate_binding(payload, failures, root=root, expected=expected)
    ids = tuple(str(item.get("id") or "") for item in places)
    if payload.get("schema_version") != 1 or payload.get("stage") != "internal":
        failures.append("sidecar schema or stage is not internal v1")
    if payload.get("count") != len(places):
        failures.append("declared count does not match place count")
    if ids != EXPECTED_IDS:
        failures.append("place IDs or deterministic order do not match the reviewed b08 set")
    if len(ids) != len(set(ids)):
        failures.append("duplicate stable IDs")
    if children or "child_count" in payload:
        child_ids = [str(item.get("id") or "") for item in children]
        binding = (payload.get("candidate") or {}).get("nps_child_depth") or {}
        if payload.get("child_count") != len(children) or len(children) != 156:
            failures.append("NPS child count differs from the accepted 156-record batch")
        if any(not item_id for item_id in child_ids) or len(child_ids) != len(set(child_ids)):
            failures.append("NPS children lack unique stable IDs")
        if any(
            str(item.get("canonical_role") or "") != "child"
            or not str(item.get("parent_hub_id") or "")
            or item.get("hidden_from_featured") is not True
            for item in children
        ):
            failures.append("NPS children are not parent-bound and hidden from Featured")
        for key, expected_hash in EXPECTED_NPS_CHILD_BINDING.items():
            if binding.get(key) != expected_hash:
                failures.append(f"NPS child binding {key} differs from accepted r7")
        if (
            binding.get("promotion_ready") is not False
            or binding.get("live_serving_index_modified") is not False
            or binding.get("audit_passed") is not True
        ):
            failures.append("NPS child binding is not an audited internal-only candidate")

    for place in [*places, *children]:
        place_id = str(place.get("id") or "")
        if not _valid_coordinates(place):
            failures.append(f"{place_id}: invalid coordinates")
        checked_at = int(place.get("checked_at") or place.get("updated_at") or place.get("last_seen_at") or 0)
        if checked_at <= 0:
            failures.append(f"{place_id}: missing freshness timestamp")
        sources = [item for item in place.get("sources") or [] if isinstance(item, dict)]
        if not sources:
            failures.append(f"{place_id}: missing source attribution")
        for source in sources:
            if not _is_https_public_url(str(source.get("url") or "")):
                failures.append(f"{place_id}: source URL is not HTTPS")
            if not str(source.get("attribution") or "").strip():
                failures.append(f"{place_id}: source attribution is empty")
            if not str(source.get("license") or "").strip():
                failures.append(f"{place_id}: source license is empty")
        for link_path, link in _iter_links(place, place_id):
            if not _is_https_public_url(link):
                failures.append(f"{link_path}: nested link is not public HTTPS")
        for media_path, media in _iter_media(place, place_id):
            if not _is_https_public_url(str(media.get("url") or "")):
                failures.append(f"{media_path}: media URL is not public HTTPS")
            if not str(media.get("credit") or "").strip() or not str(media.get("license") or "").strip():
                failures.append(f"{media_path}: media lacks exact credit or license")
            rights = media.get("rights") if isinstance(media.get("rights"), dict) else {}
            rights_state = str(media.get("rights_state") or rights.get("state") or "").strip().casefold()
            if rights_state not in APPROVED_MEDIA_RIGHTS_STATES:
                failures.append(f"{media_path}: media rights state is not explicitly approved")
            source_page = str(
                media.get("source_page_url")
                or media.get("source_url")
                or rights.get("source_page_url")
                or rights.get("source_url")
                or ""
            ).strip()
            if not _is_source_page(source_page):
                failures.append(f"{media_path}: media lacks public source-page evidence")
            if _media_is_explicitly_ai_modified(media):
                failures.append(f"{media_path}: explicitly AI-modified media is excluded")
        if FORBIDDEN_COPY.search(_reader_copy(place)):
            failures.append(f"{place_id}: reader-facing copy contains a raw or malformed value")

        if place_id.startswith("place:usfs:"):
            facts = {
                str(fact.get("key") or ""): str(fact.get("value") or "").strip()
                for fact in place.get("planning_facts") or []
                if isinstance(fact, dict)
            }
            display_region = str(place.get("region") or facts.get("area") or "").strip()
            if not display_region or FORBIDDEN_COPY.search(display_region):
                failures.append(f"{place_id}: USFS region is not reader-facing")
            display_status = str(place.get("access") or facts.get("access") or "").strip()
            if display_status and (display_status.isupper() or "_" in display_status):
                failures.append(f"{place_id}: USFS status is not reader-facing")

        if place_id in REPLACEMENT_IDS:
            facts = {
                str(fact.get("key") or ""): str(fact.get("value") or "")
                for fact in place.get("planning_facts") or []
                if isinstance(fact, dict)
            }
            if facts.get("area") != "Sierra National Forest, US" or facts.get("access") != "Open":
                failures.append(f"{place_id}: campground area/access facts are not reader-facing")
            reservations = place.get("reservations") if isinstance(place.get("reservations"), dict) else {}
            reservation_url = str(reservations.get("url") or reservations.get("reservation_url") or "").strip()
            if reservations.get("reservable") is True and not re.match(
                r"^https://(?:www\.)?recreation\.gov/camping/campgrounds/",
                reservation_url,
                re.I,
            ):
                failures.append(f"{place_id}: reservable campground lacks a direct Recreation.gov booking URL")
            providers = {str(source.get("source") or "") for source in sources}
            if not {"usfs", "ridb"}.issubset(providers):
                failures.append(f"{place_id}: cross-agency provenance was not preserved")
            # A source replacement may keep an exact, reviewed image, but media
            # is never required for promotion.  When redistribution evidence is
            # absent, the product intentionally uses its clean text fallback.

    if failures:
        unique_failures = list(dict.fromkeys(failures))
        displayed = unique_failures[:80]
        if len(unique_failures) > len(displayed):
            displayed.append(f"... {len(unique_failures) - len(displayed)} additional promotion-gate failures")
        raise SystemExit("\n".join(displayed))
    return {
        "path": str(path),
        "sha256": _sha256(path),
        "count": len(places),
        "child_count": len(children),
        "replacement_count": len(REPLACEMENT_IDS),
        "nps_count": sum(place_id.startswith("place:nps:") for place_id in ids),
        "passed": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    print(json.dumps(audit(parser.parse_args().path.resolve()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
