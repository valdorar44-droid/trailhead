import { distanceBetweenLngLatMeters, type LngLat } from '../routeProjection';
import { orderedOriginalStops } from './manifest';
import {
  angularDifferenceDegrees,
  ORIGINAL_ROUTE_MAX_HEADING_RECOVERY_SEPARATION_M,
  originalRouteSegmentBearingDegrees,
  projectPointToOriginalRoute,
} from './routeProjection';
import { completeOriginalStop, createOriginalSession } from './session';
import { ORIGINAL_TRIGGER_DEFAULTS, evaluateOriginalLocation } from './triggerEngine';
import type {
  OriginalLocationSample,
  OriginalManifestV1,
  OriginalSessionV1,
  OriginalStopV1,
  OriginalTriggerDecisionCode,
  OriginalTriggerEvaluation,
} from './types';

export const ORIGINAL_ROUTE_VALIDATION_SCHEMA_VERSION = 1 as const;
export const ORIGINAL_ROUTE_VALIDATION_ENGINE_VERSION = 'original-trigger-v2' as const;
export const ORIGINAL_ROUTE_DISCONTINUITY_M = 2_000;
const MAX_AMBIGUOUS_ROUTE_POSITION_SEPARATION_M = ORIGINAL_ROUTE_MAX_HEADING_RECOVERY_SEPARATION_M;

export const ORIGINAL_ROUTE_VALIDATION_SCENARIO_IDS = [
  'baseline_slow_15mph',
  'baseline_cruise_36mph',
  'baseline_highway_65mph',
  'gps_jitter',
  'poor_accuracy_recovery',
  'off_route_rejoin',
  'reverse_travel',
  'mid_route_start',
  'restart_duplicate_prevention',
  'overlapping_audio_queue',
  'drive_by_speed',
  'delayed_out_of_order_fixes',
  'self_intersection_ambiguity',
] as const;

export type OriginalRouteValidationScenarioId = typeof ORIGINAL_ROUTE_VALIDATION_SCENARIO_IDS[number];

export type OriginalRouteValidationStopReport = Readonly<{
  stop_id: string;
  outcome: 'completed' | 'missed' | 'skipped' | 'triggered' | 'not_reached';
  trigger_count: number;
  queue_count: number;
  completed: boolean;
}>;

export type OriginalRouteValidationScenarioReport = Readonly<{
  id: OriginalRouteValidationScenarioId;
  required: true;
  passed: boolean;
  issues: readonly string[];
  metrics: Readonly<Record<string, number | string | boolean | null>>;
  stops: readonly OriginalRouteValidationStopReport[];
}>;

export type OriginalRouteValidationRouteSummary = Readonly<{
  geometry_sha256: string;
  coordinate_count: number;
  distance_m: number;
  maximum_segment_m: number;
  discontinuity_count: number;
  self_intersection_count: number;
  stop_projection_failures: number;
}>;

export type OriginalRouteValidationReportV1 = Readonly<{
  schema_version: typeof ORIGINAL_ROUTE_VALIDATION_SCHEMA_VERSION;
  engine_version: typeof ORIGINAL_ROUTE_VALIDATION_ENGINE_VERSION;
  manifest: Readonly<{ pack_id: string; version: number; manifest_id: string }>;
  passed: boolean;
  summary: Readonly<{ required: number; passed: number; failed: number; stop_count: number }>;
  route_summary: OriginalRouteValidationRouteSummary;
  scenarios: readonly OriginalRouteValidationScenarioReport[];
}>;

export type OriginalRouteValidationOptions = Readonly<{
  scenario_ids?: readonly OriginalRouteValidationScenarioId[];
}>;

type RouteMeasure = {
  coordinates: LngLat[];
  segment_lengths_m: number[];
  cumulative_m: number[];
  total_m: number;
};

type RoutePoint = { coordinate: LngLat; heading_deg: number | null };

type RouteAmbiguity = {
  first_progress_m: number;
  second_progress_m: number;
  first: RoutePoint;
  second: RoutePoint;
  spatial_distance_m: number;
  approach_delta_deg: number;
};

type ScenarioHarness = {
  manifest: OriginalManifestV1;
  session: OriginalSessionV1;
  timestamp_ms: number;
  sample_count: number;
  events: OriginalTriggerEvaluation['events'];
  decisions: Partial<Record<OriginalTriggerDecisionCode, number>>;
  trigger_counts: Map<string, number>;
  queue_counts: Map<string, number>;
  trigger_order: string[];
  audio_end_ms: number | null;
  queued_playback_stop_ids: Set<string>;
  queued_following_pairs: Set<string>;
  maximum_queue_depth: number;
  audio_overlap_count: number;
  projection_regressions: number;
  minimum_authored_trace_progress_m: number | null;
  maximum_authored_trace_progress_m: number | null;
  minimum_projected_progress_m: number | null;
  maximum_projected_progress_m: number | null;
};

const START_TIMESTAMP_MS = 1_700_000_000_000;
const SAMPLE_INTERVAL_MS = 3_100;
const GPS_JITTER_PATTERN_M = [-72, 48, 84, -60, 25, -80, 55] as const;
const GPS_JITTER_ACCURACY_M = 90;
const MAX_ISSUES = 40;
const MAX_ISSUE_LENGTH = 240;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mphToMps(value: number) {
  return value * 0.44704;
}

function normalizedLngDelta(value: number) {
  return ((value + 540) % 360) - 180;
}

function cleanCoordinates(manifest: OriginalManifestV1): LngLat[] {
  return manifest.route.geometry.coordinates.filter(coordinate => (
    Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1])
  ));
}

function measureRoute(manifest: OriginalManifestV1): RouteMeasure {
  const coordinates = cleanCoordinates(manifest);
  const segmentLengths: number[] = [];
  const cumulative = [0];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const length = distanceBetweenLngLatMeters(coordinates[index], coordinates[index + 1]);
    segmentLengths.push(Number.isFinite(length) ? length : 0);
    cumulative.push(cumulative[cumulative.length - 1] + segmentLengths[index]);
  }
  return {
    coordinates,
    segment_lengths_m: segmentLengths,
    cumulative_m: cumulative,
    total_m: cumulative[cumulative.length - 1] ?? 0,
  };
}

