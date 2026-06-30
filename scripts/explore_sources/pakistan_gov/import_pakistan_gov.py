from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from scripts.explore_sources.base.aliases import apply_aliases
from scripts.explore_sources.base.cards import build_card
from scripts.explore_sources.base.normalize import compact_text, slugify, sorted_unique
from scripts.explore_sources.base.quality import quality_for_source, score_place
from scripts.explore_sources.base.schema import ExplorePlaceV3, SourceRecord, TrailGeometry
from scripts.explore_sources.base.source_policy import assert_source_allowed


PAKISTAN_GOV_ATTRIBUTION = "Government of Pakistan regional tourism and wildlife portals"

PAKISTAN_GOV_SEEDS: list[dict[str, Any]] = [
    {
        "source_id": "cda:margalla-hills-trails",
        "name": "Margalla Hills Trails",
        "category": "trail",
        "region": "Islamabad",
        "admin": "Margalla Hills National Park",
        "lat": 33.7515,
        "lng": 73.0848,
        "source_url": "https://www.cda.gov.pk/adventure#gsc.tab=0",
        "publisher": "Capital Development Authority",
        "summary": "Islamabad trail area with marked Margalla routes, ridge viewpoints, and quick city access.",
        "best_season": "Cooler mornings and shoulder seasons are usually easier.",
        "access": "Trailheads sit above Islamabad; parking, daylight, heat, and police/local guidance matter.",
        "safety": "Carry water, start early in heat, stay on marked trails, and check local guidance.",
        "activities": ["Hiking", "Viewpoints", "Trailheads"],
        "things_to_do": [
            {"title": "Trail 3", "description": "Steep city-side Margalla route with ridge views.", "category": "Hiking"},
            {"title": "Trail 5", "description": "Popular forested route with stream sections and flexible turnaround points.", "category": "Hiking"},
            {"title": "Daman-e-Koh", "description": "Viewpoint stop above Islamabad for a shorter scenic visit.", "category": "Viewpoint"},
        ],
        "aliases": ["margalla trails", "trail 3", "trail 5", "islamabad hiking", "daman e koh"],
    },
    {
        "source_id": "gb:deosai-national-park",
        "name": "Deosai National Park",
        "category": "park",
        "region": "Gilgit-Baltistan",
        "admin": "Skardu / Astore",
        "lat": 35.0300,
        "lng": 75.4100,
        "source_url": "https://visitgilgitbaltistan.gov.pk/",
        "publisher": "Government of Gilgit-Baltistan",
        "summary": "High-altitude plateau route area between Skardu and Astore, with seasonal access and weather limits.",
        "best_season": "Summer access window; verify road status before committing.",
        "access": "Road access is seasonal and conditions can change quickly across the plateau.",
        "safety": "Altitude, cold, storms, fuel range, and limited services can shape the day.",
        "activities": ["Scenic drive", "Lake stops", "Wildlife viewing"],
        "things_to_do": [
            {"title": "Sheosar Lake", "description": "High plateau lake stop with weather and road-status checks.", "category": "Lake"},
            {"title": "Bara Pani", "description": "Seasonal plateau crossing area; verify bridge, road, and weather conditions.", "category": "Route stop"},
        ],
        "aliases": ["deosai", "deosai plains", "sheosar lake", "bara pani"],
    },
    {
        "source_id": "gb:k2-baltoro-planning",
        "name": "K2 and Baltoro Trek Area",
        "category": "trail",
        "region": "Gilgit-Baltistan",
        "admin": "Shigar / Central Karakoram",
        "lat": 35.7455,
        "lng": 76.5142,
        "source_url": "https://visitgilgitbaltistan.gov.pk/",
        "publisher": "Government of Gilgit-Baltistan",
        "summary": "Remote trek-planning hub for Askole, Baltoro Glacier, Concordia, and K2 Base Camp.",
        "best_season": "June through September is the usual planning window.",
        "access": "Stage through Skardu and Askole; do not use trek lines as vehicle navigation.",
        "safety": "Guide support, permits, glacier conditions, bridges, altitude, and weather must be verified locally.",
        "activities": ["Multi-day trekking", "Glacier route planning", "High camps"],
        "things_to_do": [
            {"title": "Askole Staging", "description": "Last practical staging area before the Baltoro approach.", "category": "Staging"},
            {"title": "Baltoro Glacier", "description": "Glacier trek corridor for planning context only; guide and permit checks are essential.", "category": "Trek"},
            {"title": "Concordia", "description": "High mountain camp area near K2 views.", "category": "High camp"},
        ],
        "aliases": ["k2 base camp", "baltoro glacier", "concordia", "askole", "karakoram trek"],
    },
    {
        "source_id": "gb:khaplu-hushe-trek-area",
        "name": "Khaplu and Hushe Trek Area",
        "category": "trail",
        "region": "Gilgit-Baltistan",
        "admin": "Khaplu / Hushe Valley",
        "lat": 35.4519,
        "lng": 76.3582,
        "source_url": "https://visitgilgitbaltistan.gov.pk/",
        "publisher": "Government of Gilgit-Baltistan",
        "summary": "Khaplu and Hushe form a practical staging side for Masherbrum, Laila Peak, K7, and Charakusa-area trekking.",
        "best_season": "Summer trekking window; verify current route and pass conditions.",
        "access": "Stage through Khaplu and Hushe; confirm road status, permits, guide support, and weather locally.",
        "safety": "Remote valley travel can involve glacier terrain, rockfall, altitude, and limited rescue options.",
        "activities": ["Trekking", "Peak approaches", "Staging"],
        "things_to_do": [
            {"title": "Hushe Staging", "description": "Use Hushe as the route-planning base for Khaplu-side treks and climber approaches.", "category": "Staging"},
            {"title": "Laila Peak View Trek", "description": "High-alpine objective near Gondogoro; plan as guided mountain terrain, not a casual hike.", "category": "Peak view"},
            {"title": "Masherbrum Base Camp Trek", "description": "Hushe-side approach toward Masherbrum Base Camp; verify guide, permits, and conditions locally.", "category": "Trek"},
            {"title": "K7 / Charakusa Approach", "description": "Remote Charakusa-area mountain approach for experienced teams with local support.", "category": "Trek"},
        ],
        "aliases": ["khaplu treks", "hushe valley", "charakusa valley", "laila peak", "masherbrum", "mashabrum", "k7"],
        "extra_sources": [{"title": "Hushe Valley", "publisher": "Open reference", "url": "https://en.wikipedia.org/wiki/Hushe_Valley", "kind": "open_reference"}],
    },
    {
        "source_id": "gb:laila-peak-hushe",
        "name": "Laila Peak, Hushe Valley",
        "category": "peak",
        "region": "Gilgit-Baltistan",
        "admin": "Hushe / Gondogoro Glacier",
        "lat": 35.5911,
        "lng": 76.4056,
        "source_url": "https://visitgilgitbaltistan.gov.pk/",
        "publisher": "Government of Gilgit-Baltistan",
        "summary": "Spear-shaped Karakoram peak near Hushe and Gondogoro Glacier, best treated as a high-alpine planning objective.",
        "best_season": "Summer alpine window; snow, rockfall, and glacier conditions decide access.",
        "access": "Approach planning usually runs through Khaplu and Hushe; verify restricted-zone permits and guide needs locally.",
        "safety": "High-alpine terrain with rockfall, avalanche, glacier, permit, guide, insurance, and rescue considerations.",
        "activities": ["Peak views", "Alpine trekking", "Glacier context"],
        "things_to_do": [
            {"title": "Hushe Approach Check", "description": "Confirm road status, local guide support, permits, and weather before leaving Khaplu/Hushe.", "category": "Access"},
            {"title": "Gondogoro Glacier Context", "description": "Use the map card for orientation around Gondogoro and nearby high-alpine terrain.", "category": "Map context"},
        ],
        "aliases": ["laila peak", "laila peak hushe", "gondogoro glacier", "khaplu laila peak"],
        "extra_sources": [{"title": "Laila Peak, Hushe Valley", "publisher": "Open reference", "url": "https://en.wikipedia.org/wiki/Laila_Peak_(Hushe_Valley)", "kind": "open_reference"}],
    },
    {
        "source_id": "gb:masherbrum-base-camp",
        "name": "Masherbrum Base Camp Trek",
        "category": "trail",
        "region": "Gilgit-Baltistan",
        "admin": "Hushe Valley",
        "lat": 35.5609,
        "lng": 76.2997,
        "source_url": "https://visitgilgitbaltistan.gov.pk/",
        "publisher": "Government of Gilgit-Baltistan",
        "summary": "Hushe-side trek planning card for Masherbrum, also known as K1, and its base-camp approach.",
        "best_season": "Summer trekking window; confirm snow, bridge, and glacier conditions locally.",
        "access": "Stage through Khaplu and Hushe; verify route condition, local support, and overnight rules before departure.",
        "safety": "Remote mountain terrain with altitude, weather, glacier, guide, permit, and rescue constraints.",
        "activities": ["Trekking", "Base camp planning", "Mountain views"],
        "things_to_do": [
            {"title": "Hushe Trailhead", "description": "Use Hushe as the practical staging point and verify local route advice.", "category": "Staging"},
            {"title": "Base Camp Planning", "description": "Check guide support, altitude, weather, bridge status, and overnight plans before committing.", "category": "Trek"},
        ],
        "aliases": ["masherbrum", "mashabrum", "masherbrum base camp", "mashabrum trek", "k1 peak", "hushe masherbrum"],
        "extra_sources": [{"title": "Masherbrum", "publisher": "Open reference", "url": "https://en.wikipedia.org/wiki/Masherbrum", "kind": "open_reference"}],
    },
    {
        "source_id": "gb:k7-charakusa",
        "name": "K7 and Charakusa Valley",
        "category": "peak",
        "region": "Gilgit-Baltistan",
        "admin": "Hushe / Charakusa",
        "lat": 35.4642,
        "lng": 76.5767,
        "source_url": "https://visitgilgitbaltistan.gov.pk/",
        "publisher": "Government of Gilgit-Baltistan",
        "summary": "Remote Hushe-side mountain area around K7 and Charakusa, best used for orientation and guided planning.",
        "best_season": "Summer alpine window; weather and snowpack can change plans fast.",
        "access": "Approach through Khaplu and Hushe; confirm guides, permits, route status, and border-area considerations locally.",
        "safety": "Remote alpine terrain with glacier travel, rockfall, altitude, and limited rescue options.",
        "activities": ["Peak context", "Alpine trekking", "Map orientation"],
        "things_to_do": [
            {"title": "Charakusa Valley Approach", "description": "Use this as orientation only; confirm local conditions and support before route planning.", "category": "Map context"},
            {"title": "K7 View / Climber Context", "description": "K7 is a serious mountaineering objective; keep this as a planning reference, not a casual trail.", "category": "Peak context"},
        ],
        "aliases": ["k7", "k7 peak", "charakusa valley", "charkusa", "khaplu k7", "hushe k7", "mashab k7"],
        "extra_sources": [
            {"title": "K7", "publisher": "Open reference", "url": "https://fr.wikipedia.org/wiki/K7_(montagne)", "kind": "open_reference"},
            {"title": "Hushe Valley", "publisher": "Open reference", "url": "https://en.wikipedia.org/wiki/Hushe_Valley", "kind": "open_reference"},
        ],
    },
    {
        "source_id": "punjab:lal-suhanra-national-park",
        "name": "Lal Suhanra National Park",
        "category": "park",
        "region": "Punjab",
        "admin": "Bahawalpur",
        "lat": 29.3830,
        "lng": 71.9080,
        "source_url": "https://fw.punjab.gov.pk/parks",
        "publisher": "Punjab Wildlife & Parks Department",
        "summary": "Punjab desert, wetland, and wildlife park area near Bahawalpur.",
        "best_season": "Cooler months are easier for long outdoor time.",
        "access": "Confirm park hours, entry rules, road access, heat, and local guidance before visiting.",
        "safety": "Heat, water, road distance, wildlife rules, and visitor-area boundaries matter.",
        "activities": ["Wildlife viewing", "Lake stops", "Picnic areas"],
        "things_to_do": [
            {"title": "Wildlife Park Visit", "description": "Use official park guidance for visitor access and current rules.", "category": "Wildlife"},
            {"title": "Patisar Lake Area", "description": "Plan lake and birding stops around heat, water, and access rules.", "category": "Water"},
        ],
        "aliases": ["lal suhanra", "bahawalpur park", "punjab wildlife park"],
    },
    {
        "source_id": "punjab:changa-manga-forest-park",
        "name": "Changa Manga Forest Park",
        "category": "park",
        "region": "Punjab",
        "admin": "Kasur",
        "lat": 31.0850,
        "lng": 73.9690,
        "source_url": "https://fw.punjab.gov.pk/parks",
        "publisher": "Punjab Wildlife & Parks Department",
        "summary": "Punjab forest park area useful for family stops, shade, short walks, and route breaks near Lahore/Kasur.",
        "best_season": "Morning and cooler months are more comfortable.",
        "access": "Confirm visitor timing, park rules, and local road access before depending on it.",
        "safety": "Heat, crowds, opening hours, and local park rules should be checked first.",
        "activities": ["Forest park", "Picnic stops", "Short walks"],
        "things_to_do": [
            {"title": "Forest Park Stop", "description": "Plan a shade and picnic break with current park access confirmed.", "category": "Park"},
            {"title": "Short Walks", "description": "Keep walks short in heat and follow posted visitor-area rules.", "category": "Walk"},
        ],
        "aliases": ["changa manga", "changa manga forest", "kasur park", "punjab forest park"],
    },
]


