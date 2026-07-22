from __future__ import annotations

import base64
import asyncio
import hashlib
import io
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image

from config.settings import settings
from dashboard import server
from db import store


class BackendV110ContractsTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp.name) / "trailhead-test.db")
        settings.db_path = self.db_path
        store.init_db()
        self.password = "correct-horse-battery"
        self.user_id = store.create_user(
            "v110@example.com", "v110_user", server._hash_pw(self.password), "V110-Friend",
        )
        store.add_credits(self.user_id, 40, "Test credits")
        self.other_id = store.create_user(
            "v110-other@example.com", "v110_other", server._hash_pw("other-password"), "V110-Other",
        )
        self.client = TestClient(server.app)
        with server._BRANCH_REFERRAL_CACHE_LOCK:
            server._BRANCH_REFERRAL_CACHE.clear()

    def tearDown(self):
        server.app.dependency_overrides.pop(server._current_user, None)
        server.app.dependency_overrides.pop(server._optional_user, None)
        with server._BRANCH_REFERRAL_CACHE_LOCK:
            server._BRANCH_REFERRAL_CACHE.clear()
        settings.db_path = self.original_db_path
        self.temp.cleanup()

    def _auth_headers(self, user_id: int | None = None) -> dict[str, str]:
        return {"Authorization": f"Bearer {server._make_token(user_id or self.user_id)}"}

    def _seed_place(self) -> str:
        place = store.upsert_canonical_place({
            "name": "Needles Campground",
            "lat": 38.15,
            "lng": -109.75,
            "source": "nps",
            "source_label": "National Park Service",
            "source_place_id": "needles-campground",
            "category": "campground",
        })
        return place["trailhead_place_id"]

    def _seed_trip(self) -> dict:
        return store.upsert_trip_document_v2(
            self.user_id,
            "trip-v110",
            {
                "schema_version": 2,
                "trip_id": "trip-v110",
                "title": "Moab test trip",
                "visibility": "private",
                "route_geometry": {
                    "type": "LineString",
                    "coordinates": [[-109.55, 38.57], [-109.73, 38.71]],
                },
            },
            expected_revision=0,
            idempotency_key="trip-v110-create",
        )

    def test_explicit_migration_is_postchecked_and_repeatable(self):
        store.init_db()
        db = store._conn()
        migration = db.execute(
            "SELECT * FROM schema_migrations WHERE migration_id=?",
            (store.TRAILHEAD_V110_BACKEND_MIGRATION,),
        ).fetchone()
        tables = {
            row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'",
            ).fetchall()
        }
        violations = db.execute("PRAGMA foreign_key_check").fetchall()
        db.close()

        self.assertIsNotNone(migration)
        self.assertTrue({
            "community_ratings", "community_rating_events",
            "offline_bundle_preparations_v2",
            "offline_bundle_artifacts_v2", "trip_brief_and_backup_v1",
            "support_attachments", "account_deletion_authorizations",
        }.issubset(tables))
        self.assertEqual(violations, [])

    def test_community_rating_is_one_editable_value_and_comments_are_separate(self):
        place_id = self._seed_place()
        with patch.dict(os.environ, {"TRAILHEAD_COMMUNITY_RATINGS_ENABLED": "1"}):
            first = self.client.put(
                f"/api/community/ratings/camp/{place_id}",
                json={"rating": 4}, headers=self._auth_headers(),
            )
            edited = self.client.put(
                f"/api/community/ratings/camp/{place_id}",
                json={"rating": 5}, headers=self._auth_headers(),
            )
            second_user = self.client.put(
                f"/api/community/ratings/camp/{place_id}",
                json={"rating": 3}, headers=self._auth_headers(self.other_id),
            )
            removed = self.client.delete(
                f"/api/community/ratings/camp/{place_id}", headers=self._auth_headers(),
            )
            excluded = self.client.put(
                "/api/community/ratings/place/viator:tour-1",
                json={"rating": 5}, headers=self._auth_headers(),
            )

        self.assertEqual(first.json(), {"average": 4.0, "count": 1, "viewer_rating": 4})
        self.assertEqual(edited.json(), {"average": 5.0, "count": 1, "viewer_rating": 5})
        self.assertEqual(second_user.json()["count"], 2)
        self.assertEqual(removed.json(), {"average": 3.0, "count": 1, "viewer_rating": None})
        self.assertEqual(excluded.status_code, 400)

    def test_community_rating_retries_are_idempotent_and_mutations_are_rate_limited(self):
        place_id = self._seed_place()
        with patch.dict(os.environ, {"TRAILHEAD_COMMUNITY_RATINGS_ENABLED": "1"}):
            created = self.client.put(
                f"/api/community/ratings/place/{place_id}",
                json={"rating": 4}, headers=self._auth_headers(),
            )
            retried = self.client.put(
                f"/api/community/ratings/place/{place_id}",
                json={"rating": 4}, headers=self._auth_headers(),
            )
            db = store._conn()
            event_count = db.execute(
                "SELECT COUNT(*) FROM community_rating_events WHERE user_id=?",
                (self.user_id,),
            ).fetchone()[0]
            now = int(time.time())
            db.executemany(
                """INSERT INTO community_rating_events
                   (user_id,entity_kind,entity_id,action,created_at)
                   VALUES (?,?,?,?,?)""",
                [
                    (self.user_id, "place", place_id, "set", now)
                    for _ in range(store.COMMUNITY_RATING_MUTATION_LIMIT_PER_HOUR - event_count)
                ],
            )
            db.commit(); db.close()
            limited = self.client.put(
                f"/api/community/ratings/place/{place_id}",
                json={"rating": 5}, headers=self._auth_headers(),
            )

        self.assertEqual(created.status_code, 200)
        self.assertEqual(retried.status_code, 200)
        self.assertEqual(event_count, 1)
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(
            store.get_community_rating_summary("place", place_id, self.user_id)["viewer_rating"],
            4,
        )

    def test_offline_job_status_and_private_range_delivery(self):
        request = {
            "bounds": {"west": -109.8, "south": 38.4, "east": -109.4, "north": 38.8},
            "min_zoom": 8,
            "max_zoom": 14,
            "options": {},
        }
        preparation, _ = store.create_or_get_offline_bundle_preparation_v2(
            self.user_id, request,
        )
        self.assertTrue(store.claim_offline_bundle_preparation_v2(preparation["id"], self.user_id))
        # Artifact delivery is intentionally independent of the manifest
        # materializer. Mark this fixture ready without forging an incomplete
        # manifest that the public response model would correctly reject.
        db = store._conn()
        db.execute(
            """
            UPDATE offline_bundle_preparations_v2
            SET status = 'ready', progress = 100, bundle_id = ?, revision = ?,
                manifest_json = NULL, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            ("offline-test", "v2-test", int(time.time()), preparation["id"], self.user_id),
        )
        db.commit()
        root = Path(self.temp.name) / "artifacts"
        root.mkdir()
        artifact_path = root / "places.sqlite"
        payload = b"immutable-offline-artifact"
        artifact_path.write_bytes(payload)
        digest = hashlib.sha256(payload).hexdigest()
        store.register_offline_bundle_artifact_v2(
            preparation["id"], "offline-test-places", "places", str(artifact_path),
            "application/x-sqlite3", len(payload), digest, 1,
        )

        with patch.dict(os.environ, {
            "OFFLINE_BUNDLE_V2_ENABLED": "1",
            "TRAILHEAD_OFFLINE_ARTIFACT_ROOT": str(root),
        }):
            status = self.client.get(
                f"/api/offline/bundles/preparations/{preparation['id']}",
                headers=self._auth_headers(),
            )
            partial = self.client.get(
                f"/api/offline/bundles/{preparation['id']}/artifacts/offline-test-places",
                headers={**self._auth_headers(), "Range": "bytes=2-9"},
            )
            unchanged = self.client.get(
                f"/api/offline/bundles/{preparation['id']}/artifacts/offline-test-places",
                headers={**self._auth_headers(), "If-None-Match": f'"{digest}"'},
            )
            private = self.client.get(
                f"/api/offline/bundles/{preparation['id']}/artifacts/offline-test-places",
                headers=self._auth_headers(self.other_id),
            )

        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["status"], "ready")
        self.assertEqual(partial.status_code, 206)
        self.assertEqual(partial.content, payload[2:10])
        self.assertEqual(partial.headers["etag"], f'"{digest}"')
        self.assertEqual(unchanged.status_code, 304)
        self.assertEqual(private.status_code, 404)

    def test_brief_and_backup_keeps_legacy_fallback_and_does_not_charge_without_evidence(self):
        trip = self._seed_trip()
        headers = {**self._auth_headers(), "Idempotency-Key": "brief-v110-once"}
        empty_evidence = {
            "evidence_revision": "not-checked",
            "service_segments": [], "exits": [], "timeline_media": [],
        }
        with (
            patch.dict(os.environ, {"TRAILHEAD_BRIEF_AND_BACKUP_ENABLED": "1"}),
            patch.object(
                server, "_materialize_route_evidence_v1",
                new=AsyncMock(return_value=empty_evidence),
            ),
        ):
            first = self.client.post(
                "/api/trips/trip-v110/brief-and-backup",
                json={"expected_trip_revision": trip["revision"]}, headers=headers,
            )
            second = self.client.post(
                "/api/trips/trip-v110/brief-and-backup",
                json={"expected_trip_revision": trip["revision"]}, headers=headers,
            )
            other = self.client.post(
                "/api/trips/trip-v110/brief-and-backup",
                json={}, headers={**self._auth_headers(self.other_id), "Idempotency-Key": "other-brief"},
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(first.json()["status"], "not_checked")
        self.assertFalse(first.json()["evidence_available"])
        self.assertTrue(first.json()["legacy_fallback_recommended"])
        self.assertEqual(first.json()["checks"]["mobile_service"], "not_checked")
        self.assertEqual(other.status_code, 404)
        self.assertEqual(store.get_user_by_id(self.user_id)["credits"], 40)

    def test_brief_and_backup_materializes_trusted_sources_and_charges_once(self):
        trip = self._seed_trip()
        headers = {**self._auth_headers(), "Idempotency-Key": "brief-v110-evidence"}
        route_place = {
            "id": "place:osm:moab-fuel",
            "trailhead_place_id": "place:osm:moab-fuel",
            "name": "Moab fuel stop",
            "lat": 38.61,
            "lng": -109.62,
            "type": "fuel",
            "category": "fuel",
            "source": "osm",
            "source_label": "OpenStreetMap contributors",
            "official_url": "https://www.openstreetmap.org/",
            "last_refreshed_at": int(time.time()),
        }
        coverage = {
            "records": [{
                "provider": "Test carrier",
                "technology": "4G LTE",
                "availability_class": "crowdsourced_fair",
                "sample_count": 4,
                "data_date": "2026-07-01",
                "source": "fcc_vizmo",
                "source_label": "FCC crowdsourced speed tests",
            }],
            "last_checked": int(time.time()),
        }
        with (
            patch.dict(os.environ, {"TRAILHEAD_BRIEF_AND_BACKUP_ENABLED": "1"}),
            patch.object(
                server, "_build_route_intelligence",
                new=AsyncMock(return_value={"places": [route_place]}),
            ),
            patch.object(
                server, "get_mobile_coverage", new=AsyncMock(return_value=coverage),
            ),
        ):
            first = self.client.post(
                "/api/trips/trip-v110/brief-and-backup",
                json={"expected_trip_revision": trip["revision"]}, headers=headers,
            )
            second = self.client.post(
                "/api/trips/trip-v110/brief-and-backup",
                json={"expected_trip_revision": trip["revision"]}, headers=headers,
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(first.json()["status"], "partially_checked")
        self.assertTrue(first.json()["evidence_available"])
        self.assertFalse(first.json()["legacy_fallback_recommended"])
        self.assertEqual(first.json()["checks"]["mobile_service"], "observations_found")
        self.assertEqual(first.json()["checks"]["exits"], "references_found")
        self.assertEqual(
            first.json()["service_segments"][0]["source_label"],
            "FCC crowdsourced speed tests",
        )
        self.assertEqual(first.json()["exits"][0]["availability"], "not_checked")
        self.assertEqual(store.get_user_by_id(self.user_id)["credits"], 32)

    def test_support_attachment_is_sanitized_private_and_diagnostics_are_allowlisted(self):
        image = Image.new("RGB", (20, 20), (180, 90, 50))
        encoded = io.BytesIO()
        image.save(encoded, format="JPEG", exif=b"private-location-metadata")
        upload = self.client.post(
            "/api/support/attachments",
            json={
                "content_type": "image/jpeg",
                "data_base64": base64.b64encode(encoded.getvalue()).decode("ascii"),
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(upload.status_code, 200)
        attachment_ref = upload.json()["attachment_ref"]
        message = self.client.post(
            "/api/support/inbox/message",
            json={
                "subject": "Map display issue",
                "body": "The map card overlaps the bottom action.",
                "attachment_refs": [attachment_ref],
                "diagnostic_consent": True,
                "diagnostics": {
                    "platform": "android",
                    "runtime_version": "native-1.0.10-android.1",
                    "network_state": "online",
                    "error_codes": ["MAP_SHEET_LAYOUT"],
                    "lat": 38.5733,
                    "support_message": "private text",
                },
            },
            headers=self._auth_headers(),
        )
        thread = self.client.get(
            f"/api/support/threads/{message.json()['thread_id']}",
            headers=self._auth_headers(),
        )
        attachment = self.client.get(
            f"/api/support/attachments/{attachment_ref}", headers=self._auth_headers(),
        )
        private = self.client.get(
            f"/api/support/attachments/{attachment_ref}", headers=self._auth_headers(self.other_id),
        )

        self.assertEqual(message.status_code, 200)
        stored_message = thread.json()["messages"][0]
        self.assertEqual(stored_message["attachments"][0]["attachment_ref"], attachment_ref)
        self.assertEqual(stored_message["meta"]["diagnostics"]["platform"], "android")
        self.assertNotIn("lat", stored_message["meta"]["diagnostics"])
        self.assertNotIn("support_message", stored_message["meta"]["diagnostics"])
        self.assertEqual(attachment.status_code, 200)
        self.assertNotIn(b"private-location-metadata", attachment.content)
        self.assertEqual(private.status_code, 404)

    def test_support_attachment_uploads_are_rate_limited_server_side(self):
        now = int(time.time())
        db = store._conn()
        db.executemany(
            """INSERT INTO support_attachments
               (id,user_id,content_type,byte_count,sha256,image_data,created_at)
               VALUES (?,?,?,?,?,?,?)""",
            [
                (
                    f"sat_test_limit_{index}", self.user_id, "image/jpeg", 1,
                    hashlib.sha256(b"x").hexdigest(), b"x", now,
                )
                for index in range(12)
            ],
        )
        db.commit(); db.close()
        image = Image.new("RGB", (5, 5), (180, 90, 50))
        encoded = io.BytesIO()
        image.save(encoded, format="JPEG")
        response = self.client.post(
            "/api/support/attachments",
            json={
                "content_type": "image/jpeg",
                "data_base64": base64.b64encode(encoded.getvalue()).decode("ascii"),
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(response.status_code, 429)

    def test_heic_support_attachment_is_decoded_and_reencoded_without_metadata(self):
        import pillow_heif

        image = Image.new("RGB", (20, 20), (45, 95, 130))
        encoded = io.BytesIO()
        pillow_heif.from_pillow(image).save(encoded, exif=b"private-heic-metadata")
        upload = self.client.post(
            "/api/support/attachments",
            json={
                "content_type": "image/heic",
                "data_base64": base64.b64encode(encoded.getvalue()).decode("ascii"),
            },
            headers=self._auth_headers(),
        )
        self.assertEqual(upload.status_code, 200)
        self.assertEqual(upload.json()["content_type"], "image/jpeg")

        attachment = self.client.get(
            f"/api/support/attachments/{upload.json()['attachment_ref']}",
            headers=self._auth_headers(),
        )
        self.assertEqual(attachment.status_code, 200)
        self.assertEqual(attachment.headers["content-type"], "image/jpeg")
        self.assertNotIn(b"private-heic-metadata", attachment.content)
        with Image.open(io.BytesIO(attachment.content)) as decoded:
            self.assertEqual(decoded.format, "JPEG")
            self.assertEqual(decoded.size, (20, 20))

    def test_referral_summary_and_landing_do_not_expose_referrer_identity(self):
        response = self.client.get("/api/referrals/me", headers=self._auth_headers())
        landing = self.client.get("/r/V110-Friend")
        missing = self.client.get("/r/not-a-real-code")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["share_url"], "https://gettrailhead.app/r/V110-Friend")
        self.assertEqual(landing.status_code, 200)
        self.assertIn("V110-Friend", landing.text)
        self.assertNotIn("v110@example.com", landing.text)
        self.assertNotIn("v110_user", landing.text)
        self.assertEqual(missing.status_code, 404)

    def test_referral_landing_uses_minimal_branded_branch_handoff_and_cache(self):
        alias_secret = "branch-alias-test-secret-0123456789abcdef"
        alias = server._branch_referral_alias("V110-Friend", alias_secret)
        branch_url = f"https://go.gettrailhead.app/{alias}"
        request = AsyncMock(return_value=branch_url)
        with (
            patch.object(settings, "branch_referral_handoff_enabled", True),
            patch.object(settings, "branch_live_key", "key_test_1234567890abcdef"),
            patch.object(settings, "branch_link_domain", "go.gettrailhead.app"),
            patch.object(settings, "branch_referral_alias_secret", alias_secret),
            patch.object(server, "_request_branch_referral_url", request),
        ):
            first = self.client.get("/r/V110-Friend")
            second = self.client.get("/r/V110-Friend")
            with server._BRANCH_REFERRAL_CACHE_LOCK:
                server._BRANCH_REFERRAL_CACHE.clear()
            after_restart = self.client.get("/r/V110-Friend")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(after_restart.status_code, 200)
        self.assertIn(branch_url, first.text)
        self.assertIn("V110-Friend", first.text)
        self.assertNotIn("v110@example.com", first.text)
        self.assertNotIn("v110_user", first.text)
        self.assertEqual(request.await_count, 2)
        payload, expected_domain = request.await_args.args
        self.assertEqual(expected_domain, "go.gettrailhead.app")
        self.assertEqual(payload["alias"], alias)
        self.assertNotIn("V110-Friend", payload["alias"])
        self.assertNotIn(alias_secret, json.dumps(payload, sort_keys=True))
        self.assertEqual(payload["feature"], "referral")
        self.assertEqual(payload["channel"], "trailhead_referral")
        self.assertEqual(
            set(payload["data"]),
            {
                "referral_code", "$deeplink_path", "$canonical_url",
                "$desktop_url", "$fallback_url", "$ios_url", "$android_url",
            },
        )
        self.assertEqual(payload["data"]["referral_code"], "V110-Friend")
        serialized = json.dumps(payload["data"], sort_keys=True)
        for forbidden in (
            "email", "username", "identity", "location", "latitude", "longitude",
            "search", "support", "purchase", "payout",
        ):
            self.assertNotIn(forbidden, serialized.lower())

    def test_referral_landing_fails_closed_to_visible_manual_fallback(self):
        request = AsyncMock(side_effect=RuntimeError("provider unavailable"))
        with (
            patch.object(settings, "branch_referral_handoff_enabled", True),
            patch.object(settings, "branch_live_key", "key_live_1234567890abcdef"),
            patch.object(settings, "branch_link_domain", "go.gettrailhead.app"),
            patch.object(
                settings,
                "branch_referral_alias_secret",
                "branch-alias-test-secret-0123456789abcdef",
            ),
            patch.object(server, "_request_branch_referral_url", request),
        ):
            first = self.client.get("/r/V110-Friend")
            second = self.client.get("/r/V110-Friend")

        self.assertEqual(first.status_code, 200)
        self.assertIn("V110-Friend", first.text)
        self.assertIn("trailhead://referral?code=V110-Friend", first.text)
        self.assertIn("apps.apple.com/app/id6763677349", first.text)
        self.assertIn("play.google.com/store/apps/details", first.text)
        self.assertNotIn("https://go.gettrailhead.app/", first.text)
        self.assertIn("enter the code shown above", first.text)
        self.assertEqual(request.await_count, 1)

    def test_referral_handoff_requires_explicit_valid_server_configuration(self):
        request = AsyncMock(return_value="https://go.gettrailhead.app/r/opaque")
        with (
            patch.object(settings, "branch_referral_handoff_enabled", True),
            patch.object(settings, "branch_live_key", ""),
            patch.object(settings, "branch_link_domain", "go.gettrailhead.app"),
            patch.object(
                settings,
                "branch_referral_alias_secret",
                "branch-alias-test-secret-0123456789abcdef",
            ),
            patch.object(server, "_request_branch_referral_url", request),
        ):
            landing = self.client.get("/r/V110-Friend")
        self.assertEqual(landing.status_code, 200)
        self.assertIn("trailhead://referral?code=V110-Friend", landing.text)
        request.assert_not_awaited()

        with (
            patch.object(settings, "branch_referral_handoff_enabled", True),
            patch.object(settings, "branch_live_key", "key_live_1234567890abcdef"),
            patch.object(settings, "branch_link_domain", "go.gettrailhead.app"),
            patch.object(settings, "branch_referral_alias_secret", ""),
            patch.object(settings, "secret_key", server._BRANCH_REFERRAL_DEV_SECRET),
            patch.object(server, "_request_branch_referral_url", request),
        ):
            no_server_secret = self.client.get("/r/V110-Friend")
        self.assertIn("trailhead://referral?code=V110-Friend", no_server_secret.text)
        request.assert_not_awaited()

    def test_branch_alias_collision_is_reused_only_after_target_verification(self):
        alias_secret = "branch-alias-test-secret-0123456789abcdef"
        payload = server._branch_referral_request_payload(
            "V110-Friend",
            "key_test_1234567890abcdef",
            "go.gettrailhead.app",
            alias_secret,
        )
        candidate = f"https://go.gettrailhead.app/{payload['alias']}"

        class FakeResponse:
            def __init__(self, status_code, body=None):
                self.status_code = status_code
                self._body = body or {}

            def json(self):
                return self._body

        class FakeClient:
            def __init__(self, stored):
                self.stored = stored
                self.get_calls = []

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, *_args, **_kwargs):
                return FakeResponse(409)

            async def get(self, *_args, **kwargs):
                self.get_calls.append(kwargs)
                return FakeResponse(200, self.stored)

        matching = {
            "feature": payload["feature"],
            "channel": payload["channel"],
            "alias": payload["alias"],
            "data": dict(payload["data"]),
        }
        matching_client = FakeClient(matching)
        with patch.object(server.httpx, "AsyncClient", return_value=matching_client):
            reused = asyncio.run(
                server._request_branch_referral_url(payload, "go.gettrailhead.app")
            )
        self.assertEqual(reused, candidate)
        self.assertEqual(matching_client.get_calls[0]["params"]["url"], candidate)
        self.assertEqual(
            matching_client.get_calls[0]["params"]["branch_key"],
            "key_test_1234567890abcdef",
        )

        hostile = {**matching, "data": {**matching["data"], "referral_code": "OTHER"}}
        with patch.object(server.httpx, "AsyncClient", return_value=FakeClient(hostile)):
            with self.assertRaises(RuntimeError):
                asyncio.run(
                    server._request_branch_referral_url(payload, "go.gettrailhead.app")
                )

    def test_password_deletion_authorization_is_expiring_single_use_and_required(self):
        wrong = self.client.post(
            "/api/auth/deletion-authorization",
            json={"password": "wrong-password"}, headers=self._auth_headers(),
        )
        authorized = self.client.post(
            "/api/auth/deletion-authorization",
            json={"password": self.password}, headers=self._auth_headers(),
        )
        profile = self.client.get("/api/auth/me", headers=self._auth_headers())
        missing = self.client.delete("/api/auth/me", headers=self._auth_headers())

        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(authorized.status_code, 200)
        self.assertEqual(authorized.json()["auth_method"], "password")
        self.assertEqual(profile.json()["auth_method"], "password")
        self.assertNotIn("password_hash", profile.json())
        self.assertEqual(missing.status_code, 401)

        token = authorized.json()["authorization_token"]
        deleted = self.client.delete(
            "/api/auth/me",
            headers={**self._auth_headers(), "X-Trailhead-Deletion-Authorization": token},
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertIsNone(store.get_user_by_id(self.user_id))

        one_use = store.issue_account_deletion_authorization(self.other_id, "password", 300)
        self.assertTrue(store.consume_account_deletion_authorization(
            self.other_id, one_use["authorization_token"],
        ))
        self.assertFalse(store.consume_account_deletion_authorization(
            self.other_id, one_use["authorization_token"],
        ))
        expired = store.issue_account_deletion_authorization(self.other_id, "password", 300)
        db = store._conn()
        db.execute(
            "UPDATE account_deletion_authorizations SET expires_at=? WHERE user_id=?",
            (int(time.time()) - 1, self.other_id),
        )
        db.commit(); db.close()
        self.assertFalse(store.consume_account_deletion_authorization(
            self.other_id, expired["authorization_token"],
        ))

    def test_oauth_deletion_requires_correct_provider_subject_and_fresh_token(self):
        oauth_id = store.create_oauth_user(
            "oauth-delete@example.com", "oauth_delete", server._hash_pw("unused-password"),
            "google", "google-subject-delete",
        )
        headers = self._auth_headers(oauth_id)
        with patch.object(server, "_decode_oauth_token", new=AsyncMock(return_value={
            "sub": "google-subject-delete", "iat": int(time.time()),
        })):
            wrong_provider = self.client.post(
                "/api/auth/deletion-authorization",
                json={"provider": "apple", "identity_token": "token"}, headers=headers,
            )
            correct = self.client.post(
                "/api/auth/deletion-authorization",
                json={"provider": "google", "identity_token": "token"}, headers=headers,
            )
        with patch.object(server, "_decode_oauth_token", new=AsyncMock(return_value={
            "sub": "another-google-account", "iat": int(time.time()),
        })):
            wrong_subject = self.client.post(
                "/api/auth/deletion-authorization",
                json={"provider": "google", "identity_token": "token"}, headers=headers,
            )
        with patch.object(server, "_decode_oauth_token", new=AsyncMock(return_value={
            "sub": "google-subject-delete", "iat": int(time.time()) - 3600,
        })):
            stale = self.client.post(
                "/api/auth/deletion-authorization",
                json={"provider": "google", "identity_token": "token"}, headers=headers,
            )

        self.assertEqual(wrong_provider.status_code, 400)
        self.assertEqual(wrong_subject.status_code, 401)
        self.assertEqual(stale.status_code, 401)
        self.assertEqual(correct.status_code, 200)
        self.assertEqual(correct.json()["auth_method"], "google")


if __name__ == "__main__":
    unittest.main()
