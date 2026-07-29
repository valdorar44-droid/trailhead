export type TrailCoordinate = readonly [lng: number, lat: number];

export type TrailLocationFix = Readonly<{
  lat: number;
  lng: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  headingDeg?: number | null;
  timestampMs: number;
}>;

export type SourcedTrailhead = Readonly<{
  name?: string;
  lat: number;
  lng: number;
  source?: string;
}>;

export type TrailFollowStartDecision =
  | Readonly<{ kind: 'follow'; distanceFromRouteM: number }>
  | Readonly<{ kind: 'handoff'; trailhead: SourcedTrailhead; distanceToTrailheadM: number }>
  | Readonly<{ kind: 'needs_location' }>
  | Readonly<{ kind: 'unavailable'; reason: 'route_missing' | 'source_backed_trailhead_missing' }>;

export type TrailFollowMetrics = Readonly<{
  gps: 'good' | 'weak';
  progressM: number;
  remainingM: number;
  routeDistanceM: number;
  deviationM: number;
  segmentIndex: number;
  nextCue: string;
  nextCueDistanceM: number | null;
  bearingDeg: number | null;
  offRoute: boolean;
  complete: boolean;
}>;

type RouteProjection = Readonly<{
  progressM: number;
  routeDistanceM: number;
  distanceM: number;
  segmentIndex: number;
}>;

const EARTH_RADIUS_M = 6_371_000;

function radians(value: number) {
  return value * Math.PI / 180;
}

function degrees(value: number) {
  return value * 180 / Math.PI;
}

export function trailDistanceM(a: Readonly<{ lat: number; lng: number }>, b: Readonly<{ lat: number; lng: number }>) {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function localMeters(origin: Readonly<{ lat: number; lng: number }>, point: Readonly<{ lat: number; lng: number }>) {
  const latScale = Math.PI * EARTH_RADIUS_M / 180;
  const lngScale = latScale * Math.max(0.1, Math.cos(radians(origin.lat)));
  return {
    x: (point.lng - origin.lng) * lngScale,
    y: (point.lat - origin.lat) * latScale,
  };
}

function projectFixToRoute(fix: TrailLocationFix, route: readonly TrailCoordinate[]): RouteProjection | null {
  if (route.length < 2) return null;
  let routeDistanceM = 0;
  let best: RouteProjection | null = null;
  for (let index = 0; index < route.length - 1; index += 1) {
    const a = { lng: route[index][0], lat: route[index][1] };
    const b = { lng: route[index + 1][0], lat: route[index + 1][1] };
    const av = localMeters(fix, a);
    const bv = localMeters(fix, b);
    const dx = bv.x - av.x;
    const dy = bv.y - av.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, -(av.x * dx + av.y * dy) / lengthSquared))
      : 0;
    const px = av.x + dx * t;
    const py = av.y + dy * t;
    const distanceM = Math.hypot(px, py);
    const segmentM = Math.sqrt(lengthSquared);
    const candidate = {
      progressM: routeDistanceM + segmentM * t,
      routeDistanceM: 0,
      distanceM,
      segmentIndex: index,
    };
    if (!best || candidate.distanceM < best.distanceM) best = candidate;
    routeDistanceM += segmentM;
  }
  return best ? { ...best, routeDistanceM } : null;
}

