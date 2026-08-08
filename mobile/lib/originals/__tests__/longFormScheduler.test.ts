import assert from 'node:assert/strict';
import { compileOriginalManifestV3 } from '../manifestV3';
import {
  completeOriginalLongFormItem,
  createOriginalLongFormSession,
  ensureOriginalLongFormSession,
  evaluateOriginalLongFormCapacity,
  normalizeOriginalLongFormSession,
  originalLongFormBeforeRouteContextIsActive,
  originalLongFormCapacityLocationIsAccepted,
  originalLongFormLandmarkFixIsEligible,
  originalLongFormHeadlessResumeAction,
  originalSelectablePlaybackGroupItems,
  preemptOriginalLongFormForHardCue,
  replayOriginalLongFormItem,
  resumeDeferredOriginalLongFormAfterHardCue,
  selectOriginalLongFormItem,
  updateOriginalLongFormAudioPosition,
  validateOriginalLongFormSelection,
  withOriginalLongFormSession,
} from '../longFormScheduler';
import { createOriginalSession, normalizeOriginalSession } from '../session';
import type { OriginalLocationSample, OriginalSessionV1 } from '../types';
import { originalManifestV3 } from './fixtures';

const source = originalManifestV3();
const compiled = compileOriginalManifestV3(source, {
  chapter_id: 'mountain-crossing',
  variant_id: 'eastbound',
});
const hard = compiled.manifest;
const plan = compiled.selectable;

function activeSession(): OriginalSessionV1 {
  return {
    ...createOriginalSession(hard, 'guest', 1, { schema_version: 1, ...compiled.selection }),
    status: 'active',
    started_at_ms: 1,
    long_form: createOriginalLongFormSession(plan, 1),
  };
}

function sample(timestampMs: number, overrides: Partial<OriginalLocationSample> = {}): OriginalLocationSample {
  return {
    lat: 0,
    lng: 0.0108,
    accuracy_m: 10,
    heading_deg: 90,
    speed_mps: 5,
    timestamp_ms: timestampMs,
    ...overrides,
  };
}

const capacity = plan.items.find(item => item.delivery.mode === 'capacity_deeper');
const beforeRoute = plan.items.find(item => (
  item.delivery.mode === 'stopped_deeper'
  && item.delivery.availability === 'before_route_user_confirmed_parked'
));
const landmark = plan.items.find(item => (
  item.delivery.mode === 'stopped_deeper'
  && item.delivery.availability === 'at_landmark_user_confirmed_parked'
));
const completion = plan.items.find(item => item.delivery.mode === 'completion_deeper');
assert(capacity && beforeRoute && landmark && completion);

{
  const initialized = {
    ...activeSession(),
    last_projected_route_progress_m: 0,
    last_location_timestamp_ms: 1_000,
    trigger_state: {
      ...activeSession().trigger_state,
      route_initialized: true,
    },
  };
  assert.equal(
    originalLongFormBeforeRouteContextIsActive(initialized),
    true,
    'the first accepted GPS fix does not close the explicitly parked pre-route story',
  );
  assert.equal(
    originalLongFormBeforeRouteContextIsActive({
      ...initialized,
      triggered_stop_ids: [hard.stops[0].id],
    }),
    false,
    'guaranteed route narration closes the pre-route context',
  );
}

{
  const initial = activeSession();
  const acceptedSample = sample(1_000);
  const acceptedEvaluation = {
    session: {
      ...initial,
      tracking_state: 'on_route' as const,
      last_location_timestamp_ms: acceptedSample.timestamp_ms,
    },
    decision: { code: 'armed' as const },
    projected_route_progress_m: 1_000,
    distance_from_route_m: 5,
  };
  assert.equal(
    originalLongFormCapacityLocationIsAccepted(initial, acceptedSample, acceptedEvaluation as any),
    true,
  );
  let scheduled = evaluateOriginalLongFormCapacity(
    plan,
    hard,
    acceptedEvaluation.session,
    acceptedSample,
    { projected_progress_m: 1_000, distance_from_route_m: 5 },
  );
  for (const delayedTimestamp of [900, 800]) {
    const delayedSample = sample(delayedTimestamp);
    const delayedEvaluation = {
      session: scheduled.session,
      decision: { code: 'stale_fix' as const },
      projected_route_progress_m: null,
      distance_from_route_m: null,
    };
    if (originalLongFormCapacityLocationIsAccepted(
      scheduled.session,
      delayedSample,
      delayedEvaluation as any,
    )) {
      scheduled = evaluateOriginalLongFormCapacity(
        plan,
        hard,
        delayedEvaluation.session,
        delayedSample,
        { projected_progress_m: null, distance_from_route_m: null },
      );
    }
  }
  assert.equal(scheduled.session.long_form?.capacity_candidate?.reliable_fix_count, 1);
  assert.equal(scheduled.session.long_form?.current_item_id, null);
}

