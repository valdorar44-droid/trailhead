from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest

from config.settings import settings
import scripts.apply_smokies_roaring_fork_narration_profile as operator


def _fake_bundle() -> dict:
    return {
        "profile": {"schema_version": 2},
        "receipt": {"target": {"id": operator.TARGET_ID}},
        "receipt_sha256": "1" * 64,
        "receipt_asset_sha256": {"audio": "2" * 64},
        "narration_sha256": {"audio": "2" * 64},
        "redacted_attestation_sha256": {"audio": "8" * 64},
        "profile_file_sha256": "3" * 64,
        "profile_sha256": "4" * 64,
        "evidence_file_sha256": "5" * 64,
        "expected_base_manifest_sha256": "6" * 64,
        "expected_applied_manifest_sha256": "7" * 64,
    }


def _fake_target(tmp_path: Path) -> dict:
    database = tmp_path / "trailhead.db"
    database.write_bytes(b"sqlite-placeholder")
    asset_root = tmp_path / "assets"
    asset_root.mkdir()
    return {
        "id": operator.TARGET_ID,
        "database_path": database.resolve(),
        "asset_root": asset_root.resolve(),
        "database_path_sha256": operator._path_identity(database.resolve()),
        "asset_root_path_sha256": operator._path_identity(asset_root.resolve()),
    }


def _inspection(*, state: str, revision: int) -> dict:
    validation = {
        "admin_license_attestation_complete": state == "applied",
        "authenticated_device_preview_complete": False,
        "trusted_publication_validation_complete": False,
        "public_release": False,
    }
    if state == "applied":
        validation["verified_private_upload_complete"] = True
    return {
        "state": state,
        "draft_revision": revision,
        "base_manifest_sha256": "6" * 64,
        "applied_manifest_sha256": "7" * 64,
        "profile_sha256": "4" * 64,
        "validation_metadata": validation,
        "validation_metadata_sha256": operator._canonical_sha256(validation),
        "asset_count": 20,
        "narration_count": 13,
        "image_count": 7,
        "asset_bytes": 239_772_665,
        "published_version_count": 0,
        "validation_report_count": 0,
        "bindings": [{"asset_id": "audio"}],
        "attesting_admin_id": 77,
    }