function routePointAtProgress(
  manifest: OriginalManifestV1,
  route: RouteMeasure,
  canonicalProgressM: number,
): RoutePoint {
  const canonicalDistance = Math.max(1, manifest.route.distance_m);
  const geometricProgress = clamp(canonicalProgressM / canonicalDistance, 0, 1) * route.total_m;
  let segmentIndex = route.segment_lengths_m.length - 1;
  for (let index = 0; index < route.segment_lengths_m.length; index += 1) {
    if (geometricProgress <= route.cumulative_m[index + 1]) {
      segmentIndex = index;
      break;
    }
  }
  const start = route.coordinates[segmentIndex];
  const end = route.coordinates[segmentIndex + 1];
  const segmentLength = route.segment_lengths_m[segmentIndex] || 1;
  const fraction = clamp((geometricProgress - route.cumulative_m[segmentIndex]) / segmentLength, 0, 1);
  return {
    coordinate: [
      start[0] + normalizedLngDelta(end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ],
    heading_deg: originalRouteSegmentBearingDegrees(start, end),
  };
}

function segmentProjectionFraction(
  point: LngLat,
  start: LngLat,
  end: LngLat,
) {
  const referenceLatitude = (point[1] + start[1] + end[1]) / 3 * Math.PI / 180;
  const longitudeScale = Math.max(1, 111_320 * Math.cos(referenceLatitude));
  const latitudeScale = 111_320;
  const startX = normalizedLngDelta(start[0] - point[0]) * longitudeScale;
  const startY = (start[1] - point[1]) * latitudeScale;
  const endX = normalizedLngDelta(end[0] - point[0]) * longitudeScale;
  const endY = (end[1] - point[1]) * latitudeScale;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const squaredLength = deltaX * deltaX + deltaY * deltaY;
  if (squaredLength <= 0) return 0;
  return clamp(-(startX * deltaX + startY * deltaY) / squaredLength, 0, 1);
}

function nearRepeatedRoutePositions(manifest: OriginalManifestV1, route: RouteMeasure) {
  const sampleStepM = Math.max(25, manifest.route.distance_m / 5_000);
  // Search the complete projection-recovery envelope. Repeated route legs can
  // still be a trigger risk for a small-radius cue when an accepted GPS fix is
  // displaced toward that cue.
  const repeatedPositionRadiusM = MAX_AMBIGUOUS_ROUTE_POSITION_SEPARATION_M;
  const occurrenceByKey = new Map<string, RoutePoint & { progress_m: number }>();
  const addOccurrence = (occurrence: RoutePoint & { progress_m: number }) => {
    const heading = occurrence.heading_deg == null ? 'none' : occurrence.heading_deg.toFixed(4);
    const key = `${occurrence.progress_m.toFixed(3)}:${heading}`;
    occurrenceByKey.set(key, occurrence);
  };
  for (let progress = 0; progress <= manifest.route.distance_m; progress += sampleStepM) {
    addOccurrence({ ...routePointAtProgress(manifest, route, progress), progress_m: progress });
  }
  addOccurrence({
      ...routePointAtProgress(manifest, route, manifest.route.distance_m),
      progress_m: manifest.route.distance_m,
  });
  // Add exact closest points from every cue to every nearby route segment.
  // This closes the sampling gap for small-radius cues centered between the
  // regular 25 metre trace samples without making the whole route grid tiny.
  for (const stop of manifest.stops) {
    const stopCoordinate: LngLat = [stop.coordinates.lng, stop.coordinates.lat];
    const riskRadius = stop.trigger.enter_radius_m
      + ORIGINAL_TRIGGER_DEFAULTS.maximum_accuracy_m;
    for (let segmentIndex = 0; segmentIndex < route.segment_lengths_m.length; segmentIndex += 1) {
      const start = route.coordinates[segmentIndex];
      const end = route.coordinates[segmentIndex + 1];
      const fraction = segmentProjectionFraction(stopCoordinate, start, end);
      const coordinate: LngLat = [
        start[0] + normalizedLngDelta(end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
      ];
      if (distanceBetweenLngLatMeters(coordinate, stopCoordinate) > riskRadius) continue;
      const geometricProgress = route.cumulative_m[segmentIndex]
        + route.segment_lengths_m[segmentIndex] * fraction;
      addOccurrence({
        coordinate,
        heading_deg: originalRouteSegmentBearingDegrees(start, end),
        progress_m: route.total_m > 0
          ? geometricProgress / route.total_m * manifest.route.distance_m
          : 0,
      });
    }
  }
  const occurrences = [...occurrenceByKey.values()].sort((a, b) => a.progress_m - b.progress_m);
  const ambiguities: RouteAmbiguity[] = [];
  for (let first = 0; first < occurrences.length; first += 1) {
    for (let second = first + 1; second < occurrences.length; second += 1) {
      const a = occurrences[first];
      const b = occurrences[second];
      if (b.progress_m - a.progress_m < 500) continue;
      const spatialDistanceM = distanceBetweenLngLatMeters(a.coordinate, b.coordinate);
      if (spatialDistanceM > repeatedPositionRadiusM) continue;
      if (a.heading_deg == null || b.heading_deg == null) continue;
      const approachDeltaDeg = angularDifferenceDegrees(a.heading_deg, b.heading_deg);
      ambiguities.push({
        first_progress_m: a.progress_m,
        second_progress_m: b.progress_m,
        first: { coordinate: a.coordinate, heading_deg: a.heading_deg },
        second: { coordinate: b.coordinate, heading_deg: b.heading_deg },
        spatial_distance_m: spatialDistanceM,
        approach_delta_deg: approachDeltaDeg,
      });
    }
  }
  return ambiguities;
}

function occurrenceDistanceToStop(
  stop: OriginalStopV1,
  occurrence: { point: RoutePoint },
) {
  return distanceBetweenLngLatMeters(
    occurrence.point.coordinate,
    [stop.coordinates.lng, stop.coordinates.lat],
  );
}

function occurrenceInsideTriggerRisk(
  stop: OriginalStopV1,
  occurrence: { point: RoutePoint },
) {
  return occurrenceDistanceToStop(stop, occurrence)
    <= stop.trigger.enter_radius_m + ORIGINAL_TRIGGER_DEFAULTS.maximum_accuracy_m;
}

function ambiguousStops(
  manifest: OriginalManifestV1,
  ambiguities: readonly RouteAmbiguity[],
  options: { requires_bearing_only?: boolean } = {},
) {
  return orderedOriginalStops(manifest).filter(stop => ambiguities.some(ambiguity => (
    (!options.requires_bearing_only || ambiguity.approach_delta_deg >= 30)
    && (() => {
      const occurrences = [
        { progress: ambiguity.first_progress_m, point: ambiguity.first },
        { progress: ambiguity.second_progress_m, point: ambiguity.second },
      ];
      const intended = occurrences.filter(occurrence => (
        occurrence.progress >= stop.trigger.route_progress_start_m
        && occurrence.progress <= stop.trigger.route_progress_end_m
      ));
      if (intended.length !== 1) return false;
      const competing = occurrences.find(occurrence => occurrence !== intended[0])!;
      return occurrenceDistanceToStop(stop, intended[0]) <= stop.trigger.enter_radius_m
        && occurrenceInsideTriggerRisk(stop, competing);
    })()
  )));
}

function multipleOccurrenceWindowStops(
  manifest: OriginalManifestV1,
  ambiguities: readonly RouteAmbiguity[],
) {
  return orderedOriginalStops(manifest).filter(stop => ambiguities.some(ambiguity => {
    const occurrences = [
      { progress: ambiguity.first_progress_m, point: ambiguity.first },
      { progress: ambiguity.second_progress_m, point: ambiguity.second },
    ];
    const bothInsideWindow = occurrences.every(occurrence => (
      occurrence.progress >= stop.trigger.route_progress_start_m
      && occurrence.progress <= stop.trigger.route_progress_end_m
    ));
    return bothInsideWindow
      && occurrences.some(occurrence => (
        occurrenceDistanceToStop(stop, occurrence) <= stop.trigger.enter_radius_m
      ))
      && occurrences.every(occurrence => occurrenceInsideTriggerRisk(stop, occurrence));
  }));
}

function ineffectiveBearingGateStops(
  manifest: OriginalManifestV1,
  ambiguities: readonly RouteAmbiguity[],
) {
  return orderedOriginalStops(manifest).filter(stop => {
    const requiredBearing = stop.trigger.approach_bearing_deg;
    if (requiredBearing == null) return false;
    const tolerance = stop.trigger.bearing_tolerance_deg ?? 45;
    const relevant = ambiguities.flatMap(ambiguity => {
      if (ambiguity.approach_delta_deg < 30) return [];
      const occurrences = [
        { progress: ambiguity.first_progress_m, point: ambiguity.first },
        { progress: ambiguity.second_progress_m, point: ambiguity.second },
      ];
      const intended = occurrences.filter(occurrence => (
        occurrence.progress >= stop.trigger.route_progress_start_m
        && occurrence.progress <= stop.trigger.route_progress_end_m
      ));
      if (intended.length !== 1) return [];
      const competing = occurrences.find(occurrence => occurrence !== intended[0])!;
      if (
        occurrenceDistanceToStop(stop, intended[0]) > stop.trigger.enter_radius_m
        || !occurrenceInsideTriggerRisk(stop, competing)
      ) return [];
      return [{
        spatial_distance_m: ambiguity.spatial_distance_m,
        intended: intended[0],
        competing,
      }];
    });
    if (!relevant.length) return false;
    // Curved approaches legitimately contain headings outside the authored
    // gate. Evaluate the one ambiguity pair whose intended occurrence is
    // closest to the authored cue, with stable geometric tie-breakers, rather
    // than cherry-picking a favorable tangent or requiring every curve sample.
    const representative = [...relevant].sort((a, b) => (
      distanceBetweenLngLatMeters(
        a.intended.point.coordinate,
        [stop.coordinates.lng, stop.coordinates.lat],
      ) - distanceBetweenLngLatMeters(
        b.intended.point.coordinate,
        [stop.coordinates.lng, stop.coordinates.lat],
      )
      || a.spatial_distance_m - b.spatial_distance_m
      || a.intended.progress - b.intended.progress
    ))[0];
    const intendedHeading = representative.intended.point.heading_deg;
    // A curved trigger window can expose several intended tangents. The gate
    // may deliberately admit only the tangent nearest the cue. Require that
    // nearest anchor to pass, then evaluate every competitor paired with any
    // intended tangent the authored gate would actually admit.
    const admitted = relevant.filter(value => {
      const heading = value.intended.point.heading_deg;
      return heading != null
        && angularDifferenceDegrees(requiredBearing, heading) <= tolerance;
    });
    const competingHeadings = admitted.map(value => value.competing.point.heading_deg);
    return intendedHeading == null
      || angularDifferenceDegrees(requiredBearing, intendedHeading) > tolerance
      || !admitted.length
      || competingHeadings.some(value => value == null)
      || competingHeadings.some(value => (
        value != null && angularDifferenceDegrees(requiredBearing, value) <= tolerance
      ));
  });
}

function offsetCoordinate(coordinate: LngLat, eastM: number, northM: number): LngLat {
  const latitudeRadians = coordinate[1] * Math.PI / 180;
  return [
    coordinate[0] + eastM / Math.max(1, 111_320 * Math.cos(latitudeRadians)),
    coordinate[1] + northM / 111_320,
  ];
}

function createHarness(manifest: OriginalManifestV1): ScenarioHarness {
  const session = {
    ...createOriginalSession(manifest, 'guest', START_TIMESTAMP_MS),
    status: 'active' as const,
    started_at_ms: START_TIMESTAMP_MS,
  };
  return {
    manifest,
    session,
    timestamp_ms: START_TIMESTAMP_MS,
    sample_count: 0,
    events: [],
    decisions: {},
    trigger_counts: new Map(),
    queue_counts: new Map(),
    trigger_order: [],
    audio_end_ms: null,
    queued_playback_stop_ids: new Set(),
    queued_following_pairs: new Set(),
    maximum_queue_depth: 0,
    audio_overlap_count: 0,
    projection_regressions: 0,
    minimum_authored_trace_progress_m: null,
    maximum_authored_trace_progress_m: null,
    minimum_projected_progress_m: null,
    maximum_projected_progress_m: null,
  };
}

function stopById(harness: ScenarioHarness, stopId: string) {
  return harness.manifest.stops.find(stop => stop.id === stopId) ?? null;
}

function startAudio(harness: ScenarioHarness, stopId: string, timestampMs: number) {
  const stop = stopById(harness, stopId);
  if (!stop) return;
  if (harness.audio_end_ms != null && harness.audio_end_ms > timestampMs) {
    harness.audio_overlap_count += 1;
  }
  harness.audio_end_ms = timestampMs + Math.max(1, stop.audio_duration_s) * 1_000;
}

function completeCurrentAudio(harness: ScenarioHarness, timestampMs: number) {
  const current = harness.session.current_stop_id;
  if (!current) {
    harness.audio_end_ms = null;
    return;
  }
  let next = completeOriginalStop(
    harness.session,
    current,
    harness.manifest.stops.map(stop => stop.id),
    timestampMs,
  );
  const queued = next.queued_stop_id;
  harness.queued_playback_stop_ids.delete(current);
  if (queued) {
    next = {
      ...next,
      status: 'active',
      current_stop_id: queued,
      queued_stop_id: null,
      current_audio_position_ms: 0,
      completed_at_ms: null,
      updated_at_ms: timestampMs,
    };
  }
  harness.session = next;
  harness.audio_end_ms = null;
  if (queued) {
    harness.queued_playback_stop_ids.add(queued);
    startAudio(harness, queued, timestampMs);
  }
}

function advanceAudio(harness: ScenarioHarness, timestampMs: number) {
  let guard = 0;
  while (
    harness.audio_end_ms != null
    && harness.audio_end_ms <= timestampMs
    && guard < harness.manifest.stops.length + 2
  ) {
    const endedAt = harness.audio_end_ms;
    completeCurrentAudio(harness, endedAt);
    guard += 1;
  }
}

function processSample(harness: ScenarioHarness, sample: OriginalLocationSample) {
  advanceAudio(harness, sample.timestamp_ms);
  const queuedPlaybackStopId = harness.session.current_stop_id != null
    && harness.queued_playback_stop_ids.has(harness.session.current_stop_id)
    ? harness.session.current_stop_id
    : null;
  const priorProgress = harness.session.last_projected_route_progress_m;
  const evaluation = evaluateOriginalLocation(harness.manifest, harness.session, sample);
  harness.sample_count += 1;
  harness.timestamp_ms = Math.max(harness.timestamp_ms, sample.timestamp_ms);
  harness.session = evaluation.session;
  harness.events.push(...evaluation.events);
  harness.decisions[evaluation.decision.code] = (harness.decisions[evaluation.decision.code] ?? 0) + 1;
  if (evaluation.projected_route_progress_m != null) {
    harness.minimum_projected_progress_m = harness.minimum_projected_progress_m == null
      ? evaluation.projected_route_progress_m
      : Math.min(harness.minimum_projected_progress_m, evaluation.projected_route_progress_m);
    harness.maximum_projected_progress_m = harness.maximum_projected_progress_m == null
      ? evaluation.projected_route_progress_m
      : Math.max(harness.maximum_projected_progress_m, evaluation.projected_route_progress_m);
  }
  if (
    priorProgress != null
    && evaluation.projected_route_progress_m != null
    && evaluation.projected_route_progress_m + 75 < priorProgress
    && sample.speed_mps != null
    && sample.speed_mps >= 2
  ) {
    harness.projection_regressions += 1;
  }
  evaluation.events.forEach(event => {
    if (
      queuedPlaybackStopId
      && (
        event.type === 'stop_armed'
        || event.type === 'stop_triggered'
        || event.type === 'stop_queued'
      )
      && event.stop_id !== queuedPlaybackStopId
    ) {
      harness.queued_following_pairs.add(`${queuedPlaybackStopId}:${event.stop_id}`);
    }
    if (event.type === 'stop_triggered' || event.type === 'stop_queued') {
      harness.trigger_counts.set(event.stop_id, (harness.trigger_counts.get(event.stop_id) ?? 0) + 1);
      harness.trigger_order.push(event.stop_id);
    }
    if (event.type === 'stop_queued') {
      harness.queue_counts.set(event.stop_id, (harness.queue_counts.get(event.stop_id) ?? 0) + 1);
    }
  });
  if (
    evaluation.decision.queue?.following_stop_eligible
    && evaluation.decision.queue.following_stop_id
  ) {
    harness.queued_following_pairs.add(
      `${evaluation.decision.queue.queued_stop_id}:${evaluation.decision.queue.following_stop_id}`,
    );
  }
  const triggered = evaluation.events.find(event => event.type === 'stop_triggered');
  if (triggered?.type === 'stop_triggered') startAudio(harness, triggered.stop_id, sample.timestamp_ms);
  harness.maximum_queue_depth = Math.max(harness.maximum_queue_depth, harness.session.queued_stop_id ? 1 : 0);
  return evaluation;
}

type TraceOptions = {
  speed_mph: number;
  start_progress_m?: number;
  end_progress_m?: number;
  reverse?: boolean;
  jitter?: boolean;
  inject_stale?: boolean;
  restart_after_first_trigger?: boolean;
};

function recordAuthoredTraceProgress(harness: ScenarioHarness, progressM: number) {
  harness.minimum_authored_trace_progress_m = harness.minimum_authored_trace_progress_m == null
    ? progressM
    : Math.min(harness.minimum_authored_trace_progress_m, progressM);
  harness.maximum_authored_trace_progress_m = harness.maximum_authored_trace_progress_m == null
    ? progressM
    : Math.max(harness.maximum_authored_trace_progress_m, progressM);
}

function driveTrace(harness: ScenarioHarness, route: RouteMeasure, options: TraceOptions) {
  const speedMps = mphToMps(options.speed_mph);
  const stepM = Math.max(5, speedMps * SAMPLE_INTERVAL_MS / 1_000);
  const distance = harness.manifest.route.distance_m;
  const reverse = Boolean(options.reverse);
  const endProgress = clamp(options.end_progress_m ?? (reverse ? 0 : distance), 0, distance);
  let progress = clamp(options.start_progress_m ?? (reverse ? distance : 0), 0, distance);
  let index = 0;
  let restarted = false;
  while ((reverse ? progress >= endProgress : progress <= endProgress) && index < 50_000) {
    recordAuthoredTraceProgress(harness, progress);
    const point = routePointAtProgress(harness.manifest, route, progress);
    const heading = point.heading_deg == null
      ? null
      : reverse ? (point.heading_deg + 180) % 360 : point.heading_deg;
    const jitter = options.jitter
      ? GPS_JITTER_PATTERN_M[index % GPS_JITTER_PATTERN_M.length]
      : 0;
    const coordinate = offsetCoordinate(point.coordinate, jitter, -jitter * 0.35);
    harness.timestamp_ms += SAMPLE_INTERVAL_MS;
    const sample: OriginalLocationSample = {
      lat: coordinate[1],
      lng: coordinate[0],
      accuracy_m: options.jitter ? GPS_JITTER_ACCURACY_M : 10,
      heading_deg: heading,
      speed_mps: speedMps,
      timestamp_ms: harness.timestamp_ms,
    };
    const evaluation = processSample(harness, sample);
    if (
      options.restart_after_first_trigger
      && !restarted
      && evaluation.events.some(event => event.type === 'stop_triggered')
    ) {
      restarted = true;
      harness.session = JSON.parse(JSON.stringify(harness.session)) as OriginalSessionV1;
      processSample(harness, { ...sample });
    }
    if (options.inject_stale && index > 0 && index % 13 === 0) {
      processSample(harness, {
        ...sample,
        timestamp_ms: sample.timestamp_ms - Math.floor(SAMPLE_INTERVAL_MS / 2),
      });
    }
    progress += reverse ? -stepM : stepM;
    index += 1;
  }
  if (
    !reverse
    && endProgress === distance
    && index < 50_000
    && progress - stepM < distance
  ) {
    recordAuthoredTraceProgress(harness, distance);
    const point = routePointAtProgress(harness.manifest, route, distance);
    for (let fix = 0; fix < 2; fix += 1) {
      harness.timestamp_ms += SAMPLE_INTERVAL_MS;
      processSample(harness, {
        lat: point.coordinate[1],
        lng: point.coordinate[0],
        accuracy_m: 10,
        heading_deg: point.heading_deg,
        speed_mps: speedMps,
        timestamp_ms: harness.timestamp_ms,
      });
    }
  }
}

function finishHarness(harness: ScenarioHarness, route: RouteMeasure) {
  let guard = 0;
  while (harness.audio_end_ms != null && guard < harness.manifest.stops.length + 2) {
    const nextTimestamp = harness.audio_end_ms;
    advanceAudio(harness, nextTimestamp);
    harness.timestamp_ms = Math.max(harness.timestamp_ms, nextTimestamp);
    guard += 1;
  }
  if (harness.session.status !== 'completed') {
    const endpoint = routePointAtProgress(harness.manifest, route, harness.manifest.route.distance_m);
    harness.timestamp_ms += SAMPLE_INTERVAL_MS;
    processSample(harness, {
      lat: endpoint.coordinate[1],
      lng: endpoint.coordinate[0],
      accuracy_m: 10,
      heading_deg: endpoint.heading_deg,
      speed_mps: 0,
      timestamp_ms: harness.timestamp_ms,
    });
    if (harness.audio_end_ms != null) advanceAudio(harness, harness.audio_end_ms);
  }
}

function stopReports(manifest: OriginalManifestV1, harness: ScenarioHarness): OriginalRouteValidationStopReport[] {
  return orderedOriginalStops(manifest).map(stop => ({
    stop_id: stop.id,
    outcome: harness.session.completed_stop_ids.includes(stop.id)
      ? 'completed'
      : harness.session.missed_stop_ids.includes(stop.id)
        ? 'missed'
        : harness.session.skipped_stop_ids.includes(stop.id)
          ? 'skipped'
          : harness.session.triggered_stop_ids.includes(stop.id)
            ? 'triggered'
            : 'not_reached',
    trigger_count: harness.trigger_counts.get(stop.id) ?? 0,
    queue_count: harness.queue_counts.get(stop.id) ?? 0,
    completed: harness.session.completed_stop_ids.includes(stop.id),
  }));
}

function boundedIssues(values: readonly string[]) {
  return values.filter(Boolean).slice(0, MAX_ISSUES).map(value => value.slice(0, MAX_ISSUE_LENGTH));
}

function commonIssues(
  manifest: OriginalManifestV1,
  harness: ScenarioHarness,
  options: { expect_all_completed?: boolean; expected_order?: readonly string[] } = {},
) {
  const issues: string[] = [];
  stopReports(manifest, harness).forEach(report => {
    if (report.trigger_count > 1) issues.push(`${report.stop_id} triggered ${report.trigger_count} times.`);
    if (report.queue_count > 1) issues.push(`${report.stop_id} queued ${report.queue_count} times.`);
    if (options.expect_all_completed && !report.completed) {
      issues.push(`${report.stop_id} ended ${report.outcome} instead of completed.`);
    }
  });
  if (options.expected_order && harness.trigger_order.join('|') !== options.expected_order.join('|')) {
    issues.push('Stories did not trigger exactly once in authored order.');
  }
  if (harness.maximum_queue_depth > 1) issues.push('More than one story entered the narration queue.');
  if (harness.audio_overlap_count > 0) issues.push('Narration playback overlapped.');
  if (harness.queued_following_pairs.size > 0) {
    issues.push('A following cue became eligible before queued narration finished.');
  }
  if (harness.session.status !== 'completed') issues.push(`Run ended ${harness.session.status}, not completed.`);
  return issues;
}

function scenarioReport(
  id: OriginalRouteValidationScenarioId,
  harness: ScenarioHarness,
  issues: readonly string[],
  metrics: Record<string, number | string | boolean | null>,
): OriginalRouteValidationScenarioReport {
  const cleanIssues = boundedIssues(issues);
  return {
    id,
    required: true,
    passed: cleanIssues.length === 0,
    issues: cleanIssues,
    metrics: {
      sample_count: harness.sample_count,
      triggered_count: harness.trigger_order.length,
      completed_count: harness.session.completed_stop_ids.length,
      missed_count: harness.session.missed_stop_ids.length,
      maximum_queue_depth: harness.maximum_queue_depth,
      audio_overlap_count: harness.audio_overlap_count,
      following_cue_during_queued_playback_count:
        harness.queued_following_pairs.size,
      projection_regressions: harness.projection_regressions,
      authored_trace_span_m: Math.max(
        0,
        (harness.maximum_authored_trace_progress_m ?? 0)
          - (harness.minimum_authored_trace_progress_m ?? 0),
      ),
      terminal: harness.session.status === 'completed',
      ...metrics,
    },
    stops: stopReports(harness.manifest, harness),
  };
}

function baselineScenario(
  id: OriginalRouteValidationScenarioId,
  manifest: OriginalManifestV1,
  route: RouteMeasure,
  speedMph: number,
  traceOptions: Partial<TraceOptions> = {},
) {
  const harness = createHarness(manifest);
  driveTrace(harness, route, { speed_mph: speedMph, ...traceOptions });
  finishHarness(harness, route);
  const expected = orderedOriginalStops(manifest).map(stop => stop.id);
  const issues = commonIssues(manifest, harness, { expect_all_completed: true, expected_order: expected });
  const traceSpanM = (harness.maximum_authored_trace_progress_m ?? 0)
    - (harness.minimum_authored_trace_progress_m ?? 0);
  if (traceSpanM < manifest.route.distance_m * 0.99) {
    issues.push('The continuous trace did not cover the complete authored route.');
  }
  return scenarioReport(
    id,
    harness,
    issues,
    {
      speed_mph: speedMph,
      speed_mps: Number(mphToMps(speedMph).toFixed(4)),
      ...(traceOptions.jitter ? {
        jitter_accuracy_m: GPS_JITTER_ACCURACY_M,
        maximum_jitter_offset_m: Math.round(
          Math.max(...GPS_JITTER_PATTERN_M.map(value => Math.hypot(value, value * 0.35))),
        ),
      } : {}),
    },
  );
}

function poorAccuracyScenario(manifest: OriginalManifestV1, route: RouteMeasure) {
  const harness = createHarness(manifest);
  const point = routePointAtProgress(manifest, route, 0);
  harness.timestamp_ms += SAMPLE_INTERVAL_MS;
  processSample(harness, {
    lat: point.coordinate[1], lng: point.coordinate[0], accuracy_m: 150,
    heading_deg: point.heading_deg, speed_mps: mphToMps(36), timestamp_ms: harness.timestamp_ms,
  });
  driveTrace(harness, route, { speed_mph: 36 });
  finishHarness(harness, route);
  const expected = orderedOriginalStops(manifest).map(stop => stop.id);
  const issues = commonIssues(manifest, harness, { expect_all_completed: true, expected_order: expected });
  if (!harness.decisions.poor_accuracy) issues.push('Poor GPS accuracy was not rejected.');
  if (!harness.events.some(event => event.type === 'gps_quality_changed' && event.state === 'on_route')) {
    issues.push('GPS recovery did not resume route tracking.');
  }
  return scenarioReport('poor_accuracy_recovery', harness, issues, {
    speed_mph: 36,
    poor_accuracy_decisions: harness.decisions.poor_accuracy ?? 0,
  });
}

function offRouteCoordinate(manifest: OriginalManifestV1): LngLat {
  const { north, south, east, west } = manifest.route.bounds;
  const latitude = north < 89.9 ? north + 0.08 : south - 0.08;
  const longitude = east < 179.9 ? east + 0.08 : west - 0.08;
  return [clamp(longitude, -179.99, 179.99), clamp(latitude, -89.99, 89.99)];
}

function offRouteScenario(manifest: OriginalManifestV1, route: RouteMeasure) {
  const harness = createHarness(manifest);
  const interruptionProgressM = manifest.route.distance_m * 0.35;
  driveTrace(harness, route, {
    speed_mph: 36,
    end_progress_m: interruptionProgressM,
  });
  const offRoute = offRouteCoordinate(manifest);
  for (let fix = 0; fix < 3; fix += 1) {
    harness.timestamp_ms += SAMPLE_INTERVAL_MS;
    processSample(harness, {
      lat: offRoute[1], lng: offRoute[0], accuracy_m: 10,
      heading_deg: 0, speed_mps: mphToMps(36), timestamp_ms: harness.timestamp_ms,
    });
  }
  const rejoin = routePointAtProgress(manifest, route, interruptionProgressM);
  for (let fix = 0; fix < 2; fix += 1) {
    harness.timestamp_ms += SAMPLE_INTERVAL_MS;
    processSample(harness, {
      lat: rejoin.coordinate[1], lng: rejoin.coordinate[0], accuracy_m: 10,
      heading_deg: rejoin.heading_deg, speed_mps: mphToMps(36), timestamp_ms: harness.timestamp_ms,
    });
  }
  driveTrace(harness, route, {
    speed_mph: 36,
    start_progress_m: Math.min(manifest.route.distance_m, interruptionProgressM + mphToMps(36) * SAMPLE_INTERVAL_MS / 1_000),
  });
  finishHarness(harness, route);
  const expected = orderedOriginalStops(manifest).map(stop => stop.id);
  const issues = commonIssues(manifest, harness, { expect_all_completed: true, expected_order: expected });
  const offRouteFixCount = harness.decisions.off_route ?? 0;
  const offRouteTransition = harness.events.findIndex(event => event.type === 'route_state_changed' && event.state === 'off_route');
  const rejoinTransition = harness.events.findIndex((event, index) => (
    index > offRouteTransition && event.type === 'route_state_changed' && event.state === 'on_route'
  ));
  if (offRouteFixCount < 3) issues.push('The continuous route deviation did not reject all three bad fixes.');
  if (offRouteTransition < 0) issues.push('The route did not enter the off-route state.');
  if (rejoinTransition < 0) {
    issues.push('The route did not recover after rejoining.');
  }
  return scenarioReport('off_route_rejoin', harness, issues, {
    speed_mph: 36,
    interruption_progress_m: Math.round(interruptionProgressM),
    off_route_decisions: offRouteFixCount,
    rejoin_transition_count: rejoinTransition >= 0 ? 1 : 0,
  });
}

function reverseScenario(manifest: OriginalManifestV1, route: RouteMeasure) {
  const harness = createHarness(manifest);
  const heldStop = orderedOriginalStops(manifest)[0];
  harness.session = {
    ...harness.session,
    current_stop_id: heldStop.id,
    triggered_stop_ids: [heldStop.id],
  };
  driveTrace(harness, route, { speed_mph: 36, reverse: true });
  harness.session = completeOriginalStop(
    harness.session,
    heldStop.id,
    manifest.stops.map(stop => stop.id),
    harness.timestamp_ms,
  );
  const issues = commonIssues(manifest, harness);
  if (harness.trigger_order.length) issues.push('Reverse travel produced a forward story trigger.');
  if (harness.session.missed_stop_ids.length !== Math.max(0, manifest.stops.length - 1)) {
    issues.push('Reverse entry did not close every unplayed forward cue without a backlog.');
  }
  const routeSpanM = (harness.maximum_projected_progress_m ?? 0) - (harness.minimum_projected_progress_m ?? 0);
  if (routeSpanM < manifest.route.distance_m * 0.9) {
    issues.push('Reverse travel did not exercise the full authored route.');
  }
  return scenarioReport('reverse_travel', harness, issues, {
    speed_mph: 36,
    route_span_m: Math.round(routeSpanM),
    held_story_id: heldStop.id,
  });
}

function midRouteScenario(manifest: OriginalManifestV1, route: RouteMeasure) {
  const harness = createHarness(manifest);
  const startProgress = manifest.route.distance_m * 0.5;
  driveTrace(harness, route, { speed_mph: 36, start_progress_m: startProgress });
  finishHarness(harness, route);
  const expectedMissed = orderedOriginalStops(manifest)
    .filter(stop => stop.trigger.route_progress_end_m < startProgress)
    .map(stop => stop.id);
  const expectedTriggered = orderedOriginalStops(manifest)
    .filter(stop => !expectedMissed.includes(stop.id))
    .map(stop => stop.id);
  const issues = commonIssues(manifest, harness, { expected_order: expectedTriggered });
  expectedMissed.forEach(stopId => {
    if (!harness.session.missed_stop_ids.includes(stopId)) issues.push(`${stopId} was not marked missed at mid-route start.`);
    if ((harness.trigger_counts.get(stopId) ?? 0) > 0) issues.push(`${stopId} played as backlog after mid-route start.`);
  });
  expectedTriggered.forEach(stopId => {
    if (!harness.session.completed_stop_ids.includes(stopId)) issues.push(`${stopId} did not complete after mid-route start.`);
  });
  return scenarioReport('mid_route_start', harness, issues, {
    speed_mph: 36,
    start_progress_m: Math.round(startProgress),
    expected_missed_count: expectedMissed.length,
  });
}

function restartScenario(manifest: OriginalManifestV1, route: RouteMeasure) {
  const harness = createHarness(manifest);
  driveTrace(harness, route, { speed_mph: 36, restart_after_first_trigger: true });
  finishHarness(harness, route);
  const expected = orderedOriginalStops(manifest).map(stop => stop.id);
  const issues = commonIssues(manifest, harness, { expect_all_completed: true, expected_order: expected });
  if (!harness.decisions.stale_fix) issues.push('The duplicate persisted fix was not rejected after restart.');
  return scenarioReport('restart_duplicate_prevention', harness, issues, {
    speed_mph: 36,
    stale_fix_decisions: harness.decisions.stale_fix ?? 0,
  });
}

function syntheticQueueControl(manifest: OriginalManifestV1) {
  const template = orderedOriginalStops(manifest)[0];
  const origin = cleanCoordinates(manifest)[0];
  if (!template || !origin) {
    return { passed: false, queue_exercised: false, queued_story_id: null as string | null };
  }
  const distanceM = 2_000;
  const endpoint = offsetCoordinate(origin, distanceM, 0);
  const bounds = {
    north: Math.max(origin[1], endpoint[1]) + 0.001,
    south: Math.min(origin[1], endpoint[1]) - 0.001,
    east: Math.max(origin[0], endpoint[0]) + 0.001,
    west: Math.min(origin[0], endpoint[0]) - 0.001,
  };
  const stopProgresses = [400, 700, 1_300] as const;
  const controlManifest: OriginalManifestV1 = {
    ...JSON.parse(JSON.stringify(manifest)) as OriginalManifestV1,
    route: {
      ...manifest.route,
      geometry: { type: 'LineString', coordinates: [origin, endpoint] },
      bounds,
      distance_m: distanceM,
    },
    offline_map: { ...manifest.offline_map, bounds },
    stops: stopProgresses.map((progress, index) => ({
      ...JSON.parse(JSON.stringify(template)) as OriginalStopV1,
      id: `validation-queue-${index + 1}`,
      sequence: index + 1,
      title: `Validation queue cue ${index + 1}`,
      coordinates: (() => {
        const coordinate = offsetCoordinate(origin, progress, 0);
        return { lat: coordinate[1], lng: coordinate[0] };
      })(),
      audio_duration_s: index === 0 ? 30 : 5,
      trigger: {
        ...template.trigger,
        enter_radius_m: 100,
        exit_radius_m: 150,
        lead_time_s: 0,
        route_progress_start_m: progress - 100,
        route_progress_end_m: progress + 100,
        approach_bearing_deg: undefined,
        bearing_tolerance_deg: undefined,
      },
    })),
  };
  const route = measureRoute(controlManifest);
  const harness = createHarness(controlManifest);
  driveTrace(harness, route, { speed_mph: 36 });
  finishHarness(harness, route);
  const queuedStoryId = 'validation-queue-2';
  const expected = controlManifest.stops.map(stop => stop.id);
  const issues = commonIssues(controlManifest, harness, {
    expect_all_completed: true,
    expected_order: expected,
  });
  const traceSpanM = (harness.maximum_authored_trace_progress_m ?? 0)
    - (harness.minimum_authored_trace_progress_m ?? 0);
  if (traceSpanM < distanceM * 0.99) {
    issues.push('The synthetic queue control did not cover its complete route.');
  }
  const queueExercised = (harness.queue_counts.get(queuedStoryId) ?? 0) === 1;
  return {
    passed: queueExercised && issues.length === 0,
    queue_exercised: queueExercised,
    queued_story_id: queueExercised ? queuedStoryId : null,
  };
}

function overlappingQueueScenario(manifest: OriginalManifestV1, route: RouteMeasure) {
  const harness = createHarness(manifest);
  driveTrace(harness, route, { speed_mph: 36 });
  finishHarness(harness, route);
  const expected = orderedOriginalStops(manifest).map(stop => stop.id);
  const issues = commonIssues(manifest, harness, { expect_all_completed: true, expected_order: expected });
  const traceSpanM = (harness.maximum_authored_trace_progress_m ?? 0)
    - (harness.minimum_authored_trace_progress_m ?? 0);
  if (traceSpanM < manifest.route.distance_m * 0.99) {
    issues.push('The queue-spacing trace did not cover the complete authored route.');
  }
  const queueControl = syntheticQueueControl(manifest);
  if (!queueControl.passed) issues.push('The continuous narration queue control did not drain safely.');
  return scenarioReport('overlapping_audio_queue', harness, issues, {
    speed_mph: 36,
    queue_exercised: queueControl.queue_exercised,
    queued_story_id: queueControl.queued_story_id,
    synthetic_queue_control_passed: queueControl.passed,
    actual_queue_count: [...harness.queue_counts.values()].reduce((total, value) => total + value, 0),
    queue_spacing_violation_count: harness.queued_following_pairs.size,
  });
}

function delayedFixScenario(manifest: OriginalManifestV1, route: RouteMeasure) {
  const harness = createHarness(manifest);
  driveTrace(harness, route, { speed_mph: 36, inject_stale: true });
  finishHarness(harness, route);
  const expected = orderedOriginalStops(manifest).map(stop => stop.id);
  const issues = commonIssues(manifest, harness, { expect_all_completed: true, expected_order: expected });
  if (!harness.decisions.stale_fix) issues.push('Delayed fixes were not identified and ignored.');
  return scenarioReport('delayed_out_of_order_fixes', harness, issues, {
    speed_mph: 36,
    stale_fix_decisions: harness.decisions.stale_fix ?? 0,
  });
}

function ambiguityProjectionFailures(
  manifest: OriginalManifestV1,
  ambiguities: readonly RouteAmbiguity[],
) {
  let directionalFailures = 0;
  let sameDirectionFailures = 0;
  let directionalCases = 0;
  let sameDirectionCases = 0;
  ambiguities.forEach((ambiguity, ambiguityIndex) => {
    [
      { progress: ambiguity.first_progress_m, point: ambiguity.first },
      { progress: ambiguity.second_progress_m, point: ambiguity.second },
    ].forEach((occurrence, occurrenceIndex) => {
      if (ambiguity.approach_delta_deg >= 30) directionalCases += 1;
      else sameDirectionCases += 1;
      const seed = createOriginalSession(
        manifest,
        'guest',
        START_TIMESTAMP_MS + ambiguityIndex * 10_000 + occurrenceIndex * 4_000,
      );
      const session: OriginalSessionV1 = {
        ...seed,
        status: 'active',
        completed_stop_ids: manifest.stops.map(stop => stop.id),
        last_projected_route_progress_m: Math.max(0, occurrence.progress - 75),
        trigger_state: { ...seed.trigger_state, route_initialized: true },
      };
      const evaluation = evaluateOriginalLocation(manifest, session, {
        lat: occurrence.point.coordinate[1],
        lng: occurrence.point.coordinate[0],
        accuracy_m: 10,
        heading_deg: occurrence.point.heading_deg,
        speed_mps: mphToMps(36),
        timestamp_ms: session.updated_at_ms + SAMPLE_INTERVAL_MS,
      });
      if (
        evaluation.projected_route_progress_m == null
        || Math.abs(evaluation.projected_route_progress_m - occurrence.progress) > 125
      ) {
        if (ambiguity.approach_delta_deg >= 30) directionalFailures += 1;
        else sameDirectionFailures += 1;
      }
    });
  });
  return {
    directional_cases: directionalCases,
    same_direction_cases: sameDirectionCases,
    directional_failures: directionalFailures,
    same_direction_failures: sameDirectionFailures,
    total_failures: directionalFailures + sameDirectionFailures,
  };
}

function syntheticAmbiguityControl(manifest: OriginalManifestV1) {
  const origin = cleanCoordinates(manifest)[0];
  const east = offsetCoordinate(origin, 1_600, 0);
  const north = offsetCoordinate(origin, 0, 1_600);
  const geometry: LngLat[] = [origin, east, origin, north];
  const eastDistanceM = distanceBetweenLngLatMeters(origin, east);
  const geometricDistanceM = geometry.slice(0, -1).reduce((total, coordinate, index) => (
    total + distanceBetweenLngLatMeters(coordinate, geometry[index + 1])
  ), 0);
  const returnProgressM = eastDistanceM + eastDistanceM * 0.25;
  const returnBearing = originalRouteSegmentBearingDegrees(east, origin) ?? 270;
  const outboundBearing = originalRouteSegmentBearingDegrees(origin, east) ?? 90;
  const template = orderedOriginalStops(manifest)[0];
  const controlStop = {
    ...template,
    id: 'validation-return-leg',
    sequence: 1,
    title: 'Validation return leg',
    coordinates: {
      lat: origin[1] + (east[1] - origin[1]) * 0.75,
      lng: origin[0] + normalizedLngDelta(east[0] - origin[0]) * 0.75,
    },
    trigger: {
      ...template.trigger,
      route_progress_start_m: returnProgressM - 150,
      route_progress_end_m: returnProgressM + 150,
      approach_bearing_deg: returnBearing,
      bearing_tolerance_deg: 35,
    },
  };
  const controlManifest: OriginalManifestV1 = {
    ...manifest,
    manifest_id: `${manifest.manifest_id}:ambiguity-control`,
    route: {
      ...manifest.route,
      geometry: {
        type: 'LineString',
        coordinates: geometry,
      },
      distance_m: geometricDistanceM,
    },
    stops: [controlStop],
  };
  const seed = createOriginalSession(controlManifest, 'guest', START_TIMESTAMP_MS);
  let session: OriginalSessionV1 = {
    ...seed,
    status: 'active',
    trigger_state: { ...seed.trigger_state, route_initialized: true },
  };
  const coordinate = controlStop.coordinates;
  const first = evaluateOriginalLocation(controlManifest, session, {
    lat: coordinate.lat,
    lng: coordinate.lng,
    accuracy_m: 10,
    heading_deg: returnBearing,
    speed_mps: mphToMps(36),
    timestamp_ms: START_TIMESTAMP_MS + 1_000,
  });
  session = first.session;
  const second = evaluateOriginalLocation(controlManifest, session, {
    lat: coordinate.lat,
    lng: coordinate.lng,
    accuracy_m: 10,
    heading_deg: returnBearing,
    speed_mps: mphToMps(36),
    timestamp_ms: START_TIMESTAMP_MS + 4_100,
  });
  const outboundSeed = createOriginalSession(controlManifest, 'guest', START_TIMESTAMP_MS);
  let outboundSession: OriginalSessionV1 = {
    ...outboundSeed,
    status: 'active',
    trigger_state: { ...outboundSeed.trigger_state, route_initialized: true },
  };
  const outboundFirst = evaluateOriginalLocation(controlManifest, outboundSession, {
    lat: coordinate.lat,
    lng: coordinate.lng,
    accuracy_m: 10,
    heading_deg: outboundBearing,
    speed_mps: mphToMps(36),
    timestamp_ms: START_TIMESTAMP_MS + 1_000,
  });
  outboundSession = outboundFirst.session;
  const outboundSecond = evaluateOriginalLocation(controlManifest, outboundSession, {
    lat: coordinate.lat,
    lng: coordinate.lng,
    accuracy_m: 10,
    heading_deg: outboundBearing,
    speed_mps: mphToMps(36),
    timestamp_ms: START_TIMESTAMP_MS + 4_100,
  });
  const outboundTriggered = [...outboundFirst.events, ...outboundSecond.events].some(event => (
    event.type === 'stop_triggered' || event.type === 'stop_queued'
  ));
  return first.decision.code === 'armed'
    && second.decision.code === 'triggered'
    && second.decision.stop_id === controlStop.id
    && Math.abs((second.projected_route_progress_m ?? 0) - returnProgressM) <= 125
    && !outboundTriggered;
}

function syntheticSameDirectionControl(manifest: OriginalManifestV1) {
  const origin = cleanCoordinates(manifest)[0];
  const east = offsetCoordinate(origin, 1_600, 0);
  const northEast = offsetCoordinate(east, 0, 900);
  const northWest = offsetCoordinate(origin, 0, 900);
  const template = orderedOriginalStops(manifest)[0];
  const geometry: LngLat[] = [origin, east, northEast, northWest, origin, east];
  const geometricDistance = geometry.slice(0, -1).reduce((total, coordinate, index) => (
    total + distanceBetweenLngLatMeters(coordinate, geometry[index + 1])
  ), 0);
  const repeatedLegStartM = geometricDistance - distanceBetweenLngLatMeters(origin, east);
  const controlStopProgressM = repeatedLegStartM + distanceBetweenLngLatMeters(origin, east) * 0.75;
  const controlStop = {
    ...template,
    id: 'validation-same-direction-return',
    sequence: 1,
    title: 'Validation same-direction return',
    coordinates: {
      lat: origin[1] + (east[1] - origin[1]) * 0.75,
      lng: origin[0] + normalizedLngDelta(east[0] - origin[0]) * 0.75,
    },
    trigger: {
      ...template.trigger,
      route_progress_start_m: controlStopProgressM - 150,
      route_progress_end_m: controlStopProgressM + 150,
      approach_bearing_deg: undefined,
      bearing_tolerance_deg: undefined,
    },
  };
  const controlManifest: OriginalManifestV1 = {
    ...manifest,
    manifest_id: `${manifest.manifest_id}:same-direction-control`,
    route: {
      ...manifest.route,
      geometry: { type: 'LineString', coordinates: geometry },
      distance_m: geometricDistance,
    },
    stops: [controlStop],
  };
  const seed = createOriginalSession(controlManifest, 'guest', START_TIMESTAMP_MS);
  let session: OriginalSessionV1 = {
    ...seed,
    status: 'active',
    last_projected_route_progress_m: repeatedLegStartM + 50,
    trigger_state: { ...seed.trigger_state, route_initialized: true },
  };
  const coordinate = controlStop.coordinates;
  const heading = originalRouteSegmentBearingDegrees(origin, east);
  const first = evaluateOriginalLocation(controlManifest, session, {
    lat: coordinate.lat,
    lng: coordinate.lng,
    accuracy_m: 10,
    heading_deg: heading,
    speed_mps: mphToMps(36),
    timestamp_ms: START_TIMESTAMP_MS + 1_000,
  });
  session = first.session;
  const second = evaluateOriginalLocation(controlManifest, session, {
    lat: coordinate.lat,
    lng: coordinate.lng,
    accuracy_m: 10,
    heading_deg: heading,
    speed_mps: mphToMps(36),
    timestamp_ms: START_TIMESTAMP_MS + 4_100,
  });
  return first.decision.code === 'armed'
    && second.decision.code === 'triggered'
    && second.decision.stop_id === controlStop.id
    && Math.abs((second.projected_route_progress_m ?? 0) - controlStopProgressM) <= 125;
}

function selfIntersectionScenario(
  manifest: OriginalManifestV1,
  route: RouteMeasure,
  routeSummary: OriginalRouteValidationRouteSummary,
  ambiguities: readonly RouteAmbiguity[],
) {
  const harness = createHarness(manifest);
  driveTrace(harness, route, { speed_mph: 36 });
  finishHarness(harness, route);
  const expected = orderedOriginalStops(manifest).map(stop => stop.id);
  const issues = commonIssues(manifest, harness, { expect_all_completed: true, expected_order: expected });
  const ambiguous = ambiguousStops(manifest, ambiguities);
  const directionalAmbiguous = ambiguousStops(manifest, ambiguities, { requires_bearing_only: true });
  const multipleOccurrenceWindows = multipleOccurrenceWindowStops(manifest, ambiguities);
  const missingBearing = directionalAmbiguous.filter(stop => stop.trigger.approach_bearing_deg == null);
  const ineffectiveBearing = ineffectiveBearingGateStops(manifest, ambiguities);
  const projectionFailures = ambiguityProjectionFailures(manifest, ambiguities);
  const syntheticDirectionalControlPassed = syntheticAmbiguityControl(manifest);
  const syntheticSameDirectionControlPassed = syntheticSameDirectionControl(manifest);
  if (harness.projection_regressions) {
    issues.push(`Route matching regressed at ${harness.projection_regressions} ambiguous fixes.`);
  }
  if (routeSummary.discontinuity_count) {
    issues.push(`Route geometry has ${routeSummary.discontinuity_count} segment discontinuities over ${ORIGINAL_ROUTE_DISCONTINUITY_M} meters.`);
  }
  if (routeSummary.stop_projection_failures) {
    issues.push(`${routeSummary.stop_projection_failures} story stops do not project inside their trigger radius.`);
  }
  if (projectionFailures.directional_failures) {
    issues.push(`${projectionFailures.directional_failures} directional repeated-route checks selected the wrong occurrence.`);
  }
  if (projectionFailures.same_direction_failures) {
    issues.push(`${projectionFailures.same_direction_failures} same-direction repeated-route checks lost progress continuity.`);
  }
  missingBearing.forEach(stop => issues.push(`${stop.id} needs a direction gate where the route repeats nearby.`));
  multipleOccurrenceWindows.forEach(stop => issues.push(`${stop.id} trigger window contains multiple repeated route occurrences.`));
  ineffectiveBearing.forEach(stop => issues.push(`${stop.id} has a direction gate that does not separate the intended route occurrence.`));
  if (!syntheticDirectionalControlPassed) issues.push('The directional repeated-route control did not select and trigger the return occurrence.');
  if (!syntheticSameDirectionControlPassed) issues.push('The same-direction repeated-route control did not preserve progress continuity.');
  return scenarioReport('self_intersection_ambiguity', harness, issues, {
    speed_mph: 36,
    self_intersection_count: routeSummary.self_intersection_count,
    near_repeated_position_count: ambiguities.length,
    directional_repeated_position_count: ambiguities.filter(value => value.approach_delta_deg >= 30).length,
    same_direction_repeated_position_count: ambiguities.filter(value => value.approach_delta_deg < 30).length,
    ambiguous_stop_count: ambiguous.length,
    multiple_occurrence_window_count: multipleOccurrenceWindows.length,
    missing_bearing_gate_count: missingBearing.length,
    ineffective_bearing_gate_count: ineffectiveBearing.length,
    projection_case_count: projectionFailures.directional_cases + projectionFailures.same_direction_cases,
    directional_projection_failure_count: projectionFailures.directional_failures,
    same_direction_projection_failure_count: projectionFailures.same_direction_failures,
    projection_failure_count: projectionFailures.total_failures,
    synthetic_directional_control_passed: syntheticDirectionalControlPassed,
    synthetic_same_direction_control_passed: syntheticSameDirectionControlPassed,
    synthetic_control_passed: syntheticDirectionalControlPassed && syntheticSameDirectionControlPassed,
  });
}

function rightRotate(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount));
}

