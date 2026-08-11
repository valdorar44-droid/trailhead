from __future__ import annotations

import ast
import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Callable

import pytest

import scripts.build_smokies_remaining_audio_qa as builder


def _json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _synthetic_mp3(marker: int, *, frames: int = 20, mono: bool = True) -> bytes:
    header = bytes((0xFF, 0xFB, 0x90, 0xC0 if mono else 0x00))
    frame = header + bytes((marker % 251 + 1,)) * 413
    return frame * frames


def _prepare_full_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[Path, Callable[[bytes], builder.StrictAudioProbe]]:
    runtime = tmp_path / "runtime"
    preflight = (
        builder.REPOSITORY
        / "originals/smokies/elevenlabs_james_remaining_postpurchase_preflight_v2.json"
    )
    audit = runtime / "renderer-audit.json"
    dependencies = {
        builder._repo_relative(dependency_path): hashlib.sha256(
            dependency_path.read_bytes()
        ).hexdigest()
        for dependency_path in builder.RENDERER_DEPENDENCY_PATHS
    }
    _json(
        audit,
        {
            "schema_version": 1,
            "audit_id": "smokies_remaining_renderer_independent_audit_v1",
            "audited_at": "2026-08-11T05:45:00Z",
            "renderer_contract": builder.RENDERER_CONTRACT,
            "renderer_sha256": hashlib.sha256(
                builder.RENDERER_PATH.read_bytes()
            ).hexdigest(),
            "test_sha256": hashlib.sha256(
                builder.RENDERER_TEST_PATH.read_bytes()
            ).hexdigest(),
            "operator_sha256": hashlib.sha256(
                builder.OPERATOR_PATH.read_bytes()
            ).hexdigest(),
            "operator_test_sha256": hashlib.sha256(
                builder.OPERATOR_TEST_PATH.read_bytes()
            ).hexdigest(),
            "dependency_sha256": dependencies,
            "green_preflight_sha256": hashlib.sha256(
                preflight.read_bytes()
            ).hexdigest(),
            "checkpoint2_owner_approval_sha256": (
                builder.CHECKPOINT2_APPROVAL_SHA256
            ),
            "postpurchase_continuation_approval_sha256": (
                builder.STATIC_SOURCE_SPECS[
                    "postpurchase_continuation_approval"
                ]["sha256"]
            ),
            "independent_audit_passed": True,
            "p0_findings": 0,
            "p1_findings": 0,
            "dry_run_default_verified": True,
            "provider_calls_performed_by_audit": 0,
            "author_source_files_edited_by_auditor": 0,
            "audit_artifact_created_by_auditor": True,
        },
    )
    monkeypatch.setitem(builder.RUNTIME_SOURCE_PATHS, "renderer_audit", audit)
    original_relative = builder._repo_relative

    def fixture_relative(path: Path) -> str:
        try:
            return original_relative(path)
        except builder.AudioQaError:
            return f"test-fixtures/{path.name}"

    monkeypatch.setattr(builder, "_repo_relative", fixture_relative)

    root = tmp_path / builder.EXPECTED_RENDER_ROOT_BASENAME
    root.mkdir()
    _json(
        root / builder.ROOT_MARKER_NAME,
        {
            "schema_version": 1,
            "root_contract": builder.ROOT_CONTRACT,
            "renderer_contract": builder.RENDERER_CONTRACT,
            "product_id": builder.PRODUCT_ID,
            "output_root_sha256": hashlib.sha256(
                str(root).encode("utf-8")
            ).hexdigest(),
            "chapter_order": list(builder.CHAPTER_ORDER),
            "contains_api_key_material": False,
        },
    )
    probes: dict[str, builder.StrictAudioProbe] = {}
    starting_credits = builder.PREBATCH_BASELINE["remaining_provider_credits"]
    starting_requests = builder.PREBATCH_BASELINE["billable_request_count"]
    starting_usd = Decimal(builder.PREBATCH_BASELINE["total_usage_usd"])
    prior_closeout_sha: str | None = None
    marker = 0
    approval_sha = builder.STATIC_SOURCE_SPECS[
        "postpurchase_continuation_approval"
    ]["sha256"]
    preflight_sha = hashlib.sha256(preflight.read_bytes()).hexdigest()
    audit_sha = hashlib.sha256(audit.read_bytes()).hexdigest()

    for chapter_id in builder.CHAPTER_ORDER:
        spec = builder.LOCK_SPECS[chapter_id]
        lock = json.loads(spec["path"].read_text(encoding="utf-8"))
        chapter = root / chapter_id
        chapter.mkdir()
        items: dict[str, dict] = {}
        events: list[dict] = []
        inventory: list[dict] = []
        chapter_cost = 0
        prior_event = "0" * 64
        key_id_sha = hashlib.sha256(f"key-id-{chapter_id}".encode()).hexdigest()
        key_material_sha = hashlib.sha256(
            f"key-material:{chapter_id}".encode()
        ).hexdigest()
        event_clock = datetime(2026, 8, 11, 6, 0, tzinfo=UTC)

        def append_event(
            event_type: str,
            request_id: str | None,
            payload: dict,
        ) -> dict:
            nonlocal prior_event, event_clock
            event_clock += timedelta(seconds=1)
            event = {
                "seq": len(events) + 1,
                "event_type": event_type,
                "at": event_clock.isoformat().replace("+00:00", "Z"),
                "provider_request_id": request_id,
                "payload": payload,
                "previous_event_sha256": prior_event,
            }
            event["event_sha256"] = builder._canonical_sha256(event)
            events.append(event)
            prior_event = event["event_sha256"]
            return event

        caps = {
            "renderer_characters": spec["renderer_character_cap"],
            "api_key_credits": spec["one_day_key_credit_quota"],
            "reserved_provider_credits": spec[
                "reserved_provider_credit_ceiling"
            ],
            "dollars_usd": spec["dollar_cap_usd"],
            "rerenders": 0,
            "cross_chapter_borrowing": False,
            "paid_overage": False,
        }
        initial_event = append_event(
            "ledger_initialized",
            None,
            {
                "renderer_contract": builder.RENDERER_CONTRACT,
                "chapter_id": chapter_id,
                "lock_id": lock["lock_id"],
                "lock_sha256": spec["sha256"],
                "checkpoint2_owner_approval_sha256": (
                    builder.CHECKPOINT2_APPROVAL_SHA256
                ),
                "postpurchase_continuation_approval_sha256": approval_sha,
                "green_preflight_sha256": preflight_sha,
                "renderer_audit_sha256": audit_sha,
                "operator_sha256": hashlib.sha256(
                    builder.OPERATOR_PATH.read_bytes()
                ).hexdigest(),
                "operator_test_sha256": hashlib.sha256(
                    builder.OPERATOR_TEST_PATH.read_bytes()
                ).hexdigest(),
                "dependency_sha256": dependencies,
                "output_root_sha256": hashlib.sha256(
                    str(root).encode("utf-8")
                ).hexdigest(),
                "provider": "elevenlabs",
                "voice_id": builder.VOICE_ID,
                "model_id": builder.MODEL_ID,
                "language_code": "en",
                "output_format_id": builder.OUTPUT_FORMAT_ID,
                "request_count": len(lock["requests"]),
                "request_inventory_sha256": builder._request_inventory_hash(
                    lock["requests"]
                ),
                "caps": caps,
                "provider_usage_baseline": builder.PREBATCH_BASELINE,
            },
        )
        session_expires_at = datetime(2026, 8, 12, 6, 0, tzinfo=UTC)
        session_created_at = session_expires_at - timedelta(seconds=86_400)
        session_payload = {
            "available_credits": starting_credits,
            "continuation": False,
            "continuation_mode": "initial",
            "evidence_sha256": preflight_sha,
            "key_credit_limit": spec["one_day_key_credit_quota"],
            "key_created_at_derived": session_created_at.isoformat().replace(
                "+00:00", "Z"
            ),
            "key_created_at_derivation": (
                "provider_get_expires_at_unix_minus_official_ui_"
                "requested_ttl_seconds"
            ),
            "key_created_at_directly_observed": False,
            "key_expires_at": session_expires_at.isoformat().replace(
                "+00:00", "Z"
            ),
            "key_id_sha256": key_id_sha,
            "key_material_sha256": key_material_sha,
            "key_session_number": 1,
            "provider_key_name_sha256": hashlib.sha256(
                (
                    "trailhead-smokies-james-"
                    f"{builder.KEY_NAME_CODES[chapter_id]}-session-1"
                ).encode("utf-8")
            ).hexdigest(),
            "provider_key_matching_row_count": 1,
            "provider_key_row_unique": True,
            "key_preview_sha256": hashlib.sha256(
                f"preview:{chapter_id}".encode()
            ).hexdigest(),
            "ledger_character_cost_total_at_start": 0,
            "ledger_request_count_at_start": 0,
            "observed_at": "2026-08-11T06:00:00Z",
            "observed_billable_request_count": starting_requests,
            "observed_total_usage_usd": f"{starting_usd:.2f}",
            "partial_billable_requests_since_prior_session": 0,
            "partial_usage_credits_since_prior_session": 0,
            "prior_key_deleted_and_verified": False,
            "prior_key_deleted_at": None,
            "prior_key_id_sha256": None,
            "provider_key_expires_at_unix": int(session_expires_at.timestamp()),
            "remaining_batch_renderer_cap": sum(
                builder.LOCK_SPECS[value]["renderer_character_cap"]
                for value in builder.CHAPTER_ORDER[
                    builder.CHAPTER_ORDER.index(chapter_id) :
                ]
            ),
            "replacement_key_creation_initiated_at": None,
            "requested_ttl_seconds": 86_400,
            "expiry_directly_observed": True,
        }
        append_event("execution_session_started", None, session_payload)
        preflight_payload = {
            "evidence_sha256": preflight_sha,
            "metadata_sha256": hashlib.sha256(b"voice-metadata").hexdigest(),
            "settings_sha256": hashlib.sha256(b"voice-settings").hexdigest(),
            "subscription_sha256": hashlib.sha256(b"subscription").hexdigest(),
            "subscription_remaining_credits": starting_credits,
            "model_id": builder.MODEL_ID,
            "language_code": "en",
            "output_format_id": builder.OUTPUT_FORMAT_ID,
            "request_voice_settings": builder.VOICE_SETTINGS,
            "stored_voice_settings_relied_on": False,
            "beta_services_used": False,
            "custom_credit_multiplier": "1",
            "sharing_status": "copied",
            "voice_library_rate": "1",
            "withdrawal_notice_period": "730",
        }
        append_event("provider_preflight_passed", None, preflight_payload)

        for request in sorted(lock["requests"], key=lambda row: row["stable_order"]):
            marker += 1
            request_id = request["provider_request_id"]
            audio = _synthetic_mp3(marker)
            audio_sha = hashlib.sha256(audio).hexdigest()
            duration = request["word_count"] / 150.0 * 60.0
            probe = builder.StrictAudioProbe(
                sha256=audio_sha,
                byte_count=len(audio),
                sample_rate_hz=44_100,
                bitrate_kbps=128,
                channels=1,
                frame_count=20,
                duration_s=duration,
                id3v2_bytes=0,
                id3v1_bytes=0,
                frame_bytes=len(audio),
                all_bytes_accounted_for=True,
            )
            probes[audio_sha] = probe
            filename = f"{request['stable_order']:02d}-{request_id}.mp3"
            metadata_name = f"{request['stable_order']:02d}-{request_id}.json"
            (chapter / filename).write_bytes(audio)
            cost = request["normalized_character_count"]
            chapter_cost += cost
            fingerprint = hashlib.sha256(f"fingerprint:{request_id}".encode()).hexdigest()
            audio_evidence = {
                "bitrate_kbps": 128,
                "byte_count": len(audio),
                "duration_s": round(duration, 6),
                "frame_count": 20,
                "sample_rate_hz": 44_100,
                "sha256": audio_sha,
                "channels": 1,
            }
            append_event(
                "request_reserved",
                request_id,
                {"request_fingerprint": fingerprint},
            )
            append_event(
                "request_dispatched",
                request_id,
                {
                    "attempt": 1,
                    "evidence_sha256": preflight_sha,
                    "request_fingerprint": fingerprint,
                },
            )
            accepted_payload = {
                "attempt": 1,
                "request_fingerprint": fingerprint,
                "character_cost": cost,
                "projected_cost_usd": str(builder._projected_cost(cost)),
                "content_type": "audio/mpeg",
                "response_sha256": audio_sha,
                "response_bytes": len(audio),
                "provider_request_id_sha256": hashlib.sha256(
                    f"provider-id:{request_id}".encode()
                ).hexdigest(),
                "provider_trace_id_sha256": hashlib.sha256(
                    f"trace-id:{request_id}".encode()
                ).hexdigest(),
                "audio": audio_evidence,
                "words_per_minute": 150.0,
                "accepted_at": event_clock.isoformat().replace("+00:00", "Z"),
                "stage_audio_file": f".{filename}.accepted.pending",
                "stage_metadata_file": f".{metadata_name}.accepted.pending",
            }
            accepted_event = append_event(
                "audio_accepted", request_id, accepted_payload
            )
            completed_event = append_event(
                "request_completed",
                request_id,
                {
                    "accepted_event_sha256": accepted_event["event_sha256"],
                    "master_file": filename,
                    "metadata_file": metadata_name,
                },
            )
            item = {
                "state": "completed",
                "stable_order": request["stable_order"],
                "entry_id": request["entry_id"],
                "request_kind": request["request_kind"],
                "base_variant_id": request["base_variant_id"],
                "override_variant_id": request["override_variant_id"],
                "effective_variant_ids": request["effective_variant_ids"],
                "raw_transcript_sha256": request["raw_transcript_sha256"],
                "normalized_transcript_sha256": request[
                    "normalized_transcript_sha256"
                ],
                "word_count": request["word_count"],
                "payload_character_count": request["payload_character_count"],
                "normalized_character_count": request[
                    "normalized_character_count"
                ],
                "reserved_provider_credit_ceiling": request[
                    "reserved_provider_credit_ceiling"
                ],
                "attempts": 1,
                "request_fingerprint": fingerprint,
                "accepted": {
                    **accepted_payload,
                    "accepted_event_sha256": accepted_event["event_sha256"],
                },
                "completion": {
                    **completed_event["payload"],
                    "completed_at": completed_event["at"],
                },
            }
            items[request_id] = item
            _json(
                chapter / metadata_name,
                {
                    "schema_version": 2,
                    "renderer_contract": builder.RENDERER_CONTRACT,
                    "chapter_id": chapter_id,
                    "lock_id": lock["lock_id"],
                    "lock_sha256": spec["sha256"],
                    "provider_request_id": request_id,
                    "entry_id": request["entry_id"],
                    "request_kind": request["request_kind"],
                    "base_variant_id": request["base_variant_id"],
                    "override_variant_id": request["override_variant_id"],
                    "effective_variant_ids": request["effective_variant_ids"],
                    "raw_transcript_sha256": request["raw_transcript_sha256"],
                    "normalized_transcript_sha256": request[
                        "normalized_transcript_sha256"
                    ],
                    "provider": "elevenlabs",
                    "voice_id": builder.VOICE_ID,
                    "voice_name": builder.VOICE_NAME,
                    "model_id": builder.MODEL_ID,
                    "language_code": "en",
                    "output_format_id": builder.OUTPUT_FORMAT_ID,
                    "voice_settings": builder.VOICE_SETTINGS,
                    "request_fingerprint": fingerprint,
                    "character_cost": cost,
                    "projected_cost_usd": str(builder._projected_cost(cost)),
                    "content_type": "audio/mpeg",
                    "response_sha256": audio_sha,
                    "response_bytes": len(audio),
                    "provider_request_id_sha256": accepted_payload[
                        "provider_request_id_sha256"
                    ],
                    "provider_trace_id_sha256": accepted_payload[
                        "provider_trace_id_sha256"
                    ],
                    "accepted_at": accepted_payload["accepted_at"],
                    "audio": audio_evidence,
                    "words_per_minute": 150.0,
                    "provider_native_lossy_source": True,
                    "lossless_or_wav_claimed": False,
                    "accepted_bytes_never_regenerated": True,
                },
            )
            inventory.append(
                {
                    "provider_request_id": request_id,
                    "raw_transcript_sha256": request["raw_transcript_sha256"],
                    "master_file": filename,
                    "metadata_file": metadata_name,
                    "audio_sha256": audio_sha,
                    "audio_bytes": len(audio),
                    "duration_s": round(duration, 6),
                    "words_per_minute": 150.0,
                    "character_cost": cost,
                }
            )
        complete_event = append_event(
            "chapter_render_complete",
            None,
            {
                "provider_request_count": len(lock["requests"]),
                "character_cost_total": chapter_cost,
                "projected_cost_usd": str(builder._projected_cost(chapter_cost)),
                "rerender_count": 0,
                "status": "render_complete_pending_key_deletion_closeout",
            },
        )
        events_path = chapter / "render-events.ndjson"
        events_path.write_text(
            "".join(
                json.dumps(event, sort_keys=True, separators=(",", ":")) + "\n"
                for event in events
            ),
            encoding="utf-8",
        )
        ledger = {
            "schema_version": 2,
            "renderer_contract": builder.RENDERER_CONTRACT,
            "chapter_id": chapter_id,
            "lock_id": lock["lock_id"],
            "lock_sha256": spec["sha256"],
            "created_at": initial_event["at"],
            "updated_at": complete_event["at"],
            "status": "render_complete_pending_key_deletion_closeout",
            "blocked_reason": None,
            "render_event_count": len(events),
            "render_event_head_sha256": prior_event,
            "execution_sessions": [session_payload],
            "provider_preflights": [preflight_payload],
            "caps": caps,
            "character_cost_total": chapter_cost,
            "projected_cost_usd": str(builder._projected_cost(chapter_cost)),
            "items": items,
        }
        ledger_path = chapter / "render-ledger.json"
        _json(ledger_path, ledger)
        ending_credits = starting_credits - chapter_cost
        ending_requests = starting_requests + spec["provider_request_count"]
        ledger_usd = (Decimal(chapter_cost) / Decimal(10_000)).quantize(
            Decimal("0.0001")
        )
        ending_usd = (starting_usd + ledger_usd).quantize(Decimal("0.01"))
        chapter_usd = ending_usd - starting_usd
        source_observation_sha = hashlib.sha256(
            f"closeout-observation:{chapter_id}".encode()
        ).hexdigest()
        closeout = {
            "schema_version": 2,
            "closeout_id": f"smokies_closeout_{source_observation_sha[:32]}",
            "source": "authenticated_provider_usage_and_key_management_ui",
            "source_observation_sha256": source_observation_sha,
            "observed_at": "2026-08-11T08:00:00Z",
            "renderer_contract": builder.RENDERER_CONTRACT,
            "chapter_id": chapter_id,
            "render_event_count": len(events),
            "render_event_head_sha256": prior_event,
            "render_ledger_sha256": hashlib.sha256(ledger_path.read_bytes()).hexdigest(),
            "audio_inventory_sha256": builder._canonical_sha256(inventory),
            "prior_closeout_sha256": prior_closeout_sha,
            "key_id_sha256": key_id_sha,
            "key_material_sha256": key_material_sha,
            "key_deleted": True,
            "key_deletion_verified": True,
            "no_other_active_render_keys": True,
            "starting_provider_credits": starting_credits,
            "ending_provider_credits": ending_credits,
            "ledger_character_cost_total": chapter_cost,
            "provider_reported_usage_credits": chapter_cost,
            "starting_billable_request_count": starting_requests,
            "ending_billable_request_count": ending_requests,
            "provider_reported_request_count": spec["provider_request_count"],
            "starting_total_usage_usd": f"{starting_usd:.2f}",
            "ending_total_usage_usd": f"{ending_usd:.2f}",
            "provider_reported_chapter_usage_usd": f"{chapter_usd:.2f}",
            "ledger_usage_usd_unrounded": f"{ledger_usd:.4f}",
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
                "chapter_usage_usd": (
                    "derived_difference_of_observed_rounded_totals"
                ),
                "ledger_usage_usd": "ledger_character_cost_at_locked_rate",
            },
            "prebatch_baseline": builder.PREBATCH_BASELINE,
            "account_credit_reconciliation_passed": True,
            "usage_credit_reconciliation_passed": True,
            "request_count_reconciliation_passed": True,
            "dollar_reconciliation_passed": True,
            "other_account_usage_observed": False,
            "rerender_count": 0,
            "paid_overage_used": False,
        }
        closeout_path = chapter / "chapter-closeout.json"
        _json(closeout_path, closeout)
        prior_closeout_sha = hashlib.sha256(closeout_path.read_bytes()).hexdigest()
        starting_credits = ending_credits
        starting_requests = ending_requests
        starting_usd = ending_usd

    def fake_probe(content: bytes) -> builder.StrictAudioProbe:
        digest = hashlib.sha256(content).hexdigest()
        if digest not in probes:
            raise builder.AudioQaError("fixture MP3 identity is unknown")
        return probes[digest]

    return root, fake_probe


