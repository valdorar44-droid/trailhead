import type {
  OfflineArtifactStateV2,
  OfflineArtifactStatus,
  OfflineBundleArtifactV2,
} from './types';

const ALLOWED_TRANSITIONS: Readonly<Record<OfflineArtifactStatus, readonly OfflineArtifactStatus[]>> = {
  queued: ['downloading', 'paused', 'error'],
  downloading: ['paused', 'verifying', 'partial', 'error'],
  paused: ['downloading', 'partial', 'error'],
  verifying: ['ready', 'partial', 'needs_update', 'repair_required', 'error'],
  ready: ['needs_update', 'repair_required', 'partial'],
  partial: ['queued', 'downloading', 'verifying', 'needs_update', 'repair_required', 'error'],
  needs_update: ['queued', 'downloading', 'repair_required', 'error'],
  repair_required: ['queued', 'downloading', 'error'],
  error: ['queued', 'downloading'],
};

function freezeState(state: OfflineArtifactStateV2) {
  return Object.freeze(state);
}

export function createQueuedArtifactState(
  artifact: Pick<OfflineBundleArtifactV2, 'id' | 'bytes'>,
  now = Date.now(),
): OfflineArtifactStateV2 {
  return freezeState({
    artifact_id: artifact.id,
    status: 'queued',
    received_bytes: 0,
    total_bytes: artifact.bytes,
    updated_at_ms: now,
  });
}

export type OfflineArtifactStateUpdate = Readonly<{
  received_bytes?: number;
  total_bytes?: number;
  local_uri?: string;
  error_code?: string;
  error_message?: string;
  updated_at_ms?: number;
}>;

/**
 * State is updated through a pure transition instead of mutating objects held
 * by React stores or persistence layers. Invalid jumps indicate adapter bugs.
 */
export function transitionOfflineArtifactState(
  current: OfflineArtifactStateV2,
  status: OfflineArtifactStatus,
  update: OfflineArtifactStateUpdate = {},
): OfflineArtifactStateV2 {
  if (status !== current.status && !ALLOWED_TRANSITIONS[current.status].includes(status)) {
    throw new Error(`Invalid offline artifact transition: ${current.status} -> ${status}.`);
  }

  const totalBytes = Math.max(0, Math.trunc(update.total_bytes ?? current.total_bytes));
  let receivedBytes = Math.max(0, Math.trunc(update.received_bytes ?? current.received_bytes));
  if (totalBytes > 0) receivedBytes = Math.min(receivedBytes, totalBytes);
  if (status === 'ready') receivedBytes = totalBytes;

  const next: OfflineArtifactStateV2 = {
    artifact_id: current.artifact_id,
    status,
    received_bytes: receivedBytes,
    total_bytes: totalBytes,
    updated_at_ms: update.updated_at_ms ?? Date.now(),
    ...(update.local_uri ?? current.local_uri
      ? { local_uri: update.local_uri ?? current.local_uri }
      : {}),
    ...(status === 'error' || status === 'repair_required'
      ? {
          ...(update.error_code ? { error_code: update.error_code } : {}),
          ...(update.error_message ? { error_message: update.error_message } : {}),
        }
      : {}),
  };
  return freezeState(next);
}

export function createQueuedArtifactStates(
  artifacts: readonly Pick<OfflineBundleArtifactV2, 'id' | 'bytes'>[],
  now = Date.now(),
): Readonly<Record<string, OfflineArtifactStateV2>> {
  return Object.freeze(Object.fromEntries(
    artifacts.map(artifact => [artifact.id, createQueuedArtifactState(artifact, now)]),
  ));
}

