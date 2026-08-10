#!/usr/bin/env python3
"""Build the fail-closed Roaring Fork private Manifest V3 import packet.

This builder is deliberately network-free.  It binds the accepted narration
masters and visually approved artwork derivatives to one private draft without
claiming an admin license attestation, a server upload, device acceptance, or
publication approval.
"""

from __future__ import annotations

import argparse
import copy
from datetime import date
import hashlib
import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.original_manifest_v3 import (  # noqa: E402
    ORIGINAL_LONG_FORM_CONTRACT_ID,
    ORIGINAL_LONG_FORM_REQUIRED_CAPABILITIES,
    normalize_original_manifest_v3,
    original_manifest_v3_delivery_contract_sha256,
)
from db.originals_operational import (  # noqa: E402
    load_operational_candidate,
    manifest_operational_fields,
)
from db.originals_sources import original_story_citations  # noqa: E402
from db.store import _normalize_original_manifest_v1  # noqa: E402


ORIGINALS = ROOT / "originals/smokies"
OUTPUT_ROOT = ROOT / "output/smokies-original/elevenlabs-james-roaring-fork-v1"
ARTWORK_ROOT = Path(
    "/home/sean/.openclaw/evidence/roaring-fork-artwork-v1/derivatives"
)
ARTWORK_WINDOWS_MIRROR = Path(
    "/mnt/c/Users/User/Documents/Codex/evidence/trailhead/"
    "roaring-fork-artwork-v1/derivatives"
)

AUTHORIZATION_PATH = ORIGINALS / "roaring_fork_private_ingestion_authorization_v1.json"
MANIFEST_PATH = ORIGINALS / "roaring_fork_private_manifest_v3.json"
PACKET_PATH = ORIGINALS / "roaring_fork_private_import_packet_v1.json"

PACKET_ID = "smokies_roaring_fork_private_import_20260810_v1"
AUTHORIZATION_ID = "smokies_roaring_fork_private_ingestion_20260810_v1"
PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
PACK_ID = PRODUCT_ID
CHAPTER_ID = "roaring_fork"
VARIANT_ID = "one_way"
REVIEW_DATE = date(2026, 8, 10)

SOURCE_PATHS = {
    "source_dossier": ORIGINALS / "source_dossiers_v1.json",
    "editorial": ORIGINALS / "editorial_roaring_fork_v1.json",
    "trigger_preflight": ORIGINALS / "roaring_fork_trigger_preflight_v1.json",
    "delivery_readiness": ORIGINALS / "roaring_fork_delivery_readiness_v1.json",
    "narration_lock": ORIGINALS / "elevenlabs_james_roaring_fork_lock_v1.json",
    "audio_characterization": ORIGINALS / "roaring_fork_real_audio_characterization_v1.json",
    "route_evidence": ORIGINALS / "official_route_evidence_v1.json",
    "artwork_review": ORIGINALS / "roaring_fork_artwork_review_v1.json",
    "artwork_derivatives": ORIGINALS / "roaring_fork_artwork_derivatives_v1.json",
    "artwork_approval": ORIGINALS / "roaring_fork_artwork_derivative_approval_v1.json",
}

EXPECTED_SOURCE_SHA256 = {
    "source_dossier": "8eb22ca5110f0f9a4287b8f184624348c2a2ca2dbc36e27ef59fc022057ce18f",
    "editorial": "c3d1622d7f5109fb4632cb74af340f97a3477cd061c326f5e55055e6b074d0e2",
    "trigger_preflight": "b7b8412e07cdef5706d814550491f8c28bfadb05d3fbef38369ec7006c3b67f3",
    "delivery_readiness": "4a0fc760fd07790785b820af06bac4e5a10e8337ad3f6257a10a3c50464c9b67",
    "narration_lock": "4f8b2d9df467de6af3d5622dac10caae7c165d924e36449de30d507812ba7e3b",
    "audio_characterization": "f34b7aa8df6c5270f7b93f98a5bb720cf9c95df7fc1751eaeb1c6b6899529d1b",
    "route_evidence": "d946ffaf8f21ad97399b6dedfb5cbe9483fce0787653b389d7075d933f398c60",
    "artwork_review": "3030dfdf993b8b33cb116263ba9902dfe9e36c637f4ff7a37b11f878f0f082d4",
    "artwork_derivatives": "3287ba42f4d06a7733787659c8092feae89026a5194a60b9eeb342f57a98a305",
    "artwork_approval": "e13c39785e90190e0dfb4db5c60c709568b68d3ecbd76910ab00799a721b951a",
}


