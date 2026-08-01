import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  campDetailFetchId,
  campDetailMatchesSelection,
  ridbFacilityIdFromCanonicalCampId,
} from '../campDetailIdentity';

test('canonical RIDB campground IDs resolve to the facility detail identifier', () => {
  assert.equal(ridbFacilityIdFromCanonicalCampId('place:ridb:234059'), '234059');
  assert.equal(ridbFacilityIdFromCanonicalCampId('ridb:234059'), '234059');
  assert.equal(campDetailFetchId({ id: 'place:ridb:234059', source: 'trailhead_search' }), '234059');
});

test('reviewed agency campground IDs resolve through the stored catalog', () => {
  assert.equal(
    campDetailFetchId({
      id: 'place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8',
      source: 'trailhead_search',
    }),
    'place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8',
  );
  assert.equal(campDetailFetchId({ id: 'place:nps:yose-camp-4' }), 'place:nps:yose-camp-4');
  assert.equal(campDetailFetchId({ id: 'place:blm:moab-camp-1' }), 'place:blm:moab-camp-1');
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

test('camp detail enrichment cannot replace a selected campground with a distant entity', () => {
  assert.equal(campDetailMatchesSelection(
    { id: 'yosemite-valley', name: 'Yosemite Valley Campground', lat: 37.745, lng: -119.593 },
    { id: 'hemlock', name: 'Hemlock', lat: 46.495764, lng: -86.6823 },
  ), false);
});

test('nearby facility details and same-name regional details remain valid', () => {
  assert.equal(campDetailMatchesSelection(
    { id: 'camp-4', name: 'Camp 4', lat: 37.741, lng: -119.602 },
    { id: 'camp-4', name: 'Camp 4 Campground', lat: 37.742, lng: -119.601 },
  ), true);
  assert.equal(campDetailMatchesSelection(
    { id: 'large-park', name: 'Furnace Creek Campground', lat: 36.462, lng: -116.868 },
    { id: 'large-park', name: 'Furnace Creek', lat: 36.8, lng: -116.8 },
  ), true);
});
