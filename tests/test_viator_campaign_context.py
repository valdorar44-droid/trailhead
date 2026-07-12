import unittest
from types import SimpleNamespace
from unittest.mock import patch

from dashboard import server


class _FakeViatorClient:
    def __init__(self):
        self.config = SimpleNamespace(
            page_size=4,
            request_timeout_seconds=10.0,
            cache_ttl_hours=1,
        )
        self.campaigns = []

    def ready(self):
        return True

    def search_products(self, **kwargs):
        self.campaigns.append(("products", kwargs.get("campaign_value")))
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

    def test_explore_helpers_forward_fixed_place_and_global_contexts(self):
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
        self.assertEqual(
            {value for _, value in global_client.campaigns},
            {"explore-global"},
        )


if __name__ == "__main__":
    unittest.main()
