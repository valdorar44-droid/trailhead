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

console.log('Originals trigger engine tests passed.');
