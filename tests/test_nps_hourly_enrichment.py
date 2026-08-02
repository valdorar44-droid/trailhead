from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.explore_sources.nps.fetch_nps import NpsRequestBudgetExceeded
from scripts.explore_sources.nps.import_nps import fee_pass_lines, summary_from_park
from scripts.run_nps_hourly_enrichment import (
    MAX_NPS_API_CALLS,
    audit_candidate_catalog,
    completed_codes,
    latest_source_snapshot_timestamp,
    layer_nps_candidate_delta,
    national_park_codes,
    requested_or_default_targets,
    resolve_candidate_dir,
    run_batch,
    sanitized_audit_env,
    select_batch,
    validate_api_call_limit,
    validate_state_path,
)


def write_passing_base_audit(base: Path) -> None:
    def digest(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    (base / "audit-report.json").write_text(json.dumps({
        "promotion_ready": True,
        "artifacts": {
            "catalog": {"sha256": digest(base / "explore_catalog_v3.json")},
            "trails": {"sha256": digest(base / "explore_trail_geometries_v1.json")},
            "source_records": {"sha256": digest(base / "explore_source_records.jsonl")},
        },
    }))


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
        old_nps = os.environ.get("NPS_API_KEY")
        os.environ["GEOAPIFY_API_KEY"] = "live-test-key"
        os.environ["NPS_API_KEY"] = "live-nps-key"
        try:
            env = sanitized_audit_env()
        finally:
            if old_value is None:
                os.environ.pop("GEOAPIFY_API_KEY", None)
            else:
                os.environ["GEOAPIFY_API_KEY"] = old_value
            if old_nps is None:
                os.environ.pop("NPS_API_KEY", None)
            else:
                os.environ["NPS_API_KEY"] = old_nps
        self.assertNotIn("GEOAPIFY_API_KEY", env)
        self.assertNotIn("NPS_API_KEY", env)

    def test_candidate_directory_is_separate_from_dashboard(self):
        candidate = resolve_candidate_dir(Path("data/explore/audit_candidates/nps"), "fixture", now=1)
        self.assertTrue(str(candidate).endswith("data/explore/audit_candidates/nps/fixture"))
        with self.assertRaises(SystemExit):
            resolve_candidate_dir(Path("dashboard"), "fixture", now=1)
        with self.assertRaises(SystemExit):
            resolve_candidate_dir(Path("data/explore/audit_candidates/nps"), "../dashboard", now=1)
        with self.assertRaises(SystemExit):
            validate_state_path(Path("dashboard/explore_serving_index_v2.json"))

    def test_live_delta_requires_selected_and_replacement_codes_to_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = argparse.Namespace(
                max_api_calls=50,
                estimated_calls_per_park=25,
                batch_size=2,
                park_code=[],
                force_fetch=False,
                dry_run=False,
                rebuild_cache_only=False,
                skip_rebuild=True,
                run_audits=False,
                candidate_root=str(root / "candidates"),
                candidate_run_id="fixture",
                base_candidate_dir=str(root / "base"),
                replace_park_code=["jame"],
                use_railway_env=False,
                source_cache_dir=str(root / "cache"),
                state=str(root / "state.json"),
                lock=str(root / "lock"),
                nps_limit=50,
                nps_max_records=500,
                related_max_records=100,
                http_timeout=1.0,
                _inside_railway_env=False,
            )
            with patch(
                "scripts.run_nps_hourly_enrichment.requested_or_default_targets",
                return_value=["jame", "hono"],
            ), patch(
                "scripts.run_nps_hourly_enrichment.completed_codes",
                return_value=set(),
            ), patch(
                "scripts.run_nps_hourly_enrichment.fetch_nps_source_pack_to_cache",
            ) as fetch:
                with self.assertRaises(SystemExit):
                    run_batch(args)
            fetch.assert_not_called()

    def test_candidate_preflight_rejects_before_any_live_fetch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / "cache"
            cache.mkdir()

            def make_args(name: str, *, candidate_root: Path, base: Path | None = None):
                return argparse.Namespace(
                    max_api_calls=25,
                    estimated_calls_per_park=25,
                    batch_size=1,
                    park_code=["jame"],
                    force_fetch=False,
                    dry_run=False,
                    rebuild_cache_only=False,
                    skip_rebuild=False,
                    run_audits=False,
                    candidate_root=str(candidate_root),
                    candidate_run_id=name,
                    base_candidate_dir=str(base) if base else "",
                    replace_park_code=["jame"] if base else [],
                    use_railway_env=False,
                    source_cache_dir=str(cache),
                    state=str(root / f"{name}-state.json"),
                    lock=str(root / f"{name}.lock"),
                    nps_limit=50,
                    nps_max_records=500,
                    related_max_records=100,
                    http_timeout=1.0,
                    _inside_railway_env=False,
                )

            existing_root = root / "existing-root"
            (existing_root / "existing").mkdir(parents=True)
            invalid_base = root / "invalid-base"
            invalid_base.mkdir()
            accepted_base = root / "accepted-base"
            accepted_base.mkdir()
            (accepted_base / "explore_catalog_v3.json").write_text('{"places":[]}')
            (accepted_base / "explore_source_records.jsonl").write_text("")
            (accepted_base / "explore_trail_geometries_v1.json").write_text('{"trails":[]}')
            write_passing_base_audit(accepted_base)

            cases = [
                make_args("existing", candidate_root=existing_root),
                make_args("invalid", candidate_root=root / "invalid-out", base=invalid_base),
                make_args("child", candidate_root=accepted_base, base=accepted_base),
            ]
            with patch.dict(os.environ, {"NPS_API_KEY": "fixture-key"}), patch(
                "scripts.run_nps_hourly_enrichment.requested_or_default_targets",
                return_value=["jame"],
            ), patch(
                "scripts.run_nps_hourly_enrichment.completed_codes",
                return_value=set(),
            ), patch(
                "scripts.run_nps_hourly_enrichment.fetch_nps_source_pack_to_cache",
            ) as fetch:
                for args in cases:
                    with self.subTest(candidate=args.candidate_run_id):
                        with self.assertRaises(SystemExit):
                            run_batch(args)
            fetch.assert_not_called()

    def test_latest_source_snapshot_timestamp_is_stable_and_uses_latest_fetch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "first.json"
            second = root / "second.json"
            ignored = root / "ignored.json"
            first.write_text(json.dumps({"fetched_at": 100}))
            second.write_text(json.dumps({"fetched_at": 200}))
            ignored.write_text(json.dumps({"fetched_at": "invalid"}))
            self.assertEqual(
                latest_source_snapshot_timestamp([str(first), str(second), str(ignored)]),
                200,
            )
            with self.assertRaises(SystemExit):
                latest_source_snapshot_timestamp([str(ignored)])

    def test_nps_delta_layer_replaces_only_selected_parent_and_source_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = root / "base"
            rebuilt = root / "rebuilt"
            candidate = root / "candidate"
            for path in (base, rebuilt, candidate):
                path.mkdir()

            base_places = [
                {"id": "place:nps:yell", "name": "Yellowstone accepted", "source_pack": {"nps_park_code": "yell"}},
                {"id": "place:nps:jame", "name": "Jamestown sparse", "source_pack": {"nps_park_code": "jame"}},
            ]
            rebuilt_places = [
                {"id": "place:nps:yell", "name": "Yellowstone changed", "source_pack": {"nps_park_code": "yell"}},
                {"id": "place:nps:jame", "name": "Jamestown rich", "source_pack": {"nps_park_code": "jame"}},
            ]
            (base / "explore_catalog_v3.json").write_text(json.dumps({"generated_at": 1, "count": 2, "places": base_places}))
            (rebuilt / "explore_catalog_v3.json").write_text(json.dumps({"generated_at": 2, "count": 2, "places": rebuilt_places}))
            (base / "explore_source_records.jsonl").write_text(
                json.dumps({"source": "nps", "source_id": "yell", "name": "Yellowstone accepted"}) + "\n"
                + json.dumps({"source": "nps", "source_id": "jame", "name": "Jamestown sparse"}) + "\n"
            )
            (rebuilt / "explore_source_records.jsonl").write_text(
                json.dumps({"source": "nps", "source_id": "yell", "name": "Yellowstone changed"}) + "\n"
                + json.dumps({"source": "nps", "source_id": "jame", "name": "Jamestown rich"}) + "\n"
            )
            base_trails = '{"generated_at":1,"trails":[]}\n'
            (base / "explore_trail_geometries_v1.json").write_text(base_trails)
            (rebuilt / "explore_trail_geometries_v1.json").write_text(base_trails)
            write_passing_base_audit(base)

            layer_nps_candidate_delta(
                base_dir=base,
                rebuilt_dir=rebuilt,
                candidate_dir=candidate,
                park_codes=["jame"],
                request_count=17,
                release_id="fixture-r1",
            )

            catalog = json.loads((candidate / "explore_catalog_v3.json").read_text())
            self.assertEqual(catalog["generated_at"], 2)
            self.assertEqual([place["name"] for place in catalog["places"]], ["Yellowstone accepted", "Jamestown rich"])
            records = [json.loads(line) for line in (candidate / "explore_source_records.jsonl").read_text().splitlines()]
            self.assertEqual([record["name"] for record in records], ["Yellowstone accepted", "Jamestown rich"])
            self.assertEqual((candidate / "explore_trail_geometries_v1.json").read_text(), base_trails)
            manifest = json.loads((candidate / "delta-manifest.json").read_text())
            self.assertEqual(manifest["park_codes"], ["jame"])
            self.assertEqual(manifest["requests_used_this_run"], 17)
            self.assertEqual(manifest["network_mode"], "live_fetch")
            self.assertEqual(manifest["release_id"], "fixture-r1")
            self.assertEqual(manifest["base_release_id"], "base")
            self.assertEqual(set(manifest["input_artifacts"]["base"]), {"catalog", "trails", "source_records"})
            self.assertEqual(set(manifest["output_artifacts"]), {"catalog", "trails", "source_records"})
            self.assertNotIn(str(base), json.dumps(manifest))

    def test_delta_rejects_overlapping_base_and_duplicate_selected_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = root / "base"
            rebuilt = root / "rebuilt"
            base.mkdir()
            rebuilt.mkdir()
            place = {"id": "place:nps:jame", "source_pack": {"nps_park_code": "jame"}}
            (base / "explore_catalog_v3.json").write_text(json.dumps({"places": [place]}))
            (base / "explore_source_records.jsonl").write_text('{"source":"nps","source_id":"jame"}\n')
            (base / "explore_trail_geometries_v1.json").write_text('{"trails":[]}\n')
            write_passing_base_audit(base)
            (rebuilt / "explore_catalog_v3.json").write_text(json.dumps({"places": [place, dict(place)]}))
            (rebuilt / "explore_source_records.jsonl").write_text('{"source":"nps","source_id":"jame"}\n')
            (rebuilt / "explore_trail_geometries_v1.json").write_text('{"trails":[]}\n')

            with self.assertRaises(SystemExit):
                layer_nps_candidate_delta(
                    base_dir=base,
                    rebuilt_dir=rebuilt,
                    candidate_dir=base,
                    park_codes=["jame"],
                )
            candidate = root / "candidate"
            candidate.mkdir()
            with self.assertRaises(SystemExit) as caught:
                layer_nps_candidate_delta(
                    base_dir=base,
                    rebuilt_dir=rebuilt,
                    candidate_dir=candidate,
                    park_codes=["jame"],
                )
            self.assertIn("duplicates", str(caught.exception))

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
            state_payload = json.loads(state.read_text())
            self.assertEqual(state_payload["selected_codes"], [])
            self.assertEqual(state_payload["replacement_codes"], [])

    def test_live_batch_persists_partial_state_and_reraises_fetch_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / "cache"
            cache.mkdir()
            state = root / "state.json"
            args = argparse.Namespace(
                max_api_calls=MAX_NPS_API_CALLS,
                estimated_calls_per_park=25,
                batch_size=2,
                park_code=[],
                force_fetch=False,
                dry_run=False,
                rebuild_cache_only=False,
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

            def fetch_side_effect(*, cache_dir, park_codes, **_kwargs):
                if park_codes == ["jame"]:
                    target = Path(cache_dir) / "nps" / "source-pack_codes-jame_with-places_max-500.json"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("{}")
                    return target
                raise RuntimeError("fixture provider failure")

            with patch.dict(os.environ, {"NPS_API_KEY": "fixture-key"}), patch(
                "scripts.run_nps_hourly_enrichment.requested_or_default_targets",
                return_value=["jame", "hono"],
            ), patch(
                "scripts.run_nps_hourly_enrichment.fetch_nps_source_pack_to_cache",
                side_effect=fetch_side_effect,
            ):
                with self.assertRaises(RuntimeError):
                    run_batch(args)

            state_text = state.read_text()
            payload = json.loads(state_text)
            self.assertEqual(payload["status"], "fetch_failed")
            self.assertEqual(payload["selected_codes"], ["jame", "hono"])
            self.assertEqual(payload["completed_codes"], ["jame"])
            self.assertEqual(len(payload["fetched"]), 1)
            self.assertTrue(payload["fetched"][0].endswith("source-pack_codes-jame_with-places_max-500.json"))
            self.assertNotIn("fixture-key", state_text)
            self.assertNotIn("fixture provider failure", state_text)

    def test_live_batch_budget_state_preserves_partial_fetches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / "cache"
            cache.mkdir()
            state = root / "state.json"
            args = argparse.Namespace(
                max_api_calls=MAX_NPS_API_CALLS,
                estimated_calls_per_park=25,
                batch_size=2,
                park_code=[],
                force_fetch=False,
                dry_run=False,
                rebuild_cache_only=False,
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

            def fetch_side_effect(*, cache_dir, park_codes, **_kwargs):
                if park_codes == ["jame"]:
                    target = Path(cache_dir) / "nps" / "source-pack_codes-jame_with-places_max-500.json"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("{}")
                    return target
                raise NpsRequestBudgetExceeded("fixture budget exhausted")

            with patch.dict(os.environ, {"NPS_API_KEY": "fixture-key"}), patch(
                "scripts.run_nps_hourly_enrichment.requested_or_default_targets",
                return_value=["jame", "hono"],
            ), patch(
                "scripts.run_nps_hourly_enrichment.fetch_nps_source_pack_to_cache",
                side_effect=fetch_side_effect,
            ):
                with self.assertRaises(NpsRequestBudgetExceeded):
                    run_batch(args)

            payload = json.loads(state.read_text())
            self.assertEqual(payload["status"], "budget_exhausted")
            self.assertEqual(payload["completed_codes"], ["jame"])
            self.assertEqual(len(payload["fetched"]), 1)

    def test_audit_failure_preserves_completed_candidate_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / "cache"
            cache.mkdir()
            state = root / "state.json"
            candidate_root = root / "candidates"
            args = argparse.Namespace(
                max_api_calls=MAX_NPS_API_CALLS,
                estimated_calls_per_park=25,
                batch_size=None,
                park_code=[],
                force_fetch=False,
                dry_run=False,
                rebuild_cache_only=True,
                skip_rebuild=False,
                run_audits=True,
                candidate_root=str(candidate_root),
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
            candidate_dir = candidate_root / "fixture"
            outputs = {
                "catalog_path": candidate_dir / "explore_catalog_v3.json",
                "trails_path": candidate_dir / "explore_trail_geometries_v1.json",
                "source_records_path": candidate_dir / "explore_source_records.jsonl",
            }

            with patch(
                "scripts.run_nps_hourly_enrichment.requested_or_default_targets",
                return_value=["yell"],
            ), patch(
                "scripts.run_nps_hourly_enrichment.completed_codes",
                return_value={"yell"},
            ), patch(
                "scripts.run_nps_hourly_enrichment.rebuild_catalog",
                return_value=outputs,
            ), patch(
                "scripts.run_nps_hourly_enrichment.audit_candidate_catalog",
                return_value={"promotion_ready": True},
            ), patch(
                "scripts.run_nps_hourly_enrichment.write_json",
            ), patch(
                "scripts.run_nps_hourly_enrichment.run_audits",
                side_effect=subprocess.CalledProcessError(1, ["audit"]),
            ):
                with self.assertRaises(subprocess.CalledProcessError):
                    run_batch(args)

            payload = json.loads(state.read_text())
            self.assertEqual(payload["status"], "audit_failed")
            self.assertEqual(payload["candidate_dir"], str(candidate_dir))

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
            records_path.write_text('{"source":"nps","source_id":"yell","fetched_at":1990000000}\n')
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

    def test_candidate_audit_uses_nps_source_record_freshness(self):
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
                    "updated_at": 2_000_000_000,
                    "source_pack": {
                        "nps_park_code": "yell",
                        "official_url": "https://www.nps.gov/yell/",
                        "license": "National Park Service public data",
                        "alerts": [{"title": "Road update"}],
                    },
                    "sources": [{"source": "nps"}],
                    "media": [],
                }],
            }))
            trails_path.write_text(json.dumps({"trails": []}))
            records_path.write_text('{"source":"nps","source_id":"yell","fetched_at":100}\n')
            report = audit_candidate_catalog(
                catalog_path=catalog_path,
                trails_path=trails_path,
                source_records_path=records_path,
                now=2_000_000_000,
            )
            warning_codes = {item["code"] for item in report["warnings"]}
            self.assertIn("stale_operational", warning_codes)

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

    def test_candidate_audit_rejects_relative_nps_media_urls(self):
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
                    "subcategories": ["National Park"],
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
                        "url": "/common/uploads/photo.jpg",
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
            self.assertIn("media_url", {item["code"] for item in report["errors"]})


if __name__ == "__main__":
    unittest.main()
