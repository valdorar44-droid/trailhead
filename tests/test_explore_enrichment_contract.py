from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.data.build_canonical_serving_indexes import (
    build_explore_index,
    clean_public_text,
    source_backed_feature_description,
)
from scripts.data.promote_explore_serving_index import promote
from scripts.explore_sources.base.enrichment import enrich_place_dict


def source(source_id: str = "123") -> dict:
    return {
        "source": "ridb",
        "source_id": source_id,
        "url": f"https://www.recreation.gov/camping/poi/{source_id}",
        "attribution": "Recreation.gov",
        "license": "Public API terms",
        "quality": "official_source",
    }


def place(place_id: str, name: str, *, photo: bool = False) -> dict:
    payload = {
        "id": place_id,
        "name": name,
        "category": "campground",
        "lat": 38.5733,
        "lng": -109.5498,
        "region": "Utah",
        "description": (
            f"{name} sits near sandstone trails and provides a documented overnight base. "
            "The source listing includes current booking and facility details."
        ),
        "summary": {
            "title": name,
            "category": "Campground",
            "explore_group": "camping",
            "lat": 38.5733,
            "lng": -109.5498,
        },
        "reservations": {"reservable": True},
        "sources": [source(place_id)],
        "quality": "official_source",
        "verified": True,
        "last_seen_at": 1783200000,
        "updated_at": 1783200000,
        "media": [],
    }
    if photo:
        payload["media"] = [{"url": f"https://images.example.com/{place_id}.jpg", "caption": name}]
        payload["source_pack"] = {"activities": ["Hiking", "Scenic driving"]}
    return payload


