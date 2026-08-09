from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

import pytest

import scripts.build_smokies_elevenlabs_james_roaring_fork_lock as lock_builder

from scripts.build_smokies_elevenlabs_james_audition_lock import (
    MODEL_ID,
    OUTPUT_FORMAT_ID,
    VOICE_ID,
    VOICE_SETTINGS,
)
from scripts.build_smokies_elevenlabs_james_roaring_fork_lock import (
    CHARACTER_CAP,
    DESTINATION,
    GENERATION_ALLOWLIST,
    KEY_CREDIT_QUOTA,
    REPOSITORY,
    REUSE_ALLOWLIST,
    build,
    serialize,
)
from scripts.render_smokies_elevenlabs_james_auditions import (
    AuditionError as NarrationError,
    Mp3Probe,
    ProviderResponse,
)
from scripts.render_smokies_elevenlabs_james_roaring_fork import (
    API_KEY_ENV,
    _exclusive_apply_lock,
    _new_ledger,
    _probe_mono_mp3,
    _request_fingerprint,
    load_account_evidence,
    load_locked_packet,
    projected_cost_usd,
    run_renderer,
)

NOW = datetime(2026, 8, 9, 4, 0, tzinfo=timezone.utc)


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _account_value() -> dict:
    return {
        "schema_version": 1,
        "provider": "elevenlabs",
        "source": "authenticated_browser",
        "observed_at": "2026-08-09T03:30:00Z",
        "plan": "creator",
        "account_status": "active",
        "available_credits": 125_496,
        "commercial_use": True,
        "model_training_contribution": False,
        "standard_logging_acknowledged": True,
        "output_format_id": OUTPUT_FORMAT_ID,
        "overage": {"status": "disabled"},
        "api_key_policy": {
            "expiry": "one_day",
            "created_at": "2026-08-09T03:20:00Z",
            "expires_at": "2026-08-10T03:20:00Z",
            "credit_limit": 20_000,
            "permissions": [
                "text_to_speech",
                "voices_read",
                "subscription_read",
            ],
            "auto_disable_if_leaked": True,
        },
        "source_evidence_sha256": "a" * 64,
    }


def _account_evidence(tmp_path: Path, value: dict | None = None) -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    path = tmp_path / "account-evidence.json"
    path.write_text(json.dumps(value or _account_value()), encoding="utf-8")
    return path


def _metadata(**updates) -> dict:
    value = {
        "voice_id": VOICE_ID,
        "high_quality_base_model_ids": [MODEL_ID],
        "sharing": {
            "original_voice_id": VOICE_ID,
            "status": "copied",
            "rate": 1,
            "notice_period": 730,
            "disable_at_unix": 0,
        },
    }
    value.update(updates)
    return value


def _subscription(**updates) -> dict:
    value = {
        "tier": "creator",
        "character_count": 5_504,
        "character_limit": 131_000,
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
        subscription: dict | None = None,
    ):
        self.post_responses = list(post_responses or [])
        self.metadata = _metadata() if metadata is None else metadata
        self.settings = dict(VOICE_SETTINGS) if settings is None else settings
        self.subscription = (
            _subscription() if subscription is None else subscription
        )
        self.get_calls: list[tuple[str, dict]] = []
        self.post_calls: list[dict] = []

    def get(self, url, *, headers, timeout):
        self.get_calls.append((url, dict(headers)))
        if url.endswith("/settings"):
            return _json_response(self.settings)
        if url.endswith("/user/subscription"):
            return _json_response(self.subscription)
        return _json_response(self.metadata)

    def post(self, url, *, headers, body, timeout):
        self.post_calls.append({
            "url": url,
            "headers": dict(headers),
            "body": json.loads(body),
            "timeout": timeout,
        })
        if not self.post_responses:
            raise AssertionError("unexpected provider POST")
        response = self.post_responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


