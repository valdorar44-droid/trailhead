from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

import scripts.run_smokies_roaring_fork_trusted_validation as operator


REPORT_ID = "original_validation_" + ("a" * 32)
OTHER_REPORT_ID = "original_validation_" + ("b" * 32)


def _target(tmp_path: Path) -> dict:
    database_path = (tmp_path / "trailhead.db").resolve()
    database_path.write_bytes(b"sqlite-placeholder")
    asset_root = (tmp_path / "assets").resolve()
    asset_root.mkdir()
    return {
        "id": operator.TARGET_ID,
        "database_path": database_path,
        "asset_root": asset_root,
    }


def _material_identity() -> dict:
    return {
        "draft_revision": 2,
        "manifest_sha256": "1" * 64,
        "assets_sha256": "2" * 64,
        "input_sha256": "3" * 64,
        "validator_source_sha256": "4" * 64,
        "validation_selections_sha256": "5" * 64,
        "long_form_preflight_sha256": "6" * 64,
        "operational_bindings_sha256": "7" * 64,
        "operational_projection_sha256": "8" * 64,
        "long_form_validator_source_sha256": "9" * 64,
    }


def _route_network_target() -> dict:
    return {
        "target_id": "south_tn",
        "validation_only": True,
        "draft_mutated": False,
        "global_config_mutated": False,
        "public_release_authorized": False,
        "target_binding_sha256": "7" * 64,
    }


def _material() -> dict:
    identity = _material_identity()
    return {
        "draft_revision": identity["draft_revision"],
        "manifest_sha256": identity["manifest_sha256"],
        "assets_sha256": identity["assets_sha256"],
        "input_sha256": identity["input_sha256"],
        "validator_source_sha256": identity["validator_source_sha256"],
        "validation_selections": [
            {
                "key": operator.SELECTION_KEY,
                "route_network_target": _route_network_target(),
            }
        ],
    }


def _inspection(status: str | None = None) -> dict:
    report_ids = [] if status is None else [REPORT_ID]
    active_ids = [REPORT_ID] if status in operator.ACTIVE_STATUSES else []
    return {
        "draft_revision": 2,
        "base_manifest_sha256": "a" * 64,
        "manifest_sha256": "b" * 64,
        "profile_sha256": "c" * 64,
        "validation_metadata_sha256": "d" * 64,
        "device_preview_evidence_sha256": "e" * 64,
        "asset_metadata_sha256": "f" * 64,
        "asset_binding_sha256": "0" * 64,
        "asset_count": 20,
        "narration_count": 13,
        "image_count": 7,
        "asset_bytes": 239_772_665,
        "published_version_count": 0,
        "current_published_version": None,
        "public_release": False,
        "trusted_publication_validation_complete": False,
        "material_identity": _material_identity(),
        "material": _material(),
        "admin_user_id": 77,
        "global_active_report_ids": active_ids,
        "target_report_ids": report_ids,
        "target_report_statuses": (
            {} if status is None else {REPORT_ID: status}
        ),
    }


def _raw_store_report(status: str = "running") -> dict:
    terminal = status in operator.TERMINAL_STATUSES
    if status == "passed":
        scenario_ids = list(
            operator.store.ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS
        )
        summary = {
            "required": 13,
            "passed": 13,
            "failed": 0,
            "selection_count": 1,
            "selections_passed": 1,
            "selections_failed": 0,
            "validated_selections": [operator.SELECTION_KEY],
            "validated_delivery_contracts": [
                f"{operator.SELECTION_KEY}:{operator.DELIVERY_CONTRACT_SHA256}"
            ],
        }
        selections = [
            {
                "selection_key": operator.SELECTION_KEY,
                "passed": True,
                "issues": [],
                "selection": {
                    "chapter_id": operator.CHAPTER_ID,
                    "variant_id": operator.VARIANT_ID,
                },
                "summary": {
                    "required": 13,
                    "passed": 13,
                    "failed": 0,
                    "route": {
                        "network": {
                            "validation_target": _route_network_target(),
                        }
                    },
                },
                "delivery_validation": {
                    "passed": True,
                    "delivery_contract_sha256": (
                        operator.DELIVERY_CONTRACT_SHA256
                    ),
                },
                "scenarios": [
                    {
                        "id": scenario_id,
                        "required": True,
                        "passed": True,
                        "issues": [],
                    }
                    for scenario_id in scenario_ids
                ],
            }
        ]
        issues = []
    else:
        summary = {
            "private_url": "https://private.invalid/validation",
            "database_path": "/private/trailhead.db",
        }
        selections = [{"name": "trusted production validation"}]
        issues = [] if not terminal else [{"code": "test_failure"}]
    return {
        "schema_version": 1,
        "report_type": "OriginalRouteValidationReportV1",
        "id": REPORT_ID,
        "pack_id": operator.PRODUCT_ID,
        "draft_revision": 2,
        "manifest_sha256": _material_identity()["manifest_sha256"],
        "assets_sha256": _material_identity()["assets_sha256"],
        "input_sha256": _material_identity()["input_sha256"],
        "validator_source_sha256": _material_identity()[
            "validator_source_sha256"
        ],
        "suite_version": operator.store.ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION,
        "engine_version": (
            None
            if status in operator.ACTIVE_STATUSES
            else operator.store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION
        ),
        "status": status,
        "passed": status == "passed",
        "current": True,
        "started_at": "2026-08-10T12:00:00Z",
        "completed_at": "2026-08-10T12:01:00Z" if terminal else None,
        "summary": summary,
        "scenarios": selections,
        "issues": issues,
    }


