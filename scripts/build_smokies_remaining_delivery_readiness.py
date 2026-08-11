#!/usr/bin/env python3
"""Build five checked delivery/readiness and five validation-only target records.

Only exact checked-in review, approval, narration-lock, and official-route
evidence is consumed.  The builder is network-free and does not claim that
real-audio timing validation or publication has passed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"
ROUTES = Path("originals/smokies/official_route_evidence_v1.json")
ROUTE_SPECS = Path("originals/smokies/route_variants_v1.json")
DOSSIERS = Path("originals/smokies/source_dossiers_v1.json")
CHECKPOINT2 = Path("originals/smokies/checkpoint2_owner_approval_v1.json")
FOOTHILLS_APPROVAL = Path("originals/smokies/foothills_parkway_approval_v1.json")
BUILDER = Path("scripts/build_smokies_remaining_delivery_readiness.py")
GATES = {
    "route_end_tail_limit_s": 240,
    "trigger_to_play_latency_limit_s": 180,
    "capacity_guard_s": 30,
    "speed_fixtures_mph": [15, 36, 65, 75],
}
COMMON_SOURCES = (
    Path("db/original_manifest_v3.py"),
    Path("db/originals_validation.py"),
    Path("db/originals_remaining_validation.py"),
    Path("mobile/lib/originals/manifestV3.ts"),
    Path("mobile/lib/originals/longFormScheduler.ts"),
    Path("mobile/lib/originals/session.ts"),
    Path("mobile/lib/originals/triggerEngine.ts"),
    Path("mobile/scripts/validate-original-long-form.ts"),
    BUILDER, ROUTES, ROUTE_SPECS, DOSSIERS, CHECKPOINT2,
)
RUNTIME_GEOMETRY_SHA256 = {
    "mountain_crossing_tn_to_nc": "2bdc7c71d56fd5d5cca177da41416540b208278ed232921eabf27ad501be5fb7",
    "mountain_crossing_nc_to_tn": "fce92ad2377fa6eafbc7779d952f3825895ed8ff365094a6ea32e6c83ce4d141",
    "little_river_cades_cove_loop": "92478b7b5440491b4c30161a80d13571a79cb3d0fbd64a52b6137a7241679a83",
    "foothills_parkway_west_to_east": "d23c9d94eae1740162877a43c8c594ec0f58c0f1a2695fba96dac61b852f32c3",
    "foothills_parkway_east_to_west": "7304463b5d1efe3a49f7f29a8343d2015716fc56f1931c5b53b6d93103b97acf",
}
PINNED = {
    str(ROUTES): "d946ffaf8f21ad97399b6dedfb5cbe9483fce0787653b389d7075d933f398c60",
    str(ROUTE_SPECS): "49d55fa8819822b18af54983ea11893a661689102c14532a88ebacf2ec587f24",
    str(DOSSIERS): "8eb22ca5110f0f9a4287b8f184624348c2a2ca2dbc36e27ef59fc022057ce18f",
    str(CHECKPOINT2): "3cc18dad4d1b6a80f2259e58cbe50fba3804096d0c00437eca9103e626078d5c",
    str(FOOTHILLS_APPROVAL): "a301c702155512c66df60e819274271fc9a6001b398266be5d9a6329a82592bb",
    "originals/smokies/remaining_chapters_review_packet_v1.json": "3ef71377c9e347cd53335cbf487d039ff973b8c28f9628b622fcee74c714b015",
    "originals/smokies/foothills_parkway_review_packet_v1.json": "7a3217f0dc11c503f43ca12d82b339d5537de6365441f607eacfd7c3945ea926",
    "originals/smokies/elevenlabs_james_mountain_crossing_lock_v1.json": "561a8a8bf62f534d485df0ebf523d13a9defd962af136240fd46e1ca5aacec25",
    "originals/smokies/elevenlabs_james_cades_cove_lock_v1.json": "6c6fecdaa85d91f4e29cd08ea9c46f20d404dba8ed72962390b8d8d8dc5b6a04",
    "originals/smokies/elevenlabs_james_foothills_parkway_lock_v1.json": "eac2d636c4c26fd55fbc4ebe7b7be25882ffd51e6064703924d96d89fa71c119",
    "originals/smokies/editorial_mountain_crossing_v1.json": "4a7e0acf04075da914ef486b86210167ff4220b8ea901083bd4df75d8fe21c58",
    "originals/smokies/editorial_cades_cove_v1.json": "1fedc6db4944bab671d7cfa0bacd2dda9670133d4165e27b3fe7b63ef8728845",
    "originals/smokies/editorial_scripts_v1.json": "28627001d9b3bbd129e812721064e1a0c8fc2122ec9371afa91657026b76d81e",
}


def spec(chapter: str, variant: str, slug: str, route_id: str, geometry: str,
         points: int, distance: float, entries: int, cues: int, replacements: int,
         review: str, editorial: str, lock: str, foothills: bool = False) -> dict:
    return {
        "chapter_id": chapter, "variant_id": variant, "slug": slug,
        "route_spec_id": route_id, "official_geometry_sha256": geometry,
        "geometry_sha256": RUNTIME_GEOMETRY_SHA256[slug],
        "coordinate_count": points, "distance_m": distance,
        "entry_count": entries, "hard_cue_count": cues,
        "directional_replacement_count": replacements,
        "review_path": Path(review), "editorial_path": Path(editorial),
        "lock_path": Path(lock),
        "approval_paths": (FOOTHILLS_APPROVAL, CHECKPOINT2) if foothills else (CHECKPOINT2,),
        "readiness_path": Path(f"originals/smokies/{slug}_delivery_readiness_v1.json"),
        "target_path": Path(f"originals/smokies/{slug}_route_network_validation_target_v1.json"),
        "evidence_id": f"smokies_{slug}_delivery_20260811_v1",
        "target_evidence_id": f"smokies_{slug}_route_network_target_20260811_v1",
    }


VARIANTS = (
    spec("mountain_crossing", "tn_to_nc", "mountain_crossing_tn_to_nc",
         "mountain-crossing-tn-to-nc",
         "4a003a6bde4d0c9623a71875bb5f369050f11202f58cd5c02d9451377ad980ab",
         6596, 73505.4, 28, 10, 0,
         "originals/smokies/remaining_chapters_review_packet_v1.json",
         "originals/smokies/editorial_mountain_crossing_v1.json",
         "originals/smokies/elevenlabs_james_mountain_crossing_lock_v1.json"),
    spec("mountain_crossing", "nc_to_tn", "mountain_crossing_nc_to_tn",
         "mountain-crossing-nc-to-tn",
         "2da7812bfd8f129492420cf6cfeca2d990950a0eb057f98c586bbcbd4aaad5b3",
         6571, 73230.7, 28, 10, 5,
         "originals/smokies/remaining_chapters_review_packet_v1.json",
         "originals/smokies/editorial_mountain_crossing_v1.json",
         "originals/smokies/elevenlabs_james_mountain_crossing_lock_v1.json"),
    spec("little_river_cades_cove", "sugarlands_to_cades_cove_loop",
         "little_river_cades_cove_loop", "little-river-cades-cove-loop",
         "9f77ba8f704e82b3fb43e81f330a20771e2d8d87b44fe1fae29329cf082255c8",
         4800, 56937.5, 23, 9, 0,
         "originals/smokies/remaining_chapters_review_packet_v1.json",
         "originals/smokies/editorial_cades_cove_v1.json",
         "originals/smokies/elevenlabs_james_cades_cove_lock_v1.json"),
    spec("foothills_parkway", "west_to_east", "foothills_parkway_west_to_east",
         "foothills-parkway-west-to-east",
         "3b86e6b62db0be72edd15557d3f503bfe79baa869877044a7deb4f4b487f547d",
         7948, 50816.7, 13, 7, 0,
         "originals/smokies/foothills_parkway_review_packet_v1.json",
         "originals/smokies/editorial_scripts_v1.json",
         "originals/smokies/elevenlabs_james_foothills_parkway_lock_v1.json", True),
    spec("foothills_parkway", "east_to_west", "foothills_parkway_east_to_west",
         "foothills-parkway-east-to-west",
         "58a8f0322c03136efd13f0bbcf3de00aab7b270fe37211efac1c07850ea6a358",
         7948, 50816.7, 13, 7, 3,
         "originals/smokies/foothills_parkway_review_packet_v1.json",
         "originals/smokies/editorial_scripts_v1.json",
         "originals/smokies/elevenlabs_james_foothills_parkway_lock_v1.json", True),
)
EARTH_RADIUS_M = 6_371_008.8


class BuildError(ValueError):
    pass


def read_json(relative: Path) -> dict[str, Any]:
    try:
        value = json.loads((ROOT / relative).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BuildError(f"Invalid JSON source: {relative}") from exc
    if not isinstance(value, dict):
        raise BuildError(f"JSON source must be an object: {relative}")
    return value


def file_sha(relative: Path) -> str:
    path = ROOT / relative
    if not path.is_file():
        raise BuildError(f"Missing source: {relative}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_sha(value: Any) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, float) and item.is_integer(): return int(item)
        if isinstance(item, list): return [normalize(value) for value in item]
        if isinstance(item, dict): return {key: normalize(value) for key, value in sorted(item.items())}
        return item
    raw = json.dumps(normalize(value), separators=(",", ":"), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def geometry_sha(coordinates: list[list[float]]) -> str:
    text = ";".join(f"{float(p[0]):.7f},{float(p[1]):.7f}" for p in coordinates)
    return hashlib.sha256(text.encode("ascii")).hexdigest()


def haversine(first: list[float], second: list[float]) -> float:
    lon1, lat1 = map(math.radians, first); lon2, lat2 = map(math.radians, second)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(value)))


def measure(coordinates: list[list[float]]) -> list[float]:
    cumulative = [0.0]
    for first, second in zip(coordinates, coordinates[1:]):
        distance = haversine(first, second)
        if not math.isfinite(distance) or distance <= 0:
            raise BuildError("Official route contains an invalid segment")
        cumulative.append(cumulative[-1] + distance)
    return cumulative


def interpolate(coordinates: list[list[float]], cumulative: list[float], progress: float) -> list[float]:
    bounded = min(max(progress, 0.0), cumulative[-1]); low, high = 0, len(cumulative) - 1
    while low < high:
        middle = (low + high) // 2
        if cumulative[middle] < bounded: low = middle + 1
        else: high = middle
    index = max(1, low); start = cumulative[index - 1]
    fraction = (bounded - start) / (cumulative[index] - start)
    first, second = coordinates[index - 1], coordinates[index]
    return [first[0] + (second[0] - first[0]) * fraction,
            first[1] + (second[1] - first[1]) * fraction]


def bearing(first: list[float], second: list[float]) -> float:
    lon1, lat1 = map(math.radians, first); lon2, lat2 = map(math.radians, second)
    dlon = lon2 - lon1; y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def trigger(coordinates: list[list[float]], cumulative: list[float], progress: float) -> tuple[dict, dict]:
    center = min(max(progress, 90.0), cumulative[-1] - 90.0)
    point = interpolate(coordinates, cumulative, center)
    angle = bearing(interpolate(coordinates, cumulative, center - 15),
                    interpolate(coordinates, cumulative, center + 15))
    return ({"lat": round(point[1], 7), "lng": round(point[0], 7)}, {
        "enter_radius_m": 160.0, "exit_radius_m": 260.0, "lead_time_s": 0.0,
        "route_progress_start_m": round(center - 90, 1),
        "route_progress_end_m": round(center + 90, 1),
        "approach_bearing_deg": round(angle, 1), "bearing_tolerance_deg": 70.0,
    })


def source_paths(item: dict) -> tuple[Path, ...]:
    paths = set(COMMON_SOURCES) | {item["review_path"], item["editorial_path"], item["lock_path"]}
    paths.update(item["approval_paths"])
    return tuple(sorted(paths, key=lambda p: p.as_posix()))


def chapter_review(item: dict) -> dict:
    review = read_json(item["review_path"])
    matches = [row for row in review.get("chapter_reviews") or [review]
               if isinstance(row, dict) and row.get("chapter_id") == item["chapter_id"]]
    if review.get("product_id") != PRODUCT_ID or len(matches) != 1:
        raise BuildError("Chapter review identity drifted")
    return matches[0]


def route_sources(item: dict) -> tuple[dict, dict]:
    routes, specs = read_json(ROUTES), read_json(ROUTE_SPECS)
    route = [row for row in routes.get("variants", []) if isinstance(row, dict)
             and (row.get("chapter_id"), row.get("variant_id")) == (item["chapter_id"], item["variant_id"])]
    authored = [row for row in specs.get("variants", []) if isinstance(row, dict)
                and (row.get("chapter_id"), row.get("variant_id")) == (item["chapter_id"], item["variant_id"])]
    if len(route) != 1 or len(authored) != 1: raise BuildError("Route selection is ambiguous")
    route, authored = route[0], authored[0]; coordinates = (route.get("geometry") or {}).get("coordinates")
    expected_anchors = [row.get("id") for row in authored.get("anchors", [])]
    actual_anchors = [row.get("anchor_id") for row in route.get("landmarks", [])]
    if (authored.get("id") != item["route_spec_id"] or route.get("status") != "official_geometry_candidate"
            or route.get("geometry_ready_for_editorial_cues") is not True
            or not isinstance(coordinates, list) or len(coordinates) != item["coordinate_count"]
            or geometry_sha(coordinates) != item["geometry_sha256"]
            or route.get("geometry_sha256") != item["official_geometry_sha256"]
            or float(route.get("distance_m")) != item["distance_m"]
            or expected_anchors != actual_anchors):
        raise BuildError("Official route facts drifted")
    return route, authored


def approvals(item: dict) -> dict[str, dict]:
    result = {}
    for path in item["approval_paths"]:
        source = read_json(path)
        rows = source.get("approved_scripts") if path == FOOTHILLS_APPROVAL else source.get("approved_remaining_scripts")
        if not isinstance(rows, list): raise BuildError("Approved script set is invalid")
        for row in rows:
            if (isinstance(row, dict) and row.get("chapter_id", item["chapter_id"]) == item["chapter_id"]
                    and row.get("exact_transcript_user_approved") is True):
                result[str(row.get("id") or "")] = row
    return result


def effective_requests(item: dict, entries: list[dict]) -> list[dict]:
    lock, approved = read_json(item["lock_path"]), approvals(item)
    if lock.get("chapter_id") != item["chapter_id"] or not isinstance(lock.get("requests"), list):
        raise BuildError("Narration lock identity drifted")
    result = []
    for entry in entries:
        entry_id = str(entry.get("id") or "")
        matches = [row for row in lock["requests"] if isinstance(row, dict)
                   and row.get("entry_id") == entry_id
                   and item["variant_id"] in (row.get("effective_variant_ids") or [])]
        if len(matches) != 1: raise BuildError(f"Effective request is ambiguous: {entry_id}")
        row, accepted = matches[0], approved.get(entry_id); transcript = str(row.get("raw_transcript_sha256") or "")
        hashes = {str((accepted or {}).get("transcript_sha256") or "")}
        hashes |= {str(x.get("transcript_sha256") or "") for x in (accepted or {}).get("direction_overrides", [])
                   if isinstance(x, dict) and x.get("variant_id") == item["variant_id"]}
        if accepted is None or transcript not in hashes:
            raise BuildError(f"Effective request lacks exact approval: {entry_id}")
        result.append({"entry_id": entry_id, "provider_request_id": row.get("provider_request_id"),
                       "request_kind": row.get("request_kind"), "transcript_sha256": transcript})
    if sum(row["request_kind"] == "directional_override" for row in result) != item["directional_replacement_count"]:
        raise BuildError("Directional request mapping drifted")
    return sorted(result, key=lambda row: row["entry_id"])


def hard_centers(cues: list[dict], landmarks: dict[str, dict], distance: float) -> dict[str, float]:
    grouped: dict[str, list[dict]] = {}
    for row in cues: grouped.setdefault(str(row["route_context"]), []).append(row)
    result = {}
    for anchor, rows in grouped.items():
        rows.sort(key=lambda row: (int(row.get("sequence") or 0), row["id"]))
        progress = float(landmarks[anchor]["route_progress_m"]); count = len(rows)
        if progress <= 1: centers = [180 + index * 360 for index in range(count)]
        elif distance - progress <= 1: centers = [distance - 180 - (count - index - 1) * 360 for index in range(count)]
        else: centers = [progress - (count - 1) * 180 + index * 360 for index in range(count)]
        for row, center in zip(rows, centers): result[row["id"]] = min(max(center, 100), distance - 100)
    return result


def delivery(item: dict, route: dict, entries: list[dict]) -> tuple[dict, list[dict]]:
    raw_coordinates = route["geometry"]["coordinates"]
    coordinates = [raw_coordinates[0]]
    for point in raw_coordinates[1:]:
        if haversine(coordinates[-1], point) > 0.001:
            coordinates.append(point)
    cumulative = measure(coordinates)
    distance = float(route["distance_m"])
    if abs(cumulative[-1] - distance) > 2: raise BuildError("Measured route distance drifted")
    landmarks = {row["anchor_id"]: row for row in route["landmarks"]}
    cues = [row for row in entries if row.get("kind") == "cue"]
    stories = [row for row in entries if row.get("kind") == "story"]
    if len(cues) != item["hard_cue_count"] or len(entries) != item["entry_count"]:
        raise BuildError("Reviewed entry inventory drifted")
    centers = hard_centers(cues, landmarks, distance)
    anchor_progress = {row["id"]: float(landmarks[row["route_context"]]["route_progress_m"]) for row in cues}
    ordered_cues = sorted(cues, key=lambda row: (centers[row["id"]], row["id"]))
    planned, placements = [], []
    for row in ordered_cues:
        point, window = trigger(coordinates, cumulative, centers[row["id"]])
        planned.append({"id": row["id"], "mode": "hard_auto", "coordinates": point,
                        "trigger": window, "delivery": {"priority": "must_play",
                        "queue_policy": "durable_fifo_among_hard_auto",
                        "optional_content_may_delay": False}, "_progress": centers[row["id"]]})
        placements.append({"entry_id": row["id"], "route_context": row["route_context"], "mode": "hard_auto",
                           "official_anchor_progress_m": round(anchor_progress[row["id"]], 1),
                           "scheduled_progress_m": round(centers[row["id"]], 1), "maximum_anchor_offset_m": 600.0})
    grouped: dict[str, list[dict]] = {}
    for row in stories: grouped.setdefault(str(row["route_context"]), []).append(row)
    for anchor, rows in grouped.items():
        rows.sort(key=lambda row: (int(row.get("sequence") or 0), row["id"])); progress = float(landmarks[anchor]["route_progress_m"])
        local_hard = [centers[row["id"]] for row in cues if row.get("route_context") == anchor]
        later = [row for row in ordered_cues if anchor_progress[row["id"]] > progress + 0.1]
        if not later:
            for row in rows:
                planned.append({"id": row["id"], "mode": "completion_deeper",
                                "delivery": {"availability": "after_route_completion",
                                "requires_route_completion": True}, "_progress": distance + 1})
                placements.append({"entry_id": row["id"], "route_context": anchor, "mode": "completion_deeper",
                                   "official_anchor_progress_m": round(progress, 1), "scheduled_progress_m": None,
                                   "maximum_anchor_offset_m": None})
            continue
        next_hard = later[0]; next_start = centers[next_hard["id"]] - 90
        lower = max(progress + 180, max(local_hard or [progress]) + 240)
        upper = min(progress + 1500, next_start - 240)
        if upper <= lower: lower, upper = progress + 60, next_start - 100
        if upper <= lower: raise BuildError(f"No safe capacity window after {anchor}")
        step = (upper - lower) / max(1, len(rows))
        for index, row in enumerate(rows):
            scheduled = lower + step * (index + 0.5); point, window = trigger(coordinates, cumulative, scheduled)
            planned.append({"id": row["id"], "mode": "capacity_deeper", "coordinates": point,
                            "trigger": window, "delivery": {"admission_policy_id": "capacity_before_next_hard_v1",
                            "next_hard_auto_story_id": next_hard["id"], "guard_before_next_hard_auto_window_s": 30,
                            "fallback_mode": "completion_deeper", "may_queue_behind_capacity": False,
                            "may_wait_for_active_hard_auto": True}, "_progress": scheduled})
            placements.append({"entry_id": row["id"], "route_context": anchor, "mode": "capacity_deeper",
                               "official_anchor_progress_m": round(progress, 1),
                               "scheduled_progress_m": round(scheduled, 1), "maximum_anchor_offset_m": 1500.0})
    planned.sort(key=lambda row: (row["_progress"], row["id"])); normalized = []
    modes = {name: [] for name in ("capacity_deeper", "completion_deeper", "hard_auto", "stopped_deeper")}
    for order, row in enumerate(planned, 1):
        clean = {key: value for key, value in row.items() if key != "_progress"}; clean["stable_order"] = order
        normalized.append(clean); modes[clean["mode"]].append(clean["id"])
    order_by_id = {row["id"]: row["stable_order"] for row in normalized}
    placements.sort(key=lambda row: order_by_id[row["entry_id"]])
    semantics = {"route_geometry_sha256": item["official_geometry_sha256"], "route_distance_m": distance,
                 "entries": normalized, "entry_ids_by_mode": modes, "ogle_prelude_entry_ids": []}
    if len(normalized) != item["entry_count"] or len(order_by_id) != len(normalized):
        raise BuildError("Delivery design coverage drifted")
    return semantics, placements


def build_readiness(item: dict) -> dict:
    route, authored = route_sources(item); review = chapter_review(item); entries = review.get("dossier_entries")
    if not isinstance(entries, list): raise BuildError("Reviewed entries are invalid")
    requests = effective_requests(item, entries); semantics, placements = delivery(item, route, entries)
    sources = {str(path): file_sha(path) for path in source_paths(item)}
    return {"schema_version": 1, "kind": "original_checked_long_form_delivery_readiness",
            "evidence_id": item["evidence_id"], "product_id": PRODUCT_ID,
            "chapter_id": item["chapter_id"], "variant_id": item["variant_id"],
            "consumer_runtime_status": "ready_for_real_audio_validation",
            "consumer_delivery_modes_supported": True, "real_audio_required": True,
            "authoring_estimates_accepted": False, "publication_authorized": False, "gates": GATES,
            "route_binding": {"official_route_evidence_path": str(ROUTES), "route_spec_path": str(ROUTE_SPECS),
                "route_spec_id": authored["id"],
                "official_evidence_geometry_sha256": item["official_geometry_sha256"],
                "geometry_sha256": item["geometry_sha256"],
                "coordinate_count": item["coordinate_count"], "distance_m": item["distance_m"],
                "official_candidate_status": route["status"], "publication_evidence": False,
                "full_geometry_required": True, "anchor_order": [row["anchor_id"] for row in route["landmarks"]]},
            "narration_binding": {"entry_count": item["entry_count"],
                "directional_replacement_count": item["directional_replacement_count"],
                "effective_requests": requests, "effective_request_set_sha256": canonical_sha(requests)},
            "delivery_design": {"policy_id": "smokies_checked_anchor_capacity_fallback_v1",
                "hard_cues_have_priority": True,
                "long_stories_use_capacity_admission_when_a_later_hard_cue_exists": True,
                "capacity_stories_fall_back_after_route": True,
                "stories_without_a_later_hard_cue_are_completion_only": True,
                "parking_or_stopped_playback_claimed": False,
                "all_entries_accounted_for_exactly_once": True, "placement_bindings": placements},
            "expected_delivery_semantics": semantics, "delivery_semantics_sha256": canonical_sha(semantics),
            "source_sha256_by_path": sources,
            "boundaries": {"validation_only": True, "manifest_created_or_mutated": False,
                "database_accessed": False, "network_accessed": False, "provider_accessed": False,
                "real_audio_timing_passed": False, "trusted_report_created": False,
                "public_release_authorized": False}, "recorded_from_task_id": TASK_ID}


def render(value: dict) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def build_all() -> dict[Path, dict]:
    for path, expected in PINNED.items():
        if file_sha(Path(path)) != expected: raise BuildError(f"Pinned checked input drifted: {path}")
    result = {}
    for item in VARIANTS:
        readiness = build_readiness(item); readiness_sha = hashlib.sha256(render(readiness)).hexdigest()
        target = {"schema_version": 2, "kind": "original_route_network_validation_target_authorization",
                  "evidence_id": item["target_evidence_id"], "product_id": PRODUCT_ID,
                  "chapter_id": item["chapter_id"], "variant_id": item["variant_id"],
                  "geometry_sha256": item["geometry_sha256"], "delivery_readiness_path": str(item["readiness_path"]),
                  "delivery_readiness_sha256": readiness_sha,
                  "delivery_semantics_sha256": readiness["delivery_semantics_sha256"],
                  "delivery_contract_binding": "resolve_exact_normalized_manifest_v3_contract_at_validation_time_after_checked_readiness",
                  "required_area_id": "south_tn", "require_full_geometry_within_configured_bounds": True,
                  "authorization": {"decision": "allow_validation_only_route_target",
                    "project_owner_authorized": True, "source_task_id": TASK_ID,
                    "draft_mutation_authorized": False, "global_valhalla_reconfiguration_authorized": False,
                    "public_release_authorized": False, "cultural_scope_expansion_authorized": False}}
        result[item["readiness_path"]] = readiness; result[item["target_path"]] = target
    if len(result) != 10: raise BuildError("Expected exactly ten bounded records")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(); group = parser.add_mutually_exclusive_group()
    group.add_argument("--write", action="store_true"); group.add_argument("--check", action="store_true")
    args = parser.parse_args(); records = build_all(); drift = []
    for path, value in records.items():
        absolute, expected = ROOT / path, render(value)
        if args.write: absolute.parent.mkdir(parents=True, exist_ok=True); absolute.write_bytes(expected)
        elif not absolute.is_file() or absolute.read_bytes() != expected: drift.append(str(path))
    if drift: raise BuildError("Generated records drifted: " + ", ".join(drift))
    print(json.dumps({"status": "written" if args.write else "verified",
        "readiness_record_count": 5, "route_network_target_record_count": 5,
        "network_accessed": False, "database_accessed": False, "manifest_mutated": False,
        "publication_authorized": False,
        "artifacts": {str(path): {"sha256": hashlib.sha256(render(value)).hexdigest(),
                        "bytes": len(render(value))} for path, value in sorted(records.items())}}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__": raise SystemExit(main())