{
  const now = 100_000;
  const fresh = sample(now - 1_000, {
    lat: landmark.coordinates?.lat,
    lng: landmark.coordinates?.lng,
    accuracy_m: 10,
  });
  assert.equal(originalLongFormLandmarkFixIsEligible(landmark, fresh, now), true);
  assert.equal(
    originalLongFormLandmarkFixIsEligible(
      landmark,
      { ...fresh, timestamp_ms: now - 20_000 },
      now,
    ),
    false,
    'a stale coordinate cannot authorize a parked landmark story',
  );
  assert.equal(
    originalLongFormLandmarkFixIsEligible(landmark, { ...fresh, accuracy_m: 150 }, now),
    false,
    'a poor-accuracy coordinate cannot authorize a parked landmark story',
  );
}

{
  const first = evaluateOriginalLongFormCapacity(
    plan,
    hard,
    activeSession(),
    sample(1_000),
    { projected_progress_m: 1_000, distance_from_route_m: 5 },
  );
  assert.equal(first.decision.code, 'waiting_for_fixes');
  assert.equal(first.action, null);
  const tooSoon = evaluateOriginalLongFormCapacity(
    plan,
    hard,
    first.session,
    sample(2_000),
    { projected_progress_m: 1_000, distance_from_route_m: 5 },
  );
  assert.equal(tooSoon.decision.code, 'waiting_for_dwell');
  const admitted = evaluateOriginalLongFormCapacity(
    plan,
    hard,
    tooSoon.session,
    sample(4_100),
    { projected_progress_m: 1_000, distance_from_route_m: 5 },
  );
  assert.equal(admitted.decision.code, 'admitted');
  assert.deepEqual(admitted.action, {
    type: 'play_optional',
    item_id: capacity.id,
    position_ms: 0,
  });
  assert.equal(admitted.session.long_form?.current_item_id, capacity.id);
  assert.deepEqual(admitted.session.pending_stop_ids, []);
  assert.deepEqual(admitted.session.completed_stop_ids, []);
}

{
  const precisePlan = {
    ...plan,
    items: plan.items.map(item => item.id === capacity.id
      ? { ...item, audio_duration_s: 36 }
      : item),
  };
  const insufficient = evaluateOriginalLongFormCapacity(
    precisePlan,
    hard,
    activeSession(),
    sample(5_000, { speed_mps: 10 }),
    // Next hard starts at 1,650m: 65 seconds remain. Duration 36 + guard 30 = 66.
    { projected_progress_m: 1_000, distance_from_route_m: 5 },
  );
  assert.equal(insufficient.decision.code, 'insufficient_capacity');
  assert.equal(insufficient.decision.available_audio_s, 65);
  assert.equal(insufficient.decision.required_audio_s, 66);
}

{
  const hardBusy = { ...activeSession(), current_stop_id: hard.stops[0].id };
  const denied = evaluateOriginalLongFormCapacity(
    plan,
    hard,
    hardBusy,
    sample(5_000),
    { projected_progress_m: 1_000, distance_from_route_m: 5 },
  );
  assert.equal(denied.decision.code, 'audio_busy');
  assert.equal(denied.action, null, 'capacity narration is never placed behind the hard FIFO');
}

