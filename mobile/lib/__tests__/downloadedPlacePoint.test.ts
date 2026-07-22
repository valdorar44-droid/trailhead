import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { PlacePackPoint } from '../api';
import { downloadedPlacePointToPoi } from '../downloadedPlacePoint';

const durableCamp = {
  id: 'camp-juniper',
  name: 'Juniper Camp',
  lat: 38.61,
  lng: -109.57,
  type: 'camp',
  subtype: 'rv_park',
  source_badge: 'Official campground',
  official_url: 'https://example.gov/juniper',
  booking_url: 'https://reserve.example.gov/juniper',
  site_types: ['Tent', 'RV'],
  amenities: ['Water', 'Vault toilets'],
  campsites_count: 18,
  campsites: [{ id: 'a1', type: 'RV', max_vehicle_length: '35 ft' }],
  rig_suitability: 'RVs up to 35 ft',
  max_rig_length: '35 ft',
  reservations: { reservable: true, required: false },
  aliases: ['Juniper Flats'],
  search_terms: ['rv camping', 'tent camping'],
  local_terms: ['the junipers'],
  trek_name: 'Canyonlands Traverse',
  stage_name: 'Moab to Island in the Sky',
  safety_note: 'Carry water.',
  gauge_id: 'USGS-123',
  navigation_feature: 'access_road',
  future_durable_field: { revision: 4 },
} as PlacePackPoint & Record<string, unknown>;

const mapPoi = downloadedPlacePointToPoi(durableCamp, {
  normalizeSubtype: value => value.replace(/_/g, ' '),
  sourceLabelFallback: 'Saved places',
  websitePreference: 'booking_first',
  markDownloaded: true,
});

assert.equal(mapPoi.subtype, 'rv park');
assert.equal(mapPoi.source, 'offline');
assert.equal(mapPoi.source_label, 'Official campground');
assert.equal(mapPoi.website, durableCamp.booking_url);
assert.equal(mapPoi.booking_url, durableCamp.booking_url);
assert.deepEqual(mapPoi.site_types, ['Tent', 'RV']);
assert.deepEqual(mapPoi.amenities, ['Water', 'Vault toilets']);
assert.equal(mapPoi.campsites_count, 18);
assert.deepEqual(mapPoi.campsites, durableCamp.campsites);
assert.equal(mapPoi.rig_suitability, 'RVs up to 35 ft');
assert.equal(mapPoi.max_rig_length, '35 ft');
assert.deepEqual(mapPoi.reservations, durableCamp.reservations);
assert.deepEqual(mapPoi.aliases, ['Juniper Flats']);
assert.deepEqual(mapPoi.search_terms, ['rv camping', 'tent camping']);
assert.deepEqual(mapPoi.local_terms, ['the junipers']);
assert.equal(mapPoi.trek_name, 'Canyonlands Traverse');
assert.equal(mapPoi.stage_name, 'Moab to Island in the Sky');
assert.equal(mapPoi.safety_note, 'Carry water.');
assert.equal(mapPoi.gauge_id, 'USGS-123');
assert.equal(mapPoi.navigation_feature, 'access_road');
assert.deepEqual(mapPoi.future_durable_field, { revision: 4 });
assert.equal(mapPoi.cache_status, 'downloaded');

const routePoi = downloadedPlacePointToPoi(durableCamp, {
  normalizeSubtype: value => value.replace(/_/g, ' '),
  websitePreference: 'official_first',
  amenitiesAsActivities: true,
});
assert.equal(routePoi.website, durableCamp.official_url);
assert.deepEqual(routePoi.activities, durableCamp.amenities);
assert.deepEqual(routePoi.campsites, durableCamp.campsites);
assert.deepEqual(routePoi.aliases, durableCamp.aliases);

const mapSource = readFileSync('app/(tabs)/map.tsx', 'utf8');
const routeBuilderSource = readFileSync('app/(tabs)/route-builder.tsx', 'utf8');
for (const source of [mapSource, routeBuilderSource]) {
  assert.match(source, /downloadedPlacePointToPoi\(point,/);
}
assert.doesNotMatch(mapSource, /const legacy = points\.map\(p => \(\{/);
assert.doesNotMatch(routeBuilderSource, /const legacy = points\.map\(point => \(\{/);

console.log('Downloaded place-pack parity tests passed.');
