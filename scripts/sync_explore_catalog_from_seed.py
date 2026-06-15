#!/usr/bin/env python3
"""Sync Explore catalog from seed without network enrichment.

Use this for small curated additions. It preserves existing generated cards,
creates missing seed cards from fallback metadata, and refreshes rank/group
fields from the seed. Use build_explore_catalog.py for full online enrichment.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from build_explore_catalog import (
    BASE_FALLBACKS,
    GROUP_COPY,
    RELATED_IMAGE_BASE,
    apply_base_fallback,
    build_seed_place,
    build_existing_base_asset_map,
    choose_image,
    load_seed,
    profile_from_seed,
    audio_script,
    validate_catalog,
)


def place_key(entry: dict) -> str:
    return str(entry.get("title") or "").strip().lower()


def source_pack_for_entry(entry: dict, fallback: dict | None) -> dict:
    title = entry.get("title") or entry.get("base_title") or "Explore place"
    source_url = entry.get("source_url") or (fallback or {}).get("source_url") or ""
    return {
        "quality": "curated",
        "primary": entry.get("source_title") or "Official source",
        "official_url": source_url,
        "nps_park_code": "",
        "sources": [{
            "title": title,
            "publisher": entry.get("source_publisher") or "Official source",
            "url": source_url,
            "kind": "official",
        }] if source_url else [],
        "photos": [],
        "activities": [],
        "topics": entry.get("tags") or [],
        "things_to_do": [],
        "things_to_see": [],
        "visitor_centers": [],
        "campgrounds": [],
        "fees": [],
        "operating_hours": "",
        "alerts": [],
        "source_note": "Curated Trailhead Explore source pack. Open the linked official source for current access, fees, closures, and reservation rules.",
        "extract": entry.get("extract") or "",
    }


def refresh_existing(place: dict, entry: dict) -> dict:
    group_key = entry.get("explore_group") or ""
    group = GROUP_COPY.get(group_key, GROUP_COPY["camping"])
    place = dict(place)
    summary = dict(place.get("summary") or {})
    source_pack = dict(place.get("source_pack") or {})
    base_title = entry.get("base_title") or summary.get("title") or entry["title"]
    extract = place.get("wiki_extract") or source_pack.get("extract") or entry.get("extract") or ""
    profile = profile_from_seed(entry, base_title, extract)
    summary.update({
        "rank": entry["rank"],
        "hero_rank": entry.get("hero_rank") or entry["rank"],
        "explore_group": group_key,
        "category": group["category"],
        "state": entry.get("state") or summary.get("state") or "",
        "region": entry.get("state") or summary.get("region") or "",
        "tags": sorted(set(group["tags"] + list(entry.get("tags") or summary.get("tags") or []))),
        "badges": entry.get("badges") or summary.get("badges") or [entry.get("group_label") or group["category"]],
        "hook": profile["hook"],
        "short_description": profile["summary"],
    })
    if entry.get("source_url"):
        summary["source_url"] = entry["source_url"]
    place["summary"] = summary
    previous_profile = dict(place.get("profile") or {})
    previous_profile.update(profile)
    place["profile"] = previous_profile
    place["audio_script"] = audio_script(summary.get("title") or entry["title"], previous_profile)
    facts = dict(place.get("facts") or {})
    facts["last_updated"] = int(time.time())
    if entry.get("source_url"):
        facts["source_url"] = entry["source_url"]
    place["facts"] = facts
    return place


def build_missing(entry: dict, image_assets: dict[str, str]) -> dict:
    base_title = entry.get("base_title") or entry["title"]
    fallback = BASE_FALLBACKS.get(base_title)
    data = {
        "title": base_title,
        "extract": entry.get("extract") or f"{base_title} is a curated Trailhead Explore destination.",
        "fullurl": entry.get("source_url") or (fallback or {}).get("source_url") or "",
        "coordinates": [],
    }
    source_pack = source_pack_for_entry(entry, fallback)
    data, source_pack = apply_base_fallback(data, source_pack, base_title)
    image_asset = ""
    image_url, _credit, _license = choose_image({}, source_pack)
    if image_url and image_url.startswith("/assets/explore/"):
        image_asset = image_url
    if not image_asset:
        related_base = RELATED_IMAGE_BASE.get(base_title, "")
        image_asset = image_assets.get(base_title) or (image_assets.get(related_base) if related_base else "")
    if not image_asset:
        image_asset = image_assets.get(f"__group:{entry.get('explore_group') or ''}") or image_assets.get("__any", "")
    return build_seed_place(entry, data, source_pack, image_asset)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", default="scripts/explore_seed_v2.json")
    parser.add_argument("--catalog", default="dashboard/explore_catalog_v1.json")
    args = parser.parse_args()

    seed, entries = load_seed(Path(args.seed))
    catalog_path = Path(args.catalog)
    catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else {}
    existing_places = catalog.get("places") or []
    existing_by_title = {
        str((place.get("summary") or {}).get("title") or "").strip().lower(): place
        for place in existing_places
    }
    image_assets = build_existing_base_asset_map(entries, existing_by_title)
    for place in existing_places:
        summary = place.get("summary") or {}
        image_url = summary.get("image_url") or summary.get("thumbnail_url") or ""
        if not isinstance(image_url, str) or not image_url:
            continue
        image_assets.setdefault("__any", image_url)
        group_key = str(summary.get("explore_group") or "").strip()
        if group_key:
            image_assets.setdefault(f"__group:{group_key}", image_url)
    preferred_group_images = {
        "parks": ["Banff National Park", "Rocky Mountain Campgrounds", "Yosemite Campgrounds"],
        "monuments": ["Grand Canyon Campgrounds", "Arches Campgrounds", "Mesa Verde National Park"],
        "water_scenic": ["Acadia Campgrounds", "Pacific Rim National Park Reserve", "Apostle Islands Campgrounds"],
        "trails": ["Zion Canyon Trails", "Yosemite Valley Trails", "Half Dome Trail"],
        "camping": ["Yosemite Campgrounds", "Yellowstone Campgrounds", "Banff Campgrounds"],
    }
    for group_key, titles in preferred_group_images.items():
        for title in titles:
            summary = (existing_by_title.get(title.lower()) or {}).get("summary") or {}
            image_url = summary.get("image_url") or summary.get("thumbnail_url") or ""
            if image_url:
                image_assets[f"__group:{group_key}"] = image_url
                break
    synced = []
    created = 0
    for entry in entries:
        existing = existing_by_title.get(place_key(entry))
        if existing:
            synced.append(refresh_existing(existing, entry))
        else:
            synced.append(build_missing(entry, image_assets))
            created += 1
            summary = synced[-1].get("summary") or {}
            if summary.get("image_url"):
                image_assets.setdefault(entry.get("base_title") or entry["title"], summary["image_url"])

    validate_catalog(synced)
    payload = {
        "schema_version": 2,
        "catalog_id": seed.get("catalog_id") or catalog.get("catalog_id") or "trailhead-explore",
        "name": seed.get("name") or catalog.get("name") or "Trailhead Explore",
        "generated_at": int(time.time()),
        "source": "Curated official, public, Wikimedia, and reviewed external Explore sources",
        "future_pack_compatible": True,
        "places": synced,
    }
    catalog_path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"synced {len(synced)} places to {catalog_path}; created {created}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
