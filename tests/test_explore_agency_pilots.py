from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.build_explore_agency_pilots import DatasetSpec, RequestBudget, audit_candidate
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