{
  const noConfirmation = selectOriginalLongFormItem(
    plan,
    activeSession(),
    beforeRoute.id,
    { before_route_context_active: true },
  );
  assert.equal(noConfirmation.ok, false);
  if (!noConfirmation.ok) assert.equal(noConfirmation.code, 'parked_confirmation_required');

  const highSpeedDoesNotInferParking = selectOriginalLongFormItem(
    plan,
    activeSession(),
    beforeRoute.id,
    { before_route_context_active: true, user_confirmed_parked: false },
  );
  assert.equal(highSpeedDoesNotInferParking.ok, false);

  const wrongContext = selectOriginalLongFormItem(
    plan,
    activeSession(),
    landmark.id,
    { user_confirmed_parked: true, within_landmark_radius: false },
  );
  assert.equal(wrongContext.ok, false);
  if (!wrongContext.ok) assert.equal(wrongContext.code, 'not_available_here');

  const selected = selectOriginalLongFormItem(
    plan,
    activeSession(),
    landmark.id,
    { user_confirmed_parked: true, within_landmark_radius: true },
    10,
  );
  assert.equal(selected.ok, true);
  if (selected.ok) {
    assert.equal(selected.session.long_form?.current_selection_origin, 'user_explicit');
    assert.equal(originalLongFormHeadlessResumeAction(selected.session, plan)?.item_id, landmark.id);
    assert.equal(
      originalLongFormHeadlessResumeAction({ ...selected.session, status: 'stopped' }, plan),
      null,
      'End Tour must never cold-resume a retained explicit story',
    );
    assert.equal(
      originalLongFormHeadlessResumeAction({ ...selected.session, status: 'paused' }, plan),
      null,
      'paused stories require a foreground Resume action',
    );
  }
}

{
  const completedSession = withOriginalLongFormSession(
    { ...activeSession(), status: 'completed', completed_at_ms: 20 },
    {
      ...createOriginalLongFormSession(plan, 20),
      completed_item_ids: [completion.id],
    },
  );
  const replayed = replayOriginalLongFormItem(
    plan,
    completedSession,
    completion.id,
    { route_completed: true },
    21,
  );
  assert.equal(replayed.ok, true);
  if (!replayed.ok) throw new Error('completed deeper story replay failed');
  assert.equal(replayed.session.long_form?.current_item_id, completion.id);
  assert.deepEqual(replayed.session.long_form?.completed_item_ids, [completion.id]);
  assert.equal(replayed.session.current_stop_id, null);
  assert.deepEqual(replayed.session.pending_stop_ids, []);
  const restored = normalizeOriginalLongFormSession(
    JSON.parse(JSON.stringify(replayed.session.long_form)),
    plan,
  );
  assert.equal(restored.current_item_id, completion.id);
  assert.deepEqual(restored.completed_item_ids, [completion.id]);
}

