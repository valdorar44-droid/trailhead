#!/usr/bin/env python3
"""Build an Explore seed pack from open global destination sources.

The script intentionally outputs the same grouped seed shape consumed by
build_explore_catalog.py. It uses Wikidata/Wikipedia/Wikimedia as the broad
discovery source, then keeps enough attribution on each entry for the app's
source pack to show where the card came from.
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from urllib.parse import quote

import httpx


SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "Trailhead/1.0 global explore seed builder"

QUERY_GROUPS = [
    {
        "key": "trails",
        "label": "Trails",
        "limit": 360,
        "classes": ["Q2143825", "Q1286517", "Q22698", "Q8502"],
        "tags": ["trails", "trekking", "route"],
        "hook": "{title} is a route-worthy trail or trek anchor in {region}.",
        "summary": "Use it to stage trail time, nearby stays, weather, and map context. Verify route, access, permits, and current conditions before committing.",
    },
    {
        "key": "parks",
        "label": "Parks",
        "limit": 420,
        "classes": ["Q46169", "Q179049", "Q473972", "Q9259"],
        "tags": ["parks", "protected area", "outdoors"],
        "hook": "{title} is a protected-land destination worth shaping a route around.",
        "summary": "Use it as a day anchor for nearby camps, trailheads, access notes, and weather. Check the official land manager before relying on dates or roads.",
    },
    {
        "key": "water_scenic",
        "label": "Water & Scenic",
        "limit": 420,
        "classes": ["Q34038", "Q39816", "Q47521", "Q23442", "Q40080", "Q12280"],
        "tags": ["water", "waterfalls", "glaciers", "coast", "views"],
        "hook": "{title} gives Explore a scenic water, ice, or coast anchor in {region}.",
        "summary": "Use it for photos, route timing, nearby trail context, and weather checks. Confirm seasonal access, flow, surf, ice, or road status locally.",
    },
    {
        "key": "monuments",
        "label": "Monuments & History",
        "limit": 320,
        "classes": ["Q9259", "Q4989906", "Q839954", "Q570116"],
        "tags": ["monuments", "history", "heritage", "landmarks"],
        "hook": "{title} gives the route a specific history or landmark stop in {region}.",
        "summary": "Plan time to stop, walk, and read the place instead of treating it like a drive-by pin. Confirm hours, tickets, access, and local rules.",
    },
    {
        "key": "huts_lodging",
        "label": "Huts & Lodging",
        "limit": 180,
        "classes": ["Q182676", "Q2710737", "Q11900058"],
        "tags": ["huts", "lodging", "shelter", "trekking"],
        "hook": "{title} can be a roofed mountain or backcountry planning anchor in {region}.",
        "summary": "Use it as a safer overnight or weather-reset lead. Verify reservations, seasonal access, food, hut rules, and route approach before depending on it.",
    },
    {
        "key": "camping",
        "label": "Camping",
        "limit": 260,
        "classes": ["Q832778", "Q1058914"],
        "tags": ["camping", "campgrounds", "overnight"],
        "hook": "{title} is a named overnight-area lead in {region}.",
        "summary": "Use it to start a camp search near a real destination. Verify legal camping, fees, closures, road access, and booking rules with the local source.",
    },
]


def sparql_for_group(group: dict) -> str:
    values = " ".join(f"wd:{qid}" for qid in group["classes"])
    return f"""
