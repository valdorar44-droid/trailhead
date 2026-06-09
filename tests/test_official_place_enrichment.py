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

    async def test_nearby_places_does_not_return_google_or_foursquare_providers(self):
        osm_place = {
            "id": "osm_food_1",
            "name": "Open Cafe",
            "lat": 48.858,
            "lng": 2.294,
            "type": "food",
            "source": "osm",
            "source_label": "OpenStreetMap",
        }
        with (
            patch.object(server, "get_service_places", new=AsyncMock(return_value=[osm_place])),
            patch.object(server, "get_fuel_stations", new=AsyncMock(return_value=[])),
        ):
            places = await server.nearby_places(
                48.858,
                2.294,
                radius=2,
                categories="food",
                provider="auto",
                user={"id": 1, "credits": 0, "is_admin": True},
            )

        self.assertEqual([p["source"] for p in places], ["osm"])
        self.assertFalse(any(str(p.get("source")).lower() in server.LEGACY_PLACE_PROVIDERS for p in places))

    async def test_nearby_places_restores_geoapify_hosted_places(self):
        geoapify_place = {
            "id": "geoapify_food_1",
            "name": "Hosted Cafe",
            "lat": 48.858,
            "lng": 2.294,
            "type": "food",
            "source": "geoapify",
            "source_label": "Geoapify",
        }
        with (
            patch.object(server, "get_service_places", new=AsyncMock(return_value=[])),
            patch.object(server, "get_geoapify_places", new=AsyncMock(return_value=[geoapify_place])),
        ):
            places = await server.nearby_places(
                48.858,
                2.294,
                radius=2,
                categories="food",
                provider="auto",
                user={"id": 1, "credits": 0, "is_admin": True},
            )

        self.assertEqual([p["source"] for p in places], ["geoapify"])

    async def test_search_place_card_returns_plain_map_search_card(self):
        card = await server.search_place_card("Hotel Gustave", 48.85, 2.29)

        self.assertEqual(card["source"], "search")
        self.assertEqual(card["source_label"], "Map search")
        self.assertNotIn("google_maps_uri", card)

    def test_legacy_provider_card_fields_are_scrubbed(self):
        stale = {
            "source": "google",
            "source_label": "Google Places",
            "name": "Old Provider Place",
            "photo_url": "https://example.com/photo.jpg",
            "google_maps_uri": "https://maps.google.example",
            "rich_detail_locked": True,
        }

        cleaned = server.strip_lightweight_google_rich_fields(stale)

        self.assertNotIn("photo_url", cleaned)
        self.assertNotIn("google_maps_uri", cleaned)
        self.assertNotIn("rich_detail_locked", cleaned)

    def test_mapbox_camp_selection_is_overnight_card_candidate(self):
        body = server.MapCardResolveRequest(
            kind="search",
            source="rendered_mapbox_standard",
            source_label="Mapbox Standard",
            name="Sand Flats Recreation Area Group Campsites",
            lat=38.5676967,
            lng=-109.5270932,
            type="poi",
            subtype="campground",
            raw_feature={"properties": {"class": "camp_site", "maki": "campsite"}},
        )
        card = server._map_card_base_from_request(body)

        self.assertTrue(server._map_card_is_overnight(body, card))
        fallback = server._map_card_overnight_fallback(body, card)
        self.assertEqual(fallback["type"], "camp")
        self.assertIn("camp", fallback["tags"])

    def test_mapbox_campus_is_not_overnight_card_candidate(self):
        body = server.MapCardResolveRequest(
            kind="search",
            source="rendered_mapbox_standard",
            name="Campbell University",
            lat=35.409,
            lng=-78.739,
            type="poi",
            subtype="university campus",
        )
        card = server._map_card_base_from_request(body)

        self.assertFalse(server._map_card_is_overnight(body, card))


if __name__ == "__main__":
    unittest.main()
