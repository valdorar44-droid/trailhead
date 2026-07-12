from __future__ import annotations

import asyncio
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import dashboard.server as server


ROOT = Path(__file__).resolve().parents[1]


def place(
    place_id: str,
    title: str,
    category: str,
    *,
    group: str | None = None,
    lat: float = 38.0,
    lng: float = -110.0,
    description: str | None = None,
) -> dict:
    description = description or f"{title} has current access details and useful planning context for an outdoor stop."
    label = category.replace("_", " ").title()
    return {
        "id": place_id,
        "category": category,
        "subcategories": [category],
        "quality": "official_source",
        "quality_score": 88,
        "verified": True,
        "best_season": "Check seasonal access.",
        "access": "Check current access.",
        "sources": [{"publisher": "National Park Service", "url": "https://www.nps.gov/"}],
        "summary": {
            "id": place_id,
            "title": title,
            "category": label,
            "explore_group": group or category,
            "lat": lat,
            "lng": lng,
            "rank": 100,
            "hero_rank": 100,
            "tags": [label],
            "short_description": description,
            "source_title": "National Park Service",
        },
        "profile": {"summary": description, "access_notes": "Check current access."},
        "source_pack": {
            "quality": "official",
            "primary": "National Park Service",
            "sources": [{"publisher": "National Park Service", "url": "https://www.nps.gov/"}],
        },
        "facts": {"source_quality": "official", "coordinates": f"{lat}, {lng}"},
    }


