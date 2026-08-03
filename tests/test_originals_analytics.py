from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from dashboard import server


class TrailheadOriginalsAnalyticsTests(unittest.TestCase):
    def test_originals_payload_uses_strict_scalar_allowlist(self):
        with patch.object(server, "validate_original_analytics_dimensions", return_value=True):
            clean = server._clean_originals_analytics_event_data(
                "originals_stop_outcome",
                {
                "pack_id": "original_moab",
                "version": 3,
                "stop_id": "stop_dead_horse",
                "outcome": "missed",
                "release_cohort": "precise-user-bucket",
                "lat": 38.5733,
                "lng": -109.5498,
                "coordinates": [-109.5498, 38.5733],
                "route_geometry": {"type": "LineString", "coordinates": [[-109.5, 38.5]]},
                "traveled_route": [[-109.5, 38.5]],
                "device_id": "private-device",
                },
            )
        self.assertEqual(
            clean,
            {
                "release_cohort": "originals_v1",
                "pack_id": server._originals_analytics_alias("pack", "original_moab"),
                "version": 3,
                "stop_id": server._originals_analytics_alias("stop", "stop_dead_horse"),
                "outcome": "missed",
            },
        )
        serialized = json.dumps(clean)
        self.assertNotIn("38.5733", serialized)
        self.assertNotIn("-109.5498", serialized)
        self.assertNotIn("private-device", serialized)
        self.assertNotIn("precise-user-bucket", serialized)

    def test_endpoint_persists_only_sanitized_originals_dimensions(self):
        events: list[tuple[object, object, object, dict]] = []

        def fake_log_event(user_id, session_id, event_type, event_data):
            events.append((user_id, session_id, event_type, event_data))

        body = server.AnalyticsEventRequest(
            event_type="originals_download_result",
            session_id="session:moab/unsafe",
            event_data={
                "pack_id": "original_moab",
                "version": 1,
                "result": "ready",
                "distance_m": 432.1,
                "last_location": {"lat": 38.5, "lng": -109.5},
            },
        )
        with patch.object(server, "log_event", fake_log_event), patch.object(
            server, "validate_original_analytics_dimensions", return_value=True,
        ):
            result = asyncio.run(server.analytics_event(body, {"id": 42}))

        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(events), 1)
        user_id, session_id, event_type, event_data = events[0]
        self.assertIsNone(user_id)
        self.assertIsNone(session_id)
        self.assertEqual(event_type, "originals_download_result")
        self.assertEqual(event_data, {
            "release_cohort": "originals_v1",
            "pack_id": server._originals_analytics_alias("pack", "original_moab"),
            "version": 1,
            "result": "ready",
        })

    def test_unknown_originals_events_and_dimensions_are_rejected(self):
        with self.assertRaises(HTTPException) as unknown:
            asyncio.run(server.analytics_event(server.AnalyticsEventRequest(
                event_type="originals_location",
                event_data={"pack_id": "moab", "version": 1},
            ), None))
        self.assertEqual(unknown.exception.status_code, 400)

        with self.assertRaises(HTTPException) as invalid_state:
            server._clean_originals_analytics_event_data(
                "originals_route_state",
                {"pack_id": "original_moab", "version": 1, "state": "off_route"},
            )
        self.assertEqual(invalid_state.exception.status_code, 400)

    def test_coordinate_smuggling_in_pack_or_stop_identifiers_fails_closed(self):
        with patch.object(server, "validate_original_analytics_dimensions", return_value=False) as canonical:
            with self.assertRaises(HTTPException) as pack_smuggling:
                server._clean_originals_analytics_event_data(
                    "originals_download_result",
                    {"pack_id": "original:38.5733:109.5498", "version": 1, "result": "ready"},
                )
        self.assertEqual(pack_smuggling.exception.status_code, 400)
        canonical.assert_called_once_with("original:38.5733:109.5498", 1, None, None)

        with patch.object(server, "validate_original_analytics_dimensions", return_value=False) as canonical:
            with self.assertRaises(HTTPException) as stop_smuggling:
                server._clean_originals_analytics_event_data(
                    "originals_stop_outcome",
                    {
                        "pack_id": "original_moab", "version": 1,
                        "stop_id": "stop:38.5733:109.5498", "outcome": "missed",
                    },
                )
        self.assertEqual(stop_smuggling.exception.status_code, 400)
        canonical.assert_called_once_with("original_moab", 1, "stop:38.5733:109.5498", None)

    def test_legacy_analytics_scrubber_removes_location_and_route_shapes(self):
        clean = server._scrub_analytics_event_data({
            "campaign": "welcome",
            "lat": 38.5,
            "nested": {"route_points": [[-109.5, 38.5]], "label": "safe"},
            "samples": [[-109.5, 38.5]],
            "labels": ["one", "two"],
        })
        self.assertEqual(clean, {
            "campaign": "welcome",
            "nested": {"label": "safe"},
            "labels": ["one", "two"],
        })

    def test_phase0_endpoint_keeps_only_aggregate_allowlisted_dimensions(self):
        events: list[tuple[object, object, object, dict]] = []

        def fake_log_event(user_id, session_id, event_type, event_data):
            events.append((user_id, session_id, event_type, event_data))

        body = server.AnalyticsEventRequest(
            event_type="phase0_search_no_results",
            session_id="stable-install-or-session-id",
            event_data={
                "surface": "map_copilot_camp_search",
                "category": "camp",
                "query": "camp near my home",
                "searched_near": "123 Private Street",
                "lat_bucket": "38.57",
                "lng_bucket": "-109.55",
                "trip_id": "private-trip-id",
                "user_id": 42,
            },
        )
        with patch.object(server, "log_event", fake_log_event):
            result = asyncio.run(server.analytics_event(body, {"id": 42}))

        self.assertEqual(result, {"ok": True})
        self.assertEqual(events, [(
            None,
            None,
            "phase0_search_no_results",
            {"surface": "map_copilot_camp_search", "category": "camp"},
        )])

    def test_phase0_labels_and_event_types_fail_closed(self):
        clean = server._clean_nonidentifying_analytics_event_data(
            "phase0_route_alert_row_tapped",
            {
                "alert_type": "road_closure",
                "provider": "Official provider with spaces and user text",
                "severity": "warning",
                "alert_id": "private-alert-id",
            },
        )
        self.assertEqual(clean, {"alert_type": "road_closure", "severity": "warning"})

        with self.assertRaises(HTTPException) as unknown:
            asyncio.run(server.analytics_event(server.AnalyticsEventRequest(
                event_type="phase0_arbitrary_future_payload",
                event_data={"query": "private search"},
            ), None))
        self.assertEqual(unknown.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