def import_pakistan_gov_fixture(path: str | Path | None = None, fetched_at: int | None = None) -> tuple[list[SourceRecord], list[ExplorePlaceV3], list[TrailGeometry]]:
    assert_source_allowed("pakistan_gov")
    now = int(fetched_at or time.time())
    seeds = load_seed_payload(path) if path else PAKISTAN_GOV_SEEDS
    records: list[SourceRecord] = []
    places: list[ExplorePlaceV3] = []
    for seed in seeds:
        record = source_record_from_seed(seed, now)
        if not record:
            continue
        records.append(record)
        places.append(place_from_seed(seed, record, now))
    return records, places, []


def load_seed_payload(path: str | Path) -> list[dict[str, Any]]:
    payload = json.loads(Path(path).read_text())
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("places"), list):
        return [item for item in payload["places"] if isinstance(item, dict)]
    raise ValueError(f"unsupported Pakistan government fixture shape: {path}")


def source_record_from_seed(seed: dict[str, Any], now: int) -> SourceRecord | None:
    source_id = compact_text(seed.get("source_id"))
    name = compact_text(seed.get("name"))
    lat = as_float(seed.get("lat"))
    lng = as_float(seed.get("lng"))
    if not source_id or not name or lat is None or lng is None:
        return None
    return SourceRecord(
        id=f"pakistan_gov:{source_id}",
        source="pakistan_gov",
        source_id=source_id,
        source_url=compact_text(seed.get("source_url")),
        license="Official public portal context",
        attribution=compact_text(seed.get("publisher") or PAKISTAN_GOV_ATTRIBUTION),
        fetched_at=now,
        last_seen_at=now,
        raw=seed,
        name=name,
        category=compact_text(seed.get("category") or "park"),
        subcategory=compact_text(seed.get("admin") or ""),
        lat=lat,
        lng=lng,
        geometry={"type": "Point", "coordinates": [lng, lat]},
        properties=seed,
        confidence=0.82,
    )


