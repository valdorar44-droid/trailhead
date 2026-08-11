from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone

import pytest

from db.originals_operational import (
    OriginalOperationalReadinessError,
    evaluate_chapter_readiness,
    load_operational_candidate,
    manifest_operational_fields,
    normalize_operational_candidate,
    operational_candidate_sha256,
    load_checked_in_operational_candidate,
    validate_manifest_operational_binding,
    validate_manifest_operational_validation_projection,
)
from db import store


NOW = datetime(2026, 8, 4, 16, 0, tzinfo=timezone.utc)


def _candidate() -> dict:
    return load_operational_candidate()


def _observation(candidate: dict, chapter_id: str, *, now: datetime = NOW, state: str = "open") -> dict:
    chapter = next(row for row in candidate["chapters"] if row["chapter_id"] == chapter_id)
    return {
        "candidate_id": candidate["candidate_id"],
        "candidate_sha256": operational_candidate_sha256(candidate),
        "source_id": candidate["shared_rules"]["current_conditions_source_id"],
        "observed_at": (now - timedelta(minutes=2)).isoformat(),
        "road_states": {road_id: state for road_id in chapter["required_road_ids"]},
    }


def test_checked_in_candidate_is_strict_deterministic_and_nps_only():
    first = _candidate()
    second = _candidate()
    assert first == second
    assert operational_candidate_sha256(first) == operational_candidate_sha256(second)
    assert {chapter["chapter_id"] for chapter in first["chapters"]} == {
        "mountain_crossing",
        "little_river_cades_cove",
        "roaring_fork",
        "foothills_parkway",
    }
    assert all(source["publisher"] == "National Park Service" for source in first["sources"])
    assert all(source["url"].startswith("https://www.nps.gov/") for source in first["sources"])


def test_projection_matches_original_manifest_v2_operational_shape():
    projected = manifest_operational_fields(_candidate(), "little_river_cades_cove")
    assert set(projected) == {"operational_sources", "operational_readiness"}
    assert projected["operational_readiness"] == {
        "policy": "required_before_start",
        "candidate_id": "smokies-operational-readiness-2026-v1",
        "candidate_sha256": operational_candidate_sha256(_candidate()),
        "source_scopes": [
            "route",
            "access",
            "fees",
            "closures",
            "surface",
            "season",
            "safety",
            "alternates",
            "daily-hours",
            "parking",
            "vehicle-free-days",
        ],
        "alternate_chapter_ids": ["roaring_fork", "foothills_parkway"],
    }
    for source in projected["operational_sources"]:
        assert set(source) == {
            "title",
            "url",
            "publisher",
            "reviewed_at",
            "role",
            "authority",
            "scope",
        }
        assert source["role"] == "operational"
        assert source["authority"] == "official"
        assert source["scope"]

    covered = {
        scope
        for source in projected["operational_sources"]
        for scope in source["scope"]
    }
    assert {"route", "access", "fees", "closures", "surface", "season", "safety"} <= covered


def test_checked_in_binding_requires_exact_hash_projection_and_current_review():
    candidate = _candidate()
    projected = manifest_operational_fields(candidate, "foothills_parkway")
    resolved = validate_manifest_operational_binding(
        chapter_id="foothills_parkway",
        operational_sources=projected["operational_sources"],
        operational_readiness=projected["operational_readiness"],
        now=NOW,
        require_current=True,
    )
    assert resolved["candidate_id"] == candidate["candidate_id"]

    with pytest.raises(OriginalOperationalReadinessError, match="hash"):
        load_checked_in_operational_candidate(
            candidate_id=candidate["candidate_id"],
            candidate_sha256="0" * 64,
        )
    with pytest.raises(OriginalOperationalReadinessError, match="expired"):
        load_checked_in_operational_candidate(
            candidate_id=candidate["candidate_id"],
            candidate_sha256=operational_candidate_sha256(candidate),
            now=datetime(2026, 9, 4, tzinfo=timezone.utc),
            require_current=True,
        )


