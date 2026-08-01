from __future__ import annotations

import asyncio
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
        self.assertEqual(merged["reservations"]["url"], reviewed["reservations"]["url"])
        self.assertEqual(merged["media"][0]["credit"], "Recreation.gov")
        self.assertEqual({source["source"] for source in merged["sources"]}, {"usfs", "ridb"})


if __name__ == "__main__":
    unittest.main()
