#!/usr/bin/env python3
"""Build the local, authoring-only Roaring Fork trigger preflight.

Only checked-in official geometry is used. Real rendered audio durations remain
required before the runtime FIFO gate can run or publication can proceed.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
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
CAPACITY_HARD_AUTO_GUARD_S = 30

HARD_AUTO = "hard_auto"
CAPACITY_DEEPER = "capacity_deeper"
STOPPED_DEEPER = "stopped_deeper"
COMPLETION_DEEPER = "completion_deeper"

OGLE_LANDMARK_ID = "noah_bud_ogle_cabin"
OGLE_EXPERIENCE_GROUP_ID = "ogle_prelude"
OGLE_COORDINATES = [-83.489714, 35.682841]
OGLE_NEAREST_ROUTE_COORDINATES = [-83.481398, 35.678543]
OGLE_ROUTE_LATERAL_DISTANCE_M = 889.5
OGLE_APPROACH_LATERAL_DISTANCE_M = 33.8
OGLE_PARKING_TO_ROUTE_ENTRANCE_M = 1_647.9
OGLE_SOURCE_RECORD = {
    "id": "nps_grsm_noah_bud_ogle_location_2026",
    "authority": "official",
    "publisher": "National Park Service",
    "role": "landmark",
    "title": "2026 Superintendent's Compendium",
    "url": "https://home.nps.gov/grsm/learn/management/compendium.htm",
    "reviewed_at": "2026-08-08",
    "rights_status": "reference_only",
    "coordinates": OGLE_COORDINATES,
    "source_accuracy_m": None,
    "accuracy_note": "NPS publishes the coordinate but does not state survey accuracy.",
}


@dataclass(frozen=True)
class PlacementSpec:
    entry_id: str
    dossier_route_context: str
    anchor_id: str
    offset_m: float | None
    placement_class: str
    maximum_anchor_offset_m: float | None
    delivery_mode: str
    fallback_mode: str | None = None
    experience_group_id: str | None = None
    availability: str | None = None

# One reviewed delivery classification covers every entry exactly once. The
# Ogle cue and story remain separate immutable scripts but form one user-facing
# stopped prelude before the accepted motor-trail route.
PLACEMENTS: tuple[PlacementSpec, ...] = (
    PlacementSpec(
        "rf_cue_02", "roaring_fork_entrance", OGLE_LANDMARK_ID, None,
        "off_route_stopped_vehicle_prelude", None, STOPPED_DEEPER,
        experience_group_id=OGLE_EXPERIENCE_GROUP_ID,
        availability="before_route_user_confirmed_parked",
    ),
    PlacementSpec(
        "rf_story_03", "roaring_fork_entrance", OGLE_LANDMARK_ID, None,
        "off_route_stopped_vehicle_prelude", None, STOPPED_DEEPER,
        experience_group_id=OGLE_EXPERIENCE_GROUP_ID,
        availability="before_route_user_confirmed_parked",
    ),
    PlacementSpec(
        "rf_cue_01", "roaring_fork_entrance", "roaring_fork_entrance", 40.0,
        "route_boundary_scene", 150.0, HARD_AUTO,
    ),
    PlacementSpec(
        "rf_story_01", "roaring_fork_entrance", "roaring_fork_entrance", 110.0,
        "route_boundary_scene", 200.0, CAPACITY_DEEPER,
        fallback_mode=COMPLETION_DEEPER,
    ),
    PlacementSpec(
        "rf_cue_04", "grotto_falls_parking", "grotto_falls_parking", -100.0,
        "exact_landmark_scene", 200.0, HARD_AUTO,
    ),
    PlacementSpec(
        "rf_cue_03", "roaring_fork_upper", "roaring_fork_upper", -800.0,
        "corridor_context", 1_000.0, HARD_AUTO,
    ),
    PlacementSpec(
        "rf_story_02", "roaring_fork_upper", "roaring_fork_upper", -350.0,
        "corridor_context", 1_000.0, CAPACITY_DEEPER,
        fallback_mode=COMPLETION_DEEPER,
    ),
    PlacementSpec(
        "rf_story_04", "roaring_fork_upper", "roaring_fork_upper", 400.0,
        "corridor_context", 800.0, CAPACITY_DEEPER,
        fallback_mode=COMPLETION_DEEPER,
    ),
    PlacementSpec(
        "rf_story_05", "roaring_fork_mid", "roaring_fork_mid", 250.0,
        "corridor_context", 800.0, CAPACITY_DEEPER,
        fallback_mode=COMPLETION_DEEPER,
    ),
    PlacementSpec(
        "rf_cue_05", "thousand_drips", "thousand_drips", -220.0,
        "exact_landmark_scene", 250.0, HARD_AUTO,
    ),
    PlacementSpec(
        "rf_story_06", "thousand_drips", "thousand_drips", -60.0,
        "exact_landmark_scene", 250.0, STOPPED_DEEPER,
        experience_group_id="thousand_drips_deeper_story",
        availability="at_landmark_user_confirmed_parked",
    ),
    PlacementSpec(
        "rf_story_07", "roaring_fork_exit", "roaring_fork_exit", -300.0,
        "route_boundary_scene", 400.0, COMPLETION_DEEPER,
        availability="after_route_completion",
    ),
    PlacementSpec(
        "rf_cue_06", "roaring_fork_exit", "roaring_fork_exit", 80.0,
        "route_boundary_scene", 150.0, HARD_AUTO,
    ),
)

# Transcript-opening audit. Ogle is now bound to an official off-route point
# and deliberately remains outside moving-route trigger evaluation.
OPENING_AUDIT: dict[str, dict[str, str]] = {
    "rf_cue_01": {"scope": "exact_scene", "binding": "motor_trail_entrance", "anchor_evidence": "direct_official_landmark"},
    "rf_story_01": {"scope": "exact_scene", "binding": "motor_trail_entrance", "anchor_evidence": "direct_official_landmark"},
    "rf_cue_02": {"scope": "exact_scene", "binding": "ogle_farmstead", "anchor_evidence": "official_nps_off_route_coordinate"},
    "rf_story_03": {"scope": "exact_scene", "binding": "ogle_farmstead", "anchor_evidence": "official_nps_off_route_coordinate"},
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


def estimated_delivery_metrics(
    entries: list[dict[str, Any]], route_distance_m: float, speed_mph: int
) -> dict[str, Any]:
    """Model the reviewed scheduler without treating word counts as real audio."""
    metres_per_second = speed_mph * 0.44704
    moving_entries = sorted(
        (
            entry for entry in entries
            if entry["delivery"]["mode"] in {HARD_AUTO, CAPACITY_DEEPER}
        ),
        key=lambda entry: (entry["projected_progress_m"], entry["stable_order"]),
    )
    hard_entries = [
        entry for entry in moving_entries if entry["delivery"]["mode"] == HARD_AUTO
    ]
    playback_free_at_s = 0.0
    active_capacity_finish_s = 0.0
    maximum_pending_depth = 0
    maximum_trigger_to_play_latency_s = 0.0
    admitted_capacity_ids: list[str] = []
    rejected_capacity: list[dict[str, str]] = []
    scheduled: list[dict[str, Any]] = []

    for entry in moving_entries:
        arrival_s = entry["projected_progress_m"] / metres_per_second
        mode = entry["delivery"]["mode"]
        duration_s = entry["authoring_estimated_duration_s"]
        if mode == CAPACITY_DEEPER:
            if active_capacity_finish_s > arrival_s:
                rejected_capacity.append(
                    {"id": entry["id"], "reason": "capacity_story_active"}
                )
                continue
            predicted_start_s = max(arrival_s, playback_free_at_s)
            own_window_end_s = (
                entry["trigger"]["route_progress_end_m"] / metres_per_second
            )
            next_hard = next(
                (
                    hard for hard in hard_entries
                    if hard["projected_progress_m"] > entry["projected_progress_m"]
                ),
                None,
            )
            if predicted_start_s > own_window_end_s:
                rejected_capacity.append(
                    {"id": entry["id"], "reason": "own_context_window_expired"}
                )
                continue
            predicted_finish_s = predicted_start_s + duration_s
            if next_hard is not None:
                latest_finish_s = (
                    next_hard["trigger"]["route_progress_start_m"]
                    / metres_per_second
                    - CAPACITY_HARD_AUTO_GUARD_S
                )
                if predicted_finish_s > latest_finish_s:
                    rejected_capacity.append(
                        {"id": entry["id"], "reason": "next_hard_auto_guard_not_met"}
                    )
                    continue
            elif predicted_finish_s > (
                route_distance_m / metres_per_second
                + ROUTE_END_AUDIO_BACKLOG_LIMIT_S
            ):
                rejected_capacity.append(
                    {"id": entry["id"], "reason": "route_end_backlog_limit"}
                )
                continue
            start_s = predicted_start_s
            finish_s = predicted_finish_s
            admitted_capacity_ids.append(entry["id"])
            active_capacity_finish_s = finish_s
        else:
            start_s = max(arrival_s, playback_free_at_s)
            finish_s = start_s + duration_s

        latency_s = start_s - arrival_s
        maximum_pending_depth = max(maximum_pending_depth, int(latency_s > 0))
        maximum_trigger_to_play_latency_s = max(
            maximum_trigger_to_play_latency_s, latency_s
        )
        playback_free_at_s = finish_s
        scheduled.append(
            {
                "id": entry["id"],
                "mode": mode,
                "estimated_arrival_s": round(arrival_s, 1),
                "estimated_start_s": round(start_s, 1),
                "estimated_finish_s": round(finish_s, 1),
            }
        )

    route_travel_s = route_distance_m / metres_per_second
    route_end_backlog_s = max(0.0, playback_free_at_s - route_travel_s)
    return {
        "speed_mph": speed_mph,
        "route_travel_s": round(route_travel_s, 1),
        "admitted_capacity_ids": admitted_capacity_ids,
        "rejected_capacity": rejected_capacity,
        "estimated_admitted_audio_s": round(
            sum(
                entry["authoring_estimated_duration_s"]
                for entry in entries
                if entry["delivery"]["mode"] == HARD_AUTO
                or entry["id"] in admitted_capacity_ids
            ),
            1,
        ),
        "estimated_maximum_pending_depth": maximum_pending_depth,
        "estimated_audio_tail_after_route_end_s": round(route_end_backlog_s, 1),
        "estimated_maximum_trigger_to_play_latency_s": round(
            maximum_trigger_to_play_latency_s, 1
        ),
        "route_end_audio_backlog_limit_s": ROUTE_END_AUDIO_BACKLOG_LIMIT_S,
        "trigger_to_play_latency_limit_s": TRIGGER_TO_PLAY_LATENCY_LIMIT_S,
        "capacity_hard_auto_guard_s": CAPACITY_HARD_AUTO_GUARD_S,
        "estimated_context_limits_exceeded": (
            route_end_backlog_s > ROUTE_END_AUDIO_BACKLOG_LIMIT_S
            or maximum_trigger_to_play_latency_s > TRIGGER_TO_PLAY_LATENCY_LIMIT_S
        ),
        "scheduled": scheduled,
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
    expected_ids = {spec.entry_id for spec in PLACEMENTS}
    if len(expected_ids) != len(PLACEMENTS):
        raise TriggerPreflightError("A placement entry is classified more than once")
    if set(editorial_entries) != expected_ids or set(dossier_entries) != expected_ids:
        raise TriggerPreflightError("Editorial, dossier, and placement entry sets differ")
    if set(OPENING_AUDIT) != expected_ids:
        raise TriggerPreflightError("Transcript-opening audit does not cover every placement")
    landmarks = {item.get("anchor_id"): item for item in route.get("landmarks", [])}
    narration_rate_wpm = float(editorial.get("narration_rate_wpm") or 0)
    if narration_rate_wpm <= 0:
        raise TriggerPreflightError("Editorial narration rate is unavailable")
    ogle_source_record_sha256 = canonical_sha256(OGLE_SOURCE_RECORD)

    entries: list[dict[str, Any]] = []
    for stable_order, spec in enumerate(PLACEMENTS, 1):
        editorial_entry = editorial_entries[spec.entry_id]
        dossier_entry = dossier_entries[spec.entry_id]
        if dossier_entry.get("route_context") != spec.dossier_route_context:
            raise TriggerPreflightError(
                f"Dossier route context drifted for {spec.entry_id}"
            )
        if editorial_entry.get("kind") != dossier_entry.get("kind"):
            raise TriggerPreflightError(f"Editorial kind drifted for {spec.entry_id}")
        transcript = editorial_entry.get("transcript")
        if not isinstance(transcript, str) or not transcript.strip():
            raise TriggerPreflightError(f"Transcript is missing for {spec.entry_id}")
        transcript_word_count = len(transcript.replace("\u2014", " ").split())

        if spec.anchor_id == OGLE_LANDMARK_ID:
            coordinate = OGLE_COORDINATES
            progress_m: float | None = None
            anchor = {
                "id": OGLE_LANDMARK_ID,
                "binding_status": "off_route_before_start",
                "checked_progress_m": None,
                "authoring_offset_m": None,
                "maximum_reviewed_offset_m": None,
                "official_coordinate": {
                    "lat": OGLE_COORDINATES[1],
                    "lng": OGLE_COORDINATES[0],
                },
                "official_source_id": OGLE_SOURCE_RECORD["id"],
                "official_source_record_sha256": ogle_source_record_sha256,
                "nearest_route_progress_m": 0.0,
                "nearest_route_coordinate": {
                    "lat": OGLE_NEAREST_ROUTE_COORDINATES[1],
                    "lng": OGLE_NEAREST_ROUTE_COORDINATES[0],
                },
                "lateral_distance_to_route_m": OGLE_ROUTE_LATERAL_DISTANCE_M,
            }
            placement_status = "resolved_off_route_stopped_vehicle"
        else:
            landmark = landmarks.get(spec.anchor_id)
            if not isinstance(landmark, dict) or landmark.get("status") != "on_route":
                raise TriggerPreflightError(f"Unchecked placement anchor: {spec.anchor_id}")
            if spec.offset_m is None or spec.maximum_anchor_offset_m is None:
                raise TriggerPreflightError(
                    f"On-route placement lacks an offset: {spec.entry_id}"
                )
            if abs(spec.offset_m) > spec.maximum_anchor_offset_m:
                raise TriggerPreflightError(
                    f"Placement exceeds its reviewed landmark window: {spec.entry_id}"
                )
            anchor_progress_m = float(landmark["route_progress_m"])
            progress_m = anchor_progress_m + spec.offset_m
            if progress_m <= 0 or progress_m >= measured_distance_m:
                raise TriggerPreflightError(
                    f"Placement is outside the checked route: {spec.entry_id}"
                )
            coordinate = interpolate(coordinates, cumulative, progress_m)
            anchor = {
                "id": spec.anchor_id,
                "binding_status": "checked_on_route",
                "checked_progress_m": round(anchor_progress_m, 1),
                "authoring_offset_m": round(spec.offset_m, 1),
                "maximum_reviewed_offset_m": round(
                    spec.maximum_anchor_offset_m, 1
                ),
            }
            placement_status = "proposed_authoring_only"

        delivery: dict[str, Any] = {"mode": spec.delivery_mode}
        if spec.delivery_mode == HARD_AUTO:
            delivery.update(
                {
                    "priority": "must_play",
                    "queue_policy": "durable_fifo_among_hard_auto",
                    "optional_content_may_delay": False,
                }
            )
        elif spec.delivery_mode == CAPACITY_DEEPER:
            delivery.update(
                {
                    "fallback_mode": spec.fallback_mode,
                    "admission_policy_id": "capacity_before_next_hard_v1",
                    "may_wait_for_active_hard_auto": True,
                    "may_queue_behind_capacity": False,
                    "guard_before_next_hard_auto_window_s": CAPACITY_HARD_AUTO_GUARD_S,
                }
            )
        elif spec.delivery_mode == STOPPED_DEEPER:
            delivery.update(
                {
                    "experience_group_id": spec.experience_group_id,
                    "availability": spec.availability,
                    "requires_user_confirmed_parked": True,
                    "parking_availability": "not_checked",
                    "parking_promise": False,
                    "motion_inference_allowed": False,
                }
            )
        elif spec.delivery_mode == COMPLETION_DEEPER:
            delivery.update(
                {
                    "availability": spec.availability,
                    "requires_route_completion": True,
                }
            )
        else:
            raise TriggerPreflightError(
                f"Unknown delivery mode for {spec.entry_id}: {spec.delivery_mode}"
            )

        entry: dict[str, Any] = {
            "id": spec.entry_id,
            "kind": editorial_entry["kind"],
            "stable_order": stable_order,
            "editorial_sequence": editorial_entry["sequence"],
            "title": editorial_entry["title"],
            "route_context": dossier_entry["route_context"],
            "placement_class": spec.placement_class,
            "placement_status": placement_status,
            "opening_audit": OPENING_AUDIT[spec.entry_id],
            "delivery": delivery,
            "anchor": anchor,
            "projected_coordinate": {
                "lat": round(coordinate[1], 7),
                "lng": round(coordinate[0], 7),
            },
            "projected_progress_m": (
                round(progress_m, 1) if progress_m is not None else None
            ),
            "trigger": None,
            "transcript_word_count": transcript_word_count,
            "authoring_estimated_duration_s": round(
                transcript_word_count * 60.0 / narration_rate_wpm, 1
            ),
            "audio_duration_s": None,
            "audio_duration_status": "awaiting_immutable_rendered_asset",
        }
        if spec.delivery_mode in {HARD_AUTO, CAPACITY_DEEPER}:
            if progress_m is None:
                raise TriggerPreflightError(
                    f"Moving delivery cannot use an off-route anchor: {spec.entry_id}"
                )
            entry["trigger"] = {
                "route_progress_start_m": round(
                    max(0.0, progress_m - WINDOW_HALF_WIDTH_M), 1
                ),
                "route_progress_end_m": round(
                    min(measured_distance_m, progress_m + WINDOW_HALF_WIDTH_M), 1
                ),
                "enter_radius_m": ENTER_RADIUS_M,
                "exit_radius_m": EXIT_RADIUS_M,
                "lead_time_s": 0,
                "approach_bearing_deg": round(
                    local_bearing(coordinates, cumulative, progress_m), 1
                ),
                "bearing_tolerance_deg": BEARING_TOLERANCE_DEG,
            }
        entries.append(entry)

    on_route_progresses = [
        item["projected_progress_m"]
        for item in entries
        if item["projected_progress_m"] is not None
    ]
    if (
        on_route_progresses != sorted(on_route_progresses)
        or len(on_route_progresses) != len(set(on_route_progresses))
    ):
        raise TriggerPreflightError("On-route placements are not strictly ordered")

    mode_ids = {
        mode: [
            entry["id"] for entry in entries if entry["delivery"]["mode"] == mode
        ]
        for mode in (HARD_AUTO, CAPACITY_DEEPER, STOPPED_DEEPER, COMPLETION_DEEPER)
    }
    accounted_ids = [entry_id for ids in mode_ids.values() for entry_id in ids]
    if len(accounted_ids) != len(set(accounted_ids)) or set(accounted_ids) != expected_ids:
        raise TriggerPreflightError("Delivery modes do not account for every entry exactly once")

    hard_entries = [
        entry for entry in entries if entry["delivery"]["mode"] == HARD_AUTO
    ]
    capacity_entries = [
        entry for entry in entries if entry["delivery"]["mode"] == CAPACITY_DEEPER
    ]

    def moving_input(entry: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": entry["id"],
            "stable_order": entry["stable_order"],
            "projected_progress_m": entry["projected_progress_m"],
            "trigger_window": {
                "start_m": entry["trigger"]["route_progress_start_m"],
                "end_m": entry["trigger"]["route_progress_end_m"],
            },
            "audio_duration_s": None,
            "authoring_estimated_duration_s": entry["authoring_estimated_duration_s"],
        }

    hard_auto_fifo_input = [moving_input(entry) for entry in hard_entries]
    capacity_admission_input: list[dict[str, Any]] = []
    for entry in capacity_entries:
        next_hard = next(
            (
                hard for hard in hard_entries
                if hard["projected_progress_m"] > entry["projected_progress_m"]
            ),
            None,
        )
        capacity_admission_input.append(
            {
                **moving_input(entry),
                "fallback_mode": COMPLETION_DEEPER,
                "next_hard_auto": (
                    {
                        "id": next_hard["id"],
                        "window_start_m": next_hard["trigger"][
                            "route_progress_start_m"
                        ],
                    }
                    if next_hard is not None
                    else None
                ),
                "admission_rule": {
                    "start_must_remain_inside_own_window": True,
                    "finish_guard_before_next_hard_window_s": CAPACITY_HARD_AUTO_GUARD_S,
                    "may_wait_for_active_hard_auto": True,
                    "may_queue_behind_capacity": False,
                    "duration_basis_required_for_publication": "immutable_audio_asset",
                },
            }
        )

    non_moving_delivery_input = [
        {
            "id": entry["id"],
            "stable_order": entry["stable_order"],
            "mode": entry["delivery"]["mode"],
            "experience_group_id": entry["delivery"].get("experience_group_id"),
            "availability": entry["delivery"].get("availability"),
            "requires_user_confirmed_parked": entry["delivery"].get(
                "requires_user_confirmed_parked", False
            ),
            "parking_availability": entry["delivery"].get("parking_availability"),
            "audio_duration_s": None,
            "authoring_estimated_duration_s": entry["authoring_estimated_duration_s"],
        }
        for entry in entries
        if entry["delivery"]["mode"] in {STOPPED_DEEPER, COMPLETION_DEEPER}
    ]

    return {
        "schema_version": 2,
        "kind": "trailhead_original_trigger_placement_preflight",
        "authoring_only": True,
        "publication_status": "blocked_pending_consumer_delivery_runtime_real_audio_durations_and_fifo_validation",
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
            "ogle_official_source_record_sha256": ogle_source_record_sha256,
            "ogle_source_hash_basis": "canonical_sorted_compact_source_record",
        },
        "route": {
            "direction": "one_way",
            "coordinate_count": len(coordinates),
            "evidence_distance_m": round(evidence_distance_m, 1),
            "measured_distance_m": round(measured_distance_m, 1),
            "geometry_ready_for_editorial_cues": True,
            "operational_readiness_separate": True,
        },
        "landmark_evidence": {
            OGLE_LANDMARK_ID: {
                "source_record": OGLE_SOURCE_RECORD,
                "source_record_sha256": ogle_source_record_sha256,
                "source_hash_basis": "canonical_sorted_compact_source_record",
                "binding_status": "off_route_before_start",
                "route_binding": {
                    "nearest_route_progress_m": 0.0,
                    "lateral_distance_m": OGLE_ROUTE_LATERAL_DISTANCE_M,
                    "nearest_route_coordinate": OGLE_NEAREST_ROUTE_COORDINATES,
                },
                "approach_road_binding": {
                    "geometry_id": "5d3060eb-5127-44ca-9df2-e2462b07124c",
                    "projected_coordinate": [-83.4893771, 35.6829739],
                    "lateral_distance_m": OGLE_APPROACH_LATERAL_DISTANCE_M,
                },
                "parking_reference": {
                    "geometry_id": "3a785367-ca9b-4451-b9f1-10cabf58b624",
                    "feature_id": "578bbb63-1274-4d28-9839-c4285c03004c",
                    "distance_to_route_entrance_m": OGLE_PARKING_TO_ROUTE_ENTRANCE_M,
                    "parking_availability": "not_checked",
                    "parking_promise": False,
                },
            }
        },
        "placement_feasibility": {
            "status": "authoring_design_resolved_runtime_blocked",
            "all_proposed_offsets_within_reviewed_context_windows": True,
            "all_exact_scene_landmarks_evidence_backed": True,
            "all_entries_classified_exactly_once": True,
            "corridor_entries_absorb_only_non_scene_spacing": True,
            "blockers": [
                {
                    "code": "consumer_delivery_runtime_missing",
                    "resolution": "implement_and_capability_gate_schema_v2_delivery_modes",
                },
                {
                    "code": "immutable_audio_durations_missing",
                    "resolution": "bind_rendered_asset_durations_and_run_fifo_publication_suite",
                },
            ],
        },
        "delivery_summary": {
            "entry_count": len(entries),
            "accounted_exactly_once": True,
            "counts_by_mode": {mode: len(ids) for mode, ids in mode_ids.items()},
            "entry_ids_by_mode": mode_ids,
            "ogle_prelude_entry_ids": ["rf_cue_02", "rf_story_03"],
            "ogle_prelude_user_facing_entry_count": 1,
        },
        "runtime_capacity": {
            **runtime_queue_contract(),
            "delivery_runtime_status": "blocked_missing_consumer_delivery_runtime",
            "consumer_delivery_modes_supported": False,
            "required_consumer_capabilities": [
                "hard_auto_priority_over_optional",
                "capacity_admission_with_next_hard_window_guard",
                "stopped_deeper_explicit_user_selection",
                "completion_deeper_library",
            ],
            "capacity_hard_auto_guard_s": CAPACITY_HARD_AUTO_GUARD_S,
            "real_audio_duration_status": "unavailable_until_assets_are_rendered",
            "fifo_validation_status": "blocked_pending_consumer_runtime_and_real_audio_durations",
            "authoring_word_counts_are_not_audio_durations": True,
            "gates_weakened": False,
        },
        "delivery_capacity_metrics_v1": {
            "duration_basis": "editorial_word_count_at_declared_narration_rate",
            "narration_rate_wpm": narration_rate_wpm,
            "real_audio_durations_used": False,
            "publication_gate_status": "blocked_pending_consumer_runtime_real_audio_and_validator_report",
            "scenarios": [
                estimated_delivery_metrics(entries, measured_distance_m, speed)
                for speed in SPEEDS_MPH
            ],
        },
        "entries": entries,
        "hard_auto_fifo_input": hard_auto_fifo_input,
        "capacity_admission_input": capacity_admission_input,
        "non_moving_delivery_input": non_moving_delivery_input,
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
