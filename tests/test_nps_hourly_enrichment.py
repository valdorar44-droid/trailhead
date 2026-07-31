from __future__ import annotations

import argparse
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.explore_sources.nps.import_nps import fee_pass_lines, summary_from_park
from scripts.run_nps_hourly_enrichment import (
    MAX_NPS_API_CALLS,
    audit_candidate_catalog,
    completed_codes,
    national_park_codes,
    requested_or_default_targets,
    resolve_candidate_dir,
    run_batch,
    sanitized_audit_env,
    select_batch,
    validate_api_call_limit,
)


class NpsHourlyEnrichmentTests(unittest.TestCase):
    def test_api_budget_is_source_controlled_at_700_calls(self):
        self.assertEqual(MAX_NPS_API_CALLS, 700)
        self.assertEqual(validate_api_call_limit(700), 700)
        with self.assertRaises(SystemExit):
            validate_api_call_limit(701)
        with self.assertRaises(SystemExit):
            validate_api_call_limit(0)

    def test_nps_copy_omits_generic_fallback_and_reads_nested_passes(self):
        self.assertEqual(summary_from_park({}, "Example Park"), "")
        self.assertEqual(
            fee_pass_lines([{
                "parkCode": "yell",
                "passes": [{"category": "Annual Entrance - Park", "cost": "70.00"}],
            }]),
            ["Annual Entrance - Park: $70"],
        )

    def test_select_batch_respects_hourly_budget_and_batch_size(self):
        remaining = ["yell", "glac", "acad", "olym"]
        self.assertEqual(
            select_batch(remaining, max_api_calls=75, estimated_calls_per_park=25),
            ["yell", "glac", "acad"],
        )
        self.assertEqual(
            select_batch(remaining, max_api_calls=75, estimated_calls_per_park=25, batch_size=2),
            ["yell", "glac"],
        )

    def test_completed_codes_are_read_from_rich_cache_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            nps_dir = Path(tmp) / "nps"
            nps_dir.mkdir()
            (nps_dir / "source-pack_codes-yose_with-places_max-500.json").write_text("{}")
            (nps_dir / "source-pack_codes-zion_with-places_max-500.json").write_text("{}")
            self.assertEqual(completed_codes(Path(tmp)), {"yose", "zion"})

    def test_default_targets_prioritize_manual_queue_then_national_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            nps_dir = Path(tmp) / "nps"
            nps_dir.mkdir()
            (nps_dir / "source-pack_with-places_max-500.json").write_text(json.dumps({
                "data": [
                    {"parkCode": "yell"},
                    {"parkCode": "glac"},
                    {"parkCode": "abcd"},
                ]
            }))
            self.assertEqual(national_park_codes(Path(tmp)), ["yell", "glac", "abcd"])
            targets = requested_or_default_targets([], Path(tmp))
            self.assertLess(targets.index("yell"), targets.index("glac"))
            self.assertIn("abcd", targets)
            self.assertEqual(requested_or_default_targets([" GRCA ", "yell"], Path(tmp)), ["grca", "yell"])

    def test_sanitized_audit_env_removes_live_provider_keys(self):
        old_value = os.environ.get("GEOAPIFY_API_KEY")
        os.environ["GEOAPIFY_API_KEY"] = "live-test-key"
        try:
            env = sanitized_audit_env()
        finally:
            if old_value is None:
                os.environ.pop("GEOAPIFY_API_KEY", None)
            else:
                os.environ["GEOAPIFY_API_KEY"] = old_value
        self.assertNotIn("GEOAPIFY_API_KEY", env)

    def test_candidate_directory_is_separate_from_dashboard(self):
        candidate = resolve_candidate_dir(Path("data/explore/audit_candidates/nps"), "fixture", now=1)
        self.assertTrue(str(candidate).endswith("data/explore/audit_candidates/nps/fixture"))
        with self.assertRaises(SystemExit):
            resolve_candidate_dir(Path("dashboard"), "fixture", now=1)
        with self.assertRaises(SystemExit):
            resolve_candidate_dir(Path("data/explore/audit_candidates/nps"), "../dashboard", now=1)

    def test_cache_only_success_does_not_report_selected_codes_as_fetched(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / "cache"
            cache.mkdir()
            state = root / "state.json"
            args = argparse.Namespace(
                max_api_calls=MAX_NPS_API_CALLS,
                estimated_calls_per_park=25,
                batch_size=None,
                park_code=[],
                force_fetch=False,
                dry_run=False,
                rebuild_cache_only=True,
                skip_rebuild=True,
                run_audits=False,
                candidate_root=str(root / "candidates"),
                candidate_run_id="fixture",
                use_railway_env=False,
                source_cache_dir=str(cache),
                state=str(state),
                lock=str(root / "lock"),
                nps_limit=500,
                nps_max_records=500,
                related_max_records=500,
                http_timeout=1.0,
                _inside_railway_env=False,
            )
            with patch("scripts.run_nps_hourly_enrichment.requested_or_default_targets", return_value=["yell"]), \
                    patch("scripts.run_nps_hourly_enrichment.completed_codes", return_value=set()), \
                    patch("builtins.print") as output:
                self.assertEqual(run_batch(args), 0)
            payloads = [
                call.args[0]
                for call in output.call_args_list
                if call.args and isinstance(call.args[0], str) and '"status": "success"' in call.args[0]
            ]
            self.assertEqual(len(payloads), 1)
            self.assertEqual(json.loads(payloads[0])["fetched_codes"], [])

    def test_candidate_audit_reports_artifacts_and_module_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog_path = root / "explore_catalog_v3.json"
            trails_path = root / "explore_trail_geometries_v1.json"
            records_path = root / "explore_source_records.jsonl"
            catalog_path.write_text(json.dumps({
                "schema_version": 3,
                "count": 1,
                "places": [{
                    "id": "place:nps:yell",
                    "name": "Yellowstone National Park",
                    "lat": 44.6,
                    "lng": -110.5,
                    "updated_at": 1_990_000_000,
                    "source_pack": {
                        "nps_park_code": "yell",
                        "official_url": "https://www.nps.gov/yell/",
                        "license": "National Park Service public data",
                        "things_to_see": [{"title": "Old Faithful"}],
                        "alerts": [{"title": "Road update"}],
                    },
                    "sources": [{"source": "nps"}],
                    "media": [{
                        "url": "https://www.nps.gov/yell.jpg",
                        "caption": "Yellowstone",
                        "credit": "NPS",
                        "license": "National Park Service public data",
                    }],
                }],
            }))
            trails_path.write_text(json.dumps({"trails": []}))
            records_path.write_text('{"source":"nps"}\n')
            report = audit_candidate_catalog(
                catalog_path=catalog_path,
                trails_path=trails_path,
                source_records_path=records_path,
                now=2_000_000_000,
                completed_park_codes={"yell"},
            )
            self.assertTrue(report["promotion_ready"])
            self.assertEqual(report["counts"]["nps_places"], 1)
            self.assertEqual(report["module_coverage"]["things_to_see"]["items"], 1)
            self.assertEqual(report["module_coverage"]["alerts"]["items"], 1)
            self.assertEqual(report["data_depth"]["rich_cache"]["places"], 1)
            self.assertEqual(report["data_depth"]["rich_cache"]["without_destination_modules"], 0)
            self.assertEqual(len(report["artifacts"]["catalog"]["sha256"]), 64)

    def test_candidate_audit_blocks_duplicate_ids_and_missing_media_license(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog_path = root / "explore_catalog_v3.json"
            trails_path = root / "explore_trail_geometries_v1.json"
            records_path = root / "explore_source_records.jsonl"
            place = {
                "id": "place:nps:yell",
                "name": "Yellowstone National Park",
                "lat": 44.6,
                "lng": -110.5,
                "updated_at": 1_990_000_000,
                "source_pack": {
                    "nps_park_code": "yell",
                    "official_url": "https://www.nps.gov/yell/",
                    "license": "National Park Service public data",
                },
                "sources": [{"source": "nps"}],
                "media": [{"url": "https://www.nps.gov/yell.jpg", "caption": "Yellowstone", "credit": "NPS"}],
            }
            catalog_path.write_text(json.dumps({"schema_version": 3, "count": 2, "places": [place, dict(place)]}))
            trails_path.write_text(json.dumps({"trails": []}))
            records_path.write_text("")
            report = audit_candidate_catalog(
                catalog_path=catalog_path,
                trails_path=trails_path,
                source_records_path=records_path,
                now=2_000_000_000,
            )
            self.assertFalse(report["promotion_ready"])
            codes = {item["code"] for item in report["errors"]}
            self.assertIn("duplicate_place_id", codes)
            self.assertIn("media_attribution", codes)

    def test_candidate_audit_rejects_raw_reader_facing_subcategory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog_path = root / "explore_catalog_v3.json"
            trails_path = root / "explore_trail_geometries_v1.json"
            records_path = root / "explore_source_records.jsonl"
            catalog_path.write_text(json.dumps({
                "schema_version": 3,
                "count": 1,
                "places": [{
                    "id": "place:nps:yell",
                    "name": "Yellowstone National Park",
                    "subcategories": ["national_park"],
                    "lat": 44.6,
                    "lng": -110.5,
                    "updated_at": 1_990_000_000,
                    "source_pack": {
                        "nps_park_code": "yell",
                        "official_url": "https://www.nps.gov/yell/",
                        "license": "National Park Service public data",
                    },
                    "sources": [{"source": "nps"}],
                    "media": [{
                        "url": "https://www.nps.gov/yell.jpg",
                        "caption": "Yellowstone",
                        "credit": "NPS",
                        "license": "National Park Service public data",
                    }],
                }],
            }))
            trails_path.write_text(json.dumps({"trails": []}))
            records_path.write_text('{"source":"nps"}\n')

            report = audit_candidate_catalog(
                catalog_path=catalog_path,
                trails_path=trails_path,
                source_records_path=records_path,
                now=2_000_000_000,
            )

            self.assertFalse(report["promotion_ready"])
            self.assertIn("raw_subcategory", {item["code"] for item in report["errors"]})


if __name__ == "__main__":
    unittest.main()
