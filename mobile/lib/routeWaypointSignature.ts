export type RoutableWaypointLike = {
  lat?: number | null;
  lng?: number | null;
  day?: number | string | null;
  type?: string | null;
  route_point_type?: string | null;
  routePointType?: string | null;
};

export type RouteGeometryIdentity = {
  coords?: unknown;
  routeWaypointSignature?: string | null;
  route_waypoint_signature?: string | null;
  waypointSignature?: string | null;
  waypoint_signature?: string | null;
  routableWaypointSignature?: string | null;
  routable_waypoint_signature?: string | null;
};

function canonicalNumber(value: number) {
  return Object.is(value, -0) ? '0' : String(value);
}

function validCoordinate(lngValue: unknown, latValue: unknown): [number, number] | null {
  if (lngValue == null || latValue == null || lngValue === '' || latValue === '') return null;
  const lng = Number(lngValue);
  const lat = Number(latValue);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [lng, lat];
}

export function routableWaypointCoordinates(waypoints: readonly RoutableWaypointLike[] | null | undefined) {
  const coords: [number, number][] = [];
  for (const waypoint of waypoints ?? []) {
    if (normalizedRoutePointType(waypoint) === 'side_stop') continue;
    const coord = validCoordinate(waypoint?.lng, waypoint?.lat);
    if (coord) coords.push(coord);
  }
  return coords;
}

export function routeCoordinateSignature(coords: readonly (readonly [number, number])[] | null | undefined) {
  const parts: string[] = [];
  for (const coord of coords ?? []) {
    const clean = validCoordinate(coord?.[0], coord?.[1]);
    if (!clean) continue;
    parts.push(`${canonicalNumber(clean[0])},${canonicalNumber(clean[1])}`);
  }
  return `rwp1:${parts.join('|')}`;
}

export function routeWaypointSignature(waypoints: readonly RoutableWaypointLike[] | null | undefined) {
  return routeCoordinateSignature(routableWaypointCoordinates(waypoints));
}

export function savedRouteWaypointSignature(route: RouteGeometryIdentity | null | undefined) {
  const mobile = route?.routeWaypointSignature ?? route?.route_waypoint_signature;
  if (typeof mobile === 'string' && mobile.startsWith('rwp1:')) return mobile;
  const backendRoutable = route?.routableWaypointSignature ?? route?.routable_waypoint_signature;
  if (typeof backendRoutable === 'string') return `planner-routable:${backendRoutable}`;
  const backendFull = route?.waypointSignature ?? route?.waypoint_signature;
  return typeof backendFull === 'string' ? `planner-full:${backendFull}` : null;
}

function normalizedRoutePointType(waypoint: RoutableWaypointLike | null | undefined) {
  const role = String(waypoint?.route_point_type ?? waypoint?.routePointType ?? 'break').trim().toLowerCase();
  return role === 'through' || role === 'side_stop' ? role : 'break';
}

/** Matches the server planner's persisted signature contract. */
export function plannerWaypointSignature(
  waypoints: readonly RoutableWaypointLike[] | null | undefined,
  routableOnly = false,
) {
  const parts: string[] = [];
  for (const waypoint of waypoints ?? []) {
    const role = normalizedRoutePointType(waypoint);
    if (routableOnly && role === 'side_stop') continue;
    const coord = validCoordinate(waypoint?.lng, waypoint?.lat);
    if (!coord) continue;
    const rawDay = Number(waypoint?.day || 1);
    const day = Number.isFinite(rawDay) ? String(rawDay) : '1';
    const waypointType = String(waypoint?.type || 'waypoint').trim().toLowerCase();
    parts.push(`${coord[0].toFixed(5)},${coord[1].toFixed(5)}:${day}:${waypointType}:${role}`);
  }
  return parts.join('|');
}

function mixHash(hash: number, value: string) {
  let next = hash >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 16777619) >>> 0;
  }
  return next;
}

/** A bounded-memory identity that still visits every coordinate. */
export function routeGeometryContentSignature(coords: unknown) {
  if (!Array.isArray(coords)) return 'rg1:0:0';
  let hash = 2166136261;
  let count = 0;
  for (const coord of coords) {
    if (!Array.isArray(coord)) continue;
    const clean = validCoordinate(coord[0], coord[1]);
    if (!clean) continue;
    hash = mixHash(hash, `${canonicalNumber(clean[0])},${canonicalNumber(clean[1])}|`);
    count += 1;
  }
  return `rg1:${count}:${hash.toString(16).padStart(8, '0')}`;
}