def _patch_context(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    bundle = _fake_bundle()
    target = _fake_target(tmp_path)
    monkeypatch.setattr(operator, "_load_bundle", lambda: copy.deepcopy(bundle))
    monkeypatch.setattr(
        operator,
        "_configured_target",
        lambda _bundle: copy.deepcopy(target),
    )
    return bundle, target


def test_real_bundle_is_reproducible_and_exact() -> None:
    bundle = operator._load_bundle()
    assert len(bundle["receipt_asset_sha256"]) == 20
    assert len(bundle["narration_sha256"]) == 13
    assert bundle["profile_file_sha256"] == (
        "10fd4f5f04cbfbc411a1e7c31061700d17752af61e1501a4b7b4652c0d2ee377"
    )
    assert bundle["profile_sha256"] == (
        "f79b386031ca0faf6e07332e53ea037f957eb7d9871c4bbf05d5b0aff09c2af5"
    )


def test_configured_target_requires_explicit_exact_bindings(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle = _fake_bundle()
    target = _fake_target(tmp_path)
    bundle["receipt"]["target"] = {
        "id": operator.TARGET_ID,
        "database_path_sha256": target["database_path_sha256"],
        "asset_root_path_sha256": target["asset_root_path_sha256"],
    }
    old_db_path = settings.db_path
    try:
        settings.db_path = str(target["database_path"])
        monkeypatch.delenv("TRAILHEAD_DB_PATH", raising=False)
        monkeypatch.delenv("TRAILHEAD_ORIGINALS_ASSET_DIR", raising=False)
        monkeypatch.delenv("TRAILHEAD_PRIVATE_IMPORT_TARGET_ID", raising=False)
        with pytest.raises(
            operator.NarrationProfileOperatorError,
            match="TRAILHEAD_DB_PATH",
        ):
            operator._configured_target(bundle)

        monkeypatch.setenv("TRAILHEAD_DB_PATH", str(target["database_path"]))
        monkeypatch.setenv("TRAILHEAD_ORIGINALS_ASSET_DIR", str(target["asset_root"]))
        monkeypatch.setenv("TRAILHEAD_PRIVATE_IMPORT_TARGET_ID", "wrong-target")
        with pytest.raises(
            operator.NarrationProfileOperatorError,
            match="target id",
        ):
            operator._configured_target(bundle)

        monkeypatch.setenv(
            "TRAILHEAD_PRIVATE_IMPORT_TARGET_ID", operator.TARGET_ID
        )
        configured = operator._configured_target(bundle)
        assert configured["id"] == operator.TARGET_ID
        assert configured["database_path"] == target["database_path"]
        assert configured["asset_root"] == target["asset_root"]
    finally:
        settings.db_path = old_db_path


def test_report_path_is_volume_scoped_and_cannot_collide(
    tmp_path: Path,
) -> None:
    target = _fake_target(tmp_path)
    report = tmp_path / "reports" / "profile.json"
    assert operator._validate_report_path(report.resolve(), target) == report.resolve()
    with pytest.raises(operator.NarrationProfileOperatorError, match="database"):
        operator._validate_report_path(target["database_path"], target)
    with pytest.raises(operator.NarrationProfileOperatorError, match="asset root"):
        operator._validate_report_path(
            (target["asset_root"] / "profile.json").resolve(), target
        )
    with pytest.raises(operator.NarrationProfileOperatorError, match="database volume"):
        operator._validate_report_path(
            (tmp_path.parent / "outside-profile.json").resolve(), target
        )


def test_apply_writes_rollback_journal_before_store_and_keeps_missing_key(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, _target = _patch_context(monkeypatch, tmp_path)
    pre = _inspection(state="unapplied", revision=1)
    post = _inspection(state="applied", revision=2)
    report_path = (tmp_path / "reports" / "profile.json").resolve()
    inspections = iter(
        [copy.deepcopy(pre), copy.deepcopy(pre), copy.deepcopy(post)]
    )
    monkeypatch.setattr(
        operator, "_inspect_current", lambda *_args: next(inspections)
    )

    def apply_store(pack_id, **kwargs):
        assert pack_id == operator.builder.PRODUCT_ID
        assert report_path.is_file()
        journal = json.loads(report_path.read_text(encoding="utf-8"))
        assert journal["state"] == "prepared"
        assert journal["rollback"]["validation_metadata"] == pre["validation_metadata"]
        assert "verified_private_upload_complete" not in (
            journal["rollback"]["validation_metadata"]
        )
        assert kwargs["admin_user_id"] == 77
        assert kwargs["expected_validation_metadata_sha256"] == pre[
            "validation_metadata_sha256"
        ]
        assert kwargs["expected_asset_sha256"] == bundle[
            "receipt_asset_sha256"
        ]
        assert kwargs["expected_redacted_license_attestation_sha256"] == bundle[
            "redacted_attestation_sha256"
        ]
        return {
            "replayed": False,
            "rollback_validation_metadata": copy.deepcopy(
                pre["validation_metadata"]
            ),
            "rollback_validation_metadata_sha256": pre[
                "validation_metadata_sha256"
            ],
        }

    monkeypatch.setattr(
        operator.store,
        "apply_authored_original_narration_profile_v2",
        apply_store,
    )
    result = operator.apply_private(report_path)
    assert result["status"] == "verified_private_profile_apply"
    assert result["replayed"] is False
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["state"] == "applied_verified"
    assert report["rollback"]["validation_metadata"] == pre["validation_metadata"]
    assert "attesting_admin_id" not in json.dumps(report)


def test_apply_replay_never_replaces_durable_rollback_snapshot(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, target = _patch_context(monkeypatch, tmp_path)
    pre = _inspection(state="unapplied", revision=1)
    post = _inspection(state="applied", revision=2)
    report_path = (tmp_path / "reports" / "profile.json").resolve()
    report = operator._prepared_report(bundle, target, pre)
    # Simulate a committed store write whose response was lost before the
    # durable report could be advanced beyond its prepared state.
    report["state"] = "prepared"
    operator._atomic_write_report(report_path, report)
    inspections = iter([copy.deepcopy(post), copy.deepcopy(post)])
    monkeypatch.setattr(
        operator, "_inspect_current", lambda *_args: next(inspections)
    )

    def replay_store(*_args, **kwargs):
        assert kwargs["expected_validation_metadata_sha256"] == post[
            "validation_metadata_sha256"
        ]
        return {
            "replayed": True,
            "rollback_validation_metadata": None,
            "rollback_validation_metadata_sha256": None,
        }

    monkeypatch.setattr(
        operator.store,
        "apply_authored_original_narration_profile_v2",
        replay_store,
    )
    result = operator.apply_private(report_path)
    assert result["replayed"] is True
    replayed = json.loads(report_path.read_text(encoding="utf-8"))
    assert replayed["rollback"]["validation_metadata"] == pre[
        "validation_metadata"
    ]
    assert "verified_private_upload_complete" not in replayed["rollback"][
        "validation_metadata"
    ]


def test_revert_passes_exact_snapshot_and_verifies_revision_three(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, target = _patch_context(monkeypatch, tmp_path)
    pre = _inspection(state="unapplied", revision=1)
    post = _inspection(state="applied", revision=2)
    reverted = _inspection(state="unapplied", revision=3)
    reverted["validation_metadata"] = copy.deepcopy(pre["validation_metadata"])
    reverted["validation_metadata_sha256"] = pre["validation_metadata_sha256"]
    report_path = (tmp_path / "reports" / "profile.json").resolve()
    report = operator._prepared_report(bundle, target, pre)
    report["state"] = "applied_verified"
    operator._atomic_write_report(report_path, report)
    inspections = iter([copy.deepcopy(post), copy.deepcopy(reverted)])
    monkeypatch.setattr(
        operator, "_inspect_current", lambda *_args: next(inspections)
    )

    def revert_store(pack_id, **kwargs):
        assert pack_id == operator.builder.PRODUCT_ID
        assert kwargs["restore_validation_metadata"] == pre[
            "validation_metadata"
        ]
        assert "verified_private_upload_complete" not in kwargs[
            "restore_validation_metadata"
        ]
        assert kwargs["expected_draft_revision"] == 2
        assert kwargs["expected_applied_manifest_sha256"] == "7" * 64
        return {"replayed": False}

    monkeypatch.setattr(
        operator.store,
        "revert_authored_original_narration_profile_v2",
        revert_store,
    )
    result = operator.revert_private(report_path)
    assert result["status"] == "verified_profile_revert"
    assert result["inspection"]["draft_revision"] == 3
    saved = json.loads(report_path.read_text(encoding="utf-8"))
    assert saved["state"] == "reverted_verified"
    assert saved["rollback"]["validation_metadata"] == pre[
        "validation_metadata"
    ]


def test_revert_prepared_but_never_applied_is_noop(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, target = _patch_context(monkeypatch, tmp_path)
    pre = _inspection(state="unapplied", revision=1)
    report_path = (tmp_path / "reports" / "profile.json").resolve()
    operator._atomic_write_report(
        report_path, operator._prepared_report(bundle, target, pre)
    )
    monkeypatch.setattr(
        operator, "_inspect_current", lambda *_args: copy.deepcopy(pre)
    )
    monkeypatch.setattr(
        operator.store,
        "revert_authored_original_narration_profile_v2",
        lambda *_args, **_kwargs: pytest.fail("store revert must not run"),
    )
    result = operator.revert_private(report_path)
    assert result["status"] == "verified_profile_never_applied"
    assert result["replayed"] is True
    verified = operator.verify_private(report_path)
    assert verified["status"] == "verified_reverted_profile_state"
    assert verified["inspection"]["draft_revision"] == 1


def test_report_identity_and_rollback_hash_are_fail_closed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bundle, target = _patch_context(monkeypatch, tmp_path)
    pre = _inspection(state="unapplied", revision=1)
    report = operator._prepared_report(bundle, target, pre)
    report["rollback"]["validation_metadata"]["drift"] = True
    with pytest.raises(
        operator.NarrationProfileOperatorError,
        match="rollback metadata hash",
    ):
        operator._require_report_identity(report, bundle, target)


def test_cli_default_is_read_only(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    monkeypatch.setattr(
        operator,
        "dry_run",
        lambda: {"status": "dry_run_verified", "mutation_performed": False},
    )
    monkeypatch.setattr(
        operator,
        "apply_private",
        lambda *_args: pytest.fail("default CLI must not apply"),
    )
    assert operator.main([]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output == {
        "status": "dry_run_verified",
        "mutation_performed": False,
    }


def test_atomic_report_bytes_and_hash_are_stable(tmp_path: Path) -> None:
    report_path = tmp_path / "report.json"
    report = {"schema_version": 1, "state": "prepared", "value": "exact"}
    operator._atomic_write_report(report_path, report)
    expected = json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    assert report_path.read_text(encoding="utf-8") == expected
    assert operator._sha256_path(report_path) == hashlib.sha256(
        expected.encode("utf-8")
    ).hexdigest()
