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
assert.equal(referralCodeFromUrl('https://www.gettrailhead.app/r/TRAIL-123'), 'TRAIL-123');
assert.equal(referralCodeFromUrl('trailhead://register?referral_code=friend_7'), 'friend_7');
assert.equal(referralCodeFromUrl('trailhead://referral?code=friend_8'), 'friend_8');
assert.equal(referralCodeFromUrl('trailhead:///register?code=friend_9'), 'friend_9');

for (const untrusted of [
  'https://evil.example/r/TRAIL-123',
  'https://gettrailhead.app.evil.example/r/TRAIL-123',
  'https://gettrailhead.app:8443/r/TRAIL-123',
  'https://user:secret@gettrailhead.app/r/TRAIL-123',
  'http://gettrailhead.app/r/TRAIL-123',
  'javascript://gettrailhead.app/r/TRAIL-123',
  'trailhead://support?referral_code=TRAIL-123',
  'trailhead://register/extra?referral_code=TRAIL-123',
  'https://gettrailhead.app/r/a/b',
  'not-a-url/r/TRAIL-123',
]) {
  assert.equal(referralCodeFromUrl(untrusted), '', `accepted untrusted URL: ${untrusted}`);
}

assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': false,
  referral_code: 'ignored',
}), '');
assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': true,
  '$canonical_identifier': 'referral/FRIEND_9',
}), '');
assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': true,
  '~referring_link': 'https://go.gettrailhead.app/opaque-alias',
  '$canonical_identifier': 'referral/FRIEND_9',
}), 'FRIEND_9');
assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': true,
  '~referring_link': 'https://go.gettrailhead.app/r/opaque-alias',
  referral_code: 'ROAD-88',
}), 'ROAD-88');
assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': true,
  '~referring_link': 'https://custom.branch.example/opaque',
  referral_code: 'ROAD-89',
}, { branchDomains: ['custom.branch.example'] }), 'ROAD-89');
assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': true,
  '~referring_link': 'https://evil.example/r/opaque',
  referral_code: 'STOLEN-7',
}), '');
assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': true,
  '~referring_link': 'https://evil.example/r/opaque',
  '$canonical_identifier': 'referral/STOLEN-8',
}), '');
assert.equal(referralCodeFromAttributionParams({
  '+clicked_branch_link': true,
  '$deeplink_path': 'referral?code=FRIEND_10',
}), 'FRIEND_10');

assert.equal(canonicalReferralUrl('ROAD-88'), 'https://gettrailhead.app/r/ROAD-88');
assert.equal(canonicalReferralUrl(''), 'https://gettrailhead.app');

console.log('Referral host, scheme, and attribution policy tests passed.');
