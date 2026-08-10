from __future__ import annotations

import json
import subprocess
import sys

import scripts.build_smokies_roaring_fork_artwork_review as builder


def _tracked() -> dict:
    return json.loads(builder.OUTPUT_PATH.read_text(encoding="utf-8"))


def test_artwork_review_rebuild_is_deterministic_and_network_free() -> None:
    assert builder.OUTPUT_PATH.read_text(encoding="utf-8") == builder.serialize(
        builder.build()
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


def test_all_thirteen_entries_are_mapped_once_in_checked_delivery_order() -> None:
    value = _tracked()
    mapping = value["entry_artwork_map"]
    assert value["summary"]["entry_count"] == 13
    assert value["summary"]["mapped_exactly_once"] is True
    assert [row["stable_order"] for row in mapping] == list(range(1, 14))
    assert [row["entry_id"] for row in mapping] == list(builder.EXPECTED_ENTRY_IDS)
    assert len({row["entry_id"] for row in mapping}) == 13
    assert {row["candidate_id"] for row in mapping} == {
        row["candidate_id"] for row in value["candidates"]
    }


def test_wrong_historic_vista_is_explicitly_rejected_for_stream_slot() -> None:
    value = _tracked()
    assert value["known_rejections"] == [
        {
            "slot_id": "media_rf_stream",
            "asset_sha256": builder.REJECTED_VISTA_SHA256,
            "authoritative_subject": "mountain vista at stop three",
            "rejection_reason": "does_not_depict_required_stream_and_road_scene",
            "status": "rejected_identity_mismatch",
            "ingestion_allowed": False,
        }
    ]
    stream = next(
        row for row in value["candidates"] if row["candidate_id"] == "rf_art_stream"
    )
    assert "stream" in stream["subject"].lower()
    assert stream["original_sha256"] is None
    assert builder.REJECTED_VISTA_SHA256 not in json.dumps(stream)


def test_review_packet_cannot_approve_ingest_or_publish_candidates() -> None:
    value = _tracked()
    assert value["status"] == "user_visual_approval_required"
    assert value["summary"] == {
        "entry_count": 13,
        "candidate_count": 7,
        "mapped_exactly_once": True,
        "cc_by_4_0_candidate_count": 4,
        "public_domain_candidate_count": 3,
        "downloaded_original_candidate_count": 1,
        "download_deferred_candidate_count": 6,
    }
    assert value["approval_gate"] == {
        "user_visual_approval": False,
        "original_downloads_complete": False,
        "original_hashes_complete": False,
        "licensed_derivatives_complete": False,
        "verified_upload_evidence_complete": False,
        "private_manifest_v3_artwork_binding_complete": False,
        "ingestion_allowed": False,
        "public_release": False,
        "next_action": (
            "obtain_explicit_visual_approval_then_download_and_hash_exact_originals"
        ),
    }
    for candidate in value["candidates"]:
        assert candidate["status"] == "candidate_only_user_visual_approval_required"
        assert candidate["user_visual_approval"] is False
        assert candidate["ingestion_allowed"] is False
        assert candidate["source_page_url"].startswith("https://")
        assert candidate["download_url"].startswith("https://")
        assert candidate["review_dimensions"]["width"] >= 1_024
        assert candidate["review_dimensions"]["height"] >= 683


def test_rights_and_attribution_contracts_are_complete() -> None:
    value = _tracked()
    candidates = {row["candidate_id"]: row for row in value["candidates"]}
    assert {
        row["candidate_id"]
        for row in value["candidates"]
        if row["license_name"] == "CC BY 4.0"
    } == {"rf_art_road", "rf_art_stream", "rf_art_forest", "rf_art_ogle"}
    for candidate_id in ("rf_art_road", "rf_art_stream", "rf_art_forest", "rf_art_ogle"):
        row = candidates[candidate_id]
        assert row["license_url"] == "https://creativecommons.org/licenses/by/4.0/"
        assert "Sarah Stierch" in row["exact_credit"]
        assert "cropped for Trailhead" not in row["exact_credit"]
    assert candidates["rf_art_historic_cabin"]["rights_basis"] == (
        "public_domain_dedication_no_known_restrictions"
    )
    assert "LC-DIG-highsm-68373" in candidates["rf_art_historic_cabin"][
        "exact_credit"
    ]
    assert candidates["rf_art_historic_cabin"]["download_url"] == (
        "https://tile.loc.gov/storage-services/master/pnp/highsm/68300/68373u.tif"
    )
    assert candidates["rf_art_historic_cabin"]["download_variant"] == (
        "loc_provider_master_tiff_68373u"
    )
    assert candidates["rf_art_historic_cabin"]["review_dimension_basis"] == (
        "loc_large_service_jpeg_preview"
    )
    for candidate_id in ("rf_art_grotto_falls", "rf_art_thousand_drips"):
        row = candidates[candidate_id]
        assert row["rights_basis"] == "public_domain_us_government_work"
        assert "no claim to original U.S. Government work" in row["exact_credit"]
        assert row["source_record"]["photo_credit"] is None
        assert row["source_record"]["constraint"] == "Public domain"
        assert row["source_record"]["granting_rights"] == "Full"
    assert "not_visible_from_road" in candidates["rf_art_grotto_falls"]["claim_limit"]
    assert candidates["rf_art_grotto_falls"]["review_dimensions"] == {
        "width": 2_182,
        "height": 1_470,
    }
    assert candidates["rf_art_thousand_drips"]["review_dimensions"] == {
        "width": 1_489,
        "height": 2_180,
    }


def test_only_existing_ogle_original_has_byte_identity_before_approval() -> None:
    value = _tracked()
    candidates = value["candidates"]
    with_hash = [row for row in candidates if row["original_sha256"] is not None]
    assert len(with_hash) == 1
    assert with_hash[0]["candidate_id"] == "rf_art_ogle"
    assert with_hash[0]["original_sha256"] == (
        "a828bf6c6d7f2650268f67b39669b1958f80c34dd845705f60423d8a0dfea551"
    )
    assert with_hash[0]["original_bytes"] == 5_281_216
    for row in candidates:
        if row["candidate_id"] != "rf_art_ogle":
            assert row["evidence_status"] == "source_reviewed_download_deferred"
            assert row["original_sha256"] is None
            assert row["original_bytes"] is None
