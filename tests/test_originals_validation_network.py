import json
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

from db import originals_validation as validation


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
            global_indexes = [self._global_index(point["lon"]) for point in shape]
            edges = []
            for start, end, global_index in zip(shape, shape[1:], global_indexes):
                distance_m = validation._route_haversine_m(
                    [start["lon"], start["lat"]],
                    [end["lon"], end["lat"]],
                )
                edges.append({
                    "id": f"edge-{global_index}",
                    "length": distance_m / 1000.0 * self.length_multiplier,
                    "surface": "paved_smooth",
                    "unpaved": False,
                    "use": "road",
                    "traversability": "both",
                    "travel_mode": "drive",
                    "vehicle_type": "car",
                })
            matched = [{
                "lat": point["lat"] + self.matched_lat_offset,
                "lon": point["lon"],
                "edge_index": min(index, len(edges) - 1),
                "begin_route_discontinuity": False,
                "end_route_discontinuity": False,
            } for index, point in enumerate(shape)]
            return _JsonResponse({
                "units": "kilometers",
                "osm_changeset": 123456,
                "edges": edges,
                "matched_points": matched,
            })
        if request.full_url.endswith("/locate"):
            self.locate_payloads.append(payload)
            results = []
            for point in payload["locations"]:
                global_index = min(self._global_index(point["lon"]), len(self.coordinates) - 2)
                edge = {
                    "access": {"car": True},
                    "classification": {"surface": "paved_smooth"},
                    "unreachable": False,
                    "destination_only": False,
                    "not_thru": False,
                    "seasonal": False,
                }
                if not self.omit_access_restriction:
                    edge["access_restriction"] = self.restricted_access
                results.append({
                    "edges": [{
                        "edge_id": {"value": f"edge-{global_index}"},
                        "edge": edge,
                        "access_restrictions": ([{"type": "private"}] if self.restricted_access else []),
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
        self.assertGreater(result["access_evidence_edge_count"], 0)
        self.assertIsNone(result["override"])

    def test_fails_closed_on_sparse_geometry_missing_access_or_matched_deviation(self):
        sparse = _manifest([[-109.55, 38.57], [-109.52, 38.57]])
        with self.assertRaisesRegex(validation.OriginalValidationRunnerError, "too sparse"):
            validation.validate_original_route_network(sparse, valhalla_url="https://valhalla.test")

        self.valhalla.omit_access_restriction = True
        with patch.object(validation.urllib_request, "urlopen", side_effect=self.valhalla):
            with self.assertRaisesRegex(validation.OriginalValidationRunnerError, "lacks car access"):
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


if __name__ == "__main__":
    unittest.main()
