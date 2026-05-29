import json

from dashboard.hydro_provider import (
    HYDRO_LAYERS,
    classify_hazard,
    depth_band,
    hydro_profile,
    is_index_depth,
    read_hydro_manifest,
)
from dashboard.water_routing_provider import route_with_water_graph, water_graph_manifest
from dashboard.marine_chart_provider import (
    MarineBounds,
    fishing_conditions,
    marine_chart_profile,
    marine_spot_cards,
    suggested_corridor,
)


def test_depth_bands_and_index_contours():
    assert depth_band(4.9) == "shallow_0_5"
    assert depth_band(5) == "shallow_5_10"
    assert depth_band(12) == "moderate_10_20"
    assert depth_band(42) == "deep_40_plus"
    assert is_index_depth(10)
    assert not is_index_depth(15)


def test_hazard_classification_thresholds():
    assert classify_hazard(4.5)["kind"] == "shallow_under_5ft"
    assert classify_hazard(22, adjacent_delta_ft=18)["kind"] == "steep_dropoff_candidate"
    assert classify_hazard(30, source_tags={"feature": "Shoal reef"})["confidence"] == "source"
    assert classify_hazard(12) is None


def test_manifest_shape_and_hydro_profile(tmp_path):
    manifest = read_hydro_manifest(tmp_path)
    assert manifest["mode"] == "safe_water_awareness"
    assert manifest["layers"] == HYDRO_LAYERS
    assert "packs" in manifest
    assert any(region["id"] == "mn-lotw" for region in manifest["regions"])
    assert any(region["id"] == "ca-lotw" and region["status"] == "live_only" for region in manifest["regions"])

    profile = hydro_profile(MarineBounds(north=49.2, south=48.8, east=-94.0, west=-94.8), manifest)
    assert profile["coverage"] == "live_only"
    assert profile["counts"] == {"contours": 0, "shallow_zones": 0, "hazards": 0, "labels": 0}
    assert "not certified navigation" in profile["warning"]


def test_marine_profile_exposes_premium_provider_capabilities():
    profile = marine_chart_profile(MarineBounds(north=49.2, south=48.8, east=-94.0, west=-94.8))

    assert profile["licensed_chart"]["available"] is False
    assert profile["offline_status"]["public_live_chart"] == "live_only"
    assert profile["provider_capabilities"]["licensed_marine_chart"]["offline"] == "entitlement_required"
    assert profile["corridor_availability"]["turn_by_turn"] is False
    assert profile["corridor_availability"]["certified_navigation"] is False
    assert any(item["id"] == "shallow_0_5" for item in profile["depth_ranges"])


def test_lotw_spot_cards_are_source_disclosed():
    cards = marine_spot_cards(MarineBounds(north=49.2, south=48.8, east=-94.0, west=-94.8))

    assert cards["region"] == "lake_of_the_woods"
    assert cards["cards"]
    assert all("source" in card and "navigation_note" in card for card in cards["cards"])
    assert "Restricted chart data is not inferred" in cards["source_disclosure"]


def test_suggested_corridor_stays_planning_only():
    corridor = suggested_corridor(
        start_lat=49.10,
        start_lng=-94.32,
        end_lat=49.02,
        end_lng=-94.53,
        draft_ft=5,
    )

    assert corridor["status"] == "candidate_planning_only"
    assert len(corridor["geometry"]["coordinates"]) > 3
    assert corridor["turn_by_turn"] is False
    assert corridor["certified_navigation"] is False
    assert any(conflict["kind"] == "licensed_chart_missing" for conflict in corridor["conflicts"])
    assert any(conflict["kind"] == "draft_requires_depth_review" for conflict in corridor["conflicts"])


def test_fishing_conditions_are_labeled_heuristic():
    conditions = fishing_conditions(49.0, -94.5, at_ts=1_775_000_000)

    assert conditions["station"]["id"] == "45148"
    assert conditions["solunar"]["status"] == "heuristic_placeholder"
    assert "planning context only" in conditions["source_disclosure"]


def test_water_route_graph_manifest_and_route(tmp_path):
    graph = {
        "version": 1,
        "mode": "safe_water_advisory_routing",
        "region": "test-enc",
        "name": "Test ENC",
        "bounds": {"north": 49.1, "south": 48.9, "east": -94.1, "west": -94.5},
        "source": {"name": "Test ENC graph"},
        "confidence": "official_test_graph",
        "counts": {"nodes": 3, "edges": 2},
        "nodes": [
            [-94.40, 49.00],
            [-94.30, 49.02],
            [-94.20, 49.04],
        ],
        "edges": [
            [0, 1, 7600.0, "RECTRC", ""],
            [1, 2, 7600.0, "RECTRC", ""],
        ],
    }
    (tmp_path / "test-enc.graph.json").write_text(json.dumps(graph))

    manifest = water_graph_manifest(tmp_path)
    assert manifest["regions"][0]["id"] == "test-enc"
    assert manifest["regions"][0]["counts"]["edges"] == 2

    route = route_with_water_graph(
        start_lat=49.0005,
        start_lng=-94.4005,
        end_lat=49.0395,
        end_lng=-94.2005,
        data_dir=tmp_path,
    )
    assert route is not None
    assert route["source"] == "Test ENC graph"
    assert route["source_confidence"] == "official_test_graph"
    assert len(route["coordinates"]) >= 3
