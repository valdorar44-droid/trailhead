import type { OfflineTrail } from './offlineTrails';

export const TRAIL_SHARE_WEB_PREFIX = 'https://gettrailhead.app/app/trails/shared#token=';
export const TRAIL_SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type OwnedTrailRouteOriginV1 = 'builder' | 'gpx' | 'recording';
export type OwnedTrailRouteVisibilityV1 = 'private' | 'unlisted';

export type OwnedTrailAccessPointV1 = Readonly<{
  name?: string;
  lat: number;
  lng: number;
  source?: string;
}>;

export type OwnedTrailSourceEvidenceV1 = Readonly<{
  title?: string;
  publisher?: string;
  kind?: string;
  url?: string;
  reviewed_at?: string;
}>;

export type CanonicalTrailLineV1 = Readonly<{
  type: 'LineString';
  coordinates: readonly (readonly [number, number])[];
}>;

export type OwnedTrailRouteV1 = Readonly<{
  id: string;
  origin: OwnedTrailRouteOriginV1;
  title: string;
  description?: string | null;
  activity?: string | null;
  route_shape?: string | null;
  geometry: CanonicalTrailLineV1;
  revision: number;
  content_revision?: number;
  geometry_revision: number;
  geometry_sha256: string;
  trailheads?: readonly Record<string, unknown>[];
  permitted_uses?: readonly string[];
  source_evidence?: readonly Record<string, unknown>[];
  photos?: readonly Record<string, unknown>[];
  visibility: OwnedTrailRouteVisibilityV1;
  privacy_reviewed_at?: number | null;
  share_enabled: boolean;
  share_revision?: number;
  share_route_revision?: number | null;
  created_at?: number;
  updated_at?: number;
}>;

/** Compact owner-list item. Full geometry and evidence are fetched by ID. */
export type OwnedTrailRouteSummaryV1 = Readonly<{
  id: string;
  origin: OwnedTrailRouteOriginV1;
  title: string;
  activity?: string | null;
  route_shape?: string | null;
  revision: number;
  content_revision?: number;
  geometry_revision: number;
  geometry_sha256: string;
  visibility: OwnedTrailRouteVisibilityV1;
  privacy_reviewed_at?: number | null;
  share_enabled: boolean;
  share_revision?: number;
  share_route_revision?: number | null;
  created_at?: number;
  updated_at?: number;
}>;

export type SharedTrailRouteV1 = Readonly<{
  version: 1;
  shared_route_id: string;
  route_revision: number;
  share_revision: number;
  origin: OwnedTrailRouteOriginV1;
  title: string;
  description?: string | null;
  activity?: string | null;
  route_shape?: string | null;
  geometry: CanonicalTrailLineV1;
  geometry_revision: number;
  geometry_sha256: string;
  trailheads?: readonly Record<string, unknown>[];
  permitted_uses?: readonly string[];
  source_evidence?: readonly Record<string, unknown>[];
  photos?: readonly Record<string, unknown>[];
}>;

export type OwnedTrailRouteCreateV1 = Readonly<{
  origin: OwnedTrailRouteOriginV1;
  title: string;
  geometry: CanonicalTrailLineV1;
  activity?: string;
  route_shape?: string;
  permitted_uses: readonly string[];
  trailheads: readonly OwnedTrailAccessPointV1[];
  source_evidence: readonly OwnedTrailSourceEvidenceV1[];
  photos: readonly never[];
}>;

export type OwnedTrailRouteUpdateV1 = Readonly<{
  expected_revision: number;
  title?: string;
  geometry?: CanonicalTrailLineV1;
  description?: string;
  activity?: string;
  route_shape?: string;
  permitted_uses?: readonly string[];
  trailheads?: readonly OwnedTrailAccessPointV1[];
  source_evidence?: readonly OwnedTrailSourceEvidenceV1[];
  photos?: readonly never[];
  privacy_reviewed?: boolean;
}>;

export type TrailRouteShareMutationV1 = Readonly<{
  route: OwnedTrailRouteV1;
  share_revision: number;
  share_token?: string | null;
  share_url?: string | null;
  resolver_path?: string;
  link_exists?: boolean;
  rotate_required?: boolean;
}>;

export type TrailRouteRevokeMutationV1 = Readonly<{
  route: OwnedTrailRouteV1;
  revoked: true;
}>;

