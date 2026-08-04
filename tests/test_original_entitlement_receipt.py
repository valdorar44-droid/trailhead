import base64
import copy
import hashlib
import json
import time
from unittest.mock import patch

import pytest

from db import store
from db.original_entitlement_receipt import (
    OriginalEntitlementReceiptError,
    issue_original_entitlement_receipt,
    original_entitlement_owner_binding,
    original_entitlement_public_key,
    verify_original_entitlement_receipt,
)


TEST_SEED = bytes(range(1, 33))
TEST_KEY = base64.urlsafe_b64encode(TEST_SEED).decode("ascii").rstrip("=")
TEST_OWNER_KEY = base64.urlsafe_b64encode(bytes(range(33, 65))).decode("ascii").rstrip("=")
TEST_ENV = {
    "TRAILHEAD_ORIGINALS_RECEIPT_PRIVATE_KEY": TEST_KEY,
    "TRAILHEAD_ORIGINALS_RECEIPT_KEY_ID": "test-2026-08",
    "TRAILHEAD_ORIGINALS_RECEIPT_OWNER_BINDING_KEY": TEST_OWNER_KEY,
}


class _Result:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class _EntitlementDb:
    def __init__(self, expires_at: int):
        self.expires_at = expires_at

    def execute(self, query: str, _params=()):
        if "SELECT plan_type,plan_expires_at FROM users" in query:
            return _Result({
                "plan_type": "com.trailhead.explorer.monthly.v2",
                "plan_expires_at": self.expires_at,
            })
        if "SELECT * FROM trip_documents_v2" in query:
            return _Result(None)
        raise AssertionError(f"Unexpected query: {query}")


def _entitlement_row(*, expires_at: int, acquisition_type: str = "explorer_included"):
    return {
        "id": "entitlement-test-smokies",
        "user_id": 42,
        "pack_id": "smokies-original",
        "version": 1,
        "slug": "great-smoky-mountains-ridges-rivers-living-memory",
        "title": "Great Smoky Mountains: Ridges, Rivers & Living Memory",
        "summary": "A four-chapter driving Original.",
        "price_credits": 900,
        "coverage_region": "north_america",
        "content_kind": "original_drive",
        "public_metadata": json.dumps({
            "access_policy": {
                "schema_version": 1,
                "explorer_included": True,
                "permanent_credit_price": 900,
            },
        }),
        "validation_metadata": "{}",
        "template_json": "{}",
        "original_manifest_json": json.dumps({
            "schema_version": 2,
            "manifest_id": "smokies-original:1:published",
        }),
        "published_at": int(time.time()),
        "acquisition_type": acquisition_type,
        "list_price_credits": 900,
        "credits_charged": 0 if acquisition_type == "explorer_included" else 900,
        "explorer_discount": 0,
        "claim_month": None,
        "trip_id": None,
        "acquired_at": int(time.time()),
        "request_hash": "test",
        "idempotency_key": "test",
        "plan_expires_at": expires_at,
    }


def test_ed25519_receipt_is_identity_bound_and_tamper_evident():
    issued_at = 2_000_000_000
    receipt = issue_original_entitlement_receipt(
        user_id=42,
        entitlement_id="entitlement-test-smokies",
        pack_id="smokies-original",
        version=1,
        manifest_id="smokies-original:1:published",
        access_expires_at=issued_at + 30 * 86_400,
        issued_at=issued_at,
        environ=TEST_ENV,
    )
    assert receipt is not None
    public = original_entitlement_public_key(TEST_ENV)
    assert public is not None
    payload = verify_original_entitlement_receipt(
        receipt,
        public_keys={public["key_id"]: public["public_key"]},
    )
    assert payload["owner_binding"] == original_entitlement_owner_binding(42, TEST_ENV)
    assert payload["pack_id"] == "smokies-original"
    assert payload["manifest_id"] == "smokies-original:1:published"
    assert payload["receipt_expires_at"] == issued_at + 72 * 60 * 60
    assert payload["receipt_expires_at"] < payload["access_expires_at"]
    assert "user_id" not in payload
    assert 42 not in payload.values()
    assert "42" not in payload.values()
    assert payload["owner_binding"] != hashlib.sha256(
        b"trailhead-originals-owner-v1\x0042"
    ).hexdigest()

    tampered = copy.deepcopy(receipt)
    tampered["payload"]["access_expires_at"] += 86_400
    with pytest.raises(OriginalEntitlementReceiptError, match="signature"):
        verify_original_entitlement_receipt(
            tampered,
            public_keys={public["key_id"]: public["public_key"]},
        )


