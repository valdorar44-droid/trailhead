import { distanceBetweenLngLatMeters, type LngLat } from '../routeProjection';
import { originalRouteSegmentBearingDegrees } from './routeProjection';
import { originalPendingStopIds } from './session';
import type {
  OriginalLocationSample,
  OriginalManifestV1,
  OriginalSessionV1,
} from './types';

export type OriginalVirtualDriveDirection = 'forward' | 'reverse';
export type OriginalVirtualDriveGpsQuality = 'precise' | 'approximate' | 'poor';

export type OriginalVirtualDriveLabState = Readonly<{
  playing: boolean;
  progress_m: number;
  speed_mps: number;
  direction: OriginalVirtualDriveDirection;
  gps_quality: OriginalVirtualDriveGpsQuality;
  off_route_m: number;
  synthetic_timestamp_ms: number;
  elapsed_simulated_ms: number;
  sample_count: number;
}>;

export type OriginalVirtualDriveTick = Readonly<{
  state: OriginalVirtualDriveLabState;
  sample: OriginalLocationSample | null;
}>;

export type OriginalVirtualDriveCueStatus = Readonly<{
  stop_id: string;
  sequence: number;
  title: string;
  status:
    | 'completed'
    | 'skipped'
    | 'missed'
    | 'playing'
    | 'queued'
    | 'in_window'
    | 'passed_window'
    | 'ahead';
  authored_start_m: number;
  effective_start_m: number;
  end_m: number;
}>;

export const ORIGINAL_VIRTUAL_DRIVE_TICK_REAL_MS = 400;
export const ORIGINAL_VIRTUAL_DRIVE_TICK_SIMULATED_MS = 3_100;
export const ORIGINAL_VIRTUAL_DRIVE_SPEED_MIN_MPS = 0;
export const ORIGINAL_VIRTUAL_DRIVE_SPEED_MAX_MPS = 40;
export const ORIGINAL_VIRTUAL_DRIVE_OFF_ROUTE_M = 800;

export const ORIGINAL_VIRTUAL_DRIVE_GPS_ACCURACY_M: Readonly<
  Record<OriginalVirtualDriveGpsQuality, number>
> = {
  precise: 10,
  approximate: 75,
  poor: 150,
};

type MeasuredRoute = Readonly<{
  coordinates: readonly LngLat[];
  segment_lengths_m: readonly number[];
  cumulative_m: readonly number[];
  total_m: number;
}>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeLongitude(value: number) {
  return ((value + 540) % 360) - 180;
}

function longitudeDelta(value: number) {
  return ((value + 540) % 360) - 180;
}

function measureRoute(manifest: OriginalManifestV1): MeasuredRoute {
  const coordinates = manifest.route.geometry.coordinates.filter((coordinate): coordinate is LngLat => (
    Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1])
  ));
  if (coordinates.length < 2) throw new Error('The authored route has no driveable geometry.');
  const segmentLengths = coordinates.slice(0, -1).map((coordinate, index) => (
    distanceBetweenLngLatMeters(coordinate, coordinates[index + 1])
  ));
  const cumulative = [0];
  segmentLengths.forEach(length => cumulative.push(cumulative.at(-1)! + Math.max(0, length)));
  const total = cumulative.at(-1) ?? 0;
  if (!Number.isFinite(total) || total <= 0 || manifest.route.distance_m <= 0) {
    throw new Error('The authored route distance is invalid.');
  }
  return {
    coordinates,
    segment_lengths_m: segmentLengths,
    cumulative_m: cumulative,
    total_m: total,
  };
}

