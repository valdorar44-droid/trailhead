import { trailDistanceM, type TrailLocationFix } from './trailFollowSession';

export type TrailRecordingStatus = 'recording' | 'paused' | 'complete';

export type TrailRecordingPoint = Readonly<{
  lat: number;
  lng: number;
  altitudeM?: number | null;
  accuracyM?: number | null;
  speedMps?: number | null;
  headingDeg?: number | null;
  timestampMs: number;
}>;

export type TrailRecordingSessionV1 = Readonly<{
  version: 1;
  id: string;
  trailId: string;
  trailName: string;
  routeRevision?: string | null;
  routeCoordinates: readonly (readonly [number, number])[];
  followActive: boolean;
  status: TrailRecordingStatus;
  startedAtMs: number;
  updatedAtMs: number;
  resumedAtMs: number | null;
  activeDurationMs: number;
  distanceM: number;
  pointCount: number;
  lastPoint: TrailRecordingPoint | null;
  endedAtMs: number | null;
}>;

export type TrailRecordingPointDecision = Readonly<{
  accepted: boolean;
  reason?: 'not_recording' | 'poor_accuracy' | 'stale' | 'duplicate' | 'implausible_jump';
  distanceDeltaM: number;
}>;

export function createTrailRecordingSession(input: Readonly<{
  id: string;
  trailId: string;
  trailName: string;
  routeRevision?: string | null;
  routeCoordinates?: readonly (readonly [number, number])[];
  nowMs: number;
}>): TrailRecordingSessionV1 {
  return {
    version: 1,
    id: input.id,
    trailId: input.trailId,
    trailName: input.trailName,
    routeRevision: input.routeRevision ?? null,
    routeCoordinates: Object.freeze((input.routeCoordinates ?? []).map(point => Object.freeze([point[0], point[1]] as const))),
    followActive: true,
    status: 'recording',
    startedAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    resumedAtMs: input.nowMs,
    activeDurationMs: 0,
    distanceM: 0,
    pointCount: 0,
    lastPoint: null,
    endedAtMs: null,
  };
}

export function recordingElapsedMs(session: TrailRecordingSessionV1, nowMs: number) {
  return session.activeDurationMs + (
    session.status === 'recording' && session.resumedAtMs != null
      ? Math.max(0, nowMs - session.resumedAtMs)
      : 0
  );
}

export function pauseTrailRecording(session: TrailRecordingSessionV1, nowMs: number): TrailRecordingSessionV1 {
  if (session.status !== 'recording') return session;
  return {
    ...session,
    status: 'paused',
    activeDurationMs: recordingElapsedMs(session, nowMs),
    resumedAtMs: null,
    updatedAtMs: nowMs,
  };
}

export function resumeTrailRecording(session: TrailRecordingSessionV1, nowMs: number): TrailRecordingSessionV1 {
  if (session.status !== 'paused') return session;
  return { ...session, status: 'recording', resumedAtMs: nowMs, updatedAtMs: nowMs };
}

export function completeTrailRecording(session: TrailRecordingSessionV1, nowMs: number): TrailRecordingSessionV1 {
  if (session.status === 'complete') return session;
  return {
    ...session,
    status: 'complete',
    activeDurationMs: recordingElapsedMs(session, nowMs),
    resumedAtMs: null,
    updatedAtMs: nowMs,
    endedAtMs: nowMs,
  };
}

export function decideTrailRecordingPoint(
  session: TrailRecordingSessionV1,
  point: TrailRecordingPoint,
): TrailRecordingPointDecision {
  if (session.status !== 'recording') return { accepted: false, reason: 'not_recording', distanceDeltaM: 0 };
  const accuracyM = Number(point.accuracyM ?? Number.POSITIVE_INFINITY);
  if (!Number.isFinite(accuracyM) || accuracyM > 75) {
    return { accepted: false, reason: 'poor_accuracy', distanceDeltaM: 0 };
  }
  const last = session.lastPoint;
  if (!last) return { accepted: true, distanceDeltaM: 0 };
  const elapsedMs = point.timestampMs - last.timestampMs;
  if (elapsedMs <= 0) return { accepted: false, reason: 'stale', distanceDeltaM: 0 };
  const distanceDeltaM = trailDistanceM(last, point);
  if (distanceDeltaM < 1.5 && elapsedMs < 15_000) {
    return { accepted: false, reason: 'duplicate', distanceDeltaM: 0 };
  }
  // Leave room for sourced OHV/4WD use while rejecting obvious GPS teleports.
  const speedMps = distanceDeltaM / (elapsedMs / 1000);
  const speedCeilingMps = Math.max(55, Number(point.speedMps ?? 0) * 2 + 15);
  if (speedMps > speedCeilingMps && distanceDeltaM > Math.max(100, accuracyM * 3)) {
    return { accepted: false, reason: 'implausible_jump', distanceDeltaM: 0 };
  }
  return { accepted: true, distanceDeltaM };
}

export function acceptTrailRecordingPoint(
  session: TrailRecordingSessionV1,
  point: TrailRecordingPoint,
): TrailRecordingSessionV1 {
  const decision = decideTrailRecordingPoint(session, point);
  if (!decision.accepted) return session;
  return {
    ...session,
    pointCount: session.pointCount + 1,
    distanceM: session.distanceM + decision.distanceDeltaM,
    lastPoint: point,
    updatedAtMs: Math.max(session.updatedAtMs, point.timestampMs),
  };
}

export function recordingPointFromLocation(location: Readonly<{
  coords: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
  };
  timestamp?: number;
}>): TrailRecordingPoint {
  return {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    altitudeM: location.coords.altitude ?? null,
    accuracyM: location.coords.accuracy ?? null,
    speedMps: location.coords.speed ?? null,
    headingDeg: location.coords.heading ?? null,
    timestampMs: Number(location.timestamp ?? Date.now()),
  };
}

export type TrailRecordingFix = TrailLocationFix;
