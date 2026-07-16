import assert from 'node:assert/strict';
import {
  emptyOriginalPlaybackState,
  originalPlaybackState,
  type ExpoAudioStatusSnapshot,
} from '../audioAdapterState';

const status = (overrides: Partial<ExpoAudioStatusSnapshot> = {}): ExpoAudioStatusSnapshot => ({
  isLoaded: true,
  playing: true,
  isBuffering: false,
  currentTime: 12.345,
  duration: 98.765,
  didJustFinish: false,
  playbackState: 'ready',
  isPausedByInterruption: false,
  ...overrides,
});

assert.deepEqual(originalPlaybackState(status()), {
  loaded: true,
  playing: true,
  buffering: false,
  paused_by_interruption: false,
  position_ms: 12_345,
  duration_ms: 98_765,
  did_finish: false,
});

assert.equal(originalPlaybackState(status({ duration: 0 })).duration_ms, null);
assert.equal(originalPlaybackState(status({ duration: Number.POSITIVE_INFINITY })).duration_ms, null);
assert.equal(originalPlaybackState(status({ currentTime: -3 })).position_ms, 0);
assert.match(originalPlaybackState(status({ playbackState: 'failed' })).error ?? '', /could not be loaded/);
assert.equal(originalPlaybackState(status({ isPausedByInterruption: true })).paused_by_interruption, true);
assert.deepEqual(originalPlaybackState(null), emptyOriginalPlaybackState());

console.log('Originals expo-audio state adapter tests passed.');
