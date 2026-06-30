from __future__ import annotations

from dashboard.provider_registry import source_quality_summary
from .schema import ExplorePlaceV3


QUALITY_SCORES = {
    "needs_verification": 10,
    "basic_map_data": 30,
    "open_community_data": 45,
    "ai_enriched": 50,
    "curated_trailhead": 70,
    "official_source": 85,
    "community_verified": 90,
}


OFFICIAL_SOURCES = {"ridb", "recreation.gov", "nps", "usfs", "blm", "usgs", "nws", "airnow", "firms", "pakistan_gov"}


def quality_for_source(source: str) -> str:
    key = (source or "").lower()
    if key in OFFICIAL_SOURCES:
        return "official_source"
    if key in {"trailhead_curated"}:
        return "curated_trailhead"
    if key in {"osm", "geofabrik", "overpass", "openbeta", "wikidata", "wikipedia", "natural_earth"}:
        return "open_community_data"
    return "basic_map_data"


def score_place(place: ExplorePlaceV3) -> ExplorePlaceV3:
    labels = [quality_for_source(str(src.get("source") or "")) for src in place.sources]
    if place.quality in QUALITY_SCORES:
        labels.append(place.quality)
    best = max(labels or ["basic_map_data"], key=lambda label: QUALITY_SCORES.get(label, 0))
    summary = source_quality_summary(
        place.sources,
        fetched_at=place.updated_at or None,
        last_seen_at=place.last_seen_at or None,
        inferred=best == "ai_enriched",
        unknown_access=not bool(place.access),
    )
    place.source_quality = summary
    place.quality = best
    place.quality_score = float(max(QUALITY_SCORES.get(best, 0), summary["score"]))
    place.verified = best in {"official_source", "community_verified", "curated_trailhead"} or summary["score"] >= 80
    return place
