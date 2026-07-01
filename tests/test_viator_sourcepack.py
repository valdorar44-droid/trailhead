from __future__ import annotations

import json
import asyncio
import io
import tempfile
import unittest
import urllib.error
from pathlib import Path

import dashboard.server as server
from scripts.explore_sources.travel.cache_policy import CachePolicy, is_expired
from scripts.explore_sources.travel.ranking import rank_experiences
from scripts.explore_sources.travel.schema import planner_stop_from_experience
from scripts.explore_sources.travel.viator.client import ViatorClient, ViatorConfig
from scripts.explore_sources.travel.viator.import_viator import import_viator_fixture, main as import_main
from scripts.explore_sources.travel.viator.normalize_viator import normalize_viator_products


ROOT = Path(__file__).resolve().parents[1]
YOSEMITE = ROOT / "tests/fixtures/explore_sources/viator_yosemite_sample.json"
MOAB = ROOT / "tests/fixtures/explore_sources/viator_moab_sample.json"
EMPTY = ROOT / "tests/fixtures/explore_sources/viator_empty_sample.json"


class FailingOpener:
    def __call__(self, *_args, **_kwargs):
        raise TimeoutError("network down")


class JsonResponse:
    def __init__(self, payload: dict, headers: dict | None = None):
        self.payload = payload
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class CapturingOpener:
    def __init__(self, payload: dict | None = None):
        self.payload = payload or {"products": []}
        self.requests = []
        self.bodies = []

    def __call__(self, request, *_args, **_kwargs):
        self.requests.append(request)
        if request.data:
            self.bodies.append(json.loads(request.data.decode("utf-8")))
        return JsonResponse(self.payload, headers={"X-Unique-ID": "trace-123"})


class PagedViatorOpener:
    def __init__(self, total: int = 18):
        self.total = total
        self.requests = []
        self.bodies = []

    def __call__(self, request, *_args, **_kwargs):
        self.requests.append(request)
        body = json.loads(request.data.decode("utf-8")) if request.data else {}
        self.bodies.append(body)
        pagination = body.get("pagination") or {}
        start = int(pagination.get("start") or 1)
        count = int(pagination.get("count") or 1)
        products = []
        for index in range(start, min(start + count, self.total + 1)):
            products.append({
                "productCode": f"MOAB-PAGED-{index:03d}",
                "title": f"Moab Guided Tour {index}",
                "description": "Guided Moab trip with red-rock scenery, local route knowledge, and flexible pacing.",
                "lat": 38.573315,
                "lng": -109.54984,
                "reviews": {"totalReviews": 100 - index, "combinedAverageRating": 4.8},
                "pricing": {"summary": {"fromPrice": 100 + index}, "currency": "USD"},
                "productUrl": f"https://www.viator.com/tours/Moab/Moab-Guided-Tour-{index}/d5600-MOAB-PAGED-{index:03d}",
                "destinations": [{"ref": "5600", "name": "Moab", "primary": True}],
                "flags": ["FREE_CANCELLATION"],
            })
        return JsonResponse({"products": products, "status": "ok"}, headers={"X-Unique-ID": f"trace-{start}"})


class HttpErrorOpener:
    def __call__(self, request, *_args, **_kwargs):
        body = json.dumps({"code": "SERVER_ERROR", "message": "Viator failed", "trackingId": "track-500"}).encode("utf-8")
        raise urllib.error.HTTPError(request.full_url, 500, "Internal Server Error", {}, io.BytesIO(body))


