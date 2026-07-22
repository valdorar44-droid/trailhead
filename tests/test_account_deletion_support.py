import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from config.settings import settings
from db import store


class AccountDeletionSupportTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()

        self.user = store.create_user(
            "delete-support@example.com", "delete_support", "hash", "delete-support-code"
        )
        self.other = store.create_user(
            "keep-support@example.com", "keep_support", "hash", "keep-support-code"
        )
        self.admin = store.create_user(
            "support-admin@example.com", "support_admin", "hash", "support-admin-code"
        )
        store.set_user_admin(self.admin, True)

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    def _support_thread(self, user_id: int, subject: str) -> int:
        thread_id = store.create_support_thread(
            user_id,
            subject,
            initial_body=f"Private opening message for {subject}",
        )
        store.add_support_message(
            thread_id,
            "admin",
            f"Support response for {subject}",
            admin_id=self.admin,
        )
        return thread_id

    def _use_legacy_support_schema(self) -> None:
        """Match deployed support tables created before cascade rules existed."""
        db = store._conn()
        db.execute("PRAGMA foreign_keys=OFF")
        db.executescript(
            """
            DROP TABLE support_messages;
            DROP TABLE support_threads;
            CREATE TABLE support_threads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                category TEXT NOT NULL DEFAULT 'support',
                subject TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                opened_by TEXT NOT NULL DEFAULT 'user',
                created_by_admin INTEGER REFERENCES users(id),
                last_message_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE support_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id INTEGER NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
                sender_role TEXT NOT NULL,
                sender_user_id INTEGER REFERENCES users(id),
                sender_admin_id INTEGER REFERENCES users(id),
                body TEXT NOT NULL,
                meta_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                read_by_user_at INTEGER,
                read_by_admin_at INTEGER
            );
            """
        )
        db.commit()
        db.close()

    def _assert_no_foreign_key_orphans(self) -> None:
        db = store._conn()
        violations = db.execute("PRAGMA foreign_key_check").fetchall()
        db.close()
        self.assertEqual(violations, [])

    def test_fk_on_deletion_removes_owned_support_data_only(self):
        self._use_legacy_support_schema()
        deleted_thread = self._support_thread(self.user, "delete me")
        retained_thread = self._support_thread(self.other, "keep me")

        # Defensive privacy case: even malformed cross-thread authorship must not
        # retain the deleted user's support message body.
        cross_message = store.add_support_message(
            retained_thread,
            "user",
            "Private message attached to the wrong thread",
            user_id=self.user,
        )

        store.delete_user(self.user)

        db = store._conn()
        self.assertIsNone(db.execute("SELECT id FROM users WHERE id=?", (self.user,)).fetchone())
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM support_threads WHERE id=?", (deleted_thread,)).fetchone()[0],
            0,
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM support_messages WHERE thread_id=?", (deleted_thread,)).fetchone()[0],
            0,
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM support_threads WHERE id=?", (retained_thread,)).fetchone()[0],
            1,
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM support_messages WHERE id=?", (cross_message["id"],)).fetchone()[0],
            0,
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM support_messages WHERE thread_id=?", (retained_thread,)).fetchone()[0],
            2,
        )
        db.close()
        self._assert_no_foreign_key_orphans()

    def test_locked_database_fallback_also_removes_support_children(self):
        deleted_thread = self._support_thread(self.user, "fallback delete")
        retained_thread = self._support_thread(self.other, "fallback keep")

        with patch.object(
            store,
            "_delete_user_full",
            side_effect=sqlite3.OperationalError("database is locked"),
        ) as full_delete, patch.object(store.time, "sleep") as sleep:
            store.delete_user(self.user)

        self.assertEqual(full_delete.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        db = store._conn()
        self.assertIsNone(db.execute("SELECT id FROM users WHERE id=?", (self.user,)).fetchone())
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM support_threads WHERE id=?", (deleted_thread,)).fetchone()[0],
            0,
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM support_messages WHERE thread_id=?", (deleted_thread,)).fetchone()[0],
            0,
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM support_threads WHERE id=?", (retained_thread,)).fetchone()[0],
            1,
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM support_messages WHERE thread_id=?", (retained_thread,)).fetchone()[0],
            2,
        )
        db.close()
        self._assert_no_foreign_key_orphans()

    def test_baseline_user_without_support_data_still_deletes(self):
        store.delete_user(self.user)
        self.assertIsNone(store.get_user_by_id(self.user))
        self._assert_no_foreign_key_orphans()

    def test_unrelated_operational_error_is_not_hidden_by_fallback(self):
        with patch.object(
            store,
            "_delete_user_full",
            side_effect=sqlite3.OperationalError("disk I/O error"),
        ):
            with self.assertRaisesRegex(sqlite3.OperationalError, "disk I/O error"):
                store.delete_user(self.user)

        self.assertIsNotNone(store.get_user_by_id(self.user))


if __name__ == "__main__":
    unittest.main()
