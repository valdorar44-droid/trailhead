import type { OfflineBoundsV2 } from './types';

type TrailCoordinateV2 = readonly [number, number];

function coordinate(value: unknown): TrailCoordinateV2 | null {
  if (!Array.isArray(value) || value.length < 2 || Array.isArray(value[0])) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function within(point: TrailCoordinateV2, bounds: OfflineBoundsV2) {
  return point[0] >= bounds.west && point[0] <= bounds.east
    && point[1] >= bounds.south && point[1] <= bounds.north;
}

/** Return the first point where a line segment enters the selected rectangle. */
function clippedSegmentPoint(
  start: TrailCoordinateV2,
  end: TrailCoordinateV2,
  bounds: OfflineBoundsV2,
): TrailCoordinateV2 | null {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  let minimum = 0;
  let maximum = 1;
  const clip = (direction: number, distance: number) => {
    if (direction === 0) return distance >= 0;
    const ratio = distance / direction;
    if (direction < 0) {
      if (ratio > maximum) return false;
      if (ratio > minimum) minimum = ratio;
    } else {
      if (ratio < minimum) return false;
      if (ratio < maximum) maximum = ratio;
    }
    return true;
  };
  if (!clip(-dx, start[0] - bounds.west)
    || !clip(dx, bounds.east - start[0])
    || !clip(-dy, start[1] - bounds.south)
    || !clip(dy, bounds.north - start[1])) return null;
  const point: TrailCoordinateV2 = [
    Math.max(bounds.west, Math.min(bounds.east, start[0] + minimum * dx)),
    Math.max(bounds.south, Math.min(bounds.north, start[1] + minimum * dy)),
  ];
  return within(point, bounds) ? point : null;
}

function coordinateTreePoint(value: unknown, bounds: OfflineBoundsV2): TrailCoordinateV2 | null {
  if (!Array.isArray(value)) return null;
  const direct = coordinate(value);
  if (direct) return within(direct, bounds) ? direct : null;

  const sequence = value.map(coordinate);
  if (sequence.every((point): point is TrailCoordinateV2 => point !== null)) {
    const inside = sequence.find(point => within(point, bounds));
    if (inside) return inside;
    for (let index = 1; index < sequence.length; index += 1) {
      const clipped = clippedSegmentPoint(sequence[index - 1], sequence[index], bounds);
      if (clipped) return clipped;
    }
    return null;
  }
  for (const nested of value) {
    const point = coordinateTreePoint(nested, bounds);
    if (point) return point;
  }
  return null;
}

/**
 * Derive a deterministic point on downloaded geometry inside the bundle.
 * This keeps a crossing trail searchable even when its canonical trailhead or
 * representative anchor lies outside the selected area.
 */
export function trailGeometryRepresentativePointV2(
  geometry: unknown,
  bounds: OfflineBoundsV2,
): TrailCoordinateV2 | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const candidate = geometry as { coordinates?: unknown; geometries?: unknown };
  const coordinatePoint = coordinateTreePoint(candidate.coordinates, bounds);
  if (coordinatePoint) return coordinatePoint;
  if (!Array.isArray(candidate.geometries)) return null;
  for (const nested of candidate.geometries) {
    const point = trailGeometryRepresentativePointV2(nested, bounds);
    if (point) return point;
  }
  return null;
}
