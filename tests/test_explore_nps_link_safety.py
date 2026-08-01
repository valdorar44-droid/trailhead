from __future__ import annotations

from scripts.explore_sources.nps.import_nps import (
    child_detail_fields,
    child_url,
    nps_absolute_url,
    repair_mojibake,
    safe_reader_text,
)
from scripts.qa_explore_b08_internal_candidate import _is_https_public_url, _iter_links


def test_nps_http_is_upgraded_but_unverified_external_http_is_omitted():
    assert nps_absolute_url("http://www.nps.gov/yell/planyourvisit/index.htm") == (
        "https://www.nps.gov/yell/planyourvisit/index.htm"
    )
    assert nps_absolute_url("http://www.gtlc.com/lodging") == ""


def test_public_external_https_is_preserved_and_private_hosts_are_rejected():
    recreation = "https://www.recreation.gov/camping/campgrounds/232815"
    assert nps_absolute_url(recreation) == recreation
    assert nps_absolute_url("https://cms.nps.doi.net/internal") == ""
    assert nps_absolute_url("https://127.0.0.1/private") == ""
    assert nps_absolute_url("https://10.0.0.8/private") == ""
    assert nps_absolute_url("https://trailhead.internal/private") == ""


def test_reader_copy_upgrades_official_links_and_removes_unverified_http_links():
    source = (
        "See http://www.nps.gov/grte/planyourvisit/conditions.htm. "
        "The chapel is nearby at http://olmcatholic.org/chapel."
    )
    cleaned = safe_reader_text(source)
    assert "https://www.nps.gov/grte/planyourvisit/conditions.htm" in cleaned
    assert "olmcatholic.org" not in cleaned
    assert "The chapel is nearby." in cleaned


def test_reader_copy_repairs_utf8_mojibake_without_changing_clean_unicode():
    assert repair_mojibake("Wildlifeâ€”and Marylandâ€™s waterfall") == "Wildlife—and Maryland’s waterfall"
    assert repair_mojibake("montaÃ±as") == "montañas"
    assert repair_mojibake("École") == "École"


def test_child_fields_keep_safe_booking_and_fall_back_to_the_park_action():
    fields = child_detail_fields(
        {
            "directionsInfo": "Directions: http://www.nps.gov/yose/planyourvisit/directions.htm",
            "reservationUrl": "https://www.recreation.gov/camping/campgrounds/232815",
        },
        park_code="yose",
    )
    assert fields["directions"].endswith("https://www.nps.gov/yose/planyourvisit/directions.htm")
    assert fields["reservation_url"] == "https://www.recreation.gov/camping/campgrounds/232815"
    assert child_url({"url": "http://outdoorsb.sbmm.org/place"}, "chis") == (
        "https://www.nps.gov/chis/index.htm"
    )


def test_recursive_gate_finds_embedded_links_and_rejects_nonpublic_hosts():
    payload = {
        "description": "Conditions at http://www.nps.gov/yell/index.htm",
        "directions": "Internal https://localhost/admin and https://192.168.1.4/private",
        "official_url": "https://www.nps.gov/yell/index.htm",
    }
    links = dict(_iter_links(payload))
    assert any(path.startswith("place.description#url") for path in links)
    assert any(value == "https://localhost/admin" for value in links.values())
    assert not _is_https_public_url("http://www.nps.gov/yell/index.htm")
    assert not _is_https_public_url("https://localhost/admin")
    assert not _is_https_public_url("https://192.168.1.4/private")
    assert _is_https_public_url("https://www.nps.gov/yell/index.htm")
