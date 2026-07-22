import assert from 'node:assert/strict';
import {
  canonicalReferralUrl,
  normalizeReferralCode,
  referralCodeFromAttributionParams,
  referralCodeFromUrl,
} from '../referralLinks';

assert.equal(normalizeReferralCode(' Trail_123 '), 'Trail_123');
assert.equal(normalizeReferralCode('x'), '');
assert.equal(normalizeReferralCode('bad code'), '');

assert.equal(referralCodeFromUrl('https://gettrailhead.app/r/TRAIL-123'), 'TRAIL-123');
assert.equal(referralCodeFromUrl('trailhead://register?referral_code=friend_7'), 'friend_7');
assert.equal(referralCodeFromUrl('javascript://gettrailhead.app/r/bad-code'), '');
assert.equal(referralCodeFromUrl('https://gettrailhead.app/r/a/b'), '');

assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': false,
  referral_code: 'ignored',
}), '');
assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': true,
  '$canonical_identifier': 'referral/FRIEND_9',
}), 'FRIEND_9');
assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': true,
  '~referring_link': 'https://go.gettrailhead.app/r/ROAD-88?campaign=spring',
}), 'ROAD-88');

assert.equal(canonicalReferralUrl('ROAD-88'), 'https://gettrailhead.app/r/ROAD-88');
assert.equal(canonicalReferralUrl(''), 'https://gettrailhead.app');

console.log('Referral link attribution tests passed.');
