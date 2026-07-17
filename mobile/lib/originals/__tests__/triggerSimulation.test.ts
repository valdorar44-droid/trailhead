import assert from 'node:assert/strict';
import { validateOriginalManifest } from '../manifest';
import { createOriginalSession } from '../session';
import { evaluateOriginalLocation } from '../triggerEngine';
import { originalSimulationSamplesForNextCue } from '../triggerSimulation';
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

console.log('Originals trigger simulation tests passed.');
