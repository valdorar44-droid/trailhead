from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import shutil

import pytest

from db import originals_complete_validation as validation
from db import originals_remaining_validation
from db import originals_validation as historical_validation
from tests.test_originals_long_form_validation import _compiled as _rf_compiled
from tests.test_smokies_remaining_delivery_readiness import (
    _area_config,
    _compiled as _remaining_compiled,
)


ROOT = Path(__file__).resolve().parents[1]
RF_CONTRACT = "9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6"
IMMUTABLE_HASHES = dict(validation.IMMUTABLE_EVIDENCE_SHA256)


def _all_compiled() -> list[dict]:
    return [
        _remaining_compiled(key)
        for key in originals_remaining_validation.REGISTRY
    ] + [_rf_compiled()]


def _inventory_items() -> list[dict]:
    items = []
    for index, compiled in enumerate(_all_compiled(), start=1):
        selection = compiled["selection"]
        contract = hashlib.sha256(
            f"{selection['chapter_id']}:{selection['variant_id']}:{index}".encode()
        ).hexdigest()
        selection["delivery_contract_sha256"] = contract
        compiled["selectable"]["delivery_contract_sha256"] = contract
        items.append({
            "manifest": compiled["manifest"],
            "selection": selection,
            "long_form_compiled": compiled,
            "delivery_contract_sha256": contract,
        })
    return items


def _runnable_remaining_compiled(key: tuple[str, str, str]) -> dict:
    checked = _remaining_compiled(key)
    runnable = copy.deepcopy(_rf_compiled())
    coordinates = checked["manifest"]["route"]["geometry"]["coordinates"]
    bounds = {
        "west": min(point[0] for point in coordinates),
        "south": min(point[1] for point in coordinates),
        "east": max(point[0] for point in coordinates),
        "north": max(point[1] for point in coordinates),
    }
    citation = copy.deepcopy(runnable["manifest"]["stops"][0]["citations"])
    artwork_id = "complete_validation_test_artwork"
    artwork_sha = hashlib.sha256(artwork_id.encode()).hexdigest()
    assets = [{
        "id": artwork_id,
        "kind": "image",
        "path": f"originals/test/{artwork_id}.png",
        "mime_type": "image/png",
        "bytes": 2_000,
        "sha256": artwork_sha,
    }]
    evidence = []

    def hydrate(item: dict, sequence: int | None = None) -> dict:
        item_id = item["id"]
        asset_id = f"audio_{item_id}"
        asset_sha = hashlib.sha256(asset_id.encode()).hexdigest()
        assets.append({
            "id": asset_id,
            "kind": "narration",
            "path": f"originals/test/{asset_id}.mp3",
            "mime_type": "audio/mpeg",
            "bytes": 10_000 + len(assets),
            "sha256": asset_sha,
        })
        hydrated = {
            **copy.deepcopy(item),
            "title": item_id.replace("_", " ").title(),
            "audio_asset_id": asset_id,
            "audio_duration_s": 60,
            "artwork_asset_id": artwork_id,
            "citations": copy.deepcopy(citation),
        }
        if sequence is not None:
            hydrated["sequence"] = sequence
        evidence.append({
            "item_id": item_id,
            "audio_asset_id": asset_id,
            "asset_sha256": asset_sha,
            "asset_bytes": assets[-1]["bytes"],
            "transcript_sha256": hashlib.sha256(
                " ".join(item["transcript"].split()).encode()
            ).hexdigest(),
            "manifest_duration_ms": 60_000,
            "probed_duration_ms": 60_000,
            "generator": {
                "generated": False,
                "provider": None,
                "model_id": None,
                "voice_id": None,
                "commercial_license_attested": False,
                "metadata_sha256": hashlib.sha256(b"{}").hexdigest(),
            },
            "artwork": {
                "asset_id": artwork_id,
                "asset_sha256": artwork_sha,
                "asset_bytes": 2_000,
                "width": 640,
                "height": 360,
            },
        })
        return hydrated

    hard = [
        hydrate(item, index)
        for index, item in enumerate(checked["manifest"]["stops"], start=1)
    ]
    selectable = [hydrate(item) for item in checked["selectable"]["items"]]
    contract = "a" * 64
    runnable["selection"] = {
        "validation_selection_id": f"smokies_{key[1]}_all_variants",
        "chapter_id": key[1],
        "variant_id": key[2],
        "delivery_contract_sha256": contract,
    }
    runnable["manifest"].update({
        "pack_id": key[0],
        "manifest_id": f"complete_validation_{key[1]}_{key[2]}",
        "title": f"Complete validation {key[1]} {key[2]}",
        "route": {
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "distance_m": checked["manifest"]["route"]["distance_m"],
            "duration_s": checked["manifest"]["route"]["distance_m"] / (36 * 0.44704),
            "bounds": bounds,
        },
        "stops": hard,
        "assets": assets,
    })
    runnable["manifest"]["offline_map"].update({
        "region_id": f"complete_validation_{key[1]}_{key[2]}",
        "bounds": bounds,
    })
    runnable["selectable"] = {
        "schema_version": 1,
        "contract_id": "originals_long_form_delivery_v1",
        "delivery_contract_sha256": contract,
        "items": selectable,
    }
    runnable["audio_evidence"] = {
        "schema_version": 2,
        "source": "server_verified_publication_metadata",
        "items": sorted(evidence, key=lambda item: item["item_id"]),
    }
    return runnable