SELECT ?item ?itemLabel ?coord ?countryLabel ?adminLabel WHERE {{
  VALUES ?class {{ {values} }}
  ?item wdt:P31 ?class ;
        wdt:P625 ?coord .
  OPTIONAL {{ ?item wdt:P17 ?country . }}
  OPTIONAL {{ ?item wdt:P131 ?admin . }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" . }}
}}
LIMIT {int(group["limit"]) * 3}
"""


def point_to_lat_lng(value: str) -> tuple[float | None, float | None]:
    match = re.search(r"Point\(([-0-9.]+)\s+([-0-9.]+)\)", value or "")
    if not match:
        return None, None
    return float(match.group(2)), float(match.group(1))


def commons_file_url(value: str) -> str:
    if not value:
        return ""
    if value.startswith("http://commons.wikimedia.org/wiki/Special:FilePath/"):
        return value.replace("http://", "https://", 1)
    if value.startswith("https://commons.wikimedia.org/wiki/Special:FilePath/"):
        return value
    return ""


def clean_title(value: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    text = re.sub(r"\s+\([^)]*\)$", "", text)
    return text


def source_url(item_url: str, article: str) -> str:
    return article or item_url or ""


def region_for(row: dict) -> str:
    admin = row.get("adminLabel", {}).get("value", "")
    country = row.get("countryLabel", {}).get("value", "")
    return " · ".join(part for part in (admin, country) if part) or country or "Global"


def wikidata_qid(item_url: str) -> str:
    return item_url.rstrip("/").rsplit("/", 1)[-1] if item_url else ""


def fetch_group(client: httpx.Client, group: dict) -> list[dict]:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            res = client.get(
                SPARQL_ENDPOINT,
                params={"query": sparql_for_group(group), "format": "json"},
                headers={"Accept": "application/sparql-results+json", "User-Agent": USER_AGENT},
                timeout=90,
            )
            res.raise_for_status()
            break
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            last_error = exc
            time.sleep(2 + attempt * 3)
    else:
        raise RuntimeError(f"failed to fetch Wikidata group {group['key']}: {last_error}") from last_error
    rows = res.json().get("results", {}).get("bindings", [])
    entries: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        item_url = row.get("item", {}).get("value", "")
        qid = wikidata_qid(item_url)
        title = clean_title(row.get("itemLabel", {}).get("value", ""))
        lat, lng = point_to_lat_lng(row.get("coord", {}).get("value", ""))
        if not qid or not title or lat is None or lng is None or qid in seen:
            continue
        seen.add(qid)
        region = region_for(row)
        tags = sorted(set(group["tags"] + [group["label"].lower(), region.lower()]))
        entry = {
            "title": title,
            "base_title": title,
            "state": region,
            "lat": lat,
            "lng": lng,
            "source_url": source_url(item_url, ""),
            "source_publisher": "Wikidata, Wikipedia, and Wikimedia Commons",
            "source_note": "Open global Explore seed from Wikidata/Wikipedia. Verify current access, closures, permits, and local rules before relying on it.",
            "license": "Wikidata CC0; Wikipedia/Commons content requires attribution where used",
            "wikidata_qid": qid,
            "tags": tags,
            "search_aliases": [title, region, qid],
            "hook": group["hook"].format(title=title, region=region),
            "short_description": group["summary"],
        }
        entries.append(entry)
        if len(entries) >= int(group["limit"]):
            break
    return entries


def fallback_seed() -> dict:
    groups = []
    water_entries = [
        ("Perito Moreno Glacier", -50.4967, -73.1377),
        ("Aletsch Glacier", 46.47, 8.04),
        ("Victoria Falls", -17.9243, 25.8572),
        ("Iguazu Falls", -25.6953, -54.4367),
        ("Plitvice Lakes National Park", 44.8654, 15.5820),
        ("Geirangerfjord", 62.1049, 7.0754),
        ("Vatnajokull", 64.5, -17.0),
        ("Jokulsarlon", 64.048, -16.18),
        ("Franz Josef Glacier", -43.46, 170.18),
        ("Fox Glacier", -43.49, 170.02),
        ("Grey Glacier", -50.98, -73.25),
        ("Athabasca Glacier", 52.19, -117.24),
        ("Mer de Glace", 45.9167, 6.9333),
        ("Passu Glacier", 36.47, 74.88),
        ("Baltoro Glacier", 35.74, 76.51),
        ("Biafo Glacier", 35.86, 75.75),
        ("Solheimajokull", 63.53, -19.36),
        ("Skogafoss", 63.5321, -19.5114),
        ("Seljalandsfoss", 63.6156, -19.9886),
        ("Angel Falls", 5.9675, -62.5356),
        ("Kaieteur Falls", 5.175, -59.48),
        ("Sutherland Falls", -44.8, 167.72),
        ("Milford Sound", -44.6414, 167.8974),
        ("Ha Long Bay", 20.91, 107.18),
        ("Lofoten", 68.2, 14.4),
        ("Na Pali Coast State Park", 22.18, -159.65),
    ]
    fallback_titles = [
        ("trails", "Trails", ["Everest Base Camp Trek", "Annapurna Circuit", "Tour du Mont Blanc", "Laugavegur Trail", "Torres del Paine W Trek", "Milford Track"]),
        ("water_scenic", "Water & Scenic", water_entries),
        ("parks", "Parks", ["Serengeti National Park", "Fiordland National Park", "Banff National Park", "Los Glaciares National Park", "Kruger National Park", "Kakadu National Park"]),
        ("monuments", "Monuments & History", ["Machu Picchu", "Petra", "Angkor Wat", "Chichen Itza", "Mesa Verde", "Hadrian's Wall"]),
    ]
    for key, label, titles in fallback_titles:
        group = next(item for item in QUERY_GROUPS if item["key"] == key)
        groups.append({
            "key": key,
            "label": label,
            "entries": [{
                "title": title[0] if isinstance(title, tuple) else title,
                **({"lat": title[1], "lng": title[2]} if isinstance(title, tuple) else {}),
                "base_title": title[0] if isinstance(title, tuple) else title,
                "state": "Global",
                "source_url": f"https://en.wikipedia.org/wiki/{quote((title[0] if isinstance(title, tuple) else title).replace(' ', '_'))}",
                "source_publisher": "Wikipedia",
                "source_note": "Fallback global Explore seed. Verify current access with the local official source.",
                "tags": group["tags"],
                "hook": group["hook"].format(title=title[0] if isinstance(title, tuple) else title, region="Global"),
                "short_description": group["summary"],
            } for title in titles],
        })
    return {"schema_version": 1, "catalog_id": "explore-global-open-seed-v1", "name": "Trailhead Global Open Explore Seed", "groups": groups}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="scripts/explore_global_seed_v1.json")
    parser.add_argument("--max-per-group", type=int, default=0)
    parser.add_argument("--skip-group", action="append", default=[], help="Group key to skip from live Wikidata fetch")
    parser.add_argument("--fallback-missing", action="store_true", help="Add fallback starter entries for skipped or failed groups")
    parser.add_argument("--fallback", action="store_true", help="Write a small offline starter seed instead of querying Wikidata")
    args = parser.parse_args()

    groups = []
    if args.fallback:
        seed = fallback_seed()
    else:
        fallback_by_key = {group["key"]: group for group in fallback_seed().get("groups") or []}
        with httpx.Client(follow_redirects=True) as client:
            for group in QUERY_GROUPS:
                if group["key"] in set(args.skip_group or []):
                    if args.fallback_missing and group["key"] in fallback_by_key:
                        groups.append(fallback_by_key[group["key"]])
                        print(f"used fallback {group['key']} entries", flush=True)
                    else:
                        groups.append({"key": group["key"], "label": group["label"], "entries": []})
                    continue
                work = dict(group)
                if args.max_per_group:
                    work["limit"] = min(int(work["limit"]), args.max_per_group)
                print(f"fetching {work['key']} limit={work['limit']}", flush=True)
                try:
                    entries = fetch_group(client, work)
                except RuntimeError as exc:
                    if not args.fallback_missing:
                        raise
                    print(str(exc), flush=True)
                    entries = (fallback_by_key.get(group["key"]) or {}).get("entries") or []
                    print(f"used fallback {group['key']} entries", flush=True)
                print(f"fetched {len(entries)} {work['key']} entries", flush=True)
                groups.append({"key": group["key"], "label": group["label"], "entries": entries})
                time.sleep(0.5)
        seed = {
            "schema_version": 1,
            "catalog_id": "explore-global-open-seed-v1",
            "name": "Trailhead Global Open Explore Seed",
            "groups": groups,
        }

    Path(args.out).write_text(json.dumps(seed, indent=2, ensure_ascii=False) + "\n")
    total = sum(len(group.get("entries") or []) for group in seed.get("groups") or [])
    print(f"wrote {total} global Explore seed entries to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
