import assert from 'node:assert/strict';
import { validateOriginalManifest } from '../manifest';
import {
  completeOriginalStop,
  createOriginalSession,
  normalizeOriginalSession,
  originalPendingStopIds,
  promoteNextOriginalStop,
} from '../session';
import { evaluateOriginalLocation } from '../triggerEngine';
import type { OriginalLocationSample, OriginalSessionV1 } from '../types';
import { originalManifest } from './fixtures';

const manifest = validateOriginalManifest(originalManifest());
let session: OriginalSessionV1 = { ...createOriginalSession(manifest), status: 'active' };
const sample = (
  lng: number,
  timestampMs: number,
  overrides: Partial<OriginalLocationSample> = {},
): OriginalLocationSample => ({
  lat: 0,
  lng,
  accuracy_m: 10,
  heading_deg: 90,
  speed_mps: 12,
  timestamp_ms: timestampMs,
  ...overrides,
});

function originalBacktrackManifest() {
  const value = originalManifest();
  value.route.geometry.coordinates = [[0, 0], [0.02, 0], [0, 0], [0, 0.02]];
  value.route.bounds = { north: 0.02, south: 0, east: 0.02, west: 0 };
  value.route.distance_m = 6_672;
  value.offline_map.bounds = { ...value.route.bounds };
  value.stops[0] = {
    ...value.stops[0],
    coordinates: { lat: 0, lng: 0.005 },
    trigger: {
      ...value.stops[0].trigger,
      route_progress_start_m: 400,
      route_progress_end_m: 700,
      approach_bearing_deg: 90,
      bearing_tolerance_deg: 30,
    },
  };
  value.stops[1] = {
    ...value.stops[1],
    coordinates: { lat: 0, lng: 0.019 },
    trigger: {
      ...value.stops[1].trigger,
      route_progress_start_m: 1_950,
      route_progress_end_m: 2_240,
      approach_bearing_deg: 90,
      bearing_tolerance_deg: 30,
    },
  };
  value.stops[2] = {
    ...value.stops[2],
    coordinates: { lat: 0, lng: 0.015 },
    trigger: {
      ...value.stops[2].trigger,
      route_progress_start_m: 2_650,
      route_progress_end_m: 2_900,
      approach_bearing_deg: 270,
      bearing_tolerance_deg: 30,
    },
  };
  return validateOriginalManifest(value);
}

let result = evaluateOriginalLocation(manifest, session, sample(0.0045, 1_000));
session = result.session;
assert.equal(session.current_stop_id, null, 'one location fix only arms a cue');
assert.equal(session.trigger_state.candidate_sample_count, 1);

result = evaluateOriginalLocation(manifest, session, sample(0.0045, 4_100));
session = result.session;
assert.equal(session.current_stop_id, 'story-1', 'two fixes over three seconds trigger the first cue');
assert.deepEqual(session.triggered_stop_ids, ['story-1']);
assert(result.events.some(event => event.type === 'stop_triggered'));

result = evaluateOriginalLocation(manifest, session, sample(0.0045, 8_000));
assert.deepEqual(result.session.triggered_stop_ids, ['story-1'], 'a triggered cue never fires twice');

const restoredAfterTrigger = JSON.parse(JSON.stringify(result.session)) as OriginalSessionV1;
const restarted = evaluateOriginalLocation(manifest, restoredAfterTrigger, sample(0.0045, 12_000));
assert.deepEqual(
  restarted.session.triggered_stop_ids,
  ['story-1'],
  'a persisted triggered cue is not duplicated after process restart',
);

result = evaluateOriginalLocation(manifest, session, sample(0.0108, 10_000));
session = result.session;
result = evaluateOriginalLocation(manifest, session, sample(0.0108, 13_100));
session = result.session;
assert.equal(session.queued_stop_id, 'story-2', 'one overlapping cue is queued');
assert.deepEqual(session.pending_stop_ids, ['story-2']);
assert(result.events.some(event => event.type === 'stop_queued'));

result = evaluateOriginalLocation(manifest, session, sample(0.0162, 17_000));
session = result.session;
result = evaluateOriginalLocation(manifest, session, sample(0.0162, 20_100));
session = result.session;
assert.deepEqual(
  originalPendingStopIds(session),
  ['story-2', 'story-3'],
  'eligible cues append to one durable FIFO while narration is playing',
);
assert.equal(session.queued_stop_id, 'story-2', 'the legacy queue field mirrors the FIFO head');
assert(result.events.some(event => event.type === 'stop_queued' && event.stop_id === 'story-3'));
assert.equal(result.decision.code, 'queued');

