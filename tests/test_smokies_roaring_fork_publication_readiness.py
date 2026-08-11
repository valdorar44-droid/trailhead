import hashlib
import json
from pathlib import Path
import subprocess

import pytest

import scripts.build_smokies_roaring_fork_publication_readiness as builder


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _historical_packet() -> dict:
    raw = builder.OUTPUT_PATH.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == (
        "81317b0bcdb052f1b9396fbe861aec20db3b72a9bd3f745ab5d88618ad58a199"
    )
    return json.loads(raw)


def test_checked_publication_readiness_packet_is_immutable_historical_evidence() -> None:
    packet = _historical_packet()
    assert packet["packet_id"] == builder.PACKET_ID
    with pytest.raises(
        builder.PublicationReadinessError,
        match="contract source drifted: originals_cultural_review.py",
    ):
        builder.build()


def test_packet_is_an_exact_six_blocker_hold_not_a_release() -> None:
    packet = _historical_packet()
    assert packet["kind"] == "original_publication_readiness_hold"
    assert packet["scope"] == {
        "product_id": "great_smoky_mountains_ridges_rivers_living_memory",
        "chapter_id": "roaring_fork",
        "variant_id": "one_way",
        "draft_revision": 2,
        "manifest_schema": 3,
    }
    assert [row["id"] for row in packet["blockers"]] == [
        "final_publication_manifest_and_catalog",
        "exact_route_evidence",
        "current_operational_evidence_and_strict_alternates",
        "public_record_cultural_scope_contract",
        "published_start_runtime_safety",
        "atomic_public_release_authorization",
    ]
    assert all(row["status"] == "blocked" for row in packet["blockers"])
    assert packet["decision_boundary"]["publication_ready"] is False
    assert packet["decision_boundary"]["public_release"] is False
    assert packet["decision_boundary"]["publish_endpoint_authorized"] is False
    assert packet["decision_boundary"]["publish_endpoint_exercised"] is False
    assert packet["decision_boundary"]["production_mutation_performed"] is False


def test_private_acceptance_is_preserved_without_becoming_publication_evidence() -> None:
    packet = _historical_packet()
    accepted = packet["accepted_private_evidence"]
    assert accepted["current_asset_count"] == 20
    assert accepted["narration_count"] == 13
    assert accepted["artwork_count"] == 7
    assert accepted["aggregate_asset_bytes"] == 239_772_665
    assert accepted["published_version_count"] == 0
    assert accepted["evidence_class"] == "historical_s4r_production_readback"
    assert accepted["live_database_rechecked_by_builder"] is False
    trusted = packet["trusted_private_validation"]
    assert trusted["status"] == "passed"
    assert trusted["route_scenarios_passed"] == trusted["route_scenarios_required"] == 13
    assert trusted["issues"] == []
    assert trusted["publication_approval"] is False
    assert trusted["live_report_rechecked_by_builder"] is False
    assert trusted["must_rerun_after_final_manifest_or_source_change"] is True


def test_road_observation_is_explicitly_transient_and_claim_limited() -> None:
    observation = _historical_packet()["official_road_observation"]
    assert observation["safe_statement"] == (
        "The current NPS road check does not list a closure for this chapter."
    )
    assert observation["roaring_fork_segment_intersection_count"] == 0
    assert observation["not_a_safety_or_guaranteed_open_claim"] is True
    assert observation["evergreen_reuse_allowed"] is False
    assert observation["response_body_retained_in_repository"] is False
    assert observation["evidence_class"] == (
        "historical_external_observation_not_revalidated_by_builder"
    )
    assert observation["observed_at"] < observation["expires_at"]


def test_public_record_claims_do_not_invent_cultural_approval() -> None:
    blocker = next(
        row for row in _historical_packet()["blockers"]
        if row["id"] == "public_record_cultural_scope_contract"
    )
    facts = blocker["facts"]
    assert facts["roaring_fork_entry_count"] == 13
    assert facts["claim_count"] == 7
    assert facts["claim_classification"] == "public_record_factual"
    assert facts["collection_method"] == "published_public_record"
    assert facts["claim_level_cultural_gate"] == "not_required"
    assert facts["registered_publication_determination_present"] is False
    assert facts["registered_gated_content_approval_present"] is False
    assert _historical_packet()["decision_boundary"]["cultural_outreach_performed"] is False


def test_private_catalog_and_review_state_remain_fail_closed() -> None:
    blocker = _historical_packet()["blockers"][0]
    facts = blocker["facts"]
    assert facts["completed_publication_reviews"] == [
        "audio_assets_reviewed",
        "media_licenses_reviewed",
        "transcripts_reviewed",
    ]
    assert len(facts["missing_publication_reviews"]) == 7
    assert facts["offline_map_estimated_bytes"] == 0
    assert facts["route_evidence_present"] is False
    assert facts["catalog_visibility"] == "private"
    assert facts["catalog_price_credits"] == 0


def test_source_hash_drift_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    drifted = tmp_path / "manifest.json"
    drifted.write_text("{}\n", encoding="utf-8")
    monkeypatch.setitem(builder.SOURCE_PATHS, "private_manifest", drifted)
    with pytest.raises(builder.PublicationReadinessError, match="source binding drifted"):
        builder.build()


def test_historical_inputs_bind_the_immutable_s4r_checkpoint() -> None:
    historical = _read(builder.SOURCE_PATHS["historical_inputs"])
    checkpoint = historical["source_checkpoint"]
    checkpoint_bytes = subprocess.check_output(
        ["git", "show", f"{checkpoint['commit']}:{checkpoint['path']}"],
        cwd=builder.ROOT,
    )
    assert hashlib.sha256(checkpoint_bytes).hexdigest() == checkpoint["file_sha256"]
    checkpoint_text = checkpoint_bytes.decode("utf-8")
    assert historical["trusted_private_validation_at_s4r_readback"]["report_id"] in checkpoint_text
    assert historical["private_state_at_s4r_readback"]["device_preview_evidence_sha256"] in checkpoint_text
    assert "permanent_credit_price: 900" in checkpoint_text


def test_contract_sources_are_bound_and_external_inputs_are_not_current_claims() -> None:
    packet = _historical_packet()
    for binding_id in (
        "manifest_v2_contract",
        "manifest_v3_contract",
        "operational_contract",
        "route_evidence_contract",
        "cultural_scope_contract",
        "vehicle_binding_contract",
        "publication_store_contract",
        "published_start_runtime_contract",
    ):
        assert binding_id in packet["source_bindings"]
    assert packet["accepted_private_evidence"]["observed_at"] == "2026-08-11T01:33:56Z"
    assert packet["evidence_cutoff_at"] == "2026-08-11T01:46:27.738573Z"
    assert packet["decision_boundary"]["database_accessed"] is False
