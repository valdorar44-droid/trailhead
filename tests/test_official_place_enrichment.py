import unittest
from unittest.mock import AsyncMock, patch

import dashboard.server as server


class OfficialPlaceEnrichmentTests(unittest.TestCase):
    def test_official_explore_categories_are_available_as_free_enrichment(self):
        requested = {"attraction", "historic", "park", "food"}

        official = server._official_free_categories_for_request(requested)
        allowed, locked, meta = server._authorize_place_categories(requested, None)

        self.assertIn("attraction", official)
        self.assertIn("historic", official)
        self.assertIn("park", official)
        self.assertNotIn("food", official)
        self.assertNotIn("attraction", allowed)
        self.assertIn("food", locked)
        self.assertFalse(meta["explore_unlocked"])

    def test_official_source_detection_marks_public_agency_records(self):
        self.assertTrue(server._is_official_free_place({"source": "nps", "source_label": "National Park Service"}))
        self.assertTrue(server._is_official_free_place({"source": "usfs", "source_label": "US Forest Service"}))
        self.assertTrue(server._is_official_free_place({"source": "blm", "source_label": "BLM Recreation"}))
        self.assertTrue(server._is_official_free_place({"source": "wikipedia", "source_label": "Wikipedia"}))
        self.assertFalse(server._is_official_free_place({"source": "google", "source_label": "Google Places"}))


class OfficialPlaceEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_nearby_places_returns_official_explore_category_without_unlock(self):
        nps_place = {
            "id": "nps_thing_1",
            "name": "Official View",
            "lat": 38.0,
            "lng": -109.0,
            "type": "attraction",
            "source": "nps",
            "source_label": "National Park Service",
        }
        with (
            patch.object(server, "nps_enabled", return_value=True),
            patch.object(server, "get_nps_places", new=AsyncMock(return_value=[nps_place])),
            patch.object(server, "get_blm_recreation_sites", new=AsyncMock(return_value=[])),
            patch.object(server, "get_usfs_recreation_sites", new=AsyncMock(return_value=[])),
            patch.object(server, "get_service_places", new=AsyncMock(side_effect=AssertionError("OSM should stay locked for explore-only request"))),
        ):
            places = await server.nearby_places(
                38.0,
                -109.0,
                radius=10,
                categories="attraction",
                provider="auto",
                user=None,
            )

        self.assertEqual(len(places), 1)
        self.assertEqual(places[0]["name"], "Official View")
        self.assertTrue(places[0]["official_free"])
        self.assertEqual(places[0]["category_access"]["official_free_categories"], ["attraction"])


if __name__ == "__main__":
    unittest.main()
