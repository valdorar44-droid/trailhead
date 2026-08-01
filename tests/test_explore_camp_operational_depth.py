from __future__ import annotations

from unittest.mock import patch

from dashboard import server
from scripts.explore_sources.base.enrichment import build_planning_facts


def test_planning_facts_accept_legacy_reservation_url_key():
    facts = build_planning_facts({
        "name": "Forest Camp",
        "category": "campground",
        "reservations": {
            "reservation_url": "https://www.recreation.gov/camping/campgrounds/123",
        },
    }, checked_at=123)

    reservation = next(fact for fact in facts if fact["key"] == "reservations")
    assert reservation["value"] == "Booking link"
    assert reservation["url"] == "https://www.recreation.gov/camping/campgrounds/123"


def test_catalog_camp_detail_maps_operations_without_fake_campsite_count():
    place = {
        "id": "place:usfs:camp-operations",
        "name": "Rancheria Campground",
        "category": "campground",
        "summary": {
            "title": "Rancheria Campground",
            "category": "Campground",
            "lat": 37.2537,
            "lng": -119.1606,
            "tags": ["campground", "usfs"],
        },
        "profile": {"summary": "A Forest Service campground beside Huntington Lake."},
        "best_season": "June",
        "amenities": ["water", "toilets", "fee"],
        "reservations": {
            "reservation_url": "https://www.recreation.gov/camping/campgrounds/232815",
            "reservable": True,
        },
        "source_pack": {
            "site_type": "Campground",
            "people_capacity": 765,
            "fees": ["Single site: $47 per night"],
            "operating_hours": ["June - October", "June"],
            "operating_season": ["June"],
            "water": "Yes, drinking water is available from a hand pump",
            "restrooms": "Flush toilet(s)",
            "official_url": "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45434",
            "booking_url": "https://www.recreation.gov/camping/campgrounds/232815",
            "phone": "1-877-444-6777",
        },
        "sources": [{
            "source": "usfs",
            "source_id": "camp-operations",
            "url": "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45434",
            "attribution": "USDA Forest Service",
        }],
        "planning_facts": [
            {"key": "site_type", "value": "Campground"},
            {"key": "people_capacity", "value": "765 people"},
            {"key": "fees", "value": "Single site: $47 per night"},
            {"key": "operating_season", "value": "June"},
            {"key": "operating_hours", "value": "June - October"},
            {"key": "water", "value": "Yes, drinking water is available from a hand pump"},
            {"key": "restrooms", "value": "Flush toilet(s)"},
            {"key": "phone", "value": "1-877-444-6777"},
        ],
    }

    with patch.object(server, "_load_explore_catalog", return_value={"places": [place]}):
        detail = server._explore_catalog_camp_detail("place:usfs:camp-operations")

    assert detail is not None
    assert detail["site_types"] == ["Campground"]
    assert detail["campsites_count"] == 0
    assert detail["cost"] == "Single site: $47 per night"
    assert "price_summary" not in detail
    assert detail["best_season"] == "June"
    assert detail["phone"] == "1-877-444-6777"
    assert detail["official_url"] == "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45434"
    assert detail["booking_url"] == "https://www.recreation.gov/camping/campgrounds/232815"
    assert "provider_notices" not in detail


def test_catalog_camp_detail_rejects_generic_booking_urls():
    place = {
        "id": "place:usfs:no-booking",
        "name": "Forest Campground",
        "category": "campground",
        "summary": {"title": "Forest Campground", "category": "Campground"},
        "source_pack": {
            "official_url": "https://www.fs.usda.gov/recarea/example",
            "booking_url": "https://www.fs.usda.gov/recarea/example",
        },
        "sources": [{
            "source": "usfs",
            "source_id": "no-booking",
            "url": "https://www.fs.usda.gov/recarea/example",
            "attribution": "USDA Forest Service",
        }],
    }

    with patch.object(server, "_load_explore_catalog", return_value={"places": [place]}):
        detail = server._explore_catalog_camp_detail("place:usfs:no-booking")

    assert detail is not None
    assert detail["reservable"] is False
    assert detail["booking_url"] == ""
