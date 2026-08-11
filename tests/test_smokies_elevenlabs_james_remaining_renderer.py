from __future__ import annotations

import hashlib
import http.server
import io
import json
import threading
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from scripts import build_smokies_elevenlabs_james_postpurchase_preflight as preflight
from scripts import render_smokies_elevenlabs_james_remaining as renderer


NOW = datetime(2026, 8, 11, 6, 0, tzinfo=timezone.utc)
KEY = b"test-ephemeral-key-material-0123456789abcdef"


def _json_response(value: dict, status: int = 200) -> renderer.ProviderResponse:
    return renderer.ProviderResponse(
        status,
        {"content-type": "application/json"},
        json.dumps(value).encode("utf-8"),
    )


def _voice() -> dict:
    return {
        "voice_id": renderer.VOICE_ID,
        "name": renderer.VOICE_NAME,
        "high_quality_base_model_ids": [renderer.MODEL_ID],
        "sharing": {
            "original_voice_id": renderer.VOICE_ID,
            "status": "copied",
            "rate": 1,
            "notice_period": 730,
            "disable_at_unix": 0,
        },
    }


class FakeTransport:
    def __init__(
        self,
        responses: list[renderer.ProviderResponse | BaseException] | None = None,
        *,
        remaining: int = 171_490,
    ) -> None:
        self.responses = list(responses or [])
        self.remaining = remaining
        self.get_calls: list[dict] = []
        self.post_calls: list[dict] = []
        self.probes: dict[bytes, renderer.Mp3Probe] = {}

    def get(self, url, *, headers, timeout):
        self.get_calls.append(
            {"url": url, "headers": dict(headers), "timeout": timeout}
        )
        if url.endswith("/settings"):
            return _json_response(dict(renderer.VOICE_SETTINGS))
        if url.endswith("/user/subscription"):
            return _json_response(
                {
                    "tier": "creator",
                    "character_count": 186_000 - self.remaining,
                    "character_limit": 186_000,
                }
            )
        return _json_response(_voice())

    def post(self, url, *, headers, body, timeout):
        parsed = json.loads(body)
        self.post_calls.append(
            {
                "url": url,
                "headers": dict(headers),
                "body": parsed,
                "timeout": timeout,
            }
        )
        if self.responses:
            response = self.responses.pop(0)
            if isinstance(response, BaseException):
                raise response
            return response
        marker = b"audio-" + hashlib.sha256(body).digest()[:16]
        words = len(parsed["text"].split())
        duration = words / 150 * 60
        self.probes[marker] = renderer.Mp3Probe(
            byte_count=len(marker),
            sha256=hashlib.sha256(marker).hexdigest(),
            sample_rate_hz=44_100,
            bitrate_kbps=128,
            frame_count=max(10, round(duration * 44_100 / 1152)),
            duration_s=duration,
        )
        return renderer.ProviderResponse(
            200,
            {
                "content-type": "audio/mpeg",
                "character-cost": str(len(parsed["text"])),
                "request-id": f"request-{len(self.post_calls)}",
                "x-trace-id": f"trace-{len(self.post_calls)}",
            },
            marker,
        )

    def probe(self, content: bytes) -> renderer.Mp3Probe:
        if content not in self.probes:
            raise renderer.NarrationError("provider_audio_invalid")
        return self.probes[content]


def _sources() -> renderer.SourceBindings:
    approval_sha, continuation_sha, preflight_sha = renderer._validate_owner_sources()
    return renderer.SourceBindings(
        checkpoint2_approval_sha256=approval_sha,
        continuation_approval_sha256=continuation_sha,
        green_preflight_sha256=preflight_sha,
        renderer_audit_sha256="a" * 64,
        operator_sha256=renderer._sha256_file(renderer.OPERATOR_PATH),
        operator_test_sha256=renderer._sha256_file(renderer.OPERATOR_TEST_PATH),
        dependency_sha256=renderer._dependency_hashes(),
    )


def _audit_value() -> dict:
    approval_sha, continuation_sha, preflight_sha = renderer._validate_owner_sources()
    return {
        "schema_version": 1,
        "audit_id": "smokies_james_remaining_renderer_test_audit_v1",
        "audited_at": renderer._iso(NOW),
        "renderer_contract": renderer.RENDERER_CONTRACT,
        "renderer_sha256": renderer._sha256_file(Path(renderer.__file__)),
        "test_sha256": renderer._sha256_file(renderer.TEST_PATH),
        "operator_sha256": renderer._sha256_file(renderer.OPERATOR_PATH),
        "operator_test_sha256": renderer._sha256_file(
            renderer.OPERATOR_TEST_PATH
        ),
        "dependency_sha256": renderer._dependency_hashes(),
        "green_preflight_sha256": preflight_sha,
        "checkpoint2_owner_approval_sha256": approval_sha,
        "postpurchase_continuation_approval_sha256": continuation_sha,
        "independent_audit_passed": True,
        "p0_findings": 0,
        "p1_findings": 0,
        "dry_run_default_verified": True,
        "provider_calls_performed_by_audit": 0,
        "author_source_files_edited_by_auditor": 0,
        "audit_artifact_created_by_auditor": True,
    }


def _root(tmp_path: Path) -> Path:
    parent = tmp_path / "external-render-parent"
    parent.mkdir(mode=0o700, exist_ok=True)
    parent.chmod(0o700)
    return parent / renderer.OUTPUT_ROOT_BASENAME


