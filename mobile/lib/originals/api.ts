import { TRAILHEAD_API_BASE } from '../apiBase';
import { storage } from '../storage';
import { validateOriginalManifest } from './manifest';
import type {
  OriginalAcquisition,
  OriginalCatalogResponse,
  OriginalDetail,
  OriginalManifestV1,
  OriginalOwnedResponse,
  OriginalSummary,
} from './types';

export class OriginalsApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'OriginalsApiError';
    this.status = status;
    this.detail = detail;
  }
}

type RequestOptions = RequestInit & { requireAuth?: boolean };

async function originalsRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await storage.get('trailhead_token').catch(() => null);
  if (options.requireAuth && !token) {
    throw new OriginalsApiError('Sign in to continue.', 401, { code: 'authentication_required' });
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${TRAILHEAD_API_BASE}${path}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail ?? body;
    const message = typeof detail === 'string'
      ? detail
      : detail?.message ?? detail?.reason ?? response.statusText ?? 'Request failed';
    throw new OriginalsApiError(message, response.status, detail);
  }
  return body as T;
}

export type ListOriginalsOptions = {
  limit?: number;
  cursor?: string;
  coverageRegion?: string;
  signal?: AbortSignal;
};

export type AcquireOriginalOptions = {
  idempotencyKey?: string;
  version?: number;
  signal?: AbortSignal;
};

export type OriginalAdminDraftSummary = {
  id: string;
  slug: string;
  title: string;
  status: string;
  draft_revision: number;
  updated_at?: number;
};

export const originalsApi = {
  adminDrafts(signal?: AbortSignal) {
    return originalsRequest<{ items: OriginalAdminDraftSummary[] }>('/api/admin/originals', {
      signal,
      requireAuth: true,
    });
  },

  async adminPreviewManifest(id: string, signal?: AbortSignal): Promise<OriginalManifestV1> {
    const response = await originalsRequest<unknown>(
      `/api/admin/originals/${encodeURIComponent(id)}/device-preview/manifest`,
      { signal, requireAuth: true },
    );
    return validateOriginalManifest(response);
  },

  list(options: ListOriginalsOptions = {}) {
    const query = new URLSearchParams();
    if (options.limit != null) query.set('limit', String(options.limit));
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.coverageRegion) query.set('coverage_region', options.coverageRegion);
    const encoded = query.toString();
    const suffix = encoded ? `?${encoded}` : '';
    return originalsRequest<OriginalCatalogResponse>(`/api/originals${suffix}`, { signal: options.signal });
  },

  featured(signal?: AbortSignal) {
    return originalsRequest<OriginalSummary>('/api/originals/featured/current', { signal });
  },

  detail(idOrSlug: string, signal?: AbortSignal) {
    return originalsRequest<OriginalDetail>(`/api/originals/${encodeURIComponent(idOrSlug)}`, { signal });
  },

  acquire(id: string, options: AcquireOriginalOptions = {}) {
    const query = options.version == null ? '' : `?version=${encodeURIComponent(String(options.version))}`;
    return originalsRequest<OriginalAcquisition>(`/api/originals/${encodeURIComponent(id)}/acquire${query}`, {
      method: 'POST',
      signal: options.signal,
      headers: options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined,
    });
  },

  claimFeatured(idempotencyKey: string, signal?: AbortSignal) {
    return originalsRequest<OriginalAcquisition>('/api/originals/featured/current/claim', {
      method: 'POST',
      signal,
      requireAuth: true,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  owned(signal?: AbortSignal) {
    return originalsRequest<OriginalOwnedResponse>('/api/originals/owned', { signal, requireAuth: true });
  },

  restore(signal?: AbortSignal) {
    return originalsRequest<OriginalOwnedResponse>('/api/originals/restore', {
      method: 'POST',
      signal,
      requireAuth: true,
    });
  },

  async manifest(id: string, version: number, signal?: AbortSignal): Promise<OriginalManifestV1> {
    const response = await originalsRequest<unknown>(
      `/api/originals/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(version))}/manifest`,
      { signal },
    );
    return validateOriginalManifest(response);
  },
};
