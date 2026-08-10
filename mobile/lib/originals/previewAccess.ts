import { storage } from '../storage';
import type { OriginalOwnerScope } from './types';

const STORAGE_KEY = 'trailhead_originals_preview_access_v1';
const CLEANUP_STORAGE_KEY = 'trailhead_originals_private_review_cleanup_v1';
const MAX_LOCAL_LIFETIME_MS = 24 * 60 * 60 * 1_000;
let cleanupMutationTail: Promise<unknown> = Promise.resolve();

function serializeCleanupMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = cleanupMutationTail.then(operation, operation);
  cleanupMutationTail = result.catch(() => undefined);
  return result;
}

export type OriginalPreviewAccessV1 = {
  schema_version: 1;
  token: string;
  expires_at_ms: number;
};

export type OriginalPrivateReviewCleanupIdentityV1 = {
  owner_scope: OriginalOwnerScope;
  pack_id: string;
  version: number;
  manifest_id: string;
};

type OriginalPrivateReviewCleanupRecordV1 = OriginalPrivateReviewCleanupIdentityV1 & {
  schema_version: 1;
  created_at_ms: number;
};

function validatePrivateReviewCleanupIdentity(
  value: Partial<OriginalPrivateReviewCleanupRecordV1> | null | undefined,
): OriginalPrivateReviewCleanupRecordV1 {
  if (
    value?.schema_version !== 1
    || typeof value.owner_scope !== 'string'
    || !value.owner_scope.startsWith('account:')
    || value.owner_scope.length <= 'account:'.length
    || typeof value.pack_id !== 'string'
    || !value.pack_id.trim()
    || !Number.isSafeInteger(value.version)
    || Number(value.version) <= 0
    || typeof value.manifest_id !== 'string'
    || !value.manifest_id.trim()
    || !Number.isFinite(value.created_at_ms)
  ) throw new Error('The pending private review cleanup identity could not be verified.');
  return value as OriginalPrivateReviewCleanupRecordV1;
}

function samePrivateReviewCleanupIdentity(
  left: OriginalPrivateReviewCleanupIdentityV1,
  right: OriginalPrivateReviewCleanupIdentityV1,
) {
  return left.owner_scope === right.owner_scope
    && left.pack_id === right.pack_id
    && left.version === right.version
    && left.manifest_id === right.manifest_id;
}

export async function getOriginalPrivateReviewCleanupIdentity() {
  const raw = await storage.get(CLEANUP_STORAGE_KEY);
  if (raw == null) return null;
  try {
    return validatePrivateReviewCleanupIdentity(JSON.parse(raw));
  } catch {
    throw new Error('The pending private review cleanup identity could not be verified.');
  }
}

/** Persist exact cleanup intent before any private access, files, or map are written. */
export function saveOriginalPrivateReviewCleanupIdentity(
  identity: OriginalPrivateReviewCleanupIdentityV1,
  nowMs = Date.now(),
) {
  return serializeCleanupMutation(async () => {
    const value = validatePrivateReviewCleanupIdentity({
      schema_version: 1,
      ...identity,
      created_at_ms: nowMs,
    });
    const existing = await getOriginalPrivateReviewCleanupIdentity();
    if (existing) {
      throw new Error('Finish the existing private review cleanup before opening another draft.');
    }
    await storage.set(CLEANUP_STORAGE_KEY, JSON.stringify(value));
    const persisted = await getOriginalPrivateReviewCleanupIdentity();
    if (!persisted || !samePrivateReviewCleanupIdentity(persisted, value)) {
      throw new Error('The private review cleanup identity could not be saved on this device.');
    }
    return persisted;
  });
}

/** Remove cleanup intent only after every exact local resource is confirmed absent. */
export function clearOriginalPrivateReviewCleanupIdentityStrict(
  expected: OriginalPrivateReviewCleanupIdentityV1,
) {
  return serializeCleanupMutation(async () => {
    const current = await getOriginalPrivateReviewCleanupIdentity();
    if (!current) return;
    if (!samePrivateReviewCleanupIdentity(current, expected)) {
      throw new Error('The pending private review cleanup identity changed; nothing was cleared.');
    }
    await storage.del(CLEANUP_STORAGE_KEY);
    if (await storage.get(CLEANUP_STORAGE_KEY) != null) {
      throw new Error('The private review cleanup identity could not be cleared from this device.');
    }
  });
}