def test_private_validation_projection_limits_alternates_to_manifest_chapters():
    candidate = _candidate()
    projected = manifest_operational_fields(candidate, "roaring_fork")
    private_readiness = copy.deepcopy(projected["operational_readiness"])
    private_readiness["alternate_chapter_ids"] = []

    evidence = validate_manifest_operational_validation_projection(
        chapter_id="roaring_fork",
        manifest_chapter_ids=["roaring_fork"],
        operational_sources=projected["operational_sources"],
        operational_readiness=private_readiness,
        now=NOW,
        require_current=True,
    )

    assert evidence == {
        "schema_version": 1,
        "kind": "original_operational_validation_projection",
        "projection_mode": "validation_only_manifest_local_alternates_v1",
        "chapter_id": "roaring_fork",
        "candidate_id": candidate["candidate_id"],
        "candidate_sha256": operational_candidate_sha256(candidate),
        "manifest_chapter_ids": ["roaring_fork"],
        "checked_alternate_chapter_ids": ["foothills_parkway"],
        "manifest_local_alternate_chapter_ids": [],
        "omitted_external_alternate_chapter_ids": ["foothills_parkway"],
    }
    with pytest.raises(
        OriginalOperationalReadinessError,
        match="operational readiness does not match",
    ):
        validate_manifest_operational_binding(
            chapter_id="roaring_fork",
            operational_sources=projected["operational_sources"],
            operational_readiness=private_readiness,
            now=NOW,
            require_current=True,
        )


def test_validation_projection_requires_exact_manifest_local_relationship():
    candidate = _candidate()
    projected = manifest_operational_fields(candidate, "roaring_fork")
    private_readiness = copy.deepcopy(projected["operational_readiness"])
    private_readiness["alternate_chapter_ids"] = []

    with pytest.raises(
        OriginalOperationalReadinessError,
        match="manifest-local projection",
    ):
        validate_manifest_operational_validation_projection(
            chapter_id="roaring_fork",
            manifest_chapter_ids=["roaring_fork", "foothills_parkway"],
            operational_sources=projected["operational_sources"],
            operational_readiness=private_readiness,
        )

    advertised_external_alternate = copy.deepcopy(private_readiness)
    advertised_external_alternate["alternate_chapter_ids"] = ["foothills_parkway"]
    with pytest.raises(
        OriginalOperationalReadinessError,
        match="manifest-local projection",
    ):
        validate_manifest_operational_validation_projection(
            chapter_id="roaring_fork",
            manifest_chapter_ids=["roaring_fork"],
            operational_sources=projected["operational_sources"],
            operational_readiness=advertised_external_alternate,
        )

    drifted_sources = copy.deepcopy(projected["operational_sources"])
    drifted_sources[0]["title"] += " drift"
    with pytest.raises(OriginalOperationalReadinessError, match="sources"):
        validate_manifest_operational_validation_projection(
            chapter_id="roaring_fork",
            manifest_chapter_ids=["roaring_fork"],
            operational_sources=drifted_sources,
            operational_readiness=private_readiness,
        )

    with pytest.raises(OriginalOperationalReadinessError, match="not present"):
        validate_manifest_operational_validation_projection(
            chapter_id="roaring_fork",
            manifest_chapter_ids=["foothills_parkway"],
            operational_sources=projected["operational_sources"],
            operational_readiness=private_readiness,
        )


def test_server_owned_start_readiness_fails_closed_without_trusted_observation(monkeypatch):
    candidate = _candidate()
    operational = manifest_operational_fields(candidate, "foothills_parkway")
    manifest = {
        "schema_version": 2,
        "manifest_id": "original_smokies_v1",
        "pack_id": "original_smokies",
        "version": 1,
        "chapters": [{
            "id": "foothills_parkway",
            "default_variant_id": "west_to_east",
            "variants": [{"id": "west_to_east"}],
            **operational,
        }],
    }
    monkeypatch.setattr(
        store,
        "get_published_original_manifest",
        lambda *_args, **_kwargs: copy.deepcopy(manifest),
    )
    monkeypatch.setattr(
        store,
        "resolve_user_original_vehicle_binding",
        lambda _user_id, binding_id: (
            {"status": "ready", "vehicle_class": "passenger"}
            if binding_id == "ovb_test_current_binding_12345"
            else {"status": "vehicle_setup_required", "vehicle_class": None}
        ),
    )
    result = store.get_published_original_start_readiness(
        "original_smokies",
        1,
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        user_id=7,
        now=NOW,
        observation=None,
    )
    assert result["status"] == "check_required"
    assert result["can_start"] is False
    assert result["reason_code"] == "vehicle_setup_required"
    assert result["candidate_id"] == candidate["candidate_id"]
    assert result["candidate_sha256"] == operational_candidate_sha256(candidate)

    missing_observation = store.get_published_original_start_readiness(
        "original_smokies",
        1,
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        user_id=7,
        vehicle_binding_id="ovb_test_current_binding_12345",
        now=NOW,
        observation=None,
    )
    assert missing_observation["status"] == "check_required"
    assert missing_observation["reason_code"] == "current_conditions_unavailable"

    available = store.get_published_original_start_readiness(
        "original_smokies",
        1,
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        user_id=7,
        vehicle_binding_id="ovb_test_current_binding_12345",
        now=NOW,
        observation=_observation(candidate, "foothills_parkway"),
    )
    assert available["status"] == "available"
    assert available["can_start"] is True


