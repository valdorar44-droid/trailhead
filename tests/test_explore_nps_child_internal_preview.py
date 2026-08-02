from __future__ import annotations

import copy
import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

import dashboard.server as server
from scripts import build_explore_internal_preview as builder
from scripts import qa_explore_b08_internal_candidate as qa


class ExploreNpsChildInternalPreviewTests(unittest.TestCase):
    def setUp(self):
        self.old_stage = os.environ.get("TRAILHEAD_EXPLORE_DATA_STAGE")
        self.old_path = server.EXPLORE_INTERNAL_PREVIEW
        self.old_cache = copy.deepcopy(server._EXPLORE_INTERNAL_PREVIEW_CACHE)
        self.old_child_cache = copy.deepcopy(server._EXPLORE_CHILDREN_BY_PARENT_CACHE)
        server._EXPLORE_INTERNAL_PREVIEW_CACHE.update({"key": None, "profiles": [], "children": []})
        server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update({"key": None, "by_parent": {}})

    def tearDown(self):
        server.EXPLORE_INTERNAL_PREVIEW = self.old_path
        server._EXPLORE_INTERNAL_PREVIEW_CACHE.clear()
        server._EXPLORE_INTERNAL_PREVIEW_CACHE.update(self.old_cache)
        server._EXPLORE_CHILDREN_BY_PARENT_CACHE.clear()
        server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update(self.old_child_cache)
        if self.old_stage is None:
            os.environ.pop("TRAILHEAD_EXPLORE_DATA_STAGE", None)
        else:
            os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = self.old_stage

    def test_accepted_r7_binding_is_exact_and_internal_only(self):
        children, binding = builder._validated_nps_child_depth(
            builder.DEFAULT_NPS_CHILDREN,
            builder.DEFAULT_NPS_CHILD_MANIFEST,
            builder.DEFAULT_NPS_CHILD_AUDIT,
            builder.DEFAULT_NPS_CHILD_REVIEW,
        )
        self.assertEqual(len(children), 156)
        self.assertEqual(binding["artifact_sha256"], builder.ACCEPTED_NPS_CHILD_HASHES["nps_child_depth_v1.json"])
        self.assertFalse(binding["promotion_ready"])
        self.assertFalse(binding["live_serving_index_modified"])
        self.assertTrue(binding["audit_passed"])
        self.assertTrue(all(item["hidden_from_featured"] for item in children))

    def test_manifest_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            paths = {}
            for source in (
                builder.DEFAULT_NPS_CHILDREN,
                builder.DEFAULT_NPS_CHILD_MANIFEST,
                builder.DEFAULT_NPS_CHILD_AUDIT,
                builder.DEFAULT_NPS_CHILD_REVIEW,
            ):
                target = root / source.name
                target.write_bytes(source.read_bytes())
                paths[source.name] = target
            paths["nps_child_depth_v1.json"].write_text(
                paths["nps_child_depth_v1.json"].read_text() + "\n",
            )
            with self.assertRaises(SystemExit):
                builder._validated_nps_child_depth(
                    paths["nps_child_depth_v1.json"], paths["manifest.json"],
                    paths["audit.json"], paths["review.json"],
                )

    def test_generated_sidecar_fails_qa_when_accepted_child_binding_drifts(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        payload["candidate"]["nps_child_depth"]["artifact_sha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "preview.json"
            path.write_text(json.dumps(payload))
            with self.assertRaises(SystemExit):
                qa.audit(path)

    def test_builder_rejects_self_consistent_alternate_child_artifacts(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            copies = {}
            for source in (builder.DEFAULT_NPS_CHILDREN, builder.DEFAULT_NPS_CHILD_MANIFEST, builder.DEFAULT_NPS_CHILD_AUDIT, builder.DEFAULT_NPS_CHILD_REVIEW):
                target = root / source.name
                target.write_bytes(source.read_bytes())
                copies[source.name] = target
            args = SimpleNamespace(
                agency_catalog=builder.DEFAULT_AGENCY, agency_manifest=builder.DEFAULT_AGENCY_MANIFEST,
                nps_catalog=builder.DEFAULT_NPS, serving_index=builder.DEFAULT_SERVING,
                combined_manifest=builder.DEFAULT_COMBINED_MANIFEST, output=root / "out.json",
                nps_cache_dir=builder.DEFAULT_NPS_CACHE, nps_children=copies["nps_child_depth_v1.json"],
                nps_child_manifest=copies["manifest.json"], nps_child_audit=copies["audit.json"],
                nps_child_review=copies["review.json"], agency_id=list(builder.DEFAULT_AGENCY_IDS),
                nps_code=list(builder.DEFAULT_NPS_CODES),
            )
            with self.assertRaises(SystemExit):
                builder.build(args)

    def test_preview_enrich_and_bulk_never_read_or_write_public_shared_cache(self):
        preview_place = {"id": "place:nps-child:test", "summary": {"title": "Preview child"}}
        with patch.object(server, "get_cached", return_value={"places": [{"id": "leaked"}]}) as get_cached, patch.object(
            server, "set_cached",
        ) as set_cached, patch.object(
            server, "_explore_enrichment_catalog_candidates", return_value=[preview_place],
        ), patch.object(server, "_explore_place_is_enriched_enough", return_value=True), patch.object(
            server, "_find_explore_place", return_value=preview_place,
        ), patch.object(server, "_attach_official_nearby_source_pack", side_effect=lambda place: place):
            marker = server._explore_internal_preview_context.set(True)
            try:
                enriched = asyncio.run(server.explore_enrich(q="Preview child"))
                bulk = asyncio.run(server.explore_places_bulk(server.ExplorePlacesBulkRequest(ids=[preview_place["id"]])))
            finally:
                server._explore_internal_preview_context.reset(marker)
            self.assertEqual(enriched["places"][0]["id"], preview_place["id"])
            self.assertEqual(bulk["places"][0]["id"], preview_place["id"])
            get_cached.assert_not_called()
            set_cached.assert_not_called()
            get_cached.side_effect = [
                {"places": [{"id": "public-enrich"}]},
                {"places": [{"id": "public-bulk"}]},
            ]
            public_enriched = asyncio.run(server.explore_enrich(q="Preview child"))
            public_bulk = asyncio.run(server.explore_places_bulk(server.ExplorePlacesBulkRequest(ids=[preview_place["id"]])))
        self.assertEqual(public_enriched["places"][0]["id"], "public-enrich")
        self.assertEqual(public_bulk["places"][0]["id"], "public-bulk")

    def test_parent_rails_prefer_source_backed_child_classification(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        by_name = {item["name"]: server._explore_v3_place_to_profile(item) for item in payload["children"]}
        selected = [
            by_name["Fossil Discovery Trail - Visitor Center Trailhead"],
            by_name["Aspen Hollow Campground"],
            next(item for item in (server._explore_v3_place_to_profile(raw) for raw in payload["children"]) if item.get("category") == "activity"),
        ]
        body = server.MapCardResolveRequest(source="trailhead_explore", place_id="place:nps:dino", lat=40.4, lng=-109.3)
        with patch.object(server, "_canonical_explore_place_id", return_value="place:nps:dino"), patch.object(
            server, "_explore_children_for_parent", return_value=selected,
        ):
            rails = server._canonical_explore_related_rails(body)
        self.assertEqual(rails["trails"][0]["display_type"], "Trailhead")
        self.assertEqual(rails["campgrounds_nearby"][0]["display_type"], "Campground")
        self.assertEqual(rails["things_to_do"][0]["display_type"], "Activity")

    def test_children_merge_only_for_internal_stage_and_keep_proof_ranks(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        base = {"catalog_id": "public", "places": [{
            "id": "place:nps:blri", "summary": {"title": "Blue Ridge Parkway", "rank": 10},
        }]}
        merged = server._merge_explore_internal_preview(base)
        self.assertEqual(merged["internal_preview"]["count"], 13)
        self.assertEqual(merged["internal_preview"]["child_count"], 156)
        proof = next(item for item in merged["places"] if item["id"] == "place:usfs:9006")
        child = next(item for item in merged["places"] if item["id"].startswith("place:nps-child:blri:"))
        self.assertLess(proof["summary"]["rank"], 0)
        self.assertGreater(child["summary"]["rank"], 900000)
        self.assertTrue(child["hidden_from_featured"])
        self.assertFalse(child["promoted_serving"])

    def test_parent_modules_search_and_sheet_identity_reach_child_without_featured_pollution(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        base = {"catalog_id": "public", "places": [{
            "id": "place:nps:blri", "summary": {"title": "Blue Ridge Parkway", "rank": 10},
        }]}
        merged = server._merge_explore_internal_preview(base)
        with patch.object(server, "_load_explore_catalog", return_value=merged):
            server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update({"key": None, "by_parent": {}})
            children = server._explore_children_for_parent("place:nps:blri")
            self.assertTrue(children)
            child = children[0]
            self.assertEqual(server._find_explore_place(child["id"])["id"], child["id"])
            featured = server._explore_serving_query()
            self.assertNotIn(child["id"], {item.get("id") for item in featured["places"]})
            counts = server._explore_visible_category_counts(merged)
            self.assertEqual(counts["all"], 14)

        marker = server._explore_internal_preview_context.set(True)
        try:
            page = server.SearchPageV2(
                query=str(child["summary"]["title"]), results=[], revision="public", elapsed_ms=1,
            )
            searched = server._search_v2_apply_internal_preview_page(page, limit=8)
        finally:
            server._explore_internal_preview_context.reset(marker)
        self.assertEqual(searched.results[0].result_id, child["id"])
        self.assertEqual(searched.results[0].detail_ref, child["id"])

        marker = server._explore_internal_preview_context.set(True)
        try:
            fuel = server._search_v2_apply_internal_preview_page(
                page, request=server.SearchRequestV2(query=page.query, categories=["fuel"]), limit=8,
            )
            bounded = server._search_v2_apply_internal_preview_page(
                page,
                request=server.SearchRequestV2(
                    query=page.query, scope="viewport",
                    bounds=server.SearchBoundsV2(west=-10, south=-10, east=10, north=10),
                ), limit=8,
            )
            later_page = server._search_v2_apply_internal_preview_page(
                page, request=server.SearchRequestV2(query=page.query, cursor="opaque-page-2"), limit=8,
            )
        finally:
            server._explore_internal_preview_context.reset(marker)
        self.assertEqual(fuel.results, [])
        self.assertEqual(bounded.results, [])
        self.assertEqual(later_page.results, [])


    def test_internal_search_requires_unique_exact_alias_and_standard_filters(self):
        def child(item_id: str, title: str, aliases: list[str]) -> dict:
            profile = server._explore_v3_place_to_profile({
                "id": item_id, "name": title, "category": "trailhead",
                "search_aliases": aliases, "lat": 40.4, "lng": -109.3,
                "verified": True, "difficulty": "easy",
                "sources": [{"source": "nps", "attribution": "National Park Service"}],
            })
            profile["difficulty"] = "easy"
            return profile
        primary = child("place:nps-child:test:places:fossil", "Fossil Discovery Trailhead", ["Fossil VC Trailhead", "DINO"])
        sibling = child("place:nps-child:test:places:sibling", "Duplicate Name", ["DINO"])
        duplicate = child("place:nps-child:test:places:duplicate", "Duplicate Name", [])
        marker = server._explore_internal_preview_context.set(True)
        try:
            with patch.object(server, "_load_explore_internal_preview_children", return_value=[primary, sibling, duplicate]):
                accepted = server._search_v2_internal_preview_child_results(server.SearchRequestV2(
                    query="Fossil VC Trailhead", intent="trail", filters={"difficulty": "easy"},
                ))
                rejected = server._search_v2_internal_preview_child_results(server.SearchRequestV2(
                    query="Fossil VC Trailhead", filters={"difficulty": "hard"},
                ))
                ambiguous_alias = server._search_v2_internal_preview_child_results(server.SearchRequestV2(query="DINO"))
                ambiguous_title = server._search_v2_internal_preview_child_results(server.SearchRequestV2(query="Duplicate Name"))
        finally:
            server._explore_internal_preview_context.reset(marker)
        self.assertEqual([item.result_id for item in accepted], [primary["id"]])
        self.assertEqual(rejected, [])
        self.assertEqual(ambiguous_alias, [])
        self.assertEqual(ambiguous_title, [])


if __name__ == "__main__":
    unittest.main()
