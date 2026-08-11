from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "scripts/build_smokies_union_offline_map_estimate.py"
SPEC = importlib.util.spec_from_file_location(
    "build_smokies_union_offline_map_estimate", BUILDER_PATH
)
assert SPEC is not None and SPEC.loader is not None
builder = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = builder
SPEC.loader.exec_module(builder)


def load(relative: str | Path) -> dict:
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def artifact() -> dict:
    return load(builder.OUTPUT_PATH)


def test_builder_is_deterministic_network_free_and_manifest_read_only() -> None:
    subprocess.run(
        [sys.executable, "-m", "py_compile", str(BUILDER_PATH)],
        cwd=ROOT,
        check=True,
    )
    result = subprocess.run(
        [sys.executable, str(BUILDER_PATH), "--check"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    summary = json.loads(result.stdout)
    assert summary["status"] == "verified"
    assert summary["network_accessed"] is False
    assert summary["tile_or_style_download_performed"] is False
    assert summary["device_accessed"] is False
    assert summary["mobile_build_performed"] is False
    assert summary["manifest_mutated"] is False
    assert summary["database_accessed"] is False
    assert summary["deployment_performed"] is False
    assert summary["publication_performed"] is False
    assert set(summary["artifacts"]) == {str(builder.OUTPUT_PATH)}
    generated = builder.build_all()[builder.OUTPUT_PATH]
    assert (ROOT / builder.OUTPUT_PATH).read_bytes() == generated
    assert summary["artifacts"][str(builder.OUTPUT_PATH)] == {
        "bytes": len(generated),
        "sha256": hashlib.sha256(generated).hexdigest(),
    }


def test_every_pinned_source_and_contract_is_exact(artifact: dict) -> None:
    bindings = builder._checked_sources()
    assert set(bindings) == set(builder.PINNED_SOURCES)
    assert artifact["source_bindings"] == bindings
    for relative, (expected_bytes, expected_sha) in builder.PINNED_SOURCES.items():
        path = ROOT / relative
        assert path.stat().st_size == expected_bytes
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected_sha
        assert bindings[relative] == {
            "byte_count": expected_bytes,
            "path": relative,
            "sha256": expected_sha,
        }


def test_source_drift_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    original = builder._file_sha

    def changed(path: Path) -> str:
        if path == builder.ROOT / "dashboard/offline_bundles_v2.py":
            return "0" * 64
        return original(path)

    monkeypatch.setattr(builder, "_file_sha", changed)
    with pytest.raises(builder.EstimateBuildError, match="Pinned source drifted"):
        builder._checked_sources()


def test_exact_union_bounds_zooms_tiles_and_six_variants(artifact: dict) -> None:
    union = artifact["union_region"]
    assert union["region_id"] == builder.REGION_ID
    assert union["bounds"] == builder.EXPECTED_BOUNDS
    assert union["min_zoom"] == 10
    assert union["max_zoom"] == 16
    assert union["exact_bounds_changed_or_padded"] is False
    assert union["tile_enumeration"] == (
        "inclusive_web_mercator_xyz_integer_ranges"
    )
    assert union["total_tile_count"] == 9617
    assert union["variant_count"] == 6
    assert tuple(union["variant_ids"]) == builder.EXPECTED_VARIANTS
    rows = union["per_zoom_tiles"]
    assert tuple(
        (
            row["zoom"],
            row["west_x"],
            row["east_x"],
            row["north_y"],
            row["south_y"],
            row["tile_count"],
        )
        for row in rows
    ) == builder.EXPECTED_TILE_ROWS
    assert sum(row["tile_count"] for row in rows) == 9617
    assert union["covered_route_and_reference_coordinate_count"] > 0


def test_tile_count_matches_production_backend_estimator(artifact: dict) -> None:
    from dashboard.offline_bundles_v2 import OfflineBoundsV2, _tile_count

    bounds = OfflineBoundsV2.model_validate(builder.EXPECTED_BOUNDS)
    assert _tile_count(bounds, builder.MIN_ZOOM, builder.MAX_ZOOM) == 9617
    assert artifact["union_region"]["total_tile_count"] == _tile_count(
        bounds, builder.MIN_ZOOM, builder.MAX_ZOOM
    )


def test_both_renderer_contracts_and_conservative_selection(artifact: dict) -> None:
    estimators = artifact["estimators"]
    rnmapbox = estimators["rnmapbox_release_path"]
    assert rnmapbox == {
        "bytes_per_tile": 18_000,
        "estimated_bytes": 177_606_000,
        "minimum_tile_bytes": 256_000,
        "renderer": "rnmapbox",
        "style_bytes": 4_500_000,
        "style_id": "outdoors",
        "style_revision": "style-421a681154019ec8",
        "style_revision_semantics": (
            "sha256_prefix_of_style_uri_not_provider_resource_revision"
        ),
        "style_uri": "mapbox://styles/mapbox/outdoors-v12",
        "tile_bytes": 173_106_000,
    }
    maplibre = estimators["maplibre_fallback"]
    assert maplibre == {
        "bytes_per_tile": 22_000,
        "estimated_bytes": 213_074_000,
        "minimum_tile_bytes": 256_000,
        "renderer": "maplibre",
        "source_max_zoom": 15,
        "style_bytes": 1_500_000,
        "style_uri": "https://tiles.gettrailhead.app/api/style.json",
        "tile_bytes": 211_574_000,
        "tile_template": (
            "https://tiles.gettrailhead.app/api/tiles/{z}/{x}/{y}.pbf"
        ),
        "zoom_16_counted_as_conservative_requested_range": True,
    }
    assert estimators["selection"] == {
        "estimated_bytes": 213_074_000,
        "selected_renderer_ceiling": "maplibre_fallback",
        "strategy": "maximum_of_repository_supported_native_renderer_estimates",
        "unit": "bytes",
    }
    assert estimators["secondary_mobile_area_picker_display"] == {
        "canonical_for_manifest_estimated_bytes": False,
        "display_estimated_mb": 173,
        "high_detail_mb_per_tile": 0.018,
        "minimum_display_mb": 6,
    }


def test_exact_content_and_mobile_storage_arithmetic(artifact: dict) -> None:
    binding = artifact["candidate_binding"]
    assert binding["candidate_manifest"]["sha256"] == (
        "d2cfa5aeb0116359326f682fb49d59ee156157f9efbfb8e8a53f99e830ca54eb"
    )
    assert binding["content_asset_count"] == 98
    assert binding["content_asset_bytes"] == 458_155_200
    assert binding["candidate_offline_map_estimated_bytes"] == 0
    assert binding["manifest_estimated_bytes_mutated"] is False

    storage = artifact["storage"]
    assert storage["content_asset_bytes"] == 458_155_200
    assert storage["selected_offline_map_estimated_bytes"] == 213_074_000
    assert storage["estimated_complete_bundle_bytes"] == 671_229_200
    assert storage["original_runtime_free_space_multiplier"] == 1.1
    assert storage["required_free_space_bytes"] == 738_352_120
    assert storage["generic_offline_v2_map_only_reserve"] == {
        "folded_into_manifest_estimated_bytes": False,
        "maplibre_required_storage_bytes": 230_119_921,
        "multiplier": 1.08,
        "rnmapbox_required_storage_bytes": 191_814_480,
        "semantics": "separate_generic_offline_v2_required_storage_reserve",
    }


def test_limits_pass_without_claiming_download_or_device_evidence(
    artifact: dict,
) -> None:
    assert artifact["limits"] == {
        "backend_tile_count_limit": 350_000,
        "backend_tile_count_limit_passed": True,
        "maplibre_native_tile_limit": 1_000_000,
        "maplibre_native_tile_limit_passed": True,
        "mobile_area_item_limit": 260_000,
        "mobile_area_item_limit_passed": True,
        "mobile_area_mb_limit": 4_200,
        "mobile_area_mb_limit_passed": True,
    }
    assert artifact["evidence_scope"] == {
        "actual_installed_bytes_measured": False,
        "device_or_download_evidence": False,
        "estimate_only": True,
        "network_free": True,
        "provider_resource_snapshot_obtained": False,
        "style_or_tile_download_performed": False,
        "suitable_for_final_offline_bundle_review_without_device_evidence": False,
    }
    assert artifact["status"] == "network_free_estimate_ready_for_device_review"
    assert artifact["gates"]
    assert all(value is False for value in artifact["gates"].values())
    assert all(value is True for value in artifact["next_required_evidence"].values())


def test_roaring_fork_history_is_not_reused_as_union_size_evidence(
    artifact: dict,
) -> None:
    assert artifact["prior_roaring_fork_evidence"] == {
        "historical_estimated_bytes": 0,
        "historical_tile_count": 91,
        "offline_bundle_reviewed": False,
        "reused_as_union_size_evidence": False,
    }


def test_artifact_is_privacy_minimized_and_contains_no_local_paths(
    artifact: dict,
) -> None:
    assert artifact["privacy"] == {
        "absolute_local_paths_serialized": False,
        "account_or_device_identifier_serialized": False,
        "api_key_or_access_token_serialized": False,
        "raw_provider_response_serialized": False,
    }
    encoded = json.dumps(artifact, ensure_ascii=False)
    assert "/home/" not in encoded
    assert "C:\\" not in encoded
    assert "\\\\wsl" not in encoded.lower()
    assert "file:///" not in encoded.lower()


def test_checked_candidate_manifest_remains_unmodified() -> None:
    path = ROOT / builder.CANDIDATE_MANIFEST_PATH
    assert hashlib.sha256(path.read_bytes()).hexdigest() == (
        "d2cfa5aeb0116359326f682fb49d59ee156157f9efbfb8e8a53f99e830ca54eb"
    )
    assert load(builder.CANDIDATE_MANIFEST_PATH)["offline_map"][
        "estimated_bytes"
    ] == 0
