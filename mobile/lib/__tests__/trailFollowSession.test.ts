import assert from 'node:assert/strict';
import {
  evaluateTrailFollow,
  resolveTrailFollowStart,
  type TrailCoordinate,
} from '../trailFollowSession';

const route: TrailCoordinate[] = [
  [-109.55, 38.55],
  [-109.54, 38.55],
  [-109.54, 38.56],
  [-109.53, 38.56],
];

const near = { lat: 38.5501, lng: -109.549, accuracyM: 8, timestampMs: 1_000 };
assert.equal(resolveTrailFollowStart({ fix: near, route, trailheads: [] }).kind, 'follow');

const far = { lat: 38.7, lng: -109.7, accuracyM: 10, timestampMs: 1_000 };
const sourceBacked = resolveTrailFollowStart({
  fix: far,
  route,
  trailheads: [{ name: 'North trailhead', lat: 38.55, lng: -109.55, source: 'NPS' }],
});
assert.equal(sourceBacked.kind, 'handoff');
assert.equal(sourceBacked.kind === 'handoff' ? sourceBacked.trailhead.name : null, 'North trailhead');

assert.deepEqual(
  resolveTrailFollowStart({
    fix: far,
    route,
    trailheads: [{ name: 'Unverified pin', lat: 38.55, lng: -109.55 }],
  }),
  { kind: 'unavailable', reason: 'source_backed_trailhead_missing' },
);

const following = evaluateTrailFollow(near, route);
assert.equal(following?.gps, 'good');
assert.equal(following?.offRoute, false);
assert.equal(following?.nextCue, 'Bear left');
assert.ok((following?.remainingM ?? 0) > 0);

const weak = evaluateTrailFollow({ ...near, accuracyM: 120 }, route);
assert.equal(weak?.gps, 'weak');
assert.equal(weak?.offRoute, false);
assert.equal(weak?.nextCue, 'Waiting for a better GPS fix');

const offRoute = evaluateTrailFollow({ ...near, lat: 38.57, accuracyM: 8 }, route);
assert.equal(offRoute?.offRoute, true);
assert.equal(offRoute?.nextCue, 'Return to the trail');

console.log('trail follow session tests passed');
