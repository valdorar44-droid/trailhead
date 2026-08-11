import asyncio
import json
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from dashboard import server
from db.originals_current_roads import (
    CurrentRoadFeedReaderV1,
    OriginalCurrentRoadsError,
    build_operational_observation,
    parse_nps_road_alerts,
)
from db.originals_operational import load_operational_candidate
from db.originals_route_evidence import (
    canonical_sha256,
    load_registered_route_evidence,
)


NOW = datetime(2026, 8, 5, 18, 0, tzinfo=timezone.utc)
SEGMENT_ID = "d66f76d6-0530-4024-8d7e-15c8be0494f4"


def _record(**updates: object) -> dict:
    value = {
        "site_code": "grsm",
        "is_active": 1,
        "category": "Park Closure",
        "road_closure_event_type": "incident",
        "road_closure_road_segment_id_list": SEGMENT_ID,
        "road_closure_start_date": "August, 01 2026 00:00:00",
        "road_closure_end_date": "August, 10 2026 23:59:00",
        "start_date": "",
        "end_date": "",
    }
    value.update(updates)
    return value


def _feed(records: list[dict], now: datetime = NOW):
    return parse_nps_road_alerts(
        json.dumps(records).encode(),
        content_type="application/json; charset=utf-8",
        observed_at=now,
        etag='W/"one"',
    )


def _route_evidence(source_ids: list[str]) -> dict:
    return {
        "variants": [{
            "chapter_id": "foothills_parkway",
            "variant_id": "west_to_east",
            "status": "official_geometry_candidate",
            "geometry_ready_for_editorial_cues": True,
            "blocking_issues": [],
            "source_geometry_ids": source_ids,
        }],
    }


def _published_server_manifest(schema_version: int) -> dict:
    evidence = load_registered_route_evidence("smokies-official-routes-2026-v1")
    return {
        "schema_version": schema_version,
        "route_evidence": {
            "evidence_id": "smokies-official-routes-2026-v1",
            "evidence_sha256": canonical_sha256(evidence),
        },
        "chapters": [{
            "id": "foothills_parkway",
            "default_variant_id": "west_to_east",
            "variants": [
                {"id": "west_to_east"},
                {"id": "east_to_west"},
            ],
        }],
    }


def _install_open_server_observation(monkeypatch, schema_version: int) -> None:
    monkeypatch.setenv("TRAILHEAD_ORIGINALS_ROAD_READINESS_ENABLED", "internal")
    monkeypatch.setattr(
        server,
        "get_published_original_server_manifest",
        lambda *_args, **_kwargs: _published_server_manifest(schema_version),
    )

    class Reader:
        def get(self, **_kwargs):
            return _feed([])

    monkeypatch.setattr(server, "default_current_road_reader", Reader())


def test_nps_feed_parses_active_dates_and_ignores_information_rows():
    snapshot = _feed([
        _record(),
        _record(
            category="Information",
            road_closure_event_type="no",
            road_closure_road_segment_id_list="",
            road_closure_start_date="",
            road_closure_end_date="",
        ),
        _record(road_closure_start_date="September, 01 2026 00:00:00"),
        _record(is_active=0),
    ])
    assert snapshot.active_segment_sets == (frozenset({SEGMENT_ID}),)
    assert snapshot.has_unlocated_active_closure is False
    assert snapshot.response_sha256


def test_nps_feed_fails_closed_on_schema_content_type_dates_and_segment_ids():
    with pytest.raises(OriginalCurrentRoadsError, match="content type"):
        parse_nps_road_alerts(b"[]", content_type="text/html", observed_at=NOW)
    with pytest.raises(OriginalCurrentRoadsError, match="schema"):
        _feed([{"site_code": "grsm"}])
    with pytest.raises(OriginalCurrentRoadsError, match="invalid date"):
        _feed([_record(road_closure_start_date="soon")])
    with pytest.raises(OriginalCurrentRoadsError, match="segment identity"):
        _feed([_record(road_closure_road_segment_id_list="road-name")])


