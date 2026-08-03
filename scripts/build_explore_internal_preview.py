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
ACCEPTED_NPS_CHILD_BATCH_2 = "post-b08-nps-child-depth-b2-r7"
DEFAULT_NPS_CHILD_DIR_2 = ROOT / f"data/explore/audit_candidates/internal/{ACCEPTED_NPS_CHILD_BATCH_2}"
DEFAULT_NPS_CHILDREN_2 = DEFAULT_NPS_CHILD_DIR_2 / "nps_child_depth_v1.json"
DEFAULT_NPS_CHILD_MANIFEST_2 = DEFAULT_NPS_CHILD_DIR_2 / "manifest.json"
DEFAULT_NPS_CHILD_AUDIT_2 = DEFAULT_NPS_CHILD_DIR_2 / "audit.json"
DEFAULT_NPS_CHILD_REVIEW_2 = DEFAULT_NPS_CHILD_DIR_2 / "review.json"
ACCEPTED_NPS_CHILD_HASHES_2 = {
    "manifest.json": "523b23375b909de4752a7d98fe448dd52f5ef6d8bcb815c7d3f329d7aa348295",
    "nps_child_depth_v1.json": "16416e6fe8e9ece6de5c08787b8c284366d7dc0b4951d4819f4deb50c59a5d86",
    "audit.json": "dff1636e93c61e1f376d6b01c2a69eaea0086f3ab2454a6fcc71998bccd64468",
    "review.json": "683c6bff03b3a7a98cfe0d1315f172a6803869e4790ae18c0d17cac6572c2fef",
}
ACCEPTED_NPS_CHILD_BATCH_3 = "post-b08-nps-child-depth-b3-r5"
DEFAULT_NPS_CHILD_DIR_3 = ROOT / f"data/explore/audit_candidates/internal/{ACCEPTED_NPS_CHILD_BATCH_3}"
DEFAULT_NPS_CHILDREN_3 = DEFAULT_NPS_CHILD_DIR_3 / "nps_child_depth_v1.json"
DEFAULT_NPS_CHILD_MANIFEST_3 = DEFAULT_NPS_CHILD_DIR_3 / "manifest.json"
DEFAULT_NPS_CHILD_AUDIT_3 = DEFAULT_NPS_CHILD_DIR_3 / "audit.json"
DEFAULT_NPS_CHILD_REVIEW_3 = DEFAULT_NPS_CHILD_DIR_3 / "review.json"
ACCEPTED_NPS_CHILD_HASHES_3 = {
    "manifest.json": "565cd7db018ae5f0f7b550b50fd4fade8dd821ae823b91c1719056c63d2fdad4",
    "nps_child_depth_v1.json": "db4f0b94bcde127a903f4db9c1ef91b43d98149c72e016c2b47b8a0ce051ced5",
    "audit.json": "d811752e6975efd16a4327567340b9c8dcfff2c87130fb3729d982d77dad47a6",
    "review.json": "7ae2871be90b5e628e4a719202c45e700eaeb842e8451cbe20cc4893c687d348",
}
ACCEPTED_NPS_CHILD_BATCH_4 = "post-b09-nps-child-depth-b4-r2"
DEFAULT_NPS_CHILD_DIR_4 = ROOT / f"data/explore/audit_candidates/internal/{ACCEPTED_NPS_CHILD_BATCH_4}"
DEFAULT_NPS_CHILDREN_4 = DEFAULT_NPS_CHILD_DIR_4 / "nps_child_depth_v1.json"
DEFAULT_NPS_CHILD_MANIFEST_4 = DEFAULT_NPS_CHILD_DIR_4 / "manifest.json"
DEFAULT_NPS_CHILD_AUDIT_4 = DEFAULT_NPS_CHILD_DIR_4 / "audit.json"
DEFAULT_NPS_CHILD_REVIEW_4 = DEFAULT_NPS_CHILD_DIR_4 / "review.json"
ACCEPTED_NPS_CHILD_HASHES_4 = {
    "manifest.json": "a2c8c0b91f36f88ccf80c08f76ca5b7357fa0f445622a9939c4da55d71a52f4f",
    "nps_child_depth_v1.json": "bff4dbe3fae5a984083c366aa7711e2766bad2c220c71f49367f2d4a1aea247f",
    "audit.json": "1e29aa4f1b9e149aaf2d1b0ad61793ce636c1242525f8f560c80b56a592d07e2",
    "review.json": "60ccad3f4bf56f0664a53e4e1c54b175fc664f9dcbc75f629994fedc7cf48e99",
}
ACCEPTED_NPS_CHILD_BATCH_5 = "post-b09-nps-child-depth-b5-r1"
DEFAULT_NPS_CHILD_DIR_5 = ROOT / f"data/explore/audit_candidates/internal/{ACCEPTED_NPS_CHILD_BATCH_5}"
DEFAULT_NPS_CHILDREN_5 = DEFAULT_NPS_CHILD_DIR_5 / "nps_child_depth_v1.json"
DEFAULT_NPS_CHILD_MANIFEST_5 = DEFAULT_NPS_CHILD_DIR_5 / "manifest.json"
DEFAULT_NPS_CHILD_AUDIT_5 = DEFAULT_NPS_CHILD_DIR_5 / "audit.json"
DEFAULT_NPS_CHILD_REVIEW_5 = DEFAULT_NPS_CHILD_DIR_5 / "review.json"
ACCEPTED_NPS_CHILD_HASHES_5 = {
    "manifest.json": "d9f7ed993c23051fb53e9bf47392c057fda8fed2833f4923e2a3aeea23054150",
    "nps_child_depth_v1.json": "e3c4d0763d3a2be8d84d462dc3f892a444cb98781eea0d4227dc1b1b3b2fa0da",
    "audit.json": "d86d58c6b0f236297d3f606a1a053e61f25fe82c2ac69f0e4a339f4a84b70296",
    "review.json": "8029b3434db17daf361d353a5c1c5148977921b7faffce8cf400c90ddfb052be",
}
ACCEPTED_NPS_CHILD_CONTRACT = "post-b08-nps-child-contract-r1"
DEFAULT_NPS_CHILD_CONTRACT_DIR = (
    ROOT / f"data/explore/audit_candidates/internal/{ACCEPTED_NPS_CHILD_CONTRACT}"
)
DEFAULT_NPS_CHILD_CONTRACT = DEFAULT_NPS_CHILD_CONTRACT_DIR / "nps_child_contract_v1.json"
DEFAULT_NPS_CHILD_CONTRACT_MANIFEST = DEFAULT_NPS_CHILD_CONTRACT_DIR / "manifest.json"
DEFAULT_NPS_CHILD_CONTRACT_AUDIT = DEFAULT_NPS_CHILD_CONTRACT_DIR / "audit.json"
DEFAULT_NPS_CHILD_CONTRACT_REVIEW = DEFAULT_NPS_CHILD_CONTRACT_DIR / "review.json"
DEFAULT_NPS_CHILD_CONTRACT_DISPOSITIONS = (
    DEFAULT_NPS_CHILD_CONTRACT_DIR / "child_dispositions.json"
)
ACCEPTED_NPS_CHILD_CONTRACT_HASHES = {
    "manifest.json": "89ba6376343c593f978d05061eef47bcd9aac8bae23b0de428286bd562032e6d",
    "nps_child_contract_v1.json": "a4a6db4becb705d43351e820c7a61f8bb335dde4244a19adfcce1c384ad0046a",
    "audit.json": "01e7953e0ac50b51f047872661dd4cb97fe23c82be772c7dcb50ae070674f639",
    "review.json": "9166f08cd27aa7f141ea4f460795c891328bb978dd85dced47c8b1cdab3bcdc8",
    "child_dispositions.json": "4dc8a35e56774df88fdd2ca0aa557b8f76f91be8b73311784251d9a302591518",
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
    r"^https://(?:www\.)?recreation\.gov/"
    r"(?:camping/campgrounds|permits)/[A-Za-z0-9_-]+(?:[/?#]|$)",
    re.I,
)
APPROVED_MEDIA_RIGHTS_STATES = frozenset({
    "approved",
    "cleared",
    "licensed",
    "public_domain",
    "source_terms_reviewed",
})
ACCEPTED_BATCH_4_PREVIEW_SHA256 = (
    "ebcc92fac3a6fa7b80feb84d070fb30220ad0b783f656c2b5c38569382fc910b"
)
ACCEPTED_BATCH_4_PREVIEW_CONTENT_SHA256 = (
    "55e1a26ba8c70514eff995575a047bbccd4a159a58c4dcfa346d4407c4aa9ad0"
)
ACCEPTED_BATCH_4_DEPTH_ID_SHA256 = (
    "44eb88b7f4447a194b8164910b2369baf101cbc38ad0faef9c8fed672ceb63f5"
)
ACCEPTED_CONTRACT_ID_SHA256 = (
    "ea23a5e4f3925195febc232f76ad7bd49ecc065437c970d25b7c8735e876f76e"
)


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
    *,
    accepted_paths: tuple[Path, Path, Path, Path] | None = None,
    accepted_hashes: dict[str, str] | None = None,
    accepted_batch_id: str = "post-b08-nps-child-depth-b1",
) -> tuple[list[dict], dict]:
    """Load one immutable, audited child batch without treating it as promotable."""
    exact_paths = {
        path.resolve() for path in (accepted_paths or (
            DEFAULT_NPS_CHILDREN, DEFAULT_NPS_CHILD_MANIFEST,
            DEFAULT_NPS_CHILD_AUDIT, DEFAULT_NPS_CHILD_REVIEW,
        ))
    }
    exact_hashes = accepted_hashes or ACCEPTED_NPS_CHILD_HASHES
    for path in (child_path, manifest_path, audit_path, review_path):
        if not path.is_file():
            raise SystemExit(f"NPS child-depth artifact is missing: {path}")
        accepted_hash = exact_hashes.get(path.name) if path.resolve() in exact_paths else None
        if accepted_hash and _sha256(path) != accepted_hash:
            raise SystemExit(f"NPS child-depth accepted hash mismatch: {path.name}")
    manifest = json.loads(manifest_path.read_text())
    audit = json.loads(audit_path.read_text())
    review = json.loads(review_path.read_text())
    if any(str(item.get("batch_id") or "") != accepted_batch_id for item in (manifest, audit, review)):
        raise SystemExit("NPS child-depth batch identity differs from the accepted reviewed batch")
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


