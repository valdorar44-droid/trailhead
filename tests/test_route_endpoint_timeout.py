import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import dashboard.server as server


class RouteEndpointTimeoutTests(unittest.IsolatedAsyncioTestCase):
    def _request(self) -> server.RouteRequest:
        return server.RouteRequest(
            locations=[
                {"lat": 38.5733, "lon": -109.5498},
                {"lat": 38.5677, "lon": -109.5271},
            ],
            options=server.RouteOptions(),
            units="miles",
        )

    async def test_timeout_returns_504_and_cancels_route_work(self):
        cancelled = asyncio.Event()

        async def slow_route_proxy(_body):
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                cancelled.set()
                raise

        with (
            patch.object(server, "ROUTE_ENDPOINT_TIMEOUT_SECONDS", 0.01),
            patch.object(server, "route_proxy", new=slow_route_proxy),
        ):
            with self.assertRaises(HTTPException) as raised:
                await server.route_endpoint(self._request())

        self.assertEqual(raised.exception.status_code, 504)
        self.assertEqual(raised.exception.detail, server.ROUTE_ENDPOINT_TIMEOUT_DETAIL)
        self.assertTrue(cancelled.is_set())

    async def test_cached_and_provider_results_pass_through_unchanged(self):
        results = [
            {
                "trip": {"status": 0},
                "_trailhead": {"engine": "valhalla", "cache": "hit"},
            },
            {
                "trip": {"status": 0},
                "_trailhead": {"engine": "osrm-fallback", "cache": "miss"},
            },
        ]

        for expected in results:
            with self.subTest(cache=expected["_trailhead"]["cache"]):
                route_proxy = AsyncMock(return_value=expected)
                with patch.object(server, "route_proxy", route_proxy):
                    actual = await server.route_endpoint(self._request())

                self.assertIs(actual, expected)
                route_proxy.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
