import unittest

from dashboard.adventure_intelligence import build_mission_control


def base_payload():
    return {
        "trip_id": "trip-test",
        "route": [[-109.55, 38.57], [-109.48, 38.63], [-109.4, 38.7]],
        "checkpoints": [
            {
                "id": "start",
                "type": "start",
                "title": "Moab",
                "lat": 38.5733,
                "lng": -109.5498,
                "day": 1,
                "source": "trailhead",
                "confidence": "high",
            },
            {
                "id": "camp-1",
                "type": "camp",
                "title": "Willow Flat Campground",
                "lat": 38.38,
                "lng": -109.88,
                "day": 1,
                "source": "nps",
                "confidence": "high",
            },
        ],
        "places": [
            {
                "id": "fuel-1",
                "type": "fuel",
                "title": "Moab Fuel",
                "lat": 38.58,
                "lng": -109.56,
                "source": "trailhead",
                "confidence": "high",
            }
        ],
        "trip_memory": {
            "vehicle": {"type": "truck"},
            "range": {"miles": 250},
            "clearance": {"inches": 9},
            "offline_readiness": {"route": True, "maps": "downloaded"},
        },
        "context": {"route": {"active_route": True}, "map": {"visible_map_features": []}},
        "metadata": {"days": 1},
    }


class AdventureIntelligenceTests(unittest.TestCase):
    def test_ready_trip_uses_attached_sources_without_provider_calls(self):
        brief = build_mission_control(base_payload())

        self.assertEqual(brief["readiness"], "ready")
        self.assertEqual(brief["debug"]["provider_calls"], 0)
        self.assertTrue(any(score["id"] == "route_geometry" and score["status"] == "ready" for score in brief["scores"]))
        self.assertEqual(brief["overnights"][0]["name"], "Willow Flat Campground")

    def test_missing_route_geometry_blocks_readiness(self):
        payload = base_payload()
        payload["route"] = []
        payload["checkpoints"] = payload["checkpoints"][:1]

        brief = build_mission_control(payload)

        self.assertEqual(brief["readiness"], "blocked")
        self.assertTrue(any(risk["id"] == "route_missing_geometry" for risk in brief["risks"]))

    def test_placeholder_overnight_needs_review(self):
        payload = base_payload()
        payload["checkpoints"][1]["title"] = "Campsite"
        payload["checkpoints"][1]["confidence"] = "estimated"

        brief = build_mission_control(payload)

        self.assertEqual(brief["readiness"], "needs_review")
        self.assertEqual(brief["overnights"][0]["status"], "review_area")
        self.assertTrue(any(risk["id"] == "overnight_placeholder" for risk in brief["risks"]))

    def test_fuel_gap_over_range_blocks_without_fuel_stop(self):
        payload = base_payload()
        payload["route"] = [[-109.55, 38.57], [-106.65, 39.75], [-104.99, 39.74]]
        payload["places"] = []
        payload["trip_memory"]["range"] = {"miles": 60}

        brief = build_mission_control(payload)

        self.assertEqual(brief["readiness"], "blocked")
        self.assertTrue(any(risk["id"] == "fuel_gap_over_range" for risk in brief["risks"]))
        self.assertTrue(any(rec["action_type"] == "searchPlaces" and rec["args"]["category"] == "fuel" for rec in brief["recommendations"]))

    def test_estimated_preview_fuel_does_not_clear_range_block(self):
        payload = base_payload()
        payload["route"] = [[-109.55, 38.57], [-106.65, 39.75], [-104.99, 39.74]]
        payload["places"] = [
            {
                "id": "extreme-fuel-check",
                "type": "fuel",
                "title": "Fuel before remote stretch",
                "lat": 38.6,
                "lng": -109.6,
                "source": "trailhead",
                "source_label": "Trailhead preview",
                "confidence": "estimated",
            }
        ]
        payload["trip_memory"]["range"] = {"miles": 60}

        brief = build_mission_control(payload)

        self.assertEqual(brief["readiness"], "blocked")
        self.assertTrue(any(risk["id"] == "fuel_gap_over_range" for risk in brief["risks"]))

    def test_undated_stay_does_not_satisfy_every_multiday_night(self):
        payload = base_payload()
        payload["metadata"] = {"days": 3}
        payload["checkpoints"] = [payload["checkpoints"][0]]
        payload["places"] = [
            {
                "id": "camp-undated",
                "type": "camp",
                "title": "Known Camp",
                "lat": 38.5,
                "lng": -109.7,
                "source": "nps",
                "confidence": "high",
            }
        ]

        brief = build_mission_control(payload)

        self.assertEqual(brief["readiness"], "needs_review")
        self.assertEqual(len(brief["overnights"]), 3)
        self.assertEqual([night["status"] for night in brief["overnights"]], ["missing", "missing", "missing"])
        self.assertTrue(any(risk["id"] == "overnight_missing" for risk in brief["risks"]))

    def test_visible_fuel_pollution_needs_filtering(self):
        payload = base_payload()
        payload["context"] = {
            "route": {"active_route": True},
            "map": {
                "visible_map_features": [
                    {"type": "fuel"},
                    {"type": "grocery"},
                    {"type": "shop"},
                    {"type": "food"},
                    {"type": "fuel"},
                ]
            },
        }

        brief = build_mission_control(payload)

        self.assertEqual(brief["readiness"], "needs_review")
        self.assertTrue(any(risk["id"] == "visible_context_pollution" for risk in brief["risks"]))
        self.assertTrue(any(rec["action_type"] == "applyMissionFilter" for rec in brief["recommendations"]))


if __name__ == "__main__":
    unittest.main()
