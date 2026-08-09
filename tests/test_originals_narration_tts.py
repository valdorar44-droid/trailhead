import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from dashboard import server
from db import store


def _synthetic_mp3() -> bytes:
    # MPEG-1 Layer III, 128 kbps, 44.1 kHz. Two complete frames are enough for
    # the strict Originals duration probe without committing a binary fixture.
    frame = b"\xff\xfb\x90\x00" + (b"\x00" * (417 - 4))
    return frame + frame


class ElevenLabsTtsTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_uses_server_owned_voice_model_and_mp3_format(self):
        request: dict = {}

        class FakeResponse:
            status_code = 200
            content = _synthetic_mp3()
            reason_phrase = "OK"

            def json(self):
                return {}

        class FakeClient:
            def __init__(self, *args, **kwargs):
                request["client_kwargs"] = kwargs

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, url, *, params, headers, json):
                request.update(url=url, params=params, headers=headers, json=json)
                return FakeResponse()

        with (
            patch.object(server.settings, "elevenlabs_api_key", "test-elevenlabs-key"),
            patch.object(server.settings, "elevenlabs_voice_id", "JBFqnCBsd6RMkjVDRZzb"),
            patch.object(server.settings, "elevenlabs_model_id", "eleven_multilingual_v2"),
            patch.object(server.httpx, "AsyncClient", FakeClient),
        ):
            audio = await server._elevenlabs_tts("A reviewed Original story.")

        self.assertEqual(audio, _synthetic_mp3())
        self.assertEqual(
            request["url"],
            "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb",
        )
        self.assertEqual(request["params"], {"output_format": "mp3_44100_128"})
        self.assertEqual(request["headers"]["xi-api-key"], "test-elevenlabs-key")
        self.assertEqual(request["headers"]["Accept"], "audio/mpeg")
        self.assertEqual(request["json"], {
            "text": "A reviewed Original story.",
            "model_id": "eleven_multilingual_v2",
        })

    async def test_missing_api_key_fails_before_network_call(self):
        with (
            patch.object(server.settings, "elevenlabs_api_key", ""),
            patch.object(server.httpx, "AsyncClient") as client,
        ):
            with self.assertRaises(HTTPException) as raised:
                await server._elevenlabs_tts("A reviewed Original story.")

        self.assertEqual(raised.exception.status_code, 503)
        self.assertIn("ELEVENLABS_API_KEY is not configured", raised.exception.detail)
        client.assert_not_called()

    async def test_provider_auth_error_does_not_become_an_admin_auth_error(self):
        class FakeResponse:
            status_code = 401
            content = b""
            reason_phrase = "Unauthorized"

            def json(self):
                return {"detail": {"message": "invalid provider credential"}}

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, *args, **kwargs):
                return FakeResponse()

        with (
            patch.object(server.settings, "elevenlabs_api_key", "test-elevenlabs-key"),
            patch.object(server.httpx, "AsyncClient", FakeClient),
        ):
            with self.assertRaises(HTTPException) as raised:
                await server._elevenlabs_tts("A reviewed Original story.")

        self.assertEqual(raised.exception.status_code, 503)
        self.assertIn("ElevenLabs TTS failed (401)", raised.exception.detail)
        self.assertNotIn("test-elevenlabs-key", raised.exception.detail)

    def test_arbitrary_provider_cannot_be_requested_by_the_client(self):
        with self.assertRaises(ValidationError):
            server.OriginalNarrationAssetRequest(
                text="A reviewed Original story.", provider="untrusted-provider",
            )

    def test_originals_narration_defaults_to_elevenlabs(self):
        request = server.OriginalNarrationAssetRequest(
            text="A reviewed Original story.",
        )

        self.assertEqual(request.provider, "elevenlabs")

    async def test_originals_endpoint_defaults_to_elevenlabs_and_records_provenance(self):
        audio = _synthetic_mp3()
        persisted = {"id": "story_audio", "mime_type": "audio/mpeg"}
        with (
            patch.object(server, "_elevenlabs_tts", new=AsyncMock(return_value=audio)) as generate,
            patch.object(server, "_persist_original_asset_bytes", return_value=persisted) as persist,
            patch.object(server.settings, "elevenlabs_voice_id", "  JBFqnCBsd6RMkjVDRZzb  "),
            patch.object(server.settings, "elevenlabs_model_id", "  eleven_multilingual_v2  "),
        ):
            result = await server.api_admin_generate_original_narration_with_provider(
                "original_moab",
                "story_audio",
                server.OriginalNarrationAssetRequest(
                    text="A reviewed Original story.",
                ),
                admin={"id": 17},
            )

        self.assertEqual(result, persisted)
        generate.assert_awaited_once_with("A reviewed Original story.")
        call = persist.call_args
        self.assertEqual(call.args[:5], (
            "original_moab", "story_audio", "narration", "audio/mpeg", audio,
        ))
        self.assertEqual(call.args[5:7], ("story_audio.mp3", 17))
        self.assertEqual(call.kwargs["transcript"], "A reviewed Original story.")
        self.assertEqual(call.kwargs["generator_metadata"]["provider"], "elevenlabs")
        self.assertEqual(
            call.kwargs["generator_metadata"]["model_id"], "eleven_multilingual_v2",
        )
        self.assertEqual(
            call.kwargs["generator_metadata"]["voice_id"], "JBFqnCBsd6RMkjVDRZzb",
        )
        self.assertEqual(
            call.kwargs["generator_metadata"]["output_format"], "mp3_44100_128",
        )
        self.assertEqual(
            call.kwargs["generator_metadata"]["license"], "elevenlabs_commercial_terms",
        )
        self.assertNotIn("generated_at", call.kwargs["generator_metadata"])


class CartesiaOriginalNarrationEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_endpoint_persists_mp3_with_cartesia_provenance(self):
        audio = _synthetic_mp3()
        persisted = {"id": "story_audio", "mime_type": "audio/mpeg"}
        with (
            patch.object(server, "_cartesia_tts", new=AsyncMock(return_value=audio)) as generate,
            patch.object(server, "_persist_original_asset_bytes", return_value=persisted) as persist,
            patch.object(server, "_tts_model_id", return_value="sonic-test"),
            patch.object(server.settings, "cartesia_voice_id", "cartesia-test-voice"),
        ):
            result = await server.api_admin_generate_original_narration(
                "original_moab",
                "story_audio",
                server.OriginalCartesiaAssetRequest(text="A reviewed Original story."),
                admin={"id": 17},
            )

        self.assertEqual(result, persisted)
        generate.assert_awaited_once_with(
            "A reviewed Original story.", "guide", container="mp3",
        )
        call = persist.call_args
        self.assertEqual(call.args[:5], (
            "original_moab", "story_audio", "narration", "audio/mpeg", audio,
        ))
        self.assertEqual(call.args[5:7], ("story_audio.mp3", 17))
        self.assertEqual(call.kwargs["transcript"], "A reviewed Original story.")
        self.assertEqual(call.kwargs["generator_metadata"], {
            "provider": "cartesia",
            "model_id": "sonic-test",
            "voice_id": "cartesia-test-voice",
            "output_format": "mp3_44100_128",
            "license": "cartesia_commercial_terms",
        })

    async def test_provider_endpoint_persists_mp3_with_cartesia_provenance(self):
        audio = _synthetic_mp3()
        persisted = {"id": "story_audio", "mime_type": "audio/mpeg"}
        with (
            patch.object(server, "_cartesia_tts", new=AsyncMock(return_value=audio)) as generate,
            patch.object(server, "_persist_original_asset_bytes", return_value=persisted) as persist,
            patch.object(server, "_tts_model_id", return_value="sonic-test"),
            patch.object(server.settings, "cartesia_voice_id", "cartesia-test-voice"),
        ):
            result = await server.api_admin_generate_original_narration_with_provider(
                "original_moab",
                "story_audio",
                server.OriginalNarrationAssetRequest(
                    text="A reviewed Original story.", provider="cartesia",
                ),
                admin={"id": 17},
            )

        self.assertEqual(result, persisted)
        generate.assert_awaited_once_with(
            "A reviewed Original story.", "guide", container="mp3",
        )
        call = persist.call_args
        self.assertEqual(call.args[:5], (
            "original_moab", "story_audio", "narration", "audio/mpeg", audio,
        ))
        self.assertEqual(call.args[5:7], ("story_audio.mp3", 17))
        self.assertEqual(call.kwargs["transcript"], "A reviewed Original story.")
        self.assertEqual(call.kwargs["generator_metadata"], {
            "provider": "cartesia",
            "model_id": "sonic-test",
            "voice_id": "cartesia-test-voice",
            "output_format": "mp3_44100_128",
            "license": "cartesia_commercial_terms",
        })


class OriginalMp3AssetTests(unittest.TestCase):
    def test_audio_mime_aliases_are_normalized_before_persistence(self):
        for alias in ("audio/wave", "audio/x-wav", "audio/vnd.wave"):
            with self.subTest(alias=alias):
                self.assertEqual(server._normalize_original_asset_mime_type(alias), "audio/wav")
        for alias in ("audio/mp3", "audio/x-mp3", "audio/mpeg3", "audio/x-mpeg-3"):
            with self.subTest(alias=alias):
                self.assertEqual(server._normalize_original_asset_mime_type(alias), "audio/mpeg")
        self.assertEqual(
            server._normalize_original_asset_mime_type(" Audio/X-Wav; codecs=pcm "),
            "audio/wav",
        )

    def test_mp3_is_accepted_and_duration_is_probed(self):
        audio = _synthetic_mp3()
        self.assertTrue(store._original_asset_mime_allowed("narration", "audio/mpeg"))
        self.assertTrue(server._original_asset_bytes_match_kind(
            "narration", "audio/mpeg", audio,
        ))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "story.mp3"
            path.write_bytes(audio)
            metadata = store._probe_original_asset_file(path, "narration", "audio/mpeg")

        self.assertEqual(metadata["format"], "mp3")
        self.assertEqual(metadata["sample_rate_hz"], 44100)
        self.assertEqual(metadata["bitrate_kbps"], 128)
        self.assertEqual(metadata["channels"], 2)
        self.assertGreater(metadata["duration_s"], 0.05)


if __name__ == "__main__":
    unittest.main()