def test_every_chapter_projection_covers_original_manifest_v1_publication_scopes():
    candidate = _candidate()
    required = {"route", "access", "fees", "closures", "surface", "season", "safety"}

    for chapter in candidate["chapters"]:
        projected = manifest_operational_fields(candidate, chapter["chapter_id"])
        covered = {
            scope
            for source in projected["operational_sources"]
            for scope in source["scope"]
        }
        assert required <= covered, chapter["chapter_id"]


def test_unknown_fields_and_non_nps_sources_fail_closed():
    candidate = _candidate()
    candidate["internal_notes"] = "must not persist"
    with pytest.raises(OriginalOperationalReadinessError, match="unsupported fields"):
        normalize_operational_candidate(candidate)

    candidate = _candidate()
    candidate["sources"][0]["url"] = "https://example.com/conditions"
    with pytest.raises(OriginalOperationalReadinessError, match="official HTTPS NPS URL"):
        normalize_operational_candidate(candidate)


def test_missing_or_stale_live_conditions_never_become_available():
    candidate = _candidate()
    missing = evaluate_chapter_readiness(
        candidate,
        chapter_id="foothills_parkway",
        now=NOW,
        observation=None,
    )
    assert missing["status"] == "check_required"
    assert missing["reason_code"] == "current_conditions_unavailable"

    stale_observation = _observation(candidate, "foothills_parkway")
    stale_observation["observed_at"] = (NOW - timedelta(hours=2)).isoformat()
    stale = evaluate_chapter_readiness(
        candidate,
        chapter_id="foothills_parkway",
        now=NOW,
        observation=stale_observation,
    )
    assert stale["status"] == "check_required"
    assert stale["reason_code"] == "stale_conditions_observation"


def test_open_closed_restricted_and_incomplete_road_states_are_distinct():
    candidate = _candidate()
    open_result = evaluate_chapter_readiness(
        candidate,
        chapter_id="mountain_crossing",
        now=NOW,
        observation=_observation(candidate, "mountain_crossing"),
        planned_stop_minutes=10,
    )
    assert open_result["status"] == "available"
    assert open_result["reason_code"] == "official_road_check_available"
    assert open_result["notices"] == []

    closed_result = evaluate_chapter_readiness(
        candidate,
        chapter_id="mountain_crossing",
        now=NOW,
        observation=_observation(candidate, "mountain_crossing", state="closed"),
    )
    assert closed_result["status"] == "unavailable"
    assert closed_result["reason_code"] == "current_road_closure"

    restricted_result = evaluate_chapter_readiness(
        candidate,
        chapter_id="mountain_crossing",
        now=NOW,
        observation=_observation(candidate, "mountain_crossing", state="restricted"),
    )
    assert restricted_result["status"] == "check_required"
    assert restricted_result["reason_code"] == "current_road_restriction"

    incomplete = _observation(candidate, "mountain_crossing")
    incomplete["road_states"].pop("kuwohi_road")
    incomplete_result = evaluate_chapter_readiness(
        candidate,
        chapter_id="mountain_crossing",
        now=NOW,
        observation=incomplete,
    )
    assert incomplete_result["status"] == "check_required"
    assert incomplete_result["reason_code"] == "incomplete_conditions_observation"


def test_cades_cove_2026_vehicle_free_wednesday_blocks_motor_tour():
    candidate = _candidate()
    wednesday = datetime(2026, 8, 5, 16, 0, tzinfo=timezone.utc)
    result = evaluate_chapter_readiness(
        candidate,
        chapter_id="little_river_cades_cove",
        now=wednesday,
        observation=_observation(candidate, "little_river_cades_cove", now=wednesday),
    )
    assert result["status"] == "unavailable"
    assert result["reason_code"] == "scheduled_vehicle_free_day"
    assert result["alternate_chapter_ids"] == ["roaring_fork", "foothills_parkway"]


