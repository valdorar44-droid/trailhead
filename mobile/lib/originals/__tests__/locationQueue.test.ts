import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { createOriginalLocationQueue, type OriginalLocationQueueStorage } from '../locationQueue';
import {
  backgroundLocationStartMessage,
  IOS_LOCKED_SCREEN_LOCATION_MESSAGE,
  originalStartNeedsPermissionDisclosure,
  requireIosLockedScreenPermission,
} from '../locationPolicy';
import type { OriginalLocationSample } from '../types';

type PendingPrivateWatch = {
  callback: (location: Record<string, any>) => void;
  resolve: (subscription: { remove: () => void }) => void;
};

const locationAdapterNativeStubs: Record<string, string> = {
  'expo-location': `
    export const Accuracy = { BestForNavigation: 6 };
    export const ActivityType = { AutomotiveNavigation: 1 };
    export async function hasStartedLocationUpdatesAsync() { return false; }
    export async function getForegroundPermissionsAsync() { return { status: 'granted' }; }
    export async function requestForegroundPermissionsAsync() { return { status: 'granted' }; }
    export async function getBackgroundPermissionsAsync() { return { status: 'denied' }; }
    export async function requestBackgroundPermissionsAsync() { return { status: 'denied' }; }
    export async function watchPositionAsync(_options, callback) {
      return new Promise(resolve => {
        globalThis.__privateForegroundWatchRequests.push({ callback, resolve });
      });
    }
    export async function startLocationUpdatesAsync() { throw new Error('background start is forbidden'); }
    export async function stopLocationUpdatesAsync() { throw new Error('background stop is forbidden'); }
  `,
  'expo-task-manager': `
    export function isTaskDefined() { return true; }
    export function defineTask() { throw new Error('task definition is forbidden in this test'); }
  `,
  'expo-file-system/legacy': `
    export const documentDirectory = 'file:///test/';
    export const cacheDirectory = 'file:///cache/';
    export async function getInfoAsync() { return { exists: false, isDirectory: false }; }
    export async function readAsStringAsync() { return null; }
    export async function makeDirectoryAsync() {}
    export async function deleteAsync() {}
    export async function writeAsStringAsync() {}
    export async function moveAsync() {}
  `,
  'react-native': `export const Platform = { OS: 'android' };`,
  './headlessRuntime': `
    export async function processHeadlessOriginalLocationSamples() {
      throw new Error('headless processing is forbidden');
    }
  `,
};

const stubLocationAdapterNativeModules: Plugin = {
  name: 'stub-location-adapter-native-modules',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => (
      Object.hasOwn(locationAdapterNativeStubs, args.path)
        ? { path: args.path, namespace: 'location-adapter-stub' }
        : null
    ));
    builder.onLoad({ filter: /.*/, namespace: 'location-adapter-stub' }, args => ({
      contents: locationAdapterNativeStubs[args.path],
      loader: 'js',
    }));
  },
};

