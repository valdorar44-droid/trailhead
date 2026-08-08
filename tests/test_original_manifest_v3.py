import copy
import json
from pathlib import Path

import pytest

from db.original_manifest_v3 import (
    ORIGINAL_LONG_FORM_CONTRACT_ID,
    ORIGINAL_LONG_FORM_REQUIRED_CAPABILITIES,
    OriginalManifestV3Error,
    compile_original_manifest_v3_selection,
    normalize_original_manifest_v3,
    original_manifest_v3_delivery_contract_sha256,
)
from db.originals_operational import (
    load_operational_candidate,
    manifest_operational_fields,
)

FIXTURE_PATH = (
    Path(__file__).parent
    / "fixtures"
    / "originals"
    / "moab_canyons_to_sky_draft.json"
)


def _passthrough_v1(_pack_id, _title, manifest, **_kwargs):
    result = copy.deepcopy(manifest)
    sequences = [item["sequence"] for item in result["stops"]]
    if sequences != list(range(1, len(sequences) + 1)):
        raise ValueError("test V1 callback requires contiguous stops")
    return result, json.dumps(result, separators=(",", ":"), sort_keys=True)


def _v3_manifest() -> dict:
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    v1 = payload["manifest"]
    for asset in v1["assets"]:
        if asset.get("kind") == "narration":
            asset["mime_type"] = "audio/mpeg"
            asset["path"] = f"placeholder://smokies/audio/{asset['id']}.mp3"
    selected_indices = [0, 1, 2, 3, 4, 5]
    stories = []
    for index in selected_indices:
        stop = v1["stops"][index]
        stories.append({
            "id": stop["id"],
            "kind": "cue" if index in {0, 3} else "story",
            "title": stop["title"],
            "transcript": stop["transcript"],
            "audio_asset_id": stop["audio_asset_id"],
            "audio_duration_s": float(stop["audio_duration_s"]),
            "citations": [{
                "title": source["title"],
                "url": source["url"],
                "publisher": source.get("publisher") or "National Park Service",
                "role": "story",
                "authority": "official",
                "reviewed_at": "2026-08-03",
                "rights_status": "reference_only",
                "affected_claims": [f"{stop['id']}.claim_1"],
            } for source in stop["citations"]],
        })
    source_refs = [{
        "story_id": stop["id"],
        "coordinates": stop["coordinates"],
        "trigger": stop["trigger"],
    } for stop in v1["stops"]]
    hard_one = {**copy.deepcopy(source_refs[0]), "sequence": 2}
    capacity = {
        **copy.deepcopy(source_refs[1]),
        "sequence": 3,
        "delivery": {
            "mode": "capacity_deeper",
            "admission_policy_id": "capacity_before_next_hard_v1",
            "next_hard_auto_story_id": source_refs[3]["story_id"],
            "guard_before_next_hard_auto_window_s": 30,
            "fallback_mode": "completion_deeper",
            "may_queue_behind_capacity": False,
            "may_wait_for_active_hard_auto": True,
        },
    }
    hard_two = {**copy.deepcopy(source_refs[3]), "sequence": 4}
    operational = manifest_operational_fields(
        load_operational_candidate(), "foothills_parkway",
    )
    manifest = {
        "schema_version": 3,
        "locale": v1["locale"],
        "title": payload["title"],
        "consumer_contract": {
            "schema_version": 1,
            "contract_id": ORIGINAL_LONG_FORM_CONTRACT_ID,
            "required_capabilities": list(ORIGINAL_LONG_FORM_REQUIRED_CAPABILITIES),
        },
        "stories": stories,
        "chapters": [{
            "id": "foothills_parkway",
            "sequence": 1,
            "title": "Foothills Parkway",
            "summary": "A test-only long-form chapter.",
            "default_variant_id": "eastbound",
            "safety": v1["safety"],
            "access": v1["access"],
            "season": v1["season"],
            "operational_sources": operational["operational_sources"],
            "operational_readiness": operational["operational_readiness"],
            "validation_selection": {
                "selection_id": "foothills_parkway_all_variants",
                "required_variant_ids": ["eastbound"],
            },
            "variants": [{
                "id": "eastbound",
                "sequence": 1,
                "title": "Eastbound",
                "route": v1["route"],
                "cue_refs": [hard_one, hard_two],
                "selectable_refs": [
                    {
                        "story_id": source_refs[2]["story_id"],
                        "sequence": 1,
                        "coordinates": source_refs[2]["coordinates"],
                        "delivery": {
                            "mode": "stopped_deeper",
                            "availability": "before_route_user_confirmed_parked",
                            "experience_group_id": "ogle_prelude",
                            "requires_user_confirmed_parked": True,
                            "motion_inference_allowed": False,
                            "parking_availability": "not_checked",
                            "parking_promise": False,
                        },
                    },
                    capacity,
                    {
                        "story_id": source_refs[4]["story_id"],
                        "sequence": 5,
                        "coordinates": source_refs[4]["coordinates"],
                        "delivery": {
                            "mode": "stopped_deeper",
                            "availability": "at_landmark_user_confirmed_parked",
                            "experience_group_id": "thousand_drips_deeper_story",
                            "requires_user_confirmed_parked": True,
                            "motion_inference_allowed": False,
                            "parking_availability": "not_checked",
                            "parking_promise": False,
                            "availability_radius_m": 250,
                        },
                    },
                    {
                        "story_id": source_refs[5]["story_id"],
                        "sequence": 6,
                        "delivery": {
                            "mode": "completion_deeper",
                            "availability": "after_route_completion",
                            "requires_route_completion": True,
                        },
                    },
                ],
                "delivery_contract_sha256": "0" * 64,
            }],
        }],
        "assets": v1["assets"],
        "offline_map": v1["offline_map"],
        "review": v1["review"],
    }
    manifest["chapters"][0]["variants"][0]["delivery_contract_sha256"] = (
        original_manifest_v3_delivery_contract_sha256(
            manifest,
            chapter_id="foothills_parkway",
            variant_id="eastbound",
        )
    )
    return manifest


