from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_nps_child_depth_batch import (
    AUDIT_CANDIDATE_ROOT,
    BATCH_DESTINATIONS,
    ROOT,
    _audit_children,
    _normalize_child_classification,
    build,
)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False) + "\n")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def related_item(code: str, endpoint: str) -> dict:
    title = {
        "campgrounds": f"{code.upper()} River Campground",
        "visitorcenters": f"{code.upper()} Visitor Center",
        "thingstodo": f"{code.upper()} Canyon Trail",
        "places": f"{code.upper()} Valley Overlook",
    }[endpoint]
    description = (
        f"{title} is an official National Park Service place with enough cached descriptive detail "
        "to support a specific reader card without adding generic instructions or unsupported claims."
    )
    item = {
        "id": f"{code}-{endpoint}",
        "title": title,
        "description": description,
        "latitude": 36.1 + len(endpoint) / 100,
        "longitude": -112.1 - len(endpoint) / 100,
        "url": f"https://www.nps.gov/places/{code}-{endpoint}.htm",
        "images": [{
            "url": f"https://www.nps.gov/common/uploads/structured_data/{code}-{endpoint}.jpg",
            "caption": title,
            "credit": "National Park Service",
        }],
    }
    if endpoint == "thingstodo":
        item["activities"] = [{"name": "Front-Country Hiking"}]
    return item


def make_fixture(path: Path, code: str, name: str) -> None:
    related = {
        endpoint: [related_item(code, endpoint)]
        for endpoint in ("campgrounds", "visitorcenters", "thingstodo", "places")
    }
    write_json(
        path / f"source-pack_codes-{code}_with-cached.json",
        {
            "source": "nps",
            "fetched_at": 1785550000,
            "count": 1,
            "data": [{"id": code, "parkCode": code, "fullName": name, "states": "UT"}],
            "related": {code: related},
        },
    )


