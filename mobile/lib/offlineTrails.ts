import * as FileSystem from 'expo-file-system/legacy';
import type { TrailFeature } from './trailEngine';
import type { TrailPreviewManifest } from './api';
import type { TrailBuilderActivity, TrailBuilderMode } from './trailBuilderSession';
import { accountStorage } from './storage';

export type OfflineTrail = {
  id: string;
  trail: TrailFeature;
  geometry: GeoJSON.FeatureCollection;
  preview?: TrailPreviewManifest | null;
  savedAt: number;
  source: 'highlight' | 'graph_pack' | 'manual';
  ownerRouteOrigin?: 'builder' | 'gpx' | 'recording';
  builder?: Readonly<{
    schemaVersion: 1;
    mode: TrailBuilderMode;
    activity: TrailBuilderActivity;
    anchors: readonly [number, number][];
    redo: readonly [number, number][];
  }>;
  /**
   * Owner-scoped server mapping for an explicitly uploaded route. The raw
   * unlisted bearer token and share URL are never persisted here.
   */
  sharing?: Readonly<{
    schemaVersion: 1;
    ownerScope: string;
    origin: 'builder' | 'gpx' | 'recording';
    remoteRouteId: string;
    remoteRevision: number;
    uploadedSavedAt: number;
    uploadedCropStart: number;
    uploadedCropFinish: number;
    shareEnabled: boolean;
    shareRevision?: number;
    shareRouteRevision?: number | null;
  }>;
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

async function writeOfflineTrail(item: OfflineTrail) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(fileFor(item.id), JSON.stringify(item));
  const ids = await readIndex();
  await writeIndex([item.id, ...ids.filter(id => id !== item.id)].slice(0, 200));
}

export async function saveOfflineTrail(item: OfflineTrail) {
  const epoch = accountStorage.epoch();
  await accountStorage.run(() => writeOfflineTrail(item), epoch);
}

/**
 * Writes only while the owner scope captured by the caller is still current.
 * The expected epoch also keeps a queued Account A write from running after
 * Account B cleanup has started.
 */
export async function saveOfflineTrailForAccountScope(
  item: OfflineTrail,
  expectedEpoch: number,
  ownerScopeIsCurrent: () => boolean,
): Promise<boolean> {
  const result = await accountStorage.run(async () => {
    if (!ownerScopeIsCurrent()) return false;
    await writeOfflineTrail(item);
    return ownerScopeIsCurrent();
  }, expectedEpoch);
  return result === true;
}

export async function deleteOfflineTrail(id: string) {
  const epoch = accountStorage.epoch();
  await accountStorage.run(async () => {
    await ensureDir();
    await FileSystem.deleteAsync(fileFor(id), { idempotent: true }).catch(() => {});
    const ids = await readIndex();
    await writeIndex(ids.filter(existing => existing !== id));
  }, epoch);
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
