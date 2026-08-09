#!/usr/bin/env python3
"""Build the deterministic, internal-only ElevenLabs James audition lock.

The comparison is intentionally downstream of the accepted Cartesia audition
lock.  It cannot select or rewrite scripts: it binds the same three transcript
hashes and source/cultural gates, then changes only the narration provider
profile.  The provider output format stays fail-closed until the authenticated
ElevenLabs account confirms a Creator-safe format at render time.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from copy import deepcopy
from decimal import ROUND_UP, Decimal
from pathlib import Path

_BOOTSTRAP_REPOSITORY = Path(__file__).resolve().parents[1]
if str(_BOOTSTRAP_REPOSITORY) not in sys.path:
    sys.path.insert(0, str(_BOOTSTRAP_REPOSITORY))

from scripts.build_smokies_cartesia_audition_lock import build as build_cartesia_lock
from scripts.build_smokies_cartesia_audition_lock import (
    serialize as serialize_cartesia_lock,
)

REPOSITORY = _BOOTSTRAP_REPOSITORY
DESTINATION = (
    REPOSITORY / "originals/smokies/elevenlabs_james_audition_lock_v1.json"
)
CARTESIA_LOCK_PATH = (
    REPOSITORY / "originals/smokies/cartesia_audition_lock_v1.json"
)

VOICE_ID = "EkK5I93UQWFDigLMpZcX"
VOICE_NAME = "James - Husky, Engaging and Bold"
MODEL_ID = "eleven_multilingual_v2"
API_CONTRACT = "elevenlabs_text_to_speech_v1"
LANGUAGE_CODE = "en"
VOICE_SETTINGS = {
    "stability": 0.50,
    "similarity_boost": 0.50,
    "style": 0.1,
    "use_speaker_boost": True,
    "speed": 1.0,
}
OUTPUT_FORMAT_ID = "mp3_44100_128"
CHARACTER_CAP = 12_000
DOLLAR_CAP_USD = Decimal("2.00")
MAX_ASSUMED_USD_PER_1000_CHARACTERS = Decimal("0.10")
CONTINGENCY_PERCENT = 10


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_path(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_UP))


def _load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"comparison source lock is unreadable: {path}") from exc
    if not isinstance(value, dict):
        raise TypeError("comparison source lock must be an object")
    return value


def build() -> dict:
    """Return the exact James comparison lock or fail on upstream drift."""
    cartesia = build_cartesia_lock()
    checked_cartesia = _load_json(CARTESIA_LOCK_PATH)
    if checked_cartesia != cartesia:
        raise ValueError("Cartesia audition lock is stale; rebuild it first")
    if CARTESIA_LOCK_PATH.read_text(encoding="utf-8") != serialize_cartesia_lock(
        cartesia
    ):
        raise ValueError("Cartesia audition lock serialization drifted")

    payload = deepcopy(cartesia)
    payload["lock_id"] = "great_smoky_mountains_elevenlabs_james_audition_lock_v1"
    payload["comparison_source_lock"] = {
        "path": "originals/smokies/cartesia_audition_lock_v1.json",
        "sha256": _sha256_path(CARTESIA_LOCK_PATH),
        "relationship": "same_exact_three_transcripts_provider_comparison_only",
    }
    payload["generation_profile"] = {
        "provider": "elevenlabs",
        "voice_name": VOICE_NAME,
        "voice_id": VOICE_ID,
        "model_id": MODEL_ID,
        "api_contract": API_CONTRACT,
        "language_code": LANGUAGE_CODE,
        "voice_settings_source": "provider_preflight_exact_match_required",
        "voice_settings": VOICE_SETTINGS,
        "output_policy": {
            "selection_status": "authenticated_creator_account_verified",
            "format_id": OUTPUT_FORMAT_ID,
            "container": "mp3",
            "sample_rate_hz": 44_100,
            "bitrate_kbps": 128,
            "provider_native_master": True,
            "lossless_master_claimed": False,
            "transcoding_for_comparison_forbidden": True,
        },
    }

    payload_total = int(payload["aggregate"]["payload_character_count"])
    reserved_total = 0
    for row in payload["auditions"]:
        reserved = int(row.pop("reserved_credit_ceiling"))
        row["reserved_character_ceiling"] = reserved
        reserved_total += reserved

    projected = Decimal(payload_total) / Decimal(1000)
    projected *= MAX_ASSUMED_USD_PER_1000_CHARACTERS
    projected_with_contingency = projected * (
        Decimal(100 + CONTINGENCY_PERCENT) / Decimal(100)
    )
    if reserved_total > CHARACTER_CAP:
        raise ValueError("three-audition projection exceeds the character cap")
    if projected_with_contingency > DOLLAR_CAP_USD:
        raise ValueError("three-audition projection exceeds the dollar cap")

    payload["budget"] = {
        "billing_unit": "characters",
        "payload_character_count": payload_total,
        "reserved_character_ceiling": reserved_total,
        "character_cap": CHARACTER_CAP,
        "max_assumed_usd_per_1000_characters": str(
            MAX_ASSUMED_USD_PER_1000_CHARACTERS
        ),
        "projected_cost_usd": _money(projected),
        "projected_cost_with_contingency_usd": _money(
            projected_with_contingency
        ),
        "dollar_cap_usd": str(DOLLAR_CAP_USD),
        "contingency_percent": CONTINGENCY_PERCENT,
        "rerender_budget": 0,
    }
    payload["aggregate"] = {
        "payload_character_count": payload_total,
        "normalized_character_count": int(
            payload["aggregate"]["normalized_character_count"]
        ),
        "reserved_character_ceiling": reserved_total,
    }
    payload["source_files"].append({
        "path": "originals/smokies/cartesia_audition_lock_v1.json",
        "sha256": _sha256_path(CARTESIA_LOCK_PATH),
    })
    payload["source_files"].sort(key=lambda item: item["path"])
    return payload


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
            raise SystemExit(f"ElevenLabs audition lock is missing: {exc}") from exc
        if actual != expected:
            raise SystemExit("ElevenLabs audition lock is stale; rebuild it before rendering")
        print(f"verified {DESTINATION.relative_to(REPOSITORY).as_posix()}")
        return
    DESTINATION.write_text(expected, encoding="utf-8")
    print(DESTINATION.relative_to(REPOSITORY).as_posix())


if __name__ == "__main__":
    main()
