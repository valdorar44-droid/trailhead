"""Source-locked editorial packets for authored Trailhead Originals."""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import json
import re
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
SMOKIES_DOSSIER_PATH = REPO_ROOT / "originals" / "smokies" / "source_dossiers_v1.json"
SMOKIES_EDITORIAL_PATH = REPO_ROOT / "originals" / "smokies" / "editorial_scripts_v1.json"
SMOKIES_MOUNTAIN_CROSSING_EDITORIAL_PATH = (
    REPO_ROOT / "originals" / "smokies" / "editorial_mountain_crossing_v1.json"
)
SMOKIES_EDITORIAL_PATHS = (
    SMOKIES_EDITORIAL_PATH,
    SMOKIES_MOUNTAIN_CROSSING_EDITORIAL_PATH,
)
SMOKIES_PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"

_WORD_RE = re.compile(r"\b[\w’'-]+\b", re.UNICODE)
_FORBIDDEN_PUBLIC_COPY = (
    re.compile(r"\b(?:AI|ChatGPT|Claude|Cartesia|ElevenLabs)\b", re.IGNORECASE),
    re.compile(r"\bdownload (?:the|another|an) app\b", re.IGNORECASE),
    re.compile(r"\bcheck local rules\b", re.IGNORECASE),
    re.compile(r"\b(?:always|guaranteed|perfectly) safe\b", re.IGNORECASE),
    re.compile(r"\bextreme mode\b", re.IGNORECASE),
)


def editorial_word_count(value: str) -> int:
    return len(_WORD_RE.findall(str(value or "")))


def editorial_transcript_sha256(value: str) -> str:
    normalized = " ".join(str(value or "").split())
    return sha256(normalized.encode("utf-8")).hexdigest()


