import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contestAwardPeriodLabel,
  contestAwardPresentation,
  PROFILE_SECTIONS,
  supportThreadIdForContestAward,
} from '../profilePresentation';

test('Profile keeps each real feature family in a stable destination', () => {
  assert.deepEqual(
    PROFILE_SECTIONS.map(section => section.id),
    ['account', 'trips', 'rig', 'community', 'support', 'settings'],
  );
});

test('contest awards use human status copy without exposing payout credentials', () => {
  assert.deepEqual(contestAwardPresentation('selected'), {
    label: 'Winner selected',
    detail: 'Trailhead will send a private prize message.',
    canOpenMessage: false,
  });
  assert.equal(contestAwardPresentation('notified').label, 'Payout coordination');
  assert.equal(contestAwardPresentation('paid').label, 'Paid');
  assert.equal(contestAwardPresentation('void').label, 'Closed');
  assert.doesNotMatch(contestAwardPresentation('notified').detail, /account|routing|credential/i);
});

test('contest award periods and private support threads resolve deterministically', () => {
  assert.equal(contestAwardPeriodLabel('2026-07', '2026'), 'July 2026');
  assert.equal(contestAwardPeriodLabel(null, '2025'), '2025');
  assert.equal(supportThreadIdForContestAward([
    { id: 14, contest_award_id: 7 },
    { id: 18, contest_award_id: 9 },
  ], 9), 18);
  assert.equal(supportThreadIdForContestAward([], 9), null);
});
