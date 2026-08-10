#!/usr/bin/env python3
"""Build and verify fail-closed Roaring Fork artwork derivatives.

This stage applies recorded EXIF orientation, converts tagged source color to
sRGB, preserves the full frame, writes RGB PNG files without ancillary PNG
chunks, and verifies mirrored evidence. It does not ingest, upload, bind an
application manifest, deploy, publish, or authorize public release.
"""
from __future__ import annotations

import argparse
import binascii
import hashlib
import io
import json
import struct
from pathlib import Path
from typing import Any

from PIL import Image, ImageCms, ImageOps, __version__ as PILLOW_VERSION, features


REPOSITORY = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPOSITORY / "originals/smokies/roaring_fork_artwork_derivatives_v1.json"
APPROVAL_PATH = REPOSITORY / "originals/smokies/roaring_fork_artwork_approval_v1.json"

APPROVAL_SHA256 = "c67111d87bd0bc2aae2cf1b8d763030de2852a1620d61fb38413f54ce54b995f"
OVERLAY_ID = "smokies_roaring_fork_artwork_derivatives_20260810_v1"
GENERATED_AT = "2026-08-10T05:41:30Z"

WSL_ORIGINAL_ROOT = Path(
    "/home/sean/.openclaw/evidence/roaring-fork-artwork-v1/originals"
)
WSL_DERIVATIVE_ROOT = Path(
    "/home/sean/.openclaw/evidence/roaring-fork-artwork-v1/derivatives"
)
WINDOWS_DERIVATIVE_ROOT = Path(
    "/mnt/c/Users/User/Documents/Codex/evidence/trailhead/"
    "roaring-fork-artwork-v1/derivatives"
)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
ALLOWED_PNG_CHUNKS = ("IHDR", "IDAT", "IEND")
DERIVATIVE_FILENAMES = (
    "01-rf_art_road.png",
    "02-rf_art_stream.png",
    "03-rf_art_forest.png",
    "04-rf_art_ogle.png",
    "05-rf_art_historic_cabin.png",
    "06-rf_art_grotto_falls.png",
    "07-rf_art_thousand_drips.png",
)


class ArtworkDerivativeError(ValueError):
    """The source, derivative, or fail-closed derivative overlay is invalid."""


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ArtworkDerivativeError(f"unavailable JSON input: {path}") from error
    if not isinstance(value, dict):
        raise ArtworkDerivativeError(f"expected JSON object: {path}")
    return value


def _sha256_path(path: Path) -> str:
    value = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                value.update(chunk)
    except OSError as error:
        raise ArtworkDerivativeError(f"unavailable evidence input: {path}") from error
    return value.hexdigest()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _approval() -> dict[str, Any]:
    if _sha256_path(APPROVAL_PATH) != APPROVAL_SHA256:
        raise ArtworkDerivativeError("approved-original overlay binding drifted")
    value = _load_json(APPROVAL_PATH)
    if value.get("status") != "approved_originals_verified_derivatives_pending":
        raise ArtworkDerivativeError("approved-original overlay status drifted")
    gate = value.get("approval_gate", {})
    if gate.get("user_visual_approval") is not True:
        raise ArtworkDerivativeError("original visual approval is no longer present")
    if gate.get("ingestion_allowed") is not False or gate.get("public_release") is not False:
        raise ArtworkDerivativeError("approved-original overlay no longer fails closed")
    originals = value.get("originals")
    if not isinstance(originals, list) or len(originals) != len(DERIVATIVE_FILENAMES):
        raise ArtworkDerivativeError("approved-original inventory drifted")
    return value


def _verify_source(path: Path, original: dict[str, Any]) -> None:
    if not path.is_file():
        raise ArtworkDerivativeError(f"approved original is unavailable: {path}")
    if path.stat().st_size != original["original_bytes"]:
        raise ArtworkDerivativeError(f"approved original byte count drifted: {path}")
    if _sha256_path(path) != original["original_sha256"]:
        raise ArtworkDerivativeError(f"approved original SHA-256 drifted: {path}")


