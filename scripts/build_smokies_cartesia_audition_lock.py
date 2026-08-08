#!/usr/bin/env python3
"""Build the deterministic, internal-only Smokies Cartesia audition lock.

The lock authorizes only three named audition scripts. It binds their exact
transcripts and the reviewed generation profile without claiming that the
draft scripts are approved for publication or that a full-pack render is
authorized.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
import hashlib
import json
import math
from pathlib import Path
import re
import unicodedata


REPOSITORY = Path(__file__).resolve().parents[1]
DESTINATION = REPOSITORY / "originals/smokies/cartesia_audition_lock_v1.json"
DOSSIER_PATH = REPOSITORY / "originals/smokies/source_dossiers_v1.json"
EDITORIAL_PATHS = {
    "roaring_fork": REPOSITORY / "originals/smokies/editorial_roaring_fork_v1.json",
    "mountain_crossing": REPOSITORY / "originals/smokies/editorial_mountain_crossing_v1.json",
}

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
PACKET_SCRIPT_STATUS = "draft_review_required"
AUDITION_SPECS = (
    {
        "order": 1,
        "role": "scenic_natural_history",
        "entry_id": "rf_story_02",
        "chapter_id": "roaring_fork",
        "claim_ids": ["rf_stream"],
        "source_ids": ["nps_grsm_natural_features", "nps_grsm_roaring_fork"],
    },
    {
        "order": 2,
        "role": "human_history",
        "entry_id": "rf_story_03",
        "chapter_id": "roaring_fork",
        "claim_ids": ["rf_ogle_farm"],
        "source_ids": ["nps_grsm_roaring_fork"],
    },
    {
        "order": 3,
        "role": "technical_pronunciation",
        "entry_id": "mc_story_02",
        "chapter_id": "mountain_crossing",
        "claim_ids": ["mc_deep_geology"],
        "source_ids": ["nps_grsm_geology"],
    },
)

GENERATION_PROFILE = {
    "provider": "cartesia",
    "voice_name": "Katie",
    "voice_id": "f786b574-daa5-4673-aa0c-cbe3e8534c02",
    "model_snapshot": "sonic-3.5-2026-05-04",
    "api_version": "2026-03-01",
    "language": "en",
    "output": {
        "container": "wav",
        "sample_rate_hz": 44_100,
        "channels": 1,
        "encoding": "pcm_s16le",
    },
    "generation_config": {"volume": 1.0, "speed": 0.98},
}

REVIEWED_TECHNICAL_NON_CULTURAL_TERMS = (
    "Appalachian",
    "calcium carbonate",
    "Ocoee Supergroup",
    "sedimentary",
    "metasandstone",
    "quartzite",
    "shale",
    "slate",
    "tectonic",
    "Pangaea",
    "Great Smoky Fault",
)

RENDERER_CREDIT_CAP = 12_000
CONTINGENCY_PERCENT = 10
PROHIBITED_TRANSCRIPT_TERMS = (
    "artificial intelligence",
    "ai-generated",
    "cartesia",
    "elevenlabs",
    "language model",
    "this draft",
    "this script",
    "this audition",
    "provider",
    "rendering pipeline",
    "requires ebci review",
    "cherokee",
    "kuwohi",
    "oconaluftee",
)


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_path(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _display_path(path: Path) -> str:
    try:
        return path.relative_to(REPOSITORY).as_posix()
    except ValueError:
        return path.as_posix()


def normalize_transcript(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("audition transcript must be a non-empty string")
    return " ".join(unicodedata.normalize("NFC", value).split())


def _word_count(value: str) -> int:
    return len(normalize_transcript(value).split(" "))


def _load_json(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"unable to load trusted audition input {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"trusted audition input {path} must be an object")
    return payload


def _validate_dossier_source(source: dict, *, dossier_reviewed_at: date, max_age_days: int) -> None:
    source_id = source.get("id", "unknown")
    if source.get("authority") != "official":
        raise ValueError(f"{source_id} is not an official source")
    if source.get("publisher") != "National Park Service":
        raise ValueError(f"{source_id} publisher is not National Park Service")
    if source.get("role") != "story" or source.get("rights_status") != "reference_only":
        raise ValueError(f"{source_id} is not approved as a reference-only story source")
    if not re.fullmatch(r"https://www\.nps\.gov/.+", str(source.get("url", ""))):
        raise ValueError(f"{source_id} does not have an official NPS URL")
    try:
        reviewed_at = date.fromisoformat(str(source["reviewed_at"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"{source_id} has no valid review date") from exc
    if reviewed_at > dossier_reviewed_at or reviewed_at < dossier_reviewed_at - timedelta(days=max_age_days):
        raise ValueError(f"{source_id} is outside the deterministic story-source review window")


def build(
    *,
    editorial_paths: dict[str, Path] | None = None,
    dossier_path: Path | None = None,
) -> dict:
    paths = editorial_paths or EDITORIAL_PATHS
    dossier_file = dossier_path or DOSSIER_PATH
    dossier = _load_json(dossier_file)
    if dossier.get("product_id") != PRODUCT_ID:
        raise ValueError("source dossier product identity drifted")
    if dossier.get("cultural_review", {}).get("status") != "public_record_only":
        raise ValueError("source dossier cultural-review status is not fail-closed")
    try:
        dossier_reviewed_at = date.fromisoformat(str(dossier["reviewed_at"]))
        max_age_days = int(dossier["source_review_max_age_days"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("source dossier review policy is incomplete") from exc

    claims = {claim.get("id"): claim for claim in dossier.get("claims", [])}
    sources = {source.get("id"): source for source in dossier.get("sources", [])}
    blocked_entry_ids = set(dossier.get("cultural_review", {}).get("blocked_entry_ids", []))
    packets: dict[str, dict] = {}
    entries_by_chapter: dict[str, dict[str, dict]] = {}
    source_files = []
    for chapter_id, path in paths.items():
        packet = _load_json(path)
        if packet.get("product_id") != PRODUCT_ID or packet.get("chapter_id") != chapter_id:
            raise ValueError(f"{chapter_id} editorial packet identity drifted")
        if packet.get("editorial_status") != PACKET_SCRIPT_STATUS:
            raise ValueError(f"{chapter_id} editorial packet is not draft_review_required")
        packets[chapter_id] = packet
        entries_by_chapter[chapter_id] = {
            entry.get("id"): entry for entry in packet.get("entries", [])
        }
        source_files.append({
            "path": _display_path(path),
            "sha256": _sha256_path(path),
        })

    selected = []
    selected_transcripts = []
    for spec in AUDITION_SPECS:
        chapter_id = spec["chapter_id"]
        if chapter_id not in entries_by_chapter:
            raise ValueError(f"missing editorial packet for {chapter_id}")
        entry = entries_by_chapter[chapter_id].get(spec["entry_id"])
        if not isinstance(entry, dict):
            raise ValueError(f"missing exact audition entry {spec['entry_id']}")
        if entry.get("kind") != "story" or entry.get("script_status") != PACKET_SCRIPT_STATUS:
            raise ValueError(f"{spec['entry_id']} is not a draft_review_required story")
        if entry.get("chapter_id") != chapter_id:
            raise ValueError(f"{spec['entry_id']} chapter identity drifted")
        if entry.get("claim_ids") != spec["claim_ids"] or entry.get("source_ids") != spec["source_ids"]:
            raise ValueError(f"{spec['entry_id']} claim or source binding drifted")
        if spec["entry_id"] in blocked_entry_ids:
            raise ValueError(f"{spec['entry_id']} is blocked by cultural review")

        for claim_id in spec["claim_ids"]:
            claim = claims.get(claim_id)
            if not isinstance(claim, dict):
                raise ValueError(f"missing trusted claim {claim_id}")
            if claim.get("status") != "source_verified":
                raise ValueError(f"{claim_id} is not source_verified")
            if claim.get("cultural_gate") != "not_required":
                raise ValueError(f"{claim_id} requires cultural review")
            scope = claim.get("cultural_scope", {})
            if (
                scope.get("classification") != "public_record_factual"
                or scope.get("collection_method") != "published_public_record"
                or scope.get("review_triggers") != []
            ):
                raise ValueError(f"{claim_id} cultural scope is not cleared for this audition")
            if claim.get("chapter_id") != chapter_id or claim.get("source_ids") != spec["source_ids"]:
                raise ValueError(f"{claim_id} trusted binding drifted")

        for source_id in spec["source_ids"]:
            source = sources.get(source_id)
            if not isinstance(source, dict):
                raise ValueError(f"missing trusted source {source_id}")
            _validate_dossier_source(
                source,
                dossier_reviewed_at=dossier_reviewed_at,
                max_age_days=max_age_days,
            )

        transcript = entry.get("transcript")
        normalized = normalize_transcript(transcript)
        lower = normalized.casefold()
        prohibited = [term for term in PROHIBITED_TRANSCRIPT_TERMS if term in lower]
        if prohibited:
            raise ValueError(f"{spec['entry_id']} contains prohibited audition wording: {prohibited}")
        words = _word_count(transcript)
        if spec["entry_id"] == "mc_story_02" and not 680 <= words <= 700:
            raise ValueError("mc_story_02 must remain a 680-700 word technical audition")

        selected_transcripts.append(normalized)
        payload_character_count = len(transcript)
        reserved_credit_ceiling = math.ceil(
            max(payload_character_count, len(normalized))
            * (100 + CONTINGENCY_PERCENT)
            / 100
        )
        selected.append({
            **spec,
            "source_file": _display_path(paths[chapter_id]),
            "script_status": PACKET_SCRIPT_STATUS,
            "source_gate": "source_verified",
            "cultural_gate": "not_required",
            "transcript_sha256": _sha256_bytes(transcript.encode("utf-8")),
            "payload_character_count": payload_character_count,
            "normalized_character_count": len(normalized),
            "reserved_credit_ceiling": reserved_credit_ceiling,
            "word_count": words,
        })

    reviewed_terms_missing = [
        term
        for term in REVIEWED_TECHNICAL_NON_CULTURAL_TERMS
        if term.casefold() not in " ".join(selected_transcripts).casefold()
    ]
    if reviewed_terms_missing:
        raise ValueError(f"reviewed pronunciation terms are absent: {reviewed_terms_missing}")

    normalized_character_count = sum(
        audition["normalized_character_count"] for audition in selected
    )
    projected_with_contingency = math.ceil(
        normalized_character_count * (100 + CONTINGENCY_PERCENT) / 100
    )
    payload_character_count = sum(
        audition["payload_character_count"] for audition in selected
    )
    reserved_credit_ceiling = sum(
        audition["reserved_credit_ceiling"] for audition in selected
    )
    if (
        projected_with_contingency > RENDERER_CREDIT_CAP
        or reserved_credit_ceiling > RENDERER_CREDIT_CAP
    ):
        raise ValueError("three-audition projection exceeds the independent renderer cap")

    source_files.append({
        "path": _display_path(dossier_file),
        "sha256": _sha256_path(dossier_file),
    })
    source_files.sort(key=lambda item: item["path"])
    return {
        "schema_version": 1,
        "lock_id": "great_smoky_mountains_cartesia_audition_lock_v1",
        "product_id": PRODUCT_ID,
        "lock_status": "internal_audition_only",
        "packet_script_status": PACKET_SCRIPT_STATUS,
        "authorization": {
            "scope": "three_internal_auditions_only",
            "full_pack_render_approved": False,
            "public_release_approved": False,
        },
        "source_gate": {
            "status": "passed",
            "dossier_file": _display_path(dossier_file),
            "dossier_sha256": _sha256_path(dossier_file),
        },
        "cultural_gate": {
            "status": "passed_for_selected_non_cultural_auditions",
            "public_release_approval_implied": False,
        },
        "generation_profile": GENERATION_PROFILE,
        "pronunciation_policy": {
            "mode": "model_default_reviewed_terms",
            "reviewed_technical_non_cultural_terms": list(
                REVIEWED_TECHNICAL_NON_CULTURAL_TERMS
            ),
            "custom_phonetic_overrides": [],
        },
        "budget": {
            "credits_per_normalized_character": 1,
            "contingency_percent": CONTINGENCY_PERCENT,
            "renderer_credit_cap": RENDERER_CREDIT_CAP,
        },
        "auditions": selected,
        "source_files": source_files,
        "aggregate": {
            "payload_character_count": payload_character_count,
            "normalized_character_count": normalized_character_count,
            "projected_credits_before_contingency": normalized_character_count,
            "projected_credits_with_contingency": projected_with_contingency,
            "reserved_credit_ceiling": reserved_credit_ceiling,
        },
    }


def serialize(payload: dict) -> str:
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = serialize(build())
    if args.check:
        try:
            actual = DESTINATION.read_text(encoding="utf-8")
        except OSError as exc:
            raise SystemExit(f"audition lock is missing: {exc}") from exc
        if actual != expected:
            raise SystemExit("audition lock is stale; rebuild it before rendering")
        print(f"verified {DESTINATION.relative_to(REPOSITORY).as_posix()}")
        return
    DESTINATION.write_text(expected, encoding="utf-8")
    print(DESTINATION.relative_to(REPOSITORY).as_posix())


if __name__ == "__main__":
    main()