class ViatorSourcePackTests(unittest.TestCase):
    def test_viator_fixture_loads_and_normalizes(self):
        experiences = import_viator_fixture(YOSEMITE, fetched_at=123)
        self.assertEqual(len(experiences), 2)
        first = experiences[0]
        self.assertEqual(first.source_badge, "Viator")
        self.assertEqual(first.primary_action, "Book on Viator")
        self.assertEqual(first.cache_policy, CachePolicy.PARTNER_API_INGEST.value)
        self.assertEqual(first.booking_url, first.affiliate_url)
        self.assertEqual(first.currency, "USD")
        self.assertEqual(first.rating, 4.8)
        self.assertEqual(first.review_count, 231)
        self.assertTrue(first.hero_image_url.endswith("yosemite-valley.jpg"))
        self.assertIn("hiking", first.subcategories)

    def test_empty_fixture_returns_no_experiences(self):
        self.assertEqual(import_viator_fixture(EMPTY, fetched_at=123), [])

    def test_client_without_key_returns_empty_safely(self):
        client = ViatorClient(ViatorConfig(api_key="", enable_live=False))
        payload = client.search_products(destination_id="5265")
        self.assertEqual(payload["products"], [])
        self.assertEqual(payload["status"], "disabled")

    def test_client_failure_does_not_raise(self):
        client = ViatorClient(ViatorConfig(api_key="test", enable_live=True), opener=FailingOpener())
        payload = client.search_products(destination_id="5265")
        self.assertEqual(payload["products"], [])
        self.assertEqual(payload["status"], "timeout")

    def test_client_uses_viator_v2_headers_and_documented_sort(self):
        opener = CapturingOpener()
        client = ViatorClient(ViatorConfig(api_key="test", enable_live=True), opener=opener)
        payload = client.search_products(destination_id="5600", count=3)
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["tracking_id"], "trace-123")
        request = opener.requests[0]
        headers = {key.lower(): value for key, value in request.header_items()}
        self.assertEqual(headers["accept"], "application/json;version=2.0")
        self.assertEqual(headers["content-type"], "application/json;version=2.0")
        self.assertEqual(headers["accept-language"], "en-US")
        self.assertEqual(headers["exp-api-key"], "test")
        self.assertEqual(opener.bodies[0]["sorting"]["sort"], "TRAVELER_RATING")
        self.assertEqual(opener.bodies[0]["pagination"]["count"], 3)

    def test_live_route_suggestions_fetches_multiple_viator_pages(self):
        opener = PagedViatorOpener(total=18)
        client = ViatorClient(ViatorConfig(api_key="test", enable_live=True, page_size=6), opener=opener)
        results, statuses = server._live_viator_route_suggestions(
            client,
            [{"lat": 38.573315, "lng": -109.54984, "name": "Moab", "leg_index": 0}],
            limit=16,
            q="Moab",
            filters={},
        )
        self.assertEqual(len(results), 16)
        self.assertEqual([body["pagination"]["start"] for body in opener.bodies], [1, 7, 13])
        self.assertEqual([body["pagination"]["count"] for body in opener.bodies], [6, 6, 4])
        self.assertEqual(len(statuses), 3)

    def test_experience_detail_finds_live_cache_result(self):
        old_cache = dict(server._viator_route_live_cache)
        try:
            server._viator_route_live_cache.clear()
            server._viator_route_live_cache["moab-live"] = {
                "status": "ok",
                "results": [{
                    "id": "viator:LIVE-DETAIL-001",
                    "source_id": "LIVE-DETAIL-001",
                    "title": "Moab Canyon Tour",
                }],
            }
            self.assertEqual(server._find_experience("viator:LIVE-DETAIL-001")["title"], "Moab Canyon Tour")
            self.assertEqual(server._find_experience("LIVE-DETAIL-001")["title"], "Moab Canyon Tour")
            self.assertEqual(server._find_experience("viator:live-detail-001")["title"], "Moab Canyon Tour")
        finally:
            server._viator_route_live_cache.clear()
            server._viator_route_live_cache.update(old_cache)

    def test_client_preserves_viator_http_error_details(self):
        client = ViatorClient(ViatorConfig(api_key="test", enable_live=True), opener=HttpErrorOpener())
        payload = client.search_products(destination_id="5600")
        self.assertEqual(payload["products"], [])
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["http_status"], 500)
        self.assertEqual(payload["provider_code"], "SERVER_ERROR")
        self.assertEqual(payload["provider_message"], "Viator failed")
        self.assertEqual(payload["tracking_id"], "track-500")

    def test_cache_expiry_decision(self):
        self.assertFalse(is_expired(200, now=100))
        self.assertTrue(is_expired(99, now=100))

    def test_ranking_prefers_relevant_rated_image_backed_cards(self):
        experiences = [item.to_dict() for item in import_viator_fixture(MOAB, fetched_at=123)]
        weak = dict(experiences[0])
        weak.update({
            "id": "viator:weak",
            "source_id": "weak",
            "title": "Generic City Walk",
            "summary": "Generic activity.",
            "subcategories": [],
            "lat": 40.0,
            "lng": -110.0,
            "rating": 3.2,
            "review_count": 1,
            "hero_image_url": "",
        })
        ranked = rank_experiences([weak, *experiences], {
            "summary": {
                "title": "Moab",
                "category": "Offroad Route",
                "explore_group": "trails",
                "lat": 38.5733,
                "lng": -109.5498,
                "tags": ["moab", "offroad", "canyon"],
            }
        })
        self.assertEqual(ranked[0]["source_id"], "MOAB-JEEP-001")

    def test_planner_save_shape_is_external_booking(self):
        experience = import_viator_fixture(YOSEMITE, fetched_at=123)[0]
        stop = planner_stop_from_experience(experience, day=2)
        self.assertEqual(stop["type"], "bookable_experience")
        self.assertEqual(stop["source"], "viator")
        self.assertEqual(stop["source_id"], "YOSE-HIKE-001")
        self.assertEqual(stop["status"], "needs_booking")
        self.assertIn("viator.com", stop["booking_url"])

    def test_import_script_writes_dashboard_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "experiences.json"
            viator_out = Path(tmp) / "viator.json"
            old_argv = __import__("sys").argv
            try:
                __import__("sys").argv = [
                    "import_viator.py",
                    "--fixture", str(YOSEMITE),
                    "--fixture", str(MOAB),
                    "--out", str(out),
                    "--viator-out", str(viator_out),
                ]
                self.assertEqual(import_main(), 0)
            finally:
                __import__("sys").argv = old_argv
            payload = json.loads(out.read_text())
            self.assertEqual(payload["source"], "viator")
            self.assertEqual(payload["count"], 4)
            self.assertEqual(json.loads(viator_out.read_text())["count"], 4)

    def test_backend_experiences_endpoint_ranks_near_place(self):
        old_experiences = server.EXPLORE_BOOKABLE_EXPERIENCES
        old_tours = server.EXPLORE_TOURS_VIATOR
        old_catalog = server.EXPLORE_CATALOG
        old_catalog_v3 = server.EXPLORE_CATALOG_V3
        old_overrides = server.get_explore_story_overrides
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                server.EXPLORE_BOOKABLE_EXPERIENCES = tmp_path / "experiences.json"
                server.EXPLORE_TOURS_VIATOR = tmp_path / "missing.json"
                server.EXPLORE_CATALOG = tmp_path / "catalog.json"
                server.EXPLORE_CATALOG_V3 = tmp_path / "missing-v3.json"
                server.get_explore_story_overrides = lambda: {}
                experiences = [item.to_dict() for item in import_viator_fixture(YOSEMITE, fetched_at=123)]
                server.EXPLORE_BOOKABLE_EXPERIENCES.write_text(json.dumps({
                    "schema_version": 1,
                    "source": "viator",
                    "generated_at": 123,
                    "experiences": experiences,
                }))
                server.EXPLORE_CATALOG.write_text(json.dumps({
                    "schema_version": 1,
                    "catalog_id": "test",
                    "places": [{
                        "id": "explore:yosemite",
                        "summary": {
                            "id": "explore:yosemite",
                            "title": "Yosemite National Park",
                            "category": "Parks",
                            "explore_group": "parks",
                            "lat": 37.748,
                            "lng": -119.588,
                            "rank": 1,
                        },
                        "profile": {"summary": "Yosemite", "hook": "Yosemite"},
                    }],
                }))
                response = asyncio.run(server.explore_place_experiences("explore:yosemite", limit=5))
            self.assertEqual(response["source"], "viator")
            self.assertEqual(response["count"], 2)
            self.assertEqual(response["results"][0]["source_badge"], "Viator")
            self.assertEqual(response["results"][0]["primary_action"], "Book on Viator")
        finally:
            server.EXPLORE_BOOKABLE_EXPERIENCES = old_experiences
            server.EXPLORE_TOURS_VIATOR = old_tours
            server.EXPLORE_CATALOG = old_catalog
            server.EXPLORE_CATALOG_V3 = old_catalog_v3
            server.get_explore_story_overrides = old_overrides

    def test_backend_refresh_without_key_is_disabled(self):
        response = asyncio.run(server.explore_experience_refresh())
        if response["ok"]:
            self.skipTest("Live Viator env is enabled in this environment.")
        self.assertEqual(response["status"], "disabled")
        self.assertEqual(response["results"], [])


if __name__ == "__main__":
    unittest.main()