function routePointAtProgress(
  manifest: OriginalManifestV1,
  progressM: number,
): { coordinate: LngLat; heading_deg: number | null } {
  const route = measureRoute(manifest);
  const geometricProgressM = clamp(
    progressM / manifest.route.distance_m,
    0,
    1,
  ) * route.total_m;
  let segmentIndex = route.segment_lengths_m.length - 1;
  for (let index = 0; index < route.segment_lengths_m.length; index += 1) {
    if (geometricProgressM <= route.cumulative_m[index + 1]) {
      segmentIndex = index;
      break;
    }
  }
  const start = route.coordinates[segmentIndex];
  const end = route.coordinates[segmentIndex + 1];
  const segmentLength = route.segment_lengths_m[segmentIndex] || 1;
  const fraction = clamp(
    (geometricProgressM - route.cumulative_m[segmentIndex]) / segmentLength,
    0,
    1,
  );
  return {
    coordinate: [
      normalizeLongitude(start[0] + longitudeDelta(end[0] - start[0]) * fraction),
      start[1] + (end[1] - start[1]) * fraction,
    ],
    heading_deg: originalRouteSegmentBearingDegrees(start, end),
  };
}

function offsetFromRoute(coordinate: LngLat, headingDeg: number | null, distanceM: number): LngLat {
  if (distanceM <= 0) return coordinate;
  const perpendicularRadians = ((headingDeg ?? 0) + 90) * Math.PI / 180;
  const eastM = Math.sin(perpendicularRadians) * distanceM;
  const northM = Math.cos(perpendicularRadians) * distanceM;
  const latitudeRadians = coordinate[1] * Math.PI / 180;
  return [
    normalizeLongitude(
      coordinate[0] + eastM / Math.max(1, 111_320 * Math.cos(latitudeRadians)),
    ),
    coordinate[1] + northM / 111_320,
  ];
}

export function createOriginalVirtualDriveLabState(
  manifest: OriginalManifestV1,
  options: Partial<OriginalVirtualDriveLabState> = {},
): OriginalVirtualDriveLabState {
  measureRoute(manifest);
  const progressM = clamp(Number(options.progress_m ?? 0), 0, manifest.route.distance_m);
  const timestampMs = Number(options.synthetic_timestamp_ms ?? Date.now());
  return {
    playing: Boolean(options.playing),
    progress_m: progressM,
    speed_mps: clamp(
      Number(options.speed_mps ?? 12),
      ORIGINAL_VIRTUAL_DRIVE_SPEED_MIN_MPS,
      ORIGINAL_VIRTUAL_DRIVE_SPEED_MAX_MPS,
    ),
    direction: options.direction === 'reverse' ? 'reverse' : 'forward',
    gps_quality: options.gps_quality && options.gps_quality in ORIGINAL_VIRTUAL_DRIVE_GPS_ACCURACY_M
      ? options.gps_quality
      : 'precise',
    off_route_m: clamp(Number(options.off_route_m ?? 0), 0, 5_000),
    synthetic_timestamp_ms: Number.isFinite(timestampMs) ? timestampMs : Date.now(),
    elapsed_simulated_ms: Math.max(0, Number(options.elapsed_simulated_ms ?? 0)),
    sample_count: Math.max(0, Math.floor(Number(options.sample_count ?? 0))),
  };
}

export function updateOriginalVirtualDriveLabState(
  manifest: OriginalManifestV1,
  state: OriginalVirtualDriveLabState,
  patch: Partial<Pick<
    OriginalVirtualDriveLabState,
    'playing' | 'speed_mps' | 'direction' | 'gps_quality' | 'off_route_m'
  >>,
): OriginalVirtualDriveLabState {
  return createOriginalVirtualDriveLabState(manifest, { ...state, ...patch });
}

export function seekOriginalVirtualDriveLab(
  manifest: OriginalManifestV1,
  state: OriginalVirtualDriveLabState,
  progressM: number,
): OriginalVirtualDriveLabState {
  return createOriginalVirtualDriveLabState(manifest, {
    ...state,
    progress_m: clamp(Number(progressM), 0, manifest.route.distance_m),
  });
}

