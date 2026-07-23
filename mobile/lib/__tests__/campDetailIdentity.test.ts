import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  campDetailFetchId,
  ridbFacilityIdFromCanonicalCampId,
} from '../campDetailIdentity';

test('canonical RIDB campground IDs resolve to the facility detail identifier', () => {
  assert.equal(ridbFacilityIdFromCanonicalCampId('place:ridb:234059'), '234059');
  assert.equal(ridbFacilityIdFromCanonicalCampId('ridb:234059'), '234059');
  assert.equal(campDetailFetchId({ id: 'place:ridb:234059', source: 'trailhead_search' }), '234059');
});

test('existing campsite detail identities keep their current behavior', () => {
  assert.equal(campDetailFetchId({ id: 'ridb_site:234059:123' }), 'ridb_site:234059:123');
  assert.equal(campDetailFetchId({ id: 'blm_42' }), 'blm_42');
  assert.equal(campDetailFetchId({ id: '234059', source_badge: 'Recreation.gov' }), '234059');
});

test('temporary and malformed place IDs do not trigger a server detail lookup', () => {
  assert.equal(ridbFacilityIdFromCanonicalCampId('place:ridb:234059:extra'), null);
  assert.equal(ridbFacilityIdFromCanonicalCampId('ridb_site:234059:123'), null);
  assert.equal(campDetailFetchId({ id: 'mapbox:camp.42', source: 'mapbox' }), null);
});
