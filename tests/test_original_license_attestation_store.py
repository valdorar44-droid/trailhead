import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
import wave

from config.settings import settings
from db import store


class OriginalLicenseAttestationStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_db_path = settings.db_path
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)
        settings.db_path = str(self.root / "trailhead.db")
        store._ORIGINAL_ASSET_INTEGRITY_CACHE.clear()
        store.init_db()

        store.ensure_admin_user(
            "license-admin@example.invalid",
            "license_admin",
            "not-a-login-credential",
        )
        store.ensure_admin_user(
            "license-admin-two@example.invalid",
            "license_admin_two",
            "not-a-login-credential",
        )
        self.admin = store.get_user_by_email("license-admin@example.invalid")["id"]
        self.other_admin = store.get_user_by_email(
            "license-admin-two@example.invalid"
        )["id"]
        self.user = store.create_user(
            "license-user@example.invalid",
            "license_user",
            "not-a-login-credential",
            "license-user-referral",
        )

        self.pack_id = "original_license_contract"
        self.asset_id = "narration_story_01"
        now = int(time.time())
        db = store._conn()
        db.execute(
            """INSERT INTO authored_trip_packs
               (id,content_kind,slug,status,draft_title,draft_summary,
                draft_price_credits,draft_coverage_region,draft_public_metadata,
                draft_validation_metadata,draft_template_json,
                draft_original_manifest_json,draft_revision,created_by,updated_by,
                created_at,updated_at)
               VALUES (?,'original_drive',?,'draft',?,?,0,'north_america',
                       '{}','{}','{}','{}',1,?,?,?,?)""",
            (
                self.pack_id,
                self.pack_id,
                "License contract test",
                "Private test draft",
                self.admin,
                self.admin,
                now,
                now,
            ),
        )
        db.commit()
        db.close()

        self.audio_path = self.root / "narration.wav"
        with wave.open(str(self.audio_path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(1)
            audio.setframerate(8_000)
            audio.writeframes(b"\x80" * 8_000)
        self.sha256 = hashlib.sha256(self.audio_path.read_bytes()).hexdigest()
        self.transcript_sha256 = hashlib.sha256(
            b"Reviewed narration transcript"
        ).hexdigest()
        self.generator = {
            "provider": "elevenlabs",
            "model_id": "eleven_multilingual_v2",
            "voice_id": "test-voice",
            "output_format": "mp3_44100_128",
            "provider_native_master": True,
            "lossless_master_claimed": False,
            "transcoded": False,
            "license_status": "unverified",
        }
        store.save_authored_original_asset_record(
            self.pack_id,
            self.asset_id,
            "narration",
            "audio/wav",
            str(self.audio_path),
            self.audio_path.stat().st_size,
            self.sha256,
            self.admin,
            transcript_sha256=self.transcript_sha256,
            generator_metadata=self.generator,
        )

    def tearDown(self) -> None:
        store._ORIGINAL_ASSET_INTEGRITY_CACHE.clear()
        settings.db_path = self._old_db_path
        self._temp.cleanup()

    def _row(self) -> dict:
        db = store._conn()
        row = db.execute(
            """SELECT generator_metadata_json,updated_at
               FROM authored_original_assets
               WHERE pack_id=? AND asset_id=? AND sha256=?""",
            (self.pack_id, self.asset_id, self.sha256),
        ).fetchone()
        db.close()
        return {
            "generator_metadata": json.loads(row["generator_metadata_json"]),
            "updated_at": int(row["updated_at"]),
        }

    def _attest(self, **overrides) -> dict:
        arguments = {
            "expected_sha256": self.sha256,
            "expected_draft_revision": 1,
            "terms_id": "elevenlabs_commercial_terms",
            "terms_url": "https://elevenlabs.io/terms-of-use",
            "terms_version": "2026-07-01",
            "reviewed_at": "2026-08-10",
            "admin_user_id": self.admin,
        }
        arguments.update(overrides)
        return store.attest_authored_original_generator_license(
            self.pack_id,
            self.asset_id,
            **arguments,
        )

    def test_exact_replay_preserves_server_evidence_and_updated_at(self) -> None:
        first = self._attest()
        self.assertFalse(first["replayed"])
        self.assertEqual(first["sha256"], self.sha256)
        self.assertEqual(first["draft_revision"], 1)
        original_attestation = first["license_attestation"]

        db = store._conn()
        db.execute(
            """UPDATE authored_original_assets SET updated_at=123456789
               WHERE pack_id=? AND asset_id=? AND sha256=?""",
            (self.pack_id, self.asset_id, self.sha256),
        )
        db.commit()
        db.close()

        replay = self._attest(admin_user_id=self.other_admin)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["license_attestation"], original_attestation)
        self.assertEqual(
            replay["license_attestation"]["attested_by_admin_user_id"],
            self.admin,
        )
        self.assertEqual(self._row()["updated_at"], 123456789)

        store.init_db()
        after_init = self._row()
        self.assertEqual(
            after_init["generator_metadata"]["license_attestation"],
            original_attestation,
        )

    def test_stale_sha_revision_and_non_admin_leave_metadata_unchanged(self) -> None:
        before = self._row()
        with self.assertRaises(store.OriginalAssetSha256ConflictError) as stale_sha:
            self._attest(expected_sha256="f" * 64)
        self.assertEqual(stale_sha.exception.expected_sha256, "f" * 64)
        self.assertEqual(stale_sha.exception.current_sha256, self.sha256)
        self.assertEqual(self._row(), before)

        with self.assertRaises(store.RevisionConflictError) as stale_revision:
            self._attest(expected_draft_revision=2)
        self.assertEqual(stale_revision.exception.current_revision, 1)
        self.assertEqual(self._row(), before)

        with self.assertRaises(PermissionError):
            self._attest(admin_user_id=self.user)
        self.assertEqual(self._row(), before)

    def test_force_rehash_rejects_changed_file_without_writing(self) -> None:
        before = self._row()
        corrupted = bytearray(self.audio_path.read_bytes())
        corrupted[-1] ^= 0x01
        self.audio_path.write_bytes(corrupted)
        with self.assertRaisesRegex(ValueError, "integrity verification"):
            self._attest()
        self.assertEqual(self._row(), before)

    def test_replaced_current_asset_cannot_receive_stale_attestation(self) -> None:
        historical_attestation = self._attest()["license_attestation"]
        replacement_path = self.root / "replacement.wav"
        with wave.open(str(replacement_path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(1)
            audio.setframerate(8_000)
            audio.writeframes(b"\x81" * 8_000)
        replacement_sha256 = hashlib.sha256(replacement_path.read_bytes()).hexdigest()
        store.save_authored_original_asset_record(
            self.pack_id,
            self.asset_id,
            "narration",
            "audio/wav",
            str(replacement_path),
            replacement_path.stat().st_size,
            replacement_sha256,
            self.admin,
            transcript_sha256=self.transcript_sha256,
            generator_metadata=self.generator,
        )

        with self.assertRaises(store.OriginalAssetSha256ConflictError) as conflict:
            self._attest(expected_sha256=self.sha256)
        self.assertEqual(conflict.exception.current_sha256, replacement_sha256)

        db = store._conn()
        rows = db.execute(
            """SELECT sha256,is_current,generator_metadata_json
               FROM authored_original_assets WHERE pack_id=? AND asset_id=?
               ORDER BY sha256""",
            (self.pack_id, self.asset_id),
        ).fetchall()
        db.close()
        by_sha = {row["sha256"]: row for row in rows}
        historical = json.loads(by_sha[self.sha256]["generator_metadata_json"])
        replacement = json.loads(by_sha[replacement_sha256]["generator_metadata_json"])
        self.assertFalse(bool(by_sha[self.sha256]["is_current"]))
        self.assertTrue(bool(by_sha[replacement_sha256]["is_current"]))
        self.assertEqual(historical["license_attestation"], historical_attestation)
        self.assertEqual(replacement["license_status"], "unverified")
        self.assertNotIn("license_attestation", replacement)

    def test_different_or_incomplete_existing_attestation_conflicts(self) -> None:
        first = self._attest()
        with self.assertRaises(store.OriginalLicenseAttestationConflictError):
            self._attest(terms_version="2026-08-01")
        self.assertEqual(
            self._row()["generator_metadata"]["license_attestation"],
            first["license_attestation"],
        )

        incomplete = dict(self.generator)
        incomplete["license_status"] = "attested"
        incomplete["license_attestation"] = {"terms_id": "incomplete"}
        db = store._conn()
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?
               WHERE pack_id=? AND asset_id=? AND sha256=?""",
            (
                json.dumps(incomplete, separators=(",", ":"), sort_keys=True),
                self.pack_id,
                self.asset_id,
                self.sha256,
            ),
        )
        db.commit()
        db.close()
        before = self._row()
        with self.assertRaises(store.OriginalLicenseAttestationConflictError):
            self._attest()
        self.assertEqual(self._row(), before)

    def test_calendar_date_and_elevenlabs_terms_host_are_fail_closed(self) -> None:
        before = self._row()
        with self.assertRaisesRegex(ValueError, "YYYY-MM-DD"):
            self._attest(reviewed_at="2026-08-10T00:00:00Z")
        with self.assertRaisesRegex(ValueError, "approved HTTPS URL"):
            self._attest(terms_url="https://example.com/terms")
        with self.assertRaisesRegex(ValueError, "accepted review window"):
            self._attest(reviewed_at="2999-01-01")
        self.assertEqual(self._row(), before)

    def test_terms_url_is_bound_to_a_supported_generator_provider(self) -> None:
        cartesia = dict(self.generator)
        cartesia["provider"] = "cartesia"
        db = store._conn()
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?
               WHERE pack_id=? AND asset_id=? AND sha256=?""",
            (
                json.dumps(cartesia, separators=(",", ":"), sort_keys=True),
                self.pack_id,
                self.asset_id,
                self.sha256,
            ),
        )
        db.commit()
        db.close()
        result = self._attest(terms_url="https://www.cartesia.ai/legal/terms")
        self.assertFalse(result["replayed"])

        unsupported = dict(self.generator)
        unsupported["provider"] = "other-provider"
        db = store._conn()
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?
               WHERE pack_id=? AND asset_id=? AND sha256=?""",
            (
                json.dumps(unsupported, separators=(",", ":"), sort_keys=True),
                self.pack_id,
                self.asset_id,
                self.sha256,
            ),
        )
        db.commit()
        db.close()
        before = self._row()
        with self.assertRaisesRegex(ValueError, "provider is unsupported"):
            self._attest(terms_url="https://example.com/provider-terms")
        self.assertEqual(self._row(), before)

    def test_same_byte_resave_preserves_complete_server_attestation(self) -> None:
        attested = self._attest()["license_attestation"]
        store.save_authored_original_asset_record(
            self.pack_id,
            self.asset_id,
            "narration",
            "audio/wav",
            str(self.audio_path),
            self.audio_path.stat().st_size,
            self.sha256,
            self.other_admin,
            transcript_sha256=self.transcript_sha256,
            generator_metadata=self.generator,
        )
        metadata = self._row()["generator_metadata"]
        self.assertEqual(metadata["license_status"], "attested")
        self.assertEqual(metadata["license_attestation"], attested)

        changed = dict(self.generator)
        changed["voice_id"] = "different-voice"
        with self.assertRaisesRegex(ValueError, "metadata is immutable"):
            store.save_authored_original_asset_record(
                self.pack_id,
                self.asset_id,
                "narration",
                "audio/wav",
                str(self.audio_path),
                self.audio_path.stat().st_size,
                self.sha256,
                self.other_admin,
                transcript_sha256=self.transcript_sha256,
                generator_metadata=changed,
            )

    def test_asset_save_cannot_create_caller_authored_attestation(self) -> None:
        forged = dict(self.generator)
        forged["license_status"] = "attested"
        forged["license_attestation"] = {
            "terms_id": "caller_terms",
            "terms_url": "https://elevenlabs.io/terms-of-use",
            "terms_version": "caller-v1",
            "reviewed_at": "2026-08-10",
            "attested_at": "2026-08-10T00:00:00Z",
            "attested_by_admin_user_id": self.admin,
        }
        second_asset = self.root / "caller-authored.wav"
        second_asset.write_bytes(self.audio_path.read_bytes())
        with self.assertRaisesRegex(ValueError, "server attestation flow"):
            store.save_authored_original_asset_record(
                self.pack_id,
                "narration_story_02",
                "narration",
                "audio/wav",
                str(second_asset),
                second_asset.stat().st_size,
                hashlib.sha256(second_asset.read_bytes()).hexdigest(),
                self.admin,
                transcript_sha256=self.transcript_sha256,
                generator_metadata=forged,
            )


if __name__ == "__main__":
    unittest.main()
