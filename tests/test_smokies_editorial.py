from copy import deepcopy
from pathlib import Path
import json

from db.originals_editorial import (
    SMOKIES_DOSSIER_PATH,
    SMOKIES_EDITORIAL_PATH,
    SMOKIES_CADES_COVE_EDITORIAL_PATH,
    SMOKIES_MOUNTAIN_CROSSING_EDITORIAL_PATH,
    SMOKIES_ROARING_FORK_EDITORIAL_PATH,
    SMOKIES_ROUTE_VARIANTS_PATH,
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


def test_smokies_editorial_packets_are_complete_and_long_form():
    packet = load_smokies_editorial_packet()
    assert packet["summary"]["chapter_count"] == 4
    assert packet["summary"]["story_count"] == 43
    assert packet["summary"]["cue_count"] == 31
    assert packet["summary"]["variant_override_count"] == 8
    assert packet["summary"]["direction_reviewed_chapter_count"] == 2
    assert packet["summary"]["estimated_duration_s"] >= 145 * 60
    expected_foothills_ids = {
        *(f"fp_story_{index:02d}" for index in range(1, 7)),
        *(f"fp_cue_{index:02d}" for index in range(1, 8)),
    }
    expected_mountain_crossing_ids = {
        *(f"mc_story_{index:02d}" for index in (*range(1, 15), *range(16, 19))),
        *(f"mc_cue_{index:02d}" for index in (*range(1, 7), *range(8, 11))),
    }
    expected_cades_cove_ids = {
        *(f"cc_story_{index:02d}" for index in (1, 2, 3, *range(5, 15))),
        *(f"cc_cue_{index:02d}" for index in range(1, 10)),
    }
    expected_roaring_fork_ids = {
        *(f"rf_story_{index:02d}" for index in range(1, 8)),
        *(f"rf_cue_{index:02d}" for index in range(1, 7)),
    }
    assert {entry["id"] for entry in packet["entries"]} == {
        *expected_foothills_ids,
        *expected_mountain_crossing_ids,
        *expected_cades_cove_ids,
        *expected_roaring_fork_ids,
    }
    assert {chapter["chapter_id"] for chapter in packet["chapters"]} == {
        "foothills_parkway",
        "mountain_crossing",
        "little_river_cades_cove",
        "roaring_fork",
    }
    assert all(len(chapter["artifact_sha256"]) == 64 for chapter in packet["chapters"])
    for entry in packet["entries"]:
        assert entry["script_status"] == "draft_review_required"
        assert entry["transcript_sha256"] == editorial_transcript_sha256(entry["transcript"])
        assert entry["word_count"] == editorial_word_count(entry["transcript"])
        assert entry["sources"]
        assert set(entry["effective_transcript_sha256_by_variant"])
        for override in entry.get("variant_overrides", []):
            assert override["transcript_sha256"] == editorial_transcript_sha256(
                override["transcript"]
            )
            assert (
                entry["effective_transcript_sha256_by_variant"][override["variant_id"]]
                == override["transcript_sha256"]
            )
        if entry["kind"] == "story":
            assert 450 <= entry["word_count"] <= 725
            assert entry["estimated_duration_s"] >= 180
        else:
            assert 50 <= entry["word_count"] <= 120
            assert entry["estimated_duration_s"] < 60


def test_mountain_crossing_packet_keeps_cultural_entries_blocked():
    packet = json.loads(
        SMOKIES_MOUNTAIN_CROSSING_EDITORIAL_PATH.read_text(encoding="utf-8")
    )
    dossier = json.loads(SMOKIES_DOSSIER_PATH.read_text(encoding="utf-8"))
    assert packet["chapter_id"] == "mountain_crossing"
    assert "mc_story_15" not in {entry["id"] for entry in packet["entries"]}
    assert "mc_cue_07" not in {entry["id"] for entry in packet["entries"]}
    assert validate_smokies_editorial_packet(
        packet,
        dossier,
        dossier_file_sha256=packet["dossier_sha256"],
    ) == []


def test_bidirectional_chapters_have_complete_review_and_exact_reverse_overrides():
    packet = load_smokies_editorial_packet()
    entries = {entry["id"]: entry for entry in packet["entries"]}
    expected = {
        ("fp_cue_01", "foothills_parkway", "east_to_west"),
        ("fp_cue_05", "foothills_parkway", "east_to_west"),
        ("fp_cue_07", "foothills_parkway", "east_to_west"),
        ("mc_cue_01", "mountain_crossing", "nc_to_tn"),
        ("mc_cue_02", "mountain_crossing", "nc_to_tn"),
        ("mc_cue_04", "mountain_crossing", "nc_to_tn"),
        ("mc_cue_08", "mountain_crossing", "nc_to_tn"),
        ("mc_cue_09", "mountain_crossing", "nc_to_tn"),
    }
    actual = {
        (entry["id"], override["chapter_id"], override["variant_id"])
        for entry in packet["entries"]
        for override in entry.get("variant_overrides", [])
    }
    assert actual == expected
    assert all(entries[entry_id]["kind"] == "cue" for entry_id, _, _ in actual)
    chapters = {chapter["chapter_id"]: chapter for chapter in packet["chapters"]}
    assert chapters["foothills_parkway"]["direction_review"]["reviewed_variant_ids"] == [
        "west_to_east",
        "east_to_west",
    ]
    assert chapters["mountain_crossing"]["direction_review"]["reviewed_variant_ids"] == [
        "tn_to_nc",
        "nc_to_tn",
    ]
    assert chapters["foothills_parkway"]["variant_override_count"] == 3
    assert chapters["mountain_crossing"]["variant_override_count"] == 5


def test_bidirectional_long_stories_use_one_direction_neutral_transcript():
    packet = load_smokies_editorial_packet()
    entries = {entry["id"]: entry for entry in packet["entries"]}
    neutralized_ids = {
        "fp_story_01",
        "fp_story_03",
        "mc_story_01",
        "mc_story_03",
        "mc_story_04",
        "mc_story_05",
        "mc_story_16",
    }
    assert all(not entries[entry_id].get("variant_overrides") for entry_id in neutralized_ids)
    assert entries["mc_story_01"]["effective_title_by_variant"] == {
        "tn_to_nc": "Sugarlands and the watershed",
        "nc_to_tn": "Sugarlands and the watershed",
    }
    assert entries["mc_story_16"]["effective_title_by_variant"] == {
        "tn_to_nc": "The Oconaluftee valley",
        "nc_to_tn": "The Oconaluftee valley",
    }
    assert entries["fp_cue_02"]["effective_title_by_variant"] == {
        "west_to_east": "A long view",
        "east_to_west": "A long view",
    }
    combined = " ".join(entries[entry_id]["transcript"] for entry_id in neutralized_ids)
    for stale_wording in (
        "As the next opening appears",
        "Watch the road ahead as it leaves solid ground",
        "For now, the crossing begins here",
        "Water appears everywhere on this climb",
        "The road keeps climbing",
        "The high ridge ahead supports a different combination from the cove behind",
        "not simply the end of a scenic drive",
    ):
        assert stale_wording not in combined


def test_variant_overrides_reject_unknown_duplicate_unused_and_incomplete_review():
    packet, dossier = _raw()
    route_variants = json.loads(SMOKIES_ROUTE_VARIANTS_PATH.read_text(encoding="utf-8"))
    cue = next(entry for entry in packet["entries"] if entry["id"] == "fp_cue_01")

    unknown = deepcopy(packet)
    next(entry for entry in unknown["entries"] if entry["id"] == "fp_cue_01")[
        "variant_overrides"
    ][0]["variant_id"] = "sideways"
    issues = validate_smokies_editorial_packet(
        unknown,
        dossier,
        dossier_file_sha256=packet["dossier_sha256"],
        route_variants=route_variants,
    )
    assert any("variant_id is unknown" in issue for issue in issues)

    duplicate = deepcopy(packet)
    duplicate_cue = next(
        entry for entry in duplicate["entries"] if entry["id"] == "fp_cue_01"
    )
    duplicate_cue["variant_overrides"].append(
        deepcopy(duplicate_cue["variant_overrides"][0])
    )
    issues = validate_smokies_editorial_packet(
        duplicate,
        dossier,
        dossier_file_sha256=packet["dossier_sha256"],
        route_variants=route_variants,
    )
    assert any("duplicate variant overrides" in issue for issue in issues)

    unused = deepcopy(packet)
    unused_override = next(
        entry for entry in unused["entries"] if entry["id"] == "fp_cue_01"
    )["variant_overrides"][0]
    unused_override["variant_id"] = "west_to_east"
    issues = validate_smokies_editorial_packet(
        unused,
        dossier,
        dossier_file_sha256=packet["dossier_sha256"],
        route_variants=route_variants,
    )
    assert any("targets the base route variant" in issue for issue in issues)

    incomplete = deepcopy(packet)
    incomplete["direction_review"]["reviewed_entry_ids"].remove(cue["id"])
    issues = validate_smokies_editorial_packet(
        incomplete,
        dossier,
        dossier_file_sha256=packet["dossier_sha256"],
        route_variants=route_variants,
    )
    assert any("cover every authored direction-sensitive entry" in issue for issue in issues)


def test_cades_cove_packet_keeps_cultural_entry_blocked():
    packet = json.loads(SMOKIES_CADES_COVE_EDITORIAL_PATH.read_text(encoding="utf-8"))
    dossier = json.loads(SMOKIES_DOSSIER_PATH.read_text(encoding="utf-8"))
    assert packet["chapter_id"] == "little_river_cades_cove"
    assert "cc_story_04" not in {entry["id"] for entry in packet["entries"]}
    assert validate_smokies_editorial_packet(
        packet,
        dossier,
        dossier_file_sha256=packet["dossier_sha256"],
    ) == []


def test_roaring_fork_packet_contains_all_source_cleared_entries():
    packet = json.loads(SMOKIES_ROARING_FORK_EDITORIAL_PATH.read_text(encoding="utf-8"))
    dossier = json.loads(SMOKIES_DOSSIER_PATH.read_text(encoding="utf-8"))
    entry_ids = {entry["id"] for entry in packet["entries"]}
    assert packet["chapter_id"] == "roaring_fork"
    assert "rf_story_03" in entry_ids
    assert {"mc_story_15", "mc_cue_07", "cc_story_04"}.isdisjoint(entry_ids)
    assert [
        (entry["kind"], entry["sequence"], entry["id"])
        for entry in packet["entries"]
    ] == [
        ("story", 1, "rf_story_01"),
        ("story", 2, "rf_story_03"),
        ("story", 3, "rf_story_02"),
        ("story", 4, "rf_story_04"),
        ("story", 5, "rf_story_05"),
        ("story", 6, "rf_story_06"),
        ("story", 7, "rf_story_07"),
        ("cue", 1, "rf_cue_01"),
        ("cue", 2, "rf_cue_02"),
        ("cue", 3, "rf_cue_04"),
        ("cue", 4, "rf_cue_03"),
        ("cue", 5, "rf_cue_05"),
        ("cue", 6, "rf_cue_06"),
    ]
    assert validate_smokies_editorial_packet(
        packet,
        dossier,
        dossier_file_sha256=packet["dossier_sha256"],
    ) == []


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
    assert SMOKIES_ROUTE_VARIANTS_PATH.is_relative_to(root)
