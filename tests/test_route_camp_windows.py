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


if __name__ == "__main__":
    unittest.main()
