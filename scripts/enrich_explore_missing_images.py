#!/usr/bin/env python3
"""Fill missing Explore card images from Wikimedia Commons search.

This keeps attribution on the card and source pack. It is intentionally scoped
to cards that already have no image, so it does not replace curated/official
photos.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import html
import json
import re
import time
from pathlib import Path
from urllib.parse import quote

import httpx


COMMONS_API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "Trailhead/1.0 Explore image enrichment"


def clean_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", "", value or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def group_hint(group: str, title: str) -> str:
    lowered = title.lower()
    if group == "trails":
        return "mountain trail landscape" if not re.search(r"\b(trail|trek|path|route)\b", lowered) else "trail"
    if group == "parks":
        return "national park landscape"
    if group == "water_scenic":
        if "glacier" in lowered:
            return "glacier"
        if "falls" in lowered or "waterfall" in lowered:
            return "waterfall"
        if "lake" in lowered:
            return "lake"
        return "landscape"
    if group == "monuments":
        return "landmark"
    if group == "huts_lodging":
        return "mountain hut"
    if group == "camping":
        return "campground"
    return "landscape"


def commons_query(title: str, group: str) -> str:
    return f"{title} {group_hint(group, title)}"


def image_from_page(page: dict) -> dict | None:
    infos = page.get("imageinfo") or []
    if not infos:
        return None
    info = infos[0]
    mime = str(info.get("mime") or "")
    url = str(info.get("thumburl") or info.get("url") or "")
    if not url or not mime.startswith("image/"):
        return None
    if url.lower().endswith((".svg", ".gif", ".tif", ".tiff", ".webp")):
        return None
    meta = info.get("extmetadata") or {}
    artist = clean_text((meta.get("Artist") or {}).get("value") or "")
    credit = clean_text((meta.get("Credit") or {}).get("value") or "")
    license_name = clean_text((meta.get("LicenseShortName") or {}).get("value") or "")
    return {
        "url": url,
        "source_url": info.get("descriptionurl") or url,
        "credit": artist or credit or "Wikimedia Commons",
        "license": license_name or "Wikimedia Commons",
    }


def fetch_commons_image(title: str, group: str) -> dict:
    query = commons_query(title, group)
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": query,
        "gsrnamespace": "6",
        "gsrlimit": "8",
        "prop": "imageinfo",
        "iiprop": "url|mime|extmetadata",
        "iiurlwidth": "1200",
    }
    try:
        with httpx.Client(timeout=15, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
            res = client.get(COMMONS_API, params=params)
            res.raise_for_status()
            pages = (res.json().get("query") or {}).get("pages") or {}
    except Exception:
        return {}
    for page in pages.values():
        image = image_from_page(page)
        if image:
            return image
    return {}


def has_image(place: dict) -> bool:
    summary = place.get("summary") or {}
    return bool(summary.get("image_url") or summary.get("thumbnail_url"))


def apply_image(place: dict, image: dict) -> dict:
    place = dict(place)
    summary = dict(place.get("summary") or {})
    title = summary.get("title") or "Explore place"
    summary["image_url"] = image["url"]
    summary["thumbnail_url"] = image["url"]
    summary["image_credit"] = image.get("credit") or "Wikimedia Commons"
    summary["image_license"] = image.get("license") or "Wikimedia Commons"
    place["summary"] = summary
    pack = dict(place.get("source_pack") or {})
    photos = list(pack.get("photos") or [])
    photos.insert(0, {
        "url": image["url"],
        "caption": title,
        "credit": image.get("credit") or "Wikimedia Commons",
        "license": image.get("license") or "Wikimedia Commons",
        "source_url": image.get("source_url") or image["url"],
    })
    pack["photos"] = photos
    sources = list(pack.get("sources") or [])
    sources.insert(0, {
        "title": title,
        "publisher": "Wikimedia Commons",
        "url": image.get("source_url") or image["url"],
        "kind": "image",
    })
    pack["sources"] = sources
    place["source_pack"] = pack
    place["attribution"] = f"{place.get('attribution') or ''}; photo: {summary['image_credit']}".strip("; ")
    return place


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default="dashboard/explore_catalog_v1.json")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    path = Path(args.catalog)
    catalog = json.loads(path.read_text())
    places = catalog.get("places") or []
    missing = [place for place in places if not has_image(place)]
    if args.limit:
        missing = missing[:args.limit]

    targets = []
    for place in missing:
        summary = place.get("summary") or {}
        title = str(summary.get("title") or "").strip()
        if not title:
            continue
        targets.append((place.get("id") or summary.get("id") or "", title, str(summary.get("explore_group") or "")))

    found: dict[str, dict] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 16))) as pool:
        futures = {pool.submit(fetch_commons_image, title, group): place_id for place_id, title, group in targets}
        for future in concurrent.futures.as_completed(futures):
            place_id = futures[future]
            image = future.result()
            if image:
                found[place_id] = image

    updated = []
    for place in places:
        place_id = place.get("id") or (place.get("summary") or {}).get("id") or ""
        image = found.get(place_id)
        updated.append(apply_image(place, image) if image else place)

    catalog["places"] = updated
    catalog["generated_at"] = int(time.time())
    path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")
    print(f"missing={len(missing)} looked_up={len(targets)} enriched={len(found)} catalog={len(updated)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
