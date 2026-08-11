#!/usr/bin/env python3
"""Build the deterministic, review-only Foothills Parkway packet.

The packet reproduces the exact source-locked scripts and identifies two
candidate-only artwork originals for a project-owner review. It cannot record
an approval, sanitize or ingest artwork, synthesize narration, mutate a
manifest or database, upload assets, or publish the Original.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any


REPOSITORY = Path(__file__).resolve().parents[1]
ORIGINALS = REPOSITORY / "originals/smokies"
OUTPUT_PATH = ORIGINALS / "foothills_parkway_review_packet_v1.json"
MARKDOWN_OUTPUT_PATH = (
    REPOSITORY / "docs/originals/foothills-parkway-review-sheet-v1.md"
)

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CHAPTER_ID = "foothills_parkway"
PACKET_ID = "smokies_foothills_parkway_review_20260810_v1"
SOURCE_TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"

SOURCE_PATHS = {
    "editorial": ORIGINALS / "editorial_scripts_v1.json",
    "source_dossier": ORIGINALS / "source_dossiers_v1.json",
    "route_variants": ORIGINALS / "route_variants_v1.json",
    "official_route_evidence": ORIGINALS / "official_route_evidence_v1.json",
    "media_rights": REPOSITORY / "docs/originals/smokies-media-rights-v1.md",
    "roaring_fork_private_manifest": (
        ORIGINALS / "roaring_fork_private_manifest_v3.json"
    ),
    "roaring_fork_narration_profile": (
        ORIGINALS / "roaring_fork_narration_profile_v2.json"
    ),
    "roaring_fork_delivery_readiness": (
        ORIGINALS / "roaring_fork_delivery_readiness_v2.json"
    ),
    "roaring_fork_publication_readiness": (
        ORIGINALS / "roaring_fork_publication_readiness_v1.json"
    ),
}

EXPECTED_SOURCE_SHA256 = {
    "editorial": "28627001d9b3bbd129e812721064e1a0c8fc2122ec9371afa91657026b76d81e",
    "source_dossier": "8eb22ca5110f0f9a4287b8f184624348c2a2ca2dbc36e27ef59fc022057ce18f",
    "route_variants": "49d55fa8819822b18af54983ea11893a661689102c14532a88ebacf2ec587f24",
    "official_route_evidence": "d946ffaf8f21ad97399b6dedfb5cbe9483fce0787653b389d7075d933f398c60",
    "media_rights": "53e515e3f3ce46cb9dd4c9d19be38d008ea5bb603e31a6be53bf5afdb7f0ab15",
    "roaring_fork_private_manifest": "7e9cab7e0325c6124a2605c83867929780f575e5814c7fdc634c091a9c351467",
    "roaring_fork_narration_profile": "10fd4f5f04cbfbc411a1e7c31061700d17752af61e1501a4b7b4652c0d2ee377",
    "roaring_fork_delivery_readiness": "7cf1b601d48845e3bc404a501d33a9f2c1e2567544c03347b99de0524ee923e6",
    "roaring_fork_publication_readiness": "81317b0bcdb052f1b9396fbe861aec20db3b72a9bd3f745ab5d88618ad58a199",
}

EXPECTED_STORY_IDS = tuple(f"fp_story_{index:02d}" for index in range(1, 7))
EXPECTED_CUE_IDS = tuple(f"fp_cue_{index:02d}" for index in range(1, 8))
EXPECTED_ENTRY_IDS = EXPECTED_STORY_IDS + EXPECTED_CUE_IDS
EXPECTED_CLAIM_IDS = (
    "fp_air_monitoring",
    "fp_forest_mosaic",
    "fp_geologic_view",
    "fp_long_build",
    "fp_missing_link",
    "fp_scenic_corridor",
)
EXPECTED_SOURCE_IDS = (
    "nps_grsm_air_quality",
    "nps_grsm_foothills",
    "nps_grsm_foothills_history",
    "nps_grsm_geology",
    "nps_grsm_missing_link_bridge",
    "nps_grsm_statistics",
    "nps_grsm_vegetation",
)
EXPECTED_VARIANT_IDS = ("west_to_east", "east_to_west")
EXPECTED_OVERRIDE_IDS = ("fp_cue_01", "fp_cue_05", "fp_cue_07")
EXPECTED_GEOMETRY_SHA256 = {
    "west_to_east": "3b86e6b62db0be72edd15557d3f503bfe79baa869877044a7deb4f4b487f547d",
    "east_to_west": "58a8f0322c03136efd13f0bbcf3de00aab7b270fe37211efac1c07850ea6a358",
}

EXPECTED_SUBSET_SHA256 = {
    "claims": "380df1b7a6ff9ac424aefe3da2497b9af09eb9f1dba528582cc91ce13d72d6d3",
    "dossier_entries": "362406e324e05b45dc947c30cc57d935c25934f537fe1c1baf5ad4c61c0d86cb",
    "sources": "dfa5a92ff27689e0f884245c72ae3972bba3be9c4aadfe3ae8b79d6429231294",
    "media_candidates": "1097c8f385bea1d46f115d978bfb486d46d110bcaf8707aa1662dfc96607a415",
    "editorial_entries": "928685bf6d56a77417b3ac9a02e1706055e63cea89938ff9f5505c845e1a4c0a",
    "route_variants": "32a1912f9a76f08d1b8d9c4daf684ced77e2388132d648280519196030fd0b9c",
    "route_evidence": "80ce61bec4b07641d08324f913e0c6fdb33057ccaf3c96a0e88f7eda7f138cd8",
}

ARTWORK: tuple[dict[str, Any], ...] = (
    {
        "stable_order": 1,
        "candidate_id": "media_fp_panorama",
        "intended_use": "chapter_artwork",
        "subject": "Exact Foothills Parkway ridge panorama",
        "creator": "Andrea Walton (NPS)",
        "license_name": "Public domain",
        "rights_basis": "public_domain_us_government_work",
        "asset_url": (
            "https://upload.wikimedia.org/wikipedia/commons/2/2a/"
            "Foothills_Parkway%2C_October_2018--Andrea_Walton_"
            "%2843968388000%29.jpg"
        ),
        "license_record_url": (
            "https://commons.wikimedia.org/wiki/File:Foothills_Parkway,_"
            "October_2018--Andrea_Walton_(43968388000).jpg"
        ),
        "source_page_url": "https://www.nps.gov/places/foothills-parkway.htm",
        "exact_credit": (
            "Foothills Parkway, October 2018, Andrea Walton, Great Smoky "
            "Mountains National Park (NPS), public domain"
        ),
        "identity_match": (
            "NPS photograph of the Foothills Parkway matching the exact "
            "ridge-panorama slot"
        ),
        "dimensions": {"width": 4_032, "height": 3_024},
        "original_bytes": 2_067_676,
        "original_sha256": (
            "92da599e63f7f2afabd81106d6649441b11b5406e7c94ec3ba448c643e6f19d8"
        ),
        "format": "JPEG",
        "exif_orientation": 1,
        "gps_exif_present": True,
        "device_exif_present": True,
        "exif_caveat": (
            "Original contains GPS coordinates plus Apple iPhone 7/device "
            "metadata; a separately hashed sanitized derivative is required "
            "before any later ingestion consideration."
        ),
        "local_evidence_locator": "smokies_media_s2:media_fp_panorama",
        "local_hash_verified_at_packet_build": True,
    },
    {
        "stable_order": 2,
        "candidate_id": "media_fp_engineering",
        "intended_use": "story_artwork",
        "subject": "Exact Missing Link bridge or construction scene",
        "creator": "Federal Highway Administration",
        "license_name": "Public domain",
        "rights_basis": "public_domain_us_government_work",
        "asset_url": (
            "https://upload.wikimedia.org/wikipedia/commons/5/58/"
            "Foothills_Parkway_Bridge_number_2_in_Great_Smoky_Mountains_"
            "National_Park_in_Tennessee_%2820133297129%29.jpg"
        ),
        "license_record_url": (
            "https://commons.wikimedia.org/wiki/File:Foothills_Parkway_"
            "Bridge_number_2_in_Great_Smoky_Mountains_National_Park_in_"
            "Tennessee_(20133297129).jpg"
        ),
        "source_page_url": (
            "https://www.nps.gov/grsm/learn/news/foothills-parkway-opening.htm"
        ),
        "exact_credit": (
            "Foothills Parkway Bridge number 2, Great Smoky Mountains "
            "National Park, Federal Highway Administration (FHWA), public "
            "domain"
        ),
        "identity_match": (
            "FHWA photograph of Foothills Parkway Bridge number 2 matching "
            "the exact Missing Link engineering slot"
        ),
        "dimensions": {"width": 4_320, "height": 3_240},
        "original_bytes": 1_650_379,
        "original_sha256": (
            "ed4f3bc69b7fd0f34040e3214a1633f410327c0deb3c0c04412d861760de78af"
        ),
        "format": "JPEG",
        "exif_orientation": 1,
        "gps_exif_present": False,
        "device_exif_present": True,
        "exif_caveat": (
            "Original has no GPS IFD but retains Canon device/date metadata; "
            "a separately hashed sanitized derivative is required before any "
            "later ingestion consideration."
        ),
        "local_evidence_locator": "smokies_media_s2:media_fp_engineering",
        "local_hash_verified_at_packet_build": True,
    },
)

US_GOVERNMENT_WORK_NOTICE = "No claim to original U.S. Government works."


class FoothillsReviewError(ValueError):
    """The exact review evidence is incomplete, altered, or over-authorized."""


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise FoothillsReviewError(f"unavailable source input: {path}") from error
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise FoothillsReviewError(f"unavailable JSON input: {path}") from error
    if not isinstance(value, dict):
        raise FoothillsReviewError(f"expected JSON object: {path}")
    return value


def _binding(name: str, path: Path) -> dict[str, Any]:
    actual = _sha256_path(path)
    if actual != EXPECTED_SOURCE_SHA256[name]:
        raise FoothillsReviewError(f"source binding drifted: {name}")
    try:
        display_path = path.relative_to(REPOSITORY).as_posix()
    except ValueError:
        display_path = path.as_posix()
    return {
        "path": display_path,
        "byte_count": path.stat().st_size,
        "sha256": actual,
    }


def _subset(name: str, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if _canonical_sha256(value) != EXPECTED_SUBSET_SHA256[name]:
        raise FoothillsReviewError(f"Foothills {name} subset drifted")
    return value


def _assert_editorial(
    editorial: dict[str, Any],
    dossier: dict[str, Any],
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    if editorial.get("product_id") != PRODUCT_ID:
        raise FoothillsReviewError("editorial product identity drifted")
    if editorial.get("chapter_id") != CHAPTER_ID:
        raise FoothillsReviewError("editorial chapter identity drifted")
    if editorial.get("editorial_status") != "draft_review_required":
        raise FoothillsReviewError("editorial no longer has review-only status")
    if editorial.get("dossier_sha256") != EXPECTED_SOURCE_SHA256["source_dossier"]:
        raise FoothillsReviewError("editorial dossier binding drifted")
    if editorial.get("direction_review") != {
        "base_variant_id": "west_to_east",
        "reviewed_variant_ids": ["west_to_east", "east_to_west"],
        "reviewed_entry_ids": [*EXPECTED_STORY_IDS, *EXPECTED_CUE_IDS],
    }:
        raise FoothillsReviewError("direction-review inventory drifted")

    entries = editorial.get("entries")
    if not isinstance(entries, list):
        raise FoothillsReviewError("editorial entry collection is invalid")
    entries = _subset("editorial_entries", entries)
    if tuple(row.get("id") for row in entries) != EXPECTED_ENTRY_IDS:
        raise FoothillsReviewError("editorial entry order or membership drifted")
    if [row.get("kind") for row in entries].count("story") != 6:
        raise FoothillsReviewError("expected exactly six stories")
    if [row.get("kind") for row in entries].count("cue") != 7:
        raise FoothillsReviewError("expected exactly seven cues")
    if any(row.get("script_status") != "draft_review_required" for row in entries):
        raise FoothillsReviewError("a script escaped the review-required gate")
    if any(
        not isinstance(row.get("transcript"), str) or not row["transcript"].strip()
        for row in entries
    ):
        raise FoothillsReviewError("a full review transcript is missing")

    override_ids = tuple(
        row["id"] for row in entries if row.get("variant_overrides")
    )
    if override_ids != EXPECTED_OVERRIDE_IDS:
        raise FoothillsReviewError("reverse-direction override inventory drifted")
    for row in entries:
        overrides = row.get("variant_overrides", [])
        if not isinstance(overrides, list):
            raise FoothillsReviewError("variant override collection is invalid")
        for override in overrides:
            if override.get("chapter_id") != CHAPTER_ID:
                raise FoothillsReviewError("variant override chapter drifted")
            if override.get("variant_id") != "east_to_west":
                raise FoothillsReviewError("unexpected variant override")
            if not isinstance(override.get("transcript"), str):
                raise FoothillsReviewError("variant override transcript is missing")

    if dossier.get("product_id") != PRODUCT_ID:
        raise FoothillsReviewError("source dossier product identity drifted")
    cultural = dossier.get("cultural_review")
    if not isinstance(cultural, dict):
        raise FoothillsReviewError("source dossier cultural scope is missing")
    if cultural.get("status") != "public_record_only":
        raise FoothillsReviewError("dossier cultural status drifted")
    if cultural.get("blocked_entry_ids") != []:
        raise FoothillsReviewError("Foothills cannot include blocked entries")

    claims = _subset(
        "claims",
        [
            row
            for row in dossier.get("claims", [])
            if isinstance(row, dict) and row.get("chapter_id") == CHAPTER_ID
        ],
    )
    if tuple(sorted(row.get("id") for row in claims)) != EXPECTED_CLAIM_IDS:
        raise FoothillsReviewError("public-record claim membership drifted")
    for claim in claims:
        if claim.get("status") != "source_verified":
            raise FoothillsReviewError("a Foothills claim is not source verified")
        if claim.get("cultural_gate") != "not_required":
            raise FoothillsReviewError("a culturally gated claim entered review")
        scope = claim.get("cultural_scope")
        if scope != {
            "classification": "public_record_factual",
            "collection_method": "published_public_record",
            "review_triggers": [],
        }:
            raise FoothillsReviewError("a claim escaped public-record scope")

    dossier_entries = _subset(
        "dossier_entries",
        [
            row
            for row in dossier.get("entries", [])
            if isinstance(row, dict) and row.get("chapter_id") == CHAPTER_ID
        ],
    )
    dossier_by_id = {row.get("id"): row for row in dossier_entries}
    if set(dossier_by_id) != set(EXPECTED_ENTRY_IDS):
        raise FoothillsReviewError("dossier entry membership drifted")
    for entry in entries:
        outline = dossier_by_id[entry["id"]]
        for field in ("kind", "sequence", "title", "claim_ids"):
            if entry.get(field) != outline.get(field):
                raise FoothillsReviewError(
                    f"editorial/dossier parity drifted: {entry['id']} {field}"
                )

    used_source_ids = {
        source_id for entry in entries for source_id in entry.get("source_ids", [])
    }
    if tuple(sorted(used_source_ids)) != EXPECTED_SOURCE_IDS:
        raise FoothillsReviewError("editorial source membership drifted")
    sources = _subset(
        "sources",
        [
            row
            for row in dossier.get("sources", [])
            if isinstance(row, dict) and row.get("id") in used_source_ids
        ],
    )
    if tuple(sorted(row.get("id") for row in sources)) != EXPECTED_SOURCE_IDS:
        raise FoothillsReviewError("source record membership drifted")
    if any(
        row.get("authority") != "official"
        or row.get("publisher") != "National Park Service"
        or row.get("reviewed_at") != "2026-08-05"
        or row.get("rights_status") != "reference_only"
        for row in sources
    ):
        raise FoothillsReviewError("official source policy drifted")

    media = _subset(
        "media_candidates",
        [
            row
            for row in dossier.get("media_candidates", [])
            if isinstance(row, dict) and row.get("chapter_id") == CHAPTER_ID
        ],
    )
    media_by_id = {row.get("id"): row for row in media}
    if set(media_by_id) != {row["candidate_id"] for row in ARTWORK}:
        raise FoothillsReviewError("artwork candidate membership drifted")
    if media_by_id["media_fp_panorama"].get("status") != (
        "candidate_requires_clearance"
    ):
        raise FoothillsReviewError("panorama dossier gate drifted")
    if media_by_id["media_fp_engineering"].get("status") != (
        "exact_asset_not_selected"
    ):
        raise FoothillsReviewError("engineering dossier gate drifted")
    return entries, claims, dossier_entries, sources, media


def _assert_routes(
    route_spec: dict[str, Any],
    route_evidence: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if route_spec.get("product_id") != PRODUCT_ID:
        raise FoothillsReviewError("route-spec product identity drifted")
    if route_spec.get("expected_variant_count") != 6:
        raise FoothillsReviewError("full-product route count drifted")
    variants = _subset(
        "route_variants",
        [
            row
            for row in route_spec.get("variants", [])
            if isinstance(row, dict) and row.get("chapter_id") == CHAPTER_ID
        ],
    )
    if tuple(row.get("variant_id") for row in variants) != EXPECTED_VARIANT_IDS:
        raise FoothillsReviewError("Foothills route variants drifted")
    first, second = variants
    if first.get("reverse_pair_id") != second.get("id"):
        raise FoothillsReviewError("west-to-east reverse-pair binding drifted")
    if second.get("reverse_pair_id") != first.get("id"):
        raise FoothillsReviewError("east-to-west reverse-pair binding drifted")
    first_anchors = [row.get("id") for row in first.get("anchors", [])]
    second_anchors = [row.get("id") for row in second.get("anchors", [])]
    if first_anchors != list(reversed(second_anchors)) or len(first_anchors) != 5:
        raise FoothillsReviewError("route anchor reversal drifted")

    if route_evidence.get("product_id") != PRODUCT_ID:
        raise FoothillsReviewError("route-evidence product identity drifted")
    if route_evidence.get("publication_status") != "blocked":
        raise FoothillsReviewError("route evidence unexpectedly authorizes publication")
    evidence = _subset(
        "route_evidence",
        [
            row
            for row in route_evidence.get("variants", [])
            if isinstance(row, dict) and row.get("chapter_id") == CHAPTER_ID
        ],
    )
    if tuple(row.get("variant_id") for row in evidence) != EXPECTED_VARIANT_IDS:
        raise FoothillsReviewError("official route evidence membership drifted")
    for row in evidence:
        variant_id = row["variant_id"]
        if row.get("status") != "official_geometry_candidate":
            raise FoothillsReviewError("route evidence status drifted")
        if row.get("geometry_ready_for_editorial_cues") is not True:
            raise FoothillsReviewError("route geometry is not ready for cue review")
        if row.get("blocking_issues") != []:
            raise FoothillsReviewError("route geometry acquired a blocking issue")
        if row.get("geometry_sha256") != EXPECTED_GEOMETRY_SHA256[variant_id]:
            raise FoothillsReviewError("route geometry identity drifted")
        if row.get("distance_m") != 50_816.7:
            raise FoothillsReviewError("route distance drifted")
    return variants, evidence


def _assert_roaring_fork_protection(documents: dict[str, dict[str, Any]]) -> dict[str, Any]:
    manifest = documents["roaring_fork_private_manifest"]
    profile = documents["roaring_fork_narration_profile"]
    delivery = documents["roaring_fork_delivery_readiness"]
    readiness = documents["roaring_fork_publication_readiness"]

    if manifest.get("schema_version") != 3 or len(manifest.get("assets", [])) != 20:
        raise FoothillsReviewError("protected Roaring Fork manifest drifted")
    asset_kinds = [row.get("kind") for row in manifest.get("assets", [])]
    if asset_kinds.count("narration") != 13 or asset_kinds.count("image") != 7:
        raise FoothillsReviewError("protected Roaring Fork asset inventory drifted")
    if profile.get("schema_version") != 2 or profile.get("provider") != "elevenlabs":
        raise FoothillsReviewError("protected Roaring Fork narration profile drifted")
    if delivery.get("evidence_id") != "smokies_roaring_fork_delivery_v2":
        raise FoothillsReviewError("protected Roaring Fork delivery identity drifted")

    accepted = readiness.get("accepted_private_evidence")
    if accepted != {
        "aggregate_asset_bytes": 239_772_665,
        "artwork_count": 7,
        "current_asset_count": 20,
        "delivery_contract_sha256": "9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6",
        "device_preview_evidence_canonical_sha256": "f17ac77a29718cef56ccb2556e44e86800d81482fd0e9cca18acb2537722f750",
        "evidence_class": "historical_s4r_production_readback",
        "live_database_rechecked_by_builder": False,
        "narration_count": 13,
        "narration_profile_canonical_sha256": "f79b386031ca0faf6e07332e53ea037f957eb7d9871c4bbf05d5b0aff09c2af5",
        "observed_at": "2026-08-11T01:33:56Z",
        "private_manifest_canonical_sha256": "2fb77582811e28ef963f3018a8990a96612cfedee69f3b2329a73b87ac99d33a",
        "profiled_manifest_canonical_sha256": "14d83293ba3b09aad00998668311447b5224f5172e641d35163de2865e3c9eb8",
        "published_version_count": 0,
    }:
        raise FoothillsReviewError("protected S4R evidence drifted")
    trusted = readiness.get("trusted_private_validation")
    if trusted != {
        "current_at_s4r_readback": True,
        "engine": "original-trigger-v3",
        "evidence_class": "historical_s4r_production_readback",
        "issues": [],
        "live_report_rechecked_by_builder": False,
        "must_rerun_after_final_manifest_or_source_change": True,
        "publication_approval": False,
        "redacted_report_sha256": "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059",
        "report_id": "original_validation_9df694c93ee9ef3809c33f451d04bf28",
        "route_scenarios_passed": 13,
        "route_scenarios_required": 13,
        "selection": "roaring_fork_one_way_private_v1:one_way",
        "source_commit": "111a4eb7cc8bb21ac1bbdd3418b1dbec4ca90637",
        "status": "passed",
    }:
        raise FoothillsReviewError("protected trusted-validation identity drifted")
    if readiness.get("prior_product_contract") != {
        "changing_scope_or_price_requires_separate_product_decision": True,
        "chapter_ids": [
            "mountain_crossing",
            "little_river_cades_cove",
            "roaring_fork",
            "foothills_parkway",
        ],
        "explorer_included": True,
        "pack_scope": "one_premium_four_chapter_product",
        "permanent_credit_price": 900,
        "standalone_roaring_fork_public_product_approved": False,
    }:
        raise FoothillsReviewError("protected product contract drifted")
    return {
        "status": "preserved_unchanged_and_excluded_from_this_review",
        "private_manifest_file_sha256": EXPECTED_SOURCE_SHA256[
            "roaring_fork_private_manifest"
        ],
        "draft_revision": readiness.get("scope", {}).get("draft_revision"),
        **accepted,
        "trusted_private_validation": trusted,
    }


def _artwork_review_rows(media: list[dict[str, Any]], rights_text: str) -> list[dict[str, Any]]:
    media_by_id = {row["id"]: row for row in media}
    rows: list[dict[str, Any]] = []
    for artwork in ARTWORK:
        candidate_id = artwork["candidate_id"]
        if artwork["original_sha256"] not in rights_text:
            raise FoothillsReviewError(f"rights hash missing: {candidate_id}")
        if f"### {candidate_id} " not in rights_text:
            raise FoothillsReviewError(f"rights detail missing: {candidate_id}")
        dossier_row = media_by_id[candidate_id]
        if dossier_row.get("subject") != artwork["subject"]:
            raise FoothillsReviewError(f"artwork subject drifted: {candidate_id}")
        if dossier_row.get("intended_use") != artwork["intended_use"]:
            raise FoothillsReviewError(f"artwork intended use drifted: {candidate_id}")
        rows.append(
            {
                **artwork,
                "status": "candidate_only_user_visual_approval_required",
                "dossier_status": dossier_row["status"],
                "existing_original_evidence": "hash_bound_review_copy_only",
                "required_commercial_notice": US_GOVERNMENT_WORK_NOTICE,
                "user_visual_approval": False,
                "sanitized_derivative_complete": False,
                "ingestion_allowed": False,
                "rendering_allowed": False,
                "upload_allowed": False,
                "publication_allowed": False,
            }
        )
    return rows


def build() -> dict[str, Any]:
    bindings = {
        name: _binding(name, path) for name, path in SOURCE_PATHS.items()
    }
    documents = {
        name: _load_json(path)
        for name, path in SOURCE_PATHS.items()
        if path.suffix == ".json"
    }
    entries, claims, dossier_entries, sources, media = _assert_editorial(
        documents["editorial"], documents["source_dossier"]
    )
    variants, route_evidence = _assert_routes(
        documents["route_variants"], documents["official_route_evidence"]
    )
    protected = _assert_roaring_fork_protection(documents)
    rights_text = SOURCE_PATHS["media_rights"].read_text(encoding="utf-8")
    artwork = _artwork_review_rows(media, rights_text)

    scripts = []
    for stable_order, entry in enumerate(entries, start=1):
        transcript = entry["transcript"]
        scripts.append(
            {
                **entry,
                "stable_order": stable_order,
                "transcript_sha256": hashlib.sha256(
                    transcript.encode("utf-8")
                ).hexdigest(),
                "decision_status": "user_approve_or_revise_required",
                "rendering_allowed": False,
            }
        )

    route_summary = []
    evidence_by_variant = {row["variant_id"]: row for row in route_evidence}
    for variant in variants:
        evidence = evidence_by_variant[variant["variant_id"]]
        route_summary.append(
            {
                "variant_id": variant["variant_id"],
                "route_spec_id": variant["id"],
                "reverse_pair_id": variant["reverse_pair_id"],
                "anchor_ids": [row["id"] for row in variant["anchors"]],
                "distance_m": evidence["distance_m"],
                "geometry_sha256": evidence["geometry_sha256"],
                "status": evidence["status"],
                "geometry_ready_for_editorial_cues": True,
                "publication_evidence": False,
            }
        )

    return {
        "schema_version": 1,
        "packet_id": PACKET_ID,
        "kind": "original_chapter_review_only",
        "product_id": PRODUCT_ID,
        "chapter_id": CHAPTER_ID,
        "status": "explicit_script_and_artwork_decisions_required",
        "recorded_from_task_id": SOURCE_TASK_ID,
        "source_bindings": bindings,
        "subset_bindings": EXPECTED_SUBSET_SHA256,
        "product_contract": {
            "pack_scope": "one_premium_four_chapter_product",
            "chapter_ids": [
                "mountain_crossing",
                "little_river_cades_cove",
                "roaring_fork",
                "foothills_parkway",
            ],
            "permanent_credit_price": 900,
            "credit_type": "earned_credits",
            "explorer_included": True,
            "standalone_roaring_fork_public_product_approved": False,
            "standalone_foothills_public_product_approved": False,
            "changing_scope_or_price_requires_separate_product_decision": True,
        },
        "review_scope": {
            "chapter_id": CHAPTER_ID,
            "script_count": 13,
            "story_count": 6,
            "cue_count": 7,
            "variant_ids": list(EXPECTED_VARIANT_IDS),
            "reverse_override_entry_ids": list(EXPECTED_OVERRIDE_IDS),
            "artwork_candidate_count": 2,
            "other_chapters_approved": False,
        },
        "public_record_scope": {
            "claim_count": len(claims),
            "claim_ids": [row["id"] for row in claims],
            "claim_set_sha256": EXPECTED_SUBSET_SHA256["claims"],
            "classification": "public_record_factual",
            "collection_method": "published_public_record",
            "culturally_gated_claim_count": 0,
            "blocked_entry_count": 0,
            "external_outreach_required": False,
        },
        "claims": claims,
        "dossier_entries": dossier_entries,
        "official_sources": sources,
        "route_review_context": {
            "status": "official_geometry_candidate_for_editorial_review_only",
            "full_product_variant_count": 6,
            "foothills_variant_count": 2,
            "route_evidence_publication_status": "blocked",
            "variants": route_summary,
        },
        "scripts": scripts,
        "artwork_candidates": artwork,
        "protected_roaring_fork_evidence": protected,
        "decision_gate": {
            "script_decisions_recorded": False,
            "artwork_visual_decisions_recorded": False,
            "artwork_status": "candidate_only",
            "other_chapters_approved": False,
            "artwork_sanitation_allowed": False,
            "artwork_sanitation_complete": False,
            "artwork_ingestion_allowed": False,
            "narrator_selected_for_foothills": False,
            "tts_or_render_authorized": False,
            "narration_generated": False,
            "manifest_creation_or_mutation_allowed": False,
            "upload_allowed": False,
            "database_accessed": False,
            "network_accessed_by_builder": False,
            "production_mutation_allowed": False,
            "public_release": False,
            "publication_allowed": False,
            "next_action": (
                "collect_explicit_approve_or_revise_decisions_for_all_"
                "thirteen_scripts_and_both_artwork_candidates"
            ),
        },
    }


def verify_artwork_evidence(
    evidence_roots: tuple[Path, ...],
    artwork: tuple[dict[str, Any], ...] = ARTWORK,
) -> dict[str, Any]:
    if not evidence_roots:
        raise FoothillsReviewError("at least one artwork evidence root is required")
    verified_copy_count = 0
    for row in artwork:
        candidate_id = row["candidate_id"]
        candidate_names = (candidate_id, f"{candidate_id}.jpg")
        for root in evidence_roots:
            matches = [root / name for name in candidate_names if (root / name).is_file()]
            if len(matches) != 1:
                raise FoothillsReviewError(
                    f"expected one evidence copy for {candidate_id} in supplied root"
                )
            path = matches[0]
            if path.stat().st_size != row["original_bytes"]:
                raise FoothillsReviewError(
                    f"artwork byte count drifted: {candidate_id}"
                )
            if _sha256_path(path) != row["original_sha256"]:
                raise FoothillsReviewError(f"artwork SHA-256 drifted: {candidate_id}")
            verified_copy_count += 1
    return {
        "verified_candidate_count": len(artwork),
        "verified_copy_count": verified_copy_count,
        "verified_original_bytes": sum(row["original_bytes"] for row in artwork),
        "copies_match": True,
        "ingestion_allowed": False,
    }


def default_evidence_roots() -> tuple[Path, ...]:
    configured = os.environ.get("SMOKIES_MEDIA_EVIDENCE_ROOTS", "").strip()
    if configured:
        return tuple(Path(value) for value in configured.split(os.pathsep) if value)
    return (Path.home() / ".openclaw/evidence/smokies-media-s2/originals",)


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def render_markdown(value: dict[str, Any]) -> str:
    lines = [
        "# Foothills Parkway review sheet v1",
        "",
        "Status: **review only - explicit decisions required**",
        "",
        (
            "This sheet contains the exact 13 source-locked scripts and two "
            "candidate-only artwork originals. Checking a box records review "
            "intent only; it does not sanitize or ingest artwork, authorize "
            "narration, create a manifest, upload anything, or publish."
        ),
        "",
        "## Product boundary",
        "",
        "- One premium four-chapter bundle: Mountain Crossing; Little River / Cades Cove; Roaring Fork; Foothills Parkway",
        "- Permanent price: 900 earned credits",
        "- Explorer access: included",
        "- Standalone Roaring Fork or Foothills product: not approved",
        "- Other chapters approved by this sheet: no",
        "",
        "## Artwork candidates",
        "",
    ]
    for row in value["artwork_candidates"]:
        lines.extend(
            [
                f"### Artwork {row['stable_order']}: {row['candidate_id']}",
                "",
                "Decision: [ ] Approve exact candidate  [ ] Revise: ____________________",
                "",
                f"- Subject: {row['subject']}",
                f"- Intended use: {row['intended_use']}",
                f"- Creator: {row['creator']}",
                f"- Rights: {row['license_name']} ({row['rights_basis']})",
                f"- Required commercial notice: `{row['required_commercial_notice']}`",
                f"- Exact credit: {row['exact_credit']}",
                f"- Identity basis: {row['identity_match']}",
                f"- Source asset: {row['asset_url']}",
                f"- License record: {row['license_record_url']}",
                f"- Dimensions: {row['dimensions']['width']} x {row['dimensions']['height']}",
                f"- Bytes: {row['original_bytes']}",
                f"- SHA-256: `{row['original_sha256']}`",
                f"- Local evidence locator: `{row['local_evidence_locator']}`",
                f"- Local hash verified at packet build: {str(row['local_hash_verified_at_packet_build']).lower()}",
                f"- EXIF caveat: {row['exif_caveat']}",
                "- Gate: candidate only; visual approval false; sanitation, ingestion, rendering, upload, and publication all false",
                "",
            ]
        )

    lines.extend(["## Script review", ""])
    sources = {row["id"]: row for row in value["official_sources"]}
    for row in value["scripts"]:
        lines.extend(
            [
                f"### Script {row['stable_order']}: {row['title']} (`{row['id']}`, {row['kind']})",
                "",
                "Decision: [ ] Approve exact script  [ ] Revise: ____________________",
                "",
                f"Claims: {', '.join(f'`{item}`' for item in row['claim_ids'])}",
                "",
                "Sources:",
                "",
            ]
        )
        for source_id in row["source_ids"]:
            source = sources[source_id]
            lines.append(f"- [{source['title']}]({source['url']}) (`{source_id}`)")
        lines.extend(["", "Exact transcript:", "", row["transcript"], ""])
        for override in row.get("variant_overrides", []):
            lines.extend(
                [
                    f"East-to-west override (`{override['variant_id']}`):",
                    "",
                    override["transcript"],
                    "",
                ]
            )
            if override.get("title"):
                lines.extend([f"Override title: {override['title']}", ""])
        lines.extend([f"Transcript SHA-256: `{row['transcript_sha256']}`", ""])

    lines.extend(
        [
            "## Stop boundary",
            "",
            "After decisions are recorded, stop. This review does not authorize artwork sanitation or ingestion, TTS or narration rendering, manifest work, uploads, production changes, or publication.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument(
        "--markdown-output",
        type=Path,
        default=MARKDOWN_OUTPUT_PATH,
    )
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify-evidence", action="store_true")
    parser.add_argument(
        "--evidence-root",
        action="append",
        type=Path,
        default=[],
        help="Local evidence root; repeat to verify mirrors without serializing paths",
    )
    args = parser.parse_args()

    value = build()
    rendered_json = serialize(value)
    rendered_markdown = render_markdown(value)
    if args.verify_evidence:
        roots = tuple(args.evidence_root) or default_evidence_roots()
        verify_artwork_evidence(roots)
    if args.check:
        if not args.output.is_file() or args.output.read_text(
            encoding="utf-8"
        ) != rendered_json:
            raise SystemExit("Foothills review packet is stale; rebuild it")
        if not args.markdown_output.is_file() or args.markdown_output.read_text(
            encoding="utf-8"
        ) != rendered_markdown:
            raise SystemExit("Foothills review sheet is stale; rebuild it")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered_json, encoding="utf-8")
    args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
    args.markdown_output.write_text(rendered_markdown, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
