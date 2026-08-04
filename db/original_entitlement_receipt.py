"""Signed, privacy-minimized receipts for temporary Original access.

The receipt is independent from authentication tokens. It lets a mobile
client verify an exact Explorer entitlement while offline without placing a
signing secret, account identifier, location, or route data on the device.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from collections.abc import Mapping

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


ORIGINAL_ENTITLEMENT_RECEIPT_SCHEMA_VERSION = 1
ORIGINAL_ENTITLEMENT_RECEIPT_ALGORITHM = "Ed25519"
ORIGINAL_ENTITLEMENT_RECEIPT_ISSUER = "trailhead-originals"
ORIGINAL_ENTITLEMENT_RECEIPT_AUDIENCE = "trailhead-originals-mobile"
ORIGINAL_ENTITLEMENT_RECEIPT_DOMAIN = b"trailhead-original-entitlement-receipt-v1\0"
ORIGINAL_ENTITLEMENT_OWNER_DOMAIN = b"trailhead-originals-owner-v2\0"
ORIGINAL_ENTITLEMENT_RECEIPT_DEFAULT_TTL_SECONDS = 72 * 60 * 60
ORIGINAL_ENTITLEMENT_RECEIPT_MAX_TTL_SECONDS = 7 * 24 * 60 * 60


class OriginalEntitlementReceiptError(ValueError):
    """The receipt or signing configuration is invalid."""


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _base64url_decode(value: object, label: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise OriginalEntitlementReceiptError(f"{label} is required")
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise OriginalEntitlementReceiptError(f"{label} is invalid") from exc


def _canonical_payload(payload: Mapping[str, object]) -> bytes:
    return json.dumps(
        dict(payload),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _owner_binding_key_from_environment(environ: Mapping[str, str]) -> bytes:
    encoded = str(
        environ.get("TRAILHEAD_ORIGINALS_RECEIPT_OWNER_BINDING_KEY") or ""
    ).strip()
    if not encoded:
        raise OriginalEntitlementReceiptError(
            "Original entitlement receipt owner-binding key is required"
        )
    key = _base64url_decode(
        encoded, "Original entitlement receipt owner-binding key",
    )
    if len(key) != 32:
        raise OriginalEntitlementReceiptError(
            "Original entitlement receipt owner-binding key must be 32 bytes"
        )
    return key


def _receipt_ttl_seconds(environ: Mapping[str, str]) -> int:
    raw = str(
        environ.get("TRAILHEAD_ORIGINALS_RECEIPT_TTL_SECONDS")
        or ORIGINAL_ENTITLEMENT_RECEIPT_DEFAULT_TTL_SECONDS
    ).strip()
    try:
        ttl = int(raw)
    except (TypeError, ValueError) as exc:
        raise OriginalEntitlementReceiptError(
            "Original entitlement receipt TTL is invalid"
        ) from exc
    if ttl < 15 * 60 or ttl > ORIGINAL_ENTITLEMENT_RECEIPT_MAX_TTL_SECONDS:
        raise OriginalEntitlementReceiptError(
            "Original entitlement receipt TTL must be between 900 and 604800 seconds"
        )
    return ttl


def original_entitlement_owner_binding(
    user_id: int | str,
    environ: Mapping[str, str] | None = None,
) -> str:
    """Return a keyed binding that cannot be enumerated from public account ids."""
    normalized = str(user_id).strip()
    if not normalized:
        raise OriginalEntitlementReceiptError("user identity is required")
    environment = os.environ if environ is None else environ
    return _base64url_encode(hmac.new(
        _owner_binding_key_from_environment(environment),
        ORIGINAL_ENTITLEMENT_OWNER_DOMAIN + normalized.encode("utf-8"),
        hashlib.sha256,
    ).digest())


def _private_key_from_environment(
    environ: Mapping[str, str],
) -> tuple[str, Ed25519PrivateKey] | None:
    encoded = str(environ.get("TRAILHEAD_ORIGINALS_RECEIPT_PRIVATE_KEY") or "").strip()
    key_id = str(environ.get("TRAILHEAD_ORIGINALS_RECEIPT_KEY_ID") or "").strip()
    if not encoded and not key_id:
        return None
    if not encoded or not key_id:
        raise OriginalEntitlementReceiptError(
            "Original entitlement receipt key and key id must be configured together"
        )
    if len(key_id) > 80 or not all(character.isalnum() or character in "._-" for character in key_id):
        raise OriginalEntitlementReceiptError("Original entitlement receipt key id is invalid")
    seed = _base64url_decode(encoded, "Original entitlement receipt private key")
    if len(seed) != 32:
        raise OriginalEntitlementReceiptError(
            "Original entitlement receipt private key must be a 32-byte Ed25519 seed"
        )
    return key_id, Ed25519PrivateKey.from_private_bytes(seed)


def original_entitlement_public_key(
    environ: Mapping[str, str] | None = None,
) -> dict[str, str] | None:
    """Return the configured public key for trusted mobile build configuration."""
    configured = _private_key_from_environment(os.environ if environ is None else environ)
    if configured is None:
        return None
    key_id, private_key = configured
    public_key = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return {"key_id": key_id, "public_key": _base64url_encode(public_key)}


def issue_original_entitlement_receipt(
    *,
    user_id: int | str,
    entitlement_id: int | str,
    pack_id: str,
    version: int,
    manifest_id: str,
    access_expires_at: int,
    issued_at: int | None = None,
    environ: Mapping[str, str] | None = None,
) -> dict | None:
    """Issue an integrity-bound V2 Explorer receipt, or None when unconfigured.

    Missing signing configuration intentionally does not delete or rewrite an
    entitlement. New clients see ``access_receipt_required`` and keep the
    downloaded pack locked until a signed refresh becomes available.
    """
    environment = os.environ if environ is None else environ
    configured = _private_key_from_environment(environment)
    if configured is None:
        return None
    key_id, private_key = configured
    now = int(time.time()) if issued_at is None else int(issued_at)
    expires_at = int(access_expires_at)
    if expires_at <= now:
        return None
    receipt_expires_at = min(expires_at, now + _receipt_ttl_seconds(environment))
    normalized_pack_id = str(pack_id or "").strip()
    normalized_manifest_id = str(manifest_id or "").strip()
    normalized_entitlement_id = str(entitlement_id or "").strip()
    if not normalized_pack_id or not normalized_manifest_id or not normalized_entitlement_id:
        raise OriginalEntitlementReceiptError("Original entitlement identity is incomplete")
    if isinstance(version, bool) or int(version) < 1:
        raise OriginalEntitlementReceiptError("Original entitlement version is invalid")
    payload = {
        "schema_version": ORIGINAL_ENTITLEMENT_RECEIPT_SCHEMA_VERSION,
        "issuer": ORIGINAL_ENTITLEMENT_RECEIPT_ISSUER,
        "audience": ORIGINAL_ENTITLEMENT_RECEIPT_AUDIENCE,
        "owner_binding": original_entitlement_owner_binding(user_id, environment),
        "entitlement_id": normalized_entitlement_id,
        "pack_id": normalized_pack_id,
        "version": int(version),
        "manifest_id": normalized_manifest_id,
        "manifest_schema_version": 2,
        "access_type": "explorer_subscription",
        "issued_at": now,
        "access_expires_at": expires_at,
        "receipt_expires_at": receipt_expires_at,
    }
    signature = private_key.sign(ORIGINAL_ENTITLEMENT_RECEIPT_DOMAIN + _canonical_payload(payload))
    return {
        "schema_version": ORIGINAL_ENTITLEMENT_RECEIPT_SCHEMA_VERSION,
        "algorithm": ORIGINAL_ENTITLEMENT_RECEIPT_ALGORITHM,
        "key_id": key_id,
        "payload": payload,
        "signature": _base64url_encode(signature),
    }


def verify_original_entitlement_receipt(
    receipt: object,
    *,
    public_keys: Mapping[str, str],
) -> dict:
    """Verify a receipt for backend tests, diagnostics, and key rotation checks."""
    if not isinstance(receipt, dict) or set(receipt) != {
        "schema_version", "algorithm", "key_id", "payload", "signature",
    }:
        raise OriginalEntitlementReceiptError("Original entitlement receipt fields are invalid")
    if receipt.get("schema_version") != 1 or receipt.get("algorithm") != "Ed25519":
        raise OriginalEntitlementReceiptError("Original entitlement receipt version is unsupported")
    key_id = receipt.get("key_id")
    if not isinstance(key_id, str) or key_id not in public_keys:
        raise OriginalEntitlementReceiptError("Original entitlement receipt key is not trusted")
    payload = receipt.get("payload")
    if not isinstance(payload, dict) or set(payload) != {
        "schema_version", "issuer", "audience", "owner_binding", "entitlement_id",
        "pack_id", "version", "manifest_id", "manifest_schema_version", "access_type",
        "issued_at", "access_expires_at", "receipt_expires_at",
    }:
        raise OriginalEntitlementReceiptError("Original entitlement receipt payload is invalid")
    issued_at = payload.get("issued_at")
    access_expires_at = payload.get("access_expires_at")
    receipt_expires_at = payload.get("receipt_expires_at")
    if (
        isinstance(issued_at, bool)
        or isinstance(access_expires_at, bool)
        or isinstance(receipt_expires_at, bool)
        or not isinstance(issued_at, int)
        or not isinstance(access_expires_at, int)
        or not isinstance(receipt_expires_at, int)
        or issued_at < 1
        or receipt_expires_at <= issued_at
        or access_expires_at < receipt_expires_at
    ):
        raise OriginalEntitlementReceiptError("Original entitlement receipt time bounds are invalid")
    public_key_bytes = _base64url_decode(public_keys[key_id], "Original entitlement receipt public key")
    if len(public_key_bytes) != 32:
        raise OriginalEntitlementReceiptError("Original entitlement receipt public key is invalid")
    signature = _base64url_decode(receipt.get("signature"), "Original entitlement receipt signature")
    try:
        Ed25519PublicKey.from_public_bytes(public_key_bytes).verify(
            signature,
            ORIGINAL_ENTITLEMENT_RECEIPT_DOMAIN + _canonical_payload(payload),
        )
    except (InvalidSignature, ValueError) as exc:
        raise OriginalEntitlementReceiptError("Original entitlement receipt signature is invalid") from exc
    return dict(payload)
