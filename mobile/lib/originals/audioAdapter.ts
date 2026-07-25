import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioMetadata,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { Platform } from 'react-native';
import {
  emptyOriginalPlaybackState,
  originalPlaybackState,
  type OriginalAudioPlaybackState,
} from './audioAdapterState';
import { applyNativeAudioSessionMode } from './nativeAudioSession';

export { originalPlaybackState } from './audioAdapterState';
export type { OriginalAudioPlaybackState } from './audioAdapterState';

export type OriginalAudioAdapter = {
  capabilities: {
    backgroundPlayback: boolean;
    lockScreenControls: boolean;
  };
  load(uri: string, options?: {
    positionMs?: number;
    metadata?: AudioMetadata;
    onState?: (state: OriginalAudioPlaybackState) => void;
    onUserPause?: (state: OriginalAudioPlaybackState) => void | Promise<void>;
    onUserPlay?: (state: OriginalAudioPlaybackState) => void | Promise<void>;
  }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  stop(): Promise<void>;
  unload(): Promise<void>;
  releaseSession(): Promise<void>;
  getState(): Promise<OriginalAudioPlaybackState>;
};

const LOAD_TIMEOUT_MS = 15_000;
const LOCK_SCREEN_METADATA = {
  title: 'Trailhead Original',
  artist: 'Trailhead',
} as const;

type AudioSubscription = { remove(): void };
type PendingLoad = { promise: Promise<AudioStatus>; cancel(): void };

const ORIGINALS_AUDIO_MODE = {
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'doNotMix',
} as const;

function configureOriginalsAudioMode() {
  // expo-av navigation/Co-Pilot audio shares the native audio session and may
  // have selected a ducking mode while the Original was paused. Reapply the
  // Originals background mode for each load without activating iOS audio while
  // an asset is still being prepared.
  return applyNativeAudioSessionMode(() => setAudioModeAsync(ORIGINALS_AUDIO_MODE));
}

function activateOriginalsAudioSession() {
  // End tour explicitly deactivates the shared native session. Configure the
  // category first, then reactivate immediately before narration starts.
  return applyNativeAudioSessionMode(async () => {
    await setAudioModeAsync(ORIGINALS_AUDIO_MODE);
    await setIsAudioActiveAsync(true);
  });
}

function waitUntilLoaded(player: AudioPlayer): PendingLoad {
  const current = player.currentStatus;
  if (current.isLoaded) return { promise: Promise.resolve(current), cancel() {} };
  if (current.playbackState === 'failed') {
    return {
      promise: Promise.reject(new Error('Trailhead Original narration could not be loaded.')),
      cancel() {},
    };
  }

  let subscription: AudioSubscription | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let rejectPending: (error: Error) => void = () => {};
  const cleanup = () => {
    if (timeout) clearTimeout(timeout);
    timeout = null;
    subscription?.remove();
    subscription = null;
  };
  const promise = new Promise<AudioStatus>((resolve, reject) => {
    rejectPending = reject;
    const handleStatus = (status: AudioStatus) => {
      if (settled) return;
      if (status.playbackState === 'failed') {
        settled = true;
        cleanup();
        reject(new Error('Trailhead Original narration could not be loaded.'));
      } else if (status.isLoaded) {
        settled = true;
        cleanup();
        resolve(status);
      }
    };
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Trailhead Original narration took too long to load.'));
    }, LOAD_TIMEOUT_MS);
    const added = player.addListener('playbackStatusUpdate', handleStatus);
    subscription = added;
    if (settled) added.remove();
    else handleStatus(player.currentStatus);
  });

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPending(new Error('Trailhead Original narration loading was cancelled.'));
    },
  };
}

