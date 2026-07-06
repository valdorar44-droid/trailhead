import type { ExplorerCheckpoint, MissionControlBrief, RouteScoutState } from './api';
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

export function checkpointsFromScout(routeScout: RouteScoutState | null | undefined): ExplorerCheckpoint[] {
  const stops = routeScout?.stops ?? routeScout?.previewStops ?? [];
  return stops
    .filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
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
    .filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
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

export function tripNameFromScout(routeScout: RouteScoutState | null | undefined, fallback = 'Your route') {
  const start = String(routeScout?.startName || '').trim();
  const end = String(routeScout?.destinationName || '').trim();
  if (start && end) return `${start} to ${end}`;
  return fallback;
}

export function buildMapMissionCinematic(input: {
  tripId?: string | null;
  tripName: string;
  route: [number, number][];
  routeScout?: RouteScoutState | null;
  missionBrief?: MissionControlBrief | null;
}): MissionCinematic | null {
  const route = routeCoordsFromLngLat(input.route);
  if (route.length < 2) return null;
  return buildMissionCinematic({
    tripId: input.tripId ?? null,
    tripName: input.tripName,
    route,
    checkpoints: checkpointsFromScout(input.routeScout),
    places: placesFromScout(input.routeScout),
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
