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
 * pacing stays even regardless of how densely the route is sampled. Camera
 * updates are throttled to ~8fps with short easeTo tweens and smoothed bearings
 * so the flythrough reads like a slow game/movie preview instead of a jittery
 * per-frame chase.
 */

// Camera update interval. easeTo duration is matched to this so each tween finishes
// right as the next begins — continuous motion with no mid-ease interruption (no skip).
const FRAME_MS = 200;
// Keep the drawn progress line light so it can update every tick without lag/jank.
const PROGRESS_MAX_POINTS = 140;
// How strongly the camera bearing eases toward the route heading each tick (0..1).
const BEARING_EASE = 0.16;
// Minimum per-scene wall-clock before speed scaling (kept generous for a slow feel).
const SCENE_FLOOR_MS = 7000;

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

/** Follow zoom picked from the length of the flown slice — kept close enough that
 *  terrain relief reads cinematically (the camera tracks the marker, so it need not
 *  frame the whole slice at once). */
function zoomForSliceLengthKm(km: number) {
  if (km > 140) return 9.6;
  if (km > 70) return 10.4;
  if (km > 35) return 11.1;
  if (km > 15) return 11.8;
  return 12.6;
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
  /** When true, a scene holds after its camera move until markNarrationDone() (capped). */
  waitForNarration?: boolean;
  ensure3d: () => void;
  onReady: () => void;
  onStarted: () => void;
  onSceneStarted: (scene: MissionScene, index: number) => void;
  onSceneFinished: (index: number) => void;
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
}): NativeMissionBriefPlayer {
  const {
    cinematic,
    route,
    checkpoints = [],
    nativeMapRef,
    webRef,
    useNativeOverlays = true,
    initialSpeed = 1,
    waitForNarration = false,
    ensure3d,
    onReady,
    onStarted,
    onSceneStarted,
    onSceneFinished,
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
  let speed = Number.isFinite(initialSpeed) && initialSpeed > 0 ? initialSpeed : 1;
  let sceneDuration = SCENE_FLOOR_MS;
  let lastFrameTs = 0;
  let smoothedBearing: number | null = null;
  let narrationDone = true;   // false while a scene waits for its narration to finish
  // Max extra time a scene will hold for narration beyond its camera move.
  const NARRATION_CAP_MS = 11000;
  let noticedNo3d = false;

  const postWeb = (payload: Record<string, unknown>) => {
    if (useNativeOverlays) return;
    webRef.current?.postMessage(JSON.stringify(payload));
  };

  const tryEnsure3d = () => {
    try {
      ensure3d();
    } catch {
      if (!noticedNo3d) {
        noticedNo3d = true;
        onNotice?.('3D terrain unavailable — flying in map mode.');
      }
    }
  };

  function effectiveDuration(scene: MissionScene) {
    const base = Math.max(SCENE_FLOOR_MS, Number(scene.durationMs) || 12000);
    return Math.max(1500, base / Math.max(0.25, speed));
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
    const progressCoords = downsample(progressRouteFromRatio(route, ratio), PROGRESS_MAX_POINTS);
    onProgressRoute?.(progressCoords);
    if (sceneCoords && sceneCoords.length >= 2) {
      onSceneRoute?.(sceneCoords);
    }
    const marker = pointAtDistance(route, routeCum, ratio * routeTotal);
    onMarkerMove?.({ lat: marker.lat, lng: marker.lng });
    postWeb({ type: 'mission_brief_progress', ratio });
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
    const pitch = Math.max(58, Math.min(68, cam.pitch ?? 64));
    nativeMapRef.current?.flyToCamera?.({
      lat: center.lat,
      lng: center.lng,
      zoom,
      pitch,
      bearing,
      duration: FRAME_MS,
      mode: 'easeTo',
    });
    postWeb({ type: 'fly_to', lat: center.lat, lng: center.lng, zoom, pitch, bearing, duration: FRAME_MS });
  }

  function applySceneCamera(scene: MissionScene) {
    const cam = scene.camera || { mode: 'fit' };
    const coords = sliceRoute(route, scene.routeSlice ?? [0, 1]);
    smoothedBearing = null;

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
        postWeb({ type: 'fly_to', lat: bounds.center.lat, lng: bounds.center.lng, zoom, pitch: cam.pitch ?? 54, duration: 2600 });
      } else if (scene.focus) {
        nativeMapRef.current?.flyToCamera?.({
          lat: scene.focus.lat, lng: scene.focus.lng, zoom: cam.zoom ?? 12, pitch: cam.pitch ?? 58, duration: 2400, mode: 'flyTo',
        });
      }
      return;
    }

    // Follow / drive shots — glide the camera onto the start of the slice.
    if (cam.mode === 'follow' && coords.length > 1) {
      const sliceStartDist = routeTotal * (scene.routeSlice?.[0] ?? 0);
      const start = pointAtDistance(route, routeCum, sliceStartDist);
      const ahead = pointAtDistance(route, routeCum, Math.min(routeTotal, sliceStartDist + 250));
      const bearing = bearingLngLat([start.lng, start.lat], [ahead.lng, ahead.lat]);
      smoothedBearing = bearing;
      const sliceLenKm = (routeTotal * ((scene.routeSlice?.[1] ?? 1) - (scene.routeSlice?.[0] ?? 0))) / 1000;
      const zoom = Math.min(cam.zoom ?? zoomForSliceLengthKm(sliceLenKm), 13.4);
      nativeMapRef.current?.flyToCamera?.({
        lat: start.lat, lng: start.lng, zoom, pitch: Math.max(58, Math.min(68, cam.pitch ?? 64)), bearing, duration: 2200, mode: 'flyTo',
      });
      postWeb({ type: 'fly_to', lat: start.lat, lng: start.lng, zoom, pitch: cam.pitch ?? 64, bearing, duration: 2200 });
      return;
    }

    // Fly / orbit toward a focus point.
    if (scene.focus) {
      const zoom = Math.min(cam.zoom ?? (cam.mode === 'orbit' ? 13 : 12.5), 14);
      nativeMapRef.current?.flyToCamera?.({
        lat: scene.focus.lat, lng: scene.focus.lng, zoom, pitch: Math.max(52, Math.min(68, cam.pitch ?? 62)), duration: 2400, mode: 'flyTo',
      });
      postWeb({ type: 'fly_to', lat: scene.focus.lat, lng: scene.focus.lng, zoom, pitch: cam.pitch ?? 62, duration: 2400 });
    }
  }

  function applySceneOverlays(scene: MissionScene) {
    const coords = scene.routeSlice ? sliceRoute(route, scene.routeSlice) : route;
    onSceneRoute?.(coords);
    onCallouts?.(sceneCallouts(scene));
    onWarningChange?.(isWarningScene(scene));
    if (scene.focus) {
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
    const followZoom = Math.min(cam.zoom ?? zoomForSliceLengthKm(sliceLenKm), 13.4);
    const lookaheadM = Math.max(180, Math.min(1200, (endDist - startDist) * 0.05));
    lastFrameTs = 0;

    const frame = (now: number) => {
      if (stopped || failed || paused) {
        raf = null;
        return;
      }
      const t = Math.max(0, Math.min(1, elapsed(now) / sceneDuration));
      const throttled = now - lastFrameTs < FRAME_MS;
      try {
        if (cam.mode === 'follow' && hasSlice && routeTotal > 0) {
          if (!throttled && elapsed(now) > 600) {
            lastFrameTs = now;
            const d = startDist + (endDist - startDist) * t;
            const center = pointAtDistance(route, routeCum, d);
            const ahead = pointAtDistance(route, routeCum, Math.min(routeTotal, d + lookaheadM));
            const targetBearing = bearingLngLat([center.lng, center.lat], [ahead.lng, ahead.lat]);
            smoothedBearing = smoothAngle(smoothedBearing, targetBearing, BEARING_EASE);
            followCamera(scene, center, smoothedBearing, followZoom);
            // Marker + progress line advance on the same tick as the camera → no lag behind.
            emitProgress(routeTotal > 0 ? d / routeTotal : t, sliceRoute(route, scene.routeSlice));
          }
        } else if (cam.mode === 'orbit' && scene.focus && elapsed(now) > 2200) {
          if (!throttled) {
            lastFrameTs = now;
            const ot = Math.max(0, Math.min(1, (elapsed(now) - 2200) / Math.max(1, sceneDuration - 2200)));
            nativeMapRef.current?.flyToCamera?.({
              lat: scene.focus.lat,
              lng: scene.focus.lng,
              zoom: Math.min(cam.zoom ?? 13, 14),
              pitch: Math.max(58, Math.min(68, cam.pitch ?? 64)),
              bearing: 70 * ot,
              duration: 150,
              mode: 'easeTo',
            });
            onMarkerMove?.({ lat: scene.focus.lat, lng: scene.focus.lng });
          }
        } else if (scene.type === 'whole_route') {
          if (!throttled) {
            lastFrameTs = now;
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
      const cameraDone = elapsed(now) >= sceneDuration;
      const capReached = elapsed(now) >= sceneDuration + NARRATION_CAP_MS;
      if ((cameraDone && (!waitForNarration || narrationDone)) || capReached) {
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
    sceneDuration = effectiveDuration(scene);
    narrationDone = false; // set true by markNarrationDone() (voice done / non-speaking scene)
    tryEnsure3d();
    applySceneCamera(scene);
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
      onError('Route too short for mission briefing.');
      return;
    }
    stopped = false;
    failed = false;
    playing = true;
    paused = false;
    stopAnim();
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
    // Applies to the next scene (current scene keeps its computed duration).
    if (Number.isFinite(next) && next > 0) speed = next;
  }

  function markNarrationDone() {
    narrationDone = true;
  }

  return { replay, pause, resume, skip, stop, setSpeed, markNarrationDone };
}
