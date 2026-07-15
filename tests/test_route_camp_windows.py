import unittest

import dashboard.server as server


class RouteCampWindowModelTests(unittest.TestCase):
    def test_fractional_route_window_mile_markers_are_valid(self):
        body = server.RouteCampWindowsRequest(
            route=[
                {"lat": 38.57, "lng": -109.55},
                {"lat": 36.27, "lng": -121.81},
            ],
            windows=[
                {
                    "day": 1,
                    "start": 227.2,
                    "end": 286.9,
                    "label": "Day 1 overnight",
                    "target_mi": 257.05,
                    "search_window_mi": 59.7,
                }
            ],
            max_daily_drive_hours=5,
        )

        self.assertEqual(body.windows[0].start, 227.2)
        self.assertEqual(body.windows[0].end, 286.9)

    def test_route_window_target_is_clamped_to_short_route(self):
        points = [
            {"lat": 38.5733, "lng": -109.5498},
            {"lat": 38.7331, "lng": -109.5925},
        ]
        total_mi = server._route_distance_mi(points)
        window = server.RouteCampWindow(
            day=1,
            start=0,
            end=45,
            label="Day 1",
            target_mi=45,
            search_window_mi=30,
        )

        response = server._route_camp_window_review_response(window, points)

        self.assertAlmostEqual(response["target_mi"], total_mi)
        self.assertLessEqual(server._clamped_route_target_mi(45, total_mi) / total_mi, 1)


if __name__ == "__main__":
    unittest.main()
