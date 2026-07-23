import json
import asyncio
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from config.settings import settings
from db import store
from ingestors.conditions import (
    WFIGS_LEGACY_MAP_MAX_FEATURES,
    WFIGS_MAP_OUTBOUND_MAX_REQUESTS,
    _aqi_severity,
    _compact_wfigs_map_payload,
    _condition_alert,
    _wfigs_map_cache_key,
    _wfigs_map_cells,
    _merge_wfigs_map_payloads,
    _wfigs_map_query_params,
    _wfigs_map_loop_state,
    _fetch_wfigs_map_payload,
    get_airnow_alerts_near,
    get_firms_fire_alerts_near,
)


def _wfigs_polygon(index: int = 0, *, extra_vertices: int = 0) -> dict:
    west = -110 + index * 0.01
    ring = [
        [west, 38.0],
        [west + 0.005, 38.0],
        [west + 0.005, 38.005],
        *[[west + 0.004, 38.004 + offset * 0.000001] for offset in range(extra_vertices)],
        [west, 38.0],
    ]
    return {"type": "Polygon", "coordinates": [ring]}


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

    def test_wfigs_map_query_is_viewport_bounded_and_generalized(self):
        params = _wfigs_map_query_params((39.0, 38.0, -108.0, -110.0), max_features=120)
        self.assertEqual(params["geometry"], "-110.000000,38.000000,-108.000000,39.000000")
        self.assertEqual(params["geometryType"], "esriGeometryEnvelope")
        self.assertEqual(params["resultRecordCount"], 120)
        self.assertEqual(params["maxAllowableOffset"], "0.00025")

    def test_wfigs_legacy_map_query_preserves_original_feature_cap(self):
        params = _wfigs_map_query_params(None, max_features=WFIGS_LEGACY_MAP_MAX_FEATURES)
        self.assertEqual(params["resultRecordCount"], 800)
        self.assertEqual(params["maxAllowableOffset"], "0.01")

    def test_wfigs_nearby_viewports_reuse_the_same_coarse_cells(self):
        first = (39.12, 38.12, -108.12, -109.12)
        second = (39.14, 38.14, -108.14, -109.14)
        first_cells = _wfigs_map_cells(first)
        second_cells = _wfigs_map_cells(second)
        self.assertEqual(first_cells, second_cells)
        self.assertEqual(len(first_cells), 1)
        self.assertEqual(
            [_wfigs_map_cache_key(cell, max_features=120) for cell in first_cells],
            [_wfigs_map_cache_key(cell, max_features=120) for cell in second_cells],
        )
        self.assertLessEqual(min(cell[1] for cell in first_cells), first[1])
        self.assertGreaterEqual(max(cell[0] for cell in first_cells), first[0])
        self.assertLessEqual(min(cell[3] for cell in first_cells), first[3])
        self.assertGreaterEqual(max(cell[2] for cell in first_cells), first[2])

    def test_wfigs_antimeridian_viewport_splits_into_ordered_cells(self):
        cells = _wfigs_map_cells((10.0, 0.0, -170.0, 170.0))
        self.assertGreaterEqual(len(cells), 2)
        self.assertTrue(all(east > west for _, _, east, west in cells))
        self.assertTrue(any(west == -180 for _, _, _, west in cells))
        self.assertTrue(any(east == 180 for _, _, east, _ in cells))

    def test_wfigs_map_payload_is_capped_and_drops_unused_properties(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": _wfigs_polygon(index),
                    "properties": {
                        "poly_IRWINID": f"fire-{index}",
                        "poly_IncidentName": "Example",
                        "attr_ModifiedOnDateTime_dt": 123,
                        "unused": "not sent to the native bridge",
                    },
                }
                for index in range(5)
            ],
        }
        compact = _compact_wfigs_map_payload(payload, max_features=2)
        self.assertEqual(len(compact["features"]), 2)
        self.assertEqual(
            set(compact["features"][0]["properties"]),
            {"id", "name", "updated_at"},
        )
        self.assertTrue(compact["metadata"]["truncated"])
        self.assertIn("feature_limit", compact["metadata"]["truncation_reasons"])

    def test_wfigs_map_payload_rejects_malformed_and_oversized_geometry(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-110, 38]}},
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-110, 38], [-109, 38], [-109, float("nan")], [-110, 38]]],
                    },
                },
                {"type": "Feature", "geometry": _wfigs_polygon(extra_vertices=8)},
            ],
        }
        compact = _compact_wfigs_map_payload(
            payload,
            max_features=10,
            max_feature_vertices=6,
        )
        self.assertEqual(compact["features"], [])
        self.assertEqual(compact["metadata"]["dropped"]["invalid_geometry"], 2)
        self.assertEqual(compact["metadata"]["dropped"]["feature_vertex_limit"], 1)
        self.assertTrue(compact["metadata"]["truncated"])
        self.assertTrue(compact["metadata"]["partial"])
        self.assertEqual(compact["metadata"]["dropped_feature_count"], 3)
        self.assertEqual(
            compact["metadata"]["partial_reasons"],
            ["feature_vertex_limit", "invalid_geometry"],
        )

    def test_wfigs_map_payload_enforces_total_vertex_and_serialized_budgets(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": _wfigs_polygon(index, extra_vertices=50),
                    "properties": {"poly_IRWINID": f"fire-{index}"},
                }
                for index in range(4)
            ],
        }
        total_limited = _compact_wfigs_map_payload(
            payload,
            max_features=10,
            max_feature_vertices=100,
            max_total_vertices=100,
        )
        self.assertLess(len(total_limited["features"]), 4)
        self.assertIn("total_vertex_limit", total_limited["metadata"]["truncation_reasons"])

        size_limited = _compact_wfigs_map_payload(
            payload,
            max_features=10,
            max_feature_vertices=100,
            max_total_vertices=500,
            max_serialized_bytes=1024,
        )
        self.assertLessEqual(
            len(json.dumps(size_limited, separators=(",", ":"), allow_nan=False).encode("utf-8")),
            1024,
        )
        self.assertIn("serialized_size_limit", size_limited["metadata"]["truncation_reasons"])

    def test_wfigs_merge_keeps_current_partial_cells_partial_not_stale(self):
        partial_payloads = []
        for index in range(2):
            payload = _compact_wfigs_map_payload({
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": _wfigs_polygon(index),
                        "properties": {"poly_IRWINID": f"valid-{index}"},
                    },
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [-110, 38]},
                    },
                ],
            }, max_features=120)
            payload["metadata"].update({
                "availability": "available",
                "freshness": "fresh",
                "age_seconds": 0,
            })
            partial_payloads.append(payload)

        merged = _merge_wfigs_map_payloads(partial_payloads, max_features=120)
        self.assertEqual(merged["metadata"]["availability"], "available")
        self.assertEqual(merged["metadata"]["freshness"], "fresh")
        self.assertTrue(merged["metadata"]["partial"])
        self.assertEqual(merged["metadata"]["degraded_cell_count"], 0)
        self.assertEqual(merged["metadata"]["stale_cell_count"], 0)
        self.assertEqual(merged["metadata"]["partial_cell_count"], 2)
        self.assertEqual(merged["metadata"]["dropped_feature_count"], 2)

    def test_wfigs_merge_keeps_complete_stale_fallback_stale_only(self):
        stale_payloads = []
        for index in range(2):
            payload = _compact_wfigs_map_payload({
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "geometry": _wfigs_polygon(index),
                    "properties": {"poly_IRWINID": f"cached-{index}"},
                }],
            }, max_features=120)
            payload["metadata"].update({
                "availability": "degraded",
                "freshness": "stale",
                "age_seconds": 1_200,
            })
            stale_payloads.append(payload)

        merged = _merge_wfigs_map_payloads(stale_payloads, max_features=120)
        self.assertEqual(merged["metadata"]["availability"], "degraded")
        self.assertEqual(merged["metadata"]["freshness"], "stale")
        self.assertFalse(merged["metadata"]["partial"])
        self.assertFalse(merged["metadata"]["truncated"])
        self.assertEqual(merged["metadata"]["partial_reasons"], [])
        self.assertEqual(merged["metadata"]["degraded_cell_count"], 2)
        self.assertEqual(merged["metadata"]["stale_cell_count"], 2)
        self.assertEqual(merged["metadata"]["partial_cell_count"], 0)

    def test_wfigs_merge_marks_current_missing_cell_partial_not_stale(self):
        current = _compact_wfigs_map_payload({
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": _wfigs_polygon(),
                "properties": {"poly_IRWINID": "current-fire"},
            }],
        }, max_features=120)
        current["metadata"].update({
            "availability": "available",
            "freshness": "fresh",
            "age_seconds": 20,
        })

        merged = _merge_wfigs_map_payloads(
            [current],
            max_features=120,
            failed_cell_count=1,
        )
        self.assertEqual(merged["metadata"]["availability"], "degraded")
        self.assertEqual(merged["metadata"]["freshness"], "fresh")
        self.assertTrue(merged["metadata"]["partial"])
        self.assertEqual(merged["metadata"]["partial_reasons"], ["cell_fetch_failure"])
        self.assertEqual(merged["metadata"]["stale_cell_count"], 0)

    def test_wfigs_merge_marks_stale_missing_coverage_stale_partial(self):
        stale_partial = _compact_wfigs_map_payload({
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": _wfigs_polygon(),
                    "properties": {"poly_IRWINID": "cached-valid"},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-110, 38]},
                    "properties": {"poly_IRWINID": "cached-unsupported"},
                },
            ],
        }, max_features=120)
        stale_partial["metadata"].update({
            "availability": "degraded",
            "freshness": "stale",
            "age_seconds": 1_200,
        })

        merged = _merge_wfigs_map_payloads([stale_partial], max_features=120)
        self.assertEqual(merged["metadata"]["availability"], "degraded")
        self.assertEqual(merged["metadata"]["freshness"], "stale")
        self.assertTrue(merged["metadata"]["partial"])
        self.assertEqual(merged["metadata"]["partial_reasons"], ["invalid_geometry"])
        self.assertEqual(merged["metadata"]["stale_cell_count"], 1)
        self.assertEqual(merged["metadata"]["partial_cell_count"], 1)


class WfigsMapCacheTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        self.temp_dir = tempfile.TemporaryDirectory()
        settings.db_path = str(Path(self.temp_dir.name) / "wfigs-cache.db")
        db = sqlite3.connect(settings.db_path)
        db.execute(
            "CREATE TABLE weather_cache (cache_key TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, data TEXT NOT NULL)"
        )
        db.commit()
        db.close()

    def tearDown(self):
        settings.db_path = self.original_db_path
        self.temp_dir.cleanup()

    def test_wfigs_cache_prunes_only_its_namespace(self):
        db = sqlite3.connect(settings.db_path)
        db.executemany(
            "INSERT INTO weather_cache(cache_key,fetched_at,data) VALUES(?,?,?)",
            [
                ("conditions:wfigs:map:v2:stale", 100, "{}"),
                ("conditions:wfigs:perimeters", 100, "{}"),
                ("conditions:nws:nearby", 100, "{}"),
            ],
        )
        db.commit()
        db.close()

        store.set_wfigs_map_cached(
            "conditions:wfigs:map:v3:current",
            {"type": "FeatureCollection", "features": []},
            now=1000,
            max_rows=2,
            max_age_seconds=300,
        )
        db = sqlite3.connect(settings.db_path)
        keys = {row[0] for row in db.execute("SELECT cache_key FROM weather_cache")}
        db.close()
        self.assertNotIn("conditions:wfigs:map:v2:stale", keys)
        self.assertIn("conditions:wfigs:map:v3:current", keys)
        self.assertIn("conditions:wfigs:perimeters", keys)
        self.assertIn("conditions:nws:nearby", keys)

    def test_wfigs_cache_preserves_just_written_key_on_timestamp_ties(self):
        for suffix in ("zzz", "yyy", "aaa"):
            store.set_wfigs_map_cached(
                f"conditions:wfigs:map:v3:{suffix}",
                {"suffix": suffix},
                now=100,
                max_rows=2,
                max_age_seconds=1000,
            )
        db = sqlite3.connect(settings.db_path)
        keys = {row[0] for row in db.execute(
            "SELECT cache_key FROM weather_cache WHERE cache_key LIKE 'conditions:wfigs:map:%'"
        )}
        db.close()
        self.assertEqual(len(keys), 2)
        self.assertIn("conditions:wfigs:map:v3:aaa", keys)

    def test_wfigs_cache_rejects_non_map_keys(self):
        with self.assertRaises(ValueError):
            store.set_wfigs_map_cached("conditions:wfigs:perimeters", {})

    def test_wfigs_cache_exposes_bounded_age_for_stale_fallback(self):
        key = "conditions:wfigs:map:v3:stale-readable"
        store.set_wfigs_map_cached(key, {"type": "FeatureCollection", "features": []}, now=100)
        payload, age = store.get_wfigs_map_cached(key, max_age_seconds=1_800, now=1_300)
        self.assertIsInstance(payload, dict)
        self.assertEqual(age, 1_200)
        expired, expired_age = store.get_wfigs_map_cached(key, max_age_seconds=1_000, now=1_300)
        self.assertIsNone(expired)
        self.assertEqual(expired_age, 1_200)


