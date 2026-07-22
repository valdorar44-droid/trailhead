import assert from 'node:assert/strict';
import { resolveActiveOfflineRendererStyleId } from '../activeStyle';

assert.equal(resolveActiveOfflineRendererStyleId('extreme', 'standard'), 'standard');
assert.equal(resolveActiveOfflineRendererStyleId('extreme', 'standard_satellite'), 'standard_satellite');
assert.equal(resolveActiveOfflineRendererStyleId('extreme', 'satellite_streets'), 'satellite_streets');
assert.equal(resolveActiveOfflineRendererStyleId('extreme', 'dawn'), 'standard');
assert.equal(resolveActiveOfflineRendererStyleId('extreme', 'dusk'), 'standard');
assert.equal(resolveActiveOfflineRendererStyleId('extreme', 'night'), 'standard');
assert.equal(resolveActiveOfflineRendererStyleId('topo', 'outdoors'), null, 'custom Trailhead style stays on legacy offline');
assert.equal(resolveActiveOfflineRendererStyleId('extreme', 'private-custom-style'), null, 'unknown styles cannot reach the server');

console.log('Offline V2 active-style binding tests passed.');
