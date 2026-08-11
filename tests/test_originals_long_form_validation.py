import copy
import hashlib
import json
import math
from pathlib import Path

import pytest

from db import originals_validation as validation
from db import originals_complete_validation as complete_validation
from db import original_manifest_v3 as manifest_v3
from db import store
from db.original_manifest_v3 import (
    compile_original_manifest_v3_selection,
    normalize_original_manifest_v3,
)
from db.originals_validation import (
    ORIGINAL_LONG_FORM_VALIDATION_GATES,
    OriginalValidationRunnerError,
    original_long_form_audio_binding,
)
from db.originals_complete_validation import (
    complete_original_long_form_preflight_binding as original_long_form_preflight_binding,
    normalize_complete_original_long_form_validation_output as normalize_original_long_form_validation_output,
    run_complete_originals_long_form_validation_cli as run_originals_long_form_validation_cli,
    trusted_complete_originals_long_form_validator_source_sha256 as trusted_originals_long_form_validator_source_sha256,
)
from tests.test_original_manifest_v3 import _normalize, _passthrough_v1, _v3_manifest


def _empty_generator_evidence():
    return {
        "generated": False,
        "provider": None,
        "model_id": None,
        "voice_id": None,
        "commercial_license_attested": False,
        "metadata_sha256": hashlib.sha256(b"{}").hexdigest(),
    }


def _valid_generator_metadata():
    return {
        "provider": "cartesia",
        "model_id": "sonic-3.5-2026-05-04",
        "voice_id": "test-voice",
        "license_status": "attested",
        "license_attestation": {
            "terms_id": "cartesia-pro-test",
            "terms_url": "https://cartesia.ai/terms",
            "terms_version": "2026-01-01",
            "reviewed_at": "2026-08-01",
            "attested_at": "2026-08-03T00:00:00Z",
            "attested_by_admin_user_id": 1,
        },
    }


def _narration_profile():
    return {
        "schema_version": 1,
        "provider": "cartesia",
        "voice_id": "test-voice",
        "model_snapshot": "sonic-3.5-2026-05-04",
        "api_version": "2026-05-04",
        "language": "en-US",
        "generation": {"output_format": "wav", "sample_rate_hz": 44100, "channels": 1},
        "archival_master": {
            "mime_type": "audio/wav", "sample_rate_hz": 44100,
            "channels": 1, "bit_depth": 24,
        },
        "mobile_delivery": {
            "mime_type": "audio/mpeg", "bitrate_kbps": 96,
            "sample_rate_hz": 44100, "channels": 1,
        },
        "commercial_license": {
            "status": "attested", "plan": "pro",
            "attested_at": "2026-08-03T00:00:00Z",
        },
        "training_opt_out": {
            "status": "confirmed", "confirmed_at": "2026-08-03T00:00:00Z",
        },
    }


def _publication_input():
    manifest = _with_test_assets(_v3_manifest())
    manifest["narration_profile"] = _narration_profile()
    manifest["route_evidence"] = {
        "schema_version": 1,
        "evidence_id": "test-route-evidence",
        "product_id": "original_moab_canyons_to_sky",
        "evidence_sha256": "a" * 64,
        "route_spec_sha256": "b" * 64,
        "source_snapshot_sha256": "c" * 64,
    }
    stories_by_asset = {story["audio_asset_id"]: story for story in manifest["stories"]}
    verified = {}
    for asset in manifest["assets"]:
        story = stories_by_asset.get(asset["id"])
        verified[asset["id"]] = {
            "kind": asset["kind"],
            "public_path": asset["path"],
            "mime_type": asset["mime_type"],
            "byte_count": asset["bytes"],
            "sha256": asset["sha256"],
            "transcript_sha256": (
                store.original_transcript_sha256(story["transcript"])
                if story else None
            ),
            "media_metadata_json": json.dumps({
                "duration_s": story["audio_duration_s"] if story else 0,
                "width": 640 if asset["kind"] == "image" else 0,
                "height": 360 if asset["kind"] == "image" else 0,
            }),
            "generator_metadata_json": (
                json.dumps(_valid_generator_metadata()) if story else "{}"
            ),
        }
    variant = manifest["chapters"][0]["variants"][0]
    return manifest, verified, {
        "foothills_parkway_all_variants:eastbound"
    }, {
        "foothills_parkway_all_variants:eastbound:"
        + variant["delivery_contract_sha256"]
    }


def _publish_v3(monkeypatch, manifest, verified, routes, deliveries):
    monkeypatch.setattr(manifest_v3, "validate_cultural_publication_scope", lambda *_: None)
    monkeypatch.setattr(manifest_v3, "validate_manifest_route_evidence", lambda *_a, **_k: None)
    monkeypatch.setattr(manifest_v3, "validate_manifest_operational_binding", lambda **_k: None)
    return normalize_original_manifest_v3(
        manifest,
        pack_id="original_moab_canyons_to_sky",
        title="Moab: Canyons to the Sky",
        version=3,
        normalize_v1=_passthrough_v1,
        publishing=True,
        verified_assets=verified,
        validated_selections=routes,
        validated_delivery_contracts=deliveries,
        route_evidence_document={},
    )


