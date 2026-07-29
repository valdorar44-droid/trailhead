import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import {
  acceptTrailRecordingPoint,
  completeTrailRecording,
  createTrailRecordingSession,
  pauseTrailRecording,
  resumeTrailRecording,
  type TrailRecordingPoint,
  type TrailRecordingSessionV1,
  type TrailRecordingStatus,
} from './trailRecordingSession';

type SessionRow = Readonly<{
  id: string;
  trail_id: string;
  trail_name: string;
  route_revision: string | null;
  route_json: string | null;
  follow_active: number | null;
  status: TrailRecordingStatus;
  started_at_ms: number;
  updated_at_ms: number;
  resumed_at_ms: number | null;
  active_duration_ms: number;
  distance_m: number;
  point_count: number;
  ended_at_ms: number | null;
}>;

type PointRow = Readonly<{
  lat: number;
  lng: number;
  altitude_m: number | null;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  timestamp_ms: number;
}>;

const DIRECTORY_NAME = 'trail_recordings';
const DATABASE_NAME = 'recordings.db';
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function recordingsDirectory() {
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('Local trail recording storage is unavailable.');
  return `${root}${DIRECTORY_NAME}`;
}

async function database() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const directory = recordingsDirectory();
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true }, directory);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS trail_recording_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          trail_id TEXT NOT NULL,
          trail_name TEXT NOT NULL,
          route_revision TEXT,
          route_json TEXT,
          follow_active INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL CHECK (status IN ('recording', 'paused', 'complete')),
          started_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          resumed_at_ms INTEGER,
          active_duration_ms INTEGER NOT NULL DEFAULT 0,
          distance_m REAL NOT NULL DEFAULT 0,
          point_count INTEGER NOT NULL DEFAULT 0,
          ended_at_ms INTEGER
        );
        CREATE TABLE IF NOT EXISTS trail_recording_points (
          session_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          altitude_m REAL,
          accuracy_m REAL,
          speed_mps REAL,
          heading_deg REAL,
          timestamp_ms INTEGER NOT NULL,
          PRIMARY KEY (session_id, sequence),
          FOREIGN KEY (session_id) REFERENCES trail_recording_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_trail_recording_status
          ON trail_recording_sessions(status, updated_at_ms DESC);
      `);
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(trail_recording_sessions)');
      if (!columns.some(column => column.name === 'route_json')) {
        await db.execAsync('ALTER TABLE trail_recording_sessions ADD COLUMN route_json TEXT;');
      }
      if (!columns.some(column => column.name === 'follow_active')) {
        await db.execAsync('ALTER TABLE trail_recording_sessions ADD COLUMN follow_active INTEGER NOT NULL DEFAULT 1;');
      }
      return db;
    })().catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function finiteNullable(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function pointFromRow(row: PointRow | null): TrailRecordingPoint | null {
  if (!row) return null;
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    altitudeM: finiteNullable(row.altitude_m),
    accuracyM: finiteNullable(row.accuracy_m),
    speedMps: finiteNullable(row.speed_mps),
    headingDeg: finiteNullable(row.heading_deg),
    timestampMs: Number(row.timestamp_ms),
  };
}

async function sessionFromRow(db: SQLite.SQLiteDatabase, row: SessionRow | null): Promise<TrailRecordingSessionV1 | null> {
  if (!row) return null;
  const lastPoint = await db.getFirstAsync<PointRow>(
    `SELECT lat, lng, altitude_m, accuracy_m, speed_mps, heading_deg, timestamp_ms
       FROM trail_recording_points
      WHERE session_id = ?
      ORDER BY sequence DESC LIMIT 1`,
    row.id,
  );
  return {
    version: 1,
    id: row.id,
    trailId: row.trail_id,
    trailName: row.trail_name,
    routeRevision: row.route_revision,
    routeCoordinates: (() => {
      try {
        const parsed = JSON.parse(row.route_json || '[]');
        return Array.isArray(parsed)
          ? parsed.filter(point => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
              .map(point => [Number(point[0]), Number(point[1])] as const)
          : [];
      } catch {
        return [];
      }
    })(),
    followActive: row.follow_active !== 0,
    status: row.status,
    startedAtMs: Number(row.started_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
    resumedAtMs: finiteNullable(row.resumed_at_ms),
    activeDurationMs: Number(row.active_duration_ms),
    distanceM: Number(row.distance_m),
    pointCount: Number(row.point_count),
    lastPoint: pointFromRow(lastPoint ?? null),
    endedAtMs: finiteNullable(row.ended_at_ms),
  };
}

async function writeSession(db: SQLite.SQLiteDatabase, session: TrailRecordingSessionV1) {
  await db.runAsync(
    `UPDATE trail_recording_sessions
        SET status = ?, follow_active = ?, updated_at_ms = ?, resumed_at_ms = ?, active_duration_ms = ?,
            distance_m = ?, point_count = ?, ended_at_ms = ?
      WHERE id = ?`,
    session.status,
    session.followActive ? 1 : 0,
    session.updatedAtMs,
    session.resumedAtMs,
    session.activeDurationMs,
    session.distanceM,
    session.pointCount,
    session.endedAtMs,
    session.id,
  );
}

export async function getActiveTrailRecording() {
  const db = await database();
  const row = await db.getFirstAsync<SessionRow>(
    `SELECT * FROM trail_recording_sessions
      WHERE status IN ('recording', 'paused')
      ORDER BY updated_at_ms DESC LIMIT 1`,
  );
  return sessionFromRow(db, row ?? null);
}

export async function getTrailRecording(sessionId: string) {
  const db = await database();
  const row = await db.getFirstAsync<SessionRow>(
    'SELECT * FROM trail_recording_sessions WHERE id = ?',
    sessionId,
  );
  return sessionFromRow(db, row ?? null);
}

export async function beginTrailRecording(input: Readonly<{
  trailId: string;
  trailName: string;
  routeRevision?: string | null;
  routeCoordinates?: readonly (readonly [number, number])[];
  nowMs?: number;
}>) {
  const existing = await getActiveTrailRecording();
  if (existing) return existing;
  const nowMs = input.nowMs ?? Date.now();
  const session = createTrailRecordingSession({
    id: `trail-recording-${nowMs}-${Math.random().toString(36).slice(2, 10)}`,
    trailId: input.trailId,
    trailName: input.trailName,
    routeRevision: input.routeRevision,
    routeCoordinates: input.routeCoordinates,
    nowMs,
  });
  const db = await database();
  await db.runAsync(
    `INSERT INTO trail_recording_sessions (
      id, trail_id, trail_name, route_revision, route_json, follow_active, status, started_at_ms, updated_at_ms,
      resumed_at_ms, active_duration_ms, distance_m, point_count, ended_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    session.id,
    session.trailId,
    session.trailName,
    session.routeRevision ?? null,
    JSON.stringify(session.routeCoordinates),
    session.followActive ? 1 : 0,
    session.status,
    session.startedAtMs,
    session.updatedAtMs,
    session.resumedAtMs,
    session.activeDurationMs,
    session.distanceM,
    session.pointCount,
    session.endedAtMs,
  );
  return session;
}