export type TrailRouteSharingRequestKeyV1 = Readonly<{
  ownerScope: string;
  localRouteId: string;
  localRevision: number;
  generation: number;
}>;

export type TrailRouteCropV1 = Readonly<{
  start: number;
  finish: number;
}>;

export type PreparedTrailRouteUploadV1 = Readonly<{
  payload: OwnedTrailRouteCreateV1;
  sourcePointCount: number;
  retainedPointCount: number;
  sourceDistanceM: number;
  retainedDistanceM: number;
  crop: TrailRouteCropV1;
}>;

export type SharedTrailRecipientStateV1 =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; route: SharedTrailRouteV1 }>
  | Readonly<{ status: 'offline' }>
  | Readonly<{ status: 'unavailable' }>;

const ALLOWED_ACTIVITIES = new Set([
  'hiking', 'walking', 'running', 'backpacking', 'biking', 'mountain_biking',
  'horseback', 'ohv', '4wd', 'motorcycle', 'skiing', 'snowshoeing', 'mixed_use',
]);
const ALLOWED_ROUTE_SHAPES = new Set(['loop', 'out_and_back', 'point_to_point', 'one_way']);
const TRAIL_ROUTE_MAX_POINTS = 50_000;
const TRAIL_ROUTE_MAX_JUMP_M = 25_000;
const TRAIL_ROUTE_MAX_TOTAL_M = 10_000_000;

