import asyncio
import os
import tempfile
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import HTTPException

from config.settings import settings
from dashboard.server import api_communication_preferences, api_my_community_publications
from db import store


def _trip_document(trip_id: str, notes: list[dict], starts_on: str = "2026-07-19", ends_on: str = "2026-07-24") -> dict:
    return {
        "schema_version": 2,
        "trip_id": trip_id,
        "status": "draft",
        "title": "Reviewed field trip",
        "starts_on": starts_on,
        "ends_on": ends_on,
        "dates": {"starts_on": starts_on, "ends_on": ends_on},
        "rig_snapshot": {},
        "route": {"coordinates": [[-109.5, 38.5], [-108.8, 39.0]]},
        "days": [],
        "items": [],
        "notes": notes,
        "readiness": {},
        "bookings": [],
        "alerts": [],
        "offline": {},
        "visibility": "private",
        "source": "test",
    }


class CommunicationAndPublicationTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()
        self.user = store.create_user(
            "field@example.com", "field_writer", "hash", "field-writer-code"
        )
        self.other = store.create_user(
            "other@example.com", "other_writer", "hash", "other-writer-code"
        )
        self.admin = store.create_user(
            "admin@example.com", "review_admin", "hash", "review-admin-code"
        )
        store.set_user_admin(self.admin, True)

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    def _save_trip(self, notes: list[dict], trip_id: str = "trip_review", **dates) -> dict:
        return store.upsert_trip_document_v2(
            self.user,
            trip_id,
            _trip_document(trip_id, notes, **dates),
            0,
            f"create-{trip_id}",
        )

    def test_preferences_default_off_validate_and_unsubscribe_all(self):
        defaults = store.get_communication_preferences(self.user)
        self.assertEqual(defaults, {
            "weekly_digest": False,
            "trip_window_briefs": False,
            "deal_alerts": False,
            "timezone": "UTC",
            "locale": "en-US",
            "unsubscribed_all": False,
            "updated_at": None,
        })

        enabled = store.update_communication_preferences(self.user, {
            "weekly_digest": True,
            "trip_window_briefs": True,
            "timezone": "America/Winnipeg",
            "locale": "en-CA",
        })
        self.assertTrue(enabled["weekly_digest"])
        self.assertTrue(enabled["trip_window_briefs"])
        self.assertFalse(enabled["deal_alerts"])
        self.assertEqual(enabled["timezone"], "America/Winnipeg")

        with self.assertRaisesRegex(ValueError, "valid timezone"):
            store.update_communication_preferences(self.user, {"timezone": "Mars/Olympus"})
        with self.assertRaisesRegex(ValueError, "language-region"):
            store.update_communication_preferences(self.user, {"locale": "english_ca"})

        stopped = store.unsubscribe_all_communications(self.user)
        self.assertTrue(stopped["unsubscribed_all"])
        self.assertFalse(stopped["weekly_digest"])
        self.assertFalse(stopped["trip_window_briefs"])
        self.assertFalse(stopped["deal_alerts"])

    def test_scheduler_selects_only_explicit_bounded_opt_ins(self):
        timestamp = int(datetime(2026, 7, 12, 18, tzinfo=timezone.utc).timestamp())
        self._save_trip(
            [{"id": "note-one", "body": "Private", "visibility": "private"}],
            starts_on="2026-07-19",
            ends_on="2026-07-24",
        )
        store.update_communication_preferences(self.user, {
            "weekly_digest": True,
            "trip_window_briefs": True,
            "timezone": "America/Winnipeg",
        })
        store.update_communication_preferences(self.other, {"deal_alerts": True})

        weekly = store.select_weekly_digest_recipients()
        briefs = store.select_trip_window_brief_recipients(now=timestamp)
        self.assertEqual([row["user_id"] for row in weekly], [self.user])
        self.assertEqual([row["user_id"] for row in briefs], [self.user])
        self.assertEqual(briefs[0]["trip_id"], "trip_review")
        self.assertNotIn("route", briefs[0])

        outside = store.select_trip_window_brief_recipients(
            now=int(datetime(2026, 7, 1, 18, tzinfo=timezone.utc).timestamp())
        )
        self.assertEqual(outside, [])

        long_trip = "trip_unbounded"
        store.upsert_trip_document_v2(
            self.other,
            long_trip,
            _trip_document(long_trip, [], "2026-07-01", "2027-07-01"),
            0,
            "create-unbounded",
        )
        store.update_communication_preferences(self.other, {"trip_window_briefs": True})
        selected = store.select_trip_window_brief_recipients(now=timestamp)
        self.assertNotIn(self.other, [row["user_id"] for row in selected])

    def test_private_note_review_requires_owned_source_and_canonical_target(self):
        self._save_trip([{
            "id": "note-source",
            "body": "Private source copy with route details and setup metadata.",
            "day": 2,
            "visibility": "private",
            "prompt": "never publish this",
        }])
        saved_place = store.upsert_saved_entity(
            self.user, "camp_saved", "camp", "Saved camp", {}, 0
        )

        with self.assertRaises(store.PublicationTargetRequiredError):
            store.submit_community_publication(
                self.user, "trip_review", "note-source", "place_update",
                "Road access", "The final approach was dry and clear for a stock-height vehicle.",
            )
        with self.assertRaises(store.PublicationTargetNotFoundError):
            store.submit_community_publication(
                self.user, "trip_review", "note-source", "correction",
                "Road access", "The final approach was dry and clear for a stock-height vehicle.",
                "missing_place",
            )
        with self.assertRaises(store.PublicationSourceNoteNotFoundError):
            store.submit_community_publication(
                self.other, "trip_review", "note-source", "trip_recap",
                "Weekend recap", "The route made a practical two-night loop with reliable services.",
            )
        with self.assertRaises(store.PublicationPrivacyError):
            store.submit_community_publication(
                self.user, "trip_review", "note-source", "place_update",
                "Road access", "The turn is at 38.5732, -109.5498 beside the cattle guard.",
                saved_place["canonical_id"],
            )

        submitted = store.submit_community_publication(
            self.user, "trip_review", "note-source", "place_update",
            "Road access", "The final approach was dry and clear for a stock-height vehicle.",
            saved_place["canonical_id"],
        )
        self.assertEqual(submitted["status"], "pending_review")
        for private_key in ("trip_id", "note_id", "source_note_fingerprint", "route", "prompt"):
            self.assertNotIn(private_key, submitted)
        with self.assertRaises(store.PublicationAlreadySubmittedError):
            store.submit_community_publication(
                self.user, "trip_review", "note-source", "place_update",
                "Road access", "A second reviewed copy should not create another open review.",
                saved_place["canonical_id"],
            )

    def test_moderation_public_attribution_and_retraction(self):
        self._save_trip([{"id": "note-public", "body": "Private source", "visibility": "private"}])
        store.upsert_saved_entity(self.user, "camp_public", "camp", "Public camp", {}, 0)
        submitted = store.submit_community_publication(
            self.user, "trip_review", "note-public", "correction",
            "Water status", "The seasonal spigot was turned off during the latest field visit.",
            "camp_public",
        )
        self.assertEqual(store.list_approved_place_publications("camp_public")["items"], [])

        reviewed = store.moderate_community_publication(
            submitted["id"], "approved", self.admin, "Source and wording reviewed."
        )
        self.assertEqual(reviewed["status"], "approved")
        public = store.list_approved_place_publications("camp_public")["items"]
        self.assertEqual(len(public), 1)
        self.assertEqual(public[0]["contributor"]["display_name"], "field_writer")
        self.assertNotIn("moderation_note", public[0])
        self.assertNotIn("user_id", public[0])

        store.set_contributor_visibility(self.user, False)
        self.assertEqual(store.list_approved_place_publications("camp_public")["items"], [])
        store.set_contributor_visibility(self.user, True)

        with self.assertRaises(PermissionError):
            store.retract_community_publication(self.other, submitted["id"])
        retracted = store.retract_community_publication(self.user, submitted["id"])
        self.assertEqual(retracted["status"], "retracted")
        self.assertEqual(store.list_approved_place_publications("camp_public")["items"], [])

    def test_publication_cursor_has_no_total_cap_and_account_delete_cleans_rows(self):
        notes = [
            {"id": f"note-{index:03d}", "body": f"Private source {index}", "visibility": "private"}
            for index in range(113)
        ]
        self._save_trip(notes)
        for index in range(113):
            store.submit_community_publication(
                self.user, "trip_review", f"note-{index:03d}", "trip_recap",
                f"Recap {index}", f"Reviewed public recap number {index} with enough useful field context.",
            )

        found = []
        cursor = None
        while True:
            page = store.list_community_publications_for_user(
                self.user, limit=17, cursor=cursor,
            )
            found.extend(item["id"] for item in page["items"])
            cursor = page["next_cursor"]
            if not cursor:
                break
        self.assertEqual(len(found), 113)
        self.assertEqual(len(set(found)), 113)

        store.update_communication_preferences(self.user, {"weekly_digest": True})
        store.delete_user(self.user)
        db = store._conn()
        self.assertEqual(db.execute(
            "SELECT COUNT(*) FROM community_publications WHERE user_id=?", (self.user,),
        ).fetchone()[0], 0)
        self.assertEqual(db.execute(
            "SELECT COUNT(*) FROM communication_preferences WHERE user_id=?", (self.user,),
        ).fetchone()[0], 0)
        db.close()

    def test_preference_feature_gate_defaults_off_with_admin_override(self):
        with patch.dict(os.environ, {"TRAILHEAD_DIGEST_PREFERENCES_ENABLED": "0"}):
            with self.assertRaises(HTTPException) as blocked:
                asyncio.run(api_communication_preferences(user={"id": self.user, "is_admin": 0}))
            self.assertEqual(blocked.exception.status_code, 404)
            result = asyncio.run(api_communication_preferences(
                user={"id": self.admin, "is_admin": 1}
            ))
            self.assertFalse(result["weekly_digest"])

    def test_publication_feature_gate_defaults_off_with_admin_override(self):
        with patch.dict(os.environ, {"TRAILHEAD_COMMUNITY_PUBLICATIONS_ENABLED": "0"}):
            with self.assertRaises(HTTPException) as blocked:
                asyncio.run(api_my_community_publications(
                    limit=50, cursor="", user={"id": self.user, "is_admin": 0}
                ))
            self.assertEqual(blocked.exception.status_code, 404)
            result = asyncio.run(api_my_community_publications(
                limit=50, cursor="", user={"id": self.admin, "is_admin": 1}
            ))
            self.assertEqual(result, {"items": [], "next_cursor": None})


if __name__ == "__main__":
    unittest.main()
