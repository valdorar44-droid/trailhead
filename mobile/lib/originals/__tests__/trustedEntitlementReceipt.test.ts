import assert from 'node:assert/strict';

import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { originalLocalAccessIsCurrent } from '../accessPolicy';
import { createOriginalAccessStore } from '../accessStore';
import { evaluateOriginalEntitlementReceipt } from '../trustedEntitlementReceipt';
import type {
  OriginalAuthenticatedAcquisition,
  OriginalEntitlementReceiptPayloadV1,
  OriginalEntitlementReceiptV1,
  OriginalSummary,
} from '../types';
import { createMemoryOriginalFileAdapter } from './memoryFileAdapter';

ed25519.hashes.sha512 = sha512;

const DOMAIN = utf8ToBytes('trailhead-original-entitlement-receipt-v1\0');
const SECRET_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const PUBLIC_KEY = ed25519.getPublicKey(SECRET_KEY);
const KEY_ID = 'test-2026-08';
const OWNER_BINDING = Buffer.from(
  Uint8Array.from({ length: 32 }, (_, index) => 200 - index),
).toString('base64url');
const MANIFEST_ID = 'smokies-original:1:published';

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left, 0);
  result.set(right, left.length);
  return result;
}

function base64Url(value: Uint8Array) {
  return Buffer.from(value).toString('base64url');
}

function canonicalPayload(payload: OriginalEntitlementReceiptPayloadV1) {
  const sorted = Object.keys(payload).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = payload[key as keyof OriginalEntitlementReceiptPayloadV1];
    return result;
  }, {});
  return utf8ToBytes(JSON.stringify(sorted));
}

function signedReceipt(options: {
  ownerBinding?: string;
  entitlementId?: string;
  manifestId?: string;
  manifestSchemaVersion?: 2 | 3;
  issuedAt?: number;
  accessExpiresAt?: number;
  receiptExpiresAt?: number;
} = {}): OriginalEntitlementReceiptV1 {
  const issuedAt = options.issuedAt ?? 2_000_000_000;
  const payload: OriginalEntitlementReceiptPayloadV1 = {
    schema_version: 1,
    issuer: 'trailhead-originals',
    audience: 'trailhead-originals-mobile',
    owner_binding: options.ownerBinding ?? OWNER_BINDING,
    entitlement_id: options.entitlementId ?? 'entitlement-test-smokies',
    pack_id: 'smokies-original',
    version: 1,
    manifest_id: options.manifestId ?? MANIFEST_ID,
    manifest_schema_version: options.manifestSchemaVersion ?? 2,
    access_type: 'explorer_subscription',
    issued_at: issuedAt,
    access_expires_at: options.accessExpiresAt ?? issuedAt + 30 * 86_400,
    receipt_expires_at: options.receiptExpiresAt ?? issuedAt + 72 * 3_600,
  };
  return {
    schema_version: 1,
    algorithm: 'Ed25519',
    key_id: KEY_ID,
    payload,
    signature: base64Url(ed25519.sign(concatBytes(DOMAIN, canonicalPayload(payload)), SECRET_KEY)),
  };
}

const pack: OriginalSummary = {
  id: 'smokies-original',
  slug: 'great-smoky-mountains-ridges-rivers-living-memory',
  content_kind: 'original_drive',
  version: 1,
  title: 'Great Smoky Mountains: Ridges, Rivers & Living Memory',
  summary: 'A four-chapter driving Original.',
  price_credits: 900,
  explorer_price_credits: 900,
  free: false,
  coverage_region: 'great_smoky_mountains',
  public_metadata: {},
  access_policy: {
    schema_version: 1,
    explorer_included: true,
    permanent_credit_price: 900,
  },
  published_at: 1,
  featured: false,
};

function acquisition(
  receipt: OriginalEntitlementReceiptV1 | null,
  options: { permanent?: boolean; manifestSchemaVersion?: 2 | 3 } = {},
): OriginalAuthenticatedAcquisition {
  const permanent = options.permanent === true;
  return {
    entitlement: {
      id: 'entitlement-test-smokies',
      pack_id: pack.id,
      version: pack.version,
      acquisition_type: permanent ? 'purchase' : 'explorer_included',
      access_type: permanent ? 'permanent' : 'explorer_subscription',
      permanent,
      access_active: true,
      access_expires_at: permanent ? null : receipt?.payload.access_expires_at ?? null,
      access_receipt_required: permanent ? false : true,
      manifest_id: permanent ? undefined : MANIFEST_ID,
      manifest_schema_version: permanent
        ? undefined
        : options.manifestSchemaVersion ?? 2,
      access_owner_binding: permanent ? undefined : OWNER_BINDING,
      access_receipt_expires_at: permanent ? undefined : receipt?.payload.receipt_expires_at ?? null,
      access_receipt: permanent ? null : receipt,
    },
    pack,
    trip: {},
    already_owned: false,
    replayed: false,
    credit_balance: 900,
  };
}

