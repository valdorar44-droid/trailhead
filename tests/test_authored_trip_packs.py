import asyncio
import os
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from config.settings import settings
from dashboard.server import (
    api_acquire_trip_pack,
    api_admin_trip_packs,
    api_public_trip_packs,
)
from db import store


def _validation(complete: bool = True) -> dict:
    return {
        check: complete
        for check in store.TRIP_PACK_VALIDATION_CHECKS
    }


def _template(title: str = "Pack route", item_title: str = "Camp stop") -> dict:
    return {
        "schema_version": 2,
        "title": title,
        "summary": "Private editable itinerary.",
        "regions": ["UT"],
        "items": [
            {"title": item_title, "type": "camp"},
            {"id": "fuel_stop_one", "title": "Fuel stop", "type": "fuel"},
        ],
        "days": [{"day": 1, "title": "Arrival"}],
        "notes": [],
        "readiness": {"status": "review"},
        "bookings": [],
        "alerts": [],
        "offline": {},
        "route": {"coordinates": [[-109.5, 38.5], [-108.8, 39.0]]},
        "visibility": "private",
    }


class AuthoredTripPackTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()
        self.admin = store.create_user(
            "pack-admin@example.com", "pack_admin", "hash", "pack-admin-code"
        )
        store.set_user_admin(self.admin, True)
        self.user = store.create_user(
            "pack-user@example.com", "pack_user", "hash", "pack-user-code"
        )
        self.explorer = store.create_user(
            "pack-explorer@example.com", "pack_explorer", "hash", "pack-explorer-code"
        )
        store.set_user_plan(
            self.explorer,
            "com.trailhead.explorer.monthly.v2",
            int(time.time()) + 30 * 86400,
        )

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    def _draft(
        self,
        pack_id: str = "pack_moab",
        *,
        title: str = "Moab Field Loop",
        price: int = 250,
        region: str = "north_america",
        complete: bool = True,
        item_title: str = "Camp stop",
    ) -> dict:
        return store.save_authored_trip_pack_draft(
            pack_id=pack_id,
            slug=pack_id.replace("_", "-"),
            title=title,
            summary="A reviewed, editable Trailhead itinerary.",
            price_credits=price,
            coverage_region=region,
            public_metadata={"duration_days": 3, "hero_image_url": "https://example.com/hero.jpg"},
            validation_metadata=_validation(complete),
            template=_template(title, item_title),
            admin_user_id=self.admin,
        )

    def _publish(self, pack_id: str = "pack_moab", **kwargs) -> dict:
        self._draft(pack_id, **kwargs)
        return store.publish_authored_trip_pack(pack_id, self.admin)

    def test_draft_requires_complete_review_before_publication(self):
        draft = self._draft(complete=False)
        self.assertEqual(draft["status"], "draft")
        self.assertEqual(store.list_published_trip_packs()["items"], [])

        with self.assertRaisesRegex(ValueError, "review is incomplete"):
            store.publish_authored_trip_pack("pack_moab", self.admin)

        published = self._publish()
        public = store.get_published_trip_pack("pack_moab")
        admin = store.get_authored_trip_pack_admin("pack_moab")

        self.assertEqual(published["version"], 1)
        self.assertEqual(public["title"], "Moab Field Loop")
        self.assertNotIn("template", public)
        self.assertIn("template", admin)
        self.assertTrue(admin["template"]["items"][0]["id"].startswith("packitem_"))

    def test_prices_and_coverage_are_strict(self):
        with self.assertRaisesRegex(ValueError, "250, 500, or 900"):
            self._draft(price=300)
        with self.assertRaisesRegex(ValueError, "north_america or global"):
            self._draft(region="europe")

    def test_published_versions_are_immutable_when_next_draft_changes(self):
        first = self._publish(item_title="Original camp")
        first_item_id = first["template"]["items"][0]["id"]
        self._draft(title="Revised Moab Loop", item_title="Revised camp")

        still_public = store.get_published_trip_pack("pack_moab")
        second = store.publish_authored_trip_pack("pack_moab", self.admin)
        db = store._conn()
        version_one = db.execute(
            """SELECT title,template_json FROM authored_trip_pack_versions
               WHERE pack_id='pack_moab' AND version=1"""
        ).fetchone()
        db.close()

        self.assertEqual(still_public["version"], 1)
        self.assertEqual(still_public["title"], "Moab Field Loop")
        self.assertEqual(second["version"], 2)
        self.assertEqual(second["title"], "Revised Moab Loop")
        self.assertEqual(version_one["title"], "Moab Field Loop")
        self.assertIn(first_item_id, version_one["template_json"])

    def test_purchase_is_atomic_permanent_idempotent_and_clones_private_trip(self):
        published = self._publish()
        stable_item_ids = [item["id"] for item in published["template"]["items"]]
        store.add_credits(self.user, 300, "Pack test balance")

        acquired = store.acquire_authored_trip_pack(
            self.user, "pack_moab", "purchase-moab"
        )
        replay = store.acquire_authored_trip_pack(
            self.user, "pack_moab", "purchase-moab"
        )
        owned_again = store.acquire_authored_trip_pack(
            self.user, "pack_moab", "purchase-moab-again"
        )

        self.assertEqual(acquired["entitlement"]["credits_charged"], 250)
        self.assertTrue(acquired["entitlement"]["permanent"])
        self.assertEqual(acquired["credit_balance"], 50)
        self.assertEqual(acquired["trip"]["status"], "draft")
        self.assertEqual(acquired["trip"]["visibility"], "private")
        self.assertEqual(acquired["trip"]["source"], "trip_pack:pack_moab:v1")
        self.assertEqual([item["id"] for item in acquired["trip"]["items"]], stable_item_ids)
        self.assertEqual(replay["entitlement"]["id"], acquired["entitlement"]["id"])
        self.assertTrue(replay["replayed"])
        self.assertEqual(owned_again["entitlement"]["id"], acquired["entitlement"]["id"])
        self.assertTrue(owned_again["already_owned"])
        self.assertEqual(store.get_user_by_id(self.user)["credits"], 50)
        debits = [row["amount"] for row in store.get_credit_history(self.user) if row["amount"] < 0]
        self.assertEqual(debits, [-250])

    def test_active_explorer_gets_exact_twenty_percent_discount(self):
        self._publish(price=500)
        store.add_credits(self.explorer, 400, "Explorer pack balance")

        acquired = store.acquire_authored_trip_pack(
            self.explorer, "pack_moab", "explorer-purchase"
        )

        self.assertEqual(acquired["entitlement"]["list_price_credits"], 500)
        self.assertEqual(acquired["entitlement"]["explorer_discount"], 100)
        self.assertEqual(acquired["entitlement"]["credits_charged"], 400)
        self.assertEqual(acquired["credit_balance"], 0)

    def test_insufficient_purchase_maps_to_structured_402(self):
        self._publish(price=900)

        with patch.dict(os.environ, {"TRAILHEAD_TRIP_PACKS_ENABLED": "1"}):
            with self.assertRaises(HTTPException) as payment:
                asyncio.run(api_acquire_trip_pack(
                    "pack_moab", "insufficient-pack", {"id": self.user}
                ))

        self.assertEqual(payment.exception.status_code, 402)
        self.assertEqual(payment.exception.detail["code"], "trip_pack_credits")
        self.assertEqual(payment.exception.detail["credits_needed"], 900)
        self.assertEqual(payment.exception.detail["list_price_credits"], 900)
        self.assertTrue(payment.exception.detail["earn_hint"])
        self.assertEqual(store.list_owned_authored_trip_packs(self.user), [])
        self.assertEqual(store.list_trip_documents_v2(self.user)["items"], [])

    def test_trip_pack_flag_defaults_off_while_admin_publishing_remains_available(self):
        self._publish()
        with patch.dict(os.environ, {"TRAILHEAD_TRIP_PACKS_ENABLED": "0"}):
            with self.assertRaises(HTTPException) as gated:
                asyncio.run(api_public_trip_packs())
            admin_result = asyncio.run(api_admin_trip_packs({
                "id": self.admin,
                "is_admin": 1,
            }))

        self.assertEqual(gated.exception.status_code, 404)
        self.assertEqual(gated.exception.detail["code"], "feature_unavailable")
        self.assertEqual(len(admin_result["items"]), 1)

    def test_featured_claim_is_server_selected_explorer_only_and_monthly(self):
        first = self._publish("pack_featured", price=500)
        self._publish("pack_second", price=250)
        month = store._utc_month()
        store.select_featured_trip_pack(month, "pack_featured", self.admin)

        with self.assertRaises(store.ExplorerTripPackClaimRequiredError):
            store.claim_featured_authored_trip_pack(
                self.user, "free-featured-claim"
            )
        claimed = store.claim_featured_authored_trip_pack(
            self.explorer, "explorer-featured-claim"
        )
        replay = store.claim_featured_authored_trip_pack(
            self.explorer, "explorer-featured-claim"
        )

        self.assertEqual(claimed["entitlement"]["pack_id"], first["id"])
        self.assertEqual(claimed["entitlement"]["version"], first["version"])
        self.assertEqual(claimed["entitlement"]["acquisition_type"], "featured_claim")
        self.assertEqual(claimed["entitlement"]["credits_charged"], 0)
        self.assertEqual(claimed["entitlement"]["claim_month"], month)
        self.assertTrue(replay["replayed"])

        store.select_featured_trip_pack(month, "pack_second", self.admin)
        with self.assertRaises(store.MonthlyTripPackClaimUsedError):
            store.claim_featured_authored_trip_pack(
                self.explorer, "second-featured-claim"
            )

    def test_owned_version_remains_pinned_and_restore_recreates_deleted_trip(self):
        first = self._publish(item_title="Version one camp")
        store.add_credits(self.user, 500, "Restore balance")
        acquired = store.acquire_authored_trip_pack(
            self.user, "pack_moab", "restore-purchase"
        )
        old_trip_id = acquired["trip"]["trip_id"]
        old_item_ids = [item["id"] for item in acquired["trip"]["items"]]
        self._draft(title="Version two", item_title="Version two camp")
        store.publish_authored_trip_pack("pack_moab", self.admin)
        db = store._conn()
        db.execute(
            "UPDATE trip_documents_v2 SET status='deleted',deleted_at=? WHERE id=?",
            (int(time.time()), old_trip_id),
        )
        db.commit()
        db.close()

        before_restore = store.list_owned_authored_trip_packs(self.user)[0]
        restored = store.restore_owned_authored_trip_packs(self.user)[0]

        self.assertEqual(before_restore["entitlement"]["version"], first["version"])
        self.assertIsNone(before_restore["trip"])
        self.assertEqual(restored["entitlement"]["version"], first["version"])
        self.assertNotEqual(restored["trip"]["trip_id"], old_trip_id)
        self.assertEqual([item["id"] for item in restored["trip"]["items"]], old_item_ids)
        self.assertEqual(store.get_user_by_id(self.user)["credits"], 250)

    def test_account_deletion_removes_entitlement_but_not_authored_pack(self):
        self._publish()
        store.add_credits(self.user, 250, "Deletion balance")
        store.acquire_authored_trip_pack(
            self.user, "pack_moab", "delete-pack-entitlement"
        )

        store.delete_user(self.user)

        db = store._conn()
        entitlement_count = db.execute(
            "SELECT COUNT(*) FROM authored_trip_pack_entitlements WHERE user_id=?",
            (self.user,),
        ).fetchone()[0]
        pack_count = db.execute(
            "SELECT COUNT(*) FROM authored_trip_packs WHERE id='pack_moab'"
        ).fetchone()[0]
        db.close()
        self.assertEqual(entitlement_count, 0)
        self.assertEqual(pack_count, 1)

    def test_release_validation_requires_inventory_and_near_seventy_thirty_mix(self):
        empty = store.authored_trip_pack_release_validation()
        self.assertFalse(empty["launch_ready"])
        self.assertEqual(empty["published_total"], 0)
        self.assertTrue(empty["issues"])

        for index in range(7):
            self._publish(f"pack_na_{index}", region="north_america")
        for index in range(3):
            self._publish(f"pack_global_{index}", region="global")
        ready = store.authored_trip_pack_release_validation()

        self.assertTrue(ready["launch_ready"])
        self.assertEqual(ready["published_total"], 10)
        self.assertEqual(ready["counts"], {"north_america": 7, "global": 3})
        self.assertAlmostEqual(ready["north_america_ratio"], 0.7)


if __name__ == "__main__":
    unittest.main()
