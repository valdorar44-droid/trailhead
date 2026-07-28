import * as FileSystem from 'expo-file-system/legacy';
import type { TripResult, Waypoint } from './api';
import { accountStorage } from './storage';
import {
  gpxTrackDistanceMiles,
  parseGpx,
  thinTrackCoords,
  type GpxTrack,
} from './gpxParser';
export {
  cleanGpxName,
  decodeXmlText,
  gpxTrackDistanceMiles,
  parseGpx,
  thinTrackCoords,
  type GpxPoint,
  type GpxTrack,
  type GpxWaypoint,
  type ParsedGpx,
} from './gpxParser';

export type GpxImportBatch = {
  id: string;
  fileName: string;
  routeTripId?: string;
  routeTripIds?: string[];
  routeName?: string;
  importedAt: number;
  trackCount: number;
  routeCount: number;
  waypointCount: number;
  importedPins: number;
  skippedPins: number;
  pinLimit: number;
  routePointCount: number;
  distanceMiles: number;
  status: 'review' | 'trusted';
};

const BATCH_INDEX_PATH = `${FileSystem.documentDirectory}gpx_import_batches.json`;
const trackDistanceMiles = gpxTrackDistanceMiles;

function routePointSamples(coords: [number, number][], name: string): Waypoint[] {
  const count = Math.min(10, Math.max(2, Math.ceil(coords.length / 220)));
  return Array.from({ length: count }).map((_, idx) => {
    const coordIndex = Math.round((coords.length - 1) * (idx / Math.max(1, count - 1)));
    const [lng, lat] = coords[coordIndex];
    const label = idx === 0 ? 'Start' : idx === count - 1 ? 'Finish' : `Track point ${idx + 1}`;
    return {
      day: 1,
      name: `${name} ${label}`,
      type: idx === 0 ? 'start' : 'waypoint',
      description: 'Imported from GPX track',
      land_type: 'Imported GPX',
      notes: 'Track-derived route point',
      lat,
      lng,
    };
  });
}

export function buildTripFromGpxTrack(track: GpxTrack, tripId = `gpx_${Date.now()}`): TripResult {
  const coords = thinTrackCoords(track.coords);
  const miles = trackDistanceMiles(coords);
  return {
    trip_id: tripId,
    plan: {
      trip_name: track.name,
      overview: `Imported GPX track with ${track.rawPointCount.toLocaleString()} source points. Review access, closures, vehicle fit, and the route line before navigating.`,
      duration_days: 1,
      states: [],
      total_est_miles: Math.round(miles),
      waypoints: routePointSamples(coords, track.name),
      daily_itinerary: [{
        day: 1,
        title: 'Imported GPX Track',
        description: 'Follow the imported track preview. Distance is estimated from GPX geometry.',
        est_miles: Math.round(miles),
        road_type: 'Imported GPX',
        highlights: ['Imported route line', 'Review camps, fuel, water, and access before departure'],
      }],
      logistics: {
        vehicle_recommendation: 'Verify the GPX route matches your vehicle and current trail access.',
        fuel_strategy: 'Check fuel range against the imported track distance.',
        water_strategy: 'Add water stops or download local essentials before leaving signal.',
        permits_needed: 'Check land manager rules for the imported route.',
        best_season: 'Confirm seasonal closures and weather before departure.',
      },
    },
    campsites: [],
    gas_stations: [],
    route_pois: [],
  };
}

export async function loadGpxImportBatches(): Promise<GpxImportBatch[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(BATCH_INDEX_PATH);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveGpxImportBatch(batch: GpxImportBatch) {
  const epoch = accountStorage.epoch();
  const current = await loadGpxImportBatches();
  const next = [batch, ...current.filter(item => item.id !== batch.id)].slice(0, 25);
  await accountStorage.run(() => FileSystem.writeAsStringAsync(BATCH_INDEX_PATH, JSON.stringify(next)), epoch);
  return next;
}

export async function removeGpxImportBatch(batchId: string) {
  const epoch = accountStorage.epoch();
  const current = await loadGpxImportBatches();
  const next = current.filter(item => item.id !== batchId);
  await accountStorage.run(() => FileSystem.writeAsStringAsync(BATCH_INDEX_PATH, JSON.stringify(next)), epoch);
  return next;
}
