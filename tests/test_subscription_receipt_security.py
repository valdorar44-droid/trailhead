import asyncio
import base64
import json
import os
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from config.settings import settings
from dashboard import server
from db import store


PRODUCT_ID = "com.trailhead.explorer.monthly.v2"


class SubscriptionReceiptSecurityTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()
        self.account_a = store.create_user(
            "receipt-a@example.com", "receipt_a", "hash", "receipt-a-code"
        )
        self.account_b = store.create_user(
            "receipt-b@example.com", "receipt_b", "hash", "receipt-b-code"
        )

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    @staticmethod
    def _request(receipt_id: str, platform: str = "ios") -> server.IAPActivateRequest:
        return server.IAPActivateRequest(
            product_id=PRODUCT_ID,
            transaction_id=receipt_id,
            platform=platform,
        )

    @staticmethod
    def _verified(
        receipt_id: str,
        *,
        original_id: str = "apple-original-a",
        expires_at: int | None = None,
    ) -> dict:
        return {
            "platform": "ios",
            "product_id": PRODUCT_ID,
            "transaction_id": receipt_id,
            "original_transaction_id": original_id,
            "expires_at": expires_at or int(time.time()) + 30 * 86400,
            "environment": "Production",
        }

    @staticmethod
    def _fake_jws(payload: dict) -> str:
        body = base64.urlsafe_b64encode(
            json.dumps(payload, separators=(",", ":")).encode()
        ).rstrip(b"=").decode()
        return f"e30.{body}.forged"

    def test_unconfigured_store_verifier_fails_closed(self):
        cases = (
            ("ios", "_apple_server_api_ready"),
            ("android", "_google_play_server_api_ready"),
        )
        for platform, readiness_name in cases:
            with self.subTest(platform=platform), patch.object(
                server, readiness_name, return_value=False
            ):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(
                        server.activate_subscription(
                            self._request(f"{platform}-unconfigured", platform),
                            {"id": self.account_a},
                        )
                    )
                self.assertEqual(raised.exception.status_code, 503)

        user = store.get_user_by_id(self.account_a)
        self.assertEqual(user["plan_type"], "free")
        db = store._conn()
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM stripe_purchases").fetchone()[0], 0
        )
        self.assertEqual(
            db.execute("SELECT COUNT(*) FROM app_store_subscriptions").fetchone()[0],
            0,
        )
        db.close()

    def test_cross_account_replay_is_rejected_and_same_account_retry_is_idempotent(self):
        receipt_id = "apple-transaction-a"
        verification = self._verified(receipt_id)
        verifier = AsyncMock(return_value=verification)
        with patch.object(server, "_apple_server_api_ready", return_value=True), patch.object(
            server, "_verify_apple_subscription", verifier
        ):
            first = asyncio.run(
                server.activate_subscription(
                    self._request(receipt_id), {"id": self.account_a}
                )
            )
            self.assertEqual(first["status"], "verified")

            with self.assertRaises(HTTPException) as replay:
                asyncio.run(
                    server.activate_subscription(
                        self._request(receipt_id), {"id": self.account_b}
                    )
                )
            self.assertEqual(replay.exception.status_code, 409)

            retry = asyncio.run(
                server.activate_subscription(
                    self._request(receipt_id), {"id": self.account_a}
                )
            )
            self.assertEqual(retry["status"], "verified")
            self.assertEqual(retry["plan_expires_at"], verification["expires_at"])

        self.assertEqual(store.get_user_by_id(self.account_b)["plan_type"], "free")
        purchase = store.get_purchase_fulfillment(receipt_id)
        self.assertEqual(purchase["user_id"], self.account_a)
        self.assertEqual(purchase["credits"], 0)
        self.assertEqual(purchase["purchase_kind"], "iap")
        self.assertEqual(purchase["platform"], "ios")
        self.assertEqual(purchase["product_id"], PRODUCT_ID)
        self.assertEqual(purchase["original_transaction_id"], "apple-original-a")
        subscription = store.get_app_store_subscription("apple-original-a")
        self.assertEqual(subscription["user_id"], self.account_a)
        self.assertEqual(subscription["product_id"], PRODUCT_ID)
        db = store._conn()
        self.assertEqual(
            db.execute(
                "SELECT COUNT(*) FROM stripe_purchases WHERE session_id=?",
                (receipt_id,),
            ).fetchone()[0],
            1,
        )
        db.close()

    def test_valid_same_account_renewal_updates_expiry(self):
        original_id = "apple-original-renewal"
        initial_id = "apple-transaction-initial"
        renewal_id = "apple-transaction-renewal"
        initial_expiry = int(time.time()) + 10 * 86400
        renewal_expiry = int(time.time()) + 40 * 86400
        verifications = {
            initial_id: self._verified(
                initial_id,
                original_id=original_id,
                expires_at=initial_expiry,
            ),
            renewal_id: self._verified(
                renewal_id,
                original_id=original_id,
                expires_at=renewal_expiry,
            ),
        }

        async def verify(_product_id: str, receipt_id: str) -> dict:
            return verifications[receipt_id]

        with patch.object(server, "_apple_server_api_ready", return_value=True), patch.object(
            server, "_verify_apple_subscription", side_effect=verify
        ):
            asyncio.run(
                server.activate_subscription(
                    self._request(initial_id), {"id": self.account_a}
                )
            )
            renewed = asyncio.run(
                server.activate_subscription(
                    self._request(renewal_id), {"id": self.account_a}
                )
            )

        self.assertEqual(renewed["status"], "verified")
        self.assertEqual(renewed["plan_expires_at"], renewal_expiry)
        subscription = store.get_app_store_subscription(original_id)
        self.assertEqual(subscription["transaction_id"], renewal_id)
        self.assertEqual(subscription["expires_at"], renewal_expiry)
        self.assertEqual(subscription["user_id"], self.account_a)

    def test_verified_same_account_upgrade_and_downgrade_preserve_owner(self):
        original_id = "apple-original-plan-change"
        monthly_id = "apple-plan-monthly"
        annual_id = "apple-plan-annual"
        monthly_product = PRODUCT_ID
        annual_product = "com.trailhead.explorer.annual.v2"
        future = int(time.time()) + 40 * 86400

        async def verify(product_id: str, receipt_id: str) -> dict:
            return {
                **self._verified(receipt_id, original_id=original_id, expires_at=future),
                "product_id": product_id,
            }

        with patch.object(server, "_apple_server_api_ready", return_value=True), patch.object(
            server, "_verify_apple_subscription", side_effect=verify,
        ):
            for product_id, receipt_id in (
                (monthly_product, monthly_id),
                (annual_product, annual_id),
                (monthly_product, "apple-plan-monthly-again"),
            ):
                result = asyncio.run(server.activate_subscription(
                    server.IAPActivateRequest(
                        product_id=product_id,
                        transaction_id=receipt_id,
                        platform="ios",
                    ),
                    {"id": self.account_a},
                ))
                self.assertEqual(result["status"], "verified")
                self.assertEqual(result["plan_type"], product_id)

        subscription = store.get_app_store_subscription(original_id)
        self.assertEqual(subscription["user_id"], self.account_a)
        self.assertEqual(subscription["product_id"], monthly_product)

    def test_google_multi_hop_replacement_chain_cannot_change_owner(self):
        monthly = PRODUCT_ID
        annual = "com.trailhead.explorer.annual.v2"
        transition_products = frozenset(server.IAP_PRODUCTS)
        expiry = int(time.time()) + 40 * 86400

        store.bind_verified_store_subscription(
            "google-token-a", "google-token-a", "google-order-a",
            self.account_a, monthly, "android", "GooglePlay", expiry,
            related_receipt_ids=["google-token-a"],
            transition_product_ids=transition_products,
        )
        store.bind_verified_store_subscription(
            "google-token-b", "google-token-a", "google-order-b",
            self.account_a, annual, "android", "GooglePlay", expiry,
            related_receipt_ids=["google-token-b", "google-token-a"],
            transition_product_ids=transition_products,
        )

        with self.assertRaises(store.SubscriptionReceiptConflictError):
            store.bind_verified_store_subscription(
                "google-token-c", "google-token-a", "google-order-c",
                self.account_b, monthly, "android", "GooglePlay", expiry,
                related_receipt_ids=[
                    "google-token-c", "google-token-b", "google-token-a",
                ],
                transition_product_ids=transition_products,
            )

        self.assertIsNone(store.get_purchase_fulfillment("google-token-c"))
        subscription = store.get_app_store_subscription("google-token-a")
        self.assertEqual(subscription["user_id"], self.account_a)
        self.assertEqual(subscription["product_id"], annual)

    def test_google_legacy_alias_is_canonicalized_to_verified_root(self):
        monthly = PRODUCT_ID
        annual = "com.trailhead.explorer.annual.v2"
        transition_products = frozenset(server.IAP_PRODUCTS)
        expiry = int(time.time()) + 40 * 86400

        # A previous one-hop activation correctly bound token B to root A.
        store.bind_verified_store_subscription(
            "google-token-b", "google-token-a", "google-order-b",
            self.account_a, monthly, "android", "GooglePlay", expiry,
            related_receipt_ids=["google-token-b", "google-token-a"],
            transition_product_ids=transition_products,
        )

        # Simulate the legacy immediate-linked-token behavior for A -> B -> C:
        # receipt C and its subscription row were keyed to alias B, not root A.
        db = store._conn()
        now = int(time.time())
        db.execute(
            """INSERT INTO stripe_purchases
               (session_id,user_id,credits,created_at,purchase_kind,platform,
                product_id,original_transaction_id)
               VALUES (?,?,0,?,'iap',?,?,?)""",
            (
                "google-token-c", self.account_a, now, "android", annual,
                "google-token-b",
            ),
        )
        db.execute(
            """INSERT INTO app_store_subscriptions
               (original_transaction_id,transaction_id,user_id,product_id,
                environment,expires_at,status,updated_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                "google-token-b", "google-order-c", self.account_a, annual,
                "GooglePlay", expiry, "active", now,
            ),
        )
        db.commit()
        db.close()

        result = store.bind_verified_store_subscription(
            "google-token-c", "google-token-a", "google-order-c",
            self.account_a, annual, "android", "GooglePlay", expiry,
            related_receipt_ids=[
                "google-token-c", "google-token-b", "google-token-a",
            ],
            transition_product_ids=transition_products,
        )

        self.assertEqual(result["original_transaction_id"], "google-token-a")
        self.assertEqual(result["product_id"], annual)
        self.assertIsNone(store.get_app_store_subscription("google-token-b"))
        receipt = store.get_purchase_fulfillment("google-token-c")
        self.assertEqual(receipt["user_id"], self.account_a)
        self.assertEqual(receipt["original_transaction_id"], "google-token-a")

    def test_google_replacement_chain_resolves_to_root_and_rejects_cycles(self):
        payloads = {
            "token-c": {"linkedPurchaseToken": "token-b"},
            "token-b": {"linkedPurchaseToken": "token-a"},
            "token-a": {},
        }

        async def fetch(token: str) -> dict:
            return payloads[token]

        first, chain = asyncio.run(
            server._resolve_google_play_replacement_chain("token-c", fetch)
        )
        self.assertIs(first, payloads["token-c"])
        self.assertEqual(chain, ["token-c", "token-b", "token-a"])

        async def cyclic_fetch(token: str) -> dict:
            return {"linkedPurchaseToken": "token-b" if token == "token-a" else "token-a"}

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(server._resolve_google_play_replacement_chain("token-a", cyclic_fetch))
        self.assertEqual(raised.exception.status_code, 502)

    def test_google_entitlement_state_allowlist(self):
        future = int(time.time()) + 3600
        for state in (
            "SUBSCRIPTION_STATE_ACTIVE",
            "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
            "SUBSCRIPTION_STATE_CANCELED",
        ):
            with self.subTest(granted=state):
                server._require_google_play_entitlement(state, future, now=future - 1)

        for state in (
            "SUBSCRIPTION_STATE_PAUSED",
            "SUBSCRIPTION_STATE_ON_HOLD",
            "SUBSCRIPTION_STATE_PENDING",
            "SUBSCRIPTION_STATE_EXPIRED",
            "SUBSCRIPTION_STATE_UNSPECIFIED",
            "",
        ):
            with self.subTest(rejected=state), self.assertRaises(HTTPException) as raised:
                server._require_google_play_entitlement(state, future, now=future - 1)
            self.assertEqual(raised.exception.status_code, 402)

        with self.assertRaises(HTTPException) as canceled_after_expiry:
            server._require_google_play_entitlement(
                "SUBSCRIPTION_STATE_CANCELED", future, now=future
            )
        self.assertEqual(canceled_after_expiry.exception.status_code, 402)

    def test_revoked_apple_transaction_is_rejected_despite_future_expiry(self):
        transaction_id = "apple-revoked-transaction"
        transaction = {
            "transactionId": transaction_id,
            "originalTransactionId": "apple-revoked-original",
            "productId": PRODUCT_ID,
            "bundleId": "com.trailhead.app",
            "expiresDate": (int(time.time()) + 30 * 86400) * 1000,
            "revocationDate": int(time.time()) * 1000,
            "revocationReason": 1,
            "environment": "Production",
        }
        with patch.object(settings, "apple_bundle_id", "com.trailhead.app"), patch.object(
            server,
            "_fetch_apple_transaction",
            new=AsyncMock(return_value=(transaction, "Production")),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(server._verify_apple_subscription(PRODUCT_ID, transaction_id))
        self.assertEqual(raised.exception.status_code, 402)

    def test_forged_apple_notification_cannot_mutate_entitlement(self):
        original_id = "apple-original-notification-owner"
        future = int(time.time()) + 30 * 86400
        store.save_app_store_subscription(
            original_id,
            "apple-real-transaction",
            self.account_a,
            PRODUCT_ID,
            "Production",
            future,
            "active",
            "ios",
        )
        store.set_user_plan(self.account_a, PRODUCT_ID, future)
        forged = self._fake_jws(
            {
                "notificationType": "EXPIRED",
                "data": {
                    "signedTransactionInfo": self._fake_jws(
                        {
                            "transactionId": "apple-forged-transaction",
                            "originalTransactionId": original_id,
                            "productId": PRODUCT_ID,
                            "expiresDate": 1,
                        }
                    )
                },
            }
        )

        with patch.object(server, "_apple_server_api_ready", return_value=True), patch.object(
            server,
            "_fetch_apple_transaction",
            new=AsyncMock(side_effect=HTTPException(402, "Apple rejected transaction")),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(
                    server.apple_server_notification(
                        server.AppleNotificationBody(signedPayload=forged)
                    )
                )
        self.assertEqual(raised.exception.status_code, 402)
        user = store.get_user_by_id(self.account_a)
        self.assertEqual(user["plan_type"], PRODUCT_ID)
        self.assertEqual(user["plan_expires_at"], future)
        subscription = store.get_app_store_subscription(original_id)
        self.assertEqual(subscription["transaction_id"], "apple-real-transaction")
        self.assertEqual(subscription["status"], "active")

    def test_receipt_platform_and_product_claims_are_immutable(self):
        expires_at = int(time.time()) + 30 * 86400
        store.bind_verified_store_subscription(
            "claimed-receipt",
            "claimed-original",
            "claimed-transaction",
            self.account_a,
            PRODUCT_ID,
            "ios",
            "Production",
            expires_at,
        )

        with self.assertRaises(store.SubscriptionReceiptConflictError):
            store.bind_verified_store_subscription(
                "claimed-receipt",
                "claimed-original",
                "claimed-transaction",
                self.account_a,
                "com.trailhead.explorer.annual.v2",
                "ios",
                "Production",
                expires_at,
            )
        with self.assertRaises(store.SubscriptionReceiptConflictError):
            store.bind_verified_store_subscription(
                "claimed-receipt",
                "claimed-original",
                "claimed-transaction",
                self.account_a,
                PRODUCT_ID,
                "android",
                "GooglePlay",
                expires_at,
            )

    def test_verifier_platform_and_product_must_match_request(self):
        mismatches = (
            {"platform": "android"},
            {"product_id": "com.trailhead.explorer.annual.v2"},
        )
        for index, override in enumerate(mismatches):
            receipt_id = f"mismatched-verification-{index}"
            verification = self._verified(receipt_id)
            verification.update(override)
            with self.subTest(override=override), patch.object(
                server, "_apple_server_api_ready", return_value=True
            ), patch.object(
                server,
                "_verify_apple_subscription",
                new=AsyncMock(return_value=verification),
            ):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(
                        server.activate_subscription(
                            self._request(receipt_id), {"id": self.account_a}
                        )
                    )
                self.assertEqual(raised.exception.status_code, 400)
                self.assertIsNone(store.get_purchase_fulfillment(receipt_id))

    def test_stripe_fulfillment_cannot_move_between_accounts(self):
        self.assertTrue(
            store.fulfill_stripe_purchase("stripe-session-owner", self.account_a, 25)
        )
        self.assertTrue(
            store.fulfill_stripe_purchase("stripe-session-owner", self.account_a, 25)
        )
        self.assertFalse(
            store.fulfill_stripe_purchase("stripe-session-owner", self.account_b, 25)
        )
        self.assertFalse(
            store.fulfill_stripe_purchase("stripe-session-owner", self.account_a, 50)
        )
        self.assertEqual(store.get_user_by_id(self.account_a)["credits"], 25)
        self.assertEqual(store.get_user_by_id(self.account_b)["credits"], 0)


if __name__ == "__main__":
    unittest.main()
