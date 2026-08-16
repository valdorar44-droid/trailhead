import { normalizeSearchV2Query } from './cache';
import type {
  SearchPageModeV2,
  SearchPageV2,
  SearchRequestV2,
  SearchResolveResponseV2,
} from './types';

export type SearchV2FeatureGate = () => boolean | Promise<boolean>;
export type SearchV2CallOptions = { signal?: AbortSignal; retry?: boolean };

export type SearchV2DiagnosticEvent = Readonly<{
  stage: 'suggest' | 'results' | 'resolve';
  provider_attempted: boolean;
  outcome: 'success' | 'timeout' | 'network' | 'http_error' | 'disabled' | 'aborted' | 'invalid_response' | 'unknown';
  duration_bucket: 'under_500ms' | '500_to_2499ms' | '2500_to_4999ms' | '5000ms_or_more';
  result_count_bucket: 'zero' | 'one' | 'two_to_five' | 'six_to_ten' | 'more_than_ten' | 'unknown';
  retry: boolean;
}>;

export interface SearchV2Client {
  suggest(request: SearchRequestV2, options?: SearchV2CallOptions): Promise<SearchPageV2>;
  results(request: SearchRequestV2, options?: SearchV2CallOptions): Promise<SearchPageV2>;
  resolve(request: SearchRequestV2, options?: SearchV2CallOptions): Promise<SearchResolveResponseV2>;
}

export type HttpSearchV2ClientOptions = {
  baseUrl: string;
  isEnabled: SearchV2FeatureGate;
  fetchImpl?: typeof fetch;
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  deadlinesMs?: Partial<Record<'canonicalSuggest' | 'suggest' | 'results' | 'resolve', number>>;
  onDiagnostic?: (event: SearchV2DiagnosticEvent) => void;
};

const DEFAULT_SEARCH_DEADLINES_MS = Object.freeze({
  // This is a resilience ceiling, not the performance target. Canonical
  // results are expected in under 400 ms; after 2.5 seconds the session
  // moves on to its bounded provider recovery instead of leaving quick search
  // apparently stuck behind a server or radio stall.
  canonicalSuggest: 2_500,
  suggest: 2_500,
  results: 5_000,
  resolve: 5_000,
});

export class SearchV2FeatureDisabledError extends Error {
  readonly code = 'search_v2_disabled';

  constructor() {
    super('Search V2 is not enabled for this account.');
    this.name = 'SearchV2FeatureDisabledError';
  }
}

export class SearchV2HttpError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'SearchV2HttpError';
    this.status = status;
    this.detail = detail;
  }
}

export class SearchV2TimeoutError extends Error {
  readonly code = 'search_v2_timeout';
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super('Search took too long.');
    this.name = 'SearchV2TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class HttpSearchV2Client implements SearchV2Client {
  private readonly baseUrl: string;
  private readonly isEnabled: SearchV2FeatureGate;
  private readonly fetchImpl: typeof fetch;
  private readonly getHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  private readonly deadlinesMs: Record<'canonicalSuggest' | 'suggest' | 'results' | 'resolve', number>;
  private readonly onDiagnostic?: (event: SearchV2DiagnosticEvent) => void;

  constructor(options: HttpSearchV2ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.isEnabled = options.isEnabled;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getHeaders = options.getHeaders ?? (() => ({}));
    this.onDiagnostic = options.onDiagnostic;
    this.deadlinesMs = {
      canonicalSuggest: normalizedDeadline(
        options.deadlinesMs?.canonicalSuggest,
        options.deadlinesMs?.suggest == null
          ? DEFAULT_SEARCH_DEADLINES_MS.canonicalSuggest
          : normalizedDeadline(options.deadlinesMs.suggest, DEFAULT_SEARCH_DEADLINES_MS.suggest),
      ),
      suggest: normalizedDeadline(options.deadlinesMs?.suggest, DEFAULT_SEARCH_DEADLINES_MS.suggest),
      results: normalizedDeadline(options.deadlinesMs?.results, DEFAULT_SEARCH_DEADLINES_MS.results),
      resolve: normalizedDeadline(options.deadlinesMs?.resolve, DEFAULT_SEARCH_DEADLINES_MS.resolve),
    };
  }

  suggest(request: SearchRequestV2, options: SearchV2CallOptions = {}): Promise<SearchPageV2> {
    return this.page('suggest', request, options);
  }

  results(request: SearchRequestV2, options: SearchV2CallOptions = {}): Promise<SearchPageV2> {
    return this.page('results', request, options);
  }

