import type { RepositoryOutboxEntryV1 } from './types';

export type TripDeleteRemoteRecord = {
  status: string;
  revision: number;
};

export type TripDeleteRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export type TripDeleteRebaseMode = 'draft-only' | 'explicit';

export type TripDeleteRebaseOptions = {
  maxRebases?: number;
  mode?: TripDeleteRebaseMode;
};

const MAX_IDEMPOTENCY_KEY_LENGTH = 160;
const LIVE_TRIP_STATUSES = new Set(['active', 'draft', 'completed', 'archived']);

function boundedIdempotencyKey(base: string, suffix: string): string {
  const suffixWithinLimit = suffix.slice(-MAX_IDEMPOTENCY_KEY_LENGTH);
  const baseLimit = Math.max(0, MAX_IDEMPOTENCY_KEY_LENGTH - suffixWithinLimit.length);
  return `${base.slice(0, baseLimit)}${suffixWithinLimit}`;
}

export function isOutboxEntrySupersededByDelete(
  entry: RepositoryOutboxEntryV1,
  entries: RepositoryOutboxEntryV1[],
): boolean {
  if (entry.operation === 'delete' || entry.status !== 'syncing') return false;
  const entryRevision = Number(entry.revision ?? 0);
  return entries.some(candidate => candidate.ownerScope === entry.ownerScope
    && candidate.entityType === entry.entityType
    && candidate.entityId === entry.entityId
    && candidate.operation === 'delete'
    && Number(candidate.revision ?? 0) > entryRevision);
}

function httpStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const status = Number((error as { status?: unknown }).status);
    if (Number.isFinite(status)) return status;
  }
  return undefined;
}

export async function deleteRemoteTripWithRevisionRebase(
  entityId: string,
  initialExpectedRevision: number,
  idempotencyKey: string,
  request: TripDeleteRequest,
  options: TripDeleteRebaseOptions = {},
): Promise<void> {
  const encodedId = encodeURIComponent(entityId);
  let expectedRevision = Math.max(0, Math.round(initialExpectedRevision));
  let rebases = 0;
  const maxRebases = options.maxRebases ?? 2;
  const rebaseLimit = Number.isFinite(maxRebases) ? Math.max(0, Math.round(maxRebases)) : 0;
  const mode = options.mode ?? 'draft-only';

  while (true) {
    const retrySuffix = rebases > 0 ? `:rebase:${rebases}:${expectedRevision}` : '';
    try {
      await request(`/api/trips/v2/${encodedId}?expected_revision=${expectedRevision}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': boundedIdempotencyKey(idempotencyKey, retrySuffix) },
      });
      return;
    } catch (error) {
      const status = httpStatus(error);
      if (status === 404) return;
      if (status !== 409 || rebases >= rebaseLimit) throw error;

      let remote: TripDeleteRemoteRecord;
      try {
        remote = await request<TripDeleteRemoteRecord>(
          `/api/trips/v2/${encodedId}?include_deleted=true`,
        );
      } catch (refreshError) {
        if (httpStatus(refreshError) === 404) return;
        throw refreshError;
      }
      if (remote.status === 'deleted') return;
      const statusCanBeDeleted = mode === 'explicit'
        ? LIVE_TRIP_STATUSES.has(remote.status)
        : remote.status === 'draft';
      if (!statusCanBeDeleted || !Number.isFinite(Number(remote.revision))) throw error;
      expectedRevision = Math.max(0, Math.round(Number(remote.revision)));
      rebases += 1;
    }
  }
}
