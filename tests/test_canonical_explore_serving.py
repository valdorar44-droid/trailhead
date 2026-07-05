from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

import dashboard.server as server
from scripts.data.build_canonical_serving_indexes import build_explore_index


class CanonicalExploreServingTests(unittest.TestCase):
    def setUp(self):
        self._old_explore_path = server.CANONICAL_EXPLORE_INDEX_PATH
        self._old_trail_path = server.CANONICAL_TRAIL_INDEX_PATH
        self._old_explore_env = os.environ.get("TRAILHEAD_LOCAL_EXPLORE_INDEX_ENABLED")
        self._old_trail_env = os.environ.get("TRAILHEAD_LOCAL_TRAIL_INDEX_ENABLED")
        self._tmpdir = tempfile.TemporaryDirectory()
        root = Path(self._tmpdir.name)

        self.explore_path = root / "explore.candidate.json"
        self.explore_path.write_text(json.dumps({
            "generated_at": 1783152022,
            "items": [
                {
                    "id": "place:ridb:day-use",
                    "title": "Tar Camp Day Use and Dump Station",
                    "category": "campground",
                    "group": "camping",
                    "lat": 34.4497222,
                    "lng": -92.1125,
                    "description": "Day use area with a dump station.",
                    "verified": True,
                },
                {
                    "id": "place:ridb:cabin",
                    "title": "John Muir Cabin",
                    "category": "lodging",
                    "group": "lodging",
                    "lat": 58.4094444,
                    "lng": -134.6966667,
                    "description": "Rustic cabin reached by trail from Glacier Highway.",
                    "verified": True,
                },
                {
                    "id": "place:nps:moab-rim",
                    "title": "Moab Rim Trail",
                    "category": "trail",
                    "group": "trails",
                    "lat": 38.5491,
                    "lng": -109.5955,
                    "description": "Steep trail access near Moab with canyon views.",
                    "verified": True,
                },
                {
                    "id": "place:bad-copy",
                    "title": "Broken Copy",
                    "category": "park",
                    "group": "parks",
                    "lat": 38.5,
                    "lng": -109.5,
                    "description": "Imported raw API record from a database dump.",
                    "verified": True,
                },
                {
                    "id": "place:ridb:denali-entry",
                    "title": "Denali Park Road Timed Entry",
                    "category": "permit_required",
                    "group": "things",
                    "lat": 63.728443,
                    "lng": -148.886572,
                    "description": "Permit reservations are required for private vehicles past Mile 15.",
                    "verified": True,
                },
            ],
        }))

        self.trail_path = root / "trails.candidate.json"
        self.trail_path.write_text(json.dumps({
            "generated_at": 1783152023,
            "items": [
                {
                    "id": "trail:good",
                    "name": "Pine Ridge Trail",
                    "lat": 38.58,
                    "lng": -109.6,
                    "distance_mi": 4.2,
                    "difficulty": "Moderate",
                    "allowed_uses": "Hiking and mountain biking",
                    "activity": "Bike trail",
                    "source_label": "USFS",
                    "surface": "N/A",
                    "season_text": "",
                    "fact_labels": ["4.2 mi", "Moderate", "Bike trail"],
                    "route_shape": "Loop",
                    "geometry_ref": "trail:good",
                    "quality_score": 89,
                    "summary": "4.2 miles. Moderate. Hiking and mountain biking.",
                    "verified": True,
                    "review_only": False,
                },
                {
                    "id": "trail:weak",
                    "name": "17DC454",
                    "lat": 38.59,
                    "lng": -109.61,
                    "verified": True,
                    "review_only": True,
                },
                {
                    "id": "trail:tiny",
                    "name": "Tiny Loop Trail",
                    "lat": 38.6,
                    "lng": -109.62,
                    "distance_mi": 0.02,
                    "difficulty": "",
                    "surface": "",
                    "season_text": "",
                    "verified": True,
                    "review_only": False,
                },
            ],
        }))

        server.CANONICAL_EXPLORE_INDEX_PATH = self.explore_path
        server.CANONICAL_TRAIL_INDEX_PATH = self.trail_path
        server._canonical_explore_index_cache.update({"path": "", "mtime": 0.0, "items": [], "generated_at": 0})
        server._canonical_trail_index_cache.update({"path": "", "mtime": 0.0, "items": [], "generated_at": 0})
        os.environ["TRAILHEAD_LOCAL_EXPLORE_INDEX_ENABLED"] = "1"
        os.environ["TRAILHEAD_LOCAL_TRAIL_INDEX_ENABLED"] = "1"

    def tearDown(self):
        server.CANONICAL_EXPLORE_INDEX_PATH = self._old_explore_path
        server.CANONICAL_TRAIL_INDEX_PATH = self._old_trail_path
        server._canonical_explore_index_cache.update({"path": "", "mtime": 0.0, "items": [], "generated_at": 0})
        server._canonical_trail_index_cache.update({"path": "", "mtime": 0.0, "items": [], "generated_at": 0})
        if self._old_explore_env is None:
            os.environ.pop("TRAILHEAD_LOCAL_EXPLORE_INDEX_ENABLED", None)
        else:
            os.environ["TRAILHEAD_LOCAL_EXPLORE_INDEX_ENABLED"] = self._old_explore_env
        if self._old_trail_env is None:
            os.environ.pop("TRAILHEAD_LOCAL_TRAIL_INDEX_ENABLED", None)
        else:
            os.environ["TRAILHEAD_LOCAL_TRAIL_INDEX_ENABLED"] = self._old_trail_env
        self._tmpdir.cleanup()

    def test_generated_profiles_skip_bad_records_and_review_only_trails(self):
        profiles = server._canonical_serving_profiles(limit=20)
        titles = [profile["summary"]["title"] for profile in profiles]
        self.assertIn("John Muir Cabin", titles)
        self.assertIn("Moab Rim Trail", titles)
        self.assertIn("Pine Ridge Trail", titles)
        self.assertNotIn("Tar Camp Day Use and Dump Station", titles)
        self.assertNotIn("17DC454", titles)
        self.assertNotIn("Broken Copy", titles)
        self.assertNotRegex(json.dumps(profiles), r"\b(API|database dump|raw record|downloaded|imported|N/A)\b")
        pine = next(profile for profile in profiles if profile["summary"]["title"] == "Pine Ridge Trail")
        self.assertEqual(pine["trails"][0]["route_shape"], "Loop")
        self.assertEqual(pine["trails"][0]["geometry_ref"], "trail:good")
        self.assertEqual(pine["sources"][0]["title"], "US Forest Service")
        self.assertEqual(pine["trails"][0]["difficulty"], "Moderate")

    def test_bundled_official_trail_index_loads_when_processed_index_is_absent(self):
        server.CANONICAL_TRAIL_INDEX_PATH = Path(self._tmpdir.name) / "missing-trails.json"
        server._canonical_trail_index_cache.update({"path": "", "mtime": 0.0, "items": [], "generated_at": 0})

        items, generated_at = server._load_canonical_trail_index()

        self.assertGreater(len(items), 40000)
        self.assertGreater(generated_at, 0)
        self.assertTrue(all(not item.get("review_only") for item in items[:2000]))
        labels = {str(item.get("source_label") or "") for item in items[:2000]}
        self.assertTrue(labels.issubset({"USFS", "NPS", "Recreation.gov", "US Forest Service", "National Park Service"}))

    def test_exact_timed_entry_search_surfaces_permit_record(self):
        self.assertEqual(server._explore_category_hint_from_query("Denali Park Road Timed Entry"), "things")
        self.assertEqual(server._explore_category_hint_from_query("PCT"), "trail")
        profiles = server._canonical_serving_profiles(q="Denali Park Road Timed Entry", limit=5, include_trails=False)
        titles = [profile["summary"]["title"] for profile in profiles]
        self.assertIn("Denali Park Road Timed Entry", titles)
        denali = next(profile for profile in profiles if profile["summary"]["title"] == "Denali Park Road Timed Entry")
        self.assertEqual(denali["summary"]["explore_group"], "things")

    def test_explore_catalog_cache_uses_file_key_not_short_age(self):
        old_cache = dict(server._EXPLORE_CATALOG_CACHE)
        try:
            sentinel = {"schema_version": 1, "places": [{"id": "cached"}]}
            server._EXPLORE_CATALOG_CACHE.update({
                "key": server._explore_catalog_cache_key(),
                "loaded_at": 1,
                "catalog": sentinel,
            })
            self.assertIs(server._load_explore_catalog(), sentinel)
        finally:
            server._EXPLORE_CATALOG_CACHE.clear()
            server._EXPLORE_CATALOG_CACHE.update(old_cache)

    def test_explore_catalog_uses_runtime_disk_cache_when_source_key_matches(self):
        old_cache = dict(server._EXPLORE_CATALOG_CACHE)
        old_runtime_path = server.EXPLORE_RUNTIME_CACHE_PATH
        old_enabled = os.environ.get("TRAILHEAD_EXPLORE_RUNTIME_CACHE_ENABLED")
        try:
            runtime_path = Path(self._tmpdir.name) / "runtime-cache.json"
            server.EXPLORE_RUNTIME_CACHE_PATH = runtime_path
            os.environ["TRAILHEAD_EXPLORE_RUNTIME_CACHE_ENABLED"] = "1"
            cache_key = server._explore_catalog_cache_key()
            sentinel = {"schema_version": 91, "places": [{"id": "disk-cached"}]}
            runtime_path.write_text(json.dumps({
                "version": server.EXPLORE_RUNTIME_CACHE_VERSION,
                "source_key": server._explore_catalog_cache_key_json(cache_key),
                "catalog": sentinel,
            }))
            server._EXPLORE_CATALOG_CACHE.update({"key": None, "loaded_at": 0.0, "catalog": None})

            self.assertEqual(server._load_explore_catalog(), sentinel)
        finally:
            server.EXPLORE_RUNTIME_CACHE_PATH = old_runtime_path
            if old_enabled is None:
                os.environ.pop("TRAILHEAD_EXPLORE_RUNTIME_CACHE_ENABLED", None)
            else:
                os.environ["TRAILHEAD_EXPLORE_RUNTIME_CACHE_ENABLED"] = old_enabled
            server._EXPLORE_CATALOG_CACHE.clear()
            server._EXPLORE_CATALOG_CACHE.update(old_cache)

    def test_explore_runtime_disk_cache_rejects_stale_source_key(self):
        old_runtime_path = server.EXPLORE_RUNTIME_CACHE_PATH
        old_enabled = os.environ.get("TRAILHEAD_EXPLORE_RUNTIME_CACHE_ENABLED")
        try:
            runtime_path = Path(self._tmpdir.name) / "runtime-cache-stale.json"
            server.EXPLORE_RUNTIME_CACHE_PATH = runtime_path
            os.environ["TRAILHEAD_EXPLORE_RUNTIME_CACHE_ENABLED"] = "1"
            runtime_path.write_text(json.dumps({
                "version": server.EXPLORE_RUNTIME_CACHE_VERSION,
                "source_key": [["stale", 0, 0]],
                "catalog": {"schema_version": 91, "places": [{"id": "stale"}]},
            }))

            self.assertIsNone(server._load_explore_catalog_disk_cache(server._explore_catalog_cache_key()))
        finally:
            server.EXPLORE_RUNTIME_CACHE_PATH = old_runtime_path
            if old_enabled is None:
                os.environ.pop("TRAILHEAD_EXPLORE_RUNTIME_CACHE_ENABLED", None)
            else:
                os.environ["TRAILHEAD_EXPLORE_RUNTIME_CACHE_ENABLED"] = old_enabled

    def test_runtime_cache_does_not_persist_fixture_catalogs_to_default_path(self):
        old_catalog = server.EXPLORE_CATALOG
        old_catalog_v3 = server.EXPLORE_CATALOG_V3
        old_runtime_path = server.EXPLORE_RUNTIME_CACHE_PATH
        old_runtime_env = os.environ.get("TRAILHEAD_EXPLORE_RUNTIME_CACHE")
        try:
            root = Path(self._tmpdir.name)
            server.EXPLORE_CATALOG = root / "fixture-explore.json"
            server.EXPLORE_CATALOG_V3 = root / "fixture-explore-v3.json"
            server.EXPLORE_RUNTIME_CACHE_PATH = root / "default-runtime-cache.json"
            os.environ.pop("TRAILHEAD_EXPLORE_RUNTIME_CACHE", None)
            catalog = {"places": [{"id": f"fixture-{idx}"} for idx in range(60)]}

            server._write_explore_catalog_disk_cache(server._explore_catalog_cache_key(), catalog)

            self.assertFalse(server.EXPLORE_RUNTIME_CACHE_PATH.exists())
        finally:
            server.EXPLORE_CATALOG = old_catalog
            server.EXPLORE_CATALOG_V3 = old_catalog_v3
            server.EXPLORE_RUNTIME_CACHE_PATH = old_runtime_path
            if old_runtime_env is None:
                os.environ.pop("TRAILHEAD_EXPLORE_RUNTIME_CACHE", None)
            else:
                os.environ["TRAILHEAD_EXPLORE_RUNTIME_CACHE"] = old_runtime_env

    def test_generated_detail_lookup_reaches_deep_ids(self):
        profile = server._canonical_serving_profile_by_id("trail:good")
        self.assertIsNotNone(profile)
        self.assertEqual(profile["summary"]["title"], "Pine Ridge Trail")
        self.assertEqual(profile["summary"]["category"], "Trail")
        self.assertEqual(profile["card"]["facts"], ["4.2 mi", "Moderate", "Bike trail"])
        self.assertEqual(profile["facts"]["distance"], "4.2 mi")
        self.assertEqual(profile["facts"]["activity"], "Bike trail")
        self.assertEqual(profile["trails"][0]["route_type"], "Bike trail")
        self.assertEqual(profile["quality_score"], 89)

    def test_generated_trail_detail_keeps_distance_after_nearby_pack(self):
        profile = server._canonical_serving_profile_by_id("trail:good")
        self.assertIsNotNone(profile)
        enriched = server._attach_official_nearby_source_pack(profile)
        self.assertEqual(enriched["summary"]["short_description"], "4.2 miles. Moderate. Hiking and mountain biking.")
        self.assertEqual(enriched["card"]["summary"], "4.2 miles. Moderate. Hiking and mountain biking.")
        self.assertNotIn("near the area", json.dumps(enriched).lower())

    def test_generated_trail_detail_omits_tiny_zero_distance(self):
        profile = server._canonical_serving_profile_by_id("trail:tiny")
        self.assertIsNotNone(profile)
        text = json.dumps(profile)
        self.assertNotIn("0.0 mile", text)
        self.assertEqual(profile["summary"]["short_description"], "Trail route. Check route conditions and access before you go.")

    def test_query_sort_demotes_coordinate_less_trail_cards(self):
        query_terms = server._explore_query_terms_for_category("Moab trails", "")
        coordinate_less = {
            "id": "trail:usfs:no-point",
            "summary": {
                "title": "Moab",
                "category": "Trail",
                "explore_group": "trails",
                "rank": 1,
                "short_description": "0.4 mile trail.",
            },
            "category": "Trail",
            "search_blob": "moab trail",
        }
        located = {
            "id": "place:ridb:moab-brands",
            "summary": {
                "title": "Moab Brands Trailhead",
                "category": "Trailhead",
                "explore_group": "trails",
                "rank": 10,
                "lat": 38.65127,
                "lng": -109.66798,
                "short_description": "Trail access just north of Moab.",
            },
            "category": "Trailhead",
            "search_blob": "moab brands trailhead trails",
        }

        ordered = sorted([coordinate_less, located], key=lambda place: server._explore_query_sort_key(place, query_terms))
        self.assertEqual(ordered[0]["id"], "place:ridb:moab-brands")

    def test_query_terms_match_simple_plural_trail_searches(self):
        query_terms = server._explore_query_terms_for_category("Moab trails", "")
        profile = {
            "id": "place:ridb:moab-brands",
            "summary": {
                "title": "Moab Brands Trailhead",
                "category": "Trailhead",
                "short_description": "Trail access just north of Moab.",
            },
            "category": "Trailhead",
            "search_blob": "moab brands trailhead",
        }
        raw_trail = {
            "id": "trail:usfs:moab-rim",
            "name": "Moab Rim Trail",
            "activity": "Hiking trail",
            "summary": "Trail route above Moab.",
        }

        self.assertTrue(server._explore_query_terms_match(profile, query_terms))
        self.assertTrue(server._canonical_raw_item_matches_query(raw_trail, query_terms, trail=True))

    def test_category_filters_do_not_pull_day_use_or_trails_into_camps(self):
        self.assertFalse(server._explore_place_matches_category_request({
            "category": "campground",
            "summary": {
                "title": "Tar Camp Day Use and Dump Station",
                "category": "Campground",
                "explore_group": "camping",
            },
            "subcategories": ["campground"],
        }, {"camp"}))
        trail_named = {
            "title": "Hidden Valley Trail",
            "category": "campground",
            "group": "camping",
        }
        self.assertEqual(server._canonical_explore_category(trail_named), "trail")
        self.assertFalse(server._canonical_raw_item_matches_category(trail_named, {"camp"}))
        self.assertTrue(server._canonical_raw_item_matches_category(trail_named, {"trail"}))

    def test_builder_normalizes_explore_candidates_before_serving(self):
        raw_path = Path(self._tmpdir.name) / "raw-explore.json"
        raw_path.write_text(json.dumps({
            "places": [
                {
                    "id": "raw:day-use",
                    "category": "rv_park",
                    "summary": {
                        "title": "Moab Day Use Sites",
                        "category": "RV Park",
                        "explore_group": "rv_park",
                        "lat": 38.60467,
                        "lng": -109.55849,
                        "short_description": "Day use and dump station.",
                    },
                },
                {
                    "id": "raw:cabin",
                    "category": "rv_park",
                    "summary": {
                        "title": "John Muir Cabin",
                        "category": "RV Park",
                        "explore_group": "rv_park",
                        "lat": 58.4094444,
                        "lng": -134.6966667,
                        "short_description": "Rustic cabin reached by trail.",
                    },
                },
                {
                    "id": "raw:glamping",
                    "category": "rv_park",
                    "summary": {
                        "title": "Lake Powhatan",
                        "category": "RV Park",
                        "explore_group": "rv_park",
                        "lat": 35.4891,
                        "lng": -82.6344,
                        "short_description": "Overview Glamping sites are now available at Lake Powhatan! Experience nature and outdoor recreation without sacrificing the comforts and luxuries of home. To book your glamping site,",
                    },
                },
                {
                    "id": "raw:trail",
                    "category": "campground",
                    "summary": {
                        "title": "Hidden Valley Trail",
                        "category": "Campground",
                        "explore_group": "camping",
                        "lat": 38.531811,
                        "lng": -109.517292,
                        "short_description": "The Hidden Valley Trail is a strenuous hike above the valley floor of Moab, Utah.",
                    },
                },
            ],
        }))
        payload = build_explore_index(raw_path)
        by_title = {item["title"]: item for item in payload["items"]}
        titles = list(by_title)
        self.assertNotIn("Moab Day Use Sites", titles)
        self.assertEqual(by_title["John Muir Cabin"]["category"], "lodging")
        self.assertEqual(by_title["Lake Powhatan"]["category"], "campground")
        self.assertEqual(by_title["Hidden Valley Trail"]["category"], "trail")
        self.assertFalse(by_title["Lake Powhatan"]["description"].lower().startswith("overview"))
        self.assertTrue(by_title["Lake Powhatan"]["description"].endswith(("!", ".", "?")))

    def test_official_cache_skips_non_camp_rv_venues(self):
        self.assertTrue(server._official_cache_skip_camp_profile(
            {"category": "rv_park", "subcategory": ""},
            "West Potomac Park Softball Fields",
            "campground",
            "Reservable athletic field.",
        ))
        self.assertFalse(server._official_cache_skip_camp_profile(
            {"category": "rv_park", "subcategory": ""},
            "Brandy Creek RV",
            "rv_park",
            "RV sites near the marina.",
        ))

    def test_official_cache_camp_profile_uses_compact_card_copy(self):
        profile = server._official_cache_profile_from_row({
            "id": "place:ridb:266144",
            "canonical_name": "Sand Flats Recreation Area Group Campsites",
            "category": "campground",
            "managing_agency": "Recreation.gov",
            "summary": (
                "Along with easy access to biking and off-highway vehicle trails, Sand Flats' campgrounds offer "
                "spectacular vistas of sandstone domes, canyons, and mesas in addition to the ever-changing "
                "La Sal Mountains as a dramatic back-drop. Visitors are awed by beautiful sunsets. Recreation "
                "The Sand Flats Recreation Area is home to the Slickrock Bike Trail."
            ),
            "geom": json.dumps({"type": "Point", "coordinates": [-109.5270972, 38.5676972]}),
        }, "place")
        self.assertIsNotNone(profile)
        text = profile["summary"]["short_description"]
        self.assertIn("backdrop", text)
        self.assertNotIn("back-drop", text)
        self.assertNotIn("Recreation The", text)
        self.assertLessEqual(len(text), 260)

    def test_official_cache_trail_profile_omits_tiny_zero_distance(self):
        profile = server._official_cache_profile_from_row({
            "id": "trail:tiny-official",
            "name": "Tiny Loop Trail",
            "distance_m": 20,
            "managing_agency": "USFS",
            "start_geom": json.dumps({"type": "Point", "coordinates": [-109.62, 38.6]}),
        }, "trail")
        self.assertIsNotNone(profile)
        self.assertNotIn("0.0 mile", json.dumps(profile))
        self.assertEqual(profile["summary"]["short_description"], "Tiny Loop Trail is a trail area. Check route conditions, daylight, permits, and closures before you go.")


if __name__ == "__main__":
    unittest.main()