def _validated_nps_child_contract(
    contract_path: Path,
    manifest_path: Path,
    audit_path: Path,
    review_path: Path,
    dispositions_path: Path,
) -> tuple[list[dict], dict]:
    """Load the exact reviewed R1 contract without activating legacy aliases."""

    paths = (
        contract_path,
        manifest_path,
        audit_path,
        review_path,
        dispositions_path,
    )
    accepted_paths = {
        DEFAULT_NPS_CHILD_CONTRACT.resolve(),
        DEFAULT_NPS_CHILD_CONTRACT_MANIFEST.resolve(),
        DEFAULT_NPS_CHILD_CONTRACT_AUDIT.resolve(),
        DEFAULT_NPS_CHILD_CONTRACT_REVIEW.resolve(),
        DEFAULT_NPS_CHILD_CONTRACT_DISPOSITIONS.resolve(),
    }
    if {path.resolve() for path in paths} != accepted_paths:
        raise SystemExit("Internal preview accepts only the immutable R1 NPS child contract")
    for path in paths:
        if not path.is_file():
            raise SystemExit(f"NPS child contract artifact is missing: {path}")
        expected_hash = ACCEPTED_NPS_CHILD_CONTRACT_HASHES[path.name]
        if _sha256(path) != expected_hash:
            raise SystemExit(f"NPS child contract accepted hash mismatch: {path.name}")

    contract = json.loads(contract_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    audit = json.loads(audit_path.read_text())
    review = json.loads(review_path.read_text())
    dispositions = json.loads(dispositions_path.read_text())
    if (
        contract.get("schema") != "ExploreNpsChildContractV1"
        or manifest.get("schema") != "ExploreNpsChildContractManifestV1"
        or audit.get("schema") != "ExploreNpsChildContractAuditV1"
        or review.get("schema") != "ExploreNpsChildContractReviewV1"
        or dispositions.get("schema") != "ExploreNpsChildAuditDispositionsV1"
    ):
        raise SystemExit("NPS child contract schema differs from the reviewed R1 contract")
    payloads = (contract, manifest, audit, review, dispositions)
    if any(str(payload.get("contract_id") or "") != ACCEPTED_NPS_CHILD_CONTRACT for payload in payloads):
        raise SystemExit("NPS child contract identity differs from the reviewed R1 contract")
    if any(payload.get("stage") != "internal" for payload in payloads):
        raise SystemExit("NPS child contract must remain internal")
    if (
        contract.get("promotion_ready") is not False
        or manifest.get("promotion_ready") is not False
        or review.get("promotion_ready") is not False
        or manifest.get("public_promotion_compatible") is not False
        or dispositions.get("public_promotion_compatible") is not False
        or manifest.get("requests_used") != 0
        or review.get("requests_used") != 0
    ):
        raise SystemExit("NPS child contract became promotable or used live requests")
    if (
        manifest.get("live_catalog_modified") is not False
        or manifest.get("live_serving_index_modified") is not False
        or audit.get("passed") is not True
        or audit.get("errors") not in ([], None)
    ):
        raise SystemExit("NPS child contract failed its internal-only audit")

    declared = {
        str(item.get("path") or ""): item
        for item in manifest.get("artifacts") or []
        if isinstance(item, dict)
    }
    for path in (contract_path, audit_path, review_path, dispositions_path):
        entry = declared.get(path.name)
        if (
            not entry
            or str(entry.get("sha256") or "") != _sha256(path)
            or int(entry.get("bytes") or -1) != path.stat().st_size
        ):
            raise SystemExit(f"NPS child contract manifest binding differs: {path.name}")

    places = [item for item in contract.get("places") or [] if isinstance(item, dict)]
    aliases = [item for item in contract.get("legacy_aliases") or [] if isinstance(item, dict)]
    rows = [item for item in dispositions.get("rows") or [] if isinstance(item, dict)]
    ids = [str(item.get("id") or "") for item in places]
    review_counts = review.get("counts") if isinstance(review.get("counts"), dict) else {}
    identity_hashes = audit.get("identity_hashes") if isinstance(audit.get("identity_hashes"), dict) else {}
    if (
        len(places) != 236
        or int((contract.get("counts") or {}).get("materialized_places") or -1) != 236
        or int((contract.get("counts") or {}).get("new_candidate_dispositions") or -1) != 237
        or int((contract.get("counts") or {}).get("merged_duplicates") or -1) != 1
        or len(aliases) != 157
        or len(rows) != 394
        or int(dispositions.get("count") or -1) != 394
        or review_counts.get("module_counts") != {
            "see": 112, "do": 45, "stay": 49, "visitor": 31,
        }
        or review_counts.get("destination_counts") != {
            "acad": 32, "grsm": 39, "grte": 34, "grba": 31,
            "badl": 18, "arch": 19, "cany": 25, "glca": 39,
        }
        or identity_hashes != {
            "legacy": "8a6dd528b262654e97a4b98625aeb3b1f4a6d77c96bc1fd27f9d6d8052ee33e4",
            "new": "d94ee87a0ca79e476297e44d7cb2f4224599b28749ffcae9ab90c2ede631bc0c",
            "combined": "fc6ea5fc19cf4ec1b3f794902502e0a30dbc6380ff9fb7cfd5eba9dfa94b6524",
        }
        or any(not item_id for item_id in ids)
        or len(ids) != len(set(ids))
    ):
        raise SystemExit("NPS child contract count or identity scope differs")

    normalized: list[dict] = []
    for place in places:
        item = json.loads(json.dumps(place))
        if (
            item.get("canonical_role") != "child"
            or not str(item.get("parent_hub_id") or "")
            or not str(item.get("module_target") or "")
        ):
            raise SystemExit(f"NPS child contract record is not parent-bound: {item.get('id')}")
        item["hidden_from_featured"] = True
        normalized.append(item)

    return normalized, {
        "contract_id": ACCEPTED_NPS_CHILD_CONTRACT,
        "manifest_path": str(manifest_path.relative_to(ROOT)),
        "manifest_sha256": _sha256(manifest_path),
        "artifact_path": str(contract_path.relative_to(ROOT)),
        "artifact_sha256": _sha256(contract_path),
        "audit_path": str(audit_path.relative_to(ROOT)),
        "audit_sha256": _sha256(audit_path),
        "review_path": str(review_path.relative_to(ROOT)),
        "review_sha256": _sha256(review_path),
        "dispositions_path": str(dispositions_path.relative_to(ROOT)),
        "dispositions_sha256": _sha256(dispositions_path),
        "disposition_count": len(rows),
        "materialized_count": len(normalized),
        "new_disposition_count": 237,
        "merged_duplicate_count": 1,
        "legacy_alias_count": len(aliases),
        "advisory_alias_count": len(aliases),
        "active_alias_count": 0,
        "identity_hashes": identity_hashes,
        "promotion_ready": False,
        "public_promotion_compatible": False,
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


def _ordered_ids_sha256(items: list[dict]) -> str:
    payload = "\n".join(str(item.get("id") or "") for item in items) + "\n"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _append_nps_child_batch_5_to_accepted_preview(
    base_preview: Path,
    output: Path,
    *,
    validate_output: Callable[[Path], Any] | None = None,
) -> dict:
    """Append B5 to the accepted B4 sidecar without rebuilding prior evidence."""
    base_preview = base_preview.resolve()
    output = output.resolve()
    if not base_preview.is_file():
        raise FileNotFoundError(base_preview)
    if _sha256(base_preview) != ACCEPTED_BATCH_4_PREVIEW_SHA256:
        raise SystemExit("Accepted Batch 4 preview base hash differs")
    payload = json.loads(base_preview.read_text())
    canonical_payload = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    if hashlib.sha256(canonical_payload).hexdigest() != (
        ACCEPTED_BATCH_4_PREVIEW_CONTENT_SHA256
    ):
        raise SystemExit("Accepted Batch 4 preview payload hash differs")
    base_children = [
        item for item in payload.get("children") or [] if isinstance(item, dict)
    ]
    candidate = payload.get("candidate") if isinstance(payload.get("candidate"), dict) else {}
    bindings = candidate.get("nps_child_depth_batches")
    if (
        payload.get("stage") != "internal"
        or payload.get("public_promotion_compatible") is not False
        or len(base_children) != 790
        or payload.get("child_count") != 790
        or not isinstance(bindings, list)
        or len(bindings) != 4
    ):
        raise SystemExit("Accepted Batch 4 preview structure differs")
    accepted_depth = base_children[:554]
    contract_children = base_children[554:]
    if (
        len(contract_children) != 236
        or _ordered_ids_sha256(accepted_depth) != ACCEPTED_BATCH_4_DEPTH_ID_SHA256
        or _ordered_ids_sha256(contract_children) != ACCEPTED_CONTRACT_ID_SHA256
    ):
        raise SystemExit("Accepted Batch 4 preview identity boundary differs")

    child_paths_5 = (
        DEFAULT_NPS_CHILDREN_5.resolve(),
        DEFAULT_NPS_CHILD_MANIFEST_5.resolve(),
        DEFAULT_NPS_CHILD_AUDIT_5.resolve(),
        DEFAULT_NPS_CHILD_REVIEW_5.resolve(),
    )
    children_5, binding_5 = _validated_nps_child_depth(
        *child_paths_5,
        accepted_paths=child_paths_5,
        accepted_hashes=ACCEPTED_NPS_CHILD_HASHES_5,
        accepted_batch_id="post-b09-nps-child-depth-b5",
    )
    existing_ids = {str(item.get("id") or "") for item in base_children}
    batch_5_ids = {str(item.get("id") or "") for item in children_5}
    if len(children_5) != 70 or existing_ids.intersection(batch_5_ids):
        raise SystemExit("Accepted Batch 5 identities overlap the mounted child set")
    canonical_camps = [
        item for item in children_5
        if str(item.get("id") or "").startswith("place:nps:campgrounds:")
    ]
    if len(canonical_camps) != 20:
        raise SystemExit("Accepted Batch 5 canonical campground scope differs")
    for camp in canonical_camps:
        reservation_url = str(camp.get("reservation_url") or "").strip()
        reservations = camp.get("reservations") if isinstance(camp.get("reservations"), dict) else {}
        if (
            camp.get("hidden_from_featured") is not True
            or camp.get("module_target") != "stay"
            or (
                reservation_url
                and (
                    not RECREATION_BOOKING_RE.match(reservation_url)
                    or reservations.get("url") != reservation_url
                    or reservations.get("reservable") is not True
                )
            )
        ):
            raise SystemExit("Accepted Batch 5 campground handoff differs")

    combined_children = [*accepted_depth, *children_5, *contract_children]
    next_payload = json.loads(json.dumps(payload))
    next_payload["children"] = combined_children
    next_payload["child_count"] = len(combined_children)
    next_candidate = dict(candidate)
    next_candidate["nps_child_depth_batches"] = [*bindings, binding_5]
    next_payload["candidate"] = next_candidate
    _write_payload_atomically(output, next_payload, validate_output=validate_output)
    return {
        "output": str(output),
        "bytes": output.stat().st_size,
        "sha256": _sha256(output),
        "place_ids": [str(item.get("id") or "") for item in next_payload.get("places") or []],
        "child_ids": [str(item.get("id") or "") for item in combined_children],
    }


def _combine_nps_child_batches(*batches: list[dict]) -> list[dict]:
    """Preserve accepted batch order and reject cross-batch identity overlap."""
    combined = [item for batch in batches for item in batch]
    child_ids = [str(item.get("id") or "") for item in combined]
    if any(not item_id for item_id in child_ids) or len(child_ids) != len(set(child_ids)):
        raise SystemExit("Accepted NPS child-depth batches contain duplicate stable IDs")
    return combined


def _validate_nps_child_preview_mount(
    children: list[dict],
    contract_children: list[dict],
    *,
    public_parent_ids: set[str],
) -> None:
    """Fail closed on identity or parent/module drift before writing a sidecar."""
    if len(children) != 860 or len(contract_children) != 236:
        raise SystemExit("Internal NPS child mount must contain 624 depth and 236 contract records")
    source_owners: dict[str, str] = {}
    endpoint_targets = {
        "thingstodo": "do",
        "places": "see",
        "visitorcenters": "visitor",
        "campgrounds": "stay",
    }
    contract_ids = {str(item.get("id") or "") for item in contract_children}
    if contract_ids.intersection(public_parent_ids):
        raise SystemExit("Internal NPS child contract collides with a public identity")
    canonical_camps = [
        item
        for item in children
        if str(item.get("id") or "").startswith("place:nps:campgrounds:")
    ]
    if len(canonical_camps) != 20:
        raise SystemExit("Internal NPS child mount must contain 20 canonical campground shadows")
    for camp in canonical_camps:
        reference = camp.get("canonical_reference") if isinstance(camp.get("canonical_reference"), dict) else {}
        reservations = camp.get("reservations") if isinstance(camp.get("reservations"), dict) else {}
        if (
            reference.get("canonical_id") != camp.get("id")
            or not str(reference.get("source_child_id") or "").startswith("place:nps-child:")
            or camp.get("module_target") != "stay"
            or camp.get("hidden_from_featured") is not True
        ):
            raise SystemExit("Internal NPS canonical campground shadow lost its child context")
        reservation_url = str(camp.get("reservation_url") or "").strip()
        if reservation_url and (
            not RECREATION_BOOKING_RE.match(reservation_url)
            or reservations.get("url") != reservation_url
            or reservations.get("reservable") is not True
        ):
            raise SystemExit("Internal NPS canonical campground shadow lost its booking handoff")
    for item in children:
        item_id = str(item.get("id") or "").strip()
        source_pack = item.get("source_pack") if isinstance(item.get("source_pack"), dict) else {}
        source_values = [
            *(item.get("source_ids") or []),
            source_pack.get("raw_source_identity"),
            *(
                source.get("source_id")
                for source in item.get("sources") or []
                if isinstance(source, dict)
            ),
        ]
        for value in source_values:
            identity = str(value or "").strip().lower()
            if not identity:
                continue
            owner = source_owners.get(identity)
            if owner and owner != item_id:
                raise SystemExit("Internal NPS child mount contains a source-identity collision")
            source_owners[identity] = item_id
        parent_id = str(item.get("parent_hub_id") or "").strip()
        if parent_id not in public_parent_ids:
            raise SystemExit(f"Internal NPS child parent is not public: {parent_id}")
        if item_id not in contract_ids:
            continue
        match = re.search(
            r":nps-child:[^:]+:(thingstodo|places|visitorcenters|campgrounds):",
            item_id.lower(),
        )
        expected_target = endpoint_targets.get(match.group(1) if match else "")
        if not expected_target or str(item.get("module_target") or "").strip().lower() != expected_target:
            raise SystemExit(f"Internal NPS child endpoint/module mapping differs: {item_id}")


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
    accepted_preview_base = str(
        getattr(args, "accepted_preview_base", "") or ""
    ).strip()
    if accepted_preview_base:
        return _append_nps_child_batch_5_to_accepted_preview(
            Path(accepted_preview_base),
            Path(args.output),
            validate_output=validate_output,
        )
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
    child_path_2 = Path(getattr(args, "nps_children_2", DEFAULT_NPS_CHILDREN_2)).resolve()
    child_manifest_path_2 = Path(getattr(args, "nps_child_manifest_2", DEFAULT_NPS_CHILD_MANIFEST_2)).resolve()
    child_audit_path_2 = Path(getattr(args, "nps_child_audit_2", DEFAULT_NPS_CHILD_AUDIT_2)).resolve()
    child_review_path_2 = Path(getattr(args, "nps_child_review_2", DEFAULT_NPS_CHILD_REVIEW_2)).resolve()
    child_path_3 = Path(getattr(args, "nps_children_3", DEFAULT_NPS_CHILDREN_3)).resolve()
    child_manifest_path_3 = Path(getattr(args, "nps_child_manifest_3", DEFAULT_NPS_CHILD_MANIFEST_3)).resolve()
    child_audit_path_3 = Path(getattr(args, "nps_child_audit_3", DEFAULT_NPS_CHILD_AUDIT_3)).resolve()
    child_review_path_3 = Path(getattr(args, "nps_child_review_3", DEFAULT_NPS_CHILD_REVIEW_3)).resolve()
    child_path_4 = Path(getattr(args, "nps_children_4", DEFAULT_NPS_CHILDREN_4)).resolve()
    child_manifest_path_4 = Path(getattr(args, "nps_child_manifest_4", DEFAULT_NPS_CHILD_MANIFEST_4)).resolve()
    child_audit_path_4 = Path(getattr(args, "nps_child_audit_4", DEFAULT_NPS_CHILD_AUDIT_4)).resolve()
    child_review_path_4 = Path(getattr(args, "nps_child_review_4", DEFAULT_NPS_CHILD_REVIEW_4)).resolve()
    child_path_5 = Path(getattr(args, "nps_children_5", DEFAULT_NPS_CHILDREN_5)).resolve()
    child_manifest_path_5 = Path(getattr(args, "nps_child_manifest_5", DEFAULT_NPS_CHILD_MANIFEST_5)).resolve()
    child_audit_path_5 = Path(getattr(args, "nps_child_audit_5", DEFAULT_NPS_CHILD_AUDIT_5)).resolve()
    child_review_path_5 = Path(getattr(args, "nps_child_review_5", DEFAULT_NPS_CHILD_REVIEW_5)).resolve()
    child_contract_path = Path(
        getattr(args, "nps_child_contract", DEFAULT_NPS_CHILD_CONTRACT)
    ).resolve()
    child_contract_manifest_path = Path(
        getattr(args, "nps_child_contract_manifest", DEFAULT_NPS_CHILD_CONTRACT_MANIFEST)
    ).resolve()
    child_contract_audit_path = Path(
        getattr(args, "nps_child_contract_audit", DEFAULT_NPS_CHILD_CONTRACT_AUDIT)
    ).resolve()
    child_contract_review_path = Path(
        getattr(args, "nps_child_contract_review", DEFAULT_NPS_CHILD_CONTRACT_REVIEW)
    ).resolve()
    child_contract_dispositions_path = Path(
        getattr(
            args,
            "nps_child_contract_dispositions",
            DEFAULT_NPS_CHILD_CONTRACT_DISPOSITIONS,
        )
    ).resolve()
    accepted_child_paths = (
        DEFAULT_NPS_CHILDREN.resolve(), DEFAULT_NPS_CHILD_MANIFEST.resolve(),
        DEFAULT_NPS_CHILD_AUDIT.resolve(), DEFAULT_NPS_CHILD_REVIEW.resolve(),
    )
    if (child_path, child_manifest_path, child_audit_path, child_review_path) != accepted_child_paths:
        raise SystemExit("Internal preview builds accept only the immutable r7 NPS child-depth artifacts")
    accepted_child_paths_2 = (
        DEFAULT_NPS_CHILDREN_2.resolve(), DEFAULT_NPS_CHILD_MANIFEST_2.resolve(),
        DEFAULT_NPS_CHILD_AUDIT_2.resolve(), DEFAULT_NPS_CHILD_REVIEW_2.resolve(),
    )
    if (child_path_2, child_manifest_path_2, child_audit_path_2, child_review_path_2) != accepted_child_paths_2:
        raise SystemExit("Internal preview builds accept only the immutable Batch 2 r7 NPS child-depth artifacts")
    accepted_child_paths_3 = (
        DEFAULT_NPS_CHILDREN_3.resolve(), DEFAULT_NPS_CHILD_MANIFEST_3.resolve(),
        DEFAULT_NPS_CHILD_AUDIT_3.resolve(), DEFAULT_NPS_CHILD_REVIEW_3.resolve(),
    )
    if (child_path_3, child_manifest_path_3, child_audit_path_3, child_review_path_3) != accepted_child_paths_3:
        raise SystemExit("Internal preview builds accept only the immutable Batch 3 r5 NPS child-depth artifacts")
    accepted_child_paths_4 = (
        DEFAULT_NPS_CHILDREN_4.resolve(), DEFAULT_NPS_CHILD_MANIFEST_4.resolve(),
        DEFAULT_NPS_CHILD_AUDIT_4.resolve(), DEFAULT_NPS_CHILD_REVIEW_4.resolve(),
    )
    if (child_path_4, child_manifest_path_4, child_audit_path_4, child_review_path_4) != accepted_child_paths_4:
        raise SystemExit("Internal preview builds accept only the immutable Batch 4 r2 NPS child-depth artifacts")
    accepted_child_paths_5 = (
        DEFAULT_NPS_CHILDREN_5.resolve(), DEFAULT_NPS_CHILD_MANIFEST_5.resolve(),
        DEFAULT_NPS_CHILD_AUDIT_5.resolve(), DEFAULT_NPS_CHILD_REVIEW_5.resolve(),
    )
    if (child_path_5, child_manifest_path_5, child_audit_path_5, child_review_path_5) != accepted_child_paths_5:
        raise SystemExit("Internal preview builds accept only the immutable Batch 5 r1 NPS child-depth artifacts")
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
    children_2, child_binding_2 = _validated_nps_child_depth(
        child_path_2,
        child_manifest_path_2,
        child_audit_path_2,
        child_review_path_2,
        accepted_paths=accepted_child_paths_2,
        accepted_hashes=ACCEPTED_NPS_CHILD_HASHES_2,
        accepted_batch_id="post-b08-nps-child-depth-b2",
    )
    children_3, child_binding_3 = _validated_nps_child_depth(
        child_path_3,
        child_manifest_path_3,
        child_audit_path_3,
        child_review_path_3,
        accepted_paths=accepted_child_paths_3,
        accepted_hashes=ACCEPTED_NPS_CHILD_HASHES_3,
        accepted_batch_id="post-b08-nps-child-depth-b3",
    )
    children_4, child_binding_4 = _validated_nps_child_depth(
        child_path_4,
        child_manifest_path_4,
        child_audit_path_4,
        child_review_path_4,
        accepted_paths=accepted_child_paths_4,
        accepted_hashes=ACCEPTED_NPS_CHILD_HASHES_4,
        accepted_batch_id="post-b09-nps-child-depth-b4",
    )
    children_5, child_binding_5 = _validated_nps_child_depth(
        child_path_5,
        child_manifest_path_5,
        child_audit_path_5,
        child_review_path_5,
        accepted_paths=accepted_child_paths_5,
        accepted_hashes=ACCEPTED_NPS_CHILD_HASHES_5,
        accepted_batch_id="post-b09-nps-child-depth-b5",
    )
    contract_children, child_contract_binding = _validated_nps_child_contract(
        child_contract_path,
        child_contract_manifest_path,
        child_contract_audit_path,
        child_contract_review_path,
        child_contract_dispositions_path,
    )
    combined_children = _combine_nps_child_batches(
        children,
        children_2,
        children_3,
        children_4,
        children_5,
        contract_children,
    )
    _validate_nps_child_preview_mount(
        combined_children,
        contract_children,
        public_parent_ids=set(serving_by_id),
    )
    child_ids = [str(item.get("id") or "") for item in combined_children]
    payload = {
        "schema_version": 1,
        "catalog_id": "trailhead-explore-internal-preview-v1",
        "stage": "internal",
        "public_promotion_compatible": False,
        "count": len(selected),
        "child_count": len(combined_children),
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
            "nps_child_depth_batches": [
                child_binding, child_binding_2, child_binding_3, child_binding_4,
                child_binding_5,
            ],
            "nps_child_contract": child_contract_binding,
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
        "children": combined_children,
    }
    _write_payload_atomically(output, payload, validate_output=validate_output)
    return {
        "output": str(output),
        "bytes": output.stat().st_size,
        "sha256": _sha256(output),
        "place_ids": [str(item.get("id") or "") for item in selected],
        "child_ids": child_ids,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agency-catalog", default=str(DEFAULT_AGENCY))
    parser.add_argument("--agency-manifest", default=str(DEFAULT_AGENCY_MANIFEST))
    parser.add_argument("--nps-catalog", default=str(DEFAULT_NPS))
    parser.add_argument("--serving-index", default=str(DEFAULT_SERVING))
    parser.add_argument("--combined-manifest", default=str(DEFAULT_COMBINED_MANIFEST))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument(
        "--accepted-preview-base",
        help="Append accepted B5 to the exact accepted B4 internal preview sidecar.",
    )
    parser.add_argument("--nps-cache-dir", default=str(DEFAULT_NPS_CACHE))
    parser.add_argument("--nps-children", default=str(DEFAULT_NPS_CHILDREN))
    parser.add_argument("--nps-child-manifest", default=str(DEFAULT_NPS_CHILD_MANIFEST))
    parser.add_argument("--nps-child-audit", default=str(DEFAULT_NPS_CHILD_AUDIT))
    parser.add_argument("--nps-child-review", default=str(DEFAULT_NPS_CHILD_REVIEW))
    parser.add_argument("--nps-children-2", dest="nps_children_2", default=str(DEFAULT_NPS_CHILDREN_2))
    parser.add_argument("--nps-child-manifest-2", dest="nps_child_manifest_2", default=str(DEFAULT_NPS_CHILD_MANIFEST_2))
    parser.add_argument("--nps-child-audit-2", dest="nps_child_audit_2", default=str(DEFAULT_NPS_CHILD_AUDIT_2))
    parser.add_argument("--nps-child-review-2", dest="nps_child_review_2", default=str(DEFAULT_NPS_CHILD_REVIEW_2))
    parser.add_argument("--nps-children-3", dest="nps_children_3", default=str(DEFAULT_NPS_CHILDREN_3))
    parser.add_argument("--nps-child-manifest-3", dest="nps_child_manifest_3", default=str(DEFAULT_NPS_CHILD_MANIFEST_3))
    parser.add_argument("--nps-child-audit-3", dest="nps_child_audit_3", default=str(DEFAULT_NPS_CHILD_AUDIT_3))
    parser.add_argument("--nps-child-review-3", dest="nps_child_review_3", default=str(DEFAULT_NPS_CHILD_REVIEW_3))
    parser.add_argument("--nps-children-4", dest="nps_children_4", default=str(DEFAULT_NPS_CHILDREN_4))
    parser.add_argument("--nps-child-manifest-4", dest="nps_child_manifest_4", default=str(DEFAULT_NPS_CHILD_MANIFEST_4))
    parser.add_argument("--nps-child-audit-4", dest="nps_child_audit_4", default=str(DEFAULT_NPS_CHILD_AUDIT_4))
    parser.add_argument("--nps-child-review-4", dest="nps_child_review_4", default=str(DEFAULT_NPS_CHILD_REVIEW_4))
    parser.add_argument("--nps-children-5", dest="nps_children_5", default=str(DEFAULT_NPS_CHILDREN_5))
    parser.add_argument("--nps-child-manifest-5", dest="nps_child_manifest_5", default=str(DEFAULT_NPS_CHILD_MANIFEST_5))
    parser.add_argument("--nps-child-audit-5", dest="nps_child_audit_5", default=str(DEFAULT_NPS_CHILD_AUDIT_5))
    parser.add_argument("--nps-child-review-5", dest="nps_child_review_5", default=str(DEFAULT_NPS_CHILD_REVIEW_5))
    parser.add_argument("--nps-child-contract", default=str(DEFAULT_NPS_CHILD_CONTRACT))
    parser.add_argument(
        "--nps-child-contract-manifest",
        default=str(DEFAULT_NPS_CHILD_CONTRACT_MANIFEST),
    )
    parser.add_argument(
        "--nps-child-contract-audit",
        default=str(DEFAULT_NPS_CHILD_CONTRACT_AUDIT),
    )
    parser.add_argument(
        "--nps-child-contract-review",
        default=str(DEFAULT_NPS_CHILD_CONTRACT_REVIEW),
    )
    parser.add_argument(
        "--nps-child-contract-dispositions",
        default=str(DEFAULT_NPS_CHILD_CONTRACT_DISPOSITIONS),
    )
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
