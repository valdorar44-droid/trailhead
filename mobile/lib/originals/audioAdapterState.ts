export type OriginalAudioPlaybackState = {
  loaded: boolean;
  playing: boolean;
  buffering: boolean;
  paused_by_interruption: boolean;
  position_ms: number;
  duration_ms: number | null;
  did_finish: boolean;
  error?: string;
};

export type ExpoAudioStatusSnapshot = {
  isLoaded: boolean;
  playing: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  didJustFinish: boolean;
  playbackState: string;
  isPausedByInterruption?: boolean;
};

export function emptyOriginalPlaybackState(): OriginalAudioPlaybackState {
  return {
    loaded: false,
    playing: false,
    buffering: false,
    paused_by_interruption: false,
    position_ms: 0,
    duration_ms: null,
    did_finish: false,
  };
}

function finiteSecondsToMs(value: number) {
  return Number.isFinite(value) ? Math.max(0, value * 1_000) : 0;
}

export function originalPlaybackState(
  status?: ExpoAudioStatusSnapshot | null,
): OriginalAudioPlaybackState {
  if (!status) return emptyOriginalPlaybackState();
  const failed = status.playbackState === 'failed';
  return {
    loaded: status.isLoaded,
    playing: status.playing,
    buffering: status.isBuffering,
    paused_by_interruption: Boolean(status.isPausedByInterruption),
    position_ms: finiteSecondsToMs(status.currentTime),
    duration_ms: Number.isFinite(status.duration) && status.duration > 0
      ? finiteSecondsToMs(status.duration)
      : null,
    did_finish: status.didJustFinish,
    ...(failed ? { error: 'Trailhead Original narration could not be loaded.' } : {}),
  };
}
