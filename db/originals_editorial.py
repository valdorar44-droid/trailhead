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
SMOKIES_CADES_COVE_EDITORIAL_PATH = (
    REPO_ROOT / "originals" / "smokies" / "editorial_cades_cove_v1.json"
)
SMOKIES_ROARING_FORK_EDITORIAL_PATH = (
    REPO_ROOT / "originals" / "smokies" / "editorial_roaring_fork_v1.json"
)
SMOKIES_ROUTE_VARIANTS_PATH = REPO_ROOT / "originals" / "smokies" / "route_variants_v1.json"
SMOKIES_EDITORIAL_PATHS = (
    SMOKIES_EDITORIAL_PATH,
    SMOKIES_MOUNTAIN_CROSSING_EDITORIAL_PATH,
    SMOKIES_CADES_COVE_EDITORIAL_PATH,
    SMOKIES_ROARING_FORK_EDITORIAL_PATH,
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


def _chapter_route_variants(route_variants: dict[str, Any], chapter_id: str) -> list[dict[str, Any]]:
    return sorted(
        (
            item
            for item in route_variants.get("variants", [])
            if isinstance(item, dict) and item.get("chapter_id") == chapter_id
        ),
        key=lambda item: (int(item.get("sequence") or 0), str(item.get("variant_id") or "")),
    )


def _validate_direction_review(
    packet: dict[str, Any],
    dossier_entries: dict[str, dict[str, Any]],
    route_variants: dict[str, Any],
    chapter_id: str,
) -> tuple[list[str], list[str], str | None]:
    issues: list[str] = []
    variants = _chapter_route_variants(route_variants, chapter_id)
    variant_ids = [str(item.get("variant_id") or "") for item in variants]
    base_variant_id = variant_ids[0] if variant_ids else None
    review = packet.get("direction_review")
    if len(variant_ids) <= 1:
        if review is not None:
            issues.append("direction_review is unused for a chapter without route alternatives")
        return issues, variant_ids, base_variant_id
    if not isinstance(review, dict):
        return ["direction_review is required for a chapter with route alternatives"], variant_ids, base_variant_id
    unknown_keys = sorted(
        set(review) - {"base_variant_id", "reviewed_variant_ids", "reviewed_entry_ids"}
    )
    if unknown_keys:
        issues.append(f"direction_review contains unknown fields: {', '.join(unknown_keys)}")
    if review.get("base_variant_id") != base_variant_id:
        issues.append(f"direction_review base_variant_id must be {base_variant_id}")
    reviewed_variant_ids = review.get("reviewed_variant_ids")
    if not isinstance(reviewed_variant_ids, list):
        issues.append("direction_review reviewed_variant_ids must be a list")
        reviewed_variant_ids = []
    elif not all(isinstance(value, str) for value in reviewed_variant_ids):
        issues.append("direction_review reviewed_variant_ids must contain only strings")
        reviewed_variant_ids = [value for value in reviewed_variant_ids if isinstance(value, str)]
    if len(reviewed_variant_ids) != len(set(reviewed_variant_ids)):
        issues.append("direction_review contains duplicate reviewed_variant_ids")
    if reviewed_variant_ids != variant_ids:
        issues.append("direction_review must cover every route variant in route sequence order")
    packet_entry_ids = {
        str(item.get("id"))
        for item in packet.get("entries", [])
        if isinstance(item, dict)
        and dossier_entries.get(str(item.get("id")), {}).get("directional_adaptation")
    }
    reviewed_entry_ids = review.get("reviewed_entry_ids")
    if not isinstance(reviewed_entry_ids, list):
        issues.append("direction_review reviewed_entry_ids must be a list")
        reviewed_entry_ids = []
    elif not all(isinstance(value, str) for value in reviewed_entry_ids):
        issues.append("direction_review reviewed_entry_ids must contain only strings")
        reviewed_entry_ids = [value for value in reviewed_entry_ids if isinstance(value, str)]
    if len(reviewed_entry_ids) != len(set(reviewed_entry_ids)):
        issues.append("direction_review contains duplicate reviewed_entry_ids")
    if set(reviewed_entry_ids) != packet_entry_ids:
        issues.append("direction_review must cover every authored direction-sensitive entry")
    return issues, variant_ids, base_variant_id


def validate_smokies_editorial_packet(
    packet: dict[str, Any],
    dossier: dict[str, Any],
    *,
    dossier_file_sha256: str,
    route_variants: dict[str, Any] | None = None,
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
    route_variants = route_variants or _load_json(SMOKIES_ROUTE_VARIANTS_PATH)
    direction_issues, chapter_variant_ids, base_variant_id = _validate_direction_review(
        packet,
        dossier_entries,
        route_variants,
        chapter_id,
    )
    issues.extend(direction_issues)
    reviewed_variant_ids = (
        packet.get("direction_review", {}).get("reviewed_variant_ids", [])
        if isinstance(packet.get("direction_review"), dict)
        else []
    )
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
        raw_overrides = entry.get("variant_overrides", [])
        if not isinstance(raw_overrides, list):
            issues.append(f"{entry_id}.variant_overrides must be a list")
            raw_overrides = []
        override_keys: list[tuple[str, str]] = []
        for override_index, raw_override in enumerate(raw_overrides):
            override_prefix = f"{entry_id}.variant_overrides[{override_index}]"
            if not isinstance(raw_override, dict):
                issues.append(f"{override_prefix} must be an object")
                continue
            unknown_override_keys = sorted(
                set(raw_override) - {"chapter_id", "variant_id", "title", "transcript"}
            )
            if unknown_override_keys:
                issues.append(
                    f"{override_prefix} contains unknown fields: {', '.join(unknown_override_keys)}"
                )
            override_chapter_id = str(raw_override.get("chapter_id") or "")
            override_variant_id = str(raw_override.get("variant_id") or "")
            override_key = (override_chapter_id, override_variant_id)
            override_keys.append(override_key)
            if override_chapter_id != chapter_id:
                issues.append(f"{override_prefix}.chapter_id must match {chapter_id}")
            if override_variant_id not in chapter_variant_ids:
                issues.append(f"{override_prefix}.variant_id is unknown for {chapter_id}")
            elif override_variant_id == base_variant_id:
                issues.append(f"{override_prefix} is unused because it targets the base route variant")
            elif override_variant_id not in reviewed_variant_ids:
                issues.append(f"{override_prefix} is unused because its route variant was not reviewed")
            if not outline.get("directional_adaptation"):
                issues.append(f"{override_prefix} is unused for a direction-neutral dossier entry")
            override_title = raw_override.get("title")
            if override_title is not None and (
                not isinstance(override_title, str)
                or not override_title.strip()
                or len(override_title.strip()) > 200
            ):
                issues.append(f"{override_prefix}.title must contain 1-200 characters")
            override_transcript = str(raw_override.get("transcript") or "").strip()
            override_words = editorial_word_count(override_transcript)
            if entry.get("kind") == "story" and not 450 <= override_words <= 725:
                issues.append(
                    f"{override_prefix}.transcript must contain 450-725 words; found {override_words}"
                )
            if entry.get("kind") == "cue" and not 50 <= override_words <= 120:
                issues.append(
                    f"{override_prefix}.transcript must contain 50-120 words; found {override_words}"
                )
            for pattern in _FORBIDDEN_PUBLIC_COPY:
                if pattern.search(override_transcript):
                    issues.append(
                        f"{override_prefix} contains prohibited public wording: {pattern.pattern}"
                    )
            effective_title = str(override_title or entry.get("title") or "").strip()
            if (
                editorial_transcript_sha256(override_transcript)
                == editorial_transcript_sha256(transcript)
                and effective_title == str(entry.get("title") or "").strip()
            ):
                issues.append(f"{override_prefix} is unused because it does not change title or transcript")
        duplicate_override_keys = sorted(
            key for key, count in Counter(override_keys).items() if count > 1
        )
        if duplicate_override_keys:
            issues.append(
                f"{entry_id} contains duplicate variant overrides: "
                + ", ".join(f"{chapter}:{variant}" for chapter, variant in duplicate_override_keys)
            )
    return issues


def load_smokies_editorial_packet() -> dict[str, Any]:
    dossier = _load_json(SMOKIES_DOSSIER_PATH)
    dossier_digest = _file_sha256(SMOKIES_DOSSIER_PATH)
    route_variants = _load_json(SMOKIES_ROUTE_VARIANTS_PATH)
    packets: list[tuple[Path, dict[str, Any]]] = []
    issues: list[str] = []
    for path in SMOKIES_EDITORIAL_PATHS:
        packet = _load_json(path)
        packet_issues = validate_smokies_editorial_packet(
            packet,
            dossier,
            dossier_file_sha256=dossier_digest,
            route_variants=route_variants,
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
        if key not in {"chapter_id", "direction_review", "entries"}
    }
    response["route_variants_sha256"] = _file_sha256(SMOKIES_ROUTE_VARIANTS_PATH)
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
                "variant_override_count": sum(
                    len(item.get("variant_overrides", [])) for item in chapter_entries
                ),
                "direction_review": deepcopy(packet.get("direction_review")),
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
        "variant_override_count": sum(
            len(item.get("variant_overrides", [])) for item in response["entries"]
        ),
        "direction_reviewed_chapter_count": sum(
            isinstance(packet.get("direction_review"), dict) for _, packet in packets
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
        chapter_variants = _chapter_route_variants(route_variants, entry["chapter_id"])
        variant_ids = [str(item["variant_id"]) for item in chapter_variants]
        base_hash = entry["transcript_sha256"]
        base_title = entry["title"]
        effective_hashes = {variant_id: base_hash for variant_id in variant_ids}
        effective_titles = {variant_id: base_title for variant_id in variant_ids}
        for override in entry.get("variant_overrides", []):
            override["word_count"] = editorial_word_count(override["transcript"])
            override["estimated_duration_s"] = round(override["word_count"] / 145 * 60)
            override["transcript_sha256"] = editorial_transcript_sha256(override["transcript"])
            effective_hashes[override["variant_id"]] = override["transcript_sha256"]
            effective_titles[override["variant_id"]] = override.get("title") or base_title
        entry["effective_transcript_sha256_by_variant"] = effective_hashes
        entry["effective_title_by_variant"] = effective_titles
    return response
