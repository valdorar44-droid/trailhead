from __future__ import annotations

import copy
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from db import store
from scripts import attest_and_profile_smokies_complete_private as operator


M2_COMMIT = "a533852ceeba4f2d3b625bcce04135a2936705e5"
M2_PACKET_PATH = (
    "originals/smokies/smokies_complete_private_migration_packet_v1.json"
)
M2_AUDIT_PATH = (
    "originals/smokies/smokies_complete_private_migration_operator_audit_v1.json"
)


def _m2_blob(path: str) -> bytes:
    return subprocess.check_output(
        ["git", "show", f"{M2_COMMIT}:{path}"], cwd=operator.ROOT,
    )


PACKET_PAYLOAD = _m2_blob(M2_PACKET_PATH)
AUDIT_PAYLOAD = _m2_blob(M2_AUDIT_PATH)
PACKET = json.loads(PACKET_PAYLOAD)
AUDIT = json.loads(AUDIT_PAYLOAD)
TEMPLATE = json.loads(operator.PROFILE_TEMPLATE_PATH.read_text(encoding="utf-8"))
ADMIN_ID = 314159


def _timestamp(offset: int) -> str:
    return (
        datetime(2026, 8, 11, 20, 0, tzinfo=timezone.utc)
        + timedelta(seconds=offset)
    ).isoformat(timespec="seconds").replace("+00:00", "Z")


def _evidence(offset: int) -> dict:
    return {
        **PACKET["post_migration_phases"]["license_attestation"]["terms_tuple"],
        "attested_at": _timestamp(offset),
        "attested_by_admin_user_id": ADMIN_ID,
    }


def _redacted(evidence: dict) -> str:
    return store.original_redacted_license_attestation_sha256(evidence)


def _base_state() -> dict:
    new_map = PACKET["post_migration_phases"]["license_attestation"]["asset_sha256"]
    all_assets = PACKET["post_migration_phases"]["narration_profile_cas"][
        "expected_asset_sha256"
    ]
    narration_map = {
        key: value
        for key, value in all_assets.items()
        if key.startswith(("cc_audio_", "fp_audio_", "mc_audio_", "rf_audio_"))
    }
    rf_ids = sorted(set(narration_map) - set(new_map))
    assert len(new_map) == 72
    assert len(narration_map) == 85
    assert len(rf_ids) == 13
    rf_evidence = {asset_id: _evidence(index) for index, asset_id in enumerate(rf_ids)}
    attested_at = {
        asset_id: evidence["attested_at"] for asset_id, evidence in rf_evidence.items()
    }
    redacted = {
        asset_id: _redacted(evidence) for asset_id, evidence in rf_evidence.items()
    }
    return {
        "revision": 3,
        "manifest": {"schema_version": 3},
        "manifest_sha256": "1" * 64,
        "base_manifest_sha256": PACKET["post_migration_phases"][
            "narration_profile_cas"
        ]["expected_base_manifest_sha256"],
        "profile": None,
        "profile_sha256": None,
        "validation": {"admin_license_attestation_complete": False},
        "validation_sha256": PACKET["post_migration_phases"][
            "narration_profile_cas"
        ]["expected_validation_metadata_sha256"],
        "asset_map": copy.deepcopy(all_assets),
        "asset_map_sha256": operator.canonical_sha256(all_assets),
        "narration_map": narration_map,
        "narration_map_sha256": operator.canonical_sha256(narration_map),
        "redacted_attestation_map": redacted,
        "redacted_attestation_map_sha256": None,
        "attested_at": attested_at,
        "latest_attested_at": max(attested_at.values()),
        "unattested_new": sorted(new_map),
        "new_ids": sorted(new_map),
        "rf_ids": rf_ids,
        "rf_metadata_sha256": "2" * 64,
        "historical_report_id": (
            "original_validation_9df694c93ee9ef3809c33f451d04bf28"
        ),
        "historical_report_redacted_sha256": (
            "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059"
        ),
        "historical_report_row_sha256": "3" * 64,
        "historical_report_inventory_sha256": "4" * 64,
        "historical_report_count": 1,
        "current_full_bundle_report_count": 0,
    }


