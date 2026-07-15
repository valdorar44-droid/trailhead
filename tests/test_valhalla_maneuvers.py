import unittest

import dashboard.server as server


def _osrm_step(maneuver_type: str, modifier: str = "") -> dict:
    return {
        "maneuver": {
            "type": maneuver_type,
            "modifier": modifier,
        },
    }


class ValhallaManeuverTests(unittest.TestCase):
    def test_osrm_adapter_emits_official_valhalla_maneuver_codes(self):
        cases = [
            (_osrm_step("depart", "straight"), True, False, 1),
            (_osrm_step("depart", "right"), True, False, 2),
            (_osrm_step("depart", "left"), True, False, 3),
            (_osrm_step("arrive", "straight"), False, True, 4),
            (_osrm_step("arrive", "right"), False, True, 5),
            (_osrm_step("arrive", "left"), False, True, 6),
            (_osrm_step("turn", "slight right"), False, False, 9),
            (_osrm_step("turn", "right"), False, False, 10),
            (_osrm_step("turn", "sharp right"), False, False, 11),
            (_osrm_step("turn", "uturn"), False, False, 12),
            (_osrm_step("turn", "sharp left"), False, False, 14),
            (_osrm_step("turn", "left"), False, False, 15),
            (_osrm_step("turn", "slight left"), False, False, 16),
            (_osrm_step("roundabout", "right"), False, False, 26),
            (_osrm_step("exit roundabout", "right"), False, False, 27),
        ]

        for step, is_first, is_last, expected in cases:
            with self.subTest(step=step, expected=expected):
                self.assertEqual(
                    server._osrm_maneuver_type(step, is_first, is_last),
                    expected,
                )

    def test_osrm_route_fixture_preserves_roundabout_exit(self):
        route = {
            "routes": [{
                "distance": 1_000,
                "duration": 90,
                "geometry": "",
                "legs": [{
                    "steps": [
                        {
                            "distance": 100,
                            "duration": 10,
                            "geometry": "",
                            "maneuver": {"type": "depart", "modifier": "straight"},
                        },
                        {
                            "distance": 800,
                            "duration": 70,
                            "geometry": "",
                            "maneuver": {"type": "roundabout", "modifier": "right", "exit": 3},
                        },
                        {
                            "distance": 100,
                            "duration": 10,
                            "geometry": "",
                            "maneuver": {"type": "arrive", "modifier": "straight"},
                        },
                    ],
                }],
            }],
        }

        result = server._osrm_to_valhalla(route, "miles")
        maneuvers = result["trip"]["legs"][0]["maneuvers"]

        self.assertEqual([maneuver["type"] for maneuver in maneuvers], [1, 26, 4])
        self.assertEqual(maneuvers[1]["roundabout_exit_count"], 3)
        self.assertEqual(result["_fallback"]["maneuver_schema"], "valhalla-v1")

    def test_planner_steps_preserve_valhalla_maneuver_semantics(self):
        cases = [
            (1, "depart", ""),
            (2, "depart", "right"),
            (3, "depart", "left"),
            (4, "arrive", ""),
            (5, "arrive", "right"),
            (6, "arrive", "left"),
            (9, "turn", "slight right"),
            (10, "turn", "right"),
            (11, "turn", "sharp right"),
            (12, "turn", "uturn"),
            (13, "turn", "uturn"),
            (14, "turn", "sharp left"),
            (15, "turn", "left"),
            (16, "turn", "slight left"),
            (26, "roundabout", ""),
            (27, "exit roundabout", ""),
        ]
        leg = {
            "maneuvers": [
                {
                    "type": code,
                    "instruction": f"Maneuver {code}",
                    "begin_shape_index": index,
                }
                for index, (code, _, _) in enumerate(cases)
            ],
        }
        leg_coords = [[-109.55 + index * 0.001, 38.57 + index * 0.001] for index in range(len(cases))]

        steps = server._planner_leg_steps(leg, leg_coords)

        self.assertEqual(
            [(step["type"], step["modifier"]) for step in steps],
            [(step_type, modifier) for _, step_type, modifier in cases],
        )

    def test_cached_osrm_fallback_maneuvers_are_upgraded(self):
        cached = {
            "trip": {
                "legs": [{
                    "maneuvers": [
                        {"type": 1, "_osrm": {"type": "depart", "modifier": "straight"}},
                        {"type": 3, "_osrm": {"type": "turn", "modifier": "right"}},
                        {"type": 4, "_osrm": {"type": "arrive", "modifier": "straight"}},
                    ],
                }],
            },
            "_fallback": {"engine": "osrm"},
        }

        result = server._normalize_osrm_fallback_maneuvers(cached)

        self.assertIs(result, cached)
        self.assertEqual(
            [maneuver["type"] for maneuver in cached["trip"]["legs"][0]["maneuvers"]],
            [1, 10, 4],
        )
        self.assertEqual(cached["_fallback"]["maneuver_schema"], "valhalla-v1")


if __name__ == "__main__":
    unittest.main()
