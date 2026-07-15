import unittest
from unittest.mock import AsyncMock, Mock, patch

import dashboard.server as server


class RouteWeatherTests(unittest.IsolatedAsyncioTestCase):
    async def test_nearby_waypoint_aliases_share_one_provider_forecast(self):
        forecast = {
            "latitude": 38.58,
            "longitude": -109.55,
            "daily": {"time": ["2026-07-15"]},
        }
        request = server.RouteWeatherRequest(
            trip_id="weather-aliases",
            units="imperial",
            waypoints=[
                {"name": "Moab, Utah", "lat": 38.5733, "lng": -109.5498},
                {"name": "Sand Flats Campground", "lat": 38.5788, "lng": -109.5159},
            ],
        )
        provider = AsyncMock(return_value=forecast)
        cache_write = Mock()

        with (
            patch.object(server, "get_cached", return_value=None),
            patch.object(server, "set_cached", cache_write),
            patch.object(server, "weather_forecast", provider),
        ):
            response = await server.route_weather(request)

        provider.assert_awaited_once_with(38.5733, -109.5498, days=7, units="imperial")
        self.assertEqual(
            response["forecasts"],
            {
                "Moab, Utah": forecast,
                "Sand Flats Campground": forecast,
            },
        )
        cache_write.assert_called_once_with(
            "campsite_cache",
            server._route_weather_cache_key(request),
            response,
        )

    async def test_route_edit_uses_a_different_cache_entry(self):
        original = server.RouteWeatherRequest(
            trip_id="weather-edited",
            waypoints=[{"name": "Moab", "lat": 38.5733, "lng": -109.5498}],
        )
        edited = server.RouteWeatherRequest(
            trip_id="weather-edited",
            waypoints=[{"name": "Bryce Canyon", "lat": 37.6283, "lng": -112.1677}],
        )

        self.assertNotEqual(
            server._route_weather_cache_key(original),
            server._route_weather_cache_key(edited),
        )

    async def test_distant_waypoints_fetch_separate_forecasts(self):
        request = server.RouteWeatherRequest(
            trip_id="weather-distinct",
            waypoints=[
                {"name": "Moab", "lat": 38.5733, "lng": -109.5498},
                {"name": "Arches", "lat": 38.7331, "lng": -109.5925},
            ],
        )

        async def forecast_for(lat, lng, *, days, units):
            return {"latitude": lat, "longitude": lng, "daily": {"time": ["2026-07-15"]}}

        provider = AsyncMock(side_effect=forecast_for)
        with (
            patch.object(server, "get_cached", return_value=None),
            patch.object(server, "set_cached"),
            patch.object(server, "weather_forecast", provider),
        ):
            response = await server.route_weather(request)

        self.assertEqual(provider.await_count, 2)
        self.assertEqual(response["forecasts"]["Moab"]["latitude"], 38.5733)
        self.assertEqual(response["forecasts"]["Arches"]["latitude"], 38.7331)

    async def test_failed_group_omits_all_of_its_aliases(self):
        request = server.RouteWeatherRequest(
            trip_id="weather-failure",
            waypoints=[
                {"name": "Moab", "lat": 38.5733, "lng": -109.5498},
                {"name": "Sand Flats", "lat": 38.5788, "lng": -109.5159},
            ],
        )

        with (
            patch.object(server, "get_cached", return_value=None),
            patch.object(server, "set_cached"),
            patch.object(server, "weather_forecast", AsyncMock(side_effect=RuntimeError("offline"))),
        ):
            response = await server.route_weather(request)

        self.assertEqual(response["forecasts"], {})

    async def test_cached_route_weather_skips_provider_and_cache_write(self):
        cached = {"trip_id": "weather-cached", "forecasts": {"Moab": {"daily": {}}}}
        request = server.RouteWeatherRequest(
            trip_id="weather-cached",
            waypoints=[{"name": "Moab", "lat": 38.5733, "lng": -109.5498}],
        )
        provider = AsyncMock()
        cache_write = Mock()

        with (
            patch.object(server, "get_cached", return_value=cached),
            patch.object(server, "set_cached", cache_write),
            patch.object(server, "weather_forecast", provider),
        ):
            response = await server.route_weather(request)

        self.assertIs(response, cached)
        provider.assert_not_awaited()
        cache_write.assert_not_called()


if __name__ == "__main__":
    unittest.main()
