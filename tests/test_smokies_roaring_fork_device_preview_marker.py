from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

import scripts.mark_smokies_roaring_fork_device_preview as operator


RELEASE_SHA = "d" * 40
UPDATE_ID = "f61a209d-2aa1-45d8-91dc-c5f9e7405992"
APPLICATION = {
    "platform": "android",
    "app_version": "1.0.12",
    "build_number": "73",
    "channel": "preview",
    "runtime_version": "native-1.0.12-android.1",
    "release_sha": RELEASE_SHA,
    "update_id": UPDATE_ID,
}


def _bundle() -> dict:
    return {
        "receipt_sha256": "1" * 64,
        "profile_sha256": "2" * 64,
        "expected_base_manifest_sha256": "3" * 64,
        "expected_applied_manifest_sha256": "4" * 64,
        "receipt_asset_sha256": {"asset": "5" * 64},
        "narration_sha256": {"narration": "6" * 64},
        "redacted_attestation_sha256": {"narration": "7" * 64},
    }


def _target(tmp_path: Path) -> dict:
    database = tmp_path / "trailhead.db"
    database.write_bytes(b"sqlite-placeholder")
    assets = tmp_path / "assets"
    assets.mkdir()
    return {
        "id": operator.TARGET_ID,
        "database_path": database.resolve(),
        "asset_root": assets.resolve(),
        "database_path_sha256": "8" * 64,
        "asset_root_path_sha256": "9" * 64,
    }


def _evidence() -> dict:
    return {
        "schema_version": 1,
        "evidence_id": operator.EVIDENCE_ID,
        "application": copy.deepcopy(APPLICATION),
        "preview": {"manifest_sha256": "a" * 64},
    }


def _pending_validation() -> dict:
    return {
        "existing_gate": "preserve-me",
        "admin_license_attestation_complete": True,
        "verified_private_upload_complete": True,
        "authenticated_device_preview_complete": False,
        "trusted_publication_validation_complete": False,
        "public_release": False,
    }


def _inspection(state: str) -> dict:
    evidence = _evidence()
    pending = _pending_validation()
    rollback = {
        "validation_metadata": pending,
        "validation_metadata_sha256": operator._canonical_sha256(pending),
    }
    validation = (
        pending
        if state == "pending"
        else operator._expected_applied_validation(rollback, evidence)
    )
    return {
        "state": state,
        "draft_revision": 2,
        "base_manifest_sha256": "3" * 64,
        "manifest_sha256": "4" * 64,
        "profile_sha256": "2" * 64,
        "preview_manifest_sha256": "a" * 64,
        "validation_metadata_sha256": operator._canonical_sha256(validation),
        "validation_metadata": copy.deepcopy(validation),
        "evidence_sha256": operator._canonical_sha256(evidence),
        "asset_count": 20,
        "narration_count": 13,
        "asset_bytes": 239_772_665,
        "reviewed_story_count": 13,
        "hard_auto_story_count": 5,
        "selectable_story_count": 8,
        "published_version_count": 0,
        "validation_report_count": 0,
        "admin_user_id": 77,
    }


