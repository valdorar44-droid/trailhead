import * as FileSystem from 'expo-file-system/legacy';
import { storage } from '../storage';
import type { LegacyMigrationInput } from './types';

const LEGACY_ACTIVE_TRIP_PATH = `${FileSystem.documentDirectory ?? ''}active_trip.json`;

async function readLegacyActiveTrip(): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(LEGACY_ACTIVE_TRIP_PATH);
    if (info.exists) return FileSystem.readAsStringAsync(LEGACY_ACTIVE_TRIP_PATH);
  } catch {
    // Older web and native releases may only have the secure-storage copy.
  }
  return storage.get('trailhead_active_trip').catch(() => null);
}

export async function readLegacyTripRepositoryData(): Promise<LegacyMigrationInput> {
  const [tripHistory, activeTrip, favoriteCamps, savedPlaces, exploreBookmarkIds] = await Promise.all([
    storage.get('trailhead_history'),
    readLegacyActiveTrip(),
    storage.get('trailhead_favorites'),
    storage.get('trailhead_saved_places'),
    storage.get('trailhead_saved_explore_places_v1'),
  ]);
  return { tripHistory, activeTrip, favoriteCamps, savedPlaces, exploreBookmarkIds };
}
