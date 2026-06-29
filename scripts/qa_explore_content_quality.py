#!/usr/bin/env python3
"""Audit Explore catalog content quality beyond search coverage.

This intentionally checks the app-facing sanitized shape. Raw source packs can
contain weak provider text, but after normalization the mobile app should not
show disambiguation copy, generic Wikidata labels, invalid coordinates, or
unbounded child pins that make mini maps look random.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.explore_sources.base.content_quality import (
    SOURCE_PACK_LIST_KEYS,
    category_key,
    distance_mi,
    is_weak_description,
    map_child_radius_mi,
    sanitize_place_profile,
    valid_lat_lng,
)

DEFAULT_CATALOGS = (
    ROOT / "dashboard/explore_catalog_v1.json",
    ROOT / "dashboard/explore_catalog_v3.json",
)


def load_places(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: expected object payload")
    return [place for place in payload.get("places") or [] if isinstance(place, dict)]


def summary_for(place: dict[str, Any]) -> dict[str, Any]:
    return place.get("summary") if isinstance(place.get("summary"), dict) else {}


def title_for(place: dict[str, Any]) -> str:
    summary = summary_for(place)
    return str(summary.get("title") or place.get("name") or place.get("title") or "").strip()


def category_for(place: dict[str, Any]) -> str:
    summary = summary_for(place)
    return str(summary.get("category") or place.get("category") or "").strip()


def group_for(place: dict[str, Any]) -> str:
    summary = summary_for(place)
    return str(summary.get("explore_group") or "").strip()


def description_for(place: dict[str, Any]) -> str:
    summary = summary_for(place)
    profile = place.get("profile") if isinstance(place.get("profile"), dict) else {}
    card = place.get("card") if isinstance(place.get("card"), dict) else {}
    return str(
        summary.get("short_description")
        or profile.get("summary")
        or card.get("summary")
        or place.get("description")
        or place.get("summary")
        or ""
    ).strip()


def coord_for(place: dict[str, Any]) -> tuple[Any, Any]:
    summary = summary_for(place)
    return summary.get("lat", place.get("lat")), summary.get("lng", place.get("lng"))


def audit_catalog(path: Path, *, sample_limit: int) -> tuple[list[str], list[str]]:
    places = load_places(path)
    failures: list[str] = []
    warnings: list[str] = []
    raw_weak = []
    normalized_weak = []
    title_locations: dict[str, list[tuple[str, Any, Any]]] = defaultdict(list)
    coord_counts: Counter[str] = Counter()
    category_counts: Counter[str] = Counter()
    missing_sources = 0
    hidden_far_children = 0

    for place in places:
        title = title_for(place)
        category = category_for(place)
        group = group_for(place)
        raw_desc = description_for(place)
        if is_weak_description(raw_desc, title=title, category=category, group=group):
            raw_weak.append(title or str(place.get("id") or "missing-title"))

        clean = sanitize_place_profile(place)
        clean_title = title_for(clean)
        clean_category = category_for(clean)
        clean_group = group_for(clean)
        clean_desc = description_for(clean)
        key = category_key(clean_category, clean_group, clean_title)
        category_counts[key] += 1

        if not clean_title:
            failures.append(f"{path.name}: missing title for {place.get('id')}")
        if is_weak_description(clean_desc, title=clean_title, category=clean_category, group=clean_group):
            normalized_weak.append(clean_title or str(place.get("id") or "missing-title"))

        lat, lng = coord_for(clean)
        if lat is not None or lng is not None:
            if not valid_lat_lng(lat, lng):
                failures.append(f"{path.name}: invalid coordinates for {clean_title}: {lat},{lng}")
            else:
                coord_counts[f"{float(lat):.4f},{float(lng):.4f}"] += 1

        source_pack = clean.get("source_pack") if isinstance(clean.get("source_pack"), dict) else {}
        sources = clean.get("sources") if isinstance(clean.get("sources"), list) else []
        summary = summary_for(clean)
        source_url = (
            source_pack.get("official_url")
            or summary.get("source_url")
            or (clean.get("facts") or {}).get("source_url")
            or next((item.get("url") or item.get("source_url") for item in sources if isinstance(item, dict) and (item.get("url") or item.get("source_url"))), "")
        )
        if not source_url:
            missing_sources += 1

        parent_lat, parent_lng = coord_for(clean)
        radius = map_child_radius_mi(clean_category, clean_group)
        for list_key in SOURCE_PACK_LIST_KEYS:
            for item in source_pack.get(list_key) or []:
                if not isinstance(item, dict):
                    continue
                item_title = str(item.get("title") or item.get("name") or clean_title).strip()
                item_desc = str(item.get("description") or item.get("summary") or "").strip()
                if is_weak_description(item_desc, title=item_title, category=item.get("kind") or item.get("category") or clean_category, group=clean_group):
                    failures.append(f"{path.name}: weak child copy in {clean_title} -> {item_title}")
                child_distance = distance_mi(parent_lat, parent_lng, item.get("lat"), item.get("lng"))
                if child_distance is not None and child_distance > radius:
                    if not item.get("map_hidden"):
                        failures.append(
                            f"{path.name}: far child pin not hidden in {clean_title} -> {item_title}: "
                            f"{child_distance:.1f} mi > {radius:.0f} mi"
                        )
                    else:
                        hidden_far_children += 1

        title_key = clean_title.lower()
        if title_key:
            lat, lng = coord_for(clean)
            title_locations[title_key].append((clean_title, lat, lng))

    if normalized_weak:
        for title in normalized_weak[:sample_limit]:
            failures.append(f"{path.name}: normalized weak description remains: {title}")

    duplicate_titles: list[str] = []
    for title_key, records in title_locations.items():
        if len(records) < 2:
            continue
        near_duplicate = False
        for idx, first in enumerate(records):
            for second in records[idx + 1:]:
                distance = distance_mi(first[1], first[2], second[1], second[2])
                if distance is None or distance <= 1:
                    near_duplicate = True
                    break
            if near_duplicate:
                break
        if near_duplicate:
            duplicate_titles.append(title_key)
    duplicate_coords = sum(1 for _, count in coord_counts.items() if count > 1)
    if raw_weak:
        warnings.append(f"{path.name}: raw weak descriptions sanitized={len(raw_weak)} samples={raw_weak[:sample_limit]}")
    if duplicate_titles:
        warnings.append(f"{path.name}: nearby duplicate titles={len(duplicate_titles)} samples={duplicate_titles[:sample_limit]}")
    if duplicate_coords:
        examples = [coord for coord, count in coord_counts.items() if count > 1][:sample_limit]
        warnings.append(f"{path.name}: duplicate coordinate clusters={duplicate_coords} samples={examples}")
    if missing_sources:
        warnings.append(f"{path.name}: missing source URL after normalization={missing_sources}")
    if hidden_far_children:
        warnings.append(f"{path.name}: far child pins hidden from mini maps={hidden_far_children}")

    warnings.append(
        f"{path.name}: places={len(places)} categories={dict(category_counts.most_common(10))}"
    )
    return failures, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Explore catalog copy, source-pack children, and map-pin quality.")
    parser.add_argument("catalog", nargs="*", type=Path, default=list(DEFAULT_CATALOGS))
    parser.add_argument("--sample-limit", type=int, default=8)
    args = parser.parse_args()

    failures: list[str] = []
    warnings: list[str] = []
    for path in args.catalog:
        if not path.exists():
            failures.append(f"{path}: missing catalog")
            continue
        catalog_failures, catalog_warnings = audit_catalog(path, sample_limit=max(1, args.sample_limit))
        failures.extend(catalog_failures)
        warnings.extend(catalog_warnings)

    print("Explore content-quality QA")
    for warning in warnings:
        print(f"WARN: {warning}")
    if failures:
        print("\nFAILURES:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("PASS: app-facing Explore catalog copy and mini-map metadata are usable.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
