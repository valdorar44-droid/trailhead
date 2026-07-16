import type { TripResult, User } from './api';

export const CAR_NAVIGATION_SNAPSHOT_VERSION = 1 as const;
export const CAR_NAVIGATION_SNAPSHOT_FILE = 'car_navigation_snapshot.json';

export type CarNavigationMode = 'road_preview' | 'trail_follow_preview' | 'trail_follow_active';

export type CarAccountState = {
  accountId: string | null;
  signedIn: boolean;
  reportsEnabled: boolean;
  reportsDisabledReason: 'signed_out' | 'temporarily_restricted' | null;
};

export type CarRouteStep = {
  type: string;
  modifier: string;
  name: string;
  distanceM: number;
  durationS: number;
  lat?: number;
  lng?: number;
  instruction?: string;
  verbalPre?: string;
  verbalPost?: string;
  roundaboutExit?: number | null;
  speedLimitKph?: number | null;
  lanes?: Array<{ indications: string[]; valid: boolean; active?: boolean }>;
};

export type CarNavigationStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  day: number | null;
  description?: string;
  routePointType?: 'side_stop' | 'break' | 'through';
};

export type CarOfflineReadiness = {
  status: 'ready' | 'needs_download' | 'unknown';
  map: boolean | null;
  navigation: boolean | null;
  places: boolean | null;
  topo: boolean | null;
  trails: boolean | null;
  tripDownload: boolean | null;
  message: string | null;
};

export type CarNavigationRoute = {
  mode: CarNavigationMode;
  tripId: string | null;
  routeId: string;
  title: string;
  summary: string | null;
  source: string;
  coords: [number, number][];
  steps: CarRouteStep[];
  legs: CarRouteStep[][];
  totalDistanceM: number | null;
  totalDurationS: number | null;
};

export type CarNavigationSnapshot = {
  schemaVersion: typeof CAR_NAVIGATION_SNAPSHOT_VERSION;
  updatedAt: number;
  account: CarAccountState;
  mapboxAccessToken: string | null;
  navigation: CarNavigationRoute | null;
  stops: CarNavigationStop[];
  offlineReadiness: CarOfflineReadiness;
};

export type CarTripContext = {
  trip: TripResult | null;
  account: CarAccountState;
  mapboxAccessToken?: string | null;
};

export type CarTrailFollowInput = {
  mode: Extract<CarNavigationMode, 'trail_follow_preview' | 'trail_follow_active'>;
  trailId: string;
  title: string;
  summary?: string | null;
  coords: [number, number][];
  steps: unknown[];
  totalDistanceM: number;
  totalDurationS: number;
  offlineReady: boolean;
  offlineMessage?: string | null;
};

type ExpoFileSystem = typeof import('expo-file-system/legacy');

const EMPTY_ACCOUNT: CarAccountState = {
  accountId: null,
  signedIn: false,
  reportsEnabled: false,
  reportsDisabledReason: 'signed_out',
};

let latestContext: CarTripContext = { trip: null, account: EMPTY_ACCOUNT, mapboxAccessToken: null };
let trailFollow: CarTrailFollowInput | null = null;
let scheduledRevision = 0;
let writeTail: Promise<void> = Promise.resolve();
let fileSystemPromise: Promise<ExpoFileSystem> | null = null;
let writesEnabled = true;

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number != null && number >= 0 ? number : null;
}