def _evidence_value(
    *,
    packet: renderer.ChapterPacket,
    root: Path,
    sources: renderer.SourceBindings,
    ledger_head: str = "0" * 64,
    observed: datetime = NOW,
    available: int = 171_490,
    prior_session: dict | None = None,
    key: bytes = KEY,
    key_id_material: bytes = b"key-id",
    already_committed: int = 0,
    committed_since_prior_session: int = 0,
    observed_total_usage_usd: str = "2.64",
    observed_billable_request_count: int = 14,
    completed_request_count: int = 0,
    completed_requests_since_prior_session: int = 0,
) -> dict:
    key_sha = hashlib.sha256(key).hexdigest()
    key_id_sha = hashlib.sha256(key_id_material).hexdigest()
    key_preview_sha = hashlib.sha256(key[-4:]).hexdigest()
    key_created_at_derived = observed - timedelta(minutes=1)
    key_expires_at = key_created_at_derived + timedelta(
        seconds=renderer.KEY_LIFETIME_SECONDS
    )
    key_session_number = (
        1
        if prior_session is None
        else int(prior_session["key_session_number"]) + 1
    )
    provider_key_name_sha = hashlib.sha256(
        renderer._provider_key_name(
            packet.chapter_id, key_session_number
        ).encode("ascii")
    ).hexdigest()
    expected_key_limit = (
        packet.key_credit_quota
        if prior_session is None
        else packet.renderer_character_cap - already_committed
    )
    if prior_session is None:
        continuation = None
    else:
        prior_usage = Decimal(prior_session["observed_total_usage_usd"])
        ending_usage = Decimal(observed_total_usage_usd)
        usage_delta = ending_usage - prior_usage
        ledger_usage = renderer._unrounded_usage_cost(
            committed_since_prior_session
        )
        continuation = {
            "prior_execution_evidence_sha256": prior_session[
                "evidence_sha256"
            ],
            "continuation_mode": "recovery_only_replacement_key",
            "prior_key_id_sha256": prior_session["key_id_sha256"],
            "prior_key_deleted": True,
            "prior_key_deletion_verified": True,
            "prior_key_deleted_at": renderer._iso(
                observed - timedelta(minutes=1, seconds=30)
            ),
            "replacement_key_creation_initiated_at": renderer._iso(
                observed - timedelta(minutes=1, seconds=15)
            ),
            "replacement_key_creation_initiated_after_prior_deletion_verified": (
                True
            ),
            "replacement_key_creation_action_source": (
                "authenticated_browser_action_sequence"
            ),
            "partial_usage_starting_provider_credits": prior_session[
                "available_credits"
            ],
            "partial_usage_ending_provider_credits": available,
            "partial_usage_ledger_credits": committed_since_prior_session,
            "partial_usage_reconciliation_passed": True,
            "partial_usage_starting_total_usage_usd": f"{prior_usage:.2f}",
            "partial_usage_ending_total_usage_usd": f"{ending_usage:.2f}",
            "partial_usage_observed_usd": f"{usage_delta:.2f}",
            "partial_usage_ledger_usd_unrounded": f"{ledger_usage:.4f}",
            "partial_usage_dollar_tolerance_usd": "0.01",
            "partial_usage_dollar_reconciliation_passed": True,
            "partial_usage_starting_billable_request_count": prior_session[
                "observed_billable_request_count"
            ],
            "partial_usage_ending_billable_request_count": (
                observed_billable_request_count
            ),
            "partial_usage_billable_request_count": (
                completed_requests_since_prior_session
            ),
            "partial_usage_ledger_request_count": (
                completed_requests_since_prior_session
            ),
            "partial_usage_request_reconciliation_passed": True,
            "ledger_character_cost_total": already_committed,
            "residual_key_credit_limit": expected_key_limit,
            "accepted_plus_residual_cap": (
                already_committed + expected_key_limit
            ),
            "unresolved_provider_ambiguity": False,
            "recovery_only_within_existing_owner_authority": True,
        }
    return {
        "schema_version": 1,
        "evidence_id": f"smokies_execution_{('b' * 64)[:32]}",
        "source": "authenticated_browser",
        "source_observation_sha256": "b" * 64,
        "observed_at": renderer._iso(observed),
        "chapter_id": packet.chapter_id,
        "account": {
            "plan": "creator",
            "commercial_use": True,
            "available_credits": available,
            "required_remaining_renderer_cap": renderer._remaining_renderer_cap(
                packet.chapter_id
            )
            - already_committed,
            "observed_total_usage_usd": observed_total_usage_usd,
            "observed_billable_request_count": observed_billable_request_count,
            "prepaid_top_up_balance_usd": "10.00",
            "auto_top_up_enabled": False,
            "paid_usage_overage_authorized": False,
            "account_identity_recorded": False,
            "workspace_identity_recorded": False,
        },
        "provider_usage_baseline": {
            "billable_request_count": 14,
            "total_usage_usd": "2.64",
            "used_provider_credits": 14_510,
            "remaining_provider_credits": 171_490,
            "total_provider_credits": 186_000,
        },
        "terms": {
            "jurisdiction": "non_eea",
            "primary_terms_id": preflight.POLICY_TUPLE["primary_terms"][
                "terms_id"
            ],
            "voice_library_addendum_id": preflight.POLICY_TUPLE[
                "voice_library_addendum"
            ]["terms_id"],
            "prohibited_use_policy_id": preflight.POLICY_TUPLE[
                "prohibited_use_policy"
            ]["terms_id"],
            "beta_services_addendum_id": preflight.POLICY_TUPLE[
                "beta_services_addendum"
            ]["terms_id"],
            "terms_changed": False,
        },
        "voice_contract": {
            "voice_id": renderer.VOICE_ID,
            "voice_name": renderer.VOICE_NAME,
            "model_id": renderer.MODEL_ID,
            "language_code": "en",
            "output_format_id": renderer.OUTPUT_FORMAT_ID,
            "voice_settings": renderer.VOICE_SETTINGS,
            "explicit_request_override": True,
            "beta_services_used": False,
        },
        "key_policy": {
            "key_id_sha256": key_id_sha,
            "key_material_sha256": key_sha,
            "key_preview_sha256": key_preview_sha,
            "provider_key_name_sha256": provider_key_name_sha,
            "key_session_number": key_session_number,
            "provider_key_matching_row_count": 1,
            "provider_key_row_unique": True,
            "key_credit_limit": expected_key_limit,
            "key_permissions": list(renderer.EXPECTED_KEY_PERMISSIONS),
            "restrict_key_enabled": True,
            "auto_disable_if_leaked": True,
            "other_chapter_keys_active": False,
            "provider_key_expires_at_unix": int(key_expires_at.timestamp()),
            "requested_ttl_seconds": renderer.KEY_LIFETIME_SECONDS,
            "key_expires_at": renderer._iso(key_expires_at),
            "key_created_at_derived": renderer._iso(key_created_at_derived),
            "key_created_at_directly_observed": False,
            "key_created_at_derivation": (
                "provider_get_expires_at_unix_minus_official_ui_"
                "requested_ttl_seconds"
            ),
            "expiry_directly_observed": True,
            "provider_key_id_source": (
                "authenticated_get_v1_user_api_keys_row_xi_api_key"
            ),
            "provider_key_expiry_source": (
                "authenticated_get_v1_user_api_keys_row_expires_at_unix"
            ),
            "provider_key_name_source": (
                "authenticated_get_v1_user_api_keys_name"
            ),
            "provider_key_preview_source": (
                "authenticated_get_v1_user_api_keys_xi_api_key_preview_"
                "last_4_secret_chars"
            ),
            "post_create_response_inspected": False,
            "key_delivery": (
                "secure_piped_stdin_external_transfer_not_attested_by_operator"
            ),
            "key_identity_capture": (
                "authenticated_get_key_row_name_id_preview_expiry_and_operator_"
                "memory_material_sha256"
            ),
        },
        "continuation": continuation,
        "authorization": {
            "owner_render_and_spend_authorized": True,
            "postpurchase_continuation_authorized": True,
            "independent_renderer_audit_passed": True,
            "chapter_key_created": True,
            "provider_preflight_authorized": True,
            "provider_request_authorized": True,
            "provider_credit_spend_authorized": True,
            "paid_usage_overage_authorized": False,
            "rerender_authorized": False,
        },
        "bindings": {
            "renderer_sha256": renderer._sha256_file(Path(renderer.__file__)),
            "renderer_audit_sha256": sources.renderer_audit_sha256,
            "operator_sha256": sources.operator_sha256,
            "operator_test_sha256": sources.operator_test_sha256,
            "dependency_sha256": dict(sources.dependency_sha256),
            "green_preflight_sha256": sources.green_preflight_sha256,
            "checkpoint2_owner_approval_sha256": (
                sources.checkpoint2_approval_sha256
            ),
            "postpurchase_continuation_approval_sha256": (
                sources.continuation_approval_sha256
            ),
            "chapter_lock_sha256": packet.lock_sha256,
            "output_root_sha256": renderer._output_root_hash(root),
            "ledger_event_chain_head": ledger_head,
        },
        "effects_before_apply": {
            "provider_tts_requests_sent_this_execution": 0,
            "provider_credits_spent_this_execution": 0,
            "chapter_audio_files_created_this_execution": 0,
        },
    }


