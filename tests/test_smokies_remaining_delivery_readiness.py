from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import subprocess

import pytest

from db import originals_remaining_validation as validation
from db import originals_complete_validation as complete_validation
from scripts import build_smokies_remaining_delivery_readiness as builder


ROOT = Path(__file__).resolve().parents[1]
HISTORICAL_SOURCE_COMMIT = "102fff55328f4d15ec5757f82f87d235508ebb2b"
HISTORICAL_SOURCE_TREE = "3017790b491545559634c498612ce4a017a0d880"
RF_HASHES = {
    "originals/smokies/roaring_fork_trigger_preflight_v1.json": "b7b8412e07cdef5706d814550491f8c28bfadb05d3fbef38369ec7006c3b67f3",
    "originals/smokies/roaring_fork_delivery_readiness_v1.json": "4a0fc760fd07790785b820af06bac4e5a10e8337ad3f6257a10a3c50464c9b67",
    "originals/smokies/roaring_fork_delivery_readiness_v2.json": "7cf1b601d48845e3bc404a501d33a9f2c1e2567544c03347b99de0524ee923e6",
    "originals/smokies/roaring_fork_delivery_readiness_v3.json": "423866158fc5d1590419076a86f1632717b314c8647adfe6f604342f808abd01",
    "originals/smokies/roaring_fork_route_network_validation_target_v1.json": "f29b9900158659dc53c15afe8d403b808b42a3bdef75f1c024232a6c683c5119",
}


def _json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _pointer(value: str) -> str:
    raw_path, fragment = value.split("#", 1)
    value = _json(ROOT / raw_path)
    for part in fragment.strip("/").split("/"):
        value = value[int(part)] if isinstance(value, list) else value[part]
    assert isinstance(value, str)
    return value


def _compiled(key: tuple[str, str, str]) -> dict:
    registered = validation.REGISTRY[key]
    readiness = _json(ROOT / registered["readiness_path"])
    semantics = readiness["expected_delivery_semantics"]
    routes = _json(ROOT / "originals/smokies/official_route_evidence_v1.json")
    route = next(
        item for item in routes["variants"]
        if (item["chapter_id"], item["variant_id"]) == key[1:]
    )
    lock_path = next(
        path for path in registered["source_paths"]
        if "elevenlabs_james_" in path.as_posix()
    )
    lock = _json(ROOT / lock_path)
    transcripts = {
        request["entry_id"]: _pointer(request["transcript_source"])
        for request in lock["requests"]
        if key[2] in request["effective_variant_ids"]
    }
    hard, selectable = [], []
    for item in semantics["entries"]:
        hydrated = {"id": item["id"], "transcript": transcripts[item["id"]]}
        if item["mode"] == "hard_auto":
            hydrated.update({
                "coordinates": copy.deepcopy(item["coordinates"]),
                "trigger": copy.deepcopy(item["trigger"]),
            })
            hard.append(hydrated)
        else:
            hydrated.update({
                "sequence": item["stable_order"],
                "delivery": {"mode": item["mode"], **copy.deepcopy(item["delivery"])},
            })
            for name in ("coordinates", "trigger"):
                if name in item:
                    hydrated[name] = copy.deepcopy(item[name])
            selectable.append(hydrated)
    return {
        "manifest": {
            "pack_id": key[0],
            "route": {
                "geometry": copy.deepcopy(route["geometry"]),
                "distance_m": route["distance_m"],
            },
            "stops": hard,
        },
        "selection": {
            "chapter_id": key[1],
            "variant_id": key[2],
            "delivery_contract_sha256": "a" * 64,
        },
        "selectable": {"items": selectable},
    }


def _area_config(*, bounds: dict | None = None) -> str:
    return json.dumps([{
        "id": "south_tn",
        "url": "https://south-tn.validation.invalid",
        "bounds": bounds or {"s": 35.0, "w": -85.0, "n": 36.5, "e": -82.5},
    }])


