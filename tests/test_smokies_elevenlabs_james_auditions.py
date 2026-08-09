from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

import pytest

from scripts.build_smokies_cartesia_audition_lock import build as build_cartesia
from scripts.build_smokies_elevenlabs_james_audition_lock import (
    CHARACTER_CAP,
    DESTINATION,
    DOLLAR_CAP_USD,
    MODEL_ID,
    OUTPUT_FORMAT_ID,
    REPOSITORY,
    VOICE_ID,
    VOICE_SETTINGS,
    build,
    serialize,
)
from scripts.render_smokies_elevenlabs_james_auditions import (
    API_KEY_ENV,
    AuditionError,
    Mp3Probe,
    ProviderResponse,
    load_account_evidence,
    probe_mp3_bytes,
    projected_cost_usd,
    run_renderer,
)

NOW = datetime(2026, 8, 8, 18, 0, tzinfo=timezone.utc)


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _account_evidence(tmp_path: Path, **updates) -> Path:
    value = {
        "schema_version": 1,
        "provider": "elevenlabs",
        "source": "authenticated_browser",
        "observed_at": "2026-08-08T17:30:00Z",
        "plan": "creator",
        "commercial_use": True,
        "available_credits": 131_000,
        "output_format_id": OUTPUT_FORMAT_ID,
        "source_evidence_sha256": "a" * 64,
    }
    value.update(updates)
    path = tmp_path / "account-evidence.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def _metadata(**updates) -> dict:
    value = {
        "voice_id": VOICE_ID,
        "high_quality_base_model_ids": [MODEL_ID],
        "sharing": {
            "original_voice_id": VOICE_ID,
            "status": "enabled",
            "rate": 0.05,
            "notice_period": 30,
            "disable_at_unix": 0,
        },
    }
    value.update(updates)
    return value


def _json_response(value: dict, status: int = 200) -> ProviderResponse:
    return ProviderResponse(
        status_code=status,
        headers={"content-type": "application/json"},
        body=json.dumps(value).encode("utf-8"),
    )


class FakeTransport:
    def __init__(
        self,
        post_responses: list[ProviderResponse | BaseException] | None = None,
        *,
        metadata: dict | None = None,
        settings: dict | None = None,
        subscription: ProviderResponse | None = None,
    ):
        self.post_responses = list(post_responses or [])
        self.metadata = _metadata() if metadata is None else metadata
        self.settings = dict(VOICE_SETTINGS) if settings is None else settings
        self.subscription = subscription or ProviderResponse(403, {}, b"")
        self.get_calls: list[tuple[str, MappingSnapshot]] = []
        self.post_calls: list[dict] = []

    def get(self, url, *, headers, timeout):
        self.get_calls.append((url, MappingSnapshot(headers)))
        if url.endswith("/settings"):
            return _json_response(self.settings)
        if url.endswith("/user/subscription"):
            return self.subscription
        return _json_response(self.metadata)

    def post(self, url, *, headers, body, timeout):
        self.post_calls.append({
            "url": url,
            "headers": MappingSnapshot(headers),
            "body": json.loads(body),
            "timeout": timeout,
        })
        if not self.post_responses:
            raise AssertionError("unexpected provider POST")
        response = self.post_responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


class MappingSnapshot(dict):
    pass


def _audio_response(cost: int | None, marker: bytes = b"audio") -> ProviderResponse:
    headers = {"content-type": "audio/mpeg"}
    if cost is not None:
        headers["character-cost"] = str(cost)
    return ProviderResponse(200, headers, marker)


def _fake_probe(content: bytes) -> Mp3Probe:
    return Mp3Probe(
        byte_count=len(content),
        sha256=sha256(content).hexdigest(),
        sample_rate_hz=44_100,
        bitrate_kbps=128,
        frame_count=6_900,
        duration_s=180.0,
    )


def _run_apply(tmp_path: Path, transport: FakeTransport, **kwargs):
    return run_renderer(
        output_dir=tmp_path / "output",
        apply=True,
        verified_output_format=OUTPUT_FORMAT_ID,
        account_evidence_path=_account_evidence(tmp_path),
        environ={API_KEY_ENV: "test-key-never-persist"},
        transport_factory=lambda: transport,
        probe_audio=_fake_probe,
        now=lambda: NOW,
        retry_jitter=lambda value: value,
        sleep=lambda _value: None,
        **kwargs,
    )


