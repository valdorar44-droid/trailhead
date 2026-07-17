import unittest
from unittest.mock import patch

from dashboard import server


class CartesiaTtsOutputFormatTests(unittest.IsolatedAsyncioTestCase):
    async def _generate(self, container: str) -> tuple[bytes, dict]:
        request: dict = {}

        class FakeResponse:
            status_code = 200
            content = b"generated-audio"
            text = ""
            reason_phrase = "OK"

        class FakeClient:
            def __init__(self, *args, **kwargs):
                request["client_kwargs"] = kwargs

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, url, *, headers, json):
                request.update(url=url, headers=headers, json=json)
                return FakeResponse()

        with (
            patch.object(server.settings, "cartesia_api_key", "test-cartesia-key"),
            patch.object(server.httpx, "AsyncClient", FakeClient),
        ):
            audio = await server._cartesia_tts(
                "A reviewed Trailhead Original story.", "guide", container=container,
            )
        return audio, request

    async def test_wav_request_uses_supported_nonblank_pcm_encoding(self):
        audio, request = await self._generate("wav")

        self.assertEqual(audio, b"generated-audio")
        self.assertEqual(request["headers"]["Accept"], "audio/wav")
        self.assertEqual(request["json"]["output_format"], {
            "container": "wav",
            "sample_rate": 44100,
            "encoding": "pcm_s16le",
        })

    async def test_mp3_request_uses_128_kbps_and_does_not_receive_wav_encoding(self):
        _, request = await self._generate("mp3")

        self.assertEqual(request["headers"]["Accept"], "audio/mpeg")
        self.assertEqual(request["json"]["output_format"], {
            "container": "mp3",
            "sample_rate": 44100,
            "bit_rate": 128000,
        })


if __name__ == "__main__":
    unittest.main()