function text(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function coordinate(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = finiteNumber(value[0]);
  const lat = finiteNumber(value[1]);
  if (lng == null || lat == null || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [lng, lat];
}

function coordinates(values: unknown): [number, number][] {
  if (!Array.isArray(values)) return [];
  return values.map(coordinate).filter((value): value is [number, number] => value != null);
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeEpochMs(value: unknown): number | null {
  const epoch = nonNegativeNumber(value);
  if (epoch == null) return null;
  return epoch < 10_000_000_000 ? epoch * 1000 : epoch;
}

export function buildCarAccountState(
  user: Pick<User, 'id' | 'reporting_restricted_until'> | null | undefined,
  signedIn: boolean,
  now = Date.now(),
): CarAccountState {
  const accountId = user && Number.isFinite(Number(user.id)) ? String(user.id) : null;
  const authenticated = signedIn && accountId != null;
  const restrictedUntil = normalizeEpochMs(user?.reporting_restricted_until);
  const restricted = authenticated && restrictedUntil != null && restrictedUntil > now;
  return {
    accountId: authenticated ? accountId : null,
    signedIn: authenticated,
    reportsEnabled: authenticated && !restricted,
    reportsDisabledReason: !authenticated
      ? 'signed_out'
      : restricted
        ? 'temporarily_restricted'
        : null,
  };
}

function normalizeLanes(value: unknown): CarRouteStep['lanes'] {
  if (!Array.isArray(value)) return undefined;
  const lanes = value.flatMap((lane): NonNullable<CarRouteStep['lanes']> => {
    if (!lane || typeof lane !== 'object') return [];
    const source = lane as Record<string, unknown>;
    if (typeof source.valid !== 'boolean') return [];
    const indications = Array.isArray(source.indications)
      ? source.indications.map(item => text(item, 40)).filter(Boolean)
      : [];
    return [{
      indications,
      valid: source.valid,
      ...(typeof source.active === 'boolean' ? { active: source.active } : {}),
    }];
  });
  return lanes.length ? lanes : undefined;
}

function normalizeStep(value: unknown): CarRouteStep | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const lat = finiteNumber(source.lat);
  const lng = finiteNumber(source.lng);
  const roundaboutExit = source.roundaboutExit == null
    ? null
    : nonNegativeNumber(source.roundaboutExit);
  const speedLimitKph = source.speedLimit == null
    ? null
    : nonNegativeNumber(source.speedLimit);
  const instruction = text(source.instruction);
  const verbalPre = text(source.verbalPre);
  const verbalPost = text(source.verbalPost);
  const lanes = normalizeLanes(source.lanes);
  return {
    type: text(source.type, 80) || 'continue',
    modifier: text(source.modifier, 80) || 'straight',
    name: text(source.name, 200),
    distanceM: nonNegativeNumber(source.distance ?? source.distanceM) ?? 0,
    durationS: nonNegativeNumber(source.duration ?? source.durationS) ?? 0,
    ...(lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : {}),
    ...(instruction ? { instruction } : {}),
    ...(verbalPre ? { verbalPre } : {}),
    ...(verbalPost ? { verbalPost } : {}),
    ...(source.roundaboutExit !== undefined ? { roundaboutExit } : {}),
    ...(source.speedLimit !== undefined ? { speedLimitKph } : {}),
    ...(lanes ? { lanes } : {}),
  };
}

function normalizeSteps(value: unknown): CarRouteStep[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeStep).filter((step): step is CarRouteStep => step != null);
}

function normalizeLegs(value: unknown): CarRouteStep[][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((leg): CarRouteStep[][] => {
    if (Array.isArray(leg)) return [normalizeSteps(leg)];
    if (leg && typeof leg === 'object' && Array.isArray((leg as Record<string, unknown>).steps)) {
      return [normalizeSteps((leg as Record<string, unknown>).steps)];
    }
    return [];
  }).filter(leg => leg.length > 0);
}

function metersBetween(a: [number, number], b: [number, number]): number {
  const earthRadiusM = 6_371_000;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function geometryDistanceM(route: [number, number][]): number | null {
  if (route.length < 2) return null;
  let total = 0;
  for (let index = 1; index < route.length; index += 1) total += metersBetween(route[index - 1], route[index]);
  return total;
}

function sumSteps(steps: CarRouteStep[], field: 'distanceM' | 'durationS'): number | null {
  if (!steps.length) return null;
  return steps.reduce((total, step) => total + step[field], 0);
}

function tripStops(trip: TripResult | null): CarNavigationStop[] {
  if (!trip) return [];
  return (trip.plan?.waypoints ?? []).flatMap((waypoint, index): CarNavigationStop[] => {
    if (waypoint.route_point_type === 'side_stop') return [];
    const lat = finiteNumber(waypoint.lat);
    const lng = finiteNumber(waypoint.lng);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
    const description = text(waypoint.description);
    return [{
      id: `${trip.trip_id}:waypoint:${index}`,
      name: text(waypoint.name, 200) || `Stop ${index + 1}`,
      lat,
      lng,
      type: text(waypoint.type, 80) || 'stop',
      day: Number.isFinite(Number(waypoint.day)) ? Number(waypoint.day) : null,
      ...(description ? { description } : {}),
      ...(waypoint.route_point_type ? { routePointType: waypoint.route_point_type } : {}),
    }];
  });
}

function offlineReadiness(trip: TripResult | null): CarOfflineReadiness {
  const source = trip?.timeline?.offline_readiness ?? trip?.plan?.timeline?.offline_readiness;
  const result: CarOfflineReadiness = {
    status: 'unknown',
    map: optionalBoolean(source?.map),
    navigation: optionalBoolean(source?.navigation),
    places: optionalBoolean(source?.places),
    topo: optionalBoolean(source?.topo),
    trails: optionalBoolean(source?.trails),
    tripDownload: optionalBoolean(source?.trip_download),
    message: text(source?.message, 300) || null,
  };
  const known = [result.map, result.navigation, result.places, result.topo, result.trails, result.tripDownload]
    .filter((value): value is boolean => value != null);
  if (known.length) result.status = known.every(Boolean) ? 'ready' : 'needs_download';
  return result;
}

function roadNavigation(trip: TripResult | null): CarNavigationRoute | null {
  const geometry = trip?.route_geometry;
  const route = coordinates(geometry?.coords);
  if (!trip || route.length < 2) return null;
  const steps = normalizeSteps(geometry?.steps);
  const legs = normalizeLegs(geometry?.legs);
  const totalDistanceM = nonNegativeNumber(geometry?.totalDistance ?? geometry?.total_distance)
    ?? sumSteps(steps, 'distanceM')
    ?? geometryDistanceM(route);
  const totalDurationS = nonNegativeNumber(geometry?.totalDuration ?? geometry?.total_duration)
    ?? sumSteps(steps, 'durationS');
  return {
    mode: 'road_preview',
    tripId: trip.trip_id,
    routeId: trip.trip_id,
    title: text(trip.plan?.trip_name, 200) || 'Saved trip',
    summary: text(trip.plan?.overview, 500) || null,
    source: text(geometry?.source, 100) || 'saved_trip',
    coords: route,
    steps,
    legs,
    totalDistanceM,
    totalDurationS,
  };
}

function trailNavigation(input: CarTrailFollowInput, tripId: string | null): CarNavigationRoute | null {
  const route = coordinates(input.coords);
  if (route.length < 2) return null;
  const steps = normalizeSteps(input.steps);
  return {
    mode: input.mode,
    tripId,
    routeId: `trail:${text(input.trailId, 200) || 'selected'}`,
    title: text(input.title, 200) || 'Trail Follow',
    summary: text(input.summary, 500) || null,
    source: 'trail_follow',
    coords: route,
    steps,
    legs: steps.length ? [steps] : [],
    totalDistanceM: nonNegativeNumber(input.totalDistanceM) ?? geometryDistanceM(route),
    totalDurationS: nonNegativeNumber(input.totalDurationS) ?? sumSteps(steps, 'durationS'),
  };
}

export function buildCarNavigationSnapshot(
  context: CarTripContext,
  trail: CarTrailFollowInput | null = null,
  now = Date.now(),
): CarNavigationSnapshot {
  const baseOffline = offlineReadiness(context.trip);
  const navigation = trail
    ? trailNavigation(trail, context.trip?.trip_id ?? null)
    : roadNavigation(context.trip);
  const trailOffline = trail ? {
    ...baseOffline,
    status: trail.offlineReady ? baseOffline.status : 'needs_download' as const,
    navigation: true,
    trails: trail.offlineReady,
    message: text(trail.offlineMessage, 300) || baseOffline.message,
  } : baseOffline;
  return {
    schemaVersion: CAR_NAVIGATION_SNAPSHOT_VERSION,
    updatedAt: now,
    account: { ...context.account },
    mapboxAccessToken: text(context.mapboxAccessToken, 500) || null,
    navigation,
    stops: trail ? [] : tripStops(context.trip),
    offlineReadiness: trailOffline,
  };
}

async function getFileSystem(): Promise<ExpoFileSystem> {
  if (!fileSystemPromise) fileSystemPromise = import('expo-file-system/legacy');
  return fileSystemPromise;
}

async function atomicWriteSnapshot(snapshot: CarNavigationSnapshot): Promise<void> {
  const fileSystem = await getFileSystem();
  const root = fileSystem.documentDirectory;
  if (!root) return;
  const path = `${root}${CAR_NAVIGATION_SNAPSHOT_FILE}`;
  const temporary = `${path}.tmp`;
  const backup = `${path}.bak`;
  const value = JSON.stringify(snapshot);
  await fileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => {});
  await fileSystem.writeAsStringAsync(temporary, value, { encoding: fileSystem.EncodingType.UTF8 });
  const verification = JSON.parse(await fileSystem.readAsStringAsync(temporary));
  if (verification?.schemaVersion !== CAR_NAVIGATION_SNAPSHOT_VERSION) {
    throw new Error('Car navigation snapshot verification failed');
  }

  // Android's file rename replaces the target atomically. The backup path is a
  // recovery path for platforms whose rename implementation rejects replacement.
  try {
    await fileSystem.moveAsync({ from: temporary, to: path });
    return;
  } catch {}

  await fileSystem.deleteAsync(backup, { idempotent: true }).catch(() => {});
  const existing = await fileSystem.getInfoAsync(path).catch(() => null);
  if (existing?.exists) await fileSystem.moveAsync({ from: path, to: backup });
  try {
    await fileSystem.moveAsync({ from: temporary, to: path });
    await fileSystem.deleteAsync(backup, { idempotent: true }).catch(() => {});
  } catch (error) {
    const backupInfo = await fileSystem.getInfoAsync(backup).catch(() => null);
    if (backupInfo?.exists) await fileSystem.moveAsync({ from: backup, to: path }).catch(() => {});
    await fileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => {});
    throw error;
  }
}

