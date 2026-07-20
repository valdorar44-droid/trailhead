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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

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
  let releaseSessionCount = 0;
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
    async releaseSession() {
      releaseSessionCount += 1;
      audioState = { ...audioState, loaded: false, playing: false };
    },
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
  assert.equal(releaseSessionCount, 1, 'a lock-screen user pause releases the idle native audio session');

  await sessions.setActive({
    ...createOriginalSession(manifest, 'guest', 8_000),
    status: 'active',
    started_at_ms: 8_000,
  });
  await controller.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 8_100 },
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 11_200 },
  ], async () => {});
  const navigationLease = await originalAudioCoordinator.acquire({
    owner: 'test-navigation',
    priority: 'navigation',
    pause: async () => {},
    resume: async () => {},
  });
  const releasesBeforeNavigationStop = releaseSessionCount;
  await controller.stop();
  assert.equal(
    releaseSessionCount,
    releasesBeforeNavigationStop,
    'ending an Original cannot deactivate a higher-priority navigation audio session',
  );
  assert.equal(originalAudioCoordinator.activeOwner(), 'test-navigation');
  await navigationLease.release();

  const raceSession = {
    ...createOriginalSession(manifest, 'guest', 10_000),
    status: 'active' as const,
    started_at_ms: 10_000,
  };
  await sessions.setActive(raceSession);
  const assetEntered = deferred<void>();
  const assetGate = deferred<void>();
  const racingBundles = {
    ...bundles,
    async assetUri(...args: Parameters<typeof bundles.assetUri>) {
      assetEntered.resolve();
      await assetGate.promise;
      return bundles.assetUri(...args);
    },
  };
  let raceTrackingStopped = 0;
  const racingController = createOriginalHeadlessController({
    audio,
    access,
    bundles: racingBundles,
    sessions,
  });
  const playCountBeforeRace = playCount;
  const raceProcess = racingController.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 11_000 },
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 14_100 },
  ], async () => { raceTrackingStopped += 1; });
  await assetEntered.promise;
  const inFlight = await sessions.loadActive();
  assert.ok(inFlight);
  await sessions.save({ ...inFlight, status: 'stopped', updated_at_ms: 15_000 });
  await sessions.setActive(null);
  const stopRace = racingController.stop();
  let restartTrackingCalls = 0;
  const deliveryDuringStop = await racingController.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 15_100 },
  ], async () => { restartTrackingCalls += 1; });
  assert.equal(deliveryDuringStop, true, 'a final cold GPS delivery is consumed while End tour is draining');
  assert.equal(restartTrackingCalls, 0, 'a rejected delivery cannot replace the native stop callback');
  assetGate.resolve();
  const [raceHandled] = await Promise.all([raceProcess, stopRace]);
  assert.equal(raceHandled, true, 'a cancelled cold cue consumes its fixes so they cannot reach the next tour');
  assert.equal(await sessions.loadActive(), null, 'the cold task cannot recreate the active pointer after End tour');
  assert.equal(playCount, playCountBeforeRace, 'narration cannot start after End tour wins the asset-load race');
  assert.ok(raceTrackingStopped >= 1, 'ending the tour stops the cold native tracking callback');
  let postStopTrackingCalls = 0;
  const postStopDelivery = await racingController.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 16_000 },
  ], async () => { postStopTrackingCalls += 1; });
  assert.equal(postStopDelivery, true, 'a post-stop GPS delivery is discarded instead of queued for the next tour');
  assert.equal(postStopTrackingCalls, 1, 'a post-stop delivery repairs any native task still emitting fixes');
  originalAudioCoordinator.reset();

  console.log('Originals cold/headless controller tests passed.');
}

void main();
