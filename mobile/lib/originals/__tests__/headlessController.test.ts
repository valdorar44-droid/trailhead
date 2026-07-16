import assert from 'node:assert/strict';
import { createOriginalAccessStore } from '../accessStore';
import type { OriginalAudioAdapter, OriginalAudioPlaybackState } from '../audioAdapter';
import { originalAudioCoordinator } from '../audioCoordinator';
import { createOriginalBundleStore } from '../bundleStore';
import { createOriginalHeadlessController } from '../headlessController';
import { createOriginalSession } from '../session';
import { createOriginalSessionStore } from '../sessionStore';
import type { OriginalGuestAcquisition, OriginalSummary } from '../types';
import { AUDIO_ONE, AUDIO_THREE, AUDIO_TWO, originalManifest } from './fixtures';
import { createMemoryOriginalFileAdapter } from './memoryFileAdapter';

async function main() {
  originalAudioCoordinator.reset();
  const manifest = originalManifest();
  const files = createMemoryOriginalFileAdapter({
    downloads: {
      'https://assets.test/one.mp3': AUDIO_ONE,
      'https://assets.test/two.mp3': AUDIO_TWO,
      'https://assets.test/three.mp3': AUDIO_THREE,
    },
  });
  const bundles = createOriginalBundleStore(files, undefined, {
    prepare: async () => ({ pack_id: 'map:moab:1', ready: true as const, bytes: 500 }),
    isReady: async () => true,
    remove: async () => {},
  });
  const access = createOriginalAccessStore(files);
  const sessions = createOriginalSessionStore(files);
  const summary: OriginalSummary = {
    id: manifest.pack_id,
    slug: 'moab-canyons-to-the-sky',
    content_kind: 'original_drive',
    version: 1,
    title: manifest.title,
    summary: 'A scenic drive.',
    price_credits: 0,
    explorer_price_credits: 0,
    free: true,
    coverage_region: 'moab',
    public_metadata: {},
    published_at: 1,
    featured: true,
  };
  const claim: OriginalGuestAcquisition = {
    guest_access: true,
    access_type: 'guest_free',
    pack: summary,
    manifest_path: '/api/originals/moab-original/versions/1/manifest',
  };
  await access.claimGuest(claim);
  await bundles.download(manifest, { ownerScope: 'guest' });
  await sessions.setActive({
    ...createOriginalSession(manifest, 'guest', 1),
    status: 'active',
    started_at_ms: 1,
  });

  let stateListener: ((state: OriginalAudioPlaybackState) => void) | undefined;
  let userPauseListener: ((state: OriginalAudioPlaybackState) => void | Promise<void>) | undefined;
  let audioState: OriginalAudioPlaybackState = {
    loaded: false,
    playing: false,
    buffering: false,
    paused_by_interruption: false,
    position_ms: 0,
    duration_ms: 60_000,
    did_finish: false,
  };
  let playCount = 0;
  const audio: OriginalAudioAdapter = {
    capabilities: { backgroundPlayback: true, lockScreenControls: true },
    async load(_uri, options) {
      stateListener = options?.onState;
      userPauseListener = options?.onUserPause;
      audioState = { ...audioState, loaded: true };
      stateListener?.(audioState);
    },
    async play() {
      playCount += 1;
      audioState = { ...audioState, playing: true };
      stateListener?.(audioState);
    },
    async pause() { audioState = { ...audioState, playing: false }; },
    async seek(positionMs) { audioState = { ...audioState, position_ms: positionMs }; },
    async setVolume() {},
    async stop() { audioState = { ...audioState, playing: false, position_ms: 0 }; },
    async unload() { audioState = { ...audioState, loaded: false, playing: false }; },
    async getState() { return audioState; },
  };
  let trackingStopped = 0;
  const controller = createOriginalHeadlessController({ audio, access, bundles, sessions });
  const handled = await controller.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 1_000 },
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 4_100 },
  ], async () => { trackingStopped += 1; });
  assert.equal(handled, true);
  assert.equal(playCount, 1, 'a cold task starts the locally downloaded cue');
  assert.deepEqual((await sessions.loadActive())?.triggered_stop_ids, ['story-1']);

  assert(userPauseListener);
  await userPauseListener({ ...audioState, playing: false, position_ms: 12_500 });
  await controller.flush();
  const paused = await sessions.loadActive();
  assert.equal(paused?.status, 'paused', 'lock-screen pause is durable without React mounted');
  assert.equal(paused?.user_paused, true);
  assert.equal(paused?.current_audio_position_ms, 12_500);
  assert.equal(trackingStopped, 1, 'user pause stops further location collection');
  originalAudioCoordinator.reset();

  console.log('Originals cold/headless controller tests passed.');
}

void main();
