#!/usr/bin/env python3
"""Generate deterministic configuration for the reviewed b08 NPS child release."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from copy import deepcopy
from pathlib import Path
from typing import Any


CONFIG_DIR = Path(__file__).resolve().parent
UPSTREAM_DIR = CONFIG_DIR.parent / "b08-top-level-v2"
UPSTREAM_ALIASES_SHA256 = "adeb42d79b7471370073abf10d4bb7f9be39a8f78379c0b41b2f49c32f75336d"
UPSTREAM_EXCEPTIONS_SHA256 = "9a9d122fe50e855ba5392b83604f06b8799b5b380c156b9b1d1da1e155e5cec2"

CHILD_INPUTS = {
    "b1": {
        "count": 156,
        "path": "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b1-r7/nps_child_depth_v1.json",
        "sha256": "66abda311a4734cc05bf3b4d9c99834cd5d3ec119e5a295e68b6cb7a3199ade9",
    },
    "b2": {
        "count": 170,
        "path": "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b2-r7/nps_child_depth_v1.json",
        "sha256": "16416e6fe8e9ece6de5c08787b8c284366d7dc0b4951d4819f4deb50c59a5d86",
    },
    "b3": {
        "count": 131,
        "path": "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b3-r5/nps_child_depth_v1.json",
        "sha256": "db4f0b94bcde127a903f4db9c1ef91b43d98149c72e016c2b47b8a0ce051ced5",
    },
}

R2_RIDB_ALIASES = {
    "place:ridb:10041866": (
        "place:nps-child:ever:campgrounds:4f5128ad-453f-4b40-91f0-388fd662d110",
        "Replace the duplicate RIDB Flamingo Campground rail item with its reviewed NPS destination child.",
    ),
    "place:ridb:247586": (
        "place:nps-child:olym:campgrounds:368e0896-3b0d-4331-8882-5fbabbef7739",
        "Replace the duplicate RIDB Staircase Campground rail item with its reviewed NPS destination child.",
    ),
    "place:ridb:258742": (
        "place:nps-child:ever:campgrounds:ae149158-1191-4835-8457-e6e899f5ea48",
        "Replace the duplicate RIDB Long Pine Key Campground rail item with its reviewed NPS destination child.",
    ),
    "place:ridb:259237": (
        "place:nps-child:shen:campgrounds:bac9e60c-2fd0-479d-b676-1eb623edae60",
        "Replace the duplicate RIDB Lewis Mountain Campground rail item with its reviewed NPS destination child.",
    ),
    "place:ridb:274467": (
        "place:nps-child:bibe:campgrounds:6134a1e6-4a8b-473e-9fa5-7daeeaa3fd14",
        "Replace the duplicate RIDB Rio Grande Village RV rail item with its reviewed NPS destination child.",
    ),
}

CANONICAL_MERGES = {
    "nps:item:1b9bb56f-9ff5-4ad4-b966-f3b7310aed49": "place:ridb:234182",
    "nps:item:3322dbc8-a9d9-4c2a-9f79-67aa12670789": "place:ridb:253917",
    "nps:item:9d607267-5063-463f-8487-df928f788339": "place:ridb:233403",
    "nps:item:c46d4dbb-5b16-4f5a-bbfa-34c350639b98": "place:ridb:258852",
    "nps:item:f15d3521-c877-4da6-be0a-e78b83d39ac7": "place:ridb:259084",
    "nps:item:f8dfab23-efe0-4f31-98d0-cd5a871596a9": "place:ridb:232464",
}

REMAPPED_CHILDREN = {
    "nps:item:3e291d70-1c59-4f58-ad7d-d262642e897f": (
        "place:nps-child:brca:places:3e291d70-1c59-4f58-ad7d-d262642e897f"
    ),
    "nps:item:5011ba4f-e4a2-4a60-a723-18e2aa391728": (
        "place:nps-child:brca:thingstodo:5011ba4f-e4a2-4a60-a723-18e2aa391728"
    ),
    "nps:item:c1b14c7b-24f4-4a37-8481-7238dec96bfb": (
        "place:nps-child:gumo:places:c1b14c7b-24f4-4a37-8481-7238dec96bfb"
    ),
}

CHILD_CORRECTIONS = {
    "nps:item:7475825b-e844-4012-841b-0e29e05d4540": {
        "reason": "Use concise, campground-specific public copy from the reviewed official NPS record.",
        "source_url": "https://www.nps.gov/romo/planyourvisit/agcg.htm",
        "set": {
            "card.highlight": "Aspenglen Campground offers tent and RV campsites by reservation during its summer operating season.",
            "card.summary": "Aspenglen Campground offers tent and RV campsites by reservation during its summer operating season.",
            "description": "Aspenglen Campground offers tent and RV campsites by reservation during its summer operating season.",
            "summary": "Aspenglen Campground offers tent and RV campsites by reservation during its summer operating season.",
        },
    },
    "nps:item:a859e76b-fa23-43ce-8bed-904fb4d41b60": {
        "reason": "Use the complete official campground name consistently in reader-facing fields.",
        "source_url": "https://www.nps.gov/havo/planyourvisit/kulanaokuaiki-campground.htm",
        "set": {
            "card.headline": "Kulanaokuaiki Campground",
            "card.title": "Kulanaokuaiki Campground",
            "name": "Kulanaokuaiki Campground",
        },
    },
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_pinned(path: Path, expected_hash: str) -> Any:
    actual_hash = _sha256(path)
    if actual_hash != expected_hash:
        raise ValueError(f"pinned upstream config changed: {path}: {actual_hash}")
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical_bytes(payload: Any) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _source_id(record: dict[str, Any]) -> str:
    identities = sorted({
        str(value).strip().lower()
        for value in record.get("source_ids") or []
        if str(value).strip().lower().startswith("nps:item:")
    })
    if len(identities) != 1:
        raise ValueError(f"child must have exactly one NPS source identity: {record.get('id')}")
    return identities[0]


def _build(source_root: Path) -> dict[str, Any]:
    upstream_alias_payload = _read_pinned(UPSTREAM_DIR / "aliases.json", UPSTREAM_ALIASES_SHA256)
    upstream_exceptions = _read_pinned(
        UPSTREAM_DIR / "reviewed_exceptions.json", UPSTREAM_EXCEPTIONS_SHA256
    )
    upstream_aliases = upstream_alias_payload.get("aliases")
    if not isinstance(upstream_aliases, list) or len(upstream_aliases) != 19:
        raise ValueError("corrected Release 1 must provide exactly 19 aliases")
    upstream_sources = {str(item.get("from_id") or "") for item in upstream_aliases}
    if len(upstream_sources) != 19 or any(not str(item.get("reason") or "").strip() for item in upstream_aliases):
        raise ValueError("corrected Release 1 aliases must be unique and reviewed")

    children: dict[str, dict[str, Any]] = {}
    source_inputs: list[dict[str, Any]] = []
    for batch_id, expected in sorted(CHILD_INPUTS.items()):
        relative_path = str(expected["path"])
        path = source_root / relative_path
        actual_hash = _sha256(path)
        if actual_hash != expected["sha256"]:
            raise ValueError(f"{relative_path} hash changed: {actual_hash}")
        payload = json.loads(path.read_text(encoding="utf-8"))
        places = payload.get("places")
        if not isinstance(places, list):
            raise ValueError(f"{relative_path} has no places array")
        if len(places) != expected["count"]:
            raise ValueError(f"{relative_path} count changed: {len(places)}")
        source_inputs.append({
            "batch_id": batch_id,
            "count": len(places),
            "path": relative_path,
            "sha256": actual_hash,
        })
        for record in places:
            source_id = _source_id(record)
            if source_id in children:
                raise ValueError(f"duplicate child source identity: {source_id}")
            children[source_id] = record

    required_sources = set(CANONICAL_MERGES) | set(REMAPPED_CHILDREN) | set(CHILD_CORRECTIONS)
    if not required_sources <= set(children):
        raise ValueError(f"reviewed source identities are absent: {sorted(required_sources - set(children))}")
    child_public_ids = {str(record.get("id") or "") for record in children.values()}
    r2_alias_targets = {target for target, _reason in R2_RIDB_ALIASES.values()}
    if not r2_alias_targets <= child_public_ids:
        raise ValueError(f"reviewed R2 alias targets are absent: {sorted(r2_alias_targets - child_public_ids)}")

    dispositions: list[dict[str, str]] = []
    for source_id, record in sorted(children.items()):
        if source_id in CANONICAL_MERGES:
            dispositions.append({
                "disposition": "canonical_merge",
                "public_id": CANONICAL_MERGES[source_id],
                "reason": "Resolve the reviewed duplicate NPS campground to its existing canonical Recreation.gov identity.",
                "source_id": source_id,
            })
        elif source_id in REMAPPED_CHILDREN:
            dispositions.append({
                "disposition": "remapped",
                "public_id": REMAPPED_CHILDREN[source_id],
                "reason": "Use the source-ID-qualified public identity selected during sibling-collision review.",
                "source_id": source_id,
            })
        else:
            dispositions.append({
                "disposition": "published",
                "public_id": str(record.get("id") or ""),
                "reason": "Publish the reviewed NPS child at its stable source-backed identity.",
                "source_id": source_id,
            })

    counts = Counter(item["disposition"] for item in dispositions)
    expected_counts = Counter({"published": 448, "remapped": 3, "canonical_merge": 6})
    if len(children) != 457 or counts != expected_counts:
        raise ValueError(f"unexpected disposition distribution: total={len(children)} counts={dict(counts)}")
    if any(not item["public_id"] for item in dispositions):
        raise ValueError("every non-rejected child disposition requires a public identity")

    r2_aliases = [
        {"from_id": from_id, "reason": reason, "to_id": to_id}
        for from_id, (to_id, reason) in sorted(R2_RIDB_ALIASES.items())
    ]
    aliases = [deepcopy(item) for item in upstream_aliases] + r2_aliases
    aliases.sort(key=lambda item: (str(item.get("from_id") or ""), str(item.get("to_id") or "")))
    alias_sources = {str(item.get("from_id") or "") for item in aliases}
    if len(aliases) != 24 or len(alias_sources) != 24:
        raise ValueError("child-depth release must contain 24 unique inherited and new aliases")

    reviewed_exceptions = deepcopy(upstream_exceptions)
    if len(reviewed_exceptions.get("approved_image_corrections") or []) != 2:
        raise ValueError("corrected Release 1 image corrections were not preserved")
    if len(reviewed_exceptions.get("runtime_duplicate_replacements") or []) != 14:
        raise ValueError("corrected Release 1 runtime replacements were not preserved")
    reviewed_exceptions.update({
        "child_corrections": CHILD_CORRECTIONS,
        "evidence_breakdown": {
            "b1": {"parent_page_source_fallbacks": 2, "shared_coordinate_clusters": 9, "text_only_images": 52},
            "b2": {"parent_page_source_fallbacks": 1, "shared_coordinate_clusters": 10, "text_only_images": 17},
            "b3": {"parent_page_source_fallbacks": 9, "shared_coordinate_clusters": 5, "text_only_images": 20},
        },
        "parent_page_source_fallbacks_explicit_b3": 9,
        "parent_page_source_fallbacks_total": 12,
        "reviewed_displacements": 24,
        "shared_coordinate_clusters": 24,
        "text_only_images": 89,
    })
    return {
        "aliases.json": {"aliases": aliases},
        "child_dispositions.json": {"child_dispositions": dispositions},
        "reviewed_exceptions.json": reviewed_exceptions,
        "source_inputs.json": {
            "expected_disposition_counts": {
                "canonical_merge": 6,
                "published": 448,
                "rejected": 0,
                "remapped": 3,
            },
            "expected_base_catalog_count": 991,
            "expected_base_serving_count": 5421,
            "expected_output_catalog_count": 1442,
            "expected_output_serving_count": 5867,
            "schema_version": 1,
            "source_inputs": source_inputs,
            "upstream_release_config": {
                "aliases": {
                    "count": 19,
                    "path": "config/explore_public_releases/b08-top-level-v2/aliases.json",
                    "sha256": UPSTREAM_ALIASES_SHA256,
                },
                "reviewed_exceptions": {
                    "path": "config/explore_public_releases/b08-top-level-v2/reviewed_exceptions.json",
                    "sha256": UPSTREAM_EXCEPTIONS_SHA256,
                },
            },
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = _build(args.source_root.resolve())
    changed: list[str] = []
    for name, payload in sorted(outputs.items()):
        path = CONFIG_DIR / name
        expected = _canonical_bytes(payload)
        if args.check:
            if not path.is_file() or path.read_bytes() != expected:
                changed.append(name)
        else:
            path.write_bytes(expected)
    if changed:
        raise SystemExit("generated configuration drift: " + ", ".join(changed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
