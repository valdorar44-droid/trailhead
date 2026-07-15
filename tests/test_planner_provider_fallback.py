import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import anthropic
import httpx

from ai import planner


class PlannerProviderFallbackTests(unittest.TestCase):
    def setUp(self):
        self.previous_disabled_until = planner._anthropic_disabled_until
        planner._anthropic_disabled_until = 0

    def tearDown(self):
        planner._anthropic_disabled_until = self.previous_disabled_until

    def test_openai_fallback_preserves_system_and_conversation(self):
        response = Mock(status_code=200)
        response.json.return_value = {
            "model": "gpt-5.4-mini-2026-03-17",
            "choices": [{"message": {"content": "Ready for the next detail."}}],
        }

        with (
            patch.object(planner.settings, "openai_api_key", "test-key"),
            patch.object(planner.settings, "openai_planner_fast_model", "gpt-5.4-mini"),
            patch.object(planner.httpx, "post", return_value=response) as post,
        ):
            result = planner._openai_message(
                model=planner.HAIKU_MODEL,
                max_tokens=240,
                system="Keep the reply brief.",
                messages=[
                    {"role": "user", "content": "Plan a weekend loop."},
                    {"role": "assistant", "content": "Where are you starting?"},
                ],
            )

        self.assertEqual(result.content[0].text, "Ready for the next detail.")
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["model"], "gpt-5.4-mini")
        self.assertEqual(payload["max_completion_tokens"], 240)
        self.assertEqual(payload["messages"][0], {"role": "system", "content": "Keep the reply brief."})
        self.assertEqual(payload["messages"][2]["role"], "assistant")

    def test_credit_failure_switches_to_openai_and_opens_circuit(self):
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        response = httpx.Response(400, request=request)
        credit_error = anthropic.BadRequestError(
            "Your credit balance is too low to access the Anthropic API.",
            response=response,
            body={"error": {"type": "invalid_request_error"}},
        )
        fallback = SimpleNamespace(content=[SimpleNamespace(text="Fallback reply")])

        with (
            patch.object(planner.settings, "anthropic_api_key", "anthropic-key"),
            patch.object(planner.settings, "openai_api_key", "openai-key"),
            patch.object(planner, "_claude", side_effect=credit_error) as primary,
            patch.object(planner, "_openai_message", return_value=fallback) as secondary,
        ):
            first = planner._create_message(
                model=planner.HAIKU_MODEL,
                max_tokens=120,
                messages=[{"role": "user", "content": "Plan a trip."}],
            )
            second = planner._create_message(
                model=planner.HAIKU_MODEL,
                max_tokens=120,
                messages=[{"role": "user", "content": "Keep going."}],
            )

        self.assertEqual(first.content[0].text, "Fallback reply")
        self.assertEqual(second.content[0].text, "Fallback reply")
        self.assertEqual(primary.call_count, 1)
        self.assertEqual(secondary.call_count, 2)
        self.assertGreater(planner._anthropic_disabled_until, 0)

    def test_connection_failure_switches_to_openai(self):
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        connection_error = anthropic.APIConnectionError(request=request)
        fallback = SimpleNamespace(content=[SimpleNamespace(text="Fallback reply")])

        with (
            patch.object(planner.settings, "anthropic_api_key", "anthropic-key"),
            patch.object(planner.settings, "openai_api_key", "openai-key"),
            patch.object(planner, "_claude", side_effect=connection_error),
            patch.object(planner, "_openai_message", return_value=fallback) as secondary,
        ):
            result = planner._create_message(
                model=planner.HAIKU_MODEL,
                max_tokens=120,
                messages=[{"role": "user", "content": "Plan a trip."}],
            )

        self.assertEqual(result.content[0].text, "Fallback reply")
        secondary.assert_called_once()

    def test_failed_fallback_does_not_open_anthropic_circuit(self):
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        connection_error = anthropic.APIConnectionError(request=request)

        with (
            patch.object(planner.settings, "anthropic_api_key", "anthropic-key"),
            patch.object(planner.settings, "openai_api_key", "openai-key"),
            patch.object(planner, "_claude", side_effect=connection_error),
            patch.object(planner, "_openai_message", side_effect=RuntimeError("fallback failed")),
        ):
            with self.assertRaisesRegex(RuntimeError, "fallback failed"):
                planner._create_message(
                    model=planner.HAIKU_MODEL,
                    max_tokens=120,
                    messages=[{"role": "user", "content": "Plan a trip."}],
                )

        self.assertEqual(planner._anthropic_disabled_until, 0)

    def test_plan_model_forwards_attempt_limit(self):
        response = SimpleNamespace(content=[SimpleNamespace(text="draft")])
        with patch.object(planner, "_create_message", return_value=response) as create:
            result = planner._call_plan_model(planner.SONNET_MODEL, "prompt", 500, max_attempts=1)

        self.assertEqual(result, "draft")
        self.assertEqual(create.call_args.kwargs["max_attempts"], 1)


if __name__ == "__main__":
    unittest.main()
