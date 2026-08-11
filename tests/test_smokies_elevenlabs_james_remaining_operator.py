from __future__ import annotations

import hashlib
import json
import shutil
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from scripts import operate_smokies_elevenlabs_james_remaining as operator
from scripts import render_smokies_elevenlabs_james_remaining as renderer
from tests import test_smokies_elevenlabs_james_remaining_renderer as renderer_test


RAW_KEY_ID = "provider-key-foothills-initial"
RAW_KEY = b"operator-ephemeral-key-material-0123456789abcdef"
REPLACEMENT_KEY_ID = "provider-key-foothills-recovery"
REPLACEMENT_KEY = b"replacement-ephemeral-key-material-abcdef0123456789"


def _write_private_json(path: Path, value: dict) -> Path:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    path.write_text(json.dumps(value), encoding="utf-8")
    path.chmod(0o600)
    return path


def _render_observation(
    *,
    packet: renderer.ChapterPacket,
    root: Path,
    sources: renderer.SourceBindings,
    raw_key_id: str = RAW_KEY_ID,
    key: bytes = RAW_KEY,
    observed=renderer_test.NOW,
    available: int = 171_490,
    observed_usage_usd: str = "2.64",
    observed_requests: int = 14,
    already_committed: int = 0,
    prior_session: dict | None = None,
    recovery_prior_raw_key_id: str | None = None,
    completed_request_count: int | None = None,
) -> dict:
    completed_count = (
        (1 if already_committed else 0)
        if completed_request_count is None
        else completed_request_count
    )
    evidence = renderer_test._evidence_value(
        packet=packet,
        root=root,
        sources=sources,
        observed=observed,
        available=available,
        prior_session=prior_session,
        key=key,
        key_id_material=raw_key_id.encode(),
        already_committed=already_committed,
        committed_since_prior_session=already_committed,
        observed_total_usage_usd=observed_usage_usd,
        observed_billable_request_count=observed_requests,
        completed_request_count=completed_count,
        completed_requests_since_prior_session=completed_count,
    )
    evidence_key_policy = evidence["key_policy"]
    key_session_number = (
        1
        if prior_session is None
        else int(prior_session["key_session_number"]) + 1
    )
    key_policy = {
        "provider_key_id": raw_key_id,
        "provider_key_name": renderer._provider_key_name(
            packet.chapter_id, key_session_number
        ),
        "provider_key_preview": key[-4:].decode("ascii"),
        "provider_key_created_tooltip": evidence_key_policy[
            "provider_key_created_tooltip"
        ],
        "provider_key_expires_tooltip": evidence_key_policy[
            "provider_key_expires_tooltip"
        ],
        "provider_key_created_tooltip_directly_observed": True,
        "provider_key_expires_tooltip_directly_observed": True,
        "provider_key_timestamp_timezone": renderer.KEY_UI_TIMEZONE,
        "provider_key_timestamp_timezone_source": renderer.KEY_UI_SOURCES[
            "timezone"
        ],
        "provider_key_timestamp_precision": (
            renderer.KEY_UI_TIMESTAMP_PRECISION
        ),
        "provider_key_timestamp_precision_seconds": (
            renderer.KEY_UI_TIMESTAMP_PRECISION_SECONDS
        ),
        "provider_key_timestamp_rounding_mode": (
            renderer.KEY_UI_ROUNDING_MODE
        ),
        "provider_key_created_utc_offset": "-05:00",
        "provider_key_expires_utc_offset": "-05:00",
        "provider_key_timestamp_offsets_source": renderer.KEY_UI_SOURCES[
            "offsets"
        ],
        "provider_key_browser_date_string": evidence_key_policy[
            "provider_key_browser_date_string"
        ],
        "provider_key_browser_date_source": renderer.KEY_UI_SOURCES[
            "browser_time"
        ],
        "provider_key_matching_row_count": 1,
        "provider_key_row_unique": True,
        "provider_key_enabled": True,
        "requested_ttl_label": renderer.KEY_UI_REQUESTED_TTL_LABEL,
        "requested_ttl_seconds": renderer.KEY_LIFETIME_SECONDS,
        "key_credit_limit": evidence_key_policy["key_credit_limit"],
        "key_permissions": evidence_key_policy["key_permissions"],
        "restrict_key_enabled": True,
        "auto_disable_if_leaked": True,
        "other_chapter_keys_active": False,
        "provider_key_id_source": renderer.KEY_UI_SOURCES["key_id"],
        "provider_key_name_source": renderer.KEY_UI_SOURCES["key_name"],
        "provider_key_preview_source": renderer.KEY_UI_SOURCES["key_preview"],
        "provider_key_created_tooltip_source": renderer.KEY_UI_SOURCES[
            "created_tooltip"
        ],
        "provider_key_expiry_tooltip_source": renderer.KEY_UI_SOURCES[
            "expiry_tooltip"
        ],
        "provider_key_enabled_source": renderer.KEY_UI_SOURCES["enabled"],
        "provider_key_controls_source": renderer.KEY_UI_SOURCES["controls"],
        "provider_key_uniqueness_source": renderer.KEY_UI_SOURCES[
            "uniqueness"
        ],
        "post_create_response_inspected": False,
        "key_delivery": (
            "secure_piped_stdin_external_transfer_not_attested_by_operator"
        ),
        "key_identity_capture": (
            "official_ui_key_row_name_id_preview_times_controls_and_operator_"
            "memory_material_sha256"
        ),
    }
    recovery = None
    if prior_session is not None:
        recovery = {
            "recovery_only": True,
            "prior_key_id": recovery_prior_raw_key_id,
            "prior_key_deleted": True,
            "prior_key_deletion_verified": True,
            "prior_key_deleted_at": renderer._iso(
                observed - timedelta(minutes=1, seconds=30)
            ),
            "provider_usage_reconciled": True,
            "unresolved_provider_ambiguity": False,
            "replacement_key_creation_initiated_at": renderer._iso(
                observed - timedelta(minutes=1, seconds=15)
            ),
            "replacement_key_creation_initiated_after_prior_deletion_verified": (
                True
            ),
            "replacement_key_creation_action_source": (
                "authenticated_browser_action_sequence"
            ),
        }
    return {
        "schema_version": 2,
        "kind": "smokies_remaining_render_execution_observation_v2",
        "observation_id": f"smokies_render_observation_{packet.chapter_id}_v2",
        "source": "authenticated_browser",
        "observed_at": renderer._iso(observed),
        "chapter_id": packet.chapter_id,
        "account": evidence["account"],
        "provider_usage_baseline": evidence["provider_usage_baseline"],
        "terms": evidence["terms"],
        "voice_contract": evidence["voice_contract"],
        "key_policy": key_policy,
        "recovery": recovery,
        "privacy": {
            "account_identity_recorded": False,
            "workspace_identity_recorded": False,
            "key_material_recorded": False,
            "local_paths_recorded": False,
        },
    }


