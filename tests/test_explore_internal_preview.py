from __future__ import annotations

import asyncio
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import dashboard.server as server
from scripts.build_explore_internal_preview import _merge_serving_context


def preview_place(place_id: str, name: str, description: str) -> dict:
    return {
        "id": place_id,
        "name": name,
        "category": "park",
        "region": "UT",
        "lat": 37.0,
        "lng": -110.0,
        "description": description,
        "source_pack": {
            "quality": "official",
            "primary": "National Park Service",
            "official_url": "https://www.nps.gov/test/",
            "sources": [{"title": "National Park Service", "url": "https://www.nps.gov/test/"}],
            "things_to_see": [{"title": "Exact overlook", "description": "Official description."}],
        },
        "sources": [{"source": "nps", "source_id": place_id, "url": "https://www.nps.gov/test/"}],
        "quality": "official",
        "verified": True,
    }


class ExploreInternalPreviewTests(unittest.TestCase):
    def setUp(self):
        self._old_path = server.EXPLORE_INTERNAL_PREVIEW
        self._old_stage = os.environ.get("TRAILHEAD_EXPLORE_DATA_STAGE")
        self._old_cache = dict(server._EXPLORE_INTERNAL_PREVIEW_CACHE)
        self._tmp = tempfile.TemporaryDirectory()
        server.EXPLORE_INTERNAL_PREVIEW = Path(self._tmp.name) / "preview.json"
        description = (
            "The official park profile identifies this overlook and explains the landscape, "
            "visitor access, and the features visible from the signed viewpoint."
        )
        server.EXPLORE_INTERNAL_PREVIEW.write_text(json.dumps({
            "schema_version": 1,
            "places": [preview_place("place:nps:test", "Preview Park", description)],
        }))
        server._EXPLORE_INTERNAL_PREVIEW_CACHE.update({"key": None, "profiles": []})

    def tearDown(self):
        server.EXPLORE_INTERNAL_PREVIEW = self._old_path
        if self._old_stage is None:
            os.environ.pop("TRAILHEAD_EXPLORE_DATA_STAGE", None)
        else:
            os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = self._old_stage
        server._EXPLORE_INTERNAL_PREVIEW_CACHE.clear()
        server._EXPLORE_INTERNAL_PREVIEW_CACHE.update(self._old_cache)
        self._tmp.cleanup()

    def test_preview_stage_is_off_by_default(self):
        os.environ.pop("TRAILHEAD_EXPLORE_DATA_STAGE", None)
        self.assertEqual(server._load_explore_internal_preview_profiles(), [])

    def test_internal_preview_merges_only_inside_request_context(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        base = {"catalog_id": "public", "places": [{"id": "public-place"}]}
        with patch.object(server, "_load_explore_catalog_base", return_value=base):
            self.assertIs(server._load_explore_catalog(), base)
            marker = server._explore_internal_preview_context.set(True)
            try:
                preview = server._load_explore_catalog()
            finally:
                server._explore_internal_preview_context.reset(marker)
        self.assertEqual(preview["internal_preview"]["count"], 1)
        self.assertEqual([item["id"] for item in preview["places"]], ["public-place", "place:nps:test"])
        self.assertNotIn("internal_preview", base)

    def test_existing_identity_receives_richer_preview_without_duplication(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        base = {
            "catalog_id": "public",
            "places": [{
                "id": "place:nps:test",
                "summary": {
                    "title": "Preview Park",
                    "region": "Preview Park, UT",
                    "short_description": (
                        "Preview Park is an official Preview Park park record. Check access, "
                        "seasonal closures, fire restrictions, road conditions, and local rules before you go."
                    ),
                },
                "profile": {"summary": "Older generic record wording that should not win by length alone."},
                "card": {"summary": "Older generic card wording that should not win by length alone."},
                "source_pack": {},
            }],
        }
        merged = server._merge_explore_internal_preview(base)
        self.assertEqual(len(merged["places"]), 1)
        place = merged["places"][0]
        self.assertIn("official park profile", place["summary"]["short_description"])
        self.assertEqual(place["summary"]["region"], "UT")
        self.assertIn("official park profile", place["profile"]["summary"])
        self.assertIn("official park profile", place["card"]["summary"])
        self.assertEqual(place["source_pack"]["things_to_see"][0]["title"], "Exact overlook")
        self.assertEqual(place["summary"]["rank"], -999)
        self.assertEqual(place["summary"]["hero_rank"], -999)
        self.assertTrue(place["promoted_serving"])
        self.assertTrue(place["internal_preview"])

    def test_request_local_merge_cannot_mutate_cached_catalog_or_preview_profiles(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        base = {
            "catalog_id": "public",
            "places": [{
                "id": "place:nps:parent",
                "summary": {"title": "Parent Park"},
                "source_pack": {},
                "search_blob": "public baseline",
            }],
        }
        preview = server._explore_v3_place_to_profile(
            preview_place("place:nps:child", "Child Place", "Reviewed child description."),
        )
        preview["internal_preview"] = True
        base_before = copy.deepcopy(base)
        preview_before = copy.deepcopy(preview)

        def mutate_request_owned_records(places: list[dict]) -> list[dict]:
            places[0]["search_blob"] = "request-local wrapper text"
            places[-1]["summary"]["title"] = "Request-local child title"
            return places

        with patch.object(server, "_load_explore_internal_preview_profiles", return_value=[preview]), patch.object(
            server,
            "_apply_explore_legacy_wrapper_metadata",
            side_effect=mutate_request_owned_records,
        ):
            merged = server._merge_explore_internal_preview(base)

        self.assertEqual(base, base_before)
        self.assertEqual(preview, preview_before)
        self.assertEqual(merged["places"][0]["search_blob"], "request-local wrapper text")
        self.assertEqual(merged["places"][-1]["summary"]["title"], "Request-local child title")

    def test_internal_proof_destination_is_reachable_before_public_catalog(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        base = {
            "catalog_id": "public",
            "places": [{
                "id": "public-place",
                "summary": {"title": "Public Place", "rank": 1},
                "source_pack": {},
            }],
        }
        merged = server._merge_explore_internal_preview(base)
        with patch.object(server, "_load_explore_catalog", return_value=merged):
            result = server._explore_serving_query()
        self.assertEqual(result["places"][0]["id"], "place:nps:test")
        self.assertTrue(result["places"][0]["internal_preview"])
        self.assertEqual(result["places"][0]["summary"]["hero_rank"], -999)

    def test_compact_response_preserves_preview_identity_and_parks_land_lane(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        merged = server._merge_explore_internal_preview({"catalog_id": "public", "places": []})
        with patch.object(server, "_load_explore_catalog", return_value=merged):
            result = server._explore_serving_query(category="parks")
        response = server._explore_serving_response(result, limit=10, cursor=0, compact=True)
        self.assertTrue(response["internal_preview"]["enabled"])
        self.assertTrue(response["places"][0]["internal_preview"])
        self.assertTrue(server._explore_place_matches_indexed_category({
            "category": "public_land",
            "summary": {"title": "Moab BLM"},
            "promoted_serving": True,
            "promoted_category": "public_land",
        }, "parks"))

    def test_preview_header_is_not_a_credential(self):
        with patch.object(server, "_decode_token", return_value=7), patch.object(
            server, "get_user_by_id", return_value={"id": 7, "is_admin": False},
        ):
            self.assertFalse(server._explore_internal_preview_authorized("Bearer ordinary"))
        with patch.object(server, "_decode_token", return_value=9), patch.object(
            server, "get_user_by_id", return_value={"id": 9, "is_admin": True},
        ):
            self.assertTrue(server._explore_internal_preview_authorized("Bearer admin"))
        self.assertFalse(server._explore_internal_preview_authorized(""))

    def test_request_diagnostics_distinguish_header_stage_and_admin(self):
        os.environ.pop("TRAILHEAD_EXPLORE_DATA_STAGE", None)
        self.assertEqual(
            server._explore_internal_preview_request_code("/api/explore/home", "", "Bearer admin"),
            "header_missing",
        )
        self.assertEqual(
            server._explore_internal_preview_request_code("/api/explore/home", "internal", "Bearer admin"),
            "server_stage_off",
        )
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        with patch.object(server, "_explore_internal_preview_authorized", return_value=False):
            self.assertEqual(
                server._explore_internal_preview_request_code("/api/explore/home", "internal", "Bearer ordinary"),
                "admin_required",
            )
        with patch.object(server, "_explore_internal_preview_authorized", return_value=True):
            self.assertEqual(
                server._explore_internal_preview_request_code("/api/explore/home", "internal", "Bearer admin"),
                "active",
            )
            self.assertEqual(
                server._explore_internal_preview_request_code("/api/campsites/123/detail", "internal", "Bearer admin"),
                "active",
            )
            self.assertEqual(
                server._explore_internal_preview_request_code("/api/search/v2/results", "internal", "Bearer admin"),
                "active",
            )

    def test_reviewed_camp_detail_is_database_first_and_does_not_wait_for_ridb(self):
        reviewed_camp = server._explore_v3_place_to_profile({
            "id": "place:usfs:camp-1",
            "name": "River Campground",
            "category": "campground",
            "lat": 37.1,
            "lng": -119.2,
            "description": "A Forest Service campground beside the river.",
            "access": "Open",
            "amenities": ["toilets"],
            "reservations": {"url": "https://www.recreation.gov/camping/campgrounds/123", "reservable": True},
            "media": [{
                "url": "https://cdn.recreation.gov/camp.webp",
                "caption": "River Campground",
                "credit": "Recreation.gov",
                "license": "RIDB public API terms",
            }],
            "sources": [
                {
                    "source": "usfs",
                    "source_id": "camp-1",
                    "url": "https://www.fs.usda.gov/recarea/example",
                    "attribution": "USDA Forest Service",
                    "quality": "official_source",
                },
                {
                    "source": "ridb",
                    "source_id": "123",
                    "url": "https://www.recreation.gov/camping/campgrounds/123",
                    "attribution": "Recreation.gov",
                    "quality": "official_source",
                },
            ],
            "provenance": {
                "primary": {
                    "source": "usfs",
                    "source_id": "camp-1",
                    "url": "https://www.fs.usda.gov/recarea/example",
                    "attribution": "USDA Forest Service",
                }
            },
            "planning_facts": [
                {"key": "place_type", "label": "Type", "value": "Campground"},
                {"key": "access", "label": "Access", "value": "Open"},
            ],
            "verified": True,
        })
        marker = server._explore_internal_preview_context.set(True)
        try:
            with patch.object(
                server,
                "_load_explore_catalog",
                return_value={"places": [reviewed_camp]},
            ), patch.object(server, "get_facility_detail", new=AsyncMock()) as ridb_detail, patch.object(
                server,
                "_build_place_context",
                new=AsyncMock(),
            ) as live_context:
                detail = asyncio.run(server._load_campsite_detail("123"))
        finally:
            server._explore_internal_preview_context.reset(marker)

        self.assertTrue(detail["catalog_detail"])
        self.assertEqual(detail["id"], "place:usfs:camp-1")
        self.assertEqual(detail["verified_source"], "USDA Forest Service")
        self.assertEqual(detail["access_notes"], "Open")
        self.assertEqual(detail["amenities"], ["toilets"])
        self.assertTrue(detail["reservable"])
        self.assertEqual(detail["photo_url"], "https://cdn.recreation.gov/camp.webp")
        ridb_detail.assert_not_awaited()
        live_context.assert_not_awaited()

    def test_reviewed_camp_alias_outranks_earlier_ridb_record_in_internal_preview(self):
        official_fee = (
            "Single Site: $10 per night. $20 per night starting in 2026. "
            "Group Site: $100 per night"
        )
        ridb_record = server._explore_v3_place_to_profile({
            "id": "place:ridb:10182463",
            "name": "Kirch Flat Group Campground",
            "category": "campground",
            "lat": 36.87922085429918,
            "lng": -119.14895040173735,
            "sources": [{
                "source": "ridb",
                "source_id": "10182463",
                "url": "https://www.recreation.gov/camping/campgrounds/10182463",
                "attribution": "Recreation.gov",
            }],
            "verified": True,
        })
        reviewed_replacement = server._explore_v3_place_to_profile({
            "id": "place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8",
            "name": "Kirch Flat Group Campground",
            "category": "campground",
            "lat": 36.87922085429918,
            "lng": -119.14895040173735,
            "description": "A reviewed Forest Service campground on the Kings River.",
            "sources": [
                {
                    "source": "usfs",
                    "source_id": "usfs-sierra-sites-kirch-flat",
                    "url": "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45570",
                    "attribution": "USDA Forest Service",
                },
                {
                    "source": "ridb",
                    "source_id": "10182463",
                    "url": "https://www.recreation.gov/camping/campgrounds/10182463",
                    "attribution": "Recreation.gov",
                },
            ],
            "source_pack": {
                "site_type": "Group Campground",
                "people_capacity": 50,
                "fees": [official_fee],
                "operating_season": ["All year"],
                "water": "No water is available",
                "restrooms": "Vault toilet(s)",
                "official_url": "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45570",
                "phone": "(559) 855-5355",
            },
            "planning_facts": [{"key": "fees", "label": "Fees", "value": official_fee}],
            "verified": True,
        })
        reviewed_replacement["internal_preview"] = True
        reviewed_replacement["planning_facts"] = [
            {"key": "fees", "label": "Fees", "value": official_fee},
        ]

        marker = server._explore_internal_preview_context.set(True)
        try:
            with patch.object(
                server,
                "_load_explore_catalog",
                return_value={"places": [ridb_record, reviewed_replacement]},
            ):
                detail = server._explore_catalog_camp_detail("place:ridb:10182463")
                numeric_detail = server._explore_catalog_camp_detail("10182463")
        finally:
            server._explore_internal_preview_context.reset(marker)

        self.assertEqual(detail["id"], "place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8")
        self.assertEqual(detail["requested_id"], "place:ridb:10182463")
        self.assertEqual(detail["verified_source"], "USDA Forest Service")
        self.assertEqual(detail["cost"], official_fee)
        self.assertFalse(detail["reservable"])
        self.assertEqual(detail["booking_url"], "")
        self.assertEqual(
            detail["official_url"],
            "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45570",
        )
        self.assertEqual(detail["photos"], [])
        self.assertEqual({source["source"] for source in detail["sources"]}, {"usfs", "ridb"})
        self.assertEqual(numeric_detail["id"], detail["id"])
        self.assertEqual(numeric_detail["requested_id"], "10182463")

    def test_public_camp_alias_keeps_exact_ridb_record(self):
        ridb_record = server._explore_v3_place_to_profile({
            "id": "place:ridb:10182463",
            "name": "Kirch Flat Group Campground",
            "category": "campground",
            "sources": [{
                "source": "ridb",
                "source_id": "10182463",
                "attribution": "Recreation.gov",
            }],
            "verified": True,
        })
        agency_alias = server._explore_v3_place_to_profile({
            "id": "place:usfs:kirch-flat",
            "name": "Kirch Flat Group Campground",
            "category": "campground",
            "sources": [
                {"source": "usfs", "source_id": "kirch-flat", "attribution": "USDA Forest Service"},
                {"source": "ridb", "source_id": "10182463", "attribution": "Recreation.gov"},
            ],
            "verified": True,
        })
        with patch.object(
            server,
            "_load_explore_catalog",
            return_value={"places": [ridb_record, agency_alias]},
        ):
            detail = server._explore_catalog_camp_detail("10182463")

        self.assertEqual(detail["id"], "place:ridb:10182463")
        self.assertEqual(detail["verified_source"], "Recreation.gov")

    def test_internal_search_page_remaps_unique_ridb_alias_without_mutating_public_page(self):
        ridb_record = server._explore_v3_place_to_profile({
            "id": "place:ridb:10182463",
            "name": "Kirch Flat Group Campground",
            "category": "campground",
            "lat": 36.87922085429918,
            "lng": -119.14895040173735,
            "sources": [{"source": "ridb", "source_id": "10182463", "attribution": "Recreation.gov"}],
            "verified": True,
        })
        reviewed = server._explore_v3_place_to_profile({
            "id": "place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8",
            "name": "Kirch Flat Group Campground",
            "category": "campground",
            "lat": 36.87922085429918,
            "lng": -119.14895040173735,
            "sources": [
                {"source": "usfs", "source_id": "usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8", "attribution": "USDA Forest Service"},
                {"source": "ridb", "source_id": "10182463", "attribution": "Recreation.gov"},
            ],
            "verified": True,
        })
        reviewed["internal_preview"] = True
        result = server.SearchResultV2(
            result_id="place:ridb:10182463",
            canonical_place_id="place:ridb:10182463",
            title="Kirch Flat Group Campground",
            subtitle="Sierra National Forest",
            kind="campground",
            categories=["campground"],
            coordinates=server.SearchCenterV2(lat=36.87922085429918, lng=-119.14895040173735),
            provenance=server.SearchProvenanceV2(
                provider="trailhead",
                source_label="Recreation.gov",
                provider_result_id="10182463",
                attribution="Recreation.gov",
            ),
            persistence_policy="canonical",
            detail_ref="place:ridb:10182463",
            score=100,
        )
        public_page = server.SearchPageV2(
            query="Kirch Flat",
            results=[result],
            revision="public-revision",
            elapsed_ms=7,
        )

        with patch.object(server, "_load_explore_internal_preview_profiles", return_value=[reviewed]), patch.object(
            server,
            "_explore_catalog_camp_detail",
            side_effect=AssertionError("Search remapping must not scan the campground catalog"),
        ):
            marker = server._explore_internal_preview_context.set(True)
            try:
                internal_page = server._search_v2_apply_internal_preview_page(public_page)
            finally:
                server._explore_internal_preview_context.reset(marker)

        self.assertEqual(public_page.results[0].result_id, "place:ridb:10182463")
        self.assertEqual(internal_page.results[0].result_id, reviewed["id"])
        self.assertEqual(internal_page.results[0].canonical_place_id, reviewed["id"])
        self.assertEqual(internal_page.results[0].detail_ref, reviewed["id"])
        self.assertEqual(internal_page.results[0].provenance.source_label, "US Forest Service")
        self.assertEqual(internal_page.revision, public_page.revision)

    def test_internal_search_alias_preserves_reviewed_mammoth_pool_booking(self):
        booking_url = "https://www.recreation.gov/camping/campgrounds/232817"
        official_url = "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45454"
        official_fee = (
            "Single Site: $41 per night. Additional Holiday Fee: $2 per night. "
            "Additional Vehicle Fee: $10 per vehicle per night"
        )
        ridb_record = server._explore_v3_place_to_profile({
            "id": "place:ridb:232817",
            "name": "Mammoth Pool Campground",
            "category": "campground",
            "lat": 37.3447131267116,
            "lng": -119.33321268225046,
            "sources": [{
                "source": "ridb",
                "source_id": "232817",
                "url": booking_url,
                "attribution": "Recreation.gov",
            }],
            "verified": True,
        })
        reviewed = server._explore_v3_place_to_profile({
            "id": "place:usfs:usfs-sierra-sites-5f618db8-3fe8-4011-a735-18a738acfb43",
            "name": "Mammoth Pool Campground",
            "category": "campground",
            "lat": 37.3447131267116,
            "lng": -119.33321268225046,
            "sources": [
                {
                    "source": "usfs",
                    "source_id": "usfs-sierra-sites:{5F618DB8-3FE8-4011-A735-18A738ACFB43}",
                    "attribution": "USDA Forest Service",
                },
                {
                    "source": "ridb",
                    "source_id": "232817",
                    "url": "https://www.recreation.gov/",
                    "attribution": "Recreation.gov",
                },
            ],
            "reservations": {
                "reservable": True,
                "url": booking_url,
                "reservation_url": booking_url,
            },
            "source_pack": {
                "site_type": "Campground",
                "people_capacity": 235,
                "fees": [official_fee],
                "operating_season": ["June - October"],
                "water": "No water is available",
                "restrooms": "Vault toilet(s)",
                "official_url": official_url,
                "booking_url": booking_url,
            },
            "planning_facts": [
                {"key": "reservations", "label": "Reservations", "value": "Available", "url": booking_url},
                {"key": "fees", "label": "Fees", "value": official_fee},
            ],
            "verified": True,
        })
        reviewed["internal_preview"] = True
        result = server.SearchResultV2(
            result_id="place:ridb:232817",
            canonical_place_id="place:ridb:232817",
            title="Mammoth Pool Campground",
            kind="campground",
            categories=["campground"],
            coordinates=server.SearchCenterV2(lat=37.3447131267116, lng=-119.33321268225046),
            provenance=server.SearchProvenanceV2(
                provider="trailhead",
                source_label="Recreation.gov",
                provider_result_id="232817",
                attribution="Recreation.gov",
            ),
            persistence_policy="canonical",
            detail_ref="place:ridb:232817",
        )

        marker = server._explore_internal_preview_context.set(True)
        try:
            with patch.object(server, "_load_explore_internal_preview_profiles", return_value=[reviewed]), patch.object(
                server,
                "_load_explore_catalog",
                return_value={"places": [ridb_record, reviewed]},
            ):
                remapped = server._search_v2_apply_internal_preview_result(result)
                detail = server._explore_catalog_camp_detail("place:ridb:232817")
        finally:
            server._explore_internal_preview_context.reset(marker)

        self.assertEqual(remapped.result_id, reviewed["id"])
        self.assertEqual(remapped.provenance.source_label, "US Forest Service")
        self.assertEqual(detail["id"], reviewed["id"])
        self.assertTrue(detail["reservable"])
        self.assertEqual(detail["booking_url"], booking_url)
        self.assertEqual(detail["official_url"], official_url)
        self.assertEqual(detail["cost"], official_fee)
        self.assertEqual(detail["photos"], [])

    def test_internal_search_alias_fails_closed_when_multiple_reviewed_profiles_match(self):
        def reviewed(profile_id: str) -> dict:
            profile = server._explore_v3_place_to_profile({
                "id": profile_id,
                "name": "Duplicate Campground",
                "category": "campground",
                "sources": [
                    {"source": "usfs", "source_id": profile_id.rsplit(":", 1)[-1], "attribution": "USDA Forest Service"},
                    {"source": "ridb", "source_id": "10182463", "attribution": "Recreation.gov"},
                ],
            })
            profile["internal_preview"] = True
            return profile

        result = server.SearchResultV2(
            result_id="place:ridb:10182463",
            canonical_place_id="place:ridb:10182463",
            title="Duplicate Campground",
            kind="campground",
            categories=["campground"],
            provenance=server.SearchProvenanceV2(provider="trailhead", source_label="Recreation.gov"),
            persistence_policy="canonical",
            detail_ref="place:ridb:10182463",
        )
        public = server._explore_v3_place_to_profile({
            "id": "place:ridb:10182463",
            "name": "Duplicate Campground",
            "category": "campground",
            "sources": [
                {"source": "ridb", "source_id": "10182463", "attribution": "Recreation.gov"},
            ],
        })
        reviewed_profiles = [reviewed("place:usfs:one"), reviewed("place:usfs:two")]
        marker = server._explore_internal_preview_context.set(True)
        try:
            with patch.object(
                server,
                "_load_explore_internal_preview_profiles",
                return_value=reviewed_profiles,
            ), patch.object(
                server,
                "_load_explore_catalog",
                return_value={"places": [public, *reviewed_profiles]},
            ):
                remapped = server._search_v2_apply_internal_preview_result(result)
                detail = server._explore_catalog_camp_detail("place:ridb:10182463")
        finally:
            server._explore_internal_preview_context.reset(marker)

        self.assertIs(remapped, result)
        self.assertEqual(detail["id"], "place:ridb:10182463")
        self.assertEqual(detail["verified_source"], "Recreation.gov")

    def test_reviewed_camp_detail_preserves_exact_top_level_media_and_booking(self):
        reviewed_camp = {
            "id": "place:usfs:camp-media",
            "name": "Exact River Campground",
            "category": "campground",
            "summary": {
                "title": "Exact River Campground",
                "category": "campground",
                "lat": 37.2,
                "lng": -119.3,
                "tags": ["campground"],
            },
            "profile": {"summary": "A source-backed campground beside the river."},
            "reservations": {
                "url": "https://www.recreation.gov/camping/campgrounds/456",
                "reservable": True,
            },
            "media": [{
                "url": "https://cdn.recreation.gov/exact-camp.webp",
                "caption": "Exact River Campground",
                "credit": "Recreation.gov",
                "license": "RIDB public API terms",
            }],
            "source_pack": {},
            "sources": [{
                "source": "usfs",
                "source_id": "camp-media",
                "url": "https://www.fs.usda.gov/recarea/example",
                "attribution": "USDA Forest Service",
            }],
            "provenance": {"primary": {
                "source": "usfs",
                "source_id": "camp-media",
                "url": "https://www.fs.usda.gov/recarea/example",
                "attribution": "USDA Forest Service",
            }},
            "planning_facts": [{"key": "place_type", "value": "Campground"}],
        }
        with patch.object(server, "_load_explore_catalog", return_value={"places": [reviewed_camp]}):
            detail = server._explore_catalog_camp_detail("place:usfs:camp-media")

        self.assertEqual(detail["booking_url"], "https://www.recreation.gov/camping/campgrounds/456")
        self.assertEqual(detail["photo_url"], "https://cdn.recreation.gov/exact-camp.webp")
        self.assertEqual(detail["photos"][0]["caption"], "Exact River Campground")

    def test_active_request_diagnostics_report_ready_sidecar(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        marker = server._explore_internal_preview_status_context.set("active")
        try:
            result = asyncio.run(server.explore_internal_preview_diagnostics({"id": 9, "is_admin": True}))
        finally:
            server._explore_internal_preview_status_context.reset(marker)
        self.assertEqual(result, {
            "schema": "explore_internal_preview_diagnostics_v1",
            "request_code": "active",
            "data_code": "ready",
            "profile_count": 1,
        })

    def test_cross_agency_preview_context_preserves_reviewed_copy_and_booking(self):
        reviewed = {
            "id": "place:usfs:camp-1",
            "name": "River Campground",
            "summary": "Reviewed Forest Service campground description.",
            "description": "Reviewed Forest Service campground description.",
            "reservations": {"url": "https://www.fs.usda.gov/recarea/example"},
            "sources": [{"source": "usfs", "source_id": "camp-1"}],
            "media": [],
        }
        serving = {
            "id": "place:usfs:camp-1",
            "description": "Older compact description must not replace reviewed copy.",
            "image_url": "https://cdn.recreation.gov/camp.webp",
            "image_credit": "Recreation.gov",
            "image_license": "RIDB public API terms",
            "image_source_url": "https://www.recreation.gov/camping/campgrounds/123",
            "planning_facts": [{"key": "reservations", "value": "Available"}],
            "provenance": {"sources": [{
                "source": "ridb",
                "source_id": "123",
                "url": "https://www.recreation.gov/camping/campgrounds/123",
                "attribution": "Recreation.gov",
                "license": "RIDB public API terms",
                "quality": "official_source",
            }]},
        }

        merged = _merge_serving_context(reviewed, serving)

        self.assertEqual(merged["summary"], reviewed["summary"])
        self.assertEqual(merged["description"], reviewed["description"])
        self.assertTrue(merged["reservations"]["reservable"])
        self.assertEqual(merged["reservations"]["url"], "https://www.recreation.gov/camping/campgrounds/123")
        self.assertEqual(
            merged["reservations"]["reservation_url"],
            "https://www.recreation.gov/camping/campgrounds/123",
        )
        self.assertEqual(merged["media"], [])
        self.assertEqual({source["source"] for source in merged["sources"]}, {"usfs", "ridb"})

        serving["image_rights_state"] = "source_terms_reviewed"
        merged_with_reviewed_media = _merge_serving_context(reviewed, serving)
        self.assertEqual(merged_with_reviewed_media["media"][0]["credit"], "Recreation.gov")


if __name__ == "__main__":
    unittest.main()
