import unittest
from unittest.mock import AsyncMock, patch

from dashboard.mission_storyboard import (
    fallback_mission_storyboard,
    generate_mission_storyboard,
    _sanitize_cinematic,
    _sanitize_scene,
)


class MissionStoryboardTests(unittest.IsolatedAsyncioTestCase):
    def test_fallback_storyboard_has_intro_and_recap(self):
        payload = {
            "trip_name": "Moab to Flagstaff",
            "route": [[-109.55, 38.57], [-111.65, 35.20], [-111.37, 35.16]],
            "checkpoints": [
                {"id": "cp1", "title": "Moab", "lat": 38.57, "lng": -109.55, "day": 1},
                {"id": "cp2", "title": "Flagstaff", "lat": 35.16, "lng": -111.37, "day": 3},
            ],
            "places": [
                {"id": "camp1", "type": "camp", "title": "Dispersed camp", "lat": 37.2, "lng": -110.5, "day": 1},
            ],
        }
        cinematic = fallback_mission_storyboard(payload)
        types = {scene["type"] for scene in cinematic["scenes"]}
        self.assertIn("intro", types)
        self.assertIn("mission_recap", types)
        self.assertGreaterEqual(len(cinematic["scenes"]), 3)
        self.assertEqual(cinematic["title"], "Moab to Flagstaff")

    def test_sanitize_cinematic_injects_missing_bookends(self):
        raw = {
            "id": "test",
            "title": "Test trip",
            "scenes": [
                {
                    "id": "mid",
                    "type": "drive_leg",
                    "title": "Canyon leg",
                    "subtitle": "",
                    "durationMs": 8000,
                    "camera": {"mode": "follow"},
                    "layers": {},
                    "narration": "Rolling through the canyon.",
                    "callouts": [],
                },
                {
                    "id": "mid2",
                    "type": "camp_arrival",
                    "title": "Camp",
                    "subtitle": "",
                    "durationMs": 9000,
                    "camera": {"mode": "orbit"},
                    "layers": {},
                    "narration": "Camp for the night.",
                    "callouts": [],
                },
            ],
        }
        route = [[-109.5, 38.5], [-111.3, 35.1]]
        cinematic = _sanitize_cinematic(raw, None, "Test trip", route)
        types = [scene["type"] for scene in cinematic["scenes"]]
        self.assertEqual(types[0], "intro")
        self.assertEqual(types[-1], "mission_recap")

    def test_sanitize_scene_poi_flyover_framing(self):
        scene = _sanitize_scene({
            "id": "poi",
            "type": "poi_flyover",
            "title": "Monument Valley",
            "durationMs": 9000,
            "focus": {"lat": 36.98, "lng": -110.11},
            "rejoinRatio": 0.62,
            "camera": {
                "mode": "orbit",
                "zoom": 55.0,          # clamped to 15
                "pitch": 88.0,         # clamped to 72
                "orbit": {"direction": "ccw", "sweepDeg": 500},  # sweep clamped to 180
                "preset": "barrel_roll",  # unknown preset dropped
            },
            "narration": "Red rock mesas on both sides.",
        }, 0)
        self.assertEqual(scene["type"], "poi_flyover")
        self.assertEqual(scene["rejoinRatio"], 0.62)
        self.assertEqual(scene["camera"]["zoom"], 15.0)
        self.assertEqual(scene["camera"]["pitch"], 72.0)
        self.assertEqual(scene["camera"]["orbit"], {"direction": "ccw", "sweepDeg": 180.0})
        self.assertNotIn("preset", scene["camera"])

    def test_sanitize_scene_low_pass_preset_and_bad_rejoin(self):
        scene = _sanitize_scene({
            "type": "poi_flyover",
            "camera": {"mode": "fly", "preset": "low_pass", "bearing": 220},
            "rejoinRatio": "not-a-number",
        }, 1)
        self.assertEqual(scene["camera"]["preset"], "low_pass")
        self.assertEqual(scene["camera"]["bearing"], 220.0)
        self.assertIsNone(scene["rejoinRatio"])

    def test_sanitize_scene_unknown_type_degrades(self):
        scene = _sanitize_scene({"type": "barrel_roll", "camera": {"mode": "warp"}}, 2)
        self.assertEqual(scene["type"], "drive_leg")
        self.assertEqual(scene["camera"]["mode"], "fly")

    def test_fallback_scenic_place_becomes_poi_flyover(self):
        payload = {
            "trip_name": "Moab loop",
            "route": [[-109.55, 38.57], [-110.11, 36.98], [-111.37, 35.16]],
            "checkpoints": [],
            "places": [
                {"id": "mv", "type": "scenic_view", "title": "Monument Valley", "lat": 36.98, "lng": -110.11},
            ],
        }
        cinematic = fallback_mission_storyboard(payload)
        poi = next(s for s in cinematic["scenes"] if s["type"] == "poi_flyover")
        self.assertIsNotNone(poi["rejoinRatio"])
        self.assertGreaterEqual(poi["rejoinRatio"], 0.0)
        self.assertEqual(poi["camera"]["orbit"]["direction"], "cw")

    async def test_generate_uses_fallback_when_openai_fails(self):
        payload = {
            "trip_name": "Desert run",
            "route": [[-109.5, 38.5], [-111.3, 35.1]],
            "checkpoints": [],
            "places": [],
        }
        preview_fetcher = AsyncMock(return_value={"routes": [{"distance": 160934, "duration": 7200, "legs": []}]})
        with patch("dashboard.mission_storyboard._openai_storyboard", side_effect=RuntimeError("openai_down")):
            result = await generate_mission_storyboard(payload, preview_fetcher)
        self.assertTrue(result["ok"])
        self.assertEqual(result["generated_by"], "fallback")
        self.assertGreaterEqual(len(result["cinematic"]["scenes"]), 2)
        preview_fetcher.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
