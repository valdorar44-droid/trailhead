import assert from 'node:assert/strict';
import { validateOriginalManifest } from '../manifest';
import { completeOriginalStop, createOriginalSession } from '../session';
import { evaluateOriginalLocation } from '../triggerEngine';
import type {
  OriginalLocationSample,
  OriginalSessionV1,
  OriginalTriggerEvent,
} from '../types';
import recordedTraceJson from './fixtures/moab-recorded-gps-trace.json';
import { originalManifest } from './fixtures';

type RecordedSample = OriginalLocationSample & { phase: string };
type RecordedTrace = {
  name: string;
  route_origin: { lat: number; lng: number };
  samples: RecordedSample[];
};

const recordedTrace = recordedTraceJson as RecordedTrace;
const origin = recordedTrace.route_origin;
const manifestInput = originalManifest();

// Keep the compact authored windows from the trigger fixture while placing its
// geometry and stops over the sanitized Moab recording's WGS84 coordinates.
manifestInput.route.geometry.coordinates = [
  [origin.lng, origin.lat],
  [origin.lng + 0.02, origin.lat],
];
manifestInput.route.bounds = {
  north: origin.lat + 0.01,
  south: origin.lat - 0.01,
  east: origin.lng + 0.02,
  west: origin.lng,
};
manifestInput.offline_map.bounds = { ...manifestInput.route.bounds };
manifestInput.stops = manifestInput.stops.map(stop => ({
  ...stop,
  coordinates: {
    lat: origin.lat + stop.coordinates.lat,
    lng: origin.lng + stop.coordinates.lng,
  },
}));

const manifest = validateOriginalManifest(manifestInput);
const allStopIds = manifest.stops.map(stop => stop.id);
let session: OriginalSessionV1 = {
  ...createOriginalSession(manifest, 'guest', recordedTrace.samples[0].timestamp_ms - 1),
  status: 'active',
};
const events: OriginalTriggerEvent[] = [];

function recordedSample(phase: string): OriginalLocationSample {
  const found = recordedTrace.samples.find(sample => sample.phase === phase);
  assert(found, `${recordedTrace.name} is missing the ${phase} sample`);
  const { phase: _phase, ...sample } = found;
  return sample;
}

function replay(phase: string) {
  const evaluation = evaluateOriginalLocation(manifest, session, recordedSample(phase));
  session = evaluation.session;
  events.push(...evaluation.events);
  return evaluation;
}

let evaluation = replay('mid_route_start');
assert.deepEqual(session.missed_stop_ids, ['story-1'], 'starting mid-route records earlier stories as missed');
assert.equal(session.trigger_state.candidate_stop_id, 'story-2');
assert(evaluation.events.some(event => event.type === 'stops_missed'));

evaluation = replay('poor_accuracy');
assert.equal(session.tracking_state, 'poor_accuracy');
assert.equal(session.trigger_state.candidate_stop_id, null, 'poor GPS clears an armed cue');
assert(evaluation.events.some(event => event.type === 'gps_quality_changed' && event.state === 'poor_accuracy'));

evaluation = replay('off_route');
assert.equal(session.tracking_state, 'off_route');
assert(evaluation.events.some(event => event.type === 'route_state_changed' && event.state === 'off_route'));

evaluation = replay('rejoin_arm');
assert.equal(session.tracking_state, 'on_route');
assert.equal(session.trigger_state.candidate_stop_id, 'story-2');
assert(evaluation.events.some(event => event.type === 'route_state_changed' && event.state === 'on_route'));

evaluation = replay('story_2_trigger');
assert.equal(session.current_stop_id, 'story-2');
assert.deepEqual(session.triggered_stop_ids, ['story-2']);
assert(evaluation.events.some(event => event.type === 'stop_triggered' && event.stop_id === 'story-2'));

// Model the process being killed immediately after the trigger was persisted.
session = JSON.parse(JSON.stringify(session)) as OriginalSessionV1;
evaluation = replay('story_2_duplicate_after_restart');
assert.deepEqual(session.triggered_stop_ids, ['story-2'], 'a restored trace cannot fire a persisted cue twice');
assert(!evaluation.events.some(event => (
  (event.type === 'stop_triggered' || event.type === 'stop_queued')
  && event.stop_id === 'story-2'
)));

session = completeOriginalStop(
  session,
  'story-2',
  allStopIds,
  recordedSample('story_2_duplicate_after_restart').timestamp_ms + 1,
);
assert.equal(session.status, 'active');

replay('story_3_arm');
assert.equal(session.trigger_state.candidate_stop_id, 'story-3');
evaluation = replay('story_3_trigger');
assert.equal(session.current_stop_id, 'story-3');
assert(evaluation.events.some(event => event.type === 'stop_triggered' && event.stop_id === 'story-3'));

session = completeOriginalStop(
  session,
  'story-3',
  allStopIds,
  recordedSample('story_3_trigger').timestamp_ms + 1,
);
assert.equal(session.status, 'completed', 'completed plus mid-route missed stories closes the tour');
assert.deepEqual(session.completed_stop_ids, ['story-2', 'story-3']);
assert.deepEqual(session.missed_stop_ids, ['story-1']);

evaluation = replay('after_completion');
assert.equal(evaluation.events.length, 0, 'completed sessions ignore later recorded fixes');
assert.deepEqual(session.triggered_stop_ids, ['story-2', 'story-3']);
assert.equal(
  events.filter(event => event.type === 'stop_triggered').length,
  2,
  'the trace emits one trigger for each story reached',
);

console.log('Originals recorded GPS trace tests passed.');
