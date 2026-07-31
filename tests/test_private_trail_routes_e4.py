from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from urllib.parse import quote

from fastapi.testclient import TestClient

from config.settings import settings
from dashboard import server
from dashboard.offline_bundles_v2 import OfflineBoundsV2
from dashboard.offline_materializer_v2 import _database_catalog_items_v2
from db import store


class PrivateTrailRoutesE4Tests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        self.temp = tempfile.TemporaryDirectory()
        settings.db_path = str(Path(self.temp.name) / "private-trails-e4.db")
        self.stage_patch = patch.dict(
            os.environ,
            {
                "TRAILHEAD_PRIVATE_TRAIL_ROUTES_STAGE": "public",
                "TRAILHEAD_COMMUNITY_TRAILS_STAGE": "off",
            },
        )
        self.stage_patch.start()
        store.init_db()
        self.user_id = store.create_user(
            "private-route@example.com", "private_route", server._hash_pw("password"), "private-route-code",
        )
        self.other_id = store.create_user(
            "other-route@example.com", "other_route", server._hash_pw("password"), "other-route-code",
        )
        self.admin_id = store.create_user(
            "route-admin@example.com", "route_admin", server._hash_pw("password"), "route-admin-code",
        )
        store.set_user_admin(self.admin_id, True)
        server._anon_buckets.clear()
        server._trail_system_v2_cache.clear()
        self.client = TestClient(server.app)

    def tearDown(self):
        server.app.dependency_overrides.pop(server._current_user, None)
        server._anon_buckets.clear()
        server._trail_system_v2_cache.clear()
        settings.db_path = self.original_db_path
        self.stage_patch.stop()
        self.temp.cleanup()

    def _headers(self, user_id: int | None = None, key: str | None = None) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {server._make_token(user_id or self.user_id)}"}
        if key:
            headers["Idempotency-Key"] = key
        return headers

    @staticmethod
    def _payload(**overrides) -> dict:
        payload = {
            "origin": "builder",
            "title": "Mesa View Loop",
            "description": "A private route.",
            "activity": "hike",
            "route_shape": "loop",
            "geometry": {
                "type": "LineString",
                "coordinates": [[-109.55, 38.57, 1800, 1710000000], [-109.551, 38.571, 1805, 1710000001]],
            },
            "trailheads": [{"name": "Mesa View", "lat": 38.57, "lng": -109.55}],
            "permitted_uses": [],
            "source_evidence": [],
            "photos": [],
        }
        payload.update(overrides)
        return payload

    def _create_route(self, key: str = "create-route") -> dict:
        response = self.client.post(
            "/api/trail-routes", headers=self._headers(key=key), json=self._payload(),
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_migration_is_repeatable_and_postchecked(self):
        store.init_db()
        db = store._conn()
        migration = db.execute(
            "SELECT 1 FROM schema_migrations WHERE migration_id=?",
            (store.EXPLORE_PRIVATE_TRAILS_E4_MIGRATION,),
        ).fetchone()
        columns = {row[1] for row in db.execute("PRAGMA table_info(owned_trail_routes_v1)")}
        mutation_columns = {row[1] for row in db.execute("PRAGMA table_info(trail_route_mutations_v1)")}
        violations = db.execute("PRAGMA foreign_key_check").fetchall()
        db.close()

        self.assertIsNotNone(migration)
        self.assertTrue({
            "revision", "content_revision", "share_route_revision", "share_snapshot_json",
            "share_created_at", "share_updated_at",
        }.issubset(columns))
        self.assertTrue({
            "user_id", "idempotency_key", "operation", "request_hash", "response_json",
        }.issubset(mutation_columns))
        self.assertEqual(violations, [])

    def test_feature_stages_are_user_aware_and_community_defaults_off(self):
        with patch.dict(os.environ, {
            "TRAILHEAD_PRIVATE_TRAIL_ROUTES_STAGE": "internal",
            "TRAILHEAD_COMMUNITY_TRAILS_STAGE": "off",
        }):
            ordinary = self.client.get("/api/product/features", headers=self._headers()).json()
            admin = self.client.get("/api/product/features", headers=self._headers(self.admin_id)).json()
            self.assertFalse(ordinary["private_trail_routes"])
            self.assertFalse(ordinary["community_trails"])
            self.assertTrue(admin["private_trail_routes"])
            self.assertFalse(admin["community_trails"])
            hidden = self.client.get("/api/trail-routes", headers=self._headers())
            self.assertEqual(hidden.status_code, 404)
            self.assertEqual(self.client.get("/api/trail-routes", headers=self._headers(self.admin_id)).status_code, 200)

        with patch.dict(os.environ, {
            "TRAILHEAD_PRIVATE_TRAIL_ROUTES_STAGE": "public",
            "TRAILHEAD_COMMUNITY_TRAILS_STAGE": "public",
        }):
            features = self.client.get("/api/product/features", headers=self._headers()).json()
            self.assertTrue(features["private_trail_routes"])
            self.assertTrue(features["community_trails"])

    def test_create_is_direct_strict_canonical_and_idempotent(self):
        response = self.client.post(
            "/api/trail-routes", headers=self._headers(key="canonical-create"),
            json=self._payload(
                source_evidence=[{
                    "title": "Official trail uses", "publisher": "Land agency",
                    "kind": "permitted_use", "url": "https://agency.example/trails/mesa",
                }],
                permitted_uses=["Hiking", "mountain bike"],
            ),
        )
        self.assertEqual(response.status_code, 201, response.text)
        route = response.json()
        self.assertIn("id", route)
        self.assertNotIn("route", route)
        self.assertEqual(route["activity"], "hiking")
        self.assertEqual(route["permitted_uses"], ["hiking", "mountain_biking"])
        self.assertEqual(route["geometry"]["coordinates"][0], [-109.55, 38.57])
        self.assertEqual(route["revision"], 1)

        replay = self.client.post(
            "/api/trail-routes", headers=self._headers(key="canonical-create"),
            json=self._payload(
                source_evidence=[{
                    "title": "Official trail uses", "publisher": "Land agency",
                    "kind": "permitted_use", "url": "https://agency.example/trails/mesa",
                }],
                permitted_uses=["Hiking", "mountain bike"],
            ),
        )
        self.assertEqual(replay.status_code, 201)
        self.assertEqual(replay.json()["id"], route["id"])

        extra = self.client.post(
            "/api/trail-routes", headers=self._headers(key="extra-create"),
            json={**self._payload(), "device_metadata": {"id": "secret"}},
        )
        self.assertEqual(extra.status_code, 422)

    def test_route_validation_rejects_untrusted_claims_urls_photos_and_jumps(self):
        invalid_cases = [
            self._payload(activity="expert-mode"),
            self._payload(route_shape="creative squiggle"),
            self._payload(permitted_uses=["hiking"]),
            self._payload(trailheads=[{
                "name": "Local", "lat": 38.57, "lng": -109.55,
                "source_url": "https://127.0.0.1/private",
            }]),
            self._payload(trailheads=[{
                "name": "Boolean latitude", "lat": True, "lng": -109.55,
            }]),
            self._payload(trailheads=[{
                "name": "Boolean longitude", "lat": 38.57, "lng": False,
            }]),
            self._payload(photos=[{
                "asset_id": "photo_1", "ownership_confirmed": True,
                "exif": {"device_id": "secret"},
            }]),
            self._payload(geometry={
                "type": "LineString", "coordinates": [[-109.55, 38.57], [-108.55, 38.57]],
            }),
        ]
        for index, payload in enumerate(invalid_cases):
            with self.subTest(index=index):
                response = self.client.post(
                    "/api/trail-routes", headers=self._headers(key=f"invalid-{index}"), json=payload,
                )
                self.assertEqual(response.status_code, 400, response.text)

        route = self._create_route("strict-revision-route")
        bool_revision = self.client.patch(
            f"/api/trail-routes/{route['id']}", headers=self._headers(key="bool-revision"),
            json={"expected_revision": True, "title": "Boolean Revision"},
        )
        self.assertEqual(bool_revision.status_code, 422)

        with patch.dict(os.environ, {
            "TRAILHEAD_PRIVATE_TRAIL_ROUTES_STAGE": "public",
            "TRAILHEAD_COMMUNITY_TRAILS_STAGE": "public",
        }):
            legacy_extra = self.client.post(
                "/api/trails/community", headers=self._headers(),
                json={
                    "name": "Strict Legacy Route",
                    "geometry": self._payload()["geometry"],
                    "trailheads": [{"name": "Start", "lat": 38.57, "lng": -109.55}],
                    "hidden_metadata": {"device_id": "secret"},
                },
            )
        self.assertEqual(legacy_extra.status_code, 422)

    def test_owner_crud_revision_and_wire_shapes(self):
        route = self._create_route("crud-create")
        route_id = route["id"]
        listed = self.client.get("/api/trail-routes?limit=200", headers=self._headers())
        self.assertEqual(listed.status_code, 200, listed.text)
        summary = listed.json()["routes"][0]
        self.assertEqual(summary["id"], route_id)
        self.assertTrue({
            "id", "title", "origin", "revision", "geometry_revision",
            "geometry_sha256", "visibility", "share_enabled",
        }.issubset(summary))
        self.assertFalse({
            "geometry", "description", "trailheads", "permitted_uses",
            "source_evidence", "photos",
        }.intersection(summary))
        self.assertLess(len(json.dumps(summary)), 4096)
        self.assertEqual(self.client.get(
            f"/api/trail-routes/{route_id}", headers=self._headers(self.other_id),
        ).status_code, 404)

        conflict = self.client.patch(
            f"/api/trail-routes/{route_id}", headers=self._headers(key="bad-revision"),
            json={"expected_revision": 2, "title": "Wrong Revision"},
        )
        self.assertEqual(conflict.status_code, 409)

        updated = self.client.patch(
            f"/api/trail-routes/{route_id}", headers=self._headers(key="update-route"),
            json={"expected_revision": 1, "title": "Mesa Rim Loop"},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["revision"], 2)
        self.assertNotIn("route", updated.json())
        replay = self.client.patch(
            f"/api/trail-routes/{route_id}", headers=self._headers(key="update-route"),
            json={"expected_revision": 1, "title": "Mesa Rim Loop"},
        )
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["id"], route_id)

        deleted = self.client.delete(
            f"/api/trail-routes/{route_id}?expected_revision=2",
            headers=self._headers(key="delete-route"),
        )
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(deleted.json(), {"id": route_id, "revision": 3, "deleted": True})
        self.assertEqual(self.client.get(
            f"/api/trail-routes/{route_id}", headers=self._headers(),
        ).status_code, 404)

    def test_unlisted_share_is_one_time_revision_pinned_and_non_enumerable(self):
        route = self._create_route("share-create-route")
        reviewed = self.client.patch(
            f"/api/trail-routes/{route['id']}", headers=self._headers(key="privacy-review"),
            json={"expected_revision": 1, "privacy_reviewed": True},
        ).json()
        fresh = self.client.post(
            f"/api/trail-routes/{route['id']}/share-link",
            headers=self._headers(key="share-link"),
            json={"expected_revision": reviewed["revision"], "mode": "create"},
        )
        self.assertEqual(fresh.status_code, 200, fresh.text)
        body = fresh.json()
        token = body["share_token"]
        self.assertEqual(len(token), 43)
        self.assertFalse(body["link_exists"])
        self.assertFalse(body["rotate_required"])
        self.assertIn("/app/trails/shared#token=", body["share_url"])
        self.assertNotIn(token, body["resolver_path"])

        db = store._conn()
        stored = db.execute(
            "SELECT share_token_hash,share_snapshot_json FROM owned_trail_routes_v1 WHERE id=?",
            (route["id"],),
        ).fetchone()
        ledger = "\n".join(row[0] for row in db.execute(
            "SELECT response_json FROM trail_route_mutations_v1 WHERE user_id=?", (self.user_id,),
        ).fetchall())
        db.close()
        self.assertEqual(stored["share_token_hash"], hashlib.sha256(token.encode("ascii")).hexdigest())
        self.assertNotIn(token, stored["share_snapshot_json"])
        self.assertNotIn(token, ledger)

        resolved = self.client.post("/api/trail-routes/shared/resolve", json={"token": token})
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(resolved.json()["title"], "Mesa View Loop")
        self.assertEqual(self.client.post(
            "/api/trail-routes/shared/resolve", json={"token": ""},
        ).status_code, 404)
        self.assertEqual(self.client.post(
            "/api/trail-routes/shared/resolve", json={"token": "x" * 500},
        ).status_code, 404)
        self.assertEqual(self.client.post(
            "/api/trail-routes/shared/resolve", json={"token": "x" * 43},
        ).status_code, 404)
        self.assertEqual(self.client.get(f"/api/trail-routes/shared/{token}").status_code, 404)

        replay = self.client.post(
            f"/api/trail-routes/{route['id']}/share-link",
            headers=self._headers(key="share-link"),
            json={"expected_revision": reviewed["revision"], "mode": "create"},
        )
        self.assertEqual(replay.status_code, 200)
        self.assertIsNone(replay.json()["share_token"])
        self.assertTrue(replay.json()["link_exists"])
        self.assertTrue(replay.json()["rotate_required"])

        current = fresh.json()["route"]
        changed = self.client.patch(
            f"/api/trail-routes/{route['id']}", headers=self._headers(key="edit-shared"),
            json={"expected_revision": current["revision"], "title": "New Private Title"},
        ).json()
        old_snapshot = self.client.post("/api/trail-routes/shared/resolve", json={"token": token}).json()
        self.assertEqual(old_snapshot["title"], "Mesa View Loop")
        self.assertIsNone(changed["privacy_reviewed_at"])

        reviewed_again = self.client.patch(
            f"/api/trail-routes/{route['id']}", headers=self._headers(key="privacy-review-again"),
            json={"expected_revision": changed["revision"], "privacy_reviewed": True},
        ).json()
        replaced = self.client.post(
            f"/api/trail-routes/{route['id']}/share-link",
            headers=self._headers(key="replace-share"),
            json={"expected_revision": reviewed_again["revision"], "mode": "replace"},
        )
        self.assertEqual(replaced.status_code, 200, replaced.text)
        new_token = replaced.json()["share_token"]
        self.assertNotEqual(new_token, token)
        self.assertEqual(self.client.post(
            "/api/trail-routes/shared/resolve", json={"token": token},
        ).status_code, 404)
        self.assertEqual(self.client.post(
            "/api/trail-routes/shared/resolve", json={"token": new_token},
        ).status_code, 200)

    def test_route_creation_rate_limit_applies_without_client_idempotency_key(self):
        with patch.dict(store.TRAIL_ROUTE_MUTATION_LIMITS, {"create": 1}):
            first = store.create_owned_trail_route_v1(
                self.user_id, **self._payload(title="First Limited Route"),
            )
            self.assertIsNotNone(first["route"])
            with self.assertRaisesRegex(PermissionError, "limit"):
                store.create_owned_trail_route_v1(
                    self.user_id, **self._payload(title="Second Limited Route"),
                )

    def test_share_and_revoke_replays_conflict_after_later_link_mutations(self):
        route = self._create_route("replay-state-route")
        reviewed = self.client.patch(
            f"/api/trail-routes/{route['id']}", headers=self._headers(key="replay-privacy"),
            json={"expected_revision": route["revision"], "privacy_reviewed": True},
        ).json()
        shared = self.client.post(
            f"/api/trail-routes/{route['id']}/share-link",
            headers=self._headers(key="replay-share"),
            json={"expected_revision": reviewed["revision"], "mode": "create"},
        ).json()
        revoked = self.client.delete(
            f"/api/trail-routes/{route['id']}/share-link?expected_revision={shared['route']['revision']}",
            headers=self._headers(key="replay-revoke"),
        )
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.assertFalse(revoked.json()["route"]["share_enabled"])

        immediate_revoke_replay = self.client.delete(
            f"/api/trail-routes/{route['id']}/share-link?expected_revision={shared['route']['revision']}",
            headers=self._headers(key="replay-revoke"),
        )
        self.assertEqual(immediate_revoke_replay.status_code, 200, immediate_revoke_replay.text)
        self.assertTrue(immediate_revoke_replay.json()["revoked"])
        self.assertFalse(immediate_revoke_replay.json()["route"]["share_enabled"])

        stale_share_replay = self.client.post(
            f"/api/trail-routes/{route['id']}/share-link",
            headers=self._headers(key="replay-share"),
            json={"expected_revision": reviewed["revision"], "mode": "create"},
        )
        self.assertEqual(stale_share_replay.status_code, 409, stale_share_replay.text)
        self.assertEqual(stale_share_replay.json()["detail"]["code"], "trail_route_revision_conflict")

        current = self.client.get(
            f"/api/trail-routes/{route['id']}", headers=self._headers(),
        ).json()
        replacement = self.client.post(
            f"/api/trail-routes/{route['id']}/share-link",
            headers=self._headers(key="replay-new-share"),
            json={"expected_revision": current["revision"], "mode": "create"},
        )
        self.assertEqual(replacement.status_code, 200, replacement.text)
        self.assertTrue(replacement.json()["route"]["share_enabled"])

        stale_revoke_replay = self.client.delete(
            f"/api/trail-routes/{route['id']}/share-link?expected_revision={shared['route']['revision']}",
            headers=self._headers(key="replay-revoke"),
        )
        self.assertEqual(stale_revoke_replay.status_code, 409, stale_revoke_replay.text)
        self.assertEqual(stale_revoke_replay.json()["detail"]["code"], "trail_route_revision_conflict")

    def test_resolver_and_web_fallback_follow_off_internal_public_kill_switch(self):
        route = self._create_route("stage-share-route")
        reviewed = store.update_owned_trail_route_v1(
            self.user_id, route["id"], expected_revision=1,
            idempotency_key="stage-privacy", changes={"privacy_reviewed": True},
        )["route"]
        token = store.create_owned_trail_share_v1(
            self.user_id, route["id"], expected_revision=reviewed["revision"],
            idempotency_key="stage-share",
        )["share_token"]

        with patch.dict(os.environ, {"TRAILHEAD_PRIVATE_TRAIL_ROUTES_STAGE": "off"}):
            self.assertEqual(self.client.post(
                "/api/trail-routes/shared/resolve", json={"token": token},
            ).status_code, 404)
            self.assertEqual(self.client.get("/app/trails/shared#token=ignored").status_code, 404)
        for stage in ("internal", "public"):
            with self.subTest(stage=stage), patch.dict(
                os.environ, {"TRAILHEAD_PRIVATE_TRAIL_ROUTES_STAGE": stage},
            ):
                self.assertEqual(self.client.post(
                    "/api/trail-routes/shared/resolve", json={"token": token},
                ).status_code, 200)
                landing = self.client.get("/app/trails/shared")
                self.assertEqual(landing.status_code, 200)
                self.assertEqual(landing.headers["cache-control"], "no-store")
                self.assertEqual(landing.headers["referrer-policy"], "no-referrer")
                self.assertIn("trailhead://app/trails/shared#token=", landing.text)
                self.assertNotIn(token, landing.text)
                head = self.client.head("/app/trails/shared")
                self.assertEqual(head.status_code, 200)
                self.assertEqual(head.headers["cache-control"], "no-store")

    def test_unreviewed_legacy_profiles_are_hidden_from_every_public_reader(self):
        profile = store.upsert_trail_profile({
            "id": "trailhead:legacy:hidden",
            "name": "Hidden Community Route",
            "lat": 38.57,
            "lng": -109.55,
            "geometry": {"type": "LineString", "coordinates": [[-109.55, 38.57], [-109.551, 38.571]]},
            "activities": ["hiking"],
            "trailheads": [],
            "photos": [],
            "source": "trailhead",
            "source_label": "Trailhead community",
            "provenance": {"submitted_by_id": self.user_id, "review_status": "submitted"},
        })
        encoded_id = quote(profile["id"], safe="")
        with patch.object(server, "_seed_open_trail_profiles", AsyncMock(return_value=None)):
            legacy_list = self.client.get("/api/trails/discover?lat=38.57&lng=-109.55")
            legacy_area = self.client.get("/api/trail-areas/discover?lat=38.57&lng=-109.55")
        self.assertEqual(legacy_list.status_code, 200)
        self.assertNotIn(profile["id"], json.dumps(legacy_list.json()))
        self.assertEqual(legacy_area.status_code, 200)
        self.assertNotIn(profile["id"], json.dumps(legacy_area.json()))
        for path in (
            f"/api/trails/{encoded_id}",
            f"/api/trails/{encoded_id}/preview",
            f"/api/trails/v2/{encoded_id}",
            f"/api/trails/v2/{encoded_id}/preview",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_offline_catalog_includes_only_verified_trail_profiles(self):
        geometry = {
            "type": "LineString",
            "coordinates": [[-109.55, 38.57], [-109.551, 38.571]],
        }
        hidden = store.upsert_trail_profile({
            "id": "trailhead:legacy:offline-hidden",
            "name": "Hidden Offline Community Route",
            "lat": 38.57,
            "lng": -109.55,
            "geometry": geometry,
            "activities": ["hiking"],
            "trailheads": [],
            "photos": [],
            "source": "trailhead",
            "source_label": "Trailhead community",
            "provenance": {"submitted_by_id": self.user_id, "review_status": "submitted"},
        })
        verified = store.upsert_trail_profile({
            "id": "trailhead:verified:offline-visible",
            "name": "Verified Offline Route",
            "lat": 38.58,
            "lng": -109.56,
            "geometry": geometry,
            "activities": ["hiking"],
            "trailheads": [],
            "photos": [],
            "source": "trailhead",
            "source_label": "Trailhead",
            "provenance": {},
        })

        items = _database_catalog_items_v2(OfflineBoundsV2(
            west=-109.7, south=38.4, east=-109.4, north=38.8,
        ))
        item_ids = {item.item_id for item in items}
        self.assertNotIn(hidden["id"], item_ids)
        self.assertIn(verified["id"], item_ids)

    def _seed_public_and_private_trail_data(self) -> tuple[str, str, str]:
        private_route = store.create_owned_trail_route_v1(
            self.user_id, idempotency_key="delete-private", **self._payload(title="Private Route"),
        )["route"]
        public_route = store.create_owned_trail_route_v1(
            self.user_id, idempotency_key="delete-public", **self._payload(title="Public Route"),
        )["route"]
        submission = store.create_trail_submission_v1(
            self.user_id, public_route["id"], "private_handle",
        )
        secret_snapshot = {
            **submission["snapshot"],
            "description": "contact secret-person@example.com",
            "geometry": {
                "type": "LineString",
                "coordinates": [[-109.55, 38.57, 1800, 1710000000], [-109.551, 38.571, 1801, 1710000001]],
                "device_id": "route-device-secret",
            },
            "trailheads": [{
                "name": "private_handle 204-555-1212", "lat": 38.57, "lng": -109.55,
                "role": "start", "place_id": "nested@example.com",
                "source": "private_handle", "source_url": "https://agency.example/access",
                "email": "nested@example.com",
            }],
            "source_evidence": [{
                "title": "source-title@example.com", "publisher": "private_handle",
                "source_id": "source-device-secret", "reviewed_at": "204-555-3434",
                "kind": "official", "url": "https://agency.example/route",
                "note": "device-secret-note@example.com",
                "headers": {"Authorization": "secret"},
            }],
            "photos": [{
                "asset_id": "legacy-photo", "exif": {"device_id": "photo-device-secret"},
                "url": "https://private.example/photo.jpg",
            }],
            "contributor_handle": "private_handle",
        }
        now = int(time.time())
        db = store._conn()
        db.execute(
            """UPDATE trail_submissions_v1
               SET status='approved_community',snapshot_json=?,moderator_history_json=? WHERE id=?""",
            (
                json.dumps(secret_snapshot),
                json.dumps([{
                    "action": "approved private@example.com", "status": "approved_community",
                    "created_at": now, "device": "moderator-secret",
                }]),
                submission["id"],
            ),
        )
        community_id = "community_trail_delete_test"
        db.execute(
            """INSERT INTO community_trails_v1
               (id,submission_id,publication_revision,snapshot_json,status,created_at,updated_at)
               VALUES (?,?,1,?,'active',?,?)""",
            (community_id, submission["id"], json.dumps(secret_snapshot), now, now),
        )
        db.execute(
            """INSERT INTO trail_contribution_credit_awards_v1
               (submission_id,user_id,credits,awarded_at) VALUES (?,?,10,?)""",
            (submission["id"], self.user_id, now),
        )
        db.commit()
        db.close()
        legacy_profile_id = "trailhead:legacy:delete-test"
        store.upsert_trail_profile({
            "id": legacy_profile_id,
            "name": "private_handle overlook",
            "summary": "Email legacy-secret@example.com for details",
            "description": "Call 204-555-9988 from legacy-device-secret",
            "lat": 38.57,
            "lng": -109.55,
            "length_mi": 1.2,
            "difficulty": "private_handle moderate",
            "activities": ["hiking"],
            "land_manager": "private_handle land manager",
            "geometry": {
                "type": "LineString",
                "coordinates": [[-109.55, 38.57, 1800, 1710000000], [-109.551, 38.571, 1801, 1710000001]],
            },
            "trailheads": [{
                "name": "legacy-secret@example.com", "lat": 38.57, "lng": -109.55,
                "source": "private_handle", "device_id": "legacy-trailhead-device",
            }],
            "official_url": "https://private.example/private_handle",
            "photos": [{"url": "https://private.example/photo.jpg", "exif": {"device_id": "legacy-photo-device"}}],
            "source": "trailhead",
            "source_label": "Trailhead community",
            "provenance": {
                "submitted_by_id": self.user_id,
                "submitted_by": "private_handle",
                "review_status": "approved_community",
            },
        })
        return submission["id"], community_id, legacy_profile_id

    def _assert_deleted_trail_data_is_private_safe(
        self,
        submission_id: str,
        community_id: str,
        legacy_profile_id: str,
    ) -> None:
        db = store._conn()
        self.assertEqual(db.execute(
            "SELECT COUNT(*) FROM owned_trail_routes_v1 WHERE user_id=?", (self.user_id,),
        ).fetchone()[0], 0)
        self.assertEqual(db.execute(
            "SELECT COUNT(*) FROM trail_route_mutations_v1 WHERE user_id=?", (self.user_id,),
        ).fetchone()[0], 0)
        self.assertEqual(db.execute(
            "SELECT COUNT(*) FROM trail_contribution_credit_awards_v1 WHERE user_id=?", (self.user_id,),
        ).fetchone()[0], 0)
        submission = db.execute(
            "SELECT * FROM trail_submissions_v1 WHERE id=?", (submission_id,),
        ).fetchone()
        community = db.execute(
            "SELECT * FROM community_trails_v1 WHERE id=?", (community_id,),
        ).fetchone()
        legacy_profile = db.execute(
            "SELECT * FROM trail_profiles WHERE id=?", (legacy_profile_id,),
        ).fetchone()
        violations = db.execute("PRAGMA foreign_key_check").fetchall()
        db.close()
        self.assertIsNotNone(submission)
        self.assertIsNone(submission["user_id"])
        self.assertIsNone(submission["route_id"])
        self.assertEqual(submission["submitter_handle"], "Deleted contributor")
        self.assertIsNotNone(legacy_profile)
        combined = "\n".join((
            submission["snapshot_json"],
            submission["moderator_history_json"],
            community["snapshot_json"],
            json.dumps(dict(legacy_profile), sort_keys=True),
        ))
        for secret in (
            "secret-person@example.com", "route-device-secret", "nested@example.com",
            "device-secret-note@example.com", "photo-device-secret", "private_handle",
            "moderator-secret", "Authorization", "204-555-1212", "204-555-3434",
            "source-title@example.com", "source-device-secret",
            "legacy-secret@example.com", "legacy-device-secret", "legacy-trailhead-device",
            "legacy-photo-device", "204-555-9988", "private.example",
        ):
            self.assertNotIn(secret, combined)
        public_snapshot = json.loads(community["snapshot_json"])
        self.assertEqual(public_snapshot["contributor_handle"], "Deleted contributor")
        self.assertNotIn("photos", public_snapshot)
        self.assertEqual(public_snapshot["geometry"]["coordinates"][0], [-109.55, 38.57])
        decoded_legacy = store._decode_trail_profile(legacy_profile)
        self.assertEqual(decoded_legacy["name"], "Deleted contributor overlook")
        self.assertEqual(decoded_legacy["summary"], "")
        self.assertEqual(decoded_legacy["description"], "")
        self.assertEqual(decoded_legacy["trailheads"], [{"lat": 38.57, "lng": -109.55}])
        self.assertEqual(decoded_legacy["photos"], [])
        self.assertEqual(decoded_legacy["official_url"], "")
        self.assertEqual(decoded_legacy["provenance"]["submitted_by"], "Deleted contributor")
        self.assertEqual(violations, [])

    def test_account_deletion_removes_private_routes_and_anonymizes_public_snapshot(self):
        submission_id, community_id, legacy_profile_id = self._seed_public_and_private_trail_data()
        store.delete_user(self.user_id)
        self._assert_deleted_trail_data_is_private_safe(submission_id, community_id, legacy_profile_id)

    def test_locked_account_deletion_fallback_has_the_same_trail_privacy_guarantee(self):
        submission_id, community_id, legacy_profile_id = self._seed_public_and_private_trail_data()
        with patch.object(
            store, "_delete_user_full", side_effect=sqlite3.OperationalError("database is locked"),
        ) as full_delete, patch.object(store.time, "sleep"):
            store.delete_user(self.user_id)
        self.assertEqual(full_delete.call_count, 3)
        self._assert_deleted_trail_data_is_private_safe(submission_id, community_id, legacy_profile_id)


if __name__ == "__main__":
    unittest.main()
