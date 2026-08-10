#!/usr/bin/env python3
"""Build the fail-closed Roaring Fork artwork review packet.

The packet records source and visual research only. It deliberately cannot
approve, download, ingest, upload, or publish artwork. Exact downloaded bytes
and derivative evidence are added only after explicit visual approval.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REPOSITORY = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPOSITORY / "originals/smokies/roaring_fork_artwork_review_v1.json"
EDITORIAL_PATH = REPOSITORY / "originals/smokies/editorial_roaring_fork_v1.json"
PREFLIGHT_PATH = REPOSITORY / "originals/smokies/roaring_fork_trigger_preflight_v1.json"
RIGHTS_RECORD_PATH = REPOSITORY / "docs/originals/smokies-media-rights-v1.md"

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CHAPTER_ID = "roaring_fork"
VARIANT_ID = "one_way"
REVIEW_ID = "smokies_roaring_fork_artwork_review_20260809_v1"
REJECTED_VISTA_SHA256 = (
    "4a61195ac9a5d7a0dc6037cc3e3d4089def7335d1cafd2f0e20d34091d3c8011"
)

EXPECTED_ENTRY_IDS = (
    "rf_cue_02",
    "rf_story_03",
    "rf_cue_01",
    "rf_story_01",
    "rf_cue_04",
    "rf_cue_03",
    "rf_story_02",
    "rf_story_04",
    "rf_story_05",
    "rf_cue_05",
    "rf_story_06",
    "rf_story_07",
    "rf_cue_06",
)


class ArtworkReviewError(ValueError):
    """The candidate artwork packet is incomplete or stale."""


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ArtworkReviewError(f"unavailable JSON input: {path}") from error
    if not isinstance(value, dict):
        raise ArtworkReviewError(f"expected JSON object: {path}")
    return value


def _sha256_path(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as error:
        raise ArtworkReviewError(f"unavailable source input: {path}") from error


def _relative(path: Path) -> str:
    return path.relative_to(REPOSITORY).as_posix()


def _source_binding(path: Path) -> dict[str, Any]:
    return {
        "path": _relative(path),
        "sha256": _sha256_path(path),
        "byte_count": path.stat().st_size,
    }


def _candidate(
    *,
    candidate_id: str,
    subject: str,
    source_page_url: str,
    preview_url: str,
    download_url: str,
    creator: str,
    rights_basis: str,
    license_name: str,
    license_url: str,
    exact_credit: str,
    width: int,
    height: int,
    identity_basis: str,
    claim_limit: str,
    source_record: dict[str, Any],
    download_variant: str = "source_original",
    review_dimension_basis: str = "source_original_metadata",
    evidence_status: str = "source_reviewed_download_deferred",
    original_sha256: str | None = None,
    original_bytes: int | None = None,
) -> dict[str, Any]:
    return {
        "candidate_id": candidate_id,
        "status": "candidate_only_user_visual_approval_required",
        "subject": subject,
        "source_page_url": source_page_url,
        "preview_url": preview_url,
        "download_url": download_url,
        "creator": creator,
        "rights_basis": rights_basis,
        "license_name": license_name,
        "license_url": license_url,
        "exact_credit": exact_credit,
        "review_dimensions": {"width": width, "height": height},
        "review_dimension_basis": review_dimension_basis,
        "download_variant": download_variant,
        "identity_basis": identity_basis,
        "claim_limit": claim_limit,
        "source_record": source_record,
        "source_reviewed_at": "2026-08-09",
        "evidence_status": evidence_status,
        "original_sha256": original_sha256,
        "original_bytes": original_bytes,
        "user_visual_approval": False,
        "ingestion_allowed": False,
    }


def _candidates() -> list[dict[str, Any]]:
    commons = "https://commons.wikimedia.org/wiki/File:"
    upload = "https://upload.wikimedia.org/wikipedia/commons"
    cc_by = "https://creativecommons.org/licenses/by/4.0/"
    return [
        _candidate(
            candidate_id="rf_art_road",
            subject="Narrow Roaring Fork Motor Nature Trail beneath tall forest",
            source_page_url=(
                commons
                + "Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_04.jpg"
            ),
            preview_url=(
                upload
                + "/thumb/3/36/Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_04.jpg/960px-Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_04.jpg"
            ),
            download_url=(
                upload
                + "/3/36/Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_04.jpg"
            ),
            creator="Sarah Stierch (Missvain)",
            rights_basis="creator_grant_cc_by_4_0",
            license_name="CC BY 4.0",
            license_url=cc_by,
            exact_credit=(
                "Roaring Fork Motor Nature Trail, Sarah Stierch (Missvain), "
                "CC BY 4.0, via Wikimedia Commons"
            ),
            width=4_284,
            height=5_712,
            identity_basis="live_visual_review_plus_geotagged_commons_roaring_fork_record",
            claim_limit="generic_roaring_fork_road_scene_no_exact_stop_or_exit_claim",
            source_record={
                "provider": "Wikimedia Commons",
                "page_id": 146_614_434,
                "source_caption": "Roaring Fork Motor Nature Trail",
                "source_bytes": 9_641_592,
                "source_sha1": "e369769ac496c9393d3bd15d2dcd42bc733a294c",
            },
        ),
        _candidate(
            candidate_id="rf_art_stream",
            subject="Proposed stream scene along Roaring Fork Motor Nature Trail",
            source_page_url=(
                commons
                + "Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_03.jpg"
            ),
            preview_url=(
                upload
                + "/thumb/7/72/Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_03.jpg/1280px-Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_03.jpg"
            ),
            download_url=(
                upload
                + "/7/72/Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_03.jpg"
            ),
            creator="Sarah Stierch (Missvain)",
            rights_basis="creator_grant_cc_by_4_0",
            license_name="CC BY 4.0",
            license_url=cc_by,
            exact_credit=(
                "Roaring Fork Motor Nature Trail, Sarah Stierch (Missvain), "
                "CC BY 4.0, via Wikimedia Commons"
            ),
            width=5_712,
            height=4_284,
            identity_basis="live_visual_review_plus_geotagged_commons_roaring_fork_record",
            claim_limit="generic_roaring_fork_stream_scene_no_named_feature_claim",
            source_record={
                "provider": "Wikimedia Commons",
                "page_id": 146_613_898,
                "source_caption": "Roaring Fork Motor Nature Trail",
                "source_bytes": 9_146_001,
                "source_sha1": "bd05ad3d8a9f8b9fdc7e2323bc2015a4e9ace7aa",
            },
        ),
        _candidate(
            candidate_id="rf_art_forest",
            subject="Roaring Fork forest and mature tree canopy",
            source_page_url=(
                commons
                + "Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_05.jpg"
            ),
            preview_url=(
                upload
                + "/thumb/3/36/Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_05.jpg/960px-Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_05.jpg"
            ),
            download_url=(
                upload
                + "/3/36/Roaring_Fork_Motor_Nature_Trail_-_March_2024_-_Sarah_Stierch_05.jpg"
            ),
            creator="Sarah Stierch (Missvain)",
            rights_basis="creator_grant_cc_by_4_0",
            license_name="CC BY 4.0",
            license_url=cc_by,
            exact_credit=(
                "Roaring Fork Motor Nature Trail, Sarah Stierch (Missvain), "
                "CC BY 4.0, via Wikimedia Commons"
            ),
            width=3_024,
            height=4_032,
            identity_basis="live_visual_review_plus_geotagged_commons_roaring_fork_record",
            claim_limit="generic_roaring_fork_forest_scene_no_old_growth_claim",
            source_record={
                "provider": "Wikimedia Commons",
                "page_id": 146_614_435,
                "source_caption": "Roaring Fork Motor Nature Trail",
                "source_bytes": 5_401_179,
                "source_sha1": "5034c6662ecc3f6d8333b2a4623a1d640b7630a3",
            },
        ),
        _candidate(
            candidate_id="rf_art_ogle",
            subject="Exact Noah 'Bud' Ogle cabin setting",
            source_page_url=(
                commons
                + "Noah_%22Bud%22_Ogle_Cabin_-_October_2023_-_Sarah_Stierch.jpg"
            ),
            preview_url=(
                upload
                + "/thumb/4/4e/Noah_%22Bud%22_Ogle_Cabin_-_October_2023_-_Sarah_Stierch.jpg/1280px-Noah_%22Bud%22_Ogle_Cabin_-_October_2023_-_Sarah_Stierch.jpg"
            ),
            download_url=(
                upload
                + "/4/4e/Noah_%22Bud%22_Ogle_Cabin_-_October_2023_-_Sarah_Stierch.jpg"
            ),
            creator="Sarah Stierch (Missvain)",
            rights_basis="creator_grant_cc_by_4_0",
            license_name="CC BY 4.0",
            license_url=cc_by,
            exact_credit=(
                "Noah 'Bud' Ogle Cabin, October 2023, Sarah Stierch "
                "(Missvain), CC BY 4.0, via Wikimedia Commons"
            ),
            width=4_032,
            height=3_024,
            identity_basis="exact_commons_file_title_plus_live_visual_review",
            claim_limit="exact_ogle_cabin_no_claim_that_frame_shows_entire_farmstead",
            source_record={
                "provider": "Wikimedia Commons",
                "source_caption": "Noah 'Bud' Ogle Cabin",
                "source_bytes": 5_281_216,
            },
            evidence_status="existing_original_verified_candidate_only",
            original_sha256=(
                "a828bf6c6d7f2650268f67b39669b1958f80c34dd845705f60423d8a0dfea551"
            ),
            original_bytes=5_281_216,
        ),
        _candidate(
            candidate_id="rf_art_historic_cabin",
            subject="Exact rustic cabin along Roaring Fork Motor Nature Trail",
            source_page_url="https://www.loc.gov/pictures/item/2021756594/",
            preview_url=(
                "https://tile.loc.gov/storage-services/service/pnp/highsm/68300/68373v.jpg"
            ),
            download_url=(
                "https://tile.loc.gov/storage-services/master/pnp/highsm/68300/68373u.tif"
            ),
            creator="Carol M. Highsmith",
            rights_basis="public_domain_dedication_no_known_restrictions",
            license_name="Public domain; no known restrictions on publication",
            license_url="https://www.loc.gov/pictures/collection/highsm/",
            exact_credit=(
                "Carol M. Highsmith's America Project in the Carol M. Highsmith "
                "Archive, Library of Congress, Prints and Photographs Division, "
                "LC-DIG-highsm-68373"
            ),
            width=1_024,
            height=683,
            identity_basis="exact_library_of_congress_item_title_and_visual_review",
            claim_limit="generic_roaring_fork_cabin_no_structure_name_or_mill_claim",
            source_record={
                "provider": "Library of Congress",
                "record_id": "2021756594",
                "reproduction_number": "LC-DIG-highsm-68373",
                "rights_advisory": "No known restrictions on publication",
                "review_preview_url": (
                    "https://tile.loc.gov/storage-services/service/pnp/highsm/"
                    "68300/68373v.jpg"
                ),
                "review_preview_bytes": 868_394,
                "master_tiff_bytes": 141_728_100,
                "master_dimensions_status": "probe_after_visual_approval",
            },
            download_variant="loc_provider_master_tiff_68373u",
            review_dimension_basis="loc_large_service_jpeg_preview",
        ),
        _candidate(
            candidate_id="rf_art_grotto_falls",
            subject="Exact Grotto Falls on Trillium Gap Trail",
            source_page_url=(
                "https://www.nps.gov/media/photo/gallery-item.htm?"
                "gid=28FBB4C4-1DD8-B71C-07DAE9A6F3C26A2A&"
                "id=287A5AD1-1DD8-B71C-07F1BD1B3DCC532D"
            ),
            preview_url=(
                "https://www.nps.gov/npgallery/GetAsset/"
                "287a5ad1-1dd8-b71c-07f1-bd1b3dcc532d"
            ),
            download_url=(
                "https://www.nps.gov/npgallery/GetAsset/"
                "287a5ad1-1dd8-b71c-07f1-bd1b3dcc532d"
            ),
            creator="National Park Service source; photographer not supplied",
            rights_basis="public_domain_us_government_work",
            license_name="Public domain; NPS NPGallery constraint",
            license_url="https://www.nps.gov/aboutus/disclaimer.htm",
            exact_credit=(
                "Grotto Falls, Great Smoky Mountains National Park, National "
                "Park Service; no claim to original U.S. Government work"
            ),
            width=2_182,
            height=1_470,
            identity_basis="exact_nps_npgallery_title_alt_text_and_asset_id",
            claim_limit=(
                "destination_illustration_only_falls_not_visible_from_road_"
                "no_parking_or_access_availability_claim"
            ),
            source_record={
                "provider": "National Park Service NPGallery",
                "asset_id": "287a5ad1-1dd8-b71c-07f1-bd1b3dcc532d",
                "source_bytes": 1_760_245,
                "constraint": "Public domain",
                "granting_rights": "Full",
                "photo_credit": None,
            },
        ),
        _candidate(
            candidate_id="rf_art_thousand_drips",
            subject="Exact Place of 1,000 Drips beside Roaring Fork road",
            source_page_url=(
                "https://www.nps.gov/media/photo/gallery-item.htm?"
                "gid=28FBB4C4-1DD8-B71C-07DAE9A6F3C26A2A&"
                "id=29186a3a-1dd8-b71c-0713-93aab0680f34"
            ),
            preview_url=(
                "https://www.nps.gov/npgallery/GetAsset/"
                "29186a3a-1dd8-b71c-0713-93aab0680f34"
            ),
            download_url=(
                "https://www.nps.gov/npgallery/GetAsset/"
                "29186a3a-1dd8-b71c-0713-93aab0680f34"
            ),
            creator="National Park Service source; photographer not supplied",
            rights_basis="public_domain_us_government_work",
            license_name="Public domain; NPS NPGallery constraint",
            license_url="https://www.nps.gov/aboutus/disclaimer.htm",
            exact_credit=(
                "Place of 1,000 Drips, Great Smoky Mountains National Park, "
                "National Park Service; no claim to original U.S. Government work"
            ),
            width=1_489,
            height=2_180,
            identity_basis="exact_nps_npgallery_title_alt_text_and_asset_id",
            claim_limit="exact_named_feature_no_present_flow_or_parking_promise",
            source_record={
                "provider": "National Park Service NPGallery",
                "asset_id": "29186a3a-1dd8-b71c-0713-93aab0680f34",
                "source_bytes": 1_799_456,
                "constraint": "Public domain",
                "granting_rights": "Full",
                "photo_credit": None,
            },
        ),
    ]


ENTRY_TO_CANDIDATE = {
    "rf_cue_02": "rf_art_ogle",
    "rf_story_03": "rf_art_ogle",
    "rf_cue_01": "rf_art_road",
    "rf_story_01": "rf_art_road",
    "rf_cue_04": "rf_art_grotto_falls",
    "rf_cue_03": "rf_art_stream",
    "rf_story_02": "rf_art_stream",
    "rf_story_04": "rf_art_forest",
    "rf_story_05": "rf_art_historic_cabin",
    "rf_cue_05": "rf_art_thousand_drips",
    "rf_story_06": "rf_art_thousand_drips",
    "rf_story_07": "rf_art_historic_cabin",
    "rf_cue_06": "rf_art_road",
}


def build() -> dict[str, Any]:
    editorial = _load_json(EDITORIAL_PATH)
    preflight = _load_json(PREFLIGHT_PATH)
    rights_text = RIGHTS_RECORD_PATH.read_text(encoding="utf-8")

    if editorial.get("product_id") != PRODUCT_ID or editorial.get("chapter_id") != CHAPTER_ID:
        raise ArtworkReviewError("Roaring Fork editorial identity drifted")
    if any((
        preflight.get("product_id") != PRODUCT_ID,
        preflight.get("chapter_id") != CHAPTER_ID,
        preflight.get("variant_id") != VARIANT_ID,
    )):
        raise ArtworkReviewError("Roaring Fork preflight identity drifted")

    entries = editorial.get("entries")
    placements = preflight.get("entries")
    if not isinstance(entries, list) or not isinstance(placements, list):
        raise ArtworkReviewError("Roaring Fork entry evidence is unavailable")
    editorial_ids = {row.get("id") for row in entries if isinstance(row, dict)}
    placement_ids = tuple(row.get("id") for row in placements if isinstance(row, dict))
    if editorial_ids != set(EXPECTED_ENTRY_IDS) or placement_ids != EXPECTED_ENTRY_IDS:
        raise ArtworkReviewError("Roaring Fork entry inventory or order drifted")
    if set(ENTRY_TO_CANDIDATE) != set(EXPECTED_ENTRY_IDS):
        raise ArtworkReviewError("artwork mapping does not cover every entry exactly once")

    required_correction = (
        "media_rf_stream` is `rejected_identity_mismatch"
    )
    if required_correction not in rights_text or REJECTED_VISTA_SHA256 not in rights_text:
        raise ArtworkReviewError("rejected vista identity correction is missing")

    candidates = _candidates()
    candidate_ids = {row["candidate_id"] for row in candidates}
    if set(ENTRY_TO_CANDIDATE.values()) != candidate_ids:
        raise ArtworkReviewError("candidate inventory and entry mapping drifted")

    entry_titles = {
        row["id"]: row["title"]
        for row in entries
        if isinstance(row, dict) and isinstance(row.get("id"), str)
    }
    return {
        "schema_version": 1,
        "review_id": REVIEW_ID,
        "product_id": PRODUCT_ID,
        "chapter_id": CHAPTER_ID,
        "variant_id": VARIANT_ID,
        "status": "user_visual_approval_required",
        "reviewed_at": "2026-08-09",
        "review_scope": "source_rights_identity_and_proposed_entry_mapping",
        "source_bindings": [
            _source_binding(EDITORIAL_PATH),
            _source_binding(PREFLIGHT_PATH),
            _source_binding(RIGHTS_RECORD_PATH),
        ],
        "known_rejections": [
            {
                "slot_id": "media_rf_stream",
                "asset_sha256": REJECTED_VISTA_SHA256,
                "authoritative_subject": "mountain vista at stop three",
                "rejection_reason": "does_not_depict_required_stream_and_road_scene",
                "status": "rejected_identity_mismatch",
                "ingestion_allowed": False,
            }
        ],
        "candidates": candidates,
        "entry_artwork_map": [
            {
                "stable_order": index,
                "entry_id": entry_id,
                "entry_title": entry_titles[entry_id],
                "candidate_id": ENTRY_TO_CANDIDATE[entry_id],
            }
            for index, entry_id in enumerate(EXPECTED_ENTRY_IDS, start=1)
        ],
        "summary": {
            "entry_count": len(EXPECTED_ENTRY_IDS),
            "candidate_count": len(candidates),
            "mapped_exactly_once": True,
            "cc_by_4_0_candidate_count": 4,
            "public_domain_candidate_count": 3,
            "downloaded_original_candidate_count": 1,
            "download_deferred_candidate_count": 6,
        },
        "approval_gate": {
            "user_visual_approval": False,
            "original_downloads_complete": False,
            "original_hashes_complete": False,
            "licensed_derivatives_complete": False,
            "verified_upload_evidence_complete": False,
            "private_manifest_v3_artwork_binding_complete": False,
            "ingestion_allowed": False,
            "public_release": False,
            "next_action": (
                "obtain_explicit_visual_approval_then_download_and_hash_exact_originals"
            ),
        },
    }


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = serialize(build())
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Roaring Fork artwork review packet is stale; rebuild it")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
