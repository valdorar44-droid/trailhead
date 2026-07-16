import asyncio
import os
import sqlite3
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException
from fastapi.routing import APIRoute

from config.settings import settings
from dashboard.server import (
    ReportRequest,
    VALID_REPORT_TYPES,
    _current_user,
    app,
    confirm,
    downvote,
    submit_report,
    upvote,
)
from db import store


class ReportApiTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()
        self.reporter_id = store.create_user(
            "reporter@example.com", "field_reporter", "hash", "reporter-code"
        )
        self.voter_id = store.create_user(
            "voter@example.com", "field_voter", "hash", "voter-code"
        )
        self.other_voter_id = store.create_user(
            "other-voter@example.com", "other_voter", "hash", "other-voter-code"
        )

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    def _user(self, user_id: int) -> dict:
        user = store.get_user_by_id(user_id)
        self.assertIsNotNone(user)
        return user

    def _create_report(self, **overrides) -> dict:
        args = {
            "user_id": self.reporter_id,
            "lat": 50.4452,
            "lng": -104.6189,
            "type": "police",
            "subtype": "Patrol",
            "description": None,
            "severity": "moderate",
        }
        args.update(overrides)
        return store.create_report_idempotent(**args)

    def test_report_migration_adds_queue_metadata_and_unique_indexes(self):
        db = store._conn()
        columns = {row["name"] for row in db.execute("PRAGMA table_info(reports)")}
        report_indexes = {row["name"] for row in db.execute("PRAGMA index_list(reports)")}
        interaction_indexes = {
            row["name"] for row in db.execute("PRAGMA index_list(report_interactions)")
        }
        db.close()

        self.assertTrue(
            {"client_report_id", "observed_at", "source_surface", "accuracy_m"}
            <= columns
        )
        self.assertIn("idx_reports_user_client_report", report_indexes)
        self.assertIn("idx_report_interactions_user_vote", interaction_indexes)
        self.assertIn("idx_report_interactions_user_confirmation", interaction_indexes)

    def test_report_metadata_migrates_an_existing_reports_table(self):
        legacy = tempfile.NamedTemporaryFile(delete=False)
        legacy.close()
        try:
            db = sqlite3.connect(legacy.name)
            db.executescript(
                """CREATE TABLE reports (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       user_id INTEGER NOT NULL,
                       lat REAL NOT NULL,
                       lng REAL NOT NULL,
                       type TEXT NOT NULL,
                       subtype TEXT,
                       description TEXT,
                       severity TEXT DEFAULT 'moderate',
                       upvotes INTEGER NOT NULL DEFAULT 0,
                       created_at INTEGER NOT NULL,
                       expires_at INTEGER
                   );
                   INSERT INTO reports
                     (user_id,lat,lng,type,created_at,expires_at)
                     VALUES (1,50.4,-104.6,'police',100,200);"""
            )
            db.commit()
            db.close()

            settings.db_path = legacy.name
            store.init_db()
            migrated = store._conn()
            columns = {
                row["name"] for row in migrated.execute("PRAGMA table_info(reports)")
            }
            legacy_row = migrated.execute(
                "SELECT id,client_report_id,observed_at FROM reports WHERE id=1"
            ).fetchone()
            migrated.close()

            self.assertTrue(
                {"client_report_id", "observed_at", "source_surface", "accuracy_m"}
                <= columns
            )
            self.assertEqual(legacy_row["id"], 1)
            self.assertIsNone(legacy_row["client_report_id"])
            self.assertIsNone(legacy_row["observed_at"])
        finally:
            settings.db_path = self.db_path
            for suffix in ("", "-wal", "-shm"):
                try:
                    os.unlink(legacy.name + suffix)
                except FileNotFoundError:
                    pass

    def test_client_report_id_is_account_scoped_and_expiry_uses_observed_at(self):
        observed_at = int(time.time()) - 600
        first = self._create_report(
            client_report_id="auto:trip-42:report-1",
            observed_at=observed_at,
            source_surface="android_auto",
            accuracy_m=8.5,
        )
        replay = self._create_report(
            client_report_id="auto:trip-42:report-1",
            observed_at=observed_at,
            source_surface="android_auto",
            accuracy_m=8.5,
        )
        other_account = store.create_report_idempotent(
            self.voter_id,
            50.4452,
            -104.6189,
            "police",
            "Patrol",
            None,
            "moderate",
            client_report_id="auto:trip-42:report-1",
            observed_at=observed_at,
        )

        self.assertTrue(first["created"])
        self.assertFalse(replay["created"])
        self.assertEqual(replay["report_id"], first["report_id"])
        self.assertTrue(other_account["created"])
        self.assertNotEqual(other_account["report_id"], first["report_id"])
        self.assertEqual(first["expires_at"], observed_at + store.EXPIRY_BY_TYPE["police"])

        db = store._conn()
        row = db.execute(
            """SELECT COUNT(*) AS count,observed_at,source_surface,accuracy_m
               FROM reports WHERE user_id=? AND client_report_id=?""",
            (self.reporter_id, "auto:trip-42:report-1"),
        ).fetchone()
        db.close()
        self.assertEqual(row["count"], 1)
        self.assertEqual(row["observed_at"], observed_at)
        self.assertEqual(row["source_surface"], "android_auto")
        self.assertEqual(row["accuracy_m"], 8.5)

    def test_duplicate_retry_returns_before_daily_quota(self):
        observed_at = int(time.time()) - 60
        accepted = self._create_report(
            client_report_id="auto-retry-1", observed_at=observed_at
        )
        for index in range(8):
            self._create_report(
                type="hazard",
                subtype=f"Hazard {index}",
                client_report_id=None,
                observed_at=observed_at,
            )

        result = asyncio.run(
            submit_report(
                ReportRequest(
                    lat=50.4452,
                    lng=-104.6189,
                    type="police",
                    subtype="Patrol",
                    client_report_id="auto-retry-1",
                    observed_at=observed_at,
                    source_surface="android_auto",
                    accuracy_m=6.0,
                ),
                user=self._user(self.reporter_id),
            )
        )

        self.assertTrue(result["duplicate"])
        self.assertEqual(result["report_id"], accepted["report_id"])
        self.assertEqual(result["credits_earned"], 0)
        self.assertEqual(store.get_user_report_count_today(self.reporter_id), 9)

    def test_stale_police_and_other_reports_are_rejected(self):
        now = int(time.time())
        cases = [
            ("police", now - store.EXPIRY_BY_TYPE["police"], "Police report"),
            ("hazard", now - store.REPORT_MAX_QUEUE_AGE, "Report is too old"),
        ]
        for report_type, observed_at, detail in cases:
            with self.subTest(report_type=report_type):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(
                        submit_report(
                            ReportRequest(
                                lat=50.4,
                                lng=-104.6,
                                type=report_type,
                                client_report_id=f"stale-{report_type}",
                                observed_at=observed_at,
                            ),
                            user=self._user(self.reporter_id),
                        )
                    )
                self.assertEqual(raised.exception.status_code, 400)
                self.assertIn(detail, raised.exception.detail)

    def test_legacy_submission_remains_supported_and_police_is_canonical(self):
        before = int(time.time())
        result = asyncio.run(
            submit_report(
                ReportRequest(lat=50.4, lng=-104.6, type="police"),
                user=self._user(self.reporter_id),
            )
        )

        self.assertIn("police", VALID_REPORT_TYPES)
        self.assertFalse(result["duplicate"])
        self.assertGreaterEqual(result["observed_at"], before)
        self.assertEqual(
            result["expires_at"] - result["observed_at"],
            store.EXPIRY_BY_TYPE["police"],
        )

        legacy_store_id = store.create_report(
            self.reporter_id,
            50.5,
            -104.7,
            "hazard",
            "Debris",
            None,
            "moderate",
        )
        self.assertIsInstance(legacy_store_id, int)

    def test_votes_are_unique_directional_and_disallow_self_voting(self):
        report = self._create_report(observed_at=int(time.time()))

        self.assertEqual(
            store.upvote_report(report["report_id"], self.reporter_id)["reason"],
            "own_report",
        )
        self.assertTrue(store.upvote_report(report["report_id"], self.voter_id)["ok"])
        self.assertEqual(
            store.upvote_report(report["report_id"], self.voter_id)["reason"],
            "already_voted",
        )
        self.assertEqual(
            store.downvote_report(report["report_id"], self.voter_id)["reason"],
            "already_voted",
        )
        self.assertTrue(
            store.downvote_report(report["report_id"], self.other_voter_id)["ok"]
        )
        self.assertEqual(
            store.downvote_report(report["report_id"], self.other_voter_id)["reason"],
            "already_voted",
        )

        db = store._conn()
        row = db.execute(
            "SELECT upvotes,downvotes FROM reports WHERE id=?", (report["report_id"],)
        ).fetchone()
        votes = db.execute(
            """SELECT user_id,action FROM report_interactions
               WHERE report_id=? AND action IN ('upvote','downvote')
               ORDER BY user_id""",
            (report["report_id"],),
        ).fetchall()
        db.close()
        self.assertEqual(dict(row), {"upvotes": 1, "downvotes": 1})
        self.assertEqual(len(votes), 2)
        self.assertEqual(store.get_user_by_id(self.reporter_id)["credits"], 2)

    def test_vote_routes_require_current_user(self):
        vote_routes = {
            route.path: route
            for route in app.routes
            if isinstance(route, APIRoute)
            and route.path in {
                "/api/reports/{report_id}/upvote",
                "/api/reports/{report_id}/downvote",
            }
        }
        self.assertEqual(len(vote_routes), 2)
        for route in vote_routes.values():
            self.assertTrue(
                any(dependency.call is _current_user for dependency in route.dependant.dependencies)
            )

    def test_vote_endpoint_surfaces_self_and_duplicate_errors(self):
        report = self._create_report(observed_at=int(time.time()))
        with self.assertRaises(HTTPException) as own_vote:
            asyncio.run(upvote(report["report_id"], user=self._user(self.reporter_id)))
        self.assertEqual(own_vote.exception.status_code, 400)

        asyncio.run(upvote(report["report_id"], user=self._user(self.voter_id)))
        with self.assertRaises(HTTPException) as duplicate_vote:
            asyncio.run(downvote(report["report_id"], user=self._user(self.voter_id)))
        self.assertEqual(duplicate_vote.exception.status_code, 400)

    def test_expired_reports_reject_votes_and_confirmations_without_mutation(self):
        report = self._create_report(observed_at=int(time.time()))
        report_id = report["report_id"]
        db = store._conn()
        db.execute("UPDATE reports SET expires_at=? WHERE id=?", (int(time.time()), report_id))
        db.commit()
        db.close()

        self.assertEqual(store.upvote_report(report_id, self.voter_id)["reason"], "expired")
        self.assertEqual(store.downvote_report(report_id, self.voter_id)["reason"], "expired")
        self.assertEqual(store.confirm_report(report_id, self.voter_id)["reason"], "expired")

        for endpoint in (upvote, downvote, confirm):
            with self.subTest(endpoint=endpoint.__name__):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(endpoint(report_id, user=self._user(self.voter_id)))
                self.assertEqual(raised.exception.status_code, 410)

        db = store._conn()
        counters = db.execute(
            "SELECT upvotes,downvotes,confirmations FROM reports WHERE id=?", (report_id,)
        ).fetchone()
        interactions = db.execute(
            "SELECT COUNT(*) AS count FROM report_interactions WHERE report_id=?",
            (report_id,),
        ).fetchone()["count"]
        transactions = db.execute(
            "SELECT COUNT(*) AS count FROM credit_transactions WHERE user_id=?",
            (self.voter_id,),
        ).fetchone()["count"]
        db.close()

        self.assertEqual(dict(counters), {"upvotes": 0, "downvotes": 0, "confirmations": 0})
        self.assertEqual(interactions, 0)
        self.assertEqual(transactions, 0)
        self.assertEqual(store.get_user_by_id(self.voter_id)["credits"], 0)

    def test_concurrent_confirmations_are_credited_once(self):
        report = self._create_report(observed_at=int(time.time()))
        report_id = report["report_id"]

        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(
                executor.map(
                    lambda _index: store.confirm_report(report_id, self.voter_id),
                    range(12),
                )
            )

        self.assertEqual(sum(result.get("ok") is True for result in results), 1)
        self.assertEqual(
            sum(result.get("reason") == "already_confirmed" for result in results),
            11,
        )

        db = store._conn()
        report_row = db.execute(
            "SELECT confirmations FROM reports WHERE id=?", (report_id,)
        ).fetchone()
        confirmation_count = db.execute(
            """SELECT COUNT(*) AS count FROM report_interactions
               WHERE report_id=? AND user_id=? AND action='confirm'""",
            (report_id, self.voter_id),
        ).fetchone()["count"]
        credit_count = db.execute(
            """SELECT COUNT(*) AS count FROM credit_transactions
               WHERE user_id=? AND reason=?""",
            (self.voter_id, f"Confirmed report #{report_id} still active"),
        ).fetchone()["count"]
        db.close()

        self.assertEqual(report_row["confirmations"], 1)
        self.assertEqual(confirmation_count, 1)
        self.assertEqual(credit_count, 1)
        self.assertEqual(store.get_user_by_id(self.voter_id)["credits"], 1)


if __name__ == "__main__":
    unittest.main()
