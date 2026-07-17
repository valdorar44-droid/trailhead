import asyncio
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
import time
import unittest
import wave
import zlib
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from config.settings import settings
from dashboard import server
from dashboard.server import (
    AuthoredOriginalDraftRequest,
    api_acquire_original,
    api_original_manifest,
    api_public_originals,
)
from db import store


FIXTURE_PATH = (
    Path(__file__).parent
    / "fixtures"
    / "originals"
    / "moab_canyons_to_sky_draft.json"
)


def _load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _fixture_asset_content(asset: dict, transcript: str | None = None) -> bytes:
    if asset.get("kind") == "image":
        width, height = 320, 180
        raw = b"".join(b"\x00" + b"\xf9\x73\x16\xff" * width for _ in range(height))

        def chunk(kind: bytes, data: bytes) -> bytes:
            return (
                struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
            )

        return (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b"")
        )
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(1)
        audio.setframerate(8000)
        sample = hashlib.sha256(str(transcript or asset.get("id") or "").encode()).digest()[0:1]
        audio.writeframes(sample * 8000)
    return output.getvalue()


def _ready_payload(*, price: int = 0, title: str | None = None) -> dict:
    payload = _load_fixture()
    payload["price_credits"] = price
    payload["summary"] = "A reviewed paved scenic drive with GPS-triggered stories and offline playback."
    payload["public_metadata"].pop("editorial_notice", None)
    payload["template"]["summary"] = payload["summary"]
    payload["template"]["readiness"] = {"status": "ready"}
    if title:
        payload["title"] = title
        payload["template"]["title"] = title
        payload["manifest"]["title"] = title
    payload["validation_metadata"] = {
        check: True for check in store.ORIGINAL_VALIDATION_CHECKS
    }
    reviewed_at = datetime.now(timezone.utc) - timedelta(days=1)
    reviewed_timestamp = reviewed_at.isoformat(timespec="seconds").replace("+00:00", "Z")
    payload["manifest"]["review"] = {
        "editorial_status": "approved",
        "field_drive_completed_at": reviewed_timestamp,
        "source_review_completed_at": reviewed_timestamp,
    }
    route_coordinates = [
        [float(stop["coordinates"]["lng"]), float(stop["coordinates"]["lat"])]
        for stop in payload["manifest"]["stops"]
    ]
    cumulative = [0.0]
    for start, end in zip(route_coordinates, route_coordinates[1:]):
        lng1, lat1 = map(math.radians, start)
        lng2, lat2 = map(math.radians, end)
        delta_lat = lat2 - lat1
        delta_lng = lng2 - lng1
        hav = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
        cumulative.append(cumulative[-1] + 2 * 6_371_000 * math.asin(math.sqrt(hav)))
    payload["manifest"]["route"]["geometry"]["coordinates"] = route_coordinates
    payload["manifest"]["route"]["distance_m"] = cumulative[-1]
    for stop, progress in zip(payload["manifest"]["stops"], cumulative):
        stop["trigger"]["route_progress_start_m"] = max(0.0, progress - 400.0)
        stop["trigger"]["route_progress_end_m"] = min(cumulative[-1], progress + 400.0)
    payload["manifest"]["offline_map"]["estimated_bytes"] = 24_000_000
    payload["manifest"]["offline_map"]["region_id"] = "moab_original_v1"
    payload["manifest"]["safety"] = {
        "summary": "Check current road, weather, and park conditions before departure.",
        "emergency_note": "Call 911 for emergencies where service is available.",
        "disclaimers": ["Conditions and access can change; follow posted closures and official guidance."],
    }
    payload["manifest"]["access"] = {
        "surface": "paved",
        "vehicle": "Standard passenger vehicle on the authored paved route.",
        "fees": "Check current National Park Service entrance fees before departure.",
        "accessibility_notes": "Stops vary; consult official accessibility information for each site.",
    }
    payload["manifest"]["season"]["closures_note"] = "Check current closures and weather before every trip."
    for stop in payload["manifest"]["stops"]:
        stop["transcript"] = f"Reviewed narration for {stop['title']} based on the cited official source."
        stop["audio_duration_s"] = 1.0
        artwork_id = f"moab_artwork_{int(stop['sequence']):02d}"
        stop["artwork_asset_id"] = artwork_id
        payload["manifest"]["assets"].append({
            "id": artwork_id,
            "kind": "image",
            "path": f"pending://{artwork_id}",
            "mime_type": "image/png",
            "bytes": 0,
            "sha256": "0" * 64,
        })
        for citation in stop["citations"]:
            citation["reviewed_at"] = reviewed_at.date().isoformat()
    transcripts_by_asset = {
        stop["audio_asset_id"]: stop["transcript"]
        for stop in payload["manifest"]["stops"]
    }
    for asset in payload["manifest"]["assets"]:
        content = _fixture_asset_content(asset, transcripts_by_asset.get(asset["id"]))
        asset["path"] = f"pending://{asset['id']}"
        asset["mime_type"] = "image/png" if asset["kind"] == "image" else "audio/wav"
        asset["bytes"] = len(content)
        asset["sha256"] = hashlib.sha256(content).hexdigest()
    return payload


def _legacy_template() -> dict:
    return {
        "schema_version": 2,
        "title": "Legacy authored pack",
        "summary": "Legacy pack used to verify catalog separation.",
        "regions": ["UT"],
        "route": {},
        "days": [],
        "items": [],
        "notes": [],
        "readiness": {},
        "bookings": [],
        "alerts": [],
        "offline": {},
        "visibility": "private",
    }


class TrailheadOriginalsTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()
        self.asset_dir = tempfile.TemporaryDirectory()
        self.admin = store.create_user(
            "original-admin@example.com", "original_admin", "hash", "original-admin-code"
        )
        store.set_user_admin(self.admin, True)
        self.user = store.create_user(
            "original-user@example.com", "original_user", "hash", "original-user-code"
        )

    def tearDown(self):
        self.asset_dir.cleanup()
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    def _save(
        self,
        payload: dict | None = None,
        *,
        pack_id: str | None = None,
        verify_assets: bool = True,
    ) -> dict:
        payload = copy.deepcopy(payload or _load_fixture())
        pack_id = pack_id or payload["pack_id"]
        saved = store.save_authored_trip_pack_draft(
            pack_id=pack_id,
            slug=payload["slug"] if pack_id == payload["pack_id"] else pack_id.replace("_", "-"),
            title=payload["title"],
            summary=payload["summary"],
            price_credits=payload["price_credits"],
            coverage_region=payload["coverage_region"],
            public_metadata=payload["public_metadata"],
            validation_metadata=payload["validation_metadata"],
            template=payload["template"],
            admin_user_id=self.admin,
            content_kind="original_drive",
            original_manifest=payload["manifest"],
        )
        ready = all(
            payload.get("validation_metadata", {}).get(check) is True
            for check in store.ORIGINAL_VALIDATION_CHECKS
        )
        if verify_assets and ready:
            transcripts_by_asset = {
                stop["audio_asset_id"]: stop["transcript"]
                for stop in payload["manifest"]["stops"]
            }
            for asset in payload["manifest"]["assets"]:
                content = _fixture_asset_content(asset, transcripts_by_asset.get(asset["id"]))
                mime_type = "image/png" if asset["kind"] == "image" else "audio/wav"
                suffix = "png" if asset["kind"] == "image" else "wav"
                path = Path(self.asset_dir.name) / f"{pack_id}_{asset['id']}.{suffix}"
                path.write_bytes(content)
                record = store.save_authored_original_asset_record(
                    pack_id,
                    asset["id"],
                    asset["kind"],
                    mime_type,
                    str(path),
                    len(content),
                    hashlib.sha256(content).hexdigest(),
                    self.admin,
                    transcript_sha256=(
                        store.original_transcript_sha256(transcripts_by_asset[asset["id"]])
                        if asset["kind"] == "narration" else None
                    ),
                )
                asset.update({key: record[key] for key in ("kind", "path", "mime_type", "bytes", "sha256")})
            saved = store.save_authored_trip_pack_draft(
                pack_id=pack_id,
                slug=payload["slug"] if pack_id == payload["pack_id"] else pack_id.replace("_", "-"),
                title=payload["title"],
                summary=payload["summary"],
                price_credits=payload["price_credits"],
                coverage_region=payload["coverage_region"],
                public_metadata=payload["public_metadata"],
                validation_metadata=payload["validation_metadata"],
                template=payload["template"],
                admin_user_id=self.admin,
                content_kind="original_drive",
                original_manifest=payload["manifest"],
            )
        return saved

    def _publish(self, payload: dict | None = None, *, pack_id: str | None = None) -> dict:
        payload = copy.deepcopy(payload or _ready_payload())
        pack_id = pack_id or payload["pack_id"]
        self._save(payload, pack_id=pack_id)
        return store.publish_authored_trip_pack(
            pack_id,
            self.admin,
            required_content_kind="original_drive",
        )

    def test_moab_fixture_is_strictly_typed_and_explicitly_not_publishable(self):
        fixture = _load_fixture()
        parsed = AuthoredOriginalDraftRequest.model_validate(fixture)
        self.assertEqual(parsed.price_credits, 0)
        self.assertEqual(len(parsed.manifest.stops), 10)
        self.assertEqual(parsed.manifest.review.editorial_status, "source_review_required")

        draft = self._save(fixture)
        validation = store.validate_authored_original_draft(draft["id"])

        self.assertEqual(draft["content_kind"], "original_drive")
        self.assertFalse(validation["publish_ready"])
        self.assertEqual(set(validation["missing_reviews"]), store.ORIGINAL_VALIDATION_CHECKS)
        with self.assertRaisesRegex(ValueError, "Original review is incomplete"):
            store.publish_authored_trip_pack(
                draft["id"], self.admin, required_content_kind="original_drive",
            )

    def test_existing_authored_pack_schema_migrates_without_reclassification(self):
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        migration_path = tmp.name
        db = sqlite3.connect(migration_path)
        db.executescript(
            """
            CREATE TABLE authored_trip_packs (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'draft',
                draft_title TEXT NOT NULL,
                draft_summary TEXT NOT NULL,
                draft_price_credits INTEGER NOT NULL,
                draft_coverage_region TEXT NOT NULL,
                draft_public_metadata TEXT NOT NULL DEFAULT '{}',
                draft_validation_metadata TEXT NOT NULL DEFAULT '{}',
                draft_template_json TEXT NOT NULL,
                draft_revision INTEGER NOT NULL DEFAULT 1,
                current_published_version INTEGER,
                created_by INTEGER,
                updated_by INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE authored_trip_pack_versions (
                pack_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                slug TEXT,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                price_credits INTEGER NOT NULL,
                coverage_region TEXT NOT NULL,
                public_metadata TEXT NOT NULL DEFAULT '{}',
                validation_metadata TEXT NOT NULL DEFAULT '{}',
                template_json TEXT NOT NULL,
                published_by INTEGER,
                published_at INTEGER NOT NULL,
                PRIMARY KEY (pack_id, version)
            );
            INSERT INTO authored_trip_packs
              (id,slug,status,draft_title,draft_summary,draft_price_credits,
               draft_coverage_region,draft_public_metadata,draft_validation_metadata,
               draft_template_json,draft_revision,created_at,updated_at)
            VALUES
              ('legacy_before_originals','legacy-before-originals','draft','Legacy','Legacy',250,
               'north_america','{}','{}','{}',1,1,1);
            """
        )
        db.commit()
        db.close()
        try:
            settings.db_path = migration_path
            store.init_db()
            migrated = store._conn()
            pack_columns = {
                row["name"] for row in migrated.execute(
                    "PRAGMA table_info(authored_trip_packs)"
                ).fetchall()
            }
            version_columns = {
                row["name"] for row in migrated.execute(
                    "PRAGMA table_info(authored_trip_pack_versions)"
                ).fetchall()
            }
            row = migrated.execute(
                "SELECT content_kind,draft_original_manifest_json FROM authored_trip_packs WHERE id=?",
                ("legacy_before_originals",),
            ).fetchone()
            originals_feature_table = migrated.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='authored_original_features'"
            ).fetchone()
            originals_assets_table = migrated.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='authored_original_assets'"
            ).fetchone()
            acquisition_requests_table = migrated.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='authored_trip_pack_acquisition_requests'"
            ).fetchone()
            migrated.close()

            self.assertIn("content_kind", pack_columns)
            self.assertIn("draft_original_manifest_json", pack_columns)
            self.assertIn("content_kind", version_columns)
            self.assertIn("original_manifest_json", version_columns)
            self.assertEqual(row["content_kind"], "trip_pack")
            self.assertIsNone(row["draft_original_manifest_json"])
            self.assertIsNotNone(originals_feature_table)
            self.assertIsNotNone(originals_assets_table)
            self.assertIsNotNone(acquisition_requests_table)
        finally:
            settings.db_path = self.db_path
            for suffix in ("", "-wal", "-shm"):
                try:
                    os.unlink(migration_path + suffix)
                except FileNotFoundError:
                    pass

    def test_legacy_pack_level_entitlements_migrate_to_versioned_original_ownership(self):
        published = self._publish()
        acquired = store.acquire_authored_original(
            self.user, published["id"], "legacy-original-entitlement", version=1,
        )
        db = store._conn()
        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("DROP TABLE authored_trip_pack_acquisition_requests")
        db.execute(
            "ALTER TABLE authored_trip_pack_entitlements RENAME TO authored_entitlements_current"
        )
        db.execute(
            """CREATE TABLE authored_trip_pack_entitlements (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                pack_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                acquisition_type TEXT NOT NULL,
                list_price_credits INTEGER NOT NULL,
                credits_charged INTEGER NOT NULL,
                explorer_discount INTEGER NOT NULL DEFAULT 0,
                claim_month TEXT,
                trip_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                request_hash TEXT NOT NULL,
                acquired_at INTEGER NOT NULL,
                UNIQUE(user_id,pack_id),
                UNIQUE(user_id,idempotency_key),
                UNIQUE(user_id,claim_month)
            )"""
        )
        db.execute(
            """INSERT INTO authored_trip_pack_entitlements
               (id,user_id,pack_id,version,acquisition_type,list_price_credits,
                credits_charged,explorer_discount,claim_month,trip_id,
                idempotency_key,request_hash,acquired_at)
               SELECT id,user_id,pack_id,version,acquisition_type,list_price_credits,
                      credits_charged,explorer_discount,claim_month,trip_id,
                      idempotency_key,request_hash,acquired_at
               FROM authored_entitlements_current"""
        )
        db.execute("DROP TABLE authored_entitlements_current")
        db.commit()
        db.close()

        store.init_db()
        migrated = store._conn()
        row = migrated.execute(
            "SELECT * FROM authored_trip_pack_entitlements WHERE id=?",
            (acquired["entitlement"]["id"],),
        ).fetchone()
        indexes = []
        for index in migrated.execute(
            "PRAGMA index_list(authored_trip_pack_entitlements)"
        ).fetchall():
            if not index["unique"]:
                continue
            columns = tuple(item["name"] for item in migrated.execute(
                f"PRAGMA index_info('{index['name']}')"
            ).fetchall())
            indexes.append((columns, bool(index["partial"])))
        request = migrated.execute(
            """SELECT entitlement_id FROM authored_trip_pack_acquisition_requests
               WHERE user_id=? AND idempotency_key=?""",
            (self.user, "legacy-original-entitlement"),
        ).fetchone()
        migrated.close()

        self.assertEqual(row["content_kind"], "original_drive")
        self.assertIn((("user_id", "pack_id", "version"), False), indexes)
        self.assertNotIn((("user_id", "pack_id"), False), indexes)
        self.assertIn((("user_id", "pack_id"), True), indexes)
        self.assertEqual(request["entitlement_id"], acquired["entitlement"]["id"])

    def test_manifest_identity_is_server_owned_in_admin_requests(self):
        fixture = _load_fixture()
        fixture["manifest"]["pack_id"] = "spoofed_pack"
        with self.assertRaises(ValidationError):
            AuthoredOriginalDraftRequest.model_validate(fixture)

    def test_zero_price_is_allowed_only_for_originals(self):
        self._save()
        with self.assertRaisesRegex(ValueError, "250, 500, or 900"):
            store.save_authored_trip_pack_draft(
                pack_id="legacy_free_pack",
                slug="legacy-free-pack",
                title="Legacy free pack",
                summary="Legacy packs retain the existing paid price contract.",
                price_credits=0,
                coverage_region="north_america",
                public_metadata={},
                validation_metadata={check: True for check in store.TRIP_PACK_VALIDATION_CHECKS},
                template=_legacy_template(),
                admin_user_id=self.admin,
            )

    def test_public_catalogs_are_separate_and_detail_redacts_story_payloads(self):
        published = self._publish()
        store.save_authored_trip_pack_draft(
            pack_id="legacy_pack",
            slug="legacy-pack",
            title="Legacy pack",
            summary="A legacy authored trip pack.",
            price_credits=250,
            coverage_region="north_america",
            public_metadata={},
            validation_metadata={check: True for check in store.TRIP_PACK_VALIDATION_CHECKS},
            template=_legacy_template(),
            admin_user_id=self.admin,
        )
        store.publish_authored_trip_pack(
            "legacy_pack", self.admin, required_content_kind="trip_pack",
        )

        originals = store.list_published_originals()["items"]
        legacy = store.list_published_trip_packs()["items"]
        detail = store.get_published_original(published["id"])
        legacy_release = store.authored_trip_pack_release_validation(minimum_published=1)

        self.assertEqual([item["id"] for item in originals], [published["id"]])
        self.assertEqual([item["id"] for item in legacy], ["legacy_pack"])
        self.assertEqual(legacy_release["published_total"], 1)
        self.assertTrue(originals[0]["free"])
        self.assertNotIn("validation_metadata", originals[0])
        self.assertNotIn("template", detail)
        self.assertNotIn("assets", detail["manifest_preview"])
        self.assertNotIn("transcript", detail["manifest_preview"]["stops"][0])
        self.assertNotIn("citations", detail["manifest_preview"]["stops"][0])

    def test_published_manifests_are_immutable_and_server_identified(self):
        first = self._publish()
        first_manifest = store.get_published_original_manifest(first["id"], 1)
        revised = _ready_payload(title="Moab: Revised Edition")
        revised["manifest"]["stops"][0]["transcript"] = "Approved revised narration for version two."
        self._save(revised)
        second = store.publish_authored_trip_pack(
            first["id"], self.admin, required_content_kind="original_drive",
        )

        pinned = store.get_published_original_manifest(first["id"], 1)
        latest = store.get_published_original_manifest(first["id"], 2)

        self.assertEqual(first_manifest, pinned)
        self.assertEqual(pinned["manifest_id"], f"original_manifest_{first['id']}_v1")
        self.assertEqual(pinned["pack_id"], first["id"])
        self.assertEqual(pinned["version"], 1)
        self.assertEqual(second["version"], 2)
        self.assertNotEqual(
            pinned["stops"][0]["transcript"], latest["stops"][0]["transcript"],
        )

    def test_admin_version_history_exposes_decoded_immutable_snapshots(self):
        first_payload = _ready_payload(title="Moab Original V1")
        first = self._publish(first_payload)
        revised = _ready_payload(title="Moab Original V2")
        revised["manifest"]["stops"][0]["transcript"] = (
            "Approved narration preserved only in version two."
        )
        second = self._publish(revised)

        versions = store.list_authored_trip_pack_versions_admin(
            first["id"], "original_drive",
        )

        self.assertEqual([item["version"] for item in versions], [2, 1])
        self.assertEqual(
            [item["title"] for item in versions],
            ["Moab Original V2", "Moab Original V1"],
        )
        self.assertEqual(versions[0]["content_kind"], "original_drive")
        self.assertEqual(versions[0]["original_manifest"]["version"], 2)
        self.assertEqual(versions[1]["original_manifest"]["version"], 1)
        self.assertNotIn("original_manifest_json", versions[0])
        self.assertNotIn("template_json", versions[0])
        self.assertEqual(
            versions[0]["original_manifest"]["stops"][0]["transcript"],
            "Approved narration preserved only in version two.",
        )
        self.assertNotEqual(
            versions[1]["original_manifest"]["stops"][0]["transcript"],
            versions[0]["original_manifest"]["stops"][0]["transcript"],
        )
        self.assertEqual(
            store.list_authored_trip_pack_versions_admin(first["id"], "trip_pack"),
            [],
        )

        response = asyncio.run(server.api_admin_original(first["id"], {"id": self.admin}))
        self.assertEqual(response["current_published_version"], second["version"])
        self.assertEqual([item["version"] for item in response["versions"]], [2, 1])
        self.assertEqual(response["versions"][1]["title"], "Moab Original V1")

    def test_admin_device_preview_is_normalized_hash_bound_and_does_not_change_publish_gates(self):
        pack_id = "original_device_preview"
        self._save(_ready_payload(), pack_id=pack_id)
        draft = store.get_authored_trip_pack_admin(pack_id, "original_drive")
        draft["validation_metadata"]["trigger_drive_tested"] = False
        saved = store.save_authored_trip_pack_draft(
            pack_id=draft["id"], slug=draft["slug"], title=draft["title"],
            summary=draft["summary"], price_credits=draft["price_credits"],
            coverage_region=draft["coverage_region"], public_metadata=draft["public_metadata"],
            validation_metadata=draft["validation_metadata"], template=draft["template"],
            admin_user_id=self.admin, content_kind="original_drive",
            original_manifest=draft["original_manifest"],
        )
        before = store.validate_authored_original_draft(pack_id)

        manifest = store.get_authored_original_device_preview_manifest(pack_id)
        after = store.validate_authored_original_draft(pack_id)

        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(manifest["pack_id"], pack_id)
        self.assertEqual(
            manifest["version"],
            store.ORIGINAL_DEVICE_PREVIEW_VERSION_BASE + saved["draft_revision"],
        )
        self.assertEqual(
            manifest["manifest_id"],
            f"original_preview_manifest_{pack_id}_r{saved['draft_revision']}",
        )
        self.assertEqual(before, after)
        self.assertFalse(after["publish_ready"])
        self.assertEqual(after["missing_reviews"], ["trigger_drive_tested"])
        self.assertFalse(
            store.get_authored_trip_pack_admin(pack_id, "original_drive")[
                "validation_metadata"
            ]["trigger_drive_tested"]
        )
        for asset in manifest["assets"]:
            self.assertEqual(
                asset["path"],
                f"/api/admin/originals/{pack_id}/assets/{asset['id']}/{asset['sha256']}/content",
            )
        with self.assertRaisesRegex(ValueError, "review is incomplete"):
            store.publish_authored_trip_pack(
                pack_id, self.admin, required_content_kind="original_drive",
            )

        client = TestClient(server.app)
        preview_url = f"/api/admin/originals/{pack_id}/device-preview/manifest"
        self.assertEqual(client.get(preview_url).status_code, 401)
        self.assertEqual(
            client.get(
                preview_url,
                headers={"Authorization": f"Bearer {server._make_token(self.user)}"},
            ).status_code,
            403,
        )
        admin_response = client.get(
            preview_url,
            headers={"Authorization": f"Bearer {server._make_token(self.admin)}"},
        )
        self.assertEqual(admin_response.status_code, 200)
        self.assertEqual(admin_response.json(), manifest)

    def test_admin_device_preview_rejects_missing_mismatched_and_corrupt_assets(self):
        missing_id = "original_preview_missing"
        self._save(_ready_payload(), pack_id=missing_id, verify_assets=False)
        with self.assertRaisesRegex(ValueError, "current server-verified upload"):
            store.get_authored_original_device_preview_manifest(missing_id)

        mismatch_id = "original_preview_mismatch"
        self._save(_ready_payload(), pack_id=mismatch_id)
        mismatch = store.get_authored_trip_pack_admin(mismatch_id, "original_drive")
        mismatch["original_manifest"]["assets"][0]["bytes"] += 1
        store.save_authored_trip_pack_draft(
            pack_id=mismatch["id"], slug=mismatch["slug"], title=mismatch["title"],
            summary=mismatch["summary"], price_credits=mismatch["price_credits"],
            coverage_region=mismatch["coverage_region"], public_metadata=mismatch["public_metadata"],
            validation_metadata=mismatch["validation_metadata"], template=mismatch["template"],
            admin_user_id=self.admin, content_kind="original_drive",
            original_manifest=mismatch["original_manifest"],
        )
        with self.assertRaisesRegex(ValueError, "does not match its current"):
            store.get_authored_original_device_preview_manifest(mismatch_id)

        corrupt_id = "original_preview_corrupt"
        self._save(_ready_payload(), pack_id=corrupt_id)
        corrupt_draft = store.get_authored_trip_pack_admin(corrupt_id, "original_drive")
        corrupt_asset_id = corrupt_draft["original_manifest"]["assets"][0]["id"]
        corrupt_asset = store.get_authored_original_asset_record_admin(
            corrupt_id, corrupt_asset_id,
        )
        corrupt_path = Path(corrupt_asset["storage_path"])
        corrupt_path.write_bytes(corrupt_path.read_bytes() + b"corrupt")
        with self.assertRaisesRegex(ValueError, "current server-verified upload"):
            store.get_authored_original_device_preview_manifest(corrupt_id)

    def test_admin_device_preview_binds_narration_to_current_transcript_and_duration(self):
        transcript_id = "original_preview_transcript_binding"
        self._save(_ready_payload(), pack_id=transcript_id)
        transcript_draft = store.get_authored_trip_pack_admin(
            transcript_id, "original_drive",
        )
        transcript_draft["original_manifest"]["stops"][0]["transcript"] = (
            "A newly edited transcript whose narration has not been regenerated."
        )
        store.save_authored_trip_pack_draft(
            pack_id=transcript_draft["id"], slug=transcript_draft["slug"],
            title=transcript_draft["title"], summary=transcript_draft["summary"],
            price_credits=transcript_draft["price_credits"],
            coverage_region=transcript_draft["coverage_region"],
            public_metadata=transcript_draft["public_metadata"],
            validation_metadata=transcript_draft["validation_metadata"],
            template=transcript_draft["template"], admin_user_id=self.admin,
            content_kind="original_drive",
            original_manifest=transcript_draft["original_manifest"],
        )
        with self.assertRaisesRegex(ValueError, "current transcript"):
            store.get_authored_original_device_preview_manifest(transcript_id)

        duration_id = "original_preview_duration_binding"
        self._save(_ready_payload(), pack_id=duration_id)
        duration_draft = store.get_authored_trip_pack_admin(
            duration_id, "original_drive",
        )
        duration_draft["original_manifest"]["stops"][0]["audio_duration_s"] = 1.25
        store.save_authored_trip_pack_draft(
            pack_id=duration_draft["id"], slug=duration_draft["slug"],
            title=duration_draft["title"], summary=duration_draft["summary"],
            price_credits=duration_draft["price_credits"],
            coverage_region=duration_draft["coverage_region"],
            public_metadata=duration_draft["public_metadata"],
            validation_metadata=duration_draft["validation_metadata"],
            template=duration_draft["template"], admin_user_id=self.admin,
            content_kind="original_drive",
            original_manifest=duration_draft["original_manifest"],
        )
        self.assertIsNotNone(
            store.get_authored_original_device_preview_manifest(duration_id)
        )

        duration_draft = store.get_authored_trip_pack_admin(
            duration_id, "original_drive",
        )
        duration_draft["original_manifest"]["stops"][0]["audio_duration_s"] = 1.251
        store.save_authored_trip_pack_draft(
            pack_id=duration_draft["id"], slug=duration_draft["slug"],
            title=duration_draft["title"], summary=duration_draft["summary"],
            price_credits=duration_draft["price_credits"],
            coverage_region=duration_draft["coverage_region"],
            public_metadata=duration_draft["public_metadata"],
            validation_metadata=duration_draft["validation_metadata"],
            template=duration_draft["template"], admin_user_id=self.admin,
            content_kind="original_drive",
            original_manifest=duration_draft["original_manifest"],
        )
        with self.assertRaisesRegex(ValueError, "duration does not match"):
            store.get_authored_original_device_preview_manifest(duration_id)

    def test_admin_preview_asset_urls_remain_immutable_after_current_asset_changes(self):
        pack_id = "original_preview_immutable"
        self._save(_ready_payload(), pack_id=pack_id)
        preview = store.get_authored_original_device_preview_manifest(pack_id)
        asset = next(item for item in preview["assets"] if item["kind"] == "narration")
        old_record = store.get_authored_original_asset_record_admin_by_sha256(
            pack_id, asset["id"], asset["sha256"],
        )
        old_bytes = Path(old_record["storage_path"]).read_bytes()

        replacement_transcript = "Replacement narration intentionally not saved into the draft."
        replacement_bytes = _fixture_asset_content(
            {"kind": "narration", "id": asset["id"]}, replacement_transcript,
        )
        replacement_path = Path(self.asset_dir.name) / f"{pack_id}_replacement.wav"
        replacement_path.write_bytes(replacement_bytes)
        replacement_sha = hashlib.sha256(replacement_bytes).hexdigest()
        store.save_authored_original_asset_record(
            pack_id, asset["id"], "narration", "audio/wav",
            str(replacement_path), len(replacement_bytes), replacement_sha, self.admin,
            transcript_sha256=store.original_transcript_sha256(replacement_transcript),
        )

        preserved = store.get_authored_original_asset_record_admin_by_sha256(
            pack_id, asset["id"], asset["sha256"],
        )
        current = store.get_authored_original_asset_record_admin_by_sha256(
            pack_id, asset["id"], replacement_sha,
        )
        self.assertFalse(bool(preserved["is_current"]))
        self.assertTrue(bool(current["is_current"]))
        self.assertEqual(Path(preserved["storage_path"]).read_bytes(), old_bytes)

        client = TestClient(server.app)
        headers = {"Authorization": f"Bearer {server._make_token(self.admin)}"}
        old_response = client.get(asset["path"], headers=headers)
        self.assertEqual(old_response.status_code, 200)
        self.assertEqual(old_response.content, old_bytes)
        self.assertEqual(old_response.headers["etag"], f'"{asset["sha256"]}"')
        self.assertEqual(
            old_response.headers["cache-control"],
            "private, max-age=31536000, immutable",
        )
        missing_sha = "f" * 64 if asset["sha256"] != "f" * 64 else "e" * 64
        self.assertEqual(
            client.get(
                asset["path"].replace(asset["sha256"], missing_sha), headers=headers,
            ).status_code,
            404,
        )
        with self.assertRaisesRegex(ValueError, "does not match its current"):
            store.get_authored_original_device_preview_manifest(pack_id)

    def test_exact_guest_version_converts_without_substitution_and_owned_update_is_free(self):
        first = self._publish(_ready_payload(price=0, title="Moab Original V1"))
        owner_v1 = store.acquire_authored_original(
            self.user, first["id"], "owner-v1", version=1,
        )

        revised = _ready_payload(price=250, title="Moab Original V2")
        self._save(revised)
        second = store.publish_authored_trip_pack(
            first["id"], self.admin, required_content_kind="original_drive",
        )
        self.assertEqual(second["version"], 2)

        converted = store.create_user(
            "converted-guest@example.com", "converted_guest", "hash", "converted-code",
        )
        with patch.dict(os.environ, {"TRAILHEAD_ORIGINALS_ENABLED": "1"}):
            guest_v1 = asyncio.run(api_acquire_original(first["id"], None, None, 1))
            converted_v1 = asyncio.run(api_acquire_original(
                first["id"], "converted-v1", {"id": converted}, 1,
            ))
        self.assertTrue(guest_v1["guest_access"])
        self.assertEqual(guest_v1["pack"]["version"], 1)
        self.assertTrue(guest_v1["pack"]["free"])
        self.assertEqual(converted_v1["entitlement"]["version"], 1)
        self.assertEqual(converted_v1["entitlement"]["credits_charged"], 0)

        store.add_credits(self.user, 250, "Balance must survive owned version update")
        update = store.acquire_authored_original(
            self.user, first["id"], "owner-v2-update", version=2,
        )
        self.assertEqual(update["entitlement"]["acquisition_type"], "version_update")
        self.assertEqual(update["entitlement"]["credits_charged"], 0)
        self.assertEqual(update["credit_balance"], 250)
        self.assertNotEqual(update["trip"]["trip_id"], owner_v1["trip"]["trip_id"])

        restored = store.restore_owned_authored_originals(self.user)
        self.assertEqual({item["entitlement"]["version"] for item in restored}, {1, 2})
        self.assertEqual(
            {item["trip"]["experience_ref"]["version"] for item in restored}, {1, 2},
        )

        new_buyer = store.create_user(
            "new-v2-buyer@example.com", "new_v2_buyer", "hash", "new-v2-code",
        )
        store.add_credits(new_buyer, 250, "V2 purchase balance")
        purchase = store.acquire_authored_original(
            new_buyer, first["id"], "new-buyer-v2", version=2,
        )
        self.assertEqual(purchase["entitlement"]["acquisition_type"], "purchase")
        self.assertEqual(purchase["entitlement"]["credits_charged"], 250)

    def test_explorer_featured_original_claim_is_version_pinned_and_monthly_shared(self):
        first = self._publish(_ready_payload(price=500, title="Featured Original V1"))
        month = store._utc_month()
        store.select_featured_original(month, first["id"], self.admin, version=1)
        self._save(_ready_payload(price=500, title="Featured Original V2"))
        store.publish_authored_trip_pack(
            first["id"], self.admin, required_content_kind="original_drive",
        )

        store.save_authored_trip_pack_draft(
            pack_id="same_month_legacy",
            slug="same-month-legacy",
            title="Same-month legacy feature",
            summary="Verifies one Explorer featured claim across authored lanes.",
            price_credits=250,
            coverage_region="north_america",
            public_metadata={},
            validation_metadata={check: True for check in store.TRIP_PACK_VALIDATION_CHECKS},
            template=_legacy_template(),
            admin_user_id=self.admin,
        )
        legacy = store.publish_authored_trip_pack(
            "same_month_legacy", self.admin, required_content_kind="trip_pack",
        )
        store.select_featured_trip_pack(month, legacy["id"], self.admin)

        explorer = store.create_user(
            "featured-original@example.com", "featured_original", "hash", "featured-code",
        )
        store.set_user_plan(
            explorer, "com.trailhead.explorer.monthly.v2", int(time.time()) + 30 * 86400,
        )
        claim = store.claim_featured_authored_original(
            explorer, "featured-original-claim", month,
        )
        self.assertEqual(claim["entitlement"]["version"], 1)
        self.assertEqual(claim["entitlement"]["acquisition_type"], "featured_claim")
        self.assertEqual(claim["entitlement"]["credits_charged"], 0)
        with self.assertRaises(store.MonthlyTripPackClaimUsedError):
            store.claim_featured_authored_trip_pack(
                explorer, "same-month-legacy-claim", month,
            )

    def test_publish_validation_rejects_unverified_or_mismatched_assets(self):
        unverified = _ready_payload()
        self._save(unverified, pack_id="original_unverified", verify_assets=False)
        validation = store.validate_authored_original_draft("original_unverified")
        self.assertFalse(validation["publish_ready"])
        self.assertIn("needs a server-verified upload", " ".join(validation["issues"]))
        with self.assertRaisesRegex(ValueError, "server-verified upload"):
            store.publish_authored_trip_pack(
                "original_unverified", self.admin, required_content_kind="original_drive",
            )

        self._save(_ready_payload(), pack_id="original_mismatch")
        draft = store.get_authored_trip_pack_admin("original_mismatch", "original_drive")
        draft["original_manifest"]["assets"][0]["bytes"] += 1
        store.save_authored_trip_pack_draft(
            pack_id=draft["id"], slug=draft["slug"], title=draft["title"],
            summary=draft["summary"], price_credits=draft["price_credits"],
            coverage_region=draft["coverage_region"], public_metadata=draft["public_metadata"],
            validation_metadata=draft["validation_metadata"], template=draft["template"],
            admin_user_id=self.admin, content_kind="original_drive",
            original_manifest=draft["original_manifest"],
        )
        validation = store.validate_authored_original_draft("original_mismatch")
        self.assertIn("does not match its server-verified upload", " ".join(validation["issues"]))

        transcript_mismatch = _ready_payload()
        self._save(transcript_mismatch, pack_id="original_transcript_mismatch")
        draft = store.get_authored_trip_pack_admin("original_transcript_mismatch", "original_drive")
        draft["original_manifest"]["stops"][0]["transcript"] = "A different reviewed caption than the attached narration."
        store.save_authored_trip_pack_draft(
            pack_id=draft["id"], slug=draft["slug"], title=draft["title"],
            summary=draft["summary"], price_credits=draft["price_credits"],
            coverage_region=draft["coverage_region"], public_metadata=draft["public_metadata"],
            validation_metadata=draft["validation_metadata"], template=draft["template"],
            admin_user_id=self.admin, content_kind="original_drive",
            original_manifest=draft["original_manifest"],
        )
        validation = store.validate_authored_original_draft("original_transcript_mismatch")
        self.assertIn("does not match its reviewed transcript", " ".join(validation["issues"]))

        malformed_path = Path(self.asset_dir.name) / "malformed.wav"
        malformed_path.write_bytes(b"RIFF\x00\x00\x00\x00WAVEbad")
        with self.assertRaisesRegex(ValueError, "decodable WAV"):
            store.save_authored_original_asset_record(
                "original_transcript_mismatch", "malformed_audio", "narration", "audio/wav",
                str(malformed_path), malformed_path.stat().st_size,
                hashlib.sha256(malformed_path.read_bytes()).hexdigest(), self.admin,
                transcript_sha256=store.original_transcript_sha256("Reviewed script"),
            )

    def test_manifest_geography_month_timestamp_citation_and_bearing_fail_closed(self):
        bad_bounds = _ready_payload()
        bad_bounds["manifest"]["offline_map"]["bounds"]["west"] = -109.50
        with self.assertRaisesRegex(ValueError, "offline map bounds must contain"):
            self._save(bad_bounds, pack_id="original_bad_bounds", verify_assets=False)

        duplicate_months = _ready_payload()
        duplicate_months["manifest"]["season"]["recommended_months"] = [3, 3, 9]
        with self.assertRaisesRegex(ValueError, "months must be unique"):
            self._save(duplicate_months, pack_id="original_duplicate_months", verify_assets=False)

        invalid_month = _ready_payload()
        invalid_month["manifest"]["season"]["recommended_months"] = [0, 13]
        with self.assertRaises((ValueError, ValidationError)):
            AuthoredOriginalDraftRequest.model_validate(invalid_month)
        with self.assertRaisesRegex(ValueError, "months must be integers"):
            self._save(invalid_month, pack_id="original_invalid_month", verify_assets=False)

        future_review = _ready_payload()
        future_review["manifest"]["review"]["field_drive_completed_at"] = "2999-01-01T00:00:00Z"
        with self.assertRaisesRegex(ValueError, "accepted review window"):
            self._save(future_review, pack_id="original_future_review", verify_assets=False)

        stale_review = _ready_payload()
        stale_review["manifest"]["review"]["source_review_completed_at"] = "2000-01-01T00:00:00Z"
        self._save(stale_review, pack_id="original_stale_review")
        validation = store.validate_authored_original_draft("original_stale_review")
        self.assertIn("source review is too old", " ".join(validation["issues"]))

        invalid_bearing = _ready_payload()
        invalid_bearing["manifest"]["stops"][0]["trigger"]["approach_bearing_deg"] = 360
        with self.assertRaises(ValidationError):
            AuthoredOriginalDraftRequest.model_validate(invalid_bearing)
        with self.assertRaisesRegex(ValueError, "less than 360"):
            self._save(invalid_bearing, pack_id="original_bad_bearing", verify_assets=False)

        missing_citation_review = _ready_payload()
        del missing_citation_review["manifest"]["stops"][0]["citations"][0]["reviewed_at"]
        self._save(missing_citation_review, pack_id="original_citation_review")
        validation = store.validate_authored_original_draft("original_citation_review")
        self.assertIn("citations need a reviewed_at date", " ".join(validation["issues"]))

        unresolved_safety = _ready_payload()
        unresolved_safety["manifest"]["safety"]["emergency_note"] = "DRAFT — replace with reviewed guidance."
        self._save(unresolved_safety, pack_id="original_unresolved_safety")
        validation = store.validate_authored_original_draft("original_unresolved_safety")
        self.assertIn("publish content is unresolved", " ".join(validation["issues"]))

    def test_publish_rejects_false_route_distance_off_route_stops_and_reordered_cues(self):
        false_distance = _ready_payload()
        false_distance["manifest"]["route"]["distance_m"] *= 2
        self._save(false_distance, pack_id="original_false_distance")
        validation = store.validate_authored_original_draft("original_false_distance")
        self.assertIn("distance must match", " ".join(validation["issues"]))

        false_duration = _ready_payload()
        false_duration["manifest"]["route"]["duration_s"] = 1
        self._save(false_duration, pack_id="original_false_duration")
        validation = store.validate_authored_original_draft("original_false_duration")
        self.assertIn("duration must be plausible", " ".join(validation["issues"]))

        off_route = _ready_payload()
        off_route["manifest"]["stops"][4]["coordinates"]["lat"] += 0.01
        self._save(off_route, pack_id="original_off_route")
        validation = store.validate_authored_original_draft("original_off_route")
        self.assertIn("outside its authored trigger radius", " ".join(validation["issues"]))

        reordered = _ready_payload()
        first = reordered["manifest"]["stops"][1]["trigger"]
        second = reordered["manifest"]["stops"][2]["trigger"]
        first["route_progress_start_m"], second["route_progress_start_m"] = (
            second["route_progress_start_m"], first["route_progress_start_m"],
        )
        first["route_progress_end_m"], second["route_progress_end_m"] = (
            second["route_progress_end_m"], first["route_progress_end_m"],
        )
        self._save(reordered, pack_id="original_reordered_cues")
        validation = store.validate_authored_original_draft("original_reordered_cues")
        self.assertTrue(any(
            "progress window" in issue or "monotonically" in issue
            for issue in validation["issues"]
        ))

    def test_original_asset_write_rejects_path_traversal_before_touching_disk(self):
        root = Path(self.asset_dir.name) / "server-root"
        with patch.object(server, "ORIGINALS_ASSET_DIR", root):
            with self.assertRaisesRegex(ValueError, "canonical identifiers"):
                server._persist_original_asset_bytes(
                    "..", "escape", "narration", "audio/mpeg", b"ID3safe",
                    "escape.mp3", self.admin,
                )
        self.assertFalse(root.exists())

    def test_new_already_owned_key_is_reserved_against_other_originals(self):
        first = self._publish()
        second = self._publish(
            _ready_payload(price=250, title="Second verified Original"),
            pack_id="original_second",
        )
        store.acquire_authored_original(self.user, first["id"], "original-first-key")
        already_owned = store.acquire_authored_original(
            self.user, first["id"], "original-reserved-key",
        )
        replay = store.acquire_authored_original(
            self.user, first["id"], "original-reserved-key",
        )
        self.assertTrue(already_owned["already_owned"])
        self.assertFalse(already_owned["replayed"])
        self.assertTrue(replay["replayed"])

        store.add_credits(self.user, 250, "Second Original balance")
        with self.assertRaises(store.OriginalAcquisitionConflictError):
            store.acquire_authored_original(
                self.user, second["id"], "original-reserved-key",
            )
        self.assertEqual(store.get_user_by_id(self.user)["credits"], 250)

    def test_original_credit_error_and_ledger_are_original_branded(self):
        paid = self._publish(_ready_payload(price=250))
        with patch.dict(os.environ, {"TRAILHEAD_ORIGINALS_ENABLED": "1"}):
            with self.assertRaises(HTTPException) as payment:
                asyncio.run(api_acquire_original(
                    paid["id"], "original-insufficient", {"id": self.user},
                ))
        self.assertEqual(payment.exception.status_code, 402)
        self.assertEqual(payment.exception.detail["code"], "original_credits")
        self.assertIn("Trailhead Original", payment.exception.detail["message"])

        store.add_credits(self.user, 250, "Original purchase balance")
        store.acquire_authored_original(self.user, paid["id"], "original-paid-ledger")
        debits = [row for row in store.get_credit_history(self.user) if row["amount"] < 0]
        self.assertEqual(debits[0]["reason"], f"Trailhead Original: {paid['title']}")

    def test_published_asset_is_content_addressed_and_access_controlled(self):
        free = self._publish()
        manifest = store.get_published_original_manifest(free["id"], 1)
        asset = manifest["assets"][0]
        record = store.get_published_original_asset_record(
            free["id"], asset["id"], asset["sha256"], None,
        )
        self.assertEqual(asset["path"], record["public_path"])
        self.assertEqual(Path(record["storage_path"]).read_bytes()[:4], b"RIFF")

    def test_free_acquisition_is_idempotent_and_injects_immutable_provenance(self):
        published = self._publish()

        acquired = store.acquire_authored_original(
            self.user, published["id"], "free-moab-acquire",
        )
        replay = store.acquire_authored_original(
            self.user, published["id"], "free-moab-acquire",
        )

        self.assertEqual(acquired["entitlement"]["acquisition_type"], "free")
        self.assertEqual(acquired["entitlement"]["credits_charged"], 0)
        self.assertEqual(acquired["credit_balance"], 0)
        self.assertEqual(replay["entitlement"]["id"], acquired["entitlement"]["id"])
        self.assertTrue(replay["replayed"])
        self.assertEqual(acquired["trip"]["source"], f"trailhead_original:{published['id']}:v1")
        self.assertEqual(acquired["trip"]["experience_ref"], {
            "kind": "trailhead_original",
            "pack_id": published["id"],
            "version": 1,
            "manifest_id": f"original_manifest_{published['id']}_v1",
        })
        self.assertFalse([
            tx for tx in store.get_credit_history(self.user)
            if tx["amount"] <= 0
        ])

        with self.assertRaisesRegex(ValueError, "server-owned"):
            store.upsert_trip_document_v2(
                self.user,
                acquired["trip"]["trip_id"],
                acquired["trip"],
                expected_revision=1,
                idempotency_key="spoof-original-provenance",
            )
        editable = copy.deepcopy(acquired["trip"])
        editable.pop("experience_ref")
        editable["summary"] = "User-edited private itinerary summary."
        updated = store.upsert_trip_document_v2(
            self.user,
            acquired["trip"]["trip_id"],
            editable,
            expected_revision=1,
            idempotency_key="edit-original-clone",
        )
        self.assertEqual(updated["experience_ref"], acquired["trip"]["experience_ref"])

    def test_paid_manifest_requires_the_exact_pinned_entitlement(self):
        paid = self._publish(_ready_payload(price=250))
        self.assertFalse(store.validate_original_analytics_dimensions(
            paid["id"], paid["version"], "moab_story_01", None,
        ))
        with self.assertRaises(store.OriginalManifestAccessError):
            store.get_published_original_manifest(paid["id"], paid["version"])
        with self.assertRaises(store.OriginalManifestAccessError):
            store.get_published_original_manifest(
                paid["id"], paid["version"], user_id=self.user,
            )

        store.add_credits(self.user, 250, "Paid Original test balance")
        acquired = store.acquire_authored_original(
            self.user, paid["id"], "paid-original-acquire",
        )
        manifest = store.get_published_original_manifest(
            paid["id"], paid["version"], user_id=self.user,
        )

        self.assertEqual(acquired["entitlement"]["credits_charged"], 250)
        self.assertEqual(manifest["version"], paid["version"])
        self.assertTrue(store.validate_original_analytics_dimensions(
            paid["id"], paid["version"], "moab_story_01", self.user,
        ))

    def test_paid_original_reuses_explorer_twenty_percent_discount(self):
        paid = self._publish(_ready_payload(price=500))
        explorer = store.create_user(
            "original-explorer@example.com",
            "original_explorer",
            "hash",
            "original-explorer-code",
        )
        store.set_user_plan(
            explorer,
            "com.trailhead.explorer.monthly.v2",
            int(time.time()) + 30 * 86400,
        )
        store.add_credits(explorer, 400, "Explorer Original balance")

        acquired = store.acquire_authored_original(
            explorer, paid["id"], "explorer-original-acquire",
        )

        self.assertEqual(acquired["entitlement"]["list_price_credits"], 500)
        self.assertEqual(acquired["entitlement"]["explorer_discount"], 100)
        self.assertEqual(acquired["entitlement"]["credits_charged"], 400)
        self.assertEqual(acquired["credit_balance"], 0)

    def test_restore_keeps_entitlement_version_and_original_provenance(self):
        published = self._publish()
        acquired = store.acquire_authored_original(
            self.user, published["id"], "restore-original-acquire",
        )
        old_trip_id = acquired["trip"]["trip_id"]
        db = store._conn()
        db.execute(
            "UPDATE trip_documents_v2 SET status='deleted',deleted_at=? WHERE user_id=? AND id=?",
            (int(time.time()), self.user, old_trip_id),
        )
        db.commit()
        db.close()

        restored = store.restore_owned_authored_originals(self.user)[0]

        self.assertEqual(restored["entitlement"]["version"], 1)
        self.assertNotEqual(restored["trip"]["trip_id"], old_trip_id)
        self.assertEqual(restored["trip"]["experience_ref"]["version"], 1)

    def test_original_and_trip_pack_feature_slots_do_not_collide(self):
        original = self._publish()
        store.save_authored_trip_pack_draft(
            pack_id="featured_legacy",
            slug="featured-legacy",
            title="Featured legacy pack",
            summary="Legacy feature slot test.",
            price_credits=250,
            coverage_region="north_america",
            public_metadata={},
            validation_metadata={check: True for check in store.TRIP_PACK_VALIDATION_CHECKS},
            template=_legacy_template(),
            admin_user_id=self.admin,
        )
        legacy = store.publish_authored_trip_pack(
            "featured_legacy", self.admin, required_content_kind="trip_pack",
        )
        month = store._utc_month()

        store.select_featured_trip_pack(month, legacy["id"], self.admin)
        store.select_featured_original(month, original["id"], self.admin)

        self.assertEqual(store.get_featured_trip_pack()["id"], legacy["id"])
        self.assertEqual(store.get_featured_original()["id"], original["id"])

    def test_public_api_flag_guest_claim_and_manifest_contract(self):
        free = self._publish()
        with patch.dict(os.environ, {"TRAILHEAD_ORIGINALS_ENABLED": "1"}):
            catalog = asyncio.run(api_public_originals(50, "", "", None))
            guest = asyncio.run(api_acquire_original(free["id"], None, None))
            manifest = asyncio.run(api_original_manifest(free["id"], 1, None))
            self.assertTrue(server.get_config()["originals_enabled"])

        self.assertEqual(catalog["items"][0]["content_kind"], "original_drive")
        self.assertTrue(guest["guest_access"])
        self.assertEqual(guest["access_type"], "guest_free")
        self.assertEqual(
            guest["manifest_path"],
            f"/api/originals/{free['id']}/versions/1/manifest",
        )
        self.assertEqual(manifest["manifest_id"], f"original_manifest_{free['id']}_v1")

        with patch.dict(os.environ, {"TRAILHEAD_ORIGINALS_ENABLED": "0"}):
            self.assertFalse(server.get_config()["originals_enabled"])
            with self.assertRaises(HTTPException) as gated:
                asyncio.run(api_public_originals(50, "", "", None))
        self.assertEqual(gated.exception.status_code, 404)
        self.assertEqual(gated.exception.detail["code"], "feature_unavailable")

    def test_paid_guest_api_requires_sign_in_and_does_not_leak_manifest(self):
        paid = self._publish(_ready_payload(price=250))
        with patch.dict(os.environ, {"TRAILHEAD_ORIGINALS_ENABLED": "1"}):
            with self.assertRaises(HTTPException) as sign_in:
                asyncio.run(api_acquire_original(paid["id"], None, None))
            with self.assertRaises(HTTPException) as manifest_access:
                asyncio.run(api_original_manifest(paid["id"], 1, None))

        self.assertEqual(sign_in.exception.status_code, 401)
        self.assertEqual(sign_in.exception.detail["code"], "original_sign_in_required")
        self.assertEqual(manifest_access.exception.status_code, 403)
        self.assertEqual(manifest_access.exception.detail["code"], "original_access_required")


if __name__ == "__main__":
    unittest.main()
