from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

import dashboard.server as server


class CanonicalCampServingTests(unittest.TestCase):
    def setUp(self):
        self._old_path = server.CANONICAL_CAMP_INDEX_PATH
        self._old_env = os.environ.get("TRAILHEAD_LOCAL_CAMP_INDEX_ENABLED")
        self._tmpdir = tempfile.TemporaryDirectory()
        path = Path(self._tmpdir.name) / "camps.candidate.json"
        path.write_text(json.dumps({
            "generated_at": 1783152022,
            "items": [
                {
                    "id": "camp:kings-bottom",
                    "name": "King's Bottom Campground",
                    "lat": 38.556491,
                    "lng": -109.585018,
                    "kind": "campground",
                    "label": "Campground",
                    "land_type": "Campground",
                    "source": "Recreation.gov",
                    "source_label": "Recreation.gov",
                    "source_rank": 8,
                    "summary": "BLM campground near Moab.",
                    "reservable": False,
                },
                {
                    "id": "camp:portal-rv",
                    "name": "Portal RV Resort - Moab",
                    "lat": 38.589985,
                    "lng": -109.568839,
                    "kind": "rv_park",
                    "label": "RV Park",
                    "source": "Geoapify",
                    "source_label": "Campground",
                    "source_rank": 30,
                    "summary": "Private RV resort near Moab.",
                },
                {
                    "id": "camp:casino-parking",
                    "name": "High Desert Casino",
                    "lat": 38.58,
                    "lng": -109.57,
                    "kind": "overnight_parking",
                    "label": "Overnight parking",
                    "source": "Trailhead",
                    "source_label": "Trailhead",
                    "summary": "Overnight parking area.",
                },
                {
                    "id": "camp:dispersed-tent",
                    "name": "Dispersed tent site",
                    "lat": 38.57,
                    "lng": -109.56,
                    "kind": "dispersed_camp",
                    "label": "Dispersed",
                    "source": "Trailhead",
                    "source_label": "Trailhead",
                    "summary": "Dispersed spots can change quickly. Check access before you go.",
                },
                {
                    "id": "camp:big-pine-clyde",
                    "name": "Big Pine Canyon Group- Clyde Glacier Cam",
                    "lat": 37.128632,
                    "lng": -118.422588,
                    "kind": "campground",
                    "label": "Campground",
                    "land_type": "Campground",
                    "source": "US Forest Service",
                    "source_label": "US Forest Service",
                    "source_rank": 12,
                    "summary": "Clyde Glacier group campsite can accommodate up to 25 people.",
                },
            ],
        }))
        server.CANONICAL_CAMP_INDEX_PATH = path
        server._canonical_camp_index_cache.update({"path": "", "mtime": 0.0, "items": [], "generated_at": 0})
        os.environ["TRAILHEAD_LOCAL_CAMP_INDEX_ENABLED"] = "1"

    def tearDown(self):
        server.CANONICAL_CAMP_INDEX_PATH = self._old_path
        server._canonical_camp_index_cache.update({"path": "", "mtime": 0.0, "items": [], "generated_at": 0})
        if self._old_env is None:
            os.environ.pop("TRAILHEAD_LOCAL_CAMP_INDEX_ENABLED", None)
        else:
            os.environ["TRAILHEAD_LOCAL_CAMP_INDEX_ENABLED"] = self._old_env
        self._tmpdir.cleanup()

    def test_local_camp_index_maps_to_existing_pin_shape(self):
        camps = server._canonical_camps_in_bounds(
            38.70,
            38.40,
            -109.40,
            -109.70,
            lat=38.57327,
            lng=-109.550789,
        )
        self.assertEqual(len(camps), 4)
        light = server._camp_discovery_response(camps, mode="light", limit=10)
        labels = {camp["name"]: camp["land_type"] for camp in light}
        self.assertEqual(labels["King's Bottom Campground"], "Campground")
        self.assertEqual(labels["Portal RV Resort - Moab"], "RV Park")
        self.assertEqual(labels["High Desert Casino"], "Overnight parking")
        self.assertEqual(labels["Dispersed tent site"], "Dispersed")
        self.assertTrue(all("download" not in json.dumps(camp).lower() for camp in light))

    def test_rv_filter_does_not_pull_mixed_campgrounds(self):
        camps = server._canonical_camps_in_bounds(
            38.70,
            38.40,
            -109.40,
            -109.70,
            type_filters=["rv"],
            lat=38.57327,
            lng=-109.550789,
        )
        self.assertEqual([camp["name"] for camp in camps], ["Portal RV Resort - Moab"])

    def test_disperse_filter_ignores_overnight_parking(self):
        camps = server._canonical_camps_in_bounds(
            38.70,
            38.40,
            -109.40,
            -109.70,
            type_filters=["dispersed"],
            lat=38.57327,
            lng=-109.550789,
        )
        self.assertEqual([camp["name"] for camp in camps], ["Dispersed tent site"])

    def test_strict_backend_rv_helper_ignores_rv_site_type(self):
        self.assertFalse(server._camp_is_primary_rv({
            "name": "King's Bottom Campground",
            "land_type": "BLM",
            "site_types": ["Tent", "RV"],
            "tags": ["camp", "rv"],
        }))
        self.assertTrue(server._camp_is_primary_rv({
            "name": "Portal RV Resort - Moab",
            "land_type": "private",
        }))

    def test_osm_freshness_copy_is_public_safe(self):
        card = server._camp_lightweight_record({
            "id": "osm_node_1",
            "name": "Canyon Camp",
            "lat": 38.5,
            "lng": -109.5,
            "land_type": "Campground",
            "source": "osm",
            "verified_source": "Campground",
            "source_freshness": "Community-mapped OpenStreetMap camp data verify current access, legality, fees, and conditions locally.",
        })
        self.assertEqual(card["freshness_label"], "Check access, fees, and current conditions before you go.")
        self.assertNotIn("OpenStreetMap", card["freshness_label"])

    def test_clipped_source_names_are_repaired_for_map_pins(self):
        camps = server._canonical_camps_in_bounds(
            37.20,
            37.00,
            -118.30,
            -118.55,
            lat=37.128632,
            lng=-118.422588,
        )
        light = server._camp_discovery_response(camps, mode="light", limit=10)
        names = [camp["name"] for camp in light]
        self.assertIn("Big Pine Canyon Group - Clyde Glacier Campground", names)
        for name in names:
            self.assertNotRegex(name, r"\b(?:Cam|Campgroun|Rec)$")

    def test_administrative_records_do_not_merge_as_camps(self):
        merged = server._merge_camp_sources([
            {
                "id": "office:1",
                "name": "South Park Ranger District",
                "lat": 39.0,
                "lng": -105.0,
                "land_type": "Ranger district",
                "source": "official",
            },
            {
                "id": "camp:1",
                "name": "Ranger Station Campground",
                "lat": 39.1,
                "lng": -105.1,
                "land_type": "Campground",
                "source": "official",
            },
        ])
        self.assertEqual([camp["name"] for camp in merged], ["Ranger Station Campground"])


if __name__ == "__main__":
    unittest.main()
