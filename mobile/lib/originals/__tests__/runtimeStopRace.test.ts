import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { originalManifest } from './fixtures';

type Runtime = import('../runtime').OriginalsRuntimeValue;
type AdminRuntime = import('../runtime').OriginalsAdminRuntimeValue;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nativeRuntimeStubs: Record<string, string> = {
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
  './previewAccess': `
    export async function getOriginalPreviewToken() {
      return globalThis.__originalsRuntimePreviewToken || null;
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
    __originalsRuntimeAcquire?: (...args: unknown[]) => Promise<unknown>;
    __originalsRuntimeClaimFeatured?: (...args: unknown[]) => Promise<unknown>;
    __originalsRuntimeAnalyticsCount?: number;
    __originalsRuntimeCarSyncCount?: number;
    __originalsRuntimeCarClearCount?: number;
  };
  globals.__originalsRuntimeAuthState = { user: { id: 'admin-preview', is_admin: true }, token: 'admin-token' };
  globals.__originalsRuntimeEpoch = 0;
  globals.__originalsRuntimePreviewToken = null;
  globals.__originalsRuntimeAcquire = async () => { throw new Error('unused'); };
  globals.__originalsRuntimeClaimFeatured = async () => { throw new Error('unused'); };
  globals.__originalsRuntimeAnalyticsCount = 0;
  globals.__originalsRuntimeCarSyncCount = 0;
  globals.__originalsRuntimeCarClearCount = 0;
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
  let accessOverride: (() => Promise<Record<string, unknown>>) | null = null;
  let bundleOverride: (() => Promise<Record<string, unknown>>) | null = null;
  let verifyOverride: (() => Promise<boolean>) | null = null;
  let bundleDownloadOptions: Record<string, unknown> | null = null;

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
  const dependencies = {
    access: {
      async get() {
        if (accessOverride) return accessOverride();
        accessReads += 1;
        if (accessReads === 1) {
          return { owner_scope: 'account:admin-preview', access_type: 'admin_preview' };
        }
        accessEntered.resolve();
        return accessGate.promise;
      },
      async list() { return []; },
      async claimGuest() { guestClaimCount += 1; },
      async recordEntitlement() { entitlementWriteCount += 1; },
      async migrateGuestToAccount() { return []; },
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
    },
    sessions: {
      async load() { return null; },
      async loadActive() { return null; },
      async list() { return []; },
      async save(value: unknown) { sessionSaveCount += 1; return value; },
      async setActive(value: unknown) { setActiveCount += 1; return value; },
      async migrateGuestToAccount() { return []; },
    },
    location: {
      capabilities: { foreground: true, backgroundTask: true, androidForegroundService: true },
      async start() { locationStartCount += 1; return { permission: 'granted', stop: async () => {} }; },
      async stopActive() {},
    },
    audio: {
      capabilities: { backgroundPlayback: true, lockScreenControls: true },
      async load() {},
      async play() { playCount += 1; },
      async pause() {},
      async seek() {},
      async setVolume() {},
      async stop() {},
      async unload() {},
      async getState() { return audioState; },
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

    accessGate.resolve({ owner_scope: 'account:admin-preview', access_type: 'admin_preview' });
    await Promise.all([firstStop, concurrentStop, triggeringSample]);
  });

  assert.equal(playCount, 0, 'an in-flight cue cannot play after stop invalidates its generation');
  assert.equal(sessionSaveCount, 0, 'the ephemeral simulation session is never persisted by stop');
  assert.equal(setActiveCount, 0, 'the ephemeral simulation session never replaces durable active state');
  assert.equal(globals.__originalsRuntimeAnalyticsCount, 0, 'synthetic lab activity never emits production analytics');
  assert.equal(globals.__originalsRuntimeCarSyncCount, 0, 'synthetic lab activity never replaces the real Android Auto route');
  assert.equal(globals.__originalsRuntimeCarClearCount, 0, 'ending the lab never clears the real Android Auto route');

  accessOverride = async () => ({ owner_scope: 'account:admin-preview', access_type: 'admin_preview' });
  globals.__originalsRuntimePreviewToken = 'stored-preview-token';
  await act(async () => { await runtime!.downloadOriginal(manifest); });
  const recordedDownloadOptions = bundleDownloadOptions as unknown as Record<string, unknown>;
  const downloadHeaders = recordedDownloadOptions.headers as Record<string, string> | undefined;
  assert.equal(recordedDownloadOptions.ownerScope, 'account:admin-preview', 'preview headers never change ownership scope');
  assert.equal(downloadHeaders?.Authorization, 'Bearer admin-token');
  assert.equal(
    downloadHeaders?.['X-Trailhead-Originals-Preview'],
    'stored-preview-token',
    'runtime asset GETs receive the stored internal preview credential',
  );
  assert.equal(globals.__originalsRuntimeAnalyticsCount, 0, 'admin preview downloads never emit production analytics');
  accessOverride = null;
  globals.__originalsRuntimePreviewToken = null;

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
  const staleStart = ownershipRuntime.startTour(manifest);
  await verifyEntered.promise;
  globals.__originalsRuntimeAuthState = { user: { id: 'account-b' }, token: 'token-b' };
  globals.__originalsRuntimeEpoch = 4;
  verifyGate.resolve(true);
  await assert.rejects(staleStart, /account changed/i);
  assert.equal(locationStartCount, 0, 'a stale activation never starts background location');

  await act(async () => { renderer!.unmount(); });
  console.log('Originals runtime stop-race regression tests passed.');
}

void main();