class FakeAdapter:
    def __init__(self) -> None:
        self.state = _base_state()
        self.attestation_calls: list[str] = []
        self.profile_calls = 0
        self.mutate_rf_after_attestation = False
        self.mutate_report_after_attestation = False
        self.mutate_report_inventory_after_attestation = False

    def inspect(self, *, verify_files: bool) -> dict:
        del verify_files
        self.state["latest_attested_at"] = max(self.state["attested_at"].values())
        self.state["unattested_new"] = sorted(
            set(self.state["new_ids"]) - set(self.state["attested_at"])
        )
        if len(self.state["redacted_attestation_map"]) == 85:
            self.state["redacted_attestation_map_sha256"] = operator.canonical_sha256(
                self.state["redacted_attestation_map"]
            )
        return copy.deepcopy(self.state)

    def attest(self, asset_id: str, expected_sha256: str, terms: dict) -> dict:
        assert asset_id not in self.attestation_calls
        assert expected_sha256 == PACKET["post_migration_phases"][
            "license_attestation"
        ]["asset_sha256"][asset_id]
        assert terms == PACKET["post_migration_phases"]["license_attestation"][
            "terms_tuple"
        ]
        self.attestation_calls.append(asset_id)
        evidence = _evidence(100 + len(self.attestation_calls))
        self.state["attested_at"][asset_id] = evidence["attested_at"]
        self.state["redacted_attestation_map"][asset_id] = _redacted(evidence)
        if self.mutate_rf_after_attestation:
            self.state["rf_metadata_sha256"] = "f" * 64
        if self.mutate_report_after_attestation:
            self.state["historical_report_row_sha256"] = "e" * 64
        if self.mutate_report_inventory_after_attestation:
            self.state["historical_report_inventory_sha256"] = "f" * 64
        return {
            "pack_id": operator.PRODUCT_ID,
            "asset_id": asset_id,
            "sha256": expected_sha256,
            "draft_revision": 3,
            "license_status": "attested",
            "license_attestation": evidence,
            "replayed": False,
        }

    def apply_profile(self, profile: dict, redacted: dict[str, str]) -> dict:
        assert self.state["revision"] == 3
        assert set(redacted) == set(self.state["narration_map"])
        self.profile_calls += 1
        self.state["revision"] = 4
        self.state["profile"] = copy.deepcopy(profile)
        self.state["profile_sha256"] = store._original_validation_hash(profile)
        self.state["manifest"] = {
            "schema_version": 3,
            "narration_profile": copy.deepcopy(profile),
        }
        self.state["manifest_sha256"] = store._original_validation_hash(
            self.state["manifest"]
        )
        self.state["validation"] = {
            "admin_license_attestation_complete": True,
            "verified_private_upload_complete": True,
            "authenticated_device_preview_complete": False,
            "trusted_publication_validation_complete": False,
            "public_release": False,
        }
        self.state["validation_sha256"] = store._original_validation_hash(
            self.state["validation"]
        )
        return {
            "pack_id": operator.PRODUCT_ID,
            "before_draft_revision": 3,
            "after_draft_revision": 4,
            "profile_sha256": self.state["profile_sha256"],
            "base_manifest_sha256": self.state["base_manifest_sha256"],
            "after_manifest_sha256": self.state["manifest_sha256"],
            "after_validation_metadata_sha256": self.state["validation_sha256"],
            "replayed": False,
        }