def _profile_details(icc_profile: bytes | None) -> dict[str, Any]:
    if not icc_profile:
        return {
            "embedded": False,
            "byte_count": 0,
            "sha256": None,
            "name": None,
            "description": None,
        }
    try:
        profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_profile))
        name = ImageCms.getProfileName(profile).strip()
        description = ImageCms.getProfileDescription(profile).strip()
    except Exception as error:
        raise ArtworkDerivativeError("source ICC profile is unreadable") from error
    return {
        "embedded": True,
        "byte_count": len(icc_profile),
        "sha256": _sha256_bytes(icc_profile),
        "name": name,
        "description": description,
    }


def _render_expected(
    source_path: Path, original: dict[str, Any]
) -> tuple[Image.Image, dict[str, Any]]:
    _verify_source(source_path, original)
    try:
        with Image.open(source_path) as source:
            source.load()
            if source.mode != "RGB":
                raise ArtworkDerivativeError(
                    f"approved original mode drifted: {source_path} ({source.mode})"
                )
            if source.format != original["format"]:
                raise ArtworkDerivativeError(f"approved original format drifted: {source_path}")
            if tuple(source.size) != (
                original["encoded_dimensions"]["width"],
                original["encoded_dimensions"]["height"],
            ):
                raise ArtworkDerivativeError(
                    f"approved original dimensions drifted: {source_path}"
                )

            exif = source.getexif()
            orientation = exif.get(274)
            if orientation != original["exif_orientation"]:
                raise ArtworkDerivativeError(
                    f"approved original orientation drifted: {source_path}"
                )
            gps_present = bool(exif.get_ifd(0x8825)) if 0x8825 in exif else False
            if gps_present is not original["gps_exif_present"]:
                raise ArtworkDerivativeError(f"approved original GPS state drifted: {source_path}")

            icc_profile = source.info.get("icc_profile")
            profile = _profile_details(icc_profile)
            oriented = ImageOps.exif_transpose(source)
            oriented.load()
            if icc_profile:
                try:
                    converted = ImageCms.profileToProfile(
                        oriented,
                        ImageCms.ImageCmsProfile(io.BytesIO(icc_profile)),
                        ImageCms.createProfile("sRGB"),
                        renderingIntent=ImageCms.Intent.PERCEPTUAL,
                        outputMode="RGB",
                        flags=0,
                    )
                except Exception as error:
                    raise ArtworkDerivativeError(
                        f"source color conversion failed: {source_path}"
                    ) from error
                color_transform = "embedded_rgb_icc_to_srgb_perceptual_lcms2"
            else:
                converted = oriented.convert("RGB")
                color_transform = "untagged_rgb_assumed_srgb_pixels_unchanged"
    except ArtworkDerivativeError:
        raise
    except (OSError, SyntaxError) as error:
        raise ArtworkDerivativeError(f"approved original is unreadable: {source_path}") from error

    converted.info.clear()
    expected_size = (
        original["display_dimensions"]["width"],
        original["display_dimensions"]["height"],
    )
    if converted.size != expected_size:
        raise ArtworkDerivativeError(
            f"orientation-normalized dimensions drifted: {source_path}"
        )
    return converted, {
        "source_mode": "RGB",
        "source_exif_tag_count": len(exif),
        "source_gps_exif_present": gps_present,
        "source_exif_orientation": orientation,
        "source_icc_profile": profile,
        "orientation_operation": (
            "exif_transpose_rotate_90_degrees_clockwise"
            if orientation == 6
            else "exif_transpose_identity"
        ),
        "color_transform": color_transform,
    }


