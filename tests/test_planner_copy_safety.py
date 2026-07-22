import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from ai import planner


def model_response(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(content=[SimpleNamespace(text=json.dumps(payload))])


class PlannerCopySafetyTests(unittest.TestCase):
    def test_system_prompts_do_not_claim_lived_experience_or_live_reports(self):
        combined = "\n".join((planner.CHAT_SYSTEM, planner.EDIT_SYSTEM, planner.SYSTEM_PROMPT))

        self.assertNotIn("You've driven these roads", combined)
        self.assertNotIn("camped these spots", combined)
        self.assertNotIn("real-time trail conditions", combined)
        self.assertNotIn("Trailhead AI", combined)
        self.assertIn("coverage varies by carrier and terrain", planner.SYSTEM_PROMPT)

    def test_campsite_summary_prompt_rejects_invented_rating_and_experience(self):
        payload = {
            "insider_tip": "",
            "best_for": "",
            "best_season": "",
            "nearby_highlights": [],
            "hazards": None,
            "star_rating": 5,
            "coordinates_dms": "38°34'12''N 109°33'00''W",
        }
        with patch.object(planner, "_create_message", return_value=model_response(payload)) as create:
            result = planner.generate_campsite_insight("Example Camp", 38.57, -109.55)

        prompt = create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("Do not invent first-hand experience, ratings", prompt)
        self.assertIn('"star_rating": 0', prompt)
        self.assertEqual(result["star_rating"], 0)

    def test_route_brief_prompt_states_limits_and_avoids_false_clear_state(self):
        payload = {
            "must_do_before_leaving": [
                "Check current road access with the responsible land manager.",
            ],
        }
        with patch.object(planner, "_create_message", return_value=model_response(payload)) as create:
            result = planner.generate_route_brief("Example Route", [{"day": 1, "name": "Moab"}])

        prompt = create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("not a safety certification", prompt)
        self.assertIn('A missing report means "no report supplied," not "no hazard."', prompt)
        self.assertIn("Unknown evidence stays unknown", prompt)
        self.assertNotIn('"readiness_score"', prompt)
        self.assertNotIn('"water_carry_gallons"', prompt)
        self.assertEqual(result["planning_status"], "Review required")
        self.assertEqual(result["fuel_status"], "Not checked")
        self.assertEqual(result["water_status"], "Not checked")
        self.assertEqual(result["signal_status"], "Not checked")
        self.assertEqual(result["fire_status"], "Not checked")
        self.assertEqual(result["exit_options_status"], "Not checked")

    def test_route_brief_ignores_fabricated_legacy_metrics_and_assurances(self):
        payload = {
            "readiness_score": 10,
            "estimated_fuel_stops": 4,
            "water_carry_gallons": 10,
            "signal_dead_zones": ["Three dead zones"],
            "fire_restriction_likelihood": "low",
            "emergency_bailout": "Use Highway 9",
            "briefing_summary": "This route is usable and ready.",
            "must_do_before_leaving": [
                "Pack 10 gallons per person.",
                "Confirm the route is safe and open.",
                "Download offline maps from your Download List in the app.",
            ],
        }
        with patch.object(planner, "_create_message", return_value=model_response(payload)):
            result = planner.generate_route_brief(
                "Long Route",
                [{"day": 1, "name": "Start"}, {"day": 2, "name": "Finish"}],
            )

        for removed in (
            "readiness_score", "estimated_fuel_stops", "water_carry_gallons",
            "signal_dead_zones", "fire_restriction_likelihood", "emergency_bailout",
        ):
            self.assertNotIn(removed, result)
        combined = json.dumps(result).lower()
        self.assertNotIn("route is usable", combined)
        self.assertNotIn("10 gallons", combined)
        self.assertNotIn("dead zones", combined)
        self.assertNotIn("highway 9", combined)
        self.assertIn("download offline maps", combined)

    def test_route_brief_uses_only_explicit_mapped_and_report_evidence(self):
        reports = [
            {"type": "fire", "description": "Fire restriction report", "waypoint_day": 2},
            {"type": "cellular", "description": "Coverage report", "waypoint_day": 3},
        ]
        waypoints = [
            {"day": 1, "name": "Moab", "type": "start"},
            {"day": 2, "name": "Mapped Fuel", "type": "fuel"},
            {"day": 2, "name": "Mapped Water", "type": "water"},
        ]
        with patch.object(planner, "_create_message", return_value=model_response({})):
            result = planner.generate_route_brief("Example Route", waypoints, reports)

        self.assertEqual(result["fuel_status"], "1 mapped fuel stop; availability is not checked.")
        self.assertEqual(result["water_status"], "1 mapped water-related stop; availability is not checked.")
        self.assertEqual(
            result["signal_status"],
            "Review 1 supplied signal report; current conditions are not verified.",
        )
        self.assertEqual(
            result["fire_status"],
            "Review 1 supplied fire report; current conditions are not verified.",
        )
        self.assertEqual(result["exit_options_status"], "Not checked")

    def test_route_brief_malformed_model_response_returns_honest_fallback(self):
        malformed = SimpleNamespace(content=[SimpleNamespace(text="not json")])
        with patch.object(planner, "_create_message", return_value=malformed):
            result = planner.generate_route_brief("Example Route", [{"day": 1, "name": "Moab"}])

        self.assertEqual(result["schema_version"], 2)
        self.assertEqual(result["planning_status"], "Review required")
        self.assertEqual(result["fuel_status"], "Not checked")
        self.assertTrue(result["must_do_before_leaving"])
        self.assertIn("have not been checked", result["briefing_summary"])


if __name__ == "__main__":
    unittest.main()
