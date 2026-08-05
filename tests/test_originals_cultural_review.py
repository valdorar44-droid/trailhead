import hashlib
import json

import pytest

from db import originals_cultural_review as cultural


SMOKIES_PRODUCT = "great_smoky_mountains_ridges_rivers_living_memory"


def test_smokies_story_claims_are_exact_and_unknown_ids_fail_closed():
    binding = cultural.validate_cultural_story_claims(
        product_id=SMOKIES_PRODUCT,
        story_id="mc_story_15",
        claim_ids=["mc_kuwohi_living_meaning"],
    )
    assert binding["product_id"] == SMOKIES_PRODUCT
    assert len(binding["dossier_sha256"]) == 64

    with pytest.raises(cultural.OriginalCulturalReviewError, match="unknown"):
        cultural.validate_cultural_story_claims(
            product_id=SMOKIES_PRODUCT,
            story_id="mc_story_15",
            claim_ids=["mc_kuwohi_living_meaning_typo"],
        )
    with pytest.raises(cultural.OriginalCulturalReviewError, match="do not match"):
        cultural.validate_cultural_story_claims(
            product_id=SMOKIES_PRODUCT,
            story_id="mc_story_15",
            claim_ids=[],
        )


def test_cultural_approval_is_bound_to_exact_product_claims_and_date(
    tmp_path, monkeypatch
):
    transcript_sha256 = "1" * 64
    pronunciation_sha256 = "2" * 64
    dossier_sha256 = cultural.cultural_dossier_binding(SMOKIES_PRODUCT)[
        "dossier_sha256"
    ]
    approved_story_ids = {
        story_id
        for story_id, claim_ids in cultural._dossier_registry()["story_claims"].items()
        if "mc_kuwohi_living_meaning" in claim_ids
    }
    record = {
        "schema_version": 1,
        "kind": "trailhead_original_cultural_approval",
        "approval_record_id": "ebci_scope_review_001",
        "product_id": SMOKIES_PRODUCT,
        "status": "approved",
        "approved_claim_ids": ["mc_kuwohi_living_meaning"],
        "dossier_sha256": dossier_sha256,
        "approved_story_transcript_sha256_by_id": {
            story_id: transcript_sha256 for story_id in approved_story_ids
        },
        "pronunciation_bundle_sha256": pronunciation_sha256,
        "approved_at": "2026-08-03",
    }
    path = tmp_path / "approval.json"
    raw = json.dumps(record, separators=(",", ":"), sort_keys=True).encode()
    path.write_bytes(raw)
    monkeypatch.setitem(
        cultural._REGISTERED_APPROVAL_RECORDS,
        record["approval_record_id"],
        path,
    )
    digest = hashlib.sha256(raw).hexdigest()

    cultural.validate_cultural_claim_approval(
        product_id=SMOKIES_PRODUCT,
        story_id="mc_story_15",
        transcript_sha256=transcript_sha256,
        claim_ids=["mc_kuwohi_living_meaning"],
        approval_record_id=record["approval_record_id"],
        approval_record_sha256=digest,
        approved_at="2026-08-03",
        pronunciation_bundle_sha256=pronunciation_sha256,
    )
    with pytest.raises(cultural.OriginalCulturalReviewError, match="does not cover"):
        cultural.validate_cultural_claim_approval(
            product_id=SMOKIES_PRODUCT,
            story_id="mc_story_15",
            transcript_sha256=transcript_sha256,
            claim_ids=["cc_cherokee_context"],
            approval_record_id=record["approval_record_id"],
            approval_record_sha256=digest,
            approved_at="2026-08-03",
            pronunciation_bundle_sha256=pronunciation_sha256,
        )
    with pytest.raises(cultural.OriginalCulturalReviewError, match="product"):
        cultural.validate_cultural_claim_approval(
            product_id="another_original",
            story_id="mc_story_15",
            transcript_sha256=transcript_sha256,
            claim_ids=["mc_kuwohi_living_meaning"],
            approval_record_id=record["approval_record_id"],
            approval_record_sha256=digest,
            approved_at="2026-08-03",
            pronunciation_bundle_sha256=pronunciation_sha256,
        )
    with pytest.raises(cultural.OriginalCulturalReviewError, match="date"):
        cultural.validate_cultural_claim_approval(
            product_id=SMOKIES_PRODUCT,
            story_id="mc_story_15",
            transcript_sha256=transcript_sha256,
            claim_ids=["mc_kuwohi_living_meaning"],
            approval_record_id=record["approval_record_id"],
            approval_record_sha256=digest,
            approved_at="2026-08-04",
            pronunciation_bundle_sha256=pronunciation_sha256,
        )

    bound = {
        "product_id": SMOKIES_PRODUCT,
        "story_id": "mc_story_15",
        "transcript_sha256": "3" * 64,
        "claim_ids": ["mc_kuwohi_living_meaning"],
        "approval_record_id": record["approval_record_id"],
        "approval_record_sha256": digest,
        "approved_at": "2026-08-03",
        "pronunciation_bundle_sha256": pronunciation_sha256,
    }
    with pytest.raises(cultural.OriginalCulturalReviewError, match="reviewed script"):
        cultural.validate_cultural_claim_approval(**bound)
    bound["transcript_sha256"] = transcript_sha256
    bound["pronunciation_bundle_sha256"] = "4" * 64
    with pytest.raises(cultural.OriginalCulturalReviewError, match="pronunciation"):
        cultural.validate_cultural_claim_approval(**bound)


def test_cultural_approval_fails_when_dossier_binding_changes(tmp_path, monkeypatch):
    record = {
        "schema_version": 1,
        "kind": "trailhead_original_cultural_approval",
        "approval_record_id": "ebci_scope_review_changed_dossier",
        "product_id": SMOKIES_PRODUCT,
        "status": "approved",
        "approved_claim_ids": ["mc_kuwohi_living_meaning"],
        "dossier_sha256": "f" * 64,
        "approved_story_transcript_sha256_by_id": {"mc_story_15": "1" * 64},
        "pronunciation_bundle_sha256": "2" * 64,
        "approved_at": "2026-08-03",
    }
    path = tmp_path / "approval.json"
    raw = json.dumps(record, separators=(",", ":"), sort_keys=True).encode()
    path.write_bytes(raw)
    monkeypatch.setitem(
        cultural._REGISTERED_APPROVAL_RECORDS,
        record["approval_record_id"],
        path,
    )
    with pytest.raises(cultural.OriginalCulturalReviewError, match="does not match"):
        cultural.validate_cultural_claim_approval(
            product_id=SMOKIES_PRODUCT,
            story_id="mc_story_15",
            transcript_sha256="1" * 64,
            claim_ids=["mc_kuwohi_living_meaning"],
            approval_record_id=record["approval_record_id"],
            approval_record_sha256=hashlib.sha256(raw).hexdigest(),
            approved_at="2026-08-03",
            pronunciation_bundle_sha256="2" * 64,
        )
