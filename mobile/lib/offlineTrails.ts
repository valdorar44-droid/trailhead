import * as FileSystem from 'expo-file-system';
import type { TrailFeature } from './trailEngine';

export type OfflineTrail = {
  id: string;
  trail: TrailFeature;
  geometry: GeoJSON.FeatureCollection;
  savedAt: number;
  source: 'highlight' | 'graph_pack' | 'manual';
};

const TRAIL_DIR = `${FileSystem.documentDirectory}offline_trails/`;
const TRAIL_INDEX = `${TRAIL_DIR}index.json`;

async function ensureDir() {
  await FileSystem.makeDirectoryAsync(TRAIL_DIR, { intermediates: true }).catch(() => {});
}

function fileFor(id: string) {
  return `${TRAIL_DIR}${encodeURIComponent(id)}.json`;
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(TRAIL_INDEX);
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(TRAIL_INDEX, JSON.stringify([...new Set(ids)]));
}

export async function saveOfflineTrail(item: OfflineTrail) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(fileFor(item.id), JSON.stringify(item));
  const ids = await readIndex();
  await writeIndex([item.id, ...ids.filter(id => id !== item.id)].slice(0, 200));
}

export async function deleteOfflineTrail(id: string) {
  await ensureDir();
  await FileSystem.deleteAsync(fileFor(id), { idempotent: true }).catch(() => {});
  const ids = await readIndex();
  await writeIndex(ids.filter(existing => existing !== id));
}

export async function loadOfflineTrail(id: string): Promise<OfflineTrail | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(fileFor(id));
    return JSON.parse(raw) as OfflineTrail;
  } catch {
    return null;
  }
}

export async function listOfflineTrails(): Promise<OfflineTrail[]> {
  const ids = await readIndex();
  const trails = await Promise.all(ids.map(loadOfflineTrail));
  return trails.filter((trail): trail is OfflineTrail => !!trail);
}
