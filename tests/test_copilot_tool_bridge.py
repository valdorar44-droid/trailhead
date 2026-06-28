import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException

import dashboard.server as server
from config.settings import settings
from db import store


def _admin_user() -> dict:
    return {"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"}


def _feature(name: str = "Moab Diner", lat: float = 38.5733, lng: float = -109.5498) -> dict:
    return {
        "type": "Feature",
        "id": "mapbox.test.1",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": {
            "name": name,
            "mapbox_id": "mapbox.test.1",
            "feature_type": "poi",
            "poi_category": ["restaurant"],
            "full_address": "Main Street, Moab, Utah",
        },
    }


def _camp(camp_id: str, name: str, lat: float = 38.56, lng: float = -109.55) -> dict:
    return {
        "id": camp_id,
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": "camp",
        "category": "camp",
        "source": "pack",
        "tags": ["camp"],
    }


class CopilotToolBridgeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.orig = {
            "db_path": settings.db_path,
            "extreme_enabled": settings.extreme_enabled,
            "extreme_kill_switch": settings.extreme_kill_switch,
            "extreme_beta_user_ids": settings.extreme_beta_user_ids,
            "extreme_beta_emails": settings.extreme_beta_emails,
            "extreme_allowed_surfaces": settings.extreme_allowed_surfaces,
            "extreme_copilot_enabled": settings.extreme_copilot_enabled,
            "mapbox_token": settings.mapbox_token,
        }
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        settings.db_path = tmp.name
        settings.extreme_enabled = True
        settings.extreme_kill_switch = False
        settings.extreme_beta_user_ids = ""
        settings.extreme_beta_emails = ""
        settings.extreme_allowed_surfaces = "map_layers,copilot"
        settings.extreme_copilot_enabled = True
        settings.mapbox_token = "pk.test"
        store.init_db()
        server._discovery_pack_cache.clear()

    def tearDown(self):
        server._discovery_pack_cache.clear()
        for key, value in self.orig.items():
            setattr(settings, key, value)

    def test_tool_aliases_and_specs_cover_contract(self):
        self.assertEqual(server._trailhead_tool_alias("search_places"), "trailhead.search_places")
        self.assertEqual(server._trailhead_tool_alias("trailhead.route-preview"), "trailhead.route_preview")
        with self.assertRaises(HTTPException):
            server._trailhead_tool_alias("not_real")

        specs = server._trailhead_tool_specs()
        names = {spec["name"] for spec in specs}
        self.assertEqual(names, server.TRAILHEAD_COPILOT_TOOL_NAMES)
        for spec in specs:
            self.assertEqual(spec["contract"], server.TRAILHEAD_COPILOT_TOOL_CONTRACT_VERSION)
            self.assertIn("input_schema", spec)

    async def test_execute_search_places_uses_map_context_bridge(self):
        with (
            patch.object(server, "_map_context_searchbox_features", new=AsyncMock(return_value=([_feature()], {"bbox": "", "proximity": ""}))),
            patch.object(server, "log_extreme_ledger_event", new=Mock(return_value=101)),
        ):
            response = await server._execute_trailhead_tool(
                "trailhead.search_places",
                {"query": "food near Moab", "category": "food", "limit": 3},
                _admin_user(),
            )

        self.assertTrue(response["ok"])
        self.assertEqual(response["tool"], "trailhead.search_places")
        self.assertEqual(response["_trailhead"]["tool_contract"], server.TRAILHEAD_COPILOT_TOOL_CONTRACT_VERSION)
        self.assertEqual(response["places"][0]["name"], "Moab Diner")
        self.assertTrue(response["temporary_use_only"])

    async def test_execute_route_preview_accepts_locations_alias(self):
        directions = {
            "routes": [
                {
                    "distance": 1609.344,
                    "duration": 180,
                    "geometry": {"type": "LineString", "coordinates": [[-109.55, 38.56], [-109.5, 38.6]]},
                }
            ],
            "waypoints": [],
        }
        with (
            patch.object(server, "_mapbox_get", new=AsyncMock(return_value=directions)),
            patch.object(server, "log_extreme_ledger_event", new=Mock(return_value=102)),
        ):
            response = await server._execute_trailhead_tool(
                "route_preview",
                {"locations": [{"lat": 38.56, "lng": -109.55}, {"lat": 38.6, "lng": -109.5}], "units": "miles"},
                _admin_user(),
            )

        self.assertEqual(response["tool"], "trailhead.route_preview")
        self.assertAlmostEqual(response["route_build"]["trip"]["summary"]["length"], 1.0, places=3)
        self.assertEqual(response["directions"]["_trailhead"]["engine"], "mapbox-directions")

    async def test_execute_discovery_context_wraps_pack_response(self):
        camps = [_camp("pack:1", "Pack Camp 1"), _camp("pack:2", "Pack Camp 2", 38.57, -109.54), _camp("pack:3", "Pack Camp 3", 38.58, -109.53)]
        pack_result = {
            "raw_camps": camps,
            "camps": camps,
            "source_counts": {"pack": len(camps), "pack_regions": 1},
            "pack": {"status": "ready", "regions": ["ut"], "missing_regions": [], "stale_regions": []},
        }
        with (
            patch.object(server, "_load_camp_pack_area", new=AsyncMock(return_value=pack_result)),
            patch.object(server, "_load_camp_discovery_area", new=AsyncMock()) as live,
            patch.object(server, "get_cached", new=Mock()),
            patch.object(server, "set_cached", new=Mock()),
            patch.object(server, "log_extreme_ledger_event", new=Mock(return_value=103)),
        ):
            response = await server._execute_trailhead_tool(
                "discovery_context",
                {
                    "bounds": {"n": 38.65, "s": 38.45, "e": -109.35, "w": -109.75},
                    "categories": ["camp"],
                    "surface": "copilot_test",
                    "mode": "light",
                    "limit": 3,
                },
                _admin_user(),
            )

        live.assert_not_awaited()
        self.assertTrue(response["ok"])
        self.assertEqual(response["tool"], "trailhead.discovery_context")
        self.assertEqual(response["cache"]["status"], "pack")
        self.assertEqual([camp["name"] for camp in response["camps"]], ["Pack Camp 1", "Pack Camp 2", "Pack Camp 3"])

    async def test_invalid_tool_and_args_raise_http_exception(self):
        with self.assertRaises(HTTPException):
            await server._execute_trailhead_tool("bad_tool", {}, _admin_user())
        with self.assertRaises(HTTPException):
            await server._execute_trailhead_tool("reverse_geocode", {"lat": 38.5}, _admin_user())

    def test_copilot_actions_include_bridge_metadata(self):
        search = server._build_extreme_map_action("find pizza near Moab", {"map": {"center": {"lat": 38.5, "lng": -109.5}}})
        route = server._build_extreme_map_action("route me there", {"map": {"selected_place": {"name": "Camp", "lat": 38.5, "lng": -109.5}}})
        camps = server._build_extreme_map_action("find camps near Moab", {"map": {"center": {"lat": 38.5, "lng": -109.5}}})

        self.assertEqual(search["args"]["tool_bridge"]["tool"], "trailhead.search_places")
        self.assertEqual(route["args"]["tool_bridge"]["tool"], "trailhead.route_preview")
        self.assertEqual(camps["args"]["tool_bridge"]["tool"], "trailhead.discovery_context")


if __name__ == "__main__":
    unittest.main()
