import { distanceBetweenLngLatMeters, type LngLat } from '../routeProjection';

export type OriginalRouteDisplayModel = {
  coordinates: LngLat[];
  completed: LngLat[];
  remaining: LngLat[];
  marker: LngLat | null;
  progress_m: number;
  remaining_m: number;
  progress_ratio: number;
  progress_known: boolean;
};

function cleanCoordinates(coordinates: LngLat[]) {
  return coordinates
    .filter(coordinate => (
      Array.isArray(coordinate)
      && coordinate.length >= 2
      && coordinate.every(Number.isFinite)
      && Math.abs(coordinate[0]) <= 180
      && Math.abs(coordinate[1]) <= 90
    ))
    .map(coordinate => [coordinate[0], coordinate[1]] as LngLat);
}

function interpolate(start: LngLat, end: LngLat, ratio: number): LngLat {
  const longitudeDelta = ((end[0] - start[0] + 540) % 360) - 180;
  return [
    start[0] + longitudeDelta * ratio,
    start[1] + (end[1] - start[1]) * ratio,
  ];
}

function splitAtRatio(coordinates: LngLat[], ratio: number) {
  if (coordinates.length < 2) {
    const marker = coordinates[0] ?? null;
    return { completed: marker ? [marker] : [], remaining: coordinates, marker };
  }
  if (ratio <= 0) {
    return { completed: [coordinates[0]], remaining: coordinates, marker: coordinates[0] };
  }
  if (ratio >= 1) {
    const marker = coordinates[coordinates.length - 1];
    return { completed: coordinates, remaining: [marker], marker };
  }
  const segmentLengths: number[] = [];
  let geometryDistance = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const distance = distanceBetweenLngLatMeters(coordinates[index - 1], coordinates[index]);
    const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
    segmentLengths.push(safeDistance);
    geometryDistance += safeDistance;
  }
  if (geometryDistance <= 0) {
    return { completed: [coordinates[0]], remaining: coordinates, marker: coordinates[0] };
  }

  const target = geometryDistance * ratio;
  let traversed = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const segmentDistance = segmentLengths[index - 1];
    if (traversed + segmentDistance >= target) {
      const segmentRatio = segmentDistance <= 0 ? 0 : (target - traversed) / segmentDistance;
      const marker = interpolate(coordinates[index - 1], coordinates[index], segmentRatio);
      return {
        completed: [...coordinates.slice(0, index), marker],
        remaining: [marker, ...coordinates.slice(index)],
        marker,
      };
    }
    traversed += segmentDistance;
  }
  const marker = coordinates[coordinates.length - 1];
  return { completed: coordinates, remaining: [marker], marker };
}

export function originalRouteDisplayModel(
  routeCoordinates: LngLat[],
  authoredDistanceM: number,
  projectedProgressM: number | null | undefined,
): OriginalRouteDisplayModel {
  const coordinates = cleanCoordinates(routeCoordinates);
  const routeDistance = Number.isFinite(authoredDistanceM) ? Math.max(0, authoredDistanceM) : 0;
  const progressKnown = Number.isFinite(projectedProgressM);
  const rawProgress = progressKnown ? Number(projectedProgressM) : 0;
  const progress = routeDistance > 0 ? Math.max(0, Math.min(routeDistance, rawProgress)) : 0;
  const progressRatio = routeDistance > 0 ? progress / routeDistance : 0;
  const split = progressKnown
    ? splitAtRatio(coordinates, progressRatio)
    : { completed: [] as LngLat[], remaining: coordinates, marker: null };
  return {
    coordinates,
    ...split,
    progress_m: progress,
    remaining_m: Math.max(0, routeDistance - progress),
    progress_ratio: progressRatio,
    progress_known: progressKnown,
  };
}
