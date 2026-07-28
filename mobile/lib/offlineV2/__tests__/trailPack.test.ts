import assert from 'node:assert/strict';
import {
  createTrailPackRequestV2,
  isTrailPackClientRefV2,
  trailPackClientRefV2,
} from '../trailPack';
import { createOrRecoverRnMapboxPack } from '../rnMapboxPackRecovery';

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
  assert.equal(await createOrRecoverRnMapboxPack({
    async create() {},
    async reload() { return createdPack; },
  }), createdPack);

  let recoveredResumeCount = 0;
  const recoveredPack = { async resume() { recoveredResumeCount += 1; } };
  assert.equal(await createOrRecoverRnMapboxPack({
    async create() { throw new Error('native creation promise failed'); },
    async reload() { return recoveredPack; },
  }), recoveredPack);
  assert.equal(recoveredResumeCount, 1, 'a native-persisted pack resumes without restarting the app');

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

console.log('Offline V2 trail-pack request tests passed.');
