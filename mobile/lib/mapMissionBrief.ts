import type {
  ExplorerCheckpoint,
  GasStation,
  MissionControlBrief,
  OsmPoi,
  RouteScoutDayPlan,
  RouteScoutState,
  TripResult,
} from './api';
import {
  buildMissionCinematic,
  type MissionCinematic,
  type MissionScene,
  type StoryboardPlace,
} from './copilotStoryboard';

export type MapMissionBriefPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'done';

export type MapMissionBriefState = {
  phase: MapMissionBriefPhase;
  cinematic: MissionCinematic | null;
  sceneIndex: number;
  missionBrief: MissionControlBrief | null;
  error: string | null;
};

export type MissionBriefCallout = {
  id: string;
  title: string;
  note?: string;
  lat: number;
  lng: number;
  kind: string;
};

export type MissionRouteResult = {
  coords: [number, number][];
  source: string;
};

const SCOUT_READY_STATUSES = new Set(['ready', 'review', 'locked', 'finish']);

export function initialMapMissionBriefState(): MapMissionBriefState {
  return {
    phase: 'idle',
    cinematic: null,
    sceneIndex: 0,
    missionBrief: null,
    error: null,
  };
}

export function routeCoordsFromScout(routeScout: RouteScoutState | null | undefined): [number, number][] {
  const raw = routeScout?.routeCoords;
  if (!Array.isArray(raw) || raw.length < 2) return [];
  return raw
    .map(coord => [Number(coord[0]), Number(coord[1])] as [number, number])
    .filter(coord => Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
}

export function routeCoordsFromLngLat(coords: [number, number][]): [number, number][] {
  return (coords || [])
    .map(coord => [Number(coord[0]), Number(coord[1])] as [number, number])
    .filter(coord => Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
}

function coordKey(lat: number, lng: number, id?: string) {
  const roundedLat = Math.round(lat * 10000) / 10000;
  const roundedLng = Math.round(lng * 10000) / 10000;
  return `${id || ''}:${roundedLat},${roundedLng}`;
}

function finiteCoord(lat: unknown, lng: unknown): lat is number {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

function routeEndpoints(coords: [number, number][]) {
  if (coords.length < 2) return null;
  return { start: coords[0], end: coords[coords.length - 1] };
}

function endpointsNear(
  a: { start: [number, number]; end: [number, number] },
  b: { start: [number, number]; end: [number, number] },
  tolerance = 0.08,
) {
  const near = (p: [number, number], q: [number, number]) =>
    Math.abs(p[0] - q[0]) <= tolerance && Math.abs(p[1] - q[1]) <= tolerance;
  return (near(a.start, b.start) && near(a.end, b.end))
    || (near(a.start, b.end) && near(a.end, b.start));
}

function routeMatchesContext(
  coords: [number, number][],
  activeTrip?: TripResult | null,
  routeScout?: RouteScoutState | null,
) {
  const endpoints = routeEndpoints(coords);
  if (!endpoints) return false;
  const tripCoords = routeCoordsFromLngLat(activeTrip?.route_geometry?.coords ?? []);
  const scoutCoords = routeCoordsFromScout(routeScout);
  const tripEndpoints = routeEndpoints(tripCoords);
  const scoutEndpoints = routeEndpoints(scoutCoords);
  if (tripEndpoints && endpointsNear(endpoints, tripEndpoints)) return true;
  if (scoutEndpoints && endpointsNear(endpoints, scoutEndpoints)) return true;
  if (!tripEndpoints && !scoutEndpoints) return true;
  return false;
}

export function getCurrentMissionRoute(input: {
  lastRouteCoords?: [number, number][];
  activeTrip?: TripResult | null;
  routeScout?: RouteScoutState | null;
  routeBuilderCoords?: [number, number][];
}): MissionRouteResult | null {
  const lastRoute = routeCoordsFromLngLat(input.lastRouteCoords ?? []);
  const tripRoute = routeCoordsFromLngLat(input.activeTrip?.route_geometry?.coords ?? []);
  const scoutRoute = routeCoordsFromScout(input.routeScout);
  const builderRoute = routeCoordsFromLngLat(input.routeBuilderCoords ?? []);
  const scoutReady = SCOUT_READY_STATUSES.has(String(input.routeScout?.status || '').toLowerCase());

  if (lastRoute.length >= 2 && routeMatchesContext(lastRoute, input.activeTrip, input.routeScout)) {
    return { coords: lastRoute, source: 'visible_route' };
  }
  if (tripRoute.length >= 2) {
    return { coords: tripRoute, source: 'active_trip' };
  }
  if (scoutRoute.length >= 2 && scoutReady) {
    return { coords: scoutRoute, source: 'route_scout' };
  }
  if (builderRoute.length >= 2) {
    return { coords: builderRoute, source: 'route_builder' };
  }
  if (lastRoute.length >= 2) {
    return { coords: lastRoute, source: 'visible_route_unverified' };
  }
  return null;
}

export function showFlyPlanAction(input: Parameters<typeof getCurrentMissionRoute>[0]): boolean {
  const route = getCurrentMissionRoute(input);
  if (!route) return false;
  if (route.source === 'visible_route_unverified') return false;
  const scoutReady = SCOUT_READY_STATUSES.has(String(input.routeScout?.status || '').toLowerCase());
  if (input.activeTrip?.route_geometry?.coords?.length) return true;
  if (scoutReady && routeCoordsFromScout(input.routeScout).length >= 2) return true;
  if (route.source === 'visible_route' || route.source === 'route_builder') return true;
  return false;
}

export function checkpointsFromScout(routeScout: RouteScoutState | null | undefined): ExplorerCheckpoint[] {
  const stops = routeScout?.stops ?? routeScout?.previewStops ?? [];
  return stops
    .filter(stop => finiteCoord(stop.lat, stop.lng))
    .map((stop, idx) => ({
      id: `scout-stop-${stop.day}-${idx}`,
      type: String(stop.type || 'camp'),
      title: String(stop.name || stop.label || `Stop ${idx + 1}`),
      note: String(stop.description || stop.reason || ''),
      lat: Number(stop.lat),
      lng: Number(stop.lng),
      day: Number(stop.day) || 1,
      sequence: idx,
      status: stop.type === 'camp' ? 'confirmed' : stop.type === 'review' ? 'review' : 'planned',
      source: 'trailhead',
      confidence: stop.type === 'camp' ? 'high' : 'medium',
    }));
}

export function placesFromScout(routeScout: RouteScoutState | null | undefined): StoryboardPlace[] {
  const stops = routeScout?.stops ?? routeScout?.previewStops ?? [];
  return stops
    .filter(stop => finiteCoord(stop.lat, stop.lng))
    .map((stop, idx) => ({
      id: `scout-place-${stop.day}-${idx}`,
      type: String(stop.type || 'stop'),
      title: String(stop.name || stop.label || `Stop ${idx + 1}`),
      note: String(stop.description || stop.reason || ''),
      lat: Number(stop.lat),
      lng: Number(stop.lng),
      day: Number(stop.day) || undefined,
      source: String(stop.source || 'copilot_route_scout'),
      confidence: stop.type === 'camp' ? 'high' : 'medium',
    }));
}

function checkpointsFromTripWaypoints(activeTrip?: TripResult | null): ExplorerCheckpoint[] {
  const waypoints = activeTrip?.plan?.waypoints ?? [];
  return waypoints
    .filter(wp => finiteCoord(wp.lat, wp.lng))
    .map((wp, idx) => ({
      id: `trip-wp-${idx}`,
      type: String(wp.type || 'waypoint'),
      title: String(wp.name || `Waypoint ${idx + 1}`),
      note: String(wp.notes || wp.description || ''),
      lat: Number(wp.lat),
      lng: Number(wp.lng),
      day: Number(wp.day) || 1,
      sequence: idx,
      status: 'planned',
      source: 'trailhead',
      confidence: 'medium',
    }));
}

function placesFromTripGas(gasStations: GasStation[] = []): StoryboardPlace[] {
  return gasStations
    .filter(g => finiteCoord(g.lat, g.lng))
    .map((g, idx) => ({
      id: `trip-gas-${g.id ?? idx}`,
      type: 'fuel',
      title: String(g.name || 'Fuel stop'),
      note: String(g.address || g.fuel_types || ''),
      lat: Number(g.lat),
      lng: Number(g.lng),
      day: Number((g as { recommended_day?: number }).recommended_day) || undefined,
      source: 'trip_gas',
      confidence: 'medium' as const,
    }));
}

function placesFromTripCamps(campsites: TripResult['campsites'] = []): StoryboardPlace[] {
  return campsites
    .filter(c => finiteCoord(c.lat, c.lng))
    .map((c, idx) => ({
      id: `trip-camp-${c.id ?? idx}`,
      type: 'camp',
      title: String(c.name || 'Camp'),
      note: String(c.description || ''),
      lat: Number(c.lat),
      lng: Number(c.lng),
      day: Number((c as { recommended_day?: number }).recommended_day) || undefined,
      source: 'trip_camp',
      confidence: 'high' as const,
    }));
}

function placesFromRoutePois(routePois: OsmPoi[] = []): StoryboardPlace[] {
  return routePois
    .filter(p => finiteCoord(p.lat, p.lng))
    .map((p, idx) => ({
      id: `trip-poi-${p.id ?? idx}`,
      type: String(p.type || 'poi'),
      title: String(p.name || 'Point of interest'),
      note: String(p.address || p.description || ''),
      lat: Number(p.lat),
      lng: Number(p.lng),
      day: Number((p as { recommended_day?: number }).recommended_day) || undefined,
      source: String(p.source || 'route_poi'),
      confidence: 'medium' as const,
    }));
}

function checkpointsFromMissionBrief(missionBrief?: MissionControlBrief | null): ExplorerCheckpoint[] {
  return (missionBrief?.overnights ?? [])
    .filter(o => finiteCoord(o.lat, o.lng))
    .map((o, idx) => ({
      id: `mc-overnight-${idx}`,
      type: 'camp',
      title: String(o.name || `Overnight ${idx + 1}`),
      note: String(o.reason || ''),
      lat: Number(o.lat),
      lng: Number(o.lng),
      day: Number(o.day) || 1,
      sequence: idx,
      status: o.status === 'confirmed' ? 'confirmed' : o.status === 'review_area' ? 'review' : 'planned',
      source: 'mission_control',
      confidence: o.confidence === 'high' ? 'high' : 'medium',
    }));
}

export function dedupeCheckpoints(items: ExplorerCheckpoint[]): ExplorerCheckpoint[] {
  const seen = new Set<string>();
  const out: ExplorerCheckpoint[] = [];
  for (const item of items) {
    const key = coordKey(item.lat, item.lng, item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function dedupePlaces(items: StoryboardPlace[]): StoryboardPlace[] {
  const seen = new Set<string>();
  const out: StoryboardPlace[] = [];
  for (const item of items) {
    const key = coordKey(item.lat, item.lng, item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function checkpointsFromTrip(
  activeTrip?: TripResult | null,
  routeScout?: RouteScoutState | null,
  missionBrief?: MissionControlBrief | null,
): ExplorerCheckpoint[] {
  return dedupeCheckpoints([
    ...checkpointsFromScout(routeScout),
    ...checkpointsFromTripWaypoints(activeTrip),
    ...checkpointsFromMissionBrief(missionBrief),
  ]);
}

export function placesFromTrip(input: {
  activeTrip?: TripResult | null;
  routeScout?: RouteScoutState | null;
  gasStations?: GasStation[];
  campsites?: TripResult['campsites'];
  routePois?: OsmPoi[];
  selectedTrail?: { id?: string; name?: string; lat?: number; lng?: number } | null;
  exploreRouteRankPlaces?: StoryboardPlace[];
}): StoryboardPlace[] {
  const gas = input.gasStations ?? input.activeTrip?.gas_stations ?? [];
  const camps = input.campsites ?? input.activeTrip?.campsites ?? [];
  const pois = input.routePois ?? input.activeTrip?.route_pois ?? [];
  const trailPlaces: StoryboardPlace[] = input.selectedTrail && finiteCoord(input.selectedTrail.lat, input.selectedTrail.lng)
    ? [{
      id: `selected-trail-${input.selectedTrail.id ?? input.selectedTrail.name ?? 'trail'}`,
      type: 'trail',
      title: String(input.selectedTrail.name || 'Trail'),
      lat: Number(input.selectedTrail.lat),
      lng: Number(input.selectedTrail.lng),
      source: 'selected_trail',
      confidence: 'high',
    }]
    : [];
  return dedupePlaces([
    ...placesFromScout(input.routeScout),
    ...placesFromTripGas(gas),
    ...placesFromTripCamps(camps),
    ...placesFromRoutePois(pois),
    ...trailPlaces,
    ...(input.exploreRouteRankPlaces ?? []),
  ]);
}

export function tripNameFromScout(routeScout: RouteScoutState | null | undefined, fallback = 'Your route') {
  const start = String(routeScout?.startName || '').trim();
  const end = String(routeScout?.destinationName || '').trim();
  if (start && end) return `${start} to ${end}`;
  return fallback;
}

export function shouldSpeakScene(scene: MissionScene): boolean {
  // route_rejoin is a silent camera transition — it must never wait on voice.
  return scene.type !== 'whole_route' && scene.type !== 'route_rejoin';
}

export function isLiveScoutCinematic(cinematic: MissionCinematic | null | undefined): boolean {
  return !!cinematic?.sources?.includes('route_scout_live');
}

export function shouldSpeakLiveScoutScene(scene: MissionScene): boolean {
  return ['intro', 'drive_leg', 'camp_arrival', 'fuel_stop', 'monument_orbit', 'poi_flyover', 'mission_recap'].includes(scene.type);
}

export function shouldSpeakMissionScene(
  cinematic: MissionCinematic | null | undefined,
  scene: MissionScene,
): boolean {
  if (isLiveScoutCinematic(cinematic)) return shouldSpeakLiveScoutScene(scene);
  return shouldSpeakScene(scene);
}

export function missionBeatCaption(
  cinematic: MissionCinematic | null | undefined,
  scene: MissionScene,
  routeScout?: RouteScoutState | null,
): string {
  if (isLiveScoutCinematic(cinematic)) {
    return liveMissionBeatBrief(scene, routeScout).trim();
  }
  return String(scene.narration || scene.subtitle || scene.title || '').trim();
}

export function sceneNarrationWatchdogMs(scene: MissionScene, speed = 1): number {
  const base = Math.max(7000, Number(scene.durationMs) || 12000);
  const effective = Math.max(1500, base / Math.max(0.25, speed));
  return Math.max(7000, effective + 3000);
}

function parseDriveMiles(summary?: string | null): number | null {
  const match = String(summary || '').match(/([\d.]+)\s*mi/i);
  if (!match) return null;
  const miles = Number(match[1]);
  return Number.isFinite(miles) ? miles : null;
}

function isDispersedCamp(meta?: string | null) {
  const lower = String(meta || '').toLowerCase();
  return lower.includes('dispersed') || lower.includes('blm') || lower.includes('boondock');
}

function routeRatioAlong(route: [number, number][], lat: number, lng: number): number {
  if (route.length < 2) return 0.5;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < route.length; i += 1) {
    const dLng = route[i][0] - lng;
    const dLat = route[i][1] - lat;
    const dist = dLng * dLng + dLat * dLat;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx / (route.length - 1);
}

function clampRouteRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** Live flythrough storyboard built from the route scout the user just watched build. */
export function buildScoutLiveCinematic(input: {
  tripId?: string | null;
  tripName: string;
  route: [number, number][];
  routeScout?: RouteScoutState | null;
  missionBrief?: MissionControlBrief | null;
}): MissionCinematic | null {
  const route = routeCoordsFromLngLat(input.route);
  const dayPlans = input.routeScout?.dayPlans ?? [];
  if (route.length < 2 || dayPlans.length < 1) return null;

  const scout = input.routeScout;
  const startName = String(scout?.startName || 'the start').trim();
  const destName = String(scout?.destinationName || 'the finish').trim();
  const stops = scout?.stops ?? scout?.previewStops ?? [];
  const scenes: MissionScene[] = [];
  const stopKey = (stop: { lat?: number; lng?: number; name?: string }) =>
    `${String(stop.name || '').toLowerCase()}:${Number(stop.lat).toFixed(4)},${Number(stop.lng).toFixed(4)}`;
  const stopSceneType = (stop: { type?: string; name?: string }): 'fuel_stop' | 'monument_orbit' | 'poi_flyover' => {
    const raw = `${stop.type || ''} ${stop.name || ''}`.toLowerCase();
    if (/\b(fuel|gas|diesel|propane|charge|ev)\b/.test(raw)) return 'fuel_stop';
    if (/\b(arch|monument|overlook|view|vista|scenic|park|canyon|waterfall|glacier|landmark)\b/.test(raw)) return 'monument_orbit';
    return 'poi_flyover';
  };
  const stopLabel = (stop: { name?: string; label?: string }, fallback: string) =>
    String(stop.name || stop.label || fallback).trim();
  const dayStopsForPlan = (plan: RouteScoutDayPlan, day: number) => {
    const fromPlan = [
      ...(plan.fuelStops ?? []),
      ...(plan.poiStops ?? []),
    ];
    const fromScout = stops.filter(stop => {
      const type = String(stop.type || '').toLowerCase();
      if (Number(stop.day) !== Number(day)) return false;
      if (['start', 'camp', 'destination', 'review'].includes(type)) return false;
      return true;
    });
    const seen = new Set<string>();
    return [...fromPlan, ...fromScout]
      .filter(stop => finiteCoord(stop.lat, stop.lng))
      .filter(stop => {
        const key = stopKey(stop);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(stop => ({
        stop,
        ratio: clampRouteRatio(routeRatioAlong(route, Number(stop.lat), Number(stop.lng))),
        type: stopSceneType(stop),
      }))
      .sort((a, b) => a.ratio - b.ratio);
  };

  scenes.push({
    id: 'scene-intro',
    type: 'intro',
    title: `Starting in ${startName}`,
    subtitle: `Heading toward ${destName}`,
    durationMs: 10000,
    routeSlice: [0, Math.min(0.1, 12 / route.length)],
    camera: { mode: 'follow', zoom: 13.6, pitch: 66 },
    layers: { terrain: true },
    narration: '',
    callouts: [],
  });

  let cursor = 0;
  for (const plan of dayPlans) {
    const day = Number(plan.day) || 1;
    const campStop = stops.find(stop => Number(stop.day) === day);
    const campLat = campStop?.lat ?? plan.camp?.lat;
    const campLng = campStop?.lng ?? plan.camp?.lng;
    let endRatio = finiteCoord(campLat, campLng)
      ? clampRouteRatio(routeRatioAlong(route, Number(campLat), Number(campLng)))
      : clampRouteRatio(day / dayPlans.length);
    endRatio = Math.max(cursor + 0.05, endRatio);

    const dayStopBeats = dayStopsForPlan(plan, day)
      .filter(item => item.ratio > cursor + 0.025 && item.ratio < endRatio - 0.015)
      .slice(0, 3);
    for (const item of dayStopBeats) {
      const name = stopLabel(item.stop, item.type === 'fuel_stop' ? 'Fuel stop' : 'Scenic stop');
      scenes.push({
        id: `scene-leg-day-${day}-${item.type}-${scenes.length}`,
        type: 'drive_leg',
        title: String(plan.startName || startName).trim(),
        subtitle: name,
        day,
        durationMs: Math.round(8000 + (item.ratio - cursor) * 11000),
        routeSlice: [cursor, item.ratio],
        camera: { mode: 'follow', zoom: 13.8, pitch: 66 },
        layers: { terrain: true },
        narration: '',
        callouts: [],
      });
      scenes.push({
        id: `scene-stop-day-${day}-${item.type}-${scenes.length}`,
        type: item.type,
        title: name,
        subtitle: String(item.stop.description || item.stop.reason || '').trim(),
        day,
        durationMs: item.type === 'fuel_stop' ? 5200 : 7200,
        routeSlice: [item.ratio, clampRouteRatio(item.ratio + 0.015)],
        focus: { lat: Number(item.stop.lat), lng: Number(item.stop.lng) },
        rejoinRatio: item.ratio,
        camera: item.type === 'fuel_stop'
          ? { mode: 'fly', zoom: 12, pitch: 55 }
          : { mode: 'orbit', zoom: 12.4, pitch: 62, orbit: { direction: 'cw', sweepDeg: 180 } },
        layers: { terrain: item.type !== 'fuel_stop' },
        narration: '',
        callouts: [{
          id: `stop-${day}-${item.type}-${name}`,
          title: name,
          note: item.stop.description || item.stop.reason || undefined,
          lat: Number(item.stop.lat),
          lng: Number(item.stop.lng),
          kind: item.type === 'fuel_stop' ? 'fuel' : 'poi',
        }],
      });
      cursor = item.ratio;
    }

    const legTarget = String(plan.endName || plan.campName || destName).trim();
    scenes.push({
      id: `scene-leg-day-${day}`,
      type: 'drive_leg',
      title: String(plan.startName || startName).trim(),
      subtitle: legTarget,
      day,
      durationMs: Math.round(10000 + (endRatio - cursor) * 14000),
      routeSlice: [cursor, endRatio],
      camera: { mode: 'follow', zoom: 13.8, pitch: 66 },
      layers: { terrain: true },
      narration: '',
      callouts: [],
    });
    cursor = endRatio;

    if (finiteCoord(campLat, campLng) && plan.campStatus !== 'missing') {
      const campName = String(plan.campName || campStop?.name || `Day ${day} camp`).trim();
      scenes.push({
        id: `scene-camp-day-${day}`,
        type: 'camp_arrival',
        title: campName,
        subtitle: String(plan.campMeta || plan.driveSummary || '').trim(),
        day,
        durationMs: 12000,
        routeSlice: [endRatio, clampRouteRatio(endRatio + 0.02)],
        focus: { lat: Number(campLat), lng: Number(campLng) },
        camera: { mode: 'orbit', zoom: 14, pitch: 62 },
        layers: { terrain: true },
        narration: '',
        callouts: [{
          id: `camp-${day}`,
          title: campName,
          note: plan.reviewNotes?.[0] || campStop?.description,
          lat: Number(campLat),
          lng: Number(campLng),
          kind: 'camp',
        }],
      });
    }
  }

  if (cursor < 0.94) {
    scenes.push({
      id: 'scene-leg-finish',
      type: 'drive_leg',
      title: `Toward ${destName}`,
      subtitle: destName,
      durationMs: 11000,
      routeSlice: [cursor, 1],
      camera: { mode: 'follow', zoom: 13.6, pitch: 66 },
      layers: { terrain: true },
      narration: '',
      callouts: [],
    });
  }

  scenes.push({
    id: 'scene-recap',
    type: 'mission_recap',
    title: 'Trip recap',
    subtitle: `Finish near ${destName}`,
    durationMs: 9000,
    routeSlice: [Math.max(0, cursor), 1],
    camera: { mode: 'follow', zoom: 13.2, pitch: 64 },
    layers: {},
    narration: '',
    callouts: [],
  });

  return {
    id: `cinematic-scout-live-${Date.now()}`,
    tripId: input.tripId ?? null,
    title: input.tripName,
    route,
    scenes,
    generatedAt: Date.now(),
    sources: ['trailhead', 'route_scout_live'],
  };
}

export function liveMissionBeatBrief(
  scene: MissionScene,
  routeScout?: RouteScoutState | null,
): string {
  const scout = routeScout;
  const day = scene.day;
  const plan = scout?.dayPlans?.find(entry => Number(entry.day) === Number(day));
  const startName = String(scout?.startName || '').trim();
  const destName = String(scout?.destinationName || '').trim();
  const tripLabel = startName && destName ? `${startName} to ${destName}` : String(scene.title || 'Your route').trim();

  if (scene.type === 'intro') {
    return `${tripLabel} is built. I'll fly the route and stop at the key camps.`;
  }
  if (scene.type === 'camp_arrival') {
    const campName = String(plan?.campName || scene.title).trim();
    const meta = String(plan?.campMeta || '').trim();
    if (isDispersedCamp(meta)) {
      return `Here's tonight's camp at ${campName}. Confirm the site before dark because dispersed spots can change quickly.`;
    }
    return `Here's tonight's camp at ${campName}. Lock in water and firewood before sundown.`;
  }
  if (scene.type === 'drive_leg' || scene.type === 'day_flyover') {
    const from = String(plan?.startName || scene.title || startName).trim();
    const to = String(plan?.endName || scene.subtitle || plan?.campName || destName).trim();
    const dayNum = day || 1;
    const miles = parseDriveMiles(plan?.driveSummary);
    if (dayNum === 1) {
      return `Day ${dayNum} leaves ${from}. The highlighted line heads toward ${to || 'the first camp'}.`;
    }
    if (miles != null && miles >= 120) {
      return `This stretch gets remote on the way to ${to}. Save the route before leaving strong signal.`;
    }
    return `Day ${dayNum} runs from ${from} toward ${to}.`;
  }
  if (scene.type === 'fuel_stop') {
    return `Fuel stop at ${scene.title}. Top off here before the next long stretch.`;
  }
  if (scene.type === 'monument_orbit') {
    return `${scene.title} is the scenic pause on this leg. We'll circle it once, then pick the route back up.`;
  }
  if (scene.type === 'poi_flyover') {
    return `${scene.title} is a quick stop on this leg. We'll look around, then return to the route.`;
  }
  if (scene.type === 'mission_recap') {
    const finish = destName || 'the finish';
    return `That's the route to ${finish}. Review camps, fuel, and current conditions before you go.`;
  }
  if (['risk_focus', 'weather_focus', 'offline_readiness'].includes(scene.type)) {
    const note = String(scene.subtitle || scene.narration || '').trim();
    if (scene.type === 'offline_readiness') {
      return 'This stretch gets remote. Save the route before leaving strong signal.';
    }
    return note || String(scene.title || '').trim();
  }
  return [scene.title, scene.subtitle].filter(Boolean).join('. ');
}

export function buildMapMissionCinematic(input: {
  tripId?: string | null;
  tripName: string;
  route: [number, number][];
  routeScout?: RouteScoutState | null;
  activeTrip?: TripResult | null;
  gasStations?: GasStation[];
  campsites?: TripResult['campsites'];
  routePois?: OsmPoi[];
  selectedTrail?: { id?: string; name?: string; lat?: number; lng?: number } | null;
  exploreRouteRankPlaces?: StoryboardPlace[];
  missionBrief?: MissionControlBrief | null;
}): MissionCinematic | null {
  const route = routeCoordsFromLngLat(input.route);
  if (route.length < 2) return null;
  return buildMissionCinematic({
    tripId: input.tripId ?? null,
    tripName: input.tripName,
    route,
    checkpoints: checkpointsFromTrip(input.activeTrip, input.routeScout, input.missionBrief),
    places: placesFromTrip({
      activeTrip: input.activeTrip,
      routeScout: input.routeScout,
      gasStations: input.gasStations,
      campsites: input.campsites,
      routePois: input.routePois,
      selectedTrail: input.selectedTrail,
      exploreRouteRankPlaces: input.exploreRouteRankPlaces,
    }),
    missionBrief: input.missionBrief ?? null,
  });
}

export function sceneCameraPayload(scene: MissionScene, route: [number, number][]) {
  const pitch = scene.camera.pitch ?? (scene.camera.mode === 'follow' ? 66 : 58);
  const zoom = scene.camera.zoom ?? (scene.camera.mode === 'orbit' ? 13.5 : scene.camera.mode === 'follow' ? 12.2 : 10.8);
  const durationMs = Math.max(scene.durationMs, 9000);
  return {
    mode: scene.camera.mode,
    routeSlice: scene.routeSlice ?? [0, 1],
    focus: scene.focus,
    pitch,
    zoom,
    bearing: scene.camera.bearing,
    durationMs,
    route,
  };
}

export function postMissionBriefMapMessage(
  post: (payload: Record<string, unknown>) => void,
  type: string,
  payload: Record<string, unknown> = {},
) {
  post({ type, ...payload });
}

export function progressRouteFromRatio(route: [number, number][], ratio: number): [number, number][] {
  if (route.length < 2) return route;
  const t = Math.max(0, Math.min(1, ratio));
  const endIdx = Math.max(1, Math.ceil(t * (route.length - 1)));
  return route.slice(0, endIdx + 1);
}
