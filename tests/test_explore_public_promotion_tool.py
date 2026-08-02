from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import promote_explore_public_release as promoter


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ExplorePublicPromotionToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "release-worktree"
        self.source_root = Path(self.temp.name) / "primary-checkout"
        self.root.mkdir()
        self.source_root.mkdir()

        self.current_catalog = self.root / "dashboard/explore_catalog_v3.json"
        self.current_serving = self.root / "dashboard/explore_serving_index_v2.json"
        self.candidate_catalog = self.source_root / "data/explore/audit_candidates/b08/catalog.json"
        self.candidate_serving = self.source_root / "data/explore/audit_candidates/b08/serving.json"
        self.aliases = self.root / "data/explore/promotion/aliases.json"
        self.dispositions = self.root / "data/explore/promotion/dispositions.json"
        self.exceptions = self.root / "data/explore/promotion/exceptions.json"
        self.rollback_manifest = self.root / "dashboard/explore_releases/pre-b08/manifest.json"

        base_place = {
            "id": "place:nps:test",
            "name": "Test National Park",
            "category": "park",
            "lat": 44.0,
            "lng": -110.0,
            "description": "An official park destination with public visitor information.",
        }
        catalog = {
            "schema_version": 3,
            "catalog_id": "test-catalog",
            "generated_at": 100,
            "count": 1,
            "places": [base_place],
        }
        serving = {
            "schema_version": 2,
            "generated_at": 100,
            "source_count": 1,
            "count": 1,
            "reviewable_count": 1,
            "grade_counts": {"complete": 1},
            "rejection_reason_counts": {},
            "filter_counts": {"parks": 1},
            "missing_filters": [],
            "rejections": [],
            "gate": {"minimum_reviewable": 1, "reviewable_count": 1, "passed": True},
            "items": [{
                "id": "place:nps:test",
                "title": "Test National Park",
                "category": "park",
                "group": "parks",
                "lat": 44.0,
                "lng": -110.0,
                "description": "An official park destination with public visitor information.",
                "reviewable": True,
                "enrichment_grade": "complete",
                "enrichment_score": 90,
            }],
        }
        write_json(self.current_catalog, catalog)
        write_json(self.current_serving, serving)
        write_json(self.candidate_catalog, catalog)
        write_json(self.candidate_serving, serving)
        write_json(self.aliases, {"aliases": []})
        write_json(self.dispositions, {"child_dispositions": []})
        write_json(self.exceptions, {"image_corrections": []})
        write_json(self.rollback_manifest, {
            "schema": promoter.MANIFEST_SCHEMA,
            "release_id": "pre-b08",
            "artifacts": {
                "catalog_v3": {
                    "path": "dashboard/explore_catalog_v3.json",
                    "sha256": sha256(self.current_catalog),
                    "count": 1,
                },
                "serving_index": {
                    "path": "dashboard/explore_serving_index_v2.json",
                    "sha256": sha256(self.current_serving),
                    "count": 1,
                },
            },
        })

    def tearDown(self) -> None:
        self.temp.cleanup()

    def args(self, **overrides: object) -> argparse.Namespace:
        values: dict[str, object] = {
            "release_id": "explore-b08-r1",
            "stage": "top_level",
            "catalog_input": str(self.candidate_catalog.relative_to(self.source_root)),
            "serving_input": str(self.candidate_serving.relative_to(self.source_root)),
            "child_input": [],
            "evidence_input": [],
            "aliases": str(self.aliases.relative_to(self.root)),
            "child_dispositions": str(self.dispositions.relative_to(self.root)),
            "reviewed_exceptions": str(self.exceptions.relative_to(self.root)),
            "current_catalog": str(self.current_catalog.relative_to(self.root)),
            "current_serving": str(self.current_serving.relative_to(self.root)),
            "expected_current_release_id": "pre-b08",
            "expected_current_catalog_sha256": sha256(self.current_catalog),
            "expected_current_serving_sha256": sha256(self.current_serving),
            "expected_catalog_count": 1,
            "expected_serving_count": 1,
            "rollback_release_id": "pre-b08",
            "rollback_git_commit": "a" * 40,
            "rollback_railway_deployment_id": "00000000-0000-4000-8000-000000000001",
            "rollback_manifest_path": "dashboard/explore_releases/pre-b08/manifest.json",
            "output_root": "dashboard/explore_releases",
            "source_root": str(self.source_root),
            "apply": False,
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_dry_run_is_default_non_mutating_and_deterministic(self) -> None:
        first = promoter.promote(self.args(), repo_root=self.root)
        second = promoter.promote(self.args(), repo_root=self.root)

        self.assertFalse(first["applied"])
        self.assertEqual(first["catalog_sha256"], second["catalog_sha256"])
        self.assertEqual(first["serving_sha256"], second["serving_sha256"])
        self.assertEqual(first["manifest_sha256"], second["manifest_sha256"])
        self.assertFalse((self.root / first["target"]).exists())

    def test_manifest_pins_logical_external_inputs_outputs_aliases_and_rollback(self) -> None:
        report = promoter.promote(self.args(), repo_root=self.root)
        manifest = report["manifest"]

        self.assertEqual(set(manifest), {
            "schema",
            "release_id",
            "stage",
            "expected_current",
            "inputs",
            "artifacts",
            "aliases",
            "child_dispositions",
            "reviewed_exceptions",
            "rollback",
        })
        self.assertEqual(manifest["schema"], "explore_public_promotion_manifest_v1")
        self.assertEqual(manifest["release_id"], "explore-b08-r1")
        self.assertEqual(manifest["stage"], "top_level")
        self.assertEqual(
            manifest["inputs"][0]["path"],
            "data/explore/audit_candidates/b08/catalog.json",
        )
        self.assertEqual(manifest["inputs"][0]["sha256"], sha256(self.candidate_catalog))
        self.assertEqual(manifest["artifacts"]["catalog_v3"]["count"], 1)
        self.assertEqual(manifest["artifacts"]["serving_index"]["count"], 1)
        self.assertEqual(manifest["aliases"], [])
        self.assertEqual(manifest["child_dispositions"], [])
        self.assertEqual(manifest["rollback"]["release_id"], "pre-b08")

    def test_child_source_identity_prefers_source_owned_nps_item_id(self) -> None:
        self.assertEqual(
            promoter._child_source_identity({
                "id": "place:nps-child:test:places:legacy-title",
                "source_ids": ["nps:item:ABC-123"],
            }),
            "nps:item:abc-123",
        )

    def test_evidence_input_is_hash_pinned_without_changing_artifacts(self) -> None:
        evidence = self.source_root / "data/explore/audit_candidates/b08/combined-manifest.json"
        write_json(evidence, {
            "count": 2,
            "checks": ["source licensing", "copy review"],
        })
        baseline = promoter.promote(self.args(), repo_root=self.root)
        report = promoter.promote(self.args(
            evidence_input=[
                "combined_manifest=data/explore/audit_candidates/b08/combined-manifest.json",
            ],
        ), repo_root=self.root)

        evidence_ref = next(
            item for item in report["manifest"]["inputs"] if item["id"] == "combined_manifest"
        )
        self.assertEqual(evidence_ref["path"], "data/explore/audit_candidates/b08/combined-manifest.json")
        self.assertEqual(evidence_ref["sha256"], sha256(evidence))
        self.assertEqual(evidence_ref["count"], 2)
        self.assertEqual(report["catalog_sha256"], baseline["catalog_sha256"])
        self.assertEqual(report["serving_sha256"], baseline["serving_sha256"])

    def test_evidence_input_rejects_duplicate_manifest_input_id(self) -> None:
        evidence = self.source_root / "data/explore/audit_candidates/b08/content-review.json"
        write_json(evidence, {"passed": True})
        with self.assertRaisesRegex(promoter.PromotionError, "duplicate manifest input ID"):
            promoter.promote(self.args(
                evidence_input=[
                    "catalog_input=data/explore/audit_candidates/b08/content-review.json",
                ],
            ), repo_root=self.root)

    def test_apply_requires_clean_worktree(self) -> None:
        args = self.args(apply=True)
        with patch.object(promoter, "_git_dirty_paths", return_value=[" M user-owned-file"]):
            with self.assertRaisesRegex(promoter.PromotionError, "clean worktree"):
                promoter.promote(args, repo_root=self.root)
        self.assertFalse((self.root / "dashboard/explore_releases/explore-b08-r1").exists())

    def test_apply_requires_complete_stage_evidence(self) -> None:
        with patch.object(promoter, "_git_dirty_paths", return_value=[]):
            with self.assertRaisesRegex(promoter.PromotionError, "complete top_level evidence"):
                promoter.promote(self.args(apply=True), repo_root=self.root)

    def test_apply_rejects_a_mismatched_rollback_manifest(self) -> None:
        rollback = json.loads(self.rollback_manifest.read_text(encoding="utf-8"))
        rollback["release_id"] = "some-other-release"
        write_json(self.rollback_manifest, rollback)
        with (
            patch.object(promoter, "_git_dirty_paths", return_value=[]),
            patch.object(promoter, "_validate_stage_evidence", return_value={"ready": True}),
        ):
            with self.assertRaisesRegex(promoter.PromotionError, "rollback release"):
                promoter.promote(self.args(apply=True), repo_root=self.root)

    def test_apply_requires_an_existing_rollback_manifest(self) -> None:
        with (
            patch.object(promoter, "_git_dirty_paths", return_value=[]),
            patch.object(promoter, "_validate_stage_evidence", return_value={"ready": True}),
        ):
            with self.assertRaisesRegex(promoter.PromotionError, "existing rollback manifest"):
                promoter.promote(self.args(
                    apply=True,
                    rollback_manifest_path="dashboard/explore_releases/missing/manifest.json",
                ), repo_root=self.root)

    def test_apply_rejects_failed_typed_top_level_evidence(self) -> None:
        evidence_dir = self.source_root / "data/explore/audit_candidates/b08"
        write_json(evidence_dir / "combined.json", {
            "schema_version": 1,
            "catalog_gate_passed": False,
            "live_catalog_modified": False,
            "live_serving_index_modified": False,
        })
        write_json(evidence_dir / "promotion.json", {"schema_version": 1})
        write_json(evidence_dir / "catalog-merge.json", {"schema_version": 1})
        with patch.object(promoter, "_git_dirty_paths", return_value=[]):
            with self.assertRaisesRegex(promoter.PromotionError, "non-mutating catalog gate"):
                promoter.promote(self.args(
                    apply=True,
                    evidence_input=[
                        "combined_manifest=data/explore/audit_candidates/b08/combined.json",
                        "promotion_review=data/explore/audit_candidates/b08/promotion.json",
                        "catalog_merge_review=data/explore/audit_candidates/b08/catalog-merge.json",
                    ],
                ), repo_root=self.root)

    def test_apply_writes_only_an_immutable_versioned_release(self) -> None:
        current_catalog_before = self.current_catalog.read_bytes()
        current_serving_before = self.current_serving.read_bytes()
        with (
            patch.object(promoter, "_git_dirty_paths", return_value=[]),
            patch.object(promoter, "_validate_stage_evidence", return_value={"ready": True}),
        ):
            report = promoter.promote(self.args(apply=True), repo_root=self.root)

        release = self.root / report["target"]
        self.assertTrue((release / "explore_catalog_v3.json").is_file())
        self.assertTrue((release / "explore_serving_index_v2.json").is_file())
        manifest_path = release / "manifest.json"
        self.assertTrue(manifest_path.is_file())
        self.assertEqual(sha256(release / "explore_catalog_v3.json"), report["catalog_sha256"])
        self.assertEqual(sha256(release / "explore_serving_index_v2.json"), report["serving_sha256"])
        self.assertEqual(self.current_catalog.read_bytes(), current_catalog_before)
        self.assertEqual(self.current_serving.read_bytes(), current_serving_before)
        with (
            patch.object(promoter, "_git_dirty_paths", return_value=[]),
            patch.object(promoter, "_validate_stage_evidence", return_value={"ready": True}),
        ):
            with self.assertRaisesRegex(promoter.PromotionError, "already exists"):
                promoter.promote(self.args(apply=True), repo_root=self.root)

    def test_top_level_aliases_remove_reviewed_duplicate_sources_from_artifacts(self) -> None:
        catalog = json.loads(self.candidate_catalog.read_text(encoding="utf-8"))
        catalog["places"].append({
            "id": "place:ridb:duplicate",
            "name": "Test National Park",
            "category": "park",
            "lat": 44.0,
            "lng": -110.0,
            "description": "A duplicate source record.",
        })
        catalog["count"] = 2
        serving = json.loads(self.candidate_serving.read_text(encoding="utf-8"))
        serving["items"].append({
            "id": "place:ridb:duplicate",
            "title": "Test National Park",
            "category": "park",
            "group": "parks",
            "lat": 44.0,
            "lng": -110.0,
            "description": "A duplicate source record.",
            "reviewable": True,
            "enrichment_grade": "complete",
            "enrichment_score": 80,
        })
        serving["count"] = 2
        serving["reviewable_count"] = 2
        write_json(self.candidate_catalog, catalog)
        write_json(self.candidate_serving, serving)
        write_json(self.aliases, {"aliases": [{
            "from_id": "place:ridb:duplicate",
            "to_id": "place:nps:test",
            "reason": "Reviewed duplicate source identity.",
        }]})

        with patch.object(promoter, "_validate_stage_evidence", return_value={"ready": True}):
            report = promoter.promote(self.args(), repo_root=self.root)

        self.assertEqual(report["catalog_count"], 1)
        self.assertEqual(report["serving_count"], 1)
        self.assertEqual(
            [item["from_id"] for item in report["manifest"]["aliases"]],
            ["place:ridb:duplicate"],
        )

    def test_expected_current_hash_drift_blocks_before_write(self) -> None:
        args = self.args(
            apply=True,
            expected_current_serving_sha256="0" * 64,
        )
        with patch.object(promoter, "_git_dirty_paths", return_value=[]):
            with self.assertRaisesRegex(promoter.PromotionError, "current serving index hash changed"):
                promoter.promote(args, repo_root=self.root)

    def test_child_depth_requires_one_disposition_for_every_source_record(self) -> None:
        child_path = self.source_root / "data/explore/audit_candidates/children/batch.json"
        children = {
            "schema_version": 1,
            "generated_at": 101,
            "count": 2,
            "places": [
                {
                    "id": "child:one",
                    "name": "First Child",
                    "category": "viewpoint",
                    "parent_hub_id": "place:nps:test",
                    "module_target": "see",
                },
                {
                    "id": "child:two",
                    "name": "Second Child",
                    "category": "viewpoint",
                    "parent_hub_id": "place:nps:test",
                    "module_target": "see",
                },
            ],
        }
        write_json(child_path, children)
        write_json(self.dispositions, {
            "child_dispositions": [{
                "source_id": "child:one",
                "public_id": "child:one",
                "disposition": "published",
                "reason": "Reviewed official child",
            }],
        })
        args = self.args(
            stage="child_depth",
            release_id="explore-b08-r2",
            child_input=["batch=data/explore/audit_candidates/children/batch.json"],
            expected_catalog_count=3,
            expected_serving_count=3,
        )
        with self.assertRaisesRegex(promoter.PromotionError, "dispositions are incomplete"):
            promoter.promote(args, repo_root=self.root)

    def test_child_depth_apply_rejects_any_unresolved_rejected_record(self) -> None:
        child_path = self.source_root / "data/explore/audit_candidates/children/batch.json"
        write_json(child_path, {
            "schema_version": 1,
            "generated_at": 101,
            "count": 1,
            "places": [{
                "id": "child:one",
                "name": "First Child",
                "category": "viewpoint",
                "parent_hub_id": "place:nps:test",
                "module_target": "see",
            }],
        })
        write_json(self.dispositions, {
            "child_dispositions": [{
                "source_id": "child:one",
                "public_id": "",
                "disposition": "rejected",
                "reason": "Unresolved copy review",
            }],
        })
        args = self.args(
            stage="child_depth",
            release_id="explore-b08-r2",
            child_input=["batch=data/explore/audit_candidates/children/batch.json"],
            expected_catalog_count=1,
            expected_serving_count=1,
            apply=True,
        )
        with patch.object(promoter, "_git_dirty_paths", return_value=[]):
            with self.assertRaisesRegex(promoter.PromotionError, "unresolved rejected"):
                promoter.promote(args, repo_root=self.root)

    def test_child_depth_rejects_internal_audit_contract_before_promotion(self) -> None:
        child_path = self.source_root / "data/explore/audit_candidates/children/contract.json"
        write_json(child_path, {
            "schema": "ExploreNpsChildContractV1",
            "schema_version": 1,
            "stage": "internal",
            "promotion_ready": False,
            "public_promotion_compatible": False,
            "places": [],
        })
        args = self.args(
            stage="child_depth",
            release_id="explore-b08-r2",
            child_input=["contract=data/explore/audit_candidates/children/contract.json"],
            expected_catalog_count=1,
            expected_serving_count=1,
        )
        with self.assertRaisesRegex(promoter.PromotionError, "internal audit contract"):
            promoter.promote(args, repo_root=self.root)

    def test_input_path_traversal_outside_both_roots_is_rejected(self) -> None:
        outside = Path(self.temp.name) / "outside.json"
        write_json(outside, {"schema_version": 3, "count": 0, "places": []})
        args = self.args(catalog_input=str(outside))
        with self.assertRaisesRegex(promoter.PromotionError, "outside approved source roots"):
            promoter.promote(args, repo_root=self.root)


if __name__ == "__main__":
    unittest.main()