async function deleteSnapshotFiles(): Promise<void> {
  const fileSystem = await getFileSystem();
  const root = fileSystem.documentDirectory;
  if (!root) return;
  const path = `${root}${CAR_NAVIGATION_SNAPSHOT_FILE}`;
  await Promise.all([
    fileSystem.deleteAsync(path, { idempotent: true }),
    fileSystem.deleteAsync(`${path}.tmp`, { idempotent: true }),
    fileSystem.deleteAsync(`${path}.bak`, { idempotent: true }),
  ]);
}

function scheduleSnapshotWrite(): Promise<void> {
  const revision = ++scheduledRevision;
  const snapshot = buildCarNavigationSnapshot(latestContext, trailFollow);
  const operation = writeTail.then(async () => {
    if (revision !== scheduledRevision) return;
    await atomicWriteSnapshot(snapshot);
  });
  writeTail = operation.catch(() => {});
  return operation;
}

export function syncCarNavigationSnapshot(context: CarTripContext): Promise<void> {
  const tripChanged = latestContext.trip?.trip_id !== context.trip?.trip_id;
  const accountChanged = latestContext.account.accountId !== context.account.accountId
    || latestContext.account.signedIn !== context.account.signedIn;
  if (tripChanged || accountChanged) trailFollow = null;
  latestContext = {
    trip: context.trip,
    account: { ...context.account },
    mapboxAccessToken: context.mapboxAccessToken ?? null,
  };
  writesEnabled = true;
  return scheduleSnapshotWrite();
}