def _write_evidence(tmp_path: Path, value: dict, name: str = "evidence.json") -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(value), encoding="utf-8")
    path.chmod(0o600)
    return path


def _run(
    tmp_path: Path,
    monkeypatch,
    transport: FakeTransport,
    *,
    key: bytes = KEY,
    evidence_value: dict | None = None,
    evidence_name: str = "evidence.json",
):
    sources = _sources()
    monkeypatch.setattr(renderer, "load_audit_evidence", lambda: sources)
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = _root(tmp_path)
    value = evidence_value or _evidence_value(
        packet=packet, root=root, sources=sources
    )
    evidence = _write_evidence(tmp_path, value, evidence_name)
    result = renderer.run_renderer(
        chapter_id=packet.chapter_id,
        output_root=root,
        apply=True,
        verified_output_format=renderer.OUTPUT_FORMAT_ID,
        execution_evidence_path=evidence,
        key_reader=lambda: bytearray(key),
        transport_factory=lambda: transport,
        probe_audio=transport.probe,
        sleep=lambda _seconds: None,
        now=lambda: NOW,
        _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
    )
    return result, root, packet, sources


def test_postpurchase_preflight_is_deterministic_and_binds_owner_overlay_usage() -> None:
    result = preflight.build()
    assert preflight.DESTINATION.read_text(encoding="utf-8") == preflight.serialize(
        result
    )
    assert result["provider_usage_baseline"] == {
        "billable_request_count": 14,
        "observed_at": "2026-08-11T05:13:04.553Z",
        "total_usage_usd": "2.64",
        "usage_surface": "signed_in_usage_analytics_ui",
    }
    binding = result["source_bindings"][
        "postpurchase_render_continuation_approval"
    ]
    assert binding["sha256"] == (
        "c7edea54c4facd3d9cc336217577bcec38b78928041e163c92b54290141f029d"
    )
    assert "separate_apply_authorization" not in json.dumps(result)


def test_dry_run_is_exact_network_key_and_write_free(tmp_path: Path) -> None:
    before = set(tmp_path.iterdir())
    result = renderer.run_renderer(
        key_reader=lambda: (_ for _ in ()).throw(AssertionError("key read")),
        transport_factory=lambda: (_ for _ in ()).throw(AssertionError("network")),
    )
    assert result["provider_request_count"] == 72
    assert result["reserved_provider_credit_ceiling"] == 138_190
    assert result["renderer_character_caps"] == 138_300
    assert result["one_day_key_credit_quotas"] == 145_000
    assert result["language_code"] == "en"
    assert result["network_used"] is False
    assert result["key_read"] is False
    assert set(tmp_path.iterdir()) == before


def test_renderer_dry_run_truthfully_reports_missing_invalid_and_valid_audit(
    tmp_path: Path, monkeypatch
) -> None:
    real_loader = renderer.load_audit_evidence
    missing = tmp_path / "missing-audit.json"
    monkeypatch.setattr(
        renderer, "load_audit_evidence", lambda: real_loader(missing)
    )
    missing_result = renderer.run_renderer()
    assert missing_result["independent_audit"] == {
        "status": "missing",
        "valid": False,
        "renderer_audit_sha256": None,
    }
    assert (
        "independent_renderer_and_operator_audit_record_required"
        in missing_result["live_apply_blockers"]
    )

    invalid = _write_evidence(tmp_path, {}, "invalid-audit.json")
    monkeypatch.setattr(
        renderer, "load_audit_evidence", lambda: real_loader(invalid)
    )
    invalid_result = renderer.run_renderer()
    assert invalid_result["independent_audit"]["status"] == "invalid_or_stale"
    assert invalid_result["independent_audit"]["valid"] is False

    valid = _write_evidence(tmp_path, _audit_value(), "valid-audit.json")
    monkeypatch.setattr(
        renderer, "load_audit_evidence", lambda: real_loader(valid)
    )
    valid_result = renderer.run_renderer()
    assert valid_result["independent_audit"] == {
        "status": "valid",
        "valid": True,
        "renderer_audit_sha256": renderer._sha256_file(valid),
    }
    assert (
        "independent_renderer_and_operator_audit_record_required"
        not in valid_result["live_apply_blockers"]
    )
    assert valid_result["status"] == (
        "dry_run_ready_external_observation_and_key_required"
    )
    assert valid_result["key_read"] is False
    assert valid_result["network_used"] is False
    assert valid_result["files_written"] == 0