def _context(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    bundle = _bundle()
    target = _target(tmp_path)
    evidence = _evidence()
    evidence_path = (tmp_path / "evidence" / "device.json").resolve()
    evidence_path.parent.mkdir()
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    monkeypatch.setattr(
        operator,
        "_load_context",
        lambda *_args: (
            copy.deepcopy(bundle),
            copy.deepcopy(target),
            evidence_path,
            copy.deepcopy(evidence),
            copy.deepcopy(APPLICATION),
        ),
    )
    return bundle, target, evidence_path, evidence


def _prepared_report(
    bundle: dict, target: dict, evidence_path: Path, evidence: dict
) -> dict:
    pending = _inspection("pending")
    return {
        "schema_version": 2,
        "identity": operator._identity(
            bundle, target, evidence_path, evidence, APPLICATION,
        ),
        "state": "prepared",
        "preflight": operator._public_inspection(pending),
        "expected": operator._expected_bindings(bundle),
        "rollback": operator._validation_snapshot(pending),
    }


def _applied_report(
    bundle: dict, target: dict, evidence_path: Path, evidence: dict
) -> dict:
    report = _prepared_report(bundle, target, evidence_path, evidence)
    applied = _inspection("applied")
    report.update({
        "state": "applied_verified",
        "post_apply": operator._public_inspection(applied),
        "applied": operator._validation_snapshot(applied),
    })
    return report


def test_apply_journals_exact_rollback_before_store(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, _target_value, evidence_path, evidence = _context(
        monkeypatch, tmp_path
    )
    report_path = (tmp_path / "reports" / "device.json").resolve()
    pending = _inspection("pending")
    applied = _inspection("applied")
    inspections = iter([
        copy.deepcopy(pending), copy.deepcopy(pending), copy.deepcopy(applied),
    ])
    monkeypatch.setattr(
        operator, "_inspect_current", lambda *_args: next(inspections)
    )

    def mark_store(pack_id, **kwargs):
        assert pack_id == operator.PRODUCT_ID
        journal = json.loads(report_path.read_text(encoding="utf-8"))
        assert journal == _prepared_report(
            bundle, _target_value, evidence_path, evidence,
        )
        assert kwargs["expected_validation_metadata_sha256"] == pending[
            "validation_metadata_sha256"
        ]
        assert kwargs["expected_application_release_sha"] == RELEASE_SHA
        assert kwargs["expected_application_update_id"] == UPDATE_ID
        assert kwargs["admin_user_id"] == 77
        return {
            "replayed": False,
            "evidence_sha256": operator._canonical_sha256(evidence),
        }

    monkeypatch.setattr(
        operator.store, "mark_authored_original_device_preview_complete", mark_store,
    )
    result = operator.apply_private(
        evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
    )
    assert result["replayed"] is False
    report_text = report_path.read_text(encoding="utf-8")
    report = json.loads(report_text)
    operator._require_report(
        report,
        report["identity"],
        bundle,
        evidence,
        allowed_states={"applied_verified"},
    )
    assert "admin_user_id" not in report_text
    assert "device_serial" not in report_text
    assert "preview_token" not in report_text


def test_apply_recovers_committed_store_write_from_prepared_report(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, target, evidence_path, evidence = _context(monkeypatch, tmp_path)
    report_path = (tmp_path / "reports" / "device.json").resolve()
    operator._atomic_write_report(
        report_path, _prepared_report(bundle, target, evidence_path, evidence),
    )
    applied = _inspection("applied")
    inspections = iter([copy.deepcopy(applied), copy.deepcopy(applied)])
    monkeypatch.setattr(
        operator, "_inspect_current", lambda *_args: next(inspections)
    )
    monkeypatch.setattr(
        operator.store,
        "mark_authored_original_device_preview_complete",
        lambda *_args, **_kwargs: {
            "replayed": True,
            "evidence_sha256": operator._canonical_sha256(evidence),
        },
    )
    result = operator.apply_private(
        evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
    )
    assert result["replayed"] is True
    assert json.loads(report_path.read_text(encoding="utf-8"))[
        "state"
    ] == "applied_verified"


def test_revert_restores_journal_and_transitions_report(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, target, evidence_path, evidence = _context(monkeypatch, tmp_path)
    report_path = (tmp_path / "reports" / "device.json").resolve()
    report = _applied_report(bundle, target, evidence_path, evidence)
    operator._atomic_write_report(report_path, report)
    applied = _inspection("applied")
    pending = _inspection("pending")
    inspections = iter([copy.deepcopy(applied), copy.deepcopy(pending)])
    monkeypatch.setattr(
        operator, "_inspect_current", lambda *_args: next(inspections)
    )

    def revert_store(pack_id, **kwargs):
        assert pack_id == operator.PRODUCT_ID
        assert kwargs["restore_validation_metadata"] == _pending_validation()
        assert kwargs["expected_restore_validation_metadata_sha256"] == (
            pending["validation_metadata_sha256"]
        )
        assert kwargs["expected_applied_validation_metadata_sha256"] == (
            applied["validation_metadata_sha256"]
        )
        assert kwargs["expected_application_release_sha"] == RELEASE_SHA
        assert kwargs["expected_application_update_id"] == UPDATE_ID
        return {"replayed": False}

    monkeypatch.setattr(
        operator.store,
        "revert_authored_original_device_preview_complete",
        revert_store,
    )
    result = operator.revert_private(
        evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
    )
    assert result["replayed"] is False
    reverted = json.loads(report_path.read_text(encoding="utf-8"))
    assert reverted["state"] == "reverted_verified"
    assert "applied" in reverted
    assert reverted["post_revert"] == report["preflight"]


def test_revert_recovers_post_commit_report_loss_and_exact_replay(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, target, evidence_path, evidence = _context(monkeypatch, tmp_path)
    report_path = (tmp_path / "reports" / "device.json").resolve()
    operator._atomic_write_report(
        report_path, _applied_report(bundle, target, evidence_path, evidence),
    )
    pending = _inspection("pending")
    inspections = iter([copy.deepcopy(pending), copy.deepcopy(pending)])
    monkeypatch.setattr(
        operator, "_inspect_current", lambda *_args: next(inspections)
    )
    calls = {"count": 0}

    def replay_revert(*_args, **_kwargs):
        calls["count"] += 1
        return {"replayed": True}

    monkeypatch.setattr(
        operator.store,
        "revert_authored_original_device_preview_complete",
        replay_revert,
    )
    first = operator.revert_private(
        evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
    )
    assert first["replayed"] is True
    assert calls["count"] == 1
    saved_before_replay = report_path.read_bytes()

    monkeypatch.setattr(
        operator,
        "_inspect_current",
        lambda *_args: copy.deepcopy(pending),
    )
    second = operator.revert_private(
        evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
    )
    assert second["replayed"] is True
    assert calls["count"] == 1
    assert report_path.read_bytes() == saved_before_replay


def test_revert_prepared_never_applied_is_exact_replay(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, target, evidence_path, evidence = _context(monkeypatch, tmp_path)
    report_path = (tmp_path / "reports" / "device.json").resolve()
    operator._atomic_write_report(
        report_path, _prepared_report(bundle, target, evidence_path, evidence),
    )
    pending = _inspection("pending")
    inspections = iter([copy.deepcopy(pending), copy.deepcopy(pending)])
    monkeypatch.setattr(
        operator, "_inspect_current", lambda *_args: next(inspections)
    )
    monkeypatch.setattr(
        operator.store,
        "revert_authored_original_device_preview_complete",
        lambda *_args, **_kwargs: {"replayed": True},
    )
    operator.revert_private(
        evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
    )
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["state"] == "reverted_never_applied"
    assert "applied" not in report
    assert "post_apply" not in report


def test_verify_is_state_exact_for_applied_and_reverted_reports(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, target, evidence_path, evidence = _context(monkeypatch, tmp_path)
    report_path = (tmp_path / "reports" / "device.json").resolve()
    report = _applied_report(bundle, target, evidence_path, evidence)
    operator._atomic_write_report(report_path, report)
    monkeypatch.setattr(
        operator,
        "_inspect_current",
        lambda *_args: copy.deepcopy(_inspection("applied")),
    )
    result = operator.verify_private(
        evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
    )
    assert result["mutation_performed"] is False

    reverted = {
        **report,
        "state": "reverted_verified",
        "post_revert": copy.deepcopy(report["preflight"]),
    }
    operator._atomic_write_report(report_path, reverted)
    monkeypatch.setattr(
        operator,
        "_inspect_current",
        lambda *_args: copy.deepcopy(_inspection("pending")),
    )
    result = operator.verify_private(
        evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
    )
    assert result["status"] == "verified_reverted_device_preview_state"


@pytest.mark.parametrize(
    "operation,mutation",
    [
        ("apply", lambda report: report.update({"extra": True})),
        (
            "verify",
            lambda report: report["post_apply"].update(
                {"validation_metadata_sha256": "f" * 64}
            ),
        ),
        (
            "revert",
            lambda report: report["rollback"]["validation_metadata"].update(
                {"tampered": True}
            ),
        ),
        ("revert", lambda report: report.update({"apply_replayed": True})),
    ],
)
def test_operations_reject_malformed_or_tampered_journal(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    operation: str,
    mutation,
) -> None:
    bundle, target, evidence_path, evidence = _context(monkeypatch, tmp_path)
    report_path = (tmp_path / "reports" / "device.json").resolve()
    report = (
        _prepared_report(bundle, target, evidence_path, evidence)
        if operation == "apply"
        else _applied_report(bundle, target, evidence_path, evidence)
    )
    mutation(report)
    operator._atomic_write_report(report_path, report)
    with pytest.raises(operator.DevicePreviewOperatorError):
        if operation == "apply":
            operator.apply_private(
                evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
            )
        elif operation == "verify":
            operator.verify_private(
                evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
            )
        else:
            operator.revert_private(
                evidence_path, report_path, RELEASE_SHA, UPDATE_ID,
            )


def test_paths_are_bound_to_database_volume_and_exclude_assets(
    tmp_path: Path,
) -> None:
    target = _target(tmp_path)
    evidence = tmp_path / "evidence.json"
    evidence.write_text("{}", encoding="utf-8")
    assert operator._validated_evidence_path(evidence.resolve(), target) == evidence.resolve()
    report = (tmp_path / "reports" / "device.json").resolve()
    assert operator._validated_report_path(report, target) == report
    inside_assets = target["asset_root"] / "device.json"
    inside_assets.write_text("{}", encoding="utf-8")
    with pytest.raises(operator.DevicePreviewOperatorError, match="asset root"):
        operator._validated_evidence_path(inside_assets, target)
    with pytest.raises(operator.DevicePreviewOperatorError, match="asset root"):
        operator._validated_report_path(target["asset_root"] / "report.json", target)
    with pytest.raises(operator.DevicePreviewOperatorError, match="database volume"):
        operator._validated_report_path(
            (tmp_path.parent / "outside-device.json").resolve(), target
        )


def test_cli_defaults_to_dry_run(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    monkeypatch.setattr(
        operator,
        "dry_run",
        lambda *_args: {"status": "dry_run_verified", "mutation_performed": False},
    )
    monkeypatch.setattr(
        operator,
        "apply_private",
        lambda *_args: pytest.fail("default CLI must not apply"),
    )
    assert operator.main(["--release-sha", RELEASE_SHA, "--update-id", UPDATE_ID]) == 0
    assert json.loads(capsys.readouterr().out) == {
        "status": "dry_run_verified",
        "mutation_performed": False,
    }