def test_default_fails_cleanly_before_external_outputs_exist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TRAILHEAD_SMOKIES_JAMES_REMAINING_ROOT", raising=False)
    with pytest.raises(SystemExit, match="External 72-file render evidence"):
        builder.main([])


def test_strict_mp3_probe_requires_complete_mono_44100_128_frames() -> None:
    content = _synthetic_mp3(7)
    probe = builder._strict_mp3_probe(content)
    assert probe.byte_count == len(content)
    assert probe.sample_rate_hz == 44_100
    assert probe.bitrate_kbps == 128
    assert probe.channels == 1
    assert probe.frame_count == 20
    assert probe.frame_bytes == len(content)
    assert probe.all_bytes_accounted_for is True
    with pytest.raises(builder.AudioQaError, match="truncated|completeness"):
        builder._strict_mp3_probe(content[:-1])
    with pytest.raises(builder.AudioQaError, match="structure|channel"):
        builder._strict_mp3_probe(_synthetic_mp3(7, mono=False))
    with pytest.raises(builder.AudioQaError, match="header|non-frame|completeness"):
        builder._strict_mp3_probe(content + b"x")


def test_full_72_file_qa_and_representative_listening_set(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, probe = _prepare_full_fixture(tmp_path, monkeypatch)
    value = builder.build(root, probe_audio=probe)
    assert value["status"] == "technical_qa_passed_owner_media_acceptance_required"
    assert value["aggregate"]["mp3_count"] == 72
    assert value["aggregate"]["unique_audio_sha256_count"] == 72
    assert value["aggregate"]["provider_attempt_count"] == 72
    assert value["aggregate"]["audio_accepted_event_count"] == 72
    assert value["aggregate"]["request_completed_event_count"] == 72
    assert value["aggregate"]["retry_count"] == 0
    assert value["aggregate"]["rerender_count"] == 0
    assert value["aggregate"]["ambiguous_response_count"] == 0
    assert value["aggregate"]["all_keys_deleted_and_verified"] is True
    assert len(value["audio_assets"]) == 72
    closeouts = value["provider_closeouts"]["chapters"]
    assert closeouts[0]["prior_closeout_sha256"] is None
    assert closeouts[1]["prior_closeout_sha256"] == closeouts[0]["sha256"]
    assert closeouts[2]["prior_closeout_sha256"] == closeouts[1]["sha256"]
    assert all(row["dollar_reconciliation_passed"] for row in closeouts)
    assert all(row["all_bytes_accounted_for"] for row in value["audio_assets"])
    listening = value["representative_owner_listening_set"]
    assert listening["all_flags_included"] is True
    assert set(listening["required_chapter_directions"]).issubset(
        listening["covered_chapter_directions"]
    )
    assert set(listening["all_flagged_provider_request_ids"]).issubset(
        {row["provider_request_id"] for row in listening["items"]}
    )
    assert value["acceptance_boundary"]["owner_media_acceptance"] is False
    assert value["acceptance_boundary"]["upload_allowed"] is False
    assert value["acceptance_boundary"]["publication_allowed"] is False
    serialized = builder.serialize(value)
    assert str(tmp_path) not in serialized
    assert "/home/" not in serialized
    assert "C:\\Users" not in serialized


def test_retry_or_duplicate_attempt_fails_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, probe = _prepare_full_fixture(tmp_path, monkeypatch)
    path = root / builder.CHAPTER_ORDER[0] / "render-ledger.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    first = next(iter(value["items"].values()))
    first["attempts"] = 2
    _json(path, value)
    with pytest.raises(builder.AudioQaError, match="retried or duplicated"):
        builder.build(root, probe_audio=probe)


def test_broken_event_hash_chain_fails_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, probe = _prepare_full_fixture(tmp_path, monkeypatch)
    path = root / builder.CHAPTER_ORDER[0] / "render-events.ndjson"
    lines = path.read_text(encoding="utf-8").splitlines()
    event = json.loads(lines[0])
    event["payload"]["request_count"] += 1
    lines[0] = json.dumps(event, sort_keys=True, separators=(",", ":"))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    with pytest.raises(builder.AudioQaError, match="hash does not bind"):
        builder.build(root, probe_audio=probe)


def test_missing_key_closeout_fails_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, probe = _prepare_full_fixture(tmp_path, monkeypatch)
    path = root / builder.CHAPTER_ORDER[0] / "chapter-closeout.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    value["key_deleted"] = False
    _json(path, value)
    with pytest.raises(builder.AudioQaError, match="key/provider closeout"):
        builder.build(root, probe_audio=probe)


def test_dollar_reconciliation_drift_fails_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, probe = _prepare_full_fixture(tmp_path, monkeypatch)
    path = root / builder.CHAPTER_ORDER[0] / "chapter-closeout.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    value["ending_total_usage_usd"] = "99.99"
    _json(path, value)
    with pytest.raises(builder.AudioQaError, match="dollar reconciliation"):
        builder.build(root, probe_audio=probe)


def test_cross_chapter_closeout_hash_drift_fails_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, probe = _prepare_full_fixture(tmp_path, monkeypatch)
    path = root / builder.CHAPTER_ORDER[1] / "chapter-closeout.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    value["prior_closeout_sha256"] = "0" * 64
    _json(path, value)
    with pytest.raises(builder.AudioQaError, match="key/provider closeout"):
        builder.build(root, probe_audio=probe)


def test_unexpected_external_file_fails_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, probe = _prepare_full_fixture(tmp_path, monkeypatch)
    (root / builder.CHAPTER_ORDER[0] / "unexpected.bin").write_bytes(b"x")
    with pytest.raises(builder.AudioQaError, match="inventory drifted"):
        builder.build(root, probe_audio=probe)


def test_renderer_audit_drift_fails_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, probe = _prepare_full_fixture(tmp_path, monkeypatch)
    path = builder.RUNTIME_SOURCE_PATHS["renderer_audit"]
    value = json.loads(path.read_text(encoding="utf-8"))
    value["p1_findings"] = 1
    _json(path, value)
    with pytest.raises(builder.AudioQaError, match="renderer audit is invalid"):
        builder.build(root, probe_audio=probe)


@pytest.mark.parametrize(
    ("field", "bad_value"),
    (
        ("provider_key_name_sha256", "0" * 64),
        ("provider_key_matching_row_count", 2),
        ("provider_key_row_unique", False),
        ("key_preview_sha256", "x" * 64),
        ("provider_key_expires_at_unix", 1),
        ("key_created_at_derived", "2026-08-10T00:00:00Z"),
    ),
)
def test_exact_key_identity_and_derived_expiry_session_contract(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    bad_value: object,
) -> None:
    root, _probe = _prepare_full_fixture(tmp_path, monkeypatch)
    chapter_id = builder.CHAPTER_ORDER[0]
    ledger = json.loads(
        (root / chapter_id / "render-ledger.json").read_text(encoding="utf-8")
    )
    builder._validate_session_preflight_contract(
        chapter_id=chapter_id,
        sessions=ledger["execution_sessions"],
        preflights=ledger["provider_preflights"],
    )
    drifted = json.loads(json.dumps(ledger["execution_sessions"]))
    drifted[0][field] = bad_value
    with pytest.raises(builder.AudioQaError, match="session|expiry"):
        builder._validate_session_preflight_contract(
            chapter_id=chapter_id,
            sessions=drifted,
            preflights=ledger["provider_preflights"],
        )


def test_recovery_key_rotation_session_is_exact_and_ordered(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, _probe = _prepare_full_fixture(tmp_path, monkeypatch)
    chapter_id = builder.CHAPTER_ORDER[0]
    ledger = json.loads(
        (root / chapter_id / "render-ledger.json").read_text(encoding="utf-8")
    )
    initial = ledger["execution_sessions"][0]
    initial_preflight = ledger["provider_preflights"][0]
    recovery_expires = datetime(2026, 8, 12, 7, 1, tzinfo=UTC)
    recovery = {
        **initial,
        "available_credits": initial["available_credits"] - 1_000,
        "continuation": True,
        "continuation_mode": "recovery_only_replacement_key",
        "evidence_sha256": hashlib.sha256(b"recovery-evidence").hexdigest(),
        "key_credit_limit": (
            builder.LOCK_SPECS[chapter_id]["renderer_character_cap"] - 1_000
        ),
        "key_created_at_derived": (
            recovery_expires - timedelta(seconds=86_400)
        ).isoformat().replace("+00:00", "Z"),
        "key_expires_at": recovery_expires.isoformat().replace("+00:00", "Z"),
        "key_id_sha256": hashlib.sha256(b"recovery-key-id").hexdigest(),
        "key_material_sha256": hashlib.sha256(b"recovery-key-material").hexdigest(),
        "key_session_number": 2,
        "provider_key_name_sha256": hashlib.sha256(
            b"trailhead-smokies-james-fp-session-2"
        ).hexdigest(),
        "key_preview_sha256": hashlib.sha256(b"WXYZ").hexdigest(),
        "ledger_character_cost_total_at_start": 1_000,
        "ledger_request_count_at_start": 1,
        "observed_at": "2026-08-11T07:02:00Z",
        "observed_billable_request_count": initial[
            "observed_billable_request_count"
        ]
        + 1,
        "observed_total_usage_usd": "2.74",
        "partial_billable_requests_since_prior_session": 1,
        "partial_usage_credits_since_prior_session": 1_000,
        "prior_key_deleted_and_verified": True,
        "prior_key_deleted_at": "2026-08-11T07:00:00Z",
        "prior_key_id_sha256": initial["key_id_sha256"],
        "provider_key_expires_at_unix": int(recovery_expires.timestamp()),
        "remaining_batch_renderer_cap": (
            initial["remaining_batch_renderer_cap"] - 1_000
        ),
        "replacement_key_creation_initiated_at": "2026-08-11T07:01:00Z",
    }
    recovery_preflight = {
        **initial_preflight,
        "evidence_sha256": recovery["evidence_sha256"],
        "subscription_remaining_credits": recovery["available_credits"],
    }
    builder._validate_session_preflight_contract(
        chapter_id=chapter_id,
        sessions=[initial, recovery],
        preflights=[initial_preflight, recovery_preflight],
    )
    wrong_static = {
        **recovery,
        "remaining_batch_renderer_cap": initial["remaining_batch_renderer_cap"],
    }
    with pytest.raises(builder.AudioQaError, match="residual exposure"):
        builder._validate_session_preflight_contract(
            chapter_id=chapter_id,
            sessions=[initial, wrong_static],
            preflights=[initial_preflight, recovery_preflight],
        )
    recovery["replacement_key_creation_initiated_at"] = "2026-08-11T06:59:00Z"
    with pytest.raises(builder.AudioQaError, match="recovery session"):
        builder._validate_session_preflight_contract(
            chapter_id=chapter_id,
            sessions=[initial, recovery],
            preflights=[initial_preflight, recovery_preflight],
        )


def test_builder_has_no_network_provider_or_database_dependency() -> None:
    source = Path(builder.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imports = {
        alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    }
    assert not imports.intersection(
        {"requests", "urllib", "httpx", "socket", "sqlite3", "subprocess"}
    )
    forbidden = (
        "/home/" + "sean",
        "C:" + "\\Users\\User",
        "wsl" + ".localhost",
        "xi-" + "api-key",
    )
    test_source = Path(__file__).read_text(encoding="utf-8")
    assert all(value not in source for value in forbidden)
    assert all(value not in test_source for value in forbidden)
