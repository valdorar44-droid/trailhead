import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from dashboard.server import (
    AuthoredOriginalDraftRequest,
    OriginalNarrationProfileV1,
)
from db import store
from db.original_manifest_v2 import (
    OriginalManifestV2Error,
    compile_original_manifest_v2_selection,
)


FIXTURE_PATH = (
    Path(__file__).parent
    / "fixtures"
    / "originals"
    / "moab_canyons_to_sky_draft.json"
)


def _v1_payload() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _v2_payload() -> dict:
    payload = _v1_payload()
    v1 = payload["manifest"]
    for asset in v1["assets"]:
        if asset.get("kind") == "narration":
            asset["mime_type"] = "audio/mpeg"
            asset["path"] = f"placeholder://smokies/audio/{asset['id']}.mp3"
    stories = []
    for index, stop in enumerate(v1["stops"]):
        citations = [{
            "title": citation["title"],
            "url": citation["url"],
            "publisher": citation.get("publisher") or "Test-only source publisher",
            "role": "story",
            "authority": "official",
            "reviewed_at": "2026-08-03",
            "rights_status": "reference_only",
            "affected_claims": [f"{stop['id']}.claim_1"],
        } for citation in stop["citations"]]
        stories.append({
            "id": stop["id"],
            "kind": "story" if index % 2 == 0 else "cue",
            "title": stop["title"],
            "transcript": stop["transcript"],
            "audio_asset_id": stop["audio_asset_id"],
            "audio_duration_s": stop["audio_duration_s"],
            "citations": citations,
        })
    cue_refs = [{
        "story_id": stop["id"],
        "sequence": stop["sequence"],
        "coordinates": stop["coordinates"],
        "trigger": stop["trigger"],
    } for stop in v1["stops"]]
    source = {
        "title": "Test-only official operating conditions",
        "url": "https://www.nps.gov/grsm/planyourvisit/conditions.htm",
        "publisher": "National Park Service",
        "reviewed_at": "2026-08-03",
        "role": "operational",
        "authority": "official",
        "scope": ["route", "access", "fees", "closures", "surface", "season", "safety"],
    }
    payload["access_policy"] = {
        "schema_version": 1,
        "explorer_included": True,
        "permanent_credit_price": 900,
    }
    payload["price_credits"] = 900
    payload["manifest"] = {
        "schema_version": 2,
        "locale": v1["locale"],
        "title": payload["title"],
        "stories": stories,
        "chapters": [{
            "id": "mountain_crossing",
            "sequence": 1,
            "title": "Mountain Crossing",
            "summary": "A test-only chapter used to verify the versioned contract.",
            "default_variant_id": "eastbound",
            "safety": v1["safety"],
            "access": v1["access"],
            "season": v1["season"],
            "operational_sources": [source],
            "operational_readiness": {
                "policy": "required_before_start",
                "source_scopes": source["scope"],
                "alternate_chapter_ids": [],
            },
            "validation_selection": {
                "selection_id": "mountain_crossing_all_variants",
                "required_variant_ids": ["eastbound"],
            },
            "variants": [{
                "id": "eastbound",
                "sequence": 1,
                "title": "Eastbound",
                "route": v1["route"],
                "cue_refs": cue_refs,
            }],
        }],
        "assets": v1["assets"],
        "offline_map": v1["offline_map"],
        "review": v1["review"],
    }
    return payload


def _test_profile() -> dict:
    return {
        "schema_version": 1,
        "provider": "cartesia",
        "voice_id": "test-only-voice",
        "model_snapshot": "sonic-3.5-2026-05-04",
        "api_version": "test-only-api-version",
        "language": "en",
        "generation": {"output_format": "wav", "sample_rate_hz": 44100, "channels": 1},
        "archival_master": {
            "mime_type": "audio/wav",
            "sample_rate_hz": 44100,
            "channels": 1,
            "bit_depth": 24,
        },
        "mobile_delivery": {
            "mime_type": "audio/mpeg",
            "bitrate_kbps": 96,
            "sample_rate_hz": 44100,
            "channels": 1,
        },
        "commercial_license": {
            "status": "attested",
            "plan": "pro",
            "attested_at": "2026-08-03T00:00:00Z",
        },
        "training_opt_out": {
            "status": "confirmed",
            "confirmed_at": "2026-08-03T00:00:00Z",
        },
    }


def test_v1_request_and_normalizer_remain_unchanged():
    payload = _v1_payload()
    parsed = AuthoredOriginalDraftRequest.model_validate(payload)
    assert parsed.manifest.schema_version == 1
    normalized, _ = store._normalize_original_manifest(
        payload["pack_id"], payload["title"], payload["manifest"],
    )
    assert normalized["schema_version"] == 1
    assert len(normalized["stops"]) == len(payload["manifest"]["stops"])


