import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from dashboard import server
from dashboard.server import (
    AuthoredOriginalDraftRequest,
    OriginalNarrationProfileV1,
)
from db import store
from db import originals_cultural_review as cultural
from db import original_manifest_v2 as manifest_v2_module
from db.original_manifest_v2 import (
    OriginalManifestV2Error,
    compile_original_manifest_v2_selection,
    normalize_original_manifest_v2,
)
from db.originals_cultural_review import OriginalCulturalReviewError
from db.originals_operational import (
    OriginalOperationalReadinessError,
    load_operational_candidate,
    manifest_operational_fields,
    operational_candidate_sha256,
)
from db.originals_route_evidence import canonical_sha256
from scripts.build_smokies_source_dossiers import build_dossier


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
    operational = manifest_operational_fields(
        load_operational_candidate(), "foothills_parkway"
    )
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
            "id": "foothills_parkway",
            "sequence": 1,
            "title": "Foothills Parkway",
            "summary": "A test-only chapter used to verify the versioned contract.",
            "default_variant_id": "eastbound",
            "safety": v1["safety"],
            "access": v1["access"],
            "season": v1["season"],
            "operational_sources": operational["operational_sources"],
            "operational_readiness": operational["operational_readiness"],
            "validation_selection": {
                "selection_id": "foothills_parkway_all_variants",
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


def _v2_with_variant_override() -> dict:
    payload = _v2_payload()
    chapter = payload["manifest"]["chapters"][0]
    reverse = copy.deepcopy(chapter["variants"][0])
    reverse.update({"id": "westbound", "sequence": 2, "title": "Westbound"})
    reverse["route"]["geometry"]["coordinates"] = list(reversed(
        reverse["route"]["geometry"]["coordinates"],
    ))
    reverse["cue_refs"] = list(reversed(reverse["cue_refs"]))
    for sequence, cue in enumerate(reverse["cue_refs"], start=1):
        cue["sequence"] = sequence
    chapter["variants"].append(reverse)
    chapter["validation_selection"]["required_variant_ids"] = [
        "eastbound", "westbound",
    ]
    base_asset = next(
        asset for asset in payload["manifest"]["assets"]
        if asset["id"] == payload["manifest"]["stories"][0]["audio_asset_id"]
    )
    alternate_asset = copy.deepcopy(base_asset)
    alternate_asset.update({
        "id": "narration-directional-westbound",
        "path": "placeholder://smokies/audio/narration-directional-westbound.mp3",
        "sha256": "f" * 64,
    })
    payload["manifest"]["assets"].append(alternate_asset)
    payload["manifest"]["stories"][0]["variant_overrides"] = [{
        "chapter_id": "foothills_parkway",
        "variant_id": "westbound",
        "title": "Westbound opening",
        "transcript": "A reviewed westbound transcript follows the same sourced claim set.",
        "audio_asset_id": alternate_asset["id"],
        "audio_duration_s": 31.0,
    }]
    return payload


def _test_route_evidence(manifest: dict) -> tuple[dict, dict]:
    variants = []
    for chapter in manifest["chapters"]:
        for variant in chapter["variants"]:
            geometry = copy.deepcopy(variant["route"]["geometry"])
            variants.append({
                "chapter_id": chapter["id"],
                "variant_id": variant["id"],
                "status": "official_geometry_candidate",
                "geometry_ready_for_editorial_cues": True,
                "blocking_issues": [],
                "geometry": geometry,
                "geometry_sha256": canonical_sha256(geometry),
                "distance_m": variant["route"]["distance_m"],
            })
    evidence = {
        "schema_version": 1,
        "kind": "trailhead_original_official_route_evidence",
        "product_id": "original_moab_canyons_to_sky",
        "publication_status": "ready_for_publication",
        "publication_blockers": [],
        "route_spec_sha256": "a" * 64,
        "source_snapshot_sha256": "b" * 64,
        "source_policy": {
            "geometry_authority": "nps_public_roads",
            "license": "us-pd",
            "mapbox_candidate_geometry_persisted": False,
        },
        "variants": variants,
    }
    binding = {
        "schema_version": 1,
        "evidence_id": "test-original-routes-v1",
        "evidence_sha256": canonical_sha256(evidence),
        "product_id": evidence["product_id"],
        "route_spec_sha256": evidence["route_spec_sha256"],
        "source_snapshot_sha256": evidence["source_snapshot_sha256"],
    }
    return evidence, binding


def _verified_assets_for_v2(payload: dict) -> dict[str, dict]:
    stories_by_asset = {
        story["audio_asset_id"]: story
        for story in payload["manifest"]["stories"]
    }
    verified: dict[str, dict] = {}
    for asset in payload["manifest"]["assets"]:
        record = {
            "kind": asset["kind"],
            "mime_type": asset["mime_type"],
            "byte_count": asset["bytes"],
            "sha256": asset["sha256"],
            "media_metadata_json": "{}",
        }
        story = stories_by_asset.get(asset["id"])
        if story is not None:
            record["transcript_sha256"] = store.original_transcript_sha256(
                story["transcript"]
            )
            record["media_metadata_json"] = json.dumps({
                "duration_s": story["audio_duration_s"],
            })
        verified[asset["id"]] = record
    return verified


def _v2_preview_row(payload: dict) -> dict:
    return {
        "id": payload["pack_id"],
        "draft_revision": 1,
        "draft_title": payload["title"],
        "draft_original_manifest_json": json.dumps(payload["manifest"]),
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
        chapter_id="foothills_parkway",
        variant_id=None,
        normalize_v1=store._normalize_original_manifest_v1,
    )
    compiled = compiled_selection["manifest"]
    assert compiled_selection["selection"] == {
        "validation_selection_id": "foothills_parkway_all_variants",
        "chapter_id": "foothills_parkway",
        "variant_id": "eastbound",
    }
    assert compiled["schema_version"] == 1
    assert compiled["title"].endswith("\u2014 Foothills Parkway")
    assert [stop["id"] for stop in compiled["stops"]] == [
        stop["id"] for stop in payload["manifest"]["stories"]
    ]


def test_v2_directional_override_compiles_only_for_its_exact_selection():
    payload = _v2_with_variant_override()
    parsed = AuthoredOriginalDraftRequest.model_validate(payload)
    normalized, _ = store._normalize_original_manifest(
        payload["pack_id"],
        payload["title"],
        parsed.manifest.model_dump(mode="json", exclude_none=True),
    )
    east = compile_original_manifest_v2_selection(
        normalized,
        chapter_id="foothills_parkway",
        variant_id="eastbound",
        normalize_v1=store._normalize_original_manifest_v1,
    )["manifest"]
    west = compile_original_manifest_v2_selection(
        normalized,
        chapter_id="foothills_parkway",
        variant_id="westbound",
        normalize_v1=store._normalize_original_manifest_v1,
    )["manifest"]
    story_id = payload["manifest"]["stories"][0]["id"]
    east_stop = next(stop for stop in east["stops"] if stop["id"] == story_id)
    west_stop = next(stop for stop in west["stops"] if stop["id"] == story_id)
    assert east_stop["audio_asset_id"] != "narration-directional-westbound"
    assert west_stop["title"] == "Westbound opening"
    assert west_stop["transcript"].startswith("A reviewed westbound transcript")
    assert west_stop["audio_asset_id"] == "narration-directional-westbound"
    assert west_stop["audio_duration_s"] == 31.0


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda override: override.update({"variant_id": "missing"}), "unknown chapter route variant"),
        (lambda override: override.update({"chapter_id": "missing"}), "unknown chapter route variant"),
        (lambda override: override.update({"audio_asset_id": "missing"}), "must reference a narration asset"),
    ],
)
def test_v2_directional_override_rejects_unknown_selection_or_asset(mutation, message):
    payload = _v2_with_variant_override()
    mutation(payload["manifest"]["stories"][0]["variant_overrides"][0])
    with pytest.raises(OriginalManifestV2Error, match=message):
        normalize_original_manifest_v2(
            payload["manifest"],
            pack_id=payload["pack_id"],
            title=payload["title"],
            version=None,
            normalize_v1=store._normalize_original_manifest_v1,
        )