@pytest.mark.parametrize(
    "path_factory",
    [
        lambda tmp: tmp / "wrong-name",
        lambda _tmp: Path("/tmp") / renderer.OUTPUT_ROOT_BASENAME,
        lambda _tmp: renderer.REPOSITORY / renderer.OUTPUT_ROOT_BASENAME,
    ],
)
def test_output_root_guard_precedes_key_and_network(
    tmp_path: Path, monkeypatch, path_factory
) -> None:
    packet = renderer.load_chapter_packet("foothills_parkway")
    with pytest.raises(renderer.NarrationError):
        renderer.run_renderer(
            chapter_id=packet.chapter_id,
            output_root=path_factory(tmp_path),
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
            execution_evidence_path=tmp_path / "missing.json",
            key_reader=lambda: (_ for _ in ()).throw(AssertionError("key read")),
            transport_factory=lambda: (_ for _ in ()).throw(
                AssertionError("network")
            ),
            _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
        )


def test_apply_without_audit_stops_before_key_and_network(
    tmp_path: Path, monkeypatch
) -> None:
    real_loader = renderer.load_audit_evidence
    missing_audit = tmp_path / "explicitly-absent-renderer-audit.json"
    monkeypatch.setattr(
        renderer,
        "load_audit_evidence",
        lambda: real_loader(missing_audit),
    )
    root = _root(tmp_path)
    packet = renderer.load_chapter_packet("foothills_parkway")
    with pytest.raises(renderer.NarrationError, match="renderer_audit_unreadable"):
        renderer.run_renderer(
            chapter_id=packet.chapter_id,
            output_root=root,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
            execution_evidence_path=tmp_path / "missing.json",
            key_reader=lambda: (_ for _ in ()).throw(AssertionError("key read")),
            transport_factory=lambda: (_ for _ in ()).throw(
                AssertionError("network")
            ),
            _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
        )


def test_full_chapter_success_has_exact_payload_journal_and_files(
    tmp_path: Path, monkeypatch
) -> None:
    transport = FakeTransport()
    result, root, packet, _sources_value = _run(
        tmp_path, monkeypatch, transport
    )
    assert result["status"] == "render_complete_pending_key_deletion_closeout"
    assert result["provider_request_count"] == 16
    assert len(result["rendered"]) == 16
    assert len(transport.post_calls) == 16
    assert len(transport.get_calls) == 3
    for call, entry in zip(transport.post_calls, packet.requests, strict=True):
        assert call["body"] == {
            "text": entry.transcript,
            "model_id": renderer.MODEL_ID,
            "language_code": "en",
            "voice_settings": renderer.VOICE_SETTINGS,
        }
        assert call["url"].endswith(
            f"/{renderer.VOICE_ID}?output_format={renderer.OUTPUT_FORMAT_ID}"
        )
    chapter = root / packet.chapter_id
    events = renderer._read_events(chapter / renderer.EVENTS_NAME, root=root)
    assert sum(event["event_type"] == "audio_accepted" for event in events) == 16
    assert sum(event["event_type"] == "request_completed" for event in events) == 16
    ledger = json.loads((chapter / renderer.LEDGER_NAME).read_text())
    assert ledger["status"] == "render_complete_pending_key_deletion_closeout"
    assert all(item["state"] == "completed" for item in ledger["items"].values())
    assert len(list(chapter.glob("*.mp3"))) == 16
    assert len([path for path in chapter.glob("*.json") if path.name != renderer.LEDGER_NAME]) == 16
    persisted = "\n".join(path.read_text(errors="ignore") for path in chapter.iterdir())
    assert KEY.decode() not in persisted


def test_completed_rerun_reads_no_key_and_sends_no_provider_request(
    tmp_path: Path, monkeypatch
) -> None:
    transport = FakeTransport()
    _result, root, packet, sources = _run(tmp_path, monkeypatch, transport)
    monkeypatch.setattr(renderer, "load_audit_evidence", lambda: sources)
    second = renderer.run_renderer(
        chapter_id=packet.chapter_id,
        output_root=root,
        apply=True,
        verified_output_format=renderer.OUTPUT_FORMAT_ID,
        execution_evidence_path=tmp_path / "missing.json",
        key_reader=lambda: (_ for _ in ()).throw(AssertionError("key read")),
        transport_factory=lambda: (_ for _ in ()).throw(AssertionError("network")),
        probe_audio=transport.probe,
        now=lambda: NOW,
        _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
    )
    assert second["network_used"] is False
    assert second["key_read"] is False


def test_journal_and_snapshot_tamper_fail_before_key_network(
    tmp_path: Path, monkeypatch
) -> None:
    transport = FakeTransport()
    _result, root, packet, sources = _run(tmp_path, monkeypatch, transport)
    monkeypatch.setattr(renderer, "load_audit_evidence", lambda: sources)
    chapter = root / packet.chapter_id
    events_path = chapter / renderer.EVENTS_NAME
    raw = events_path.read_text()
    events_path.write_text(raw.replace("audio_accepted", "audio_rejected", 1))
    with pytest.raises(renderer.NarrationError, match="render_event_hash_invalid"):
        renderer.run_renderer(
            chapter_id=packet.chapter_id,
            output_root=root,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
            execution_evidence_path=tmp_path / "missing.json",
            key_reader=lambda: (_ for _ in ()).throw(AssertionError("key read")),
            transport_factory=lambda: (_ for _ in ()).throw(
                AssertionError("network")
            ),
            probe_audio=transport.probe,
            _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
        )


def test_snapshot_drift_is_rebuilt_from_authoritative_journal(
    tmp_path: Path, monkeypatch
) -> None:
    transport = FakeTransport()
    _result, root, packet, sources = _run(tmp_path, monkeypatch, transport)
    monkeypatch.setattr(renderer, "load_audit_evidence", lambda: sources)
    ledger_path = root / packet.chapter_id / renderer.LEDGER_NAME
    ledger = json.loads(ledger_path.read_text())
    ledger["api_key"] = "not-allowed"
    ledger_path.write_text(json.dumps(ledger))
    result = renderer.run_renderer(
        chapter_id=packet.chapter_id,
        output_root=root,
        apply=True,
        verified_output_format=renderer.OUTPUT_FORMAT_ID,
        execution_evidence_path=tmp_path / "missing.json",
        key_reader=lambda: (_ for _ in ()).throw(AssertionError("key read")),
        transport_factory=lambda: (_ for _ in ()).throw(AssertionError("network")),
        probe_audio=transport.probe,
        _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
    )
    assert result["network_used"] is False
    assert "api_key" not in json.loads(ledger_path.read_text())