export function setCarTrailFollow(input: CarTrailFollowInput, context?: CarTripContext): Promise<void> {
  if (!writesEnabled) return writeTail;
  if (context) latestContext = {
    trip: context.trip,
    account: { ...context.account },
    mapboxAccessToken: context.mapboxAccessToken ?? latestContext.mapboxAccessToken ?? null,
  };
  trailFollow = {
    ...input,
    coords: coordinates(input.coords),
    steps: Array.isArray(input.steps) ? input.steps : [],
  };
  return scheduleSnapshotWrite();
}

export function clearCarTrailFollow(context?: CarTripContext): Promise<void> {
  if (!writesEnabled) return writeTail;
  if (context) latestContext = {
    trip: context.trip,
    account: { ...context.account },
    mapboxAccessToken: context.mapboxAccessToken ?? latestContext.mapboxAccessToken ?? null,
  };
  if (!trailFollow && !context) return writeTail;
  trailFollow = null;
  return scheduleSnapshotWrite();
}

export function clearCarNavigationSnapshot(): Promise<void> {
  writesEnabled = false;
  latestContext = { trip: null, account: EMPTY_ACCOUNT, mapboxAccessToken: null };
  trailFollow = null;
  scheduledRevision += 1;
  const operation = writeTail.then(async () => {
    await deleteSnapshotFiles();
  });
  writeTail = operation.catch(() => {});
  return operation;
}
