from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.build_smokies_roaring_fork_trigger_preflight import (
    ACCEPTED_RUNTIME_REVISION,
    ACCEPTED_RUNTIME_SOURCE_SHA256,
    CAPACITY_DEEPER,
    CAPACITY_HARD_AUTO_GUARD_S,
    COMPLETION_DEEPER,
    DOSSIER_PATH,
    EDITORIAL_PATH,
    HARD_AUTO,
    OGLE_COORDINATES,
    OGLE_LANDMARK_ID,
    OGLE_ROUTE_LATERAL_DISTANCE_M,
    OGLE_SOURCE_RECORD,
    OUTPUT_PATH,
    PLACEMENTS,
    ROUTE_END_AUDIO_BACKLOG_LIMIT_S,
    ROUTE_EVIDENCE_PATH,
    ROOT,
    STOPPED_DEEPER,
    TRIGGER_TO_PLAY_LATENCY_LIMIT_S,
    VALIDATION_ENGINE_VERSION,
    VALIDATION_SUITE_VERSION,
    TriggerPreflightError,
    build_artifact,
    canonical_sha256,
    haversine_m,
    interpolate,
    measure_route,
    serialize,
)


class RoaringForkTriggerPreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifact = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))

    def test_checked_artifact_rebuilds_byte_for_byte(self):
        self.assertEqual(OUTPUT_PATH.read_text(encoding="utf-8"), serialize(build_artifact()))

    def test_schema_v2_accounts_for_every_entry_exactly_once(self):
        self.assertEqual(self.artifact["schema_version"], 2)
        summary = self.artifact["delivery_summary"]
        self.assertEqual(summary["entry_count"], 13)
        self.assertTrue(summary["accounted_exactly_once"])
        self.assertEqual(
            summary["entry_ids_by_mode"],
            {
                HARD_AUTO: ["rf_cue_01", "rf_cue_04", "rf_cue_03", "rf_cue_05", "rf_cue_06"],
                CAPACITY_DEEPER: ["rf_story_01", "rf_story_02", "rf_story_04", "rf_story_05"],
                STOPPED_DEEPER: ["rf_cue_02", "rf_story_03", "rf_story_06"],
                COMPLETION_DEEPER: ["rf_story_07"],
            },
        )
        accounted = [
            entry_id
            for ids in summary["entry_ids_by_mode"].values()
            for entry_id in ids
        ]
        self.assertEqual(len(accounted), len(set(accounted)))
        self.assertEqual(set(accounted), {spec.entry_id for spec in PLACEMENTS})
        self.assertEqual(summary["ogle_prelude_entry_ids"], ["rf_cue_02", "rf_story_03"])
        self.assertEqual(summary["ogle_prelude_user_facing_entry_count"], 1)

    def test_exact_editorial_route_geometry_and_ogle_source_are_bound(self):
        bindings = self.artifact["input_bindings"]
        self.assertEqual(bindings["editorial_packet_sha256"], hashlib.sha256(EDITORIAL_PATH.read_bytes()).hexdigest())
        self.assertEqual(bindings["official_route_evidence_sha256"], hashlib.sha256(ROUTE_EVIDENCE_PATH.read_bytes()).hexdigest())
        self.assertEqual(bindings["source_dossier_sha256"], hashlib.sha256(DOSSIER_PATH.read_bytes()).hexdigest())
        route_evidence = json.loads(ROUTE_EVIDENCE_PATH.read_text(encoding="utf-8"))
        route = next(item for item in route_evidence["variants"] if item["id"] == "roaring-fork-one-way")
        self.assertEqual(bindings["geometry_sha256"], route["geometry_sha256"])
        self.assertEqual(bindings["geometry_sha256"], "d66f76d6053000244d7e15c8be0494f48d79544e0ceaf79428c51e458e964668")
        self.assertEqual(self.artifact["route"]["evidence_distance_m"], 8561.4)
        self.assertEqual(bindings["ogle_official_source_record_sha256"], canonical_sha256(OGLE_SOURCE_RECORD))
        evidence = self.artifact["landmark_evidence"][OGLE_LANDMARK_ID]
        self.assertEqual(evidence["source_record"], OGLE_SOURCE_RECORD)
        self.assertEqual(evidence["source_record_sha256"], canonical_sha256(OGLE_SOURCE_RECORD))
        self.assertEqual(evidence["binding_status"], "off_route_before_start")
        self.assertEqual(evidence["route_binding"]["lateral_distance_m"], OGLE_ROUTE_LATERAL_DISTANCE_M)
        self.assertEqual(evidence["parking_reference"]["parking_availability"], "not_checked")
        self.assertFalse(evidence["parking_reference"]["parking_promise"])

    def test_on_route_projection_and_off_route_ogle_binding_are_honest(self):
        entries = self.artifact["entries"]
        self.assertEqual([entry["id"] for entry in entries], [spec.entry_id for spec in PLACEMENTS])
        self.assertEqual([entry["stable_order"] for entry in entries], list(range(1, 14)))
        by_id = {entry["id"]: entry for entry in entries}
        for entry_id in ("rf_cue_02", "rf_story_03"):
            entry = by_id[entry_id]
            self.assertEqual(entry["anchor"]["id"], OGLE_LANDMARK_ID)
            self.assertEqual(entry["placement_status"], "resolved_off_route_stopped_vehicle")
            self.assertIsNone(entry["projected_progress_m"])
            self.assertIsNone(entry["trigger"])
            self.assertEqual(
                [entry["projected_coordinate"]["lng"], entry["projected_coordinate"]["lat"]],
                OGLE_COORDINATES,
            )

        route_evidence = json.loads(ROUTE_EVIDENCE_PATH.read_text(encoding="utf-8"))
        route = next(item for item in route_evidence["variants"] if item["id"] == "roaring-fork-one-way")
        route_coordinates = route["geometry"]["coordinates"]
        cumulative, _distance_m = measure_route(route_coordinates)
        on_route = [entry for entry in entries if entry["projected_progress_m"] is not None]
        self.assertEqual(
            [entry["projected_progress_m"] for entry in on_route],
            sorted(entry["projected_progress_m"] for entry in on_route),
        )
        for entry in on_route:
            point = [entry["projected_coordinate"]["lng"], entry["projected_coordinate"]["lat"]]
            expected = interpolate(route_coordinates, cumulative, entry["projected_progress_m"])
            self.assertLess(haversine_m(point, expected), 0.1)

    def test_only_moving_modes_have_route_triggers(self):
        route_distance = self.artifact["route"]["measured_distance_m"]
        for entry in self.artifact["entries"]:
            mode = entry["delivery"]["mode"]
            if mode not in {HARD_AUTO, CAPACITY_DEEPER}:
                self.assertIsNone(entry["trigger"])
                continue
            trigger = entry["trigger"]
            self.assertGreaterEqual(trigger["route_progress_start_m"], 0)
            self.assertLess(trigger["route_progress_start_m"], entry["projected_progress_m"])
            self.assertGreater(trigger["route_progress_end_m"], entry["projected_progress_m"])
            self.assertLessEqual(trigger["route_progress_end_m"], route_distance)
            self.assertGreaterEqual(trigger["exit_radius_m"], trigger["enter_radius_m"] * 1.5)
            self.assertGreaterEqual(trigger["approach_bearing_deg"], 0)
            self.assertLess(trigger["approach_bearing_deg"], 360)

    def test_delivery_inputs_are_separate_and_capacity_estimates_match_review(self):
        self.assertEqual([item["id"] for item in self.artifact["hard_auto_fifo_input"]], ["rf_cue_01", "rf_cue_04", "rf_cue_03", "rf_cue_05", "rf_cue_06"])
        self.assertEqual([item["id"] for item in self.artifact["capacity_admission_input"]], ["rf_story_01", "rf_story_02", "rf_story_04", "rf_story_05"])
        self.assertEqual([item["id"] for item in self.artifact["non_moving_delivery_input"]], ["rf_cue_02", "rf_story_03", "rf_story_06", "rf_story_07"])
        for item in self.artifact["capacity_admission_input"]:
            self.assertEqual(item["fallback_mode"], COMPLETION_DEEPER)
            self.assertEqual(item["admission_rule"]["finish_guard_before_next_hard_window_s"], CAPACITY_HARD_AUTO_GUARD_S)
            self.assertFalse(item["admission_rule"]["may_queue_behind_capacity"])

        scenarios = {item["speed_mph"]: item for item in self.artifact["delivery_capacity_metrics_v1"]["scenarios"]}
        self.assertEqual(scenarios[15]["admitted_capacity_ids"], ["rf_story_01", "rf_story_02", "rf_story_05"])
        self.assertEqual(scenarios[15]["rejected_capacity"], [{"id": "rf_story_04", "reason": "capacity_story_active"}])
        for speed in (36, 65, 75):
            self.assertEqual(scenarios[speed]["admitted_capacity_ids"], [])
        self.assertEqual([scenarios[speed]["estimated_audio_tail_after_route_end_s"] for speed in (15, 36, 65, 75)], [0.0, 6.0, 13.7, 16.5])
        self.assertEqual([scenarios[speed]["estimated_maximum_trigger_to_play_latency_s"] for speed in (15, 36, 65, 75)], [14.8, 0.0, 0.0, 1.6])
        self.assertTrue(all(not scenario["estimated_context_limits_exceeded"] for scenario in scenarios.values()))

    def test_stopped_entries_never_imply_parking_or_motion_inference(self):
        stopped = [entry for entry in self.artifact["entries"] if entry["delivery"]["mode"] == STOPPED_DEEPER]
        self.assertEqual({entry["id"] for entry in stopped}, {"rf_cue_02", "rf_story_03", "rf_story_06"})
        for entry in stopped:
            delivery = entry["delivery"]
            self.assertTrue(delivery["requires_user_confirmed_parked"])
            self.assertEqual(delivery["parking_availability"], "not_checked")
            self.assertFalse(delivery["parking_promise"])
            self.assertFalse(delivery["motion_inference_allowed"])
        thousand_drips = next(entry for entry in stopped if entry["id"] == "rf_story_06")
        self.assertEqual(thousand_drips["delivery"]["availability"], "at_landmark_user_confirmed_parked")

    def test_publication_stays_blocked_without_runtime_and_real_audio(self):
        self.assertTrue(self.artifact["authoring_only"])
        self.assertEqual(self.artifact["publication_status"], "blocked_pending_consumer_delivery_runtime_real_audio_durations_and_fifo_validation")
        capacity = self.artifact["runtime_capacity"]
        self.assertFalse(capacity["consumer_delivery_modes_supported"])
        self.assertEqual(capacity["delivery_runtime_status"], "blocked_missing_consumer_delivery_runtime")
        self.assertEqual(capacity["route_end_audio_backlog_limit_s"], ROUTE_END_AUDIO_BACKLOG_LIMIT_S)
        self.assertEqual(capacity["trigger_to_play_latency_limit_s"], TRIGGER_TO_PLAY_LATENCY_LIMIT_S)
        self.assertEqual(capacity["capacity_hard_auto_guard_s"], CAPACITY_HARD_AUTO_GUARD_S)
        self.assertFalse(capacity["gates_weakened"])
        self.assertEqual(capacity["validation_engine_version"], VALIDATION_ENGINE_VERSION)
        self.assertEqual(capacity["validation_suite_version"], VALIDATION_SUITE_VERSION)
        self.assertEqual(
            {item["code"] for item in self.artifact["placement_feasibility"]["blockers"]},
            {"consumer_delivery_runtime_missing", "immutable_audio_durations_missing"},
        )
        for entry in self.artifact["entries"]:
            self.assertIsNone(entry["audio_duration_s"])
            self.assertGreater(entry["authoring_estimated_duration_s"], 0)

    def test_v3_fifo_runtime_observation_is_source_bound(self):
        sources: dict[str, str] = {}
        for path, expected_sha256 in ACCEPTED_RUNTIME_SOURCE_SHA256.items():
            completed = subprocess.run(["git", "show", f"{ACCEPTED_RUNTIME_REVISION}:{path}"], cwd=ROOT, check=True, capture_output=True)
            self.assertEqual(hashlib.sha256(completed.stdout).hexdigest(), expected_sha256)
            sources[path] = completed.stdout.decode("utf-8")
        self.assertIn("pending_stop_ids", sources["mobile/lib/originals/session.ts"])
        self.assertIn("promoteNextOriginalStop", sources["mobile/lib/originals/runtime.tsx"])
        self.assertIn("promoteNextOriginalStop", sources["mobile/lib/originals/headlessController.ts"])
        self.assertIn("ORIGINAL_ROUTE_MAX_ROUTE_END_AUDIO_BACKLOG_S = 240", sources["mobile/lib/originals/routeValidation.ts"])
        self.assertIn("ORIGINAL_ROUTE_MAX_TRIGGER_TO_PLAY_LATENCY_S = 180", sources["mobile/lib/originals/routeValidation.ts"])
        self.assertNotIn("queue_full", sources["mobile/lib/originals/triggerEngine.ts"])

    def test_editorial_or_geometry_drift_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            temp = Path(temporary_directory)
            changed_editorial = json.loads(EDITORIAL_PATH.read_text(encoding="utf-8"))
            changed_editorial["dossier_sha256"] = "0" * 64
            editorial_path = temp / "editorial.json"
            editorial_path.write_text(json.dumps(changed_editorial), encoding="utf-8")
            with self.assertRaisesRegex(TriggerPreflightError, "source dossier"):
                build_artifact(editorial_path=editorial_path)

            changed_route = copy.deepcopy(json.loads(ROUTE_EVIDENCE_PATH.read_text(encoding="utf-8")))
            route = next(item for item in changed_route["variants"] if item["id"] == "roaring-fork-one-way")
            route["geometry"]["coordinates"][100][0] += 0.001
            route_path = temp / "route.json"
            route_path.write_text(json.dumps(changed_route), encoding="utf-8")
            with self.assertRaisesRegex(TriggerPreflightError, "geometry hash"):
                build_artifact(route_evidence_path=route_path)

    def test_builder_has_no_network_or_mapbox_dependency_and_no_cli_gate_override(self):
        source = (ROOT / "scripts/build_smokies_roaring_fork_trigger_preflight.py").read_text(encoding="utf-8")
        for forbidden in ("requests", "httpx", "urllib.request", "api.mapbox.com", "--route-end-audio-backlog", "--trigger-to-play-latency", "--capacity-hard-auto-guard"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
