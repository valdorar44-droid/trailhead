import assert from 'node:assert/strict';
import { validateOriginalManifest } from '../manifest';
import { createOriginalSession } from '../session';
import { evaluateOriginalLocation } from '../triggerEngine';
import type {
  OriginalLocationSample,
  OriginalManifestV1,
  OriginalSessionV1,
  OriginalTriggerDecisionCode,
  OriginalTriggerEvaluation,
} from '../types';
import { originalManifest } from './fixtures';

const manifest = validateOriginalManifest(originalManifest());

function activeSession(value: OriginalManifestV1 = manifest): OriginalSessionV1 {
  return { ...createOriginalSession(value, 'guest', 0), status: 'active' };
}

function sample(
  lng: number,
  timestampMs = 1_000,
  overrides: Partial<OriginalLocationSample> = {},
): OriginalLocationSample {
  return {
    lat: 0,
    lng,
    accuracy_m: 10,
    heading_deg: 90,
    speed_mps: 12,
    timestamp_ms: timestampMs,
    ...overrides,
  };
}

function expectDecision(result: OriginalTriggerEvaluation, code: OriginalTriggerDecisionCode) {
  assert.equal(result.decision.code, code);
  assert.ok(result.decision.message.trim(), `${code} includes a human-readable explanation`);
}

expectDecision(evaluateOriginalLocation(manifest, createOriginalSession(manifest, 'guest', 0), sample(0.0045)), 'inactive');
expectDecision(evaluateOriginalLocation(manifest, { ...activeSession(), user_paused: true }, sample(0.0045)), 'user_paused');
expectDecision(evaluateOriginalLocation(manifest, { ...activeSession(), status: 'completed' }, sample(0.0045)), 'complete');

const poorAccuracy = evaluateOriginalLocation(manifest, activeSession(), sample(0.0045, 1_000, { accuracy_m: 150 }));
expectDecision(poorAccuracy, 'poor_accuracy');
assert.deepEqual(poorAccuracy.decision.accuracy, { actual_m: 150, maximum_m: 100 });

const unavailableManifest = originalManifest();
unavailableManifest.route.geometry.coordinates = [];
expectDecision(evaluateOriginalLocation(unavailableManifest, activeSession(unavailableManifest), sample(0.0045)), 'route_unavailable');

const offRoute = evaluateOriginalLocation(manifest, activeSession(), sample(0.0045, 1_000, { lat: 0.01 }));
expectDecision(offRoute, 'off_route');
assert.ok((offRoute.decision.route.distance_from_route_m ?? 0) > 500);

const beforeWindow = evaluateOriginalLocation(manifest, activeSession(), sample(0.001));
expectDecision(beforeWindow, 'before_window');
assert.equal(beforeWindow.decision.stop_id, 'story-1');
assert.deepEqual(beforeWindow.decision.window, {
  authored_start_m: 350,
  effective_start_m: 350,
  end_m: 700,
});

const afterWindow = evaluateOriginalLocation(manifest, activeSession(), sample(0.0064));
expectDecision(afterWindow, 'after_window');
assert.ok((afterWindow.decision.route.projected_progress_m ?? 0) > 700);

const outsideRadius = evaluateOriginalLocation(
  manifest,
  activeSession(),
  sample(0.0045, 1_000, { lat: 0.003 }),
);
expectDecision(outsideRadius, 'outside_radius');
assert.ok((outsideRadius.decision.radius?.distance_to_stop_m ?? 0) > 250);

const directedManifest = originalManifest();
directedManifest.stops[0].trigger.approach_bearing_deg = 90;
directedManifest.stops[0].trigger.bearing_tolerance_deg = 20;
const missingBearing = evaluateOriginalLocation(
  directedManifest,
  activeSession(directedManifest),
  sample(0.0045, 1_000, { heading_deg: null }),
);
expectDecision(missingBearing, 'missing_bearing');
const wrongBearing = evaluateOriginalLocation(
  directedManifest,
  {
    ...activeSession(directedManifest),
    last_projected_route_progress_m: 400,
    trigger_state: {
      ...activeSession(directedManifest).trigger_state,
      route_initialized: true,
    },
  },
  sample(0.0045, 1_000, { heading_deg: 270 }),
);
expectDecision(wrongBearing, 'wrong_bearing');
assert.deepEqual(wrongBearing.decision.bearing, {
  actual_deg: 270,
  required_deg: 90,
  tolerance_deg: 20,
  difference_deg: 180,
});

const armed = evaluateOriginalLocation(manifest, activeSession(), sample(0.0045, 1_000));
expectDecision(armed, 'armed');
assert.deepEqual(armed.decision.wait, {
  sample_count: 1,
  required_sample_count: 2,
  elapsed_ms: 0,
  required_elapsed_ms: 3_000,
});

const waitingForDwell = evaluateOriginalLocation(manifest, armed.session, sample(0.0045, 2_000));
expectDecision(waitingForDwell, 'waiting_for_dwell');
assert.equal(waitingForDwell.decision.wait?.elapsed_ms, 1_000);

const threeFixArmed = evaluateOriginalLocation(
  manifest,
  activeSession(),
  sample(0.0045, 1_000),
  { minimum_inside_samples: 3 },
);
const waitingForFixes = evaluateOriginalLocation(
  manifest,
  threeFixArmed.session,
  sample(0.0045, 4_100),
  { minimum_inside_samples: 3 },
);
expectDecision(waitingForFixes, 'waiting_for_fixes');
assert.equal(waitingForFixes.decision.wait?.sample_count, 2);

const triggered = evaluateOriginalLocation(manifest, armed.session, sample(0.0045, 4_100));
expectDecision(triggered, 'triggered');
assert.equal(triggered.decision.stop_id, 'story-1');

const playingSession = { ...activeSession(), current_stop_id: 'manual-story' };
const queuedArmed = evaluateOriginalLocation(manifest, playingSession, sample(0.0045, 1_000));
const queued = evaluateOriginalLocation(manifest, queuedArmed.session, sample(0.0045, 4_100));
expectDecision(queued, 'queued');
assert.equal(queued.session.queued_stop_id, 'story-1');

const queueTailArmed = evaluateOriginalLocation(
  manifest,
  {
    ...activeSession(),
    current_stop_id: 'story-1',
    pending_stop_ids: ['story-2'],
    queued_stop_id: 'story-2',
    triggered_stop_ids: ['story-1', 'story-2'],
  },
  sample(0.0162, 1_000),
);
expectDecision(queueTailArmed, 'armed');
const queueTail = evaluateOriginalLocation(
  manifest,
  queueTailArmed.session,
  sample(0.0162, 4_100),
);
expectDecision(queueTail, 'queued');
assert.equal(queueTail.decision.stop_id, 'story-3');
assert.deepEqual(queueTail.session.pending_stop_ids, ['story-2', 'story-3']);
assert.equal(queueTail.session.queued_stop_id, 'story-2');

const noRemaining = evaluateOriginalLocation(
  manifest,
  {
    ...activeSession(),
    current_stop_id: 'story-3',
    triggered_stop_ids: ['story-1', 'story-2', 'story-3'],
  },
  sample(0.0162),
);
expectDecision(noRemaining, 'no_remaining_stops');

const missed = evaluateOriginalLocation(manifest, activeSession(), sample(0.0199));
expectDecision(missed, 'missed');
assert.deepEqual(missed.decision.missed_stop_ids, ['story-1', 'story-2', 'story-3']);
assert.equal(missed.decision.session_status, 'completed');

console.log('Originals trigger diagnostic tests passed.');
