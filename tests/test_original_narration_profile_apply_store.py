import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import time
import unittest
import zlib

from config.settings import settings
from db import store
from db.original_manifest_v3 import original_manifest_v3_delivery_contract_sha256


class OriginalNarrationProfileApplyStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_db_path = settings.db_path
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)
        settings.db_path = str(self.root / "trailhead.db")
        store._ORIGINAL_ASSET_INTEGRITY_CACHE.clear()
        store.init_db()

        store.ensure_admin_user(
            "profile-admin@example.invalid",
            "profile_admin",
            "not-a-login-credential",
        )
        store.ensure_admin_user(
            "profile-admin-two@example.invalid",
            "profile_admin_two",
            "not-a-login-credential",
        )
        self.admin = store.get_user_by_email("profile-admin@example.invalid")["id"]
        self.other_admin = store.get_user_by_email(
            "profile-admin-two@example.invalid"
        )["id"]
        self.user = store.create_user(
            "profile-user@example.invalid",
            "profile_user",
            "not-a-login-credential",
            "profile-user-referral",
        )

        fixture = (
            Path(__file__).resolve().parents[1]
            / "originals"
            / "smokies"
            / "roaring_fork_private_manifest_v3.json"
        )
        self.manifest = json.loads(fixture.read_text(encoding="utf-8"))
        self.pack_id = "great_smoky_mountains_ridges_rivers_living_memory"
        self.title = self.manifest["title"]
        stories_by_audio = {
            story["audio_asset_id"]: story for story in self.manifest["stories"]
        }
        narration_assets = sorted(
            (
                asset
                for asset in self.manifest["assets"]
                if asset["kind"] == "narration"
            ),
            key=lambda asset: asset["id"],
        )
        self.expected_sha256 = {}
        self.expected_asset_sha256 = {}
        self.audio_paths = {}
        for index, asset in enumerate(narration_assets, start=1):
            data = self._mp3_bytes(index)
            path = self.root / f"{asset['id']}.mp3"
            path.write_bytes(data)
            sha256 = hashlib.sha256(data).hexdigest()
            self.expected_sha256[asset["id"]] = sha256
            self.expected_asset_sha256[asset["id"]] = sha256
            self.audio_paths[asset["id"]] = path
            asset.update({
                "bytes": len(data),
                "mime_type": "audio/mpeg",
                "path": f"/api/original-assets/{self.pack_id}/{asset['id']}/{sha256}",
                "sha256": sha256,
            })
            stories_by_audio[asset["id"]]["audio_duration_s"] = 1.045

        image_assets = sorted(
            (
                asset for asset in self.manifest["assets"]
                if asset["kind"] == "image"
            ),
            key=lambda asset: asset["id"],
        )
        self.image_paths = {}
        for index, asset in enumerate(image_assets, start=1):
            data = self._png_bytes(index)
            path = self.root / f"{asset['id']}.png"
            path.write_bytes(data)
            sha256 = hashlib.sha256(data).hexdigest()
            self.expected_asset_sha256[asset["id"]] = sha256
            self.image_paths[asset["id"]] = path
            asset.update({
                "bytes": len(data),
                "mime_type": "image/png",
                "path": f"/api/original-assets/{self.pack_id}/{asset['id']}/{sha256}",
                "sha256": sha256,
            })

        for chapter in self.manifest["chapters"]:
            for variant in chapter["variants"]:
                variant["delivery_contract_sha256"] = (
                    original_manifest_v3_delivery_contract_sha256(
                        self.manifest,
                        chapter_id=chapter["id"],
                        variant_id=variant["id"],
                    )
                )

        self.normalized_base, base_json = store._normalize_original_manifest(
            self.pack_id,
            self.title,
            self.manifest,
            publishing=False,
        )
        self.base_hash = store._original_validation_hash(self.normalized_base)
        self.original_validation_metadata = {
            "existing_gate": "preserve-me",
            "admin_license_attestation_complete": False,
            "verified_private_upload_complete": False,
        }
        self.validation_metadata_hash = store._original_validation_hash(
            self.original_validation_metadata
        )
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
                       '{}',?,'{}',?,1,?,?,?,?)""",
            (
                self.pack_id,
                self.pack_id,
                self.title,
                "Narration profile contract test",
                json.dumps(
                    self.original_validation_metadata,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                base_json,
                self.admin,
                self.admin,
                now,
                now,
            ),
        )
        db.commit()
        db.close()

        generator = {
            "provider": "elevenlabs",
            "model_id": "eleven_multilingual_v2",
            "voice_id": "EkK5I93UQWFDigLMpZcX",
            "output_format": "mp3_44100_128",
            "provider_native_master": True,
            "lossless_master_claimed": False,
            "transcoded": False,
            "zero_retention": False,
            "license_status": "unverified",
        }
        self.generator = generator
        for asset in image_assets:
            asset_id = asset["id"]
            path = self.image_paths[asset_id]
            store.save_authored_original_asset_record(
                self.pack_id,
                asset_id,
                "image",
                "image/png",
                str(path),
                path.stat().st_size,
                self.expected_asset_sha256[asset_id],
                self.admin,
            )
        for asset in narration_assets:
            asset_id = asset["id"]
            path = self.audio_paths[asset_id]
            story = stories_by_audio[asset_id]
            store.save_authored_original_asset_record(
                self.pack_id,
                asset_id,
                "narration",
                "audio/mpeg",
                str(path),
                path.stat().st_size,
                self.expected_sha256[asset_id],
                self.admin,
                transcript_sha256=store.original_transcript_sha256(
                    story["transcript"]
                ),
                generator_metadata=generator,
            )
            store.attest_authored_original_generator_license(
                self.pack_id,
                asset_id,
                expected_sha256=self.expected_sha256[asset_id],
                expected_draft_revision=1,
                terms_id="elevenlabs_terms_of_service_non_eea_2026-03-31",
                terms_url="https://elevenlabs.io/terms-of-use",
                terms_version="31 March 2026",
                reviewed_at="2026-08-10",
                admin_user_id=self.admin,
            )

        db = store._conn()
        rows = db.execute(
            """SELECT asset_id,sha256,generator_metadata_json FROM authored_original_assets
               WHERE pack_id=? AND kind='narration' AND is_current=1""",
            (self.pack_id,),
        ).fetchall()
        stable_attested_at = (
            datetime.now(timezone.utc) - timedelta(seconds=5)
        ).isoformat(timespec="seconds").replace("+00:00", "Z")
        for row in rows:
            metadata = json.loads(row["generator_metadata_json"])
            metadata["license_attestation"]["attested_at"] = stable_attested_at
            db.execute(
                """UPDATE authored_original_assets SET generator_metadata_json=?
                   WHERE pack_id=? AND asset_id=? AND sha256=?""",
                (
                    json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                    self.pack_id,
                    row["asset_id"],
                    row["sha256"],
                ),
            )
        db.commit()
        rows = db.execute(
            """SELECT asset_id,generator_metadata_json FROM authored_original_assets
               WHERE pack_id=? AND kind='narration' AND is_current=1""",
            (self.pack_id,),
        ).fetchall()
        db.close()
        self.expected_redacted_license_attestation_sha256 = {
            row["asset_id"]: store.original_redacted_license_attestation_sha256(
                json.loads(row["generator_metadata_json"])["license_attestation"]
            )
            for row in rows
        }
        self.latest_attested_at = max(
            json.loads(row["generator_metadata_json"])["license_attestation"][
                "attested_at"
            ]
            for row in rows
        )
        self.profile = {
            "schema_version": 2,
            "provider": "elevenlabs",
            "voice_id": "EkK5I93UQWFDigLMpZcX",
            "model_snapshot": "eleven_multilingual_v2",
            "api_version": "elevenlabs_text_to_speech_v1",
            "language": "en",
            "generation": {
                "output_format": "mp3_44100_128",
                "mime_type": "audio/mpeg",
                "sample_rate_hz": 44_100,
                "bitrate_kbps": 128,
                "channels": 1,
                "provider_native": True,
                "lossless": False,
            },
            "archival_master": {
                "mime_type": "audio/mpeg",
                "sample_rate_hz": 44_100,
                "bitrate_kbps": 128,
                "channels": 1,
                "provider_native": True,
                "immutable": True,
                "lossless": False,
            },
            "mobile_delivery": {
                "mime_type": "audio/mpeg",
                "sample_rate_hz": 44_100,
                "bitrate_kbps": 128,
                "channels": 1,
                "lossless": False,
                "transcoded": False,
                "byte_identical_to_archival_master": True,
            },
            "commercial_license": {
                "status": "verified",
                "plan": "creator",
                "commercial_use_allowed": True,
                "terms_id": "elevenlabs_terms_of_service_non_eea_2026-03-31",
                "terms_url": "https://elevenlabs.io/terms-of-use",
                "terms_version": "31 March 2026",
                "reviewed_at": "2026-08-10",
                "verified_at": self.latest_attested_at,
            },
            "training_contribution": {
                "status": "disabled",
                "confirmed_at": self.latest_attested_at,
            },
            "provider_data_retention": {
                "status": "provider_standard",
                "zero_retention": False,
                "confirmed_at": self.latest_attested_at,
            },
        }

    def tearDown(self) -> None:
        store._ORIGINAL_ASSET_INTEGRITY_CACHE.clear()
        settings.db_path = self._old_db_path
        self._temp.cleanup()

    @staticmethod
    def _mp3_bytes(marker: int) -> bytes:
        header = (
            (0x7FF << 21)
            | (3 << 19)
            | (1 << 17)
            | (1 << 16)
            | (9 << 12)
            | (3 << 6)
        ).to_bytes(4, "big")
        frame_size = int((144_000 * 128) / 44_100)
        payload = bytes([marker]) + bytes(frame_size - 5)
        return (header + payload) * 40

    @staticmethod
    def _png_bytes(marker: int) -> bytes:
        def chunk(kind: bytes, data: bytes) -> bytes:
            return (
                struct.pack(">I", len(data))
                + kind
                + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
            )

        header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
        pixels = zlib.compress(bytes((0, marker % 256, 0, 0)))
        return (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", pixels)
            + chunk(b"IEND", b"")
        )

    def _pack_row(self) -> dict:
        db = store._conn()
        row = db.execute(
            "SELECT * FROM authored_trip_packs WHERE id=?", (self.pack_id,),
        ).fetchone()
        db.close()
        return dict(row)

    def _apply(self, **overrides) -> dict:
        arguments = {
            "expected_draft_revision": 1,
            "expected_base_manifest_sha256": self.base_hash,
            "expected_validation_metadata_sha256": self.validation_metadata_hash,
            "expected_asset_sha256": self.expected_asset_sha256,
            "expected_redacted_license_attestation_sha256": (
                self.expected_redacted_license_attestation_sha256
            ),
            "narration_profile": self.profile,
            "admin_user_id": self.admin,
        }
        arguments.update(overrides)
        return store.apply_authored_original_narration_profile_v2(
            self.pack_id,
            **arguments,
        )

    def _revert(self, applied: dict, **overrides) -> dict:
        arguments = {
            "expected_draft_revision": applied["after_draft_revision"],
            "expected_profile_sha256": applied["profile_sha256"],
            "expected_applied_manifest_sha256": applied["after_manifest_sha256"],
            "expected_base_manifest_sha256": applied["base_manifest_sha256"],
            "expected_narration_sha256": self.expected_sha256,
            "narration_profile": self.profile,
            "restore_validation_metadata": applied["rollback_validation_metadata"],
            "admin_user_id": self.admin,
        }
        arguments.update(overrides)
        return store.revert_authored_original_narration_profile_v2(
            self.pack_id,
            **arguments,
        )

    def test_applies_only_profile_flags_and_audit_revision(self) -> None:
        before = self._pack_row()
        result = self._apply()
        after = self._pack_row()

        self.assertEqual(result["before_draft_revision"], 1)
        self.assertEqual(result["after_draft_revision"], 2)
        self.assertFalse(result["replayed"])
        self.assertEqual(result["base_manifest_sha256"], self.base_hash)
        self.assertEqual(result["before_manifest_sha256"], self.base_hash)
        self.assertEqual(len(result["bindings"]), 13)
        self.assertTrue(result["single_attesting_admin"])
        self.assertTrue(all(
            "attested_by_admin_user_id" not in binding
            for binding in result["bindings"]
        ))
        self.assertEqual(
            result["profile_sha256"],
            store._original_validation_hash(self.profile),
        )
        saved_manifest = json.loads(after["draft_original_manifest_json"])
        saved_validation = json.loads(after["draft_validation_metadata"])
        self.assertEqual(saved_manifest["narration_profile"], self.profile)
        self.assertEqual(
            result["after_manifest_sha256"],
            store._original_validation_hash(saved_manifest),
        )
        self.assertEqual(saved_validation["existing_gate"], "preserve-me")
        self.assertIs(saved_validation["admin_license_attestation_complete"], True)
        self.assertIs(saved_validation["verified_private_upload_complete"], True)
        self.assertEqual(after["draft_revision"], 2)
        self.assertEqual(after["updated_by"], self.admin)
        self.assertEqual(
            result["before_validation_metadata"],
            self.original_validation_metadata,
        )
        self.assertEqual(
            result["rollback_validation_metadata"],
            self.original_validation_metadata,
        )
        self.assertEqual(
            result["rollback_validation_metadata_sha256"],
            store._original_validation_hash(self.original_validation_metadata),
        )
        self.assertEqual(result["after_validation_metadata"], saved_validation)
        self.assertEqual(
            result["before_validation_metadata_sha256"],
            store._original_validation_hash(self.original_validation_metadata),
        )
        self.assertEqual(
            result["after_validation_metadata_sha256"],
            store._original_validation_hash(saved_validation),
        )
        allowed = {
            "draft_original_manifest_json",
            "draft_validation_metadata",
            "draft_revision",
            "updated_by",
            "updated_at",
        }
        self.assertEqual(
            {key: value for key, value in after.items() if key not in allowed},
            {key: value for key, value in before.items() if key not in allowed},
        )

    def test_exact_replay_accepts_original_or_current_revision_without_writing(self) -> None:
        first = self._apply()
        db = store._conn()
        db.execute(
            "UPDATE authored_trip_packs SET updated_at=123456789 WHERE id=?",
            (self.pack_id,),
        )
        db.commit()
        db.close()

        replay = self._apply(
            expected_validation_metadata_sha256=(
                first["after_validation_metadata_sha256"]
            )
        )
        self.assertTrue(replay["replayed"])
        self.assertIsNone(replay["rollback_validation_metadata"])
        self.assertIsNone(replay["rollback_validation_metadata_sha256"])
        self.assertEqual(replay["before_draft_revision"], 2)
        self.assertEqual(replay["after_draft_revision"], 2)
        self.assertEqual(replay["before_manifest_sha256"], first["after_manifest_sha256"])
        self.assertEqual(replay["after_manifest_sha256"], first["after_manifest_sha256"])
        self.assertEqual(self._pack_row()["updated_at"], 123456789)

        replay_current = self._apply(
            expected_draft_revision=2,
            expected_validation_metadata_sha256=(
                first["after_validation_metadata_sha256"]
            ),
        )
        self.assertTrue(replay_current["replayed"])
        self.assertEqual(self._pack_row()["draft_revision"], 2)

    def test_cas_admin_and_sha_guards_fail_without_writing(self) -> None:
        before = self._pack_row()
        attempts = [
            {"expected_draft_revision": 2},
            {"expected_base_manifest_sha256": "f" * 64},
            {"expected_validation_metadata_sha256": "f" * 64},
            {"expected_validation_metadata_sha256": "A" * 64},
            {"admin_user_id": self.user},
        ]
        for overrides in attempts:
            with self.subTest(overrides=overrides):
                with self.assertRaises((ValueError, PermissionError)):
                    self._apply(**overrides)
                self.assertEqual(self._pack_row(), before)

        stale_assets = dict(self.expected_asset_sha256)
        asset_id = sorted(stale_assets)[0]
        stale_assets[asset_id] = "f" * 64
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply(expected_asset_sha256=stale_assets)
        self.assertEqual(self._pack_row(), before)

    def test_validation_metadata_hash_is_cas_bound_for_apply_and_replay(self) -> None:
        drifted = copy.deepcopy(self.original_validation_metadata)
        drifted["concurrent_non_revision_write"] = True
        db = store._conn()
        db.execute(
            "UPDATE authored_trip_packs SET draft_validation_metadata=? WHERE id=?",
            (
                json.dumps(drifted, separators=(",", ":"), sort_keys=True),
                self.pack_id,
            ),
        )
        db.commit()
        db.close()
        drifted_row = self._pack_row()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply()
        self.assertEqual(self._pack_row(), drifted_row)

        db = store._conn()
        db.execute(
            "UPDATE authored_trip_packs SET draft_validation_metadata=? WHERE id=?",
            (
                json.dumps(
                    self.original_validation_metadata,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                self.pack_id,
            ),
        )
        db.commit()
        db.close()
        applied = self._apply()
        applied_validation = copy.deepcopy(applied["after_validation_metadata"])
        applied_validation["concurrent_non_revision_write"] = True
        db = store._conn()
        db.execute(
            "UPDATE authored_trip_packs SET draft_validation_metadata=? WHERE id=?",
            (
                json.dumps(
                    applied_validation,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                self.pack_id,
            ),
        )
        db.commit()
        db.close()
        replay_drifted_row = self._pack_row()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply(
                expected_validation_metadata_sha256=(
                    applied["after_validation_metadata_sha256"]
                )
            )
        self.assertEqual(self._pack_row(), replay_drifted_row)

    def test_full_asset_and_license_attestation_hashes_are_cas_bound(self) -> None:
        image_id = sorted(self.image_paths)[0]
        replacement = self.root / "replacement-art.png"
        replacement.write_bytes(self._png_bytes(250))
        replacement_sha256 = hashlib.sha256(replacement.read_bytes()).hexdigest()
        store.save_authored_original_asset_record(
            self.pack_id,
            image_id,
            "image",
            "image/png",
            str(replacement),
            replacement.stat().st_size,
            replacement_sha256,
            self.admin,
        )
        before = self._pack_row()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply()
        self.assertEqual(self._pack_row(), before)

        original_path = self.image_paths[image_id]
        original_sha256 = self.expected_asset_sha256[image_id]
        store.save_authored_original_asset_record(
            self.pack_id,
            image_id,
            "image",
            "image/png",
            str(original_path),
            original_path.stat().st_size,
            original_sha256,
            self.admin,
        )
        narration_id = sorted(self.expected_redacted_license_attestation_sha256)[0]
        db = store._conn()
        row = db.execute(
            """SELECT generator_metadata_json FROM authored_original_assets
               WHERE pack_id=? AND asset_id=? AND is_current=1""",
            (self.pack_id, narration_id),
        ).fetchone()
        metadata = json.loads(row["generator_metadata_json"])
        metadata["license_attestation"]["unexpected_drift"] = "changed"
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?
               WHERE pack_id=? AND asset_id=? AND is_current=1""",
            (
                json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                self.pack_id,
                narration_id,
            ),
        )
        db.commit()
        db.close()
        before_attestation = self._pack_row()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply()
        self.assertEqual(self._pack_row(), before_attestation)

    def test_downstream_validation_flags_block_apply(self) -> None:
        for flag in (
            "authenticated_device_preview_complete",
            "trusted_publication_validation_complete",
            "public_release",
        ):
            with self.subTest(flag=flag):
                metadata = copy.deepcopy(self.original_validation_metadata)
                metadata[flag] = True
                db = store._conn()
                db.execute(
                    "UPDATE authored_trip_packs SET draft_validation_metadata=? WHERE id=?",
                    (
                        json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                        self.pack_id,
                    ),
                )
                db.commit()
                db.close()
                before = self._pack_row()
                with self.assertRaises(store.OriginalNarrationProfileConflictError):
                    self._apply(
                        expected_validation_metadata_sha256=(
                            store._original_validation_hash(metadata)
                        )
                    )
                self.assertEqual(self._pack_row(), before)

    def test_redacted_attestation_hash_keeps_admin_identity_internal(self) -> None:
        narration_id = sorted(self.expected_redacted_license_attestation_sha256)[0]
        db = store._conn()
        row = db.execute(
            """SELECT generator_metadata_json FROM authored_original_assets
               WHERE pack_id=? AND asset_id=? AND is_current=1""",
            (self.pack_id, narration_id),
        ).fetchone()
        original_json = row["generator_metadata_json"]
        metadata = json.loads(original_json)
        expected_redacted = store.original_redacted_license_attestation_sha256(
            metadata["license_attestation"]
        )
        metadata["license_attestation"]["attested_by_admin_user_id"] = self.other_admin
        self.assertEqual(
            store.original_redacted_license_attestation_sha256(
                metadata["license_attestation"]
            ),
            expected_redacted,
        )
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?
               WHERE pack_id=? AND asset_id=? AND is_current=1""",
            (
                json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                self.pack_id,
                narration_id,
            ),
        )
        db.commit()
        db.close()
        before = self._pack_row()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply()
        self.assertEqual(self._pack_row(), before)

        db = store._conn()
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?
               WHERE pack_id=? AND asset_id=? AND is_current=1""",
            (original_json, self.pack_id, narration_id),
        )
        rows = db.execute(
            """SELECT asset_id,generator_metadata_json FROM authored_original_assets
               WHERE pack_id=? AND kind='narration' AND is_current=1""",
            (self.pack_id,),
        ).fetchall()
        for row in rows:
            metadata = json.loads(row["generator_metadata_json"])
            metadata["license_attestation"]["attested_by_admin_user_id"] = 999_999
            db.execute(
                """UPDATE authored_original_assets SET generator_metadata_json=?
                   WHERE pack_id=? AND asset_id=? AND is_current=1""",
                (
                    json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                    self.pack_id,
                    row["asset_id"],
                ),
            )
        db.commit()
        db.close()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply()

    def test_revalidates_bytes_profile_terms_and_verified_at(self) -> None:
        asset_id = sorted(self.audio_paths)[0]
        path = self.audio_paths[asset_id]
        original = path.read_bytes()
        changed = bytearray(original)
        changed[-1] ^= 0x01
        path.write_bytes(changed)
        before = self._pack_row()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply()
        self.assertEqual(self._pack_row(), before)
        path.write_bytes(original)
        store._ORIGINAL_ASSET_INTEGRITY_CACHE.clear()

        wrong_time = copy.deepcopy(self.profile)
        wrong_time["commercial_license"]["verified_at"] = "2026-08-09T00:00:00Z"
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply(narration_profile=wrong_time)
        self.assertEqual(self._pack_row(), before)

        noncanonical = copy.deepcopy(self.profile)
        noncanonical["commercial_license"]["terms_version"] += " "
        with self.assertRaisesRegex(ValueError, "canonical schema_version 2"):
            self._apply(narration_profile=noncanonical)
        self.assertEqual(self._pack_row(), before)

    def test_conflicting_existing_profile_or_partial_flags_fail_closed(self) -> None:
        self._apply()
        applied = self._pack_row()
        db = store._conn()
        validation = json.loads(applied["draft_validation_metadata"])
        validation["verified_private_upload_complete"] = False
        db.execute(
            "UPDATE authored_trip_packs SET draft_validation_metadata=? WHERE id=?",
            (
                json.dumps(validation, separators=(",", ":"), sort_keys=True),
                self.pack_id,
            ),
        )
        db.commit()
        db.close()
        partial = self._pack_row()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply(
                expected_draft_revision=2,
                expected_validation_metadata_sha256=store._original_validation_hash(
                    validation
                ),
            )
        self.assertEqual(self._pack_row(), partial)

    def test_revert_removes_only_profile_restores_gates_and_replays_exactly(self) -> None:
        applied = self._apply()
        applied_row = self._pack_row()
        reverted = self._revert(applied)
        after = self._pack_row()

        self.assertFalse(reverted["replayed"])
        self.assertEqual(reverted["before_draft_revision"], 2)
        self.assertEqual(reverted["after_draft_revision"], 3)
        self.assertEqual(
            reverted["applied_manifest_sha256"],
            applied["after_manifest_sha256"],
        )
        self.assertEqual(reverted["after_manifest_sha256"], self.base_hash)
        manifest = json.loads(after["draft_original_manifest_json"])
        validation = json.loads(after["draft_validation_metadata"])
        self.assertNotIn("narration_profile", manifest)
        self.assertEqual(store._original_validation_hash(manifest), self.base_hash)
        self.assertIs(validation["admin_license_attestation_complete"], False)
        self.assertIs(validation["verified_private_upload_complete"], False)
        self.assertEqual(validation["existing_gate"], "preserve-me")
        allowed = {
            "draft_original_manifest_json",
            "draft_validation_metadata",
            "draft_revision",
            "updated_by",
            "updated_at",
        }
        self.assertEqual(
            {key: value for key, value in after.items() if key not in allowed},
            {key: value for key, value in applied_row.items() if key not in allowed},
        )

        db = store._conn()
        db.execute(
            "UPDATE authored_trip_packs SET updated_at=123456789 WHERE id=?",
            (self.pack_id,),
        )
        db.commit()
        db.close()
        replay = self._revert(applied)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["before_draft_revision"], 3)
        self.assertEqual(replay["after_draft_revision"], 3)
        self.assertEqual(self._pack_row()["updated_at"], 123456789)

    def test_revert_restores_missing_validation_keys_exactly(self) -> None:
        exact_before = {"existing_gate": "preserve-me"}
        db = store._conn()
        db.execute(
            "UPDATE authored_trip_packs SET draft_validation_metadata=? WHERE id=?",
            (
                json.dumps(exact_before, separators=(",", ":"), sort_keys=True),
                self.pack_id,
            ),
        )
        db.commit()
        db.close()

        applied = self._apply(
            expected_validation_metadata_sha256=store._original_validation_hash(
                exact_before
            )
        )
        self.assertEqual(applied["before_validation_metadata"], exact_before)
        self._revert(applied)
        restored = json.loads(self._pack_row()["draft_validation_metadata"])
        self.assertEqual(restored, exact_before)
        self.assertNotIn("admin_license_attestation_complete", restored)
        self.assertNotIn("verified_private_upload_complete", restored)

    def test_revert_is_hash_revision_admin_and_asset_guarded(self) -> None:
        applied = self._apply()
        before = self._pack_row()
        attempts = [
            {"expected_draft_revision": 1},
            {"expected_profile_sha256": "f" * 64},
            {"expected_applied_manifest_sha256": "f" * 64},
            {"expected_base_manifest_sha256": "f" * 64},
            {"admin_user_id": self.user},
        ]
        for overrides in attempts:
            with self.subTest(overrides=overrides):
                with self.assertRaises((ValueError, PermissionError)):
                    self._revert(applied, **overrides)
                self.assertEqual(self._pack_row(), before)

        stale_assets = dict(self.expected_sha256)
        stale_assets[sorted(stale_assets)[0]] = "f" * 64
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._revert(applied, expected_narration_sha256=stale_assets)
        self.assertEqual(self._pack_row(), before)

    def test_future_server_attestation_fails_apply_and_revert(self) -> None:
        asset_id = sorted(self.expected_sha256)[0]
        db = store._conn()
        row = db.execute(
            """SELECT generator_metadata_json FROM authored_original_assets
               WHERE pack_id=? AND asset_id=? AND is_current=1""",
            (self.pack_id, asset_id),
        ).fetchone()
        original_metadata_json = row["generator_metadata_json"]
        metadata = json.loads(original_metadata_json)
        metadata["license_attestation"]["attested_at"] = (
            datetime.now(timezone.utc) + timedelta(days=1)
        ).isoformat(timespec="seconds").replace("+00:00", "Z")
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?
               WHERE pack_id=? AND asset_id=? AND is_current=1""",
            (
                json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                self.pack_id,
                asset_id,
            ),
        )
        db.commit()
        db.close()
        before = self._pack_row()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._apply()
        self.assertEqual(self._pack_row(), before)

        db = store._conn()
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?
               WHERE pack_id=? AND asset_id=? AND is_current=1""",
            (original_metadata_json, self.pack_id, asset_id),
        )
        db.commit()
        db.close()
        applied = self._apply()
        db = store._conn()
        db.execute(
            """UPDATE authored_original_assets SET generator_metadata_json=?
               WHERE pack_id=? AND asset_id=? AND is_current=1""",
            (
                json.dumps(metadata, separators=(",", ":"), sort_keys=True),
                self.pack_id,
                asset_id,
            ),
        )
        db.commit()
        db.close()
        applied_row = self._pack_row()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            self._revert(applied)
        self.assertEqual(self._pack_row(), applied_row)

    def test_profiled_draft_blocks_all_asset_writes_before_current_state_changes(self) -> None:
        applied = self._apply()
        asset_id = sorted(self.expected_sha256)[0]
        replacement = self.root / "replacement.mp3"
        replacement.write_bytes(self._mp3_bytes(99))
        replacement_sha256 = hashlib.sha256(replacement.read_bytes()).hexdigest()
        db = store._conn()
        before_rows = [
            dict(row)
            for row in db.execute(
                """SELECT * FROM authored_original_assets
                   WHERE pack_id=? ORDER BY asset_id,sha256""",
                (self.pack_id,),
            ).fetchall()
        ]
        db.close()

        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            store.save_authored_original_asset_record(
                self.pack_id,
                asset_id,
                "narration",
                "audio/mpeg",
                str(replacement),
                replacement.stat().st_size,
                replacement_sha256,
                self.admin,
                transcript_sha256=next(
                    binding["transcript_sha256"]
                    for binding in applied["bindings"]
                    if binding["asset_id"] == asset_id
                ),
                generator_metadata=self.generator,
            )

        other_path = self.root / "blocked-other.bin"
        other_path.write_bytes(b"blocked asset bytes")
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            store.save_authored_original_asset_record(
                self.pack_id,
                "blocked_other_asset",
                "other",
                "application/octet-stream",
                str(other_path),
                other_path.stat().st_size,
                hashlib.sha256(other_path.read_bytes()).hexdigest(),
                self.admin,
            )

        db = store._conn()
        after_rows = [
            dict(row)
            for row in db.execute(
                """SELECT * FROM authored_original_assets
                   WHERE pack_id=? ORDER BY asset_id,sha256""",
                (self.pack_id,),
            ).fetchall()
        ]
        db.close()
        self.assertEqual(after_rows, before_rows)

    def test_account_evidence_confirmed_at_requires_canonical_nonfuture_utc(self) -> None:
        variants = []
        offset = copy.deepcopy(self.profile)
        offset["training_contribution"]["confirmed_at"] = (
            self.profile["training_contribution"]["confirmed_at"]
            .replace("Z", "+00:00")
        )
        variants.append(offset)
        fractional = copy.deepcopy(self.profile)
        fractional["provider_data_retention"]["confirmed_at"] = (
            self.profile["provider_data_retention"]["confirmed_at"]
            .replace("Z", ".000Z")
        )
        variants.append(fractional)
        future = copy.deepcopy(self.profile)
        future["training_contribution"]["confirmed_at"] = (
            datetime.now(timezone.utc) + timedelta(days=1)
        ).isoformat(timespec="seconds").replace("+00:00", "Z")
        variants.append(future)

        before = self._pack_row()
        for profile in variants:
            with self.subTest(confirmed_at=profile):
                with self.assertRaises(store.OriginalNarrationProfileConflictError):
                    self._apply(narration_profile=profile)
                self.assertEqual(self._pack_row(), before)

    def test_generic_save_cannot_add_change_remove_or_create_profile(self) -> None:
        pack = store.get_authored_trip_pack_admin(
            self.pack_id, content_kind="original_drive",
        )

        def generic_save(manifest: dict, validation: dict | None = None) -> None:
            store.save_authored_trip_pack_draft(
                self.pack_id,
                pack["slug"],
                pack["title"],
                pack["summary"],
                pack["price_credits"],
                pack["coverage_region"],
                pack["public_metadata"],
                validation or pack["validation_metadata"],
                pack["template"],
                self.admin,
                content_kind="original_drive",
                original_manifest=manifest,
            )

        add = copy.deepcopy(self.normalized_base)
        add["narration_profile"] = copy.deepcopy(self.profile)
        before = self._pack_row()
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            generic_save(add)
        self.assertEqual(self._pack_row(), before)

        new_pack_id = "original_profile_creation_bypass"
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            store.save_authored_trip_pack_draft(
                new_pack_id,
                new_pack_id,
                self.title,
                "Creation bypass test",
                0,
                "north_america",
                {},
                {},
                pack["template"],
                self.admin,
                content_kind="original_drive",
                original_manifest=add,
            )
        self.assertIsNone(
            store.get_authored_trip_pack_admin(
                new_pack_id, content_kind="original_drive",
            )
        )

        self._apply()
        applied_pack = store.get_authored_trip_pack_admin(
            self.pack_id, content_kind="original_drive",
        )
        applied_row = self._pack_row()

        changed_validation = copy.deepcopy(applied_pack["validation_metadata"])
        changed_validation["existing_gate"] = "generic-drift"
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            store.save_authored_trip_pack_draft(
                self.pack_id,
                applied_pack["slug"],
                applied_pack["title"],
                applied_pack["summary"],
                applied_pack["price_credits"],
                applied_pack["coverage_region"],
                applied_pack["public_metadata"],
                changed_validation,
                applied_pack["template"],
                self.admin,
                content_kind="original_drive",
                original_manifest=applied_pack["original_manifest"],
            )
        self.assertEqual(self._pack_row(), applied_row)

        changed_base = copy.deepcopy(applied_pack["original_manifest"])
        changed_base["stories"][0]["title"] += " changed"
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            store.save_authored_trip_pack_draft(
                self.pack_id,
                applied_pack["slug"],
                applied_pack["title"],
                applied_pack["summary"],
                applied_pack["price_credits"],
                applied_pack["coverage_region"],
                applied_pack["public_metadata"],
                applied_pack["validation_metadata"],
                applied_pack["template"],
                self.admin,
                content_kind="original_drive",
                original_manifest=changed_base,
            )
        self.assertEqual(self._pack_row(), applied_row)

        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            store.save_authored_trip_pack_draft(
                self.pack_id,
                applied_pack["slug"],
                applied_pack["title"],
                applied_pack["summary"],
                applied_pack["price_credits"],
                applied_pack["coverage_region"],
                applied_pack["public_metadata"],
                applied_pack["validation_metadata"],
                applied_pack["template"],
                self.admin,
                content_kind="original_drive",
                original_manifest=self.normalized_base,
            )
        self.assertEqual(self._pack_row(), applied_row)

        changed = copy.deepcopy(applied_pack["original_manifest"])
        changed["narration_profile"]["voice_id"] = "different-reviewed-voice"
        with self.assertRaises(store.OriginalNarrationProfileConflictError):
            store.save_authored_trip_pack_draft(
                self.pack_id,
                applied_pack["slug"],
                applied_pack["title"],
                applied_pack["summary"],
                applied_pack["price_credits"],
                applied_pack["coverage_region"],
                applied_pack["public_metadata"],
                applied_pack["validation_metadata"],
                applied_pack["template"],
                self.admin,
                content_kind="original_drive",
                original_manifest=changed,
            )
        self.assertEqual(self._pack_row(), applied_row)


if __name__ == "__main__":
    unittest.main()
