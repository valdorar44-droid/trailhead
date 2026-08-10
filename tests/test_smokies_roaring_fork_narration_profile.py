from __future__ import annotations

import copy
import json
import subprocess
import sys

import pytest
from pydantic import ValidationError

import scripts.build_smokies_roaring_fork_narration_profile as builder


def _tracked_profile() -> dict:
    return json.loads(builder.PROFILE_OUTPUT_PATH.read_text(encoding="utf-8"))


def _tracked_evidence() -> dict:
    return json.loads(builder.EVIDENCE_OUTPUT_PATH.read_text(encoding="utf-8"))


def test_profile_and_evidence_rebuild_byte_identically_and_check_cleanly() -> None:
    profile, evidence = builder.build_bundle()
    assert builder.PROFILE_OUTPUT_PATH.read_text(encoding="utf-8") == builder.serialize(
        profile
    )
    assert builder.EVIDENCE_OUTPUT_PATH.read_text(encoding="utf-8") == builder.serialize(
        evidence
    )
    result = subprocess.run(
        [sys.executable, str(builder.__file__), "--check"],
        cwd=builder.REPOSITORY,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


def test_every_tracked_source_binding_matches_exact_bytes_and_sha256() -> None:
    evidence = _tracked_evidence()
    expected = {}
    for name, spec in builder.SOURCE_SPECS.items():
        assert spec.path.is_file()
        assert spec.path.stat().st_size == spec.byte_count
        assert builder._sha256_path(spec.path) == spec.sha256
        expected[name] = {
            "path": spec.path.relative_to(builder.REPOSITORY).as_posix(),
            "byte_count": spec.byte_count,
            "sha256": spec.sha256,
        }
    assert evidence["source_bindings"] == expected


def test_redacted_account_claims_are_reproducible_without_private_metadata() -> None:
    spec = builder.SOURCE_SPECS["provider_account_claims_redacted"]
    claims = builder._load_json(spec.path)
    assert claims == {
        "schema_version": 1,
        "provider": "elevenlabs",
        "source": "authenticated_browser",
        "observed_at": builder.ACCOUNT_CONFIRMED_AT,
        "plan": "creator",
        "account_status": "active",
        "commercial_use": True,
        "model_training_contribution": False,
        "standard_logging_acknowledged": True,
        "output_format_id": "mp3_44100_128",
        "zero_retention": False,
        "private_source": {
            "byte_count": 885,
            "sha256": builder.ACCOUNT_EVIDENCE_SHA256,
            "browser_source_sha256": builder.ACCOUNT_SOURCE_SHA256,
        },
        "omitted_field_groups": [
            "available_credit_balance",
            "overage_and_billing_controls",
            "api_key_policy",
        ],
    }
    assert "available_credits" not in claims
    assert "overage" not in claims
    assert "api_key_policy" not in claims
    redacted_serialized = builder._canonical_json(claims)
    assert "admin_user_id" not in redacted_serialized
    assert "access_token" not in redacted_serialized
    assert "refresh_token" not in redacted_serialized

    bindings = _tracked_evidence()["private_provider_evidence_bindings"]
    assert bindings["account_private_source_byte_count"] == 885
    assert bindings["account_private_source_sha256"] == (
        builder.ACCOUNT_EVIDENCE_SHA256
    )
    assert bindings["account_browser_source_sha256"] == builder.ACCOUNT_SOURCE_SHA256
    assert bindings["account_claims_source_binding"] == (
        "provider_account_claims_redacted"
    )
    assert bindings["omitted_field_groups"] == claims["omitted_field_groups"]


def test_thirteen_narrations_bind_lock_characterization_import_and_attestations() -> None:
    evidence = _tracked_evidence()
    rows = evidence["attestations"]
    assert len(rows) == 13
    assert {row["asset_id"] for row in rows} == set(builder.EXPECTED_ASSET_SHA256)
    assert {row["narration_sha256"] for row in rows} == set(
        builder.EXPECTED_ASSET_SHA256.values()
    )
    assert all(
        row["narration_sha256"] == builder.EXPECTED_ASSET_SHA256[row["asset_id"]]
        for row in rows
    )
    assert len({row["redacted_attestation_sha256"] for row in rows}) == 13
    assert evidence["attestation_summary"] == {
        "asset_membership_complete": True,
        "attestation_set_canonical_sha256": builder.ATTESTATION_SET_CANONICAL_SHA256,
        "common_terms_exact": True,
        "count": 13,
        "earliest_attested_at": "2026-08-10T20:05:07Z",
        "latest_attested_at": builder.PROFILE_VERIFIED_AT,
        "profile_verified_at": builder.PROFILE_VERIFIED_AT,
        "profile_verified_at_rule": "maximum_server_owned_attested_at",
    }


def test_profile_is_exact_server_schema_and_v3_copy_only_normalization() -> None:
    profile = _tracked_profile()
    validated = builder.OriginalNarrationProfileV2.model_validate(
        copy.deepcopy(profile)
    ).model_dump(mode="json", exclude_none=True)
    assert validated == profile
    evidence = _tracked_evidence()
    artifact = evidence["profile_artifact"]
    assert artifact["profile_schema"] == "OriginalNarrationProfileV2"
    assert artifact["server_pydantic_validated"] is True
    assert artifact["v3_normalization_validated_on_copy"] is True
    assert artifact["source_manifest_mutated"] is False
    assert artifact["sha256"] == builder._sha256_path(builder.PROFILE_OUTPUT_PATH)
    assert artifact["byte_count"] == builder.PROFILE_OUTPUT_PATH.stat().st_size
    assert artifact["canonical_sha256"] == builder._canonical_sha256(profile)


def test_profile_fields_come_from_exact_generator_license_and_account_evidence() -> None:
    profile = _tracked_profile()
    assert profile["provider"] == "elevenlabs"
    assert profile["voice_id"] == "EkK5I93UQWFDigLMpZcX"
    assert profile["model_snapshot"] == "eleven_multilingual_v2"
    assert profile["api_version"] == "elevenlabs_text_to_speech_v1"
    assert profile["language"] == "en"
    assert profile["generation"] == {
        "bitrate_kbps": 128,
        "channels": 1,
        "lossless": False,
        "mime_type": "audio/mpeg",
        "output_format": "mp3_44100_128",
        "provider_native": True,
        "sample_rate_hz": 44_100,
    }
    assert profile["archival_master"]["immutable"] is True
    assert profile["mobile_delivery"]["transcoded"] is False
    assert profile["mobile_delivery"]["byte_identical_to_archival_master"] is True
    assert profile["commercial_license"] == {
        "commercial_use_allowed": True,
        "plan": "creator",
        "reviewed_at": "2026-08-10",
        "status": "verified",
        "terms_id": "elevenlabs_terms_of_service_non_eea_2026-03-31",
        "terms_url": "https://elevenlabs.io/terms-of-use",
        "terms_version": "31 March 2026",
        "verified_at": "2026-08-10T20:19:19Z",
    }
    assert profile["training_contribution"] == {
        "status": "disabled",
        "confirmed_at": builder.ACCOUNT_CONFIRMED_AT,
    }
    assert profile["provider_data_retention"] == {
        "status": "provider_standard",
        "zero_retention": False,
        "confirmed_at": builder.ACCOUNT_CONFIRMED_AT,
    }


def test_voice_settings_are_bound_in_evidence_without_overclaiming_profile_schema() -> None:
    profile = _tracked_profile()
    evidence = _tracked_evidence()
    assert "voice_name" not in profile
    assert "voice_settings" not in profile
    assert evidence["accepted_generator_contract"]["voice_name"] == (
        "James - Husky, Engaging and Bold"
    )
    assert evidence["accepted_generator_contract"]["voice_settings"] == (
        builder.VOICE_SETTINGS
    )
    assert any(
        "not_fields_in_profile_v2" in item for item in evidence["limitations"]
    )


def test_live_readback_is_redacted_and_every_downstream_gate_remains_false() -> None:
    evidence = _tracked_evidence()
    assert evidence["live_readback"] == {
        "admin_identity_count": 1,
        "admin_identity_redacted": True,
        "current_asset_count": 20,
        "current_narration_count": 13,
        "license_attestation_count": 13,
        "manifest_probe_ensure_ascii_sha256": (
            builder.LIVE_MANIFEST_PROBE_ENSURE_ASCII_SHA256
        ),
        "store_base_manifest_canonical_sha256": (
            builder.STORE_BASE_MANIFEST_CANONICAL_SHA256
        ),
        "observed_at": builder.LIVE_READBACK_OBSERVED_AT,
        "private_import_receipt_sha256": builder.SOURCE_SPECS[
            "private_import_receipt"
        ].sha256,
        "production_mutation_performed": False,
        "published_version_count": 0,
        "receipt_exact_asset_count": 20,
        "rehashed_exact_narration_count": 13,
        "single_admin_identity_confirmed": True,
        "target": {
            "current_published_version": None,
            "draft_revision": 1,
            "narration_profile_present": False,
            "pack_id": builder.PRODUCT_ID,
            "status": "draft",
        },
        "validation_report_count": 0,
    }
    gates = evidence["gates_before_and_after_evidence_build"]
    assert gates["live_draft_validation_metadata_admin_license_attestation_complete"] is False
    assert gates["server_owned_attestation_evidence_complete"] is True
    assert gates["deterministic_narration_profile_evidence_complete"] is True
    for name in (
        "verified_private_upload_complete",
        "authenticated_device_preview_complete",
        "trusted_publication_validation_complete",
        "public_release",
    ):
        assert gates[name] is False
    serialized = builder.serialize(evidence)
    assert "attested_by_admin_user_id" not in serialized
    assert '"admin_user_id"' not in serialized


def test_builder_never_rewrites_historical_packet_receipt_or_manifest() -> None:
    protected = {
        name: builder._sha256_path(spec.path)
        for name, spec in builder.SOURCE_SPECS.items()
        if name
        in {"private_import_packet", "private_import_receipt", "private_manifest_v3"}
    }
    builder.build_bundle()
    assert {
        name: builder._sha256_path(builder.SOURCE_SPECS[name].path)
        for name in protected
    } == protected
    preserved = _tracked_evidence()["historical_state_preserved"]
    assert preserved == {
        "live_draft_profile_written": False,
        "live_draft_revision_changed": False,
        "private_import_packet_rewritten": False,
        "private_import_receipt_rewritten": False,
        "private_manifest_v3_rewritten": False,
    }


def test_source_sha256_drift_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    real_sha256_path = builder._sha256_path
    target = builder.SOURCE_SPECS["private_import_receipt"].path

    def drifted(path):
        if path == target:
            return "0" * 64
        return real_sha256_path(path)

    monkeypatch.setattr(builder, "_sha256_path", drifted)
    with pytest.raises(
        builder.NarrationProfileEvidenceError,
        match="private_import_receipt SHA-256 drifted",
    ):
        builder.build_bundle()


@pytest.mark.parametrize(
    ("field", "mutated_value", "message"),
    [
        ("provider", "other", "account provider drifted"),
        ("source", "other", "account evidence source drifted"),
        ("observed_at", "2026-08-09T04:55:01Z", "observed_at drifted"),
        ("plan", "free", "account plan drifted"),
        ("account_status", "inactive", "account status drifted"),
        ("commercial_use", False, "commercial-use evidence drifted"),
        ("model_training_contribution", True, "training-contribution evidence drifted"),
        ("standard_logging_acknowledged", False, "standard-logging evidence drifted"),
        ("output_format_id", "mp3_44100_96", "output-format evidence drifted"),
        ("zero_retention", True, "zero-retention evidence drifted"),
    ],
)
def test_account_claim_mutation_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    mutated_value,
    message: str,
) -> None:
    real_load_json = builder._load_json
    account_path = builder.SOURCE_SPECS["provider_account_claims_redacted"].path

    def mutated(path):
        value = real_load_json(path)
        if path == account_path:
            value = copy.deepcopy(value)
            value[field] = mutated_value
        return value

    monkeypatch.setattr(builder, "_load_json", mutated)
    with pytest.raises(builder.NarrationProfileEvidenceError, match=message):
        builder.build_bundle()


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        ("private_source", "private account-source binding drifted"),
        ("omitted_fields", "redacted account omission list drifted"),
    ],
)
def test_account_source_binding_or_redaction_mutation_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
    message: str,
) -> None:
    real_load_json = builder._load_json
    account_path = builder.SOURCE_SPECS["provider_account_claims_redacted"].path

    def mutated(path):
        value = real_load_json(path)
        if path == account_path:
            value = copy.deepcopy(value)
            if mutation == "private_source":
                value["private_source"]["sha256"] = "0" * 64
            else:
                value["omitted_field_groups"] = []
        return value

    monkeypatch.setattr(builder, "_load_json", mutated)
    with pytest.raises(builder.NarrationProfileEvidenceError, match=message):
        builder.build_bundle()


