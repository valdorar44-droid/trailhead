from __future__ import annotations

import copy
import json
from collections import Counter, defaultdict
from datetime import date
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
        normalize_original_source_dossier(build_dossier(), as_of=date(2027, 2, 2))


def test_unknown_fields_cannot_hide_scripts_or_private_reviewer_data():
    payload = build_dossier()
    payload["entries"][0]["transcript"] = "This must not be accepted."
    with pytest.raises(OriginalSourceDossierError, match="unsupported fields: transcript"):
        normalize_original_source_dossier(payload, as_of=AS_OF)
    payload = build_dossier()
    payload["cultural_review"]["reviewer_name"] = "Private person"
    with pytest.raises(OriginalSourceDossierError, match="unsupported fields: reviewer_name"):
        normalize_original_source_dossier(payload, as_of=AS_OF)


def test_cultural_entries_remain_blocked_until_ebci_review():
    dossier = _normalized()
    blocked = {
        entry["id"]
        for entry in dossier["entries"]
        if entry["script_status"] == "blocked_cultural_review"
    }
    assert blocked == {"mc_story_15", "mc_cue_07", "cc_story_04"}
    payload = build_dossier()
    claim = next(item for item in payload["claims"] if item["id"] == "mc_kuwohi_living_meaning")
    claim["status"] = "source_verified"
    with pytest.raises(OriginalSourceDossierError, match="must match the EBCI review state"):
        normalize_original_source_dossier(payload, as_of=AS_OF)


def test_immutable_ebci_approval_can_unlock_only_the_exact_reviewed_claims():
    payload = build_dossier()
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
    citations = original_story_citations(payload, ["mc_kuwohi_living_meaning"], as_of=AS_OF)
    assert citations
    assert all(citation["cultural_approval_record_id"] == "ebci_scope_review_001" for citation in citations)
    assert all(citation["cultural_approval_record_sha256"] == "b" * 64 for citation in citations)
    assert all(citation["cultural_approved_at"] == REVIEWED_AT for citation in citations)
    payload["cultural_review"]["approved_claim_ids"].pop()
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
    with pytest.raises(OriginalSourceDossierError, match="before cultural review"):
        original_story_citations(build_dossier(), ["mc_kuwohi_living_meaning"], as_of=AS_OF)


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
