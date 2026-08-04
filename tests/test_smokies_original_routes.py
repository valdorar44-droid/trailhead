from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from scripts.build_smokies_original_routes import (
    EXPECTED_VARIANT_IDS,
    SmokiesRouteBuildError,
    build_candidate_artifact,
    compile_route_candidate,
    directions_request_evidence,
    fetch_directions,
    load_route_spec,
)


def _test_variant() -> dict:
    return {
        "id": "test-route",
        "chapter_id": "test_chapter",
        "variant_id": "test_variant",
        "sequence": 1,
        "title": "Test route",
        "direction": "one_way",
        "route_strategy": "directions",
        "reverse_pair_id": None,
        "expected_distance_m": {"minimum": 500.0, "maximum": 2_000.0},
        "max_control_snap_m": 100.0,
        "required_road_name_patterns": ["Test Road"],
        "anchors": [
            {"id": "start", "label": "Start", "coordinates": [-83.0, 35.0]},
            {"id": "finish", "label": "Finish", "coordinates": [-82.99, 35.0]},
        ],
    }


def _test_response(*, road_name: str = "Test Road") -> dict:
    return {
        "code": "Ok",
        "uuid": "mapbox-test-response",
        "routes": [
            {
                "distance": 910.85,
                "duration": 120.0,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [-83.0, 35.0],
                        [-82.995, 35.0],
                        [-82.99, 35.0],
                    ],
                },
                "waypoints": [
                    {"name": road_name, "location": [-83.0, 35.0]},
                    {"name": road_name, "location": [-82.99, 35.0]},
                ],
                "legs": [
                    {
                        "steps": [
                            {"name": road_name, "distance": 910.85},
                        ]
                    }
                ],
            }
        ],
    }


class SmokiesOriginalRouteSpecTests(unittest.TestCase):
    def test_spec_contains_exactly_the_approved_six_directions_routes(self):
        spec = load_route_spec()
        self.assertEqual(spec["expected_variant_count"], 6)
        self.assertEqual({variant["id"] for variant in spec["variants"]}, EXPECTED_VARIANT_IDS)
        self.assertEqual(
            {
                (variant["chapter_id"], variant["variant_id"])
                for variant in spec["variants"]
            },
            {
                ("mountain_crossing", "tn_to_nc"),
                ("mountain_crossing", "nc_to_tn"),
                ("little_river_cades_cove", "sugarlands_to_cades_cove_loop"),
                ("roaring_fork", "one_way"),
                ("foothills_parkway", "west_to_east"),
                ("foothills_parkway", "east_to_west"),
            },
        )
        self.assertTrue(all(variant["route_strategy"] == "directions" for variant in spec["variants"]))
        self.assertTrue(all(variant["direction"] == "one_way" for variant in spec["variants"]))
        self.assertEqual(spec["provider_policy"]["map_matching"], "authoritative_trace_only")

    def test_spec_rejects_a_non_consumer_route_direction(self):
        spec = json.loads(
            Path("originals/smokies/route_variants_v1.json").read_text(encoding="utf-8")
        )
        spec["variants"][0]["direction"] = "tennessee_to_north_carolina"
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "invalid-routes.json"
            path.write_text(json.dumps(spec), encoding="utf-8")
            with self.assertRaisesRegex(
                SmokiesRouteBuildError, "incompatible with OriginalRouteV1"
            ):
                load_route_spec(path)

    def test_reverse_pairs_reverse_every_anchor(self):
        spec = load_route_spec()
        by_id = {variant["id"]: variant for variant in spec["variants"]}
        for variant in spec["variants"]:
            pair_id = variant.get("reverse_pair_id")
            if not pair_id:
                continue
            self.assertEqual(
                [anchor["id"] for anchor in variant["anchors"]],
                list(reversed([anchor["id"] for anchor in by_id[pair_id]["anchors"]])),
            )

    def test_request_evidence_is_token_free_and_full_geometry(self):
        evidence = directions_request_evidence(_test_variant())
        encoded = json.dumps(evidence, sort_keys=True)
        self.assertNotIn("access_token", encoded)
        self.assertNotIn("MAPBOX_TOKEN", encoded)
        self.assertEqual(evidence["profile"], "mapbox/driving")
        self.assertEqual(evidence["parameters"]["overview"], "full")
        self.assertEqual(evidence["parameters"]["geometries"], "geojson")
        self.assertEqual(evidence["parameters"]["radiuses"], "100;100")


class SmokiesOriginalRouteCandidateTests(unittest.TestCase):
    def test_candidate_is_hash_bound_and_contains_no_credentials(self):
        variant = _test_variant()
        spec = {
            "schema_version": 1,
            "kind": "trailhead_original_route_spec",
            "product_id": "test_product",
            "provider_policy": {
                "authoring_engine": "mapbox_directions",
                "profile": "mapbox/driving",
                "map_matching": "authoritative_trace_only",
                "geometric_operations": [
                    "bounds",
                    "distance_cross_check",
                    "corridor_coverage",
                ],
                "output_persistence": "candidate_evidence_only",
            },
            "expected_variant_count": 1,
            "variants": [variant],
        }
        artifact = build_candidate_artifact(
            spec,
            {variant["id"]: _test_response()},
            generated_at="2026-08-04T12:00:00Z",
        )
        candidate = artifact["variants"][0]
        encoded = json.dumps(artifact, sort_keys=True)
        self.assertEqual(artifact["publication_status"], "candidate_only")
        self.assertTrue(artifact["provider"]["temporary_use_only"])
        self.assertRegex(artifact["spec_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(artifact["route_set_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(candidate["request_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(candidate["geometry_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(candidate["route"]["profile"], "driving")
        self.assertEqual(candidate["route"]["direction"], "one_way")
        self.assertNotIn("access_token", encoded)
        self.assertNotIn("MAPBOX_TOKEN", encoded)
        self.assertNotIn("pk.", encoded)
        self.assertNotIn("sk.", encoded)

    def test_candidate_rejects_missing_required_road(self):
        with self.assertRaisesRegex(
            SmokiesRouteBuildError, "did not traverse every required named road"
        ):
            compile_route_candidate(_test_variant(), _test_response(road_name="Other Road"))

    def test_candidate_rejects_a_distant_snap(self):
        response = _test_response()
        response["routes"][0]["waypoints"][0]["location"] = [-83.1, 35.0]
        with self.assertRaisesRegex(SmokiesRouteBuildError, "snapped too far"):
            compile_route_candidate(_test_variant(), response)

    def test_candidate_rejects_a_route_outside_reviewed_distance(self):
        response = _test_response()
        response["routes"][0]["distance"] = 3_000
        with self.assertRaisesRegex(SmokiesRouteBuildError, "outside its reviewed range"):
            compile_route_candidate(_test_variant(), response)

    def test_provider_http_error_does_not_leak_token(self):
        token = "pk." + "x" * 60
        body = io.BytesIO(b'{"message":"Not authorized"}')
        error = HTTPError(
            f"https://api.mapbox.com/test?access_token={token}",
            401,
            "Unauthorized",
            {},
            body,
        )
        with patch(
            "scripts.build_smokies_original_routes.urllib_request.urlopen",
            side_effect=error,
        ):
            with self.assertRaises(SmokiesRouteBuildError) as raised:
                fetch_directions(_test_variant(), token)
        self.assertNotIn(token, str(raised.exception))
        self.assertNotIn("access_token", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