def _fake_probe(content: bytes) -> Mp3Probe:
    accepted = {
        b"accepted-rf-story-02": Mp3Probe(
            byte_count=3_441_937,
            sha256=(
                "a0f70a05d89f2318b3f99b8580bfdb93d5e626cc696dca9614c5bf3bc078006e"
            ),
            sample_rate_hz=44_100,
            bitrate_kbps=128,
            frame_count=8_235,
            duration_s=215.118367,
        ),
        b"accepted-rf-story-03": Mp3Probe(
            byte_count=3_184_893,
            sha256=(
                "ca7ea9e8cd997ee1cf90cc0b4112f17cb8815754b6a2ccfdc0e1112e3696b1a7"
            ),
            sample_rate_hz=44_100,
            bitrate_kbps=128,
            frame_count=7_619,
            duration_s=199.053061,
        ),
    }
    if content in accepted:
        return accepted[content]
    duration = 25.0 if content.startswith(b"cue-") else 190.0
    return Mp3Probe(
        byte_count=len(content),
        sha256=sha256(content).hexdigest(),
        sample_rate_hz=44_100,
        bitrate_kbps=128,
        frame_count=1_000,
        duration_s=duration,
    )


def _accepted_dir(tmp_path: Path) -> Path:
    path = tmp_path / "accepted"
    path.mkdir(parents=True, exist_ok=True)
    (path / "01-rf_story_02.mp3").write_bytes(b"accepted-rf-story-02")
    (path / "02-rf_story_03.mp3").write_bytes(b"accepted-rf-story-03")
    return path


def _audio_response(entry, *, cost: int | None = None) -> ProviderResponse:
    marker = (
        f"cue-{entry.entry_id}" if entry.kind == "cue"
        else f"story-{entry.entry_id}"
    ).encode()
    headers = {
        "content-type": "audio/mpeg",
        "request-id": f"request-{entry.entry_id}",
        "x-trace-id": f"trace-{entry.entry_id}",
    }
    if cost is not None:
        headers["character-cost"] = str(cost)
    return ProviderResponse(200, headers, marker)


def _successful_responses() -> list[ProviderResponse]:
    packet = load_locked_packet()
    return [
        _audio_response(
            entry,
            cost=max(1, round(entry.payload_character_count * 0.55)),
        )
        for entry in packet.entries
        if entry.disposition == "generate"
    ]


def _run_apply(
    tmp_path: Path,
    transport: FakeTransport,
    *,
    output_name: str = "output",
    accepted_audio_dir: Path | None = None,
):
    return run_renderer(
        output_dir=tmp_path / output_name,
        accepted_audio_dir=accepted_audio_dir or _accepted_dir(tmp_path),
        apply=True,
        verified_output_format=OUTPUT_FORMAT_ID,
        account_evidence_path=_account_evidence(tmp_path),
        environ={API_KEY_ENV: "test-key-never-persist"},
        transport_factory=lambda: transport,
        probe_audio=_fake_probe,
        now=lambda: NOW,
        retry_jitter=lambda value: value,
        sleep=lambda _value: None,
    )