class NpsChildDepthBatchTests(unittest.TestCase):
    def fixture_tree(self, root: Path) -> tuple[Path, Path]:
        base = root / "base.json"
        write_json(base, {
            "schema_version": 3,
            "generated_at": 1785553072,
            "count": 1,
            "places": [{"id": "place:existing", "name": "Existing Place"}],
        })
        cache = root / "cache"
        for code, name in BATCH_DESTINATIONS:
            make_fixture(cache, code, name)
        return base, cache

    def args(self, base: Path, cache: Path, out_dir: Path) -> argparse.Namespace:
        return argparse.Namespace(base_catalog=str(base), source_cache=str(cache), out_dir=str(out_dir))

    def test_cached_build_is_deterministic_and_capability_driven(self):
        protected = ROOT / "dashboard/explore_serving_index_v2.json"
        protected_before = sha256(protected)
        with tempfile.TemporaryDirectory(dir=AUDIT_CANDIDATE_ROOT) as temp:
            root = Path(temp)
            base, cache = self.fixture_tree(root)
            first = root / "first"
            second = root / "second"
            result = build(self.args(base, cache, first))
            repeated = build(self.args(base, cache, second))

            self.assertEqual(result["count"], 20)
            self.assertEqual(result["destination_counts"], {code: 4 for code, _ in BATCH_DESTINATIONS})
            self.assertEqual(result["module_counts"], {"stay": 5, "visitor": 5, "trails": 5, "see": 5})
            self.assertEqual(result["manifest_sha256"], repeated["manifest_sha256"])
            self.assertEqual(
                {path.name: sha256(path) for path in first.iterdir()},
                {path.name: sha256(path) for path in second.iterdir()},
            )
            manifest = json.loads((first / "manifest.json").read_text())
            sidecar = json.loads((first / "nps_child_depth_v1.json").read_text())
            audit = json.loads((first / "audit.json").read_text())
            self.assertEqual(manifest["requests_used"], 0)
            self.assertFalse(manifest["promotion_ready"])
            self.assertFalse(manifest["live_serving_index_modified"])
            self.assertEqual(sidecar["stage"], "internal")
            self.assertTrue(audit["passed"])
            self.assertTrue(all(item["canonical_role"] == "child" for item in sidecar["places"]))
        self.assertEqual(sha256(protected), protected_before)

    def test_non_nps_official_url_blocks_the_candidate(self):
        with tempfile.TemporaryDirectory(dir=AUDIT_CANDIDATE_ROOT) as temp:
            root = Path(temp)
            base, cache = self.fixture_tree(root)
            fixture = next(cache.glob("source-pack_codes-blri_*.json"))
            payload = json.loads(fixture.read_text())
            payload["related"]["blri"]["campgrounds"][0]["url"] = "https://example.com/not-nps"
            write_json(fixture, payload)
            with self.assertRaisesRegex(ValueError, "unsafe_official_url"):
                build(self.args(base, cache, root / "candidate"))

    def test_missing_cached_image_credit_strips_media_instead_of_inventing_rights(self):
        with tempfile.TemporaryDirectory(dir=AUDIT_CANDIDATE_ROOT) as temp:
            root = Path(temp)
            base, cache = self.fixture_tree(root)
            fixture = next(cache.glob("source-pack_codes-blri_*.json"))
            payload = json.loads(fixture.read_text())
            payload["related"]["blri"]["places"][0]["images"][0].pop("credit")
            write_json(fixture, payload)
            out_dir = root / "candidate"
            build(self.args(base, cache, out_dir))
            sidecar = json.loads((out_dir / "nps_child_depth_v1.json").read_text())
            target = next(item for item in sidecar["places"] if item["id"].startswith("place:nps-child:blri:places:"))
            self.assertEqual(target["media"], [])
            self.assertEqual(target["source_pack"]["photos"], [])
            review = json.loads((out_dir / "review.json").read_text())
            self.assertGreaterEqual(review["media_policy"]["stripped_images"], 1)

    def test_module_normalization_uses_endpoint_and_title_not_incidental_description(self):
        activity = {
            "id": "place:nps-child:dino:thingstodo:junior-ranger",
            "name": "Be a Dinosaur Junior Ranger",
            "category": "trail",
            "module_target": "trails",
            "description": "The visitor center activity mentions a nearby trail.",
        }
        _normalize_child_classification(
            activity,
            "thingstodo",
            {"activities": [{"name": "Junior Ranger Program"}]},
        )
        self.assertEqual((activity["category"], activity["module_target"]), ("activity", "do"))

        trail = {
            "id": "place:nps-child:dino:places:confluence-trail",
            "name": "Confluence Trail",
            "category": "campground",
            "module_target": "stay",
        }
        _normalize_child_classification(trail, "places", {"tags": ["hiking"]})
        self.assertEqual((trail["category"], trail["module_target"]), ("trail", "trails"))

        ranger_walk = {
            "id": "place:nps-child:brca:thingstodo:rim-walk-with-a-ranger",
            "name": "Rim Walk with a Ranger",
            "category": "trail",
            "module_target": "trails",
        }
        _normalize_child_classification(
            ranger_walk,
            "thingstodo",
            {"activities": [{"name": "Guided Tours"}]},
        )
        self.assertEqual((ranger_walk["category"], ranger_walk["module_target"]), ("activity", "do"))

        wayside = {
            "id": "place:nps-child:brca:places:bristlecone-loop-wayside",
            "name": "Bristlecone Loop Wayside 107",
            "category": "trail",
            "module_target": "trails",
        }
        _normalize_child_classification(wayside, "places", {"tags": ["wayside"]})
        self.assertEqual((wayside["category"], wayside["module_target"]), ("historic_site", "see"))

        trail_stop = {
            "id": "place:nps-child:dino:places:gates-of-lodore-trail-stop-1",
            "name": "Gates of Lodore Trail Stop 1",
            "category": "trail",
            "module_target": "trails",
        }
        _normalize_child_classification(trail_stop, "places", {"tags": ["desert hiking"]})
        self.assertEqual((trail_stop["category"], trail_stop["module_target"]), ("place", "see"))

        overlook = {
            "id": "place:nps-child:blri:places:camp-creek-overlook",
            "name": "Camp Creek Overlook",
            "category": "lake",
            "module_target": "trails",
        }
        _normalize_child_classification(overlook, "places", {"tags": ["hiking"]})
        self.assertEqual((overlook["category"], overlook["module_target"]), ("viewpoint", "see"))

        visitor_trailhead = {
            "id": "place:nps-child:dino:places:visitor-center-trailhead",
            "name": "Fossil Discovery Trail - Visitor Center Trailhead",
            "category": "visitor_center",
            "module_target": "visitor",
        }
        _normalize_child_classification(visitor_trailhead, "places", {"tags": ["trailhead"]})
        self.assertEqual(
            (visitor_trailhead["category"], visitor_trailhead["module_target"]),
            ("trailhead", "trails"),
        )

    def test_exact_source_media_mismatch_is_rejected(self):
        child = {
            "id": "place:nps-child:blri:places:valley-overlook",
            "name": "Valley Overlook",
            "canonical_role": "child",
            "parent_hub_id": "place:nps:blri",
            "module_target": "see",
            "lat": 36.1,
            "lng": -112.1,
            "summary": "A specific official description.",
            "source_pack": {
                "primary": "National Park Service",
                "license": "National Park Service public data",
                "official_url": "https://www.nps.gov/places/valley-overlook.htm",
                "nps_item_id": "blri-places",
                "photos": [{
                    "url": "https://www.nps.gov/common/uploads/structured_data/wrong.jpg",
                    "credit": "National Park Service",
                    "license": "National Park Service public data",
                }],
            },
            "media": [{
                "url": "https://www.nps.gov/common/uploads/structured_data/wrong.jpg",
                "credit": "National Park Service",
                "license": "National Park Service public data",
            }],
            "sources": [{"source": "nps", "source_id": "blri-places"}],
        }
        source = related_item("blri", "places")
        source["title"] = "Valley Overlook"
        audit = _audit_children([child], {"blri": {"places:id:blri-places": source}})
        self.assertFalse(audit["passed"])
        self.assertIn("media_identity_mismatch", {item["code"] for item in audit["errors"]})

    def test_candidate_directory_is_immutable(self):
        with tempfile.TemporaryDirectory(dir=AUDIT_CANDIDATE_ROOT) as temp:
            root = Path(temp)
            base, cache = self.fixture_tree(root)
            out_dir = root / "candidate"
            out_dir.mkdir()
            (out_dir / "existing.txt").write_text("preserve")
            with self.assertRaisesRegex(FileExistsError, "not empty"):
                build(self.args(base, cache, out_dir))

    def test_live_dashboard_outputs_are_protected(self):
        with tempfile.TemporaryDirectory(dir=AUDIT_CANDIDATE_ROOT) as temp:
            root = Path(temp)
            base, cache = self.fixture_tree(root)
            with self.assertRaisesRegex(ValueError, "below data/explore/audit_candidates"):
                build(self.args(base, cache, ROOT / "dashboard"))

    def test_manifest_is_deterministic_across_source_roots(self):
        with (
            tempfile.TemporaryDirectory(dir=AUDIT_CANDIDATE_ROOT) as first_temp,
            tempfile.TemporaryDirectory(dir=AUDIT_CANDIDATE_ROOT) as second_temp,
        ):
            first_root = Path(first_temp)
            second_root = Path(second_temp)
            first_base, first_cache = self.fixture_tree(first_root)
            second_base, second_cache = self.fixture_tree(second_root)
            first_out = first_root / "candidate"
            second_out = second_root / "candidate"

            first_result = build(self.args(first_base, first_cache, first_out))
            second_result = build(self.args(second_base, second_cache, second_out))

            self.assertEqual(first_result["manifest_sha256"], second_result["manifest_sha256"])
            first_manifest = json.loads((first_out / "manifest.json").read_text())
            self.assertEqual(first_manifest["inputs"]["base_catalog"]["path"], "base_catalog/base.json")
            self.assertTrue(all(
                not Path(ref["path"]).is_absolute()
                for ref in first_manifest["inputs"]["fixtures"].values()
            ))


if __name__ == "__main__":
    unittest.main()
