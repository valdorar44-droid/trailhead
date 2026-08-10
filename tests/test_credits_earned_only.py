import asyncio
import os
import tempfile
import unittest

from fastapi import HTTPException

from config.settings import settings
from dashboard import server
from db import store


class EarnedOnlyCreditTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        temporary = tempfile.NamedTemporaryFile(delete=False)
        temporary.close()
        self.database_path = temporary.name
        settings.db_path = self.database_path
        store.init_db()
        self.user_id = store.create_user(
            "earned-only@example.com",
            "earned_only",
            "hash",
            "earned-only-code",
        )

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.database_path + suffix)
            except FileNotFoundError:
                pass

    def test_purchase_endpoints_return_the_same_stable_earned_only_contract(self):
        expected = {
            "code": "credits_earned_only",
            "message": "Trail credits are earned through Trailhead contributions and cannot be purchased.",
            "purchase_available": False,
        }
        with self.assertRaises(HTTPException) as packages:
            asyncio.run(server.credit_packages())
        with self.assertRaises(HTTPException) as checkout:
            asyncio.run(server.create_checkout(
                server.CheckoutRequest(package_id="starter"),
                {"id": self.user_id},
            ))
        self.assertEqual(packages.exception.status_code, 410)
        self.assertEqual(checkout.exception.status_code, 410)
        self.assertEqual(packages.exception.detail, expected)
        self.assertEqual(checkout.exception.detail, expected)

    def test_legacy_open_session_settles_once_in_one_ledger_transaction(self):
        settled = store.settle_stripe_credit_purchase(
            "cs_legacy_open",
            self.user_id,
            "explorer",
            350,
            799,
            "Purchased explorer pack — 350 credits",
        )
        replayed = store.settle_stripe_credit_purchase(
            "cs_legacy_open",
            self.user_id,
            "explorer",
            350,
            799,
            "Purchased explorer pack — 350 credits",
        )

        self.assertTrue(settled)
        self.assertFalse(replayed)
        self.assertEqual(store.get_user_by_id(self.user_id)["credits"], 350)
        ledger = store.get_credit_history(self.user_id)
        matches = [row for row in ledger if row["reason"] == "Purchased explorer pack — 350 credits"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["amount"], 350)
        db = store._conn()
        try:
            purchase = db.execute(
                "SELECT user_id,credits,purchase_kind FROM stripe_purchases WHERE session_id=?",
                ("cs_legacy_open",),
            ).fetchone()
        finally:
            db.close()
        self.assertEqual(dict(purchase), {
            "user_id": self.user_id,
            "credits": 350,
            "purchase_kind": "stripe",
        })

    def test_replayed_session_with_changed_metadata_fails_closed(self):
        store.settle_stripe_credit_purchase(
            "cs_metadata_bound",
            self.user_id,
            "starter",
            100,
            299,
            "Purchased starter pack — 100 credits",
        )
        with self.assertRaisesRegex(ValueError, "does not match"):
            store.settle_stripe_credit_purchase(
                "cs_metadata_bound",
                self.user_id,
                "explorer",
                350,
                799,
                "Purchased explorer pack — 350 credits",
            )
        other_user_id = store.create_user(
            "other-earned-only@example.com",
            "other_earned_only",
            "hash",
            "other-earned-only-code",
        )
        with self.assertRaisesRegex(ValueError, "does not match"):
            store.settle_stripe_credit_purchase(
                "cs_metadata_bound",
                other_user_id,
                "starter",
                100,
                299,
                "Purchased starter pack — 100 credits",
            )
        self.assertEqual(store.get_user_by_id(self.user_id)["credits"], 100)
        self.assertEqual(store.get_user_by_id(other_user_id)["credits"], 0)

    def test_delayed_checkout_must_match_frozen_package_credits_currency_and_amount(self):
        valid = {
            "id": "cs_historical_starter",
            "mode": "payment",
            "payment_status": "paid",
            "currency": "usd",
            "amount_total": 299,
            "metadata": {
                "user_id": str(self.user_id),
                "package_id": "starter",
                "credits": "100",
            },
        }
        self.assertEqual(server._legacy_credit_settlement_from_session(valid), {
            "session_id": "cs_historical_starter",
            "user_id": self.user_id,
            "package_id": "starter",
            "credits": 100,
            "amount_total": 299,
        })
        for field, value in (
            ("amount_total", 1),
            ("currency", "cad"),
            ("mode", "subscription"),
        ):
            changed = dict(valid)
            changed[field] = value
            self.assertIsNone(server._legacy_credit_settlement_from_session(changed))
        changed_metadata = dict(valid)
        changed_metadata["metadata"] = {**valid["metadata"], "credits": "3000"}
        self.assertIsNone(server._legacy_credit_settlement_from_session(changed_metadata))
        unknown_package = dict(valid)
        unknown_package["metadata"] = {**valid["metadata"], "package_id": "invented"}
        self.assertIsNone(server._legacy_credit_settlement_from_session(unknown_package))


if __name__ == "__main__":
    unittest.main()
