from __future__ import annotations

import ast
import hashlib
import json
import math
from copy import deepcopy
from pathlib import Path

import pytest

from scripts import build_smokies_elevenlabs_james_remaining_locks as builder


REPOSITORY = Path(__file__).resolve().parents[1]

EXPECTED = {
    "foothills_parkway": {
        "base": 13,
        "stories": 6,
        "cues": 7,
        "overrides": 3,
        "requests": 16,
        "payload": 21_408,
        "normalized": 21_369,
        "words": 3_431,
        "reserved": 23_557,
        "renderer": 23_600,
        "key": 25_000,
        "dollar": "2.50",
        "base_variant": "west_to_east",
        "variants": ["west_to_east", "east_to_west"],
        "editorial": "originals/smokies/editorial_scripts_v1.json",
        "approved": True,
    },
    "mountain_crossing": {
        "base": 28,
        "stories": 18,
        "cues": 10,
        "overrides": 5,
        "requests": 33,
        "payload": 59_928,
        "normalized": 59_801,
        "words": 9_499,
        "reserved": 65_938,
        "renderer": 66_000,
        "key": 70_000,
        "dollar": "7.00",
        "base_variant": "tn_to_nc",
        "variants": ["tn_to_nc", "nc_to_tn"],
        "editorial": "originals/smokies/editorial_mountain_crossing_v1.json",
        "approved": False,
    },
    "little_river_cades_cove": {
        "base": 23,
        "stories": 14,
        "cues": 9,
        "overrides": 0,
        "requests": 23,
        "payload": 44_259,
        "normalized": 44_158,
        "words": 6_911,
        "reserved": 48_695,
        "renderer": 48_700,
        "key": 50_000,
        "dollar": "5.00",
        "base_variant": "sugarlands_to_cades_cove_loop",
        "variants": ["sugarlands_to_cades_cove_loop"],
        "editorial": "originals/smokies/editorial_cades_cove_v1.json",
        "approved": False,
    },
}

EXPECTED_OVERRIDES = {
    ("foothills_parkway", "fp_cue_01", "east_to_west"),
    ("foothills_parkway", "fp_cue_05", "east_to_west"),
    ("foothills_parkway", "fp_cue_07", "east_to_west"),
    ("mountain_crossing", "mc_cue_01", "nc_to_tn"),
    ("mountain_crossing", "mc_cue_02", "nc_to_tn"),
    ("mountain_crossing", "mc_cue_04", "nc_to_tn"),
    ("mountain_crossing", "mc_cue_08", "nc_to_tn"),
    ("mountain_crossing", "mc_cue_09", "nc_to_tn"),
}


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _chapter_artifacts() -> dict[str, dict]:
    result = {}
    for spec in builder.CHAPTER_SPECS:
        result[spec.chapter_id] = _load(spec.destination)
    return result


def _source_transcripts(editorial: dict) -> dict[str, tuple[dict, str, str]]:
    result = {}
    for entry in editorial["entries"]:
        result[f"{entry['id']}__base"] = (
            entry,
            entry["transcript"],
            entry["title"],
        )
        for override in entry.get("variant_overrides", []):
            result[f"{entry['id']}__{override['variant_id']}"] = (
                entry,
                override["transcript"],
                override.get("title") or entry["title"],
            )
    return result


def _walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def test_builder_reproduces_all_checked_artifacts_byte_for_byte():
    artifacts = builder.build_all()
    assert set(artifacts) == {
        *(spec.destination for spec in builder.CHAPTER_SPECS),
        builder.BATCH_DESTINATION,
    }
    for path, expected in artifacts.items():
        assert path.read_text(encoding="utf-8") == builder.serialize(expected)


def test_exact_72_request_inventory_and_chapter_budgets():
    locks = _chapter_artifacts()
    assert sum(lock["aggregate"]["provider_request_count"] for lock in locks.values()) == 72
    assert sum(lock["aggregate"]["base_entry_count"] for lock in locks.values()) == 64
    assert sum(lock["aggregate"]["directional_override_count"] for lock in locks.values()) == 8

    for chapter_id, expected in EXPECTED.items():
        lock = locks[chapter_id]
        aggregate = lock["aggregate"]
        budget = lock["budget"]
        assert aggregate == {
            "base_entry_count": expected["base"],
            "base_story_count": expected["stories"],
            "base_cue_count": expected["cues"],
            "directional_override_count": expected["overrides"],
            "provider_request_count": expected["requests"],
            "delivery_variant_count": len(expected["variants"]),
        }
        assert budget["payload_character_count"] == expected["payload"]
        assert budget["normalized_character_count"] == expected["normalized"]
        assert budget["word_count"] == expected["words"]
        assert budget["reserved_provider_credit_ceiling"] == expected["reserved"]
        assert budget["renderer_character_cap"] == expected["renderer"]
        assert budget["proposed_one_day_api_key_credit_quota"] == expected["key"]
        assert budget["dollar_cap_usd"] == expected["dollar"]
        assert budget["rerender_budget"] == 0
        assert budget["paid_overage_authorized"] is False
        assert budget["cross_chapter_borrowing_allowed"] is False
        assert budget["unused_budget_transfer_allowed"] is False