def _normalize(manifest: dict | None = None) -> dict:
    source = manifest or _v3_manifest()
    normalized, _ = normalize_original_manifest_v3(
        source,
        pack_id="original_moab_canyons_to_sky",
        title="Moab: Canyons to the Sky",
        version=3,
        normalize_v1=_passthrough_v1,
    )
    return normalized


def _rehash(manifest: dict) -> None:
    variant = manifest["chapters"][0]["variants"][0]
    variant["delivery_contract_sha256"] = original_manifest_v3_delivery_contract_sha256(
        manifest,
        chapter_id="foothills_parkway",
        variant_id="eastbound",
    )


def _mobile_cross_language_hash_fixture() -> dict:
    """Small shared contract fixture mirrored by the TypeScript V3 test."""
    def trigger(start: int, end: int) -> dict:
        return {
            "enter_radius_m": 250,
            "exit_radius_m": 375,
            "lead_time_s": 0,
            "route_progress_start_m": start,
            "route_progress_end_m": end,
        }

    return {
        "stories": [
            {"id": "story-1", "kind": "cue", "audio_asset_id": "audio-1", "audio_duration_s": 60},
            {"id": "story-2", "kind": "story", "audio_asset_id": "audio-2", "audio_duration_s": 60},
            {"id": "story-3", "kind": "cue", "audio_asset_id": "audio-3", "audio_duration_s": 60},
            {"id": "story-4", "kind": "story", "audio_asset_id": "audio-story-4", "audio_duration_s": 180},
            {"id": "story-5", "kind": "story", "audio_asset_id": "audio-story-5", "audio_duration_s": 195},
            {"id": "story-6", "kind": "story", "audio_asset_id": "audio-story-6", "audio_duration_s": 210},
        ],
        "chapters": [{
            "id": "mountain-crossing",
            "variants": [{
                "id": "eastbound",
                "route": {"geometry": {"coordinates": [[0, 0], [0.02, 0]]}},
                "cue_refs": [
                    {
                        "story_id": "story-1", "sequence": 2,
                        "coordinates": {"lat": 0, "lng": 0.0045},
                        "trigger": trigger(350, 700),
                    },
                    {
                        "story_id": "story-3", "sequence": 4,
                        "coordinates": {"lat": 0, "lng": 0.0162},
                        "trigger": trigger(1650, 2050),
                    },
                ],
                "selectable_refs": [
                    {
                        "story_id": "story-4", "sequence": 1,
                        "delivery": {
                            "mode": "stopped_deeper",
                            "availability": "before_route_user_confirmed_parked",
                            "experience_group_id": "pre_route_story",
                            "requires_user_confirmed_parked": True,
                            "motion_inference_allowed": False,
                            "parking_availability": "not_checked",
                            "parking_promise": False,
                        },
                    },
                    {
                        "story_id": "story-2", "sequence": 3,
                        "coordinates": {"lat": 0, "lng": 0.0108},
                        "trigger": trigger(1000, 1400),
                        "delivery": {
                            "mode": "capacity_deeper",
                            "admission_policy_id": "capacity_before_next_hard_v1",
                            "next_hard_auto_story_id": "story-3",
                            "guard_before_next_hard_auto_window_s": 30,
                            "fallback_mode": "completion_deeper",
                            "may_queue_behind_capacity": False,
                            "may_wait_for_active_hard_auto": True,
                        },
                    },
                    {
                        "story_id": "story-5", "sequence": 5,
                        "coordinates": {"lat": 0, "lng": 0.018},
                        "delivery": {
                            "mode": "stopped_deeper",
                            "availability": "at_landmark_user_confirmed_parked",
                            "experience_group_id": "landmark_story",
                            "requires_user_confirmed_parked": True,
                            "motion_inference_allowed": False,
                            "parking_availability": "not_checked",
                            "parking_promise": False,
                            "availability_radius_m": 250,
                        },
                    },
                    {
                        "story_id": "story-6", "sequence": 6,
                        "delivery": {
                            "mode": "completion_deeper",
                            "availability": "after_route_completion",
                            "requires_route_completion": True,
                        },
                    },
                ],
            }],
        }],
    }


