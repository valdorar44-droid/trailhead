import copy
import json

import pytest
from pydantic import ValidationError

from dashboard.server import OriginalNarrationProfileV1, OriginalNarrationProfileV2
from db import store
from db.original_manifest_v2 import (
    OriginalManifestV2Error,
    validate_original_narration_profile_asset,
)
from tests.test_original_manifest_v2 import _test_profile, _v2_payload


def _profile_v2() -> dict:
    return {
        "schema_version": 2,
        "provider": "elevenlabs",
        "voice_id": "EkK5I93UQWFDigLMpZcX",
        "model_snapshot": "eleven_multilingual_v2",
        "api_version": "elevenlabs_text_to_speech_v1",
        "language": "en",
        "generation": {
            "output_format": "mp3_44100_128",
            "mime_type": "audio/mpeg",
            "sample_rate_hz": 44100,
            "bitrate_kbps": 128,
            "channels": 1,
            "provider_native": True,
            "lossless": False,
        },
        "archival_master": {
            "mime_type": "audio/mpeg",
            "sample_rate_hz": 44100,
            "bitrate_kbps": 128,
            "channels": 1,
            "provider_native": True,
            "immutable": True,
            "lossless": False,
        },
        "mobile_delivery": {
            "mime_type": "audio/mpeg",
            "sample_rate_hz": 44100,
            "bitrate_kbps": 128,
            "channels": 1,
            "lossless": False,
            "transcoded": False,
            "byte_identical_to_archival_master": True,
        },
        "commercial_license": {
            "status": "verified",
            "plan": "creator",
            "commercial_use_allowed": True,
            "terms_id": "elevenlabs-terms-of-service",
            "terms_url": "https://elevenlabs.io/terms-of-use",
            "terms_version": "reviewed-2026-08-08",
            "reviewed_at": "2026-08-08",
            "verified_at": "2026-08-08T00:00:00Z",
        },
        "training_contribution": {
            "status": "disabled",
            "confirmed_at": "2026-08-08T00:00:00Z",
        },
        "provider_data_retention": {
            "status": "provider_standard",
            "zero_retention": False,
            "confirmed_at": "2026-08-08T00:00:00Z",
        },
    }


def _verified_asset(profile: dict) -> dict:
    commercial = profile["commercial_license"]
    return {
        "kind": "narration",
        "mime_type": "audio/mpeg",
        "media_metadata_json": json.dumps({
            "format": "mp3",
            "duration_s": 215.118,
            "sample_rate_hz": 44100,
            "bitrate_kbps": 128,
            "channels": 1,
        }),
        "generator_metadata_json": json.dumps({
            "provider": "elevenlabs",
            "model_id": "eleven_multilingual_v2",
            "voice_id": profile["voice_id"],
            "output_format": "mp3_44100_128",
            "provider_native_master": True,
            "lossless_master_claimed": False,
            "transcoded": False,
            "license_status": "attested",
            "license_attestation": {
                "terms_id": commercial["terms_id"],
                "terms_url": commercial["terms_url"],
                "terms_version": commercial["terms_version"],
                "reviewed_at": commercial["reviewed_at"],
                "attested_at": "2026-08-08T00:00:00Z",
                "attested_by_admin_user_id": 1,
            },
        }),
    }


def test_profile_v2_is_additive_and_preserves_profile_v1_contract():
    assert OriginalNarrationProfileV1.model_validate(_test_profile()).schema_version == 1
    profile = OriginalNarrationProfileV2.model_validate(_profile_v2())
    assert profile.commercial_license.plan == "creator"
    assert profile.archival_master.lossless is False
    assert profile.mobile_delivery.transcoded is False


