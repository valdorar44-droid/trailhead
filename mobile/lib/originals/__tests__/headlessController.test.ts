import assert from 'node:assert/strict';
import { createOriginalAccessStore } from '../accessStore';
import { originalLocalAccessIsCurrent } from '../accessPolicy';
import type { OriginalAudioAdapter, OriginalAudioPlaybackState } from '../audioAdapter';
import { originalAudioCoordinator } from '../audioCoordinator';
import { createOriginalBundleStore } from '../bundleStore';
import { createOriginalHeadlessController } from '../headlessController';
import { compileOriginalManifestV2, resolveOriginalManifestPlaybackForSession } from '../manifestV2';
import { compileOriginalManifestV3 } from '../manifestV3';
import { createOriginalLongFormSession } from '../longFormScheduler';
import { createOriginalSession } from '../session';
import { createOriginalSessionStore } from '../sessionStore';
import type { OriginalAuthenticatedAcquisition, OriginalGuestAcquisition, OriginalSummary } from '../types';
import {
  AUDIO_ONE,
  AUDIO_THREE,
  AUDIO_TWO,
  originalManifest,
  originalManifestV2,
  originalManifestV3,
} from './fixtures';
import { createMemoryOriginalFileAdapter } from './memoryFileAdapter';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  process.env.EXPO_PUBLIC_ORIGINAL_ASSET_HOSTS = 'https://assets.test';
  originalAudioCoordinator.reset();
  const manifest = originalManifest();
  const files = createMemoryOriginalFileAdapter({
    downloads: {
      'https://assets.test/one.mp3': AUDIO_ONE,
      'https://assets.test/two.mp3': AUDIO_TWO,
      'https://assets.test/three.mp3': AUDIO_THREE,
      'https://assets.test/story-4.mp3': Buffer.from('audio for story-4'),
      'https://assets.test/story-5.mp3': Buffer.from('audio for story-5'),
      'https://assets.test/story-6.mp3': Buffer.from('audio for story-6'),
      'https://api.gettrailhead.app/story-4.mp3': Buffer.from('audio for story-4'),
      'https://api.gettrailhead.app/story-5.mp3': Buffer.from('audio for story-5'),
      'https://api.gettrailhead.app/story-6.mp3': Buffer.from('audio for story-6'),
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
      audioState = {
        ...audioState,
        loaded: true,
        position_ms: Math.max(0, options?.positionMs ?? 0),
      };
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
    ...createOriginalSession(manifest, 'guest', 30_000),
    status: 'active',
    started_at_ms: 30_000,
  });
  const playsBeforeQueue = playCount;
  await controller.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 31_000 },
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 34_100 },
    { lat: 0, lng: 0.0108, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 38_000 },
    { lat: 0, lng: 0.0108, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 41_100 },
    { lat: 0, lng: 0.0162, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 45_000 },
    { lat: 0, lng: 0.0162, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 48_100 },
  ], async () => {});
  const queuedSession = await sessions.loadActive();
  assert.equal(queuedSession?.current_stop_id, 'story-1');
  assert.deepEqual(queuedSession?.pending_stop_ids, ['story-2', 'story-3']);
  assert.equal(queuedSession?.queued_stop_id, 'story-2');
  assert.equal(playCount, playsBeforeQueue + 1, 'only the FIFO head plays while later cues queue');

  stateListener?.({ ...audioState, did_finish: true });
  await controller.flush();
  const secondPlaying = await sessions.loadActive();
  assert.equal(secondPlaying?.current_stop_id, 'story-2');
  assert.deepEqual(secondPlaying?.pending_stop_ids, ['story-3']);
  assert.equal(secondPlaying?.queued_stop_id, 'story-3');
  assert.equal(playCount, playsBeforeQueue + 2);

  stateListener?.({ ...audioState, did_finish: true });
  await controller.flush();
  const thirdPlaying = await sessions.loadActive();
  assert.equal(thirdPlaying?.current_stop_id, 'story-3');
  assert.deepEqual(thirdPlaying?.pending_stop_ids, []);
  assert.equal(thirdPlaying?.queued_stop_id, null);
  assert.equal(playCount, playsBeforeQueue + 3);

  stateListener?.({ ...audioState, did_finish: true });
  await controller.flush();
  const queueDrained = await sessions.loadActive();
  assert.equal(queueDrained?.status, 'completed');
  assert.equal(queueDrained?.current_stop_id, null);
  assert.deepEqual(queueDrained?.pending_stop_ids, []);
  assert.deepEqual(queueDrained?.completed_stop_ids, ['story-1', 'story-2', 'story-3']);

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
  const audioStateEntered = deferred<void>();
  const audioStateGate = deferred<void>();
  let delayAudioState = true;
  const racingAudio = {
    ...audio,
    async getState() {
      if (delayAudioState) {
        audioStateEntered.resolve();
        await audioStateGate.promise;
        delayAudioState = false;
      }
      return audio.getState();
    },
  };
  let raceTrackingStopped = 0;
  const racingController = createOriginalHeadlessController({
    audio: racingAudio,
    access,
    bundles,
    sessions,
  });
  const playCountBeforeRace = playCount;
  const raceProcess = racingController.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 11_000 },
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 14_100 },
  ], async () => { raceTrackingStopped += 1; });
  await audioStateEntered.promise;
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
  audioStateGate.resolve();
  const [raceHandled] = await Promise.all([raceProcess, stopRace]);
  assert.equal(raceHandled, true, 'a cancelled cold cue consumes its fixes so they cannot reach the next tour');
  assert.equal(await sessions.loadActive(), null, 'the cold task cannot recreate the active pointer after End tour');
  assert.equal(playCount, playCountBeforeRace, 'narration cannot start after End tour wins a delayed audio-state race');
  assert.ok(raceTrackingStopped >= 1, 'ending the tour stops the cold native tracking callback');
  let postStopTrackingCalls = 0;
  const postStopDelivery = await racingController.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 16_000 },
  ], async () => { postStopTrackingCalls += 1; });
  assert.equal(postStopDelivery, true, 'a post-stop GPS delivery is discarded instead of queued for the next tour');
  assert.equal(postStopTrackingCalls, 1, 'a post-stop delivery repairs any native task still emitting fixes');
  originalAudioCoordinator.reset();

  const unionManifest = originalManifestV2();
  const selected = compileOriginalManifestV2(unionManifest, {
    chapter_id: 'mountain-crossing',
    variant_id: 'eastbound',
  });
  const smokiesSummary: OriginalSummary = {
    ...summary,
    id: unionManifest.pack_id,
    slug: unionManifest.pack_id,
    version: unionManifest.version,
    title: unionManifest.title,
  };
  await access.claimGuest({
    guest_access: true,
    access_type: 'guest_free',
    pack: smokiesSummary,
    manifest_path: '/api/originals/smokies-original/versions/1/manifest',
  });
  await bundles.download(unionManifest, { ownerScope: 'guest' });
  await sessions.setActive({
    ...createOriginalSession(
      selected.manifest,
      'guest',
      20_000,
      { schema_version: 1, ...selected.selection },
    ),
    status: 'active',
    started_at_ms: 20_000,
  });
  const v2Controller = createOriginalHeadlessController({ audio, access, bundles, sessions });
  const playsBeforeV2 = playCount;
  const v2Handled = await v2Controller.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 21_000 },
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 24_100 },
  ], async () => {});
  assert.equal(v2Handled, true);
  assert.equal(playCount, playsBeforeV2 + 1, 'cold restore compiles and plays the exact V2 route selection');
  assert.equal(
    (await sessions.loadActive())?.chapter_selection?.variant_id,
    'eastbound',
    'cold progress remains bound to the selected route variant',
  );
  await v2Controller.stop();

  const accountScope = 'account:expired' as const;
  const expiredAcquisition: OriginalAuthenticatedAcquisition = {
    entitlement: {
      pack_id: unionManifest.pack_id,
      version: unionManifest.version,
      access_type: 'explorer_subscription',
      access_active: true,
      access_expires_at: Math.floor(Date.now() / 1_000) - 60,
    },
    pack: smokiesSummary,
    trip: {},
    already_owned: false,
    replayed: false,
    credit_balance: 900,
  };
  await access.recordEntitlement(expiredAcquisition, 'expired');
  await sessions.setActive({
    ...createOriginalSession(
      selected.manifest,
      accountScope,
      30_000,
      { schema_version: 1, ...selected.selection },
    ),
    status: 'active',
    started_at_ms: 30_000,
  });
  let expiredTrackingStopped = 0;
  const expiredController = createOriginalHeadlessController({ audio, access, bundles, sessions });
  const playsBeforeExpired = playCount;
  assert.equal(await expiredController.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 31_000 },
  ], async () => { expiredTrackingStopped += 1; }), true);
  assert.equal(playCount, playsBeforeExpired, 'expired Explorer access cannot resume narration cold');
  assert.equal(expiredTrackingStopped, 1, 'expired access stops the native location task');
  await expiredController.stop();

  const v3Manifest = originalManifestV3(2);
  const v3Compiled = compileOriginalManifestV3(v3Manifest, {
    chapter_id: 'mountain-crossing',
    variant_id: 'eastbound',
  });
  const v3OwnerScope = 'account:v3' as const;
  await access.recordEntitlement({
    entitlement: {
      pack_id: v3Manifest.pack_id,
      version: v3Manifest.version,
      access_type: 'permanent',
      access_active: true,
      permanent: true,
    },
    pack: { ...summary, version: 2 },
    trip: {},
    already_owned: false,
    replayed: false,
    credit_balance: 900,
  }, 'v3');
  await bundles.download(v3Manifest, { ownerScope: v3OwnerScope });
  const v3AccessList = await access.list(v3OwnerScope);
  const v3Access = {
    ...access,
    get: async (..._args: Parameters<typeof access.get>) => v3AccessList[0] ?? null,
  };
  assert.equal(v3AccessList.length, 1);
  assert.equal(
    (await v3Access.get(v3OwnerScope, v3Manifest.pack_id, v3Manifest.version))?.owner_scope,
    v3OwnerScope,
  );
  assert.equal(
    originalLocalAccessIsCurrent(v3AccessList[0], undefined, { manifestId: v3Manifest.manifest_id }),
    true,
  );
  assert(await bundles.get(v3OwnerScope, v3Manifest.pack_id, v3Manifest.version));
  assert.equal(
    (await bundles.loadManifest(v3OwnerScope, v3Manifest.pack_id, v3Manifest.version, false))?.schema_version,
    3,
  );
  const parkedItem = v3Compiled.selectable.items.find(item => (
    item.delivery.mode === 'stopped_deeper'
    && item.delivery.availability === 'before_route_user_confirmed_parked'
  ));
  const capacityItem = v3Compiled.selectable.items.find(item => (
    item.delivery.mode === 'capacity_deeper'
  ));
  assert(parkedItem && capacityItem);
  const explicitLongForm = {
    ...createOriginalLongFormSession(v3Compiled.selectable, 40_000),
    current_item_id: parkedItem.id,
    current_audio_position_ms: 27_000,
    current_selection_origin: 'user_explicit' as const,
  };
  await sessions.setActive({
    ...createOriginalSession(
      v3Compiled.manifest,
      v3OwnerScope,
      40_000,
      { schema_version: 1, ...v3Compiled.selection },
    ),
    status: 'active',
    started_at_ms: 40_000,
    long_form: explicitLongForm,
  });
  const persistedV3 = await sessions.loadActive();
  assert.equal(persistedV3?.owner_scope, v3OwnerScope);
  assert.equal(persistedV3?.status, 'active');
  assert.equal(persistedV3?.user_paused, false);
  assert.equal(persistedV3?.long_form?.current_item_id, parkedItem.id);
  assert.equal(persistedV3?.long_form?.current_selection_origin, 'user_explicit');
  assert.equal(persistedV3?.chapter_selection?.delivery_contract_sha256, v3Compiled.selection.delivery_contract_sha256);
  assert(persistedV3);
  assert.equal(
    resolveOriginalManifestPlaybackForSession(v3Manifest, persistedV3).source_schema_version,
    3,
  );
  await audio.unload();
  const v3Controller = createOriginalHeadlessController({ audio, access: v3Access, bundles, sessions });
  const playsBeforeV3 = playCount;
  let v3TrackingStopped = 0;
  assert.equal(await v3Controller.process([
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 41_000 },
    { lat: 0, lng: 0.0045, accuracy_m: 10, heading_deg: 90, speed_mps: 10, timestamp_ms: 44_100 },
  ], async () => { v3TrackingStopped += 1; }), true);
  assert.equal(v3TrackingStopped, 0, 'a valid V3 session remains active during cold recovery');
  const preemptedV3 = await sessions.loadActive();
  assert.equal(playCount, playsBeforeV3 + 2, 'cold recovery resumes the explicit story, then a hard cue preempts it');
  assert.equal(preemptedV3?.current_stop_id, 'story-1');
  assert.equal(preemptedV3?.long_form?.current_item_id, null);
  assert.equal(preemptedV3?.long_form?.deferred_item_id, parkedItem.id);
  assert.equal(preemptedV3?.long_form?.deferred_audio_position_ms, 27_000);
  assert.deepEqual(preemptedV3?.completed_stop_ids, []);
  assert.deepEqual(preemptedV3?.pending_stop_ids, []);
  stateListener?.({ ...audioState, did_finish: true });
  await v3Controller.flush();
  const resumedV3 = await sessions.loadActive();
  assert.equal(resumedV3?.long_form?.current_item_id, parkedItem.id);
  assert.equal(resumedV3?.long_form?.current_audio_position_ms, 27_000);
  assert.equal(playCount, playsBeforeV3 + 3, 'the exact explicit story position resumes after the hard cue');
  assert.deepEqual(resumedV3?.completed_stop_ids, ['story-1']);
  await v3Controller.stop();

  assert(resumedV3);
  await sessions.setActive({ ...resumedV3, status: 'stopped', updated_at_ms: 50_000 });
  await audio.unload();
  const stoppedV3Controller = createOriginalHeadlessController({ audio, access: v3Access, bundles, sessions });
  const playsBeforeStoppedV3 = playCount;
  let stoppedV3Tracking = 0;
  assert.equal(await stoppedV3Controller.process([], async () => { stoppedV3Tracking += 1; }), true);
  assert.equal(playCount, playsBeforeStoppedV3, 'End Tour cannot restart a retained explicit story');
  assert.equal(stoppedV3Tracking, 1);
  await stoppedV3Controller.stop();

  await sessions.setActive({
    ...resumedV3,
    status: 'active',
    current_stop_id: null,
    pending_stop_ids: [],
    queued_stop_id: null,
    long_form: {
      ...createOriginalLongFormSession(v3Compiled.selectable, 60_000),
      current_item_id: capacityItem.id,
      current_audio_position_ms: 12_000,
      current_selection_origin: 'capacity_auto',
    },
  });
  await audio.unload();
  const capacityV3Controller = createOriginalHeadlessController({ audio, access: v3Access, bundles, sessions });
  const playsBeforeCapacityV3 = playCount;
  assert.equal(await capacityV3Controller.process([], async () => {}), true);
  assert.equal(playCount, playsBeforeCapacityV3, 'headless recovery never initiates an automatic deeper story');
  await capacityV3Controller.stop();

  await sessions.setActive({
    ...createOriginalSession(
      v3Compiled.manifest,
      v3OwnerScope,
      70_000,
      { schema_version: 1, ...v3Compiled.selection },
    ),
    status: 'active',
    started_at_ms: 70_000,
    long_form: {
      ...createOriginalLongFormSession(v3Compiled.selectable, 70_000),
      completed_item_ids: [parkedItem.id],
      current_item_id: parkedItem.id,
      current_audio_position_ms: 18_500,
      current_selection_origin: 'user_explicit',
    },
  });
  const persistedCompletedReplay = await sessions.loadActive();
  assert.equal(persistedCompletedReplay?.long_form?.current_item_id, parkedItem.id);
  assert.equal(persistedCompletedReplay?.long_form?.current_audio_position_ms, 18_500);
  await audio.unload();
  const completedReplayController = createOriginalHeadlessController({
    audio,
    access: v3Access,
    bundles,
    sessions,
  });
  const playsBeforeCompletedReplay = playCount;
  assert.equal(await completedReplayController.process([], async () => {}), true);
  assert.equal(
    playCount,
    playsBeforeCompletedReplay + 1,
    'force-stop recovery resumes an explicitly replayed completed story',
  );
  assert.equal((await sessions.loadActive())?.long_form?.current_audio_position_ms, 18_500);
  await completedReplayController.stop();

  await sessions.setActive({
    ...createOriginalSession(
      v3Compiled.manifest,
      v3OwnerScope,
      80_000,
      { schema_version: 1, ...v3Compiled.selection },
    ),
    status: 'active',
    started_at_ms: 80_000,
    current_stop_id: v3Compiled.manifest.stops[0].id,
    current_audio_position_ms: 3_500,
    long_form: {
      ...createOriginalLongFormSession(v3Compiled.selectable, 80_000),
      completed_item_ids: [parkedItem.id],
      deferred_item_id: parkedItem.id,
      deferred_audio_position_ms: 19_750,
      deferred_selection_origin: 'user_explicit',
    },
  });
  const persistedDeferredReplay = await sessions.loadActive();
  assert.equal(persistedDeferredReplay?.long_form?.deferred_item_id, parkedItem.id);
  assert.equal(persistedDeferredReplay?.long_form?.deferred_audio_position_ms, 19_750);
  await audio.unload();
  const deferredReplayController = createOriginalHeadlessController({
    audio,
    access: v3Access,
    bundles,
    sessions,
  });
  const playsBeforeDeferredReplay = playCount;
  assert.equal(await deferredReplayController.process([], async () => {}), true);
  assert.equal(playCount, playsBeforeDeferredReplay + 1, 'guaranteed narration resumes first');
  stateListener?.({ ...audioState, did_finish: true });
  await deferredReplayController.flush();
  const resumedDeferredReplay = await sessions.loadActive();
  assert.equal(resumedDeferredReplay?.long_form?.current_item_id, parkedItem.id);
  assert.equal(resumedDeferredReplay?.long_form?.current_audio_position_ms, 19_750);
  assert.equal(playCount, playsBeforeDeferredReplay + 2, 'completed story replay resumes exactly after the cue');
  await deferredReplayController.stop();

  console.log('Originals cold/headless controller tests passed.');
}

void main();
