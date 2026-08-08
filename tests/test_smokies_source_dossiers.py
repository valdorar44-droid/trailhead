from __future__ import annotations

import copy
import json
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

import pytest

from db.originals_sources import (
    OriginalSourceDossierError,
    normalize_original_source_dossier,
    original_source_dossier_sha256,
    original_story_citations,
)
from scripts.build_smokies_source_dossiers import REVIEWED_AT, build_dossier


ROOT = Path(__file__).resolve().parents[1]
DOSSIER_PATH = ROOT / "originals" / "smokies" / "source_dossiers_v1.json"
ROUTES_PATH = ROOT / "originals" / "smokies" / "route_variants_v1.json"
AS_OF = date.fromisoformat(REVIEWED_AT)


def _normalized(payload: dict | None = None) -> dict:
    return normalize_original_source_dossier(payload or build_dossier(), as_of=AS_OF)[0]


def test_checked_in_dossier_is_deterministic_and_matches_the_builder():
    expected = json.dumps(_normalized(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    assert DOSSIER_PATH.read_text(encoding="utf-8") == expected


def test_dossier_has_the_approved_story_and_cue_counts():
    dossier = _normalized()
    counts = Counter((entry["chapter_id"], entry["kind"]) for entry in dossier["entries"])
    assert counts == Counter({
        ("mountain_crossing", "story"): 18,
        ("mountain_crossing", "cue"): 10,
        ("little_river_cades_cove", "story"): 14,
        ("little_river_cades_cove", "cue"): 9,
        ("roaring_fork", "story"): 7,
        ("roaring_fork", "cue"): 6,
        ("foothills_parkway", "story"): 6,
        ("foothills_parkway", "cue"): 7,
    })
    assert sum(entry["kind"] == "story" for entry in dossier["entries"]) == 45
    assert sum(entry["kind"] == "cue" for entry in dossier["entries"]) == 32


def test_bidirectional_source_locked_titles_are_direction_neutral():
    entries = {entry["id"]: entry for entry in _normalized()["entries"]}
    assert entries["mc_story_01"]["title"] == "Sugarlands and the watershed"
    assert entries["mc_story_16"]["title"] == "The Oconaluftee valley"
    assert entries["fp_cue_02"]["title"] == "A long view"


def test_every_route_context_is_backed_by_an_existing_chapter_anchor():
    route_spec = json.loads(ROUTES_PATH.read_text(encoding="utf-8"))
    anchors: dict[str, list[set[str]]] = defaultdict(list)
    for variant in route_spec["variants"]:
        anchors[variant["chapter_id"]].append({item["id"] for item in variant["anchors"]})
    for entry in _normalized()["entries"]:
        assert all(
            entry["route_context"] in variant_anchors
            for variant_anchors in anchors[entry["chapter_id"]]
        )


def test_one_way_chapter_entries_follow_route_anchor_order():
    route_spec = json.loads(ROUTES_PATH.read_text(encoding="utf-8"))
    variants_by_chapter: dict[str, list[dict]] = defaultdict(list)
    for variant in route_spec["variants"]:
        variants_by_chapter[variant["chapter_id"]].append(variant)
    entries = _normalized()["entries"]
    for chapter_id, variants in variants_by_chapter.items():
        if len(variants) != 1:
            continue
        anchor_order = {
            anchor["id"]: index for index, anchor in enumerate(variants[0]["anchors"])
        }
        for kind in ("story", "cue"):
            contexts = [
                entry["route_context"]
                for entry in sorted(
                    (
                        entry for entry in entries
                        if entry["chapter_id"] == chapter_id and entry["kind"] == kind
                    ),
                    key=lambda entry: entry["sequence"],
                )
            ]
            positions = [anchor_order[context] for context in contexts]
            assert positions == sorted(positions)


def test_source_review_is_fail_closed_when_stale():
    with pytest.raises(OriginalSourceDossierError, match="review is stale"):
        normalize_original_source_dossier(
            build_dossier(),
            as_of=AS_OF + timedelta(days=181),
        )


def test_unknown_fields_cannot_hide_scripts_or_private_reviewer_data():
    payload = build_dossier()
    payload["entries"][0]["transcript"] = "This must not be accepted."
    with pytest.raises(OriginalSourceDossierError, match="unsupported fields: transcript"):
        normalize_original_source_dossier(payload, as_of=AS_OF)
    payload = build_dossier()
    payload["cultural_review"]["reviewer_name"] = "Private person"
    with pytest.raises(OriginalSourceDossierError, match="unsupported fields: reviewer_name"):
        normalize_original_source_dossier(payload, as_of=AS_OF)


def _gate_kuwohi_public_record(
    payload: dict,
    *,
    collection_method: str = "unpublished_or_restricted_knowledge",
    review_triggers: list[str] | None = None,
) -> dict:
    triggers = review_triggers or ["unpublished_or_restricted_knowledge"]
    claim = next(
        item for item in payload["claims"]
        if item["id"] == "mc_kuwohi_public_record"
    )
    claim.update({
        "status": "cultural_review_required",
        "cultural_gate": "ebci_required",
        "cultural_scope": {
            "classification": "immutable_ebci_review_required",
            "collection_method": collection_method,
            "review_triggers": triggers,
        },
    })
    blocked_ids = {
        entry["id"] for entry in payload["entries"]
        if claim["id"] in entry["claim_ids"]
    }
    for entry in payload["entries"]:
        if entry["id"] in blocked_ids:
            entry["script_status"] = "blocked_cultural_review"
    payload["cultural_review"].update({
        "status": "required_before_drafting",
        "blocked_entry_ids": sorted(blocked_ids),
    })
    return payload


def test_public_record_claims_are_not_gated_but_sensitive_work_remains_prohibited():
    dossier = _normalized()
    blocked = {
        entry["id"]
        for entry in dossier["entries"]
        if entry["script_status"] == "blocked_cultural_review"
    }
    assert blocked == set()
    assert dossier["cultural_review"]["status"] == "public_record_only"
    assert set(dossier["cultural_review"]["prohibited_until_approved"]) == {
        "sacred_or_traditional_interpretation",
        "direct_ebci_member_research",
        "unpublished_or_restricted_knowledge",
        "culturally_supplied_pronunciation",
        "research_on_ebci_tribal_land",
        "tts_rendering_of_gated_content",
    }
    claims = {item["id"]: item for item in dossier["claims"]}
    for claim_id in ("mc_kuwohi_public_record", "cc_cherokee_public_record"):
        assert claims[claim_id]["cultural_gate"] == "not_required"
        assert claims[claim_id]["cultural_scope"] == {
            "classification": "public_record_factual",
            "collection_method": "published_public_record",
            "review_triggers": [],
        }


@pytest.mark.parametrize(("collection_method", "review_trigger"), [
    ("published_public_record", "sacred_or_traditional_interpretation"),
    ("direct_ebci_member_research", "direct_ebci_member_research"),
    ("fieldwork_on_ebci_tribal_land", "research_on_ebci_tribal_land"),
    ("unpublished_or_restricted_knowledge", "unpublished_or_restricted_knowledge"),
])
def test_each_gated_collection_method_requires_immutable_review(
    collection_method,
    review_trigger,
):
    payload = _gate_kuwohi_public_record(
        build_dossier(),
        collection_method=collection_method,
        review_triggers=[review_trigger],
    )
    normalized = normalize_original_source_dossier(payload, as_of=AS_OF)[0]
    claim = next(
        item for item in normalized["claims"]
        if item["id"] == "mc_kuwohi_public_record"
    )
    assert claim["status"] == "cultural_review_required"
    assert set(normalized["cultural_review"]["blocked_entry_ids"]) == {
        "mc_story_15",
        "mc_cue_07",
    }


def test_cultural_scope_gate_mismatches_fail_closed():
    payload = build_dossier()
    claim = next(
        item for item in payload["claims"]
        if item["id"] == "mc_kuwohi_public_record"
    )
    claim["cultural_scope"]["review_triggers"] = [
        "sacred_or_traditional_interpretation"
    ]
    with pytest.raises(OriginalSourceDossierError, match="public-record scope"):
        normalize_original_source_dossier(payload, as_of=AS_OF)

    payload = _gate_kuwohi_public_record(build_dossier())
    claim = next(
        item for item in payload["claims"]
        if item["id"] == "mc_kuwohi_public_record"
    )
    claim["cultural_scope"]["review_triggers"] = ["unregistered_trigger"]
    with pytest.raises(OriginalSourceDossierError, match="unknown review triggers"):
        normalize_original_source_dossier(payload, as_of=AS_OF)

    payload = _gate_kuwohi_public_record(
        build_dossier(),
        collection_method="direct_ebci_member_research",
        review_triggers=["unpublished_or_restricted_knowledge"],
    )
    with pytest.raises(OriginalSourceDossierError, match="gated cultural scope"):
        normalize_original_source_dossier(payload, as_of=AS_OF)

    payload = _gate_kuwohi_public_record(build_dossier())
    payload["cultural_review"]["status"] = "public_record_only"
    with pytest.raises(OriginalSourceDossierError, match="cannot contain gated claims"):
        normalize_original_source_dossier(payload, as_of=AS_OF)


def test_immutable_ebci_approval_can_unlock_only_the_exact_reviewed_claims():
    payload = _gate_kuwohi_public_record(build_dossier())
    cultural_claim_ids = sorted(
        claim["id"] for claim in payload["claims"] if claim["cultural_gate"] == "ebci_required"
    )
    payload["cultural_review"].update({
        "status": "approved",
        "blocked_entry_ids": [],
        "approval_record_id": "ebci_scope_review_001",
        "approved_at": REVIEWED_AT,
        "approval_record_sha256": "b" * 64,
        "approved_claim_ids": cultural_claim_ids,
    })
    for claim in payload["claims"]:
        if claim["cultural_gate"] == "ebci_required":
            claim["status"] = "cultural_review_approved"
    for entry in payload["entries"]:
        if entry["script_status"] == "blocked_cultural_review":
            entry["script_status"] = "outline_only"
    normalized = normalize_original_source_dossier(payload, as_of=AS_OF)[0]
    assert normalized["cultural_review"]["status"] == "approved"
    citations = original_story_citations(payload, ["mc_kuwohi_public_record"], as_of=AS_OF)
    assert citations
    assert all(citation["cultural_approval_record_id"] == "ebci_scope_review_001" for citation in citations)
    assert all(citation["cultural_approval_record_sha256"] == "b" * 64 for citation in citations)
    assert all(citation["cultural_approved_at"] == REVIEWED_AT for citation in citations)
    payload["cultural_review"]["approved_claim_ids"] = [
        "cc_cherokee_public_record"
    ]
    with pytest.raises(OriginalSourceDossierError, match="cover every EBCI-gated claim exactly"):
        normalize_original_source_dossier(payload, as_of=AS_OF)


def test_story_citations_reuse_the_manifest_v2_contract():
    citations = original_story_citations(build_dossier(), ["mc_road_engineering", "mc_ccc_legacy"], as_of=AS_OF)
    assert citations
    assert all(set(item) == {
        "title",
        "url",
        "publisher",
        "role",
        "authority",
        "reviewed_at",
        "rights_status",
        "affected_claims",
    } for item in citations)
    assert all(item["role"] == "story" for item in citations)
    assert all(item["rights_status"] == "reference_only" for item in citations)
    gated = _gate_kuwohi_public_record(build_dossier())
    with pytest.raises(OriginalSourceDossierError, match="before cultural review"):
        original_story_citations(gated, ["mc_kuwohi_public_record"], as_of=AS_OF)


def test_media_rights_fail_closed_until_one_exact_asset_is_cleared():
    dossier = _normalized()
    assert not any(item["status"] == "approved" for item in dossier["media_candidates"])
    payload = build_dossier()
    payload["media_candidates"][0]["exact_credit"] = "NPS Photo"
    with pytest.raises(OriginalSourceDossierError, match="cannot carry partial rights evidence"):
        normalize_original_source_dossier(payload, as_of=AS_OF)
    payload = build_dossier()
    media = payload["media_candidates"][0]
    media.update({
        "status": "approved",
        "asset_url": "https://www.nps.gov/example/exact-image.jpg",
        "exact_credit": "NPS Photo",
        "identity_match": "The exact asset was reviewed against the intended Cable Mill subject.",
        "rights_basis": "Individually reviewed NPS-created public-domain work",
        "license_record": "internal-license-record-001",
        "width": 2400,
        "height": 1600,
        "sha256": "a" * 64,
    })
    approved = normalize_original_source_dossier(payload, as_of=AS_OF)[0]
    assert next(item for item in approved["media_candidates"] if item["id"] == media["id"])["status"] == "approved"

    payload = build_dossier()
    payload["media_candidates"][0]["rights_requirements"][-1] = "license_basis"
    with pytest.raises(OriginalSourceDossierError, match="do not match the approval contract"):
        normalize_original_source_dossier(payload, as_of=AS_OF)


def test_normalization_order_and_hash_are_deterministic_but_source_changes_invalidate_it():
    payload = build_dossier()
    expected = original_source_dossier_sha256(payload, as_of=AS_OF)
    reordered = copy.deepcopy(payload)
    reordered["sources"].reverse()
    reordered["claims"].reverse()
    reordered["entries"].reverse()
    reordered["media_candidates"].reverse()
    assert original_source_dossier_sha256(reordered, as_of=AS_OF) == expected
    changed = copy.deepcopy(payload)
    changed["sources"][0]["title"] += " revised"
    assert original_source_dossier_sha256(changed, as_of=AS_OF) != expected


def test_dossier_copy_contains_no_provider_or_generated_script_language():
    rendered = DOSSIER_PATH.read_text(encoding="utf-8").casefold()
    for forbidden in (
        "as an ai",
        "ai-powered",
        "chatgpt",
        "cartesia",
        "elevenlabs",
        "provider slug",
        "check local rules",
    ):
        assert forbidden not in rendered
