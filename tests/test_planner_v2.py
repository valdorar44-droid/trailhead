import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from config.settings import settings
from dashboard import server
from db import store


class PlannerV2StoreTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        self.temp = tempfile.TemporaryDirectory()
        settings.db_path = str(Path(self.temp.name) / "planner-v2.db")
        store.init_db()
        self.user_id = store.create_user(
            "planner-v2@example.com",
            "planner_v2",
            server._hash_pw("planner-password"),
            "PLANNER2",
        )

    def tearDown(self):
        settings.db_path = self.original_db_path
        self.temp.cleanup()

    def test_event_cursor_is_ordered_and_commit_is_revision_bound(self):
        store.create_plan_job("run-1", self.user_id, "session-1", "Moab to Flagstaff", draft_only=True)
        first = store.append_plan_job_event(
            "run-1", "task", task_id="road_route", state="running", payload={"message": "Building road route"},
        )
        second = store.append_plan_job_event(
            "run-1", "task", task_id="road_route", state="completed", payload={"message": "Road route ready"},
        )
        self.assertEqual((first["seq"], second["seq"]), (1, 2))
        self.assertEqual([event["seq"] for event in store.list_plan_job_events("run-1", after=1)], [2])

        draft = {"trip_id": "trip-1", "plan": {"trip_name": "Moab to Flagstaff"}}
        store.update_plan_job("run-1", "ready_for_review", result=json.dumps(draft))
        ready = store.get_plan_job("run-1")
        with self.assertRaises(store.RevisionConflictError):
            store.claim_plan_job_commit("run-1", self.user_id, int(ready["revision"]) - 1)
        claimed = store.claim_plan_job_commit("run-1", self.user_id, int(ready["revision"]))
        self.assertEqual(claimed["status"], "committing")
        store.finish_plan_job_commit("run-1", self.user_id, 1)
        self.assertEqual(store.get_plan_job("run-1")["status"], "committed")

    def test_cancel_is_owned_and_does_not_change_finished_preview(self):
        store.create_plan_job("run-2", self.user_id, "session-2", "Research", draft_only=True)
        self.assertFalse(store.request_plan_job_cancel("run-2", self.user_id + 100))
        self.assertTrue(store.request_plan_job_cancel("run-2", self.user_id))
        self.assertEqual(store.get_plan_job("run-2")["status"], "cancelling")
        store.update_plan_job("run-2", "cancelled", error="Planning stopped")
        self.assertFalse(store.request_plan_job_cancel("run-2", self.user_id))

    def test_review_draft_update_is_revision_bound(self):
        store.create_plan_job("run-3", self.user_id, "session-3", "Research", draft_only=True)
        store.update_plan_job("run-3", "ready_for_review", result=json.dumps({"trip_id": "trip-3"}))
        ready = store.get_plan_job("run-3")
        updated = store.update_plan_job_draft_result(
            "run-3",
            self.user_id,
            int(ready["revision"]),
            {"trip_id": "trip-3", "decision": "accepted"},
        )
        self.assertEqual(updated["revision"], int(ready["revision"]) + 1)
        with self.assertRaises(store.RevisionConflictError):
            store.update_plan_job_draft_result(
                "run-3",
                self.user_id,
                int(ready["revision"]),
                {"trip_id": "trip-3", "decision": "stale"},
            )

    def test_start_request_is_idempotent_and_conflicting_reuse_is_rejected(self):
        payload = {
            "request": "Moab to Flagstaff",
            "draft_only": True,
            "strict_country_guard": True,
        }
        created, was_created = store.create_or_get_planner_run(
            "run-idempotent", self.user_id, "session-idempotent", "Moab to Flagstaff",
            "mobile-request-123456", payload,
        )
        replayed, replay_created = store.create_or_get_planner_run(
            "run-must-not-be-used", self.user_id, "session-idempotent", "Moab to Flagstaff",
            "mobile-request-123456", payload,
        )
        self.assertTrue(was_created)
        self.assertFalse(replay_created)
        self.assertEqual(replayed["id"], created["id"])
        with self.assertRaises(ValueError):
            store.create_or_get_planner_run(
                "run-conflict", self.user_id, "session-idempotent", "Different trip",
                "mobile-request-123456", {**payload, "request": "Different trip"},
            )

    def test_execution_and_commit_leases_recover_only_after_expiry(self):
        payload = {
            "request": "Moab to Flagstaff",
            "draft_only": True,
            "strict_country_guard": True,
        }
        job, _ = store.create_or_get_planner_run(
            "run-lease", self.user_id, "session-lease", "Moab to Flagstaff",
            "mobile-request-lease", payload,
        )
        self.assertIsNotNone(store.claim_plan_job_execution(job["id"], "worker-a", lease_seconds=60))
        self.assertTrue(store.renew_plan_job_execution(job["id"], "worker-a", lease_seconds=60))
        self.assertIsNone(store.claim_plan_job_execution(job["id"], "worker-b", lease_seconds=60))
        db = store._conn()
        db.execute(
            "UPDATE plan_jobs SET execution_lease_until=?,updated_at=? WHERE id=?",
            (time.time() - 5, time.time() - 5, job["id"]),
        )
        db.commit()
        db.close()
        self.assertEqual(store.list_recoverable_planner_runs()[0]["id"], job["id"])
        recovered = store.claim_plan_job_execution(job["id"], "worker-b", lease_seconds=60)
        self.assertEqual(recovered["execution_owner"], "worker-b")
        store.release_plan_job_execution(job["id"], "worker-b")

        store.update_plan_job(job["id"], "ready_for_review", result=json.dumps({"trip_id": "trip-lease"}))
        ready = store.get_plan_job(job["id"])
        claimed = store.claim_plan_job_commit(job["id"], self.user_id, int(ready["revision"]))
        self.assertIsNone(store.claim_plan_job_execution(job["id"], "worker-c", lease_seconds=60))
        self.assertNotIn(job["id"], [item["id"] for item in store.list_recoverable_planner_runs()])
        with self.assertRaises(ValueError):
            store.claim_plan_job_commit(job["id"], self.user_id, int(claimed["revision"]))
        db = store._conn()
        db.execute(
            "UPDATE plan_jobs SET commit_lease_until=?,updated_at=? WHERE id=?",
            (time.time() - 5, time.time() - 5, job["id"]),
        )
        db.commit()
        db.close()
        reclaimed = store.claim_plan_job_commit(job["id"], self.user_id, int(claimed["revision"]))
        self.assertEqual(reclaimed["status"], "committing")
        self.assertGreater(int(reclaimed["revision"]), int(claimed["revision"]))


