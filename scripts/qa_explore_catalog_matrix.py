#!/usr/bin/env python3
"""Audit Explore catalog search coverage for production readiness.

The matrix checks the generated catalogs users actually see, then falls back to
seed files for source context. It fails on true dead ends and reports enrichment
gaps without blocking iteration.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

CATALOG_PATHS = [
    ROOT / "dashboard/explore_catalog_v1.json",
    ROOT / "dashboard/explore_catalog_v3.json",
    ROOT / "data/explore/explore_catalog_v1.json",
]

SEED_PATHS = [
    ROOT / "scripts/explore_seed_v2.json",
    ROOT / "scripts/explore_global_seed_v1.json",
]

GENERIC_COPY_PATTERNS = [
    re.compile(pattern, re.I)
    for pattern in [
        r"\bai[- ]generated\b",
        r"\bchatgpt\b",
        r"\blorem ipsum\b",
        r"\bplaceholder\b",
        r"\bgeneric campground\b",
        r"\bmock data\b",
        r"\bdev wording\b",
    ]
]


@dataclass(frozen=True)
class Scenario:
    name: str
    terms: tuple[str, ...]
    minimum: int = 1


SCENARIOS = [
    Scenario("Moab", ("moab", "arches", "canyonlands", "desert glamping")),
    Scenario("Yosemite", ("yosemite", "half dome", "mist trail")),
    Scenario("Zion", ("zion", "angels landing", "zion canyon")),
    Scenario("Smoky Mountains", ("smoky", "great smoky", "gatlinburg")),
    Scenario("Big Bend", ("big bend", "chisos", "rio grande")),
    Scenario("Glacier", ("glacier national", "grinnell glacier", "glacier campground")),
    Scenario("Olympic", ("olympic", "hoh rainforest", "hurricane ridge")),
    Scenario("New Zealand trail area", ("new zealand", "aoraki", "tongariro", "doc.govt.nz")),
    Scenario("Canadian Rockies", ("banff", "berg lake", "kootenay", "canadian rockies")),
    Scenario("Iceland route town", ("iceland", "thorsmork", "þórsmörk", "reykjavik", "akureyri")),
    Scenario("Sparse rural area", ("great basin", "ely", "nevada", "rural")),
    Scenario("No-service/offline pack only", ("k2", "askole", "baltoro", "remote", "offline")),
]


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc


def text_parts(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (int, float, bool)):
        return [str(value)]
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            parts.extend(text_parts(item))
        return parts
    if isinstance(value, dict):
        parts = []
        for item in value.values():
            parts.extend(text_parts(item))
        return parts
    return []


def compact_text(*values: Any) -> str:
    return " ".join(part.strip() for value in values for part in text_parts(value) if part and str(part).strip())


def normalize_seed_entry(path: Path, group: dict[str, Any], entry: Any, index: int) -> dict[str, Any] | None:
    if isinstance(entry, list):
        title = str(entry[0] if len(entry) > 0 else "").strip()
        base_title = str(entry[1] if len(entry) > 1 else title).strip()
        state = str(entry[2] if len(entry) > 2 else "").strip()
        if not title:
            return None
        return {
            "id": f"seed:{path.stem}:{group.get('key', 'group')}:{index}",
            "title": title,
            "base_title": base_title,
            "state": state,
            "category": group.get("label") or group.get("key") or "",
            "group": group.get("key") or "",
            "tags": group.get("tags") or [],
            "_source_file": path.name,
            "_record_kind": "seed",
        }
    if isinstance(entry, dict):
        title = str(entry.get("title") or entry.get("base_title") or "").strip()
        if not title:
            return None
        normalized = {
            **entry,
            "id": entry.get("id") or f"seed:{path.stem}:{group.get('key', 'group')}:{index}",
            "title": title,
            "base_title": entry.get("base_title") or title,
            "category": entry.get("category") or group.get("label") or group.get("key") or "",
            "group": entry.get("explore_group") or group.get("key") or "",
            "_source_file": path.name,
            "_record_kind": "seed",
        }
        return normalized
    return None


def normalize_v1_place(path: Path, place: dict[str, Any]) -> dict[str, Any] | None:
    summary = place.get("summary") or {}
    title = str(summary.get("title") or place.get("name") or "").strip()
    if not title:
        return None
    source_pack = place.get("source_pack") or {}
    facts = place.get("facts") or {}
    return {
        "id": place.get("id") or summary.get("id") or f"{path.name}:{title}",
        "title": title,
        "base_title": title,
        "category": summary.get("category") or place.get("category") or "",
        "group": summary.get("explore_group") or "",
        "state": summary.get("state") or summary.get("region") or "",
        "summary": summary,
        "profile": place.get("profile") or {},
        "facts": facts,
        "source_pack": source_pack,
        "sources": place.get("sources") or source_pack.get("sources") or [],
        "media": place.get("media") or [],
        "tags": summary.get("tags") or place.get("tags") or [],
        "search_aliases": place.get("search_aliases") or summary.get("search_aliases") or [],
        "lat": summary.get("lat"),
        "lng": summary.get("lng"),
        "source_url": summary.get("source_url") or facts.get("source_url") or source_pack.get("official_url"),
        "image_url": summary.get("image_url") or summary.get("thumbnail_url"),
        "_source_file": path.name,
        "_record_kind": "catalog",
    }


def normalize_v3_place(path: Path, place: dict[str, Any]) -> dict[str, Any] | None:
    title = str(place.get("name") or place.get("title") or "").strip()
    if not title:
        return None
    return {
        "id": place.get("id") or f"{path.name}:{title}",
        "title": title,
        "base_title": title,
        "category": place.get("category") or "",
        "group": place.get("category") or "",
        "state": compact_text(place.get("region"), place.get("country")),
        "summary": {
            "title": title,
            "category": place.get("category") or "",
            "state": compact_text(place.get("region"), place.get("country")),
            "lat": place.get("lat"),
            "lng": place.get("lng"),
            "source_url": (place.get("source") or {}).get("url"),
            "short_description": place.get("summary") or place.get("description") or "",
        },
        "profile": {"summary": place.get("summary") or "", "what_to_know": place.get("description") or ""},
        "facts": {"source_url": (place.get("source") or {}).get("url")},
        "sources": [place.get("source") or {}],
        "media": place.get("media") or [],
        "tags": place.get("tags") or [],
        "search_aliases": place.get("search_aliases") or [],
        "lat": place.get("lat"),
        "lng": place.get("lng"),
        "source_url": (place.get("source") or {}).get("url"),
        "image_url": (place.get("media") or [{}])[0].get("url") if place.get("media") else "",
        "_source_file": path.name,
        "_record_kind": "catalog",
    }


def load_catalog_entries() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in CATALOG_PATHS:
        data = read_json(path)
        if not isinstance(data, dict):
            continue
        schema = data.get("schema_version")
        for place in data.get("places") or []:
            if not isinstance(place, dict):
                continue
            normalized = normalize_v3_place(path, place) if schema == 3 else normalize_v1_place(path, place)
            if not normalized:
                continue
            key = str(normalized.get("id") or "")
            if key in seen:
                continue
            seen.add(key)
            entries.append(normalized)
    return entries


def load_seed_entries() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for path in SEED_PATHS:
        data = read_json(path)
        if not isinstance(data, dict):
            continue
        for group in data.get("groups") or []:
            if not isinstance(group, dict):
                continue
            for index, entry in enumerate(group.get("entries") or [], start=1):
                normalized = normalize_seed_entry(path, group, entry, index)
                if normalized:
                    entries.append(normalized)
    return entries


def searchable_text(entry: dict[str, Any]) -> str:
    raw = compact_text(
        entry.get("title"),
        entry.get("base_title"),
        entry.get("category"),
        entry.get("group"),
        entry.get("state"),
        entry.get("summary"),
        entry.get("profile"),
        entry.get("facts"),
        entry.get("source_pack"),
        entry.get("sources"),
        entry.get("tags"),
        entry.get("search_aliases"),
        entry.get("source_url"),
        entry.get("image_url"),
    ).lower()
    return raw.replace("þ", "th")


def matchable_text(entry: dict[str, Any]) -> str:
    summary = entry.get("summary") or {}
    source_pack = entry.get("source_pack") or {}
    raw = compact_text(
        entry.get("title"),
        entry.get("base_title"),
        entry.get("category"),
        entry.get("group"),
        entry.get("state"),
        entry.get("tags"),
        entry.get("search_aliases"),
        summary.get("title"),
        summary.get("category"),
        summary.get("state"),
        summary.get("region"),
        summary.get("hook"),
        summary.get("short_description"),
        summary.get("source_url"),
        source_pack.get("primary"),
        source_pack.get("official_url"),
        entry.get("source_url"),
    ).lower()
    return raw.replace("þ", "th")


def term_matches(text: str, term: str) -> bool:
    normalized = term.lower().replace("þ", "th")
    if not normalized:
        return False
    if re.search(r"[^a-z0-9]", normalized):
        return normalized in text
    return bool(re.search(rf"(?<![a-z0-9]){re.escape(normalized)}(?![a-z0-9])", text))


def has_coordinates(entry: dict[str, Any]) -> bool:
    summary = entry.get("summary") or {}
    lat = entry.get("lat", summary.get("lat"))
    lng = entry.get("lng", summary.get("lng"))
    return isinstance(lat, (int, float)) and isinstance(lng, (int, float))


def has_source(entry: dict[str, Any]) -> bool:
    source_pack = entry.get("source_pack") or {}
    facts = entry.get("facts") or {}
    summary = entry.get("summary") or {}
    sources = entry.get("sources") or []
    return any([
        entry.get("source_url"),
        summary.get("source_url"),
        facts.get("source_url"),
        facts.get("official_url"),
        source_pack.get("official_url"),
        source_pack.get("primary"),
        source_pack.get("sources"),
        sources,
    ])


def has_freshness(entry: dict[str, Any]) -> bool:
    source_pack = entry.get("source_pack") or {}
    facts = entry.get("facts") or {}
    return any([
        facts.get("last_updated"),
        source_pack.get("last_updated"),
        source_pack.get("quality"),
        entry.get("_record_kind") == "catalog",
    ])


def has_photo(entry: dict[str, Any]) -> bool:
    summary = entry.get("summary") or {}
    source_pack = entry.get("source_pack") or {}
    media = entry.get("media") or []
    return any([
        entry.get("image_url"),
        summary.get("image_url"),
        summary.get("thumbnail_url"),
        source_pack.get("photos"),
        media,
    ])


def has_action(entry: dict[str, Any]) -> bool:
    return has_coordinates(entry) or bool(entry.get("source_url")) or has_source(entry)


def generic_copy_hits(entry: dict[str, Any]) -> list[str]:
    text = searchable_text(entry)
    hits = []
    for pattern in GENERIC_COPY_PATTERNS:
        if pattern.search(text):
            hits.append(pattern.pattern)
    return hits


def scenario_matches(entries: list[dict[str, Any]], scenario: Scenario) -> list[dict[str, Any]]:
    matches = []
    for entry in entries:
        text = matchable_text(entry)
        if any(term_matches(text, term) for term in scenario.terms):
            matches.append(entry)
    return matches


def pct(count: int, total: int) -> str:
    if total <= 0:
        return "0%"
    return f"{round((count / total) * 100)}%"


def main() -> int:
    catalog_entries = load_catalog_entries()
    seed_entries = load_seed_entries()
    all_entries = catalog_entries + seed_entries
    failures: list[str] = []
    warnings: list[str] = []

    print("Explore catalog QA matrix")
    print(f"Catalog records: {len(catalog_entries)}")
    print(f"Seed context records: {len(seed_entries)}")
    print("")

    for scenario in SCENARIOS:
        catalog_matches = scenario_matches(catalog_entries, scenario)
        seed_matches = scenario_matches(seed_entries, scenario)
        matches = catalog_matches or seed_matches
        source_count = sum(1 for entry in matches if has_source(entry))
        fresh_count = sum(1 for entry in matches if has_freshness(entry))
        photo_count = sum(1 for entry in matches if has_photo(entry))
        action_count = sum(1 for entry in matches if has_action(entry))
        generic_count = sum(1 for entry in matches if generic_copy_hits(entry))
        top_titles = ", ".join(str(entry.get("title")) for entry in matches[:4])
        origin = "catalog" if catalog_matches else "seed-only"

        print(
            f"- {scenario.name}: {len(matches)} matches ({origin}); "
            f"source {pct(source_count, len(matches))}, "
            f"freshness {pct(fresh_count, len(matches))}, "
            f"photos {pct(photo_count, len(matches))}, "
            f"actions {pct(action_count, len(matches))}"
        )
        if top_titles:
            print(f"  examples: {top_titles}")

        if len(matches) < scenario.minimum:
            failures.append(f"{scenario.name}: no useful Explore fallback matched {scenario.terms}")
            continue
        if not catalog_matches:
            warnings.append(f"{scenario.name}: only seed context matched; generated catalog needs sync/enrichment.")
        if action_count == 0:
            failures.append(f"{scenario.name}: matched records have no map/source action path.")
        if source_count == 0:
            warnings.append(f"{scenario.name}: matched records are missing source labels.")
        if fresh_count == 0:
            warnings.append(f"{scenario.name}: matched records are missing freshness/trust signals.")
        if photo_count == 0:
            warnings.append(f"{scenario.name}: matched records are missing usable photos.")
        if generic_count:
            warnings.append(f"{scenario.name}: {generic_count} records contain generic/dev copy markers.")

    print("")
    if warnings:
        print("Warnings")
        for warning in warnings:
            print(f"- {warning}")
        print("")

    if failures:
        print("Failures")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: Explore matrix has no dead-end scenarios.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