function finiteCoordinate(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length < 2 || typeof raw[0] === 'boolean' || typeof raw[1] === 'boolean') {
    return null;
  }
  const lng = Number(raw[0]);
  const lat = Number(raw[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
    return null;
  }
  return [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
}

function lineCoordinates(geometry: GeoJSON.Geometry | null | undefined): [number, number][][] {
  if (!geometry) return [];
  if (geometry.type === 'LineString') {
    const line = geometry.coordinates.map(raw => {
      const point = finiteCoordinate(raw);
      if (!point) throw new Error('This saved route contains an invalid point. Review it in Trail Builder before sharing.');
      return point;
    });
    return line.length >= 2 ? [line] : [];
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates
      .map(line => line.map(raw => {
        const point = finiteCoordinate(raw);
        if (!point) throw new Error('This saved route contains an invalid point. Review it in Trail Builder before sharing.');
        return point;
      }))
      .filter(line => line.length >= 2);
  }
  return [];
}

function samePoint(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function dedupeConsecutive(points: readonly (readonly [number, number])[]): [number, number][] {
  const output: [number, number][] = [];
  for (const point of points) {
    if (!output.length || !samePoint(output[output.length - 1], point)) output.push([point[0], point[1]]);
  }
  return output;
}

function distanceM(a: readonly [number, number], b: readonly [number, number]): number {
  const radius = 6_371_008.8;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function trailLineDistanceM(points: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distanceM(points[index - 1], points[index]);
  return total;
}

function validateTrailRouteGeometryForUpload(
  points: readonly (readonly [number, number])[],
): void {
  if (points.length > TRAIL_ROUTE_MAX_POINTS) {
    throw new Error('This saved route has too many points. Simplify it in Trail Builder before sharing.');
  }
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segment = distanceM(points[index - 1], points[index]);
    if (segment > TRAIL_ROUTE_MAX_JUMP_M) {
      throw new Error('This saved route has a gap between points. Open it in Trail Builder and add points along the route before sharing.');
    }
    total += segment;
  }
  if (total > TRAIL_ROUTE_MAX_TOTAL_M) {
    throw new Error('This saved route is too long to share as one trail. Split it into shorter routes first.');
  }
}

/**
 * Converts a legacy OfflineTrail into the only geometry shape allowed to leave
 * the device. Properties, altitude, timestamps, speed, accuracy, headings,
 * waypoints, EXIF and device metadata are deliberately not read or returned.
 */
export function canonicalCoordinatesFromOfflineTrail(trail: OfflineTrail): [number, number][] {
  const lines = trail.geometry.features.flatMap(feature => lineCoordinates(feature.geometry));
  if (!lines.length) return [];
  const output = dedupeConsecutive(lines[0]);
  for (const candidate of lines.slice(1)) {
    const line = dedupeConsecutive(candidate);
    const tail = output[output.length - 1];
    if (samePoint(tail, line[0])) {
      output.push(...line.slice(1));
      continue;
    }
    if (samePoint(tail, line[line.length - 1])) {
      output.push(...line.slice(0, -1).reverse());
      continue;
    }
    throw new Error('This saved route has disconnected sections. Review it in Trail Builder before sharing.');
  }
  return dedupeConsecutive(output);
}

export function normalizeTrailRouteCrop(crop: Partial<TrailRouteCropV1> | null | undefined): TrailRouteCropV1 {
  const rawStart = Number(crop?.start ?? 0);
  const rawFinish = Number(crop?.finish ?? 1);
  const start = Number.isFinite(rawStart) ? Math.max(0, Math.min(0.98, rawStart)) : 0;
  const finish = Number.isFinite(rawFinish) ? Math.max(0.02, Math.min(1, rawFinish)) : 1;
  if (finish - start < 0.02) {
    return start >= 0.5
      ? { start: Math.max(0, finish - 0.02), finish }
      : { start, finish: Math.min(1, start + 0.02) };
  }
  return { start, finish };
}

export function cropCanonicalTrailCoordinates(
  coordinates: readonly (readonly [number, number])[],
  crop: Partial<TrailRouteCropV1> | null | undefined,
): [number, number][] {
  if (coordinates.length < 2) return [];
  const normalized = normalizeTrailRouteCrop(crop);
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distanceM(coordinates[index - 1], coordinates[index]));
  }
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total < 1) return [];
  const startDistance = total * normalized.start;
  const finishDistance = total * normalized.finish;

  const pointAtDistance = (target: number): [number, number] => {
    if (target <= 0) return [coordinates[0][0], coordinates[0][1]];
    if (target >= total) {
      const last = coordinates[coordinates.length - 1];
      return [last[0], last[1]];
    }
    let upper = 1;
    while (upper < cumulative.length && cumulative[upper] < target) upper += 1;
    const lower = Math.max(0, upper - 1);
    const segmentDistance = Math.max(0.000001, cumulative[upper] - cumulative[lower]);
    const fraction = Math.max(0, Math.min(1, (target - cumulative[lower]) / segmentDistance));
    const from = coordinates[lower];
    const to = coordinates[upper];
    return [
      Number((from[0] + (to[0] - from[0]) * fraction).toFixed(7)),
      Number((from[1] + (to[1] - from[1]) * fraction).toFixed(7)),
    ];
  };

  const output: [number, number][] = [pointAtDistance(startDistance)];
  for (let index = 1; index < coordinates.length - 1; index += 1) {
    if (cumulative[index] > startDistance && cumulative[index] < finishDistance) {
      output.push([coordinates[index][0], coordinates[index][1]]);
    }
  }
  output.push(pointAtDistance(finishDistance));
  return dedupeConsecutive(output);
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanActivity(value: unknown): string | undefined {
  const normalized = cleanText(value, 60).toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    hike: 'hiking', walk: 'walking', run: 'running', bike: 'biking',
    mountain_bike: 'mountain_biking', horse: 'horseback', horseback_riding: 'horseback',
    '4x4': '4wd', four_wheel_drive: '4wd', off_road: 'ohv', mixed: 'mixed_use',
  };
  const canonical = aliases[normalized] || normalized;
  return ALLOWED_ACTIVITIES.has(canonical) ? canonical : undefined;
}

function cleanRouteShape(value: unknown): string | undefined {
  const normalized = cleanText(value, 60).toLowerCase().replace(/[\s-]+/g, '_');
  return ALLOWED_ROUTE_SHAPES.has(normalized) ? normalized : undefined;
}

export function inferOwnedTrailRouteOrigin(trail: OfflineTrail): OwnedTrailRouteOriginV1 {
  if (trail.ownerRouteOrigin === 'builder' || trail.ownerRouteOrigin === 'gpx' || trail.ownerRouteOrigin === 'recording') {
    return trail.ownerRouteOrigin;
  }
  const explicit = trail.sharing?.origin;
  if (explicit === 'builder' || explicit === 'gpx' || explicit === 'recording') return explicit;
  if (trail.builder?.mode === 'gpx') return 'gpx';
  if (trail.builder) return 'builder';
  throw new Error('Open this route in Trail Builder and save it before sharing.');
}

/**
 * Builds the local route reviewed after a recording ends. Only longitude and
 * latitude are copied. Recording times, altitude, accuracy, speed, heading,
 * device fields and hidden waypoints cannot reach the sharing payload.
 */