def test_lock_is_current_deterministic_and_direct_cli_works():
    assert _load(DESTINATION) == build()
    assert DESTINATION.read_text(encoding="utf-8") == serialize(build())
    checked = subprocess.run(
        [
            sys.executable,
            "scripts/build_smokies_elevenlabs_james_audition_lock.py",
            "--check",
        ],
        cwd=REPOSITORY,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "verified originals/smokies/elevenlabs_james_audition_lock_v1.json" in checked.stdout
    help_result = subprocess.run(
        [sys.executable, "scripts/render_smokies_elevenlabs_james_auditions.py", "--help"],
        cwd=REPOSITORY,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "--verified-output-format" in help_result.stdout
    assert "--account-evidence" in help_result.stdout


def test_lock_is_exact_same_script_comparison_and_pins_creator_safe_format():
    lock = build()
    cartesia = build_cartesia()
    assert [row["transcript_sha256"] for row in lock["auditions"]] == [
        row["transcript_sha256"] for row in cartesia["auditions"]
    ]
    assert [row["payload_character_count"] for row in lock["auditions"]] == [
        row["payload_character_count"] for row in cartesia["auditions"]
    ]
    profile = lock["generation_profile"]
    assert profile["voice_id"] == "EkK5I93UQWFDigLMpZcX"
    assert profile["model_id"] == "eleven_multilingual_v2"
    assert profile["voice_settings"] == VOICE_SETTINGS == {
        "stability": 0.5,
        "similarity_boost": 0.5,
        "style": 0.1,
        "use_speaker_boost": True,
        "speed": 1.0,
    }
    assert profile["voice_settings_source"] == "provider_preflight_exact_match_required"
    assert profile["output_policy"] == {
        "selection_status": "authenticated_creator_account_verified",
        "format_id": "mp3_44100_128",
        "container": "mp3",
        "sample_rate_hz": 44_100,
        "bitrate_kbps": 128,
        "provider_native_master": True,
        "lossless_master_claimed": False,
        "transcoding_for_comparison_forbidden": True,
    }
    assert lock["aggregate"]["payload_character_count"] == 10_007
    assert lock["aggregate"]["reserved_character_ceiling"] == 11_008
    assert lock["budget"]["character_cap"] == CHARACTER_CAP == 12_000
    assert lock["budget"]["dollar_cap_usd"] == str(DOLLAR_CAP_USD) == "2.00"
    assert lock["budget"]["rerender_budget"] == 0
    assert projected_cost_usd(11_008) < DOLLAR_CAP_USD


def test_dry_run_never_reads_key_constructs_transport_or_writes(tmp_path: Path):
    class NoEnvironment(dict):
        def get(self, *_args, **_kwargs):
            raise AssertionError("dry run read environment")

    result = run_renderer(
        output_dir=tmp_path / "must-not-exist",
        environ=NoEnvironment(),
        transport_factory=lambda: (_ for _ in ()).throw(
            AssertionError("dry run constructed transport")
        ),
    )
    assert result["status"] == "dry_run_ready"
    assert result["network_used"] is False
    assert result["apply_requires_verified_output_format"] == "mp3_44100_128"
    assert not (tmp_path / "must-not-exist").exists()


def test_apply_fails_before_secret_or_network_without_exact_format(tmp_path: Path):
    with pytest.raises(
        AuditionError, match="audition_output_format_confirmation_required"
    ):
        run_renderer(
            output_dir=tmp_path,
            apply=True,
            verified_output_format="mp3_44100_192",
            environ={API_KEY_ENV: "should-not-be-read"},
        )
    assert list(tmp_path.iterdir()) == []


def test_account_evidence_is_redacted_fresh_and_sufficient(tmp_path: Path):
    evidence = load_account_evidence(_account_evidence(tmp_path), NOW)
    assert evidence.available_credits == 131_000
    assert evidence.source_evidence_sha256 == "a" * 64
    with pytest.raises(AuditionError, match="sensitive_field"):
        load_account_evidence(_account_evidence(tmp_path, api_key="nope"), NOW)
    with pytest.raises(AuditionError, match="balance_insufficient"):
        load_account_evidence(_account_evidence(tmp_path, available_credits=11_999), NOW)
    with pytest.raises(AuditionError, match="account_evidence_stale"):
        load_account_evidence(
            _account_evidence(tmp_path, observed_at="2026-08-06T17:30:00Z"), NOW
        )


@pytest.mark.parametrize(
    ("metadata", "settings", "code"),
    [
        (_metadata(voice_id="other"), dict(VOICE_SETTINGS), "voice_identity"),
        (
            _metadata(sharing={"original_voice_id": "other", "rate": 1}),
            dict(VOICE_SETTINGS),
            "voice_lineage",
        ),
        (
            _metadata(high_quality_base_model_ids=[]),
            dict(VOICE_SETTINGS),
            "model_unsupported",
        ),
        (
            _metadata(sharing={
                "original_voice_id": VOICE_ID,
                "rate": 0.05,
                "notice_period": 30,
                "disable_at_unix": 1_800_000_000,
            }),
            dict(VOICE_SETTINGS),
            "removal_pending",
        ),
        (
            _metadata(sharing={
                "original_voice_id": VOICE_ID,
                "rate": 0.05,
                "notice_period": 30,
                "status": "pending_removal",
            }),
            dict(VOICE_SETTINGS),
            "voice_unavailable",
        ),
        (
            _metadata(sharing={
                "original_voice_id": VOICE_ID,
                "rate": 0.05,
                "notice_period": 30,
                "credit_multiplier": 2,
            }),
            dict(VOICE_SETTINGS),
            "custom_multiplier",
        ),
        (
            _metadata(sharing={
                "original_voice_id": VOICE_ID,
                "rate": 0,
                "notice_period": 30,
            }),
            dict(VOICE_SETTINGS),
            "voice_library_rate_invalid",
        ),
        (
            _metadata(),
            {**VOICE_SETTINGS, "stability": 0.42},
            "settings_drift",
        ),
    ],
)
def test_preflight_fails_closed_before_tts_on_voice_drift(
    tmp_path: Path, metadata: dict, settings: dict, code: str
):
    transport = FakeTransport(metadata=metadata, settings=settings)
    with pytest.raises(AuditionError, match=code):
        _run_apply(tmp_path, transport)
    assert transport.post_calls == []
    assert not (tmp_path / "output").exists()


def test_happy_path_captures_cost_and_exact_payload_then_resume_skips(tmp_path: Path):
    lock = build()
    costs = [row["payload_character_count"] for row in lock["auditions"]]
    transport = FakeTransport([
        _audio_response(costs[0], b"audio-one"),
        _audio_response(costs[1], b"audio-two"),
        _audio_response(costs[2], b"audio-three"),
    ])
    result = _run_apply(tmp_path, transport)
    assert result["status"] == "complete"
    assert result["rendered"] == ["rf_story_02", "rf_story_03", "mc_story_02"]
    assert result["committed_character_cost"] == 10_007
    assert len(transport.post_calls) == 3
    for call, locked in zip(transport.post_calls, lock["auditions"], strict=True):
        assert call["url"].endswith(
            f"/{VOICE_ID}?output_format=mp3_44100_128"
        )
        assert call["body"]["model_id"] == MODEL_ID
        assert call["body"]["voice_settings"] == VOICE_SETTINGS
        source = _load(REPOSITORY / locked["source_file"])
        transcript = next(
            row["transcript"] for row in source["entries"]
            if row["id"] == locked["entry_id"]
        )
        assert call["body"]["text"] == transcript
        assert sha256(transcript.encode()).hexdigest() == locked["transcript_sha256"]
    ledger_path = tmp_path / "output/render-ledger.json"
    ledger_text = ledger_path.read_text(encoding="utf-8")
    assert "test-key-never-persist" not in ledger_text
    ledger = json.loads(ledger_text)
    assert all(row["state"] == "completed" for row in ledger["items"].values())
    assert ledger["preflight"]["subscription_source"] == "authenticated_browser_evidence"
    assert ledger["preflight"]["voice_lineage"] == "resolved_and_original_id_match"
    assert ledger["preflight"]["voice_library_rate"] == "0.05"
    assert ledger["preflight"]["voice_library_rate_semantics"] == (
        "provider_reported_credit_rate"
    )
    assert ledger["preflight"]["withdrawal_notice_period"] == "30"
    assert ledger["preflight"]["removal_state"] == "none"
    assert ledger["preflight"]["custom_credit_multiplier"] == "not_reported"

    resume = FakeTransport([])
    resumed = _run_apply(tmp_path, resume)
    assert resumed["rendered"] == []
    assert resumed["skipped"] == ["rf_story_02", "rf_story_03", "mc_story_02"]
    assert resume.post_calls == []


def test_returned_429_retries_but_5xx_is_ambiguous_and_never_retried(tmp_path: Path):
    lock = build()
    costs = [row["payload_character_count"] for row in lock["auditions"]]
    retry = FakeTransport([
        ProviderResponse(429, {"retry-after": "0"}, b""),
        _audio_response(costs[0], b"audio-one"),
        _audio_response(costs[1], b"audio-two"),
        _audio_response(costs[2], b"audio-three"),
    ])
    result = _run_apply(tmp_path, retry)
    assert result["status"] == "complete"
    assert len(retry.post_calls) == 4

    other = tmp_path / "five-hundred"
    five_hundred = FakeTransport([ProviderResponse(500, {}, b"")])
    with pytest.raises(AuditionError, match="server_response_ambiguous"):
        run_renderer(
            output_dir=other,
            apply=True,
            verified_output_format=OUTPUT_FORMAT_ID,
            account_evidence_path=_account_evidence(tmp_path),
            environ={API_KEY_ENV: "secret"},
            transport_factory=lambda: five_hundred,
            probe_audio=_fake_probe,
            now=lambda: NOW,
        )
    assert len(five_hundred.post_calls) == 1
    blocked = FakeTransport([])
    with pytest.raises(AuditionError, match="manual_provider_reconciliation"):
        run_renderer(
            output_dir=other,
            apply=True,
            verified_output_format=OUTPUT_FORMAT_ID,
            account_evidence_path=_account_evidence(tmp_path),
            environ={API_KEY_ENV: "secret"},
            transport_factory=lambda: blocked,
            probe_audio=_fake_probe,
            now=lambda: NOW,
        )
    assert blocked.post_calls == []


def test_transport_and_cost_ambiguity_are_reserved_without_rerender(tmp_path: Path):
    transport = FakeTransport([TimeoutError("contains private detail")])
    with pytest.raises(AuditionError, match="provider_transport_ambiguous"):
        _run_apply(tmp_path, transport)
    ledger_text = (tmp_path / "output/render-ledger.json").read_text()
    assert "private detail" not in ledger_text
    assert "test-key-never-persist" not in ledger_text
    assert _load(tmp_path / "output/render-ledger.json")["items"]["rf_story_02"][
        "state"
    ] == "ambiguous_transport"

    no_cost_dir = tmp_path / "no-cost"
    no_cost = FakeTransport([_audio_response(None, b"audio-one")])
    with pytest.raises(AuditionError, match="character_cost_missing"):
        run_renderer(
            output_dir=no_cost_dir,
            apply=True,
            verified_output_format=OUTPUT_FORMAT_ID,
            account_evidence_path=_account_evidence(tmp_path),
            environ={API_KEY_ENV: "secret"},
            transport_factory=lambda: no_cost,
            probe_audio=_fake_probe,
            now=lambda: NOW,
        )
    assert (no_cost_dir / "01-rf_story_02.mp3").is_file()
    assert _load(no_cost_dir / "render-ledger.json")["items"]["rf_story_02"][
        "state"
    ] == "completed_cost_unverified"


def test_strict_mp3_probe_accepts_44100_128_and_rejects_json_rate_or_bitrate():
    header_44100_128 = bytes((0xFF, 0xFB, 0x90, 0x00))
    frame_length = 417
    frame = header_44100_128 + bytes(frame_length - 4)
    probe = probe_mp3_bytes(frame * 20)
    assert probe.sample_rate_hz == 44_100
    assert probe.bitrate_kbps == 128
    assert probe.frame_count == 20
    with pytest.raises(AuditionError, match="audio_too_short"):
        probe_mp3_bytes(b'{"error":"not audio"}')
    header_48000_128 = bytes((0xFF, 0xFB, 0x94, 0x00))
    wrong_frame_length = 384
    wrong = (header_48000_128 + bytes(wrong_frame_length - 4)) * 24
    with pytest.raises(AuditionError, match="format_mismatch"):
        probe_mp3_bytes(wrong)
    header_44100_192 = bytes((0xFF, 0xFB, 0xB0, 0x00))
    wrong_bitrate_frame_length = 626
    wrong_bitrate = (
        header_44100_192 + bytes(wrong_bitrate_frame_length - 4)
    ) * 14
    with pytest.raises(AuditionError, match="format_mismatch"):
        probe_mp3_bytes(wrong_bitrate)
