from __future__ import annotations

import json
import unittest
from collections import Counter
from pathlib import Path


ARTIFACT = Path(__file__).resolve().parents[1] / "dashboard" / "explore_serving_index_v2.json"


class ExploreServingArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = json.loads(ARTIFACT.read_text())
        cls.items = cls.payload["items"]

    def test_tracked_artifact_clears_its_release_gate(self):
        self.assertTrue(self.payload["gate"]["passed"])
        self.assertGreaterEqual(self.payload["reviewable_count"], 4000)
        self.assertEqual(self.payload["reviewable_count"], len(self.items))

    def test_all_served_items_preserve_enrichment_contract(self):
        required = {
            "planning_facts", "provenance", "checked_at", "media_kind",
            "enrichment_score", "enrichment_grade", "rejection_reasons", "reviewable",
        }
        for item in self.items:
            self.assertTrue(required.issubset(item))
            self.assertTrue(item["reviewable"])
            self.assertEqual(item["rejection_reasons"], [])
            self.assertGreaterEqual(len(item["planning_facts"]), 2)
            self.assertIn(item["media_kind"], {"photo", "map_preview"})

    def test_artifact_has_non_camping_filter_coverage(self):
        categories = Counter(item["category"] for item in self.items)
        for category in ("trail", "park", "viewpoint", "water", "climbing_area", "public_land"):
            self.assertGreater(categories[category], 0, category)

    def test_artifact_declares_filters_blocked_by_source_quality(self):
        self.assertEqual(
            self.payload["missing_filters"],
            sorted(name for name, count in self.payload["filter_counts"].items() if count == 0),
        )

    def test_promoted_categories_respect_strong_title_identity(self):
        by_title = {item["title"]: item["category"] for item in self.items}
        self.assertEqual(by_title["Kayenta Trail"], "trail")
        self.assertEqual(by_title["Upper Emerald Pools Trail"], "trail")
        self.assertEqual(by_title["Bright Angel Trailhead"], "trailhead")
        self.assertEqual(by_title["Anderson Cabin"], "lodging")
        self.assertEqual(by_title["Snow Lake"], "lake")
        self.assertEqual(by_title["Grizzly Ridge Yurt"], "glamping")


if __name__ == "__main__":
    unittest.main()