def _png_chunks(path: Path) -> list[str]:
    try:
        data = path.read_bytes()
    except OSError as error:
        raise ArtworkDerivativeError(f"derivative PNG is unreadable: {path}") from error
    if not data.startswith(PNG_SIGNATURE):
        raise ArtworkDerivativeError(f"invalid PNG signature: {path}")
    chunks: list[str] = []
    offset = len(PNG_SIGNATURE)
    while offset < len(data):
        if offset + 12 > len(data):
            raise ArtworkDerivativeError(f"truncated PNG chunk: {path}")
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type_bytes = data[offset + 4 : offset + 8]
        chunk_end = offset + 12 + length
        if chunk_end > len(data):
            raise ArtworkDerivativeError(f"truncated PNG payload: {path}")
        payload = data[offset + 8 : offset + 8 + length]
        recorded_crc = struct.unpack(">I", data[offset + 8 + length : chunk_end])[0]
        actual_crc = binascii.crc32(chunk_type_bytes + payload) & 0xFFFFFFFF
        if recorded_crc != actual_crc:
            raise ArtworkDerivativeError(f"invalid PNG CRC: {path}")
        try:
            chunk_type = chunk_type_bytes.decode("ascii")
        except UnicodeDecodeError as error:
            raise ArtworkDerivativeError(f"invalid PNG chunk type: {path}") from error
        chunks.append(chunk_type)
        offset = chunk_end
        if chunk_type == "IEND":
            break
    if offset != len(data):
        raise ArtworkDerivativeError(f"trailing bytes after PNG IEND: {path}")
    if not chunks or chunks[0] != "IHDR" or chunks[-1] != "IEND":
        raise ArtworkDerivativeError(f"invalid PNG chunk order: {path}")
    if "IDAT" not in chunks:
        raise ArtworkDerivativeError(f"PNG has no image payload: {path}")
    unexpected = sorted(set(chunks) - set(ALLOWED_PNG_CHUNKS))
    if unexpected:
        raise ArtworkDerivativeError(
            f"PNG contains forbidden ancillary chunks {unexpected}: {path}"
        )
    return chunks


def _inspect_derivative(path: Path, expected: Image.Image) -> dict[str, Any]:
    chunks = _png_chunks(path)
    try:
        with Image.open(path) as derivative:
            derivative.load()
            if derivative.format != "PNG" or derivative.mode != "RGB":
                raise ArtworkDerivativeError(f"derivative format or mode drifted: {path}")
            if derivative.size != expected.size:
                raise ArtworkDerivativeError(f"derivative dimensions drifted: {path}")
            if derivative.info:
                raise ArtworkDerivativeError(f"derivative metadata is not empty: {path}")
            if len(derivative.getexif()) != 0:
                raise ArtworkDerivativeError(f"derivative EXIF is not empty: {path}")
            pixel_sha256 = _sha256_bytes(derivative.tobytes())
    except ArtworkDerivativeError:
        raise
    except (OSError, SyntaxError) as error:
        raise ArtworkDerivativeError(f"derivative PNG is unreadable: {path}") from error
    expected_pixel_sha256 = _sha256_bytes(expected.tobytes())
    if pixel_sha256 != expected_pixel_sha256:
        raise ArtworkDerivativeError(f"derivative pixels drifted: {path}")
    return {
        "derivative_bytes": path.stat().st_size,
        "derivative_sha256": _sha256_path(path),
        "decoded_pixel_sha256": pixel_sha256,
        "dimensions": {"width": expected.width, "height": expected.height},
        "format": "PNG",
        "mime": "image/png",
        "mode": "RGB",
        "bit_depth": 8,
        "png_chunk_types": list(dict.fromkeys(chunks)),
        "png_chunk_count": len(chunks),
        "idat_chunk_count": chunks.count("IDAT"),
        "ancillary_chunk_count": 0,
        "exif_tag_count": 0,
        "gps_exif_present": False,
        "device_metadata_present": False,
    }


def _derivative_name(index: int, original_filename: str) -> str:
    expected = DERIVATIVE_FILENAMES[index - 1]
    if not expected.startswith(f"{index:02d}-"):
        raise ArtworkDerivativeError("derivative stable order is invalid")
    if Path(original_filename).stem != Path(expected).stem:
        raise ArtworkDerivativeError("original and derivative identities diverged")
    return expected