def test_every_request_binds_exact_source_text_counts_hashes_and_reservation():
    locks = _chapter_artifacts()
    for chapter_id, expected in EXPECTED.items():
        lock = locks[chapter_id]
        editorial = _load(REPOSITORY / expected["editorial"])
        source = _source_transcripts(editorial)
        requests = lock["requests"]
        assert [row["stable_order"] for row in requests] == list(
            range(1, len(requests) + 1)
        )
        assert {row["provider_request_id"] for row in requests} == set(source)
        assert all(
            row["provider_request_id"].endswith("__base")
            for row in requests[: expected["base"]]
        )
        assert all(
            row["request_kind"] == "directional_override"
            for row in requests[expected["base"] :]
        )
        for row in requests:
            entry, transcript, title = source[row["provider_request_id"]]
            normalized = " ".join(transcript.split())
            assert row["entry_id"] == entry["id"]
            assert row["title"] == title
            assert row["title_sha256"] == hashlib.sha256(
                title.encode("utf-8")
            ).hexdigest()
            assert row["raw_transcript_sha256"] == hashlib.sha256(
                transcript.encode("utf-8")
            ).hexdigest()
            assert row["normalized_transcript_sha256"] == hashlib.sha256(
                normalized.encode("utf-8")
            ).hexdigest()
            assert row["payload_character_count"] == len(transcript)
            assert row["normalized_character_count"] == len(normalized)
            assert row["word_count"] == len(normalized.split(" "))
            assert row["reserved_provider_credit_ceiling"] == math.ceil(
                len(transcript) * 1.1
            )
            assert row["base_variant_id"] == expected["base_variant"]
            assert row["exact_script_user_approved"] is expected["approved"]
            assert row["provider_request_sent"] is False
            assert row["render_authorized"] is False
            assert row["spend_authorized"] is False
            assert row["narration_generated"] is False
            assert row["accepted_audio_sha256"] is None


def test_editorial_source_order_and_collision_safe_request_ids_are_preserved():
    locks = _chapter_artifacts()
    for chapter_id, expected in EXPECTED.items():
        editorial = _load(REPOSITORY / expected["editorial"])
        expected_base_ids = [
            f"{entry['id']}__base" for entry in editorial["entries"]
        ]
        requests = locks[chapter_id]["requests"]
        assert [
            row["provider_request_id"] for row in requests[: expected["base"]]
        ] == expected_base_ids

    cades_ids = [
        row["entry_id"]
        for row in locks["little_river_cades_cove"]["requests"]
    ]
    assert cades_ids == [
        *(f"cc_story_{value:02d}" for value in (1, 2, 3, 4, 5, 6, 10, 7, 8, 9, 13, 11, 12, 14)),
        *(f"cc_cue_{value:02d}" for value in range(1, 10)),
    ]


def test_base_and_override_requests_have_exact_variant_scope_and_delivery_map():
    locks = _chapter_artifacts()
    actual_overrides = set()
    for chapter_id, expected in EXPECTED.items():
        lock = locks[chapter_id]
        editorial = _load(REPOSITORY / expected["editorial"])
        variant_ids = expected["variants"]
        requests = {
            row["provider_request_id"]: row for row in lock["requests"]
        }
        for entry in editorial["entries"]:
            override_variants = {
                row["variant_id"] for row in entry.get("variant_overrides", [])
            }
            base = requests[f"{entry['id']}__base"]
            assert base["effective_variant_ids"] == [
                value for value in variant_ids if value not in override_variants
            ]
            assert base["override_variant_id"] is None
            for override in entry.get("variant_overrides", []):
                variant_id = override["variant_id"]
                request = requests[f"{entry['id']}__{variant_id}"]
                assert request["effective_variant_ids"] == [variant_id]
                assert request["override_variant_id"] == variant_id
                actual_overrides.add((chapter_id, entry["id"], variant_id))

        direction = lock["direction_delivery"]
        assert direction["base_variant_id"] == expected["base_variant"]
        assert direction["reviewed_variant_ids"] == variant_ids
        for variant in direction["variants"]:
            assert variant["entry_count"] == expected["base"]
            selected = variant["entry_audio_request_map"]
            assert [row["entry_id"] for row in selected] == [
                entry["id"] for entry in editorial["entries"]
            ]
            for row in selected:
                request = requests[row["provider_request_id"]]
                assert variant["variant_id"] in request["effective_variant_ids"]
    assert actual_overrides == EXPECTED_OVERRIDES


