from __future__ import annotations

import copy
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

from db.originals_route_sources import (
    ENDPOINT_JOIN_TOLERANCE_M,
    EXPECTED_FACILITY_COUNTS,
    EXPECTED_ROAD_COUNTS,
    SELECTED_FEATURE_COUNT,
    OriginalRouteSourceError,
    Projection,
    RoadGraph,
    _append_geometry,
    build_official_route_evidence,
    canonical_sha256,
    normalize_nps_road_snapshot,
)
from scripts.build_smokies_official_routes import check
from scripts.build_smokies_original_routes import load_route_spec


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "originals" / "smokies" / "nps_public_roads_snapshot_v1.json"
EVIDENCE_PATH = ROOT / "originals" / "smokies" / "official_route_evidence_v1.json"
ROUTE_SPEC_PATH = ROOT / "originals" / "smokies" / "route_variants_v1.json"


class SmokiesOfficialRoadSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        cls.snapshot = normalize_nps_road_snapshot(cls.raw)

    def test_checked_snapshot_is_canonical_and_fully_accounted(self):
        self.assertEqual(self.snapshot, self.raw)
        self.assertEqual(len(self.snapshot["features"]), SELECTED_FEATURE_COUNT)
        self.assertEqual(self.snapshot["road_counts"], EXPECTED_ROAD_COUNTS)
        self.assertEqual(self.snapshot["facility_counts"], EXPECTED_FACILITY_COUNTS)
        self.assertEqual(self.snapshot["counts"]["source_object_count"], 1_926)
        self.assertEqual(
            self.snapshot["source"]["excluded_counts_by_reason"],
            {"not_reviewed_for_selected_chapters": 1_287},
        )

    def test_every_selected_feature_is_public_extant_and_stably_identified(self):
        object_ids = set()
        geometry_ids = set()
        feature_ids = set()
        for feature in self.snapshot["features"]:
            self.assertEqual(feature["unit_code"], "GRSM")
            self.assertEqual(feature["road_status"], "Existing")
            self.assertEqual(feature["is_extant"], "True")
            self.assertEqual(feature["public_display"], "Public Map Display")
            self.assertEqual(feature["data_access"], "Unrestricted")
            self.assertEqual(feature["xy_accuracy"], ">=1m and <5m")
            self.assertNotIn(feature["object_id"], object_ids)
            self.assertNotIn(feature["geometry_id"], geometry_ids)
            self.assertNotIn(feature["feature_id"], feature_ids)
            object_ids.add(feature["object_id"])
            geometry_ids.add(feature["geometry_id"])
            feature_ids.add(feature["feature_id"])

    def test_provenance_is_hash_bound_and_navigation_claims_are_separate(self):
        source = self.snapshot["source"]
        self.assertEqual(source["license"], "us-pd")
        self.assertEqual(source["source_spatial_reference"], "NAD83(2011):104145")
        self.assertEqual(source["output_spatial_reference"], "EPSG:4326")
        self.assertEqual(source["simplification"], "none")
        self.assertIn("reference_geometry_not_live_closure_feed", source["use_constraints"])
        self.assertIn(
            "navigation_requires_routable_engine_and_current_readiness",
            source["use_constraints"],
        )
        for key in (
            "layer_definition_sha256",
            "iteminfo_sha256",
            "field_schema_sha256",
            "domain_schema_sha256",
            "query_contract_sha256",
            "raw_selected_features_sha256",
            "normalized_geometry_sha256",
        ):
            self.assertRegex(source[key], r"^[0-9a-f]{64}$")

    def test_public_or_identity_tampering_fails_closed(self):
        for key, value, message in (
            ("public_display", "Internal", "public display"),
            ("data_access", "Restricted", "unrestricted"),
            ("unit_code", "BLUE", "outside Great Smoky Mountains"),
            ("facility_location_id", "99999", "facility"),
        ):
            with self.subTest(key=key):
                changed = copy.deepcopy(self.raw)
                changed["features"][0][key] = value
                with self.assertRaisesRegex(OriginalRouteSourceError, message):
                    normalize_nps_road_snapshot(changed)

    def test_geometry_corruption_and_hash_drift_fail_closed(self):
        changed = copy.deepcopy(self.raw)
        changed["features"][0]["geometry"]["coordinates"][1] = [-83.1, 35.8]
        with self.assertRaisesRegex(OriginalRouteSourceError, "implausible internal jump"):
            normalize_nps_road_snapshot(changed)
        changed = copy.deepcopy(self.raw)
        changed["source"]["normalized_geometry_sha256"] = "0" * 64
        with self.assertRaisesRegex(OriginalRouteSourceError, "geometry hash"):
            normalize_nps_road_snapshot(changed)


class SmokiesOfficialRouteEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        cls.route_spec = load_route_spec(ROUTE_SPEC_PATH)
        cls.evidence = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))
        cls.rebuilt = build_official_route_evidence(cls.snapshot, cls.route_spec)
        cls.by_id = {item["id"]: item for item in cls.evidence["variants"]}

    def test_checked_route_evidence_is_deterministic(self):
        self.assertEqual(self.evidence, self.rebuilt)
        self.assertEqual(canonical_sha256(self.evidence), canonical_sha256(self.rebuilt))
        self.assertTrue(self.evidence["source_policy"]["operational_readiness_separate"])
        self.assertFalse(self.evidence["source_policy"]["mapbox_candidate_geometry_persisted"])

    def test_ready_and_blocked_variants_are_explicit(self):
        for route_id in (
            "roaring-fork-one-way",
            "foothills-parkway-west-to-east",
            "foothills-parkway-east-to-west",
        ):
            self.assertEqual(self.by_id[route_id]["status"], "official_geometry_candidate")
            self.assertEqual(self.by_id[route_id]["blocking_issues"], [])
        for route_id in ("mountain-crossing-tn-to-nc", "mountain-crossing-nc-to-tn"):
            route = self.by_id[route_id]
            self.assertEqual(route["status"], "blocked_source_review")
            self.assertIn(
                "cherokee_extension_requires_separate_authoritative_public_road_source",
                route["blocking_issues"],
            )
            cherokee = next(item for item in route["landmarks"] if item["anchor_id"] == "cherokee")
            self.assertEqual(cherokee["status"], "outside_official_coverage")
            self.assertGreater(cherokee["lateral_distance_m"], 2_000)
        cades = self.by_id["little-river-cades-cove-loop"]
        self.assertEqual(cades["status"], "blocked_source_review")
        self.assertEqual(cades["blocking_issues"], ["nps_one_way_digitization_conflict"])
        self.assertEqual(len(cades["source_direction_conflict_geometry_ids"]), 5)

    def test_routes_have_no_unreviewed_seams_and_reference_only_snapshot_features(self):
        source_ids = {item["geometry_id"] for item in self.snapshot["features"]}
        for route in self.evidence["variants"]:
            self.assertLessEqual(route["maximum_join_gap_m"], ENDPOINT_JOIN_TOLERANCE_M)
            self.assertTrue(set(route["source_geometry_ids"]).issubset(source_ids))
            self.assertEqual(
                route["geometry_sha256"], canonical_sha256(route["geometry"])
            )
            progress = [item["route_progress_m"] for item in route["landmarks"]]
            self.assertEqual(progress, sorted(progress))

    def test_foothills_reverse_is_exact_where_source_has_no_one_way_conflict(self):
        forward = self.by_id["foothills-parkway-west-to-east"]
        reverse = self.by_id["foothills-parkway-east-to-west"]
        self.assertEqual(
            reverse["geometry"]["coordinates"],
            list(reversed(forward["geometry"]["coordinates"])),
        )
        expected_traversal = [
            {
                **item,
                "direction": "reverse" if item["direction"] == "forward" else "forward",
            }
            for item in reversed(forward["source_traversal"])
        ]
        self.assertEqual(reverse["source_traversal"], expected_traversal)

    def test_ready_and_mountain_routes_respect_source_one_way_direction(self):
        feature_by_id = {
            item["geometry_id"]: item for item in self.snapshot["features"]
        }
        for route_id in (
            "mountain-crossing-tn-to-nc",
            "mountain-crossing-nc-to-tn",
            "roaring-fork-one-way",
            "foothills-parkway-west-to-east",
            "foothills-parkway-east-to-west",
        ):
            for traversal in self.by_id[route_id]["source_traversal"]:
                one_way = feature_by_id[traversal["geometry_id"]]["one_way"]
                if one_way == "With Digitized":
                    self.assertEqual(traversal["direction"], "forward")
                elif one_way == "Against Digitized":
                    self.assertEqual(traversal["direction"], "reverse")
        self.assertNotEqual(
            self.by_id["mountain-crossing-tn-to-nc"]["geometry_sha256"],
            self.by_id["mountain-crossing-nc-to-tn"]["geometry_sha256"],
        )

    def test_cades_landmarks_are_cues_not_route_detours(self):
        cades = self.by_id["little-river-cades-cove-loop"]
        landmarks = {item["anchor_id"]: item for item in cades["landmarks"]}
        for anchor_id in ("john_oliver_place", "abrams_falls_trailhead", "cable_mill"):
            self.assertEqual(landmarks[anchor_id]["status"], "projected_landmark")
            self.assertGreater(landmarks[anchor_id]["lateral_distance_m"], 300)
        self.assertIn("Cades Cove Campground Entrance Road", cades["road_names"])
        self.assertIn("Cades Cove Loop Road", cades["road_names"])

    def test_route_spec_policy_or_snap_widening_is_rejected(self):
        changed = copy.deepcopy(self.route_spec)
        changed["provider_policy"]["output_persistence"] = "permanent"
        with self.assertRaisesRegex(OriginalRouteSourceError, "provider policy"):
            build_official_route_evidence(self.snapshot, changed)
        changed = copy.deepcopy(self.route_spec)
        changed["variants"][0]["max_control_snap_m"] = 900
        with self.assertRaisesRegex(OriginalRouteSourceError, "snap limit"):
            build_official_route_evidence(self.snapshot, changed)


