#!/usr/bin/env python3
"""Build the fail-closed Roaring Fork publication-readiness packet.

The packet is deliberately network-free and database-free.  It records the
exact private R2/S4R evidence already accepted, a time-bounded official road
observation, and the unresolved publication gates.  It cannot authorize or
perform a publication, mutate the live draft, contact a cultural authority, or
turn a transient road observation into an evergreen open/safety claim.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.originals_operational import (  # noqa: E402
    load_operational_candidate,
    operational_candidate_sha256,
)
from db.originals_route_evidence import canonical_sha256  # noqa: E402
from db.store import ORIGINAL_VALIDATION_CHECKS  # noqa: E402


ORIGINALS = ROOT / "originals/smokies"
DOCS = ROOT / "docs/originals"
OUTPUT_PATH = ORIGINALS / "roaring_fork_publication_readiness_v1.json"

PACKET_ID = "smokies_roaring_fork_publication_readiness_20260810_v1"
PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CHAPTER_ID = "roaring_fork"
VARIANT_ID = "one_way"

PRIVATE_MANIFEST_CANONICAL_SHA256 = (
    "2fb77582811e28ef963f3018a8990a96612cfedee69f3b2329a73b87ac99d33a"
)
PROFILED_MANIFEST_CANONICAL_SHA256 = (
    "14d83293ba3b09aad00998668311447b5224f5172e641d35163de2865e3c9eb8"
)
NARRATION_PROFILE_CANONICAL_SHA256 = (
    "f79b386031ca0faf6e07332e53ea037f957eb7d9871c4bbf05d5b0aff09c2af5"
)
DEVICE_PREVIEW_EVIDENCE_CANONICAL_SHA256 = (
    "f17ac77a29718cef56ccb2556e44e86800d81482fd0e9cca18acb2537722f750"
)
DELIVERY_CONTRACT_SHA256 = (
    "9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6"
)
S4R_SOURCE_COMMIT = "111a4eb7cc8bb21ac1bbdd3418b1dbec4ca90637"
S4R_REPORT_ID = "original_validation_9df694c93ee9ef3809c33f451d04bf28"
S4R_REPORT_SHA256 = "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059"

SOURCE_PATHS = {
    "historical_inputs": ORIGINALS / "roaring_fork_publication_readiness_inputs_v1.json",
    "private_manifest": ORIGINALS / "roaring_fork_private_manifest_v3.json",
    "private_import_packet": ORIGINALS / "roaring_fork_private_import_packet_v1.json",
    "private_import_receipt": ORIGINALS / "roaring_fork_private_import_receipt_v1.json",
    "narration_profile": ORIGINALS / "roaring_fork_narration_profile_v2.json",
    "delivery_readiness_v2": ORIGINALS / "roaring_fork_delivery_readiness_v2.json",
    "official_route_evidence_v1": ORIGINALS / "official_route_evidence_v1.json",
    "operational_candidate_v1": DOCS / "smokies-operational-readiness-v1.json",
    "source_dossiers_v1": ORIGINALS / "source_dossiers_v1.json",
}

EXPECTED_SOURCE_SHA256 = {
    "historical_inputs": "555c4282a39b7f1affbcd7481645bba14649235df1d693883dd0a461b41879ec",
    "private_manifest": "7e9cab7e0325c6124a2605c83867929780f575e5814c7fdc634c091a9c351467",
    "private_import_packet": "15d3a10b3a387cd23e1271e2d07428772d8f60e4568cbd417ef292d627252c1f",
    "private_import_receipt": "8890c1e1431654a03feb1aa4ee4376ab50504e9841b4d8a06f0a3c003b0ebefd",
    "narration_profile": "10fd4f5f04cbfbc411a1e7c31061700d17752af61e1501a4b7b4652c0d2ee377",
    "delivery_readiness_v2": "7cf1b601d48845e3bc404a501d33a9f2c1e2567544c03347b99de0524ee923e6",
    "official_route_evidence_v1": "d946ffaf8f21ad97399b6dedfb5cbe9483fce0787653b389d7075d933f398c60",
    "operational_candidate_v1": "359c8e2ff8086de56054d99503cb2661730a9977534c3007ff4c6d0db2cafb8f",
    "source_dossiers_v1": "8eb22ca5110f0f9a4287b8f184624348c2a2ca2dbc36e27ef59fc022057ce18f",
}

CONTRACT_SOURCE_PATHS = {
    "manifest_v2_contract": ROOT / "db/original_manifest_v2.py",
    "manifest_v3_contract": ROOT / "db/original_manifest_v3.py",
    "operational_contract": ROOT / "db/originals_operational.py",
    "route_evidence_contract": ROOT / "db/originals_route_evidence.py",
    "cultural_scope_contract": ROOT / "db/originals_cultural_review.py",
    "vehicle_binding_contract": ROOT / "db/originals_vehicle_binding.py",
    "publication_store_contract": ROOT / "db/store.py",
    "published_start_runtime_contract": ROOT / "dashboard/server.py",
}

EXPECTED_CONTRACT_SOURCE_SHA256 = {
    "manifest_v2_contract": "50e2b636beae76b2ba30e6cd2871e98679a22563c73872ffa7c7e52a3d3c7931",
    "manifest_v3_contract": "850df80086d336a3a3652d73a1e0eda403e89f06b241c2a710bcb6cbf38e53de",
    "operational_contract": "9b6193cd275c7c7e51ee9724335165d1c3618700ea61ac43b6235f80ca12ba4d",
    "route_evidence_contract": "aa58a8bdd4bf5c10221d2071e8240f60d01ae4d4d464792ad75adf77775701fc",
    "cultural_scope_contract": "360cd487fc43ccf8ccc94430144484c4b9c3ebf3e04dd7e4b3a67f73027b4f97",
    "vehicle_binding_contract": "1656948207e013cfb258cd03af1be008c1dcae99baf2c4c8f600796a5f213517",
    "publication_store_contract": "c3defe0312a999a38eb123fcad198449a1cf8e4c744db8c5befea9bd531df87c",
    "published_start_runtime_contract": "8771645974d82a6c2f961b29ca6119a5da1454f7242513c3401f9df6b0cd09ea",
}


class PublicationReadinessError(ValueError):
    """The checked evidence cannot produce the exact blocked packet."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PublicationReadinessError(f"cannot read {path}") from exc
    if not isinstance(value, dict):
        raise PublicationReadinessError(f"{path.name} must contain an object")
    return value


