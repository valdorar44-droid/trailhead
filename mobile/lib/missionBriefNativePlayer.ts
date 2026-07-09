import type { MutableRefObject } from 'react';
import type { NativeMapHandle } from '@/components/NativeMap';
import type { MissionCinematic, MissionScene } from './copilotStoryboard';
import { progressRouteFromRatio } from './mapMissionBrief';
import type { MissionBriefCallout } from './mapMissionBrief';

type Point = { lat: number; lng: number };

/**
 * Cinematic mission-brief camera engine.
 *
 * Motion is distance-based, not index-based: we precompute cumulative metric
 * distances along the route once, then sample the camera position by distance so
 * pacing stays even regardless of how densely the route is sampled.
 *
 * Smoothness model: the camera retargets ~12.5x/s with constant-velocity
 * linearTo tweens that deliberately outlast the retarget interval, so each new
 * tween interrupts the previous one mid-flight at matched velocity — continuous
 * motion with no dead gap between hops. Establishing flyTos are never
 * interrupted (camBusyUntil), contiguous follow legs hand the camera off
 * without a re-frame (continuity skip + monotonic camera distance), and
 * narration holds drift the bearing instead of freezing the frame.
 */

// Camera retarget interval (~12.5Hz) and tween length. The tween is 1.5x the
// interval on purpose: a linearTo interrupted by the next linearTo along the
// same path reads as one continuous glide.
const FRAME_MS = 80;
const CAMERA_TWEEN_MS = 120;
// Progress line / marker React emits stay on their own slower clock — the
// ShapeSource re-render is the expensive part and must not ride the camera cadence.
const OVERLAY_MS = 250;
// Keep the drawn progress line light so it can update every emit without lag/jank.
const PROGRESS_MAX_POINTS = 140;
// How strongly the camera bearing eases toward the route heading each tick (0..1).
const BEARING_EASE = 0.16;
// Minimum per-scene wall-clock before speed scaling (kept generous for a slow feel).
const SCENE_FLOOR_MS = 7000;
// Gentle bearing drift while the camera holds for narration (reads as a held shot).
const HOLD_DRIFT_DEG_PER_S = 2.4;
// ~155wpm speech estimate; speaking scenes stretch so the glide paces the narration.
const SPEECH_MS_PER_WORD = 390;

/** Estimated speech time for a narration line (0 for empty/non-speaking). */
export function estimateSpeechMs(text: string | null | undefined): number {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return words > 0 ? 1500 + words * SPEECH_MS_PER_WORD : 0;
}

function sliceRoute(route: [number, number][], slice: [number, number] = [0, 1]): [number, number][] {
  if (route.length < 2) return route;
  const s = Math.max(0, Math.min(1, slice[0] ?? 0));
  const e = Math.max(s, Math.min(1, slice[1] ?? 1));
  const si = Math.floor(s * (route.length - 1));
  const ei = Math.max(si + 1, Math.ceil(e * (route.length - 1)));
  return route.slice(si, ei + 1);
}

/** Great-circle distance in metres between two [lng, lat] points. */
function haversine(a: [number, number], b: [number, number]) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance (metres) at each vertex; cum[0] === 0. */
function cumulativeDistances(route: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < route.length; i += 1) {
    cum[i] = cum[i - 1] + haversine(route[i - 1], route[i]);
  }
  return cum;
}

/** Interpolate a point at a given metric distance along the route. */
function pointAtDistance(route: [number, number][], cum: number[], dist: number): Point {
  if (route.length === 0) return { lat: 0, lng: 0 };
  if (route.length === 1) return { lat: route[0][1], lng: route[0][0] };
  const total = cum[cum.length - 1];
  if (total <= 0) return { lat: route[0][1], lng: route[0][0] };
  const d = Math.max(0, Math.min(total, dist));
  let i = 1;
  while (i < cum.length && cum[i] < d) i += 1;
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(route.length - 1, i);
  const seg = cum[i1] - cum[i0];
  const f = seg > 0 ? (d - cum[i0]) / seg : 0;
  return {
    lng: route[i0][0] + (route[i1][0] - route[i0][0]) * f,
    lat: route[i0][1] + (route[i1][1] - route[i0][1]) * f,
  };
}

/** Compass bearing (deg, 0..360) from a to b, both [lng, lat]. */
function bearingLngLat(a: [number, number], b: [number, number]) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLng = toRad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Ease an angle toward a target along the shortest arc. */
function smoothAngle(prev: number | null, target: number, factor: number) {
  if (prev == null || !Number.isFinite(prev)) return target;
  const diff = ((target - prev + 540) % 360) - 180;
  return prev + diff * factor;
}