class PrivatePacketError(ValueError):
    """The exact approved inputs cannot produce a private import packet."""


def _json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PrivatePacketError(f"cannot read {path}") from exc
    if not isinstance(value, dict):
        raise PrivatePacketError(f"{path.name} must contain an object")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _binding(path: Path) -> dict[str, Any]:
    return {
        "path": path.resolve().relative_to(ROOT.resolve()).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": _sha256(path),
    }


def _source_documents() -> dict[str, dict[str, Any]]:
    documents: dict[str, dict[str, Any]] = {}
    for name, path in SOURCE_PATHS.items():
        actual = _sha256(path)
        if actual != EXPECTED_SOURCE_SHA256[name]:
            raise PrivatePacketError(f"source binding drifted: {path.name}")
        documents[name] = _json(path)
    return documents


def _assert_authorized_inputs(documents: dict[str, dict[str, Any]]) -> None:
    approval = documents["artwork_approval"]
    gate = approval.get("approval_gate", {})
    if approval.get("approval", {}).get("decision") != "approve_all_derivatives":
        raise PrivatePacketError("the derivative approval decision is missing")
    if gate.get("derivative_user_visual_approval") is not True:
        raise PrivatePacketError("the derivative visual gate is not approved")
    rows = approval.get("derivatives")
    if not isinstance(rows, list) or len(rows) != 7:
        raise PrivatePacketError("exactly seven approved derivatives are required")
    if any(row.get("user_visual_approval") is not True for row in rows):
        raise PrivatePacketError("an artwork derivative lacks visual approval")

    lock = documents["narration_lock"]
    if lock.get("authorization", {}).get("user_selected_narrator") is not True:
        raise PrivatePacketError("the selected narrator lock is unavailable")
    if lock.get("narrator_acceptance", {}).get("decision") != "james_selected_continue":
        raise PrivatePacketError("the James narrator decision drifted")
    entries = lock.get("entries")
    if not isinstance(entries, list) or len(entries) != 13:
        raise PrivatePacketError("exactly thirteen narration entries are required")
    if any(entry.get("cultural_gate") != "not_required" for entry in entries):
        raise PrivatePacketError("this packet may include public-record Roaring Fork entries only")


def _asset_public_path(asset_id: str, sha256: str) -> str:
    return f"/api/original-assets/{PACK_ID}/{asset_id}/{sha256}"


def _audio_asset_id(entry_id: str) -> str:
    if not entry_id.startswith("rf_"):
        raise PrivatePacketError(f"unexpected Roaring Fork entry id: {entry_id}")
    return f"rf_audio_{entry_id[3:]}"