def _compiled_evidence_item(item, assets):
    artwork_id = item.get("artwork_asset_id")
    artwork = assets.get(artwork_id) if artwork_id else None
    return {
        "item_id": item["id"],
        "audio_asset_id": item["audio_asset_id"],
        "asset_sha256": assets[item["audio_asset_id"]]["sha256"],
        "asset_bytes": assets[item["audio_asset_id"]]["bytes"],
        "transcript_sha256": store.original_transcript_sha256(item["transcript"]),
        "manifest_duration_ms": int(math.floor(item["audio_duration_s"] * 1000 + 0.5)),
        "probed_duration_ms": int(math.floor(item["audio_duration_s"] * 1000 + 0.5)),
        "generator": _empty_generator_evidence(),
        "artwork": ({
            "asset_id": artwork_id,
            "asset_sha256": artwork["sha256"],
            "asset_bytes": artwork["bytes"],
            "width": 640,
            "height": 360,
        } if artwork else None),
    }


def _generic_compiled():
    manifest = _normalize()
    _with_test_assets(manifest)
    compiled = compile_original_manifest_v3_selection(
        manifest,
        chapter_id="foothills_parkway",
        variant_id="eastbound",
        normalize_v1=_passthrough_v1,
    )
    compiled["manifest"].update({
        "pack_id": "original_long_form_test",
        "version": 1,
        "manifest_id": "original_manifest_original_long_form_test_v1",
    })
    assets = {asset["id"]: asset for asset in compiled["manifest"]["assets"]}
    items = [*compiled["manifest"]["stops"], *compiled["selectable"]["items"]]
    compiled["audio_evidence"] = {
        "schema_version": 2,
        "source": "server_verified_publication_metadata",
        "items": sorted(
            (_compiled_evidence_item(item, assets) for item in items),
            key=lambda item: item["item_id"],
        ),
    }
    return compiled


def _compiled():
    """A complete RF selection matching the only checked delivery-evidence registry row."""
    compiled = _generic_compiled()
    preflight = json.loads((
        validation.REPO_ROOT
        / "originals/smokies/roaring_fork_trigger_preflight_v1.json"
    ).read_text(encoding="utf-8"))
    route_evidence = json.loads((
        validation.REPO_ROOT / "originals/smokies/official_route_evidence_v1.json"
    ).read_text(encoding="utf-8"))
    route = next(
        item for item in route_evidence["variants"]
        if item["chapter_id"] == "roaring_fork" and item["variant_id"] == "one_way"
    )
    coordinates = route["geometry"]["coordinates"]
    bounds = {
        "west": min(point[0] for point in coordinates),
        "south": min(point[1] for point in coordinates),
        "east": max(point[0] for point in coordinates),
        "north": max(point[1] for point in coordinates),
    }
    capacity_by_id = {
        item["id"]: item for item in preflight["capacity_admission_input"]
    }
    assets = []
    hard = []
    selectable = []
    hard_index = 0
    for entry in sorted(preflight["entries"], key=lambda item: item["stable_order"]):
        item_id = entry["id"]
        duration = 20.0 if entry["kind"] == "cue" else 60.0
        narration = {
            "id": f"audio_{item_id}",
            "kind": "narration",
            "path": f"originals/test/audio_{item_id}.mp3",
            "mime_type": "audio/mpeg",
            "bytes": 10_000 + entry["stable_order"],
            "sha256": hashlib.sha256(f"audio:{item_id}".encode()).hexdigest(),
        }
        artwork = {
            "id": f"art_{item_id}",
            "kind": "image",
            "path": f"originals/test/art_{item_id}.png",
            "mime_type": "image/png",
            "bytes": 20_000 + entry["stable_order"],
            "sha256": hashlib.sha256(f"art:{item_id}".encode()).hexdigest(),
        }
        assets.extend((narration, artwork))
        narrative = {
            "id": item_id,
            "sequence": entry["stable_order"],
            "title": entry["title"],
            "transcript": f"Reviewed narration for {entry['title']}.",
            "audio_asset_id": narration["id"],
            "audio_duration_s": duration,
            "artwork_asset_id": artwork["id"],
            "citations": copy.deepcopy(compiled["manifest"]["stops"][0]["citations"]),
        }
        if entry.get("projected_coordinate") is not None:
            narrative["coordinates"] = entry["projected_coordinate"]
        mode = entry["delivery"]["mode"]
        if mode == "hard_auto":
            hard_index += 1
            hard.append({
                **narrative,
                "sequence": hard_index,
                "coordinates": entry["projected_coordinate"],
                "trigger": entry["trigger"],
            })
            continue
        delivery = copy.deepcopy(entry["delivery"])
        if mode == "capacity_deeper":
            delivery["next_hard_auto_story_id"] = capacity_by_id[item_id][
                "next_hard_auto"
            ]["id"]
            narrative["trigger"] = entry["trigger"]
        elif (
            mode == "stopped_deeper"
            and delivery["availability"] == "at_landmark_user_confirmed_parked"
        ):
            delivery["availability_radius_m"] = 250
        narrative["delivery"] = delivery
        selectable.append(narrative)
    contract_hash = hashlib.sha256(json.dumps(
        [{"id": item["id"], "sequence": item["stable_order"], "mode": item["delivery"]["mode"]}
         for item in sorted(preflight["entries"], key=lambda value: value["stable_order"])],
        separators=(",", ":"), sort_keys=True,
    ).encode()).hexdigest()
    compiled["selection"] = {
        "validation_selection_id": "roaring_fork_all_variants",
        "chapter_id": "roaring_fork",
        "variant_id": "one_way",
        "delivery_contract_sha256": contract_hash,
    }
    compiled["manifest"].update({
        "pack_id": "great_smoky_mountains_ridges_rivers_living_memory",
        "version": 1,
        "manifest_id": "original_manifest_smokies_rf_test_v1",
        "route": {
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "distance_m": route["distance_m"],
            "duration_s": route["distance_m"] / (36 * 0.44704),
            "bounds": bounds,
        },
        "stops": hard,
        "assets": assets,
    })
    compiled["manifest"]["offline_map"].update({
        "region_id": "smokies_rf_test",
        "bounds": bounds,
    })
    compiled["selectable"] = {
        "schema_version": 1,
        "contract_id": "originals_long_form_delivery_v1",
        "delivery_contract_sha256": contract_hash,
        "items": selectable,
    }
    asset_map = {asset["id"]: asset for asset in assets}
    compiled["audio_evidence"] = {
        "schema_version": 2,
        "source": "server_verified_publication_metadata",
        "items": sorted(
            (_compiled_evidence_item(item, asset_map) for item in [*hard, *selectable]),
            key=lambda item: item["item_id"],
        ),
    }
    return compiled


