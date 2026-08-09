from __future__ import annotations

from datetime import datetime, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

from scripts import render_smokies_cartesia_auditions as renderer


NOW = datetime(2026, 8, 8, 16, 0, tzinfo=timezone.utc)
SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64
SHA_D = "d" * 64


def wav_bytes(
    *,
    channels: int = 1,
    sample_width: int = 2,
    sample_rate: int = 44_100,
    frames: int = 4_410,
) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(sample_width)
        audio.setframerate(sample_rate)
        audio.writeframes(b"\0" * frames * channels * sample_width)
    return output.getvalue()


def account_evidence(
    path: Path,
    *,
    balance: int = 100_000,
    opt_out: bool = True,
    overage_rate: str | None = None,
    overage_enabled: bool = False,
    plan_observed_at: str = "2026-08-08T15:30:00Z",
    balance_observed_at: str = "2026-08-08T15:45:00Z",
    balance_evidence_sha256: str = SHA_C,
    extra: dict | None = None,
) -> Path:
    payload = {
        "schema_version": 1,
        "provider": "cartesia",
        "plan": {
            "name": "pro",
            "status": "active",
            "commercial_use": True,
            "observed_at": plan_observed_at,
            "evidence_sha256": SHA_A,
        },
        "training_opt_out": {
            "status": "processed" if opt_out else "pending",
            "enabled": opt_out,
            "observed_at": "2026-08-08T15:30:00Z",
            "evidence_sha256": SHA_B,
        },
        "credit_balance": {
            "credits": balance,
            "observed_at": balance_observed_at,
            "evidence_sha256": balance_evidence_sha256,
        },
    }
    if overage_rate is not None:
        overage_enabled = True
    payload["overage"] = {
        "enabled": overage_enabled,
        "observed_at": "2026-08-08T15:45:00Z",
        "evidence_sha256": SHA_D,
    }
    if overage_rate is not None:
        payload["overage"]["usd_per_1000_credits"] = overage_rate
    if extra:
        payload.update(extra)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


class FakeTransport:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def post(self, url, *, headers, body, timeout):
        self.calls.append({
            "url": url,
            "headers": dict(headers),
            "body": body,
            "timeout": timeout,
        })
        if not self.results:
            raise AssertionError("unexpected provider request")
        result = self.results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result


def response(status: int, body: bytes = b"", **headers: str):
    return renderer.ProviderResponse(status, headers, body)


FAKE_ENCODER = renderer.EncoderProvenance(
    executable="/verified/ffmpeg",
    distribution="imageio-ffmpeg",
    package_version="0.6.0",
    package_sha256=SHA_A,
    binary_sha256=SHA_B,
    version_text_sha256=SHA_C,
    version_line="ffmpeg version pinned-test",
)


def fake_encode(master: Path, directory: Path, encoder):
    assert encoder == FAKE_ENCODER
    assert renderer.probe_wav_file(master).duration_s > 0
    values = {}
    for bitrate in renderer.BITRATES_KBPS:
        content = b"ID3" + bytes([bitrate]) * 200
        destination = directory / f"delivery-{bitrate}.mp3"
        destination.write_bytes(content)
        values[str(bitrate)] = {
            "path": destination.name,
            "bitrate_kbps": bitrate,
            "bytes": len(content),
            "sha256": renderer._sha256_bytes(content),
        }
    return values


class SmokiesCartesiaAuditionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.output = self.root / "output"
        self.evidence = account_evidence(self.root / "account.json")

    def tearDown(self):
        self.temporary.cleanup()

    def apply(self, transport, **kwargs):
        return renderer.run_renderer(
            lock_path=renderer.DEFAULT_LOCK,
            output_directory=self.output,
            account_evidence_path=self.evidence,
            apply=True,
            repository=renderer.REPOSITORY,
            transport=transport,
            encoder=FAKE_ENCODER,
            encoder_runner=fake_encode,
            sleep=lambda _seconds: None,
            retry_jitter=lambda _base: 0.0,
            duration_validator=lambda _script, _probe: None,
            now=NOW,
            api_key="test-provider-secret",
            **kwargs,
        )

    def test_default_is_network_free_dry_run(self):
        arguments = renderer.build_parser().parse_args([])
        self.assertFalse(arguments.apply)
        transport = FakeTransport([AssertionError("network forbidden")])

        result = renderer.run_renderer(
            lock_path=renderer.DEFAULT_LOCK,
            output_directory=self.output,
            repository=renderer.REPOSITORY,
            transport=transport,
            now=NOW,
        )

        self.assertEqual(result["mode"], "dry_run")
        self.assertFalse(result["network_allowed"])
        self.assertEqual(result["credits_projected_this_run"], 11_008)
        self.assertEqual(result["payload_characters_projected_this_run"], 10_007)
        self.assertEqual(result["normalized_characters_projected_this_run"], 9_986)
        self.assertEqual(result["lock_projected_credits_with_contingency"], 10_985)
        self.assertEqual(transport.calls, [])
        self.assertTrue((self.output / "preflight.json").is_file())
        self.assertFalse((self.output / "ledger.json").exists())

    def test_checked_lock_rejects_profile_source_and_packet_cap_drift(self):
        raw = json.loads(renderer.DEFAULT_LOCK.read_text(encoding="utf-8"))
        changed = self.root / "changed.json"

        raw["generation_profile"]["model_snapshot"] = "sonic-3.5"
        changed.write_text(json.dumps(raw), encoding="utf-8")
        with self.assertRaisesRegex(renderer.AuditionError, "profile_drift"):
            renderer.load_locked_packet(changed)

        raw = json.loads(renderer.DEFAULT_LOCK.read_text(encoding="utf-8"))
        raw["source_files"][0]["sha256"] = "0" * 64
        changed.write_text(json.dumps(raw), encoding="utf-8")
        with self.assertRaisesRegex(renderer.AuditionError, "source_hash_drift"):
            renderer.load_locked_packet(changed)

        raw = json.loads(renderer.DEFAULT_LOCK.read_text(encoding="utf-8"))
        raw["budget"]["renderer_credit_cap"] = 9_000
        changed.write_text(json.dumps(raw), encoding="utf-8")
        with patch.object(renderer, "PACKET_CREDIT_CAP", 9_000):
            with self.assertRaisesRegex(renderer.AuditionError, "packet_credit_cap"):
                renderer.load_locked_packet(changed)

    def test_apply_gates_account_opt_out_overage_and_dollar_caps(self):
        with self.assertRaisesRegex(renderer.AuditionError, "account_evidence_required"):
            renderer.run_renderer(
                lock_path=renderer.DEFAULT_LOCK,
                output_directory=self.output,
                apply=True,
                repository=renderer.REPOSITORY,
                now=NOW,
            )

        account_evidence(self.evidence, opt_out=False)
        with self.assertRaisesRegex(renderer.AuditionError, "training_opt_out"):
            self.apply(FakeTransport([]))

        account_evidence(self.evidence, balance=0)
        with self.assertRaisesRegex(renderer.AuditionError, "balance_insufficient"):
            self.apply(FakeTransport([]))

        account_evidence(
            self.evidence,
            balance=100_000,
            overage_enabled=True,
        )
        with self.assertRaisesRegex(renderer.AuditionError, "overage_rate_required"):
            self.apply(FakeTransport([]))

        # At $1.50/1k, normalized-only accounting would report $14.979 and
        # incorrectly pass. The locked 11,008-credit ceiling is $16.512.
        account_evidence(self.evidence, balance=100_000, overage_rate="1.50")
        with self.assertRaisesRegex(renderer.AuditionError, "lifetime_dollar_cap"):
            self.apply(FakeTransport([]))

    def test_overage_state_is_explicit_and_balance_evidence_must_be_current(self):
        payload = json.loads(self.evidence.read_text())
        payload.pop("overage")
        self.evidence.write_text(json.dumps(payload))
        with self.assertRaisesRegex(renderer.AuditionError, "overage_state_evidence"):
            renderer.load_account_evidence(self.evidence, now=NOW)

        account_evidence(
            self.evidence,
            balance_observed_at="2026-08-06T15:45:00Z",
        )
        with self.assertRaisesRegex(renderer.AuditionError, "credit_balance_evidence"):
            renderer.load_account_evidence(self.evidence, now=NOW)

        account_evidence(self.evidence, balance=9_985, overage_enabled=False)
        with self.assertRaisesRegex(renderer.AuditionError, "balance_insufficient"):
            self.apply(FakeTransport([]))

    def test_lifetime_credit_cap_counts_prior_committed_generations(self):
        packet = renderer.load_locked_packet(renderer.DEFAULT_LOCK)
        ledger = renderer._new_ledger(packet, NOW)
        ledger["credits_committed_total"] = 220_000
        renderer._atomic_json(self.output / "ledger.json", ledger)

        with self.assertRaisesRegex(renderer.AuditionError, "lifetime_credit_cap"):
            renderer.run_renderer(
                lock_path=renderer.DEFAULT_LOCK,
                output_directory=self.output,
                repository=renderer.REPOSITORY,
                now=NOW,
            )

    def test_429_and_returned_5xx_retry_sequentially_and_honor_retry_after(self):
        valid = wav_bytes()
        transport = FakeTransport([
            response(429, **{"Retry-After": "3"}),
            response(503),
            response(200, valid),
            response(200, valid),
            response(200, valid),
        ])
        waits = []

        result = renderer.run_renderer(
            lock_path=renderer.DEFAULT_LOCK,
            output_directory=self.output,
            account_evidence_path=self.evidence,
            apply=True,
            repository=renderer.REPOSITORY,
            transport=transport,
            encoder=FAKE_ENCODER,
            encoder_runner=fake_encode,
            sleep=waits.append,
            retry_jitter=lambda _base: 0.5,
            duration_validator=lambda _script, _probe: None,
            now=NOW,
            api_key="test-provider-secret",
        )

        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["credits_committed_after_run"], 11_008)
        self.assertEqual(waits, [3.0, 2.5])
        self.assertEqual(len(transport.calls), 5)
        for call in transport.calls:
            payload = json.loads(call["body"])
            self.assertNotIn("speed", payload)
            self.assertEqual(payload["generation_config"], {"speed": 0.98, "volume": 1.0})
            self.assertEqual(payload["model_id"], renderer.MODEL_SNAPSHOT)
            self.assertEqual(call["headers"]["Cartesia-Version"], renderer.API_VERSION)

    def test_ambiguous_connection_failure_is_never_retried_and_reserves_cost(self):
        transport = FakeTransport([TimeoutError("contains provider detail")])
        with self.assertRaisesRegex(renderer.AuditionError, "unknown_provider_state"):
            self.apply(transport)

        self.assertEqual(len(transport.calls), 1)
        ledger_text = (self.output / "ledger.json").read_text(encoding="utf-8")
        ledger = json.loads(ledger_text)
        self.assertEqual(ledger["credits_committed_total"], 3_135)
        self.assertEqual(
            ledger["entries"]["rf_story_02"]["state"],
            "unknown_provider_state",
        )
        self.assertNotIn("contains provider detail", ledger_text)
        self.assertNotIn("test-provider-secret", ledger_text)
        with self.assertRaisesRegex(renderer.AuditionError, "requires_reconciliation"):
            renderer.run_renderer(
                lock_path=renderer.DEFAULT_LOCK,
                output_directory=self.output,
                repository=renderer.REPOSITORY,
                now=NOW,
            )

    def test_process_kill_after_started_save_keeps_reservation_and_blocks_rerender(self):
        transport = FakeTransport([KeyboardInterrupt()])
        with self.assertRaises(KeyboardInterrupt):
            self.apply(transport)

        ledger = json.loads((self.output / "ledger.json").read_text())
        self.assertEqual(ledger["credits_committed_total"], 3_135)
        self.assertEqual(ledger["entries"]["rf_story_02"]["state"], "started")

        rerender_transport = FakeTransport([])
        with self.assertRaisesRegex(renderer.AuditionError, "cumulative_credit_cap"):
            self.apply(
                rerender_transport,
                rerender_ids=["rf_story_02"],
            )
        self.assertEqual(rerender_transport.calls, [])

    def test_provider_recovery_is_single_entry_ledger_bound_and_capped(self):
        ledger = renderer._new_ledger(renderer.load_locked_packet(renderer.DEFAULT_LOCK), NOW)
        first = renderer.load_locked_packet(renderer.DEFAULT_LOCK).scripts[0]
        ledger["credits_committed_total"] = first.billing_ceiling_credits
        ledger["entries"][first.entry_id] = {
            "entry_id": first.entry_id,
            "request_fingerprint": (
                renderer.KNOWN_STREAMING_HEADER_INCIDENT_FINGERPRINT
            ),
            "transcript_sha256": first.transcript_sha256,
            "payload_character_count": first.raw_character_count,
            "normalized_character_count": first.normalized_character_count,
            "reserved_credit_ceiling": first.billing_ceiling_credits,
            "state": "invalid_audio",
            "attempts": [{
                "number": 1,
                "state": "invalid_audio",
                "at": NOW.isoformat().replace("+00:00", "Z"),
                "http_status": 200,
            }],
        }
        renderer._atomic_json(self.output / "ledger.json", ledger)

        with self.assertRaisesRegex(renderer.AuditionError, "cumulative_credit_cap"):
            self.apply(FakeTransport([]), rerender_ids=[first.entry_id])

        result = renderer.run_renderer(
            lock_path=renderer.DEFAULT_LOCK,
            output_directory=self.output,
            account_evidence_path=self.evidence,
            apply=False,
            rerender_ids=[first.entry_id],
            approve_provider_recovery=True,
            repository=renderer.REPOSITORY,
            now=NOW,
        )
        self.assertTrue(result["limits"]["provider_recovery_authorized"])
        self.assertEqual(
            result["limits"]["provider_recovery_credit_cap"], 15_000
        )

        with self.assertRaisesRegex(renderer.AuditionError, "recovery_not_eligible"):
            renderer.run_renderer(
                lock_path=renderer.DEFAULT_LOCK,
                output_directory=self.output,
                account_evidence_path=self.evidence,
                apply=False,
                rerender_ids=[first.entry_id, "rf_story_03"],
                approve_provider_recovery=True,
                repository=renderer.REPOSITORY,
                now=NOW,
            )

    def test_definitive_client_error_is_not_retried_or_charged(self):
        transport = FakeTransport([response(400)])
        with self.assertRaisesRegex(renderer.AuditionError, "provider_rejected"):
            self.apply(transport)
        ledger = json.loads((self.output / "ledger.json").read_text())
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(ledger["credits_committed_total"], 0)

    def test_exact_resume_skips_provider_and_cumulative_packet_cap_blocks_rerender(self):
        valid = wav_bytes()
        first = FakeTransport([response(200, valid)] * 3)
        initial = self.apply(first)
        self.assertEqual(initial["credits_committed_after_run"], 11_008)

        resume_transport = FakeTransport([])
        resumed = self.apply(resume_transport)
        self.assertEqual(resumed["credits_projected_this_run"], 0)
        self.assertEqual(resume_transport.calls, [])

        # A previously authorized recovery may leave the historical ledger
        # above the ordinary packet cap. A verified zero-network resume must
        # remain available because it cannot increase exposure.
        ledger_path = self.output / "ledger.json"
        ledger = json.loads(ledger_path.read_text())
        ledger["credits_committed_total"] = 14_143
        renderer._atomic_json(ledger_path, ledger)
        audit_only = renderer.run_renderer(
            lock_path=renderer.DEFAULT_LOCK,
            output_directory=self.output,
            account_evidence_path=self.evidence,
            apply=False,
            repository=renderer.REPOSITORY,
            now=NOW,
        )
        self.assertEqual(audit_only["credits_projected_this_run"], 0)

        rerender_transport = FakeTransport([response(200, valid)])
        with self.assertRaisesRegex(renderer.AuditionError, "cumulative_credit_cap"):
            self.apply(
                rerender_transport,
                rerender_ids=["rf_story_02"],
            )
        self.assertEqual(rerender_transport.calls, [])

    def test_explicit_rerender_can_replace_a_definitive_no_charge_failure(self):
        with self.assertRaisesRegex(renderer.AuditionError, "provider_rejected"):
            self.apply(FakeTransport([response(400)]))

        transport = FakeTransport([response(200, wav_bytes())] * 3)
        result = self.apply(transport, rerender_ids=["rf_story_02"])
        self.assertEqual(result["credits_projected_this_run"], 11_008)
        self.assertEqual(result["credits_committed_after_run"], 11_008)
        self.assertEqual(len(transport.calls), 3)

    def test_resume_reconciles_credits_spent_since_same_balance_snapshot(self):
        account_evidence(self.evidence, balance=5_000, overage_rate="1.00")
        first_evidence = renderer.load_account_evidence(self.evidence, now=NOW)
        transport = FakeTransport([
            response(200, wav_bytes()),
            response(400),
        ])
        with self.assertRaisesRegex(renderer.AuditionError, "provider_rejected"):
            self.apply(transport)

        # Metadata timestamps change, but the immutable 5,000-credit balance
        # proof remains the same and must still account for story one.
        account_evidence(
            self.evidence,
            balance=5_000,
            overage_rate="1.00",
            plan_observed_at="2026-08-08T15:31:00Z",
            balance_observed_at="2026-08-08T15:46:00Z",
            balance_evidence_sha256="e" * 64,
        )
        second_evidence = renderer.load_account_evidence(self.evidence, now=NOW)
        self.assertNotEqual(first_evidence.file_sha256, second_evidence.file_sha256)
        self.assertNotEqual(
            first_evidence.balance_snapshot_id,
            second_evidence.balance_snapshot_id,
        )
        continuation = FakeTransport([
            response(200, wav_bytes()),
            response(200, wav_bytes()),
        ])
        result = self.apply(
            continuation,
            rerender_ids=["rf_story_03"],
        )
        self.assertEqual(
            result["credits_reconciled_against_current_balance_snapshot"],
            3_135,
        )
        self.assertEqual(result["credits_projected_this_run"], 7_873)
        self.assertEqual(result["overage_usd_projected_this_run"], "7.873")

    def test_resume_rejects_master_hash_or_probe_drift_without_rerender(self):
        valid = wav_bytes()
        self.apply(FakeTransport([response(200, valid)] * 3))
        master = self.output / "rf_story_02/master.wav"
        master.write_bytes(b"not a wave")

        with self.assertRaisesRegex(renderer.AuditionError, "explicit_rerender"):
            renderer.run_renderer(
                lock_path=renderer.DEFAULT_LOCK,
                output_directory=self.output,
                repository=renderer.REPOSITORY,
                now=NOW,
            )

    def test_exact_completed_streaming_recovery_fingerprints_migrate_without_network(self):
        self.apply(FakeTransport([response(200, wav_bytes())] * 3))
        ledger_path = self.output / "ledger.json"
        ledger = json.loads(ledger_path.read_text())
        for entry_id, fingerprint in (
            renderer.KNOWN_COMPLETED_STREAMING_RECOVERY_FINGERPRINTS.items()
        ):
            ledger["entries"][entry_id]["request_fingerprint"] = fingerprint
        ledger["credits_committed_total"] = 14_143
        renderer._atomic_json(ledger_path, ledger)

        transport = FakeTransport([])
        result = renderer.run_renderer(
            lock_path=renderer.DEFAULT_LOCK,
            output_directory=self.output,
            account_evidence_path=self.evidence,
            apply=True,
            repository=renderer.REPOSITORY,
            transport=transport,
            encoder=FAKE_ENCODER,
            encoder_runner=fake_encode,
            duration_validator=lambda _script, _probe: None,
            now=NOW,
            api_key="test-provider-secret",
        )
        self.assertEqual(result["credits_projected_this_run"], 0)
        self.assertEqual(transport.calls, [])

    def test_wav_validation_is_strict_riff_mono_pcm_s16le_44100(self):
        probe = renderer.probe_wav_bytes(wav_bytes())
        self.assertEqual(probe.channels, 1)
        self.assertEqual(probe.sample_width_bytes, 2)
        self.assertEqual(probe.sample_rate_hz, 44_100)
        self.assertGreater(probe.duration_s, 0)

        with self.assertRaisesRegex(renderer.AuditionError, "not_riff_wave"):
            renderer.probe_wav_bytes(b"audio")
        with self.assertRaisesRegex(renderer.AuditionError, "profile_mismatch"):
            renderer.probe_wav_bytes(wav_bytes(channels=2))
        with self.assertRaisesRegex(renderer.AuditionError, "profile_mismatch"):
            renderer.probe_wav_bytes(wav_bytes(sample_rate=48_000))

    def test_streamed_wav_unknown_lengths_are_canonicalized_fail_closed(self):
        canonical = wav_bytes(frames=4_410)
        streamed = bytearray(canonical)
        streamed[4:8] = (0xFFFFFFFF).to_bytes(4, "little")
        data_offset = streamed.index(b"data")
        streamed[data_offset + 4 : data_offset + 8] = (0xFFFFFFFF).to_bytes(
            4, "little"
        )

        repaired, changed = renderer.canonicalize_streamed_wav(bytes(streamed))
        self.assertTrue(changed)
        self.assertEqual(repaired, canonical)
        self.assertEqual(renderer.probe_wav_bytes(repaired).duration_s, 0.1)

        malformed = bytearray(canonical)
        malformed[4:8] = (123).to_bytes(4, "little")
        with self.assertRaisesRegex(renderer.AuditionError, "wav_invalid"):
            renderer.canonicalize_streamed_wav(bytes(malformed))

    def test_structurally_valid_truncated_story_audio_never_completes(self):
        short_but_valid = wav_bytes()
        self.assertGreater(renderer.probe_wav_bytes(short_but_valid).duration_s, 0)
        with self.assertRaisesRegex(renderer.AuditionError, "duration_implausible"):
            renderer.run_renderer(
                lock_path=renderer.DEFAULT_LOCK,
                output_directory=self.output,
                account_evidence_path=self.evidence,
                apply=True,
                repository=renderer.REPOSITORY,
                transport=FakeTransport([response(200, short_but_valid)]),
                encoder=FAKE_ENCODER,
                encoder_runner=fake_encode,
                sleep=lambda _seconds: None,
                retry_jitter=lambda _base: 0.0,
                now=NOW,
                api_key="test-provider-secret",
            )
        ledger = json.loads((self.output / "ledger.json").read_text())
        self.assertEqual(ledger["entries"]["rf_story_02"]["state"], "invalid_audio")
        self.assertEqual(ledger["credits_committed_total"], 3_135)
        self.assertFalse((self.output / "rf_story_02/provenance.json").exists())

    def test_encoder_command_and_provenance_are_pinned_and_shell_free(self):
        command = renderer.build_encoder_command(
            "/verified/ffmpeg",
            Path("master.wav"),
            Path("delivery.mp3"),
            96,
        )
        self.assertEqual(command[0], "/verified/ffmpeg")
        self.assertIn("libmp3lame", command)
        self.assertIn("96k", command)
        self.assertIn("+bitexact", command)
        self.assertEqual(command[-2:], ["mp3", "delivery.mp3"])
        self.assertNotIn("shell=True", command)

        self.apply(FakeTransport([response(200, wav_bytes())] * 3))
        provenance = json.loads(
            (self.output / "rf_story_02/provenance.json").read_text()
        )
        self.assertEqual(provenance["encoder"]["package_version"], "0.6.0")
        self.assertEqual(provenance["encoder"]["package_sha256"], SHA_A)
        self.assertEqual(provenance["encoder"]["binary_sha256"], SHA_B)
        self.assertEqual(set(provenance["derivatives"]), {"64", "96", "128"})
        self.assertEqual(provenance["model_snapshot"], renderer.MODEL_SNAPSHOT)

    def test_sensitive_account_fields_are_rejected_and_secrets_never_persist(self):
        account_evidence(
            self.evidence,
            extra={"email": "private@example.com", "api_key": "should-not-exist"},
        )
        with self.assertRaisesRegex(renderer.AuditionError, "sensitive_fields"):
            renderer.load_account_evidence(self.evidence, now=NOW)

        account_evidence(self.evidence)
        secret = "private-cartesia-key-never-persist"
        renderer.run_renderer(
            lock_path=renderer.DEFAULT_LOCK,
            output_directory=self.output,
            account_evidence_path=self.evidence,
            apply=True,
            repository=renderer.REPOSITORY,
            transport=FakeTransport([response(200, wav_bytes())] * 3),
            encoder=FAKE_ENCODER,
            encoder_runner=fake_encode,
            sleep=lambda _seconds: None,
            duration_validator=lambda _script, _probe: None,
            now=NOW,
            api_key=secret,
        )
        persisted = "\n".join(
            path.read_text(encoding="utf-8")
            for path in self.output.rglob("*.json")
        )
        self.assertNotIn(secret, persisted)
        self.assertNotIn("private@example.com", persisted)


if __name__ == "__main__":
    unittest.main()
