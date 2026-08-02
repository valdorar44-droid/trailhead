#!/usr/bin/env python3
"""Build the small, reviewed Explore sidecar used by admin preview bundles.

This does not alter the public serving index. It copies exact candidate records
that have already passed their source-specific audit into a bounded artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.explore_sources.nps.media_rights import normalize_selected_nps_places
ACCEPTED_AGENCY_REVISION = "live-20260801-b08-operational-r8"
ACCEPTED_NPS_REVISION = "live-20260731-b08"
ACCEPTED_COMBINED_REVISION = "live-20260801-b08-operational-r8"
DEFAULT_AGENCY = ROOT / f"data/explore/audit_candidates/agencies/{ACCEPTED_AGENCY_REVISION}/explore_catalog_v3.json"
DEFAULT_AGENCY_MANIFEST = ROOT / f"data/explore/audit_candidates/agencies/{ACCEPTED_AGENCY_REVISION}/manifest.json"
DEFAULT_NPS = ROOT / f"data/explore/audit_candidates/combined/{ACCEPTED_NPS_REVISION}/nps_catalog_scoped.json"
DEFAULT_SERVING = ROOT / f"data/explore/audit_candidates/combined/{ACCEPTED_COMBINED_REVISION}/serving_index_review.json"
DEFAULT_COMBINED_MANIFEST = ROOT / f"data/explore/audit_candidates/combined/{ACCEPTED_COMBINED_REVISION}/manifest.json"
DEFAULT_COMBINED_CATALOG_REVIEW = ROOT / f"data/explore/audit_candidates/combined/{ACCEPTED_COMBINED_REVISION}/catalog_merge_review.json"
DEFAULT_COMBINED_PROMOTION_REVIEW = ROOT / f"data/explore/audit_candidates/combined/{ACCEPTED_COMBINED_REVISION}/promotion_review.json"
DEFAULT_OUTPUT = ROOT / "dashboard/explore_internal_preview_v1.json"
DEFAULT_NPS_CACHE = ROOT / "data/explore/source_cache/nps"
ACCEPTED_NPS_CHILD_BATCH = "post-b08-nps-child-depth-b1-r7"
DEFAULT_NPS_CHILD_DIR = ROOT / f"data/explore/audit_candidates/internal/{ACCEPTED_NPS_CHILD_BATCH}"
DEFAULT_NPS_CHILDREN = DEFAULT_NPS_CHILD_DIR / "nps_child_depth_v1.json"
DEFAULT_NPS_CHILD_MANIFEST = DEFAULT_NPS_CHILD_DIR / "manifest.json"
DEFAULT_NPS_CHILD_AUDIT = DEFAULT_NPS_CHILD_DIR / "audit.json"
DEFAULT_NPS_CHILD_REVIEW = DEFAULT_NPS_CHILD_DIR / "review.json"
ACCEPTED_NPS_CHILD_HASHES = {
    "manifest.json": "6956e4b8bdc238501feee49215470e6d0a8785be31188fbddcc2abe7c196266d",
    "nps_child_depth_v1.json": "66abda311a4734cc05bf3b4d9c99834cd5d3ec119e5a295e68b6cb7a3199ade9",
    "audit.json": "b5fc24c29e376a20d694c339d23c636c3937092669e52d998795a0981d251923",
    "review.json": "8ecfe03c074dd0da8a753693db801651d73b08610af82a009a7fcde1b376aee1",
}
DEFAULT_AGENCY_IDS = (
    "place:usfs:9006",
    "place:blm:moab-field-office",
    "place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8",
    "place:usfs:usfs-sierra-sites-5f618db8-3fe8-4011-a735-18a738acfb43",
    "place:usfs:usfs-sierra-sites-b01b7bab-bef1-45a7-a0f5-8707be86d2ba",
    "place:usfs:usfs-sierra-sites-307b30f3-9f42-4aa4-8de0-fe6eb125d8e2",
    "place:usfs:usfs-sierra-sites-1089761d-6a96-47fa-b575-6b69bd7c1772",
)
DEFAULT_NPS_CODES = ("cave", "cato", "chis", "goga", "grte", "gumo")
RECREATION_BOOKING_RE = re.compile(
    r"^https://(?:www\.)?recreation\.gov/camping/campgrounds/[A-Za-z0-9_-]+(?:[/?#]|$)",
    re.I,
)
APPROVED_MEDIA_RIGHTS_STATES = frozenset({
    "approved",
    "cleared",
    "licensed",
    "public_domain",
    "source_terms_reviewed",
})


def _read_catalog(path: Path) -> list[dict]:
    payload = json.loads(path.read_text())
    return [item for item in payload.get("places") or [] if isinstance(item, dict)]


def _read_serving_index(path: Path) -> dict[str, dict]:
    payload = json.loads(path.read_text())
    return {
        str(item.get("id") or ""): item
        for item in payload.get("items") or []
        if isinstance(item, dict) and item.get("id")
    }


def _validated_manifest_artifact(
    manifest_path: Path,
    artifact_path: Path,
    *,
    require_final_promotion: bool = True,
) -> dict:
    """Bind a candidate input to a promotion-ready immutable manifest entry."""
    manifest = json.loads(manifest_path.read_text())
    if require_final_promotion:
        if manifest.get("promotion_ready") is not True:
            raise SystemExit(f"Candidate manifest is not promotion-ready: {manifest_path}")
    elif manifest.get("catalog_gate_passed") is not True:
        raise SystemExit(f"Candidate manifest has not passed its catalog gate: {manifest_path}")
    if manifest.get("live_serving_index_modified") is not False:
        raise SystemExit(f"Candidate manifest altered the live serving index: {manifest_path}")
    try:
        repo_relative_artifact = artifact_path.relative_to(ROOT).as_posix()
    except ValueError as exc:
        raise SystemExit(f"Candidate artifact is outside the Trailhead repository: {artifact_path}") from exc
    relative_artifact = (
        artifact_path.relative_to(manifest_path.parent).as_posix()
        if manifest_path.parent in artifact_path.parents
        else ""
    )
    entry = next(
        (
            item
            for item in manifest.get("artifacts") or []
            if isinstance(item, dict)
            and str(item.get("path") or "") in {relative_artifact, repo_relative_artifact}
        ),
        None,
    )
    if not entry:
        entry = next(
            (
                item
                for item in (manifest.get("inputs") or {}).values()
                if isinstance(item, dict) and str(item.get("path") or "") == repo_relative_artifact
            ),
            None,
        )
    if not entry:
        raise SystemExit(f"Candidate manifest does not declare {repo_relative_artifact}: {manifest_path}")
    actual_hash = _sha256(artifact_path)
    if str(entry.get("sha256") or "") != actual_hash:
        raise SystemExit(f"Candidate artifact hash does not match its manifest: {artifact_path}")
    if int(entry.get("bytes") or -1) != artifact_path.stat().st_size:
        raise SystemExit(f"Candidate artifact size does not match its manifest: {artifact_path}")
    return {
        "path": str(manifest_path.relative_to(ROOT)),
        "sha256": _sha256(manifest_path),
        "artifact_path": repo_relative_artifact,
        "artifact_sha256": actual_hash,
    }


def _merge_serving_context(place: dict, serving: dict | None) -> dict:
    """Add cross-agency media/source facts without replacing reviewed V3 copy."""
    merged = json.loads(json.dumps(place))
    if not serving:
        return merged

    image_url = str(serving.get("image_url") or "").strip()
    image_credit = str(serving.get("image_credit") or "").strip()
    image_license = str(serving.get("image_license") or "").strip()
    image_source_url = str(serving.get("image_source_url") or "").strip()
    image_rights_state = str(serving.get("image_rights_state") or "").strip().casefold()
    image_is_reviewed = bool(
        image_url.startswith("https://")
        and image_credit
        and image_license
        and image_source_url.startswith("https://")
        and image_rights_state in APPROVED_MEDIA_RIGHTS_STATES
    )
    if image_is_reviewed:
        media = [item for item in merged.get("media") or [] if isinstance(item, dict)]
        if not any(str(item.get("url") or "") == image_url for item in media):
            media_record = {
                "url": image_url,
                "caption": str(merged.get("name") or serving.get("title") or ""),
                "credit": image_credit,
                "license": image_license,
                "source_url": image_source_url,
            }
            media_record["rights_state"] = image_rights_state
            if "image_ai_modified" in serving:
                media_record["ai_modified"] = serving.get("image_ai_modified")
            media.insert(0, media_record)
        merged["media"] = media

    sources = [item for item in merged.get("sources") or [] if isinstance(item, dict)]
    seen = {
        (str(item.get("source") or "").casefold(), str(item.get("source_id") or "").casefold())
        for item in sources
    }
    provenance = serving.get("provenance") if isinstance(serving.get("provenance"), dict) else {}
    for source in provenance.get("sources") or []:
        if not isinstance(source, dict):
            continue
        key = (str(source.get("source") or "").casefold(), str(source.get("source_id") or "").casefold())
        if not all(key) or key in seen:
            continue
        seen.add(key)
        sources.append({
            "source": source.get("source"),
            "source_id": source.get("source_id"),
            "url": source.get("url"),
            "license": source.get("license"),
            "attribution": source.get("attribution"),
            "quality": source.get("quality"),
        })
    merged["sources"] = sources

    reservation_available = any(
        isinstance(fact, dict)
        and str(fact.get("key") or "") == "reservations"
        and str(fact.get("value") or "").casefold() == "available"
        for fact in serving.get("planning_facts") or []
    )
    reservations = dict(merged.get("reservations") or {})
    booking_candidates = [str(reservations.get("url") or reservations.get("reservation_url") or "").strip()]
    booking_candidates.extend(
        str(source.get("url") or "").strip()
        for source in provenance.get("sources") or []
        if isinstance(source, dict)
    )
    direct_booking = next((url for url in booking_candidates if RECREATION_BOOKING_RE.match(url)), "")
    if reservation_available and direct_booking:
        reservations["reservable"] = True
        reservations["url"] = direct_booking
        reservations["reservation_url"] = direct_booking
        merged["reservations"] = reservations
    return merged


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validated_nps_child_depth(
    child_path: Path,
    manifest_path: Path,
    audit_path: Path,
    review_path: Path,
) -> tuple[list[dict], dict]:
    """Load one immutable, audited child batch without treating it as promotable."""
    accepted_paths = {
        DEFAULT_NPS_CHILDREN.resolve(), DEFAULT_NPS_CHILD_MANIFEST.resolve(),
        DEFAULT_NPS_CHILD_AUDIT.resolve(), DEFAULT_NPS_CHILD_REVIEW.resolve(),
    }
    for path in (child_path, manifest_path, audit_path, review_path):
        if not path.is_file():
            raise SystemExit(f"NPS child-depth artifact is missing: {path}")
        accepted_hash = ACCEPTED_NPS_CHILD_HASHES.get(path.name) if path.resolve() in accepted_paths else None
        if accepted_hash and _sha256(path) != accepted_hash:
            raise SystemExit(f"NPS child-depth accepted hash mismatch: {path.name}")
    manifest = json.loads(manifest_path.read_text())
    audit = json.loads(audit_path.read_text())
    review = json.loads(review_path.read_text())
    if any(str(item.get("batch_id") or "") != "post-b08-nps-child-depth-b1" for item in (manifest, audit, review)):
        raise SystemExit("NPS child-depth batch identity differs from accepted r7")
    if manifest.get("promotion_ready") is not False or review.get("promotion_ready") is not False:
        raise SystemExit("NPS child-depth batch must remain an internal, non-promotable candidate")
    for payload in (manifest, review):
        if payload.get("live_serving_index_modified") is not False:
            raise SystemExit("NPS child-depth batch altered the live serving index")
        if payload.get("live_catalog_modified") not in {None, False}:
            raise SystemExit("NPS child-depth batch altered the live catalog")
    if audit.get("passed") is not True or audit.get("errors") not in ([], None):
        raise SystemExit("NPS child-depth audit did not pass")
    declared = {
        str(item.get("path") or ""): item
        for item in manifest.get("artifacts") or []
        if isinstance(item, dict)
    }
    for path in (child_path, audit_path, review_path):
        entry = declared.get(path.name)
        if not entry or str(entry.get("sha256") or "") != _sha256(path):
            raise SystemExit(f"NPS child-depth manifest hash mismatch: {path.name}")
        if int(entry.get("bytes") or -1) != path.stat().st_size:
            raise SystemExit(f"NPS child-depth manifest size mismatch: {path.name}")
    payload = json.loads(child_path.read_text())
    children = [item for item in payload.get("places") or [] if isinstance(item, dict)]
    ids = [str(item.get("id") or "") for item in children]
    if (
        payload.get("stage") != "internal"
        or int(payload.get("count") or -1) != len(children)
        or int(audit.get("count") or -1) != len(children)
        or not children
        or any(not item_id for item_id in ids)
        or len(ids) != len(set(ids))
    ):
        raise SystemExit("NPS child-depth candidate has invalid count or stable identities")
    normalized: list[dict] = []
    for child in children:
        item = json.loads(json.dumps(child))
        if str(item.get("canonical_role") or "") != "child" or not str(item.get("parent_hub_id") or ""):
            raise SystemExit(f"NPS child-depth record is not parent-bound: {item.get('id')}")
        item["hidden_from_featured"] = True
        normalized.append(item)
    return normalized, {
        "batch_id": str(payload.get("batch_id") or manifest.get("batch_id") or ""),
        "manifest_path": str(manifest_path.relative_to(ROOT)),
        "manifest_sha256": _sha256(manifest_path),
        "artifact_path": str(child_path.relative_to(ROOT)),
        "artifact_sha256": _sha256(child_path),
        "audit_path": str(audit_path.relative_to(ROOT)),
        "audit_sha256": _sha256(audit_path),
        "review_path": str(review_path.relative_to(ROOT)),
        "review_sha256": _sha256(review_path),
        "promotion_ready": False,
        "live_serving_index_modified": False,
        "audit_passed": True,
    }


def _write_payload_atomically(
    output: Path,
    payload: dict[str, Any],
    *,
    validate_output: Callable[[Path], Any] | None = None,
) -> None:
    """Validate a same-directory temporary file before replacing the sidecar."""
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix=f".{output.name}.",
            suffix=".tmp",
            dir=output.parent,
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        if validate_output is not None:
            validate_output(temporary_path)
        os.replace(temporary_path, output)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _select_records(
    agency_places: list[dict],
    nps_places: list[dict],
    *,
    agency_ids: tuple[str, ...],
    nps_codes: tuple[str, ...],
) -> list[dict]:
    agency_by_id = {str(item.get("id") or ""): item for item in agency_places}
    nps_by_code = {
        str((item.get("source_pack") or {}).get("nps_park_code") or "").lower(): item
        for item in nps_places
    }
    missing_agencies = [item_id for item_id in agency_ids if item_id not in agency_by_id]
    missing_nps = [code for code in nps_codes if code not in nps_by_code]
    if missing_agencies or missing_nps:
        raise SystemExit(
            f"Missing reviewed records: agency={missing_agencies or 'none'} nps={missing_nps or 'none'}"
        )
    selected = [agency_by_id[item_id] for item_id in agency_ids]
    selected.extend(nps_by_code[code] for code in nps_codes)
    ids = [str(item.get("id") or "") for item in selected]
    if len(ids) != len(set(ids)):
        raise SystemExit("Internal preview records must have unique stable IDs")
    return selected


def build(
    args: argparse.Namespace,
    *,
    validate_output: Callable[[Path], Any] | None = None,
) -> dict:
    agency_path = Path(args.agency_catalog).resolve()
    agency_manifest_path = Path(args.agency_manifest).resolve()
    nps_path = Path(args.nps_catalog).resolve()
    serving_path = Path(args.serving_index).resolve()
    combined_manifest_path = Path(args.combined_manifest).resolve()
    combined_catalog_review_path = combined_manifest_path.parent / "catalog_merge_review.json"
    combined_promotion_review_path = combined_manifest_path.parent / "promotion_review.json"
    output = Path(args.output).resolve()
    child_path = Path(getattr(args, "nps_children", DEFAULT_NPS_CHILDREN)).resolve()
    child_manifest_path = Path(getattr(args, "nps_child_manifest", DEFAULT_NPS_CHILD_MANIFEST)).resolve()
    child_audit_path = Path(getattr(args, "nps_child_audit", DEFAULT_NPS_CHILD_AUDIT)).resolve()
    child_review_path = Path(getattr(args, "nps_child_review", DEFAULT_NPS_CHILD_REVIEW)).resolve()
    accepted_child_paths = (
        DEFAULT_NPS_CHILDREN.resolve(), DEFAULT_NPS_CHILD_MANIFEST.resolve(),
        DEFAULT_NPS_CHILD_AUDIT.resolve(), DEFAULT_NPS_CHILD_REVIEW.resolve(),
    )
    if (child_path, child_manifest_path, child_audit_path, child_review_path) != accepted_child_paths:
        raise SystemExit("Internal preview builds accept only the immutable r7 NPS child-depth artifacts")
    agency_binding = _validated_manifest_artifact(agency_manifest_path, agency_path)
    nps_binding = _validated_manifest_artifact(
        combined_manifest_path,
        nps_path,
        require_final_promotion=False,
    )
    serving_binding = _validated_manifest_artifact(
        combined_manifest_path,
        serving_path,
        require_final_promotion=False,
    )
    combined_catalog_binding = _validated_manifest_artifact(
        combined_manifest_path,
        combined_catalog_review_path,
        require_final_promotion=False,
    )
    combined_promotion_binding = _validated_manifest_artifact(
        combined_manifest_path,
        combined_promotion_review_path,
        require_final_promotion=False,
    )
    selected = _select_records(
        _read_catalog(agency_path),
        _read_catalog(nps_path),
        agency_ids=tuple(args.agency_id),
        nps_codes=tuple(code.lower() for code in args.nps_code),
    )
    serving_by_id = _read_serving_index(serving_path)
    selected = [_merge_serving_context(item, serving_by_id.get(str(item.get("id") or ""))) for item in selected]
    selected = normalize_selected_nps_places(
        selected,
        cache_dir=Path(args.nps_cache_dir).resolve(),
        evidence_root=ROOT,
    )
    children, child_binding = _validated_nps_child_depth(
        child_path,
        child_manifest_path,
        child_audit_path,
        child_review_path,
    )
    payload = {
        "schema_version": 1,
        "catalog_id": "trailhead-explore-internal-preview-v1",
        "stage": "internal",
        "count": len(selected),
        "child_count": len(children),
        "candidate": {
            "agency_revision": agency_path.parent.name,
            "nps_revision": nps_path.parent.name,
            "combined_revision": combined_manifest_path.parent.name,
            "agency_manifest": agency_binding,
            "combined_manifest": {
                "path": str(combined_manifest_path.relative_to(ROOT)),
                "sha256": _sha256(combined_manifest_path),
                "artifacts": {
                    "nps_catalog": nps_binding,
                    "serving_index": serving_binding,
                    "catalog_merge_review": combined_catalog_binding,
                    "promotion_review": combined_promotion_binding,
                },
            },
            "nps_child_depth": child_binding,
        },
        "sources": {
            "agency_catalog": {
                "path": str(agency_path.relative_to(ROOT)),
                "sha256": _sha256(agency_path),
                "revision": agency_path.parent.name,
            },
            "nps_catalog": {
                "path": str(nps_path.relative_to(ROOT)),
                "sha256": _sha256(nps_path),
                "revision": nps_path.parent.name,
            },
            "serving_index": {
                "path": str(serving_path.relative_to(ROOT)),
                "sha256": _sha256(serving_path),
                "revision": combined_manifest_path.parent.name,
            },
        },
        "places": selected,
        "children": children,
    }
    _write_payload_atomically(output, payload, validate_output=validate_output)
    return {
        "output": str(output),
        "bytes": output.stat().st_size,
        "sha256": _sha256(output),
        "place_ids": [str(item.get("id") or "") for item in selected],
        "child_ids": [str(item.get("id") or "") for item in children],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agency-catalog", default=str(DEFAULT_AGENCY))
    parser.add_argument("--agency-manifest", default=str(DEFAULT_AGENCY_MANIFEST))
    parser.add_argument("--nps-catalog", default=str(DEFAULT_NPS))
    parser.add_argument("--serving-index", default=str(DEFAULT_SERVING))
    parser.add_argument("--combined-manifest", default=str(DEFAULT_COMBINED_MANIFEST))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--nps-cache-dir", default=str(DEFAULT_NPS_CACHE))
    parser.add_argument("--nps-children", default=str(DEFAULT_NPS_CHILDREN))
    parser.add_argument("--nps-child-manifest", default=str(DEFAULT_NPS_CHILD_MANIFEST))
    parser.add_argument("--nps-child-audit", default=str(DEFAULT_NPS_CHILD_AUDIT))
    parser.add_argument("--nps-child-review", default=str(DEFAULT_NPS_CHILD_REVIEW))
    parser.add_argument("--agency-id", action="append", default=list(DEFAULT_AGENCY_IDS))
    parser.add_argument("--nps-code", action="append", default=list(DEFAULT_NPS_CODES))
    return parser.parse_args()


def _validate_default_candidate(path: Path) -> None:
    from scripts.qa_explore_b08_internal_candidate import audit

    audit(path)


if __name__ == "__main__":
    parsed_args = parse_args()
    validator = (
        _validate_default_candidate
        if Path(parsed_args.output).resolve() == DEFAULT_OUTPUT.resolve()
        else None
    )
    print(json.dumps(build(parsed_args, validate_output=validator), indent=2))