def _historical_blob_sha(relative: str) -> str:
    completed = subprocess.run(
        ["git", "cat-file", "blob", f"{HISTORICAL_SOURCE_COMMIT}:{relative}"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return hashlib.sha256(completed.stdout).hexdigest()


def test_builder_is_deterministic_but_checked_pairs_remain_historical():
    records = builder.build_all()
    assert records == builder.build_all()
    assert len(records) == 10
    readiness = [path for path in records if path.name.endswith("delivery_readiness_v1.json")]
    targets = [path for path in records if path.name.endswith("route_network_validation_target_v1.json")]
    assert len(readiness) == len(targets) == 5
    historical_tree = subprocess.run(
        ["git", "rev-parse", f"{HISTORICAL_SOURCE_COMMIT}^{{tree}}"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    assert historical_tree == HISTORICAL_SOURCE_TREE
    immutable = dict(complete_validation.IMMUTABLE_EVIDENCE_SHA256)
    for path in readiness + targets:
        raw = (ROOT / path).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == immutable[path]
    for path in readiness:
        checked = _json(ROOT / path)
        for relative, expected_sha256 in checked["source_sha256_by_path"].items():
            assert _historical_blob_sha(relative) == expected_sha256
    completed = subprocess.run(
        ["python3", str(ROOT / "scripts/build_smokies_remaining_delivery_readiness.py"), "--check"],
        cwd=ROOT, check=False, capture_output=True, text=True,
    )
    assert completed.returncode != 0
    assert "Generated records drifted" in completed.stderr


def test_exact_registry_inventory_geometry_and_directional_substitutions():
    assert set(validation.REGISTRY) == {
        (validation.PRODUCT_ID, "mountain_crossing", "tn_to_nc"),
        (validation.PRODUCT_ID, "mountain_crossing", "nc_to_tn"),
        (validation.PRODUCT_ID, "little_river_cades_cove", "sugarlands_to_cades_cove_loop"),
        (validation.PRODUCT_ID, "foothills_parkway", "west_to_east"),
        (validation.PRODUCT_ID, "foothills_parkway", "east_to_west"),
    }
    expected_replacements = {"tn_to_nc": 0, "nc_to_tn": 5,
                             "sugarlands_to_cades_cove_loop": 0,
                             "west_to_east": 0, "east_to_west": 3}
    for key, registered in validation.REGISTRY.items():
        readiness = _json(ROOT / registered["readiness_path"])
        target = _json(ROOT / registered["target_path"])
        narration = readiness["narration_binding"]
        assert narration["directional_replacement_count"] == expected_replacements[key[2]]
        assert sum(item["request_kind"] == "directional_override"
                   for item in narration["effective_requests"]) == expected_replacements[key[2]]
        assert readiness["route_binding"]["official_evidence_geometry_sha256"] != registered["geometry_sha256"]
        assert readiness["route_binding"]["geometry_sha256"] == registered["geometry_sha256"]
        assert target["geometry_sha256"] == registered["geometry_sha256"]
        assert "delivery_contract_sha256" not in target
        assert target["delivery_readiness_sha256"] == hashlib.sha256(
            (ROOT / registered["readiness_path"]).read_bytes()
        ).hexdigest()


@pytest.mark.parametrize("key", list(validation.REGISTRY))
def test_all_five_compiled_selections_match_exact_semantics_and_transcripts(key):
    binding = complete_validation.complete_original_long_form_preflight_binding(
        _compiled(key)
    )
    registered = validation.REGISTRY[key]
    assert binding["evidence_id"] == registered["evidence_id"]
    assert binding["readiness_artifact_path"] == registered["readiness_path"].as_posix()
    assert binding["real_audio_validation_required"] is True
    assert binding["publication_authorized"] is False


@pytest.mark.parametrize("key", list(validation.REGISTRY))
def test_all_five_targets_resolve_only_the_existing_area_without_url_leak(key):
    compiled = _compiled(key)
    before = copy.deepcopy(compiled)
    result = complete_validation.complete_trusted_original_route_network_validation_target(
        compiled, configured_area_urls=_area_config(),
    )
    assert compiled == before
    assert result["valhalla_url"] == "https://south-tn.validation.invalid"
    evidence = result["evidence"]
    assert evidence["geometry_sha256"] == validation.REGISTRY[key]["geometry_sha256"]
    assert evidence["delivery_contract_sha256"] == "a" * 64
    assert evidence["route_point_count"] == validation.REGISTRY[key]["coordinate_count"]
    assert "south-tn.validation.invalid" not in json.dumps(evidence, sort_keys=True)
    assert evidence["validation_only"] is True
    assert evidence["draft_mutated"] is False
    assert evidence["global_config_mutated"] is False
    assert evidence["public_release_authorized"] is False


def test_semantic_transcript_geometry_and_contract_drift_fail_closed():
    key = next(iter(validation.REGISTRY))
    semantic = _compiled(key)
    semantic["manifest"]["stops"][0]["trigger"]["enter_radius_m"] += 1
    with pytest.raises(complete_validation.OriginalValidationRunnerError, match="semantics drifted"):
        complete_validation.complete_original_long_form_preflight_binding(semantic)
    transcript = _compiled(key)
    transcript["manifest"]["stops"][0]["transcript"] += " changed"
    with pytest.raises(complete_validation.OriginalValidationRunnerError, match="narration drifted"):
        complete_validation.complete_original_long_form_preflight_binding(transcript)
    geometry = _compiled(key)
    geometry["manifest"]["route"]["geometry"]["coordinates"][100][0] += 0.0001
    with pytest.raises(complete_validation.OriginalValidationRunnerError, match="semantics drifted"):
        complete_validation.complete_original_long_form_preflight_binding(geometry)
    contract = _compiled(key)
    contract["selection"]["delivery_contract_sha256"] = "not-a-hash"
    with pytest.raises(complete_validation.OriginalValidationRunnerError, match="invalid input"):
        complete_validation.complete_trusted_original_route_network_validation_target(
            contract, configured_area_urls=_area_config(),
        )


def test_target_config_bounds_and_identity_drift_fail_closed():
    key = next(iter(validation.REGISTRY)); compiled = _compiled(key)
    with pytest.raises(complete_validation.OriginalValidationRunnerError, match="outside the configured"):
        complete_validation.complete_trusted_original_route_network_validation_target(
            compiled, configured_area_urls=_area_config(bounds={"s": 0, "w": 0, "n": 1, "e": 1}),
        )
    duplicate = json.loads(_area_config()); duplicate.append(copy.deepcopy(duplicate[0]))
    with pytest.raises(complete_validation.OriginalValidationRunnerError, match="unavailable or ambiguous"):
        complete_validation.complete_trusted_original_route_network_validation_target(
            compiled, configured_area_urls=json.dumps(duplicate),
        )
    unknown = _compiled(key); unknown["manifest"]["pack_id"] = "another_original"
    assert complete_validation.complete_trusted_original_route_network_validation_target(
        unknown, configured_area_urls="",
    ) is None


def test_legacy_remaining_adapter_fails_closed_after_current_source_moves():
    key = next(iter(validation.REGISTRY))
    with pytest.raises(validation.OriginalValidationRunnerError, match="source drifted"):
        validation.remaining_original_long_form_preflight_binding(_compiled(key))


def test_delivery_modes_are_safe_complete_and_anchor_bounded():
    for registered in validation.REGISTRY.values():
        readiness = _json(ROOT / registered["readiness_path"])
        semantics = readiness["expected_delivery_semantics"]
        entries = semantics["entries"]
        assert [item["stable_order"] for item in entries] == list(range(1, registered["entry_count"] + 1))
        assert len({item["id"] for item in entries}) == registered["entry_count"]
        assert semantics["entry_ids_by_mode"]["stopped_deeper"] == []
        assert len(semantics["entry_ids_by_mode"]["hard_auto"]) == registered["hard_cue_count"]
        for placement in readiness["delivery_design"]["placement_bindings"]:
            if placement["scheduled_progress_m"] is not None:
                assert abs(placement["scheduled_progress_m"] - placement["official_anchor_progress_m"]) <= placement["maximum_anchor_offset_m"] + 0.1
        for item in entries:
            if item["mode"] == "capacity_deeper":
                assert item["delivery"]["fallback_mode"] == "completion_deeper"
                assert item["delivery"]["guard_before_next_hard_auto_window_s"] == 30
                assert item["delivery"]["may_queue_behind_capacity"] is False


def test_roaring_fork_historical_artifacts_remain_byte_exact():
    for relative, expected in RF_HASHES.items():
        assert hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() == expected
    remaining_paths = {
        path for registered in validation.REGISTRY.values()
        for path in (registered["readiness_path"], registered["target_path"])
    }
    assert all("roaring_fork" not in path.as_posix() for path in remaining_paths)