def _configure(
    monkeypatch,
    *,
    sources: renderer.SourceBindings,
    transport: renderer_test.FakeTransport,
    key: bytes,
    now=renderer_test.NOW,
    key_counter: list[int] | None = None,
) -> None:
    monkeypatch.setattr(renderer, "load_audit_evidence", lambda: sources)

    def read_key() -> bytearray:
        if key_counter is not None:
            key_counter.append(1)
        return bytearray(key)

    monkeypatch.setattr(operator, "KEY_READER", read_key)
    monkeypatch.setattr(operator, "TRANSPORT_FACTORY", lambda: transport)
    monkeypatch.setattr(operator, "PROBE_AUDIO", transport.probe)
    monkeypatch.setattr(operator, "SLEEP", lambda _seconds: None)
    monkeypatch.setattr(operator, "NOW", lambda: now)


def _run_initial(tmp_path: Path, monkeypatch):
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(
        packet=packet, root=root, sources=sources
    )
    observation_path = _write_private_json(tmp_path / "render-observation.json", observation)
    transport = renderer_test.FakeTransport()
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
    )
    result = operator.run_operator(
        action=operator.RENDER_ACTION,
        chapter_id=packet.chapter_id,
        output_root=root,
        observation_path=observation_path,
        apply=True,
        verified_output_format=renderer.OUTPUT_FORMAT_ID,
    )
    return result, root, packet, sources, transport, observation, observation_path


def _closeout_observation(
    *,
    packet: renderer.ChapterPacket,
    state: dict,
    raw_key_id: str = RAW_KEY_ID,
    total_usage_available: bool = True,
) -> dict:
    committed = sum(
        item["accepted"]["character_cost"] for item in state["items"].values()
    )
    ending_usd = None
    if total_usage_available:
        usage = renderer._unrounded_usage_cost(
            packet.payload_character_count
        )
        ending_usd = f"{Decimal('2.64') + Decimal(f'{usage:.2f}'):.2f}"
    return {
        "schema_version": 2,
        "kind": "smokies_remaining_render_closeout_observation_v2",
        "observation_id": f"smokies_closeout_observation_{packet.chapter_id}_v2",
        "source": "authenticated_browser",
        "observed_at": renderer._iso(renderer_test.NOW),
        "chapter_id": packet.chapter_id,
        "ending_provider_credits": 171_490 - committed,
        "ending_billable_request_count": 14 + len(packet.requests),
        "ending_total_usage_usd": ending_usd,
        "key_id": raw_key_id,
        "key_deleted_at": renderer._iso(renderer_test.NOW),
        "key_deletion_source": (
            "official_signed_in_api_keys_ui_delete_and_absence_verification"
        ),
        "key_deleted": True,
        "key_deletion_verified": True,
        "no_other_active_render_keys": True,
        "other_account_usage_observed": False,
        "privacy": {
            "account_identity_recorded": False,
            "workspace_identity_recorded": False,
            "key_material_recorded": False,
            "local_paths_recorded": False,
        },
    }


def test_operator_dry_run_is_fail_closed() -> None:
    result = operator.run_operator()
    assert result["apply"] is False
    assert result["key_read"] is False
    assert result["network_used"] is False
    assert result["files_written"] == 0


def test_operator_dry_run_truthfully_reports_all_audit_states(
    tmp_path: Path, monkeypatch
) -> None:
    real_loader = renderer.load_audit_evidence
    missing = tmp_path / "missing-audit.json"
    monkeypatch.setattr(
        renderer, "load_audit_evidence", lambda: real_loader(missing)
    )
    missing_result = operator.run_operator()
    assert missing_result["independent_audit"]["status"] == "missing"
    assert missing_result["status"] == (
        "dry_run_operator_blocked_renderer_audit_missing_or_invalid"
    )

    invalid = _write_private_json(tmp_path / "invalid-audit.json", {})
    monkeypatch.setattr(
        renderer, "load_audit_evidence", lambda: real_loader(invalid)
    )
    invalid_result = operator.run_operator()
    assert invalid_result["independent_audit"]["status"] == "invalid_or_stale"

    valid = _write_private_json(
        tmp_path / "valid-audit.json", renderer_test._audit_value()
    )
    monkeypatch.setattr(
        renderer, "load_audit_evidence", lambda: real_loader(valid)
    )
    valid_result = operator.run_operator()
    assert valid_result["independent_audit"] == {
        "status": "valid",
        "valid": True,
        "renderer_audit_sha256": renderer._sha256_file(valid),
    }
    assert valid_result["status"] == (
        "dry_run_operator_ready_external_observation_and_key_required"
    )
    assert valid_result["key_read"] is False
    assert valid_result["network_used"] is False
    assert valid_result["files_written"] == 0