@pytest.mark.parametrize(("path", "value", "message"), [
    (("generation", "provider_native"), False, "provider-native"),
    (("generation", "provider_native"), 1, "provider-native"),
    (("archival_master", "lossless"), True, "provider-native"),
    (("archival_master", "lossless"), 0, "provider-native"),
    (("mobile_delivery", "transcoded"), True, "provider-native"),
    (("commercial_license", "status"), "attested", "verified commercial-use"),
    (("commercial_license", "plan"), "pro", "verified commercial-use"),
    (("training_contribution", "status"), "enabled", "must be disabled"),
    (("provider_data_retention", "zero_retention"), True, "zero_retention false"),
    (("provider_data_retention", "zero_retention"), 0, "zero_retention false"),
])
def test_profile_v2_normalization_fails_closed(path, value, message):
    payload = _v2_payload()
    profile = _profile_v2()
    profile[path[0]][path[1]] = value
    payload["manifest"]["narration_profile"] = profile
    with pytest.raises(OriginalManifestV2Error, match=message):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )


def test_profile_v2_strict_request_model_rejects_zero_retention_and_unknown_fields():
    zero_retention = _profile_v2()
    zero_retention["provider_data_retention"]["zero_retention"] = True
    with pytest.raises(ValidationError):
        OriginalNarrationProfileV2.model_validate(zero_retention)

    unknown = _profile_v2()
    unknown["mobile_delivery"]["source_note"] = "provider native"
    with pytest.raises(ValidationError):
        OriginalNarrationProfileV2.model_validate(unknown)


def test_profile_v2_normalizes_but_remains_server_only():
    payload = _v2_payload()
    payload["manifest"]["narration_profile"] = _profile_v2()
    normalized, _ = store._normalize_original_manifest(
        payload["pack_id"], payload["title"], payload["manifest"], version=7,
    )
    assert normalized["narration_profile"]["schema_version"] == 2
    assert normalized["narration_profile"]["mobile_delivery"]["transcoded"] is False

    consumer = store._original_manifest_for_client(normalized)
    preview = store._original_manifest_preview(normalized)
    public_json = json.dumps({"consumer": consumer, "preview": preview}, sort_keys=True)
    assert "narration_profile" not in public_json
    assert "elevenlabs" not in public_json
    assert "EkK5I93UQWFDigLMpZcX" not in public_json


def test_profile_v2_publication_asset_binding_accepts_exact_native_bytes():
    profile = _profile_v2()
    validate_original_narration_profile_asset(
        profile,
        _verified_asset(profile),
        label="Original narration asset story-1",
    )


@pytest.mark.parametrize(("container", "field", "value", "message"), [
    ("media", "bitrate_kbps", 96, "verified bytes"),
    ("media", "channels", 2, "verified bytes"),
    ("generator", "transcoded", True, "generator provenance"),
    ("generator", "zero_retention", True, "zero retention"),
])
def test_profile_v2_publication_asset_binding_rejects_false_provenance(
    container, field, value, message,
):
    profile = _profile_v2()
    verified = _verified_asset(profile)
    key = "media_metadata_json" if container == "media" else "generator_metadata_json"
    metadata = json.loads(verified[key])
    metadata[field] = value
    verified[key] = json.dumps(metadata)
    with pytest.raises(OriginalManifestV2Error, match=message):
        validate_original_narration_profile_asset(
            profile,
            verified,
            label="Original narration asset story-1",
        )


def test_profile_v2_publication_asset_binding_rejects_different_terms():
    profile = _profile_v2()
    verified = _verified_asset(profile)
    generator = json.loads(verified["generator_metadata_json"])
    generator["license_attestation"]["terms_version"] = "different"
    verified["generator_metadata_json"] = json.dumps(generator)
    with pytest.raises(OriginalManifestV2Error, match="commercial terms"):
        validate_original_narration_profile_asset(
            profile,
            verified,
            label="Original narration asset story-1",
        )


def test_profile_v2_pydantic_payload_does_not_mutate_input():
    profile = _profile_v2()
    before = copy.deepcopy(profile)
    OriginalNarrationProfileV2.model_validate(profile)
    assert profile == before
