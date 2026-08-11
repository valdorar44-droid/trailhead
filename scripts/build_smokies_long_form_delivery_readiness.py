#!/usr/bin/env python3
"""Build checked consumer-readiness evidence for Roaring Fork.

This does not claim that narration exists. It binds the reviewed non-audio
delivery semantics and the exact runtime/validator source set that will later
consume server-verified immutable audio.

The original v1 record is an immutable input to accepted narration evidence.
Current validation therefore advances through a separately hashed v2 overlay
instead of rewriting that historical record.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

REPOSITORY = Path(__file__).resolve().parents[1]
if str(REPOSITORY) not in sys.path:
    sys.path.insert(0, str(REPOSITORY))

from db.originals_validation import (
    LEGACY_LONG_FORM_READINESS_PATH,
    LONG_FORM_PREFLIGHT_PATH,
    LONG_FORM_READINESS_PATH,
    ORIGINAL_LONG_FORM_VALIDATION_GATES,
    REPO_ROOT,
    _canonical_json_value,
    _long_form_delivery_semantics_from_preflight,
    trusted_originals_long_form_validator_source_paths,
)


LEGACY_LONG_FORM_READINESS_SHA256 = (
    "4a0fc760fd07790785b820af06bac4e5a10e8337ad3f6257a10a3c50464c9b67"
)
LEGACY_LONG_FORM_READINESS_EVIDENCE_ID = "smokies_roaring_fork_delivery_v1"
CURRENT_LONG_FORM_READINESS_EVIDENCE_ID = "smokies_roaring_fork_delivery_v2"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def serialize(value: dict) -> str:
    return json.dumps(
        value, indent=2, sort_keys=True, ensure_ascii=False,
    ) + "\n"


def build() -> dict:
    """Return the hash-pinned V1 record used by historical characterization.

    V1 is part of accepted narration evidence, so current source drift must not
    silently rewrite it. Loading it through a fixed content hash keeps the
    historical builder contract useful without treating V1 as mutable output.
    """

    path = REPO_ROOT / LEGACY_LONG_FORM_READINESS_PATH
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != LEGACY_LONG_FORM_READINESS_SHA256:
        raise RuntimeError("Immutable V1 long-form readiness evidence drifted")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Immutable V1 long-form readiness evidence is invalid") from exc
    if (
        not isinstance(value, dict)
        or value.get("evidence_id") != LEGACY_LONG_FORM_READINESS_EVIDENCE_ID
        or serialize(value).encode("utf-8") != raw
    ):
        raise RuntimeError("Immutable V1 long-form readiness contract is invalid")
    return value


def build_current() -> dict:
    """Build the current V2 readiness overlay from the exact trusted sources."""

    preflight_path = REPO_ROOT / LONG_FORM_PREFLIGHT_PATH
    preflight = json.loads(preflight_path.read_text(encoding="utf-8"))
    stopped_radius = {"rf_story_06": 250}
    semantics = _long_form_delivery_semantics_from_preflight(
        preflight,
        stopped_availability_radius_m_by_id=stopped_radius,
    )
    semantic_hash = hashlib.sha256(json.dumps(
        _canonical_json_value(semantics),
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
    ).encode("utf-8")).hexdigest()
    source_paths = sorted(
        relative
        for relative in trusted_originals_long_form_validator_source_paths()
        if relative != LONG_FORM_READINESS_PATH
    )
    return {
        "schema_version": 1,
        "kind": "original_long_form_consumer_readiness",
        "evidence_id": CURRENT_LONG_FORM_READINESS_EVIDENCE_ID,
        "product_id": "great_smoky_mountains_ridges_rivers_living_memory",
        "chapter_id": "roaring_fork",
        "variant_id": "one_way",
        "preflight_sha256": _sha256(preflight_path),
        "consumer_delivery_modes_supported": True,
        "consumer_runtime_status": "ready_for_real_audio_validation",
        "real_audio_required": True,
        "authoring_estimates_accepted": False,
        "gates": ORIGINAL_LONG_FORM_VALIDATION_GATES,
        "stopped_availability_radius_m_by_id": stopped_radius,
        "delivery_semantics_sha256": semantic_hash,
        "source_sha256_by_path": {
            relative.as_posix(): _sha256(REPO_ROOT / relative)
            for relative in source_paths
        },
    }


def main() -> None:
    payload = serialize(build_current())
    destination = REPO_ROOT / LONG_FORM_READINESS_PATH
    destination.write_text(payload, encoding="utf-8")
    print(destination.relative_to(REPO_ROOT).as_posix())


if __name__ == "__main__":
    main()
