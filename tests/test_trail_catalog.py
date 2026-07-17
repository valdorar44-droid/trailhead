import json
import asyncio
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

import dashboard.server as server
from db import store
from ingestors import osm
from ingestors.pakistan_curated import get_pakistan_curated_treks
from scripts import promote_nps_child_explore_places as promote_nps_children


def _official_trailhead_profile(
    place_id: str,
    title: str,
    lat: float,
    lng: float,
    region: str,
    description: str,
    *,
    source: str,
    official_url: str = "",
) -> dict:
    return {
        "id": place_id,
        "category": "trailhead",
        "subcategories": ["trailhead", "trail"],
        "quality": "official",
        "verified": True,
        "search_aliases": [title, region],
        "summary": {
            "id": place_id,
            "title": title,
            "category": "Trailhead",
            "explore_group": "trails",
            "region": region,
            "lat": lat,
            "lng": lng,
            "rank": 760000,
            "hero_rank": 760000,
            "tags": ["Trailhead", "Trail"],
            "hook": title,
            "short_description": description,
            "source_title": source,
            "source_url": official_url,
        },
        "profile": {
            "hook": title,
            "summary": description,
            "access_notes": "Check current access before you go.",
        },
        "source_pack": {
            "quality": "official",
            "primary": source,
            "official_url": official_url,
            "sources": [
                {
                    "title": source,
                    "publisher": source,
                    "url": official_url,
                    "kind": "official",
                }
            ],
        },
        "facts": {
            "coordinates": f"{lat:.6f}, {lng:.6f}",
            "source_quality": "official",
        },
    }


MOAB_TRAILHEAD_FIXTURES = [
    _official_trailhead_profile(
        "place:ridb:257115",
        "Moab Brands Trailhead",
        38.651270,
        -109.667980,
        "Moab, Utah",
        "Trail access north of Moab for the Moab Brands trail system.",
        source="Recreation Information Database",
    ),
    _official_trailhead_profile(
        "place:ridb:257119",
        "Moab Rim Trailhead",
        38.558716,
        -109.583191,
        "Moab, Utah",
        "Trailhead for hiking or driving the difficult Moab Rim 4WD route.",
        source="Recreation Information Database",
    ),
]


