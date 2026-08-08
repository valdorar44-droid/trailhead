import { TRAILHEAD_API_BASE } from '../apiBase';
import { storage } from '../storage';
import type { OriginalFeedbackPayloadV1 } from './feedbackStore';
import { OriginalManifestError } from './manifest';
import { originalConsumerCapabilityHeaders } from './clientCapabilities';
import {
  validateOriginalConsumerManifest,
  validateOriginalManifestPreview,
} from './manifestV2';
import { getOriginalPreviewToken } from './previewAccess';
import type {
  OriginalAcquisition,
  OriginalCatalogResponse,
  OriginalDetail,
  OriginalManifest,
  OriginalAccessMode,
  OriginalOwnedResponse,
  OriginalSummary,
  OriginalStartReadinessV1,
} from './types';
import type {
  OriginalVehicleBindingEnvelopeV1,
  OriginalVehicleBindingInputV1,
  OriginalVehicleBindingV1,
} from './vehicleBinding';

function validateOriginalDetailResponse(input: unknown): OriginalDetail {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new OriginalManifestError('Original detail must be an object.');
  }
  const detail = input as OriginalDetail;
  if (typeof detail.id !== 'string' || !detail.id.trim()) {
    throw new OriginalManifestError('Original detail id is required.');
  }
  if (typeof detail.slug !== 'string' || !detail.slug.trim()) {
    throw new OriginalManifestError('Original detail slug is required.');
  }
  if (!Number.isInteger(detail.version) || detail.version < 1) {
    throw new OriginalManifestError('Original detail version is invalid.');
  }
  const preview = validateOriginalManifestPreview(detail.manifest_preview);
  if (preview.pack_id !== String(detail.id) || preview.version !== detail.version) {
    throw new OriginalManifestError('Original detail and manifest preview identities do not match.');
  }
  return { ...detail, manifest_preview: preview };
}

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

type RequestOptions = RequestInit & {
  requireAuth?: boolean;
  /** Explicitly pins auth for the logical operation. Null forces a guest request. */
  authToken?: string | null;
};

async function originalsRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const hasPinnedAuth = Object.prototype.hasOwnProperty.call(options, 'authToken');
  const token = hasPinnedAuth
    ? options.authToken ?? null
    : await storage.get('trailhead_token').catch(() => null);
  if (options.requireAuth && !token) {
    throw new OriginalsApiError('Sign in to continue.', 401, { code: 'authentication_required' });
  }
  const { requireAuth: _requireAuth, authToken: _authToken, ...request } = options;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
    ...originalConsumerCapabilityHeaders(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const previewToken = await getOriginalPreviewToken().catch(() => null);
  if (previewToken) headers['X-Trailhead-Originals-Preview'] = previewToken;
  const response = await fetch(`${TRAILHEAD_API_BASE}${path}`, { ...request, headers });
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
  authToken?: string | null;
};

export type AcquireOriginalOptions = {
  idempotencyKey?: string;
  version?: number;
  accessMode?: OriginalAccessMode;
  signal?: AbortSignal;
  authToken?: string | null;
};

export type SubmitOriginalFeedbackOptions = {
  idempotencyKey: string;
  authToken?: string | null;
  guestToken?: string;
  signal?: AbortSignal;
};

export type OriginalVehicleBindingRequestOptions = {
  signal?: AbortSignal;
  authToken?: string | null;
};