export function offlineTrailFromRecordingForPrivacyReview<T extends Readonly<{ lat: unknown; lng: unknown }>>(input: Readonly<{
  recordingId: string;
  trailName: string;
  savedAt: number;
  points: readonly T[];
}>): OfflineTrail {
  const coordinates = dedupeConsecutive(input.points.map(point => {
    const coordinate = finiteCoordinate([point.lng, point.lat]);
    if (!coordinate) throw new Error('This recording contains an invalid point and cannot be shared.');
    return coordinate;
  }));
  if (coordinates.length < 2 || trailLineDistanceM(coordinates) < 1) {
    throw new Error('This recording needs at least two distinct points before it can be shared.');
  }
  const title = cleanText(input.trailName, 140);
  if (!title) throw new Error('Name this recording before sharing it.');
  const first = coordinates[0];
  const distanceMi = trailLineDistanceM(coordinates) / 1609.344;
  return {
    id: `recording:${cleanText(input.recordingId, 160)}`,
    trail: {
      id: `recording:${cleanText(input.recordingId, 160)}`,
      name: title,
      lat: first[1],
      lng: first[0],
      type: 'trail',
      source: 'trip',
      subtitle: 'Recorded route',
      score: 0,
      support: {
        campsNearby: 0,
        fuelNearby: 0,
        waterNearby: 0,
        reportsNearby: 0,
        offlineReady: true,
        readinessLabel: 'Saved on this device',
      },
      distanceMi,
      length_mi: distanceMi,
    },
    geometry: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { title, origin: 'recording' },
        geometry: { type: 'LineString', coordinates },
      }],
    },
    savedAt: Number.isFinite(input.savedAt) ? Number(input.savedAt) : Date.now(),
    source: 'manual',
    ownerRouteOrigin: 'recording',
  };
}

export function prepareOfflineTrailForSharing(
  trail: OfflineTrail,
  crop: Partial<TrailRouteCropV1> | null | undefined,
): PreparedTrailRouteUploadV1 {
  const source = canonicalCoordinatesFromOfflineTrail(trail);
  const normalizedCrop = normalizeTrailRouteCrop(crop);
  const retained = cropCanonicalTrailCoordinates(source, normalizedCrop);
  if (retained.length < 2 || trailLineDistanceM(retained) < 1) {
    throw new Error('This route needs at least two distinct points before it can be shared.');
  }
  validateTrailRouteGeometryForUpload(retained);
  const activity = cleanActivity(trail.builder?.activity ?? trail.trail.activities?.[0]);
  const routeShape = cleanRouteShape((trail.geometry.features[0]?.properties as Record<string, unknown> | null)?.route_shape);
  const title = cleanText(trail.trail.name, 140);
  if (!title) throw new Error('Name this route before sharing it.');
  const trailheads = (trail.trail.trailheads_v2 ?? [])
    .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng)
      && Math.abs(item.lat) <= 90 && Math.abs(item.lng) <= 180)
    .slice(0, 16)
    .map(item => ({
      ...(cleanText(item.name, 120) ? { name: cleanText(item.name, 120) } : {}),
      lat: Number(item.lat.toFixed(7)),
      lng: Number(item.lng.toFixed(7)),
      ...(cleanText(item.source ?? trail.trail.source_label, 80)
        ? { source: cleanText(item.source ?? trail.trail.source_label, 80) }
        : {}),
    }));
  return {
    payload: {
      origin: inferOwnedTrailRouteOrigin(trail),
      title,
      geometry: { type: 'LineString', coordinates: retained },
      ...(activity ? { activity } : {}),
      ...(routeShape ? { route_shape: routeShape } : {}),
      // An activity selected while building is not proof that the activity is
      // legally permitted on every segment. OfflineTrail has no authoritative
      // permitted-use evidence, so this remains empty.
      permitted_uses: [],
      // Canonical TrailSystem trailheads are carried as review evidence. They
      // are not treated as proof of access until a moderator checks the source.
      trailheads,
      source_evidence: [],
      photos: [],
    },
    sourcePointCount: source.length,
    retainedPointCount: retained.length,
    sourceDistanceM: trailLineDistanceM(source),
    retainedDistanceM: trailLineDistanceM(retained),
    crop: normalizedCrop,
  };
}

