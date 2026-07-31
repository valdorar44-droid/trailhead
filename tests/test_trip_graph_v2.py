import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import os
import tempfile
import threading
import unittest
from unittest.mock import patch

from config.settings import settings
from fastapi import HTTPException

from dashboard.server import (
    AccountTripRequest,
    TripDocumentPayload,
    api_trip_document_v2,
    api_trip_documents_v2,
    create_account_trip,
    product_features,
    update_account_trip,
)
from db import store


def _trip_document(trip_id: str, title: str = "Desert loop", status: str = "draft") -> dict:
    return {
        "schema_version": 2,
        "trip_id": trip_id,
        "status": status,
        "title": title,
        "dates": {},
        "rig_snapshot": {},
        "days": [],
        "items": [],
        "notes": [],
        "readiness": {},
        "bookings": [],
        "alerts": [],
        "offline": {},
        "visibility": "private",
        "source": "test",
    }


class TripGraphV2StoreTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()
        self.user_one = store.create_user(
            "one@example.com", "user_one", "hash", "user-one-code"
        )
        self.user_two = store.create_user(
            "two@example.com", "user_two", "hash", "user-two-code"
        )

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    def test_trip_documents_use_account_scoped_identity(self):
        saved_one = store.upsert_trip_document_v2(
            self.user_one,
            "trip_owned",
            _trip_document("trip_owned", "Owner one route"),
            expected_revision=0,
            idempotency_key="create-owned",
        )
        saved_two = store.upsert_trip_document_v2(
            self.user_two,
            "trip_owned",
            _trip_document("trip_owned", "Owner two route"),
            expected_revision=0,
            idempotency_key="create-owned-two",
        )
        self.assertEqual(saved_one["revision"], 1)
        self.assertEqual(saved_two["revision"], 1)
        self.assertEqual(
            store.get_trip_document_v2(self.user_one, "trip_owned")["title"],
            "Owner one route",
        )
        self.assertEqual(
            store.get_trip_document_v2(self.user_two, "trip_owned")["title"],
            "Owner two route",
        )

        store.upsert_saved_entity(
            self.user_one, "thp_shared", "camp", "Owner one's camp", {}, 0
        )
        store.upsert_saved_entity(
            self.user_two, "thp_shared", "camp", "Owner two's camp", {}, 0
        )
        self.assertEqual(
            store.get_saved_entity(self.user_one, "thp_shared")["title"],
            "Owner one's camp",
        )
        self.assertEqual(
            store.get_saved_entity(self.user_two, "thp_shared")["title"],
            "Owner two's camp",
        )

    def test_library_cursor_pagination_has_no_total_result_cap(self):
        expected_ids = set()
        for index in range(137):
            canonical_id = f"thp_{index:03d}"
            expected_ids.add(canonical_id)
            store.upsert_saved_entity(
                self.user_one,
                canonical_id,
                "place",
                f"Saved place {index}",
                {"position": index},
                expected_revision=0,
            )

        found_ids = []
        cursor = None
        while True:
            page = store.list_saved_entities(
                self.user_one, limit=19, cursor=cursor
            )
            found_ids.extend(item["canonical_id"] for item in page["items"])
            cursor = page["next_cursor"]
            if not cursor:
                break

        self.assertEqual(len(found_ids), 137)
        self.assertEqual(set(found_ids), expected_ids)
        self.assertEqual(len(found_ids), len(set(found_ids)))
        with self.assertRaisesRegex(ValueError, "Invalid cursor"):
            store.list_saved_entities(self.user_one, cursor="not-a-cursor")

    def test_trip_cursor_pagination_has_no_total_result_cap(self):
        db = store._conn()
        rows = []
        for index in range(121):
            trip_id = f"trip_page_{index:03d}"
            rows.append((
                trip_id,
                self.user_one,
                "draft",
                1,
                json.dumps(_trip_document(trip_id)),
                1000,
                1000,
                None,
                None,
            ))
        db.executemany(
            """INSERT INTO trip_documents_v2
               (id,user_id,status,revision,document_json,created_at,updated_at,archived_at,deleted_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            rows,
        )
        db.commit()
        db.close()

        found_ids = []
        cursor = None
        while True:
            page = store.list_trip_documents_v2(
                self.user_one,
                limit=17,
                cursor=cursor,
                include_legacy_v1=False,
            )
            found_ids.extend(item["trip_id"] for item in page["items"])
            cursor = page["next_cursor"]
            if not cursor:
                break

        self.assertEqual(len(found_ids), 121)
        self.assertEqual(len(set(found_ids)), 121)

    def test_compact_trip_list_omits_only_legacy_payload(self):
        store.save_account_trip(
            "legacy_compact_trip",
            {
                "trip_id": "legacy_compact_trip",
                "plan": {
                    "trip_name": "Legacy compact route",
                    "overview": "Keep the useful summary.",
                    "duration_days": 4,
                    "total_est_miles": 321,
                    "daily_itinerary": [{"day": 1, "title": "Moab arrival"}],
                    "waypoints": [{
                        "id": "thp_dead_horse_camp",
                        "name": "Dead Horse Point Campground",
                        "type": "camp",
                        "lat": 38.4869,
                        "lng": -109.7396,
                        "photo_url": "https://images.example.test/dead-horse.jpg",
                        "site_types": ["RV", "Tent"],
                    }],
                },
            },
            self.user_one,
            route_geometry={"coordinates": [[-109.5, 38.5], [-108.5, 39.0]]},
            builder_state={"mode": "manual"},
            source="mobile",
        )

        default_item = store.list_trip_documents_v2(self.user_one)["items"][0]
        compact_item = store.list_trip_documents_v2(
            self.user_one, include_legacy_v1=False,
        )["items"][0]

        self.assertIn("legacy_v1", default_item)
        self.assertNotIn("legacy_v1", compact_item)
        self.assertEqual(
            default_item["items"][0]["name"],
            "Dead Horse Point Campground",
        )
        for key in set(default_item) - {"days", "items", "route", "legacy_v1"}:
            self.assertEqual(compact_item[key], default_item[key])
        self.assertIs(compact_item["legacy_v1_available"], True)
        self.assertEqual(compact_item["days"][0]["title"], "Moab arrival")
        self.assertEqual(len(compact_item["days"]), 4)
        self.assertEqual(compact_item["route"]["totalDistanceMi"], 321)
        self.assertEqual(compact_item["items"][0]["kind"], "camp")
        self.assertEqual(
            compact_item["items"][0]["entity_id"], "thp_dead_horse_camp",
        )
        self.assertEqual(
            compact_item["items"][0]["coordinates"],
            {"lat": 38.4869, "lng": -109.7396},
        )
        projected_waypoint = compact_item["items"][0]["facts"]["legacy_waypoint"]
        self.assertEqual(
            projected_waypoint["photo_url"],
            "https://images.example.test/dead-horse.jpg",
        )
        self.assertEqual(projected_waypoint["site_types"], ["RV", "Tent"])

        individual = store.get_trip_document_v2(
            self.user_one, "legacy_compact_trip",
        )
        self.assertEqual(individual["legacy_v1"], default_item["legacy_v1"])

        api_default_page = asyncio.run(api_trip_documents_v2(
            user={"id": self.user_one},
        ))
        self.assertIn("legacy_v1", api_default_page["items"][0])
        api_compact_page = asyncio.run(api_trip_documents_v2(
            include_legacy_v1=False,
            user={"id": self.user_one},
        ))
        self.assertNotIn("legacy_v1", api_compact_page["items"][0])
        api_individual = asyncio.run(api_trip_document_v2(
            "legacy_compact_trip",
            user={"id": self.user_one},
        ))
        self.assertEqual(api_individual["legacy_v1"], default_item["legacy_v1"])

    def test_compact_list_repairs_preexisting_raw_migrated_v2_items(self):
        store.save_account_trip(
            "legacy_migrated_compact",
            {
                "trip_id": "legacy_migrated_compact",
                "plan": {
                    "trip_name": "Migrated compact route",
                    "duration_days": 3,
                    "total_est_miles": 88,
                    "daily_itinerary": [{"day": 1, "title": "Arrival"}],
                    "waypoints": [{
                        "id": "legacy-stop",
                        "name": "Scenic overlook",
                        "type": "place",
                        "lat": 38.5,
                        "lng": -109.5,
                        "photo_url": "https://images.example.test/overlook.jpg",
                    }],
                },
            },
            self.user_one,
            route_geometry={"coordinates": [[-109.5, 38.5], [-109.4, 38.6]]},
            source="mobile",
        )
        projected = store.get_trip_document_v2(
            self.user_one, "legacy_migrated_compact",
        )
        self.assertIn("name", projected["items"][0])
        migrated = store.upsert_trip_document_v2(
            self.user_one,
            "legacy_migrated_compact",
            projected,
            projected["revision"],
            "migrate-before-compact",
        )
        self.assertIn("name", migrated["items"][0])

        compact = store.list_trip_documents_v2(
            self.user_one, include_legacy_v1=False,
        )["items"][0]
        self.assertNotIn("name", compact["items"][0])
        self.assertEqual(compact["items"][0]["title"], "Scenic overlook")
        self.assertEqual(compact["items"][0]["coordinates"], {"lat": 38.5, "lng": -109.5})
        self.assertEqual(
            compact["items"][0]["facts"]["legacy_waypoint"]["photo_url"],
            "https://images.example.test/overlook.jpg",
        )
        self.assertEqual(len(compact["days"]), 3)
        self.assertEqual(compact["route"]["totalDistanceMi"], 88)

    def test_compact_list_keeps_newer_canonical_v2_content(self):
        created = store.upsert_trip_document_v2(
            self.user_one,
            "canonical_wins_compact",
            {
                **_trip_document("canonical_wins_compact", "Canonical route"),
                "route": {"totalDistance": 0},
                "days": [{"day": 1, "title": "New day title", "summary": "Current"}],
                "items": [{
                    "schema_version": 1,
                    "id": "canonical-stop",
                    "kind": "camp",
                    "title": "Current campground",
                    "summary": "Current details",
                    "day": 1,
                    "order": 0,
                    "coordinates": {"lat": 38.6, "lng": -109.6},
                }],
                "legacy_v1": {
                    "trip": {
                        "plan": {
                            "trip_name": "Stale legacy route",
                            "duration_days": 4,
                            "total_est_miles": 321,
                            "daily_itinerary": [{"day": 1, "title": "Old day title"}],
                            "waypoints": [{
                                "id": "canonical-stop",
                                "name": "Old campground",
                                "type": "place",
                                "lat": 38.5,
                                "lng": -109.5,
                            }],
                        },
                    },
                },
            },
            0,
            "canonical-compact-create",
        )
        self.assertEqual(created["revision"], 1)

        compact = store.list_trip_documents_v2(
            self.user_one, include_legacy_v1=False,
        )["items"][0]
        self.assertEqual(compact["items"][0]["title"], "Current campground")
        self.assertEqual(compact["items"][0]["kind"], "camp")
        self.assertEqual(compact["items"][0]["coordinates"], {"lat": 38.6, "lng": -109.6})
        self.assertEqual(compact["days"][0]["title"], "New day title")
        self.assertEqual(compact["days"][0]["summary"], "Current")
        self.assertEqual(
            len(compact["days"]),
            1,
            "stale legacy duration cannot re-add days removed from a canonical V2 trip",
        )
        self.assertEqual(compact["route"], {"totalDistance": 0})
        self.assertNotIn(
            "totalDistanceMi",
            compact["route"],
            "an explicit canonical V2 route remains authoritative",
        )

        positive_meter_document = {
            **_trip_document("canonical_meter_distance", "Canonical meter route"),
            "route": {"totalDistance": 1609.344},
            "legacy_v1": {
                "trip": {
                    "plan": {
                        "trip_name": "Stale long route",
                        "total_est_miles": 321,
                    },
                },
            },
        }
        store.upsert_trip_document_v2(
            self.user_one,
            "canonical_meter_distance",
            positive_meter_document,
            0,
            "canonical-meter-create",
        )
        meter_compact = next(
            item for item in store.list_trip_documents_v2(
                self.user_one, include_legacy_v1=False,
            )["items"]
            if item["trip_id"] == "canonical_meter_distance"
        )
        self.assertEqual(meter_compact["route"]["totalDistance"], 1609.344)
        self.assertNotIn(
            "totalDistanceMi",
            meter_compact["route"],
            "a positive canonical meter distance is not replaced by stale legacy miles",
        )

    def test_compact_list_and_write_keep_explicit_empty_v2_fields_authoritative(self):
        created = store.upsert_trip_document_v2(
            self.user_one,
            "canonical_empty_compact",
            {
                **_trip_document("canonical_empty_compact", "Canonical empty route"),
                "regions": [],
                "route": {},
                "legacy_v1": {
                    "request": "Keep this original request",
                    "trip": {
                        "plan": {
                            "trip_name": "Stale legacy route",
                            "states": ["UT"],
                            "duration_days": 3,
                            "total_est_miles": 88,
                            "daily_itinerary": [
                                {"day": 1, "title": "Old day", "weather": "Clear"},
                            ],
                            "waypoints": [
                                {"id": "old-stop", "name": "Old stop", "type": "camp"},
                            ],
                            "campsites": [
                                {"id": "old-stop", "name": "Old stop", "type": "camp"},
                            ],
                            "gas_stations": [
                                {"id": "old-fuel", "name": "Old fuel", "type": "fuel"},
                            ],
                            "legacy_only": "preserve me",
                        },
                        "campsites": [
                            {"id": "old-stop", "name": "Old stop", "type": "camp"},
                        ],
                        "gas_stations": [
                            {"id": "old-fuel", "name": "Old fuel", "type": "fuel"},
                        ],
                    },
                    "route_geometry": {"coordinates": [[-109.5, 38.5], [-109.4, 38.6]]},
                    "builder_state": {"mode": "manual", "bookings": [{"id": "booking-1"}]},
                },
            },
            0,
            "canonical-empty-create",
        )

        compact = store.list_trip_documents_v2(
            self.user_one, include_legacy_v1=False,
        )["items"][0]
        self.assertEqual(compact["regions"], [])
        self.assertEqual(compact["days"], [])
        self.assertEqual(compact["items"], [])
        self.assertEqual(compact["route"], {})

        compact.pop("legacy_v1_available", None)
        compact["title"] = "Canonical empty route updated"
        updated = store.upsert_trip_document_v2(
            self.user_one,
            "canonical_empty_compact",
            compact,
            created["revision"],
            "canonical-empty-update",
        )
        legacy = updated["legacy_v1"]
        plan = legacy["trip"]["plan"]
        self.assertEqual(plan["trip_name"], "Canonical empty route updated")
        self.assertEqual(plan["states"], [])
        self.assertEqual(plan["daily_itinerary"], [])
        self.assertEqual(plan["waypoints"], [])
        self.assertEqual(plan["campsites"], [])
        self.assertEqual(plan["gas_stations"], [])
        self.assertEqual(legacy["trip"]["campsites"], [])
        self.assertEqual(legacy["trip"]["gas_stations"], [])
        self.assertNotIn("total_est_miles", plan)
        self.assertEqual(plan["legacy_only"], "preserve me")
        self.assertEqual(legacy["route_geometry"], {})
        self.assertEqual(legacy["request"], "Keep this original request")
        self.assertEqual(
            legacy["builder_state"],
            {"mode": "manual", "bookings": [{"id": "booking-1"}]},
        )

    def test_compact_mobile_empty_route_clears_existing_legacy_route(self):
        store.save_account_trip(
            "legacy_route_clear",
            {
                "trip_id": "legacy_route_clear",
                "plan": {
                    "trip_name": "Route to clear",
                    "total_est_miles": 44,
                    "waypoints": [
                        {"id": "start", "name": "Start", "type": "start"},
                        {"id": "finish", "name": "Finish", "type": "destination"},
                    ],
                },
            },
            self.user_one,
            route_geometry={"coordinates": [[-109.5, 38.5], [-109.4, 38.6]]},
            builder_state={"mode": "manual"},
            source="mobile-route-builder",
        )
        compact = store.list_trip_documents_v2(
            self.user_one, include_legacy_v1=False,
        )["items"][0]
        self.assertTrue(compact["route"]["coordinates"])
        compact.pop("legacy_v1_available", None)
        compact["route"] = {}

        updated = store.upsert_trip_document_v2(
            self.user_one,
            "legacy_route_clear",
            compact,
            compact["revision"],
            "mobile-empty-route",
        )

        self.assertEqual(updated["route"], {})
        self.assertEqual(updated["legacy_v1"]["route_geometry"], {})
        self.assertNotIn(
            "total_est_miles",
            updated["legacy_v1"]["trip"]["plan"],
        )
        old_client = store.get_trip("legacy_route_clear")
        self.assertEqual(old_client["route_geometry"], {})
        self.assertNotIn("total_est_miles", old_client["plan"])
        compact_after = store.list_trip_documents_v2(
            self.user_one, include_legacy_v1=False,
        )["items"][0]
        self.assertEqual(compact_after["route"], {})

    def test_compact_update_preserves_server_owned_legacy_over_two_megabytes(self):
        large_legacy_notes = "L" * 2_150_000
        store.save_account_trip(
            "large_authoritative_legacy",
            {
                "trip_id": "large_authoritative_legacy",
                "plan": {
                    "trip_name": "Large legacy route",
                    "legacy_notes": large_legacy_notes,
                    "waypoints": [{
                        "id": "large-camp",
                        "name": "Large legacy camp",
                        "type": "camp",
                    }],
                },
            },
            self.user_one,
            source="mobile-route-builder",
        )
        compact = store.list_trip_documents_v2(
            self.user_one, include_legacy_v1=False,
        )["items"][0]
        compact.pop("legacy_v1_available", None)
        compact["title"] = "Large legacy route updated"

        updated = store.upsert_trip_document_v2(
            self.user_one,
            "large_authoritative_legacy",
            compact,
            compact["revision"],
            "large-authoritative-update",
        )
        self.assertEqual(
            updated["legacy_v1"]["trip"]["plan"]["legacy_notes"],
            large_legacy_notes,
        )
        self.assertGreater(
            len(json.dumps(updated, separators=(",", ":")).encode("utf-8")),
            2 * 1024 * 1024,
        )
        self.assertEqual(
            store.get_trip("large_authoritative_legacy")["plan"]["legacy_notes"],
            large_legacy_notes,
        )

        oversized_client = _trip_document("oversized_client_trip", "Too large")
        oversized_client["notes"] = [{"text": "C" * 2_150_000}]
        with self.assertRaisesRegex(ValueError, "Trip document is too large"):
            store.upsert_trip_document_v2(
                self.user_one,
                "oversized_client_trip",
                oversized_client,
                0,
                "oversized-client-create",
            )
        self.assertIsNone(
            store.get_trip_document_v2(self.user_one, "oversized_client_trip"),
        )

        over_cap_notes = "S" * (store._TRUSTED_TRIP_DOCUMENT_MAX_BYTES + 1)
        store.save_account_trip(
            "legacy_over_server_cap",
            {
                "trip_id": "legacy_over_server_cap",
                "plan": {
                    "trip_name": "Over server cap",
                    "legacy_notes": over_cap_notes,
                },
            },
            self.user_one,
            source="legacy-import",
        )
        over_cap_compact = next(
            item for item in store.list_trip_documents_v2(
                self.user_one, include_legacy_v1=False,
            )["items"]
            if item["trip_id"] == "legacy_over_server_cap"
        )
        over_cap_compact.pop("legacy_v1_available", None)
        over_cap_compact["title"] = "Must roll back"
        with self.assertRaisesRegex(ValueError, "server storage limit"):
            store.upsert_trip_document_v2(
                self.user_one,
                "legacy_over_server_cap",
                over_cap_compact,
                over_cap_compact["revision"],
                "legacy-over-server-cap",
            )
        unchanged = store.get_trip("legacy_over_server_cap")
        self.assertEqual(unchanged["plan"]["trip_name"], "Over server cap")
        self.assertEqual(unchanged["version"], 1)

    def test_canonical_camp_day_updates_legacy_recommended_day(self):
        legacy_waypoint = {
            "id": "camp-day",
            "name": "Day camp",
            "type": "camp",
            "day": 1,
            "recommended_day": 1,
        }
        merged = store._merge_canonical_v2_into_legacy_v1(
            {
                "trip": {
                    "plan": {
                        "trip_name": "Camp days",
                        "waypoints": [dict(legacy_waypoint)],
                        "campsites": [dict(legacy_waypoint)],
                    },
                    "campsites": [dict(legacy_waypoint)],
                },
            },
            {
                **_trip_document("camp-day-trip", "Camp days"),
                "items": [{
                    "id": "camp-day-occurrence",
                    "entity_id": "camp-day",
                    "kind": "camp",
                    "title": "Day camp",
                    "day": 3,
                    "order": 0,
                    "facts": {"legacy_waypoint": dict(legacy_waypoint)},
                }],
            },
        )
        trip = merged["trip"]
        self.assertEqual(trip["plan"]["waypoints"][0]["recommended_day"], 3)
        self.assertEqual(trip["plan"]["campsites"][0]["recommended_day"], 3)
        self.assertEqual(trip["campsites"][0]["recommended_day"], 3)

    def test_camp_alignment_never_matches_different_stable_ids_by_place_key(self):
        aligned = store._aligned_legacy_waypoint_collection(
            [[
                {
                    "id": "camp-b",
                    "name": "Shared camp",
                    "type": "camp",
                    "lat": 38.5,
                    "lng": -109.5,
                    "reservation": "wrong",
                },
            ]],
            [{
                "id": "camp-a",
                "name": "Shared camp",
                "type": "camp",
                "lat": 38.5,
                "lng": -109.5,
            }],
            "camp",
        )
        self.assertNotIn("reservation", aligned[0])

    def test_repeated_camp_id_matches_rich_occurrences_in_order(self):
        aligned = store._aligned_legacy_waypoint_collection(
            [
                [
                    {"id": "repeat-camp", "name": "Repeat", "type": "camp"},
                    {"id": "repeat-camp", "name": "Repeat", "type": "camp"},
                ],
                [
                    {
                        "id": "repeat-camp",
                        "name": "Repeat",
                        "type": "camp",
                        "reservation": "first",
                    },
                    {
                        "id": "repeat-camp",
                        "name": "Repeat",
                        "type": "camp",
                        "reservation": "second",
                    },
                ],
            ],
            [
                {"id": "repeat-camp", "name": "Repeat", "type": "camp", "day": 1},
                {"id": "repeat-camp", "name": "Repeat", "type": "camp", "day": 3},
            ],
            "camp",
        )
        self.assertEqual(
            [value["reservation"] for value in aligned],
            ["first", "second"],
        )

    def test_sparse_trip_mirror_does_not_erase_rich_plan_camp_fields(self):
        aligned = store._aligned_legacy_waypoint_collection(
            [
                [{
                    "id": "rich-camp",
                    "name": "Rich camp",
                    "type": "camp",
                    "site_types": [],
                    "notes": "",
                    "rating": None,
                }],
                [{
                    "id": "rich-camp",
                    "name": "Rich camp",
                    "type": "camp",
                    "site_types": ["RV", "Tent"],
                    "notes": "Reservations required",
                    "rating": 4.8,
                }],
            ],
            [{"id": "rich-camp", "name": "Rich camp", "type": "camp"}],
            "camp",
        )
        self.assertEqual(aligned[0]["site_types"], ["RV", "Tent"])
        self.assertEqual(aligned[0]["notes"], "Reservations required")
        self.assertEqual(aligned[0]["rating"], 4.8)

    def test_compact_update_preserves_existing_v2_legacy_payload(self):
        legacy_payload = {
            "request": "Build the original route",
            "trip": {"plan": {"trip_name": "Authoritative legacy route"}},
            "route_geometry": {"coordinates": [[-109.5, 38.5], [-108.5, 39.0]]},
            "builder_state": {"mode": "assisted"},
        }
        created = store.upsert_trip_document_v2(
            self.user_one,
            "trip_v2_compact_write",
            {
                **_trip_document("trip_v2_compact_write", "Before compact write"),
                "legacy_v1": legacy_payload,
            },
            0,
            "compact-v2-create",
        )
        compact_document = store.list_trip_documents_v2(
            self.user_one, include_legacy_v1=False,
        )["items"][0]
        compact_document.pop("legacy_v1_available", None)
        compact_document["title"] = "After compact write"

        updated = store.upsert_trip_document_v2(
            self.user_one,
            "trip_v2_compact_write",
            compact_document,
            created["revision"],
            "compact-v2-update",
        )

        self.assertEqual(updated["title"], "After compact write")
        merged_legacy = updated["legacy_v1"]
        self.assertEqual(merged_legacy["request"], legacy_payload["request"])
        self.assertEqual(merged_legacy["builder_state"], legacy_payload["builder_state"])
        self.assertEqual(merged_legacy["route_geometry"], legacy_payload["route_geometry"])
        self.assertEqual(
            merged_legacy["trip"]["plan"]["trip_name"],
            "After compact write",
        )
        self.assertEqual(
            store.get_trip_document_v2(
                self.user_one, "trip_v2_compact_write",
            )["legacy_v1"],
            merged_legacy,
        )

    def test_compact_update_preserves_legacy_only_authoritative_payload(self):
        store.save_account_trip(
            "trip_legacy_compact_write",
            {
                "trip_id": "trip_legacy_compact_write",
                "plan": {
                    "trip_name": "Legacy-only route",
                    "waypoints": [{
                        "id": "dead-horse-camp",
                        "name": "Dead Horse Point",
                        "type": "camp",
                    }],
                },
                "campsites": [{
                    "id": "dead-horse-camp",
                    "name": "Dead Horse Point",
                    "type": "camp",
                    "site_types": ["RV", "Tent"],
                }],
                "gas_stations": [{
                    "id": "stale-fuel",
                    "name": "Removed fuel stop",
                    "type": "fuel",
                }],
            },
            self.user_one,
            route_geometry={"coordinates": [[-109.7, 38.5], [-109.9, 38.4]]},
            builder_state={"mode": "manual", "snap": True},
            source="mobile-route-builder",
        )
        authoritative = store.get_trip_document_v2(
            self.user_one, "trip_legacy_compact_write",
        )["legacy_v1"]
        compact_document = store.list_trip_documents_v2(
            self.user_one, include_legacy_v1=False,
        )["items"][0]
        compact_document.pop("legacy_v1_available", None)
        compact_document["title"] = "Migrated by compact client"

        updated = store.upsert_trip_document_v2(
            self.user_one,
            "trip_legacy_compact_write",
            compact_document,
            compact_document["revision"],
            "compact-legacy-update",
        )

        self.assertEqual(
            updated["legacy_v1"]["trip"]["plan"]["trip_name"],
            "Migrated by compact client",
        )
        self.assertEqual(
            updated["legacy_v1"]["builder_state"],
            authoritative["builder_state"],
        )
        self.assertEqual(
            updated["legacy_v1"]["trip"]["campsites"][0]["site_types"],
            ["RV", "Tent"],
        )
        self.assertEqual(
            updated["legacy_v1"]["trip"]["plan"]["campsites"][0]["site_types"],
            ["RV", "Tent"],
        )
        self.assertEqual(updated["legacy_v1"]["trip"]["gas_stations"], [])
        self.assertEqual(updated["legacy_v1"]["trip"]["plan"]["gas_stations"], [])
        self.assertNotIn("legacy_v1", updated["legacy_v1"])
        self.assertNotIn("payload", updated["legacy_v1"])
        self.assertIn("trip", updated["legacy_v1"])
        self.assertEqual(
            store.get_trip_document_v2(
                self.user_one, "trip_legacy_compact_write",
            )["legacy_v1"],
            updated["legacy_v1"],
        )
        old_client_trip = store.get_trip("trip_legacy_compact_write")
        self.assertEqual(
            old_client_trip["plan"]["trip_name"],
            "Migrated by compact client",
        )
        self.assertEqual(
            old_client_trip["builder_state"],
            authoritative["builder_state"],
        )
        old_client_card = store.list_user_trips(self.user_one)[0]
        self.assertEqual(old_client_card["trip_name"], "Migrated by compact client")

    def test_trip_upsert_is_idempotent_and_rejects_key_reuse(self):
        document = _trip_document("trip_retry")
        first = store.upsert_trip_document_v2(
            self.user_one, "trip_retry", document, 0, "retry-key"
        )
        replay = store.upsert_trip_document_v2(
            self.user_one, "trip_retry", document, 0, "retry-key"
        )

        self.assertEqual(replay, first)
        self.assertEqual(replay["revision"], 1)
        with self.assertRaisesRegex(ValueError, "different request"):
            store.upsert_trip_document_v2(
                self.user_one,
                "trip_retry",
                _trip_document("trip_retry", "Different title"),
                0,
                "retry-key",
            )

    def test_stale_revision_is_rejected_without_overwriting(self):
        created = store.upsert_trip_document_v2(
            self.user_one,
            "trip_revision",
            _trip_document("trip_revision"),
            0,
            "revision-create",
        )
        updated = store.upsert_trip_document_v2(
            self.user_one,
            "trip_revision",
            _trip_document("trip_revision", "Current title"),
            created["revision"],
            "revision-update",
        )
        self.assertEqual(updated["revision"], 2)

        with self.assertRaises(store.RevisionConflictError) as conflict:
            store.upsert_trip_document_v2(
                self.user_one,
                "trip_revision",
                _trip_document("trip_revision", "Stale title"),
                created["revision"],
                "revision-stale",
            )
        self.assertEqual(conflict.exception.current_revision, 2)
        self.assertEqual(
            store.get_trip_document_v2(self.user_one, "trip_revision")["title"],
            "Current title",
        )

    def test_archive_restore_and_soft_delete_are_revision_aware(self):
        trip = store.upsert_trip_document_v2(
            self.user_one,
            "trip_lifecycle",
            _trip_document("trip_lifecycle"),
            0,
            "lifecycle-create",
        )
        archived_document = dict(trip)
        archived_document["status"] = "archived"
        archived = store.upsert_trip_document_v2(
            self.user_one,
            "trip_lifecycle",
            archived_document,
            trip["revision"],
            "lifecycle-archive",
        )
        self.assertEqual(archived["status"], "archived")
        self.assertEqual(store.list_trip_documents_v2(self.user_one)["items"], [])
        self.assertEqual(
            store.list_trip_documents_v2(
                self.user_one,
                include_archived=True,
                include_legacy_v1=False,
            )["items"][0]["trip_id"],
            "trip_lifecycle",
        )

        deleted_document = dict(archived)
        deleted_document["status"] = "deleted"
        deleted = store.upsert_trip_document_v2(
            self.user_one,
            "trip_lifecycle",
            deleted_document,
            archived["revision"],
            "lifecycle-delete",
        )
        self.assertEqual(deleted["revision"], 3)
        self.assertIsNone(store.get_trip_document_v2(self.user_one, "trip_lifecycle"))
        self.assertEqual(
            store.get_trip_document_v2(
                self.user_one, "trip_lifecycle", include_deleted=True
            )["status"],
            "deleted",
        )

        item = store.upsert_saved_entity(
            self.user_one, "thp_lifecycle", "camp", "Lifecycle camp", {}, 0
        )
        item = store.set_saved_entity_status(
            self.user_one, "thp_lifecycle", "archived", item["revision"]
        )
        self.assertEqual(item["status"], "archived")
        item = store.set_saved_entity_status(
            self.user_one, "thp_lifecycle", "deleted", item["revision"]
        )
        self.assertIsNone(store.get_saved_entity(self.user_one, "thp_lifecycle"))
        self.assertEqual(
            store.get_saved_entity(
                self.user_one, "thp_lifecycle", include_deleted=True
            )["status"],
            "deleted",
        )
        self.assertEqual(
            store.list_saved_entities(
                self.user_one, include_deleted=True, include_archived=True
            )["items"][0]["status"],
            "deleted",
        )
        restored = store.upsert_saved_entity(
            self.user_one,
            "thp_lifecycle",
            "camp",
            "Lifecycle camp restored",
            {"restored": True},
            expected_revision=item["revision"],
            status="active",
        )
        self.assertEqual(restored["status"], "active")
        self.assertEqual(restored["revision"], item["revision"] + 1)

        default_deleted_item = store.list_trip_documents_v2(
            self.user_one,
            include_deleted=True,
            include_archived=True,
        )["items"][0]
        compact_deleted_item = store.list_trip_documents_v2(
            self.user_one,
            include_deleted=True,
            include_archived=True,
            include_legacy_v1=False,
        )["items"][0]
        self.assertEqual(default_deleted_item["status"], "deleted")
        self.assertIn("title", default_deleted_item)
        self.assertEqual(compact_deleted_item["status"], "deleted")
        self.assertEqual(
            set(compact_deleted_item),
            {
                "schema_version",
                "trip_id",
                "status",
                "revision",
                "created_at",
                "updated_at",
                "archived_at",
                "deleted_at",
            },
        )
        self.assertNotIn("route", compact_deleted_item)
        self.assertNotIn("items", compact_deleted_item)
        self.assertNotIn("legacy_v1", compact_deleted_item)

    def test_legacy_trip_projects_into_v2_and_migrates_on_write(self):
        store.save_account_trip(
            "legacy_trip",
            {
                "trip_id": "legacy_trip",
                "plan": {
                    "trip_name": "Legacy route",
                    "overview": "Legacy route summary",
                    "states": ["UT"],
                    "daily_itinerary": [{"day": 1, "title": "Arrival"}],
                    "waypoints": [{"name": "Moab", "type": "start"}],
                },
            },
            self.user_one,
            route_geometry={"coordinates": [[-109.5, 38.5], [-108.5, 39.0]]},
            source="mobile",
        )

        projected = store.get_trip_document_v2(self.user_one, "legacy_trip")
        self.assertEqual(projected["schema_version"], 2)
        self.assertEqual(projected["title"], "Legacy route")
        self.assertEqual(projected["summary"], "Legacy route summary")
        self.assertEqual(projected["regions"], ["UT"])
        self.assertEqual(len(projected["route"]["coordinates"]), 2)
        self.assertIn("legacy_v1", projected)
        self.assertEqual(
            store.list_trip_documents_v2(self.user_one)["items"][0]["trip_id"],
            "legacy_trip",
        )

        projected["title"] = "Migrated route"
        migrated = store.upsert_trip_document_v2(
            self.user_one,
            "legacy_trip",
            projected,
            projected["revision"],
            "legacy-migrate",
        )
        self.assertEqual(migrated["revision"], projected["revision"] + 1)
        self.assertEqual(migrated["title"], "Migrated route")

    def test_legacy_trip_write_rejects_a_stale_expected_version(self):
        created = store.save_account_trip(
            "versioned_trip",
            {
                "trip_id": "versioned_trip",
                "plan": {"trip_name": "First version"},
            },
            self.user_one,
            source="mobile",
        )
        self.assertEqual(created["version"], 1)

        updated = store.save_account_trip(
            "versioned_trip",
            {
                "trip_id": "versioned_trip",
                "plan": {"trip_name": "Second version"},
            },
            self.user_one,
            source="mobile",
            expected_version=1,
        )
        self.assertEqual(updated["version"], 2)

        with self.assertRaises(store.RevisionConflictError) as conflict:
            store.save_account_trip(
                "versioned_trip",
                {
                    "trip_id": "versioned_trip",
                    "plan": {"trip_name": "Stale overwrite"},
                },
                self.user_one,
                source="mobile",
                expected_version=1,
            )

        self.assertEqual(conflict.exception.current_revision, 2)
        self.assertEqual(store.get_trip("versioned_trip")["plan"]["trip_name"], "Second version")

    def test_account_trip_compare_and_swap_is_atomic_between_writers(self):
        store.save_account_trip(
            "atomic_trip",
            {"trip_id": "atomic_trip", "plan": {"trip_name": "First version"}},
            self.user_one,
        )
        ready = threading.Barrier(2)

        def write(title: str):
            ready.wait(timeout=2)
            try:
                saved = store.save_account_trip(
                    "atomic_trip",
                    {"trip_id": "atomic_trip", "plan": {"trip_name": title}},
                    self.user_one,
                    expected_version=1,
                )
                return "saved", saved
            except store.RevisionConflictError as exc:
                return "conflict", exc.current_revision

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(write, ("Writer one", "Writer two")))

        self.assertEqual(sorted(result[0] for result in results), ["conflict", "saved"])
        saved_result = next(result[1] for result in results if result[0] == "saved")
        conflict_revision = next(result[1] for result in results if result[0] == "conflict")
        self.assertEqual(saved_result["version"], 2)
        self.assertEqual(conflict_revision, 2)
        self.assertEqual(store.get_trip("atomic_trip")["version"], 2)

    def test_expected_zero_is_create_only_and_saved_version_comes_from_transaction(self):
        with patch.object(store, "get_trip", side_effect=AssertionError("post-commit read")):
            created = store.save_account_trip(
                "create_only_trip",
                {"trip_id": "create_only_trip", "plan": {"trip_name": "Created"}},
                self.user_one,
                expected_version=0,
            )
        self.assertEqual(created["version"], 1)

        with self.assertRaises(store.RevisionConflictError) as conflict:
            store.save_account_trip(
                "create_only_trip",
                {"trip_id": "create_only_trip", "plan": {"trip_name": "Overwrite"}},
                self.user_one,
                expected_version=0,
            )
        self.assertEqual(conflict.exception.current_revision, 1)
        self.assertEqual(store.get_trip("create_only_trip")["plan"]["trip_name"], "Created")

    def test_planner_save_returns_the_exact_committed_legacy_version(self):
        first_version = store.save_trip(
            "planner_version_trip",
            "Build a route",
            {"trip_id": "planner_version_trip", "plan": {"trip_name": "First route"}},
            user_id=self.user_one,
        )
        second_version = store.save_trip(
            "planner_version_trip",
            "Edit the route",
            {"trip_id": "planner_version_trip", "plan": {"trip_name": "Second route"}},
            user_id=self.user_one,
            expected_version=first_version,
        )

        self.assertEqual(first_version, 1)
        self.assertEqual(second_version, 2)
        self.assertEqual(store.get_trip("planner_version_trip")["version"], 2)

    def test_legacy_and_v2_writes_share_one_revision_counter(self):
        legacy = store.save_account_trip(
            "synced_trip",
            {"trip_id": "synced_trip", "plan": {"trip_name": "Legacy title"}},
            self.user_one,
        )
        projected = store.get_trip_document_v2(self.user_one, "synced_trip")
        migrated = store.upsert_trip_document_v2(
            self.user_one,
            "synced_trip",
            {**projected, "title": "V2 title"},
            projected["revision"],
            "sync-v2-write",
        )

        self.assertEqual(legacy["version"], 1)
        self.assertEqual(migrated["revision"], 2)
        self.assertEqual(store.get_trip("synced_trip")["version"], 2)
        self.assertEqual(store.list_user_trips(self.user_one)[0]["version"], 2)

        saved = store.save_account_trip(
            "synced_trip",
            {"trip_id": "synced_trip", "plan": {"trip_name": "Legacy title updated"}},
            self.user_one,
            expected_version=2,
        )
        self.assertEqual(saved["version"], 3)
        self.assertEqual(saved["v2_revision"], 3)
        synced_document = store.get_trip_document_v2(self.user_one, "synced_trip")
        self.assertEqual(synced_document["revision"], 3)
        self.assertEqual(synced_document["title"], "Legacy title updated")

    def test_v2_only_trip_accepts_one_versionless_legacy_compatibility_write(self):
        document = store.upsert_trip_document_v2(
            self.user_one,
            "v2_only_trip",
            _trip_document("v2_only_trip", "V2 only"),
            0,
            "v2-only-create",
        )

        saved = asyncio.run(update_account_trip(
            "v2_only_trip",
            AccountTripRequest(trip={
                "trip_id": "v2_only_trip",
                "plan": {"trip_name": "Compatibility write"},
            }),
            user={"id": self.user_one},
        ))
        self.assertEqual(document["revision"], 1)
        self.assertEqual(saved["version"], 2)
        self.assertEqual(saved["v2_revision"], 2)

    def test_create_and_update_routes_share_the_legacy_version_contract(self):
        created = asyncio.run(create_account_trip(
            AccountTripRequest(trip={
                "trip_id": "endpoint_compat_trip",
                "plan": {"trip_name": "Created by POST"},
            }),
            user={"id": self.user_one},
        ))
        self.assertEqual(created["version"], 1)

        post_updated = asyncio.run(create_account_trip(
            AccountTripRequest(trip={
                "trip_id": "endpoint_compat_trip",
                "plan": {"trip_name": "Updated by POST"},
            }),
            user={"id": self.user_one},
        ))
        self.assertEqual(post_updated["version"], 2)

        put_updated = asyncio.run(update_account_trip(
            "endpoint_compat_trip",
            AccountTripRequest(
                trip={"plan": {"trip_name": "Updated by PUT"}},
                expected_version=post_updated["version"],
            ),
            user={"id": self.user_one},
        ))
        self.assertEqual(put_updated["version"], 3)

    def test_account_trip_endpoint_accepts_legacy_writes_and_enforces_explicit_versions(self):
        store.save_account_trip(
            "endpoint_versioned_trip",
            {
                "trip_id": "endpoint_versioned_trip",
                "plan": {"trip_name": "First version"},
            },
            self.user_one,
        )

        saved = asyncio.run(update_account_trip(
            "endpoint_versioned_trip",
            AccountTripRequest(
                trip={
                    "trip_id": "endpoint_versioned_trip",
                    "plan": {"trip_name": "Second version"},
                },
                expected_version=1,
            ),
            user={"id": self.user_one},
        ))
        self.assertEqual(saved["version"], 2)

        with self.assertRaises(HTTPException) as stale:
            asyncio.run(update_account_trip(
                "endpoint_versioned_trip",
                AccountTripRequest(
                    trip={
                        "trip_id": "endpoint_versioned_trip",
                        "plan": {"trip_name": "Stale overwrite"},
                    },
                    expected_version=1,
                ),
                user={"id": self.user_one},
            ))
        self.assertEqual(stale.exception.status_code, 409)
        self.assertEqual(stale.exception.detail["code"], "revision_conflict")

        legacy_saved = asyncio.run(update_account_trip(
            "endpoint_versioned_trip",
            AccountTripRequest(trip={
                "trip_id": "endpoint_versioned_trip",
                "plan": {"trip_name": "Legacy client update"},
            }),
            user={"id": self.user_one},
        ))
        self.assertEqual(legacy_saved["version"], 3)

    def test_versionless_compatibility_write_rejects_a_race_after_its_snapshot(self):
        store.save_account_trip(
            "legacy_race_trip",
            {
                "trip_id": "legacy_race_trip",
                "plan": {"trip_name": "First version"},
            },
            self.user_one,
        )
        original_save = store.save_account_trip
        raced = False

        def save_after_concurrent_write(*args, **kwargs):
            nonlocal raced
            if not raced:
                raced = True
                original_save(
                    "legacy_race_trip",
                    {
                        "trip_id": "legacy_race_trip",
                        "plan": {"trip_name": "Concurrent update"},
                    },
                    self.user_one,
                    expected_version=kwargs["expected_version"],
                )
            return original_save(*args, **kwargs)

        with patch("dashboard.server.save_account_trip", side_effect=save_after_concurrent_write):
            with self.assertRaises(HTTPException) as conflict:
                asyncio.run(update_account_trip(
                    "legacy_race_trip",
                    AccountTripRequest(trip={
                        "trip_id": "legacy_race_trip",
                        "plan": {"trip_name": "Versionless stale update"},
                    }),
                    user={"id": self.user_one},
                ))

        self.assertEqual(conflict.exception.status_code, 409)
        self.assertEqual(conflict.exception.detail["code"], "revision_conflict")
        current = store.get_trip("legacy_race_trip")
        self.assertEqual(current["version"], 2)
        self.assertEqual(current["plan"]["trip_name"], "Concurrent update")

    def test_v2_delete_removes_legacy_row_and_blocks_legacy_resurrection(self):
        store.save_account_trip(
            "legacy_deleted_trip",
            {
                "trip_id": "legacy_deleted_trip",
                "plan": {"trip_name": "Delete this route"},
            },
            self.user_one,
            source="mobile-route-builder",
        )
        projected = store.get_trip_document_v2(self.user_one, "legacy_deleted_trip")
        deleted_document = dict(projected)
        deleted_document["status"] = "deleted"
        deleted = store.upsert_trip_document_v2(
            self.user_one,
            "legacy_deleted_trip",
            deleted_document,
            projected["revision"],
            "delete-legacy-pair",
        )

        self.assertEqual(deleted["status"], "deleted")
        self.assertIsNone(store.get_trip("legacy_deleted_trip"))
        self.assertEqual(store.list_user_trips(self.user_one), [])
        self.assertEqual(
            store.get_trip_document_v2(
                self.user_one, "legacy_deleted_trip", include_deleted=True,
            )["revision"],
            deleted["revision"],
        )
        replay = store.upsert_trip_document_v2(
            self.user_one,
            "legacy_deleted_trip",
            deleted_document,
            projected["revision"],
            "delete-legacy-pair",
        )
        self.assertEqual(replay, deleted)
        self.assertIsNone(store.get_trip("legacy_deleted_trip"))
        with self.assertRaises(store.RevisionConflictError):
            store.save_account_trip(
                "legacy_deleted_trip",
                {
                    "trip_id": "legacy_deleted_trip",
                    "plan": {"trip_name": "Old client restore"},
                },
                self.user_one,
            )

        db = store._conn()
        db.execute(
            """INSERT INTO trips
               (id,user_id,created_at,updated_at,request,plan,source,version)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                "legacy_deleted_trip", self.user_one, 1, 1, "",
                json.dumps({
                    "trip_id": "legacy_deleted_trip",
                    "plan": {"trip_name": "Stale legacy copy"},
                }),
                "old-client", 1,
            ),
        )
        db.commit()
        db.close()
        store.init_db()
        self.assertIsNone(store.get_trip("legacy_deleted_trip"))

    def test_account_deletion_removes_library_trip_and_idempotency_records(self):
        store.upsert_saved_entity(
            self.user_one, "thp_delete", "place", "Delete me", {}, 0,
            idempotency_key="delete-library-create",
        )
        store.upsert_trip_document_v2(
            self.user_one,
            "trip_delete",
            _trip_document("trip_delete"),
            0,
            "delete-account-trip",
        )

        store.delete_user(self.user_one)

        db = store._conn()
        counts = {
            table: db.execute(
                f"SELECT COUNT(*) FROM {table} WHERE user_id=?", (self.user_one,)
            ).fetchone()[0]
            for table in (
                "saved_entities",
                "saved_entity_mutations",
                "trip_documents_v2",
                "trip_document_mutations",
            )
        }
        db.close()
        self.assertEqual(counts, {
            "saved_entities": 0,
            "saved_entity_mutations": 0,
            "trip_documents_v2": 0,
            "trip_document_mutations": 0,
        })

    def test_strict_validation_rejects_invalid_payloads(self):
        with self.assertRaises(ValueError):
            store.upsert_saved_entity(
                self.user_one, "bad id", "camp", "Invalid", {}, 0
            )
        with self.assertRaises(ValueError):
            store.upsert_saved_entity(
                self.user_one, "thp_bad_type", "unknown", "Invalid", {}, 0
            )
        with self.assertRaises(ValueError):
            store.upsert_trip_document_v2(
                self.user_one,
                "trip_bad",
                {**_trip_document("trip_bad"), "schema_version": 1},
                0,
                "invalid-schema",
            )

    def test_api_trip_model_preserves_catalog_and_route_context(self):
        payload = TripDocumentPayload.model_validate({
            "schema_version": 2,
            "trip_id": "trip_contract",
            "title": "Contract trip",
            "summary": "A connected trip from Explorer.",
            "regions": ["UT", "CO"],
            "starts_on": "2026-09-01",
            "ends_on": "2026-09-08",
            "route": {"geometry": [[-109.5, 38.5], [-108.5, 39.0]]},
        }).model_dump(mode="json")

        self.assertEqual(payload["summary"], "A connected trip from Explorer.")
        self.assertEqual(payload["regions"], ["UT", "CO"])
        self.assertEqual(payload["starts_on"], "2026-09-01")
        self.assertEqual(payload["ends_on"], "2026-09-08")
        self.assertEqual(len(payload["route"]["geometry"]), 2)

    def test_library_mutations_replay_without_revision_bump_and_reject_mismatch(self):
        first = store.upsert_saved_entity(
            self.user_one,
            "camp_retry",
            "camp",
            "Retry camp",
            {"surface": "gravel"},
            0,
            idempotency_key="library-create-key",
            mutation_kind="create",
        )
        replay = store.upsert_saved_entity(
            self.user_one,
            "camp_retry",
            "camp",
            "Retry camp",
            {"surface": "gravel"},
            0,
            idempotency_key="library-create-key",
            mutation_kind="create",
        )
        self.assertEqual(replay, first)
        self.assertEqual(replay["revision"], 1)
        with self.assertRaises(store.IdempotencyConflictError):
            store.upsert_saved_entity(
                self.user_one,
                "camp_retry",
                "camp",
                "Changed payload",
                {"surface": "paved"},
                0,
                idempotency_key="library-create-key",
                mutation_kind="update",
            )

        deleted = store.set_saved_entity_status(
            self.user_one,
            "camp_retry",
            "deleted",
            first["revision"],
            idempotency_key="library-delete-key",
            mutation_kind="delete",
        )
        delete_replay = store.set_saved_entity_status(
            self.user_one,
            "camp_retry",
            "deleted",
            first["revision"],
            idempotency_key="library-delete-key",
            mutation_kind="delete",
        )
        self.assertEqual(delete_replay, deleted)
        self.assertEqual(delete_replay["revision"], 2)

    def test_old_global_trip_primary_key_migrates_without_data_loss(self):
        existing = store.upsert_trip_document_v2(
            self.user_one,
            "trip_before_migration",
            _trip_document("trip_before_migration"),
            0,
            "before-migration",
        )
        db = store._conn()
        db.execute("ALTER TABLE trip_documents_v2 RENAME TO trip_documents_v2_scoped")
        db.execute(
            """CREATE TABLE trip_documents_v2 (
                   id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,status TEXT NOT NULL,
                   revision INTEGER NOT NULL,document_json TEXT NOT NULL,
                   created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
                   archived_at INTEGER,deleted_at INTEGER
               )"""
        )
        db.execute(
            """INSERT INTO trip_documents_v2
               SELECT id,user_id,status,revision,document_json,created_at,updated_at,archived_at,deleted_at
               FROM trip_documents_v2_scoped"""
        )
        db.execute("DROP TABLE trip_documents_v2_scoped")
        db.commit()
        db.close()

        store.init_db()
        db = store._conn()
        primary_key = [
            row["name"] for row in sorted(
                db.execute("PRAGMA table_info(trip_documents_v2)").fetchall(),
                key=lambda row: row["pk"],
            ) if row["pk"]
        ]
        db.close()
        self.assertEqual(primary_key, ["user_id", "id"])
        self.assertEqual(
            store.get_trip_document_v2(self.user_one, "trip_before_migration")["revision"],
            existing["revision"],
        )

    def test_legacy_anonymous_trip_cannot_be_claimed_and_v2_copy_is_isolated(self):
        store.save_trip("anonymous_trip", "public request", {"trip_name": "Public route"})
        with self.assertRaises(PermissionError):
            store.save_account_trip(
                "anonymous_trip",
                {"trip_id": "anonymous_trip", "trip_name": "Claimed route"},
                self.user_one,
            )

        private = store.upsert_trip_document_v2(
            self.user_one,
            "anonymous_trip",
            _trip_document("anonymous_trip", "Private account copy"),
            0,
            "copy-anonymous",
        )
        self.assertEqual(private["title"], "Private account copy")
        self.assertIsNone(store.get_trip("anonymous_trip")["user_id"])

        store.save_account_trip(
            "owned_legacy_trip",
            {"trip_id": "owned_legacy_trip", "trip_name": "Owned route"},
            self.user_one,
        )
        with self.assertRaises(PermissionError):
            store.save_trip(
                "owned_legacy_trip", "anonymous overwrite", {"trip_name": "Overwrite"}
            )
        with self.assertRaises(PermissionError):
            store.save_account_trip(
                "owned_legacy_trip",
                {"trip_id": "owned_legacy_trip", "trip_name": "Other overwrite"},
                self.user_two,
            )

    def test_push_token_registration_moves_device_and_logout_is_idempotent(self):
        token = "ExponentPushToken[test-device]"
        store.save_push_token(self.user_one, token)
        store.save_push_token(self.user_two, token)
        self.assertIsNone(store.get_push_token(self.user_one))
        self.assertEqual(store.get_push_token(self.user_two), token)
        self.assertFalse(store.clear_push_token(self.user_two, "stale-token"))
        self.assertEqual(store.get_push_token(self.user_two), token)
        self.assertTrue(store.clear_push_token(self.user_two, token))
        self.assertIsNone(store.get_push_token(self.user_two))
        store.clear_push_token(self.user_two)

    def test_product_feature_flags_default_off_with_admin_override(self):
        with patch.dict(os.environ, {
            "TRAILHEAD_SEARCH_V2_ENABLED": "0",
            "OFFLINE_BUNDLE_V2_ENABLED": "0",
            "TRAILHEAD_TRIP_GRAPH_V2_ENABLED": "0",
            "TRAILHEAD_TRIPS_TAB_ENABLED": "0",
            "TRAILHEAD_AVAILABILITY_MONITORS_ENABLED": "0",
            "TRAILHEAD_TRIP_PACKS_ENABLED": "0",
            "TRAILHEAD_ORIGINALS_ENABLED": "0",
            "TRAILHEAD_COMMUNITY_PUBLICATIONS_ENABLED": "0",
            "TRAILHEAD_COMMUNITY_RATINGS_ENABLED": "0",
            "TRAILHEAD_BRIEF_AND_BACKUP_ENABLED": "0",
            "TRAILHEAD_DIGEST_PREFERENCES_ENABLED": "0",
            "TRAILHEAD_PRIVATE_TRAIL_ROUTES_STAGE": "internal",
            "TRAILHEAD_COMMUNITY_TRAILS_STAGE": "off",
        }):
            anonymous = asyncio.run(product_features(None))
            regular = asyncio.run(product_features({"is_admin": 0}))
            admin = asyncio.run(product_features({"is_admin": 1}))

        self.assertFalse(any(anonymous.values()))
        self.assertEqual(regular, {
            "search_v2": False,
            "offline_bundle_v2": False,
            "trip_graph_v2": False,
            "trips_tab": False,
            "availability_monitors": False,
            "trip_packs": False,
            "originals": False,
            "community_publications": False,
            "community_ratings": False,
            "brief_and_backup": False,
            "digest_preferences": False,
            "private_trail_routes": False,
            "community_trails": False,
        })
        self.assertTrue(all(
            enabled for feature, enabled in admin.items()
            if feature != "community_trails"
        ))
        self.assertFalse(admin["community_trails"])


if __name__ == "__main__":
    unittest.main()