def test_v2_directional_override_rejects_duplicate_and_unused_selection():
    payload = _v2_with_variant_override()
    override = payload["manifest"]["stories"][0]["variant_overrides"][0]
    payload["manifest"]["stories"][0]["variant_overrides"].append(copy.deepcopy(override))
    with pytest.raises(OriginalManifestV2Error, match="override selections must be unique"):
        normalize_original_manifest_v2(
            payload["manifest"],
            pack_id=payload["pack_id"],
            title=payload["title"],
            version=None,
            normalize_v1=store._normalize_original_manifest_v1,
        )

    payload = _v2_with_variant_override()
    story = payload["manifest"]["stories"][0]
    story["variant_overrides"][0].update({
        "title": story["title"],
        "transcript": story["transcript"],
        "audio_asset_id": story["audio_asset_id"],
        "audio_duration_s": story["audio_duration_s"],
    })
    with pytest.raises(OriginalManifestV2Error, match="must change its effective narration"):
        normalize_original_manifest_v2(
            payload["manifest"],
            pack_id=payload["pack_id"],
            title=payload["title"],
            version=None,
            normalize_v1=store._normalize_original_manifest_v1,
        )

    payload = _v2_with_variant_override()
    payload["manifest"]["chapters"][0]["variants"][1]["cue_refs"] = [
        cue for cue in payload["manifest"]["chapters"][0]["variants"][1]["cue_refs"]
        if cue["story_id"] != payload["manifest"]["stories"][0]["id"]
    ]
    for sequence, cue in enumerate(
        payload["manifest"]["chapters"][0]["variants"][1]["cue_refs"], start=1,
    ):
        cue["sequence"] = sequence
    with pytest.raises(OriginalManifestV2Error, match="unused by that route variant"):
        normalize_original_manifest_v2(
            payload["manifest"],
            pack_id=payload["pack_id"],
            title=payload["title"],
            version=None,
            normalize_v1=store._normalize_original_manifest_v1,
        )


