/**
 * Routing — three live engines + offline route cache.
 *
 * Online priority:  Mapbox Directions → Valhalla (OSM DE) → OSRM (Fossgis)
 * Offline fallback: cached route from last successful calculation for same waypoints
 * Last resort:      straight-line (isProper: false — UI shows warning)
 *
 * Routes are cached to the filesystem keyed by waypoint string so a route
 * planned on wifi is still available days later with no signal.
 */

import * as FileSystem from 'expo-file-system';
import type { RouteStep } from './types';

export interface RouteResult {
  coords:        [number, number][];
  steps:         RouteStep[];
  legs:          RouteStep[][];
  totalDistance: number;
  totalDuration: number;
  isProper:      boolean;
  fromCache?:    boolean;
}

interface RouteOpts {
  avoidTolls:     boolean;
  avoidHighways:  boolean;
  backRoads:      boolean;
  noFerries:      boolean;
}

// ── Route cache (filesystem, survives app restarts) ───────────────────────────
const CACHE_DIR = `${FileSystem.documentDirectory}routes/`;

async function ensureCacheDir() {
  await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(() => {});
}

function cacheKey(pairs: string[]): string {
  // Simple hash — pairs are stable for same route
  return pairs.join('|').replace(/[^0-9.,|]/g, '').replace(/\./g, '_').slice(0, 120);
}

async function saveRoute(pairs: string[], result: RouteResult) {
  try {
    await ensureCacheDir();
    const path = `${CACHE_DIR}${cacheKey(pairs)}.json`;
    await FileSystem.writeAsStringAsync(path, JSON.stringify(result));
  } catch {}
}

async function loadCachedRoute(pairs: string[]): Promise<RouteResult | null> {
  try {
    const path = `${CACHE_DIR}${cacheKey(pairs)}.json`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    return { ...JSON.parse(raw), fromCache: true };
  } catch {
    return null;
  }
}

// ── Connectivity check (2s — fast fail when offline) ─────────────────────────
async function isOnline(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 2000);
    await fetch('https://tiles.gettrailhead.app/api/download/manifest.json',
      { method: 'HEAD', signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(tid);
    return true;
  } catch {
    return false;
  }
}

