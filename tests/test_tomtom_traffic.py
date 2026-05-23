import unittest

from config.settings import settings
from ingestors.tomtom_traffic import (
    bboxes_for_route_corridor,
    filter_alerts_near_waypoints,
    get_tomtom_incidents_for_bbox,
    normalize_tomtom_category,
)


class TomTomTrafficTests(unittest.TestCase):
    def test_category_normalization(self):
        cases = {
            "accident": "hazard",
            "disabled-vehicle": "hazard",
            "weather": "hazard",
            "road-closed": "closure",
            "lane-restriction": "closure",
            "roadworks": "road_condition",
            "planned-event": "road_condition",
            "jam": "traffic",
            "congestion": "traffic",
        }
        for category, expected in cases.items():
            with self.subTest(category=category):
                self.assertEqual(normalize_tomtom_category(category), expected)

    def test_numeric_category_normalization(self):
        self.assertEqual(normalize_tomtom_category(1), "hazard")
        self.assertEqual(normalize_tomtom_category(8), "closure")
        self.assertEqual(normalize_tomtom_category(9), "road_condition")

    def test_route_corridor_filtering_adds_waypoint_day(self):
        alerts = [
            {"id": "tomtom:1", "lat": 40.01, "lng": -105.01, "type": "hazard"},
            {"id": "tomtom:2", "lat": 41.0, "lng": -106.0, "type": "traffic"},
        ]
        waypoints = [{"lat": 40.0, "lng": -105.0, "day": 2}]
        filtered = filter_alerts_near_waypoints(alerts, waypoints, radius_deg=0.05)
        self.assertEqual([a["id"] for a in filtered], ["tomtom:1"])
        self.assertEqual(filtered[0]["waypoint_day"], 2)

    def test_route_corridor_samples_long_routes(self):
        waypoints = [{"lat": 35.0 + i, "lng": -110.0 - i} for i in range(20)]
        bboxes = bboxes_for_route_corridor(waypoints, radius_deg=0.1, max_boxes=5)
        self.assertEqual(len(bboxes), 5)
        self.assertEqual(bboxes[0], (-110.1, 34.9, -109.9, 35.1))
        self.assertEqual(bboxes[-1], (-129.1, 53.9, -128.9, 54.1))

    def test_provider_disabled_returns_empty_without_network(self):
        original = settings.tomtom_api_key
        settings.tomtom_api_key = ""
        try:
            alerts = __import__("asyncio").run(get_tomtom_incidents_for_bbox((-105.1, 40.0, -105.0, 40.1)))
            self.assertEqual(alerts, [])
        finally:
            settings.tomtom_api_key = original


if __name__ == "__main__":
    unittest.main()
