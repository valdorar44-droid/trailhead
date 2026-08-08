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
    DOSSIER_PATH,
    EDITORIAL_PATH,
    OUTPUT_PATH,
    PLACEMENTS,
    ROUTE_END_AUDIO_BACKLOG_LIMIT_S,
    ROUTE_EVIDENCE_PATH,
    ROOT,
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

    def test_exact_editorial_route_and_geometry_inputs_are_bound(self):
        bindings = self.artifact["input_bindings"]
        self.assertEqual(
            bindings["editorial_packet_sha256"],
            hashlib.sha256(EDITORIAL_PATH.read_bytes()).hexdigest(),
        )
        self.assertEqual(
            bindings["official_route_evidence_sha256"],
            hashlib.sha256(ROUTE_EVIDENCE_PATH.read_bytes()).hexdigest(),
        )
        self.assertEqual(
            bindings["source_dossier_sha256"],
            hashlib.sha256(DOSSIER_PATH.read_bytes()).hexdigest(),
        )
        route_evidence = json.loads(ROUTE_EVIDENCE_PATH.read_text(encoding="utf-8"))
        route = next(item for item in route_evidence["variants"] if item["id"] == "roaring-fork-one-way")
        self.assertEqual(bindings["geometry_sha256"], canonical_sha256(route["geometry"]))
        self.assertEqual(bindings["geometry_sha256"], route["geometry_sha256"])

    def test_stable_order_context_and_projection_are_local_to_checked_geometry(self):
        entries = self.artifact["entries"]
        self.assertEqual([item["id"] for item in entries], [item[0] for item in PLACEMENTS])
        self.assertEqual([item["stable_order"] for item in entries], list(range(1, 14)))
        progresses = [item["projected_progress_m"] for item in entries]
        self.assertEqual(progresses, sorted(progresses))
        for entry, (
            _entry_id,
            anchor_id,
            offset_m,
            placement_class,
            maximum_anchor_offset_m,
        ) in zip(entries, PLACEMENTS):
            self.assertEqual(entry["route_context"], anchor_id)
            self.assertEqual(entry["placement_class"], placement_class)
            self.assertEqual(entry["anchor"]["id"], anchor_id)
            self.assertEqual(entry["anchor"]["authoring_offset_m"], offset_m)
            self.assertEqual(
                entry["anchor"]["maximum_reviewed_offset_m"], maximum_anchor_offset_m
            )
            self.assertLessEqual(abs(offset_m), maximum_anchor_offset_m)
            self.assertAlmostEqual(
                entry["projected_progress_m"],
                entry["anchor"]["checked_progress_m"] + offset_m,
                places=1,
            )

        route_evidence = json.loads(ROUTE_EVIDENCE_PATH.read_text(encoding="utf-8"))
        route = next(item for item in route_evidence["variants"] if item["id"] == "roaring-fork-one-way")
        route_coordinates = route["geometry"]["coordinates"]
        cumulative, _distance_m = measure_route(route_coordinates)
        for entry in entries:
            point = [entry["projected_coordinate"]["lng"], entry["projected_coordinate"]["lat"]]
            expected = interpolate(route_coordinates, cumulative, entry["projected_progress_m"])
            self.assertLess(
                haversine_m(point, expected),
                0.1,
            )

    def test_trigger_contract_is_bounded_and_capability_ready(self):
        route_distance = self.artifact["route"]["measured_distance_m"]
        for entry in self.artifact["entries"]:
            trigger = entry["trigger"]
            self.assertGreaterEqual(trigger["route_progress_start_m"], 0)
            self.assertLess(trigger["route_progress_start_m"], entry["projected_progress_m"])
            self.assertGreater(trigger["route_progress_end_m"], entry["projected_progress_m"])
            self.assertLessEqual(trigger["route_progress_end_m"], route_distance)
            self.assertGreaterEqual(trigger["enter_radius_m"], 50)
            self.assertGreaterEqual(trigger["exit_radius_m"], trigger["enter_radius_m"] * 1.5)
            self.assertGreaterEqual(trigger["approach_bearing_deg"], 0)
            self.assertLess(trigger["approach_bearing_deg"], 360)
            self.assertGreaterEqual(trigger["bearing_tolerance_deg"], 1)
            self.assertLessEqual(trigger["bearing_tolerance_deg"], 180)

    def test_real_durations_remain_null_and_fifo_estimates_cannot_publish(self):
        self.assertTrue(self.artifact["authoring_only"])
        self.assertEqual(
            self.artifact["publication_status"],
            "blocked_pending_exact_scene_resolution_real_audio_durations_and_fifo_validation",
        )
        capacity = self.artifact["runtime_capacity"]
        self.assertEqual(capacity["current_playback_slots"], 1)
        self.assertEqual(capacity["pending_queue_model"], "durable_ordered_fifo")
        self.assertEqual(
            capacity["pending_queue_capacity"], "bounded_by_manifest_entry_count"
        )
        self.assertEqual(capacity["validation_engine_version"], VALIDATION_ENGINE_VERSION)
        self.assertEqual(capacity["validation_suite_version"], VALIDATION_SUITE_VERSION)
        self.assertEqual(
            capacity["route_end_audio_backlog_limit_s"], ROUTE_END_AUDIO_BACKLOG_LIMIT_S
        )
        self.assertEqual(
            capacity["trigger_to_play_latency_limit_s"], TRIGGER_TO_PLAY_LATENCY_LIMIT_S
        )
        self.assertEqual(capacity["fifo_validation_status"], "blocked_pending_real_audio_durations")
        self.assertFalse(capacity["gates_weakened"])
        for entry in self.artifact["entries"]:
            self.assertIsNone(entry["audio_duration_s"])
            self.assertGreater(entry["authoring_estimated_duration_s"], 0)
        for item in self.artifact["fifo_validation_input"]:
            self.assertIsNone(item["audio_duration_s"])
            self.assertGreater(item["authoring_estimated_duration_s"], 0)

        capacity_v3 = self.artifact["fifo_capacity_metrics_v3"]
        self.assertFalse(capacity_v3["real_audio_durations_used"])
        self.assertEqual(
            capacity_v3["publication_gate_status"],
            "blocked_pending_real_audio_and_validator_report",
        )
        self.assertEqual(
            [scenario["speed_mph"] for scenario in capacity_v3["scenarios"]],
            [15, 36, 65, 75],
        )
        self.assertTrue(all(scenario["legacy_one_pending_slot_would_overflow"] for scenario in capacity_v3["scenarios"]))
        self.assertTrue(any(scenario["estimated_context_limits_exceeded"] for scenario in capacity_v3["scenarios"]))

    def test_exact_scene_openings_stay_near_landmarks_and_clusters_block(self):
        entries = {entry["id"]: entry for entry in self.artifact["entries"]}
        for entry_id in (
            "rf_cue_01",
            "rf_story_01",
            "rf_cue_02",
            "rf_story_03",
            "rf_cue_04",
            "rf_cue_05",
            "rf_story_06",
            "rf_story_07",
            "rf_cue_06",
        ):
            entry = entries[entry_id]
            self.assertNotEqual(entry["placement_class"], "corridor_context")
            self.assertLessEqual(
                abs(entry["anchor"]["authoring_offset_m"]),
                entry["anchor"]["maximum_reviewed_offset_m"],
            )
        self.assertLessEqual(abs(entries["rf_story_03"]["anchor"]["authoring_offset_m"]), 300)
        self.assertLessEqual(abs(entries["rf_story_06"]["anchor"]["authoring_offset_m"]), 250)
        self.assertLessEqual(abs(entries["rf_story_07"]["anchor"]["authoring_offset_m"]), 400)

        feasibility = self.artifact["placement_feasibility"]
        self.assertEqual(feasibility["status"], "blocked")
        self.assertTrue(feasibility["all_proposed_offsets_within_reviewed_context_windows"])
        self.assertFalse(feasibility["all_exact_scene_landmarks_evidence_backed"])
        cluster_blockers = {
            item["anchor_id"]: item
            for item in feasibility["blockers"]
            if item["code"] == "exact_scene_cluster_requires_real_duration_proof_or_editorial_resolution"
        }
        self.assertEqual(
            set(cluster_blockers),
            {"roaring_fork_entrance", "thousand_drips", "roaring_fork_exit"},
        )
        self.assertEqual(
            cluster_blockers["roaring_fork_entrance"]["entry_ids"],
            ["rf_cue_01", "rf_story_01", "rf_cue_02", "rf_story_03"],
        )
        self.assertEqual(
            cluster_blockers["thousand_drips"]["entry_ids"],
            ["rf_cue_05", "rf_story_06"],
        )
        self.assertEqual(
            cluster_blockers["roaring_fork_exit"]["entry_ids"],
            ["rf_story_07", "rf_cue_06"],
        )
        missing_landmark = next(
            item for item in feasibility["blockers"]
            if item["code"] == "exact_scene_landmark_missing_from_checked_route_evidence"
        )
        self.assertEqual(missing_landmark["entry_ids"], ["rf_cue_02", "rf_story_03"])
        for entry_id in ("rf_cue_02", "rf_story_03"):
            self.assertEqual(entries[entry_id]["placement_status"], "blocked_missing_exact_landmark")
            self.assertEqual(
                entries[entry_id]["opening_audit"]["anchor_evidence"],
                "proxy_route_context_only",
            )
        self.assertEqual(
            {entry["id"] for entry in self.artifact["entries"]},
            {entry["id"] for entry in self.artifact["entries"] if entry.get("opening_audit")},
        )

    def test_v3_fifo_runtime_observation_is_source_bound(self):
        sources: dict[str, str] = {}
        for path, expected_sha256 in ACCEPTED_RUNTIME_SOURCE_SHA256.items():
            completed = subprocess.run(
                ["git", "show", f"{ACCEPTED_RUNTIME_REVISION}:{path}"],
                cwd=ROOT,
                check=True,
                capture_output=True,
            )
            self.assertEqual(hashlib.sha256(completed.stdout).hexdigest(), expected_sha256)
            sources[path] = completed.stdout.decode("utf-8")
        self.assertIn("pending_stop_ids", sources["mobile/lib/originals/session.ts"])
        self.assertIn("promoteNextOriginalStop", sources["mobile/lib/originals/runtime.tsx"])
        self.assertIn("promoteNextOriginalStop", sources["mobile/lib/originals/headlessController.ts"])
        self.assertIn(
            "ORIGINAL_ROUTE_MAX_ROUTE_END_AUDIO_BACKLOG_S = 240",
            sources["mobile/lib/originals/routeValidation.ts"],
        )
        self.assertIn(
            "ORIGINAL_ROUTE_MAX_TRIGGER_TO_PLAY_LATENCY_S = 180",
            sources["mobile/lib/originals/routeValidation.ts"],
        )
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

    def test_builder_has_no_network_or_mapbox_dependency(self):
        source = (ROOT / "scripts/build_smokies_roaring_fork_trigger_preflight.py").read_text(
            encoding="utf-8"
        )
        for forbidden in ("requests", "httpx", "urllib.request", "api.mapbox.com"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