class PlannerV2SafetyTests(unittest.IsolatedAsyncioTestCase):
    def test_moab_to_flagstaff_rejects_a_mexico_stop(self):
        result = server._planner_v2_country_guard([
            {"name": "Moab, Utah", "lat": 38.57, "lng": -109.55, "country_code": "us"},
            {"name": "Invented detour in Mexico", "lat": 31.7, "lng": -106.4, "country_code": "mx"},
            {"name": "Flagstaff, Arizona", "lat": 35.20, "lng": -111.65, "country_code": "us"},
        ])
        self.assertFalse(result["ok"])
        self.assertIn("outside", result["reason"].lower())
        self.assertIn("Invented detour in Mexico", result["details"][0])

    def test_domestic_route_country_set_is_endpoint_bound(self):
        result = server._planner_v2_country_guard([
            {"name": "Moab", "lat": 38.57, "lng": -109.55, "country_code": "US"},
            {"name": "Monument Valley", "lat": 37.00, "lng": -110.17, "country_code": "us"},
            {"name": "Flagstaff", "lat": 35.20, "lng": -111.65, "country_code": "us"},
        ])
        self.assertTrue(result["ok"])
        self.assertEqual(result["allowed_country_codes"], ["us"])

    def test_cross_border_route_requires_explicit_confirmation(self):
        waypoints = [
            {"name": "Bellingham", "lat": 48.75, "lng": -122.48, "country_code": "us"},
            {"name": "Vancouver", "lat": 49.28, "lng": -123.12, "country_code": "ca"},
        ]
        self.assertFalse(server._planner_v2_country_guard(waypoints)["ok"])
        confirmed = server._planner_v2_country_guard(waypoints, confirm_cross_border=True)
        self.assertTrue(confirmed["ok"])
        self.assertTrue(confirmed["cross_border"])

    def test_same_named_places_in_different_regions_require_clarification(self):
        self.assertTrue(server._planner_v2_geocode_is_ambiguous("Springfield", [
            {"name": "Springfield", "country_code": "us", "region": "Illinois"},
            {"name": "Springfield", "country_code": "us", "region": "Missouri"},
        ]))
        self.assertFalse(server._planner_v2_geocode_is_ambiguous("Moab Utah", [
            {"name": "Moab", "country_code": "us", "region": "Utah"},
        ]))
        guarded = server._planner_v2_country_guard([
            {"name": "Springfield", "lat": 39.78, "lng": -89.65, "country_code": "us", "geocode_ambiguous": True},
            {"name": "Flagstaff", "lat": 35.20, "lng": -111.65, "country_code": "us"},
        ])
        self.assertFalse(guarded["ok"])
        self.assertIn("more than one", guarded["reason"].lower())

    async def test_returned_road_geometry_must_stay_in_confirmed_countries(self):
        geometry = {"coords": [[-109.55, 38.57], [-110.2, 37.2], [-111.65, 35.20]]}
        with patch.object(server, "_planner_v2_candidate_country_code", AsyncMock(side_effect=["us", "us", "us"])):
            accepted = await server._planner_v2_route_country_guard(geometry, ["us"])
        self.assertTrue(accepted["ok"])
        self.assertEqual(accepted["route_country_codes"], ["us"])
        with patch.object(server, "_planner_v2_candidate_country_code", AsyncMock(side_effect=["us", "mx", "us"])):
            rejected = await server._planner_v2_route_country_guard(geometry, ["us"])
        self.assertFalse(rejected["ok"])
        self.assertIn("not confirmed", rejected["reason"].lower())
        with patch.object(
            server,
            "_planner_v2_candidate_country_code",
            AsyncMock(side_effect=["us", "mx", asyncio.TimeoutError()]),
        ):
            mixed = await server._planner_v2_route_country_guard(geometry, ["us"])
        self.assertFalse(mixed["ok"])
        self.assertIn("not confirmed", mixed["reason"].lower())
        with patch.object(server, "_planner_v2_candidate_country_code", AsyncMock(side_effect=["us", "", "us"])):
            unresolved = await server._planner_v2_route_country_guard(geometry, ["us"])
        self.assertFalse(unresolved["ok"])
        self.assertIn("secondary country check", unresolved["reason"].lower())

        guarded_geometry = {
            **geometry,
            "countryBorderExclusionApplied": True,
            "countryBorderNotificationsChecked": True,
        }
        with patch.object(server, "_planner_v2_candidate_country_code", AsyncMock(side_effect=["us", "", "us"])):
            guarded = await server._planner_v2_route_country_guard(guarded_geometry, ["us"])
        self.assertTrue(guarded["ok"])
        self.assertEqual(guarded["severity"], "warning")
        self.assertIn("border controls", guarded["details"][0].lower())

        dense_geometry = {
            "coords": [[-109.55 - index * 0.1, 38.57 - index * 0.2] for index in range(12)],
        }
        resolver = AsyncMock(return_value="us")
        with patch.object(server, "_planner_v2_candidate_country_code", resolver):
            dense = await server._planner_v2_route_country_guard(dense_geometry, ["us"])
        self.assertTrue(dense["ok"])
        self.assertEqual(resolver.await_count, 5)

    async def test_nominatim_fallback_is_not_trusted_as_endpoint_disambiguation(self):
        response = unittest.mock.Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = [{
            "lat": "38.5733", "lon": "-109.5498",
            "display_name": "Moab, Grand County, Utah, United States",
            "address": {"country_code": "us", "country": "United States", "state": "Utah"},
        }]
        client = unittest.mock.Mock()
        client.get = AsyncMock(return_value=response)
        with patch.object(settings, "mapbox_token", ""):
            place = await server._geocode_one(
                client, {"name": "Moab", "type": "start"}, server.asyncio.Semaphore(1),
            )
        self.assertIs(place["geocode_ambiguity_verified"], False)
        guarded = server._planner_v2_country_guard([
            place,
            {"name": "Flagstaff", "lat": 35.20, "lng": -111.65, "country_code": "us", "geocode_ambiguity_verified": True},
        ])
        self.assertFalse(guarded["ok"])
        self.assertIn("more than one", guarded["reason"].lower())

    async def test_draft_execution_finishes_unsaved_with_real_events(self):
        original_db_path = settings.db_path
        with tempfile.TemporaryDirectory() as temp:
            settings.db_path = str(Path(temp) / "draft.db")
            try:
                store.init_db()
                store.create_plan_job("draft-run", None, "", "Moab to Flagstaff", draft_only=True)
                store.append_plan_job_event("draft-run", "run", state="queued", payload={"message": "Trip research is queued"})
                confirmed_endpoints = [
                    {"name": "Moab", "day": 1, "lat": 38.5733, "lng": -109.5498, "type": "start", "country_code": "us"},
                    {"name": "Flagstaff", "day": 3, "lat": 35.1983, "lng": -111.6513, "type": "destination", "country_code": "us"},
                ]
                geocoded = [
                    confirmed_endpoints[0],
                    {"name": "Invented unresolved stop", "day": 2, "type": "break"},
                    confirmed_endpoints[1],
                ]
                plan = {
                    "trip_name": "Moab to Flagstaff",
                    "overview": "A researched desert route.",
                    "duration_days": 3,
                    "states": ["UT", "AZ"],
                    "total_est_miles": 330,
                    "waypoints": geocoded,
                    "daily_itinerary": [],
                    "logistics": {"fuel_strategy": "Top up in Moab", "permits_needed": "Check current rules"},
                }
                geometry = {
                    "coords": [[-109.5498, 38.5733], [-111.6513, 35.1983]],
                    "totalDistance": 530_000,
                    "totalDuration": 21_600,
                    "source": "valhalla",
                }
                enrichment = {
                    "waypoints": confirmed_endpoints,
                    "campsites": [
                        {"id": "camp-1", "name": "Official Camp", "lat": 37.1, "lng": -110.1, "url": "https://www.nps.gov/example", "source_label": "National Park Service"},
                        {"id": "camp-unsourced", "name": "Unsourced Camp", "lat": 37.2, "lng": -110.2},
                    ],
                    "gas_stations": [],
                    "route_pois": [],
                }
                route_mock = AsyncMock(return_value=geometry)
                with (
                    patch.object(server, "plan_trip", return_value=plan),
                    patch.object(server, "_geocode_waypoints", AsyncMock(return_value=geocoded)),
                    patch.object(server, "_planner_v2_mapbox_route_geometry", route_mock),
                    patch.object(server, "_planner_v2_route_country_guard", AsyncMock(return_value={
                        "ok": True, "reason": "", "details": [], "route_country_codes": ["us"],
                    })),
                    patch.object(server, "enrich_trip_along_route", AsyncMock(return_value=enrichment)),
                    patch.object(server, "_planner_v2_detour_proposals", AsyncMock(return_value=[])),
                    patch.object(server, "_planner_v2_route_readiness", AsyncMock(return_value=([], [{
                        "id": "weather-1", "title": "Weather check: Moab", "description": "Forecast available",
                        "lat": 38.5733, "lng": -109.5498, "source_label": "Open-Meteo forecast",
                        "source_url": "https://open-meteo.com/", "source_kind": "other",
                    }], []))),
                    patch.object(server, "save_trip") as save_mock,
                ):
                    await server._execute_plan_job(
                        "draft-run",
                        server.PlanRequest(
                            request="Moab to Flagstaff",
                            draft_only=True,
                            strict_country_guard=True,
                        ),
                        None,
                        0,
                    )

                job = store.get_plan_job("draft-run")
                self.assertEqual(job["status"], "ready_for_review")
                self.assertIsNotNone(job["result"])
                save_mock.assert_not_called()
                routed_waypoints = route_mock.await_args.args[0]
                self.assertEqual([item["name"] for item in routed_waypoints], ["Moab", "Flagstaff"])
                self.assertNotIn("Invented unresolved stop", json.dumps(json.loads(job["result"])))
                snapshot = server._planner_v2_snapshot(job)
                self.assertNotIn("Unsourced Camp", json.dumps(snapshot["draft"]))
                self.assertTrue(any("left out" in warning for warning in snapshot["warnings"]))
                events = store.list_plan_job_events("draft-run")
                completed = {(event["task_id"], event["state"]) for event in events}
                self.assertTrue({
                    ("trip_shape", "completed"),
                    ("confirm_places", "completed"),
                    ("road_route", "completed"),
                    ("camps", "completed"),
                    ("fuel", "warning"),
                    ("experiences", "warning"),
                    ("detours", "skipped"),
                    ("conditions", "completed"),
                    ("source_review", "warning"),
                    ("trip_preview", "completed"),
                }.issubset(completed))
            finally:
                settings.db_path = original_db_path

    async def test_mapbox_preview_route_uses_resolved_anchors(self):
        directions = AsyncMock(return_value={
            "routes": [{
                "distance": 530_000,
                "duration": 21_600,
                "geometry": {"coordinates": [
                    [-109.5498, 38.5733],
                    [-110.4, 37.0],
                    [-111.6513, 35.1983],
                ]},
                "legs": [{"steps": []}, {"steps": []}],
            }],
        })
        with (
            patch.object(settings, "mapbox_token", "test-token"),
            patch.object(server, "_map_context_directions", directions),
        ):
            route = await server._planner_v2_mapbox_route_geometry([
                {"name": "Moab", "lat": 38.5733, "lng": -109.5498, "type": "start"},
                {"name": "Route stop", "lat": 37.0, "lng": -110.4, "type": "waypoint"},
                {"name": "Flagstaff", "lat": 35.1983, "lng": -111.6513, "type": "destination"},
            ])
        self.assertEqual(route["source"], "mapbox-directions")
        self.assertEqual(route["coords"][0], [-109.5498, 38.5733])
        self.assertEqual(route["coords"][-1], [-111.6513, 35.1983])
        request = directions.await_args.args[0]
        self.assertEqual(request.profile, "mapbox/driving-traffic")
        self.assertEqual(len(request.coordinates), 3)
        self.assertIn("country_border", request.exclude)
        self.assertEqual(request.notifications, "all")
        self.assertTrue(route["countryBorderExclusionApplied"])
        self.assertTrue(route["countryBorderNotificationsChecked"])

    async def test_map_context_directions_requests_border_notifications(self):
        provider = AsyncMock(return_value={"routes": []})
        with (
            patch.object(server.settings, "mapbox_token", "test-token"),
            patch.object(server, "_mapbox_get", provider),
        ):
            await server._map_context_directions(server.MapContextRouteRequest(
                coordinates=[[-109.5498, 38.5733], [-111.6513, 35.1983]],
                notifications="all",
            ))
        self.assertEqual(provider.await_args.args[1]["notifications"], "all")
        with (
            patch.object(server.settings, "mapbox_token", "test-token"),
            patch.object(server, "_mapbox_get", provider),
        ):
            await server._map_context_directions(server.ExtremeDirectionsRequest(
                coordinates=[[-109.5498, 38.5733], [-111.6513, 35.1983]],
            ))
        self.assertEqual(provider.await_args.args[1]["notifications"], "all")

    async def test_domestic_mapbox_route_rejects_a_border_notification(self):
        directions = AsyncMock(return_value={
            "routes": [{
                "distance": 530_000,
                "duration": 21_600,
                "geometry": {"coordinates": [[-109.5498, 38.5733], [-111.6513, 35.1983]]},
                "legs": [{"steps": []}],
                "notifications": [{"subtype": "countryBorderCrossing"}],
            }],
        })
        with (
            patch.object(settings, "mapbox_token", "test-token"),
            patch.object(server, "_map_context_directions", directions),
        ):
            route = await server._planner_v2_mapbox_route_geometry([
                {"name": "Moab", "lat": 38.5733, "lng": -109.5498, "type": "start"},
                {"name": "Flagstaff", "lat": 35.1983, "lng": -111.6513, "type": "destination"},
            ])
        self.assertIsNone(route)

    async def test_detour_proposals_require_a_sourced_allowed_country_and_road_measurement(self):
        matrix = AsyncMock(return_value={
            "durations": [[0, 780], [840, 0]],
            "distances": [[0, 14_000], [15_000, 0]],
        })
        route_geometry = {
            "coords": [[-109.55, 38.57], [-110.1, 37.2], [-111.65, 35.2]],
            "waypointSignature": "route-signature",
        }
        enrichment = {
            "route_pois": [
                {"id": "foreign", "name": "Wrong country", "lat": 31.7, "lng": -106.4, "country_code": "mx", "url": "https://example.com/foreign"},
                {"id": "safe", "name": "Verified side trip", "lat": 37.21, "lng": -110.11, "country_code": "us", "url": "https://www.nps.gov/example", "source_label": "National Park Service"},
            ],
            "campsites": [],
        }
        with (
            patch.object(settings, "mapbox_token", "test-token"),
            patch.object(server, "_map_context_matrix", matrix),
        ):
            proposals = await server._planner_v2_detour_proposals(enrichment, route_geometry, ["us"])
        self.assertEqual([item["title"] for item in proposals], ["Verified side trip"])
        self.assertTrue(proposals[0]["road_verified"])
        self.assertGreater(proposals[0]["added_drive_minutes"], 10)
        matrix.assert_awaited_once()

    async def test_route_readiness_sanitizes_conditions_and_keeps_source_links(self):
        alert = {
            "id": "raw-provider-id",
            "provider": "nws",
            "type": "weather",
            "subtype": "High Wind Warning",
            "severity": "high",
            "description": "High winds are possible along the route.",
            "lat": 37.0,
            "lng": -110.2,
            "updated_at": 1_700_000_000,
        }
        forecast = {
            "trip_id": "trip",
            "forecasts": {
                "Moab": {"available": True, "source_label": "Open-Meteo forecast"},
                "Flagstaff": {"available": True, "source_label": "Open-Meteo forecast"},
            },
        }
        with (
            patch.object(server, "_provider_alerts_along_route", AsyncMock(return_value=[alert])),
            patch.object(server, "route_weather", AsyncMock(return_value=forecast)),
        ):
            conditions, weather, warnings = await server._planner_v2_route_readiness([
                {"name": "Moab", "lat": 38.57, "lng": -109.55},
                {"name": "Flagstaff", "lat": 35.20, "lng": -111.65},
            ], "trip")
        self.assertEqual(conditions[0]["source_label"], "National Weather Service")
        self.assertEqual(conditions[0]["source_url"], "https://www.weather.gov/")
        self.assertNotIn("provider_id", conditions[0])
        self.assertEqual([item["title"] for item in weather], ["Weather check: Moab", "Weather check: Flagstaff"])
        self.assertEqual(warnings, [
            "Live closure and alert feeds may be incomplete. Recheck official road and public-land notices before departure."
        ])

    def test_source_snapshot_keeps_direct_links_and_labels_commercial_sources(self):
        findings, counts, warnings = server._planner_v2_findings({
            "campsites": [
                {"id": "official", "name": "NPS Camp", "url": "https://www.nps.gov/camp", "source_label": "National Park Service"},
                {"id": "missing", "name": "Unsourced Camp"},
            ],
            "gas_stations": [{"id": "fuel", "name": "Fuel", "website": "https://example.com/fuel", "source_label": "Direct operator"}],
            "route_pois": [{"id": "tour", "name": "Tour", "booking_url": "https://www.viator.com/tour", "source_label": "Viator"}],
        })
        self.assertEqual(len(findings), 3)
        self.assertEqual(counts, {"source_count": 3, "official_count": 1, "commercial_count": 1})
        self.assertFalse(any("Unsourced Camp" in json.dumps(finding) for finding in findings))
        self.assertTrue(any("left out" in warning for warning in warnings))

    async def test_preview_gate_is_inaccessible_without_capability(self):
        with self.assertRaises(HTTPException) as raised:
            server._planner_v2_preview_gate(None)
        self.assertEqual(raised.exception.status_code, 404)
        self.assertIsNone(server._planner_v2_preview_gate("planner-research-preview-1"))