export function tickOriginalVirtualDriveLab(
  manifest: OriginalManifestV1,
  state: OriginalVirtualDriveLabState,
  elapsedMs = ORIGINAL_VIRTUAL_DRIVE_TICK_SIMULATED_MS,
): OriginalVirtualDriveTick {
  if (!state.playing) return { state, sample: null };
  const cleanElapsedMs = clamp(Number(elapsedMs), 100, 60_000);
  const directionMultiplier = state.direction === 'reverse' ? -1 : 1;
  const progressM = clamp(
    state.progress_m + state.speed_mps * cleanElapsedMs / 1_000 * directionMultiplier,
    0,
    manifest.route.distance_m,
  );
  const routePoint = routePointAtProgress(manifest, progressM);
  const headingDeg = routePoint.heading_deg == null
    ? null
    : (routePoint.heading_deg + (state.direction === 'reverse' ? 180 : 0)) % 360;
  const coordinate = offsetFromRoute(routePoint.coordinate, headingDeg, state.off_route_m);
  const reachedEnd = state.direction === 'forward'
    ? progressM >= manifest.route.distance_m
    : progressM <= 0;
  const nextState: OriginalVirtualDriveLabState = {
    ...state,
    playing: reachedEnd ? false : state.playing,
    progress_m: progressM,
    synthetic_timestamp_ms: state.synthetic_timestamp_ms + cleanElapsedMs,
    elapsed_simulated_ms: state.elapsed_simulated_ms + cleanElapsedMs,
    sample_count: state.sample_count + 1,
  };
  return {
    state: nextState,
    sample: {
      lat: coordinate[1],
      lng: coordinate[0],
      accuracy_m: ORIGINAL_VIRTUAL_DRIVE_GPS_ACCURACY_M[state.gps_quality],
      heading_deg: headingDeg,
      speed_mps: state.speed_mps,
      timestamp_ms: nextState.synthetic_timestamp_ms,
    },
  };
}

export function originalVirtualDriveCueStatuses(
  manifest: OriginalManifestV1,
  session: OriginalSessionV1,
  state: OriginalVirtualDriveLabState,
): readonly OriginalVirtualDriveCueStatus[] {
  const completed = new Set(session.completed_stop_ids);
  const skipped = new Set(session.skipped_stop_ids);
  const missed = new Set(session.missed_stop_ids);
  const queued = new Set(originalPendingStopIds(session));
  return [...manifest.stops]
    .sort((a, b) => a.sequence - b.sequence)
    .map(stop => {
      const effectiveStartM = Math.max(
        0,
        stop.trigger.route_progress_start_m
          - state.speed_mps * Math.max(0, stop.trigger.lead_time_s || 0),
      );
      let status: OriginalVirtualDriveCueStatus['status'];
      if (completed.has(stop.id)) status = 'completed';
      else if (skipped.has(stop.id)) status = 'skipped';
      else if (missed.has(stop.id)) status = 'missed';
      else if (session.current_stop_id === stop.id) status = 'playing';
      else if (queued.has(stop.id)) status = 'queued';
      else if (
        state.progress_m >= effectiveStartM
        && state.progress_m <= stop.trigger.route_progress_end_m
      ) status = 'in_window';
      else if (state.progress_m > stop.trigger.route_progress_end_m) status = 'passed_window';
      else status = 'ahead';
      return {
        stop_id: stop.id,
        sequence: stop.sequence,
        title: stop.title,
        status,
        authored_start_m: stop.trigger.route_progress_start_m,
        effective_start_m: effectiveStartM,
        end_m: stop.trigger.route_progress_end_m,
      };
    });
}

export function nextOriginalVirtualDriveCueProgress(
  manifest: OriginalManifestV1,
  session: OriginalSessionV1,
  state: OriginalVirtualDriveLabState,
): number | null {
  const next = originalVirtualDriveCueStatuses(manifest, session, state).find(cue => (
    cue.status === 'in_window' || cue.status === 'ahead'
  ));
  return next ? next.effective_start_m : null;
}
