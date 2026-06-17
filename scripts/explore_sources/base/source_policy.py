from __future__ import annotations


PERMITTED_PRODUCTION_SOURCES = {
    "osm",
    "geofabrik",
    "overpass",
    "ridb",
    "recreation.gov",
    "nps",
    "usfs",
    "blm",
    "openbeta",
    "wikidata",
    "wikipedia",
    "natural_earth",
    "trailhead_curated",
    "trailhead_user",
}

PROHIBITED_SYSTEMATIC_SOURCES = {
    "alltrails",
    "hipcamp",
    "glampinghub",
    "mountain_project",
    "ioverlander",
    "wikicamps",
    "public_osm_tiles",
    "public_nominatim",
}


def assert_source_allowed(source: str) -> None:
    key = (source or "").strip().lower()
    if key in PROHIBITED_SYSTEMATIC_SOURCES:
        raise ValueError(f"source is not permitted for systematic import: {source}")
    if key not in PERMITTED_PRODUCTION_SOURCES:
        raise ValueError(f"unknown source policy for: {source}")