/** Minimal synchronous SHA-256 for the ASCII canonical geometry string. */
function sha256Ascii(value: string) {
  const maxWord = 2 ** 32;
  const words: number[] = [];
  const hash: number[] = [];
  const constants: number[] = [];
  const isComposite: Record<number, boolean> = {};
  let primeCounter = 0;
  for (let candidate = 2; primeCounter < 64; candidate += 1) {
    if (isComposite[candidate]) continue;
    for (let multiple = candidate * candidate; multiple < 313; multiple += candidate) isComposite[multiple] = true;
    if (primeCounter < 8) hash[primeCounter] = (Math.sqrt(candidate) * maxWord) | 0;
    constants[primeCounter] = (candidate ** (1 / 3) * maxWord) | 0;
    primeCounter += 1;
  }
  const bytes = Array.from(value, character => character.charCodeAt(0));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / maxWord);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = bytes[position] << 24 | bytes[position + 1] << 16 | bytes[position + 2] << 8 | bytes[position + 3];
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 = rightRotate(previous15, 7) ^ rightRotate(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rightRotate(previous2, 17) ^ rightRotate(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) | 0;
    }
    const working = hash.slice();
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rightRotate(working[4], 6) ^ rightRotate(working[4], 11) ^ rightRotate(working[4], 25);
      const choice = (working[4] & working[5]) ^ (~working[4] & working[6]);
      const temp1 = (working[7] + sum1 + choice + constants[index] + words[index]) | 0;
      const sum0 = rightRotate(working[0], 2) ^ rightRotate(working[0], 13) ^ rightRotate(working[0], 22);
      const majority = (working[0] & working[1]) ^ (working[0] & working[2]) ^ (working[1] & working[2]);
      const temp2 = (sum0 + majority) | 0;
      working[7] = working[6]; working[6] = working[5]; working[5] = working[4];
      working[4] = (working[3] + temp1) | 0; working[3] = working[2];
      working[2] = working[1]; working[1] = working[0]; working[0] = (temp1 + temp2) | 0;
    }
    for (let index = 0; index < 8; index += 1) hash[index] = (hash[index] + working[index]) | 0;
  }
  return hash.map(word => (word >>> 0).toString(16).padStart(8, '0')).join('');
}

