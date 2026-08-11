#!/usr/bin/env python3
"""Build the complete four-chapter Smokies private candidate, offline only.

The builder consumes only immutable, checked evidence.  It creates a normalized
Manifest V3 plus pack-wide narration/attribution records and a fail-closed
candidate envelope.  It never reads external media bytes and never accesses a
network, provider, database, deployment, validation, or publication surface.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import sys
from typing import Any, Callable


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


PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
TITLE = "Great Smoky Mountains: Ridges, Rivers & Living Memory"
CANDIDATE_ID = "smokies_complete_private_candidate_20260811_v1"
PROFILE_ID = "smokies_pack_wide_james_narration_20260811_v1"
ATTRIBUTION_ID = "smokies_pack_wide_attribution_20260811_v1"
SOURCE_COMMIT = "102fff55328f4d15ec5757f82f87d235508ebb2b"
SOURCE_TREE = "3017790b491545559634c498612ce4a017a0d880"

MANIFEST_PATH = Path("originals/smokies/smokies_complete_private_manifest_v3.json")
PROFILE_PATH = Path("originals/smokies/smokies_pack_narration_profile_v2.json")
ATTRIBUTION_PATH = Path("originals/smokies/smokies_pack_attribution_set_v1.json")
CANDIDATE_PATH = Path("originals/smokies/smokies_complete_private_candidate_v1.json")

RF_MANIFEST = Path("originals/smokies/roaring_fork_private_manifest_v3.json")
RF_PROFILE = Path("originals/smokies/roaring_fork_narration_profile_v2.json")
RF_ARTWORK_APPROVAL = Path(
    "originals/smokies/roaring_fork_artwork_derivative_approval_v1.json"
)
RF_ARTWORK_REVIEW = Path("originals/smokies/roaring_fork_artwork_review_v1.json")
MEDIA_ACCEPTANCE = Path("originals/smokies/remaining_media_acceptance_v1.json")
PRODUCT_PLAN = Path("originals/smokies/remaining_chapters_review_packet_v1.json")
CHECKPOINT2 = Path("originals/smokies/checkpoint2_owner_approval_v1.json")
DOSSIERS = Path("originals/smokies/source_dossiers_v1.json")
ROUTES = Path("originals/smokies/official_route_evidence_v1.json")
ROUTE_SPECS = Path("originals/smokies/route_variants_v1.json")
OPERATIONAL = Path("docs/originals/smokies-operational-readiness-v1.json")
NORMALIZER = Path("db/original_manifest_v3.py")

EDITORIAL_PATHS = {
    "foothills_parkway": Path("originals/smokies/editorial_scripts_v1.json"),
    "mountain_crossing": Path(
        "originals/smokies/editorial_mountain_crossing_v1.json"
    ),
    "little_river_cades_cove": Path(
        "originals/smokies/editorial_cades_cove_v1.json"
    ),
}
LOCK_PATHS = {
    "foothills_parkway": Path(
        "originals/smokies/elevenlabs_james_foothills_parkway_lock_v1.json"
    ),
    "mountain_crossing": Path(
        "originals/smokies/elevenlabs_james_mountain_crossing_lock_v1.json"
    ),
    "little_river_cades_cove": Path(
        "originals/smokies/elevenlabs_james_cades_cove_lock_v1.json"
    ),
}

VARIANT_ROWS = (
    {
        "chapter_id": "mountain_crossing",
        "variant_id": "tn_to_nc",
        "slug": "mountain_crossing_tn_to_nc",
    },
    {
        "chapter_id": "mountain_crossing",
        "variant_id": "nc_to_tn",
        "slug": "mountain_crossing_nc_to_tn",
    },
    {
        "chapter_id": "little_river_cades_cove",
        "variant_id": "sugarlands_to_cades_cove_loop",
        "slug": "little_river_cades_cove_loop",
    },
    {
        "chapter_id": "foothills_parkway",
        "variant_id": "west_to_east",
        "slug": "foothills_parkway_west_to_east",
    },
    {
        "chapter_id": "foothills_parkway",
        "variant_id": "east_to_west",
        "slug": "foothills_parkway_east_to_west",
    },
)

READINESS_PATHS = {
    (row["chapter_id"], row["variant_id"]): Path(
        f"originals/smokies/{row['slug']}_delivery_readiness_v1.json"
    )
    for row in VARIANT_ROWS
}
TARGET_PATHS = {
    (row["chapter_id"], row["variant_id"]): Path(
        f"originals/smokies/{row['slug']}_route_network_validation_target_v1.json"
    )
    for row in VARIANT_ROWS
}

PINNED_SHA256 = {
    str(RF_MANIFEST): "7e9cab7e0325c6124a2605c83867929780f575e5814c7fdc634c091a9c351467",
    str(RF_PROFILE): "10fd4f5f04cbfbc411a1e7c31061700d17752af61e1501a4b7b4652c0d2ee377",
    str(RF_ARTWORK_APPROVAL): "e13c39785e90190e0dfb4db5c60c709568b68d3ecbd76910ab00799a721b951a",
    str(RF_ARTWORK_REVIEW): "3030dfdf993b8b33cb116263ba9902dfe9e36c637f4ff7a37b11f878f0f082d4",
    str(MEDIA_ACCEPTANCE): "e593b5f280b62e00a0887e24cef131858e768f1cbe056476e3b631342a788a2a",
    str(PRODUCT_PLAN): "3ef71377c9e347cd53335cbf487d039ff973b8c28f9628b622fcee74c714b015",
    str(CHECKPOINT2): "3cc18dad4d1b6a80f2259e58cbe50fba3804096d0c00437eca9103e626078d5c",
    str(DOSSIERS): "8eb22ca5110f0f9a4287b8f184624348c2a2ca2dbc36e27ef59fc022057ce18f",
    str(ROUTES): "d946ffaf8f21ad97399b6dedfb5cbe9483fce0787653b389d7075d933f398c60",
    str(ROUTE_SPECS): "49d55fa8819822b18af54983ea11893a661689102c14532a88ebacf2ec587f24",
    str(OPERATIONAL): "359c8e2ff8086de56054d99503cb2661730a9977534c3007ff4c6d0db2cafb8f",
    str(NORMALIZER): "850df80086d336a3a3652d73a1e0eda403e89f06b241c2a710bcb6cbf38e53de",
    str(EDITORIAL_PATHS["foothills_parkway"]): "28627001d9b3bbd129e812721064e1a0c8fc2122ec9371afa91657026b76d81e",
    str(EDITORIAL_PATHS["mountain_crossing"]): "4a7e0acf04075da914ef486b86210167ff4220b8ea901083bd4df75d8fe21c58",
    str(EDITORIAL_PATHS["little_river_cades_cove"]): "1fedc6db4944bab671d7cfa0bacd2dda9670133d4165e27b3fe7b63ef8728845",
    str(LOCK_PATHS["foothills_parkway"]): "eac2d636c4c26fd55fbc4ebe7b7be25882ffd51e6064703924d96d89fa71c119",
    str(LOCK_PATHS["mountain_crossing"]): "561a8a8bf62f534d485df0ebf523d13a9defd962af136240fd46e1ca5aacec25",
    str(LOCK_PATHS["little_river_cades_cove"]): "6c6fecdaa85d91f4e29cd08ea9c46f20d404dba8ed72962390b8d8d8dc5b6a04",
    "originals/smokies/mountain_crossing_tn_to_nc_delivery_readiness_v1.json": "05dd58aa92040f2815fdc1e8b5ddb352af1fbfa0263193093c49950359a5cfe8",
    "originals/smokies/mountain_crossing_tn_to_nc_route_network_validation_target_v1.json": "1dd7704e476fd9df6aabe4b20771d62ddb9f1f2d257d838340757cec19fe7e2b",
    "originals/smokies/mountain_crossing_nc_to_tn_delivery_readiness_v1.json": "d416bf0c716434f3ee651fb8fd379ca01d082d438a16130d182cb3314d905e2d",
    "originals/smokies/mountain_crossing_nc_to_tn_route_network_validation_target_v1.json": "6ba74de0ab77e9ff12aa4e52c54377533e95a92cbf9219a254b345676dccd7c5",
    "originals/smokies/little_river_cades_cove_loop_delivery_readiness_v1.json": "00abe0b8646332d27636856ab0c9029760d6b33f6ff4215d2364c17674b3fa90",
    "originals/smokies/little_river_cades_cove_loop_route_network_validation_target_v1.json": "59ad07c506489c036c9ff26b94c3ec11e114e22c2dc5fd3ae5a402310797acd9",
    "originals/smokies/foothills_parkway_west_to_east_delivery_readiness_v1.json": "743719296433bb9528f88fe56aed158d8f08fb8af4a5c6fd42fc7f11610c5a6d",
    "originals/smokies/foothills_parkway_west_to_east_route_network_validation_target_v1.json": "f534a8289d2205fb3d1f0d23736cd50a771bad657e8e9e6c855a480672c7bc5f",
    "originals/smokies/foothills_parkway_east_to_west_delivery_readiness_v1.json": "2eaafeb3573a8f15aed8b6ab68a660bc00e4807a6bd1b462e2fcb88aab4bd716",
    "originals/smokies/foothills_parkway_east_to_west_route_network_validation_target_v1.json": "9598a7080733d1f33a5c01f608419bae28bcf24f7b9d37ed3a0c838efab26171",
}

EXPECTED_BYTES = {
    "originals/smokies/mountain_crossing_tn_to_nc_delivery_readiness_v1.json": 39422,
    "originals/smokies/mountain_crossing_tn_to_nc_route_network_validation_target_v1.json": 1288,
    "originals/smokies/mountain_crossing_nc_to_tn_delivery_readiness_v1.json": 40121,
    "originals/smokies/mountain_crossing_nc_to_tn_route_network_validation_target_v1.json": 1288,
    "originals/smokies/little_river_cades_cove_loop_delivery_readiness_v1.json": 34810,
    "originals/smokies/little_river_cades_cove_loop_route_network_validation_target_v1.json": 1319,
    "originals/smokies/foothills_parkway_west_to_east_delivery_readiness_v1.json": 21485,
    "originals/smokies/foothills_parkway_west_to_east_route_network_validation_target_v1.json": 1300,
    "originals/smokies/foothills_parkway_east_to_west_delivery_readiness_v1.json": 20959,
    "originals/smokies/foothills_parkway_east_to_west_route_network_validation_target_v1.json": 1300,
}

CHAPTER_ORDER = (
    "mountain_crossing",
    "little_river_cades_cove",
    "roaring_fork",
    "foothills_parkway",
)
CHAPTER_TITLES = {
    "mountain_crossing": "Mountain Crossing",
    "little_river_cades_cove": "Little River and Cades Cove",
    "roaring_fork": "Roaring Fork Motor Nature Trail",
    "foothills_parkway": "Foothills Parkway",
}
CHAPTER_SUMMARIES = {
    "mountain_crossing": (
        "A private two-direction crossing between Sugarlands and Cherokee, "
        "with the high-country Kuwohi spur and source-reviewed stories."
    ),
    "little_river_cades_cove": (
        "A private one-way chapter following Little River into the Cades Cove "
        "loop, its landscape, communities, farms, mills, and wildlife."
    ),
    "foothills_parkway": (
        "A private two-direction ridge-road chapter about the parkway's views, "
        "forest, air, geology, and long construction history."
    ),
}
DEFAULT_VARIANTS = {
    "mountain_crossing": "tn_to_nc",
    "little_river_cades_cove": "sugarlands_to_cades_cove_loop",
    "foothills_parkway": "west_to_east",
}
VALIDATION_SELECTIONS = {
    "mountain_crossing": {
        "selection_id": "mountain_crossing_complete_private_v1",
        "required_variant_ids": ["tn_to_nc", "nc_to_tn"],
    },
    "little_river_cades_cove": {
        "selection_id": "little_river_cades_cove_complete_private_v1",
        "required_variant_ids": ["sugarlands_to_cades_cove_loop"],
    },
    "foothills_parkway": {
        "selection_id": "foothills_parkway_complete_private_v1",
        "required_variant_ids": ["west_to_east", "east_to_west"],
    },
}

IMAGE_ASSET_IDS = {
    "media_fp_panorama": "fp_art_panorama",
    "media_fp_engineering": "fp_art_engineering",
    "media_mc_kuwohi": "mc_art_kuwohi",
    "media_mc_oconaluftee": "mc_art_oconaluftee",
    "media_cc_cove": "cc_art_cove",
    "media_cc_cable_mill": "cc_art_cable_mill",
}
FOOTHILLS_ENGINEERING_IDS = frozenset({"fp_story_03", "fp_cue_06"})
MOUNTAIN_OCONALUFTEE_IDS = frozenset(
    {"mc_story_16", "mc_story_17", "mc_story_18", "mc_cue_09", "mc_cue_10"}
)
CADES_CABLE_MILL_IDS = frozenset({"cc_story_11", "cc_story_12", "cc_cue_07"})

EARTH_RADIUS_M = 6_371_008.8


class CandidateBuildError(ValueError):
    """The exact accepted evidence cannot produce the private candidate."""


def _read_json(relative: Path) -> dict[str, Any]:
    path = ROOT / relative
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CandidateBuildError(f"Cannot read checked input: {relative}") from exc
    if not isinstance(value, dict):
        raise CandidateBuildError(f"Checked input must be an object: {relative}")
    return value


def _file_sha(relative: Path) -> str:
    path = ROOT / relative
    if not path.is_file():
        raise CandidateBuildError(f"Missing checked input: {relative}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _render(value: dict[str, Any]) -> bytes:
    return (
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    ).encode("utf-8")


def _canonical_sha(value: Any) -> str:
    encoded = json.dumps(
        value, separators=(",", ":"), sort_keys=True, ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _checked_sources() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for raw_path, expected_sha in sorted(PINNED_SHA256.items()):
        relative = Path(raw_path)
        path = ROOT / relative
        actual_sha = _file_sha(relative)
        if actual_sha != expected_sha:
            raise CandidateBuildError(f"Pinned input drifted: {raw_path}")
        expected_bytes = EXPECTED_BYTES.get(raw_path)
        if expected_bytes is not None and path.stat().st_size != expected_bytes:
            raise CandidateBuildError(f"Pinned input size drifted: {raw_path}")
        result[raw_path] = {
            "path": raw_path,
            "byte_count": path.stat().st_size,
            "sha256": actual_sha,
        }
    return result


def _haversine(first: list[float], second: list[float]) -> float:
    lng1, lat1 = map(math.radians, first)
    lng2, lat2 = map(math.radians, second)
    d_lat, d_lng = lat2 - lat1, lng2 - lng1
    value = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(
        d_lng / 2
    ) ** 2
    return 2 * EARTH_RADIUS_M * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _dedupe_coordinates(raw: list[list[float]]) -> list[list[float]]:
    if not raw:
        raise CandidateBuildError("Route geometry is empty")
    result = [copy.deepcopy(raw[0])]
    for point in raw[1:]:
        if _haversine(result[-1], point) > 0.001:
            result.append(copy.deepcopy(point))
    return result


def _geometry_sha(coordinates: list[list[float]]) -> str:
    value = ";".join(
        f"{float(point[0]):.7f},{float(point[1]):.7f}" for point in coordinates
    )
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def _bounds(coordinates: list[list[float]]) -> dict[str, float]:
    return {
        "north": max(float(point[1]) for point in coordinates),
        "south": min(float(point[1]) for point in coordinates),
        "east": max(float(point[0]) for point in coordinates),
        "west": min(float(point[0]) for point in coordinates),
    }


def _private_v1_normalizer(
    _pack_id: str,
    _title: str,
    manifest: dict[str, Any],
    **_kwargs: Any,
) -> tuple[dict[str, Any], str]:
    """Keep normalization network/DB-free after V3 has compiled each hard route."""

    if manifest.get("schema_version") != 1:
        raise CandidateBuildError("V3 hard-route projection did not compile to V1")
    value = copy.deepcopy(manifest)
    encoded = json.dumps(value, separators=(",", ":"), sort_keys=True)
    return value, encoded


def _source_citations(
    entry: dict[str, Any],
    sources_by_id: dict[str, dict[str, Any]],
    claims_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    claim_ids = [str(item) for item in entry.get("claim_ids", [])]
    citations = []
    covered: set[str] = set()
    for source_id in entry.get("source_ids", []):
        source = sources_by_id.get(str(source_id))
        if source is None:
            raise CandidateBuildError(f"Unknown story source: {source_id}")
        affected = [
            claim_id
            for claim_id in claim_ids
            if str(source_id) in claims_by_id.get(claim_id, {}).get("source_ids", [])
        ]
        if not affected:
            raise CandidateBuildError(
                f"Source {source_id} covers no claim for {entry.get('id')}"
            )
        covered.update(affected)
        citations.append(
            {
                "title": source["title"],
                "url": source["url"],
                "publisher": source["publisher"],
                "role": source["role"],
                "authority": source["authority"],
                "reviewed_at": source["reviewed_at"],
                "rights_status": source["rights_status"],
                "affected_claims": sorted(affected),
            }
        )
    if covered != set(claim_ids):
        raise CandidateBuildError(f"Story claims lack exact sources: {entry.get('id')}")
    return citations


def _artwork_candidate_id(chapter_id: str, entry_id: str) -> str:
    if chapter_id == "foothills_parkway":
        return (
            "media_fp_engineering"
            if entry_id in FOOTHILLS_ENGINEERING_IDS
            else "media_fp_panorama"
        )
    if chapter_id == "mountain_crossing":
        return (
            "media_mc_oconaluftee"
            if entry_id in MOUNTAIN_OCONALUFTEE_IDS
            else "media_mc_kuwohi"
        )
    if chapter_id == "little_river_cades_cove":
        return (
            "media_cc_cable_mill"
            if entry_id in CADES_CABLE_MILL_IDS
            else "media_cc_cove"
        )
    raise CandidateBuildError(f"No artwork policy for chapter: {chapter_id}")


def _audio_asset_id(provider_request_id: str) -> str:
    parts = provider_request_id.split("__", 1)
    base = parts[0]
    if len(parts) == 1 or parts[1] == "base":
        return base.replace("_story_", "_audio_story_").replace(
            "_cue_", "_audio_cue_"
        )
    return (
        base.replace("_story_", "_audio_story_").replace("_cue_", "_audio_cue_")
        + "__"
        + parts[1]
    )


def _asset_path(asset_id: str, sha256: str) -> str:
    return f"/api/original-assets/{PRODUCT_ID}/{asset_id}/{sha256}"


def _validate_readiness_pairs(
    source_bindings: dict[str, dict[str, Any]],
) -> dict[tuple[str, str], tuple[dict[str, Any], dict[str, Any]]]:
    result = {}
    for row in VARIANT_ROWS:
        key = (row["chapter_id"], row["variant_id"])
        readiness_path = READINESS_PATHS[key]
        target_path = TARGET_PATHS[key]
        readiness = _read_json(readiness_path)
        target = _read_json(target_path)
        if (
            readiness.get("schema_version") != 1
            or readiness.get("kind")
            != "original_checked_long_form_delivery_readiness"
            or (readiness.get("product_id"), readiness.get("chapter_id"), readiness.get("variant_id"))
            != (PRODUCT_ID, *key)
            or readiness.get("real_audio_required") is not True
            or readiness.get("authoring_estimates_accepted") is not False
            or readiness.get("publication_authorized") is not False
            or readiness.get("boundaries", {}).get("real_audio_timing_passed")
            is not False
            or readiness.get("boundaries", {}).get("trusted_report_created")
            is not False
            or readiness.get("boundaries", {}).get("public_release_authorized")
            is not False
        ):
            raise CandidateBuildError(f"Readiness gate drifted: {readiness_path}")
        for transitive_path, transitive_sha in readiness.get(
            "source_sha256_by_path", {}
        ).items():
            path = Path(str(transitive_path))
            if _file_sha(path) != transitive_sha:
                raise CandidateBuildError(
                    f"Readiness transitive input drifted: {transitive_path}"
                )
        if (
            target.get("schema_version") != 2
            or target.get("kind")
            != "original_route_network_validation_target_authorization"
            or (target.get("product_id"), target.get("chapter_id"), target.get("variant_id"))
            != (PRODUCT_ID, *key)
            or target.get("delivery_readiness_path") != str(readiness_path)
            or target.get("delivery_readiness_sha256")
            != source_bindings[str(readiness_path)]["sha256"]
            or target.get("delivery_semantics_sha256")
            != readiness.get("delivery_semantics_sha256")
            or target.get("geometry_sha256")
            != readiness.get("route_binding", {}).get("geometry_sha256")
            or target.get("delivery_contract_binding")
            != "resolve_exact_normalized_manifest_v3_contract_at_validation_time_after_checked_readiness"
            or target.get("required_area_id") != "south_tn"
            or target.get("require_full_geometry_within_configured_bounds")
            is not True
        ):
            raise CandidateBuildError(f"Route target binding drifted: {target_path}")
        authorization = target.get("authorization", {})
        if (
            authorization.get("decision") != "allow_validation_only_route_target"
            or authorization.get("project_owner_authorized") is not True
            or authorization.get("draft_mutation_authorized") is not False
            or authorization.get("global_valhalla_reconfiguration_authorized")
            is not False
            or authorization.get("public_release_authorized") is not False
            or authorization.get("cultural_scope_expansion_authorized") is not False
        ):
            raise CandidateBuildError(f"Route target authorization drifted: {target_path}")
        result[key] = (readiness, target)
    if len(result) != 5:
        raise CandidateBuildError("Exactly five readiness/target pairs are required")
    return result


def _build_profile(
    rf_profile: dict[str, Any], locks: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    for chapter_id, lock in locks.items():
        profile = lock.get("generation_profile", {})
        if (
            profile.get("provider") != rf_profile.get("provider")
            or profile.get("voice_id") != rf_profile.get("voice_id")
            or profile.get("model_id") != rf_profile.get("model_snapshot")
            or profile.get("api_contract") != rf_profile.get("api_version")
            or profile.get("language_code") != rf_profile.get("language")
            or profile.get("output", {}).get("format_id")
            != rf_profile.get("generation", {}).get("output_format")
            or profile.get("voice_settings")
            != {
                "similarity_boost": 0.5,
                "speed": 1.0,
                "stability": 0.5,
                "style": 0.1,
                "use_speaker_boost": True,
            }
        ):
            raise CandidateBuildError(
                f"Pack narration profile drifted for {chapter_id}"
            )
    # The accepted Manifest profile is intentionally byte-identical to the
    # historical Roaring Fork profile.  Exact James settings remain bound in
    # the three immutable request locks and the candidate envelope.
    return copy.deepcopy(rf_profile)


def _build_new_assets_and_stories(
    media: dict[str, Any],
    editorials: dict[str, dict[str, Any]],
    locks: dict[str, dict[str, Any]],
    dossiers: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, str]]:
    accepted_audio = media.get("accepted_narration_set", {}).get("items")
    accepted_images = media.get("accepted_derivative_images", {}).get("items")
    if not isinstance(accepted_audio, list) or len(accepted_audio) != 72:
        raise CandidateBuildError("Accepted narration inventory must contain 72 rows")
    if not isinstance(accepted_images, list) or len(accepted_images) != 6:
        raise CandidateBuildError("Accepted image inventory must contain six rows")
    if (
        media.get("normalized_approval_scope", {}).get(
            "exact_72_file_narration_set_owner_accepted"
        )
        is not True
        or media.get("normalized_approval_scope", {}).get(
            "exact_six_derivative_hashes_owner_visual_accepted"
        )
        is not True
        or media.get("acceptance_boundary", {}).get("rerender_authorized")
        is not False
        or media.get("acceptance_boundary", {}).get("publication_allowed")
        is not False
    ):
        raise CandidateBuildError("Media acceptance boundary drifted")

    audio_by_request = {
        str(row.get("provider_request_id")): row for row in accepted_audio
    }
    if len(audio_by_request) != 72:
        raise CandidateBuildError("Accepted narration request ids are not unique")
    sources_by_id = {
        str(row["id"]): row for row in dossiers.get("sources", [])
    }
    claims_by_id = {str(row["id"]): row for row in dossiers.get("claims", [])}
    stories: list[dict[str, Any]] = []
    assets: list[dict[str, Any]] = []
    request_to_asset: dict[str, str] = {}

    for chapter_id in (
        "foothills_parkway",
        "mountain_crossing",
        "little_river_cades_cove",
    ):
        editorial = editorials[chapter_id]
        lock = locks[chapter_id]
        entries = editorial.get("entries")
        requests = lock.get("requests")
        if (
            editorial.get("product_id") != PRODUCT_ID
            or editorial.get("chapter_id") != chapter_id
            or lock.get("product_id") != PRODUCT_ID
            or lock.get("chapter_id") != chapter_id
            or not isinstance(entries, list)
            or not isinstance(requests, list)
        ):
            raise CandidateBuildError(f"Editorial/lock identity drifted: {chapter_id}")
        requests_by_id = {
            str(row.get("provider_request_id")): row for row in requests
        }
        if len(requests_by_id) != len(requests):
            raise CandidateBuildError(f"Narration request ids drifted: {chapter_id}")

        for request in requests:
            request_id = str(request["provider_request_id"])
            accepted = audio_by_request.get(request_id)
            if (
                accepted is None
                or accepted.get("chapter_id") != chapter_id
                or accepted.get("entry_id") != request.get("entry_id")
                or accepted.get("request_kind") != request.get("request_kind")
                or accepted.get("raw_transcript_sha256")
                != request.get("raw_transcript_sha256")
                or accepted.get("normalized_transcript_sha256")
                != request.get("normalized_transcript_sha256")
            ):
                raise CandidateBuildError(
                    f"Accepted narration does not match lock: {request_id}"
                )
            asset_id = _audio_asset_id(request_id)
            request_to_asset[request_id] = asset_id
            assets.append(
                {
                    "id": asset_id,
                    "kind": "narration",
                    "path": _asset_path(asset_id, accepted["audio_sha256"]),
                    "mime_type": "audio/mpeg",
                    "bytes": accepted["audio_bytes"],
                    "sha256": accepted["audio_sha256"],
                }
            )

        base_requests = {
            str(row["entry_id"]): row
            for row in requests
            if row.get("request_kind") == "base_entry"
        }
        if len(base_requests) != len(entries):
            raise CandidateBuildError(f"Base narration coverage drifted: {chapter_id}")
        for entry in entries:
            entry_id = str(entry["id"])
            base = base_requests.get(entry_id)
            if base is None:
                raise CandidateBuildError(f"Entry lacks base narration: {entry_id}")
            transcript = str(entry["transcript"])
            if hashlib.sha256(transcript.encode("utf-8")).hexdigest() != base.get(
                "raw_transcript_sha256"
            ):
                raise CandidateBuildError(f"Base transcript drifted: {entry_id}")
            accepted = audio_by_request[str(base["provider_request_id"])]
            story: dict[str, Any] = {
                "id": entry_id,
                "kind": entry["kind"],
                "title": entry["title"],
                "transcript": transcript,
                "audio_asset_id": request_to_asset[str(base["provider_request_id"])],
                "audio_duration_s": accepted["duration_s"],
                "artwork_asset_id": IMAGE_ASSET_IDS[
                    _artwork_candidate_id(chapter_id, entry_id)
                ],
                "citations": _source_citations(
                    entry, sources_by_id, claims_by_id
                ),
            }
            overrides = []
            for raw_override in entry.get("variant_overrides", []):
                variant_id = str(raw_override["variant_id"])
                matches = [
                    row
                    for row in requests
                    if row.get("entry_id") == entry_id
                    and row.get("override_variant_id") == variant_id
                    and row.get("request_kind") == "directional_override"
                ]
                if len(matches) != 1:
                    raise CandidateBuildError(
                        f"Directional narration lock drifted: {entry_id}/{variant_id}"
                    )
                request = matches[0]
                override_transcript = str(raw_override["transcript"])
                if hashlib.sha256(override_transcript.encode("utf-8")).hexdigest() != request.get(
                    "raw_transcript_sha256"
                ):
                    raise CandidateBuildError(
                        f"Directional transcript drifted: {entry_id}/{variant_id}"
                    )
                accepted_override = audio_by_request[str(request["provider_request_id"])]
                override = {
                    "chapter_id": chapter_id,
                    "variant_id": variant_id,
                    "transcript": override_transcript,
                    "audio_asset_id": request_to_asset[
                        str(request["provider_request_id"])
                    ],
                    "audio_duration_s": accepted_override["duration_s"],
                }
                if raw_override.get("title") is not None:
                    override["title"] = raw_override["title"]
                overrides.append(override)
            if overrides:
                story["variant_overrides"] = overrides
            stories.append(story)

    image_by_candidate = {
        str(row.get("candidate_id")): row for row in accepted_images
    }
    if set(image_by_candidate) != set(IMAGE_ASSET_IDS):
        raise CandidateBuildError("Accepted image identities drifted")
    for candidate_id, asset_id in IMAGE_ASSET_IDS.items():
        item = image_by_candidate[candidate_id]
        if (
            item.get("exact_derivative_hash_owner_visual_accepted") is not True
            or item.get("source_rights_credit_change_note_and_notice_bound")
            is not True
        ):
            raise CandidateBuildError(f"Image acceptance drifted: {candidate_id}")
        assets.append(
            {
                "id": asset_id,
                "kind": "image",
                "path": _asset_path(asset_id, item["derivative_sha256"]),
                "mime_type": "image/png",
                "bytes": item["derivative_bytes"],
                "sha256": item["derivative_sha256"],
            }
        )
    if len(stories) != 64 or len(assets) != 78:
        raise CandidateBuildError("Remaining story/asset counts drifted")
    return stories, assets, request_to_asset


def _build_attribution(
    rf_manifest: dict[str, Any],
    rf_artwork: dict[str, Any],
    rf_artwork_review: dict[str, Any],
    media: dict[str, Any],
    all_stories: list[dict[str, Any]],
) -> dict[str, Any]:
    story_ids_by_asset: dict[str, list[str]] = {}
    for story in all_stories:
        asset_id = story.get("artwork_asset_id")
        if asset_id:
            story_ids_by_asset.setdefault(str(asset_id), []).append(str(story["id"]))
    rf_assets = {
        row["id"]: row
        for row in rf_manifest["assets"]
        if row.get("kind") == "image"
    }
    rf_rows = {row["candidate_id"]: row for row in rf_artwork["derivatives"]}
    rf_rights = {
        row["candidate_id"]: row
        for row in rf_artwork_review.get("candidates", [])
    }
    rows = []
    for asset_id in sorted(rf_assets):
        source = rf_rows.get(asset_id)
        asset = rf_assets[asset_id]
        rights = rf_rights.get(asset_id)
        if (
            source is None
            or rights is None
            or source.get("derivative_sha256") != asset.get("sha256")
            or source.get("exact_credit") != rights.get("exact_credit")
            or source.get("license_name") != rights.get("license_name")
            or source.get("license_url") != rights.get("license_url")
        ):
            raise CandidateBuildError(f"Roaring Fork attribution drifted: {asset_id}")
        rows.append(
            {
                "asset_id": asset_id,
                "chapter_id": "roaring_fork",
                "sha256": asset["sha256"],
                "exact_credit": source["exact_credit"],
                "license_name": source["license_name"],
                "license_url": source.get("license_url"),
                "rights_basis": rights["rights_basis"],
                "required_commercial_notice": (
                    "No claim to original U.S. Government works."
                    if rights["rights_basis"]
                    == "public_domain_us_government_work"
                    else None
                ),
                "change_note": source["change_note"],
                "story_ids": sorted(story_ids_by_asset.get(asset_id, [])),
                "historical_attribution_preserved": True,
            }
        )
    new_images = media["accepted_derivative_images"]["items"]
    for source in new_images:
        candidate_id = str(source["candidate_id"])
        asset_id = IMAGE_ASSET_IDS[candidate_id]
        rows.append(
            {
                "asset_id": asset_id,
                "chapter_id": source["chapter_id"],
                "sha256": source["derivative_sha256"],
                "exact_credit": source["exact_credit"],
                "license_name": source["license_name"],
                "license_url": (
                    "https://creativecommons.org/licenses/by/4.0/"
                    if source["license_name"] == "CC BY 4.0"
                    else None
                ),
                "rights_basis": source["rights_basis"],
                "required_commercial_notice": source[
                    "required_commercial_notice"
                ],
                "change_note": source["change_note"],
                "story_ids": sorted(story_ids_by_asset.get(asset_id, [])),
                "historical_attribution_preserved": False,
            }
        )
    rows.sort(key=lambda item: item["asset_id"])
    if len(rows) != 13 or any(not row["story_ids"] for row in rows):
        raise CandidateBuildError("Artwork attribution coverage drifted")
    return {
        "schema_version": 1,
        "kind": "trailhead_original_pack_attribution_set",
        "attribution_id": ATTRIBUTION_ID,
        "product_id": PRODUCT_ID,
        "artwork_asset_count": 13,
        "artwork_attributions": rows,
        "narration": {
            "provider": "elevenlabs",
            "voice_name": "James - Husky, Engaging and Bold",
            "voice_id": "EkK5I93UQWFDigLMpZcX",
            "model_id": "eleven_multilingual_v2",
            "provider_attribution_claimed_as_required": False,
            "commercial_terms_are_bound_by_profile_and_source_evidence": True,
        },
        "source_bindings": {
            "roaring_fork_artwork_derivative_approval": {
                "path": str(RF_ARTWORK_APPROVAL),
                "sha256": PINNED_SHA256[str(RF_ARTWORK_APPROVAL)],
            },
            "roaring_fork_artwork_review": {
                "path": str(RF_ARTWORK_REVIEW),
                "sha256": PINNED_SHA256[str(RF_ARTWORK_REVIEW)],
            },
            "remaining_media_acceptance": {
                "path": str(MEDIA_ACCEPTANCE),
                "sha256": PINNED_SHA256[str(MEDIA_ACCEPTANCE)],
            },
        },
        "privacy": {
            "absolute_local_paths_serialized": False,
            "raw_exif_serialized": False,
            "provider_or_account_secret_serialized": False,
        },
        "gates": {
            "upload_allowed": False,
            "database_mutation_allowed": False,
            "deployment_allowed": False,
            "trusted_validation_allowed": False,
            "publication_allowed": False,
        },
    }


def _route_sources(
    chapter_id: str,
    variant_id: str,
    readiness: dict[str, Any],
    target: dict[str, Any],
    route_evidence: dict[str, Any],
    route_specs: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], list[list[float]]]:
    routes = [
        row
        for row in route_evidence.get("variants", [])
        if (row.get("chapter_id"), row.get("variant_id"))
        == (chapter_id, variant_id)
    ]
    specs = [
        row
        for row in route_specs.get("variants", [])
        if (row.get("chapter_id"), row.get("variant_id"))
        == (chapter_id, variant_id)
    ]
    if len(routes) != 1 or len(specs) != 1:
        raise CandidateBuildError(f"Route selection is ambiguous: {chapter_id}/{variant_id}")
    route, spec = routes[0], specs[0]
    raw_coordinates = route.get("geometry", {}).get("coordinates")
    if not isinstance(raw_coordinates, list):
        raise CandidateBuildError(f"Route geometry is invalid: {chapter_id}/{variant_id}")
    # Route targets bind the exact checked runtime coordinate sequence.  The
    # readiness scheduler removes sub-millimetre adjacent repeats only while
    # interpolating trigger positions; that private calculation must not alter
    # the Manifest route identity.
    coordinates = copy.deepcopy(raw_coordinates)
    binding = readiness["route_binding"]
    if (
        route.get("status") != "official_geometry_candidate"
        or route.get("geometry_ready_for_editorial_cues") is not True
        or route.get("geometry_sha256")
        != binding.get("official_evidence_geometry_sha256")
        or len(coordinates) != binding.get("coordinate_count")
        or _geometry_sha(coordinates) != binding.get("geometry_sha256")
        or target.get("geometry_sha256") != _geometry_sha(coordinates)
        or float(route.get("distance_m")) != float(binding.get("distance_m"))
        or spec.get("id") != binding.get("route_spec_id")
    ):
        raise CandidateBuildError(f"Route evidence drifted: {chapter_id}/{variant_id}")
    return route, spec, coordinates


def _variant_from_readiness(
    chapter_id: str,
    variant_id: str,
    readiness: dict[str, Any],
    target: dict[str, Any],
    route_evidence: dict[str, Any],
    route_specs: dict[str, Any],
) -> dict[str, Any]:
    route, spec, coordinates = _route_sources(
        chapter_id, variant_id, readiness, target, route_evidence, route_specs
    )
    cue_refs = []
    selectable_refs = []
    semantics = readiness["expected_delivery_semantics"]
    for item in semantics["entries"]:
        mode = item["mode"]
        base: dict[str, Any] = {
            "story_id": item["id"],
            "sequence": item["stable_order"],
        }
        if item.get("coordinates") is not None:
            base["coordinates"] = copy.deepcopy(item["coordinates"])
        if item.get("trigger") is not None:
            base["trigger"] = copy.deepcopy(item["trigger"])
        if mode == "hard_auto":
            cue_refs.append(base)
        elif mode in {"capacity_deeper", "completion_deeper"}:
            base["delivery"] = {"mode": mode, **copy.deepcopy(item["delivery"])}
            selectable_refs.append(base)
        else:
            raise CandidateBuildError(
                f"Unsupported checked delivery mode: {chapter_id}/{variant_id}/{mode}"
            )
    if len(cue_refs) + len(selectable_refs) != readiness["narration_binding"][
        "entry_count"
    ]:
        raise CandidateBuildError(f"Delivery reference count drifted: {chapter_id}/{variant_id}")
    distance = float(route["distance_m"])
    return {
        "id": variant_id,
        "sequence": int(spec["sequence"]),
        "title": spec["title"],
        "route": {
            "profile": "driving",
            "direction": spec["direction"],
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "bounds": _bounds(coordinates),
            "distance_m": distance,
            # A required private-manifest scheduling estimate, deliberately not
            # promoted to accepted authoring evidence by the candidate gates.
            "duration_s": round(distance / (36 * 1609.344 / 3600), 6),
        },
        "cue_refs": cue_refs,
        "selectable_refs": selectable_refs,
        "delivery_contract_sha256": "0" * 64,
    }


def _chapter(
    chapter_id: str,
    sequence: int,
    variants: list[dict[str, Any]],
    operational_candidate: dict[str, Any],
) -> dict[str, Any]:
    operational = manifest_operational_fields(operational_candidate, chapter_id)
    return {
        "id": chapter_id,
        "sequence": sequence,
        "title": CHAPTER_TITLES[chapter_id],
        "summary": CHAPTER_SUMMARIES[chapter_id],
        "default_variant_id": DEFAULT_VARIANTS[chapter_id],
        "safety": {
            "summary": (
                "Check current National Park Service road, weather, closure, "
                "traffic, and vehicle information immediately before entering."
            ),
            "emergency_note": (
                "Do not stop in the travel lane; follow posted instructions and "
                "local emergency guidance."
            ),
            "disclaimers": [
                "This private candidate does not replace current NPS information.",
                "Parking, pullout, landmark, and road availability are not promised.",
            ],
        },
        "access": {
            "surface": "paved",
            "vehicle": (
                "Use only a currently permitted vehicle and obey the current "
                "chapter-specific vehicle policy checked at Start."
            ),
            "fees": "Check current NPS parking-tag and fee information before arrival.",
            "accessibility_notes": (
                "Accessibility and stop conditions require a current NPS check; "
                "this candidate makes no parking or access guarantee."
            ),
        },
        "season": {
            "recommended_months": list(range(1, 13)),
            "closures_note": (
                "Seasonal schedules, vehicle-free periods, weather, construction, "
                "and temporary closures must be checked with NPS before starting."
            ),
        },
        "operational_sources": operational["operational_sources"],
        "operational_readiness": operational["operational_readiness"],
        "validation_selection": copy.deepcopy(VALIDATION_SELECTIONS[chapter_id]),
        "variants": variants,
    }


def _delivery_projection(chapter: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": chapter["id"],
        "title": chapter["title"],
        "summary": chapter["summary"],
        "default_variant_id": chapter["default_variant_id"],
        "safety": copy.deepcopy(chapter["safety"]),
        "access": copy.deepcopy(chapter["access"]),
        "season": copy.deepcopy(chapter["season"]),
        "validation_selection": copy.deepcopy(chapter["validation_selection"]),
        "variants": copy.deepcopy(chapter["variants"]),
    }


def _build_manifest(
    rf_manifest: dict[str, Any],
    profile: dict[str, Any],
    new_stories: list[dict[str, Any]],
    new_assets: list[dict[str, Any]],
    readiness_pairs: dict[
        tuple[str, str], tuple[dict[str, Any], dict[str, Any]]
    ],
    route_evidence: dict[str, Any],
    route_specs: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    rf_stories = copy.deepcopy(rf_manifest["stories"])
    rf_assets = copy.deepcopy(rf_manifest["assets"])
    rf_chapter = copy.deepcopy(rf_manifest["chapters"][0])
    if (
        len(rf_stories) != 13
        or sum(row.get("kind") == "narration" for row in rf_assets) != 13
        or sum(row.get("kind") == "image" for row in rf_assets) != 7
        or rf_chapter.get("id") != "roaring_fork"
        or len(rf_chapter.get("variants", [])) != 1
    ):
        raise CandidateBuildError("Historical Roaring Fork inventory drifted")
    operational_candidate = load_operational_candidate(ROOT / OPERATIONAL)
    chapters_by_id: dict[str, dict[str, Any]] = {}
    for chapter_id in (
        "mountain_crossing",
        "little_river_cades_cove",
        "foothills_parkway",
    ):
        variants = []
        for row in VARIANT_ROWS:
            if row["chapter_id"] != chapter_id:
                continue
            key = (chapter_id, row["variant_id"])
            readiness, target = readiness_pairs[key]
            variants.append(
                _variant_from_readiness(
                    chapter_id,
                    row["variant_id"],
                    readiness,
                    target,
                    route_evidence,
                    route_specs,
                )
            )
        chapters_by_id[chapter_id] = _chapter(
            chapter_id, CHAPTER_ORDER.index(chapter_id) + 1, variants, operational_candidate
        )

    # Preserve the accepted RF story and delivery bytes.  Only its placement in
    # the four-chapter product and current pack-local alternate relationship are
    # changed in the new candidate; the source manifest remains untouched.
    rf_chapter["sequence"] = CHAPTER_ORDER.index("roaring_fork") + 1
    current_rf_operational = manifest_operational_fields(
        operational_candidate, "roaring_fork"
    )["operational_readiness"]
    rf_chapter["operational_readiness"]["alternate_chapter_ids"] = copy.deepcopy(
        current_rf_operational["alternate_chapter_ids"]
    )
    chapters_by_id["roaring_fork"] = rf_chapter

    offline = copy.deepcopy(rf_manifest["offline_map"])
    all_bounds = [offline["bounds"]]
    for chapter in chapters_by_id.values():
        for variant in chapter["variants"]:
            all_bounds.append(variant["route"]["bounds"])
    offline.update(
        {
            "region_id": "smokies_ridges_rivers_living_memory_union_private_v1",
            "bounds": {
                "north": max(row["north"] for row in all_bounds),
                "south": min(row["south"] for row in all_bounds),
                "east": max(row["east"] for row in all_bounds),
                "west": min(row["west"] for row in all_bounds),
            },
            "estimated_bytes": 0,
        }
    )

    raw = {
        "schema_version": 3,
        "locale": rf_manifest["locale"],
        "title": TITLE,
        "stories": rf_stories + copy.deepcopy(new_stories),
        "chapters": [chapters_by_id[item] for item in CHAPTER_ORDER],
        "assets": rf_assets + copy.deepcopy(new_assets),
        "offline_map": offline,
        "review": {"editorial_status": "owner_dual_platform_preview_required"},
        "narration_profile": copy.deepcopy(profile),
        "consumer_contract": {
            "schema_version": 1,
            "contract_id": ORIGINAL_LONG_FORM_CONTRACT_ID,
            "required_capabilities": list(ORIGINAL_LONG_FORM_REQUIRED_CAPABILITIES),
        },
    }
    for chapter in raw["chapters"]:
        for variant in chapter["variants"]:
            if chapter["id"] == "roaring_fork":
                continue
            variant["delivery_contract_sha256"] = (
                original_manifest_v3_delivery_contract_sha256(
                    raw, chapter_id=chapter["id"], variant_id=variant["id"]
                )
            )

    normalized, encoded = normalize_original_manifest_v3(
        raw,
        pack_id=PRODUCT_ID,
        title=TITLE,
        version=None,
        normalize_v1=_private_v1_normalizer,
        publishing=False,
    )
    return normalized, encoded


def _build_candidate(
    manifest: dict[str, Any],
    manifest_encoded: str,
    manifest_bytes: bytes,
    profile_bytes: bytes,
    attribution: dict[str, Any],
    attribution_bytes: bytes,
    sources: dict[str, dict[str, Any]],
    rf_manifest: dict[str, Any],
    readiness_pairs: dict[
        tuple[str, str], tuple[dict[str, Any], dict[str, Any]]
    ],
) -> dict[str, Any]:
    product_plan = _read_json(PRODUCT_PLAN)
    contract = product_plan.get("product_contract", {})
    expected_contract = {
        "pack_scope": "one_premium_four_chapter_product",
        "chapter_ids": list(CHAPTER_ORDER),
        "credit_type": "earned_credits",
        "permanent_credit_price": 900,
        "explorer_included": True,
        "standalone_chapter_products_approved": False,
        "standalone_foothills_public_product_approved": False,
        "standalone_roaring_fork_public_product_approved": False,
        "changing_scope_or_price_requires_separate_product_decision": True,
        "route_variant_count": 6,
    }
    for key, value in expected_contract.items():
        if contract.get(key) != value:
            raise CandidateBuildError(f"Product-plan contract drifted: {key}")

    delivery_contracts = []
    for chapter in manifest["chapters"]:
        for variant in chapter["variants"]:
            delivery_contracts.append(
                {
                    "chapter_id": chapter["id"],
                    "variant_id": variant["id"],
                    "delivery_contract_sha256": variant[
                        "delivery_contract_sha256"
                    ],
                    "readiness_path": (
                        None
                        if chapter["id"] == "roaring_fork"
                        else str(READINESS_PATHS[(chapter["id"], variant["id"])])
                    ),
                    "route_network_target_path": (
                        "originals/smokies/roaring_fork_route_network_validation_target_v1.json"
                        if chapter["id"] == "roaring_fork"
                        else str(TARGET_PATHS[(chapter["id"], variant["id"])])
                    ),
                    "validation_passed": False,
                }
            )
    delivery_contracts.sort(key=lambda row: (row["chapter_id"], row["variant_id"]))
    assets = manifest["assets"]
    stories = manifest["stories"]
    rf_source_chapter = rf_manifest["chapters"][0]
    rf_candidate_chapter = next(
        row for row in manifest["chapters"] if row["id"] == "roaring_fork"
    )
    rf_source_projection = _delivery_projection(rf_source_chapter)
    rf_candidate_projection = _delivery_projection(rf_candidate_chapter)
    if rf_source_projection != rf_candidate_projection:
        raise CandidateBuildError("Historical Roaring Fork delivery semantics changed")
    return {
        "schema_version": 1,
        "kind": "trailhead_original_complete_private_candidate",
        "candidate_id": CANDIDATE_ID,
        "product_id": PRODUCT_ID,
        "status": "complete_private_candidate_owner_dual_platform_preview_required",
        "source_revision": {
            "commit": SOURCE_COMMIT,
            "tree": SOURCE_TREE,
            "frozen_route_readiness_slice_committed": True,
            "uncommitted_release_guard_work_bound": False,
        },
        "private_candidate_assembly_authority": {
            "source_task_id": "019fe9fb-cafa-75d3-b663-1e5051731cd5",
            "workflow_checkpoint": 4,
            "trigger": "exact_checkpoint3_media_acceptance_complete",
            "automatic_network_free_private_candidate_step": True,
            "prior_media_overlays_rewritten_to_manufacture_manifest_authority": False,
            "authority_expands_to_upload_or_database_or_release": False,
        },
        "product_contract": {
            **expected_contract,
            "public_catalog_product_count": 1,
            "standalone_product_ids": [],
            "source_path": str(PRODUCT_PLAN),
            "source_sha256": sources[str(PRODUCT_PLAN)]["sha256"],
            "approval_overlay_path": str(CHECKPOINT2),
            "approval_overlay_sha256": sources[str(CHECKPOINT2)]["sha256"],
        },
        "manifest": {
            "path": str(MANIFEST_PATH),
            "byte_count": len(manifest_bytes),
            "sha256": hashlib.sha256(manifest_bytes).hexdigest(),
            "normalized_canonical_sha256": hashlib.sha256(
                manifest_encoded.encode("utf-8")
            ).hexdigest(),
            "schema_version": 3,
            "chapter_count": 4,
            "variant_count": 6,
            "base_entry_count": 77,
            "directional_substitution_count": sum(
                len(row.get("variant_overrides", [])) for row in stories
            ),
            "narration_asset_count": sum(
                row.get("kind") == "narration" for row in assets
            ),
            "image_asset_count": sum(row.get("kind") == "image" for row in assets),
            "content_asset_count": len(assets),
            "offline_region_count": 1,
            "offline_region_id": manifest["offline_map"]["region_id"],
            "asset_paths_are_expected_immutable_api_routes": True,
            "asset_upload_or_availability_claimed": False,
        },
        "narration_profile": {
            "profile_id": PROFILE_ID,
            "path": str(PROFILE_PATH),
            "byte_count": len(profile_bytes),
            "sha256": hashlib.sha256(profile_bytes).hexdigest(),
            "historical_roaring_fork_profile_path": str(RF_PROFILE),
            "historical_roaring_fork_profile_sha256": sources[str(RF_PROFILE)][
                "sha256"
            ],
            "byte_identical_to_historical_accepted_profile": (
                hashlib.sha256(profile_bytes).hexdigest()
                == sources[str(RF_PROFILE)]["sha256"]
            ),
            "exact_james_settings_bound_by_three_remaining_locks": True,
            "profile_applied_to_all_85_narration_assets": True,
        },
        "attribution_set": {
            "attribution_id": ATTRIBUTION_ID,
            "path": str(ATTRIBUTION_PATH),
            "byte_count": len(attribution_bytes),
            "sha256": hashlib.sha256(attribution_bytes).hexdigest(),
            "artwork_asset_count": attribution["artwork_asset_count"],
        },
        "readiness_and_route_targets": {
            "non_roaring_fork_variant_count": len(readiness_pairs),
            "delivery_readiness_record_count": len(READINESS_PATHS),
            "route_network_target_record_count": len(TARGET_PATHS),
            "pairs": [
                {
                    "chapter_id": chapter_id,
                    "variant_id": variant_id,
                    "readiness": sources[str(READINESS_PATHS[(chapter_id, variant_id)])],
                    "route_network_target": sources[
                        str(TARGET_PATHS[(chapter_id, variant_id)])
                    ],
                    "delivery_contract_resolved_from_normalized_manifest": next(
                        row["delivery_contract_sha256"]
                        for row in delivery_contracts
                        if (row["chapter_id"], row["variant_id"])
                        == (chapter_id, variant_id)
                    ),
                    "trusted_validation_passed": False,
                }
                for chapter_id, variant_id in sorted(readiness_pairs)
            ],
        },
        "route_duration_estimates": {
            "basis": "deterministic_private_placeholder_at_36_mph_from_checked_route_distance",
            "owner_accepted": False,
            "real_audio_timing_passed": False,
            "trusted_validation_evidence": False,
            "publication_evidence": False,
        },
        "delivery_contracts": delivery_contracts,
        "roaring_fork_preservation": {
            "source_manifest": sources[str(RF_MANIFEST)],
            "story_count": 13,
            "narration_asset_count": 13,
            "image_asset_count": 7,
            "story_rows_sha256": _canonical_sha(rf_manifest["stories"]),
            "candidate_story_rows_sha256": _canonical_sha(
                [row for row in stories if row["id"].startswith("rf_")]
            ),
            "asset_rows_sha256": _canonical_sha(rf_manifest["assets"]),
            "candidate_asset_rows_sha256": _canonical_sha(
                [row for row in assets if row["id"].startswith("rf_")]
            ),
            "delivery_projection_sha256": _canonical_sha(rf_source_projection),
            "candidate_delivery_projection_sha256": _canonical_sha(
                rf_candidate_projection
            ),
            "source_manifest_or_historical_evidence_rewritten": False,
        },
        "source_bindings": sources,
        "privacy": {
            "absolute_local_paths_serialized": False,
            "external_media_root_serialized": False,
            "raw_exif_serialized": False,
            "provider_key_or_account_identity_serialized": False,
        },
        "gates": {
            "private_candidate_built": True,
            "owner_dual_platform_preview_accepted": False,
            "upload_allowed": False,
            "ingestion_allowed": False,
            "database_accessed": False,
            "database_mutation_allowed": False,
            "trusted_validation_allowed": False,
            "trusted_validation_passed": False,
            "deployment_allowed": False,
            "production_mutation_allowed": False,
            "publication_allowed": False,
            "public_release": False,
        },
        "next_action": (
            "build_compatible_signed_mobile_candidates_then_request_exact_dual_platform_private_preview"
        ),
    }


def build_all() -> dict[Path, bytes]:
    sources = _checked_sources()
    rf_manifest = _read_json(RF_MANIFEST)
    rf_profile = _read_json(RF_PROFILE)
    rf_artwork = _read_json(RF_ARTWORK_APPROVAL)
    rf_artwork_review = _read_json(RF_ARTWORK_REVIEW)
    media = _read_json(MEDIA_ACCEPTANCE)
    dossiers = _read_json(DOSSIERS)
    route_evidence = _read_json(ROUTES)
    route_specs = _read_json(ROUTE_SPECS)
    editorials = {
        chapter_id: _read_json(path)
        for chapter_id, path in EDITORIAL_PATHS.items()
    }
    locks = {
        chapter_id: _read_json(path) for chapter_id, path in LOCK_PATHS.items()
    }
    readiness_pairs = _validate_readiness_pairs(sources)
    profile = _build_profile(rf_profile, locks)
    new_stories, new_assets, _request_to_asset = _build_new_assets_and_stories(
        media, editorials, locks, dossiers
    )
    all_stories = copy.deepcopy(rf_manifest["stories"]) + copy.deepcopy(new_stories)
    attribution = _build_attribution(
        rf_manifest, rf_artwork, rf_artwork_review, media, all_stories
    )
    manifest, manifest_encoded = _build_manifest(
        rf_manifest,
        profile,
        new_stories,
        new_assets,
        readiness_pairs,
        route_evidence,
        route_specs,
    )
    profile_bytes = _render(profile)
    attribution_bytes = _render(attribution)
    manifest_bytes = _render(manifest)
    candidate = _build_candidate(
        manifest,
        manifest_encoded,
        manifest_bytes,
        profile_bytes,
        attribution,
        attribution_bytes,
        sources,
        rf_manifest,
        readiness_pairs,
    )
    return {
        PROFILE_PATH: profile_bytes,
        ATTRIBUTION_PATH: attribution_bytes,
        MANIFEST_PATH: manifest_bytes,
        CANDIDATE_PATH: _render(candidate),
    }


def _write(outputs: dict[Path, bytes]) -> None:
    for relative, payload in outputs.items():
        path = ROOT / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)


def _check(outputs: dict[Path, bytes]) -> None:
    for relative, payload in outputs.items():
        path = ROOT / relative
        if not path.is_file() or path.read_bytes() != payload:
            raise CandidateBuildError(f"Generated artifact drifted: {relative}")


def _summary(outputs: dict[Path, bytes]) -> dict[str, Any]:
    return {
        "status": "verified",
        "network_accessed": False,
        "external_media_accessed": False,
        "database_accessed": False,
        "upload_performed": False,
        "trusted_validation_performed": False,
        "deployment_performed": False,
        "publication_performed": False,
        "artifacts": {
            str(relative): {
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
            for relative, payload in sorted(outputs.items(), key=lambda item: str(item[0]))
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = build_all()
    if args.write:
        _write(outputs)
    else:
        _check(outputs)
    print(json.dumps(_summary(outputs), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