def test_v2_directional_override_rechecks_exact_cultural_transcript_hash(monkeypatch):
    payload = _v2_with_variant_override()
    override = payload["manifest"]["stories"][0]["variant_overrides"][0]
    rejected_hash = manifest_v2_module.hashlib.sha256(
        override["transcript"].encode("utf-8")
    ).hexdigest()
    observed_hashes: list[str] = []

    def approval_gate(**kwargs):
        observed_hashes.append(kwargs["transcript_sha256"])
        if kwargs["transcript_sha256"] == rejected_hash:
            raise OriginalCulturalReviewError("Directional script was not culturally approved")

    monkeypatch.setattr(
        manifest_v2_module,
        "validate_cultural_claim_approval",
        approval_gate,
    )
    with pytest.raises(OriginalManifestV2Error, match="not culturally approved"):
        normalize_original_manifest_v2(
            payload["manifest"],
            pack_id=payload["pack_id"],
            title=payload["title"],
            version=None,
            normalize_v1=store._normalize_original_manifest_v1,
        )
    assert rejected_hash in observed_hashes


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


def test_v2_publication_requires_and_forwards_exact_per_variant_validation():
    payload = _v2_payload()
    payload["manifest"]["narration_profile"] = _test_profile()
    second = copy.deepcopy(payload["manifest"]["chapters"][0]["variants"][0])
    second.update({"id": "westbound", "sequence": 2, "title": "Westbound"})
    second["route"]["geometry"]["coordinates"] = list(reversed(
        second["route"]["geometry"]["coordinates"],
    ))
    payload["manifest"]["chapters"][0]["variants"].append(second)
    payload["manifest"]["chapters"][0]["validation_selection"]["required_variant_ids"] = [
        "eastbound", "westbound",
    ]
    calls: list[dict] = []

    def normalize_v1(_pack_id: str, _title: str, manifest: dict, **kwargs: object):
        calls.append({"manifest": manifest, **kwargs})
        return manifest, json.dumps(manifest, sort_keys=True)

    expected = {
        "foothills_parkway_all_variants:eastbound",
        "foothills_parkway_all_variants:westbound",
    }
    route_evidence, binding = _test_route_evidence(payload["manifest"])
    payload["manifest"]["route_evidence"] = binding
    with pytest.raises(OriginalManifestV2Error, match="every chapter variant"):
        normalize_original_manifest_v2(
            payload["manifest"],
            pack_id=payload["pack_id"],
            title=payload["title"],
            version=1,
            normalize_v1=normalize_v1,
            publishing=True,
            validated_selections={"foothills_parkway_all_variants:eastbound"},
        )
    normalized, _ = normalize_original_manifest_v2(
        payload["manifest"],
        pack_id=payload["pack_id"],
        title=payload["title"],
        version=1,
        normalize_v1=normalize_v1,
        publishing=True,
        validated_selections=expected,
        route_evidence_document=route_evidence,
    )
    assert normalized["schema_version"] == 2
    assert len(calls) == 2
    assert all(call["publishing"] is True for call in calls)
    assert {
        call["manifest"]["route"]["geometry"]["coordinates"][0][0]
        for call in calls
    } == {
        payload["manifest"]["chapters"][0]["variants"][0]["route"]["geometry"]["coordinates"][0][0],
        second["route"]["geometry"]["coordinates"][0][0],
    }


