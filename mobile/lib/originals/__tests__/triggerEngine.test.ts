import assert from 'node:assert/strict';
import { validateOriginalManifest } from '../manifest';
import { createOriginalSession } from '../session';
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
assert(result.events.some(event => event.type === 'stop_queued'));

result = evaluateOriginalLocation(manifest, session, sample(0.0162, 17_000));
assert.equal(result.session.queued_stop_id, 'story-2', 'a full queue prevents another cue from arming');
assert(!result.session.triggered_stop_ids.includes('story-3'));

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
