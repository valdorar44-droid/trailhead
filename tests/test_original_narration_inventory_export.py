import importlib.util
import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "export_original_narration_inventory.py"
)
SPEC = importlib.util.spec_from_file_location("original_narration_inventory", SCRIPT_PATH)
assert SPEC and SPEC.loader
inventory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inventory)


SHA_A = "a" * 64
SHA_B = "b" * 64
TRANSCRIPT_A = hashlib.sha256(
    "Sensitive transcript that must never be exported.".encode("utf-8")
).hexdigest()


def _manifest(*, sha256: str = SHA_A) -> dict:
    return {
        "schema_version": 1,
        "assets": [{
            "id": "story_audio_1",
            "kind": "narration",
            "path": "/redacted/story_audio_1",
            "mime_type": "audio/mpeg",
            "bytes": 4096,
            "sha256": sha256,
        }],
        "stops": [{
            "id": "story_1",
            "sequence": 1,
            "transcript": "Sensitive transcript that must never be exported.",
            "audio_asset_id": "story_audio_1",
            "audio_duration_s": 61.25,
        }],
    }


def _create_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE authored_trip_packs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            content_kind TEXT NOT NULL,
            current_published_version INTEGER
        );
        CREATE TABLE authored_trip_pack_versions (
            pack_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            content_kind TEXT NOT NULL,
            original_manifest_json TEXT,
            PRIMARY KEY (pack_id, version)
        );
        CREATE TABLE authored_original_assets (
            pack_id TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            kind TEXT NOT NULL,
            byte_count INTEGER NOT NULL,
            storage_path TEXT NOT NULL,
            media_metadata_json TEXT NOT NULL,
            transcript_sha256 TEXT,
            generator_metadata_json TEXT NOT NULL,
            is_current INTEGER NOT NULL,
            uploaded_by INTEGER,
            PRIMARY KEY (pack_id, asset_id, sha256)
        );
        """
    )
    connection.execute(
        "INSERT INTO authored_trip_packs VALUES (?,?,?,?)",
        ("original_moab", "published", "original_drive", 1),
    )
    connection.execute(
        "INSERT INTO authored_trip_pack_versions VALUES (?,?,?,?)",
        ("original_moab", 1, "original_drive", json.dumps(_manifest())),
    )
    generator = {
        "provider": "cartesia",
        "model_id": "sonic-3.5-2026-05-04",
        "voice_id": "voice-katie",
        "output_format": "mp3_44100_128",
        "api_version": "2026-03-01",
        "license_status": "attested",
        "license_attestation": {
            "attested_by_admin_user_id": 99,
            "terms_url": "https://example.invalid/secret-admin-evidence",
        },
        "api_key": "never-export-this",
    }
    connection.executemany(
        """INSERT INTO authored_original_assets
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        [
            (
                "original_moab", "story_audio_1", SHA_A, "narration", 4096,
                "/data/private/current.mp3", json.dumps({"duration_s": 61.2}),
                TRANSCRIPT_A, json.dumps(generator), 0, 99,
            ),
            (
                "original_moab", "story_audio_1", SHA_B, "narration", 8192,
                "/data/private/new-current.mp3", json.dumps({"duration_s": 75.0}),
                "d" * 64,
                json.dumps({"provider": "elevenlabs", "api_token": "also-secret"}),
                1, 100,
            ),
        ],
    )
    connection.commit()
    connection.close()


class OriginalNarrationInventoryExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary_directory.name) / "trailhead.db"
        _create_database(self.database)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_database_is_uri_read_only_and_query_only(self):
        with inventory.open_read_only_database(self.database) as connection:
            self.assertEqual(connection.execute("PRAGMA query_only").fetchone()[0], 1)
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute(
                    "UPDATE authored_trip_packs SET status='draft' WHERE id='original_moab'"
                )

    def test_export_binds_manifest_sha_not_mutable_current_asset(self):
        with inventory.open_read_only_database(self.database) as connection:
            result = inventory.export_inventory(
                connection, "original_moab", 1, expect_narrations=1
            )

        self.assertEqual(result["pack_id"], "original_moab")
        self.assertEqual(result["version"], 1)
        self.assertEqual(len(result["narrations"]), 1)
        record = result["narrations"][0]
        self.assertEqual(set(record), {
            "api_version", "audio_sha256", "byte_size", "license_status",
            "model_id", "output_format", "probed_duration_s", "provider",
            "published_duration_s", "transcript_sha256", "voice_id",
        })
        self.assertEqual(record["audio_sha256"], SHA_A)
        self.assertEqual(record["provider"], "cartesia")
        self.assertEqual(record["model_id"], "sonic-3.5-2026-05-04")
        self.assertEqual(record["voice_id"], "voice-katie")
        self.assertEqual(record["output_format"], "mp3_44100_128")
        self.assertEqual(record["api_version"], "2026-03-01")
        self.assertEqual(record["published_duration_s"], 61.25)
        self.assertEqual(record["probed_duration_s"], 61.2)
        self.assertEqual(record["byte_size"], 4096)
        self.assertEqual(record["transcript_sha256"], TRANSCRIPT_A)
        self.assertEqual(record["license_status"], "attested")

    def test_cli_output_is_redacted_and_list_mode_is_metadata_only(self):
        output = StringIO()
        with redirect_stdout(output):
            exit_code = inventory.main([
                "--database", str(self.database), "--pack-id", "original_moab",
                "--version", "1", "--expect-narrations", "1",
            ])
        self.assertEqual(exit_code, 0)
        rendered = output.getvalue()
        json.loads(rendered)
        for forbidden in (
            "Sensitive transcript", "/data/private", "never-export-this", "also-secret",
            "attested_by_admin_user_id", "secret-admin-evidence",
        ):
            self.assertNotIn(forbidden, rendered)

        list_output = StringIO()
        with redirect_stdout(list_output):
            list_exit = inventory.main([
                "--database", str(self.database), "--list-published"
            ])
        self.assertEqual(list_exit, 0)
        self.assertEqual(json.loads(list_output.getvalue()), {
            "published_originals": [{
                "pack_id": "original_moab", "version": 1, "narration_count": 1,
            }]
        })

    def test_expected_count_and_metadata_mismatch_fail_closed(self):
        with inventory.open_read_only_database(self.database) as connection:
            with self.assertRaisesRegex(inventory.InventoryError, "Expected 11"):
                inventory.export_inventory(
                    connection, "original_moab", 1, expect_narrations=11
                )

        connection = sqlite3.connect(self.database)
        connection.execute(
            "UPDATE authored_original_assets SET byte_count=4097 WHERE sha256=?", (SHA_A,)
        )
        connection.commit()
        connection.close()
        with inventory.open_read_only_database(self.database) as read_only:
            with self.assertRaisesRegex(inventory.InventoryError, "byte size"):
                inventory.export_inventory(read_only, "original_moab", 1)

    def test_error_does_not_echo_sensitive_metadata(self):
        connection = sqlite3.connect(self.database)
        connection.execute(
            "DELETE FROM authored_original_assets WHERE sha256=?", (SHA_A,)
        )
        connection.commit()
        connection.close()

        output = StringIO()
        errors = StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            exit_code = inventory.main([
                "--database", str(self.database), "--pack-id", "original_moab",
                "--version", "1",
            ])
        self.assertEqual(exit_code, 1)
        self.assertEqual(output.getvalue(), "")
        self.assertNotIn("Sensitive transcript", errors.getvalue())
        self.assertNotIn("/data/private", errors.getvalue())

    def test_export_recomputes_and_binds_the_manifest_transcript_hash(self):
        connection = sqlite3.connect(self.database)
        connection.execute(
            "UPDATE authored_original_assets SET transcript_sha256=? WHERE sha256=?",
            ("e" * 64, SHA_A),
        )
        connection.commit()
        connection.close()
        with inventory.open_read_only_database(self.database) as read_only:
            with self.assertRaisesRegex(inventory.InventoryError, "transcript does not match"):
                inventory.export_inventory(read_only, "original_moab", 1)


if __name__ == "__main__":
    unittest.main()
