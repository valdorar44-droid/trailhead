import { distanceBetweenLngLatMeters } from '../routeProjection';
import {
  createOriginalSession,
  originalPendingStopIds,
  originalStopIsTerminal,
} from './session';
import type {
  OriginalLocationSample,
  OriginalLongFormCapacityCandidateV1,
  OriginalLongFormSessionV1,
  OriginalManifestV1,
  OriginalSelectablePlaybackItemV1,
  OriginalSelectablePlaybackPlanV1,
  OriginalSessionV1,
  OriginalTriggerEvaluation,
} from './types';

export const ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS = {
  maximum_accuracy_m: 100,
  maximum_route_distance_m: 500,
  minimum_capacity_speed_mps: 2,
  minimum_reliable_fixes: 2,
  minimum_reliable_dwell_ms: 3_000,
  maximum_reliable_fix_gap_ms: 10_000,
  maximum_landmark_fix_age_ms: 15_000,
} as const;

export type OriginalLongFormCapacityDecisionCode =
  | 'admitted'
  | 'already_complete'
  | 'audio_busy'
  | 'before_window'
  | 'insufficient_capacity'
  | 'invalid_contract'
  | 'no_candidate'
  | 'outside_radius'
  | 'poor_accuracy'
  | 'stale_fix'
  | 'waiting_for_dwell'
  | 'waiting_for_fixes';

export type OriginalLongFormCapacityEvaluationV1 = {
  session: OriginalSessionV1;
  action: { type: 'play_optional'; item_id: string; position_ms: 0 } | null;
  decision: {
    code: OriginalLongFormCapacityDecisionCode;
    item_id: string | null;
    available_audio_s: number | null;
    required_audio_s: number | null;
  };
};

export type OriginalLongFormExplicitEligibilityV1 = {
  /** Explicit UI confirmation only. Never derive this from speed or motion. */
  user_confirmed_parked?: boolean;
  /** True only while the selected before-route experience is the active context. */
  before_route_context_active?: boolean;
  /** Transient distance check against the item-authored landmark radius. */
  within_landmark_radius?: boolean;
  /** True only after every hard-auto cue is terminal and the route completed. */
  route_completed?: boolean;
};

export type OriginalLongFormExplicitSelectionResultV1 =
  | { ok: true; session: OriginalSessionV1; item: OriginalSelectablePlaybackItemV1 }
  | {
    ok: false;
    session: OriginalSessionV1;
    code:
      | 'already_complete'
      | 'audio_busy'
      | 'not_available_here'
      | 'parked_confirmation_required'
      | 'route_completion_required'
      | 'unknown_item';
  };

