import assert from 'node:assert/strict';

import { originalManifest } from '../lib/originals/__tests__/fixtures';
import {
  buildOriginalContinuousRouteFixture,
  originalManifestSha256,
  verifyOriginalContinuousRouteFixture,
} from './original-route-fixture';

const manifest = originalManifest(7);
manifest.route.geometry.coordinates = [[0, 0], [0.01, 0], [0.02, 0]];
manifest.stops = manifest.stops.map(stop => ({ ...stop, audio_duration_s: 1 }));

const fixture = buildOriginalContinuousRouteFixture(manifest, {
  pack_id: 'moab-original',
  version: 7,
});
const summary = verifyOriginalContinuousRouteFixture(fixture, manifest);
assert.equal(summary.pack_id, 'moab-original');
assert.equal(summary.version, 7);
assert.equal(summary.manifest_sha256, originalManifestSha256(manifest));
assert.ok(summary.sample_count > 40);
assert.equal(fixture.samples[0].phase, 'route_start');
assert.equal(fixture.samples.at(-1)?.phase, 'route_end');
assert.ok(fixture.samples.every(sample => !('transcript' in sample) && !('audio_asset_id' in sample)));

const changed = structuredClone(manifest);
changed.stops[0].transcript = 'Changed after publication.';
assert.throws(
  () => verifyOriginalContinuousRouteFixture(fixture, changed),
  /manifest hash no longer matches/i,
);
assert.throws(
  () => buildOriginalContinuousRouteFixture(manifest, { pack_id: 'other-pack', version: 7 }),
  /Expected pack other-pack/,
);
assert.throws(
  () => buildOriginalContinuousRouteFixture(manifest, { pack_id: 'moab-original', version: 8 }),
  /Expected version 8/,
);

console.log(`PASS: version-pinned continuous Original fixture (${summary.sample_count} fixes)`);
