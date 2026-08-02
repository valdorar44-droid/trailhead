#!/usr/bin/env python3
"""Generate the immutable corrected b08 top-level Release 1 configuration."""

from __future__ import annotations

import argparse
import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Any


CONFIG_DIR = Path(__file__).resolve().parent
REPO_ROOT = CONFIG_DIR.parents[2]
V1_DIR = CONFIG_DIR.parent / "b08-top-level-v1"
V1_ALIASES_SHA256 = "1f1683841d8ecef93ccb905b625b58a5c561cac17fff45e0d70cd7a8bd94ec37"
V1_DISPOSITIONS_SHA256 = "c7e2185692b50dc08f9e91e606819a79166a4eb2cd9a0012c44179eae8255a51"
V1_EXCEPTIONS_SHA256 = "f44ce8ea772b7f4221282e04ad5f58ef95ef65ac72de3272d907b6fa69774643"
V1_SERVING_SHA256 = "a004cee20e06a37cdcb0f6795112d239bbe19a1a4ea226f224d2f8992947ec25"
V1_SERVING_PATH = REPO_ROOT / "dashboard/explore_releases/explore-b08-top-level-v1/explore_serving_index_v2.json"

RUNTIME_DUPLICATE_REPLACEMENTS = {
    "place:ridb:10171274": (
        "place:nps-child:glac:campgrounds:apgar-campground",
        "Use Glacier National Park's reviewed Apgar Campground child and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:232445": (
        "place:nps-child:zion:campgrounds:watchman-campground",
        "Use Zion National Park's reviewed Watchman Campground child and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:232447": (
        "place:nps-child:yose:campgrounds:upper-pines-campground",
        "Use Yosemite National Park's reviewed Upper Pines Campground child and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:232449": (
        "place:nps-child:yose:campgrounds:north-pines-campground",
        "Use Yosemite National Park's reviewed North Pines Campground child and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:232450": (
        "place:nps-child:yose:campgrounds:lower-pines-campground",
        "Use Yosemite National Park's reviewed Lower Pines Campground child and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:232451": (
        "place:nps-child:yose:campgrounds:hodgdon-meadow-campground",
        "Use Yosemite National Park's reviewed Hodgdon Meadow Campground child and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:232453": (
        "place:nps-child:yose:campgrounds:bridalveil-creek-campground",
        "Use Yosemite National Park's reviewed Bridalveil Creek Campground child and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:232492": (
        "place:nps-child:glac:campgrounds:st-mary-campground",
        "Use Glacier National Park's reviewed St. Mary Campground child and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:232881": (
        "place:usfs:usfs-sierra-sites-d813c6eb-01cc-4d97-b35d-8b43cde5ce4b",
        "Use the reviewed USFS Soquel Campground record and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:233362": (
        "place:nps:meve",
        "Use the reviewed National Park Service Mesa Verde destination and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:233837": (
        "place:usfs:usfs-sierra-sites-5ee429ef-a49c-4af4-87c7-9d5bd6da1768",
        "Use the reviewed USFS Summerdale Campground record and remove the duplicate RIDB rail item.",
    ),
    "place:ridb:251869": (
        "place:nps-child:glac:campgrounds:many-glacier-campground",
        "Use Glacier National Park's reviewed Many Glacier Campground child and remove the duplicate RIDB rail item.",
    ),
    "place:wikidata:q1579682": (
        "place:pakistan_gov:punjab-lal-suhanra-national-park",
        "Use the reviewed Punjab government Lal Suhanra National Park record and remove the duplicate Wikidata rail item.",
    ),
    "place:wikidata:q2641970": (
        "place:pakistan_gov:gb-deosai-national-park",
        "Use the reviewed Gilgit-Baltistan government Deosai National Park record and remove the duplicate Wikidata rail item.",
    ),
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
        raise ValueError(f"pinned input changed: {path}: {actual_hash}")
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical_bytes(payload: Any) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _validate_runtime_pairs(serving: dict[str, Any]) -> None:
    items = serving.get("items")
    if not isinstance(items, list):
        raise ValueError("Release 1 serving artifact has no items array")
    by_id = {str(item.get("id") or ""): item for item in items if isinstance(item, dict)}
    missing = sorted(
        identity
        for old_id, (new_id, _reason) in RUNTIME_DUPLICATE_REPLACEMENTS.items()
        for identity in (old_id, new_id)
        if identity not in by_id
    )
    if missing:
        raise ValueError(f"reviewed runtime identities are absent: {missing}")
    for old_id, (new_id, reason) in sorted(RUNTIME_DUPLICATE_REPLACEMENTS.items()):
        if not reason.strip():
            raise ValueError(f"runtime replacement has no reason: {old_id}")
        old_title = str(by_id[old_id].get("title") or "").strip().casefold()
        new_title = str(by_id[new_id].get("title") or "").strip().casefold()
        if not old_title or old_title != new_title:
            raise ValueError(f"runtime replacement title mismatch: {old_id} -> {new_id}")


def _build() -> dict[str, Any]:
    v1_alias_payload = _read_pinned(V1_DIR / "aliases.json", V1_ALIASES_SHA256)
    v1_dispositions = _read_pinned(V1_DIR / "child_dispositions.json", V1_DISPOSITIONS_SHA256)
    v1_exceptions = _read_pinned(V1_DIR / "reviewed_exceptions.json", V1_EXCEPTIONS_SHA256)
    serving = _read_pinned(V1_SERVING_PATH, V1_SERVING_SHA256)
    _validate_runtime_pairs(serving)

    v1_aliases = v1_alias_payload.get("aliases")
    if not isinstance(v1_aliases, list) or len(v1_aliases) != 5:
        raise ValueError("Release 1 must contain exactly five approved aliases")
    if v1_dispositions != {"child_dispositions": []}:
        raise ValueError("Release 1 top-level child dispositions changed")
    corrections = v1_exceptions.get("approved_image_corrections")
    if not isinstance(corrections, list) or len(corrections) != 2:
        raise ValueError("Release 1 must contain exactly two approved image corrections")

    runtime_replacements = [
        {"from_id": old_id, "reason": reason, "to_id": new_id}
        for old_id, (new_id, reason) in sorted(RUNTIME_DUPLICATE_REPLACEMENTS.items())
    ]
    aliases = [deepcopy(item) for item in v1_aliases] + deepcopy(runtime_replacements)
    aliases.sort(key=lambda item: (str(item.get("from_id") or ""), str(item.get("to_id") or "")))
    sources = [str(item.get("from_id") or "") for item in aliases]
    if len(aliases) != 19 or len(set(sources)) != 19:
        raise ValueError("corrected Release 1 must contain 19 unique aliases")

    reviewed_exceptions = deepcopy(v1_exceptions)
    reviewed_exceptions["reviewed_displacements"] = 19
    reviewed_exceptions["runtime_duplicate_replacements"] = runtime_replacements
    return {
        "aliases.json": {"aliases": aliases},
        "child_dispositions.json": deepcopy(v1_dispositions),
        "reviewed_exceptions.json": reviewed_exceptions,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = _build()
    drift: list[str] = []
    for name, payload in sorted(outputs.items()):
        path = CONFIG_DIR / name
        expected = _canonical_bytes(payload)
        if args.check:
            if not path.is_file() or path.read_bytes() != expected:
                drift.append(name)
        else:
            path.write_bytes(expected)
    if drift:
        raise SystemExit("generated configuration drift: " + ", ".join(drift))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