def place_from_seed(seed: dict[str, Any], record: SourceRecord, now: int) -> ExplorePlaceV3:
    source_ref = {
        "source": "pakistan_gov",
        "source_id": record.source_id,
        "url": record.source_url,
        "license": record.license,
        "attribution": record.attribution,
        "quality": quality_for_source("pakistan_gov"),
    }
    activities = sorted_unique(seed.get("activities") or [])
    tags = sorted_unique([seed.get("category"), seed.get("region"), seed.get("admin"), *activities, *(seed.get("aliases") or [])])
    place = ExplorePlaceV3(
        id=f"place:pakistan_gov:{slugify(record.source_id)}",
        source_ids=[record.id],
        name=record.name,
        category=record.category,
        subcategories=sorted_unique([record.subcategory, *activities]),
        lat=record.lat,
        lng=record.lng,
        geometry=record.geometry,
        country="Pakistan",
        region=compact_text(seed.get("region")),
        admin=compact_text(seed.get("admin")),
        summary=compact_text(seed.get("summary")),
        description=compact_text(seed.get("summary")),
        tags=tags,
        search_aliases=sorted_unique([record.name, *(seed.get("aliases") or [])]),
        best_season=compact_text(seed.get("best_season")),
        access=compact_text(seed.get("access")),
        safety=compact_text(seed.get("safety")),
        amenities=activities,
        source_pack=source_pack_from_seed(seed, record),
        sources=[source_ref],
        quality=quality_for_source("pakistan_gov"),
        last_seen_at=now,
        updated_at=now,
    )
    return apply_aliases(build_card(score_place(place)))


