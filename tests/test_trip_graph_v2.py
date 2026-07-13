import asyncio
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from config.settings import settings
from dashboard.server import TripDocumentPayload, product_features
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
                self.user_one, limit=17, cursor=cursor
            )
            found_ids.extend(item["trip_id"] for item in page["items"])
            cursor = page["next_cursor"]
            if not cursor:
                break

        self.assertEqual(len(found_ids), 121)
        self.assertEqual(len(set(found_ids)), 121)

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
                self.user_one, include_archived=True
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

        self.assertEqual(
            store.list_trip_documents_v2(
                self.user_one, include_deleted=True, include_archived=True
            )["items"][0]["status"],
            "deleted",
        )

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
            "TRAILHEAD_TRIP_GRAPH_V2_ENABLED": "0",
            "TRAILHEAD_TRIPS_TAB_ENABLED": "0",
            "TRAILHEAD_AVAILABILITY_MONITORS_ENABLED": "0",
            "TRAILHEAD_TRIP_PACKS_ENABLED": "0",
            "TRAILHEAD_COMMUNITY_PUBLICATIONS_ENABLED": "0",
            "TRAILHEAD_DIGEST_PREFERENCES_ENABLED": "0",
        }):
            anonymous = asyncio.run(product_features(None))
            regular = asyncio.run(product_features({"is_admin": 0}))
            admin = asyncio.run(product_features({"is_admin": 1}))

        self.assertFalse(any(anonymous.values()))
        self.assertEqual(regular, {
            "trip_graph_v2": False,
            "trips_tab": False,
            "availability_monitors": False,
            "trip_packs": False,
            "community_publications": False,
            "digest_preferences": False,
        })
        self.assertTrue(all(admin.values()))


if __name__ == "__main__":
    unittest.main()