def _copy_paths(root: Path, paths: set[Path]) -> None:
    for relative in paths:
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, destination)


def test_registry_is_exactly_six_without_fallback_or_duplicate_paths() -> None:
    registry = validation._validated_registry()
    assert set(registry) == validation.EXPECTED_SELECTION_KEYS
    assert len(registry) == 6
    assert len({row["readiness_path"] for row in registry.values()}) == 6
    assert len({row["target_path"] for row in registry.values()}) == 6
    assert sum(row["kind"] == "roaring_fork" for row in registry.values()) == 1
    assert sum(row["kind"] == "remaining" for row in registry.values()) == 5


def test_all_six_preflight_bindings_match_exact_immutable_semantics() -> None:
    bindings = [
        validation.complete_original_long_form_preflight_binding(compiled)
        for compiled in _all_compiled()
    ]
    assert {
        (row["product_id"], row["chapter_id"], row["variant_id"])
        for row in bindings
    } == validation.EXPECTED_SELECTION_KEYS
    assert len({row["semantic_contract_sha256"] for row in bindings}) == 6
    for binding in bindings:
        assert binding["readiness_artifact_sha256"] == IMMUTABLE_HASHES[
            Path(binding["readiness_artifact_path"])
        ]
        if binding["chapter_id"] == "roaring_fork":
            assert binding["artifact_sha256"] == IMMUTABLE_HASHES[
                validation.RF_PREFLIGHT
            ]
            assert binding["semantic_contract_sha256"] == (
                "dca96c14e161c9fe35c2398f27be8d64fd8e35b02716b338dd5c3fbfde35da59"
            )
        else:
            assert binding["real_audio_validation_required"] is True
            assert binding["publication_authorized"] is False


@pytest.mark.parametrize("key", list(originals_remaining_validation.REGISTRY))
def test_mobile_runner_dispatches_each_remaining_selection_through_complete_registry(
    key: tuple[str, str, str],
) -> None:
    compiled = _runnable_remaining_compiled(key)
    source_sha256 = validation.trusted_complete_originals_long_form_validator_source_sha256()
    report = validation.run_complete_originals_long_form_validation_cli(
        compiled,
        expected_validator_source_sha256=source_sha256,
    )
    assert report["passed"] is True
    assert report["validator_source_sha256"] == source_sha256
    assert (
        report["preflight"]["product_id"],
        report["preflight"]["chapter_id"],
        report["preflight"]["variant_id"],
    ) == key


