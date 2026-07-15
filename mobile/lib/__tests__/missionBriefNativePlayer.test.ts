import {
  flyoverFollowZoomForDistanceKm,
  startNativeMissionBriefPlayer,
} from '@/lib/missionBriefNativePlayer';
import type { MissionCinematic } from '@/lib/copilotStoryboard';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`missionBriefNativePlayer contract failed: ${message}`);
}

const queuedFrames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
(globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
  const id = nextFrameId++;
  queuedFrames.set(id, callback);
  return id;
};
(globalThis as any).cancelAnimationFrame = (id: number) => {
  queuedFrames.delete(id);
};

const route: [number, number][] = [
  [0, 0],
  [1, 0],
  [4, 0],
];
const cinematic: MissionCinematic = {
  id: 'web-fallback',
  tripId: null,
  title: 'Weekend route',
  route,
  generatedAt: 0,
  sources: ['test'],
  scenes: [{
    id: 'route-leg',
    type: 'drive_leg',
    title: 'Weekend route',
    subtitle: '',
    durationMs: 12_000,
    routeSlice: [0, 1],
    camera: { mode: 'follow', pitch: 58 },
    layers: { terrain: true },
    narration: '',
    callouts: [],
  }],
};

const webMessages: Array<Record<string, unknown>> = [];
const nativeCameraMoves: Array<Record<string, unknown>> = [];
const progress: number[] = [];
const progressRoutes: [number, number][][] = [];
let starts = 0;
let pauses = 0;

const player = startNativeMissionBriefPlayer({
  cinematic,
  route,
  nativeMapRef: {
    current: {
      flyToCamera: (camera: Record<string, unknown>) => nativeCameraMoves.push(camera),
    } as any,
  },
  webRef: {
    current: {
      postMessage: message => webMessages.push(JSON.parse(message)),
    },
  },
  useNativeOverlays: false,
  ensure3d: () => {},
  onReady: () => {},
  onStarted: () => { starts += 1; },
  onSceneStarted: () => {},
  onSceneFinished: () => {},
  onPaused: () => { pauses += 1; },
  onResumed: () => {},
  onComplete: () => {},
  onError: message => { throw new Error(message); },
  onProgressRatio: ratio => progress.push(ratio),
  onProgressRoute: coords => progressRoutes.push(coords),
});

player.replay();
assert(starts === 1, 'replay starts the shared player');
assert(webMessages.some(message => message.type === 'mission_brief_route'), 'WebView receives the canonical route overlay');
assert(webMessages.some(message => message.type === 'cinematic_camera'), 'WebView receives canonical camera movement');
assert(!webMessages.some(message => message.type === 'mission_brief_start'), 'player does not invoke the legacy WebView timeline');

const followFrame = Array.from(queuedFrames.values())[0];
followFrame?.(3000);
assert(
  webMessages.some(message => message.type === 'cinematic_camera' && message.mode === 'linearTo'),
  'web follow frames request a continuous camera transition',
);
assert(
  nativeCameraMoves.some(camera => camera.mode === 'linearTo'),
  'native follow frames use the same continuous camera transition',
);
const continuousMove = nativeCameraMoves.find(camera => camera.mode === 'linearTo');
assert(
  Number(continuousMove?.zoom) === flyoverFollowZoomForDistanceKm(444),
  'long follow slices stay wide enough to keep ground tiles and route context visible',
);

player.setSpeed(1.6);
player.seekTo(0.5);
assert(pauses === 1, 'seek pauses playback for review');
assert(progress.some(ratio => Math.abs(ratio - 0.5) < 0.0001), 'seek publishes route progress');
assert(webMessages.some(message => message.type === 'mission_brief_progress' && message.ratio === 0.5), 'WebView receives route progress');
const halfRoute = progressRoutes[progressRoutes.length - 1];
assert(Math.abs(halfRoute[halfRoute.length - 1][0] - 2) < 0.002, 'seek overlay ends at the same metric route ratio as the camera');

const cameraMessagesBeforeFreeSeek = webMessages.filter(message => message.type === 'cinematic_camera').length;
player.setFreeCamera(true);
player.seekTo(0.75);
const cameraMessagesAfterFreeSeek = webMessages.filter(message => message.type === 'cinematic_camera').length;
assert(cameraMessagesAfterFreeSeek === cameraMessagesBeforeFreeSeek, 'free camera prevents seek from moving the map');

player.stop();
assert(webMessages.some(message => message.type === 'mission_brief_stop'), 'stop clears WebView flyover state');

export const missionBriefNativePlayerContract = { starts, pauses, progress };
