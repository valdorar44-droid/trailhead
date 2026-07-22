import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findAuthorizedPlanItem, planDeepLinkRequest } from '../planDeepLinks';

assert.deepEqual(
  planDeepLinkRequest({ trip_id: 'trip-moab' }),
  { section: 'trips', item_id: 'trip-moab' },
);
assert.deepEqual(
  planDeepLinkRequest({ section: 'originals', original_id: ['moab-canyons'] }),
  { section: 'originals', item_id: 'moab-canyons' },
);
assert.deepEqual(planDeepLinkRequest({ section: 'downloads' }), { section: 'downloads' });
assert.equal(planDeepLinkRequest({ trip_id: 'bad trip id' }), null);

const owned = [{ id: 'owned-trip', title: 'Owned' }];
assert.equal(findAuthorizedPlanItem('owned-trip', owned)?.title, 'Owned');
assert.equal(findAuthorizedPlanItem('not-owned', owned), null);
assert.equal(findAuthorizedPlanItem('../private', owned), null);

const planSource = fs.readFileSync(path.resolve('app/(tabs)/trips.tsx'), 'utf8');
assert.doesNotMatch(
  planSource,
  /<OfflineDownloadsSection/,
  'Plan does not present the V2-only list as the complete device inventory',
);
assert.match(planSource, /setPendingOpenOfflineModal\(true\)/);
assert.match(planSource, />Manage offline downloads</);

console.log('Plan deep-link authorization tests passed.');