def test_v2_draft_normalizes_and_compiles_deterministically_to_v1():
    payload = _v2_payload()
    parsed = AuthoredOriginalDraftRequest.model_validate(payload)
    assert parsed.manifest.schema_version == 2
    normalized, first_json = store._normalize_original_manifest(
        payload["pack_id"], payload["title"], parsed.manifest.model_dump(mode="json", exclude_none=True),
    )
    again, second_json = store._normalize_original_manifest(
        payload["pack_id"], payload["title"], copy.deepcopy(normalized),
    )
    assert normalized == again
    assert first_json == second_json
    compiled_selection = compile_original_manifest_v2_selection(
        normalized,
        chapter_id="mountain_crossing",
        variant_id=None,
        normalize_v1=store._normalize_original_manifest_v1,
    )
    compiled = compiled_selection["manifest"]
    assert compiled_selection["selection"] == {
        "validation_selection_id": "mountain_crossing_all_variants",
        "chapter_id": "mountain_crossing",
        "variant_id": "eastbound",
    }
    assert compiled["schema_version"] == 1
    assert compiled["title"].endswith("\u2014 Mountain Crossing")
    assert [stop["id"] for stop in compiled["stops"]] == [
        stop["id"] for stop in payload["manifest"]["stories"]
    ]


def test_v2_preview_redacts_transcripts_and_narration_provider():
    payload = _v2_payload()
    payload["manifest"]["narration_profile"] = _test_profile()
    normalized, _ = store._normalize_original_manifest(
        payload["pack_id"], payload["title"], payload["manifest"], version=3,
    )
    consumer = store._original_manifest_for_client(normalized)
    preview = store._original_manifest_preview(normalized)
    rendered = json.dumps(preview, sort_keys=True)
    assert "transcript" not in rendered
    assert "cartesia" not in rendered
    assert "narration_profile" in normalized
    assert "narration_profile" not in consumer
    assert "cartesia" not in json.dumps(consumer, sort_keys=True)
    assert preview["chapters"][0]["variants"][0]["story_count"] == 5
    assert preview["chapters"][0]["variants"][0]["cue_count"] == 5


def test_v2_publication_is_fail_closed_until_every_variant_has_authoritative_validation():
    payload = _v2_payload()
    payload["manifest"]["narration_profile"] = _test_profile()
    with pytest.raises(OriginalManifestV2Error, match="every chapter variant"):
        store._normalize_original_manifest(
            payload["pack_id"],
            payload["title"],
            payload["manifest"],
            version=1,
            publishing=True,
            verified_assets={},
        )


def test_v2_device_preview_fails_with_selection_contract_instead_of_v1_key_error():
    payload = _v2_payload()
    with pytest.raises(ValueError, match="explicit chapter and variant selection"):
        store._authored_original_preview_manifest_from_row({
            "id": payload["pack_id"],
            "draft_revision": 1,
            "draft_title": payload["title"],
            "draft_original_manifest_json": json.dumps(payload["manifest"]),
        }, {})


def test_v2_requires_exact_validation_variant_coverage():
    payload = _v2_payload()
    payload["manifest"]["chapters"][0]["validation_selection"]["required_variant_ids"] = [
        "missing_variant"
    ]
    with pytest.raises(OriginalManifestV2Error, match="must include every variant"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )


def test_v2_union_offline_bounds_must_cover_every_route_and_cue():
    payload = _v2_payload()
    payload["manifest"]["offline_map"]["bounds"] = {
        "north": 1.0, "south": 0.0, "east": 1.0, "west": 0.0,
    }
    with pytest.raises(OriginalManifestV2Error, match="union offline map"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )


def test_v2_validation_selection_ids_are_globally_unique():
    payload = _v2_payload()
    second = copy.deepcopy(payload["manifest"]["chapters"][0])
    second["id"] = "foothills_parkway"
    second["sequence"] = 2
    payload["manifest"]["chapters"].append(second)
    with pytest.raises(OriginalManifestV2Error, match="selection ids must be unique"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )


def test_v2_story_sources_require_rights_and_claim_level_binding():
    payload = _v2_payload()
    payload["manifest"]["stories"][0]["citations"][0].pop("rights_status")
    with pytest.raises(OriginalManifestV2Error, match="source rights are invalid"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )


def test_v2_narration_profile_must_match_immutable_delivery_asset_format():
    payload = _v2_payload()
    payload["manifest"]["narration_profile"] = _test_profile()
    payload["manifest"]["assets"][0]["mime_type"] = "audio/mp4"
    with pytest.raises(OriginalManifestV2Error, match="format does not match"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )


def test_v2_source_review_dates_must_be_iso_dates():
    payload = _v2_payload()
    payload["manifest"]["stories"][0]["citations"][0]["reviewed_at"] = "recently"
    with pytest.raises(OriginalManifestV2Error, match="ISO calendar date"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )


def test_v2_narration_attestations_require_timezone_aware_iso_timestamps():
    payload = _v2_payload()
    payload["manifest"]["narration_profile"] = _test_profile()
    payload["manifest"]["narration_profile"]["training_opt_out"]["confirmed_at"] = (
        "2026-08-03T00:00:00"
    )
    with pytest.raises(OriginalManifestV2Error, match="must include a timezone"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )


def _v2_payload_with_every_optional_internal_object() -> dict:
    payload = _v2_payload()
    payload["manifest"]["narration_profile"] = _test_profile()
    payload["manifest"]["review"]["route_network_override"] = {
        "schema_version": 1,
        "status": "approved",
        "finding_codes": ["seasonal_access"],
        "reason": "The official source documents seasonal access for this route.",
        "official_source_url": "https://www.nps.gov/grsm/planyourvisit/conditions.htm",
        "approved_at": "2026-08-03T00:00:00Z",
        "approved_by_admin_user_id": 1,
    }
    return payload


def _manifest_object_at(root: dict, path: tuple[str | int, ...]) -> dict:
    value: object = root
    for segment in path:
        value = value[segment]  # type: ignore[index]
    assert isinstance(value, dict)
    return value


def test_v2_store_normalizer_accepts_known_optional_nested_objects():
    payload = _v2_payload_with_every_optional_internal_object()
    normalized, _ = store._normalize_original_manifest(
        payload["pack_id"], payload["title"], payload["manifest"],
    )
    assert normalized["review"]["route_network_override"]["status"] == "approved"
    assert normalized["narration_profile"]["provider"] == "cartesia"


@pytest.mark.parametrize(("label", "path"), [
    ("manifest", ()),
    ("offline map", ("offline_map",)),
    ("offline bounds", ("offline_map", "bounds")),
    ("asset", ("assets", 0)),
    ("story", ("stories", 0)),
    ("story source", ("stories", 0, "citations", 0)),
    ("chapter", ("chapters", 0)),
    ("chapter safety", ("chapters", 0, "safety")),
    ("chapter access", ("chapters", 0, "access")),
    ("chapter season", ("chapters", 0, "season")),
    ("operational source", ("chapters", 0, "operational_sources", 0)),
    ("operational readiness", ("chapters", 0, "operational_readiness")),
    ("validation selection", ("chapters", 0, "validation_selection")),
    ("variant", ("chapters", 0, "variants", 0)),
    ("route", ("chapters", 0, "variants", 0, "route")),
    ("route geometry", ("chapters", 0, "variants", 0, "route", "geometry")),
    ("route bounds", ("chapters", 0, "variants", 0, "route", "bounds")),
    ("cue", ("chapters", 0, "variants", 0, "cue_refs", 0)),
    ("cue coordinates", ("chapters", 0, "variants", 0, "cue_refs", 0, "coordinates")),
    ("cue trigger", ("chapters", 0, "variants", 0, "cue_refs", 0, "trigger")),
    ("review", ("review",)),
    ("route network override", ("review", "route_network_override")),
    ("narration profile", ("narration_profile",)),
    ("narration generation", ("narration_profile", "generation")),
    ("narration archive", ("narration_profile", "archival_master")),
    ("narration delivery", ("narration_profile", "mobile_delivery")),
    ("commercial license", ("narration_profile", "commercial_license")),
    ("training opt-out", ("narration_profile", "training_opt_out")),
])
def test_v2_store_normalizer_rejects_unknown_internal_fields_recursively(
    label: str,
    path: tuple[str | int, ...],
):
    payload = _v2_payload_with_every_optional_internal_object()
    _manifest_object_at(payload["manifest"], path)["internal_notes"] = (
        f"must not persist from {label}"
    )
    with pytest.raises(OriginalManifestV2Error, match="unsupported fields: internal_notes"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )


def test_v2_shared_story_ids_are_the_private_analytics_dimensions():
    payload = _v2_payload()
    normalized, _ = store._normalize_original_manifest(
        payload["pack_id"], payload["title"], payload["manifest"],
    )
    assert store._original_manifest_has_event_id(normalized, "moab_story_01")
    assert not store._original_manifest_has_event_id(normalized, "missing_story")
    assert store._original_manifest_has_event_id(
        _v1_payload()["manifest"], "moab_story_01",
    )


def test_narration_profile_is_strict_and_requires_training_opt_out_evidence():
    assert OriginalNarrationProfileV1.model_validate(_test_profile()).provider == "cartesia"
    invalid = _test_profile()
    invalid["training_opt_out"]["status"] = "unknown"
    with pytest.raises(ValidationError):
        OriginalNarrationProfileV1.model_validate(invalid)
    unsupported_delivery = _test_profile()
    unsupported_delivery["mobile_delivery"]["mime_type"] = "audio/mp4"
    with pytest.raises(ValidationError):
        OriginalNarrationProfileV1.model_validate(unsupported_delivery)