@pytest.mark.parametrize(
    "vehicle_class",
    ["bus", "motorhome", "towing_trailer", "van_over_25_ft"],
)
def test_roaring_fork_vehicle_restrictions_are_source_owned(vehicle_class: str):
    candidate = _candidate()
    result = evaluate_chapter_readiness(
        candidate,
        chapter_id="roaring_fork",
        now=NOW,
        vehicle_class=vehicle_class,
        observation=_observation(candidate, "roaring_fork"),
    )
    assert result["status"] == "unavailable"
    assert result["reason_code"] == "vehicle_not_supported"


def test_commercial_service_vehicle_rule_applies_to_every_chapter():
    candidate = _candidate()
    for chapter in candidate["chapters"]:
        result = evaluate_chapter_readiness(
            candidate,
            chapter_id=chapter["chapter_id"],
            now=NOW,
            vehicle_class="commercial_service",
            observation=_observation(candidate, chapter["chapter_id"]),
        )
        assert result["status"] == "unavailable"
        assert result["reason_code"] == "vehicle_not_supported"


def test_published_season_window_blocks_outside_window_before_live_check():
    candidate = _candidate()
    roaring = next(row for row in candidate["chapters"] if row["chapter_id"] == "roaring_fork")
    roaring["season_windows"][0]["end_date"] = "2026-08-03"
    result = evaluate_chapter_readiness(
        candidate,
        chapter_id="roaring_fork",
        now=NOW,
        observation=_observation(candidate, "roaring_fork"),
    )
    assert result["status"] == "unavailable"
    assert result["reason_code"] == "outside_published_motor_vehicle_season"


def test_expired_source_review_blocks_before_live_observation():
    candidate = _candidate()
    after_review_window = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)
    result = evaluate_chapter_readiness(
        candidate,
        chapter_id="foothills_parkway",
        now=after_review_window,
        observation=_observation(
            candidate,
            "foothills_parkway",
            now=after_review_window,
        ),
    )
    assert result["status"] == "check_required"
    assert result["reason_code"] == "source_review_expired"


def test_parking_notice_preserves_current_nps_prices_without_claiming_entrance_fee():
    candidate = _candidate()
    result = evaluate_chapter_readiness(
        candidate,
        chapter_id="foothills_parkway",
        now=NOW,
        planned_stop_minutes=30,
        observation=_observation(candidate, "foothills_parkway"),
    )
    assert result["notices"] == [{
        "code": "parking_tag",
        "message": "Parking for more than 15 minutes requires a valid parking tag.",
        "source_id": "grsm-fees-2026",
        "fees_usd": {"daily": 5, "weekly": 15, "annual": 40},
    }]
    assert candidate["shared_rules"]["parking"]["tag_is_entrance_fee"] is False


def test_observation_is_bound_to_candidate_and_official_source():
    candidate = _candidate()
    wrong_candidate = _observation(candidate, "foothills_parkway")
    wrong_candidate["candidate_id"] = "different-candidate"
    result = evaluate_chapter_readiness(
        candidate,
        chapter_id="foothills_parkway",
        now=NOW,
        observation=wrong_candidate,
    )
    assert result["reason_code"] == "stale_candidate_observation"

    wrong_hash = _observation(candidate, "foothills_parkway")
    wrong_hash["candidate_sha256"] = "0" * 64
    result = evaluate_chapter_readiness(
        candidate,
        chapter_id="foothills_parkway",
        now=NOW,
        observation=wrong_hash,
    )
    assert result["reason_code"] == "stale_candidate_observation"

    wrong_source = _observation(candidate, "foothills_parkway")
    wrong_source["source_id"] = "grsm-auto-touring"
    result = evaluate_chapter_readiness(
        candidate,
        chapter_id="foothills_parkway",
        now=NOW,
        observation=wrong_source,
    )
    assert result["reason_code"] == "untrusted_conditions_source"


def test_user_copy_avoids_safety_or_guarantee_claims():
    candidate = _candidate()
    rendered = " ".join(
        [chapter["unavailable_message"] for chapter in candidate["chapters"]]
        + [
            evaluate_chapter_readiness(
                candidate,
                chapter_id="foothills_parkway",
                now=NOW,
                observation=None,
            )["message"]
        ]
    ).lower()
    assert " safe" not in rendered
    assert "guarantee" not in rendered
    assert "artificial intelligence" not in rendered