def test_all_six_route_targets_resolve_only_exact_authorized_inputs() -> None:
    compiled_rows = _all_compiled()
    rf = next(
        row for row in compiled_rows
        if row["selection"]["chapter_id"] == "roaring_fork"
    )
    rf["selection"]["delivery_contract_sha256"] = RF_CONTRACT
    results = [
        validation.complete_trusted_original_route_network_validation_target(
            compiled,
            configured_area_urls=_area_config(),
        )
        for compiled in compiled_rows
    ]
    assert len(results) == 6
    assert all(result["valhalla_url"] == "https://south-tn.validation.invalid" for result in results)
    assert all("south-tn.validation.invalid" not in json.dumps(result["evidence"]) for result in results)
    for compiled, result in zip(compiled_rows, results, strict=True):
        evidence = result["evidence"]
        assert evidence["geometry_sha256"] == historical_validation.original_route_geometry_sha256(
            compiled["manifest"]["route"]["geometry"]["coordinates"]
        )
        assert evidence["delivery_contract_sha256"] == compiled["selection"][
            "delivery_contract_sha256"
        ]
        assert evidence["validation_only"] is True
        assert evidence["draft_mutated"] is False
        assert evidence["global_config_mutated"] is False
        assert evidence["public_release_authorized"] is False


def test_unknown_missing_and_duplicate_registry_states_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    unknown = _rf_compiled()
    unknown["selection"]["chapter_id"] = "unknown_chapter"
    with pytest.raises(validation.OriginalValidationRunnerError, match="No checked complete"):
        validation.complete_original_long_form_preflight_binding(unknown)
    with pytest.raises(validation.OriginalValidationRunnerError, match="No checked complete"):
        validation.complete_trusted_original_route_network_validation_target(
            unknown,
            configured_area_urls=_area_config(),
        )
    assert validation.complete_trusted_original_route_network_validation_target(
        {"manifest": {"pack_id": "legacy"}, "selection": None},
        configured_area_urls="",
    ) is None
    assert validation.complete_trusted_original_route_network_validation_target(
        {
            "manifest": {"pack_id": "another_original"},
            "selection": {"chapter_id": "chapter", "variant_id": "variant"},
        },
        configured_area_urls="",
    ) is None

    original = validation.COMPLETE_LONG_FORM_EVIDENCE_ROWS
    monkeypatch.setattr(validation, "COMPLETE_LONG_FORM_EVIDENCE_ROWS", original[1:])
    with pytest.raises(validation.OriginalValidationRunnerError, match="incomplete or duplicated"):
        validation._validated_registry()
    monkeypatch.setattr(validation, "COMPLETE_LONG_FORM_EVIDENCE_ROWS", (
        original[0],
        {**original[1], "readiness_path": original[0]["readiness_path"]},
        *original[2:],
    ))
    with pytest.raises(validation.OriginalValidationRunnerError, match="incomplete or duplicated"):
        validation._validated_registry()
    monkeypatch.setattr(validation, "COMPLETE_LONG_FORM_EVIDENCE_ROWS", (
        original[0],
        {**original[1], "readiness_path": original[0]["target_path"]},
        *original[2:],
    ))
    with pytest.raises(validation.OriginalValidationRunnerError, match="incomplete or duplicated"):
        validation._validated_registry()


@pytest.mark.parametrize(
    "mutation",
    [
        lambda rows: rows[:1],
        lambda rows: rows[:-1],
        lambda rows: [*rows[:-1], copy.deepcopy(rows[0])],
        lambda rows: [
            *rows,
            {
                **copy.deepcopy(rows[0]),
                "manifest": {"pack_id": validation.PRODUCT_ID},
                "selection": {
                    **copy.deepcopy(rows[0]["selection"]),
                    "chapter_id": "extra_chapter",
                    "variant_id": "extra_variant",
                },
            },
        ],
    ],
    ids=["partial", "missing", "duplicate", "extra"],
)
def test_complete_product_report_inventory_fails_closed(
    mutation,
) -> None:
    with pytest.raises(
        validation.OriginalValidationRunnerError,
        match="exactly six|missing, extra, or duplicated",
    ):
        validation.require_complete_original_validation_selection_inventory(
            {"schema_version": 3, "pack_id": validation.PRODUCT_ID},
            mutation(_inventory_items()),
        )