def test_delivery_hash_matches_mobile_cross_language_fixture():
    assert original_manifest_v3_delivery_contract_sha256(
        _mobile_cross_language_hash_fixture(),
        chapter_id="mountain-crossing",
        variant_id="eastbound",
    ) == "58016df4ffbd67fc9ff4ef2b9c2ad90dc61a79b981f59b79d91bf1814ecbac41"


def test_v3_normalization_is_deterministic_and_does_not_mutate_input():
    source = _v3_manifest()
    before = copy.deepcopy(source)
    first, encoded_first = normalize_original_manifest_v3(
        source,
        pack_id="original_moab_canyons_to_sky",
        title="Moab: Canyons to the Sky",
        version=3,
        normalize_v1=_passthrough_v1,
    )
    second, encoded_second = normalize_original_manifest_v3(
        source,
        pack_id="original_moab_canyons_to_sky",
        title="Moab: Canyons to the Sky",
        version=3,
        normalize_v1=_passthrough_v1,
    )
    assert source == before
    assert first == second
    assert encoded_first == encoded_second
    assert first["schema_version"] == 3
    assert first["consumer_contract"]["required_capabilities"] == (
        ORIGINAL_LONG_FORM_REQUIRED_CAPABILITIES
    )


def test_compile_returns_only_hard_stops_and_hydrates_selectable_sidecar():
    manifest = _normalize()
    variant = manifest["chapters"][0]["variants"][0]
    result = compile_original_manifest_v3_selection(
        manifest,
        chapter_id="foothills_parkway",
        variant_id=None,
        normalize_v1=_passthrough_v1,
    )
    assert [item["id"] for item in result["manifest"]["stops"]] == [
        item["story_id"] for item in variant["cue_refs"]
    ]
    assert [item["sequence"] for item in result["manifest"]["stops"]] == [1, 2]
    assert [item["id"] for item in result["selectable"]["items"]] == [
        item["story_id"] for item in variant["selectable_refs"]
    ]
    assert [item["delivery"]["mode"] for item in result["selectable"]["items"]] == [
        "stopped_deeper", "capacity_deeper", "stopped_deeper", "completion_deeper",
    ]
    assert result["selection"]["delivery_contract_sha256"] == (
        variant["delivery_contract_sha256"]
    )
    assert not ({item["id"] for item in result["manifest"]["stops"]} & {
        item["id"] for item in result["selectable"]["items"]
    })


