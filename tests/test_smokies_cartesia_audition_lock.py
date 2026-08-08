from __future__ import annotations

from copy import deepcopy
from difflib import SequenceMatcher
from hashlib import sha256
import json
import math
from pathlib import Path
import subprocess
import sys

import pytest

from scripts.build_smokies_cartesia_audition_lock import (
    AUDITION_SPECS,
    DESTINATION,
    DOSSIER_PATH,
    EDITORIAL_PATHS,
    GENERATION_PROFILE,
    PACKET_SCRIPT_STATUS,
    PROHIBITED_TRANSCRIPT_TERMS,
    RENDERER_CREDIT_CAP,
    REPOSITORY,
    REVIEWED_TECHNICAL_NON_CULTURAL_TERMS,
    build,
    normalize_transcript,
    serialize,
)


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _entry(chapter_id: str, entry_id: str, *, paths=EDITORIAL_PATHS) -> dict:
    return next(
        entry
        for entry in _load(paths[chapter_id])["entries"]
        if entry["id"] == entry_id
    )


def _write_inputs(tmp_path: Path) -> tuple[dict[str, Path], Path]:
    paths: dict[str, Path] = {}
    for chapter_id, source in EDITORIAL_PATHS.items():
        destination = tmp_path / source.name
        destination.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        paths[chapter_id] = destination
    dossier = tmp_path / DOSSIER_PATH.name
    dossier.write_text(DOSSIER_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    return paths, dossier


def test_checked_lock_is_current_and_deterministic():
    expected = build()
    checked = _load(DESTINATION)
    assert checked == expected
    assert serialize(build()) == serialize(build())
    result = subprocess.run(
        [sys.executable, "scripts/build_smokies_cartesia_audition_lock.py", "--check"],
        cwd=REPOSITORY,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "verified originals/smokies/cartesia_audition_lock_v1.json" in result.stdout


def test_lock_binds_exact_auditions_roles_order_and_draft_status():
    lock = build()
    assert lock["schema_version"] == 1
    assert lock["lock_status"] == "internal_audition_only"
    assert lock["packet_script_status"] == PACKET_SCRIPT_STATUS
    assert lock["authorization"] == {
        "scope": "three_internal_auditions_only",
        "full_pack_render_approved": False,
        "public_release_approved": False,
    }
    assert [
        (row["order"], row["role"], row["entry_id"])
        for row in lock["auditions"]
    ] == [
        (1, "scenic_natural_history", "rf_story_02"),
        (2, "human_history", "rf_story_03"),
        (3, "technical_pronunciation", "mc_story_02"),
    ]
    assert tuple(
        (spec["order"], spec["role"], spec["entry_id"])
        for spec in AUDITION_SPECS
    ) == tuple(
        (row["order"], row["role"], row["entry_id"])
        for row in lock["auditions"]
    )
    assert all(row["script_status"] == PACKET_SCRIPT_STATUS for row in lock["auditions"])


def test_generation_profile_and_model_default_pronunciation_are_exact():
    lock = build()
    assert lock["generation_profile"] == GENERATION_PROFILE
    assert GENERATION_PROFILE == {
        "provider": "cartesia",
        "voice_name": "Katie",
        "voice_id": "f786b574-daa5-4673-aa0c-cbe3e8534c02",
        "model_snapshot": "sonic-3.5-2026-05-04",
        "api_version": "2026-03-01",
        "language": "en",
        "output": {
            "container": "wav",
            "sample_rate_hz": 44_100,
            "channels": 1,
            "encoding": "pcm_s16le",
        },
        "generation_config": {"volume": 1.0, "speed": 0.98},
    }
    policy = lock["pronunciation_policy"]
    assert policy["mode"] == "model_default_reviewed_terms"
    assert policy["custom_phonetic_overrides"] == []
    assert policy["reviewed_technical_non_cultural_terms"] == list(
        REVIEWED_TECHNICAL_NON_CULTURAL_TERMS
    )
    combined = " ".join(
        normalize_transcript(_entry(spec["chapter_id"], spec["entry_id"])["transcript"])
        for spec in AUDITION_SPECS
    ).casefold()
    assert all(term.casefold() in combined for term in REVIEWED_TECHNICAL_NON_CULTURAL_TERMS)


def test_transcript_hashes_counts_source_files_and_budget_are_exact():
    lock = build()
    total = 0
    payload_total = 0
    reserved_total = 0
    for spec, row in zip(AUDITION_SPECS, lock["auditions"], strict=True):
        entry = _entry(spec["chapter_id"], spec["entry_id"])
        transcript = entry["transcript"]
        normalized = normalize_transcript(transcript)
        assert row["transcript_sha256"] == sha256(transcript.encode("utf-8")).hexdigest()
        assert row["payload_character_count"] == len(transcript)
        assert row["normalized_character_count"] == len(normalized)
        assert row["reserved_credit_ceiling"] == math.ceil(
            max(len(transcript), len(normalized)) * 110 / 100
        )
        assert row["word_count"] == len(normalized.split(" "))
        assert row["claim_ids"] == spec["claim_ids"]
        assert row["source_ids"] == spec["source_ids"]
        total += len(normalized)
        payload_total += len(transcript)
        reserved_total += row["reserved_credit_ceiling"]
    assert lock["aggregate"]["payload_character_count"] == payload_total
    assert lock["aggregate"]["normalized_character_count"] == total
    assert lock["aggregate"]["projected_credits_before_contingency"] == total
    assert lock["aggregate"]["projected_credits_with_contingency"] == math.ceil(total * 1.1)
    assert lock["aggregate"]["projected_credits_with_contingency"] <= RENDERER_CREDIT_CAP
    assert lock["aggregate"]["reserved_credit_ceiling"] == reserved_total
    assert lock["aggregate"]["reserved_credit_ceiling"] <= RENDERER_CREDIT_CAP
    for source in lock["source_files"]:
        path = REPOSITORY / source["path"]
        assert source["sha256"] == sha256(path.read_bytes()).hexdigest()


def test_technical_story_is_near_five_minutes_and_source_bound():
    entry = _entry("mountain_crossing", "mc_story_02")
    words = len(normalize_transcript(entry["transcript"]).split(" "))
    assert 680 <= words <= 700
    assert entry["claim_ids"] == ["mc_deep_geology"]
    assert entry["source_ids"] == ["nps_grsm_geology"]
    assert entry["script_status"] == "draft_review_required"
    transcript = entry["transcript"]
    for required in (
        "clay, silt, sand, gravel",
        "calcium carbonate",
        "sandstone",
        "metasandstone",
        "quartzite",
        "Shale became slate",
        "Plate motion was slow",
        "Great Smoky Fault",
        "roughly twenty named rock formations",
        "about two inches every thousand years",
        "Return your attention to the roadcut",
    ):
        assert required in transcript

    foothills_packet = _load(
        REPOSITORY / "originals/smokies/editorial_scripts_v1.json"
    )
    foothills_geology = next(
        row["transcript"]
        for row in foothills_packet["entries"]
        if row["id"] == "fp_story_04"
    )
    assert transcript != foothills_geology
    assert SequenceMatcher(None, transcript, foothills_geology).ratio() < 0.65


def test_selected_transcripts_have_no_gated_terms_or_process_provider_copy():
    combined = " ".join(
        _entry(spec["chapter_id"], spec["entry_id"])["transcript"]
        for spec in AUDITION_SPECS
    ).casefold()
    assert all(term not in combined for term in PROHIBITED_TRANSCRIPT_TERMS)
    for forbidden in (
        "sacred",
        "tribal tradition",
        "cultural interpretation",
        "phonetic override",
        "download another app",
        "generation process",
    ):
        assert forbidden not in combined


def test_builder_fails_closed_on_source_or_cultural_drift(tmp_path: Path):
    paths, dossier_path = _write_inputs(tmp_path)
    dossier = _load(dossier_path)

    source_drift = deepcopy(dossier)
    next(claim for claim in source_drift["claims"] if claim["id"] == "rf_stream")[
        "status"
    ] = "unverified"
    dossier_path.write_text(
        json.dumps(source_drift, ensure_ascii=False), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="not source_verified"):
        build(editorial_paths=paths, dossier_path=dossier_path)

    cultural_drift = deepcopy(dossier)
    next(claim for claim in cultural_drift["claims"] if claim["id"] == "mc_deep_geology")[
        "cultural_gate"
    ] = "required"
    dossier_path.write_text(
        json.dumps(cultural_drift, ensure_ascii=False), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="requires cultural review"):
        build(editorial_paths=paths, dossier_path=dossier_path)

    authority_drift = deepcopy(dossier)
    next(
        source
        for source in authority_drift["sources"]
        if source["id"] == "nps_grsm_geology"
    )["authority"] = "community"
    dossier_path.write_text(
        json.dumps(authority_drift, ensure_ascii=False), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="not an official source"):
        build(editorial_paths=paths, dossier_path=dossier_path)


def test_editorial_drift_changes_lock_and_unknown_selection_fails(tmp_path: Path):
    paths, dossier_path = _write_inputs(tmp_path)
    packet = _load(paths["roaring_fork"])
    next(entry for entry in packet["entries"] if entry["id"] == "rf_story_02")[
        "transcript"
    ] += " Water continues beside the road."
    paths["roaring_fork"].write_text(
        json.dumps(packet, ensure_ascii=False), encoding="utf-8"
    )
    drifted = build(editorial_paths=paths, dossier_path=dossier_path)
    checked = _load(DESTINATION)
    assert drifted["auditions"][0]["transcript_sha256"] != checked["auditions"][0][
        "transcript_sha256"
    ]
    assert serialize(drifted) != DESTINATION.read_text(encoding="utf-8")

    packet["entries"] = [
        entry for entry in packet["entries"] if entry["id"] != "rf_story_02"
    ]
    paths["roaring_fork"].write_text(
        json.dumps(packet, ensure_ascii=False), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="missing exact audition entry rf_story_02"):
        build(editorial_paths=paths, dossier_path=dossier_path)
