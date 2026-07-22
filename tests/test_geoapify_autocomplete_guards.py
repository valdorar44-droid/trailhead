from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import patch

import httpx

from ingestors import geoapify, provider_guard


class _Response:
    def __init__(self, status_code: int, payload: dict | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = "provider response"

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("GET", geoapify.GEOAPIFY_AUTOCOMPLETE_URL)
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError(
                "provider error",
                request=request,
                response=response,
            )


class _Client:
    def __init__(self, responder, calls: list[dict]) -> None:
        self._responder = responder
        self._calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _tb):
        return False

    async def get(self, _url: str, *, params: dict):
        self._calls.append(dict(params))
        result = self._responder(params)
        if isinstance(result, Exception):
            raise result
        return result


def _success_response(place_id: str = "place-1") -> _Response:
    return _Response(200, {
        "results": [{
            "place_id": place_id,
            "name": "Moab Information Center",
            "formatted": "25 E Center Street, Moab, Utah",
            "lat": 38.5734,
            "lon": -109.5499,
            "result_type": "amenity",
        }],
    })


class ProviderGuardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        provider_guard._RECENT_CALLS.clear()
        provider_guard._RUNTIME_CACHE.clear()
        provider_guard._IN_FLIGHT.clear()
        provider_guard._BUDGET_RESERVATIONS.clear()

    def test_geoapify_autocomplete_budget_is_configurable_and_below_free_rps(self):
        max_calls, window_seconds = provider_guard.PROVIDER_BUDGETS[
            ("geoapify", "autocomplete")
        ]
        self.assertGreaterEqual(max_calls, 0)
        self.assertLess(max_calls, 5)
        self.assertEqual(window_seconds, 1)

        with patch.dict(os.environ, {
            "GEOAPIFY_AUTOCOMPLETE_MAX_REQUESTS_PER_SECOND": "3",
        }):
            self.assertEqual(
                provider_guard._bounded_env_int(
                    "GEOAPIFY_AUTOCOMPLETE_MAX_REQUESTS_PER_SECOND",
                    4,
                    minimum=0,
                    maximum=4,
                ),
                3,
            )
        with patch.dict(os.environ, {
            "GEOAPIFY_AUTOCOMPLETE_MAX_REQUESTS_PER_SECOND": "99",
        }):
            self.assertEqual(
                provider_guard._bounded_env_int(
                    "GEOAPIFY_AUTOCOMPLETE_MAX_REQUESTS_PER_SECOND",
                    4,
                    minimum=0,
                    maximum=4,
                ),
                4,
            )

    def test_geoapify_autocomplete_budget_enforces_and_recovers_after_window(self):
        budgets = {
            **provider_guard.PROVIDER_BUDGETS,
            ("geoapify", "autocomplete"): (2, 1),
        }
        with (
            patch.object(provider_guard, "PROVIDER_BUDGETS", budgets),
            patch.object(provider_guard.time, "time", return_value=1_000.0),
        ):
            self.assertTrue(provider_guard.provider_budget_available("geoapify", "autocomplete"))
            provider_guard.record_provider_call("geoapify", "autocomplete")
            self.assertTrue(provider_guard.provider_budget_available("geoapify", "autocomplete"))
            provider_guard.record_provider_call("geoapify", "autocomplete")
            self.assertFalse(provider_guard.provider_budget_available("geoapify", "autocomplete"))

        with (
            patch.object(provider_guard, "PROVIDER_BUDGETS", budgets),
            patch.object(provider_guard.time, "time", return_value=1_001.001),
        ):
            self.assertTrue(provider_guard.provider_budget_available("geoapify", "autocomplete"))

    async def test_runtime_cache_has_namespace_local_lru_and_prunes_expiry(self):
        counts: dict[str, int] = {}

        async def load(key: str):
            counts[key] = counts.get(key, 0) + 1
            return {"key": key, "generation": counts[key]}

        namespace = "geoapify_autocomplete:v1:"
        with patch.object(provider_guard.time, "time", return_value=100.0):
            await provider_guard.runtime_cached_call(
                "other-provider:keep", 100, lambda: load("other"),
                provider="other", endpoint="search",
            )
            await provider_guard.runtime_cached_call(
                f"{namespace}a", 1, lambda: load("a"),
                provider="geoapify", endpoint="autocomplete",
                max_entries=2, cache_namespace=namespace,
            )
            await provider_guard.runtime_cached_call(
                f"{namespace}b", 100, lambda: load("b"),
                provider="geoapify", endpoint="autocomplete",
                max_entries=2, cache_namespace=namespace,
            )
            # A hit makes a the most recently used entry.
            await provider_guard.runtime_cached_call(
                f"{namespace}a", 1, lambda: load("a"),
                provider="geoapify", endpoint="autocomplete",
                max_entries=2, cache_namespace=namespace,
            )
            await provider_guard.runtime_cached_call(
                f"{namespace}c", 100, lambda: load("c"),
                provider="geoapify", endpoint="autocomplete",
                max_entries=2, cache_namespace=namespace,
            )

        self.assertIn("other-provider:keep", provider_guard._RUNTIME_CACHE)
        self.assertIn(f"{namespace}a", provider_guard._RUNTIME_CACHE)
        self.assertIn(f"{namespace}c", provider_guard._RUNTIME_CACHE)
        self.assertNotIn(f"{namespace}b", provider_guard._RUNTIME_CACHE)
        self.assertEqual(counts["a"], 1)

        with patch.object(provider_guard.time, "time", return_value=102.0):
            refreshed = await provider_guard.runtime_cached_call(
                f"{namespace}a", 1, lambda: load("a"),
                provider="geoapify", endpoint="autocomplete",
                max_entries=2, cache_namespace=namespace,
            )
        self.assertEqual(refreshed["generation"], 2)
        self.assertEqual(counts["a"], 2)


class GeoapifyAutocompleteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        provider_guard._RECENT_CALLS.clear()
        provider_guard._RUNTIME_CACHE.clear()
        provider_guard._IN_FLIGHT.clear()
        provider_guard._BUDGET_RESERVATIONS.clear()

    async def test_concurrent_unique_misses_reserve_budget_before_network(self):
        calls: list[dict] = []
        client_factory = lambda *_args, **_kwargs: _Client(
            lambda _params: _success_response(f"place-{len(calls)}"),
            calls,
        )
        budgets = {
            **provider_guard.PROVIDER_BUDGETS,
            ("geoapify", "autocomplete"): (2, 60),
        }
        with (
            patch.dict(os.environ, {
                "GEOAPIFY_API_KEY": "test-key",
                "GEOAPIFY_DURABLE_SEARCH_ENABLED": "true",
            }),
            patch.object(provider_guard, "PROVIDER_BUDGETS", budgets),
            patch.object(geoapify, "_blocked", return_value=False),
            patch.object(geoapify.httpx, "AsyncClient", client_factory),
        ):
            results = await asyncio.gather(*[
                geoapify.get_geoapify_autocomplete(f"unique route {index}")
                for index in range(8)
            ])

        self.assertEqual(len(calls), 2)
        self.assertEqual(sum(bool(result) for result in results), 2)
        self.assertEqual(
            len(provider_guard._BUDGET_RESERVATIONS[("geoapify", "autocomplete")]),
            2,
        )
        misses = [
            call for call in provider_guard._RECENT_CALLS
            if call.get("cache_status") == "miss"
        ]
        self.assertEqual(len(misses), 2)
        self.assertTrue(all(call.get("budget_reserved") for call in misses))
        with patch.object(provider_guard, "PROVIDER_BUDGETS", budgets):
            self.assertFalse(
                provider_guard.provider_budget_available("geoapify", "autocomplete")
            )

    async def test_unique_query_churn_is_bounded_and_keys_never_contain_query_text(self):
        calls: list[dict] = []
        client_factory = lambda *_args, **_kwargs: _Client(
            lambda params: _success_response(f"place-{len(calls)}"),
            calls,
        )
        budgets = {
            **provider_guard.PROVIDER_BUDGETS,
            ("geoapify", "autocomplete"): (100, 1),
        }
        raw_queries = [f"private route query {index}" for index in range(6)]
        with (
            patch.dict(os.environ, {
                "GEOAPIFY_API_KEY": "test-key",
                "GEOAPIFY_DURABLE_SEARCH_ENABLED": "true",
            }),
            patch.object(provider_guard, "PROVIDER_BUDGETS", budgets),
            patch.object(geoapify, "_blocked", return_value=False),
            patch.object(geoapify.httpx, "AsyncClient", client_factory),
            patch.object(geoapify, "GEOAPIFY_AUTOCOMPLETE_CACHE_MAX_ENTRIES", 3),
        ):
            for query in raw_queries:
                self.assertTrue(await geoapify.get_geoapify_autocomplete(query))

        keys = [
            key for key in provider_guard._RUNTIME_CACHE
            if key.startswith("geoapify_autocomplete:v1:")
        ]
        self.assertEqual(len(calls), len(raw_queries))
        self.assertEqual(len(keys), 3)
        for key in keys:
            self.assertEqual(len(key.rsplit(":", 1)[-1]), 64)
            self.assertTrue(all(query not in key for query in raw_queries))
        telemetry_keys = [
            str(call.get("key") or "") for call in provider_guard._RECENT_CALLS
        ]
        self.assertTrue(telemetry_keys)
        self.assertTrue(all(
            all(query not in key for query in raw_queries)
            for key in telemetry_keys
        ))

    async def test_permission_and_quota_statuses_start_global_backoff(self):
        for status_code, expected_key in (
            (401, geoapify.GEOAPIFY_PERMISSION_BACKOFF_KEY),
            (403, geoapify.GEOAPIFY_PERMISSION_BACKOFF_KEY),
            (429, geoapify.GEOAPIFY_QUOTA_BACKOFF_KEY),
        ):
            with self.subTest(status_code=status_code):
                provider_guard._RECENT_CALLS.clear()
                provider_guard._RUNTIME_CACHE.clear()
                provider_guard._BUDGET_RESERVATIONS.clear()
                stored: dict[str, dict] = {}
                calls: list[dict] = []

                def get_cached(_table: str, key: str, *, ttl_seconds: int):
                    del ttl_seconds
                    return stored.get(key)

                def set_cached(_table: str, key: str, value: dict):
                    stored[key] = value

                client_factory = lambda *_args, **_kwargs: _Client(
                    lambda _params: _Response(status_code),
                    calls,
                )
                with (
                    patch.dict(os.environ, {
                        "GEOAPIFY_API_KEY": "test-key",
                        "GEOAPIFY_DURABLE_SEARCH_ENABLED": "true",
                    }),
                    patch.object(geoapify, "get_cached", get_cached),
                    patch.object(geoapify, "set_cached", set_cached),
                    patch.object(geoapify.httpx, "AsyncClient", client_factory),
                ):
                    self.assertEqual(
                        await geoapify.get_geoapify_autocomplete("first request"),
                        [],
                    )
                    self.assertIn(expected_key, stored)
                    self.assertEqual(
                        await geoapify.get_geoapify_autocomplete("second request"),
                        [],
                    )

                self.assertEqual(len(calls), 1)
                misses = [
                    call for call in provider_guard._RECENT_CALLS
                    if call.get("cache_status") == "miss"
                ]
                self.assertEqual(len(misses), 1)
                self.assertEqual(misses[0]["status_code"], status_code)

    async def test_timeout_is_counted_and_uses_short_query_local_backoff(self):
        calls: list[dict] = []
        stored: dict[str, dict] = {}
        timeout = httpx.ReadTimeout("provider timed out")
        client_factory = lambda *_args, **_kwargs: _Client(
            lambda _params: timeout,
            calls,
        )
        with (
            patch.dict(os.environ, {
                "GEOAPIFY_API_KEY": "test-key",
                "GEOAPIFY_DURABLE_SEARCH_ENABLED": "true",
            }),
            patch.object(
                geoapify,
                "get_cached",
                lambda _table, key, *, ttl_seconds: stored.get(key),
            ),
            patch.object(
                geoapify,
                "set_cached",
                lambda _table, key, value: stored.__setitem__(key, value),
            ),
            patch.object(geoapify.httpx, "AsyncClient", client_factory),
        ):
            self.assertEqual(
                await geoapify.get_geoapify_autocomplete("timeout query"),
                [],
            )
            # The same query is served from the short-lived runtime cache.
            self.assertEqual(
                await geoapify.get_geoapify_autocomplete("timeout query"),
                [],
            )
            # A different query is not globally blocked after a transient timeout.
            self.assertEqual(
                await geoapify.get_geoapify_autocomplete("another timeout"),
                [],
            )

        self.assertEqual(len(calls), 2)
        self.assertEqual(stored, {})
        misses = [
            call for call in provider_guard._RECENT_CALLS
            if call.get("cache_status") == "miss"
        ]
        hits = [
            call for call in provider_guard._RECENT_CALLS
            if call.get("cache_status") == "hit"
        ]
        self.assertEqual(len(misses), 2)
        self.assertEqual(len(hits), 1)
        self.assertTrue(all(call.get("status_code") is None for call in misses))
        self.assertTrue(all("timeout query" not in str(call.get("key")) for call in misses))


if __name__ == "__main__":
    unittest.main()
