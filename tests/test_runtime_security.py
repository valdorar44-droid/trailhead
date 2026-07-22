from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import patch

import dashboard.server as server
from config.settings import (
    DEVELOPMENT_SECRET_KEY,
    is_production_environment,
    settings,
    validate_production_secret_key,
)


class ProductionRuntimeSecurityTests(unittest.TestCase):
    def test_production_detection_uses_only_documented_explicit_signals(self):
        self.assertTrue(is_production_environment({
            "TRAILHEAD_ENVIRONMENT": "production",
        }))
        self.assertTrue(is_production_environment({
            "RAILWAY_ENVIRONMENT_NAME": "prod",
        }))
        self.assertTrue(is_production_environment({
            "TRAILHEAD_ENVIRONMENT": "preview",
            "RAILWAY_ENVIRONMENT_NAME": "production",
        }))
        self.assertFalse(is_production_environment({
            "TRAILHEAD_ENVIRONMENT": "preview",
            "RAILWAY_ENVIRONMENT_NAME": "staging",
            "ENVIRONMENT": "production",
        }))
        self.assertFalse(is_production_environment({
            "RAILWAY_PROJECT_ID": "production-looking-project",
        }))

    def test_local_and_preview_allow_the_development_key(self):
        validate_production_secret_key(DEVELOPMENT_SECRET_KEY, {})
        validate_production_secret_key(
            DEVELOPMENT_SECRET_KEY,
            {"TRAILHEAD_ENVIRONMENT": "preview"},
        )

    def test_production_rejects_blank_and_known_development_keys(self):
        production = {"TRAILHEAD_ENVIRONMENT": "production"}
        for invalid in ("", "   ", DEVELOPMENT_SECRET_KEY):
            with self.subTest(invalid=bool(invalid.strip())):
                with self.assertRaisesRegex(RuntimeError, "SECRET_KEY must be configured"):
                    validate_production_secret_key(invalid, production)

    def test_production_accepts_a_configured_nondevelopment_key(self):
        validate_production_secret_key(
            "test-only-distinct-production-secret",
            {"RAILWAY_ENVIRONMENT_NAME": "production"},
        )

    def test_first_startup_handler_fails_before_background_work_in_production(self):
        with (
            patch.dict(
                os.environ,
                {"TRAILHEAD_ENVIRONMENT": "production"},
                clear=True,
            ),
            patch.object(settings, "secret_key", DEVELOPMENT_SECRET_KEY),
        ):
            with self.assertRaises(RuntimeError):
                asyncio.run(server._validate_production_runtime_security())


if __name__ == "__main__":
    unittest.main()