export function canonicalOriginalRouteGeometry(manifest: OriginalManifestV1) {
  return cleanCoordinates(manifest)
    .map(([lng, lat]) => `${Number(lng).toFixed(7)},${Number(lat).toFixed(7)}`)
    .join(';');
}

function orientation(a: LngLat, b: LngLat, c: LngLat) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function rangesOverlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.max(Math.min(a1, a2), Math.min(b1, b2))
    <= Math.min(Math.max(a1, a2), Math.max(b1, b2)) + 1e-10;
}

function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat) {
  if (!rangesOverlap(a[0], b[0], c[0], d[0]) || !rangesOverlap(a[1], b[1], c[1], d[1])) return false;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  const epsilon = 1e-12;
  return (
    ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
  ) || Math.abs(abC) <= epsilon || Math.abs(abD) <= epsilon
    || Math.abs(cdA) <= epsilon || Math.abs(cdB) <= epsilon;
}

function selfIntersectionCount(coordinates: LngLat[]) {
  let count = 0;
  const firstCoordinate = coordinates[0];
  const lastCoordinate = coordinates.at(-1);
  const closed = Boolean(
    firstCoordinate
    && lastCoordinate
    && Math.abs(normalizedLngDelta(lastCoordinate[0] - firstCoordinate[0])) <= 1e-10
    && Math.abs(lastCoordinate[1] - firstCoordinate[1]) <= 1e-10,
  );
  for (let first = 0; first < coordinates.length - 1; first += 1) {
    for (let second = first + 2; second < coordinates.length - 1; second += 1) {
      if (closed && first === 0 && second === coordinates.length - 2) continue;
      if (segmentsIntersect(
        coordinates[first], coordinates[first + 1],
        coordinates[second], coordinates[second + 1],
      )) count += 1;
    }
  }
  return count;
}

