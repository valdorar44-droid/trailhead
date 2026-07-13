import assert from 'node:assert/strict';
import { createTripDocument } from '../../../lib/tripRepository/core';
import { assertTripOperationOwnerScope } from '../tripOperationScope';
import type { TripLibraryItem } from '../types';

const document = createTripDocument({
  id: 'same-id',
  title: 'Account A trip',
  status: 'completed',
  ownerScope: 'account:a',
});
const item: TripLibraryItem = {
  id: document.id,
  name: document.title,
  regions: [],
  days: 1,
  miles: 0,
  stopCount: 0,
  updatedAt: document.updatedAt,
  status: 'saved',
  isActive: false,
  isOffline: false,
  detailAvailable: false,
  bookingCount: 0,
  alertCount: 0,
  activeMonitorCount: 0,
  monitorState: null,
  noteCount: 0,
  previewPins: [],
  document,
};

assert.doesNotThrow(() => assertTripOperationOwnerScope(item, 'account:a'));
assert.throws(
  () => assertTripOperationOwnerScope(item, 'account:b'),
  /belongs to a different account/,
);

console.log('trip operation owner scope contracts passed');