/** Point `distM` metres from `p` along compass bearing `bearingDeg` (spherical). */
function destinationPoint(p: Point, bearingDeg: number, distM: number): Point {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const br = toRad(bearingDeg);
  const lat1 = toRad(p.lat);
  const lng1 = toRad(p.lng);
  const dr = distM / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(
    Math.sin(br) * Math.sin(dr) * Math.cos(lat1),
    Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

/** Follow zoom picked from the length of the flown slice — kept close enough that
 *  terrain relief reads cinematically (the camera tracks the marker, so it need not
 *  frame the whole slice at once). */
function zoomForSliceLengthKm(km: number) {
  if (km > 140) return 11.4;
  if (km > 70) return 12.2;
  if (km > 35) return 12.9;
  if (km > 15) return 13.4;
  return 14;
}

function boundsFromCoords(coords: [number, number][], extra: Point[] = []) {
  const lngs = coords.map(c => c[0]).concat(extra.map(p => p.lng));
  const lats = coords.map(c => c[1]).concat(extra.map(p => p.lat));
  if (!lngs.length) return null;
  return {
    center: {
      lat: (Math.max(...lats) + Math.min(...lats)) / 2,
      lng: (Math.max(...lngs) + Math.min(...lngs)) / 2,
    },
    span: Math.max(
      Math.max(...lats) - Math.min(...lats),
      Math.max(...lngs) - Math.min(...lngs),
    ),
  };
}

function sceneCallouts(scene: MissionScene): MissionBriefCallout[] {
  return (scene.callouts ?? [])
    .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .map(c => ({
      id: c.id,
      title: c.title,
      note: c.note,
      lat: c.lat,
      lng: c.lng,
      kind: c.kind || scene.type,
    }));
}

function isWarningScene(scene: MissionScene) {
  return scene.layers?.warning
    || ['risk_focus', 'weather_focus', 'offline_readiness'].includes(scene.type);
}

export type NativeMissionBriefPlayer = {
  replay: () => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  stop: () => void;
  setSpeed: (speed: number) => void;
  setCameraOptions?: (camera: { pitch: number; minZoom: number; maxZoom: number; lookaheadM: number }) => void;
  seekTo: (ratio: number) => void;
  setFreeCamera: (enabled: boolean) => void;
  /** Signal that the current scene's narration has finished (paces beat advancement to the voice). */
  markNarrationDone: () => void;
};

export function startNativeMissionBriefPlayer(opts: {
  cinematic: MissionCinematic;
  route: [number, number][];
  checkpoints?: Array<{ lat: number; lng: number }>;
  nativeMapRef: MutableRefObject<NativeMapHandle | null>;
  webRef: MutableRefObject<{ postMessage: (msg: string) => void } | null>;
  useNativeOverlays?: boolean;
  /** Playback speed multiplier. Effective duration = baseDuration / speed. */
  initialSpeed?: number;
  cameraOptions?: { pitch: number; minZoom: number; maxZoom: number; lookaheadM: number };
  /** When true, a scene holds after its camera move until markNarrationDone() (capped). */
  waitForNarration?: boolean;
  /**
   * The line that will actually be spoken for a scene ('' when the scene is
   * silent). Used to stretch speaking scenes so the camera glides at narration
   * pace instead of finishing early and holding.
   */
  speechTextFor?: (scene: MissionScene) => string;
  ensure3d: () => void;
  onReady: () => void;
  onStarted: () => void;
  onSceneStarted: (scene: MissionScene, index: number) => void;
  onSceneFinished: (index: number) => void;
  onSeekScene?: (scene: MissionScene, index: number, ratio: number) => void;
  onPaused: (index: number) => void;
  onResumed: (index: number) => void;
  onComplete: () => void;
  onError: (message: string) => void;
  /** Non-fatal notice (e.g. 3D terrain unavailable — flying in map mode). */
  onNotice?: (message: string) => void;
  onFullRoute?: (route: [number, number][]) => void;
  onProgressRoute?: (coords: [number, number][]) => void;
  onMarkerMove?: (point: Point | null) => void;
  onCallouts?: (callouts: MissionBriefCallout[]) => void;
  onWarningChange?: (active: boolean) => void;
  onSceneRoute?: (coords: [number, number][]) => void;
  onProgressRatio?: (ratio: number) => void;
  /** Optional debug hook for device QA (camera vs overlay tick counts). */
  onDebugTick?: (kind: 'camera' | 'overlay') => void;
}): NativeMissionBriefPlayer {
  const {
    cinematic,
    route,
    checkpoints = [],
    nativeMapRef,
    webRef,
    useNativeOverlays = true,
    initialSpeed = 1,
    cameraOptions,
    waitForNarration = false,
    speechTextFor,
    ensure3d,
    onReady,
    onStarted,
    onSceneStarted,
    onSceneFinished,
    onSeekScene,
    onPaused,
    onResumed,
    onComplete,
    onError,
    onNotice,
    onFullRoute,
    onProgressRoute,
    onMarkerMove,
    onCallouts,
    onWarningChange,
    onSceneRoute,
    onProgressRatio,
    onDebugTick,
  } = opts;

  // Precompute distance geometry once for the full route.
  const routeCum = cumulativeDistances(route);
  const routeTotal = routeCum[routeCum.length - 1] || 0;

  let index = -1;
  let playing = false;
  let paused = false;
  let failed = false;
  let raf: ReturnType<typeof requestAnimationFrame> | null = null;
  let sceneStart = 0;
  let pausedAt = 0;
  let pausedTotal = 0;
  let stopped = false;
  let speed = Number.isFinite(initialSpeed) && initialSpeed > 0 ? Math.max(0.1, Math.min(3, initialSpeed)) : 1;
  let cameraSettings = {
    pitch: Math.max(42, Math.min(68, Number(cameraOptions?.pitch) || 58)),
    minZoom: Math.max(4, Math.min(16, Number(cameraOptions?.minZoom) || 10.3)),
    maxZoom: Math.max(5, Math.min(17, Number(cameraOptions?.maxZoom) || 15.2)),
    lookaheadM: Math.max(120, Math.min(1200, Number(cameraOptions?.lookaheadM) || 280)),
  };
  let freeCamera = false;
  let sceneDuration = SCENE_FLOOR_MS;
  let lastFrameTs = 0;
  let smoothedBearing: number | null = null;
  // Cross-scene camera continuity state: where the camera last was, so scene
  // boundaries can hand off without a cut and holds can drift from the current heading.
  let camBusyUntil = 0;              // wall-clock until the establishing shot lands
  let lastCamDist: number | null = null;   // route distance (m) of the last follow target
  let lastCamBearing: number | null = null;
  let lastCamPoint: Point | null = null;
  let sceneEstablishMs = 0;
  let lastOverlayTs = 0;
  // low_pass framing computed at scene start (A → focus → B along the approach).
  let lowPassPath: { a: Point; b: Point; bearing: number } | null = null;
  let narrationDone = true;   // false while a scene waits for its narration to finish
  // Max extra time a scene will hold for narration beyond its camera move.
  const NARRATION_CAP_MS = 11000;
  let noticedNo3d = false;

  const postWeb = (payload: Record<string, unknown>) => {
    if (useNativeOverlays) return;
    const target = webRef.current;
    const postMessage = target?.postMessage;
    if (typeof postMessage !== 'function') return;
    try {
      postMessage.call(target, JSON.stringify(payload));
    } catch {
      // WebView refs can briefly be stale during tab swaps or reloads.
    }
  };

  const postWebCamera = (payload: Record<string, unknown>) => {
    postWeb({ type: 'cinematic_camera', ...payload });
  };

  const tryEnsure3d = () => {
    try {
      ensure3d();
    } catch {
      if (!noticedNo3d) {
        noticedNo3d = true;
        onNotice?.('Flying in map view.');
      }
    }
  };

  function effectiveDuration(scene: MissionScene) {
    const base = Math.max(SCENE_FLOOR_MS, Number(scene.durationMs) || 12000);
    return Math.max(1500, base / Math.max(0.1, speed));
  }

  function downsample(coords: [number, number][], max: number): [number, number][] {
    if (coords.length <= max) return coords;
    const step = Math.ceil(coords.length / max);
    const out: [number, number][] = [];
    for (let i = 0; i < coords.length; i += step) out.push(coords[i]);
    if (out[out.length - 1] !== coords[coords.length - 1]) out.push(coords[coords.length - 1]);
    return out;
  }

  function emitProgress(ratio: number, sceneCoords?: [number, number][] | null) {
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    onProgressRatio?.(clamped);
    const progressCoords = downsample(progressRouteFromRatio(route, clamped), PROGRESS_MAX_POINTS);
    onProgressRoute?.(progressCoords);
    if (sceneCoords && sceneCoords.length >= 2) {
      onSceneRoute?.(sceneCoords);
    }
    const marker = pointAtDistance(route, routeCum, clamped * routeTotal);
    onMarkerMove?.({ lat: marker.lat, lng: marker.lng });
    postWeb({ type: 'mission_brief_progress', ratio: clamped });
  }

  function sceneIndexForRatio(ratio: number) {
    if (!cinematic.scenes.length) return -1;
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    const candidates = cinematic.scenes
      .map((scene, i) => ({ scene, i }))
      .filter(({ scene }) => Array.isArray(scene.routeSlice) && scene.routeSlice.length >= 2)
      .filter(({ scene }) => clamped >= Math.min(scene.routeSlice![0], scene.routeSlice![1]) - 0.001
        && clamped <= Math.max(scene.routeSlice![0], scene.routeSlice![1]) + 0.001);
    const follow = candidates.find(({ scene }) => scene.camera?.mode === 'follow' || scene.type.includes('day') || scene.type.includes('drive'));
    if (follow) return follow.i;
    if (candidates.length) return candidates[0].i;
    if (clamped >= 0.97) return Math.max(0, cinematic.scenes.length - 1);
    if (clamped <= 0.03) return 0;
    const wholeRoute = cinematic.scenes.findIndex(scene => scene.type === 'whole_route');
    return wholeRoute >= 0 ? wholeRoute : 0;
  }

  function stopAnim() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function elapsed(now: number) {
    return now - sceneStart - pausedTotal;
  }

  function followCamera(scene: MissionScene, center: Point, bearing: number, zoom: number) {
    const cam = scene.camera || { mode: 'follow' };
    const pitch = Math.max(42, Math.min(70, cam.pitch ?? cameraSettings.pitch));
    lastCamBearing = bearing;
    lastCamPoint = center;
    if (freeCamera) return;
    nativeMapRef.current?.flyToCamera?.({
      lat: center.lat,
      lng: center.lng,
      zoom,
      pitch,
      bearing,
      duration: CAMERA_TWEEN_MS,
      mode: 'linearTo',
    });
    postWebCamera({ lat: center.lat, lng: center.lng, zoom, pitch, bearing, duration: CAMERA_TWEEN_MS, mode: 'linearTo' });
  }

  /** Lookahead distance for a follow slice (same formula the tick loop uses). */
  function lookaheadForSlice(startDist: number, endDist: number) {
    return Math.max(120, Math.min(cameraSettings.lookaheadM, (endDist - startDist) * 0.05));
  }

  /**
   * Frame the scene's establishing shot. Returns the establishing duration in ms
   * (0 when the camera is already in position and the shot is skipped) so the
   * tick loop can wait for it instead of interrupting it mid-flight.
   */
  function applySceneCamera(scene: MissionScene): number {
    const cam = scene.camera || { mode: 'fit' };
    const coords = sliceRoute(route, scene.routeSlice ?? [0, 1]);
    smoothedBearing = null;
    lowPassPath = null;
    if (freeCamera) return 0;

    // Rejoin transition: glide from the POI back onto the route at rejoinRatio,
    // pre-positioning the camera so the next follow leg's continuity-skip fires.
    if (scene.type === 'route_rejoin' && routeTotal > 0) {
      const rejoinDist = Math.max(0, Math.min(1, scene.rejoinRatio ?? 0)) * routeTotal;
      const leadDist = Math.min(routeTotal, rejoinDist + 400);
      const target = pointAtDistance(route, routeCum, leadDist);
      const ahead = pointAtDistance(route, routeCum, Math.min(routeTotal, leadDist + 400));
      const bearing = bearingLngLat([target.lng, target.lat], [ahead.lng, ahead.lat]);
      const kmToTarget = lastCamPoint
        ? haversine([lastCamPoint.lng, lastCamPoint.lat], [target.lng, target.lat]) / 1000
        : 3;
      const establishMs = Math.round(Math.max(1600, Math.min(2600, kmToTarget * 550)));
      nativeMapRef.current?.flyToCamera?.({
        lat: target.lat, lng: target.lng, zoom: cam.zoom ?? 13.2, pitch: Math.max(58, Math.min(68, cam.pitch ?? 64)), bearing, duration: establishMs, mode: 'flyTo',
      });
      postWebCamera({ lat: target.lat, lng: target.lng, zoom: cam.zoom ?? 13.2, pitch: cam.pitch ?? 64, bearing, duration: establishMs, mode: 'flyTo' });
      lastCamDist = leadDist;
      lastCamPoint = target;
      lastCamBearing = bearing;
      emitProgress(rejoinDist / routeTotal, null);
      return establishMs;
    }

    // Low pass: establish at a point 1.8km before the focus along the approach
    // heading, then glide straight through to 1.2km past it.
    if (cam.preset === 'low_pass' && scene.focus) {
      const focus = { lat: scene.focus.lat, lng: scene.focus.lng };
      const approach = Number.isFinite(cam.bearing as number)
        ? (cam.bearing as number)
        : (lastCamPoint ? bearingLngLat([lastCamPoint.lng, lastCamPoint.lat], [focus.lng, focus.lat]) : 0);
      const a = destinationPoint(focus, approach + 180, 1800);
      const b = destinationPoint(focus, approach, 1200);
      lowPassPath = { a, b, bearing: approach };
      const kmToTarget = lastCamPoint
        ? haversine([lastCamPoint.lng, lastCamPoint.lat], [a.lng, a.lat]) / 1000
        : 4;
      const establishMs = Math.round(Math.max(1600, Math.min(3200, kmToTarget * 550)));
      nativeMapRef.current?.flyToCamera?.({
        lat: a.lat, lng: a.lng, zoom: cam.zoom ?? 13.6, pitch: Math.max(60, Math.min(72, cam.pitch ?? 70)), bearing: approach, duration: establishMs, mode: 'flyTo',
      });
      postWebCamera({ lat: a.lat, lng: a.lng, zoom: cam.zoom ?? 13.6, pitch: cam.pitch ?? 70, bearing: approach, duration: establishMs, mode: 'flyTo' });
      lastCamDist = null;
      lastCamPoint = a;
      lastCamBearing = approach;
      return establishMs;
    }

    // Overview / fit shots (intro, whole-route, recap, offline) — single slow flyTo.
    if (cam.mode === 'fit' || (!scene.focus && coords.length < 2)) {
      const extra = ['intro', 'whole_route', 'mission_recap'].includes(scene.type)
        ? checkpoints.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        : [];
      const bounds = boundsFromCoords(coords, extra);
      if (bounds) {
        // Fit-to-span: derive zoom from the geographic span so the whole route is
        // actually visible, from a tight canyon loop to a multi-state corridor.
        const spanDeg = Math.max(bounds.span, 0.02);
        const zoom = Math.max(4.5, Math.min(12.5, Math.log2(190 / spanDeg)));
        nativeMapRef.current?.flyToCamera?.({
          lat: bounds.center.lat,
          lng: bounds.center.lng,
          zoom,
          pitch: cam.pitch ?? 54,
          duration: 2600,
          mode: 'flyTo',
        });
        postWebCamera({ lat: bounds.center.lat, lng: bounds.center.lng, zoom, pitch: cam.pitch ?? 54, duration: 2600, mode: 'flyTo' });
        lastCamDist = null;
        lastCamPoint = bounds.center;
        return 2600;
      }
      if (scene.focus) {
        nativeMapRef.current?.flyToCamera?.({
          lat: scene.focus.lat, lng: scene.focus.lng, zoom: cam.zoom ?? 12, pitch: cam.pitch ?? 58, duration: 2400, mode: 'flyTo',
        });
        lastCamDist = null;
        lastCamPoint = { lat: scene.focus.lat, lng: scene.focus.lng };
        return 2400;
      }
      return 0;
    }

    // Follow / drive shots — glide the camera onto the LEAD point of the slice
    // (the same point the tick loop targets), so the handoff from establishing
    // shot to follow motion is seamless and contiguous legs never snap backward.
    if (cam.mode === 'follow' && coords.length > 1) {
      const sliceStartDist = routeTotal * (scene.routeSlice?.[0] ?? 0);
      const sliceEndDist = routeTotal * (scene.routeSlice?.[1] ?? 1);
      const lookaheadM = lookaheadForSlice(sliceStartDist, sliceEndDist);
      const leadDist = Math.min(routeTotal, sliceStartDist + lookaheadM);
      const start = pointAtDistance(route, routeCum, leadDist);
      const ahead = pointAtDistance(route, routeCum, Math.min(routeTotal, leadDist + lookaheadM));
      const bearing = bearingLngLat([start.lng, start.lat], [ahead.lng, ahead.lat]);
      // Continuity skip: the camera is already essentially at the lead point
      // (normal case for back-to-back legs around a beat) — no re-frame at all;
      // the follow ticks take over on the next frame.
      if (lastCamDist != null && Math.abs(leadDist - lastCamDist) < Math.max(400, lookaheadM)) {
        smoothedBearing = lastCamBearing ?? bearing;
        return 0;
      }
      smoothedBearing = bearing;
      const sliceLenKm = (sliceEndDist - sliceStartDist) / 1000;
      const zoom = Math.max(cameraSettings.minZoom, Math.min(cam.zoom ?? zoomForSliceLengthKm(sliceLenKm), cameraSettings.maxZoom));
      // Establishing duration scales with how far the camera has to travel.
      const kmToTarget = lastCamPoint
        ? haversine([lastCamPoint.lng, lastCamPoint.lat], [start.lng, start.lat]) / 1000
        : Number.POSITIVE_INFINITY;
      const establishMs = Math.round(Math.max(1400, Math.min(2600, kmToTarget * 600)));
      nativeMapRef.current?.flyToCamera?.({
        lat: start.lat, lng: start.lng, zoom, pitch: Math.max(58, Math.min(68, cam.pitch ?? 64)), bearing, duration: establishMs, mode: 'flyTo',
      });
      postWebCamera({ lat: start.lat, lng: start.lng, zoom, pitch: cam.pitch ?? 64, bearing, duration: establishMs, mode: 'flyTo' });
      lastCamDist = leadDist;
      lastCamPoint = start;
      lastCamBearing = bearing;
      return establishMs;
    }

    // Fly / orbit toward a focus point (duration scales with camera travel).
    if (scene.focus) {
      const zoom = Math.min(cam.zoom ?? (cam.mode === 'orbit' ? 13 : 12.5), 14);
      const bearing = Number.isFinite(cam.bearing as number) ? (cam.bearing as number) : undefined;
      const kmToTarget = lastCamPoint
        ? haversine([lastCamPoint.lng, lastCamPoint.lat], [scene.focus.lng, scene.focus.lat]) / 1000
        : 4.5;
      const establishMs = Math.round(Math.max(1600, Math.min(3200, kmToTarget * 550)));
      nativeMapRef.current?.flyToCamera?.({
        lat: scene.focus.lat, lng: scene.focus.lng, zoom, pitch: Math.max(52, Math.min(68, cam.pitch ?? 62)), bearing, duration: establishMs, mode: 'flyTo',
      });
      postWebCamera({ lat: scene.focus.lat, lng: scene.focus.lng, zoom, pitch: cam.pitch ?? 62, bearing, duration: establishMs, mode: 'flyTo' });
      lastCamDist = null;
      lastCamPoint = { lat: scene.focus.lat, lng: scene.focus.lng };
      if (bearing != null) lastCamBearing = bearing;
      return establishMs;
    }
    return 0;
  }

  function applySceneOverlays(scene: MissionScene) {
    const coords = scene.routeSlice ? sliceRoute(route, scene.routeSlice) : route;
    onSceneRoute?.(coords);
    onCallouts?.(sceneCallouts(scene));
    onWarningChange?.(isWarningScene(scene));
    if (scene.type === 'route_rejoin' && Number.isFinite(scene.rejoinRatio) && routeTotal > 0) {
      const p = pointAtDistance(route, routeCum, Math.max(0, Math.min(1, scene.rejoinRatio ?? 0)) * routeTotal);
      onMarkerMove?.({ lat: p.lat, lng: p.lng });
    } else if (scene.focus) {
      onMarkerMove?.({ lat: scene.focus.lat, lng: scene.focus.lng });
    } else if (coords.length >= 2) {
      const start = pointAtDistance(route, routeCum, routeTotal * (scene.routeSlice?.[0] ?? 0));
      onMarkerMove?.({ lat: start.lat, lng: start.lng });
    }
    if (scene.type === 'whole_route') {
      onProgressRoute?.([route[0]]);
    }
  }

  function runSceneLoop(scene: MissionScene) {
    const cam = scene.camera || {};
    const hasSlice = !!scene.routeSlice && Array.isArray(scene.routeSlice);
    const startDist = routeTotal * (scene.routeSlice?.[0] ?? 0);
    const endDist = routeTotal * (scene.routeSlice?.[1] ?? 1);
    const sliceLenKm = Math.max(0, (endDist - startDist)) / 1000;
    const followZoom = Math.max(cameraSettings.minZoom, Math.min(cam.zoom ?? zoomForSliceLengthKm(sliceLenKm), cameraSettings.maxZoom));
    const lookaheadM = lookaheadForSlice(startDist, endDist);
    // Orbit starts from the storyboard's bearing, else the camera's current
    // heading — never from a fixed north, so there's no rotational jump.
    const orbitStartBearing = Number.isFinite(cam.bearing as number)
      ? (cam.bearing as number)
      : (lastCamBearing ?? 0);
    const orbitSweepRaw = Number(cam.orbit?.sweepDeg);
    const orbitSweepDeg = (Number.isFinite(orbitSweepRaw) ? Math.max(30, Math.min(180, orbitSweepRaw)) : 80)
      * (cam.orbit?.direction === 'ccw' ? -1 : 1);
    const scenePass = lowPassPath;
    // Follow legs must land exactly on their final lead point before the scene
    // can finish — the glide's last tick fires just short of t=1, and without a
    // settle frame the camera (and the next leg's continuity check) would sit
    // one frame behind the slice end.
    const needsSettle = cam.mode === 'follow' && hasSlice && routeTotal > 0;
    let holdSettled = false;
    lastFrameTs = 0;

    const frame = (now: number) => {
      if (stopped || failed || paused) {
        raf = null;
        return;
      }
      // Glide progress is measured over the scene time REMAINING after the
      // establishing shot, so the ground speed isn't compressed by the fly-in.
      const glideMs = Math.max(1, sceneDuration - sceneEstablishMs);
      const t = Math.max(0, Math.min(1, (elapsed(now) - sceneEstablishMs) / glideMs));
      const camReady = now >= camBusyUntil; // never interrupt the establishing flyTo
      const throttled = now - lastFrameTs < FRAME_MS;
      const overlayDue = now - lastOverlayTs >= OVERLAY_MS;
      const cameraDone = elapsed(now) >= sceneDuration;
      try {
        if (cam.mode === 'follow' && hasSlice && routeTotal > 0) {
          if (!throttled && camReady) {
            lastFrameTs = now;
            if (!cameraDone) {
              const d = startDist + (endDist - startDist) * t;
              // Monotonic camera distance: on contiguous legs the camera never
              // targets a point behind where it already is (no backward snap).
              const nominal = Math.min(routeTotal, d + lookaheadM);
              const camDist = lastCamDist != null ? Math.max(lastCamDist, nominal) : nominal;
              lastCamDist = camDist;
              const camPt = pointAtDistance(route, routeCum, camDist);
              const aheadPt = pointAtDistance(route, routeCum, Math.min(routeTotal, camDist + lookaheadM));
              const targetBearing = bearingLngLat([camPt.lng, camPt.lat], [aheadPt.lng, aheadPt.lat]);
              smoothedBearing = smoothAngle(smoothedBearing, targetBearing, BEARING_EASE);
              // Camera leads on the lookahead point; marker/progress stay on current route distance.
              followCamera(scene, camPt, smoothedBearing, followZoom);
              onDebugTick?.('camera');
              if (overlayDue) {
                lastOverlayTs = now;
                onDebugTick?.('overlay');
                emitProgress(routeTotal > 0 ? d / routeTotal : t, sliceRoute(route, scene.routeSlice));
              }
            } else if (!holdSettled) {
              // Settle frame: glide onto the exact final lead point and finish
              // the progress line — the throttled loop never quite reaches t=1.
              holdSettled = true;
              const finalDist = Math.min(routeTotal, endDist + lookaheadM);
              lastCamDist = lastCamDist != null ? Math.max(lastCamDist, finalDist) : finalDist;
              const finalPt = pointAtDistance(route, routeCum, lastCamDist);
              const aheadPt = pointAtDistance(route, routeCum, Math.min(routeTotal, lastCamDist + lookaheadM));
              smoothedBearing = smoothAngle(smoothedBearing, bearingLngLat([finalPt.lng, finalPt.lat], [aheadPt.lng, aheadPt.lat]), BEARING_EASE);
              followCamera(scene, finalPt, smoothedBearing, followZoom);
              lastOverlayTs = now;
              emitProgress(routeTotal > 0 ? endDist / routeTotal : 1, sliceRoute(route, scene.routeSlice));
            } else if (lastCamPoint) {
              // Narration hold: drift the bearing gently around the final lead
              // point instead of freezing the frame.
              smoothedBearing = (smoothedBearing ?? lastCamBearing ?? 0) + HOLD_DRIFT_DEG_PER_S * (FRAME_MS / 1000);
              followCamera(scene, lastCamPoint, smoothedBearing, followZoom);
            }
          }
        } else if (scenePass) {
          if (!throttled && camReady) {
            lastFrameTs = now;
            // Low pass: glide A→focus→B on the fixed approach heading; during a
            // narration hold keep flying past B at the same rate (capped).
            const pt = Math.min(1.35, Math.max(0, (elapsed(now) - sceneEstablishMs) / glideMs));
            const center = {
              lat: scenePass.a.lat + (scenePass.b.lat - scenePass.a.lat) * pt,
              lng: scenePass.a.lng + (scenePass.b.lng - scenePass.a.lng) * pt,
            };
            lastCamBearing = scenePass.bearing;
            lastCamDist = null;
            lastCamPoint = center;
            if (!freeCamera) {
              nativeMapRef.current?.flyToCamera?.({
                lat: center.lat,
                lng: center.lng,
                zoom: Math.min(cam.zoom ?? 13.6, 14),
                pitch: Math.max(60, Math.min(72, cam.pitch ?? 70)),
                bearing: scenePass.bearing,
                duration: CAMERA_TWEEN_MS,
                mode: 'linearTo',
              });
              postWebCamera({
                lat: center.lat,
                lng: center.lng,
                zoom: Math.min(cam.zoom ?? 13.6, 14),
                pitch: Math.max(60, Math.min(72, cam.pitch ?? 70)),
                bearing: scenePass.bearing,
                duration: CAMERA_TWEEN_MS,
                mode: 'linearTo',
              });
            }
            if (overlayDue && scene.focus) {
              lastOverlayTs = now;
              onMarkerMove?.({ lat: scene.focus.lat, lng: scene.focus.lng });
            }
          }
        } else if (cam.mode === 'orbit' && scene.focus) {
          if (!throttled && camReady) {
            lastFrameTs = now;
            // Sweep at a constant angular rate; during a narration hold (ot > 1)
            // the orbit simply keeps turning instead of freezing.
            const ot = Math.max(0, (elapsed(now) - sceneEstablishMs) / glideMs);
            const bearing = orbitStartBearing + orbitSweepDeg * ot;
            lastCamBearing = bearing;
            lastCamDist = null;
            lastCamPoint = { lat: scene.focus.lat, lng: scene.focus.lng };
            if (!freeCamera) {
              nativeMapRef.current?.flyToCamera?.({
                lat: scene.focus.lat,
                lng: scene.focus.lng,
                zoom: Math.min(cam.zoom ?? 13, 14),
                pitch: Math.max(58, Math.min(68, cam.pitch ?? 64)),
                bearing,
                duration: CAMERA_TWEEN_MS,
                mode: 'linearTo',
              });
              postWebCamera({
                lat: scene.focus.lat,
                lng: scene.focus.lng,
                zoom: Math.min(cam.zoom ?? 13, 14),
                pitch: Math.max(58, Math.min(68, cam.pitch ?? 64)),
                bearing,
                duration: CAMERA_TWEEN_MS,
                mode: 'linearTo',
              });
            }
            if (overlayDue) {
              lastOverlayTs = now;
              onMarkerMove?.({ lat: scene.focus.lat, lng: scene.focus.lng });
            }
          }
        } else if (scene.type === 'whole_route') {
          if (!throttled && overlayDue) {
            lastFrameTs = now;
            lastOverlayTs = now;
            emitProgress(t, route);
          }
        }
      } catch (err: any) {
        failed = true;
        onError(err?.message || 'cinematic playback failed');
        return;
      }
      // Camera finishes its move at t>=1; when voice-paced, hold there until the
      // narration is done (capped) so the camera and the Co-Pilot stay inline.
      // Follow legs also wait for their settle frame so the handoff point is exact.
      const capReached = elapsed(now) >= sceneDuration + NARRATION_CAP_MS;
      if ((cameraDone && (!needsSettle || holdSettled) && (!waitForNarration || narrationDone)) || capReached) {
        finishScene();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  function startScene(i: number) {
    if (failed || stopped) return;
    if (i >= cinematic.scenes.length) {
      playing = false;
      stopAnim();
      onWarningChange?.(false);
      onProgressRoute?.(route);
      onComplete();
      return;
    }
    const scene = cinematic.scenes[i];
    index = i;
    sceneStart = performance.now();
    pausedTotal = 0;
    pausedAt = 0;
    paused = false;
    narrationDone = false; // set true by markNarrationDone() (voice done / non-speaking scene)
    tryEnsure3d();
    sceneEstablishMs = applySceneCamera(scene);
    camBusyUntil = performance.now() + sceneEstablishMs;
    // Speaking scenes stretch to the narration estimate so the camera glides at
    // voice pace instead of finishing early and holding. Speech doesn't speed up
    // with playback speed, so the estimate is not divided by it.
    const minNarrationSettleMs = waitForNarration && (speechTextFor ? speechTextFor(scene) : scene.narration || '').trim()
      ? 1400
      : 0;
    sceneDuration = Math.max(effectiveDuration(scene), sceneEstablishMs + minNarrationSettleMs);
    applySceneOverlays(scene);
    onSceneStarted(scene, i);
    runSceneLoop(scene);
  }

  function finishScene() {
    stopAnim();
    onSceneFinished(index);
    startScene(index + 1);
  }

  function replay() {
    if (!cinematic.scenes.length || route.length < 2) {
      onError('Route is too short for a flyover.');
      return;
    }
    stopped = false;
    failed = false;
    playing = true;
    paused = false;
    stopAnim();
    // Reset cross-scene camera continuity so scene 0 re-establishes cleanly.
    camBusyUntil = 0;
    lastCamDist = null;
    lastCamBearing = null;
    lastCamPoint = null;
    smoothedBearing = null;
    lastOverlayTs = 0;
    onFullRoute?.(route);
    onProgressRoute?.([route[0]]);
    onWarningChange?.(false);
    onReady();
    onStarted();
    startScene(0);
  }

  function pause() {
    if (!playing || paused) return;
    paused = true;
    pausedAt = performance.now();
    stopAnim();
    onPaused(index);
  }

  function resume() {
    if (!playing || !paused) return;
    pausedTotal += performance.now() - pausedAt;
    paused = false;
    onResumed(index);
    const scene = cinematic.scenes[index];
    if (scene) runSceneLoop(scene);
  }

  function skip() {
    if (!playing || failed) return;
    if (paused) {
      pausedTotal += performance.now() - pausedAt;
      paused = false;
    }
    finishScene();
  }

  function stop() {
    stopped = true;
    playing = false;
    paused = false;
    stopAnim();
    onWarningChange?.(false);
    onMarkerMove?.(null);
    onCallouts?.([]);
    onProgressRoute?.([]);
    onFullRoute?.([]);
    postWeb({ type: 'mission_brief_stop' });
  }

  function setSpeed(next: number) {
    if (!Number.isFinite(next) || next <= 0) return;
    const now = performance.now();
    const oldDuration = Math.max(1, sceneDuration);
    const progress = playing && index >= 0
      ? Math.max(0, Math.min(1, elapsed(now) / oldDuration))
      : 0;
    speed = Math.max(0.1, Math.min(3, next));
    const scene = cinematic.scenes[index];
    if (scene) {
      sceneDuration = Math.max(effectiveDuration(scene), sceneEstablishMs);
      sceneStart = now - (progress * sceneDuration) - pausedTotal;
    }
  }

  function setCameraOptions(next: { pitch: number; minZoom: number; maxZoom: number; lookaheadM: number }) {
    cameraSettings = {
      pitch: Math.max(42, Math.min(70, Number(next.pitch) || cameraSettings.pitch)),
      minZoom: Math.max(4, Math.min(16, Number(next.minZoom) || cameraSettings.minZoom)),
      maxZoom: Math.max(5, Math.min(17, Number(next.maxZoom) || cameraSettings.maxZoom)),
      lookaheadM: Math.max(120, Math.min(1200, Number(next.lookaheadM) || cameraSettings.lookaheadM)),
    };
  }

  function setFreeCamera(enabled: boolean) {
    freeCamera = !!enabled;
  }

  function seekTo(ratio: number) {
    if (!cinematic.scenes.length || route.length < 2) return;
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    stopAnim();
    playing = true;
    paused = true;
    stopped = false;
    failed = false;
    pausedAt = performance.now();
    pausedTotal = 0;
    const nextIndex = sceneIndexForRatio(clamped);
    const scene = cinematic.scenes[nextIndex] ?? cinematic.scenes[0];
    index = Math.max(0, nextIndex);
    sceneStart = performance.now();
    narrationDone = true;
    sceneEstablishMs = 0;
    camBusyUntil = 0;
    lastOverlayTs = 0;
    applySceneOverlays(scene);
    emitProgress(clamped, scene.routeSlice ? sliceRoute(route, scene.routeSlice) : null);
    const point = pointAtDistance(route, routeCum, clamped * routeTotal);
    const ahead = pointAtDistance(route, routeCum, Math.min(routeTotal, clamped * routeTotal + 500));
    const bearing = bearingLngLat([point.lng, point.lat], [ahead.lng, ahead.lat]);
    lastCamPoint = point;
    lastCamBearing = bearing;
    lastCamDist = clamped * routeTotal;
    if (!freeCamera) {
      nativeMapRef.current?.flyToCamera?.({
        lat: point.lat,
        lng: point.lng,
        zoom: Math.max(cameraSettings.minZoom, Math.min(scene.camera?.zoom ?? cameraSettings.maxZoom - 0.5, cameraSettings.maxZoom)),
        pitch: Math.max(42, Math.min(70, scene.camera?.pitch ?? cameraSettings.pitch)),
        bearing,
        duration: 90,
        mode: 'linearTo',
      });
      postWebCamera({
        lat: point.lat,
        lng: point.lng,
        zoom: Math.max(cameraSettings.minZoom, Math.min(scene.camera?.zoom ?? cameraSettings.maxZoom - 0.5, cameraSettings.maxZoom)),
        pitch: Math.max(42, Math.min(70, scene.camera?.pitch ?? cameraSettings.pitch)),
        bearing,
        duration: 90,
        mode: 'linearTo',
      });
    }
    onSeekScene?.(scene, index, clamped);
    onPaused(index);
  }

  function markNarrationDone() {
    narrationDone = true;
  }

  return { replay, pause, resume, skip, stop, setSpeed, setCameraOptions, seekTo, setFreeCamera, markNarrationDone };
}