def _patch_context(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> tuple[dict, dict]:
    bundle: dict = {}
    target = _target(tmp_path)
    monkeypatch.setattr(
        operator,
        "_load_context",
        lambda: (copy.deepcopy(bundle), copy.deepcopy(target)),
    )
    return bundle, target


def _patch_store_lifecycle(
    monkeypatch: pytest.MonkeyPatch,
    *,
    initial_status: str | None,
) -> tuple[dict, dict]:
    state = {"status": initial_status}
    calls = {"create": 0, "get": 0, "execute": 0}

    def inspect(*_args) -> dict:
        return copy.deepcopy(_inspection(state["status"]))

    def create(pack_id: str, admin_user_id: int, **guards) -> dict:
        calls["create"] += 1
        assert pack_id == operator.PRODUCT_ID
        assert admin_user_id == 77
        assert guards == {
            "require_zero_active_reports": True,
            "require_zero_pack_reports": True,
            "expected_draft_revision": 2,
            "expected_manifest_sha256": _material_identity()[
                "manifest_sha256"
            ],
            "expected_assets_sha256": _material_identity()["assets_sha256"],
            "expected_input_sha256": _material_identity()["input_sha256"],
        }
        assert state["status"] is None
        state["status"] = "running"
        return copy.deepcopy(_raw_store_report("running"))

    def get_report(pack_id: str, report_id: str) -> dict:
        calls["get"] += 1
        assert pack_id == operator.PRODUCT_ID
        assert report_id == REPORT_ID
        assert state["status"] is not None
        return copy.deepcopy(_raw_store_report(state["status"]))

    def execute(report_id: str) -> dict:
        calls["execute"] += 1
        assert report_id == REPORT_ID
        assert state["status"] == "running"
        state["status"] = "passed"
        return copy.deepcopy(_raw_store_report("passed"))

    monkeypatch.setattr(operator, "_inspect_current", inspect)
    monkeypatch.setattr(
        operator.store,
        "create_authored_original_virtual_validation_run",
        create,
    )
    monkeypatch.setattr(
        operator.store,
        "get_authored_original_virtual_validation_report",
        get_report,
    )
    monkeypatch.setattr(
        operator.store,
        "execute_authored_original_virtual_validation_run",
        execute,
    )
    return state, calls


def test_help_is_lazy_and_cli_defaults_to_dry_run(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        operator,
        "_load_context",
        lambda: pytest.fail("--help must not initialize the production target"),
    )
    with pytest.raises(SystemExit) as help_exit:
        operator.main(["--help"])
    assert help_exit.value.code == 0
    assert "read-only dry run" in capsys.readouterr().out

    expected = {
        "status": "dry_run_verified",
        "target_id": operator.TARGET_ID,
        "inspection": {"target_report_count": 0},
        "mutation_performed": False,
    }
    monkeypatch.setattr(operator, "dry_run", lambda: copy.deepcopy(expected))
    monkeypatch.setattr(
        operator, "apply", lambda *_args: pytest.fail("default mode mutated")
    )
    monkeypatch.setattr(
        operator, "verify", lambda *_args, **_kwargs: pytest.fail("default verified")
    )
    assert operator.main([]) == 0
    assert json.loads(capsys.readouterr().out) == expected


def test_apply_replay_creates_and_executes_exactly_one_report(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _patch_context(monkeypatch, tmp_path)
    state, calls = _patch_store_lifecycle(monkeypatch, initial_status=None)
    report_path = (tmp_path / "reports" / "trusted-validation.json").resolve()

    first = operator.apply(report_path)
    assert first["state"] == "completed"
    assert first["validation_report_id"] == REPORT_ID
    assert first["report"]["status"] == "passed"
    assert state["status"] == "passed"
    assert calls["create"] == 1
    assert calls["execute"] == 1

    journal_before_replay = report_path.read_bytes()
    second = operator.apply(report_path)
    assert second == first
    assert calls["create"] == 1
    assert calls["execute"] == 1
    assert report_path.read_bytes() == journal_before_replay


@pytest.mark.parametrize("suffix", ["", "-wal", "-shm", "-journal"])
def test_report_path_rejects_database_and_sqlite_sidecars(
    tmp_path: Path, suffix: str,
) -> None:
    target = _target(tmp_path)
    unsafe = target["database_path"].with_name(
        target["database_path"].name + suffix
    )
    with pytest.raises(
        operator.TrustedValidationOperatorError, match="collides with"
    ):
        operator._validated_report_path(unsafe, target)

    safe = (tmp_path / "reports" / "trusted-validation.json").resolve()
    assert operator._validated_report_path(safe, target) == safe


def test_tampered_journal_fails_before_store_access_or_execution(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _patch_context(monkeypatch, tmp_path)
    inspection = _inspection("running")
    safe_running = operator._safe_store_report(_raw_store_report("running"))
    journal = operator._journal(
        origin="apply",
        state="created",
        inspection=inspection,
        store_report=safe_running,
        preflight={
            "global_active_report_count": 0,
            "target_report_count": 0,
        },
    )
    journal["identity"]["manifest_sha256"] = "f" * 64
    report_path = (tmp_path / "reports" / "trusted-validation.json").resolve()
    report_path.parent.mkdir()
    report_path.write_text(json.dumps(journal), encoding="utf-8")
    monkeypatch.setattr(
        operator,
        "_inspect_current",
        lambda *_args: copy.deepcopy(inspection),
    )
    monkeypatch.setattr(
        operator.store,
        "get_authored_original_virtual_validation_report",
        lambda *_args: pytest.fail("tamper must fail before store read"),
    )
    monkeypatch.setattr(
        operator.store,
        "execute_authored_original_virtual_validation_run",
        lambda *_args: pytest.fail("tamper must fail before execution"),
    )

    with pytest.raises(
        operator.TrustedValidationOperatorError, match="identity or state drifted"
    ):
        operator.verify(report_path)


def test_missing_journal_auto_bootstrap_resumes_without_create(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _patch_context(monkeypatch, tmp_path)
    state, calls = _patch_store_lifecycle(
        monkeypatch, initial_status="running"
    )
    report_path = (tmp_path / "reports" / "trusted-validation.json").resolve()

    completed = operator.verify(report_path)
    assert completed["origin"] == "bootstrap"
    assert completed["state"] == "completed"
    assert completed["validation_report_id"] == REPORT_ID
    assert completed["report"]["status"] == "passed"
    assert state["status"] == "passed"
    assert calls["create"] == 0
    assert calls["execute"] == 1

    replayed = operator.verify(report_path)
    assert replayed == completed
    assert calls["create"] == 0
    assert calls["execute"] == 1


def test_journal_write_failure_reports_id_and_bootstrap_recovers_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _patch_context(monkeypatch, tmp_path)
    state, calls = _patch_store_lifecycle(monkeypatch, initial_status=None)
    report_path = (tmp_path / "reports" / "trusted-validation.json").resolve()
    real_writer = operator._atomic_write_report
    write_calls = {"count": 0}

    def fail_first_write(path: Path, report: dict) -> None:
        write_calls["count"] += 1
        if write_calls["count"] == 1:
            raise OSError("simulated journal loss")
        real_writer(path, report)

    monkeypatch.setattr(operator, "_atomic_write_report", fail_first_write)
    with pytest.raises(
        operator.TrustedValidationOperatorError,
        match=rf"--bootstrap-report-id {REPORT_ID}",
    ):
        operator.apply(report_path)
    assert state["status"] == "running"
    assert calls["create"] == 1
    assert calls["execute"] == 0
    assert not report_path.exists()

    recovered = operator.verify(
        report_path, bootstrap_report_id=REPORT_ID,
    )
    assert recovered["origin"] == "bootstrap"
    assert recovered["state"] == "completed"
    assert recovered["report"]["status"] == "passed"
    assert calls["create"] == 1
    assert calls["execute"] == 1


@pytest.mark.parametrize(
    "unsafe",
    [
        {"admin_user_id": 77},
        {"access_token": "secret"},
        {"source_url": "redacted"},
        {"evidence": "https://private.invalid/evidence"},
        {"database": "/data/private/trailhead.db"},
        {"database": r"C:\\private\\trailhead.db"},
    ],
)
def test_report_redaction_rejects_identity_and_location_disclosures(
    unsafe: dict,
) -> None:
    with pytest.raises(operator.TrustedValidationOperatorError):
        operator._require_report_redacted(unsafe)


def test_safe_store_report_hashes_private_payloads_without_disclosing_them() -> None:
    safe = operator._safe_store_report(_raw_store_report("failed"))
    serialized = json.dumps(safe, sort_keys=True)
    assert set(safe) == operator._STORE_REPORT_BASE_KEYS
    assert "summary" not in safe
    assert "scenarios" not in safe
    assert "issues" not in safe
    assert "private.invalid" not in serialized
    assert "/private/trailhead.db" not in serialized
    assert "admin" not in serialized.casefold()
    assert "token" not in serialized.casefold()
    operator._require_report_redacted(safe)

    running = operator._safe_store_report(_raw_store_report("running"))
    operator._require_safe_store_report(
        running, _inspection("running"), report_id=REPORT_ID,
    )
    wrong_running_engine = copy.deepcopy(running)
    wrong_running_engine["engine_version"] = (
        operator.store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION
    )
    with pytest.raises(
        operator.TrustedValidationOperatorError,
        match="unexpected engine identity",
    ):
        operator._require_safe_store_report(
            wrong_running_engine, _inspection("running"), report_id=REPORT_ID,
        )


def test_passing_report_requires_and_persists_exact_redacted_rf_contract() -> None:
    inspection = _inspection("passed")
    raw = _raw_store_report("passed")
    safe = operator._safe_store_report(raw, inspection)
    assert safe["pass_contract"] == {
        "selection_key": operator.SELECTION_KEY,
        "route_scenario_count": 13,
        "route_scenario_ids_sha256": operator._canonical_sha256(
            list(operator.store.ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS)
        ),
        "delivery_contract_sha256": operator.DELIVERY_CONTRACT_SHA256,
        "target_id": "south_tn",
        "target_binding_sha256": "7" * 64,
        "target_evidence_sha256": operator._canonical_sha256(
            _route_network_target()
        ),
    }
    assert set(safe) == operator._STORE_REPORT_BASE_KEYS | {"pass_contract"}
    operator._require_safe_store_report(
        safe, inspection, report_id=REPORT_ID,
    )
    serialized = json.dumps(safe, sort_keys=True)
    assert "validation_target" not in serialized
    assert '"scenarios":' not in serialized
    operator._require_report_redacted(safe)

    tampered = copy.deepcopy(raw)
    tampered["scenarios"][0]["scenarios"][-1]["passed"] = False
    with pytest.raises(
        operator.TrustedValidationOperatorError,
        match="exact 13/13 route scenarios",
    ):
        operator._safe_store_report(tampered, inspection)

    wrong_engine = copy.deepcopy(safe)
    wrong_engine["engine_version"] = "legacy-engine"
    with pytest.raises(
        operator.TrustedValidationOperatorError, match="wrong trusted engine"
    ):
        operator._require_safe_store_report(
            wrong_engine, inspection, report_id=REPORT_ID,
        )

    top_level_issue = copy.deepcopy(raw)
    top_level_issue["issues"] = [{"code": "unexpected"}]
    unsafe_issue = operator._safe_store_report(top_level_issue, inspection)
    with pytest.raises(
        operator.TrustedValidationOperatorError,
        match="exact redacted success contract",
    ):
        operator._require_safe_store_report(
            unsafe_issue, inspection, report_id=REPORT_ID,
        )


def test_bootstrap_id_must_match_an_existing_journal(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _patch_context(monkeypatch, tmp_path)
    _state, calls = _patch_store_lifecycle(
        monkeypatch, initial_status="running"
    )
    inspection = _inspection("running")
    report_path = (tmp_path / "reports" / "trusted-validation.json").resolve()
    operator._atomic_write_report(
        report_path,
        operator._journal(
            origin="apply",
            state="created",
            inspection=inspection,
            store_report=operator._safe_store_report(
                _raw_store_report("running")
            ),
            preflight={
                "global_active_report_count": 0,
                "target_report_count": 0,
            },
        ),
    )

    with pytest.raises(
        operator.TrustedValidationOperatorError,
        match="does not match",
    ):
        operator.verify(report_path, bootstrap_report_id=OTHER_REPORT_ID)
    assert calls["create"] == 0
    assert calls["execute"] == 0