def _with_test_assets(manifest):
    if not any(asset.get("kind") == "image" for asset in manifest["assets"]):
        manifest["assets"].append({
            "id": "test_shared_story_artwork",
            "kind": "image",
            "path": "originals/test/test_shared_story_artwork.png",
            "mime_type": "image/png",
            "bytes": 2_000,
            "sha256": hashlib.sha256(b"test shared story artwork").hexdigest(),
        })
    for index, asset in enumerate(manifest["assets"], start=1):
        asset["bytes"] = 1_000 + index
        asset["sha256"] = hashlib.sha256(asset["id"].encode("utf-8")).hexdigest()
        asset["path"] = f"originals/test/{asset['id']}"
    artwork_id = next(
        asset["id"] for asset in manifest["assets"] if asset["kind"] == "image"
    )
    for story in manifest.get("stories", []):
        story["artwork_asset_id"] = artwork_id
    return manifest


def _validation_manifest():
    manifest = _normalize()
    _with_test_assets(manifest)
    assets = {asset["id"]: asset for asset in manifest["assets"]}
    manifest["_validation_audio_evidence"] = {
        "schema_version": 2,
        "source": "server_verified_publication_metadata",
        "assets": sorted(({
            "asset_id": story["audio_asset_id"],
            "kind": "narration",
            "asset_sha256": assets[story["audio_asset_id"]]["sha256"],
            "asset_bytes": assets[story["audio_asset_id"]]["bytes"],
            "transcript_sha256": store.original_transcript_sha256(story["transcript"]),
            "probed_duration_ms": int(math.floor(story["audio_duration_s"] * 1000 + 0.5)),
            "generator": _empty_generator_evidence(),
        } for story in manifest["stories"]), key=lambda item: item["asset_id"]),
    }
    return manifest


def _validation_item():
    compiled = _compiled()
    selection = compiled["selection"]
    return {
        "key": (
            f"{selection['validation_selection_id']}:{selection['variant_id']}"
        ),
        "selection": selection,
        "manifest": compiled["manifest"],
        "delivery_contract_sha256": selection["delivery_contract_sha256"],
        "long_form_compiled": compiled,
    }


def test_long_form_cli_binds_contract_sources_audio_and_fixed_gates():
    compiled = _compiled()
    source_hash = trusted_originals_long_form_validator_source_sha256()
    report = run_originals_long_form_validation_cli(
        compiled,
        expected_validator_source_sha256=source_hash,
    )
    assert report["passed"] is True
    assert report["validator_source_sha256"] == source_hash
    assert report["delivery_contract_sha256"] == (
        compiled["selection"]["delivery_contract_sha256"]
    )
    assert report["audio"] == original_long_form_audio_binding(compiled)
    assert report["preflight"] == original_long_form_preflight_binding(compiled)
    assert report["gates"] == ORIGINAL_LONG_FORM_VALIDATION_GATES
    assert [item["speed_mph"] for item in report["characterization"]["speed_fixtures"]] == [
        15, 36, 65, 75,
    ]
    assert all(report["characterization"]["invariants"].values())
    assert report["delivery_metrics"]["duration_basis"] == (
        "server_probed_immutable_audio"
    )
    assert [
        item["speed_mph"] for item in report["delivery_metrics"]["speed_fixtures"]
    ] == [15, 36, 65, 75]
    assert all(
        item["route_end_backlog_audio_s"] <= 240
        and item["maximum_trigger_to_play_latency_s"] <= 180
        and item["within_limits"] is True
        for item in report["delivery_metrics"]["speed_fixtures"]
    )
    slow_metrics = report["delivery_metrics"]["speed_fixtures"][0]
    assert "rf_story_01" in slow_metrics["rejected_capacity_ids"]
    assert "rf_story_01" not in slow_metrics["admitted_capacity_ids"]


