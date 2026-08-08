from copy import deepcopy
from pathlib import Path
import json

from db.originals_editorial import (
    SMOKIES_DOSSIER_PATH,
    SMOKIES_EDITORIAL_PATH,
    editorial_transcript_sha256,
    editorial_word_count,
    load_smokies_editorial_packet,
    validate_smokies_editorial_packet,
)


def _raw():
    return (
        json.loads(SMOKIES_EDITORIAL_PATH.read_text(encoding="utf-8")),
        json.loads(SMOKIES_DOSSIER_PATH.read_text(encoding="utf-8")),
    )


def test_foothills_editorial_packet_is_complete_and_long_form():
    packet = load_smokies_editorial_packet()
    assert packet["summary"]["story_count"] == 6
    assert packet["summary"]["cue_count"] == 7
    assert packet["summary"]["estimated_duration_s"] >= 20 * 60
    assert {entry["id"] for entry in packet["entries"]} == {
        *(f"fp_story_{index:02d}" for index in range(1, 7)),
        *(f"fp_cue_{index:02d}" for index in range(1, 8)),
    }
    for entry in packet["entries"]:
        assert entry["script_status"] == "draft_review_required"
        assert entry["transcript_sha256"] == editorial_transcript_sha256(entry["transcript"])
        assert entry["word_count"] == editorial_word_count(entry["transcript"])
        assert entry["sources"]
        if entry["kind"] == "story":
            assert 450 <= entry["word_count"] <= 725
            assert entry["estimated_duration_s"] >= 180
        else:
            assert 50 <= entry["word_count"] <= 120
            assert entry["estimated_duration_s"] < 60


def test_editorial_packet_rejects_cultural_and_source_drift():
    packet, dossier = _raw()
    dossier_digest = packet["dossier_sha256"]
    cultural = deepcopy(packet)
    cultural["entries"][0]["id"] = "mc_story_15"
    cultural["entries"][0]["chapter_id"] = "mountain_crossing"
    cultural["entries"][0]["sequence"] = 15
    cultural["entries"][0]["title"] = "Cultural interpretation reserved"
    cultural["entries"][0]["claim_ids"] = ["mc_kuwohi_living_meaning"]
    cultural["entries"][0]["source_ids"] = ["ebci_cultural_irb", "ebci_cultural_resources"]
    issues = validate_smokies_editorial_packet(
        cultural,
        dossier,
        dossier_file_sha256=dossier_digest,
    )
    assert any("blocked for cultural review" in issue for issue in issues)

    drifted = deepcopy(packet)
    drifted["entries"][0]["source_ids"] = []
    issues = validate_smokies_editorial_packet(
        drifted,
        dossier,
        dossier_file_sha256=dossier_digest,
    )
    assert any("source_ids do not match" in issue for issue in issues)


def test_editorial_packet_rejects_provider_and_filler_copy():
    packet, dossier = _raw()
    packet["entries"][0]["transcript"] += " Download another app with Cartesia."
    issues = validate_smokies_editorial_packet(
        packet,
        dossier,
        dossier_file_sha256=packet["dossier_sha256"],
    )
    assert any("prohibited public wording" in issue for issue in issues)


def test_editorial_paths_stay_inside_repository():
    root = Path(__file__).resolve().parents[1]
    assert SMOKIES_EDITORIAL_PATH.is_relative_to(root)
    assert SMOKIES_DOSSIER_PATH.is_relative_to(root)
