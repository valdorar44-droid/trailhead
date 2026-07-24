import assert from 'node:assert/strict';
import test from 'node:test';

import { trustedTripTimelinePhotoUrl } from '../tripTimelineMedia';

test('timeline accepts an exact attributed photo and rejects an unverified generic image', () => {
  assert.equal(
    trustedTripTimelinePhotoUrl({
      photos: [{ url: 'https://example.test/camp.jpg', credit: 'NPS / Jane Ranger' }],
    }),
    'https://example.test/camp.jpg',
  );
  assert.equal(
    trustedTripTimelinePhotoUrl({
      photo_url: 'https://example.test/random.jpg',
      source: 'mixed',
      photo_status: 'fallback',
    }),
    '',
  );
  assert.equal(
    trustedTripTimelinePhotoUrl({
      photo_url: 'https://www.nps.gov/camp.jpg',
      verified_source: 'NPS',
      photo_status: 'official',
    }),
    'https://www.nps.gov/camp.jpg',
  );
});
