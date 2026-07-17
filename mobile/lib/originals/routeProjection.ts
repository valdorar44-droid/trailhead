import { distanceBetweenLngLatMeters, type LngLat } from '../routeProjection';

export type OriginalRouteProjection = {
  coordinate: LngLat;
  route_progress_m: number;
  route_ratio: number;
  distance_from_route_m: number;
  segment_index: number;
};

export type OriginalRouteProjectionOptions = {
  /** Canonical progress from the last accepted on-route fix, expressed as 0..1. */
  previous_route_ratio?: number | null;
  heading_deg?: number | null;
  speed_mps?: number | null;
  accuracy_m?: number | null;
};

type ProjectionCandidate = OriginalRouteProjection & {
  segment_bearing_deg: number | null;
};

const MAX_EQUIVALENT_PROJECTION_SEPARATION_M = 5;
const MAX_EQUIVALENT_DISTANCE_FROM_FIX_DELTA_M = 1;
const MIN_PROGRESS_TIE_TOLERANCE_M = 15;
const MAX_PROGRESS_TIE_TOLERANCE_M = 50;
const MIN_HEADING_SPEED_MPS = 2;

function toRadians(value: number) {
  return value * Math.PI / 180;
}

function normalizedLngDelta(value: number) {
  return ((value + 540) % 360) - 180;
}

function segmentFraction(point: LngLat, start: LngLat, end: LngLat) {
  const referenceLatitude = toRadians((point[1] + start[1] + end[1]) / 3);
  const longitudeScale = Math.max(1e-6, Math.abs(Math.cos(referenceLatitude)));
  const segmentX = normalizedLngDelta(end[0] - start[0]) * longitudeScale;
  const segmentY = end[1] - start[1];
  const pointX = normalizedLngDelta(point[0] - start[0]) * longitudeScale;
  const pointY = point[1] - start[1];
  const squaredLength = segmentX * segmentX + segmentY * segmentY;
  if (squaredLength <= 1e-16) return 0;
  return Math.max(0, Math.min(1, (pointX * segmentX + pointY * segmentY) / squaredLength));
}