const restartedQueue = normalizeOriginalSession(
  JSON.parse(JSON.stringify(session)) as OriginalSessionV1,
);
assert.deepEqual(
  restartedQueue.pending_stop_ids,
  ['story-2', 'story-3'],
  'FIFO order survives a persisted process restart',
);
const firstSettled = completeOriginalStop(
  restartedQueue,
  'story-1',
  manifest.stops.map(stop => stop.id),
  21_000,
);
const firstPromotion = promoteNextOriginalStop(firstSettled, 21_000);
assert.equal(firstPromotion.promoted_stop_id, 'story-2');
assert.equal(firstPromotion.session.current_stop_id, 'story-2');
assert.deepEqual(firstPromotion.session.pending_stop_ids, ['story-3']);
assert.equal(firstPromotion.session.queued_stop_id, 'story-3');
const secondSettled = completeOriginalStop(
  firstPromotion.session,
  'story-2',
  manifest.stops.map(stop => stop.id),
  22_000,
);
const secondPromotion = promoteNextOriginalStop(secondSettled, 22_000);
assert.equal(secondPromotion.promoted_stop_id, 'story-3');
assert.equal(secondPromotion.session.current_stop_id, 'story-3');
assert.deepEqual(secondPromotion.session.pending_stop_ids, []);
assert.equal(secondPromotion.session.queued_stop_id, null);

const legacyQueuedSession = { ...createOriginalSession(manifest), status: 'active' as const };
delete legacyQueuedSession.pending_stop_ids;
legacyQueuedSession.current_stop_id = 'story-1';
legacyQueuedSession.queued_stop_id = 'story-2';
legacyQueuedSession.triggered_stop_ids = ['story-1', 'story-2'];
const migratedLegacyQueue = normalizeOriginalSession(legacyQueuedSession);
assert.deepEqual(migratedLegacyQueue.pending_stop_ids, ['story-2']);
assert.equal(migratedLegacyQueue.queued_stop_id, 'story-2');

const mixedEmptyQueue = normalizeOriginalSession({
  ...createOriginalSession(manifest),
  status: 'active',
  current_stop_id: 'story-1',
  triggered_stop_ids: ['story-1', 'story-2'],
  pending_stop_ids: [],
  queued_stop_id: 'story-2',
});
assert.deepEqual(
  mixedEmptyQueue.pending_stop_ids,
  ['story-2'],
  'a legacy writer can restore its head when a newer empty FIFO is stale',
);

const mixedConflictingQueue = normalizeOriginalSession({
  ...createOriginalSession(manifest),
  status: 'active',
  current_stop_id: 'story-1',
  triggered_stop_ids: ['story-1', 'story-2', 'story-3'],
  pending_stop_ids: ['story-3', 'story-2'],
  queued_stop_id: 'story-2',
});
assert.deepEqual(
  mixedConflictingQueue.pending_stop_ids,
  ['story-2', 'story-3'],
  'the legacy head is reconciled before a conflicting canonical tail',
);
assert.equal(mixedConflictingQueue.queued_stop_id, 'story-2');

const mixedStaleHead = normalizeOriginalSession({
  ...mixedConflictingQueue,
  completed_stop_ids: ['story-2'],
  pending_stop_ids: ['story-3'],
  queued_stop_id: 'story-2',
});
assert.deepEqual(
  mixedStaleHead.pending_stop_ids,
  ['story-3'],
  'a completed legacy head is discarded without losing the canonical tail',
);
assert.equal(mixedStaleHead.queued_stop_id, 'story-3');

const poor = evaluateOriginalLocation(manifest, { ...createOriginalSession(manifest), status: 'active' }, sample(0.0045, 1_000, { accuracy_m: 150 }));
assert.equal(poor.session.tracking_state, 'poor_accuracy');
assert.equal(poor.session.trigger_state.candidate_stop_id, null);

const offRoute = evaluateOriginalLocation(manifest, { ...createOriginalSession(manifest), status: 'active' }, sample(0.0045, 1_000, { lat: 0.01 }));
assert.equal(offRoute.session.tracking_state, 'off_route');
assert.equal(offRoute.session.current_stop_id, null);
const rejoined = evaluateOriginalLocation(manifest, offRoute.session, sample(0.0045, 5_000));
assert.equal(rejoined.session.tracking_state, 'on_route');
assert(rejoined.events.some(event => event.type === 'route_state_changed' && event.state === 'on_route'));