async function loadLocationAdapterModule() {
  const result = await build({
    entryPoints: [path.resolve('lib/originals/locationAdapter.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    write: false,
    plugins: [stubLocationAdapterNativeModules],
  });
  const output = result.outputFiles[0]?.text;
  assert.ok(output);
  const require = createRequire(import.meta.url);
  const module = { exports: {} as Record<string, unknown> };
  const evaluate = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
  evaluate(require, module, module.exports, path.resolve('lib/originals/locationAdapter.test.cjs'), process.cwd());
  return module.exports as {
    createExpoOriginalLocationAdapter: () => {
      startPrivateForeground: (
        callback: (sample: OriginalLocationSample) => void | Promise<void>,
      ) => Promise<{ stop: () => Promise<void>; permission: string }>;
    };
  };
}

async function waitForPrivateWatchCount(requests: PendingPrivateWatch[], expected: number) {
  for (let attempt = 0; attempt < 20 && requests.length < expected; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(requests.length, expected, `expected ${expected} pending foreground watches`);
}

function memoryStorage(): OriginalLocationQueueStorage & { value: string | null } {
  return {
    value: null,
    async read() { return this.value; },
    async write(value) { this.value = value; },
    async remove() { this.value = null; },
  };
}

const now = 1_800_000_000_000;
const sample = (timestamp: number, lat = 38.5): OriginalLocationSample => ({
  lat,
  lng: -109.5,
  accuracy_m: 12,
  heading_deg: 20,
  speed_mps: 16,
  timestamp_ms: timestamp,
});

async function main() {
  const storage = memoryStorage();
  const queue = createOriginalLocationQueue(storage, {
    now: () => now,
    ttlMs: 60 * 60 * 1000,
    maxSamples: 3,
    checkpointEvery: 1,
  });

  await queue.enqueue([
    sample(now - 3_000, 38.1),
    sample(now - 1_000, 38.3),
    sample(now - 2_000, 38.2),
    sample(now - 2_000, 38.2),
    sample(now - 2 * 60 * 60 * 1000, 37),
  ]);
  assert.equal(await queue.count(), 3, 'queue deduplicates, bounds, and expires fixes');

  const delivered: number[] = [];
  await queue.drain(next => { delivered.push(next.timestamp_ms); });
  assert.deepEqual(delivered, [now - 3_000, now - 2_000, now - 1_000]);
  assert.equal(storage.value, null, 'successful drain removes raw coordinates');

  await queue.enqueue([sample(now - 2_000), sample(now - 1_000)]);
  await assert.rejects(queue.drain(next => {
    if (next.timestamp_ms === now - 1_000) throw new Error('callback unavailable');
  }), /callback unavailable/);
  assert.equal(await queue.count(), 1, 'failed and subsequent fixes remain durable');
  await queue.clear();
  assert.equal(await queue.count(), 0);

  await queue.enqueue([sample(now - 500, 38.7)]);
  assert.equal(await queue.count(), 1, 'a cold native task can leave one pending raw fix');
  await queue.clear();
  assert.equal(await queue.count(), 0, 'account departure purges the serialized raw-fix queue');

  const cleanupSource = fs.readFileSync(path.resolve('lib/originals/accountCleanup.ts'), 'utf8');
  assert.match(cleanupSource, /await expoOriginalLocationAdapter\.stopActive\(\)/);
  assert.match(cleanupSource, /await clearOriginalLocationRuntimeQueue\(\)/);
  assert.ok(
    cleanupSource.indexOf('await clearOriginalLocationRuntimeQueue()')
      < cleanupSource.indexOf("if (errors.length > 0) throw"),
    'raw-fix queue cleanup is part of the awaited Originals teardown barrier',
  );

  const adapterSource = fs.readFileSync(path.resolve('lib/originals/locationAdapter.ts'), 'utf8');
  const privateForegroundBody = adapterSource.match(
    /async startPrivateForeground\(onLocation\) \{([\s\S]*?)\n    \},\n\n    async start\(onLocation\)/,
  )?.[1] ?? '';
  assert.ok(privateForegroundBody, 'private foreground location path remains independently inspectable');
  assert.match(privateForegroundBody, /Location\.watchPositionAsync\(/);
  assert.match(privateForegroundBody, /permission: 'foreground'/);
  assert.doesNotMatch(privateForegroundBody, /startLocationUpdatesAsync/);
  assert.doesNotMatch(privateForegroundBody, /stopLocationUpdatesAsync/);
  assert.doesNotMatch(privateForegroundBody, /headlessLocationQueue/);
  assert.doesNotMatch(privateForegroundBody, /deliverOrQueueLocationSamples/);
  assert.doesNotMatch(privateForegroundBody, /processHeadlessOriginalLocationSamples/);

  const adapterGlobals = globalThis as typeof globalThis & {
    __privateForegroundWatchRequests?: PendingPrivateWatch[];
  };
  const watchRequests: PendingPrivateWatch[] = [];
  adapterGlobals.__privateForegroundWatchRequests = watchRequests;
  const { createExpoOriginalLocationAdapter } = await loadLocationAdapterModule();
  const adapter = createExpoOriginalLocationAdapter();
  const firstSamples: OriginalLocationSample[] = [];
  const secondSamples: OriginalLocationSample[] = [];
  const thirdSamples: OriginalLocationSample[] = [];
  const removableSubscription = () => {
    let removed = false;
    let removeCount = 0;
    return {
      subscription: {
        remove() {
          if (removed) return;
          removed = true;
          removeCount += 1;
        },
      },
      removeCount: () => removeCount,
    };
  };
  const locationObject = (timestamp: number) => ({
    coords: {
      latitude: 38.5,
      longitude: -109.5,
      accuracy: 5,
      heading: 90,
      speed: 12,
    },
    timestamp,
  });

  const firstStart = adapter.startPrivateForeground(sample => { firstSamples.push(sample); });
  const firstSettled = firstStart.then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error }),
  );
  await waitForPrivateWatchCount(watchRequests, 1);
  const secondStart = adapter.startPrivateForeground(sample => { secondSamples.push(sample); });
  await waitForPrivateWatchCount(watchRequests, 2);
  const firstSubscription = removableSubscription();
  const secondSubscription = removableSubscription();
  watchRequests[1].resolve(secondSubscription.subscription);
  const secondHandle = await secondStart;
  watchRequests[0].resolve(firstSubscription.subscription);
  const staleFirst = await firstSettled;
  assert.equal(staleFirst.ok, false, 'the out-of-order older start is rejected');
  if (!staleFirst.ok) assert.match(String(staleFirst.error), /cancelled/i);
  assert.equal(firstSubscription.removeCount(), 1, 'the stale start removes its own exact subscription');
  assert.equal(secondSubscription.removeCount(), 0, 'the stale start cannot remove the published newer watcher');
  watchRequests[0].callback(locationObject(now + 1_000));
  watchRequests[1].callback(locationObject(now + 2_000));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(firstSamples.length, 0, 'stale foreground callbacks stay generation-gated');
  assert.equal(secondSamples.length, 1, 'the newer published watcher remains live');

  const thirdStart = adapter.startPrivateForeground(sample => { thirdSamples.push(sample); });
  await waitForPrivateWatchCount(watchRequests, 3);
  assert.equal(secondSubscription.removeCount(), 1, 'replacement removes the prior published watcher exactly once');
  const thirdSubscription = removableSubscription();
  watchRequests[2].resolve(thirdSubscription.subscription);
  const thirdHandle = await thirdStart;
  await secondHandle.stop();
  assert.equal(thirdSubscription.removeCount(), 0, 'a stale returned stop cannot remove the current watcher');
  watchRequests[2].callback(locationObject(now + 3_000));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(thirdSamples.length, 1, 'a stale returned stop cannot invalidate the current generation');
  await thirdHandle.stop();
  assert.equal(thirdSubscription.removeCount(), 1, 'the current returned stop removes its own exact watcher');
  adapterGlobals.__privateForegroundWatchRequests = undefined;

  assert.throws(
    () => requireIosLockedScreenPermission('ios', false),
    new RegExp(IOS_LOCKED_SCREEN_LOCATION_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.doesNotThrow(() => requireIosLockedScreenPermission('ios', true));
  assert.match(backgroundLocationStartMessage('android'), /active-tour location service/);
  assert.equal(originalStartNeedsPermissionDisclosure('ios', {
    foregroundGranted: true,
    backgroundGranted: true,
  }), false, 'iOS does not repeat disclosure after all tour permissions are granted');
  assert.equal(originalStartNeedsPermissionDisclosure('ios', {
    foregroundGranted: true,
    backgroundGranted: false,
  }), true, 'iOS shows disclosure before requesting locked-screen access');
  assert.equal(originalStartNeedsPermissionDisclosure('android', {
    foregroundGranted: true,
    notificationsGranted: true,
  }), false, 'Android does not repeat disclosure after active-tour permissions are granted');
  assert.equal(originalStartNeedsPermissionDisclosure('android', {
    foregroundGranted: true,
    notificationsGranted: false,
  }), true, 'Android shows disclosure before requesting the foreground-service notification');

  console.log('Originals durable location queue tests passed.');
}

void main();
