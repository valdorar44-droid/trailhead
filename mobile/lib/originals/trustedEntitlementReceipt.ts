import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import type {
  OriginalEntitlementReceiptStatusV1,
  OriginalEntitlementReceiptV1,
} from './types';

ed25519.hashes.sha512 = sha512;

const RECEIPT_DOMAIN = utf8ToBytes('trailhead-original-entitlement-receipt-v1\0');
const CLOCK_ROLLBACK_TOLERANCE_S = 5 * 60;
const RECEIPT_KEYS = ['schema_version', 'algorithm', 'key_id', 'payload', 'signature'] as const;
const PAYLOAD_KEYS = [
  'schema_version', 'issuer', 'audience', 'owner_binding', 'entitlement_id',
  'pack_id', 'version', 'manifest_id', 'manifest_schema_version', 'access_type',
  'issued_at', 'access_expires_at', 'receipt_expires_at',
] as const;

export type OriginalTrustedReceiptEvaluationV1 = {
  status: OriginalEntitlementReceiptStatusV1;
  trustedTimeFloorS: number;
  receiptExpiresAtS: number | null;
  monotonicAnchorMs: number | null;
  monotonicAnchorTimeS: number | null;
  active: boolean;
};

type ReceiptExpectedIdentity = {
  ownerBinding: string;
  entitlementId: string | number;
  packId: string;
  version: number;
  manifestId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalPayload(value: Record<string, unknown>) {
  const sorted = Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = value[key];
    return result;
  }, {});
  return utf8ToBytes(JSON.stringify(sorted));
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left, 0);
  result.set(right, left.length);
  return result;
}

function base64UrlBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_base64url');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('invalid_base64url');
    buffer = (buffer << 6) | index;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      output.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) throw new Error('invalid_base64url');
  return Uint8Array.from(output);
}

function configuredPublicKeys(
  raw = process.env.EXPO_PUBLIC_ORIGINALS_ENTITLEMENT_RECEIPT_KEYS,
): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([keyId, publicKey]) => (
      /^[A-Za-z0-9._-]{1,80}$/.test(keyId)
      && typeof publicKey === 'string'
      && /^[A-Za-z0-9_-]+$/.test(publicKey)
    ))) as Record<string, string>;
  } catch {
    return {};
  }
}