const midRoute = evaluateOriginalLocation(
  manifest,
  { ...createOriginalSession(manifest), status: 'active' },
  sample(0.0115, 1_000),
);
assert(midRoute.session.missed_stop_ids.includes('story-1'), 'starting mid-route marks earlier cues missed');
assert(!midRoute.session.triggered_stop_ids.includes('story-1'));

const bearingManifest = originalManifest();
bearingManifest.stops[0].trigger.approach_bearing_deg = 90;
bearingManifest.stops[0].trigger.bearing_tolerance_deg = 20;
const wrongBearing = evaluateOriginalLocation(
  bearingManifest,
  { ...createOriginalSession(bearingManifest), status: 'active' },
  sample(0.0045, 1_000, { heading_deg: 270 }),
);
assert.equal(wrongBearing.session.trigger_state.candidate_stop_id, null, 'authored direction gates a cue');

const reverseManifest = originalManifest();
reverseManifest.stops[1].trigger.approach_bearing_deg = 90;
reverseManifest.stops[1].trigger.bearing_tolerance_deg = 25;
const reverseSession: OriginalSessionV1 = {
  ...createOriginalSession(reverseManifest),
  status: 'active',
  completed_stop_ids: ['story-1'],
  triggered_stop_ids: ['story-1'],
};
const reverseTravel = evaluateOriginalLocation(
  reverseManifest,
  reverseSession,
  sample(0.0108, 1_000, { heading_deg: 270 }),
);
assert.equal(
  reverseTravel.session.trigger_state.candidate_stop_id,
  null,
  'reverse travel cannot arm a cue with an authored forward bearing',
);

const implicitReverseManifest = originalManifest();
implicitReverseManifest.stops[2] = {
  ...implicitReverseManifest.stops[2],
  coordinates: { lat: 0, lng: 0.02 },
  trigger: {
    ...implicitReverseManifest.stops[2].trigger,
    route_progress_start_m: 2_000,
    route_progress_end_m: implicitReverseManifest.route.distance_m,
  },
};
const heldReverseSession: OriginalSessionV1 = {
  ...createOriginalSession(implicitReverseManifest),
  status: 'active',
  current_stop_id: 'story-1',
  triggered_stop_ids: ['story-1'],
};
const reverseEntry = evaluateOriginalLocation(
  implicitReverseManifest,
  heldReverseSession,
  sample(0.02, 1_000, { heading_deg: 270 }),
);
assert.deepEqual(
  reverseEntry.session.missed_stop_ids,
  [],
  'one reverse course fix cannot irreversibly close the route',
);
assert.equal(reverseEntry.session.trigger_state.reverse_candidate_sample_count, 1);
assert.equal(reverseEntry.session.trigger_state.route_initialized, false);
assert.equal(reverseEntry.session.trigger_state.candidate_stop_id, null);
assert(!reverseEntry.events.some(event => (
  event.type === 'stop_triggered' || event.type === 'stop_queued'
)));
const persistedReverseEntry = normalizeOriginalSession(
  JSON.parse(JSON.stringify(reverseEntry.session)) as OriginalSessionV1,
);
const earlyContinuedReverse = evaluateOriginalLocation(
  implicitReverseManifest,
  persistedReverseEntry,
  sample(0.0195, 2_000, { heading_deg: 270 }),
);
assert.deepEqual(earlyContinuedReverse.session.missed_stop_ids, []);
assert.equal(
  earlyContinuedReverse.session.trigger_state.reverse_candidate_sample_count,
  2,
  'a second reverse fix before three seconds remains an unconfirmed candidate',
);
const continuedReverse = evaluateOriginalLocation(
  implicitReverseManifest,
  earlyContinuedReverse.session,
  sample(0.019, 4_100, { heading_deg: 270 }),
);
assert.deepEqual(
  continuedReverse.session.missed_stop_ids,
  ['story-2', 'story-3'],
  'two reverse fixes spanning three seconds confirm a reverse route entry',
);
assert(!continuedReverse.events.some(event => (
  event.type === 'stop_triggered' || event.type === 'stop_queued'
)));
const completedReverse = completeOriginalStop(
  continuedReverse.session,
  'story-1',
  implicitReverseManifest.stops.map(stop => stop.id),
  5_000,
);
assert.equal(completedReverse.status, 'completed', 'completing a held story closes a reverse-entry session');