def test_operator_full_chapter_hashes_raw_key_id_and_never_persists_key(
    tmp_path: Path, monkeypatch
) -> None:
    result, root, packet, _sources, transport, observation, observation_path = (
        _run_initial(tmp_path, monkeypatch)
    )
    assert result["status"] == "render_complete_pending_key_deletion_closeout"
    assert len(transport.post_calls) == len(packet.requests) == 16
    evidence_files = list(root.parent.glob("*.execution-evidence.json"))
    assert len(evidence_files) == 1
    evidence = json.loads(evidence_files[0].read_text())
    assert evidence["key_policy"]["key_id_sha256"] == hashlib.sha256(
        RAW_KEY_ID.encode()
    ).hexdigest()
    assert evidence["key_policy"]["key_preview_sha256"] == hashlib.sha256(
        RAW_KEY[-4:]
    ).hexdigest()
    provider_key_name = observation["key_policy"]["provider_key_name"]
    assert evidence["key_policy"]["provider_key_name_sha256"] == hashlib.sha256(
        provider_key_name.encode("ascii")
    ).hexdigest()
    assert evidence["key_policy"]["key_session_number"] == 1
    assert evidence["key_policy"][
        "provider_key_created_tooltip_directly_observed"
    ] is True
    assert evidence["key_policy"][
        "provider_key_expires_tooltip_directly_observed"
    ] is True
    assert evidence["key_policy"]["provider_key_timestamp_rounding_mode"] == (
        "unknown"
    )
    assert evidence["key_policy"]["key_expiry_conservative_deadline"] == (
        evidence["key_policy"]["key_expires_at_interval_lower"]
    )
    assert evidence["source_observation_sha256"] == renderer._sha256_bytes(
        renderer._canonical_bytes(observation)
    )
    persisted = b"".join(
        path.read_bytes()
        for path in [*root.rglob("*"), *evidence_files]
        if path.is_file()
    )
    assert RAW_KEY not in persisted
    assert RAW_KEY_ID.encode() not in persisted
    assert provider_key_name.encode() not in persisted
    raw_preview = RAW_KEY[-4:].decode("ascii")

    def scalar_values(value, path=()):
        if isinstance(value, dict):
            for name, child in value.items():
                yield from scalar_values(child, (*path, name))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                yield from scalar_values(child, (*path, str(index)))
        else:
            yield path, value

    persisted_json = []
    for path in [*root.rglob("*.json"), *root.rglob("*.ndjson"), *evidence_files]:
        if path.suffix == ".ndjson":
            persisted_json.extend(
                json.loads(line)
                for line in path.read_text(encoding="utf-8").splitlines()
                if line
            )
        else:
            persisted_json.append(json.loads(path.read_text(encoding="utf-8")))
    for document in persisted_json:
        for field_path, value in scalar_values(document):
            if not isinstance(value, str):
                continue
            assert value != raw_preview
            field_name = field_path[-1] if field_path else ""
            raw_key_field = (
                any(
                    marker in field_name
                    for marker in ("preview", "key_material", "api_key")
                )
                and not field_name.endswith("_sha256")
            )
            if raw_key_field:
                assert raw_preview not in value
    assert RAW_KEY_ID in observation_path.read_text()