def test_only_explicit_zero_cost_429_is_retried(tmp_path: Path, monkeypatch) -> None:
    safe = renderer.ProviderResponse(
        429,
        {"content-type": "application/json", "character-cost": "0", "retry-after": "0"},
        b"rate-limited",
    )
    transport = FakeTransport([safe])
    result, _root_path, _packet, _ = _run(tmp_path, monkeypatch, transport)
    assert result["safe_uncharged_429_retries"] == 1
    assert len(transport.post_calls) == 17


@pytest.mark.parametrize(
    "headers",
    [
        {"content-type": "application/json", "retry-after": "0"},
        {"content-type": "application/json", "character-cost": "1", "retry-after": "0"},
    ],
)
def test_ambiguous_429_never_retries(
    tmp_path: Path, monkeypatch, headers
) -> None:
    transport = FakeTransport([renderer.ProviderResponse(429, headers, b"rate")])
    with pytest.raises(renderer.NarrationError, match="provider_429_billing_ambiguous"):
        _run(tmp_path, monkeypatch, transport)
    assert len(transport.post_calls) == 1


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (TimeoutError("ambiguous"), "provider_transport_ambiguous"),
        (
            renderer.ProviderResponse(503, {"content-type": "application/json"}, b"down"),
            "provider_server_response_ambiguous",
        ),
        (
            renderer.ProviderResponse(
                200,
                {"content-type": "audio/mpeg", "character-cost": "100"},
                b"not-valid-audio",
            ),
            "provider_audio_or_cost_ambiguous",
        ),
    ],
)
def test_timeout_5xx_and_invalid_audio_stop_without_retry(
    tmp_path: Path, monkeypatch, response, message
) -> None:
    transport = FakeTransport([response])
    with pytest.raises(renderer.NarrationError, match=message):
        _run(tmp_path, monkeypatch, transport)
    assert len(transport.post_calls) == 1


def test_stdin_key_hash_mismatch_precedes_provider_network(
    tmp_path: Path, monkeypatch
) -> None:
    transport = FakeTransport()
    with pytest.raises(renderer.NarrationError, match="stdin_key_material_evidence_mismatch"):
        _run(tmp_path, monkeypatch, transport, key=b"z" * 40)
    assert not transport.get_calls
    assert not transport.post_calls


def test_recovery_only_replacement_key_can_resume_before_any_tts(
    tmp_path: Path, monkeypatch
) -> None:
    first_transport = FakeTransport(remaining=171_489)
    with pytest.raises(renderer.NarrationError, match="provider_subscription_evidence_mismatch"):
        _result = _run(tmp_path, monkeypatch, first_transport)
    assert not first_transport.post_calls
    root = _root(tmp_path)
    packet = renderer.load_chapter_packet("foothills_parkway")
    sources = _sources()
    events, state = renderer._load_state(
        root / packet.chapter_id,
        packet=packet,
        sources=sources,
        root=root,
    )
    assert len(state["sessions"]) == 1
    second_value = _evidence_value(
        packet=packet,
        root=root,
        sources=sources,
        ledger_head=state["event_head_sha256"],
        observed=NOW + timedelta(minutes=2),
        prior_session=state["sessions"][-1],
        key=b"replacement-ephemeral-key-material-abcdef0123456789",
        key_id_material=b"replacement-key-id",
    )
    second_transport = FakeTransport()
    result, _root_path, _packet, _ = _run(
        tmp_path,
        monkeypatch,
        second_transport,
        evidence_value=second_value,
        evidence_name="continuation.json",
        key=b"replacement-ephemeral-key-material-abcdef0123456789",
    )
    assert result["status"] == "render_complete_pending_key_deletion_closeout"
    assert len(second_transport.post_calls) == 16


def _closeout_value(
    chapter: Path,
    packet: renderer.ChapterPacket,
    state: dict,
) -> dict:
    committed = sum(
        item["accepted"]["character_cost"] for item in state["items"].values()
    )
    _rows, inventory_sha = renderer._audio_inventory(packet, state)
    chapter_usd = renderer._projected_cost(committed)
    exact_usage_usd = renderer._unrounded_usage_cost(committed)
    return {
        "schema_version": 2,
        "closeout_id": f"smokies_closeout_{('c' * 64)[:32]}",
        "source": "authenticated_provider_usage_and_key_management_ui",
        "source_observation_sha256": "c" * 64,
        "observed_at": renderer._iso(NOW),
        "renderer_contract": renderer.RENDERER_CONTRACT,
        "chapter_id": packet.chapter_id,
        "render_event_count": state["event_count"],
        "render_event_head_sha256": state["event_head_sha256"],
        "render_ledger_sha256": renderer._sha256_file(chapter / renderer.LEDGER_NAME),
        "audio_inventory_sha256": inventory_sha,
        "prior_closeout_sha256": None,
        "key_id_sha256": state["sessions"][-1]["key_id_sha256"],
        "key_material_sha256": state["sessions"][-1]["key_material_sha256"],
        "key_deleted": True,
        "key_deletion_verified": True,
        "no_other_active_render_keys": True,
        "starting_provider_credits": 171_490,
        "ending_provider_credits": 171_490 - committed,
        "ledger_character_cost_total": committed,
        "provider_reported_usage_credits": committed,
        "starting_billable_request_count": 14,
        "ending_billable_request_count": 30,
        "provider_reported_request_count": 16,
        "starting_total_usage_usd": "2.64",
        "ending_total_usage_usd": f"{Decimal('2.64') + chapter_usd:.2f}",
        "provider_reported_chapter_usage_usd": f"{chapter_usd:.2f}",
        "ledger_usage_usd_unrounded": f"{exact_usage_usd:.4f}",
        "dollar_reconciliation_tolerance_usd": "0.01",
        "observation_sources": {
            "provider_credits": (
                "authenticated_subscription_ui_or_api_exact_integer"
            ),
            "billable_request_count": (
                "authenticated_usage_analytics_ui_exact_integer"
            ),
            "total_usage_usd": (
                "authenticated_usage_analytics_ui_two_decimal_rounded"
            ),
            "chapter_usage_usd": "derived_difference_of_observed_rounded_totals",
            "ledger_usage_usd": "ledger_character_cost_at_locked_rate",
        },
        "prebatch_baseline": {
            "used_provider_credits": 14_510,
            "remaining_provider_credits": 171_490,
            "total_provider_credits": 186_000,
            "billable_request_count": 14,
            "total_usage_usd": "2.64",
        },
        "account_credit_reconciliation_passed": True,
        "usage_credit_reconciliation_passed": True,
        "request_count_reconciliation_passed": True,
        "dollar_reconciliation_passed": True,
        "other_account_usage_observed": False,
        "rerender_count": 0,
        "paid_overage_used": False,
    }