function distanceM(a: [number, number], b: [number, number]) {
  const radius = 6_371_000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function hasPlausibleRouteSegments(coords: readonly [number, number][]) {
  for (let index = 1; index < coords.length; index += 1) {
    if (distanceM(coords[index - 1], coords[index]) > 1_000_000) return false;
  }
  return true;
}

function pointToSegmentDistanceM(point: [number, number], start: [number, number], end: [number, number]) {
  const meanLat = ((point[1] + start[1] + end[1]) / 3) * Math.PI / 180;
  const scaleX = 111_320 * Math.max(0.01, Math.cos(meanLat));
  const scaleY = 110_540;
  const px = (point[0] - start[0]) * scaleX;
  const py = (point[1] - start[1]) * scaleY;
  const ex = (end[0] - start[0]) * scaleX;
  const ey = (end[1] - start[1]) * scaleY;
  const denominator = ex * ex + ey * ey;
  const ratio = denominator > 0 ? Math.max(0, Math.min(1, (px * ex + py * ey) / denominator)) : 0;
  return { distanceM: Math.hypot(px - ratio * ex, py - ratio * ey), ratio };
}

/**
 * Compatibility check for routes saved before waypoint signatures existed.
 * Every required stop must occur near the line in the same order.
 */
export function routeGeometryMatchesWaypointsInOrder(
  coordsValue: unknown,
  waypoints: readonly RoutableWaypointLike[] | null | undefined,
  toleranceM = 8_000,
) {
  if (!Array.isArray(coordsValue)) return false;
  const clean: [number, number][] = [];
  for (const coord of coordsValue) {
    if (!Array.isArray(coord)) continue;
    const next = validCoordinate(coord[0], coord[1]);
    if (!next) continue;
    const previous = clean[clean.length - 1];
    if (!previous || previous[0] !== next[0] || previous[1] !== next[1]) clean.push(next);
  }
  const required = routableWaypointCoordinates(waypoints);
  if (clean.length < 2 || required.length < 2) return false;
  if (!hasPlausibleRouteSegments(clean)) return false;
  if (distanceM(clean[0], required[0]) > toleranceM) return false;
  if (distanceM(clean[clean.length - 1], required[required.length - 1]) > toleranceM) return false;

  const stride = Math.max(1, Math.ceil(clean.length / 4_000));
  const sampled = clean.filter((_, index) => index % stride === 0);
  const final = clean[clean.length - 1];
  if (sampled[sampled.length - 1] !== final) sampled.push(final);

  let searchStart = 0;
  let searchRatio = 0;
  for (let waypointIndex = 1; waypointIndex < required.length - 1; waypointIndex += 1) {
    let bestSegment = -1;
    let bestRatio = 0;
    let bestDistance = Infinity;
    for (let segmentIndex = searchStart; segmentIndex < sampled.length - 1; segmentIndex += 1) {
      const candidate = pointToSegmentDistanceM(required[waypointIndex], sampled[segmentIndex], sampled[segmentIndex + 1]);
      if (segmentIndex === searchStart && candidate.ratio + 1e-9 < searchRatio) continue;
      if (candidate.distanceM < bestDistance) {
        bestDistance = candidate.distanceM;
        bestSegment = segmentIndex;
        bestRatio = candidate.ratio;
      }
    }
    if (bestSegment < 0 || bestDistance > toleranceM) return false;
    searchStart = bestSegment;
    searchRatio = bestRatio;
  }
  return true;
}

export function routeGeometryMatchesWaypointIdentity(
  route: RouteGeometryIdentity | null | undefined,
  waypoints: readonly RoutableWaypointLike[] | null | undefined,
  expectedSignature = routeWaypointSignature(waypoints),
) {
  if (!routeGeometryMatchesWaypointsInOrder(route?.coords, waypoints)) return false;
  const backendRoutable = route?.routableWaypointSignature ?? route?.routable_waypoint_signature;
  if (typeof backendRoutable === 'string') {
    return backendRoutable === plannerWaypointSignature(waypoints, true);
  }
  const mobile = route?.routeWaypointSignature ?? route?.route_waypoint_signature;
  if (typeof mobile === 'string' && mobile.startsWith('rwp1:')) return mobile === expectedSignature;
  const backendFull = route?.waypointSignature ?? route?.waypoint_signature;
  if (typeof backendFull === 'string') {
    return backendFull === plannerWaypointSignature(waypoints, false);
  }
  return routeGeometryMatchesWaypointsInOrder(route?.coords, waypoints);
}

export function withRouteWaypointIdentity<T extends RouteGeometryIdentity>(
  route: T,
  waypoints: readonly RoutableWaypointLike[] | null | undefined,
): T & Partial<Pick<RouteGeometryIdentity, 'routeWaypointSignature' | 'waypointSignature' | 'routableWaypointSignature'>> {
  if (!routeGeometryMatchesWaypointIdentity(route, waypoints)) return route;
  return {
    ...route,
    routeWaypointSignature: routeWaypointSignature(waypoints),
    waypointSignature: plannerWaypointSignature(waypoints),
    routableWaypointSignature: plannerWaypointSignature(waypoints, true),
  };
}
