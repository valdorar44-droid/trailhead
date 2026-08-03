from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_explore_internal_preview as builder
from scripts import qa_explore_b08_internal_candidate as qa


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ExploreB08PromotionGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.agency_revision = "agency-test-r2"
        self.nps_revision = "nps-test"
        self.combined_revision = "combined-test"
        self.agency_dir = self.root / "agencies" / self.agency_revision
        self.combined_dir = self.root / "combined" / self.combined_revision
        self.agency_dir.mkdir(parents=True)
        self.combined_dir.mkdir(parents=True)

        self.agency_catalog = self.agency_dir / "explore_catalog_v3.json"
        self.nps_catalog = self.combined_dir / "nps_catalog_scoped.json"
        self.serving_index = self.combined_dir / "serving_index_review.json"
        self.catalog_merge_review = self.combined_dir / "catalog_merge_review.json"
        self.promotion_review = self.combined_dir / "promotion_review.json"
        self.agency_catalog.write_text('{"places":[]}')
        self.nps_catalog.write_text('{"places":[]}')
        self.serving_index.write_text('{"items":[]}')
        agency_relative = str(self.agency_catalog.relative_to(self.root))
        agency_serving_relative = str(self.agency_catalog.with_name("serving_index_merged_review.json").relative_to(self.root))
        self.catalog_merge_review.write_text(json.dumps({"sources": {"agency": agency_relative}}))
        self.promotion_review.write_text(json.dumps({"sources": {"agency_merged": agency_serving_relative}}))

        self.agency_manifest = self.agency_dir / "manifest.json"
        self.combined_manifest = self.combined_dir / "manifest.json"
        self._write_manifest(self.agency_manifest, [self.agency_catalog])
        self._write_manifest(
            self.combined_manifest,
            [self.serving_index, self.catalog_merge_review, self.promotion_review],
            inputs=[self.nps_catalog],
            final_promotion=False,
        )

        self.expected = {
            "agency_revision": self.agency_revision,
            "nps_revision": self.nps_revision,
            "combined_revision": self.combined_revision,
            "agency_manifest_path": str(self.agency_manifest.relative_to(self.root)),
            "agency_manifest_sha256": _sha256(self.agency_manifest),
            "agency_catalog_path": str(self.agency_catalog.relative_to(self.root)),
            "agency_catalog_sha256": _sha256(self.agency_catalog),
            "combined_manifest_path": str(self.combined_manifest.relative_to(self.root)),
            "combined_manifest_sha256": _sha256(self.combined_manifest),
            "nps_catalog_path": str(self.nps_catalog.relative_to(self.root)),
            "nps_catalog_sha256": _sha256(self.nps_catalog),
            "serving_index_path": str(self.serving_index.relative_to(self.root)),
            "serving_index_sha256": _sha256(self.serving_index),
            "catalog_merge_review_path": str(self.catalog_merge_review.relative_to(self.root)),
            "catalog_merge_review_sha256": _sha256(self.catalog_merge_review),
            "promotion_review_path": str(self.promotion_review.relative_to(self.root)),
            "promotion_review_sha256": _sha256(self.promotion_review),
        }

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def _write_manifest(
        path: Path,
        artifacts: list[Path],
        *,
        inputs: list[Path] | None = None,
        final_promotion: bool = True,
    ) -> None:
        path.write_text(json.dumps({
            "promotion_ready": final_promotion,
            "catalog_gate_passed": True,
            "live_serving_index_modified": False,
            "artifacts": [
                {
                    "path": artifact.name,
                    "bytes": artifact.stat().st_size,
                    "sha256": _sha256(artifact),
                }
                for artifact in artifacts
            ],
            "inputs": {
                f"input_{index}": {
                    "path": str(artifact.relative_to(path.parents[2])),
                    "bytes": artifact.stat().st_size,
                    "sha256": _sha256(artifact),
                }
                for index, artifact in enumerate(inputs or [])
            },
        }))

    def _payload(self) -> dict:
        place_id = "place:usfs:test-camp"
        agency_binding = {
            "path": self.expected["agency_manifest_path"],
            "sha256": self.expected["agency_manifest_sha256"],
            "artifact_path": self.agency_catalog.name,
            "artifact_sha256": self.expected["agency_catalog_sha256"],
        }
        nps_binding = {
            "path": self.expected["combined_manifest_path"],
            "sha256": self.expected["combined_manifest_sha256"],
            "artifact_path": self.nps_catalog.name,
            "artifact_sha256": self.expected["nps_catalog_sha256"],
        }
        serving_binding = {
            "path": self.expected["combined_manifest_path"],
            "sha256": self.expected["combined_manifest_sha256"],
            "artifact_path": self.serving_index.name,
            "artifact_sha256": self.expected["serving_index_sha256"],
        }
        catalog_review_binding = {
            "path": self.expected["combined_manifest_path"],
            "sha256": self.expected["combined_manifest_sha256"],
            "artifact_path": self.catalog_merge_review.name,
            "artifact_sha256": self.expected["catalog_merge_review_sha256"],
        }
        promotion_review_binding = {
            "path": self.expected["combined_manifest_path"],
            "sha256": self.expected["combined_manifest_sha256"],
            "artifact_path": self.promotion_review.name,
            "artifact_sha256": self.expected["promotion_review_sha256"],
        }
        return {
            "schema_version": 1,
            "stage": "internal",
            "public_promotion_compatible": False,
            "count": 1,
            "candidate": {
                "agency_revision": self.agency_revision,
                "nps_revision": self.nps_revision,
                "combined_revision": self.combined_revision,
                "agency_manifest": agency_binding,
                "combined_manifest": {
                    "path": self.expected["combined_manifest_path"],
                    "sha256": self.expected["combined_manifest_sha256"],
                    "artifacts": {
                        "nps_catalog": nps_binding,
                        "serving_index": serving_binding,
                        "catalog_merge_review": catalog_review_binding,
                        "promotion_review": promotion_review_binding,
                    },
                },
            },
            "sources": {
                "agency_catalog": {
                    "path": self.expected["agency_catalog_path"],
                    "sha256": self.expected["agency_catalog_sha256"],
                    "revision": self.agency_revision,
                },
                "nps_catalog": {
                    "path": self.expected["nps_catalog_path"],
                    "sha256": self.expected["nps_catalog_sha256"],
                    "revision": self.nps_revision,
                },
                "serving_index": {
                    "path": self.expected["serving_index_path"],
                    "sha256": self.expected["serving_index_sha256"],
                    "revision": self.combined_revision,
                },
            },
            "places": [{
                "id": place_id,
                "name": "River Campground",
                "region": "CA",
                "access": "Open",
                "lat": 37.2,
                "lng": -119.3,
                "checked_at": 1,
                "planning_facts": [
                    {"key": "area", "value": "Sierra National Forest, US"},
                    {"key": "access", "value": "Open"},
                ],
                "reservations": {
                    "reservable": True,
                    "url": "https://www.recreation.gov/camping/campgrounds/123",
                },
                "sources": [
                    {
                        "source": "usfs",
                        "source_id": "test-camp",
                        "url": "https://www.fs.usda.gov/recarea/test",
                        "attribution": "USDA Forest Service",
                        "license": "USFS public data terms",
                    },
                    {
                        "source": "ridb",
                        "source_id": "123",
                        "url": "https://www.recreation.gov/camping/campgrounds/123",
                        "attribution": "Recreation.gov",
                        "license": "RIDB public API terms",
                    },
                ],
                "media": [{
                    "url": "https://cdn.recreation.gov/public/test.webp",
                    "credit": "Recreation.gov",
                    "license": "RIDB public API terms",
                    "rights_state": "source_terms_reviewed",
                    "source_page_url": "https://www.recreation.gov/camping/campgrounds/123",
                }],
                "source_pack": {
                    "visitor_centers": [{
                        "title": "Visitor center",
                        "url": "https://www.fs.usda.gov/visit/test",
                    }],
                },
            }],
        }

    def _audit(self, payload: dict) -> dict:
        path = self.root / "sidecar.json"
        path.write_text(json.dumps(payload))
        with patch.object(qa, "EXPECTED_IDS", ("place:usfs:test-camp",)), patch.object(
            qa, "REPLACEMENT_IDS", frozenset({"place:usfs:test-camp"}),
        ):
            return qa.audit(path, root=self.root, expected=self.expected)

    def test_default_builder_uses_current_accepted_agency_revision(self):
        self.assertEqual(builder.DEFAULT_AGENCY.parent.name, builder.ACCEPTED_AGENCY_REVISION)
        self.assertTrue(str(builder.DEFAULT_AGENCY).endswith(
            f"{builder.ACCEPTED_AGENCY_REVISION}/explore_catalog_v3.json"
        ))

    def test_valid_candidate_binding_and_reader_media_evidence_pass(self):
        self.assertTrue(self._audit(self._payload())["passed"])

    def test_reviewed_text_fallback_does_not_require_recreation_media(self):
        payload = self._payload()
        payload["places"][0]["media"] = []
        self.assertTrue(self._audit(payload)["passed"])

    def test_source_hash_drift_blocks_promotion(self):
        payload = self._payload()
        self.agency_catalog.write_text('{"places":[{"changed":true}]}')
        with self.assertRaisesRegex(SystemExit, "accepted source artifact is missing or changed"):
            self._audit(payload)

    def test_nested_non_https_or_internal_link_blocks_promotion(self):
        for url in ("http://www.nps.gov/test", "https://cms.nps.doi.net/internal/test"):
            with self.subTest(url=url):
                payload = self._payload()
                payload["places"][0]["source_pack"]["visitor_centers"][0]["url"] = url
                with self.assertRaisesRegex(SystemExit, "nested link is not public HTTPS"):
                    self._audit(payload)

    def test_ai_modified_or_unreviewed_media_blocks_promotion(self):
        payload = self._payload()
        payload["places"][0]["media"][0]["ai_modified"] = True
        with self.assertRaisesRegex(SystemExit, "explicitly AI-modified media is excluded"):
            self._audit(payload)

        payload = self._payload()
        payload["places"][0]["media"][0].pop("rights_state")
        with self.assertRaisesRegex(SystemExit, "media rights state is not explicitly approved"):
            self._audit(payload)

    def test_generic_warning_or_mojibake_blocks_promotion(self):
        for bad_copy in ("Verify access", "Wildlifeâ€”and waterfalls"):
            with self.subTest(bad_copy=bad_copy):
                payload = self._payload()
                payload["places"][0]["card"] = {"warnings": [bad_copy]}
                with self.assertRaisesRegex(SystemExit, "raw or malformed value"):
                    self._audit(payload)


if __name__ == "__main__":
    unittest.main()
