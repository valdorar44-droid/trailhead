import type { RepositoryOutboxEntryV1 } from './types';

export type OutboxFailureResolution = {
  resolved: boolean;
  conflict: boolean;
  message: string;
};

export type OutboxProcessingResult = {
  completed: number;
  canceled: boolean;
  blockedByConflict: boolean;
  error?: string;
};

type OutboxProcessingDependencies = {
  isSessionCurrent: () => boolean;
  markSyncing: (entry: RepositoryOutboxEntryV1) => Promise<void>;
  clearSyncing: (entries: RepositoryOutboxEntryV1[]) => Promise<void>;
  syncEntry: (entry: RepositoryOutboxEntryV1) => Promise<void>;
  acknowledge: (entries: RepositoryOutboxEntryV1[]) => Promise<void>;
  fail: (entry: RepositoryOutboxEntryV1, message: string) => Promise<void>;
  resolveFailure: (entry: RepositoryOutboxEntryV1, error: unknown) => Promise<OutboxFailureResolution>;
};

function entityKey(entry: RepositoryOutboxEntryV1): string {
  return `${entry.ownerScope}:${entry.entityType}:${entry.entityId}`;
}

export function tripRepositoryRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(8, Math.round(attempts) - 1));
  return Math.min(5 * 60_000, 2_000 * (2 ** exponent));
}

export function retryEligibleTripRepositoryEntryIds(
  entries: RepositoryOutboxEntryV1[],
  now: number,
): string[] {
  return entries
    .filter(entry => entry.status === 'failed'
      && entry.updatedAt + tripRepositoryRetryDelayMs(entry.attempts) <= now)
    .map(entry => entry.id);
}

export function nextTripRepositoryRetryAt(entries: RepositoryOutboxEntryV1[]): number | undefined {
  const times = entries
    .filter(entry => entry.status === 'failed')
    .map(entry => entry.updatedAt + tripRepositoryRetryDelayMs(entry.attempts));
  return times.length > 0 ? Math.min(...times) : undefined;
}

export function hasRunnableTripRepositoryOutboxEntries(entries: RepositoryOutboxEntryV1[]): boolean {
  const blockedEntities = new Set<string>();
  for (const entry of entries) {
    const key = entityKey(entry);
    if (blockedEntities.has(key)) continue;
    if (entry.status === 'failed') {
      blockedEntities.add(key);
      continue;
    }
    return true;
  }
  return false;
}

export async function processTripRepositoryOutbox(
  entries: RepositoryOutboxEntryV1[],
  dependencies: OutboxProcessingDependencies,
): Promise<OutboxProcessingResult> {
  const blockedEntities = new Set<string>();
  const markedEntries: RepositoryOutboxEntryV1[] = [];
  const acknowledgedEntries: RepositoryOutboxEntryV1[] = [];
  let completed = 0;
  let pendingCompleted = 0;
  let blockedByConflict = false;
  let firstError: string | undefined;

  const canceledResult = async (): Promise<OutboxProcessingResult> => {
    await dependencies.clearSyncing(markedEntries);
    return { completed, canceled: true, blockedByConflict, error: firstError };
  };

  for (const entry of entries) {
    if (!dependencies.isSessionCurrent()) {
      return canceledResult();
    }

    const key = entityKey(entry);
    if (blockedEntities.has(key)) continue;
    if (entry.status === 'failed') {
      blockedEntities.add(key);
      firstError ??= entry.lastError || 'Sync will retry automatically.';
      continue;
    }

    await dependencies.markSyncing(entry);
    markedEntries.push(entry);
    if (!dependencies.isSessionCurrent()) {
      return canceledResult();
    }

    try {
      await dependencies.syncEntry(entry);
      if (!dependencies.isSessionCurrent()) {
        return canceledResult();
      }
      acknowledgedEntries.push(entry);
      pendingCompleted += 1;
    } catch (error) {
      if (!dependencies.isSessionCurrent()) {
        return canceledResult();
      }
      let resolution: OutboxFailureResolution;
      try {
        resolution = await dependencies.resolveFailure(entry, error);
      } catch {
        resolution = {
          resolved: false,
          conflict: false,
          message: error instanceof Error ? error.message : 'Sync failed.',
        };
      }
      if (!dependencies.isSessionCurrent()) {
        return canceledResult();
      }

      blockedEntities.add(key);
      blockedByConflict ||= resolution.conflict;
      firstError ??= resolution.message;
      if (resolution.resolved) {
        acknowledgedEntries.push(entry);
      } else {
        await dependencies.fail(entry, resolution.message);
      }
    }
  }

  if (!dependencies.isSessionCurrent()) return canceledResult();
  if (acknowledgedEntries.length > 0) {
    try {
      await dependencies.acknowledge(acknowledgedEntries);
      completed = pendingCompleted;
    } catch (error) {
      await dependencies.clearSyncing(markedEntries);
      return {
        completed,
        canceled: false,
        blockedByConflict,
        error: firstError ?? (error instanceof Error ? error.message : 'Synced changes are waiting to be saved.'),
      };
    }
  }

  return { completed, canceled: false, blockedByConflict, error: firstError };
}
