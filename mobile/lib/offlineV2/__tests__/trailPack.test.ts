import assert from 'node:assert/strict';
import {
  createTrailPackRequestV2,
  isTrailPackClientRefV2,
  trailPackClientRefV2,
} from '../trailPack';
import { createOrRecoverRnMapboxPack } from '../rnMapboxPackRecovery';
import {
  awaitRnMapboxOfflinePackReady,
  classifyRnMapboxNativeFailure,
  getLastRnMapboxOfflineLifecycleDiagnostics,
  getLastRnMapboxOfflineLifecycleTrace,
} from '../rnMapboxPackLifecycle';

const trailId = 'trail-system:trail:usfs:moab-short:abc123';
const request = createTrailPackRequestV2({
  trailId,
  geometryRevision: 'canonical-7:trail:usfs:moab-short',
  coords: [[-109.56, 38.57], [-109.54, 38.59]],
});

assert.equal(request.scope?.kind, 'trail');
assert.equal(request.scope?.trail_id, trailId);
assert.equal(request.scope?.corridor_m, 1200);
assert.equal(request.renderer_style_id, 'outdoors');
assert.deepEqual(request.options, { routing: false, contours: false, extended_media: false });
assert.ok(request.bounds.west < -109.56 && request.bounds.east > -109.54);
assert.ok(request.bounds.south < 38.57 && request.bounds.north > 38.59);
assert.equal(trailPackClientRefV2(trailId), `trail:${trailId}`);
assert.equal(isTrailPackClientRefV2(trailPackClientRefV2(trailId)), true);
assert.equal(isTrailPackClientRefV2('trip:moab'), false);

assert.throws(() => createTrailPackRequestV2({
  trailId,
  geometryRevision: 'canonical-7',
  coords: [],
}), /complete verified trail route/i);
assert.throws(() => createTrailPackRequestV2({
  trailId: 'bad id',
  geometryRevision: 'canonical-7',
  coords: [[-109.56, 38.57], [-109.54, 38.59]],
}), /stable offline identity/i);

async function verifyNativePackRecovery() {
  const createdPack = { async resume() { throw new Error('a newly created pack must not resume'); } };
  let bootstrapFailure = 'RNMBXOfflineModule';
  assert.equal(await createOrRecoverRnMapboxPack({
    async create() { bootstrapFailure = 'RNMBXOfflineModule'; },
    async reload() { return createdPack; },
    onPackReady() { bootstrapFailure = ''; },
  }), createdPack);
  assert.equal(bootstrapFailure, '', 'a queryable immutable pack clears only its stale bootstrap error');

  let recoveredResumeCount = 0;
  let reloadCount = 0;
  const waits: number[] = [];
  const recoveredPack = { async resume() { recoveredResumeCount += 1; } };
  assert.equal(await createOrRecoverRnMapboxPack({
    async create() { throw new Error('native creation promise failed'); },
    async reload() {
      reloadCount += 1;
      return reloadCount >= 3 ? recoveredPack : undefined;
    },
    reloadDelaysMs: [0, 50, 100],
    async sleep(milliseconds) { waits.push(milliseconds); },
  }), recoveredPack);
  assert.equal(recoveredResumeCount, 1, 'a native-persisted pack resumes without restarting the app');
  assert.deepEqual(waits, [50, 100], 'native registry recovery is bounded and never recreates the pack');

  const unrecoverableCreationError = new Error('native creation failed before persistence');
  await assert.rejects(
    createOrRecoverRnMapboxPack({
      async create() { throw unrecoverableCreationError; },
      async reload() { return undefined; },
    }),
    error => error === unrecoverableCreationError,
  );
}

verifyNativePackRecovery().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

async function verifyNativePackLifecycle() {
  assert.equal(classifyRnMapboxNativeFailure('Tile region load was Canceled'), 'canceled');
  assert.equal(classifyRnMapboxNativeFailure('network timeout'), 'network');
  assert.equal(classifyRnMapboxNativeFailure('style resource unavailable'), 'resource');
  assert.equal(classifyRnMapboxNativeFailure('RNMBXOfflineModule'), 'other');

  let clock = 0;
  let statusIndex = 0;
  const pack = {};
  const statuses = [
    { percentage: 0, completedResourceSize: 0, completedResourceCount: 0 },
    { percentage: 15, completedResourceSize: 15, completedResourceCount: 1 },
    { percentage: 100, completedResourceSize: 100, completedResourceCount: 2 },
  ];
  assert.equal(await awaitRnMapboxOfflinePackReady({
    async getPack() { return pack; },
    async readStatus() { return statuses[Math.min(statusIndex++, statuses.length - 1)]; },
    getNativeFailure() { return { sequence: 1, category: 'canceled' }; },
    expectedBytes: 100,
    now: () => clock,
    async sleep(milliseconds) { clock += milliseconds; },
    pollIntervalMs: 400,
    nativeErrorStallMs: 800,
  }), pack, 'a native callback error is transient while the exact pack advances');
  assert.ok(getLastRnMapboxOfflineLifecycleTrace().some(event => event.phase === 'native_error_recovered'));
  assert.equal(getLastRnMapboxOfflineLifecycleTrace().at(-1)?.phase, 'complete');
  assert.equal(getLastRnMapboxOfflineLifecycleDiagnostics().terminal_code, null);

  clock = 0;
  await assert.rejects(
    awaitRnMapboxOfflinePackReady({
      async getPack() { return undefined; },
      async readStatus() { return {}; },
      getNativeFailure() { return { sequence: 1, category: 'resource' }; },
      expectedBytes: 100,
      now: () => clock,
      async sleep(milliseconds) { clock += milliseconds; },
    }),
    (error: unknown) => (error as { code?: string }).code === 'rnmapbox_resource_pack_missing',
  );

  clock = 0;
  await assert.rejects(
    awaitRnMapboxOfflinePackReady({
      async getPack() { return pack; },
      async readStatus() { return { percentage: 0, completedResourceSize: 0, completedResourceCount: 0 }; },
      getNativeFailure() { return { sequence: 1, category: 'canceled' }; },
      expectedBytes: 100,
      now: () => clock,
      async sleep(milliseconds) { clock += milliseconds; },
      pollIntervalMs: 400,
      nativeErrorStallMs: 800,
    }),
    (error: unknown) => (error as { code?: string }).code === 'rnmapbox_canceled_pack_stalled',
  );
  assert.equal(
    getLastRnMapboxOfflineLifecycleDiagnostics().terminal_code,
    'rnmapbox_canceled_pack_stalled',
  );
  assert.equal(getLastRnMapboxOfflineLifecycleDiagnostics().events.at(-1)?.phase, 'pack_stalled');

  const controller = new AbortController();
  controller.abort();
  let paused = false;
  await assert.rejects(
    awaitRnMapboxOfflinePackReady({
      async getPack() { return pack; },
      async readStatus() { return {}; },
      async pause() { paused = true; },
      signal: controller.signal,
      expectedBytes: 100,
    }),
    (error: unknown) => (error as { name?: string }).name === 'AbortError',
  );
  assert.equal(paused, true, 'canceling a wait pauses the exact native pack');
}

verifyNativePackLifecycle().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

console.log('Offline V2 trail-pack request tests passed.');
