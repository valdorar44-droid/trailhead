import { normalizeSearchV2Query } from './cache';
import type {
  SearchPageModeV2,
  SearchPageV2,
  SearchRequestV2,
  SearchResolveResponseV2,
} from './types';

export type SearchV2FeatureGate = () => boolean | Promise<boolean>;
export type SearchV2CallOptions = { signal?: AbortSignal };

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
};

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

export class HttpSearchV2Client implements SearchV2Client {
  private readonly baseUrl: string;
  private readonly isEnabled: SearchV2FeatureGate;
  private readonly fetchImpl: typeof fetch;
  private readonly getHeaders: () => Record<string, string> | Promise<Record<string, string>>;

  constructor(options: HttpSearchV2ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.isEnabled = options.isEnabled;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getHeaders = options.getHeaders ?? (() => ({}));
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
    const payload = await this.requestJson('/api/search/v2/resolve', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!isResolveResponse(payload)) throw new SearchV2HttpError('Search returned an invalid response.', 502, payload);
    return payload;
  }

  private async page(
    mode: SearchPageModeV2,
    request: SearchRequestV2,
    options: SearchV2CallOptions,
  ): Promise<SearchPageV2> {
    const normalized = normalizeRequest(request, mode);
    const query = buildQueryString(normalized);
    const payload = await this.requestJson(`/api/search/v2/${mode}?${query}`, {
      method: 'GET',
      signal: options.signal,
    });
    if (!isSearchPage(payload)) throw new SearchV2HttpError('Search returned an invalid response.', 502, payload);
    return payload;
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    if (!(await this.isEnabled())) throw new SearchV2FeatureDisabledError();
    const extraHeaders = await this.getHeaders();
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
    });
    const payload = await response.json().catch(() => null);
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
  }
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
    categories: Array.from(new Set((request.categories ?? []).map(value => value.trim()).filter(Boolean))).slice(0, 12),
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
