from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dashboard import server


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ExplorePublicPromotionRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(
            dir=server._EXPLORE_REPO_ROOT / "data",
            prefix="explore-public-runtime-",
        )
        self.root = Path(self._tmp.name)
        self.catalog_path = self.root / "explore_catalog_v3.json"
        self.index_path = self.root / "explore_serving_index_v2.json"
        self.manifest_path = self.root / "manifest.json"
        self.input_path = self.root / "candidate.json"
        self.input_path.write_text(json.dumps({"records": [{"id": "candidate"}]}))

        self.catalog = {
            "schema_version": 3,
            "catalog_id": "explore-public-test",
            "count": 2,
            "places": [
                {
                    "id": "place:usfs:new-camp",
                    "name": "New Camp",
                    "category": "campground",
                    "lat": 37.1,
                    "lng": -119.1,
                    "description": "A reviewed public campground.",
                    "sources": [],
                },
                {
                    "id": "place:nps:parent",
                    "name": "Parent Park",
                    "category": "park",
                    "lat": 37.2,
                    "lng": -119.2,
                    "description": "A reviewed public park.",
                    "sources": [],
                },
            ],
        }
        self.index = {
            "schema_version": 2,
            "count": 2,
            "reviewable_count": 2,
            "gate": {"passed": True},
            "items": [
                {
                    "id": "place:usfs:new-camp",
                    "title": "New Camp",
                    "category": "campground",
                    "group": "camps",
                    "lat": 37.1,
                    "lng": -119.1,
                    "description": "A reviewed public campground.",
                    "reviewable": True,
                },
                {
                    "id": "place:nps:parent",
                    "title": "Parent Park",
                    "category": "park",
                    "group": "parks",
                    "lat": 37.2,
                    "lng": -119.2,
                    "description": "A reviewed public park.",
                    "reviewable": True,
                },
            ],
        }
        self.catalog_path.write_text(json.dumps(self.catalog, sort_keys=True))
        self.index_path.write_text(json.dumps(self.index, sort_keys=True))

        self._old_catalog = server.EXPLORE_CATALOG_V3
        self._old_index = server.EXPLORE_SERVING_INDEX
        self._old_manifest = server.EXPLORE_PUBLIC_PROMOTION_MANIFEST
        self._old_explicit_paths = dict(server._EXPLORE_PUBLIC_PROMOTION_EXPLICIT_PATHS)
        self._old_promotion_cache = copy.deepcopy(server._EXPLORE_PUBLIC_PROMOTION_CACHE)
        self._old_promoted_index_cache = copy.deepcopy(server._EXPLORE_PROMOTED_INDEX_CACHE)
        self._old_catalog_cache = copy.deepcopy(server._EXPLORE_CATALOG_CACHE)

        server.EXPLORE_CATALOG_V3 = self.catalog_path
        server.EXPLORE_SERVING_INDEX = self.index_path
        server.EXPLORE_PUBLIC_PROMOTION_MANIFEST = self.manifest_path
        server._EXPLORE_PUBLIC_PROMOTION_EXPLICIT_PATHS.update({
            "catalog_v3": True,
            "serving_index": True,
            "manifest": True,
        })
        self._write_manifest()
        self._clear_caches()

    def tearDown(self) -> None:
        server.EXPLORE_CATALOG_V3 = self._old_catalog
        server.EXPLORE_SERVING_INDEX = self._old_index
        server.EXPLORE_PUBLIC_PROMOTION_MANIFEST = self._old_manifest
        server._EXPLORE_PUBLIC_PROMOTION_EXPLICIT_PATHS.clear()
        server._EXPLORE_PUBLIC_PROMOTION_EXPLICIT_PATHS.update(self._old_explicit_paths)
        server._EXPLORE_PUBLIC_PROMOTION_CACHE.clear()
        server._EXPLORE_PUBLIC_PROMOTION_CACHE.update(self._old_promotion_cache)
        server._EXPLORE_PROMOTED_INDEX_CACHE.clear()
        server._EXPLORE_PROMOTED_INDEX_CACHE.update(self._old_promoted_index_cache)
        server._EXPLORE_CATALOG_CACHE.clear()
        server._EXPLORE_CATALOG_CACHE.update(self._old_catalog_cache)
        self._tmp.cleanup()

    def _relative(self, path: Path) -> str:
        return path.resolve().relative_to(server._EXPLORE_REPO_ROOT.resolve()).as_posix()

    def _manifest(self) -> dict:
        return {
            "schema": "explore_public_promotion_manifest_v1",
            "release_id": "test-b08-top-level",
            "stage": "top_level",
            "expected_current": {
                "release_id": "previous-public",
                "catalog_v3_sha256": "a" * 64,
                "serving_index_sha256": "b" * 64,
            },
            "inputs": [{
                "id": "accepted-candidate",
                "path": self._relative(self.input_path),
                "sha256": _sha256(self.input_path),
                "count": 1,
            }],
            "artifacts": {
                "catalog_v3": {
                    "path": self._relative(self.catalog_path),
                    "sha256": _sha256(self.catalog_path),
                    "count": len(self.catalog["places"]),
                },
                "serving_index": {
                    "path": self._relative(self.index_path),
                    "sha256": _sha256(self.index_path),
                    "count": len(self.index["items"]),
                },
            },
            "aliases": [{
                "from_id": "place:ridb:old-camp",
                "to_id": "place:usfs:new-camp",
                "reason": "Reviewed source replacement",
            }],
            "child_dispositions": [],
            "reviewed_exceptions": {},
            "rollback": {
                "release_id": "previous-public",
                "git_commit": "1" * 40,
                "railway_deployment_id": "deployment-previous",
                "manifest_path": self._relative(self.manifest_path),
            },
        }

    def _write_manifest(self, mutate=None) -> dict:
        manifest = self._manifest()
        if mutate:
            mutate(manifest)
        self.manifest_path.write_text(json.dumps(manifest, sort_keys=True))
        return manifest

    def _clear_caches(self) -> None:
        server._EXPLORE_PUBLIC_PROMOTION_CACHE.update({"key": None, "state": None})
        server._EXPLORE_PROMOTED_INDEX_CACHE.update({"key": None, "payload": None})
        server._EXPLORE_CATALOG_CACHE.update({"key": None, "loaded_at": 0.0, "catalog": None})

    def test_valid_release_is_checked_at_startup_and_exposes_minimal_diagnostics(self):
        asyncio.run(server._validate_explore_public_promotion_startup())

        state = server._validate_explore_public_promotion()
        self.assertEqual(state["release_id"], "test-b08-top-level")
        self.assertEqual(state["catalog_count"], 2)
        self.assertEqual(state["index_count"], 2)
        self.assertEqual(state["alias_count"], 1)
        diagnostics = server._explore_public_release_diagnostics()
        self.assertEqual(diagnostics["status"], "ready")
        self.assertEqual(diagnostics["catalog_hash"], _sha256(self.catalog_path)[:12])
        self.assertEqual(diagnostics["serving_index_hash"], _sha256(self.index_path)[:12])
        self.assertNotIn(str(self.root), json.dumps(diagnostics))

    def test_validation_verifies_the_prebuilt_served_catalog(self):
        self._clear_caches()
        with patch.object(
            server,
            "_verify_explore_public_served_catalog",
            wraps=server._verify_explore_public_served_catalog,
        ) as verify:
            server._validate_explore_public_promotion()

        verify.assert_called_once()
        self.assertEqual(verify.call_args.kwargs["state"]["release_id"], "test-b08-top-level")

    def test_startup_fails_closed_when_artifact_hash_drifts(self):
        self.catalog_path.write_text(json.dumps({**self.catalog, "catalog_id": "drifted"}))
        self._clear_caches()

        with self.assertRaisesRegex(RuntimeError, "catalog_v3 hash mismatch"):
            asyncio.run(server._validate_explore_public_promotion_startup())

    def test_startup_fails_closed_when_catalog_schema_is_wrong(self):
        self.catalog["schema_version"] = 2
        self.catalog_path.write_text(json.dumps(self.catalog, sort_keys=True))
        self._write_manifest()
        self._clear_caches()

        with self.assertRaisesRegex(RuntimeError, "catalog_v3 schema version"):
            server._validate_explore_public_promotion()

    def test_manifest_rejects_repository_traversal(self):
        self._write_manifest(
            lambda manifest: manifest["artifacts"]["catalog_v3"].update({"path": "../outside.json"}),
        )
        self._clear_caches()

        with self.assertRaisesRegex(RuntimeError, "escapes the repository"):
            server._validate_explore_public_promotion()

    def test_partial_environment_configuration_fails_closed(self):
        server._EXPLORE_PUBLIC_PROMOTION_EXPLICIT_PATHS["serving_index"] = False
        self._clear_caches()

        with self.assertRaisesRegex(RuntimeError, "requires catalog, serving-index, and manifest"):
            server._validate_explore_public_promotion()

    def test_legacy_serving_index_configuration_does_not_enable_manifest_contract(self):
        server._EXPLORE_PUBLIC_PROMOTION_EXPLICIT_PATHS.update({
            "catalog_v3": False,
            "serving_index": True,
            "manifest": False,
        })
        server.EXPLORE_PUBLIC_PROMOTION_MANIFEST = None
        self._clear_caches()

        state = server._validate_explore_public_promotion()

        self.assertEqual(state["status"], "not_configured")
        self.assertFalse(state["enabled"])

    def test_aliases_resolve_old_deep_links_to_reviewed_public_identity(self):
        canonical = {"id": "place:usfs:new-camp", "summary": {"title": "New Camp"}}
        with (
            patch.object(server, "_canonical_camp_explore_profile_by_id", return_value=None),
            patch.object(server, "_canonical_serving_profile_by_id", return_value=None),
            patch.object(server, "_pakistan_trek_explore_profile_by_id", return_value=None),
            patch.object(server, "_official_cache_profile_by_id", return_value=None),
            patch.object(server, "_load_explore_catalog", return_value={"places": [canonical]}),
        ):
            resolved = server._find_explore_place("place%3Aridb%3Aold-camp")

        self.assertIs(resolved, canonical)
        self.assertEqual(
            server._resolve_explore_public_id("place:ridb:old-camp"),
            "place:usfs:new-camp",
        )

    def test_map_card_uses_target_identity_and_keeps_alias_as_metadata(self):
        body = server.MapCardResolveRequest(
            source="trailhead_search",
            id="place:ridb:old-camp",
            place_id="place:ridb:old-camp",
            provider_place_id="place:ridb:old-camp",
            name="New Camp",
            lat=37.1,
            lng=-119.1,
        )
        with (
            patch.object(server, "_find_explore_place", return_value={"id": "place:usfs:new-camp"}),
            patch.object(server, "_explore_place_to_nearby_place", return_value={"name": "New Camp"}),
        ):
            card = server._canonical_search_explore_card(body)

        self.assertEqual(card["id"], "place:usfs:new-camp")
        self.assertEqual(card["place_id"], "place:usfs:new-camp")
        self.assertEqual(card["provider_place_id"], "place:usfs:new-camp")
        self.assertEqual(card["legacy_place_id"], "place:ridb:old-camp")

    def test_search_v2_uses_target_identity_and_keeps_alias_in_provenance(self):
        result = server.SearchResultV2(
            result_id="place:ridb:old-camp",
            canonical_place_id="place:ridb:old-camp",
            title="New Camp",
            kind="camp",
            provenance=server.SearchProvenanceV2(
                provider="trailhead",
                source_label="Trailhead",
                provider_result_id="place:ridb:old-camp",
            ),
            persistence_policy="canonical",
            detail_ref="place:ridb:old-camp",
        )

        normalized = server._search_v2_apply_public_alias_result(result)

        self.assertEqual(normalized.result_id, "place:usfs:new-camp")
        self.assertEqual(normalized.canonical_place_id, "place:usfs:new-camp")
        self.assertEqual(normalized.detail_ref, "place:usfs:new-camp")
        self.assertEqual(normalized.provenance.provider_result_id, "place:ridb:old-camp")

    def test_alias_target_must_exist_in_the_public_release(self):
        self._write_manifest(
            lambda manifest: manifest["aliases"][0].update({"to_id": "place:missing"}),
        )
        self._clear_caches()

        with self.assertRaisesRegex(RuntimeError, "alias target is not public"):
            server._validate_explore_public_promotion()

    def test_child_depth_release_requires_accounted_public_dispositions(self):
        def child_depth(manifest: dict) -> None:
            manifest["stage"] = "child_depth"
            manifest["child_dispositions"] = [{
                "source_id": "place:nps:child-source",
                "public_id": "place:nps:parent",
                "disposition": "canonical_merge",
                "reason": "Reviewed duplicate of the canonical public record",
            }]

        self._write_manifest(child_depth)
        self._clear_caches()

        state = server._validate_explore_public_promotion()

        self.assertEqual(state["stage"], "child_depth")
        self.assertEqual(state["child_disposition_count"], 1)

    def test_parent_bound_children_with_the_same_title_remain_distinct(self):
        base = [{
            "id": "place:nps:child-a",
            "parent_hub_id": "place:nps:parent",
            "summary": {"title": "Visitor Center"},
        }]
        sidecars = [{
            "id": "place:nps:child-b",
            "parent_hub_id": "place:nps:other-parent",
            "summary": {"title": "Visitor Center"},
        }]

        merged = server._merge_explore_v3_sidecar_profiles(base, sidecars)

        self.assertEqual(
            [item["id"] for item in merged],
            ["place:nps:child-a", "place:nps:child-b"],
        )

    def test_catalog_only_child_sidecar_is_valid_but_not_publicly_served(self):
        catalog = copy.deepcopy(self.catalog)
        catalog["places"].append({
            "id": "place:nps-child:parent:places:sidecar",
            "name": "Internal Child Sidecar",
            "category": "viewpoint",
            "lat": 37.21,
            "lng": -119.21,
            "canonical_role": "child",
            "parent_hub_id": "place:nps:parent",
            "module_target": "see",
        })
        catalog["count"] = len(catalog["places"])
        self.catalog = catalog
        self.catalog_path.write_text(json.dumps(catalog, sort_keys=True))
        self._write_manifest()
        self._clear_caches()

        state = server._validate_explore_public_promotion()
        served = server._prebuild_explore_public_served_catalog(catalog, self.index)

        self.assertEqual(state["catalog_count"], 3)
        self.assertEqual(state["index_count"], 2)
        self.assertNotIn(
            "place:nps-child:parent:places:sidecar",
            {item["id"] for item in served["places"]},
        )

    def test_configured_release_does_not_fall_back_when_catalog_loading_fails(self):
        broken_catalog = self.root / "broken-base.json"
        broken_catalog.write_text("not-json")
        self._clear_caches()
        with (
            patch.object(server, "EXPLORE_CATALOG", broken_catalog),
            patch.object(server, "_load_explore_catalog_disk_cache", return_value=None),
        ):
            with self.assertRaises(json.JSONDecodeError):
                server._load_explore_catalog_base()

    def test_versioned_release_does_not_inject_unpinned_missing_filter_supplements(self):
        legacy_path = self.root / "legacy-catalog.json"
        legacy_path.write_text(json.dumps({
            "places": [
                {
                    "id": "place:osm:legacy-fuel",
                    "name": "Legacy Fuel",
                    "category": "fuel",
                    "lat": 37.3,
                    "lng": -119.3,
                },
            ],
        }))
        index = copy.deepcopy(self.index)
        index["missing_filters"] = ["fuel"]

        with patch.object(server, "EXPLORE_CATALOG", legacy_path):
            served = server._prebuild_explore_public_served_catalog(self.catalog, index)

        legacy_places = json.loads(legacy_path.read_text())["places"]
        with patch.object(server, "_load_explore_promoted_index", return_value=index):
            merged, payload = server._merge_promoted_explore_serving_index(legacy_places)

        self.assertEqual(
            {item["id"] for item in served["places"]},
            {"place:usfs:new-camp", "place:nps:parent"},
        )
        self.assertIs(payload, index)
        self.assertEqual(
            {item["id"] for item in merged},
            {"place:usfs:new-camp", "place:nps:parent"},
        )

    def test_cache_identity_changes_with_manifest_even_when_artifacts_do_not(self):
        first_key = server._explore_catalog_cache_key()
        self.manifest_path.write_text(self.manifest_path.read_text() + "\n")
        second_key = server._explore_catalog_cache_key()

        self.assertNotEqual(first_key, second_key)

    def test_internal_preview_header_still_requires_stage_and_admin(self):
        with patch.dict("os.environ", {"TRAILHEAD_EXPLORE_DATA_STAGE": "internal"}):
            self.assertEqual(
                server._explore_internal_preview_request_code(
                    "/api/explore/places", "internal", "",
                ),
                "admin_required",
            )
        with patch.dict("os.environ", {"TRAILHEAD_EXPLORE_DATA_STAGE": "off"}):
            self.assertEqual(
                server._explore_internal_preview_request_code(
                    "/api/explore/places", "internal", "Bearer ignored",
                ),
                "server_stage_off",
            )


if __name__ == "__main__":
    unittest.main()
