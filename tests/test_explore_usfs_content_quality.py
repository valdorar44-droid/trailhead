from __future__ import annotations

import json
from pathlib import Path

from scripts.explore_sources.base.content_quality import (
    category_key,
    is_weak_description,
    sanitize_place_profile,
)
from scripts.explore_sources.base.dedupe import dedupe_places
from scripts.explore_sources.usfs.import_usfs import import_usfs_fixture


def write_feature_collection(tmp_path: Path, features: list[dict]) -> Path:
    path = tmp_path / "usfs-content-quality.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    return path


def point_feature(*, site_cn: str, name: str, site_type: str, description: str = "", **props: str) -> dict:
    properties = {
        "site_cn": site_cn,
        "public_site_name": name,
        "site_type": site_type,
        "recarea_description": description,
        **props,
    }
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": {"type": "Point", "coordinates": [-118.97429831545024, 37.27620367516334]},
    }


def test_explicit_usfs_site_type_precedes_incidental_name_tokens(tmp_path: Path):
    path = write_feature_collection(tmp_path, [
        point_feature(
            site_cn="central-camp-springs",
            name="Central Camp Springs",
            site_type="SPECIALIZED SPORT SITE",
            description="CENTRAL CAMP SPRINGS (Specialized Sport Site)",
        ),
        point_feature(
            site_cn="bass-lake-office",
            name="Bass Lake Recreation Office Info Site",
            site_type="INFO SITE/FEE STATION",
            description="Bass Lake Recreation Office Info Site/fee Station",
        ),
    ])

    _records, places, _trails = import_usfs_fixture(path, fetched_at=123)
    by_name = {place.name: place for place in places}

    assert by_name["Central Camp Springs"].category == "activity"
    assert by_name["Central Camp Springs"].subcategories == ["recreation_activity"]
    assert by_name["Bass Lake Recreation Office Info Site"].category == "visitor_center"
    assert by_name["Bass Lake Recreation Office Info Site"].subcategories == ["visitor_center"]


def test_canonical_category_precedes_title_hints_without_inventing_reader_copy():
    assert category_key("activity", title="Central Camp Springs") == "activity"
    assert category_key("visitor_center", title="Bass Lake Recreation Office Info Site") == "visitor_center"

    clean = sanitize_place_profile({
        "name": "Bass Lake Recreation Office Info Site",
        "category": "visitor_center",
        "admin": "Sierra National Forest",
        "description": "Bass Lake Recreation Office Info Site/fee Station",
        "card": {"summary": "Bass Lake Recreation Office Info Site/fee Station"},
    })

    assert clean["card"]["summary"] == ""
    assert "water stop" not in clean["card"]["summary"]


def test_concrete_operational_copy_survives_without_relaxing_generic_rejection():
    lake_edison = "This is a launching site for non-motorized boats on Lake Edison."
    florence_lake = "This site offers a boat ramp for launching non-motorized boats on Florence Lake."
    fisher_towers = "Parking and Trailhead for Fisher Towers Hiking Trail."

    assert not is_weak_description(lake_edison, title="Lake Edison Boating Site", category="place")
    assert not is_weak_description(florence_lake, title="Florence Lake Boating Site", category="place")
    assert not is_weak_description(fisher_towers, title="Fisher Towers Hiking Trail", category="trailhead")
    assert is_weak_description(
        "Tourist attraction in Madera County, California.",
        title="Shadow Of The Giants North Trailhead",
        category="trailhead",
    )
    assert is_weak_description("Lake in California.", title="Example Lake", category="lake")


def test_open_status_suppresses_conflicting_closed_hours(tmp_path: Path):
    path = write_feature_collection(tmp_path, [
        point_feature(
            site_cn="shadow-trailhead",
            name="Shadow Of The Giants North Trailhead",
            site_type="TRAILHEAD",
            description="Tourist attraction in Madera County, California.",
            seasonal_operational_status="OPEN",
            operational_hours="Closed",
        ),
    ])

    _records, places, _trails = import_usfs_fixture(path, fetched_at=123)

    assert places[0].access == "Open"
    assert "operating_hours" not in places[0].source_pack


def test_distinct_colocated_usfs_facilities_are_not_deduplicated(tmp_path: Path):
    path = write_feature_collection(tmp_path, [
        point_feature(
            site_cn="florence-boat",
            name="Florence Lake Boating Site",
            site_type="BOATING SITE",
            description="This site offers a boat ramp for launching non-motorized boats on Florence Lake.",
            usda_portal_url="https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45588",
        ),
        point_feature(
            site_cn="florence-picnic",
            name="Florence Lake Picnic Site",
            site_type="PICNIC SITE",
            description="Florence Lake Picnic Area offers seven picnic sites with tables and grills.",
            usda_portal_url="https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45650",
        ),
    ])

    _records, places, _trails = import_usfs_fixture(path, fetched_at=123)
    retained = dedupe_places(places)

    assert len(retained) == 2
    assert {place.subcategories[0] for place in retained} == {"boat_access", "picnic_site"}
    assert {place.source_pack["official_url"] for place in retained} == {
        "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45588",
        "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45650",
    }
