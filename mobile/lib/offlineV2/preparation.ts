import { validateOfflineBundleManifest } from './manifest';
import type { OfflineBoundsV2, OfflineBundleManifestV2 } from './types';

export type OfflineBundlePrepareRequestV2 = Readonly<{
  bounds: OfflineBoundsV2;
  min_zoom?: number;
  max_zoom?: number;
  /** Approved identifier only. Clients never send an arbitrary style URI. */
  renderer_style_id?: string;
  options?: Readonly<{
    routing?: boolean;
    contours?: boolean;
    extended_media?: boolean;
  }>;
}>;

export type OfflineBundlePreparationStatusV2 = 'queued' | 'running' | 'ready' | 'error';

export type OfflineBundlePreparationV2 = Readonly<{
  schema_version: 2;
  id: string;
  status: OfflineBundlePreparationStatusV2;
  progress: number;
  bundle_id?: string;
  revision?: string;
  manifest?: OfflineBundleManifestV2;
  error?: Readonly<{ code: string; message: string }>;
  created_at: number;
  updated_at: number;
  completed_at?: number;
}>;

export class OfflineBundleApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'OfflineBundleApiError';
    this.status = status;
    this.code = code;
  }
}

export type OfflineBundlePrepareOptionsV2 = Readonly<{
  signal?: AbortSignal;
  timeout_ms?: number;
  poll_interval_ms?: number;
  onPreparation?: (preparation: OfflineBundlePreparationV2) => void;
}>;

export interface OfflineBundlePreparationClientV2 {
  prepare(
    request: OfflineBundlePrepareRequestV2,
    options?: OfflineBundlePrepareOptionsV2,
  ): Promise<OfflineBundleManifestV2>;
  resume?(
    preparationId: string,
    options?: OfflineBundlePrepareOptionsV2,
  ): Promise<OfflineBundleManifestV2>;
}

function isManifest(value: unknown): value is OfflineBundleManifestV2 {
  const item = value as Partial<OfflineBundleManifestV2> | null;
  return item?.schema_version === 2
    && typeof item.bundle_id === 'string'
    && typeof item.manifest_sha256 === 'string'
    && Array.isArray(item.artifacts);
}

function validatePreparation(value: unknown): OfflineBundlePreparationV2 {
  const item = value as Partial<OfflineBundlePreparationV2> | null;
  if (item?.schema_version !== 2
    || typeof item.id !== 'string'
    || !['queued', 'running', 'ready', 'error'].includes(String(item.status))
    || !Number.isFinite(item.progress)
    || Number(item.progress) < 0
    || Number(item.progress) > 100) {
    throw new Error('The offline preparation response is invalid.');
  }
  return Object.freeze({
    ...item,
    progress: Number(item.progress),
    ...(item.manifest ? { manifest: validateOfflineBundleManifest(item.manifest) } : {}),
  } as OfflineBundlePreparationV2);
}

function abortError() {
  const error = new Error('Offline preparation cancelled.');
  error.name = 'AbortError';
  return error;
}

function wait(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const clear = () => signal?.removeEventListener('abort', cancel);
    setTimeout(clear, milliseconds + 1);
  });
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function errorDetail(body: any, statusText: string) {
  const detail = body?.detail ?? body;
  if (typeof detail === 'string') return { message: detail };
  return {
    message: String(detail?.message || detail?.reason || statusText || 'Offline request failed.'),
    code: typeof detail?.code === 'string' ? detail.code : undefined,
  };
}

export function createOfflineBundlePreparationClientV2(input: Readonly<{
  baseUrl: string;
  getAuthToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}>): OfflineBundlePreparationClientV2 {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const baseUrl = normalizeBaseUrl(input.baseUrl);

  const requestJson = async (
    path: string,
    token: string,
    init: RequestInit,
  ) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = errorDetail(body, response.statusText);
      throw new OfflineBundleApiError(detail.message, response.status, detail.code);
    }
    return body;
  };

  const finishPreparation = async (
    initial: OfflineBundlePreparationV2,
    token: string,
    options: OfflineBundlePrepareOptionsV2,
  ) => {
    let preparation = initial;
    options.onPreparation?.(preparation);
    const timeout = Math.max(5_000, options.timeout_ms ?? 5 * 60_000);
    const interval = Math.max(250, options.poll_interval_ms ?? 1_000);
    const deadline = now() + timeout;
    while (preparation.status === 'queued' || preparation.status === 'running') {
      if (now() >= deadline) {
        throw new OfflineBundleApiError(
          'The offline bundle is still being prepared. You can resume it from Downloads.',
          408,
          'offline_preparation_timeout',
        );
      }
      await wait(interval, options.signal);
      const body = await requestJson(
        `/api/offline/bundles/preparations/${encodeURIComponent(preparation.id)}`,
        token,
        { signal: options.signal },
      );
      preparation = validatePreparation(body);
      options.onPreparation?.(preparation);
    }
    if (preparation.status === 'error') {
      throw new OfflineBundleApiError(
        preparation.error?.message || 'This offline bundle could not be prepared.',
        422,
        preparation.error?.code,
      );
    }
    if (!preparation.manifest) {
      throw new OfflineBundleApiError(
        'The completed offline preparation did not include a manifest.',
        502,
        'offline_manifest_missing',
      );
    }
    return validateOfflineBundleManifest(preparation.manifest);
  };

  return {
    async prepare(request, options = {}) {
      if (options.signal?.aborted) throw abortError();
      const token = await input.getAuthToken();
      if (!token) throw new OfflineBundleApiError('Sign in to download this area.', 401, 'authentication_required');
      const first = await requestJson('/api/offline/bundles/prepare', token, {
        method: 'POST',
        signal: options.signal,
        body: JSON.stringify(request),
      });
      if (isManifest(first)) return validateOfflineBundleManifest(first);
      return finishPreparation(validatePreparation(first), token, options);
    },
    async resume(preparationId, options = {}) {
      if (options.signal?.aborted) throw abortError();
      const token = await input.getAuthToken();
      if (!token) throw new OfflineBundleApiError('Sign in to download this area.', 401, 'authentication_required');
      const body = await requestJson(
        `/api/offline/bundles/preparations/${encodeURIComponent(preparationId)}`,
        token,
        { signal: options.signal },
      );
      return finishPreparation(validatePreparation(body), token, options);
    },
  };
}
