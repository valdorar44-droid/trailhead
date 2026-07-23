export type FireOverlayViewport = {
  n: number;
  s: number;
  e: number;
  w: number;
};

export const MAX_FIRE_OVERLAY_FEATURES = 120;
export const MAX_FIRE_OVERLAY_VERTICES = 60_000;
export const MAX_FIRE_FEATURE_VERTICES = 12_000;
export const MAX_FIRE_OVERLAY_DROPPED_SUMMARY = 1_000_000;

export type FireOverlayPartialReason =
  | 'provider_limit'
  | 'invalid_geometry'
  | 'feature_vertex_limit'
  | 'total_vertex_limit'
  | 'feature_limit'
  | 'serialized_size_limit'
  | 'cell_fetch_failure'
  | 'stale_cell'
  | 'client_geometry_filter';

const FIRE_OVERLAY_PARTIAL_REASONS = new Set<FireOverlayPartialReason>([
  'provider_limit',
  'invalid_geometry',
  'feature_vertex_limit',
  'total_vertex_limit',
  'feature_limit',
  'serialized_size_limit',
  'cell_fetch_failure',
  'stale_cell',
  'client_geometry_filter',
]);

export type FireOverlayFeatureCollection = GeoJSON.FeatureCollection & {
  metadata?: {
    availability?: 'available' | 'degraded';
    // `partial` is accepted here for backward compatibility with cached
    // responses written before freshness and completeness were split.
    freshness?: 'fresh' | 'stale' | 'partial';
    age_seconds?: number;
    partial?: boolean;
    truncated?: boolean;
    partial_reasons?: FireOverlayPartialReason[];
    dropped_feature_count?: number;
  };
};

export type FireOverlayStatusKind =
  | 'idle'
  | 'loading'
  | 'fresh'
  | 'fresh_empty'
  | 'partial'
  | 'stale'
  | 'stale_partial'
  | 'unavailable';

export type FireOverlayStatus = {
  kind: FireOverlayStatusKind;
  featureCount: number;
  ageSeconds?: number;
  omittedFeatureCount?: number;
  partialReasons?: FireOverlayPartialReason[];
};

export const FIRE_OVERLAY_IDLE_STATUS: FireOverlayStatus = {
  kind: 'idle',
  featureCount: 0,
};

export const FIRE_OVERLAY_LOADING_STATUS: FireOverlayStatus = {
  kind: 'loading',
  featureCount: 0,
};

export const FIRE_OVERLAY_UNAVAILABLE_STATUS: FireOverlayStatus = {
  kind: 'unavailable',
  featureCount: 0,
};

export const FIRE_OVERLAY_CURRENT_COLOR = '#ef4444';
export const FIRE_OVERLAY_CAUTION_COLOR = '#b45309';

export type FireOverlayGeometryStyle = {
  fillColor: string;
  fillOpacity: number;
  lineColor: string;
  lineOpacity: number;
  lineWidth: number;
};

export type FireOverlayLoadResult = {
  payload: FireOverlayFeatureCollection;
  status: FireOverlayStatus;
  style: FireOverlayGeometryStyle;
};

export type FireOverlayFetch = (
  url: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export function isValidFireOverlayViewport(
  value: FireOverlayViewport | null | undefined,
): value is FireOverlayViewport {
  if (!value) return false;
  const { n, s, e, w } = value;
  return [n, s, e, w].every(Number.isFinite)
    && n > s
    && e !== w
    && n <= 90
    && s >= -90
    && e <= 180
    && w >= -180;
}

export function buildFireOverlayRequest(
  apiBase: string,
  viewport: FireOverlayViewport,
): { url: string; init: RequestInit } {
  if (!isValidFireOverlayViewport(viewport)) {
    throw new Error('A valid fire-overlay viewport is required');
  }
  return {
    url: `${apiBase}/api/conditions/fire-perimeters/query`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(viewport),
    },
  };
}