class FakeJournal:
    def __init__(self) -> None:
        self.records: dict[str, dict] = {}

    @staticmethod
    def _put(records: dict[str, dict], key: str, value: dict) -> bool:
        if key in records:
            if records[key] != value:
                raise operator.SmokiesPostMigrationError(f"conflicting journal {key}")
            return True
        records[key] = copy.deepcopy(value)
        return False

    def header(self) -> dict | None:
        value = self.records.get("header")
        return copy.deepcopy(value) if value else None

    def ensure_header(self, document: dict) -> bool:
        return self._put(self.records, "header", document)

    def record_terms(self, document: dict) -> bool:
        return self._put(
            self.records, f"terms:{document['observation_sha256']}", document
        )

    def asset(self, asset_id: str) -> dict | None:
        value = self.records.get(f"asset:{asset_id}")
        return copy.deepcopy(value) if value else None

    def record_asset(self, document: dict) -> bool:
        return self._put(
            self.records, f"asset:{document['asset_id']}", document
        )

    def record_profile(self, document: dict) -> bool:
        return self._put(self.records, "profile", document)

    def binding(self) -> dict:
        rows = [
            {"name": key, "sha256": operator.canonical_sha256(value)}
            for key, value in sorted(self.records.items())
        ]
        return {
            "record_count": len(rows),
            "records_sha256": operator.canonical_sha256(rows),
        }


class FakeReceipt:
    def __init__(self) -> None:
        self.document: dict | None = None

    def install(self, document: dict) -> dict:
        replayed = self.document is not None
        if replayed and self.document != document:
            raise operator.SmokiesPostMigrationError("existing receipt conflicts")
        self.document = copy.deepcopy(document)
        payload = operator.canonical_bytes(document)
        return {
            "replayed": replayed,
            "receipt_sha256": operator.sha256_bytes(payload),
            "receipt_byte_count": len(payload),
        }


def _bindings() -> operator.ExecutionBindings:
    return operator.ExecutionBindings(
        packet_sha256="4" * 64,
        packet_byte_count=123,
        audit={"sha256": "5" * 64, "byte_count": 456, "bindings_sha256": "6" * 64},
        migration_receipt={"receipt_id": "private_migration", "sha256": "7" * 64, "byte_count": 789},
        terms_observation={
            "sha256": "8" * 64,
            "byte_count": 321,
            "observed_at": "2026-08-11T21:00:00Z",
        },
        profile_template_sha256="9" * 64,
        profile_template_byte_count=1451,
        source_revision={"commit": "a" * 40, "tree": "b" * 40},
        target={
            "id": operator.TARGET_ID,
            "database_path_sha256": "c" * 64,
            "database_inode_identity_sha256": "d" * 64,
            "asset_root_path_sha256": "e" * 64,
        },
        admin_sha256=operator.admin_identity_sha256(ADMIN_ID),
    )


def _run(
    adapter: FakeAdapter,
    journal: FakeJournal,
    receipt: FakeReceipt,
    *,
    hook=None,
) -> dict:
    return operator.execute_state_machine(
        adapter=adapter,
        journal=journal,
        receipt=receipt,
        packet=PACKET,
        template=TEMPLATE,
        bindings=_bindings(),
        admin_user_id=ADMIN_ID,
        after_database_attestation=hook,
    )


def _terms_observation(observed_at: datetime) -> dict:
    return {
        "schema_version": 1,
        "kind": "elevenlabs_official_terms_observation",
        "status": "verified_exact_policy_tuple",
        "product_id": operator.PRODUCT_ID,
        "source": "official_public_terms_read_only",
        "verified_live": True,
        "observed_at": observed_at.isoformat(timespec="seconds").replace(
            "+00:00", "Z"
        ),
        "full_non_eea_policy_tuple": copy.deepcopy(
            PACKET["post_migration_phases"]["license_attestation"][
                "full_non_eea_policy_tuple"
            ]
        ),
        "effects": {
            "account_mutated": False,
            "provider_api_accessed": False,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
            "purchase_submitted": False,
        },
    }


