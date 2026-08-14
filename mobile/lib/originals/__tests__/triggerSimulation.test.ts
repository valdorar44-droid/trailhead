import assert from 'node:assert/strict';
import { validateOriginalManifest } from '../manifest';
import { createOriginalSession } from '../session';
import { evaluateOriginalLocation } from '../triggerEngine';
import { originalSimulationSamplesForNextCue } from '../triggerSimulation';
import {
  createOriginalVirtualDriveLabState,
  nextOriginalVirtualDriveCueProgress,
  ORIGINAL_VIRTUAL_DRIVE_OFF_ROUTE_M,
  originalVirtualDriveCueResultOutcome,
  originalVirtualDriveCueStatuses,
  seekOriginalVirtualDriveLab,
  tickOriginalVirtualDriveLab,
  updateOriginalVirtualDriveLabState,
} from '../virtualDriveLab';
import type { OriginalManifestV1, OriginalSessionV1 } from '../types';
import { originalManifest } from './fixtures';

function activeSession(manifest: OriginalManifestV1): OriginalSessionV1 {
  return { ...createOriginalSession(manifest, 'guest', 0), status: 'active' };
}

const manifest = validateOriginalManifest(originalManifest());
const session = activeSession(manifest);
const simulation = originalSimulationSamplesForNextCue(manifest, session);
assert.ok(simulation);
assert.equal(simulation.stop.id, 'story-1');
assert.equal(simulation.stop_id, 'story-1');
assert.ok(simulation.target_route_progress_m >= simulation.stop.trigger.route_progress_start_m);
assert.ok(simulation.target_route_progress_m <= simulation.stop.trigger.route_progress_end_m);
assert.ok(simulation.distance_to_stop_m <= simulation.stop.trigger.enter_radius_m);
assert.ok(simulation.samples[1].timestamp_ms - simulation.samples[0].timestamp_ms > 3_000);
assert.equal(simulation.route_heading_deg, 90);
assert.deepEqual(
  originalSimulationSamplesForNextCue(manifest, session),
  simulation,
  'the same manifest and session produce deterministic fixes',
);

const first = evaluateOriginalLocation(manifest, session, simulation.samples[0]);
assert.equal(first.decision.code, 'armed');
assert.ok(Math.abs((first.projected_route_progress_m ?? 0) - simulation.target_route_progress_m) < 1);
const second = evaluateOriginalLocation(manifest, first.session, simulation.samples[1]);
assert.equal(second.decision.code, 'triggered');
assert.equal(second.session.current_stop_id, 'story-1');

const nextSession: OriginalSessionV1 = {
  ...activeSession(manifest),
  triggered_stop_ids: ['story-1'],
  completed_stop_ids: ['story-1'],
};
assert.equal(originalSimulationSamplesForNextCue(manifest, nextSession)?.stop_id, 'story-2');

const canonicalManifest = originalManifest();
canonicalManifest.route.distance_m = 4_448;
canonicalManifest.stops[0].trigger.route_progress_start_m = 900;
canonicalManifest.stops[0].trigger.route_progress_end_m = 1_100;
const canonicalSimulation = originalSimulationSamplesForNextCue(
  canonicalManifest,
  activeSession(canonicalManifest),
);
assert.ok(canonicalSimulation);
const canonicalFirst = evaluateOriginalLocation(
  canonicalManifest,
  activeSession(canonicalManifest),
  canonicalSimulation.samples[0],
);
assert.ok(Math.abs(
  (canonicalFirst.projected_route_progress_m ?? 0) - canonicalSimulation.target_route_progress_m,
) < 1, 'synthetic route coordinates preserve canonical manifest progress when geometry length differs');

const badRadiusManifest = originalManifest();
badRadiusManifest.stops[0].coordinates.lat = 0.004;
badRadiusManifest.stops[0].trigger.enter_radius_m = 100;
badRadiusManifest.stops[0].trigger.exit_radius_m = 150;
const badRadiusSimulation = originalSimulationSamplesForNextCue(
  badRadiusManifest,
  activeSession(badRadiusManifest),
);
assert.ok(badRadiusSimulation);
assert.ok(badRadiusSimulation.distance_to_stop_m > badRadiusSimulation.stop.trigger.enter_radius_m);
const badRadiusResult = evaluateOriginalLocation(
  badRadiusManifest,
  activeSession(badRadiusManifest),
  badRadiusSimulation.samples[0],
);
assert.equal(badRadiusResult.decision.code, 'outside_radius');
assert.equal(badRadiusResult.session.trigger_state.candidate_stop_id, null);

const badBearingManifest = originalManifest();
badBearingManifest.stops[0].trigger.approach_bearing_deg = 270;
badBearingManifest.stops[0].trigger.bearing_tolerance_deg = 20;
const badBearingSimulation = originalSimulationSamplesForNextCue(
  badBearingManifest,
  activeSession(badBearingManifest),
);
assert.ok(badBearingSimulation);
assert.equal(badBearingSimulation.route_heading_deg, 90, 'simulation uses route travel heading, not the authored requirement');
const badBearingResult = evaluateOriginalLocation(
  badBearingManifest,
  activeSession(badBearingManifest),
  badBearingSimulation.samples[0],
);
assert.equal(badBearingResult.decision.code, 'wrong_bearing');
assert.equal(badBearingResult.decision.bearing?.difference_deg, 180);

const completeSession: OriginalSessionV1 = {
  ...activeSession(manifest),
  triggered_stop_ids: manifest.stops.map(stop => stop.id),
};
assert.equal(originalSimulationSamplesForNextCue(manifest, completeSession), null);

