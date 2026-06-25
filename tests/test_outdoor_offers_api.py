from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from dashboard import server


class OutdoorOffersApiTests(unittest.TestCase):
    def test_public_empty_response_is_neutral(self):
        result = server.OfferSearchResult(
            "outdoorsy",
            "unconfirmed_contract",
            reason="missing_backend_credentials",
        )
        public = server._public_offer_search_response(result)
        payload = json.dumps(public).lower()
        self.assertEqual(public["status"], "empty")
        self.assertEqual(public["offers"], [])
        self.assertNotIn("reason", public)
        self.assertNotIn("credential", payload)
        self.assertNotIn("contract", payload)

    def test_offer_event_context_filters_private_location(self):
        context = server._offer_event_context({
            "lat": 39.7392,
            "lng": -104.9903,
            "email": "driver@example.com",
            "route_geometry": [[-104.99, 39.73]],
            "camp_nights": 4,
            "route_type": "camping",
        })
        self.assertEqual(context, {"camp_nights": 4, "route_type": "camping"})

    def test_rental_cache_key_uses_coarse_public_search_fields(self):
        query = server.OfferSearchQuery(
            lat=39.739245,
            lng=-104.990318,
            start_date="2026-07-01",
            end_date="2026-07-05",
            sleeps=2,
            vehicle_type="campervan_rental",
            provider="outdoorsy",
        )
        key = server._offer_query_cache_key(query)
        self.assertIn("39.739", key)
        self.assertIn("-104.990", key)
        self.assertNotIn("39.739245", key)
        self.assertNotIn("api", key.lower())
        self.assertNotIn("token", key.lower())

    def test_empty_rental_cache_ttl_is_short(self):
        result = server.OfferSearchResult("outdoorsy", "empty", offers=[])
        self.assertEqual(server._offer_cache_ttl_seconds(result, now=100), 30)

    def test_record_offer_event_logs_only_safe_payload(self):
        body = server.OfferEventRequest(
            offer_id="outdoorsy:denver-campervan-1",
            provider="outdoorsy",
            placement="route_builder",
            route_type="camping",
            session_id="session-1",
            context={
                "lat": 39.7392,
                "lng": -104.9903,
                "route_geometry": [[-104.99, 39.73]],
                "camp_nights": 3,
                "vehicle_type": "campervan",
            },
        )
        events: list[tuple[object, object, object, dict]] = []

        def fake_log_event(user_id, session_id, event_type, event_data):
            events.append((user_id, session_id, event_type, event_data))

        with patch.object(server, "log_event", fake_log_event):
            self.assertEqual(server._record_offer_event("commerce_offer_click", body, None), {"ok": True})

        self.assertEqual(len(events), 1)
        _, session_id, event_type, event_data = events[0]
        self.assertEqual(session_id, "session-1")
        self.assertEqual(event_type, "commerce_offer_click")
        payload = json.dumps(event_data).lower()
        self.assertIn("outdoorsy:denver-campervan-1", payload)
        self.assertIn("campervan", payload)
        self.assertNotIn("route_geometry", payload)
        self.assertNotIn("39.7392", payload)
        self.assertNotIn("-104.9903", payload)


if __name__ == "__main__":
    unittest.main()
