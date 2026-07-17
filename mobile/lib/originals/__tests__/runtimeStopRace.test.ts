import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { originalManifest } from './fixtures';

type Runtime = import('../runtime').OriginalsRuntimeValue;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nativeRuntimeStubs: Record<string, string> = {
  '../store': `
    const state = { user: null };
    export function useStore(selector) { return selector(state); }
    useStore.getState = () => state;
  `,
  '../storage': `
    export const accountStorage = { epoch: () => 0 };
    export const storage = { get: async () => null };
  `,
  './api': `
    export const originalsApi = {
      acquire: async () => { throw new Error('unused'); },
      claimFeatured: async () => { throw new Error('unused'); },
    };
  `,
  './analytics': `
    export const ORIGINALS_ANALYTICS_EVENTS = { downloadResult: 'download', stopOutcome: 'stop' };
    export function trackOriginalsAnalyticsEvent() {}
  `,
  './audioAdapter': `
    export const expoAudioOriginalAudioAdapter = {};
  `,
  './locationAdapter': `
    export const expoOriginalLocationAdapter = {};
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
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const runtimeModule = await loadRuntimeModule();
  const accessGate = deferred<Record<string, unknown>>();
  const accessEntered = deferred<void>();
  let accessReads = 0;
  let playCount = 0;
  let sessionSaveCount = 0;
  let setActiveCount = 0;

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
        accessReads += 1;
        if (accessReads === 1) {
          return { owner_scope: 'guest', access_type: 'guest_free' };
        }
        accessEntered.resolve();
        return accessGate.promise;
      },
      async list() { return []; },
      async migrateGuestToAccount() { return []; },
    },
    bundles: {
      async get() { return bundle; },
      async verify() { return true; },
      async assetUri() { return 'file:///originals/test/story.mp3'; },
      async loadManifest() { return null; },
      async migrateGuestToAccount() {},
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
      async start() { return { permission: 'granted', stop: async () => {} }; },
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
  function CaptureRuntime() {
    runtime = runtimeModule.useOriginalsRuntime();
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
  await act(async () => { await runtime!.startSimulation(manifest); });

  await act(async () => {
    await runtime!.submitLocationSample({
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
    const triggeringSample = runtime!.submitLocationSample({
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

    accessGate.resolve({ owner_scope: 'guest', access_type: 'guest_free' });
    await Promise.all([firstStop, concurrentStop, triggeringSample]);
  });

  assert.equal(playCount, 0, 'an in-flight cue cannot play after stop invalidates its generation');
  assert.equal(sessionSaveCount, 0, 'the ephemeral simulation session is never persisted by stop');
  assert.equal(setActiveCount, 0, 'the ephemeral simulation session never replaces durable active state');

  await act(async () => { renderer!.unmount(); });
  console.log('Originals runtime stop-race regression tests passed.');
}

void main();