export async function appendTrailRecordingPoint(point: TrailRecordingPoint) {
  const db = await database();
  let nextSession: TrailRecordingSessionV1 | null = null;
  await db.withExclusiveTransactionAsync(async tx => {
    const row = await tx.getFirstAsync<SessionRow>(
      `SELECT * FROM trail_recording_sessions
        WHERE status = 'recording'
        ORDER BY updated_at_ms DESC LIMIT 1`,
    );
    const current = await sessionFromRow(tx, row ?? null);
    if (!current) return;
    const next = acceptTrailRecordingPoint(current, point);
    if (next === current) {
      nextSession = current;
      return;
    }
    await tx.runAsync(
      `INSERT INTO trail_recording_points (
        session_id, sequence, lat, lng, altitude_m, accuracy_m, speed_mps, heading_deg, timestamp_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      next.id,
      next.pointCount,
      point.lat,
      point.lng,
      point.altitudeM ?? null,
      point.accuracyM ?? null,
      point.speedMps ?? null,
      point.headingDeg ?? null,
      point.timestampMs,
    );
    await writeSession(tx, next);
    nextSession = next;
  });
  return nextSession;
}

async function updateActiveSession(
  transform: (session: TrailRecordingSessionV1, nowMs: number) => TrailRecordingSessionV1,
  nowMs = Date.now(),
) {
  const current = await getActiveTrailRecording();
  if (!current) return null;
  const next = transform(current, nowMs);
  const db = await database();
  await writeSession(db, next);
  return next;
}

export function pauseActiveTrailRecording(nowMs?: number) {
  return updateActiveSession(pauseTrailRecording, nowMs);
}

export function resumeActiveTrailRecording(nowMs?: number) {
  return updateActiveSession(resumeTrailRecording, nowMs);
}

export function completeActiveTrailRecording(nowMs?: number) {
  return updateActiveSession(completeTrailRecording, nowMs);
}

export function markActiveTrailRecordingFollowEnded(nowMs = Date.now()) {
  return updateActiveSession(
    session => ({ ...session, followActive: false, updatedAtMs: nowMs }),
    nowMs,
  );
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function exportTrailRecordingGpx(sessionId: string) {
  const db = await database();
  const session = await getTrailRecording(sessionId);
  if (!session) throw new Error('Trail recording not found.');
  const points = await db.getAllAsync<PointRow>(
    `SELECT lat, lng, altitude_m, accuracy_m, speed_mps, heading_deg, timestamp_ms
       FROM trail_recording_points WHERE session_id = ? ORDER BY sequence`,
    sessionId,
  );
  if (!points.length) throw new Error('This recording does not contain a track yet.');
  const track = points.map(point => (
    `    <trkpt lat="${Number(point.lat).toFixed(7)}" lon="${Number(point.lng).toFixed(7)}">`
    + `${point.altitude_m != null ? `<ele>${Number(point.altitude_m).toFixed(1)}</ele>` : ''}`
    + `<time>${new Date(Number(point.timestamp_ms)).toISOString()}</time></trkpt>`
  )).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trailhead" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${escapeXml(session.trailName)}</name><trkseg>\n${track}\n  </trkseg></trk>\n</gpx>\n`;
  const root = FileSystem.cacheDirectory;
  if (!root) throw new Error('GPX export is unavailable.');
  const path = `${root}${session.id}.gpx`;
  await FileSystem.writeAsStringAsync(path, xml);
  return path;
}

export async function listTrailRecordingPoints(sessionId: string) {
  const db = await database();
  const points = await db.getAllAsync<PointRow>(
    `SELECT lat, lng, altitude_m, accuracy_m, speed_mps, heading_deg, timestamp_ms
       FROM trail_recording_points WHERE session_id = ? ORDER BY sequence`,
    sessionId,
  );
  return points.map(point => pointFromRow(point)!).filter(Boolean);
}
