from __future__ import annotations

import copy
import json
import math
import subprocess
import sys
from pathlib import Path

import pytest

import scripts.build_smokies_roaring_fork_real_audio_characterization as builder


def _tracked() -> dict:
    return json.loads(builder.DESTINATION.read_text(encoding="utf-8"))


def test_internal_characterization_rebuilds_from_ignored_real_audio() -> None:
    if not builder._local_evidence_available():
        pytest.skip("local ignored Roaring Fork audio evidence is not present")
    assert builder.DESTINATION.read_text(encoding="utf-8") == builder.serialize(
        builder.build()
    )


def test_strong_check_is_network_free_and_requires_local_evidence() -> None:
    if not builder._local_evidence_available():
        pytest.skip("local ignored Roaring Fork audio evidence is not present")
    result = subprocess.run(
        [
            sys.executable,
            str(builder.REPOSITORY / "scripts/build_smokies_roaring_fork_real_audio_characterization.py"),
            "--check",
            "--require-local-evidence",
        ],
        cwd=builder.REPOSITORY,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


def test_ci_safe_check_recomputes_tracked_sources_without_ignored_audio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(builder, "_local_evidence_available", lambda: False)
    assert builder.main(["--check"]) == 0


def test_publication_boundary_and_exact_delivery_classification() -> None:
    value = _tracked()
    assert value["status"] == "internal_characterization_only"
    assert value["release_gate"] == {
        "characterization_must_not_be_used_as_publication_validation": True,
        "missing_publication_evidence": [
            "artwork_evidence",
            "full_original_manifest_v3_publication_evidence",
        ],
        "public_release": False,
        "publication_status": "blocked_missing_publication_evidence",
        "trusted_publication_validation": False,
        "validated_delivery_contracts": [],
    }
    inventory = value["delivery_inventory"]
    assert inventory["entry_count"] == 13
    assert inventory["counts_by_mode"] == {
        "hard_auto": 5,
        "capacity_deeper": 4,
        "stopped_deeper": 3,
        "completion_deeper": 1,
    }
    assert inventory["ogle_prelude"] == {
        "experience_group_id": "ogle_prelude",
        "entry_ids_in_delivery_order": ["rf_cue_02", "rf_story_03"],
        "requires_user_confirmed_parked": True,
    }
    assert all("public" not in key for key in value if key.startswith("validated_"))


def test_all_real_audio_and_transcript_bindings_are_complete() -> None:
    value = _tracked()
    renderer = value["renderer_evidence"]
    assets = renderer["assets"]
    assert renderer["tracking_policy"] == "ignored_local_output"
    assert renderer["asset_count"] == 13
    assert renderer["total_audio_bytes"] == 26_184_875
    assert renderer["total_probed_duration_s"] == 1_636.519183
    assert renderer["total_probed_duration_ms"] == 1_636_520
    assert renderer["render_ledger"] == {
        "byte_count": 17_921,
        "item_count": 13,
        "lock_sha256": (
            "4f8b2d9df467de6af3d5622dac10caae7c165d924e36449de30d507812ba7e3b"
        ),
        "path": (
            "output/smokies-original/elevenlabs-james-roaring-fork-v1/"
            "render-ledger.json"
        ),
        "schema_version": 1,
        "sha256": (
            "15537c5af0d351d4eb4102139bd6b1a0452075963e305242d1394a59e3db5804"
        ),
    }
    assert [row["stable_order"] for row in assets] == list(range(1, 14))
    assert [row["entry_id"] for row in assets] == [
        "rf_cue_02",
        "rf_story_03",
        "rf_cue_01",
        "rf_story_01",
        "rf_cue_04",
        "rf_cue_03",
        "rf_story_02",
        "rf_story_04",
        "rf_story_05",
        "rf_cue_05",
        "rf_story_06",
        "rf_story_07",
        "rf_cue_06",
    ]
    assert len({row["audio_sha256"] for row in assets}) == 13
    assert [row["probed_duration_ms"] for row in assets] == [
        26_776,
        199_053,
        26_201,
        207_647,
        22_857,
        23_667,
        215_118,
        203_468,
        220_003,
        27_272,
        219_716,
        219_455,
        25_287,
    ]
    for row in assets:
        assert len(row["audio_sha256"]) == 64
        assert len(row["raw_transcript_sha256"]) == 64
        assert len(row["normalized_transcript_sha256"]) == 64
        assert row["audio_bytes"] > 0
        assert row["probed_duration_s"] > 0
        assert row["probed_duration_ms"] > 0
        assert row["probed_duration_ms"] == int(math.floor(
            row["probed_duration_s"] * 1_000 + 0.5
        ))
        assert row["sample_rate_hz"] == 44_100
        assert row["bitrate_kbps"] == 128
        assert row["channels"] == 1
        assert row["provider_generated"] is True
        assert row["provider_native_lossy_source"] is True


def test_existing_typescript_function_produces_exact_tracked_timing_bytes() -> None:
    value = _tracked()
    timing = value["timing_characterization"]
    sources = builder._checked_sources()
    compiled = builder._compiled_typescript_timing_input(
        sources, value["renderer_evidence"]["assets"]
    )
    actual = builder._run_typescript_metrics_bridge(compiled)
    expected = timing["result"]
    canonical_actual = json.dumps(
        actual, separators=(",", ":"), sort_keys=True, ensure_ascii=False,
    ).encode("utf-8")
    canonical_expected = json.dumps(
        expected, separators=(",", ":"), sort_keys=True, ensure_ascii=False,
    ).encode("utf-8")
    assert canonical_actual == canonical_expected
    assert timing["execution"] == (
        "existing_typescript_computeOriginalLongFormDeliveryMetrics"
    )
    assert timing["compiled_input_sha256"] == (
        "08719837a4a5aaf721b1e3735eaec9599b69394218b74ddb1bf56c090d7d9a1c"
    )
    assert timing["result_sha256"] == (
        "6038b587c8a57fe0cf0aa2780db04e6589b98b4516f4225841bb05a6f0ed0bf0"
    )
    assert expected["schema_version"] == 1
    assert expected["duration_basis"] == "server_probed_immutable_audio"
    assert expected["speed_fixtures"] == [
        {
            "speed_mph": 15,
            "route_travel_s": 1_276.753758,
            "route_end_backlog_audio_s": 0.0,
            "maximum_trigger_to_play_latency_s": 3.1,
            "admitted_capacity_ids": ["rf_story_02", "rf_story_05"],
            "rejected_capacity_ids": ["rf_story_01", "rf_story_04"],
            "within_limits": True,
        },
        {
            "speed_mph": 36,
            "route_travel_s": 531.980733,
            "route_end_backlog_audio_s": 8.086852,
            "maximum_trigger_to_play_latency_s": 0.0,
            "admitted_capacity_ids": [],
            "rejected_capacity_ids": [
                "rf_story_01", "rf_story_02", "rf_story_04", "rf_story_05",
            ],
            "within_limits": True,
        },
        {
            "speed_mph": 65,
            "route_travel_s": 294.635483,
            "route_end_backlog_audio_s": 18.543283,
            "maximum_trigger_to_play_latency_s": 2.782518,
            "admitted_capacity_ids": [],
            "rejected_capacity_ids": [
                "rf_story_01", "rf_story_02", "rf_story_04", "rf_story_05",
            ],
            "within_limits": True,
        },
        {
            "speed_mph": 75,
            "route_travel_s": 255.350752,
            "route_end_backlog_audio_s": 23.078712,
            "maximum_trigger_to_play_latency_s": 6.047783,
            "admitted_capacity_ids": [],
            "rejected_capacity_ids": [
                "rf_story_01", "rf_story_02", "rf_story_04", "rf_story_05",
            ],
            "within_limits": True,
        },
    ]
    assert expected["valid"] is True


def test_final_source_hashes_and_route_geometry_are_bound() -> None:
    value = _tracked()
    bindings = value["source_bindings"]
    assert bindings["production_narration_lock"]["sha256"] == (
        "4f8b2d9df467de6af3d5622dac10caae7c165d924e36449de30d507812ba7e3b"
    )
    assert bindings["s3g_trigger_preflight"]["sha256"] == (
        "b7b8412e07cdef5706d814550491f8c28bfadb05d3fbef38369ec7006c3b67f3"
    )
    assert bindings["delivery_readiness"]["sha256"] == (
        "4a0fc760fd07790785b820af06bac4e5a10e8337ad3f6257a10a3c50464c9b67"
    )
    assert bindings["editorial_packet"]["sha256"] == (
        "c3d1622d7f5109fb4632cb74af340f97a3477cd061c326f5e55055e6b074d0e2"
    )
    assert bindings["source_dossier"]["sha256"] == (
        "8eb22ca5110f0f9a4287b8f184624348c2a2ca2dbc36e27ef59fc022057ce18f"
    )
    assert bindings["official_route_evidence"]["sha256"] == (
        "d946ffaf8f21ad97399b6dedfb5cbe9483fce0787653b389d7075d933f398c60"
    )
    assert bindings["typescript_timing_bridge"]["sha256"] == (
        "a6fd2bcd4f1551f82b94010f757cb56d69a56c867f4b5ae49d7add78e0f9a5a0"
    )
    assert value["route_binding"] == {
        "route_id": "roaring-fork-one-way",
        "chapter_id": "roaring_fork",
        "variant_id": "one_way",
        "status": "official_geometry_candidate",
        "distance_m": 8_561.4,
        "coordinate_count": 1_175,
        "geometry_sha256": (
            "d66f76d6053000244d7e15c8be0494f48d79544e0ceaf79428c51e458e964668"
        ),
    }


def test_tracked_tampering_fails_closed_without_private_audio() -> None:
    value = _tracked()
    mutated = copy.deepcopy(value)
    mutated["renderer_evidence"]["assets"][0]["audio_sha256"] = "0" * 64
    with pytest.raises(builder.CharacterizationError, match="stale"):
        builder.validate_tracked_without_local_audio(mutated)

    mutated = copy.deepcopy(value)
    mutated["release_gate"]["public_release"] = True
    with pytest.raises(builder.CharacterizationError, match="release boundary"):
        builder.validate_tracked_without_local_audio(mutated)


def test_renderer_output_remains_gitignored() -> None:
    assert "output/" in {
        line.strip() for line in (builder.REPOSITORY / ".gitignore").read_text(
            encoding="utf-8"
        ).splitlines()
    }
    result = subprocess.run(
        ["git", "check-ignore", "-q", str(builder.LEDGER_PATH.relative_to(builder.REPOSITORY))],
        cwd=builder.REPOSITORY,
        check=False,
    )
    assert result.returncode == 0
