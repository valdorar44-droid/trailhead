/**
 * Routing — three live engines + offline route cache.
 *
 * Online priority:  Trailhead Valhalla for backroads → Mapbox → OSRM fallback
 * Offline fallback: cached route from last successful calculation for same waypoints
 * Last resort:      straight-line (isProper: false — UI shows warning)
 *
 * Routes are cached to the filesystem keyed by waypoint string so a route
 * planned on wifi is still available days later with no signal.
 */

import * as FileSystem from 'expo-file-system';
import type { RouteStep } from './types';
import { fetchJSOfflineRoute, ENABLE_JS_OFFLINE_ROUTER, getLastOfflineRouterDebug } from './offlineRouter';
import { diagnoseValhalla, routeValhalla } from 'expo-valhalla-routing';
import { ROUTING_REGIONS } from '../../lib/useOfflineFiles';

export interface RouteResult {
  coords:        [number, number][];
  steps:         RouteStep[];
  legs:          RouteStep[][];
  totalDistance: number;
  totalDuration: number;
  isProper:      boolean;
  fromCache?:    boolean;
  debug?:        string;
}

interface RouteOpts {
  avoidTolls:     boolean;
  avoidHighways:  boolean;
  backRoads:      boolean;
  noFerries:      boolean;
}

// ── Route cache (filesystem, survives app restarts) ───────────────────────────
const CACHE_DIR      = `${FileSystem.documentDirectory}routes/`;
const LAST_ROUTE_PATH = `${FileSystem.documentDirectory}routes/last_route.json`;
const LAST_ROUTE_DEST_TOLERANCE_M = 150;
const LAST_ROUTE_START_TOLERANCE_M = 5_000;
const TRAILHEAD_API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://trailhead-production-2049.up.railway.app';
const ROUTE_CACHE_VERSION = 'valhalla-proxy-v2';
const ROUTER_DEBUG_MARKER = 'DBGv4';

async function ensureCacheDir() {
  await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(() => {});
}

function normCoord(coord: string): string {
  // 4 decimal places ≈ 11m tolerance — coarse enough to survive GPS drift between
  // app sessions (GPS can shift 5-15m at rest) but fine enough distinct routes don't collide.
  const [lng, lat] = coord.split(',').map(s => parseFloat(s).toFixed(4));
  return `${lng},${lat}`;
}

function cacheKey(pairs: string[]): string {
  return `${ROUTE_CACHE_VERSION}|${pairs.map(normCoord).join('|')}`.replace(/\./g, '_').slice(0, 170);
}