{
  const groupPlan = {
    ...plan,
    items: plan.items.map(item => item.id === landmark.id
      ? {
        ...item,
        delivery: {
          mode: 'stopped_deeper' as const,
          availability: 'before_route_user_confirmed_parked' as const,
          experience_group_id: beforeRoute.delivery.mode === 'stopped_deeper'
            ? beforeRoute.delivery.experience_group_id
            : 'pre_route_story',
          requires_user_confirmed_parked: true as const,
          motion_inference_allowed: false as const,
          parking_availability: 'not_checked' as const,
          parking_promise: false as const,
        },
      }
      : item),
  };
  const selected = selectOriginalLongFormItem(
    groupPlan,
    activeSession(),
    beforeRoute.id,
    { user_confirmed_parked: true, before_route_context_active: true },
    1,
  );
  assert.equal(selected.ok, true);
  if (!selected.ok) throw new Error('fixture group selection failed');
  assert.equal(selected.session.long_form?.current_item_id, beforeRoute.id);
  assert.deepEqual(selected.session.long_form?.pending_group_item_ids, [landmark.id]);
  const positioned = updateOriginalLongFormAudioPosition(selected.session, groupPlan, 31_000, 2);
  const preempted = preemptOriginalLongFormForHardCue(positioned, groupPlan, 31_000, 3);
  assert.deepEqual(preempted.long_form?.pending_group_item_ids, [landmark.id]);
  const resumed = resumeDeferredOriginalLongFormAfterHardCue(
    { ...preempted, current_stop_id: null },
    groupPlan,
    4,
  );
  assert.equal(resumed.action?.item_id, beforeRoute.id);
  assert.equal(resumed.action?.position_ms, 31_000);
  assert.deepEqual(resumed.session.long_form?.pending_group_item_ids, [landmark.id]);
  const advanced = completeOriginalLongFormItem(resumed.session, groupPlan, beforeRoute.id, 5);
  assert.equal(advanced.long_form?.current_item_id, landmark.id);
  assert.deepEqual(advanced.long_form?.pending_group_item_ids, []);
  assert.deepEqual(advanced.completed_stop_ids, []);
  const serialized = JSON.parse(JSON.stringify(advanced)) as OriginalSessionV1;
  assert.equal(
    originalLongFormHeadlessResumeAction(serialized, groupPlan)?.item_id,
    landmark.id,
    'headless recovery resumes the persisted group position without selecting a new item',
  );
  const finished = completeOriginalLongFormItem(advanced, groupPlan, landmark.id, 6);
  assert.deepEqual(
    finished.long_form?.completed_item_ids,
    originalSelectablePlaybackGroupItems(groupPlan, beforeRoute.id).map(item => item.id),
  );
  const replayed = replayOriginalLongFormItem(
    groupPlan,
    finished,
    beforeRoute.id,
    { user_confirmed_parked: true, before_route_context_active: true },
    7,
  );
  assert.equal(replayed.ok, true);
  if (!replayed.ok) throw new Error('fixture group replay failed');
  assert.equal(replayed.session.long_form?.current_item_id, beforeRoute.id);
  assert.deepEqual(replayed.session.long_form?.pending_group_item_ids, [landmark.id]);
  assert.deepEqual(replayed.session.long_form?.completed_item_ids, [beforeRoute.id, landmark.id]);
  const normalizedReplay = normalizeOriginalSession(
    JSON.parse(JSON.stringify(replayed.session)) as OriginalSessionV1,
  );
  assert.equal(normalizedReplay.long_form?.current_item_id, beforeRoute.id);
  assert.deepEqual(normalizedReplay.long_form?.pending_group_item_ids, [landmark.id]);
  assert.equal(
    originalLongFormHeadlessResumeAction(normalizedReplay, groupPlan)?.item_id,
    beforeRoute.id,
  );
  const replayPositioned = updateOriginalLongFormAudioPosition(
    normalizedReplay,
    groupPlan,
    18_750,
    8,
  );
  const replayPreempted = preemptOriginalLongFormForHardCue(
    replayPositioned,
    groupPlan,
    18_750,
    9,
  );
  const normalizedPreempted = normalizeOriginalSession(
    JSON.parse(JSON.stringify(replayPreempted)) as OriginalSessionV1,
  );
  assert.equal(normalizedPreempted.long_form?.deferred_item_id, beforeRoute.id);
  assert.equal(normalizedPreempted.long_form?.deferred_audio_position_ms, 18_750);
  assert.deepEqual(normalizedPreempted.long_form?.pending_group_item_ids, [landmark.id]);
  const replayResumed = resumeDeferredOriginalLongFormAfterHardCue(
    { ...normalizedPreempted, current_stop_id: null },
    groupPlan,
    10,
  );
  assert.equal(replayResumed.action?.item_id, beforeRoute.id);
  assert.equal(replayResumed.action?.position_ms, 18_750);
  assert.deepEqual(replayResumed.session.long_form?.pending_group_item_ids, [landmark.id]);
}

{
  const denied = selectOriginalLongFormItem(
    plan,
    activeSession(),
    completion.id,
    { route_completed: false },
  );
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, 'route_completion_required');

  const routeComplete = {
    ...activeSession(),
    status: 'completed' as const,
    completed_stop_ids: hard.stops.map(stop => stop.id),
    completed_at_ms: 20,
  };
  const selected = selectOriginalLongFormItem(
    plan,
    routeComplete,
    completion.id,
    { route_completed: true },
    21,
  );
  assert.equal(selected.ok, true);
}