def test_v2_publication_requires_server_owned_route_evidence():
    payload = _v2_payload()
    payload["manifest"]["narration_profile"] = _test_profile()
    with pytest.raises(OriginalManifestV2Error, match="server-owned route evidence"):
        normalize_original_manifest_v2(
            payload["manifest"],
            pack_id=payload["pack_id"],
            title=payload["title"],
            version=1,
            normalize_v1=lambda *_args, **_kwargs: ({}, "{}"),
            publishing=True,
            validated_selections={"foothills_parkway_all_variants:eastbound"},
        )


def test_v2_route_evidence_is_server_only_consumer_metadata():
    payload = _v2_payload()
    evidence, binding = _test_route_evidence(payload["manifest"])
    payload["manifest"]["route_evidence"] = binding
    normalized, _ = normalize_original_manifest_v2(
        payload["manifest"],
        pack_id=payload["pack_id"],
        title=payload["title"],
        version=1,
        normalize_v1=store._normalize_original_manifest_v1,
        route_evidence_document=evidence,
    )
    assert normalized["route_evidence"] == binding
    assert "route_evidence" not in store._original_manifest_for_client(normalized)
    assert store._original_manifest_preview(normalized)["route_evidence"] == binding


def test_v2_compiled_selection_carries_operational_sources_once():
    payload = _v2_payload()
    normalized, _ = store._normalize_original_manifest(
        payload["pack_id"], payload["title"], payload["manifest"], version=2,
    )
    selection = compile_original_manifest_v2_selection(
        normalized,
        chapter_id="foothills_parkway",
        variant_id="eastbound",
        normalize_v1=store._normalize_original_manifest_v1,
    )
    stops = selection["manifest"]["stops"]
    assert any(source["role"] == "operational" for source in stops[0]["citations"])
    assert all(
        source["role"] != "operational"
        for stop in stops[1:]
        for source in stop["citations"]
    )
    compiled = store._compiled_original_validation_selections(normalized)
    assert [item["key"] for item in compiled] == [
        "foothills_parkway_all_variants:eastbound",
    ]
    material = store._original_validation_material(normalized, draft_revision=4)
    assert material["operational_readiness_candidates"] == [{
        "chapter_id": "foothills_parkway",
        "candidate_id": "smokies-operational-readiness-2026-v1",
        "candidate_sha256": operational_candidate_sha256(
            load_operational_candidate()
        ),
    }]
    assert store._original_operational_publication_metadata(normalized) == {
        "schema_version": 1,
        "candidates": material["operational_readiness_candidates"],
    }
    tampered = copy.deepcopy(normalized)
    tampered["chapters"][0]["operational_readiness"]["candidate_sha256"] = "0" * 64
    with pytest.raises(OriginalOperationalReadinessError, match="hash"):
        store._original_validation_material(tampered, draft_revision=4)


