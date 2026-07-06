import type { MissionCinematic, MissionScene } from './copilotStoryboard';
import type { RouteScoutState } from './api';
import {
  isLiveScoutCinematic,
  missionBeatCaption,
  sceneNarrationWatchdogMs,
  shouldSpeakMissionScene,
} from './mapMissionBrief';
import { estimateSpeechMs } from './missionBriefNativePlayer';

/** OTA uses the JS player; native requires a new binary with TrailheadMissionAnimator. */
export type MissionPlaybackMode = 'js' | 'native';

export type MissionVoicePath = 'realtime' | 'trailhead_tts' | 'device_tts' | 'silent';

export type NarrationDoneSource =
  | 'realtime'
  | 'trailhead_tts'
  | 'device_tts'
  | 'silent'
  | 'watchdog'
  | 'pause_release'
  | 'skip';

export const DEFAULT_MISSION_PLAYBACK_MODE: MissionPlaybackMode = 'js';

/** Resolve playback engine. Native mode activates when the binary ships the animator. */
export function resolveMissionPlaybackMode(
  _preferred: MissionPlaybackMode = DEFAULT_MISSION_PLAYBACK_MODE,
  nativeAvailable = false,
): MissionPlaybackMode {
  return nativeAvailable ? 'native' : 'js';
}

export type LiveMissionBeatInput = {
  beatText: string;
  speak: boolean;
  isLiveScout: boolean;
};

/** Runtime beat line + speak gate for a cinematic scene (live scout + directed). */
export function speakLiveMissionBeatInput(
  cinematic: MissionCinematic | null | undefined,
  scene: MissionScene,
  routeScout?: RouteScoutState | null,
): LiveMissionBeatInput {
  const beatText = missionBeatCaption(cinematic, scene, routeScout)
    || String(scene.subtitle || scene.title || '').trim();
  const speak = shouldSpeakMissionScene(cinematic, scene) && !!beatText.trim();
  return {
    beatText,
    speak,
    isLiveScout: isLiveScoutCinematic(cinematic),
  };
}

/** Per-beat watchdog: must outlast estimated speech so long lines are not cut short. */
export function missionNarrationWatchdogMs(
  scene: MissionScene,
  speed: number,
  beatText: string,
): number {
  return Math.max(
    sceneNarrationWatchdogMs(scene, speed),
    estimateSpeechMs(beatText) + 4000,
  );
}

export type MissionPlaybackDebugCounters = {
  sceneStarts: number;
  sceneEnds: number;
  cameraTicks: number;
  overlayTicks: number;
  watchdogFires: number;
  narrationDone: Record<NarrationDoneSource, number>;
};

const emptyNarrationDone = (): Record<NarrationDoneSource, number> => ({
  realtime: 0,
  trailhead_tts: 0,
  device_tts: 0,
  silent: 0,
  watchdog: 0,
  pause_release: 0,
  skip: 0,
});

export type MissionPlaybackDebug = {
  counters: MissionPlaybackDebugCounters;
  reset: () => void;
  sessionStart: (data: Record<string, unknown>) => void;
  sceneStart: (data: Record<string, unknown>) => void;
  sceneEnd: (data: Record<string, unknown>) => void;
  cameraTick: () => void;
  overlayTick: () => void;
  narrationDone: (source: NarrationDoneSource, data?: Record<string, unknown>) => void;
  watchdogFired: (data: Record<string, unknown>) => void;
  voicePath: (path: MissionVoicePath, data?: Record<string, unknown>) => void;
  snapshot: () => MissionPlaybackDebugCounters;
};

export function createMissionPlaybackDebug(
  log?: (event: string, data: Record<string, unknown>) => void,
): MissionPlaybackDebug {
  const counters: MissionPlaybackDebugCounters = {
    sceneStarts: 0,
    sceneEnds: 0,
    cameraTicks: 0,
    overlayTicks: 0,
    watchdogFires: 0,
    narrationDone: emptyNarrationDone(),
  };

  const emit = (event: string, data: Record<string, unknown>) => {
    log?.(event, { ...data, counters: { ...counters, narrationDone: { ...counters.narrationDone } } });
  };

  return {
    counters,
    reset() {
      counters.sceneStarts = 0;
      counters.sceneEnds = 0;
      counters.cameraTicks = 0;
      counters.overlayTicks = 0;
      counters.watchdogFires = 0;
      counters.narrationDone = emptyNarrationDone();
    },
    sessionStart(data) {
      emit('mission_playback_session_start', data);
    },
    sceneStart(data) {
      counters.sceneStarts += 1;
      emit('mission_playback_scene_start', data);
    },
    sceneEnd(data) {
      counters.sceneEnds += 1;
      emit('mission_playback_scene_end', data);
    },
    cameraTick() {
      counters.cameraTicks += 1;
    },
    overlayTick() {
      counters.overlayTicks += 1;
    },
    narrationDone(source, data = {}) {
      counters.narrationDone[source] += 1;
      emit('mission_playback_narration_done', { source, ...data });
    },
    watchdogFired(data) {
      counters.watchdogFires += 1;
      emit('mission_playback_watchdog', data);
    },
    voicePath(path, data = {}) {
      emit('mission_playback_voice_path', { path, ...data });
    },
    snapshot() {
      return {
        ...counters,
        narrationDone: { ...counters.narrationDone },
      };
    },
  };
}