function parsePair(pair: string): [number, number] | null {
  const [lng, lat] = pair.split(',').map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function coordDistanceM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const la1 = a[1] * Math.PI / 180;
  const la2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function minDistanceToRouteM(point: [number, number], coords: [number, number][]): number {
  if (!coords.length) return Infinity;
  let best = Infinity;
  const step = Math.max(1, Math.floor(coords.length / 500));
  for (let i = 0; i < coords.length; i += step) {
    best = Math.min(best, coordDistanceM(point, coords[i]));
    if (best < 50) break;
  }
  return best;
}

function routeMatchesRequest(parsed: any, pairs: string[]): boolean {
  if (parsed.routeCacheVersion !== ROUTE_CACHE_VERSION) return false;
  const reqStart = parsePair(pairs[0]);
  const reqEnd = parsePair(pairs[pairs.length - 1]);
  if (!reqStart || !reqEnd) return false;

  const savedPairs = Array.isArray(parsed.requestedPairs) ? parsed.requestedPairs as string[] : [];
  if (savedPairs.length > 0) {
    const savedStart = parsePair(savedPairs[0]);
    if (!savedStart || coordDistanceM(reqStart, savedStart) > LAST_ROUTE_START_TOLERANCE_M) return false;

    const savedEnd = parsePair(savedPairs[savedPairs.length - 1]);
    if (!savedEnd || coordDistanceM(reqEnd, savedEnd) > LAST_ROUTE_DEST_TOLERANCE_M) return false;

    const sameStops = savedPairs.length === pairs.length &&
      pairs.slice(1).every((pair, i) => {
        const a = parsePair(pair);
        const b = parsePair(savedPairs[i + 1]);
        return !!a && !!b && coordDistanceM(a, b) <= LAST_ROUTE_DEST_TOLERANCE_M;
      });
    if (sameStops) return true;
  }

  const coords = Array.isArray(parsed.coords) ? parsed.coords as [number, number][] : [];
  const cachedEnd = coords[coords.length - 1];
  if (!cachedEnd || coordDistanceM(reqEnd, cachedEnd) > LAST_ROUTE_DEST_TOLERANCE_M) return false;

  return minDistanceToRouteM(reqStart, coords) <= LAST_ROUTE_START_TOLERANCE_M;
}

async function saveRoute(pairs: string[], result: RouteResult) {
  try {
    await ensureCacheDir();
    const key  = cacheKey(pairs);
    const path = `${CACHE_DIR}${key}.json`;
    const json = JSON.stringify({ ...result, requestedPairs: pairs, routeCacheVersion: ROUTE_CACHE_VERSION, savedAt: Date.now() });
    // Save keyed route + always overwrite last_route (the "I was just navigating" fallback)
    await Promise.all([
      FileSystem.writeAsStringAsync(path, json),
      FileSystem.writeAsStringAsync(LAST_ROUTE_PATH, json),
    ]);
    console.log('[RouteCache] saved key:', key);
  } catch (e) {
    console.warn('[RouteCache] save failed', e);
  }
}

async function loadKeyedRoute(pairs: string[]): Promise<RouteResult | null> {
  try {
    const key  = cacheKey(pairs);
    const path = `${CACHE_DIR}${key}.json`;
    console.log('[RouteCache] keyed check, key:', key);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(path));
      console.log('[RouteCache] keyed hit — coords:', parsed.coords?.length);
      return { ...parsed, fromCache: true };
    }
  } catch (e) {
    console.warn('[RouteCache] keyed load error', e);
  }
  return null;
}

