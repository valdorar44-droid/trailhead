#!/usr/bin/env python3
"""Build the local, authoring-only Roaring Fork trigger preflight.

Only checked-in official geometry is used. Real rendered audio durations remain
required before the runtime FIFO gate can run or publication can proceed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
EDITORIAL_PATH = ROOT / "originals/smokies/editorial_roaring_fork_v1.json"
DOSSIER_PATH = ROOT / "originals/smokies/source_dossiers_v1.json"
ROUTE_EVIDENCE_PATH = ROOT / "originals/smokies/official_route_evidence_v1.json"
OUTPUT_PATH = ROOT / "originals/smokies/roaring_fork_trigger_preflight_v1.json"

CHAPTER_ID = "roaring_fork"
VARIANT_ID = "one_way"
ROUTE_ID = "roaring-fork-one-way"
EARTH_RADIUS_M = 6_371_008.8
WINDOW_HALF_WIDTH_M = 180.0
ENTER_RADIUS_M = 160.0
EXIT_RADIUS_M = 260.0
BEARING_TOLERANCE_DEG = 70.0
SPEEDS_MPH = (15, 36, 65, 75)
ACCEPTED_RUNTIME_REVISION = "88e6a945b9aad9df5022b7a1710ea5be5873dd26"
ACCEPTED_RUNTIME_SOURCE_SHA256 = {
    "mobile/lib/originals/session.ts": "415cdb51b38bd50eed596e1a86b1dc0b49da4fb60aeb65de78a1026faebc9c70",
    "mobile/lib/originals/triggerEngine.ts": "d8f502d4eec89310bbf8fa0031814570d09965bab066385d6229f3b348215955",
    "mobile/lib/originals/routeValidation.ts": "f6d9ce20cf0ec9188d22642d5a8c4fc4d53db82cef84f36852616b648df6cbdc",
    "mobile/lib/originals/runtime.tsx": "1b33c8874e0e90fffd6d2be6f7192756f9f11c255db980199581b2d16aa25b6e",
    "mobile/lib/originals/headlessController.ts": "8f3e3600e4efcbe9dfd936dae37ceb37c3c92d944742005f24f72888ce585d13",
}
VALIDATION_ENGINE_VERSION = "original-trigger-v3"
VALIDATION_SUITE_VERSION = "originals_virtual_route_v3"
ROUTE_END_AUDIO_BACKLOG_LIMIT_S = 240
TRIGGER_TO_PLAY_LATENCY_LIMIT_S = 180

# Stable route order. Exact-scene entries remain inside a reviewed maximum
# offset from the official landmark even when that exposes a capacity blocker.
PLACEMENTS: tuple[tuple[str, str, float, str, float], ...] = (
    ("rf_cue_01", "roaring_fork_entrance", 40.0, "route_boundary_scene", 150.0),
    ("rf_story_01", "roaring_fork_entrance", 110.0, "route_boundary_scene", 200.0),
    ("rf_cue_02", "roaring_fork_entrance", 190.0, "exact_scene_proxy_blocked", 250.0),
    ("rf_story_03", "roaring_fork_entrance", 270.0, "exact_scene_proxy_blocked", 300.0),
    ("rf_cue_04", "grotto_falls_parking", -100.0, "exact_landmark_scene", 200.0),
    ("rf_cue_03", "roaring_fork_upper", -800.0, "corridor_context", 1_000.0),
    ("rf_story_02", "roaring_fork_upper", -350.0, "corridor_context", 1_000.0),
    ("rf_story_04", "roaring_fork_upper", 400.0, "corridor_context", 800.0),
    ("rf_story_05", "roaring_fork_mid", 250.0, "corridor_context", 800.0),
    ("rf_cue_05", "thousand_drips", -220.0, "exact_landmark_scene", 250.0),
    ("rf_story_06", "thousand_drips", -60.0, "exact_landmark_scene", 250.0),
    ("rf_story_07", "roaring_fork_exit", -300.0, "route_boundary_scene", 400.0),
    ("rf_cue_06", "roaring_fork_exit", 80.0, "route_boundary_scene", 150.0),
)

# Transcript-opening audit. The Ogle entries intentionally fail closed because
# the checked route evidence has only the route entrance, not an Ogle landmark.
OPENING_AUDIT: dict[str, dict[str, str]] = {
    "rf_cue_01": {"scope": "exact_scene", "binding": "motor_trail_entrance", "anchor_evidence": "direct_official_landmark"},
    "rf_story_01": {"scope": "exact_scene", "binding": "motor_trail_entrance", "anchor_evidence": "direct_official_landmark"},
    "rf_cue_02": {"scope": "exact_scene", "binding": "ogle_farmstead", "anchor_evidence": "proxy_route_context_only"},
    "rf_story_03": {"scope": "exact_scene", "binding": "ogle_farmstead", "anchor_evidence": "proxy_route_context_only"},
    "rf_cue_04": {"scope": "exact_scene", "binding": "trillium_gap_trailhead", "anchor_evidence": "direct_official_landmark"},
    "rf_cue_03": {"scope": "corridor", "binding": "stream_beside_route", "anchor_evidence": "official_corridor_control"},
    "rf_story_02": {"scope": "corridor", "binding": "stream_beside_route", "anchor_evidence": "official_corridor_control"},
    "rf_story_04": {"scope": "corridor", "binding": "wet_forest_corridor", "anchor_evidence": "official_corridor_control"},
    "rf_story_05": {"scope": "corridor", "binding": "historic_structure_corridor", "anchor_evidence": "official_corridor_control"},
    "rf_cue_05": {"scope": "exact_scene", "binding": "place_of_a_thousand_drips", "anchor_evidence": "direct_official_landmark"},
    "rf_story_06": {"scope": "exact_scene", "binding": "place_of_a_thousand_drips", "anchor_evidence": "direct_official_landmark"},
    "rf_story_07": {"scope": "route_boundary", "binding": "near_route_end", "anchor_evidence": "direct_official_landmark"},
    "rf_cue_06": {"scope": "route_boundary", "binding": "route_end", "anchor_evidence": "direct_official_landmark"},
}


class TriggerPreflightError(ValueError):
    """Local evidence cannot produce a trustworthy preflight."""


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TriggerPreflightError(f"{path.name} must contain an object")
    return value


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def binding_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def canonical_sha256(value: Any) -> str:
    rendered = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()


def haversine_m(first: list[float], second: list[float]) -> float:
    lon1, lat1 = map(math.radians, first)
    lon2, lat2 = map(math.radians, second)
    d_lon = lon2 - lon1
    d_lat = lat2 - lat1
    hav = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(hav)))


def measure_route(coordinates: list[list[float]]) -> tuple[list[float], float]:
    if len(coordinates) < 2:
        raise TriggerPreflightError("Official geometry must contain at least two coordinates")
    cumulative = [0.0]
    for first, second in zip(coordinates, coordinates[1:]):
        segment_m = haversine_m(first, second)
        if segment_m <= 0:
            raise TriggerPreflightError("Official geometry contains a zero-length segment")
        cumulative.append(cumulative[-1] + segment_m)
    return cumulative, cumulative[-1]


def interpolate(
    coordinates: list[list[float]], cumulative: list[float], progress_m: float
) -> list[float]:
    bounded = min(max(progress_m, 0.0), cumulative[-1])
    for index in range(1, len(cumulative)):
        if cumulative[index] < bounded:
            continue
        segment_start = cumulative[index - 1]
        fraction = (bounded - segment_start) / (cumulative[index] - segment_start)
        first, second = coordinates[index - 1], coordinates[index]
        return [
            first[0] + (second[0] - first[0]) * fraction,
            first[1] + (second[1] - first[1]) * fraction,
        ]
    return list(coordinates[-1])


def bearing_deg(first: list[float], second: list[float]) -> float:
    lon1, lat1 = map(math.radians, first)
    lon2, lat2 = map(math.radians, second)
    d_lon = lon2 - lon1
    y = math.sin(d_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d_lon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def local_bearing(
    coordinates: list[list[float]], cumulative: list[float], progress_m: float
) -> float:
    return bearing_deg(
        interpolate(coordinates, cumulative, progress_m - 15.0),
        interpolate(coordinates, cumulative, progress_m + 15.0),
    )


def runtime_queue_contract() -> dict[str, Any]:
    """Bind the accepted durable FIFO runtime and its publication limits."""
    return {
        "current_playback_slots": 1,
        "pending_queue_model": "durable_ordered_fifo",
        "pending_queue_capacity": "bounded_by_manifest_entry_count",
        "contract_observation": "one_active_plus_durable_fifo",
        "source_revision": ACCEPTED_RUNTIME_REVISION,
        "source_sha256_by_path": dict(ACCEPTED_RUNTIME_SOURCE_SHA256),
        "validation_engine_version": VALIDATION_ENGINE_VERSION,
        "validation_suite_version": VALIDATION_SUITE_VERSION,
        "route_end_audio_backlog_limit_s": ROUTE_END_AUDIO_BACKLOG_LIMIT_S,
        "trigger_to_play_latency_limit_s": TRIGGER_TO_PLAY_LATENCY_LIMIT_S,
    }


def estimated_fifo_metrics(
    entries: list[dict[str, Any]], route_distance_m: float, speed_mph: int
) -> dict[str, Any]:
    """Estimate queue pressure without treating word-count timing as evidence."""
    metres_per_second = speed_mph * 0.44704
    scheduled_finishes: list[float] = []
    maximum_pending_depth = 0
    maximum_trigger_to_play_latency_s = 0.0
    for entry in entries:
        arrival_s = entry["projected_progress_m"] / metres_per_second
        unfinished = sum(finish_s > arrival_s for finish_s in scheduled_finishes)
        maximum_pending_depth = max(maximum_pending_depth, unfinished)
        prior_finish_s = scheduled_finishes[-1] if scheduled_finishes else 0.0
        start_s = max(arrival_s, prior_finish_s)
        maximum_trigger_to_play_latency_s = max(
            maximum_trigger_to_play_latency_s, start_s - arrival_s
        )
        scheduled_finishes.append(start_s + entry["authoring_estimated_duration_s"])
    route_travel_s = route_distance_m / metres_per_second
    final_finish_s = scheduled_finishes[-1]
    route_end_backlog_s = max(0.0, final_finish_s - route_travel_s)
    return {
        "speed_mph": speed_mph,
        "route_travel_s": round(route_travel_s, 1),
        "estimated_total_audio_s": round(
            sum(entry["authoring_estimated_duration_s"] for entry in entries), 1
        ),
        "estimated_maximum_pending_depth": maximum_pending_depth,
        "legacy_one_pending_slot_would_overflow": maximum_pending_depth > 1,
        "estimated_audio_tail_after_route_end_s": round(route_end_backlog_s, 1),
        "estimated_maximum_trigger_to_play_latency_s": round(
            maximum_trigger_to_play_latency_s, 1
        ),
        "route_end_audio_backlog_limit_s": ROUTE_END_AUDIO_BACKLOG_LIMIT_S,
        "trigger_to_play_latency_limit_s": TRIGGER_TO_PLAY_LATENCY_LIMIT_S,
        "estimated_context_limits_exceeded": (
            route_end_backlog_s > ROUTE_END_AUDIO_BACKLOG_LIMIT_S
            or maximum_trigger_to_play_latency_s > TRIGGER_TO_PLAY_LATENCY_LIMIT_S
        ),
        "metric_status": "authoring_estimate_only_not_a_publication_gate",
    }


def build_artifact(
    *,
    editorial_path: Path = EDITORIAL_PATH,
    dossier_path: Path = DOSSIER_PATH,
    route_evidence_path: Path = ROUTE_EVIDENCE_PATH,
) -> dict[str, Any]:
    editorial = read_json(editorial_path)
    dossier = read_json(dossier_path)
    route_evidence = read_json(route_evidence_path)
    dossier_sha = file_sha256(dossier_path)
    if editorial.get("chapter_id") != CHAPTER_ID:
        raise TriggerPreflightError("Editorial packet is not Roaring Fork")
    if editorial.get("dossier_sha256") != dossier_sha:
        raise TriggerPreflightError("Editorial packet is not bound to this source dossier")

    variants = route_evidence.get("variants")
    route = next(
        (
            item for item in variants or []
            if item.get("chapter_id") == CHAPTER_ID
            and item.get("variant_id") == VARIANT_ID
            and item.get("id") == ROUTE_ID
        ),
        None,
    )
    if not isinstance(route, dict) or route.get("geometry_ready_for_editorial_cues") is not True:
        raise TriggerPreflightError("Checked Roaring Fork geometry is unavailable")
    geometry = route.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        raise TriggerPreflightError("Checked Roaring Fork geometry is not a LineString")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        raise TriggerPreflightError("Checked Roaring Fork coordinates are unavailable")
    geometry_sha = canonical_sha256(geometry)
    if route.get("geometry_sha256") != geometry_sha:
        raise TriggerPreflightError("Checked Roaring Fork geometry hash does not match")
    cumulative, measured_distance_m = measure_route(coordinates)
    evidence_distance_m = float(route.get("distance_m") or 0)
    if abs(measured_distance_m - evidence_distance_m) > 2.0:
        raise TriggerPreflightError("Measured route distance drifted from checked evidence")

    editorial_entries = {item.get("id"): item for item in editorial.get("entries", [])}
    dossier_entries = {
        item.get("id"): item
        for item in dossier.get("entries", [])
        if item.get("chapter_id") == CHAPTER_ID
    }
    expected_ids = {entry_id for entry_id, _anchor, _offset, _class, _limit in PLACEMENTS}
    if set(editorial_entries) != expected_ids or set(dossier_entries) != expected_ids:
        raise TriggerPreflightError("Editorial, dossier, and placement entry sets differ")
    if set(OPENING_AUDIT) != expected_ids:
        raise TriggerPreflightError("Transcript-opening audit does not cover every placement")
    landmarks = {item.get("anchor_id"): item for item in route.get("landmarks", [])}
    narration_rate_wpm = float(editorial.get("narration_rate_wpm") or 0)
    if narration_rate_wpm <= 0:
        raise TriggerPreflightError("Editorial narration rate is unavailable")

    entries: list[dict[str, Any]] = []
    for stable_order, (
        entry_id,
        anchor_id,
        offset_m,
        placement_class,
        maximum_anchor_offset_m,
    ) in enumerate(PLACEMENTS, 1):
        editorial_entry = editorial_entries[entry_id]
        dossier_entry = dossier_entries[entry_id]
        landmark = landmarks.get(anchor_id)
        if not isinstance(landmark, dict) or landmark.get("status") != "on_route":
            raise TriggerPreflightError(f"Unchecked placement anchor: {anchor_id}")
        if dossier_entry.get("route_context") != anchor_id:
            raise TriggerPreflightError(f"Dossier route context drifted for {entry_id}")
        if editorial_entry.get("kind") != dossier_entry.get("kind"):
            raise TriggerPreflightError(f"Editorial kind drifted for {entry_id}")
        transcript = editorial_entry.get("transcript")
        if not isinstance(transcript, str) or not transcript.strip():
            raise TriggerPreflightError(f"Transcript is missing for {entry_id}")
        anchor_progress_m = float(landmark["route_progress_m"])
        progress_m = anchor_progress_m + offset_m
        if progress_m <= 0 or progress_m >= measured_distance_m:
            raise TriggerPreflightError(f"Placement is outside the checked route: {entry_id}")
        if abs(offset_m) > maximum_anchor_offset_m:
            raise TriggerPreflightError(f"Placement exceeds its reviewed landmark window: {entry_id}")
        coordinate = interpolate(coordinates, cumulative, progress_m)
        transcript_word_count = len(transcript.replace("\u2014", " ").split())
        opening_audit = OPENING_AUDIT[entry_id]
        placement_status = (
            "blocked_missing_exact_landmark"
            if opening_audit["anchor_evidence"] == "proxy_route_context_only"
            else "proposed_authoring_only"
        )
        entries.append(
            {
                "id": entry_id,
                "kind": editorial_entry["kind"],
                "stable_order": stable_order,
                "editorial_sequence": editorial_entry["sequence"],
                "title": editorial_entry["title"],
                "route_context": dossier_entry["route_context"],
                "placement_class": placement_class,
                "placement_status": placement_status,
                "opening_audit": opening_audit,
                "anchor": {
                    "id": anchor_id,
                    "checked_progress_m": round(anchor_progress_m, 1),
                    "authoring_offset_m": round(offset_m, 1),
                    "maximum_reviewed_offset_m": round(maximum_anchor_offset_m, 1),
                },
                "projected_coordinate": {
                    "lat": round(coordinate[1], 7),
                    "lng": round(coordinate[0], 7),
                },
                "projected_progress_m": round(progress_m, 1),
                "trigger": {
                    "route_progress_start_m": round(max(0.0, progress_m - WINDOW_HALF_WIDTH_M), 1),
                    "route_progress_end_m": round(min(measured_distance_m, progress_m + WINDOW_HALF_WIDTH_M), 1),
                    "enter_radius_m": ENTER_RADIUS_M,
                    "exit_radius_m": EXIT_RADIUS_M,
                    "lead_time_s": 0,
                    "approach_bearing_deg": round(local_bearing(coordinates, cumulative, progress_m), 1),
                    "bearing_tolerance_deg": BEARING_TOLERANCE_DEG,
                },
                "transcript_word_count": transcript_word_count,
                "authoring_estimated_duration_s": round(
                    transcript_word_count * 60.0 / narration_rate_wpm, 1
                ),
                "audio_duration_s": None,
                "audio_duration_status": "awaiting_immutable_rendered_asset",
            }
        )
    progresses = [item["projected_progress_m"] for item in entries]
    if progresses != sorted(progresses) or len(progresses) != len(set(progresses)):
        raise TriggerPreflightError("Trigger placements are not strictly ordered")

    scene_entries_by_anchor: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        if entry["placement_class"] == "corridor_context":
            continue
        scene_entries_by_anchor.setdefault(entry["anchor"]["id"], []).append(entry)
    placement_blockers: list[dict[str, Any]] = []
    missing_landmark_entries = [
        entry for entry in entries
        if entry["placement_status"] == "blocked_missing_exact_landmark"
    ]
    if missing_landmark_entries:
        placement_blockers.append(
            {
                "code": "exact_scene_landmark_missing_from_checked_route_evidence",
                "anchor_id": "roaring_fork_entrance",
                "entry_ids": [entry["id"] for entry in missing_landmark_entries],
                "proxy_anchor_id": "roaring_fork_entrance",
                "resolution": "add_checked_ogle_landmark_or_move_entries_to_explicit_stop_mode",
            }
        )
    for anchor_id in sorted(scene_entries_by_anchor):
        scene_entries = scene_entries_by_anchor[anchor_id]
        if len(scene_entries) < 2:
            continue
        span_m = scene_entries[-1]["projected_progress_m"] - scene_entries[0]["projected_progress_m"]
        placement_blockers.append(
            {
                "code": "exact_scene_cluster_requires_real_duration_proof_or_editorial_resolution",
                "anchor_id": anchor_id,
                "entry_ids": [entry["id"] for entry in scene_entries],
                "entry_count": len(scene_entries),
                "trigger_span_m": round(span_m, 1),
                "authoring_estimated_audio_s": round(
                    sum(entry["authoring_estimated_duration_s"] for entry in scene_entries), 1
                ),
                "trigger_span_travel_s_at_15_mph": round(span_m / (15 * 0.44704), 1),
                "resolution": "bind_real_audio_durations_then_consolidate_move_to_stop_mode_or_revalidate",
            }
        )

    fifo_input: list[dict[str, Any]] = []
    for index, entry in enumerate(entries):
        following = entries[index + 1] if index + 1 < len(entries) else None
        gap_m = round(following["projected_progress_m"] - entry["projected_progress_m"], 1) if following else None
        fifo_input.append(
            {
                "id": entry["id"],
                "stable_order": entry["stable_order"],
                "projected_progress_m": entry["projected_progress_m"],
                "trigger_window": {
                    "start_m": entry["trigger"]["route_progress_start_m"],
                    "end_m": entry["trigger"]["route_progress_end_m"],
                },
                "audio_duration_s": None,
                "authoring_estimated_duration_s": entry["authoring_estimated_duration_s"],
                "distance_to_next_trigger_m": gap_m,
                "travel_time_to_next_trigger_s": (
                    {
                        f"{speed}_mph": round(gap_m / (speed * 0.44704), 1)
                        for speed in SPEEDS_MPH
                    }
                    if gap_m is not None else None
                ),
            }
        )

    return {
        "schema_version": 1,
        "kind": "trailhead_original_trigger_placement_preflight",
        "authoring_only": True,
        "publication_status": "blocked_pending_exact_scene_resolution_real_audio_durations_and_fifo_validation",
        "product_id": editorial["product_id"],
        "chapter_id": CHAPTER_ID,
        "variant_id": VARIANT_ID,
        "route_id": ROUTE_ID,
        "input_bindings": {
            "official_route_evidence_path": binding_path(route_evidence_path),
            "official_route_evidence_sha256": file_sha256(route_evidence_path),
            "geometry_sha256": geometry_sha,
            "geometry_hash_basis": "canonical_sorted_compact_geojson",
            "editorial_packet_path": binding_path(editorial_path),
            "editorial_packet_sha256": file_sha256(editorial_path),
            "source_dossier_path": binding_path(dossier_path),
            "source_dossier_sha256": dossier_sha,
        },
        "route": {
            "direction": "one_way",
            "coordinate_count": len(coordinates),
            "evidence_distance_m": round(evidence_distance_m, 1),
            "measured_distance_m": round(measured_distance_m, 1),
            "geometry_ready_for_editorial_cues": True,
            "operational_readiness_separate": True,
        },
        "placement_feasibility": {
            "status": "blocked",
            "all_proposed_offsets_within_reviewed_context_windows": True,
            "all_exact_scene_landmarks_evidence_backed": False,
            "corridor_entries_absorb_only_non_scene_spacing": True,
            "blockers": placement_blockers,
        },
        "runtime_capacity": {
            **runtime_queue_contract(),
            "real_audio_duration_status": "unavailable_until_assets_are_rendered",
            "fifo_validation_status": "blocked_pending_real_audio_durations",
            "authoring_word_counts_are_not_audio_durations": True,
            "gates_weakened": False,
        },
        "fifo_capacity_metrics_v3": {
            "duration_basis": "editorial_word_count_at_declared_narration_rate",
            "narration_rate_wpm": narration_rate_wpm,
            "real_audio_durations_used": False,
            "publication_gate_status": "blocked_pending_real_audio_and_validator_report",
            "scenarios": [
                estimated_fifo_metrics(entries, measured_distance_m, speed)
                for speed in SPEEDS_MPH
            ],
        },
        "entries": entries,
        "fifo_validation_input": fifo_input,
    }


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = serialize(build_artifact())
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Roaring Fork trigger preflight is stale; rebuild it")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