const interruptedReverseEntry = evaluateOriginalLocation(
  implicitReverseManifest,
  heldReverseSession,
  sample(0.02, 10_000, { heading_deg: 270 }),
);
const poorDuringReverseEntry = evaluateOriginalLocation(
  implicitReverseManifest,
  interruptedReverseEntry.session,
  sample(0.0198, 11_000, { heading_deg: 270, accuracy_m: 150 }),
);
assert.equal(poorDuringReverseEntry.session.trigger_state.reverse_candidate_sample_count, 0);
assert.deepEqual(
  poorDuringReverseEntry.session.missed_stop_ids,
  [],
  'an invalid fix clears reverse confirmation without closing stories',
);

const staleDuringReverseEntry = evaluateOriginalLocation(
  implicitReverseManifest,
  interruptedReverseEntry.session,
  sample(0.0198, 9_000, { heading_deg: 270 }),
);
assert.equal(staleDuringReverseEntry.decision.code, 'stale_fix');
assert.equal(staleDuringReverseEntry.session.trigger_state.reverse_candidate_sample_count, 1);

const delayedReverseConfirmation = evaluateOriginalLocation(
  implicitReverseManifest,
  interruptedReverseEntry.session,
  sample(0.019, 30_000, { heading_deg: 270 }),
);
assert.equal(delayedReverseConfirmation.session.trigger_state.reverse_candidate_sample_count, 1);
assert.deepEqual(
  delayedReverseConfirmation.session.missed_stop_ids,
  [],
  'widely separated reverse fixes restart confirmation instead of closing the tour',
);

const pausedReverseEntry = evaluateOriginalLocation(
  implicitReverseManifest,
  { ...interruptedReverseEntry.session, user_paused: true },
  sample(0.0195, 40_000, { heading_deg: 270 }),
);
assert.equal(pausedReverseEntry.decision.code, 'user_paused');
assert.equal(pausedReverseEntry.session.trigger_state.reverse_candidate_sample_count, 0);
const resumedAfterPausedFix = evaluateOriginalLocation(
  implicitReverseManifest,
  { ...pausedReverseEntry.session, user_paused: false },
  sample(0.019, 43_100, { heading_deg: 270 }),
);
assert.deepEqual(
  resumedAfterPausedFix.session.missed_stop_ids,
  [],
  'paused location updates cannot refresh a stale destructive reverse candidate',
);

let recoveredFromNoisyInitialCourse = evaluateOriginalLocation(
  manifest,
  { ...createOriginalSession(manifest), status: 'active' },
  sample(0, 20_000, { heading_deg: 270 }),
).session;
assert.deepEqual(recoveredFromNoisyInitialCourse.missed_stop_ids, []);
recoveredFromNoisyInitialCourse = evaluateOriginalLocation(
  manifest,
  recoveredFromNoisyInitialCourse,
  sample(0.0045, 23_100, { heading_deg: 90 }),
).session;
assert.equal(recoveredFromNoisyInitialCourse.trigger_state.candidate_stop_id, 'story-1');
assert.deepEqual(
  recoveredFromNoisyInitialCourse.missed_stop_ids,
  [],
  'a forward fix clears an unconfirmed reverse candidate without losing future stories',
);
recoveredFromNoisyInitialCourse = evaluateOriginalLocation(
  manifest,
  recoveredFromNoisyInitialCourse,
  sample(0.0045, 26_200, { heading_deg: 90 }),
).session;
assert.equal(recoveredFromNoisyInitialCourse.current_stop_id, 'story-1');

const southboundManifest = originalManifest();
southboundManifest.route.geometry.coordinates = [[0, 0], [0, -0.03]];
southboundManifest.route.distance_m = 3_336;
southboundManifest.route.bounds = { north: 0, south: -0.03, east: 0, west: 0 };
southboundManifest.offline_map.bounds = { ...southboundManifest.route.bounds };
let missingHeadingSouthbound = evaluateOriginalLocation(
  southboundManifest,
  { ...createOriginalSession(southboundManifest), status: 'active' },
  sample(0, 30_000, { lat: -0.001, heading_deg: null }),
).session;
missingHeadingSouthbound = evaluateOriginalLocation(
  southboundManifest,
  missingHeadingSouthbound,
  sample(0, 33_100, { lat: -0.0015, heading_deg: null }),
).session;
assert.deepEqual(
  missingHeadingSouthbound.missed_stop_ids,
  [],
  'missing heading data is never coerced to north or treated as reverse travel',
);
assert.equal(missingHeadingSouthbound.trigger_state.reverse_candidate_sample_count, 0);

