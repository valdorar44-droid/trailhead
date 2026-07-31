from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import dashboard.server as server


def preview_place(place_id: str, name: str, description: str) -> dict:
    return {
        "id": place_id,
        "name": name,
        "category": "park",
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
                "summary": {"title": "Preview Park", "short_description": "Short."},
                "source_pack": {},
            }],
        }
        merged = server._merge_explore_internal_preview(base)
        self.assertEqual(len(merged["places"]), 1)
        self.assertIn("official park profile", merged["places"][0]["summary"]["short_description"])
        self.assertEqual(merged["places"][0]["source_pack"]["things_to_see"][0]["title"], "Exact overlook")

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


if __name__ == "__main__":
    unittest.main()
