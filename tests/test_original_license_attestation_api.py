import asyncio

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from dashboard import server
from db.store import (
    OriginalAssetSha256ConflictError,
    OriginalLicenseAttestationConflictError,
    RevisionConflictError,
)


SHA_A = "a" * 64
SHA_B = "b" * 64


def _request(**overrides):
    payload = {
        "expected_sha256": SHA_A,
        "expected_draft_revision": 7,
        "terms_id": "elevenlabs_commercial_terms",
        "terms_url": "https://elevenlabs.io/terms-of-use",
        "terms_version": "2026-03-31",
        "reviewed_at": "2026-08-10",
    }
    payload.update(overrides)
    return server.OriginalGeneratorLicenseAttestationRequest.model_validate(payload)


def test_attestation_request_requires_exact_asset_revision_and_review_date():
    request = _request()
    assert request.expected_sha256 == SHA_A
    assert request.expected_draft_revision == 7
    assert request.reviewed_at == "2026-08-10"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("expected_sha256", "A" * 64),
        ("expected_sha256", "a" * 63),
        ("expected_sha256", "a" * 65),
        ("expected_draft_revision", 0),
        ("expected_draft_revision", True),
        ("expected_draft_revision", "7"),
        ("reviewed_at", "2026-08-10T00:00:00Z"),
        ("reviewed_at", "2026-8-10"),
    ],
)
def test_attestation_request_rejects_ambiguous_bindings(field, value):
    with pytest.raises(ValidationError):
        _request(**{field: value})


@pytest.mark.parametrize("missing", ["expected_sha256", "expected_draft_revision"])
def test_attestation_request_requires_both_stale_write_guards(missing):
    payload = _request().model_dump()
    payload.pop(missing)
    with pytest.raises(ValidationError):
        server.OriginalGeneratorLicenseAttestationRequest.model_validate(payload)


def test_attestation_request_forbids_unknown_fields():
    with pytest.raises(ValidationError):
        _request(client_attested_at="2026-08-10T00:00:00Z")


def test_attestation_endpoint_forwards_server_owned_admin_and_stale_guards(monkeypatch):
    captured = {}

    def fake_attest(pack_id, asset_id, **kwargs):
        captured.update({"pack_id": pack_id, "asset_id": asset_id, **kwargs})
        return {"ok": True}

    monkeypatch.setattr(server, "attest_authored_original_generator_license", fake_attest)
    result = asyncio.run(
        server.api_admin_attest_original_generator_license(
            "original-pack",
            "story-audio",
            _request(),
            admin={"id": 42},
        )
    )

    assert result == {"ok": True}
    assert captured == {
        "pack_id": "original-pack",
        "asset_id": "story-audio",
        "expected_sha256": SHA_A,
        "expected_draft_revision": 7,
        "terms_id": "elevenlabs_commercial_terms",
        "terms_url": "https://elevenlabs.io/terms-of-use",
        "terms_version": "2026-03-31",
        "reviewed_at": "2026-08-10",
        "admin_user_id": 42,
    }


@pytest.mark.parametrize(
    ("error", "detail"),
    [
        (
            OriginalAssetSha256ConflictError(SHA_A, SHA_B),
            {
                "code": "original_asset_sha256_conflict",
                "message": (
                    "The narration asset changed before its license review was recorded."
                ),
                "expected_sha256": SHA_A,
                "current_sha256": SHA_B,
            },
        ),
        (
            OriginalLicenseAttestationConflictError(
                "original-pack", "story-audio", SHA_A,
            ),
            {
                "code": "original_license_attestation_conflict",
                "message": "This narration already has a different license attestation.",
                "pack_id": "original-pack",
                "asset_id": "story-audio",
                "sha256": SHA_A,
            },
        ),
        (
            RevisionConflictError(9),
            {
                "code": "revision_conflict",
                "message": "This item changed on another device.",
                "current_revision": 9,
            },
        ),
    ],
)
def test_attestation_endpoint_maps_stale_and_conflicting_writes_to_409(
    monkeypatch, error, detail,
):
    def fail_attestation(*_args, **_kwargs):
        raise error

    monkeypatch.setattr(
        server,
        "attest_authored_original_generator_license",
        fail_attestation,
    )
    with pytest.raises(HTTPException) as raised:
        asyncio.run(
            server.api_admin_attest_original_generator_license(
                "original-pack",
                "story-audio",
                _request(),
                admin={"id": 42},
            )
        )

    assert raised.value.status_code == 409
    assert raised.value.detail == detail