def test_checked_delivery_evidence_is_per_selection_and_binds_runtime_fields():
    with pytest.raises(OriginalValidationRunnerError, match="No checked"):
        original_long_form_preflight_binding(_generic_compiled())

    compiled = _compiled()
    baseline = original_long_form_preflight_binding(compiled)
    assert baseline["product_id"] == (
        "great_smoky_mountains_ridges_rivers_living_memory"
    )
    assert baseline["chapter_id"] == "roaring_fork"
    assert baseline["variant_id"] == "one_way"

    moved = _compiled()
    moved["selectable"]["items"][0]["coordinates"]["lat"] += 0.001
    with pytest.raises(OriginalValidationRunnerError, match="semantics drifted"):
        original_long_form_preflight_binding(moved)

    radius = _compiled()
    landmark = next(
        item for item in radius["selectable"]["items"]
        if item["id"] == "rf_story_06"
    )
    landmark["delivery"]["availability_radius_m"] = 500
    with pytest.raises(OriginalValidationRunnerError, match="semantics drifted"):
        original_long_form_preflight_binding(radius)

    wrong_variant = _compiled()
    wrong_variant["selection"]["variant_id"] = "reverse"
    with pytest.raises(OriginalValidationRunnerError, match="No checked"):
        original_long_form_preflight_binding(wrong_variant)


def test_long_form_source_hash_covers_actual_consumer_and_changes_on_runtime_drift(
    tmp_path,
    monkeypatch,
):
    required = {
        "db/original_manifest_v2.py",
        "db/original_manifest_v3.py",
        "db/original_entitlement_receipt.py",
        "db/originals_cultural_review.py",
        "db/originals_operational.py",
        "db/originals_route_evidence.py",
        "db/originals_validation.py",
        "db/store.py",
        "dashboard/server.py",
        "originals/smokies/roaring_fork_trigger_preflight_v1.json",
        "scripts/build_smokies_roaring_fork_trigger_preflight.py",
        "mobile/package.json",
        "mobile/package-lock.json",
        "mobile/components/originals/OriginalsMapPlayerSheet.tsx",
        "mobile/components/originals/OriginalArtwork.tsx",
        "mobile/components/originals/OriginalRouteMap.tsx",
        "mobile/components/originals/originalsUiService.ts",
        "mobile/components/originals/types.ts",
        "mobile/components/NativeMap/mapStyle.ts",
        "mobile/components/NativeMap/offlineManager.ts",
        "mobile/lib/originals/api.ts",
        "mobile/lib/originals/accessPolicy.ts",
        "mobile/lib/originals/accessStore.ts",
        "mobile/lib/originals/audioAdapter.ts",
        "mobile/lib/originals/audioAdapterState.ts",
        "mobile/lib/originals/audioCoordinator.ts",
        "mobile/lib/originals/bundleStore.ts",
        "mobile/lib/originals/manifestV2.ts",
        "mobile/lib/originals/manifestV3.ts",
        "mobile/lib/originals/longFormScheduler.ts",
        "mobile/lib/originals/session.ts",
        "mobile/lib/originals/sessionStore.ts",
        "mobile/lib/originals/runtime.tsx",
        "mobile/lib/originals/headlessController.ts",
        "mobile/lib/originals/headlessRuntime.ts",
        "mobile/lib/originals/locationAdapter.ts",
        "mobile/lib/originals/locationPolicy.ts",
        "mobile/lib/originals/locationQueue.ts",
        "mobile/lib/originals/mainMapNavigation.ts",
        "mobile/lib/originals/mapAdapter.ts",
        "mobile/lib/originals/nativeAudioSession.ts",
        "mobile/lib/originals/ownership.ts",
        "mobile/lib/originals/shareOriginal.ts",
        "mobile/lib/originals/clientCapabilities.ts",
        "mobile/lib/originals/expoFileAdapter.ts",
        "mobile/lib/originals/expoStores.ts",
        "mobile/lib/originals/fileAdapter.ts",
        "mobile/lib/originals/types.ts",
        "mobile/lib/originals/triggerEngine.ts",
        "mobile/lib/originals/triggerSimulation.ts",
        "mobile/lib/privacy/mapboxTelemetry.native.ts",
        "mobile/app/originals/[id].tsx",
        "mobile/scripts/validate-original-long-form.ts",
    }
    source_paths = validation.trusted_originals_long_form_validator_source_paths()
    configured = {path.as_posix() for path in source_paths}
    assert required <= configured
    for relative in source_paths:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(relative.as_posix(), encoding="utf-8")
    monkeypatch.setattr(validation, "REPO_ROOT", tmp_path)
    before = validation.trusted_originals_long_form_validator_source_sha256()
    runtime_path = tmp_path / "mobile/lib/originals/runtime.tsx"
    runtime_path.write_text("changed runtime", encoding="utf-8")
    after = validation.trusted_originals_long_form_validator_source_sha256()
    assert after != before
    ui_path = tmp_path / "mobile/components/originals/OriginalsMapPlayerSheet.tsx"
    ui_path.write_text("changed explicit-selection UI", encoding="utf-8")
    ui_hash = validation.trusted_originals_long_form_validator_source_sha256()
    assert ui_hash != after
    cultural_path = tmp_path / "db/originals_cultural_review.py"
    cultural_path.write_text("changed cultural publication gate", encoding="utf-8")
    assert validation.trusted_originals_long_form_validator_source_sha256() != ui_hash