@pytest.mark.parametrize("mutation", ["top", "contract", "variant", "delivery"])
def test_v3_strict_allowlists_and_contract(mutation):
    manifest = _v3_manifest()
    variant = manifest["chapters"][0]["variants"][0]
    if mutation == "top":
        manifest["unexpected"] = True
    elif mutation == "contract":
        manifest["consumer_contract"]["required_capabilities"] = list(reversed(
            ORIGINAL_LONG_FORM_REQUIRED_CAPABILITIES
        ))
    elif mutation == "variant":
        variant["automatic_optional"] = True
    else:
        variant["selectable_refs"][0]["delivery"]["unsafe"] = True
    with pytest.raises(OriginalManifestV3Error):
        _normalize(manifest)


@pytest.mark.parametrize("mutation", ["duplicate", "gap", "missing", "zero_hard"])
def test_v3_references_form_one_safe_partition(mutation):
    manifest = _v3_manifest()
    variant = manifest["chapters"][0]["variants"][0]
    if mutation == "duplicate":
        variant["selectable_refs"][0]["story_id"] = variant["cue_refs"][0]["story_id"]
    elif mutation == "gap":
        variant["selectable_refs"][-1]["sequence"] = 7
    elif mutation == "missing":
        manifest["stories"].append(copy.deepcopy(manifest["stories"][-1]))
        manifest["stories"][-1]["id"] = "unreferenced_story"
    else:
        variant["cue_refs"] = []
    _rehash(manifest)
    with pytest.raises(OriginalManifestV3Error):
        _normalize(manifest)


def test_capacity_requires_a_later_hard_cue_and_exact_policy():
    manifest = _v3_manifest()
    capacity = manifest["chapters"][0]["variants"][0]["selectable_refs"][1]
    capacity["delivery"]["next_hard_auto_story_id"] = "missing_hard"
    _rehash(manifest)
    with pytest.raises(OriginalManifestV3Error, match="hard cue"):
        _normalize(manifest)

    manifest = _v3_manifest()
    capacity = manifest["chapters"][0]["variants"][0]["selectable_refs"][1]
    capacity["delivery"]["may_queue_behind_capacity"] = True
    with pytest.raises(OriginalManifestV3Error, match="must be false"):
        _normalize(manifest)

    manifest = _v3_manifest()
    capacity = manifest["chapters"][0]["variants"][0]["selectable_refs"][1]
    capacity["trigger"]["route_progress_end_m"] = (
        manifest["chapters"][0]["variants"][0]["route"]["distance_m"] + 1
    )
    with pytest.raises(OriginalManifestV3Error, match="exceeds its route distance"):
        _normalize(manifest)


