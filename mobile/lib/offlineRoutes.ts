import * as FileSystem from 'expo-file-system/legacy';
import { api } from './api';
import { accountStorage } from './storage';

const DIR = FileSystem.documentDirectory + 'offline_routes/';
const INDEX_PATH = DIR + '_index.json';

export interface SavedRouteGeometry {
  coords: [number, number][];
  steps?: any[];
  legs?: any[];
  totalDistance?: number;
  totalDuration?: number;
  total_distance?: number;
  total_duration?: number;
  routeSource?: string | null;
  routeSourceLabel?: string | null;
  route_source?: string | null;
  route_source_label?: string | null;
  routeWaypointSignature?: string;
  route_waypoint_signature?: string;
  waypointSignature?: string;
  waypoint_signature?: string;
  routableWaypointSignature?: string;
  routable_waypoint_signature?: string;
  tripId: string | null;
  ts: number;
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

function routePath(tripId: string) {
  return DIR + encodeURIComponent(tripId) + '.json';
}

export async function getSavedRouteIndex(): Promise<string[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(INDEX_PATH);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveRouteGeometry(
  tripId: string | null | undefined,
  data: Omit<SavedRouteGeometry, 'tripId' | 'ts'> & { tripId?: string | null; ts?: number },
  options: { syncBackend?: boolean } = {},
) {
  if (!tripId || !Array.isArray(data.coords) || data.coords.length < 2) return;
  const epoch = accountStorage.epoch();
  try {
    const payload: SavedRouteGeometry = {
      ...data,
      tripId,
      ts: data.ts ?? Date.now(),
    };
    const stored = await accountStorage.run(async () => {
      await ensureDir();
      await FileSystem.writeAsStringAsync(routePath(tripId), JSON.stringify(payload));
      const index = await getSavedRouteIndex();
      const updated = [tripId, ...index.filter(id => id !== tripId)];
      await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(updated));
      return true;
    }, epoch);
    if (!stored) return;
    if (options.syncBackend === true) api.saveTripGeometry(tripId, payload).catch(() => {});
  } catch {
    // Route geometry is a convenience cache; never crash navigation for it.
  }
}

export async function loadRouteGeometry(tripId: string | null | undefined): Promise<SavedRouteGeometry | null> {
  if (!tripId) return null;
  try {
    const raw = await FileSystem.readAsStringAsync(routePath(tripId));
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function deleteRouteGeometry(tripId: string | null | undefined) {
  if (!tripId) return;
  const epoch = accountStorage.epoch();
  try {
    await accountStorage.run(async () => {
      await FileSystem.deleteAsync(routePath(tripId), { idempotent: true });
      const index = await getSavedRouteIndex();
      await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(index.filter(id => id !== tripId)));
    }, epoch);
  } catch {
    // Route geometry is a convenience cache; never block trip edits on cleanup.
  }
}
