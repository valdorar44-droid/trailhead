from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.data.audit_canonical_catalog import audit_serving_index, rough_public_copy


class CanonicalCatalogAuditTests(unittest.TestCase):
    def test_rough_copy_allows_complete_as_a_phrase(self):
        self.assertFalse(rough_public_copy("Campers enjoy views of the lake with Mount Washington as a backdrop."))
        self.assertTrue(rough_public_copy("The campgrounds offer mountain views as a."))
        self.assertTrue(rough_public_copy("Hiking trail. Check distance, current conditions, and access before you go."))

    def test_serving_audit_flags_public_copy_risks(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "explore.candidate.json"
            path.write_text(json.dumps({
                "items": [
                    {
                        "id": "place:bad-copy",
                        "title": "Swede Point Park",
                        "category": "campground",
                        "group": "camping",
                        "lat": 41.884,
                        "lng": -93.854,
                        "description": "Swede Point Park is a park area near the area.",
                    },
                    {
                        "id": "place:ok",
                        "title": "Canyon View",
                        "category": "viewpoint",
                        "group": "viewpoint",
                        "lat": 38.5,
                        "lng": -109.5,
                        "description": "Canyon overlook with broad desert views.",
                    },
                ],
            }))
            report = audit_serving_index(path, "explore")
            self.assertEqual([item["name"] for item in report["rough_public_copy"]], ["Swede Point Park"])
            self.assertEqual(report["forbidden_public_copy"], [])

    def test_serving_audit_flags_loose_rv_labels(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "camps.candidate.json"
            path.write_text(json.dumps({
                "items": [
                    {
                        "id": "camp:mixed",
                        "name": "King's Bottom Campground",
                        "category": "camp",
                        "kind": "rv_park",
                        "label": "RV park",
                        "lat": 38.556,
                        "lng": -109.585,
                        "summary": "Campground near Moab.",
                    },
                ],
            }))
            report = audit_serving_index(path, "camp")
            self.assertEqual([item["name"] for item in report["suspect_rv_labels"]], ["King's Bottom Campground"])

    def test_serving_audit_flags_zero_distance_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "explore.candidate.json"
            path.write_text(json.dumps({
                "items": [
                    {
                        "id": "trail:tiny",
                        "title": "Tiny Loop Trail",
                        "category": "trail",
                        "group": "trails",
                        "lat": 38.6,
                        "lng": -109.62,
                        "description": "0.0 mile trail",
                    },
                ],
            }))
            report = audit_serving_index(path, "explore")
            self.assertEqual([item["name"] for item in report["rough_public_copy"]], ["Tiny Loop Trail"])

    def test_serving_audit_flags_duplicate_public_trails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trails.candidate.json"
            path.write_text(json.dumps({
                "items": [
                    {
                        "id": "trail:one",
                        "name": "Hidden Valley",
                        "category": "trail",
                        "lat": 38.5318,
                        "lng": -109.5172,
                        "summary": "1.9 miles.",
                    },
                    {
                        "id": "trail:two",
                        "name": "Hidden Valley Trail",
                        "category": "trail",
                        "lat": 38.5319,
                        "lng": -109.5173,
                        "summary": "1.9 miles.",
                    },
                ],
            }))
            report = audit_serving_index(path, "trail")
            self.assertEqual(report["duplicate_public_trails"][0]["count"], 2)

    def test_serving_audit_flags_confirmed_clipped_public_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trails.candidate.json"
            path.write_text(json.dumps({
                "items": [
                    {
                        "id": "trail:clipped",
                        "name": "Timber Creek / Deer Creek Trai",
                        "category": "trail",
                        "lat": 44.0185,
                        "lng": -109.1885,
                        "summary": "11.2 miles. Moderate.",
                    },
                    {
                        "id": "trail:clean",
                        "name": "Timber Creek / Deer Creek Trail",
                        "category": "trail",
                        "lat": 44.019,
                        "lng": -109.189,
                        "summary": "11.2 miles. Moderate.",
                    },
                ],
            }))
            report = audit_serving_index(path, "trail")
            self.assertEqual([item["name"] for item in report["clipped_public_names"]], ["Timber Creek / Deer Creek Trai"])

    def test_serving_audit_flags_misrouted_explore_camping_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "explore.candidate.json"
            path.write_text(json.dumps({
                "items": [
                    {
                        "id": "place:boat-site",
                        "title": "Lake Andrusia Boat Site",
                        "category": "campground",
                        "group": "camping",
                        "lat": 47.5,
                        "lng": -94.7,
                        "description": "Concrete boat ramp with lake access.",
                    },
                    {
                        "id": "place:not-public",
                        "title": "Chickamauga Battlefield Group Campground",
                        "category": "campground",
                        "group": "camping",
                        "lat": 34.91,
                        "lng": -85.26,
                        "description": "THIS IS NOT A PUBLIC CAMPGROUND.",
                    },
                    {
                        "id": "place:real-camp",
                        "title": "Rough Canyon Campground",
                        "category": "campground",
                        "group": "camping",
                        "lat": 29.58,
                        "lng": -100.97,
                        "description": "Campground near a boat ramp.",
                    },
                ],
            }))
            report = audit_serving_index(path, "explore")
            self.assertEqual(
                [item["name"] for item in report["misrouted_camping_records"]],
                ["Lake Andrusia Boat Site", "Chickamauga Battlefield Group Campground"],
            )


if __name__ == "__main__":
    unittest.main()
