import type {
  OriginalManifestV1,
  OriginalOwnerScope,
  OriginalSessionV1,
} from './types';

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function originalPendingStopIsClosed(session: OriginalSessionV1, stopId: string) {
  return session.completed_stop_ids.includes(stopId)
    || session.skipped_stop_ids.includes(stopId)
    || session.missed_stop_ids.includes(stopId);
}

/**
 * Read the canonical narration FIFO. Persisted sessions from the one-slot
 * runtime are migrated from `queued_stop_id` the first time they are loaded.
 */
export function originalPendingStopIds(session: OriginalSessionV1) {
  // Mixed 1.0.11 writers can update only the legacy one-slot field. Always
  // reconcile that field ahead of the canonical tail; filtering below removes
  // a legacy head that is already current or terminal.
  const persisted = [
    ...(session.queued_stop_id ? [session.queued_stop_id] : []),
    ...(Array.isArray(session.pending_stop_ids) ? session.pending_stop_ids : []),
  ];
  return unique(persisted).filter(stopId => (
    stopId !== session.current_stop_id
    && !originalPendingStopIsClosed(session, stopId)
  ));
}

/** Keep the canonical FIFO and the legacy one-slot head in one atomic value. */
export function withOriginalPendingStops(
  session: OriginalSessionV1,
  pendingStopIds: readonly string[],
): OriginalSessionV1 {
  const pending = unique([...pendingStopIds]).filter(stopId => (
    stopId !== session.current_stop_id
    && !originalPendingStopIsClosed(session, stopId)
  ));
  return {
    ...session,
    pending_stop_ids: pending,
    queued_stop_id: pending[0] ?? null,
  };
}

export function enqueueOriginalPendingStop(
  session: OriginalSessionV1,
  stopId: string,
): OriginalSessionV1 {
  if (
    !stopId
    || stopId === session.current_stop_id
    || originalPendingStopIsClosed(session, stopId)
  ) return withOriginalPendingStops(session, originalPendingStopIds(session));
  return withOriginalPendingStops(session, [...originalPendingStopIds(session), stopId]);
}

export type OriginalQueuePromotionV1 = Readonly<{
  session: OriginalSessionV1;
  promoted_stop_id: string | null;
}>;

/** Promote exactly one FIFO head after the playing story settles. */
export function promoteNextOriginalStop(
  session: OriginalSessionV1,
  now = Date.now(),
): OriginalQueuePromotionV1 {
  const [promotedStopId, ...remaining] = originalPendingStopIds(session);
  if (!promotedStopId) {
    return {
      session: withOriginalPendingStops(session, []),
      promoted_stop_id: null,
    };
  }
  return {
    session: withOriginalPendingStops({
      ...session,
      status: 'active',
      current_stop_id: promotedStopId,
      current_audio_position_ms: 0,
      completed_at_ms: null,
      updated_at_ms: now,
    }, remaining),
    promoted_stop_id: promotedStopId,
  };
}

export function createOriginalSession(
  manifest: OriginalManifestV1,
  ownerScope: OriginalOwnerScope = 'guest',
  now = Date.now(),
  chapterSelection?: NonNullable<OriginalSessionV1['chapter_selection']>,
): OriginalSessionV1 {
  const selectionKey = chapterSelection
    ? `:${chapterSelection.chapter_id}:${chapterSelection.variant_id}`
    : '';
  return {
    schema_version: 1,
    session_id: `${manifest.pack_id}:${manifest.version}${selectionKey}:${now}`,
    pack_id: manifest.pack_id,
    version: manifest.version,
    manifest_id: manifest.manifest_id,
    ...(chapterSelection ? { chapter_selection: { ...chapterSelection } } : {}),
    owner_scope: ownerScope,
    status: 'ready',
    tracking_state: 'initializing',
    download_state: 'ready',
    permission_state: 'unknown',
    triggered_stop_ids: [],
    completed_stop_ids: [],
    skipped_stop_ids: [],
    missed_stop_ids: [],
    pending_stop_ids: [],
    queued_stop_id: null,
    current_stop_id: null,
    current_audio_position_ms: 0,
    last_projected_route_progress_m: null,
    last_route_distance_m: null,
    last_location_timestamp_ms: null,
    user_paused: false,
    manual_replay_return_status: null,
    manual_replay_stop_id: null,
    trigger_state: {
      route_initialized: false,
      candidate_stop_id: null,
      candidate_entered_at_ms: null,
      candidate_sample_count: 0,
      candidate_last_sample_at_ms: null,
      reverse_candidate_entered_at_ms: null,
      reverse_candidate_sample_count: 0,
      reverse_candidate_last_sample_at_ms: null,
    },
    started_at_ms: null,
    updated_at_ms: now,
    completed_at_ms: null,
  };
}

