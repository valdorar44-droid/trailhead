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
assert.equal(report.scenarios.find(scenario => scenario.id === 'gps_jitter')?.metrics.jitter_accuracy_m, 90);
assert(Number(report.scenarios.find(scenario => scenario.id === 'off_route_rejoin')?.metrics.off_route_decisions ?? 0) > 0);
assert(Number(report.scenarios.find(scenario => scenario.id === 'off_route_rejoin')?.metrics.off_route_decisions ?? 0) >= 3);
assert.equal(report.scenarios.find(scenario => scenario.id === 'off_route_rejoin')?.metrics.rejoin_transition_count, 1);
assert(Number(report.scenarios.find(scenario => scenario.id === 'reverse_travel')?.metrics.route_span_m ?? 0) >= manifest.route.distance_m * 0.9);
assert.equal(report.scenarios.find(scenario => scenario.id === 'reverse_travel')?.metrics.triggered_count, 0);
assert.equal(report.scenarios.find(scenario => scenario.id === 'reverse_travel')?.metrics.missed_count, manifest.stops.length - 1);
assert(Number(report.scenarios.find(scenario => scenario.id === 'delayed_out_of_order_fixes')?.metrics.stale_fix_decisions ?? 0) > 0);
assert.equal(report.scenarios.find(scenario => scenario.id === 'overlapping_audio_queue')?.metrics.queue_exercised, true);

const unsafeQueueSpacingManifest = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
unsafeQueueSpacingManifest.stops[0].audio_duration_s = 72;
unsafeQueueSpacingManifest.stops[1].audio_duration_s = 8;
const unsafeQueueSpacingReport = runOriginalRouteValidation(unsafeQueueSpacingManifest, {
  scenario_ids: ['overlapping_audio_queue'],
});
assert.equal(unsafeQueueSpacingReport.passed, false);
assert(
  Number(
    unsafeQueueSpacingReport.scenarios[0].metrics.queue_spacing_violation_count,
  ) > 0,
  'eligibility is detected when the following cue arms, even if queued narration ends before its trigger fix',
);
assert(
  unsafeQueueSpacingReport.scenarios[0].issues.some(issue => (
    /before queued narration finished/.test(issue)
  )),
);

const queueFullEligibilityManifest = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
queueFullEligibilityManifest.stops[0].audio_duration_s = 90;
queueFullEligibilityManifest.stops[1].audio_duration_s = 1;
const queueFullEligibilityReport = runOriginalRouteValidation(queueFullEligibilityManifest, {
  scenario_ids: ['overlapping_audio_queue'],
});
assert.equal(queueFullEligibilityReport.passed, false);
assert(
  Number(queueFullEligibilityReport.scenarios[0].metrics.queue_spacing_violation_count) > 0,
  'queue-full diagnostics expose a following cue while the prior story is still queued',
);

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

