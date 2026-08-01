from __future__ import annotations

import argparse
import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_explore_b08_combined_candidate import (
    _displaced_records,
    _merge_catalogs,
    _review_readiness,
    build,
)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


class ExploreB08CombinedCandidateTests(unittest.TestCase):
    def test_catalog_gate_never_claims_final_promotion_readiness(self):
        self.assertEqual(
            _review_readiness({"gate": {"passed": True}}),
            {"catalog_gate_passed": True, "promotion_ready": False},
        )

    def test_catalog_merge_replaces_stable_ids_and_appends_new_agency_places(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base = root / "base.json"
            nps = root / "nps.json"
            agency = root / "agency.json"
            write_json(base, {"count": 2, "generated_at": 1, "places": [{"id": "nps"}, {"id": "base"}]})
            write_json(nps, {"count": 1, "generated_at": 2, "places": [{"id": "nps", "rich": True}]})
            write_json(agency, {"count": 2, "generated_at": 3, "places": [{"id": "base", "agency": True}, {"id": "new"}]})

            merged, review = _merge_catalogs(base, nps, agency)

            self.assertEqual([item["id"] for item in merged["places"]], ["nps", "base", "new"])
            self.assertTrue(merged["places"][0]["rich"])
            self.assertTrue(merged["places"][1]["agency"])
            self.assertEqual(review["counts"]["merged"], 3)
            self.assertEqual(review["counts"]["replaced_base_by_nps"], 1)
            self.assertEqual(review["counts"]["replaced_existing_by_agency"], 1)

    def test_displacement_requires_one_nearby_title_related_replacement(self):
        base = {"items": [{"id": "old", "title": "Forks Campground (Sierra)", "lat": 37.0, "lng": -119.0}]}
        merged = {"items": [{"id": "new", "title": "Forks Campground", "lat": 37.0001, "lng": -119.0001}]}
        displaced = _displaced_records(base, merged)
        self.assertEqual(displaced[0]["old_id"], "old")
        self.assertEqual(displaced[0]["replacement_id"], "new")
        self.assertLess(displaced[0]["distance_m"], 20)

    def test_displacement_rejects_ambiguous_candidates(self):
        base = {"items": [{"id": "old", "title": "River Campground", "lat": 37.0, "lng": -119.0}]}
        merged = {"items": [
            {"id": "one", "title": "River Campground", "lat": 37.0001, "lng": -119.0},
            {"id": "two", "title": "River Camp", "lat": 37.0002, "lng": -119.0},
        ]}
        with self.assertRaisesRegex(ValueError, "unambiguous replacement"):
            _displaced_records(base, merged)

    def test_builder_refuses_a_nonempty_candidate_directory(self):
        repo = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(dir=repo) as temp:
            out_dir = Path(temp)
            (out_dir / "existing.txt").write_text("do not overwrite")
            args = argparse.Namespace(
                base_catalog="missing",
                base_serving="missing",
                nps_catalog="missing",
                agency_dir="missing",
                out_dir=str(out_dir),
            )
            with self.assertRaisesRegex(FileExistsError, "not empty"):
                build(args)


if __name__ == "__main__":
    unittest.main()