def test_lock_is_current_deterministic_and_cli_dry_run_is_network_free():
    assert _load(DESTINATION) == build()
    assert DESTINATION.read_text(encoding="utf-8") == serialize(build())
    checked = subprocess.run(
        [
            sys.executable,
            "scripts/build_smokies_elevenlabs_james_roaring_fork_lock.py",
            "--check",
        ],
        cwd=REPOSITORY,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "verified originals/smokies/elevenlabs_james_roaring_fork" in (
        checked.stdout
    )
    dry_run = subprocess.run(
        [
            sys.executable,
            "scripts/render_smokies_elevenlabs_james_roaring_fork.py",
        ],
        cwd=REPOSITORY,
        check=True,
        capture_output=True,
        text=True,
    )
    result = json.loads(dry_run.stdout)
    assert result["status"] == "dry_run_ready"
    assert result["network_used"] is False
    assert result["generation_count"] == 11
    assert result["reuse_count"] == 2


def test_lock_binds_corrected_copy_delivery_culture_audio_and_exact_budget():
    lock = build()
    assert [row["stable_order"] for row in lock["entries"]] == list(
        range(1, 14)
    )
    assert {row["entry_id"] for row in lock["entries"]} == (
        GENERATION_ALLOWLIST | REUSE_ALLOWLIST
    )
    assert {
        row["entry_id"]
        for row in lock["entries"]
        if row["generation_disposition"] == "generate"
    } == GENERATION_ALLOWLIST
    assert all(row["source_gate"] == "source_verified" for row in lock["entries"])
    assert all(row["cultural_gate"] == "not_required" for row in lock["entries"])
    assert lock["cultural_gate"]["blocked_entry_ids"] == []
    assert lock["budget"] == {
        "billing_unit": "provider_credits",
        "generated_payload_character_count": 16_373,
        "generated_normalized_character_count": 16_337,
        "reserved_character_ceiling": 18_016,
        "renderer_character_cap": CHARACTER_CAP,
        "renderer_headroom_credits": 84,
        "api_key_credit_quota": KEY_CREDIT_QUOTA,
        "contingency_percent": 10,
        "max_assumed_usd_per_1000_characters": "0.10",
        "dollar_cap_usd": "2.00",
        "rerender_budget": 0,
    }
    assert CHARACTER_CAP == 18_100
    assert KEY_CREDIT_QUOTA == 20_000
    assert projected_cost_usd(18_016) < 2
    reused = {
        row["entry_id"]: row["accepted_audio"]
        for row in lock["entries"]
        if row["generation_disposition"] == "reuse"
    }
    assert reused["rf_story_02"]["audio_sha256"].startswith("a0f70a05")
    assert reused["rf_story_03"]["audio_sha256"].startswith("ca7ea9e8")
    for entry_id, accepted in reused.items():
        row = next(item for item in lock["entries"] if item["entry_id"] == entry_id)
        assert accepted["raw_transcript_sha256"] == row["raw_transcript_sha256"]
        assert accepted["normalized_transcript_sha256"] == (
            row["normalized_transcript_sha256"]
        )
    assert lock["generation_profile"]["output"] == {
        "format_id": "mp3_44100_128",
        "container": "mp3",
        "mime_type": "audio/mpeg",
        "sample_rate_hz": 44_100,
        "bitrate_kbps": 128,
        "channels": 1,
        "provider_native_lossy_source": True,
        "lossless_or_wav_claimed": False,
        "transcoding_for_delivery": False,
    }
    assert lock["generation_profile"]["voice_metadata_contract"][
        "sharing_status"
    ] == "copied"
    for row in lock["entries"]:
        assert row["raw_transcript_sha256"]
        assert row["normalized_transcript_sha256"]
        assert len(row["raw_transcript_sha256"]) == 64
        assert len(row["normalized_transcript_sha256"]) == 64


def test_lock_fails_if_reused_transcript_or_audition_profile_drifts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    editorial = _load(lock_builder.EDITORIAL_PATH)
    reused = next(
        row for row in editorial["entries"] if row["id"] == "rf_story_02"
    )
    reused["transcript"] = reused["transcript"].replace(
        "Roaring Fork", "Roaring fork", 1
    )
    editorial_path = tmp_path / "editorial.json"
    editorial_path.write_text(json.dumps(editorial), encoding="utf-8")
    monkeypatch.setattr(lock_builder, "EDITORIAL_PATH", editorial_path)
    with pytest.raises(ValueError, match="Accepted audition transcript drifted"):
        lock_builder.build()

    monkeypatch.setattr(
        lock_builder,
        "EDITORIAL_PATH",
        lock_builder.REPOSITORY
        / "originals/smokies/editorial_roaring_fork_v1.json",
    )
    audition = _load(lock_builder.AUDITION_LOCK_PATH)
    audition["generation_profile"]["voice_id"] = "different-voice"
    audition_path = tmp_path / "audition.json"
    audition_path.write_text(json.dumps(audition), encoding="utf-8")
    monkeypatch.setattr(lock_builder, "AUDITION_LOCK_PATH", audition_path)
    with pytest.raises(ValueError, match="Accepted audition profile drifted"):
        lock_builder.build()


def test_lock_checks_all_dossier_claims_not_only_roaring_fork(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    dossier = _load(lock_builder.DOSSIER_PATH)
    unrelated = next(
        row for row in dossier["claims"]
        if row["chapter_id"] != "roaring_fork"
    )
    unrelated["status"] = "unreviewed"
    dossier_path = tmp_path / "dossier.json"
    dossier_path.write_text(json.dumps(dossier), encoding="utf-8")
    monkeypatch.setattr(lock_builder, "DOSSIER_PATH", dossier_path)
    with pytest.raises(ValueError, match="Dossier claim gate drifted"):
        lock_builder.build()


def test_dry_run_never_reads_key_constructs_transport_or_writes(tmp_path: Path):
    class NoEnvironment(dict):
        def get(self, *_args, **_kwargs):
            raise AssertionError("dry run read the environment")

    result = run_renderer(
        output_dir=tmp_path / "must-not-exist",
        accepted_audio_dir=tmp_path / "also-must-not-be-read",
        environ=NoEnvironment(),
        transport_factory=lambda: (_ for _ in ()).throw(
            AssertionError("dry run constructed a transport")
        ),
    )
    assert result["status"] == "dry_run_ready"
    assert result["reserved_character_ceiling"] == 18_016
    assert not (tmp_path / "must-not-exist").exists()


def test_account_evidence_is_fresh_redacted_and_exactly_key_limited(
    tmp_path: Path,
):
    evidence = load_account_evidence(_account_evidence(tmp_path), NOW)
    assert evidence.available_credits == 125_496
    assert evidence.overage_status == "disabled"

    invalid = _account_value()
    invalid["model_training_contribution"] = True
    with pytest.raises(NarrationError, match="contract_invalid"):
        load_account_evidence(_account_evidence(tmp_path, invalid), NOW)

    invalid = _account_value()
    invalid["api_key_policy"]["credit_limit"] = 20_001
    with pytest.raises(NarrationError, match="key_policy_invalid"):
        load_account_evidence(_account_evidence(tmp_path, invalid), NOW)

    invalid = _account_value()
    invalid["api_key_value"] = "must-never-be-recorded"
    with pytest.raises(NarrationError, match="sensitive_field"):
        load_account_evidence(_account_evidence(tmp_path, invalid), NOW)

    invalid = _account_value()
    invalid["observed_at"] = "2026-08-07T03:30:00Z"
    with pytest.raises(NarrationError, match="stale"):
        load_account_evidence(_account_evidence(tmp_path, invalid), NOW)

    invalid = _account_value()
    invalid["api_key_policy"]["created_at"] = "2026-08-08T05:00:00Z"
    invalid["api_key_policy"]["expires_at"] = "2026-08-09T05:00:00Z"
    with pytest.raises(NarrationError, match="key_expiry_invalid"):
        load_account_evidence(_account_evidence(tmp_path, invalid), NOW)

    invalid = _account_value()
    invalid["api_key_policy"].pop("expires_at")
    with pytest.raises(NarrationError, match="key_expiry_invalid"):
        load_account_evidence(_account_evidence(tmp_path, invalid), NOW)

    enabled = _account_value()
    enabled["overage"] = {
        "status": "enabled",
        "verified_rate_usd_per_1000_characters": "0.10",
        "hard_dollar_cap_usd": "2.00",
    }
    assert load_account_evidence(
        _account_evidence(tmp_path, enabled), NOW
    ).overage_status == "enabled"

    invalid = json.loads(json.dumps(enabled))
    invalid["overage"]["verified_rate_usd_per_1000_characters"] = "0.11"
    with pytest.raises(NarrationError, match="overage_invalid"):
        load_account_evidence(_account_evidence(tmp_path, invalid), NOW)

    invalid = json.loads(json.dumps(enabled))
    invalid["overage"]["hard_dollar_cap_usd"] = "2.01"
    with pytest.raises(NarrationError, match="overage_invalid"):
        load_account_evidence(_account_evidence(tmp_path, invalid), NOW)


@pytest.mark.parametrize(
    ("metadata", "settings", "subscription", "code"),
    [
        (
            _metadata(voice_id="other"),
            dict(VOICE_SETTINGS),
            _subscription(),
            "metadata_drift",
        ),
        (
            _metadata(sharing={
                "original_voice_id": VOICE_ID,
                "status": "copied",
                "rate": 0.05,
                "notice_period": 730,
                "disable_at_unix": 0,
            }),
            dict(VOICE_SETTINGS),
            _subscription(),
            "metadata_drift",
        ),
        (
            _metadata(sharing={
                "original_voice_id": VOICE_ID,
                "status": "copied",
                "rate": 1,
                "notice_period": 30,
                "disable_at_unix": 0,
            }),
            dict(VOICE_SETTINGS),
            _subscription(),
            "metadata_drift",
        ),
        (
            _metadata(sharing={
                "original_voice_id": VOICE_ID,
                "status": "copied",
                "rate": 1,
                "notice_period": 730,
                "disable_at_unix": 0,
                "credit_multiplier": 2,
            }),
            dict(VOICE_SETTINGS),
            _subscription(),
            "credit_multiplier_drift",
        ),
        (
            _metadata(sharing=None),
            dict(VOICE_SETTINGS),
            _subscription(),
            "metadata_drift",
        ),
        (
            _metadata(disable_at_unix=1_786_000_000),
            dict(VOICE_SETTINGS),
            _subscription(),
            "metadata_drift",
        ),
        (
            _metadata(sharing={
                "status": "copied",
                "rate": 1,
                "notice_period": 730,
                "disable_at_unix": 0,
            }),
            dict(VOICE_SETTINGS),
            _subscription(),
            "metadata_drift",
        ),
        (
            _metadata(sharing={
                "original_voice_id": VOICE_ID,
                "rate": 1,
                "notice_period": 730,
                "disable_at_unix": 0,
            }),
            dict(VOICE_SETTINGS),
            _subscription(),
            "metadata_drift",
        ),
        (
            _metadata(sharing={
                "original_voice_id": VOICE_ID,
                "status": "enabled",
                "rate": 1,
                "notice_period": 730,
                "disable_at_unix": 0,
            }),
            dict(VOICE_SETTINGS),
            _subscription(),
            "metadata_drift",
        ),
        (
            _metadata(sharing={
                "original_voice_id": VOICE_ID,
                "status": "original",
                "rate": 1,
                "notice_period": 730,
                "disable_at_unix": 0,
            }),
            dict(VOICE_SETTINGS),
            _subscription(),
            "metadata_drift",
        ),
        (
            _metadata(),
            {**VOICE_SETTINGS, "stability": 0.42},
            _subscription(),
            "settings_drift",
        ),
        (
            _metadata(),
            dict(VOICE_SETTINGS),
            _subscription(tier="pro"),
            "subscription_invalid",
        ),
    ],
)
def test_preflight_fails_before_tts_on_actual_james_contract_drift(
    tmp_path: Path,
    metadata: dict,
    settings: dict,
    subscription: dict,
    code: str,
):
    transport = FakeTransport(
        metadata=metadata,
        settings=settings,
        subscription=subscription,
    )
    with pytest.raises(NarrationError, match=code):
        _run_apply(tmp_path, transport)
    assert transport.post_calls == []


def test_apply_reuses_exact_s4c_audio_generates_only_allowlist_and_resumes(
    tmp_path: Path,
):
    accepted = _accepted_dir(tmp_path)
    transport = FakeTransport(_successful_responses())
    result = _run_apply(
        tmp_path,
        transport,
        accepted_audio_dir=accepted,
    )
    assert result["status"] == "complete"
    assert set(result["reused"]) == REUSE_ALLOWLIST
    assert set(result["rendered"]) == GENERATION_ALLOWLIST
    assert len(transport.post_calls) == 11
    generated_packet_entries = [
        entry
        for entry in load_locked_packet().entries
        if entry.disposition == "generate"
    ]
    expected_transcripts = {
        entry.transcript
        for entry in generated_packet_entries
    }
    assert {call["body"]["text"] for call in transport.post_calls} == (
        expected_transcripts
    )
    assert [call["body"]["text"] for call in transport.post_calls] == [
        entry.transcript for entry in generated_packet_entries
    ]
    ledger_path = tmp_path / "output/render-ledger.json"
    ledger_text = ledger_path.read_text(encoding="utf-8")
    assert "test-key-never-persist" not in ledger_text
    assert "The Ogle farm at the edge of town" not in ledger_text
    ledger = json.loads(ledger_text)
    assert ledger["preflight"]["sharing_status"] == "copied"
    assert ledger["items"]["rf_story_02"]["state"] == "reused_verified"
    assert ledger["items"]["rf_story_03"]["state"] == "reused_verified"
    assert all(
        ledger["items"][entry_id]["state"] == "completed"
        for entry_id in GENERATION_ALLOWLIST
    )
    assert all(
        "provider_request_id_sha256" in row["attempts"][0]
        for entry_id, row in ledger["items"].items()
        if entry_id in GENERATION_ALLOWLIST
    )

    resume = FakeTransport([])
    resumed = _run_apply(
        tmp_path,
        resume,
        accepted_audio_dir=accepted,
    )
    assert resumed["rendered"] == []
    assert set(resumed["skipped"]) == (
        GENERATION_ALLOWLIST | REUSE_ALLOWLIST
    )
    assert resume.post_calls == []
    assert resumed["network_used"] is True
    assert resumed["provider_preflight_network_used"] is True
    assert resumed["tts_network_used"] is False


def test_concurrent_apply_is_rejected_before_key_or_network(tmp_path: Path):
    output_dir = (tmp_path / "output").resolve()
    transport = FakeTransport([])
    with _exclusive_apply_lock(output_dir):
        with pytest.raises(NarrationError, match="concurrent_apply_forbidden"):
            _run_apply(tmp_path, transport)
    assert transport.get_calls == []
    assert transport.post_calls == []


def test_resume_rejects_ledger_and_master_tamper_before_network(tmp_path: Path):
    accepted = _accepted_dir(tmp_path)
    _run_apply(
        tmp_path,
        FakeTransport(_successful_responses()),
        accepted_audio_dir=accepted,
    )
    ledger_path = tmp_path / "output/render-ledger.json"
    ledger = _load(ledger_path)
    generated_id = next(iter(sorted(GENERATION_ALLOWLIST)))
    ledger["items"][generated_id]["raw_transcript_sha256"] = "0" * 64
    ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
    rejected = FakeTransport([])
    with pytest.raises(NarrationError, match="item_identity_drift"):
        _run_apply(
            tmp_path,
            rejected,
            accepted_audio_dir=accepted,
        )
    assert rejected.get_calls == []
    assert rejected.post_calls == []

    clean_root = tmp_path / "master"
    clean_accepted = _accepted_dir(clean_root)
    _run_apply(
        clean_root,
        FakeTransport(_successful_responses()),
        accepted_audio_dir=clean_accepted,
    )
    packet = load_locked_packet()
    generated = next(
        entry for entry in packet.entries if entry.disposition == "generate"
    )
    master = (
        clean_root
        / "output"
        / f"{generated.stable_order:02d}-{generated.entry_id}.mp3"
    )
    master.write_bytes(b"tampered-completed-master")
    rejected = FakeTransport([])
    with pytest.raises(NarrationError, match="completed_master_drift"):
        _run_apply(
            clean_root,
            rejected,
            accepted_audio_dir=clean_accepted,
        )
    assert rejected.get_calls == []
    assert rejected.post_calls == []


def test_resume_rejects_reuse_evidence_tamper(
    tmp_path: Path,
):
    accepted = _accepted_dir(tmp_path)
    _run_apply(
        tmp_path,
        FakeTransport(_successful_responses()),
        accepted_audio_dir=accepted,
    )
    ledger_path = tmp_path / "output/render-ledger.json"
    ledger = _load(ledger_path)
    ledger["items"]["rf_story_02"]["audio_sha256"] = "f" * 64
    ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
    rejected = FakeTransport([])
    with pytest.raises(NarrationError, match="reuse_ledger_evidence_drift"):
        _run_apply(tmp_path, rejected, accepted_audio_dir=accepted)
    assert rejected.get_calls == []


def test_pending_reuse_and_attempt_ledgers_reject_cost_or_sensitive_extras(
    tmp_path: Path,
):
    packet = load_locked_packet()

    pending_root = tmp_path / "pending"
    pending_output = pending_root / "output"
    pending_output.mkdir(parents=True)
    ledger = _new_ledger(packet, NOW)
    generated = next(
        entry for entry in packet.entries if entry.disposition == "generate"
    )
    ledger["items"][generated.entry_id]["character_cost"] = -1
    (pending_output / "render-ledger.json").write_text(
        json.dumps(ledger), encoding="utf-8"
    )
    rejected = FakeTransport([])
    with pytest.raises(NarrationError, match="item_fields_drift"):
        _run_apply(
            pending_root,
            rejected,
            accepted_audio_dir=_accepted_dir(pending_root),
        )
    assert rejected.get_calls == []

    reuse_root = tmp_path / "reuse"
    reuse_output = reuse_root / "output"
    reuse_output.mkdir(parents=True)
    ledger = _new_ledger(packet, NOW)
    ledger["items"]["rf_story_02"]["api_key"] = "forbidden"
    (reuse_output / "render-ledger.json").write_text(
        json.dumps(ledger), encoding="utf-8"
    )
    rejected = FakeTransport([])
    with pytest.raises(NarrationError, match="reuse_ledger_fields_drift"):
        _run_apply(
            reuse_root,
            rejected,
            accepted_audio_dir=_accepted_dir(reuse_root),
        )
    assert rejected.get_calls == []

    attempt_root = tmp_path / "attempt"
    attempt_output = attempt_root / "output"
    attempt_output.mkdir(parents=True)
    ledger = _new_ledger(packet, NOW)
    item = ledger["items"][generated.entry_id]
    item.update({
        "state": "pending_retry",
        "request_fingerprint": _request_fingerprint(packet, generated),
        "reserved_at": "2026-08-09T03:40:00Z",
        "attempts": [{
            "number": 1,
            "state": "retryable_response",
            "at": "2026-08-09T03:40:00Z",
            "http_status": 429,
            "api_key": "forbidden",
        }],
    })
    (attempt_output / "render-ledger.json").write_text(
        json.dumps(ledger), encoding="utf-8"
    )
    rejected = FakeTransport([])
    with pytest.raises(NarrationError, match="attempt_fields_drift"):
        _run_apply(
            attempt_root,
            rejected,
            accepted_audio_dir=_accepted_dir(attempt_root),
        )
    assert rejected.get_calls == []

    clean_root = tmp_path / "cost"
    clean_accepted = _accepted_dir(clean_root)
    _run_apply(
        clean_root,
        FakeTransport(_successful_responses()),
        accepted_audio_dir=clean_accepted,
    )
    ledger_path = clean_root / "output/render-ledger.json"
    ledger = _load(ledger_path)
    generated_id = next(iter(sorted(GENERATION_ALLOWLIST)))
    ledger["items"][generated_id]["character_cost"] = -1
    ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
    rejected = FakeTransport([])
    with pytest.raises(NarrationError, match="cost_drift"):
        _run_apply(
            clean_root,
            rejected,
            accepted_audio_dir=clean_accepted,
        )
    assert rejected.get_calls == []


def test_reused_audio_tamper_stops_before_any_tts_request(tmp_path: Path):
    accepted = _accepted_dir(tmp_path)
    (accepted / "01-rf_story_02.mp3").write_bytes(b"tampered")
    transport = FakeTransport(_successful_responses())
    with pytest.raises(NarrationError, match="accepted_audio_tampered"):
        _run_apply(
            tmp_path,
            transport,
            accepted_audio_dir=accepted,
        )
    assert transport.get_calls == []
    assert transport.post_calls == []


def test_429_is_only_retry_and_5xx_or_timeout_reserves_without_replay(
    tmp_path: Path,
):
    responses = [ProviderResponse(429, {"retry-after": "0"}, b"")]
    responses.extend(_successful_responses())
    retry = FakeTransport(responses)
    result = _run_apply(tmp_path, retry, output_name="retry")
    assert result["status"] == "complete"
    assert len(retry.post_calls) == 12

    five_dir = tmp_path / "five"
    five = FakeTransport([ProviderResponse(500, {}, b"")])
    with pytest.raises(NarrationError, match="server_response_ambiguous"):
        run_renderer(
            output_dir=five_dir,
            accepted_audio_dir=_accepted_dir(tmp_path / "five-accepted"),
            apply=True,
            verified_output_format=OUTPUT_FORMAT_ID,
            account_evidence_path=_account_evidence(tmp_path / "five-evidence"),
            environ={API_KEY_ENV: "secret"},
            transport_factory=lambda: five,
            probe_audio=_fake_probe,
            now=lambda: NOW,
        )
    blocked = FakeTransport([])
    with pytest.raises(NarrationError, match="manual_provider_reconciliation"):
        run_renderer(
            output_dir=five_dir,
            accepted_audio_dir=tmp_path / "five-accepted" / "accepted",
            apply=True,
            verified_output_format=OUTPUT_FORMAT_ID,
            account_evidence_path=tmp_path / "five-evidence" / "account-evidence.json",
            environ={API_KEY_ENV: "secret"},
            transport_factory=lambda: blocked,
            probe_audio=_fake_probe,
            now=lambda: NOW,
        )
    assert blocked.post_calls == []

    timeout_dir = tmp_path / "timeout"
    timeout = FakeTransport([TimeoutError("private provider detail")])
    with pytest.raises(NarrationError, match="provider_transport_ambiguous"):
        run_renderer(
            output_dir=timeout_dir,
            accepted_audio_dir=_accepted_dir(tmp_path / "timeout-accepted"),
            apply=True,
            verified_output_format=OUTPUT_FORMAT_ID,
            account_evidence_path=_account_evidence(tmp_path / "timeout-evidence"),
            environ={API_KEY_ENV: "secret"},
            transport_factory=lambda: timeout,
            probe_audio=_fake_probe,
            now=lambda: NOW,
        )
    assert "private provider detail" not in (
        timeout_dir / "render-ledger.json"
    ).read_text(encoding="utf-8")


def test_missing_or_excess_cost_fails_closed_and_keeps_evidence(tmp_path: Path):
    packet = load_locked_packet()
    first = next(entry for entry in packet.entries if entry.disposition == "generate")
    missing = FakeTransport([_audio_response(first, cost=None)])
    with pytest.raises(NarrationError, match="character_cost_missing"):
        _run_apply(tmp_path, missing, output_name="missing")
    missing_ledger = _load(tmp_path / "missing/render-ledger.json")
    assert missing_ledger["items"][first.entry_id]["state"] == (
        "completed_cost_unverified"
    )

    excess = FakeTransport([
        _audio_response(first, cost=first.reserved_character_ceiling + 1)
    ])
    with pytest.raises(NarrationError, match="character_cost_cap_exceeded"):
        _run_apply(tmp_path, excess, output_name="excess")
    excess_ledger = _load(tmp_path / "excess/render-ledger.json")
    assert excess_ledger["items"][first.entry_id]["state"] == (
        "completed_cost_violation"
    )


def test_strict_mp3_probe_rejects_stereo_even_when_rate_and_bitrate_match():
    frame_length = 417
    mono_header = bytes((0xFF, 0xFB, 0x90, 0xC0))
    mono_frame = mono_header + bytes(frame_length - 4)
    mono = mono_frame * 20
    assert _probe_mono_mp3(mono).sample_rate_hz == 44_100

    stereo_header = bytes((0xFF, 0xFB, 0x90, 0x00))
    stereo_frame = stereo_header + bytes(frame_length - 4)
    with pytest.raises(NarrationError, match="channel_mismatch"):
        _probe_mono_mp3(stereo_frame * 20)
    with pytest.raises(NarrationError, match="channel_mismatch"):
        _probe_mono_mp3(mono_frame * 10 + stereo_frame * 10)


def test_lock_or_source_tamper_is_rejected_before_environment_or_network(
    tmp_path: Path,
):
    tampered = _load(DESTINATION)
    tampered["entries"][0]["normalized_transcript_sha256"] = "0" * 64
    lock_path = tmp_path / "tampered-lock.json"
    lock_path.write_text(json.dumps(tampered), encoding="utf-8")
    with pytest.raises(NarrationError, match="production_lock_drift"):
        run_renderer(
            lock_path=lock_path,
            environ={API_KEY_ENV: "must-not-be-read"},
            transport_factory=lambda: (_ for _ in ()).throw(
                AssertionError("tampered lock constructed transport")
            ),
        )