def _binding(path: Path) -> dict[str, Any]:
    return {
        "path": path.resolve().relative_to(ROOT.resolve()).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": _sha256(path),
    }


def _documents() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    documents: dict[str, dict[str, Any]] = {}
    bindings: dict[str, dict[str, Any]] = {}
    for name, path in SOURCE_PATHS.items():
        actual = _sha256(path)
        if actual != EXPECTED_SOURCE_SHA256[name]:
            raise PublicationReadinessError(f"source binding drifted: {path.name}")
        documents[name] = _json(path)
        bindings[name] = _binding(path)
    for name, path in CONTRACT_SOURCE_PATHS.items():
        actual = _sha256(path)
        if actual != EXPECTED_CONTRACT_SOURCE_SHA256[name]:
            raise PublicationReadinessError(f"contract source drifted: {path.name}")
        bindings[name] = _binding(path)
    return documents, bindings


def _timestamp(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise PublicationReadinessError(f"{label} must be an exact UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise PublicationReadinessError(f"{label} is invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise PublicationReadinessError(f"{label} must use UTC")
    return parsed


def _chapter(rows: Any, chapter_id: str) -> dict[str, Any]:
    if not isinstance(rows, list):
        raise PublicationReadinessError("chapter collection is invalid")
    matches = [row for row in rows if isinstance(row, dict) and row.get("chapter_id") == chapter_id]
    if len(matches) != 1:
        raise PublicationReadinessError(f"expected one {chapter_id} chapter")
    return matches[0]


def _assert_checked_state(documents: dict[str, dict[str, Any]]) -> dict[str, Any]:
    historical = documents["historical_inputs"]
    if historical.get("evidence_id") != (
        "smokies_roaring_fork_publication_readiness_inputs_20260810_v1"
    ):
        raise PublicationReadinessError("historical input identity drifted")
    checkpoint = historical.get("source_checkpoint")
    if checkpoint != {
        "commit": "41aac223ab691d99ac59ecb29434668abb83426a",
        "path": "docs/checkpoints/smokies-original-active-checkpoint.md",
        "file_sha256": "287539d24483719c62fa5f1833b65a5a46b7512b190ccb427cd3cb113107ed26",
        "sections": [
            "Smokies product and access contract",
            "S4Q Roaring Fork authenticated Android device-preview closeout",
            "S4R Roaring Fork trusted route and long-form validation closeout",
        ],
    }:
        raise PublicationReadinessError("source checkpoint binding drifted")

    private_state = historical.get("private_state_at_s4r_readback")
    if not isinstance(private_state, dict):
        raise PublicationReadinessError("S4R private-state input is missing")
    expected_private_state = {
        "observed_at": "2026-08-11T01:33:56Z",
        "draft_revision": 2,
        "profile_absent_base_manifest_sha256": PRIVATE_MANIFEST_CANONICAL_SHA256,
        "profiled_manifest_sha256": PROFILED_MANIFEST_CANONICAL_SHA256,
        "narration_profile_sha256": NARRATION_PROFILE_CANONICAL_SHA256,
        "device_preview_evidence_sha256": DEVICE_PREVIEW_EVIDENCE_CANONICAL_SHA256,
        "delivery_contract_sha256": DELIVERY_CONTRACT_SHA256,
        "current_asset_count": 20,
        "narration_count": 13,
        "artwork_count": 7,
        "aggregate_asset_bytes": 239_772_665,
        "published_version_count": 0,
        "live_database_rechecked_by_publication_readiness_builder": False,
    }
    if private_state != expected_private_state:
        raise PublicationReadinessError("S4R private-state input drifted")

    trusted = historical.get("trusted_private_validation_at_s4r_readback")
    if not isinstance(trusted, dict) or trusted != {
        "source_commit": S4R_SOURCE_COMMIT,
        "report_id": S4R_REPORT_ID,
        "redacted_report_sha256": S4R_REPORT_SHA256,
        "status": "passed",
        "current": True,
        "engine": "original-trigger-v3",
        "selection": "roaring_fork_one_way_private_v1:one_way",
        "route_scenarios_required": 13,
        "route_scenarios_passed": 13,
        "issues": [],
        "publication_approval": False,
        "live_report_rechecked_by_publication_readiness_builder": False,
    }:
        raise PublicationReadinessError("S4R trusted-validation input drifted")

    product_contract = historical.get("prior_product_contract")
    if not isinstance(product_contract, dict) or product_contract != {
        "pack_scope": "one_premium_four_chapter_product",
        "chapter_ids": [
            "mountain_crossing",
            "little_river_cades_cove",
            "roaring_fork",
            "foothills_parkway",
        ],
        "permanent_credit_price": 900,
        "explorer_included": True,
        "standalone_roaring_fork_public_product_approved": False,
        "changing_scope_or_price_requires_separate_product_decision": True,
    }:
        raise PublicationReadinessError("prior product contract input drifted")

    observations = historical.get("external_observations")
    if not isinstance(observations, dict) or observations.get("verification_level") != (
        "historical_external_observation_not_revalidated_by_builder"
    ):
        raise PublicationReadinessError("external observation classification drifted")
    road_observation = observations.get("road_feed")
    if not isinstance(road_observation, dict):
        raise PublicationReadinessError("historical road observation is missing")
    observed_at = _timestamp(road_observation.get("observed_at"), "road observed_at")
    rechecked_at = _timestamp(road_observation.get("rechecked_at"), "road rechecked_at")
    expires_at = _timestamp(road_observation.get("expires_at"), "road expires_at")
    if (expires_at - observed_at).total_seconds() != 1800 or not (
        observed_at <= rechecked_at <= expires_at
    ):
        raise PublicationReadinessError("historical road observation lifetime drifted")
    if (
        road_observation.get("evergreen_reuse_allowed") is not False
        or road_observation.get("not_a_safety_or_guaranteed_open_claim") is not True
        or road_observation.get("response_body_retained_in_repository") is not False
    ):
        raise PublicationReadinessError("historical road claim limits drifted")
    current_cautions_observation = observations.get("current_cautions_page")
    if not isinstance(current_cautions_observation, dict) or current_cautions_observation != {
        "source_url": "https://www.nps.gov/grsm/planyourvisit/temproadclose.htm",
        "observed_last_updated": "2026-08-06",
        "checked_candidate_last_updated": "2026-07-31",
        "checked_candidate_reviewed_at": "2026-08-04T00:00:00Z",
        "requires_new_reviewed_candidate": True,
    }:
        raise PublicationReadinessError("current-cautions observation drifted")

    scope_limits = historical.get("scope_limits")
    if not isinstance(scope_limits, dict) or any(scope_limits.values()):
        raise PublicationReadinessError("historical input scope limits drifted")

    manifest = documents["private_manifest"]
    if manifest.get("schema_version") != 3:
        raise PublicationReadinessError("private manifest schema drifted")
    chapters = manifest.get("chapters")
    if not isinstance(chapters, list) or [row.get("id") for row in chapters] != [CHAPTER_ID]:
        raise PublicationReadinessError("private manifest chapter scope drifted")
    if len(manifest.get("stories", [])) != 13 or len(manifest.get("assets", [])) != 20:
        raise PublicationReadinessError("private manifest membership drifted")
    if "route_evidence" in manifest:
        raise PublicationReadinessError("private manifest unexpectedly contains route evidence")
    if manifest.get("review") != {"editorial_status": "source_review_required"}:
        raise PublicationReadinessError("private editorial status drifted")
    offline_map = manifest.get("offline_map")
    if not isinstance(offline_map, dict) or offline_map.get("estimated_bytes") != 0:
        raise PublicationReadinessError("private offline-map estimate drifted")

    variant = chapters[0].get("variants", [None])[0]
    if not isinstance(variant, dict) or variant.get("id") != VARIANT_ID:
        raise PublicationReadinessError("private route selection drifted")
    if variant.get("delivery_contract_sha256") != DELIVERY_CONTRACT_SHA256:
        raise PublicationReadinessError("delivery-contract binding drifted")
    operational_readiness = chapters[0].get("operational_readiness")
    if not isinstance(operational_readiness, dict):
        raise PublicationReadinessError("private operational readiness is missing")
    if operational_readiness.get("alternate_chapter_ids") != []:
        raise PublicationReadinessError("private alternate projection drifted")

    packet = documents["private_import_packet"]
    draft = packet.get("draft")
    if not isinstance(draft, dict):
        raise PublicationReadinessError("private draft envelope is missing")
    if draft.get("price_credits") != 0 or draft.get("template", {}).get("visibility") != "private":
        raise PublicationReadinessError("private catalog contract drifted")
    validation = draft.get("validation_metadata")
    if not isinstance(validation, dict):
        raise PublicationReadinessError("private validation metadata is missing")
    completed_reviews = sorted(
        check for check in ORIGINAL_VALIDATION_CHECKS if validation.get(check) is True
    )
    if completed_reviews != sorted(
        ["audio_assets_reviewed", "media_licenses_reviewed", "transcripts_reviewed"]
    ):
        raise PublicationReadinessError("private publication-review baseline drifted")

    receipt = documents["private_import_receipt"]
    assets = receipt.get("assets")
    if not isinstance(assets, dict) or assets.get("total") != 20 or assets.get("bytes") != 239_772_665:
        raise PublicationReadinessError("verified private asset receipt drifted")
    if receipt.get("post_import", {}).get("published_version_count") != 0:
        raise PublicationReadinessError("private import receipt is no longer unpublished")

    profile = documents["narration_profile"]
    if canonical_sha256(profile) != NARRATION_PROFILE_CANONICAL_SHA256:
        raise PublicationReadinessError("narration profile canonical hash drifted")

    readiness = documents["delivery_readiness_v2"]
    if readiness.get("evidence_id") != "smokies_roaring_fork_delivery_v2":
        raise PublicationReadinessError("delivery readiness identity drifted")
    if readiness.get("chapter_id") != CHAPTER_ID or readiness.get("variant_id") != VARIANT_ID:
        raise PublicationReadinessError("delivery readiness selection drifted")

    route = documents["official_route_evidence_v1"]
    if canonical_sha256(route) != "95f199551ac949b081f0a8a55d46e0bf261987b211be08835f93387258844159":
        raise PublicationReadinessError("route evidence canonical hash drifted")
    if route.get("publication_status") != "blocked":
        raise PublicationReadinessError("route evidence unexpectedly became publishable")
    route_blockers = route.get("publication_blockers")
    if route_blockers != [
        "trusted_current_road_observation",
        "server_owned_vehicle_class",
        "editorial_and_cultural_review",
    ]:
        raise PublicationReadinessError("route evidence blockers drifted")
    route_variants = route.get("variants")
    if not isinstance(route_variants, list) or len(route_variants) != 6:
        raise PublicationReadinessError("route evidence variant set drifted")

    candidate = load_operational_candidate(SOURCE_PATHS["operational_candidate_v1"])
    candidate_sha256 = operational_candidate_sha256(candidate)
    if candidate_sha256 != "17b9eea045ac2369e7679f5fbec3291cca46374b004165f15087ceb4bded7a21":
        raise PublicationReadinessError("operational candidate canonical hash drifted")
    roaring_fork = _chapter(candidate.get("chapters"), CHAPTER_ID)
    if roaring_fork.get("alternate_chapter_ids") != ["foothills_parkway"]:
        raise PublicationReadinessError("checked Roaring Fork alternate drifted")
    current_cautions = [
        row for row in candidate.get("sources", [])
        if isinstance(row, dict) and row.get("id") == "grsm-current-cautions"
    ]
    if len(current_cautions) != 1:
        raise PublicationReadinessError("current-cautions source is missing")
    if current_cautions[0].get("source_last_updated_at") != "2026-07-31":
        raise PublicationReadinessError("checked current-cautions date drifted")

    dossiers = documents["source_dossiers_v1"]
    cultural = dossiers.get("cultural_review")
    if not isinstance(cultural, dict) or cultural.get("status") != "public_record_only":
        raise PublicationReadinessError("cultural review status drifted")
    if cultural.get("blocked_entry_ids") != []:
        raise PublicationReadinessError("Roaring Fork public-record scope drifted")
    entries = [
        row for row in dossiers.get("entries", [])
        if isinstance(row, dict) and row.get("chapter_id") == CHAPTER_ID
    ]
    if len(entries) != 13:
        raise PublicationReadinessError("Roaring Fork dossier membership drifted")
    claim_ids = sorted({claim_id for entry in entries for claim_id in entry.get("claim_ids", [])})
    claims = [
        row for row in dossiers.get("claims", [])
        if isinstance(row, dict) and row.get("id") in claim_ids
    ]
    if len(claim_ids) != 7 or len(claims) != 7:
        raise PublicationReadinessError("Roaring Fork claim set drifted")
    if any(
        claim.get("cultural_gate") != "not_required"
        or claim.get("cultural_scope", {}).get("classification") != "public_record_factual"
        or claim.get("cultural_scope", {}).get("collection_method") != "published_public_record"
        or claim.get("cultural_scope", {}).get("review_triggers") != []
        for claim in claims
    ):
        raise PublicationReadinessError("Roaring Fork public-record claim scope drifted")

    return {
        "candidate_sha256": candidate_sha256,
        "completed_reviews": completed_reviews,
        "missing_reviews": sorted(set(ORIGINAL_VALIDATION_CHECKS) - set(completed_reviews)),
        "rf_claim_ids": claim_ids,
        "rf_claim_set_sha256": canonical_sha256(sorted(claims, key=lambda row: row["id"])),
        "route_variant_ids": sorted(
            f"{row['chapter_id']}:{row['variant_id']}" for row in route_variants
        ),
        "historical_inputs": historical,
    }


def build() -> dict[str, Any]:
    documents, source_bindings = _documents()
    checked = _assert_checked_state(documents)
    historical = checked["historical_inputs"]
    private_state = historical["private_state_at_s4r_readback"]
    trusted = historical["trusted_private_validation_at_s4r_readback"]
    product_contract = historical["prior_product_contract"]
    external = historical["external_observations"]
    road_observation = external["road_feed"]
    current_cautions_observation = external["current_cautions_page"]

    blockers = [
        {
            "id": "final_publication_manifest_and_catalog",
            "status": "blocked",
            "facts": {
                "current_manifest_scope": "private_revision_2_roaring_fork_one_way",
                "editorial_status": "source_review_required",
                "completed_publication_reviews": checked["completed_reviews"],
                "missing_publication_reviews": checked["missing_reviews"],
                "offline_map_estimated_bytes": 0,
                "route_evidence_present": False,
                "catalog_visibility": "private",
                "catalog_price_credits": 0,
                "approved_product_credit_price": product_contract[
                    "permanent_credit_price"
                ],
                "approved_product_explorer_included": product_contract[
                    "explorer_included"
                ],
            },
            "required_resolution": (
                "review the final public product, pricing/access, copy, citations, offline-map "
                "evidence, and all ten publication checks in a new manifest revision"
            ),
        },
        {
            "id": "exact_route_evidence",
            "status": "blocked",
            "facts": {
                "v1_publication_status": "blocked",
                "v1_blockers": [
                    "trusted_current_road_observation",
                    "server_owned_vehicle_class",
                    "editorial_and_cultural_review",
                ],
                "v1_variant_count": 6,
                "v1_variant_ids": checked["route_variant_ids"],
                "required_manifest_variant_ids": ["roaring_fork:one_way"],
            },
            "required_resolution": (
                "create and separately review an exact Roaring-Fork-only publication route "
                "evidence overlay; preserve official_route_evidence_v1 unchanged"
            ),
        },
        {
            "id": "current_operational_evidence_and_strict_alternates",
            "status": "blocked",
            "facts": {
                "checked_candidate_sha256": checked["candidate_sha256"],
                "checked_reviewed_at": "2026-08-04T00:00:00Z",
                "checked_current_cautions_last_updated": "2026-07-31",
                "official_current_cautions_last_updated": current_cautions_observation[
                    "observed_last_updated"
                ],
                "checked_alternate_chapter_ids": ["foothills_parkway"],
                "private_manifest_alternate_chapter_ids": [],
                "validation_only_projection_is_not_publication_evidence": True,
            },
            "required_resolution": (
                "create a newly reviewed immutable operational candidate for the chosen public "
                "product scope, rebind its hash, and rerun strict validation"
            ),
        },
        {
            "id": "public_record_cultural_scope_contract",
            "status": "blocked",
            "facts": {
                "dossier_status": "public_record_only",
                "roaring_fork_entry_count": 13,
                "claim_count": 7,
                "claim_ids": checked["rf_claim_ids"],
                "claim_set_sha256": checked["rf_claim_set_sha256"],
                "claim_classification": "public_record_factual",
                "collection_method": "published_public_record",
                "claim_level_cultural_gate": "not_required",
                "registered_publication_determination_present": False,
                "registered_gated_content_approval_present": False,
            },
            "required_resolution": (
                "add and obtain an immutable authority-issued public-record publication-scope "
                "determination distinct from gated-content approval; do not invent gated claims "
                "or self-approve the product"
            ),
        },
        {
            "id": "published_start_runtime_safety",
            "status": "blocked",
            "facts": {
                "manifest_schema": 3,
                "trusted_current_road_reader_schema_support": [2],
                "live_observation_required_at_start": True,
                "server_owned_vehicle_binding_required_at_start": True,
                "account_vehicle_evidence_allowed_in_packet": False,
                "passenger_and_motorcycle_policy_compatible": True,
                "blocked_vehicle_classes": [
                    "bus",
                    "commercial_service",
                    "motorhome",
                    "towing_trailer",
                    "van_over_25_ft",
                ],
            },
            "required_resolution": (
                "support schema V3 in the trusted road observation path and verify the existing "
                "privacy-redacted saved-rig policy at Start Tour after publication"
            ),
        },
        {
            "id": "atomic_public_release_authorization",
            "status": "blocked",
            "facts": {
                "trusted_private_report_passed": True,
                "trusted_private_report_reusable_after_manifest_or_source_change": False,
                "trusted_publication_validation_complete": False,
                "public_release": False,
                "publish_endpoint_exercised": False,
                "separate_owner_publication_authorization_present": False,
            },
            "required_resolution": (
                "add a server-owned atomic publish authorization guard, produce a fresh exact "
                "report for the final revision, and obtain a separate explicit release decision"
            ),
        },
    ]

    return {
        "schema_version": 1,
        "packet_id": PACKET_ID,
        "kind": "original_publication_readiness_hold",
        "evidence_cutoff_at": road_observation["rechecked_at"],
        "scope": {
            "product_id": PRODUCT_ID,
            "chapter_id": CHAPTER_ID,
            "variant_id": VARIANT_ID,
            "draft_revision": 2,
            "manifest_schema": 3,
        },
        "accepted_private_evidence": {
            "evidence_class": "historical_s4r_production_readback",
            "observed_at": private_state["observed_at"],
            "private_manifest_canonical_sha256": private_state[
                "profile_absent_base_manifest_sha256"
            ],
            "profiled_manifest_canonical_sha256": private_state[
                "profiled_manifest_sha256"
            ],
            "narration_profile_canonical_sha256": private_state[
                "narration_profile_sha256"
            ],
            "device_preview_evidence_canonical_sha256": private_state[
                "device_preview_evidence_sha256"
            ],
            "delivery_contract_sha256": private_state["delivery_contract_sha256"],
            "current_asset_count": private_state["current_asset_count"],
            "narration_count": private_state["narration_count"],
            "artwork_count": private_state["artwork_count"],
            "aggregate_asset_bytes": private_state["aggregate_asset_bytes"],
            "published_version_count": private_state["published_version_count"],
            "live_database_rechecked_by_builder": private_state[
                "live_database_rechecked_by_publication_readiness_builder"
            ],
        },
        "trusted_private_validation": {
            "evidence_class": "historical_s4r_production_readback",
            "source_commit": trusted["source_commit"],
            "report_id": trusted["report_id"],
            "redacted_report_sha256": trusted["redacted_report_sha256"],
            "status": trusted["status"],
            "current_at_s4r_readback": trusted["current"],
            "engine": trusted["engine"],
            "selection": trusted["selection"],
            "route_scenarios_required": trusted["route_scenarios_required"],
            "route_scenarios_passed": trusted["route_scenarios_passed"],
            "issues": trusted["issues"],
            "publication_approval": trusted["publication_approval"],
            "live_report_rechecked_by_builder": trusted[
                "live_report_rechecked_by_publication_readiness_builder"
            ],
            "must_rerun_after_final_manifest_or_source_change": True,
        },
        "prior_product_contract": product_contract,
        "official_road_observation": {
            "evidence_class": external["verification_level"],
            **road_observation,
        },
        "source_bindings": source_bindings,
        "blockers": blockers,
        "decision_boundary": {
            "publication_ready": False,
            "blocker_count": len(blockers),
            "public_release": False,
            "publish_endpoint_authorized": False,
            "publish_endpoint_exercised": False,
            "production_mutation_performed": False,
            "database_accessed": False,
            "network_accessed_by_builder": False,
            "cultural_outreach_performed": False,
            "next_product_decision": (
                "preserve the planned four-chapter 900-credit Explorer-included product or "
                "separately approve a standalone Roaring Fork public product"
            ),
            "next_authority_decision": (
                "authorize a public-record publication-scope determination process; this packet "
                "does not authorize outreach"
            ),
        },
    }


def _encoded(packet: dict[str, Any]) -> bytes:
    return (json.dumps(packet, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify that the checked-in packet is byte-identical",
    )
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args(argv)

    encoded = _encoded(build())
    if args.check:
        if not args.output.is_file() or args.output.read_bytes() != encoded:
            raise PublicationReadinessError("checked publication-readiness packet drifted")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
