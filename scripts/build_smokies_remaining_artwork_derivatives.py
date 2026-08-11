#!/usr/bin/env python3
"""Create and verify the six owner-authorized Smokies image derivatives.

Derivative binaries stay outside Git. The tracked output is a hash/rights
evidence record only. This stage never uses a network or provider and never
touches a database, manifest, upload, deployment, validation, or publication.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

from PIL import Image, ImageCms, ImageOps, __version__ as PILLOW_VERSION, features

REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

import scripts.build_smokies_roaring_fork_artwork_derivatives as png_guard


OUTPUT_PATH = REPOSITORY / "originals/smokies/remaining_artwork_derivatives_v1.json"
APPROVAL_PATH = REPOSITORY / "originals/smokies/checkpoint2_owner_approval_v1.json"
PACKET_PATH = REPOSITORY / "originals/smokies/remaining_chapters_review_packet_v1.json"
SHARED_PNG_GUARD_PATH = (
    REPOSITORY / "scripts/build_smokies_roaring_fork_artwork_derivatives.py"
)

APPROVAL_SHA256 = "3cc18dad4d1b6a80f2259e58cbe50fba3804096d0c00437eca9103e626078d5c"
APPROVAL_BYTES = 68_453
PACKET_SHA256 = "3ef71377c9e347cd53335cbf487d039ff973b8c28f9628b622fcee74c714b015"
PACKET_BYTES = 262_825
SHARED_PNG_GUARD_SHA256 = (
    "af28bad01d7e2a81de959704219b3c49c5e5d1e8d1d5358c1e3c40fefd5a4946"
)

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
SOURCE_TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"
APPROVED_AT = "2026-08-11T04:27:57.463Z"
GENERATED_AT = "2026-08-11T04:41:38.212Z"
OVERLAY_ID = "smokies_remaining_artwork_derivatives_20260811_v1"

def _configured_path(name: str) -> Path | None:
    value = os.environ.get(name, "").strip()
    return Path(value) if value else None


def _discover_windows_trailhead_evidence_root() -> Path | None:
    configured = _configured_path("SMOKIES_S4M_WINDOWS_TRAILHEAD_EVIDENCE_ROOT")
    if configured is not None:
        return configured
    filesystem_root = Path(Path.cwd().anchor)
    users_root = filesystem_root / "mnt" / "c" / "Users"
    candidates = sorted(
        path
        for path in users_root.glob("*/Documents/Codex/evidence/trailhead")
        if path.is_dir()
    )
    return candidates[0] if len(candidates) == 1 else None


_WINDOWS_TRAILHEAD_EVIDENCE_ROOT = _discover_windows_trailhead_evidence_root()
WSL_SOURCE_ROOT = _configured_path("SMOKIES_S4M_WSL_SOURCE_ROOT") or (
    Path.home() / ".openclaw/evidence/smokies-media-s2/originals"
)
WSL_DERIVATIVE_ROOT = _configured_path("SMOKIES_S4M_WSL_DERIVATIVE_ROOT") or (
    Path.home() / ".openclaw/evidence/smokies-s4m-six-image-v1/derivatives"
)
WINDOWS_SOURCE_ROOT = _configured_path("SMOKIES_S4M_WINDOWS_SOURCE_ROOT") or (
    _WINDOWS_TRAILHEAD_EVIDENCE_ROOT / "smokies-s2-media"
    if _WINDOWS_TRAILHEAD_EVIDENCE_ROOT is not None
    else None
)
WINDOWS_DERIVATIVE_ROOT = _configured_path("SMOKIES_S4M_WINDOWS_DERIVATIVE_ROOT") or (
    _WINDOWS_TRAILHEAD_EVIDENCE_ROOT / "smokies-s4m-six-image-v1/derivatives"
    if _WINDOWS_TRAILHEAD_EVIDENCE_ROOT is not None
    else None
)

ALLOWED_PNG_CHUNKS = ("IHDR", "IDAT", "IEND")
CANDIDATE_IDS = (
    "media_fp_panorama",
    "media_fp_engineering",
    "media_mc_kuwohi",
    "media_mc_oconaluftee",
    "media_cc_cove",
    "media_cc_cable_mill",
)
DERIVATIVE_FILENAMES = (
    "media_fp_panorama_sanitized_v1.png",
    "media_fp_engineering_sanitized_v1.png",
    "media_mc_kuwohi_sanitized_v1.png",
    "media_mc_oconaluftee_sanitized_v1.png",
    "media_cc_cove_sanitized_v1.png",
    "media_cc_cable_mill_sanitized_v1.png",
)


class RemainingArtworkDerivativeError(ValueError):
    """The authorization, source, derivative, or evidence record is invalid."""


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise RemainingArtworkDerivativeError(f"unavailable evidence: {path}") from error
    return digest.hexdigest()


def _load_bound(path: Path, byte_count: int, sha256: str) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size != byte_count:
        raise RemainingArtworkDerivativeError(f"bound byte count drifted: {path}")
    if _sha256_path(path) != sha256:
        raise RemainingArtworkDerivativeError(f"bound SHA-256 drifted: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RemainingArtworkDerivativeError(f"unreadable JSON: {path}") from error
    if not isinstance(value, dict):
        raise RemainingArtworkDerivativeError(f"expected JSON object: {path}")
    return value


def _contracts() -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if _sha256_path(SHARED_PNG_GUARD_PATH) != SHARED_PNG_GUARD_SHA256:
        raise RemainingArtworkDerivativeError("shared PNG verifier drifted")
    packet = _load_bound(PACKET_PATH, PACKET_BYTES, PACKET_SHA256)
    approval = _load_bound(APPROVAL_PATH, APPROVAL_BYTES, APPROVAL_SHA256)
    if packet.get("product_id") != PRODUCT_ID or approval.get("product_id") != PRODUCT_ID:
        raise RemainingArtworkDerivativeError("product identity drifted")
    if approval.get("status") != (
        "checkpoint2_exact_review_sanitation_and_james_render_approved_"
        "downstream_delivery_blocked"
    ):
        raise RemainingArtworkDerivativeError("owner-approval status drifted")
    decision = approval.get("approval", {})
    if decision.get("source_task_id") != SOURCE_TASK_ID:
        raise RemainingArtworkDerivativeError("owner-approval task identity drifted")
    if decision.get("approved_at") != APPROVED_AT:
        raise RemainingArtworkDerivativeError("owner-approval timestamp drifted")
    if decision.get("decision_message_byte_count") != 181 or decision.get(
        "decision_message_sha256"
    ) != "f6a3e3bc71b2b76b5cf791f8fdf11c7084c9e02ce81e05f2d388e17f44569af3":
        raise RemainingArtworkDerivativeError("owner decision-message binding drifted")
    scope = decision.get("scope", {})
    if scope.get("sanitation_original_count") != 6:
        raise RemainingArtworkDerivativeError("authorized sanitation count drifted")

    boundary = approval.get("approval_boundary", {})
    required_true = (
        "remaining_exact_original_artwork_user_approved",
        "six_image_sanitation_authorized",
    )
    required_false = (
        "artwork_derivatives_created",
        "derivative_visual_approval",
        "ingestion_allowed",
        "upload_allowed",
        "manifest_creation_or_mutation_allowed",
        "database_accessed",
        "production_mutation_allowed",
        "trusted_validation_allowed",
        "publication_allowed",
        "public_release",
    )
    if any(boundary.get(key) is not True for key in required_true) or any(
        boundary.get(key) is not False for key in required_false
    ):
        raise RemainingArtworkDerivativeError("owner-approval boundary drifted")
    effects = approval.get("builder_effects", {})
    if effects != {
        "api_keys_created": 0,
        "database_accessed": False,
        "media_files_created": 0,
        "network_accessed": False,
        "production_mutated": False,
        "provider_accessed": False,
        "provider_credits_spent": 0,
        "provider_requests_sent": 0,
    }:
        raise RemainingArtworkDerivativeError("approval-builder effects drifted")
    if approval.get("source_bindings", {}).get("review_packet") != {
        "path": "originals/smokies/remaining_chapters_review_packet_v1.json",
        "byte_count": PACKET_BYTES,
        "sha256": PACKET_SHA256,
    }:
        raise RemainingArtworkDerivativeError("approval-to-packet binding drifted")

    authorized_job = approval.get("authorized_six_image_sanitation_job", {})
    if authorized_job.get("status") != "exact_six_image_sanitation_authorized_not_executed":
        raise RemainingArtworkDerivativeError("sanitation authorization status drifted")
    if authorized_job.get("sanitation_authorized") is not True:
        raise RemainingArtworkDerivativeError("sanitation is not authorized")
    for key in ("derivatives_created", "derivative_visual_approval", "ingestion_allowed", "upload_allowed", "publication_allowed"):
        if authorized_job.get(key) is not False:
            raise RemainingArtworkDerivativeError(f"authorization overreach: {key}")
    items = authorized_job.get("items")
    if not isinstance(items, list) or len(items) != 6:
        raise RemainingArtworkDerivativeError("authorized sanitation membership drifted")
    if tuple(row.get("candidate_id") for row in items) != CANDIDATE_IDS:
        raise RemainingArtworkDerivativeError("authorized sanitation order drifted")
    if tuple(row.get("logical_output_filename") for row in items) != DERIVATIVE_FILENAMES:
        raise RemainingArtworkDerivativeError("authorized derivative names drifted")

    proposed = packet.get("proposed_six_image_sanitation_job", {}).get("items")
    if not isinstance(proposed, list) or len(proposed) != 6:
        raise RemainingArtworkDerivativeError("frozen sanitation proposal drifted")
    expected_authorized = deepcopy(proposed)
    for row in expected_authorized:
        row["sanitation_authorized"] = True
        row["exact_original_user_visual_approval"] = True
    if items != expected_authorized:
        raise RemainingArtworkDerivativeError("authorized sanitation differs from frozen proposal")
    for row in items:
        if row.get("sanitation_authorized") is not True:
            raise RemainingArtworkDerivativeError("sanitation item is not authorized")
        if row.get("derivative_created") is not False or row.get(
            "derivative_user_visual_approval"
        ) is not False:
            raise RemainingArtworkDerivativeError("sanitation item gained derivative approval")
        if row.get("crop_allowed") is not False or row.get("resize_allowed") is not False:
            raise RemainingArtworkDerivativeError("full-frame contract drifted")
        if row.get("output_format") != "PNG" or row.get("output_mode") != "RGB":
            raise RemainingArtworkDerivativeError("output format contract drifted")
        if row.get("png_allowed_chunk_types") != list(ALLOWED_PNG_CHUNKS):
            raise RemainingArtworkDerivativeError("PNG chunk contract drifted")
        if row.get("metadata_retained") is not False:
            raise RemainingArtworkDerivativeError("metadata contract drifted")
        if row.get("source_rights_credit_change_note_and_notice_bound") is not True:
            raise RemainingArtworkDerivativeError("rights binding drifted")
        if row.get("ingestion_allowed") is not False or row.get("upload_allowed") is not False or row.get("publication_allowed") is not False:
            raise RemainingArtworkDerivativeError("downstream item gate drifted")

    candidates = packet.get("artwork_candidates")
    if not isinstance(candidates, list) or len(candidates) != 4:
        raise RemainingArtworkDerivativeError("artwork candidate inventory drifted")
    candidate_map = {row["candidate_id"]: row for row in candidates}
    if set(candidate_map) != set(CANDIDATE_IDS[2:]):
        raise RemainingArtworkDerivativeError("artwork candidate identities drifted")
    return approval, packet, items, candidate_map


def _resolve_source(root: Path, candidate_id: str) -> Path:
    names = (candidate_id, f"{candidate_id}.jpg", f"{candidate_id}.tif")
    matches = [root / name for name in names if (root / name).is_file()]
    if len(matches) != 1:
        raise RemainingArtworkDerivativeError(
            f"expected one source copy for {candidate_id} in {root}"
        )
    return matches[0]


def _render(
    path: Path, spec: dict[str, Any], candidate: dict[str, Any] | None
) -> tuple[Image.Image, dict[str, Any]]:
    candidate_id = spec["candidate_id"]
    if path.stat().st_size != spec["source_original_bytes"] or _sha256_path(path) != spec["source_original_sha256"]:
        raise RemainingArtworkDerivativeError(f"source identity drifted: {candidate_id}")
    try:
        with Image.open(path) as source:
            frame_count = getattr(source, "n_frames", 1)
            if frame_count != spec["source_frame_count"]:
                raise RemainingArtworkDerivativeError(f"frame count drifted: {candidate_id}")
            index = spec["selected_source_frame_index"]
            excluded_record = None
            if frame_count > 1:
                if candidate is None or not isinstance(candidate.get("excluded_frame"), dict):
                    raise RemainingArtworkDerivativeError("MPO exclusion contract missing")
                entries = getattr(source, "mpinfo", {}).get(45058)
                if not isinstance(entries, list) or len(entries) != frame_count:
                    raise RemainingArtworkDerivativeError("MPO frame directory drifted")
                primary_type = entries[index].get("Attribute", {}).get("MPType")
                if primary_type != "Baseline MP Primary Image" or primary_type != spec[
                    "selected_source_frame_type"
                ]:
                    raise RemainingArtworkDerivativeError("MPO primary frame drifted")
            elif spec["selected_source_frame_type"] != "single_image":
                raise RemainingArtworkDerivativeError("single-frame type drifted")

            source.seek(index)
            source.load()
            if source.format != spec["source_format"] or source.mode != spec["source_mode"]:
                raise RemainingArtworkDerivativeError(f"source format drifted: {candidate_id}")
            dimensions = {"width": source.width, "height": source.height}
            pixels = source.tobytes()
            pixel_sha = hashlib.sha256(pixels).hexdigest()
            if dimensions != spec["source_dimensions"] or pixel_sha != spec[
                "selected_source_pixel_sha256"
            ]:
                raise RemainingArtworkDerivativeError(f"source pixels drifted: {candidate_id}")

            exif = source.getexif()
            orientation = exif.get(274, 1)
            gps = bool(exif.get_ifd(0x8825)) if 0x8825 in exif else False
            device = any(tag in exif for tag in (271, 272, 305, 316))
            date_identity = any(tag in exif for tag in (269, 306, 315, 36867, 36868))
            if (orientation, gps, device, date_identity) != (
                spec["source_exif_orientation"],
                spec["source_gps_metadata_present"],
                spec["source_device_metadata_present"],
                spec["source_date_or_identity_metadata_present"],
            ):
                raise RemainingArtworkDerivativeError(f"source metadata facts drifted: {candidate_id}")
            icc = source.info.get("icc_profile") or b""
            profile = png_guard._profile_details(icc)
            if profile["byte_count"] != spec["source_icc_profile_bytes"] or profile[
                "sha256"
            ] != spec["source_icc_profile_sha256"]:
                raise RemainingArtworkDerivativeError(f"source ICC drifted: {candidate_id}")
            oriented = ImageOps.exif_transpose(source)
            oriented.load()

            if frame_count > 1:
                assert candidate is not None
                excluded = candidate["excluded_frame"]
                excluded_index = excluded["index"]
                excluded_type = entries[excluded_index].get("Attribute", {}).get("MPType")
                source.seek(excluded_index)
                source.load()
                excluded_record = {
                    "index": excluded_index,
                    "mp_type": excluded_type,
                    "mode": source.mode,
                    "dimensions": {"width": source.width, "height": source.height},
                    "decoded_pixel_sha256": hashlib.sha256(source.tobytes()).hexdigest(),
                    "included_in_derivative": False,
                }
                expected_excluded = {
                    "index": excluded["index"],
                    "mp_type": excluded["mp_type"],
                    "mode": excluded["mode"],
                    "dimensions": excluded["dimensions"],
                    "decoded_pixel_sha256": excluded["decoded_pixel_sha256"],
                    "included_in_derivative": False,
                }
                if excluded_record != expected_excluded:
                    raise RemainingArtworkDerivativeError("MPO excluded frame drifted")
    except RemainingArtworkDerivativeError:
        raise
    except (OSError, SyntaxError) as error:
        raise RemainingArtworkDerivativeError(f"unreadable source: {candidate_id}") from error

    transform = spec["color_transform"]
    try:
        if transform in {
            "embedded_rgb_icc_to_srgb_perceptual_lcms2",
            "select_mpo_baseline_primary_frame_0_then_embedded_rgb_icc_to_srgb_perceptual_lcms2",
        }:
            if spec["source_mode"] != "RGB" or not icc:
                raise RemainingArtworkDerivativeError("tagged RGB precondition drifted")
            output = ImageCms.profileToProfile(
                oriented,
                ImageCms.ImageCmsProfile(io.BytesIO(icc)),
                ImageCms.createProfile("sRGB"),
                renderingIntent=ImageCms.Intent.PERCEPTUAL,
                outputMode="RGB",
                flags=0,
            )
        elif transform == "untagged_rgb_assume_srgb_preserve_sample_values":
            if spec["source_mode"] != "RGB" or icc:
                raise RemainingArtworkDerivativeError("untagged RGB precondition drifted")
            output = oriented.copy()
            if orientation == 1 and output.tobytes() != pixels:
                raise RemainingArtworkDerivativeError("untagged RGB samples changed")
        elif transform == "untagged_l_to_srgb_rgb_equal_channel_replication":
            if spec["source_mode"] != "L" or icc:
                raise RemainingArtworkDerivativeError("grayscale precondition drifted")
            output = oriented.convert("RGB")
            red, green, blue = output.split()
            try:
                red_bytes = red.tobytes()
                if red_bytes != green.tobytes() or red_bytes != blue.tobytes() or red_bytes != oriented.tobytes():
                    raise RemainingArtworkDerivativeError("grayscale samples were not replicated exactly")
            finally:
                red.close()
                green.close()
                blue.close()
        else:
            raise RemainingArtworkDerivativeError(f"unknown transform: {transform}")
    finally:
        oriented.close()

    output.info.clear()
    if output.mode != "RGB" or {"width": output.width, "height": output.height} != spec[
        "output_dimensions"
    ]:
        output.close()
        raise RemainingArtworkDerivativeError(f"output geometry drifted: {candidate_id}")
    return output, {
        "source_format": spec["source_format"],
        "source_mode": spec["source_mode"],
        "source_frame_count": frame_count,
        "source_dimensions": dimensions,
        "selected_source_frame_index": index,
        "selected_source_frame_type": spec["selected_source_frame_type"],
        "selected_source_decoded_pixel_sha256": pixel_sha,
        "excluded_source_frame": excluded_record,
        "source_exif_orientation": orientation,
        "source_gps_metadata_present": gps,
        "source_device_metadata_present": device,
        "source_date_or_identity_metadata_present": date_identity,
        "source_icc_profile": profile,
        "orientation_operation": "exif_transpose_identity",
        "color_transform": transform,
    }


def _source_records(root: Path, items: list[dict[str, Any]], candidates: dict[str, Any]) -> list[dict[str, Any]]:
    if not root.is_dir():
        raise RemainingArtworkDerivativeError(f"source root unavailable: {root}")
    records = []
    for spec in items:
        expected, details = _render(
            _resolve_source(root, spec["candidate_id"]), spec, candidates.get(spec["candidate_id"])
        )
        try:
            output_pixels = hashlib.sha256(expected.tobytes()).hexdigest()
        finally:
            expected.close()
        records.append(
            {
                "candidate_id": spec["candidate_id"],
                "source_original_bytes": spec["source_original_bytes"],
                "source_original_sha256": spec["source_original_sha256"],
                "expected_output_decoded_pixel_sha256": output_pixels,
                **details,
            }
        )
    return records


def verify_source_mirrors() -> list[dict[str, Any]]:
    _, _, items, candidates = _contracts()
    wsl = _source_records(WSL_SOURCE_ROOT, items, candidates)
    windows = _source_records(
        _required_path(WINDOWS_SOURCE_ROOT, "Windows source root"),
        items,
        candidates,
    )
    if wsl != windows:
        raise RemainingArtworkDerivativeError("source mirrors diverged")
    return wsl


def _external(root: Path) -> None:
    if root.resolve(strict=False).is_relative_to(REPOSITORY.resolve()):
        raise RemainingArtworkDerivativeError("derivative root must remain outside Git")


def _required_path(path: Path | None, label: str) -> Path:
    if path is None:
        raise RemainingArtworkDerivativeError(
            f"{label} is unresolved; provide its environment variable or CLI override"
        )
    return path


def _membership(root: Path) -> None:
    if not root.is_dir() or {path.name for path in root.iterdir() if path.is_file()} != set(
        DERIVATIVE_FILENAMES
    ):
        raise RemainingArtworkDerivativeError(f"derivative membership drifted: {root}")


def audit_root(root: Path, source_root: Path) -> list[dict[str, Any]]:
    _, _, items, candidates = _contracts()
    _external(root)
    _membership(root)
    records = []
    for order, spec in enumerate(items, start=1):
        expected, details = _render(
            _resolve_source(source_root, spec["candidate_id"]), spec, candidates.get(spec["candidate_id"])
        )
        try:
            derivative = png_guard._inspect_derivative(
                root / spec["logical_output_filename"], expected
            )
        finally:
            expected.close()
        records.append(
            {
                "candidate_id": spec["candidate_id"],
                "chapter_id": spec["chapter_id"],
                "stable_order": order,
                "source_original_bytes": spec["source_original_bytes"],
                "source_original_sha256": spec["source_original_sha256"],
                "derivative_filename": spec["logical_output_filename"],
                **details,
                **derivative,
                "date_or_identity_metadata_present": False,
            }
        )
    return records


def generate_derivatives(root: Path, source_root: Path) -> list[dict[str, Any]]:
    _, _, items, candidates = _contracts()
    _external(root)
    if root.exists():
        raise RemainingArtworkDerivativeError(f"immutable root already exists: {root}")
    _source_records(source_root, items, candidates)
    root.mkdir(parents=True, exist_ok=False)
    for spec in items:
        expected, _ = _render(
            _resolve_source(source_root, spec["candidate_id"]), spec, candidates.get(spec["candidate_id"])
        )
        partial = root / f"{spec['logical_output_filename']}.partial"
        try:
            expected.save(partial, format="PNG", compress_level=9, optimize=False)
            png_guard._inspect_derivative(partial, expected)
            partial.rename(root / spec["logical_output_filename"])
        finally:
            expected.close()
    return audit_root(root, source_root)


def build(
    *,
    wsl_source_root: Path = WSL_SOURCE_ROOT,
    windows_source_root: Path | None = WINDOWS_SOURCE_ROOT,
    wsl_derivative_root: Path = WSL_DERIVATIVE_ROOT,
    windows_derivative_root: Path | None = WINDOWS_DERIVATIVE_ROOT,
) -> dict[str, Any]:
    approval, packet, items, candidates = _contracts()
    windows_source_root = _required_path(windows_source_root, "Windows source root")
    windows_derivative_root = _required_path(
        windows_derivative_root, "Windows derivative root"
    )
    source_records = _source_records(wsl_source_root, items, candidates)
    windows_source_records = _source_records(windows_source_root, items, candidates)
    if source_records != windows_source_records:
        raise RemainingArtworkDerivativeError("source mirrors diverged")
    wsl = audit_root(wsl_derivative_root, wsl_source_root)
    windows = audit_root(windows_derivative_root, windows_source_root)
    if wsl != windows:
        raise RemainingArtworkDerivativeError("derivative mirrors diverged")
    specs = {row["candidate_id"]: row for row in items}
    expected_pixels = {
        row["candidate_id"]: row["expected_output_decoded_pixel_sha256"]
        for row in source_records
    }
    derivatives = []
    for row in wsl:
        spec = specs[row["candidate_id"]]
        if row["decoded_pixel_sha256"] != expected_pixels[row["candidate_id"]]:
            raise RemainingArtworkDerivativeError("source-to-derivative pixels diverged")
        derivatives.append(
            {
                **row,
                "status": "verified_derivative_user_visual_review_required",
                "external_evidence_locator": (
                    f"smokies_s4m_six_image_v1:{row['derivative_filename']}"
                ),
                "external_copy_count": 2,
                "external_copies_match": True,
                "full_frame_preserved": True,
                "crop": "none",
                "resize": "none",
                "output_color_space": "sRGB",
                "metadata_policy": "structural_png_chunks_only",
                "allowed_png_chunk_types": list(ALLOWED_PNG_CHUNKS),
                "rights_basis": spec["rights_basis"],
                "license_name": spec["license_name"],
                "exact_credit": spec["exact_credit"],
                "source_page_url": spec["source_page_url"],
                "source_asset_url": spec["source_asset_url"],
                "source_license_record_url": spec["source_license_record_url"],
                "required_commercial_notice": spec["required_commercial_notice"],
                "change_note": spec["change_note"],
                "source_rights_credit_change_note_and_notice_bound": True,
                "derivative_user_visual_approval": False,
                "ingestion_allowed": False,
                "upload_allowed": False,
                "publication_allowed": False,
            }
        )
    unique_bytes = sum(row["derivative_bytes"] for row in derivatives)
    return {
        "schema_version": 1,
        "overlay_id": OVERLAY_ID,
        "product_id": PRODUCT_ID,
        "status": "verified_six_image_derivatives_user_visual_review_required",
        "generated_at": GENERATED_AT,
        "source_task_id": SOURCE_TASK_ID,
        "source_bindings": {
            "owner_approval": {
                "path": APPROVAL_PATH.relative_to(REPOSITORY).as_posix(),
                "byte_count": APPROVAL_BYTES,
                "sha256": APPROVAL_SHA256,
                "status": approval["status"],
            },
            "frozen_review_packet": {
                "path": PACKET_PATH.relative_to(REPOSITORY).as_posix(),
                "byte_count": PACKET_BYTES,
                "sha256": PACKET_SHA256,
                "status": packet["status"],
            },
            "shared_png_verifier": {
                "path": SHARED_PNG_GUARD_PATH.relative_to(REPOSITORY).as_posix(),
                "sha256": SHARED_PNG_GUARD_SHA256,
            },
        },
        "source_mirror_audit": {
            "candidate_count": 6,
            "mirror_count": 2,
            "verified_source_copy_count": 12,
            "copies_match": True,
            "paths_serialized": False,
            "raw_exif_values_serialized": False,
            "records": source_records,
        },
        "generation_contract": {
            "network_used": False,
            "provider_used": False,
            "database_accessed": False,
            "source_originals_mutated": False,
            "derivative_binaries_stored_outside_git": True,
            "full_selected_frame_preserved": True,
            "crop": "none",
            "resize": "none",
            "orientation": "Pillow ImageOps.exif_transpose",
            "tagged_color_conversion": "LittleCMS perceptual intent to sRGB",
            "untagged_rgb_handling": "assume sRGB and preserve RGB sample values",
            "untagged_grayscale_handling": "replicate each L sample equally into R G and B",
            "mpo_handling": "select Baseline MP Primary Image frame 0; exclude frame 1",
            "output": "RGB PNG, 8 bits per channel",
            "compression": "Pillow PNG compress_level=9 optimize=false",
            "metadata": "only IHDR, IDAT, and IEND PNG chunks permitted",
            "runtime_versions": {
                "pillow": PILLOW_VERSION,
                "littlecms2": features.version("littlecms2") or "unavailable",
                "zlib": features.version("zlib") or "unavailable",
                "libjpeg_turbo": features.version("libjpeg_turbo") or "unavailable",
                "libtiff": features.version("libtiff") or "unavailable",
            },
        },
        "derivatives": derivatives,
        "summary": {
            "derivative_count": 6,
            "external_copy_count": 12,
            "total_unique_derivative_bytes": unique_bytes,
            "total_mirrored_derivative_bytes": unique_bytes * 2,
            "mpo_primary_frame_selection_count": sum(
                row["source_frame_count"] > 1 for row in derivatives
            ),
            "embedded_profile_to_srgb_count": sum(
                row["source_icc_profile"]["embedded"] is True for row in derivatives
            ),
            "untagged_rgb_preserved_count": sum(
                row["color_transform"]
                == "untagged_rgb_assume_srgb_preserve_sample_values"
                for row in derivatives
            ),
            "grayscale_equal_channel_replication_count": sum(
                row["color_transform"]
                == "untagged_l_to_srgb_rgb_equal_channel_replication"
                for row in derivatives
            ),
            "structural_png_only_count": sum(
                row["ancillary_chunk_count"] == 0 for row in derivatives
            ),
            "metadata_sanitized_count": sum(
                row["exif_tag_count"] == 0
                and row["gps_exif_present"] is False
                and row["device_metadata_present"] is False
                and row["date_or_identity_metadata_present"] is False
                for row in derivatives
            ),
        },
        "approval_gate": {
            "exact_originals_approved": True,
            "six_image_sanitation_authorized": True,
            "immutable_source_mirrors_verified": True,
            "derivatives_complete": True,
            "derivative_hashes_complete": True,
            "derivative_mirrors_complete": True,
            "metadata_sanitation_complete": True,
            "rights_credit_change_notes_and_notices_bound": True,
            "derivative_user_visual_approval": False,
            "ingestion_allowed": False,
            "upload_allowed": False,
            "manifest_creation_or_mutation_allowed": False,
            "database_accessed": False,
            "production_mutation_allowed": False,
            "publication_allowed": False,
            "public_release": False,
            "next_action": "obtain_explicit_approval_of_the_exact_six_derivative_hashes",
        },
    }


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify-evidence", action="store_true")
    parser.add_argument("--generate-approved-evidence", action="store_true")
    parser.add_argument("--verify-source-mirrors-only", action="store_true")
    parser.add_argument("--audit-root", type=Path)
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--wsl-source-root", type=Path, default=WSL_SOURCE_ROOT)
    parser.add_argument("--windows-source-root", type=Path, default=WINDOWS_SOURCE_ROOT)
    parser.add_argument("--wsl-derivative-root", type=Path, default=WSL_DERIVATIVE_ROOT)
    parser.add_argument(
        "--windows-derivative-root", type=Path, default=WINDOWS_DERIVATIVE_ROOT
    )
    args = parser.parse_args()
    if args.audit_root is not None:
        if args.source_root is None:
            raise SystemExit("--audit-root requires --source-root")
        print(serialize({"derivatives": audit_root(args.audit_root, args.source_root)}), end="")
        return 0
    if args.verify_source_mirrors_only:
        windows_source_root = _required_path(
            args.windows_source_root, "Windows source root"
        )
        _, _, items, candidates = _contracts()
        wsl_sources = _source_records(args.wsl_source_root, items, candidates)
        windows_sources = _source_records(windows_source_root, items, candidates)
        if wsl_sources != windows_sources:
            raise RemainingArtworkDerivativeError("source mirrors diverged")
        print(serialize({"sources": wsl_sources}), end="")
        return 0
    if args.generate_approved_evidence:
        windows_source_root = _required_path(
            args.windows_source_root, "Windows source root"
        )
        windows_derivative_root = _required_path(
            args.windows_derivative_root, "Windows derivative root"
        )
        _, _, items, candidates = _contracts()
        if _source_records(args.wsl_source_root, items, candidates) != _source_records(
            windows_source_root, items, candidates
        ):
            raise RemainingArtworkDerivativeError("source mirrors diverged")
        generate_derivatives(args.wsl_derivative_root, args.wsl_source_root)
        generate_derivatives(windows_derivative_root, windows_source_root)
    rendered = serialize(
        build(
            wsl_source_root=args.wsl_source_root,
            windows_source_root=args.windows_source_root,
            wsl_derivative_root=args.wsl_derivative_root,
            windows_derivative_root=args.windows_derivative_root,
        )
    )
    if args.verify_evidence:
        pass  # build() performs the complete source, pixel, metadata, and mirror audit.
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != rendered:
            raise SystemExit("remaining artwork derivative evidence is stale; rebuild it")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
