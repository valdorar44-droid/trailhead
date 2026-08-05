import { storage } from '../storage';

const STORAGE_KEY = 'trailhead_originals_preview_access_v1';
const MAX_LOCAL_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export type OriginalPreviewAccessV1 = {
  schema_version: 1;
  token: string;
  expires_at_ms: number;
};

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
