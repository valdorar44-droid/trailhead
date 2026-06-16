import unittest
from unittest.mock import AsyncMock, patch

import dashboard.server as server
import ingestors.nps as nps


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

    def test_related_rails_keep_dumps_out_of_things_to_do(self):
        places = [
            {"id": "view-1", "name": "Canyon Overlook", "lat": 38.0, "lng": -109.0, "type": "viewpoint"},
            {"id": "trail-1", "name": "Canyon Trail", "lat": 38.01, "lng": -109.01, "type": "trail"},
            {"id": "visitor-1", "name": "Visitor Center", "lat": 38.02, "lng": -109.02, "type": "visitor_center"},
            {"id": "dump-1", "name": "Dump Station", "lat": 38.0, "lng": -109.0, "type": "dump"},
            {"id": "camp-1", "name": "Nearby Camp", "lat": 38.0, "lng": -109.0, "type": "camp"},
        ]

        rails = server._related_rails_from_places(places, [], None)

        self.assertEqual([p["name"] for p in rails["things_to_do"]], ["Canyon Trail"])
        self.assertEqual([p["name"] for p in rails["things_to_see"]], ["Canyon Overlook"])
        self.assertEqual([p["name"] for p in rails["visitor_centers"]], ["Visitor Center"])
        self.assertEqual([p["name"] for p in rails["trip_services"]], ["Dump Station"])
        self.assertEqual([p["name"] for p in rails["campgrounds_nearby"]], ["Nearby Camp"])
        self.assertEqual([p["name"] for p in rails["places"]], ["Canyon Trail", "Canyon Overlook", "Visitor Center"])
        self.assertEqual(rails["camps"], rails["campgrounds_nearby"])

    def test_related_rails_include_photo_status_and_cap_services(self):
        places = [
            {"id": f"dump-{i}", "name": f"Dump Station {i}", "lat": 38.0 + i / 1000, "lng": -109.0, "type": "dump"}
            for i in range(14)
        ] + [
            {"id": "view-1", "name": "Canyon Overlook", "lat": 38.0, "lng": -109.0, "type": "viewpoint", "photo_url": "https://cdn.example/view.jpg"},
            {"id": "trail-1", "name": "Canyon Trail", "lat": 38.01, "lng": -109.01, "type": "trail"},
        ]

        rails = server._related_rails_from_places(places, [], None)

        self.assertEqual(len(rails["trip_services"]), 4)
        self.assertEqual(rails["things_to_see"][0]["photo_status"], "open_photo")
        self.assertEqual(rails["things_to_do"][0]["photo_status"], "placeholder")

    def test_related_rails_collapse_repeated_named_services(self):
        places = [
            {"id": "dump-1", "name": "Potash Road", "lat": 38.57, "lng": -109.52, "type": "dump", "source": "geoapify"},
            {"id": "dump-2", "name": "Potash Road", "lat": 38.572, "lng": -109.522, "type": "dump", "source": "osm"},
            {"id": "water-1", "name": "Potash Road", "lat": 38.573, "lng": -109.523, "type": "water", "source": "geoapify"},
        ]

        rails = server._related_rails_from_places(places, [], None)

        self.assertEqual([p["name"] for p in rails["trip_services"]].count("Potash Road"), 2)

    def test_related_rails_drop_generic_blm_without_photos(self):
        places = [
            {"id": "blm-generic-1", "name": "BLM Recreation Site", "lat": 38.0, "lng": -109.0, "type": "trailhead", "source": "blm", "source_label": "Official BLM"},
            {"id": "blm-generic-2", "name": "BLM Recreation Site", "lat": 38.01, "lng": -109.01, "type": "viewpoint", "source": "blm", "source_label": "Official BLM"},
            {"id": "blm-real", "name": "Fisher Towers Trailhead", "lat": 38.72, "lng": -109.31, "type": "trailhead", "source": "blm", "source_label": "Official BLM", "photo_url": "https://cdn.example/fisher.jpg"},
            {"id": "view-real", "name": "Canyon Viewpoint", "lat": 38.2, "lng": -109.2, "type": "viewpoint", "source": "nps", "source_label": "National Park Service", "photo_url": "https://cdn.example/view.jpg"},
        ]

        rails = server._related_rails_from_places(places, [], None)

        self.assertNotIn("BLM Recreation Site", [p["name"] for p in rails["things_to_do"]])
        self.assertNotIn("BLM Recreation Site", [p["name"] for p in rails["things_to_see"]])
        self.assertIn("Fisher Towers Trailhead", [p["name"] for p in rails["things_to_do"]])
        self.assertIn("Canyon Viewpoint", [p["name"] for p in rails["things_to_see"]])

    def test_related_rails_drop_generic_blm_services_without_photos(self):
        places = [
            {"id": "blm-water", "name": "BLM Recreation Site", "lat": 38.0, "lng": -109.0, "type": "water", "source": "blm", "source_label": "Official BLM"},
            {"id": "named-water", "name": "Portal Trail Water", "lat": 38.01, "lng": -109.01, "type": "water", "source": "osm", "source_label": "OpenStreetMap"},
        ]

        rails = server._related_rails_from_places(places, [], None)

        self.assertNotIn("BLM Recreation Site", [p["name"] for p in rails["trip_services"]])
        self.assertIn("Portal Trail Water", [p["name"] for p in rails["trip_services"]])

    def test_nps_endpoint_record_suppresses_category_summary(self):
        record = nps._endpoint_record(
            "places",
            {"id": "park-avenue", "title": "Park Avenue Viewpoint and Trail", "latitude": "38.624", "longitude": "-109.600", "shortDescription": "Places", "description": ""},
            {"parkCode": "arch", "url": "https://www.nps.gov/arch/index.htm"},
            38.57,
            -109.52,
        )

        self.assertIsNotNone(record)
        self.assertEqual(record["summary"], "")
        self.assertEqual(record["description"], "")

    def test_merge_town_profiles_prefers_own_photo_and_sources(self):
        profile = server._merge_town_profiles(
            {"name": "Seattle", "wikidata_id": "Q5083", "source_label": "OpenStreetMap"},
            {"photo_url": "https://upload.wikimedia.org/seattle.jpg", "photos": [{"url": "https://upload.wikimedia.org/seattle.jpg", "source": "Wikidata"}], "source_label": "Wikidata"},
            {"summary": "Seattle is a city in Washington.", "official_url": "https://en.wikipedia.org/wiki/Seattle", "source_label": "Wikipedia"},
        )

        self.assertEqual(profile["photo_url"], "https://upload.wikimedia.org/seattle.jpg")
        self.assertIn("Seattle is a city", profile["summary"])
        self.assertIn("OpenStreetMap", profile["source_badge"])
        self.assertIn("Wikidata", profile["source_badge"])

    def test_merge_context_rails_into_detail_keeps_existing_and_fills_missing(self):
        detail = {
            "name": "Camp",
            "things_to_do": [{"name": "Existing Tour", "type": "tour", "lat": 1, "lng": 1}],
        }
        related = {
            "things_to_do": [{"name": "Nearby Event", "type": "event", "lat": 1, "lng": 1}],
            "things_to_see": [{"name": "Scenic View", "type": "viewpoint", "lat": 1, "lng": 1}],
            "trip_services": [{"name": "Water", "type": "water", "lat": 1, "lng": 1}],
        }

        merged = server._merge_context_rails_into_detail(detail, related, {"status": "partial"})

        self.assertEqual([p["name"] for p in merged["things_to_do"]], ["Existing Tour"])
        self.assertEqual([p["name"] for p in merged["things_to_see"]], ["Scenic View"])
        self.assertEqual([p["name"] for p in merged["trip_services"]], ["Water"])
        self.assertEqual(merged["context_status"]["status"], "partial")


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

        self.assertGreaterEqual(len(places), 1)
        official = next((place for place in places if place["name"] == "Official View"), None)
        self.assertIsNotNone(official)
        self.assertTrue(official["official_free"])
        self.assertEqual(official["category_access"]["official_free_categories"], ["attraction"])

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

    async def test_map_card_locality_uses_own_open_photo_not_event_photo(self):
        event = {
            "id": "event-1",
            "name": "Volleyball Camp",
            "lat": 35.2,
            "lng": -111.65,
            "type": "event",
            "source": "active",
            "source_label": "Active",
            "photo_url": "https://cdn.example/event-logo.jpg",
        }
        wiki_profile = {
            "summary": "Flagstaff is a northern Arizona city near public lands and mountain recreation.",
            "photo_url": "https://cdn.example/flagstaff.jpg",
            "photos": [{"url": "https://cdn.example/flagstaff.jpg", "source": "Wikipedia"}],
            "official_url": "https://en.wikipedia.org/wiki/Flagstaff,_Arizona",
            "source_label": "Wikipedia",
            "source_badge": "Wikipedia / Wikimedia",
            "source_freshness": "Wikipedia cached.",
            "last_checked": 1,
        }

        with (
            patch.object(server, "get_cached", return_value=None),
            patch.object(server, "set_cached", return_value=None),
            patch.object(server, "nearby_smart_pack", new=AsyncMock(return_value={"places": [event]})),
            patch.object(server, "trails_discover", new=AsyncMock(return_value={"trails": []})),
            patch.object(server, "_open_town_profile", new=AsyncMock(return_value=wiki_profile)),
        ):
            result = await server.resolve_map_card(server.MapCardResolveRequest(
                kind="search",
                source="mapbox",
                source_label="Mapbox geocode",
                name="Flagstaff, Arizona, United States",
                lat=35.1983,
                lng=-111.6513,
                type="place",
                country="United States",
                region="Arizona",
            ), user=None)

        self.assertEqual(result["card"]["display_type"], "City")
        self.assertEqual(result["card"]["photo_url"], "https://cdn.example/flagstaff.jpg")
        self.assertNotEqual(result["card"]["photo_url"], event["photo_url"])
        self.assertIn("northern Arizona", result["card"]["summary"])
        self.assertEqual(result["related"]["things_to_do"][0]["name"], "Volleyball Camp")
        self.assertEqual(result["related"]["context_status"]["rail_counts"]["things_to_do"], 1)

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

    async def test_ridb_numeric_map_card_uses_direct_facility_detail(self):
        body = server.MapCardResolveRequest(
            kind="camp",
            source="ridb",
            source_label="Recreation.gov",
            id="266144",
            name="Sand Flats Recreation Area Group Campsites",
            lat=38.5676972,
            lng=-109.5270972,
            type="camp",
            subtype="campground",
        )
        card = server._map_card_base_from_request(body)
        detail = {
            "id": "266144",
            "name": "Sand Flats Recreation Area Group Campsites",
            "lat": 38.5676972,
            "lng": -109.5270972,
            "type": "camp",
            "description": "Official Recreation.gov facility detail.",
            "source": "ridb",
            "source_badge": "Official Recreation.gov",
        }

        with patch.object(server, "get_facility_detail", new=AsyncMock(return_value=detail)):
            camp, camp_detail = await server._resolve_map_card_overnight(body, card)

        self.assertEqual(camp["id"], "266144")
        self.assertEqual(camp_detail["description"], "Official Recreation.gov facility detail.")


if __name__ == "__main__":
    unittest.main()
