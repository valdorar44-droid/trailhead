from scripts.explore_sources.usfs.import_usfs import (
    fee_text_from_props,
    operational_source_pack,
    reader_copy,
    reader_summary,
    reservation_from_props,
    season_like_operational_value,
    source_fact_list,
)


def test_fee_copy_removes_source_formatting_without_losing_amounts():
    assert fee_text_from_props({
        "FEE_DESCRIPTION": (
            "Overnight Use: Single Site: $41 per night "
            "Additional Holiday Fee: $2 per night "
            "Additional Vehicle Fee: $10\\ per vehicle per night"
        ),
    }) == (
        "Single Site: $41 per night. Additional Holiday Fee: $2 per night. "
        "Additional Vehicle Fee: $10 per vehicle per night"
    )

    assert fee_text_from_props({
        "FEE_DESCRIPTION": "Single Site: $10 per night $20 per night starting in 2026.",
    }) == "Single Site: $10 per night. $20 per night starting in 2026."


def test_season_copy_omits_redundant_short_source_values():
    assert source_fact_list("June - October", "June") == ["June - October"]
    assert source_fact_list("All year", "Open all year") == ["All year"]


def test_hours_and_season_stay_separate():
    pack = operational_source_pack({
        "OPERATIONAL_HOURS": "Day use 6am-10pm",
        "OPEN_SEASON": "June - October",
    })
    assert pack["operating_hours"] == ["Day use 6am-10pm"]
    assert pack["operating_season"] == ["June - October"]
    assert season_like_operational_value("June - October") == "June - October"
    assert season_like_operational_value("Two night minimum") == ""


def test_reader_summary_never_cuts_source_copy_mid_word():
    text = "First complete source sentence. " + ("Useful campground detail " * 30)
    summary = reader_summary(text, limit=120)
    assert summary == "First complete source sentence."


def test_reader_copy_repairs_missing_sentence_spacing():
    assert reader_copy(
        "Two night minimum on holidays.Maximum length is 14 days. "
        "Maximum group size is 6 people per site All campsites are walk-in"
    ) == (
        "Two night minimum on holidays. Maximum length is 14 days. "
        "Maximum group size is 6 people per site. All campsites are walk-in"
    )


def test_stay_restrictions_are_preserved_as_rules():
    pack = operational_source_pack({
        "RESTRICTIONS": "Maximum length of stay is 14 days.Maximum group size is 6 people per site",
    })
    assert pack["rules"] == "Maximum length of stay is 14 days. Maximum group size is 6 people per site"


def test_generic_https_link_does_not_claim_reservability():
    assert reservation_from_props({"RESERVATION_URL": "https://www.fs.usda.gov/recarea/example"}) == {}
    assert "booking_url" not in operational_source_pack({
        "RESERVATION_URL": "https://www.fs.usda.gov/recarea/example",
    })
    assert reservation_from_props({
        "RESERVATION_URL": "https://www.recreation.gov/camping/campgrounds/232815",
    })["reservable"] is True


def test_agency_reader_copy_repairs_known_encoding_damage():
    assert reader_copy("Campers â€™ guide â€” water Â· toilets") == "Campers ' guide — water · toilets"
