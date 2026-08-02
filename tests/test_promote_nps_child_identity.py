import json
from pathlib import Path

from scripts import promote_nps_child_explore_places as promote


DESCRIPTION = (
    "Official campground information with access details, operating context, "
    "and current visitor guidance from the National Park Service."
)


def _park(code: str, name: str) -> dict:
    return {
        "parkCode": code,
        "fullName": name,
        "states": "CA",
        "url": f"https://www.nps.gov/{code}/index.htm",
    }


def _camp(item_id: str, title: str, lat: float, lng: float) -> dict:
    return {
        "id": item_id,
        "name": title,
        "description": DESCRIPTION,
        "latitude": str(lat),
        "longitude": str(lng),
        "url": f"https://www.nps.gov/places/{item_id}.htm",
    }


def _fixture(
    path: Path,
    park_code: str,
    park_name: str,
    endpoint: str,
    items: list[dict],
) -> Path:
    path.write_text(
        json.dumps(
            {
                "data": [_park(park_code, park_name)],
                "related": {park_code: {endpoint: items}},
            }
        )
    )
    return path


def test_child_identity_is_stable_when_nps_title_changes() -> None:
    park = _park("seki", "Sequoia & Kings Canyon National Parks")
    original = promote.place_from_child(
        park,
        "campgrounds",
        _camp("ABC-123", "Sunset Campground", 36.0, -118.0),
        123,
    )
    renamed = promote.place_from_child(
        park,
        "campgrounds",
        _camp("ABC-123", "Sunset Campground at Grant Grove", 36.0, -118.0),
        123,
    )

    assert original is not None
    assert renamed is not None
    assert original["id"] == renamed["id"] == "place:nps-child:seki:campgrounds:abc-123"
    assert original["source_ids"] == ["nps:item:abc-123"]
    assert original["source_pack"]["nps_item_id"] == "ABC-123"
    assert original["source_pack"]["nps_endpoint"] == "campgrounds"
    assert original["sources"][0]["source_id"] == "ABC-123"


def test_same_title_survives_in_different_parent_parks(tmp_path: Path) -> None:
    seki = _fixture(
        tmp_path / "seki.json",
        "seki",
        "Sequoia & Kings Canyon National Parks",
        "campgrounds",
        [_camp("seki-sunset", "Sunset Campground", 36.1, -118.1)],
    )
    bryce = _fixture(
        tmp_path / "brca.json",
        "brca",
        "Bryce Canyon National Park",
        "campgrounds",
        [_camp("brca-sunset", "Sunset Campground", 37.6, -112.2)],
    )
    existing_ids: set[str] = set()
    # Retain the legacy raw-title value to prove callers do not need to migrate
    # their two-set contract before using park-scoped title dedupe.
    existing_titles = {promote.title_key("Sunset Campground")}

    seki_places = promote.promote_from_fixture(seki, existing_ids, existing_titles, 123, 36)
    bryce_places = promote.promote_from_fixture(bryce, existing_ids, existing_titles, 123, 36)

    assert [place["parent_hub_id"] for place in [*seki_places, *bryce_places]] == [
        "place:nps:seki",
        "place:nps:brca",
    ]
    assert len({place["id"] for place in [*seki_places, *bryce_places]}) == 2


def test_same_title_dedupes_within_parent_park_and_endpoint(tmp_path: Path) -> None:
    fixture = _fixture(
        tmp_path / "seki.json",
        "seki",
        "Sequoia & Kings Canyon National Parks",
        "campgrounds",
        [
            _camp("sunset-one", "Sunset Campground", 36.1, -118.1),
            _camp("sunset-two", "Sunset Campground", 36.2, -118.2),
        ],
    )

    promoted = promote.promote_from_fixture(fixture, set(), set(), 123, 36)

    assert [place["id"] for place in promoted] == [
        "place:nps-child:seki:campgrounds:sunset-one"
    ]


def test_exact_stable_nps_item_duplicate_is_global(tmp_path: Path) -> None:
    seki = _fixture(
        tmp_path / "seki.json",
        "seki",
        "Sequoia & Kings Canyon National Parks",
        "campgrounds",
        [_camp("shared-nps-id", "Sunset Campground", 36.1, -118.1)],
    )
    bryce = _fixture(
        tmp_path / "brca.json",
        "brca",
        "Bryce Canyon National Park",
        "campgrounds",
        [_camp("shared-nps-id", "North Campground", 37.6, -112.2)],
    )
    existing_ids: set[str] = set()
    existing_titles: set[str] = set()

    first = promote.promote_from_fixture(seki, existing_ids, existing_titles, 123, 36)
    duplicate = promote.promote_from_fixture(bryce, existing_ids, existing_titles, 123, 36)

    assert len(first) == 1
    assert duplicate == []
    assert "nps:item:shared-nps-id" in existing_ids


def test_legacy_catalog_source_id_seeds_global_identity() -> None:
    existing_ids, existing_titles = promote.load_existing_keys(
        {
            "places": [
                {
                    "id": "place:nps-child:seki:campgrounds:legacy-title-slug",
                    "name": "Sunset Campground",
                    "sources": [
                        {
                            "source": "nps",
                            "source_id": "Stable-NPS-456",
                        }
                    ],
                }
            ]
        }
    )

    assert "place:nps-child:seki:campgrounds:legacy-title-slug" in existing_ids
    assert "nps:item:stable-nps-456" in existing_ids
    assert "sunset campground" in existing_titles
    assert "nps-title:seki:campgrounds:sunset campground" in existing_titles


def test_missing_nps_item_id_keeps_legacy_title_identity() -> None:
    item = _camp("temporary", "Legacy Scenic Point", 36.0, -118.0)
    item.pop("id")
    place = promote.place_from_child(
        _park("seki", "Sequoia & Kings Canyon National Parks"),
        "campgrounds",
        item,
        123,
    )

    assert place is not None
    assert place["id"] == "place:nps-child:seki:campgrounds:legacy-scenic-point"
    assert place["source_ids"][0].startswith("nps:seki:campgrounds:")
    assert "nps_item_id" not in place["source_pack"]


def test_reader_copy_uses_complete_body_and_omits_external_link_sentence() -> None:
    item = _camp("aspen-hollow", "Aspen Hollow Campground", 36.7, -118.9)
    item["listingDescription"] = (
        "Please consult the USFS on facility availability- "
        "https://www.fs.usda.gov/recarea/sequoia/recarea/?recid=79580."
        "Aspen Hollow Group Campground has 35 vehicle spaces."
    )
    item.pop("description")
    item["bodyText"] = (
        "<p>Aspen Hollow Group Campground has 35 vehicle spaces and potable water.<br />"
        "Please consult the USFS on facility availability- "
        "https://www.fs.usda.gov/recarea/sequoia/recarea/?recid=79580.</p>"
    )

    text = promote.child_description(item)

    assert text == "Aspen Hollow Group Campground has 35 vehicle spaces and potable water"
    assert "http" not in text
    assert "consult" not in text.casefold()
