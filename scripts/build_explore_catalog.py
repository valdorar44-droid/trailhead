#!/usr/bin/env python3
"""Build the seeded Explore catalog from Wikipedia page summaries.

The output is plain JSON so the API can serve it immediately and mobile can
cache it as a future downloadable place-pack shape.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
import httpx


DEFAULT_TITLES = [
    ("Grand Canyon National Park", "Park", "AZ", ["parks", "scenic", "history"]),
    ("Yellowstone National Park", "Park", "WY", ["parks", "scenic", "geology"]),
    ("Yosemite National Park", "Park", "CA", ["parks", "scenic"]),
    ("Arches National Park", "Park", "UT", ["parks", "scenic", "geology"]),
    ("Zion National Park", "Park", "UT", ["parks", "scenic"]),
    ("Bryce Canyon National Park", "Park", "UT", ["parks", "scenic", "geology"]),
    ("Monument Valley", "Scenic Landmark", "AZ", ["scenic", "culture"]),
    ("Canyonlands National Park", "Park", "UT", ["parks", "scenic"]),
    ("Mesa Verde National Park", "Historic Site", "CO", ["history", "culture", "parks"]),
    ("Bears Ears National Monument", "National Monument", "UT", ["monuments", "culture", "scenic"]),
    ("Organ Pipe Cactus National Monument", "National Monument", "AZ", ["monuments", "desert", "scenic"]),
    ("Chaco Culture National Historical Park", "Historic Site", "NM", ["history", "culture"]),
    ("White Sands National Park", "Park", "NM", ["parks", "scenic", "geology"]),
    ("Great Sand Dunes National Park and Preserve", "Park", "CO", ["parks", "scenic"]),
    ("Badlands National Park", "Park", "SD", ["parks", "scenic", "geology"]),
    ("Devils Tower", "National Monument", "WY", ["monuments", "geology", "culture"]),
    ("Mount Rushmore", "Historic Site", "SD", ["history", "monuments"]),
    ("Little Bighorn Battlefield National Monument", "Historic Site", "MT", ["history", "monuments"]),
    ("Glacier National Park (U.S.)", "Park", "MT", ["parks", "scenic"]),
    ("Olympic National Park", "Park", "WA", ["parks", "scenic"]),
    ("Crater Lake National Park", "Park", "OR", ["parks", "scenic", "geology"]),
    ("Redwood National and State Parks", "Park", "CA", ["parks", "scenic"]),
    ("Death Valley National Park", "Park", "CA", ["parks", "desert", "scenic"]),
    ("Joshua Tree National Park", "Park", "CA", ["parks", "desert", "scenic"]),
    ("Sequoia National Park", "Park", "CA", ["parks", "scenic"]),
    ("Big Bend National Park", "Park", "TX", ["parks", "desert", "scenic"]),
    ("Carlsbad Caverns National Park", "Park", "NM", ["parks", "geology"]),
    ("Petrified Forest National Park", "Park", "AZ", ["parks", "geology", "history"]),
    ("Saguaro National Park", "Park", "AZ", ["parks", "desert"]),
    ("Craters of the Moon National Monument and Preserve", "National Monument", "ID", ["monuments", "geology"]),
    ("Dinosaur National Monument", "National Monument", "CO", ["monuments", "geology", "history"]),
    ("Colorado National Monument", "National Monument", "CO", ["monuments", "scenic"]),
    ("Black Canyon of the Gunnison National Park", "Park", "CO", ["parks", "scenic"]),
    ("Rocky Mountain National Park", "Park", "CO", ["parks", "scenic"]),
    ("Tallgrass Prairie National Preserve", "National Preserve", "KS", ["history", "scenic", "parks"]),
    ("Brown v. Board of Education National Historical Park", "Historic Site", "KS", ["history", "culture"]),
    ("Fort Larned National Historic Site", "Historic Site", "KS", ["history"]),
    ("Fort Scott National Historic Site", "Historic Site", "KS", ["history"]),
    ("Cahokia", "Historic Site", "IL", ["history", "culture"]),
    ("Gateway Arch", "National Park", "MO", ["history", "monuments"]),
    ("Hot Springs National Park", "Park", "AR", ["parks", "history"]),
    ("Mammoth Cave National Park", "Park", "KY", ["parks", "geology"]),
    ("Great Smoky Mountains National Park", "Park", "TN", ["parks", "scenic"]),
    ("Shenandoah National Park", "Park", "VA", ["parks", "scenic"]),
    ("Acadia National Park", "Park", "ME", ["parks", "scenic"]),
    ("Everglades National Park", "Park", "FL", ["parks", "wildlife"]),
    ("Dry Tortugas National Park", "Park", "FL", ["parks", "history"]),
    ("Cape Hatteras National Seashore", "National Seashore", "NC", ["scenic", "history"]),
    ("Gettysburg National Military Park", "Historic Site", "PA", ["history"]),
    ("Harpers Ferry National Historical Park", "Historic Site", "WV", ["history"]),
    ("Cuyahoga Valley National Park", "Park", "OH", ["parks", "scenic"]),
    ("Indiana Dunes National Park", "Park", "IN", ["parks", "scenic"]),
    ("Pictured Rocks National Lakeshore", "National Lakeshore", "MI", ["scenic", "parks"]),
    ("Apostle Islands National Lakeshore", "National Lakeshore", "WI", ["scenic", "parks"]),
    ("Voyageurs National Park", "Park", "MN", ["parks", "scenic"]),
    ("Theodore Roosevelt National Park", "Park", "ND", ["parks", "history", "scenic"]),
    ("Isle Royale National Park", "Park", "MI", ["parks", "wildlife"]),
    ("Denali National Park and Preserve", "Park", "AK", ["parks", "scenic"]),
    ("Haleakala National Park", "Park", "HI", ["parks", "scenic", "geology"]),
    ("Hawaii Volcanoes National Park", "Park", "HI", ["parks", "geology"]),
    ("Grand Teton National Park", "Park", "WY", ["parks", "scenic"]),
    ("Mount Rainier National Park", "Park", "WA", ["parks", "scenic"]),
    ("North Cascades National Park", "Park", "WA", ["parks", "scenic"]),
    ("Lassen Volcanic National Park", "Park", "CA", ["parks", "geology"]),
    ("Channel Islands National Park", "Park", "CA", ["parks", "wildlife"]),
    ("Pinnacles National Park", "Park", "CA", ["parks", "geology"]),
    ("Capitol Reef National Park", "Park", "UT", ["parks", "scenic", "geology"]),
    ("Guadalupe Mountains National Park", "Park", "TX", ["parks", "scenic"]),
    ("Wind Cave National Park", "Park", "SD", ["parks", "geology"]),
    ("Jewel Cave National Monument", "National Monument", "SD", ["monuments", "geology"]),
    ("Scotts Bluff National Monument", "National Monument", "NE", ["monuments", "history"]),
    ("Effigy Mounds National Monument", "National Monument", "IA", ["monuments", "history", "culture"]),
    ("Lincoln Home National Historic Site", "Historic Site", "IL", ["history"]),
    ("Vicksburg National Military Park", "Historic Site", "MS", ["history"]),
    ("Natchez Trace Parkway", "Scenic Landmark", "MS", ["history", "scenic"]),
    ("San Antonio Missions National Historical Park", "Historic Site", "TX", ["history", "culture"]),
    ("Padre Island National Seashore", "National Seashore", "TX", ["scenic", "wildlife"]),
    ("Chiricahua National Monument", "National Monument", "AZ", ["monuments", "geology"]),
    ("Bandelier National Monument", "National Monument", "NM", ["monuments", "history", "culture"]),
    ("Gila Cliff Dwellings National Monument", "National Monument", "NM", ["monuments", "history"]),
    ("Hovenweep National Monument", "National Monument", "UT", ["monuments", "history", "culture"]),
    ("Natural Bridges National Monument", "National Monument", "UT", ["monuments", "geology"]),
    ("Cedar Breaks National Monument", "National Monument", "UT", ["monuments", "scenic"]),
    ("Vermilion Cliffs National Monument", "National Monument", "AZ", ["monuments", "scenic", "geology"]),
    ("El Malpais National Monument", "National Monument", "NM", ["monuments", "geology"]),
    ("Kasha-Katuwe Tent Rocks National Monument", "National Monument", "NM", ["monuments", "geology"]),
    ("Tonto National Monument", "National Monument", "AZ", ["monuments", "history"]),
    ("Montezuma Castle National Monument", "National Monument", "AZ", ["monuments", "history"]),
    ("Wupatki National Monument", "National Monument", "AZ", ["monuments", "history"]),
    ("Walnut Canyon National Monument", "National Monument", "AZ", ["monuments", "history"]),
    ("Sunset Crater Volcano National Monument", "National Monument", "AZ", ["monuments", "geology"]),
    ("Tumacácori National Historical Park", "Historic Site", "AZ", ["history", "culture"]),
    ("Fort Union National Monument", "National Monument", "NM", ["monuments", "history"]),
    ("Pecos National Historical Park", "Historic Site", "NM", ["history", "culture"]),
    ("Aztec Ruins National Monument", "National Monument", "NM", ["monuments", "history"]),
    ("Salinas Pueblo Missions National Monument", "National Monument", "NM", ["monuments", "history"]),
    ("Fort Union Trading Post National Historic Site", "Historic Site", "ND", ["history"]),
    ("Pipe Spring National Monument", "National Monument", "AZ", ["monuments", "history"]),
    ("Golden Spike National Historical Park", "Historic Site", "UT", ["history"]),
    ("John Day Fossil Beds National Monument", "National Monument", "OR", ["monuments", "geology"]),
    ("Lava Beds National Monument", "National Monument", "CA", ["monuments", "geology", "history"]),
    ("Muir Woods National Monument", "National Monument", "CA", ["monuments", "scenic"]),
    ("Point Reyes National Seashore", "National Seashore", "CA", ["scenic", "wildlife"]),
    ("Cabrillo National Monument", "National Monument", "CA", ["monuments", "history"]),
    ("Manzanar", "Historic Site", "CA", ["history"]),
]

NPS_API = "https://developer.nps.gov/api/v1"
NPS_PARK_CODES = {
    "Grand Canyon National Park": "grca",
    "Yellowstone National Park": "yell",
    "Yosemite National Park": "yose",
    "Arches National Park": "arch",
    "Zion National Park": "zion",
    "Bryce Canyon National Park": "brca",
    "Canyonlands National Park": "cany",
    "Mesa Verde National Park": "meve",
    "Bears Ears National Monument": "beea",
    "Organ Pipe Cactus National Monument": "orpi",
    "Chaco Culture National Historical Park": "chcu",
    "White Sands National Park": "whsa",
    "Great Sand Dunes National Park and Preserve": "grsa",
    "Badlands National Park": "badl",
    "Devils Tower": "deto",
    "Mount Rushmore": "moru",
    "Little Bighorn Battlefield National Monument": "libi",
    "Glacier National Park (U.S.)": "glac",
    "Olympic National Park": "olym",
    "Crater Lake National Park": "crla",
    "Redwood National and State Parks": "redw",
    "Death Valley National Park": "deva",
    "Joshua Tree National Park": "jotr",
    "Sequoia National Park": "sequ",
    "Big Bend National Park": "bibe",
    "Carlsbad Caverns National Park": "cave",
    "Petrified Forest National Park": "pefo",
    "Saguaro National Park": "sagu",
    "Craters of the Moon National Monument and Preserve": "crmo",
    "Dinosaur National Monument": "dino",
    "Colorado National Monument": "colm",
    "Black Canyon of the Gunnison National Park": "blca",
    "Rocky Mountain National Park": "romo",
    "Tallgrass Prairie National Preserve": "tapr",
    "Brown v. Board of Education National Historical Park": "brvb",
    "Fort Larned National Historic Site": "fols",
    "Fort Scott National Historic Site": "fosc",
    "Gateway Arch": "jeff",
    "Hot Springs National Park": "hosp",
    "Mammoth Cave National Park": "maca",
    "Great Smoky Mountains National Park": "grsm",
    "Shenandoah National Park": "shen",
    "Acadia National Park": "acad",
    "Everglades National Park": "ever",
    "Dry Tortugas National Park": "drto",
    "Cape Hatteras National Seashore": "caha",
    "Gettysburg National Military Park": "gett",
    "Harpers Ferry National Historical Park": "hafe",
    "Cuyahoga Valley National Park": "cuva",
    "Indiana Dunes National Park": "indu",
    "Pictured Rocks National Lakeshore": "piro",
    "Apostle Islands National Lakeshore": "apis",
    "Voyageurs National Park": "voya",
    "Theodore Roosevelt National Park": "thro",
    "Isle Royale National Park": "isro",
    "Denali National Park and Preserve": "dena",
    "Haleakala National Park": "hale",
    "Hawaii Volcanoes National Park": "havo",
    "Grand Teton National Park": "grte",
    "Mount Rainier National Park": "mora",
    "North Cascades National Park": "noca",
    "Lassen Volcanic National Park": "lavo",
    "Channel Islands National Park": "chis",
    "Pinnacles National Park": "pinn",
    "Capitol Reef National Park": "care",
    "Guadalupe Mountains National Park": "gumo",
    "Wind Cave National Park": "wica",
    "Jewel Cave National Monument": "jeca",
    "Scotts Bluff National Monument": "scbl",
    "Effigy Mounds National Monument": "efmo",
    "Lincoln Home National Historic Site": "liho",
    "Vicksburg National Military Park": "vick",
    "Natchez Trace Parkway": "natr",
    "San Antonio Missions National Historical Park": "saan",
    "Padre Island National Seashore": "pais",
    "Chiricahua National Monument": "chir",
    "Bandelier National Monument": "band",
    "Gila Cliff Dwellings National Monument": "gicl",
    "Hovenweep National Monument": "hove",
    "Natural Bridges National Monument": "nabr",
    "Cedar Breaks National Monument": "cebr",
    "Tonto National Monument": "tont",
    "Montezuma Castle National Monument": "moca",
    "Wupatki National Monument": "wupa",
    "Walnut Canyon National Monument": "waca",
    "Sunset Crater Volcano National Monument": "sucr",
    "Tumacácori National Historical Park": "tuma",
    "Fort Union National Monument": "foun",
    "Pecos National Historical Park": "peco",
    "Aztec Ruins National Monument": "azru",
    "Salinas Pueblo Missions National Monument": "sapu",
    "Fort Union Trading Post National Historic Site": "fous",
    "Pipe Spring National Monument": "pisp",
    "Golden Spike National Historical Park": "gosp",
    "John Day Fossil Beds National Monument": "joda",
    "Lava Beds National Monument": "labe",
    "Muir Woods National Monument": "muwo",
    "Point Reyes National Seashore": "pore",
    "Cabrillo National Monument": "cabr",
    "Manzanar": "manz",
}


def slug(title: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return value or "place"


def sentence(text: str, fallback: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return fallback
    match = re.match(r"(.+?[.!?])(?:\s|$)", text)
    return (match.group(1) if match else text[:180]).strip()


def sentences(text: str) -> list[str]:
    text = re.sub(r"\([^)]*pronounced[^)]*\)", "", text or "", flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if len(p.strip()) > 8]


def join_sentences(parts: list[str], start: int, count: int, fallback: str) -> str:
    selected = parts[start:start + count]
    return " ".join(selected).strip() or fallback


def profile_from_summary(title: str, category: str, extract: str, state: str) -> dict:
    parts = sentences(extract)
    lead = parts[0] if parts else f"{title} is a featured Trailhead Explore stop."
    summary = join_sentences(parts, 0, 3, lead)
    know = join_sentences(parts, 1, 3, summary)
    story_core = join_sentences(parts, 0, 7, summary)
    story = (
        f"Here is the story of {title}. {story_core} "
        f"For a Trailhead stop, treat it as more than a photo marker: give yourself time to understand the place, check current access, and look around before moving on."
    )
    return {
        "hook": lead,
        "summary": summary,
        "story": story,
        "why_it_matters": join_sentences(parts, 0, 2, lead),
        "what_to_know": know,
        "best_time_to_stop": (
            "Plan enough daylight to park, walk, read the site context, and take photos without rushing. Early morning and late afternoon are usually the best windows for light, heat, crowds, and slower travel days."
        ),
        "access_notes": (
            f"Confirm current access, fees, hours, road closures, and permit rules before detouring to this {category.lower()} in {state}."
        ),
        "nearby_context": (
            "Treat this as an anchor stop: check nearby fuel, weather, camps, and road conditions before committing to a longer detour."
        ),
    }


def audio_script(title: str, profile: dict) -> str:
    return profile.get("story") or f"{title}. {profile['hook']} {profile['why_it_matters']} {profile['access_notes']}"


def source_pack_from_wiki(summary: dict, extract: str) -> dict:
    return {
        "quality": "wiki",
        "primary": "Wikipedia",
        "official_url": "",
        "nps_park_code": "",
        "sources": [
            {
                "title": summary.get("title", ""),
                "publisher": "Wikipedia",
                "url": summary.get("source_url", ""),
                "kind": "encyclopedia",
            }
        ],
        "photos": [
            photo for photo in [{
                "url": summary.get("image_url") or summary.get("thumbnail_url"),
                "caption": summary.get("title", ""),
                "credit": "Wikimedia Commons",
            }] if photo["url"]
        ],
        "activities": [],
        "topics": summary.get("tags", []),
        "things_to_do": [],
        "things_to_see": [],
        "visitor_centers": [],
        "campgrounds": [],
        "fees": [],
        "operating_hours": "",
        "alerts": [],
        "source_note": "Wikipedia/Wikimedia source pack. Official agency enrichment will be added when a matching source is available.",
        "extract": extract,
    }


def nps_get(client: httpx.Client, endpoint: str, api_key: str, params: dict) -> dict:
    if not api_key:
        return {}
    headers = {"X-Api-Key": api_key, "User-Agent": "Trailhead/1.0 explore catalog builder"}
    res = client.get(f"{NPS_API}/{endpoint}", params=params, headers=headers)
    if res.status_code in (401, 403, 429):
        return {}
    res.raise_for_status()
    return res.json()


def fetch_nps_pack(client: httpx.Client, title: str, api_key: str) -> dict | None:
    code = NPS_PARK_CODES.get(title)
    if not code or not api_key:
        return None
    parks = nps_get(client, "parks", api_key, {"parkCode": code, "limit": 1}).get("data") or []
    if not parks:
        return None
    park = parks[0]
    alerts = nps_get(client, "alerts", api_key, {"parkCode": code, "limit": 5}).get("data") or []
    things_to_do = nps_get(client, "thingstodo", api_key, {"parkCode": code, "limit": 8}).get("data") or []
    things_to_see = nps_get(client, "places", api_key, {"parkCode": code, "limit": 8}).get("data") or []
    visitor_centers = nps_get(client, "visitorcenters", api_key, {"parkCode": code, "limit": 5}).get("data") or []
    campgrounds = nps_get(client, "campgrounds", api_key, {"parkCode": code, "limit": 5}).get("data") or []
    fees = []
    for fee in park.get("entranceFees") or []:
        title_value = fee.get("title") or "Entrance fee"
        cost = fee.get("cost")
        fees.append(f"{title_value}: ${cost}" if cost not in (None, "") else title_value)
    hours = ""
    operating = park.get("operatingHours") or []
    if operating:
        hours = operating[0].get("description") or operating[0].get("name") or ""
    return {
        "quality": "official",
        "primary": "National Park Service",
        "official_url": park.get("url") or "",
        "nps_park_code": code,
        "sources": [
            {
                "title": park.get("fullName") or title,
                "publisher": "National Park Service",
                "url": park.get("url") or "",
                "kind": "official",
            }
        ],
        "photos": [
            {
                "url": photo.get("url"),
                "caption": photo.get("caption") or photo.get("title") or "",
                "credit": photo.get("credit") or "National Park Service",
            }
            for photo in (park.get("images") or [])[:6]
            if photo.get("url")
        ],
        "activities": [item.get("name") for item in (park.get("activities") or [])[:10] if item.get("name")],
        "topics": [item.get("name") for item in (park.get("topics") or [])[:10] if item.get("name")],
        "things_to_do": [compact_nps_item(item, "todo") for item in things_to_do],
        "things_to_see": [compact_nps_item(item, "place") for item in things_to_see],
        "visitor_centers": [compact_nps_item(item, "visitor_center") for item in visitor_centers],
        "campgrounds": [compact_nps_item(item, "campground") for item in campgrounds],
        "fees": fees[:4],
        "operating_hours": hours,
        "alerts": [
            {
                "title": alert.get("title") or "Park alert",
                "category": alert.get("category") or "",
                "url": alert.get("url") or "",
            }
            for alert in alerts[:5]
        ],
        "source_note": "Official NPS source pack with live park details captured at catalog build time.",
        "extract": park.get("description") or "",
    }


def compact_nps_item(item: dict, kind: str) -> dict:
    image = next((photo for photo in item.get("images", []) if photo.get("url")), {})
    title = item.get("title") or item.get("name") or ""
    description = (
        item.get("shortDescription")
        or item.get("listingDescription")
        or item.get("description")
        or item.get("locationDescription")
        or ""
    )
    return {
        "kind": kind,
        "title": title,
        "description": sentence(description, title),
        "url": item.get("url") or "",
        "lat": as_float(item.get("latitude")),
        "lng": as_float(item.get("longitude")),
        "image_url": image.get("url") or "",
        "image_caption": image.get("caption") or image.get("title") or "",
        "image_credit": image.get("credit") or "National Park Service",
    }


def as_float(value) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def chunks(items: list, size: int):
    for idx in range(0, len(items), size):
        yield items[idx:idx + size]


def fetch_pages(client: httpx.Client, titles: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for batch in chunks(titles, 40):
        for attempt in range(4):
            res = client.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "format": "json",
                    "redirects": 1,
                    "titles": "|".join(batch),
                    "prop": "extracts|pageimages|coordinates|info",
                    "exintro": 1,
                    "explaintext": 1,
                    "exsentences": 10,
                    "inprop": "url",
                    "piprop": "thumbnail|original",
                    "pithumbsize": 900,
                },
                headers={"User-Agent": "Trailhead/1.0 explore catalog builder"},
            )
            if res.status_code == 429:
                time.sleep(1.5 * (attempt + 1))
                continue
            res.raise_for_status()
            pages = res.json().get("query", {}).get("pages", {})
            for page in pages.values():
                title = page.get("title")
                if title:
                    out[title] = page
            time.sleep(0.35)
            break
    return out


def fetch_page(client: httpx.Client, title: str) -> dict | None:
    pages = fetch_pages(client, [title])
    return pages.get(title) or next(iter(pages.values()), None)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="dashboard/explore_catalog_v1.json")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    nps_api_key = os.environ.get("NPS_API_KEY", "").strip()

    titles = DEFAULT_TITLES[: args.limit] if args.limit else DEFAULT_TITLES
    places = []
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        pages = fetch_pages(client, [title for title, _category, _state, _tags in titles])
        for rank, (title, category, state, tags) in enumerate(titles, start=1):
            data = pages.get(title)
            if not data:
                data = next((page for key, page in pages.items() if key.lower() == title.lower()), None)
            if not data:
                continue
            if not data.get("extract"):
                data = fetch_page(client, title) or data
            coords = (data.get("coordinates") or [{}])[0]
            lat = coords.get("lat")
            lng = coords.get("lon")
            extract = data.get("extract") or ""
            display_title = data.get("title") or title
            profile = profile_from_summary(display_title, category, extract, state)
            place_id = f"wiki:{data.get('pageid') or slug(display_title)}"
            summary = {
                "id": place_id,
                "title": display_title,
                "category": category,
                "state": state,
                "region": state,
                "lat": lat,
                "lng": lng,
                "rank": rank,
                "tags": tags,
                "hook": profile["hook"],
                "short_description": sentence(extract, profile["hook"]),
                "thumbnail_url": (data.get("thumbnail") or {}).get("source"),
                "image_url": (data.get("original") or data.get("thumbnail") or {}).get("source"),
                "source_url": data.get("fullurl") or f"https://en.wikipedia.org/?curid={data.get('pageid')}",
                "source_title": "Wikipedia",
            }
            source_pack = source_pack_from_wiki(summary, extract)
            nps_pack = fetch_nps_pack(client, title, nps_api_key)
            if nps_pack:
                source_pack = {
                    **source_pack,
                    **nps_pack,
                    "sources": nps_pack["sources"] + source_pack["sources"],
                    "photos": nps_pack["photos"] or source_pack["photos"],
                    "extract": nps_pack.get("extract") or source_pack["extract"],
                }
                if source_pack["photos"]:
                    summary["image_url"] = source_pack["photos"][0]["url"]
                    summary["thumbnail_url"] = summary["thumbnail_url"] or source_pack["photos"][0]["url"]
            places.append({
                "id": place_id,
                "summary": summary,
                "profile": profile,
                "audio_script": audio_script(display_title, profile),
                "wiki_extract": extract,
                "source_pack": source_pack,
                "facts": {
                    "coordinates": f"{lat:.5f}, {lng:.5f}" if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) else "",
                    "source_url": summary["source_url"],
                    "source_title": "Wikipedia",
                    "official_url": source_pack.get("official_url") or "",
                    "source_quality": source_pack.get("quality") or "wiki",
                    "last_updated": int(time.time()),
                },
                "attribution": (
                    "Official NPS details plus Wikipedia/Wikimedia context, summarized for Trailhead."
                    if source_pack.get("quality") == "official"
                    else "Text and images sourced from Wikipedia/Wikimedia, summarized for Trailhead."
                ),
            })

    payload = {
        "schema_version": 1,
        "catalog_id": "explore-us-top-v1",
        "name": "Trailhead Featured Explore",
        "generated_at": int(time.time()),
        "source": "Wikipedia/Wikimedia + Trailhead generated profiles",
        "future_pack_compatible": True,
        "places": places,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {len(places)} places to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