  async resolve(
    request: SearchRequestV2,
    options: SearchV2CallOptions = {},
  ): Promise<SearchResolveResponseV2> {
    const body = normalizeRequest(request, 'results');
    return this.instrument('resolve', body.include_external === true, options.retry === true, async () => {
      const payload = await this.requestJson('/api/search/v2/resolve', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: options.signal,
      }, this.deadlinesMs.resolve);
      if (!isResolveResponse(payload)) throw invalidResponseError(payload);
      return { value: payload, count: payload.selected ? 1 : payload.alternatives.length };
    });
  }

  private async page(
    mode: SearchPageModeV2,
    request: SearchRequestV2,
    options: SearchV2CallOptions,
  ): Promise<SearchPageV2> {
    const normalized = normalizeRequest(request, mode);
    const query = buildQueryString(normalized);
    return this.instrument(mode, normalized.include_external === true, options.retry === true, async () => {
      const payload = await this.requestJson(`/api/search/v2/${mode}?${query}`, {
        method: 'GET',
        signal: options.signal,
      }, mode === 'suggest' && normalized.include_external === false
        ? this.deadlinesMs.canonicalSuggest
        : this.deadlinesMs[mode]);
      if (!isSearchPage(payload)) throw invalidResponseError(payload);
      return { value: payload, count: payload.results.length };
    });
  }

  private async instrument<T>(
    stage: SearchV2DiagnosticEvent['stage'],
    providerAttempted: boolean,
    retry: boolean,
    task: () => Promise<{ value: T; count: number }>,
  ): Promise<T> {
    const started = Date.now();
    try {
      const completed = await task();
      this.emitDiagnostic(stage, providerAttempted, 'success', started, completed.count, retry);
      return completed.value;
    } catch (error) {
      this.emitDiagnostic(stage, providerAttempted, diagnosticOutcome(error), started, null, retry);
      throw error;
    }
  }

  private emitDiagnostic(
    stage: SearchV2DiagnosticEvent['stage'],
    providerAttempted: boolean,
    outcome: SearchV2DiagnosticEvent['outcome'],
    started: number,
    resultCount: number | null,
    retry: boolean,
  ): void {
    this.onDiagnostic?.(Object.freeze({
      stage,
      provider_attempted: providerAttempted,
      outcome,
      duration_bucket: durationBucket(Date.now() - started),
      result_count_bucket: resultCountBucket(resultCount),
      retry,
    }));
  }

  private async requestJson(path: string, init: RequestInit, deadlineMs: number): Promise<unknown> {
    return runWithSearchDeadline(deadlineMs, init.signal, async signal => {
      if (!(await this.isEnabled())) throw new SearchV2FeatureDisabledError();
      const extraHeaders = await this.getHeaders();
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal,
        headers: {
          Accept: 'application/json',
          ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
      });
      const payload = await response.json().catch(error => {
        if (signal.aborted) throw error;
        return null;
      });
      if (!response.ok) {
        const detail = isRecord(payload) ? payload.detail : payload;
        const message = typeof detail === 'string'
          ? detail
          : isRecord(detail) && typeof detail.message === 'string'
            ? detail.message
            : 'Search request failed.';
        throw new SearchV2HttpError(message, response.status, detail);
      }
      return payload;
    });
  }
}

/** A fixed, privacy-safe value suitable for QA selectors and diagnostics. */
export function searchV2DiagnosticCode(error: unknown): string {
  if (error instanceof SearchV2TimeoutError) return 'timeout';
  if (error instanceof SearchV2FeatureDisabledError) return 'disabled';
  if (error instanceof SearchV2HttpError) return `http_${error.status}`;
  if (error instanceof TypeError) return 'network';
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  return 'unknown';
}

export function searchV2CanRetry(error: unknown): boolean {
  return error instanceof SearchV2TimeoutError || error instanceof TypeError;
}

function invalidResponseError(payload: unknown): SearchV2HttpError {
  const error = new SearchV2HttpError('Search returned an invalid response.', 502, payload);
  Object.defineProperty(error, 'searchV2InvalidResponse', { value: true });
  return error;
}

function diagnosticOutcome(error: unknown): SearchV2DiagnosticEvent['outcome'] {
  if (error instanceof SearchV2TimeoutError) return 'timeout';
  if (error instanceof SearchV2FeatureDisabledError) return 'disabled';
  if (error instanceof SearchV2HttpError) {
    return (error as SearchV2HttpError & { searchV2InvalidResponse?: boolean }).searchV2InvalidResponse
      ? 'invalid_response'
      : 'http_error';
  }
  if (error instanceof TypeError) return 'network';
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  return 'unknown';
}

function durationBucket(durationMs: number): SearchV2DiagnosticEvent['duration_bucket'] {
  if (durationMs < 500) return 'under_500ms';
  if (durationMs < 2_500) return '500_to_2499ms';
  if (durationMs < 5_000) return '2500_to_4999ms';
  return '5000ms_or_more';
}

function resultCountBucket(count: number | null): SearchV2DiagnosticEvent['result_count_bucket'] {
  if (count == null) return 'unknown';
  if (count <= 0) return 'zero';
  if (count === 1) return 'one';
  if (count <= 5) return 'two_to_five';
  if (count <= 10) return 'six_to_ten';
  return 'more_than_ten';
}