def test_locked_dry_run_has_no_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        operator,
        "_pinned_file",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("file access")),
    )
    result = operator.dry_run()
    assert result["status"] == "dry_run_live_apply_locked"
    assert result["sentinel_required"] == operator.APPLY_SENTINEL
    assert result["database_accessed"] is False
    assert result["provider_accessed"] is False
    assert result["writes_performed"] is False


def test_main_default_is_locked(capsys: pytest.CaptureFixture[str]) -> None:
    assert operator.main([]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "dry_run_live_apply_locked"


def test_wrong_sentinel_stops_before_path_or_database_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        operator,
        "_outside_repo",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("path access")),
    )
    args = operator.parser().parse_args(["--apply", "WRONG"])
    with pytest.raises(operator.SmokiesPostMigrationError, match="sentinel"):
        operator.apply(args)


def test_fresh_exact_terms_observation_passes() -> None:
    now = datetime(2026, 8, 11, 22, 0, tzinfo=timezone.utc)
    document = _terms_observation(now - timedelta(minutes=2))
    payload = operator.canonical_bytes(document)
    binding = operator._validate_terms_observation(
        document,
        payload,
        PACKET,
        operator.sha256_bytes(payload),
        now=now,
    )
    assert binding["observed_at"] == "2026-08-11T21:58:00Z"
    assert set(binding) == {"sha256", "byte_count", "observed_at"}


@pytest.mark.parametrize("failure", ["stale", "policy", "effects", "hash"])
def test_terms_drift_stops_before_any_attestation(failure: str) -> None:
    now = datetime(2026, 8, 11, 22, 0, tzinfo=timezone.utc)
    observed = now - timedelta(minutes=16 if failure == "stale" else 1)
    document = _terms_observation(observed)
    if failure == "policy":
        document["full_non_eea_policy_tuple"]["primary_terms"]["last_updated"] = "drift"
    elif failure == "effects":
        document["effects"]["provider_requests_sent"] = 1
    payload = operator.canonical_bytes(document)
    expected_sha = "0" * 64 if failure == "hash" else operator.sha256_bytes(payload)
    calls: list[str] = []
    with pytest.raises(operator.SmokiesPostMigrationError):
        operator._validate_terms_observation(
            document, payload, PACKET, expected_sha, now=now
        )
    assert calls == []


def test_complete_run_attests_72_once_then_profiles_once() -> None:
    adapter = FakeAdapter()
    journal = FakeJournal()
    receipt = FakeReceipt()
    result = _run(adapter, journal, receipt)
    assert result["status"] == "verified_profiled_private_draft"
    assert len(adapter.attestation_calls) == 72
    assert adapter.profile_calls == 1
    assert adapter.state["revision"] == 4
    assert adapter.state["profile"]["commercial_license"]["verified_at"] == max(
        adapter.state["attested_at"].values()
    )
    assert len([key for key in journal.records if key.startswith("asset:")]) == 72
    assert receipt.document["counts"] == {
        "newly_attested_narrations": 72,
        "preserved_roaring_fork_narrations": 13,
        "total_narrations": 85,
        "total_images": 13,
        "total_assets": 98,
    }
    historical = receipt.document["preservation"]["historical_validation_report"]
    assert historical["report_count"] == 1
    assert historical["current_full_bundle_report_count"] == 0
    assert historical["row_sha256_before"] == historical["row_sha256_after"]
    assert historical["inventory_sha256_before"] == "4" * 64
    assert (
        historical["inventory_sha256_before"]
        == historical["inventory_sha256_after"]
    )