def test_closeout_requires_exact_usage_key_deletion_and_full_prior_readback(
    tmp_path: Path, monkeypatch
) -> None:
    transport = FakeTransport()
    _result, root, packet, sources = _run(tmp_path, monkeypatch, transport)
    chapter = root / packet.chapter_id
    _events, state = renderer._load_state(
        chapter, packet=packet, sources=sources, root=root
    )
    closeout = _closeout_value(chapter, packet, state)
    (chapter / renderer.CLOSEOUT_NAME).write_text(json.dumps(closeout))
    (chapter / renderer.CLOSEOUT_NAME).chmod(0o600)
    ending = renderer._validate_prior_sequence(
        root,
        chapter_id="mountain_crossing",
        sources=sources,
        probe_audio=transport.probe,
    )
    assert ending[:3] == (
        closeout["ending_provider_credits"],
        30,
        Decimal(closeout["ending_total_usage_usd"]),
    )
    closeout["key_deletion_verified"] = False
    (chapter / renderer.CLOSEOUT_NAME).write_text(json.dumps(closeout))
    (chapter / renderer.CLOSEOUT_NAME).chmod(0o600)
    with pytest.raises(renderer.NarrationError, match="chapter_closeout_reconciliation_invalid"):
        renderer._validate_prior_sequence(
            root,
            chapter_id="mountain_crossing",
            sources=sources,
            probe_audio=transport.probe,
        )


def test_unexpected_orphan_output_blocks_before_key_and_network(
    tmp_path: Path, monkeypatch
) -> None:
    sources = _sources()
    monkeypatch.setattr(renderer, "load_audit_evidence", lambda: sources)
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = _root(tmp_path)
    renderer._prepare_root(root)
    chapter = root / packet.chapter_id
    events, state = renderer._load_state(
        chapter, packet=packet, sources=sources, root=root
    )
    renderer._ensure_initialized(
        chapter,
        events,
        state,
        packet=packet,
        sources=sources,
        root=root,
        now=NOW,
    )
    (chapter / "orphan.mp3").write_bytes(b"orphan")
    with pytest.raises(renderer.NarrationError, match="unexpected_chapter_output_content"):
        renderer.run_renderer(
            chapter_id=packet.chapter_id,
            output_root=root,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
            execution_evidence_path=tmp_path / "missing.json",
            key_reader=lambda: (_ for _ in ()).throw(AssertionError("key read")),
            transport_factory=lambda: (_ for _ in ()).throw(
                AssertionError("network")
            ),
            _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
        )


def test_strict_mp3_rejects_preface_and_trailing_junk() -> None:
    header = bytes((0xFF, 0xFB, 0x90, 0xC0))
    frame_length, _, _ = renderer._mp3_frame(header)
    frame = header + bytes(frame_length - 4)
    valid = frame * 10
    assert renderer._strict_probe_mono_mp3(valid).frame_count == 10
    assert renderer._strict_probe_mono_mp3(valid + b"TAG" + bytes(125)).frame_count == 10
    with pytest.raises(renderer.NarrationError):
        renderer._strict_probe_mono_mp3(b"preface" + valid)
    with pytest.raises(renderer.NarrationError):
        renderer._strict_probe_mono_mp3(valid + b"junk")


def test_direct_renderer_apply_is_operator_only_before_any_effect(
    tmp_path: Path,
) -> None:
    root = _root(tmp_path)
    with pytest.raises(
        renderer.NarrationError, match="audited_operator_required_for_live_apply"
    ):
        renderer.run_renderer(
            chapter_id="foothills_parkway",
            output_root=root,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
            execution_evidence_path=tmp_path / "missing.json",
            key_reader=lambda: (_ for _ in ()).throw(AssertionError("key read")),
            transport_factory=lambda: (_ for _ in ()).throw(AssertionError("network")),
        )
    assert not renderer._path_present(root)


def test_empty_root_and_empty_chapter_crash_states_recover_deterministically(
    tmp_path: Path,
) -> None:
    root = _root(tmp_path)
    root.mkdir(mode=0o700)
    renderer._prepare_root(root)
    assert (root / renderer.ROOT_MARKER_NAME).is_file()
    packet = renderer.load_chapter_packet("foothills_parkway")
    sources = _sources()
    chapter = root / packet.chapter_id
    chapter.mkdir(mode=0o700)
    events, state = renderer._load_state(
        chapter, packet=packet, sources=sources, root=root
    )
    events, state = renderer._ensure_initialized(
        chapter,
        events,
        state,
        packet=packet,
        sources=sources,
        root=root,
        now=NOW,
    )
    assert len(events) == 1
    assert state["initialized"] is True


def test_missing_snapshot_after_journal_append_is_rebuilt_before_key_network(
    tmp_path: Path, monkeypatch
) -> None:
    sources = _sources()
    monkeypatch.setattr(renderer, "load_audit_evidence", lambda: sources)
    root = _root(tmp_path)
    renderer._prepare_root(root)
    packet = renderer.load_chapter_packet("foothills_parkway")
    chapter = root / packet.chapter_id
    events, state = renderer._load_state(
        chapter, packet=packet, sources=sources, root=root
    )
    renderer._ensure_initialized(
        chapter,
        events,
        state,
        packet=packet,
        sources=sources,
        root=root,
        now=NOW,
    )
    (chapter / renderer.LEDGER_NAME).unlink()
    with pytest.raises(renderer.NarrationError, match="execution_evidence_file_invalid"):
        renderer.run_renderer(
            chapter_id=packet.chapter_id,
            output_root=root,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
            execution_evidence_path=tmp_path / "missing.json",
            key_reader=lambda: (_ for _ in ()).throw(AssertionError("key read")),
            transport_factory=lambda: (_ for _ in ()).throw(AssertionError("network")),
            _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
        )
    assert (chapter / renderer.LEDGER_NAME).is_file()