class PlannerV2ActionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        self.temp = tempfile.TemporaryDirectory()
        settings.db_path = str(Path(self.temp.name) / "planner-v2-actions.db")
        store.init_db()
        self.user_id = store.create_user(
            "planner-actions@example.com",
            "planner_actions",
            server._hash_pw("planner-password"),
            "PLANACTIONS",
        )
        self.user = {"id": self.user_id}

    def tearDown(self):
        settings.db_path = self.original_db_path
        self.temp.cleanup()

    def _ready_run(self, run_id: str = "decision-run", detour_decision: str = "pending") -> dict:
        store.create_plan_job(run_id, self.user_id, "session", "Moab to Flagstaff", draft_only=True)
        result = {
            "trip_id": "trip-decision",
            "plan": {
                "trip_name": "Moab to Flagstaff",
                "overview": "A safe route",
                "duration_days": 3,
                "states": ["UT", "AZ"],
                "total_est_miles": 330,
                "daily_itinerary": [],
                "logistics": {},
                "allowed_country_codes": ["us"],
                "route_preferences": {"route_style": "balanced"},
                "timeline": {"days": [{"day": 1, "events": [{"title": "Unsourced camp"}]}]},
                "waypoints": [
                    {"name": "Moab", "day": 1, "lat": 38.57, "lng": -109.55, "type": "start", "country_code": "us"},
                    {"name": "Flagstaff", "day": 3, "lat": 35.20, "lng": -111.65, "type": "destination", "country_code": "us"},
                ],
            },
            "route_geometry": {
                "coords": [[-109.55, 38.57], [-111.65, 35.20]],
                "totalDistance": 530_000,
                "totalDuration": 21_600,
            },
            "campsites": [
                {"id": "camp-sourced", "name": "Sourced camp", "url": "https://www.nps.gov/camp"},
                {"id": "camp-unsourced", "name": "Unsourced camp"},
            ],
            "gas_stations": [
                {"id": "fuel-sourced", "name": "Sourced fuel", "website": "https://example.com/fuel"},
                {"id": "fuel-unsourced", "name": "Unsourced fuel"},
            ],
            "route_pois": [
                {"id": "poi-sourced", "name": "Sourced activity", "official_url": "https://www.blm.gov/activity"},
                {"id": "poi-unsourced", "name": "Unsourced activity"},
            ],
            "timeline": {"days": [{"day": 1, "events": [{"title": "Unsourced camp"}]}]},
            "planner_detour_proposals": [{
                "id": "detour-1",
                "title": "Verified overlook",
                "country_code": "us",
                "lat": 37.0,
                "lng": -110.2,
                "recommended_day": 2,
                "added_drive_minutes": 22,
                "added_distance_miles": 14.0,
                "decision": detour_decision,
                "road_verified": True,
                "source_url": "https://www.nps.gov/example",
            }],
        }
        store.update_plan_job(run_id, "ready_for_review", result=json.dumps(result))
        return store.get_plan_job(run_id)

    async def test_reject_detour_is_revision_bound_and_keeps_route_unchanged(self):
        job = self._ready_run()
        snapshot = await server.planner_v2_action(
            "decision-run",
            server.PlannerV2ActionRequest(
                action="reject_detour",
                proposal_id="detour-1",
                expected_revision=int(job["revision"]),
            ),
            self.user,
            None,
        )
        self.assertEqual(snapshot["detour_proposals"][0]["decision"], "rejected")
        self.assertNotIn("Unsourced", json.dumps(snapshot["draft"]["timeline"]))
        self.assertEqual(snapshot["draft"]["timeline"], snapshot["draft"]["plan"]["timeline"])
        with self.assertRaises(HTTPException) as stale:
            await server.planner_v2_action(
                "decision-run",
                server.PlannerV2ActionRequest(
                    action="reject_detour",
                    proposal_id="detour-1",
                    expected_revision=int(job["revision"]),
                ),
                self.user,
                None,
            )
        self.assertEqual(stale.exception.status_code, 409)

    async def test_approve_detour_rebuilds_the_full_route_before_accepting(self):
        job = self._ready_run()
        verified_route = {
            "coords": [[-109.55, 38.57], [-110.2, 37.0], [-111.65, 35.20]],
            "totalDistance": 560_000,
            "totalDuration": 23_000,
            "source": "mapbox-directions",
        }
        with (
            patch.object(server, "_planner_v2_mapbox_route_geometry", AsyncMock(return_value=verified_route)) as route_mock,
            patch.object(server, "_planner_v2_route_country_guard", AsyncMock(return_value={
                "ok": True,
                "reason": "",
                "details": [],
                "route_country_codes": ["us"],
            })),
            patch.object(server, "_build_trip_timeline", return_value=[]),
        ):
            snapshot = await server.planner_v2_action(
                "decision-run",
                server.PlannerV2ActionRequest(
                    action="approve_detour",
                    proposal_id="detour-1",
                    expected_revision=int(job["revision"]),
                ),
                self.user,
                None,
            )
        self.assertEqual(snapshot["detour_proposals"][0]["decision"], "approved")
        self.assertEqual([item["name"] for item in snapshot["draft"]["plan"]["waypoints"]], [
            "Moab", "Verified overlook", "Flagstaff",
        ])
        route_mock.assert_awaited_once()

    async def test_approve_detour_rejects_a_road_line_that_crosses_an_unconfirmed_country(self):
        job = self._ready_run("border-detour-run")
        verified_route = {
            "coords": [[-109.55, 38.57], [-106.4, 31.7], [-111.65, 35.20]],
            "totalDistance": 560_000,
            "totalDuration": 23_000,
            "source": "mapbox-directions",
        }
        with (
            patch.object(server, "_planner_v2_mapbox_route_geometry", AsyncMock(return_value=verified_route)),
            patch.object(server, "_planner_v2_route_country_guard", AsyncMock(return_value={
                "ok": False,
                "reason": "The road route crosses a country that was not confirmed.",
                "details": ["A border crossing must be confirmed."],
            })),
        ):
            with self.assertRaises(HTTPException) as raised:
                await server.planner_v2_action(
                    "border-detour-run",
                    server.PlannerV2ActionRequest(
                        action="approve_detour",
                        proposal_id="detour-1",
                        expected_revision=int(job["revision"]),
                    ),
                    self.user,
                    None,
                )
        self.assertEqual(raised.exception.status_code, 409)
        unchanged = server._planner_v2_snapshot(store.get_plan_job("border-detour-run"))
        self.assertEqual(unchanged["detour_proposals"][0]["decision"], "pending")
        self.assertEqual([item["name"] for item in unchanged["draft"]["plan"]["waypoints"]], ["Moab", "Flagstaff"])

    async def test_approve_detour_preserves_a_secondary_country_check_warning(self):
        job = self._ready_run("warning-detour-run")
        warning = "The domestic road route passed its border controls, but one secondary country check was temporarily unavailable."
        result = json.loads(job["result"])
        result["planner_readiness_warnings"] = [
            "Weather needs another look.",
            "A closure feed was unavailable.",
            "One permit should be confirmed.",
            "Fuel hours may change.",
        ]
        store.update_plan_job("warning-detour-run", "ready_for_review", result=json.dumps(result))
        job = store.get_plan_job("warning-detour-run")
        verified_route = {
            "coords": [[-109.55, 38.57], [-110.2, 37.0], [-111.65, 35.20]],
            "totalDistance": 560_000,
            "totalDuration": 23_000,
            "source": "mapbox-directions",
        }
        with (
            patch.object(server, "_planner_v2_mapbox_route_geometry", AsyncMock(return_value=verified_route)),
            patch.object(server, "_planner_v2_route_country_guard", AsyncMock(return_value={
                "ok": True,
                "reason": "",
                "details": [warning],
                "severity": "warning",
                "route_country_codes": ["us"],
            })),
            patch.object(server, "_build_trip_timeline", return_value=[]),
        ):
            snapshot = await server.planner_v2_action(
                "warning-detour-run",
                server.PlannerV2ActionRequest(
                    action="approve_detour",
                    proposal_id="detour-1",
                    expected_revision=int(job["revision"]),
                ),
                self.user,
                None,
            )
        self.assertIn(warning, snapshot["draft"]["planner_readiness_warnings"])
        self.assertEqual(snapshot["draft"]["planner_readiness_warnings"][0], warning)
        self.assertEqual(len(snapshot["draft"]["planner_readiness_warnings"]), 4)
        self.assertIn(
            "secondary country check was unavailable",
            snapshot["detour_proposals"][0]["risk_reason"],
        )
        self.assertNotIn("full road-route verification", snapshot["detour_proposals"][0]["risk_reason"])
        events = store.list_plan_job_events("warning-detour-run")
        self.assertEqual(events[-1]["state"], "warning")
        self.assertIn("secondary country check", events[-1]["payload"]["message"])

    async def test_commit_requires_detour_decisions(self):
        job = self._ready_run("pending-commit-run")
        with self.assertRaises(HTTPException) as raised:
            await server.planner_v2_commit(
                "pending-commit-run",
                server.PlannerV2CommitRequest(expected_revision=int(job["revision"])),
                self.user,
                None,
            )
        self.assertEqual(raised.exception.status_code, 409)

    async def test_commit_never_returns_or_saves_private_detour_coordinates(self):
        job = self._ready_run("commit-run", detour_decision="rejected")
        with (
            patch.object(server, "save_trip", return_value=1) as save_mock,
            patch.object(server, "get_trip", return_value=None),
        ):
            response = await server.planner_v2_commit(
                "commit-run",
                server.PlannerV2CommitRequest(expected_revision=int(job["revision"])),
                self.user,
                None,
            )
        saved_payload = save_mock.call_args.args[2]
        self.assertNotIn("planner_detour_proposals", saved_payload)
        self.assertNotIn("planner_detour_proposals", response["trip"])
        self.assertEqual([item["id"] for item in saved_payload["campsites"]], ["camp-sourced"])
        self.assertEqual([item["id"] for item in saved_payload["gas_stations"]], ["fuel-sourced"])
        self.assertEqual([item["id"] for item in saved_payload["route_pois"]], ["poi-sourced"])
        self.assertNotIn("Unsourced", json.dumps(saved_payload["timeline"]))
        self.assertEqual(saved_payload["timeline"], saved_payload["plan"]["timeline"])

    async def test_stale_commit_lease_can_be_finished_without_rerunning_research(self):
        job = self._ready_run("stale-commit-run", detour_decision="rejected")
        claimed = store.claim_plan_job_commit("stale-commit-run", self.user_id, int(job["revision"]))
        db = store._conn()
        db.execute(
            "UPDATE plan_jobs SET commit_lease_until=?,updated_at=? WHERE id=?",
            (time.time() - 5, time.time() - 5, "stale-commit-run"),
        )
        db.commit()
        db.close()
        with (
            patch.object(server, "save_trip", return_value=1) as save_mock,
            patch.object(server, "get_trip", return_value=None),
        ):
            response = await server.planner_v2_commit(
                "stale-commit-run",
                server.PlannerV2CommitRequest(expected_revision=int(claimed["revision"])),
                self.user,
                None,
            )
        save_mock.assert_called_once()
        self.assertEqual(response["run"]["status"], "committed")


if __name__ == "__main__":
    unittest.main()