/** Validate a transient landmark fix without persisting it or inferring parking. */
export function originalLongFormLandmarkFixIsEligible(
  item: OriginalSelectablePlaybackItemV1,
  sample: OriginalLocationSample | null | undefined,
  now = Date.now(),
) {
  if (
    item.delivery.mode !== 'stopped_deeper'
    || item.delivery.availability !== 'at_landmark_user_confirmed_parked'
    || !item.coordinates
    || !sample
  ) return false;
  const accuracy = Number(sample.accuracy_m);
  const timestamp = Number(sample.timestamp_ms);
  if (
    !Number.isFinite(accuracy)
    || accuracy < 0
    || accuracy > ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS.maximum_accuracy_m
    || !Number.isFinite(timestamp)
    || timestamp <= 0
    || timestamp > now
    || now - timestamp > ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS.maximum_landmark_fix_age_ms
  ) return false;
  return distanceBetweenLngLatMeters(
    [sample.lng, sample.lat],
    [item.coordinates.lng, item.coordinates.lat],
  ) <= (item.delivery.availability_radius_m ?? 0);
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

/** Ordered members represented by one selectable library row. */
export function originalSelectablePlaybackGroupItems(
  plan: OriginalSelectablePlaybackPlanV1,
  itemId: string,
) {
  const item = plan.items.find(value => value.id === itemId);
  if (!item) return [];
  const groupId = item.delivery.mode === 'stopped_deeper'
    ? item.delivery.experience_group_id
    : undefined;
  if (!groupId) return [item];
  return plan.items
    .filter(candidate => (
      candidate.delivery.mode === 'stopped_deeper'
      && candidate.delivery.experience_group_id === groupId
    ))
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
}

/**
 * The pre-route parked prelude remains reachable after GPS initializes. It
 * closes only when guaranteed route narration actually begins, not merely
 * because a foreground location fix arrived.
 */
export function originalLongFormBeforeRouteContextIsActive(session: OriginalSessionV1) {
  return session.status !== 'completed'
    && session.status !== 'stopped'
    && !session.current_stop_id
    && originalPendingStopIds(session).length === 0
    && session.triggered_stop_ids.length === 0
    && session.completed_stop_ids.length === 0
    && session.skipped_stop_ids.length === 0
    && session.missed_stop_ids.length === 0;
}

/**
 * Capacity narration may inspect only a fix accepted by the hard trigger
 * engine. This prevents null projection values from becoming numeric zeroes
 * and prevents delayed fixes from building a second admission dwell.
 */
export function originalLongFormCapacityLocationIsAccepted(
  sessionBeforeEvaluation: OriginalSessionV1,
  sample: OriginalLocationSample,
  evaluation: Pick<
    OriginalTriggerEvaluation,
    'session' | 'decision' | 'projected_route_progress_m' | 'distance_from_route_m'
  >,
) {
  const previousTimestamp = sessionBeforeEvaluation.last_location_timestamp_ms;
  const progress = evaluation.projected_route_progress_m;
  const routeDistance = evaluation.distance_from_route_m;
  return Number.isFinite(sample.timestamp_ms)
    && (previousTimestamp == null || sample.timestamp_ms > previousTimestamp)
    && evaluation.session.last_location_timestamp_ms === sample.timestamp_ms
    && evaluation.session.status === 'active'
    && evaluation.session.tracking_state === 'on_route'
    && evaluation.decision.code !== 'stale_fix'
    && progress != null
    && Number.isFinite(progress)
    && routeDistance != null
    && Number.isFinite(routeDistance);
}

function normalizedPosition(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

export function createOriginalLongFormSession(
  plan: OriginalSelectablePlaybackPlanV1,
  now = Date.now(),
): OriginalLongFormSessionV1 {
  return {
    schema_version: 1,
    delivery_contract_sha256: plan.delivery_contract_sha256,
    completed_item_ids: [],
    current_item_id: null,
    current_audio_position_ms: 0,
    current_selection_origin: null,
    pending_group_item_ids: [],
    deferred_item_id: null,
    deferred_audio_position_ms: 0,
    deferred_selection_origin: null,
    capacity_candidate: null,
    updated_at_ms: now,
  };
}

export function normalizeOriginalLongFormSession(
  input: OriginalLongFormSessionV1 | null | undefined,
  plan: OriginalSelectablePlaybackPlanV1,
  now = Date.now(),
): OriginalLongFormSessionV1 {
  if (!input) return createOriginalLongFormSession(plan, now);
  if (
    input.schema_version !== 1
    || input.delivery_contract_sha256 !== plan.delivery_contract_sha256
  ) {
    throw new Error('The saved long-form session does not match this Original route.');
  }
  const itemIds = new Set(plan.items.map(item => item.id));
  const completed = unique(input.completed_item_ids ?? []).filter(id => itemIds.has(id));
  const current = input.current_item_id && itemIds.has(input.current_item_id)
    && (
      !completed.includes(input.current_item_id)
      || input.current_selection_origin === 'user_explicit'
    )
    ? input.current_item_id
    : null;
  const deferred = input.deferred_item_id && itemIds.has(input.deferred_item_id)
    && (
      !completed.includes(input.deferred_item_id)
      || input.deferred_selection_origin === 'user_explicit'
    )
    && input.deferred_item_id !== current
    ? input.deferred_item_id
    : null;
  const replayingCompletedGroup = Boolean(
    (
      current
      && completed.includes(current)
      && input.current_selection_origin === 'user_explicit'
    )
    || (
      deferred
      && completed.includes(deferred)
      && input.deferred_selection_origin === 'user_explicit'
    ),
  );
  const pendingGroup = unique(input.pending_group_item_ids ?? []).filter(id => (
    itemIds.has(id)
    && (replayingCompletedGroup || !completed.includes(id))
    && id !== current
    && id !== deferred
  ));
  const candidate = input.capacity_candidate;
  const normalizedCandidate = candidate
    && itemIds.has(candidate.item_id)
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
    delivery_contract_sha256: plan.delivery_contract_sha256,
    completed_item_ids: completed,
    current_item_id: current,
    current_audio_position_ms: current ? normalizedPosition(input.current_audio_position_ms) : 0,
    current_selection_origin: current
      && (input.current_selection_origin === 'capacity_auto'
        || input.current_selection_origin === 'user_explicit')
      ? input.current_selection_origin
      : null,
    pending_group_item_ids: pendingGroup,
    deferred_item_id: deferred,
    deferred_audio_position_ms: deferred ? normalizedPosition(input.deferred_audio_position_ms) : 0,
    deferred_selection_origin: deferred
      && (input.deferred_selection_origin === 'capacity_auto'
        || input.deferred_selection_origin === 'user_explicit')
      ? input.deferred_selection_origin
      : null,
    capacity_candidate: normalizedCandidate,
    updated_at_ms: Number.isFinite(input.updated_at_ms) ? Number(input.updated_at_ms) : now,
  };
}

export function withOriginalLongFormSession(
  session: OriginalSessionV1,
  longForm: OriginalLongFormSessionV1,
): OriginalSessionV1 {
  return { ...session, long_form: longForm };
}

export function ensureOriginalLongFormSession(
  session: OriginalSessionV1,
  plan: OriginalSelectablePlaybackPlanV1,
  now = Date.now(),
) {
  return normalizeOriginalLongFormSession(session.long_form, plan, now);
}

function clearCapacityCandidate(
  session: OriginalSessionV1,
  plan: OriginalSelectablePlaybackPlanV1,
  now: number,
) {
  const longForm = ensureOriginalLongFormSession(session, plan, now);
  if (!longForm.capacity_candidate) return session;
  return withOriginalLongFormSession(session, {
    ...longForm,
    capacity_candidate: null,
    updated_at_ms: now,
  });
}

function capacityDecision(
  session: OriginalSessionV1,
  code: OriginalLongFormCapacityDecisionCode,
  itemId: string | null,
  availableAudioS: number | null = null,
  requiredAudioS: number | null = null,
): OriginalLongFormCapacityEvaluationV1 {
  return {
    session,
    action: null,
    decision: {
      code,
      item_id: itemId,
      available_audio_s: availableAudioS,
      required_audio_s: requiredAudioS,
    },
  };
}

function nextCapacityItem(
  plan: OriginalSelectablePlaybackPlanV1,
  session: OriginalSessionV1,
  projectedProgressM?: number,
) {
  const longForm = ensureOriginalLongFormSession(session, plan);
  return plan.items
    .filter(item => item.delivery.mode === 'capacity_deeper')
    .sort((left, right) => left.sequence - right.sequence)
    .find(item => (
      !longForm.completed_item_ids.includes(item.id)
      && (
        projectedProgressM == null
        || !item.trigger
        || projectedProgressM <= item.trigger.route_progress_end_m
      )
    )) ?? null;
}

/**
 * Admit one capacity story only while there is enough measured route time for
 * its immutable audio duration plus the authored 30-second hard-cue guard.
 * Capacity is never queued: any hard/optional audio activity denies admission.
 */
export function evaluateOriginalLongFormCapacity(
  plan: OriginalSelectablePlaybackPlanV1,
  hardManifest: OriginalManifestV1,
  currentSession: OriginalSessionV1,
  sample: OriginalLocationSample,
  route: { projected_progress_m: number | null; distance_from_route_m: number | null },
): OriginalLongFormCapacityEvaluationV1 {
  const now = sample.timestamp_ms;
  let session = currentSession;
  let longForm: OriginalLongFormSessionV1;
  try {
    longForm = ensureOriginalLongFormSession(session, plan, now);
  } catch {
    return capacityDecision(session, 'invalid_contract', null);
  }
  session = withOriginalLongFormSession(session, longForm);
  const firstCapacityItem = nextCapacityItem(plan, session);
  if (
    session.current_stop_id
    || originalPendingStopIds(session).length > 0
    || longForm.current_item_id
    || longForm.deferred_item_id
    || longForm.pending_group_item_ids.length > 0
  ) {
    return capacityDecision(
      clearCapacityCandidate(session, plan, now),
      'audio_busy',
      firstCapacityItem?.id ?? null,
    );
  }
  const accuracy = Number(sample.accuracy_m);
  const routeDistance = Number(route.distance_from_route_m);
  const progress = Number(route.projected_progress_m);
  if (
    !Number.isFinite(accuracy)
    || accuracy < 0
    || accuracy > ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS.maximum_accuracy_m
    || !Number.isFinite(routeDistance)
    || routeDistance < 0
    || routeDistance > ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS.maximum_route_distance_m
    || !Number.isFinite(progress)
  ) {
    return capacityDecision(
      clearCapacityCandidate(session, plan, now),
      'poor_accuracy',
      firstCapacityItem?.id ?? null,
    );
  }
  const item = nextCapacityItem(plan, session, progress);
  if (!item || item.delivery.mode !== 'capacity_deeper') {
    return capacityDecision(clearCapacityCandidate(session, plan, now), 'no_candidate', null);
  }
  const delivery = item.delivery;
  if (!item.coordinates || !item.trigger) {
    return capacityDecision(clearCapacityCandidate(session, plan, now), 'invalid_contract', item.id);
  }
  const trigger = item.trigger;
  if (progress < trigger.route_progress_start_m || progress > trigger.route_progress_end_m) {
    return capacityDecision(clearCapacityCandidate(session, plan, now), 'before_window', item.id);
  }
  const distanceToItem = distanceBetweenLngLatMeters(
    [sample.lng, sample.lat],
    [item.coordinates.lng, item.coordinates.lat],
  );
  if (distanceToItem > trigger.enter_radius_m) {
    return capacityDecision(clearCapacityCandidate(session, plan, now), 'outside_radius', item.id);
  }
  const nextHard = hardManifest.stops.find(stop => (
    stop.id === delivery.next_hard_auto_story_id
  ));
  if (!nextHard || originalStopIsTerminal(session, nextHard.id)) {
    return capacityDecision(clearCapacityCandidate(session, plan, now), 'invalid_contract', item.id);
  }
  const speed = Number(sample.speed_mps);
  const requiredAudioS = item.audio_duration_s
    + delivery.guard_before_next_hard_auto_window_s;
  const availableAudioS = Number.isFinite(speed)
    && speed >= ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS.minimum_capacity_speed_mps
    ? Math.max(0, nextHard.trigger.route_progress_start_m - progress) / speed
    : 0;
  if (availableAudioS < requiredAudioS) {
    return capacityDecision(
      clearCapacityCandidate(session, plan, now),
      'insufficient_capacity',
      item.id,
      availableAudioS,
      requiredAudioS,
    );
  }
  const previous = longForm.capacity_candidate;
  if (previous && now <= previous.last_fix_at_ms) {
    return capacityDecision(session, 'stale_fix', item.id, availableAudioS, requiredAudioS);
  }
  const continues = previous?.item_id === item.id
    && now - previous.last_fix_at_ms <= ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS.maximum_reliable_fix_gap_ms;
  const candidate: OriginalLongFormCapacityCandidateV1 = continues
    ? {
      ...previous,
      last_fix_at_ms: now,
      reliable_fix_count: previous.reliable_fix_count + 1,
    }
    : {
      item_id: item.id,
      entered_at_ms: now,
      last_fix_at_ms: now,
      reliable_fix_count: 1,
    };
  const withCandidate = withOriginalLongFormSession(session, {
    ...longForm,
    capacity_candidate: candidate,
    updated_at_ms: now,
  });
  if (candidate.reliable_fix_count < ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS.minimum_reliable_fixes) {
    return capacityDecision(withCandidate, 'waiting_for_fixes', item.id, availableAudioS, requiredAudioS);
  }
  if (now - candidate.entered_at_ms < ORIGINAL_LONG_FORM_SCHEDULER_DEFAULTS.minimum_reliable_dwell_ms) {
    return capacityDecision(withCandidate, 'waiting_for_dwell', item.id, availableAudioS, requiredAudioS);
  }
  const admitted = withOriginalLongFormSession(session, {
    ...longForm,
    current_item_id: item.id,
    current_audio_position_ms: 0,
    current_selection_origin: 'capacity_auto',
    capacity_candidate: null,
    updated_at_ms: now,
  });
  return {
    session: admitted,
    action: { type: 'play_optional', item_id: item.id, position_ms: 0 },
    decision: {
      code: 'admitted',
      item_id: item.id,
      available_audio_s: availableAudioS,
      required_audio_s: requiredAudioS,
    },
  };
}

export function selectOriginalLongFormItem(
  plan: OriginalSelectablePlaybackPlanV1,
  currentSession: OriginalSessionV1,
  itemId: string,
  eligibility: OriginalLongFormExplicitEligibilityV1,
  now = Date.now(),
): OriginalLongFormExplicitSelectionResultV1 {
  const item = plan.items.find(value => value.id === itemId);
  const longForm = ensureOriginalLongFormSession(currentSession, plan, now);
  const session = withOriginalLongFormSession(currentSession, longForm);
  if (!item) return { ok: false, session, code: 'unknown_item' };
  const groupedItems = originalSelectablePlaybackGroupItems(plan, item.id);
  const playableGroup = groupedItems.filter(candidate => (
    !longForm.completed_item_ids.includes(candidate.id)
  ));
  if (playableGroup.length === 0) {
    return { ok: false, session, code: 'already_complete' };
  }
  if (
    currentSession.current_stop_id
    || originalPendingStopIds(currentSession).length > 0
    || longForm.current_item_id
    || longForm.deferred_item_id
    || longForm.pending_group_item_ids.length > 0
  ) {
    return { ok: false, session, code: 'audio_busy' };
  }
  if (item.delivery.mode === 'stopped_deeper') {
    if (!eligibility.user_confirmed_parked) {
      return { ok: false, session, code: 'parked_confirmation_required' };
    }
    const inContext = item.delivery.availability === 'before_route_user_confirmed_parked'
      ? eligibility.before_route_context_active === true
      : eligibility.within_landmark_radius === true;
    if (!inContext) return { ok: false, session, code: 'not_available_here' };
  } else if (!eligibility.route_completed) {
    // Capacity selections fall back to the completion library when they were
    // not admitted automatically during the drive.
    return { ok: false, session, code: 'route_completion_required' };
  }
  const firstItem = playableGroup[0] ?? item;
  const next = withOriginalLongFormSession(session, {
    ...longForm,
    current_item_id: firstItem.id,
    current_audio_position_ms: 0,
    current_selection_origin: 'user_explicit',
    pending_group_item_ids: playableGroup.slice(1).map(candidate => candidate.id),
    capacity_candidate: null,
    updated_at_ms: now,
  });
  return { ok: true, session: next, item: firstItem };
}

export type OriginalLongFormReplayResultV1 =
  | { ok: true; session: OriginalSessionV1; item: OriginalSelectablePlaybackItemV1 }
  | {
    ok: false;
    session: OriginalSessionV1;
    code:
      | 'audio_busy'
      | 'not_available_here'
      | 'not_complete'
      | 'parked_confirmation_required'
      | 'route_completion_required'
      | 'unknown_item';
  };

/** Replay a completed deeper story without altering hard-route outcomes. */
export function replayOriginalLongFormItem(
  plan: OriginalSelectablePlaybackPlanV1,
  currentSession: OriginalSessionV1,
  itemId: string,
  eligibility: OriginalLongFormExplicitEligibilityV1,
  now = Date.now(),
): OriginalLongFormReplayResultV1 {
  const item = plan.items.find(value => value.id === itemId);
  const longForm = ensureOriginalLongFormSession(currentSession, plan, now);
  const session = withOriginalLongFormSession(currentSession, longForm);
  if (!item) return { ok: false, session, code: 'unknown_item' };
  const groupedItems = originalSelectablePlaybackGroupItems(plan, item.id);
  if (!groupedItems.length || groupedItems.some(candidate => (
    !longForm.completed_item_ids.includes(candidate.id)
  ))) {
    return { ok: false, session, code: 'not_complete' };
  }
  if (
    currentSession.current_stop_id
    || originalPendingStopIds(currentSession).length > 0
    || longForm.current_item_id
    || longForm.deferred_item_id
    || longForm.pending_group_item_ids.length > 0
  ) return { ok: false, session, code: 'audio_busy' };
  if (item.delivery.mode === 'stopped_deeper') {
    if (!eligibility.user_confirmed_parked) {
      return { ok: false, session, code: 'parked_confirmation_required' };
    }
    const inContext = item.delivery.availability === 'before_route_user_confirmed_parked'
      ? eligibility.before_route_context_active === true
      : eligibility.within_landmark_radius === true;
    if (!inContext) return { ok: false, session, code: 'not_available_here' };
  } else if (!eligibility.route_completed) {
    return { ok: false, session, code: 'route_completion_required' };
  }
  return {
    ok: true,
    item: groupedItems[0],
    session: withOriginalLongFormSession(session, {
      ...longForm,
      current_item_id: groupedItems[0].id,
      current_audio_position_ms: 0,
      current_selection_origin: 'user_explicit',
      pending_group_item_ids: groupedItems.slice(1).map(candidate => candidate.id),
      capacity_candidate: null,
      updated_at_ms: now,
    }),
  };
}

/** Save optional playback before guaranteed hard-auto narration takes audio. */
export function preemptOriginalLongFormForHardCue(
  currentSession: OriginalSessionV1,
  plan: OriginalSelectablePlaybackPlanV1,
  positionMs: number,
  now = Date.now(),
) {
  const longForm = ensureOriginalLongFormSession(currentSession, plan, now);
  if (!longForm.current_item_id) return withOriginalLongFormSession(currentSession, longForm);
  return withOriginalLongFormSession(currentSession, {
    ...longForm,
    current_item_id: null,
    current_audio_position_ms: 0,
    current_selection_origin: null,
    deferred_item_id: longForm.current_item_id,
    deferred_audio_position_ms: normalizedPosition(positionMs),
    deferred_selection_origin: longForm.current_selection_origin,
    capacity_candidate: null,
    updated_at_ms: now,
  });
}

export function completeOriginalLongFormItem(
  currentSession: OriginalSessionV1,
  plan: OriginalSelectablePlaybackPlanV1,
  itemId: string,
  now = Date.now(),
) {
  const longForm = ensureOriginalLongFormSession(currentSession, plan, now);
  const completingCurrent = longForm.current_item_id === itemId;
  const replayingCompletedGroup = completingCurrent
    && longForm.completed_item_ids.includes(itemId)
    && longForm.current_selection_origin === 'user_explicit';
  const completed = unique([...longForm.completed_item_ids, itemId]);
  const pendingGroup = longForm.pending_group_item_ids
    .filter(id => id !== itemId && (replayingCompletedGroup || !completed.includes(id)));
  const promotedGroupItem = completingCurrent ? pendingGroup[0] ?? null : null;
  return withOriginalLongFormSession(currentSession, {
    ...longForm,
    completed_item_ids: completed,
    current_item_id: completingCurrent ? promotedGroupItem : longForm.current_item_id,
    current_audio_position_ms: completingCurrent
      ? 0
      : longForm.current_audio_position_ms,
    current_selection_origin: completingCurrent
      ? promotedGroupItem ? 'user_explicit' : null
      : longForm.current_selection_origin,
    pending_group_item_ids: completingCurrent
      ? pendingGroup.slice(promotedGroupItem ? 1 : 0)
      : pendingGroup,
    deferred_item_id: longForm.deferred_item_id === itemId ? null : longForm.deferred_item_id,
    deferred_audio_position_ms: longForm.deferred_item_id === itemId
      ? 0
      : longForm.deferred_audio_position_ms,
    deferred_selection_origin: longForm.deferred_item_id === itemId
      ? null
      : longForm.deferred_selection_origin,
    updated_at_ms: now,
  });
}

export function updateOriginalLongFormAudioPosition(
  currentSession: OriginalSessionV1,
  plan: OriginalSelectablePlaybackPlanV1,
  positionMs: number,
  now = Date.now(),
) {
  const longForm = ensureOriginalLongFormSession(currentSession, plan, now);
  if (!longForm.current_item_id) return withOriginalLongFormSession(currentSession, longForm);
  return withOriginalLongFormSession(currentSession, {
    ...longForm,
    current_audio_position_ms: normalizedPosition(positionMs),
    updated_at_ms: now,
  });
}

export function resumeDeferredOriginalLongFormAfterHardCue(
  currentSession: OriginalSessionV1,
  plan: OriginalSelectablePlaybackPlanV1,
  now = Date.now(),
): {
  session: OriginalSessionV1;
  action: { type: 'play_optional'; item_id: string; position_ms: number } | null;
} {
  const longForm = ensureOriginalLongFormSession(currentSession, plan, now);
  if (
    !longForm.deferred_item_id
    || currentSession.current_stop_id
    || originalPendingStopIds(currentSession).length > 0
  ) return { session: withOriginalLongFormSession(currentSession, longForm), action: null };
  const item = plan.items.find(value => value.id === longForm.deferred_item_id);
  // Auto-capacity narration is not resumed into another unknown capacity gap;
  // its declared completion fallback remains available after the route.
  if (!item) {
    return { session: withOriginalLongFormSession(currentSession, longForm), action: null };
  }
  if (longForm.deferred_selection_origin !== 'user_explicit') {
    // An interrupted capacity story is not queued after the guaranteed hard
    // cue. Release it immediately; it remains incomplete and can be admitted
    // in a later measured gap or selected from its completion fallback.
    const released = withOriginalLongFormSession(currentSession, {
      ...longForm,
      deferred_item_id: null,
      deferred_audio_position_ms: 0,
      deferred_selection_origin: null,
      updated_at_ms: now,
    });
    return { session: released, action: null };
  }
  const next = withOriginalLongFormSession(currentSession, {
    ...longForm,
    current_item_id: longForm.deferred_item_id,
    current_audio_position_ms: longForm.deferred_audio_position_ms,
    current_selection_origin: longForm.deferred_selection_origin,
    deferred_item_id: null,
    deferred_audio_position_ms: 0,
    deferred_selection_origin: null,
    updated_at_ms: now,
  });
  return {
    session: next,
    action: {
      type: 'play_optional',
      item_id: item.id,
      position_ms: next.long_form?.current_audio_position_ms ?? 0,
    },
  };
}

/** Cold tasks may resume a persisted explicit choice, never create one. */
export function originalLongFormHeadlessResumeAction(
  session: OriginalSessionV1,
  plan: OriginalSelectablePlaybackPlanV1,
) {
  const longForm = ensureOriginalLongFormSession(session, plan);
  if (
    (session.status !== 'active' && session.status !== 'ready' && session.status !== 'completed')
    || session.user_paused
    || !longForm.current_item_id
    || longForm.current_selection_origin !== 'user_explicit'
    || session.current_stop_id
  ) return null;
  return {
    type: 'resume_explicit_optional' as const,
    item_id: longForm.current_item_id,
    position_ms: longForm.current_audio_position_ms,
  };
}

const ORIGINAL_LONG_FORM_VALIDATION_SPEEDS_MPH = [15, 36, 65, 75] as const;

export type OriginalLongFormSelectionValidationReportV1 = {
  schema_version: 1;
  delivery_contract_sha256: string;
  speed_fixtures: Array<{
    speed_mph: number;
    capacity_items: Array<{
      item_id: string;
      expected_admitted: boolean;
      observed_admitted: boolean;
      decision: OriginalLongFormCapacityDecisionCode;
      available_audio_s: number;
      required_audio_s: number;
    }>;
  }>;
  invariants: {
    hard_preemption_preserves_position: boolean;
    restart_restores_explicit_selection: boolean;
    parked_requires_explicit_confirmation: boolean;
    completion_requires_hard_route_completion: boolean;
    optional_ids_absent_from_hard_progress: boolean;
  };
  valid: boolean;
};

/**
 * Deterministic consumer-side characterization for one already-compiled V3
 * selection. This is evidence only: it cannot mark a server publication ready
 * and does not replace the trusted hard-trigger validator.
 */
export function validateOriginalLongFormSelection(
  hardManifest: OriginalManifestV1,
  plan: OriginalSelectablePlaybackPlanV1,
): OriginalLongFormSelectionValidationReportV1 {
  const freshSession = () => withOriginalLongFormSession({
    ...createOriginalSession(hardManifest, 'guest', 1),
    status: 'active' as const,
    started_at_ms: 1,
  }, createOriginalLongFormSession(plan, 1));
  const capacityItems = plan.items
    .filter((item): item is OriginalSelectablePlaybackItemV1 & {
      delivery: Extract<OriginalSelectablePlaybackItemV1['delivery'], { mode: 'capacity_deeper' }>;
    } => item.delivery.mode === 'capacity_deeper')
    .sort((left, right) => left.sequence - right.sequence);
  const speedFixtures = ORIGINAL_LONG_FORM_VALIDATION_SPEEDS_MPH.map(speedMph => {
    const speedMps = speedMph * 0.44704;
    return {
      speed_mph: speedMph,
      capacity_items: capacityItems.map((item, itemIndex) => {
        const nextHard = hardManifest.stops.find(stop => (
          stop.id === item.delivery.next_hard_auto_story_id
        ));
        const projectedProgressM = item.trigger?.route_progress_start_m ?? 0;
        const availableAudioS = nextHard
          ? Math.max(0, nextHard.trigger.route_progress_start_m - projectedProgressM) / speedMps
          : 0;
        const requiredAudioS = item.audio_duration_s
          + item.delivery.guard_before_next_hard_auto_window_s;
        let session = freshSession();
        const longForm = ensureOriginalLongFormSession(session, plan, 1);
        session = withOriginalLongFormSession(session, {
          ...longForm,
          // Target each capacity entry independently without treating an
          // earlier optional as hard-route progress.
          completed_item_ids: capacityItems.slice(0, itemIndex).map(value => value.id),
        });
        const baseSample: OriginalLocationSample = {
          lat: item.coordinates?.lat ?? 0,
          lng: item.coordinates?.lng ?? 0,
          accuracy_m: 10,
          heading_deg: null,
          speed_mps: speedMps,
          timestamp_ms: 1_000,
        };
        const first = evaluateOriginalLongFormCapacity(
          plan,
          hardManifest,
          session,
          baseSample,
          { projected_progress_m: projectedProgressM, distance_from_route_m: 0 },
        );
        const second = evaluateOriginalLongFormCapacity(
          plan,
          hardManifest,
          first.session,
          { ...baseSample, timestamp_ms: 4_100 },
          { projected_progress_m: projectedProgressM, distance_from_route_m: 0 },
        );
        const expectedAdmitted = Boolean(
          nextHard
          && item.coordinates
          && item.trigger
          && availableAudioS >= requiredAudioS,
        );
        return {
          item_id: item.id,
          expected_admitted: expectedAdmitted,
          observed_admitted: second.decision.code === 'admitted',
          decision: second.decision.code,
          available_audio_s: availableAudioS,
          required_audio_s: requiredAudioS,
        };
      }),
    };
  });

  const stopped = plan.items.find(item => item.delivery.mode === 'stopped_deeper');
  const completion = plan.items.find(item => item.delivery.mode === 'completion_deeper');
  let hardPreemptionPreservesPosition = true;
  let restartRestoresExplicitSelection = true;
  let parkedRequiresExplicitConfirmation = true;
  let completionRequiresHardRouteCompletion = true;
  let optionalIdsAbsentFromHardProgress = true;
  if (stopped && stopped.delivery.mode === 'stopped_deeper') {
    const eligibility = stopped.delivery.availability === 'before_route_user_confirmed_parked'
      ? { user_confirmed_parked: true, before_route_context_active: true }
      : { user_confirmed_parked: true, within_landmark_radius: true };
    const denied = selectOriginalLongFormItem(plan, freshSession(), stopped.id, {
      ...eligibility,
      user_confirmed_parked: false,
    }, 10);
    const wrongContext = selectOriginalLongFormItem(plan, freshSession(), stopped.id, {
      user_confirmed_parked: true,
      before_route_context_active: false,
      within_landmark_radius: false,
    }, 10);
    const selected = selectOriginalLongFormItem(plan, freshSession(), stopped.id, eligibility, 11);
    parkedRequiresExplicitConfirmation = !denied.ok
      && denied.code === 'parked_confirmation_required'
      && !wrongContext.ok
      && wrongContext.code === 'not_available_here'
      && selected.ok;
    if (!selected.ok) {
      hardPreemptionPreservesPosition = false;
      restartRestoresExplicitSelection = false;
      optionalIdsAbsentFromHardProgress = false;
    } else {
      const hardBefore = JSON.stringify({
        current: selected.session.current_stop_id,
        completed: selected.session.completed_stop_ids,
        pending: originalPendingStopIds(selected.session),
      });
      const positioned = updateOriginalLongFormAudioPosition(selected.session, plan, 42_500, 12);
      const preempted = preemptOriginalLongFormForHardCue(positioned, plan, 42_500, 13);
      hardPreemptionPreservesPosition = preempted.long_form?.deferred_item_id === stopped.id
        && preempted.long_form?.deferred_audio_position_ms === 42_500;
      const restored = normalizeOriginalLongFormSession(
        JSON.parse(JSON.stringify(positioned.long_form)),
        plan,
        14,
      );
      const restoredSession = withOriginalLongFormSession(freshSession(), restored);
      const headlessResume = originalLongFormHeadlessResumeAction(restoredSession, plan);
      restartRestoresExplicitSelection = restored.current_item_id === stopped.id
        && restored.current_selection_origin === 'user_explicit'
        && restored.current_audio_position_ms === 42_500
        && headlessResume?.item_id === stopped.id
        && headlessResume.position_ms === 42_500;
      const optionalIds = new Set(plan.items.map(item => item.id));
      optionalIdsAbsentFromHardProgress = hardBefore === JSON.stringify({
        current: preempted.current_stop_id,
        completed: preempted.completed_stop_ids,
        pending: originalPendingStopIds(preempted),
      }) && !optionalIds.has(preempted.current_stop_id ?? '')
        && preempted.completed_stop_ids.every(id => !optionalIds.has(id))
        && originalPendingStopIds(preempted).every(id => !optionalIds.has(id));
    }
  }
  if (completion && completion.delivery.mode === 'completion_deeper') {
    const before = selectOriginalLongFormItem(
      plan,
      freshSession(),
      completion.id,
      { route_completed: false },
      20,
    );
    const completeHardSession = {
      ...freshSession(),
      status: 'completed' as const,
      completed_stop_ids: hardManifest.stops.map(stop => stop.id),
      completed_at_ms: 21,
    };
    const after = selectOriginalLongFormItem(
      plan,
      completeHardSession,
      completion.id,
      { route_completed: true },
      22,
    );
    completionRequiresHardRouteCompletion = !before.ok
      && before.code === 'route_completion_required'
      && after.ok;
  }
  const capacityFixturesValid = speedFixtures.every(fixture => (
    fixture.capacity_items.every(item => item.expected_admitted === item.observed_admitted)
  ));
  const invariants = {
    hard_preemption_preserves_position: hardPreemptionPreservesPosition,
    restart_restores_explicit_selection: restartRestoresExplicitSelection,
    parked_requires_explicit_confirmation: parkedRequiresExplicitConfirmation,
    completion_requires_hard_route_completion: completionRequiresHardRouteCompletion,
    optional_ids_absent_from_hard_progress: optionalIdsAbsentFromHardProgress,
  };
  return {
    schema_version: 1,
    delivery_contract_sha256: plan.delivery_contract_sha256,
    speed_fixtures: speedFixtures,
    invariants,
    valid: capacityFixturesValid && Object.values(invariants).every(Boolean),
  };
}