export function normalizeOriginalSession(input: OriginalSessionV1): OriginalSessionV1 {
  if (!input || input.schema_version !== 1 || !input.pack_id || !Number.isFinite(input.version)) {
    throw new Error('Invalid Trailhead Original session.');
  }
  const chapterSelection = input.chapter_selection;
  if (chapterSelection && (
    chapterSelection.schema_version !== 1
    || typeof chapterSelection.validation_selection_id !== 'string'
    || !chapterSelection.validation_selection_id.trim()
    || typeof chapterSelection.chapter_id !== 'string'
    || !chapterSelection.chapter_id.trim()
    || typeof chapterSelection.variant_id !== 'string'
    || !chapterSelection.variant_id.trim()
  )) {
    throw new Error('Invalid Trailhead Original chapter selection.');
  }
  const normalized: OriginalSessionV1 = {
    ...input,
    ...(chapterSelection ? { chapter_selection: { ...chapterSelection } } : {}),
    triggered_stop_ids: unique(input.triggered_stop_ids ?? []),
    completed_stop_ids: unique(input.completed_stop_ids ?? []),
    skipped_stop_ids: unique(input.skipped_stop_ids ?? []),
    missed_stop_ids: unique(input.missed_stop_ids ?? []),
    current_audio_position_ms: Math.max(0, Number(input.current_audio_position_ms) || 0),
    last_location_timestamp_ms: Number.isFinite(input.last_location_timestamp_ms)
      ? Number(input.last_location_timestamp_ms)
      : null,
    manual_replay_return_status: input.manual_replay_return_status ?? null,
    manual_replay_stop_id: input.manual_replay_stop_id ?? null,
    trigger_state: {
      route_initialized: Boolean(input.trigger_state?.route_initialized),
      candidate_stop_id: input.trigger_state?.candidate_stop_id ?? null,
      candidate_entered_at_ms: input.trigger_state?.candidate_entered_at_ms ?? null,
      candidate_sample_count: Math.max(0, Number(input.trigger_state?.candidate_sample_count) || 0),
      candidate_last_sample_at_ms: input.trigger_state?.candidate_last_sample_at_ms ?? null,
      reverse_candidate_entered_at_ms:
        input.trigger_state?.reverse_candidate_entered_at_ms ?? null,
      reverse_candidate_sample_count: Math.max(
        0,
        Number(input.trigger_state?.reverse_candidate_sample_count) || 0,
      ),
      reverse_candidate_last_sample_at_ms:
        input.trigger_state?.reverse_candidate_last_sample_at_ms ?? null,
    },
  };
  return withOriginalPendingStops(normalized, originalPendingStopIds(normalized));
}

export function originalStopIsTerminal(session: OriginalSessionV1, stopId: string) {
  return session.triggered_stop_ids.includes(stopId)
    || session.completed_stop_ids.includes(stopId)
    || session.skipped_stop_ids.includes(stopId)
    || session.missed_stop_ids.includes(stopId);
}

export function originalStopCanReplay(session: OriginalSessionV1, stopId: string) {
  return session.completed_stop_ids.includes(stopId)
    || session.skipped_stop_ids.includes(stopId)
    || session.missed_stop_ids.includes(stopId);
}

export function normalizeCompletedOriginalSession(
  session: OriginalSessionV1,
  allStopIds: string[],
): OriginalSessionV1 {
  const terminal = allStopIds.every(stopId => (
    session.completed_stop_ids.includes(stopId)
    || session.skipped_stop_ids.includes(stopId)
    || session.missed_stop_ids.includes(stopId)
  ));
  if (
    session.completed_at_ms == null
    || !terminal
    || session.current_stop_id
    || originalPendingStopIds(session).length > 0
    || session.status === 'completed'
  ) return session;
  return {
    ...session,
    status: 'completed',
    user_paused: false,
    manual_replay_return_status: null,
    manual_replay_stop_id: null,
  };
}

export function completeOriginalStop(
  session: OriginalSessionV1,
  stopId: string,
  allStopIds: string[],
  now = Date.now(),
): OriginalSessionV1 {
  const completed = unique([...session.completed_stop_ids, stopId]);
  const done = allStopIds.every(id => (
    completed.includes(id)
    || session.skipped_stop_ids.includes(id)
    || session.missed_stop_ids.includes(id)
  ));
  return {
    ...session,
    status: done ? 'completed' : session.status,
    completed_stop_ids: completed,
    current_stop_id: session.current_stop_id === stopId ? null : session.current_stop_id,
    current_audio_position_ms: session.current_stop_id === stopId ? 0 : session.current_audio_position_ms,
    completed_at_ms: done ? now : session.completed_at_ms,
    updated_at_ms: now,
  };
}

export function skipOriginalStop(
  session: OriginalSessionV1,
  stopId: string,
  allStopIds: string[],
  now = Date.now(),
): OriginalSessionV1 {
  const skipped = unique([...session.skipped_stop_ids, stopId]);
  const done = allStopIds.every(id => (
    session.completed_stop_ids.includes(id)
    || skipped.includes(id)
    || session.missed_stop_ids.includes(id)
  ));
  return withOriginalPendingStops({
    ...session,
    status: done ? 'completed' : session.status,
    skipped_stop_ids: skipped,
    current_stop_id: session.current_stop_id === stopId ? null : session.current_stop_id,
    current_audio_position_ms: session.current_stop_id === stopId ? 0 : session.current_audio_position_ms,
    completed_at_ms: done ? now : session.completed_at_ms,
    updated_at_ms: now,
  }, originalPendingStopIds(session).filter(id => id !== stopId));
}

export function startManualOriginalStop(
  session: OriginalSessionV1,
  stopId: string,
  now = Date.now(),
): OriginalSessionV1 {
  return {
    ...session,
    status: 'active',
    current_stop_id: stopId,
    current_audio_position_ms: 0,
    user_paused: false,
    manual_replay_return_status: session.completed_at_ms == null ? session.status : 'completed',
    manual_replay_stop_id: stopId,
    updated_at_ms: now,
  };
}

export function finishManualOriginalStop(
  session: OriginalSessionV1,
  stopId: string,
  now = Date.now(),
): OriginalSessionV1 | null {
  if (session.manual_replay_stop_id !== stopId) return null;
  const returnStatus = session.manual_replay_return_status ?? 'paused';
  return {
    ...session,
    status: returnStatus,
    current_stop_id: null,
    current_audio_position_ms: 0,
    user_paused: returnStatus === 'paused',
    manual_replay_return_status: null,
    manual_replay_stop_id: null,
    updated_at_ms: now,
  };
}
