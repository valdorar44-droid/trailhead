from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from config.settings import settings
from dashboard import server
from dashboard.trails_v2 import build_trail_systems_v2
from db import store


class TrailCommunityModerationE5Tests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        self.temp = tempfile.TemporaryDirectory()
        settings.db_path = str(Path(self.temp.name) / "community-moderation-e5.db")
        self.stage_patch = patch.dict(
            os.environ,
            {
                "TRAILHEAD_PRIVATE_TRAIL_ROUTES_STAGE": "public",
                "TRAILHEAD_COMMUNITY_TRAILS_STAGE": "public",
            },
        )
        self.stage_patch.start()
        store.init_db()
        self.user_id = store.create_user(
            "community-owner@example.com",
            "trailsean",
            server._hash_pw("password"),
            "community-owner-code",
        )
        self.other_id = store.create_user(
            "community-other@example.com",
            "otherbuilder",
            server._hash_pw("password"),
            "community-other-code",
        )
        self.admin_id = store.create_user(
            "community-admin@example.com",
            "trailmoderator",
            server._hash_pw("password"),
            "community-admin-code",
        )
        store.set_user_admin(self.admin_id, True)
        store.add_credits(self.user_id, 20, "Test balance")
        server._trail_system_v2_cache.clear()
        self.client = TestClient(server.app)

    def tearDown(self):
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
    def _route_payload(title: str = "Morning Ridge Loop") -> dict:
        return {
            "origin": "builder",
            "title": title,
            "description": "A contributor-built ridge route.",
            "activity": "hiking",
            "route_shape": "loop",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [-109.5500, 38.5700, 1710000000],
                    [-109.5510, 38.5710, 1710000001],
                    [-109.5520, 38.5704, 1710000002],
                    [-109.5500, 38.5700, 1710000003],
                ],
            },
            "trailheads": [{
                "name": "Morning Ridge Trailhead",
                "lat": 38.5700,
                "lng": -109.5500,
                "source": "Land agency",
                "source_url": "https://agency.example/trails/morning-ridge",
            }],
            "permitted_uses": ["hiking"],
            "source_evidence": [{
                "title": "Morning Ridge access",
                "publisher": "Land agency",
                "kind": "permitted_use",
                "url": "https://agency.example/trails/morning-ridge",
                "reviewed_at": "2026-07-30",
            }],
            "photos": [],
        }

    def _create_route(self, title: str = "Morning Ridge Loop", key: str = "create-route") -> dict:
        response = self.client.post(
            "/api/trail-routes",
            headers=self._headers(key=key),
            json=self._route_payload(title),
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def _submit(self, route_id: str) -> dict:
        response = self.client.post(
            f"/api/trail-routes/{route_id}/submissions",
            headers=self._headers(),
            json={
                "contributor_attested": True,
                "photo_rights_confirmed": False,
                "public_access_note": "The official access point is listed in the route sources.",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    @staticmethod
    def _approval() -> dict:
        return {
            "decision": "approved_community",
            "note": "Geometry and access evidence reviewed.",
            "internal_note": "Official access record matched the submitted trailhead.",
            "duplicate_review": {"status": "clear", "matches": []},
            "access_review": {
                "status": "supported",
                "source": "https://agency.example/trails/morning-ridge",
            },
            "photo_rights_verified": False,
        }

    def test_submission_is_private_immutable_and_non_enumerable(self):
        route = self._create_route()
        missing_attestation = self.client.post(
            f"/api/trail-routes/{route['id']}/submissions",
            headers=self._headers(),
            json={
                "contributor_attested": False,
                "photo_rights_confirmed": False,
            },
        )
        self.assertEqual(missing_attestation.status_code, 400)
        self.assertIn("Confirm the route", missing_attestation.json()["detail"])

        submission = self._submit(route["id"])
        self.assertEqual(submission["status"], "submitted")
        self.assertEqual(submission["snapshot"]["geometry_sha256"], route["geometry_sha256"])
        self.assertNotIn("device", str(submission["snapshot"]).lower())
        self.assertEqual(len(submission["snapshot"]["geometry"]["coordinates"][0]), 2)

        owner = self.client.get(
            f"/api/trail-submissions/{submission['id']}", headers=self._headers(),
        )
        other = self.client.get(
            f"/api/trail-submissions/{submission['id']}", headers=self._headers(self.other_id),
        )
        self.assertEqual(owner.status_code, 200)
        self.assertEqual(other.status_code, 404)
        self.assertEqual(store.list_community_trails_v1(), [])
        self.assertEqual(store.list_trail_profiles_near(38.57, -109.55, include_community=True), [])

    def test_changes_requested_requires_new_revision_and_preserves_old_snapshot(self):
        route = self._create_route()
        submission = self._submit(route["id"])
        decision = self.client.post(
            f"/api/admin/trail-submissions/{submission['id']}/decision",
            headers=self._headers(self.admin_id),
            json={
                "decision": "changes_requested",
                "note": "Clarify the east access point.",
                "internal_note": "The submitted source only documents the west entrance.",
                "duplicate_review": {"status": "clear"},
                "access_review": {"status": "insufficient"},
            },
        )
        self.assertEqual(decision.status_code, 200, decision.text)
        self.assertEqual(decision.json()["submission"]["status"], "changes_requested")
        owner_status = self.client.get(
            f"/api/trail-submissions/{submission['id']}", headers=self._headers(),
        ).json()
        admin_status = self.client.get(
            f"/api/admin/trail-submissions/{submission['id']}",
            headers=self._headers(self.admin_id),
        ).json()
        self.assertNotIn("moderator_id", owner_status["moderator_history"][-1])
        self.assertNotIn("internal_note", owner_status["moderator_history"][-1]["details"])
        self.assertEqual(admin_status["moderator_history"][-1]["moderator_id"], self.admin_id)
        self.assertEqual(
            admin_status["moderator_history"][-1]["details"]["internal_note"],
            "The submitted source only documents the west entrance.",
        )

        unchanged = self.client.post(
            f"/api/trail-submissions/{submission['id']}/resubmit",
            headers=self._headers(),
            json={"contributor_attested": True, "photo_rights_confirmed": False},
        )
        self.assertEqual(unchanged.status_code, 400)
        self.assertEqual(unchanged.json()["detail"], "Update the route before resubmitting")

        update = self.client.patch(
            f"/api/trail-routes/{route['id']}",
            headers=self._headers(key="update-access-note"),
            json={
                "expected_revision": route["revision"],
                "description": "A contributor-built ridge route with the east access point documented.",
            },
        )
        self.assertEqual(update.status_code, 200, update.text)
        resubmitted = self.client.post(
            f"/api/trail-submissions/{submission['id']}/resubmit",
            headers=self._headers(),
            json={
                "contributor_attested": True,
                "photo_rights_confirmed": False,
                "public_access_note": "East access is documented by the listed land agency.",
            },
        )
        self.assertEqual(resubmitted.status_code, 201, resubmitted.text)
        second = resubmitted.json()
        self.assertNotEqual(second["id"], submission["id"])
        self.assertGreater(second["route_revision"], submission["route_revision"])
        previous = store.get_trail_submission_v1(submission["id"])
        self.assertEqual(previous["status"], "archived")
        self.assertEqual(previous["snapshot"]["description"], "A contributor-built ridge route.")
        self.assertIn("east access", second["snapshot"]["description"])

    def test_approval_publishes_community_lane_and_awards_five_credits_once(self):
        route = self._create_route()
        submission = self._submit(route["id"])
        before = store.get_user_by_id(self.user_id)["credits"]

        first = self.client.post(
            f"/api/admin/trail-submissions/{submission['id']}/decision",
            headers=self._headers(self.admin_id),
            json=self._approval(),
        )
        second = self.client.post(
            f"/api/admin/trail-submissions/{submission['id']}/decision",
            headers=self._headers(self.admin_id),
            json=self._approval(),
        )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        result = first.json()
        self.assertEqual(result["submission"]["status"], "approved_community")
        self.assertEqual(result["credits"], 5)
        self.assertEqual(store.get_user_by_id(self.user_id)["credits"], before + 5)

        community = result["community_trail"]
        self.assertEqual(community["status"], "active")
        public_id = community["snapshot"]["public_trail_id"]
        self.assertIsNone(store.get_trail_profile(public_id))
        profile = store.get_trail_profile(public_id, include_community=True)
        self.assertIsNotNone(profile)
        self.assertEqual(store.trail_profile_publication_lane(profile), "community")
        systems = build_trail_systems_v2([profile])
        self.assertEqual(len(systems), 1)
        self.assertEqual(systems[0].catalog, "community")

        db = store._conn()
        transaction_count = db.execute(
            "SELECT COUNT(*) FROM credit_transactions WHERE reward_key=?",
            (f"trail-contribution:{submission['id']}",),
        ).fetchone()[0]
        award_count = db.execute(
            "SELECT COUNT(*) FROM trail_contribution_credit_awards_v1 WHERE submission_id=?",
            (submission["id"],),
        ).fetchone()[0]
        db.close()
        self.assertEqual(transaction_count, 1)
        self.assertEqual(award_count, 1)

    def test_approved_contribution_count_refreshes_every_active_community_route(self):
        first_route = self._create_route("Morning Ridge Loop", "create-first-route")
        first_submission = self._submit(first_route["id"])
        first_result = self.client.post(
            f"/api/admin/trail-submissions/{first_submission['id']}/decision",
            headers=self._headers(self.admin_id),
            json=self._approval(),
        )
        self.assertEqual(first_result.status_code, 200, first_result.text)

        second_route = self._create_route("Evening Ridge Loop", "create-second-route")
        second_submission = self._submit(second_route["id"])
        second_result = self.client.post(
            f"/api/admin/trail-submissions/{second_submission['id']}/decision",
            headers=self._headers(self.admin_id),
            json=self._approval(),
        )
        self.assertEqual(second_result.status_code, 200, second_result.text)

        community_routes = store.list_community_trails_v1(status="active")
        self.assertEqual(len(community_routes), 2)
        for community in community_routes:
            self.assertEqual(community["snapshot"]["contributor_approved_count"], 2)
            profile = store.get_trail_profile(
                community["snapshot"]["public_trail_id"],
                include_community=True,
            )
            self.assertEqual(profile["provenance"]["contributor_approved_count"], 2)

    def test_duplicate_conflict_blocks_approval_and_rejection_awards_nothing(self):
        route = self._create_route()
        submission = self._submit(route["id"])
        before = store.get_user_by_id(self.user_id)["credits"]
        conflict = self._approval()
        conflict["duplicate_review"] = {
            "status": "duplicate",
            "matches": [{"trail_id": "trail:official:morning-ridge"}],
        }
        blocked = self.client.post(
            f"/api/admin/trail-submissions/{submission['id']}/decision",
            headers=self._headers(self.admin_id),
            json=conflict,
        )
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(blocked.json()["detail"], "Complete the duplicate review before approval")

        rejected = self.client.post(
            f"/api/admin/trail-submissions/{submission['id']}/decision",
            headers=self._headers(self.admin_id),
            json={
                "decision": "rejected",
                "note": "This route duplicates the existing official trail.",
                "duplicate_review": conflict["duplicate_review"],
                "access_review": {"status": "supported"},
            },
        )
        self.assertEqual(rejected.status_code, 200, rejected.text)
        self.assertEqual(rejected.json()["submission"]["status"], "rejected")
        self.assertEqual(store.get_user_by_id(self.user_id)["credits"], before)
        self.assertEqual(store.list_community_trails_v1(), [])

    def test_takedown_restore_and_authoritative_promotion_preserve_history(self):
        route = self._create_route()
        submission = self._submit(route["id"])
        approved = self.client.post(
            f"/api/admin/trail-submissions/{submission['id']}/decision",
            headers=self._headers(self.admin_id),
            json=self._approval(),
        ).json()
        community = approved["community_trail"]
        community_id = community["id"]
        public_id = community["snapshot"]["public_trail_id"]

        taken_down = self.client.post(
            f"/api/admin/community-trails/{community_id}/status",
            headers=self._headers(self.admin_id),
            json={"action": "take_down", "note": "Access report requires review."},
        )
        self.assertEqual(taken_down.status_code, 200, taken_down.text)
        self.assertEqual(taken_down.json()["status"], "taken_down")
        self.assertIsNone(store.get_trail_profile(public_id, include_community=True))

        restored = self.client.post(
            f"/api/admin/community-trails/{community_id}/status",
            headers=self._headers(self.admin_id),
            json={"action": "restore", "note": "The land agency confirmed access."},
        )
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(restored.json()["status"], "active")
        self.assertIsNotNone(store.get_trail_profile(public_id, include_community=True))

        promoted = self.client.post(
            f"/api/admin/community-trails/{community_id}/promote",
            headers=self._headers(self.admin_id),
            json={
                "verified_trail_id": "trail:verified:morning-ridge-loop",
                "authoritative_sources": [{
                    "label": "Land agency",
                    "kind": "official",
                    "url": "https://agency.example/trails/morning-ridge",
                }],
                "note": "Official geometry and access corroborated.",
            },
        )
        self.assertEqual(promoted.status_code, 200, promoted.text)
        body = promoted.json()
        self.assertEqual(body["community_trail"]["status"], "promoted")
        self.assertIsNone(store.get_trail_profile(public_id, include_community=True))
        verified = store.get_trail_profile("trail:verified:morning-ridge-loop")
        self.assertIsNotNone(verified)
        self.assertEqual(store.trail_profile_publication_lane(verified), "verified")
        history = store.get_trail_submission_v1(submission["id"])["moderator_history"]
        self.assertEqual(
            [event["event"] for event in history],
            ["approved_community", "taken_down", "restored", "promoted"],
        )

    def test_admin_moderation_surface_has_complete_actions_and_clean_copy(self):
        html = (Path(__file__).parents[1] / "dashboard" / "admin.html").read_text(encoding="utf-8")
        page = html.split("<!-- Trail Review -->", 1)[1].split("<!-- Bug Reports -->", 1)[0]
        script = html.split("function setTrailModerationMode", 1)[1].split("function esc", 1)[0]
        for label in (
            "Awaiting review", "Conflicts", "Changes requested", "All submissions", "Community",
            "Approve Community", "Request changes", "Reject", "Take down",
            "Restore", "Create Verified revision", "Internal findings",
        ):
            self.assertIn(label, page + script)
        for handler in (
            "loadTrailModeration()", "setTrailModerationMode('submitted')",
            "submitTrailModerationDecision('approved_community')",
            "submitTrailModerationDecision('changes_requested')",
            "submitTrailModerationDecision('rejected')", "setCommunityTrailStatus",
            "promoteCommunityTrail()",
        ):
            self.assertIn(handler, page + script)
        self.assertIn("trailModerationRouteSvg(snapshot.geometry)", script)
        self.assertIn("Not source-verified", script)
        self.assertNotRegex(page + script, r"(?i)\bAI\b|provider slug|generated description")


if __name__ == "__main__":
    unittest.main()
