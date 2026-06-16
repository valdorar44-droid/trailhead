#!/usr/bin/env python3
"""Append global seed entries to the Explore catalog.

This is a fast phase-1 merger for open global cards. It keeps the existing
catalog intact, hydrates new seed entries from Wikipedia REST summaries where
available, and writes standard ExplorePlaceProfile objects.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.parse import quote

import httpx


GROUP_META = {
    "camping": ("Camping", ["camping", "campgrounds", "overnight"]),
    "glamping": ("Glamping", ["glamping", "stays", "basecamp"]),
    "huts_lodging": ("Huts & Lodging", ["huts", "lodging", "shelter"]),
    "trails": ("Trails", ["trails", "hiking", "trekking"]),
    "parks": ("Parks", ["parks", "protected area", "outdoors"]),
    "monuments": ("Monuments & History", ["monuments", "history", "heritage"]),
    "water_scenic": ("Water & Scenic", ["water", "scenic", "waterfalls", "glaciers"]),
}


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-") or "place"


def sentence(value: str, fallback: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    if not text:
        return fallback
    parts = re.split(r"(?<=[.!?])\s+", text)
    return parts[0].strip() if parts and parts[0].strip() else fallback


def compact_summary(value: str, fallback: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    if not text:
        return fallback
    parts = re.split(r"(?<=[.!?])\s+", text)
    return " ".join(parts[:2]).strip() or fallback


def load_seed_entries(path: Path) -> list[dict]:
    seed = json.loads(path.read_text())
    entries: list[dict] = []
    for group_idx, group in enumerate(seed.get("groups") or [], start=1):
        key = group.get("key") or ""
        label = group.get("label") or key
        for idx, raw in enumerate(group.get("entries") or [], start=1):
            if not isinstance(raw, dict):
                continue
            entry = dict(raw)
            entry.setdefault("explore_group", key)
            entry.setdefault("group_label", label)
            entry.setdefault("rank", 20000 + group_idx * 1000 + idx)
            entry.setdefault("hero_rank", entry["rank"])
            entries.append(entry)
    return entries


def fetch_summary(title: str) -> dict:
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}"
    try:
        with httpx.Client(timeout=12, follow_redirects=True, headers={"User-Agent": "Trailhead/1.0 explore catalog merger"}) as client:
            res = client.get(url)
            if res.status_code == 404:
                return {}
            res.raise_for_status()
            return res.json()
    except Exception:
        return {}


def fetch_summaries(entries: list[dict], workers: int = 12) -> dict[str, dict]:
    titles = sorted({str(entry.get("base_title") or entry.get("title") or "").strip() for entry in entries if entry.get("title")})
    out: dict[str, dict] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_summary, title): title for title in titles}
        for future in concurrent.futures.as_completed(futures):
            title = futures[future]
            out[title] = future.result()
    return out


def image_from_summary(summary: dict) -> tuple[str, str]:
    thumb = summary.get("thumbnail") or {}
    original = summary.get("originalimage") or {}
    url = original.get("source") or thumb.get("source") or ""
    return url, "Wikimedia Commons" if url else ""


def source_url(entry: dict, summary: dict) -> str:
    content = summary.get("content_urls") or {}
    desktop = content.get("desktop") or {}
    return desktop.get("page") or entry.get("source_url") or ""


def build_place(entry: dict, wiki: dict, rank: int) -> dict | None:
    title = str(entry.get("title") or "").strip()
    if not title:
        return None
    group_key = str(entry.get("explore_group") or "")
    category, group_tags = GROUP_META.get(group_key, ("Explore", ["explore"]))
    lat = entry.get("lat")
    lng = entry.get("lng")
    try:
        lat = float(lat)
        lng = float(lng)
    except Exception:
        return None
    region = str(entry.get("state") or entry.get("region") or "").strip() or "Global"
    extract = wiki.get("extract") or ""
    default_hook = str(entry.get("hook") or f"{title} is a source-backed Explore destination in {region}.")
    default_summary = str(entry.get("short_description") or "Use this card for map context, nearby stops, weather, and access checks before committing time to the detour.")
    hook = sentence(extract, default_hook)
    short = compact_summary(extract, default_summary)
    img, credit = image_from_summary(wiki)
    if entry.get("image_url"):
        img = entry["image_url"]
        credit = entry.get("image_credit") or credit or "Wikimedia Commons"
    url = source_url(entry, wiki)
    place_id = f"explore:{group_key}:{slug(title)}"
    tags = sorted(set(group_tags + [str(t).lower() for t in entry.get("tags") or []]))
    return {
        "id": place_id,
        "summary": {
            "id": place_id,
            "title": title,
            "category": category,
            "explore_group": group_key,
            "state": region,
            "region": region,
            "lat": lat,
            "lng": lng,
            "rank": rank,
            "hero_rank": rank,
            "tags": tags,
            "badges": [category],
            "hook": default_hook if len(hook) > 190 else hook,
            "short_description": short,
            "thumbnail_url": img,
            "image_url": img,
            "image_credit": credit,
            "image_license": entry.get("image_license") or entry.get("license") or ("Wikimedia Commons" if img else ""),
            "source_url": url,
            "source_title": entry.get("source_publisher") or "Wikidata/Wikipedia",
        },
        "profile": {
            "hook": default_hook if len(hook) > 190 else hook,
            "summary": short,
            "story": f"{title}. {short} Use current local sources for closures, permits, safety, and seasonal access before planning around it.",
            "why_it_matters": f"{title} adds a real named destination to Explore so route planning can connect map, weather, nearby stops, and access checks.",
            "what_to_know": "This is an open-source planning lead. Verify current access, fees, permits, closures, local rules, and conditions before relying on it.",
            "best_time_to_stop": "Check local season, daylight, weather, and access before setting dates.",
            "access_notes": "Use the linked source and local official sources for current access.",
            "nearby_context": "Open nearby camps, services, weather, and trails before committing it to a route.",
        },
        "audio_script": "",
        "wiki_extract": extract,
        "source_pack": {
            "quality": "open",
            "primary": entry.get("source_publisher") or "Wikidata/Wikipedia",
            "official_url": url,
            "sources": [{
                "title": title,
                "publisher": entry.get("source_publisher") or "Wikidata/Wikipedia",
                "url": url,
                "kind": "open",
            }],
            "photos": ([{
                "url": img,
                "caption": title,
                "credit": credit,
                "license": entry.get("image_license") or "Wikimedia Commons",
            }] if img else []),
            "topics": tags,
            "source_note": entry.get("source_note") or "Open global Explore source pack. Verify current access locally.",
            "extract": extract,
        },
        "facts": {
            "coordinates": f"{lat:.5f}, {lng:.5f}",
            "source_url": url,
            "source_title": entry.get("source_publisher") or "Wikidata/Wikipedia",
            "official_url": url,
            "source_quality": "open",
            "last_updated": int(time.time()),
        },
        "attribution": f"{entry.get('source_publisher') or 'Wikidata/Wikipedia'}; photo credit: {credit or 'not available'}.",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default="dashboard/explore_catalog_v1.json")
    parser.add_argument("--seed", default="scripts/explore_global_seed_v1.json")
    parser.add_argument("--out", default="dashboard/explore_catalog_v1.json")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    catalog_path = Path(args.catalog)
    catalog = json.loads(catalog_path.read_text())
    existing = {str((place.get("summary") or {}).get("title") or "").lower() for place in catalog.get("places") or []}
    existing.update(str(place.get("id") or "").lower() for place in catalog.get("places") or [])
    entries = [entry for entry in load_seed_entries(Path(args.seed)) if str(entry.get("title") or "").lower() not in existing]
    if args.limit:
        entries = entries[:args.limit]
    summaries = fetch_summaries(entries)
    start_rank = max([((place.get("summary") or {}).get("rank") or 0) for place in catalog.get("places") or []] + [0]) + 1
    new_places = []
    for idx, entry in enumerate(entries):
        wiki = summaries.get(str(entry.get("base_title") or entry.get("title") or "")) or {}
        place = build_place(entry, wiki, start_rank + idx)
        if place:
            new_places.append(place)
    catalog = {
        **catalog,
        "generated_at": int(time.time()),
        "source": f"{catalog.get('source') or 'Trailhead Explore'} + global open seed",
        "places": [*(catalog.get("places") or []), *new_places],
    }
    Path(args.out).write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")
    print(f"appended {len(new_places)} global Explore places; catalog now has {len(catalog['places'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
