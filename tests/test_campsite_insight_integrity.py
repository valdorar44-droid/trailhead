from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from ai import planner
from dashboard import server
from dashboard.campsite_insights import (
    build_campsite_insight,
    campsite_evidence_revision,
    campsite_insight_cache_key,
    campsite_insight_cache_prefix,
    normalize_campsite_evidence,
)


def evidence(**overrides):
    values = {
        "name": "Juniper Camp",
        "lat": 38.57,
        "lng": -109.55,
        "description": (
            "Tent sites include picnic tables. Black bears may enter the campground, "
            "and the access road can be muddy after storms. Open in spring and fall."
        ),
        "land_type": "National Park Service",
        "amenities": ["Picnic tables", "Tent sites"],
        "facility_id": "ridb:123",
        "source_label": "Recreation.gov",
        "source_url": "https://www.recreation.gov/camping/campgrounds/123",
        "source_updated_at": 1_750_000_000,
        "wiki_hits": [{
            "title": "Juniper Canyon",
            "extract": "Juniper Canyon is a named canyon near the campground.",
            "url": "https://en.wikipedia.org/wiki/Juniper_Canyon",
        }],
    }
    values.update(overrides)
    return normalize_campsite_evidence(**values)


def test_revision_and_cache_key_bind_every_relevant_evidence_change():
    base = evidence()
    changed_description = evidence(description="Tent sites only. No other details are supplied.")
    changed_reference = evidence(wiki_hits=[{
        "title": "Different Canyon",
        "extract": "A different nearby reference.",
        "url": "https://en.wikipedia.org/wiki/Different_Canyon",
    }])

    assert campsite_evidence_revision(base) != campsite_evidence_revision(changed_description)
    assert campsite_evidence_revision(base) != campsite_evidence_revision(changed_reference)
    assert campsite_insight_cache_key(base) != campsite_insight_cache_key(changed_description)
    assert campsite_insight_cache_key(base).startswith(campsite_insight_cache_prefix("ridb:123"))


def test_amenity_order_does_not_create_a_new_revision():
    first = evidence(amenities=["Tent sites", "Picnic tables", "Tent sites"])
    second = evidence(amenities=["Picnic tables", "Tent sites"])
    assert campsite_evidence_revision(first) == campsite_evidence_revision(second)


def test_generated_claims_are_dropped_unless_supported_by_evidence():
    result = build_campsite_insight({
        "insider_tip": "The lakefront sites are peaceful and have reliable cell service.",
        "best_for": "Large RVs with full hookups",
        "best_season": "Summer for cool temperatures",
        "nearby_highlights": ["Secret Arch", "Juniper Canyon"],
        "hazards": "Flash floods are common.",
        "star_rating": 5,
        "coordinates_dms": "invented",
    }, evidence(), generated_at=1_760_000_000)

    assert result["insider_tip"].startswith("Review the campsite listing")
    assert result["best_for"] == ""
    assert result["best_season"] == ""
    assert result["nearby_highlights"] == ["Juniper Canyon"]
    assert result["hazards"] is None
    assert result["star_rating"] == 0
    assert result["coordinates_dms"] == '38\u00b034\'12"N 109\u00b033\'00"W'
    assert result["provenance"]["evidence_status"] == "supported"
    assert result["provenance"]["field_sources"]["insider_tip"] == ["planning_guidance"]


def test_supported_words_cannot_hide_an_unsupported_claim():
    result = build_campsite_insight({
        "insider_tip": "Tent sites include picnic tables and beautiful lakefront sunsets.",
        "best_for": "Tent campers with full hookups",
        "hazards": "Black bears may enter, but there are no floods.",
    }, evidence(), generated_at=1_760_000_000)

    assert result["insider_tip"].startswith("Review the campsite listing")
    assert result["best_for"] == ""
    assert result["hazards"] is None


