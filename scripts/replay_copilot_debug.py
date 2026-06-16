#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dashboard.server import _build_extreme_map_action  # type: ignore


def load_bundle_from_db(db_path: Path, limit: int) -> dict[str, Any]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        action_rows = conn.execute(
            """
            SELECT id, session_id, trip_id, command, action_type, status, payload, created_at
            FROM extreme_copilot_actions
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (max(1, limit),),
        ).fetchall()
        debug_rows = conn.execute(
            """
            SELECT id, session_id, trip_id, user_id, event_type, event_data, created_at
            FROM extreme_ledger_events
            WHERE event_type = 'copilot_admin_debug_snapshot'
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (max(1, limit),),
        ).fetchall()
    finally:
        conn.close()

    return {
        "actions": [normalize_action_row(row) for row in action_rows],
        "debug_snapshots": [normalize_debug_row(row) for row in debug_rows],
    }


def normalize_action_row(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    try:
        item["payload"] = json.loads(item.get("payload") or "{}")
    except Exception:
        item["payload"] = {}
    return item


def normalize_debug_row(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    try:
        item["event_data"] = json.loads(item.get("event_data") or "{}")
    except Exception:
        item["event_data"] = {}
    return item


def load_bundle(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text())
    data.setdefault("actions", [])
    data.setdefault("debug_snapshots", [])
    return data


def compare_actions(expected: dict[str, Any], replayed: dict[str, Any]) -> dict[str, Any]:
    expected_args = expected.get("args") if isinstance(expected.get("args"), dict) else {}
    replayed_args = replayed.get("args") if isinstance(replayed.get("args"), dict) else {}
    mismatches: list[str] = []
    if expected.get("action_type") != replayed.get("action_type"):
        mismatches.append(f"action_type {expected.get('action_type')} -> {replayed.get('action_type')}")
    if bool(expected.get("requires_confirmation")) != bool(replayed.get("requires_confirmation")):
        mismatches.append(
            f"requires_confirmation {bool(expected.get('requires_confirmation'))} -> {bool(replayed.get('requires_confirmation'))}"
        )
    expected_keys = sorted(expected_args.keys())
    replayed_keys = sorted(replayed_args.keys())
    if expected_keys != replayed_keys:
        mismatches.append(f"arg_keys {expected_keys} -> {replayed_keys}")
    for key in ("category", "query", "keyword", "route_scoped", "open_card", "style"):
        if expected_args.get(key) != replayed_args.get(key):
            mismatches.append(f"args.{key} {expected_args.get(key)!r} -> {replayed_args.get(key)!r}")
    return {
        "ok": not mismatches,
        "mismatches": mismatches,
    }


def replay_action_cases(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in actions:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
        provider = str(payload.get("provider") or "trailhead_openai")
        original = payload.get("map_action") if isinstance(payload.get("map_action"), dict) else {}
        command = str(row.get("command") or "").strip()
        if not command or not context or not original:
            continue
        replayed = _build_extreme_map_action(command, context, provider)
        diff = compare_actions(original, replayed)
        out.append(
            {
                "action_id": row.get("id"),
                "session_id": row.get("session_id"),
                "created_at": row.get("created_at"),
                "command": command,
                "original_action_type": original.get("action_type"),
                "replayed_action_type": replayed.get("action_type"),
                "ok": diff["ok"],
                "mismatches": diff["mismatches"],
            }
        )
    return out


def action_index_by_session(actions: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for row in actions:
        session_id = str(row.get("session_id") or "").strip()
        if not session_id:
            continue
        index.setdefault(session_id, []).append(row)
    for rows in index.values():
        rows.sort(key=lambda item: int(item.get("created_at") or 0))
    return index


def _looks_like_route_session(command: str | None, action_type: str | None, transcript: str) -> bool:
    action_text = str(action_type or "").strip().lower()
    command_text = str(command or "").strip().lower()
    transcript_text = transcript.lower()
    if action_text in {"start_route_scout", "save_scout_to_route_builder"}:
        return True
    route_terms = (
        " my route",
        " the route",
        "route corridor",
        "route summary",
        "overnight",
        "loop me",
        "along the route",
    )
    return any(term in f" {command_text}" for term in route_terms) or any(term in transcript_text for term in route_terms)


def _extract_overnight_labels(transcript: str) -> list[str]:
    labels: list[str] = []
    for line in transcript.splitlines():
        text = line.strip()
        if not text.startswith("- assistant:"):
            continue
        body = text[len("- assistant:") :].strip()
        for marker in ("stay at ", "overnight at "):
            if marker not in body.lower():
                continue
            lower_body = body.lower()
            start = lower_body.find(marker) + len(marker)
            tail = body[start:]
            label = tail.split(".")[0].split(";")[0].strip()
            if label:
                labels.append(label)
    return labels


def _is_placeholder_overnight_label(label: str) -> bool:
    text = label.strip().lower()
    if not text:
        return True
    placeholders = {
        "campsite",
        "campground",
        "camp",
        "review area",
        "overnight stop",
        "overnight area",
    }
    if text in placeholders:
        return True
    if text.startswith("review area near "):
        return False
    return False


def snapshot_symptoms(snapshot: dict[str, Any]) -> dict[str, Any]:
    payload = snapshot.get("event_data") if isinstance(snapshot.get("event_data"), dict) else {}
    transcript = str(payload.get("transcript") or "")
    result_context = payload.get("result_context") if isinstance(payload.get("result_context"), dict) else {}
    visible = result_context.get("visible_features") if isinstance(result_context.get("visible_features"), list) else []
    visible_types = [str(item.get("type") or "").lower() for item in visible if isinstance(item, dict)]
    top_visible_types = visible_types[:5]
    current_result_set_id = result_context.get("current_result_set_id")
    query_context = result_context.get("query_context") if isinstance(result_context.get("query_context"), dict) else {}
    fuelish = sum(1 for kind in visible_types if kind in {"fuel", "grocery", "shop"})
    top_fuelish = sum(1 for kind in top_visible_types if kind in {"fuel", "grocery", "shop"})
    symptom_flags: list[str] = []
    overnight_labels = _extract_overnight_labels(transcript)
    review_area_count = transcript.lower().count("review area")

    if "I could not draw that route yet." in transcript:
        symptom_flags.append("route_not_drawn")
    if "Found 0 overnight stops along the route." in transcript:
        symptom_flags.append("zero_overnights")
    if "Overnights are Day" in transcript and "Campsite" in transcript:
        symptom_flags.append("generic_campsite_summary")
    if review_area_count and ("Overnights are Day" in transcript or any("stay at " in line.lower() for line in transcript.splitlines())):
        symptom_flags.append("review_area_presented_as_confirmed_overnight")
    if any(_is_placeholder_overnight_label(label) for label in overnight_labels):
        symptom_flags.append("confirmed_overnight_without_name")
    if "Watch the route corridor for addable fuel, viewpoint, trailhead, food, and town stops around each overnight window." in transcript:
        symptom_flags.append("corridor_filler_sentence")
    if transcript.count("Voice action staged.") >= 2 and transcript.count("startRouteScout") >= 2:
        symptom_flags.append("repeated_route_scout_attempts")
    if not current_result_set_id and not query_context and visible and (
        fuelish >= max(3, len(visible_types) // 2) or (len(top_visible_types) >= 4 and top_fuelish >= 4)
    ):
        symptom_flags.append("visible_fuel_pollution")
        if _looks_like_route_session(None, None, transcript):
            symptom_flags.append("route_session_visible_fuel_pollution")

    score = len(symptom_flags)
    return {
        "snapshot_id": snapshot.get("id"),
        "session_id": snapshot.get("session_id"),
        "created_at": snapshot.get("created_at"),
        "reason": payload.get("reason"),
        "symptoms": symptom_flags,
        "score": score,
        "visible_result_count": len(visible_types),
        "visible_fuelish_count": fuelish,
        "top_visible_fuelish_count": top_fuelish,
        "overnight_labels": overnight_labels,
        "transcript_head": transcript[:240],
    }


def audit_snapshot_cases(snapshots: list[dict[str, Any]], actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_session = action_index_by_session(actions)
    audited: list[dict[str, Any]] = []
    for snapshot in snapshots:
        row = snapshot_symptoms(snapshot)
        matches = by_session.get(str(snapshot.get("session_id") or ""), [])
        nearest_action = None
        if matches:
            snap_ts = int(snapshot.get("created_at") or 0)
            nearest_action = min(matches, key=lambda item: abs(int(item.get("created_at") or 0) - snap_ts))
        if nearest_action:
            nearest_action_command = str(nearest_action.get("command") or "")
            nearest_action_type = str(nearest_action.get("action_type") or "")
            row["nearest_action_command"] = nearest_action_command
            row["nearest_action_type"] = nearest_action_type
            row["nearest_action_age_s"] = abs(int(snapshot.get("created_at") or 0) - int(nearest_action.get("created_at") or 0))
            if (
                "visible_fuel_pollution" in row["symptoms"]
                and "route_session_visible_fuel_pollution" not in row["symptoms"]
                and _looks_like_route_session(nearest_action_command, nearest_action_type, str(snapshot.get("event_data", {}).get("transcript") or ""))
            ):
                row["symptoms"].append("route_session_visible_fuel_pollution")
        row["symptoms"] = sorted(set(row["symptoms"]))
        row["score"] = len(row["symptoms"])
        audited.append(row)
    return audited


def summarize_replays(replays: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(replays)
    mismatches = [item for item in replays if not item.get("ok")]
    return {
        "total": total,
        "matched": total - len(mismatches),
        "mismatched": len(mismatches),
        "mismatch_examples": mismatches[:8],
    }


def summarize_snapshots(audits: list[dict[str, Any]]) -> dict[str, Any]:
    symptom_counter = Counter()
    for row in audits:
        symptom_counter.update(row.get("symptoms") or [])
    worst = sorted(audits, key=lambda item: (-int(item.get("score") or 0), -int(item.get("created_at") or 0)))
    return {
        "total": len(audits),
        "symptoms": dict(symptom_counter.most_common()),
        "worst_sessions": worst[:8],
    }


def render_report(bundle: dict[str, Any], replays: list[dict[str, Any]], audits: list[dict[str, Any]]) -> str:
    replay_summary = summarize_replays(replays)
    snapshot_summary = summarize_snapshots(audits)
    lines = []
    lines.append("Trailhead Copilot Replay Harness")
    lines.append("")
    lines.append("Replay")
    lines.append(f"- cases: {replay_summary['total']}")
    lines.append(f"- matched: {replay_summary['matched']}")
    lines.append(f"- mismatched: {replay_summary['mismatched']}")
    if replay_summary["mismatch_examples"]:
        lines.append("- mismatch examples:")
        for item in replay_summary["mismatch_examples"]:
            lines.append(f"  - #{item['action_id']} `{item['command']}`")
            for mismatch in item.get("mismatches") or []:
                lines.append(f"    - {mismatch}")
    lines.append("")
    lines.append("Transcript Audit")
    lines.append(f"- snapshots: {snapshot_summary['total']}")
    if snapshot_summary["symptoms"]:
        lines.append("- symptom counts:")
        for key, value in snapshot_summary["symptoms"].items():
            lines.append(f"  - {key}: {value}")
    if snapshot_summary["worst_sessions"]:
        lines.append("- worst sessions:")
        for item in snapshot_summary["worst_sessions"]:
            symptom_text = ", ".join(item.get("symptoms") or []) or "none"
            lines.append(
                f"  - snapshot {item['snapshot_id']} session {item['session_id']} score={item['score']} symptoms={symptom_text}"
            )
            if item.get("nearest_action_command"):
                lines.append(
                    f"    - nearest action: `{item['nearest_action_command']}` -> {item.get('nearest_action_type')} ({item.get('nearest_action_age_s')}s)"
                )
            if item.get("overnight_labels"):
                lines.append(f"    - overnight labels: {', '.join(item['overnight_labels'])}")
            lines.append(f"    - transcript: {item['transcript_head']}")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replay Trailhead Copilot actions and audit saved debug snapshots.")
    parser.add_argument("--db", default=str(ROOT / "trailhead.db"), help="SQLite database path")
    parser.add_argument("--input-json", help="Optional pre-exported bundle JSON path")
    parser.add_argument("--limit", type=int, default=50, help="Maximum actions and snapshots to inspect")
    parser.add_argument("--json-out", help="Optional path to write the computed replay report JSON")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.input_json:
        bundle = load_bundle(Path(args.input_json))
    else:
        bundle = load_bundle_from_db(Path(args.db), args.limit)
    actions = bundle.get("actions") if isinstance(bundle.get("actions"), list) else []
    snapshots = bundle.get("debug_snapshots") if isinstance(bundle.get("debug_snapshots"), list) else []
    replays = replay_action_cases(actions)
    audits = audit_snapshot_cases(snapshots, actions)
    report = {
        "bundle_counts": {"actions": len(actions), "debug_snapshots": len(snapshots)},
        "replays": replays,
        "replay_summary": summarize_replays(replays),
        "snapshot_audits": audits,
        "snapshot_summary": summarize_snapshots(audits),
    }
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2))
    print(render_report(bundle, replays, audits))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
