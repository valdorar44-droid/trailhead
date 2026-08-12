#!/usr/bin/env python3
"""Build the fail-closed full-Smokies private migration packet.

This builder is intentionally network-, provider-, database-, and external-media-free.
It describes a later guarded migration; it never opens the live database or accepted
media roots and it never performs an upload, attestation, validation, or release.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.store import _validate_trip_pack_fields  # noqa: E402
from db.originals_complete_validation import (  # noqa: E402
    OriginalValidationRunnerError,
    trusted_complete_originals_long_form_validator_source_paths,
    trusted_complete_originals_long_form_validator_source_sha256,
)
from scripts import build_smokies_complete_private_candidate as candidate_builder  # noqa: E402


PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
PACKET_ID = "smokies_complete_private_migration_20260811_v1"
AUDIT_CONTRACT_ID = "smokies_complete_private_migration_operator_audit_contract_v1"
MIGRATION_BASE_SOURCE_REVISION = {
    "commit": "4d24fe44a02bbf957c8200399612151f84a1e83a",
    "tree": "9393a7a0049f8c0f4eef60d18ca5579d9f9aeef4",
}
PRIVATE_CANDIDATE_COMMIT_REVISION = {
    "commit": "6acfb31d80294f0d90e559a080c11af138c6a559",
    "tree": "5656cd375b3194b9613eed5fa97a0689fd08f4bf",
}
EXPECTED_CANDIDATE_SOURCE_REVISION = {
    "commit": "102fff55328f4d15ec5757f82f87d235508ebb2b",
    "tree": "3017790b491545559634c498612ce4a017a0d880",
    "frozen_route_readiness_slice_committed": True,
    "uncommitted_release_guard_work_bound": False,
}
PACKET_PATH = Path("originals/smokies/smokies_complete_private_migration_packet_v1.json")
AUDIT_CONTRACT_PATH = Path(
    "originals/smokies/smokies_complete_private_migration_operator_audit_contract_v1.json"
)

CANDIDATE_PATH = Path("originals/smokies/smokies_complete_private_candidate_v1.json")
MANIFEST_PATH = Path("originals/smokies/smokies_complete_private_manifest_v3.json")
PROFILE_TEMPLATE_PATH = Path("originals/smokies/smokies_pack_narration_profile_v2.json")
ATTRIBUTION_PATH = Path("originals/smokies/smokies_pack_attribution_set_v1.json")
MEDIA_ACCEPTANCE_PATH = Path("originals/smokies/remaining_media_acceptance_v1.json")
RF_PACKET_PATH = Path("originals/smokies/roaring_fork_private_import_packet_v1.json")
RF_RECEIPT_PATH = Path("originals/smokies/roaring_fork_private_import_receipt_v1.json")
RF_MANIFEST_PATH = Path("originals/smokies/roaring_fork_private_manifest_v3.json")
RF_PROFILE_PATH = Path("originals/smokies/roaring_fork_narration_profile_v2.json")
RF_PROFILE_EVIDENCE_PATH = Path(
    "originals/smokies/roaring_fork_narration_profile_evidence_v1.json"
)
RF_READINESS_INPUTS_PATH = Path(
    "originals/smokies/roaring_fork_publication_readiness_inputs_v1.json"
)
POSTPURCHASE_PREFLIGHT_PATH = Path(
    "originals/smokies/elevenlabs_james_remaining_postpurchase_preflight_v2.json"
)
RELEASE_GUARD_AUDIT_PATH = Path(
    "originals/smokies/smokies_v3_release_guard_audit_v1.json"
)
RF_IMPORT_OPERATOR_PATH = Path("scripts/import_smokies_roaring_fork_private.py")
BACKUP_OPERATOR_PATH = Path("scripts/backup_sqlite.py")
MANIFEST_NORMALIZER_PATH = Path("db/original_manifest_v3.py")
STORE_PATH = Path("db/store.py")
CANDIDATE_BUILDER_PATH = Path("scripts/build_smokies_complete_private_candidate.py")
COMPLETE_VALIDATION_PATH = Path("db/originals_complete_validation.py")
MOBILE_LONG_FORM_VALIDATOR_PATH = Path(
    "mobile/scripts/validate-original-long-form.ts"
)
MOBILE_LONG_FORM_EVIDENCE_REGISTRY_PATH = Path(
    "mobile/lib/originals/longFormValidationEvidence.ts"
)
EXPECTED_COMPLETE_VALIDATOR_SOURCE_PATH_COUNT = 174
EXPECTED_COMPLETE_VALIDATOR_SOURCE_SHA256 = (
    "b01033dcdf155370688c5fd4ce1e9264d670505b1958b7135b1724e39d52235f"
)
COMPLETE_VALIDATOR_SOURCE_FRAMING = (
    "for each repo-relative path sorted by POSIX path: "
    "utf8(path) + NUL + ascii(decimal_byte_count) + NUL + raw_bytes + NUL"
)

# Store is intentionally pinned to the exact working-tree source settled by the
# release-guard slice. Any later store change makes this packet stale and blocks
# live use until the packet is deliberately regenerated and re-audited.
EXPECTED_SOURCE_SHA256 = {
    str(CANDIDATE_PATH): "ee01f78dcb43ec9a3b9d02e1cd6e0271675f033dbc9ed6fb18ce2562b4cb0aee",
    str(MANIFEST_PATH): "d2cfa5aeb0116359326f682fb49d59ee156157f9efbfb8e8a53f99e830ca54eb",
    str(PROFILE_TEMPLATE_PATH): "10fd4f5f04cbfbc411a1e7c31061700d17752af61e1501a4b7b4652c0d2ee377",
    str(ATTRIBUTION_PATH): "b8be1091be196faf4d93c9930c3a0be3b1d1cd7acc2a056512329d7140e6483d",
    str(MEDIA_ACCEPTANCE_PATH): "e593b5f280b62e00a0887e24cef131858e768f1cbe056476e3b631342a788a2a",
    str(RF_PACKET_PATH): "15d3a10b3a387cd23e1271e2d07428772d8f60e4568cbd417ef292d627252c1f",
    str(RF_RECEIPT_PATH): "8890c1e1431654a03feb1aa4ee4376ab50504e9841b4d8a06f0a3c003b0ebefd",
    str(RF_MANIFEST_PATH): "7e9cab7e0325c6124a2605c83867929780f575e5814c7fdc634c091a9c351467",
    str(RF_PROFILE_PATH): "10fd4f5f04cbfbc411a1e7c31061700d17752af61e1501a4b7b4652c0d2ee377",
    str(RF_PROFILE_EVIDENCE_PATH): "66cb0ed535470f5da239b3a089682153a1505ba434795225526f440202d60bf3",
    str(RF_READINESS_INPUTS_PATH): "555c4282a39b7f1affbcd7481645bba14649235df1d693883dd0a461b41879ec",
    str(POSTPURCHASE_PREFLIGHT_PATH): "161257f717e4c2ae3d344f295c6f2ec8b4ce5febd819e167086ed97f68f57a29",
    str(RELEASE_GUARD_AUDIT_PATH): "bf401385db767549063cb626b95693253fc6626d146ec109b0ae31a48777cbf8",
    str(RF_IMPORT_OPERATOR_PATH): "6cac2f3841cf3af12eb48aaba6e2a7108d1aafddbc7b5a4762a194189d6c5bce",
    str(BACKUP_OPERATOR_PATH): "85491c0e16b84a5ea9c42ed1f669521b5d9b10628a6bedbb23ae96790d566bcf",
    str(MANIFEST_NORMALIZER_PATH): "850df80086d336a3a3652d73a1e0eda403e89f06b241c2a710bcb6cbf38e53de",
    str(STORE_PATH): "3f1468b4b20f1a4518e194f1fd82ba943d6a5e03d2f03c09d73370819d98c97b",
    str(CANDIDATE_BUILDER_PATH): "7b287d30a661841f4476b3c32dfdfc2165637048fc9c5aef5af0bfbcaf97d1a1",
    str(COMPLETE_VALIDATION_PATH): "6e68f243a0ee1776cfdc9dfa5b1ebb393c18cdffb01a97071bcc14fa3d5104c6",
    str(MOBILE_LONG_FORM_VALIDATOR_PATH): "e632c9637428f21c93aabaa4e7ffc7439809a4fc83646dd0cc1d2b45785b7482",
    str(MOBILE_LONG_FORM_EVIDENCE_REGISTRY_PATH): "c6d5f3ea1b358b12cb5b01ce18c93891540e9504fb9606fbd8f3bbc704671c3a",
}

EXPECTED_PREDECESSOR = {
    "draft_revision": 2,
    "profile_absent_manifest_canonical_sha256": (
        "2fb77582811e28ef963f3018a8990a96612cfedee69f3b2329a73b87ac99d33a"
    ),
    "profiled_manifest_canonical_sha256": (
        "14d83293ba3b09aad00998668311447b5224f5172e641d35163de2865e3c9eb8"
    ),
    "narration_profile_canonical_sha256": (
        "f79b386031ca0faf6e07332e53ea037f957eb7d9871c4bbf05d5b0aff09c2af5"
    ),
    "device_preview_evidence_canonical_sha256": (
        "f17ac77a29718cef56ccb2556e44e86800d81482fd0e9cca18acb2537722f750"
    ),
    "validation_metadata_canonical_sha256": (
        "d236deee4a079a42b4cecc6a07b57448a3ed60c8632fd5a3a6f2075ce9cac2c7"
    ),
    "current_asset_count": 20,
    "narration_count": 13,
    "image_count": 7,
    "published_version_count": 0,
}

TERMS_TUPLE = {
    "terms_id": "elevenlabs_terms_of_service_non_eea_2026-03-31",
    "terms_url": "https://elevenlabs.io/terms-of-use",
    "terms_version": "31 March 2026",
    "reviewed_at": "2026-08-10",
}


class MigrationPacketBuildError(ValueError):
    """The deterministic migration packet cannot be built safely."""


def _unverified_generator_metadata() -> dict[str, Any]:
    """Match the existing RF importer without importing its Pillow runtime."""
    return {
        "provider": "elevenlabs",
        "api_version": "elevenlabs_text_to_speech_v1",
        "model_id": "eleven_multilingual_v2",
        "voice_id": "EkK5I93UQWFDigLMpZcX",
        "output_format": "mp3_44100_128",
        "provider_native_master": True,
        "lossless_master_claimed": False,
        "transcoded": False,
        "license_status": "unverified",
    }


def _path(relative: Path) -> Path:
    return ROOT / relative


def _read_json(relative: Path) -> dict[str, Any]:
    try:
        value = json.loads(_path(relative).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MigrationPacketBuildError(f"cannot read {relative}") from exc
    if not isinstance(value, dict):
        raise MigrationPacketBuildError(f"{relative} must contain an object")
    return value


def _sha256_path(relative: Path) -> str:
    digest = hashlib.sha256()
    try:
        with _path(relative).open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise MigrationPacketBuildError(f"cannot hash {relative}") from exc
    return digest.hexdigest()


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _render(value: dict[str, Any]) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def _checked_sources() -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for raw_path, expected in EXPECTED_SOURCE_SHA256.items():
        relative = Path(raw_path)
        actual = _sha256_path(relative)
        if actual != expected:
            raise MigrationPacketBuildError(f"source drifted: {relative}")
        rows[raw_path] = {
            "path": raw_path,
            "sha256": actual,
            "byte_count": _path(relative).stat().st_size,
        }
    return rows


def _checked_complete_validator_closure() -> dict[str, Any]:
    """Bind every current backend/mobile validation dependency byte-for-byte."""
    try:
        paths = trusted_complete_originals_long_form_validator_source_paths()
        reported_sha256 = (
            trusted_complete_originals_long_form_validator_source_sha256()
        )
    except (OSError, OriginalValidationRunnerError) as exc:
        raise MigrationPacketBuildError(
            "complete trusted-validator source closure is unavailable"
        ) from exc
    normalized = tuple(Path(path) for path in paths)
    expected_order = tuple(sorted(normalized, key=lambda item: item.as_posix()))
    if (
        len(normalized) != EXPECTED_COMPLETE_VALIDATOR_SOURCE_PATH_COUNT
        or normalized != expected_order
        or len(set(normalized)) != len(normalized)
        or any(path.is_absolute() or ".." in path.parts for path in normalized)
    ):
        raise MigrationPacketBuildError(
            "complete trusted-validator source inventory drifted"
        )
    required_entrypoints = {
        STORE_PATH,
        COMPLETE_VALIDATION_PATH,
        MOBILE_LONG_FORM_VALIDATOR_PATH,
        MOBILE_LONG_FORM_EVIDENCE_REGISTRY_PATH,
    }
    if not required_entrypoints.issubset(set(normalized)):
        raise MigrationPacketBuildError(
            "complete trusted-validator source entrypoints are missing"
        )

    digest = hashlib.sha256()
    entries: list[dict[str, Any]] = []
    for relative in normalized:
        absolute = _path(relative)
        try:
            payload = absolute.read_bytes()
        except OSError as exc:
            raise MigrationPacketBuildError(
                f"complete trusted-validator source is unavailable: {relative}"
            ) from exc
        relative_posix = relative.as_posix()
        digest.update(relative_posix.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(payload)).encode("ascii"))
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
        entries.append(
            {
                "path": relative_posix,
                "byte_count": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        )
    calculated_sha256 = digest.hexdigest()
    if (
        reported_sha256 != calculated_sha256
        or calculated_sha256 != EXPECTED_COMPLETE_VALIDATOR_SOURCE_SHA256
    ):
        raise MigrationPacketBuildError(
            "complete trusted-validator source hash drifted"
        )
    return {
        "schema_version": 1,
        "framing": COMPLETE_VALIDATOR_SOURCE_FRAMING,
        "path_count": len(entries),
        "sha256": calculated_sha256,
        "paths": entries,
    }


def _normalized_draft(
    base_manifest: dict[str, Any], attribution: dict[str, Any]
) -> dict[str, Any]:
    artwork_credits = {
        str(item["asset_id"]): {
            "exact_credit": item["exact_credit"],
            "license_name": item["license_name"],
            "rights_basis": item["rights_basis"],
            "change_note": item["change_note"],
            "required_commercial_notice": item["required_commercial_notice"],
        }
        for item in attribution["artwork_attributions"]
    }
    public_metadata = {
        "access_policy": {
            "schema_version": 1,
            "explorer_included": True,
            "permanent_credit_price": 900,
        },
        "artwork_credits": artwork_credits,
        "attribution_set_id": attribution["attribution_id"],
        "attribution_set_sha256": EXPECTED_SOURCE_SHA256[str(ATTRIBUTION_PATH)],
        "chapter_ids": [
            "mountain_crossing",
            "little_river_cades_cove",
            "roaring_fork",
            "foothills_parkway",
        ],
        "explorer_included": True,
        "pack_scope": "one_premium_four_chapter_product",
        "permanent_credit_price": 900,
        "private_review_only": True,
        "public_release": False,
        "standalone_product_ids": [],
    }
    validation_metadata = {
        "admin_license_attestation_complete": False,
        "artwork_derivatives_visually_approved": True,
        "audio_assets_reviewed": True,
        "authenticated_device_preview_complete": False,
        "dual_platform_private_preview_complete": False,
        "media_licenses_reviewed": True,
        "migration_packet_id": PACKET_ID,
        "public_release": False,
        "transcripts_reviewed": True,
        "trusted_publication_validation_complete": False,
        "verified_private_upload_complete": False,
    }
    chapters = {str(row["id"]): row for row in base_manifest["chapters"]}
    template = {
        "alerts": [],
        "bookings": [],
        "days": [
            {"day": index, "title": chapters[chapter_id]["title"]}
            for index, chapter_id in enumerate(
                (
                    "mountain_crossing",
                    "little_river_cades_cove",
                    "roaring_fork",
                    "foothills_parkway",
                ),
                start=1,
            )
        ],
        "items": [
            {"id": story["id"], "title": story["title"], "type": story["kind"]}
            for story in base_manifest["stories"]
        ],
        "notes": [],
        "offline": {
            "region_id": base_manifest["offline_map"]["region_id"],
            "status": "private_download_review_pending",
        },
        "readiness": {"status": "private_full_bundle_migration"},
        "regions": ["TN", "NC"],
    }
    clean = _validate_trip_pack_fields(
        PRODUCT_ID,
        "great-smoky-mountains-ridges-rivers-living-memory",
        base_manifest["title"],
        (
            "A private four-chapter Great Smoky Mountains driving-tour candidate "
            "covering Mountain Crossing, Little River and Cades Cove, Roaring Fork, "
            "and Foothills Parkway. Not yet public."
        ),
        900,
        "north_america",
        public_metadata,
        validation_metadata,
        template,
        "original_drive",
        base_manifest,
    )
    return {
        "pack_id": clean["id"],
        "content_kind": clean["content_kind"],
        "slug": clean["slug"],
        "title": clean["title"],
        "summary": clean["summary"],
        "price_credits": clean["price_credits"],
        "coverage_region": clean["coverage_region"],
        "public_metadata": clean["public_metadata"],
        "public_metadata_json": clean["public_metadata_json"],
        "validation_metadata": clean["validation_metadata"],
        "validation_metadata_json": clean["validation_metadata_json"],
        "validation_metadata_canonical_sha256": _canonical_sha256(
            clean["validation_metadata"]
        ),
        "template": clean["template"],
        "template_json": clean["template_json"],
        "original_manifest": clean["original_manifest"],
        "original_manifest_json": clean["original_manifest_json"],
        "original_manifest_canonical_sha256": _canonical_sha256(
            clean["original_manifest"]
        ),
    }


def _new_asset_specs(
    manifest: dict[str, Any], media: dict[str, Any]
) -> list[dict[str, Any]]:
    accepted_audio = media.get("accepted_narration_set", {}).get("items")
    accepted_images = media.get("accepted_derivative_images", {}).get("items")
    if not isinstance(accepted_audio, list) or len(accepted_audio) != 72:
        raise MigrationPacketBuildError("media acceptance must bind 72 narrations")
    if not isinstance(accepted_images, list) or len(accepted_images) != 6:
        raise MigrationPacketBuildError("media acceptance must bind six images")
    if (
        media.get("normalized_approval_scope", {}).get(
            "exact_72_file_narration_set_owner_accepted"
        )
        is not True
        or media.get("normalized_approval_scope", {}).get(
            "exact_six_derivative_hashes_owner_visual_accepted"
        )
        is not True
        or media.get("acceptance_boundary", {}).get("rerender_authorized") is not False
        or media.get("acceptance_boundary", {}).get("publication_allowed") is not False
    ):
        raise MigrationPacketBuildError("media acceptance gates drifted")
    manifest_assets = {str(row["id"]): row for row in manifest["assets"]}
    if len(manifest_assets) != 98:
        raise MigrationPacketBuildError("full manifest must contain 98 unique assets")

    specs: list[dict[str, Any]] = []
    for accepted in accepted_audio:
        request_id = str(accepted["provider_request_id"])
        asset_id = candidate_builder._audio_asset_id(request_id)
        manifest_asset = manifest_assets.get(asset_id)
        expected = {
            "kind": "narration",
            "mime_type": "audio/mpeg",
            "bytes": int(accepted["audio_bytes"]),
            "sha256": str(accepted["audio_sha256"]),
            "path": candidate_builder._asset_path(asset_id, accepted["audio_sha256"]),
        }
        if manifest_asset is None or any(
            manifest_asset.get(key) != value for key, value in expected.items()
        ):
            raise MigrationPacketBuildError(f"manifest narration drifted: {asset_id}")
        profile = accepted["technical_profile"]
        specs.append(
            {
                "asset_id": asset_id,
                "bytes": int(accepted["audio_bytes"]),
                "chapter_id": accepted["chapter_id"],
                "entry_id": accepted["entry_id"],
                "generator_metadata": _unverified_generator_metadata(),
                "kind": "narration",
                "media": {
                    "bitrate_kbps": int(profile["bitrate_kbps"]),
                    "channels": int(profile["channels"]),
                    "duration_s": round(float(accepted["duration_s"]), 3),
                    "format": "mp3",
                    "sample_rate_hz": int(profile["sample_rate_hz"]),
                },
                "mime_type": "audio/mpeg",
                "provider_request_id": request_id,
                "public_path": expected["path"],
                "request_kind": accepted["request_kind"],
                "accepted_duration_s": float(accepted["duration_s"]),
                "sha256": accepted["audio_sha256"],
                "source_relative_path": accepted["master_file"],
                "source_root": "accepted_remaining_narration_root",
                "stable_order": int(accepted["set_order"]),
                "transcript_sha256": accepted["raw_transcript_sha256"],
            }
        )

    images_by_candidate = {
        str(item["candidate_id"]): item for item in accepted_images
    }
    if set(images_by_candidate) != set(candidate_builder.IMAGE_ASSET_IDS):
        raise MigrationPacketBuildError("accepted image membership drifted")
    for candidate_id, asset_id in candidate_builder.IMAGE_ASSET_IDS.items():
        accepted = images_by_candidate[candidate_id]
        manifest_asset = manifest_assets.get(asset_id)
        expected = {
            "kind": "image",
            "mime_type": "image/png",
            "bytes": int(accepted["derivative_bytes"]),
            "sha256": str(accepted["derivative_sha256"]),
            "path": candidate_builder._asset_path(
                asset_id, accepted["derivative_sha256"]
            ),
        }
        if manifest_asset is None or any(
            manifest_asset.get(key) != value for key, value in expected.items()
        ):
            raise MigrationPacketBuildError(f"manifest image drifted: {asset_id}")
        if (
            accepted.get("exact_derivative_hash_owner_visual_accepted") is not True
            or accepted.get("source_rights_credit_change_note_and_notice_bound")
            is not True
        ):
            raise MigrationPacketBuildError(f"image acceptance drifted: {candidate_id}")
        specs.append(
            {
                "asset_id": asset_id,
                "bytes": int(accepted["derivative_bytes"]),
                "candidate_id": candidate_id,
                "chapter_id": accepted["chapter_id"],
                "decoded_pixel_sha256": accepted["decoded_pixel_sha256"],
                "generator_metadata": {},
                "kind": "image",
                "media": {
                    "format": "png",
                    "height": int(accepted["dimensions"]["height"]),
                    "width": int(accepted["dimensions"]["width"]),
                },
                "mime_type": "image/png",
                "public_path": expected["path"],
                "sha256": accepted["derivative_sha256"],
                "source_relative_path": accepted["derivative_filename"],
                "source_root": "accepted_remaining_artwork_root",
                "stable_order": int(accepted["stable_order"]),
                "transcript_sha256": None,
            }
        )
    if (
        len(specs) != 78
        or sum(row["kind"] == "narration" for row in specs) != 72
        or sum(row["kind"] == "image" for row in specs) != 6
        or len({row["asset_id"] for row in specs}) != 78
    ):
        raise MigrationPacketBuildError("new migration asset inventory drifted")
    return sorted(specs, key=lambda row: str(row["asset_id"]))


def _existing_rf_assets(
    manifest: dict[str, Any], rf_packet: dict[str, Any]
) -> list[dict[str, Any]]:
    assets = rf_packet.get("assets")
    if not isinstance(assets, list) or len(assets) != 20:
        raise MigrationPacketBuildError("Roaring Fork packet must contain 20 assets")
    manifest_assets = {str(row["id"]): row for row in manifest["assets"]}
    rows: list[dict[str, Any]] = []
    for item in assets:
        asset_id = str(item["asset_id"])
        manifest_asset = manifest_assets.get(asset_id)
        if manifest_asset is None or any(
            manifest_asset.get(key) != value
            for key, value in {
                "kind": item["kind"],
                "mime_type": item["mime_type"],
                "bytes": int(item["bytes"]),
                "sha256": item["sha256"],
            }.items()
        ):
            raise MigrationPacketBuildError(
                f"Roaring Fork manifest asset drifted: {asset_id}"
            )
        expected_path = candidate_builder._asset_path(asset_id, item["sha256"])
        if manifest_asset.get("path") != expected_path:
            raise MigrationPacketBuildError(
                f"Roaring Fork asset path drifted: {asset_id}"
            )
        row = copy.deepcopy(item)
        row["public_path"] = expected_path
        rows.append(row)
    if len({row["asset_id"] for row in rows}) != 20:
        raise MigrationPacketBuildError("Roaring Fork asset ids are not unique")
    return sorted(rows, key=lambda row: str(row["asset_id"]))


def _audit_contract(
    source_bindings: dict[str, dict[str, Any]],
    complete_validator_closure: dict[str, Any],
) -> dict[str, Any]:
    closure_binding = {
        key: copy.deepcopy(complete_validator_closure[key])
        for key in ("schema_version", "framing", "path_count", "sha256")
    }
    return {
        "schema_version": 1,
        "contract_id": AUDIT_CONTRACT_ID,
        "kind": "original_private_migration_operator_audit_contract",
        "product_id": PRODUCT_ID,
        "required_artifact": {
            "schema_version": 1,
            "kind": "original_private_migration_operator_audit",
            "status": "independent_audit_passed",
            "required_bindings": [
                "migration_packet",
                "packet_builder",
                "migration_operator",
                "migration_operator_tests",
                "db_store",
                "complete_private_candidate_builder",
                "complete_validation_dispatcher",
                "mobile_long_form_validator",
                "mobile_long_form_evidence_registry",
                "complete_validator_source_closure",
                "v3_release_guard_audit",
                "roaring_fork_import_operator",
                "sqlite_backup_operator",
                "manifest_v3_normalizer",
                "source_commit_and_tree",
            ],
            "required_findings": {
                "p0_count": 0,
                "p1_count": 0,
                "author_source_files_edited_by_auditor": 0,
                "audit_artifact_created_by_auditor": True,
            },
        },
        "transitive_source_contract": {
            key: source_bindings[key]
            for key in (
                str(STORE_PATH),
                str(CANDIDATE_BUILDER_PATH),
                str(COMPLETE_VALIDATION_PATH),
                str(MOBILE_LONG_FORM_VALIDATOR_PATH),
                str(MOBILE_LONG_FORM_EVIDENCE_REGISTRY_PATH),
                str(RELEASE_GUARD_AUDIT_PATH),
                str(RF_IMPORT_OPERATOR_PATH),
                str(BACKUP_OPERATOR_PATH),
                str(MANIFEST_NORMALIZER_PATH),
            )
        },
        "complete_validator_source_closure": closure_binding,
        "audit_state": {
            "independent_audit_artifact_created": False,
            "independent_audit_passed": False,
            "live_apply_allowed": False,
        },
        "boundaries": {
            "database_accessed": False,
            "external_media_accessed": False,
            "network_accessed": False,
            "production_mutation_performed": False,
            "publication_performed": False,
        },
    }


def build_bundle() -> tuple[dict[str, Any], dict[str, Any]]:
    source_bindings = _checked_sources()
    complete_validator_closure = _checked_complete_validator_closure()
    candidate = _read_json(CANDIDATE_PATH)
    manifest = _read_json(MANIFEST_PATH)
    profile_template = _read_json(PROFILE_TEMPLATE_PATH)
    attribution = _read_json(ATTRIBUTION_PATH)
    media = _read_json(MEDIA_ACCEPTANCE_PATH)
    rf_packet = _read_json(RF_PACKET_PATH)
    rf_receipt = _read_json(RF_RECEIPT_PATH)
    rf_manifest = _read_json(RF_MANIFEST_PATH)
    rf_profile = _read_json(RF_PROFILE_PATH)
    rf_profile_evidence = _read_json(RF_PROFILE_EVIDENCE_PATH)
    readiness_inputs = _read_json(RF_READINESS_INPUTS_PATH)
    provider_preflight = _read_json(POSTPURCHASE_PREFLIGHT_PATH)
    release_guard_audit = _read_json(RELEASE_GUARD_AUDIT_PATH)
    rf_draft = rf_packet.get("draft")
    if not isinstance(rf_draft, dict):
        raise MigrationPacketBuildError("Roaring Fork predecessor draft is missing")
    rf_clean = _validate_trip_pack_fields(
        PRODUCT_ID,
        rf_draft["slug"],
        rf_draft["title"],
        rf_draft["summary"],
        int(rf_draft["price_credits"]),
        rf_draft["coverage_region"],
        rf_draft["public_metadata"],
        rf_draft["validation_metadata"],
        rf_draft["template"],
        "original_drive",
        rf_manifest,
    )
    rf_immutable_draft_fields = {
        "slug": rf_clean["slug"],
        "draft_title": rf_clean["title"],
        "draft_summary": rf_clean["summary"],
        "draft_price_credits": int(rf_clean["price_credits"]),
        "draft_coverage_region": rf_clean["coverage_region"],
        "draft_public_metadata": rf_clean["public_metadata_json"],
        "draft_template_json": rf_clean["template_json"],
    }

    if candidate.get("product_id") != PRODUCT_ID or candidate.get("status") != (
        "complete_private_candidate_owner_dual_platform_preview_required"
    ):
        raise MigrationPacketBuildError("full private candidate identity drifted")
    if candidate.get("source_revision") != EXPECTED_CANDIDATE_SOURCE_REVISION:
        raise MigrationPacketBuildError("candidate route-readiness provenance drifted")
    if manifest.get("schema_version") != 3 or len(manifest.get("assets", [])) != 98:
        raise MigrationPacketBuildError("full Manifest V3 identity drifted")
    if profile_template != rf_profile:
        raise MigrationPacketBuildError(
            "accepted pack profile template must preserve the historical RF profile bytes"
        )
    if (
        _canonical_sha256(profile_template)
        != EXPECTED_PREDECESSOR["narration_profile_canonical_sha256"]
    ):
        raise MigrationPacketBuildError("historical narration profile drifted")
    if (
        readiness_inputs.get("private_state_at_s4r_readback", {}).get(
            "profiled_manifest_sha256"
        )
        != EXPECTED_PREDECESSOR["profiled_manifest_canonical_sha256"]
        or readiness_inputs.get("private_state_at_s4r_readback", {}).get(
            "device_preview_evidence_sha256"
        )
        != EXPECTED_PREDECESSOR["device_preview_evidence_canonical_sha256"]
    ):
        raise MigrationPacketBuildError("historical private-state binding drifted")
    if (
        rf_receipt.get("target", {}).get("classification") != "configured_private"
        or rf_receipt.get("post_import", {}).get("published_version_count") != 0
        or rf_receipt.get("post_import", {}).get("current_asset_count") != 20
    ):
        raise MigrationPacketBuildError("Roaring Fork import receipt drifted")
    if (
        rf_receipt.get("started_at") != "2026-08-10T07:15:06Z"
        or rf_receipt.get("completed_at") != "2026-08-10T07:15:10Z"
    ):
        raise MigrationPacketBuildError("Roaring Fork import time evidence drifted")
    historical_report = readiness_inputs.get(
        "trusted_private_validation_at_s4r_readback"
    )
    expected_historical_report = {
        "source_commit": "111a4eb7cc8bb21ac1bbdd3418b1dbec4ca90637",
        "report_id": "original_validation_9df694c93ee9ef3809c33f451d04bf28",
        "redacted_report_sha256": (
            "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059"
        ),
        "status": "passed",
        "current": True,
        "engine": "original-trigger-v3",
        "selection": "roaring_fork_one_way_private_v1:one_way",
        "route_scenarios_required": 13,
        "route_scenarios_passed": 13,
        "issues": [],
        "publication_approval": False,
        "live_report_rechecked_by_publication_readiness_builder": False,
    }
    if historical_report != expected_historical_report:
        raise MigrationPacketBuildError("Roaring Fork historical report evidence drifted")
    if (
        provider_preflight.get("terms_gate", {}).get("jurisdiction") != "non_eea"
        or provider_preflight.get("terms_gate", {}).get("policy_tuple", {}).get(
            "primary_terms", {}
        ).get("terms_id")
        != TERMS_TUPLE["terms_id"]
        or provider_preflight.get("terms_gate", {}).get("policy_tuple", {}).get(
            "primary_terms", {}
        ).get("url")
        != TERMS_TUPLE["terms_url"]
    ):
        raise MigrationPacketBuildError("reviewed non-EEA terms tuple drifted")
    release_guard_bindings = release_guard_audit.get("bindings", {})
    if (
        release_guard_audit.get("kind")
        != "original_v3_single_use_release_guard_independent_audit"
        or release_guard_audit.get("status") != "independent_audit_passed"
        or release_guard_audit.get("product_id") != PRODUCT_ID
        or release_guard_audit.get("findings")
        != {
            "audit_artifact_created_by_auditor": True,
            "author_source_files_edited_by_auditor": 0,
            "p0_count": 0,
            "p1_count": 0,
        }
        or release_guard_bindings.get("source_revision")
        != MIGRATION_BASE_SOURCE_REVISION
        or release_guard_bindings.get("store") != source_bindings[str(STORE_PATH)]
        or release_guard_bindings.get("private_candidate", {}).get("artifact")
        != source_bindings[str(CANDIDATE_PATH)]
        or release_guard_bindings.get("all_six_dispatch_closure", {}).get(
            "path_count"
        )
        != complete_validator_closure["path_count"]
        or release_guard_bindings.get("all_six_dispatch_closure", {}).get(
            "framed_sha256"
        )
        != complete_validator_closure["sha256"]
    ):
        raise MigrationPacketBuildError("V3 release-guard audit binding drifted")
    rf_attestation_terms = rf_profile_evidence.get("common_license_terms", {})
    if any(rf_attestation_terms.get(key) != TERMS_TUPLE[key] for key in TERMS_TUPLE):
        raise MigrationPacketBuildError("Roaring Fork attestation terms drifted")

    base_manifest = copy.deepcopy(manifest)
    removed_profile = base_manifest.pop("narration_profile", None)
    if removed_profile != profile_template:
        raise MigrationPacketBuildError("candidate narration profile template drifted")
    draft = _normalized_draft(base_manifest, attribution)
    full_profiled_manifest_sha = _canonical_sha256(manifest)
    expected_full_profiled = candidate.get("manifest", {}).get(
        "normalized_canonical_sha256"
    )
    if full_profiled_manifest_sha != expected_full_profiled:
        raise MigrationPacketBuildError("full profiled manifest canonical hash drifted")

    new_assets = _new_asset_specs(manifest, media)
    existing_assets = _existing_rf_assets(manifest, rf_packet)
    if set(row["asset_id"] for row in new_assets) & set(
        row["asset_id"] for row in existing_assets
    ):
        raise MigrationPacketBuildError("existing and new asset ids overlap")
    all_asset_sha = {
        str(row["asset_id"]): str(row["sha256"])
        for row in [*existing_assets, *new_assets]
    }
    manifest_asset_sha = {
        str(row["id"]): str(row["sha256"]) for row in manifest["assets"]
    }
    if all_asset_sha != manifest_asset_sha:
        raise MigrationPacketBuildError("migration asset membership differs from manifest")
    new_narration_sha = {
        row["asset_id"]: row["sha256"]
        for row in new_assets
        if row["kind"] == "narration"
    }
    all_narration_sha = {
        row["id"]: row["sha256"]
        for row in manifest["assets"]
        if row["kind"] == "narration"
    }
    audit_contract = _audit_contract(source_bindings, complete_validator_closure)
    audit_contract_bytes = _render(audit_contract)

    policy_tuple = provider_preflight["terms_gate"]["policy_tuple"]
    terms_policy_sha = _canonical_sha256(
        {"jurisdiction": "non_eea", "policy_tuple": policy_tuple}
    )
    rf_redacted_attestations = {
        str(row["asset_id"]): str(row["redacted_attestation_sha256"])
        for row in rf_profile_evidence.get("attestations", [])
    }
    rf_narration_ids = {
        str(row["asset_id"])
        for row in existing_assets
        if row["kind"] == "narration"
    }
    if set(rf_redacted_attestations) != rf_narration_ids:
        raise MigrationPacketBuildError("Roaring Fork attestation membership drifted")
    packet = {
        "schema_version": 1,
        "packet_id": PACKET_ID,
        "kind": "original_full_bundle_private_migration_packet",
        "product_id": PRODUCT_ID,
        "status": "network_and_database_free_plan_live_apply_locked",
        "source_revision": copy.deepcopy(MIGRATION_BASE_SOURCE_REVISION),
        "private_candidate_commit_revision": copy.deepcopy(
            PRIVATE_CANDIDATE_COMMIT_REVISION
        ),
        "candidate_source_revision": copy.deepcopy(candidate["source_revision"]),
        "source_bindings": source_bindings,
        "trusted_complete_validator_source_closure": complete_validator_closure,
        "v3_release_guard_independent_audit": {
            **copy.deepcopy(source_bindings[str(RELEASE_GUARD_AUDIT_PATH)]),
            "status": release_guard_audit["status"],
            "p0_count": release_guard_audit["findings"]["p0_count"],
            "p1_count": release_guard_audit["findings"]["p1_count"],
            "runtime_source_commit_and_tree": copy.deepcopy(
                MIGRATION_BASE_SOURCE_REVISION
            ),
        },
        "operator_audit_contract": {
            "path": str(AUDIT_CONTRACT_PATH),
            "byte_count": len(audit_contract_bytes),
            "sha256": hashlib.sha256(audit_contract_bytes).hexdigest(),
            "independent_audit_artifact_present": False,
            "live_apply_allowed": False,
        },
        "configured_target_binding": {
            "target_id": rf_receipt["target"]["id"],
            "database_path_sha256": rf_receipt["target"]["database_path_sha256"],
            "asset_root_path_sha256": rf_receipt["target"]["asset_root_path_sha256"],
            "raw_database_or_asset_root_path_serialized": False,
        },
        "predecessor": {
            **copy.deepcopy(EXPECTED_PREDECESSOR),
            "pack_id": PRODUCT_ID,
            "status": "draft",
            "content_kind": "original_drive",
            "current_published_version": None,
            "immutable_draft_fields": rf_immutable_draft_fields,
            "profile_source_path": str(RF_PROFILE_PATH),
            "profile_source_sha256": source_bindings[str(RF_PROFILE_PATH)]["sha256"],
            "existing_asset_sha256": {
                row["asset_id"]: row["sha256"] for row in existing_assets
            },
            "existing_asset_sha256_set_sha256": _canonical_sha256(
                sorted(row["sha256"] for row in existing_assets)
            ),
            "existing_narration_redacted_attestation_sha256": (
                rf_redacted_attestations
            ),
            "historical_import_window": {
                "started_at": rf_receipt["started_at"],
                "completed_at": rf_receipt["completed_at"],
                "source_path": str(RF_RECEIPT_PATH),
                "source_sha256": source_bindings[str(RF_RECEIPT_PATH)]["sha256"],
            },
            "permitted_validation_history": {
                **copy.deepcopy(expected_historical_report),
                "expected_report_count": 1,
                "expected_suite_version": "originals_virtual_route_v3",
                "expected_draft_revision": 2,
                "readback_observed_at": readiness_inputs[
                    "private_state_at_s4r_readback"
                ]["observed_at"],
                "source_path": str(RF_READINESS_INPUTS_PATH),
                "source_sha256": source_bindings[str(RF_READINESS_INPUTS_PATH)][
                    "sha256"
                ],
            },
            "existing_assets_must_be_rehashed_under_write_lock": True,
            "existing_rows_and_profile_evidence_must_remain_byte_unchanged": True,
        },
        "migration_draft": {
            **draft,
            "expected_before_revision": 2,
            "expected_after_revision": 3,
            "profile_intentionally_absent_until_post_attestation_cas": True,
            "asset_count": 98,
            "narration_asset_count": 85,
            "image_asset_count": 13,
            "chapter_count": 4,
            "variant_count": 6,
            "base_entry_count": 77,
            "directional_substitution_count": 8,
            "offline_region_count": 1,
        },
        "final_profiled_candidate": {
            "source_manifest_path": str(MANIFEST_PATH),
            "source_manifest_sha256": source_bindings[str(MANIFEST_PATH)]["sha256"],
            "source_manifest_canonical_sha256": full_profiled_manifest_sha,
            "profile_settings_template_path": str(PROFILE_TEMPLATE_PATH),
            "profile_settings_template_sha256": source_bindings[
                str(PROFILE_TEMPLATE_PATH)
            ]["sha256"],
            "profile_settings_template_canonical_sha256": _canonical_sha256(
                profile_template
            ),
            "not_directly_committed_by_migration": True,
            "not_yet_valid_after_new_attestations": True,
            "reason": (
                "commercial_license.verified_at must be replaced with the latest "
                "server-owned attested_at across all 85 narration assets"
            ),
        },
        "assets": {
            "existing_roaring_fork": existing_assets,
            "new": new_assets,
            "counts": {
                "existing": 20,
                "new": 78,
                "new_narration": 72,
                "new_images": 6,
                "committed_total": 98,
                "committed_narration": 85,
                "committed_images": 13,
            },
            "all_asset_sha256": all_asset_sha,
            "all_asset_sha256_set_sha256": _canonical_sha256(
                sorted(all_asset_sha.values())
            ),
            "new_asset_sha256_set_sha256": _canonical_sha256(
                sorted(row["sha256"] for row in new_assets)
            ),
            "new_total_bytes": sum(int(row["bytes"]) for row in new_assets),
            "source_roots": {
                "accepted_remaining_narration_root": {
                    "explicit_absolute_cli_path_required": True,
                    "serialized_path": None,
                    "expected_file_count": 72,
                    "read_only": True,
                },
                "accepted_remaining_artwork_root": {
                    "explicit_absolute_cli_path_required": True,
                    "serialized_path": None,
                    "expected_file_count": 6,
                    "read_only": True,
                },
            },
            "promotion": {
                "content_addressed": True,
                "create_only": True,
                "overwrite_allowed": False,
                "rerender_allowed": False,
                "anonymous_inode_created_on_destination_filesystem": True,
                "anonymous_inode_fsynced_before_no_replace_link": True,
                "linked_destination_nlink_must_equal_one": True,
                "every_destination_uid_mode_device_and_inode_reverified": True,
                "asset_root_inode_pinned_for_every_traversal": True,
                "nested_parent_loss_journaled_as_external_absent": True,
                "named_staging_used": False,
                "unexpected_named_staging_preserved_and_rejected": True,
                "append_only_journal_required_before_first_asset_link": True,
                "journal_chain_and_terminals_retained": True,
                "receipt_binds_cumulative_journal_inventory": True,
                "rollback_deletes_content_addressed_bytes": False,
                "exact_unreferenced_bytes_retained_for_replay": True,
                "foreign_or_corrupt_replacement_preserved_and_rejected": True,
            },
        },
        "database_transaction": {
            "begin_mode": "BEGIN IMMEDIATE",
            "asset_root_directory_inode_flocked_for_process_lifetime": True,
            "replaceable_lock_path_used": False,
            "database_inode_pinned_through_procfd": True,
            "database_lexical_path_rechecked_at_every_action_and_receipt_edge": True,
            "database_inode_identity_redacted_hash_bound_in_journal_terminal_receipt": True,
            "postcommit_database_path_drift_is_commit_uncertain_without_success_receipt": True,
            "report_parent_directory_inode_pinned_through_receipt_return": True,
            "same_volume_verified_backup_required": True,
            "backup_max_age_seconds": 900,
            "backup_relevant_state_must_equal_locked_live_predecessor": True,
            "wal_and_shm_sidecars_must_be_regular_non_symlink_or_absent": True,
            "zero_published_versions_required": True,
            "no_active_or_executing_validation_reports_required": True,
            "zero_release_authorizations_required": True,
            "draft_revision_cas_required": True,
            "idempotent_exact_target_replay_allowed": True,
            "generic_profiled_asset_write_bypass_forbidden": True,
            "dedicated_operator_only": True,
        },
        "post_migration_phases": {
            "license_attestation": {
                "store_api": "attest_authored_original_generator_license",
                "execute_during_migration": False,
                "expected_draft_revision": 3,
                "asset_count": 72,
                "asset_sha256": new_narration_sha,
                "terms_tuple": copy.deepcopy(TERMS_TUPLE),
                "full_non_eea_policy_tuple": policy_tuple,
                "terms_policy_sha256": terms_policy_sha,
                "fresh_terms_match_required_before_first_call": True,
                "terms_drift_action": "stop_without_attesting_any_new_asset",
                "all_72_calls_require_same_admin_and_exact_tuple": True,
                "roaring_fork_13_attestations_are_preserved_not_rewritten": True,
            },
            "narration_profile_cas": {
                "store_api": "apply_authored_original_narration_profile_v2",
                "execute_during_migration": False,
                "expected_before_revision": 3,
                "expected_after_revision": 4,
                "expected_base_manifest_sha256": draft[
                    "original_manifest_canonical_sha256"
                ],
                "expected_validation_metadata_sha256": draft[
                    "validation_metadata_canonical_sha256"
                ],
                "expected_asset_sha256": all_asset_sha,
                "expected_narration_sha256": all_narration_sha,
                "redacted_license_attestation_sha256_pending_server_attestations": True,
                "profile_materialization": {
                    "settings_template": profile_template,
                    "only_dynamic_field": "commercial_license.verified_at",
                    "required_value": (
                        "maximum_server_owned_attested_at_across_exact_85_asset_set"
                    ),
                    "historical_roaring_fork_profile_file_rewritten": False,
                },
                "admin_license_attestation_complete_after_cas": True,
                "verified_private_upload_complete_after_cas": True,
            },
        },
        "effects": {
            "database_accessed": False,
            "database_mutated": False,
            "external_media_accessed": False,
            "external_media_mutated": False,
            "network_accessed": False,
            "provider_accessed": False,
            "provider_rerendered": False,
            "upload_performed": False,
            "deployment_performed": False,
            "trusted_validation_performed": False,
            "publication_performed": False,
        },
        "gates": {
            "deterministic_migration_packet_built": True,
            "independent_operator_audit_passed": False,
            "same_volume_backup_verified": False,
            "configured_private_migration_complete": False,
            "new_72_license_attestations_complete": False,
            "pack_narration_profile_cas_complete": False,
            "verified_private_upload_complete": False,
            "dual_platform_private_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        },
    }
    if packet["migration_draft"]["original_manifest"].get("narration_profile") is not None:
        raise MigrationPacketBuildError("migration draft must be profile-absent")
    return packet, audit_contract


def build_all() -> dict[Path, bytes]:
    packet, audit_contract = build_bundle()
    contract_bytes = _render(audit_contract)
    if packet["operator_audit_contract"]["sha256"] != hashlib.sha256(
        contract_bytes
    ).hexdigest():
        raise MigrationPacketBuildError("operator audit contract binding drifted")
    return {PACKET_PATH: _render(packet), AUDIT_CONTRACT_PATH: contract_bytes}


def _write(outputs: dict[Path, bytes]) -> None:
    for relative, payload in outputs.items():
        target = _path(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)


def _check(outputs: dict[Path, bytes]) -> None:
    for relative, payload in outputs.items():
        try:
            actual = _path(relative).read_bytes()
        except OSError as exc:
            raise MigrationPacketBuildError(f"missing artifact: {relative}") from exc
        if actual != payload:
            raise MigrationPacketBuildError(f"artifact is stale: {relative}")


def _summary(outputs: dict[Path, bytes]) -> dict[str, Any]:
    return {
        "status": "verified",
        "artifacts": {
            str(path): {
                "byte_count": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
            for path, payload in outputs.items()
        },
        "database_accessed": False,
        "external_media_accessed": False,
        "network_accessed": False,
        "provider_accessed": False,
        "production_mutation_performed": False,
        "publication_performed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = build_all()
    if args.write:
        _write(outputs)
    elif args.check:
        _check(outputs)
    print(json.dumps(_summary(outputs), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