def test_v2_validation_aggregate_never_marks_a_partial_selection_set_publishable():
    base = {
        "engine_version": store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
        "summary": {"required": 13, "passed": 13, "failed": 0, "stop_count": 10},
        "scenarios": [],
        "issues": [],
    }
    aggregate = store._aggregate_original_validation_selection_results([
        {
            **base,
            "key": "foothills_parkway_all_variants:eastbound",
            "selection": {
                "validation_selection_id": "foothills_parkway_all_variants",
                "chapter_id": "foothills_parkway",
                "variant_id": "eastbound",
            },
            "passed": True,
        },
        {
            **base,
            "key": "foothills_parkway_all_variants:westbound",
            "selection": {
                "validation_selection_id": "foothills_parkway_all_variants",
                "chapter_id": "foothills_parkway",
                "variant_id": "westbound",
            },
            "passed": False,
            "summary": {"required": 13, "passed": 12, "failed": 1, "stop_count": 10},
            "issues": ["Scenario failed: reverse_travel"],
        },
    ], execution_errors=False)
    assert aggregate["status"] == "failed"
    assert aggregate["passed"] is False
    assert aggregate["summary"]["selection_count"] == 2
    assert aggregate["summary"]["validated_selections"] == [
        "foothills_parkway_all_variants:eastbound",
    ]
    assert "westbound" in aggregate["issues"][0]


@pytest.mark.parametrize(
    ("chapter_id", "variant_id"),
    [
        (None, None),
        ("foothills_parkway", None),
        (None, "eastbound"),
    ],
)
def test_v2_device_preview_requires_exact_selection(chapter_id, variant_id):
    payload = _v2_payload()
    with pytest.raises(ValueError, match="explicit chapter_id and variant_id"):
        store._authored_original_preview_manifest_from_row(
            _v2_preview_row(payload),
            {},
            chapter_id=chapter_id,
            variant_id=variant_id,
        )


@pytest.mark.parametrize(
    ("chapter_id", "variant_id", "message"),
    [
        ("missing_chapter", "eastbound", "chapter selection was not found"),
        ("foothills_parkway", "missing_variant", "route variant selection was not found"),
    ],
)
def test_v2_device_preview_rejects_unknown_selection(chapter_id, variant_id, message):
    payload = _v2_payload()
    with pytest.raises(OriginalManifestV2Error, match=message):
        store._authored_original_preview_manifest_from_row(
            _v2_preview_row(payload),
            _verified_assets_for_v2(payload),
            chapter_id=chapter_id,
            variant_id=variant_id,
        )


def test_v2_device_preview_compiles_selected_variant_to_hash_bound_v1():
    payload = _v2_payload()
    preview = store._authored_original_preview_manifest_from_row(
        _v2_preview_row(payload),
        _verified_assets_for_v2(payload),
        chapter_id="foothills_parkway",
        variant_id="eastbound",
    )

    assert preview["schema_version"] == 1
    assert preview["pack_id"] == payload["pack_id"]
    assert preview["version"] == store.ORIGINAL_DEVICE_PREVIEW_VERSION_BASE + 1
    assert preview["manifest_id"] == f"original_preview_manifest_{payload['pack_id']}_r1"
    assert preview["route"] == payload["manifest"]["chapters"][0]["variants"][0]["route"]
    assert [item["id"] for item in preview["stops"]] == [
        item["story_id"]
        for item in payload["manifest"]["chapters"][0]["variants"][0]["cue_refs"]
    ]
    assert all(
        asset["path"].startswith(
            f"/api/admin/originals/{payload['pack_id']}/assets/"
        )
        for asset in preview["assets"]
    )


def test_admin_v2_device_preview_endpoint_forwards_selection(monkeypatch):
    captured = {}

    def fake_preview(
        pack_id,
        *,
        chapter_id=None,
        variant_id=None,
        consumer_contract=None,
        consumer_capabilities=None,
    ):
        captured.update({
            "pack_id": pack_id,
            "chapter_id": chapter_id,
            "variant_id": variant_id,
            "consumer_contract": consumer_contract,
            "consumer_capabilities": consumer_capabilities,
        })
        return {"schema_version": 1, "manifest_id": "test_preview"}

    monkeypatch.setattr(server, "get_authored_original_device_preview_manifest", fake_preview)
    previous_override = server.app.dependency_overrides.get(server._require_admin)
    server.app.dependency_overrides[server._require_admin] = lambda: {"id": "test_admin"}
    try:
        response = TestClient(server.app).get(
            "/api/admin/originals/smokies/device-preview/manifest",
            params={
                "chapter_id": "foothills_parkway",
                "variant_id": "eastbound",
            },
        )
    finally:
        if previous_override is None:
            server.app.dependency_overrides.pop(server._require_admin, None)
        else:
            server.app.dependency_overrides[server._require_admin] = previous_override

    assert response.status_code == 200
    assert response.json()["manifest_id"] == "test_preview"
    assert captured == {
        "pack_id": "smokies",
        "chapter_id": "foothills_parkway",
        "variant_id": "eastbound",
        "consumer_contract": None,
        "consumer_capabilities": (),
    }


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
    second["id"] = "test_second_chapter"
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


