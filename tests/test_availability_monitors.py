import asyncio
import os
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from config.settings import settings
from dashboard.server import (
    AvailabilityMonitorCreateRequest,
    PlaceReservationAlertPayload,
    _raise_account_store_error,
    api_availability_monitor_status,
    api_create_availability_monitor,
    api_place_reservation_alert,
)
from db import store


class AvailabilityMonitorPolicyTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        tmp = tempfile.NamedTemporaryFile(delete=False)
        tmp.close()
        self.db_path = tmp.name
        settings.db_path = self.db_path
        store.init_db()
        self.user_one = store.create_user(
            "watch-one@example.com", "watch_one", "hash", "watch-one-code"
        )
        self.user_two = store.create_user(
            "watch-two@example.com", "watch_two", "hash", "watch-two-code"
        )

    def tearDown(self):
        settings.db_path = self.original_db_path
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(self.db_path + suffix)
            except FileNotFoundError:
                pass

    def _create(self, target: str, key: str, **overrides):
        args = {
            "user_id": self.user_one,
            "target_id": target,
            "target_label": target.replace("_", " ").title(),
            "monitor_type": "campground",
            "idempotency_key": key,
        }
        args.update(overrides)
        return store.create_availability_monitor(**args)

    def test_lifetime_trial_is_seven_days_then_monitor_costs_fifty_credits(self):
        store.add_credits(self.user_one, 100, "Test balance")
        trial = self._create("trial_target", "trial-create")

        self.assertEqual(trial["billing_kind"], "trial")
        self.assertEqual(trial["duration_days"], 7)
        self.assertEqual(trial["expires_at"] - trial["created_at"], 7 * 86400)
        store.cancel_availability_monitor(self.user_one, trial["id"])

        paid = self._create("paid_target", "paid-create")
        user = store.get_user_by_id(self.user_one)
        policy = store.availability_monitor_policy(self.user_one)

        self.assertEqual(paid["billing_kind"], "credits")
        self.assertEqual(paid["credits_charged"], 50)
        self.assertEqual(paid["duration_days"], 30)
        self.assertEqual(user["credits"], 50)
        self.assertTrue(policy["trial"]["used"])
        self.assertFalse(policy["trial"]["available"])

    def test_active_explorer_has_five_included_concurrent_monitors(self):
        store.set_user_plan(
            self.user_one,
            "com.trailhead.explorer.monthly.v2",
            int(time.time()) + 30 * 86400,
        )
        store.add_credits(self.user_one, 100, "Overflow balance")

        included = [
            self._create(f"explorer_{index}", f"explorer-{index}")
            for index in range(5)
        ]
        overflow = self._create("explorer_overflow", "explorer-overflow")
        policy = store.availability_monitor_policy(self.user_one)

        self.assertTrue(all(item["billing_kind"] == "explorer" for item in included))
        self.assertTrue(all(item["duration_days"] == 30 for item in included))
        self.assertEqual(overflow["billing_kind"], "credits")
        self.assertEqual(overflow["credits_charged"], 50)
        self.assertEqual(policy["explorer"]["included_active"], 5)
        self.assertEqual(policy["explorer"]["included_remaining"], 0)
        self.assertTrue(policy["trial"]["available"])

    def test_safety_and_legal_watches_are_free_and_do_not_consume_trial(self):
        safety = self._create(
            "safety_target", "safety-create", monitor_type="safety"
        )
        reopening = self._create(
            "road_reopening", "reopening-create", monitor_type="route_reopening"
        )
        closure = self._create(
            "closure_target", "closure-create", monitor_type="closure"
        )
        policy = store.availability_monitor_policy(self.user_one)

        self.assertEqual(
            {safety["billing_kind"], reopening["billing_kind"], closure["billing_kind"]},
            {"safety_free"},
        )
        self.assertTrue(safety["quota_exempt"])
        self.assertEqual(policy["safety_active"], 3)
        self.assertTrue(policy["trial"]["available"])
        self.assertEqual(policy["credit_balance"], 0)

    def test_insufficient_balance_rolls_back_monitor_and_ledger(self):
        trial = self._create("used_trial", "used-trial")
        store.cancel_availability_monitor(self.user_one, trial["id"])

        with self.assertRaises(store.InsufficientMonitorCreditsError):
            self._create("needs_credits", "needs-credits")

        monitors = store.list_availability_monitors(self.user_one)["items"]
        self.assertEqual(len(monitors), 1)
        self.assertEqual(store.get_user_by_id(self.user_one)["credits"], 0)
        self.assertEqual(store.get_credit_history(self.user_one), [])

    def test_job_creation_failure_refunds_paid_monitor_once(self):
        trial = self._create("refund_trial", "refund-trial")
        store.cancel_availability_monitor(self.user_one, trial["id"])
        store.add_credits(self.user_one, 50, "Refund test balance")

        def fail_job(_monitor):
            raise RuntimeError("provider unavailable")

        with self.assertRaises(store.MonitorCreationError) as failed:
            self._create(
                "refund_target", "refund-create", job_creator=fail_job
            )

        monitor = failed.exception.monitor
        self.assertEqual(monitor["status"], "failed")
        self.assertEqual(monitor["credits_charged"], 50)
        self.assertIsNotNone(monitor["refunded_at"])
        self.assertEqual(store.get_user_by_id(self.user_one)["credits"], 50)
        amounts = [row["amount"] for row in store.get_credit_history(self.user_one)]
        self.assertEqual(amounts.count(-50), 1)
        self.assertEqual(amounts.count(50), 2)  # Initial balance and one refund.

        repeated = store.fail_availability_monitor_creation(
            self.user_one, monitor["id"], "Repeated failure"
        )
        self.assertEqual(repeated["status"], "failed")
        self.assertEqual(store.get_user_by_id(self.user_one)["credits"], 50)
        amounts = [row["amount"] for row in store.get_credit_history(self.user_one)]
        self.assertEqual(amounts.count(50), 2)

    def test_idempotency_prevents_double_charge_and_payload_reuse(self):
        trial = self._create("idempotent_trial", "idempotent-trial")
        store.cancel_availability_monitor(self.user_one, trial["id"])
        store.add_credits(self.user_one, 100, "Idempotency balance")

        first = self._create("idempotent_paid", "idempotent-paid")
        replay = self._create("idempotent_paid", "idempotent-paid")

        self.assertEqual(replay["id"], first["id"])
        self.assertTrue(replay["replayed"])
        self.assertEqual(store.get_user_by_id(self.user_one)["credits"], 50)
        with self.assertRaisesRegex(ValueError, "different request"):
            self._create(
                "idempotent_paid",
                "idempotent-paid",
                target_label="Changed target label",
            )

    def test_ownership_cancel_and_expiry_update_linked_reservation_job(self):
        place = store.upsert_canonical_place({
            "name": "Linked Campground",
            "lat": 38.5,
            "lng": -109.5,
            "source": "trailhead",
            "source_place_id": "linked-camp",
        })
        monitor = self._create(
            place["trailhead_place_id"],
            "linked-monitor",
            target_label="Linked Campground",
            start_date="2026-09-01",
            end_date="2026-09-03",
        )
        self.assertIsNotNone(monitor["reservation_alert_id"])
        self.assertEqual(
            len(store.get_place_reservation_alerts(place["trailhead_place_id"], self.user_one)),
            1,
        )
        with self.assertRaises(PermissionError):
            store.get_availability_monitor(self.user_two, monitor["id"])
        with self.assertRaises(PermissionError):
            store.cancel_availability_monitor(self.user_two, monitor["id"])

        db = store._conn()
        db.execute(
            "UPDATE availability_monitors SET expires_at=? WHERE id=?",
            (int(time.time()) - 1, monitor["id"]),
        )
        db.commit()
        db.close()
        expired = store.get_availability_monitor(self.user_one, monitor["id"])

        self.assertEqual(expired["status"], "expired")
        self.assertEqual(
            store.get_place_reservation_alerts(place["trailhead_place_id"], self.user_one),
            [],
        )

    def test_account_deletion_removes_monitor_records(self):
        monitor = self._create("delete_monitor", "delete-monitor")
        store.delete_user(self.user_one)

        db = store._conn()
        count = db.execute(
            "SELECT COUNT(*) FROM availability_monitors WHERE id=?", (monitor["id"],)
        ).fetchone()[0]
        db.close()
        self.assertEqual(count, 0)

    def test_existing_reservation_alert_is_grandfathered_into_monitor_policy(self):
        place = store.upsert_canonical_place({
            "name": "Existing Campground",
            "lat": 38.6,
            "lng": -109.6,
            "source": "trailhead",
            "source_place_id": "existing-camp",
        })
        store.save_place_reservation_alert(
            place["trailhead_place_id"],
            self.user_one,
            "2026-10-01",
            "2026-10-03",
            2,
            "trailhead",
            "https://example.com/reserve",
        )

        store.init_db()
        monitors = store.list_availability_monitors(self.user_one)["items"]

        self.assertEqual(len(monitors), 1)
        self.assertEqual(monitors[0]["billing_kind"], "legacy")
        self.assertEqual(monitors[0]["monitor_type"], "campground")
        self.assertEqual(monitors[0]["target_label"], "Existing Campground")

    def test_api_commerce_errors_match_mobile_paywall_contract(self):
        trial = self._create("api_trial", "api-trial")
        store.cancel_availability_monitor(self.user_one, trial["id"])
        body = AvailabilityMonitorCreateRequest(
            target_id="api_paid",
            target_label="API paid watch",
            monitor_type="campground",
        )

        with patch.dict(os.environ, {"TRAILHEAD_AVAILABILITY_MONITORS_ENABLED": "1"}):
            with self.assertRaises(HTTPException) as payment:
                asyncio.run(api_create_availability_monitor(
                    body, "api-paid-create", {"id": self.user_one}
                ))
        self.assertEqual(payment.exception.status_code, 402)
        self.assertEqual(payment.exception.detail["code"], "availability_monitor_credits")
        self.assertEqual(payment.exception.detail["credits_needed"], 50)
        self.assertTrue(payment.exception.detail["earn_hint"])

        self._create("api_duplicate", "api-duplicate-first", monitor_type="safety")
        duplicate_body = AvailabilityMonitorCreateRequest(
            target_id="api_duplicate",
            target_label="API Duplicate",
            monitor_type="safety",
        )
        with patch.dict(os.environ, {"TRAILHEAD_AVAILABILITY_MONITORS_ENABLED": "1"}):
            with self.assertRaises(HTTPException) as duplicate:
                asyncio.run(api_create_availability_monitor(
                    duplicate_body, "api-duplicate-second", {"id": self.user_one}
                ))
        self.assertEqual(duplicate.exception.status_code, 409)
        self.assertEqual(duplicate.exception.detail["code"], "watch_exists")
        self.assertTrue(duplicate.exception.detail["monitor_id"].startswith("mon_"))

        failed_monitor = {
            "id": "mon_failed",
            "credits_charged": 50,
            "refunded_at": 123,
        }
        with self.assertRaises(HTTPException) as unavailable:
            _raise_account_store_error(store.MonitorCreationError(failed_monitor))
        self.assertEqual(unavailable.exception.status_code, 503)
        self.assertEqual(unavailable.exception.detail["refund"], {
            "completed": True,
            "credits_returned": 50,
        })

    def test_flag_off_keeps_legacy_reservation_alert_free_and_hides_new_api(self):
        place = store.upsert_canonical_place({
            "name": "Legacy Free Camp",
            "lat": 38.7,
            "lng": -109.7,
            "source": "trailhead",
            "source_place_id": "legacy-free-camp",
            "booking_url": "https://example.com/reserve",
        })
        store.add_credits(self.user_one, 100, "Unchanged balance")
        body = PlaceReservationAlertPayload(
            start_date="2026-11-01", end_date="2026-11-03", party_size=2,
        )
        user = {"id": self.user_one, "is_admin": 0}

        with patch.dict(os.environ, {"TRAILHEAD_AVAILABILITY_MONITORS_ENABLED": "0"}):
            response = asyncio.run(api_place_reservation_alert(
                place["trailhead_place_id"], body, None, user,
            ))
            with self.assertRaises(HTTPException) as gated:
                asyncio.run(api_availability_monitor_status(user))

        self.assertEqual(set(response), {"ok", "alert"})
        self.assertTrue(response["ok"])
        self.assertEqual(response["alert"]["status"], "active")
        self.assertEqual(store.get_user_by_id(self.user_one)["credits"], 100)
        db = store._conn()
        monitor_count = db.execute(
            "SELECT COUNT(*) FROM availability_monitors WHERE user_id=?",
            (self.user_one,),
        ).fetchone()[0]
        db.close()
        self.assertEqual(monitor_count, 0)
        self.assertEqual(gated.exception.status_code, 404)
        self.assertEqual(gated.exception.detail["code"], "feature_unavailable")


if __name__ == "__main__":
    unittest.main()