def test_crash_after_database_commit_resumes_only_missing_journal_work() -> None:
    adapter = FakeAdapter()
    journal = FakeJournal()
    receipt = FakeReceipt()
    crash_after = sorted(adapter.state["new_ids"])[4]

    def crash(asset_id: str) -> None:
        if asset_id == crash_after:
            raise RuntimeError("simulated process loss")

    with pytest.raises(RuntimeError, match="process loss"):
        _run(adapter, journal, receipt, hook=crash)
    assert len(adapter.attestation_calls) == 5
    assert journal.asset(crash_after) is None
    assert crash_after in adapter.state["attested_at"]

    result = _run(adapter, journal, receipt)
    assert result["status"] == "verified_profiled_private_draft"
    assert len(adapter.attestation_calls) == 72
    assert len(set(adapter.attestation_calls)) == 72
    assert adapter.profile_calls == 1
    assert journal.asset(crash_after) is not None


def test_roaring_fork_attestation_drift_stops_before_profile() -> None:
    adapter = FakeAdapter()
    adapter.mutate_rf_after_attestation = True
    with pytest.raises(operator.SmokiesPostMigrationError, match="Roaring Fork"):
        _run(adapter, FakeJournal(), FakeReceipt())
    assert len(adapter.attestation_calls) == 1
    assert adapter.profile_calls == 0


def test_historical_report_drift_stops_before_profile() -> None:
    adapter = FakeAdapter()
    adapter.mutate_report_after_attestation = True
    with pytest.raises(operator.SmokiesPostMigrationError, match="historical"):
        _run(adapter, FakeJournal(), FakeReceipt())
    assert len(adapter.attestation_calls) == 1
    assert adapter.profile_calls == 0


def test_historical_report_inventory_drift_stops_before_profile() -> None:
    adapter = FakeAdapter()
    adapter.mutate_report_inventory_after_attestation = True
    with pytest.raises(operator.SmokiesPostMigrationError, match="inventory"):
        _run(adapter, FakeJournal(), FakeReceipt())
    assert len(adapter.attestation_calls) == 1
    assert adapter.profile_calls == 0


def test_journal_claim_without_database_attestation_is_conflict() -> None:
    adapter = FakeAdapter()
    journal = FakeJournal()
    first = adapter.state["new_ids"][0]
    journal.records[f"asset:{first}"] = {"false": "claim"}
    with pytest.raises(operator.SmokiesPostMigrationError, match="journal claims"):
        _run(adapter, journal, FakeReceipt())
    assert adapter.attestation_calls == []
    assert adapter.profile_calls == 0


def test_exact_replay_does_not_repeat_attestation_or_profile() -> None:
    adapter = FakeAdapter()
    journal = FakeJournal()
    receipt = FakeReceipt()
    first = _run(adapter, journal, receipt)
    second = _run(adapter, journal, receipt)
    assert first["replayed"] is False
    assert second["replayed"] is True
    assert len(adapter.attestation_calls) == 72
    assert adapter.profile_calls == 1


def test_existing_receipt_conflict_fails_closed() -> None:
    adapter = FakeAdapter()
    journal = FakeJournal()
    receipt = FakeReceipt()
    _run(adapter, journal, receipt)
    receipt.document["private_state"]["profiled_manifest_sha256"] = "0" * 64
    with pytest.raises(operator.SmokiesPostMigrationError, match="receipt conflicts"):
        _run(adapter, journal, receipt)
    assert adapter.profile_calls == 1


def test_receipt_is_redacted_and_has_no_absolute_private_paths() -> None:
    adapter = FakeAdapter()
    receipt = FakeReceipt()
    _run(adapter, FakeJournal(), receipt)
    serialized = json.dumps(receipt.document, sort_keys=True)
    assert str(ADMIN_ID) not in serialized
    assert "/data/" not in serialized
    assert "/tmp/" not in serialized
    terms = PACKET["post_migration_phases"]["license_attestation"]["terms_tuple"]
    assert terms["terms_id"] not in serialized
    assert terms["terms_url"] not in serialized
    assert len(receipt.document["redacted_attestation_bindings"]) == 85


