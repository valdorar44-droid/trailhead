import { distanceBetweenLngLatMeters, type LngLat } from '../routeProjection';

export type OriginalRouteProjection = {
  coordinate: LngLat;
  route_progress_m: number;
  route_ratio: number;
  distance_from_route_m: number;
  segment_index: number;
};

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

export function projectPointToOriginalRoute(route: LngLat[], point: LngLat): OriginalRouteProjection | null {
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

  let best: OriginalRouteProjection | null = null;
  for (let index = 0; index < clean.length - 1; index += 1) {
    const fraction = segmentFraction(point, clean[index], clean[index + 1]);
    const coordinate = alongSegment(clean[index], clean[index + 1], fraction);
    const distance = distanceBetweenLngLatMeters(point, coordinate);
    const progress = cumulative[index] + segmentLengths[index] * fraction;
    if (!best || distance < best.distance_from_route_m) {
      best = {
        coordinate,
        route_progress_m: progress,
        route_ratio: progress / total,
        distance_from_route_m: distance,
        segment_index: index,
      };
    }
  }
  return best;
}

export function angularDifferenceDegrees(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}
