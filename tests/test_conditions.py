import unittest

from config.settings import settings
from ingestors.conditions import (
    _aqi_severity,
    _condition_alert,
    get_airnow_alerts_near,
    get_firms_fire_alerts_near,
)


class ConditionsTests(unittest.TestCase):
    def test_optional_key_providers_are_disabled_without_network(self):
        original_airnow = settings.airnow_api_key
        original_firms = settings.nasa_firms_map_key
        settings.airnow_api_key = ""
        settings.nasa_firms_map_key = ""
        try:
            import asyncio

            airnow = asyncio.run(get_airnow_alerts_near(38.57, -109.55))
            firms = asyncio.run(get_firms_fire_alerts_near(38.57, -109.55))
            self.assertEqual(airnow, [])
            self.assertEqual(firms, [])
        finally:
            settings.airnow_api_key = original_airnow
            settings.nasa_firms_map_key = original_firms

    def test_aqi_severity_mapping(self):
        self.assertEqual(_aqi_severity(75), "low")
        self.assertEqual(_aqi_severity(125), "moderate")
        self.assertEqual(_aqi_severity(175), "high")
        self.assertEqual(_aqi_severity(250), "critical")

    def test_condition_alert_shape(self):
        alert = _condition_alert(
            provider="nws",
            provider_id="abc",
            alert_type="weather",
            subtype="Severe Thunderstorm Warning",
            severity="high",
            description="Storm warning",
            lat=40.0,
            lng=-105.0,
        )
        self.assertEqual(alert["id"], "nws:abc")
        self.assertEqual(alert["source"], "provider")
        self.assertEqual(alert["provider"], "nws")
        self.assertEqual(alert["type"], "weather")
        self.assertEqual(alert["username"], "NWS")


if __name__ == "__main__":
    unittest.main()
