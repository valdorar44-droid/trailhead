import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from dashboard import server


class _FakeViatorClient:
    def __init__(self):
        self.config = SimpleNamespace(
            page_size=4,
            request_timeout_seconds=10.0,
            cache_ttl_hours=1,
        )
        self.campaigns = []
        self.product_requests = []

    def ready(self):
        return True

    def search_products(self, **kwargs):
        self.campaigns.append(("products", kwargs.get("campaign_value")))
        self.product_requests.append(dict(kwargs))
        return {"status": "ok", "products": []}

    def search_freetext(self, **kwargs):
        self.campaigns.append(("freetext", kwargs.get("campaign_value")))
        return {"status": "ok", "products": []}

    def get_destinations(self, **_kwargs):
        return {
            "status": "ok",
            "destinations": [{
                "destinationId": "5600",
                "name": "Moab",
                "type": "CITY",
                "center": {"latitude": 38.5733, "longitude": -109.5498},
            }],
        }


class ViatorCampaignContextTests(unittest.TestCase):
    def setUp(self):
        server._viator_route_live_cache.clear()
        server._viator_route_live_jobs.clear()

    def tearDown(self):
        server._viator_route_live_cache.clear()
        server._viator_route_live_jobs.clear()

    def test_viator_diagnostics_requires_admin_authentication(self):
        response = TestClient(server.app).get("/api/admin/viator/diagnostics")
        self.assertIn(response.status_code, {401, 403})

    def test_route_suggestions_use_trip_day_only(self):
        client = _FakeViatorClient()
        server._live_viator_route_suggestions(
            client,
            [{"lat": 38.5733, "lng": -109.5498, "name": "Private query text"}],
            limit=2,
            q="user supplied search",
        )

        self.assertTrue(client.campaigns)
        self.assertEqual({value for _, value in client.campaigns}, {"trip-day"})
        self.assertEqual({kind for kind, _ in client.campaigns}, {"products"})
        forbidden = {
            "q", "query", "search_term", "lat", "lng", "latitude", "longitude",
            "account_id", "device_id", "session_id", "route_name", "route_geometry",
        }
        self.assertTrue(client.product_requests)
        for request in client.product_requests:
            self.assertTrue(forbidden.isdisjoint(request))
            self.assertTrue(request.get("destination_id"))

    def test_route_refresh_timeout_matches_the_mobile_polling_contract(self):
        self.assertEqual(
            server._viator_route_refresh_timeout_seconds(SimpleNamespace(request_timeout_seconds=10.0)),
            15.0,
        )
        self.assertEqual(
            server._viator_route_refresh_timeout_seconds(SimpleNamespace(request_timeout_seconds=120.0)),
            125.0,
        )

    def test_route_suggestion_marks_destination_centroid_as_approximate(self):
        results = server._normalize_live_viator_experiences(
            {
                "products": [{
                    "productCode": "NO-MEETING-POINT",
                    "title": "Canyon tour",
                    "productUrl": "https://www.viator.com/tours/example",
                }],
            },
            {"lat": 38.57, "lng": -109.55, "name": "Route stop", "day": 2},
            {"name": "Moab", "lat": 38.5733, "lng": -109.5498},
            1,
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["coordinate_source"], "destination_centroid")
        self.assertEqual(results[0]["coordinate_precision"], "approximate")
        self.assertFalse(results[0]["route_stop_eligible"])
        self.assertEqual(results[0]["lat"], 38.5733)
        self.assertEqual(results[0]["lng"], -109.5498)

    def test_route_suggestion_marks_product_coordinates_as_routable(self):
        results = server._normalize_live_viator_experiences(
            {
                "products": [{
                    "productCode": "EXACT-MEETING-POINT",
                    "title": "Canyon tour",
                    "productUrl": "https://www.viator.com/tours/example",
                    "lat": 38.58,
                    "lng": -109.54,
                }],
            },
            {"lat": 38.57, "lng": -109.55, "name": "Route stop", "day": 2},
            {"name": "Moab", "lat": 38.5733, "lng": -109.5498},
            1,
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["coordinate_source"], "product")
        self.assertEqual(results[0]["coordinate_precision"], "product")
        self.assertTrue(results[0]["route_stop_eligible"])
        self.assertEqual(results[0]["lat"], 38.58)
        self.assertEqual(results[0]["lng"], -109.54)

    def test_guided_destination_uses_explore_guided_only(self):
        client = _FakeViatorClient()
        server._fetch_viator_guided_destination_live(
            client,
            {"name": "Moab", "search_query": "Moab tours", "lat": 38.5733, "lng": -109.5498},
            q="guided search",
            free_cancel=False,
            start_date="",
            end_date="",
            lowest_price=None,
            highest_price=None,
            sort="recommended",
            order="descending",
            currency="USD",
            limit=4,
        )

        self.assertEqual(client.campaigns, [("products", "explore-guided")])

    def test_unresolved_guided_destination_never_forwards_consumer_text(self):
        client = _FakeViatorClient()
        result = server._fetch_viator_guided_destination_live(
            client,
            {
                "name": "Yosemite National Park",
                "search_query": "Yosemite private tour phrase",
                "lat": 37.75,
                "lng": -119.59,
            },
            q="sentinel private consumer query",
            free_cancel=False,
            start_date="",
            end_date="",
            lowest_price=None,
            highest_price=None,
            sort="recommended",
            order="descending",
            currency="USD",
            limit=4,
        )

        self.assertEqual(result["resolution"], "unresolved_destination")
        self.assertEqual(result["provider_calls"], 1)
        self.assertEqual(result["search_payload"]["products"], [])
        self.assertEqual(client.campaigns, [])
        self.assertEqual(client.product_requests, [])

    def test_explore_helpers_use_fixed_context_and_skip_unresolved_raw_query(self):
        place_client = _FakeViatorClient()
        with patch.object(server, "ViatorClient", return_value=place_client):
            server._viator_live_results_for_points(
                [{"lat": 38.5733, "lng": -109.5498, "name": "Place detail"}],
                "viator",
                "private place query",
                2,
                run_now=True,
                campaign_value="explore-place-detail",
            )
        self.assertEqual(
            {value for _, value in place_client.campaigns},
            {"explore-place-detail"},
        )
        self.assertEqual({kind for kind, _ in place_client.campaigns}, {"products"})

        global_client = _FakeViatorClient()
        with patch.object(server, "ViatorClient", return_value=global_client):
            server._viator_live_results_for_points(
                [{"lat": 37.7749, "lng": -122.4194, "name": "Global search"}],
                "viator",
                "another private query",
                2,
                run_now=True,
                campaign_value="explore-global",
            )
        self.assertEqual(global_client.campaigns, [])
        self.assertEqual(global_client.product_requests, [])


if __name__ == "__main__":
    unittest.main()