class ExploreServingV3Tests(unittest.TestCase):
    def setUp(self):
        server._EXPLORE_FACET_COUNTS_CACHE.update({"key": None, "counts": {}})

    def test_pagination_total_and_order_do_not_depend_on_page_size(self):
        catalog = {
            "schema_version": 2,
            "catalog_id": "fixture",
            "generated_at": 123,
            "places": [
                place(f"place:{index}", f"Place {index:02d}", "park", lat=38 + index / 1000)
                for index in range(30)
            ],
        }
        with patch.object(server, "_load_explore_catalog", return_value=catalog):
            first = asyncio.run(server.explore_catalog_index(limit=7, cursor=0))
            second = asyncio.run(server.explore_catalog_index(limit=7, cursor=7))
            wide = asyncio.run(server.explore_catalog_index(limit=21, cursor=0))

        self.assertEqual(first["schema_version"], 3)
        self.assertEqual(first["total_count"], 30)
        self.assertEqual(second["total_count"], 30)
        self.assertEqual(wide["total_count"], 30)
        self.assertEqual(first["next_cursor"], 7)
        self.assertEqual(second["next_cursor"], 14)
        paged_ids = [item["id"] for item in first["places"] + second["places"]]
        self.assertEqual(paged_ids, [item["id"] for item in wide["places"][:14]])
        self.assertIn("categories", first["facets"])
        self.assertIn("enrichment", first["places"][0])
        self.assertIn("provenance", first["places"][0])
        self.assertIn("ranking", first["places"][0])

    def test_category_filters_keep_glamping_campgrounds_peaks_land_and_springs_exact(self):
        glamping = place("glamp", "Desert Yurt Retreat", "glamping", group="glamping")
        campground = place("camp", "Juniper Campground", "campground", group="camping")
        mountain_camp = place("mountain-camp", "Blue Mountains Campground", "campground", group="camping")
        peak = place("peak", "Half Dome", "peak", group="scenic")
        spring = place("spring", "Frying Pan Lake", "hot_spring", group="water")
        spring_camp = place("spring-camp", "Mono Hot Springs Campground", "campground", group="camping")
        land = place("land", "Sierra National Forest", "forest", group="parks")
        land_camp = place("land-camp", "Wilderness Campground", "campground", group="camping")

        self.assertTrue(server._explore_place_matches_category_request(glamping, {"glamping"}))
        self.assertFalse(server._explore_place_matches_category_request(glamping, {"camp"}))
        self.assertTrue(server._explore_place_matches_category_request(campground, {"camp"}))
        self.assertFalse(server._explore_place_matches_category_request(campground, {"glamping"}))
        self.assertFalse(server._explore_place_matches_category_request(mountain_camp, {"peak"}))
        self.assertTrue(server._explore_place_matches_category_request(peak, {"peak"}))
        self.assertTrue(server._explore_place_matches_category_request(spring, {"springs"}))
        self.assertFalse(server._explore_place_matches_category_request(spring_camp, {"springs"}))
        self.assertTrue(server._explore_place_matches_category_request(land, {"public_land"}))
        self.assertFalse(server._explore_place_matches_category_request(land_camp, {"public_land"}))

    def test_populated_category_only_filter_does_not_fan_out_to_supplemental_indexes(self):
        spring = place("spring", "Frying Pan Lake", "hot_spring", group="water")
        catalog = {"schema_version": 3, "catalog_id": "fixture", "generated_at": 123, "places": [spring]}
        with (
            patch.object(server, "_load_explore_catalog", return_value=catalog),
            patch.object(server, "_official_cache_search_profiles", side_effect=AssertionError("category-only must stay indexed")) as official,
            patch.object(server, "_canonical_serving_profiles", side_effect=AssertionError("category-only must stay indexed")) as canonical,
            patch.object(server, "_pakistan_trek_explore_profiles", side_effect=AssertionError("category-only must stay indexed")) as treks,
        ):
            payload = asyncio.run(server.explore_catalog_index(category="springs", limit=8))

        self.assertEqual(payload["total_count"], 1)
        self.assertEqual(payload["places"][0]["id"], "spring")
        official.assert_not_called()
        canonical.assert_not_called()
        treks.assert_not_called()

    def test_populated_primary_facets_never_call_query_fallbacks(self):
        categories = {
            "camp": "campground",
            "huts": "lodging",
            "trails": "trail",
            "trailheads": "trailhead",
        }
        catalog_places = []
        for facet, canonical_category in categories.items():
            profile = place(f"place:{facet}", f"Exact {facet}", canonical_category)
            profile.update({
                "promoted_serving": True,
                "promoted_category": canonical_category,
            })
            catalog_places.append(profile)
        catalog = {
            "schema_version": 3,
            "catalog_id": "strict-facets",
            "generated_at": 123,
            "places": catalog_places,
        }
        blocked = AssertionError("populated category-only facets must stay on the serving index")
        with (
            patch.object(server, "_load_explore_catalog", return_value=catalog),
            patch.object(server, "_explore_stay_fallback_profiles", side_effect=blocked) as stays,
            patch.object(server, "_explore_trail_fallback_profiles", side_effect=blocked) as trails,
            patch.object(server, "_official_cache_search_profiles", side_effect=blocked) as official,
            patch.object(server, "_canonical_serving_profiles", side_effect=blocked) as canonical,
            patch.object(server, "_canonical_camp_search_profiles", side_effect=blocked) as camps,
            patch.object(server, "_pakistan_trek_explore_profiles", side_effect=blocked) as treks,
        ):
            payloads = {
                facet: asyncio.run(server.explore_catalog_index(category=facet, limit=8))
                for facet in categories
            }

        for facet, payload in payloads.items():
            expected_ids = {
                profile["id"]
                for profile in catalog_places
                if server._explore_place_matches_indexed_category(profile, facet)
            }
            self.assertEqual(payload["total_count"], len(expected_ids), facet)
            self.assertEqual(payload["category_counts"][facet], len(expected_ids), facet)
            self.assertEqual({item["id"] for item in payload["places"]}, expected_ids, facet)
        for loader in (stays, trails, official, canonical, camps, treks):
            loader.assert_not_called()

    def test_missing_facet_supplements_keep_enrichment_and_public_provenance(self):
        for facet in ("fuel", "resupply", "springs"):
            payload = asyncio.run(server.explore_catalog_index(category=facet, limit=4))
            self.assertGreater(payload["total_count"], 0, facet)
            self.assertEqual(payload["total_count"], payload["category_counts"][facet], facet)
            for item in payload["places"]:
                self.assertIsInstance(item.get("enrichment_score"), int, facet)
                self.assertTrue(item.get("enrichment_grade"), facet)
                self.assertTrue(item.get("planning_facts"), facet)
                self.assertTrue((item.get("provenance") or {}).get("primary_label"), facet)
                self.assertIn(item.get("media_kind"), {"photo", "map_preview"}, facet)
                self.assertNotEqual(item.get("source_title"), "osm", facet)

    def test_every_explorer_filter_returns_an_enriched_place(self):
        facets = (
            "camp", "glamping", "huts", "trails", "trailheads", "views",
            "peaks", "waterfalls", "springs", "climb", "water", "scenic",
            "parks", "land", "fuel", "resupply", "things",
        )
        for facet in facets:
            payload = asyncio.run(server.explore_catalog_index(category=facet, limit=1))
            self.assertGreater(payload["total_count"], 0, facet)
            self.assertEqual(payload["category_counts"][facet], payload["total_count"], facet)
            self.assertEqual(len(payload["places"]), 1, facet)
            item = payload["places"][0]
            self.assertTrue(item.get("id"), facet)
            self.assertTrue(item.get("title"), facet)
            self.assertTrue(item.get("category"), facet)
            self.assertIsInstance(item.get("enrichment_score"), int, facet)
            self.assertTrue(item.get("enrichment_grade"), facet)
            self.assertTrue(item.get("planning_facts"), facet)
            self.assertTrue((item.get("provenance") or {}).get("primary_label"), facet)
            self.assertIn(item.get("media_kind"), {"photo", "map_preview"}, facet)

        home = asyncio.run(server.explore_home(limit=1))
        self.assertEqual(len(home["guided_destinations"]), 25)

    def test_promoted_display_categories_follow_canonical_identity(self):
        labels = {
            "glamping": "Glamping",
            "peak": "Peak",
            "scenic_drive": "Scenic Drive",
        }
        for canonical_category, expected_label in labels.items():
            profile = {
                **place(canonical_category, f"Exact {canonical_category}", canonical_category),
                "promoted_serving": True,
                "promoted_category": canonical_category,
            }
            profile["summary"]["category"] = "Trail"
            profile["subcategories"] = ["trail"]
            self.assertEqual(server._explore_place_index_item(profile)["category"], expected_label)

    def test_promoted_filters_use_only_canonical_category(self):
        promoted_park = {
            **place("park", "River and Waterfall National Park", "park", group="parks"),
            "promoted_serving": True,
            "promoted_category": "park",
        }
        for category in ("water", "views", "scenic", "waterfalls", "climb"):
            self.assertFalse(server._explore_place_matches_indexed_category(promoted_park, category), category)

        exact_categories = {
            "water": "lake",
            "views": "viewpoint",
            "scenic": "scenic_drive",
            "waterfalls": "waterfall",
            "climb": "climbing_area",
        }
        for filter_name, canonical_category in exact_categories.items():
            promoted = {
                **place(filter_name, f"Exact {filter_name}", canonical_category),
                "promoted_serving": True,
                "promoted_category": canonical_category,
            }
            self.assertTrue(server._explore_place_matches_indexed_category(promoted, filter_name), filter_name)

    def test_glamping_uses_only_verified_ridb_supplements(self):
        payload = asyncio.run(server.explore_catalog_index(category="glamping", limit=20))

        self.assertEqual(payload["total_count"], 6)
        self.assertEqual(payload["category_counts"]["glamping"], 6)
        self.assertTrue(all(item["id"].startswith("place:ridb:") for item in payload["places"]))
        self.assertTrue(all(item.get("verified") for item in payload["places"]))
        self.assertTrue(all((item.get("enrichment_score") or 0) >= 80 for item in payload["places"]))
        self.assertFalse(any(item["id"].startswith("explore:glamping:") for item in payload["places"]))

    def test_home_preloads_exactly_25_destinations_without_viator_calls(self):
        with (
            patch.object(server.ViatorClient, "get_destinations", side_effect=AssertionError("home must stay local")) as get_destinations,
            patch.object(server.ViatorClient, "search_products", side_effect=AssertionError("home must stay local")) as search_products,
            patch.object(server.ViatorClient, "search_freetext", side_effect=AssertionError("home must stay local")) as search_freetext,
        ):
            payload = asyncio.run(server.explore_home(limit=2))

        destinations = payload["guided_destinations"]
        self.assertEqual(payload["guided"]["count"], 25)
        self.assertEqual(payload["guided"]["provider_calls"], 0)
        self.assertEqual(len(destinations), 25)
        self.assertEqual(len({item["id"] for item in destinations}), 25)
        self.assertEqual(len({item["slug"] for item in destinations}), 25)
        self.assertEqual(len({item["image_url"] for item in destinations}), 25)
        self.assertTrue(all(
            item["image_url"] == f"/assets/explore/guided-{item['slug']}.jpg"
            for item in destinations
        ))
        self.assertTrue(all(item.get("image_credit") for item in destinations))
        self.assertTrue(all(item.get("image_license") for item in destinations))
        self.assertTrue(all(item.get("image_source_url") for item in destinations))
        self.assertTrue(all("provider_destination_id" not in item for item in destinations))
        get_destinations.assert_not_called()
        search_products.assert_not_called()
        search_freetext.assert_not_called()

    def test_promoted_enrichment_and_provenance_survive_compact_and_full_responses(self):
        catalog = server._load_explore_catalog()
        compact = asyncio.run(server.explore_catalog_index(limit=1))
        full = asyncio.run(server.explore_places(limit=1))

        self.assertEqual(catalog["schema_version"], 3)
        self.assertTrue((catalog.get("gate") or {}).get("passed"))
        self.assertGreaterEqual(int(catalog.get("reviewable_count") or 0), 4000)
        promoted = catalog["places"][0]
        compact_item = compact["places"][0]
        full_item = full["places"][0]
        self.assertEqual(compact_item["id"], promoted["id"])
        self.assertEqual(full_item["id"], promoted["id"])
        for item in (compact_item, full_item):
            self.assertEqual(item["enrichment_score"], promoted["enrichment_score"])
            self.assertEqual(item["enrichment_grade"], promoted["enrichment_grade"])
            self.assertEqual(item["planning_facts"], promoted["planning_facts"])
            self.assertEqual(item["provenance"]["primary"], promoted["provenance"]["primary"])
            self.assertEqual(item["provenance"]["sources"], promoted["provenance"]["sources"])
            self.assertEqual(item["checked_at"], promoted["checked_at"])
            self.assertEqual(item["media_kind"], promoted["media_kind"])
            self.assertEqual(item["enrichment"]["score"], promoted["enrichment_score"])
            self.assertIsInstance(item["provenance"]["primary"], dict)
            self.assertIsInstance(item["provenance"]["primary_label"], str)
            self.assertGreater(item["provenance"]["source_count"], 0)

    def test_disabled_viator_returns_organic_fallback(self):
        fake_client = SimpleNamespace(ready=lambda: False)
        organic = [{"id": "organic:one", "title": "Free overlook"}]
        with (
            patch.object(server, "ViatorClient", return_value=fake_client),
            patch.object(server, "_guided_destination_organic_places", return_value=organic),
        ):
            payload = asyncio.run(server.explore_guided_destination("yosemite-national-park"))

        self.assertFalse(payload["live_enabled"])
        self.assertTrue(payload["organic_fallback"])
        self.assertEqual(payload["organic_places"], organic)
        self.assertEqual(payload["experiences"], [])
        self.assertIsNone(payload["provider_destination_id"])

    def test_live_selection_uses_only_provider_resolved_destination_id(self):
        class FakeClient:
            def __init__(self):
                self.config = SimpleNamespace(request_timeout_seconds=5.0, cache_ttl_hours=1)
                self.searched_destination_ids: list[str] = []

            def ready(self):
                return True

            def get_destinations(self, **_kwargs):
                return {
                    "status": "ok",
                    "endpoint": "/destinations",
                    "destinations": [{
                        "destinationId": "provider-yosemite-123",
                        "name": "Yosemite National Park",
                        "type": "REGION",
                        "center": {"latitude": 37.75, "longitude": -119.59},
                    }],
                }

            def search_products(self, *, destination_id: str, **_kwargs):
                self.searched_destination_ids.append(destination_id)
                return {
                    "status": "ok",
                    "endpoint": "/products/search",
                    "products": [{
                        "productCode": "REAL-PRODUCT-1",
                        "title": "Yosemite Valley Guided Hike",
                        "description": "A guided day hike through Yosemite Valley with a local mountain guide.",
                        "destinations": [{"ref": "provider-yosemite-123", "name": "Yosemite National Park", "primary": True}],
                        "reviews": {"combinedAverageRating": 4.9, "totalReviews": 82},
                        "pricing": {"summary": {"fromPrice": 129}, "currency": "USD"},
                    }],
                }

            def search_freetext(self, **_kwargs):
                raise AssertionError("resolved destinations must use product search")

        client = FakeClient()
        with (
            patch.object(server, "ViatorClient", return_value=client),
            patch.object(server, "_guided_destination_organic_places", return_value=[]),
        ):
            payload = asyncio.run(server.explore_guided_destination("guided:yosemite-national-park"))

        self.assertEqual(client.searched_destination_ids, ["provider-yosemite-123"])
        self.assertEqual(payload["provider_destination_id"], "provider-yosemite-123")
        self.assertEqual(payload["provider_status"]["provider_calls"], 2)
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["experiences"][0]["source_id"], "REAL-PRODUCT-1")

    def test_guided_destination_file_declares_exact_count(self):
        payload = json.loads((ROOT / "dashboard" / "explore_guided_destinations_v1.json").read_text())
        self.assertEqual(payload["count"], 25)
        self.assertEqual(len(payload["destinations"]), 25)

        image_urls: set[str] = set()
        for destination in payload["destinations"]:
            image_url = destination["image_url"]
            self.assertEqual(image_url, f"/assets/explore/guided-{destination['slug']}.jpg")
            self.assertTrue(destination["image_alt"])
            self.assertTrue(destination["image_credit"])
            self.assertTrue(destination["image_license"])
            self.assertTrue(destination["image_license_url"].startswith("https://creativecommons.org/"))
            self.assertTrue(destination["image_source_url"].startswith("https://commons.wikimedia.org/wiki/File:"))

            asset = ROOT / "dashboard" / "explore_assets" / Path(image_url).name
            self.assertTrue(asset.is_file(), asset)
            self.assertGreater(asset.stat().st_size, 100_000, asset)
            self.assertEqual(asset.read_bytes()[:2], b"\xff\xd8", asset)
            image_urls.add(image_url)

        self.assertEqual(len(image_urls), 25)


if __name__ == "__main__":
    unittest.main()