def test_private_journal_uses_create_only_records(tmp_path: Path) -> None:
    journal_path = tmp_path / "journal"
    journal_path.mkdir(mode=0o700)
    os.chmod(journal_path, 0o700)
    with operator._pinned_directory(
        journal_path, "private journal", private=True
    ) as pinned:
        journal = operator.PrivateJournal(journal_path, pinned[0], pinned[1])
        header = {"schema_version": 1, "kind": "header"}
        assert journal.ensure_header(header) is False
        assert journal.ensure_header(header) is True
        with pytest.raises(operator.SmokiesPostMigrationError, match="conflicts"):
            journal.ensure_header({"schema_version": 2, "kind": "header"})
    assert stat_mode(journal_path / operator.JOURNAL_HEADER_NAME) == 0o600


def stat_mode(path: Path) -> int:
    return path.stat().st_mode & 0o777


def test_paths_must_be_absolute_and_outside_repository(tmp_path: Path) -> None:
    with pytest.raises(operator.SmokiesPostMigrationError, match="absolute"):
        operator._outside_repo(Path("relative.json"), "private receipt")
    with pytest.raises(operator.SmokiesPostMigrationError, match="outside"):
        operator._outside_repo(operator.ROOT / "tracked.json", "private receipt", must_exist=False)
    external = tmp_path / "evidence.json"
    external.write_text("{}", encoding="utf-8")
    assert operator._outside_repo(external, "private receipt") == external


def test_materialization_changes_only_verified_at() -> None:
    latest = "2026-08-11T22:22:22Z"
    profile = operator._materialize_profile(TEMPLATE, PACKET, latest)
    assert profile["commercial_license"]["verified_at"] == latest
    restored = copy.deepcopy(profile)
    restored["commercial_license"]["verified_at"] = TEMPLATE[
        "commercial_license"
    ]["verified_at"]
    assert restored == TEMPLATE


def test_actual_frozen_packet_expectations_are_self_consistent() -> None:
    terms = PACKET["post_migration_phases"]["license_attestation"]
    profile = PACKET["post_migration_phases"]["narration_profile_cas"]
    args = SimpleNamespace(
        expected_packet_sha256=operator.sha256_bytes(PACKET_PAYLOAD),
        expected_source_commit=PACKET["source_revision"]["commit"],
        expected_source_tree=PACKET["source_revision"]["tree"],
        expected_new_narration_map_sha256=operator.canonical_sha256(
            terms["asset_sha256"]
        ),
        expected_asset_map_sha256=operator.canonical_sha256(
            profile["expected_asset_sha256"]
        ),
        expected_base_manifest_sha256=profile["expected_base_manifest_sha256"],
        expected_validation_metadata_sha256=profile[
            "expected_validation_metadata_sha256"
        ],
        expected_terms_policy_sha256=terms["terms_policy_sha256"],
        expected_audit_sha256=operator.sha256_bytes(AUDIT_PAYLOAD),
        expected_audit_bindings_sha256=operator.canonical_sha256(AUDIT["bindings"]),
    )
    operator._validate_packet(PACKET, operator.sha256_bytes(PACKET_PAYLOAD), args)
    operator._validate_audit(
        AUDIT, AUDIT_PAYLOAD, args.expected_packet_sha256, args
    )


def test_source_tree_migration_files_cannot_substitute_for_isolated_m2() -> None:
    local_packet = (
        operator.ROOT
        / "originals/smokies/smokies_complete_private_migration_packet_v1.json"
    )
    local_audit = (
        operator.ROOT
        / "originals/smokies/smokies_complete_private_migration_operator_audit_v1.json"
    )
    assert local_packet.read_bytes() != PACKET_PAYLOAD
    assert local_audit.read_bytes() != AUDIT_PAYLOAD
    with pytest.raises(operator.SmokiesPostMigrationError, match="outside"):
        operator._outside_repo(local_packet, "immutable M2 migration packet")
    with pytest.raises(operator.SmokiesPostMigrationError, match="outside"):
        operator._outside_repo(local_audit, "immutable M2 migration audit")
