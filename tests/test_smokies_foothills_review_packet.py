from __future__ import annotations

import hashlib
import json
import socket
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Callable

import pytest

import scripts.build_smokies_foothills_review_packet as builder


def _tracked() -> dict:
    return json.loads(builder.OUTPUT_PATH.read_text(encoding="utf-8"))


def _mutated_json_source(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    source_name: str,
    mutate: Callable[[dict], None],
) -> None:
    value = json.loads(builder.SOURCE_PATHS[source_name].read_text(encoding="utf-8"))
    mutate(value)
    path = tmp_path / f"{source_name}.json"
    rendered = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    path.write_text(rendered, encoding="utf-8")
    monkeypatch.setitem(builder.SOURCE_PATHS, source_name, path)
    monkeypatch.setitem(
        builder.EXPECTED_SOURCE_SHA256,
        source_name,
        hashlib.sha256(path.read_bytes()).hexdigest(),
    )


def test_review_packet_and_sheet_are_deterministic_and_network_database_free(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def denied(*args: object, **kwargs: object) -> None:
        raise AssertionError("review builder attempted external state access")

    monkeypatch.setattr(socket, "create_connection", denied)
    monkeypatch.setattr(sqlite3, "connect", denied)
    value = builder.build()
    assert builder.OUTPUT_PATH.read_text(encoding="utf-8") == builder.serialize(value)
    assert builder.MARKDOWN_OUTPUT_PATH.read_text(encoding="utf-8") == (
        builder.render_markdown(value)
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


def test_exact_thirteen_script_review_set_and_reverse_overrides() -> None:
    value = _tracked()
    scripts = value["scripts"]
    assert [row["id"] for row in scripts] == list(builder.EXPECTED_ENTRY_IDS)
    assert [row["stable_order"] for row in scripts] == list(range(1, 14))
    assert sum(row["kind"] == "story" for row in scripts) == 6
    assert sum(row["kind"] == "cue" for row in scripts) == 7
    assert all(row["transcript"].strip() for row in scripts)
    assert all(len(row["transcript_sha256"]) == 64 for row in scripts)
    assert all(row["decision_status"] == "user_approve_or_revise_required" for row in scripts)
    assert all(row["rendering_allowed"] is False for row in scripts)
    assert [row["id"] for row in scripts if row.get("variant_overrides")] == list(
        builder.EXPECTED_OVERRIDE_IDS
    )
    assert all(
        override["variant_id"] == "east_to_west"
        for row in scripts
        for override in row.get("variant_overrides", [])
    )


def test_source_locked_public_record_scope_is_exact_and_ungated() -> None:
    value = _tracked()
    assert value["public_record_scope"] == {
        "claim_count": 6,
        "claim_ids": [
            "fp_air_monitoring",
            "fp_forest_mosaic",
            "fp_geologic_view",
            "fp_long_build",
            "fp_missing_link",
            "fp_scenic_corridor",
        ],
        "claim_set_sha256": builder.EXPECTED_SUBSET_SHA256["claims"],
        "classification": "public_record_factual",
        "collection_method": "published_public_record",
        "culturally_gated_claim_count": 0,
        "blocked_entry_count": 0,
        "external_outreach_required": False,
    }
    assert len(value["dossier_entries"]) == 13
    assert {row["id"] for row in value["official_sources"]} == set(
        builder.EXPECTED_SOURCE_IDS
    )
    assert all(row["authority"] == "official" for row in value["official_sources"])
    assert all(row["publisher"] == "National Park Service" for row in value["official_sources"])
    assert all(claim["cultural_gate"] == "not_required" for claim in value["claims"])
    assert all(claim["cultural_scope"]["review_triggers"] == [] for claim in value["claims"])


def test_both_route_directions_are_bound_but_not_publication_evidence() -> None:
    context = _tracked()["route_review_context"]
    assert context["full_product_variant_count"] == 6
    assert context["foothills_variant_count"] == 2
    assert context["route_evidence_publication_status"] == "blocked"
    assert [row["variant_id"] for row in context["variants"]] == list(
        builder.EXPECTED_VARIANT_IDS
    )
    assert [row["geometry_sha256"] for row in context["variants"]] == [
        builder.EXPECTED_GEOMETRY_SHA256["west_to_east"],
        builder.EXPECTED_GEOMETRY_SHA256["east_to_west"],
    ]
    assert all(row["distance_m"] == 50_816.7 for row in context["variants"])
    assert all(row["geometry_ready_for_editorial_cues"] is True for row in context["variants"])
    assert all(row["publication_evidence"] is False for row in context["variants"])


def test_two_artwork_candidates_remain_review_only_with_exact_identity() -> None:
    artwork = _tracked()["artwork_candidates"]
    assert [row["candidate_id"] for row in artwork] == [
        "media_fp_panorama",
        "media_fp_engineering",
    ]
    assert [row["original_sha256"] for row in artwork] == [
        "92da599e63f7f2afabd81106d6649441b11b5406e7c94ec3ba448c643e6f19d8",
        "ed4f3bc69b7fd0f34040e3214a1633f410327c0deb3c0c04412d861760de78af",
    ]
    assert [row["original_bytes"] for row in artwork] == [2_067_676, 1_650_379]
    assert artwork[0]["gps_exif_present"] is True
    assert artwork[1]["gps_exif_present"] is False
    assert all(row["device_exif_present"] is True for row in artwork)
    assert all(row["license_name"] == "Public domain" for row in artwork)
    assert all(
        row["required_commercial_notice"] == builder.US_GOVERNMENT_WORK_NOTICE
        for row in artwork
    )
    for row in artwork:
        assert row["status"] == "candidate_only_user_visual_approval_required"
        assert row["user_visual_approval"] is False
        assert row["sanitized_derivative_complete"] is False
        assert row["ingestion_allowed"] is False
        assert row["rendering_allowed"] is False
        assert row["upload_allowed"] is False
        assert row["publication_allowed"] is False
        assert row["local_evidence_locator"].startswith("smokies_media_s2:")
        assert row["local_hash_verified_at_packet_build"] is True


def test_full_product_contract_and_other_chapter_boundary_are_preserved() -> None:
    value = _tracked()
    assert value["product_contract"] == {
        "pack_scope": "one_premium_four_chapter_product",
        "chapter_ids": [
            "mountain_crossing",
            "little_river_cades_cove",
            "roaring_fork",
            "foothills_parkway",
        ],
        "permanent_credit_price": 900,
        "credit_type": "earned_credits",
        "explorer_included": True,
        "standalone_roaring_fork_public_product_approved": False,
        "standalone_foothills_public_product_approved": False,
        "changing_scope_or_price_requires_separate_product_decision": True,
    }
    assert value["review_scope"] == {
        "chapter_id": "foothills_parkway",
        "script_count": 13,
        "story_count": 6,
        "cue_count": 7,
        "variant_ids": ["west_to_east", "east_to_west"],
        "reverse_override_entry_ids": ["fp_cue_01", "fp_cue_05", "fp_cue_07"],
        "artwork_candidate_count": 2,
        "other_chapters_approved": False,
    }


def test_roaring_fork_r2_profile_assets_and_report_are_protected() -> None:
    protected = _tracked()["protected_roaring_fork_evidence"]
    assert protected["status"] == "preserved_unchanged_and_excluded_from_this_review"
    assert protected["draft_revision"] == 2
    assert protected["current_asset_count"] == 20
    assert protected["narration_count"] == 13
    assert protected["artwork_count"] == 7
    assert protected["private_manifest_file_sha256"] == (
        builder.EXPECTED_SOURCE_SHA256["roaring_fork_private_manifest"]
    )
    trusted = protected["trusted_private_validation"]
    assert trusted["report_id"] == "original_validation_9df694c93ee9ef3809c33f451d04bf28"
    assert trusted["redacted_report_sha256"] == (
        "ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059"
    )
    assert trusted["publication_approval"] is False


def test_every_downstream_action_remains_fail_closed() -> None:
    gate = _tracked()["decision_gate"]
    assert gate == {
        "script_decisions_recorded": False,
        "artwork_visual_decisions_recorded": False,
        "artwork_status": "candidate_only",
        "other_chapters_approved": False,
        "artwork_sanitation_allowed": False,
        "artwork_sanitation_complete": False,
        "artwork_ingestion_allowed": False,
        "narrator_selected_for_foothills": False,
        "tts_or_render_authorized": False,
        "narration_generated": False,
        "manifest_creation_or_mutation_allowed": False,
        "upload_allowed": False,
        "database_accessed": False,
        "network_accessed_by_builder": False,
        "production_mutation_allowed": False,
        "public_release": False,
        "publication_allowed": False,
        "next_action": (
            "collect_explicit_approve_or_revise_decisions_for_all_"
            "thirteen_scripts_and_both_artwork_candidates"
        ),
    }


@pytest.mark.parametrize(
    ("source_name", "mutate"),
    [
        ("editorial", lambda value: value["entries"].pop()),
        (
            "source_dossier",
            lambda value: next(
                row for row in value["claims"] if row["id"] == "fp_scenic_corridor"
            ).update({"cultural_gate": "ebci_required"}),
        ),
        (
            "source_dossier",
            lambda value: next(
                row
                for row in value["media_candidates"]
                if row["id"] == "media_fp_panorama"
            ).update({"status": "approved"}),
        ),
        (
            "official_route_evidence",
            lambda value: next(
                row
                for row in value["variants"]
                if row.get("chapter_id") == "foothills_parkway"
            ).update({"geometry_sha256": "0" * 64}),
        ),
        (
            "roaring_fork_publication_readiness",
            lambda value: value["accepted_private_evidence"].update(
                {"current_asset_count": 19}
            ),
        ),
    ],
)
def test_synchronized_input_drift_still_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    source_name: str,
    mutate: Callable[[dict], None],
) -> None:
    _mutated_json_source(monkeypatch, tmp_path, source_name, mutate)
    with pytest.raises(builder.FoothillsReviewError):
        builder.build()


def test_artwork_verifier_checks_both_exact_copies_and_rejects_drift(
    tmp_path: Path,
) -> None:
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    first_root.mkdir()
    second_root.mkdir()
    first = first_root / "candidate"
    second = second_root / "candidate.jpg"
    first.write_bytes(b"exact review evidence")
    second.write_bytes(b"exact review evidence")
    digest = hashlib.sha256(first.read_bytes()).hexdigest()
    artwork = (
        {
            "candidate_id": "candidate",
            "original_bytes": first.stat().st_size,
            "original_sha256": digest,
        },
    )
    assert builder.verify_artwork_evidence(
        (first_root, second_root), artwork
    ) == {
        "verified_candidate_count": 1,
        "verified_copy_count": 2,
        "verified_original_bytes": 21,
        "copies_match": True,
        "ingestion_allowed": False,
    }
    second.write_bytes(b"drift")
    with pytest.raises(builder.FoothillsReviewError, match="byte count drifted"):
        builder.verify_artwork_evidence((first_root, second_root), artwork)


def test_markdown_review_sheet_contains_all_decision_points_and_full_text() -> None:
    value = _tracked()
    markdown = builder.MARKDOWN_OUTPUT_PATH.read_text(encoding="utf-8")
    assert markdown.count("Decision: [ ] Approve exact script") == 13
    assert markdown.count("Decision: [ ] Approve exact candidate") == 2
    for row in value["scripts"]:
        assert row["transcript"] in markdown
        assert row["id"] in markdown
    for row in value["artwork_candidates"]:
        assert row["candidate_id"] in markdown
        assert row["local_evidence_locator"] in markdown
        assert row["original_sha256"] in markdown
    assert "Other chapters approved by this sheet: no" in markdown
    assert "does not authorize artwork sanitation or ingestion" in markdown
