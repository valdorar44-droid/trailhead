import json
import unittest
import tempfile
from pathlib import Path

import dashboard.server as server
from db import store
from ingestors import osm
from ingestors.pakistan_curated import get_pakistan_curated_treks
from scripts import promote_nps_child_explore_places as promote_nps_children


class TrailCatalogTests(unittest.TestCase):
    def test_explore_v3_place_converts_to_profile_shape(self):
        profile = server._explore_v3_place_to_profile({
            "id": "place:wikidata:Q805806",
            "source_ids": ["wikidata:Q805806"],
            "name": "Baltoro Glacier",
            "category": "glacier",
            "subcategories": ["glacier"],
            "lat": 35.7364,
            "lng": 76.3808,
            "region": "Gilgit-Baltistan",
            "summary": "Glacier in the Karakoram range.",
            "description": "Baltoro Glacier is a major Karakoram glacier.",
            "tags": ["glacier", "karakoram"],
            "search_aliases": ["ice", "trek"],
            "canonical_role": "child",
            "parent_hub_id": "place:nps:k2",
            "parent_hub_title": "K2 National Park",
            "module_target": "see",
            "quality": "open_community_data",
            "quality_score": 72,
            "media": [{"url": "https://example.test/baltoro.jpg", "credit": "Commons"}],
            "sources": [{
                "source": "wikidata",
                "title": "Baltoro Glacier",
                "publisher": "Wikidata",
                "url": "https://www.wikidata.org/wiki/Q805806",
                "license": "CC0",
                "attribution": "Wikidata contributors",
            }],
            "card": {"headline": "Baltoro Glacier", "summary": "Karakoram glacier route context."},
        }, rank=700001)

        self.assertEqual(profile["summary"]["title"], "Baltoro Glacier")
        self.assertEqual(profile["summary"]["category"], "Glacier")
        self.assertEqual(profile["summary"]["explore_group"], "water")
        self.assertEqual(profile["category"], "glacier")
        self.assertEqual(profile["source_pack"]["quality"], "open")
        self.assertEqual(profile["source_pack"]["official_url"], "https://www.wikidata.org/wiki/Q805806")
        self.assertEqual(profile["facts"]["source_quality"], "open")
        self.assertEqual(profile["media"][0]["url"], "https://example.test/baltoro.jpg")
        self.assertIn("trek", profile["search_aliases"])
        self.assertEqual(profile["canonical_role"], "child")
        self.assertEqual(profile["parent_hub_id"], "place:nps:k2")
        self.assertEqual(profile["parent_hub_title"], "K2 National Park")
        self.assertEqual(profile["module_target"], "see")

    def test_load_explore_catalog_merges_v3_sidecar(self):
        old_catalog = server.EXPLORE_CATALOG
        old_catalog_v3 = server.EXPLORE_CATALOG_V3
        old_overrides = server.get_explore_story_overrides
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                server.EXPLORE_CATALOG = tmp_path / "explore_catalog_v1.json"
                server.EXPLORE_CATALOG_V3 = tmp_path / "explore_catalog_v3.json"
                server.get_explore_story_overrides = lambda: {}
                server.EXPLORE_CATALOG.write_text(json.dumps({
                    "schema_version": 1,
                    "catalog_id": "test-v1",
                    "source": "test",
                    "places": [{
                        "id": "explore:test",
                        "summary": {"title": "Featured Stop", "rank": 1, "lat": 1.0, "lng": 2.0},
                        "profile": {"hook": "Featured", "summary": "Featured stop."},
                    }],
                }))
                server.EXPLORE_CATALOG_V3.write_text(json.dumps({
                    "schema_version": 3,
                    "places": [{
                        "id": "place:nps:yose",
                        "name": "Yosemite National Park",
                        "category": "park",
                        "lat": 37.85,
                        "lng": -119.56,
                        "region": "CA",
                        "summary": "Granite, waterfalls, and high Sierra trails.",
                        "sources": [{"source": "nps", "title": "NPS", "url": "https://www.nps.gov/yose/"}],
                        "quality": "official_source",
                    }],
                }))

                catalog = server._load_explore_catalog()

            place_ids = {place["id"] for place in catalog["places"]}
            self.assertIn("explore:test", place_ids)
            self.assertIn("place:nps:yose", place_ids)
            self.assertEqual(catalog["count"], 2)
            self.assertEqual(catalog["catalog_id"], "explore-us-top-v1-plus-real-data-v3")
        finally:
            server.EXPLORE_CATALOG = old_catalog
            server.EXPLORE_CATALOG_V3 = old_catalog_v3
            server.get_explore_story_overrides = old_overrides

    def test_explore_place_index_item_includes_v3_fields(self):
        profile = server._explore_v3_place_to_profile({
            "id": "place:osm:waterfall",
            "source_ids": ["osm:node/1"],
            "name": "Vernal Fall",
            "category": "waterfall",
            "subcategories": ["waterfall"],
            "lat": 37.7275,
            "lng": -119.5438,
            "summary": "Mapped waterfall.",
            "search_aliases": ["falls"],
            "search_blob": "vernal fall waterfall yosemite",
            "canonical_role": "child",
            "parent_hub_id": "place:nps:yose",
            "parent_hub_title": "Yosemite National Park",
            "module_target": "see",
            "media": [{"url": "https://example.test/fall.jpg"}],
            "sources": [{"source": "osm", "title": "OpenStreetMap", "url": "https://www.openstreetmap.org/node/1"}],
        })

        item = server._explore_place_index_item(profile)

        self.assertEqual(item["id"], "place:osm:waterfall")
        self.assertEqual(item["v3_category"], "waterfall")
        self.assertEqual(item["subcategories"], ["waterfall"])
        self.assertEqual(item["search_aliases"], ["falls"])
        self.assertEqual(item["media"][0]["url"], "https://example.test/fall.jpg")
        self.assertEqual(item["sources"][0]["title"], "OpenStreetMap")
        self.assertEqual(item["canonical_role"], "child")
        self.assertEqual(item["parent_hub_id"], "place:nps:yose")
        self.assertEqual(item["parent_hub_title"], "Yosemite National Park")
        self.assertEqual(item["module_target"], "see")

    def test_nps_child_promotion_adds_canonical_hub_metadata(self):
        place = promote_nps_children.place_from_child(
            {
                "parkCode": "yose",
                "fullName": "Yosemite National Park",
                "states": "CA",
                "url": "https://www.nps.gov/yose/",
            },
            "campgrounds",
            {
                "id": "camp-1",
                "name": "Upper Pines Campground",
                "description": "A well-known campground in Yosemite Valley with seasonal access and official park information.",
                "latitude": "37.742",
                "longitude": "-119.565",
            },
            123,
        )

        self.assertIsNotNone(place)
        assert place is not None
        self.assertEqual(place["canonical_role"], "child")
        self.assertEqual(place["parent_hub_id"], "place:nps:yose")
        self.assertEqual(place["parent_hub_title"], "Yosemite National Park")
        self.assertEqual(place["module_target"], "stay")
        self.assertIn("stay", place["search_blob"])

    def test_explore_category_request_matches_v3_direct_categories(self):
        glacier = server._explore_v3_place_to_profile({
            "id": "place:wikidata:glacier",
            "name": "Baltoro Glacier",
            "category": "glacier",
            "subcategories": ["glacier"],
            "lat": 35.7364,
            "lng": 76.3808,
            "summary": "Mapped glacier.",
        })
        waterfall = server._explore_v3_place_to_profile({
            "id": "place:osm:waterfall",
            "name": "Vernal Fall",
            "category": "waterfall",
            "subcategories": ["waterfall"],
            "lat": 37.7275,
            "lng": -119.5438,
            "summary": "Mapped waterfall.",
        })

        self.assertTrue(server._explore_place_matches_category_request(glacier, {"glacier"}))
        self.assertTrue(server._explore_place_matches_category_request(waterfall, {"waterfalls"}))
        self.assertFalse(server._explore_place_matches_category_request(glacier, {"fuel"}))

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
        self.assertTrue(public["preview_available"])
        self.assertEqual(public["preview_status"], "available")

    def test_trail_preview_manifest_requires_ordered_route_geometry(self):
        unavailable = server._trail_preview_manifest({
            "id": "osm:node:trailhead",
            "name": "Trailhead Only",
            "lat": 38.1,
            "lng": -109.5,
            "geometry": None,
            "activities": ["hiking"],
            "trailheads": [],
            "photos": [],
            "source": "osm",
            "source_label": "OpenStreetMap",
            "provenance": {},
            "last_checked": 1,
        })

        self.assertEqual(unavailable["status"], "unavailable")
        self.assertFalse(unavailable["preview_available"])
        self.assertIn("ordered Trailhead route geometry", unavailable["warnings"][0])

    def test_trail_preview_manifest_builds_keyframes_from_linestring(self):
        profile = {
            "id": "osm:way:preview",
            "name": "Preview Loop",
            "summary": "Open trail record.",
            "lat": 38.1,
            "lng": -109.5,
            "length_mi": 4.2,
            "difficulty": "Moderate",
            "activities": ["hiking"],
            "land_manager": "BLM",
            "geometry": {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-109.5, 38.1], [-109.51, 38.11], [-109.52, 38.115]]},
                    "properties": {},
                }],
            },
            "trailheads": [],
            "official_url": "",
            "photos": [],
            "source": "osm",
            "source_label": "OpenStreetMap",
            "provenance": {"catalog": {"geometry_ref": "osm:way:preview"}},
            "last_checked": 1,
        }

        manifest = server._trail_preview_manifest(profile)

        self.assertEqual(manifest["status"], "available")
        self.assertTrue(manifest["preview_available"])
        self.assertEqual(manifest["trail_id"], "osm:way:preview")
        self.assertEqual(manifest["coordinates"][0], [-109.5, 38.1])
        self.assertTrue(manifest["geometry_hash"].startswith("sha256:"))
        self.assertGreaterEqual(len(manifest["keyframes"]), 5)
        self.assertEqual(manifest["keyframes"][0]["progress"], 0.0)
        self.assertEqual(manifest["keyframes"][-1]["progress"], 1.0)

    def test_osm_way_trail_route_carries_geometry_into_profile(self):
        route = osm._normalize_trail_route({
            "type": "way",
            "id": 233584649,
            "tags": {"name": "Moab Rim Trail", "highway": "path"},
            "geometry": [
                {"lat": 38.55891, "lon": -109.58444},
                {"lat": 38.55980, "lon": -109.58560},
                {"lat": 38.56055, "lon": -109.58700},
            ],
        })

        self.assertIsNotNone(route)
        self.assertEqual(route["geometry"]["type"], "LineString")
        self.assertEqual(route["geometry"]["coordinates"][0], [-109.58444, 38.55891])
        self.assertGreater(route["length_mi"], 0)

        profile = server._trail_profile_from_open_poi(route)
        public = server._public_trail_profile(profile)
        manifest = server._trail_preview_manifest(profile)

        self.assertEqual(profile["geometry"]["features"][0]["geometry"]["type"], "LineString")
        self.assertTrue(public["preview_available"])
        self.assertEqual(manifest["status"], "available")
        self.assertEqual(manifest["trail_name"], "Moab Rim Trail")

    def test_osm_relation_trail_route_stitches_member_geometry(self):
        route = osm._normalize_trail_route({
            "type": "relation",
            "id": 9001,
            "tags": {"name": "Desert Loop", "route": "hiking"},
            "members": [
                {"type": "way", "ref": 1, "role": "", "geometry": [
                    {"lat": 38.0, "lon": -109.0},
                    {"lat": 38.001, "lon": -109.001},
                ]},
                {"type": "way", "ref": 2, "role": "", "geometry": [
                    {"lat": 38.002, "lon": -109.002},
                    {"lat": 38.001, "lon": -109.001},
                ]},
            ],
        })

        self.assertIsNotNone(route)
        self.assertEqual(route["geometry"]["type"], "LineString")
        self.assertEqual(route["geometry"]["coordinates"][0], [-109.0, 38.0])
        self.assertEqual(route["geometry"]["coordinates"][-1], [-109.002, 38.002])
        self.assertIsInstance(route["lat"], float)
        self.assertIsInstance(route["lng"], float)

    def test_osm_same_name_fragments_merge_and_sort_before_tiny_unnamed(self):
        named_a = osm._normalize_trail_route({
            "type": "way",
            "id": 100,
            "tags": {"name": "Mill Creek Parkway", "highway": "path"},
            "geometry": [
                {"lat": 38.5700, "lon": -109.5480},
                {"lat": 38.5710, "lon": -109.5490},
            ],
        })
        named_b = osm._normalize_trail_route({
            "type": "way",
            "id": 101,
            "tags": {"name": "Mill Creek Parkway", "highway": "path"},
            "geometry": [
                {"lat": 38.5710, "lon": -109.5490},
                {"lat": 38.5720, "lon": -109.5500},
            ],
        })
        tiny = osm._normalize_trail_route({
            "type": "way",
            "id": 102,
            "tags": {"highway": "path"},
            "geometry": [
                {"lat": 38.5700, "lon": -109.5400},
                {"lat": 38.5701, "lon": -109.5401},
            ],
        })

        merged = osm._merge_route_fragments([tiny, named_a, named_b])
        merged.sort(key=osm._route_sort_key)

        self.assertEqual(merged[0]["name"], "Mill Creek Parkway")
        self.assertEqual(merged[0]["merged_segments"], 2)
        self.assertGreater(merged[0]["length_mi"], tiny["length_mi"])
        self.assertEqual(merged[-1]["name"], "Mapped trail")

    def test_trail_profile_ranking_suppresses_tiny_generated_fragments(self):
        named = server._trail_profile_from_open_poi({
            "id": "osm_way_100",
            "name": "Moab Rim Trail",
            "type": "trail",
            "lat": 38.56,
            "lng": -109.58,
            "length_mi": 3.2,
            "geometry": {"type": "LineString", "coordinates": [[-109.58, 38.56], [-109.59, 38.57], [-109.6, 38.58]]},
            "url": "https://www.openstreetmap.org/way/100",
        })
        tiny = server._trail_profile_from_open_poi({
            "id": "osm_way_101",
            "name": "Mapped trail",
            "type": "trail",
            "lat": 38.5701,
            "lng": -109.548,
            "length_mi": 0.03,
            "geometry": {"type": "LineString", "coordinates": [[-109.548, 38.5701], [-109.5481, 38.5702]]},
            "url": "https://www.openstreetmap.org/way/101",
        })
        trailhead = server._trail_profile_from_open_poi({
            "id": "osm_trail_1",
            "name": "Moab Trailhead",
            "type": "trailhead",
            "lat": 38.57,
            "lng": -109.55,
        })

        ranked = server._rank_trail_profiles([tiny, trailhead, named], 38.57, -109.55, limit=2)

        self.assertEqual(ranked[0]["name"], "Moab Rim Trail")
        self.assertEqual(len(ranked), 2)
        self.assertNotIn("Mapped trail", [item["name"] for item in ranked])

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

    def test_pakistan_fallback_photos_cover_key_trek_and_glacier_cards(self):
        self.assertTrue(server._pakistan_trail_fallback_photos("K2 Base Camp Trek")[0]["url"].startswith("https://upload.wikimedia.org/"))
        self.assertIn("Baltoro", server._pakistan_trail_fallback_photos("Baltoro Glacier")[0]["caption"])
        self.assertIn("K2", server._pakistan_trail_fallback_photos("Godwin-Austen Glacier")[0]["caption"])

    def test_nearby_store_query_does_not_drop_exact_curated_match_before_sort(self):
        old_path = store.settings.db_path
        try:
            with tempfile.TemporaryDirectory() as tmp:
                store.settings.db_path = str(Path(tmp) / "trailhead-test.db")
                store.init_db()
                for idx in range(80):
                    store.upsert_trail_profile({
                        "id": f"osm:test:{idx}",
                        "name": f"Mapped trail {idx}",
                        "summary": "Farther OSM trail",
                        "description": "",
                        "lat": 35.30 + idx * 0.001,
                        "lng": 75.80 + idx * 0.001,
                        "length_mi": None,
                        "difficulty": "Scout first",
                        "activities": ["Hiking"],
                        "land_manager": "",
                        "geometry": None,
                        "trailheads": [],
                        "official_url": "",
                        "photos": [],
                        "source": "osm",
                        "source_label": "OpenStreetMap",
                        "provenance": {},
                        "last_checked": 1,
                    })
                store.upsert_trail_profile({
                    "id": "pk:trek:k2-base-camp-trek",
                    "name": "K2 Base Camp Trek",
                    "summary": "Exact curated trek",
                    "description": "",
                    "lat": 35.7455,
                    "lng": 76.5142,
                    "length_mi": 62,
                    "difficulty": "Expedition trek",
                    "activities": ["Trekking"],
                    "land_manager": "Gilgit-Baltistan / local authorities",
                    "geometry": None,
                    "trailheads": [],
                    "official_url": "https://visitgilgitbaltistan.gov.pk/",
                    "photos": [],
                    "source": "pakistan_karakoram_curated",
                    "source_label": "Trailhead mixed Pakistan sources",
                    "provenance": {},
                    "last_checked": 1,
                })

                rows = store.list_trail_profiles_near(35.7455, 76.5142, 80, limit=10)
                self.assertEqual(rows[0]["id"], "pk:trek:k2-base-camp-trek")
        finally:
            store.settings.db_path = old_path


if __name__ == "__main__":
    unittest.main()
