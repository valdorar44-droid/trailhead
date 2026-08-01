from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.data.build_canonical_serving_indexes import build_explore_index
from scripts.build_explore_agency_pilots import (
    DatasetSpec,
    RequestBudget,
    audit_candidate,
    build_destination_hub,
    is_technical_route_name,
    merge_colocated_agency_amenities,
    source_item,
)
from scripts.explore_sources.base.content_quality import sanitize_source_pack_item
from scripts.explore_sources.base.enrichment import enrich_place_dict
from scripts.explore_sources.base.schema import ExplorePlaceV3
from scripts.explore_sources.blm.import_blm import import_blm_fixture
from scripts.explore_sources.usfs.import_usfs import import_usfs_fixture
from scripts.explore_sources.base.normalize import representative_point


def write_feature_collection(tmp_path: Path, name: str, features: list[dict]) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    return path


def test_usfs_live_fields_are_case_insensitive_and_do_not_guess_hiking(tmp_path: Path):
    path = write_feature_collection(tmp_path, "usfs.geojson", [{
        "type": "Feature",
        "properties": {
            "objectid": 10,
            "trail_cn": "abc",
            "trail_name": "Granite Route",
            "trail_type": "TERRA",
            "gis_miles": 4.2,
            "trail_surface": "NATIVE MATERIAL",
            "hiker_pedestrian_accpt_disc": "01/01-12/31",
            "fourwd_managed": "06/01-10/31",
            "_trailhead_dataset_id": "usfs_sierra_trails",
            "_trailhead_source_url": "https://example.gov/usfs/trails",
            "_trailhead_destination_name": "Sierra National Forest",
            "_trailhead_feature_kind": "trail",
        },
        "geometry": {"type": "LineString", "coordinates": [[-119.4, 37.2], [-119.3, 37.3]]},
    }])

    records, places, trails = import_usfs_fixture(path, fetched_at=123)

    assert len(records) == len(places) == len(trails) == 1
    assert trails[0].name == "Granite Route"
    assert trails[0].distance_mi == 4.2
    assert trails[0].surface == "NATIVE MATERIAL"
    assert "4x4" in trails[0].activities
    assert "hiking" not in trails[0].activities
    assert places[0].summary == ""
    assert places[0].description == ""
    assert places[0].card["summary"] == ""
    assert records[0].source_url == "https://example.gov/usfs/trails"


def test_usfs_site_fields_preserve_source_facts_only(tmp_path: Path):
    path = write_feature_collection(tmp_path, "usfs-site.geojson", [{
        "type": "Feature",
        "properties": {
            "site_cn": "site-1",
            "public_site_name": "Trail End",
            "site_type": "TRAILHEAD",
            "recarea_description": "Access for the north ridge trail.",
            "water_availability": "No",
            "restroom_availability": "Yes",
            "fee_charged": "N",
            "latitude": 37.1,
            "longitude": -119.1,
            "_trailhead_dataset_id": "usfs_sierra_sites",
            "_trailhead_source_url": "https://example.gov/usfs/sites",
        },
        "geometry": {"type": "Point", "coordinates": [-119.1, 37.1]},
    }])

    _records, places, _trails = import_usfs_fixture(path, fetched_at=123)

    assert places[0].category == "trailhead"
    assert places[0].summary == "Access for the north ridge trail."
    assert "toilets" in places[0].amenities
    assert "water" not in places[0].amenities
    assert "fee" not in places[0].amenities


