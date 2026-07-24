import assert from 'node:assert/strict';

import {
  addPackingItem,
  mergePackingProgress,
  packingItemKey,
  removePackingItem,
  togglePackingItem,
} from '../tripPacking';

const empty = {
  essentials: [],
  recovery_gear: [],
  water_food: [],
  navigation: [],
  shelter: [],
  tools_spares: [],
  optional_nice_to_have: [],
  leave_at_home: [],
};

const added = addPackingItem(empty, 'essentials', '  Headlamp  ');
assert.deepEqual(added.essentials, ['Headlamp']);
assert.equal(addPackingItem(added, 'essentials', 'headlamp'), added);

const checked = togglePackingItem(added, 'essentials', 'Headlamp');
assert.deepEqual(checked.checked_items, [packingItemKey('essentials', 'Headlamp')]);
assert.deepEqual(togglePackingItem(checked, 'essentials', 'Headlamp').checked_items, []);

const removed = removePackingItem(checked, 'essentials', 'Headlamp');
assert.deepEqual(removed.essentials, []);
assert.deepEqual(removed.checked_items, []);

const refreshed = addPackingItem(empty, 'essentials', 'Headlamp');
assert.deepEqual(mergePackingProgress(checked, refreshed).checked_items, ['essentials:headlamp']);
assert.deepEqual(mergePackingProgress(checked, empty).checked_items, []);

console.log('trip packing tests passed');
