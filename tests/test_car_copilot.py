import base64
import io
import unittest
import wave

from fastapi import HTTPException

from dashboard.server import (
    _build_extreme_map_action,
    _build_car_copilot_action,
    _car_copilot_wav_from_l16,
    _car_route_status_message,
)


class CarCopilotContractTests(unittest.TestCase):
    def test_linear16_car_audio_is_bounded_and_converted_to_wav(self):
        # audio/l16 is network-byte-order PCM. The first sample is 0x1234.
        audio = (b"\x12\x34" * 1_600)
        converted = _car_copilot_wav_from_l16(
            base64.b64encode(audio).decode("ascii"),
            16_000,
        )

        with wave.open(io.BytesIO(converted), "rb") as wav:
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getsampwidth(), 2)
            self.assertEqual(wav.getframerate(), 16_000)
            self.assertEqual(wav.readframes(1), b"\x34\x12")

    def test_invalid_or_oversized_audio_is_rejected(self):
        with self.assertRaises(HTTPException) as invalid:
            _car_copilot_wav_from_l16("not base64!", 16_000)
        self.assertEqual(invalid.exception.status_code, 400)

        with self.assertRaises(HTTPException) as oversized:
            _car_copilot_wav_from_l16(
                base64.b64encode(b"\0" * 480_002).decode("ascii"),
                16_000,
            )
        self.assertEqual(oversized.exception.status_code, 413)

    def test_route_status_uses_existing_progress_without_provider_copy(self):
        message = _car_route_status_message(
            "How much longer?",
            {"route": {"remaining_distance_m": 16_093.44, "remaining_duration_s": 3_900}},
        )
        self.assertEqual(message, "10 miles and 1 hour 5 minutes remaining.")

    def test_car_route_mutations_are_classifiable_for_confirmation(self):
        action = _build_car_copilot_action(
            "route me to Arches National Park",
            {
                "map": {"center": {"lat": 38.5733, "lng": -109.5498}},
                "route": {"active_route": True},
            },
        )
        self.assertEqual(action["action_type"], "buildRoute")
        self.assertEqual(action["args"]["query"], "Arches National Park")
        self.assertTrue(action["requires_confirmation"])


if __name__ == "__main__":
    unittest.main()
