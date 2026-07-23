import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from dashboard import server
from ingestors.conditions import WFIGS_LEGACY_MAP_MAX_FEATURES, WFIGS_MAP_MAX_FEATURES


class FirePerimetersApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)

    def test_legacy_get_preserves_original_800_feature_contract(self):
        response_payload = {"type": "FeatureCollection", "features": [], "metadata": {}}
        fetch = AsyncMock(return_value=response_payload)
        with patch.object(server, "get_wfigs_fire_perimeters", new=fetch):
            response = self.client.get("/api/conditions/fire-perimeters")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), response_payload)
        fetch.assert_awaited_once_with(
            bounds=None,
            map_safe=True,
            max_features=WFIGS_LEGACY_MAP_MAX_FEATURES,
        )

    def test_post_uses_json_body_and_accepts_antimeridian_viewport(self):
        response_payload = {"type": "FeatureCollection", "features": [], "metadata": {}}
        fetch = AsyncMock(return_value=response_payload)
        with patch.object(server, "get_wfigs_fire_perimeters", new=fetch):
            response = self.client.post(
                "/api/conditions/fire-perimeters/query",
                json={"n": 10, "s": 0, "e": -170, "w": 170},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), response_payload)
        fetch.assert_awaited_once_with(
            bounds=(10.0, 0.0, -170.0, 170.0),
            map_safe=True,
            max_features=WFIGS_MAP_MAX_FEATURES,
        )

    def test_legacy_get_viewport_keeps_antimeridian_compatibility(self):
        response_payload = {"type": "FeatureCollection", "features": [], "metadata": {}}
        fetch = AsyncMock(return_value=response_payload)
        with patch.object(server, "get_wfigs_fire_perimeters", new=fetch):
            response = self.client.get(
                "/api/conditions/fire-perimeters",
                params={"n": 10, "s": 0, "e": -170, "w": 170},
            )
        self.assertEqual(response.status_code, 200)
        fetch.assert_awaited_once_with(
            bounds=(10.0, 0.0, -170.0, 170.0),
            map_safe=True,
            max_features=WFIGS_MAP_MAX_FEATURES,
        )

    def test_post_rejects_zero_area_or_incomplete_viewports(self):
        fetch = AsyncMock(return_value={"type": "FeatureCollection", "features": []})
        with patch.object(server, "get_wfigs_fire_perimeters", new=fetch):
            equal_longitude = self.client.post(
                "/api/conditions/fire-perimeters/query",
                json={"n": 10, "s": 0, "e": 20, "w": 20},
            )
            inverted_latitude = self.client.post(
                "/api/conditions/fire-perimeters/query",
                json={"n": 0, "s": 10, "e": 20, "w": 10},
            )
            incomplete = self.client.post(
                "/api/conditions/fire-perimeters/query",
                json={"n": 10, "s": 0, "e": 20},
            )
        self.assertEqual(equal_longitude.status_code, 422)
        self.assertEqual(inverted_latitude.status_code, 422)
        self.assertEqual(incomplete.status_code, 422)
        fetch.assert_not_awaited()

    def test_provider_failure_is_not_reported_as_no_active_fires(self):
        fetch = AsyncMock(return_value=None)
        with patch.object(server, "get_wfigs_fire_perimeters", new=fetch):
            post_response = self.client.post(
                "/api/conditions/fire-perimeters/query",
                json={"n": 39, "s": 38, "e": -108, "w": -110},
            )
            get_response = self.client.get("/api/conditions/fire-perimeters")
        self.assertEqual(post_response.status_code, 503)
        self.assertEqual(get_response.status_code, 503)
        self.assertIn("temporarily unavailable", post_response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