def test_v2_cultural_approval_evidence_is_all_or_nothing():
    payload = _v2_payload()
    citation = payload["manifest"]["stories"][0]["citations"][0]
    citation.update({
        "cultural_approval_record_id": "ebci_scope_review_001",
        "cultural_approval_record_sha256": "b" * 64,
        "cultural_approved_at": "2026-08-03",
    })
    store._normalize_original_manifest(
        payload["pack_id"], payload["title"], payload["manifest"],
    )
    citation.pop("cultural_approval_record_sha256")
    with pytest.raises(OriginalManifestV2Error, match="approval evidence is incomplete"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )


def test_v2_blocks_ebci_claims_until_an_immutable_approval_is_registered(
    tmp_path,
    monkeypatch,
):
    dossier = build_dossier()
    claim = next(
        item for item in dossier["claims"]
        if item["id"] == "mc_kuwohi_public_record"
    )
    claim.update({
        "status": "cultural_review_required",
        "cultural_gate": "ebci_required",
        "cultural_scope": {
            "classification": "immutable_ebci_review_required",
            "collection_method": "direct_ebci_member_research",
            "review_triggers": ["direct_ebci_member_research"],
        },
    })
    blocked_ids = {"mc_story_15", "mc_cue_07"}
    dossier["cultural_review"].update({
        "status": "required_before_drafting",
        "blocked_entry_ids": sorted(blocked_ids),
    })
    for entry in dossier["entries"]:
        if entry["id"] in blocked_ids:
            entry["script_status"] = "blocked_cultural_review"
    dossier_path = tmp_path / "gated-smokies-dossier.json"
    dossier_path.write_text(
        json.dumps(dossier, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        encoding="utf-8",
    )
    monkeypatch.setattr(cultural, "DEFAULT_SMOKIES_SOURCE_DOSSIER", dossier_path)
    cultural._dossier_registry.cache_clear()

    payload = _v2_payload()
    payload["pack_id"] = "great_smoky_mountains_ridges_rivers_living_memory"
    story = payload["manifest"]["stories"][0]
    story["id"] = "mc_story_15"
    for citation in story["citations"]:
        citation["affected_claims"] = ["mc_kuwohi_public_record"]
    payload["manifest"]["stories"] = [story]
    cue = payload["manifest"]["chapters"][0]["variants"][0]["cue_refs"][0]
    cue["story_id"] = "mc_story_15"
    cue["sequence"] = 1
    payload["manifest"]["chapters"][0]["variants"][0]["cue_refs"] = [cue]
    citation = story["citations"][0]
    with pytest.raises(OriginalManifestV2Error, match="EBCI cultural review"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )
    citation.update({
        "cultural_approval_record_id": "unregistered_review",
        "cultural_approval_record_sha256": "c" * 64,
        "cultural_approved_at": "2026-08-03",
        "cultural_pronunciation_bundle_sha256": "d" * 64,
    })
    with pytest.raises(OriginalManifestV2Error, match="not registered"):
        store._normalize_original_manifest(
            payload["pack_id"], payload["title"], payload["manifest"],
        )
    cultural._dossier_registry.cache_clear()


def test_v2_public_record_scope_does_not_bypass_exact_story_binding():
    payload = _v2_payload()
    payload["pack_id"] = "great_smoky_mountains_ridges_rivers_living_memory"
    with pytest.raises(
        OriginalManifestV2Error,
        match="story moab_story_01 is not registered in the Smokies source dossier",
    ):
        store._normalize_original_manifest(
            payload["pack_id"],
            payload["title"],
            payload["manifest"],
            publishing=True,
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
