import assert from 'node:assert/strict';
import {
  canonicalReferralUrl,
  normalizeReferralCode,
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

assert.equal(canonicalReferralUrl('ROAD-88'), 'https://gettrailhead.app/r/ROAD-88');
assert.equal(canonicalReferralUrl(''), 'https://gettrailhead.app');

console.log('First-party referral host and scheme tests passed.');
