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

import scripts.build_smokies_remaining_chapters_review as builder


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


def test_packet_and_sheet_are_deterministic_network_and_database_free(
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


def test_exact_fifty_one_script_order_and_five_separate_overrides() -> None:
    value = _tracked()
    chapters = {row["chapter_id"]: row for row in value["chapter_reviews"]}
    mountain = chapters["mountain_crossing"]
    cades = chapters["little_river_cades_cove"]
    assert [row["id"] for row in mountain["scripts"]] == list(
        builder.CHAPTER_SPECS["mountain_crossing"]["story_ids"]
        + builder.CHAPTER_SPECS["mountain_crossing"]["cue_ids"]
    )
    assert [row["id"] for row in cades["scripts"]] == list(
        builder.CHAPTER_SPECS["little_river_cades_cove"]["story_ids"]
        + builder.CHAPTER_SPECS["little_river_cades_cove"]["cue_ids"]
    )
    assert cades["scripts"][6]["id"] == "cc_story_10"
    assert cades["scripts"][9]["id"] == "cc_story_09"
    assert cades["scripts"][10]["id"] == "cc_story_13"
    all_scripts = [row for chapter in value["chapter_reviews"] for row in chapter["scripts"]]
    assert len(all_scripts) == 51
    assert sum(row["kind"] == "story" for row in all_scripts) == 32
    assert sum(row["kind"] == "cue" for row in all_scripts) == 19
    assert all(row["transcript"].strip() for row in all_scripts)
    assert all(len(row["transcript_sha256"]) == 64 for row in all_scripts)
    assert all(row["decision_status"] == "user_approve_or_revise_required" for row in all_scripts)
    assert all(row["rendering_allowed"] is False for row in all_scripts)

    overrides = [
        (row["id"], override)
        for row in all_scripts
        for override in row.get("variant_overrides", [])
    ]
    assert [entry_id for entry_id, _ in overrides] == list(
        builder.CHAPTER_SPECS["mountain_crossing"]["override_ids"]
    )
    assert [row["transcript_sha256"] for _, row in overrides] == [
        "b86b8b1cd7bdf268e5c39823d534992ed54e15c0fdba0eb0ae023f97f5e67df9",
        "495fdcd6b85e8cf5bd706719f7bee12c81cc9885499b090e77560a0936b91ca9",
        "8ec1ecdc7587a666e05531001862c1de38a4a7cb01d31b062e9b94ffc55b8694",
        "431beed19885a1db7bd1cd7a2242c0cbbe99a98f9bad298fedf0497fc235dfa1",
        "95cb13414d2f35338c74134f4971a152482ca4732294abf6f03811ff0359129f",
    ]
    assert all(row["variant_id"] == "nc_to_tn" for _, row in overrides)
    assert all(row["decision_status"] == "user_approve_or_revise_required" for _, row in overrides)
    assert all(row["rendering_allowed"] is False for _, row in overrides)


def test_public_record_claim_source_and_script_mappings_are_exact() -> None:
    value = _tracked()
    scope = value["public_record_scope"]
    assert scope["claim_count"] == 34
    assert scope["culturally_gated_claim_count"] == 0
    assert scope["blocked_entry_count"] == 0
    assert scope["external_outreach_required"] is False
    determination = scope["owner_scope_determination"]
    assert determination["status"] == "accepted_internal_scope_determination"
    assert determination["scope"] == "exact_checked_in_public_record_factual_claims_only"
    assert determination["review_claim_count"] == 34
    assert determination["review_claims_all_in_determination"] is True
    assert determination["external_outreach_required"] is False
    assert determination["external_outreach_performed"] is False
    assert determination["ebci_approval_claimed"] is False
    assert determination["prohibited_until_approved"] == [
        "culturally_supplied_pronunciation",
        "direct_ebci_member_research",
        "research_on_ebci_tribal_land",
        "sacred_or_traditional_interpretation",
        "tts_rendering_of_gated_content",
        "unpublished_or_restricted_knowledge",
    ]
    for chapter in value["chapter_reviews"]:
        claims = {row["id"]: row for row in chapter["claims"]}
        sources = {row["id"]: row for row in chapter["official_sources"]}
        assert len(claims) == chapter["claim_count"]
        assert all(row["status"] == "source_verified" for row in claims.values())
        assert all(row["cultural_gate"] == "not_required" for row in claims.values())
        assert all(
            row["cultural_scope"]["review_triggers"] == [] for row in claims.values()
        )
        assert all(row["authority"] == "official" for row in sources.values())
        assert all(row["publisher"] == "National Park Service" for row in sources.values())
        for script in chapter["scripts"]:
            assert set(script["claim_ids"]) <= set(claims)
            assert set(script["source_ids"]) <= set(sources)


def test_three_route_variants_are_review_context_not_publication_evidence() -> None:
    value = _tracked()
    rows = [
        route
        for chapter in value["chapter_reviews"]
        for route in chapter["route_review_context"]["variants"]
    ]
    assert [row["variant_id"] for row in rows] == [
        "tn_to_nc",
        "nc_to_tn",
        "sugarlands_to_cades_cove_loop",
    ]
    assert [row["geometry_sha256"] for row in rows] == [
        "4a003a6bde4d0c9623a71875bb5f369050f11202f58cd5c02d9451377ad980ab",
        "2da7812bfd8f129492420cf6cfeca2d990950a0eb057f98c586bbcbd4aaad5b3",
        "9f77ba8f704e82b3fb43e81f330a20771e2d8d87b44fe1fae29329cf082255c8",
    ]
    assert all(row["geometry_ready_for_editorial_cues"] is True for row in rows)
    assert all(row["publication_evidence"] is False for row in rows)
    assert all(
        chapter["route_review_context"]["publication_status"] == "blocked"
        for chapter in value["chapter_reviews"]
    )


def test_four_exact_originals_include_mpo_and_grayscale_source_facts() -> None:
    artwork = _tracked()["artwork_candidates"]
    assert [row["candidate_id"] for row in artwork] == [
        "media_mc_kuwohi",
        "media_mc_oconaluftee",
        "media_cc_cove",
        "media_cc_cable_mill",
    ]
    assert [row["original_sha256"] for row in artwork] == [
        "023e027f74aff09bacbec01e89c144248cf3e633f33faa0413e41518d7157c02",
        "33a44dea4f933f68af8d6e9cc70aaf68ede2ef418f675b87ef3d51cfd8bc21c5",
        "c01e63f283a7b8b63d721792172ffcc772c168a4f6e32c788e9f4344308de476",
        "6b9d41b9ce8599d17fe94d478866d2d0384d6f0b8dd005ee5183e41abe5549cd",
    ]
    kuwohi = artwork[0]
    assert kuwohi["rights_record_format"] == "JPEG"
    assert kuwohi["source_format"] == "MPO"
    assert kuwohi["source_mode"] == "RGB"
    assert kuwohi["source_frame_count"] == 2
    assert kuwohi["selected_primary_frame_index"] == 0
    assert kuwohi["selected_primary_frame_type"] == "Baseline MP Primary Image"
    assert kuwohi["excluded_frame"] == {
        "index": 1,
        "mp_type": "Undefined",
        "dimensions": {"width": 1998, "height": 1388},
        "mode": "L",
        "decoded_pixel_sha256": "e6a5bf9404280b65469fdfba99d8f9aeacbf021a4b1014fe87232399b6aa38a3",
        "included_in_proposed_derivative": False,
    }
    assert kuwohi["gps_metadata_present"] is True
    assert kuwohi["icc_profile_bytes"] == 536
    for row in artwork[2:]:
        assert row["source_format"] == "TIFF"
        assert row["source_mode"] == "L"
        assert row["source_frame_count"] == 1
        assert row["gps_metadata_present"] is False
        assert row["icc_profile_bytes"] == 0
    assert artwork[0]["license_name"] == "CC BY 4.0"
    assert artwork[0]["required_commercial_notice"] is None
    assert all(
        row["required_commercial_notice"] == builder.US_GOVERNMENT_WORK_NOTICE
        for row in artwork[1:]
    )
    for row in artwork:
        assert row["status"] == "candidate_only_user_visual_approval_required"
        assert row["exact_original_user_visual_approval"] is False
        assert row["sanitation_authorized"] is False
        assert row["sanitized_derivative_complete"] is False
        assert row["derivative_user_visual_approval"] is False
        assert row["ingestion_allowed"] is False
        assert row["upload_allowed"] is False
        assert row["publication_allowed"] is False


def test_six_image_sanitation_proposal_is_exact_and_unauthorized() -> None:
    job = _tracked()["proposed_six_image_sanitation_job"]
    assert job["status"] == "owner_authorization_required_no_derivatives_created"
    assert job["item_count"] == 6
    assert [row["candidate_id"] for row in job["items"]] == [
        "media_fp_panorama",
        "media_fp_engineering",
        "media_mc_kuwohi",
        "media_mc_oconaluftee",
        "media_cc_cove",
        "media_cc_cable_mill",
    ]
    by_id = {row["candidate_id"]: row for row in job["items"]}
    assert by_id["media_mc_kuwohi"]["source_format"] == "MPO"
    assert by_id["media_mc_kuwohi"]["source_frame_count"] == 2
    assert by_id["media_mc_kuwohi"]["selected_source_frame_index"] == 0
    assert by_id["media_mc_kuwohi"]["selected_source_frame_type"] == (
        "Baseline MP Primary Image"
    )
    assert by_id["media_mc_kuwohi"]["frame_policy"] == (
        "preserve_full_selected_primary_frame_only; do_not_merge_or_retain_secondary_mpo_frame"
    )
    assert by_id["media_mc_kuwohi"]["color_transform"] == (
        "select_mpo_baseline_primary_frame_0_then_embedded_rgb_icc_to_srgb_perceptual_lcms2"
    )
    for candidate_id in ("media_cc_cove", "media_cc_cable_mill"):
        assert by_id[candidate_id]["source_mode"] == "L"
        assert by_id[candidate_id]["output_mode"] == "RGB"
        assert by_id[candidate_id]["color_transform"] == (
            "untagged_l_to_srgb_rgb_equal_channel_replication"
        )
    assert by_id["media_fp_panorama"]["exact_original_user_visual_approval"] is True
    assert by_id["media_fp_engineering"]["exact_original_user_visual_approval"] is True
    assert by_id["media_mc_kuwohi"]["exact_credit"].startswith(
        '"Kuwohi (also known as Clingmans Dome) Observation Tower - 1"'
    )
    assert by_id["media_mc_kuwohi"]["required_commercial_notice"] is None
    expected_change_notes = {
        "media_fp_panorama": (
            "Modified from the original: applied recorded EXIF orientation, "
            "preserved full-frame RGB samples under an sRGB assumption, and "
            "removed metadata; no crop or resize."
        ),
        "media_fp_engineering": (
            "Modified from the original: applied recorded EXIF orientation, "
            "converted the embedded ICC profile to sRGB, and removed metadata; "
            "no crop or resize."
        ),
        "media_mc_kuwohi": (
            "Modified from the original: selected the Baseline MP Primary Image "
            "at MPO frame 0, applied recorded EXIF orientation, converted its "
            "embedded ICC profile to sRGB, excluded the secondary MPO frame, and "
            "removed metadata; no crop or resize."
        ),
        "media_mc_oconaluftee": (
            "Modified from the original: applied recorded EXIF orientation, "
            "converted the embedded ICC profile to sRGB, and removed metadata; "
            "no crop or resize."
        ),
        "media_cc_cove": (
            "Modified from the original: applied recorded TIFF orientation, "
            "replicated each 8-bit grayscale sample equally into sRGB R/G/B "
            "channels, and removed metadata; no crop or resize."
        ),
        "media_cc_cable_mill": (
            "Modified from the original: applied recorded TIFF orientation, "
            "replicated each 8-bit grayscale sample equally into sRGB R/G/B "
            "channels, and removed metadata; no crop or resize."
        ),
    }
    assert {key: row["change_note"] for key, row in by_id.items()} == (
        expected_change_notes
    )
    for candidate_id in (
        "media_fp_panorama",
        "media_fp_engineering",
        "media_mc_oconaluftee",
        "media_cc_cove",
        "media_cc_cable_mill",
    ):
        assert by_id[candidate_id]["required_commercial_notice"] == (
            builder.US_GOVERNMENT_WORK_NOTICE
        )
    assert all(row["source_asset_url"].startswith("https://") for row in job["items"])
    assert all(
        row["source_license_record_url"].startswith("https://") for row in job["items"]
    )
    assert all(
        row["source_rights_credit_change_note_and_notice_bound"] is True
        for row in job["items"]
    )
    assert all(row["output_format"] == "PNG" for row in job["items"])
    assert all(row["crop_allowed"] is False for row in job["items"])
    assert all(row["resize_allowed"] is False for row in job["items"])
    assert all(row["png_allowed_chunk_types"] == ["IHDR", "IDAT", "IEND"] for row in job["items"])
    assert all(row["sanitation_authorized"] is False for row in job["items"])
    assert all(row["derivative_created"] is False for row in job["items"])
    assert all(row["derivative_user_visual_approval"] is False for row in job["items"])
    assert job["sanitation_authorized"] is False
    assert job["derivatives_created"] is False
    assert job["derivative_visual_approval"] is False
    assert job["ingestion_allowed"] is False


def test_exact_james_locks_and_independent_spend_envelopes_are_bound_false() -> None:
    value = _tracked()["proposed_james_render_and_spend"]
    assert value["status"] == "owner_render_and_spend_authorization_required"
    assert value["voice"] == {
        "provider": "elevenlabs",
        "voice_name": "James - Husky, Engaging and Bold",
        "voice_id": "EkK5I93UQWFDigLMpZcX",
        "model_id": "eleven_multilingual_v2",
        "output_format": "mp3_44100_128",
        "accepted_profile_selected_for_all_three_chapters": True,
        "voice_settings": {
            "similarity_boost": 0.5,
            "speed": 1.0,
            "stability": 0.5,
            "style": 0.1,
            "use_speaker_boost": True,
        },
    }
    assert [row["chapter_id"] for row in value["chapter_envelopes"]] == [
        "foothills_parkway",
        "mountain_crossing",
        "little_river_cades_cove",
    ]
    assert [row["request_count"] for row in value["chapter_envelopes"]] == [16, 33, 23]
    assert [row["reserved_provider_credit_ceiling"] for row in value["chapter_envelopes"]] == [23557, 65938, 48695]
    assert [row["renderer_character_cap"] for row in value["chapter_envelopes"]] == [23600, 66000, 48700]
    assert [row["proposed_one_day_api_key_credit_quota"] for row in value["chapter_envelopes"]] == [25000, 70000, 50000]
    assert [row["dollar_cap_usd"] for row in value["chapter_envelopes"]] == ["2.50", "7.00", "5.00"]
    aggregate = value["aggregate"]
    assert aggregate["provider_request_count"] == 72
    assert aggregate["payload_character_count"] == 125595
    assert aggregate["normalized_character_count"] == 125328
    assert aggregate["reserved_provider_credit_ceiling"] == 138190
    assert aggregate["renderer_character_cap"] == 138300
    assert aggregate["proposed_one_day_api_key_credit_quota"] == 145000
    assert aggregate["dollar_cap_usd"] == "14.50"
    assert aggregate["cross_chapter_borrowing_allowed"] is False
    assert aggregate["paid_overage_authorized"] is False
    assert aggregate["rerender_budget"] == 0
    assert value["fresh_authenticated_provider_preflight_complete"] is False
    assert value["api_key_creation_authorized"] is False
    assert value["provider_request_authorized"] is False
    assert value["provider_credit_spend_authorized"] is False
    assert value["render_authorized"] is False
    assert value["narration_generated"] is False
    for row in value["chapter_envelopes"]:
        assert row["lock_binding"] == _tracked()["source_bindings"][
            {
                "foothills_parkway": "james_foothills_lock",
                "mountain_crossing": "james_mountain_lock",
                "little_river_cades_cove": "james_cades_lock",
            }[row["chapter_id"]]
        ]


def test_product_contract_and_existing_approvals_are_preserved() -> None:
    value = _tracked()
    assert value["product_contract"] == {
        "pack_scope": "one_premium_four_chapter_product",
        "chapter_ids": [
            "mountain_crossing",
            "little_river_cades_cove",
            "roaring_fork",
            "foothills_parkway",
        ],
        "route_variant_count": 6,
        "permanent_credit_price": 900,
        "credit_type": "earned_credits",
        "explorer_included": True,
        "standalone_chapter_products_approved": False,
        "standalone_roaring_fork_public_product_approved": False,
        "standalone_foothills_public_product_approved": False,
        "changing_scope_or_price_requires_separate_product_decision": True,
    }
    foothills = value["protected_foothills_s4u_evidence"]
    assert foothills["guarded_source_commit"] == (
        "bc70fae8a8dad021818d07df5d517c556d133968"
    )
    assert foothills["approved_script_count"] == 13
    assert foothills["approved_original_artwork_count"] == 2
    assert foothills["review_source_bindings"] == [
        value["source_bindings"]["foothills_review_packet"],
        value["source_bindings"]["foothills_review_sheet"],
    ]
    assert foothills["review_source_commit"] == (
        "7b37de90f8df9a5f9a04e6fda0a6fc276d4e3cd5"
    )
    assert foothills["review_checkpoint_commit"] == (
        "b501dedcb381705a8c84328650f1bfc5db6afc19"
    )
    assert foothills["artwork_sanitation_authorized"] is False
    assert foothills["narration_authorized"] is False
    roaring = value["protected_roaring_fork_evidence"]
    assert roaring["draft_revision"] == 2
    assert roaring["current_asset_count"] == 20
    assert roaring["narration_count"] == 13
    assert roaring["artwork_count"] == 7
    assert roaring["published_version_count"] == 0
    assert roaring["trusted_private_validation"]["publication_approval"] is False
    assert roaring["trusted_private_validation"][
        "must_rerun_after_final_manifest_or_source_change"
    ] is True


def test_every_new_or_downstream_action_remains_fail_closed() -> None:
    gate = _tracked()["decision_gate"]
    assert gate["accepted_james_profile_selected_for_remaining_chapters"] is True
    false_fields = [
        name
        for name, value in gate.items()
        if isinstance(value, bool)
        and name != "accepted_james_profile_selected_for_remaining_chapters"
    ]
    assert false_fields
    assert all(gate[name] is False for name in false_fields)
    assert gate["next_action"] == (
        "collect_explicit_approve_or_revise_decisions_for_51_scripts_5_direction_"
        "overrides_4_originals_the_6_image_sanitation_job_and_the_exact_james_"
        "render_and_spend_envelopes"
    )


def test_read_only_local_evidence_verifier_checks_both_exact_mirrors() -> None:
    roots = builder.default_evidence_roots()
    if len(roots) != 2:
        pytest.skip("both local evidence mirrors are not available")
    result = builder.verify_artwork_evidence(roots)
    assert result == {
        "verified_candidate_count": 6,
        "verified_root_count": 2,
        "verified_copy_count": 12,
        "copies_match": True,
        "paths_serialized": False,
        "raw_exif_values_serialized": False,
        "derivative_creation_allowed": False,
        "ingestion_allowed": False,
    }


def test_evidence_verifier_rejects_mpo_format_or_frame_drift(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = builder.default_evidence_roots()[0] / "media_mc_kuwohi"
    if not source.is_file():
        pytest.skip("Kuwohi evidence original is unavailable")
    expected = dict(builder.ARTWORK[0])
    expected["source_frame_count"] = 1
    with pytest.raises(builder.RemainingReviewError, match="source frame count drifted"):
        builder._inspect_image(source, expected)
    expected = dict(builder.ARTWORK[0])
    expected["source_format"] = "JPEG"
    with pytest.raises(builder.RemainingReviewError, match="source image fact drifted"):
        builder._inspect_image(source, expected)


@pytest.mark.parametrize(
    ("source_name", "mutate"),
    [
        ("mountain_editorial", lambda value: value["entries"].pop()),
        (
            "mountain_editorial",
            lambda value: next(
                row for row in value["entries"] if row["id"] == "mc_cue_01"
            )["variant_overrides"][0].update({"transcript": "drift"}),
        ),
        (
            "cades_editorial",
            lambda value: value["entries"].reverse(),
        ),
        (
            "source_dossier",
            lambda value: next(
                row for row in value["claims"] if row["id"] == "mc_kuwohi_public_record"
            ).update({"cultural_gate": "ebci_required"}),
        ),
        (
            "public_record_scope_determination",
            lambda value: value.update({"external_outreach_required": True}),
        ),
        (
            "source_dossier",
            lambda value: next(
                row for row in value["media_candidates"] if row["id"] == "media_cc_cove"
            ).update({"status": "approved"}),
        ),
        (
            "official_route_evidence",
            lambda value: next(
                row for row in value["variants"] if row.get("variant_id") == "nc_to_tn"
            ).update({"geometry_sha256": "0" * 64}),
        ),
        (
            "foothills_approval",
            lambda value: value["approval_boundary"].update(
                {"artwork_sanitation_authorized": True}
            ),
        ),
        (
            "roaring_fork_publication_readiness",
            lambda value: value["accepted_private_evidence"].update(
                {"published_version_count": 1}
            ),
        ),
        (
            "james_mountain_lock",
            lambda value: value["budget"].update(
                {"cross_chapter_borrowing_allowed": True}
            ),
        ),
        (
            "james_remaining_batch_preflight",
            lambda value: value["builder_effects"].update(
                {"provider_requests_sent": 1}
            ),
        ),
    ],
)
def test_synchronized_source_drift_still_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    source_name: str,
    mutate: Callable[[dict], None],
) -> None:
    _mutated_json_source(monkeypatch, tmp_path, source_name, mutate)
    with pytest.raises(builder.RemainingReviewError):
        builder.build()


def test_markdown_exposes_every_decision_and_full_transcript() -> None:
    value = _tracked()
    markdown = builder.MARKDOWN_OUTPUT_PATH.read_text(encoding="utf-8")
    assert markdown.count("Decision: [ ] Approve exact script") == 51
    assert markdown.count("Override decision: [ ] Approve exact override") == 5
    assert markdown.count("Decision: [ ] Approve exact original") == 4
    assert markdown.count("Authorize this exact six-image sanitation job") == 1
    assert markdown.count("Authorize the exact three-chapter James render") == 1
    for chapter in value["chapter_reviews"]:
        for row in chapter["scripts"]:
            assert row["transcript"] in markdown
            assert row["transcript_sha256"] in markdown
            for override in row.get("variant_overrides", []):
                assert override["transcript"] in markdown
                assert override["transcript_sha256"] in markdown
    for row in value["artwork_candidates"]:
        assert row["candidate_id"] in markdown
        assert row["original_sha256"] in markdown
    assert "Other chapters approved by this sheet: no" in markdown


def test_tracked_packet_does_not_serialize_local_paths_raw_exif_or_secrets() -> None:
    serialized = builder.OUTPUT_PATH.read_text(encoding="utf-8")
    markdown = builder.MARKDOWN_OUTPUT_PATH.read_text(encoding="utf-8")
    combined = serialized + markdown
    forbidden = (
        "/home/",
        "/mnt/c/",
        "C:\\Users\\",
        "\\\\wsl",
        "iPhone 14 Pro",
        "iPhone 8",
        "2024:09:19 17:10:34",
        "2018:07:28 06:30:23",
        "OPENAI_API_KEY",
        "ELEVENLABS_API_KEY",
        "sk-",
    )
    assert all(value not in combined for value in forbidden)
    assert "@" not in serialized
    assert _tracked()["local_evidence_verification"]["paths_serialized"] is False
    assert _tracked()["local_evidence_verification"][
        "raw_exif_values_serialized"
    ] is False
    builder_source = Path(builder.__file__).read_text(encoding="utf-8")
    assert "/home/sean" not in builder_source
    assert "/mnt/c/Users/User" not in builder_source
    assert "C:\\Users\\User" not in builder_source
    assert "iPhone 14 Pro" not in builder_source
    assert "2024:09:19 17:10:34" not in builder_source


def test_s4u_overlay_was_not_rewritten_to_create_this_review() -> None:
    result = subprocess.run(
        [
            "git",
            "show",
            "bc70fae8a8dad021818d07df5d517c556d133968:"
            "originals/smokies/foothills_parkway_approval_v1.json",
        ],
        cwd=builder.REPOSITORY,
        check=True,
        capture_output=True,
    )
    assert hashlib.sha256(result.stdout).hexdigest() == (
        builder.EXPECTED_SOURCE_SHA256["foothills_approval"]
    )
    assert hashlib.sha256(builder.SOURCE_PATHS["foothills_approval"].read_bytes()).hexdigest() == (
        builder.EXPECTED_SOURCE_SHA256["foothills_approval"]
    )