function currentMonotonicTimeMs() {
  const value = globalThis.performance?.now?.();
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function inactive(
  status: OriginalEntitlementReceiptStatusV1,
  previous: {
    trustedTimeFloorS?: number;
    receiptExpiresAtS?: number | null;
    monotonicAnchorMs?: number;
    monotonicAnchorTimeS?: number;
  } = {},
): OriginalTrustedReceiptEvaluationV1 {
  return {
    status,
    trustedTimeFloorS: Math.max(0, Math.floor(previous.trustedTimeFloorS ?? 0)),
    receiptExpiresAtS: previous.receiptExpiresAtS ?? null,
    monotonicAnchorMs: Number.isFinite(previous.monotonicAnchorMs)
      ? previous.monotonicAnchorMs ?? null
      : null,
    monotonicAnchorTimeS: Number.isFinite(previous.monotonicAnchorTimeS)
      ? Math.floor(previous.monotonicAnchorTimeS ?? 0)
      : null,
    active: false,
  };
}

export function evaluateOriginalEntitlementReceipt(
  receiptInput: unknown,
  expected: ReceiptExpectedIdentity,
  options: {
    nowSeconds?: number;
    monotonicNowMs?: number | null;
    previousTrustedTimeFloorS?: number;
    previousReceiptExpiresAtS?: number | null;
    previousMonotonicAnchorMs?: number;
    previousMonotonicAnchorTimeS?: number;
    allowSignedRefresh?: boolean;
    publicKeys?: Record<string, string>;
  } = {},
): OriginalTrustedReceiptEvaluationV1 {
  const previousState = {
    trustedTimeFloorS: options.previousTrustedTimeFloorS,
    receiptExpiresAtS: options.previousReceiptExpiresAtS,
    monotonicAnchorMs: options.previousMonotonicAnchorMs,
    monotonicAnchorTimeS: options.previousMonotonicAnchorTimeS,
  };
  if (!isRecord(receiptInput)) return inactive('missing', previousState);
  if (!hasExactKeys(receiptInput, RECEIPT_KEYS)) return inactive('invalid', previousState);
  const receipt = receiptInput as unknown as OriginalEntitlementReceiptV1;
  if (
    receipt.schema_version !== 1
    || receipt.algorithm !== 'Ed25519'
    || !/^[A-Za-z0-9._-]{1,80}$/.test(receipt.key_id)
    || typeof receipt.signature !== 'string'
    || !isRecord(receipt.payload)
    || !hasExactKeys(receipt.payload, PAYLOAD_KEYS)
  ) return inactive('invalid', previousState);

  const publicKeys = options.publicKeys ?? configuredPublicKeys();
  const encodedPublicKey = publicKeys[receipt.key_id];
  if (!encodedPublicKey) return inactive('untrusted_key', previousState);
  try {
    const publicKey = base64UrlBytes(encodedPublicKey);
    const signature = base64UrlBytes(receipt.signature);
    if (publicKey.length !== 32 || signature.length !== 64 || !ed25519.verify(
      signature,
      concatBytes(RECEIPT_DOMAIN, canonicalPayload(receipt.payload)),
      publicKey,
      { zip215: false },
    )) return inactive('invalid', previousState);
  } catch {
    return inactive('invalid', previousState);
  }

  const payload = receipt.payload;
  if (
    payload.schema_version !== 1
    || payload.issuer !== 'trailhead-originals'
    || payload.audience !== 'trailhead-originals-mobile'
    || payload.access_type !== 'explorer_subscription'
    || payload.manifest_schema_version !== 2
    || !/^[A-Za-z0-9_-]{43}$/.test(expected.ownerBinding)
    || payload.owner_binding !== expected.ownerBinding
    || payload.entitlement_id !== String(expected.entitlementId)
    || payload.pack_id !== expected.packId
    || payload.version !== expected.version
    || payload.manifest_id !== expected.manifestId
    || !expected.manifestId.trim()
  ) return inactive('identity_mismatch', previousState);
  if (
    !Number.isInteger(payload.issued_at)
    || !Number.isInteger(payload.access_expires_at)
    || !Number.isInteger(payload.receipt_expires_at)
    || payload.issued_at < 1
    || payload.access_expires_at <= payload.issued_at
    || payload.receipt_expires_at <= payload.issued_at
    || payload.receipt_expires_at > payload.access_expires_at
  ) return inactive('invalid', previousState);

  const nowSeconds = Math.floor(options.nowSeconds ?? Date.now() / 1_000);
  const monotonicNowMs = options.monotonicNowMs === undefined
    ? currentMonotonicTimeMs()
    : options.monotonicNowMs;
  if (monotonicNowMs == null || !Number.isFinite(monotonicNowMs) || monotonicNowMs < 0) {
    return inactive('monotonic_reset', {
      ...previousState,
      receiptExpiresAtS: payload.receipt_expires_at,
    });
  }
  // recordEntitlement invokes this only for a fresh authenticated server
  // response. Its signed issued_at is authoritative and can safely recover a
  // device whose wall clock previously jumped forward or backward.
  if (options.allowSignedRefresh === true) {
    return {
      status: 'valid',
      trustedTimeFloorS: payload.issued_at,
      receiptExpiresAtS: payload.receipt_expires_at,
      monotonicAnchorMs: monotonicNowMs,
      monotonicAnchorTimeS: payload.issued_at,
      active: true,
    };
  }
  const anchorMs = options.previousMonotonicAnchorMs;
  const anchorTimeS = options.previousMonotonicAnchorTimeS;
  if (
    !Number.isFinite(anchorMs)
    || !Number.isFinite(anchorTimeS)
    || (anchorMs ?? -1) < 0
    || (anchorTimeS ?? 0) < payload.issued_at
    || monotonicNowMs < (anchorMs ?? 0)
  ) {
    return inactive('monotonic_reset', {
      ...previousState,
      receiptExpiresAtS: payload.receipt_expires_at,
    });
  }
  if (nowSeconds + CLOCK_ROLLBACK_TOLERANCE_S < payload.issued_at) {
    return inactive('clock_rollback', {
      ...previousState,
      receiptExpiresAtS: payload.receipt_expires_at,
      monotonicAnchorMs: anchorMs,
      monotonicAnchorTimeS: anchorTimeS,
    });
  }
  const monotonicTimeS = Math.floor(
    (anchorTimeS ?? 0) + (monotonicNowMs - (anchorMs ?? 0)) / 1_000,
  );
  const trustedTimeFloorS = Math.max(
    Math.max(0, Math.floor(options.previousTrustedTimeFloorS ?? 0)),
    payload.issued_at,
    monotonicTimeS,
    nowSeconds,
  );
  const result = {
    trustedTimeFloorS,
    receiptExpiresAtS: payload.receipt_expires_at,
    monotonicAnchorMs: anchorMs ?? null,
    monotonicAnchorTimeS: anchorTimeS == null ? null : Math.floor(anchorTimeS),
  };
  if (trustedTimeFloorS >= payload.receipt_expires_at) {
    return { ...result, status: 'expired', active: false };
  }
  return { ...result, status: 'valid', active: true };
}