repeatedRoute.stops[2].trigger.bearing_tolerance_deg = 180;
const ineffectiveBearing = runOriginalRouteValidation(repeatedRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
assert.equal(ineffectiveBearing.passed, false);
assert(ineffectiveBearing.scenarios[0].issues.some(issue => /does not separate/.test(issue)));
repeatedRoute.stops[2].trigger.bearing_tolerance_deg = 30;

const originalRepeatedWindow = {
  start: repeatedRoute.stops[2].trigger.route_progress_start_m,
  end: repeatedRoute.stops[2].trigger.route_progress_end_m,
};
repeatedRoute.stops[2].trigger.route_progress_start_m = 1_400;
repeatedRoute.stops[2].trigger.route_progress_end_m = 3_000;
const multipleOccurrenceWindow = runOriginalRouteValidation(repeatedRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
assert.equal(multipleOccurrenceWindow.passed, false);
assert(Number(multipleOccurrenceWindow.scenarios[0].metrics.multiple_occurrence_window_count) > 0);
assert(multipleOccurrenceWindow.scenarios[0].issues.some(issue => /multiple repeated route occurrences/.test(issue)));
repeatedRoute.stops[2].trigger.route_progress_start_m = originalRepeatedWindow.start;
repeatedRoute.stops[2].trigger.route_progress_end_m = originalRepeatedWindow.end;

repeatedRoute.stops[2].trigger.approach_bearing_deg = undefined;
repeatedRoute.stops[2].trigger.bearing_tolerance_deg = undefined;
const missingBearing = runOriginalRouteValidation(repeatedRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
assert.equal(missingBearing.passed, false);
assert(missingBearing.scenarios[0].issues.some(issue => /direction gate/.test(issue)));

const betweenSampleCrossingRoute = originalManifest();
betweenSampleCrossingRoute.route.geometry.coordinates = [
  [-0.006, -0.006], [0.006, 0.006], [-0.006, 0.006], [0.006, -0.006],
];
betweenSampleCrossingRoute.route.distance_m = 5_110;
betweenSampleCrossingRoute.route.bounds = { north: 0.006, south: -0.006, east: 0.006, west: -0.006 };
betweenSampleCrossingRoute.offline_map.bounds = { ...betweenSampleCrossingRoute.route.bounds };
betweenSampleCrossingRoute.stops = betweenSampleCrossingRoute.stops.map((stop, index) => ({
  ...stop,
  audio_duration_s: 5,
  coordinates: index === 1 ? { lat: 0.006, lng: 0 } : { lat: 0, lng: 0 },
  trigger: index === 0
    ? { ...stop.trigger, route_progress_start_m: 800, route_progress_end_m: 1_100, approach_bearing_deg: undefined, bearing_tolerance_deg: undefined }
    : index === 1
      ? { ...stop.trigger, route_progress_start_m: 2_350, route_progress_end_m: 2_750, approach_bearing_deg: 270, bearing_tolerance_deg: 35 }
      : { ...stop.trigger, route_progress_start_m: 4_000, route_progress_end_m: 4_300, approach_bearing_deg: 135, bearing_tolerance_deg: 35 },
}));
const betweenSampleCrossingReport = runOriginalRouteValidation(betweenSampleCrossingRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
assert(Number(betweenSampleCrossingReport.route_summary.self_intersection_count) > 0);
assert(
  betweenSampleCrossingReport.scenarios[0].issues.some(issue => /story-1 needs a direction gate/.test(issue)),
  '25 metre sampling detects a crossing located between sampled progress points',
);

const tinyRadiusCrossingRoute = JSON.parse(
  JSON.stringify(betweenSampleCrossingRoute),
) as typeof betweenSampleCrossingRoute;
tinyRadiusCrossingRoute.stops[0].trigger.enter_radius_m = 1;
tinyRadiusCrossingRoute.stops[0].trigger.exit_radius_m = 51;
const tinyRadiusCrossingReport = runOriginalRouteValidation(tinyRadiusCrossingRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
assert(
  tinyRadiusCrossingReport.scenarios[0].issues.some(issue => (
    /story-1 needs a direction gate/.test(issue)
  )),
  'exact stop-to-segment projections detect a one metre cue between regular trace samples',
);

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

const nearbyUncertainRoute = originalManifest();
nearbyUncertainRoute.route.geometry.coordinates = [
  [0, 0], [0.016, 0], [0.016, 0.001], [0, 0.001],
];
nearbyUncertainRoute.route.distance_m = 3_670;
nearbyUncertainRoute.route.bounds = { north: 0.001, south: 0, east: 0.016, west: 0 };
nearbyUncertainRoute.offline_map.bounds = { ...nearbyUncertainRoute.route.bounds };
nearbyUncertainRoute.stops = nearbyUncertainRoute.stops.map((stop, index) => ({
  ...stop,
  audio_duration_s: 5,
  coordinates: index === 0
    ? { lat: 0, lng: 0.004 }
    : index === 1
      ? { lat: 0, lng: 0.012 }
      : { lat: 0.001, lng: 0.008 },
  trigger: index === 0
    ? { ...stop.trigger, route_progress_start_m: 300, route_progress_end_m: 600, approach_bearing_deg: undefined, bearing_tolerance_deg: undefined }
    : index === 1
      ? { ...stop.trigger, route_progress_start_m: 1_150, route_progress_end_m: 1_500, approach_bearing_deg: undefined, bearing_tolerance_deg: undefined }
      : { ...stop.trigger, route_progress_start_m: 2_550, route_progress_end_m: 3_050, approach_bearing_deg: undefined, bearing_tolerance_deg: undefined },
}));
const nearbyUncertainReport = runOriginalRouteValidation(nearbyUncertainRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
assert.equal(nearbyUncertainReport.passed, false);
assert(Number(nearbyUncertainReport.scenarios[0].metrics.missing_bearing_gate_count) > 0);
assert(
  nearbyUncertainReport.scenarios[0].issues.some(issue => /direction gate/.test(issue)),
  'route legs inside twice the accepted GPS accuracy remain ambiguity risks',
);

const smallRadiusUncertainRoute = JSON.parse(
  JSON.stringify(nearbyUncertainRoute),
) as typeof nearbyUncertainRoute;
smallRadiusUncertainRoute.stops = smallRadiusUncertainRoute.stops.map(stop => ({
  ...stop,
  trigger: {
    ...stop.trigger,
    enter_radius_m: 50,
    exit_radius_m: 100,
  },
}));
const smallRadiusUncertainReport = runOriginalRouteValidation(smallRadiusUncertainRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
assert(
  Number(smallRadiusUncertainReport.scenarios[0].metrics.missing_bearing_gate_count) > 0,
  'ambiguity detection uses accepted GPS error even when every authored cue radius is small',
);

const multipleCompetitorRoute = originalManifest();
multipleCompetitorRoute.route.geometry.coordinates = [
  [0.01, 0], [0, 0], [0, -0.005], [0.01, 0.005], [0, 0], [0.01, 0],
];
multipleCompetitorRoute.route.distance_m = 5_596;
multipleCompetitorRoute.route.bounds = { north: 0.005, south: -0.005, east: 0.01, west: 0 };
multipleCompetitorRoute.offline_map.bounds = { ...multipleCompetitorRoute.route.bounds };
multipleCompetitorRoute.stops = [{
  ...multipleCompetitorRoute.stops[0],
  audio_duration_s: 5,
  coordinates: { lat: 0, lng: 0.005 },
  trigger: {
    ...multipleCompetitorRoute.stops[0].trigger,
    route_progress_start_m: 4_850,
    route_progress_end_m: 5_250,
    approach_bearing_deg: 90,
    bearing_tolerance_deg: 50,
  },
}];
const multipleCompetitorReport = runOriginalRouteValidation(multipleCompetitorRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
assert(
  Number(multipleCompetitorReport.scenarios[0].metrics.ineffective_bearing_gate_count) > 0,
  `a gate must reject every distinct competing approach, not only the nearest representative pair: ${JSON.stringify(multipleCompetitorReport.scenarios[0])}`,
);

const highLatitudeRoute = originalManifest();
highLatitudeRoute.route.geometry.coordinates = [[-110, 70], [-109.98, 70]];
highLatitudeRoute.route.bounds = { north: 70.01, south: 69.99, east: -109.98, west: -110 };
highLatitudeRoute.offline_map.bounds = { ...highLatitudeRoute.route.bounds };
highLatitudeRoute.stops = highLatitudeRoute.stops.map(stop => ({
  ...stop,
  audio_duration_s: 5,
  coordinates: { lat: 70, lng: -110 + stop.coordinates.lng },
}));
const highLatitudeControl = runOriginalRouteValidation(highLatitudeRoute, {
  scenario_ids: ['self_intersection_ambiguity'],
});
assert.equal(
  highLatitudeControl.scenarios[0].metrics.synthetic_directional_control_passed,
  true,
  'the directional control derives its distances at high latitude',
);

const opposingJitterRoute = originalManifest();
opposingJitterRoute.route.geometry.coordinates = [
  [0, 0], [0.02, 0], [0.02, 0.0001], [0, 0.0001],
];
opposingJitterRoute.route.distance_m = 4_459;
opposingJitterRoute.route.bounds = { north: 0.001, south: -0.001, east: 0.02, west: 0 };
opposingJitterRoute.offline_map.bounds = { ...opposingJitterRoute.route.bounds };
opposingJitterRoute.stops = opposingJitterRoute.stops.map((stop, index) => ({
  ...stop,
  audio_duration_s: 5,
  coordinates: index === 0
    ? { lat: 0, lng: 0.005 }
    : index === 1
      ? { lat: 0, lng: 0.015 }
      : { lat: 0.0001, lng: 0.01 },
  trigger: index === 0
    ? { ...stop.trigger, route_progress_start_m: 400, route_progress_end_m: 700, approach_bearing_deg: 90, bearing_tolerance_deg: 45 }
    : index === 1
      ? { ...stop.trigger, route_progress_start_m: 1_500, route_progress_end_m: 1_850, approach_bearing_deg: 90, bearing_tolerance_deg: 45 }
      : { ...stop.trigger, route_progress_start_m: 3_150, route_progress_end_m: 3_550, approach_bearing_deg: 270, bearing_tolerance_deg: 45 },
}));
const opposingJitterReport = runOriginalRouteValidation(opposingJitterRoute, {
  scenario_ids: ['gps_jitter'],
});
assert.equal(
  opposingJitterReport.passed,
  true,
  JSON.stringify(opposingJitterReport.scenarios[0].issues),
);
assert.deepEqual(
  opposingJitterReport.scenarios[0].stops.map(stop => stop.trigger_count),
  [1, 1, 1],
);

console.log('Originals continuous route-validation tests passed.');
