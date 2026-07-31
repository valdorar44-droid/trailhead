import assert from 'node:assert/strict';
import { appLinkDestinationFromUrl } from '../appLinks';

assert.deepEqual(
  appLinkDestinationFromUrl('https://gettrailhead.app/support/thread_123'),
  { screen: 'support', threadId: 'thread_123' },
);
assert.deepEqual(
  appLinkDestinationFromUrl('https://gettrailhead.app/app/prizes'),
  { screen: 'prizes' },
);
assert.deepEqual(
  appLinkDestinationFromUrl('https://gettrailhead.app/trips/trip-moab'),
  { screen: 'trips', tripId: 'trip-moab' },
);
assert.deepEqual(
  appLinkDestinationFromUrl('trailhead://originals/moab-canyons'),
  { screen: 'original', originalId: 'moab-canyons' },
);
const sharedToken = 'F'.repeat(43);
assert.deepEqual(
  appLinkDestinationFromUrl(`https://gettrailhead.app/app/trails/shared#token=${sharedToken}`),
  { screen: 'sharedTrail', shareToken: sharedToken },
);
assert.deepEqual(
  appLinkDestinationFromUrl(`trailhead://app/trails/shared#token=${sharedToken}`),
  { screen: 'sharedTrail', shareToken: sharedToken },
);
assert.equal(appLinkDestinationFromUrl(`https://gettrailhead.app/app/trails/shared?token=${sharedToken}`), null);
assert.equal(appLinkDestinationFromUrl(`https://evil.example/app/trails/shared#token=${sharedToken}`), null);
assert.equal(appLinkDestinationFromUrl(`https://gettrailhead.app/app/trails/shared/${sharedToken}`), null);
assert.equal(appLinkDestinationFromUrl('https://evil.example/trips/private'), null);
assert.equal(appLinkDestinationFromUrl('javascript://gettrailhead.app/prizes'), null);
assert.equal(appLinkDestinationFromUrl('https://gettrailhead.app/trips/bad%20id'), null);
assert.equal(appLinkDestinationFromUrl('https://gettrailhead.app/app/trails/%E0%A4%A'), null);

console.log('Universal and app-link routing tests passed.');