function tokenExpiryMs(token: string) {
  for (const payload of token.split('.')) {
    try {
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = typeof atob === 'function'
        ? atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
        : null;
      if (!decoded) continue;
      const exp = Number(JSON.parse(decoded).exp);
      if (Number.isFinite(exp)) return exp * 1_000;
    } catch {
      // The signed preview format has one JSON segment and one opaque signature.
    }
  }
  return null;
}

function expiryMs(value: string | number | undefined, token: string, nowMs: number) {
  const numeric = typeof value === 'number' ? value : NaN;
  const parsed = Number.isFinite(numeric)
    ? (numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric)
    : typeof value === 'string' && value ? Date.parse(value) : NaN;
  const candidate = Number.isFinite(parsed) ? parsed : tokenExpiryMs(token) ?? nowMs + MAX_LOCAL_LIFETIME_MS;
  return Math.min(candidate, nowMs + MAX_LOCAL_LIFETIME_MS);
}

export async function saveOriginalPreviewAccess(
  token: string,
  expiresAt?: string | number,
  nowMs = Date.now(),
) {
  const cleanToken = token.trim();
  if (!cleanToken) throw new Error('The internal preview link does not contain a token.');
  const value: OriginalPreviewAccessV1 = {
    schema_version: 1,
    token: cleanToken,
    expires_at_ms: expiryMs(expiresAt, cleanToken, nowMs),
  };
  if (value.expires_at_ms <= nowMs) throw new Error('This internal preview link has expired.');
  await storage.set(STORAGE_KEY, JSON.stringify(value));
  return value;
}

export async function getOriginalPreviewToken(nowMs = Date.now()) {
  try {
    const parsed = JSON.parse(await storage.get(STORAGE_KEY) || '') as Partial<OriginalPreviewAccessV1>;
    if (parsed.schema_version !== 1 || typeof parsed.token !== 'string' || !Number.isFinite(parsed.expires_at_ms)) {
      await storage.del(STORAGE_KEY).catch(() => {});
      return null;
    }
    if (Number(parsed.expires_at_ms) <= nowMs) {
      await storage.del(STORAGE_KEY).catch(() => {});
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

export async function clearOriginalPreviewAccess() {
  await storage.del(STORAGE_KEY).catch(() => {});
}

/** Fail closed when removing a credential as part of private-review cleanup. */
export async function clearOriginalPreviewAccessStrict() {
  await storage.del(STORAGE_KEY);
  if (await storage.get(STORAGE_KEY)) {
    throw new Error('The private preview credential could not be removed from this device.');
  }
}

export async function consumeOriginalPreviewUrl(url: string | null | undefined) {
  if (!url || !url.includes('originals_preview_token')) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'trailhead:' && parsed.protocol !== 'com.trailhead.app:') {
    throw new Error('Internal preview tokens are accepted only through the Trailhead app link.');
  }
  const token = parsed.searchParams.get('originals_preview_token');
  if (!token) return null;
  const pathParts = [parsed.hostname, ...parsed.pathname.split('/')]
    .map(value => value.trim())
    .filter(Boolean);
  const originalsIndex = pathParts.findIndex(value => value === 'originals');
  const id = originalsIndex >= 0 ? pathParts[originalsIndex + 1] : undefined;
  const previewRoute = id === 'preview';
  const previewId = parsed.searchParams.get('id')?.trim() || '';
  const chapter = parsed.searchParams.get('chapter')?.trim() || '';
  const variant = parsed.searchParams.get('variant')?.trim() || '';
  if (previewRoute && (!previewId || !chapter || !variant)) {
    throw new Error('Choose a chapter and route in Originals Studio, then generate a new app link.');
  }
  const destination = previewRoute
    ? {
      pathname: '/originals/preview' as const,
      params: { id: previewId, chapter, variant },
    }
    : id
      ? { pathname: '/originals/[id]' as const, params: { id } }
      : { pathname: '/originals' as const };
  await saveOriginalPreviewAccess(token);
  return destination;
}