export type OriginalPreviewTokenResponse = {
  token: string;
  expires_at: number;
  header: 'X-Trailhead-Originals-Preview';
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
  adminPreviewToken(expiresInSeconds = 3_600, signal?: AbortSignal) {
    return originalsRequest<OriginalPreviewTokenResponse>('/api/admin/originals/preview-token', {
      method: 'POST',
      signal,
      requireAuth: true,
      body: JSON.stringify({ expires_in_seconds: expiresInSeconds }),
    });
  },

  adminDrafts(signal?: AbortSignal) {
    return originalsRequest<{ items: OriginalAdminDraftSummary[] }>('/api/admin/originals', {
      signal,
      requireAuth: true,
    });
  },

  async adminPreviewManifest(
    id: string,
    selection?: { chapter_id: string; variant_id: string },
    signal?: AbortSignal,
  ): Promise<OriginalManifest> {
    const query = selection
      ? `?chapter_id=${encodeURIComponent(selection.chapter_id)}&variant_id=${encodeURIComponent(selection.variant_id)}`
      : '';
    const response = await originalsRequest<unknown>(
      `/api/admin/originals/${encodeURIComponent(id)}/device-preview/manifest${query}`,
      { signal, requireAuth: true },
    );
    return validateOriginalConsumerManifest(response);
  },

  availability(signal?: AbortSignal, authToken?: string | null) {
    return originalsRequest<{ originals: boolean }>('/api/product/features', {
      signal,
      ...(authToken !== undefined ? { authToken } : {}),
    });
  },

  list(options: ListOriginalsOptions = {}) {
    const query = new URLSearchParams();
    if (options.limit != null) query.set('limit', String(options.limit));
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.coverageRegion) query.set('coverage_region', options.coverageRegion);
    const encoded = query.toString();
    const suffix = encoded ? `?${encoded}` : '';
    return originalsRequest<OriginalCatalogResponse>(`/api/originals${suffix}`, {
      signal: options.signal,
      ...(Object.prototype.hasOwnProperty.call(options, 'authToken') ? { authToken: options.authToken } : {}),
    });
  },

  featured(signal?: AbortSignal) {
    return originalsRequest<OriginalSummary>('/api/originals/featured/current', { signal });
  },

  async detail(idOrSlug: string, signal?: AbortSignal, authToken?: string | null) {
    const response = await originalsRequest<unknown>(`/api/originals/${encodeURIComponent(idOrSlug)}`, {
      signal,
      ...(authToken !== undefined ? { authToken } : {}),
    });
    return validateOriginalDetailResponse(response);
  },

  acquire(id: string, options: AcquireOriginalOptions = {}) {
    const query = new URLSearchParams();
    if (options.version != null) query.set('version', String(options.version));
    if (options.accessMode) query.set('access_mode', options.accessMode);
    const encoded = query.toString();
    const suffix = encoded ? `?${encoded}` : '';
    return originalsRequest<OriginalAcquisition>(`/api/originals/${encodeURIComponent(id)}/acquire${suffix}`, {
      method: 'POST',
      signal: options.signal,
      ...(Object.prototype.hasOwnProperty.call(options, 'authToken') ? { authToken: options.authToken } : {}),
      headers: options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined,
    });
  },

  claimFeatured(idempotencyKey: string, signal?: AbortSignal, authToken?: string | null) {
    return originalsRequest<OriginalAcquisition>('/api/originals/featured/current/claim', {
      method: 'POST',
      signal,
      ...(authToken !== undefined ? { authToken } : {}),
      requireAuth: true,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  owned(signal?: AbortSignal, authToken?: string | null) {
    return originalsRequest<OriginalOwnedResponse>('/api/originals/owned', {
      signal,
      ...(authToken !== undefined ? { authToken } : {}),
      requireAuth: true,
    });
  },

  restore(signal?: AbortSignal, authToken?: string | null) {
    return originalsRequest<OriginalOwnedResponse>('/api/originals/restore', {
      method: 'POST',
      signal,
      ...(authToken !== undefined ? { authToken } : {}),
      requireAuth: true,
    });
  },

  getVehicleBinding(options: OriginalVehicleBindingRequestOptions = {}) {
    return originalsRequest<OriginalVehicleBindingEnvelopeV1>(
      '/api/account/originals/vehicle-binding',
      {
        signal: options.signal,
        ...(Object.prototype.hasOwnProperty.call(options, 'authToken')
          ? { authToken: options.authToken }
          : {}),
        requireAuth: true,
      },
    );
  },

  putVehicleBinding(
    payload: OriginalVehicleBindingInputV1,
    options: OriginalVehicleBindingRequestOptions = {},
  ) {
    return originalsRequest<OriginalVehicleBindingV1>(
      '/api/account/originals/vehicle-binding',
      {
        method: 'PUT',
        signal: options.signal,
        ...(Object.prototype.hasOwnProperty.call(options, 'authToken')
          ? { authToken: options.authToken }
          : {}),
        requireAuth: true,
        body: JSON.stringify(payload),
      },
    );
  },

  deleteVehicleBinding(options: OriginalVehicleBindingRequestOptions = {}) {
    return originalsRequest<{ deleted: boolean }>(
      '/api/account/originals/vehicle-binding',
      {
        method: 'DELETE',
        signal: options.signal,
        ...(Object.prototype.hasOwnProperty.call(options, 'authToken')
          ? { authToken: options.authToken }
          : {}),
        requireAuth: true,
      },
    );
  },

  feedbackGuestToken(packId: string, version: number, installId: string, signal?: AbortSignal) {
    return originalsRequest<{ token: string; expires_at?: string }>('/api/originals/feedback/guest-token', {
      method: 'POST',
      signal,
      authToken: null,
      headers: { 'X-Trailhead-Install-ID': installId },
      body: JSON.stringify({ pack_id: packId, version }),
    });
  },

  submitFeedback(id: string, payload: OriginalFeedbackPayloadV1, options: SubmitOriginalFeedbackOptions) {
    return originalsRequest<Record<string, unknown>>(`/api/originals/${encodeURIComponent(id)}/feedback`, {
      method: 'POST',
      signal: options.signal,
      ...(Object.prototype.hasOwnProperty.call(options, 'authToken') ? { authToken: options.authToken } : {}),
      headers: {
        'Idempotency-Key': options.idempotencyKey,
        ...(options.guestToken ? { 'X-Original-Feedback-Token': options.guestToken } : {}),
      },
      body: JSON.stringify(payload),
    });
  },

  async manifest(
    id: string,
    version: number,
    signal?: AbortSignal,
    authToken?: string | null,
  ): Promise<OriginalManifest> {
    const response = await originalsRequest<unknown>(
      `/api/originals/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(version))}/manifest`,
      { signal, ...(authToken !== undefined ? { authToken } : {}) },
    );
    return validateOriginalConsumerManifest(response);
  },

  startReadiness(
    id: string,
    version: number,
    selection: {
      chapter_id: string;
      variant_id?: string;
      vehicle_binding_id?: string;
      planned_stop_minutes?: number;
    },
    options: OriginalVehicleBindingRequestOptions = {},
  ) {
    return originalsRequest<OriginalStartReadinessV1>(
      `/api/originals/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(version))}/start-readiness`,
      {
        method: 'POST',
        signal: options.signal,
        ...(Object.prototype.hasOwnProperty.call(options, 'authToken')
          ? { authToken: options.authToken }
          : {}),
        body: JSON.stringify(selection),
      },
    );
  },
};