def test_complete_product_report_inventory_preserves_other_manifest_families() -> None:
    partial = _inventory_items()[:1]
    validation.require_complete_original_validation_selection_inventory(
        {"schema_version": 2, "pack_id": validation.PRODUCT_ID},
        partial,
    )
    validation.require_complete_original_validation_selection_inventory(
        {"schema_version": 3, "pack_id": "another_original"},
        partial,
    )


def test_semantic_transcript_geometry_and_contract_drift_fail_closed() -> None:
    key = next(iter(originals_remaining_validation.REGISTRY))
    semantic = _remaining_compiled(key)
    semantic["manifest"]["stops"][0]["trigger"]["enter_radius_m"] += 1
    with pytest.raises(validation.OriginalValidationRunnerError, match="semantics drifted"):
        validation.complete_original_long_form_preflight_binding(semantic)
    transcript = _remaining_compiled(key)
    transcript["manifest"]["stops"][0]["transcript"] += " changed"
    with pytest.raises(validation.OriginalValidationRunnerError, match="narration drifted"):
        validation.complete_original_long_form_preflight_binding(transcript)
    contract = _remaining_compiled(key)
    contract["selection"]["delivery_contract_sha256"] = "not-a-hash"
    with pytest.raises(validation.OriginalValidationRunnerError, match="invalid input"):
        validation.complete_trusted_original_route_network_validation_target(
            contract,
            configured_area_urls=_area_config(),
        )


@pytest.mark.parametrize("kind", ["readiness", "target"])
def test_any_immutable_readiness_or_target_byte_drift_fails_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    paths = set(IMMUTABLE_HASHES)
    _copy_paths(tmp_path, paths)
    row = validation.COMPLETE_LONG_FORM_EVIDENCE_ROWS[0]
    relative = row[f"{kind}_path"]
    path = tmp_path / relative
    path.write_bytes(path.read_bytes() + b"\n")
    monkeypatch.setattr(validation, "REPO_ROOT", tmp_path)
    with pytest.raises(validation.OriginalValidationRunnerError, match="immutable evidence drifted"):
        validation.complete_original_long_form_preflight_binding(
            _remaining_compiled(row["key"])
        )


