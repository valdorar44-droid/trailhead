from __future__ import annotations

from dashboard import server
from scripts.data.build_canonical_serving_indexes import dedupe_explore_records


def _source(name: str, source_id: str, url: str, license_text: str) -> dict:
    return {
        "source": name,
        "source_id": source_id,
        "url": url,
        "attribution": "USDA Forest Service" if name == "usfs" else "Recreation.gov",
        "license": license_text,
        "quality": "official_source",
        "checked_at": 1785539000,
    }


def test_cross_source_dedupe_preserves_photo_reservations_and_provenance():
    usfs = {
        "id": "place:usfs:camp-1",
        "title": "Forks Campground",
        "category": "campground",
        "group": "camping",
        "lat": 37.2,
        "lng": -119.2,
        "description": "Forks Campground has forested sites beside the creek and direct access to the lake.",
        "image_url": "",
        "media_kind": "map_preview",
        "source_url": "https://www.fs.usda.gov/",
        "planning_facts": [{"key": "access", "label": "Access", "value": "Open"}],
        "provenance": {"primary": _source("usfs", "camp-1", "https://www.fs.usda.gov/", "USFS public data"), "sources": []},
        "checked_at": 1785539000,
        "enrichment_score": 88,
        "enrichment_grade": "complete",
        "reviewable": True,
        "verified": True,
    }
    ridb = {
        "id": "place:ridb:camp-1",
        "title": "Forks Campground",
        "category": "campground",
        "group": "camping",
        "lat": 37.2,
        "lng": -119.2,
        "description": "Forks Campground has forested campsites beside the creek.",
        "image_url": "https://cdn.recreation.gov/forks.webp",
        "image_credit": "Recreation.gov",
        "image_license": "RIDB public API terms",
        "image_source_url": "https://www.recreation.gov/camping/campgrounds/camp-1",
        "media_kind": "photo",
        "source_url": "https://www.recreation.gov/camping/campgrounds/camp-1",
        "planning_facts": [{"key": "reservations", "label": "Reservations", "value": "Available"}],
        "provenance": {"primary": _source("ridb", "camp-1", "https://www.recreation.gov/camping/campgrounds/camp-1", "RIDB public API terms"), "sources": []},
        "checked_at": 1785538000,
        "enrichment_score": 87,
        "enrichment_grade": "complete",
        "reviewable": True,
        "verified": True,
    }

    merged = dedupe_explore_records([ridb, usfs])

    assert len(merged) == 1
    item = merged[0]
    assert item["id"] == "place:usfs:camp-1"
    assert item["image_url"] == "https://cdn.recreation.gov/forks.webp"
    assert item["image_credit"] == "Recreation.gov"
    assert {fact["key"] for fact in item["planning_facts"]} == {"access", "reservations"}
    assert {source["source"] for source in item["provenance"]["sources"]} == {"usfs", "ridb"}

    profile = server._promoted_explore_item_to_profile(item, 1)
    assert profile is not None
    assert profile["summary"]["image_credit"] == "Recreation.gov"
    assert profile["source_pack"]["photos"][0]["license"] == "RIDB public API terms"
    assert {source["title"] for source in profile["sources"]} == {"USDA Forest Service", "Recreation.gov"}
