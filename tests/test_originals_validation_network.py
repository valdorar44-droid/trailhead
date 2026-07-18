import json
import subprocess
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

from db import originals_validation as validation


def _encode_polyline6(points):
    output = []
    previous_latitude = 0
    previous_longitude = 0
    for point in points:
        latitude = round(float(point["lat"]) * 1_000_000)
        longitude = round(float(point["lon"]) * 1_000_000)
        for delta in (latitude - previous_latitude, longitude - previous_longitude):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                output.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            output.append(chr(value + 63))
        previous_latitude = latitude
        previous_longitude = longitude
    return "".join(output)


class _JsonResponse:
    def __init__(self, value):
        self._payload = json.dumps(value, separators=(",", ":")).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, maximum):
        return self._payload[:maximum]


class _ValhallaFixture:
    def __init__(self, coordinates):
        self.coordinates = coordinates
        self.trace_payloads = []
        self.locate_payloads = []
        self.matched_lat_offset = 0.0
        self.length_multiplier = 1.0
        self.omit_access_restriction = False
        self.restricted_access = False
        self.restriction_applies_to_car = True
        self.turn_restricted = False
        self.drop_last_matched_point = False
        self.insert_intermediate_edge = False
        self.locate_edge_ids = {}

    def _global_index(self, lon):
        return min(
            range(len(self.coordinates)),
            key=lambda index: abs(self.coordinates[index][0] - float(lon)),
        )

    def __call__(self, request, timeout):
        del timeout
        if request.full_url.endswith("/status"):
            return _JsonResponse({"version": "3.6.3", "tileset_last_modified": 1_782_000_000})
        payload = json.loads(request.data)
        if request.full_url.endswith("/trace_attributes"):
            self.trace_payloads.append(payload)
            shape = payload["shape"]
            path_shape = list(shape)
            authored_path_indexes = list(range(len(shape)))
            if self.insert_intermediate_edge and len(shape) >= 2:
                midpoint = {
                    "lat": (shape[0]["lat"] + shape[1]["lat"]) / 2.0,
                    "lon": (shape[0]["lon"] + shape[1]["lon"]) / 2.0,
                }
                path_shape = [shape[0], midpoint, *shape[1:]]
                authored_path_indexes = [0, *range(2, len(path_shape))]
            edges = []
            for path_index, (start, end) in enumerate(zip(path_shape, path_shape[1:])):
                global_index = self._global_index(start["lon"])
                edge_id = (
                    f"edge-{global_index}-intermediate-{path_index}"
                    if self.insert_intermediate_edge and path_index < 2
                    else f"edge-{global_index}"
                )
                distance_m = validation._route_haversine_m(
                    [start["lon"], start["lat"]],
                    [end["lon"], end["lat"]],
                )
                edges.append({
                    "id": edge_id,
                    "length": distance_m / 1000.0 * self.length_multiplier,
                    "begin_shape_index": path_index,
                    "end_shape_index": path_index + 1,
                    "surface": "paved_smooth",
                    "unpaved": False,
                    "use": "road",
                    "traversability": "both",
                    "travel_mode": "drive",
                    "vehicle_type": "car",
                })
                self.locate_edge_ids[
                    (
                        round((float(start["lat"]) + float(end["lat"])) / 2.0, 6),
                        round((float(start["lon"]) + float(end["lon"])) / 2.0, 6),
                    )
                ] = edge_id
            matched = [{
                "lat": point["lat"] + self.matched_lat_offset,
                "lon": point["lon"],
                "edge_index": min(path_index, len(edges) - 1),
                "begin_route_discontinuity": False,
                "end_route_discontinuity": False,
            } for point, path_index in zip(shape, authored_path_indexes)]
            if self.drop_last_matched_point:
                matched = matched[:-1]
            response = {
                "units": "kilometers",
                "osm_changeset": 123456,
                "edges": edges,
                "shape": _encode_polyline6(path_shape),
            }
            # This mirrors Valhalla's production contract: walk_or_snap can
            # return edges and shape, but point-for-point matched evidence is
            # produced by map_snap.
            if payload.get("shape_match") == "map_snap":
                response["matched_points"] = matched
            return _JsonResponse(response)
        if request.full_url.endswith("/locate"):
            self.locate_payloads.append(payload)
            results = []
            for point in payload["locations"]:
                point_key = (float(point["lat"]), float(point["lon"]))
                nearest_key = min(
                    self.locate_edge_ids,
                    key=lambda key: abs(key[0] - point_key[0]) + abs(key[1] - point_key[1]),
                )
                edge_id = self.locate_edge_ids[nearest_key]
                if abs(nearest_key[0] - point_key[0]) + abs(nearest_key[1] - point_key[1]) > 0.000002:
                    raise AssertionError(f"No fixture edge for locate point: {point}")
                edge = {
                    "access": {"car": True},
                    "classification": {"surface": "paved_smooth", "use": "road"},
                    "unreachable": False,
                    "start_restriction": {"car": self.turn_restricted},
                    "end_restriction": {"car": self.turn_restricted},
                    "part_of_complex_restriction": self.turn_restricted,
                    "destination_only": False,
                    "not_thru": False,
                }
                if not self.omit_access_restriction:
                    edge["access_restriction"] = self.restricted_access
                results.append({
                    "edges": [{
                        "edge_id": {"value": edge_id},
                        "edge": edge,
                        "distance": 0.0,
                        "access_restrictions": (
                            [{
                                "type": (
                                    "private" if self.restriction_applies_to_car else "max_height"
                                ),
                                "car": self.restriction_applies_to_car,
                            }]
                            if self.restricted_access else []
                        ),
                    }],
                })
            return _JsonResponse(results)
        raise AssertionError(f"Unexpected Valhalla URL: {request.full_url}")


