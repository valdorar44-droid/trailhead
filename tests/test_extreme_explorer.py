import tempfile
import unittest

from config.settings import settings
from dashboard.server import _classify_extreme_command, _extreme_config_for_user
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
            "extreme_voice_enabled": settings.extreme_voice_enabled,
            "extreme_copilot_enabled": settings.extreme_copilot_enabled,
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
        settings.extreme_allowed_surfaces = "map,route_builder"
        settings.extreme_navigation_enabled = False
        settings.extreme_weather_enabled = False
        settings.extreme_voice_enabled = False
        settings.extreme_copilot_enabled = True
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
        self.assertFalse(admin_cfg["guardrails"]["navigation_sessions"])
        self.assertTrue(admin_cfg["feature_flags"]["search"])
        self.assertTrue(admin_cfg["feature_flags"]["copilot"])
        self.assertIn("outdoors", admin_cfg["style_uris"])

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
            "allowed_surfaces": ["map", "navigation", "weather"],
            "cost_cap_cents_daily": 1234,
        })

        disabled_cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})
        self.assertFalse(disabled_cfg["beta_active"])
        self.assertFalse(disabled_cfg["feature_flags"]["navigation"])

        store.set_extreme_admin_config({"enabled": True})
        enabled_cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})
        self.assertTrue(enabled_cfg["beta_active"])
        self.assertTrue(enabled_cfg["feature_flags"]["navigation"])
        self.assertTrue(enabled_cfg["feature_flags"]["weather"])
        self.assertIn("navigation", enabled_cfg["allowed_surfaces"])
        self.assertEqual(enabled_cfg["cost_caps"]["daily_cents"], 1234)

    def test_env_kill_switch_overrides_dashboard(self):
        store.set_extreme_admin_config({"enabled": True, "kill_switch": False, "navigation_enabled": True})
        settings.extreme_kill_switch = True

        cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})

        self.assertTrue(cfg["kill_switch"])
        self.assertFalse(cfg["beta_active"])
        self.assertFalse(cfg["feature_flags"]["navigation"])

    def test_demo_session_and_ledger_are_non_navigation_records(self):
        uid = store.create_user("beta@example.com", "betauser", "hash", "beta-code")
        session = store.create_extreme_demo_session(uid, "map", "trip-1", 120, {"source": "test"})
        event_id = store.log_extreme_ledger_event(
            uid,
            "demo_session_started",
            session["session_id"],
            "map",
            "trip-1",
            {"navigation_session_authorized": False},
        )
        ended = store.end_extreme_demo_session(uid, session["session_id"], "closed")

        self.assertTrue(session["session_id"].startswith("extreme_"))
        self.assertGreater(event_id, 0)
        self.assertEqual(ended["status"], "closed")

    def test_extreme_navigation_flag_is_explicit(self):
        settings.extreme_navigation_enabled = True
        settings.extreme_allowed_surfaces = "map,route_builder,navigation"

        cfg = _extreme_config_for_user({"id": 12, "email": "admin@example.com", "is_admin": 1, "plan_type": "free"})

        self.assertTrue(cfg["feature_flags"]["navigation"])
        self.assertTrue(cfg["guardrails"]["navigation_sessions"])
        self.assertIn("navigation", cfg["allowed_surfaces"])
        self.assertFalse(cfg["navigation"]["free_drive"])

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


if __name__ == "__main__":
    unittest.main()
