import assert from 'node:assert/strict';
import test from 'node:test';
import { trailRoutePlanMatchesOwner } from '../trailRoutePlanOwnership';

test('a canonical trail accepts only a route plan owned by that trail', () => {
  const trail = { id: 'trail:short-point', geometry_revision: 'sha256:short' };
  assert.equal(trailRoutePlanMatchesOwner({ trailId: trail.id, geometryRevision: 'sha256:short' }, trail), true);
  assert.equal(trailRoutePlanMatchesOwner({ trailId: 'trail:island-route', geometryRevision: 'sha256:island' }, trail), false);
  assert.equal(trailRoutePlanMatchesOwner({ trailId: trail.id, geometryRevision: 'sha256:old' }, trail), false);
  assert.equal(trailRoutePlanMatchesOwner({}, trail), false);
});
