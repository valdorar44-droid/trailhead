from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from config.settings import settings
from dashboard import server
from dashboard.trails_v2 import build_trail_systems_v2
from db import store


class ExploreCommunityTrailsTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        self.temp = tempfile.TemporaryDirectory()
        settings.db_path = str(Path(self.temp.name) / "explore-community-trails.db")
        store.init_db()
        self.user_id = store.create_user(
            "trail-builder@example.com", "trail_builder", server._hash_pw("correct-password"), "Builder-Code",
        )
        store.add_credits(self.user_id, 20, "Test balance")
        self.client = TestClient(server.app)

    def tearDown(self):
        server.app.dependency_overrides.pop(server._current_user, None)
        settings.db_path = self.original_db_path
        self.temp.cleanup()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {server._make_token(self.user_id)}"}

    def test_schema_is_repeatable_and_postchecked(self):
        store.init_db()
        db = store._conn()
        migration = db.execute(
            "SELECT 1 FROM schema_migrations WHERE migration_id=?",
            (store.EXPLORE_COMMUNITY_TRAILS_MIGRATION,),
        ).fetchone()
        tables = {
            row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        violations = db.execute("PRAGMA foreign_key_check").fetchall()
        db.close()

        self.assertIsNotNone(migration)
        self.assertTrue({
            "owned_trail_routes_v1",
            "trail_submissions_v1",
            "community_trails_v1",
            "trail_contribution_credit_awards_v1",
        }.issubset(tables))
        self.assertEqual(violations, [])

    def test_legacy_endpoint_creates_private_route_and_pending_submission_without_credits(self):
        before = store.get_user_by_id(self.user_id)["credits"]
        response = self.client.post(
            "/api/trails/community",
            headers=self._headers(),
            json={
                "name": "Mesa View Loop",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-109.55, 38.57], [-109.56, 38.58], [-109.55, 38.57]],
                },
                "trailheads": [{"name": "Mesa View Trailhead", "lat": 38.57, "lng": -109.55}],
                "activities": ["hiking"],
                "description": "A route recorded and reviewed by the contributor.",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["route"]["visibility"], "private")
        self.assertEqual(payload["submission"]["status"], "submitted")
        self.assertEqual(payload["credits_earned"], 0)
        self.assertEqual(store.get_user_by_id(self.user_id)["credits"], before)
        db = store._conn()
        public_count = db.execute(
            "SELECT count(*) FROM trail_profiles WHERE source_label='Trailhead community'",
        ).fetchone()[0]
        db.close()
        self.assertEqual(public_count, 0)

    def test_unreviewed_legacy_profiles_are_queued_and_excluded_from_discovery(self):
        profile = store.upsert_trail_profile({
            "id": "trailhead:legacy:one",
            "name": "Legacy Community Loop",
            "lat": 38.57,
            "lng": -109.55,
            "geometry": {
                "type": "LineString",
                "coordinates": [[-109.55, 38.57], [-109.56, 38.58]],
            },
            "activities": ["hiking"],
            "trailheads": [],
            "photos": [],
            "source": "trailhead",
            "source_label": "Trailhead community",
            "provenance": {
                "submitted_by": "trail_builder",
                "submitted_by_id": self.user_id,
                "review_status": "community",
            },
        })

        store.init_db()
        queued = store.list_trail_submissions_v1(status="submitted")

        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0]["legacy_profile_id"], profile["id"])
        self.assertEqual(build_trail_systems_v2([profile]), [])

    def test_access_evidence_is_required_instead_of_invented(self):
        response = self.client.post(
            "/api/trails/community",
            headers=self._headers(),
            json={
                "name": "Unclear Route",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-109.55, 38.57], [-109.56, 38.58]],
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Add a trailhead or explain the public access point")


if __name__ == "__main__":
    unittest.main()
