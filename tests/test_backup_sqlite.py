import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.backup_sqlite import create_backup


class BackupSqliteTests(unittest.TestCase):
    def test_backup_is_consistent_verified_and_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "trailhead.db"
            output = root / "backups"
            db = sqlite3.connect(source)
            db.execute("CREATE TABLE trips (id TEXT PRIMARY KEY, title TEXT NOT NULL)")
            db.execute("INSERT INTO trips VALUES ('trip-1', 'Desert week')")
            db.commit()
            db.close()

            first = create_backup(source, output, keep=1)
            second = create_backup(source, output, keep=1)

            backups = list(output.glob("trailhead-*.sqlite3"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(second["integrity_check"], "ok")
            self.assertEqual(second["table_count"], 1)
            self.assertEqual(len(second["sha256"]), 64)
            self.assertNotEqual(first["backup"], second["backup"])
            self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
            self.assertEqual(backups[0].with_suffix(".json").stat().st_mode & 0o777, 0o600)
            restored = sqlite3.connect(backups[0])
            row = restored.execute("SELECT title FROM trips WHERE id='trip-1'").fetchone()
            restored.close()
            self.assertEqual(row[0], "Desert week")

    def test_backup_rejects_database_without_application_tables(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "trailhead.db"
            sqlite3.connect(source).close()

            with self.assertRaisesRegex(RuntimeError, "no application tables"):
                create_backup(source, root / "backups")
            self.assertEqual(list((root / "backups").glob("trailhead-*.sqlite3")), [])


if __name__ == "__main__":
    unittest.main()
