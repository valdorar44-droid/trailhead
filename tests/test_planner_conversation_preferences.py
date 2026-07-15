import unittest

from dashboard import server


def user_messages(*content: str) -> list[dict]:
    return [{"role": "user", "content": value} for value in content]


class PlannerConversationPreferenceTests(unittest.TestCase):
    def test_explicit_dirt_request_overrides_balanced_default(self):
        messages = user_messages(
            "Plan a three-day loop from Denver.",
            "Use scenic dirt roads and forest roads in my stock 4Runner.",
        )
        self.assertEqual(server._planner_route_style_from_conversation(messages, "balanced"), "wild")

    def test_avoid_dirt_prefers_direct_even_when_dirt_is_named(self):
        messages = user_messages("Keep it paved and avoid dirt roads.")
        self.assertEqual(server._planner_route_style_from_conversation(messages, "wild"), "direct")

    def test_mixed_camps_and_drive_limit_follow_the_conversation(self):
        messages = user_messages(
            "I want a mix of camps and no more than 5 hours of driving per day."
        )
        self.assertEqual(server._planner_camp_preference_from_conversation(messages, "public"), "any")
        self.assertEqual(server._planner_drive_hours_from_conversation(messages, None), 5.0)

    def test_saved_preferences_remain_when_the_conversation_is_silent(self):
        messages = user_messages("Plan a weekend near Asheville with a waterfall hike.")
        self.assertEqual(server._planner_route_style_from_conversation(messages, "wild"), "wild")
        self.assertEqual(server._planner_camp_preference_from_conversation(messages, "developed"), "developed")
        self.assertEqual(server._planner_drive_hours_from_conversation(messages, 4.5), 4.5)

    def test_vehicle_capability_does_not_select_wild_routing(self):
        messages = user_messages("My vehicle is a four-wheel-drive Tacoma.")
        self.assertEqual(server._planner_route_style_from_conversation(messages, "balanced"), "balanced")

    def test_latest_explicit_preferences_replace_earlier_answers(self):
        messages = user_messages(
            "Use forest roads, dispersed camps, and no more than 6 hours of driving per day.",
            "Actually keep the route paved, use developed campgrounds, and limit driving to 4 hours per day.",
        )
        self.assertEqual(server._planner_route_style_from_conversation(messages, "wild"), "direct")
        self.assertEqual(server._planner_camp_preference_from_conversation(messages, "public"), "developed")
        self.assertEqual(server._planner_drive_hours_from_conversation(messages, 6), 4.0)

    def test_negated_rough_roads_are_not_treated_as_a_wild_route(self):
        for request in (
            "I do not want rough roads on this trip.",
            "Use paved only, not dirt roads.",
            "Don't take forest roads.",
            "No adventure route.",
            "Avoid an adventure route.",
            "I would rather not take dirt roads.",
            "Please skip forest roads.",
            "Use anything except dirt roads.",
            "Don't use any back roads.",
            "Don't drive on dirt roads.",
            "Please avoid taking dirt roads.",
            "I can't take forest roads.",
            "I'm not interested in off-road routes.",
            "Paved roads rather than dirt roads.",
            "Instead of dirt roads, use paved roads.",
        ):
            with self.subTest(request=request):
                self.assertEqual(
                    server._planner_route_style_from_conversation(user_messages(request), "wild"),
                    "direct",
                )

    def test_balanced_route_phrases_are_not_overridden_by_named_road_types(self):
        for request in (
            "I want a balanced route with paved and forest roads.",
            "Make it easier but scenic, with a few dirt roads.",
        ):
            with self.subTest(request=request):
                self.assertEqual(
                    server._planner_route_style_from_conversation(user_messages(request), "wild"),
                    "balanced",
                )

    def test_negated_dispersed_camping_prefers_developed_camps(self):
        for request in (
            "No dispersed camping on this trip.",
            "Anything except dispersed camping.",
            "No public land camping.",
            "Skip boondocking.",
            "I don't want to boondock.",
            "I'm not interested in dispersed camping.",
            "No longer want dispersed camping.",
        ):
            with self.subTest(request=request):
                self.assertEqual(
                    server._planner_camp_preference_from_conversation(user_messages(request), "public"),
                    "developed",
                )

    def test_camp_replacements_and_mixes_keep_the_requested_category(self):
        cases = {
            "Use developed campgrounds instead of dispersed camping.": "developed",
            "Dispersed camps instead of developed campgrounds.": "public",
            "Mix of camps, including developed and dispersed.": "any",
            "Don't stay in RV parks.": "public",
            "I'd rather not use private camps.": "public",
        }
        for request, expected in cases.items():
            with self.subTest(request=request):
                self.assertEqual(
                    server._planner_camp_preference_from_conversation(user_messages(request), "private"),
                    expected,
                )

    def test_latest_drive_limit_in_one_message_wins(self):
        self.assertEqual(
            server._planner_drive_hours_from_conversation(
                user_messages("Keep it under 6 hours per day; actually no more than 4 hours per day."),
                6,
            ),
            4.0,
        )

    def test_positive_camp_choice_wins_over_a_negated_option(self):
        self.assertEqual(
            server._planner_camp_preference_from_conversation(
                user_messages("No private camps; use dispersed camping."),
                "private",
            ),
            "public",
        )
        self.assertEqual(
            server._planner_camp_preference_from_conversation(
                user_messages("No developed campgrounds, only dispersed camping."),
                "developed",
            ),
            "public",
        )
        for request in ("I don't want private camps.", "Do not use developed campgrounds."):
            with self.subTest(request=request):
                self.assertEqual(
                    server._planner_camp_preference_from_conversation(user_messages(request), "private"),
                    "public",
                )


if __name__ == "__main__":
    unittest.main()