class _WfigsFakeResponse:
    def __init__(self, payload: dict, *, fail: bool = False):
        self.payload = payload
        self.fail = fail
        self.headers = {}

    async def __aenter__(self):
        await asyncio.sleep(0.01)
        return self

    async def __aexit__(self, *_args):
        return False

    def raise_for_status(self):
        if self.fail:
            raise RuntimeError("provider unavailable")

    async def aiter_bytes(self):
        yield json.dumps(self.payload).encode("utf-8")


class _WfigsFakeClient:
    def __init__(self, payload: dict, *, fail: bool = False):
        self.payload = payload
        self.fail = fail
        self.calls = 0

    def stream(self, *_args, **_kwargs):
        self.calls += 1
        return _WfigsFakeResponse(self.payload, fail=self.fail)


class WfigsMapFetchTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        self.temp_dir = tempfile.TemporaryDirectory()
        settings.db_path = str(Path(self.temp_dir.name) / "wfigs-fetch.db")
        db = sqlite3.connect(settings.db_path)
        db.execute(
            "CREATE TABLE weather_cache (cache_key TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, data TEXT NOT NULL)"
        )
        db.commit()
        db.close()

    def tearDown(self):
        settings.db_path = self.original_db_path
        self.temp_dir.cleanup()

    async def test_same_cell_requests_are_coalesced(self):
        payload = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": _wfigs_polygon(),
                "properties": {"poly_IRWINID": "fire-1", "poly_IncidentName": "Example"},
            }],
        }
        client = _WfigsFakeClient(payload)
        bounds = (39.0, 38.0, -108.0, -110.0)
        first, second = await asyncio.gather(
            _fetch_wfigs_map_payload(client, bounds=bounds, max_features=120),
            _fetch_wfigs_map_payload(client, bounds=bounds, max_features=120),
        )
        self.assertEqual(client.calls, 1)
        self.assertEqual(first["features"], second["features"])
        self.assertEqual(first["metadata"]["availability"], "available")

    async def test_all_dropped_geometry_is_available_but_partial_not_fresh_empty(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-110, 38]},
                    "properties": {"poly_IRWINID": "unsupported-point"},
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-110, 38], [-109, 38], [-109, None], [-110, 38]]],
                    },
                    "properties": {"poly_IRWINID": "invalid-polygon"},
                },
            ],
        }
        result = await _fetch_wfigs_map_payload(
            _WfigsFakeClient(payload),
            bounds=(38.5, 37.5, -109.5, -110.5),
            max_features=120,
        )
        self.assertEqual(result["features"], [])
        self.assertEqual(result["metadata"]["availability"], "available")
        self.assertEqual(result["metadata"]["freshness"], "fresh")
        self.assertTrue(result["metadata"]["partial"])
        self.assertEqual(result["metadata"]["dropped_feature_count"], 2)
        self.assertEqual(result["metadata"]["partial_reasons"], ["invalid_geometry"])

    async def test_provider_failure_uses_stale_payload_with_explicit_metadata(self):
        bounds = (39.0, 38.0, -108.0, -110.0)
        key = _wfigs_map_cache_key(bounds, max_features=120)
        store.set_wfigs_map_cached(
            key,
            {"type": "FeatureCollection", "features": [], "metadata": {}},
            now=int(time.time()) - 1_200,
            max_age_seconds=1_800,
        )
        result = await _fetch_wfigs_map_payload(
            _WfigsFakeClient({}, fail=True),
            bounds=bounds,
            max_features=120,
        )
        self.assertEqual(result["metadata"]["availability"], "degraded")
        self.assertEqual(result["metadata"]["freshness"], "stale")
        self.assertFalse(result["metadata"]["partial"])
        self.assertEqual(result["metadata"]["availability_reason"], "provider_unavailable")

    async def test_provider_failure_backoff_prevents_repeated_cold_calls(self):
        client = _WfigsFakeClient({}, fail=True)
        bounds = (40.0, 39.0, -107.0, -109.0)
        self.assertIsNone(await _fetch_wfigs_map_payload(client, bounds=bounds, max_features=120))
        self.assertIsNone(await _fetch_wfigs_map_payload(client, bounds=bounds, max_features=120))
        self.assertEqual(client.calls, 1)

    async def test_http_200_provider_error_body_is_not_cached_as_no_active_fires(self):
        bounds = (42.0, 41.0, -105.0, -107.0)
        key = _wfigs_map_cache_key(bounds, max_features=120)
        stale_payload = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": _wfigs_polygon(),
                "properties": {"id": "stale-fire", "name": "Last verified perimeter"},
            }],
            "metadata": {},
        }
        store.set_wfigs_map_cached(
            key,
            stale_payload,
            now=int(time.time()) - 1_200,
            max_age_seconds=1_800,
        )
        client = _WfigsFakeClient({
            "error": {
                "code": 429,
                "message": "API calls quota exceeded",
            },
        })

        first = await _fetch_wfigs_map_payload(
            client,
            bounds=bounds,
            max_features=120,
        )
        second = await _fetch_wfigs_map_payload(
            client,
            bounds=bounds,
            max_features=120,
        )

        self.assertEqual(client.calls, 1)
        self.assertEqual(first["features"], stale_payload["features"])
        self.assertEqual(first["metadata"]["availability"], "degraded")
        self.assertEqual(first["metadata"]["availability_reason"], "provider_unavailable")
        self.assertEqual(second["metadata"]["availability_reason"], "provider_backoff")
        cached, _age = store.get_wfigs_map_cached(key, max_age_seconds=1_800)
        self.assertEqual(cached["features"], stale_payload["features"])

    async def test_global_outbound_budget_fails_closed_before_provider_call(self):
        state = _wfigs_map_loop_state()
        state["request_times"].extend([time.monotonic()] * WFIGS_MAP_OUTBOUND_MAX_REQUESTS)
        client = _WfigsFakeClient({"type": "FeatureCollection", "features": []})
        result = await _fetch_wfigs_map_payload(
            client,
            bounds=(41.0, 40.0, -106.0, -108.0),
            max_features=120,
        )
        self.assertIsNone(result)
        self.assertEqual(client.calls, 0)


if __name__ == "__main__":
    unittest.main()