def _expected_membership(root: Path) -> None:
    if not root.is_dir():
        raise ArtworkDerivativeError(f"derivative evidence root is unavailable: {root}")
    actual = {path.name for path in root.iterdir() if path.is_file()}
    if actual != set(DERIVATIVE_FILENAMES):
        raise ArtworkDerivativeError(f"derivative evidence membership drifted: {root}")


def audit_root(
    derivative_root: Path, source_root: Path = WSL_ORIGINAL_ROOT
) -> list[dict[str, Any]]:
    approval = _approval()
    _expected_membership(derivative_root)
    records: list[dict[str, Any]] = []
    for index, original in enumerate(approval["originals"], start=1):
        filename = _derivative_name(index, original["filename"])
        expected, source_details = _render_expected(source_root / original["filename"], original)
        try:
            derivative_details = _inspect_derivative(derivative_root / filename, expected)
        finally:
            expected.close()
        records.append(
            {
                "candidate_id": original["candidate_id"],
                "stable_order": index,
                "original_filename": original["filename"],
                "original_bytes": original["original_bytes"],
                "original_sha256": original["original_sha256"],
                "derivative_filename": filename,
                **source_details,
                **derivative_details,
            }
        )
    return records


def generate_derivatives(
    output_root: Path, source_root: Path = WSL_ORIGINAL_ROOT
) -> list[dict[str, Any]]:
    approval = _approval()
    if output_root.exists() and any(output_root.iterdir()):
        raise ArtworkDerivativeError(f"generation root is not empty: {output_root}")
    output_root.mkdir(parents=True, exist_ok=True)
    for index, original in enumerate(approval["originals"], start=1):
        filename = _derivative_name(index, original["filename"])
        expected, _ = _render_expected(source_root / original["filename"], original)
        try:
            output_path = output_root / filename
            expected.save(
                output_path,
                format="PNG",
                compress_level=9,
                optimize=False,
            )
        finally:
            expected.close()
    return audit_root(output_root, source_root)


def _runtime_versions() -> dict[str, str]:
    return {
        "pillow": PILLOW_VERSION,
        "littlecms2": features.version("littlecms2") or "unavailable",
        "zlib": features.version("zlib") or "unavailable",
        "libjpeg_turbo": features.version("libjpeg_turbo") or "unavailable",
    }


def _change_note(original: dict[str, Any]) -> str:
    return (
        "Full frame preserved with no crop or resize; recorded EXIF orientation "
        "applied; tagged source color converted to sRGB where present; converted "
        "to PNG; EXIF, GPS, device, text, time, and other ancillary metadata removed."
    )