export function createExpoAudioOriginalAudioAdapter(): OriginalAudioAdapter {
  let player: AudioPlayer | null = null;
  let statusSubscription: AudioSubscription | null = null;
  let pendingLoad: PendingLoad | null = null;
  let onState: ((state: OriginalAudioPlaybackState) => void) | undefined;
  let onUserPause: ((state: OriginalAudioPlaybackState) => void | Promise<void>) | undefined;
  let onUserPlay: ((state: OriginalAudioPlaybackState) => void | Promise<void>) | undefined;
  let lastState = emptyOriginalPlaybackState();
  let plannedPause = false;
  let plannedPlay = false;
  let volume = 1;
  const supportsNativePlayback = Platform.OS === 'android' || Platform.OS === 'ios';

  const emitState = (status: AudioStatus) => {
    const previous = lastState;
    const next = originalPlaybackState(status as AudioStatus & { isPausedByInterruption?: boolean });
    lastState = next;
    onState?.(next);
    const externallyPlayed = previous.loaded
      && !previous.playing
      && next.loaded
      && next.playing;
    if (next.playing) {
      plannedPause = false;
      if (plannedPlay) plannedPlay = false;
      else if (externallyPlayed) void onUserPlay?.(next);
    }
    const externallyPaused = previous.playing
      && next.loaded
      && !next.playing
      && !next.buffering
      && !next.did_finish;
    if (externallyPaused) {
      if (plannedPause) plannedPause = false;
      else if (!next.paused_by_interruption) void onUserPause?.(next);
    }
  };

  const unload = async () => {
    const current = player;
    player = null;
    pendingLoad?.cancel();
    pendingLoad = null;
    statusSubscription?.remove();
    statusSubscription = null;
    onState = undefined;
    onUserPause = undefined;
    onUserPlay = undefined;
    plannedPause = false;
    plannedPlay = false;
    lastState = emptyOriginalPlaybackState();
    if (!current) return;
    if (supportsNativePlayback) {
      try {
        current.clearLockScreenControls();
      } catch {
        // The player may already have been removed by the native audio session.
      }
    }
    try {
      current.remove();
    } catch {
      // Releasing an already-removed shared object is harmless.
    }
  };

  return {
    capabilities: {
      backgroundPlayback: supportsNativePlayback,
      lockScreenControls: supportsNativePlayback,
    },

    async load(uri, options = {}) {
      await unload();
      await configureOriginalsAudioMode();
      onState = options.onState;
      onUserPause = options.onUserPause;
      onUserPlay = options.onUserPlay;
      const created = createAudioPlayer(
        { uri },
        {
          updateInterval: 1_000,
          keepAudioSessionActive: true,
        },
      );
      player = created;
      created.volume = volume;
      statusSubscription = created.addListener('playbackStatusUpdate', emitState);

      if (supportsNativePlayback) {
        created.setActiveForLockScreen(true, {
          ...LOCK_SCREEN_METADATA,
          ...options.metadata,
        }, {
          showSeekBackward: true,
          showSeekForward: true,
        });
      }

      let loading: PendingLoad | null = null;
      try {
        loading = waitUntilLoaded(created);
        pendingLoad = loading;
        await loading.promise;
        if (pendingLoad === loading) pendingLoad = null;
        if (player !== created) return;
        const positionMs = Math.max(0, options.positionMs ?? 0);
        if (positionMs > 0) {
          // Zero tolerance preserves the exact persisted narration position on iOS.
          await created.seekTo(positionMs / 1_000, 0, 0);
        }
        emitState(created.currentStatus);
      } catch (error) {
        if (pendingLoad === loading) pendingLoad = null;
        if (player === created) await unload();
        throw error;
      }
    },

    async play() {
      if (!player) throw new Error('No Trailhead Original narration is loaded.');
      await activateOriginalsAudioSession();
      plannedPause = false;
      plannedPlay = !player.currentStatus.playing;
      player.play();
    },

    async pause() {
      if (player?.currentStatus.playing) plannedPause = true;
      player?.pause();
    },

    async seek(positionMs) {
      if (!player) return;
      await player.seekTo(Math.max(0, positionMs) / 1_000, 0, 0);
    },

    async setVolume(nextVolume) {
      volume = Math.max(0, Math.min(1, nextVolume));
      if (player) player.volume = volume;
    },

    async stop() {
      if (!player) return;
      if (player.currentStatus.playing) plannedPause = true;
      player.pause();
      await player.seekTo(0, 0, 0);
    },

    unload,

    async releaseSession() {
      await unload();
      await applyNativeAudioSessionMode(() => setIsAudioActiveAsync(false));
    },

    async getState() {
      if (!player) return emptyOriginalPlaybackState();
      lastState = originalPlaybackState(player.currentStatus);
      return lastState;
    },
  };
}

export const expoAudioOriginalAudioAdapter = createExpoAudioOriginalAudioAdapter();

// Preserve the existing runtime import while the implementation moves to expo-audio.
export const createExpoAvOriginalAudioAdapter = createExpoAudioOriginalAudioAdapter;
export const expoAvOriginalAudioAdapter = expoAudioOriginalAudioAdapter;
