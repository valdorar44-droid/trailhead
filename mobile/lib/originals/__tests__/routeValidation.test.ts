import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  canonicalOriginalRouteGeometry,
  ORIGINAL_ROUTE_VALIDATION_SCENARIO_IDS,
  runOriginalRouteValidation,
} from '../routeValidation';
import { originalManifest } from './fixtures';

const manifest = originalManifest();
manifest.stops = manifest.stops.map(stop => ({ ...stop, audio_duration_s: 5 }));
manifest.route.geometry.coordinates = [[0, 0], [0.01, 0], [0.02, 0]];

const report = runOriginalRouteValidation(manifest);
assert.deepEqual(report.scenarios.map(scenario => scenario.id), ORIGINAL_ROUTE_VALIDATION_SCENARIO_IDS);
assert.equal(report.summary.required, ORIGINAL_ROUTE_VALIDATION_SCENARIO_IDS.length);
assert.equal(report.summary.stop_count, manifest.stops.length);
assert.equal(report.passed, true, JSON.stringify(
  report.scenarios.filter(scenario => !scenario.passed).map(scenario => ({
    id: scenario.id,
    issues: scenario.issues,
  })),
  null,
  2,
));
assert(report.scenarios.every(scenario => scenario.metrics.terminal === true));
assert(report.scenarios.every(scenario => scenario.stops.length === manifest.stops.length));
assert.deepEqual(
  report.scenarios.filter(scenario => scenario.id.startsWith('baseline_')).map(scenario => scenario.metrics.speed_mph),
  [15, 36, 65],
);
assert(Number(report.scenarios.find(scenario => scenario.id === 'poor_accuracy_recovery')?.metrics.poor_accuracy_decisions ?? 0) > 0);
assert(Number(report.scenarios.find(scenario => scenario.id === 'off_route_rejoin')?.metrics.off_route_decisions ?? 0) > 0);
assert(Number(report.scenarios.find(scenario => scenario.id === 'off_route_rejoin')?.metrics.off_route_decisions ?? 0) >= 3);
assert.equal(report.scenarios.find(scenario => scenario.id === 'off_route_rejoin')?.metrics.rejoin_transition_count, 1);
assert(Number(report.scenarios.find(scenario => scenario.id === 'reverse_travel')?.metrics.route_span_m ?? 0) >= manifest.route.distance_m * 0.9);
assert(Number(report.scenarios.find(scenario => scenario.id === 'delayed_out_of_order_fixes')?.metrics.stale_fix_decisions ?? 0) > 0);
assert.equal(report.scenarios.find(scenario => scenario.id === 'overlapping_audio_queue')?.metrics.queue_exercised, true);

const expectedGeometryHash = createHash('sha256')
  .update(canonicalOriginalRouteGeometry(manifest), 'ascii')
  .digest('hex');
assert.equal(report.route_summary.geometry_sha256, expectedGeometryHash);
assert.equal(report.route_summary.coordinate_count, 3);
assert.equal(report.route_summary.discontinuity_count, 0);
assert.equal(report.route_summary.stop_projection_failures, 0);
assert.deepEqual(runOriginalRouteValidation(manifest), report, 'the report is deterministic');

const cli = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/validate-original-route.ts'],
  {
    cwd: process.cwd(),
    input: JSON.stringify({
      schema_version: 1,
      manifest,
      options: { validator_source_sha256: 'a'.repeat(64) },
    }),
    encoding: 'utf8',
  },
);
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(JSON.parse(cli.stdout), {
  ...report,
  validator_source_sha256: 'a'.repeat(64),
});

const invalid = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/validate-original-route.ts'],
  { cwd: process.cwd(), input: '{}', encoding: 'utf8' },
);
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /schema_version/);

const repeatedRoute = originalManifest();
repeatedRoute.route.geometry.coordinates = [[0, 0], [0.02, 0], [0, 0], [0, 0.02]];
repeatedRoute.route.distance_m = 6_672;
repeatedRoute.route.bounds = { north: 0.02, south: 0, east: 0.02, west: 0 };
repeatedRoute.offline_map.bounds = { ...repeatedRoute.route.bounds };
repeatedRoute.stops = repeatedRoute.stops.map((stop, index) => ({
  ...stop,
  audio_duration_s: 5,
  coordinates: index === 0
    ? { lat: 0, lng: 0.005 }
    : index === 1
      ? { lat: 0, lng: 0.019 }
      : { lat: 0, lng: 0.015 },
  trigger: index === 0
    ? { ...stop.trigger, route_progress_start_m: 400, route_progress_end_m: 700, approach_bearing_deg: 90, bearing_tolerance_deg: 30 }
    : index === 1
      ? { ...stop.trigger, route_progress_start_m: 1_950, route_progress_end_m: 2_240, approach_bearing_deg: 90, bearing_tolerance_deg: 30 }
      : { ...stop.trigger, route_progress_start_m: 2_650, route_progress_end_m: 2_900, approach_bearing_deg: 270, bearing_tolerance_deg: 30 },
}));
const repeatedReport = runOriginalRouteValidation(repeatedRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
const repeatedScenario = repeatedReport.scenarios[0];
assert((repeatedScenario.metrics.near_repeated_position_count as number) > 0);
assert((repeatedScenario.metrics.projection_case_count as number) > 0);
assert.equal(repeatedScenario.metrics.synthetic_control_passed, true);

repeatedRoute.stops[2].trigger.approach_bearing_deg = undefined;
repeatedRoute.stops[2].trigger.bearing_tolerance_deg = undefined;
const missingBearing = runOriginalRouteValidation(repeatedRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
assert.equal(missingBearing.passed, false);
assert(missingBearing.scenarios[0].issues.some(issue => /direction gate/.test(issue)));

const sameDirectionRoute = originalManifest();
sameDirectionRoute.route.geometry.coordinates = [
  [0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0], [0.02, 0],
];
sameDirectionRoute.route.distance_m = 11_120;
sameDirectionRoute.route.bounds = { north: 0.02, south: 0, east: 0.02, west: 0 };
sameDirectionRoute.offline_map.bounds = { ...sameDirectionRoute.route.bounds };
sameDirectionRoute.stops = sameDirectionRoute.stops.map(stop => ({ ...stop, audio_duration_s: 5 }));
const sameDirectionReport = runOriginalRouteValidation(sameDirectionRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
const sameDirectionScenario = sameDirectionReport.scenarios[0];
assert(Number(sameDirectionScenario.metrics.same_direction_repeated_position_count ?? 0) > 0);
assert(Number(sameDirectionScenario.metrics.same_direction_projection_failure_count ?? 0) === 0);
assert.equal(sameDirectionScenario.metrics.synthetic_same_direction_control_passed, true);
assert.equal(sameDirectionScenario.metrics.missing_bearing_gate_count, 0, 'same-direction repeats rely on continuity rather than an unnecessary bearing gate');

console.log('Originals continuous route-validation tests passed.');