def test_exact_accepted_james_profile_is_reused_without_generation():
    accepted = _load(builder.JAMES_LOCK_PATH)["generation_profile"]
    locks = _chapter_artifacts()
    for chapter_id, lock in locks.items():
        assert lock["generation_profile"] == accepted
        assert lock["generation_profile"]["voice_id"] == "EkK5I93UQWFDigLMpZcX"
        assert lock["generation_profile"]["model_id"] == "eleven_multilingual_v2"
        assert lock["generation_profile"]["output"]["format_id"] == "mp3_44100_128"
        assert lock["generation_profile"]["voice_settings"] == {
            "similarity_boost": 0.5,
            "speed": 1.0,
            "stability": 0.5,
            "style": 0.1,
            "use_speaker_boost": True,
        }
        assert lock["authorization"]["accepted_james_profile_reused"] is True
        assert lock["builder_effects"] == {
            "network_accessed": False,
            "provider_accessed": False,
            "database_accessed": False,
            "media_files_created": False,
            "provider_requests_sent": 0,
            "provider_credits_spent": 0,
        }, chapter_id


def test_all_render_spend_and_downstream_authorization_gates_remain_false():
    locks = _chapter_artifacts()
    allowed_true = {"accepted_james_profile_reused", "exact_scripts_user_approved"}
    for lock in locks.values():
        for key, value in lock["authorization"].items():
            if key not in allowed_true:
                assert value is False, key
        for row in lock["requests"]:
            assert row["provider_request_sent"] is False
            assert row["render_authorized"] is False
            assert row["spend_authorized"] is False
            assert row["narration_generated"] is False

    preflight = _load(builder.BATCH_DESTINATION)
    assert all(value is False for value in preflight["authorization"].values())
    assert preflight["status"] == (
        "network_free_review_ready_authenticated_preflight_not_run"
    )
    assert preflight["fresh_authenticated_preflight_required"]["status"] == (
        "not_performed_by_network_free_builder"
    )
    assert preflight["builder_effects"] == {
        "network_accessed": False,
        "provider_accessed": False,
        "database_accessed": False,
        "media_files_created": False,
        "api_keys_created": 0,
        "provider_requests_sent": 0,
        "provider_credits_spent": 0,
    }


def test_batch_preflight_binds_final_product_counts_directions_and_isolated_caps():
    preflight = _load(builder.BATCH_DESTINATION)
    assert preflight["scope"] == {
        "new_chapter_count": 3,
        "new_base_entry_count": 64,
        "new_directional_override_count": 8,
        "new_provider_request_count": 72,
        "existing_accepted_roaring_fork_narration_count": 13,
        "final_product_base_entry_count": 77,
        "final_product_directional_replacement_count": 8,
        "final_product_narration_asset_count": 85,
        "full_product_route_variant_count": 6,
        "new_batch_route_variant_count": 5,
        "existing_roaring_fork_route_variant_count": 1,
    }
    aggregate = preflight["budget_isolation"][
        "aggregate_informational_only_not_interchangeable"
    ]
    assert aggregate == {
        "payload_character_count": 125_595,
        "normalized_character_count": 125_328,
        "word_count": 19_841,
        "reserved_provider_credit_ceiling": 138_190,
        "renderer_character_caps": 138_300,
        "proposed_one_day_key_credit_quotas": 145_000,
        "dollar_caps_usd": "14.50",
    }
    isolation = preflight["budget_isolation"]
    assert isolation["policy"] == (
        "three_independent_chapter_ledgers_and_one_day_keys"
    )
    assert isolation["chapter_key_count"] == 3
    assert isolation["key_expiry_hours"] == 24
    assert isolation["cross_chapter_borrowing_allowed"] is False
    assert isolation["unused_budget_transfer_allowed"] is False
    assert isolation["paid_overage_authorized"] is False
    assert isolation["rerender_budget"] == 0
    assert preflight["direction_preflight"]["replacement_count"] == 8
    assert {
        (
            row["chapter_id"],
            row["entry_id"],
            row["variant_id"],
        )
        for row in preflight["direction_preflight"][
            "new_batch_directional_replacements"
        ]
    } == EXPECTED_OVERRIDES


