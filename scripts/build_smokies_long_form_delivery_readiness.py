#!/usr/bin/env python3
"""Build checked S3H consumer-readiness evidence for Roaring Fork.

This does not claim that narration exists. It binds the reviewed non-audio
delivery semantics and the exact runtime/validator source set that will later
consume server-verified immutable audio.
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
    LONG_FORM_PREFLIGHT_PATH,
    LONG_FORM_READINESS_PATH,
    ORIGINAL_LONG_FORM_VALIDATION_GATES,
    REPO_ROOT,
    _canonical_json_value,
    _long_form_delivery_semantics_from_preflight,
    trusted_originals_long_form_validator_source_paths,
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build() -> dict:
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
        "evidence_id": "smokies_roaring_fork_delivery_v1",
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
    payload = json.dumps(
        build(), indent=2, sort_keys=True, ensure_ascii=False,
    ) + "\n"
    destination = REPO_ROOT / LONG_FORM_READINESS_PATH
    destination.write_text(payload, encoding="utf-8")
    print(destination.relative_to(REPO_ROOT).as_posix())


if __name__ == "__main__":
    main()