async function runWithSearchDeadline<T>(
  deadlineMs: number,
  callerSignal: AbortSignal | null | undefined,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (callerSignal?.aborted) throw abortError();
  const controller = new AbortController();
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let cancelFromCaller: (() => void) | undefined;
  const work = task(controller.signal);
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = globalThis.setTimeout(() => {
      controller.abort();
      reject(new SearchV2TimeoutError(deadlineMs));
    }, deadlineMs);
  });
  const callerCancellation = callerSignal
    ? new Promise<never>((_resolve, reject) => {
        cancelFromCaller = () => {
          controller.abort();
          reject(abortError());
        };
        callerSignal.addEventListener('abort', cancelFromCaller, { once: true });
      })
    : null;
  try {
    return await Promise.race(callerCancellation
      ? [work, timeout, callerCancellation]
      : [work, timeout]);
  } finally {
    if (timer) globalThis.clearTimeout(timer);
    if (callerSignal && cancelFromCaller) callerSignal.removeEventListener('abort', cancelFromCaller);
  }
}

function abortError(): Error {
  try {
    return new DOMException('Aborted', 'AbortError');
  } catch {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    return error;
  }
}

function normalizedDeadline(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || Number(value) <= 0) return fallback;
  return Math.max(10, Math.round(Number(value)));
}

export function normalizeRequest(request: SearchRequestV2, mode: SearchPageModeV2): SearchRequestV2 {
  const query = normalizeSearchV2Query(request.query);
  if (query.length < 2) throw new TypeError('Search query must contain at least two characters.');
  const scope = request.scope ?? 'global';
  if (scope === 'viewport' && !request.bounds) throw new TypeError('Viewport search requires bounds.');
  if (scope === 'nearby' && !request.center) throw new TypeError('Nearby search requires a center.');
  if (scope === 'route' && !request.route_ref) throw new TypeError('Route search requires a route reference.');
  if (request.route_ref && scope !== 'route') throw new TypeError('Route references are only valid with route search.');
  if (request.bounds && scope !== 'viewport' && scope !== 'offline') {
    throw new TypeError('Bounds are only valid for viewport or offline search.');
  }
  if (request.radius_meters != null) {
    if (scope !== 'nearby' && scope !== 'offline') throw new TypeError('Search radius is only valid for nearby or offline search.');
    if (!request.center) throw new TypeError('Search radius requires a center.');
    if (!Number.isFinite(request.radius_meters) || request.radius_meters < 100 || request.radius_meters > 250_000) {
      throw new TypeError('Search radius must be between 100 and 250000 meters.');
    }
  }
  const hasSelectedResult = Boolean(request.selected_result_id);
  const hasSelectedDetail = Boolean(request.selected_detail_ref);
  if (hasSelectedResult !== hasSelectedDetail) {
    throw new TypeError('Explicit search selection requires both result and detail references.');
  }
  const includeExternal = request.include_external ?? (Boolean(request.session_id) && scope !== 'offline');
  if (scope === 'offline' && includeExternal) throw new TypeError('Offline search cannot use external providers.');
  if (includeExternal && !request.session_id) throw new TypeError('External search requires a session identifier.');
  if (hasSelectedResult && (!request.session_id || !includeExternal)) {
    throw new TypeError('External result selection requires its original search session.');
  }
  return {
    ...request,
    query,
    surface: request.surface ?? 'map',
    intent: request.intent ?? 'any',
    scope,
    categories: Array.from(new Set((request.categories ?? []).map(value => value.trim()).filter(Boolean))).slice(0, 24),
    filters: request.filters ?? {},
    limit: clampInteger(request.limit ?? (mode === 'suggest' ? 8 : 20), 1, mode === 'suggest' ? 10 : 30),
    include_external: includeExternal,
  };
}

function buildQueryString(request: SearchRequestV2): string {
  const query = new URLSearchParams({
    q: request.query,
    surface: request.surface ?? 'map',
    intent: request.intent ?? 'any',
    scope: request.scope ?? 'global',
    limit: String(request.limit ?? 20),
    include_external: String(request.include_external ?? true),
  });
  if (request.center) {
    query.set('center_lat', String(request.center.lat));
    query.set('center_lng', String(request.center.lng));
  }
  if (request.bounds) {
    query.set('bbox', [request.bounds.west, request.bounds.south, request.bounds.east, request.bounds.north].join(','));
  }
  if (request.route_ref) query.set('route_ref', request.route_ref);
  if (request.radius_meters != null) query.set('radius_meters', String(Math.round(request.radius_meters)));
  if (request.categories?.length) query.set('categories', request.categories.join(','));
  if (request.filters && Object.keys(request.filters).length) query.set('filters', JSON.stringify(request.filters));
  if (request.cursor) query.set('cursor', request.cursor);
  if (request.session_id) query.set('session_id', request.session_id);
  return query.toString();
}

function isSearchPage(value: unknown): value is SearchPageV2 {
  return isRecord(value)
    && typeof value.query === 'string'
    && Array.isArray(value.results)
    && typeof value.has_more === 'boolean'
    && typeof value.revision === 'string'
    && typeof value.elapsed_ms === 'number';
}

function isResolveResponse(value: unknown): value is SearchResolveResponseV2 {
  return isRecord(value)
    && typeof value.query === 'string'
    && ['resolved', 'ambiguous', 'not_found'].includes(String(value.status))
    && Array.isArray(value.alternatives)
    && typeof value.reason === 'string'
    && typeof value.revision === 'string';
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