const uTurnSession: OriginalSessionV1 = {
  ...createOriginalSession(manifest),
  status: 'active',
  completed_stop_ids: ['story-1'],
  triggered_stop_ids: ['story-1'],
  last_projected_route_progress_m: 900,
  trigger_state: {
    ...createOriginalSession(manifest).trigger_state,
    route_initialized: true,
  },
};
const uTurn = evaluateOriginalLocation(
  manifest,
  uTurnSession,
  sample(0.0108, 10_000, { heading_deg: 270 }),
);
assert.equal(uTurn.decision.code, 'wrong_bearing');
assert.equal(uTurn.session.trigger_state.candidate_stop_id, null);
assert(!uTurn.session.missed_stop_ids.includes('story-2'));
assert(!uTurn.session.missed_stop_ids.includes('story-3'));
const endpointUTurn = evaluateOriginalLocation(
  manifest,
  uTurnSession,
  sample(0.02, 10_100, { heading_deg: 270 }),
);
assert.deepEqual(
  endpointUTurn.session.missed_stop_ids,
  [],
  'a later U-turn at the route endpoint blocks triggers without discarding future cues',
);
const broadBearingManifest = originalManifest();
broadBearingManifest.stops[1].trigger.approach_bearing_deg = 90;
broadBearingManifest.stops[1].trigger.bearing_tolerance_deg = 180;
const broadBearingUTurn = evaluateOriginalLocation(
  broadBearingManifest,
  uTurnSession,
  sample(0.0108, 10_200, { heading_deg: 270 }),
);
assert.equal(
  broadBearingUTurn.decision.code,
  'wrong_bearing',
  'route-opposite protection cannot be bypassed by an authored 180 degree tolerance',
);
assert.equal(broadBearingUTurn.session.trigger_state.candidate_stop_id, null);
let recoveredFromUTurn = evaluateOriginalLocation(
  manifest,
  uTurn.session,
  sample(0.0108, 13_100, { heading_deg: 90 }),
).session;
assert.equal(recoveredFromUTurn.trigger_state.candidate_stop_id, 'story-2');
recoveredFromUTurn = evaluateOriginalLocation(
  manifest,
  recoveredFromUTurn,
  sample(0.0108, 16_200, { heading_deg: 90 }),
).session;
assert.equal(recoveredFromUTurn.current_stop_id, 'story-2', 'two fresh forward fixes trigger after a U-turn');

const driveByManifest = originalManifest();
driveByManifest.stops[1].trigger.lead_time_s = 10;
let driveBySession: OriginalSessionV1 = {
  ...createOriginalSession(driveByManifest),
  status: 'active',
  completed_stop_ids: ['story-1'],
  triggered_stop_ids: ['story-1'],
};
driveBySession = evaluateOriginalLocation(
  driveByManifest,
  driveBySession,
  sample(0.0088, 1_000, { speed_mps: 30 }),
).session;
driveBySession = evaluateOriginalLocation(
  driveByManifest,
  driveBySession,
  sample(0.00965, 4_100, { speed_mps: 30 }),
).session;
assert.equal(
  driveBySession.current_stop_id,
  'story-2',
  'lead time lets two high-speed drive-by fixes trigger before the authored route window',
);

const legacySession = createOriginalSession(manifest);
delete legacySession.trigger_state.reverse_candidate_entered_at_ms;
delete legacySession.trigger_state.reverse_candidate_sample_count;
delete legacySession.trigger_state.reverse_candidate_last_sample_at_ms;
const normalizedLegacySession = normalizeOriginalSession(legacySession);
assert.equal(normalizedLegacySession.trigger_state.reverse_candidate_entered_at_ms, null);
assert.equal(normalizedLegacySession.trigger_state.reverse_candidate_sample_count, 0);
assert.equal(normalizedLegacySession.trigger_state.reverse_candidate_last_sample_at_ms, null);

let hysteresis = evaluateOriginalLocation(
  manifest,
  { ...createOriginalSession(manifest), status: 'active' },
  sample(0.0045, 1_000),
).session;
hysteresis = evaluateOriginalLocation(manifest, hysteresis, sample(0.0045, 2_000, { lat: 0.0027 })).session;
assert.equal(hysteresis.trigger_state.candidate_sample_count, 1, 'hysteresis retains an armed cue near its boundary');
hysteresis = evaluateOriginalLocation(manifest, hysteresis, sample(0.0045, 4_100)).session;
assert.equal(hysteresis.current_stop_id, 'story-1');

