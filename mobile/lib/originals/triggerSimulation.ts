import { distanceBetweenLngLatMeters, type LngLat } from '../routeProjection';
import {
  originalRouteSegmentBearingDegrees,
  projectPointToOriginalRoute,
} from './routeProjection';
import {
  ORIGINAL_TRIGGER_DEFAULTS,
  remainingOriginalTriggerStops,
} from './triggerEngine';
import type {
  OriginalLocationSample,
  OriginalManifestV1,
  OriginalSessionV1,
  OriginalStopV1,
} from './types';

export type OriginalTriggerSimulationOptions = Readonly<{
  start_timestamp_ms?: number;
  fix_interval_ms?: number;
  accuracy_m?: number;
  speed_mps?: number;
}>;

export type OriginalTriggerSimulationSamples = Readonly<{
  stop: OriginalStopV1;
  stop_id: string;
  target_route_progress_m: number;
  route_coordinate: Readonly<{ lat: number; lng: number }>;
  route_heading_deg: number | null;
  distance_to_stop_m: number;
  samples: readonly [OriginalLocationSample, OriginalLocationSample];
}>;

type RouteMeasure = {
  coordinates: LngLat[];
  segment_lengths_m: number[];
  cumulative_m: number[];
  total_m: number;
};

type RouteTarget = {
  coordinate: LngLat;
  heading_deg: number | null;
  progress_m: number;
  distance_to_stop_m: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedLngDelta(value: number) {
  return ((value + 540) % 360) - 180;
}

function normalizedLng(value: number) {
  return ((value + 540) % 360) - 180;
}

function interpolateCoordinate(start: LngLat, end: LngLat, fraction: number): LngLat {
  return [
    normalizedLng(start[0] + normalizedLngDelta(end[0] - start[0]) * fraction),
    start[1] + (end[1] - start[1]) * fraction,
  ];
}

function measureRoute(coordinates: LngLat[]): RouteMeasure | null {
  if (coordinates.length < 2) return null;
  const segmentLengths = coordinates.slice(0, -1).map((coordinate, index) => (
    distanceBetweenLngLatMeters(coordinate, coordinates[index + 1])
  ));
  const cumulative = [0];
  for (const length of segmentLengths) cumulative.push(cumulative[cumulative.length - 1] + length);
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total <= 0) return null;
  return {
    coordinates,
    segment_lengths_m: segmentLengths,
    cumulative_m: cumulative,
    total_m: total,
  };
}

function closestRouteTargetInWindow(
  manifest: OriginalManifestV1,
  stop: OriginalStopV1,
  effectiveStartM: number,
  endM: number,
): RouteTarget | null {
  const route = measureRoute(manifest.route.geometry.coordinates);
  if (!route || manifest.route.distance_m <= 0) return null;
  const canonicalDistance = manifest.route.distance_m;
  const windowStart = clamp(effectiveStartM, 0, canonicalDistance);
  const windowEnd = clamp(endM, windowStart, canonicalDistance);
  const stopCoordinate: LngLat = [stop.coordinates.lng, stop.coordinates.lat];
  const candidates: RouteTarget[] = [];

  for (let index = 0; index < route.segment_lengths_m.length; index += 1) {
    const segmentLength = route.segment_lengths_m[index];
    if (segmentLength <= 0) continue;
    const segmentStartM = route.cumulative_m[index] / route.total_m * canonicalDistance;
    const segmentEndM = route.cumulative_m[index + 1] / route.total_m * canonicalDistance;
    const overlapStartM = Math.max(windowStart, segmentStartM);
    const overlapEndM = Math.min(windowEnd, segmentEndM);
    if (overlapStartM > overlapEndM) continue;

    const canonicalSegmentLength = segmentEndM - segmentStartM;
    if (canonicalSegmentLength <= 0) continue;
    const overlapStartFraction = (overlapStartM - segmentStartM) / canonicalSegmentLength;
    const overlapEndFraction = (overlapEndM - segmentStartM) / canonicalSegmentLength;
    const segmentStart = route.coordinates[index];
    const segmentEnd = route.coordinates[index + 1];
    const clippedStart = interpolateCoordinate(segmentStart, segmentEnd, overlapStartFraction);
    const clippedEnd = interpolateCoordinate(segmentStart, segmentEnd, overlapEndFraction);
    const clippedProjection = projectPointToOriginalRoute(
      [clippedStart, clippedEnd],
      stopCoordinate,
    );
    const clippedRatio = clippedProjection?.route_ratio ?? 0;
    const segmentFraction = overlapStartFraction
      + (overlapEndFraction - overlapStartFraction) * clippedRatio;
    const coordinate = interpolateCoordinate(segmentStart, segmentEnd, segmentFraction);
    const progress = segmentStartM + canonicalSegmentLength * segmentFraction;
    candidates.push({
      coordinate,
      heading_deg: originalRouteSegmentBearingDegrees(segmentStart, segmentEnd),
      progress_m: progress,
      distance_to_stop_m: distanceBetweenLngLatMeters(coordinate, stopCoordinate),
    });
  }

  return candidates.sort((a, b) => (
    a.distance_to_stop_m - b.distance_to_stop_m
    || a.progress_m - b.progress_m
  ))[0] ?? null;
}