function alongSegment(start: LngLat, end: LngLat, fraction: number): LngLat {
  return [
    start[0] + normalizedLngDelta(end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function originalRouteSegmentBearingDegrees(start: LngLat, end: LngLat) {
  const referenceLatitude = toRadians((start[1] + end[1]) / 2);
  const east = normalizedLngDelta(end[0] - start[0]) * Math.cos(referenceLatitude);
  const north = end[1] - start[1];
  if (Math.abs(east) + Math.abs(north) <= 1e-12) return null;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

function usableHeading(options: OriginalRouteProjectionOptions) {
  if (options.heading_deg == null) return null;
  const heading = Number(options.heading_deg);
  const speed = Number(options.speed_mps);
  return Number.isFinite(heading)
    && heading >= 0
    && heading < 360
    && Number.isFinite(speed)
    && speed >= MIN_HEADING_SPEED_MPS
    ? heading
    : null;
}

function byStableGeometry(a: ProjectionCandidate, b: ProjectionCandidate) {
  return a.distance_from_route_m - b.distance_from_route_m || a.segment_index - b.segment_index;
}

export function projectPointToOriginalRoute(
  route: LngLat[],
  point: LngLat,
  options: OriginalRouteProjectionOptions = {},
): OriginalRouteProjection | null {
  const clean = route.filter(coordinate => (
    Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1])
  ));
  if (clean.length < 2 || !point.every(Number.isFinite)) return null;

  const segmentLengths: number[] = [];
  const cumulative = [0];
  for (let index = 0; index < clean.length - 1; index += 1) {
    const length = distanceBetweenLngLatMeters(clean[index], clean[index + 1]);
    segmentLengths.push(Number.isFinite(length) ? length : 0);
    cumulative.push(cumulative[index] + segmentLengths[index]);
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= 0) return null;

  const candidates: ProjectionCandidate[] = [];
  for (let index = 0; index < clean.length - 1; index += 1) {
    const fraction = segmentFraction(point, clean[index], clean[index + 1]);
    const coordinate = alongSegment(clean[index], clean[index + 1], fraction);
    const distance = distanceBetweenLngLatMeters(point, coordinate);
    const progress = cumulative[index] + segmentLengths[index] * fraction;
    candidates.push({
      coordinate,
      route_progress_m: progress,
      route_ratio: progress / total,
      distance_from_route_m: distance,
      segment_index: index,
      segment_bearing_deg: originalRouteSegmentBearingDegrees(clean[index], clean[index + 1]),
    });
  }

  // Preserve the original nearest-segment behavior when callers provide no
  // map-matching context. In particular, exact ties retain the first segment.
  const nearest = candidates.reduce((best, candidate) => (
    candidate.distance_from_route_m < best.distance_from_route_m ? candidate : best
  ));
  const hasProgressHint = options.previous_route_ratio != null
    && Number.isFinite(options.previous_route_ratio);
  const heading = usableHeading(options);
  if (!hasProgressHint && heading == null) return nearest;

  // Only disambiguate segments whose projected route coordinates genuinely
  // coincide and whose distances from the fix are effectively tied. GPS
  // accuracy describes uncertainty in the fix, not equivalence between two
  // distinct nearby roads, so it must not widen either guard.
  const spatialCandidates = candidates.filter(candidate => (
    distanceBetweenLngLatMeters(candidate.coordinate, nearest.coordinate)
      <= MAX_EQUIVALENT_PROJECTION_SEPARATION_M
    && candidate.distance_from_route_m
      <= nearest.distance_from_route_m + MAX_EQUIVALENT_DISTANCE_FROM_FIX_DELTA_M
  ));

  if (!hasProgressHint) {
    return [...spatialCandidates].sort((a, b) => {
      const aHeading = a.segment_bearing_deg == null
        ? 180
        : angularDifferenceDegrees(heading!, a.segment_bearing_deg);
      const bHeading = b.segment_bearing_deg == null
        ? 180
        : angularDifferenceDegrees(heading!, b.segment_bearing_deg);
      return aHeading - bHeading || byStableGeometry(a, b);
    })[0];
  }

  const previousProgress = clamp(Number(options.previous_route_ratio), 0, 1) * total;
  const speed = Math.max(0, Number(options.speed_mps) || 0);
  const progressTieTolerance = clamp(
    speed * 3,
    MIN_PROGRESS_TIE_TOLERANCE_M,
    MAX_PROGRESS_TIE_TOLERANCE_M,
  );
  const closestProgressDelta = Math.min(...spatialCandidates.map(candidate => (
    Math.abs(candidate.route_progress_m - previousProgress)
  )));
  const continuousCandidates = spatialCandidates.filter(candidate => (
    Math.abs(candidate.route_progress_m - previousProgress) <= closestProgressDelta + progressTieTolerance
  ));

  return [...continuousCandidates].sort((a, b) => {
    if (heading != null) {
      const aHeading = a.segment_bearing_deg == null
        ? 180
        : angularDifferenceDegrees(heading, a.segment_bearing_deg);
      const bHeading = b.segment_bearing_deg == null
        ? 180
        : angularDifferenceDegrees(heading, b.segment_bearing_deg);
      if (aHeading !== bHeading) return aHeading - bHeading;
    }
    const aDelta = a.route_progress_m - previousProgress;
    const bDelta = b.route_progress_m - previousProgress;
    const aForward = aDelta >= 0;
    const bForward = bDelta >= 0;
    if (aForward !== bForward) return aForward ? -1 : 1;
    return Math.abs(aDelta) - Math.abs(bDelta) || byStableGeometry(a, b);
  })[0];
}

export function angularDifferenceDegrees(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}
