import assert from 'node:assert/strict';
import { nextOfflinePlacePackIndex } from '../offlinePlacePackIndex';

const existing = Array.from({ length: 120 }, (_, index) => `pack-${index}`);
const next = nextOfflinePlacePackIndex(existing, 'new-pack', ['pack-80', 'pack-119']);
assert.equal(next[0], 'new-pack');
assert.equal(next.length, 121, 'saving a pack never silently evicts downloaded inventory');
assert.ok(existing.every(id => next.includes(id)));
assert.equal(next.filter(id => id === 'pack-80').length, 1);

console.log('Offline place-pack index tests passed.');