def test_v2_explorer_result_requires_receipt_and_fails_safe_when_unconfigured():
    expires_at = int(time.time()) + 30 * 86_400
    row = _entitlement_row(expires_at=expires_at)
    db = _EntitlementDb(expires_at)
    with patch.dict("os.environ", TEST_ENV, clear=False):
        result = store._trip_pack_entitlement_result(db, row, already_owned=True)
    entitlement = result["entitlement"]
    assert entitlement["access_receipt_required"] is True
    assert entitlement["access_receipt"] is not None
    assert entitlement["access_owner_binding"] == entitlement["access_receipt"]["payload"]["owner_binding"]
    assert entitlement["access_receipt_expires_at"] == entitlement["access_receipt"]["payload"]["receipt_expires_at"]
    assert "user_id" not in entitlement
    assert entitlement["access_owner_binding"] != "42"

    with patch.dict("os.environ", {
        "TRAILHEAD_ORIGINALS_RECEIPT_PRIVATE_KEY": "",
        "TRAILHEAD_ORIGINALS_RECEIPT_KEY_ID": "",
        "TRAILHEAD_ORIGINALS_RECEIPT_OWNER_BINDING_KEY": "",
    }, clear=False):
        unsigned = store._trip_pack_entitlement_result(db, row, already_owned=True)
    assert unsigned["entitlement"]["access_active"] is True
    assert unsigned["entitlement"]["access_receipt_required"] is True
    assert unsigned["entitlement"]["access_receipt"] is None
    assert unsigned["entitlement"]["access_owner_binding"] is None
    assert unsigned["pack"]["id"] == "smokies-original"


def test_permanent_access_remains_receipt_independent():
    expires_at = int(time.time()) + 30 * 86_400
    row = _entitlement_row(expires_at=expires_at, acquisition_type="purchase")
    result = store._trip_pack_entitlement_result(
        _EntitlementDb(expires_at), row, already_owned=True,
    )
    assert result["entitlement"]["access_type"] == "permanent"
    assert result["entitlement"]["permanent"] is True
    assert "access_receipt_required" not in result["entitlement"]
    assert "access_receipt" not in result["entitlement"]


def test_owner_binding_is_keyed_and_signing_configuration_fails_closed():
    first = original_entitlement_owner_binding(42, TEST_ENV)
    assert len(first) == 43
    assert first == original_entitlement_owner_binding("42", TEST_ENV)
    assert first != original_entitlement_owner_binding(43, TEST_ENV)
    rotated = dict(TEST_ENV)
    rotated["TRAILHEAD_ORIGINALS_RECEIPT_OWNER_BINDING_KEY"] = base64.urlsafe_b64encode(
        bytes(reversed(range(1, 33))),
    ).decode("ascii").rstrip("=")
    assert first != original_entitlement_owner_binding(42, rotated)

    missing_binding = dict(TEST_ENV)
    missing_binding.pop("TRAILHEAD_ORIGINALS_RECEIPT_OWNER_BINDING_KEY")
    with pytest.raises(OriginalEntitlementReceiptError, match="owner-binding key"):
        issue_original_entitlement_receipt(
            user_id=42,
            entitlement_id="entitlement-test-smokies",
            pack_id="smokies-original",
            version=1,
            manifest_id="smokies-original:1:published",
            access_expires_at=2_001_000_000,
            issued_at=2_000_000_000,
            environ=missing_binding,
        )


def test_offline_receipt_ttl_is_independent_bounded_and_configurable():
    custom = {**TEST_ENV, "TRAILHEAD_ORIGINALS_RECEIPT_TTL_SECONDS": "3600"}
    receipt = issue_original_entitlement_receipt(
        user_id=42,
        entitlement_id="entitlement-test-smokies",
        pack_id="smokies-original",
        version=1,
        manifest_id="smokies-original:1:published",
        access_expires_at=2_100_000_000,
        issued_at=2_000_000_000,
        environ=custom,
    )
    assert receipt["payload"]["receipt_expires_at"] == 2_000_003_600
    with pytest.raises(OriginalEntitlementReceiptError, match="between 900 and 604800"):
        issue_original_entitlement_receipt(
            user_id=42,
            entitlement_id="entitlement-test-smokies",
            pack_id="smokies-original",
            version=1,
            manifest_id="smokies-original:1:published",
            access_expires_at=2_100_000_000,
            issued_at=2_000_000_000,
            environ={**TEST_ENV, "TRAILHEAD_ORIGINALS_RECEIPT_TTL_SECONDS": "604801"},
        )