YOSEMITE_TRAILHEAD_FIXTURES = [
    _official_trailhead_profile(
        "place:nps:places:b1b4a158-95ce-4526-ae28-5916d7af7547",
        "Lower Yosemite Fall Trailhead",
        37.746364,
        -119.596268,
        "Yosemite National Park, California",
        "Trailhead for the walk to the base of Lower Yosemite Fall.",
        source="National Park Service",
        official_url="https://www.nps.gov/places/000/lower-yosemite-fall-trailhead.htm",
    ),
    _official_trailhead_profile(
        "place:nps:places:07da404d-9d30-48b7-866d-eb5160fd74e3",
        "Upper Yosemite Fall Trailhead",
        37.742769,
        -119.603251,
        "Yosemite National Park, California",
        "Trailhead for the steep climb toward Upper Yosemite Fall.",
        source="National Park Service",
        official_url="https://www.nps.gov/places/000/upper-yosemite-fall-trailhead.htm",
    ),
]


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

    def test_explore_public_copy_repairs_clipped_trail_fallbacks(self):
        clipped = "3.0 mile trail. This stop is a park area. Check access, closures, permits, and."
        profile = server._explore_v3_place_to_profile({
            "id": "trail:usfs:2334484010602",
            "name": "Little Moab",
            "category": "trail",
            "subcategories": ["trail"],
            "lat": 39.1371295,
            "lng": -105.1042032,
            "region": "CO",
            "summary": clipped,
            "description": clipped,
            "card": {
                "headline": "Little Moab is a route-worthy trail or trek anchor in Colorado.",
                "summary": clipped,
                "highlight": clipped,
            },
        }, rank=700010)

        cleaned = server._clean_explore_public_labels(profile)
        item = server._explore_place_index_item(cleaned)
        visible_text = json.dumps({"profile": cleaned, "item": item})

        self.assertNotIn("This stop is a park area", visible_text)
        self.assertNotRegex(visible_text, r"\band\.")
        self.assertNotIn("anchor", visible_text.lower())
        self.assertIn("weather before you go", item["short_description"])

    def test_explore_public_copy_removes_broken_urls_and_unmatched_quotes(self):
        cleaned = server._explore_clean_public_copy(
            'Sites are available by reservation only. To make a reservation, online, use the Recreation. Visit www.recreation. John Muir called it "a glacier basin.',
            360,
        )
        self.assertNotIn("www.", cleaned)
        self.assertNotIn('"', cleaned)
        self.assertNotIn("reservation,.", cleaned)
        self.assertNotIn("use the Recreation", cleaned)
        self.assertIn("Reserve online before you go.", cleaned)

    def test_explore_public_copy_repairs_spaced_hyphen_words(self):
        cleaned = server._explore_clean_public_copy(
            "Rivers carve temple - like canyons in ancient limestone.",
            160,
        )

        self.assertEqual(cleaned, "Rivers carve temple-like canyons in ancient limestone.")
        self.assertNotIn(" - ", cleaned)

    def test_explore_public_copy_removes_route_detail_fallback(self):
        cleaned = server._explore_clean_public_copy(
            "Fins and Things OHV Route has route details to check before you go.",
            240,
        )
        self.assertEqual(cleaned, "Fins and Things OHV Route. Check current access, seasonal closures, and local rules before you go.")
        self.assertNotIn("route details", cleaned.lower())

    def test_explore_places_response_cleans_full_profile_copy(self):
        payload = asyncio.run(server.explore_places(q="Moab trails", category="trail", limit=8))
        visible = json.dumps([
            (item.get("summary") or {}).get("short_description") or ""
            for item in payload.get("places") or []
        ])
        self.assertNotIn("route details", visible.lower())
        self.assertTrue(all(
            (item.get("summary") or {}).get("short_description")
            for item in payload.get("places") or []
        ))

    def test_explore_places_response_repairs_clipped_campground_titles(self):
        payload = asyncio.run(server.explore_places(
            q="Big Pine Canyon Group Clyde Glacier",
            category="campground",
            limit=8,
        ))
        titles = [(item.get("summary") or {}).get("title") or "" for item in payload.get("places") or []]

        self.assertIn("Big Pine Canyon Group - Clyde Glacier Campground", titles)
        for title in titles:
            self.assertNotRegex(title, r"\b(?:Cam|Campgroun|Rec)$")

    def test_explore_query_category_hint_uses_requested_section_words(self):
        self.assertEqual(server._explore_category_hint_from_query("Moab trails"), "trail")
        self.assertEqual(server._explore_category_hint_from_query("Glacier campgrounds"), "campground")
        self.assertEqual(server._explore_query_terms_for_category("Glacier campgrounds", "campground"), ["glacier"])

    def test_guided_destination_search_query_resolves_to_real_nearby_trails(self):
        destination = server._explore_guided_destination_for_exact_query("Moab Utah")
        self.assertEqual(destination["id"], "guided:moab")

        payload = asyncio.run(server.explore_catalog_index(q="Moab Utah", category="trails", limit=8))
        titles = [item["title"] for item in payload["places"]]

        self.assertGreater(payload["count"], 0)
        self.assertIn("Hidden Valley Trail", titles)
        self.assertIn("Corona Arch Trail", titles)
        for item in payload["places"]:
            self.assertIn(item["category"], {"Trail", "Trailhead"})
            self.assertIsNotNone(item.get("lat"))
            self.assertIsNotNone(item.get("lng"))
            distance_m = server._haversine_m(38.5733, -109.5498, item["lat"], item["lng"])
            self.assertLessEqual(distance_m, 55 * 1609.344)

    def test_guided_destination_search_query_uses_exact_alias_and_destination_radius(self):
        destination = server._explore_guided_destination_for_exact_query("sedona ARIZONA")
        self.assertEqual(destination["id"], "guided:sedona")
        self.assertIsNone(server._explore_guided_destination_for_exact_query("weekend near Sedona Arizona"))

        payload = asyncio.run(server.explore_catalog_index(q="Sedona Arizona", category="trails", limit=8))

        self.assertGreater(payload["count"], 0)
        for item in payload["places"]:
            self.assertIn(item["category"], {"Trail", "Trailhead"})
            self.assertIsNotNone(item.get("lat"))
            self.assertIsNotNone(item.get("lng"))
            distance_m = server._haversine_m(34.8697, -111.761, item["lat"], item["lng"])
            self.assertLessEqual(distance_m, 35 * 1609.344)

    def test_explore_section_filters_reject_mislabeled_activity_and_ticket_records(self):
        self.assertFalse(server._explore_place_matches_category_request({
            "id": "place:nps-child:yose:thingstodo:ride-a-bike",
            "category": "trail",
            "subcategories": ["activity"],
            "summary": {
                "title": "Ride a Bike in Yosemite Valley",
                "category": "Trail",
                "explore_group": "trails",
            },
        }, {"trail"}))
        self.assertFalse(server._explore_place_matches_category_request({
            "id": "place:ridb:ticket",
            "category": "campground",
            "subcategories": ["campground", "camping"],
            "summary": {
                "title": "Glacier National Park Logan Pass Shuttle Tickets",
                "category": "Campground",
                "explore_group": "camping",
            },
        }, {"campground"}))
        self.assertFalse(server._explore_place_matches_category_request({
            "id": "explore:huts_lodging:many-glacier-hotel",
            "category": "huts_lodging",
            "subcategories": [],
            "summary": {
                "title": "Many Glacier Hotel",
                "category": "Lodging",
                "explore_group": "huts_lodging",
            },
        }, {"campground"}))
        for title in [
            "Park Glacier Climbing Route",
            "West Glacier River Access Boating Site",
            "Glacier Creek Sno-Park",
            "561-1 Near Glacier Creek Th",
        ]:
            self.assertFalse(server._explore_place_matches_category_request({
                "id": f"place:bad:{title}",
                "category": "campground",
                "subcategories": ["campground", "camping"],
                "summary": {
                    "title": title,
                    "category": "Campground",
                    "explore_group": "camping",
                    "short_description": f"{title} has overnight options around the area.",
                },
            }, {"campground"}))
        self.assertTrue(server._explore_place_matches_category_request({
            "id": "place:nps-child:glac:campgrounds:many-glacier-campground",
            "category": "campground",
            "subcategories": ["campground"],
            "summary": {
                "title": "Many Glacier Campground",
                "category": "Campground",
                "explore_group": "camping",
                "short_description": "The campground at Many Glacier is one of the most popular campgrounds in Glacier National Park.",
            },
        }, {"campground"}))

    def test_ranked_explore_dedupe_removes_nearby_same_title_cards(self):
        places = server._dedupe_ranked_explore_profiles([
            {"id": "a", "summary": {"title": "Little Moab", "lat": 39.1371295, "lng": -105.1042032}},
            {"id": "b", "summary": {"title": "Little Moab", "lat": 39.1372, "lng": -105.1043}},
            {"id": "c", "summary": {"title": "Little Moab", "lat": 38.57, "lng": -109.55}},
        ])
        self.assertEqual([place["id"] for place in places], ["a", "c"])

    def test_ranked_explore_dedupe_collapses_nearby_same_title_trails(self):
        places = server._dedupe_ranked_explore_profiles([
            {"id": "trail-a", "category": "trail", "summary": {"title": "Lolo Forks", "category": "Trail", "explore_group": "trails", "lat": 46.3687221, "lng": -115.684367}},
            {"id": "trail-b", "category": "trail", "summary": {"title": "Lolo Forks", "category": "Trail", "explore_group": "trails", "lat": 46.3915461, "lng": -115.6830299}},
            {"id": "trail-c", "category": "trail", "summary": {"title": "Lolo Forks Loop", "category": "Trail", "explore_group": "trails", "lat": 46.3915461, "lng": -115.6830299}},
        ])
        self.assertEqual([place["id"] for place in places], ["trail-a", "trail-c"])

    def test_explore_merge_uses_specific_category_from_duplicate(self):
        places = server._merge_explore_profile_lists([
            {
                "id": "place:ridb:249513",
                "category": "place",
                "summary": {
                    "title": "Lake Andrusia Boat Site",
                    "category": "Place",
                    "explore_group": "explore",
                    "lat": 47.5,
                    "lng": -94.7,
                },
            },
        ], [
            {
                "id": "place:ridb:249513",
                "category": "water",
                "summary": {
                    "title": "Lake Andrusia Boat Site",
                    "category": "Water",
                    "explore_group": "water",
                    "lat": 47.5,
                    "lng": -94.7,
                },
            },
        ])
        self.assertEqual(len(places), 1)
        self.assertEqual(places[0]["category"], "water")
        self.assertEqual(places[0]["summary"]["category"], "Water")
        self.assertEqual(places[0]["summary"]["explore_group"], "water")

    def test_moab_search_skips_far_little_moab_without_little_query(self):
        self.assertTrue(server._explore_skip_for_broad_search({
            "summary": {
                "title": "Little Moab",
                "category": "Trail",
                "lat": 39.1371295,
                "lng": -105.1042032,
            },
        }, ["moab"]))
        self.assertFalse(server._explore_skip_for_broad_search({
            "summary": {
                "title": "Little Moab",
                "category": "Trail",
                "lat": 38.57,
                "lng": -109.55,
            },
        }, ["moab"]))
        self.assertFalse(server._explore_skip_for_broad_search({
            "summary": {
                "title": "Little Moab",
                "category": "Trail",
                "lat": 39.1371295,
                "lng": -105.1042032,
            },
        }, ["little", "moab"]))

    def test_exact_title_search_keeps_short_official_place_cards(self):
        self.assertFalse(server._explore_skip_for_broad_search({
            "category": "activity",
            "summary": {
                "title": "Bear Gulch Nature Center",
                "category": "Things",
                "explore_group": "things",
                "short_description": "Bear Gulch Nature Center is an outdoor area. Check current access, closures, permits, and weather before you go.",
            },
        }, ["bear", "gulch", "nature", "center"]))

    def test_explore_query_prefix_does_not_stretch_destination_words(self):
        self.assertFalse(server._explore_token_matches_variant("switzer", "switzerland"))
        self.assertTrue(server._explore_token_matches_variant("yosemit", "yosemite"))

    def test_trail_title_query_keeps_singular_trail_term(self):
        self.assertEqual(server._explore_query_terms_for_category("Arch Trail", "trail"), ["arch", "trail"])
        self.assertEqual(server._explore_query_terms_for_category("Moab trails", "trail"), ["moab"])
        self.assertEqual(server._explore_query_terms_for_category("trail near Moab", "trail"), ["moab"])

    def test_explore_query_sort_prefers_exact_title_match(self):
        terms = server._explore_query_terms_for_category("Arch Trail", "trail")
        exact = {"id": "trail:exact", "category": "trail", "summary": {"title": "Arch Trail", "category": "Trail", "explore_group": "trails", "rank": 9999}}
        partial = {"id": "trail:partial", "category": "trail", "summary": {"title": "La Verkin Creek Trail to Kolob Arch", "category": "Trail", "explore_group": "trails", "rank": 1}}
        self.assertLess(server._explore_query_sort_key(exact, terms), server._explore_query_sort_key(partial, terms))

    def test_visual_trail_names_remain_discoverable_from_inferred_sections(self):
        self.assertTrue(server._canonical_raw_item_matches_category({
            "name": "Middle Falls Overlook",
            "summary": "Short trail access. Hiking trail.",
        }, {"waterfall"}, trail=True))
        self.assertFalse(server._canonical_raw_item_matches_category({
            "name": "Easy Connector",
            "summary": "Short trail access. Hiking trail.",
        }, {"waterfall"}, trail=True))

        payload = asyncio.run(server.explore_catalog_index(q="Middle Falls Overlook", limit=8))
        titles = [item["title"] for item in payload["places"]]
        descriptions = [item.get("short_description") or "" for item in payload["places"]]

        self.assertEqual(titles[:1], ["Middle Falls Overlook"])
        self.assertIn("Short trail access. Hiking trail.", descriptions)

        springs_payload = asyncio.run(server.explore_catalog_index(q="Springs Connector", category="springs", limit=8))
        springs_titles = [item["title"] for item in springs_payload["places"]]
        self.assertEqual(springs_titles[:1], ["Springs Connector"])

    def test_explore_places_moab_trails_filters_far_little_moab_matches(self):
        with patch.object(
            server,
            "_official_cache_search_profiles",
            return_value=MOAB_TRAILHEAD_FIXTURES,
        ):
            payload = asyncio.run(server.explore_places(q="Moab trails", category="trail", limit=12))
        titles = [(item.get("summary") or {}).get("title") or "" for item in payload.get("places") or []]

        self.assertNotIn("Little Moab", titles)
        self.assertNotIn("Moab", titles)
        self.assertNotIn("Moab Rim Trail", titles)
        self.assertIn("Moab Brands Trailhead", titles)
        self.assertEqual(len(titles), len(set(titles)))

    def test_explore_places_exact_trail_title_prefers_usable_location(self):
        self.assertIsNone(server._explore_guided_destination_for_exact_query("Moab Rim Trail"))
        with patch.object(
            server,
            "_official_cache_search_profiles",
            return_value=[MOAB_TRAILHEAD_FIXTURES[1]],
        ):
            payload = asyncio.run(server.explore_places(q="Moab Rim Trail", category="trail", limit=12))
        titles = [(item.get("summary") or {}).get("title") or "" for item in payload.get("places") or []]

        self.assertIn("Moab Rim Trailhead", titles)
        self.assertNotIn("Moab Rim Trail", titles)

    def test_explore_places_switzerland_trails_rejects_switzer_prefix_match(self):
        payload = asyncio.run(server.explore_places(q="Switzerland trails", category="trail", limit=12))
        titles = [(item.get("summary") or {}).get("title") or "" for item in payload.get("places") or []]

        self.assertNotIn("Trosi - Switzer", titles)

    def test_global_seed_surfaces_clean_international_trail_searches(self):
        payload = asyncio.run(server.explore_catalog_index(q="Swiss Alps trails", category="trail", limit=12))
        titles = [item["title"] for item in payload["places"]]

        self.assertGreater(payload["count"], 0)
        self.assertTrue(any("Switzer" not in title for title in titles))
        visible = " ".join(
            " ".join(str(item.get(key) or "") for key in ("title", "category", "region", "hook", "short_description", "source_title"))
            for item in payload["places"]
        )
        self.assertIn("Switzerland", visible)
        self.assertNotRegex(visible, r"\b(API|database|download|undefined|null|0 results|source-backed|Open global|Wikidata)\b")

    def test_empty_category_search_does_not_relax_requested_category(self):
        payload = asyncio.run(server.explore_catalog_index(q="Dolomites trails", category="trail", limit=8))
        titles = [item["title"] for item in payload["places"]]

        self.assertNotIn("World Heritage Dolomites", titles)
        self.assertTrue(all(server._explore_place_matches_category_request(item, {"trail"}) for item in payload["places"]))

        old_loader = server._load_explore_catalog
        server._load_explore_catalog = lambda: {
            "places": [
                {
                    "id": "trail:dolomites-ridge",
                    "category": "trail",
                    "summary": {"title": "Dolomites Ridge Trail", "category": "Trail", "explore_group": "trails", "rank": 1, "lat": 46.54, "lng": 11.86},
                },
                {
                    "id": "park:dolomites",
                    "category": "park",
                    "summary": {"title": "Dolomites National Park", "category": "Park", "explore_group": "parks", "rank": 2, "lat": 46.55, "lng": 11.87},
                },
            ],
        }
        try:
            relaxed = server._explore_relaxed_destination_profiles(q="Dolomites trails", category="trail", limit=8)
        finally:
            server._load_explore_catalog = old_loader

        self.assertEqual([place["id"] for place in relaxed], ["trail:dolomites-ridge"])

    def test_global_seed_scenic_search_uses_clean_public_labels(self):
        payload = asyncio.run(server.explore_places(q="Norway scenic", category="viewpoint", limit=8))
        titles = [(item.get("summary") or {}).get("title") or "" for item in payload.get("places") or []]

        self.assertGreater(payload["count"], 0)
        self.assertTrue(any("National Park" in title for title in titles))
        visible = " ".join(
            " ".join(str((item.get("summary") or {}).get(key) or "") for key in ("title", "category", "region", "hook", "short_description", "source_title"))
            for item in payload.get("places") or []
        )
        self.assertNotRegex(visible, r"\b(API|database|download|undefined|null|0 results|source-backed|Open global|Wikidata)\b")

    def test_explore_trail_index_keeps_public_tags_clean(self):
        payload = asyncio.run(server.explore_catalog_index(q="Yosemite trails", category="trail", limit=12))
        visible_tags = [
            str(tag)
            for item in payload.get("places") or []
            for tag in item.get("tags") or []
        ]

        self.assertGreater(len(visible_tags), 0)
        self.assertNotRegex(" ".join(visible_tags), r"\b(nps|official|place|yose|grca|api|database|download|source)\b")

    def test_explore_trail_index_prioritizes_true_trail_cards(self):
        payload = asyncio.run(server.explore_catalog_index(q="Grand Canyon trails", category="trail", limit=8))
        titles = [item["title"] for item in payload["places"]]

        self.assertIn("Bright Angel Trailhead", titles)
        self.assertIn("Havasu Falls", titles)
        self.assertLess(titles.index("Bright Angel Trailhead"), titles.index("Havasu Falls"))

    def test_explore_city_trail_fallback_stays_near_destination(self):
        payload = asyncio.run(server.explore_catalog_index(q="Sedona trails", category="trail", limit=8))
        titles = [item["title"] for item in payload["places"]]

        self.assertGreater(payload["count"], 0)
        self.assertNotIn("Tusayan Mountain Bike", titles[:6])
        self.assertNotIn("Beale Wagon Road", titles[:6])
        self.assertNotRegex(" ".join(titles), r"\bMountain\. Bike\b")

    def test_explore_trail_fallback_prefers_nearby_catalog_trailheads(self):
        with patch.object(
            server,
            "_official_cache_search_profiles",
            return_value=YOSEMITE_TRAILHEAD_FIXTURES,
        ):
            payload = asyncio.run(server.explore_catalog_index(q="Yosemite trails", category="trail", limit=12))
        titles = [item["title"] for item in payload["places"]]
        visible = " ".join(
            " ".join(str(item.get(key) or "") for key in ("title", "category", "region", "short_description"))
            for item in payload["places"]
        )

        self.assertIn("Lower Yosemite Fall Trailhead", titles[:8])
        self.assertIn("Upper Yosemite Fall Trailhead", titles[:8])
        if "Long Valley Creek Route" in titles:
            self.assertLess(titles.index("Lower Yosemite Fall Trailhead"), titles.index("Long Valley Creek Route"))
        self.assertNotRegex(visible, r"\b(bus stop|shuttle stop|steakhouse|restaurant|cafe|bookstore|visitor center|Mountain\. Bike)\b")

    def test_explore_public_copy_repairs_generic_outdoor_area_fallback(self):
        cleaned = server._explore_clean_public_copy(
            "0.4 mile trail. This stop is an outdoor area. Check access, closures, permits.",
            240,
        )
        duplicated_condition = server._explore_clean_public_copy(
            "Check current access, closures, permits, and trail conditions before you go., and weather before you go.",
            240,
        )

        self.assertEqual(cleaned, "0.4 mile trail. Check current access, closures, permits, and trail conditions before you go.")
        self.assertEqual(duplicated_condition, "Check current access, closures, permits, trail conditions, and weather before you go.")
        self.assertNotIn("This stop is an outdoor area", cleaned)

    def test_explore_public_copy_removes_agency_as_place_fallback(self):
        samples = [
            "Big Bend National Park is a managed outdoor area near National Park Service. Check official access, fees, closures, permits, weather, and nearby services before committing dates.",
            "Bienville National Forest is a managed outdoor area near US Forest Service. Check official access, fees, closures, permits, weather, and nearby services before committing dates.",
            "Big Bend National Park is a managed outdoor area near Recreation.gov. Check official access, fees, closures, permits, weather, and nearby services before committing dates.",
            "This stop is a managed outdoor area near Bureau of Land Management. Check official access, fees, closures, permits, weather, and nearby services before committing dates.",
        ]

        for sample in samples:
            with self.subTest(sample=sample):
                cleaned = server._explore_clean_public_copy(sample, 360)
                self.assertNotIn("managed outdoor area", cleaned)
                self.assertNotIn("near National Park Service", cleaned)
                self.assertNotIn("near US Forest Service", cleaned)
                self.assertNotIn("near Recreation.gov", cleaned)
                self.assertNotIn("near Bureau of Land Management", cleaned)
                self.assertNotIn("Check official access", cleaned)
                self.assertIn("before you go", cleaned)

    def test_explore_detail_keeps_catalog_media_when_serving_profile_is_first(self):
        profile = asyncio.run(server.explore_place_detail("place:nps:bibe"))
        summary = profile.get("summary") or {}
        source_pack = profile.get("source_pack") or {}
        photos = source_pack.get("photos") if isinstance(source_pack, dict) else []

        self.assertEqual(summary.get("title"), "Big Bend National Park")
        self.assertIn("nps.gov/common/uploads", summary.get("image_url") or summary.get("thumbnail_url") or "")
        self.assertTrue(any("nps.gov/common/uploads" in str(photo.get("url") or "") for photo in photos if isinstance(photo, dict)))

    def test_legacy_explore_area_wrappers_resolve_to_parent_hubs(self):
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
                    "places": [
                        {
                            "id": "explore:camping:glacier-campgrounds",
                            "summary": {
                                "title": "Glacier Campgrounds",
                                "category": "Camping",
                                "explore_group": "camping",
                                "state": "MT",
                                "rank": 1,
                                "source_url": "https://www.nps.gov/glac/index.htm",
                            },
                            "profile": {"summary": "Legacy campground wrapper."},
                            "source_pack": {"primary": "Wikipedia"},
                        },
                        {
                            "id": "explore:parks:glacier-national-park",
                            "summary": {
                                "title": "Glacier National Park",
                                "category": "Parks",
                                "explore_group": "parks",
                                "state": "MT",
                                "rank": 2,
                            },
                            "profile": {"summary": "Official park hub."},
                            "source_pack": {"primary": "National Park Service"},
                        },
                    ],
                }))
                server.EXPLORE_CATALOG_V3.write_text(json.dumps({"schema_version": 3, "places": []}))

                catalog = server._load_explore_catalog()

            wrapper = next(place for place in catalog["places"] if place["id"] == "explore:camping:glacier-campgrounds")
            hub = next(place for place in catalog["places"] if place["id"] == "explore:parks:glacier-national-park")
            index_item = server._explore_place_index_item(wrapper)

            self.assertEqual(wrapper["canonical_role"], "child")
            self.assertEqual(wrapper["parent_hub_id"], "explore:parks:glacier-national-park")
            self.assertEqual(wrapper["parent_hub_title"], "Glacier National Park")
            self.assertEqual(wrapper["module_target"], "stay")
            self.assertTrue(wrapper["hidden_from_featured"])
            self.assertTrue(index_item["hidden_from_featured"])
            self.assertIn("Glacier Campgrounds", hub["search_blob"])
        finally:
            server.EXPLORE_CATALOG = old_catalog
            server.EXPLORE_CATALOG_V3 = old_catalog_v3
            server.get_explore_story_overrides = old_overrides

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

    def test_generated_official_trail_detail_and_preview_use_official_cache(self):
        old_official_db = server.OFFICIAL_DATA_DB
        try:
            with tempfile.TemporaryDirectory() as tmp:
                db_path = Path(tmp) / "official.sqlite"
                import sqlite3
                db = sqlite3.connect(db_path)
                db.execute("""
                    CREATE TABLE trail (
                        id TEXT PRIMARY KEY,
                        name TEXT,
                        slug TEXT,
                        land_unit_id TEXT,
                        managing_agency TEXT,
                        route_geom TEXT,
                        start_geom TEXT,
                        distance_m REAL,
                        elevation_gain_m REAL,
                        difficulty TEXT,
                        allowed_uses TEXT,
                        surface TEXT,
                        season_text TEXT,
                        quality_score REAL,
                        source_confidence REAL,
                        attribution_text TEXT,
                        last_verified_at INTEGER
                    )
                """)
                route_geom = {
                    "coordinates": [[
                        [-109.5, 38.1],
                        [-109.51, 38.11],
                        [-109.52, 38.12],
                        [-109.5, 38.1],
                    ]]
                }
                db.execute(
                    """INSERT INTO trail (
                        id, name, managing_agency, route_geom, start_geom, distance_m,
                        elevation_gain_m, difficulty, allowed_uses, surface, season_text,
                        quality_score, source_confidence, attribution_text, last_verified_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        "trail:usfs:test-loop",
                        "PCT: METHOW VALLEY N. TERMINUS",
                        "USFS",
                        json.dumps(route_geom),
                        json.dumps({"type": "Point", "coordinates": [-109.5, 38.1]}),
                        4200,
                        180,
                        "3",
                        "Hiking",
                        "NATIVE MATERIAL",
                        "",
                        88,
                        1,
                        "US Forest Service",
                        123456,
                    ),
                )
                db.commit()
                db.close()
                server.OFFICIAL_DATA_DB = db_path

                profile = server._official_trail_profile_from_cache_id("trail:usfs:test-loop")
                self.assertIsNotNone(profile)
                self.assertEqual(profile["name"], "PCT: Methow Valley N. Terminus")
                self.assertEqual(profile["source_label"], "US Forest Service")
                self.assertEqual(profile["geometry"]["type"], "MultiLineString")

                public = asyncio.run(server.trail_profile("trail:usfs:test-loop"))
                manifest = asyncio.run(server.trail_preview("trail:usfs:test-loop"))

                self.assertEqual(public["id"], "trail:usfs:test-loop")
                self.assertEqual(public["geometry_ref"], "trail:usfs:test-loop")
                self.assertTrue(public["preview_available"])
                self.assertEqual(manifest["status"], "available")
                self.assertEqual(manifest["trail_name"], "PCT: Methow Valley N. Terminus")
                self.assertGreaterEqual(len(manifest["coordinates"]), 4)
        finally:
            server.OFFICIAL_DATA_DB = old_official_db

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

    def test_explore_search_surfaces_pakistan_treks_without_exact_title_duplicates(self):
        self.assertEqual(server._explore_category_hint_from_query("K2 Base Camp Trek"), "trail")

        k2 = asyncio.run(server.explore_catalog_index(q="K2 Base Camp Trek", category="trail", limit=8))
        titles = [item["title"] for item in k2["places"]]

        self.assertIn("K2 Base Camp Trek", titles)
        self.assertEqual(titles.count("K2 Base Camp Trek"), 1)
        self.assertTrue(any("Gondogoro" in title or "Masherbrum" in title or "Laila" in title for title in titles))
        detail = asyncio.run(server.explore_place_detail(k2["places"][0]["id"]))
        self.assertEqual((detail.get("summary") or {}).get("title"), "K2 Base Camp Trek")

    def test_explore_where_to_stay_falls_back_to_nearby_camps(self):
        self.assertEqual(server._explore_stay_destination_query("Big Sur where to stay"), "big sur")

        stays = asyncio.run(server.explore_catalog_index(q="Big Sur where to stay", category="lodging", limit=8))
        titles = [item["title"] for item in stays["places"]]

        self.assertGreater(stays["count"], 0)
        self.assertIn("China Camp Campground", titles)
        self.assertTrue(any("Camp" in title or "Campground" in item["category"] for title, item in zip(titles, stays["places"])))
        detail = asyncio.run(server.explore_place_detail(stays["places"][0]["id"]))
        self.assertEqual((detail.get("source_pack") or {}).get("primary"), stays["places"][0]["source_title"])
        visible = " ".join(
            " ".join(str(item.get(key) or "") for key in ("title", "category", "region", "hook", "short_description", "source_title"))
            for item in stays["places"]
        )
        self.assertNotRegex(visible, r"\b(API|database|download|undefined|null|0 results|mixed-source)\b")
        self.assertNotRegex(visible, r"\b[A-Z]{4,}\s+\([A-Za-z ]+\)")

    def test_explore_stay_search_uses_destination_before_generic_text_matches(self):
        glacier_camps = asyncio.run(server.explore_catalog_index(q="Glacier campgrounds", category="campground", limit=12))
        camp_titles = [item["title"] for item in glacier_camps["places"]]

        self.assertGreater(glacier_camps["count"], 0)
        self.assertIn("Many Glacier Campground", camp_titles)
        self.assertTrue(any(title in camp_titles for title in ("Avalanche Campground", "Fish Creek", "Apgar Campground")))

        glacier_stays = asyncio.run(server.explore_catalog_index(q="Glacier where to stay", category="lodging", limit=12))
        stay_titles = [item["title"] for item in glacier_stays["places"]]
        visible = " ".join(stay_titles)

        self.assertGreater(glacier_stays["count"], 0)
        self.assertIn("Many Glacier Hotel", stay_titles)
        self.assertNotIn("Yosemite High Sierra Camps", stay_titles)
        self.assertNotIn("Coleman Glacier Climbing Route", stay_titles)
        self.assertNotRegex(visible, r"\b(API|database|download|undefined|null|0 results|mixed-source)\b")

    def test_explore_stay_search_filters_false_lodging_records(self):
        yosemite = asyncio.run(server.explore_catalog_index(q="Yosemite where to stay", category="lodging", limit=40))
        yosemite_titles = [item["title"] for item in yosemite["places"]]
        moab = asyncio.run(server.explore_catalog_index(q="Moab where to stay", category="lodging", limit=40))
        moab_titles = [item["title"] for item in moab["places"]]

        self.assertIn("Yosemite Creek Campground", yosemite_titles)
        self.assertIn("Upper Pines Campground", yosemite_titles)
        self.assertIn("Goose Island Group Sites", moab_titles)
        self.assertIn("Devils Garden Campground", moab_titles)
        blocked = " ".join(yosemite_titles + moab_titles)
        self.assertNotRegex(blocked, r"\b(Ranger Station|Picnic Shelter|Interpretive Site|Wilson Arch|Swaseys Cabin TH|Dark Canyon Wilderness Recreation Area)\b")
        self.assertNotRegex(blocked, r"\b(API|database|download|undefined|null|0 results|mixed-source)\b")

    def test_explore_stay_search_keeps_yosemite_hub_cards_for_full_park_name(self):
        stays = asyncio.run(server.explore_catalog_index(q="Yosemite National Park where to stay", category="lodging", limit=12))
        titles = [item["title"] for item in stays["places"]]

        self.assertGreater(stays["count"], 0)
        self.assertEqual(titles[:4], [
            "Yosemite Valley Lodging",
            "Yosemite High Sierra Camps",
            "Yosemite Campgrounds",
            "Yosemite Airstream Stays",
        ])
        visible = " ".join(
            " ".join(str(item.get(key) or "") for key in ("title", "category", "region", "hook", "short_description", "source_title"))
            for item in stays["places"]
        )
        self.assertNotRegex(visible, r"\b(API|database|download|undefined|null|0 results|mixed-source)\b")

    def test_explore_index_suppresses_mismatched_local_photos(self):
        big_south_fork = asyncio.run(server.explore_catalog_index(q="Big South Fork", limit=8))
        boundary_waters = asyncio.run(server.explore_catalog_index(q="Boundary Waters Canoe Area Wilderness", limit=8))
        deep_page = asyncio.run(server.explore_catalog_index(limit=24, cursor=96))

        by_title = {item["title"]: item for item in big_south_fork["places"] + boundary_waters["places"] + deep_page["places"]}
        self.assertEqual(by_title["Big South Fork"].get("image_url") or by_title["Big South Fork"].get("thumbnail_url") or "", "")
        self.assertEqual(by_title["Boundary Waters Canoe Area Wilderness"].get("image_url") or by_title["Boundary Waters Canoe Area Wilderness"].get("thumbnail_url") or "", "")
        self.assertNotIn("camping-acadia", by_title["Big South Fork"].get("search_blob", ""))

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