def test_nps_feed_fails_closed_on_unknown_active_and_closure_values():
    with pytest.raises(OriginalCurrentRoadsError, match="park identity"):
        _feed([_record(site_code="GRSM")])
    with pytest.raises(OriginalCurrentRoadsError, match="active state"):
        _feed([_record(is_active="1")])
    with pytest.raises(OriginalCurrentRoadsError, match="classification"):
        _feed([
            _record(
                category="Road Closure",
                road_closure_event_type="closure",
            )
        ])
    with pytest.raises(OriginalCurrentRoadsError, match="contains closure data"):
        _feed([
            _record(
                category="Information",
                road_closure_event_type="no",
            )
        ])


def test_observation_uses_exact_route_intersection_without_claiming_safety():
    candidate = load_operational_candidate()
    route_evidence = _route_evidence([SEGMENT_ID])
    closed = build_operational_observation(
        candidate=candidate,
        route_evidence=route_evidence,
        route_evidence_sha256=canonical_sha256(route_evidence),
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        feed=_feed([_record()]),
    )
    assert set(closed["road_states"].values()) == {"closed"}
    clear = build_operational_observation(
        candidate=candidate,
        route_evidence=route_evidence,
        route_evidence_sha256=canonical_sha256(route_evidence),
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        feed=_feed([]),
    )
    assert set(clear["road_states"].values()) == {"open"}
    assert "safe" not in json.dumps(clear).lower()


def test_unlocated_closure_or_cross_agency_route_is_unknown():
    candidate = load_operational_candidate()
    for route_evidence, feed in (
        (_route_evidence([SEGMENT_ID]), _feed([_record(road_closure_road_segment_id_list="")])),
        (_route_evidence([SEGMENT_ID, "RCL_2753@ebcinctb1.swain.nc.us"]), _feed([])),
    ):
        result = build_operational_observation(
            candidate=candidate,
            route_evidence=route_evidence,
            route_evidence_sha256=canonical_sha256(route_evidence),
            chapter_id="foothills_parkway",
            variant_id="west_to_east",
            feed=feed,
        )
        assert set(result["road_states"].values()) == {"unknown"}


def test_reader_revalidates_with_etag_and_reuses_only_bounded_cache():
    calls: list[dict[str, str]] = []

    def transport(headers):
        calls.append(dict(headers))
        if len(calls) == 1:
            return 200, {"Content-Type": "application/json", "ETag": 'W/"one"'}, json.dumps([]).encode()
        return 304, {}, b""

    reader = CurrentRoadFeedReaderV1(transport)
    first = reader.get(now=NOW)
    assert reader.get(now=NOW + timedelta(seconds=60)) is first
    refreshed = reader.get(now=NOW + timedelta(seconds=301))
    assert refreshed.observed_at == NOW + timedelta(seconds=301)
    assert calls[1]["If-None-Match"] == 'W/"one"'


def test_reader_returns_fresh_cache_on_refresh_failure_but_never_invents_one():
    calls = 0

    def transport(_headers):
        nonlocal calls
        calls += 1
        if calls == 1:
            return 200, {"Content-Type": "application/json"}, b"[]"
        raise OriginalCurrentRoadsError("offline")

    reader = CurrentRoadFeedReaderV1(transport)
    first = reader.get(now=NOW)
    assert reader.get(now=NOW + timedelta(seconds=301), force_refresh=True) is first
    with pytest.raises(OriginalCurrentRoadsError):
        CurrentRoadFeedReaderV1(lambda _headers: (_ for _ in ()).throw(OriginalCurrentRoadsError("offline"))).get(now=NOW)


