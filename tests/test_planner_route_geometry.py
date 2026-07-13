import asyncio
import json
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import anthropic
from fastapi import HTTPException, Request

from ai import planner
from config.settings import settings
import dashboard.route_enrichment as route_enrichment
import dashboard.server as server
from db import store


class PlannerRouteGeometryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._to_thread_patch = patch.object(
            server.asyncio,
            "to_thread",
            AsyncMock(side_effect=lambda fn, *args, **kwargs: fn(*args, **kwargs)),
        )
        self._to_thread_patch.start()
        self.addCleanup(self._to_thread_patch.stop)

    async def test_planner_route_uses_route_proxy_contract_and_decodes_all_legs(self):
        first_leg = [[-109.5498, 38.5733], [-109.43, 38.61], [-109.38, 38.63]]
        second_leg = [[-109.38, 38.63], [-109.31, 38.66]]
        captured = {}

        async def fake_route_proxy(body):
            captured["body"] = body
            return {
                "trip": {
                    "status": 0,
                    "summary": {"length": 18.5, "time": 2100},
                    "legs": [
                        {
                            "shape": server._encode_polyline6(first_leg),
                            "maneuvers": [{
                                "type": 1,
                                "instruction": "Head east",
                                "verbal_pre_transition_instruction": "Head east",
                                "street_names": ["Main Street"],
                                "length": 10,
                                "time": 900,
                                "begin_shape_index": 0,
                            }],
                        },
                        {
                            "shape": server._encode_polyline6(second_leg),
                            "maneuvers": [{
                                "type": 4,
                                "instruction": "Arrive at camp",
                                "street_names": [],
                                "length": 8.5,
                                "time": 1200,
                                "begin_shape_index": 1,
                            }],
                        },
                    ],
                },
                "_trailhead": {"engine": "valhalla", "cache": "miss"},
            }

        waypoints = [
            {"day": 1, "name": "Start", "type": "start", "lat": 38.5733, "lng": -109.5498},
            {"day": 1, "name": "Duplicate", "type": "waypoint", "lat": 38.5733, "lng": -109.5498},
            {"day": 1, "name": "Saved viewpoint", "type": "waypoint", "lat": 38.7, "lng": -109.7, "route_point_type": "side_stop"},
            {"day": 1, "name": "Backroad junction", "type": "town", "lat": 38.61, "lng": -109.43, "route_point_type": "through"},
            {"day": 1, "name": "Overnight", "type": "camp", "lat": 38.63, "lng": -109.38, "route_point_type": "break"},
            {"day": 2, "name": "Finish", "type": "camp", "lat": 38.66, "lng": -109.31},
        ]
        with patch.object(server, "route_proxy", side_effect=fake_route_proxy):
            geometry = await server._planner_route_geometry(waypoints, route_style="adventure")

        self.assertIsNotNone(geometry)
        self.assertEqual(geometry["coords"], [*first_leg, second_leg[-1]])
        self.assertAlmostEqual(geometry["totalDistance"], 18.5 * 1609.344)
        self.assertEqual(geometry["totalDuration"], 2100)
        self.assertEqual(geometry["source"], "valhalla")
        self.assertEqual(geometry["confidence"], "high")
        self.assertEqual(geometry["routeStyle"], "wild")
        self.assertEqual(
            geometry["waypointSignature"],
            "-109.54980,38.57330:1:start:break|"
            "-109.54980,38.57330:1:waypoint:break|"
            "-109.70000,38.70000:1:waypoint:side_stop|"
            "-109.43000,38.61000:1:town:through|"
            "-109.38000,38.63000:1:camp:break|"
            "-109.31000,38.66000:2:camp:break",
        )
        self.assertEqual(
            geometry["routableWaypointSignature"],
            server._planner_waypoint_signature(waypoints, routable_only=True),
        )
        body = captured["body"]
        self.assertIsInstance(body, server.RouteRequest)
        self.assertEqual(len(body.locations), 4)
        self.assertEqual([location["type"] for location in body.locations], ["break", "through", "break", "break"])
        self.assertEqual(body.units, "miles")
        self.assertTrue(body.options.backRoads)
        self.assertTrue(body.options.avoidHighways)
        self.assertTrue(body.options.avoidTolls)
        self.assertFalse(body.options.noFerries)
        self.assertEqual([step["type"] for step in geometry["steps"]], ["depart", "arrive"])
        self.assertEqual(len(geometry["legs"]), 2)
        self.assertEqual(geometry["steps"][0]["name"], "Main Street")
        self.assertEqual(geometry["steps"][1]["instruction"], "Arrive at camp")

    async def test_planner_route_rejects_any_unlocated_required_anchor(self):
        waypoints = [
            {"day": 1, "name": "Start", "type": "start", "lat": 38.0, "lng": -109.0},
            {"day": 1, "name": "Optional view", "type": "waypoint", "lat": None, "lng": None, "route_point_type": "side_stop"},
            {"day": 1, "name": "Missing camp", "type": "camp", "lat": None, "lng": None, "route_point_type": "break"},
            {"day": 2, "name": "Finish", "type": "camp", "lat": 39.0, "lng": -108.0},
        ]
        with patch.object(server, "route_proxy", AsyncMock()) as route_mock:
            self.assertIsNone(await server._planner_route_geometry(waypoints))
        route_mock.assert_not_awaited()
        validation = server._validate_route_waypoints(waypoints)
        self.assertFalse(validation["ok"])
        self.assertIn("Missing camp", " ".join(validation["details"]))

    def test_matching_signature_still_requires_valid_geometry(self):
        waypoints = [
            {"day": 1, "name": "Start", "type": "start", "lat": 38.0, "lng": -109.0},
            {"day": 2, "name": "Finish", "type": "camp", "lat": 39.0, "lng": -108.0},
        ]
        signature = server._planner_waypoint_signature(waypoints, routable_only=True)
        self.assertFalse(server._planner_geometry_matches_waypoints(
            {"coords": [], "routableWaypointSignature": signature},
            waypoints,
        ))
        self.assertFalse(server._planner_geometry_matches_waypoints(
            {"coords": [[-120.0, 45.0], [-119.0, 46.0]]},
            waypoints,
        ))
        self.assertFalse(server._planner_geometry_matches_waypoints(
            {
                "coords": [[-120.0, 45.0], [-119.0, 46.0]],
                "routableWaypointSignature": signature,
            },
            waypoints,
        ))

    def test_geometry_rejects_continent_scale_coordinate_jump(self):
        self.assertFalse(server._planner_geometry_is_valid({
            "coords": [[-105.0, 39.7], [0.0, 0.0]],
        }))

    async def test_planner_route_returns_none_when_provider_fails(self):
        waypoints = [
            {"lat": 38.5733, "lng": -109.5498},
            {"lat": 38.66, "lng": -109.31},
        ]
        with patch.object(server, "route_proxy", AsyncMock(side_effect=HTTPException(502, "No route"))):
            geometry = await server._planner_route_geometry(waypoints)

        self.assertIsNone(geometry)

    async def test_planner_route_rejects_partial_invalid_and_discontinuous_legs(self):
        waypoints = [
            {"day": 1, "type": "start", "lat": 38.0, "lng": -109.0, "route_point_type": "break"},
            {"day": 1, "type": "camp", "lat": 38.5, "lng": -108.5, "route_point_type": "break"},
            {"day": 2, "type": "camp", "lat": 39.0, "lng": -108.0, "route_point_type": "break"},
        ]
        first = [[-109.0, 38.0], [-108.5, 38.5]]
        second = [[-108.5, 38.5], [-108.0, 39.0]]
        responses = [
            {
                "trip": {"status": 0, "legs": [{"shape": server._encode_polyline6(first)}]},
                "_trailhead": {"engine": "valhalla"},
            },
            {
                "trip": {
                    "status": 0,
                    "legs": [
                        {"shape": server._encode_polyline6(first)},
                        {"shape": ""},
                    ],
                },
                "_trailhead": {"engine": "valhalla"},
            },
            {
                "trip": {
                    "status": 0,
                    "legs": [
                        {"shape": server._encode_polyline6(first)},
                        {"shape": server._encode_polyline6([[-105.0, 40.0], *second[1:]])},
                    ],
                },
                "_trailhead": {"engine": "valhalla"},
            },
        ]
        for response in responses:
            with self.subTest(response=response):
                with patch.object(server, "route_proxy", AsyncMock(return_value=response)):
                    self.assertIsNone(await server._planner_route_geometry(waypoints))

    def test_route_roles_are_explicit_and_legacy_values_default_to_break(self):
        normalized = planner._normalize_plan({
            "trip_name": "Roles",
            "duration_days": 2,
            "waypoints": [
                {"day": 1, "name": "Start", "type": "start", "route_point_type": "side_stop"},
                {"day": 1, "name": "Pass", "type": "waypoint", "route_point_type": "through"},
                {"day": 1, "name": "Fuel", "type": "fuel", "route_point_type": "unknown"},
                {"day": 2, "name": "Camp", "type": "camp", "route_point_type": "side_stop"},
            ],
            "daily_itinerary": [
                {"day": 1, "est_miles": 50},
                {"day": 2, "est_miles": 50},
            ],
            "logistics": {},
        })

        self.assertEqual(
            [waypoint["route_point_type"] for waypoint in normalized["waypoints"]],
            ["break", "through", "break", "break"],
        )

    def test_dense_enrichment_geometry_is_simplified_capped_and_preindexed(self):
        dense_coords = [
            [-109.0 + (0.002 if index % 2 else 0.0), 38.0 + index * 0.00002]
            for index in range(6000)
        ]
        indexed = route_enrichment._route_geometry_points({"coords": dense_coords})

        self.assertIsInstance(indexed, route_enrichment._IndexedRoute)
        self.assertLessEqual(len(indexed), route_enrichment._ENRICHMENT_ROUTE_MAX_POINTS)
        self.assertEqual(indexed[0], {"lat": dense_coords[0][1], "lng": dense_coords[0][0]})
        self.assertEqual(indexed[-1], {"lat": dense_coords[-1][1], "lng": dense_coords[-1][0]})
        self.assertEqual(len(indexed.segment_lengths_mi), len(indexed) - 1)
        self.assertEqual(len(indexed.cumulative_mi), len(indexed))
        self.assertAlmostEqual(indexed.total_mi, indexed.cumulative_mi[-1])

        straight = [[-109.0 + index * 0.00001, 38.0] for index in range(1000)]
        simplified = route_enrichment._route_geometry_points({"coords": straight})
        self.assertLess(len(simplified), len(straight) // 4)

    async def test_enrichment_uses_provider_geometry_for_corridor_scoring(self):
        waypoints = [
            {"name": "Start", "day": 1, "lat": 38.0, "lng": -109.0, "type": "start"},
            {"name": "Finish", "day": 2, "lat": 39.0, "lng": -108.0, "type": "waypoint"},
        ]
        geometry = {
            "coords": [
                [-109.0, 38.0],
                [-108.9, 38.1],
                [-108.2, 38.9],
                [-108.0, 39.0],
            ]
        }
        seen = {}

        async def camps(_waypoints, route, style):
            seen["camps"] = (route, style)
            return []

        async def gas(_waypoints, route):
            seen["gas"] = route
            return []

        async def pois(_waypoints, route):
            seen["pois"] = route
            return []

        with (
            patch.object(route_enrichment, "_route_camps", side_effect=camps),
            patch.object(route_enrichment, "_route_gas", side_effect=gas),
            patch.object(route_enrichment, "_route_pois", side_effect=pois),
        ):
            result = await route_enrichment.enrich_trip_along_route(
                waypoints,
                route_style="wild",
                route_geometry=geometry,
            )

        expected_route = [
            {"lat": 38.0, "lng": -109.0},
            {"lat": 38.1, "lng": -108.9},
            {"lat": 38.9, "lng": -108.2},
            {"lat": 39.0, "lng": -108.0},
        ]
        self.assertEqual(seen["camps"], (expected_route, "wild"))
        self.assertEqual(seen["gas"], expected_route)
        self.assertEqual(seen["pois"], expected_route)
        self.assertEqual(result["waypoints"], waypoints)

    async def test_plan_job_saves_and_returns_route_geometry(self):
        geocoded = [
            {"name": "Start", "day": 1, "lat": 38.0, "lng": -109.0, "type": "start"},
            {"name": "Finish", "day": 2, "lat": 39.0, "lng": -108.0, "type": "waypoint"},
        ]
        route_geometry = {
            "coords": [[-109.0, 38.0], [-108.5, 38.4], [-108.0, 39.0]],
            "totalDistance": 1000,
            "totalDuration": 600,
            "source": "valhalla",
            "ts": 123,
        }
        plan = {
            "trip_name": "Test route",
            "duration_days": 2,
            "states": ["UT"],
            "waypoints": geocoded,
            "daily_itinerary": [],
            "logistics": {},
        }
        enrichment = {
            "waypoints": geocoded,
            "campsites": [],
            "gas_stations": [],
            "route_pois": [],
        }
        completed = {}

        def capture_job(_job_id, status, result=None, error=None):
            if status == "done":
                completed["result"] = json.loads(result)

        saved = []

        def capture_save(_id, _request, value, user_id=None, route_geometry=None):
            saved.append({"trip": value, "route_geometry": route_geometry})

        with (
            patch.object(server, "update_plan_job", side_effect=capture_job),
            patch.object(server, "plan_trip", return_value=plan),
            patch.object(server, "save_trip", side_effect=capture_save),
            patch.object(server, "log_event"),
            patch.object(server, "_geocode_waypoints", AsyncMock(return_value=geocoded)),
            patch.object(server, "_planner_route_geometry", AsyncMock(return_value=route_geometry)),
            patch.object(server, "enrich_trip_along_route", AsyncMock(return_value=enrichment)) as enrich_mock,
        ):
            await server._execute_plan_job(
                "job-geometry",
                server.PlanRequest(request="Two days in Utah", route_style="wild"),
                None,
                0,
            )

        self.assertEqual(completed["result"]["route_geometry"], route_geometry)
        self.assertNotIn("route_geometry", saved[-1]["trip"])
        self.assertEqual(saved[-1]["route_geometry"], route_geometry)
        self.assertEqual(enrich_mock.await_args.kwargs["route_geometry"], route_geometry)

    async def test_plan_job_route_failure_refunds_and_never_saves(self):
        geocoded = [
            {"name": "Start", "day": 1, "lat": 38.0, "lng": -109.0, "type": "start"},
            {"name": "Finish", "day": 2, "lat": 39.0, "lng": -108.0, "type": "camp"},
        ]
        plan = {
            "trip_name": "Unroutable",
            "duration_days": 2,
            "states": ["UT"],
            "waypoints": geocoded,
            "daily_itinerary": [{"day": 1}, {"day": 2}],
            "logistics": {},
        }
        failed = {}

        def capture_job(_job_id, status, result=None, error=None):
            if status == "failed":
                failed["error"] = error

        with (
            patch.object(server, "update_plan_job", side_effect=capture_job),
            patch.object(server, "plan_trip", return_value=plan),
            patch.object(server, "_plan_credit_cost", return_value=5),
            patch.object(server, "_geocode_waypoints", AsyncMock(return_value=geocoded)),
            patch.object(server, "_planner_route_geometry", AsyncMock(return_value=None)),
            patch.object(server, "save_trip") as save_mock,
            patch.object(server, "add_credits") as refund_mock,
            patch.object(server, "enrich_trip_along_route", AsyncMock()) as enrich_mock,
        ):
            await server._execute_plan_job(
                "job-no-route",
                server.PlanRequest(request="A 2-day Utah trip"),
                {"id": 42},
                5,
            )

        self.assertEqual(failed["error"], server.TRIP_PLANNER_UNAVAILABLE)
        save_mock.assert_not_called()
        enrich_mock.assert_not_awaited()
        refund_mock.assert_called_once_with(42, 5, "Refund — planning error")

    async def test_longer_generated_trip_charges_extra_before_routing_and_refunds_exact_total(self):
        geocoded = [
            {"name": "Start", "day": 1, "lat": 38.0, "lng": -109.0, "type": "start"},
            {"name": "Finish", "day": 8, "lat": 39.0, "lng": -108.0, "type": "camp"},
        ]
        plan = {
            "trip_name": "Longer route",
            "duration_days": 8,
            "states": ["UT"],
            "waypoints": geocoded,
            "daily_itinerary": [{"day": day} for day in range(1, 9)],
            "logistics": {},
        }
        with (
            patch.object(server, "update_plan_job"),
            patch.object(server, "plan_trip", return_value=plan),
            patch.object(server, "_plan_credit_cost", side_effect=lambda days: 10 if days >= 8 else 5),
            patch.object(server, "deduct_credits", return_value=True) as deduct_mock,
            patch.object(server, "add_credits") as refund_mock,
            patch.object(server, "_geocode_waypoints", AsyncMock(return_value=geocoded)),
            patch.object(server, "_planner_route_geometry", AsyncMock(return_value=None)),
        ):
            await server._execute_plan_job(
                "job-longer-cost",
                server.PlanRequest(request="A 3-day trip that became longer"),
                {"id": 42},
                5,
            )

        deduct_mock.assert_called_once_with(42, 5, "Trip plan adjustment - actual trip is 8 days")
        refund_mock.assert_called_once_with(42, 10, "Refund — planning error")

    async def test_longer_generated_trip_with_insufficient_balance_refunds_initial_charge_once(self):
        plan = {
            "trip_name": "Longer route",
            "duration_days": 8,
            "states": ["UT"],
            "waypoints": [{"name": "Start"}, {"name": "Finish"}],
            "daily_itinerary": [{"day": day} for day in range(1, 9)],
            "logistics": {},
        }
        failed = {}

        def capture_job(_job_id, status, result=None, error=None):
            if status == "failed":
                failed["error"] = error

        with (
            patch.object(server, "update_plan_job", side_effect=capture_job),
            patch.object(server, "plan_trip", return_value=plan),
            patch.object(server, "_plan_credit_cost", side_effect=lambda days: 10 if days >= 8 else 5),
            patch.object(server, "deduct_credits", return_value=False),
            patch.object(server, "add_credits") as refund_mock,
            patch.object(server, "_geocode_waypoints", AsyncMock()) as geocode_mock,
        ):
            await server._execute_plan_job(
                "job-longer-insufficient",
                server.PlanRequest(request="A 3-day trip that became longer"),
                {"id": 42},
                5,
            )

        refund_mock.assert_called_once_with(42, 5, "Refund - trip length changed")
        geocode_mock.assert_not_awaited()
        self.assertIn("needs more credits", failed["error"])

    async def test_saved_trip_is_not_refunded_when_job_completion_status_write_fails(self):
        geocoded = [
            {"name": "Start", "day": 1, "lat": 38.0, "lng": -109.0, "type": "start"},
            {"name": "Finish", "day": 2, "lat": 39.0, "lng": -108.0, "type": "camp"},
        ]
        plan = {
            "trip_name": "Saved route",
            "duration_days": 2,
            "states": ["UT"],
            "waypoints": geocoded,
            "daily_itinerary": [{"day": 1}, {"day": 2}],
            "logistics": {},
        }
        geometry = {"coords": [[-109.0, 38.0], [-108.0, 39.0]], "totalDistance": 1000, "totalDuration": 100}
        enrichment = {"waypoints": geocoded, "campsites": [], "gas_stations": [], "route_pois": []}

        def fail_completion(_job_id, status, result=None, error=None):
            if status == "done":
                raise RuntimeError("status store unavailable")

        with (
            patch.object(server, "update_plan_job", side_effect=fail_completion),
            patch.object(server, "plan_trip", return_value=plan),
            patch.object(server, "_plan_credit_cost", return_value=5),
            patch.object(server, "_geocode_waypoints", AsyncMock(return_value=geocoded)),
            patch.object(server, "_planner_route_geometry", AsyncMock(return_value=geometry)),
            patch.object(server, "enrich_trip_along_route", AsyncMock(return_value=enrichment)),
            patch.object(server, "save_trip") as save_mock,
            patch.object(server, "log_event"),
            patch.object(server, "get_push_token", return_value=None),
            patch.object(server, "add_credits") as refund_mock,
        ):
            await server._execute_plan_job(
                "job-completion-fails",
                server.PlanRequest(request="A 2-day trip"),
                {"id": 42},
                5,
            )

        save_mock.assert_called_once()
        refund_mock.assert_not_called()

    async def test_edit_preserves_matching_geometry_without_rerouting(self):
        waypoints = [
            {"day": 1, "name": "Start", "lat": 38.0, "lng": -109.0, "type": "start", "route_point_type": "break"},
            {"day": 2, "name": "Finish", "lat": 39.0, "lng": -108.0, "type": "camp", "route_point_type": "break"},
        ]
        prior_geometry = {"coords": [[-109.0, 38.0], [-108.0, 39.0]], "source": "valhalla", "ts": 10}
        current_trip = {
            "trip_id": "trip-edit",
            "plan": {"waypoints": waypoints, "route_preferences": {"route_style": "balanced"}},
            "route_geometry": prior_geometry,
            "builder_state": {"tripShapeMode": "there_and_back", "stops": waypoints},
            "audio_guide": {"start": "Welcome to the route."},
        }
        edited_plan = {
            "waypoints": waypoints,
            "route_preferences": {"route_style": "balanced"},
            "daily_itinerary": [],
        }
        enrichment = {"waypoints": waypoints, "campsites": [], "gas_stations": [], "route_pois": []}
        request = Request({"type": "http", "method": "POST", "path": "/api/chat", "headers": [], "client": ("127.0.0.1", 1234)})

        with (
            patch.object(settings, "anthropic_api_key", "test-key"),
            patch.object(server, "_anon_check"),
            patch.object(server, "get_trip", return_value=None),
            patch.object(server, "get_conversation", return_value=[]),
            patch.object(server, "get_trail_dna", return_value={}),
            patch.object(server, "save_conversation"),
            patch.object(server, "_trip_edit_clarification", return_value=None),
            patch.object(server, "edit_trip", return_value={"message": "Notes updated.", "trip": edited_plan}),
            patch.object(server, "_geocode_waypoints", AsyncMock(return_value=waypoints)),
            patch.object(server, "_planner_route_geometry", AsyncMock()) as route_mock,
            patch.object(server, "enrich_trip_along_route", AsyncMock(return_value=enrichment)),
            patch.object(server, "_build_trip_timeline", return_value=[]),
            patch.object(server, "save_trip") as save_mock,
        ):
            response = await server.chat_endpoint(
                request,
                server.ChatRequest(message="Update the notes", session_id="edit-session", current_trip=current_trip),
                None,
            )

        route_mock.assert_not_awaited()
        self.assertEqual(response["trip"]["route_geometry"]["coords"], prior_geometry["coords"])
        self.assertNotIn("route_geometry", save_mock.call_args.args[2])
        self.assertEqual(save_mock.call_args.kwargs["route_geometry"]["coords"], prior_geometry["coords"])
        self.assertEqual(response["trip"]["builder_state"], current_trip["builder_state"])
        self.assertEqual(response["trip"]["audio_guide"], current_trip["audio_guide"])
        self.assertEqual(save_mock.call_args.kwargs["builder_state"], current_trip["builder_state"])
        self.assertEqual(save_mock.call_args.kwargs["audio_guide"], current_trip["audio_guide"])

    async def test_side_stop_edit_reuses_geometry_but_clears_builder_state_and_audio(self):
        prior_waypoints = [
            {"day": 1, "name": "Start", "lat": 38.0, "lng": -109.0, "type": "start", "route_point_type": "break"},
            {"day": 1, "name": "Old view", "lat": 38.4, "lng": -108.8, "type": "waypoint", "route_point_type": "side_stop"},
            {"day": 2, "name": "Finish", "lat": 39.0, "lng": -108.0, "type": "camp", "route_point_type": "break"},
        ]
        edited_waypoints = [prior_waypoints[0], {**prior_waypoints[1], "name": "New view"}, prior_waypoints[2]]
        prior_geometry = {
            "coords": [[-109.0, 38.0], [-108.0, 39.0]],
            "routableWaypointSignature": server._planner_waypoint_signature(prior_waypoints, routable_only=True),
        }
        current_trip = {
            "trip_id": "trip-side-stop",
            "plan": {"waypoints": prior_waypoints, "route_preferences": {"route_style": "balanced"}},
            "route_geometry": prior_geometry,
            "builder_state": {"stops": prior_waypoints},
            "audio_guide": {"old-view": "Turn toward the viewpoint."},
        }
        enrichment = {"waypoints": edited_waypoints, "campsites": [], "gas_stations": [], "route_pois": []}
        request = Request({"type": "http", "method": "POST", "path": "/api/chat", "headers": [], "client": ("127.0.0.1", 1234)})

        self.assertEqual(
            server._planner_waypoint_signature(prior_waypoints, routable_only=True),
            server._planner_waypoint_signature(edited_waypoints, routable_only=True),
        )
        self.assertNotEqual(
            server._planner_waypoint_semantic_signature(prior_waypoints),
            server._planner_waypoint_semantic_signature(edited_waypoints),
        )

        with (
            patch.object(settings, "anthropic_api_key", "test-key"),
            patch.object(server, "_anon_check"),
            patch.object(server, "get_trip", return_value=None),
            patch.object(server, "get_conversation", return_value=[]),
            patch.object(server, "get_trail_dna", return_value={}),
            patch.object(server, "save_conversation"),
            patch.object(server, "_trip_edit_clarification", return_value=None),
            patch.object(server, "edit_trip", return_value={"message": "Viewpoint updated.", "trip": {"waypoints": edited_waypoints}}),
            patch.object(server, "_geocode_waypoints", AsyncMock(return_value=edited_waypoints)),
            patch.object(server, "_planner_route_geometry", AsyncMock()) as route_mock,
            patch.object(server, "enrich_trip_along_route", AsyncMock(return_value=enrichment)),
            patch.object(server, "_build_trip_timeline", return_value=[]),
            patch.object(server, "save_trip") as save_mock,
        ):
            response = await server.chat_endpoint(
                request,
                server.ChatRequest(message="Swap the viewpoint", session_id="edit-side-stop", current_trip=current_trip),
                None,
            )

        route_mock.assert_not_awaited()
        self.assertEqual(response["trip"]["route_geometry"]["coords"], prior_geometry["coords"])
        self.assertNotIn("builder_state", response["trip"])
        self.assertNotIn("audio_guide", response["trip"])
        self.assertIsNone(save_mock.call_args.kwargs["builder_state"])
        self.assertIsNone(save_mock.call_args.kwargs["audio_guide"])

    async def test_paid_edit_clarification_model_and_routing_failures_do_not_charge(self):
        user = {"id": 42}
        waypoints = [
            {"day": 1, "name": "Start", "lat": 38.0, "lng": -109.0, "type": "start", "route_point_type": "break"},
            {"day": 2, "name": "Finish", "lat": 39.0, "lng": -108.0, "type": "camp", "route_point_type": "break"},
        ]
        current_trip = {
            "trip_id": "paid-edit-failures",
            "plan": {"waypoints": waypoints, "route_preferences": {"route_style": "balanced"}},
            "route_geometry": {"coords": [[-109.0, 38.0], [-108.0, 39.0]]},
        }
        request = Request({"type": "http", "method": "POST", "path": "/api/chat", "headers": [], "client": ("127.0.0.1", 1234)})

        with (
            patch.object(settings, "anthropic_api_key", "test-key"),
            patch.object(server, "has_active_plan", return_value=False),
            patch.object(server, "get_trip", return_value=None),
            patch.object(server, "get_conversation", return_value=[]),
            patch.object(server, "get_trail_dna", return_value={}),
            patch.object(server, "save_conversation"),
            patch.object(server, "_trip_edit_clarification", return_value="Which stop should change?"),
            patch.object(server, "_check_credits") as charge_mock,
            patch.object(server, "edit_trip") as edit_mock,
        ):
            response = await server.chat_endpoint(
                request,
                server.ChatRequest(message="Change it", session_id="paid-clarification", current_trip=current_trip),
                user,
            )
        self.assertEqual(response["content"], "Which stop should change?")
        charge_mock.assert_not_called()
        edit_mock.assert_not_called()

        with (
            patch.object(settings, "anthropic_api_key", "test-key"),
            patch.object(server, "has_active_plan", return_value=False),
            patch.object(server, "get_trip", return_value=None),
            patch.object(server, "get_conversation", return_value=[]),
            patch.object(server, "get_trail_dna", return_value={}),
            patch.object(server, "_trip_edit_clarification", return_value=None),
            patch.object(server, "_check_credits") as charge_mock,
            patch.object(server, "edit_trip", side_effect=RuntimeError("provider unavailable")),
        ):
            with self.assertRaises(HTTPException) as raised:
                await server.chat_endpoint(
                    request,
                    server.ChatRequest(message="Rename the finish", session_id="paid-model-failure", current_trip=current_trip),
                    user,
                )
        self.assertEqual(raised.exception.status_code, 503)
        charge_mock.assert_not_called()

        moved_waypoints = [waypoints[0], {**waypoints[1], "lat": 40.0}]
        with (
            patch.object(settings, "anthropic_api_key", "test-key"),
            patch.object(server, "has_active_plan", return_value=False),
            patch.object(server, "get_trip", return_value=None),
            patch.object(server, "get_conversation", return_value=[]),
            patch.object(server, "get_trail_dna", return_value={}),
            patch.object(server, "_trip_edit_clarification", return_value=None),
            patch.object(server, "_check_credits") as charge_mock,
            patch.object(server, "edit_trip", return_value={"message": "Finish moved.", "trip": {"waypoints": moved_waypoints}}),
            patch.object(server, "_geocode_waypoints", AsyncMock(return_value=moved_waypoints)),
            patch.object(server, "_planner_route_geometry", AsyncMock(return_value=None)),
        ):
            with self.assertRaises(HTTPException) as raised:
                await server.chat_endpoint(
                    request,
                    server.ChatRequest(message="Move the finish north", session_id="paid-route-failure", current_trip=current_trip),
                    user,
                )
        self.assertEqual(raised.exception.status_code, 503)
        charge_mock.assert_not_called()

    async def test_successful_paid_edit_charges_once_immediately_before_save(self):
        user = {"id": 42}
        waypoints = [
            {"day": 1, "name": "Start", "lat": 38.0, "lng": -109.0, "type": "start", "route_point_type": "break"},
            {"day": 2, "name": "Finish", "lat": 39.0, "lng": -108.0, "type": "camp", "route_point_type": "break"},
        ]
        current_trip = {
            "trip_id": "paid-edit-success",
            "plan": {"waypoints": waypoints, "route_preferences": {"route_style": "balanced"}},
            "route_geometry": {
                "coords": [[-109.0, 38.0], [-108.0, 39.0]],
                "routableWaypointSignature": server._planner_waypoint_signature(waypoints, routable_only=True),
            },
        }
        enrichment = {"waypoints": waypoints, "campsites": [], "gas_stations": [], "route_pois": []}
        request = Request({"type": "http", "method": "POST", "path": "/api/chat", "headers": [], "client": ("127.0.0.1", 1234)})
        calls = []

        with (
            patch.object(settings, "anthropic_api_key", "test-key"),
            patch.object(server, "has_active_plan", return_value=False),
            patch.object(server, "get_trip", return_value=None),
            patch.object(server, "get_conversation", return_value=[]),
            patch.object(server, "get_trail_dna", return_value={}),
            patch.object(server, "save_conversation"),
            patch.object(server, "_trip_edit_clarification", return_value=None),
            patch.object(server, "edit_trip", return_value={"message": "Notes updated.", "trip": {"waypoints": waypoints}}),
            patch.object(server, "_geocode_waypoints", AsyncMock(return_value=waypoints)),
            patch.object(server, "enrich_trip_along_route", AsyncMock(return_value=enrichment)),
            patch.object(server, "_build_trip_timeline", return_value=[]),
            patch.object(server, "_check_credits", side_effect=lambda *_args: calls.append("charge")) as charge_mock,
            patch.object(server, "save_trip", side_effect=lambda *_args, **_kwargs: calls.append("save")) as save_mock,
        ):
            response = await server.chat_endpoint(
                request,
                server.ChatRequest(message="Update the notes", session_id="paid-edit-success", current_trip=current_trip),
                user,
            )

        self.assertEqual(response["type"], "trip_update")
        charge_mock.assert_called_once_with(user, server.AI_COSTS["chat_edit"], "Trip guidance")
        save_mock.assert_called_once()
        self.assertEqual(calls, ["charge", "save"])

    async def test_route_changing_edit_failure_does_not_save(self):
        prior_waypoints = [
            {"day": 1, "name": "Start", "lat": 38.0, "lng": -109.0, "type": "start", "route_point_type": "break"},
            {"day": 2, "name": "Old finish", "lat": 39.0, "lng": -108.0, "type": "camp", "route_point_type": "break"},
        ]
        edited_waypoints = [prior_waypoints[0], {**prior_waypoints[1], "name": "New finish", "lat": 40.0}]
        current_trip = {
            "trip_id": "trip-edit-fail",
            "plan": {"waypoints": prior_waypoints, "route_preferences": {"route_style": "balanced"}},
            "route_geometry": {"coords": [[-109.0, 38.0], [-108.0, 39.0]], "source": "valhalla"},
        }
        request = Request({"type": "http", "method": "POST", "path": "/api/chat", "headers": [], "client": ("127.0.0.1", 1234)})

        with (
            patch.object(settings, "anthropic_api_key", "test-key"),
            patch.object(server, "_anon_check"),
            patch.object(server, "get_trip", return_value=None),
            patch.object(server, "get_conversation", return_value=[]),
            patch.object(server, "get_trail_dna", return_value={}),
            patch.object(server, "save_conversation"),
            patch.object(server, "_trip_edit_clarification", return_value=None),
            patch.object(server, "edit_trip", return_value={"message": "Finish moved.", "trip": {"waypoints": edited_waypoints}}),
            patch.object(server, "_geocode_waypoints", AsyncMock(return_value=edited_waypoints)),
            patch.object(server, "_planner_route_geometry", AsyncMock(return_value=None)),
            patch.object(server, "save_trip") as save_mock,
        ):
            with self.assertRaises(HTTPException) as raised:
                await server.chat_endpoint(
                    request,
                    server.ChatRequest(message="Move the finish north", session_id="edit-fail", current_trip=current_trip),
                    None,
                )

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, server.TRIP_PLANNER_UNAVAILABLE)
        save_mock.assert_not_called()

    async def test_plan_job_does_not_expose_provider_account_error(self):
        failed = {}

        def capture_job(_job_id, status, result=None, error=None):
            if status == "failed":
                failed["error"] = error

        with (
            patch.object(server, "update_plan_job", side_effect=capture_job),
            patch.object(server, "plan_trip", side_effect=RuntimeError("credit balance is too low: provider account 123")),
        ):
            await server._execute_plan_job(
                "job-provider-error",
                server.PlanRequest(request="Plan a Utah trip"),
                None,
                0,
            )

        self.assertEqual(failed["error"], server.TRIP_PLANNER_UNAVAILABLE)
        self.assertNotIn("credit balance", failed["error"].lower())

    def test_failure_log_uses_only_context_and_exception_class(self):
        with patch.object(server.logger, "warning") as warning:
            server._log_planner_failure(
                "plan_job",
                RuntimeError("provider secret account=123 token=private"),
            )

        fmt, *args = warning.call_args.args
        rendered = fmt % tuple(args)
        self.assertEqual(rendered, "planner_failure context=plan_job exception_class=RuntimeError")
        self.assertNotIn("provider secret", rendered)

    async def test_chat_does_not_expose_provider_account_error(self):
        request = Request({
            "type": "http",
            "method": "POST",
            "path": "/api/chat",
            "headers": [],
            "client": ("127.0.0.1", 1234),
        })
        with (
            patch.object(settings, "anthropic_api_key", "test-key"),
            patch.object(server, "_anon_check"),
            patch.object(server, "get_conversation", return_value=[]),
            patch.object(server, "get_trail_dna", return_value={}),
            patch.object(server, "chat_guide", side_effect=RuntimeError("credit balance is too low: provider account 123")),
        ):
            with self.assertRaises(HTTPException) as raised:
                await server.chat_endpoint(
                    request,
                    server.ChatRequest(message="Plan a trip", session_id="session-test"),
                    None,
                )

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, server.TRIP_PLANNER_UNAVAILABLE)
        self.assertNotIn("credit balance", str(raised.exception.detail).lower())

    async def test_chat_preserves_rate_limit_response(self):
        class FakeRateLimitError(Exception):
            pass

        request = Request({
            "type": "http",
            "method": "POST",
            "path": "/api/chat",
            "headers": [],
            "client": ("127.0.0.1", 1234),
        })
        with (
            patch.object(settings, "anthropic_api_key", "test-key"),
            patch.object(anthropic, "RateLimitError", FakeRateLimitError),
            patch.object(server, "_anon_check"),
            patch.object(server, "get_conversation", return_value=[]),
            patch.object(server, "get_trail_dna", return_value={}),
            patch.object(server, "chat_guide", side_effect=FakeRateLimitError()),
        ):
            with self.assertRaises(HTTPException) as raised:
                await server.chat_endpoint(
                    request,
                    server.ChatRequest(message="Plan a trip", session_id="session-test"),
                    None,
                )

        self.assertEqual(raised.exception.status_code, 429)

    async def test_plan_refunds_when_job_creation_fails(self):
        request = Request({
            "type": "http",
            "method": "POST",
            "path": "/api/plan",
            "headers": [],
            "client": ("127.0.0.1", 1234),
        })
        user = {"id": 42, "is_admin": False}

        with (
            patch.object(settings, "anthropic_api_key", "test-key"),
            patch.object(server, "has_extreme_plan", return_value=False),
            patch.object(server, "_plan_credit_cost", return_value=5),
            patch.object(server, "deduct_credits", return_value=True) as deduct_mock,
            patch.object(server, "create_plan_job", side_effect=RuntimeError("job store unavailable")),
            patch.object(server, "add_credits") as refund_mock,
            patch.object(server, "_log_planner_failure"),
        ):
            with self.assertRaises(HTTPException) as raised:
                await server.plan(
                    request,
                    server.PlanRequest(request="A 3-day Utah trip", session_id="plan-create-failure"),
                    user,
                )

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, server.TRIP_PLANNER_UNAVAILABLE)
        deduct_mock.assert_called_once_with(42, 5, "Trip plan (~3d)")
        refund_mock.assert_called_once_with(42, 5, "Refund - trip planning could not start")

    async def test_plan_job_poll_recovers_saved_trip_left_in_saving_status(self):
        result = {
            "trip_id": "saved-plan-trip",
            "plan": {"trip_name": "Saved plan"},
            "route_geometry": {"coords": [[-109.0, 38.0], [-108.0, 39.0]]},
        }
        serialized = json.dumps(result)
        job = {
            "id": "saving-job",
            "user_id": 42,
            "status": "saving",
            "result": serialized,
            "error": None,
        }
        with (
            patch.object(server, "get_plan_job", return_value=job),
            patch.object(server, "get_trip", return_value={"trip_id": "saved-plan-trip", "user_id": 42}),
            patch.object(server, "update_plan_job") as update_mock,
        ):
            response = await server.plan_job_status("saving-job", {"id": 42})

        self.assertEqual(response["status"], "done")
        self.assertEqual(response["result"], result)
        update_mock.assert_called_once_with("saving-job", "done", result=serialized)

    async def test_direct_geometry_update_rejects_malformed_and_mismatched_routes(self):
        user = {"id": 42}
        waypoints = [
            {"day": 1, "name": "Start", "lat": 38.0, "lng": -109.0, "type": "start"},
            {"day": 2, "name": "Finish", "lat": 39.0, "lng": -108.0, "type": "camp"},
        ]

        with patch.object(server, "save_trip_geometry") as save_mock:
            with self.assertRaises(HTTPException) as raised:
                await server.update_trip_geometry(
                    "geometry-trip",
                    server.RouteGeometryRequest(route_geometry={"coords": []}),
                    user,
                )
        self.assertEqual(raised.exception.status_code, 422)
        save_mock.assert_not_called()

        mismatched_geometry = {
            "coords": [[-120.0, 45.0], [-119.0, 46.0]],
            "routableWaypointSignature": server._planner_waypoint_signature(waypoints, routable_only=True),
        }
        with (
            patch.object(server, "get_trip", return_value={
                "trip_id": "geometry-trip",
                "user_id": 42,
                "plan": {"waypoints": waypoints},
            }),
            patch.object(server, "get_trip_document_v2", return_value=None),
            patch.object(server, "save_trip_geometry") as save_mock,
        ):
            with self.assertRaises(HTTPException) as raised:
                await server.update_trip_geometry(
                    "geometry-trip",
                    server.RouteGeometryRequest(route_geometry=mismatched_geometry),
                    user,
                )
        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("does not match", str(raised.exception.detail))
        save_mock.assert_not_called()


class PlannerGeometryPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()
        self.owner = store.create_user("route-owner@example.com", "route_owner", "hash", "route-owner-code")
        self.other = store.create_user("route-other@example.com", "route_other", "hash", "route-other-code")

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    def _create_v2_trip(self, trip_id: str, expected_revision: int = 0) -> dict:
        document = {
            "schema_version": 2,
            "trip_id": trip_id,
            "status": "active",
            "title": "Original V2 trip",
            "summary": "Keep the V2 planning details.",
            "regions": ["Colorado"],
            "dates": {"start": "2026-09-10", "end": "2026-09-13"},
            "rig_snapshot": {"name": "Scout", "range_miles": 320},
            "route": {"coords": [[-105.0, 39.7], [-104.9, 39.8]]},
            "days": [{"day": 1, "title": "Front Range"}],
            "items": [
                {
                    "schema_version": 1,
                    "id": f"{trip_id}:canonical-start",
                    "kind": "start",
                    "title": "Denver",
                    "day": 1,
                    "order": 0,
                    "coordinates": {"lat": 39.7, "lng": -105.0},
                    "facts": {},
                    "created_at": 1,
                    "updated_at": 1,
                },
                {
                    "schema_version": 1,
                    "id": f"{trip_id}:canonical-destination",
                    "kind": "destination",
                    "title": "Front Range camp",
                    "day": 1,
                    "order": 1,
                    "coordinates": {"lat": 39.8, "lng": -104.9},
                    "facts": {},
                    "created_at": 1,
                    "updated_at": 1,
                },
                {
                    "schema_version": 1,
                    "id": f"{trip_id}:v2-only-activity",
                    "kind": "activity",
                    "title": "Museum tickets",
                    "day": 1,
                    "order": 2,
                    "coordinates": {"lat": 38.57, "lng": -109.55},
                    "facts": {"booking_status": "confirmed"},
                    "created_at": 1,
                    "updated_at": 1,
                },
            ],
            "notes": [{"id": "note-1", "body": "Bring the recovery boards."}],
            "readiness": {"status": "review", "fuel": True},
            "bookings": [{"id": "booking-1", "status": "confirmed"}],
            "alerts": [{"id": "alert-1", "kind": "weather"}],
            "offline": {"status": "ready", "pack_id": "pack-1"},
            "visibility": "shared",
            "source": "manual",
            "legacy_v1": {
                "request": "Old route",
                "trip": {
                    "trip_id": trip_id,
                    "plan": {
                        "waypoints": [
                            {"name": "Old start", "type": "start", "lat": 45.0, "lng": -120.0},
                            {"name": "Old finish", "type": "camp", "lat": 46.0, "lng": -119.0},
                        ],
                    },
                },
            },
        }
        return store.upsert_trip_document_v2(
            self.owner,
            trip_id,
            document,
            expected_revision=expected_revision,
            idempotency_key=f"create-{trip_id}",
        )

    def _assert_v2_only_fields_preserved(self, document: dict):
        self.assertEqual(document["status"], "active")
        self.assertEqual(document["dates"], {"start": "2026-09-10", "end": "2026-09-13"})
        self.assertEqual(document["rig_snapshot"], {"name": "Scout", "range_miles": 320})
        self.assertEqual(document["notes"], [{"id": "note-1", "body": "Bring the recovery boards."}])
        self.assertEqual(document["readiness"], {"status": "review", "fuel": True})
        self.assertEqual(document["bookings"], [{"id": "booking-1", "status": "confirmed"}])
        self.assertEqual(document["alerts"], [{"id": "alert-1", "kind": "weather"}])
        self.assertEqual(document["offline"], {"status": "ready", "pack_id": "pack-1"})
        self.assertEqual(document["visibility"], "shared")
        self.assertEqual(document["source"], "manual")
        activity = next(item for item in document["items"] if item.get("kind") == "activity")
        self.assertEqual(activity["title"], "Museum tickets")
        self.assertEqual(activity["facts"], {"booking_status": "confirmed"})

    def test_planner_edit_replaces_dedicated_route_geometry_without_weakening_ownership(self):
        old_geometry = {
            "coords": [[-109.0, 38.0], [-108.9, 38.1]],
            "source": "route-builder",
        }
        new_geometry = {
            "coords": [[-109.0, 38.0], [-108.5, 38.6], [-108.0, 39.0]],
            "source": "valhalla",
        }
        store.save_account_trip(
            "trip-with-stale-line",
            {"trip_id": "trip-with-stale-line", "plan": {"trip_name": "Original"}},
            self.owner,
            route_geometry=old_geometry,
            source="route-builder",
        )

        store.save_trip(
            "trip-with-stale-line",
            "Move the finish",
            {"trip_id": "trip-with-stale-line", "plan": {"trip_name": "Edited"}, "route_geometry": new_geometry},
            user_id=self.owner,
            route_geometry=new_geometry,
        )

        self.assertEqual(store.get_trip("trip-with-stale-line")["route_geometry"], new_geometry)
        db = store._conn()
        row = db.execute(
            "SELECT plan,route_geometry FROM trips WHERE id=?",
            ("trip-with-stale-line",),
        ).fetchone()
        db.close()
        self.assertNotIn("route_geometry", json.loads(row["plan"]))
        self.assertEqual(json.loads(row["route_geometry"]), new_geometry)
        with self.assertRaises(PermissionError):
            store.save_trip(
                "trip-with-stale-line",
                "Unauthorized edit",
                {"trip_id": "trip-with-stale-line", "plan": {"trip_name": "Wrong owner"}},
                user_id=self.other,
                route_geometry=old_geometry,
            )
        self.assertEqual(store.get_trip("trip-with-stale-line")["route_geometry"], new_geometry)

    def test_builder_write_syncs_existing_v2_trip_and_preserves_v2_only_fields(self):
        trip_id = "v2-builder-sync"
        created = self._create_v2_trip(trip_id)
        geometry = {
            "coords": [[-105.0, 39.7], [-109.55, 38.57]],
            "source": "valhalla",
        }
        builder_state = {
            "tripShapeMode": "there_and_back",
            "stops": [{"name": "Denver"}, {"name": "Moab"}],
        }
        builder_trip = {
            "trip_id": trip_id,
            "plan": {
                "trip_name": "Denver to Moab",
                "overview": "A there-and-back route.",
                "states": ["Colorado", "Utah"],
                "daily_itinerary": [{"day": 1, "title": "To Moab"}],
                "waypoints": [
                    {"id": "denver-start", "day": 1, "name": "Denver", "type": "start", "lat": 39.7, "lng": -105.0},
                    {"id": "moab-camp", "day": 1, "name": "Moab", "type": "camp", "lat": 38.57, "lng": -109.55},
                ],
            },
        }

        saved = store.save_account_trip(
            trip_id,
            builder_trip,
            self.owner,
            request="Denver to Moab and back",
            route_geometry=geometry,
            builder_state=builder_state,
            source="route-builder",
        )

        synced = store.get_trip_document_v2(self.owner, trip_id)
        self.assertEqual(synced["revision"], created["revision"] + 1)
        self.assertEqual(synced["title"], "Denver to Moab")
        self.assertEqual(synced["summary"], "A there-and-back route.")
        self.assertEqual(synced["regions"], ["Colorado", "Utah"])
        self.assertEqual(synced["days"][0]["title"], "To Moab")
        route_items = [item for item in synced["items"] if item.get("kind") != "activity"]
        self.assertEqual([item["title"] for item in route_items], ["Denver", "Moab"])
        self.assertEqual(
            [item["id"] for item in route_items],
            [f"{trip_id}:canonical-start", f"{trip_id}:canonical-destination"],
        )
        self.assertEqual(route_items[0]["coordinates"], {"lat": 39.7, "lng": -105.0})
        self.assertEqual(route_items[1]["coordinates"], {"lat": 38.57, "lng": -109.55})
        self.assertTrue(all("name" not in item for item in route_items))
        self.assertEqual(synced["route"], geometry)
        self.assertEqual(saved["v2_revision"], synced["revision"])
        self._assert_v2_only_fields_preserved(synced)
        self.assertEqual(synced["legacy_v1"]["request"], "Denver to Moab and back")
        self.assertEqual(synced["legacy_v1"]["trip"], builder_trip)
        self.assertEqual(synced["legacy_v1"]["route_geometry"], geometry)
        self.assertEqual(synced["legacy_v1"]["builder_state"], builder_state)

    def test_v2_sync_repairs_preexisting_raw_legacy_items_without_duplicates(self):
        converted = store._canonical_v2_items_from_legacy_waypoints(
            "repair-raw-items",
            [
                {"day": 1, "name": "Denver", "type": "start", "lat": 39.7, "lng": -105.0},
                {"day": 1, "name": "Moab", "type": "camp", "lat": 38.57, "lng": -109.55},
            ],
            [
                {"id": "old-start", "day": 1, "name": "Old start", "type": "start"},
                {"id": "old-finish", "day": 1, "name": "Old finish", "type": "camp"},
                {
                    "schema_version": 1,
                    "id": "keep-activity",
                    "kind": "activity",
                    "title": "Museum tickets",
                    "day": 1,
                    "order": 2,
                    "facts": {"booking_status": "confirmed"},
                },
            ],
            now=100,
        )

        self.assertEqual([item["id"] for item in converted], ["old-start", "old-finish", "keep-activity"])
        self.assertEqual([item["title"] for item in converted], ["Denver", "Moab", "Museum tickets"])
        self.assertTrue(all("name" not in item for item in converted))
        self.assertEqual(converted[-1]["facts"], {"booking_status": "confirmed"})

    def test_planner_write_syncs_existing_v2_trip_and_preserves_v2_only_fields(self):
        trip_id = "v2-planner-sync"
        created = self._create_v2_trip(trip_id)
        geometry = {
            "coords": [[-111.89, 40.76], [-109.55, 38.57]],
            "source": "valhalla",
        }
        planner_trip = {
            "trip_id": trip_id,
            "plan": {
                "trip_name": "Salt Lake City to Moab",
                "overview": "A revised desert route.",
                "states": ["Utah"],
                "daily_itinerary": [{"day": 1, "title": "South to Moab"}],
                "waypoints": [
                    {"id": "slc-start", "day": 1, "name": "Salt Lake City", "type": "start", "lat": 40.76, "lng": -111.89},
                    {"id": "moab-camp", "day": 1, "name": "Moab", "type": "camp", "lat": 38.57, "lng": -109.55},
                ],
            },
        }

        synced_revision = store.save_trip(
            trip_id,
            "Move the start to Salt Lake City",
            planner_trip,
            user_id=self.owner,
            route_geometry=geometry,
            builder_state=None,
            audio_guide=None,
        )

        synced = store.get_trip_document_v2(self.owner, trip_id)
        self.assertEqual(synced["revision"], created["revision"] + 1)
        self.assertEqual(synced["title"], "Salt Lake City to Moab")
        self.assertEqual(synced["summary"], "A revised desert route.")
        self.assertEqual(synced["regions"], ["Utah"])
        self.assertEqual(synced["days"][0]["title"], "South to Moab")
        route_items = [item for item in synced["items"] if item.get("kind") != "activity"]
        self.assertEqual([item["title"] for item in route_items], ["Salt Lake City", "Moab"])
        self.assertEqual(
            [item["id"] for item in route_items],
            [f"{trip_id}:canonical-start", f"{trip_id}:canonical-destination"],
        )
        self.assertTrue(all("coordinates" in item for item in route_items))
        self.assertEqual(synced["route"], geometry)
        self.assertEqual(synced_revision, synced["revision"])
        self._assert_v2_only_fields_preserved(synced)
        self.assertEqual(synced["legacy_v1"]["request"], "Move the start to Salt Lake City")
        self.assertEqual(synced["legacy_v1"]["trip"], planner_trip)
        self.assertEqual(synced["legacy_v1"]["route_geometry"], geometry)
        self.assertIsNone(synced["legacy_v1"]["builder_state"])

    def test_geometry_save_updates_v2_only_trip_without_creating_legacy_row(self):
        trip_id = "v2-only-geometry"
        created = self._create_v2_trip(trip_id)
        geometry = {
            "coords": [[-105.0, 39.7], [-107.88, 37.28]],
            "source": "valhalla",
            "totalDistance": 540000,
        }

        saved = store.save_trip_geometry(trip_id, self.owner, geometry)

        self.assertIsNotNone(saved)
        synced = store.get_trip_document_v2(self.owner, trip_id)
        self.assertEqual(synced["revision"], created["revision"] + 1)
        self.assertEqual(synced["route"], geometry)
        self._assert_v2_only_fields_preserved(synced)
        self.assertEqual(synced["legacy_v1"]["route_geometry"], geometry)
        self.assertEqual(synced["legacy_v1"]["trip"]["trip_id"], trip_id)
        db = store._conn()
        legacy = db.execute("SELECT 1 FROM trips WHERE id=?", (trip_id,)).fetchone()
        db.close()
        self.assertIsNone(legacy)

    def test_geometry_endpoint_accepts_canonical_v2_items_and_ignores_optional_activity(self):
        trip_id = "v2-canonical-geometry"
        created = self._create_v2_trip(trip_id)
        geometry = {
            "coords": [
                [-105.0, 39.7],
                [-104.95, 39.74],
                [-104.9, 39.8],
            ],
            "source": "valhalla",
            "totalDistance": 18000,
        }

        saved = asyncio.run(server.update_trip_geometry(
            trip_id,
            server.RouteGeometryRequest(route_geometry=geometry),
            {"id": self.owner},
        ))

        synced = store.get_trip_document_v2(self.owner, trip_id)
        self.assertEqual(saved["v2_revision"], created["revision"] + 1)
        self.assertEqual(synced["revision"], created["revision"] + 1)
        self.assertEqual(synced["route"], geometry)
        self.assertEqual(
            [item["id"] for item in synced["items"]],
            [
                f"{trip_id}:canonical-start",
                f"{trip_id}:canonical-destination",
                f"{trip_id}:v2-only-activity",
            ],
        )
        self._assert_v2_only_fields_preserved(synced)

    def test_geometry_endpoint_prefers_v2_items_when_legacy_row_is_stale(self):
        trip_id = "mixed-canonical-geometry"
        store.save_account_trip(
            trip_id,
            {
                "trip_id": trip_id,
                "plan": {
                    "trip_name": "Old route",
                    "waypoints": [
                        {"name": "Old start", "type": "start", "lat": 45.0, "lng": -120.0},
                        {"name": "Old finish", "type": "camp", "lat": 46.0, "lng": -119.0},
                    ],
                },
            },
            self.owner,
        )
        created = self._create_v2_trip(trip_id, expected_revision=1)
        geometry = {
            "coords": [[-105.0, 39.7], [-104.95, 39.74], [-104.9, 39.8]],
            "source": "valhalla",
            "totalDistance": 18000,
        }

        saved = asyncio.run(server.update_trip_geometry(
            trip_id,
            server.RouteGeometryRequest(route_geometry=geometry),
            {"id": self.owner},
        ))

        self.assertEqual(saved["v2_revision"], created["revision"] + 1)
        self.assertEqual(store.get_trip_document_v2(self.owner, trip_id)["route"], geometry)
        self.assertEqual(store.get_trip(trip_id)["route_geometry"], geometry)

    def test_account_trip_promotes_embedded_fields_and_preserves_omitted_fields(self):
        geometry = {"coords": [[-109.0, 38.0], [-108.0, 39.0]]}
        builder_state = {"tripShapeMode": "loop", "stops": [{"name": "Start"}]}
        audio_guide = {"start": "Welcome."}
        store.save_account_trip(
            "embedded-account-trip",
            {
                "trip_id": "embedded-account-trip",
                "plan": {"trip_name": "Original"},
                "route_geometry": geometry,
                "builder_state": builder_state,
                "audio_guide": audio_guide,
            },
            self.owner,
        )

        db = store._conn()
        row = db.execute(
            "SELECT plan,route_geometry,builder_state,audio_guide FROM trips WHERE id=?",
            ("embedded-account-trip",),
        ).fetchone()
        db.close()
        stored_plan = json.loads(row["plan"])
        self.assertNotIn("route_geometry", stored_plan)
        self.assertNotIn("builder_state", stored_plan)
        self.assertNotIn("audio_guide", stored_plan)
        self.assertEqual(json.loads(row["route_geometry"]), geometry)
        self.assertEqual(json.loads(row["builder_state"]), builder_state)
        self.assertEqual(json.loads(row["audio_guide"]), audio_guide)

        store.save_account_trip(
            "embedded-account-trip",
            {"trip_id": "embedded-account-trip", "plan": {"trip_name": "Notes only"}},
            self.owner,
        )
        preserved = store.get_trip("embedded-account-trip")
        self.assertEqual(preserved["route_geometry"], geometry)
        self.assertEqual(preserved["builder_state"], builder_state)
        self.assertEqual(preserved["audio_guide"], audio_guide)

        store.save_account_trip(
            "embedded-account-trip",
            {"trip_id": "embedded-account-trip", "plan": {"trip_name": "Route cleared"}},
            self.owner,
            route_geometry=None,
            builder_state=None,
        )
        cleared = store.get_trip("embedded-account-trip")
        self.assertNotIn("route_geometry", cleared)
        self.assertNotIn("builder_state", cleared)
        self.assertNotIn("audio_guide", cleared)

    def test_init_backfills_existing_embedded_trip_payloads(self):
        geometry = {"coords": [[-110.0, 37.0], [-109.0, 38.0]]}
        builder_state = {"tripShapeMode": "there_and_back"}
        embedded = {
            "trip_id": "legacy-embedded",
            "plan": {"trip_name": "Legacy"},
            "route_geometry": geometry,
            "builder_state": builder_state,
        }
        db = store._conn()
        db.execute(
            """INSERT INTO trips (id,user_id,created_at,updated_at,request,plan,version)
               VALUES (?,?,?,?,?,?,1)""",
            ("legacy-embedded", self.owner, 1, 1, "legacy", json.dumps(embedded)),
        )
        db.commit()
        db.close()

        store.init_db()

        migrated = store.get_trip("legacy-embedded")
        self.assertEqual(migrated["route_geometry"], geometry)
        self.assertEqual(migrated["builder_state"], builder_state)
        db = store._conn()
        row = db.execute("SELECT plan FROM trips WHERE id=?", ("legacy-embedded",)).fetchone()
        db.close()
        self.assertNotIn("route_geometry", json.loads(row["plan"]))
        self.assertNotIn("builder_state", json.loads(row["plan"]))

    def test_route_changing_planner_save_clears_builder_state_and_audio_atomically(self):
        old_geometry = {"coords": [[-109.0, 38.0], [-108.9, 38.1]]}
        store.save_account_trip(
            "trip-clear-derived-state",
            {
                "trip_id": "trip-clear-derived-state",
                "plan": {"trip_name": "Original"},
                "route_geometry": old_geometry,
                "builder_state": {"stops": [{"name": "Old finish"}]},
                "audio_guide": {"old": "Old narration"},
            },
            self.owner,
        )
        new_geometry = {"coords": [[-109.0, 38.0], [-108.0, 39.0]]}
        store.save_trip(
            "trip-clear-derived-state",
            "Move the finish",
            {"trip_id": "trip-clear-derived-state", "plan": {"trip_name": "Edited"}},
            user_id=self.owner,
            route_geometry=new_geometry,
            builder_state=None,
            audio_guide=None,
        )

        saved = store.get_trip("trip-clear-derived-state")
        self.assertEqual(saved["route_geometry"], new_geometry)
        self.assertNotIn("builder_state", saved)
        self.assertNotIn("audio_guide", saved)


if __name__ == "__main__":
    unittest.main()