const pausedDrive = createOriginalVirtualDriveLabState(manifest, {
  progress_m: 300,
  speed_mps: 20,
  synthetic_timestamp_ms: 1_000,
});
const pausedTick = tickOriginalVirtualDriveLab(manifest, pausedDrive, 3_100);
assert.strictEqual(pausedTick.state, pausedDrive, 'a paused route clock is side-effect free');
assert.equal(pausedTick.sample, null);

let continuousDrive = updateOriginalVirtualDriveLabState(manifest, pausedDrive, { playing: true });
const continuousFirst = tickOriginalVirtualDriveLab(manifest, continuousDrive, 3_100);
assert.ok(continuousFirst.sample);
assert.equal(continuousFirst.sample.accuracy_m, 10);
assert.equal(continuousFirst.sample.heading_deg, 90);
assert(continuousFirst.state.progress_m > pausedDrive.progress_m);
const continuousFirstEvaluation = evaluateOriginalLocation(
  manifest,
  activeSession(manifest),
  continuousFirst.sample,
);
assert.equal(continuousFirstEvaluation.decision.code, 'armed');

const continuousSecond = tickOriginalVirtualDriveLab(manifest, continuousFirst.state, 3_100);
assert.ok(continuousSecond.sample);
const continuousSecondEvaluation = evaluateOriginalLocation(
  manifest,
  continuousFirstEvaluation.session,
  continuousSecond.sample,
);
assert.equal(continuousSecondEvaluation.decision.code, 'triggered');
assert.equal(continuousSecondEvaluation.session.current_stop_id, 'story-1');

const poorGpsDrive = updateOriginalVirtualDriveLabState(manifest, continuousFirst.state, {
  gps_quality: 'poor',
});
const poorGpsTick = tickOriginalVirtualDriveLab(manifest, poorGpsDrive, 3_100);
assert.ok(poorGpsTick.sample);
assert.equal(poorGpsTick.sample.accuracy_m, 150);
assert.equal(
  evaluateOriginalLocation(manifest, activeSession(manifest), poorGpsTick.sample).decision.code,
  'poor_accuracy',
);

const offRouteDrive = updateOriginalVirtualDriveLabState(manifest, continuousFirst.state, {
  off_route_m: ORIGINAL_VIRTUAL_DRIVE_OFF_ROUTE_M,
});
const offRouteTick = tickOriginalVirtualDriveLab(manifest, offRouteDrive, 3_100);
assert.ok(offRouteTick.sample);
assert.equal(
  evaluateOriginalLocation(manifest, activeSession(manifest), offRouteTick.sample).decision.code,
  'off_route',
);

const reverseDrive = updateOriginalVirtualDriveLabState(manifest, continuousFirst.state, {
  direction: 'reverse',
});
const reverseTick = tickOriginalVirtualDriveLab(manifest, reverseDrive, 3_100);
assert.ok(reverseTick.sample);
assert(reverseTick.state.progress_m < reverseDrive.progress_m);
assert.equal(reverseTick.sample.heading_deg, 270);

assert.equal(seekOriginalVirtualDriveLab(manifest, pausedDrive, -1).progress_m, 0);
assert.equal(
  seekOriginalVirtualDriveLab(manifest, pausedDrive, manifest.route.distance_m + 1).progress_m,
  manifest.route.distance_m,
);
const cueStatuses = originalVirtualDriveCueStatuses(
  manifest,
  continuousSecondEvaluation.session,
  continuousSecond.state,
);
assert.equal(cueStatuses[0].status, 'playing');
assert.equal(cueStatuses[1].status, 'ahead');
const fifoCueStatuses = originalVirtualDriveCueStatuses(
  manifest,
  {
    ...continuousSecondEvaluation.session,
    triggered_stop_ids: manifest.stops.map(stop => stop.id),
    pending_stop_ids: ['story-2', 'story-3'],
    queued_stop_id: 'story-2',
  },
  continuousSecond.state,
);
assert.deepEqual(
  fifoCueStatuses.map(cue => cue.status),
  ['playing', 'queued', 'queued'],
  'the validation lab marks every canonical FIFO entry as queued',
);
assert.equal(
  nextOriginalVirtualDriveCueProgress(
    manifest,
    continuousSecondEvaluation.session,
    continuousSecond.state,
  ),
  manifest.stops[1].trigger.route_progress_start_m,
);

const pausedAfterTwoHeard = (['triggered', 'queued', 'before_window'] as const)
  .map(originalVirtualDriveCueResultOutcome)
  .filter((outcome): outcome is 'passed' | 'failed' => outcome != null);
assert.equal(
  pausedAfterTwoHeard.filter(outcome => outcome === 'passed').length,
  2,
  'cues 1-2 remain passed when cue 3 is still ahead',
);
assert.equal(
  pausedAfterTwoHeard.filter(outcome => outcome === 'failed').length,
  0,
  'pausing with cue 3 before its window must not add a blocked result',
);
assert.equal(pausedAfterTwoHeard.length, 2, 'only exercised cues count as reviewed');
for (const failureCode of [
  'after_window',
  'outside_radius',
  'missing_bearing',
  'wrong_bearing',
] as const) {
  assert.equal(
    originalVirtualDriveCueResultOutcome(failureCode),
    'failed',
    `${failureCode} remains a failed cue result`,
  );
}

console.log('Originals trigger simulation tests passed.');