export function summarizeOriginalRoute(manifest: OriginalManifestV1): OriginalRouteValidationRouteSummary {
  const route = measureRoute(manifest);
  const maximumSegment = route.segment_lengths_m.reduce((maximum, value) => Math.max(maximum, value), 0);
  const stopProjectionFailures = manifest.stops.filter(stop => {
    const projection = projectPointToOriginalRoute(route.coordinates, [stop.coordinates.lng, stop.coordinates.lat]);
    return !projection || projection.distance_from_route_m > stop.trigger.enter_radius_m;
  }).length;
  return {
    geometry_sha256: sha256Ascii(canonicalOriginalRouteGeometry(manifest)),
    coordinate_count: route.coordinates.length,
    distance_m: Number(manifest.route.distance_m.toFixed(3)),
    maximum_segment_m: Number(maximumSegment.toFixed(3)),
    discontinuity_count: route.segment_lengths_m.filter(value => value > ORIGINAL_ROUTE_DISCONTINUITY_M).length,
    self_intersection_count: selfIntersectionCount(route.coordinates),
    stop_projection_failures: stopProjectionFailures,
  };
}

function runScenario(
  id: OriginalRouteValidationScenarioId,
  manifest: OriginalManifestV1,
  route: RouteMeasure,
  routeSummary: OriginalRouteValidationRouteSummary,
  ambiguities: readonly RouteAmbiguity[],
) {
  switch (id) {
    case 'baseline_slow_15mph': return baselineScenario(id, manifest, route, 15);
    case 'baseline_cruise_36mph': return baselineScenario(id, manifest, route, 36);
    case 'baseline_highway_65mph': return baselineScenario(id, manifest, route, 65);
    case 'gps_jitter': return baselineScenario(id, manifest, route, 36, { jitter: true });
    case 'poor_accuracy_recovery': return poorAccuracyScenario(manifest, route);
    case 'off_route_rejoin': return offRouteScenario(manifest, route);
    case 'reverse_travel': return reverseScenario(manifest, route);
    case 'mid_route_start': return midRouteScenario(manifest, route);
    case 'restart_duplicate_prevention': return restartScenario(manifest, route);
    case 'overlapping_audio_queue': return overlappingQueueScenario(manifest, route);
    case 'drive_by_speed': return baselineScenario(id, manifest, route, 75);
    case 'delayed_out_of_order_fixes': return delayedFixScenario(manifest, route);
    case 'self_intersection_ambiguity': return selfIntersectionScenario(
      manifest, route, routeSummary, ambiguities,
    );
  }
}