const backtrackManifest = originalBacktrackManifest();
let returnSession: OriginalSessionV1 = {
  ...createOriginalSession(backtrackManifest),
  status: 'active',
  completed_stop_ids: ['story-1', 'story-2'],
  triggered_stop_ids: ['story-1', 'story-2'],
  last_projected_route_progress_m: 2_224,
  trigger_state: {
    ...createOriginalSession(backtrackManifest).trigger_state,
    route_initialized: true,
  },
};
let returnResult = evaluateOriginalLocation(
  backtrackManifest,
  returnSession,
  sample(0.015, 20_000, { heading_deg: 270 }),
);
returnSession = JSON.parse(JSON.stringify(returnResult.session)) as OriginalSessionV1;
assert(returnResult.projected_route_progress_m! > 2_650, 'the return occurrence advances beyond the turnaround');
assert.equal(returnSession.trigger_state.candidate_stop_id, 'story-3', 'the return-leg cue arms on the shared road');

returnResult = evaluateOriginalLocation(
  backtrackManifest,
  returnSession,
  sample(0.015, 23_100, { heading_deg: 270 }),
);
returnSession = returnResult.session;
assert.equal(returnSession.current_stop_id, 'story-3', 'a persisted return-leg candidate triggers after restart');
assert.equal(
  returnSession.triggered_stop_ids.filter(id => id === 'story-3').length,
  1,
  'the return-leg cue triggers exactly once',
);

const duplicateReturn = evaluateOriginalLocation(
  backtrackManifest,
  JSON.parse(JSON.stringify(returnSession)) as OriginalSessionV1,
  sample(0.015, 27_000, { heading_deg: 270 }),
);
assert.equal(
  duplicateReturn.session.triggered_stop_ids.filter(id => id === 'story-3').length,
  1,
  'a restored return-leg session cannot duplicate the cue',
);

const overlapMidRoute = evaluateOriginalLocation(
  backtrackManifest,
  { ...createOriginalSession(backtrackManifest), status: 'active' },
  sample(0.015, 30_000, { heading_deg: 270 }),
);
assert.deepEqual(
  overlapMidRoute.session.missed_stop_ids,
  ['story-1', 'story-2'],
  'a headed mid-route start on the return occurrence marks earlier stories missed',
);
assert.equal(overlapMidRoute.session.trigger_state.candidate_stop_id, 'story-3');

const outboundProgressSession: OriginalSessionV1 = {
  ...createOriginalSession(backtrackManifest),
  status: 'active',
  completed_stop_ids: ['story-1'],
  triggered_stop_ids: ['story-1'],
  last_projected_route_progress_m: 1_500,
  trigger_state: {
    ...createOriginalSession(backtrackManifest).trigger_state,
    route_initialized: true,
  },
};
const reverseOnOutbound = evaluateOriginalLocation(
  backtrackManifest,
  outboundProgressSession,
  sample(0.013, 34_000, { heading_deg: 270 }),
);
assert(reverseOnOutbound.projected_route_progress_m! < 2_000, 'reverse travel remains on the outbound occurrence');
assert(!reverseOnOutbound.session.missed_stop_ids.includes('story-2'));
assert(!reverseOnOutbound.session.missed_stop_ids.includes('story-3'));

const leftRoute = evaluateOriginalLocation(
  backtrackManifest,
  outboundProgressSession,
  sample(0.019, 38_000, { lat: 0.01, heading_deg: 90 }),
);
assert.equal(leftRoute.session.tracking_state, 'off_route');
assert.equal(
  leftRoute.session.last_projected_route_progress_m,
  1_500,
  'an off-route projection does not overwrite the last accepted route progress',
);
const outboundRejoin = evaluateOriginalLocation(
  backtrackManifest,
  leftRoute.session,
  sample(0.014, 42_000, { heading_deg: 90 }),
);
assert.equal(outboundRejoin.session.tracking_state, 'on_route');
assert(outboundRejoin.projected_route_progress_m! < 2_000, 'rejoin returns to the prior outbound occurrence');
assert(!outboundRejoin.session.missed_stop_ids.includes('story-2'));

console.log('Originals trigger engine tests passed.');