export async function loadFireOverlayViewport(
  apiBase: string,
  viewport: FireOverlayViewport,
  options: {
    fetchImpl?: FireOverlayFetch;
    signal?: AbortSignal;
  } = {},
): Promise<FireOverlayLoadResult> {
  const request = buildFireOverlayRequest(apiBase, viewport);
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const response = await fetchImpl(request.url, {
    ...request.init,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Fire overlay request failed (${response.status})`);
  }
  const payload = normalizeFireOverlayPayload(await response.json());
  if (!payload) {
    throw new Error('Fire overlay response was invalid');
  }
  const status = fireOverlayStatusFromPayload(payload);
  return {
    payload,
    status,
    style: fireOverlayGeometryStyle(status),
  };
}

export function normalizeFireOverlayPayload(
  payload: unknown,
): FireOverlayFeatureCollection | null {
  if (!payload || typeof payload !== 'object') return null;
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) return null;
  const safe: GeoJSON.Feature[] = [];
  let totalVertices = 0;
  for (const feature of features) {
    if (safe.length >= MAX_FIRE_OVERLAY_FEATURES || totalVertices >= MAX_FIRE_OVERLAY_VERTICES) break;
    if (!feature || typeof feature !== 'object') continue;
    const geometry = (feature as GeoJSON.Feature).geometry;
    const vertices = boundedFireGeometryVertexCount(geometry, MAX_FIRE_FEATURE_VERTICES);
    if (vertices <= 0 || totalVertices + vertices > MAX_FIRE_OVERLAY_VERTICES) continue;
    safe.push(feature as GeoJSON.Feature);
    totalVertices += vertices;
  }
  const rawMetadata = (payload as { metadata?: unknown }).metadata;
  const metadata = rawMetadata && typeof rawMetadata === 'object'
    ? rawMetadata as Record<string, unknown>
    : null;
  const availability = metadata?.availability === 'degraded' ? 'degraded'
    : metadata?.availability === 'available' ? 'available'
      : undefined;
  const freshness = ['fresh', 'stale', 'partial'].includes(String(metadata?.freshness))
    ? metadata?.freshness as 'fresh' | 'stale' | 'partial'
    : undefined;
  const age = Number(metadata?.age_seconds);
  const rawReasons = [
    ...(Array.isArray(metadata?.partial_reasons) ? metadata.partial_reasons : []),
    ...(Array.isArray(metadata?.truncation_reasons) ? metadata.truncation_reasons : []),
  ];
  const partialReasons = Array.from(new Set(rawReasons
    .filter((reason): reason is FireOverlayPartialReason => (
      typeof reason === 'string' && FIRE_OVERLAY_PARTIAL_REASONS.has(reason as FireOverlayPartialReason)
    )))).slice(0, FIRE_OVERLAY_PARTIAL_REASONS.size);
  const backendDroppedCount = boundedFireOverlaySummaryCount(metadata?.dropped_feature_count)
    ?? boundedFireOverlayDroppedDetailCount(metadata?.dropped);
  const clientDroppedCount = Math.max(0, features.length - safe.length);
  if (clientDroppedCount > 0 && !partialReasons.includes('client_geometry_filter')) {
    partialReasons.push('client_geometry_filter');
  }
  const droppedFeatureCount = Math.min(
    MAX_FIRE_OVERLAY_DROPPED_SUMMARY,
    (backendDroppedCount ?? 0) + clientDroppedCount,
  );
  const hasTruncationReason = partialReasons.some(reason => (
    reason !== 'cell_fetch_failure' && reason !== 'stale_cell'
  ));
  const truncated = metadata?.truncated === true
    || clientDroppedCount > 0
    || (backendDroppedCount ?? 0) > 0
    || hasTruncationReason;
  const partial = metadata?.partial === true
    || freshness === 'partial'
    || truncated
    || partialReasons.length > 0
    || droppedFeatureCount > 0;
  return {
    type: 'FeatureCollection',
    features: safe,
    ...(availability || freshness || Number.isFinite(age) || partial
      ? { metadata: {
          ...(availability ? { availability } : {}),
          ...(freshness ? { freshness } : {}),
          ...(Number.isFinite(age) && age >= 0 ? { age_seconds: Math.floor(age) } : {}),
          ...(partial ? {
            partial: true,
            ...(truncated ? { truncated: true } : {}),
            ...(partialReasons.length > 0 ? { partial_reasons: partialReasons } : {}),
            ...(droppedFeatureCount > 0 ? { dropped_feature_count: droppedFeatureCount } : {}),
          } : {}),
        } }
      : {}),
  };
}

export function fireOverlayStatusFromPayload(
  payload: FireOverlayFeatureCollection,
): FireOverlayStatus {
  const featureCount = payload.features.length;
  const age = Number(payload.metadata?.age_seconds);
  const ageSeconds = Number.isFinite(age) && age >= 0 ? Math.floor(age) : undefined;
  const freshness = payload.metadata?.freshness;
  const partial = freshness === 'partial'
    || payload.metadata?.partial === true
    || payload.metadata?.truncated === true
    || (payload.metadata?.partial_reasons?.length ?? 0) > 0
    || (payload.metadata?.dropped_feature_count ?? 0) > 0;
  const stale = freshness === 'stale';
  const kind: FireOverlayStatusKind = stale && partial
    ? 'stale_partial'
    : stale
      ? 'stale'
    : partial
      ? 'partial'
      : freshness === 'fresh' && featureCount > 0
        ? 'fresh'
        : freshness === 'fresh'
          ? 'fresh_empty'
          : 'partial';
  return {
    kind,
    featureCount,
    ...(ageSeconds == null ? {} : { ageSeconds }),
    ...(partial && (payload.metadata?.dropped_feature_count ?? 0) > 0
      ? { omittedFeatureCount: payload.metadata?.dropped_feature_count }
      : {}),
    ...(partial && (payload.metadata?.partial_reasons?.length ?? 0) > 0
      ? { partialReasons: payload.metadata?.partial_reasons }
      : {}),
  };
}

export function fireOverlayStatusColor(status: FireOverlayStatus): string {
  return ['unavailable', 'stale', 'stale_partial', 'partial'].includes(status.kind)
    ? FIRE_OVERLAY_CAUTION_COLOR
    : FIRE_OVERLAY_CURRENT_COLOR;
}

export function fireOverlayGeometryStyle(
  status: FireOverlayStatus,
): FireOverlayGeometryStyle {
  const color = fireOverlayStatusColor(status);
  return {
    fillColor: color,
    fillOpacity: status.kind === 'fresh' || status.kind === 'fresh_empty' ? 0.3 : 0.24,
    lineColor: color,
    lineOpacity: 0.9,
    lineWidth: 1.5,
  };
}

export function fireOverlayStatusLabel(status: FireOverlayStatus): string {
  const age = fireOverlayAgeLabel(status.ageSeconds);
  const checked = age === 'time unavailable' ? 'update time unavailable' : `checked ${age}`;
  switch (status.kind) {
    case 'loading':
      return 'Checking interagency fire data';
    case 'fresh':
      return `Interagency data · ${status.featureCount} mapped · ${age === 'time unavailable' ? 'update time unavailable' : age}`;
    case 'fresh_empty':
      return `No mapped perimeters here · ${checked}`;
    case 'partial':
      return `Partial interagency data${fireOverlayOmissionLabel(status)} · ${checked}`;
    case 'stale':
      return `Stale interagency data${age === 'time unavailable' ? '' : ` · ${age}`}`;
    case 'stale_partial':
      return `Stale, partial interagency data${fireOverlayOmissionLabel(status)}${
        age === 'time unavailable' ? ' · update time unavailable' : ` · ${age}`
      }`;
    case 'unavailable':
      return 'Interagency fire data unavailable';
    case 'idle':
    default:
      return 'Interagency fire perimeters';
  }
}

function fireOverlayOmissionLabel(status: FireOverlayStatus): string {
  const count = status.omittedFeatureCount;
  const countLabel = count && count > 0
    ? `${count} perimeter${count === 1 ? '' : 's'} omitted`
    : 'coverage incomplete';
  const reasonLabels = Array.from(new Set((status.partialReasons ?? [])
    .map(fireOverlayPartialReasonLabel)
    .filter((label): label is string => !!label))).slice(0, 2);
  return ` · ${countLabel}${reasonLabels.length > 0 ? ` · ${reasonLabels.join(', ')}` : ''}`;
}

function fireOverlayPartialReasonLabel(reason: FireOverlayPartialReason): string | null {
  switch (reason) {
    case 'provider_limit':
      return 'source limit';
    case 'invalid_geometry':
    case 'client_geometry_filter':
      return 'unsupported perimeter geometry';
    case 'feature_vertex_limit':
    case 'total_vertex_limit':
    case 'feature_limit':
    case 'serialized_size_limit':
      return 'display limit';
    case 'cell_fetch_failure':
      return 'some areas unavailable';
    case 'stale_cell':
      return 'some areas older';
    default:
      return null;
  }
}

function boundedFireOverlaySummaryCount(value: unknown): number | undefined {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return undefined;
  return Math.min(MAX_FIRE_OVERLAY_DROPPED_SUMMARY, Math.floor(count));
}

function boundedFireOverlayDroppedDetailCount(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  let total = 0;
  let found = false;
  for (const reason of FIRE_OVERLAY_PARTIAL_REASONS) {
    if (
      reason === 'provider_limit'
      || reason === 'cell_fetch_failure'
      || reason === 'stale_cell'
      || reason === 'client_geometry_filter'
    ) continue;
    const count = boundedFireOverlaySummaryCount((value as Record<string, unknown>)[reason]);
    if (count == null) continue;
    found = true;
    total = Math.min(MAX_FIRE_OVERLAY_DROPPED_SUMMARY, total + count);
  }
  return found ? total : undefined;
}

function fireOverlayAgeLabel(ageSeconds: number | undefined): string {
  if (ageSeconds == null || !Number.isFinite(ageSeconds) || ageSeconds < 0) return 'time unavailable';
  if (ageSeconds < 60) return 'just now';
  if (ageSeconds < 60 * 60) {
    const minutes = Math.floor(ageSeconds / 60);
    return `${minutes} min ago`;
  }
  if (ageSeconds < 24 * 60 * 60) {
    const hours = Math.floor(ageSeconds / (60 * 60));
    return `${hours} hr ago`;
  }
  const days = Math.floor(ageSeconds / (24 * 60 * 60));
  return days > 30 ? 'over 30 days ago' : `${days} day${days === 1 ? '' : 's'} ago`;
}

function boundedFireGeometryVertexCount(geometry: unknown, limit: number): number {
  if (!geometry || typeof geometry !== 'object') return 0;
  const candidate = geometry as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'Polygon' && candidate.type !== 'MultiPolygon') return 0;
  if (!Array.isArray(candidate.coordinates)) return 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: candidate.coordinates, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.depth > 6 || !Array.isArray(current.value)) return 0;
    if (
      current.value.length >= 2
      && typeof current.value[0] === 'number'
      && typeof current.value[1] === 'number'
    ) {
      if (!Number.isFinite(current.value[0]) || !Number.isFinite(current.value[1])) return 0;
      count += 1;
      if (count > limit) return 0;
      continue;
    }
    for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
  }
  return count;
}