def source_pack_from_seed(seed: dict[str, Any], record: SourceRecord) -> dict[str, Any]:
    things = []
    for item in seed.get("things_to_do") or []:
        if not isinstance(item, dict):
            continue
        things.append({
            "kind": "thing_to_do",
            "source": "pakistan_gov",
            "source_id": slugify(f"{record.source_id}-{item.get('title') or ''}"),
            "title": compact_text(item.get("title")),
            "description": compact_text(item.get("description")),
            "url": record.source_url,
            "source_label": record.attribution,
            "category": compact_text(item.get("category")),
        })
    sources = [{"title": record.name, "publisher": record.attribution, "url": record.source_url, "kind": "official"}]
    for source in seed.get("extra_sources") or []:
        if isinstance(source, dict) and source.get("url"):
            sources.append({
                "title": compact_text(source.get("title")),
                "publisher": compact_text(source.get("publisher") or "Open reference"),
                "url": compact_text(source.get("url")),
                "kind": compact_text(source.get("kind") or "open_reference"),
            })
    return {
        "quality": "official",
        "primary": record.attribution,
        "official_url": record.source_url,
        "sources": sources,
        "activities": sorted_unique(seed.get("activities") or []),
        "things_to_do": things,
        "source_note": "Verify access, permits, hours, road status, weather, and local rules before travel.",
        "extract": compact_text(seed.get("summary")),
        "license": "Public travel guidance",
    }


def as_float(value: Any) -> float | None:
    try:
        return float(value)
    except Exception:
        return None


def write_seed_fixture(path: str | Path) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"source": "pakistan_gov", "places": PAKISTAN_GOV_SEEDS}, indent=2, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Write Pakistan government Explore seed fixture.")
    parser.add_argument("--out", default="data/explore/source_cache/pakistan_gov/official_seed.json")
    args = parser.parse_args()
    write_seed_fixture(args.out)
    print(f"wrote Pakistan government seed fixture to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
