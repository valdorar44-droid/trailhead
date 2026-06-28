#!/usr/bin/env python3
"""Promote selected NPS related records into top-level Explore v3 places.

This is intentionally conservative: it only uses cached official NPS source
packs, requires usable coordinates, skips existing catalog titles, and caps the
total promoted records so the mobile Explore home remains quick to hydrate.
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any


NPS_LICENSE = "National Park Service public data"
NPS_ATTRIBUTION = "National Park Service"
DEFAULT_FIXTURE_GLOB = "data/explore/source_cache/nps/source-pack_codes-*_with-*.json"
ENDPOINT_ORDER = ("campgrounds", "visitorcenters", "thingstodo", "places")
ENDPOINT_LIMITS = {
    "campgrounds": 18,
    "visitorcenters": 8,
    "thingstodo": 8,
    "places": 14,
}


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\xa0", " ")).strip()


def slugify(value: Any) -> str:
    text = compact_text(value).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:96] or "place"


def title_key(value: Any) -> str:
    text = compact_text(value).lower()
    text = re.sub(r"&", " and ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def sentence_preview(value: str, max_chars: int = 520) -> str:
    text = compact_text(value)
    if len(text) <= max_chars:
        return text
    boundaries = [match.end() for match in re.finditer(r'[.!?](?=(?:["\')\]]|\s|$))', text)]
    before = next((idx for idx in reversed(boundaries) if 140 <= idx <= max_chars), None)
    after = next((idx for idx in boundaries if max_chars < idx <= int(max_chars * 1.25)), None)
    cut = before or after
    return text[:cut].strip() if cut else text[:max_chars].rsplit(" ", 1)[0].strip()


def item_lat_lng(item: dict[str, Any]) -> tuple[float | None, float | None]:
    lat_raw = item.get("latitude") or item.get("lat")
    lng_raw = item.get("longitude") or item.get("lng") or item.get("lon")
    if lat_raw and lng_raw:
        try:
            lat = float(lat_raw)
            lng = float(lng_raw)
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                return lat, lng
        except Exception:
            pass
    lat_long = compact_text(item.get("latLong"))
    if lat_long:
        lat_match = re.search(r"lat\s*[:=]\s*(-?\d+(?:\.\d+)?)", lat_long, re.I)
        lng_match = re.search(r"(?:lng|long|lon)\s*[:=]\s*(-?\d+(?:\.\d+)?)", lat_long, re.I)
        if lat_match and lng_match:
            try:
                lat = float(lat_match.group(1))
                lng = float(lng_match.group(1))
                if -90 <= lat <= 90 and -180 <= lng <= 180:
                    return lat, lng
            except Exception:
                pass
        pair = re.match(r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$", lat_long)
        if pair:
            try:
                lat = float(pair.group(1))
                lng = float(pair.group(2))
                if -90 <= lat <= 90 and -180 <= lng <= 180:
                    return lat, lng
            except Exception:
                pass
    return None, None


def child_title(item: dict[str, Any]) -> str:
    return compact_text(item.get("title") or item.get("name") or item.get("listingName"))


def child_description(item: dict[str, Any]) -> str:
    return compact_text(
        item.get("description")
        or item.get("shortDescription")
        or item.get("listingDescription")
        or item.get("bodyText")
    )


def child_url(item: dict[str, Any], park: dict[str, Any]) -> str:
    return compact_text(item.get("url") or item.get("relatedUrl") or park.get("url"))


def first_image(item: dict[str, Any]) -> dict[str, Any]:
    for image in item.get("images") or []:
        if isinstance(image, dict) and compact_text(image.get("url")):
            return image
    return {}


def category_for_item(endpoint: str, item: dict[str, Any]) -> str:
    if endpoint == "campgrounds":
        return "campground"
    if endpoint == "visitorcenters":
        return "visitor_center"
    text = " ".join([
        child_title(item),
        child_description(item),
        compact_text(item.get("activityDescription")),
        " ".join(compact_text(tag.get("name")) for tag in item.get("activities") or [] if isinstance(tag, dict)),
    ]).lower()
    if re.search(r"\b(campground|campsite|camping)\b", text):
        return "campground"
    if re.search(r"\b(visitor center|welcome center|information station|ranger station)\b", text):
        return "visitor_center"
    if re.search(r"\b(waterfall|falls|cascade)\b", text):
        return "waterfall"
    if re.search(r"\b(lake|river|beach|shore|creek|spring)\b", text):
        return "lake"
    if re.search(r"\b(hike|hiking|trail|walk|bike|bicycle|cycling)\b", text):
        return "trail"
    if re.search(r"\b(climb|climbing|boulder)\b", text):
        return "climbing_area"
    if re.search(r"\b(overlook|viewpoint|view point|vista|scenic|rim|point)\b", text):
        return "viewpoint"
    if re.search(r"\b(historic|history|museum|cabin|archaeolog|ruins|battlefield|fort)\b", text):
        return "historic_site"
    return "viewpoint" if endpoint == "places" else "trail"


def should_promote(endpoint: str, item: dict[str, Any]) -> bool:
    title = child_title(item)
    if len(title) < 3:
        return False
    lat, lng = item_lat_lng(item)
    if lat is None or lng is None:
        return False
    description = child_description(item)
    image = first_image(item)
    if endpoint in {"campgrounds", "visitorcenters"}:
        return len(description) >= 60
    if endpoint == "thingstodo":
        return len(description) >= 90 and bool(image)
    if endpoint == "places":
        text = f"{title} {description}".lower()
        useful = re.search(r"\b(overlook|view|trail|falls|lake|river|historic|museum|valley|rim|point|spring|canyon|meadow)\b", text)
        return len(description) >= 100 and bool(image) and bool(useful)
    return False


def endpoint_label(endpoint: str) -> str:
    return {
        "campgrounds": "Campground",
        "visitorcenters": "Visitor center",
        "thingstodo": "Activity",
        "places": "Place",
    }.get(endpoint, "Place")


def place_from_child(park: dict[str, Any], endpoint: str, item: dict[str, Any], generated_at: int) -> dict[str, Any] | None:
    title = child_title(item)
    lat, lng = item_lat_lng(item)
    if lat is None or lng is None:
        return None
    park_code = compact_text(park.get("parkCode") or park.get("id")).lower()
    park_name = compact_text(park.get("fullName") or park.get("name") or park_code.upper())
    state = compact_text(park.get("states") or park.get("state"))
    description = sentence_preview(child_description(item))
    if not description:
        description = f"{title} is an official National Park Service {endpoint_label(endpoint).lower()} record in {park_name}. Check current access, hours, closures, fees, and local rules before relying on it."
    url = child_url(item, park)
    source_id = compact_text(item.get("id") or item.get("url") or f"{park_code}:{endpoint}:{slugify(title)}")
    category = category_for_item(endpoint, item)
    image = first_image(item)
    image_url = compact_text(image.get("url"))
    image_caption = compact_text(image.get("caption") or image.get("title") or title)
    image_credit = compact_text(image.get("credit") or NPS_ATTRIBUTION)
    tags = sorted({
        "nps",
        "official",
        endpoint_label(endpoint).lower(),
        category.replace("_", " "),
        park_name,
        park_code,
    })
    place_id = f"place:nps-child:{park_code}:{endpoint}:{slugify(title)}"
    return {
        "id": place_id,
        "source_ids": [f"nps:{park_code}:{endpoint}:{slugify(source_id)}"],
        "name": title,
        "category": category,
        "subcategories": [endpoint_label(endpoint).lower().replace(" ", "_")],
        "lat": lat,
        "lng": lng,
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "country": "US",
        "region": state,
        "admin": park_name,
        "summary": description,
        "description": description,
        "tags": tags,
        "search_aliases": [park_name, park_code.upper(), endpoint_label(endpoint), category.replace("_", " ")],
        "search_blob": " ".join([title, park_name, endpoint, category, description, url]).lower(),
        "amenities": [],
        "media": [{
            "url": image_url,
            "caption": image_caption,
            "credit": image_credit,
            "license": NPS_LICENSE,
        }] if image_url else [],
        "source_pack": {
            "quality": "official",
            "primary": NPS_ATTRIBUTION,
            "official_url": url,
            "nps_park_code": park_code,
            "sources": [{
                "title": title,
                "publisher": NPS_ATTRIBUTION,
                "url": url,
                "kind": "official",
            }],
            "photos": [{
                "url": image_url,
                "caption": image_caption,
                "credit": image_credit,
                "license": NPS_LICENSE,
            }] if image_url else [],
            "activities": [],
            "topics": tags,
            "source_note": "Official National Park Service data",
            "extract": description,
            "license": NPS_LICENSE,
        },
        "sources": [{
            "source": "nps",
            "source_id": source_id,
            "url": url,
            "license": NPS_LICENSE,
            "attribution": NPS_ATTRIBUTION,
            "quality": "official_source",
        }],
        "quality": "official_source",
        "last_seen_at": generated_at,
        "updated_at": generated_at,
        "card": {
            "title": title,
            "headline": title,
            "summary": description,
            "highlight": description,
            "region": state or park_name,
            "quick_facts": [park_name, endpoint_label(endpoint)],
            "source_badge": NPS_ATTRIBUTION,
        },
    }


def load_existing_keys(catalog: dict[str, Any]) -> tuple[set[str], set[str]]:
    ids: set[str] = set()
    titles: set[str] = set()
    for place in catalog.get("places") or []:
        if not isinstance(place, dict):
            continue
        ids.add(compact_text(place.get("id")))
        titles.add(title_key(place.get("name") or place.get("title") or (place.get("summary") or {}).get("title")))
    return ids, {key for key in titles if key}


def merge_existing_keys(ids: set[str], titles: set[str], path: Path) -> None:
    if not path.exists():
        return
    catalog = json.loads(path.read_text())
    other_ids, other_titles = load_existing_keys(catalog)
    ids.update(other_ids)
    titles.update(other_titles)


def promote_from_fixture(path: Path, existing_ids: set[str], existing_titles: set[str], generated_at: int, max_per_park: int) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text())
    parks = payload.get("data") if isinstance(payload, dict) else []
    related = payload.get("related") if isinstance(payload, dict) else {}
    if not isinstance(parks, list) or not isinstance(related, dict):
        return []
    promoted: list[dict[str, Any]] = []
    for park in parks:
        if not isinstance(park, dict):
            continue
        park_code = compact_text(park.get("parkCode") or park.get("id")).lower()
        endpoint_items = related.get(park_code) if isinstance(related.get(park_code), dict) else {}
        added_for_park = 0
        for endpoint in ENDPOINT_ORDER:
            items = endpoint_items.get(endpoint) if isinstance(endpoint_items, dict) else []
            if not isinstance(items, list):
                continue
            added_for_endpoint = 0
            for item in items:
                if not isinstance(item, dict) or not should_promote(endpoint, item):
                    continue
                place = place_from_child(park, endpoint, item, generated_at)
                if not place:
                    continue
                key = title_key(place.get("name"))
                if place["id"] in existing_ids or key in existing_titles:
                    added_for_park += 1
                    added_for_endpoint += 1
                    if added_for_endpoint >= ENDPOINT_LIMITS[endpoint] or added_for_park >= max_per_park:
                        break
                    continue
                existing_ids.add(place["id"])
                existing_titles.add(key)
                promoted.append(place)
                added_for_park += 1
                added_for_endpoint += 1
                if added_for_endpoint >= ENDPOINT_LIMITS[endpoint] or added_for_park >= max_per_park:
                    break
            if added_for_park >= max_per_park:
                break
    return promoted


def default_fixtures() -> list[Path]:
    return sorted(Path().glob(DEFAULT_FIXTURE_GLOB))


def main() -> int:
    parser = argparse.ArgumentParser(description="Promote high-quality cached NPS child records into the Explore v3 catalog.")
    parser.add_argument("--catalog", default="dashboard/explore_catalog_v3.json")
    parser.add_argument("--out", default="")
    parser.add_argument("--fixture", action="append", default=[])
    parser.add_argument("--base-catalog", action="append", default=["dashboard/explore_catalog_v1.json"])
    parser.add_argument("--max-total", type=int, default=180)
    parser.add_argument("--max-per-park", type=int, default=36)
    args = parser.parse_args()

    catalog_path = Path(args.catalog)
    catalog = json.loads(catalog_path.read_text())
    places = [place for place in catalog.get("places") or [] if isinstance(place, dict)]
    existing_ids, existing_titles = load_existing_keys({"places": places})
    for base_catalog in args.base_catalog:
        merge_existing_keys(existing_ids, existing_titles, Path(base_catalog))
    generated_at = int(time.time())
    fixtures = [Path(item) for item in args.fixture] if args.fixture else default_fixtures()
    promoted: list[dict[str, Any]] = []
    for fixture in fixtures:
        if len(promoted) >= args.max_total:
            break
        additions = promote_from_fixture(
            fixture,
            existing_ids,
            existing_titles,
            generated_at,
            max_per_park=max(1, args.max_per_park),
        )
        remaining = max(0, args.max_total - len(promoted))
        promoted.extend(additions[:remaining])
    out_path = Path(args.out or args.catalog)
    next_catalog = {
        **catalog,
        "generated_at": generated_at,
        "source": f"{catalog.get('source') or 'Explore v3'}; selected cached NPS related records promoted",
        "count": len(places) + len(promoted),
        "places": [*places, *promoted],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(next_catalog, indent=2, ensure_ascii=False) + "\n")
    print(f"promoted {len(promoted)} NPS child places into {out_path}")
    print(f"catalog count {len(places)} -> {len(next_catalog['places'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