def test_root_marker_and_chapter_symlinks_are_rejected(tmp_path: Path) -> None:
    root = _root(tmp_path)
    renderer._prepare_root(root)
    marker = root / renderer.ROOT_MARKER_NAME
    marker_bytes = marker.read_bytes()
    outside_marker = tmp_path / "outside-marker.json"
    outside_marker.write_bytes(marker_bytes)
    outside_marker.chmod(0o600)
    marker.unlink()
    marker.symlink_to(outside_marker)
    with pytest.raises(renderer.NarrationError):
        renderer._prepare_root(root)
    marker.unlink()
    marker.write_bytes(marker_bytes)
    marker.chmod(0o600)
    outside_dir = tmp_path / "outside-chapter"
    outside_dir.mkdir(mode=0o700)
    (root / "foothills_parkway").symlink_to(outside_dir, target_is_directory=True)
    with pytest.raises(renderer.NarrationError, match="chapter_directory_invalid"):
        renderer._prepare_root(root)


@pytest.mark.parametrize("target_kind", ["ledger", "master", "closeout", "stage", "quarantine"])
def test_every_output_class_rejects_symlinks(
    tmp_path: Path, monkeypatch, target_kind: str
) -> None:
    sources = _sources()
    monkeypatch.setattr(renderer, "load_audit_evidence", lambda: sources)
    transport = FakeTransport()
    if target_kind in {"master", "closeout"}:
        _result, root, packet, _ = _run(tmp_path, monkeypatch, transport)
    else:
        root = _root(tmp_path)
        renderer._prepare_root(root)
        packet = renderer.load_chapter_packet("foothills_parkway")
        chapter = root / packet.chapter_id
        events, state = renderer._load_state(
            chapter, packet=packet, sources=sources, root=root
        )
        renderer._ensure_initialized(
            chapter,
            events,
            state,
            packet=packet,
            sources=sources,
            root=root,
            now=NOW,
        )
    chapter = root / packet.chapter_id
    entry = packet.requests[0]
    if target_kind == "ledger":
        target = chapter / renderer.LEDGER_NAME
    elif target_kind == "master":
        target = chapter / renderer._master_name(entry)
    elif target_kind == "closeout":
        target = chapter / renderer.CLOSEOUT_NAME
    elif target_kind == "stage":
        target = chapter / renderer._stage_audio_name(entry)
    else:
        target = chapter / renderer._quarantine_name(entry)
    if renderer._path_present(target):
        target.unlink()
    outside = tmp_path / f"outside-{target_kind}.bin"
    outside.write_bytes(b"outside")
    outside.chmod(0o600)
    target.symlink_to(outside)
    with pytest.raises(renderer.NarrationError):
        renderer.run_renderer(
            chapter_id=packet.chapter_id,
            output_root=root,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
            execution_evidence_path=tmp_path / "missing.json",
            key_reader=lambda: (_ for _ in ()).throw(AssertionError("key read")),
            transport_factory=lambda: (_ for _ in ()).throw(AssertionError("network")),
            probe_audio=transport.probe,
            _operator_capability=renderer._OPERATOR_APPLY_CAPABILITY,
        )


def test_stale_lock_file_does_not_block_kernel_released_lock(tmp_path: Path) -> None:
    root = _root(tmp_path)
    lock = root.parent / f".{root.name}.remaining-render.apply.lock"
    lock.write_text("stale-process\n")
    lock.chmod(0o600)
    with renderer._exclusive_sentinel(root):
        assert renderer.RENDERER_CONTRACT in lock.read_text()