{
  const selected = selectOriginalLongFormItem(
    plan,
    activeSession(),
    landmark.id,
    { user_confirmed_parked: true, within_landmark_radius: true },
    10,
  );
  assert.equal(selected.ok, true);
  if (!selected.ok) throw new Error('fixture selection failed');
  const positioned = updateOriginalLongFormAudioPosition(selected.session, plan, 42_500, 11);
  const preempted = preemptOriginalLongFormForHardCue(positioned, plan, 42_500, 12);
  assert.equal(preempted.long_form?.current_item_id, null);
  assert.equal(preempted.long_form?.deferred_item_id, landmark.id);
  assert.equal(preempted.long_form?.deferred_audio_position_ms, 42_500);
  assert.deepEqual(preempted.completed_stop_ids, []);
  assert.deepEqual(preempted.pending_stop_ids, []);
  const hardFinished = { ...preempted, current_stop_id: null };
  const resumed = resumeDeferredOriginalLongFormAfterHardCue(hardFinished, plan, 13);
  assert.equal(resumed.action?.item_id, landmark.id);
  assert.equal(resumed.action?.position_ms, 42_500);
  assert.equal(resumed.session.long_form?.deferred_item_id, null);
}

{
  const auto = withOriginalLongFormSession(activeSession(), {
    ...createOriginalLongFormSession(plan, 1),
    current_item_id: capacity.id,
    current_selection_origin: 'capacity_auto',
  });
  assert.equal(
    originalLongFormHeadlessResumeAction(auto, plan),
    null,
    'a cold task cannot create or resurrect automatic optional playback',
  );
  const preempted = preemptOriginalLongFormForHardCue(auto, plan, 12_000, 2);
  const afterHard = resumeDeferredOriginalLongFormAfterHardCue(
    { ...preempted, current_stop_id: null },
    plan,
    3,
  );
  assert.equal(afterHard.action, null);
  assert.equal(afterHard.session.long_form?.deferred_item_id, null);
  const afterRoute = {
    ...afterHard.session,
    status: 'completed' as const,
    completed_stop_ids: hard.stops.map(stop => stop.id),
    completed_at_ms: 4,
  };
  const fallback = selectOriginalLongFormItem(
    plan,
    afterRoute,
    capacity.id,
    { route_completed: true },
    5,
  );
  assert.equal(fallback.ok, true, 'hard preemption cannot leave capacity fallback permanently busy');
}

{
  const selected = selectOriginalLongFormItem(
    plan,
    activeSession(),
    beforeRoute.id,
    { user_confirmed_parked: true, before_route_context_active: true },
    100,
  );
  assert.equal(selected.ok, true);
  if (!selected.ok) throw new Error('fixture selection failed');
  const serialized = JSON.parse(JSON.stringify(selected.session)) as OriginalSessionV1;
  const restored = normalizeOriginalLongFormSession(serialized.long_form, plan, 200);
  assert.equal(restored.current_item_id, beforeRoute.id);
  assert.equal(restored.current_selection_origin, 'user_explicit');
  const completedSession = completeOriginalLongFormItem(serialized, plan, beforeRoute.id, 201);
  assert.deepEqual(completedSession.long_form?.completed_item_ids, [beforeRoute.id]);
  assert.equal(completedSession.long_form?.current_item_id, null);
  assert.equal(ensureOriginalLongFormSession(completedSession, plan).current_audio_position_ms, 0);
  assert.deepEqual(completedSession.completed_stop_ids, [], 'optional IDs never enter hard completion');
}

{
  const report = validateOriginalLongFormSelection(hard, plan);
  assert.equal(report.schema_version, 1);
  assert.deepEqual(report.speed_fixtures.map(item => item.speed_mph), [15, 36, 65, 75]);
  assert.equal(report.valid, true);
  assert.deepEqual(report.invariants, {
    hard_preemption_preserves_position: true,
    restart_restores_explicit_selection: true,
    parked_requires_explicit_confirmation: true,
    completion_requires_hard_route_completion: true,
    optional_ids_absent_from_hard_progress: true,
  });
}

console.log('originals long-form scheduler tests passed');