async function loadLastRoute(pairs: string[]): Promise<RouteResult | null> {
  try {
    const info = await FileSystem.getInfoAsync(LAST_ROUTE_PATH);
    if (info.exists) {
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(LAST_ROUTE_PATH));
      if (routeMatchesRequest(parsed, pairs)) {
        console.log('[RouteCache] last_route hit — coords:', parsed.coords?.length);
        return { ...parsed, fromCache: true };
      }
      console.log('[RouteCache] last_route mismatch — ignoring');
    }
  } catch (e) {
    console.warn('[RouteCache] last_route load error', e);
  }
  return null;
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
  console.log('[fetchRoute] pairs:', pairs);
  const nativeOfflineErrors: string[] = [];

  // A. Keyed cache first — exact/near-exact same route, no network/local graph work.
  const cached = await loadKeyedRoute(pairs);
  if (cached) {
    console.log('[fetchRoute] returning keyed cached route');
    return cached;
  }

  const tryNativeOfflineValhalla = async () => {
    if (pairs.length < 2) return null;
    const offline = await fetchNativeValhallaOffline(pairs, routeOpts);
    if (!offline) return null;
    console.log('[fetchRoute] native offline Valhalla route — saving to cache');
    await saveRoute(pairs, offline);
    return offline;
  };

  const tryOfflineRouter = async () => {
    if (!ENABLE_JS_OFFLINE_ROUTER || pairs.length < 2) return null;
    const [fromLng, fromLat] = pairs[0].split(',').map(Number);
    const [toLng,   toLat]   = pairs[pairs.length - 1].split(',').map(Number);
    const offline = await fetchJSOfflineRoute(fromLng, fromLat, toLng, toLat);
    if (!offline) return null;
    console.log('[fetchRoute] offline JS route — saving to cache');
    await saveRoute(pairs, offline);
    return offline;
  };

  // B. If offline, go straight to PMTiles A* before considering last_route.json.
  const online = await isOnline();
  if (!online) {
    console.log('[fetchRoute] offline — trying native Valhalla routing pack');
    try {
      const offline = await tryNativeOfflineValhalla();
      if (offline) return offline;
    } catch (e) {
      console.warn('[fetchRoute] native offline Valhalla error', e);
      nativeOfflineErrors.push(`${ROUTER_DEBUG_MARKER} ${e instanceof Error ? e.message : String(e)}`);
    }

    console.log('[fetchRoute] offline — trying JS PMTiles router');
    try {
      const offline = await tryOfflineRouter();
      if (offline) return offline;
    } catch (e) {
      console.warn('[fetchRoute] JS offline router error', e);
      const msg = e instanceof Error ? e.message : String(e);
      const nativeDebug = nativeOfflineErrors.length ? `native valhalla: ${nativeOfflineErrors.join(' | ')}; ` : '';
      return buildFallbackRoute(pairs, `${nativeDebug}offline router exception: ${msg}`);
    }
    const last = await loadLastRoute(pairs);
    if (last) {
      console.log('[fetchRoute] returning matching last_route fallback');
      return last;
    }
    console.log('[RouteCache] miss — no cached route found');
    const debug = getLastOfflineRouterDebug();
    const nativeDebug = nativeOfflineErrors.length ? `native valhalla: ${nativeOfflineErrors.join(' | ')}; ` : '';
    console.log('[fetchRoute] offline router failed — no drawable route', debug);
    return buildNoRoute(pairs, `${nativeDebug}${debug}`);
  }

  // C. Online: for overland-style routes, prefer our Valhalla service. Racing
  // Mapbox here lets paved/highway routes win before Valhalla can return.
  const onlineEngines = routeOpts.backRoads || routeOpts.avoidHighways
    ? [
        () => fetchValhalla(pairs, fromIdx, routeOpts),
        () => fetchMapbox(pairs, fromIdx, mapboxToken, routeOpts),
        () => fetchOSRM(pairs, fromIdx, routeOpts),
      ]
    : [
        () => fetchMapbox(pairs, fromIdx, mapboxToken, routeOpts),
        () => fetchValhalla(pairs, fromIdx, routeOpts),
        () => fetchOSRM(pairs, fromIdx, routeOpts),
      ];

  console.log('[fetchRoute] online — trying live engines in priority order');
  for (const engine of onlineEngines) {
    try {
      const route = await engine();
      console.log('[fetchRoute] online route — saving to cache');
      await saveRoute(pairs, route);
      return route;
    } catch (e) {
      console.warn('[fetchRoute] live engine failed', e);
    }
  }

  // D. JS offline router — reads road tiles from local TileServer, runs A*
  try {
    const offline = await tryNativeOfflineValhalla();
    if (offline) return offline;
  } catch (e) {
    console.warn('[fetchRoute] native offline Valhalla error', e);
    nativeOfflineErrors.push(`${ROUTER_DEBUG_MARKER} ${e instanceof Error ? e.message : String(e)}`);
  }

  if (ENABLE_JS_OFFLINE_ROUTER && pairs.length >= 2) {
    try {
      const offline = await tryOfflineRouter();
      if (offline) return offline;
    } catch (e) {
      console.warn('[fetchRoute] JS offline router error', e);
    }
  }

  // E. Only after keyed cache + online + JS router fail, use matching last_route.
  const last = await loadLastRoute(pairs);
  if (last) {
    console.log('[fetchRoute] returning matching last_route fallback');
    return last;
  }

  // F. True last resort. Offline should not draw a fake route across fields.
  console.log('[RouteCache] miss — no cached route found');
  const debug = getLastOfflineRouterDebug();
  const nativeDebug = nativeOfflineErrors.length ? `native valhalla: ${nativeOfflineErrors.join(' | ')}; ` : '';
  console.log('[fetchRoute] all engines failed — no drawable route', debug);
  return buildNoRoute(pairs, `${nativeDebug}${debug}`);
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

// ── Engine 2: Trailhead Valhalla proxy ────────────────────────────────────────
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
  const tid  = setTimeout(() => ctrl.abort(), 20000);
  const data = await fetch(`${TRAILHEAD_API_BASE}/api/route`, {
    method: 'POST', signal: ctrl.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: locs,
      options: opts,
      units: 'miles',
    }),
  }).then(async r => {
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`trailhead valhalla ${r.status}: ${json?.detail ?? 'failed'}`);
    return json;
  });
  clearTimeout(tid);

  if (!data.trip || data.trip.status !== 0) throw new Error('valhalla error');
  return parseValhallaRoute(data);
}