def test_usfs_camp_operational_facts_survive_without_inventing_site_count(tmp_path: Path):
    path = write_feature_collection(tmp_path, "usfs-camp-operations.geojson", [{
        "type": "Feature",
        "properties": {
            "site_cn": "camp-operations-1",
            "public_site_name": "Rancheria Campground",
            "site_type": "CAMPGROUND",
            "total_capacity": 765,
            "fee_charged": "Y",
            "fee_description": "Single site: $47 per night",
            "operational_hours": "June - October",
            "open_season": "June",
            "water_availability": "Yes, drinking water is available from a hand pump",
            "restroom_availability": "Flush toilet(s)",
            "rec1stop_url": "https://www.recreation.gov/camping/campgrounds/232815",
            "usda_portal_url": "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45434",
            "information_center": "Recreation.gov or 1-877-444-6777 for reservations.",
        },
        "geometry": {"type": "Point", "coordinates": [-119.1606, 37.2537]},
    }])

    _records, places, _trails = import_usfs_fixture(path, fetched_at=123)
    raw = places[0].to_dict()
    pack = raw["source_pack"]

    assert pack == {
        "site_type": "Campground",
        "people_capacity": 765,
        "fees": ["Single site: $47 per night"],
        "operating_season": ["June - October"],
        "water": "Yes, drinking water is available from a hand pump",
        "restrooms": "Flush toilet(s)",
        "official_url": "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45434",
        "booking_url": "https://www.recreation.gov/camping/campgrounds/232815",
        "phone": "1-877-444-6777",
    }
    assert raw["reservations"] == {
        "url": "https://www.recreation.gov/camping/campgrounds/232815",
        "reservation_url": "https://www.recreation.gov/camping/campgrounds/232815",
        "reservable": True,
    }
    assert "campsites_count" not in raw
    assert "site_count" not in raw["source_pack"]

    enriched = enrich_place_dict(raw)
    facts = {fact["key"]: fact["value"] for fact in enriched["planning_facts"]}
    assert facts["site_type"] == "Campground"
    assert facts["people_capacity"] == "765 people"
    assert facts["water"] == "Yes, drinking water is available from a hand pump"
    assert facts["restrooms"] == "Flush toilet(s)"
    assert facts["phone"] == "1-877-444-6777"
    assert facts["fees"] == "Single site: $47 per night"
    assert facts["operating_season"] == "June - October"
    assert "season" not in facts
    assert "operating_hours" not in facts
    reservation_fact = next(fact for fact in enriched["planning_facts"] if fact["key"] == "reservations")
    assert reservation_fact["url"] == "https://www.recreation.gov/camping/campgrounds/232815"


def test_usfs_official_page_without_recreation_url_is_not_reservable(tmp_path: Path):
    path = write_feature_collection(tmp_path, "usfs-no-booking.geojson", [{
        "type": "Feature",
        "properties": {
            "site_cn": "camp-no-booking",
            "public_site_name": "Forest Camp",
            "site_type": "CAMPGROUND",
            "usda_portal_url": "https://www.fs.usda.gov/recarea/example",
        },
        "geometry": {"type": "Point", "coordinates": [-119.1, 37.1]},
    }])

    _records, places, _trails = import_usfs_fixture(path, fetched_at=123)

    assert places[0].reservations == {}
    assert places[0].source_pack["official_url"] == "https://www.fs.usda.gov/recarea/example"
    assert "booking_url" not in places[0].source_pack


def test_usfs_reader_copy_and_status_hide_source_formatting_codes(tmp_path: Path):
    path = write_feature_collection(tmp_path, "usfs-reader-copy.geojson", [{
        "type": "Feature",
        "properties": {
            "site_cn": "camp-1",
            "public_site_name": "River Campground",
            "site_type": "CAMPGROUND",
            "recarea_description": "At approximately1,000 feet, the river 's edge has a50 person group site.",
            "region": "05",
            "forest_name": "Sierra National Forest",
            "access_status": "OPEN",
            "restrictions": "Maximum stay is 14 daysAll campsites are walk-in",
        },
        "geometry": {"type": "Point", "coordinates": [-119.1, 37.1]},
    }])

    _records, places, _trails = import_usfs_fixture(path, fetched_at=123)

    place = places[0]
    assert place.region == ""
    assert place.admin == "Sierra National Forest"
    assert place.access == "Open"
    assert place.summary == "At approximately 1,000 feet, the river's edge has a 50 person group site."
    assert place.safety == ""
    assert place.source_pack["rules"] == "Maximum stay is 14 days. All campsites are walk-in"
    assert place.card["quick_facts"] == ["Campground", "Open"]


@pytest.mark.parametrize(("site_type", "category", "subcategory"), [
    ("INFO SITE/FEE STATION", "visitor_center", "visitor_center"),
    ("OBSERVATION SITE", "viewpoint", "overlook"),
    ("INTERPRETIVE SITE", "historic_site", "interpretive_site"),
    ("PICNIC SITE", "place", "picnic_site"),
    ("BOATING SITE", "place", "boat_access"),
    ("OHV STAGING AREA", "trailhead", "trailhead"),
])
def test_usfs_official_site_types_map_to_supported_modules(tmp_path: Path, site_type: str, category: str, subcategory: str):
    path = write_feature_collection(tmp_path, "usfs-type.geojson", [{
        "type": "Feature",
        "properties": {"objectid": 1, "site_name": "Official site", "site_type": site_type},
        "geometry": {"type": "Point", "coordinates": [-119.1, 37.1]},
    }])
    _records, places, _trails = import_usfs_fixture(path, fetched_at=123)
    assert places[0].category == category
    assert places[0].subcategories == [subcategory]


