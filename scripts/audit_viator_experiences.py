#!/usr/bin/env python3
"""Audit Trailhead's Viator source pack in disabled and fixture-enabled modes."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

import dashboard.server as server  # noqa: E402
from scripts.explore_sources.travel.viator.import_viator import import_viator_fixture  # noqa: E402


YOSEMITE_FIXTURE = ROOT / "tests/fixtures/explore_sources/viator_yosemite_sample.json"
MOAB_FIXTURE = ROOT / "tests/fixtures/explore_sources/viator_moab_sample.json"


def fail(message: str) -> None:
    print(f"Viator audit failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def assert_card(item: dict, expected_source: str = "viator") -> None:
    required = ["id", "source_id", "source_badge", "title", "booking_url", "affiliate_url", "primary_action"]
    missing = [key for key in required if not item.get(key)]
    if missing:
        fail(f"{item.get('id') or item.get('title') or 'experience'} missing {missing}")
    if item.get("source") != expected_source:
        fail(f"{item.get('id')} has source {item.get('source')}, expected {expected_source}")
    if "viator.com" not in str(item.get("booking_url") or ""):
        fail(f"{item.get('id')} booking_url is not a Viator URL")
    if item.get("primary_action") != "Book on Viator":
        fail(f"{item.get('id')} primary_action should be Book on Viator")


def main() -> int:
    fixture_state = os.environ.get("VIATOR_ENABLE_FIXTURE_DATA")
    try:
        rail_source = (ROOT / "mobile/components/explore/ExploreExperiencesRail.tsx").read_text()
        guide_source = (ROOT / "mobile/app/(tabs)/guide.tsx").read_text()
        server_source = (ROOT / "dashboard/server.py").read_text()
        if "remainingCount > 0" not in rail_source or "Show {Math.min(step, remainingCount)} more" not in rail_source:
            fail("guided trip rail is missing a count-aware Show more control")
        if "api.getExplorePlaceExperiences(placeId, 24)" not in guide_source:
            fail("Explore detail should request enough guided trips for Show more")
        if "api.getExploreExperiences(center?.lat, center?.lng, center ? 60 : 100, 'viator', 48" not in guide_source:
            fail("Guided trip search should request up to 48 results")
        if "target_limit = max(1, min(int(limit or 8), 48))" not in server_source:
            fail("Live Viator search should allow up to 48 results")

        for fixture in (YOSEMITE_FIXTURE, MOAB_FIXTURE):
            cards = [item.to_dict() for item in import_viator_fixture(fixture, fetched_at=123)]
            if len(cards) != 2:
                fail(f"{fixture.name} should normalize to 2 cards, got {len(cards)}")
            for card in cards:
                assert_card(card)

        client = TestClient(server.app)

        os.environ.pop("VIATOR_ENABLE_FIXTURE_DATA", None)
        disabled = client.get("/api/explore/places/place:nps:yose/experiences?limit=4")
        if disabled.status_code != 200:
            fail(f"disabled place endpoint returned HTTP {disabled.status_code}")
        disabled_payload = disabled.json()
        if disabled_payload.get("results") != []:
            fail("fixture data leaked while VIATOR_ENABLE_FIXTURE_DATA is off")
        if disabled_payload.get("live_status") != "disabled":
            fail(f"expected live_status disabled without live config, got {disabled_payload.get('live_status')}")

        os.environ["VIATOR_ENABLE_FIXTURE_DATA"] = "true"
        yosemite = client.get("/api/explore/places/place:nps:yose/experiences?limit=4")
        moab = client.get("/api/explore/experiences?q=Moab&limit=4")
        detail = client.get("/api/explore/experiences/viator:yose-hike-001")
        for label, response in (("Yosemite", yosemite), ("Moab", moab), ("detail", detail)):
            if response.status_code != 200:
                fail(f"{label} endpoint returned HTTP {response.status_code}")
        yosemite_payload = yosemite.json()
        moab_payload = moab.json()
        if yosemite_payload.get("count") != 2:
            fail(f"Yosemite fixture endpoint should return 2 cards, got {yosemite_payload.get('count')}")
        if moab_payload.get("count") != 2:
            fail(f"Moab fixture endpoint should return 2 cards, got {moab_payload.get('count')}")
        for item in [*(yosemite_payload.get("results") or []), *(moab_payload.get("results") or [])]:
            assert_card(item)
        assert_card(detail.json())

        refresh = client.post("/api/explore/experiences/refresh")
        if refresh.status_code != 200:
            fail(f"refresh endpoint returned HTTP {refresh.status_code}")
        refresh_payload = refresh.json()
        if refresh_payload.get("status") != "disabled" and not refresh_payload.get("ok"):
            fail(f"unexpected refresh response: {refresh_payload}")

        print("Viator audit passed (disabled mode is safe; fixture mode returns Yosemite/Moab cards and details).")
        return 0
    finally:
        if fixture_state is None:
            os.environ.pop("VIATOR_ENABLE_FIXTURE_DATA", None)
        else:
            os.environ["VIATOR_ENABLE_FIXTURE_DATA"] = fixture_state


if __name__ == "__main__":
    raise SystemExit(main())
