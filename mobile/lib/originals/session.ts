import type {
  OriginalManifestV1,
  OriginalLongFormSessionV1,
  OriginalOwnerScope,
  OriginalSessionV1,
} from './types';

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizePersistedLongFormSession(
  input: OriginalLongFormSessionV1 | null | undefined,
): OriginalLongFormSessionV1 | undefined {
  if (input == null) return undefined;
  if (
    input.schema_version !== 1
    || typeof input.delivery_contract_sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(input.delivery_contract_sha256)
  ) throw new Error('Invalid Trailhead Original long-form session.');
  const completed = unique(Array.isArray(input.completed_item_ids) ? input.completed_item_ids : []);
  const origin = (value: unknown) => (
    value === 'capacity_auto' || value === 'user_explicit' ? value : null
  );
  const currentOrigin = origin(input.current_selection_origin);
  const deferredOrigin = origin(input.deferred_selection_origin);
  const currentItemId = typeof input.current_item_id === 'string' && input.current_item_id.trim()
    && (
      !completed.includes(input.current_item_id)
      || currentOrigin === 'user_explicit'
    )
    ? input.current_item_id
    : null;
  const deferredItemId = typeof input.deferred_item_id === 'string'
    && input.deferred_item_id.trim()
    && input.deferred_item_id !== currentItemId
    && (
      !completed.includes(input.deferred_item_id)
      || deferredOrigin === 'user_explicit'
    )
    ? input.deferred_item_id
    : null;
  const replayingCompletedGroup = Boolean(
    (
      currentItemId
      && completed.includes(currentItemId)
      && currentOrigin === 'user_explicit'
    )
    || (
      deferredItemId
      && completed.includes(deferredItemId)
      && deferredOrigin === 'user_explicit'
    ),
  );
  const pendingGroupItemIds = unique(
    Array.isArray(input.pending_group_item_ids) ? input.pending_group_item_ids : [],
  ).filter(itemId => (
    itemId !== currentItemId
    && itemId !== deferredItemId
    && (replayingCompletedGroup || !completed.includes(itemId))
  ));
  const candidate = input.capacity_candidate;
  const normalizedCandidate = candidate
    && typeof candidate.item_id === 'string'
    && candidate.item_id.trim()
    && Number.isFinite(candidate.entered_at_ms)
    && Number.isFinite(candidate.last_fix_at_ms)
    && Number.isFinite(candidate.reliable_fix_count)
    ? {
      item_id: candidate.item_id,
      entered_at_ms: Number(candidate.entered_at_ms),
      last_fix_at_ms: Number(candidate.last_fix_at_ms),
      reliable_fix_count: Math.max(1, Math.floor(candidate.reliable_fix_count)),
    }
    : null;
  return {
    schema_version: 1,
    delivery_contract_sha256: input.delivery_contract_sha256.toLowerCase(),
    completed_item_ids: completed,
    current_item_id: currentItemId,
    current_audio_position_ms: currentItemId
      ? Math.max(0, Number(input.current_audio_position_ms) || 0)
      : 0,
    current_selection_origin: currentItemId ? currentOrigin : null,
    pending_group_item_ids: pendingGroupItemIds,
    deferred_item_id: deferredItemId,
    deferred_audio_position_ms: deferredItemId
      ? Math.max(0, Number(input.deferred_audio_position_ms) || 0)
      : 0,
    deferred_selection_origin: deferredItemId ? deferredOrigin : null,
    capacity_candidate: normalizedCandidate,
    updated_at_ms: Number.isFinite(input.updated_at_ms)
      ? Number(input.updated_at_ms)
      : Date.now(),
  };
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
    || (chapterSelection.delivery_contract_sha256 != null
      && !/^[a-f0-9]{64}$/i.test(chapterSelection.delivery_contract_sha256))
  )) {
    throw new Error('Invalid Trailhead Original chapter selection.');
  }
  const normalizedChapterSelection = chapterSelection ? {
    ...chapterSelection,
    ...(chapterSelection.delivery_contract_sha256
      ? { delivery_contract_sha256: chapterSelection.delivery_contract_sha256.toLowerCase() }
      : {}),
  } : undefined;
  const normalized: OriginalSessionV1 = {
    ...input,
    ...(normalizedChapterSelection
      ? { chapter_selection: normalizedChapterSelection }
      : {}),
    ...(input.long_form
      ? { long_form: normalizePersistedLongFormSession(input.long_form) }
      : {}),
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
