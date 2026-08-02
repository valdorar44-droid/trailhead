from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_explore_internal_preview import _write_payload_atomically
from scripts.explore_sources.nps.media_rights import (
    NPS_AGGREGATE_CACHE_NAME,
    NPS_MEDIA_POLICY_URL,
    NPS_MEDIA_RIGHTS_STATUS,
    NpsMediaEvidenceError,
    load_nps_media_traces,
    normalize_selected_nps_places,
)


class ExploreNpsMediaRightsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.cache_dir = self.root / "data/explore/source_cache/nps"
        self.cache_dir.mkdir(parents=True)
        self.cache_path = self.cache_dir / (
            "source-pack_codes-cave_with-places-thingstodo-campgrounds-"
            "visitorcenters-alerts-articles-events-tours-parkin_max-500.json"
        )
        self.park_image = "https://www.nps.gov/common/uploads/structured_data/park.jpg"
        self.child_image = "https://www.nps.gov/common/uploads/structured_data/child.jpg"
        self.third_party = "https://www.nps.gov/common/uploads/structured_data/third-party.jpg"
        self.ai_image = "https://www.nps.gov/common/uploads/structured_data/ai.jpg"
        self.cache_payload = {
            "fetched_at": 123456,
            "data": [{
                "parkCode": "cave",
                "url": "https://www.nps.gov/cave/index.htm",
                "images": [{
                    "url": self.park_image,
                    "credit": "NPS / Ranger Example",
                    "title": "Park image",
                }],
            }],
            "related": {
                "cave": {
                    "places": [{
                        "id": "child-1",
                        "url": "https://www.nps.gov/places/example.htm",
                        "images": [{
                            "url": self.child_image,
                            "credit": "National Park Service",
                        }, {
                            "url": self.third_party,
                            "credit": "Courtesy Example Foundation",
                        }, {
                            "url": self.ai_image,
                            "credit": "NPS Photo / Example",
                            "ai_modified": True,
                        }],
                    }],
                },
            },
        }
        self.cache_path.write_text(json.dumps(self.cache_payload))

    def tearDown(self):
        self.temp.cleanup()

    def _place(self) -> dict:
        return {
            "id": "place:nps:cave",
            "name": "Carlsbad Caverns National Park",
            "description": (
                "Official details at http://www.nps.gov/cave/visit. "
                "A legacy partner link http://partner.example/old must not ship."
            ),
            "media": [
                {"url": self.park_image, "credit": "stale credit", "license": "NPS data"},
                {"url": self.third_party, "credit": "Courtesy Example Foundation", "license": "NPS data"},
            ],
            "card": {
                "warnings": [
                    "Verify access",
                    "Seasonal closure in effect",
                    "Check official source or local rules",
                ],
            },
            "source_pack": {
                "nps_park_code": "cave",
                "official_url": "https://www.nps.gov/cave/index.htm",
                "photos": [
                    {"url": self.park_image, "credit": "NPS / Ranger Example", "license": "NPS data"},
                ],
                "things_to_see": [{
                    "title": "Example place",
                    "url": "https://www.nps.gov/places/example.htm",
                    "image_url": self.child_image,
                    "image_credit": "National Park Service",
                    "image_license": "NPS data",
                }, {
                    "title": "Third-party image",
                    "url": "https://www.nps.gov/places/example.htm",
                    "image_url": self.third_party,
                    "image_credit": "Courtesy Example Foundation",
                    "image_license": "NPS data",
                }, {
                    "title": "AI image",
                    "url": "https://www.nps.gov/places/example.htm",
                    "image_url": self.ai_image,
                    "image_credit": "NPS Photo / Example",
                    "image_license": "NPS data",
                    "ai_modified": True,
                }],
            },
        }

    def _normalize(self, places: list[dict] | None = None) -> list[dict]:
        return normalize_selected_nps_places(
            places or [self._place()],
            cache_dir=self.cache_dir,
            evidence_root=self.root,
        )

    def test_exact_cached_nps_media_is_annotated_with_review_evidence(self):
        place = self._normalize()[0]
        self.assertEqual(len(place["media"]), 1)
        media = place["media"][0]
        self.assertEqual(media["credit"], "NPS / Ranger Example")
        self.assertEqual(media["distribution_status"], "approved")
        self.assertEqual(media["rights_status"], NPS_MEDIA_RIGHTS_STATUS)
        self.assertEqual(media["rights_state"], "source_terms_reviewed")
        self.assertEqual(media["source_page_url"], "https://www.nps.gov/cave/index.htm")
        self.assertEqual(media["rights_evidence"], {
            "source_cache_path": str(self.cache_path.relative_to(self.root)).replace("\\", "/"),
            "source_cache_sha256": hashlib.sha256(self.cache_path.read_bytes()).hexdigest(),
            "json_pointer": "/data/0/images/0",
            "fetched_at": 123456,
            "policy_url": NPS_MEDIA_POLICY_URL,
            "decision_reason": "cached_official_nps_object_with_nps_prefixed_credit",
        })

    def test_child_media_uses_containing_page_and_disallowed_images_are_stripped(self):
        place = self._normalize()[0]
        children = place["source_pack"]["things_to_see"]
        self.assertEqual(children[0]["image_source_page_url"], "https://www.nps.gov/places/example.htm")
        self.assertEqual(children[0]["image_credit"], "National Park Service")
        self.assertEqual(
            children[0]["image_rights_evidence"]["json_pointer"],
            "/related/cave/places/0/images/0",
        )
        self.assertNotIn("image_url", children[1])
        self.assertNotIn("image_credit", children[1])
        self.assertNotIn("image_url", children[2])
        self.assertNotIn("image_credit", children[2])

    def test_promoted_nps_child_place_uses_the_same_closed_media_gate(self):
        child = {
            "id": "place:nps-child:cave:places:example",
            "name": "Example place",
            "media": [{"url": self.child_image, "credit": "invented fallback", "license": "NPS data"}],
            "source_pack": {
                "nps_park_code": "cave",
                "official_url": "https://www.nps.gov/places/example.htm",
                "photos": [{"url": self.child_image, "credit": "invented fallback", "license": "NPS data"}],
            },
        }
        normalized = self._normalize([child])[0]
        self.assertEqual(normalized["media"][0]["credit"], "National Park Service")
        self.assertEqual(normalized["media"][0]["distribution_status"], "approved")
        self.assertEqual(
            normalized["media"][0]["rights_evidence"]["json_pointer"],
            "/related/cave/places/0/images/0",
        )

    def test_exact_nps_http_page_is_upgraded_before_media_evidence_matching(self):
        self.cache_payload["related"]["cave"]["places"][0]["url"] = (
            "http://www.nps.gov/places/example.htm"
        )
        self.cache_path.write_text(json.dumps(self.cache_payload))
        child = {
            "id": "place:nps-child:cave:places:example",
            "name": "Example place",
            "media": [{"url": self.child_image, "credit": "National Park Service"}],
            "source_pack": {
                "nps_park_code": "cave",
                "official_url": "https://www.nps.gov/places/example.htm",
                "photos": [{"url": self.child_image, "credit": "National Park Service"}],
            },
        }

        normalized = self._normalize([child])[0]

        self.assertEqual(len(normalized["media"]), 1)
        self.assertEqual(
            normalized["media"][0]["source_page_url"],
            "https://www.nps.gov/places/example.htm",
        )

    def test_reader_links_are_sanitized_and_only_generated_warnings_are_removed(self):
        place = self._normalize()[0]
        self.assertIn("https://www.nps.gov/cave/visit", place["description"])
        self.assertNotIn("partner.example", place["description"])
        self.assertEqual(place["card"]["warnings"], ["Seasonal closure in effect"])

    def test_non_nps_places_are_not_rewritten(self):
        agency = {
            "id": "place:usfs:example",
            "description": "Keep  two spaces and http://legacy.example exactly.",
        }
        self.assertEqual(self._normalize([agency]), [agency])

    def test_missing_or_ambiguous_cache_evidence_is_not_distributed(self):
        place = self._place()
        place["media"] = [{
            "url": "https://www.nps.gov/common/uploads/structured_data/not-cached.jpg",
            "credit": "NPS",
        }]
        self.assertEqual(self._normalize([place])[0]["media"], [])

        self.cache_payload["data"][0]["images"].append({
            "url": self.park_image,
            "credit": "NPS Photo / Different credit",
        })
        self.cache_path.write_text(json.dumps(self.cache_payload))
        self.assertEqual(self._normalize()[0]["media"], [])

    def test_reused_image_requires_approved_evidence_for_the_exact_page(self):
        self.cache_payload["related"]["cave"]["places"][0]["images"].append({
            "url": self.park_image,
            "credit": "NPS / Ranger Example",
            "ai_modified": True,
        })
        self.cache_path.write_text(json.dumps(self.cache_payload))
        place = self._place()
        place["source_pack"]["things_to_see"] = [{
            "title": "Reused park image",
            "url": "https://www.nps.gov/places/example.htm",
            "image_url": self.park_image,
            "image_credit": "NPS / Ranger Example",
            "image_license": "NPS data",
        }]

        child = self._normalize([place])[0]["source_pack"]["things_to_see"][0]

        self.assertNotIn("image_url", child)
        self.assertNotIn("image_credit", child)
        self.assertNotIn("image_rights_evidence", child)

    def test_aggregate_cache_is_secondary_exact_evidence_only(self):
        aggregate_image = "https://www.nps.gov/common/uploads/structured_data/aggregate.jpg"
        aggregate_path = self.cache_dir / NPS_AGGREGATE_CACHE_NAME
        aggregate_path.write_text(json.dumps({
            "fetched_at": 111,
            "data": [{
                "parkCode": "cave",
                "url": "https://www.nps.gov/cave/index.htm",
                "images": [{"url": aggregate_image, "credit": "NPS Photo / Archive"}],
            }],
            "related": {"cave": {}},
        }))
        place = self._place()
        place["media"] = [{"url": aggregate_image, "credit": "NPS Photo / Archive"}]
        media = self._normalize([place])[0]["media"][0]
        self.assertEqual(media["url"], aggregate_image)
        self.assertEqual(
            media["rights_evidence"]["source_cache_path"],
            str(aggregate_path.relative_to(self.root)).replace("\\", "/"),
        )
        self.assertEqual(media["rights_evidence"]["json_pointer"], "/data/0/images/0")

        # A less restrictive aggregate record cannot override a rejection from
        # the park-specific immutable cache for the same exact URL.
        self.cache_payload["data"][0]["images"].append({
            "url": aggregate_image,
            "credit": "Courtesy Outside Photographer",
        })
        self.cache_path.write_text(json.dumps(self.cache_payload))
        self.assertEqual(self._normalize([place])[0]["media"], [])

    def test_missing_cache_is_a_closed_gate(self):
        with self.assertRaisesRegex(NpsMediaEvidenceError, "Expected one immutable NPS source-pack cache"):
            load_nps_media_traces(
                self.cache_dir,
                ["gumo"],
                evidence_root=self.root,
            )

    def test_atomic_output_replaces_only_after_validation(self):
        output = self.root / "preview.json"
        output.write_text('{"state":"previous"}\n')

        def reject(_path: Path) -> None:
            raise ValueError("blocked by QA")

        with self.assertRaisesRegex(ValueError, "blocked by QA"):
            _write_payload_atomically(output, {"state": "candidate"}, validate_output=reject)
        self.assertEqual(json.loads(output.read_text()), {"state": "previous"})
        self.assertEqual(list(self.root.glob(".preview.json.*.tmp")), [])

        _write_payload_atomically(
            output,
            {"state": "accepted"},
            validate_output=lambda path: self.assertEqual(
                json.loads(path.read_text()),
                {"state": "accepted"},
            ),
        )
        self.assertEqual(json.loads(output.read_text()), {"state": "accepted"})


if __name__ == "__main__":
    unittest.main()
