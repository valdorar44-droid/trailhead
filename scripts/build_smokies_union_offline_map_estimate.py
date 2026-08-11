#!/usr/bin/env python3
"""Build the network-free Smokies union offline-map estimate.

This builder reads only pinned repository files. It does not fetch styles or
tiles, inspect a device, build an application, access a database, deploy code,
or authorize publication. The result is a conservative planning estimate for
the exact checked six-variant candidate, not download or device evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = Path("originals/smokies/smokies_union_offline_map_estimate_v1.json")
CANDIDATE_MANIFEST_PATH = Path(
    "originals/smokies/smokies_complete_private_manifest_v3.json"
)
RF_MANIFEST_PATH = Path("originals/smokies/roaring_fork_private_manifest_v3.json")
RF_READINESS_PATH = Path(
    "originals/smokies/roaring_fork_publication_readiness_v1.json"
)

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
ARTIFACT_ID = "smokies_union_offline_map_estimate_20260811_v1"
REGION_ID = "smokies_ridges_rivers_living_memory_union_private_v1"
EXPECTED_BOUNDS = {
    "east": -83.2988839,
    "north": 35.7277845,
    "south": 35.4843999,
    "west": -84.01001532735944,
}
MIN_ZOOM = 10
MAX_ZOOM = 16
EXPECTED_VARIANTS = (
    "mountain_crossing:tn_to_nc",
    "mountain_crossing:nc_to_tn",
    "little_river_cades_cove:sugarlands_to_cades_cove_loop",
    "roaring_fork:one_way",
    "foothills_parkway:west_to_east",
    "foothills_parkway:east_to_west",
)
EXPECTED_TILE_ROWS = (
    (10, 273, 275, 403, 403, 3),
    (11, 546, 550, 806, 807, 10),
    (12, 1092, 1100, 1612, 1615, 36),
    (13, 2184, 2200, 3224, 3231, 136),
    (14, 4368, 4400, 6449, 6462, 462),
    (15, 8737, 8801, 12898, 12925, 1820),
    (16, 17474, 17603, 25796, 25850, 7150),
)
EXPECTED_TILE_COUNT = 9617
EXPECTED_ASSET_COUNT = 98
EXPECTED_ASSET_BYTES = 458_155_200

RNMAPBOX_STYLE_URI = "mapbox://styles/mapbox/outdoors-v12"
RNMAPBOX_STYLE_ID = "outdoors"
RNMAPBOX_STYLE_BYTES = 4_500_000
RNMAPBOX_BYTES_PER_TILE = 18_000
MAPLIBRE_STYLE_URI = "https://tiles.gettrailhead.app/api/style.json"
MAPLIBRE_TILE_TEMPLATE = "https://tiles.gettrailhead.app/api/tiles/{z}/{x}/{y}.pbf"
MAPLIBRE_SOURCE_MAX_ZOOM = 15
MAPLIBRE_STYLE_BYTES = 1_500_000
MAPLIBRE_BYTES_PER_TILE = 22_000
MIN_RENDERER_TILE_BYTES = 256_000
BACKEND_TILE_COUNT_LIMIT = 350_000
MOBILE_AREA_ITEM_LIMIT = 260_000
MAPLIBRE_NATIVE_TILE_LIMIT = 1_000_000
MOBILE_AREA_MB_LIMIT = 4_200
MOBILE_HIGH_DETAIL_MB_PER_TILE = 0.018
GENERIC_OFFLINE_V2_STORAGE_MULTIPLIER = 1.08
ORIGINAL_FREE_SPACE_MULTIPLIER = 1.1

EXPECTED_RNMAPBOX_ESTIMATED_BYTES = 177_606_000
EXPECTED_MAPLIBRE_ESTIMATED_BYTES = 213_074_000
SELECTED_ESTIMATED_BYTES = 213_074_000
EXPECTED_TOTAL_BUNDLE_BYTES = 671_229_200
EXPECTED_REQUIRED_FREE_BYTES = 738_352_120

PINNED_SOURCES: dict[str, tuple[int, str]] = {
    "cloudflare/wrangler-worker/src/worker.js": (
        52990,
        "e9bc17ddaafa1b6b2cf162bdb633cbe2f1f6a973dd79e495ea91fd23266db3ae",
    ),
    "dashboard/offline_bundles_v2.py": (
        58922,
        "5d8d4d35c29d477408206f64b66b3cd1d65b98400dcb70ab70a350b9c6e5cbca",
    ),
    "mobile/app/(tabs)/map.tsx": (
        1734754,
        "09c5c4ee9e329077fcbcb3b91f05051d33ca83f64ff1329b1e42bb7cbee3006d",
    ),
    "mobile/components/NativeMap/offlineManager.ts": (
        13822,
        "f1b06c6c6736498e57de3be81c2f43c237dcc45773208beadd3d69604cf70d5d",
    ),
    "mobile/components/NativeMap/offlinePackStatus.ts": (
        3330,
        "50d497a0b4e84873197e68ea4820ddccccb14510b54ebc3effd639f5277cbd81",
    ),
    "mobile/lib/originals/bundleStore.ts": (
        31267,
        "1f3a60cd9131cdd69560e09dbf42cf755911f5adff8884ba7e7764f3e36c4765",
    ),
    "mobile/lib/originals/expoFileAdapter.ts": (
        2790,
        "5ef85c3e3fc3ebf32ad178f7dd9fd4ac1680838023f74e1b0f2e4537fdf67a9d",
    ),
    "mobile/lib/originals/mapAdapter.ts": (
        9779,
        "3a77508b919049a1426437fa8e91c69c4af41fdb4ba292ec64d2bd86f5ab4c51",
    ),
    "mobile/lib/originals/mapPresentation.ts": (
        1337,
        "2d1b4bc06cf8e2fe267eb1b8f6812402dc0d4ea5bb7dfd36f9aa9240dcda8f63",
    ),
    str(CANDIDATE_MANIFEST_PATH): (
        3768450,
        "d2cfa5aeb0116359326f682fb49d59ee156157f9efbfb8e8a53f99e830ca54eb",
    ),
    str(RF_MANIFEST_PATH): (
        171413,
        "7e9cab7e0325c6124a2605c83867929780f575e5814c7fdc634c091a9c351467",
    ),
    str(RF_READINESS_PATH): (
        12875,
        "81317b0bcdb052f1b9396fbe861aec20db3b72a9bd3f745ab5d88618ad58a199",
    ),
}

CONTRACT_SNIPPETS: dict[str, tuple[str, ...]] = {
    "dashboard/offline_bundles_v2.py": (
        'map_style_bytes = 4_500_000 if renderer.id == "rnmapbox" else 1_500_000',
        'tiles * (18_000 if renderer.id == "rnmapbox" else 22_000)',
        "if tiles > 350_000:",
        "required_storage_bytes = math.ceil(required_bytes * 1.08)",
    ),
    "mobile/app/(tabs)/map.tsx": (
        "const perItemMb = detail === 'high' ? 0.018 : 0.014;",
        "offlineAreaSelection.estimatedItems > 260_000",
        "offlineAreaSelection.estimatedMb > 4200",
    ),
    "mobile/components/NativeMap/offlineManager.ts": (
        "const MAX_TILE_COUNT = 1_000_000;",
        "https://tiles.gettrailhead.app/api/style.json",
        "renderer === 'rnmapbox' ? MapboxGL.offlineManager : MapLibreGL.offlineManager",
    ),
    "mobile/components/NativeMap/offlinePackStatus.ts": (
        "Math.round(bytes / 1_048_576 * 10) / 10",
        "candidate.tiles.some(tile => String(tile).includes('/api/tiles/'))",
    ),
    "mobile/lib/originals/bundleStore.ts": (
        "+ Math.max(0, manifest.offline_map.estimated_bytes);",
        "freeBytes < totalBytes * 1.1",
    ),
    "mobile/lib/originals/expoFileAdapter.ts": (
        "FileSystem.getFreeDiskStorageAsync().catch(() => null)",
    ),
    "mobile/lib/originals/mapAdapter.ts": (
        "const renderer = config.mapbox_token",
        "? 'rnmapbox'",
        ": await rendererState.resolveActiveNativeMapRenderer();",
        "originalOfflineStyleURI(renderer)",
    ),
    "mobile/lib/originals/mapPresentation.ts": (
        "mapbox://styles/mapbox/outdoors-v12",
        "return renderer === 'rnmapbox' ? ORIGINALS_MAPBOX_STYLE_URI : undefined;",
    ),
    "cloudflare/wrangler-worker/src/worker.js": (
        'if (path === "/api/style.json")',
        "tiles: [`${TILE_BASE}/api/tiles/{z}/{x}/{y}.pbf`]",
        "maxzoom: 15",
    ),
}


class EstimateBuildError(ValueError):
    """The pinned candidate or estimator contract cannot produce the artifact."""


def _file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _canonical_sha(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _read_json(relative: Path) -> dict[str, Any]:
    value = json.loads((ROOT / relative).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise EstimateBuildError(f"Expected a JSON object: {relative}")
    return value


def _checked_sources() -> dict[str, dict[str, object]]:
    bindings: dict[str, dict[str, object]] = {}
    for relative, (expected_bytes, expected_sha) in sorted(PINNED_SOURCES.items()):
        path = ROOT / relative
        if not path.is_file():
            raise EstimateBuildError(f"Pinned source is missing: {relative}")
        actual_bytes = path.stat().st_size
        actual_sha = _file_sha(path)
        if actual_bytes != expected_bytes or actual_sha != expected_sha:
            raise EstimateBuildError(f"Pinned source drifted: {relative}")
        bindings[relative] = {
            "byte_count": actual_bytes,
            "path": relative,
            "sha256": actual_sha,
        }
    for relative, snippets in CONTRACT_SNIPPETS.items():
        source = (ROOT / relative).read_text(encoding="utf-8")
        if any(snippet not in source for snippet in snippets):
            raise EstimateBuildError(f"Estimator contract drifted: {relative}")
    return bindings


def _tile_x(longitude: float, zoom: int) -> int:
    count = 1 << zoom
    value = int((longitude + 180.0) / 360.0 * count)
    return max(0, min(count - 1, value))


def _tile_y(latitude: float, zoom: int) -> int:
    count = 1 << zoom
    clipped = max(-85.05112878, min(85.05112878, latitude))
    radians = math.radians(clipped)
    value = int(
        (1.0 - math.asinh(math.tan(radians)) / math.pi) / 2.0 * count
    )
    return max(0, min(count - 1, value))


def _tile_rows_for_range(
    bounds: dict[str, float], min_zoom: int, max_zoom: int
) -> list[dict[str, int]]:
    rows = []
    for zoom in range(min_zoom, max_zoom + 1):
        west_x = _tile_x(float(bounds["west"]), zoom)
        east_x = _tile_x(float(bounds["east"]), zoom)
        north_y = _tile_y(float(bounds["north"]), zoom)
        south_y = _tile_y(float(bounds["south"]), zoom)
        rows.append(
            {
                "east_x": east_x,
                "north_y": north_y,
                "south_y": south_y,
                "tile_count": (east_x - west_x + 1)
                * (south_y - north_y + 1),
                "west_x": west_x,
                "zoom": zoom,
            }
        )
    return rows


def _tile_rows(bounds: dict[str, float]) -> list[dict[str, int]]:
    rows = _tile_rows_for_range(bounds, MIN_ZOOM, MAX_ZOOM)
    observed = tuple(
        (
            row["zoom"],
            row["west_x"],
            row["east_x"],
            row["north_y"],
            row["south_y"],
            row["tile_count"],
        )
        for row in rows
    )
    if observed != EXPECTED_TILE_ROWS:
        raise EstimateBuildError("Exact union tile enumeration drifted")
    return rows


def _contains(bounds: dict[str, float], longitude: float, latitude: float) -> bool:
    return (
        bounds["west"] <= longitude <= bounds["east"]
        and bounds["south"] <= latitude <= bounds["north"]
    )


def _validate_candidate(manifest: dict[str, Any]) -> dict[str, Any]:
    expected_offline = {
        "bounds": EXPECTED_BOUNDS,
        "estimated_bytes": 0,
        "max_zoom": MAX_ZOOM,
        "min_zoom": MIN_ZOOM,
        "region_id": REGION_ID,
    }
    if manifest.get("offline_map") != expected_offline:
        raise EstimateBuildError("Candidate union offline-map contract drifted")
    chapters = manifest.get("chapters")
    if not isinstance(chapters, list):
        raise EstimateBuildError("Candidate chapters are missing")
    variants: list[str] = []
    covered_coordinates = 0
    for chapter in chapters:
        chapter_id = str(chapter.get("id") or "")
        for variant in chapter.get("variants", []):
            variants.append(f"{chapter_id}:{variant.get('id')}")
            coordinates = variant.get("route", {}).get("geometry", {}).get(
                "coordinates", []
            )
            for coordinate in coordinates:
                if (
                    not isinstance(coordinate, list)
                    or len(coordinate) < 2
                    or not _contains(
                        EXPECTED_BOUNDS, float(coordinate[0]), float(coordinate[1])
                    )
                ):
                    raise EstimateBuildError("Union bounds do not cover every route point")
                covered_coordinates += 1
            for reference in variant.get("cue_refs", []) + variant.get(
                "selectable_refs", []
            ):
                location = reference.get("coordinates")
                if location is None:
                    continue
                if not _contains(
                    EXPECTED_BOUNDS,
                    float(location["lng"]),
                    float(location["lat"]),
                ):
                    raise EstimateBuildError(
                        "Union bounds do not cover every delivery reference"
                    )
                covered_coordinates += 1
    if tuple(variants) != EXPECTED_VARIANTS:
        raise EstimateBuildError("Exact six-variant order drifted")
    assets = manifest.get("assets")
    if not isinstance(assets, list) or len(assets) != EXPECTED_ASSET_COUNT:
        raise EstimateBuildError("Exact content-asset inventory drifted")
    asset_bytes = sum(int(asset.get("bytes") or 0) for asset in assets)
    if asset_bytes != EXPECTED_ASSET_BYTES:
        raise EstimateBuildError("Exact content-asset byte total drifted")
    return {
        "asset_bytes": asset_bytes,
        "asset_count": len(assets),
        "asset_rows_sha256": _canonical_sha(assets),
        "covered_coordinate_count": covered_coordinates,
        "variant_ids": variants,
    }


def _validate_roaring_fork_history() -> dict[str, Any]:
    manifest = _read_json(RF_MANIFEST_PATH)
    readiness = _read_json(RF_READINESS_PATH)
    offline = manifest.get("offline_map")
    if not isinstance(offline, dict) or offline.get("estimated_bytes") != 0:
        raise EstimateBuildError("Historical Roaring Fork estimate drifted")
    blockers = readiness.get("blockers")
    final_blocker = next(
        (
            blocker
            for blocker in blockers or []
            if blocker.get("id") == "final_publication_manifest_and_catalog"
        ),
        None,
    )
    missing = (
        final_blocker.get("facts", {}).get("missing_publication_reviews", [])
        if isinstance(final_blocker, dict)
        else []
    )
    if (
        not isinstance(final_blocker, dict)
        or final_blocker.get("facts", {}).get("offline_map_estimated_bytes") != 0
        or "offline_bundle_reviewed" not in missing
    ):
        raise EstimateBuildError("Historical Roaring Fork offline blocker drifted")
    rows = _tile_rows_for_range(
        offline["bounds"], int(offline["min_zoom"]), int(offline["max_zoom"])
    )
    return {
        "historical_estimated_bytes": 0,
        "historical_tile_count": sum(row["tile_count"] for row in rows),
        "offline_bundle_reviewed": False,
        "reused_as_union_size_evidence": False,
    }


def _estimate_renderer(style_bytes: int, bytes_per_tile: int) -> dict[str, int]:
    tile_bytes = max(
        MIN_RENDERER_TILE_BYTES, EXPECTED_TILE_COUNT * bytes_per_tile
    )
    return {
        "bytes_per_tile": bytes_per_tile,
        "estimated_bytes": style_bytes + tile_bytes,
        "minimum_tile_bytes": MIN_RENDERER_TILE_BYTES,
        "style_bytes": style_bytes,
        "tile_bytes": tile_bytes,
    }


def _build_artifact() -> dict[str, Any]:
    sources = _checked_sources()
    candidate = _validate_candidate(_read_json(CANDIDATE_MANIFEST_PATH))
    tile_rows = _tile_rows(EXPECTED_BOUNDS)
    total_tiles = sum(row["tile_count"] for row in tile_rows)
    if total_tiles != EXPECTED_TILE_COUNT:
        raise EstimateBuildError("Union tile total drifted")

    rnmapbox = _estimate_renderer(RNMAPBOX_STYLE_BYTES, RNMAPBOX_BYTES_PER_TILE)
    maplibre = _estimate_renderer(MAPLIBRE_STYLE_BYTES, MAPLIBRE_BYTES_PER_TILE)
    if rnmapbox["estimated_bytes"] != EXPECTED_RNMAPBOX_ESTIMATED_BYTES:
        raise EstimateBuildError("RNMapbox estimate drifted")
    if maplibre["estimated_bytes"] != EXPECTED_MAPLIBRE_ESTIMATED_BYTES:
        raise EstimateBuildError("MapLibre estimate drifted")
    selected = max(rnmapbox["estimated_bytes"], maplibre["estimated_bytes"])
    if selected != SELECTED_ESTIMATED_BYTES:
        raise EstimateBuildError("Conservative selected estimate drifted")

    total_bundle_bytes = candidate["asset_bytes"] + selected
    required_free_bytes = (total_bundle_bytes * 11 + 9) // 10
    if total_bundle_bytes != EXPECTED_TOTAL_BUNDLE_BYTES:
        raise EstimateBuildError("Estimated complete-bundle total drifted")
    if required_free_bytes != EXPECTED_REQUIRED_FREE_BYTES:
        raise EstimateBuildError("Mobile free-space threshold drifted")

    style_revision = "style-" + hashlib.sha256(
        RNMAPBOX_STYLE_URI.encode("utf-8")
    ).hexdigest()[:16]
    if style_revision != "style-421a681154019ec8":
        raise EstimateBuildError("RNMapbox URI-derived style revision drifted")
    mobile_display_mb = max(
        6,
        math.floor(EXPECTED_TILE_COUNT * MOBILE_HIGH_DETAIL_MB_PER_TILE + 0.5),
    )
    if mobile_display_mb != 173:
        raise EstimateBuildError("Secondary mobile display estimate drifted")

    return {
        "artifact_id": ARTIFACT_ID,
        "candidate_binding": {
            "candidate_manifest": sources[str(CANDIDATE_MANIFEST_PATH)],
            "candidate_offline_map_estimated_bytes": 0,
            "content_asset_bytes": candidate["asset_bytes"],
            "content_asset_count": candidate["asset_count"],
            "content_asset_rows_sha256": candidate["asset_rows_sha256"],
            "manifest_estimated_bytes_mutated": False,
            "product_id": PRODUCT_ID,
        },
        "evidence_scope": {
            "actual_installed_bytes_measured": False,
            "device_or_download_evidence": False,
            "estimate_only": True,
            "network_free": True,
            "provider_resource_snapshot_obtained": False,
            "style_or_tile_download_performed": False,
            "suitable_for_final_offline_bundle_review_without_device_evidence": False,
        },
        "estimators": {
            "maplibre_fallback": {
                **maplibre,
                "renderer": "maplibre",
                "source_max_zoom": MAPLIBRE_SOURCE_MAX_ZOOM,
                "style_uri": MAPLIBRE_STYLE_URI,
                "tile_template": MAPLIBRE_TILE_TEMPLATE,
                "zoom_16_counted_as_conservative_requested_range": True,
            },
            "rnmapbox_release_path": {
                **rnmapbox,
                "renderer": "rnmapbox",
                "style_id": RNMAPBOX_STYLE_ID,
                "style_revision": style_revision,
                "style_revision_semantics": "sha256_prefix_of_style_uri_not_provider_resource_revision",
                "style_uri": RNMAPBOX_STYLE_URI,
            },
            "secondary_mobile_area_picker_display": {
                "canonical_for_manifest_estimated_bytes": False,
                "display_estimated_mb": mobile_display_mb,
                "high_detail_mb_per_tile": MOBILE_HIGH_DETAIL_MB_PER_TILE,
                "minimum_display_mb": 6,
            },
            "selection": {
                "estimated_bytes": selected,
                "selected_renderer_ceiling": "maplibre_fallback",
                "strategy": "maximum_of_repository_supported_native_renderer_estimates",
                "unit": "bytes",
            },
        },
        "gates": {
            "android_build_compatible": False,
            "android_build_started": False,
            "database_accessed": False,
            "database_mutation_performed": False,
            "deployment_performed": False,
            "device_download_performed": False,
            "dual_platform_private_preview_accepted": False,
            "ios_build_compatible": False,
            "ios_build_started": False,
            "network_accessed": False,
            "offline_bundle_reviewed": False,
            "production_mutation_performed": False,
            "publication_authorization_present": False,
            "publication_performed": False,
            "trusted_validation_performed": False,
        },
        "kind": "network_free_union_offline_map_estimate",
        "limits": {
            "backend_tile_count_limit": BACKEND_TILE_COUNT_LIMIT,
            "backend_tile_count_limit_passed": total_tiles <= BACKEND_TILE_COUNT_LIMIT,
            "maplibre_native_tile_limit": MAPLIBRE_NATIVE_TILE_LIMIT,
            "maplibre_native_tile_limit_passed": total_tiles
            <= MAPLIBRE_NATIVE_TILE_LIMIT,
            "mobile_area_item_limit": MOBILE_AREA_ITEM_LIMIT,
            "mobile_area_item_limit_passed": total_tiles <= MOBILE_AREA_ITEM_LIMIT,
            "mobile_area_mb_limit": MOBILE_AREA_MB_LIMIT,
            "mobile_area_mb_limit_passed": mobile_display_mb <= MOBILE_AREA_MB_LIMIT,
        },
        "next_required_evidence": {
            "android_signed_build_download": True,
            "exact_renderer_and_style_recorded_per_platform": True,
            "installed_pack_restart_recovery": True,
            "installed_size_upper_bound_no_greater_than_estimate": True,
            "ios_signed_build_download": True,
            "owner_dual_platform_acceptance": True,
            "raw_completed_resource_size_preferred": True,
            "scoped_deletion_and_recovered_space": True,
        },
        "prior_roaring_fork_evidence": _validate_roaring_fork_history(),
        "privacy": {
            "absolute_local_paths_serialized": False,
            "account_or_device_identifier_serialized": False,
            "api_key_or_access_token_serialized": False,
            "raw_provider_response_serialized": False,
        },
        "schema_version": 1,
        "source_bindings": sources,
        "status": "network_free_estimate_ready_for_device_review",
        "storage": {
            "content_asset_bytes": candidate["asset_bytes"],
            "estimated_complete_bundle_bytes": total_bundle_bytes,
            "generic_offline_v2_map_only_reserve": {
                "folded_into_manifest_estimated_bytes": False,
                "maplibre_required_storage_bytes": math.ceil(
                    maplibre["estimated_bytes"]
                    * GENERIC_OFFLINE_V2_STORAGE_MULTIPLIER
                ),
                "multiplier": GENERIC_OFFLINE_V2_STORAGE_MULTIPLIER,
                "rnmapbox_required_storage_bytes": math.ceil(
                    rnmapbox["estimated_bytes"]
                    * GENERIC_OFFLINE_V2_STORAGE_MULTIPLIER
                ),
                "semantics": "separate_generic_offline_v2_required_storage_reserve",
            },
            "original_runtime_free_space_multiplier": ORIGINAL_FREE_SPACE_MULTIPLIER,
            "required_free_space_bytes": required_free_bytes,
            "selected_offline_map_estimated_bytes": selected,
            "unit": "bytes",
        },
        "union_region": {
            "bounds": EXPECTED_BOUNDS,
            "covered_route_and_reference_coordinate_count": candidate[
                "covered_coordinate_count"
            ],
            "exact_bounds_changed_or_padded": False,
            "max_zoom": MAX_ZOOM,
            "min_zoom": MIN_ZOOM,
            "per_zoom_tiles": tile_rows,
            "region_id": REGION_ID,
            "tile_enumeration": "inclusive_web_mercator_xyz_integer_ranges",
            "total_tile_count": total_tiles,
            "variant_count": len(candidate["variant_ids"]),
            "variant_ids": candidate["variant_ids"],
        },
    }


def _render(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def build_all() -> dict[Path, bytes]:
    return {OUTPUT_PATH: _render(_build_artifact())}


def _write(outputs: dict[Path, bytes]) -> None:
    for relative, payload in outputs.items():
        path = ROOT / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)


def _check(outputs: dict[Path, bytes]) -> None:
    for relative, payload in outputs.items():
        path = ROOT / relative
        if not path.is_file() or path.read_bytes() != payload:
            raise EstimateBuildError(f"Generated artifact drifted: {relative}")


def _summary(outputs: dict[Path, bytes]) -> dict[str, Any]:
    return {
        "artifacts": {
            str(relative): {
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
            for relative, payload in sorted(outputs.items(), key=lambda item: str(item[0]))
        },
        "database_accessed": False,
        "deployment_performed": False,
        "device_accessed": False,
        "manifest_mutated": False,
        "mobile_build_performed": False,
        "network_accessed": False,
        "publication_performed": False,
        "status": "verified",
        "tile_or_style_download_performed": False,
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