/**
 * Generates deterministic, on-route fixes for the next incomplete cue. The
 * heading comes from authored route geometry and the point remains inside the
 * real route-progress window; radius and bearing requirements are never
 * bypassed. Feed the two samples to evaluateOriginalLocation in order.
 */
export function originalSimulationSamplesForNextCue(
  manifest: OriginalManifestV1,
  session: OriginalSessionV1,
  options: OriginalTriggerSimulationOptions = {},
): OriginalTriggerSimulationSamples | null {
  const stop = remainingOriginalTriggerStops(manifest, session)[0];
  if (!stop) return null;
  const speedMps = Math.max(0, Number(options.speed_mps ?? 12));
  const effectiveStartM = Math.max(
    0,
    stop.trigger.route_progress_start_m
      - speedMps * Math.max(0, stop.trigger.lead_time_s || 0),
  );
  const target = closestRouteTargetInWindow(
    manifest,
    stop,
    effectiveStartM,
    stop.trigger.route_progress_end_m,
  );
  if (!target) return null;

  const startTimestamp = Number.isFinite(options.start_timestamp_ms)
    ? Number(options.start_timestamp_ms)
    : session.updated_at_ms + 1_000;
  const requestedInterval = Number(options.fix_interval_ms);
  const fixInterval = Math.max(
    ORIGINAL_TRIGGER_DEFAULTS.minimum_inside_duration_ms + 1,
    Number.isFinite(requestedInterval)
      ? requestedInterval
      : ORIGINAL_TRIGGER_DEFAULTS.minimum_inside_duration_ms + 100,
  );
  const accuracy = Number.isFinite(options.accuracy_m)
    ? Math.max(0, Number(options.accuracy_m))
    : 10;
  const baseSample: Omit<OriginalLocationSample, 'timestamp_ms'> = {
    lat: target.coordinate[1],
    lng: target.coordinate[0],
    accuracy_m: accuracy,
    heading_deg: target.heading_deg,
    speed_mps: speedMps,
  };

  return {
    stop,
    stop_id: stop.id,
    target_route_progress_m: target.progress_m,
    route_coordinate: { lat: target.coordinate[1], lng: target.coordinate[0] },
    route_heading_deg: target.heading_deg,
    distance_to_stop_m: target.distance_to_stop_m,
    samples: [
      { ...baseSample, timestamp_ms: startTimestamp },
      { ...baseSample, timestamp_ms: startTimestamp + fixInterval },
    ],
  };
}

/** @deprecated Prefer originalSimulationSamplesForNextCue for new callers. */
export const generateNextOriginalCueSamples = originalSimulationSamplesForNextCue;
