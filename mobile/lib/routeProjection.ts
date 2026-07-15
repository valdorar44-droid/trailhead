export type LngLat = [number, number];

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number) {
  return degrees * Math.PI / 180;
}

function normalizedLongitudeDelta(degrees: number) {
  return ((degrees + 540) % 360) - 180;
}

export function distanceBetweenLngLatMeters(a: LngLat, b: LngLat): number {
  if (![...a, ...b].every(Number.isFinite)) return Infinity;
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(normalizedLongitudeDelta(b[0] - a[0]));
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fractionAlongSegment(point: LngLat, start: LngLat, end: LngLat) {
  const referenceLat = toRadians((point[1] + start[1] + end[1]) / 3);
  const lngScale = Math.max(1e-6, Math.abs(Math.cos(referenceLat)));
  const segmentX = normalizedLongitudeDelta(end[0] - start[0]) * lngScale;
  const segmentY = end[1] - start[1];
  const pointX = normalizedLongitudeDelta(point[0] - start[0]) * lngScale;
  const pointY = point[1] - start[1];
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared <= 1e-16) return 0;
  return Math.max(0, Math.min(1, (pointX * segmentX + pointY * segmentY) / lengthSquared));
}

function pointAlongSegment(start: LngLat, end: LngLat, fraction: number): LngLat {
  return [
    start[0] + normalizedLongitudeDelta(end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ];
}

/** Project a point onto the closest route segment and return its metric route fraction. */
export function routeRatioForPoint(route: LngLat[], lat: number, lng: number): number {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 0.5;
  const cleanRoute = route.filter(coord => (
    Array.isArray(coord)
    && coord.length >= 2
    && Number.isFinite(coord[0])
    && Number.isFinite(coord[1])
  ));
  if (cleanRoute.length < 2) return 0.5;

  const segmentLengths: number[] = [];
  const cumulativeLengths = [0];
  for (let i = 1; i < cleanRoute.length; i += 1) {
    const length = distanceBetweenLngLatMeters(cleanRoute[i - 1], cleanRoute[i]);
    segmentLengths.push(Number.isFinite(length) ? length : 0);
    cumulativeLengths.push(cumulativeLengths[i - 1] + segmentLengths[i - 1]);
  }
  const totalLength = cumulativeLengths[cumulativeLengths.length - 1];
  if (totalLength <= 0) return 0.5;

  const point: LngLat = [lng, lat];
  let closestDistance = Infinity;
  let closestRouteDistance = totalLength / 2;
  for (let i = 0; i < cleanRoute.length - 1; i += 1) {
    const fraction = fractionAlongSegment(point, cleanRoute[i], cleanRoute[i + 1]);
    const projected = pointAlongSegment(cleanRoute[i], cleanRoute[i + 1], fraction);
    const distance = distanceBetweenLngLatMeters(point, projected);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestRouteDistance = cumulativeLengths[i] + segmentLengths[i] * fraction;
    }
  }

  return Math.max(0, Math.min(1, closestRouteDistance / totalLength));
}