def test_provider_key_name_must_match_exact_chapter_session_before_key_read(
    tmp_path: Path, monkeypatch
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    observation["key_policy"]["provider_key_name"] = (
        "trailhead-smokies-james-mc-session-1"
    )
    path = _write_private_json(tmp_path / "wrong-key-name.json", observation)
    transport = renderer_test.FakeTransport()
    key_reads: list[int] = []
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
        key_counter=key_reads,
    )
    with pytest.raises(
        renderer.NarrationError, match="render_observation_key_name_invalid"
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert key_reads == []
    assert transport.get_calls == [] and transport.post_calls == []


@pytest.mark.parametrize(
    "bad_preview",
    ["abc", "abcde", "éabc", "a bc"],
)
def test_provider_preview_schema_rejects_bad_length_non_ascii_or_whitespace_before_key(
    tmp_path: Path, monkeypatch, bad_preview: str
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    observation["key_policy"]["provider_key_preview"] = bad_preview
    path = _write_private_json(tmp_path / "bad-preview-observation.json", observation)
    transport = renderer_test.FakeTransport()
    key_reads: list[int] = []
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
        key_counter=key_reads,
    )
    with pytest.raises(
        renderer.NarrationError, match="render_observation_key_preview_invalid"
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert key_reads == []
    assert transport.get_calls == [] and transport.post_calls == []
    assert list(root.parent.glob("*.execution-evidence.json")) == []


@pytest.mark.parametrize(
    "wrong_preview",
    [RAW_KEY[:4].decode("ascii"), "zzzz"],
)
def test_provider_preview_mismatch_zeroes_key_and_stops_before_evidence_or_network(
    tmp_path: Path, monkeypatch, wrong_preview: str
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    observation["key_policy"]["provider_key_preview"] = wrong_preview
    path = _write_private_json(tmp_path / "wrong-preview-observation.json", observation)
    transport = renderer_test.FakeTransport()
    key_buffer = bytearray(RAW_KEY)
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
    )
    monkeypatch.setattr(operator, "KEY_READER", lambda: key_buffer)
    with pytest.raises(
        renderer.NarrationError,
        match="provider_key_preview_mismatch_delete_key_required",
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert key_buffer == bytearray(len(RAW_KEY))
    assert transport.get_calls == [] and transport.post_calls == []
    assert list(root.parent.glob("*.execution-evidence.json")) == []


def test_stale_provider_key_row_stops_before_key_read_or_network(
    tmp_path: Path, monkeypatch
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    stale_created_center = (
        renderer_test.NOW - renderer.EXECUTION_EVIDENCE_MAX_AGE
    ).replace(second=0, microsecond=0)
    observation["key_policy"]["provider_key_created_tooltip"] = (
        renderer_test._ui_tooltip(stale_created_center)
    )
    observation["key_policy"]["provider_key_expires_tooltip"] = (
        renderer_test._ui_tooltip(
            stale_created_center
            + timedelta(seconds=renderer.KEY_LIFETIME_SECONDS)
        )
    )
    path = _write_private_json(tmp_path / "stale-key-observation.json", observation)
    transport = renderer_test.FakeTransport()
    key_reads: list[int] = []
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
        key_counter=key_reads,
    )
    with pytest.raises(
        renderer.NarrationError,
        match="render_observation_key_time_contract_invalid",
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert key_reads == []
    assert transport.get_calls == [] and transport.post_calls == []


def test_observation_age_and_key_age_cannot_accumulate_before_key_read(
    tmp_path: Path, monkeypatch
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observed = renderer_test.NOW - timedelta(minutes=14)
    created_center = observed.replace(second=0, microsecond=0) - timedelta(
        minutes=13
    )
    observation = _render_observation(
        packet=packet,
        root=root,
        sources=sources,
        observed=observed,
    )
    observation["key_policy"]["provider_key_created_tooltip"] = (
        renderer_test._ui_tooltip(created_center)
    )
    observation["key_policy"]["provider_key_expires_tooltip"] = (
        renderer_test._ui_tooltip(
            created_center + timedelta(seconds=renderer.KEY_LIFETIME_SECONDS)
        )
    )
    path = _write_private_json(
        tmp_path / "combined-age-observation.json", observation
    )
    transport = renderer_test.FakeTransport()
    key_reads: list[int] = []
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
        key_counter=key_reads,
    )
    with pytest.raises(
        renderer.NarrationError,
        match="render_observation_key_action_time_invalid",
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert key_reads == []
    assert transport.get_calls == [] and transport.post_calls == []
    assert list(root.parent.glob("*.execution-evidence.json")) == []


def test_ui_minute_time_evidence_rejects_timezone_dst_rounding_and_source_drift(
    tmp_path: Path, monkeypatch
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    created_center = renderer_test.NOW.replace(second=0, microsecond=0) - timedelta(
        minutes=1
    )
    stale_center = (
        renderer_test.NOW - renderer.EXECUTION_EVIDENCE_MAX_AGE
    ).replace(second=0, microsecond=0)
    cases = {
        "missing-timezone": {"provider_key_timestamp_timezone": None},
        "timezone-source-drift": {
            "provider_key_timestamp_timezone_source": "browser_intl_assumption"
        },
        "missing-browser-time": {"provider_key_browser_date_string": ""},
        "stale-browser-time": {
            "provider_key_browser_date_string": renderer_test._browser_date_string(
                renderer_test.NOW - timedelta(minutes=3)
            )
        },
        "browser-offset-mismatch": {
            "provider_key_browser_date_string": renderer_test._browser_date_string(
                renderer_test.NOW
            ).replace("GMT-0500", "GMT-0600")
        },
        "created-offset-mismatch": {"provider_key_created_utc_offset": "-06:00"},
        "expiry-offset-transition": {"provider_key_expires_utc_offset": "-06:00"},
        "malformed-created-tooltip": {"provider_key_created_tooltip": "Aug 11 2026"},
        "ambiguous-dst-fold": {
            "provider_key_created_tooltip": "Nov 1, 2026, 1:30 AM",
            "provider_key_expires_tooltip": "Nov 2, 2026, 1:30 AM",
        },
        "nonexistent-dst-gap": {
            "provider_key_created_tooltip": "Mar 8, 2026, 2:30 AM",
            "provider_key_expires_tooltip": "Mar 9, 2026, 2:30 AM",
        },
        "displayed-duration-23h59": {
            "provider_key_expires_tooltip": renderer_test._ui_tooltip(
                created_center + timedelta(hours=23, minutes=59)
            )
        },
        "displayed-duration-24h01": {
            "provider_key_expires_tooltip": renderer_test._ui_tooltip(
                created_center + timedelta(hours=24, minutes=1)
            )
        },
        "stale-created-lower-bound": {
            "provider_key_created_tooltip": renderer_test._ui_tooltip(stale_center),
            "provider_key_expires_tooltip": renderer_test._ui_tooltip(
                stale_center + timedelta(seconds=renderer.KEY_LIFETIME_SECONDS)
            ),
        },
        "stale-key-with-expiry-lower-below-two-hours": {
            "provider_key_created_tooltip": renderer_test._ui_tooltip(
                renderer_test.NOW - timedelta(hours=23)
            ),
            "provider_key_expires_tooltip": renderer_test._ui_tooltip(
                renderer_test.NOW + timedelta(hours=1)
            ),
        },
        "future-created-upper-bound": {
            "provider_key_created_tooltip": renderer_test._ui_tooltip(
                renderer_test.NOW + timedelta(minutes=2)
            ),
            "provider_key_expires_tooltip": renderer_test._ui_tooltip(
                renderer_test.NOW
                + timedelta(minutes=2, seconds=renderer.KEY_LIFETIME_SECONDS)
            ),
        },
        "ttl-label-drift": {"requested_ttl_label": "24 hours"},
        "disabled-key": {"provider_key_enabled": False},
        "tooltip-source-drift": {
            "provider_key_created_tooltip_source": "manual_timestamp_entry"
        },
    }

    for name, changes in cases.items():
        case_dir = tmp_path / name
        case_dir.mkdir(mode=0o700)
        root = renderer_test._root(case_dir)
        observation = _render_observation(
            packet=packet, root=root, sources=sources
        )
        observation["key_policy"].update(changes)
        path = _write_private_json(
            case_dir / "render-observation.json", observation
        )
        transport = renderer_test.FakeTransport()
        key_reads: list[int] = []
        _configure(
            monkeypatch,
            sources=sources,
            transport=transport,
            key=RAW_KEY,
            key_counter=key_reads,
        )
        with pytest.raises(renderer.NarrationError):
            operator.run_operator(
                action=operator.RENDER_ACTION,
                chapter_id=packet.chapter_id,
                output_root=root,
                observation_path=path,
                apply=True,
                verified_output_format=renderer.OUTPUT_FORMAT_ID,
            )
        assert key_reads == [], name
        assert transport.get_calls == [] and transport.post_calls == [], name


def test_provider_key_id_cannot_be_substituted_with_preview_and_stops_before_key_read(
    tmp_path: Path, monkeypatch
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    observation["key_policy"]["provider_key_id"] = observation["key_policy"][
        "provider_key_preview"
    ]
    path = _write_private_json(tmp_path / "same-id-preview.json", observation)
    transport = renderer_test.FakeTransport()
    key_reads: list[int] = []
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
        key_counter=key_reads,
    )
    with pytest.raises(
        renderer.NarrationError, match="render_observation_key_id_invalid"
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert key_reads == []
    assert transport.get_calls == [] and transport.post_calls == []


def test_provider_key_id_cannot_be_substituted_with_exact_key_name(
    tmp_path: Path, monkeypatch
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    observation["key_policy"]["provider_key_id"] = observation["key_policy"][
        "provider_key_name"
    ]
    path = _write_private_json(tmp_path / "name-as-id.json", observation)
    transport = renderer_test.FakeTransport()
    key_reads: list[int] = []
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
        key_counter=key_reads,
    )
    with pytest.raises(
        renderer.NarrationError, match="render_observation_key_identity_invalid"
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert key_reads == []
    assert transport.get_calls == [] and transport.post_calls == []


@pytest.mark.parametrize("bad_key_id", ["short", "invalid.id.with.dot"])
def test_provider_key_id_minimum_honest_shape_rejects_short_or_punctuation(
    tmp_path: Path, monkeypatch, bad_key_id: str
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    observation["key_policy"]["provider_key_id"] = bad_key_id
    path = _write_private_json(tmp_path / "bad-key-id.json", observation)
    transport = renderer_test.FakeTransport()
    key_reads: list[int] = []
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
        key_counter=key_reads,
    )
    with pytest.raises(
        renderer.NarrationError, match="render_observation_key_id_invalid"
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert key_reads == []
    assert transport.get_calls == [] and transport.post_calls == []


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("provider_key_matching_row_count", 0),
        ("provider_key_matching_row_count", 2),
        ("provider_key_matching_row_count", True),
        ("provider_key_row_unique", False),
    ],
)
def test_provider_key_row_must_be_explicitly_unique_before_key_read(
    tmp_path: Path, monkeypatch, field: str, bad_value
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    observation["key_policy"][field] = bad_value
    path = _write_private_json(tmp_path / f"bad-row-{field}.json", observation)
    transport = renderer_test.FakeTransport()
    key_reads: list[int] = []
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
        key_counter=key_reads,
    )
    with pytest.raises(
        renderer.NarrationError, match="render_observation_key_delivery_invalid"
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert key_reads == []
    assert transport.get_calls == [] and transport.post_calls == []


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("key_credit_limit", "25000"),
        ("key_permissions", ["text_to_speech_access"]),
        ("restrict_key_enabled", False),
        ("other_chapter_keys_active", True),
    ],
)
def test_provider_key_quota_scopes_and_exclusivity_fail_before_key_read(
    tmp_path: Path, monkeypatch, field: str, bad_value
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    observation["key_policy"][field] = bad_value
    path = _write_private_json(tmp_path / f"bad-{field}.json", observation)
    transport = renderer_test.FakeTransport()
    key_reads: list[int] = []
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
        key_counter=key_reads,
    )
    with pytest.raises(
        renderer.NarrationError, match="render_observation_key_delivery_invalid"
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert key_reads == []
    assert transport.get_calls == [] and transport.post_calls == []


def test_execution_evidence_create_is_exactly_idempotent_after_crash_before_renderer(
    tmp_path: Path, monkeypatch
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    observation_path = _write_private_json(tmp_path / "render-observation.json", observation)
    transport = renderer_test.FakeTransport()
    counter: list[int] = []
    _configure(
        monkeypatch,
        sources=sources,
        transport=transport,
        key=RAW_KEY,
        key_counter=counter,
    )
    real_run = renderer.run_renderer
    monkeypatch.setattr(
        renderer,
        "run_renderer",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("simulated-crash")),
    )
    with pytest.raises(RuntimeError, match="simulated-crash"):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=observation_path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    evidence_files = list(root.parent.glob("*.execution-evidence.json"))
    assert len(evidence_files) == 1
    before = evidence_files[0].read_bytes()
    monkeypatch.setattr(renderer, "run_renderer", real_run)
    result = operator.run_operator(
        action=operator.RENDER_ACTION,
        chapter_id=packet.chapter_id,
        output_root=root,
        observation_path=observation_path,
        apply=True,
        verified_output_format=renderer.OUTPUT_FORMAT_ID,
    )
    assert result["status"] == "render_complete_pending_key_deletion_closeout"
    assert evidence_files[0].read_bytes() == before
    assert len(counter) == 2


def test_crash_after_one_success_rotates_to_new_residual_key_without_rerender(
    tmp_path: Path, monkeypatch
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    first_observation = _render_observation(packet=packet, root=root, sources=sources)
    first_path = _write_private_json(tmp_path / "first-observation.json", first_observation)
    first_transport = renderer_test.DivergentCharacterCostTransport([1_175])
    _configure(
        monkeypatch,
        sources=sources,
        transport=first_transport,
        key=RAW_KEY,
    )
    original_commit = renderer._commit_event
    crashed = False

    def crash_after_first_completion(*args, **kwargs):
        nonlocal crashed
        result = original_commit(*args, **kwargs)
        if kwargs.get("event_type") == "request_completed" and not crashed:
            crashed = True
            raise RuntimeError("simulated-host-crash")
        return result

    monkeypatch.setattr(renderer, "_commit_event", crash_after_first_completion)
    with pytest.raises(RuntimeError, match="simulated-host-crash"):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=first_path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    monkeypatch.setattr(renderer, "_commit_event", original_commit)
    _events, state = renderer._load_state(
        root / packet.chapter_id,
        packet=packet,
        sources=sources,
        root=root,
    )
    committed = sum(
        item["accepted"]["character_cost"]
        for item in state["items"].values()
        if item["state"] == "completed"
    )
    assert committed > 0
    completed_count = sum(
        item["state"] == "completed" for item in state["items"].values()
    )
    assert completed_count == 1
    assert committed == 1_175
    assert committed != packet.requests[0].payload_character_count
    observed = renderer_test.NOW + timedelta(minutes=2)
    partial_input_characters = (
        renderer._locked_billable_input_characters_for_request_count(
            packet, completed_count
        )
    )
    partial_usage = renderer._unrounded_usage_cost(partial_input_characters)
    ending_usd = f"{Decimal('2.64') + Decimal(f'{partial_usage:.2f}'):.2f}"
    recovery_observation = _render_observation(
        packet=packet,
        root=root,
        sources=sources,
        raw_key_id=REPLACEMENT_KEY_ID,
        key=REPLACEMENT_KEY,
        observed=observed,
        available=171_490 - committed,
        observed_usage_usd=ending_usd,
        observed_requests=15,
        already_committed=committed,
        prior_session=state["sessions"][-1],
        recovery_prior_raw_key_id=RAW_KEY_ID,
    )
    recovery_path = _write_private_json(
        tmp_path / "recovery-observation.json", recovery_observation
    )
    second_transport = renderer_test.FakeTransport(remaining=171_490 - committed)
    _configure(
        monkeypatch,
        sources=sources,
        transport=second_transport,
        key=REPLACEMENT_KEY,
        now=observed,
    )
    def combined_probe(content: bytes):
        if content in first_transport.probes:
            return first_transport.probe(content)
        return second_transport.probe(content)

    monkeypatch.setattr(operator, "PROBE_AUDIO", combined_probe)
    result = operator.run_operator(
        action=operator.RENDER_ACTION,
        chapter_id=packet.chapter_id,
        output_root=root,
        observation_path=recovery_path,
        apply=True,
        verified_output_format=renderer.OUTPUT_FORMAT_ID,
    )
    assert result["status"] == "render_complete_pending_key_deletion_closeout"
    assert len(first_transport.post_calls) == 1
    assert len(second_transport.post_calls) == 15
    ledger = json.loads((root / packet.chapter_id / renderer.LEDGER_NAME).read_text())
    assert len(ledger["execution_sessions"]) == 2
    replacement = ledger["execution_sessions"][-1]
    assert replacement["continuation_mode"] == "recovery_only_replacement_key"
    assert replacement["key_credit_limit"] == packet.renderer_character_cap - committed
    assert replacement["partial_billable_requests_since_prior_session"] == 1
    assert renderer._parse_utc(
        replacement["replacement_key_creation_initiated_at"], "test"
    ) >= renderer._parse_utc(replacement["prior_key_deleted_at"], "test")
    assert replacement["provider_key_created_tooltip_directly_observed"] is True
    assert replacement["provider_key_expires_tooltip_directly_observed"] is True
    assert replacement["provider_key_timestamp_rounding_mode"] == "unknown"
    assert replacement["key_expiry_conservative_deadline"] == replacement[
        "key_expires_at_interval_lower"
    ]
    recovery_evidence = json.loads(
        (root.parent / result["execution_evidence_filename"]).read_text()
    )
    continuation = recovery_evidence["continuation"]
    assert continuation["partial_usage_ledger_credits"] == 1_175
    assert continuation[
        "partial_usage_ledger_billable_input_characters"
    ] == packet.requests[0].payload_character_count
    assert continuation["partial_usage_ledger_usd_unrounded"] == (
        f"{renderer._unrounded_usage_cost(packet.requests[0].payload_character_count):.4f}"
    )


def test_closeout_is_prevalidated_idempotent_and_derives_key_hash(
    tmp_path: Path, monkeypatch
) -> None:
    _result, root, packet, sources, transport, _observation, _path = _run_initial(
        tmp_path, monkeypatch
    )
    chapter = root / packet.chapter_id
    _events, state = renderer._load_state(
        chapter, packet=packet, sources=sources, root=root
    )
    closeout_observation = _closeout_observation(packet=packet, state=state)
    closeout_path = _write_private_json(
        tmp_path / "closeout-observation.json", closeout_observation
    )
    result = operator.run_operator(
        action=operator.CLOSEOUT_ACTION,
        chapter_id=packet.chapter_id,
        output_root=root,
        observation_path=closeout_path,
        apply=True,
    )
    assert result["status"] == "chapter_closeout_verified"
    final_path = chapter / renderer.CLOSEOUT_NAME
    before = final_path.read_bytes()
    second = operator.run_operator(
        action=operator.CLOSEOUT_ACTION,
        chapter_id=packet.chapter_id,
        output_root=root,
        observation_path=closeout_path,
        apply=True,
    )
    assert second["status"] == "chapter_closeout_verified"
    assert final_path.read_bytes() == before
    closeout = json.loads(before)
    assert closeout["key_id_sha256"] == hashlib.sha256(RAW_KEY_ID.encode()).hexdigest()
    assert closeout["key_material_sha256"] == state["sessions"][-1]["key_material_sha256"]
    assert closeout["audio_inventory_schema_version"] == 2
    assert closeout["ledger_billable_input_character_count_total"] == (
        packet.payload_character_count
    )
    assert closeout["ledger_input_character_usage_usd_unrounded"] == (
        f"{renderer._unrounded_usage_cost(packet.payload_character_count):.4f}"
    )
    assert closeout["projected_chapter_cost_ceiling_usd"] == str(
        renderer._projected_cost(packet.payload_character_count)
    )
    assert closeout["key_ui_time_evidence"] == (
        renderer._key_ui_time_evidence_from_session(state["sessions"][-1])
    )
    assert closeout["key_ui_time_evidence"][
        "key_expiry_conservative_deadline"
    ] == closeout["key_expiry_conservative_deadline"]
    assert RAW_KEY_ID not in final_path.read_text()
    assert not transport.responses


def test_exact_live_foothills_observation_maps_to_idempotent_schema3_closeout(
    tmp_path: Path, monkeypatch
) -> None:
    live_observation_path = renderer.LIVE_FOOTHILLS_CLOSEOUT_OBSERVATION_PATH
    live_root = live_observation_path.parent / renderer.OUTPUT_ROOT_BASENAME
    if not live_observation_path.is_file() or not live_root.is_dir():
        pytest.skip("bound private Foothills render evidence is not present")
    live_observation = json.loads(
        live_observation_path.read_text(encoding="utf-8")
    )
    live_execution_path = live_root.parent / live_observation[
        "render_evidence"
    ]["execution_evidence_filename"]
    live_paths = [live_observation_path, live_execution_path]
    live_paths.extend(path for path in live_root.rglob("*") if path.is_file())

    def live_snapshot() -> dict[str, tuple[int, int, int, str]]:
        return {
            str(path): (
                path.stat().st_mode & 0o777,
                path.stat().st_size,
                path.stat().st_mtime_ns,
                renderer._sha256_file(path),
            )
            for path in live_paths
        }

    before = live_snapshot()
    root = renderer_test._root(tmp_path)
    shutil.copytree(live_root, root)
    copied_observation_path = root.parent / "bound-live-closeout-observation.json"
    copied_execution_path = root.parent / live_execution_path.name
    shutil.copy2(live_observation_path, copied_observation_path)
    shutil.copy2(live_execution_path, copied_execution_path)
    copied_observation_path.chmod(0o600)
    copied_execution_path.chmod(0o600)
    chapter = root / "foothills_parkway"
    (chapter / renderer.CLOSEOUT_NAME).unlink(missing_ok=True)
    (chapter / renderer.PROVISIONAL_CLOSEOUT_NAME).unlink(missing_ok=True)

    real_output_root_hash = renderer._output_root_hash

    def bound_output_root_hash(path: Path) -> str:
        if path.resolve() == root.resolve():
            return renderer.LIVE_FOOTHILLS_OUTPUT_ROOT_SHA256
        return real_output_root_hash(path)

    monkeypatch.setattr(renderer, "_output_root_hash", bound_output_root_hash)
    monkeypatch.setattr(
        renderer,
        "LIVE_FOOTHILLS_CLOSEOUT_OBSERVATION_PATH",
        copied_observation_path,
    )
    sources = renderer_test._sources()
    monkeypatch.setattr(renderer, "load_audit_evidence", lambda: sources)
    monkeypatch.setattr(operator, "PROBE_AUDIO", renderer._strict_probe_mono_mp3)
    observed = renderer._parse_utc(live_observation["observed_at"], "test")
    monkeypatch.setattr(operator, "NOW", lambda: observed)

    with pytest.raises(renderer.NarrationError):
        renderer._validate_prior_sequence(
            root,
            chapter_id="mountain_crossing",
            sources=sources,
            probe_audio=renderer._strict_probe_mono_mp3,
        )

    ending = live_observation["ending_account"]
    provider = live_observation["provider_ui_evidence"]
    recreated_observation = {
        "schema_version": 2,
        "kind": "smokies_remaining_render_closeout_observation_v2",
        "observation_id": "smokies_recreated_foothills_closeout_v2",
        "source": "authenticated_browser",
        "observed_at": live_observation["observed_at"],
        "chapter_id": "foothills_parkway",
        "ending_provider_credits": ending["provider_credits_remaining"],
        "ending_billable_request_count": ending["billable_request_count"],
        "ending_total_usage_usd": ending["total_usage_usd"],
        "key_id": provider["key_id"],
        "key_deleted_at": provider["key_deleted_at"],
        "key_deletion_source": provider["key_deletion_source"],
        "key_deleted": True,
        "key_deletion_verified": True,
        "no_other_active_render_keys": True,
        "other_account_usage_observed": False,
        "privacy": {
            "account_identity_recorded": False,
            "workspace_identity_recorded": False,
            "key_material_recorded": False,
            "local_paths_recorded": False,
        },
    }
    recreated_path = _write_private_json(
        root.parent / "recreated-closeout-observation.json",
        recreated_observation,
    )
    with pytest.raises(
        renderer.NarrationError,
        match="legacy_live_closeout_observation_binding_invalid",
    ):
        operator.run_operator(
            action=operator.CLOSEOUT_ACTION,
            chapter_id="foothills_parkway",
            output_root=root,
            observation_path=recreated_path,
            apply=True,
        )
    assert not (chapter / renderer.CLOSEOUT_NAME).exists()

    first = operator.run_operator(
        action=operator.CLOSEOUT_ACTION,
        chapter_id="foothills_parkway",
        output_root=root,
        observation_path=copied_observation_path,
        apply=True,
    )
    closeout_path = chapter / renderer.CLOSEOUT_NAME
    first_bytes = closeout_path.read_bytes()
    second = operator.run_operator(
        action=operator.CLOSEOUT_ACTION,
        chapter_id="foothills_parkway",
        output_root=root,
        observation_path=copied_observation_path,
        apply=True,
    )
    assert first["status"] == second["status"] == "chapter_closeout_verified"
    assert first["chapter_closeout_sha256"] == second["chapter_closeout_sha256"]
    assert closeout_path.read_bytes() == first_bytes
    closeout = json.loads(first_bytes)
    assert closeout["schema_version"] == 3
    assert closeout["source_observation_sha256"] == (
        renderer.LIVE_FOOTHILLS_CLOSEOUT_OBSERVATION_SHA256
    )
    assert closeout["observed_at"] == "2026-08-11T09:00:47.409Z"
    assert closeout["ledger_provider_credit_cost_total"] == 11_775
    assert closeout["ledger_billable_input_character_count_total"] == 21_408
    assert closeout["ledger_input_character_usage_usd_unrounded"] == "2.1408"
    assert closeout["provider_reported_chapter_usage_usd"] == "2.14"
    assert closeout["projected_chapter_cost_ceiling_usd"] == "2.15"
    assert closeout["chapter_dollar_cap_usd"] == "2.50"
    assert closeout["audio_inventory_schema_version"] == 2
    unlocked = renderer._validate_prior_sequence(
        root,
        chapter_id="mountain_crossing",
        sources=sources,
        probe_audio=renderer._strict_probe_mono_mp3,
    )
    assert unlocked[:3] == (159_715, 30, Decimal("4.78"))
    assert not (root / "mountain_crossing").exists()
    assert first["network_used"] is second["network_used"] is False
    assert first["key_read"] is second["key_read"] is False
    assert live_snapshot() == before


def test_bad_closeout_never_creates_final_record(
    tmp_path: Path, monkeypatch
) -> None:
    _result, root, packet, sources, _transport, _observation, _path = _run_initial(
        tmp_path, monkeypatch
    )
    chapter = root / packet.chapter_id
    _events, state = renderer._load_state(
        chapter, packet=packet, sources=sources, root=root
    )
    observation = _closeout_observation(packet=packet, state=state)
    observation["ending_provider_credits"] += 1
    path = _write_private_json(tmp_path / "bad-closeout.json", observation)
    with pytest.raises(renderer.NarrationError):
        operator.run_operator(
            action=operator.CLOSEOUT_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
        )
    assert not renderer._path_present(chapter / renderer.CLOSEOUT_NAME)


def test_missing_usage_usd_creates_provisional_record_that_unlocks_nothing(
    tmp_path: Path, monkeypatch
) -> None:
    _result, root, packet, sources, transport, _observation, _path = _run_initial(
        tmp_path, monkeypatch
    )
    chapter = root / packet.chapter_id
    _events, state = renderer._load_state(
        chapter, packet=packet, sources=sources, root=root
    )
    observation = _closeout_observation(
        packet=packet, state=state, total_usage_available=False
    )
    path = _write_private_json(tmp_path / "provisional-closeout.json", observation)
    result = operator.run_operator(
        action=operator.CLOSEOUT_ACTION,
        chapter_id=packet.chapter_id,
        output_root=root,
        observation_path=path,
        apply=True,
    )
    assert result["next_chapter_unlocked"] is False
    assert result["qa_eligible"] is False
    provisional_path = chapter / renderer.PROVISIONAL_CLOSEOUT_NAME
    assert provisional_path.is_file()
    provisional = json.loads(provisional_path.read_text())
    assert provisional["audio_inventory_schema_version"] == 2
    assert provisional["ledger_billable_input_character_count_total"] == (
        packet.payload_character_count
    )
    assert provisional["final_usage_reconciliation_complete"] is False
    assert provisional["next_chapter_unlocked"] is False
    assert provisional["key_ui_time_evidence"] == (
        renderer._key_ui_time_evidence_from_session(state["sessions"][-1])
    )
    assert not renderer._path_present(chapter / renderer.CLOSEOUT_NAME)
    with pytest.raises(renderer.NarrationError):
        renderer._validate_prior_sequence(
            root,
            chapter_id="mountain_crossing",
            sources=sources,
            probe_audio=transport.probe,
        )


def test_observation_symlink_and_missing_audit_stop_before_key_and_network(
    tmp_path: Path, monkeypatch
) -> None:
    real_loader = renderer.load_audit_evidence
    missing_audit = tmp_path / "explicitly-absent-renderer-audit.json"
    monkeypatch.setattr(
        renderer,
        "load_audit_evidence",
        lambda: real_loader(missing_audit),
    )
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    target = _write_private_json(tmp_path / "target.json", {})
    link = tmp_path / "observation-link.json"
    link.symlink_to(target)
    counter: list[int] = []
    monkeypatch.setattr(operator, "KEY_READER", lambda: counter.append(1))
    with pytest.raises(renderer.NarrationError, match="renderer_audit_unreadable"):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=link,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert counter == []


def test_stale_operator_lock_file_is_reused_with_kernel_lock(tmp_path: Path) -> None:
    root = renderer_test._root(tmp_path)
    lock = root.parent / f".{root.name}.remaining-operator.lock"
    lock.write_text("stale-process\n")
    lock.chmod(0o600)
    with operator._operator_sentinel(root):
        assert operator.OPERATOR_CONTRACT in lock.read_text()


def test_ambiguous_dispatch_forbids_rotation_before_new_key_read(
    tmp_path: Path, monkeypatch
) -> None:
    sources = renderer_test._sources()
    packet = renderer.load_chapter_packet("foothills_parkway")
    root = renderer_test._root(tmp_path)
    observation = _render_observation(packet=packet, root=root, sources=sources)
    path = _write_private_json(tmp_path / "ambiguous-observation.json", observation)
    first_transport = renderer_test.FakeTransport([TimeoutError("ambiguous")])
    _configure(
        monkeypatch,
        sources=sources,
        transport=first_transport,
        key=RAW_KEY,
    )
    with pytest.raises(renderer.NarrationError, match="provider_transport_ambiguous"):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    reads: list[int] = []
    monkeypatch.setattr(operator, "KEY_READER", lambda: reads.append(1))
    with pytest.raises(
        renderer.NarrationError, match="manual_provider_reconciliation_required"
    ):
        operator.run_operator(
            action=operator.RENDER_ACTION,
            chapter_id=packet.chapter_id,
            output_root=root,
            observation_path=path,
            apply=True,
            verified_output_format=renderer.OUTPUT_FORMAT_ID,
        )
    assert reads == []
