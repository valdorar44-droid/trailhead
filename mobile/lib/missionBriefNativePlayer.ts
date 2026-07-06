import type { MutableRefObject } from 'react';
import type { NativeMapHandle } from '@/components/NativeMap';
import type { MissionCinematic, MissionScene } from './copilotStoryboard';

type Point = { lat: number; lng: number };

function sliceRoute(route: [number, number][], slice: [number, number] = [0, 1]): [number, number][] {
  if (route.length < 2) return route;
  const s = Math.max(0, Math.min(1, slice[0] ?? 0));
  const e = Math.max(s, Math.min(1, slice[1] ?? 1));
  const si = Math.floor(s * (route.length - 1));
  const ei = Math.max(si + 1, Math.ceil(e * (route.length - 1)));
  return route.slice(si, ei + 1);
}

function bearingBetween(a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

function pointAlong(coords: [number, number][], t: number): Point & { bearing: number } {
  if (!coords.length) return { lat: 0, lng: 0, bearing: 0 };
  if (coords.length === 1) return { lat: coords[0][1], lng: coords[0][0], bearing: 0 };
  const pos = Math.max(0, Math.min(1, t)) * (coords.length - 1);
  const i = Math.floor(pos);
  const frac = pos - i;
  const a = coords[Math.min(i, coords.length - 1)];
  const b = coords[Math.min(i + 1, coords.length - 1)];
  return {
    lng: a[0] + (b[0] - a[0]) * frac,
    lat: a[1] + (b[1] - a[1]) * frac,
    bearing: bearingBetween(a, b),
  };
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

export type NativeMissionBriefPlayer = {
  replay: () => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  stop: () => void;
};

export function startNativeMissionBriefPlayer(opts: {
  cinematic: MissionCinematic;
  route: [number, number][];
  checkpoints?: Array<{ lat: number; lng: number }>;
  nativeMapRef: MutableRefObject<NativeMapHandle | null>;
  webRef: MutableRefObject<{ postMessage: (msg: string) => void } | null>;
  ensure3d: () => void;
  onReady: () => void;
  onStarted: () => void;
  onSceneStarted: (scene: MissionScene, index: number) => void;
  onSceneFinished: (index: number) => void;
  onPaused: (index: number) => void;
  onResumed: (index: number) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}): NativeMissionBriefPlayer {
  const {
    cinematic,
    route,
    checkpoints = [],
    nativeMapRef,
    webRef,
    ensure3d,
    onReady,
    onStarted,
    onSceneStarted,
    onSceneFinished,
    onPaused,
    onResumed,
    onComplete,
    onError,
  } = opts;

  let index = -1;
  let playing = false;
  let paused = false;
  let failed = false;
  let raf: ReturnType<typeof requestAnimationFrame> | null = null;
  let sceneStart = 0;
  let pausedAt = 0;
  let pausedTotal = 0;
  let orbitBase: number | null = null;
  let stopped = false;

  const postWeb = (payload: Record<string, unknown>) => {
    webRef.current?.postMessage(JSON.stringify(payload));
  };

  function stopAnim() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function elapsed(now: number) {
    return now - sceneStart - pausedTotal;
  }

  function flyCamera(scene: MissionScene, coords: [number, number][], point?: Point & { bearing?: number }) {
    const cam = scene.camera || { mode: 'fit' };
    const pitch = Math.max(48, Math.min(72, cam.pitch ?? (cam.mode === 'follow' ? 66 : 58)));
    const zoom = Math.min(cam.zoom ?? (cam.mode === 'follow' ? 12.4 : cam.mode === 'orbit' ? 13.2 : 11), 14.5);
    const target = point ?? (scene.focus ? { lat: scene.focus.lat, lng: scene.focus.lng } : null);
    if (!target) return;
    nativeMapRef.current?.flyToCamera?.({
      lat: target.lat,
      lng: target.lng,
      zoom,
      pitch,
      bearing: point?.bearing ?? cam.bearing,
      duration: cam.mode === 'follow' ? 0 : 2400,
      mode: cam.mode === 'follow' ? 'easeTo' : 'flyTo',
    });
    postWeb({
      type: 'fly_to',
      lat: target.lat,
      lng: target.lng,
      zoom,
      pitch,
      bearing: point?.bearing ?? cam.bearing,
      duration: cam.mode === 'follow' ? 0 : 2400,
    });
  }

  function applySceneCamera(scene: MissionScene) {
    const cam = scene.camera || { mode: 'fit' };
    const coords = sliceRoute(route, scene.routeSlice ?? [0, 1]);
    if (cam.mode === 'fit' || (!scene.focus && coords.length < 2)) {
      const extra = ['intro', 'whole_route', 'mission_recap'].includes(scene.type)
        ? checkpoints.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        : [];
      const bounds = boundsFromCoords(coords, extra);
      if (bounds) {
        const zoom = scene.type === 'whole_route'
          ? Math.max(8.8, 11.2 - bounds.span * 1.8)
          : Math.max(9.2, 12 - bounds.span * 2.2);
        nativeMapRef.current?.flyToCamera?.({
          lat: bounds.center.lat,
          lng: bounds.center.lng,
          zoom,
          pitch: cam.pitch ?? 58,
          duration: 2200,
          mode: 'flyTo',
        });
        postWeb({
          type: 'fly_to',
          lat: bounds.center.lat,
          lng: bounds.center.lng,
          zoom,
          pitch: cam.pitch ?? 58,
          duration: 2200,
        });
      } else if (scene.focus) {
        flyCamera(scene, coords, { lat: scene.focus.lat, lng: scene.focus.lng });
      }
      return;
    }
    if (cam.mode === 'follow' && coords.length > 1) {
      const start = pointAlong(coords, 0);
      flyCamera(scene, coords, start);
      return;
    }
    if (scene.focus) {
      flyCamera(scene, coords, { lat: scene.focus.lat, lng: scene.focus.lng });
    }
  }

  function runSceneLoop(scene: MissionScene) {
    const duration = Math.max(9000, Number(scene.durationMs) || 12000);
    const cam = scene.camera || {};
    const coords = scene.routeSlice ? sliceRoute(route, scene.routeSlice) : null;
    orbitBase = null;

    const frame = (now: number) => {
      if (stopped || failed || paused) {
        raf = null;
        return;
      }
      const t = Math.max(0, Math.min(1, elapsed(now) / duration));
      try {
        if (cam.mode === 'follow' && coords && coords.length > 1 && scene.routeSlice) {
          const slice = scene.routeSlice;
          const progress = slice[0] + (slice[1] - slice[0]) * t;
          if (elapsed(now) > 700) {
            const point = pointAlong(coords, t);
            flyCamera(scene, coords, point);
          }
          postWeb({
            type: 'mission_brief_progress',
            ratio: progress,
          });
        } else if (cam.mode === 'orbit' && elapsed(now) > 2400) {
          if (orbitBase == null) orbitBase = 0;
          const ot = Math.max(0, Math.min(1, (elapsed(now) - 2400) / Math.max(1, duration - 2400)));
          if (scene.focus) {
            nativeMapRef.current?.flyToCamera?.({
              lat: scene.focus.lat,
              lng: scene.focus.lng,
              zoom: cam.zoom ?? 13.2,
              pitch: cam.pitch ?? 66,
              bearing: orbitBase + 85 * ot,
              duration: 0,
              mode: 'easeTo',
            });
          }
        } else if (scene.type === 'whole_route') {
          postWeb({ type: 'mission_brief_progress', ratio: t });
        }
      } catch (err: any) {
        failed = true;
        onError(err?.message || 'cinematic playback failed');
        return;
      }
      if (t >= 1) {
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
      onComplete();
      return;
    }
    const scene = cinematic.scenes[i];
    index = i;
    sceneStart = performance.now();
    pausedTotal = 0;
    pausedAt = 0;
    paused = false;
    ensure3d();
    applySceneCamera(scene);
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
    postWeb({ type: 'mission_brief_stop' });
  }

  return { replay, pause, resume, skip, stop };
}