def test_blm_live_route_fields_keep_only_supported_uses(tmp_path: Path):
    path = write_feature_collection(tmp_path, "blm.geojson", [{
        "type": "Feature",
        "properties": {
            "OBJECTID": 99,
            "ROUTE_PRMRY_NM": "Peters",
            "PLAN_ASSET_CLASS": "Transportation System - Trail",
            "OBSRVE_SRFCE_TYPE": "Natural Improved",
            "OBSRVE_ROUTE_USE_CLASS": "Unknown",
            "OHV_ROUTE_DSGNTN_LIM": "Limited by Type of Vehicle",
            "PLAN_ACCESS_RSTRCT": "None",
            "GIS_MILES": 2.8,
            "_trailhead_dataset_id": "blm_moab_managed_trails",
            "_trailhead_source_url": "https://example.gov/blm/trails",
            "_trailhead_feature_kind": "managed public trail",
        },
        "geometry": {"type": "LineString", "coordinates": [[-109.6, 38.5], [-109.5, 38.6]]},
    }])

    records, places, trails = import_blm_fixture(path, fetched_at=123)

    assert len(records) == len(places) == len(trails) == 1
    assert trails[0].name == "Peters"
    assert trails[0].surface == "Natural Improved"
    assert trails[0].access == ""
    assert trails[0].activities == ["OHV"]
    assert "hiking" not in trails[0].activities
    assert places[0].summary == ""


def test_blm_live_recreation_subtypes_map_to_real_pois(tmp_path: Path):
    path = write_feature_collection(tmp_path, "blm-site.geojson", [{
        "type": "Feature",
        "properties": {
            "OBJECTID": 7,
            "FET_NAME": "River Lot",
            "FET_SUBTYPE": "Parking Area",
            "ADMIN_ST": "UT",
            "LAT": 38.5,
            "LONG": -109.5,
            "_trailhead_dataset_id": "blm_moab_sites_point",
            "_trailhead_source_url": "https://example.gov/blm/sites",
        },
        "geometry": {"type": "Point", "coordinates": [-109.5, 38.5]},
    }])

    _records, places, _trails = import_blm_fixture(path, fetched_at=123)

    assert places[0].category == "place"
    assert places[0].subcategories == ["parking"]
    assert places[0].region == "UT"


@pytest.mark.parametrize(("subtype", "category", "subcategory"), [
    ("Trail Head", "trailhead", "trailhead"),
    ("Access Point", "place", "access_point"),
    ("Campsite - Primitive - Non Reservable - No Fee", "dispersed_camp", "dispersed_camp"),
])
def test_blm_official_subtypes_keep_distinct_capabilities(tmp_path: Path, subtype: str, category: str, subcategory: str):
    path = write_feature_collection(tmp_path, "blm-type.geojson", [{
        "type": "Feature",
        "properties": {"OBJECTID": 1, "FET_NAME": "Official site", "FET_SUBTYPE": subtype},
        "geometry": {"type": "Point", "coordinates": [-109.5, 38.5]},
    }])
    _records, places, _trails = import_blm_fixture(path, fetched_at=123)
    assert places[0].category == category
    assert places[0].subcategories == [subcategory]


def test_agency_audit_blocks_filler_but_allows_unknown_activity():
    spec = DatasetSpec("sample", "usfs", "https://example.gov/layer", "1=1", "sample", "Sample", "trail", 1)
    records = [{
        "id": "usfs:sample:1",
        "name": "Granite Route",
        "source_url": "https://example.gov/layer",
        "license": "USFS official data",
        "lat": 1.0,
        "lng": 1.0,
        "properties": {"_trailhead_dataset_id": "sample"},
    }]
    trails = [{"id": "trail:1", "name": "Granite Route", "activities": []}]
    clean_places = [{"id": "place:1", "name": "Granite Route", "lat": 1.0, "lng": 1.0, "category": "trail", "card": {}}]

    clean = audit_candidate((spec,), {"sample": 1}, records, clean_places, trails)
    assert clean["promotion_ready"] is True
    assert clean["warnings"][0]["code"] == "activity_not_listed"

    filler_places = [{**clean_places[0], "summary": "Verify access and check local rules."}]
    blocked = audit_candidate((spec,), {"sample": 1}, records, filler_places, trails)
    assert blocked["promotion_ready"] is False
    assert blocked["errors"][0]["code"] == "unsupported_or_filler_copy"


