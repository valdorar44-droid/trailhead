import unittest

import dashboard.server as server
from ingestors.pakistan_curated import get_pakistan_curated_treks


class TrailCatalogTests(unittest.TestCase):
    def test_public_trail_profile_adds_catalog_fields(self):
        profile = {
            "id": "osm:way:123",
            "name": "Canyon Loop",
            "summary": "Open trail record.",
            "description": "Verify current access.",
            "lat": 38.1,
            "lng": -109.5,
            "length_mi": 4.2,
            "difficulty": "",
            "activities": ["hiking"],
            "land_manager": "BLM",
            "geometry": {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-109.5, 38.1], [-109.51, 38.11], [-109.5, 38.1]]},
                    "properties": {},
                }],
            },
            "trailheads": [{"name": "Canyon", "lat": 38.1, "lng": -109.5}],
            "official_url": "https://www.openstreetmap.org/way/123",
            "photos": [{"url": "https://example.test/photo.jpg", "credit": "Tester", "license": "cc-by-nc", "commercial_restricted": True}],
            "source": "osm",
            "source_label": "OpenStreetMap",
            "provenance": {"catalog": {"geometry_ref": "osm:way:123", "area_name": "Canyon Area"}},
            "last_checked": 1,
        }

        public = server._public_trail_profile(profile)
        card = server._trail_profile_to_explore_card(profile)

        self.assertEqual(public["route_type"], "Loop")
        self.assertEqual(public["difficulty"], "Moderate")
        self.assertEqual(public["geometry_ref"], "osm:way:123")
        self.assertEqual(public["source_pack"]["primary"], "OpenStreetMap")
        self.assertEqual(card["trail_id"], "osm:way:123")
        self.assertEqual(card["area"], "Canyon Area")
        self.assertEqual(card["image_license"], "cc-by-nc")
        self.assertTrue(card["photos"][0]["commercial_restricted"])

    def test_trail_area_from_profiles_returns_explore_shape(self):
        area = server._trail_area_from_profiles(38.1, -109.5, 25, [{
            "id": "osm:node:1",
            "name": "Rim Trailhead",
            "summary": "Trailhead.",
            "lat": 38.1,
            "lng": -109.5,
            "length_mi": None,
            "difficulty": "Scout first",
            "activities": ["hiking"],
            "land_manager": "",
            "geometry": None,
            "trailheads": [{"name": "Rim", "lat": 38.1, "lng": -109.5}],
            "official_url": "",
            "photos": [],
            "source": "osm",
            "source_label": "OpenStreetMap",
            "provenance": {},
            "last_checked": 1,
        }])

        self.assertEqual(area["category"], "trails")
        self.assertEqual(len(area["trails"]), 1)
        self.assertEqual(area["trails"][0]["route_type"], "Point or route")
        self.assertIn("source_pack", area)

    def test_pakistan_trek_profile_preserves_trek_and_glacier_fields(self):
        treks = get_pakistan_curated_treks(35.7455, 76.5142, radius_miles=80)
        k2 = next(item for item in treks if item["name"] == "K2 Base Camp Trek")
        profile = server._trail_profile_from_pakistan_trek(k2)
        self.assertIsNotNone(profile)

        public = server._public_trail_profile(profile)
        card = server._trail_profile_to_explore_card(profile)

        self.assertEqual(public["feature_type"], "trek")
        self.assertEqual(public["feature_label"], "Trek")
        self.assertTrue(public["trekking_only"])
        self.assertTrue(public["guide_required"])
        self.assertTrue(public["glacier_crossing"])
        self.assertEqual(public["route_target"]["name"], "Askole Trailhead")
        self.assertIn("permits", public["permit_note"].lower())
        self.assertEqual(card["feature_label"], "Trek")
        self.assertTrue(card["trekking_only"])
        self.assertEqual(card["route_target"]["lng"], 75.8178)

    def test_pakistan_area_uses_trek_glacier_copy_and_sources(self):
        trek = server._trail_profile_from_pakistan_trek(
            next(item for item in get_pakistan_curated_treks(35.7455, 76.5142, 80) if item["name"] == "Baltoro Glacier")
        )
        area = server._trail_area_from_profiles(35.7455, 76.5142, 50, [trek])

        self.assertEqual(area["summary"]["title"], "Northern Pakistan Treks")
        self.assertIn("glaciers", area["subcategories"])
        self.assertEqual(area["trails"][0]["feature_type"], "glacier")
        self.assertTrue(area["trails"][0]["trekking_only"])
        self.assertTrue(any(source.get("kind") == "glacier_reference" for source in area["source_pack"]["sources"]))


if __name__ == "__main__":
    unittest.main()