// ── Polyline6 decoder (Valhalla) ─────────────────────────────────────────────
function decodeP6(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let r = 0, sh = 0, b = 0;
    do { b = encoded.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
    lat += (r & 1 ? ~(r >> 1) : r >> 1);
    r = 0; sh = 0;
    do { b = encoded.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
    lng += (r & 1 ? ~(r >> 1) : r >> 1);
    coords.push([lng / 1e6, lat / 1e6]);
  }
  return coords;
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function fetchRoute(
  pairs:       string[],
  fromIdx:     number,
  mapboxToken: string,
  routeOpts:   RouteOpts,
): Promise<RouteResult> {
  // Fast offline check — skip all network calls immediately if no connectivity
  const online = await isOnline();

  if (online) {
    // 1. Mapbox Directions
    try {
      const r = await fetchMapbox(pairs, fromIdx, mapboxToken, routeOpts);
      await saveRoute(pairs, r);
      return r;
    } catch {}

    // 2. Valhalla (OSM DE public)
    try {
      const r = await fetchValhalla(pairs, fromIdx, routeOpts);
      await saveRoute(pairs, r);
      return r;
    } catch {}

    // 3. OSRM (Fossgis public)
    try {
      const r = await fetchOSRM(pairs, fromIdx, routeOpts);
      await saveRoute(pairs, r);
      return r;
    } catch {}
  }

  // Offline — try local PMTiles router first (tap-anywhere routing from device)
  try {
    const r = await fetchLocalRouter(pairs, fromIdx);
    if (r) { await saveRoute(pairs, r); return r; }
  } catch {}

  // Cached route from prior online session
  const cached = await loadCachedRoute(pairs);
  if (cached) return cached;

  // True last resort: straight line
  return buildFallbackRoute(pairs);
}

// ── Engine 1: Mapbox Directions ───────────────────────────────────────────────
async function fetchMapbox(
  pairs:  string[],
  _from:  number,
  token:  string,
  opts:   RouteOpts,
): Promise<RouteResult> {
  const profile = opts.backRoads ? 'driving' : 'driving-traffic';
  const excl    = [
    opts.avoidTolls    ? 'toll'     : '',
    opts.avoidHighways ? 'motorway' : '',
    opts.noFerries     ? 'ferry'    : '',
  ].filter(Boolean);

  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${pairs.join(';')}` +
    `?access_token=${token}&steps=true&geometries=geojson&overview=full` +
    `&annotations=maxspeed&banner_instructions=true` +
    (excl.length ? `&exclude=${excl.join(',')}` : '');

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 10000);
  const data = await fetch(url, { signal: ctrl.signal }).then(r => r.json());
  clearTimeout(tid);
  if (!data.routes?.length) throw new Error('no routes');

  const route  = data.routes[0];
  const steps: RouteStep[] = [];
  const legs:  RouteStep[][] = [];

  for (const leg of route.legs ?? []) {
    const ls: RouteStep[] = [];
    for (const s of leg.steps ?? []) {
      if (s.distance <= 0 && s.maneuver?.type !== 'arrive') continue;
      const loc = s.maneuver?.location;
      const lanes = s.intersections?.slice().reverse().reduce((found: any, isc: any) => {
        if (found !== undefined) return found;
        return isc.lanes?.length
          ? isc.lanes.map((l: any) => ({ indications: l.indications ?? [], valid: l.valid === true, active: l.active === true }))
          : undefined;
      }, undefined);
      const st: RouteStep = {
        type:       s.maneuver?.type ?? 'turn',
        modifier:   s.maneuver?.modifier ?? '',
        name:       s.name ?? '',
        distance:   s.distance,
        duration:   s.duration,
        lat:        loc?.[1],
        lng:        loc?.[0],
        lanes:      lanes?.length ? lanes : undefined,
        speedLimit: null,
      };
      steps.push(st); ls.push(st);
    }
    legs.push(ls);
  }

  return { coords: route.geometry.coordinates, steps, legs,
           totalDistance: route.distance, totalDuration: route.duration, isProper: true };
}

// ── Engine 2: Valhalla (valhalla1.openstreetmap.de) ───────────────────────────
async function fetchValhalla(
  pairs: string[],
  _from: number,
  opts:  RouteOpts,
): Promise<RouteResult> {
  const locs = pairs.map(p => {
    const [ln, lt] = p.split(',');
    return { lon: parseFloat(ln), lat: parseFloat(lt) };
  });

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 12000);
  const data = await fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST', signal: ctrl.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: locs,
      costing: 'auto',
      costing_options: {
        auto: {
          use_tracks:   opts.backRoads      ? 0.9 : 0.1,
          use_highways: opts.avoidHighways  ? 0   : 1,
          use_tolls:    opts.avoidTolls     ? 0   : 0.5,
        },
      },
      units: 'miles',
    }),
  }).then(r => r.json());
  clearTimeout(tid);

  if (!data.trip || data.trip.status !== 0) throw new Error('valhalla error');

  const TURN: Record<number, string> = {
    0:'', 1:'', 2:'left', 3:'right', 4:'arrive', 5:'sharp left',
    6:'sharp right', 7:'left', 8:'right', 9:'uturn', 10:'slight left', 11:'slight right',
  };
  const all: [number, number][] = [];
  const steps: RouteStep[] = [];
  const legs:  RouteStep[][] = [];

  for (const leg of data.trip.legs ?? []) {
    const c = decodeP6(leg.shape ?? '');
    all.push(...c);
    const ls: RouteStep[] = [];
    for (const m of leg.maneuvers ?? []) {
      const shp = c[m.begin_shape_index];
      ls.push({ type: m.type === 4 ? 'arrive' : m.type === 1 ? 'depart' : 'turn',
                modifier: TURN[m.type] ?? '', name: m.street_names?.[0] ?? '',
                distance: Math.round((m.length ?? 0) * 1609.34),
                duration: m.time ?? 0, lat: shp?.[1], lng: shp?.[0] });
    }
    steps.push(...ls); legs.push(ls);
  }

  return { coords: all, steps, legs,
           totalDistance: Math.round((data.trip.summary.length ?? 0) * 1609.34),
           totalDuration: data.trip.summary.time ?? 0, isProper: true };
}

// ── Engine 3: OSRM (Fossgis — great for backcountry/gravel roads) ─────────────
async function fetchOSRM(
  pairs: string[],
  _from: number,
  opts:  RouteOpts,
): Promise<RouteResult> {
  // OSRM uses "profile" in the URL — foot/car/bike
  const profile = opts.backRoads ? 'car' : 'car';
  const url = `https://router.project-osrm.org/route/v1/${profile}/${pairs.join(';')}` +
    `?steps=true&geometries=geojson&overview=full`;

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 10000);
  const data = await fetch(url, { signal: ctrl.signal }).then(r => r.json());
  clearTimeout(tid);

  if (!data.routes?.length) throw new Error('osrm no routes');

  const route  = data.routes[0];
  const steps: RouteStep[] = [];
  const legs:  RouteStep[][] = [];

  const OSRM_TURN: Record<string, string> = {
    'turn left': 'left', 'turn right': 'right',
    'turn sharp left': 'sharp left', 'turn sharp right': 'sharp right',
    'turn slight left': 'slight left', 'turn slight right': 'slight right',
    'uturn': 'uturn', 'arrive': 'arrive', 'depart': 'depart',
  };

  for (const leg of route.legs ?? []) {
    const ls: RouteStep[] = [];
    for (const s of leg.steps ?? []) {
      if (!s.geometry?.coordinates?.length) continue;
      const loc = s.geometry.coordinates[0];
      const manKey = `${s.maneuver?.type ?? ''} ${s.maneuver?.modifier ?? ''}`.trim();
      ls.push({
        type:     s.maneuver?.type ?? 'turn',
        modifier: OSRM_TURN[manKey] ?? s.maneuver?.modifier ?? '',
        name:     s.name ?? '',
        distance: s.distance ?? 0,
        duration: s.duration ?? 0,
        lat:      loc?.[1],
        lng:      loc?.[0],
      });
    }
    steps.push(...ls); legs.push(ls);
  }

  return { coords: route.geometry.coordinates, steps, legs,
           totalDistance: route.distance ?? 0,
           totalDuration: route.duration ?? 0, isProper: true };
}

// ── Engine 4: Local PMTiles router (offline, tap-anywhere) ───────────────────
// Reads road tiles from the device's conus.pmtiles, builds a graph, runs A*.
// Only available after the TileServer native module binary is installed.
async function fetchLocalRouter(
  pairs:  string[],
  _from:  number,
): Promise<RouteResult | null> {
  if (pairs.length < 2) return null;
  const [fromLng, fromLat] = pairs[0].split(',').map(Number);
  const [toLng,   toLat]   = pairs[pairs.length - 1].split(',').map(Number);

  const url = `http://127.0.0.1:57832/route?from_lat=${fromLat}&from_lng=${fromLng}&to_lat=${toLat}&to_lng=${toLng}`;
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 15000); // routing can take a few seconds
  const res  = await fetch(url, { signal: ctrl.signal });
  clearTimeout(tid);

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.coords?.length) return null;

  const coords: [number, number][] = data.coords.map((c: number[]) => [c[0], c[1]]);

  // Use real turn-by-turn steps from the offline router
  const steps: RouteStep[] = (data.steps ?? []).map((s: any) => ({
    type:     s.type     ?? 'turn',
    modifier: s.modifier ?? '',
    name:     s.name     ?? '',
    distance: s.distance ?? 0,
    duration: s.duration ?? 0,
    lat:      s.lat,
    lng:      s.lng,
  }));

  // Fallback if router returned no steps
  if (steps.length === 0) {
    steps.push({ type: 'depart', modifier: '', name: 'Head toward destination',
                 distance: data.distance_m ?? 0, duration: data.duration_s ?? 0 });
    steps.push({ type: 'arrive', modifier: '', name: 'Arrive at destination',
                 distance: 0, duration: 0,
                 lat: coords[coords.length-1]?.[1], lng: coords[coords.length-1]?.[0] });
  }

  return {
    coords,
    steps,
    legs:          [steps],
    totalDistance: data.distance_m  ?? 0,
    totalDuration: data.duration_s  ?? 0,
    isProper:      true,
    fromCache:     false,
  };
}

// ── Straight-line fallback (truly offline with no cached route) ───────────────
export function buildFallbackRoute(pairs: string[]): RouteResult {
  const coords: [number, number][] = pairs.map(p => {
    const [ln, lt] = p.split(',');
    return [parseFloat(ln), parseFloat(lt)];
  });
  return { coords, steps: [], legs: [[]], totalDistance: 0, totalDuration: 0, isProper: false };
}