def build(
    wsl_root: Path = WSL_DERIVATIVE_ROOT,
    windows_root: Path = WINDOWS_DERIVATIVE_ROOT,
    source_root: Path = WSL_ORIGINAL_ROOT,
) -> dict[str, Any]:
    approval = _approval()
    wsl_records = audit_root(wsl_root, source_root)
    windows_records = audit_root(windows_root, source_root)
    if wsl_records != windows_records:
        raise ArtworkDerivativeError("WSL and Windows derivative evidence diverged")

    originals_by_id = {row["candidate_id"]: row for row in approval["originals"]}
    derivatives = []
    for record in wsl_records:
        original = originals_by_id[record["candidate_id"]]
        derivatives.append(
            {
                **record,
                "status": "verified_derivative_user_visual_review_required",
                "user_visual_approval": False,
                "ingestion_allowed": False,
                "full_frame_preserved": True,
                "crop": "none",
                "resize": "none",
                "output_color_space": "sRGB",
                "metadata_policy": "structural_png_chunks_only",
                "allowed_png_chunk_types": list(ALLOWED_PNG_CHUNKS),
                "exact_credit": original["exact_credit"],
                "creator": original["creator"],
                "license_name": original["license_name"],
                "license_url": original["license_url"],
                "source_page_url": original["source_page_url"],
                "claim_limit": original["claim_limit"],
                "change_note": _change_note(original),
                "wsl_evidence_path": str(wsl_root / record["derivative_filename"]),
                "windows_mirror_path": (
                    "C:\\Users\\User\\Documents\\Codex\\evidence\\trailhead\\"
                    "roaring-fork-artwork-v1\\derivatives\\"
                    f"{record['derivative_filename']}"
                ),
            }
        )

    return {
        "schema_version": 1,
        "overlay_id": OVERLAY_ID,
        "product_id": approval["product_id"],
        "chapter_id": approval["chapter_id"],
        "variant_id": approval["variant_id"],
        "status": "verified_derivatives_user_visual_review_required",
        "generated_at": GENERATED_AT,
        "source_binding": {
            "path": APPROVAL_PATH.relative_to(REPOSITORY).as_posix(),
            "byte_count": APPROVAL_PATH.stat().st_size,
            "sha256": APPROVAL_SHA256,
        },
        "generation_contract": {
            "network_used": False,
            "source_originals_mutated": False,
            "full_frame_preserved": True,
            "crop": "none",
            "resize": "none",
            "orientation": "Pillow ImageOps.exif_transpose",
            "tagged_color_conversion": "LittleCMS perceptual intent to sRGB",
            "untagged_color_handling": "assume sRGB; preserve RGB sample values",
            "output": "RGB PNG, 8 bits per channel",
            "compression": "Pillow PNG compress_level=9 optimize=false",
            "metadata": "only IHDR, IDAT, and IEND PNG chunks permitted",
            "runtime_versions": _runtime_versions(),
        },
        "derivatives": derivatives,
        "summary": {
            "derivative_count": len(derivatives),
            "mirrored_derivative_count": len(derivatives),
            "total_derivative_bytes": sum(row["derivative_bytes"] for row in derivatives),
            "orientation_rotated_count": sum(
                1
                for row in derivatives
                if row["orientation_operation"]
                == "exif_transpose_rotate_90_degrees_clockwise"
            ),
            "embedded_profile_to_srgb_count": sum(
                1
                for row in derivatives
                if row["source_icc_profile"]["embedded"] is True
            ),
            "structural_png_only_count": sum(
                1 for row in derivatives if row["ancillary_chunk_count"] == 0
            ),
            "metadata_sanitized_count": sum(
                1
                for row in derivatives
                if row["exif_tag_count"] == 0
                and row["gps_exif_present"] is False
                and row["device_metadata_present"] is False
            ),
        },
        "approval_gate": {
            "original_user_visual_approval": True,
            "immutable_originals_verified": True,
            "orientation_normalized_derivatives_complete": True,
            "gps_device_exif_stripped_derivatives_complete": True,
            "licensed_derivatives_complete": True,
            "derivative_hashes_complete": True,
            "derivative_mirror_complete": True,
            "derivative_user_visual_approval": False,
            "verified_upload_evidence_complete": False,
            "private_manifest_v3_artwork_binding_complete": False,
            "ingestion_allowed": False,
            "public_release": False,
            "next_action": "obtain_explicit_derivative_visual_approval",
        },
    }


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify-evidence", action="store_true")
    parser.add_argument("--generate-root", type=Path)
    parser.add_argument("--audit-root", type=Path)
    parser.add_argument("--source-root", type=Path, default=WSL_ORIGINAL_ROOT)
    parser.add_argument("--wsl-derivative-root", type=Path, default=WSL_DERIVATIVE_ROOT)
    parser.add_argument(
        "--windows-derivative-root", type=Path, default=WINDOWS_DERIVATIVE_ROOT
    )
    args = parser.parse_args()

    if args.generate_root is not None:
        print(serialize({"derivatives": generate_derivatives(args.generate_root, args.source_root)}), end="")
        return 0
    if args.audit_root is not None:
        print(serialize({"derivatives": audit_root(args.audit_root, args.source_root)}), end="")
        return 0

    value = build(
        wsl_root=args.wsl_derivative_root,
        windows_root=args.windows_derivative_root,
        source_root=args.source_root,
    )
    rendered = serialize(value)
    if args.verify_evidence:
        # build() already performs full pixel, metadata, membership, and mirror checks.
        pass
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Roaring Fork artwork derivative overlay is stale; rebuild it")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