function parseValhallaRoute(data: any): RouteResult {
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

// ── Engine 2b: native Valhalla Mobile routing pack (true offline) ────────────
function pointInBounds(point: [number, number], bounds: { n: number; s: number; e: number; w: number }): boolean {
  const [lng, lat] = point;
  return lat >= bounds.s && lat <= bounds.n && lng >= bounds.w && lng <= bounds.e;
}

function findRoutingRegion(pairs: string[]) {
  const coords = pairs.map(parsePair).filter(Boolean) as [number, number][];
  if (coords.length !== pairs.length) return null;

  for (const region of Object.values(ROUTING_REGIONS)) {
    if (coords.every(coord => pointInBounds(coord, region.bounds))) return region;
  }
  return null;
}

function buildValhallaRequest(pairs: string[], opts: RouteOpts): string {
  return JSON.stringify({
    locations: pairs.map(pair => {
      const [lon, lat] = pair.split(',').map(Number);
      return { lat, lon };
    }),
    costing: 'auto',
    costing_options: {
      auto: {
        use_highways: opts.avoidHighways ? 0 : opts.backRoads ? 0.2 : 0.5,
        use_tolls: opts.avoidTolls ? 0 : 0.5,
        use_ferry: opts.noFerries ? 0 : 0.5,
      },
    },
    directions_options: { units: 'miles' },
  });
}

function nativeFilePath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}

function compactValhallaDiag(diag: string): string {
  const pick = (key: string) => diag.match(new RegExp(`${key}=([^ ]+)`))?.[1] ?? '?';
  const reqPrefix = diag.match(/reqPrefix=(.*?)(?: packExists=|$)/)?.[1] ?? '?';
  const configPrefix = diag.match(/configJsonPrefix=(.*)$/)?.[1] ?? '';
  return `diag ${pick('packExists')} ${pick('packMB')}MB req=${reqPrefix.slice(0, 52)} cfg=${configPrefix.slice(0, 42)}`;
}

async function fetchNativeValhallaOffline(
  pairs: string[],
  opts: RouteOpts,
): Promise<RouteResult | null> {
  const region = findRoutingRegion(pairs);
  if (!region) {
    console.log('[ValhallaOffline] no single downloaded-state candidate covers route');
    return null;
  }

  const info = await FileSystem.getInfoAsync(region.localPath).catch(() => null);
  if (!info?.exists) {
    console.log('[ValhallaOffline] routing pack missing:', region.id);
    return null;
  }

  const requestJson = buildValhallaRequest(pairs, opts);
  const packPath = nativeFilePath(region.localPath);
  const diag = await diagnoseValhalla(packPath, requestJson).catch(e => `native-diag-error=${e instanceof Error ? e.message : String(e)}`);
  const raw = await routeValhalla(packPath, requestJson).catch(e => {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${ROUTER_DEBUG_MARKER} ${compactValhallaDiag(diag)}; ${msg}`);
  });
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rawPrefix = String(raw).replace(/\s+/g, ' ').slice(0, 80);
    throw new Error(`${ROUTER_DEBUG_MARKER} ${compactValhallaDiag(diag)} raw=${rawPrefix}; ${msg}`);
  }
  if (!data.trip || data.trip.status !== 0) {
    const msg = data.error ?? data.message ?? data.trip?.status_message ?? 'valhalla offline error';
    throw new Error(`${ROUTER_DEBUG_MARKER} ${compactValhallaDiag(diag)}; ${String(msg)}`);
  }

  const result = parseValhallaRoute(data);
  return { ...result, debug: `offline valhalla ${region.id}` };
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
  return null; // Disabled: Swift OfflineRouter has fatal crash points (re-enable after binary fix)
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
export function buildFallbackRoute(pairs: string[], debug = 'route fallback'): RouteResult {
  const coords: [number, number][] = pairs.map(p => {
    const [ln, lt] = p.split(',');
    return [parseFloat(ln), parseFloat(lt)];
  });
  return { coords, steps: [], legs: [[]], totalDistance: 0, totalDuration: 0, isProper: false, debug };
}

export function buildNoRoute(pairs: string[], debug = 'route unavailable'): RouteResult {
  const coords: [number, number][] = pairs.slice(0, 1).map(p => {
    const [ln, lt] = p.split(',');
    return [parseFloat(ln), parseFloat(lt)];
  });
  return { coords, steps: [], legs: [[]], totalDistance: 0, totalDuration: 0, isProper: false, debug };
}
