from __future__ import annotations

import copy
import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
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
        server._EXPLORE_INTERNAL_PREVIEW_CACHE.clear()
        server._EXPLORE_INTERNAL_PREVIEW_CACHE.update({
            "key": None, "profiles": [], "children": [], "status": "not_loaded",
            "contract_id": "",
        })
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

    @staticmethod
    def _sidecar_batches():
        children = json.loads(builder.DEFAULT_OUTPUT.read_text())["children"]
        return (
            children[:156],
            children[156:326],
            children[326:457],
            children[457:554],
            children[554:624],
            children[624:],
        )

    @staticmethod
    def _require_local_builder_evidence():
        paths = (
            builder.DEFAULT_NPS_CHILDREN,
            builder.DEFAULT_NPS_CHILD_MANIFEST,
            builder.DEFAULT_NPS_CHILD_AUDIT,
            builder.DEFAULT_NPS_CHILD_REVIEW,
            builder.DEFAULT_NPS_CHILDREN_2,
            builder.DEFAULT_NPS_CHILD_MANIFEST_2,
            builder.DEFAULT_NPS_CHILD_AUDIT_2,
            builder.DEFAULT_NPS_CHILD_REVIEW_2,
            builder.DEFAULT_NPS_CHILDREN_3,
            builder.DEFAULT_NPS_CHILD_MANIFEST_3,
            builder.DEFAULT_NPS_CHILD_AUDIT_3,
            builder.DEFAULT_NPS_CHILD_REVIEW_3,
            builder.DEFAULT_NPS_CHILDREN_4,
            builder.DEFAULT_NPS_CHILD_MANIFEST_4,
            builder.DEFAULT_NPS_CHILD_AUDIT_4,
            builder.DEFAULT_NPS_CHILD_REVIEW_4,
            builder.DEFAULT_NPS_CHILDREN_5,
            builder.DEFAULT_NPS_CHILD_MANIFEST_5,
            builder.DEFAULT_NPS_CHILD_AUDIT_5,
            builder.DEFAULT_NPS_CHILD_REVIEW_5,
            builder.DEFAULT_NPS_CHILD_CONTRACT,
            builder.DEFAULT_NPS_CHILD_CONTRACT_MANIFEST,
            builder.DEFAULT_NPS_CHILD_CONTRACT_AUDIT,
            builder.DEFAULT_NPS_CHILD_CONTRACT_REVIEW,
            builder.DEFAULT_NPS_CHILD_CONTRACT_DISPOSITIONS,
        )
        if not all(path.is_file() for path in paths):
            raise unittest.SkipTest("local ignored builder evidence is not present in this checkout")

    def test_accepted_r7_binding_is_exact_and_internal_only(self):
        self._require_local_builder_evidence()
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

        children_2, binding_2 = builder._validated_nps_child_depth(
            builder.DEFAULT_NPS_CHILDREN_2,
            builder.DEFAULT_NPS_CHILD_MANIFEST_2,
            builder.DEFAULT_NPS_CHILD_AUDIT_2,
            builder.DEFAULT_NPS_CHILD_REVIEW_2,
            accepted_paths=(
                builder.DEFAULT_NPS_CHILDREN_2, builder.DEFAULT_NPS_CHILD_MANIFEST_2,
                builder.DEFAULT_NPS_CHILD_AUDIT_2, builder.DEFAULT_NPS_CHILD_REVIEW_2,
            ),
            accepted_hashes=builder.ACCEPTED_NPS_CHILD_HASHES_2,
            accepted_batch_id="post-b08-nps-child-depth-b2",
        )
        self.assertEqual(len(children_2), 170)
        self.assertEqual(binding_2["artifact_sha256"], builder.ACCEPTED_NPS_CHILD_HASHES_2["nps_child_depth_v1.json"])
        self.assertFalse(set(item["id"] for item in children).intersection(item["id"] for item in children_2))

        children_3, binding_3 = builder._validated_nps_child_depth(
            builder.DEFAULT_NPS_CHILDREN_3,
            builder.DEFAULT_NPS_CHILD_MANIFEST_3,
            builder.DEFAULT_NPS_CHILD_AUDIT_3,
            builder.DEFAULT_NPS_CHILD_REVIEW_3,
            accepted_paths=(
                builder.DEFAULT_NPS_CHILDREN_3, builder.DEFAULT_NPS_CHILD_MANIFEST_3,
                builder.DEFAULT_NPS_CHILD_AUDIT_3, builder.DEFAULT_NPS_CHILD_REVIEW_3,
            ),
            accepted_hashes=builder.ACCEPTED_NPS_CHILD_HASHES_3,
            accepted_batch_id="post-b08-nps-child-depth-b3",
        )
        self.assertEqual(len(children_3), 131)
        self.assertEqual(binding_3["artifact_sha256"], builder.ACCEPTED_NPS_CHILD_HASHES_3["nps_child_depth_v1.json"])
        self.assertFalse(
            set(item["id"] for item in [*children, *children_2]).intersection(
                item["id"] for item in children_3
            )
        )

        children_4, binding_4 = builder._validated_nps_child_depth(
            builder.DEFAULT_NPS_CHILDREN_4,
            builder.DEFAULT_NPS_CHILD_MANIFEST_4,
            builder.DEFAULT_NPS_CHILD_AUDIT_4,
            builder.DEFAULT_NPS_CHILD_REVIEW_4,
            accepted_paths=(
                builder.DEFAULT_NPS_CHILDREN_4, builder.DEFAULT_NPS_CHILD_MANIFEST_4,
                builder.DEFAULT_NPS_CHILD_AUDIT_4, builder.DEFAULT_NPS_CHILD_REVIEW_4,
            ),
            accepted_hashes=builder.ACCEPTED_NPS_CHILD_HASHES_4,
            accepted_batch_id="post-b09-nps-child-depth-b4",
        )
        self.assertEqual(len(children_4), 97)
        self.assertEqual(binding_4["artifact_sha256"], builder.ACCEPTED_NPS_CHILD_HASHES_4["nps_child_depth_v1.json"])
        self.assertFalse(
            set(item["id"] for item in [*children, *children_2, *children_3]).intersection(
                item["id"] for item in children_4
            )
        )

        children_5, binding_5 = builder._validated_nps_child_depth(
            builder.DEFAULT_NPS_CHILDREN_5,
            builder.DEFAULT_NPS_CHILD_MANIFEST_5,
            builder.DEFAULT_NPS_CHILD_AUDIT_5,
            builder.DEFAULT_NPS_CHILD_REVIEW_5,
            accepted_paths=(
                builder.DEFAULT_NPS_CHILDREN_5, builder.DEFAULT_NPS_CHILD_MANIFEST_5,
                builder.DEFAULT_NPS_CHILD_AUDIT_5, builder.DEFAULT_NPS_CHILD_REVIEW_5,
            ),
            accepted_hashes=builder.ACCEPTED_NPS_CHILD_HASHES_5,
            accepted_batch_id="post-b09-nps-child-depth-b5",
        )
        self.assertEqual(len(children_5), 70)
        self.assertEqual(
            binding_5["artifact_sha256"],
            builder.ACCEPTED_NPS_CHILD_HASHES_5["nps_child_depth_v1.json"],
        )
        self.assertFalse(
            set(item["id"] for item in [*children, *children_2, *children_3, *children_4]).intersection(
                item["id"] for item in children_5
            )
        )

        contract_children, contract_binding = builder._validated_nps_child_contract(
            builder.DEFAULT_NPS_CHILD_CONTRACT,
            builder.DEFAULT_NPS_CHILD_CONTRACT_MANIFEST,
            builder.DEFAULT_NPS_CHILD_CONTRACT_AUDIT,
            builder.DEFAULT_NPS_CHILD_CONTRACT_REVIEW,
            builder.DEFAULT_NPS_CHILD_CONTRACT_DISPOSITIONS,
        )
        self.assertEqual(len(contract_children), 236)
        self.assertEqual(contract_binding["disposition_count"], 394)
        self.assertEqual(contract_binding["advisory_alias_count"], 157)
        self.assertEqual(contract_binding["active_alias_count"], 0)
        self.assertFalse(contract_binding["public_promotion_compatible"])
        self.assertFalse(
            set(item["id"] for item in [*children, *children_2, *children_3, *children_4, *children_5]).intersection(
                item["id"] for item in contract_children
            )
        )

    def test_batch_combiner_preserves_order_and_rejects_cross_batch_duplicates(self):
        first = [{"id": "batch-1"}]
        second = [{"id": "batch-2"}]
        third = [{"id": "batch-3"}]
        fourth = [{"id": "batch-4"}]
        fifth = [{"id": "batch-5"}]
        contract = [{"id": "contract-1"}]
        self.assertEqual(
            [item["id"] for item in builder._combine_nps_child_batches(first, second, third, fourth, fifth, contract)],
            ["batch-1", "batch-2", "batch-3", "batch-4", "batch-5", "contract-1"],
        )
        with self.assertRaises(SystemExit):
            builder._combine_nps_child_batches(first, second, third, fourth, fifth, [{"id": "batch-1"}])

    def test_mount_validator_rejects_source_collision_and_missing_parent(self):
        children = [
            {
                "id": f"place:nps-child:test:places:{index}",
                "source_ids": [f"source-{index}"],
                "parent_hub_id": "place:nps:test",
                "module_target": "see",
            }
            for index in range(860)
        ]
        for index in range(20):
            children[index] = {
                "id": f"place:nps:campgrounds:canonical-{index}",
                "source_ids": [f"source-{index}"],
                "parent_hub_id": "place:nps:test",
                "module_target": "stay",
                "hidden_from_featured": True,
                "canonical_reference": {
                    "canonical_id": f"place:nps:campgrounds:canonical-{index}",
                    "source_child_id": f"place:nps-child:test:campgrounds:{index}",
                },
            }
        contract = children[-236:]
        builder._validate_nps_child_preview_mount(
            children, contract, public_parent_ids={"place:nps:test"},
        )
        collision = copy.deepcopy(children)
        collision[-1]["source_ids"] = ["source-0"]
        with self.assertRaises(SystemExit):
            builder._validate_nps_child_preview_mount(
                collision, collision[-236:], public_parent_ids={"place:nps:test"},
            )
        missing_parent = copy.deepcopy(children)
        missing_parent[-1]["parent_hub_id"] = "place:nps:missing"
        with self.assertRaises(SystemExit):
            builder._validate_nps_child_preview_mount(
                missing_parent, missing_parent[-236:], public_parent_ids={"place:nps:test"},
            )

    def test_manifest_hash_mismatch_is_rejected(self):
        self._require_local_builder_evidence()
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

    def test_generated_sidecar_fails_qa_when_batch_3_binding_drifts(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        payload["candidate"]["nps_child_depth_batches"][2]["artifact_sha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "preview.json"
            path.write_text(json.dumps(payload))
            with self.assertRaises(SystemExit):
                qa.audit(path)

    def test_generated_sidecar_fails_qa_when_contract_binding_drifts(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        payload["candidate"]["nps_child_contract"]["artifact_sha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "preview.json"
            path.write_text(json.dumps(payload))
            with self.assertRaises(SystemExit):
                qa.audit(path)

    def test_generated_sidecar_passes_qa_in_clean_checkout_without_ignored_evidence(self):
        real_is_file = Path.is_file

        def tracked_checkout_is_file(path: Path) -> bool:
            value = path.as_posix()
            if (
                "/post-b08-nps-child-depth-b1-r7/" in value
                or "/post-b08-nps-child-contract-r1/" in value
            ):
                return False
            return real_is_file(path)

        with patch.object(Path, "is_file", tracked_checkout_is_file):
            result = qa.audit(builder.DEFAULT_OUTPUT)
        self.assertTrue(result["passed"])
        self.assertEqual(result["child_count"], 860)

    def test_generated_sidecar_fails_qa_when_accepted_batch_3_file_drifts(self):
        accepted_artifact = (
            qa.ROOT / qa.EXPECTED_NPS_CHILD_BINDING_3["artifact_path"]
        ).resolve()
        if not accepted_artifact.is_file():
            self.skipTest("local ignored builder evidence is not present in this checkout")
        real_sha256 = qa._sha256

        def drift_batch_3(path: Path) -> str:
            if path.resolve() == accepted_artifact:
                return "0" * 64
            return real_sha256(path)

        with patch.object(qa, "_sha256", side_effect=drift_batch_3):
            with self.assertRaises(SystemExit):
                qa.audit(builder.DEFAULT_OUTPUT)

    def test_builder_rejects_self_consistent_alternate_child_artifacts(self):
        self._require_local_builder_evidence()
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

    def test_runtime_corrupt_sidecar_clears_previously_cached_children(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "preview.json"
            path.write_bytes(builder.DEFAULT_OUTPUT.read_bytes())
            server.EXPLORE_INTERNAL_PREVIEW = path
            self.assertEqual(len(server._load_explore_internal_preview_children()), 860)

            path.write_text("{broken json", encoding="utf-8")
            self.assertEqual(server._load_explore_internal_preview_profiles(), [])
            self.assertEqual(server._load_explore_internal_preview_children(), [])
            self.assertEqual(server._EXPLORE_INTERNAL_PREVIEW_CACHE.get("profiles"), [])
            self.assertEqual(server._EXPLORE_INTERNAL_PREVIEW_CACHE.get("children"), [])
            self.assertEqual(server._EXPLORE_INTERNAL_PREVIEW_CACHE.get("status"), "sidecar_invalid")

    def test_runtime_rejects_parseable_public_or_promotable_sidecar(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        self.assertTrue(server._explore_internal_preview_payload_valid(payload))
        public = copy.deepcopy(payload)
        public["stage"] = "public"
        self.assertFalse(server._explore_internal_preview_payload_valid(public))
        promotable = copy.deepcopy(payload)
        promotable["public_promotion_compatible"] = True
        self.assertFalse(server._explore_internal_preview_payload_valid(promotable))

    def test_runtime_rejects_parseable_content_drift(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        mutations = {
            "child copy": lambda value: value["children"][0].__setitem__("name", "Changed child"),
            "child parent": lambda value: value["children"][0].__setitem__("parent_hub_id", "place:nps:grsm"),
            "batch binding": lambda value: value["candidate"]["nps_child_depth_batches"].__setitem__(0, {}),
            "parent payload": lambda value: value["places"].__setitem__(0, {}),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                drifted = copy.deepcopy(payload)
                mutate(drifted)
                self.assertFalse(server._explore_internal_preview_payload_valid(drifted))

    def test_runtime_parseable_content_drift_clears_cached_preview(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "preview.json"
            payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
            path.write_text(json.dumps(payload), encoding="utf-8")
            server.EXPLORE_INTERNAL_PREVIEW = path
            self.assertEqual(len(server._load_explore_internal_preview_children()), 860)

            payload["children"][0]["name"] = "Changed child"
            path.write_text(json.dumps(payload), encoding="utf-8")
            self.assertEqual(server._load_explore_internal_preview_profiles(), [])
            self.assertEqual(server._load_explore_internal_preview_children(), [])
            self.assertEqual(server._EXPLORE_INTERNAL_PREVIEW_CACHE.get("status"), "sidecar_invalid")

    def test_internal_map_card_bypasses_public_cache_both_directions(self):
        shared: dict[str, dict] = {}

        def fake_get(_table, key, ttl_seconds=None):
            return copy.deepcopy(shared.get(key))

        def fake_set(_table, key, value):
            shared[key] = copy.deepcopy(value)

        body = server.MapCardResolveRequest(
            kind="place", id="place:nps:grsm", place_id="place:nps:grsm",
            source="trailhead_explore", name="Great Smoky Mountains National Park",
            lat=35.60, lng=-83.50, type="park",
        )
        empty = {
            "things_to_do": [], "things_to_see": [], "visitor_centers": [],
            "campgrounds_nearby": [], "trails": [], "trip_services": [],
        }

        def canonical_rails(_body):
            result = copy.deepcopy(empty)
            if server._explore_internal_preview_context.get():
                result["campgrounds_nearby"] = [{
                    "id": "preview-child", "name": "Preview child",
                    "lat": 35.61, "lng": -83.51, "type": "camp",
                }]
            return result

        with patch.object(server, "get_cached", side_effect=fake_get) as get_cached, patch.object(
            server, "set_cached", side_effect=fake_set,
        ) as set_cached, patch.object(
            server, "_canonical_search_explore_card", return_value={
                "id": body.id, "name": body.name, "lat": body.lat, "lng": body.lng,
                "type": "park", "source": "nps",
            },
        ), patch.object(
            server, "_canonical_explore_related_rails", side_effect=canonical_rails,
        ), patch.object(
            server, "_discovery_context_smart_places", new=AsyncMock(return_value={"places": []}),
        ), patch.object(
            server, "trails_discover", new=AsyncMock(return_value={"trails": []}),
        ), patch.object(server, "_is_broad_map_place", return_value=False):
            public_first = asyncio.run(server.resolve_map_card(body, None))
            marker = server._explore_internal_preview_context.set(True)
            try:
                internal = asyncio.run(server.resolve_map_card(body, None))
            finally:
                server._explore_internal_preview_context.reset(marker)
            public_after = asyncio.run(server.resolve_map_card(body, None))

        self.assertEqual(public_first["related"]["campgrounds_nearby"], [])
        self.assertEqual(
            [item["id"] for item in internal["related"]["campgrounds_nearby"]],
            ["preview-child"],
        )
        self.assertEqual(internal["cache_status"], "uncached")
        self.assertEqual(internal["cache_ttl_seconds"], 0)
        self.assertFalse(internal["cached"])
        self.assertEqual(public_after["cache_status"], "hit")
        self.assertEqual(public_after["related"]["campgrounds_nearby"], [])
        self.assertEqual(get_cached.call_count, 2)
        self.assertEqual(set_cached.call_count, 1)

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
        self.assertEqual(merged["internal_preview"]["child_count"], 860)
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

    def test_batch_2_child_reaches_detail_search_and_parent_rails_only_in_internal_preview(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        batch_1, batch_2, _, _, _, _ = self._sidecar_batches()
        expected_ids = [item["id"] for item in [*batch_1, *batch_2]]
        self.assertEqual(
            [item["id"] for item in payload["children"][:len(expected_ids)]],
            expected_ids,
        )
        self.assertEqual(payload["children"][len(batch_1)]["id"], batch_2[0]["id"])

        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        merged = server._merge_explore_internal_preview({"catalog_id": "public", "places": []})
        dog_canyon_id = "place:nps-child:gumo:campgrounds:c46d4dbb-5b16-4f5a-bbfa-34c350639b98"
        pinery_trail_id = "place:nps-child:gumo:thingstodo:df5e98a8-895c-44b9-b11b-a815a6a93d46"
        visitor_center_id = "place:nps-child:gumo:visitorcenters:af14f6d0-70ed-4815-963e-e87564f1135c"

        with patch.object(server, "_load_explore_catalog", return_value=merged):
            server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update({"key": None, "by_parent": {}})
            parent_children = server._explore_children_for_parent("place:nps:gumo")
            parent_ids = [item["id"] for item in parent_children]
            self.assertIn(dog_canyon_id, parent_ids)
            self.assertIn(pinery_trail_id, parent_ids)
            self.assertIn(visitor_center_id, parent_ids)
            self.assertEqual(server._find_explore_place(dog_canyon_id)["id"], dog_canyon_id)

            rails = server._canonical_explore_related_rails(server.MapCardResolveRequest(
                source="trailhead_explore", place_id="place:nps:gumo",
                lat=31.92, lng=-104.87,
            ))
            self.assertIn("Dog Canyon Campground", {item.get("name") for item in rails["campgrounds_nearby"]})
            self.assertIn("Pinery Trail", {item.get("name") for item in rails["trails"]})
            self.assertIn("Pine Springs Visitor Center", {item.get("name") for item in rails["visitor_centers"]})

        request = server.SearchRequestV2(query="Dog Canyon Campground", categories=["campground"], limit=8)
        page = server.SearchPageV2(query=request.query, results=[], revision="public", elapsed_ms=1)
        self.assertEqual(server._search_v2_apply_internal_preview_page(page, request=request).results, [])
        marker = server._explore_internal_preview_context.set(True)
        try:
            searched = server._search_v2_apply_internal_preview_page(page, request=request)
            later_page = server._search_v2_apply_internal_preview_page(
                page,
                request=server.SearchRequestV2(
                    query=request.query, categories=["campground"], cursor="opaque-page-2", limit=8,
                ),
            )
        finally:
            server._explore_internal_preview_context.reset(marker)
        self.assertEqual([item.result_id for item in searched.results], [dog_canyon_id])
        self.assertEqual(searched.results[0].detail_ref, dog_canyon_id)
        self.assertEqual(searched.results[0].kind, "campground")
        self.assertEqual(later_page.results, [])

    def test_batch_3_child_reaches_detail_search_and_parent_rails_only_in_internal_preview(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        batch_1, batch_2, batch_3, batch_4, batch_5, contract = self._sidecar_batches()
        expected_ids = [
            item["id"]
            for item in [*batch_1, *batch_2, *batch_3, *batch_4, *batch_5, *contract]
        ]
        self.assertEqual([item["id"] for item in payload["children"]], expected_ids)
        self.assertEqual(payload["children"][len(batch_1) + len(batch_2)]["id"], batch_3[0]["id"])
        self.assertEqual(
            payload["children"][
                len(batch_1) + len(batch_2) + len(batch_3) + len(batch_4) + len(batch_5)
            ]["id"],
            contract[0]["id"],
        )
        self.assertEqual(payload["candidate"]["nps_child_depth"]["batch_id"], "post-b08-nps-child-depth-b1")
        self.assertEqual(
            [item["batch_id"] for item in payload["candidate"]["nps_child_depth_batches"]],
            [
                "post-b08-nps-child-depth-b1",
                "post-b08-nps-child-depth-b2",
                "post-b08-nps-child-depth-b3",
                "post-b09-nps-child-depth-b4",
                "post-b09-nps-child-depth-b5",
            ],
        )
        self.assertEqual(
            payload["candidate"]["nps_child_contract"]["contract_id"],
            "post-b08-nps-child-contract-r1",
        )
        self.assertEqual(payload["candidate"]["nps_child_contract"]["active_alias_count"], 0)

        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        merged = server._merge_explore_internal_preview({"catalog_id": "public", "places": []})
        campground_id = "place:nps-child:bibe:campgrounds:127199ac-a753-4b49-b3ff-1f8484b61cbe"
        trail_id = "place:nps-child:bibe:thingstodo:02304e24-cabf-40d1-904f-e67e4c837fe7"
        visitor_center_id = "place:nps-child:bibe:visitorcenters:c5f00e54-bf45-46e1-8acf-bbe615867b78"

        with patch.object(server, "_load_explore_catalog", return_value=merged):
            server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update({"key": None, "by_parent": {}})
            parent_children = server._explore_children_for_parent("place:nps:bibe")
            parent_ids = [item["id"] for item in parent_children]
            self.assertIn(campground_id, parent_ids)
            self.assertIn(trail_id, parent_ids)
            self.assertIn(visitor_center_id, parent_ids)
            self.assertEqual(server._find_explore_place(campground_id)["id"], campground_id)

            with patch.object(server, "_canonical_explore_place_id", return_value="place:nps:bibe"):
                rails = server._canonical_explore_related_rails(server.MapCardResolveRequest(
                    source="trailhead_explore", place_id="place:nps:bibe",
                    lat=29.25, lng=-103.25,
                ))
            self.assertIn("Chisos Basin Campground", {item.get("name") for item in rails["campgrounds_nearby"]})
            self.assertIn("Hike the Lost Mine Trail", {item.get("name") for item in rails["trails"]})
            self.assertIn("Panther Junction Visitor Center", {item.get("name") for item in rails["visitor_centers"]})

        request = server.SearchRequestV2(query="Chisos Basin Campground", categories=["campground"], limit=8)
        page = server.SearchPageV2(query=request.query, results=[], revision="public", elapsed_ms=1)
        self.assertEqual(server._search_v2_apply_internal_preview_page(page, request=request).results, [])
        marker = server._explore_internal_preview_context.set(True)
        try:
            searched = server._search_v2_apply_internal_preview_page(page, request=request)
            later_page = server._search_v2_apply_internal_preview_page(
                page,
                request=server.SearchRequestV2(
                    query=request.query, categories=["campground"], cursor="opaque-page-2", limit=8,
                ),
            )
        finally:
            server._explore_internal_preview_context.reset(marker)
        self.assertEqual([item.result_id for item in searched.results], [campground_id])
        self.assertEqual(searched.results[0].detail_ref, campground_id)
        self.assertEqual(searched.results[0].kind, "campground")
        self.assertEqual(later_page.results, [])

    def test_batch_4_is_before_contract_and_reaches_indiana_dunes_only_in_internal_preview(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        _, _, batch_3, batch_4, batch_5, contract = self._sidecar_batches()
        self.assertEqual(len(batch_4), 97)
        self.assertEqual(payload["children"][457]["id"], batch_4[0]["id"])
        self.assertEqual(payload["children"][554]["id"], batch_5[0]["id"])
        self.assertEqual(payload["children"][624]["id"], contract[0]["id"])
        self.assertEqual(
            {item["parent_hub_id"] for item in batch_4},
            {"place:nps:hosp", "place:nps:hove", "place:nps:indu", "place:nps:jeca", "place:nps:joda"},
        )
        self.assertTrue(all(item["hidden_from_featured"] for item in batch_4))
        self.assertFalse(set(item["id"] for item in batch_3).intersection(item["id"] for item in batch_4))

        public_index = json.loads(builder.DEFAULT_SERVING.read_text())
        public_ids = {
            str(item.get("id") or "")
            for item in public_index.get("items") or []
            if isinstance(item, dict)
        }
        self.assertTrue({item["parent_hub_id"] for item in batch_4}.issubset(public_ids))

        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        merged = server._merge_explore_internal_preview({"catalog_id": "public", "places": []})
        dunewood_id = "place:nps-child:indu:campgrounds:b526c74a-2287-48d2-a480-f4fd2f832ce5"

        with patch.object(server, "_load_explore_catalog", return_value=merged):
            server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update({"key": None, "by_parent": {}})
            parent_children = server._explore_children_for_parent("place:nps:indu")
            self.assertIn(dunewood_id, {item["id"] for item in parent_children})
            self.assertEqual(server._find_explore_place(dunewood_id)["id"], dunewood_id)
            with patch.object(server, "_canonical_explore_place_id", return_value="place:nps:indu"):
                rails = server._canonical_explore_related_rails(server.MapCardResolveRequest(
                    source="trailhead_explore", place_id="place:nps:indu",
                    lat=41.65, lng=-87.05,
                ))
            self.assertIn("Dunewood Campground", {
                item.get("name") for item in rails["campgrounds_nearby"]
            })

        request = server.SearchRequestV2(
            query="Dunewood Campground", categories=["campground"], limit=8,
        )
        page = server.SearchPageV2(query=request.query, results=[], revision="public", elapsed_ms=1)
        self.assertEqual(server._search_v2_apply_internal_preview_page(page, request=request).results, [])
        marker = server._explore_internal_preview_context.set(True)
        try:
            searched = server._search_v2_apply_internal_preview_page(page, request=request)
        finally:
            server._explore_internal_preview_context.reset(marker)
        self.assertEqual([item.result_id for item in searched.results], [dunewood_id])
        self.assertEqual(searched.results[0].detail_ref, dunewood_id)
        self.assertEqual(searched.results[0].kind, "campground")

    def test_batch_5_is_before_contract_and_reaches_sandboarding_only_in_internal_preview(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        _, _, _, batch_4, batch_5, contract = self._sidecar_batches()
        self.assertEqual(len(batch_5), 70)
        self.assertEqual(payload["children"][554]["id"], batch_5[0]["id"])
        self.assertEqual(payload["children"][624]["id"], contract[0]["id"])
        self.assertEqual(
            {item["parent_hub_id"] for item in batch_5},
            {
                "place:nps:amis", "place:nps:asis", "place:nps:care",
                "place:nps:crla", "place:nps:grsa",
            },
        )
        self.assertTrue(all(item["hidden_from_featured"] for item in batch_5))
        self.assertFalse(
            set(item["id"] for item in batch_4).intersection(item["id"] for item in batch_5)
        )

        proof_id = (
            "place:nps-child:grsa:thingstodo:"
            "df98997d-01fc-4016-a90c-53dbc7faae4d"
        )
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        merged = server._merge_explore_internal_preview({"catalog_id": "public", "places": []})

        with patch.object(server, "_load_explore_catalog", return_value=merged):
            server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update({"key": None, "by_parent": {}})
            parent_children = server._explore_children_for_parent("place:nps:grsa")
            self.assertIn(proof_id, {item["id"] for item in parent_children})
            detail = server._find_explore_place(proof_id)
            self.assertEqual(detail["id"], proof_id)
            self.assertEqual(detail["module_target"], "do")
            self.assertEqual(detail["category"], "activity")
            self.assertTrue((detail.get("summary") or {}).get("image_url"))
            self.assertEqual(
                (detail.get("source_pack") or {}).get("official_url"),
                "https://www.nps.gov/thingstodo/sandboarding-and-sand-sledding.htm",
            )
            self.assertEqual((detail.get("profile") or {}).get("what_to_know"), "")
            self.assertEqual((detail.get("profile") or {}).get("best_time_to_stop"), "")
            self.assertEqual((detail.get("profile") or {}).get("access_notes"), "")
            self.assertEqual((detail.get("profile") or {}).get("nearby_context"), "")
            with patch.object(server, "_canonical_explore_place_id", return_value="place:nps:grsa"):
                rails = server._canonical_explore_related_rails(server.MapCardResolveRequest(
                    source="trailhead_explore", place_id="place:nps:grsa",
                    lat=37.73, lng=-105.51,
                ))
            self.assertIn(
                "Sandboarding and Sand Sledding",
                {item.get("name") for item in rails["things_to_do"]},
            )

        request = server.SearchRequestV2(
            query="Sandboarding and Sand Sledding", categories=["activity"], limit=8,
        )
        page = server.SearchPageV2(query=request.query, results=[], revision="public", elapsed_ms=1)
        self.assertEqual(server._search_v2_apply_internal_preview_page(page, request=request).results, [])
        marker = server._explore_internal_preview_context.set(True)
        try:
            searched = server._search_v2_apply_internal_preview_page(page, request=request)
        finally:
            server._explore_internal_preview_context.reset(marker)
        self.assertEqual([item.result_id for item in searched.results], [proof_id])
        self.assertEqual(searched.results[0].detail_ref, proof_id)

    def test_batch_5_canonical_camp_shadows_keep_full_detail_and_booking_context(self):
        payload = json.loads(builder.DEFAULT_OUTPUT.read_text())
        batch_5 = payload["children"][554:624]
        camps = [
            item for item in batch_5
            if str(item.get("id") or "").startswith("place:nps:campgrounds:")
        ]
        self.assertEqual(len(camps), 20)
        self.assertEqual(sum(bool(item.get("reservation_url")) for item in camps), 13)
        self.assertEqual(len({item["id"] for item in camps}), 20)
        oceanside = next(
            item for item in camps
            if item["id"] == "place:nps:campgrounds:eb7177ad-9252-4cad-b85d-08d9be25aa25"
        )
        oceanside_profile = server._explore_v3_place_to_profile(oceanside)
        self.assertEqual(
            oceanside_profile["official_url"],
            "https://www.nps.gov/asis/planyourvisit/oceanside-drive-in-campground-reservation.htm",
        )
        self.assertNotIn("cms.nps.gov", oceanside_profile["official_url"])

        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        merged = server._merge_explore_internal_preview({"catalog_id": "public", "places": []})
        canonical = {
            "summary": {"title": "Canonical campground"},
            "profile": {"summary": "Stored full campground detail"},
            "site_types": ["tent"],
            "campsites": [{"id": "stored-site"}],
            "campground_brief": {"status": "ready"},
            "source_pack": {"sources": [{"title": "Stored source", "url": "https://example.test"}]},
        }
        with patch.object(server, "_load_explore_catalog", return_value=merged), patch.object(
            server,
            "_canonical_camp_explore_profile_by_id",
            side_effect=lambda place_id: {"id": place_id, **copy.deepcopy(canonical)},
        ):
            for camp in camps:
                with self.subTest(camp=camp["id"]):
                    detail = server._find_explore_place(camp["id"])
                    self.assertEqual(detail["id"], camp["id"])
                    self.assertEqual(detail["canonical_role"], "child")
                    self.assertEqual(detail["parent_hub_id"], camp["parent_hub_id"])
                    self.assertEqual(detail["module_target"], "stay")
                    self.assertTrue(detail["hidden_from_featured"])
                    self.assertEqual(detail["site_types"], ["tent"])
                    self.assertEqual(detail["campsites"], [{"id": "stored-site"}])
                    self.assertEqual(detail["campground_brief"], {"status": "ready"})
                    expected_booking = str(camp.get("reservation_url") or "")
                    self.assertEqual(str(detail.get("reservation_url") or ""), expected_booking)
                    self.assertEqual(
                        str((detail.get("source_pack") or {}).get("booking_url") or ""),
                        expected_booking,
                    )
                    if expected_booking:
                        self.assertEqual(
                            str((detail.get("reservations") or {}).get("url") or ""),
                            expected_booking,
                        )

        marker = server._explore_internal_preview_context.set(True)
        try:
            with patch.object(server, "_load_explore_catalog", return_value=merged):
                for camp in camps:
                    with self.subTest(camp_detail=camp["id"]):
                        stored = server._explore_catalog_camp_detail(camp["id"])
                        self.assertIsNotNone(stored)
                        self.assertEqual(stored["id"], camp["id"])
                        self.assertEqual(
                            str(stored.get("booking_url") or ""),
                            str(camp.get("reservation_url") or ""),
                        )
        finally:
            server._explore_internal_preview_context.reset(marker)

        permit = next(item for item in camps if "/permits/" in str(item.get("reservation_url") or ""))
        self.assertEqual(permit["reservation_url"], "https://www.recreation.gov/permits/4675316")
        self.assertEqual(
            server._direct_recreation_campground_booking(permit["reservation_url"]),
            permit["reservation_url"],
        )
        self.assertEqual(
            server._direct_recreation_campground_booking(
                "https://evil.example/permits/4675316"
            ),
            "",
        )

    def test_contract_child_reaches_parent_detail_search_and_map_rail_only_in_preview(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        parent = {
            "id": "place:nps:glca",
            "summary": {"title": "Glen Canyon National Recreation Area", "lat": 37.1, "lng": -111.2},
            "source_pack": {"primary": "National Park Service"},
        }
        merged = server._merge_explore_internal_preview({"catalog_id": "public", "places": [parent]})
        bullfrog_id = "place:nps-child:glca:campgrounds:4285489c-2d25-4967-91e7-18597c645a0f"

        with patch.object(server, "_load_explore_catalog", return_value=merged):
            server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update({"key": None, "by_parent": {}})
            self.assertEqual(server._find_explore_place(bullfrog_id)["id"], bullfrog_id)
            parent_children = server._explore_children_for_parent(parent["id"])
            self.assertIn(bullfrog_id, {item["id"] for item in parent_children})
            with patch.object(server, "_canonical_explore_place_id", return_value=parent["id"]):
                rails = server._canonical_explore_related_rails(server.MapCardResolveRequest(
                    source="trailhead_explore", place_id=parent["id"], lat=37.1, lng=-111.2,
                ))
            self.assertIn("Bullfrog RV & Campground", {
                item.get("name") for item in rails["campgrounds_nearby"]
            })

        request = server.SearchRequestV2(
            query="Bullfrog RV & Campground", categories=["campground"], limit=8,
        )
        page = server.SearchPageV2(query=request.query, results=[], revision="public", elapsed_ms=1)
        self.assertEqual(server._search_v2_apply_internal_preview_page(page, request=request).results, [])
        marker = server._explore_internal_preview_context.set(True)
        try:
            searched = server._search_v2_apply_internal_preview_page(page, request=request)
        finally:
            server._explore_internal_preview_context.reset(marker)
        self.assertEqual([item.result_id for item in searched.results], [bullfrog_id])
        bullfrog = next(item for item in merged["places"] if item.get("id") == bullfrog_id)
        visible_copy = " ".join((
            str((bullfrog.get("summary") or {}).get("short_description") or ""),
            str((bullfrog.get("profile") or {}).get("summary") or ""),
            str((bullfrog.get("profile") or {}).get("story") or ""),
        ))
        self.assertNotIn("http://", visible_copy)
        self.assertNotIn("https://", visible_copy)

    def test_parent_title_collision_does_not_outrank_acadia_hub(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        provenance = server.SearchProvenanceV2(
            provider="trailhead", source_label="National Park Service",
            provider_result_id="place:nps:acad", attribution="National Park Service",
            temporary_use_only=False,
        )
        parent = server.SearchResultV2(
            result_id="place:nps:acad", canonical_place_id="place:nps:acad",
            title="Acadia National Park", kind="park", categories=["park"],
            provenance=provenance, persistence_policy="canonical",
            detail_ref="place:nps:acad", score=1000, match_reason="exact_title",
        )
        page = server.SearchPageV2(
            query="Acadia National Park", results=[parent], revision="public", elapsed_ms=1,
        )
        marker = server._explore_internal_preview_context.set(True)
        try:
            result = server._search_v2_apply_internal_preview_page(
                page, request=server.SearchRequestV2(query=page.query, limit=8),
            )
        finally:
            server._explore_internal_preview_context.reset(marker)
        self.assertEqual([item.result_id for item in result.results], ["place:nps:acad"])

    def test_acadia_projection_omits_parent_copy_and_keeps_reviewed_gateway_once(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        parent = {
            "id": "place:nps:acad",
            "summary": {"title": "Acadia National Park", "lat": 44.35, "lng": -68.25},
            "source_pack": {"primary": "National Park Service"},
        }
        merged = server._merge_explore_internal_preview({"catalog_id": "public", "places": [parent]})
        marker = server._explore_internal_preview_context.set(True)
        try:
            with patch.object(server, "_load_explore_catalog", return_value=merged):
                server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update({"key": None, "by_parent": {}})
                projected = server._attach_internal_preview_child_source_pack(parent)
        finally:
            server._explore_internal_preview_context.reset(marker)

        self.assertNotIn(
            "Acadia National Park",
            [item.get("title") for item in projected["source_pack"].get("things_to_see", [])],
        )
        all_items = [
            item
            for key in ("things_to_see", "things_to_do", "campgrounds", "visitor_centers")
            for item in projected["source_pack"].get(key, [])
        ]
        gateway_id = "place:nps-child:acad:visitorcenters:99b33fa9-2579-415c-b2c7-2a29879744f8"
        self.assertEqual(
            [item.get("source_id") for item in all_items].count(gateway_id),
            1,
        )
        self.assertFalse(any("bea85a63" in str(item.get("source_id") or "") for item in all_items))

    def test_internal_parent_projection_exposes_all_smokies_stays_without_public_mutation(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        parent = {
            "id": "place:nps:grsm",
            "summary": {"title": "Great Smoky Mountains National Park", "lat": 35.6, "lng": -83.5},
            "source_pack": {
                "primary": "National Park Service",
                "campgrounds": [{"title": "Camping information", "source_id": "official-camping"}],
            },
        }
        original = copy.deepcopy(parent)
        merged = server._merge_explore_internal_preview({"catalog_id": "public", "places": [parent]})
        marker = server._explore_internal_preview_context.set(True)
        try:
            with patch.object(server, "_load_explore_catalog", return_value=merged):
                server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update({"key": None, "by_parent": {}})
                internal = server._attach_internal_preview_child_source_pack(parent)
        finally:
            server._explore_internal_preview_context.reset(marker)
        canonical = [
            item for item in internal["source_pack"]["campgrounds"]
            if str(item.get("source_id") or "").startswith("place:nps-child:grsm:campgrounds:")
        ]
        self.assertEqual(len(canonical), 13)
        self.assertEqual(canonical[-1]["title"], "Smokemont Group Campground")
        self.assertEqual(parent, original)
        self.assertIs(server._attach_internal_preview_child_source_pack(parent), parent)

    def test_internal_parent_projection_preserves_reviewed_child_media_rights(self):
        os.environ["TRAILHEAD_EXPLORE_DATA_STAGE"] = "internal"
        server.EXPLORE_INTERNAL_PREVIEW = builder.DEFAULT_OUTPUT
        parent = {
            "id": "place:nps:blri",
            "summary": {"title": "Blue Ridge Parkway", "lat": 36.5, "lng": -80.9},
            "source_pack": {"primary": "National Park Service"},
        }
        merged = server._merge_explore_internal_preview({"catalog_id": "public", "places": [parent]})
        marker = server._explore_internal_preview_context.set(True)
        try:
            with patch.object(server, "_load_explore_catalog", return_value=merged):
                server._EXPLORE_CHILDREN_BY_PARENT_CACHE.update({"key": None, "by_parent": {}})
                projected = server._attach_internal_preview_child_source_pack(parent)
        finally:
            server._explore_internal_preview_context.reset(marker)
        doughton = next(
            item
            for item in projected["source_pack"]["campgrounds"]
            if item.get("title") == "Doughton Park Campground"
        )
        self.assertEqual(
            doughton["image_caption"],
            "In summer, wildflowers bloom in the fields around Doughton Park",
        )
        self.assertEqual(doughton["image_credit"], "NPS Photo")
        self.assertEqual(doughton["image_license"], "National Park Service public data")
        self.assertEqual(doughton["image_rights_state"], "source_terms_reviewed")


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