export function runOriginalRouteValidation(
  manifest: OriginalManifestV1,
  options: OriginalRouteValidationOptions = {},
): OriginalRouteValidationReportV1 {
  const requested = options.scenario_ids ?? ORIGINAL_ROUTE_VALIDATION_SCENARIO_IDS;
  const uniqueRequested = [...new Set(requested)];
  uniqueRequested.forEach(id => {
    if (!ORIGINAL_ROUTE_VALIDATION_SCENARIO_IDS.includes(id)) {
      throw new Error(`Unsupported Originals route-validation scenario: ${id}`);
    }
  });
  const route = measureRoute(manifest);
  if (route.coordinates.length < 2 || route.total_m <= 0) {
    throw new Error('Originals route validation needs a measurable LineString.');
  }
  const routeSummary = summarizeOriginalRoute(manifest);
  const ambiguities = nearRepeatedRoutePositions(manifest, route);
  const scenarios = uniqueRequested.map(id => runScenario(id, manifest, route, routeSummary, ambiguities));
  const passed = scenarios.filter(scenario => scenario.passed).length;
  return {
    schema_version: ORIGINAL_ROUTE_VALIDATION_SCHEMA_VERSION,
    engine_version: ORIGINAL_ROUTE_VALIDATION_ENGINE_VERSION,
    manifest: { pack_id: manifest.pack_id, version: manifest.version, manifest_id: manifest.manifest_id },
    passed: passed === scenarios.length,
    summary: {
      required: scenarios.length,
      passed,
      failed: scenarios.length - passed,
      stop_count: manifest.stops.length,
    },
    route_summary: routeSummary,
    scenarios,
  };
}