def test_cross_origin_redirect_is_not_followed_and_key_is_not_forwarded() -> None:
    received_headers: list[dict[str, str]] = []

    class Target(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            received_headers.append(dict(self.headers.items()))
            self.send_response(200)
            self.end_headers()

        def log_message(self, _format, *_args):
            return

    target = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Target)

    class Redirect(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header(
                "Location", f"http://127.0.0.1:{target.server_port}/capture"
            )
            self.end_headers()

        def log_message(self, _format, *_args):
            return

    redirect = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
    threads = [
        threading.Thread(target=server.serve_forever, daemon=True)
        for server in (target, redirect)
    ]
    for thread in threads:
        thread.start()
    try:
        response = renderer.UrllibProviderTransport().get(
            f"http://127.0.0.1:{redirect.server_port}/redirect",
            headers={"xi-api-key": "must-not-forward"},
            timeout=2,
        )
        assert response.status_code == 302
        assert received_headers == []
    finally:
        redirect.shutdown()
        target.shutdown()
        for thread in threads:
            thread.join(timeout=2)


@pytest.mark.parametrize("bad_value", [1.5, "1.5", True])
def test_subscription_credit_math_rejects_fractional_or_boolean_values(
    bad_value,
) -> None:
    with pytest.raises(renderer.NarrationError, match="provider_subscription_invalid"):
        renderer._subscription_remaining(
            {"tier": "creator", "character_count": bad_value, "character_limit": 10}
        )


def test_voice_name_media_type_and_response_bounds_are_exact(
    tmp_path: Path, monkeypatch
) -> None:
    metadata = _voice()
    metadata["name"] = "Not James"
    with pytest.raises(renderer.NarrationError, match="provider_voice_metadata_drift"):
        renderer._validate_voice_metadata(metadata)
    with pytest.raises(renderer.NarrationError, match="provider_response_body_too_large"):
        renderer.UrllibProviderTransport._bounded_read(
            io.BytesIO(b"x" * 11), 10
        )
    packet = renderer.load_chapter_packet("foothills_parkway")
    marker = b"valid-audio"
    transport = FakeTransport(
        [
            renderer.ProviderResponse(
                200,
                {
                    "content-type": "audio/mpeg-malformed",
                    "character-cost": str(packet.requests[0].payload_character_count),
                },
                marker,
            )
        ]
    )
    transport.probes[marker] = renderer.Mp3Probe(
        byte_count=len(marker),
        sha256=hashlib.sha256(marker).hexdigest(),
        sample_rate_hz=44_100,
        bitrate_kbps=128,
        frame_count=100,
        duration_s=packet.requests[0].word_count / 150 * 60,
    )
    with pytest.raises(renderer.NarrationError, match="provider_audio_or_cost_ambiguous"):
        _run(tmp_path, monkeypatch, transport)


def test_initial_usage_baseline_and_source_binding_cannot_drift(
    tmp_path: Path, monkeypatch
) -> None:
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = _root(tmp_path)
    sources = _sources()
    value = _evidence_value(packet=packet, root=root, sources=sources)
    value["account"]["observed_billable_request_count"] = 15
    transport = FakeTransport()
    with pytest.raises(renderer.NarrationError, match="execution_continuation_unexpected"):
        _run(tmp_path, monkeypatch, transport, evidence_value=value)
    assert not transport.get_calls and not transport.post_calls
    value = _evidence_value(packet=packet, root=root, sources=sources)
    value["source_observation_sha256"] = "d" * 64
    with pytest.raises(
        renderer.NarrationError, match="execution_source_observation_binding_invalid"
    ):
        _run(
            tmp_path,
            monkeypatch,
            FakeTransport(),
            evidence_value=value,
            evidence_name="source-drift.json",
        )


def test_execution_key_expiry_and_direct_observation_contract_fail_closed(
    tmp_path: Path, monkeypatch
) -> None:
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = _root(tmp_path)
    sources = _sources()

    values: list[tuple[str, dict]] = []
    directly_observed = _evidence_value(packet=packet, root=root, sources=sources)
    directly_observed["key_policy"]["key_created_at_directly_observed"] = True
    values.append(("created-directly-observed", directly_observed))

    ttl_drift = _evidence_value(packet=packet, root=root, sources=sources)
    ttl_drift["key_policy"]["requested_ttl_seconds"] = (
        renderer.KEY_LIFETIME_SECONDS - 1
    )
    values.append(("ttl-drift", ttl_drift))

    expiry_drift = _evidence_value(packet=packet, root=root, sources=sources)
    expiry_drift["key_policy"]["key_expires_at"] = renderer._iso(
        NOW + timedelta(hours=23)
    )
    values.append(("expiry-drift", expiry_drift))

    post_inspected = _evidence_value(packet=packet, root=root, sources=sources)
    post_inspected["key_policy"]["post_create_response_inspected"] = True
    values.append(("post-response-inspected", post_inspected))

    duplicate_row = _evidence_value(packet=packet, root=root, sources=sources)
    duplicate_row["key_policy"]["provider_key_matching_row_count"] = 2
    values.append(("duplicate-key-row", duplicate_row))

    id_source_drift = _evidence_value(packet=packet, root=root, sources=sources)
    id_source_drift["key_policy"]["provider_key_id_source"] = (
        "manually_inferred_key_identifier"
    )
    values.append(("key-id-source-drift", id_source_drift))

    stale = _evidence_value(packet=packet, root=root, sources=sources)
    stale_created = NOW - renderer.EXECUTION_EVIDENCE_MAX_AGE - timedelta(
        seconds=1
    )
    stale_expires = stale_created + timedelta(
        seconds=renderer.KEY_LIFETIME_SECONDS
    )
    stale["key_policy"]["provider_key_expires_at_unix"] = int(
        stale_expires.timestamp()
    )
    stale["key_policy"]["key_expires_at"] = renderer._iso(stale_expires)
    stale["key_policy"]["key_created_at_derived"] = renderer._iso(stale_created)
    values.append(("stale-key-row", stale))

    for name, value in values:
        transport = FakeTransport()
        with pytest.raises(
            renderer.NarrationError, match="execution_key_policy_invalid"
        ):
            _run(
                tmp_path,
                monkeypatch,
                transport,
                evidence_value=value,
                evidence_name=f"{name}.json",
            )
        assert transport.get_calls == [] and transport.post_calls == []


def test_late_cades_rotation_uses_only_residual_exposure(tmp_path: Path) -> None:
    packet = renderer.load_chapter_packet("little_river_cades_cove")
    root = _root(tmp_path)
    sources = _sources()
    committed = 48_000
    prior_session = {
        "evidence_sha256": "1" * 64,
        "key_id_sha256": hashlib.sha256(b"old-cades-key").hexdigest(),
        "key_material_sha256": hashlib.sha256(b"old-cades-material").hexdigest(),
        "key_session_number": 1,
        "available_credits": 48_800,
        "observed_total_usage_usd": "2.64",
        "observed_billable_request_count": 14,
        "ledger_character_cost_total_at_start": 0,
        "ledger_request_count_at_start": 0,
    }
    observed = NOW + timedelta(minutes=2)
    value = _evidence_value(
        packet=packet,
        root=root,
        sources=sources,
        ledger_head="0" * 64,
        observed=observed,
        available=800,
        prior_session=prior_session,
        key=b"new-cades-material-not-retained-0123456789",
        key_id_material=b"new-cades-key",
        already_committed=committed,
        committed_since_prior_session=committed,
        observed_total_usage_usd="7.44",
        observed_billable_request_count=36,
        completed_requests_since_prior_session=22,
    )
    evidence = _write_evidence(tmp_path, value, "late-cades.json")
    execution = renderer.load_execution_evidence(
        evidence,
        packet=packet,
        root=root,
        sources=sources,
        ledger_head="0" * 64,
        prior_session=prior_session,
        already_committed=committed,
        committed_since_prior_session=committed,
        completed_request_count=22,
        completed_requests_since_prior_session=22,
        chapter_starting_total_usage_usd=Decimal("2.64"),
        chapter_starting_billable_requests=14,
        ledger_updated_at=renderer._iso(NOW),
        now=observed,
    )
    assert execution.remaining_batch_renderer_cap == 700
    assert execution.key_credit_limit == 700
    bad = json.loads(json.dumps(value))
    bad["continuation"]["replacement_key_creation_initiated_at"] = renderer._iso(
        NOW
    )
    bad_evidence = _write_evidence(tmp_path, bad, "late-cades-bad-order.json")
    with pytest.raises(
        renderer.NarrationError,
        match="execution_replacement_key_predates_prior_deletion",
    ):
        renderer.load_execution_evidence(
            bad_evidence,
            packet=packet,
            root=root,
            sources=sources,
            ledger_head="0" * 64,
            prior_session=prior_session,
            already_committed=committed,
            committed_since_prior_session=committed,
            completed_request_count=22,
            completed_requests_since_prior_session=22,
            chapter_starting_total_usage_usd=Decimal("2.64"),
            chapter_starting_billable_requests=14,
            ledger_updated_at=renderer._iso(NOW),
            now=observed,
        )
