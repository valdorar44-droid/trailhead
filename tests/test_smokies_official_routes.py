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
    EXPECTED_CADES_DIRECTION_OVERRIDES,
    EXPECTED_CADES_DIRECTION_CONFLICT_GEOMETRY_IDS,
    EXPECTED_FACILITY_COUNTS,
    EXPECTED_ROAD_COUNTS,
    GRSM_MAP_PDF_SHA256,
    NC_ONEMAP_CONNECTOR_NGUIDS,
    NC_ONEMAP_CROSS_SOURCE_HANDOFF_MAX_M,
    NC_ONEMAP_NORMALIZED_CONNECTOR_SHA256,
    NC_ONEMAP_TERMS_SNAPSHOT_SHA256,
    OFFICIAL_ROUTE_ALGORITHM_CONTRACT,
    OFFICIAL_ROUTE_GENERATOR_VERSION,
    SELECTED_FEATURE_COUNT,
    OriginalRouteSourceError,
    Projection,
    RoadGraph,
    _append_geometry,
    _append_reviewed_cross_source_geometry,
    _normalize_route_spec_for_evidence,
    build_official_route_evidence,
    canonical_sha256,
    normalize_official_route_source_supplement,
    normalize_nps_road_snapshot,
    official_route_generator_source_sha256,
)
from scripts.build_smokies_official_routes import check
from scripts.build_smokies_original_routes import load_route_spec


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "originals" / "smokies" / "nps_public_roads_snapshot_v1.json"
SOURCE_SUPPLEMENT_PATH = (
    ROOT / "originals" / "smokies" / "official_route_source_supplement_v1.json"
)
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


class SmokiesOfficialRouteSourceSupplementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = json.loads(SOURCE_SUPPLEMENT_PATH.read_text(encoding="utf-8"))
        cls.supplement = normalize_official_route_source_supplement(cls.raw)

    def test_checked_supplement_is_canonical_and_hash_bound(self):
        self.assertEqual(self.supplement, self.raw)
        connector = self.supplement["nc_onemap_ebci_connector"]
        self.assertEqual(len(connector["features"]), 23)
        self.assertEqual(connector["ordered_nguids"], list(NC_ONEMAP_CONNECTOR_NGUIDS))
        self.assertEqual(
            connector["source"]["normalized_features_sha256"],
            NC_ONEMAP_NORMALIZED_CONNECTOR_SHA256,
        )
        self.assertEqual(
            connector["source"]["terms_snapshot_sha256"],
            NC_ONEMAP_TERMS_SNAPSHOT_SHA256,
        )
        direction = self.supplement["cades_direction_override"]
        self.assertEqual(direction["source"]["official_map_pdf_sha256"], GRSM_MAP_PDF_SHA256)
        self.assertEqual(len(direction["overrides"]), 5)

    def test_connector_retains_exact_ebci_lineage_and_two_way_traits(self):
        connector = self.supplement["nc_onemap_ebci_connector"]
        for feature in connector["features"]:
            self.assertEqual(feature["discrepancy_agency_id"], "ebcinctb1.swain.nc.us")
            self.assertEqual(feature["municipality_left"], "Eastern Band of Cherokee Indians")
            self.assertEqual(feature["municipality_right"], "Eastern Band of Cherokee Indians")
            self.assertIsNone(feature["one_way"])
        self.assertIn("free and unrestricted use policy", json.dumps(connector["terms_snapshot"]))

    def test_connector_identity_terms_and_geometry_drift_fail_closed(self):
        changed = copy.deepcopy(self.raw)
        changed["nc_onemap_ebci_connector"]["features"][0]["nguid"] = (
            "RCL_unreviewed@ebcinctb1.swain.nc.us"
        )
        with self.assertRaisesRegex(OriginalRouteSourceError, "unreviewed NGUID"):
            normalize_official_route_source_supplement(changed)

        changed = copy.deepcopy(self.raw)
        changed["nc_onemap_ebci_connector"]["features"][0]["municipality_left"] = "Cherokee"
        with self.assertRaisesRegex(OriginalRouteSourceError, "municipality"):
            normalize_official_route_source_supplement(changed)

        changed = copy.deepcopy(self.raw)
        changed["nc_onemap_ebci_connector"]["features"][0]["geometry"]["coordinates"][0][0] += 0.00001
        with self.assertRaisesRegex(OriginalRouteSourceError, "feature hash"):
            normalize_official_route_source_supplement(changed)

        changed = copy.deepcopy(self.raw)
        changed["nc_onemap_ebci_connector"]["terms_snapshot"]["source"] = "changed"
        with self.assertRaisesRegex(OriginalRouteSourceError, "terms snapshot hash"):
            normalize_official_route_source_supplement(changed)

    def test_cades_crosswalk_and_map_evidence_drift_fail_closed(self):
        direction = self.supplement["cades_direction_override"]
        expected = {
            (
                item.national_geometry_id,
                item.grsm_global_id,
                item.grsm_object_id,
            )
            for item in EXPECTED_CADES_DIRECTION_OVERRIDES
        }
        observed = {
            (
                item["national_geometry_id"],
                item["grsm_global_id"],
                item["grsm_object_id"],
            )
            for item in direction["overrides"]
        }
        self.assertEqual(observed, expected)

        changed = copy.deepcopy(self.raw)
        changed["cades_direction_override"]["overrides"][0]["grsm_global_id"] = (
            "00000000-0000-0000-0000-000000000001"
        )
        with self.assertRaisesRegex(OriginalRouteSourceError, "crosswalk"):
            normalize_official_route_source_supplement(changed)

        changed = copy.deepcopy(self.raw)
        changed["cades_direction_override"]["source"]["official_map_pdf_sha256"] = "0" * 64
        with self.assertRaisesRegex(OriginalRouteSourceError, "official_map_pdf_sha256"):
            normalize_official_route_source_supplement(changed)


class SmokiesOfficialRouteEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        cls.source_supplement = json.loads(
            SOURCE_SUPPLEMENT_PATH.read_text(encoding="utf-8")
        )
        cls.route_spec = load_route_spec(ROUTE_SPEC_PATH)
        cls.evidence = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))
        cls.rebuilt = build_official_route_evidence(
            cls.snapshot, cls.route_spec, cls.source_supplement
        )
        cls.by_id = {item["id"]: item for item in cls.evidence["variants"]}

    def test_checked_route_evidence_is_deterministic(self):
        self.assertEqual(self.evidence, self.rebuilt)
        self.assertEqual(canonical_sha256(self.evidence), canonical_sha256(self.rebuilt))
        self.assertEqual(
            self.evidence["route_spec_sha256"],
            canonical_sha256(_normalize_route_spec_for_evidence(self.route_spec)),
        )
        self.assertEqual(
            self.evidence["generator"],
            {
                "name": "smokies_official_route_compiler",
                "version": OFFICIAL_ROUTE_GENERATOR_VERSION,
                "source_sha256": official_route_generator_source_sha256(),
                "algorithm_contract_sha256": canonical_sha256(
                    OFFICIAL_ROUTE_ALGORITHM_CONTRACT
                ),
            },
        )
        self.assertTrue(self.evidence["source_policy"]["operational_readiness_separate"])
        self.assertFalse(self.evidence["source_policy"]["mapbox_candidate_geometry_persisted"])
        self.assertEqual(
            self.evidence["source_policy"]["geometry_authority"],
            "nps_public_roads",
        )
        self.assertEqual(self.evidence["source_policy"]["license"], "us-pd")
        self.assertEqual(
            [item["id"] for item in self.evidence["source_policy"]["geometry_authorities"]],
            ["nps_public_roads", "nc_onemap_ng911"],
        )

    def test_all_static_official_route_variants_are_candidates(self):
        for route_id in (
            "mountain-crossing-tn-to-nc",
            "mountain-crossing-nc-to-tn",
            "little-river-cades-cove-loop",
            "roaring-fork-one-way",
            "foothills-parkway-west-to-east",
            "foothills-parkway-east-to-west",
        ):
            self.assertEqual(self.by_id[route_id]["status"], "official_geometry_candidate")
            self.assertEqual(self.by_id[route_id]["blocking_issues"], [])
        for route_id in ("mountain-crossing-tn-to-nc", "mountain-crossing-nc-to-tn"):
            route = self.by_id[route_id]
            cherokee = next(item for item in route["landmarks"] if item["anchor_id"] == "cherokee")
            self.assertEqual(cherokee["status"], "on_route")
            self.assertLess(cherokee["lateral_distance_m"], 75)
            self.assertLessEqual(
                route["cross_source_handoff_gap_m"],
                NC_ONEMAP_CROSS_SOURCE_HANDOFF_MAX_M,
            )
            self.assertTrue(set(NC_ONEMAP_CONNECTOR_NGUIDS).issubset(route["source_geometry_ids"]))
        cades = self.by_id["little-river-cades-cove-loop"]
        self.assertEqual(
            set(cades["source_direction_conflict_geometry_ids"]),
            EXPECTED_CADES_DIRECTION_CONFLICT_GEOMETRY_IDS,
        )
        self.assertEqual(cades["source_direction_override"]["kind"], "CadesDirectionOverrideV1")
        self.assertEqual(
            cades["source_direction_override"]["reviewed_traversal_direction"],
            "reverse",
        )

    def test_cades_direction_conflict_set_cannot_silently_change(self):
        changed = copy.deepcopy(self.snapshot)
        target = next(
            item
            for item in changed["features"]
            if item["geometry_id"]
            in EXPECTED_CADES_DIRECTION_CONFLICT_GEOMETRY_IDS
        )
        target["one_way"] = None
        with self.assertRaisesRegex(
            OriginalRouteSourceError,
            "Cades Cove reviewed direction conflict set changed",
        ):
            build_official_route_evidence(
                changed, self.route_spec, self.source_supplement
            )

    def test_routes_have_no_unreviewed_seams_and_reference_only_snapshot_features(self):
        source_ids = {
            item["geometry_id"] for item in self.snapshot["features"]
        } | set(NC_ONEMAP_CONNECTOR_NGUIDS)
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
        feature_by_id.update(
            {
                item["nguid"]: {"one_way": None}
                for item in self.source_supplement["nc_onemap_ebci_connector"][
                    "features"
                ]
            }
        )
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
            build_official_route_evidence(
                self.snapshot, changed, self.source_supplement
            )
        changed = copy.deepcopy(self.route_spec)
        changed["variants"][0]["max_control_snap_m"] = 900
        with self.assertRaisesRegex(OriginalRouteSourceError, "snap limit"):
            build_official_route_evidence(
                self.snapshot, changed, self.source_supplement
            )