function bearingBetween(a: TrailCoordinate, b: TrailCoordinate) {
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const dLng = radians(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

function turnDelta(a: number, b: number) {
  let delta = ((b - a + 540) % 360) - 180;
  if (Math.abs(delta) < 1) delta = 0;
  return delta;
}

function nextShapeCue(route: readonly TrailCoordinate[], projection: RouteProjection) {
  const start = Math.max(0, projection.segmentIndex);
  let distanceM = 0;
  for (let index = start; index < route.length - 2; index += 1) {
    const segmentDistance = trailDistanceM(
      { lng: route[index][0], lat: route[index][1] },
      { lng: route[index + 1][0], lat: route[index + 1][1] },
    );
    distanceM += segmentDistance;
    const incoming = bearingBetween(route[index], route[index + 1]);
    const outgoing = bearingBetween(route[index + 1], route[index + 2]);
    const delta = turnDelta(incoming, outgoing);
    if (Math.abs(delta) >= 35 && distanceM >= 12) {
      return {
        label: delta > 0 ? 'Bear right' : 'Bear left',
        distanceM,
        bearingDeg: outgoing,
      };
    }
  }
  const last = route[route.length - 1];
  const current = route[Math.min(route.length - 2, Math.max(0, start))];
  return {
    label: projection.routeDistanceM - projection.progressM <= 35 ? 'Trail end' : 'Stay on trail',
    distanceM: Math.max(0, projection.routeDistanceM - projection.progressM),
    bearingDeg: bearingBetween(current, last),
  };
}

function validTrailhead(trailhead: SourcedTrailhead) {
  return Number.isFinite(trailhead.lat)
    && Math.abs(trailhead.lat) <= 90
    && Number.isFinite(trailhead.lng)
    && Math.abs(trailhead.lng) <= 180
    && String(trailhead.source ?? '').trim().length > 0;
}

export function resolveTrailFollowStart(input: Readonly<{
  fix: TrailLocationFix | null;
  route: readonly TrailCoordinate[];
  trailheads: readonly SourcedTrailhead[];
  nearbyRouteM?: number;
}>): TrailFollowStartDecision {
  if (input.route.length < 2) return { kind: 'unavailable', reason: 'route_missing' };
  if (!input.fix) return { kind: 'needs_location' };
  const projection = projectFixToRoute(input.fix, input.route);
  if (!projection) return { kind: 'unavailable', reason: 'route_missing' };
  const nearThreshold = Math.max(input.nearbyRouteM ?? 250, (input.fix.accuracyM ?? 0) * 1.5);
  if (projection.distanceM <= nearThreshold) {
    return { kind: 'follow', distanceFromRouteM: projection.distanceM };
  }
  const sourced = input.trailheads.filter(validTrailhead);
  if (!sourced.length) return { kind: 'unavailable', reason: 'source_backed_trailhead_missing' };
  const nearest = sourced
    .map(trailhead => ({ trailhead, distanceM: trailDistanceM(input.fix!, trailhead) }))
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  return { kind: 'handoff', trailhead: nearest.trailhead, distanceToTrailheadM: nearest.distanceM };
}

export function evaluateTrailFollow(
  fix: TrailLocationFix,
  route: readonly TrailCoordinate[],
): TrailFollowMetrics | null {
  const projection = projectFixToRoute(fix, route);
  if (!projection) return null;
  const accuracyM = Number.isFinite(fix.accuracyM) ? Math.max(0, Number(fix.accuracyM)) : 999;
  const gps = accuracyM <= 50 ? 'good' : 'weak';
  const offRouteThresholdM = Math.max(35, accuracyM * 1.5);
  const offRoute = gps === 'good' && projection.distanceM > offRouteThresholdM;
  const cue = nextShapeCue(route, projection);
  const remainingM = Math.max(0, projection.routeDistanceM - projection.progressM);
  return {
    gps,
    progressM: projection.progressM,
    remainingM,
    routeDistanceM: projection.routeDistanceM,
    deviationM: projection.distanceM,
    segmentIndex: projection.segmentIndex,
    nextCue: gps === 'weak' ? 'Waiting for a better GPS fix' : offRoute ? 'Return to the trail' : cue.label,
    nextCueDistanceM: gps === 'weak' || offRoute ? null : cue.distanceM,
    bearingDeg: gps === 'weak' ? null : cue.bearingDeg,
    offRoute,
    complete: gps === 'good' && remainingM <= 25 && projection.distanceM <= offRouteThresholdM,
  };
}
