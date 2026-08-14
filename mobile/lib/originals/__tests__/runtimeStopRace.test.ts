import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { compileOriginalManifestV3 } from '../manifestV3';
import { createOriginalLongFormSession } from '../longFormScheduler';
import { createOriginalSession } from '../session';
import { originalManifest, originalManifestV2, originalManifestV3 } from './fixtures';

type Runtime = import('../runtime').OriginalsRuntimeValue;
type AdminRuntime = import('../runtime').OriginalsAdminRuntimeValue;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nativeRuntimeStubs: Record<string, string> = {
  'react-native': `
    export const AppState = {
      addEventListener(_event, listener) {
        globalThis.__originalsRuntimeAppStateListener = listener;
        return {
          remove() {
            if (globalThis.__originalsRuntimeAppStateListener === listener) {
              globalThis.__originalsRuntimeAppStateListener = null;
            }
          },
        };
      },
    };
  `,
  '../store': `
    const state = () => globalThis.__originalsRuntimeAuthState || { user: null, token: null };
    export function useStore(selector) { return selector(state()); }
    useStore.getState = state;
  `,
  '../storage': `
    export const accountStorage = {
      epoch: () => globalThis.__originalsRuntimeEpoch || 0,
      run: async (operation, epoch) => epoch === (globalThis.__originalsRuntimeEpoch || 0) ? operation() : undefined,
      subscribe: () => () => {},
    };
    export const storage = { get: async () => null };
  `,
  '../carIntegration': `
    export function buildCarAccountState(user, signedIn) {
      return {
        accountId: signedIn && user?.id != null ? String(user.id) : null,
        signedIn: Boolean(signedIn && user?.id != null),
        reportsEnabled: false,
        reportsDisabledReason: signedIn ? null : 'signed_out',
      };
    }
    export async function setCarOriginalDrive() {
      globalThis.__originalsRuntimeCarSyncCount = (globalThis.__originalsRuntimeCarSyncCount || 0) + 1;
    }
    export async function clearCarOriginalDrive() {
      globalThis.__originalsRuntimeCarClearCount = (globalThis.__originalsRuntimeCarClearCount || 0) + 1;
    }
  `,
  './api': `
    export const originalsApi = {
      acquire: (...args) => globalThis.__originalsRuntimeAcquire(...args),
      claimFeatured: (...args) => globalThis.__originalsRuntimeClaimFeatured(...args),
    };
  `,
  './analytics': `
    export const ORIGINALS_ANALYTICS_EVENTS = { downloadResult: 'download', stopOutcome: 'stop' };
    export function trackOriginalsAnalyticsEvent() {
      globalThis.__originalsRuntimeAnalyticsCount = (globalThis.__originalsRuntimeAnalyticsCount || 0) + 1;
    }
  `,
  './audioAdapter': `
    export const expoAudioOriginalAudioAdapter = {};
  `,
  './locationAdapter': `
    export const expoOriginalLocationAdapter = {};
  `,
  './headlessRuntime': `
    export async function stopHeadlessOriginalRuntime() {
      globalThis.__originalsRuntimeHeadlessStopCount = (globalThis.__originalsRuntimeHeadlessStopCount || 0) + 1;
    }
  `,
  './accountCleanup': `
    export function registerOriginalsAccountDepartureStopper(stopper) {
      globalThis.__originalsRuntimeAccountDepartureStopper = stopper;
      return () => {
        if (globalThis.__originalsRuntimeAccountDepartureStopper === stopper) {
          globalThis.__originalsRuntimeAccountDepartureStopper = null;
        }
      };
    }
  `,
  './previewAccess': `
    function same(left, right) {
      return left.owner_scope === right.owner_scope
        && left.pack_id === right.pack_id
        && left.version === right.version
        && left.manifest_id === right.manifest_id;
    }
    export async function getOriginalPreviewToken() {
      return globalThis.__originalsRuntimePreviewToken || null;
    }
    export async function clearOriginalPreviewAccessStrict() {
      globalThis.__originalsRuntimePreviewClearCount = (globalThis.__originalsRuntimePreviewClearCount || 0) + 1;
      globalThis.__originalsRuntimePreviewToken = null;
    }
    export async function getOriginalPrivateReviewCleanupIdentity() {
      return globalThis.__originalsRuntimeCleanupIdentity || null;
    }
    export async function saveOriginalPrivateReviewCleanupIdentity(identity) {
      const existing = globalThis.__originalsRuntimeCleanupIdentity;
      if (existing && !same(existing, identity)) {
        throw new Error('Finish the existing private review cleanup before opening another draft.');
      }
      globalThis.__originalsRuntimeCleanupIdentity = {
        schema_version: 1,
        ...identity,
        created_at_ms: existing?.created_at_ms || Date.now(),
      };
      return globalThis.__originalsRuntimeCleanupIdentity;
    }
    export async function clearOriginalPrivateReviewCleanupIdentityStrict(expected) {
      const current = globalThis.__originalsRuntimeCleanupIdentity;
      if (!current) return;
      if (!same(current, expected)) {
        throw new Error('The pending private review cleanup identity changed; nothing was removed.');
      }
      globalThis.__originalsRuntimeCleanupIdentity = null;
    }
  `,
  './expoStores': `
    export const originalAccessStore = {};
    export const originalBundleStore = {};
    export const originalSessionStore = {};
  `,
};