def _file_sha256(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return value


def validate_smokies_editorial_packet(
    packet: dict[str, Any],
    dossier: dict[str, Any],
    *,
    dossier_file_sha256: str,
) -> list[str]:
    issues: list[str] = []
    if packet.get("schema_version") != 1:
        issues.append("schema_version must be 1")
    if packet.get("product_id") != SMOKIES_PRODUCT_ID:
        issues.append("product_id does not match the Smokies product")
    if packet.get("dossier_sha256") != dossier_file_sha256:
        issues.append("dossier_sha256 does not match the checked source dossier")
    if packet.get("editorial_status") != "draft_review_required":
        issues.append("editorial_status must remain draft_review_required")
    chapter_id = str(packet.get("chapter_id") or "")
    if not chapter_id:
        issues.append("chapter_id is required")

    dossier_entries = {
        str(item.get("id")): item
        for item in dossier.get("entries", [])
        if isinstance(item, dict) and item.get("id")
    }
    dossier_claims = {
        str(item.get("id")): item
        for item in dossier.get("claims", [])
        if isinstance(item, dict) and item.get("id")
    }
    dossier_sources = {
        str(item.get("id")): item
        for item in dossier.get("sources", [])
        if isinstance(item, dict) and item.get("id")
    }
    blocked = set(dossier.get("cultural_review", {}).get("blocked_entry_ids", []))
    entries = packet.get("entries")
    if not isinstance(entries, list) or not entries:
        return issues + ["entries must contain at least one editorial script"]
    ids = [str(item.get("id")) for item in entries if isinstance(item, dict)]
    duplicate_ids = sorted(item_id for item_id, count in Counter(ids).items() if count > 1)
    if duplicate_ids:
        issues.append(f"duplicate editorial entry IDs: {', '.join(duplicate_ids)}")

    for index, entry in enumerate(entries):
        prefix = f"entries[{index}]"
        if not isinstance(entry, dict):
            issues.append(f"{prefix} must be an object")
            continue
        entry_id = str(entry.get("id") or "")
        outline = dossier_entries.get(entry_id)
        if not outline:
            issues.append(f"{prefix}.id is not present in the source dossier")
            continue
        if entry_id in blocked or outline.get("script_status") == "blocked_cultural_review":
            issues.append(f"{entry_id} is blocked for cultural review")
        for key in ("chapter_id", "kind", "sequence", "title"):
            if entry.get(key) != outline.get(key):
                issues.append(f"{entry_id}.{key} does not match the source dossier")
        if entry.get("chapter_id") != chapter_id:
            issues.append(f"{entry_id}.chapter_id does not match its editorial packet")
        claim_ids = entry.get("claim_ids")
        if claim_ids != outline.get("claim_ids"):
            issues.append(f"{entry_id}.claim_ids do not match the source dossier")
            claim_ids = []
        expected_source_ids = sorted({
            source_id
            for claim_id in claim_ids or []
            for source_id in dossier_claims.get(str(claim_id), {}).get("source_ids", [])
        })
        source_ids = entry.get("source_ids")
        if source_ids != expected_source_ids:
            issues.append(f"{entry_id}.source_ids do not match the reviewed claims")
        for source_id in source_ids or []:
            if source_id not in dossier_sources:
                issues.append(f"{entry_id} references unknown source {source_id}")
        if entry.get("script_status") != "draft_review_required":
            issues.append(f"{entry_id}.script_status must remain draft_review_required")
        transcript = str(entry.get("transcript") or "").strip()
        words = editorial_word_count(transcript)
        if entry.get("kind") == "story" and not 450 <= words <= 725:
            issues.append(f"{entry_id} must contain 450-725 words; found {words}")
        if entry.get("kind") == "cue" and not 50 <= words <= 120:
            issues.append(f"{entry_id} must contain 50-120 words; found {words}")
        for pattern in _FORBIDDEN_PUBLIC_COPY:
            if pattern.search(transcript):
                issues.append(f"{entry_id} contains prohibited public wording: {pattern.pattern}")
    return issues


def load_smokies_editorial_packet() -> dict[str, Any]:
    dossier = _load_json(SMOKIES_DOSSIER_PATH)
    dossier_digest = _file_sha256(SMOKIES_DOSSIER_PATH)
    packets: list[tuple[Path, dict[str, Any]]] = []
    issues: list[str] = []
    for path in SMOKIES_EDITORIAL_PATHS:
        packet = _load_json(path)
        packet_issues = validate_smokies_editorial_packet(
            packet,
            dossier,
            dossier_file_sha256=dossier_digest,
        )
        issues.extend(f"{path.name}: {issue}" for issue in packet_issues)
        packets.append((path, packet))

    entry_ids = [
        str(entry.get("id"))
        for _, packet in packets
        for entry in packet.get("entries", [])
        if isinstance(entry, dict)
    ]
    duplicate_ids = sorted(
        entry_id for entry_id, count in Counter(entry_ids).items() if count > 1
    )
    if duplicate_ids:
        issues.append(f"duplicate IDs across editorial packets: {', '.join(duplicate_ids)}")
    if issues:
        raise ValueError("Smokies editorial packet is invalid: " + "; ".join(issues))

    sources = {item["id"]: item for item in dossier["sources"]}
    outlines = {item["id"]: item for item in dossier["entries"]}
    first_packet = packets[0][1]
    response = {
        key: deepcopy(value)
        for key, value in first_packet.items()
        if key not in {"chapter_id", "entries"}
    }
    response["chapter_ids"] = [packet["chapter_id"] for _, packet in packets]
    response["entries"] = [
        deepcopy(entry)
        for _, packet in packets
        for entry in packet["entries"]
    ]
    response["chapters"] = []
    combined_hash = sha256()
    for path, packet in packets:
        artifact_sha256 = _file_sha256(path)
        combined_hash.update(bytes.fromhex(artifact_sha256))
        chapter_entries = packet["entries"]
        response["chapters"].append(
            {
                "chapter_id": packet["chapter_id"],
                "artifact_sha256": artifact_sha256,
                "story_count": sum(item["kind"] == "story" for item in chapter_entries),
                "cue_count": sum(item["kind"] == "cue" for item in chapter_entries),
                "word_count": sum(
                    editorial_word_count(item["transcript"]) for item in chapter_entries
                ),
                "estimated_duration_s": sum(
                    round(editorial_word_count(item["transcript"]) / 145 * 60)
                    for item in chapter_entries
                ),
            }
        )
    response["artifact_sha256"] = combined_hash.hexdigest()
    response["summary"] = {
        "entry_count": len(response["entries"]),
        "chapter_count": len(packets),
        "story_count": sum(item["kind"] == "story" for item in response["entries"]),
        "cue_count": sum(item["kind"] == "cue" for item in response["entries"]),
        "word_count": sum(
            editorial_word_count(item["transcript"]) for item in response["entries"]
        ),
        "estimated_duration_s": sum(
            round(editorial_word_count(item["transcript"]) / 145 * 60)
            for item in response["entries"]
        ),
    }
    for entry in response["entries"]:
        outline = outlines[entry["id"]]
        entry["word_count"] = editorial_word_count(entry["transcript"])
        entry["estimated_duration_s"] = round(entry["word_count"] / 145 * 60)
        entry["transcript_sha256"] = editorial_transcript_sha256(entry["transcript"])
        entry["visible_scene"] = outline["visible_scene"]
        entry["purpose"] = outline["purpose"]
        entry["sources"] = [deepcopy(sources[source_id]) for source_id in entry["source_ids"]]
    return response
