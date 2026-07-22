import asyncio
import os
import tempfile
import time
import unittest

from fastapi import HTTPException

from config.settings import settings
from dashboard import server
from db import store


class ReferralContestSupportTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()
        self.admin = store.create_user(
            "contest-admin@example.com", "contest_admin", "hash", "Admin-Code"
        )
        store.set_user_admin(self.admin, True)

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    def test_referral_lookup_and_rewards_are_normalized_and_idempotent(self):
        referrer = store.create_user(
            "referrer@example.com", "referrer", "hash", "Trail-Friend-ABC"
        )
        found = store.get_user_by_referral_code("  trail-friend-abc  ")
        self.assertEqual(found["id"], referrer)

        referred = store.create_user(
            "referred@example.com",
            "referred",
            "hash",
            "referred-code",
            referred_by=referrer,
        )
        store.add_credits(referred, 7, "Existing earned credits")

        first = store.grant_signup_rewards(referred, 50, 20)
        second = store.grant_signup_rewards(referred, 50, 20)

        self.assertEqual(first, {"welcome_granted": True, "referral_granted": True})
        self.assertEqual(second, {"welcome_granted": False, "referral_granted": False})
        self.assertEqual(store.get_user_by_id(referred)["credits"], 57)
        self.assertEqual(store.get_user_by_id(referrer)["credits"], 20)

        db = store._conn()
        rewards = db.execute(
            """SELECT user_id,reward_key FROM credit_transactions
               WHERE reward_key IS NOT NULL ORDER BY user_id,reward_key"""
        ).fetchall()
        referral = db.execute(
            "SELECT * FROM referrals WHERE referrer_id=?",
            (referrer,),
        ).fetchone()
        db.close()
        self.assertEqual(len(rewards), 2)
        self.assertEqual(referral["status"], "converted")
        self.assertIsNotNone(referral["converted_at"])

    def test_oauth_accounts_preserve_referral_attribution(self):
        referrer = store.create_user(
            "oauth-referrer@example.com", "oauth_referrer", "hash", "oauth-referrer-code"
        )
        oauth_user = store.create_oauth_user(
            "oauth-new@example.com",
            "oauth_new",
            "hash",
            "google",
            "google-subject-1",
            referred_by=referrer,
        )
        self.assertEqual(store.get_user_by_id(oauth_user)["referred_by"], referrer)

    def test_active_plan_immediately_creates_monthly_subscriber_entry(self):
        subscriber = store.create_user(
            "subscriber@example.com", "subscriber", "hash", "subscriber-code"
        )
        store.set_user_plan(subscriber, "explorer", int(time.time()) + 86400)
        month, _ = store._contest_period()
        db = store._conn()
        entry = db.execute(
            "SELECT * FROM contest_entries WHERE user_id=? AND period_month=?",
            (subscriber, month),
        ).fetchone()
        db.close()
        self.assertIsNotNone(entry)
        self.assertEqual(entry["entry_type"], "subscriber")

    def test_purchase_activation_enters_and_upgrades_monthly_drawing(self):
        subscriber = store.create_user(
            "purchase-subscriber@example.com", "purchase_subscriber", "hash", "purchase-code"
        )
        store.ensure_contest_entry(subscriber, "free")

        store.activate_plan(subscriber, "explorer", 30)

        status = store.get_contest_user_status(subscriber)
        self.assertTrue(status["drawing_entered"])
        self.assertEqual(status["drawing_entry_type"], "subscriber")

        # A later free-entry request must not downgrade a subscriber entry.
        store.ensure_contest_entry(subscriber, "free")
        self.assertEqual(
            store.get_contest_user_status(subscriber)["drawing_entry_type"],
            "subscriber",
        )

    def test_empty_contest_period_cannot_create_a_winnerless_award(self):
        with self.assertRaisesRegex(ValueError, "No eligible contributor"):
            store.snapshot_contest_award("monthly_top", self.admin, "2099-01", "2099")
        with self.assertRaisesRegex(ValueError, "No eligible entries"):
            store.run_contest_drawing(self.admin, "2099-01", "2099")

        db = store._conn()
        count = db.execute(
            "SELECT COUNT(*) FROM contest_awards WHERE period_year='2099'"
        ).fetchone()[0]
        db.close()
        self.assertEqual(count, 0)

    def test_drawing_and_winner_message_are_idempotent(self):
        subscriber = store.create_user(
            "winner@example.com", "winner", "hash", "winner-code"
        )
        store.set_user_plan(subscriber, "explorer", int(time.time()) + 86400)
        month, year = store._contest_period()

        first_award = store.run_contest_drawing(self.admin, month, year)
        second_award = store.run_contest_drawing(self.admin, month, year)
        self.assertEqual(first_award["id"], second_award["id"])
        self.assertEqual(first_award["winner_user_id"], subscriber)
        self.assertEqual(first_award["entry_count"], 1)

        first_thread = store.ensure_contest_award_support_thread(first_award["id"], self.admin)
        second_thread = store.ensure_contest_award_support_thread(first_award["id"], self.admin)
        self.assertTrue(first_thread["created"])
        self.assertFalse(second_thread["created"])
        self.assertEqual(first_thread["thread_id"], second_thread["thread_id"])

        detail = store.get_support_thread(first_thread["thread_id"], admin=True)
        self.assertEqual(detail["category"], "contest_award")
        message = detail["messages"][0]
        self.assertIn("Cash App", message["body"])
        self.assertIn("PayPal", message["body"])
        self.assertIn("bank deposit", message["body"])
        self.assertFalse(message["meta"]["sensitive_details_allowed"])

        db = store._conn()
        award = db.execute(
            "SELECT status FROM contest_awards WHERE id=?",
            (first_award["id"],),
        ).fetchone()
        thread_count = db.execute(
            "SELECT COUNT(*) FROM support_threads WHERE contest_award_id=?",
            (first_award["id"],),
        ).fetchone()[0]
        db.close()
        self.assertEqual(award["status"], "notified")
        self.assertEqual(thread_count, 1)

    def test_support_chat_rejects_plaintext_financial_secrets(self):
        server._reject_plaintext_support_secrets("I prefer PayPal for the prize.")
        server._reject_plaintext_support_secrets("Please send the secure bank-deposit step.")
        server._reject_plaintext_support_secrets("Do not send bank account or routing numbers in chat.")

        for text in (
            "My routing number is 123456789",
            "account number: 12345678",
            "credit card 4111 1111 1111 1111",
            "password: secret-value",
            "Please provide your routing number here",
        ):
            with self.subTest(text=text):
                with self.assertRaises(HTTPException) as raised:
                    server._reject_plaintext_support_secrets(text)
                self.assertEqual(raised.exception.status_code, 400)

    def test_support_endpoints_reject_secrets_in_subjects_and_admin_messages(self):
        target_id = store.create_user(
            "support-target@example.com", "support_target", "hash", "support-code"
        )
        target = store.get_user_by_id(target_id)
        admin = store.get_user_by_id(self.admin)

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(server.support_inbox_message(
                server.SupportInboxMessageBody(
                    subject="Account number: 12345678",
                    body="Please help with my prize.",
                ),
                user=target,
            ))
        self.assertEqual(raised.exception.status_code, 400)

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(server.support_inbox_message(
                server.SupportInboxMessageBody(body="x" * 4001),
                user=target,
            ))
        self.assertEqual(raised.exception.status_code, 400)

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(server.admin_support_thread_start(
                server.AdminSupportThreadCreateBody(
                    user_id=target_id,
                    subject="Prize coordination",
                    body="Your routing number is 123456789",
                ),
                admin=admin,
            ))
        self.assertEqual(raised.exception.status_code, 400)

        thread_id = store.create_support_thread(
            target_id,
            "Prize coordination",
            initial_body="Please choose a payout method.",
            admin_id=self.admin,
        )
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(server.admin_support_thread_message(
                thread_id,
                server.AdminSupportThreadMessageBody(body="Card number 4111 1111 1111 1111"),
                admin=admin,
            ))
        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