def test_supported_fields_include_field_level_provenance_and_freshness():
    result = build_campsite_insight({
        "insider_tip": "Tent sites include picnic tables.",
        "best_for": "Tent camping with picnic tables",
        "best_season": "Spring and fall",
        "nearby_highlights": ["Juniper Canyon"],
        "hazards": "Black bears may enter the campground.",
    }, evidence(), generated_at=1_760_000_000)

    assert result["best_for"] == "Tent camping with picnic tables"
    assert result["best_season"] == "Spring and fall"
    assert result["hazards"] == "Black bears may enter the campground."
    assert result["provenance"]["evidence_status"] == "supported"
    assert result["provenance"]["field_sources"]["hazards"] == ["camp_listing"]
    assert result["provenance"]["sources"][0]["label"] == "Recreation.gov"
    assert result["provenance"]["sources"][0]["freshness"] == "older_source"
    assert result["provenance"]["source_revision"] == campsite_evidence_revision(evidence())


def test_missing_source_date_is_explicit_and_fallback_copy_is_honest():
    limited = evidence(
        description="",
        land_type="",
        amenities=[],
        source_updated_at=None,
        wiki_hits=[],
    )
    result = build_campsite_insight({}, limited, generated_at=1_760_000_000)

    assert result["provenance"]["evidence_status"] == "limited"
    assert result["provenance"]["sources"][0]["freshness"] == "date_unknown"
    assert "confirm current access, fees, and availability" in result["insider_tip"].casefold()
    assert "safe" not in result["insider_tip"].casefold()


def test_unsafe_source_metadata_is_not_reflected():
    normalized = evidence(
        source_label="Internal provider slug",
        source_url="https://person@example.com/private",
        source_updated_at="not-a-date",
    )
    result = build_campsite_insight({}, normalized, generated_at=1_760_000_000)
    source = result["provenance"]["sources"][0]
    assert source["label"] == "Campsite listing"
    assert source["url"] is None
    assert source["source_updated_at"] is None


def test_endpoint_validates_model_output_before_caching():
    body = server.CampsiteInsightRequest(
        name="Juniper Camp",
        lat=38.57,
        lng=-109.55,
        description="Tent sites include picnic tables.",
        amenities=["Tent sites", "Picnic tables"],
        facility_id="ridb:123",
        source_label="Recreation.gov",
        source_updated_at=1_750_000_000,
    )
    generated = {
        "insider_tip": "Every site has a lake view and reliable cell service.",
        "best_for": "Tent camping with picnic tables",
        "best_season": "Winter",
        "nearby_highlights": ["Secret Arch"],
        "hazards": "No hazards.",
        "star_rating": 5,
    }
    with (
        patch.object(server, "_planner_provider_configured", return_value=True),
        patch.object(server, "wikipedia_nearby", new=AsyncMock(return_value=[])),
        patch.object(server, "get_cached", return_value=None),
        patch.object(server, "set_cached") as cache_write,
        patch.object(planner, "generate_campsite_insight", return_value=generated),
    ):
        result = asyncio.run(server.campsite_insight(None, body, {"id": 1, "is_admin": True}))

    assert result["insider_tip"].startswith("Review the campsite listing")
    assert result["best_for"] == "Tent camping with picnic tables"
    assert result["best_season"] == ""
    assert result["hazards"] is None
    assert result["star_rating"] == 0
    assert result["provenance"]["source_revision"]
    assert cache_write.call_args.args[0] == "campsite_cache"
    assert cache_write.call_args.args[1].startswith("ai_insight_v2:facility:ridb-123:")
    assert cache_write.call_args.args[2] == result


def test_endpoint_returns_only_revision_bound_cache_entry():
    body = server.CampsiteInsightRequest(name="Juniper Camp", lat=38.57, lng=-109.55)
    cached = {"insider_tip": "Cached validated note", "provenance": {"source_revision": "abc"}}
    with (
        patch.object(server, "_planner_provider_configured", return_value=True),
        patch.object(server, "wikipedia_nearby", new=AsyncMock(return_value=[])),
        patch.object(server, "get_cached", return_value=cached) as cache_read,
        patch.object(planner, "generate_campsite_insight") as generate,
    ):
        result = asyncio.run(server.campsite_insight(None, body, {"id": 1, "is_admin": True}))

    assert result == cached
    assert cache_read.call_args.args[0] == "campsite_cache"
    assert cache_read.call_args.args[1].startswith("ai_insight_v2:coord:38.570:-109.550:")
    generate.assert_not_called()
