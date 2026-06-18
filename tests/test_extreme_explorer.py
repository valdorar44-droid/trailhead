import tempfile
import unittest

from fastapi import HTTPException

from config.settings import settings
from dashboard.server import (
    ExtremeNavigationAuthorizeRequest,
    _build_extreme_map_action,
    _classify_extreme_command,
    _clean_mapbox_param,
    _copilot_realtime_instructions,
    _copilot_realtime_turn_detection,
    _extreme_config_for_user,
    _mapbox_directions_url,
    _mapbox_session_hash,
    _canonical_landmark_geocode,
    _countrycodes_for_query,
    extreme_authorize_navigation,
    _resolve_geocode_candidates,
)
from db import store


class ExtremeExplorerTests(unittest.TestCase):
    def setUp(self):
        self.orig = {
            "db_path": settings.db_path,
            "extreme_enabled": settings.extreme_enabled,
            "extreme_kill_switch": settings.extreme_kill_switch,
            "extreme_beta_user_ids": settings.extreme_beta_user_ids,
            "extreme_beta_emails": settings.extreme_beta_emails,
            "extreme_allowed_surfaces": settings.extreme_allowed_surfaces,
            "extreme_navigation_enabled": settings.extreme_navigation_enabled,
            "extreme_weather_enabled": settings.extreme_weather_enabled,
            "extreme_mapbox_weather_enabled": settings.extreme_mapbox_weather_enabled,
            "extreme_voice_enabled": settings.extreme_voice_enabled,
            "extreme_copilot_enabled": settings.extreme_copilot_enabled,
            "extreme_mission_control_enabled": settings.extreme_mission_control_enabled,
            "extreme_adventure_scores_enabled": settings.extreme_adventure_scores_enabled,
            "extreme_mission_provider_evidence_enabled": settings.extreme_mission_provider_evidence_enabled,
            "extreme_copilot_wake_phrase_enabled": settings.extreme_copilot_wake_phrase_enabled,
            "extreme_mapgpt_pilot_enabled": settings.extreme_mapgpt_pilot_enabled,
            "extreme_atlas_pilot_enabled": settings.extreme_atlas_pilot_enabled,
            "mapbox_token": settings.mapbox_token,
        }
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        settings.db_path = tmp.name
        settings.extreme_enabled = True
        settings.extreme_kill_switch = False
        settings.extreme_beta_user_ids = ""
        settings.extreme_beta_emails = ""
        settings.extreme_allowed_surfaces = "map_layers"
        settings.extreme_navigation_enabled = False
        settings.extreme_weather_enabled = False
        settings.extreme_mapbox_weather_enabled = False
        settings.extreme_voice_enabled = False
        settings.extreme_copilot_enabled = False
        settings.extreme_mission_control_enabled = False
        settings.extreme_adventure_scores_enabled = False
        settings.extreme_mission_provider_evidence_enabled = False
        settings.extreme_copilot_wake_phrase_enabled = False
        settings.extreme_mapgpt_pilot_enabled = False
        settings.extreme_atlas_pilot_enabled = False
        settings.mapbox_token = "pk.test"
        store.init_db()

    def tearDown(self):
        for key, value in self.orig.items():
            setattr(settings, key, value)

    def test_extreme_config_blocks_normal_user_and_allows_admin(self):
        normal = {"id": 11, "email": "free@example.com", "is_admin": 0, "plan_type": "free"}
        admin = {"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"}

        normal_cfg = _extreme_config_for_user(normal)
        admin_cfg = _extreme_config_for_user(admin)

        self.assertFalse(normal_cfg["enabled"])
        self.assertFalse(normal_cfg["entitled"])
        self.assertTrue(admin_cfg["enabled"])
        self.assertTrue(admin_cfg["entitled"])
        self.assertTrue(admin_cfg["guardrails"]["navigation_sessions"])
        self.assertTrue(admin_cfg["feature_flags"]["search"])
        self.assertTrue(admin_cfg["feature_flags"]["copilot"])
        self.assertTrue(admin_cfg["feature_flags"]["mission_control"])
        self.assertTrue(admin_cfg["feature_flags"]["adventure_scores"])
        self.assertIn("navigation", admin_cfg["allowed_surfaces"])
        self.assertIn("route_builder", admin_cfg["allowed_surfaces"])
        self.assertIn("outdoors", admin_cfg["style_uris"])

    def test_admin_gets_extreme_access_when_public_beta_disabled(self):
        settings.extreme_enabled = False
        store.set_extreme_admin_config({
            "enabled": False,
            "allowed_surfaces": ["map_layers"],
            "navigation_enabled": False,
            "weather_enabled": False,
        })

        admin_cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})
        normal_cfg = _extreme_config_for_user({"id": 11, "email": "free@example.com", "is_admin": 0, "plan_type": "free"})

        self.assertTrue(admin_cfg["enabled"])
        self.assertTrue(admin_cfg["beta_active"])
        self.assertTrue(admin_cfg["feature_flags"]["navigation"])
        self.assertTrue(admin_cfg["feature_flags"]["weather"])
        self.assertIn("navigation", admin_cfg["allowed_surfaces"])
        self.assertFalse(normal_cfg["enabled"])

    def test_kill_switch_blocks_even_entitled_user(self):
        settings.extreme_kill_switch = True
        settings.extreme_beta_emails = "beta@example.com"

        cfg = _extreme_config_for_user({"id": 9, "email": "beta@example.com", "is_admin": 0, "plan_type": "free"})

        self.assertTrue(cfg["kill_switch"])
        self.assertTrue(cfg["entitled"])
        self.assertFalse(cfg["enabled"])

    def test_admin_overrides_can_disable_and_enable_features(self):
        store.set_extreme_admin_config({
            "enabled": False,
            "navigation_enabled": True,
            "weather_enabled": True,
            "allowed_surfaces": ["map_layers", "navigation", "weather"],
            "cost_cap_cents_daily": 1234,
        })

        disabled_cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})
        self.assertTrue(disabled_cfg["beta_active"])
        self.assertTrue(disabled_cfg["feature_flags"]["navigation"])

        store.set_extreme_admin_config({"enabled": True})
        enabled_cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})
        self.assertTrue(enabled_cfg["beta_active"])
        self.assertTrue(enabled_cfg["feature_flags"]["navigation"])
        self.assertTrue(enabled_cfg["feature_flags"]["weather"])
        self.assertEqual(enabled_cfg["weather"]["provider"], "trailhead")
        self.assertFalse(enabled_cfg["weather"]["mapbox_conditions_enabled"])
        self.assertIn("navigation", enabled_cfg["allowed_surfaces"])
        self.assertEqual(enabled_cfg["cost_caps"]["daily_cents"], 1234)

    def test_mapbox_weather_requires_explicit_provider_gate(self):
        settings.extreme_weather_enabled = True
        settings.extreme_mapbox_weather_enabled = False

        cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})

        self.assertTrue(cfg["feature_flags"]["weather"])
        self.assertEqual(cfg["weather"]["provider"], "trailhead")
        self.assertFalse(cfg["weather"]["mapbox_conditions_enabled"])

        settings.extreme_mapbox_weather_enabled = True
        cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})

        self.assertEqual(cfg["weather"]["provider"], "mapbox")
        self.assertTrue(cfg["weather"]["mapbox_conditions_enabled"])

    def test_mapbox_directions_url_uses_semicolon_coordinate_path(self):
        url = _mapbox_directions_url("mapbox/driving-traffic", ["-120.000000,38.000000", "-119.500000,38.500000"])

        self.assertEqual(
            url,
            "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/-120.000000,38.000000;-119.500000,38.500000",
        )
        self.assertEqual(_clean_mapbox_param("motorway,toll,ferry!@", r"[^a-zA-Z_,]+", 80), "motorway,toll,ferry")

    def test_mapbox_session_hash_is_stable_and_not_raw_token(self):
        token = "raw-session-token-123"

        hashed = _mapbox_session_hash(token)

        self.assertEqual(hashed, _mapbox_session_hash(token))
        self.assertEqual(len(hashed), 16)
        self.assertNotEqual(hashed, token)
        self.assertEqual(_mapbox_session_hash(""), "")

    def test_canonical_landmark_geocode_prefers_eiffel_tower_not_roads(self):
        hit = _canonical_landmark_geocode("bring me to the eifel tower")

        self.assertEqual(hit[0]["name"], "Eiffel Tower, Paris, France")
        self.assertAlmostEqual(hit[0]["lat"], 48.85837, places=4)
        self.assertEqual(_canonical_landmark_geocode("Eiffel Tower Road"), [])

    def test_geocode_resolver_enforces_explicit_country(self):
        self.assertEqual(_countrycodes_for_query("take me to Paris France"), "fr")
        result = _resolve_geocode_candidates("Paris France", [
            {
                "name": "Paris, Texas, United States",
                "lat": 33.6609,
                "lng": -95.5555,
                "source": "mapbox",
                "place_id": "place.paris-tx",
                "feature_type": "place",
                "place_types": ["place"],
                "country_code": "us",
                "relevance": 0.99,
            },
            {
                "name": "Paris, France",
                "lat": 48.8566,
                "lng": 2.3522,
                "source": "mapbox",
                "place_id": "place.paris-fr",
                "feature_type": "place",
                "place_types": ["place"],
                "country_code": "fr",
                "relevance": 0.98,
            },
        ], "fr")

        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["selected"]["country_code"], "fr")
        self.assertEqual(result["selected"]["name"], "Paris, France")
        self.assertEqual(result["rejected"][0]["reason"], "country_mismatch")

    def test_geocode_resolver_keeps_explicit_roads_possible(self):
        result = _resolve_geocode_candidates("Eiffel Tower Road", [
            {
                "name": "Eiffel Tower Road, Missouri, United States",
                "lat": 37.0,
                "lng": -93.0,
                "source": "mapbox",
                "place_id": "address.road",
                "feature_type": "street",
                "place_types": ["street"],
                "country_code": "us",
                "relevance": 0.9,
            },
            {
                "name": "Eiffel Tower, Paris, France",
                "lat": 48.85837,
                "lng": 2.29448,
                "source": "trailhead_landmark",
                "place_id": "trailhead_landmark:eiffel_tower",
                "feature_type": "landmark",
                "place_types": ["poi", "landmark"],
                "country_code": "fr",
                "relevance": 1.0,
            },
        ], "")

        self.assertEqual(result["selected"]["name"], "Eiffel Tower Road, Missouri, United States")

    def test_env_kill_switch_overrides_dashboard(self):
        store.set_extreme_admin_config({"enabled": True, "kill_switch": False, "navigation_enabled": True})
        settings.extreme_kill_switch = True

        cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})

        self.assertTrue(cfg["kill_switch"])
        self.assertFalse(cfg["beta_active"])
        self.assertFalse(cfg["feature_flags"]["navigation"])

    def test_demo_session_and_ledger_are_non_navigation_records(self):
        uid = store.create_user("beta@example.com", "betauser", "hash", "beta-code")
        session = store.create_extreme_demo_session(uid, "map_layers", "trip-1", 120, {"source": "test"})
        event_id = store.log_extreme_ledger_event(
            uid,
            "demo_session_started",
            session["session_id"],
            "map_layers",
            "trip-1",
            {"navigation_session_authorized": False},
        )
        ended = store.end_extreme_demo_session(uid, session["session_id"], "closed")

        self.assertTrue(session["session_id"].startswith("extreme_"))
        self.assertGreater(event_id, 0)
        self.assertEqual(ended["status"], "closed")

    def test_extreme_navigation_flag_is_explicit(self):
        settings.extreme_navigation_enabled = True
        settings.extreme_allowed_surfaces = "map_layers,navigation"

        cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})

        self.assertTrue(cfg["feature_flags"]["navigation"])
        self.assertTrue(cfg["guardrails"]["navigation_sessions"])
        self.assertIn("navigation", cfg["allowed_surfaces"])
        self.assertFalse(cfg["navigation"]["free_drive"])

    def test_navigation_authorization_requires_confirmation_and_blocks_free_drive(self):
        settings.extreme_navigation_enabled = True
        settings.extreme_allowed_surfaces = "map_layers,navigation"
        uid = store.create_user("nav@example.com", "navuser", "hash", "nav-code")
        admin = {"id": uid, "email": "nav@example.com", "is_admin": 1, "plan_type": "free"}

        with self.assertRaises(HTTPException) as missing_ack:
            extreme_authorize_navigation(
                ExtremeNavigationAuthorizeRequest(surface="navigation", acknowledged_billing=False),
                user=admin,
            )
        self.assertEqual(missing_ack.exception.status_code, 400)

        with self.assertRaises(HTTPException) as free_drive:
            extreme_authorize_navigation(
                ExtremeNavigationAuthorizeRequest(surface="navigation", acknowledged_billing=True, navigation_mode="free_drive"),
                user=admin,
            )
        self.assertEqual(free_drive.exception.status_code, 400)

        result = extreme_authorize_navigation(
            ExtremeNavigationAuthorizeRequest(surface="navigation", acknowledged_billing=True, navigation_mode="route_guidance", route_id="route-1"),
            user=admin,
        )
        self.assertTrue(result["navigation_session_authorized"])
        self.assertFalse(result["free_drive_authorized"])
        self.assertEqual(result["route_id"], "route-1")

    def test_copilot_actions_are_staged_not_mutated(self):
        uid = store.create_user("pilot@example.com", "pilotuser", "hash", "pilot-code")
        action_type, message = _classify_extreme_command("find fuel before the remote stretch")
        action = store.stage_extreme_copilot_action(
            uid,
            "find fuel before the remote stretch",
            action_type,
            "extreme_session",
            "trip-42",
            {"response": message, "requires_confirmation": True},
        )

        self.assertEqual(action["status"], "staged")
        self.assertEqual(action["action_type"], "add_fuel")
        self.assertTrue(action["payload"]["requires_confirmation"])

    def test_map_action_contract_stages_interactive_map_work(self):
        context = {
            "user": {"location": {"lat": 38.1, "lng": -120.2}},
            "map": {"center": {"lat": 38.2, "lng": -120.3}, "zoom": 10},
            "route": {"active_route": True},
            "app": {"route_scout_enabled": True},
        }
        rig_context = {
            "user": {
                "location": {"lat": 38.1, "lng": -120.2},
                "rig_profile": {"vehicle_type": "truck", "fuel_range_miles": 240, "mpg": 15},
            },
            "map": {"center": {"lat": 38.2, "lng": -120.3}, "zoom": 10},
            "app": {"route_scout_enabled": True},
        }

        fuel = _build_extreme_map_action("find fuel before the remote stretch", context)
        weather = _build_extreme_map_action("turn on radar", context)
        route = _build_extreme_map_action("route me there", context)
        route_named = _build_extreme_map_action("preview a route to the Eiffel Tower", context)
        pin = _build_extreme_map_action("drop a pin here", context)
        second = _build_extreme_map_action("take me to the second result", context)
        lands = _build_extreme_map_action("show public lands", context)
        satellite = _build_extreme_map_action("switch to satellite", context)
        topo = _build_extreme_map_action("turn on topo", context)
        food = _build_extreme_map_action("find me something to eat near the Eiffel Tower", context)
        best_food = _build_extreme_map_action("open the best place to eat near the Eiffel Tower", context)
        pizza = _build_extreme_map_action("yeah pizza is nice", context)
        pizza_near_me = _build_extreme_map_action("find pizza near me", context)
        views = _build_extreme_map_action("show me cool views near Big Sur", context)
        hotels = _build_extreme_map_action("show hotels near the Eiffel Tower", context)
        fly = _build_extreme_map_action("go to Big Sur", context)
        zoom_in = _build_extreme_map_action("zoom in", context)
        zoom_out = _build_extreme_map_action("zoom out", context)
        zoom_visible = _build_extreme_map_action("zoom in on the hotel on the left", context)
        stable_second = _build_extreme_map_action("open the second result", {
            "map": {
                "center": {"lat": 38.2, "lng": -120.3},
                "current_result_set_id": "places_123",
                "current_results": [
                    {"result_set_id": "places_123", "result_id": "place:first", "id": "first", "name": "First Cafe", "type": "food"},
                    {"result_set_id": "places_123", "result_id": "place:second", "id": "second", "name": "Second Cafe", "type": "food"},
                ],
            },
        })
        ambiguous_places = _build_extreme_map_action("find places nearby", context)
        nav = _build_extreme_map_action("start navigation", context)
        builder = _build_extreme_map_action("Plan a wild dispersed 5-day route from Moab to Big Sur", context)
        builder_shorthand = _build_extreme_map_action("Build Moab to Big Sur", context)
        builder_route_from = _build_extreme_map_action("Route from Moab to Big Sur", context)
        builder_reversed = _build_extreme_map_action("plan 5 days to Big Sur from Moab dispersed mostly camping", rig_context)
        scout_followup = _build_extreme_map_action("5 hours", {
            "route": {
                "route_scout": {
                    "status": "needs_input",
                    "draftArgs": {"start": "Moab", "destination": "Big Sur", "days": 5, "routeStyle": "wild"},
                }
            }
        })
        scout_rig_tune = _build_extreme_map_action("use my rig profile and keep it dispersed", {
            "user": {"rig_profile": {"vehicle_type": "truck", "fuel_range_miles": 240}},
            "route": {
                "route_scout": {
                    "status": "ready",
                    "draftArgs": {"start": "Moab", "destination": "Big Sur", "days": 5, "routeStyle": "wild"},
                }
            },
            "app": {"route_scout_enabled": True},
        })
        builder_draft = _build_extreme_map_action("open a route builder draft from Moab to Big Sur", context)
        builder_update = _build_extreme_map_action("Make it private stays", context)
        builder_build = _build_extreme_map_action("Build it", context)
        offline = _build_extreme_map_action("Show offline downloads for this route", context)
        reports = _build_extreme_map_action("What reports are nearby?", context)
        rig = _build_extreme_map_action("Open my rig profile", context)
        mission = _build_extreme_map_action("Is this trip ready?", context)

        self.assertEqual(fuel["action_type"], "searchPlaces")
        self.assertFalse(fuel["requires_confirmation"])
        self.assertEqual(fuel["args"]["category"], "fuel")
        self.assertEqual(weather["action_type"], "toggleLayer")
        self.assertEqual(weather["args"]["layer"], "radar")
        self.assertEqual(route["action_type"], "buildRoute")
        self.assertFalse(route["requires_confirmation"])
        self.assertEqual(route_named["action_type"], "buildRoute")
        self.assertEqual(route_named["args"]["query"].lower(), "the eiffel tower")
        self.assertEqual(pin["action_type"], "dropPin")
        self.assertTrue(pin["requires_confirmation"])
        self.assertEqual(pin["args"]["pin_type"], "other")
        self.assertEqual(second["action_type"], "selectPlace")
        self.assertEqual(second["args"]["result_index"], 1)
        self.assertEqual(stable_second["action_type"], "selectPlace")
        self.assertEqual(stable_second["args"]["result_set_id"], "places_123")
        self.assertEqual(stable_second["args"]["result_id"], "place:second")
        self.assertEqual(stable_second["args"]["name"], "Second Cafe")
        self.assertEqual(ambiguous_places["action_type"], "askForConfirmation")
        self.assertEqual(ambiguous_places["args"]["reason"], "ambiguous_place_category")
        self.assertIn("lodging", ambiguous_places["args"]["options"])
        self.assertEqual(lands["action_type"], "toggleLayer")
        self.assertEqual(lands["args"]["layer"], "lands")
        self.assertEqual(satellite["action_type"], "setMapStyle")
        self.assertEqual(satellite["args"]["style"], "satellite")
        self.assertEqual(topo["action_type"], "setMapStyle")
        self.assertEqual(topo["args"]["style"], "topo")
        self.assertEqual(food["action_type"], "searchPlaces")
        self.assertEqual(food["args"]["category"], "food")
        self.assertEqual(food["args"]["query"].lower(), "the eiffel tower")
        self.assertFalse(food["args"]["open_card"])
        self.assertTrue(best_food["args"]["open_card"])
        self.assertEqual(pizza["action_type"], "searchPlaces")
        self.assertEqual(pizza["args"]["category"], "food")
        self.assertEqual(pizza["args"]["keyword"], "pizza")
        self.assertEqual(pizza["args"]["query"], "")
        self.assertFalse(pizza["args"]["open_card"])
        self.assertEqual(pizza_near_me["action_type"], "searchPlaces")
        self.assertEqual(pizza_near_me["args"]["category"], "food")
        self.assertEqual(pizza_near_me["args"]["keyword"], "pizza")
        self.assertEqual(pizza_near_me["args"]["query"], "")
        self.assertEqual(views["action_type"], "searchPlaces")
        self.assertEqual(views["args"]["category"], "viewpoint")
        self.assertEqual(views["args"]["query"].lower(), "big sur")
        self.assertFalse(views["args"]["open_card"])
        self.assertEqual(hotels["action_type"], "searchPlaces")
        self.assertEqual(hotels["args"]["category"], "lodging")
        self.assertEqual(hotels["args"]["query"].lower(), "the eiffel tower")
        self.assertEqual(fly["action_type"], "flyToPlace")
        self.assertEqual(fly["args"]["query"], "big sur")
        self.assertEqual(zoom_in["action_type"], "zoomMap")
        self.assertEqual(zoom_in["args"]["direction"], "in")
        self.assertEqual(zoom_out["action_type"], "zoomMap")
        self.assertEqual(zoom_out["args"]["direction"], "out")
        self.assertEqual(zoom_visible["action_type"], "zoomMap")
        self.assertEqual(zoom_visible["args"]["type"], "lodging")
        self.assertEqual(zoom_visible["args"]["screen_position"], "left")
        self.assertEqual(nav["action_type"], "startNavigation")
        self.assertTrue(nav["requires_confirmation"])
        self.assertEqual(builder["action_type"], "startRouteScout")
        self.assertEqual(builder["args"]["draft"]["routeStyle"], "wild")
        self.assertEqual(builder["args"]["draft"]["campPreference"], "public")
        self.assertEqual(builder["args"]["draft"]["days"], 5)
        self.assertEqual(builder["args"]["draft"]["start"].lower(), "moab")
        self.assertEqual(builder["args"]["draft"]["destination"].lower(), "big sur")
        self.assertEqual(builder["args"]["draft"]["fuelStrategy"], "auto_when_needed")
        self.assertEqual(builder_shorthand["action_type"], "startRouteScout")
        self.assertEqual(builder_shorthand["args"]["draft"]["start"].lower(), "moab")
        self.assertEqual(builder_shorthand["args"]["draft"]["destination"].lower(), "big sur")
        self.assertEqual(builder_route_from["action_type"], "startRouteScout")
        self.assertEqual(builder_route_from["args"]["draft"]["start"].lower(), "moab")
        self.assertEqual(builder_route_from["args"]["draft"]["destination"].lower(), "big sur")
        self.assertEqual(builder_reversed["action_type"], "startRouteScout")
        self.assertEqual(builder_reversed["args"]["draft"]["campPreference"], "public")
        self.assertEqual(builder_reversed["args"]["draft"]["days"], 5)
        self.assertEqual(builder_reversed["args"]["draft"]["start"].lower(), "moab")
        self.assertEqual(builder_reversed["args"]["draft"]["destination"].lower(), "big sur")
        self.assertTrue(builder_reversed["args"]["draft"]["useRigProfile"])
        self.assertEqual(builder_reversed["args"]["draft"]["rigConstraints"]["fuel_range_miles"], 240)
        self.assertEqual(scout_followup["action_type"], "startRouteScout")
        self.assertEqual(scout_followup["args"]["draft"]["driveHours"], 5)
        self.assertEqual(scout_followup["args"]["draft"]["destination"], "Big Sur")
        self.assertEqual(scout_rig_tune["action_type"], "startRouteScout")
        self.assertTrue(scout_rig_tune["args"]["draft"]["useRigProfile"])
        self.assertEqual(scout_rig_tune["args"]["draft"]["campPreference"], "public")
        self.assertEqual(builder_draft["action_type"], "openRouteBuilderDraft")
        self.assertEqual(builder_update["action_type"], "updateRouteBuilderDraft")
        self.assertEqual(builder_update["args"]["draft"]["campPreference"], "private")
        self.assertEqual(builder_build["action_type"], "buildRouteBuilderFramework")
        self.assertEqual(offline["action_type"], "openOfflineDownloads")
        self.assertEqual(reports["action_type"], "openReports")
        self.assertEqual(rig["action_type"], "openRigProfile")
        self.assertEqual(mission["action_type"], "showMissionControl")
        self.assertFalse(mission["requires_confirmation"])

    def test_copilot_wake_phrase_requires_explicit_flag(self):
        admin = {"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"}

        cfg = _extreme_config_for_user(admin)
        self.assertTrue(cfg["copilot"]["voice_enabled"])
        self.assertFalse(cfg["copilot"]["wake_phrase"])

        settings.extreme_copilot_wake_phrase_enabled = True
        cfg = _extreme_config_for_user(admin)
        self.assertTrue(cfg["copilot"]["wake_phrase"])

    def test_copilot_realtime_instructions_reject_filler_noise(self):
        instructions = _copilot_realtime_instructions(False).lower()
        turn_detection = _copilot_realtime_turn_detection()

        self.assertIn("filler", instructions)
        self.assertIn("silence", instructions)
        self.assertIn("do not answer", instructions)
        self.assertGreaterEqual(turn_detection["threshold"], 0.9)
        self.assertGreaterEqual(turn_detection["silence_duration_ms"], 1400)
        self.assertLessEqual(turn_detection["prefix_padding_ms"], 300)

    def test_copilot_confirmation_updates_staged_action(self):
        uid = store.create_user("confirm@example.com", "confirmuser", "hash", "confirm-code")
        action = store.stage_extreme_copilot_action(
            uid,
            "drop a pin here",
            "dropPin",
            "extreme_session",
            "trip-42",
            {"map_action": {"action_type": "dropPin", "cost_class": "local"}},
        )

        updated = store.confirm_extreme_copilot_action(uid, action["id"], True, {"applied": True})

        self.assertEqual(updated["status"], "applied")
        self.assertTrue(updated["payload"]["confirmation"]["confirmed"])
        self.assertEqual(updated["payload"]["confirmation"]["status"], "applied")
        self.assertTrue(updated["payload"]["confirmation"]["client_result"]["applied"])

    def test_copilot_confirmation_records_failed_and_canceled_status(self):
        uid = store.create_user("status@example.com", "statususer", "hash", "status-code")
        failed = store.stage_extreme_copilot_action(
            uid,
            "save this trip",
            "saveTrip",
            "extreme_session",
            "trip-42",
            {"map_action": {"action_type": "saveTrip", "cost_class": "local"}},
        )
        canceled = store.stage_extreme_copilot_action(
            uid,
            "download offline area",
            "downloadOfflineArea",
            "extreme_session",
            "trip-42",
            {"map_action": {"action_type": "downloadOfflineArea", "cost_class": "local"}},
        )

        failed_update = store.confirm_extreme_copilot_action(uid, failed["id"], True, {"applied": False, "reason": "no_active_trip"})
        canceled_update = store.confirm_extreme_copilot_action(uid, canceled["id"], False, {"confirmed": False})

        self.assertEqual(failed_update["status"], "failed")
        self.assertEqual(failed_update["payload"]["confirmation"]["status"], "failed")
        self.assertEqual(canceled_update["status"], "canceled")
        self.assertEqual(canceled_update["payload"]["confirmation"]["status"], "canceled")


if __name__ == "__main__":
    unittest.main()
