const LEGACY_WRAPPER_KEYS = new Set(['payload', 'source']);
export const OMITTED_SERVER_LEGACY_SOURCE = 'server_legacy_v1_omitted';

export type TripDetailResolutionErrorCode =
  | 'detail_unavailable'
  | 'revision_changed';

/**
 * A deliberately user-safe error raised while expanding a compact trip row.
 * Callers may preserve this message without exposing transport/provider detail.
 */
export class TripDetailResolutionError extends Error {
  readonly code: TripDetailResolutionErrorCode;

  constructor(code: TripDetailResolutionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TripDetailResolutionError';
    this.code = code;
  }
}

export function requireMatchingTripDetailRevision<T extends { revision: number }>(
  compact: { revision: number },
  full: T,
): T {
  if (full.revision !== compact.revision) {
    throw new TripDetailResolutionError(
      'revision_changed',
      'This trip changed while you were viewing it. Refresh and try again.',
    );
  }
  return full;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Older clients wrapped the server-owned legacy_v1 object in their local
 * repository envelope before sending it back. Peel only those exact envelopes
 * so repeated syncs cannot grow payload.payload chains. Arbitrary legacy data
 * remains untouched.
 */
export function normalizeTripLegacyV1(value: unknown): Record<string, unknown> | undefined {
  let current = objectRecord(value);
  for (let depth = 0; current && depth < 8; depth += 1) {
    const keys = Object.keys(current);
    const payload = objectRecord(current.payload);
    const isEnvelope = Boolean(payload)
      && keys.length > 0
      && keys.every(key => LEGACY_WRAPPER_KEYS.has(key));
    if (!isEnvelope) return current;
    current = payload;
  }
  return current;
}

export function tripLegacyV1ForWrite(
  legacy: { source?: string; payload?: unknown } | undefined,
): Record<string, unknown> | undefined {
  if (legacy?.source === OMITTED_SERVER_LEGACY_SOURCE) return undefined;
  return normalizeTripLegacyV1(legacy?.payload);
}

export function canonicalTripRouteForWrite(
  route: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return route ? { ...route } : {};
}

export function preserveOmittedServerLegacy<T extends { source?: string; payload?: unknown }>(
  current: T | undefined,
  converted: T | undefined,
): T | undefined {
  if (current?.source === OMITTED_SERVER_LEGACY_SOURCE) return current;
  if (current?.source !== 'server_legacy_v1' || !converted) return converted;
  const authoritative = normalizeTripLegacyV1(current.payload);
  const updates = normalizeTripLegacyV1(converted.payload);
  if (!authoritative || !updates) return current;
  const merged: Record<string, unknown> = { ...authoritative };
  const authoritativeTrip = objectRecord(authoritative.trip);
  if (authoritativeTrip) {
    merged.trip = { ...authoritativeTrip, ...updates };
    if (updates.route_geometry !== undefined) merged.route_geometry = updates.route_geometry;
    if (updates.builder_state !== undefined) merged.builder_state = updates.builder_state;
  } else {
    Object.assign(merged, updates);
  }
  return { ...current, payload: merged };
}

export function compactTripListPath(cursor?: string) {
  const query = new URLSearchParams({
    limit: '100',
    include_archived: 'true',
    include_deleted: 'true',
    include_legacy_v1: 'false',
  });
  if (cursor) query.set('cursor', cursor);
  return `/api/trips/v2?${query.toString()}`;
}