def test_stopped_and_completion_modes_cannot_be_inferred_or_autotriggered():
    manifest = _v3_manifest()
    landmark = manifest["chapters"][0]["variants"][0]["selectable_refs"][2]
    landmark["delivery"].pop("availability_radius_m")
    with pytest.raises(OriginalManifestV3Error, match="availability radius"):
        _normalize(manifest)

    manifest = _v3_manifest()
    before_route = manifest["chapters"][0]["variants"][0]["selectable_refs"][0]
    before_route["delivery"]["availability_radius_m"] = 250
    with pytest.raises(OriginalManifestV3Error, match="cannot have an availability radius"):
        _normalize(manifest)

    manifest = _v3_manifest()
    completion = manifest["chapters"][0]["variants"][0]["selectable_refs"][-1]
    completion["trigger"] = copy.deepcopy(
        manifest["chapters"][0]["variants"][0]["cue_refs"][0]["trigger"]
    )
    with pytest.raises(OriginalManifestV3Error, match="cannot have a trigger"):
        _normalize(manifest)


def test_delivery_hash_binds_route_audio_and_delivery_content():
    manifest = _v3_manifest()
    baseline = manifest["chapters"][0]["variants"][0]["delivery_contract_sha256"]
    changed = copy.deepcopy(manifest)
    changed["stories"][0]["audio_duration_s"] += 1
    assert original_manifest_v3_delivery_contract_sha256(
        changed, chapter_id="foothills_parkway", variant_id="eastbound",
    ) != baseline
    changed = copy.deepcopy(manifest)
    changed["chapters"][0]["variants"][0]["selectable_refs"][1]["delivery"][
        "guard_before_next_hard_auto_window_s"
    ] = 31
    with pytest.raises(OriginalManifestV3Error):
        original_manifest_v3_delivery_contract_sha256(
            changed, chapter_id="foothills_parkway", variant_id="eastbound",
        )
    changed = copy.deepcopy(manifest)
    changed["chapters"][0]["variants"][0]["route"]["geometry"]["coordinates"][0][0] += 0.0001
    assert original_manifest_v3_delivery_contract_sha256(
        changed, chapter_id="foothills_parkway", variant_id="eastbound",
    ) != baseline


def test_hash_tampering_and_unknown_selection_fail_closed():
    manifest = _v3_manifest()
    manifest["chapters"][0]["variants"][0]["delivery_contract_sha256"] = "f" * 64
    with pytest.raises(OriginalManifestV3Error, match="canonical content"):
        _normalize(manifest)
    normalized = _normalize()
    normalized["stories"][0]["audio_duration_s"] += 1
    with pytest.raises(OriginalManifestV3Error, match="changed after normalization"):
        compile_original_manifest_v3_selection(
            normalized,
            chapter_id="foothills_parkway",
            variant_id=None,
            normalize_v1=_passthrough_v1,
        )
    normalized = _normalize()
    with pytest.raises(OriginalManifestV3Error, match="chapter selection"):
        compile_original_manifest_v3_selection(
            normalized,
            chapter_id="missing",
            variant_id=None,
            normalize_v1=_passthrough_v1,
        )


def test_publication_fails_before_hard_validation_without_trusted_long_form_evidence():
    manifest = _v3_manifest()
    seen = []

    def recorder(_pack_id, _title, compiled, **kwargs):
        seen.append({
            "publishing": kwargs.get("publishing"),
            "ids": [item["id"] for item in compiled["stops"]],
        })
        return _passthrough_v1(_pack_id, _title, compiled, **kwargs)

    with pytest.raises(OriginalManifestV3Error, match="trusted long-form validation"):
        normalize_original_manifest_v3(
            manifest,
            pack_id="original_moab_canyons_to_sky",
            title="Moab: Canyons to the Sky",
            version=3,
            normalize_v1=recorder,
            publishing=True,
            validated_selections={"foothills_parkway_all_variants:eastbound"},
        )
    assert seen == []


def test_v2_manifest_is_rejected_by_v3_entrypoint():
    manifest = _v3_manifest()
    manifest["schema_version"] = 2
    with pytest.raises(OriginalManifestV3Error, match="schema_version"):
        _normalize(manifest)