def _audio_assets(
    characterization: dict[str, Any], *, require_local_evidence: bool
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    evidence = characterization.get("renderer_evidence", {})
    rows = evidence.get("assets")
    if not isinstance(rows, list) or len(rows) != 13:
        raise PrivatePacketError("audio characterization must bind thirteen assets")
    if [row.get("stable_order") for row in rows] != list(range(1, 14)):
        raise PrivatePacketError("audio stable order drifted")

    expected_names = {str(row["master_file"]) for row in rows}
    if require_local_evidence:
        actual_names = {
            item.name for item in OUTPUT_ROOT.iterdir()
            if item.is_file() and item.suffix.lower() == ".mp3"
        }
        if actual_names != expected_names:
            raise PrivatePacketError("accepted audio evidence membership drifted")

    packet_rows: list[dict[str, Any]] = []
    manifest_assets: dict[str, dict[str, Any]] = {}
    for row in rows:
        entry_id = str(row["entry_id"])
        asset_id = _audio_asset_id(entry_id)
        source_path = OUTPUT_ROOT / str(row["master_file"])
        if require_local_evidence:
            if source_path.is_symlink() or not source_path.is_file():
                raise PrivatePacketError(f"accepted audio is unavailable: {source_path.name}")
            if source_path.stat().st_size != int(row["audio_bytes"]):
                raise PrivatePacketError(f"accepted audio size drifted: {source_path.name}")
            if _sha256(source_path) != row["audio_sha256"]:
                raise PrivatePacketError(f"accepted audio hash drifted: {source_path.name}")
        packet_row = {
            "asset_id": asset_id,
            "entry_id": entry_id,
            "stable_order": int(row["stable_order"]),
            "kind": "narration",
            "mime_type": "audio/mpeg",
            "file_name": str(row["master_file"]),
            "source_root": "accepted_narration_output",
            "source_relative_path": str(row["master_file"]),
            "bytes": int(row["audio_bytes"]),
            "sha256": str(row["audio_sha256"]),
            "transcript_sha256": str(row["normalized_transcript_sha256"]),
            "raw_transcript_sha256": str(row["raw_transcript_sha256"]),
            "media": {
                "format": "mp3",
                "duration_s": float(row["probed_duration_s"]),
                "sample_rate_hz": int(row["sample_rate_hz"]),
                "bitrate_kbps": int(row["bitrate_kbps"]),
                "channels": int(row["channels"]),
            },
            "generator": {
                "provider": str(evidence["provider"]),
                "model_id": str(evidence["model_id"]),
                "voice_id": str(evidence["voice_id"]),
                "output_format": str(evidence["output_format_id"]),
                "provider_native_master": True,
                "lossless_master_claimed": False,
                "transcoded": False,
                "admin_license_attestation_required": True,
            },
        }
        packet_rows.append(packet_row)
        manifest_assets[asset_id] = {
            "id": asset_id,
            "kind": "narration",
            "path": _asset_public_path(asset_id, packet_row["sha256"]),
            "mime_type": "audio/mpeg",
            "bytes": packet_row["bytes"],
            "sha256": packet_row["sha256"],
        }
    return packet_rows, manifest_assets


def _artwork_assets(
    approval: dict[str, Any], *, require_local_evidence: bool
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    rows = approval["derivatives"]
    expected_names = {str(row["derivative_filename"]) for row in rows}
    roots = [ARTWORK_ROOT, ARTWORK_WINDOWS_MIRROR]
    if require_local_evidence:
        for root in roots:
            if not root.is_dir():
                raise PrivatePacketError(f"approved artwork root is unavailable: {root}")
            actual_names = {item.name for item in root.iterdir() if item.is_file()}
            if actual_names != expected_names:
                raise PrivatePacketError(f"approved artwork membership drifted: {root}")

    packet_rows: list[dict[str, Any]] = []
    manifest_assets: dict[str, dict[str, Any]] = {}
    for row in rows:
        asset_id = str(row["candidate_id"])
        file_name = str(row["derivative_filename"])
        if require_local_evidence:
            for root in roots:
                source_path = root / file_name
                if source_path.is_symlink() or not source_path.is_file():
                    raise PrivatePacketError(f"approved artwork is unavailable: {source_path}")
                if source_path.stat().st_size != int(row["derivative_bytes"]):
                    raise PrivatePacketError(f"approved artwork size drifted: {source_path}")
                if _sha256(source_path) != row["derivative_sha256"]:
                    raise PrivatePacketError(f"approved artwork hash drifted: {source_path}")
        packet_row = {
            "asset_id": asset_id,
            "stable_order": int(row["stable_order"]),
            "kind": "image",
            "mime_type": "image/png",
            "file_name": file_name,
            "source_root": "approved_artwork_derivatives",
            "source_relative_path": file_name,
            "bytes": int(row["derivative_bytes"]),
            "sha256": str(row["derivative_sha256"]),
            "decoded_pixel_sha256": str(row["decoded_pixel_sha256"]),
            "media": {
                "format": "png",
                "width": int(row["dimensions"]["width"]),
                "height": int(row["dimensions"]["height"]),
                "mode": "RGB",
                "allowed_chunk_types": ["IHDR", "IDAT", "IEND"],
                "ancillary_chunk_count": 0,
            },
            "rights": {
                "creator": str(row["creator"]),
                "exact_credit": str(row["exact_credit"]),
                "license_name": str(row["license_name"]),
                "license_url": str(row["license_url"]),
                "source_page_url": str(row["source_page_url"]),
                "change_note": str(row["change_note"]),
                "claim_limit": str(row["claim_limit"]),
            },
        }
        packet_rows.append(packet_row)
        manifest_assets[asset_id] = {
            "id": asset_id,
            "kind": "image",
            "path": _asset_public_path(asset_id, packet_row["sha256"]),
            "mime_type": "image/png",
            "bytes": packet_row["bytes"],
            "sha256": packet_row["sha256"],
        }
    return packet_rows, manifest_assets


def _authorization(source_bindings: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "authorization_id": AUTHORIZATION_ID,
        "product_id": PRODUCT_ID,
        "chapter_id": CHAPTER_ID,
        "variant_id": VARIANT_ID,
        "decision": {
            "decision_text": "continue",
            "authorized_on": "2026-08-10",
            "authorized_by": "project_owner",
            "source_task_id": "019fe9fb-cafa-75d3-b663-1e5051731cd5",
            "scope": (
                "bounded_admin_only_private_manifest_v3_and_verified_upload_evidence"
            ),
        },
        "authorization": {
            "private_draft_importer_implementation": True,
            "private_manifest_v3_assembly": True,
            "exact_asset_ingestion_after_preflight": True,
            "isolated_validation": True,
            "authenticated_device_preview": False,
            "trusted_publication_validation": False,
            "deployment": False,
            "publication": False,
            "narration_generation": False,
            "culturally_gated_material": False,
        },
        "required_live_authority": {
            "configured_private_database_target": False,
            "configured_private_asset_target": False,
            "real_admin_user_id": False,
            "fresh_admin_generator_license_attestation": False,
            "may_not_be_fabricated": True,
        },
        "source_bindings": source_bindings,
        "public_release": False,
    }


def _route(route_evidence: dict[str, Any], characterization: dict[str, Any]) -> dict[str, Any]:
    variants = [
        item for item in route_evidence.get("variants", [])
        if item.get("chapter_id") == CHAPTER_ID and item.get("variant_id") == VARIANT_ID
    ]
    if len(variants) != 1:
        raise PrivatePacketError("the exact Roaring Fork route variant is unavailable")
    source = variants[0]
    if source.get("status") != "official_geometry_candidate":
        raise PrivatePacketError("the Roaring Fork geometry identity drifted")
    coordinates = copy.deepcopy(source["geometry"]["coordinates"])
    west = min(point[0] for point in coordinates)
    east = max(point[0] for point in coordinates)
    south = min(point[1] for point in coordinates)
    north = max(point[1] for point in coordinates)
    speeds = characterization["timing_characterization"]["result"]["speed_fixtures"]
    slow_fixture = next(item for item in speeds if item["speed_mph"] == 15)
    return {
        "profile": "driving",
        "direction": "one_way",
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "bounds": {"north": north, "south": south, "east": east, "west": west},
        "distance_m": float(source["distance_m"]),
        "duration_s": float(slow_fixture["route_travel_s"]),
    }


def _stories_and_refs(
    documents: dict[str, dict[str, Any]],
    audio_assets: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    editorial_entries = {
        str(item["id"]): item for item in documents["editorial"]["entries"]
    }
    lock_entries = {
        str(item["entry_id"]): item for item in documents["narration_lock"]["entries"]
    }
    audio_rows = {
        str(item["entry_id"]): item
        for item in documents["audio_characterization"]["renderer_evidence"]["assets"]
    }
    artwork_map = {
        str(item["entry_id"]): str(item["candidate_id"])
        for item in documents["artwork_review"]["entry_artwork_map"]
    }
    preflight = documents["trigger_preflight"]["entries"]
    next_hard_by_capacity = {
        str(item["id"]): str(item["next_hard_auto"]["id"])
        for item in documents["trigger_preflight"]["capacity_admission_input"]
    }
    if [item["stable_order"] for item in preflight] != list(range(1, 14)):
        raise PrivatePacketError("delivery order drifted")

    stories: list[dict[str, Any]] = []
    hard_refs: list[dict[str, Any]] = []
    selectable_refs: list[dict[str, Any]] = []
    for placement in preflight:
        entry_id = str(placement["id"])
        editorial = editorial_entries[entry_id]
        lock = lock_entries[entry_id]
        audio = audio_rows[entry_id]
        if lock["normalized_transcript_sha256"] != audio["normalized_transcript_sha256"]:
            raise PrivatePacketError(f"audio transcript binding drifted: {entry_id}")
        story = {
            "id": entry_id,
            "kind": str(editorial["kind"]),
            "title": str(editorial["title"]),
            "transcript": str(editorial["transcript"]),
            "audio_asset_id": _audio_asset_id(entry_id),
            "audio_duration_s": float(audio["probed_duration_s"]),
            "artwork_asset_id": artwork_map[entry_id],
            "citations": original_story_citations(
                documents["source_dossier"],
                list(editorial["claim_ids"]),
                as_of=REVIEW_DATE,
            ),
        }
        if story["audio_asset_id"] not in audio_assets:
            raise PrivatePacketError(f"missing audio manifest asset: {entry_id}")
        stories.append(story)

        mode = placement["delivery"]["mode"]
        reference: dict[str, Any] = {
            "story_id": entry_id,
            "sequence": int(placement["stable_order"]),
        }
        if placement.get("projected_coordinate") is not None:
            reference["coordinates"] = copy.deepcopy(placement["projected_coordinate"])
        if placement.get("trigger") is not None:
            reference["trigger"] = copy.deepcopy(placement["trigger"])
        if mode == "hard_auto":
            hard_refs.append(reference)
        else:
            reference["delivery"] = copy.deepcopy(placement["delivery"])
            if mode == "capacity_deeper":
                reference["delivery"]["next_hard_auto_story_id"] = (
                    next_hard_by_capacity[entry_id]
                )
            if (
                mode == "stopped_deeper"
                and reference["delivery"].get("availability")
                == "at_landmark_user_confirmed_parked"
            ):
                reference["delivery"]["availability_radius_m"] = float(
                    placement["anchor"]["maximum_reviewed_offset_m"]
                )
            selectable_refs.append(reference)
    return stories, hard_refs, selectable_refs


def build_bundle(*, require_local_evidence: bool = False) -> tuple[dict, dict, dict]:
    documents = _source_documents()
    _assert_authorized_inputs(documents)
    source_bindings = [
        _binding(SOURCE_PATHS[name]) for name in sorted(SOURCE_PATHS)
    ]
    authorization = _authorization(source_bindings)

    audio_rows, audio_assets = _audio_assets(
        documents["audio_characterization"],
        require_local_evidence=require_local_evidence,
    )
    artwork_rows, artwork_assets = _artwork_assets(
        documents["artwork_approval"],
        require_local_evidence=require_local_evidence,
    )
    stories, hard_refs, selectable_refs = _stories_and_refs(documents, audio_assets)
    route = _route(documents["route_evidence"], documents["audio_characterization"])
    offline_bounds = copy.deepcopy(route["bounds"])
    for reference in [*hard_refs, *selectable_refs]:
        coordinates = reference.get("coordinates")
        if coordinates is None:
            continue
        offline_bounds["north"] = max(offline_bounds["north"], coordinates["lat"])
        offline_bounds["south"] = min(offline_bounds["south"], coordinates["lat"])
        offline_bounds["east"] = max(offline_bounds["east"], coordinates["lng"])
        offline_bounds["west"] = min(offline_bounds["west"], coordinates["lng"])
    operational = manifest_operational_fields(load_operational_candidate(), CHAPTER_ID)
    private_operational_readiness = copy.deepcopy(operational["operational_readiness"])
    # V3 requires alternates to name chapters in the same manifest.  This
    # intentionally one-chapter private draft cannot advertise Foothills
    # Parkway as an embedded alternate; publication must restore and validate
    # the full operational relationship in a later, separately gated packet.
    private_operational_readiness["alternate_chapter_ids"] = []

    manifest: dict[str, Any] = {
        "schema_version": 3,
        "locale": "en-US",
        "title": "Great Smoky Mountains: Roaring Fork",
        "consumer_contract": {
            "schema_version": 1,
            "contract_id": ORIGINAL_LONG_FORM_CONTRACT_ID,
            "required_capabilities": list(ORIGINAL_LONG_FORM_REQUIRED_CAPABILITIES),
        },
        "stories": stories,
        "chapters": [{
            "id": CHAPTER_ID,
            "sequence": 1,
            "title": "Roaring Fork Motor Nature Trail",
            "summary": (
                "A private, source-reviewed one-way chapter through the Roaring Fork "
                "stream valley, forest, and historic landscape."
            ),
            "default_variant_id": VARIANT_ID,
            "safety": {
                "summary": (
                    "Check current National Park Service road, weather, closure, "
                    "and vehicle information immediately before entering."
                ),
                "emergency_note": (
                    "Do not stop in the travel lane; follow posted instructions and "
                    "local emergency guidance."
                ),
                "disclaimers": [
                    "This private draft does not replace current NPS information.",
                    "Parking and landmark availability are not promised.",
                ],
            },
            "access": {
                "surface": "paved",
                "vehicle": (
                    "Use only a currently permitted vehicle; buses, motorhomes, "
                    "trailers, and vans over 25 feet remain blocked by the checked "
                    "operational candidate."
                ),
                "fees": "Check current NPS parking-tag and fee information before arrival.",
                "accessibility_notes": (
                    "Accessibility and stop conditions require a current NPS check; "
                    "this draft makes no parking or access guarantee."
                ),
            },
            "season": {
                "recommended_months": [4, 5, 6, 7, 8, 9, 10, 11],
                "closures_note": (
                    "The motor nature trail is seasonal; confirm the current opening, "
                    "vehicle-free dates, and closures with NPS before starting."
                ),
            },
            "operational_sources": operational["operational_sources"],
            "operational_readiness": private_operational_readiness,
            "validation_selection": {
                "selection_id": "roaring_fork_one_way_private_v1",
                "required_variant_ids": [VARIANT_ID],
            },
            "variants": [{
                "id": VARIANT_ID,
                "sequence": 1,
                "title": "Roaring Fork Motor Nature Trail",
                "route": route,
                "cue_refs": hard_refs,
                "selectable_refs": selectable_refs,
                "delivery_contract_sha256": "0" * 64,
            }],
        }],
        "assets": [
            *[audio_assets[row["asset_id"]] for row in audio_rows],
            *[artwork_assets[row["asset_id"]] for row in artwork_rows],
        ],
        "offline_map": {
            "region_id": "smokies_roaring_fork_private_v1",
            "bounds": offline_bounds,
            "min_zoom": 10,
            "max_zoom": 16,
            "estimated_bytes": 0,
        },
        "review": {
            "editorial_status": "source_review_required",
        },
    }
    variant = manifest["chapters"][0]["variants"][0]
    variant["delivery_contract_sha256"] = original_manifest_v3_delivery_contract_sha256(
        manifest, chapter_id=CHAPTER_ID, variant_id=VARIANT_ID
    )
    normalized_manifest, _ = normalize_original_manifest_v3(
        manifest,
        pack_id=PACK_ID,
        title=manifest["title"],
        version=None,
        normalize_v1=_normalize_original_manifest_v1,
        publishing=False,
    )

    packet = {
        "schema_version": 1,
        "packet_id": PACKET_ID,
        "scope": {
            "product_id": PRODUCT_ID,
            "pack_id": PACK_ID,
            "chapter_id": CHAPTER_ID,
            "variant_id": VARIANT_ID,
            "private_draft_only": True,
        },
        "authorization": {
            "path": AUTHORIZATION_PATH.relative_to(ROOT).as_posix(),
            "sha256": _canonical_sha256(authorization),
        },
        "manifest": {
            "path": MANIFEST_PATH.relative_to(ROOT).as_posix(),
            "canonical_sha256": _canonical_sha256(normalized_manifest),
            "delivery_contract_sha256": variant["delivery_contract_sha256"],
            "publishing": False,
            "narration_profile_status": "awaiting_real_admin_license_attestation",
            "route_evidence_status": "omitted_until_publication_prerequisites_pass",
        },
        "draft": {
            "pack_id": PACK_ID,
            "slug": "great-smoky-mountains-roaring-fork-private-v1",
            "title": normalized_manifest["title"],
            "summary": (
                "Private review draft for the accepted Roaring Fork narration and "
                "approved artwork. Not available for publication."
            ),
            "price_credits": 0,
            "coverage_region": "north_america",
            "public_metadata": {
                "private_review_only": True,
                "chapter_id": CHAPTER_ID,
                "public_release": False,
                "artwork_credits": {
                    row["asset_id"]: copy.deepcopy(row["rights"])
                    for row in artwork_rows
                },
            },
            "validation_metadata": {
                "packet_id": PACKET_ID,
                "source_bindings_sha256": _canonical_sha256(source_bindings),
                "audio_assets_reviewed": True,
                "transcripts_reviewed": True,
                "media_licenses_reviewed": True,
                "artwork_derivatives_visually_approved": True,
                "admin_license_attestation_complete": False,
                "authenticated_device_preview_complete": False,
                "trusted_publication_validation_complete": False,
                "public_release": False,
            },
            "template": {
                "schema_version": 2,
                "title": normalized_manifest["title"],
                "summary": "Private Roaring Fork review draft.",
                "regions": ["TN"],
                "route": {"coordinates": copy.deepcopy(route["geometry"]["coordinates"])},
                "days": [{"day": 1, "title": "Roaring Fork Motor Nature Trail"}],
                "items": [
                    {"id": story["id"], "title": story["title"], "type": story["kind"]}
                    for story in stories
                ],
                "notes": [],
                "readiness": {"status": "private_import_pending"},
                "bookings": [],
                "alerts": [],
                "offline": {},
                "visibility": "private",
                "source": "trailhead_original_private_import",
            },
        },
        "source_roots": {
            "accepted_narration_output": OUTPUT_ROOT.relative_to(ROOT).as_posix(),
            "approved_artwork_derivatives": ARTWORK_ROOT.as_posix(),
            "approved_artwork_windows_mirror": str(
                Path(r"C:\Users\User\Documents\Codex\evidence\trailhead\roaring-fork-artwork-v1\derivatives")
            ),
        },
        "assets": [*audio_rows, *artwork_rows],
        "generator_license_attestation": {
            "status": "required_after_byte_import_before_preview_or_publication_validation",
            "authenticated_server_endpoint_required": True,
            "must_be_performed_by_real_target_admin": True,
            "admin_review_fields": [
                "terms_id",
                "terms_url",
                "terms_version",
                "reviewed_at",
            ],
            "server_owned_fields": [
                "attested_at",
                "attested_by_admin_user_id",
            ],
            "byte_import_license_status": "unverified",
            "caller_supplied_attestation_forbidden": True,
            "may_not_be_inferred_from_test_fixtures": True,
        },
        "transaction_policy": {
            "dry_run_default": True,
            "exact_asset_count": 20,
            "narration_count": 13,
            "artwork_count": 7,
            "content_addressed": True,
            "same_volume_staging": True,
            "single_database_transaction": True,
            "delete_only_files_created_by_failed_run": True,
            "exact_replay_idempotent": True,
            "existing_different_draft_rejected": True,
        },
        "gates": {
            "private_import_authorized": True,
            "packet_evidence_bindings_complete": True,
            "live_asset_preflight_complete": False,
            "live_target_identified": False,
            "live_admin_attestation_complete": False,
            "verified_private_upload_complete": False,
            "authenticated_device_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
    }
    return authorization, normalized_manifest, packet


def _render(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--require-local-evidence", action="store_true")
    args = parser.parse_args()
    authorization, manifest, packet = build_bundle(
        require_local_evidence=args.require_local_evidence
    )
    rendered = {
        AUTHORIZATION_PATH: _render(authorization),
        MANIFEST_PATH: _render(manifest),
        PACKET_PATH: _render(packet),
    }
    if args.check:
        stale = [path for path, expected in rendered.items() if path.read_text(encoding="utf-8") != expected]
        if stale:
            raise SystemExit("private packet is stale: " + ", ".join(path.name for path in stale))
        return
    for path, content in rendered.items():
        path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