def test_long_form_source_hash_closes_over_mobile_alias_dependencies(
    monkeypatch, tmp_path,
):
    root = tmp_path / "mobile" / "root.ts"
    dependency = tmp_path / "mobile" / "lib" / "offlineManager.ts"
    native_dependency = tmp_path / "mobile" / "lib" / "offlineManager.native.ts"
    ios_dependency = tmp_path / "mobile" / "lib" / "offlineManager.ios.ts"
    android_dependency = tmp_path / "mobile" / "lib" / "offlineManager.android.ts"
    root.parent.mkdir(parents=True, exist_ok=True)
    dependency.parent.mkdir(parents=True, exist_ok=True)
    root.write_text(
        'import { offlineReady } from "@/lib/offlineManager";\n'
        "export const ready = offlineReady;\n",
        encoding="utf-8",
    )
    dependency.write_text("export const offlineReady = true;\n", encoding="utf-8")
    native_dependency.write_text("export const offlineReady = true;\n", encoding="utf-8")
    ios_dependency.write_text("export const offlineReady = true;\n", encoding="utf-8")
    android_dependency.write_text("export const offlineReady = true;\n", encoding="utf-8")
    monkeypatch.setattr(validation, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(
        validation,
        "TRUSTED_LONG_FORM_VALIDATOR_SOURCE_PATHS",
        (Path("mobile/root.ts"),),
    )
    paths = validation.trusted_originals_long_form_validator_source_paths()
    assert Path("mobile/lib/offlineManager.ts") in paths
    assert Path("mobile/lib/offlineManager.native.ts") in paths
    assert Path("mobile/lib/offlineManager.ios.ts") in paths
    assert Path("mobile/lib/offlineManager.android.ts") in paths
    before = validation.trusted_originals_long_form_validator_source_sha256()
    native_dependency.write_text("export const offlineReady = false;\n", encoding="utf-8")
    assert validation.trusted_originals_long_form_validator_source_sha256() != before


@pytest.mark.parametrize(
    "mutator,match",
    [
        (
            lambda report: report.update(validator_source_sha256="f" * 64),
            "source hash",
        ),
        (
            lambda report: report["gates"].update(capacity_guard_s=29),
            "safety gate",
        ),
        (
            lambda report: report["audio"].update(binding_sha256="f" * 64),
            "narration binding",
        ),
        (
            lambda report: report["characterization"]["invariants"].update(
                parked_requires_explicit_confirmation=False,
            ),
            "invariants",
        ),
        (
            lambda report: report["characterization"]["speed_fixtures"].pop(),
            "speed fixtures",
        ),
        (
            lambda report: report["preflight"].update(artifact_sha256="f" * 64),
            "preflight binding",
        ),
        (
            lambda report: report["delivery_metrics"]["speed_fixtures"][0].update(
                route_end_backlog_audio_s=241,
            ),
            "delivery timing",
        ),
    ],
)
def test_long_form_report_rejects_hash_gate_and_runtime_drift(mutator, match):
    compiled = _compiled()
    source_hash = trusted_originals_long_form_validator_source_sha256()
    report = run_originals_long_form_validation_cli(
        compiled,
        expected_validator_source_sha256=source_hash,
    )
    mutator(report)
    with pytest.raises(OriginalValidationRunnerError, match=match):
        normalize_original_long_form_validation_output(
            report,
            compiled=compiled,
            expected_validator_source_sha256=source_hash,
        )


def test_long_form_validation_rejects_missing_or_changed_real_audio():
    compiled = _compiled()
    narration_id = compiled["selectable"]["items"][0]["audio_asset_id"]
    compiled["manifest"]["assets"] = [
        asset for asset in compiled["manifest"]["assets"]
        if asset["id"] != narration_id
    ]
    with pytest.raises(OriginalValidationRunnerError, match="verified narration asset"):
        original_long_form_audio_binding(compiled)

    compiled = _compiled()
    narration_id = compiled["selectable"]["items"][0]["audio_asset_id"]
    next(asset for asset in compiled["manifest"]["assets"] if asset["id"] == narration_id)[
        "sha256"
    ] = "f" * 64
    with pytest.raises(OriginalValidationRunnerError, match="verified narration evidence"):
        original_long_form_audio_binding(compiled)

    compiled = _compiled()
    compiled["audio_evidence"]["items"][0]["probed_duration_ms"] += 30_000
    with pytest.raises(OriginalValidationRunnerError, match="verified narration evidence"):
        original_long_form_audio_binding(compiled)


def test_long_form_validation_rejects_authoring_duration_without_probe():
    compiled = _compiled()
    compiled.pop("audio_evidence")
    with pytest.raises(OriginalValidationRunnerError, match="server-verified"):
        original_long_form_audio_binding(compiled)


def test_long_form_cli_computes_and_rejects_real_audio_timing_overage():
    compiled = _compiled()
    first_hard = compiled["manifest"]["stops"][0]
    first_hard["audio_duration_s"] = 3_600
    evidence = next(
        item for item in compiled["audio_evidence"]["items"]
        if item["item_id"] == first_hard["id"]
    )
    evidence["manifest_duration_ms"] = 3_600_000
    evidence["probed_duration_ms"] = 3_600_000
    with pytest.raises(OriginalValidationRunnerError, match="delivery timing"):
        run_originals_long_form_validation_cli(
            compiled,
            expected_validator_source_sha256=(
                trusted_originals_long_form_validator_source_sha256()
            ),
        )


def test_long_form_validation_rejects_optional_transcript_generator_and_license_drift():
    compiled = _compiled()
    optional_id = compiled["selectable"]["items"][0]["id"]
    evidence = next(
        item for item in compiled["audio_evidence"]["items"]
        if item["item_id"] == optional_id
    )
    evidence["transcript_sha256"] = "f" * 64
    with pytest.raises(OriginalValidationRunnerError, match="verified narration evidence"):
        original_long_form_audio_binding(compiled)

    compiled = _compiled()
    evidence = next(
        item for item in compiled["audio_evidence"]["items"]
        if item["item_id"] == optional_id
    )
    evidence["generator"] = {
        "generated": True,
        "provider": "cartesia",
        "model_id": "sonic-3.5-2026-05-04",
        "voice_id": "test-voice",
        "commercial_license_attested": False,
        "metadata_sha256": "a" * 64,
    }
    with pytest.raises(OriginalValidationRunnerError, match="commercial license"):
        original_long_form_audio_binding(compiled)


def test_long_form_validation_binds_and_rejects_referenced_optional_artwork_drift():
    compiled = _compiled()
    optional = compiled["selectable"]["items"][0]
    artwork = {
        "id": "test_optional_artwork",
        "kind": "image",
        "path": "originals/test/test_optional_artwork.jpg",
        "mime_type": "image/jpeg",
        "bytes": 2_000,
        "sha256": hashlib.sha256(b"test optional artwork").hexdigest(),
    }
    compiled["manifest"]["assets"].append(artwork)
    optional["artwork_asset_id"] = artwork["id"]
    evidence = next(
        item for item in compiled["audio_evidence"]["items"]
        if item["item_id"] == optional["id"]
    )
    evidence["artwork"] = {
        "asset_id": artwork["id"],
        "asset_sha256": artwork["sha256"],
        "asset_bytes": artwork["bytes"],
        "width": 640,
        "height": 360,
    }
    assert original_long_form_audio_binding(compiled)["verified_artwork_count"] == 13
    evidence["artwork"]["width"] = 319
    with pytest.raises(OriginalValidationRunnerError, match="artwork"):
        original_long_form_audio_binding(compiled)


def test_store_builds_private_duration_evidence_only_from_verified_upload_metadata():
    manifest = _with_test_assets(_normalize())
    stories_by_asset = {story["audio_asset_id"]: story for story in manifest["stories"]}
    verified = {}
    for asset in manifest["assets"]:
        story = stories_by_asset.get(asset["id"])
        verified[asset["id"]] = {
            "kind": asset["kind"],
            "mime_type": asset["mime_type"],
            "byte_count": asset["bytes"],
            "sha256": asset["sha256"],
            "transcript_sha256": (
                store.original_transcript_sha256(story["transcript"])
                if story else None
            ),
            "media_metadata_json": json.dumps({
                "duration_s": story["audio_duration_s"] if story else 0,
                "width": 640 if asset["kind"] == "image" else 0,
                "height": 360 if asset["kind"] == "image" else 0,
            }),
            "generator_metadata_json": (
                json.dumps(_valid_generator_metadata()) if story else "{}"
            ),
        }
    public_copy = copy.deepcopy(manifest)
    store._bind_authored_original_preview_assets(
        public_copy,
        verified,
        "original_long_form_test",
        include_validation_audio_evidence=False,
    )
    assert "_validation_audio_evidence" not in public_copy

    validation_copy = copy.deepcopy(manifest)
    store._bind_authored_original_preview_assets(
        validation_copy,
        verified,
        "original_long_form_test",
        include_validation_audio_evidence=True,
    )
    evidence = validation_copy["_validation_audio_evidence"]
    assert evidence["source"] == "server_verified_publication_metadata"
    assert len(evidence["assets"]) == len(validation_copy["stories"]) + 1
    narration_evidence = [
        item for item in evidence["assets"] if item["kind"] == "narration"
    ]
    assert all(item["probed_duration_ms"] > 0 for item in narration_evidence)
    assert all(item["generator"]["generated"] for item in narration_evidence)
    assert all(
        item["generator"]["commercial_license_attested"]
        for item in narration_evidence
    )


def test_store_rejects_unattested_generated_optional_narration():
    manifest = _with_test_assets(_normalize())
    stories_by_asset = {story["audio_asset_id"]: story for story in manifest["stories"]}
    verified = {}
    for asset in manifest["assets"]:
        story = stories_by_asset.get(asset["id"])
        verified[asset["id"]] = {
            "kind": asset["kind"],
            "mime_type": asset["mime_type"],
            "byte_count": asset["bytes"],
            "sha256": asset["sha256"],
            "transcript_sha256": (
                store.original_transcript_sha256(story["transcript"])
                if story else None
            ),
            "media_metadata_json": json.dumps({
                "duration_s": story["audio_duration_s"] if story else 0,
                "width": 640 if asset["kind"] == "image" else 0,
                "height": 360 if asset["kind"] == "image" else 0,
            }),
            "generator_metadata_json": json.dumps({
                "provider": "cartesia",
                "model_id": "sonic-3.5-2026-05-04",
                "voice_id": "test-voice",
                "license_status": "unverified",
            }) if story else "{}",
        }
    with pytest.raises(ValueError, match="license attestation"):
        store._bind_authored_original_preview_assets(
            manifest,
            verified,
            "original_long_form_test",
            include_validation_audio_evidence=True,
        )


def test_store_rejects_stale_v3_optional_story_source_before_validation():
    manifest = _with_test_assets(_normalize())
    optional_id = manifest["chapters"][0]["variants"][0]["selectable_refs"][0][
        "story_id"
    ]
    next(story for story in manifest["stories"] if story["id"] == optional_id)[
        "citations"
    ][0]["reviewed_at"] = "2025-01-01"
    stories_by_asset = {story["audio_asset_id"]: story for story in manifest["stories"]}
    verified = {}
    for asset in manifest["assets"]:
        story = stories_by_asset.get(asset["id"])
        verified[asset["id"]] = {
            "kind": asset["kind"],
            "mime_type": asset["mime_type"],
            "byte_count": asset["bytes"],
            "sha256": asset["sha256"],
            "transcript_sha256": (
                store.original_transcript_sha256(story["transcript"])
                if story else None
            ),
            "media_metadata_json": json.dumps({
                "duration_s": story["audio_duration_s"] if story else 0,
                "width": 640 if asset["kind"] == "image" else 0,
                "height": 360 if asset["kind"] == "image" else 0,
            }),
            "generator_metadata_json": "{}",
        }
    with pytest.raises(ValueError, match="source review is too old"):
        store._bind_authored_original_preview_assets(
            manifest,
            verified,
            "original_long_form_test",
            include_validation_audio_evidence=True,
        )


def test_v3_normalizer_applies_full_selectable_publication_parity(monkeypatch):
    manifest, verified, routes, deliveries = _publication_input()
    normalized, _ = _publish_v3(
        monkeypatch, manifest, verified, routes, deliveries,
    )
    assert normalized["schema_version"] == 3


@pytest.mark.parametrize(
    "mutation,match",
    [
        (
            lambda manifest, verified, optional: optional["citations"][0].update(
                reviewed_at="2025-01-01"
            ),
            "source review is too old",
        ),
        (
            lambda manifest, verified, optional: verified[
                optional["audio_asset_id"]
            ].update(transcript_sha256="f" * 64),
            "reviewed transcript",
        ),
        (
            lambda manifest, verified, optional: verified[
                optional["audio_asset_id"]
            ].update(generator_metadata_json=json.dumps({
                **_valid_generator_metadata(), "license_status": "unverified",
            })),
            "generator or commercial license",
        ),
        (
            lambda manifest, verified, optional: optional.pop(
                "artwork_asset_id", None
            ),
            "published artwork",
        ),
        (
            lambda manifest, verified, optional: verified[
                optional["artwork_asset_id"]
            ].update(media_metadata_json=json.dumps({"width": 319, "height": 180})),
            "artwork is too small",
        ),
    ],
)
def test_v3_normalizer_rejects_selectable_publication_parity_drift(
    monkeypatch, mutation, match,
):
    manifest, verified, routes, deliveries = _publication_input()
    optional_id = manifest["chapters"][0]["variants"][0]["selectable_refs"][0][
        "story_id"
    ]
    optional = next(story for story in manifest["stories"] if story["id"] == optional_id)
    mutation(manifest, verified, optional)
    with pytest.raises(manifest_v3.OriginalManifestV3Error, match=match):
        _publish_v3(monkeypatch, manifest, verified, routes, deliveries)


def test_store_accepts_delivery_contract_only_from_separate_long_form_runner():
    item = _validation_item()
    source_hash = store.trusted_originals_validator_source_sha256()
    long_source_hash = store.trusted_complete_originals_long_form_validator_source_sha256()
    def passing_hard_runner(compiled, **kwargs):
        report = store.run_originals_validation_cli(compiled, **kwargs)
        for scenario in report["scenarios"]:
            if scenario["required"]:
                scenario["passed"] = True
                scenario["issues"] = []
        report["passed"] = True
        return report

    result = store._execute_original_validation_selection(
        item,
        runner=passing_hard_runner,
        long_form_runner=store.run_complete_originals_long_form_validation_cli,
        route_network_validator=lambda compiled, **_kwargs: {
            "geometry_sha256": store.original_route_geometry_sha256(
                compiled["route"]["geometry"]["coordinates"],
            ),
        },
        validator_source_sha256=source_hash,
        long_form_validator_source_sha256=long_source_hash,
    )
    assert result["validated_delivery_contract"] == (
        f"{item['key']}:{item['delivery_contract_sha256']}"
    )
    assert result["delivery_validation"]["passed"] is True
    failed_aggregate = store._aggregate_original_validation_selection_results(
        [{**result, "passed": False}], execution_errors=False,
    )
    assert failed_aggregate["summary"]["validated_delivery_contracts"] == []
    fully_passing = {**result, "passed": True, "issues": []}
    aggregate = store._aggregate_original_validation_selection_results(
        [fully_passing], execution_errors=False,
    )
    assert aggregate["summary"]["validated_delivery_contracts"] == [
        result["validated_delivery_contract"],
    ]


def test_store_uses_the_hash_bound_rf_validation_target_without_reporting_its_url(
    monkeypatch,
):
    item = _validation_item()
    item["selection"]["delivery_contract_sha256"] = (
        "9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6"
    )
    item["long_form_compiled"]["selection"]["delivery_contract_sha256"] = (
        item["selection"]["delivery_contract_sha256"]
    )
    item["long_form_compiled"]["selectable"]["delivery_contract_sha256"] = (
        item["selection"]["delivery_contract_sha256"]
    )
    coordinates = item["manifest"]["route"]["geometry"]["coordinates"]
    target_url = "https://south-tn.internal.test"
    configured = json.dumps([{
        "id": "south_tn",
        "url": target_url,
        "bounds": {
            "s": min(point[1] for point in coordinates) - 0.01,
            "w": min(point[0] for point in coordinates) - 0.01,
            "n": max(point[1] for point in coordinates) + 0.01,
            "e": max(point[0] for point in coordinates) + 0.01,
        },
    }])
    monkeypatch.setattr(store.settings, "valhalla_area_urls", configured)
    expected = complete_validation.complete_trusted_original_route_network_validation_target(
        item,
        configured_area_urls=configured,
    )
    captured = {}

    def network_validator(manifest, *, valhalla_url):
        captured["url"] = valhalla_url
        return {
            "geometry_sha256": store.original_route_geometry_sha256(
                manifest["route"]["geometry"]["coordinates"],
            ),
            "override": None,
        }

    result = store._execute_original_validation_selection(
        item,
        runner=store.run_originals_validation_cli,
        long_form_runner=store.run_complete_originals_long_form_validation_cli,
        route_network_validator=network_validator,
        validator_source_sha256=store.trusted_originals_validator_source_sha256(),
        long_form_validator_source_sha256=(
            store.trusted_complete_originals_long_form_validator_source_sha256()
        ),
        expected_route_network_target=expected["evidence"],
    )

    assert captured["url"] == target_url
    assert result["summary"]["route"]["network"]["validation_target"] == (
        expected["evidence"]
    )
    assert target_url not in json.dumps(result, sort_keys=True)


def test_hard_only_route_result_can_never_synthesize_delivery_validation():
    result = {
        "key": "selection:variant",
        "selection": {"chapter_id": "chapter", "variant_id": "variant"},
        "engine_version": store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
        "passed": True,
        "summary": {"required": 1, "passed": 1, "failed": 0, "stop_count": 1},
        "scenarios": [],
        "issues": [],
    }
    aggregate = store._aggregate_original_validation_selection_results(
        [result], execution_errors=False,
    )
    assert "validated_delivery_contracts" not in aggregate["summary"]


def test_store_rejects_long_form_source_hash_drift_even_after_hard_pass():
    item = _validation_item()
    source_hash = store.trusted_originals_validator_source_sha256()
    real_long_hash = store.trusted_complete_originals_long_form_validator_source_sha256()

    def drifted_runner(compiled, **_kwargs):
        report = store.run_complete_originals_long_form_validation_cli(
            compiled,
            expected_validator_source_sha256=real_long_hash,
        )
        report["validator_source_sha256"] = "f" * 64
        return report

    def passing_hard_runner(compiled, **kwargs):
        report = store.run_originals_validation_cli(compiled, **kwargs)
        for scenario in report["scenarios"]:
            if scenario["required"]:
                scenario["passed"] = True
                scenario["issues"] = []
        report["passed"] = True
        return report

    with pytest.raises(OriginalValidationRunnerError, match="source hash"):
        store._execute_original_validation_selection(
            item,
            runner=passing_hard_runner,
            long_form_runner=drifted_runner,
            route_network_validator=lambda compiled, **_kwargs: {
                "geometry_sha256": store.original_route_geometry_sha256(
                    compiled["route"]["geometry"]["coordinates"],
                ),
            },
            validator_source_sha256=source_hash,
            long_form_validator_source_sha256=real_long_hash,
        )