def test_start_observation_uses_server_manifest_and_fails_closed(monkeypatch):
    _install_open_server_observation(monkeypatch, 2)
    observation = server._trusted_original_road_observation(
        pack_id="great_smoky_mountains_ridges_rivers_living_memory",
        version=1,
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        user={"id": 7, "is_admin": True},
        now=NOW,
    )
    assert observation is not None
    assert set(observation["road_states"].values()) == {"open"}

    default_observation = server._trusted_original_road_observation(
        pack_id="great_smoky_mountains_ridges_rivers_living_memory",
        version=1,
        chapter_id="foothills_parkway",
        variant_id=None,
        user={"id": 7, "is_admin": True},
        now=NOW,
    )
    assert default_observation is not None
    assert set(default_observation["road_states"].values()) == {"open"}

    class FailingReader:
        def get(self, **_kwargs):
            raise OriginalCurrentRoadsError("unavailable")

    monkeypatch.setattr(server, "default_current_road_reader", FailingReader())
    assert server._trusted_original_road_observation(
        pack_id="great_smoky_mountains_ridges_rivers_living_memory",
        version=1,
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        user={"id": 7, "is_admin": True},
        now=NOW,
    ) is None


def test_v3_start_observation_accepts_explicit_variant(monkeypatch):
    _install_open_server_observation(monkeypatch, 3)

    observation = server._trusted_original_road_observation(
        pack_id="great_smoky_mountains_ridges_rivers_living_memory",
        version=1,
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        user={"id": 7, "is_admin": True},
        now=NOW,
    )

    assert observation is not None
    assert set(observation["road_states"].values()) == {"open"}


def test_v3_start_observation_accepts_default_variant(monkeypatch):
    _install_open_server_observation(monkeypatch, 3)

    observation = server._trusted_original_road_observation(
        pack_id="great_smoky_mountains_ridges_rivers_living_memory",
        version=1,
        chapter_id="foothills_parkway",
        variant_id=None,
        user={"id": 7, "is_admin": True},
        now=NOW,
    )

    assert observation is not None
    assert set(observation["road_states"].values()) == {"open"}


def test_v3_start_observation_fails_closed_when_feed_is_unavailable(monkeypatch):
    _install_open_server_observation(monkeypatch, 3)

    class FailingReader:
        def get(self, **_kwargs):
            raise OriginalCurrentRoadsError("unavailable")

    monkeypatch.setattr(server, "default_current_road_reader", FailingReader())

    assert server._trusted_original_road_observation(
        pack_id="great_smoky_mountains_ridges_rivers_living_memory",
        version=1,
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        user={"id": 7, "is_admin": True},
        now=NOW,
    ) is None


def test_start_observation_is_disabled_for_public_users_by_default(monkeypatch):
    monkeypatch.delenv("TRAILHEAD_ORIGINALS_ROAD_READINESS_ENABLED", raising=False)
    monkeypatch.setattr(
        server,
        "get_published_original_server_manifest",
        lambda *_args, **_kwargs: pytest.fail("disabled reader must not load a manifest"),
    )
    assert server._trusted_original_road_observation(
        pack_id="smokies",
        version=1,
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        user={"id": 7, "is_admin": False},
        now=NOW,
    ) is None


def test_start_endpoint_moves_blocking_road_reader_off_the_event_loop(monkeypatch):
    entered = threading.Event()

    def delayed_observation(**_kwargs):
        entered.set()
        time.sleep(0.08)
        return None

    monkeypatch.setattr(server, "_require_originals_feature", lambda _user: None)
    monkeypatch.setattr(server, "_trusted_original_road_observation", delayed_observation)
    monkeypatch.setattr(
        server,
        "get_published_original_version",
        lambda *_args, **_kwargs: {"pack_id": "smokies", "version": 1},
    )
    monkeypatch.setattr(
        server,
        "get_published_original_start_readiness",
        lambda *_args, **_kwargs: {
            "status": "check_required",
            "can_start": False,
        },
    )

    async def assertion():
        task = asyncio.create_task(server.api_original_start_readiness(
            "smokies",
            1,
            server.OriginalStartReadinessRequestV1(
                chapter_id="foothills_parkway",
                variant_id=None,
            ),
            user={"id": 7, "is_admin": True},
        ))
        while not entered.is_set():
            await asyncio.sleep(0.001)
        await asyncio.sleep(0.005)
        assert not task.done(), "the simulated network request should still be running"
        heartbeat = True
        result = await task
        assert heartbeat is True
        assert result["status"] == "check_required"

    asyncio.run(assertion())
