import * as FileSystem from 'expo-file-system/legacy';
import type { PlacePack, PlacePackPoint } from './api';
import { accountStorage } from './storage';
import { nextOfflinePlacePackIndex } from './offlinePlacePackIndex';
import {
  collectOfflinePlacePackDiagnosticsV1,
  nextOfflinePlacePackPointMetadataV1,
  parseOfflinePlacePackPointMetadataV1,
  type OfflinePlacePackDiagnosticsInventoryV1,
  type OfflinePlacePackPointMetadataV1,
} from './offlinePlacePackDiagnostics';

const DIR = FileSystem.documentDirectory + 'offline_place_packs/';
const INDEX_PATH = DIR + '_index.json';
const POINT_METADATA_PATH = DIR + '_point_metadata_v1.json';

export interface OfflinePlacePackSummary {
  pack_id: string;
  trip_id?: string;
  region_id?: string;
  name: string;
  trip_name?: string;
  region_name?: string;
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

async function getPointMetadata(): Promise<OfflinePlacePackPointMetadataV1[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(POINT_METADATA_PATH);
    return parseOfflinePlacePackPointMetadataV1(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writePointMetadata(rows: readonly OfflinePlacePackPointMetadataV1[]) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(POINT_METADATA_PATH, JSON.stringify({
    schema: 'offline_place_pack_point_metadata_v1',
    packs: rows,
  }));
}

export async function saveOfflinePlacePack(pack: PlacePack, preserveIds: string[] = []): Promise<void> {
  const epoch = accountStorage.epoch();
  await accountStorage.run(async () => {
    await ensureDir();
    await FileSystem.writeAsStringAsync(packPath(pack.pack_id), JSON.stringify(pack));
    const index = await getIndex();
    const updated = nextOfflinePlacePackIndex(index, pack.pack_id, preserveIds);
    await writeIndex(updated);
    const pointMetadata = await getPointMetadata();
    await writePointMetadata(nextOfflinePlacePackPointMetadataV1(
      pointMetadata,
      pack.pack_id,
      pack.points?.length ?? 0,
    )).catch(() => {});
  }, epoch);
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
    region_id: pack!.region_id,
    name: pack!.name,
    trip_name: pack!.trip_name,
    region_name: pack!.region_name,
    generated_at: pack!.generated_at,
    point_count: pack!.points?.length ?? 0,
    categories: Array.isArray(pack!.categories) ? pack!.categories : [],
  }));
}

export async function getOfflinePlacePackStorageBytes(): Promise<Record<string, number>> {
  try {
    const index = await getIndex();
    const rows = await Promise.all(index.map(async id => {
      const info = await FileSystem.getInfoAsync(packPath(id)).catch(() => null);
      return [id, info?.exists ? Number((info as any).size ?? 0) : 0] as const;
    }));
    return Object.fromEntries(rows);
  } catch {
    return {};
  }
}

/**
 * Lightweight QA inventory. This reads only the small index/metadata sidecars
 * and file stats; it deliberately never opens or parses a downloaded pack.
 * Legacy packs created before the metadata sidecar are reported as unknown.
 */
export async function getOfflinePlacePackDiagnosticsInventory(): Promise<OfflinePlacePackDiagnosticsInventoryV1> {
  const [index, pointMetadata] = await Promise.all([getIndex(), getPointMetadata()]);
  return collectOfflinePlacePackDiagnosticsV1({
    packIds: index,
    pointMetadata,
    getFileSize: async packId => {
      const info = await FileSystem.getInfoAsync(packPath(packId)).catch(() => null);
      return info?.exists ? Number((info as any).size ?? 0) : 0;
    },
  });
}

export async function deleteOfflinePlacePack(packId: string): Promise<void> {
  const epoch = accountStorage.epoch();
  await accountStorage.run(async () => {
    await FileSystem.deleteAsync(packPath(packId), { idempotent: true }).catch(() => {});
    const index = await getIndex();
    await writeIndex(index.filter(id => id !== packId));
    const pointMetadata = await getPointMetadata();
    await writePointMetadata(pointMetadata.filter(row => row.pack_id !== packId)).catch(() => {});
  }, epoch);
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

export async function loadAllPlacePoints(): Promise<PlacePackPoint[]> {
  const index = await getIndex();
  const packs = await Promise.all(index.map(loadOfflinePlacePack));
  const points: PlacePackPoint[] = [];
  packs.filter(Boolean).forEach(pack => points.push(...(pack?.points ?? [])));
  return points;
}
