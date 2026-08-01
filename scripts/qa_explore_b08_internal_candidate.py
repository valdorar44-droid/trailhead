#!/usr/bin/env python3
"""Validate the bounded b08 Explore sidecar without touching live data."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any


EXPECTED_IDS = (
    "place:usfs:9006",
    "place:blm:moab-field-office",
    "place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8",
    "place:usfs:usfs-sierra-sites-5f618db8-3fe8-4011-a735-18a738acfb43",
    "place:usfs:usfs-sierra-sites-b01b7bab-bef1-45a7-a0f5-8707be86d2ba",
    "place:usfs:usfs-sierra-sites-307b30f3-9f42-4aa4-8de0-fe6eb125d8e2",
    "place:usfs:usfs-sierra-sites-1089761d-6a96-47fa-b575-6b69bd7c1772",
    "place:nps:cave",
    "place:nps:cato",
    "place:nps:chis",
    "place:nps:goga",
    "place:nps:grte",
    "place:nps:gumo",
)
REPLACEMENT_IDS = frozenset(EXPECTED_IDS[2:7])
FORBIDDEN_COPY = re.compile(
    r"\bOPEN\b|\b05,\s*Sierra|approximately1|\s['’]s\b|daysMaximum|"
    r"(?i:\b(?:API endpoint|database dump|raw record|provider slug)\b)",
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _valid_coordinates(place: dict[str, Any]) -> bool:
    try:
        lat = float(place.get("lat"))
        lng = float(place.get("lng"))
    except (TypeError, ValueError):
        return False
    return math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180


def audit(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    places = [item for item in payload.get("places") or [] if isinstance(item, dict)]
    failures: list[str] = []
    ids = tuple(str(item.get("id") or "") for item in places)
    if payload.get("schema_version") != 1 or payload.get("stage") != "internal":
        failures.append("sidecar schema or stage is not internal v1")
    if payload.get("count") != len(places):
        failures.append("declared count does not match place count")
    if ids != EXPECTED_IDS:
        failures.append("place IDs or deterministic order do not match the reviewed b08 set")
    if len(ids) != len(set(ids)):
        failures.append("duplicate stable IDs")

    for place in places:
        place_id = str(place.get("id") or "")
        if not _valid_coordinates(place):
            failures.append(f"{place_id}: invalid coordinates")
        checked_at = int(place.get("checked_at") or place.get("updated_at") or place.get("last_seen_at") or 0)
        if checked_at <= 0:
            failures.append(f"{place_id}: missing freshness timestamp")
        sources = [item for item in place.get("sources") or [] if isinstance(item, dict)]
        if not sources:
            failures.append(f"{place_id}: missing source attribution")
        for source in sources:
            if not str(source.get("url") or "").startswith("https://"):
                failures.append(f"{place_id}: source URL is not HTTPS")
            if not str(source.get("attribution") or "").strip():
                failures.append(f"{place_id}: source attribution is empty")
            if not str(source.get("license") or "").strip():
                failures.append(f"{place_id}: source license is empty")
        for media in place.get("media") or []:
            if not isinstance(media, dict):
                continue
            if not str(media.get("url") or "").startswith("https://"):
                failures.append(f"{place_id}: media URL is not HTTPS")
            if not str(media.get("credit") or "").strip() or not str(media.get("license") or "").strip():
                failures.append(f"{place_id}: media lacks exact credit or license")
        if FORBIDDEN_COPY.search(json.dumps(place, ensure_ascii=False)):
            failures.append(f"{place_id}: reader-facing copy contains a raw or malformed value")

        if place_id in REPLACEMENT_IDS:
            facts = {
                str(fact.get("key") or ""): str(fact.get("value") or "")
                for fact in place.get("planning_facts") or []
                if isinstance(fact, dict)
            }
            if facts.get("area") != "Sierra National Forest, US" or facts.get("access") != "Open":
                failures.append(f"{place_id}: campground area/access facts are not reader-facing")
            reservations = place.get("reservations") if isinstance(place.get("reservations"), dict) else {}
            if reservations.get("reservable") is not True or not str(reservations.get("url") or "").startswith("https://"):
                failures.append(f"{place_id}: reservation behavior was not preserved")
            providers = {str(source.get("source") or "") for source in sources}
            if not {"usfs", "ridb"}.issubset(providers):
                failures.append(f"{place_id}: cross-agency provenance was not preserved")
            recreation_media = [
                item for item in place.get("media") or []
                if isinstance(item, dict) and str(item.get("url") or "").startswith("https://cdn.recreation.gov/")
            ]
            if not recreation_media:
                failures.append(f"{place_id}: exact Recreation.gov image was not preserved")

    if failures:
        raise SystemExit("\n".join(failures))
    return {
        "path": str(path),
        "sha256": _sha256(path),
        "count": len(places),
        "replacement_count": len(REPLACEMENT_IDS),
        "nps_count": sum(place_id.startswith("place:nps:") for place_id in ids),
        "passed": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    print(json.dumps(audit(parser.parse_args().path.resolve()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