def test_cross_source_identity_mutation_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_load_json = builder._load_json
    packet_path = builder.SOURCE_SPECS["private_import_packet"].path

    def mutated(path):
        value = real_load_json(path)
        if path == packet_path:
            value = copy.deepcopy(value)
            narration = next(
                row for row in value["assets"] if row.get("kind") == "narration"
            )
            narration["sha256"] = "0" * 64
        return value

    monkeypatch.setattr(builder, "_load_json", mutated)
    with pytest.raises(
        builder.NarrationProfileEvidenceError,
        match="packet SHA drifted",
    ):
        builder.build_bundle()


def test_attestation_time_or_hash_mutation_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = list(builder.ATTESTATION_ROWS)
    asset_id, _timestamp = rows[-1]
    rows[-1] = (asset_id, "2026-08-10T20:19:18Z")
    monkeypatch.setattr(builder, "ATTESTATION_ROWS", tuple(rows))
    with pytest.raises(
        builder.NarrationProfileEvidenceError,
        match="live attestation set drifted",
    ):
        builder.build_bundle()


def test_profile_schema_mutation_is_rejected() -> None:
    profile = builder.build_profile()
    profile["generation"]["bitrate_kbps"] = 96
    manifest = builder._verified_sources()["private_manifest_v3"]
    with pytest.raises(ValidationError):
        builder._validate_profile_on_manifest(profile, manifest)