export function stableTrailRouteDigest(input: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function trailRouteIdempotencyKey(
  request: Omit<TrailRouteSharingRequestKeyV1, 'generation'>,
  operation: 'create' | 'privacy' | 'share' | 'replace' | 'revoke' | 'update',
  mutationNonce = '',
): string {
  const material = [request.ownerScope, request.localRouteId, request.localRevision, operation, mutationNonce].join('|');
  return `trail-route-v1-${operation}-${stableTrailRouteDigest(material)}`;
}

export function trailRouteRequestIsCurrent(
  active: TrailRouteSharingRequestKeyV1 | null | undefined,
  candidate: TrailRouteSharingRequestKeyV1,
): boolean {
  return !!active
    && active.ownerScope === candidate.ownerScope
    && active.localRouteId === candidate.localRouteId
    && active.localRevision === candidate.localRevision
    && active.generation === candidate.generation;
}

export function sharedTrailUrlFromToken(token: string): string | null {
  const clean = String(token || '').trim();
  return TRAIL_SHARE_TOKEN_PATTERN.test(clean) ? `${TRAIL_SHARE_WEB_PREFIX}${clean}` : null;
}

export function sharedTrailTokenFromUrl(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    const protocol = url.protocol.toLowerCase();
    if (protocol === 'https:' && url.hostname.toLowerCase() !== 'gettrailhead.app') return '';
    if (protocol !== 'https:' && protocol !== 'trailhead:') return '';
    let segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (protocol === 'trailhead:' && url.hostname) segments = [url.hostname, ...segments];
    if (segments.length !== 3 || segments[0] !== 'app' || segments[1] !== 'trails' || segments[2] !== 'shared') return '';
    const token = new URLSearchParams(url.hash.replace(/^#/, '')).get('token') || '';
    return TRAIL_SHARE_TOKEN_PATTERN.test(token) ? token : '';
  } catch {
    return '';
  }
}

export function isSharedTrailRouteV1(value: unknown): value is SharedTrailRouteV1 {
  const route = value as Partial<SharedTrailRouteV1> | null | undefined;
  return !!route
    && route.version === 1
    && typeof route.shared_route_id === 'string'
    && !!route.shared_route_id
    && typeof route.title === 'string'
    && !!route.title.trim()
    && Number.isInteger(route.route_revision)
    && Number.isInteger(route.share_revision)
    && route.geometry?.type === 'LineString'
    && Array.isArray(route.geometry.coordinates)
    && route.geometry.coordinates.length >= 2
    && route.geometry.coordinates.every(point => finiteCoordinate(point) != null);
}

export function offlineTrailFromSharedRoute(route: SharedTrailRouteV1, savedAt = Date.now()): OfflineTrail {
  if (!isSharedTrailRouteV1(route)) throw new Error('Shared route unavailable.');
  const coordinates = route.geometry.coordinates.map(point => [Number(point[0]), Number(point[1])] as [number, number]);
  const first = coordinates[0];
  const activityLabels: Record<string, string> = {
    hiking: 'Hiking', walking: 'Walking', running: 'Running', backpacking: 'Backpacking', biking: 'Biking',
    mountain_biking: 'Mountain biking', horseback: 'Horseback', ohv: 'OHV', '4wd': '4WD',
    motorcycle: 'Motorcycle', skiing: 'Skiing', snowshoeing: 'Snowshoeing', mixed_use: 'Mixed use',
  };
  const activity = route.activity ? cleanActivity(route.activity) : undefined;
  const subtitle = activity ? activityLabels[activity] || '' : '';
  return {
    id: `shared-copy:${route.shared_route_id}:${route.share_revision}`,
    trail: {
      id: `shared:${route.shared_route_id}`,
      name: cleanText(route.title, 140),
      lat: first[1],
      lng: first[0],
      type: 'trail',
      source: 'trip',
      subtitle,
      score: 0,
      support: {
        campsNearby: 0,
        fuelNearby: 0,
        waterNearby: 0,
        reportsNearby: 0,
        offlineReady: false,
        readinessLabel: 'Download this route area for offline maps.',
      },
      activities: activity ? [activity] : undefined,
      geometry_status: 'complete',
      geometry_revision: String(route.geometry_revision),
      summary: route.description || undefined,
    },
    geometry: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {
          name: cleanText(route.title, 140),
          route_revision: route.route_revision,
          share_revision: route.share_revision,
          geometry_sha256: route.geometry_sha256,
          distance_m: Math.round(trailLineDistanceM(coordinates)),
        },
      }],
    },
    savedAt,
    source: 'manual',
    ownerRouteOrigin: route.origin,
  };
}
