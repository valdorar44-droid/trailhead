import * as FileSystem from 'expo-file-system';
import { TripResult } from './api';

const DIR = FileSystem.documentDirectory + 'offline_trips/';
const INDEX_PATH = DIR + '_index.json';
const MAX_OFFLINE_TRIPS = 5;

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

export async function saveOfflineTrip(trip: TripResult): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(
      DIR + trip.trip_id + '.json',
      JSON.stringify({ ...trip, cached_at: Date.now() }),
    );
    const index = await getOfflineTripIndex();
    const updated = [trip.trip_id, ...index.filter(id => id !== trip.trip_id)].slice(0, MAX_OFFLINE_TRIPS);
    // Evict oldest
    if (index.length >= MAX_OFFLINE_TRIPS) {
      const toEvict = index[MAX_OFFLINE_TRIPS - 1];
      await FileSystem.deleteAsync(DIR + toEvict + '.json', { idempotent: true });
    }
    await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(updated));
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

export async function deleteOfflineTrip(tripId: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(DIR + tripId + '.json', { idempotent: true });
    const index = await getOfflineTripIndex();
    const updated = index.filter(id => id !== tripId);
    await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(updated));
  } catch {}
}

export async function isOfflineCached(tripId: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(DIR + tripId + '.json');
    return info.exists;
  } catch { return false; }
}
