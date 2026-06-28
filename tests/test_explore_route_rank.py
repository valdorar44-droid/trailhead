import unittest

from dashboard.server import _rank_explore_places_for_route, _route_points_from_any, _route_scout_window_plan


def place(place_id: str, title: str, category: str, lat: float, lng: float, rank: int, source: str = "OSM") -> dict:
    return {
        "id": place_id,
        "category": category,
        "summary": {
            "id": place_id,
            "title": title,
            "category": category,
            "explore_group": category,
            "lat": lat,
            "lng": lng,
            "rank": rank,
            "tags": [category],
            "hook": title,
            "short_description": title,
            "source_title": source,
        },
        "profile": {
            "summary": title,
            "hook": title,
            "why_it_matters": title,
            "what_to_know": title,
            "best_time_to_stop": "Any clear day.",
            "access_notes": "Verify access.",
            "nearby_context": "",
        },
        "sources": [{"publisher": source}],
        "verified": source in {"NPS", "BLM", "USFS"},
    }


class ExploreRouteRankTests(unittest.TestCase):
    def test_route_scout_window_plan_matches_expected_overnight_count(self):
        windows = _route_scout_window_plan(days=5, total_miles=500)

        self.assertEqual(len(windows), 4)
        self.assertEqual(windows[0]["label"], "Day 1 overnight")
        self.assertGreater(windows[0]["target_mi"], 0)
        self.assertLessEqual(windows[-1]["end"], 500)

    def test_route_scout_window_plan_can_include_destination_camp(self):
        windows = _route_scout_window_plan(days=5, total_miles=951, include_destination_camp=True, destination="Big Sur")

        self.assertEqual(len(windows), 5)
        self.assertEqual(windows[-1]["day"], 5)
        self.assertEqual(windows[-1]["window_kind"], "destination_camp")
        self.assertIn("Big Sur", windows[-1]["label"])
        self.assertEqual(windows[-1]["target_mi"], 951)

    def test_ranks_near_route_places_before_farther_catalog_items(self):
        route = _route_points_from_any([[-109.55, 38.57], [-109.40, 38.70]])
        ranked = _rank_explore_places_for_route(
            [
                place("far", "Far Trail", "trails", 39.30, -110.10, 1, "NPS"),
                place("near", "Near Trail", "trails", 38.61, -109.50, 900, "OSM"),
            ],
            route,
            categories={"trails"},
            limit=2,
            max_distance_mi=120,
        )

        self.assertEqual([item["id"] for item in ranked], ["near", "far"])
        self.assertLess(ranked[0]["summary"]["route_distance_mi"], ranked[1]["summary"]["route_distance_mi"])
        self.assertEqual(ranked[0]["route_rank"]["fit"], "on route")

    def test_category_filter_excludes_unrequested_places(self):
        route = _route_points_from_any([[-109.55, 38.57], [-109.40, 38.70]])
        ranked = _rank_explore_places_for_route(
            [
                place("trail", "Route Trail", "trails", 38.61, -109.50, 10),
                place("fuel", "Route Fuel", "services", 38.62, -109.51, 1),
            ],
            route,
            categories={"trails"},
            limit=4,
            max_distance_mi=30,
        )

        self.assertEqual([item["id"] for item in ranked], ["trail"])


if __name__ == "__main__":
    unittest.main()
