import unittest

from ai.planner import _normalize_plan
from dashboard.server import _build_trip_timeline, _camp_pref_score, _camp_requires_review


def _base_plan(duration=3):
    waypoints = [{"day": 1, "name": "Moab, UT", "type": "start", "description": "", "land_type": "town"}]
    daily = []
    for day in range(1, duration + 1):
        daily.append({
            "day": day,
            "title": f"Day {day}",
            "description": "Drive and explore.",
            "est_miles": 180,
            "road_type": "mixed",
            "highlights": ["Viewpoint"],
        })
        if day < duration:
            waypoints.append({
                "day": day,
                "name": f"Public camp area day {day}, UT",
                "type": "camp",
                "description": "Legal public-land camp search area.",
                "land_type": "BLM",
            })
    waypoints.append({"day": duration, "name": "Moab, UT", "type": "waypoint", "description": "", "land_type": "town"})
    return {
        "trip_name": "Fixture Trip",
        "overview": "Fixture route",
        "duration_days": duration,
        "states": ["UT"],
        "total_est_miles": 9999,
        "waypoints": waypoints,
        "daily_itinerary": daily,
        "logistics": {},
    }


class PlannerTimelineTests(unittest.TestCase):
    def test_planner_normalization_caps_miles_and_inserts_rest_days(self):
        plan = _base_plan(duration=8)
        plan["daily_itinerary"][0]["est_miles"] = 500
        plan["daily_itinerary"][1]["est_miles"] = 220
        plan["daily_itinerary"][1]["road_type"] = "dirt"
        normalized = _normalize_plan(plan)

        self.assertEqual(normalized["duration_days"], 8)
        self.assertEqual(normalized["daily_itinerary"][0]["est_miles"], 250)
        self.assertEqual(normalized["daily_itinerary"][1]["est_miles"], 120)
        rest_days = [day for day in normalized["daily_itinerary"] if day["est_miles"] == 0]
        self.assertGreaterEqual(len(rest_days), 2)
        self.assertEqual(
            normalized["total_est_miles"],
            sum(day["est_miles"] for day in normalized["daily_itinerary"]),
        )
        self.assertTrue(any("capped" in msg for msg in normalized["planner_warnings"]))

    def test_planner_normalization_warns_on_missing_overnight(self):
        plan = _base_plan(duration=3)
        plan["waypoints"] = [wp for wp in plan["waypoints"] if wp["type"] != "camp"]
        normalized = _normalize_plan(plan)

        warning_text = " ".join(normalized["planner_warnings"])
        self.assertIn("Missing overnight waypoint", warning_text)
        self.assertIn("1", warning_text)
        self.assertIn("2", warning_text)

    def test_trip_timeline_orders_drive_fuel_poi_and_overnight_events(self):
        plan = _base_plan(duration=2)
        plan["waypoints"][0].update({"lat": 38.5733, "lng": -109.5498})
        plan["waypoints"][1].update({"lat": 38.62, "lng": -109.85})
        camps = [{
            "recommended_day": 1,
            "name": "BLM Camp Search Area",
            "lat": 38.62,
            "lng": -109.85,
            "verified_source": "BLM",
            "description": "Verified public camp near the route.",
        }]
        fuel = [{
            "recommended_day": 1,
            "name": "Moab Fuel",
            "lat": 38.57,
            "lng": -109.55,
            "source": "OSM",
            "address": "Main Street",
        }]
        pois = [{
            "recommended_day": 1,
            "name": "Official Viewpoint",
            "lat": 38.6,
            "lng": -109.7,
            "source": "NPS",
            "summary": "Official viewpoint near the route.",
        }]

        timeline = _build_trip_timeline(plan, camps, fuel, pois, "2 day Moab loop")
        day_one_types = [event["type"] for event in timeline["days"][0]["events"]]

        self.assertEqual(timeline["schema_version"], 1)
        self.assertIn("drive", day_one_types)
        self.assertIn("fuel", day_one_types)
        self.assertIn("poi", day_one_types)
        self.assertIn("overnight", day_one_types)
        self.assertTrue(timeline["offline_readiness"]["places"])
        self.assertEqual(timeline["days"][0]["warning_level"], "info")

    def test_trip_timeline_keeps_unsupported_region_warning_optional(self):
        plan = _base_plan(duration=2)
        timeline = _build_trip_timeline(plan, request_context="Plan Australia in a stock crossover")

        messages = [warning.get("message", "") for warning in timeline["warnings"]]
        self.assertTrue(any("outside current Trailhead planner support" in msg for msg in messages))

    def test_wild_camp_scoring_prefers_public_unless_region_supply_is_limited(self):
        blm_camp = {"name": "BLM Dispersed Area", "land_type": "BLM", "source": "blm", "tags": ["primitive"]}
        rv_park = {"name": "Private RV Park", "land_type": "private", "source": "commercial", "tags": ["rv park", "hookup"]}
        admin_office = {"name": "Spring Mountains National Recreation Area Office", "land_type": "Federal office", "source": "Recreation.gov"}

        self.assertTrue(_camp_requires_review(admin_office))
        self.assertFalse(_camp_requires_review(blm_camp))
        self.assertLess(
            _camp_pref_score(blm_camp, route_style="wild", camp_preference="public", region_hint="UT"),
            _camp_pref_score(rv_park, route_style="wild", camp_preference="public", region_hint="UT"),
        )
        self.assertLess(
            _camp_pref_score(blm_camp, route_style="wild", camp_preference="primitive", region_hint="NV"),
            _camp_pref_score(admin_office, route_style="wild_but_safe", camp_preference="primitive", region_hint="NV"),
        )
        self.assertLess(
            _camp_pref_score(rv_park, route_style="wild", camp_preference="public", region_hint="VT"),
            _camp_pref_score(rv_park, route_style="wild", camp_preference="public", region_hint="UT"),
        )


if __name__ == "__main__":
    unittest.main()
