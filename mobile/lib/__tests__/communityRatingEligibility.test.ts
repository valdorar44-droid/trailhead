import assert from 'node:assert/strict';
import { test } from 'node:test';

import { communityRatingTarget } from '../communityRatingEligibility';

test('ratings require the feature, a signed-in account, and canonical supported identity', () => {
  const base = { enabled: true, signedIn: true, kind: 'camp' as const, canonicalEntityId: 'canonical-camp-1' };
  assert.deepEqual(communityRatingTarget(base), { kind: 'camp', entityId: 'canonical-camp-1' });
  assert.equal(communityRatingTarget({ ...base, enabled: false }), null);
  assert.equal(communityRatingTarget({ ...base, signedIn: false }), null);
  assert.equal(communityRatingTarget({ ...base, canonicalEntityId: '' }), null);
  assert.equal(communityRatingTarget({ ...base, kind: 'community_report' }), null);
});

test('temporary providers, Viator, and Originals never enter first-party ratings', () => {
  const base = { enabled: true, signedIn: true, kind: 'place' as const, canonicalEntityId: 'canonical-place-1' };
  assert.equal(communityRatingTarget({ ...base, persistencePolicy: 'temporary' }), null);
  assert.equal(communityRatingTarget({ ...base, temporaryUseOnly: true }), null);
  assert.equal(communityRatingTarget({ ...base, source: 'viator' }), null);
  assert.equal(communityRatingTarget({ ...base, type: 'original_drive' }), null);
  assert.deepEqual(communityRatingTarget({ ...base, source: 'trailhead' }), { kind: 'place', entityId: 'canonical-place-1' });
});
