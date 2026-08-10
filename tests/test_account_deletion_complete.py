import asyncio
import base64
import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from config.settings import settings
from db import store


class CompleteAccountDeletionTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()
        self.user = store.create_user(
            "delete-complete@example.com", "delete_complete", "hash", "delete-complete-code"
        )
        self.other = store.create_user(
            "keep-complete@example.com", "keep_complete", "hash", "keep-complete-code"
        )

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    def _seed_account_data(self, user_id: int, suffix: str) -> dict:
        now = int(time.time())
        original_transaction_id = f"app-original-{suffix}"
        stripe_session_id = f"stripe-session-{suffix}"
        booking_reference = f"viator-booking-{suffix}"
        store.save_app_store_subscription(
            original_transaction_id,
            f"app-transaction-{suffix}",
            user_id,
            "trailhead.explorer.monthly",
            "Production",
            now + 86400,
        )
        booking = store.save_viator_booking_intent(
            user_id,
            f"product-{suffix}",
            product_title=f"Tour {suffix}",
            amount=49.0,
        )
        store.update_viator_booking(
            booking["id"],
            user_id,
            status="confirmed",
            booking_reference=booking_reference,
            cart_id=f"private-cart-{suffix}",
            voucher_url=f"https://private.example/{suffix}",
            provider_payload={"private": f"provider-secret-{suffix}"},
        )

        db = store._conn()
        db.execute(
            "INSERT INTO stripe_purchases(session_id,user_id,credits,created_at) VALUES (?,?,?,?)",
            (stripe_session_id, user_id, 25, now),
        )
        db.execute(
            """INSERT INTO offline_downloads
               (user_id,asset_type,region_id,cost,free_used,created_at)
               VALUES (?,?,?,?,?,?)""",
            (user_id, "trail_pack", f"region-{suffix}", 2, 0, now),
        )
        db.execute(
            """INSERT INTO map_contributor_applications
               (user_id,username,experience,regions,sample_note,status,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                user_id,
                f"contributor-{suffix}",
                f"private experience {suffix}",
                f"private regions {suffix}",
                f"private sample {suffix}",
                "pending",
                now,
                now,
            ),
        )
        session_id = f"extreme-session-{suffix}"
        db.execute(
            """INSERT INTO extreme_demo_sessions
               (session_id,user_id,surface,trip_id,status,started_at,expires_at,metadata)
               VALUES (?,?,?,?,?,?,?,?)""",
            (session_id, user_id, "copilot", f"trip-{suffix}", "active", now, now + 600, "{}"),
        )
        db.execute(
            """INSERT INTO extreme_ledger_events
               (session_id,user_id,event_type,surface,trip_id,event_data,created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (session_id, user_id, "started", "copilot", f"trip-{suffix}", "{}", now),
        )
        db.execute(
            """INSERT INTO extreme_trip_metadata
               (user_id,trip_id,checkpoints,trip_memory,updated_at)
               VALUES (?,?,?,?,?)""",
            (user_id, f"trip-{suffix}", "[]", json.dumps({"private": suffix}), now),
        )
        db.execute(
            """INSERT INTO extreme_copilot_actions
               (user_id,session_id,trip_id,command,action_type,status,payload,created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                user_id,
                session_id,
                f"trip-{suffix}",
                f"private command {suffix}",
                "search",
                "staged",
                json.dumps({"private": suffix}),
                now,
            ),
        )
        db.execute(
            """INSERT INTO extreme_admin_config(config_key,value_json,updated_by,updated_at)
               VALUES (?,?,?,?)""",
            (f"config-{suffix}", "{}", user_id, now),
        )
        campaign = db.execute(
            """INSERT INTO push_campaigns
               (campaign_key,campaign_type,title,body,status,created_by,created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (f"campaign-{suffix}", "manual", "Title", "Body", "sent", user_id, now),
        )
        campaign_id = int(campaign.lastrowid)
        db.execute(
            """INSERT INTO push_campaign_deliveries
               (campaign_id,user_id,push_token,delivery_status,response_json,error_text,created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (
                campaign_id,
                user_id,
                f"private-push-token-{suffix}",
                "sent",
                json.dumps({"provider": f"private-{suffix}"}),
                None,
                now,
            ),
        )
        db.commit()
        db.close()
        return {
            "original_transaction_id": original_transaction_id,
            "stripe_session_id": stripe_session_id,
            "booking_reference": booking_reference,
            "campaign_id": campaign_id,
            "suffix": suffix,
        }

    def _assert_account_data_removed(self, user_id: int, seeded: dict) -> None:
        db = store._conn()
        self.assertIsNone(db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone())
        for table in (
            "app_store_subscriptions",
            "viator_bookings",
            "offline_downloads",
            "map_contributor_applications",
            "extreme_demo_sessions",
            "extreme_ledger_events",
            "extreme_trip_metadata",
            "extreme_copilot_actions",
            "push_campaign_deliveries",
            "stripe_purchases",
        ):
            count = db.execute(f'SELECT COUNT(*) FROM "{table}" WHERE user_id=?', (user_id,)).fetchone()[0]
            self.assertEqual(count, 0, table)
        campaign = db.execute(
            "SELECT created_by FROM push_campaigns WHERE id=?", (seeded["campaign_id"],)
        ).fetchone()
        self.assertIsNotNone(campaign)
        self.assertIsNone(campaign["created_by"])
        config = db.execute(
            "SELECT updated_by FROM extreme_admin_config WHERE config_key=?",
            (f"config-{seeded['suffix']}",),
        ).fetchone()
        self.assertIsNotNone(config)
        self.assertIsNone(config["updated_by"])

        self.assertIsNone(
            db.execute(
                """SELECT name FROM sqlite_master
                   WHERE type='table' AND name='retained_transaction_records_v1'"""
            ).fetchone()
        )
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        db.close()

    def test_full_delete_covers_subscription_booking_offline_contributor_copilot_and_push(self):
        deleted = self._seed_account_data(self.user, "deleted")
        retained = self._seed_account_data(self.other, "retained")

        store.delete_user(self.user)

        self._assert_account_data_removed(self.user, deleted)
        self.assertIsNotNone(store.get_user_by_id(self.other))
        db = store._conn()
        for table in (
            "app_store_subscriptions",
            "viator_bookings",
            "offline_downloads",
            "map_contributor_applications",
            "extreme_demo_sessions",
            "extreme_ledger_events",
            "extreme_trip_metadata",
            "extreme_copilot_actions",
            "push_campaign_deliveries",
            "stripe_purchases",
        ):
            count = db.execute(f'SELECT COUNT(*) FROM "{table}" WHERE user_id=?', (self.other,)).fetchone()[0]
            self.assertEqual(count, 1, table)
        other_campaign = db.execute(
            "SELECT created_by FROM push_campaigns WHERE id=?", (retained["campaign_id"],)
        ).fetchone()
        self.assertEqual(other_campaign["created_by"], self.other)
        db.close()

    def test_retry_recovery_keeps_foreign_keys_enabled_and_checks_integrity(self):
        seeded = self._seed_account_data(self.user, "retry")
        observed_foreign_keys = []
        original_delete = store._delete_user_account_data

        def record_fk_state(db, user_id):
            observed_foreign_keys.append(db.execute("PRAGMA foreign_keys").fetchone()[0])
            return original_delete(db, user_id)

        with patch.object(
            store,
            "_delete_user_full",
            side_effect=sqlite3.OperationalError("database is locked"),
        ) as full_delete, patch.object(store.time, "sleep"), patch.object(
            store,
            "_delete_user_account_data",
            side_effect=record_fk_state,
        ), patch.object(
            store,
            "_assert_no_new_foreign_key_violations",
            wraps=store._assert_no_new_foreign_key_violations,
        ) as integrity_check:
            store.delete_user(self.user)

        self.assertEqual(full_delete.call_count, 3)
        self.assertEqual(observed_foreign_keys, [1])
        integrity_check.assert_called_once()
        self._assert_account_data_removed(self.user, seeded)

    def test_deletion_handles_child_links_inbound_identity_and_private_feedback(self):
        now = int(time.time())
        referred_user = store.create_user(
            "referred-child@example.com",
            "referred_child",
            "hash",
            "referred-child-code",
            referred_by=self.user,
        )
        store.log_ai_usage(self.user, "private-copilot-action")
        db = store._conn()
        db.execute(
            """INSERT INTO places
               (trailhead_place_id,source,name,lat,lng,last_seen,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            ("place-deletion", "fixture", "Deletion fixture", 38.0, -109.0, now, now, now),
        )
        comment = db.execute(
            """INSERT INTO place_comments
               (trailhead_place_id,user_id,username,body,created_at)
               VALUES (?,?,?,?,?)""",
            ("place-deletion", self.user, "delete_complete", "private comment", now),
        )
        comment_id = int(comment.lastrowid)
        other_photo = db.execute(
            """INSERT INTO place_photos
               (trailhead_place_id,user_id,username,comment_id,url,caption,created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (
                "place-deletion",
                self.other,
                "keep_complete",
                comment_id,
                "https://images.example/keep.jpg",
                "Keep this photo",
                now,
            ),
        )
        other_photo_id = int(other_photo.lastrowid)
        db.execute(
            """INSERT INTO place_photos
               (trailhead_place_id,user_id,username,comment_id,url,caption,created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (
                "place-deletion",
                self.user,
                "delete_complete",
                comment_id,
                "https://images.example/delete.jpg",
                "private photo",
                now,
            ),
        )
        db.execute(
            """INSERT INTO referrals
               (referrer_id,referred_email,status,created_at)
               VALUES (?,?,?,?)""",
            (self.other, "delete-complete@example.com", "pending", now),
        )
        db.execute(
            """INSERT INTO dispersed_site_leads
               (lead_key,source_batch,source_record_hash,lat,lng,rounded_lat,rounded_lng,
                category,reviewed_by,published_by,imported_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                "lead-deletion",
                "fixture",
                "fixture-hash",
                38.0,
                -109.0,
                38.0,
                -109.0,
                "dispersed",
                self.user,
                self.user,
                now,
                now,
            ),
        )
        badge = db.execute(
            """INSERT INTO contributor_badges
               (user_id,badge_id,label,granted_by,created_at)
               VALUES (?,?,?,?,?)""",
            (self.other, "helpful", "Helpful contributor", self.user, now),
        )
        badge_id = int(badge.lastrowid)
        db.execute(
            """INSERT INTO authored_trip_packs
               (id,slug,status,draft_title,draft_summary,draft_price_credits,
                draft_coverage_region,draft_template_json,current_published_version,
                created_by,updated_by,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                "original-feedback-pack",
                "original-feedback-pack",
                "published",
                "Feedback pack",
                "Fixture",
                0,
                "fixture",
                "{}",
                1,
                self.user,
                self.user,
                now,
                now,
            ),
        )
        db.execute(
            """INSERT INTO authored_trip_pack_versions
               (pack_id,version,slug,title,summary,price_credits,coverage_region,
                template_json,published_by,published_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                "original-feedback-pack",
                1,
                "original-feedback-pack",
                "Feedback pack",
                "Fixture",
                0,
                "fixture",
                "{}",
                self.user,
                now,
            ),
        )
        db.execute(
            """INSERT INTO authored_original_feedback
               (id,pack_id,version,user_id,idempotency_key,request_hash,category,
                message,platform,status,submitted_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                "feedback-delete",
                "original-feedback-pack",
                1,
                self.user,
                "feedback-delete-key",
                "feedback-delete-hash",
                "story",
                "private feedback message and contact details",
                "android",
                "new",
                now,
                now,
            ),
        )
        db.execute(
            """INSERT INTO authored_original_feedback
               (id,pack_id,version,user_id,idempotency_key,request_hash,category,
                message,platform,status,moderated_by,submitted_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                "feedback-keep",
                "original-feedback-pack",
                1,
                self.other,
                "feedback-keep-key",
                "feedback-keep-hash",
                "story",
                "other account feedback",
                "ios",
                "reviewed",
                self.user,
                now,
                now,
            ),
        )
        db.commit()
        db.close()

        store.delete_user(self.user)

        db = store._conn()
        photo = db.execute(
            "SELECT user_id,comment_id FROM place_photos WHERE id=?", (other_photo_id,)
        ).fetchone()
        self.assertIsNotNone(photo)
        self.assertEqual(photo["user_id"], self.other)
        self.assertIsNone(photo["comment_id"])
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM place_photos WHERE user_id=?", (self.user,)).fetchone()[0],
            0,
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM place_comments WHERE user_id=?", (self.user,)).fetchone()[0],
            0,
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM ai_usage_log WHERE user_id=?", (self.user,)).fetchone()[0],
            0,
        )
        self.assertIsNone(
            db.execute("SELECT referred_by FROM users WHERE id=?", (referred_user,)).fetchone()[
                "referred_by"
            ]
        )
        self.assertEqual(
            db.execute(
                "SELECT COUNT(*) FROM referrals WHERE lower(referred_email)=lower(?)",
                ("delete-complete@example.com",),
            ).fetchone()[0],
            0,
        )
        lead = db.execute(
            "SELECT reviewed_by,published_by FROM dispersed_site_leads WHERE lead_key='lead-deletion'"
        ).fetchone()
        self.assertIsNone(lead["reviewed_by"])
        self.assertIsNone(lead["published_by"])
        retained_badge = db.execute(
            "SELECT user_id,granted_by FROM contributor_badges WHERE id=?", (badge_id,)
        ).fetchone()
        self.assertIsNotNone(retained_badge)
        self.assertEqual(retained_badge["user_id"], self.other)
        self.assertIsNone(retained_badge["granted_by"])
        self.assertIsNone(
            db.execute("SELECT id FROM authored_original_feedback WHERE id='feedback-delete'").fetchone()
        )
        kept_feedback = db.execute(
            "SELECT message,moderated_by FROM authored_original_feedback WHERE id='feedback-keep'"
        ).fetchone()
        self.assertEqual(kept_feedback["message"], "other account feedback")
        self.assertIsNone(kept_feedback["moderated_by"])
        pack = db.execute(
            """SELECT created_by,updated_by FROM authored_trip_packs
               WHERE id='original-feedback-pack'"""
        ).fetchone()
        self.assertIsNone(pack["created_by"])
        self.assertIsNone(pack["updated_by"])
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        db.close()

    def test_integrity_check_failure_rolls_back_before_commit(self):
        seeded = self._seed_account_data(self.user, "integrity-rollback")
        with patch.object(
            store,
            "_assert_no_new_foreign_key_violations",
            side_effect=RuntimeError("forced foreign-key audit failure"),
        ):
            with self.assertRaisesRegex(RuntimeError, "forced foreign-key audit failure"):
                store.delete_user(self.user)

        self.assertIsNotNone(store.get_user_by_id(self.user))
        db = store._conn()
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM offline_downloads WHERE user_id=?", (self.user,)).fetchone()[0],
            1,
        )
        self.assertEqual(
            db.execute(
                "SELECT COUNT(*) FROM push_campaign_deliveries WHERE campaign_id=?",
                (seeded["campaign_id"],),
            ).fetchone()[0],
            1,
        )
        db.close()

    def test_unrelated_legacy_foreign_key_orphan_does_not_block_deletion(self):
        db = store._conn()
        db.execute("CREATE TABLE legacy_parent (id INTEGER PRIMARY KEY)")
        db.execute(
            """CREATE TABLE legacy_child (
                   id INTEGER PRIMARY KEY,
                   parent_id INTEGER NOT NULL REFERENCES legacy_parent(id)
               )"""
        )
        db.commit()
        db.close()

        raw = sqlite3.connect(self.db_path)
        raw.execute("PRAGMA foreign_keys=OFF")
        raw.execute("INSERT INTO legacy_child(id,parent_id) VALUES (1,999)")
        raw.commit()
        raw.close()

        before = store._conn()
        baseline = store._foreign_key_violation_keys(before)
        before.close()
        self.assertEqual(baseline, frozenset({("legacy_child", 1, "legacy_parent", 0)}))

        store.delete_user(self.user)

        self.assertIsNone(store.get_user_by_id(self.user))
        after = store._conn()
        self.assertEqual(store._foreign_key_violation_keys(after), baseline)
        self.assertEqual(
            after.execute("SELECT parent_id FROM legacy_child WHERE id=1").fetchone()[0],
            999,
        )
        after.close()

    def test_new_foreign_key_violation_created_during_deletion_rolls_back(self):
        db = store._conn()
        db.execute("CREATE TABLE deletion_parent (id INTEGER PRIMARY KEY)")
        db.execute(
            """CREATE TABLE deletion_child (
                   id INTEGER PRIMARY KEY,
                   parent_id INTEGER NOT NULL
                       REFERENCES deletion_parent(id) DEFERRABLE INITIALLY DEFERRED
               )"""
        )
        db.execute(
            f"""CREATE TRIGGER inject_deletion_orphan
                AFTER DELETE ON users
                WHEN OLD.id={int(self.user)}
                BEGIN
                    INSERT INTO deletion_child(parent_id) VALUES (999);
                END"""
        )
        db.commit()
        db.close()

        with self.assertRaisesRegex(
            RuntimeError,
            "Account deletion foreign-key check failed: deletion_child",
        ):
            store.delete_user(self.user)

        self.assertIsNotNone(store.get_user_by_id(self.user))
        after = store._conn()
        self.assertEqual(after.execute("SELECT COUNT(*) FROM deletion_child").fetchone()[0], 0)
        self.assertEqual(after.execute("PRAGMA foreign_key_check").fetchall(), [])
        after.close()

    def test_provider_replays_after_deletion_are_safe_noops(self):
        initial_credits = store.get_user_by_id(self.user)["credits"]
        self.assertTrue(
            store.fulfill_stripe_purchase(
                "stripe-before-delete",
                self.user,
                25,
                "Purchased test pack — 25 credits",
            )
        )
        self.assertTrue(
            store.fulfill_stripe_purchase(
                "stripe-before-delete",
                self.user,
                25,
                "Purchased test pack — 25 credits",
            )
        )
        self.assertEqual(store.get_user_by_id(self.user)["credits"], initial_credits + 25)

        store.delete_user(self.user)

        self.assertFalse(store.add_credits(self.user, 25, "late Stripe replay"))
        self.assertFalse(
            store.fulfill_stripe_purchase("stripe-after-delete", self.user, 25)
        )
        self.assertFalse(
            store.fulfill_stripe_purchase("google-after-delete", self.user, 0)
        )
        self.assertFalse(
            store.save_app_store_subscription(
                "apple-original-after-delete",
                "apple-transaction-after-delete",
                self.user,
                "com.trailhead.explorer.monthly.v2",
                "Production",
                int(time.time()) + 86400,
            )
        )
        self.assertIsNone(
            store.set_user_plan(
                self.user,
                "com.trailhead.explorer.monthly.v2",
                int(time.time()) + 86400,
            )
        )
        self.assertIsNone(
            store.activate_plan(self.user, "com.trailhead.explorer.monthly.v2", 31)
        )
        self.assertEqual(
            store.save_viator_booking_intent(self.user, "late-viator-replay"),
            {},
        )
        store.log_event(
            self.user,
            "deleted-session",
            "late_provider_replay",
            {"private": "must-not-survive"},
        )

        from dashboard import server

        stale_user = {"id": self.user, "username": "deleted"}
        stripe_event = {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "stripe-webhook-after-delete",
                    "payment_status": "paid",
                    "metadata": {
                        "user_id": str(self.user),
                        "credits": "25",
                        "package_id": "trail",
                    },
                }
            },
        }

        class FakeStripeRequest:
            headers = {"stripe-signature": "signed"}

            async def body(self):
                return b"{}"

        fake_stripe = SimpleNamespace(
            api_key=None,
            Webhook=SimpleNamespace(
                construct_event=lambda _payload, _sig, _secret: stripe_event
            ),
        )
        with patch.object(
            server.settings, "stripe_webhook_secret", "test-secret"
        ), patch.dict(sys.modules, {"stripe": fake_stripe}):
            self.assertEqual(
                asyncio.run(server.stripe_webhook(FakeStripeRequest())),
                {"received": True},
            )

        for platform in ("ios", "android"):
            result = asyncio.run(
                server.activate_subscription(
                    server.IAPActivateRequest(
                        product_id="com.trailhead.explorer.monthly.v2",
                        transaction_id=f"{platform}-activation-after-delete",
                        platform=platform,
                    ),
                    stale_user,
                )
            )
            self.assertEqual(
                result,
                {"status": "ignored", "reason": "account_unavailable"},
            )

        def fake_jws(payload: dict) -> str:
            body = base64.urlsafe_b64encode(
                json.dumps(payload, separators=(",", ":")).encode()
            ).rstrip(b"=").decode()
            return f"e30.{body}.signature"

        deleted_original_id = "apple-original-after-delete"
        verified_transaction = {
            "originalTransactionId": deleted_original_id,
            "transactionId": "apple-replay-after-delete",
            "productId": "com.trailhead.explorer.monthly.v2",
            "expiresDate": str((int(time.time()) + 86400) * 1000),
            "bundleId": server.settings.apple_bundle_id or None,
            "environment": "Production",
        }
        with patch.object(server, "_apple_server_api_ready", return_value=True), patch.object(
            server,
            "_fetch_apple_transaction",
            return_value=(verified_transaction, "Production"),
        ):
            apple_result = asyncio.run(
                server.apple_server_notification(
                    server.AppleNotificationBody(
                        signedPayload=fake_jws(
                            {
                                "notificationType": "DID_RENEW",
                                "data": {
                                    "signedTransactionInfo": fake_jws(
                                        verified_transaction
                                    )
                                },
                            }
                        )
                    )
                )
            )
        self.assertEqual(apple_result, {"ok": True, "handled": False})

        db = store._conn()
        for table in (
            "stripe_purchases",
            "credit_transactions",
            "contest_events",
            "contest_entries",
            "app_store_subscriptions",
            "viator_bookings",
        ):
            self.assertEqual(
                db.execute(
                    f'SELECT COUNT(*) FROM "{table}" WHERE user_id=?', (self.user,)
                ).fetchone()[0],
                0,
                table,
            )
        self.assertEqual(
            db.execute(
                "SELECT COUNT(*) FROM analytics_events WHERE user_id=?", (self.user,)
            ).fetchone()[0],
            0,
        )
        apple_event = db.execute(
            """SELECT event_data FROM analytics_events
               WHERE event_type='apple_notification_no_user_mapping'
               ORDER BY id DESC LIMIT 1"""
        ).fetchone()
        self.assertIsNotNone(apple_event)
        self.assertNotIn(deleted_original_id, apple_event["event_data"] or "")
        db.close()

    def test_future_non_fk_user_column_fails_closed_and_rolls_back(self):
        db = store._conn()
        db.execute(
            """CREATE TABLE future_untracked_user_data (
                   id INTEGER PRIMARY KEY,
                   user_id INTEGER NOT NULL,
                   private_value TEXT NOT NULL
               )"""
        )
        db.execute(
            "INSERT INTO future_untracked_user_data(user_id,private_value) VALUES (?,?)",
            (self.user, "must not be orphaned"),
        )
        db.commit()
        db.close()

        with self.assertRaisesRegex(
            RuntimeError,
            "Account deletion has no policy for non-FK identity future_untracked_user_data.user_id",
        ):
            store.delete_user(self.user)

        self.assertIsNotNone(store.get_user_by_id(self.user))
        db = store._conn()
        self.assertEqual(
            db.execute(
                "SELECT COUNT(*) FROM future_untracked_user_data WHERE user_id=?", (self.user,)
            ).fetchone()[0],
            1,
        )
        db.close()

    def test_unknown_restrictive_user_reference_fails_closed_and_rolls_back(self):
        db = store._conn()
        db.execute(
            """CREATE TABLE future_private_user_data (
                   id INTEGER PRIMARY KEY,
                   user_id INTEGER NOT NULL REFERENCES users(id),
                   private_value TEXT NOT NULL
               )"""
        )
        db.execute(
            "INSERT INTO future_private_user_data(user_id,private_value) VALUES (?,?)",
            (self.user, "must not be orphaned"),
        )
        db.commit()
        db.close()

        with self.assertRaisesRegex(
            RuntimeError,
            "Account deletion has no policy for future_private_user_data.user_id",
        ):
            store.delete_user(self.user)

        self.assertIsNotNone(store.get_user_by_id(self.user))
        db = store._conn()
        self.assertEqual(
            db.execute(
                "SELECT COUNT(*) FROM future_private_user_data WHERE user_id=?", (self.user,)
            ).fetchone()[0],
            1,
        )
        db.close()


if __name__ == "__main__":
    unittest.main()