class SmokiesOfficialRoutePrimitiveTests(unittest.TestCase):
    def test_append_geometry_measures_only_the_boundary(self):
        target = [[-83.0, 35.0], [-82.999, 35.0]]
        gap = _append_geometry(target, [[-82.999, 35.0], [-82.998, 35.0]])
        self.assertLess(gap, 0.02)
        self.assertEqual(len(target), 3)
        with self.assertRaisesRegex(OriginalRouteSourceError, "unreviewed"):
            _append_geometry(target, [[-82.9, 35.0], [-82.8, 35.0]])

    def test_cross_source_handoff_is_narrowly_bounded(self):
        target = [[-83.0, 35.0], [-82.999, 35.0]]
        nearby = [[-82.99905, 35.00001], [-82.998, 35.0]]
        gap = _append_reviewed_cross_source_geometry(target, nearby)
        self.assertLess(gap, NC_ONEMAP_CROSS_SOURCE_HANDOFF_MAX_M)
        with self.assertRaisesRegex(OriginalRouteSourceError, "handoff changed"):
            _append_reviewed_cross_source_geometry(
                [[-83.0, 35.0]], [[-82.999, 35.0], [-82.998, 35.0]]
            )

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
                    source_supplement=SOURCE_SUPPLEMENT_PATH,
                    route_spec=ROUTE_SPEC_PATH,
                    evidence=EVIDENCE_PATH,
                )
            )
        self.assertEqual(result, 0)


if __name__ == "__main__":
    unittest.main()