def test_request_budget_cannot_be_weakened_beyond_source_limit():
    with pytest.raises(ValueError):
        RequestBudget(61)


def test_multi_polygon_has_a_stable_representative_point():
    lat, lng = representative_point({
        "type": "MultiPolygon",
        "coordinates": [[[[-120.0, 37.0], [-119.0, 37.0], [-119.0, 38.0], [-120.0, 37.0]]]],
    })
    assert lat is not None
    assert lng is not None


def test_colocated_agency_amenity_is_attached_to_the_named_place():
    scenic = ExplorePlaceV3(
        id="view",
        source_ids=["view-source"],
        name="Lone Mesa Viewpoint",
        category="viewpoint",
        lat=38.6,
        lng=-109.7,
        sources=[{"source": "blm", "source_id": "view-source"}],
    )
    restroom = ExplorePlaceV3(
        id="restroom",
        source_ids=["restroom-source"],
        name="Lone Mesa Viewpoint",
        category="place",
        subcategories=["restroom"],
        lat=38.6,
        lng=-109.7,
        sources=[{"source": "blm", "source_id": "restroom-source"}],
    )
    merged = merge_colocated_agency_amenities([scenic, restroom])
    assert [item.id for item in merged] == ["view"]
    assert merged[0].amenities == ["toilets"]
    assert merged[0].source_ids == ["view-source", "restroom-source"]


def test_official_named_cutoff_is_not_treated_as_a_raw_route_number():
    assert is_technical_route_name("45 CUT OFF T5") is False
    assert is_technical_route_name("21E242") is True
    assert is_technical_route_name("Forest Road 5S30") is True


def test_sparse_agency_child_keeps_source_identity_without_generated_summary():
    item = source_item({
        "id": "place:usfs:trailhead-1",
        "name": "Granite Trailhead",
        "category": "trailhead",
        "subcategories": ["trailhead"],
        "lat": 37.1,
        "lng": -119.1,
        "summary": "",
        "sources": [{
            "source": "usfs",
            "url": "https://www.fs.usda.gov/",
            "attribution": "USDA Forest Service",
        }],
    })
    clean = sanitize_source_pack_item(item, parent={
        "name": "Sierra National Forest",
        "category": "forest",
        "lat": 37.2,
        "lng": -119.2,
    })

    assert clean["source_id"] == "place:usfs:trailhead-1"
    assert clean["title"] == "Granite Trailhead"
    assert "description" not in clean


def test_destination_hub_uses_official_copy_and_source_backed_modules():
    places = [{
        "id": "place:blm:camp-1",
        "name": "Canyon Camp",
        "category": "campground",
        "subcategories": ["developed_campground"],
        "lat": 38.5,
        "lng": -109.5,
        "summary": "Officially listed campground in the Moab Field Office.",
        "sources": [{
            "source": "blm",
            "url": "https://www.blm.gov/visit/canyon-camp",
            "attribution": "Bureau of Land Management",
        }],
    }]
    trails = [{
        "id": "trail-system:blm:1",
        "name": "Canyon Trail",
        "center": {"lat": 38.55, "lng": -109.55},
        "sources": [{"label": "Bureau of Land Management"}],
    }]

    hub = build_destination_hub("moab-blm", places, trails, 1785500000)

    assert hub["reviewable"] is True
    assert hub["summary"].startswith("The BLM Moab Field Office manages 1.8 million acres")
    assert hub["source_pack"]["campgrounds"][0]["title"] == "Canyon Camp"
    assert hub["source_pack"]["trails"][0]["source_id"] == "trail-system:blm:1"
    assert "verify" not in json.dumps(hub).lower()


def test_sierra_destination_copy_survives_public_copy_cleanup(tmp_path: Path):
    hub = build_destination_hub("sierra-national-forest", [{
        "id": "place:usfs:test-site",
        "name": "Test Site",
        "category": "visitor_center",
        "lat": 37.2,
        "lng": -119.2,
        "sources": [{"source": "usfs", "attribution": "USDA Forest Service"}],
    }], [], 1785500000)
    catalog = tmp_path / "sierra.json"
    catalog.write_text(json.dumps({"schema_version": 3, "places": [hub]}))
    serving = build_explore_index(catalog, minimum_reviewable=1, enforce_enrichment_gate=True)["items"]

    assert serving[0]["description"].startswith("Sierra National Forest supports camping")
    assert "motorized routes" in serving[0]["description"]
