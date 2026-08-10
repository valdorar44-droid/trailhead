#!/usr/bin/env python3
"""Build the fail-closed Roaring Fork artwork approval overlay.

The overlay records the project owner's visual approval and exact immutable
original-file evidence. It does not create derivatives, authorize ingestion,
bind an application manifest, upload assets, or permit publication.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REPOSITORY = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPOSITORY / "originals/smokies/roaring_fork_artwork_approval_v1.json"
REVIEW_PATH = REPOSITORY / "originals/smokies/roaring_fork_artwork_review_v1.json"
SOURCE_DOSSIER_PATH = REPOSITORY / "originals/smokies/source_dossiers_v1.json"

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
CHAPTER_ID = "roaring_fork"
VARIANT_ID = "one_way"
OVERLAY_ID = "smokies_roaring_fork_artwork_approval_20260810_v1"
APPROVAL_TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"
APPROVED_AT = "2026-08-10T05:27:35Z"

REVIEW_SHA256 = "3030dfdf993b8b33cb116263ba9902dfe9e36c637f4ff7a37b11f878f0f082d4"
SOURCE_DOSSIER_SHA256 = (
    "8eb22ca5110f0f9a4287b8f184624348c2a2ca2dbc36e27ef59fc022057ce18f"
)

WSL_EVIDENCE_ROOT = Path(
    "/home/sean/.openclaw/evidence/roaring-fork-artwork-v1/originals"
)
WINDOWS_EVIDENCE_ROOT = Path(
    "/mnt/c/Users/User/Documents/Codex/evidence/trailhead/"
    "roaring-fork-artwork-v1/originals"
)


class ArtworkApprovalError(ValueError):
    """The approval overlay or its immutable original evidence is invalid."""


ORIGINALS: tuple[dict[str, Any], ...] = (
    {
        "candidate_id": "rf_art_road",
        "filename": "01-rf_art_road.jpg",
        "original_bytes": 9_641_592,
        "original_sha256": "380afe027eb24100d61136e0da16b1f301184aa3d11c144bfdbf937e40945673",
        "original_sha1": "e369769ac496c9393d3bd15d2dcd42bc733a294c",
        "format": "JPEG",
        "mime": "image/jpeg",
        "encoded_dimensions": {"width": 5_712, "height": 4_284},
        "display_dimensions": {"width": 4_284, "height": 5_712},
        "exif_orientation": 6,
        "gps_exif_present": True,
        "source_identity_check": "wikimedia_source_sha1_and_bytes_match",
    },
    {
        "candidate_id": "rf_art_stream",
        "filename": "02-rf_art_stream.jpg",
        "original_bytes": 9_146_001,
        "original_sha256": "48c1fad720524dc4835b712f058294c91f4d2505455d799f996b0070909d8b9d",
        "original_sha1": "bd05ad3d8a9f8b9fdc7e2323bc2015a4e9ace7aa",
        "format": "JPEG",
        "mime": "image/jpeg",
        "encoded_dimensions": {"width": 5_712, "height": 4_284},
        "display_dimensions": {"width": 5_712, "height": 4_284},
        "exif_orientation": 1,
        "gps_exif_present": True,
        "source_identity_check": "wikimedia_source_sha1_and_bytes_match",
    },
    {
        "candidate_id": "rf_art_forest",
        "filename": "03-rf_art_forest.jpg",
        "original_bytes": 5_401_179,
        "original_sha256": "6820eae86fceb5b4bcd9d24e8becae581f51dd8f2ffd2d5301a990a7803045e6",
        "original_sha1": "5034c6662ecc3f6d8333b2a4623a1d640b7630a3",
        "format": "JPEG",
        "mime": "image/jpeg",
        "encoded_dimensions": {"width": 4_032, "height": 3_024},
        "display_dimensions": {"width": 3_024, "height": 4_032},
        "exif_orientation": 6,
        "gps_exif_present": True,
        "source_identity_check": "wikimedia_source_sha1_and_bytes_match",
    },
    {
        "candidate_id": "rf_art_ogle",
        "filename": "04-rf_art_ogle.jpg",
        "original_bytes": 5_281_216,
        "original_sha256": "a828bf6c6d7f2650268f67b39669b1958f80c34dd845705f60423d8a0dfea551",
        "original_sha1": "a14a4f0c7a06b64eb93f79d38311bfbf0f955c6e",
        "format": "JPEG",
        "mime": "image/jpeg",
        "encoded_dimensions": {"width": 4_032, "height": 3_024},
        "display_dimensions": {"width": 4_032, "height": 3_024},
        "exif_orientation": 1,
        "gps_exif_present": True,
        "source_identity_check": "prior_project_sha256_and_bytes_match",
    },
    {
        "candidate_id": "rf_art_historic_cabin",
        "filename": "05-rf_art_historic_cabin.tif",
        "original_bytes": 141_728_100,
        "original_sha256": "8f1b8513bb9b36ba8c9d24df0d4c68d59b068ae619660716045c415e9497e3f3",
        "original_sha1": "9e5992f0f6a370bda203f9918b45d4c029123a16",
        "format": "TIFF",
        "mime": "image/tiff",
        "encoded_dimensions": {"width": 8_416, "height": 5_611},
        "display_dimensions": {"width": 8_416, "height": 5_611},
        "exif_orientation": 1,
        "gps_exif_present": True,
        "source_identity_check": "loc_master_filename_and_bytes_match",
    },
    {
        "candidate_id": "rf_art_grotto_falls",
        "filename": "06-rf_art_grotto_falls.jpg",
        "original_bytes": 1_760_245,
        "original_sha256": "43905360fb3bce9db8d657f921e8df65705378f1d89343cca2393ff91da54338",
        "original_sha1": "1aed514adffd762c73b0eb21cf4f124f98a476d5",
        "format": "JPEG",
        "mime": "image/jpeg",
        "encoded_dimensions": {"width": 2_182, "height": 1_470},
        "display_dimensions": {"width": 2_182, "height": 1_470},
        "exif_orientation": None,
        "gps_exif_present": False,
        "source_identity_check": "nps_asset_id_bytes_and_dimensions_match",
    },
    {
        "candidate_id": "rf_art_thousand_drips",
        "filename": "07-rf_art_thousand_drips.jpg",
        "original_bytes": 1_799_456,
        "original_sha256": "ff2004dcdd090fa272c0adfada26e4028d8db2244aaffc52b68be65bc42f93ab",
        "original_sha1": "208b2a8d40d46aa9ea19f620dbac728ba35ca302",
        "format": "JPEG",
        "mime": "image/jpeg",
        "encoded_dimensions": {"width": 1_489, "height": 2_180},
        "display_dimensions": {"width": 1_489, "height": 2_180},
        "exif_orientation": None,
        "gps_exif_present": False,
        "source_identity_check": "nps_asset_id_bytes_and_dimensions_match",
    },
)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ArtworkApprovalError(f"unavailable JSON input: {path}") from error
    if not isinstance(value, dict):
        raise ArtworkApprovalError(f"expected JSON object: {path}")
    return value


def _sha256_path(path: Path) -> str:
    value = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                value.update(chunk)
    except OSError as error:
        raise ArtworkApprovalError(f"unavailable evidence input: {path}") from error
    return value.hexdigest()


def _binding(path: Path, expected_sha256: str) -> dict[str, Any]:
    actual = _sha256_path(path)
    if actual != expected_sha256:
        raise ArtworkApprovalError(f"source binding drifted: {path}")
    return {
        "path": path.relative_to(REPOSITORY).as_posix(),
        "byte_count": path.stat().st_size,
        "sha256": actual,
    }


def build() -> dict[str, Any]:
    review = _load_json(REVIEW_PATH)
    source_dossier = _load_json(SOURCE_DOSSIER_PATH)
    if any(
        (
            review.get("product_id") != PRODUCT_ID,
            review.get("chapter_id") != CHAPTER_ID,
            review.get("variant_id") != VARIANT_ID,
            source_dossier.get("product_id") != PRODUCT_ID,
        )
    ):
        raise ArtworkApprovalError("bound artwork or dossier identity drifted")
    if review.get("status") != "user_visual_approval_required":
        raise ArtworkApprovalError("pre-approval review packet was mutated")
    if review.get("approval_gate", {}).get("user_visual_approval") is not False:
        raise ArtworkApprovalError("pre-approval review packet no longer fails closed")

    review_candidates = {
        row["candidate_id"]: row
        for row in review.get("candidates", [])
        if isinstance(row, dict) and isinstance(row.get("candidate_id"), str)
    }
    expected_ids = {row["candidate_id"] for row in ORIGINALS}
    if set(review_candidates) != expected_ids:
        raise ArtworkApprovalError("approved candidate inventory drifted")

    originals = []
    for index, evidence in enumerate(ORIGINALS, start=1):
        candidate = review_candidates[evidence["candidate_id"]]
        originals.append(
            {
                **evidence,
                "stable_order": index,
                "status": "visually_approved_original_verified_derivative_pending",
                "user_visual_approval": True,
                "original_immutable": True,
                "ingestion_allowed": False,
                "source_page_url": candidate["source_page_url"],
                "download_url": candidate["download_url"],
                "creator": candidate["creator"],
                "license_name": candidate["license_name"],
                "license_url": candidate["license_url"],
                "exact_credit": candidate["exact_credit"],
                "claim_limit": candidate["claim_limit"],
                "review_dimensions": candidate["review_dimensions"],
                "wsl_evidence_path": (
                    "/home/sean/.openclaw/evidence/roaring-fork-artwork-v1/"
                    f"originals/{evidence['filename']}"
                ),
                "windows_mirror_path": (
                    "C:\\Users\\User\\Documents\\Codex\\evidence\\trailhead\\"
                    "roaring-fork-artwork-v1\\originals\\"
                    f"{evidence['filename']}"
                ),
            }
        )

    return {
        "schema_version": 1,
        "overlay_id": OVERLAY_ID,
        "product_id": PRODUCT_ID,
        "chapter_id": CHAPTER_ID,
        "variant_id": VARIANT_ID,
        "status": "approved_originals_verified_derivatives_pending",
        "recorded_at": APPROVED_AT,
        "approval": {
            "approved_at": APPROVED_AT,
            "approved_by": "project_owner",
            "decision": "approve_all",
            "decision_text": "approve all",
            "source_task_id": APPROVAL_TASK_ID,
            "scope": "all_seven_candidates_in_bound_review_packet",
        },
        "source_bindings": [
            _binding(REVIEW_PATH, REVIEW_SHA256),
            _binding(SOURCE_DOSSIER_PATH, SOURCE_DOSSIER_SHA256),
        ],
        "originals": originals,
        "summary": {
            "approved_candidate_count": len(originals),
            "downloaded_after_approval_count": 6,
            "reused_prior_verified_original_count": 1,
            "immutable_original_count": len(originals),
            "mirrored_original_count": len(originals),
            "total_original_bytes": sum(row["original_bytes"] for row in originals),
            "gps_exif_original_count": sum(
                1 for row in originals if row["gps_exif_present"]
            ),
        },
        "approval_gate": {
            "user_visual_approval": True,
            "original_downloads_complete": True,
            "original_hashes_complete": True,
            "immutable_originals_mirrored": True,
            "orientation_normalized_derivatives_complete": False,
            "gps_device_exif_stripped_derivatives_complete": False,
            "licensed_derivatives_complete": False,
            "verified_upload_evidence_complete": False,
            "private_manifest_v3_artwork_binding_complete": False,
            "ingestion_allowed": False,
            "public_release": False,
            "next_action": (
                "build_separately_hashed_orientation_normalized_"
                "gps_device_exif_stripped_derivatives"
            ),
        },
    }


def verify_evidence(wsl_root: Path, windows_root: Path) -> dict[str, Any]:
    expected_names = {row["filename"] for row in ORIGINALS}
    for root in (wsl_root, windows_root):
        if not root.is_dir():
            raise ArtworkApprovalError(f"evidence root is unavailable: {root}")
        actual_names = {path.name for path in root.iterdir() if path.is_file()}
        if actual_names != expected_names:
            raise ArtworkApprovalError(f"evidence membership drifted: {root}")

    for evidence in ORIGINALS:
        for root in (wsl_root, windows_root):
            path = root / evidence["filename"]
            if path.stat().st_size != evidence["original_bytes"]:
                raise ArtworkApprovalError(f"evidence byte count drifted: {path}")
            if _sha256_path(path) != evidence["original_sha256"]:
                raise ArtworkApprovalError(f"evidence SHA-256 drifted: {path}")

    return {
        "verified_original_count": len(ORIGINALS),
        "verified_copy_count": len(ORIGINALS) * 2,
        "total_original_bytes": sum(row["original_bytes"] for row in ORIGINALS),
        "copies_match": True,
    }


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify-evidence", action="store_true")
    parser.add_argument("--wsl-evidence-root", type=Path, default=WSL_EVIDENCE_ROOT)
    parser.add_argument(
        "--windows-evidence-root", type=Path, default=WINDOWS_EVIDENCE_ROOT
    )
    args = parser.parse_args()

    rendered = serialize(build())
    if args.verify_evidence:
        verify_evidence(args.wsl_evidence_root, args.windows_evidence_root)
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Roaring Fork artwork approval overlay is stale; rebuild it")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
