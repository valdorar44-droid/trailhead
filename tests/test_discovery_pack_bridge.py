import time
import unittest
from unittest.mock import AsyncMock, Mock, patch

import dashboard.server as server


def _camp(camp_id: str, name: str, lat: float, lng: float, source: str = "osm") -> dict:
    return {
        "id": camp_id,
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": "camp",
        "category": "camp",
        "source": source,
        "tags": ["camp"],
        "description": f"{name} campsite.",
    }


class DiscoveryPackBridgeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        server._discovery_pack_cache.clear()

    def tearDown(self):
        server._discovery_pack_cache.clear()

    def test_regions_for_bounds_prefers_intersecting_state(self):
        regions = server._discovery_regions_for_bounds(n=38.75, s=38.45, e=-109.25, w=-109.75)

        self.assertIn("ut", regions[:1])

    async def test_pack_area_filters_normalizes_and_marks_pack_status(self):
        payload = {
            "generated_at": int(time.time()),
            "coverage_status": "ready",
            "source_counts": {"osm": 2, "ridb": 1},
            "points": [
                _camp("osm:moab-1", "Moab Rim Camp", 38.58, -109.56),
                _camp("osm:outside", "Too Far Camp", 39.5, -109.56),
                {"id": "fuel:1", "name": "Fuel", "lat": 38.58, "lng": -109.56, "type": "fuel", "source": "osm"},
            ],
        }
        fetch = AsyncMock(return_value=payload)

        with patch.object(server._place_packs, "fetch_remote_pack", new=fetch):
            result = await server._load_camp_pack_area(
                n=38.75,
                s=38.45,
                e=-109.25,
                w=-109.75,
                radius_miles=20,
                type_filters=None,
                limit=10,
                mode="light",
            )

        fetch.assert_awaited_once_with("ut", "camps")
        self.assertEqual(result["pack"]["status"], "ready")
        self.assertEqual(result["source_counts"]["pack"], 1)
        self.assertEqual(result["source_counts"]["pack:osm"], 2)
        self.assertEqual(result["source_counts"]["pack:ridb"], 1)
        self.assertEqual(len(result["raw_camps"]), 1)
        self.assertEqual(result["raw_camps"][0]["cache_status"], "pack")
        self.assertEqual(result["camps"][0]["name"], "Moab Rim Camp")

    def test_pack_sufficiency_requires_fresh_ready_density(self):
        ready = {"pack": {"status": "ready"}, "raw_camps": [{} for _ in range(4)]}
        thin = {"pack": {"status": "ready"}, "raw_camps": [{} for _ in range(3)]}
        stale = {"pack": {"status": "stale"}, "raw_camps": [{} for _ in range(12)]}

        self.assertTrue(server._camp_pack_sufficient(ready, radius_miles=8, limit=10))
        self.assertFalse(server._camp_pack_sufficient(thin, radius_miles=8, limit=10))
        self.assertFalse(server._camp_pack_sufficient(stale, radius_miles=8, limit=10))

    async def test_discovery_context_uses_sufficient_pack_without_live_providers(self):
        camps = [
            _camp("pack:1", "Pack Camp 1", 38.56, -109.55),
            _camp("pack:2", "Pack Camp 2", 38.57, -109.54),
            _camp("pack:3", "Pack Camp 3", 38.58, -109.53),
        ]
        pack_result = {
            "raw_camps": camps,
            "camps": camps,
            "source_counts": {"pack": len(camps), "pack_regions": 1},
            "pack": {"status": "ready", "regions": ["ut"], "missing_regions": [], "stale_regions": []},
        }
        body = server.DiscoveryContextRequest(
            bounds=server.PlannerBounds(n=38.65, s=38.45, e=-109.35, w=-109.75),
            categories=["camp"],
            surface="test_pack",
            mode="light",
            limit=3,
        )

        with (
            patch.object(server, "_load_camp_pack_area", new=AsyncMock(return_value=pack_result)),
            patch.object(server, "_load_camp_discovery_area", new=AsyncMock()) as live,
            patch.object(server, "get_cached", new=Mock()) as get_cached,
            patch.object(server, "set_cached", new=Mock()) as set_cached,
        ):
            response = await server.discovery_context(body, user=None)

        live.assert_not_awaited()
        get_cached.assert_not_called()
        set_cached.assert_called_once()
        self.assertEqual(response["cache"]["status"], "pack")
        self.assertEqual(response["pack"]["status"], "ready")
        self.assertEqual([camp["name"] for camp in response["camps"]], ["Pack Camp 1", "Pack Camp 2", "Pack Camp 3"])

    async def test_discovery_context_merges_thin_pack_with_live_sources(self):
        pack_camps = [_camp("pack:1", "Pack Camp", 38.56, -109.55)]
        live_camps = [_camp("ridb:2", "Live Camp", 38.57, -109.54, source="ridb")]
        body = server.DiscoveryContextRequest(
            bounds=server.PlannerBounds(n=38.65, s=38.45, e=-109.35, w=-109.75),
            categories=["camp"],
            surface="test_thin_pack",
            mode="light",
            limit=10,
        )

        with (
            patch.object(server, "_load_camp_pack_area", new=AsyncMock(return_value={
                "raw_camps": pack_camps,
                "camps": pack_camps,
                "source_counts": {"pack": 1, "pack_regions": 1},
                "pack": {"status": "thin", "regions": ["ut"], "missing_regions": [], "stale_regions": []},
            })),
            patch.object(server, "_load_camp_discovery_area", new=AsyncMock(return_value={
                "raw_camps": live_camps,
                "camps": live_camps,
                "source_counts": {"ridb": 1, "merged": 1},
                "source_errors": {},
            })) as live,
            patch.object(server, "get_cached", new=Mock(return_value=None)),
            patch.object(server, "set_cached", new=Mock()),
        ):
            response = await server.discovery_context(body, user=None)

        live.assert_awaited_once()
        self.assertEqual(response["cache"]["status"], "miss")
        self.assertEqual(response["source_counts"]["pack"], 1)
        self.assertEqual(response["source_counts"]["ridb"], 1)
        self.assertEqual(response["source_counts"]["merged"], 2)
        self.assertEqual([camp["name"] for camp in response["camps"]], ["Live Camp", "Pack Camp"])


if __name__ == "__main__":
    unittest.main()