def test_current_complete_source_closure_is_distinct_and_drift_sensitive(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ordered_paths = validation.trusted_complete_originals_long_form_validator_source_paths()
    paths = set(ordered_paths)
    assert list(ordered_paths) == sorted(paths, key=lambda path: path.as_posix())
    assert len(ordered_paths) == len(paths)
    assert Path("db/originals_complete_validation.py") in paths
    assert Path("db/originals_remaining_validation.py") in paths
    assert Path("db/store.py") in paths
    assert Path("mobile/scripts/validate-original-long-form.ts") in paths
    assert Path("mobile/lib/originals/longFormValidationEvidence.ts") in paths
    assert set(IMMUTABLE_HASHES) <= paths
    framed = hashlib.sha256()
    for relative in ordered_paths:
        content = (ROOT / relative).read_bytes()
        framed.update(relative.as_posix().encode("utf-8"))
        framed.update(b"\0")
        framed.update(str(len(content)).encode("ascii"))
        framed.update(b"\0")
        framed.update(content)
        framed.update(b"\0")
    assert framed.hexdigest() == (
        validation.trusted_complete_originals_long_form_validator_source_sha256()
    )
    _copy_paths(tmp_path, paths)
    monkeypatch.setattr(validation, "REPO_ROOT", tmp_path)
    before = validation.trusted_complete_originals_long_form_validator_source_sha256()
    source = tmp_path / "mobile/lib/originals/longFormValidationEvidence.ts"
    source.write_bytes(source.read_bytes() + b"\n// drift\n")
    after = validation.trusted_complete_originals_long_form_validator_source_sha256()
    assert after != before
    source.unlink()
    with pytest.raises(
        validation.OriginalValidationRunnerError,
        match="unavailable|unresolved local import",
    ):
        validation.trusted_complete_originals_long_form_validator_source_sha256()


def test_current_complete_source_closure_rejects_unresolved_real_local_imports(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = set(validation.trusted_complete_originals_long_form_validator_source_paths())
    _copy_paths(tmp_path, paths)
    monkeypatch.setattr(validation, "REPO_ROOT", tmp_path)
    source = tmp_path / "mobile/lib/originals/longFormValidationEvidence.ts"
    source.write_text(
        source.read_text(encoding="utf-8")
        + "\n// import './missing-comment-only';"
        + "\n/* require('./missing-block-comment-only'); */"
        + "\nconst importExample = \"import './missing-string-only'\";\n",
        encoding="utf-8",
    )
    assert len(validation.trusted_complete_originals_long_form_validator_source_paths()) == len(paths)
    source.write_text(
        source.read_text(encoding="utf-8")
        + "\nimport './missingCompleteValidationDependency';\n",
        encoding="utf-8",
    )
    with pytest.raises(
        validation.OriginalValidationRunnerError,
        match="unresolved local import",
    ):
        validation.trusted_complete_originals_long_form_validator_source_paths()


def test_rf_history_and_all_remaining_artifacts_are_byte_exact() -> None:
    assert len(IMMUTABLE_HASHES) == 15
    for relative, expected_sha256 in IMMUTABLE_HASHES.items():
        assert hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() == expected_sha256


def test_store_material_creation_binds_six_preflights_targets_and_78_scenarios(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from db import store

    compiled_rows = _all_compiled()
    items = []
    for index, compiled in enumerate(compiled_rows, start=1):
        selection = compiled["selection"]
        selection.setdefault(
            "validation_selection_id",
            f"smokies_{selection['chapter_id']}_all_variants",
        )
        contract = (
            RF_CONTRACT
            if selection["chapter_id"] == "roaring_fork"
            else hashlib.sha256(
                f"{selection['chapter_id']}:{selection['variant_id']}:{index}".encode()
            ).hexdigest()
        )
        selection["delivery_contract_sha256"] = contract
        compiled["selectable"]["delivery_contract_sha256"] = contract
        items.append({
            "key": f"{selection['validation_selection_id']}:{selection['variant_id']}",
            "selection": selection,
            "manifest": compiled["manifest"],
            "delivery_contract_sha256": selection["delivery_contract_sha256"],
            "long_form_compiled": compiled,
        })
    monkeypatch.setattr(store, "_compiled_original_validation_selections", lambda _manifest: items)
    monkeypatch.setattr(
        store,
        "original_long_form_audio_binding",
        lambda compiled: {
            "binding_sha256": hashlib.sha256(
                f"{compiled['selection']['chapter_id']}:{compiled['selection']['variant_id']}".encode()
            ).hexdigest(),
        },
    )
    monkeypatch.setattr(store.settings, "valhalla_area_urls", _area_config())
    material = store._original_validation_material(
        {
            "schema_version": 3,
            "pack_id": validation.PRODUCT_ID,
            "assets": [],
            "chapters": [],
        },
        3,
    )
    assert len(material["validation_selections"]) == 6
    assert len(material["long_form_preflight_bindings"]) == 6
    assert all("route_network_target" in row for row in material["validation_selections"])
    assert {
        (row["product_id"], row["chapter_id"], row["variant_id"])
        for row in material["long_form_preflight_bindings"]
    } == validation.EXPECTED_SELECTION_KEYS
    assert len(store.ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS) == 13
    assert len(material["validation_selections"]) * len(
        store.ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS
    ) == 78
    assert material["long_form_validator_source_sha256"] == (
        validation.trusted_complete_originals_long_form_validator_source_sha256()
    )
