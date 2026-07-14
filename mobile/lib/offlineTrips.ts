import * as FileSystem from 'expo-file-system/legacy';
import { TripResult } from './api';
import { accountStorage } from './storage';

const DIR = FileSystem.documentDirectory + 'offline_trips/';
const INDEX_PATH = DIR + '_index.json';

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

export async function saveOfflineTrip(trip: TripResult): Promise<void> {
  const epoch = accountStorage.epoch();
  try {
    await accountStorage.run(async () => {
      await ensureDir();
      await FileSystem.writeAsStringAsync(
        DIR + trip.trip_id + '.json',
        JSON.stringify({ ...trip, cached_at: Date.now() }),
      );
      const index = await getOfflineTripIndex();
      const updated = [trip.trip_id, ...index.filter(id => id !== trip.trip_id)];
      await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(updated));
    }, epoch);
  } catch {
    // Never crash the app for cache failures
  }
}

export async function loadOfflineTrip(tripId: string): Promise<TripResult | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(DIR + tripId + '.json');
    return JSON.parse(raw);
  } catch { return null; }
}

export async function getOfflineTripIndex(): Promise<string[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(INDEX_PATH);
    return JSON.parse(raw);
  } catch { return []; }
}

export async function getOfflineTripSummaries(): Promise<Array<TripResult & { cached_at: number }>> {
  try {
    const index = await getOfflineTripIndex();
    const trips = await Promise.all(index.map(id => loadOfflineTrip(id)));
    return trips.filter(Boolean) as Array<TripResult & { cached_at: number }>;
  } catch { return []; }
}

export async function getOfflineTripStorageBytes(): Promise<Record<string, number>> {
  try {
    const index = await getOfflineTripIndex();
    const rows = await Promise.all(index.map(async id => {
      const info = await FileSystem.getInfoAsync(DIR + id + '.json').catch(() => null);
      return [id, info?.exists ? Number((info as any).size ?? 0) : 0] as const;
    }));
    return Object.fromEntries(rows);
  } catch {
    return {};
  }
}

export async function deleteOfflineTrip(tripId: string): Promise<void> {
  const epoch = accountStorage.epoch();
  try {
    await accountStorage.run(async () => {
      await FileSystem.deleteAsync(DIR + tripId + '.json', { idempotent: true });
      const index = await getOfflineTripIndex();
      const updated = index.filter(id => id !== tripId);
      await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(updated));
    }, epoch);
  } catch {}
}

export async function deleteOfflineTrips(tripIds: string[]): Promise<void> {
  const epoch = accountStorage.epoch();
  const ids = [...new Set(tripIds.map(id => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return;
  try {
    await accountStorage.run(async () => {
      await Promise.all(ids.map(id => FileSystem.deleteAsync(DIR + id + '.json', { idempotent: true })));
      const deleted = new Set(ids);
      const index = await getOfflineTripIndex();
      await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(index.filter(id => !deleted.has(id))));
    }, epoch);
  } catch {
    // Offline copies are a cache; the repository deletion remains authoritative.
  }
}

export async function deleteAllOfflineTrips(): Promise<void> {
  await accountStorage.run(() => FileSystem.deleteAsync(DIR, { idempotent: true }));
}

export async function isOfflineCached(tripId: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(DIR + tripId + '.json');
    return info.exists;
  } catch { return false; }
}
