import { api } from './api';
import type { MissionStoryboardRequest, MissionStoryboardResponse } from './api';
import {
  assembleForwardPass,
  type MissionCinematic,
  type MissionScene,
  type MissionSceneCamera,
  type MissionSceneCameraMode,
  type MissionSceneType,
} from './copilotStoryboard';

/**
 * AI-directed cinematic client.
 *
 * The backend storyboard (gpt-4o-mini over route/places/risks) picks the BEATS
 * — which stops deserve a scene, how to frame them, what to say. The camera
 * geometry stays local: beats are re-woven through `assembleForwardPass` so the
 * flythrough is always one forward pass with rejoins, no matter what the model
 * returned. On any failure/timeout callers fall back to the deterministic
 * builders, so playback is never worse than the local path.
 */

const SCENE_TYPES: MissionSceneType[] = [
  'intro', 'whole_route', 'day_flyover', 'drive_leg', 'trail_flythrough',
  'monument_orbit', 'camp_arrival', 'fuel_stop', 'risk_focus', 'weather_focus',
  'offline_readiness', 'mission_recap', 'poi_flyover', 'route_rejoin',
];
const CAMERA_MODES: MissionSceneCameraMode[] = ['fit', 'fly', 'orbit', 'follow'];
/** Scene types the assembler treats as highlight beats. */
const BEAT_TYPES: MissionSceneType[] = [
  'camp_arrival', 'fuel_stop', 'trail_flythrough', 'monument_orbit',
  'poi_flyover', 'risk_focus', 'weather_focus', 'offline_readiness',
];
const MIN_AI_SCENES = 4;

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function cleanCinematicCopy(value: unknown, fallback = ''): string {
  return String(value || fallback)
    .replace(/[—–]/g, ', ')
    .replace(/\bmission briefing\b/gi, 'flyover')
    .replace(/\bmission recap\b/gi, 'trip recap')
    .replace(/\bmission control\b/gi, 'trip overview')
    .replace(/\bAI\b/g, '')
    .replace(/\bartificial intelligence\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cleanCamera(raw: unknown): MissionSceneCamera {
  const cam = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const mode = CAMERA_MODES.includes(cam.mode as MissionSceneCameraMode)
    ? cam.mode as MissionSceneCameraMode
    : 'fly';
  const out: MissionSceneCamera = { mode };
  const zoom = num(cam.zoom);
  if (zoom != null) out.zoom = Math.max(4, Math.min(15, zoom));
  const pitch = num(cam.pitch);
  if (pitch != null) out.pitch = Math.max(0, Math.min(72, pitch));
  const bearing = num(cam.bearing);
  if (bearing != null) out.bearing = bearing;
  const orbit = cam.orbit && typeof cam.orbit === 'object' ? cam.orbit as Record<string, unknown> : null;
  if (orbit) {
    const sweep = num(orbit.sweepDeg);
    out.orbit = {
      direction: orbit.direction === 'ccw' ? 'ccw' : 'cw',
      sweepDeg: sweep != null ? Math.max(30, Math.min(360, sweep)) : 90,
    };
  }
  if (cam.preset === 'low_pass') out.preset = 'low_pass';
  return out;
}

function cleanScene(raw: Record<string, unknown>, idx: number): MissionScene | null {
  const type = SCENE_TYPES.includes(raw.type as MissionSceneType)
    ? raw.type as MissionSceneType
    : 'drive_leg';
  const focusRaw = raw.focus && typeof raw.focus === 'object' ? raw.focus as Record<string, unknown> : null;
  const focusLat = num(focusRaw?.lat);
  const focusLng = num(focusRaw?.lng);
  const focus = focusLat != null && focusLng != null ? { lat: focusLat, lng: focusLng } : undefined;
  let routeSlice: [number, number] | undefined;
  if (Array.isArray(raw.routeSlice) && raw.routeSlice.length === 2) {
    const a = num(raw.routeSlice[0]);
    const b = num(raw.routeSlice[1]);
    if (a != null && b != null) {
      const s = clamp01(a);
      routeSlice = [s, Math.max(s, clamp01(b))];
    }
  }
  const layersRaw = raw.layers && typeof raw.layers === 'object' ? raw.layers as Record<string, unknown> : {};
  const rejoin = num(raw.rejoinRatio);
  const duration = num(raw.durationMs);
  const scene: MissionScene = {
    id: String(raw.id || `ai-scene-${idx}`).slice(0, 80),
    type,
    title: cleanCinematicCopy(raw.title).slice(0, 120),
    subtitle: cleanCinematicCopy(raw.subtitle).slice(0, 160),
    day: num(raw.day) && Number(raw.day) > 0 ? Math.round(Number(raw.day)) : undefined,
    durationMs: duration != null ? Math.max(4000, Math.min(14000, duration)) : 8000,
    routeSlice,
    focus,
    rejoinRatio: rejoin != null ? clamp01(rejoin) : undefined,
    camera: cleanCamera(raw.camera),
    layers: { terrain: !!layersRaw.terrain, warning: !!layersRaw.warning },
    narration: cleanCinematicCopy(raw.narration).slice(0, 320),
    callouts: Array.isArray(raw.callouts)
      ? (raw.callouts as Array<Record<string, unknown>>).slice(0, 6).flatMap((c, ci) => {
        const lat = num(c?.lat);
        const lng = num(c?.lng);
        if (lat == null || lng == null) return [];
        return [{
          id: String(c.id || `ai-callout-${idx}-${ci}`).slice(0, 80),
          title: cleanCinematicCopy(c.title, 'Stop').slice(0, 120),
          note: cleanCinematicCopy(c.note).slice(0, 200) || undefined,
          lat,
          lng,
          kind: String(c.kind || 'poi').slice(0, 40),
        }];
      })
      : [],
  };
  // A beat with no usable geometry can't be framed — drop it.
  if (BEAT_TYPES.includes(type) && !scene.focus && !scene.routeSlice) return null;
  return scene;
}

/** Defensively coerce the backend storyboard into typed scenes, or null. */
export function sanitizeRemoteCinematic(
  resp: MissionStoryboardResponse | null | undefined,
  route: [number, number][],
): { scenes: MissionScene[]; title: string; id: string } | null {
  if (!resp?.ok || !resp.cinematic || route.length < 2) return null;
  // A backend fallback carries less context than the local builders — skip it.
  if (resp.generated_by !== 'ai') return null;
  const rawScenes = Array.isArray(resp.cinematic.scenes) ? resp.cinematic.scenes : [];
  const scenes = rawScenes
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => cleanScene(s, i))
    .filter((s): s is MissionScene => !!s);
  if (scenes.length < MIN_AI_SCENES) return null;
  return {
    scenes,
    title: String(resp.cinematic.title || '').slice(0, 120),
    id: String(resp.cinematic.id || `mission-ai-${Date.now()}`),
  };
}

/**
 * Turn AI-picked beats into a playable cinematic: AI intro/recap narration is
 * kept, AI connective legs are discarded, and the guaranteed forward pass
 * (legs + rejoins) is woven locally.
 */
export function directedCinematicFromStoryboard(input: {
  resp: MissionStoryboardResponse | null | undefined;
  route: [number, number][];
  tripId: string | null;
  tripName: string;
  startTitle?: string;
  endTitle?: string;
  checkpoints?: Array<{ lat: number; lng: number; day?: number }>;
}): MissionCinematic | null {
  const sanitized = sanitizeRemoteCinematic(input.resp, input.route);
  if (!sanitized) return null;
  const aiIntro = sanitized.scenes.find(s => s.type === 'intro');
  const aiRecap = sanitized.scenes.find(s => s.type === 'mission_recap');
  const beats = sanitized.scenes.filter(s => BEAT_TYPES.includes(s.type));
  if (!beats.length) return null;

  const scenes: MissionScene[] = [];
  scenes.push({
    id: 'scene-intro',
    type: 'intro',
    title: sanitized.title || input.tripName,
    subtitle: aiIntro?.subtitle || (input.startTitle ? `From ${input.startTitle}` : 'Trip overview'),
    durationMs: aiIntro?.durationMs ?? 10000,
    routeSlice: [0, Math.min(0.1, 12 / Math.max(input.route.length, 2))],
    camera: { mode: 'follow', zoom: 13.4, pitch: 66 },
    layers: { terrain: true },
    narration: aiIntro?.narration || '',
    callouts: [],
  });
  scenes.push(...assembleForwardPass({
    route: input.route,
    beats,
    startTitle: input.startTitle,
    endTitle: input.endTitle,
    checkpoints: input.checkpoints,
  }));
  scenes.push({
    id: 'scene-recap',
    type: 'mission_recap',
    title: 'Trip recap',
    subtitle: aiRecap?.subtitle || 'Review before departure',
    durationMs: aiRecap?.durationMs ?? 6000,
    routeSlice: [0, 1],
    camera: { mode: 'fit', pitch: 45 },
    layers: aiRecap?.layers ?? {},
    narration: aiRecap?.narration || `That covers ${input.tripName}. Review conditions before departure.`,
    callouts: [],
  });

  return {
    id: sanitized.id,
    tripId: input.tripId,
    title: sanitized.title || input.tripName,
    route: input.route,
    scenes,
    generatedAt: Date.now(),
    sources: ['trailhead', 'mission_storyboard', 'ai_director'],
  };
}

/** Race the storyboard API against a budget; null on timeout or any failure. */
export async function fetchDirectedCinematic(input: {
  request: MissionStoryboardRequest;
  route: [number, number][];
  tripId: string | null;
  tripName: string;
  startTitle?: string;
  endTitle?: string;
  checkpoints?: Array<{ lat: number; lng: number; day?: number }>;
  budgetMs: number;
}): Promise<MissionCinematic | null> {
  try {
    const resp = await Promise.race([
      api.createMissionStoryboard(input.request),
      new Promise<null>(resolve => setTimeout(() => resolve(null), Math.max(500, input.budgetMs))),
    ]);
    if (!resp) return null;
    return directedCinematicFromStoryboard({
      resp,
      route: input.route,
      tripId: input.tripId,
      tripName: input.tripName,
      startTitle: input.startTitle,
      endTitle: input.endTitle,
      checkpoints: input.checkpoints,
    });
  } catch {
    return null;
  }
}