def test_fresh_preflight_is_explicitly_required_and_terms_are_only_a_baseline():
    preflight = _load(builder.BATCH_DESTINATION)
    baseline = preflight["accepted_profile_baseline"]
    assert baseline["point_in_time_only"] is True
    assert baseline["fresh_authenticated_recheck_required"] is True
    assert baseline["terms_last_reviewed"] == {
        "terms_id": "elevenlabs_terms_of_service_non_eea_2026-03-31",
        "terms_url": "https://elevenlabs.io/terms-of-use",
        "terms_version": "31 March 2026",
        "reviewed_at": "2026-08-10",
        "jurisdiction": "non_eea",
    }
    required = set(
        preflight["fresh_authenticated_preflight_required"][
            "must_match_before_any_provider_request"
        ]
    )
    assert {
        "active_creator_or_equivalent_paid_plan_with_commercial_use",
        "non_beta_james_voice_identity_and_availability",
        "exact_voice_model_settings_and_native_output_format",
        "current_non_eea_terms_tuple_and_distribution_rights",
        "available_included_credits_at_or_above_each_chapter_renderer_cap",
        "paid_overage_disabled_or_not_used",
        "one_separate_restricted_one_day_key_per_chapter",
        "zero_existing_or_ambiguous_requests_in_each_chapter_ledger",
    } == required


def test_source_bindings_are_relative_exact_and_private_transcripts_are_not_copied():
    artifacts = [*_chapter_artifacts().values(), _load(builder.BATCH_DESTINATION)]
    for payload in artifacts:
        serialized = json.dumps(payload, ensure_ascii=False)
        assert "/home/" not in serialized
        assert "\\\\wsl" not in serialized.lower()
        assert "C:\\Users" not in serialized
        assert "sk-" not in serialized
        for mapping in _walk(payload):
            assert "transcript" not in mapping

    for lock in _chapter_artifacts().values():
        for binding in lock["source_files"]:
            path = REPOSITORY / binding["path"]
            assert path.is_file()
            assert path.stat().st_size == binding["byte_count"]
            assert _sha256(path) == binding["sha256"]


def test_builder_has_no_network_database_or_provider_client_imports():
    source = Path(builder.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported_roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_roots.add(node.module.split(".")[0])
    assert imported_roots.isdisjoint({
        "requests",
        "httpx",
        "urllib",
        "socket",
        "sqlite3",
        "railway",
        "elevenlabs",
    })


def test_foothills_script_or_direction_tamper_fails_against_exact_approval():
    editorial = _load(builder.CHAPTER_SPECS[0].editorial_path)
    approval = _load(builder.FOOTHILLS_APPROVAL_PATH)
    tampered = deepcopy(editorial["entries"])
    tampered[0]["transcript"] += " Changed."
    with pytest.raises(ValueError, match="Foothills base approval drifted"):
        builder._validate_foothills_approval(tampered, approval)

    tampered = deepcopy(editorial["entries"])
    cue = next(row for row in tampered if row["id"] == "fp_cue_01")
    cue["variant_overrides"][0]["transcript"] += " Changed."
    with pytest.raises(ValueError, match="Foothills override approval drifted"):
        builder._validate_foothills_approval(tampered, approval)


def test_unknown_or_rebound_direction_variant_fails_closed():
    route_spec = _load(builder.ROUTE_VARIANTS_PATH)
    spec = next(
        value
        for value in builder.CHAPTER_SPECS
        if value.chapter_id == "mountain_crossing"
    )
    tampered = deepcopy(route_spec)
    row = next(
        value
        for value in tampered["variants"]
        if value["chapter_id"] == "mountain_crossing"
        and value["variant_id"] == "nc_to_tn"
    )
    row["variant_id"] = "sideways"
    with pytest.raises(ValueError, match="route variants drifted"):
        builder._route_rows_for_chapter(spec, tampered)


def test_synchronized_mountain_source_drift_cannot_redefine_v1_lock(monkeypatch):
    spec = next(
        value
        for value in builder.CHAPTER_SPECS
        if value.chapter_id == "mountain_crossing"
    )
    editorial = _load(spec.editorial_path)
    tampered = deepcopy(editorial)
    tampered["entries"][0]["transcript"] += " Synchronized source change."
    original_load = builder._load_json

    def fake_load(path: Path):
        if path == spec.editorial_path:
            return tampered
        return original_load(path)

    monkeypatch.setattr(builder, "_load_json", fake_load)
    james_profile = builder._accepted_james_profile(
        original_load(builder.JAMES_LOCK_PATH),
        original_load(builder.PROFILE_EVIDENCE_PATH),
        original_load(builder.ACCOUNT_CLAIMS_PATH),
    )
    with pytest.raises(ValueError, match="render-lock aggregate drifted"):
        builder._chapter_lock(
            spec,
            dossier=original_load(builder.DOSSIER_PATH),
            route_spec=original_load(builder.ROUTE_VARIANTS_PATH),
            foothills_approval=original_load(builder.FOOTHILLS_APPROVAL_PATH),
            james_profile=james_profile,
        )