const stubRuntimeDefaults: Plugin = {
  name: 'stub-originals-native-runtime-defaults',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => (
      Object.hasOwn(nativeRuntimeStubs, args.path)
        ? { path: args.path, namespace: 'runtime-stub' }
        : null
    ));
    builder.onLoad({ filter: /.*/, namespace: 'runtime-stub' }, args => ({
      contents: nativeRuntimeStubs[args.path],
      loader: 'js',
    }));
  },
};

async function loadRuntimeModule() {
  const result = await build({
    entryPoints: [path.resolve('lib/originals/runtime.tsx')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    jsx: 'automatic',
    write: false,
    external: ['react'],
    plugins: [stubRuntimeDefaults],
  });
  const output = result.outputFiles[0]?.text;
  assert.ok(output);
  const require = createRequire(import.meta.url);
  const module = { exports: {} as Record<string, unknown> };
  const evaluate = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
  evaluate(require, module, module.exports, path.resolve('lib/originals/runtime.test.cjs'), process.cwd());
  return module.exports as {
    OriginalsRuntimeProvider: React.ComponentType<{
      children?: React.ReactNode;
      dependencies: unknown;
    }>;
    useOriginalsRuntime: () => Runtime;
    useOriginalsAdminRuntime: () => AdminRuntime;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const globals = globalThis as typeof globalThis & {
    __originalsRuntimeAuthState?: { user: { id: string; is_admin?: boolean } | null; token: string | null };
    __originalsRuntimeEpoch?: number;
    __originalsRuntimePreviewToken?: string | null;
    __originalsRuntimePreviewClearCount?: number;
    __originalsRuntimeCleanupIdentity?: {
      schema_version: 1;
      owner_scope: `account:${string}`;
      pack_id: string;
      version: number;
      manifest_id: string;
      created_at_ms: number;
    } | null;
    __originalsRuntimeAcquire?: (...args: unknown[]) => Promise<unknown>;
    __originalsRuntimeClaimFeatured?: (...args: unknown[]) => Promise<unknown>;
    __originalsRuntimeAnalyticsCount?: number;
    __originalsRuntimeCarSyncCount?: number;
    __originalsRuntimeCarClearCount?: number;
    __originalsRuntimeHeadlessStopCount?: number;
    __originalsRuntimeAppStateListener?: ((state: string) => void) | null;
  };
  globals.__originalsRuntimeAuthState = { user: { id: 'admin-preview', is_admin: true }, token: 'admin-token' };
  globals.__originalsRuntimeEpoch = 0;
  globals.__originalsRuntimePreviewToken = null;
  globals.__originalsRuntimePreviewClearCount = 0;
  globals.__originalsRuntimeCleanupIdentity = null;
  globals.__originalsRuntimeAcquire = async () => { throw new Error('unused'); };
  globals.__originalsRuntimeClaimFeatured = async () => { throw new Error('unused'); };
  globals.__originalsRuntimeAnalyticsCount = 0;
  globals.__originalsRuntimeCarSyncCount = 0;
  globals.__originalsRuntimeCarClearCount = 0;
  globals.__originalsRuntimeHeadlessStopCount = 0;
  const runtimeModule = await loadRuntimeModule();
  const accessGate = deferred<Record<string, unknown>>();
  const accessEntered = deferred<void>();
  let accessReads = 0;
  let playCount = 0;
  let sessionSaveCount = 0;
  let setActiveCount = 0;
  let guestClaimCount = 0;
  let entitlementWriteCount = 0;
  let locationStartCount = 0;
  let locationStopCount = 0;
  let locationStopActiveCount = 0;
  let audioStopCount = 0;
  let audioUnloadCount = 0;
  let audioReleaseSessionCount = 0;
  const audioSeekPositions: number[] = [];
  let audioStateListener: ((state: typeof audioState) => void) | undefined;
  let audioUserPauseListener: ((state: typeof audioState) => void | Promise<void>) | undefined;
  let audioUserPlayListener: ((state: typeof audioState) => void | Promise<void>) | undefined;
  let audioLoadMetadata: Record<string, unknown> | undefined;
  let audioLoadPositionMs: number | undefined;
  let audioGetStateOverride: (() => Promise<typeof audioState>) | null = null;
  let failNextSessionSave = false;
  let locationCallback: ((sample: Record<string, unknown>) => Promise<void> | void) | null = null;
  let activeStoredSession: Record<string, any> | null = null;
  let storedSessions: Record<string, any>[] = [];
  let accessOverride: (() => Promise<Record<string, unknown>>) | null = null;
  let bundleOverride: (() => Promise<Record<string, unknown>>) | null = null;
  let verifyOverride: (() => Promise<boolean>) | null = null;
  let bundleDownloadOptions: Record<string, unknown> | null = null;
  let privateBundleRemovalFailures = 0;
  let removedPrivateBundleIdentity: unknown[] | null = null;
  let removedPrivateAccessIdentity: unknown[] | null = null;

  const manifest = originalManifest();
  const bundle = {
    schema_version: 1,
    owner_scope: 'guest',
    pack_id: manifest.pack_id,
    version: manifest.version,
    manifest_id: manifest.manifest_id,
    manifest_sha256: 'manifest-sha',
    directory_uri: 'file:///originals/test/',
    manifest_uri: 'file:///originals/test/manifest.json',
    assets: [],
    map_pack_id: 'map:test',
    map_bytes: 0,
    total_bytes: 0,
    verified_at_ms: 1,
  };
  const audioState = {
    loaded: false,
    playing: false,
    buffering: false,
    paused_by_interruption: false,
    position_ms: 0,
    duration_ms: 60_000,
    did_finish: false,
  };
  const storeSession = (value: Record<string, any>) => {
    storedSessions = [
      value,
      ...storedSessions.filter(item => !(
        item.owner_scope === value.owner_scope
        && item.pack_id === value.pack_id
        && item.version === value.version
      )),
    ];
    return value;
  };
  const dependencies = {
    access: {
      async get() {
        if (accessOverride) return accessOverride();
        accessReads += 1;
        if (accessReads === 1) {
          return {
            owner_scope: 'account:admin-preview',
            access_type: 'admin_preview',
            manifest_id: manifest.manifest_id,
          };
        }
        accessEntered.resolve();
        return accessGate.promise;
      },
      async list() { return []; },
      async claimGuest() { guestClaimCount += 1; },
      async recordEntitlement() { entitlementWriteCount += 1; },
      async migrateGuestToAccount() { return []; },
      async removeAdminPreview(...args: unknown[]) {
        removedPrivateAccessIdentity = args;
        return { removed: true };
      },
    },
    bundles: {
      async get() { return bundleOverride ? bundleOverride() : bundle; },
      async verify() { return verifyOverride ? verifyOverride() : true; },
      async assetUri() { return 'file:///originals/test/story.mp3'; },
      async loadManifest() { return null; },
      async migrateGuestToAccount() {},
      async download(_manifest: unknown, options: Record<string, unknown>) {
        bundleDownloadOptions = options;
        return { ...bundle, owner_scope: options.ownerScope };
      },
      async removePrivatePreview(...args: unknown[]) {
        if (privateBundleRemovalFailures > 0) {
          privateBundleRemovalFailures -= 1;
          throw new Error('Injected exact private bundle removal failure.');
        }
        removedPrivateBundleIdentity = args;
        return { removed: true };
      },
    },
    sessions: {
      async load(scope: string, packId: string, version: number) {
        return storedSessions.find(item => (
          item.owner_scope === scope && item.pack_id === packId && item.version === version
        )) ?? null;
      },
      async loadActive() { return activeStoredSession; },
      async list(scope: string) { return storedSessions.filter(item => item.owner_scope === scope); },
      async save(value: Record<string, any>) {
        sessionSaveCount += 1;
        if (failNextSessionSave) {
          failNextSessionSave = false;
          throw new Error('Injected stopped-session save failure.');
        }
        return storeSession(value);
      },
      async setActive(value: Record<string, any> | null) {
        setActiveCount += 1;
        activeStoredSession = value ? storeSession(value) : null;
        return activeStoredSession;
      },
      async migrateGuestToAccount() { return []; },
    },
    location: {
      capabilities: { foreground: true, backgroundTask: true, androidForegroundService: true },
      async start(onLocation: (sample: Record<string, unknown>) => Promise<void> | void) {
        locationStartCount += 1;
        locationCallback = onLocation;
        return { permission: 'granted', stop: async () => { locationStopCount += 1; locationCallback = null; } };
      },
      async stopActive() { locationStopActiveCount += 1; locationCallback = null; },
    },
    audio: {
      capabilities: { backgroundPlayback: true, lockScreenControls: true },
      async load(_uri: string, options?: {
        positionMs?: number;
        metadata?: Record<string, unknown>;
        onState?: (state: typeof audioState) => void;
        onUserPause?: (state: typeof audioState) => void | Promise<void>;
        onUserPlay?: (state: typeof audioState) => void | Promise<void>;
      }) {
        audioLoadMetadata = options?.metadata;
        audioLoadPositionMs = options?.positionMs;
        audioStateListener = options?.onState;
        audioUserPauseListener = options?.onUserPause;
        audioUserPlayListener = options?.onUserPlay;
        audioState.loaded = true;
        audioState.position_ms = 0;
      },
      async play() { playCount += 1; audioState.playing = true; },
      async pause() {},
      async seek(positionMs: number) { audioSeekPositions.push(positionMs); audioState.position_ms = positionMs; },
      async setVolume() {},
      async stop() {
        audioStopCount += 1;
        audioState.playing = false;
        audioState.position_ms = 20_000;
        audioStateListener?.({ ...audioState });
      },
      async unload() {
        audioUnloadCount += 1;
        audioState.loaded = false;
        audioState.playing = false;
        audioStateListener = undefined;
        audioUserPauseListener = undefined;
        audioUserPlayListener = undefined;
      },
      async releaseSession() { audioReleaseSessionCount += 1; audioState.loaded = false; audioState.playing = false; },
      async getState() {
        return audioGetStateOverride ? audioGetStateOverride() : audioState;
      },
    },
  };

  let runtime: Runtime | null = null;
  let adminRuntime: AdminRuntime | null = null;
  function CaptureRuntime() {
    runtime = runtimeModule.useOriginalsRuntime();
    adminRuntime = runtimeModule.useOriginalsAdminRuntime();
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        runtimeModule.OriginalsRuntimeProvider,
        { dependencies },
        React.createElement(CaptureRuntime),
      ),
    );
  });
  assert.ok(runtime);
  globals.__originalsRuntimeAuthState = { user: { id: 'non-admin' }, token: 'user-token' };
  await assert.rejects(
    adminRuntime!.startSimulation(manifest),
    /available only to Trailhead admins/i,
  );
  assert.equal(locationStartCount, 0, 'a rejected lab launch cannot start native location');
  globals.__originalsRuntimeAuthState = { user: { id: 'admin-preview', is_admin: true }, token: 'admin-token' };
  await act(async () => { await adminRuntime!.startSimulation(manifest); });
  assert.equal(locationStartCount, 0, 'an admin lab session never starts native location');

  globals.__originalsRuntimeAuthState = { user: { id: 'non-admin' }, token: 'user-token' };
  await assert.rejects(
    adminRuntime!.submitLocationSample({
      lat: 0,
      lng: 0,
      accuracy_m: 10,
      timestamp_ms: 500,
    }),
    /admin Virtual Drive Lab session/i,
  );
  globals.__originalsRuntimeAuthState = { user: { id: 'admin-preview', is_admin: true }, token: 'admin-token' };

  await act(async () => {
    await adminRuntime!.submitLocationSample({
      lat: 0,
      lng: 0.001,
      accuracy_m: 10,
      heading_deg: 90,
      speed_mps: 10,
      timestamp_ms: 600,
    });
  });
  const waitingRuntime = runtime as unknown as Runtime;
  assert.equal(waitingRuntime.lastTriggerEvaluation?.decision.code, 'before_window');
  await assert.rejects(
    adminRuntime!.skipSimulationCue(),
    /capture a cue-specific failure/i,
    'an ahead cue cannot be marked failed through a stale or direct runtime call',
  );
  assert.deepEqual(waitingRuntime.session?.skipped_stop_ids, [], 'the waiting cue remains unmodified');

  await act(async () => {
    await adminRuntime!.submitLocationSample({
      lat: 0,
      lng: 0.0045,
      accuracy_m: 10,
      heading_deg: 90,
      speed_mps: 10,
      timestamp_ms: 1_000,
    });
  });
  let firstStop!: Promise<void>;
  let concurrentStop!: Promise<void>;
  await act(async () => {
    const triggeringSample = adminRuntime!.submitLocationSample({
      lat: 0,
      lng: 0.0045,
      accuracy_m: 10,
      heading_deg: 90,
      speed_mps: 10,
      timestamp_ms: 4_100,
    });
    await accessEntered.promise;

    firstStop = runtime!.stopTour();
    concurrentStop = runtime!.stopTour();
    assert.strictEqual(concurrentStop, firstStop, 'concurrent stop calls coalesce onto one cleanup promise');

    accessGate.resolve({
      owner_scope: 'account:admin-preview',
      access_type: 'admin_preview',
      manifest_id: manifest.manifest_id,
    });
    await Promise.all([firstStop, concurrentStop, triggeringSample]);
  });

  assert.equal(playCount, 0, 'an in-flight cue cannot play after stop invalidates its generation');
  assert.equal(sessionSaveCount, 0, 'the ephemeral simulation session is never persisted by stop');
  assert.equal(setActiveCount, 0, 'the ephemeral simulation session never replaces durable active state');
  assert.equal(globals.__originalsRuntimeAnalyticsCount, 0, 'synthetic lab activity never emits production analytics');
  assert.equal(globals.__originalsRuntimeCarSyncCount, 0, 'synthetic lab activity never replaces the real Android Auto route');
  assert.equal(globals.__originalsRuntimeCarClearCount, 0, 'ending the lab never clears the real Android Auto route');

  accessOverride = async () => ({
    owner_scope: 'account:admin-preview',
    access_type: 'admin_preview',
    manifest_id: manifest.manifest_id,
  });
  globals.__originalsRuntimeCleanupIdentity = {
    schema_version: 1,
    owner_scope: 'account:admin-preview',
    pack_id: manifest.pack_id,
    version: manifest.version,
    manifest_id: manifest.manifest_id,
    created_at_ms: Date.now(),
  };
  globals.__originalsRuntimePreviewToken = 'stored-preview-token';
  await act(async () => { await runtime!.downloadOriginal(manifest); });
  const recordedDownloadOptions = bundleDownloadOptions as unknown as Record<string, unknown>;
  const downloadHeaders = recordedDownloadOptions.headers as Record<string, string> | undefined;
  assert.equal(recordedDownloadOptions.ownerScope, 'account:admin-preview', 'preview headers never change ownership scope');
  assert.equal(
    recordedDownloadOptions.privatePreviewManifestId,
    manifest.manifest_id,
    'private downloads carry the exact durable cleanup identity into bundle journaling',
  );
  assert.equal(downloadHeaders?.Authorization, 'Bearer admin-token');
  assert.equal(
    downloadHeaders?.['X-Trailhead-Originals-Preview'],
    'stored-preview-token',
    'runtime asset GETs receive the stored internal preview credential',
  );
  assert.equal(globals.__originalsRuntimeAnalyticsCount, 0, 'admin preview downloads never emit production analytics');

  await act(async () => { await adminRuntime!.startSimulation(manifest); });
  assert.equal(adminRuntime!.privateReviewActive, true, 'exact bound admin access enables private review');
  globals.__originalsRuntimePreviewToken = 'stored-preview-token';
  privateBundleRemovalFailures = 1;
  let firstCleanupFailure: unknown;
  await act(async () => {
    const firstCleanup = adminRuntime!.endPrivateReview();
    const concurrentCleanup = adminRuntime!.endPrivateReview();
    assert.strictEqual(
      concurrentCleanup,
      firstCleanup,
      'concurrent private cleanup calls coalesce onto one exact mutation',
    );
    try {
      await firstCleanup;
    } catch (error) {
      firstCleanupFailure = error;
    }
  });
  assert.match(String(firstCleanupFailure), /Injected exact private bundle removal failure/);
  assert.equal(globals.__originalsRuntimePreviewToken, null, 'the credential closes before destructive cleanup');
  assert.equal(adminRuntime!.privateReviewActive, false);
  assert.equal(adminRuntime!.privateReviewCleanupPending, true, 'partial cleanup retains an exact retry identity');
  assert.equal(
    (runtime as unknown as Runtime).session,
    null,
    'private review playback is stopped before files are removed',
  );
  await act(async () => { await adminRuntime!.endPrivateReview(); });
  const expectedPrivateIdentity = [
    'account:admin-preview',
    manifest.pack_id,
    manifest.version,
    manifest.manifest_id,
  ];
  assert.deepEqual(removedPrivateBundleIdentity, expectedPrivateIdentity);
  assert.deepEqual(removedPrivateAccessIdentity, expectedPrivateIdentity);
  assert.equal(globals.__originalsRuntimePreviewClearCount, 2, 'credential removal remains idempotent on retry');
  assert.equal(adminRuntime!.privateReviewCleanupPending, false);
  assert.equal(globals.__originalsRuntimeCleanupIdentity, null, 'the durable marker clears only after exact local cleanup succeeds');

  globals.__originalsRuntimeCleanupIdentity = {
    schema_version: 1,
    owner_scope: 'account:admin-preview',
    pack_id: manifest.pack_id,
    version: manifest.version,
    manifest_id: manifest.manifest_id,
    created_at_ms: Date.now(),
  };
  await act(async () => { await adminRuntime!.startSimulation(manifest); });
  globals.__originalsRuntimeAuthState = {
    user: { id: 'admin-preview', is_admin: false },
    token: null,
  };
  await act(async () => { await adminRuntime!.endPrivateReview(); });
  assert.equal(
    globals.__originalsRuntimeCleanupIdentity,
    null,
    'same-process privilege/token revocation still permits exact owner-bound cleanup',
  );
  assert.equal(adminRuntime!.privateReviewCleanupPending, false);
  globals.__originalsRuntimeAuthState = {
    user: { id: 'admin-preview', is_admin: true },
    token: 'admin-token',
  };

  removedPrivateBundleIdentity = null;
  removedPrivateAccessIdentity = null;
  globals.__originalsRuntimeCleanupIdentity = {
    schema_version: 1,
    owner_scope: 'account:admin-preview',
    pack_id: manifest.pack_id,
    version: manifest.version,
    manifest_id: manifest.manifest_id,
    created_at_ms: Date.now(),
  };
  globals.__originalsRuntimeAuthState = {
    user: { id: 'admin-preview', is_admin: false },
    token: null,
  };
  await act(async () => { renderer!.unmount(); });
  runtime = null;
  adminRuntime = null;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        runtimeModule.OriginalsRuntimeProvider,
        { dependencies },
        React.createElement(CaptureRuntime),
      ),
    );
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.deepEqual(
    removedPrivateBundleIdentity,
    expectedPrivateIdentity,
    'a process restart resumes exact cleanup even after admin privilege and token loss',
  );
  assert.deepEqual(removedPrivateAccessIdentity, expectedPrivateIdentity);
  assert.equal(globals.__originalsRuntimeCleanupIdentity, null);
  assert.equal(adminRuntime!.privateReviewCleanupPending, false);

  removedPrivateBundleIdentity = null;
  removedPrivateAccessIdentity = null;
  globals.__originalsRuntimeCleanupIdentity = {
    schema_version: 1,
    owner_scope: 'account:admin-preview',
    pack_id: manifest.pack_id,
    version: manifest.version,
    manifest_id: manifest.manifest_id,
    created_at_ms: Date.now(),
  };
  globals.__originalsRuntimeAuthState = {
    user: { id: 'different-account', is_admin: true },
    token: 'different-token',
  };
  await act(async () => { renderer!.unmount(); });
  runtime = null;
  adminRuntime = null;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        runtimeModule.OriginalsRuntimeProvider,
        { dependencies },
        React.createElement(CaptureRuntime),
      ),
    );
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(removedPrivateBundleIdentity, null, 'restart recovery never crosses account ownership');
  assert.equal(removedPrivateAccessIdentity, null);
  assert.equal(
    globals.__originalsRuntimeCleanupIdentity?.owner_scope,
    'account:admin-preview',
    'the owner-bound marker remains available for the correct account',
  );
  globals.__originalsRuntimeCleanupIdentity = null;
  globals.__originalsRuntimeAuthState = { user: { id: 'admin-preview', is_admin: true }, token: 'admin-token' };
  accessOverride = null;
  globals.__originalsRuntimePreviewToken = null;

  sessionSaveCount = 0;
  setActiveCount = 0;
  locationStopCount = 0;
  locationStopActiveCount = 0;
  audioStopCount = 0;
  audioUnloadCount = 0;
  audioReleaseSessionCount = 0;
  const headlessStopsBeforeRealTour = globals.__originalsRuntimeHeadlessStopCount ?? 0;
  const carClearsBeforeRealTour = globals.__originalsRuntimeCarClearCount ?? 0;
  globals.__originalsRuntimeAuthState = { user: { id: 'driver' }, token: 'driver-token' };
  accessOverride = async () => ({ owner_scope: 'account:driver', access_type: 'entitled' });
  bundleOverride = async () => ({ ...bundle, owner_scope: 'account:driver' });
  verifyOverride = async () => true;
  await act(async () => { await runtime!.startTour(manifest); });
  assert.equal(locationStartCount, 1, 'a real tour starts the native location adapter');
  assert.ok(locationCallback);
  await act(async () => {
    await locationCallback!({
      lat: 0,
      lng: 0.0045,
      accuracy_m: 10,
      heading_deg: 90,
      speed_mps: 10,
      timestamp_ms: 10_000,
    });
    await locationCallback!({
      lat: 0,
      lng: 0.0045,
      accuracy_m: 10,
      heading_deg: 90,
      speed_mps: 10,
      timestamp_ms: 13_100,
    });
  });
  assert.equal(playCount, 1, 'the real tour reached active narration before teardown');
  assert.equal(audioLoadMetadata?.title, 'Story 1', 'lock-screen metadata uses the current story title');
  assert.equal(audioLoadMetadata?.albumTitle, manifest.title);
  assert.equal(audioLoadMetadata?.artworkUrl, undefined, 'artwork metadata is omitted when the authored stop has none');
  assert.ok(audioUserPauseListener && audioUserPlayListener);
  audioState.playing = false;
  audioState.position_ms = 3_895;
  await act(async () => {
    await audioUserPauseListener?.({ ...audioState });
  });
  assert.equal((activeStoredSession as Record<string, any> | null)?.status, 'paused');
  assert.equal((activeStoredSession as Record<string, any> | null)?.user_paused, true);
  const startsBeforeLockScreenResume = locationStartCount;
  audioState.playing = true;
  await act(async () => {
    await audioUserPlayListener?.({ ...audioState });
  });
  assert.equal(
    (activeStoredSession as Record<string, any> | null)?.status,
    'active',
    'lock-screen Play re-arms the active tour',
  );
  assert.equal(
    (activeStoredSession as Record<string, any> | null)?.user_paused,
    false,
    'lock-screen Play clears the durable user-pause gate',
  );
  assert.equal(
    locationStartCount,
    startsBeforeLockScreenResume + 1,
    'lock-screen Play restarts active-tour location delivery',
  );
  const foregroundSession = activeStoredSession as unknown as Record<string, any>;
  activeStoredSession = storeSession({
    ...foregroundSession,
    status: 'completed',
    current_stop_id: null,
    current_audio_position_ms: 12_345,
    completed_stop_ids: manifest.stops.map(stop => stop.id),
    completed_at_ms: foregroundSession.updated_at_ms + 2,
    updated_at_ms: foregroundSession.updated_at_ms + 2,
  });
  await act(async () => {
    globals.__originalsRuntimeAppStateListener?.('active');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  const reconciledRuntime = runtime as unknown as Runtime;
  assert.equal(
    reconciledRuntime.session?.status,
    'completed',
    'foreground activation reconciles a newer session completed by the background runtime',
  );
  assert.equal(reconciledRuntime.state, 'completed');
  audioState.position_ms = 12_345;
  await act(async () => { await runtime!.stopTour(); });
  const stoppedSession = storedSessions.find(item => item.owner_scope === 'account:driver');
  assert.equal(stoppedSession?.status, 'stopped');
  assert.equal(stoppedSession?.current_audio_position_ms, 12_345, 'End tour persists the exact narration position');
  assert.equal(activeStoredSession, null, 'End tour clears the durable active pointer');
  const stoppedRuntime = runtime as unknown as Runtime;
  assert.equal(stoppedRuntime.session, null, 'End tour removes the main-map player immediately');
  assert.equal(stoppedRuntime.state, 'idle');
  assert.ok(locationStopCount >= 1, 'End tour calls the attached location stop closure');
  assert.ok(locationStopActiveCount >= 1, 'End tour stops a persisted native background task');
  assert.ok(audioStopCount >= 2 && audioUnloadCount >= 2, 'End tour performs an idempotent audio teardown');
  assert.equal(audioReleaseSessionCount, 1, 'End tour deactivates the native audio session');
  assert.equal(globals.__originalsRuntimeHeadlessStopCount, headlessStopsBeforeRealTour + 1);
  assert.equal(globals.__originalsRuntimeCarClearCount, carClearsBeforeRealTour + 1, 'End tour clears Android Auto route context');

  await act(async () => { renderer!.unmount(); });
  runtime = null;
  adminRuntime = null;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        runtimeModule.OriginalsRuntimeProvider,
        { dependencies },
        React.createElement(CaptureRuntime),
      ),
    );
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(runtime!.session, null, 'a stopped latest session stays closed after a cold relaunch');
  assert.equal(runtime!.state, 'idle');

  await act(async () => { await runtime!.startTour(manifest); });
  failNextSessionSave = true;
  const carClearsBeforeFailedSave = globals.__originalsRuntimeCarClearCount ?? 0;
  let stopFailure: unknown;
  await act(async () => {
    try {
      await runtime!.stopTour();
    } catch (error) {
      stopFailure = error;
    }
  });
  assert.match(String(stopFailure), /Injected stopped-session save failure/);
  assert.equal(activeStoredSession, null, 'active-pointer cleanup still runs when stopped-history persistence fails');
  assert.equal(
    globals.__originalsRuntimeCarClearCount,
    carClearsBeforeFailedSave + 1,
    'car cleanup still runs when stopped-history persistence fails',
  );
  assert.equal(runtime!.session, null);

  await act(async () => { renderer!.unmount(); });
  runtime = null;
  adminRuntime = null;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        runtimeModule.OriginalsRuntimeProvider,
        { dependencies },
        React.createElement(CaptureRuntime),
      ),
    );
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(runtime!.session, null, 'a cleared active pointer cannot resurrect historical active state after a save failure');
  const unionManifest = originalManifestV2();
  globals.__originalsRuntimeAuthState = { user: { id: 'driver' }, token: 'driver-token' };
  accessOverride = async () => ({ owner_scope: 'account:driver', access_type: 'entitled' });
  bundleOverride = async () => ({
    ...bundle,
    owner_scope: 'account:driver',
    pack_id: unionManifest.pack_id,
    version: unionManifest.version,
    manifest_id: unionManifest.manifest_id,
    manifest_schema_version: 2,
  });
  verifyOverride = async () => true;
  await act(async () => {
    await runtime!.startTour(unionManifest, {
      chapter_id: 'mountain-crossing',
      variant_id: 'westbound',
    });
  });
  const startedV2Session = (runtime as unknown as Runtime).session;
  assert.equal(startedV2Session?.chapter_selection?.chapter_id, 'mountain-crossing');
  assert.equal(startedV2Session?.chapter_selection?.variant_id, 'westbound');
  assert.equal(runtime!.manifest?.route.direction, 'reverse', 'foreground start compiles the selected V2 route');
  await act(async () => { await runtime!.stopTour(); });

  const v3Manifest = originalManifestV3();
  const v3Compiled = compileOriginalManifestV3(v3Manifest, {
    chapter_id: 'mountain-crossing',
    variant_id: 'eastbound',
  });
  const parkedStory = v3Compiled.selectable.items.find(item => (
    item.delivery.mode === 'stopped_deeper'
    && item.delivery.availability === 'before_route_user_confirmed_parked'
  ));
  const landmarkStory = v3Compiled.selectable.items.find(item => (
    item.delivery.mode === 'stopped_deeper'
    && item.delivery.availability === 'at_landmark_user_confirmed_parked'
  ));
  assert(parkedStory && landmarkStory);
  const persistedExplicit = {
    ...createOriginalSession(
      v3Compiled.manifest,
      'account:driver',
      61_000,
      { schema_version: 1, ...v3Compiled.selection },
    ),
    status: 'ready' as const,
    started_at_ms: 61_000,
    long_form: {
      ...createOriginalLongFormSession(v3Compiled.selectable, 61_000),
      current_item_id: parkedStory.id,
      current_audio_position_ms: 23_456,
      current_selection_origin: 'user_explicit' as const,
    },
  };
  storedSessions = [persistedExplicit];
  bundleOverride = async () => ({
    ...bundle,
    owner_scope: 'account:driver',
    pack_id: v3Manifest.pack_id,
    version: v3Manifest.version,
    manifest_id: v3Manifest.manifest_id,
    manifest_schema_version: 3,
  });
  const playsBeforeV3ForegroundResume = playCount;
  await act(async () => {
    await runtime!.startTour(v3Manifest, {
      chapter_id: 'mountain-crossing',
      variant_id: 'eastbound',
    });
  });
  assert.equal(playCount, playsBeforeV3ForegroundResume + 1);
  assert.equal(audioLoadPositionMs, 23_456, 'foreground Resume restores the exact selected-story position');
  assert.equal((runtime as unknown as Runtime).session?.long_form?.current_item_id, parkedStory.id);
  const slowForegroundAudio = deferred<typeof audioState>();
  audioGetStateOverride = () => slowForegroundAudio.promise;
  const headlessStopsBeforeSlowAudio = globals.__originalsRuntimeHeadlessStopCount ?? 0;
  const delayedForegroundStop = runtime!.stopTour();
  assert.equal(
    globals.__originalsRuntimeHeadlessStopCount,
    headlessStopsBeforeSlowAudio + 1,
    'End Tour disables the cold runtime before a slow foreground audio-state read settles',
  );
  await Promise.resolve();
  assert.equal(
    (runtime as unknown as Runtime).session?.long_form?.current_item_id,
    parkedStory.id,
    'the foreground stop remains in flight while native audio state is delayed',
  );
  slowForegroundAudio.resolve(audioState);
  await act(async () => { await delayedForegroundStop; });
  audioGetStateOverride = null;

  const staleLandmarkNow = Date.now();
  storedSessions = [{
    ...createOriginalSession(
      v3Compiled.manifest,
      'account:driver',
      staleLandmarkNow - 3_000,
      { schema_version: 1, ...v3Compiled.selection },
    ),
    status: 'ready' as const,
    started_at_ms: staleLandmarkNow - 3_000,
    last_location_timestamp_ms: staleLandmarkNow - 1_000,
    long_form: createOriginalLongFormSession(v3Compiled.selectable, staleLandmarkNow - 3_000),
  }];
  await act(async () => {
    await runtime!.startTour(v3Manifest, {
      chapter_id: 'mountain-crossing',
      variant_id: 'eastbound',
    });
  });
  assert(locationCallback);
  await act(async () => {
    await locationCallback!({
      lat: landmarkStory.coordinates?.lat,
      lng: landmarkStory.coordinates?.lng,
      accuracy_m: 5,
      heading_deg: 0,
      speed_mps: 0,
      timestamp_ms: staleLandmarkNow - 2_000,
    });
  });
  await assert.rejects(
    () => runtime!.playLongFormItem(landmarkStory.id, { userConfirmedParked: true }),
    /not available from the current stop/i,
    'a delayed fix rejected by the hard engine cannot authorize a landmark story after restore',
  );
  await act(async () => { await runtime!.stopTour(); });
  accessOverride = null;
  bundleOverride = null;
  verifyOverride = null;

  globals.__originalsRuntimeAuthState = { user: null, token: null };
  const ownershipRuntime = runtime as unknown as Runtime;

  const guestAcquireEntered = deferred<void>();
  const guestAcquireGate = deferred<unknown>();
  let acquireOptions: Record<string, unknown> | undefined;
  globals.__originalsRuntimeAcquire = async (_id, options) => {
    acquireOptions = options as Record<string, unknown>;
    guestAcquireEntered.resolve();
    return guestAcquireGate.promise;
  };
  const staleGuestAcquire = ownershipRuntime.acquireOriginal('moab-original', 1);
  await guestAcquireEntered.promise;
  globals.__originalsRuntimeAuthState = { user: { id: 'account-b' }, token: 'token-b' };
  globals.__originalsRuntimeEpoch = 1;
  guestAcquireGate.resolve({
    guest_access: true,
    access_type: 'guest_free',
    pack: { id: 'moab-original', version: 1 },
    manifest_path: '/manifest',
  });
  await assert.rejects(staleGuestAcquire, /account changed/i);
  assert.equal(acquireOptions?.authToken, null, 'a logical guest acquire is pinned to guest auth');
  assert.equal(guestClaimCount, 0, 'a stale guest acquire cannot write access after sign-in');

  const featuredEntered = deferred<void>();
  const featuredGate = deferred<unknown>();
  let featuredToken: unknown;
  globals.__originalsRuntimeAuthState = { user: { id: 'account-a' }, token: 'token-a' };
  globals.__originalsRuntimeEpoch = 2;
  globals.__originalsRuntimeClaimFeatured = async (_key, _signal, authToken) => {
    featuredToken = authToken;
    featuredEntered.resolve();
    return featuredGate.promise;
  };
  const staleFeaturedClaim = ownershipRuntime.claimFeaturedOriginal('featured:test');
  await featuredEntered.promise;
  globals.__originalsRuntimeEpoch = 3;
  featuredGate.resolve({
    entitlement: { pack_id: 'moab-original', version: 1 },
    pack: { id: 'moab-original', version: 1 },
    trip: {},
    already_owned: false,
    replayed: false,
    credit_balance: 0,
  });
  await assert.rejects(staleFeaturedClaim, /account changed/i);
  assert.equal(featuredToken, 'token-a', 'a featured claim uses the token captured at start');
  assert.equal(entitlementWriteCount, 0, 'a stale same-account epoch cannot persist featured ownership');

  let permanentAcquireOptions: Record<string, unknown> | undefined;
  globals.__originalsRuntimeAuthState = { user: { id: 'account-a' }, token: 'token-a' };
  globals.__originalsRuntimeEpoch = 3;
  globals.__originalsRuntimeAcquire = async (_id, options) => {
    permanentAcquireOptions = options as Record<string, unknown>;
    return {
      entitlement: {
        pack_id: 'smokies-original',
        version: 1,
        access_type: 'permanent',
        permanent: true,
      },
      pack: { id: 'smokies-original', version: 1 },
      trip: {},
      already_owned: false,
      replayed: false,
      credit_balance: 25,
      upgraded_to_permanent: true,
    };
  };
  const permanentAcquire = await ownershipRuntime.acquireOriginal(
    'smokies-original',
    1,
    'original:smokies-original:1:permanent',
    'permanent',
  );
  assert.equal(permanentAcquireOptions?.accessMode, 'permanent');
  assert.equal(permanentAcquireOptions?.idempotencyKey, 'original:smokies-original:1:permanent');
  assert.equal('guest_access' in permanentAcquire, false);
  assert.equal(entitlementWriteCount, 1, 'a confirmed permanent conversion persists exactly once');

  const verifyEntered = deferred<void>();
  const verifyGate = deferred<boolean>();
  accessOverride = async () => ({ owner_scope: 'account:account-a', access_type: 'entitled' });
  bundleOverride = async () => ({ ...bundle, owner_scope: 'account:account-a' });
  verifyOverride = async () => {
    verifyEntered.resolve();
    return verifyGate.promise;
  };
  globals.__originalsRuntimeAuthState = { user: { id: 'account-a' }, token: 'token-a' };
  globals.__originalsRuntimeEpoch = 3;
  const locationStartsBeforeStaleActivation = locationStartCount;
  const staleStart = ownershipRuntime.startTour(manifest);
  await verifyEntered.promise;
  globals.__originalsRuntimeAuthState = { user: { id: 'account-b' }, token: 'token-b' };
  globals.__originalsRuntimeEpoch = 4;
  verifyGate.resolve(true);
  await assert.rejects(staleStart, /account changed/i);
  assert.equal(
    locationStartCount,
    locationStartsBeforeStaleActivation,
    'a stale activation never starts background location',
  );

  await act(async () => { renderer!.unmount(); });
  console.log('Originals runtime stop-race regression tests passed.');
}

void main();