def _manifest(coordinates):
    return {
        "route": {"geometry": {"type": "LineString", "coordinates": coordinates}},
        "access": {"surface": "paved"},
        "review": {},
        "stops": [{
            "citations": [{
                "title": "Official road access guidance",
                "url": "https://www.nps.gov/example/road-conditions.htm",
                "publisher": "National Park Service",
                "reviewed_at": datetime.now(timezone.utc).date().isoformat(),
                "role": "operational",
                "authority": "official",
                "scope": ["route", "access", "surface", "closures"],
            }],
        }],
    }


class OriginalRouteNetworkValidationTests(unittest.TestCase):
    def setUp(self):
        self.coordinates = [[-109.55 + index * 0.00005, 38.57] for index in range(120)]
        self.manifest = _manifest(self.coordinates)
        self.valhalla = _ValhallaFixture(self.coordinates)

    def test_headless_validator_budget_covers_a_realistic_whole_route(self):
        manifest = {
            "pack_id": "original_long_route",
            "version": 1,
            "manifest_id": "original_long_route:1",
            "route": {
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [-109.6 + index * 0.00001, 38.5]
                        for index in range(2_112)
                    ],
                },
            },
        }
        with patch.object(
            validation.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired("validator", 1),
        ) as runner:
            with self.assertRaisesRegex(
                validation.OriginalValidationRunnerError,
                "could not complete",
            ):
                validation.run_originals_validation_cli(
                    manifest,
                    required_scenario_ids=(),
                    expected_engine_version="original-trigger-v2",
                )
        self.assertGreaterEqual(
            runner.call_args.kwargs["timeout"],
            180,
            "whole-route validation needs headroom beyond the observed Moab runtime",
        )

    def test_polyline6_decoder_round_trips_and_rejects_malformed_input(self):
        points = [
            {"lat": 38.573336, "lon": -109.549741},
            {"lat": 38.573363, "lon": -109.549768},
            {"lat": 38.574428, "lon": -109.550772},
        ]
        decoded = validation._decode_valhalla_polyline6(_encode_polyline6(points))
        self.assertEqual(
            decoded,
            [[point["lon"], point["lat"]] for point in points],
        )
        for malformed in ("", "_", "\x7f?"):
            with self.subTest(malformed=repr(malformed)):
                with self.assertRaises(validation.OriginalValidationRunnerError):
                    validation._decode_valhalla_polyline6(malformed)

    def test_validates_every_authored_point_in_overlapping_chunks_and_captures_versions(self):
        with patch.object(validation.urllib_request, "urlopen", side_effect=self.valhalla):
            result = validation.validate_original_route_network(
                self.manifest,
                valhalla_url="https://valhalla.test",
            )
        self.assertEqual(result["provider_version"], "3.6.3")
        self.assertEqual(result["graph_version"], "1782000000")
        self.assertEqual(result["authored_point_count"], len(self.coordinates))
        self.assertEqual(result["chunk_count"], 3)
        self.assertEqual(len(self.valhalla.trace_payloads), 3)
        self.assertEqual(
            self.valhalla.trace_payloads[0]["shape"][-2:],
            self.valhalla.trace_payloads[1]["shape"][:2],
        )
        self.assertIn("edge.travel_mode", self.valhalla.trace_payloads[0]["filters"]["attributes"])
        self.assertIn("edge.surface", self.valhalla.trace_payloads[0]["filters"]["attributes"])
        self.assertIn("edge.begin_shape_index", self.valhalla.trace_payloads[0]["filters"]["attributes"])
        self.assertLess(result["unique_edge_count"], result["edge_count"])
        self.assertEqual(result["access_evidence_edge_count"], result["unique_edge_count"])
        self.assertGreater(result["access_evidence_edge_count"], 0)
        self.assertFalse(result["provider_seasonal_field_available"])
        self.assertEqual(result["seasonal_access_evidence"], "official_operational_sources")
        self.assertIsNone(result["override"])

    def test_uses_map_snap_and_requires_one_matched_point_per_authored_coordinate(self):
        with patch.object(validation.urllib_request, "urlopen", side_effect=self.valhalla):
            result = validation.validate_original_route_network(
                self.manifest,
                valhalla_url="https://valhalla.test",
            )

        self.assertTrue(self.valhalla.trace_payloads)
        self.assertTrue(all(
            payload["shape_match"] == "map_snap"
            for payload in self.valhalla.trace_payloads
        ))
        self.assertTrue(all(
            payload["trace_options"]["interpolation_distance"] == 0
            for payload in self.valhalla.trace_payloads
        ))
        requested_point_count = sum(
            len(payload["shape"])
            for payload in self.valhalla.trace_payloads
        )
        self.assertEqual(result["matched_point_count"], requested_point_count)

        incomplete = _ValhallaFixture(self.coordinates)
        incomplete.drop_last_matched_point = True
        with patch.object(validation.urllib_request, "urlopen", side_effect=incomplete):
            with self.assertRaisesRegex(
                validation.OriginalValidationRunnerError,
                "one matched point per authored point",
            ):
                validation.validate_original_route_network(
                    self.manifest,
                    valhalla_url="https://valhalla.test",
                )

    def test_locates_intermediate_path_edges_without_authored_point_matches(self):
        route = self.coordinates[:3]
        manifest = _manifest(route)
        provider = _ValhallaFixture(route)
        provider.insert_intermediate_edge = True
        with patch.object(validation.urllib_request, "urlopen", side_effect=provider):
            result = validation.validate_original_route_network(
                manifest,
                valhalla_url="https://valhalla.test",
            )
        self.assertEqual(result["unique_edge_count"], 3)
        self.assertEqual(result["access_evidence_edge_count"], 3)
        self.assertEqual(len(provider.locate_payloads), 1)
        self.assertEqual(len(provider.locate_payloads[0]["locations"]), 3)

    def test_fails_closed_on_sparse_geometry_missing_access_or_matched_deviation(self):
        sparse = _manifest([[-109.55, 38.57], [-109.52, 38.57]])
        with self.assertRaisesRegex(validation.OriginalValidationRunnerError, "too sparse"):
            validation.validate_original_route_network(sparse, valhalla_url="https://valhalla.test")

        self.valhalla.omit_access_restriction = True
        with patch.object(validation.urllib_request, "urlopen", side_effect=self.valhalla):
            with self.assertRaisesRegex(validation.OriginalValidationRunnerError, "lacks nearby car access"):
                validation.validate_original_route_network(
                    self.manifest,
                    valhalla_url="https://valhalla.test",
                )

        shifted = _ValhallaFixture(self.coordinates)
        shifted.matched_lat_offset = 0.001
        with patch.object(validation.urllib_request, "urlopen", side_effect=shifted):
            with self.assertRaisesRegex(validation.OriginalValidationRunnerError, "deviates"):
                validation.validate_original_route_network(
                    self.manifest,
                    valhalla_url="https://valhalla.test",
                )

        detour = _ValhallaFixture(self.coordinates)
        detour.length_multiplier = 4.0
        with patch.object(validation.urllib_request, "urlopen", side_effect=detour):
            with self.assertRaisesRegex(validation.OriginalValidationRunnerError, "matched distance"):
                validation.validate_original_route_network(
                    self.manifest,
                    valhalla_url="https://valhalla.test",
                )

    def test_accepts_real_draft_scale_segment_below_two_kilometer_guard(self):
        route = [[-109.55, 38.57], [-109.5332, 38.57]]
        self.assertGreater(validation._route_haversine_m(*route), 1_450)
        self.assertLess(validation._route_haversine_m(*route), 1_500)
        manifest = _manifest(route)
        provider = _ValhallaFixture(route)
        with patch.object(validation.urllib_request, "urlopen", side_effect=provider):
            result = validation.validate_original_route_network(
                manifest,
                valhalla_url="https://valhalla.test",
            )
        self.assertEqual(result["authored_point_count"], 2)
        self.assertLess(result["maximum_authored_segment_m"], 2_000)

    def test_restricted_access_requires_exact_fresh_official_override(self):
        self.valhalla.restricted_access = True
        with patch.object(validation.urllib_request, "urlopen", side_effect=self.valhalla):
            with self.assertRaisesRegex(validation.OriginalValidationRunnerError, "official-source-backed override"):
                validation.validate_original_route_network(
                    self.manifest,
                    valhalla_url="https://valhalla.test",
                )

        approved = _manifest(self.coordinates)
        approved["review"]["route_network_override"] = {
            "schema_version": 1,
            "status": "approved",
            "finding_codes": ["private_or_restricted_access"],
            "reason": "Official park guidance confirms public visitor vehicle access on this segment.",
            "official_source_url": "https://www.nps.gov/example/road-conditions.htm",
            "approved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "approved_by_admin_user_id": 1,
        }
        permitted = _ValhallaFixture(self.coordinates)
        permitted.restricted_access = True
        with patch.object(validation.urllib_request, "urlopen", side_effect=permitted):
            result = validation.validate_original_route_network(
                approved,
                valhalla_url="https://valhalla.test",
            )
        self.assertEqual(
            result["override"]["finding_codes"],
            ["private_or_restricted_access"],
        )

    def test_truck_only_and_complex_turn_restrictions_are_not_private_car_findings(self):
        provider = _ValhallaFixture(self.coordinates)
        provider.restricted_access = True
        provider.restriction_applies_to_car = False
        provider.turn_restricted = True
        with patch.object(validation.urllib_request, "urlopen", side_effect=provider):
            result = validation.validate_original_route_network(
                self.manifest,
                valhalla_url="https://valhalla.test",
            )
        self.assertIsNone(result["override"])


if __name__ == "__main__":
    unittest.main()
