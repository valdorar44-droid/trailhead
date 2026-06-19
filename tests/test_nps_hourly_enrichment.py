from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from scripts.run_nps_hourly_enrichment import (
    completed_codes,
    national_park_codes,
    requested_or_default_targets,
    sanitized_audit_env,
    select_batch,
)


class NpsHourlyEnrichmentTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
