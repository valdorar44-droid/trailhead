"""Trusted validation-only registry for five unfinished Smokies variants.

Roaring Fork stays in ``db.originals_validation``.  This separate registry
keeps every historical Roaring Fork artifact and source closure byte-exact.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re
from typing import Any

from db.originals_validation import (
    OriginalValidationRunnerError, REPO_ROOT, _canonical_json_value,
    _configured_original_validation_area_target,
    _long_form_delivery_semantics_from_compiled, original_route_geometry_sha256,
)


PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"
GATES = {"route_end_tail_limit_s": 240, "trigger_to_play_latency_limit_s": 180,
         "capacity_guard_s": 30, "speed_fixtures_mph": [15, 36, 65, 75]}
COMMON_SOURCES = (
    Path("db/original_manifest_v3.py"), Path("db/originals_validation.py"),
    Path("db/originals_remaining_validation.py"),
    Path("mobile/lib/originals/manifestV3.ts"),
    Path("mobile/lib/originals/longFormScheduler.ts"),
    Path("mobile/lib/originals/session.ts"), Path("mobile/lib/originals/triggerEngine.ts"),
    Path("mobile/scripts/validate-original-long-form.ts"),
    Path("scripts/build_smokies_remaining_delivery_readiness.py"),
    Path("originals/smokies/official_route_evidence_v1.json"),
    Path("originals/smokies/route_variants_v1.json"),
    Path("originals/smokies/source_dossiers_v1.json"),
    Path("originals/smokies/checkpoint2_owner_approval_v1.json"),
)
RUNTIME_GEOMETRY_SHA256 = {
    "mountain_crossing_tn_to_nc": "2bdc7c71d56fd5d5cca177da41416540b208278ed232921eabf27ad501be5fb7",
    "mountain_crossing_nc_to_tn": "fce92ad2377fa6eafbc7779d952f3825895ed8ff365094a6ea32e6c83ce4d141",
    "little_river_cades_cove_loop": "92478b7b5440491b4c30161a80d13571a79cb3d0fbd64a52b6137a7241679a83",
    "foothills_parkway_west_to_east": "d23c9d94eae1740162877a43c8c594ec0f58c0f1a2695fba96dac61b852f32c3",
    "foothills_parkway_east_to_west": "7304463b5d1efe3a49f7f29a8343d2015716fc56f1931c5b53b6d93103b97acf",
}


def row(chapter: str, variant: str, slug: str, route_id: str, geometry: str,
        points: int, distance: float, entries: int, cues: int, replacements: int,
        review: str, editorial: str, lock: str, foothills: bool = False) -> dict:
    sources = set(COMMON_SOURCES) | {Path(review), Path(editorial), Path(lock)}
    if foothills: sources.add(Path("originals/smokies/foothills_parkway_approval_v1.json"))
    return {"chapter_id": chapter, "variant_id": variant,
        "evidence_id": f"smokies_{slug}_delivery_20260811_v1",
        "target_evidence_id": f"smokies_{slug}_route_network_target_20260811_v1",
        "readiness_path": Path(f"originals/smokies/{slug}_delivery_readiness_v1.json"),
        "target_path": Path(f"originals/smokies/{slug}_route_network_validation_target_v1.json"),
        "official_geometry_sha256": geometry, "geometry_sha256": RUNTIME_GEOMETRY_SHA256[slug],
        "coordinate_count": points, "distance_m": distance,
        "entry_count": entries, "hard_cue_count": cues,
        "directional_replacement_count": replacements, "route_spec_id": route_id,
        "source_paths": tuple(sorted(sources, key=lambda path: path.as_posix()))}


REGISTRY = {
    (PRODUCT_ID, "mountain_crossing", "tn_to_nc"): row(
        "mountain_crossing", "tn_to_nc", "mountain_crossing_tn_to_nc", "mountain-crossing-tn-to-nc",
        "4a003a6bde4d0c9623a71875bb5f369050f11202f58cd5c02d9451377ad980ab",
        6596, 73505.4, 28, 10, 0, "originals/smokies/remaining_chapters_review_packet_v1.json",
        "originals/smokies/editorial_mountain_crossing_v1.json",
        "originals/smokies/elevenlabs_james_mountain_crossing_lock_v1.json"),
    (PRODUCT_ID, "mountain_crossing", "nc_to_tn"): row(
        "mountain_crossing", "nc_to_tn", "mountain_crossing_nc_to_tn", "mountain-crossing-nc-to-tn",
        "2da7812bfd8f129492420cf6cfeca2d990950a0eb057f98c586bbcbd4aaad5b3",
        6571, 73230.7, 28, 10, 5, "originals/smokies/remaining_chapters_review_packet_v1.json",
        "originals/smokies/editorial_mountain_crossing_v1.json",
        "originals/smokies/elevenlabs_james_mountain_crossing_lock_v1.json"),
    (PRODUCT_ID, "little_river_cades_cove", "sugarlands_to_cades_cove_loop"): row(
        "little_river_cades_cove", "sugarlands_to_cades_cove_loop", "little_river_cades_cove_loop",
        "little-river-cades-cove-loop",
        "9f77ba8f704e82b3fb43e81f330a20771e2d8d87b44fe1fae29329cf082255c8",
        4800, 56937.5, 23, 9, 0, "originals/smokies/remaining_chapters_review_packet_v1.json",
        "originals/smokies/editorial_cades_cove_v1.json",
        "originals/smokies/elevenlabs_james_cades_cove_lock_v1.json"),
    (PRODUCT_ID, "foothills_parkway", "west_to_east"): row(
        "foothills_parkway", "west_to_east", "foothills_parkway_west_to_east",
        "foothills-parkway-west-to-east",
        "3b86e6b62db0be72edd15557d3f503bfe79baa869877044a7deb4f4b487f547d",
        7948, 50816.7, 13, 7, 0, "originals/smokies/foothills_parkway_review_packet_v1.json",
        "originals/smokies/editorial_scripts_v1.json",
        "originals/smokies/elevenlabs_james_foothills_parkway_lock_v1.json", True),
    (PRODUCT_ID, "foothills_parkway", "east_to_west"): row(
        "foothills_parkway", "east_to_west", "foothills_parkway_east_to_west",
        "foothills-parkway-east-to-west",
        "58a8f0322c03136efd13f0bbcf3de00aab7b270fe37211efac1c07850ea6a358",
        7948, 50816.7, 13, 7, 3, "originals/smokies/foothills_parkway_review_packet_v1.json",
        "originals/smokies/editorial_scripts_v1.json",
        "originals/smokies/elevenlabs_james_foothills_parkway_lock_v1.json", True),
}
REMAINING_LONG_FORM_CHECKED_DELIVERY_EVIDENCE = REGISTRY
READINESS_KEYS = {"schema_version", "kind", "evidence_id", "product_id", "chapter_id", "variant_id",
    "consumer_runtime_status", "consumer_delivery_modes_supported", "real_audio_required",
    "authoring_estimates_accepted", "publication_authorized", "gates", "route_binding",
    "narration_binding", "delivery_design", "expected_delivery_semantics",
    "delivery_semantics_sha256", "source_sha256_by_path", "boundaries", "recorded_from_task_id"}
TARGET_KEYS = {"schema_version", "kind", "evidence_id", "product_id", "chapter_id", "variant_id",
    "geometry_sha256", "delivery_readiness_path", "delivery_readiness_sha256",
    "delivery_semantics_sha256", "delivery_contract_binding", "required_area_id",
    "require_full_geometry_within_configured_bounds", "authorization"}


def canonical_sha(value: Any) -> str:
    raw = json.dumps(_canonical_json_value(value), separators=(",", ":"), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def load(relative: Path, label: str) -> tuple[dict, bytes]:
    path = REPO_ROOT / relative
    if not path.is_file(): raise OriginalValidationRunnerError(f"Checked {label} is unavailable")
    raw = path.read_bytes()
    try: value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OriginalValidationRunnerError(f"Checked {label} is invalid") from exc
    if not isinstance(value, dict): raise OriginalValidationRunnerError(f"Checked {label} is invalid")
    return value, raw


def selection_key(compiled: dict) -> tuple[str, str, str]:
    manifest = compiled.get("manifest") if isinstance(compiled, dict) else None
    selection = compiled.get("selection") if isinstance(compiled, dict) else None
    if not isinstance(manifest, dict) or not isinstance(selection, dict):
        raise OriginalValidationRunnerError("Compiled remaining long-form selection is invalid")
    return (str(manifest.get("pack_id") or "").strip(), str(selection.get("chapter_id") or "").strip(),
            str(selection.get("variant_id") or "").strip())


def validate_sources(artifact: dict, registered: dict) -> str:
    sources = artifact.get("source_sha256_by_path"); expected = {str(path) for path in registered["source_paths"]}
    if not isinstance(sources, dict) or set(sources) != expected:
        raise OriginalValidationRunnerError("Checked remaining readiness source set drifted")
    for relative, digest in sources.items():
        path = REPO_ROOT / relative
        if (not re.fullmatch(r"[a-f0-9]{64}", str(digest or "")) or not path.is_file()
                or hashlib.sha256(path.read_bytes()).hexdigest() != digest):
            raise OriginalValidationRunnerError(f"Checked remaining readiness source drifted: {relative}")
    return canonical_sha(sources)


def validate_trigger(value: Any, distance: float, label: str) -> None:
    keys = {"enter_radius_m", "exit_radius_m", "lead_time_s", "route_progress_start_m",
            "route_progress_end_m", "approach_bearing_deg", "bearing_tolerance_deg"}
    if not isinstance(value, dict) or set(value) != keys:
        raise OriginalValidationRunnerError(f"{label} trigger contract is invalid")
    if any(isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number)
           for number in value.values()):
        raise OriginalValidationRunnerError(f"{label} trigger values are invalid")
    if (value["enter_radius_m"] != 160 or value["exit_radius_m"] != 260 or value["lead_time_s"] != 0
            or value["bearing_tolerance_deg"] != 70
            or not 0 <= value["route_progress_start_m"] < value["route_progress_end_m"] <= distance
            or not 0 <= value["approach_bearing_deg"] < 360):
        raise OriginalValidationRunnerError(f"{label} trigger safety values drifted")


def validate_readiness(key: tuple[str, str, str], registered: dict,
                       artifact: dict, raw: bytes) -> dict:
    route, narration = artifact.get("route_binding"), artifact.get("narration_binding")
    design, semantics, boundaries = (artifact.get("delivery_design"),
        artifact.get("expected_delivery_semantics"), artifact.get("boundaries"))
    expected_boundaries = {"validation_only": True, "manifest_created_or_mutated": False,
        "database_accessed": False, "network_accessed": False, "provider_accessed": False,
        "real_audio_timing_passed": False, "trusted_report_created": False,
        "public_release_authorized": False}
    if (set(artifact) != READINESS_KEYS or artifact.get("schema_version") != 1
            or artifact.get("kind") != "original_checked_long_form_delivery_readiness"
            or artifact.get("evidence_id") != registered["evidence_id"]
            or (artifact.get("product_id"), artifact.get("chapter_id"), artifact.get("variant_id")) != key
            or artifact.get("consumer_runtime_status") != "ready_for_real_audio_validation"
            or artifact.get("consumer_delivery_modes_supported") is not True
            or artifact.get("real_audio_required") is not True
            or artifact.get("authoring_estimates_accepted") is not False
            or artifact.get("publication_authorized") is not False or artifact.get("gates") != GATES
            or artifact.get("recorded_from_task_id") != TASK_ID or boundaries != expected_boundaries
            or not all(isinstance(value, dict) for value in (route, narration, design, semantics))):
        raise OriginalValidationRunnerError("Checked remaining delivery readiness contract is invalid")
    expected_route = {"official_route_evidence_path": "originals/smokies/official_route_evidence_v1.json",
        "route_spec_path": "originals/smokies/route_variants_v1.json", "route_spec_id": registered["route_spec_id"],
        "official_evidence_geometry_sha256": registered["official_geometry_sha256"],
        "geometry_sha256": registered["geometry_sha256"], "coordinate_count": registered["coordinate_count"],
        "distance_m": registered["distance_m"], "official_candidate_status": "official_geometry_candidate",
        "publication_evidence": False, "full_geometry_required": True}
    if (set(route) != set(expected_route) | {"anchor_order"}
            or any(route.get(name) != value for name, value in expected_route.items())
            or not isinstance(route.get("anchor_order"), list) or not route["anchor_order"]
            or len(route["anchor_order"]) != len(set(route["anchor_order"]))):
        raise OriginalValidationRunnerError("Checked remaining route binding drifted")
    requests = narration.get("effective_requests")
    if (set(narration) != {"entry_count", "directional_replacement_count", "effective_requests",
                           "effective_request_set_sha256"}
            or narration.get("entry_count") != registered["entry_count"]
            or narration.get("directional_replacement_count") != registered["directional_replacement_count"]
            or not isinstance(requests, list) or len(requests) != registered["entry_count"]
            or requests != sorted(requests, key=lambda item: item.get("entry_id", ""))
            or narration.get("effective_request_set_sha256") != canonical_sha(requests)):
        raise OriginalValidationRunnerError("Checked remaining narration binding drifted")
    entry_ids, request_ids = set(), set()
    for request in requests:
        if (not isinstance(request, dict)
                or set(request) != {"entry_id", "provider_request_id", "request_kind", "transcript_sha256"}
                or not re.fullmatch(r"[a-z0-9][a-z0-9_]{2,80}", str(request.get("entry_id") or ""))
                or not re.fullmatch(r"[a-z0-9][a-z0-9_]{2,100}__(?:base|[a-z0-9_]+)", str(request.get("provider_request_id") or ""))
                or request.get("request_kind") not in {"base_entry", "directional_override"}
                or not re.fullmatch(r"[a-f0-9]{64}", str(request.get("transcript_sha256") or ""))):
            raise OriginalValidationRunnerError("Checked remaining narration request is invalid")
        entry_ids.add(request["entry_id"]); request_ids.add(request["provider_request_id"])
    if len(entry_ids) != len(requests) or len(request_ids) != len(requests):
        raise OriginalValidationRunnerError("Checked remaining narration identity is duplicated")
    expected_design = {"policy_id": "smokies_checked_anchor_capacity_fallback_v1",
        "hard_cues_have_priority": True,
        "long_stories_use_capacity_admission_when_a_later_hard_cue_exists": True,
        "capacity_stories_fall_back_after_route": True,
        "stories_without_a_later_hard_cue_are_completion_only": True,
        "parking_or_stopped_playback_claimed": False, "all_entries_accounted_for_exactly_once": True}
    placements = design.get("placement_bindings")
    if (set(design) != set(expected_design) | {"placement_bindings"}
            or any(design.get(name) != value for name, value in expected_design.items())
            or not isinstance(placements, list) or len(placements) != registered["entry_count"]):
        raise OriginalValidationRunnerError("Checked remaining delivery design drifted")
    semantics_hash, entries, modes = (canonical_sha(semantics), semantics.get("entries"),
                                      semantics.get("entry_ids_by_mode"))
    if (artifact.get("delivery_semantics_sha256") != semantics_hash
            or semantics.get("route_geometry_sha256") != registered["official_geometry_sha256"]
            or semantics.get("route_distance_m") != registered["distance_m"]
            or semantics.get("ogle_prelude_entry_ids") != []
            or not isinstance(entries, list) or len(entries) != registered["entry_count"]
            or not isinstance(modes, dict)
            or set(modes) != {"capacity_deeper", "completion_deeper", "hard_auto", "stopped_deeper"}
            or modes.get("stopped_deeper") != [] or len(modes.get("hard_auto") or []) != registered["hard_cue_count"]
            or [item.get("stable_order") for item in entries] != list(range(1, registered["entry_count"] + 1))
            or {str(item.get("id") or "") for item in entries} != entry_ids):
        raise OriginalValidationRunnerError("Checked remaining delivery semantics drifted")
    hard = {item["id"]: item for item in entries if isinstance(item, dict) and item.get("mode") == "hard_auto"}
    computed_modes = {name: [] for name in modes}
    for item in entries:
        mode = item.get("mode") if isinstance(item, dict) else None
        if mode not in computed_modes: raise OriginalValidationRunnerError("Checked delivery mode is unsupported")
        computed_modes[mode].append(item.get("id"))
        if mode in {"hard_auto", "capacity_deeper"}:
            coordinates = item.get("coordinates")
            if (not isinstance(coordinates, dict) or set(coordinates) != {"lat", "lng"}
                    or any(isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number)
                           for number in coordinates.values())):
                raise OriginalValidationRunnerError("Checked delivery coordinate is invalid")
            validate_trigger(item.get("trigger"), registered["distance_m"], str(item.get("id")))
        if mode == "hard_auto" and item.get("delivery") != {"priority": "must_play",
                "queue_policy": "durable_fifo_among_hard_auto", "optional_content_may_delay": False}:
            raise OriginalValidationRunnerError("Checked hard-cue policy drifted")
        if mode == "capacity_deeper":
            delivery = item.get("delivery") or {}; next_hard = hard.get(delivery.get("next_hard_auto_story_id"))
            expected = {"admission_policy_id": "capacity_before_next_hard_v1",
                "next_hard_auto_story_id": delivery.get("next_hard_auto_story_id"),
                "guard_before_next_hard_auto_window_s": 30, "fallback_mode": "completion_deeper",
                "may_queue_behind_capacity": False, "may_wait_for_active_hard_auto": True}
            if (delivery != expected or next_hard is None or next_hard["stable_order"] <= item["stable_order"]
                    or item["trigger"]["route_progress_start_m"] >= next_hard["trigger"]["route_progress_start_m"]):
                raise OriginalValidationRunnerError("Checked capacity policy drifted")
        if mode == "completion_deeper" and (set(item) != {"id", "stable_order", "mode", "delivery"}
                or item.get("delivery") != {"availability": "after_route_completion",
                                             "requires_route_completion": True}):
            raise OriginalValidationRunnerError("Checked completion policy drifted")
    if computed_modes != modes: raise OriginalValidationRunnerError("Checked delivery summary drifted")
    placement_ids = set()
    for placement in placements:
        if (not isinstance(placement, dict) or set(placement) != {"entry_id", "route_context", "mode",
                "official_anchor_progress_m", "scheduled_progress_m", "maximum_anchor_offset_m"}
                or placement.get("entry_id") in placement_ids or placement.get("entry_id") not in entry_ids
                or placement.get("mode") not in computed_modes):
            raise OriginalValidationRunnerError("Checked placement binding is invalid")
        scheduled, maximum = placement.get("scheduled_progress_m"), placement.get("maximum_anchor_offset_m")
        if placement["mode"] == "completion_deeper":
            if scheduled is not None or maximum is not None:
                raise OriginalValidationRunnerError("Completion placement must remain after-route only")
        elif (isinstance(scheduled, bool) or not isinstance(scheduled, (int, float))
                or isinstance(maximum, bool) or not isinstance(maximum, (int, float))
                or abs(float(scheduled) - float(placement.get("official_anchor_progress_m"))) > float(maximum) + 0.11):
            raise OriginalValidationRunnerError("Checked placement exceeded its anchor bound")
        placement_ids.add(placement["entry_id"])
    if placement_ids != entry_ids: raise OriginalValidationRunnerError("Checked placement coverage drifted")
    return {"artifact_sha256": hashlib.sha256(raw).hexdigest(),
        "source_set_sha256": validate_sources(artifact, registered),
        "semantic_contract_sha256": semantics_hash,
        "narration_request_set_sha256": narration["effective_request_set_sha256"],
        "requests": requests, "semantics": semantics}


def remaining_original_long_form_preflight_binding(compiled: dict) -> dict:
    key = selection_key(compiled); registered = REGISTRY.get(key)
    if registered is None:
        raise OriginalValidationRunnerError("No checked remaining long-form delivery evidence is registered for this chapter variant")
    artifact, raw = load(registered["readiness_path"], "remaining delivery readiness")
    checked = validate_readiness(key, registered, artifact, raw)
    if _long_form_delivery_semantics_from_compiled(compiled) != checked["semantics"]:
        raise OriginalValidationRunnerError("Compiled remaining long-form delivery semantics drifted from checked evidence")
    selectable = compiled.get("selectable"); manifest = compiled["manifest"]
    if not isinstance(selectable, dict) or not isinstance(selectable.get("items"), list):
        raise OriginalValidationRunnerError("Compiled remaining selectable narration is invalid")
    items = list(manifest.get("stops") or []) + list(selectable["items"]); actual = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("transcript"), str):
            raise OriginalValidationRunnerError("Compiled remaining narration transcript is invalid")
        item_id = str(item.get("id") or "")
        if item_id in actual: raise OriginalValidationRunnerError("Compiled narration identity is duplicated")
        actual[item_id] = hashlib.sha256(item["transcript"].encode("utf-8")).hexdigest()
    expected = {item["entry_id"]: item["transcript_sha256"] for item in checked["requests"]}
    if actual != expected:
        raise OriginalValidationRunnerError("Compiled remaining effective narration drifted from checked evidence")
    return {"schema_version": 1, "evidence_id": registered["evidence_id"],
        "product_id": key[0], "chapter_id": key[1], "variant_id": key[2],
        "readiness_artifact_path": str(registered["readiness_path"]),
        "readiness_artifact_sha256": checked["artifact_sha256"],
        "readiness_source_set_sha256": checked["source_set_sha256"],
        "semantic_contract_sha256": checked["semantic_contract_sha256"],
        "narration_request_set_sha256": checked["narration_request_set_sha256"],
        "real_audio_validation_required": True, "publication_authorized": False}


def trusted_remaining_original_route_network_validation_target(
        selection_item: dict, *, configured_area_urls: str) -> dict | None:
    manifest = selection_item.get("manifest") if isinstance(selection_item, dict) else None
    selection = selection_item.get("selection") if isinstance(selection_item, dict) else None
    if not isinstance(manifest, dict):
        raise OriginalValidationRunnerError("Trusted remaining route target selection is invalid")
    if selection is None: return None
    if not isinstance(selection, dict):
        raise OriginalValidationRunnerError("Trusted remaining route target selection is invalid")
    key = (str(manifest.get("pack_id") or "").strip(), str(selection.get("chapter_id") or "").strip(),
           str(selection.get("variant_id") or "").strip()); registered = REGISTRY.get(key)
    if registered is None: return None
    readiness = remaining_original_long_form_preflight_binding(selection_item)
    artifact, raw = load(registered["target_path"], "remaining route-network target")
    authorization = {"decision": "allow_validation_only_route_target", "project_owner_authorized": True,
        "source_task_id": TASK_ID, "draft_mutation_authorized": False,
        "global_valhalla_reconfiguration_authorized": False, "public_release_authorized": False,
        "cultural_scope_expansion_authorized": False}
    if (set(artifact) != TARGET_KEYS or artifact.get("schema_version") != 2
            or artifact.get("kind") != "original_route_network_validation_target_authorization"
            or artifact.get("evidence_id") != registered["target_evidence_id"]
            or (artifact.get("product_id"), artifact.get("chapter_id"), artifact.get("variant_id")) != key
            or artifact.get("geometry_sha256") != registered["geometry_sha256"]
            or artifact.get("delivery_readiness_path") != str(registered["readiness_path"])
            or artifact.get("delivery_readiness_sha256") != readiness["readiness_artifact_sha256"]
            or artifact.get("delivery_semantics_sha256") != readiness["semantic_contract_sha256"]
            or artifact.get("delivery_contract_binding") != "resolve_exact_normalized_manifest_v3_contract_at_validation_time_after_checked_readiness"
            or artifact.get("required_area_id") != "south_tn"
            or artifact.get("require_full_geometry_within_configured_bounds") is not True
            or artifact.get("authorization") != authorization):
        raise OriginalValidationRunnerError("Checked remaining route-network target contract is invalid")
    coordinates = (manifest.get("route") or {}).get("geometry", {}).get("coordinates")
    contract = str(selection.get("delivery_contract_sha256") or "").strip().lower()
    if (not isinstance(coordinates, list) or len(coordinates) != registered["coordinate_count"]
            or original_route_geometry_sha256(coordinates) != registered["geometry_sha256"]
            or not re.fullmatch(r"[a-f0-9]{64}", contract)):
        raise OriginalValidationRunnerError("Checked remaining route-network target addresses different input")
    target = _configured_original_validation_area_target("south_tn", configured_area_urls)
    bounds = target["bounds"]
    for index, point in enumerate(coordinates):
        try: lng, lat = float(point[0]), float(point[1])
        except (IndexError, TypeError, ValueError) as exc:
            raise OriginalValidationRunnerError(f"Remaining validation coordinate {index + 1} is invalid") from exc
        if not bounds["s"] <= lat <= bounds["n"] or not bounds["w"] <= lng <= bounds["e"]:
            raise OriginalValidationRunnerError("Remaining geometry is outside the configured south_tn target")
    binding = {"id": target["id"], "bounds": bounds, "url": target["url"]}
    evidence = {"schema_version": 2, "evidence_id": registered["target_evidence_id"],
        "evidence_sha256": hashlib.sha256(raw).hexdigest(), "geometry_sha256": registered["geometry_sha256"],
        "delivery_contract_sha256": contract, "delivery_readiness_sha256": readiness["readiness_artifact_sha256"],
        "delivery_semantics_sha256": readiness["semantic_contract_sha256"], "target_id": target["id"],
        "target_binding_sha256": canonical_sha(binding), "route_point_count": len(coordinates),
        "validation_only": True, "draft_mutated": False, "global_config_mutated": False,
        "public_release_authorized": False}
    return {"valhalla_url": target["url"], "evidence": evidence}