async function main() {
  const keys = { [KEY_ID]: base64Url(PUBLIC_KEY) };
  const receipt = signedReceipt();
  const expected = {
    ownerBinding: OWNER_BINDING,
    entitlementId: 'entitlement-test-smokies',
    packId: pack.id,
    version: pack.version,
    manifestId: MANIFEST_ID,
    manifestSchemaVersion: 2 as const,
  };
  const online = evaluateOriginalEntitlementReceipt(receipt, expected, {
    nowSeconds: 1_999_000_000,
    monotonicNowMs: 10_000,
    allowSignedRefresh: true,
    publicKeys: keys,
  });
  assert.deepEqual(online, {
    status: 'valid',
    trustedTimeFloorS: 2_000_000_000,
    receiptExpiresAtS: 2_000_259_200,
    monotonicAnchorMs: 10_000,
    monotonicAnchorTimeS: 2_000_000_000,
    active: true,
  });

  const v3Receipt = signedReceipt({ manifestSchemaVersion: 3 });
  assert.equal(evaluateOriginalEntitlementReceipt(v3Receipt, {
    ...expected,
    manifestSchemaVersion: 3,
  }, {
    nowSeconds: 1_999_000_000,
    monotonicNowMs: 10_000,
    allowSignedRefresh: true,
    publicKeys: keys,
  }).status, 'valid', 'a V3 receipt is accepted only with an exact V3 manifest context');
  assert.equal(evaluateOriginalEntitlementReceipt(v3Receipt, expected, {
    nowSeconds: 1_999_000_000,
    monotonicNowMs: 10_000,
    allowSignedRefresh: true,
    publicKeys: keys,
  }).status, 'identity_mismatch', 'a signed V3 receipt cannot unlock a V2 manifest context');

  const frozenWall = evaluateOriginalEntitlementReceipt(receipt, expected, {
    nowSeconds: 2_000_000_000,
    monotonicNowMs: 11_000,
    previousTrustedTimeFloorS: online.trustedTimeFloorS,
    previousReceiptExpiresAtS: online.receiptExpiresAtS,
    previousMonotonicAnchorMs: online.monotonicAnchorMs ?? undefined,
    previousMonotonicAnchorTimeS: online.monotonicAnchorTimeS ?? undefined,
    publicKeys: keys,
  });
  assert.equal(frozenWall.status, 'valid');
  assert.equal(frozenWall.trustedTimeFloorS, 2_000_000_001);

  const frozenPastReceipt = evaluateOriginalEntitlementReceipt(receipt, expected, {
    nowSeconds: 2_000_000_000,
    monotonicNowMs: 10_000 + 72 * 3_600 * 1_000,
    previousTrustedTimeFloorS: online.trustedTimeFloorS,
    previousReceiptExpiresAtS: online.receiptExpiresAtS,
    previousMonotonicAnchorMs: online.monotonicAnchorMs ?? undefined,
    previousMonotonicAnchorTimeS: online.monotonicAnchorTimeS ?? undefined,
    publicKeys: keys,
  });
  assert.equal(frozenPastReceipt.status, 'expired', 'monotonic elapsed time expires a frozen wall clock');

  assert.equal(evaluateOriginalEntitlementReceipt(receipt, expected, {
    nowSeconds: 2_000_000_100,
    monotonicNowMs: 50,
    previousTrustedTimeFloorS: online.trustedTimeFloorS,
    previousReceiptExpiresAtS: online.receiptExpiresAtS,
    previousMonotonicAnchorMs: online.monotonicAnchorMs ?? undefined,
    previousMonotonicAnchorTimeS: online.monotonicAnchorTimeS ?? undefined,
    publicKeys: keys,
  }).status, 'monotonic_reset', 'a reboot/reset locks until an authenticated refresh');

  const tampered = structuredClone(receipt);
  tampered.payload.receipt_expires_at += 86_400;
  assert.equal(evaluateOriginalEntitlementReceipt(tampered, expected, {
    monotonicNowMs: 11_000,
    publicKeys: keys,
  }).status, 'invalid');
  assert.equal(evaluateOriginalEntitlementReceipt(receipt, {
    ...expected,
    ownerBinding: Buffer.from(new Uint8Array(32)).toString('base64url'),
  }, { monotonicNowMs: 11_000, publicKeys: keys }).status, 'identity_mismatch');
  assert.equal(evaluateOriginalEntitlementReceipt(receipt, {
    ...expected,
    manifestId: 'smokies-original:2:published',
  }, { monotonicNowMs: 11_000, publicKeys: keys }).status, 'identity_mismatch');
  assert.equal(evaluateOriginalEntitlementReceipt(receipt, expected, {
    nowSeconds: 1_999_999_000,
    monotonicNowMs: 11_000,
    previousTrustedTimeFloorS: online.trustedTimeFloorS,
    previousReceiptExpiresAtS: online.receiptExpiresAtS,
    previousMonotonicAnchorMs: online.monotonicAnchorMs ?? undefined,
    previousMonotonicAnchorTimeS: online.monotonicAnchorTimeS ?? undefined,
    publicKeys: keys,
  }).status, 'clock_rollback');

  const refreshed = signedReceipt({
    issuedAt: 2_000_000_500,
    receiptExpiresAt: 2_000_100_000,
  });
  assert.equal(evaluateOriginalEntitlementReceipt(refreshed, expected, {
    nowSeconds: 1_999_999_000,
    monotonicNowMs: 20,
    previousTrustedTimeFloorS: frozenPastReceipt.trustedTimeFloorS,
    previousMonotonicAnchorMs: 10_000,
    previousMonotonicAnchorTimeS: 2_000_000_000,
    allowSignedRefresh: true,
    publicKeys: keys,
  }).status, 'valid', 'a fresh authenticated receipt resets the monotonic anchor');

  assert.equal(JSON.stringify(receipt).includes('account:42'), false);
  assert.equal(JSON.stringify(receipt).includes('"42"'), false);

  const previousKeys = process.env.EXPO_PUBLIC_ORIGINALS_ENTITLEMENT_RECEIPT_KEYS;
  process.env.EXPO_PUBLIC_ORIGINALS_ENTITLEMENT_RECEIPT_KEYS = JSON.stringify(keys);
  try {
    const now = Math.floor(Date.now() / 1_000);
    const storeReceipt = signedReceipt({
      issuedAt: now,
      accessExpiresAt: now + 30 * 86_400,
      receiptExpiresAt: now + 3_600,
    });
    const store = createOriginalAccessStore(createMemoryOriginalFileAdapter());
    const active = await store.recordEntitlement(acquisition(storeReceipt), 42);
    assert.equal(active.access_receipt_status, 'valid');
    assert.equal(originalLocalAccessIsCurrent(active, now + 60, { manifestId: MANIFEST_ID }), true);
    assert.equal(originalLocalAccessIsCurrent(active, now + 60, {
      manifestId: 'smokies-original:2:published',
    }), false, 'local playback is bound to the installed immutable manifest');
    const claimedAt = active.claimed_at_ms;

    const v3StoreReceipt = signedReceipt({
      manifestSchemaVersion: 3,
      issuedAt: now,
      accessExpiresAt: now + 30 * 86_400,
      receiptExpiresAt: now + 3_600,
    });
    const v3Store = createOriginalAccessStore(createMemoryOriginalFileAdapter());
    const v3Active = await v3Store.recordEntitlement(acquisition(v3StoreReceipt, {
      manifestSchemaVersion: 3,
    }), 43);
    assert.equal(v3Active.access_receipt_status, 'valid');
    assert.equal(v3Active.manifest_schema_version, 3);
    const v3Mismatched = await v3Store.recordEntitlement(acquisition(v3StoreReceipt, {
      manifestSchemaVersion: 2,
    }), 43);
    assert.equal(
      v3Mismatched.access_receipt_status,
      'identity_mismatch',
      'the store verifies V3 against the independently supplied manifest schema',
    );

    const locked = await store.recordEntitlement(acquisition(null), 42);
    assert.equal(locked.access_receipt_status, 'missing');
    assert.equal(originalLocalAccessIsCurrent(locked, now + 60), false);
    assert.equal(locked.claimed_at_ms, claimedAt, 'missing receipt preserves local ownership history');
    assert.equal((await store.list('account:42')).length, 1, 'locking never deletes the downloaded owner record');

    const permanent = await store.recordEntitlement(acquisition(null, { permanent: true }), 42);
    assert.equal(permanent.access_type, 'permanent');
    assert.equal(originalLocalAccessIsCurrent(permanent, Number.MAX_SAFE_INTEGER), true);
    assert.equal((await store.list('account:42')).length, 1);
  } finally {
    if (previousKeys == null) delete process.env.EXPO_PUBLIC_ORIGINALS_ENTITLEMENT_RECEIPT_KEYS;
    else process.env.EXPO_PUBLIC_ORIGINALS_ENTITLEMENT_RECEIPT_KEYS = previousKeys;
  }

  console.log('Trusted Original entitlement receipt tests passed.');
}

void main();