class ExploreEnrichmentContractTests(unittest.TestCase):
    def test_public_copy_keeps_substance_after_hooks_and_leading_ellipsis(self):
        ellipsis = clean_public_text(
            ". . . where you can explore tide pools and hike lush trails near downtown Boston. "
            "Visitor services connect the park's islands and peninsulas."
        )
        hooked = clean_public_text(
            "Want to camp? Reserve your spot now! Camping season generally runs May through September. "
            "Potable water may be turned off during months with reduced sunlight."
        )

        self.assertTrue(ellipsis.startswith("Where you can explore"))
        self.assertIn("Visitor services", ellipsis)
        self.assertTrue(hooked.startswith("Camping season"))
        self.assertIn("Potable water", hooked)

    def test_score_is_deterministic_and_map_preview_is_valid_media(self):
        raw = place("map-camp", "Canyon Base Camp")

        first = enrich_place_dict(raw)
        second = enrich_place_dict(raw)

        self.assertEqual(first, second)
        self.assertEqual(first["media_kind"], "map_preview")
        self.assertEqual(first["enrichment_grade"], "complete")
        self.assertTrue(first["reviewable"])
        self.assertGreaterEqual(first["enrichment_score"], 75)
        self.assertEqual([fact["key"] for fact in first["planning_facts"]], ["place_type", "area", "reservations"])
        self.assertEqual(first["provenance"]["primary"]["source"], "ridb")
        self.assertEqual(first["checked_at"], 1783200000)

    def test_boilerplate_is_rejected_without_promoting_card_advice(self):
        raw = place("weak-camp", "Weak Camp")
        raw["description"] = "Mapped camping location; check access, fees, fire restrictions, reservations, and seasonal road conditions."
        raw["region"] = ""
        raw["reservations"] = {}
        raw["amenities"] = ["N", "WEAK,WEAK CAMP,FOREST - FS"]
        raw["card"] = {"warnings": ["Check weather"], "best_for": ["Camping"]}

        enriched = enrich_place_dict(raw)

        self.assertEqual(enriched["enrichment_grade"], "candidate")
        self.assertFalse(enriched["reviewable"])
        self.assertIn("boilerplate_description", enriched["rejection_reasons"])
        self.assertIn("insufficient_planning_facts", enriched["rejection_reasons"])
        self.assertEqual([fact["key"] for fact in enriched["planning_facts"]], ["place_type"])

    def test_canonical_index_preserves_contract_and_orders_best_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"
            photo_place = place("photo-camp", "Desert View Camp", photo=True)
            map_place = place("map-camp", "Canyon Base Camp")
            path.write_text(json.dumps({
                "schema_version": 3,
                "generated_at": 1783200001,
                "places": [map_place, photo_place],
            }))

            payload = build_explore_index(path, minimum_reviewable=2)

        self.assertTrue(payload["gate"]["passed"])
        self.assertEqual(payload["reviewable_count"], 2)
        self.assertEqual([item["id"] for item in payload["items"]], ["photo-camp", "map-camp"])
        first = payload["items"][0]
        for key in (
            "planning_facts",
            "provenance",
            "checked_at",
            "media_kind",
            "enrichment_score",
            "enrichment_grade",
            "rejection_reasons",
            "reviewable",
        ):
            self.assertIn(key, first)
        self.assertEqual(first["enrichment_grade"], "signature")
        self.assertEqual(first["media_kind"], "photo")

    def test_canonical_index_reports_rejections_and_failed_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"
            weak = place("weak-camp", "Weak Camp")
            weak["description"] = "Mapped outdoor place; verify access, current conditions, and local rules before relying on it."
            path.write_text(json.dumps({"schema_version": 3, "places": [weak]}))

            payload = build_explore_index(path, minimum_reviewable=1)

        self.assertFalse(payload["gate"]["passed"])
        self.assertEqual(payload["items"], [])
        self.assertEqual(payload["rejections"][0]["id"], "weak-camp")
        self.assertIn("boilerplate_description", payload["rejections"][0]["rejection_reasons"])

    def test_explicit_non_camp_category_is_not_overridden_by_description_terms(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"
            park = place("park", "Canyon National Park", photo=True)
            park["category"] = "park"
            park["summary"]["category"] = "Park"
            park["description"] = (
                "Canyon National Park protects a documented desert landscape and year-round visitor routes. "
                "Camping is available in designated areas near several trailheads."
            )
            path.write_text(json.dumps({"schema_version": 3, "places": [park]}))

            payload = build_explore_index(path, minimum_reviewable=1)

        self.assertEqual(payload["items"][0]["category"], "park")
        self.assertEqual(payload["items"][0]["group"], "parks")

    def test_named_source_backed_thermal_feature_clears_the_gate_without_weakening_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"
            spring = place("spring", "Frying Pan Lake", photo=True)
            spring.update({
                "category": "hot_spring",
                "subcategories": ["hot_spring"],
                "tags": ["hot_spring", "lake", "wikidata"],
                "region": "Bay of Plenty Region",
                "admin": "Rotorua Lakes District",
                "country": "New Zealand",
                "description": "hot spring in Bay of Plenty Region, New Zealand",
                "sources": [{
                    "source": "wikidata",
                    "source_id": "Q913465",
                    "url": "https://www.wikidata.org/wiki/Q913465",
                    "attribution": "Wikidata contributors",
                    "license": "Creative Commons CC0 1.0",
                    "quality": "open_community_data",
                }],
                "quality": "open_community_data",
                "verified": False,
            })
            spring["summary"]["category"] = "Hot Spring"
            path.write_text(json.dumps({"schema_version": 3, "places": [spring]}))

            payload = build_explore_index(path, minimum_reviewable=1)

        item = payload["items"][0]
        self.assertEqual((item["category"], item["group"]), ("hot_spring", "water"))
        self.assertEqual(
            item["description"],
            "Frying Pan Lake is a hot spring in Bay of Plenty Region, New Zealand.",
        )
        self.assertEqual(item["enrichment_grade"], "complete")

    def test_terse_unphotographed_or_uncorroborated_source_copy_stays_rejected(self):
        weak = place("weak-peak", "Remote Peak")
        weak.update({
            "category": "peak",
            "description": "mountain in Pakistan",
            "region": "Pakistan",
            "country": "Pakistan",
            "sources": [{
                "source": "wikidata",
                "source_id": "Q123",
                "url": "https://www.wikidata.org/wiki/Q123",
                "attribution": "Wikidata contributors",
                "quality": "open_community_data",
            }],
        })

        self.assertEqual(
            source_backed_feature_description(weak, "Remote Peak", weak["description"]),
            weak["description"],
        )
        self.assertFalse(enrich_place_dict(weak)["reviewable"])

    def test_official_scenic_drive_uses_only_explicit_route_facts(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"
            drive = place("drive", "Talladega Scenic Drive")
            drive["region"] = ""
            drive["reservations"] = {}
            drive["description"] = (
                "Talladega Scenic Drive has 29 miles for exploring the national forest by automobile. "
                "The paved route climbs to an elevation of 2,407 feet before ending at Adams Gap."
            )
            path.write_text(json.dumps({"schema_version": 3, "places": [drive]}))

            payload = build_explore_index(path, minimum_reviewable=1)

        item = payload["items"][0]
        self.assertEqual((item["category"], item["group"]), ("scenic_drive", "drives"))
        facts = {fact["key"]: fact["value"] for fact in item["planning_facts"]}
        self.assertEqual(facts["place_type"], "Scenic Drive")
        self.assertEqual(facts["distance"], "29 mi")
        self.assertEqual(facts["surface"], "Paved")
        self.assertEqual(facts["elevation"], "2,407 ft")

    def test_category_guard_rejects_venues_and_recategorizes_programs(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"

            def scenic(place_id: str, name: str, description: str, category: str = "viewpoint") -> dict:
                item = place(place_id, name, photo=True)
                item["category"] = category
                item["summary"]["category"] = category
                item["description"] = description
                return item

            path.write_text(json.dumps({
                "schema_version": 3,
                "places": [
                    scenic("food", "Arizona Steakhouse", "A restaurant in the historic lodge serves meals throughout the visitor season."),
                    scenic("bus", "Bright Angel Lodge Bus Stop", "This shuttle stop provides access to lodges and the canyon rim."),
                    scenic("office", "Acting Superintendent's Office", "This former administrative office documents the early history of the national park."),
                    scenic("info", "Backcountry Information Center", "Park staff provide current permit, water, trail, and safety information for backcountry trips."),
                    scenic("talk", "Geology Talk (30 minutes)", "A ranger program covers the documented geologic history of the canyon."),
                    scenic("wildlife", "Bighorn Sheep", "This species lives in cliff habitat throughout the park and is commonly seen on rocky slopes.", "trail"),
                ],
            }))

            payload = build_explore_index(path, minimum_reviewable=3)

        by_title = {item["title"]: item for item in payload["items"]}
        self.assertEqual(by_title["Backcountry Information Center"]["category"], "visitor_center")
        self.assertEqual(by_title["Geology Talk (30 minutes)"]["category"], "activity")
        self.assertEqual(by_title["Bighorn Sheep"]["category"], "activity")
        rejected = {item["title"]: item["rejection_reasons"] for item in payload["rejections"]}
        self.assertIn("category_mismatch_food_service", rejected["Arizona Steakhouse"])
        self.assertIn("category_mismatch_transit_stop", rejected["Bright Angel Lodge Bus Stop"])
        self.assertIn("category_mismatch_office", rejected["Acting Superintendent's Office"])

    def test_title_identity_precedes_noisy_explicit_categories(self):
        cases = [
            ("kayenta", "Kayenta Trail", "lake", "trail"),
            ("emerald", "Upper Emerald Pools Trail", "lake", "trail"),
            ("trailhead", "Bright Angel Trailhead", "lake", "trailhead"),
            ("exhibit", "History Exhibit - The Amazing Kolb Brothers", "lake", "activity"),
            ("picnic", "Church Bowl Picnic Area", "viewpoint", "activity"),
            ("ski", "Badger Pass Ski Area", "viewpoint", "activity"),
            ("cabin", "Anderson Cabin", "climbing_area", "lodging"),
            ("camp", "China Meadows Trailhead Campground", "trailhead", "campground"),
            ("snow", "Snow Lake", "glacier", "lake"),
            ("yurt", "Grizzly Ridge Yurt", "lodging", "glamping"),
            ("glamp", "Lake Powhatan Glamping", "campground", "glamping"),
            ("interpretive", "Pa'rus - Creation from Destruction", "waterfall", "activity"),
            ("peninsula", "Kaikoura Peninsula", "peak", "viewpoint"),
            ("group-site", "Eagle Creek Overlook Grp Site", "viewpoint", "campground"),
            ("aquila", "Aquila Vista Recreation Site", "viewpoint", "campground"),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"
            records = []
            for place_id, name, category, _expected in cases:
                record = place(place_id, name, photo=True)
                record["category"] = category
                record["summary"]["category"] = category
                record["description"] = (
                    f"{name} has a documented source profile with current access and trip-planning context. "
                    "Visitors should use the linked source for current operating details."
                )
                if place_id == "aquila":
                    record["description"] = "Aquila Vista is available for overnight group camping for groups up to 20 people and 8 vehicles."
                records.append(record)
            path.write_text(json.dumps({"schema_version": 3, "places": records}))

            payload = build_explore_index(path, minimum_reviewable=len(cases))

        by_id = {item["id"]: item["category"] for item in payload["items"]}
        self.assertEqual(by_id, {place_id: expected for place_id, _name, _category, expected in cases})

    def test_promotion_refuses_to_replace_output_when_gate_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_path = root / "catalog.json"
            out_path = root / "serving.json"
            weak = place("weak-camp", "Weak Camp")
            weak["description"] = "Mapped outdoor place; verify access, current conditions, and local rules before relying on it."
            source_path.write_text(json.dumps({"schema_version": 3, "places": [weak]}))
            out_path.write_text("existing")

            with self.assertRaisesRegex(ValueError, "promotion blocked"):
                promote(source_path, out_path, minimum_reviewable=1)

            self.assertEqual(out_path.read_text(), "existing")

    def test_promotion_output_is_byte_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_path = root / "catalog.json"
            out_path = root / "serving.json"
            source_path.write_text(json.dumps({
                "schema_version": 3,
                "catalog_id": "test-catalog",
                "generated_at": 1783200001,
                "places": [place("map-camp", "Canyon Base Camp")],
            }))

            promote(source_path, out_path, minimum_reviewable=1)
            first = out_path.read_bytes()
            promote(source_path, out_path, minimum_reviewable=1)

            self.assertEqual(out_path.read_bytes(), first)


if __name__ == "__main__":
    unittest.main()
