import * as FileSystem from 'expo-file-system';
import type { PlacePack, PlacePackPoint } from './api';

const DIR = FileSystem.documentDirectory + 'offline_place_packs/';
const INDEX_PATH = DIR + '_index.json';
const MAX_PLACE_PACKS = 8;

export interface OfflinePlacePackSummary {
  pack_id: string;
  trip_id?: string;
  name: string;
  trip_name?: string;
  generated_at: number;
  point_count: number;
  categories: string[];
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

function packPath(packId: string) {
  return DIR + encodeURIComponent(packId) + '.json';
}

async function getIndex(): Promise<string[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(INDEX_PATH);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(ids));
}

export async function saveOfflinePlacePack(pack: PlacePack): Promise<void> {
  await ensureDir();
  await FileSystem.writeAsStringAsync(packPath(pack.pack_id), JSON.stringify(pack));
  const index = await getIndex();
  const updated = [pack.pack_id, ...index.filter(id => id !== pack.pack_id)].slice(0, MAX_PLACE_PACKS);
  const evicted = index.filter(id => !updated.includes(id));
  await Promise.all(evicted.map(id => FileSystem.deleteAsync(packPath(id), { idempotent: true }).catch(() => {})));
  await writeIndex(updated);
}

export async function loadOfflinePlacePack(packId: string): Promise<PlacePack | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(packPath(packId));
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.points) ? parsed : null;
  } catch {
    return null;
  }
}

export async function listOfflinePlacePacks(): Promise<OfflinePlacePackSummary[]> {
  const index = await getIndex();
  const packs = await Promise.all(index.map(loadOfflinePlacePack));
  return packs.filter(Boolean).map(pack => ({
    pack_id: pack!.pack_id,
    trip_id: pack!.trip_id,
    name: pack!.name,
    trip_name: pack!.trip_name,
    generated_at: pack!.generated_at,
    point_count: pack!.points?.length ?? 0,
    categories: Array.isArray(pack!.categories) ? pack!.categories : [],
  }));
}

export async function deleteOfflinePlacePack(packId: string): Promise<void> {
  await FileSystem.deleteAsync(packPath(packId), { idempotent: true }).catch(() => {});
  const index = await getIndex();
  await writeIndex(index.filter(id => id !== packId));
}

export async function loadTripPlacePoints(tripId?: string | null): Promise<PlacePackPoint[]> {
  if (!tripId) return [];
  const index = await getIndex();
  const packs = await Promise.all(index.map(loadOfflinePlacePack));
  const matches = packs.filter(pack => pack?.trip_id === tripId);
  const points: PlacePackPoint[] = [];
  matches.forEach(pack => points.push(...(pack?.points ?? [])));
  return points;
}