class SmokiesOfficialRoutePrimitiveTests(unittest.TestCase):
    def test_append_geometry_measures_only_the_boundary(self):
        target = [[-83.0, 35.0], [-82.999, 35.0]]
        gap = _append_geometry(target, [[-82.999, 35.0], [-82.998, 35.0]])
        self.assertLess(gap, 0.02)
        self.assertEqual(len(target), 3)
        with self.assertRaisesRegex(OriginalRouteSourceError, "unreviewed"):
            _append_geometry(target, [[-82.9, 35.0], [-82.8, 35.0]])

    def test_one_way_graph_rejects_reverse_traversal(self):
        feature = {
            "geometry_id": "00000000-0000-0000-0000-000000000001",
            "one_way": "With Digitized",
            "geometry": {
                "type": "LineString",
                "coordinates": [[-83.0, 35.0], [-82.99, 35.0]],
            },
        }
        graph = RoadGraph([feature])
        forward = Projection(feature["geometry_id"], [-83.0, 35.0], 0.0, 0.0)
        reverse = Projection(
            feature["geometry_id"],
            [-82.99, 35.0],
            911.0,
            0.0,
        )
        graph.path_between(forward, reverse)
        with self.assertRaisesRegex(OriginalRouteSourceError, "No official road path"):
            graph.path_between(reverse, forward)

    def test_check_never_uses_the_network(self):
        with patch(
            "scripts.build_smokies_official_routes._request_json",
            side_effect=AssertionError("network must not be used"),
        ):
            result = check(
                Namespace(
                    snapshot=SNAPSHOT_PATH,
                    route_spec=ROUTE_SPEC_PATH,
                    evidence=EVIDENCE_PATH,
                )
            )
        self.assertEqual(result, 0)


if __name__ == "__main__":
    unittest.main()
