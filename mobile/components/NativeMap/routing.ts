/**
 * Routing logic — moved from WebView JS to TypeScript.
 * Tries Mapbox Directions first, falls back to Valhalla (OSM-based, free).
 */

import type { RouteStep } from './types';

export interface RouteResult {
  coords: [number, number][];
  steps: RouteStep[];
  legs: RouteStep[][];
  totalDistance: number;
  totalDuration: number;
  isProper: boolean;
}

interface RouteOpts {
  avoidTolls: boolean;
  avoidHighways: boolean;
  backRoads: boolean;
  noFerries: boolean;
}

// ── Decode Valhalla's polyline6 encoded shape ─────────────────────────────────
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

export async function fetchRoute(
  pairs: string[],        // "lng,lat" strings
  fromIdx: number,
  mapboxToken: string,
  routeOpts: RouteOpts,
): Promise<RouteResult> {
  // Try Mapbox Directions
  try {
    return await fetchMapbox(pairs, fromIdx, mapboxToken, routeOpts);
  } catch {
    // Fall back to Valhalla
    return await fetchValhalla(pairs, fromIdx, routeOpts);
  }
}

async function fetchMapbox(
  pairs: string[],
  fromIdx: number,
  token: string,
  opts: RouteOpts,
): Promise<RouteResult> {
  const profile = opts.backRoads ? 'driving' : 'driving-traffic';
  const excl = [
    opts.avoidTolls ? 'toll' : '',
    opts.avoidHighways ? 'motorway' : '',
    opts.noFerries ? 'ferry' : '',
  ].filter(Boolean);
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${pairs.join(';')}?access_token=${token}&steps=true&geometries=geojson&overview=full&annotations=maxspeed&banner_instructions=true${excl.length ? `&exclude=${excl.join(',')}` : ''}`;

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  const data = await fetch(url, { signal: ctrl.signal }).then(r => r.json());
  clearTimeout(tid);

  if (!data.routes?.length) throw new Error('no routes');

  const route = data.routes[0];
  const steps: RouteStep[] = [];
  const legs: RouteStep[][] = [];

  for (const leg of route.legs || []) {
    const ls: RouteStep[] = [];
    for (const s of leg.steps || []) {
      if (s.distance <= 0 && s.maneuver?.type !== 'arrive') continue;
      const spd = s.intersections?.reduce((freq: Record<number, number>, isc: any) => {
        if (isc.lanes?.length) {
          const sp = (isc.speed_limit || null);
          if (sp) { freq[sp] = (freq[sp] || 0) + 1; }
        }
        return freq;
      }, {} as Record<number, number>);
      const maxspeed = spd ? Number(Object.keys(spd).sort((a: any, b: any) => spd[b] - spd[a])[0] || null) : null;
      const loc = s.maneuver?.location;
      const lanes = s.intersections?.slice().reverse().reduce((found: any, isc: any) => {
        if (found !== undefined) return found;
        return isc.lanes?.length ? isc.lanes.map((l: any) => ({ indications: l.indications || [], valid: l.valid === true, active: l.active === true })) : undefined;
      }, undefined);
      const st: RouteStep = {
        type: s.maneuver?.type || 'turn',
        modifier: s.maneuver?.modifier || '',
        name: s.name || '',
        distance: s.distance,
        duration: s.duration,
        lat: loc?.[1],
        lng: loc?.[0],
        lanes: lanes?.length ? lanes : undefined,
        speedLimit: maxspeed,
      };
      steps.push(st);
      ls.push(st);
    }
    legs.push(ls);
  }

  return {
    coords: route.geometry.coordinates,
    steps,
    legs,
    totalDistance: route.distance,
    totalDuration: route.duration,
    isProper: true,
  };
}

async function fetchValhalla(
  pairs: string[],
  fromIdx: number,
  opts: RouteOpts,
): Promise<RouteResult> {
  const locs = pairs.map(p => {
    const [ln, lt] = p.split(',');
    return { lon: parseFloat(ln), lat: parseFloat(lt) };
  });
  const body = {
    locations: locs,
    costing: 'auto',
    costing_options: {
      auto: {
        use_tracks: opts.backRoads ? 0.9 : 0.1,
        use_highways: opts.avoidHighways ? 0 : 1,
        use_tolls: opts.avoidTolls ? 0 : 0.5,
      },
    },
    units: 'miles',
  };

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12000);
  const data = await fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    signal: ctrl.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
  clearTimeout(tid);

  if (!data.trip || data.trip.status !== 0) throw new Error('valhalla error');

  const TURN_MAP: Record<number, string> = { 0: '', 1: '', 2: 'left', 3: 'right', 4: 'arrive', 5: 'sharp left', 6: 'sharp right', 7: 'left', 8: 'right', 9: 'uturn', 10: 'slight left', 11: 'slight right' };
  const all: [number, number][] = [];
  const steps: RouteStep[] = [];
  const legs: RouteStep[][] = [];

  for (const leg of data.trip.legs || []) {
    const c = decodeP6(leg.shape || '');
    all.push(...c);
    const ls: RouteStep[] = [];
    for (const m of leg.maneuvers || []) {
      const dist = Math.round((m.length || 0) * 1609.34);
      const shp = c[m.begin_shape_index];
      const st: RouteStep = {
        type: m.type === 4 ? 'arrive' : m.type === 1 ? 'depart' : 'turn',
        modifier: TURN_MAP[m.type] || '',
        name: m.street_names?.[0] || '',
        distance: dist,
        duration: m.time || 0,
        lat: shp?.[1],
        lng: shp?.[0],
      };
      steps.push(st);
      ls.push(st);
    }
    legs.push(ls);
  }

  return {
    coords: all,
    steps,
    legs,
    totalDistance: Math.round((data.trip.summary.length || 0) * 1609.34),
    totalDuration: data.trip.summary.time || 0,
    isProper: true,
  };
}

// Fallback: straight-line segments between waypoints (no network needed)
export function buildFallbackRoute(pairs: string[]): RouteResult {
  const coords: [number, number][] = pairs.map(p => {
    const [ln, lt] = p.split(',');
    return [parseFloat(ln), parseFloat(lt)];
  });
  return { coords, steps: [], legs: [[]], totalDistance: 0, totalDuration: 0, isProper: false };
}
